import auditService from '../auditService.js'
import { generateChecksum } from './checksumService.js'
import {
  GOVERNANCE_AUDIT_EVENT_CATEGORIES,
  getGovernanceAuditEvent,
} from './governanceAuditEvents.js'

const RESOURCE_TYPE_BY_COMPONENT_TYPE = Object.freeze({
  AGENT: auditService.RESOURCE_TYPES.RuntimeAgent,
  FRAMEWORK_PACKAGE: auditService.RESOURCE_TYPES.FrameworkPackage,
  RUNTIME_AGENT: auditService.RESOURCE_TYPES.RuntimeAgent,
  RUNTIME_PATH: auditService.RESOURCE_TYPES.RuntimePathRegistry,
  RUNTIME_PATH_REGISTRY: auditService.RESOURCE_TYPES.RuntimePathRegistry,
  RUNTIME_SKILL: auditService.RESOURCE_TYPES.RuntimeSkill,
  SKILL: auditService.RESOURCE_TYPES.RuntimeSkill,
  SKILL_ROLE: auditService.RESOURCE_TYPES.SkillRole,
  UI_CONTRACT: auditService.RESOURCE_TYPES.UIContract,
  VALIDATION: auditService.RESOURCE_TYPES.ValidationRegistry,
  VALIDATION_REGISTRY: auditService.RESOURCE_TYPES.ValidationRegistry,
  WORKFLOW_POLICY: auditService.RESOURCE_TYPES.WorkflowPolicy,
})

const requireField = (payload, field, missingFields) => {
  const value = payload[field]
  if (value === undefined || value === null || value === '') {
    missingFields.push(field)
  }
}

const hasAuditEvidence = (value) => {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

const requireEvidence = (payload, field, missingFields) => {
  if (!hasAuditEvidence(payload[field])) {
    missingFields.push(field)
  }
}

const resolveResourceType = (event, payload) => {
  if (payload.resourceType) return payload.resourceType
  const componentType = String(payload.componentType || '').trim().toUpperCase()
  if (componentType && RESOURCE_TYPE_BY_COMPONENT_TYPE[componentType]) {
    return RESOURCE_TYPE_BY_COMPONENT_TYPE[componentType]
  }
  return event.resourceType
}

export const validateGovernanceAuditPayload = (event, payload = {}) => {
  const missingFields = []

  requireField(payload, 'resourceId', missingFields)
  requireField(payload, 'resourceType', missingFields)
  requireField(payload, 'frameworkKey', missingFields)

  if (event.category === GOVERNANCE_AUDIT_EVENT_CATEGORIES.COMPONENT) {
    requireField(payload, 'componentType', missingFields)
    requireField(payload, 'componentStableId', missingFields)
  }

  if (event.requiresSnapshot) requireEvidence(payload, 'snapshot', missingFields)
  if (event.requiresChecksum) requireField(payload, 'checksum', missingFields)
  if (event.requiresDependencyGraph) requireEvidence(payload, 'dependencyGraph', missingFields)

  if (missingFields.length > 0) {
    const error = new Error(`Governance audit payload is missing required fields: ${missingFields.join(', ')}`)
    error.code = 'GOVERNANCE_AUDIT_VALIDATION_FAILED'
    error.details = {
      eventKey: event.eventKey,
      missingFields,
    }
    throw error
  }
}

export const buildGovernanceAuditPayload = (eventKey, payload = {}) => {
  const event = getGovernanceAuditEvent(eventKey)
  if (!event || event.isActive === false) {
    const error = new Error(`Unknown or inactive governance audit event: ${eventKey}`)
    error.code = 'GOVERNANCE_AUDIT_EVENT_NOT_REGISTERED'
    error.details = { eventKey }
    throw error
  }

  const snapshot = payload.snapshot ?? null
  const dependencyGraph = payload.dependencyGraph ?? null
  const checksumSource = dependencyGraph ? { dependencyGraph, snapshot } : snapshot
  const checksum = payload.checksum || (checksumSource ? generateChecksum(checksumSource) : undefined)
  // Governance system events are always persisted using the current audit/schema signature contract.
  // Caller-supplied versions are intentionally ignored so mixed-version system evidence cannot be written.
  const governancePayload = {
    ...payload,
    action: payload.action || event.action,
    resourceType: resolveResourceType(event, payload),
    auditSchemaVersion: 2,
    signatureVersion: 2,
    actorType: payload.actorType || 'USER',
    isSystemEvent: true,
    systemEventType: event.eventKey,
    eventCategory: event.category,
    eventSeverity: event.severity,
    ...(snapshot ? { snapshot } : {}),
    ...(checksum ? { checksum } : {}),
  }

  validateGovernanceAuditPayload(event, governancePayload)
  return governancePayload
}

export const logSystemEvent = async (eventKey, payload = {}, options = {}) => {
  const governancePayload = buildGovernanceAuditPayload(eventKey, payload)
  return auditService.log(governancePayload, options)
}

export const logSystemEventFromRequest = async (req, eventKey, payload = {}, options = {}) => {
  const governancePayload = buildGovernanceAuditPayload(eventKey, payload)
  return auditService.logFromRequest(req, governancePayload, options)
}

const governanceAuditService = {
  buildGovernanceAuditPayload,
  validateGovernanceAuditPayload,
  logSystemEvent,
  logSystemEventFromRequest,
}

export default governanceAuditService
