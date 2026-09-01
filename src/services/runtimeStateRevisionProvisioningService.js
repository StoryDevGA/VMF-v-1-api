import mongoose from 'mongoose'

import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import RuntimeStateMigrationReceipt, {
  RUNTIME_STATE_MIGRATION_OPERATION_TYPES,
  RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES,
} from '../models/RuntimeStateMigrationReceipt.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import { createRuntimeStateLegacyRowSet } from './runtimeStateLegacyMapper.js'

export const RUNTIME_STATE_V2_REVISION_PROVISIONING_ERROR_CODE =
  'RUNTIME_STATE_V2_REVISION_PROVISIONING_INVALID'

const fail = (message, details = {}) => {
  const error = new Error(message)
  error.code = RUNTIME_STATE_V2_REVISION_PROVISIONING_ERROR_CODE
  error.status = 409
  error.details = details
  throw error
}

const identity = (value) => String(value?._id || value || '').trim()

const executeFind = async (model, filter, { session, limit }) => {
  let query = model.find(filter)
  if (typeof query?.session === 'function') query = query.session(session)
  if (typeof query?.limit === 'function') query = query.limit(limit)
  if (typeof query?.lean === 'function') query = query.lean()
  return query
}

const buildLegacyInput = (runtimeInstance) => {
  const root = typeof runtimeInstance?.toObject === 'function'
    ? runtimeInstance.toObject({ depopulate: true, virtuals: false })
    : { ...runtimeInstance }
  let rawBsonBytes
  try {
    rawBsonBytes = mongoose.mongo.BSON.serialize(root).length
  } catch {
    fail('Runtime V2 revision source could not be serialized.')
  }
  return {
    rawBsonBytes,
    sections: root.framework_state?.sections,
    evidencePack: root.framework_state?.evidence_pack,
    intelligenceGraph: root.framework_state?.intelligence_graph,
  }
}

const targetScope = (runtimeInstance) => ({
  customerId: runtimeInstance.customerId,
  tenantId: runtimeInstance.tenantId,
  runtimeInstanceId: runtimeInstance._id,
  runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
})

const SOURCE_FAMILIES = Object.freeze([
  ['sections', 'RuntimeStateSection'],
  ['evidenceSources', 'RuntimeEvidenceSource'],
  ['evidenceObjects', 'RuntimeEvidenceObject'],
])

const GRAPH_FAMILIES = Object.freeze([
  ['graphSnapshots', 'RuntimeGraphSnapshot'],
  ['graphElements', 'RuntimeGraphElement'],
])

const insertRows = async ({ model, rows, session }) => {
  if (rows.length === 0) return
  const inserted = await model.insertMany(rows, { ordered: true, session })
  if (!Array.isArray(inserted) || inserted.length !== rows.length) {
    fail('Runtime V2 revision insert count is inconsistent.')
  }
}

export const stageRuntimeStateRevisionProvisioning = async ({
  sourceRuntimeInstance,
  revisionRuntimeInstance,
  session,
  now = new Date(),
  dependencies = {},
} = {}) => {
  if (!session) fail('Runtime V2 revision provisioning requires the revision transaction session.')
  if (!identity(sourceRuntimeInstance?._id)
    || !identity(revisionRuntimeInstance?._id)
    || identity(sourceRuntimeInstance?._id) === identity(revisionRuntimeInstance?._id)
    || !identity(revisionRuntimeInstance?.stateVersion)) {
    fail('Runtime V2 revision provisioning identity is invalid.')
  }

  const models = {
    RuntimeEvidenceObject: dependencies.RuntimeEvidenceObject || RuntimeEvidenceObject,
    RuntimeEvidenceSource: dependencies.RuntimeEvidenceSource || RuntimeEvidenceSource,
    RuntimeGraphElement: dependencies.RuntimeGraphElement || RuntimeGraphElement,
    RuntimeGraphSnapshot: dependencies.RuntimeGraphSnapshot || RuntimeGraphSnapshot,
    RuntimeStateMigrationReceipt: dependencies.RuntimeStateMigrationReceipt || RuntimeStateMigrationReceipt,
    RuntimeStateSection: dependencies.RuntimeStateSection || RuntimeStateSection,
  }
  const rowSetBuilder = dependencies.createRuntimeStateLegacyRowSet || createRuntimeStateLegacyRowSet
  const lineageRuntimeId = sourceRuntimeInstance?.revision?.rootRuntimeId || sourceRuntimeInstance._id
  const lineageRuntimeKey = sourceRuntimeInstance?.revision?.rootRuntimeInstanceKey
    || sourceRuntimeInstance.runtimeInstanceKey
  const receipts = await executeFind(models.RuntimeStateMigrationReceipt, {
    customerId: sourceRuntimeInstance.customerId,
    tenantId: sourceRuntimeInstance.tenantId,
    runtimeInstanceId: lineageRuntimeId,
    runtimeInstanceKey: lineageRuntimeKey,
    operationType: {
      $in: [
        RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE,
        RUNTIME_STATE_MIGRATION_OPERATION_TYPES.NATIVE_INITIALIZATION,
      ],
    },
    status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED,
  }, { session, limit: 2 })
  if (receipts.length !== 1) {
    fail('Runtime V2 revision provisioning requires one verified source baseline receipt.', {
      receiptCount: receipts.length,
    })
  }

  const scope = targetScope(revisionRuntimeInstance)
  const existingChecks = await Promise.all(
    [...SOURCE_FAMILIES, ...GRAPH_FAMILIES].map(async ([, modelKey]) => executeFind(
      models[modelKey],
      scope,
      { session, limit: 1 },
    )),
  )
  if (existingChecks.some((rows) => rows.length > 0)) {
    fail('Runtime V2 revision target already contains child state.')
  }

  const rowSet = rowSetBuilder({
    legacyInput: buildLegacyInput(revisionRuntimeInstance),
    scope,
    stateVersion: revisionRuntimeInstance.stateVersion,
    migrationReceiptId: receipts[0].receiptId,
    migrationTimestamp: new Date(now).toISOString(),
  })

  for (const [family, modelKey] of SOURCE_FAMILIES) {
    await insertRows({
      model: models[modelKey],
      rows: rowSet.rows[family].map((row) => ({ ...row, current: true })),
      session,
    })
  }
  for (const [family, modelKey] of GRAPH_FAMILIES) {
    await insertRows({ model: models[modelKey], rows: rowSet.rows[family], session })
  }

  return {
    counts: rowSet.counts,
    migrationReceiptId: receipts[0].receiptId,
    sourceSetHash: rowSet.sourceSetHash,
  }
}

export default { stageRuntimeStateRevisionProvisioning }
