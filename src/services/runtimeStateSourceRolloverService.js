import mongoose from 'mongoose'

import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeStateMigrationReceipt, {
  RUNTIME_STATE_MIGRATION_OPERATION_TYPES,
  RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES,
} from '../models/RuntimeStateMigrationReceipt.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import { createRuntimeStateLegacySourceRowSet } from './runtimeStateLegacyMapper.js'
import {
  buildRuntimeStateNativeInitialFrameworkState,
  isRuntimeStateNativeInitialFrameworkState,
  normalizeRuntimeStateNativeSections,
} from './runtimeStateNativeInitializationService.js'

const ERROR_CODE = 'RUNTIME_STATE_V2_SOURCE_ROLLOVER_INVALID'

const fail = (message, details = {}) => {
  const error = new Error(message)
  error.code = ERROR_CODE
  error.status = 409
  error.details = details
  throw error
}

const normalizeIdentity = (value) => String(value?._id || value || '').trim()

const scopeFromRuntime = (runtimeInstance) => ({
  customerId: runtimeInstance?.customerId,
  tenantId: runtimeInstance?.tenantId,
  runtimeInstanceId: runtimeInstance?._id,
  runtimeInstanceKey: runtimeInstance?.runtimeInstanceKey,
})

const scopeFilter = (scope) => ({
  customerId: scope.customerId,
  tenantId: scope.tenantId,
  runtimeInstanceId: scope.runtimeInstanceId,
  runtimeInstanceKey: scope.runtimeInstanceKey,
})

const executeFind = async (model, filter, { session, limit }) => {
  let query = model.find(filter)
  if (typeof query?.session === 'function') query = query.session(session)
  if (typeof query?.limit === 'function') query = query.limit(limit)
  if (typeof query?.lean === 'function') query = query.lean()
  return query
}

const mutationCount = (result) => result?.modifiedCount
  ?? result?.nModified
  ?? result?.matchedCount
  ?? result?.n
  ?? 0

const assertScope = (scope) => {
  if (Object.values(scope).some((value) => !normalizeIdentity(value))) {
    fail('Runtime V2 source rollover scope is incomplete.')
  }
}

const normalizeTimestamp = (value) => {
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.valueOf())) fail('Runtime V2 source rollover timestamp is invalid.')
  return parsed.toISOString()
}

const buildLegacyInput = ({ frameworkState, runtimeInstance, stateVersion }) => {
  const root = typeof runtimeInstance?.toObject === 'function'
    ? runtimeInstance.toObject({ depopulate: true, virtuals: false })
    : { ...runtimeInstance }
  root.framework_state = frameworkState
  root.stateVersion = stateVersion
  let rawBsonBytes
  try {
    rawBsonBytes = mongoose.mongo.BSON.serialize(root).length
  } catch {
    fail('Runtime V2 source rollover could not serialize the runtime source.')
  }
  return {
    rawBsonBytes,
    sections: frameworkState?.sections,
    evidencePack: frameworkState?.evidence_pack,
    intelligenceGraph: frameworkState?.intelligence_graph,
  }
}

const buildSourceRowSet = ({
  frameworkState,
  migrationReceiptId,
  migrationTimestamp,
  runtimeInstance,
  stateVersion,
  rowSetBuilder,
}) => rowSetBuilder({
  legacyInput: buildLegacyInput({ frameworkState, runtimeInstance, stateVersion }),
  scope: scopeFromRuntime(runtimeInstance),
  stateVersion,
  migrationReceiptId,
  migrationTimestamp,
})

const FAMILY_SPECS = Object.freeze([
  { key: 'sections', identityKey: 'sectionKey', modelKey: 'RuntimeStateSection' },
  { key: 'evidenceSources', identityKey: 'sourceId', modelKey: 'RuntimeEvidenceSource' },
  { key: 'evidenceObjects', identityKey: 'evidenceObjectId', modelKey: 'RuntimeEvidenceObject' },
])

const assertCurrentRows = ({ expectedRows, identityKey, observedRows, receiptId, stateVersion, family }) => {
  if (observedRows.length !== expectedRows.length) {
    fail(`Runtime V2 ${family} current row count does not match the source.`, {
      expectedCount: expectedRows.length,
      observedCount: observedRows.length,
    })
  }
  const expectedByIdentity = new Map(expectedRows.map((row) => [normalizeIdentity(row[identityKey]), row]))
  const observedIdentities = new Set()
  let observedSourceHash = ''
  for (const row of observedRows) {
    const identity = normalizeIdentity(row[identityKey])
    const expected = expectedByIdentity.get(identity)
    const rowSourceHash = normalizeIdentity(row.sourceHash)
    if (!identity || observedIdentities.has(identity) || !expected
      || normalizeIdentity(row.stateVersion) !== normalizeIdentity(stateVersion)
      || normalizeIdentity(row.migrationReceiptId) !== normalizeIdentity(receiptId)
      || !rowSourceHash
      || (observedSourceHash && rowSourceHash !== observedSourceHash)) {
      fail(`Runtime V2 ${family} current row identity or lineage is inconsistent.`)
    }
    observedSourceHash = rowSourceHash
    observedIdentities.add(identity)
  }
  return observedSourceHash
}

const insertRows = async ({ model, rows, session }) => {
  if (rows.length === 0) return
  const inserted = await model.insertMany(rows, { ordered: true, session })
  if (!Array.isArray(inserted) || inserted.length !== rows.length) {
    fail('Runtime V2 source rollover candidate insert count is inconsistent.')
  }
}

const transitionRows = async ({
  expectedRows,
  model,
  nextRows,
  previousSourceHash,
  previousStateVersion,
  nextStateVersion,
  receiptId,
  scope,
  session,
  family,
}) => {
  await insertRows({ model, rows: nextRows, session })

  if (expectedRows.length > 0) {
    const demoted = await model.updateMany({
      ...scopeFilter(scope),
      stateVersion: previousStateVersion,
      migrationReceiptId: receiptId,
      sourceHash: previousSourceHash,
      current: true,
    }, { $set: { current: false } }, { session })
    if (mutationCount(demoted) !== expectedRows.length) {
      fail(`Runtime V2 ${family} demotion count is inconsistent.`)
    }
  }

  if (nextRows.length > 0) {
    const promoted = await model.updateMany({
      ...scopeFilter(scope),
      stateVersion: nextStateVersion,
      migrationReceiptId: receiptId,
      sourceHash: nextRows[0].sourceHash,
      current: false,
    }, { $set: { current: true } }, { session })
    if (mutationCount(promoted) !== nextRows.length) {
      fail(`Runtime V2 ${family} promotion count is inconsistent.`)
    }
  }
}

export const stageRuntimeStateSourceRollover = async ({
  runtimeInstance,
  expectedStateVersion,
  nextStateVersion,
  nextFrameworkState,
  mutationTimestamp,
  session,
  dependencies = {},
} = {}) => {
  if (!session) fail('Runtime V2 source rollover requires the source transaction session.')
  if (normalizeIdentity(runtimeInstance?.stateVersion) !== normalizeIdentity(expectedStateVersion)
    || !normalizeIdentity(nextStateVersion)
    || normalizeIdentity(nextStateVersion) === normalizeIdentity(expectedStateVersion)) {
    fail('Runtime V2 source rollover state-version transition is invalid.')
  }

  const models = {
    RuntimeEvidenceObject: dependencies.RuntimeEvidenceObject || RuntimeEvidenceObject,
    RuntimeEvidenceSource: dependencies.RuntimeEvidenceSource || RuntimeEvidenceSource,
    RuntimeStateMigrationReceipt: dependencies.RuntimeStateMigrationReceipt || RuntimeStateMigrationReceipt,
    RuntimeStateSection: dependencies.RuntimeStateSection || RuntimeStateSection,
  }
  const rowSetBuilder = dependencies.createRuntimeStateLegacySourceRowSet || createRuntimeStateLegacySourceRowSet
  const scope = scopeFromRuntime(runtimeInstance)
  assertScope(scope)

  const receipts = await executeFind(models.RuntimeStateMigrationReceipt, {
    customerId: scope.customerId,
    tenantId: scope.tenantId,
    runtimeInstanceId: runtimeInstance?.revision?.rootRuntimeId || runtimeInstance?._id,
    runtimeInstanceKey: runtimeInstance?.revision?.rootRuntimeInstanceKey || runtimeInstance?.runtimeInstanceKey,
    operationType: {
      $in: [
        RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE,
        RUNTIME_STATE_MIGRATION_OPERATION_TYPES.NATIVE_INITIALIZATION,
      ],
    },
    status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED,
  }, { session, limit: 2 })
  if (receipts.length !== 1) {
    fail('Runtime V2 source rollover requires exactly one verified baseline receipt.', {
      receiptCount: receipts.length,
    })
  }
  const receipt = receipts[0]
  const timestamp = normalizeTimestamp(mutationTimestamp)
  const persistedRuntime = typeof runtimeInstance?.toObject === 'function'
    ? runtimeInstance.toObject({ depopulate: true, virtuals: false })
    : runtimeInstance
  const persistedFrameworkState = persistedRuntime?.framework_state || {}
  const nativeInitialization = receipt.operationType
    === RUNTIME_STATE_MIGRATION_OPERATION_TYPES.NATIVE_INITIALIZATION
  const nativeInitialTransition = nativeInitialization
    && normalizeIdentity(expectedStateVersion) === normalizeIdentity(receipt.assignedStateVersion)
    && isRuntimeStateNativeInitialFrameworkState(persistedFrameworkState)
  const previousFrameworkState = nativeInitialTransition
    ? buildRuntimeStateNativeInitialFrameworkState({
        frameworkState: persistedFrameworkState,
        stateVersion: expectedStateVersion,
      })
    : nativeInitialization
      ? normalizeRuntimeStateNativeSections(persistedFrameworkState)
      : persistedFrameworkState
  const canonicalNextFrameworkState = nativeInitialization
    ? normalizeRuntimeStateNativeSections(nextFrameworkState)
    : nextFrameworkState
  const previousRows = buildSourceRowSet({
    frameworkState: previousFrameworkState,
    migrationReceiptId: receipt.receiptId,
    migrationTimestamp: normalizeTimestamp(receipt.verifiedAt || timestamp),
    runtimeInstance,
    stateVersion: expectedStateVersion,
    rowSetBuilder,
  })
  const nextRows = buildSourceRowSet({
    frameworkState: canonicalNextFrameworkState,
    migrationReceiptId: receipt.receiptId,
    migrationTimestamp: timestamp,
    runtimeInstance,
    stateVersion: nextStateVersion,
    rowSetBuilder,
  })

  const previousSourceHashes = new Map()
  for (const spec of FAMILY_SPECS) {
    const expected = previousRows.rows[spec.key]
    const observed = await executeFind(models[spec.modelKey], {
      ...scopeFilter(scope),
      current: true,
    }, { session, limit: expected.length + 1 })
    previousSourceHashes.set(spec.key, assertCurrentRows({
      expectedRows: expected,
      identityKey: spec.identityKey,
      observedRows: observed,
      receiptId: receipt.receiptId,
      stateVersion: expectedStateVersion,
      family: spec.key,
    }))
  }

  for (const spec of FAMILY_SPECS) {
    await transitionRows({
      expectedRows: previousRows.rows[spec.key],
      model: models[spec.modelKey],
      nextRows: nextRows.rows[spec.key],
      previousSourceHash: previousSourceHashes.get(spec.key),
      previousStateVersion: expectedStateVersion,
      nextStateVersion,
      receiptId: receipt.receiptId,
      scope,
      session,
      family: spec.key,
    })
  }

  return {
    counts: nextRows.counts,
    migrationReceiptId: receipt.receiptId,
    sourceSetHash: nextRows.sourceSetHash,
  }
}

export { ERROR_CODE as RUNTIME_STATE_V2_SOURCE_ROLLOVER_ERROR_CODE }
