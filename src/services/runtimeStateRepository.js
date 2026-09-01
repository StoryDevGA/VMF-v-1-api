import mongoose from 'mongoose'

import { isBoundedRuntimeSectionDetail } from '../models/RuntimeStateSection.js'
import { getRuntimeInstance } from './runtimeInstanceService.js'
import {
  FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY,
  FRAMEWORK_OUTCOME_HANDOFF_V2_PARITY_CONTRACT_VERSION,
  buildFrameworkOutcomeHandoffV2ParityDigest,
  resolveFrameworkOutcomeStudioHandoff,
} from './outcomeFrameworkHandoffService.js'
import { resolveRuntimeStateVersion } from './runtimeStateVersionService.js'

export const RUNTIME_STATE_V2_COLLECTIONS = Object.freeze({
  SECTIONS: 'runtime_section_states',
  EVIDENCE_SOURCES: 'runtime_evidence_sources',
  EVIDENCE_OBJECTS: 'runtime_evidence_objects',
  GRAPH_SNAPSHOTS: 'runtime_graph_snapshots',
  GRAPH_ELEMENTS: 'runtime_graph_elements',
})

export const RUNTIME_STATE_V2_ERROR_CODES = Object.freeze({
  INVALID_SECTION_KEY: 'RUNTIME_STATE_V2_INVALID_SECTION_KEY',
  INVALID_PAGE: 'RUNTIME_STATE_V2_INVALID_PAGE',
  CONTROL_SCOPE_REQUIRED: 'RUNTIME_STATE_V2_CONTROL_SCOPE_REQUIRED',
  CONTROL_INVALID: 'RUNTIME_STATE_V2_CONTROL_INVALID',
  STORAGE_UNAVAILABLE: 'RUNTIME_STATE_V2_STORAGE_UNAVAILABLE',
  STATE_VERSION_MISSING: 'RUNTIME_STATE_V2_STATE_VERSION_MISSING',
  STATE_VERSION_MIXED: 'RUNTIME_STATE_V2_STATE_VERSION_MIXED',
  SECTION_MISSING: 'RUNTIME_STATE_V2_SECTION_MISSING',
  SECTION_DUPLICATE: 'RUNTIME_STATE_V2_SECTION_DUPLICATE',
  SECTION_CATALOGUE_LIMIT: 'RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT',
  SECTION_CURRENTNESS_INVALID: 'RUNTIME_STATE_V2_SECTION_CURRENTNESS_INVALID',
  SECTION_DETAIL_INVALID: 'RUNTIME_STATE_V2_SECTION_DETAIL_INVALID',
  EVIDENCE_MISSING: 'RUNTIME_STATE_V2_EVIDENCE_MISSING',
  EVIDENCE_SOURCE_MISSING: 'RUNTIME_STATE_V2_EVIDENCE_SOURCE_MISSING',
  EVIDENCE_SOURCE_CURRENTNESS_INVALID: 'RUNTIME_STATE_V2_EVIDENCE_SOURCE_CURRENTNESS_INVALID',
  EVIDENCE_DUPLICATE: 'RUNTIME_STATE_V2_EVIDENCE_DUPLICATE',
  GRAPH_MANIFEST_MISSING: 'RUNTIME_STATE_V2_GRAPH_MANIFEST_MISSING',
  GRAPH_IDENTITY_INVALID: 'RUNTIME_STATE_V2_GRAPH_IDENTITY_INVALID',
  GRAPH_ELEMENTS_INVALID: 'RUNTIME_STATE_V2_GRAPH_ELEMENTS_INVALID',
  GRAPH_SOURCE_HASH_INVALID: 'RUNTIME_STATE_V2_GRAPH_SOURCE_HASH_INVALID',
  GRAPH_NOT_CURRENT: 'RUNTIME_STATE_V2_GRAPH_NOT_CURRENT',
  HANDOFF_PROJECTION_MISSING: 'RUNTIME_STATE_V2_HANDOFF_PROJECTION_MISSING',
})

export const RUNTIME_STATE_V2_READ_MAX_TIME_MS = 2000
export const RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT = 1001
export const RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT = 100
export const RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES = 512 * 1024
export const RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT = 48

export const RUNTIME_STATE_V2_CONTROL_PROJECTION = [
  '_id',
  'runtimeInstanceKey',
  'customerId',
  'tenantId',
  'workspaceId',
  'runtimeType',
  'frameworkKey',
  'packageId',
  'packageKey',
  'packageVersion',
  'dependencyLockId',
  'activationId',
  'deploymentId',
  'evidence.dependencySnapshotId',
  'evidence.dependencySnapshotHash',
  'status',
  'executionStatus',
  'runtimeMode',
  'name',
  'description',
  'lockedAt',
  'lockedBy',
  'lockedReason',
  'revision.revisionNumber',
  'stateVersion',
  'runtimeStateVersion',
  'createdAt',
  'updatedAt',
].join(' ')

const RUNTIME_STATE_V2_HANDOFF_CONTROL_PROJECTION = [
  RUNTIME_STATE_V2_CONTROL_PROJECTION,
  'framework_state.lock',
  'framework_state.publish',
].join(' ')

const RUNTIME_STATE_V2_CHILD_PROJECTION = Object.freeze({
  _id: 1,
  runtimeInstanceId: 1,
  runtimeInstanceKey: 1,
  customerId: 1,
  tenantId: 1,
  sectionKey: 1,
  stateVersion: 1,
  sourceStateVersion: 1,
  stateStatus: 1,
  status: 1,
  current: 1,
  isCurrent: 1,
  truthStatus: 1,
  truthHash: 1,
  contentHash: 1,
  projectionReceipt: 1,
  evidenceRefs: 1,
  sourceId: 1,
  evidenceObjectId: 1,
  lineageRef: 1,
  sourceType: 1,
  extractedFact: 1,
  validationStatus: 1,
  confidence: 1,
  materiality: 1,
  materialityScore: 1,
  reviewStatus: 1,
  acceptanceState: 1,
  title: 1,
  summary: 1,
  graphVersion: 1,
  sourceStateVersion: 1,
  sourceHash: 1,
  snapshotId: 1,
  graphHash: 1,
  counts: 1,
  metadata: 1,
  createdAt: 1,
  updatedAt: 1,
})

const RUNTIME_STATE_V2_SELECTED_SECTION_PROJECTION = Object.freeze({
  ...RUNTIME_STATE_V2_CHILD_PROJECTION,
  sectionDetail: 1,
})

const RUNTIME_STATE_V2_EVIDENCE_SOURCE_PROJECTION = Object.freeze({
  _id: 1,
  runtimeInstanceId: 1,
  runtimeInstanceKey: 1,
  customerId: 1,
  tenantId: 1,
  stateVersion: 1,
  sourceStateVersion: 1,
  stateStatus: 1,
  status: 1,
  current: 1,
  isCurrent: 1,
  sourceId: 1,
  sourceType: 1,
  title: 1,
  sourceRef: 1,
  contentHash: 1,
  acquisitionStatus: 1,
  acquisitionProfile: 1,
  lineageRef: 1,
  reviewStatus: 1,
  createdAt: 1,
  updatedAt: 1,
})

const RUNTIME_STATE_V2_GRAPH_ELEMENT_PROJECTION = Object.freeze({
  _id: 1,
  runtimeInstanceId: 1,
  runtimeInstanceKey: 1,
  customerId: 1,
  tenantId: 1,
  stateVersion: 1,
  sourceStateVersion: 1,
  current: 1,
  isCurrent: 1,
  snapshotId: 1,
  graphVersion: 1,
  elementType: 1,
  elementKey: 1,
  fromElementKey: 1,
  toElementKey: 1,
  relationshipType: 1,
  label: 1,
  summary: 1,
  attributes: 1,
})

const RUNTIME_STATE_V2_HANDOFF_SECTION_PROJECTION = Object.freeze({
  ...RUNTIME_STATE_V2_CHILD_PROJECTION,
  'sectionDetail.accepted': 1,
  'sectionDetail.generated': 1,
  'sectionDetail.intelligence': 1,
  'sectionDetail.state': 1,
})

const RUNTIME_STATE_V2_HANDOFF_EVIDENCE_PROJECTION = Object.freeze({
  _id: 1,
  runtimeInstanceId: 1,
  runtimeInstanceKey: 1,
  customerId: 1,
  tenantId: 1,
  stateVersion: 1,
  sourceStateVersion: 1,
  current: 1,
  evidenceObjectId: 1,
  sourceId: 1,
  lineageRef: 1,
  reviewStatus: 1,
  acceptanceState: 1,
})

const normalizeText = (value) => String(value ?? '').trim()
const normalizeKey = (value) => normalizeText(value).toLowerCase()
const MAX_EVIDENCE_PAGE = 1000
const RUNTIME_INSTANCE_KEY_PATTERN = /^[a-z][a-z0-9-]{2,159}$/
const PHYSICAL_STORAGE_TOKEN_PATTERN = /runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots|graph_elements)|mongodb|mongo(?:db)?|collection/i
const HANDOFF_DIAGNOSTIC_KEYS = new Set(['message', 'error', 'detail'])
const HANDOFF_PRESERVED_KEYS = new Set([
  'code',
  'status',
  'severity',
  'stateversion',
  'sourcestateversion',
  'logicalsource',
  'source',
  'canonicalsource',
  'blockercount',
  'result',
  'type',
])

const createRuntimeStateError = ({ code, status = 409, message, details = {} }) => {
  const error = new Error(message)
  error.code = code
  error.status = status
  error.details = details
  return error
}

const getScopedObjectId = (scope) => normalizeText(scope?._id || scope?.id)

const getControlScope = (scopes = {}) => {
  const customerId = getScopedObjectId(scopes.customer)
  const tenantId = getScopedObjectId(scopes.tenant)
  const tenantCustomerId = normalizeText(
    scopes.tenant?.customerId
      || scopes.tenant?.customer?._id
      || scopes.tenant?.customer?.id,
  )
  if (!mongoose.isValidObjectId(customerId) || !mongoose.isValidObjectId(tenantId)
    || (tenantCustomerId && tenantCustomerId !== customerId)) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_SCOPE_REQUIRED,
      status: 403,
      message: 'Runtime State Storage V2 requires one explicit customer and tenant scope.',
    })
  }
  return { customerId, tenantId }
}

const requireReadMaxTimeMS = (value = RUNTIME_STATE_V2_READ_MAX_TIME_MS) => {
  const maxTimeMS = Number(value)
  if (!Number.isInteger(maxTimeMS) || maxTimeMS <= 0) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503,
      message: 'Runtime State Storage V2 bounded-read support is unavailable.',
    })
  }
  return maxTimeMS
}

const measureSerializedPayloadBytes = (value) => {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')
  } catch (_error) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503,
      message: 'Runtime State Storage V2 could not measure the bounded read.',
    })
  }
}

const assertSerializedPayloadSize = (value) => {
  const serializedPayloadBytes = measureSerializedPayloadBytes(value)
  if (serializedPayloadBytes > RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503,
      message: 'Runtime State Storage V2 bounded read size exceeded.',
    })
  }
  return serializedPayloadBytes
}

const withBoundedReadReceipt = (payload, source) => {
  const serializedPayloadBytes = assertSerializedPayloadSize(payload)
  const result = {
    ...payload,
    readReceipt: {
      source,
      serializedPayloadBytes,
      maxSerializedPayloadBytes: RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    },
  }
  assertSerializedPayloadSize(result)
  return result
}

const buildObjectIdCandidates = (value) => {
  const normalized = normalizeText(value)
  if (!normalized) return []
  const candidates = [normalized]
  if (mongoose.isValidObjectId(normalized)) candidates.push(new mongoose.Types.ObjectId(normalized))
  return candidates
}

const buildRuntimeIdentityFilter = ({ runtimeInstanceId, runtimeInstanceKey, customerId, tenantId }) => ({
  $and: [
    {
      $or: [
        ...buildObjectIdCandidates(runtimeInstanceId).map((value) => ({ runtimeInstanceId: value })),
        ...(normalizeText(runtimeInstanceKey) ? [{ runtimeInstanceKey: normalizeKey(runtimeInstanceKey) }] : []),
      ],
    },
    {
      $or: buildObjectIdCandidates(customerId).map((value) => ({ customerId: value })),
    },
    {
      $or: buildObjectIdCandidates(tenantId).map((value) => ({ tenantId: value })),
    },
  ],
})

const buildCurrentStateFilter = () => ({
  $or: [
    { stateStatus: 'CURRENT' },
    { status: 'CURRENT' },
    { current: true },
    { isCurrent: true },
  ],
})

const buildStateVersion = (runtime = {}) => {
  const resolved = resolveRuntimeStateVersion(runtime)
  if (resolved.errorCode) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED,
      message: 'Runtime State Storage V2 control state-version receipts disagree.',
      details: {
        runtimeStateVersion: resolved.compatibilityStateVersion,
        stateVersion: resolved.canonicalStateVersion,
      },
    })
  }
  return resolved.stateVersion
}

const getCollection = (collectionName) => {
  try {
    const collection = mongoose.connection.collection(collectionName)
    if (!collection || (typeof collection.findOne !== 'function' && typeof collection.find !== 'function')) {
      throw new Error('Collection is unavailable.')
    }
    return collection
  } catch (_error) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503,
      message: 'Runtime State Storage V2 is unavailable for bounded reads.',
    })
  }
}

const readMany = async ({
  collectionName,
  filter,
  projection = RUNTIME_STATE_V2_CHILD_PROJECTION,
  sort,
  skip,
  limit,
  maxTimeMS = RUNTIME_STATE_V2_READ_MAX_TIME_MS,
}) => {
  const collection = getCollection(collectionName)
  try {
    const boundedMaxTimeMS = requireReadMaxTimeMS(maxTimeMS)
    let cursor = collection.find(filter, {
      projection,
      maxTimeMS: boundedMaxTimeMS,
    })
    if (typeof cursor.maxTimeMS !== 'function') throw new Error('Cursor maxTimeMS is unavailable.')
    cursor = cursor.maxTimeMS(boundedMaxTimeMS)
    if (!Number.isInteger(limit) || limit <= 0 || typeof cursor.limit !== 'function') {
      throw new Error('Cursor limit is unavailable.')
    }
    if (sort !== undefined && sort !== null && typeof cursor.sort !== 'function') {
      throw new Error('Cursor sort is unavailable.')
    }
    if (typeof skip === 'number' && typeof cursor.skip !== 'function') {
      throw new Error('Cursor skip is unavailable.')
    }
    if (sort !== undefined && sort !== null) cursor = cursor.sort(sort)
    if (typeof skip === 'number') cursor = cursor.skip(skip)
    cursor = cursor.limit(limit)
    if (!cursor || typeof cursor.toArray !== 'function') throw new Error('Cursor array read is unavailable.')
    const rows = await cursor.toArray()
    assertSerializedPayloadSize(rows)
    return rows
  } catch (_error) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503,
      message: 'Runtime State Storage V2 could not complete the bounded read.',
    })
  }
}

const readCount = async ({
  collectionName,
  filter,
  limit = null,
  maxTimeMS = RUNTIME_STATE_V2_READ_MAX_TIME_MS,
}) => {
  const collection = getCollection(collectionName)
  if (typeof collection.countDocuments !== 'function') {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503,
      message: 'Runtime State Storage V2 bounded evidence counting is unavailable.',
    })
  }
  try {
    const boundedMaxTimeMS = requireReadMaxTimeMS(maxTimeMS)
    const boundedLimit = limit === null ? null : Number(limit)
    if (boundedLimit !== null && (!Number.isInteger(boundedLimit) || boundedLimit <= 0)) {
      throw new Error('Count limit is unavailable.')
    }
    const count = await collection.countDocuments(filter, {
      maxTimeMS: boundedMaxTimeMS,
      ...(boundedLimit === null ? {} : { limit: boundedLimit }),
    })
    return {
      value: count,
      capped: boundedLimit !== null && count >= boundedLimit,
      limit: boundedLimit,
    }
  } catch (_error) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503,
      message: 'Runtime State Storage V2 could not count the bounded read.',
    })
  }
}

const getControl = async ({ scopes, runtimeInstanceId, includeHandoffEligibility = false }) => {
  const scope = getControlScope(scopes)
  const runtime = await getRuntimeInstance({
    scopes,
    runtimeInstanceId,
    customerId: scope.customerId,
    tenantId: scope.tenantId,
    maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
    projection: includeHandoffEligibility
      ? RUNTIME_STATE_V2_HANDOFF_CONTROL_PROJECTION
      : RUNTIME_STATE_V2_CONTROL_PROJECTION,
  })
  assertSerializedPayloadSize(runtime)
  if (!runtime || typeof runtime !== 'object') {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_INVALID,
      message: 'Runtime State Storage V2 requires an existing scoped control record.',
    })
  }

  const control = {
    id: normalizeText(runtime.id),
    runtimeInstanceKey: normalizeKey(runtime.runtimeInstanceKey),
    customerId: normalizeText(runtime.customerId),
    tenantId: normalizeText(runtime.tenantId),
    workspaceId: normalizeText(runtime.workspaceId),
    runtimeType: normalizeText(runtime.runtimeType),
    frameworkKey: normalizeText(runtime.frameworkKey),
    packageId: normalizeText(runtime.packageId),
    packageKey: normalizeText(runtime.packageKey),
    packageVersion: normalizeText(runtime.packageVersion),
    status: normalizeText(runtime.status),
    executionStatus: normalizeText(runtime.executionStatus),
    runtimeMode: normalizeText(runtime.runtimeMode),
    name: normalizeText(runtime.name),
    lockedAt: runtime.lockedAt || null,
    lockedBy: normalizeText(runtime.lockedBy),
    stateVersion: buildStateVersion(runtime),
    updatedAt: runtime.updatedAt || null,
    source: 'runtime_state_v2.control_projection',
    ...(includeHandoffEligibility
      ? {
          handoffFrameworkState: {
            lock: structuredClone(runtime.framework_state?.lock || {}),
            publish: structuredClone(runtime.framework_state?.publish || {}),
          },
        }
      : {}),
  }
  const invalidIdentity = !mongoose.isValidObjectId(control.id)
    || !RUNTIME_INSTANCE_KEY_PATTERN.test(control.runtimeInstanceKey)
    || !mongoose.isValidObjectId(control.customerId)
    || !mongoose.isValidObjectId(control.tenantId)
  if (invalidIdentity) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_INVALID,
      message: 'Runtime State Storage V2 requires a complete scoped control identity.',
    })
  }
  if (!control.stateVersion) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING,
      message: 'Runtime State Storage V2 requires a control state-version receipt.',
    })
  }
  return control
}

const buildChildFilter = ({ control, additional = {} }) => ({
  ...buildRuntimeIdentityFilter({
    runtimeInstanceId: control.id,
    runtimeInstanceKey: control.runtimeInstanceKey,
    customerId: control.customerId,
    tenantId: control.tenantId,
  }),
  ...additional,
})

const assertStateVersions = ({ control, rows, errorCode, missingMessage, requireSourceStateVersion = false }) => {
  const versions = []
  rows.forEach((row) => {
    const stateVersion = normalizeText(row.stateVersion)
    const sourceStateVersion = normalizeText(row.sourceStateVersion)
    if (requireSourceStateVersion && !sourceStateVersion) {
      throw createRuntimeStateError({
        code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING,
        message: missingMessage,
      })
    }
    if (stateVersion && sourceStateVersion && stateVersion !== sourceStateVersion) {
      throw createRuntimeStateError({
        code: errorCode || RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED,
        message: 'Runtime State Storage V2 returned a state version that disagrees with its source version.',
        details: { stateVersion, sourceStateVersion },
      })
    }
    const version = stateVersion || sourceStateVersion
    if (version) versions.push(version)
  })
  const uniqueVersions = [...new Set(versions)]
  if (uniqueVersions.length === 0) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING,
      message: missingMessage,
    })
  }
  if (uniqueVersions.length > 1 || (control.stateVersion && uniqueVersions[0] !== control.stateVersion)) {
    throw createRuntimeStateError({
      code: errorCode || RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED,
      message: 'Runtime State Storage V2 returned mixed or contradictory state versions.',
      details: { controlStateVersion: control.stateVersion || null, observedStateVersions: uniqueVersions },
    })
  }
  return uniqueVersions[0]
}

const truncateSummary = (value, maxLength = 2000) => normalizeText(value).slice(0, maxLength)

const RUNTIME_SECTION_DETAIL_EMPTY_OBJECT_KEYS = Object.freeze([
  'review',
  'state',
  'lineage',
  'dependencies',
  'validation',
  'confidence',
  'intelligence',
  'metrics',
  'additionalEvidence',
  'gsilContext',
])

const materializeStoredRuntimeSectionDetail = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const detail = { ...value }
  RUNTIME_SECTION_DETAIL_EMPTY_OBJECT_KEYS.forEach((key) => {
    if (!Object.hasOwn(detail, key)) detail[key] = {}
  })
  return detail
}

const sanitizeNestedProjectionValue = (value, key = '') => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeNestedProjectionValue(entry, key))
      .filter((entry) => entry !== undefined)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([childKey]) => !PHYSICAL_STORAGE_TOKEN_PATTERN.test(childKey))
      .map(([childKey, childValue]) => [childKey, sanitizeNestedProjectionValue(childValue, childKey)])
      .filter(([, childValue]) => childValue !== undefined))
  }
  if (typeof value !== 'string') return value
  if ((key === 'source' || key === 'canonicalSource') && PHYSICAL_STORAGE_TOKEN_PATTERN.test(value)) return undefined
  return PHYSICAL_STORAGE_TOKEN_PATTERN.test(value) ? 'runtime_state_v2' : value
}

const serializeSectionSummary = (row, stateVersion) => ({
  sectionKey: normalizeKey(row.sectionKey),
  stateVersion,
  sourceStateVersion: normalizeText(row.sourceStateVersion),
  stateStatus: normalizeText(row.stateStatus || row.status),
  truthStatus: normalizeText(row.truthStatus),
  truthHash: normalizeText(row.truthHash),
  contentHash: normalizeText(row.contentHash),
  summary: truncateSummary(row.summary),
  projectionReceipt: row.projectionReceipt && typeof row.projectionReceipt === 'object'
    ? {
        receiptHash: normalizeText(row.projectionReceipt.receiptHash || row.projectionReceipt.hash),
        sourceStateVersion: normalizeText(row.projectionReceipt.sourceStateVersion),
      }
    : null,
  evidenceRefs: Array.isArray(row.evidenceRefs)
    ? sanitizeNestedProjectionValue(row.evidenceRefs.slice(0, 100))
    : [],
  updatedAt: row.updatedAt || null,
})

const serializeSelectedSection = (row, stateVersion) => {
  const sectionDetail = materializeStoredRuntimeSectionDetail(row.sectionDetail)
  if (!isBoundedRuntimeSectionDetail(sectionDetail)) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DETAIL_INVALID,
      message: 'The selected Runtime State Storage V2 section detail is invalid.',
    })
  }

  return {
    ...serializeSectionSummary(row, stateVersion),
    sectionDetail,
  }
}

const serializeGraphNode = (row) => {
  const attributes = row.attributes && typeof row.attributes === 'object'
    ? sanitizeNestedProjectionValue(row.attributes)
    : {}
  return {
    nodeId: normalizeText(row.elementKey),
    nodeType: normalizeText(attributes.nodeType),
    entityDefinitionKey: normalizeText(attributes.entityDefinitionKey || attributes.nodeType),
    entityDisplayName: normalizeText(attributes.entityDisplayName),
    label: normalizeText(row.label),
    customerVisible: attributes.customerVisible !== false,
    ...(attributes.sectionKey ? { sectionKey: normalizeText(attributes.sectionKey) } : {}),
    ...(attributes.consumerType ? { consumerType: normalizeText(attributes.consumerType) } : {}),
    ...(attributes.frameworkKey ? { frameworkKey: normalizeText(attributes.frameworkKey) } : {}),
    ...(attributes.packageKey ? { packageKey: normalizeText(attributes.packageKey) } : {}),
    ...(attributes.coverageDomain ? { coverageDomain: normalizeText(attributes.coverageDomain) } : {}),
    ...(attributes.reviewStatus ? { reviewStatus: normalizeText(attributes.reviewStatus) } : {}),
    ...(attributes.graphQualityState ? { graphQualityState: normalizeText(attributes.graphQualityState) } : {}),
    metadata: attributes.metadata && typeof attributes.metadata === 'object'
      ? sanitizeNestedProjectionValue(attributes.metadata)
      : {},
  }
}

const serializeGraphEdge = (row) => {
  const attributes = row.attributes && typeof row.attributes === 'object'
    ? sanitizeNestedProjectionValue(row.attributes)
    : {}
  const edgeType = normalizeText(row.relationshipType)
  return {
    edgeId: normalizeText(row.elementKey),
    edgeType,
    relationshipDefinitionKey: normalizeText(attributes.relationshipDefinitionKey || edgeType),
    relationshipDisplayName: normalizeText(attributes.relationshipDisplayName),
    fromNodeId: normalizeText(row.fromElementKey),
    toNodeId: normalizeText(row.toElementKey),
    basis: normalizeText(attributes.basis),
    contributesTo: Array.isArray(attributes.contributesTo)
      ? sanitizeNestedProjectionValue(attributes.contributesTo)
      : [],
    customerVisible: attributes.customerVisible !== false,
    validationState: normalizeText(attributes.validationState || 'UNKNOWN'),
  }
}

const assertCurrentSectionRows = (rows) => {
  rows.forEach((row) => {
    if (row.current !== true) {
      throw createRuntimeStateError({
        code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_CURRENTNESS_INVALID,
        message: 'Runtime State Storage V2 section catalogue requires canonical current rows.',
      })
    }
  })
}

const assertCurrentEvidenceSourceRows = (rows) => {
  rows.forEach((row) => {
    const statuses = [row.stateStatus, row.status].map((value) => normalizeText(value).toUpperCase()).filter(Boolean)
    const hasCurrentMarker = row.current === true || row.isCurrent === true || statuses.includes('CURRENT')
    const hasContradiction = row.current === false
      || row.isCurrent === false
      || statuses.some((status) => status !== 'CURRENT')
    if (!hasCurrentMarker || hasContradiction) {
      throw createRuntimeStateError({
        code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_CURRENTNESS_INVALID,
        message: 'Runtime State Storage V2 evidence source currentness is contradictory.',
      })
    }
  })
}

const serializeEvidenceObject = (row, stateVersion) => ({
  evidenceObjectId: normalizeText(row.evidenceObjectId || row._id),
  sourceId: normalizeText(row.sourceId),
  lineageRef: truncateSummary(row.lineageRef, 1000),
  stateVersion,
  sourceStateVersion: normalizeText(row.sourceStateVersion),
  sourceType: normalizeText(row.sourceType),
  extractedFact: truncateSummary(row.extractedFact, 8000),
  reviewStatus: normalizeText(row.reviewStatus),
  acceptanceState: normalizeText(row.acceptanceState),
  validationStatus: normalizeText(row.validationStatus),
  confidence: row.confidence && typeof row.confidence === 'object'
    ? sanitizeNestedProjectionValue(row.confidence)
    : null,
  materiality: normalizeText(row.materiality),
  materialityScore: Number.isFinite(Number(row.materialityScore)) ? Number(row.materialityScore) : null,
  title: truncateSummary(row.title, 300),
  summary: truncateSummary(row.summary),
  contentHash: normalizeText(row.contentHash),
  createdAt: row.createdAt || null,
  updatedAt: row.updatedAt || null,
})

const serializeEvidenceSource = (row, stateVersion) => {
  const sourceType = normalizeText(row.sourceType).toUpperCase()
  const sourceRef = truncateSummary(row.sourceRef, 2000)
  const acquisitionStatus = normalizeText(row.acquisitionStatus)
  return {
    sourceId: normalizeText(row.sourceId),
    sourceType,
    type: sourceType,
    label: truncateSummary(row.title, 1000),
    sourceRef,
    ...(sourceType === 'WEBSITE' && sourceRef ? { url: sourceRef } : {}),
    ...(sourceType === 'UPLOADED_DOCUMENT' && sourceRef ? { fileName: sourceRef } : {}),
    contentHash: normalizeText(row.contentHash),
    acquisitionStatus,
    status: acquisitionStatus,
    acquisitionProfile: normalizeText(row.acquisitionProfile),
    lineageRef: truncateSummary(row.lineageRef, 1000),
    reviewStatus: normalizeText(row.reviewStatus),
    stateVersion,
    sourceStateVersion: normalizeText(row.sourceStateVersion),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  }
}

const HANDOFF_DIAGNOSTIC_MESSAGE = 'Additional handoff diagnostic detail is withheld by the bounded read contract.'

const sanitizeHandoffDiagnosticPayload = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeHandoffDiagnosticPayload(entry))
      .filter((entry) => entry !== undefined)
  }
  if (!value || typeof value !== 'object') return HANDOFF_DIAGNOSTIC_MESSAGE
  return Object.fromEntries(Object.entries(value)
    .filter(([childKey]) => !PHYSICAL_STORAGE_TOKEN_PATTERN.test(childKey))
    .map(([childKey, childValue]) => {
      const normalizedChildKey = normalizeKey(childKey)
      if (HANDOFF_DIAGNOSTIC_KEYS.has(normalizedChildKey)) {
        return [childKey, sanitizeHandoffDiagnosticValue(childValue)]
      }
      if (normalizedChildKey === 'reason') {
        return [childKey, sanitizeHandoffReasonValue(childValue)]
      }
      if (HANDOFF_PRESERVED_KEYS.has(normalizedChildKey)) {
        return [childKey, sanitizeHandoffValue(childValue, childKey)]
      }
      return [childKey, undefined]
    })
    .filter(([, childValue]) => childValue !== undefined))
}

const sanitizeHandoffDiagnosticValue = (value) => {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return sanitizeHandoffDiagnosticPayload(value)
  }
  return HANDOFF_DIAGNOSTIC_MESSAGE
}

const sanitizeHandoffReasonValue = (value) => {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return sanitizeHandoffDiagnosticPayload(value)
  }
  if (typeof value !== 'string') return value
  return PHYSICAL_STORAGE_TOKEN_PATTERN.test(value)
    ? HANDOFF_DIAGNOSTIC_MESSAGE
    : value
}

const sanitizeHandoffValue = (value, key = '') => {
  const normalizedKey = normalizeKey(key)
  if (HANDOFF_DIAGNOSTIC_KEYS.has(normalizedKey)) return sanitizeHandoffDiagnosticValue(value)
  if (normalizedKey === 'reason') return sanitizeHandoffReasonValue(value)
  if (Array.isArray(value)) return value.map((entry) => sanitizeHandoffValue(entry, key)).filter((entry) => entry !== undefined)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([childKey]) => !PHYSICAL_STORAGE_TOKEN_PATTERN.test(childKey))
      .map(([childKey, childValue]) => [childKey, sanitizeHandoffValue(childValue, childKey)])
      .filter(([, childValue]) => childValue !== undefined))
  }
  if (typeof value !== 'string') return value
  if ((normalizedKey === 'source' || normalizedKey === 'canonicalsource') && PHYSICAL_STORAGE_TOKEN_PATTERN.test(value)) return undefined
  return PHYSICAL_STORAGE_TOKEN_PATTERN.test(value) ? 'runtime_state_v2' : value
}

const sanitizeHandoffProjection = (handoff = {}) => sanitizeHandoffValue(handoff)

export const getRuntimeStateBootstrap = async ({ scopes, runtimeInstanceId } = {}) => {
  const control = await getControl({ scopes, runtimeInstanceId })
  const rows = await readMany({
    collectionName: RUNTIME_STATE_V2_COLLECTIONS.SECTIONS,
    filter: buildChildFilter({
      control,
      additional: { current: true },
    }),
    sort: { sectionKey: 1 },
    limit: RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT + 1,
  })
  if (rows.length > RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_CATALOGUE_LIMIT,
      message: 'Runtime State Storage V2 section catalogue exceeds its bounded read limit.',
    })
  }

  assertCurrentSectionRows(rows)
  const sectionKeys = rows.map((row) => normalizeKey(row.sectionKey)).filter(Boolean)
  if (new Set(sectionKeys).size !== sectionKeys.length) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DUPLICATE,
      message: 'Runtime State Storage V2 section catalogue is not uniquely current.',
    })
  }

  const stateVersion = rows.length > 0
    ? assertStateVersions({
        control,
        rows,
        missingMessage: 'Runtime State Storage V2 section catalogue has no state-version receipt.',
        requireSourceStateVersion: true,
      })
    : control.stateVersion

  return withBoundedReadReceipt({
    control,
    sections: rows.map((row) => serializeSectionSummary(row, stateVersion)),
    sectionCount: rows.length,
    stateVersion,
    source: 'runtime_state_v2.bootstrap',
  }, 'runtime_state_v2.bootstrap')
}

export const getRuntimeStateRendererSections = async ({ scopes, runtimeInstanceId } = {}) => {
  const control = await getControl({ scopes, runtimeInstanceId })
  const rows = await readMany({
    collectionName: RUNTIME_STATE_V2_COLLECTIONS.SECTIONS,
    filter: buildChildFilter({
      control,
      additional: { current: true },
    }),
    projection: RUNTIME_STATE_V2_SELECTED_SECTION_PROJECTION,
    sort: { sectionKey: 1 },
    limit: RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT + 1,
  })
  if (rows.length > RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_CATALOGUE_LIMIT,
      message: 'Runtime State Storage V2 section catalogue exceeds its bounded read limit.',
    })
  }

  assertCurrentSectionRows(rows)
  const sectionKeys = rows.map((row) => normalizeKey(row.sectionKey)).filter(Boolean)
  if (new Set(sectionKeys).size !== sectionKeys.length) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DUPLICATE,
      message: 'Runtime State Storage V2 section catalogue is not uniquely current.',
    })
  }

  const stateVersion = rows.length > 0
    ? assertStateVersions({
        control,
        rows,
        missingMessage: 'Runtime State Storage V2 renderer sections have no state-version receipt.',
        requireSourceStateVersion: true,
      })
    : control.stateVersion

  return withBoundedReadReceipt({
    sections: rows.map((row) => serializeSelectedSection(row, stateVersion)),
    sectionCount: rows.length,
    stateVersion,
  }, 'runtime_state_v2.renderer_sections')
}

export const getRuntimeStateControl = async ({ scopes, runtimeInstanceId } = {}) => withBoundedReadReceipt(
  await getControl({ scopes, runtimeInstanceId }),
  'runtime_state_v2.control_projection',
)

export const getRuntimeStateSectionSummary = async ({ scopes, runtimeInstanceId, sectionKey } = {}) => {
  const normalizedSectionKey = normalizeKey(sectionKey)
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(normalizedSectionKey)) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_SECTION_KEY,
      status: 400,
      message: 'A valid logical section key is required for the bounded read.',
    })
  }

  const control = await getControl({ scopes, runtimeInstanceId })
  const rows = await readMany({
    collectionName: RUNTIME_STATE_V2_COLLECTIONS.SECTIONS,
    projection: RUNTIME_STATE_V2_SELECTED_SECTION_PROJECTION,
    filter: buildChildFilter({
      control,
      additional: {
        sectionKey: normalizedSectionKey,
        current: true,
      },
    }),
    limit: 2,
  })
  if (rows.length === 0) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_MISSING,
      message: 'The selected Runtime State Storage V2 section is unavailable.',
      details: { sectionKey: normalizedSectionKey },
    })
  }
  if (rows.length > 1) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DUPLICATE,
      message: 'The selected Runtime State Storage V2 section is not uniquely current.',
      details: { sectionKey: normalizedSectionKey },
    })
  }
  const stateVersion = assertStateVersions({
    control,
    rows,
    errorCode: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED,
    missingMessage: 'The selected Runtime State Storage V2 section has no state-version receipt.',
    requireSourceStateVersion: true,
  })
  return withBoundedReadReceipt({
    control,
    section: serializeSelectedSection(rows[0], stateVersion),
    source: 'runtime_state_v2.section_summary',
  }, 'runtime_state_v2.section_summary')
}

export const listRuntimeStateEvidenceObjects = async ({
  scopes,
  runtimeInstanceId,
  page = 1,
  pageSize = 25,
  reviewStatus = '',
  acceptanceState = '',
} = {}) => {
  const normalizedPage = Number(page)
  const normalizedPageSize = Number(pageSize)
  if (!Number.isInteger(normalizedPage) || normalizedPage < 1
    || normalizedPage > MAX_EVIDENCE_PAGE
    || !Number.isInteger(normalizedPageSize) || normalizedPageSize < 1 || normalizedPageSize > 50) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_PAGE,
      status: 400,
      message: 'Evidence page and page size must be bounded positive integers.',
    })
  }

  const control = await getControl({ scopes, runtimeInstanceId })
  const filter = buildChildFilter({
    control,
    additional: {
      ...buildCurrentStateFilter(),
      ...(normalizeText(reviewStatus) ? { reviewStatus: normalizeText(reviewStatus).toUpperCase() } : {}),
      ...(normalizeText(acceptanceState) ? { acceptanceState: normalizeText(acceptanceState).toUpperCase() } : {}),
    },
  })
  const [rows, totalReceipt] = await Promise.all([
    readMany({
      collectionName: RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS,
      filter,
      sort: { createdAt: -1, _id: 1 },
      skip: (normalizedPage - 1) * normalizedPageSize,
      limit: normalizedPageSize,
    }),
    readCount({
      collectionName: RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS,
      filter,
      limit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
    }),
  ])
  if (rows.length === 0 && normalizedPage === 1) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_MISSING,
      message: 'Runtime State Storage V2 evidence is unavailable.',
    })
  }
  const total = totalReceipt?.value ?? rows.length
  const totalCapped = Boolean(totalReceipt?.capped)
  const stateVersion = rows.length > 0
    ? assertStateVersions({
        control,
        rows,
        missingMessage: 'Runtime State Storage V2 evidence has no state-version receipt.',
        requireSourceStateVersion: true,
      })
    : control.stateVersion || null
  const sourceIds = [...new Set(rows.map((row) => normalizeText(row.sourceId)).filter(Boolean))]
  if (sourceIds.length !== new Set(rows.map((row) => normalizeText(row.sourceId))).size) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING,
      message: 'Runtime State Storage V2 evidence contains an invalid source reference.',
    })
  }
  const sourceRows = sourceIds.length > 0
    ? await readMany({
        collectionName: RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES,
        filter: buildChildFilter({
          control,
          additional: {
            ...buildCurrentStateFilter(),
            sourceId: { $in: sourceIds },
          },
        }),
        projection: RUNTIME_STATE_V2_EVIDENCE_SOURCE_PROJECTION,
        sort: { sourceId: 1 },
        limit: sourceIds.length,
      })
    : []
  if (sourceRows.length !== sourceIds.length
    || new Set(sourceRows.map((row) => normalizeText(row.sourceId))).size !== sourceIds.length) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING,
      message: 'Runtime State Storage V2 evidence source lineage is incomplete.',
    })
  }
  if (sourceRows.length > 0) {
    assertCurrentEvidenceSourceRows(sourceRows)
    assertStateVersions({
      control,
      rows: sourceRows,
      missingMessage: 'Runtime State Storage V2 evidence sources have no state-version receipt.',
      requireSourceStateVersion: true,
    })
  }
  const sourceRegistry = sourceRows.map((row) => serializeEvidenceSource(row, stateVersion))
  const pageReceipt = rows.length === 0
    ? {
        type: 'RUNTIME_STATE_V2_EVIDENCE_PAGE',
        result: 'EMPTY_PAGE',
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total: total ?? null,
        totalCapped,
        countLimit: totalReceipt?.limit ?? null,
        stateVersion,
      }
    : null
  return withBoundedReadReceipt({
    control,
    evidenceObjects: rows.map((row) => serializeEvidenceObject(row, stateVersion)),
    sourceRegistry,
    lineage: { sources: sourceRegistry },
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total: total ?? rows.length,
    totalCapped,
    countLimit: totalReceipt?.limit ?? null,
    totalPages: Math.max(1, Math.ceil((total ?? rows.length) / normalizedPageSize)),
    stateVersion,
    pageReceipt,
    source: 'runtime_state_v2.evidence_page',
  }, 'runtime_state_v2.evidence_page')
}

export const getRuntimeStateGraphManifest = async ({ scopes, runtimeInstanceId } = {}) => {
  const control = await getControl({ scopes, runtimeInstanceId })
  const rows = await readMany({
    collectionName: RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS,
    filter: buildChildFilter({
      control,
      additional: buildCurrentStateFilter(),
    }),
    sort: { updatedAt: -1, createdAt: -1 },
    limit: 1,
  })
  const row = rows[0]
  if (!row) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_MANIFEST_MISSING,
      message: 'A current Runtime State Storage V2 graph manifest is unavailable.',
    })
  }
  const sourceStateVersion = normalizeText(row.sourceStateVersion)
  if (!sourceStateVersion) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING,
      message: 'The Runtime State Storage V2 graph manifest requires a source-version receipt.',
    })
  }
  const stateVersion = assertStateVersions({
    control,
    rows: [row],
    missingMessage: 'The Runtime State Storage V2 graph manifest has no source-version receipt.',
  })
  const statusValues = [row.status, row.stateStatus]
    .map((value) => normalizeText(value).toUpperCase())
    .filter(Boolean)
  const uniqueStatuses = [...new Set(statusValues)]
  const status = uniqueStatuses[0] || ''
  const currentFlags = [row.current, row.isCurrent].filter((value) => typeof value === 'boolean')
  const hasCurrentFlag = currentFlags.some((value) => value === true)
  const hasStaleFlag = currentFlags.some((value) => value === false)
  const contradictoryCurrentness = uniqueStatuses.length > 1
    || (status === 'STALE' && hasCurrentFlag)
    || (status === 'CURRENT' && hasStaleFlag)
    || (hasCurrentFlag && hasStaleFlag)
  const current = status === 'CURRENT' && !hasStaleFlag
  if (contradictoryCurrentness || !current) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_NOT_CURRENT,
      message: 'The Runtime State Storage V2 graph manifest is not current.',
      details: { statuses: uniqueStatuses },
    })
  }
  const sourceHash = normalizeText(row.sourceHash)
  if (!/^sha256:[0-9a-f]{64}$/.test(sourceHash)) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_SOURCE_HASH_INVALID,
      message: 'The Runtime State Storage V2 graph manifest has no valid source digest.',
    })
  }
  const snapshotId = normalizeText(row.snapshotId || row._id)
  const graphVersion = normalizeText(row.graphVersion)
  if (!snapshotId || !graphVersion) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_IDENTITY_INVALID,
      message: 'The Runtime State Storage V2 graph manifest has incomplete graph identity.',
    })
  }
  return withBoundedReadReceipt({
    control,
    manifest: {
      snapshotId,
      stateVersion,
      sourceStateVersion,
      sourceHash,
      graphVersion,
      status: normalizeText(row.status || row.stateStatus),
      graphHash: normalizeText(row.graphHash),
      counts: row.counts && typeof row.counts === 'object'
        ? sanitizeNestedProjectionValue(row.counts)
        : {},
      metadata: row.metadata && typeof row.metadata === 'object'
        ? sanitizeNestedProjectionValue(row.metadata)
        : {},
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null,
    },
    source: 'runtime_state_v2.graph_manifest',
  }, 'runtime_state_v2.graph_manifest')
}

export const getRuntimeStateGraphProjection = async ({ scopes, runtimeInstanceId } = {}) => {
  const manifestResult = await getRuntimeStateGraphManifest({ scopes, runtimeInstanceId })
  const { control, manifest } = manifestResult
  const elementFilter = {
    ...buildCurrentStateFilter(),
    snapshotId: manifest.snapshotId,
    graphVersion: manifest.graphVersion,
    stateVersion: manifest.stateVersion,
  }
  const edgeRows = await readMany({
    collectionName: RUNTIME_STATE_V2_COLLECTIONS.GRAPH_ELEMENTS,
    filter: buildChildFilter({
      control,
      additional: { ...elementFilter, elementType: 'EDGE' },
    }),
    projection: RUNTIME_STATE_V2_GRAPH_ELEMENT_PROJECTION,
    sort: { relationshipType: 1, elementKey: 1 },
    limit: RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT,
  })
  const totalNodeCount = Number(manifest.counts?.nodeCount || 0)
  const totalEdgeCount = Number(manifest.counts?.edgeCount || 0)
  if (edgeRows.length === 0 && totalEdgeCount > 0) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
      message: 'Runtime State Storage V2 graph edges are incomplete.',
    })
  }
  if (edgeRows.length > 0) {
    assertStateVersions({
      control,
      rows: edgeRows,
      errorCode: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
      missingMessage: 'Runtime State Storage V2 graph edges have no state-version receipt.',
      requireSourceStateVersion: true,
    })
  }
  if (edgeRows.some((row) => normalizeText(row.snapshotId) !== manifest.snapshotId
    || normalizeText(row.graphVersion) !== manifest.graphVersion)) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
      message: 'Runtime State Storage V2 graph edges disagree with the current manifest.',
    })
  }
  const nodeKeys = [...new Set(edgeRows.flatMap((row) => [
    normalizeText(row.fromElementKey),
    normalizeText(row.toElementKey),
  ]))]
  if (nodeKeys.some((key) => !key)) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
      message: 'Runtime State Storage V2 graph edges contain an invalid endpoint.',
    })
  }
  const nodeRows = nodeKeys.length > 0
    ? await readMany({
        collectionName: RUNTIME_STATE_V2_COLLECTIONS.GRAPH_ELEMENTS,
        filter: buildChildFilter({
          control,
          additional: {
            ...elementFilter,
            elementType: 'NODE',
            elementKey: { $in: nodeKeys },
          },
        }),
        projection: RUNTIME_STATE_V2_GRAPH_ELEMENT_PROJECTION,
        sort: { elementKey: 1 },
        limit: nodeKeys.length,
      })
    : []
  if (nodeRows.length !== nodeKeys.length
    || new Set(nodeRows.map((row) => normalizeText(row.elementKey))).size !== nodeKeys.length) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
      message: 'Runtime State Storage V2 graph endpoint nodes are incomplete.',
    })
  }
  if (nodeRows.length > 0) {
    assertStateVersions({
      control,
      rows: nodeRows,
      errorCode: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
      missingMessage: 'Runtime State Storage V2 graph nodes have no state-version receipt.',
      requireSourceStateVersion: true,
    })
  }
  if (nodeRows.some((row) => normalizeText(row.snapshotId) !== manifest.snapshotId
    || normalizeText(row.graphVersion) !== manifest.graphVersion)) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
      message: 'Runtime State Storage V2 graph nodes disagree with the current manifest.',
    })
  }
  const metadata = manifest.metadata || {}
  return withBoundedReadReceipt({
    control,
    graph: {
      available: true,
      artifactType: normalizeText(metadata.artifactType || 'runtime-intelligence-graph'),
      graphVersion: manifest.graphVersion,
      graphHash: manifest.graphHash,
      build: {
        ...(metadata.build && typeof metadata.build === 'object'
          ? sanitizeNestedProjectionValue(metadata.build)
          : {}),
        nodeCount: totalNodeCount,
        edgeCount: totalEdgeCount,
      },
      validation: metadata.validation && typeof metadata.validation === 'object'
        ? sanitizeNestedProjectionValue(metadata.validation)
        : { status: 'UNKNOWN', issues: [] },
      health: metadata.health && typeof metadata.health === 'object'
        ? sanitizeNestedProjectionValue(metadata.health)
        : {},
      coverage: metadata.coverage && typeof metadata.coverage === 'object'
        ? sanitizeNestedProjectionValue(metadata.coverage)
        : {},
      dependencies: metadata.dependencies && typeof metadata.dependencies === 'object'
        ? sanitizeNestedProjectionValue(metadata.dependencies)
        : {},
      scope: metadata.scope && typeof metadata.scope === 'object'
        ? sanitizeNestedProjectionValue(metadata.scope)
        : {},
      registries: metadata.registries && typeof metadata.registries === 'object'
        ? sanitizeNestedProjectionValue(metadata.registries)
        : {},
      nodes: nodeRows.map(serializeGraphNode),
      edges: edgeRows.map(serializeGraphEdge),
      totalNodeCount,
      totalEdgeCount,
      projection: {
        truncated: totalEdgeCount > edgeRows.length || totalNodeCount > nodeRows.length,
        edgeLimit: RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT,
        nodeLimit: RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT * 2,
      },
    },
    source: 'runtime_state_v2.graph_projection',
  }, 'runtime_state_v2.graph_projection')
}

export const getRuntimeStateOutcomeHandoffReadiness = async ({
  scopes,
  runtimeInstanceId,
  packBinding = null,
  knowledgeContext = null,
  knowledgeContextResult = null,
  requestedOutputTypeKey = '',
} = {}) => {
  const control = await getControl({ scopes, runtimeInstanceId, includeHandoffEligibility: true })
  const [sectionRows, evidenceRows] = await Promise.all([
    readMany({
      collectionName: RUNTIME_STATE_V2_COLLECTIONS.SECTIONS,
      projection: RUNTIME_STATE_V2_HANDOFF_SECTION_PROJECTION,
      filter: buildChildFilter({ control, additional: { current: true } }),
      sort: { sectionKey: 1 },
      limit: RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT + 1,
    }),
    readMany({
      collectionName: RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS,
      projection: RUNTIME_STATE_V2_HANDOFF_EVIDENCE_PROJECTION,
      filter: buildChildFilter({ control, additional: { current: true } }),
      sort: { evidenceObjectId: 1, _id: 1 },
      limit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
    }),
  ])
  if (sectionRows.length > RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT
    || evidenceRows.length >= RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503,
      message: 'Runtime State Storage V2 handoff input exceeds its bounded read limit.',
    })
  }
  assertCurrentSectionRows(sectionRows)
  if (evidenceRows.some((row) => row.current !== true)) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_CURRENTNESS_INVALID,
      message: 'Runtime State Storage V2 handoff evidence is not canonically current.',
    })
  }
  const evidenceObjectIds = evidenceRows.map((row) => normalizeText(row.evidenceObjectId))
  if (evidenceObjectIds.some((evidenceObjectId) => !evidenceObjectId)
    || new Set(evidenceObjectIds).size !== evidenceObjectIds.length) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_DUPLICATE,
      message: 'Runtime State Storage V2 handoff evidence identities are missing or duplicated.',
    })
  }
  const sectionKeys = sectionRows.map((row) => normalizeKey(row.sectionKey)).filter(Boolean)
  if (new Set(sectionKeys).size !== sectionKeys.length) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DUPLICATE,
      message: 'Runtime State Storage V2 handoff sections are not uniquely current.',
    })
  }
  if (sectionRows.length > 0) {
    assertStateVersions({
      control,
      rows: sectionRows,
      missingMessage: 'Runtime State Storage V2 handoff sections have no state-version receipt.',
      requireSourceStateVersion: true,
    })
  }
  if (evidenceRows.length > 0) {
    assertStateVersions({
      control,
      rows: evidenceRows,
      missingMessage: 'Runtime State Storage V2 handoff evidence has no state-version receipt.',
      requireSourceStateVersion: true,
    })
  }
  const runtimeInstance = {
    ...control,
    _id: control.id,
    framework_state: {
      ...control.handoffFrameworkState,
      sections: Object.fromEntries(sectionRows.map((row) => [row.sectionKey, row.sectionDetail || {}])),
      evidence_pack: {
        evidenceObjects: evidenceRows.map((row) => ({
          evidenceObjectId: normalizeText(row.evidenceObjectId),
          sourceId: normalizeText(row.sourceId),
          lineageRef: normalizeText(row.lineageRef),
          reviewStatus: normalizeText(row.reviewStatus || row.acceptanceState),
        })),
      },
    },
  }
  const handoffResolution = await resolveFrameworkOutcomeStudioHandoff({
    runtimeInstance,
    scopes,
    packBinding,
    knowledgeContext,
    knowledgeContextResult,
    requestedOutputTypeKey,
    boundedDependencyPolicy: FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY,
    boundedStateParityReceipt: {
      contractVersion: FRAMEWORK_OUTCOME_HANDOFF_V2_PARITY_CONTRACT_VERSION,
      stateVersion: control.stateVersion,
      sectionCount: sectionRows.length,
      evidenceObjectCount: evidenceRows.length,
      sectionKeys,
      stateDigest: buildFrameworkOutcomeHandoffV2ParityDigest(runtimeInstance),
    },
  })
  const handoff = handoffResolution?.handoff
  if (!handoff || typeof handoff !== 'object') {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.HANDOFF_PROJECTION_MISSING,
      message: 'The governed Outcome Studio handoff owner did not return a bounded readiness projection.',
    })
  }
  const { handoffFrameworkState: _handoffFrameworkState, ...publicControl } = control
  return withBoundedReadReceipt({
    control: publicControl,
    status: handoff.status || 'BLOCKED',
    handoff: sanitizeHandoffProjection(handoff),
  }, 'runtime_state_v2.bounded_handoff_projection')
}

export const __testables = Object.freeze({
  buildStateVersion,
  buildRuntimeIdentityFilter,
  buildCurrentStateFilter,
  assertCurrentSectionRows,
  materializeStoredRuntimeSectionDetail,
  readMany,
  getRuntimeStateBootstrap,
  serializeSectionSummary,
  serializeEvidenceObject,
})
