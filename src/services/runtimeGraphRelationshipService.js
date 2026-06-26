import { randomUUID } from 'node:crypto'
import {
  DEFAULT_OUTCOME_WORKSPACE_TYPE,
  RUNTIME_GRAPH_RELATIONSHIP_STATUSES,
} from '../constants/workspaceGovernance.js'
import { RuntimeGraphRelationship } from '../models/index.js'
import { normalizeRuntimeGraphNode } from '../models/RuntimeGraphRelationship.js'
import { toIdString } from './runtimeInstanceService.js'

const RUNTIME_GRAPH_RELATIONSHIP_LIST_LIMIT = 100
const SENSITIVE_EVIDENCE_KEYS = new Set([
  'content',
  'customercontent',
  'hiddenpromptassembly',
  'prompt',
  'promptassembly',
  'raw',
  'rawcontent',
  'rawprompt',
  'sourcebundle',
  'sourceoutputsnapshot',
])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const buildRuntimeGraphRelationshipId = () => `rt_graph_rel_${randomUUID()}`

const toPlainObject = (value) => {
  if (!value) return {}
  if (typeof value.toJSON === 'function') return value.toJSON()
  if (typeof value.toObject === 'function') return value.toObject()
  return value
}

const sanitizeEvidenceValue = (value, visited = new WeakSet()) => {
  if (value && typeof value === 'object') {
    if (visited.has(value)) {
      return Array.isArray(value) ? [] : {}
    }
    visited.add(value)
  }

  if (Array.isArray(value)) {
    return value.map((nestedValue) => sanitizeEvidenceValue(nestedValue, visited))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.entries(value).reduce((acc, [key, nestedValue]) => {
    if (SENSITIVE_EVIDENCE_KEYS.has(String(key || '').trim().toLowerCase())) {
      return acc
    }
    acc[key] = sanitizeEvidenceValue(nestedValue, visited)
    return acc
  }, {})
}

const buildRuntimeGraphRelationshipDocument = ({
  createdBy,
  customerId,
  evidence = {},
  relationshipId,
  relationshipType,
  runtimeInstanceId,
  sourceNode,
  status = RUNTIME_GRAPH_RELATIONSHIP_STATUSES.ACTIVE,
  targetNode,
  tenantId,
  workspaceType = DEFAULT_OUTCOME_WORKSPACE_TYPE,
} = {}) => new RuntimeGraphRelationship({
  relationshipId: normalizeText(relationshipId) || buildRuntimeGraphRelationshipId(),
  relationshipType,
  workspaceType,
  tenantId,
  customerId,
  runtimeInstanceId,
  sourceNode: normalizeRuntimeGraphNode(sourceNode),
  targetNode: normalizeRuntimeGraphNode(targetNode),
  evidence: sanitizeEvidenceValue(evidence),
  status,
  createdBy,
})

export const createRuntimeGraphRelationshipDocuments = (relationships = []) =>
  relationships.map(buildRuntimeGraphRelationshipDocument)

export const saveRuntimeGraphRelationshipDocuments = async (relationshipDocuments = [], {
  dbSession = null,
} = {}) => {
  const saveOptions = dbSession ? { session: dbSession } : undefined
  for (const relationshipDocument of relationshipDocuments) {
    await relationshipDocument.save(saveOptions)
  }
  return relationshipDocuments
}

export const deleteRuntimeGraphRelationshipDocuments = async (relationshipDocuments = [], {
  dbSession = null,
} = {}) => {
  const relationshipIds = relationshipDocuments
    .map((relationshipDocument) => relationshipDocument?._id)
    .filter(Boolean)

  if (relationshipIds.length === 0) {
    return { deletedCount: 0 }
  }

  const filter = { _id: { $in: relationshipIds } }
  if (dbSession) {
    return RuntimeGraphRelationship.deleteMany(filter, { session: dbSession })
  }
  return RuntimeGraphRelationship.deleteMany(filter)
}

export const projectRuntimeGraphRelationship = (relationship = {}) => {
  const plain = toPlainObject(relationship)
  return {
    relationshipId: normalizeText(plain.relationshipId),
    relationshipType: normalizeToken(plain.relationshipType),
    workspaceType: normalizeToken(plain.workspaceType) || DEFAULT_OUTCOME_WORKSPACE_TYPE,
    runtimeInstanceId: toIdString(plain.runtimeInstanceId),
    customerId: toIdString(plain.customerId),
    tenantId: toIdString(plain.tenantId),
    sourceNode: normalizeRuntimeGraphNode(plain.sourceNode || {}),
    targetNode: normalizeRuntimeGraphNode(plain.targetNode || {}),
    evidence: sanitizeEvidenceValue(plain.evidence || {}),
    status: normalizeToken(plain.status),
    createdBy: toIdString(plain.createdBy),
    createdAt: plain.createdAt ? new Date(plain.createdAt).toISOString() : '',
    updatedAt: plain.updatedAt ? new Date(plain.updatedAt).toISOString() : '',
  }
}

export const listRuntimeGraphRelationshipsForRuntime = async ({
  customerId,
  limit = RUNTIME_GRAPH_RELATIONSHIP_LIST_LIMIT,
  relationshipType,
  runtimeInstanceId,
  status = RUNTIME_GRAPH_RELATIONSHIP_STATUSES.ACTIVE,
  tenantId,
  workspaceType,
} = {}) => {
  const filter = {
    runtimeInstanceId,
  }

  if (customerId) filter.customerId = customerId
  if (tenantId) filter.tenantId = tenantId
  if (relationshipType) filter.relationshipType = normalizeToken(relationshipType)
  if (status) filter.status = normalizeToken(status)
  if (workspaceType) filter.workspaceType = normalizeToken(workspaceType)

  const rows = await RuntimeGraphRelationship.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || RUNTIME_GRAPH_RELATIONSHIP_LIST_LIMIT, 1), RUNTIME_GRAPH_RELATIONSHIP_LIST_LIMIT))
    .lean()

  return rows.map(projectRuntimeGraphRelationship)
}

export default {
  createRuntimeGraphRelationshipDocuments,
  deleteRuntimeGraphRelationshipDocuments,
  listRuntimeGraphRelationshipsForRuntime,
  projectRuntimeGraphRelationship,
  saveRuntimeGraphRelationshipDocuments,
}
