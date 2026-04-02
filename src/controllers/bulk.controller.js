/**
 * Bulk Operations Controller
 *
 * Handles bulk user management endpoints (Customer Admin):
 *   - POST /api/v1/customers/:customerId/users/bulk          Bulk create
 *   - PATCH /api/v1/customers/:customerId/users/bulk         Bulk update
 *   - POST /api/v1/customers/:customerId/users/bulk-disable  Bulk disable
 *
 * Each operation processes items individually so partial success is
 * possible.  The response always includes per-item results with
 * success/failure details plus an overall summary.
 */

import { Customer, User, Tenant } from '../models/index.js'
import identityPlusService from '../services/identityPlusService.js'
import logger from '../config/logger.js'
import auditService from '../services/auditService.js'
import performanceCacheService from '../services/performanceCacheService.js'
import {
  CUSTOMER_USER_ASSIGNABLE_ROLE_SCOPES,
  IMPLICIT_TENANT_MEMBERSHIP_ROLE_KEYS,
  TENANT_MEMBERSHIP_ASSIGNABLE_ROLE_SCOPES,
  isRoleAssignmentValidationError,
  loadRoleDefinitionsByKey,
  validateRoleAssignments,
} from '../services/roleAssignmentValidationService.js'
import {
  buildTenantVisibilityErrorPayload,
  isTenantVisibilityAllowed,
  TENANT_VISIBILITY_REASONS,
} from '../services/tenantVisibilityContractService.js'

const buildBulkTenantVisibilityFailure = ({
  customer,
  reason,
  invalidTenantIds,
}) => {
  const payload = buildTenantVisibilityErrorPayload({
    customer,
    reason,
    invalidTenantIds,
  })

  return {
    error: payload.message,
    errorCode: payload.code,
    errorDetails: payload.details,
  }
}

const buildBulkRoleAssignmentFailure = (err) => ({
  error: err.message,
  errorCode: err.code || 'VALIDATION_FAILED',
  errorDetails: err.details || {},
})

/* ------------------------------------------------------------------ */
/*  POST /api/v1/customers/:customerId/users/bulk                     */
/* ------------------------------------------------------------------ */

/**
 * Create up to 100 users in a single request.
 *
 * Each user is processed individually so that one failure does not
 * block the others.  The response lists per-user results.
 */
export const bulkCreateUsers = async (req, res, next) => {
  try {
    const { customerId } = req.params
    const { users, sendInvitations } = req.body

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
    const tenantVisibilityAllowed = isTenantVisibilityAllowed(customer)
    const needsTenantMembershipRoleValidation = users.some(
      (entry) => Array.isArray(entry.tenantVisibility) && entry.tenantVisibility.length > 0,
    )
    const roleDefinitionsByKey = await loadRoleDefinitionsByKey([
      ...users.flatMap((entry) => entry.roles || []),
      ...(needsTenantMembershipRoleValidation ? IMPLICIT_TENANT_MEMBERSHIP_ROLE_KEYS : []),
    ])

    // 2. Pre-validate: collect all emails to detect duplicates in batch
    const emailSet = new Set()
    const internalDuplicates = new Set()
    for (const entry of users) {
      const email = entry.email.toLowerCase()
      if (emailSet.has(email)) {
        internalDuplicates.add(email)
      }
      emailSet.add(email)
    }

    // 3. Check for existing emails in DB in one query
    const existingUsers = await User.find({
      email: { $in: [...emailSet] },
    }).lean()
    const existingEmailSet = new Set(existingUsers.map((u) => u.email.toLowerCase()))

    // 4. Pre-validate tenant visibility IDs (collect all unique IDs)
    const allTenantIds = new Set()
    for (const entry of users) {
      if (entry.tenantVisibility?.length) {
        for (const tid of entry.tenantVisibility) {
          allTenantIds.add(tid)
        }
      }
    }

    let validTenantIds = new Set()
    if (tenantVisibilityAllowed && allTenantIds.size > 0) {
      const validTenants = await Tenant.find({
        _id: { $in: [...allTenantIds] },
        customerId,
      }).lean()
      validTenantIds = new Set(validTenants.map((t) => t._id.toString()))
    }

    // 5. Process each user
    const results = []
    let successCount = 0
    let failureCount = 0

    for (let i = 0; i < users.length; i++) {
      const entry = users[i]
      const email = entry.email.toLowerCase()

      try {
        const normalizedRoles = validateRoleAssignments({
          roleKeys: entry.roles,
          roleDefinitionsByKey,
          allowedScopes: CUSTOMER_USER_ASSIGNABLE_ROLE_SCOPES,
          field: 'roles',
          assignmentLabel: 'bulk customer user role assignment',
        })

        // Check internal duplicates
        if (internalDuplicates.has(email)) {
          const isDuplicate = results.some(
            (r) => r.email === email && r.status === 'created',
          )
          if (isDuplicate) {
            failureCount++
            results.push({
              index: i,
              email,
              status: 'failed',
              error: 'Duplicate email within this request.',
            })
            continue
          }
        }

        // Check DB duplicates
        if (existingEmailSet.has(email)) {
          failureCount++
          results.push({
            index: i,
            email,
            status: 'failed',
            error: 'A user with this email already exists.',
          })
          continue
        }

        // Validate tenant visibility
        if (entry.tenantVisibility !== undefined) {
          if (!tenantVisibilityAllowed) {
            const failure = buildBulkTenantVisibilityFailure({
              customer,
              reason: TENANT_VISIBILITY_REASONS.NOT_ALLOWED,
            })

            failureCount++
            results.push({
              index: i,
              email,
              status: 'failed',
              ...failure,
            })
            continue
          }

          const invalidTenants = (entry.tenantVisibility || []).filter(
            (tid) => !validTenantIds.has(tid),
          )
          if (invalidTenants.length > 0) {
            const failure = buildBulkTenantVisibilityFailure({
              customer,
              reason: TENANT_VISIBILITY_REASONS.INVALID_TENANT_IDS,
              invalidTenantIds: invalidTenants,
            })

            failureCount++
            results.push({
              index: i,
              email,
              status: 'failed',
              ...failure,
            })
            continue
          }

          if (entry.tenantVisibility.length > 0) {
            validateRoleAssignments({
              roleKeys: IMPLICIT_TENANT_MEMBERSHIP_ROLE_KEYS,
              roleDefinitionsByKey,
              allowedScopes: TENANT_MEMBERSHIP_ASSIGNABLE_ROLE_SCOPES,
              field: 'tenantVisibility',
              assignmentLabel: 'bulk tenant visibility assignment',
            })
          }
        }

        // Create user
        const user = new User({
          name: entry.name,
          email,
          isActive: true,
          identityPlus: { trustStatus: 'UNTRUSTED' },
          memberships: [{ customerId, roles: normalizedRoles }],
          tenantMemberships: (entry.tenantVisibility || []).map((tenantId) => ({
            customerId,
            tenantId,
            roles: ['USER'],
          })),
        })

        await user.save()
        await performanceCacheService.invalidateUserPermissions(user._id)

        // Track email as now existing (for subsequent intra-batch duplicate checks)
        existingEmailSet.add(email)

        // Send invitation if requested
        let invitationSent = false
        if (sendInvitations) {
          try {
            const invResult = await identityPlusService.sendInvitation({
              email,
              customerId: customerId.toString(),
            })
            if (invResult?.externalId) {
              user.identityPlus.externalId = invResult.externalId
              user.identityPlus.invitedAt = invResult.invitedAt || new Date()
              await user.save()
              await performanceCacheService.invalidateUserPermissions(user._id)
            }
            invitationSent = true
          } catch (invErr) {
            logger.warn(
              { err: invErr, email, customerId },
              'Bulk create — invitation failed for user',
            )
          }
        }

        // Audit
        await auditService.logFromRequest(req, {
          action: 'USER_CREATED',
          resourceType: 'User',
          resourceId: user._id,
          scope: { customerId },
          diff: {
            name: entry.name,
            email,
            roles: normalizedRoles,
            tenantVisibility: entry.tenantVisibility,
            bulk: true,
          },
        })

        successCount++
        results.push({
          index: i,
          email,
          userId: user._id,
          status: 'created',
          invitationSent,
        })
      } catch (err) {
        failureCount++
        if (isRoleAssignmentValidationError(err)) {
          results.push({
            index: i,
            email,
            status: 'failed',
            ...buildBulkRoleAssignmentFailure(err),
          })
          continue
        }
        logger.error({ err, email, index: i }, 'bulk create user failed')
        results.push({
          index: i,
          email,
          status: 'failed',
          error: err.message || 'Unexpected error',
        })
      }
    }

    // Audit the bulk operation itself
    await auditService.logFromRequest(req, {
      action: 'BULK_USERS_CREATED',
      resourceType: 'User',
      resourceId: req.params.customerId,
      scope: { customerId },
      diff: {
        requested: users.length,
        succeeded: successCount,
        failed: failureCount,
      },
    })

    const httpStatus = failureCount === 0 ? 200 : (successCount === 0 ? 422 : 207)

    return res.status(httpStatus).json({
      data: {
        results,
        summary: {
          total: users.length,
          succeeded: successCount,
          failed: failureCount,
        },
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/v1/customers/:customerId/users/bulk                    */
/* ------------------------------------------------------------------ */

/**
 * Update multiple users (roles, tenant visibility).
 *
 * Each user is processed individually; partial success possible.
 */
export const bulkUpdateUsers = async (req, res, next) => {
  try {
    const { customerId } = req.params
    const { users } = req.body

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
    const tenantVisibilityAllowed = isTenantVisibilityAllowed(customer)
    const needsTenantMembershipRoleValidation = users.some(
      (entry) => Array.isArray(entry.tenantVisibility) && entry.tenantVisibility.length > 0,
    )
    const roleDefinitionsByKey = await loadRoleDefinitionsByKey([
      ...users.flatMap((entry) => entry.roles || []),
      ...(needsTenantMembershipRoleValidation ? IMPLICIT_TENANT_MEMBERSHIP_ROLE_KEYS : []),
    ])

    // 2. Pre-validate tenant visibility IDs
    const allTenantIds = new Set()
    for (const entry of users) {
      if (entry.tenantVisibility?.length) {
        for (const tid of entry.tenantVisibility) {
          allTenantIds.add(tid)
        }
      }
    }

    let validTenantIds = new Set()
    if (tenantVisibilityAllowed && allTenantIds.size > 0) {
      const validTenants = await Tenant.find({
        _id: { $in: [...allTenantIds] },
        customerId,
      }).lean()
      validTenantIds = new Set(validTenants.map((t) => t._id.toString()))
    }

    // 3. Process each user update
    const results = []
    let successCount = 0
    let failureCount = 0

    for (let i = 0; i < users.length; i++) {
      const entry = users[i]

      try {
        const user = await User.findById(entry.userId)

        if (!user) {
          failureCount++
          results.push({
            index: i,
            userId: entry.userId,
            status: 'failed',
            error: 'User not found.',
          })
          continue
        }

        // Verify user belongs to this customer
        const membership = user.memberships.find(
          (m) => m.customerId && m.customerId.toString() === customerId,
        )
        if (!membership) {
          failureCount++
          results.push({
            index: i,
            userId: entry.userId,
            status: 'failed',
            error: 'User does not belong to this customer.',
          })
          continue
        }

        const diff = {}
        const normalizedRoles = entry.roles !== undefined
          ? validateRoleAssignments({
              roleKeys: entry.roles,
              roleDefinitionsByKey,
              allowedScopes: CUSTOMER_USER_ASSIGNABLE_ROLE_SCOPES,
              field: 'roles',
              assignmentLabel: 'bulk customer user role assignment',
            })
          : undefined

        // Update roles
        if (normalizedRoles !== undefined) {
          diff.roles = { from: [...membership.roles], to: normalizedRoles }
          membership.roles = normalizedRoles
        }

        // Update tenant visibility
        if (entry.tenantVisibility !== undefined) {
          if (!tenantVisibilityAllowed) {
            const failure = buildBulkTenantVisibilityFailure({
              customer,
              reason: TENANT_VISIBILITY_REASONS.NOT_ALLOWED,
            })

            failureCount++
            results.push({
              index: i,
              userId: entry.userId,
              status: 'failed',
              ...failure,
            })
            continue
          }

          const invalidTenants = entry.tenantVisibility.filter(
            (tid) => !validTenantIds.has(tid),
          )
          if (invalidTenants.length > 0) {
            const failure = buildBulkTenantVisibilityFailure({
              customer,
              reason: TENANT_VISIBILITY_REASONS.INVALID_TENANT_IDS,
              invalidTenantIds: invalidTenants,
            })

            failureCount++
            results.push({
              index: i,
              userId: entry.userId,
              status: 'failed',
              ...failure,
            })
            continue
          }

          if (entry.tenantVisibility.length > 0) {
            validateRoleAssignments({
              roleKeys: IMPLICIT_TENANT_MEMBERSHIP_ROLE_KEYS,
              roleDefinitionsByKey,
              allowedScopes: TENANT_MEMBERSHIP_ASSIGNABLE_ROLE_SCOPES,
              field: 'tenantVisibility',
              assignmentLabel: 'bulk tenant visibility assignment',
            })
          }

          diff.tenantVisibility = {
            from: user.tenantMemberships
              .filter((tm) => tm.customerId.toString() === customerId)
              .map((tm) => tm.tenantId.toString()),
            to: entry.tenantVisibility,
          }

          // Remove existing tenantMemberships for this customer
          user.tenantMemberships = user.tenantMemberships.filter(
            (tm) => tm.customerId.toString() !== customerId,
          )

          // Add new tenantMemberships
          for (const tenantId of entry.tenantVisibility) {
            user.tenantMemberships.push({
              customerId,
              tenantId,
              roles: ['USER'],
            })
          }
        }

        await user.save()
        await performanceCacheService.invalidateUserPermissions(user._id)

        await auditService.logFromRequest(req, {
          action: 'USER_ROLE_UPDATED',
          resourceType: 'User',
          resourceId: user._id,
          scope: { customerId },
          diff: {
            ...diff,
            bulk: true,
          },
        })

        successCount++
        results.push({
          index: i,
          userId: entry.userId,
          status: 'updated',
        })
      } catch (err) {
        failureCount++
        if (isRoleAssignmentValidationError(err)) {
          results.push({
            index: i,
            userId: entry.userId,
            status: 'failed',
            ...buildBulkRoleAssignmentFailure(err),
          })
          continue
        }
        logger.error({ err, userId: entry.userId, index: i }, 'bulk update user failed')
        results.push({
          index: i,
          userId: entry.userId,
          status: 'failed',
          error: err.message || 'Unexpected error',
        })
      }
    }

    // Audit the bulk operation
    await auditService.logFromRequest(req, {
      action: 'BULK_USERS_UPDATED',
      resourceType: 'User',
      resourceId: req.params.customerId,
      scope: { customerId },
      diff: {
        requested: users.length,
        succeeded: successCount,
        failed: failureCount,
      },
    })

    const httpStatus = failureCount === 0 ? 200 : (successCount === 0 ? 422 : 207)

    return res.status(httpStatus).json({
      data: {
        results,
        summary: {
          total: users.length,
          succeeded: successCount,
          failed: failureCount,
        },
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/v1/customers/:customerId/users/bulk-disable             */
/* ------------------------------------------------------------------ */

/**
 * Disable multiple users (immediate effect, revokes trust).
 *
 * Each user is processed individually; partial success possible.
 */
export const bulkDisableUsers = async (req, res, next) => {
  try {
    const { customerId } = req.params
    const { userIds } = req.body

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

    // 2. Process each user
    const results = []
    let successCount = 0
    let failureCount = 0

    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i]

      try {
        const user = await User.findById(userId)

        if (!user) {
          failureCount++
          results.push({
            index: i,
            userId,
            status: 'failed',
            error: 'User not found.',
          })
          continue
        }

        // Verify user belongs to this customer
        const belongsToCustomer = user.memberships.some(
          (m) => m.customerId && m.customerId.toString() === customerId,
        )
        if (!belongsToCustomer) {
          failureCount++
          results.push({
            index: i,
            userId,
            status: 'failed',
            error: 'User does not belong to this customer.',
          })
          continue
        }

        // Skip already disabled users
        if (!user.isActive) {
          failureCount++
          results.push({
            index: i,
            userId,
            status: 'failed',
            error: 'User is already disabled.',
          })
          continue
        }

        // Disable + revoke trust
        user.isActive = false
        user.identityPlus.trustStatus = 'REVOKED'
        await user.save()
        await performanceCacheService.invalidateUserPermissions(user._id)

        // Revoke trust externally (non-fatal)
        try {
          await identityPlusService.revokeTrust({
            externalId: user.identityPlus.externalId,
            email: user.email,
          })
        } catch (revokeErr) {
          logger.warn(
            { err: revokeErr, userId, email: user.email },
            'Bulk disable — Identity Plus revokeTrust failed',
          )
        }

        await auditService.logFromRequest(req, {
          action: 'USER_DISABLED',
          resourceType: 'User',
          resourceId: user._id,
          scope: { customerId },
          diff: {
            isActive: { from: true, to: false },
            trustStatus: { from: 'TRUSTED', to: 'REVOKED' },
            bulk: true,
          },
        })

        successCount++
        results.push({
          index: i,
          userId,
          status: 'disabled',
        })
      } catch (err) {
        failureCount++
        logger.error({ err, userId, index: i }, 'bulk disable user failed')
        results.push({
          index: i,
          userId,
          status: 'failed',
          error: err.message || 'Unexpected error',
        })
      }
    }

    // Audit the bulk operation
    await auditService.logFromRequest(req, {
      action: 'BULK_USERS_DISABLED',
      resourceType: 'User',
      resourceId: req.params.customerId,
      scope: { customerId },
      diff: {
        requested: userIds.length,
        succeeded: successCount,
        failed: failureCount,
      },
    })

    const httpStatus = failureCount === 0 ? 200 : (successCount === 0 ? 422 : 207)

    return res.status(httpStatus).json({
      data: {
        results,
        summary: {
          total: userIds.length,
          succeeded: successCount,
          failed: failureCount,
        },
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
