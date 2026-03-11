/**
 * loadScopes Middleware
 *
 * Runs after authJwt. Loads authorization scopes for the authenticated user.
 */

import { Customer, User } from '../models/index.js'
import env from '../config/env.js'
import logger from '../config/logger.js'
import monitoringService from '../services/monitoringService.js'
import { buildInactiveCustomerErrorResponse } from './customerStatus.js'
import performanceCacheService, {
  buildCustomerTopologySnapshot,
  buildUserPermissionsSnapshot,
} from '../services/performanceCacheService.js'

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const getCustomerIdsFromMemberships = (memberships = []) =>
  Array.from(
    new Set(
      memberships
        .map((membership) => toIdString(membership.customerId))
        .filter(Boolean),
    ),
  )

const resolveCustomerStatus = async (customerId) => {
  const cachedCustomer = await performanceCacheService.getCustomerTopology(customerId)
  if (cachedCustomer?.status) {
    return cachedCustomer.status
  }

  const customer = await Customer.findById(customerId)
  if (!customer) return null

  await performanceCacheService.setCustomerTopology(
    customer._id,
    buildCustomerTopologySnapshot(customer),
  )

  return customer.status
}

const evaluateActiveCustomerAccess = async ({
  memberships = [],
  platformRoles = [],
  skipInactiveCheck = false,
}) => {
  if (skipInactiveCheck || !env.governanceInactiveEnforcementEnabled) {
    return {
      hasActiveCustomerAccess: true,
      activeCustomerIds: [],
      inactiveCustomerIds: [],
      unknownCustomerIds: [],
      customerIds: getCustomerIdsFromMemberships(memberships),
    }
  }

  if (platformRoles.includes('SUPER_ADMIN')) {
    return {
      hasActiveCustomerAccess: true,
      activeCustomerIds: [],
      inactiveCustomerIds: [],
      unknownCustomerIds: [],
      customerIds: [],
    }
  }

  const customerIds = getCustomerIdsFromMemberships(memberships)
  if (customerIds.length === 0) {
    return {
      hasActiveCustomerAccess: true,
      activeCustomerIds: [],
      inactiveCustomerIds: [],
      unknownCustomerIds: [],
      customerIds,
    }
  }

  const statuses = await Promise.all(
    customerIds.map(async (customerId) => ({
      customerId,
      status: await resolveCustomerStatus(customerId),
    })),
  )

  const activeCustomerIds = statuses
    .filter((entry) => entry.status === 'ACTIVE')
    .map((entry) => entry.customerId)

  const inactiveCustomerIds = statuses
    .filter((entry) => entry.status && entry.status !== 'ACTIVE')
    .map((entry) => entry.customerId)

  const unknownCustomerIds = statuses
    .filter((entry) => !entry.status)
    .map((entry) => entry.customerId)

  return {
    hasActiveCustomerAccess:
      activeCustomerIds.length > 0 || unknownCustomerIds.length > 0,
    activeCustomerIds,
    inactiveCustomerIds,
    unknownCustomerIds,
    customerIds,
  }
}

const shouldBypassInactiveCustomerEvaluation = (req) =>
  typeof req.originalUrl === 'string' &&
  req.originalUrl.startsWith('/api/v1/super-admin/')

const loadScopes = async (req, res, next) => {
  try {
    const userId = req.context?.userId || req.userId

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required before loading scopes.',
          requestId: req.requestId,
        },
      })
    }

    const cachedScopeSnapshot = await performanceCacheService.getUserPermissions(userId)
    if (cachedScopeSnapshot) {
      if (!cachedScopeSnapshot.isActive) {
        logger.warn({ userId, requestId: req.requestId }, 'loadScopes - cached user disabled')
        return res.status(401).json({
          error: {
            code: 'AUTH_ACCOUNT_DISABLED',
            message: 'Your account has been disabled. Contact your administrator.',
            requestId: req.requestId,
          },
        })
      }

      req.scopes = {
        user: cachedScopeSnapshot.user,
        platformRoles: cachedScopeSnapshot.platformRoles || [],
        memberships: cachedScopeSnapshot.memberships || [],
        tenantMemberships: cachedScopeSnapshot.tenantMemberships || [],
        vmfGrants: cachedScopeSnapshot.vmfGrants || [],
        isPlatformUser: Boolean(cachedScopeSnapshot.isPlatformUser),
      }

      const customerAccess = await evaluateActiveCustomerAccess({
        memberships: req.scopes.memberships,
        platformRoles: req.scopes.platformRoles,
        skipInactiveCheck: shouldBypassInactiveCustomerEvaluation(req),
      })

      req.scopes.customerIds = customerAccess.customerIds
      req.scopes.activeCustomerIds = customerAccess.activeCustomerIds
      req.scopes.inactiveCustomerIds = customerAccess.inactiveCustomerIds
      req.scopes.unknownCustomerIds = customerAccess.unknownCustomerIds

      if (!customerAccess.hasActiveCustomerAccess) {
        monitoringService.recordInactiveCustomerBlock({ surface: 'load_scopes' })
        logger.warn(
          {
            userId,
            inactiveCustomerIds: customerAccess.inactiveCustomerIds,
            requestId: req.requestId,
          },
          'loadScopes - user blocked due to inactive customer membership',
        )
        return res.status(403).json(buildInactiveCustomerErrorResponse({
          requestId: req.requestId,
          inactiveCustomerIds: customerAccess.inactiveCustomerIds,
        }))
      }

      return next()
    }

    const user = await User.findById(userId)

    if (!user) {
      logger.warn({ userId, requestId: req.requestId }, 'loadScopes - user not found')
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'User not found. Please sign in again.',
          requestId: req.requestId,
        },
      })
    }

    if (!user.isActive) {
      logger.warn({ userId, requestId: req.requestId }, 'loadScopes - user disabled')
      return res.status(401).json({
        error: {
          code: 'AUTH_ACCOUNT_DISABLED',
          message: 'Your account has been disabled. Contact your administrator.',
          requestId: req.requestId,
        },
      })
    }

    const scopeSnapshot = buildUserPermissionsSnapshot(user)

    req.scopes = {
      user,
      platformRoles: scopeSnapshot.platformRoles,
      memberships: scopeSnapshot.memberships,
      tenantMemberships: scopeSnapshot.tenantMemberships,
      vmfGrants: scopeSnapshot.vmfGrants,
      isPlatformUser: scopeSnapshot.isPlatformUser,
    }

    const customerAccess = await evaluateActiveCustomerAccess({
      memberships: req.scopes.memberships,
      platformRoles: req.scopes.platformRoles,
      skipInactiveCheck: shouldBypassInactiveCustomerEvaluation(req),
    })

    req.scopes.customerIds = customerAccess.customerIds
    req.scopes.activeCustomerIds = customerAccess.activeCustomerIds
    req.scopes.inactiveCustomerIds = customerAccess.inactiveCustomerIds
    req.scopes.unknownCustomerIds = customerAccess.unknownCustomerIds

    if (!customerAccess.hasActiveCustomerAccess) {
      monitoringService.recordInactiveCustomerBlock({ surface: 'load_scopes' })
      logger.warn(
        {
          userId,
          inactiveCustomerIds: customerAccess.inactiveCustomerIds,
          requestId: req.requestId,
        },
        'loadScopes - user blocked due to inactive customer membership',
      )
      return res.status(403).json(buildInactiveCustomerErrorResponse({
        requestId: req.requestId,
        inactiveCustomerIds: customerAccess.inactiveCustomerIds,
      }))
    }

    await performanceCacheService.setUserPermissions(userId, scopeSnapshot)

    return next()
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'loadScopes - unexpected error')
    next(err)
  }
}

export default loadScopes
