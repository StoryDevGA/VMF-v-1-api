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
import { createSectionHistoryReadContext, createSectionHistoryProjectors, getSectionHistoryRowKey } from './runtimeSectionHistoryContract.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { RUNTIME_STATE_V2_CANONICAL_ALGORITHM } from './runtimeStateCanonicalSerializer.js'

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

const executeFind = async (model, filter, { session, limit, maxTimeMS = 2000 }) => {
  let query = model.find(filter)
  if (typeof query?.session === 'function') query = query.session(session)
  if (typeof query?.limit === 'function') query = query.limit(limit)
  if (typeof query?.maxTimeMS === 'function') query = query.maxTimeMS(maxTimeMS)
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

const prepareInheritedHistory = async ({ source, revision, model, receiptId, session }) => {
  const keys = Object.entries(revision.framework_state?.sections || {})
    .filter(([, value]) => Array.isArray(value?.revisions) && value.revisions.length > 0)
    .map(([key]) => key)
  if (!keys.length) return null
  if (keys.length > 100 || session.inTransaction?.() !== true) fail('Revision history requires an active bounded transaction.')
  const sourceScope = targetScope(source), deadline = Date.now() + 6000
  const readBudget = () => {
    const maxTimeMS = Math.min(2000, deadline - Date.now())
    if (maxTimeMS <= 0) fail('Revision history read budget is exhausted.')
    return { maxTimeMS }
  }
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => identity(row[key]) === identity(value))
  const validate = row => {
    const error = new RuntimeStateSection(row).validateSync()
    if (error) fail('Revision history section model is invalid.', { path: Object.keys(error.errors || {})[0] })
    if (identity(row.migrationReceiptId) !== identity(receiptId)) fail('Revision history baseline receipt does not match.')
  }
  const rows = await executeFind(model, { ...sourceScope, current: true, stateVersion: source.stateVersion,
    sectionKey: { $in: keys } }, { session, limit: keys.length + 1, ...readBudget() })
  if (rows.length !== keys.length || new Set(rows.map(row => row.sectionKey)).size !== keys.length) {
    fail('Revision history source section membership is ambiguous.')
  }
  for (const row of rows) {
    const path = `framework_state.sections.${row.sectionKey}`, projection = row.projectionReceipt
    if (!keys.includes(row.sectionKey) || !matches(row, sourceScope) || row.current !== true
      || row.stateVersion !== source.stateVersion || row.sourceStateVersion !== source.stateVersion
      || row.legacyPath !== path || projection?.logicalPath !== path
      || projection?.algorithm !== RUNTIME_STATE_V2_CANONICAL_ALGORITHM
      || projection?.mappingVersion !== 'ss014-v2-mapping-v1'
      || projection?.stateVersion !== row.stateVersion || projection?.sourceHash !== row.sourceHash) {
      fail('Revision history source section scope is invalid.')
    }
    validate(row)
  }
  const targets = []
  const verified = await createSectionHistoryReadContext({ session, readBudget,
    readRows: async (filter, options) => {
      const found = await executeFind(model, filter, { session, limit: 2, ...options })
      targets.push(...found)
      return found
    } }).verify(rows)
  const projectors = new Map(rows.map(row => [row.sectionKey, createSectionHistoryProjectors({
    observedRow: row, resolvedRecords: verified.get(getSectionHistoryRowKey(row)),
  })]))
  const copies = new Map(), childScope = targetScope(revision)
  for (const row of targets) {
    validate(row)
    if (!matches(row, sourceScope) || !keys.includes(row.sectionKey) || row.current !== false
      || row.stateVersion === revision.stateVersion) fail('Revision history target scope is invalid.')
    const key = `${row.sectionKey}|${row.stateVersion}`
    const previous = copies.get(key)
    if (previous) {
      const material = value => Object.fromEntries(Object.entries(value).filter(([name]) => name !== '_id'))
      if (membershipHash(material(previous)) !== membershipHash(material({ ...row, ...childScope, current: false }))) {
        fail('Revision history target identity conflicts.')
      }
    } else {
      const copy = { ...row, ...childScope, _id: new mongoose.Types.ObjectId(), current: false }
      validate(copy)
      copies.set(key, copy)
    }
  }
  const full = new Map()
  return {
    copies: [...copies.values()],
    project: (detail, { sectionKey, common }) => {
      if (!projectors.has(sectionKey)) return detail
      const row = rows.find(item => item.sectionKey === sectionKey)
      if (row.sourceHash !== common.sourceHash) fail('Revision history source domain hash changed.')
      full.set(sectionKey, detail)
      return projectors.get(sectionKey).previous(detail)
    },
    verifyChild: async sections => {
      const childRows = sections.filter(row => projectors.has(row.sectionKey))
      const restored = await createSectionHistoryReadContext({ session, readBudget,
        readRows: async filter => [...copies.values()].filter(row => matches(row, filter)),
      }).verify(childRows)
      for (const row of childRows) {
        const resolved = restored.get(getSectionHistoryRowKey(row))
        const records = row.sectionDetail.revisions.map((record, index) => resolved.has(index) ? resolved.get(index) : record)
        if (membershipHash(records) !== membershipHash(full.get(row.sectionKey).revisions)) {
          fail('Revision history child archive does not match its full root.')
        }
      }
    },
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

  let history
  try {
    history = await prepareInheritedHistory({ source: sourceRuntimeInstance, revision: revisionRuntimeInstance,
      model: models.RuntimeStateSection, receiptId: receipts[0].receiptId, session })
  } catch (error) {
    if (error.code !== 'RUNTIME_SECTION_HISTORY_INVALID') throw error
    fail('Revision source history could not be verified.', { reason: error.details?.reason })
  }
  const rowSet = rowSetBuilder({
    legacyInput: buildLegacyInput(revisionRuntimeInstance),
    scope,
    stateVersion: revisionRuntimeInstance.stateVersion,
    migrationReceiptId: receipts[0].receiptId,
    migrationTimestamp: new Date(now).toISOString(),
  }, { sectionDetailProjector: history?.project })

  if (history) {
    try { await history.verifyChild(rowSet.rows.sections) } catch (error) {
      if (error.code !== 'RUNTIME_SECTION_HISTORY_INVALID') throw error
      fail('Revision child history could not be verified.', { reason: error.details?.reason })
    }
    await insertRows({ model: models.RuntimeStateSection, rows: history.copies, session })
  }

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
