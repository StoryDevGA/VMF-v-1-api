/**
 * loadScopes Middleware
 *
 * Runs after authJwt. Loads authorization scopes for the authenticated user.
 */

import { User } from '../models/index.js'
import logger from '../config/logger.js'
import performanceCacheService, {
  buildUserPermissionsSnapshot,
} from '../services/performanceCacheService.js'

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

    await performanceCacheService.setUserPermissions(userId, scopeSnapshot)

    return next()
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'loadScopes - unexpected error')
    next(err)
  }
}

export default loadScopes
