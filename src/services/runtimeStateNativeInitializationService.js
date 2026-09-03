import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import mongoose from 'mongoose'

import RuntimeStateMigrationReceipt, {
  RUNTIME_STATE_MIGRATION_LOGICAL_PATHS,
  RUNTIME_STATE_MIGRATION_OPERATION_TYPES,
  RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES,
  RUNTIME_STATE_MIGRATION_TARGET_COLLECTIONS,
} from '../models/RuntimeStateMigrationReceipt.js'
import { createRuntimeStateCanonicalMappingManifest } from './runtimeStateCanonicalSerializer.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import { createRuntimeStateLegacySourceRowSet } from './runtimeStateLegacyMapper.js'
import { normalizeRuntimeSectionObject } from './runtimeSectionModelService.js'
import { resolveRuntimePathSelections } from './runtimePathRegistryService.js'

export const RUNTIME_STATE_V2_NATIVE_INITIALIZATION_ERROR_CODE =
  'RUNTIME_STATE_V2_NATIVE_INITIALIZATION_INVALID'

const fail = (message) => {
  const error = new Error(message)
  error.code = RUNTIME_STATE_V2_NATIVE_INITIALIZATION_ERROR_CODE
  error.status = 409
  throw error
}

const identity = (value) => String(value?._id || value || '').trim()

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`

const assertEmptyRecord = (value, label) => {
  if (value == null) return
  if (value instanceof Map && value.size === 0) return
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 0) {
    fail(`Native Runtime State V2 ${label} must be empty at initialization.`)
  }
}

const isEmptyRecord = (value) => value == null
  || (value instanceof Map && value.size === 0)
  || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)

export const isRuntimeStateNativeInitialFrameworkState = (frameworkState = {}) =>
  isEmptyRecord(frameworkState?.sections)
  && isEmptyRecord(frameworkState?.evidence_pack)
  && isEmptyRecord(frameworkState?.intelligence_graph)

export const normalizeRuntimeStateNativeSections = (frameworkState = {}) => ({
  ...(frameworkState || {}),
  sections: isEmptyRecord(frameworkState?.sections) ? {} : frameworkState.sections,
})

export const buildRuntimeStateNativeInitialFrameworkState = ({ frameworkState, stateVersion } = {}) => {
  assertEmptyRecord(frameworkState?.sections, 'sections')
  assertEmptyRecord(frameworkState?.evidence_pack, 'evidence')
  const graph = frameworkState?.intelligence_graph
  if (graph != null) assertEmptyRecord(graph, 'graph')

  return {
    sections: {},
    evidence_pack: { sourceRegistry: [], evidenceObjects: [] },
    intelligence_graph: { graphVersion: stateVersion, nodes: [], edges: [] },
  }
}

// Only new runtime creation uses this package-derived catalogue. Legacy empty
// initialization and rollover normalization retain their existing contracts.
export const buildRuntimeStateNativeCreationFrameworkState = ({ frameworkPackage, stateVersion } = {}) => {
  const declarations = frameworkPackage?.sections === undefined ? [] : frameworkPackage.sections
  if (!Array.isArray(declarations) || declarations.length > 100) {
    fail('Native runtime package sections must be a bounded section catalogue.')
  }
  const sections = {}
  const identities = new Set()
  for (const declaration of declarations) {
    const { sectionKey, runtimePath } = declaration || {}
    const match = typeof runtimePath === 'string'
      ? /^framework_state\.sections\.([a-z][a-z0-9_-]*)$/.exec(runtimePath)
      : null
    const key = match?.[1]
    const normalizedKey = typeof sectionKey === 'string' ? sectionKey.replaceAll('_', '-') : ''
    if (!/^[a-z][a-z0-9_-]*$/.test(sectionKey || '') || !key
      || ['constructor', 'prototype'].includes(key)
      || key.replaceAll('_', '-') !== normalizedKey || identities.has(normalizedKey)) {
      fail('Native runtime package section keys and root paths must be safe, unique and aligned.')
    }
    identities.add(normalizedKey)
    const section = normalizeRuntimeSectionObject({
      value: { input: null, generated: null, accepted: null, state: { status: 'DRAFT' } },
      sectionKey,
      runtimePath,
    })
    // Avoid empty metadata objects that MongoDB minimizes on root persistence.
    sections[key] = Object.fromEntries(
      ['input', 'generated', 'accepted', 'state', 'lineage', 'revisions', 'evidenceObjects']
        .map((field) => [field, section[field]]),
    )
  }
  return declarations.length ? {
    sections,
    evidence_pack: { sourceRegistry: [], evidenceObjects: [] },
    intelligence_graph: { graphVersion: stateVersion, nodes: [], edges: [] },
  } : { sections: {}, evidence_pack: {} }
}

export const validateRuntimeStateNativeCreationPaths = async (frameworkPackage) => {
  const result = await resolveRuntimePathSelections({
    pathKeys: (frameworkPackage.sections || []).map((section) => section.runtimePath),
    frameworkKeys: [frameworkPackage.frameworkKey || 'VMF'],
    operation: 'READ',
    requireActive: true,
    selectFields: 'pathKey status frameworkKeys allowedOperations dataType scope',
  })
  if (['missing', 'inactive', 'invalidOperation', 'incompatibleFramework'].some((key) => result[key].length)
    || result.rows.some((row) => row.dataType !== 'OBJECT' || row.scope !== 'FRAMEWORK_STATE')) {
    fail('Native runtime section paths must be active, readable framework-compatible section objects.')
  }
}

const buildCanonicalInitialState = (runtimeInstance, frameworkPackage) => {
  const root = typeof runtimeInstance?.toObject === 'function'
    ? runtimeInstance.toObject({ depopulate: true, virtuals: false })
    : { ...runtimeInstance }
  const expected = frameworkPackage && buildRuntimeStateNativeCreationFrameworkState({
    frameworkPackage,
    stateVersion: root.stateVersion,
  })
  const hasPackageSections = expected && Object.keys(expected.sections).length > 0
  if (hasPackageSections && Object.keys(expected).some((key) =>
    !isDeepStrictEqual(root.framework_state?.[key], expected[key]))) {
    fail('Native runtime section initialization must exactly match the pristine package catalogue.')
  }
  const frameworkState = hasPackageSections ? expected : buildRuntimeStateNativeInitialFrameworkState({
    frameworkState: root.framework_state,
    stateVersion: root.stateVersion,
  })
  root.framework_state = frameworkState

  let rawBsonBytes
  try {
    rawBsonBytes = mongoose.mongo.BSON.serialize(root).length
  } catch {
    fail('Native Runtime State V2 initialization could not serialize the runtime root.')
  }

  const legacyInput = {
    rawBsonBytes,
    sections: frameworkState.sections,
    evidencePack: frameworkState.evidence_pack,
    intelligenceGraph: frameworkState.intelligence_graph,
  }
  return {
    legacyInput,
    serializerResult: createRuntimeStateCanonicalMappingManifest(legacyInput).serializerResult,
  }
}

const logicalRecordCount = (logicalPath, sectionCount) => {
  if (logicalPath === 'framework_state.sections') return sectionCount
  if (logicalPath === 'framework_state.evidence_pack') return 0
  if (logicalPath === 'framework_state.intelligence_graph') return 0
  fail('Native Runtime State V2 initialization logical path is unsupported.')
}

export const stageRuntimeStateNativeInitialization = async ({
  actorUserId,
  runtimeInstance,
  frameworkPackage,
  session,
  now = new Date(),
  dependencies = {},
} = {}) => {
  if (!session) fail('Native Runtime State V2 initialization requires the create transaction session.')
  const runtimeInstanceId = identity(runtimeInstance?._id)
  const runtimeInstanceKey = String(runtimeInstance?.runtimeInstanceKey || '').trim().toLowerCase()
  const customerId = identity(runtimeInstance?.customerId)
  const tenantId = identity(runtimeInstance?.tenantId)
  const stateVersion = identity(runtimeInstance?.stateVersion)
  if (!runtimeInstanceId || !runtimeInstanceKey || !customerId || !tenantId || !stateVersion) {
    fail('Native Runtime State V2 initialization identity is incomplete.')
  }

  const { serializerResult, legacyInput } = buildCanonicalInitialState(runtimeInstance, frameworkPackage)
  const scopeDigest = sha256([customerId, tenantId, runtimeInstanceId, runtimeInstanceKey].join('\n'))
  const timestamp = new Date(now)
  if (Number.isNaN(timestamp.valueOf())) fail('Native Runtime State V2 initialization timestamp is invalid.')
  const ReceiptModel = dependencies.RuntimeStateMigrationReceipt || RuntimeStateMigrationReceipt
  const receipt = new ReceiptModel({
    idempotencyKey: `ss014:native-initialization:${scopeDigest}`,
    operationType: RUNTIME_STATE_MIGRATION_OPERATION_TYPES.NATIVE_INITIALIZATION,
    targetSelectionRef: {
      bindingRef: `native-runtime:${runtimeInstanceKey}`,
      scopeDigest,
    },
    scopeDigest,
    customerId: runtimeInstance.customerId,
    tenantId: runtimeInstance.tenantId,
    runtimeInstanceId: runtimeInstance._id,
    runtimeInstanceKey,
    logicalSources: RUNTIME_STATE_MIGRATION_LOGICAL_PATHS.map((logicalPath) => ({
      logicalPath,
      targetCollections: RUNTIME_STATE_MIGRATION_TARGET_COLLECTIONS[logicalPath],
      sourceHash: Object.values(serializerResult.domains)
        .find((domain) => domain.logicalPath === logicalPath).sourceHash,
      recordCount: logicalRecordCount(logicalPath, Object.keys(legacyInput.sections).length),
    })),
    sourceSetHash: serializerResult.sourceSetHash,
    assignedStateVersion: stateVersion,
    actor: {
      actorRef: identity(actorUserId) || 'runtime-instance-service',
      actorType: identity(actorUserId) ? 'USER' : 'SERVICE',
    },
    status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED,
    assignedAt: timestamp,
    verifiedAt: timestamp,
  })
  if (Object.keys(legacyInput.sections).length) {
    const rowSet = createRuntimeStateLegacySourceRowSet({
      legacyInput,
      scope: { runtimeInstanceId, runtimeInstanceKey, customerId, tenantId },
      stateVersion,
      migrationReceiptId: identity(receipt.receiptId),
      migrationTimestamp: timestamp.toISOString(),
    })
    const SectionModel = dependencies.RuntimeStateSection || RuntimeStateSection
    await SectionModel.insertMany(rowSet.rows.sections.map((row) => ({
      ...row, current: true, stateStatus: 'DRAFT',
    })), { session })
  }
  await receipt.save({ session })
  return receipt
}

export default { stageRuntimeStateNativeInitialization }
