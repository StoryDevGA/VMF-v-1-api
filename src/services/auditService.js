/**
 * Audit Service
 *
 * Centralized audit logging service that wraps the AuditLog model.
 * Provides:
 *   - `log()`             — create a single audit entry with HMAC signature
 *   - `logFromRequest()`  — convenience: extracts actor/ip/userAgent/requestId from Express req
 *   - `query()`           — paginated, multi-filter audit log queries
 *   - `getByResource()`   — logs for a specific resource
 *   - `getByRequestId()`  — correlation lookup
 *   - `verifyIntegrity()` — batch HMAC verification for tamper detection
 *   - `getStats()`        — aggregate statistics for dashboard / monitoring
 *
 * All writes go through AuditLog.createLog() which triggers the
 * pre-save HMAC signature generation on the model layer.
 */

import { AuditLog } from '../models/index.js'
import logger from '../config/logger.js'

/* ------------------------------------------------------------------ */
/*  Canonical action & resourceType registries                        */
/* ------------------------------------------------------------------ */

export const AUDIT_ACTIONS = Object.freeze({
  // Customer
  CUSTOMER_CREATED: 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED: 'CUSTOMER_UPDATED',
  CUSTOMER_STATUS_CHANGED: 'CUSTOMER_STATUS_CHANGED',
  CUSTOMER_ADMIN_ASSIGNED: 'CUSTOMER_ADMIN_ASSIGNED',
  CUSTOMER_LIMITS_CHANGED: 'CUSTOMER_LIMITS_CHANGED',
  CUSTOMER_LICENSE_CHANGED: 'CUSTOMER_LICENSE_CHANGED',
  // License level
  LICENSE_LEVEL_CREATED: 'LICENSE_LEVEL_CREATED',
  LICENSE_LEVEL_UPDATED: 'LICENSE_LEVEL_UPDATED',
  // Tenant
  TENANT_CREATED: 'TENANT_CREATED',
  TENANT_UPDATED: 'TENANT_UPDATED',
  TENANT_ENABLED: 'TENANT_ENABLED',
  TENANT_DISABLED: 'TENANT_DISABLED',
  TENANT_LIMIT_REJECTED: 'TENANT_LIMIT_REJECTED',
  // User
  USER_CREATED: 'USER_CREATED',
  USER_INVITED: 'USER_INVITED',
  USER_ROLE_UPDATED: 'USER_ROLE_UPDATED',
  USER_DISABLED: 'USER_DISABLED',
  USER_DELETED: 'USER_DELETED',
  // Bulk
  BULK_USERS_CREATED: 'BULK_USERS_CREATED',
  BULK_USERS_UPDATED: 'BULK_USERS_UPDATED',
  BULK_USERS_DISABLED: 'BULK_USERS_DISABLED',
  // VMF
  VMF_CREATED: 'VMF_CREATED',
  VMF_UPDATED: 'VMF_UPDATED',
  VMF_DELETED: 'VMF_DELETED',
  VMF_GRANT_CREATED: 'VMF_GRANT_CREATED',
  VMF_GRANT_REVOKED: 'VMF_GRANT_REVOKED',
  VMF_LIMIT_REJECTED: 'VMF_LIMIT_REJECTED',
  // Deal
  DEAL_CREATED: 'DEAL_CREATED',
  DEAL_UPDATED: 'DEAL_UPDATED',
  DEAL_ARCHIVED: 'DEAL_ARCHIVED',
  // Identity Plus
  IDENTITY_PLUS_REGISTRATION_COMPLETE: 'IDENTITY_PLUS_REGISTRATION_COMPLETE',
  IDENTITY_PLUS_TRUST_UPDATED: 'IDENTITY_PLUS_TRUST_UPDATED',
  // Super Admin - Governance
  SYSTEM_VERSIONING_POLICY_UPDATED: 'SYSTEM_VERSIONING_POLICY_UPDATED',
  GOVERNANCE_OVERRIDE_APPLIED: 'GOVERNANCE_OVERRIDE_APPLIED',
  GOVERNANCE_OVERRIDE_DENIED: 'GOVERNANCE_OVERRIDE_DENIED',
  // Super Admin - Access denied
  ACCESS_DENIED: 'ACCESS_DENIED',
  // Super Admin - Invitations
  INVITATION_CREATED: 'INVITATION_CREATED',
  INVITATION_SENT: 'INVITATION_SENT',
  INVITATION_SEND_FAILED: 'INVITATION_SEND_FAILED',
  INVITATION_RESENT: 'INVITATION_RESENT',
  INVITATION_REVOKED: 'INVITATION_REVOKED',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  INVITATION_AUTHENTICATION_SUCCEEDED: 'INVITATION_AUTHENTICATION_SUCCEEDED',
  INVITATION_AUTHENTICATION_FAILED: 'INVITATION_AUTHENTICATION_FAILED',
  INVITATION_AUTH_LINK_ACCESSED: 'INVITATION_AUTH_LINK_ACCESSED',
  ONBOARDING_TRANSACTION_FAILED: 'ONBOARDING_TRANSACTION_FAILED',
  // Super Admin - Customer admin
  CUSTOMER_ADMIN_REPLACED: 'CUSTOMER_ADMIN_REPLACED',
  CUSTOMER_ADMIN_CANONICAL_SET: 'CUSTOMER_ADMIN_CANONICAL_SET',
  CUSTOMER_ADMIN_MUTATION_BLOCKED: 'CUSTOMER_ADMIN_MUTATION_BLOCKED',
  // Super Admin - Optional visibility events
  AUDIT_LOG_VIEWED: 'AUDIT_LOG_VIEWED',
  DENIED_ACCESS_LOG_VIEWED: 'DENIED_ACCESS_LOG_VIEWED',
})

export const RESOURCE_TYPES = Object.freeze({
  Customer: 'Customer',
  Tenant: 'Tenant',
  User: 'User',
  VMF: 'VMF',
  Deal: 'Deal',
  Invitation: 'Invitation',
  SystemVersioningPolicy: 'SystemVersioningPolicy',
  AuditLog: 'AuditLog',
  LicenseLevel: 'LicenseLevel',
})

/* ------------------------------------------------------------------ */
/*  Core logging                                                      */
/* ------------------------------------------------------------------ */

/**
 * Create a single audit log entry.
 *
 * @param {Object} data
 * @param {string} data.actorUserId   — ObjectId of the acting user
 * @param {string} data.action        — one of AUDIT_ACTIONS
 * @param {string} data.resourceType  — one of RESOURCE_TYPES
 * @param {string} data.resourceId    — ObjectId of the affected resource
 * @param {Object} [data.scope]       — { customerId?, tenantId?, vmfId? }
 * @param {Object} [data.diff]        — change delta
 * @param {string} [data.ip]          — client IP
 * @param {string} [data.userAgent]   — client user-agent
 * @param {string} [data.requestId]   — correlation request ID
 * @returns {Promise<Object>}         — saved AuditLog document
 */
const log = async (data) => {
  try {
    return await AuditLog.createLog(data)
  } catch (err) {
    logger.error({ err, action: data.action, resourceType: data.resourceType, resourceId: data.resourceId }, 'audit log write failed')
    // Never throw — audit failures must not break business operations
    return null
  }
}

/**
 * Convenience wrapper that extracts request context automatically.
 *
 * @param {import('express').Request} req
 * @param {Object} data — same as log() but without ip/userAgent/requestId/actorUserId
 * @param {string} [data.actorUserId] — defaults to req.context.userId || req.userId
 */
const logFromRequest = async (req, data) => {
  const actorUserId = data.actorUserId || req?.context?.userId || req?.userId
  return log({
    ...data,
    actorUserId,
    ip: req?.ip,
    userAgent: req?.get?.('user-agent'),
    requestId: req?.requestId,
  })
}

/* ------------------------------------------------------------------ */
/*  Query helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Paginated, multi-filter audit log query.
 *
 * @param {Object} filters
 * @param {string}  [filters.customerId]   — scope.customerId filter
 * @param {string}  [filters.tenantId]     — scope.tenantId filter
 * @param {string}  [filters.actorUserId]  — actorUserId filter
 * @param {string}  [filters.action]       — exact action match
 * @param {string}  [filters.resourceType] — exact resourceType match
 * @param {string}  [filters.resourceId]   — exact resourceId match
 * @param {string}  [filters.requestId]    — correlation ID match
 * @param {Date}    [filters.startDate]    — ts >= startDate
 * @param {Date}    [filters.endDate]      — ts <= endDate
 * @param {number}  [filters.page=1]       — 1-indexed page
 * @param {number}  [filters.pageSize=50]  — items per page
 * @returns {Promise<{ data: Object[], meta: Object }>}
 */
const query = async (filters = {}) => {
  const {
    customerId,
    tenantId,
    actorUserId,
    action,
    resourceType,
    resourceId,
    requestId,
    startDate,
    endDate,
    page = 1,
    pageSize = 50,
  } = filters

  const mongoQuery = {}

  if (customerId) mongoQuery['scope.customerId'] = customerId
  if (tenantId) mongoQuery['scope.tenantId'] = tenantId
  if (actorUserId) mongoQuery.actorUserId = actorUserId
  if (action) mongoQuery.action = action
  if (resourceType) mongoQuery.resourceType = resourceType
  if (resourceId) mongoQuery.resourceId = resourceId
  if (requestId) mongoQuery.requestId = requestId

  if (startDate || endDate) {
    mongoQuery.ts = {}
    if (startDate) mongoQuery.ts.$gte = new Date(startDate)
    if (endDate) mongoQuery.ts.$lte = new Date(endDate)
  }

  const skip = (page - 1) * pageSize

  const [data, totalCount] = await Promise.all([
    AuditLog.find(mongoQuery)
      .populate('actorUserId', 'name email')
      .sort({ ts: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    AuditLog.countDocuments(mongoQuery),
  ])

  return {
    data,
    meta: {
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    },
  }
}

/**
 * Get all audit logs for a specific resource.
 */
const getByResource = async (resourceType, resourceId, options = {}) => {
  const { page = 1, pageSize = 50 } = options
  return query({ resourceType, resourceId, page, pageSize })
}

/**
 * Get all audit logs correlated by request ID.
 */
const getByRequestId = async (requestId) => {
  const data = await AuditLog.find({ requestId }).sort({ ts: 1 }).lean()
  return { data, meta: { totalCount: data.length } }
}

/* ------------------------------------------------------------------ */
/*  Integrity verification                                            */
/* ------------------------------------------------------------------ */

/**
 * Verify HMAC signatures on a batch of audit log documents.
 *
 * @param {Object} options
 * @param {string[]} [options.ids]          — specific log IDs to verify
 * @param {string}   [options.customerId]   — verify all logs for a customer
 * @param {Date}     [options.startDate]    — date range start
 * @param {Date}     [options.endDate]      — date range end
 * @param {number}   [options.limit=1000]   — max docs to verify
 * @returns {Promise<{ total: number, valid: number, invalid: number, invalidIds: string[] }>}
 */
const verifyIntegrity = async (options = {}) => {
  const { ids, customerId, startDate, endDate, limit = 1000 } = options

  const mongoQuery = {}

  if (ids && ids.length > 0) {
    mongoQuery._id = { $in: ids }
  }
  if (customerId) {
    mongoQuery['scope.customerId'] = customerId
  }
  if (startDate || endDate) {
    mongoQuery.ts = {}
    if (startDate) mongoQuery.ts.$gte = new Date(startDate)
    if (endDate) mongoQuery.ts.$lte = new Date(endDate)
  }

  // We need full Mongoose documents (not lean) for verifySignature()
  const logs = await AuditLog.find(mongoQuery)
    .sort({ ts: -1 })
    .limit(limit)

  let valid = 0
  let invalid = 0
  const invalidIds = []

  for (const logDoc of logs) {
    if (logDoc.verifySignature()) {
      valid++
    } else {
      invalid++
      invalidIds.push(logDoc._id.toString())
    }
  }

  return {
    total: logs.length,
    valid,
    invalid,
    invalidIds,
  }
}

/* ------------------------------------------------------------------ */
/*  Statistics / aggregation                                          */
/* ------------------------------------------------------------------ */

/**
 * Get audit statistics for monitoring dashboards.
 *
 * @param {Object} options
 * @param {string} [options.customerId] — scope to a customer
 * @param {Date}   [options.startDate]  — period start
 * @param {Date}   [options.endDate]    — period end
 * @returns {Promise<Object>}
 */
const getStats = async (options = {}) => {
  const { customerId, startDate, endDate } = options

  const match = {}
  if (customerId) match['scope.customerId'] = customerId
  if (startDate || endDate) {
    match.ts = {}
    if (startDate) match.ts.$gte = new Date(startDate)
    if (endDate) match.ts.$lte = new Date(endDate)
  }

  const pipeline = [
    { $match: match },
    {
      $facet: {
        byAction: [
          { $group: { _id: '$action', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ],
        byResourceType: [
          { $group: { _id: '$resourceType', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ],
        byActor: [
          { $group: { _id: '$actorUserId', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ],
        total: [
          { $count: 'count' },
        ],
      },
    },
  ]

  const [result] = await AuditLog.aggregate(pipeline)

  return {
    total: result.total[0]?.count || 0,
    byAction: result.byAction,
    byResourceType: result.byResourceType,
    topActors: result.byActor,
  }
}

/* ------------------------------------------------------------------ */
/*  Export                                                            */
/* ------------------------------------------------------------------ */

const auditService = {
  log,
  logFromRequest,
  query,
  getByResource,
  getByRequestId,
  verifyIntegrity,
  getStats,
  AUDIT_ACTIONS,
  RESOURCE_TYPES,
}

export default auditService
