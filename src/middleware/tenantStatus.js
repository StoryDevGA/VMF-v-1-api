/**
 * Tenant Status Enforcement Middleware
 *
 * Rejects requests scoped to a disabled tenant with 403.
 */

import { Tenant } from '../models/index.js'
import logger from '../config/logger.js'
import performanceCacheService, {
  buildTenantStatusSnapshot,
} from '../services/performanceCacheService.js'

const resolveTenant = async (req) => {
  if (req.scopes?.tenant) {
    await performanceCacheService.setTenantStatus(
      req.scopes.tenant._id,
      buildTenantStatusSnapshot(req.scopes.tenant),
    )
    return req.scopes.tenant
  }

  const tenantId = req.params.tenantId
  if (!tenantId) return null

  const cachedTenant = await performanceCacheService.getTenantStatus(tenantId)
  if (cachedTenant) return cachedTenant

  const tenant = await Tenant.findById(tenantId)
  if (!tenant) return null

  await performanceCacheService.setTenantStatus(tenant._id, buildTenantStatusSnapshot(tenant))
  return tenant
}

const requireTenantEnabled = async (req, res, next) => {
  try {
    const tenant = await resolveTenant(req)

    if (tenant && req.scopes) {
      req.scopes.tenant = tenant
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
        'requireTenantEnabled - tenant is disabled',
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
        'requireTenantEnabled - tenant is archived',
      )
      return res.status(403).json({
        error: {
          code: 'TENANT_DISABLED',
          message: 'This tenant has been archived and is no longer accessible.',
          requestId: req.requestId,
        },
      })
    }

    return next()
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'requireTenantEnabled - unexpected error')
    next(err)
  }
}

export default requireTenantEnabled
