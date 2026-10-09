import mongoose from 'mongoose'
import { isValidEvidenceSourceLocation } from '../models/RuntimeEvidenceObject.js'
import { sourceMaterialFingerprint, sourceVerificationContextSchema } from './sourceVerificationContext.js'
import { graphNeighbourhoodSelectionSchema } from '../validators/graphNeighbourhood.validator.js'
import { RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES } from './runtimeIntelligenceGraphService.js'
import { readSourceProcessingSummary } from './sourceProcessingSummary.js'
import { projectIntelligenceEvidenceInventory } from './intelligenceEvidenceInventory.js'
import { projectStoredDiscoveryHealth } from './intelligenceDiscoveryHealth.js'
import { projectRecordedLockBasis } from './intelligenceLockBasis.js'
import { projectStoredContradictionHistory } from './intelligenceContradictionHistory.js'
import { contradictionHistorySelectionSchema } from '../validators/contradictionHistory.validator.js'
import { findingSelectionSchema } from '../validators/intelligenceFinding.validator.js'
import { projectStoredFindings, storedFindingEvidenceIds } from './intelligenceFindingRead.js'
import { assembleOutcomeEvidenceInventory, snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'

import {
  isBoundedRuntimeSectionDetail,
  RUNTIME_SECTION_DETAIL_ROOT_KEYS,
  RUNTIME_SECTION_DETAIL_FORBIDDEN_KEYS,
} from '../models/RuntimeStateSection.js'
import { isBoundedSafeJson } from '../models/runtimeStateSchemas.js'
import { getRuntimeInstance } from './runtimeInstanceService.js'
import {
  FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY,
  FRAMEWORK_OUTCOME_HANDOFF_V2_PARITY_CONTRACT_VERSION,
  buildFrameworkOutcomeHandoffV2ParityDigest,
  resolveFrameworkOutcomeStudioHandoff,
  buildOutcomePlanningRuntimeEvidence,
  OUTCOME_PLANNING_EVIDENCE_VERSIONS,
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
  INVALID_QUERY: 'RUNTIME_STATE_V2_INVALID_QUERY',
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
  ...['accepted', 'acceptedAt', 'refreshedAt', 'inputs', 'needsRefresh', 'needs_refresh']
    .map((field) => `framework_state.evidence_pack.${field}`),
  // Handoff readiness is governed by the discovery projection inside the
  // accepted evidence pack. Keep this bounded to the readiness receipt rather
  // than pulling the full evidence payload into the control read. The
  // contradiction projection is capped by the governed review contract and is
  // required to prove current review dispositions at the handoff boundary.
  'framework_state.evidence_pack.discoveryHealth.readiness',
  'framework_state.evidence_pack.discoveryHealth.missingAreas',
  'framework_state.evidence_pack.discoveryHealth.contradictionCandidates',
  'framework_state.evidence_pack.contradictionReviews',
  'framework_state.evidence_pack.contradictionReviewEpoch',
  'framework_state.sections.output_requirements',
].join(' ')

const DISCOVERY_HEALTH_CONTROL_PROJECTION = [RUNTIME_STATE_V2_CONTROL_PROJECTION,
  ...['state', 'blockerReasons', 'warningReasons', 'assessedAt']
    .map(field => `framework_state.evidence_pack.discoveryHealth.readiness.${field}`),
  'framework_state.evidence_pack.needsRefresh', 'framework_state.evidence_pack.needs_refresh',
].join(' ')

const RECORDED_LOCK_CONTROL_PROJECTION = [RUNTIME_STATE_V2_CONTROL_PROJECTION,
  ...['state', 'locked', 'lockVersion', 'lockedAt', 'lockedBy',
    'snapshot.snapshotId', 'snapshot.snapshotHash', 'snapshot.snapshotAt', 'snapshot.contractVersion', 'snapshot.actionKey',
    'replayAnchor.replayAnchorId', 'replayAnchor.replayAnchorHash', 'replayAnchor.relationship',
    'replayAnchor.runtimeInstanceId', 'replayAnchor.runtimeInstanceKey', 'replayAnchor.lockSnapshotId', 'replayAnchor.lockSnapshotHash']
    .map(field => `framework_state.lock.${field}`),
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
  sourceLocation: 1,
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

// Renderer gate inventory: canonical content and provenance, never rich intelligence caches.
const RENDERER_TRUTH_FIELDS = Object.freeze([
  'content', 'format', 'summary', 'generatedAt', 'generatedBy', 'acceptedAt', 'acceptedBy',
  'sourceGeneratedAt', 'actionKey', 'inputHash', 'evidenceHash', 'sectionEvidenceHash',
  'sectionContractHash', 'dependencyHash', 'boundedContextHash', 'contentHash', 'truthHash', 'truthEligibility', 'generator',
  'reasoningArtefacts', 'reasoningArtefactReceipts', 'runtimeManagedSourceReceipt',
])
const RUNTIME_STATE_V2_RENDERER_SECTION_PROJECTION = Object.freeze({
  sectionKey: 1, stateVersion: 1, sourceStateVersion: 1, stateStatus: 1, status: 1,
  current: 1, isCurrent: 1, truthStatus: 1, truthHash: 1, contentHash: 1,
  summary: 1, projectionReceipt: 1, evidenceRefs: 1, updatedAt: 1,
  ...Object.fromEntries([
    'input', 'state', 'review', 'dependencies', 'lineage', 'validation',
    'additionalEvidence', 'evidenceObjects',
    'revisions.revisionNumber', 'revisions.replacedAt', 'revisions.reason',
    'accepted.revisions.revisionNumber', 'accepted.revisions.replacedAt', 'accepted.revisions.reason',
  ].map((path) => [`sectionDetail.${path}`, 1])),
  ...Object.fromEntries([
    'generated', 'accepted', 'revisions.generated', 'revisions.accepted', 'accepted.revisions.accepted',
  ].flatMap((path) => RENDERER_TRUTH_FIELDS.map((key) => [`sectionDetail.${path}.${key}`, 1]))),
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
  processingReceipt: 1,
  verificationContext: 1,
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
  status: 1,
  stateStatus: 1,
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
  'sectionDetail.input': 1,
  'sectionDetail.additionalEvidence': 1,
  'sectionDetail.evidenceObjects': 1,
  'sectionDetail.dependencies': 1,
  ...Object.fromEntries(['content', 'generatedAt', 'inputHash', 'evidenceHash', 'dependencyHash',
    'generator', 'reasoningArtefacts', 'reasoningArtefactReceipts', 'runtimeManagedSourceReceipt',
    'sectionIntelligence']
    .map((field) => [`sectionDetail.generated.${field}`, 1])),
  // Whole fallback objects preserve presence (including {}) and getter precedence.
  // Accepted truth remains full fidelity, including its rich section intelligence.
  'sectionDetail.accepted': 1,
  'sectionDetail.generated.evidenceProjection': 1,
  'sectionDetail.generated.generationBoundaries': 1,
  'sectionDetail.generated.intelligence.scopedEvidence': 1,
  'sectionDetail.intelligence.scopedEvidence': 1,
  'sectionDetail.intelligence.acceptedTruth.truthHash': 1,
  'sectionDetail.evidenceProjection': 1,
  'sectionDetail.scopedEvidence': 1,
  'sectionDetail.state': 1,
  'sectionDetail.review': 1,
  'sectionDetail.lineage': 1,
  // Legacy accepted truth may live at the section root.
  ...Object.fromEntries([
    'sectionKey', 'content', 'summary', 'value', 'narrative', 'truthHash', 'acceptedAt',
    'acceptedBy', 'sourceActionKey', 'sourceGeneratedAt', 'runtimePath',
    'supportingEvidenceRefs', 'generationBoundaries', 'truthEligibility', 'sectionIntelligence',
  ].map((key) => [`sectionDetail.${key}`, 1])),
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

const RUNTIME_STATE_V2_HANDOFF_CONTRADICTION_EVIDENCE_PROJECTION = Object.freeze({
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
  sourceType: 1,
  lineageRef: 1,
  extractedFact: 1,
  sourceLocation: 1,
  reviewStatus: 1,
  acceptanceState: 1,
  validationStatus: 1,
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

const withBoundedReadReceipt = (payload, source, receiptFields = {}) => {
  const serializedPayloadBytes = assertSerializedPayloadSize(payload)
  const result = {
    ...payload,
    readReceipt: {
      ...receiptFields,
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
  session = null,
  batchSize = null,
  readBudget,
  collation,
}) => {
  const collection = getCollection(collectionName)
  try {
    const nativeBudget = readBudget ? readBudget() : {}
    const boundedMaxTimeMS = requireReadMaxTimeMS(nativeBudget.maxTimeMS ?? maxTimeMS)
    if (batchSize !== null && (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > limit)) throw new Error('Cursor batch bound is invalid.')
    let cursor = collection.find(filter, {
      projection,
      maxTimeMS: boundedMaxTimeMS,
      ...(session ? { session } : {}),
      ...(batchSize === null ? {} : { batchSize }),
      ...nativeBudget,
      ...(collation ? { collation } : {}),
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
  session = null,
  readBudget,
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
      ...(session ? { session } : {}),
      ...(readBudget ? readBudget() : {}),
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

const getControl = async ({ scopes, runtimeInstanceId, includeHandoffEligibility = false, includeDiscoveryHealth = false, includeRecordedLockBasis = false, includeContradictionHistory = false, includeFindings = false, session = null,
  maxTimeMS = RUNTIME_STATE_V2_READ_MAX_TIME_MS, metadataMaxTimeMS, readBudget } = {}) => {
  const scope = getControlScope(scopes)
  const runtime = await getRuntimeInstance({
    scopes,
    runtimeInstanceId,
    customerId: scope.customerId,
    tenantId: scope.tenantId,
    maxTimeMS,
    ...(metadataMaxTimeMS === undefined ? {} : { metadataMaxTimeMS }),
    session,
    readBudget,
    projection: includeFindings
      ? { ...Object.fromEntries(RUNTIME_STATE_V2_CONTROL_PROJECTION.split(' ').map(path => [path, 1])),
        'framework_state.evidence_pack.discoveryHealth.contradictionCandidates': { $slice: 9 },
        'framework_state.evidence_pack.contradictionReviews': { $slice: 1001 },
        'framework_state.evidence_pack.contradictionReviewEpoch': 1 }
      : includeContradictionHistory
      ? { ...Object.fromEntries(RUNTIME_STATE_V2_CONTROL_PROJECTION.split(' ').map(path => [path, 1])),
        'framework_state.evidence_pack.contradictionReviews': { $slice: 1001 } }
      : includeHandoffEligibility
      ? RUNTIME_STATE_V2_HANDOFF_CONTROL_PROJECTION
      : includeDiscoveryHealth ? DISCOVERY_HEALTH_CONTROL_PROJECTION
        : includeRecordedLockBasis ? RECORDED_LOCK_CONTROL_PROJECTION : RUNTIME_STATE_V2_CONTROL_PROJECTION,
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
    lockedAt: runtime.lockedAt ?? null,
    lockedBy: normalizeText(runtime.lockedBy),
    revision: {
      revisionNumber: Number(runtime.revision?.revisionNumber || 0),
    },
    stateVersion: buildStateVersion(runtime),
    updatedAt: runtime.updatedAt || null,
    source: 'runtime_state_v2.control_projection',
    ...(includeDiscoveryHealth ? { discoveryHealthProjection: projectStoredDiscoveryHealth(runtime.framework_state?.evidence_pack) } : {}),
    ...(includeHandoffEligibility
      ? {
          handoffFrameworkState: {
            lock: structuredClone(runtime.framework_state?.lock || {}),
            publish: structuredClone(runtime.framework_state?.publish || {}),
            ...(runtime.framework_state?.sections?.output_requirements !== undefined
              ? { output_requirements: structuredClone(runtime.framework_state.sections.output_requirements) }
              : {}),
            evidence_pack: Object.fromEntries(
              ['accepted', 'acceptedAt', 'refreshedAt', 'inputs', 'needsRefresh', 'needs_refresh']
                .filter((field) => runtime.framework_state?.evidence_pack?.[field] !== undefined)
                .map((field) => [field, structuredClone(runtime.framework_state.evidence_pack[field])]),
            ),
          },
        }
      : {}),
  }
  if (includeRecordedLockBasis) control.recordedLockBasisProjection = projectRecordedLockBasis(runtime.framework_state?.lock, control)
  if (includeContradictionHistory) control.contradictionHistoryRecords = runtime.framework_state?.evidence_pack?.contradictionReviews
  if (includeFindings) control.storedFindings = { candidates: runtime.framework_state?.evidence_pack?.discoveryHealth?.contradictionCandidates,
    reviews: runtime.framework_state?.evidence_pack?.contradictionReviews, reviewEpoch: runtime.framework_state?.evidence_pack?.contradictionReviewEpoch }
  if (includeHandoffEligibility && runtime.framework_state?.evidence_pack?.discoveryHealth) {
    const discoveryHealth = runtime.framework_state.evidence_pack.discoveryHealth
    control.handoffFrameworkState.evidence_pack.discoveryHealth = {
      ...(discoveryHealth.readiness
        ? { readiness: structuredClone(discoveryHealth.readiness) }
        : {}),
      ...(Array.isArray(discoveryHealth.missingAreas)
        ? { missingAreas: structuredClone(discoveryHealth.missingAreas) }
        : {}),
      ...(Array.isArray(discoveryHealth.contradictionCandidates)
        ? { contradictionCandidates: structuredClone(discoveryHealth.contradictionCandidates) }
        : {}),
    }
    const evidencePack = runtime.framework_state.evidence_pack
    if (Array.isArray(evidencePack.contradictionReviews)) {
      control.handoffFrameworkState.evidence_pack.contradictionReviews = structuredClone(evidencePack.contradictionReviews)
    }
    if (evidencePack.contradictionReviewEpoch !== undefined) {
      control.handoffFrameworkState.evidence_pack.contradictionReviewEpoch = structuredClone(evidencePack.contradictionReviewEpoch)
    }
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

const serializeRendererSection = (row, stateVersion) => {
  const rendererSummary = row.sectionDetail
  if (!rendererSummary || typeof rendererSummary !== 'object' || Array.isArray(rendererSummary)
    || !isBoundedSafeJson(rendererSummary, {
      maxDepth: 12, maxEntries: 10000, maxBytes: 256 * 1024, maxStringScalars: 8000,
      rootAllowedKeys: RUNTIME_SECTION_DETAIL_ROOT_KEYS,
      forbiddenKeys: RUNTIME_SECTION_DETAIL_FORBIDDEN_KEYS,
      allowedForbiddenKeys: ['content', 'body', 'text'],
    })) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DETAIL_INVALID,
      message: 'The Runtime State Storage V2 renderer summary is invalid.',
    })
  }
  return {
    ...serializeSectionSummary(row, stateVersion),
    projectionScope: 'RENDERER_SUMMARY',
    rendererSummary,
  }
}

const graphProvenanceId = (value) => {
  if (typeof value !== 'string') return ''
  const id = value.trim()
  return id && id.length <= 240 && !PHYSICAL_STORAGE_TOKEN_PATTERN.test(id)
    && !Array.from(id).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    ? id : ''
}

const serializeGraphNode = (row) => {
  if (row.attributes?.customerVisible === false) return { nodeId: normalizeText(row.elementKey), customerVisible: false }
  const attributes = row.attributes && typeof row.attributes === 'object'
    ? sanitizeNestedProjectionValue(row.attributes)
    : {}
  // Preserve recorded identities, never sanitizer sentinels or node-ID-derived guesses.
  const visible = attributes.customerVisible !== false
  const sourceId = visible && ['SOURCE', 'EVIDENCE'].includes(attributes.nodeType)
    ? graphProvenanceId(row.attributes?.sourceId) : ''
  const evidenceObjectId = visible && attributes.nodeType === 'EVIDENCE'
    ? graphProvenanceId(row.attributes?.evidenceObjectId) : ''
  return {
    nodeId: normalizeText(row.elementKey),
    nodeType: normalizeText(attributes.nodeType),
    entityDefinitionKey: normalizeText(attributes.entityDefinitionKey || attributes.nodeType),
    entityDisplayName: normalizeText(attributes.entityDisplayName),
    label: normalizeText(row.label),
    customerVisible: attributes.customerVisible !== false,
    ...(sourceId ? { sourceId } : {}),
    ...(evidenceObjectId ? { evidenceObjectId } : {}),
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
  if (row.attributes?.customerVisible === false) return { edgeId: normalizeText(row.elementKey),
    fromNodeId: normalizeText(row.fromElementKey), toNodeId: normalizeText(row.toElementKey), customerVisible: false }
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

const readHandoffSectionRows = async ({ control, session = null }) => {
  const catalogueRows = await readMany({
    collectionName: RUNTIME_STATE_V2_COLLECTIONS.SECTIONS,
    projection: RUNTIME_STATE_V2_CHILD_PROJECTION,
    filter: buildChildFilter({ control, additional: { current: true } }),
    sort: { sectionKey: 1 },
    limit: RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT + 1,
    session,
  })
  if (catalogueRows.length > RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_CATALOGUE_LIMIT,
      status: 503,
      message: 'Runtime State Storage V2 handoff section catalogue exceeds its bounded read limit.',
    })
  }
  assertCurrentSectionRows(catalogueRows)
  const catalogueKeys = catalogueRows.map((row) => normalizeKey(row.sectionKey))
  if (catalogueKeys.some((sectionKey) => !sectionKey)
    || new Set(catalogueKeys).size !== catalogueKeys.length) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DUPLICATE,
      message: 'Runtime State Storage V2 handoff sections are not uniquely current.',
    })
  }
  if (catalogueRows.length > 0) {
    assertStateVersions({
      control,
      rows: catalogueRows,
      missingMessage: 'Runtime State Storage V2 handoff section catalogue has no state-version receipt.',
      requireSourceStateVersion: true,
    })
  }

  const partitions = await Promise.all(catalogueKeys.map(async (sectionKey) => {
    const rows = await readMany({
      collectionName: RUNTIME_STATE_V2_COLLECTIONS.SECTIONS,
      projection: RUNTIME_STATE_V2_HANDOFF_SECTION_PROJECTION,
      filter: buildChildFilter({
        control,
        additional: { current: true, sectionKey },
      }),
      limit: 2,
      session,
    })
    if (rows.length === 0) {
      throw createRuntimeStateError({
        code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_MISSING,
        message: 'Runtime State Storage V2 handoff section is unavailable.',
      })
    }
    if (rows.length > 1) {
      throw createRuntimeStateError({
        code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DUPLICATE,
        message: 'Runtime State Storage V2 handoff section is not uniquely current.',
      })
    }
    assertStateVersions({
      control,
      rows,
      missingMessage: 'Runtime State Storage V2 handoff section has no state-version receipt.',
      requireSourceStateVersion: true,
    })
    return {
      row: rows[0],
      serializedPayloadBytes: measureSerializedPayloadBytes(rows),
    }
  }))
  const rows = partitions
    .map(({ row }) => row)
    .sort((left, right) => normalizeKey(left.sectionKey).localeCompare(normalizeKey(right.sectionKey)))
  assertCurrentSectionRows(rows)
  if (rows.length !== catalogueKeys.length
    || rows.some((row, index) => normalizeKey(row.sectionKey) !== catalogueKeys[index])) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_MISSING,
      message: 'Runtime State Storage V2 handoff sections changed during the bounded read.',
    })
  }
  if (rows.length > 0) {
    assertStateVersions({
      control,
      rows,
      missingMessage: 'Runtime State Storage V2 handoff sections have no state-version receipt.',
      requireSourceStateVersion: true,
    })
  }
  return {
    rows,
    readReceipt: {
      mode: 'CATALOGUE_PLUS_SECTION_PARTITIONS',
      sectionCount: rows.length,
      maxSectionPartitionSerializedPayloadBytes: Math.max(
        0,
        ...partitions.map(({ serializedPayloadBytes }) => serializedPayloadBytes),
      ),
    },
  }
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

const serializeEvidenceObject = (row, stateVersion) => {
  if (!isValidEvidenceSourceLocation(row.sourceLocation)) throw createRuntimeStateError({
    code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE, status: 503,
    message: 'The recorded source location is invalid.' })
  return {
  evidenceObjectId: normalizeText(row.evidenceObjectId || row._id),
  sourceId: normalizeText(row.sourceId),
  lineageRef: truncateSummary(row.lineageRef, 1000),
  stateVersion,
  sourceStateVersion: normalizeText(row.sourceStateVersion),
  sourceType: normalizeText(row.sourceType),
  extractedFact: truncateSummary(row.extractedFact, 8000),
  ...(row.sourceLocation !== undefined ? { sourceLocation: row.sourceLocation } : {}),
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
  }
}

const serializeEvidenceSource = (row, stateVersion) => {
  if (row.verificationContext !== undefined && !sourceVerificationContextSchema.safeParse(row.verificationContext).success)
    throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503, message: 'The recorded source review is invalid.' })
  const sourceType = normalizeText(row.sourceType).toUpperCase()
  const sourceRef = truncateSummary(row.sourceRef, 2000)
  const acquisitionStatus = normalizeText(row.acquisitionStatus)
  const receipt = row.processingReceipt
  if (receipt !== undefined && (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || Object.keys(receipt).length !== 4
    || sourceType !== 'UPLOADED_DOCUMENT' || receipt.contractVersion !== 'document-processing-receipt.v1'
    || typeof receipt.runId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(receipt.runId)
    || !Number.isInteger(receipt.inputIndex) || receipt.inputIndex < 0 || receipt.inputIndex > 4
    || typeof receipt.contentHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(receipt.contentHash)))
    throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503, message: 'The recorded document processing provenance is invalid.' })
  return {
    sourceId: normalizeText(row.sourceId),
    materialFingerprint: sourceMaterialFingerprint(row),
    sourceType,
    type: sourceType,
    label: truncateSummary(row.title, 1000),
    sourceRef,
    ...(sourceType === 'WEBSITE' && sourceRef ? { url: sourceRef } : {}),
    ...(sourceType === 'UPLOADED_DOCUMENT' && sourceRef ? { fileName: sourceRef } : {}),
    contentHash: normalizeText(row.contentHash),
    ...(row.processingReceipt !== undefined ? { processingReceipt: structuredClone(row.processingReceipt) } : {}),
    ...(row.verificationContext !== undefined ? { verificationContext: structuredClone(row.verificationContext) } : {}),
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
    projection: RUNTIME_STATE_V2_RENDERER_SECTION_PROJECTION,
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
    projectionScope: 'RENDERER_SUMMARY',
    sections: rows.map((row) => serializeRendererSection(row, stateVersion)),
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

const normalizeRegistryQuery = (value, maxLength = 240) => {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_QUERY,
      status: 400, message: 'Source and evidence query values must be bounded literal strings.' })
  }
  return value.trim()
}

const literalSearchFilter = (search, fields) => search
  ? { $or: fields.map((field) => ({
      [field]: { $regex: search.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&'), $options: 'i' },
    })) }
  : {}

const withLiteralSearch = (filter, search, fields) => search
  ? { ...filter, $and: [...filter.$and, literalSearchFilter(search, fields)] }
  : filter

const isPaginationScalar = value => typeof value === 'number'
  || (typeof value === 'string' && /^\d+$/.test(value))

const invalidCurrentMarker = {
  $or: [
    { $eq: ['$current', false] }, { $eq: ['$isCurrent', false] },
    ...['stateStatus', 'status'].map(field => ({ $and: [
      { $ne: [{ $trim: { input: { $ifNull: [`$${field}`, ''] } } }, ''] },
      { $ne: [{ $toUpper: { $trim: { input: { $ifNull: [`$${field}`, ''] } } } }, 'CURRENT'] },
    ] })),
  ],
}

export const getRuntimeStateSourceSummary = async ({ scopes, runtimeInstanceId } = {}) => {
  const deadline = Date.now() + 6000
  const workDeadline = deadline - 500
  const readBudget = () => {
    const remaining = workDeadline - Date.now()
    if (remaining <= 0) throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE, status: 503,
      message: 'The source summary exceeded its bounded request budget.',
    })
    const timeoutMS = Math.min(2000, remaining)
    return { timeoutMS, maxTimeMS: timeoutMS }
  }
  const session = await mongoose.startSession()
  try {
    // Transaction-wide CSOT overrides native query limits; budget each operation.
    session.startTransaction({ readConcern: { level: 'snapshot' }, readPreference: 'primary', maxCommitTimeMS: 2000 })
    const control = await getControl({ scopes, runtimeInstanceId, session,
      metadataMaxTimeMS: 2000, readBudget })
    const result = await readSourceProcessingSummary({ session, deadline: workDeadline, readBudget, control,
      sourceFilter: buildChildFilter({ control, additional: buildCurrentStateFilter() }),
      validateSources: rows => {
        const identities = rows.map(row => normalizeText(row.sourceId))
        if (identities.some(id => !id) || new Set(identities).size !== rows.length)
          throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_DUPLICATE,
            message: 'The source summary requires unique current source identities.' })
        if (rows.length) {
          assertCurrentEvidenceSourceRows(rows)
          assertStateVersions({ control, rows, requireSourceStateVersion: true })
        }
      } })
    readBudget()
    await session.commitTransaction({ timeoutMS: readBudget().timeoutMS })
    readBudget()
    return result
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction({ timeoutMS: Math.max(1, Math.min(2000, deadline - Date.now())) })
    }
    if (error.status && error.code) throw error
    throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
      status: 503, message: 'The source summary could not complete its bounded read. Refresh.' })
  } finally { await session.endSession() }
}

export const listRuntimeStateSources = async ({
  scopes, runtimeInstanceId, page = 1, pageSize = 25,
  search = '', sourceId = '', sourceType = '',
} = {}) => {
  const normalizedPage = isPaginationScalar(page) ? Number(page) : NaN
  const normalizedPageSize = isPaginationScalar(pageSize) ? Number(pageSize) : NaN
  if (!isPaginationScalar(page) || !isPaginationScalar(pageSize)
    || !Number.isInteger(normalizedPage) || normalizedPage < 1 || normalizedPage > MAX_EVIDENCE_PAGE
    || !Number.isInteger(normalizedPageSize) || normalizedPageSize < 1 || normalizedPageSize > 50) {
    throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_PAGE,
      status: 400, message: 'Source page and page size must be bounded positive integers.' })
  }
  const query = normalizeRegistryQuery(search)
  const selectedId = normalizeRegistryQuery(sourceId)
  const selectedType = normalizeRegistryQuery(sourceType, 100).toUpperCase()
  const deadline = Date.now() + 6000
  const remainingQueryTime = () => {
    const remaining = Math.min(RUNTIME_STATE_V2_READ_MAX_TIME_MS, deadline - Date.now())
    if (remaining <= 0) throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE, status: 503,
      message: 'The source read exceeded its bounded request budget.',
    })
    return remaining
  }
  const control = await getControl({ scopes, runtimeInstanceId })
  const runtimeIdentity = { runtimeInstanceId: control.id, runtimeInstanceKey: control.runtimeInstanceKey }
  const filter = withLiteralSearch(buildChildFilter({ control, additional: {
    ...buildCurrentStateFilter(),
    ...(selectedId ? { sourceId: selectedId } : {}),
    ...(selectedType ? { sourceType: selectedType } : {}),
  } }), query, ['sourceId', 'title', 'sourceRef', 'sourceType'])
  const maxTimeMS = remainingQueryTime()
  const [rows, count] = await Promise.all([
    readMany({ collectionName: RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES,
      filter, projection: RUNTIME_STATE_V2_EVIDENCE_SOURCE_PROJECTION,
      sort: { sourceId: 1, _id: 1 }, skip: (normalizedPage - 1) * normalizedPageSize,
      limit: normalizedPageSize, maxTimeMS }),
    readCount({ collectionName: RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES,
      filter, limit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT, maxTimeMS }),
  ])
  if (selectedId && rows.length === 0) throw createRuntimeStateError({
    code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING, status: 404,
    message: 'The selected source is unavailable in this revision.',
  })
  const sourceIds = rows.map(row => normalizeText(row.sourceId))
  if (sourceIds.some(value => !value) || new Set(sourceIds).size !== rows.length) {
    throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING,
      message: 'The source registry contains invalid or duplicate current identities.' })
  }
  if (rows.length) {
    if (rows.some(row => Object.entries(runtimeIdentity).some(([field, expected]) =>
      row[field] !== undefined && String(row[field]) !== expected))) throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING,
      message: 'The source registry contains a contradictory runtime identity.',
    })
    assertCurrentEvidenceSourceRows(rows)
    assertStateVersions({ control, rows, requireSourceStateVersion: true,
      missingMessage: 'The source registry has no consistent state-version receipt.' })
  }
  let contributions = []
  if (sourceIds.length) {
    try {
      const collection = getCollection(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS)
      contributions = await collection.aggregate([
        { $match: buildChildFilter({ control, additional: {
          ...buildCurrentStateFilter(), sourceId: { $in: sourceIds },
        } }) },
        { $group: { _id: '$sourceId', count: { $sum: 1 },
          invalidRuntimeIdentityCount: { $sum: { $cond: [{ $or: Object.entries(runtimeIdentity).map(([field, expected]) => ({
            $and: [{ $ne: [{ $type: `$${field}` }, 'missing'] },
              { $ne: [{ $convert: { input: `$${field}`, to: 'string', onError: null, onNull: null } }, expected] }],
          })) }, 1, 0] } },
          invalidCurrentCount: { $sum: { $cond: [invalidCurrentMarker, 1, 0] } },
          versions: { $addToSet: '$stateVersion' },
          sourceVersions: { $addToSet: '$sourceStateVersion' } } },
        { $limit: sourceIds.length },
      ], { maxTimeMS: remainingQueryTime() }).toArray()
      assertSerializedPayloadSize(contributions)
    } catch (_error) {
      throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
        status: 503, message: 'Source contribution counts could not complete the bounded read.' })
    }
    for (const row of contributions) {
      if (!Number.isSafeInteger(row.invalidRuntimeIdentityCount) || row.invalidRuntimeIdentityCount !== 0)
        throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING,
          message: 'Source contributions contain an invalid or contradictory runtime identity.' })
      if (row.invalidCurrentCount > 0) throw createRuntimeStateError({
        code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_CURRENTNESS_INVALID,
        message: 'Source contributions contain contradictory currentness markers.',
      })
      if (!sourceIds.includes(row._id) || !Number.isInteger(row.count) || row.count < 0
        || row.versions?.length !== 1 || row.sourceVersions?.length !== 1) {
        throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED,
          message: 'Source contributions do not have a consistent version basis.' })
      }
      assertStateVersions({ control,
        rows: [{ stateVersion: row.versions[0], sourceStateVersion: row.sourceVersions[0] }],
        requireSourceStateVersion: true,
        missingMessage: 'Source contributions have no state-version receipt.' })
    }
  }
  const countsBySource = new Map(contributions.map(row => [row._id, row.count]))
  const total = count.capped ? null : count.value
  return withBoundedReadReceipt({
    control, contractVersion: 'intelligence-source-registry.v1',
    scope: { customerId: control.customerId, tenantId: control.tenantId,
      runtimeInstanceId: control.id, runtimeInstanceKey: control.runtimeInstanceKey },
    stateVersion: control.stateVersion, currency: 'AS_READ', readAt: new Date().toISOString(),
    sourceRegistry: rows.map(row => {
      const contribution = countsBySource.get(row.sourceId) ?? 0
      const capped = contribution >= RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT
      return { ...serializeEvidenceSource(row, control.stateVersion),
        evidenceObjectCount: capped ? null : contribution,
        evidenceCountCapped: capped, evidenceCountLimit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT }
    }),
    page: normalizedPage, pageSize: normalizedPageSize, total,
    totalCapped: count.capped, countLimit: count.limit,
    totalPages: total === null ? null : Math.max(1, Math.ceil(total / normalizedPageSize)),
    hasMore: total === null ? null : normalizedPage * normalizedPageSize < total,
    completeness: count.capped ? 'PARTIAL' : 'COMPLETE',
    search: query, source: 'runtime_state_v2.source_registry',
  }, 'runtime_state_v2.source_registry')
}

export const listRuntimeStateEvidenceObjects = async ({
  scopes,
  runtimeInstanceId,
  page = 1,
  pageSize = 25,
  reviewStatus = '',
  acceptanceState = '',
  sourceId = '',
  evidenceObjectId = '',
  search = '',
} = {}) => {
  const normalizedPage = isPaginationScalar(page) ? Number(page) : NaN
  const normalizedPageSize = isPaginationScalar(pageSize) ? Number(pageSize) : NaN
  if (!isPaginationScalar(page) || !isPaginationScalar(pageSize)
    || !Number.isInteger(normalizedPage) || normalizedPage < 1
    || normalizedPage > MAX_EVIDENCE_PAGE
    || !Number.isInteger(normalizedPageSize) || normalizedPageSize < 1 || normalizedPageSize > 50) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_PAGE,
      status: 400,
      message: 'Evidence page and page size must be bounded positive integers.',
    })
  }

  const selectedSourceId = normalizeRegistryQuery(sourceId)
  const selectedEvidenceId = normalizeRegistryQuery(evidenceObjectId)
  const query = normalizeRegistryQuery(search)
  const control = await getControl({ scopes, runtimeInstanceId })
  const filter = withLiteralSearch(buildChildFilter({
    control,
    additional: {
      ...buildCurrentStateFilter(),
      ...(selectedSourceId ? { sourceId: selectedSourceId } : {}),
      ...(selectedEvidenceId ? { evidenceObjectId: selectedEvidenceId } : {}),
      ...(normalizeText(reviewStatus) ? { reviewStatus: normalizeText(reviewStatus).toUpperCase() } : {}),
      ...(normalizeText(acceptanceState) ? { acceptanceState: normalizeText(acceptanceState).toUpperCase() } : {}),
    },
  }), query, ['evidenceObjectId', 'sourceId', 'title', 'summary', 'extractedFact'])
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
  if (rows.length === 0 && selectedEvidenceId) {
    throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_MISSING,
      status: 404, message: 'The selected evidence is unavailable for this source and revision.' })
  }
  if (rows.length === 0 && selectedSourceId) {
    const selectedSources = await readMany({
      collectionName: RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES,
      filter: buildChildFilter({ control, additional: {
        ...buildCurrentStateFilter(), sourceId: selectedSourceId,
      } }),
      projection: RUNTIME_STATE_V2_EVIDENCE_SOURCE_PROJECTION, limit: 2,
    })
    if (selectedSources.length !== 1) throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING, status: 404,
      message: 'The selected source is unavailable in this revision.',
    })
    assertCurrentEvidenceSourceRows(selectedSources)
    assertStateVersions({ control, rows: selectedSources, requireSourceStateVersion: true,
      missingMessage: 'The selected source has no consistent state-version receipt.' })
  }
  if (rows.length === 0 && normalizedPage === 1 && !query && !selectedSourceId
    && !normalizeText(reviewStatus) && !normalizeText(acceptanceState)) {
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

const readRuntimeStateGraphManifest = async ({ scopes, runtimeInstanceId, session, readBudget } = {}) => {
  const control = await getControl({ scopes, runtimeInstanceId, session, metadataMaxTimeMS: 2000, readBudget })
  const rows = await readMany({
    collectionName: RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS,
    filter: buildChildFilter({
      control,
      additional: buildCurrentStateFilter(),
    }),
    sort: { updatedAt: -1, createdAt: -1 },
    limit: 1,
    batchSize: 1,
    session,
    readBudget,
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

const withRuntimeSnapshotRead = async (read, unavailableMessage = 'The current graph could not complete its bounded read. Refresh to retry.') => {
  const deadline = Date.now() + 6000
  const workDeadline = deadline - 500
  const unavailable = () => createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
    status: 503, message: unavailableMessage })
  const readBudget = () => {
    const remaining = workDeadline - Date.now()
    if (remaining <= 0) throw unavailable()
    const timeoutMS = Math.min(2000, remaining)
    return { timeoutMS, maxTimeMS: timeoutMS }
  }
  let session, result, failure
  try {
    readBudget()
    session = await mongoose.startSession()
    readBudget()
    session.startTransaction({ readConcern: { level: 'snapshot' }, readPreference: 'primary', maxCommitTimeMS: 2000 })
    const { readReceipt: _previousReceipt, ...payload } = await read({ session, readBudget })
    result = withBoundedReadReceipt({ ...payload, currency: 'AS_READ', readAt: new Date().toISOString() },
      payload.source, { maxTimeMS: 2000, requestTimeoutMS: 6000, workTimeoutMS: 5500, cleanupReserveMS: 500 })
    await session.commitTransaction({ timeoutMS: readBudget().timeoutMS })
    readBudget()
  } catch (error) {
    failure = error.status && error.code ? error : unavailable()
    if (session?.inTransaction()) {
      try { await session.abortTransaction({ timeoutMS: Math.max(1, Math.min(2000, deadline - Date.now())) }) }
      catch { failure = unavailable() }
    }
  } finally {
    if (session) {
      try { await session.endSession() }
      catch { failure = unavailable() }
    }
  }
  if (failure) throw failure
  readBudget()
  return result
}

export const getRuntimeStateDiscoveryHealth = async (args = {}) => withRuntimeSnapshotRead(async options => {
  const { discoveryHealthProjection, ...control } = await getControl({ ...args, ...options,
    includeHandoffEligibility: false, includeDiscoveryHealth: true, metadataMaxTimeMS: 2000 })
  return { contractVersion: 'intelligence-discovery-health.v1', control,
    discoveryHealth: discoveryHealthProjection, source: 'runtime_state_v2.discovery_health' }
}, 'The recorded Discovery Health assessment could not complete its bounded read. Refresh to retry.')

export const getRuntimeStateLockBasis = async (args = {}) => withRuntimeSnapshotRead(async options => {
  const { recordedLockBasisProjection, ...control } = await getControl({ ...args, ...options,
    includeHandoffEligibility: false, includeDiscoveryHealth: false, includeRecordedLockBasis: true, metadataMaxTimeMS: 2000 })
  return { contractVersion: 'intelligence-lock-basis.v1', control,
    lockBasis: recordedLockBasisProjection, source: 'runtime_state_v2.lock_basis' }
}, 'The recorded lock basis could not complete its bounded read. Refresh to retry.')

export const getRuntimeStateContradictionHistory = async (args = {}) => {
  const selection = contradictionHistorySelectionSchema.safeParse({ findingId: args.findingId,
    ...(args.page === undefined ? {} : { page: args.page }), ...(args.pageSize === undefined ? {} : { pageSize: args.pageSize }) })
  if (!selection.success) throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_QUERY,
    status: 422, message: 'Select an exact finding and a bounded history page.' })
  return withRuntimeSnapshotRead(async options => {
    const { contradictionHistoryRecords, ...control } = await getControl({ ...args, ...options,
      includeContradictionHistory: true, metadataMaxTimeMS: 2000 })
    return { contractVersion: 'intelligence-contradiction-history.v1', control,
      history: projectStoredContradictionHistory(contradictionHistoryRecords, control.id, selection.data),
      source: 'runtime_state_v2.contradiction_history' }
  }, 'Recorded contradiction decisions could not complete their bounded read. Refresh to retry.')
}

export const getRuntimeStateFindings = async (args = {}) => {
  const selection = findingSelectionSchema.safeParse(Object.fromEntries(['search', 'type', 'population', 'sort', 'page', 'pageSize']
    .filter(field => args[field] !== undefined).map(field => [field, args[field]])))
  if (!selection.success) throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_QUERY,
    status: 422, message: 'Select a bounded literal finding search and supported inspection filters.' })
  return withRuntimeSnapshotRead(async options => {
    const { storedFindings, ...control } = await getControl({ ...args, ...options, includeFindings: true, metadataMaxTimeMS: 2000 })
    const ids = selection.data.type === 'CONTRADICTION' ? storedFindingEvidenceIds(storedFindings) : null
    const rows = ids?.length ? await readMany({ collectionName: RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS,
      filter: buildChildFilter({ control, additional: { ...buildCurrentStateFilter(), evidenceObjectId: { $in: ids } } }),
      projection: { ...RUNTIME_STATE_V2_HANDOFF_CONTRADICTION_EVIDENCE_PROJECTION, sourceHash: 1, migrationReceiptId: 1,
        status: 1, stateStatus: 1, isCurrent: 1, customerVisible: 1, private: 1, visibility: 1, accessLevel: 1 },
      sort: { evidenceObjectId: 1, _id: 1 }, limit: ids.length + 1, batchSize: ids.length + 1, ...options }) : []
    if (rows.length) { assertCurrentEvidenceSourceRows(rows); assertStateVersions({ control, rows, requireSourceStateVersion: true }) }
    return { contractVersion: 'intelligence-finding-read.v1', control,
      findings: projectStoredFindings({ stored: storedFindings, evidenceRows: rows, control, selection: selection.data }),
      source: 'runtime_state_v2.stored_findings' }
  }, 'Stored findings could not complete their bounded read. Refresh to retry.')
}

export const getRuntimeStateGraphManifest = async (args = {}) => withRuntimeSnapshotRead(
  options => readRuntimeStateGraphManifest({ ...args, ...options }),
)

const readRuntimeStateGraphProjection = async ({ scopes, runtimeInstanceId, session, readBudget, neighbourhood = null } = {}) => {
  const manifestResult = await readRuntimeStateGraphManifest({ scopes, runtimeInstanceId, session, readBudget })
  const { control, manifest } = manifestResult
  const hasInvalidCurrency = row => row.current === false || row.isCurrent === false
    || [row.status, row.stateStatus].some(value => normalizeText(value) && normalizeText(value).toUpperCase() !== 'CURRENT')
  const totalNodeCount = manifest.counts?.nodeCount
  const totalEdgeCount = manifest.counts?.edgeCount
  if (![totalNodeCount, totalEdgeCount].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
      message: 'Runtime State Storage V2 graph totals are unavailable or invalid.' })
  }
  const elementFilter = {
    ...buildCurrentStateFilter(),
    snapshotId: manifest.snapshotId,
    graphVersion: manifest.graphVersion,
    stateVersion: manifest.stateVersion,
  }
  const collation = neighbourhood ? { locale: 'simple' } : undefined
  let incidentFilter = {}
  const elementQuery = (additional, incident = false) => {
    const filter = buildChildFilter({ control, additional: { ...elementFilter, ...additional } })
    return incident ? { ...filter, $and: [...filter.$and, incidentFilter] } : filter
  }
  const readElements = (additional, incident = false) => readMany({
    collectionName: RUNTIME_STATE_V2_COLLECTIONS.GRAPH_ELEMENTS,
    filter: elementQuery(additional, incident),
    projection: RUNTIME_STATE_V2_GRAPH_ELEMENT_PROJECTION,
    sort: { elementKey: 1 }, limit: 2, batchSize: 2, session, readBudget, collation,
  })
  const validKey = value => typeof value === 'string' && value === value.trim() && value.length > 0
    && value.length <= 240 && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  const assertNeighbourhoodRows = rows => {
    if (rows.some(row => !validKey(row.elementKey) || hasInvalidCurrency(row)
      || row.snapshotId !== manifest.snapshotId || row.graphVersion !== manifest.graphVersion)) {
      throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
        message: 'The selected graph neighbourhood has an invalid recorded basis.' })
    }
    if (rows.length) assertStateVersions({ control, rows,
      errorCode: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID, requireSourceStateVersion: true,
      missingMessage: 'The selected graph neighbourhood has no state-version receipt.' })
  }
  let evidenceSelection = null
  if (neighbourhood) {
    if (neighbourhood.graphHash !== manifest.graphHash) throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_NOT_CURRENT,
      message: 'The selected graph basis has changed. Refresh before continuing.' })
    const selectedRows = await readElements(neighbourhood.evidenceObjectId
      ? { elementType: 'NODE', 'attributes.nodeType': 'EVIDENCE', 'attributes.scope': 'GLOBAL',
          'attributes.evidenceObjectId': neighbourhood.evidenceObjectId }
      : { elementType: 'NODE', elementKey: neighbourhood.nodeId })
    assertNeighbourhoodRows(selectedRows)
    if (selectedRows.length > 1) throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
      message: 'The selected graph object is not uniquely current.' })
    const selected = selectedRows[0]
    if (!selected || selected.attributes?.customerVisible === false
      || !Object.values(RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES).includes(selected.attributes?.nodeType)) {
      throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_IDENTITY_INVALID, status: 404,
        message: 'The selected graph object is unavailable.' })
    }
    if (neighbourhood.evidenceObjectId) {
      if (selected.attributes?.nodeType !== 'EVIDENCE' || selected.attributes?.scope !== 'GLOBAL'
        || serializeGraphNode(selected).evidenceObjectId !== neighbourhood.evidenceObjectId) {
        throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
          message: 'The selected graph evidence has no exact recorded canonical identity.' })
      }
      evidenceSelection = { evidenceObjectId: neighbourhood.evidenceObjectId, nodeId: selected.elementKey, scope: 'GLOBAL' }
      neighbourhood = { ...neighbourhood, nodeId: selected.elementKey }
    }
    incidentFilter = neighbourhood.mode === 'Lineage' ? { toElementKey: neighbourhood.nodeId }
      : neighbourhood.mode === 'Impact' ? { fromElementKey: neighbourhood.nodeId }
        : { $or: [{ fromElementKey: neighbourhood.nodeId }, { toElementKey: neighbourhood.nodeId }] }
    if (neighbourhood.afterEdgeKey) {
      const cursorRows = await readElements({ elementType: 'EDGE', elementKey: neighbourhood.afterEdgeKey }, true)
      assertNeighbourhoodRows(cursorRows)
      if (cursorRows.length !== 1) throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_QUERY,
        status: 400, message: 'The graph continuation does not belong to this selection and direction.' })
    }
  }
  const edgeRows = await readMany({
    collectionName: RUNTIME_STATE_V2_COLLECTIONS.GRAPH_ELEMENTS,
    filter: elementQuery({ elementType: 'EDGE',
      ...(neighbourhood?.afterEdgeKey ? { elementKey: { $gt: neighbourhood.afterEdgeKey } } : {}) }, Boolean(neighbourhood)),
    projection: RUNTIME_STATE_V2_GRAPH_ELEMENT_PROJECTION,
    sort: neighbourhood ? { elementKey: 1 } : { relationshipType: 1, elementKey: 1 },
    limit: RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT,
    batchSize: RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT,
    session,
    readBudget,
    collation,
  })
  if (neighbourhood) {
    assertNeighbourhoodRows(edgeRows)
    const incident = row => neighbourhood.mode === 'Lineage' ? row.toElementKey === neighbourhood.nodeId
      : neighbourhood.mode === 'Impact' ? row.fromElementKey === neighbourhood.nodeId
        : row.fromElementKey === neighbourhood.nodeId || row.toElementKey === neighbourhood.nodeId
    if (edgeRows.some((row, index) => !incident(row) || !validKey(row.fromElementKey) || !validKey(row.toElementKey)
      || Buffer.compare(Buffer.from(row.elementKey), Buffer.from(index ? edgeRows[index - 1].elementKey : neighbourhood.afterEdgeKey || '')) <= 0)) {
      throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
        message: 'The selected graph relationships have invalid direction, identity or order.' })
    }
  }
  const edgeKeys = edgeRows.map(row => normalizeText(row.elementKey))
  if (edgeRows.length > totalEdgeCount || edgeKeys.some(key => !key) || new Set(edgeKeys).size !== edgeKeys.length
    || edgeRows.some(hasInvalidCurrency)) {
    throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID,
      message: 'Runtime State Storage V2 graph edges have invalid identity, currency or totals.' })
  }
  if (!neighbourhood && edgeRows.length === 0 && totalEdgeCount > 0) {
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
  const nodeKeys = [...new Set([...(neighbourhood ? [neighbourhood.nodeId] : []), ...edgeRows.flatMap((row) => [
    normalizeText(row.fromElementKey),
    normalizeText(row.toElementKey),
  ])])]
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
        batchSize: nodeKeys.length,
        session,
        readBudget,
        collation,
      })
    : []
  if (neighbourhood) assertNeighbourhoodRows(nodeRows)
  if (nodeRows.length > totalNodeCount || nodeRows.some(hasInvalidCurrency)
    || nodeRows.length !== nodeKeys.length
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
      ...(neighbourhood ? { neighbourhood: {
        version: 1, nodeId: neighbourhood.nodeId, mode: neighbourhood.mode, depth: 1,
        completenessBasis: 'RECORDED_ONE_HOP_EDGES',
        direction: { Journey: 'BOTH', Lineage: 'INCOMING', Impact: 'OUTGOING' }[neighbourhood.mode],
        ...(evidenceSelection ? { evidenceSelection } : {}),
        afterEdgeKey: neighbourhood.afterEdgeKey || null,
        nextAfterEdgeKey: edgeRows.length === RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT ? edgeRows.at(-1).elementKey : null,
        continuation: edgeRows.length === RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT ? 'MAY_HAVE_MORE' : 'EXHAUSTED',
        complete: !neighbourhood.afterEdgeKey && edgeRows.length < RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT,
      } } : {}),
    },
    source: neighbourhood ? 'runtime_state_v2.graph_neighbourhood' : 'runtime_state_v2.graph_projection',
  }, neighbourhood ? 'runtime_state_v2.graph_neighbourhood' : 'runtime_state_v2.graph_projection')
}

export const getRuntimeStateGraphProjection = async (args = {}) => withRuntimeSnapshotRead(
  options => readRuntimeStateGraphProjection({ ...args, ...options }),
)

export const getRuntimeStateGraphNeighbourhood = async ({ scopes, runtimeInstanceId, ...query } = {}) => {
  const selection = graphNeighbourhoodSelectionSchema.safeParse(query)
  if (!selection.success) throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_QUERY,
    status: 400, message: 'The graph selection requires bounded identities, mode and graph basis.' })
  return withRuntimeSnapshotRead(options => readRuntimeStateGraphProjection({ scopes, runtimeInstanceId,
    ...options, neighbourhood: selection.data }))
}

const readRuntimeStateOutcomeHandoff = async ({
  scopes,
  runtimeInstanceId,
  packBinding = null,
  knowledgeContext = null,
  knowledgeContextResult = null,
  requestedOutputTypeKey = '',
  outputContractState = 'CANDIDATE',
  planningEvidence = false,
  planningEvidenceVersion = OUTCOME_PLANNING_EVIDENCE_VERSIONS.V1,
  session = null,
} = {}) => {
  const control = await getControl({ scopes, runtimeInstanceId, includeHandoffEligibility: true, session })
  const contradictionEvidenceObjectIds = [...new Set(
    (control.handoffFrameworkState?.evidence_pack?.discoveryHealth?.contradictionCandidates || [])
      .flatMap((candidate) => Array.isArray(candidate?.evidenceObjectIds) ? candidate.evidenceObjectIds : [])
      .map(normalizeText)
      .filter(Boolean),
  )]
  if (contradictionEvidenceObjectIds.length > 16) {
    throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_MISSING,
      message: 'Runtime State Storage V2 contradiction evidence exceeds its bounded read limit.',
    })
  }
  const [sectionRead, evidenceRows, contradictionEvidenceRows] = await Promise.all([
    readHandoffSectionRows({ control, session }),
    readMany({
      collectionName: RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS,
      projection: RUNTIME_STATE_V2_HANDOFF_EVIDENCE_PROJECTION,
      filter: buildChildFilter({ control, additional: { current: true } }),
      sort: { evidenceObjectId: 1, _id: 1 },
      limit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
      session,
    }),
    contradictionEvidenceObjectIds.length > 0
      ? readMany({
          collectionName: RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS,
          projection: RUNTIME_STATE_V2_HANDOFF_CONTRADICTION_EVIDENCE_PROJECTION,
          filter: buildChildFilter({ control, additional: {
            current: true,
            evidenceObjectId: { $in: contradictionEvidenceObjectIds },
          } }),
          sort: { evidenceObjectId: 1, _id: 1 },
          limit: contradictionEvidenceObjectIds.length,
          session,
        })
      : [],
  ])
  const sectionRows = sectionRead.rows
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
        ...control.handoffFrameworkState?.evidence_pack,
        evidenceObjects: evidenceRows.map((row) => ({
          evidenceObjectId: normalizeText(row.evidenceObjectId),
          sourceId: normalizeText(row.sourceId),
          lineageRef: normalizeText(row.lineageRef),
          reviewStatus: normalizeText(row.reviewStatus || row.acceptanceState),
          ...(contradictionEvidenceRows.find((contradictionRow) =>
            normalizeText(contradictionRow.evidenceObjectId) === normalizeText(row.evidenceObjectId),
          )
            ? (() => {
                const contradictionRow = contradictionEvidenceRows.find((candidateRow) =>
                  normalizeText(candidateRow.evidenceObjectId) === normalizeText(row.evidenceObjectId))
                return {
                  sourceType: normalizeText(contradictionRow.sourceType),
                  extractedFact: normalizeText(contradictionRow.extractedFact),
                  validationStatus: normalizeText(contradictionRow.validationStatus),
                }
              })()
            : {}),
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
    outputContractState,
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
  if (planningEvidence) return buildOutcomePlanningRuntimeEvidence({
    runtimeInstance, frameworkPackage: handoffResolution?.frameworkPackage, handoff, planningEvidenceVersion,
  })
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
    handoffRead: sectionRead.readReceipt,
  }, 'runtime_state_v2.bounded_handoff_projection')
}

export const getRuntimeStateOutcomeHandoffReadiness = (args = {}) => readRuntimeStateOutcomeHandoff({ ...args, planningEvidence: false })

// Internal contract snapshot: preserve stored evidence, rather than renderer summaries.
// Existing repository owners enforce scope, state identity, session and byte limits.
export const getRuntimeOutcomeEvidenceContractSnapshot = async ({ scopes, runtimeInstanceId, session = null, boundedInventoryRead = false, readBudget } = {}) => {
  const metadataOptions = boundedInventoryRead ? { metadataMaxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS, readBudget } : {}
  const identity = await getRuntimeInstance({ scopes, runtimeInstanceId,
    projection: RUNTIME_STATE_V2_CONTROL_PROJECTION, maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS, session, ...metadataOptions })
  if (!identity.stateVersion && !identity.runtimeStateVersion) {
    const legacy = await getRuntimeInstance({ scopes, runtimeInstanceId,
      projection: `${RUNTIME_STATE_V2_HANDOFF_CONTROL_PROJECTION} framework_state.evidence_pack`,
      maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS, session })
    if (legacy.stateVersion || legacy.runtimeStateVersion) throw createRuntimeStateError({
      code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED, message: 'Runtime storage identity changed.' })
    const snapshot = legacy.framework_state?.evidence_pack || { evidenceObjects: [], sourceRegistry: [] }
    assertSerializedPayloadSize(snapshot)
    return JSON.parse(JSON.stringify(snapshot))
  }
  const control = await getControl({ scopes, runtimeInstanceId, includeHandoffEligibility: true, session, ...metadataOptions })
  const sectionProjection = { _id: 1, sectionKey: 1, customerId: 1, tenantId: 1, runtimeInstanceId: 1,
    runtimeInstanceKey: 1, current: 1, stateVersion: 1, sourceStateVersion: 1,
    'sectionDetail.accepted.supportingEvidenceRefs': 1 }
  const readSections = () => readMany({ collectionName: RUNTIME_STATE_V2_COLLECTIONS.SECTIONS,
    filter: buildChildFilter({ control, additional: { current: true } }), projection: sectionProjection,
    sort: { sectionKey: 1 }, limit: RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT + 1, session, readBudget,
    ...(boundedInventoryRead ? { batchSize: RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT + 1 } : {}) })
  const sectionRows = await readSections()
  if (sectionRows.length > RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT) throw createRuntimeStateError({
    code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_CATALOGUE_LIMIT, message: 'Evidence snapshot section catalogue exceeded.' })
  assertCurrentSectionRows(sectionRows)
  if (sectionRows.length) assertStateVersions({ control, rows: sectionRows, requireSourceStateVersion: true })
  const collectionName = (kind) => kind === 'evidence'
    ? RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS : RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES
  const filter = (after = null) => buildChildFilter({ control, additional: {
    ...buildCurrentStateFilter(), ...(after ? { _id: { $gt: after } } : {}) } })
  const validateScope = (rows) => {
    if (rows.some((row) => String(row.customerId) !== control.customerId
      || String(row.tenantId) !== control.tenantId || String(row.runtimeInstanceId) !== control.id
      || (row.runtimeInstanceKey && row.runtimeInstanceKey !== control.runtimeInstanceKey))) throw createRuntimeStateError({
      code: 'OUTCOME_EVIDENCE_SCOPE_MISMATCH', message: 'Evidence snapshot record is outside the governed scope.' })
  }
  validateScope(sectionRows)
  const assembled = await assembleOutcomeEvidenceInventory({
    scope: { runtimeInstanceId: control.id, runtimeInstanceKey: control.runtimeInstanceKey,
      customerId: control.customerId, tenantId: control.tenantId, stateVersion: control.stateVersion },
    sections: sectionRows.map((row) => ({ sectionKey: row.sectionKey,
      references: row.sectionDetail?.accepted?.supportingEvidenceRefs || [], storedSectionHash: snapshotHash(row) })),
    contradictionReferences: (control.handoffFrameworkState?.evidence_pack?.discoveryHealth?.contradictionCandidates || [])
      .flatMap((candidate) => candidate.evidenceObjectIds || []),
    count: async (kind) => (await readCount({ collectionName: collectionName(kind), filter: filter(), session, readBudget })).value,
    readPage: (kind, after, limit) => readMany({ collectionName: collectionName(kind), filter: filter(after),
      projection: {}, sort: { _id: 1 }, limit, session, readBudget, ...(boundedInventoryRead ? { batchSize: limit } : {}) }),
    validateRows: (kind, rows) => {
      validateScope(rows)
      assertStateVersions({ control, rows, requireSourceStateVersion: true })
      if (boundedInventoryRead && kind === 'evidence') assertCurrentEvidenceSourceRows(rows)
      if (kind === 'sources') assertCurrentEvidenceSourceRows(rows)
      else if (rows.some((row) => row.current !== true || !normalizeText(row.evidenceObjectId)
        || !normalizeText(row.sourceId))) throw createRuntimeStateError({
        code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_CURRENTNESS_INVALID, message: 'Evidence snapshot currentness or identity is invalid.' })
    },
  })
  const { evidenceObjects, sourceRegistry } = assembled
  const finalControl = await getControl({ scopes, runtimeInstanceId, includeHandoffEligibility: true, session, ...metadataOptions })
  if (snapshotHash(await readSections()) !== snapshotHash(sectionRows)
    || snapshotHash(finalControl) !== snapshotHash(control)) throw createRuntimeStateError({
    code: 'OUTCOME_EVIDENCE_SNAPSHOT_CONTROL_CHANGED', message: 'Governed evidence scope changed during read.',
    details: { snapshotReceipt: { ...assembled.receipt, completeness: 'INCOMPLETE', reason: 'CONTROL_CHANGED' } } })

  const evidenceIds = evidenceObjects.map((row) => normalizeText(row.evidenceObjectId))
  const sourceIds = sourceRegistry.map((row) => normalizeText(row.sourceId))
  if (evidenceIds.some((id) => !id) || new Set(evidenceIds).size !== evidenceIds.length
    || sourceIds.some((id) => !id) || new Set(sourceIds).size !== sourceIds.length
    || evidenceObjects.some((row) => !sourceIds.includes(normalizeText(row.sourceId)))) throw createRuntimeStateError({
    code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING,
    message: 'Evidence-to-Meaning source snapshot identities are incomplete or ambiguous.' })
  if (evidenceObjects.some((row) => row.current !== true)) throw createRuntimeStateError({
    code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_CURRENTNESS_INVALID,
    message: 'Evidence-to-Meaning evidence storage currentness is invalid.' })
  if (sourceRegistry.length) assertCurrentEvidenceSourceRows(sourceRegistry)
  for (const rows of [evidenceObjects, sourceRegistry]) if (rows.length) assertStateVersions({ control, rows,
    missingMessage: 'Evidence-to-Meaning source state-version receipt is missing.', requireSourceStateVersion: true })
  const snapshot = { ...control.handoffFrameworkState?.evidence_pack,
    snapshotVersion: 'outcome-evidence-source-snapshot.v1', stateVersion: control.stateVersion,
    inventoryReceipt: assembled.receipt, evidenceObjects, sourceRegistry }
  try {
    assertSerializedPayloadSize(snapshot)
  } catch {
    throw createRuntimeStateError({ code: 'OUTCOME_EVIDENCE_SNAPSHOT_PROJECTION_BOUND',
      message: 'Complete evidence inventory cannot fit the governed section projection.',
      details: { snapshotReceipt: { ...assembled.receipt, completeness: 'INCOMPLETE', reason: 'PROJECTION_BOUND' } } })
  }
  return JSON.parse(JSON.stringify(snapshot))
}

export const getRuntimeStateEvidenceInventory = async ({ scopes, runtimeInstanceId } = {}) => {
  const deadline = Date.now() + 6000
  const workDeadline = deadline - 500
  const readBudget = () => {
    const remaining = workDeadline - Date.now()
    if (remaining <= 0) throw new Error('Inventory request deadline exceeded.')
    const timeoutMS = Math.min(2000, remaining)
    return { timeoutMS, maxTimeMS: timeoutMS }
  }
  const session = await mongoose.startSession()
  try {
    // Manual transaction keeps the supported per-operation CSOT independent.
    session.startTransaction({ readConcern: { level: 'snapshot' }, readPreference: 'primary', maxCommitTimeMS: 2000 })
    // Require V2 before the existing internal reader can select legacy storage.
    const control = await getControl({ scopes, runtimeInstanceId, session, metadataMaxTimeMS: 2000, readBudget })
    const snapshot = await getRuntimeOutcomeEvidenceContractSnapshot({ scopes, runtimeInstanceId, session, boundedInventoryRead: true, readBudget })
    readBudget()
    const result = projectIntelligenceEvidenceInventory({ snapshot, control, readAt: new Date().toISOString() })
    await session.commitTransaction({ timeoutMS: readBudget().timeoutMS })
    readBudget()
    return result
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction({ timeoutMS: Math.max(1, Math.min(2000, deadline - Date.now())) })
    }
    if ([401, 403, 404, 422].includes(error.status)) throw error
    throw createRuntimeStateError({ code: 'INTELLIGENCE_EVIDENCE_INVENTORY_UNAVAILABLE', status: 503,
      message: 'The current evidence inventory could not complete its bounded read. Refresh.',
      details: { reason: /^OUTCOME_EVIDENCE_SNAPSHOT_[A-Z_]+$/.test(error.code || '') ? error.code : 'INVENTORY_READ_UNAVAILABLE' } })
  } finally { await session.endSession() }
}

export const getRuntimeOutcomePlanningEvidence = async ({ scopes, runtimeInstanceId, session = null,
  planningEvidenceVersion = OUTCOME_PLANNING_EVIDENCE_VERSIONS.V1 } = {}) => {
  if (!Object.values(OUTCOME_PLANNING_EVIDENCE_VERSIONS).includes(planningEvidenceVersion)) {
    throw createRuntimeStateError({ code: 'OUTCOME_PLANNING_TRUTH_BLOCKED', message: 'Planning evidence version is invalid.' })
  }
  const control = await getRuntimeInstance({ scopes, runtimeInstanceId,
    projection: RUNTIME_STATE_V2_CONTROL_PROJECTION, maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS, session })
  if (control.stateVersion || control.runtimeStateVersion) {
    return readRuntimeStateOutcomeHandoff({ scopes, runtimeInstanceId, planningEvidence: true, session, planningEvidenceVersion })
  }
  // Legacy is selected only by absence of V2 identity; never a failed-V2 fallback.
  const runtime = await getRuntimeInstance({ scopes, runtimeInstanceId,
    projection: `${RUNTIME_STATE_V2_HANDOFF_CONTROL_PROJECTION} framework_state.sections`, maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS, session })
  assertSerializedPayloadSize(runtime)
  if (runtime.stateVersion || runtime.runtimeStateVersion) throw createRuntimeStateError({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED, message: 'Runtime storage identity changed.' })
  const resolved = await resolveFrameworkOutcomeStudioHandoff({ runtimeInstance: { ...runtime, _id: runtime.id }, scopes,
    boundedDependencyPolicy: FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY })
  return buildOutcomePlanningRuntimeEvidence({ runtimeInstance: { ...runtime, _id: runtime.id },
    frameworkPackage: resolved.frameworkPackage, handoff: resolved.handoff, planningEvidenceVersion })
}

export const __testables = Object.freeze({
  RUNTIME_STATE_V2_HANDOFF_SECTION_PROJECTION,
  RUNTIME_STATE_V2_CHILD_PROJECTION,
  RUNTIME_STATE_V2_RENDERER_SECTION_PROJECTION,
  buildStateVersion,
  buildRuntimeIdentityFilter,
  buildCurrentStateFilter,
  assertCurrentSectionRows,
  materializeStoredRuntimeSectionDetail,
  readMany,
  readHandoffSectionRows,
  getRuntimeStateBootstrap,
  serializeSectionSummary,
  serializeEvidenceObject,
})
