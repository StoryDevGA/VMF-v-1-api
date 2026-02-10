/**
 * Topology Guard Middleware
 *
 * Enforces topology-level constraints for the Customer → Tenant → VMF
 * hierarchy:
 *
 * 1. Single-tenant customers: validates that the tenantId in the URL
 *    matches the customer's defaultTenantId. Direct tenant access is
 *    hidden from the UI for single-tenant customers, so any mismatch
 *    is a programming error or an attack.
 *
 * 2. VMF creation constraints: respects the customer's vmfPolicy
 *    (SINGLE, MULTI, PER_TENANT_SINGLE, PER_TENANT_MULTI) when the
 *    request is a VMF-creating POST.
 *
 * 3. Cross-tenant VMF access prevention: when a VMF is loaded via
 *    req.scopes.vmf (set by requireVmfAccess), confirms the VMF's
 *    tenantId matches the route's tenantId.
 *
 * Expects:
 *   - req.scopes.customer to be populated (by requireCustomerAccess
 *     or requireTenantAccess)
 *   - req.scopes.tenant (optional, populated by requireTenantAccess)
 *   - req.scopes.vmf   (optional, populated by requireVmfAccess)
 */

import { VMF } from '../models/index.js'
import logger from '../config/logger.js'

const topologyGuard = async (req, res, next) => {
  try {
    const customer = req.scopes?.customer
    const tenantId = req.params.tenantId

    if (!customer) {
      return res.status(500).json({
        error: {
          code: 'SERVER_ERROR',
          message: 'Customer context not loaded for topology guard.',
          requestId: req.requestId,
        },
      })
    }

    /* -------------------------------------------------------------- */
    /*  1. Single-tenant tenant-id validation                         */
    /* -------------------------------------------------------------- */
    if (customer.topology === 'SINGLE_TENANT' && tenantId) {
      const defaultTenantId = customer.defaultTenantId?.toString()

      if (!defaultTenantId) {
        logger.error(
          { customerId: customer._id, requestId: req.requestId },
          'topologyGuard — single-tenant customer missing defaultTenantId',
        )
        return res.status(500).json({
          error: {
            code: 'SERVER_ERROR',
            message: 'Customer configuration error: missing default tenant.',
            requestId: req.requestId,
          },
        })
      }

      if (tenantId !== defaultTenantId) {
        logger.warn(
          { customerId: customer._id, tenantId, defaultTenantId, requestId: req.requestId },
          'topologyGuard — tenant mismatch for single-tenant customer',
        )
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Single-tenant customers cannot access other tenants.',
            requestId: req.requestId,
          },
        })
      }
    }

    /* -------------------------------------------------------------- */
    /*  2. VMF creation constraint (only on POST to VMF endpoints)    */
    /* -------------------------------------------------------------- */
    if (req.method === 'POST' && tenantId && isVmfCreationRoute(req)) {
      const vmfPolicy = customer.vmfPolicy
      const existingCount = await VMF.countByTenant(tenantId, 'ACTIVE')

      if (vmfPolicy === 'SINGLE' && existingCount >= 1) {
        return res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'This customer allows only one VMF.',
            requestId: req.requestId,
          },
        })
      }

      if (vmfPolicy === 'PER_TENANT_SINGLE' && existingCount >= 1) {
        return res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'This tenant allows only one VMF.',
            requestId: req.requestId,
          },
        })
      }
    }

    /* -------------------------------------------------------------- */
    /*  3. Cross-tenant VMF access prevention                         */
    /* -------------------------------------------------------------- */
    const vmf = req.scopes?.vmf
    if (vmf && tenantId) {
      if (vmf.tenantId.toString() !== tenantId) {
        logger.warn(
          { vmfId: vmf._id, vmfTenantId: vmf.tenantId, routeTenantId: tenantId, requestId: req.requestId },
          'topologyGuard — cross-tenant VMF access attempt',
        )
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Cannot access a VMF belonging to a different tenant.',
            requestId: req.requestId,
          },
        })
      }
    }

    next()
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'topologyGuard — unexpected error')
    next(err)
  }
}

/* ------------------------------------------------------------------ */
/*  Route detection helper                                            */
/* ------------------------------------------------------------------ */

/**
 * Returns true when the current request appears to be a VMF creation
 * route (POST to a path ending in /vmfs or /vmfs/).
 */
function isVmfCreationRoute(req) {
  const path = req.baseUrl + req.path
  return /\/vmfs\/?$/.test(path)
}

export default topologyGuard
