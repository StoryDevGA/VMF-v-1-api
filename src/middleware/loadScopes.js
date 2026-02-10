/**
 * loadScopes Middleware
 *
 * Runs after authJwt. Loads the authenticated user's full membership
 * data from the database and attaches a structured `req.scopes` object
 * that downstream authorization middleware can inspect.
 *
 * req.scopes = {
 *   user           – Mongoose user document (with memberships populated)
 *   platformRoles  – string[] of platform-level roles (e.g. ['SUPER_ADMIN'])
 *   memberships    – raw memberships array from user doc
 *   tenantMemberships – raw tenantMemberships array from user doc
 *   vmfGrants      – raw vmfGrants array from user doc
 *   isPlatformUser – boolean shortcut
 * }
 */

import { User } from '../models/index.js'
import logger from '../config/logger.js'

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

    const user = await User.findById(userId)

    if (!user) {
      logger.warn({ userId, requestId: req.requestId }, 'loadScopes — user not found')
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'User not found. Please sign in again.',
          requestId: req.requestId,
        },
      })
    }

    if (!user.isActive) {
      logger.warn({ userId, requestId: req.requestId }, 'loadScopes — user disabled')
      return res.status(401).json({
        error: {
          code: 'AUTH_ACCOUNT_DISABLED',
          message: 'Your account has been disabled. Contact your administrator.',
          requestId: req.requestId,
        },
      })
    }

    // Extract platform-level roles (memberships where customerId is null)
    const platformRoles = user.memberships
      .filter((m) => m.customerId === null || m.customerId === undefined)
      .flatMap((m) => m.roles)

    req.scopes = {
      user,
      platformRoles,
      memberships: user.memberships,
      tenantMemberships: user.tenantMemberships,
      vmfGrants: user.vmfGrants,
      isPlatformUser: platformRoles.length > 0,
    }

    next()
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'loadScopes — unexpected error')
    next(err)
  }
}

export default loadScopes
