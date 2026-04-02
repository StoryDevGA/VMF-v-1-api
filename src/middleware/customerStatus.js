import { Customer, Deal, Tenant, User, VMF } from '../models/index.js'
import logger from '../config/logger.js'
import env from '../config/env.js'
import monitoringService from '../services/monitoringService.js'
import performanceCacheService, {
  buildCustomerTopologySnapshot,
  buildTenantStatusSnapshot,
  buildLegacyUserPermissionsSnapshot,
} from '../services/performanceCacheService.js'

const ACTIVE_CUSTOMER_STATUS = 'ACTIVE'
export const INACTIVE_CUSTOMER_REASON = 'CUSTOMER_INACTIVE'
export const INACTIVE_CUSTOMER_MESSAGE = 'This customer is inactive. Contact your administrator.'

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const getOrInitScopes = (req) => {
  if (!req.scopes) req.scopes = {}
  return req.scopes
}

const loadCustomer = async (customerId) => {
  if (!customerId) return null

  const cachedCustomer = await performanceCacheService.getCustomerTopology(customerId)
  if (cachedCustomer) return cachedCustomer

  const customer = await Customer.findById(customerId)
  if (!customer) return null

  await performanceCacheService.setCustomerTopology(
    customer._id,
    buildCustomerTopologySnapshot(customer),
  )

  return customer
}

const loadTenant = async (tenantId) => {
  if (!tenantId) return null

  const cachedTenant = await performanceCacheService.getTenantStatus(tenantId)
  if (cachedTenant) return cachedTenant

  const tenant = await Tenant.findById(tenantId)
  if (!tenant) return null

  await performanceCacheService.setTenantStatus(
    tenant._id,
    buildTenantStatusSnapshot(tenant),
  )

  return tenant
}

const loadUser = async (userId) => {
  if (!userId) return null

  const cachedUserPermissions = await performanceCacheService.getUserPermissions(userId)
  if (cachedUserPermissions?.user) return cachedUserPermissions.user

  const user = await User.findById(userId)
  if (!user) return null

  await performanceCacheService.setUserPermissions(
    user._id,
    buildLegacyUserPermissionsSnapshot(user),
  )

  return user
}

const resolvePrimaryCustomerIdFromUser = (user) =>
  (user?.memberships || []).find((membership) => membership?.customerId)?.customerId
  || (user?.tenantMemberships || []).find((membership) => membership?.customerId)?.customerId
  || null

export const buildInactiveCustomerErrorResponse = ({
  requestId,
  customerStatus = null,
  inactiveCustomerIds = [],
} = {}) => {
  const details = {
    reason: INACTIVE_CUSTOMER_REASON,
  }

  if (customerStatus) {
    details.customerStatus = customerStatus
  }

  if (Array.isArray(inactiveCustomerIds) && inactiveCustomerIds.length > 0) {
    details.inactiveCustomerIds = inactiveCustomerIds
  }

  return {
    error: {
      code: INACTIVE_CUSTOMER_REASON,
      message: INACTIVE_CUSTOMER_MESSAGE,
      details,
      requestId,
    },
  }
}

const resolveCustomerForRequest = async (req) => {
  const scopes = getOrInitScopes(req)

  if (scopes.customer) {
    return scopes.customer
  }

  if (req.params?.customerId) {
    const customer = await loadCustomer(req.params.customerId)
    if (customer) scopes.customer = customer
    return customer
  }

  if (scopes.tenant?.customerId) {
    const customer = await loadCustomer(scopes.tenant.customerId)
    if (customer) scopes.customer = customer
    return customer
  }

  if (req.params?.tenantId) {
    const tenant = scopes.tenant || await loadTenant(req.params.tenantId)
    if (tenant) {
      scopes.tenant = tenant
      const customer = await loadCustomer(tenant.customerId)
      if (customer) scopes.customer = customer
      return customer
    }
  }

  if (scopes.vmf?.customerId) {
    const customer = await loadCustomer(scopes.vmf.customerId)
    if (customer) scopes.customer = customer
    return customer
  }

  if (req.params?.vmfId) {
    const vmf = scopes.vmf || await VMF.findById(req.params.vmfId)
    if (vmf) {
      scopes.vmf = vmf
      const customer = await loadCustomer(vmf.customerId)
      if (customer) scopes.customer = customer
      return customer
    }
  }

  if (req.params?.dealId) {
    const deal = await Deal.findById(req.params.dealId).select('customerId')
    if (deal?.customerId) {
      const customer = await loadCustomer(deal.customerId)
      if (customer) scopes.customer = customer
      return customer
    }
  }

  if (req.params?.userId) {
    const user = await loadUser(req.params.userId)
    const customerId = resolvePrimaryCustomerIdFromUser(user)
    if (customerId) {
      const customer = await loadCustomer(customerId)
      if (customer) scopes.customer = customer
      return customer
    }
  }

  return null
}

export const requireCustomerActive = (options = {}) => async (req, res, next) => {
  try {
    if (!env.governanceInactiveEnforcementEnabled) {
      return next()
    }

    const { allowMissingCustomer = true } = options
    const customer = await resolveCustomerForRequest(req)

    if (!customer) {
      if (allowMissingCustomer) return next()

      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Customer not found.',
          requestId: req.requestId,
        },
      })
    }

    if (customer.status !== ACTIVE_CUSTOMER_STATUS) {
      monitoringService.recordInactiveCustomerBlock({ surface: 'customer_status_middleware' })
      logger.warn(
        {
          userId: req.userId,
          customerId: toIdString(customer._id),
          customerStatus: customer.status,
          requestId: req.requestId,
        },
        'requireCustomerActive - customer inactive',
      )
      return res.status(403).json(buildInactiveCustomerErrorResponse({
        requestId: req.requestId,
        customerStatus: customer.status,
      }))
    }

    return next()
  } catch (err) {
    logger.error({ err, requestId: req.requestId }, 'requireCustomerActive - unexpected error')
    return next(err)
  }
}

export default requireCustomerActive
