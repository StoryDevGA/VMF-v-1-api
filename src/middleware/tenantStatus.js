/**
 * Tenant Status Enforcement Middleware
 *
 * Rejects requests scoped to a disabled tenant with 403.
 *
 * Per BACKEND-SPEC §8.2:
 *   - When tenant.status === 'DISABLED', all API calls scoped to that
 *     tenant must be rejected.
 *   - Listing endpoints that return tenants (e.g. GET /tenants) should
 *     still include disabled tenants with their status — those routes
 *     should NOT apply this middleware.
 *
 * Expects req.scopes.tenant to be populated (by requireTenantAccess or
 * by a preceding middleware). If not present, attempts to load the
 * tenant from req.params.tenantId.
 */

import { Tenant } from '../models/index.js'
import logger from '../config/logger.js'

const requireTenantEnabled = async (req, res, next) => {
  try {
    let tenant = req.scopes?.tenant

    // If tenant isn't already loaded, try to load from params
    if (!tenant && req.params.tenantId) {
      tenant = await Tenant.findById(req.params.tenantId)
      if (tenant && req.scopes) {
        req.scopes.tenant = tenant
      }
    }

    if (!tenant) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Tenant not found.',
          requestId: req.requestId,
        },
      })
    }

    if (tenant.status === 'DISABLED') {
      logger.warn(
        { tenantId: tenant._id, customerId: tenant.customerId, requestId: req.requestId },
        'requireTenantEnabled — tenant is disabled',
      )
      return res.status(403).json({
        error: {
          code: 'TENANT_DISABLED',
          message: 'This tenant is currently disabled. Contact your administrator.',
          requestId: req.requestId,
        },
      })
    }

    if (tenant.status === 'ARCHIVED') {
      logger.warn(
        { tenantId: tenant._id, customerId: tenant.customerId, requestId: req.requestId },
        'requireTenantEnabled — tenant is archived',
      )
      return res.status(403).json({
        error: {
          code: 'TENANT_DISABLED',
          message: 'This tenant has been archived and is no longer accessible.',
          requestId: req.requestId,
        },
      })
    }

    next()
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'requireTenantEnabled — unexpected error')
    next(err)
  }
}

export default requireTenantEnabled
