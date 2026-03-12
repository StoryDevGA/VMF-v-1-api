import { Tenant } from '../models/index.js'

const MULTI_TENANT_TOPOLOGY = 'MULTI_TENANT'
const SELECTABLE_TENANT_STATUS = 'ENABLED'

export const TENANT_VISIBILITY_REASONS = Object.freeze({
  NOT_ALLOWED: 'TENANT_VISIBILITY_NOT_ALLOWED',
  INVALID_TENANT_IDS: 'TENANT_VISIBILITY_INVALID_TENANT_IDS',
})

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const resolveTenantVisibilityMessage = (reason) => {
  if (reason === TENANT_VISIBILITY_REASONS.NOT_ALLOWED) {
    return 'Tenant visibility is not allowed in this mode.'
  }

  if (reason === TENANT_VISIBILITY_REASONS.INVALID_TENANT_IDS) {
    return 'One or more tenant IDs are invalid or do not belong to this customer.'
  }

  return 'Tenant visibility validation failed.'
}

export const getTenantVisibilityMode = (customer) =>
  customer?.topology === MULTI_TENANT_TOPOLOGY ? 'OPTIONAL' : 'DISALLOWED'

export const isTenantVisibilityAllowed = (customer) =>
  getTenantVisibilityMode(customer) === 'OPTIONAL'

export const buildTenantVisibilityErrorPayload = ({
  customer,
  reason,
  invalidTenantIds,
  message,
  requestId,
}) => {
  const resolvedMessage = message || resolveTenantVisibilityMessage(reason)

  return {
    code: 'VALIDATION_FAILED',
    message: resolvedMessage,
    details: {
      tenantVisibility: resolvedMessage,
      reason,
      tenantVisibilityMode: getTenantVisibilityMode(customer),
      topology: customer?.topology || null,
      isServiceProvider: Boolean(customer?.isServiceProvider),
      ...(Array.isArray(invalidTenantIds) && invalidTenantIds.length > 0
        ? { invalidTenantIds }
        : {}),
    },
    ...(requestId ? { requestId } : {}),
  }
}

export const buildTenantVisibilityErrorResponse = ({
  req,
  customer,
  reason,
  invalidTenantIds,
  message,
}) => ({
  error: buildTenantVisibilityErrorPayload({
    customer,
    reason,
    invalidTenantIds,
    message,
    requestId: req.requestId,
  }),
})

export const validateTenantVisibilityPayload = async ({
  req,
  customer,
  customerId,
  tenantVisibility,
  countDocuments = (filter) => Tenant.countDocuments(filter),
}) => {
  if (tenantVisibility === undefined) return null

  if (!isTenantVisibilityAllowed(customer)) {
    return buildTenantVisibilityErrorResponse({
      req,
      customer,
      reason: TENANT_VISIBILITY_REASONS.NOT_ALLOWED,
    })
  }

  if (tenantVisibility.length === 0) return null

  const validTenants = await countDocuments({
    _id: { $in: tenantVisibility },
    customerId,
  })

  if (validTenants !== tenantVisibility.length) {
    return buildTenantVisibilityErrorResponse({
      req,
      customer,
      reason: TENANT_VISIBILITY_REASONS.INVALID_TENANT_IDS,
    })
  }

  return null
}

export const mapTenantVisibilityCatalogEntry = (tenant) => {
  const baseTenant = tenant && typeof tenant.toJSON === 'function'
    ? tenant.toJSON()
    : { ...(tenant || {}) }
  const status = tenant?.status || null
  const id = toIdString(baseTenant?._id || baseTenant?.id || tenant?._id || tenant?.id)

  return {
    ...baseTenant,
    id,
    isSelectable: status === SELECTABLE_TENANT_STATUS,
    selectionState: status === SELECTABLE_TENANT_STATUS ? 'SELECTABLE' : status || 'UNKNOWN',
  }
}

export const buildTenantVisibilityCatalogMeta = ({ customer }) => ({
  mode: getTenantVisibilityMode(customer),
  allowed: isTenantVisibilityAllowed(customer),
  topology: customer?.topology || null,
  isServiceProvider: Boolean(customer?.isServiceProvider),
  selectableStatuses: [SELECTABLE_TENANT_STATUS],
})
