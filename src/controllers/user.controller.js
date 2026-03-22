/**
 * User Controller
 *
 * Handles user management endpoints (Customer Admin):
 *   - GET    /api/v1/customers/:customerId/users           List users
 *   - POST   /api/v1/customers/:customerId/users           Create user + invitation
 *   - GET    /api/v1/customers/:customerId/users/:userId   Get single user
 *   - PATCH  /api/v1/users/:userId                          Update user
 *   - POST   /api/v1/users/:userId/enable                   Reactivate user
 *   - POST   /api/v1/users/:userId/disable                  Disable user
 *   - DELETE /api/v1/users/:userId                          Delete disabled user
 *   - POST   /api/v1/users/:userId/resend-invitation        Resend invitation
 */

import { Customer, User, Tenant, Invitation } from '../models/index.js'
import identityPlusService from '../services/identityPlusService.js'
import auditService from '../services/auditService.js'
import logger from '../config/logger.js'
import env from '../config/env.js'
import performanceCacheService from '../services/performanceCacheService.js'
import customerGovernanceService from '../services/customerGovernanceService.js'
import invitationService from '../services/invitationService.js'
import { applyManualTestPasswordBootstrap } from '../services/manualTestPasswordBootstrapService.js'
import {
  buildTenantVisibilityErrorResponse,
  TENANT_VISIBILITY_REASONS,
  validateTenantVisibilityPayload,
} from '../services/tenantVisibilityContractService.js'

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const normalizeStatusFilter = (value) => {
  if (!value) return null
  if (value === 'ACTIVE') return true
  if (value === 'INACTIVE' || value === 'DISABLED') return false
  return null
}

const USER_LIFECYCLE_REASONS = Object.freeze({
  INVALID_CUSTOMER_MEMBERSHIP: 'USER_INVALID_CUSTOMER_MEMBERSHIP',
  ALREADY_ACTIVE: 'USER_ALREADY_ACTIVE',
  ALREADY_DISABLED: 'USER_ALREADY_DISABLED',
  DELETE_REQUIRES_DISABLED: 'USER_DELETE_REQUIRES_DISABLED',
  INVITATION_REQUIRES_ACTIVE_USER: 'INVITATION_RESEND_REQUIRES_ACTIVE_USER',
  INVITATION_REQUIRES_UNTRUSTED: 'INVITATION_RESEND_REQUIRES_UNTRUSTED',
})

const ACTIVE_INVITATION_STATUSES = ['created', 'sent', 'send_failed', 'accessed']

const resolveCustomerMembership = (user, customerId) =>
  (user?.memberships || []).find(
    (membership) => toIdString(membership?.customerId) === customerId,
  ) || null

const listCustomerTenantVisibility = ({ user, customerId }) => {
  const targetCustomerId = toIdString(customerId)
  if (!targetCustomerId) return []

  return Array.from(
    new Set(
      (user?.tenantMemberships || [])
        .filter((membership) => toIdString(membership?.customerId) === targetCustomerId)
        .map((membership) => toIdString(membership?.tenantId))
        .filter(Boolean),
    ),
  )
}

const serializeUser = (user) =>
  (user && typeof user.toJSON === 'function' ? user.toJSON() : user) || {}

const mapCustomerScopedUser = ({ user, customerId, canonicalAdminUserId }) => {
  const serializedUser = serializeUser(user)
  const membership = resolveCustomerMembership(serializedUser, customerId)
  const userId = toIdString(serializedUser?._id || user?._id)
  const tenantVisibility = listCustomerTenantVisibility({ user: serializedUser, customerId })

  return {
    ...serializedUser,
    id: userId,
    status: serializedUser?.isActive ? 'ACTIVE' : 'INACTIVE',
    trustStatus: serializedUser?.identityPlus?.trustStatus || 'UNTRUSTED',
    customerRoles: membership?.roles || [],
    tenantVisibility,
    isCanonicalAdmin: Boolean(canonicalAdminUserId && canonicalAdminUserId === userId),
  }
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase()

const normalizeRoleList = (roles) =>
  Array.from(
    new Set(
      (Array.isArray(roles) ? roles : [])
        .map((role) => String(role || '').trim())
        .filter(Boolean),
    ),
  )

const listCustomerMembershipIds = (user) =>
  Array.from(
    new Set(
      (user?.memberships || [])
        .filter((membership) => membership?.customerId)
        .map((membership) => toIdString(membership.customerId))
        .filter(Boolean),
    ),
  )

const arraysEqual = (left = [], right = []) =>
  left.length === right.length && left.every((value, index) => value === right[index])

const upsertFakeAuthInvitationForCustomerUser = async ({
  req,
  customer,
  customerId,
  user,
  source,
}) => {
  if (!env.fakeAuthAllowed || !customerId || !user?._id) {
    return null
  }

  const normalizedEmail = normalizeEmail(user.email)
  if (!normalizedEmail) return null

  const invitationQuery = {
    recipientEmail: normalizedEmail,
    provisionedCustomerId: customerId,
    provisionedUserId: user._id,
    assignCustomerAdminOnComplete: false,
    status: { $in: ACTIVE_INVITATION_STATUSES },
  }

  const existingInvitation = await Invitation.findOne(invitationQuery)
    .select('+tokenHash +assignCustomerAdminOnComplete')
    .sort({ createdAt: -1 })

  const { raw, hash } = Invitation.generateToken()
  const authLink = invitationService.buildAuthLink(raw)
  const now = new Date()

  if (existingInvitation) {
    const previousStatus = existingInvitation.status
    const resendCount = Number(existingInvitation.resendCount) || 0

    existingInvitation.tokenHash = hash
    existingInvitation.status = 'sent'
    existingInvitation.sentAt = now
    existingInvitation.resendCount = resendCount + 1
    existingInvitation.lastResentAt = now
    existingInvitation.expiresAt = invitationService.computeExpiryDate()
    existingInvitation.accessedAt = undefined
    existingInvitation.sendFailureReason = undefined
    existingInvitation.sendFailedAt = undefined
    existingInvitation.assignCustomerAdminOnComplete = false

    if (!existingInvitation.provisionedCustomerId) {
      existingInvitation.provisionedCustomerId = customerId
    }
    if (!existingInvitation.provisionedUserId) {
      existingInvitation.provisionedUserId = user._id
    }

    await existingInvitation.save()

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.INVITATION_RESENT,
      resourceType: auditService.RESOURCE_TYPES.Invitation,
      resourceId: existingInvitation._id,
      scope: { customerId },
      diff: {
        status: { from: previousStatus, to: existingInvitation.status },
        resendCount: existingInvitation.resendCount,
        source,
      },
    })

    return {
      invitationId: toIdString(existingInvitation._id),
      authLink,
      status: existingInvitation.status,
    }
  }

  const resolvedCustomer = customer || (customerId ? await Customer.findById(customerId) : null)
  const fallbackName = normalizedEmail.split('@')[0] || 'Invited User'
  const invitation = await Invitation.create({
    recipientEmail: normalizedEmail,
    recipientName: String(user.name || fallbackName).trim(),
    company: {
      name: String(resolvedCustomer?.name || 'Customer Workspace').trim(),
      ...(resolvedCustomer?.website ? { website: resolvedCustomer.website } : {}),
    },
    status: 'sent',
    tokenHash: hash,
    expiresAt: invitationService.computeExpiryDate(),
    sentAt: now,
    createdBy: req.userId || user._id,
    provisionedCustomerId: customerId,
    provisionedUserId: user._id,
    assignCustomerAdminOnComplete: false,
  })

  await auditService.logFromRequest(req, {
    action: auditService.AUDIT_ACTIONS.INVITATION_CREATED,
    resourceType: auditService.RESOURCE_TYPES.Invitation,
    resourceId: invitation._id,
    scope: { customerId },
    diff: {
      status: { from: null, to: invitation.status },
      recipientEmail: invitation.recipientEmail,
      source,
    },
  })

  return {
    invitationId: toIdString(invitation._id),
    authLink,
    status: invitation.status,
  }
}

const buildUserAlreadyExistsDetails = ({ existingUser, customerId }) => {
  const existingCustomerIds = listCustomerMembershipIds(existingUser)
  const inTargetCustomer = existingCustomerIds.includes(customerId)
  const hasOtherCustomerMembership = existingCustomerIds.some((id) => id !== customerId)

  let reason = 'existing-identity'
  if (inTargetCustomer) reason = 'already-in-customer'
  else if (hasOtherCustomerMembership) reason = 'other-customer'

  return {
    reason,
    existingUserId: toIdString(existingUser?._id),
    existingCustomerIds,
    targetCustomerId: customerId,
  }
}

const buildValidationErrorResponse = ({ req, message, details }) => ({
  error: {
    code: 'VALIDATION_FAILED',
    message,
    ...(details ? { details } : {}),
    requestId: req.requestId,
  },
})

const buildInvalidCustomerMembershipResponse = (req) =>
  buildValidationErrorResponse({
    req,
    message: 'User has an invalid customer membership reference.',
    details: {
      reason: USER_LIFECYCLE_REASONS.INVALID_CUSTOMER_MEMBERSHIP,
    },
  })

const buildUserNotFoundResponse = (req) => ({
  error: {
    code: 'NOT_FOUND',
    message: 'User not found.',
    requestId: req.requestId,
  },
})

const resolveUserCustomerContext = ({ req, user }) => {
  const scopedCustomerId = toIdString(req.params?.customerId)

  if (scopedCustomerId) {
    const membership = resolveCustomerMembership(user, scopedCustomerId)
    if (!membership) return null

    return {
      customerId: scopedCustomerId,
      rawCustomerId: membership.customerId || scopedCustomerId,
      membership,
      isCustomerScoped: true,
    }
  }

  const membership =
    (user?.memberships || []).find((candidate) => candidate?.customerId !== null) || null

  return {
    customerId: toIdString(membership?.customerId),
    rawCustomerId: membership?.customerId || null,
    membership,
    isCustomerScoped: false,
  }
}

const buildForbiddenResponse = ({ req, message, details }) => ({
  error: {
    code: 'FORBIDDEN',
    message,
    ...(details ? { details } : {}),
    requestId: req.requestId,
  },
})

const isTenantAdminOnlyCustomerAccess = (req) => {
  const customerAccess = req.scopes?.customerAccess
  return Boolean(
    customerAccess?.isTenantAdmin
      && !customerAccess?.isCustomerAdmin
      && !customerAccess?.isSuperAdmin,
  )
}

const resolveTenantAdminManagedTenantIds = ({ req, customerId }) => {
  const scopedTenantIds = Array.from(
    new Set(
      (req.scopes?.customerAccess?.tenantAdminTenantIds || [])
        .map((tenantId) => toIdString(tenantId))
        .filter(Boolean),
    ),
  )
  if (scopedTenantIds.length > 0) return scopedTenantIds

  if (!customerId) return []

  return Array.from(
    new Set(
      (req.scopes?.tenantMemberships || [])
        .filter((membership) =>
          toIdString(membership?.customerId) === toIdString(customerId)
          && Array.isArray(membership?.roles)
          && membership.roles.includes('TENANT_ADMIN'),
        )
        .map((membership) => toIdString(membership?.tenantId))
        .filter(Boolean),
    ),
  )
}

const buildUserAlreadyExistsResponse = ({ req, existingUser, customerId }) => ({
  error: {
    code: 'USER_ALREADY_EXISTS',
    message: 'A user with this email already exists. Use existing-user assignment path.',
    details: buildUserAlreadyExistsDetails({ existingUser, customerId }),
    requestId: req.requestId,
  },
})

const resetIdentityPlusForEmailChange = (user) => {
  if (!user.identityPlus || typeof user.identityPlus !== 'object') {
    user.identityPlus = {}
  }

  const previousIdentityPlus = {
    trustStatus: user.identityPlus.trustStatus || null,
    externalId: user.identityPlus.externalId || null,
    invitedAt: user.identityPlus.invitedAt || null,
    trustedAt: user.identityPlus.trustedAt || null,
  }
  const nextTrustStatus = user.isActive ? 'UNTRUSTED' : 'REVOKED'

  user.identityPlus.trustStatus = nextTrustStatus
  user.identityPlus.externalId = null
  user.identityPlus.invitedAt = null
  user.identityPlus.trustedAt = null

  return {
    previousIdentityPlus,
    nextIdentityPlus: {
      trustStatus: nextTrustStatus,
      externalId: null,
      invitedAt: null,
      trustedAt: null,
    },
  }
}

const upsertCustomerTenantVisibility = ({ user, customerId, tenantVisibility }) => {
  if (tenantVisibility === undefined) {
    return null
  }

  const targetCustomerId = toIdString(customerId)
  const existingTenantMemberships = (user?.tenantMemberships || []).filter(
    (membership) => toIdString(membership?.customerId) === targetCustomerId,
  )
  const previousTenantVisibility = existingTenantMemberships
    .map((membership) => toIdString(membership?.tenantId))
    .filter(Boolean)
  const nextTenantVisibility = tenantVisibility
    .map((tenantId) => toIdString(tenantId))
    .filter(Boolean)

  if (arraysEqual(previousTenantVisibility, nextTenantVisibility)) {
    return {
      changed: false,
      previousTenantVisibility,
      nextTenantVisibility,
    }
  }

  user.tenantMemberships = (user.tenantMemberships || []).filter(
    (membership) => toIdString(membership?.customerId) !== targetCustomerId,
  )

  nextTenantVisibility.forEach((tenantId) => {
    user.tenantMemberships.push({
      customerId: targetCustomerId,
      tenantId,
      roles: ['USER'],
    })
  })

  return {
    changed: true,
    previousTenantVisibility,
    nextTenantVisibility,
  }
}

const buildGovernanceErrorResponse = (req, err) => ({
  error: {
    code: err.code || (err.status === 409 ? 'CONFLICT' : 'VALIDATION_FAILED'),
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
    requestId: req.requestId,
  },
})

/* ------------------------------------------------------------------ */
/*  GET /api/v1/customers/:customerId/users                           */
/* ------------------------------------------------------------------ */

/**
 * List users belonging to a customer.
 *
 * Query params: q (search name/email), role, status, page, pageSize
 */
export const listUsers = async (req, res, next) => {
  try {
    const { customerId } = req.params
    const {
      q,
      role,
      status,
      page = 1,
      pageSize = 20,
    } = req.query

    const filter = role
      ? { memberships: { $elemMatch: { customerId, roles: role } } }
      : { 'memberships.customerId': customerId }

    const activeFilter = normalizeStatusFilter(status)
    if (activeFilter !== null) filter.isActive = activeFilter

    if (q) {
      const escaped = escapeRegex(q)
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
      ]
    }

    const pageNum = Math.max(1, Number(page) || 1)
    const limit = Math.min(100, Math.max(1, Number(pageSize) || 20))
    const skip = (pageNum - 1) * limit

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ])

    const canonicalAdminUserId = toIdString(req.scopes?.customer?.governance?.customerAdminUserId)
    const data = users.map((user) => mapCustomerScopedUser({ user, customerId, canonicalAdminUserId }))

    return res.status(200).json({
      data,
      meta: {
        page: pageNum,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
        filters: {
          q: q || null,
          role: role || null,
          status: status || null,
        },
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/customers/:customerId/users                          */
/* ------------------------------------------------------------------ */

/**
 * Create/invite a new user or assign roles to an existing user.
 */
export const createUser = async (req, res, next) => {
  try {
    const { customerId } = req.params
    const {
      existingUserId,
      name,
      email,
      roles,
      tenantVisibility,
    } = req.body
    const normalizedRoles = normalizeRoleList(roles)

    // 1. Verify customer exists
    const customer = req.scopes?.customer || await Customer.findById(customerId)
    if (!customer) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Customer not found.',
          requestId: req.requestId,
        },
      })
    }

    // 2. Validate tenant visibility IDs belong to this customer
    const tenantVisibilityValidation = await validateTenantVisibilityPayload({
      req,
      customer,
      customerId,
      tenantVisibility,
    })
    if (tenantVisibilityValidation) {
      return res.status(422).json(tenantVisibilityValidation)
    }

    // Existing-user assignment path (no invitation dispatch)
    if (existingUserId) {
      const user = await User.findById(existingUserId)
      if (!user) {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'User not found.',
            requestId: req.requestId,
          },
        })
      }

      if (!user.isActive) {
        return res.status(422).json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Cannot assign roles to an inactive user.',
            requestId: req.requestId,
          },
        })
      }

      const membershipCustomerIds = listCustomerMembershipIds(user)
      const hasTargetMembership = membershipCustomerIds.includes(customerId)
      const conflictingCustomerIds = membershipCustomerIds.filter((id) => id !== customerId)

      if (!hasTargetMembership && conflictingCustomerIds.length > 0) {
        return res.status(409).json({
          error: {
            code: 'USER_CUSTOMER_CONFLICT',
            message: 'Selected user belongs to another customer and cannot be assigned here.',
            details: {
              reason: 'other-customer',
              existingUserId: toIdString(user._id),
              existingCustomerIds: conflictingCustomerIds,
              targetCustomerId: customerId,
            },
            requestId: req.requestId,
          },
        })
      }

      const previousCanonicalAdminUserId = toIdString(customer.governance?.customerAdminUserId)
      let membership = resolveCustomerMembership(user, customerId)
      const previousRoles = normalizeRoleList(membership?.roles || [])
      let userChanged = false
      let customerGovernanceChanged = false
      let createdMembership = false

      if (membership) {
        const governanceDecision = customerGovernanceService.validateUserRoleUpdate({
          customer,
          user,
          nextRoles: normalizedRoles,
        })

        if (!arraysEqual(previousRoles, normalizedRoles)) {
          membership.roles = normalizedRoles
          userChanged = true
        }

        if (governanceDecision.shouldSetCanonicalAdminUserId) {
          customer.governance = {
            ...(customer.governance || {}),
            customerAdminUserId: user._id,
          }
          customerGovernanceChanged = true
        }

        if (governanceDecision.shouldClearCanonicalAdminUserId) {
          customer.governance = {
            ...(customer.governance || {}),
            customerAdminUserId: null,
          }
          customerGovernanceChanged = true
        }
      } else if (normalizedRoles.includes(customerGovernanceService.CUSTOMER_ADMIN_ROLE)) {
        await customerGovernanceService.applyCustomerAdminAssignment({
          customer,
          user,
        })
        membership = resolveCustomerMembership(user, customerId)
        createdMembership = true
        if (membership && !arraysEqual(normalizeRoleList(membership.roles || []), normalizedRoles)) {
          membership.roles = normalizedRoles
          userChanged = true
        }
      } else {
        user.memberships.push({
          customerId,
          roles: normalizedRoles,
        })
        createdMembership = true
        userChanged = true
      }

      const tenantVisibilityResult = upsertCustomerTenantVisibility({
        user,
        customerId,
        tenantVisibility,
      })
      if (tenantVisibilityResult?.changed) {
        userChanged = true
      }

      if (userChanged) {
        await user.save()
      }

      const nextCanonicalAdminUserId = toIdString(customer.governance?.customerAdminUserId)
      if (nextCanonicalAdminUserId !== previousCanonicalAdminUserId) {
        customerGovernanceChanged = true
      }

      if (customerGovernanceChanged) {
        await customer.save()
      }

      await Promise.all([
        performanceCacheService.invalidateUserPermissions(user._id),
        ...(customerGovernanceChanged
          ? [performanceCacheService.invalidateCustomerTopology(customer._id)]
          : []),
      ])

      await auditService.logFromRequest(req, {
        action: 'USER_ROLE_UPDATED',
        resourceType: 'User',
        resourceId: user._id,
        scope: { customerId },
        diff: {
          source: 'existing_user_assignment',
          existingUserId: toIdString(user._id),
          createdMembership,
          roles: {
            from: previousRoles,
            to: normalizedRoles,
          },
          ...(tenantVisibilityResult
            ? {
                tenantVisibility: {
                  from: tenantVisibilityResult.previousTenantVisibility,
                  to: tenantVisibilityResult.nextTenantVisibility,
                },
              }
            : {}),
          ...(nextCanonicalAdminUserId
            ? { canonicalAdminUserId: nextCanonicalAdminUserId }
            : {}),
        },
      })

      if (customerGovernanceChanged) {
        await auditService.logFromRequest(req, {
          action: 'CUSTOMER_ADMIN_CANONICAL_SET',
          resourceType: 'Customer',
          resourceId: customer._id,
          scope: { customerId },
          diff: {
            from: previousCanonicalAdminUserId,
            to: nextCanonicalAdminUserId,
            source: 'existing_user_assignment',
          },
        })
      }

      return res.status(200).json({
        data: {
          ...mapCustomerScopedUser({
            user,
            customerId,
            canonicalAdminUserId: nextCanonicalAdminUserId,
          }),
          outcome: 'assigned_existing',
          invitationDispatched: false,
          invitationOutcome: 'none',
          customerId,
          canonicalAdminUserId: nextCanonicalAdminUserId,
        },
        meta: { requestId: req.requestId, version: 'v1' },
      })
    }

    // 3. Check for duplicate identity on create/invite path
    const normalizedEmail = normalizeEmail(email)
    const existing = await User.findOne({ email: normalizedEmail })
    if (existing) {
      return res.status(409).json({
        error: {
          code: 'USER_ALREADY_EXISTS',
          message: 'A user with this email already exists. Use existing-user assignment path.',
          details: buildUserAlreadyExistsDetails({ existingUser: existing, customerId }),
          requestId: req.requestId,
        },
      })
    }

    // 4. Create user with customer membership
    const user = new User({
      name,
      email: normalizedEmail,
      isActive: true,
      identityPlus: { trustStatus: 'UNTRUSTED' },
      memberships: [{ customerId, roles: normalizedRoles }],
      tenantMemberships: (tenantVisibility || []).map((tenantId) => ({
        customerId,
        tenantId,
        roles: ['USER'],
      })),
    })

    await applyManualTestPasswordBootstrap({
      user,
      source: 'customer_admin_create_user',
    })

    const requestsCustomerAdminRole = normalizedRoles.includes(
      customerGovernanceService.CUSTOMER_ADMIN_ROLE,
    )

    let canonicalAdminUserId = null
    if (requestsCustomerAdminRole) {
      const assignment = await customerGovernanceService.applyCustomerAdminAssignment({
        customer,
        user,
      })
      canonicalAdminUserId = assignment.canonicalAdminUserId
      await performanceCacheService.invalidateCustomerTopology(customer._id)
    } else {
      await user.save()
    }

    await performanceCacheService.invalidateUserPermissions(user._id)

    // 5. Send Identity Plus invitation
    let invitationResult = null
    let invitationOutcome = 'sent'
    let fakeAuthInvitation = null
    try {
      invitationResult = await identityPlusService.sendInvitation({
        email: normalizedEmail,
        customerId,
      })

      // Update user with Identity Plus external ID
      if (invitationResult?.externalId) {
        user.identityPlus.externalId = invitationResult.externalId
        user.identityPlus.invitedAt = invitationResult.invitedAt || new Date()
        await user.save()
        await performanceCacheService.invalidateUserPermissions(user._id)
      }
    } catch (invErr) {
      // Invitation failure is non-fatal — user is still created
      logger.warn(
        { err: invErr, email, customerId },
          'Identity Plus invitation failed; user created without invitation',
        )
      invitationOutcome = 'send_failed'
    }
    await performanceCacheService.invalidateUserPermissions(user._id)

    if (env.fakeAuthAllowed) {
      try {
        fakeAuthInvitation = await upsertFakeAuthInvitationForCustomerUser({
          req,
          customer,
          customerId,
          user,
          source: 'customer_admin_create_user',
        })
      } catch (fakeAuthErr) {
        logger.warn(
          { err: fakeAuthErr, userId: user._id, customerId, email: normalizedEmail },
          'fake auth invitation setup failed for customer-admin user create',
        )
      }
    }

    // 6. Audit log
    await auditService.logFromRequest(req, {
      action: 'USER_CREATED',
      resourceType: 'User',
      resourceId: user._id,
      scope: { customerId },
      diff: {
        name,
        email: normalizedEmail,
        roles: normalizedRoles,
        tenantVisibility,
        outcome: 'invited_new',
        invitationOutcome,
        ...(fakeAuthInvitation?.invitationId
          ? { fakeAuthInvitationId: fakeAuthInvitation.invitationId }
          : {}),
        ...(canonicalAdminUserId ? { canonicalAdminUserId } : {}),
      },
    })

    if (canonicalAdminUserId) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_ADMIN_CANONICAL_SET',
        resourceType: 'Customer',
        resourceId: customerId,
        scope: { customerId },
        diff: {
          from: null,
          to: canonicalAdminUserId,
          source: 'create_user',
        },
      })
    }

    if (invitationResult) {
      await auditService.logFromRequest(req, {
        action: 'USER_INVITED',
        resourceType: 'User',
        resourceId: user._id,
        scope: { customerId },
        diff: { email: normalizedEmail, externalId: invitationResult.externalId },
      })
    }

    const nextCanonicalAdminUserId = toIdString(customer.governance?.customerAdminUserId)
    return res.status(201).json({
      data: {
        ...mapCustomerScopedUser({
          user,
          customerId,
          canonicalAdminUserId: nextCanonicalAdminUserId,
        }),
        outcome: 'invited_new',
        invitationDispatched: invitationOutcome === 'sent',
        invitationOutcome,
        customerId,
        canonicalAdminUserId: nextCanonicalAdminUserId,
        ...(fakeAuthInvitation?.authLink
          ? {
              authLink: fakeAuthInvitation.authLink,
              invitationId: fakeAuthInvitation.invitationId,
            }
          : {}),
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (customerGovernanceService.isGovernanceError(err)) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_ADMIN_MUTATION_BLOCKED',
        resourceType: 'Customer',
        resourceId: req.params.customerId,
        scope: { customerId: req.params.customerId },
        diff: {
          endpoint: 'create_user',
          reason: err.message,
          details: err.details || null,
          requestedRoles: req.body?.roles || [],
        },
      })
      return res
        .status(err.status || 422)
        .json(buildGovernanceErrorResponse(req, err))
    }
    if (err.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  GET /api/v1/customers/:customerId/users/:userId                   */
/* ------------------------------------------------------------------ */

/**
 * Get a single user by ID within a customer scope.
 */
export const getUser = async (req, res, next) => {
  try {
    const { customerId, userId } = req.params

    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    const customerContext = resolveUserCustomerContext({ req, user })

    if (req.params.customerId && !customerContext) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    // Ensure user belongs to this customer
    const belongsToCustomer = user.memberships.some(
      (m) => m.customerId && m.customerId.toString() === customerId,
    )

    if (!belongsToCustomer) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found.',
          requestId: req.requestId,
        },
      })
    }

    const canonicalAdminUserId = toIdString(req.scopes?.customer?.governance?.customerAdminUserId)

    return res.status(200).json({
      data: mapCustomerScopedUser({ user, customerId, canonicalAdminUserId }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/v1/users/:userId                                       */
/* ------------------------------------------------------------------ */

/**
 * Update user — name, email, roles, tenant visibility.
 *
 * The caller must have Customer Admin access to the customer the user
 * belongs to.  The customerId is resolved from the user's memberships.
 */
export const updateUser = async (req, res, next) => {
  try {
    const { userId } = req.params
    const { name, email, roles, tenantVisibility } = req.body

    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    const diff = {}
    let customerForRoleUpdate = null
    let customerGovernanceChanged = false
    let staleIdentityToRevoke = null
    const customerContext = resolveUserCustomerContext({ req, user })

    if (req.params.customerId && !customerContext) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    const primaryMembership = user.memberships.find((m) => m.customerId !== null)
    const responseCustomerId = customerContext?.customerId || toIdString(primaryMembership?.customerId)
    const tenantAdminOnly = isTenantAdminOnlyCustomerAccess(req)

    if (tenantAdminOnly) {
      const disallowedFields = ['name', 'email', 'roles'].filter(
        (field) => req.body[field] !== undefined,
      )

      if (disallowedFields.length > 0 || tenantVisibility === undefined) {
        return res.status(403).json(
          buildForbiddenResponse({
            req,
            message: 'Tenant admins can only update tenant visibility in this workspace.',
            details: {
              reason: 'TENANT_ADMIN_UPDATE_SCOPE_RESTRICTED',
              allowedFields: ['tenantVisibility'],
              ...(disallowedFields.length > 0 ? { disallowedFields } : {}),
            },
          }),
        )
      }
    }

    // Update name
    if (name !== undefined) {
      diff.name = { from: user.name, to: name }
      user.name = name
    }

    // Update email and invalidate the previous identity binding.
    if (email !== undefined) {
      const normalizedEmail = normalizeEmail(email)
      const currentEmail = normalizeEmail(user.email)

      if (normalizedEmail !== currentEmail) {
        const existing = await User.findOne({ email: normalizedEmail })
        if (existing && toIdString(existing._id) !== toIdString(user._id)) {
          return res.status(409).json(
            buildUserAlreadyExistsResponse({
              req,
              existingUser: existing,
              customerId: responseCustomerId,
            }),
          )
        }

        const previousEmail = user.email
        const identityReset = resetIdentityPlusForEmailChange(user)

        user.email = normalizedEmail
        staleIdentityToRevoke = {
          email: previousEmail,
          externalId: identityReset.previousIdentityPlus.externalId,
        }

        diff.email = { from: previousEmail, to: normalizedEmail }
        diff.identityPlus = {
          from: identityReset.previousIdentityPlus,
          to: identityReset.nextIdentityPlus,
          reason: 'EMAIL_CHANGED',
        }
      }
    }

    // Update roles on customer memberships
    if (roles !== undefined) {
      const membership =
        customerContext?.membership ||
        user.memberships.find((m) => m.customerId !== null)
      if (membership) {
        customerForRoleUpdate = await Customer.findById(membership.customerId)
        if (!customerForRoleUpdate) {
          return res.status(422).json(buildInvalidCustomerMembershipResponse(req))
        }

        const governanceDecision = customerGovernanceService.validateUserRoleUpdate({
          customer: customerForRoleUpdate,
          user,
          nextRoles: roles,
        })

        diff.roles = { from: [...membership.roles], to: roles }
        membership.roles = roles

        if (governanceDecision.shouldSetCanonicalAdminUserId) {
          const previousCanonicalAdminUserId = customerForRoleUpdate.governance?.customerAdminUserId || null
          customerForRoleUpdate.governance = {
            ...(customerForRoleUpdate.governance || {}),
            customerAdminUserId: user._id,
          }
          customerGovernanceChanged = true
          diff.customerAdminUserId = {
            from: previousCanonicalAdminUserId,
            to: user._id,
          }
        }

        if (governanceDecision.shouldClearCanonicalAdminUserId) {
          const previousCanonicalAdminUserId = customerForRoleUpdate.governance?.customerAdminUserId || null
          customerForRoleUpdate.governance = {
            ...(customerForRoleUpdate.governance || {}),
            customerAdminUserId: null,
          }
          customerGovernanceChanged = true
          diff.customerAdminUserId = {
            from: previousCanonicalAdminUserId,
            to: null,
          }
        }
      }
    }

    // Update tenant visibility (tenantMemberships)
    if (tenantVisibility !== undefined) {
      const customerId = customerContext?.rawCustomerId || primaryMembership?.customerId

      if (customerId) {
        const normalizedCustomerId = toIdString(customerId)
        const customerForTenantVisibility = customerForRoleUpdate || await Customer.findById(customerId)
        if (!customerForTenantVisibility) {
          return res.status(422).json(buildInvalidCustomerMembershipResponse(req))
        }

        const normalizedRequestedTenantVisibility = Array.from(
          new Set(
            (tenantVisibility || [])
              .map((tenantId) => toIdString(tenantId))
              .filter(Boolean),
          ),
        )

        if (tenantAdminOnly) {
          const managedTenantIds = Array.from(
            new Set(
              (await Tenant.find({
                customerId,
                tenantAdminUserIds: req.context?.userId || req.userId,
              }).select('_id').lean())
                .map((tenant) => toIdString(tenant?._id || tenant?.id))
                .filter(Boolean),
            ),
          )

          const managedTenantIdSet = new Set([
            ...resolveTenantAdminManagedTenantIds({ req, customerId }),
            ...managedTenantIds,
          ])

          if (managedTenantIdSet.size === 0) {
            return res.status(403).json(
              buildForbiddenResponse({
                req,
                message: 'Tenant admin scope is not configured for this customer.',
                details: {
                  reason: 'TENANT_ADMIN_SCOPE_EMPTY',
                },
              }),
            )
          }

          const outOfScopeTenantIds = normalizedRequestedTenantVisibility.filter(
            (tenantId) => !managedTenantIdSet.has(tenantId),
          )

          if (outOfScopeTenantIds.length > 0) {
            return res.status(422).json(buildTenantVisibilityErrorResponse({
              req,
              customer: customerForTenantVisibility,
              reason: TENANT_VISIBILITY_REASONS.INVALID_TENANT_IDS,
              invalidTenantIds: outOfScopeTenantIds,
              message: 'One or more tenant IDs are outside your tenant-admin scope.',
            }))
          }

          const existingTenantVisibility = (user.tenantMemberships || [])
            .filter((tm) => toIdString(tm.customerId) === normalizedCustomerId)
            .map((tm) => toIdString(tm.tenantId))
            .filter(Boolean)

          const preservedOutOfScopeTenantIds = existingTenantVisibility.filter(
            (tenantId) => !managedTenantIdSet.has(tenantId),
          )

          tenantVisibility.splice(
            0,
            tenantVisibility.length,
            ...Array.from(
              new Set([
                ...preservedOutOfScopeTenantIds,
                ...normalizedRequestedTenantVisibility,
              ]),
            ),
          )
        }

        const tenantVisibilityValidation = await validateTenantVisibilityPayload({
          req,
          customer: customerForTenantVisibility,
          customerId,
          tenantVisibility,
        })
        if (tenantVisibilityValidation) {
          return res.status(422).json(tenantVisibilityValidation)
        }

        customerForRoleUpdate = customerForRoleUpdate || customerForTenantVisibility

        // Validate tenant IDs belong to this customer
        diff.tenantVisibility = {
          from: user.tenantMemberships
            .filter((tm) => toIdString(tm.customerId) === normalizedCustomerId)
            .map((tm) => toIdString(tm.tenantId))
            .filter(Boolean),
          to: tenantVisibility.map((tenantId) => toIdString(tenantId)).filter(Boolean),
        }

        // Remove existing tenantMemberships for this customer
        user.tenantMemberships = user.tenantMemberships.filter(
          (tm) => toIdString(tm.customerId) !== normalizedCustomerId,
        )

        // Add new tenantMemberships
        for (const tenantId of tenantVisibility) {
          user.tenantMemberships.push({
            customerId,
            tenantId,
            roles: ['USER'],
          })
        }
      }
    }

    await user.save()
    await performanceCacheService.invalidateUserPermissions(user._id)
    if (staleIdentityToRevoke?.externalId || staleIdentityToRevoke?.email) {
      try {
        await identityPlusService.revokeTrust(staleIdentityToRevoke)
      } catch (revokeErr) {
        logger.warn(
          { err: revokeErr, userId, staleIdentityToRevoke },
          'Identity Plus revokeTrust failed after user email change; local identity reset preserved',
        )
      }
    }
    if (customerGovernanceChanged && customerForRoleUpdate) {
      await customerForRoleUpdate.save()
      await performanceCacheService.invalidateCustomerTopology(customerForRoleUpdate._id)
    }

    // Audit log
    await auditService.logFromRequest(req, {
      action: 'USER_ROLE_UPDATED',
      resourceType: 'User',
      resourceId: user._id,
      scope: {
        customerId:
          customerContext?.rawCustomerId ||
          user.memberships.find((m) => m.customerId !== null)?.customerId,
      },
      diff,
    })

    if (diff.customerAdminUserId && customerForRoleUpdate) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_ADMIN_CANONICAL_SET',
        resourceType: 'Customer',
        resourceId: customerForRoleUpdate._id,
        scope: { customerId: customerForRoleUpdate._id },
        diff: {
          ...diff.customerAdminUserId,
          source: 'update_user_roles',
        },
      })
    }

    const responseCustomer = responseCustomerId && !customerForRoleUpdate
      ? await Customer.findById(responseCustomerId)
      : customerForRoleUpdate

    return res.status(200).json({
      data: responseCustomerId
        ? mapCustomerScopedUser({
            user,
            customerId: responseCustomerId,
            canonicalAdminUserId: toIdString(responseCustomer?.governance?.customerAdminUserId),
          })
        : user.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (customerGovernanceService.isGovernanceError(err)) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_ADMIN_MUTATION_BLOCKED',
        resourceType: 'User',
        resourceId: req.params.userId,
        scope: {},
        diff: {
          endpoint: 'update_user',
          reason: err.message,
          details: err.details || null,
          requestedRoles: req.body?.roles || null,
        },
      })
      return res
        .status(err.status || 422)
        .json(buildGovernanceErrorResponse(req, err))
    }
    if (err.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/users/:userId/enable                                 */
/* ------------------------------------------------------------------ */

/**
 * Reactivate a disabled user.
 * If trust has been revoked, move to UNTRUSTED so invitation resend flow can recover access.
 */
export const enableUser = async (req, res, next) => {
  try {
    const { userId } = req.params

    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    const customerContext = resolveUserCustomerContext({ req, user })

    if (req.params.customerId && !customerContext) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    if (user.isActive) {
      return res.status(422).json(
        buildValidationErrorResponse({
          req,
          message: 'User is already active.',
          details: {
            reason: USER_LIFECYCLE_REASONS.ALREADY_ACTIVE,
            status: 'ACTIVE',
            trustStatus: user.identityPlus?.trustStatus || null,
          },
        }),
      )
    }

    const previousTrustStatus = user.identityPlus?.trustStatus || null

    user.isActive = true
    if (!user.identityPlus || typeof user.identityPlus !== 'object') {
      user.identityPlus = {}
    }
    if (user.identityPlus.trustStatus === 'REVOKED') {
      user.identityPlus.trustStatus = 'UNTRUSTED'
    }

    const nextTrustStatus = user.identityPlus?.trustStatus || null

    await user.save()
    await performanceCacheService.invalidateUserPermissions(user._id)

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.USER_ENABLED,
      resourceType: 'User',
      resourceId: user._id,
      scope: {
        customerId:
          customerContext?.rawCustomerId ||
          user.memberships.find((m) => m.customerId !== null)?.customerId,
      },
      diff: {
        isActive: { from: false, to: true },
        ...(previousTrustStatus !== nextTrustStatus
          ? { trustStatus: { from: previousTrustStatus, to: nextTrustStatus } }
          : {}),
      },
    })

    return res.status(200).json({
      data: customerContext?.isCustomerScoped
        ? mapCustomerScopedUser({
            user,
            customerId: customerContext.customerId,
            canonicalAdminUserId: toIdString(req.scopes?.customer?.governance?.customerAdminUserId),
          })
        : user.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/users/:userId/disable                                */
/* ------------------------------------------------------------------ */

/**
 * Disable a user:
 *   1. Sets isActive = false
 *   2. Sets trustStatus = REVOKED
 *   3. Calls Identity Plus revokeTrust
 *   4. Logs audit
 */
export const disableUser = async (req, res, next) => {
  try {
    const { userId } = req.params

    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    const customerContext = resolveUserCustomerContext({ req, user })

    if (req.params.customerId && !customerContext) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    if (!user.isActive) {
      return res.status(422).json(
        buildValidationErrorResponse({
          req,
          message: 'User is already disabled.',
          details: {
            reason: USER_LIFECYCLE_REASONS.ALREADY_DISABLED,
            status: 'INACTIVE',
            trustStatus: user.identityPlus?.trustStatus || null,
          },
        }),
      )
    }

    await customerGovernanceService.assertUserCanBeDisabledOrDeleted({
      user,
      operation: 'disable',
    })

    // 1. Disable user + revoke trust
    user.isActive = false
    user.identityPlus.trustStatus = 'REVOKED'
    await user.save()
    await performanceCacheService.invalidateUserPermissions(user._id)

    // 2. Call Identity Plus to revoke trust
    try {
      await identityPlusService.revokeTrust({
        externalId: user.identityPlus.externalId,
        email: user.email,
      })
    } catch (revokeErr) {
      logger.warn(
        { err: revokeErr, userId, email: user.email },
        'Identity Plus revokeTrust failed; user disabled locally',
      )
    }

    // 3. Audit log
    await auditService.logFromRequest(req, {
      action: 'USER_DISABLED',
      resourceType: 'User',
      resourceId: user._id,
      scope: {
        customerId:
          customerContext?.rawCustomerId ||
          user.memberships.find((m) => m.customerId !== null)?.customerId,
      },
      diff: {
        isActive: { from: true, to: false },
        trustStatus: { from: 'TRUSTED', to: 'REVOKED' },
      },
    })

    return res.status(200).json({
      data: customerContext?.isCustomerScoped
        ? mapCustomerScopedUser({
            user,
            customerId: customerContext.customerId,
            canonicalAdminUserId: toIdString(req.scopes?.customer?.governance?.customerAdminUserId),
          })
        : user.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (customerGovernanceService.isGovernanceError(err)) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_ADMIN_MUTATION_BLOCKED',
        resourceType: 'User',
        resourceId: req.params.userId,
        scope: {},
        diff: {
          endpoint: 'disable_user',
          reason: err.message,
          details: err.details || null,
        },
      })
      return res
        .status(err.status || 422)
        .json(buildGovernanceErrorResponse(req, err))
    }
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/v1/users/:userId                                      */
/* ------------------------------------------------------------------ */

/**
 * Permanently delete a user.
 * Only disabled users can be deleted.
 */
export const deleteUser = async (req, res, next) => {
  try {
    const { userId } = req.params

    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    const customerContext = resolveUserCustomerContext({ req, user })

    if (req.params.customerId && !customerContext) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    if (user.isActive) {
      return res.status(422).json(
        buildValidationErrorResponse({
          req,
          message: 'Only disabled users can be deleted. Disable the user first.',
          details: {
            reason: USER_LIFECYCLE_REASONS.DELETE_REQUIRES_DISABLED,
            status: 'ACTIVE',
            trustStatus: user.identityPlus?.trustStatus || null,
          },
        }),
      )
    }

    await customerGovernanceService.assertUserCanBeDisabledOrDeleted({
      user,
      operation: 'delete',
    })

    // Capture info before deletion for audit
    const userSnapshot = {
      id: user._id,
      email: user.email,
      name: user.name,
      customerId:
        customerContext?.rawCustomerId ||
        user.memberships.find((m) => m.customerId !== null)?.customerId,
    }

    // Remove user from tenant admin arrays
    try {
      await Tenant.updateMany(
        { tenantAdminUserIds: user._id },
        { $pull: { tenantAdminUserIds: user._id } },
      )
    } catch (pullErr) {
      logger.warn(
        { err: pullErr, userId },
        'Failed to remove user from tenant admin arrays',
      )
    }

    // Delete user document
    await performanceCacheService.invalidateUserPermissions(user._id)
    await User.deleteOne({ _id: user._id })

    // Audit log
    await auditService.logFromRequest(req, {
      action: 'USER_DELETED',
      resourceType: 'User',
      resourceId: userSnapshot.id,
      scope: { customerId: userSnapshot.customerId },
      diff: { email: userSnapshot.email, name: userSnapshot.name },
    })

    return res.status(200).json({
      data: { message: 'User permanently deleted.', userId: userSnapshot.id },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (customerGovernanceService.isGovernanceError(err)) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_ADMIN_MUTATION_BLOCKED',
        resourceType: 'User',
        resourceId: req.params.userId,
        scope: {},
        diff: {
          endpoint: 'delete_user',
          reason: err.message,
          details: err.details || null,
        },
      })
      return res
        .status(err.status || 422)
        .json(buildGovernanceErrorResponse(req, err))
    }
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/users/:userId/resend-invitation                      */
/* ------------------------------------------------------------------ */

/**
 * Resend an Identity Plus invitation for a user whose
 * trust status is still UNTRUSTED.
 */
export const resendInvitation = async (req, res, next) => {
  try {
    const { userId } = req.params
    const { redirectUrl } = req.body

    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    const customerContext = resolveUserCustomerContext({ req, user })

    if (req.params.customerId && !customerContext) {
      return res.status(404).json(buildUserNotFoundResponse(req))
    }

    if (!user.isActive) {
      return res.status(422).json(
        buildValidationErrorResponse({
          req,
          message: 'Cannot resend invitation to a disabled user.',
          details: {
            reason: USER_LIFECYCLE_REASONS.INVITATION_REQUIRES_ACTIVE_USER,
            status: 'INACTIVE',
            trustStatus: user.identityPlus?.trustStatus || null,
          },
        }),
      )
    }

    if (user.identityPlus.trustStatus !== 'UNTRUSTED') {
      return res.status(422).json(
        buildValidationErrorResponse({
          req,
          message: 'Invitation can only be resent for users with UNTRUSTED trust status.',
          details: {
            reason: USER_LIFECYCLE_REASONS.INVITATION_REQUIRES_UNTRUSTED,
            status: user.isActive ? 'ACTIVE' : 'INACTIVE',
            trustStatus: user.identityPlus?.trustStatus || null,
          },
        }),
      )
    }

    const customerId =
      customerContext?.rawCustomerId ||
      user.memberships.find((m) => m.customerId !== null)?.customerId

    // Send invitation
    const result = await identityPlusService.sendInvitation({
      email: user.email,
      customerId: customerId?.toString(),
      redirectUrl,
    })

    let fakeAuthInvitation = null
    if (env.fakeAuthAllowed) {
      try {
        const scopedCustomerId = customerId ? toIdString(customerId) : null
        let scopedCustomer = null
        if (scopedCustomerId) {
          const scopedFromRequest = req.scopes?.customer
          if (scopedFromRequest && toIdString(scopedFromRequest._id) === scopedCustomerId) {
            scopedCustomer = scopedFromRequest
          } else {
            scopedCustomer = await Customer.findById(scopedCustomerId)
          }
        }

        fakeAuthInvitation = await upsertFakeAuthInvitationForCustomerUser({
          req,
          customer: scopedCustomer,
          customerId: scopedCustomerId,
          user,
          source: 'customer_admin_resend_invitation',
        })
      } catch (fakeAuthErr) {
        logger.warn(
          { err: fakeAuthErr, userId: user._id, customerId },
          'fake auth invitation setup failed for customer-admin resend invitation',
        )
      }
    }

    // Update external ID if new one returned
    if (result?.externalId) {
      user.identityPlus.externalId = result.externalId
      user.identityPlus.invitedAt = result.invitedAt || new Date()
      await user.save()
      await performanceCacheService.invalidateUserPermissions(user._id)
    }

    // Audit log
    await auditService.logFromRequest(req, {
      action: 'USER_INVITED',
      resourceType: 'User',
      resourceId: user._id,
      scope: { customerId },
      diff: {
        email: user.email,
        externalId: result?.externalId,
        resend: true,
        ...(fakeAuthInvitation?.invitationId
          ? { fakeAuthInvitationId: fakeAuthInvitation.invitationId }
          : {}),
      },
    })

    return res.status(200).json({
      data: {
        message: 'Invitation resent successfully.',
        userId: user._id,
        externalId: result?.externalId,
        ...(fakeAuthInvitation?.authLink
          ? {
              authLink: fakeAuthInvitation.authLink,
              invitationId: fakeAuthInvitation.invitationId,
            }
          : {}),
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    // Identity Plus service errors
    if (err.code === 'IDENTITY_PLUS_CIRCUIT_OPEN') {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Identity Plus service is temporarily unavailable. Please try again later.',
          requestId: req.requestId,
        },
      })
    }
    next(err)
  }
}

