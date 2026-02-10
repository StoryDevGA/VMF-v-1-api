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

import { Customer, User, Tenant, AuditLog } from '../models/index.js'
import identityPlusService from '../services/identityPlusService.js'
import logger from '../config/logger.js'

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const audit = async (req, action, resourceId, scope, diff) => {
  try {
    await AuditLog.createLog({
      actorUserId: req.context?.userId || req.userId,
      action,
      resourceType: 'User',
      resourceId,
      scope,
      diff,
      ip: req.ip,
      userAgent: req.get?.('user-agent'),
      requestId: req.requestId,
    })
  } catch (err) {
    logger.error({ err, action, resourceId }, 'bulk operation audit log failed')
  }
}

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
    if (allTenantIds.size > 0) {
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
        if (entry.tenantVisibility?.length) {
          const invalidTenants = entry.tenantVisibility.filter(
            (tid) => !validTenantIds.has(tid),
          )
          if (invalidTenants.length > 0) {
            failureCount++
            results.push({
              index: i,
              email,
              status: 'failed',
              error: `Invalid tenant ID(s): ${invalidTenants.join(', ')}`,
            })
            continue
          }
        }

        // Create user
        const user = new User({
          name: entry.name,
          email,
          isActive: true,
          identityPlus: { trustStatus: 'UNTRUSTED' },
          memberships: [{ customerId, roles: entry.roles }],
          tenantMemberships: (entry.tenantVisibility || []).map((tenantId) => ({
            customerId,
            tenantId,
            roles: ['USER'],
          })),
        })

        await user.save()

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
        await audit(req, 'USER_CREATED', user._id, { customerId }, {
          name: entry.name,
          email,
          roles: entry.roles,
          tenantVisibility: entry.tenantVisibility,
          bulk: true,
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
    await audit(req, 'BULK_USERS_CREATED', null, { customerId }, {
      requested: users.length,
      succeeded: successCount,
      failed: failureCount,
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
    if (allTenantIds.size > 0) {
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

        // Update roles
        if (entry.roles !== undefined) {
          diff.roles = { from: [...membership.roles], to: entry.roles }
          membership.roles = entry.roles
        }

        // Update tenant visibility
        if (entry.tenantVisibility !== undefined) {
          // Validate tenant IDs
          if (entry.tenantVisibility.length > 0) {
            const invalidTenants = entry.tenantVisibility.filter(
              (tid) => !validTenantIds.has(tid),
            )
            if (invalidTenants.length > 0) {
              failureCount++
              results.push({
                index: i,
                userId: entry.userId,
                status: 'failed',
                error: `Invalid tenant ID(s): ${invalidTenants.join(', ')}`,
              })
              continue
            }
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

        await audit(req, 'USER_ROLE_UPDATED', user._id, { customerId }, {
          ...diff,
          bulk: true,
        })

        successCount++
        results.push({
          index: i,
          userId: entry.userId,
          status: 'updated',
        })
      } catch (err) {
        failureCount++
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
    await audit(req, 'BULK_USERS_UPDATED', null, { customerId }, {
      requested: users.length,
      succeeded: successCount,
      failed: failureCount,
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

        await audit(req, 'USER_DISABLED', user._id, { customerId }, {
          isActive: { from: true, to: false },
          trustStatus: { from: 'TRUSTED', to: 'REVOKED' },
          bulk: true,
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
    await audit(req, 'BULK_USERS_DISABLED', null, { customerId }, {
      requested: userIds.length,
      succeeded: successCount,
      failed: failureCount,
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
