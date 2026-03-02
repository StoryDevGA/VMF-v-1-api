/**
 * User Controller
 *
 * Handles user management endpoints (Customer Admin):
 *   - GET    /api/v1/customers/:customerId/users           List users
 *   - POST   /api/v1/customers/:customerId/users           Create user + invitation
 *   - GET    /api/v1/customers/:customerId/users/:userId   Get single user
 *   - PATCH  /api/v1/users/:userId                          Update user
 *   - POST   /api/v1/users/:userId/disable                  Disable user
 *   - DELETE /api/v1/users/:userId                          Delete disabled user
 *   - POST   /api/v1/users/:userId/resend-invitation        Resend invitation
 */

import { Customer, User, Tenant } from '../models/index.js'
import identityPlusService from '../services/identityPlusService.js'
import auditService from '../services/auditService.js'
import logger from '../config/logger.js'
import performanceCacheService from '../services/performanceCacheService.js'
import customerGovernanceService from '../services/customerGovernanceService.js'

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
 * Query params: q (search name/email), status (active/disabled),
 *               page, pageSize
 */
export const listUsers = async (req, res, next) => {
  try {
    const { customerId } = req.params
    const {
      q,
      status,
      page = 1,
      pageSize = 20,
    } = req.query

    const filter = { 'memberships.customerId': customerId }

    if (status === 'active') filter.isActive = true
    if (status === 'disabled') filter.isActive = false

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ]
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20))
    const skip = (pageNum - 1) * limit

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ])

    return res.status(200).json({
      data: users,
      meta: {
        page: pageNum,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
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
 * Create a new user, assign roles + tenant visibility,
 * and trigger an Identity Plus invitation.
 */
export const createUser = async (req, res, next) => {
  try {
    const { customerId } = req.params
    const { name, email, roles, tenantVisibility } = req.body

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

    // 2. Check for duplicate email
    const existing = await User.findOne({ email })
    if (existing) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'A user with this email already exists.',
          requestId: req.requestId,
        },
      })
    }

    // 3. Validate tenant visibility IDs belong to this customer
    if (tenantVisibility && tenantVisibility.length > 0) {
      const validTenants = await Tenant.countDocuments({
        _id: { $in: tenantVisibility },
        customerId,
      })
      if (validTenants !== tenantVisibility.length) {
        return res.status(422).json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'One or more tenant IDs are invalid or do not belong to this customer.',
            details: { tenantVisibility: 'Invalid tenant ID(s)' },
            requestId: req.requestId,
          },
        })
      }
    }

    // 4. Create user with customer membership
    const user = new User({
      name,
      email,
      isActive: true,
      identityPlus: { trustStatus: 'UNTRUSTED' },
      memberships: [{ customerId, roles }],
      tenantMemberships: (tenantVisibility || []).map((tenantId) => ({
        customerId,
        tenantId,
        roles: ['USER'],
      })),
    })

    const requestsCustomerAdminRole = Array.isArray(roles) &&
      roles.includes(customerGovernanceService.CUSTOMER_ADMIN_ROLE)

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
    try {
      invitationResult = await identityPlusService.sendInvitation({
        email,
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
    }
    await performanceCacheService.invalidateUserPermissions(user._id)

    // 6. Audit log
    await auditService.logFromRequest(req, {
      action: 'USER_CREATED',
      resourceType: 'User',
      resourceId: user._id,
      scope: { customerId },
      diff: {
        name,
        email,
        roles,
        tenantVisibility,
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
        diff: { email, externalId: invitationResult.externalId },
      })
    }

    return res.status(201).json({
      data: user.toJSON(),
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
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found.',
          requestId: req.requestId,
        },
      })
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

    return res.status(200).json({
      data: user.toJSON(),
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
 * Update user — name, roles, tenant visibility.
 *
 * The caller must have Customer Admin access to the customer the user
 * belongs to.  The customerId is resolved from the user's memberships.
 */
export const updateUser = async (req, res, next) => {
  try {
    const { userId } = req.params
    const { name, roles, tenantVisibility } = req.body

    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found.',
          requestId: req.requestId,
        },
      })
    }

    const diff = {}
    let customerForRoleUpdate = null
    let customerGovernanceChanged = false

    // Update name
    if (name !== undefined) {
      diff.name = { from: user.name, to: name }
      user.name = name
    }

    // Update roles on customer memberships
    if (roles !== undefined) {
      // Find the first non-platform membership to update roles on
      const membership = user.memberships.find((m) => m.customerId !== null)
      if (membership) {
        customerForRoleUpdate = await Customer.findById(membership.customerId)
        if (!customerForRoleUpdate) {
          return res.status(422).json({
            error: {
              code: 'VALIDATION_FAILED',
              message: 'User has an invalid customer membership reference.',
              requestId: req.requestId,
            },
          })
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
      const membership = user.memberships.find((m) => m.customerId !== null)
      const customerId = membership?.customerId

      if (customerId) {
        // Validate tenant IDs belong to this customer
        if (tenantVisibility.length > 0) {
          const validTenants = await Tenant.countDocuments({
            _id: { $in: tenantVisibility },
            customerId,
          })
          if (validTenants !== tenantVisibility.length) {
            return res.status(422).json({
              error: {
                code: 'VALIDATION_FAILED',
                message: 'One or more tenant IDs are invalid or do not belong to this customer.',
                details: { tenantVisibility: 'Invalid tenant ID(s)' },
                requestId: req.requestId,
              },
            })
          }
        }

        diff.tenantVisibility = {
          from: user.tenantMemberships
            .filter((tm) => tm.customerId.toString() === customerId.toString())
            .map((tm) => tm.tenantId.toString()),
          to: tenantVisibility,
        }

        // Remove existing tenantMemberships for this customer
        user.tenantMemberships = user.tenantMemberships.filter(
          (tm) => tm.customerId.toString() !== customerId.toString(),
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
        customerId: user.memberships.find((m) => m.customerId !== null)?.customerId,
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

    return res.status(200).json({
      data: user.toJSON(),
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
          message: 'User is already disabled.',
          requestId: req.requestId,
        },
      })
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
        customerId: user.memberships.find((m) => m.customerId !== null)?.customerId,
      },
      diff: {
        isActive: { from: true, to: false },
        trustStatus: { from: 'TRUSTED', to: 'REVOKED' },
      },
    })

    return res.status(200).json({
      data: user.toJSON(),
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
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'User not found.',
          requestId: req.requestId,
        },
      })
    }

    if (user.isActive) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Only disabled users can be deleted. Disable the user first.',
          requestId: req.requestId,
        },
      })
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
      customerId: user.memberships.find((m) => m.customerId !== null)?.customerId,
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
          message: 'Cannot resend invitation to a disabled user.',
          requestId: req.requestId,
        },
      })
    }

    if (user.identityPlus.trustStatus !== 'UNTRUSTED') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invitation can only be resent for users with UNTRUSTED trust status.',
          requestId: req.requestId,
        },
      })
    }

    const customerId = user.memberships.find(
      (m) => m.customerId !== null,
    )?.customerId

    // Send invitation
    const result = await identityPlusService.sendInvitation({
      email: user.email,
      customerId: customerId?.toString(),
      redirectUrl,
    })

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
      diff: { email: user.email, externalId: result?.externalId, resend: true },
    })

    return res.status(200).json({
      data: {
        message: 'Invitation resent successfully.',
        userId: user._id,
        externalId: result?.externalId,
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

