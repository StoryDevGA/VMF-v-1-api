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
  // Role
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_UPDATED: 'ROLE_UPDATED',
  ROLE_DELETED: 'ROLE_DELETED',
  ROLE_MUTATION_BLOCKED: 'ROLE_MUTATION_BLOCKED',
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
  USER_ENABLED: 'USER_ENABLED',
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
  FRAMEWORK_PACKAGE_CREATED: 'FRAMEWORK_PACKAGE_CREATED',
  FRAMEWORK_PACKAGE_UPDATED: 'FRAMEWORK_PACKAGE_UPDATED',
  FRAMEWORK_PACKAGE_VALIDATED: 'FRAMEWORK_PACKAGE_VALIDATED',
  FRAMEWORK_PACKAGE_ACTIVATED: 'FRAMEWORK_PACKAGE_ACTIVATED',
  FRAMEWORK_PACKAGE_CLONED: 'FRAMEWORK_PACKAGE_CLONED',
  FRAMEWORK_REGISTRY_CREATED: 'FRAMEWORK_REGISTRY_CREATED',
  FRAMEWORK_REGISTRY_UPDATED: 'FRAMEWORK_REGISTRY_UPDATED',
  RUNTIME_AGENT_CREATED: 'RUNTIME_AGENT_CREATED',
  RUNTIME_AGENT_UPDATED: 'RUNTIME_AGENT_UPDATED',
  RUNTIME_AGENT_CLONED: 'RUNTIME_AGENT_CLONED',
  RUNTIME_AGENT_VALIDATED: 'RUNTIME_AGENT_VALIDATED',
  RUNTIME_AGENT_TESTED: 'RUNTIME_AGENT_TESTED',
  RUNTIME_AGENT_ACTIVATED: 'RUNTIME_AGENT_ACTIVATED',
  RUNTIME_AGENT_DISABLED: 'RUNTIME_AGENT_DISABLED',
  RUNTIME_AGENT_DEPRECATED: 'RUNTIME_AGENT_DEPRECATED',
  RUNTIME_SKILL_CREATED: 'RUNTIME_SKILL_CREATED',
  RUNTIME_SKILL_UPDATED: 'RUNTIME_SKILL_UPDATED',
  RUNTIME_PATH_CREATED: 'RUNTIME_PATH_CREATED',
  RUNTIME_PATH_UPDATED: 'RUNTIME_PATH_UPDATED',
  RUNTIME_PATH_CLONED: 'RUNTIME_PATH_CLONED',
  RUNTIME_PATH_DUPLICATED: 'RUNTIME_PATH_DUPLICATED',
  RUNTIME_PATH_ACTIVATED: 'RUNTIME_PATH_ACTIVATED',
  RUNTIME_PATH_DISABLED: 'RUNTIME_PATH_DISABLED',
  RUNTIME_PATH_DEPRECATED: 'RUNTIME_PATH_DEPRECATED',
  SKILL_ROLE_CREATED: 'SKILL_ROLE_CREATED',
  SKILL_ROLE_UPDATED: 'SKILL_ROLE_UPDATED',
  VALIDATION_REGISTRY_CREATED: 'VALIDATION_REGISTRY_CREATED',
  VALIDATION_REGISTRY_UPDATED: 'VALIDATION_REGISTRY_UPDATED',
  VALIDATION_REGISTRY_CLONED: 'VALIDATION_REGISTRY_CLONED',
  UI_CONTRACT_CREATED: 'UI_CONTRACT_CREATED',
  UI_CONTRACT_UPDATED: 'UI_CONTRACT_UPDATED',
  UI_CONTRACT_CLONED: 'UI_CONTRACT_CLONED',
  UI_CONTRACT_LOCKED: 'UI_CONTRACT_LOCKED',
  UI_CONTRACT_DEPRECATED: 'UI_CONTRACT_DEPRECATED',
  UI_CONTRACT_ARCHIVED: 'UI_CONTRACT_ARCHIVED',
  UI_CONTRACT_VALIDATION_RUN: 'UI_CONTRACT_VALIDATION_RUN',
  UI_CONTRACT_VALIDATION_FAILED: 'UI_CONTRACT_VALIDATION_FAILED',
  WORKFLOW_POLICY_CREATED: 'WORKFLOW_POLICY_CREATED',
  WORKFLOW_POLICY_UPDATED: 'WORKFLOW_POLICY_UPDATED',
  WORKFLOW_POLICY_CLONED: 'WORKFLOW_POLICY_CLONED',
  WORKFLOW_POLICY_TESTED: 'WORKFLOW_POLICY_TESTED',
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
  // Super Admin - Retention
  AUDIT_RETENTION_CLEANUP: 'AUDIT_RETENTION_CLEANUP',
})

export const RESOURCE_TYPES = Object.freeze({
  Customer: 'Customer',
  Tenant: 'Tenant',
  User: 'User',
  VMF: 'VMF',
  Deal: 'Deal',
  Invitation: 'Invitation',
  SystemVersioningPolicy: 'SystemVersioningPolicy',
  FrameworkPackage: 'FrameworkPackage',
  RuntimeAgent: 'RuntimeAgent',
  RuntimeSkill: 'RuntimeSkill',
  RuntimePathRegistry: 'RuntimePathRegistry',
  SkillRole: 'SkillRole',
  ValidationRegistry: 'ValidationRegistry',
  UIContract: 'UIContract',
  WorkflowPolicy: 'WorkflowPolicy',
  AuditLog: 'AuditLog',
  LicenseLevel: 'LicenseLevel',
  Role: 'Role',
  FrameworkRegistry: 'FrameworkRegistry',
})

/* ------------------------------------------------------------------ */
/*  Presentation helpers                                              */
/* ------------------------------------------------------------------ */

const SUMMARY_MAX_LENGTH = 240

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    if (typeof value.id === 'string' && value.id.trim()) return value.id
    if (typeof value._id === 'string' && value._id.trim()) return value._id
    if (value._id && typeof value._id.toString === 'function') return value._id.toString()
  }
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const normalizeText = (value) => {
  const text = String(value ?? '').trim()
  return text || null
}

const clampSummary = (value) => {
  const text = normalizeText(value)
  if (!text) return null
  if (text.length <= SUMMARY_MAX_LENGTH) return text
  return `${text.slice(0, SUMMARY_MAX_LENGTH - 1).trimEnd()}...`
}

const humanizeAuditAction = (value) => {
  const normalized = normalizeText(value)
  if (!normalized) return 'audit event'

  const acronymMap = {
    api: 'API',
    gdpr: 'GDPR',
    id: 'ID',
    vmf: 'VMF',
  }

  return normalized
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((segment) => acronymMap[segment] || (segment.charAt(0).toUpperCase() + segment.slice(1)))
    .join(' ')
}

const formatPermissionLabels = (permissions = []) => {
  if (!Array.isArray(permissions)) return []

  return Array.from(
    new Set(
      permissions
        .map((permission) => normalizeText(permission))
        .filter(Boolean),
    ),
  )
}

const formatEntityAuditLabel = (entity, options = {}) => {
  if (!entity) return null
  if (typeof entity === 'string') return normalizeText(entity)

  const fallbackType = normalizeText(options.fallbackType) || 'Resource'
  const labelKeys = Array.isArray(options.labelKeys) && options.labelKeys.length > 0
    ? options.labelKeys
    : ['name', 'title', 'label']

  const name = normalizeText(entity.name)
  const title = normalizeText(entity.title)
  const email = normalizeText(entity.email)

  if (name && email) return `${name} <${email}>`
  if (name) return name
  if (title) return title
  if (email) return email

  for (const key of labelKeys) {
    const value = normalizeText(entity?.[key])
    if (value) return value
  }

  const id = toIdString(entity.id || entity._id)
  return id ? `${fallbackType} ${id}` : fallbackType
}

const formatUserAuditLabel = (user) =>
  formatEntityAuditLabel(user, {
    fallbackType: 'User',
    labelKeys: ['name', 'email'],
  })

const formatActorAuditLabel = (req) => {
  if (req?.scopes?.platformRoles?.includes('SUPER_ADMIN')) return 'Super Admin'

  const scopedUserLabel = formatUserAuditLabel(req?.scopes?.user)
  if (scopedUserLabel) return scopedUserLabel

  const emailLabel = normalizeText(req?.userEmail)
  if (emailLabel) return emailLabel

  return 'User'
}

const inferTargetLabel = ({ resourceType, resourceId, diff, display }) => {
  const displayTarget =
    normalizeText(display?.targetLabel)
    || normalizeText(display?.resourceLabel)

  if (displayTarget) return displayTarget

  const diffName = normalizeText(diff?.name)
  const diffTitle = normalizeText(diff?.title)
  const diffEmail = normalizeText(diff?.email)

  if (diffName && diffEmail) return `${diffName} <${diffEmail}>`
  if (diffName) return diffName
  if (diffTitle) return diffTitle
  if (diffEmail) return diffEmail

  const id = toIdString(resourceId)
  if (resourceType && id) return `${resourceType} ${id}`
  if (resourceType) return resourceType

  return 'resource'
}

const normalizeDisplay = (display = {}) => {
  if (!display || typeof display !== 'object' || Array.isArray(display)) return null

  const normalized = {
    ...(normalizeText(display.actorLabel) ? { actorLabel: normalizeText(display.actorLabel) } : {}),
    ...(normalizeText(display.targetLabel) ? { targetLabel: normalizeText(display.targetLabel) } : {}),
    ...(normalizeText(display.resourceLabel) ? { resourceLabel: normalizeText(display.resourceLabel) } : {}),
    ...(normalizeText(display.scopeLabel) ? { scopeLabel: normalizeText(display.scopeLabel) } : {}),
  }

  const permissionLabels = formatPermissionLabels(
    display.permissionLabels || display.permissions || [],
  )

  if (permissionLabels.length > 0) {
    normalized.permissionLabels = permissionLabels
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

const buildAuditSummary = ({ action, resourceType, resourceId, diff, display }) => {
  const actorLabel = normalizeText(display?.actorLabel) || 'User'
  const targetLabel = inferTargetLabel({ resourceType, resourceId, diff, display })
  const scopeLabel = normalizeText(display?.scopeLabel)
  const permissionLabels = formatPermissionLabels(
    display?.permissionLabels || diff?.permissions || [],
  )
  const permissionLabel = permissionLabels.join(', ')
  const requirement = normalizeText(diff?.requiredPermission || diff?.requiredRole)
  const path = normalizeText(diff?.path)

  switch (action) {
    case AUDIT_ACTIONS.VMF_GRANT_CREATED:
      return clampSummary(
        `${actorLabel} granted ${targetLabel} ${permissionLabel ? `${permissionLabel} ` : ''}access to ${scopeLabel || 'the VMF'}`,
      )
    case AUDIT_ACTIONS.VMF_GRANT_REVOKED:
      return clampSummary(`${actorLabel} revoked ${targetLabel}'s access to ${scopeLabel || 'the VMF'}`)
    case AUDIT_ACTIONS.USER_ENABLED:
      return clampSummary(`${actorLabel} enabled ${targetLabel}`)
    case AUDIT_ACTIONS.USER_DISABLED:
      return clampSummary(`${actorLabel} disabled ${targetLabel}`)
    case AUDIT_ACTIONS.USER_DELETED:
      return clampSummary(`${actorLabel} deleted ${targetLabel}`)
    case AUDIT_ACTIONS.USER_CREATED:
      return clampSummary(`${actorLabel} created ${targetLabel}`)
    case AUDIT_ACTIONS.USER_INVITED:
      return clampSummary(`${actorLabel} invited ${targetLabel}`)
    case AUDIT_ACTIONS.USER_ROLE_UPDATED:
      if (diff?.tenantVisibility && !diff?.roles && !diff?.customerRoles) {
        return clampSummary(`${actorLabel} updated tenant visibility for ${targetLabel}`)
      }
      return clampSummary(`${actorLabel} updated roles for ${targetLabel}`)
    case AUDIT_ACTIONS.ROLE_CREATED:
      return clampSummary(`${actorLabel} created role ${targetLabel}`)
    case AUDIT_ACTIONS.ROLE_UPDATED:
      return clampSummary(`${actorLabel} updated role ${targetLabel}`)
    case AUDIT_ACTIONS.ROLE_DELETED:
      return clampSummary(`${actorLabel} deleted role ${targetLabel}`)
    case AUDIT_ACTIONS.ROLE_MUTATION_BLOCKED:
      return clampSummary(`${actorLabel} blocked role mutation for ${targetLabel}`)
    case AUDIT_ACTIONS.ACCESS_DENIED:
      if (requirement && path) {
        return clampSummary(`Access denied for ${actorLabel}: ${requirement} on ${path}`)
      }
      if (requirement) {
        return clampSummary(`Access denied for ${actorLabel}: missing ${requirement}`)
      }
      if (path) {
        return clampSummary(`Access denied for ${actorLabel} on ${path}`)
      }
      return clampSummary(`Access denied for ${actorLabel}`)
    case AUDIT_ACTIONS.CUSTOMER_CREATED:
      return clampSummary(`${actorLabel} created customer ${targetLabel}`)
    case AUDIT_ACTIONS.CUSTOMER_UPDATED:
      return clampSummary(`${actorLabel} updated customer ${targetLabel}`)
    case AUDIT_ACTIONS.CUSTOMER_STATUS_CHANGED:
      return clampSummary(`${actorLabel} changed customer status for ${targetLabel}`)
    case AUDIT_ACTIONS.TENANT_CREATED:
      return clampSummary(`${actorLabel} created tenant ${targetLabel}`)
    case AUDIT_ACTIONS.TENANT_UPDATED:
      return clampSummary(`${actorLabel} updated tenant ${targetLabel}`)
    case AUDIT_ACTIONS.TENANT_ENABLED:
      return clampSummary(`${actorLabel} enabled tenant ${targetLabel}`)
    case AUDIT_ACTIONS.TENANT_DISABLED:
      return clampSummary(`${actorLabel} disabled tenant ${targetLabel}`)
    case AUDIT_ACTIONS.VMF_CREATED:
      return clampSummary(`${actorLabel} created VMF ${targetLabel}`)
    case AUDIT_ACTIONS.VMF_UPDATED:
      return clampSummary(`${actorLabel} updated VMF ${targetLabel}`)
    case AUDIT_ACTIONS.VMF_DELETED:
      return clampSummary(`${actorLabel} deleted VMF ${targetLabel}`)
    case AUDIT_ACTIONS.DEAL_CREATED:
      return clampSummary(`${actorLabel} created deal ${targetLabel}`)
    case AUDIT_ACTIONS.DEAL_UPDATED:
      return clampSummary(`${actorLabel} updated deal ${targetLabel}`)
    case AUDIT_ACTIONS.DEAL_ARCHIVED:
      return clampSummary(`${actorLabel} archived deal ${targetLabel}`)
    case AUDIT_ACTIONS.FRAMEWORK_PACKAGE_CREATED:
      return clampSummary(`${actorLabel} created framework package ${targetLabel}`)
    case AUDIT_ACTIONS.FRAMEWORK_PACKAGE_UPDATED:
      return clampSummary(`${actorLabel} updated framework package ${targetLabel}`)
    case AUDIT_ACTIONS.FRAMEWORK_PACKAGE_VALIDATED:
      return clampSummary(`${actorLabel} validated framework package ${targetLabel}`)
    case AUDIT_ACTIONS.FRAMEWORK_PACKAGE_ACTIVATED:
      return clampSummary(`${actorLabel} activated framework package ${targetLabel}`)
    case AUDIT_ACTIONS.FRAMEWORK_PACKAGE_CLONED:
      return clampSummary(`${actorLabel} cloned framework package ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_AGENT_CREATED:
      return clampSummary(`${actorLabel} created runtime agent ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_AGENT_UPDATED:
      return clampSummary(`${actorLabel} updated runtime agent ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_AGENT_CLONED:
      return clampSummary(`${actorLabel} cloned runtime agent ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_AGENT_VALIDATED:
      return clampSummary(`${actorLabel} validated runtime agent ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_AGENT_TESTED:
      return clampSummary(`${actorLabel} tested runtime agent ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_AGENT_ACTIVATED:
      return clampSummary(`${actorLabel} activated runtime agent ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_AGENT_DISABLED:
      return clampSummary(`${actorLabel} disabled runtime agent ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_AGENT_DEPRECATED:
      return clampSummary(`${actorLabel} deprecated runtime agent ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_SKILL_CREATED:
      return clampSummary(`${actorLabel} created runtime skill ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_SKILL_UPDATED:
      return clampSummary(`${actorLabel} updated runtime skill ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_PATH_CREATED:
      return clampSummary(`${actorLabel} created runtime path ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_PATH_UPDATED:
      return clampSummary(`${actorLabel} updated runtime path ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_PATH_CLONED:
      return clampSummary(`${actorLabel} cloned runtime path ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_PATH_DUPLICATED:
      return clampSummary(`${actorLabel} duplicated runtime path ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_PATH_ACTIVATED:
      return clampSummary(`${actorLabel} activated runtime path ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_PATH_DISABLED:
      return clampSummary(`${actorLabel} disabled runtime path ${targetLabel}`)
    case AUDIT_ACTIONS.RUNTIME_PATH_DEPRECATED:
      return clampSummary(`${actorLabel} deprecated runtime path ${targetLabel}`)
    case AUDIT_ACTIONS.SKILL_ROLE_CREATED:
      return clampSummary(`${actorLabel} created skill role ${targetLabel}`)
    case AUDIT_ACTIONS.SKILL_ROLE_UPDATED:
      return clampSummary(`${actorLabel} updated skill role ${targetLabel}`)
    case AUDIT_ACTIONS.UI_CONTRACT_CREATED:
      return clampSummary(`${actorLabel} created UI contract ${targetLabel}`)
    case AUDIT_ACTIONS.UI_CONTRACT_UPDATED:
      return clampSummary(`${actorLabel} updated UI contract ${targetLabel}`)
    case AUDIT_ACTIONS.UI_CONTRACT_CLONED:
      return clampSummary(`${actorLabel} cloned UI contract ${targetLabel}`)
    case AUDIT_ACTIONS.UI_CONTRACT_LOCKED:
      return clampSummary(`${actorLabel} locked UI contract ${targetLabel}`)
    case AUDIT_ACTIONS.UI_CONTRACT_DEPRECATED:
      return clampSummary(`${actorLabel} deprecated UI contract ${targetLabel}`)
    case AUDIT_ACTIONS.UI_CONTRACT_ARCHIVED:
      return clampSummary(`${actorLabel} archived UI contract ${targetLabel}`)
    case AUDIT_ACTIONS.UI_CONTRACT_VALIDATION_RUN:
      return clampSummary(`${actorLabel} validated UI contract ${targetLabel}`)
    case AUDIT_ACTIONS.UI_CONTRACT_VALIDATION_FAILED:
      return clampSummary(`${actorLabel} found UI contract validation issues for ${targetLabel}`)
    case AUDIT_ACTIONS.WORKFLOW_POLICY_CREATED:
      return clampSummary(`${actorLabel} created workflow policy ${targetLabel}`)
    case AUDIT_ACTIONS.WORKFLOW_POLICY_UPDATED:
      return clampSummary(`${actorLabel} updated workflow policy ${targetLabel}`)
    case AUDIT_ACTIONS.WORKFLOW_POLICY_CLONED:
      return clampSummary(`${actorLabel} cloned workflow policy ${targetLabel}`)
    case AUDIT_ACTIONS.WORKFLOW_POLICY_TESTED:
      return clampSummary(`${actorLabel} tested workflow policy ${targetLabel}`)
    default:
      return clampSummary(`${actorLabel} performed ${humanizeAuditAction(action).toLowerCase()} on ${targetLabel}`)
  }
}

const buildAuditPresentation = (data = {}) => {
  const normalizedDisplay = normalizeDisplay(data.display)
  const summary = clampSummary(data.summary) || buildAuditSummary({
    action: data.action,
    resourceType: data.resourceType,
    resourceId: data.resourceId,
    diff: data.diff,
    display: normalizedDisplay,
  })

  return {
    ...(summary ? { summary } : {}),
    ...(normalizedDisplay ? { display: normalizedDisplay } : {}),
  }
}

const normalizeActorReference = (actorUserId) => {
  if (!actorUserId || typeof actorUserId !== 'object' || Array.isArray(actorUserId)) {
    return toIdString(actorUserId) || actorUserId
  }

  const normalizedActor = {
    ...(toIdString(actorUserId.id || actorUserId._id) ? { id: toIdString(actorUserId.id || actorUserId._id) } : {}),
    ...(normalizeText(actorUserId.name) ? { name: normalizeText(actorUserId.name) } : {}),
    ...(normalizeText(actorUserId.email) ? { email: normalizeText(actorUserId.email) } : {}),
  }

  return Object.keys(normalizedActor).length > 0
    ? normalizedActor
    : (toIdString(actorUserId) || actorUserId)
}

const serializeAuditLog = (entry = {}) => {
  const plain = typeof entry?.toObject === 'function'
    ? entry.toObject()
    : { ...entry }

  const id = toIdString(plain.id || plain._id)

  return {
    ...(id ? { id } : {}),
    ts: plain.ts,
    actorUserId: normalizeActorReference(plain.actorUserId),
    action: plain.action,
    resourceType: plain.resourceType,
    resourceId: toIdString(plain.resourceId),
    ...(plain.summary ? { summary: plain.summary } : {}),
    ...(plain.display ? { display: plain.display } : {}),
    ...(plain.scope ? { scope: plain.scope } : {}),
    ...(plain.diff !== undefined ? { diff: plain.diff } : {}),
    ...(plain.ip ? { ip: plain.ip } : {}),
    ...(plain.userAgent ? { userAgent: plain.userAgent } : {}),
    ...(plain.requestId ? { requestId: plain.requestId } : {}),
  }
}

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
    return await AuditLog.createLog({
      ...data,
      ...buildAuditPresentation(data),
    })
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
  const actorLabel = formatActorAuditLabel(req)

  return log({
    ...data,
    actorUserId,
    display: {
      ...(data.display || {}),
      ...(!data.display?.actorLabel && actorLabel ? { actorLabel } : {}),
    },
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
    data: data.map(serializeAuditLog),
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
  const data = await AuditLog.find({ requestId })
    .populate('actorUserId', 'name email')
    .sort({ ts: 1 })
    .lean()

  return { data: data.map(serializeAuditLog), meta: { totalCount: data.length } }
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
  buildAuditPresentation,
  formatActorAuditLabel,
  formatEntityAuditLabel,
  formatUserAuditLabel,
  humanizeAuditAction,
  AUDIT_ACTIONS,
  RESOURCE_TYPES,
}

export default auditService
