import { createHash, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeAcquisitionRun, { ACQUISITION_RUN_VERSION, ACQUISITION_PLANNER_VERSION, ACQUISITION_TERMINAL_STATES } from '../models/RuntimeAcquisitionRun.js'
import AuditLog from '../models/AuditLog.js'
import auditService from './auditService.js'
import { normalizeDiscoveryInputs, planDiscoveryAcquisition } from './runtimeStateMutationService.js'
import { decodeDocumentBuffer, normalizeDocumentFileName } from './discoveryIntelligenceService.js'
import { getRuntimeInstance, assertRuntimePermission } from './runtimeInstanceService.js'
import { isRuntimeLocked, isRuntimeLifecycleTruthImmutable } from './runtimeActionPolicyService.js'
import { requireCanonicalRuntimeStateVersion } from './runtimeStateVersionService.js'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'
import { assertAcquisitionTerminalProof } from './acquisitionReceiptProof.js'

export const ACQUISITION_TRANSACTION_OPTIONS = { timeoutMS: 6000, maxCommitTimeMS: 2000,
  readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }
export const ACQUISITION_CALLER_DEADLINE_MS = 600000
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const terminal = row => ACQUISITION_TERMINAL_STATES.includes(row?.status)
const fail = (reason, message, status = 409, runId) => { throw Object.assign(new Error(message), {
  code: status === 503 ? 'SERVICE_UNAVAILABLE' : status === 404 ? 'NOT_FOUND' : status === 422 ? 'VALIDATION_FAILED' : 'CONFLICT', status, details: { reason, ...(runId ? { runId } : {}) },
}) }
const scopeFor = runtime => Object.fromEntries(['customerId', 'tenantId'].map(key => [key, new mongoose.Types.ObjectId(runtime[key])])
  .concat([['runtimeInstanceId', new mongoose.Types.ObjectId(runtime._id || runtime.id)]]))
const documentHash = input => createHash('sha256').update(decodeDocumentBuffer(input)).digest('hex')
const queryBudget = deadline => {
  const remaining = deadline - Date.now()
  if (remaining <= 0) fail('ACQUISITION_READ_DEADLINE', 'Acquisition history could not be verified in time. Refresh.', 503)
  return { timeoutMS: remaining, maxTimeMS: Math.min(2000, remaining) }
}
const identity = context => ({ ...context.scope, runId: context.runId, actorUserId: new mongoose.Types.ObjectId(context.actorUserId),
  executionAttemptId: context.executionAttemptId, requestFingerprint: context.requestFingerprint })

export const acquisitionRequestFingerprint = ({ payload = {}, actionKey, actorUserId }) => snapshotHash({
  actionKey, actorUserId: String(actorUserId), expectedUpdatedAt: payload.expectedUpdatedAt,
  inputs: payload.inputs === undefined ? { omitted: true } : normalizeDiscoveryInputs(payload.inputs).normalizedInputs,
  acquisitionProfile: payload.acquisitionProfile === undefined ? { omitted: true } : payload.acquisitionProfile,
  documents: (payload.documentSources || []).map((input, inputIndex) => ({ inputIndex,
    fileName: normalizeDocumentFileName(input.fileName), mimeType: input.mimeType || '', assetType: input.assetType || 'CUSTOMER_DOCUMENT',
    sizeBytes: input.sizeBytes ?? null, contentHash: documentHash(input) })),
  predecessorRunId: payload.predecessorRunId || null,
})

export const publicAcquisitionRun = (row, options = {}) => ({
  contractVersion: row.contractVersion, runId: row.runId, requestKey: row.requestKey,
  scope: { customerId: String(row.customerId), tenantId: String(row.tenantId), runtimeInstanceId: String(row.runtimeInstanceId),
    runtimeInstanceKey: row.runtimeInstanceKey, rootRuntimeInstanceKey: row.rootRuntimeInstanceKey },
  actorUserId: String(row.actorUserId), authority: row.authority, actionKey: row.actionKey, acquisitionProfile: row.acquisitionProfile,
  basisStateVersion: row.basisStateVersion, basisUpdatedAt: row.basisUpdatedAt,
  status: row.status, createdAt: row.createdAt, startedAt: row.startedAt, completedAt: row.completedAt,
  ...(row.predecessorRunId ? { predecessorRunId: row.predecessorRunId } : {}),
  ...(terminal(row) ? { canonicalSaved: row.canonicalSaved, outputStateVersion: row.outputStateVersion,
    outcomes: row.outcomes.map(({ kind, inputIndex, status, sourceId, evidenceObjectCount, reason }) =>
      ({ kind, inputIndex, status, ...(sourceId ? { sourceId } : {}), evidenceObjectCount, ...(reason ? { reason } : {}) })),
    audit: { admissionId: String(row.admissionAuditId), startId: String(row.startAuditId), terminalId: String(row.terminalAuditId),
      ...(row.saveAuditId ? { saveId: String(row.saveAuditId) } : {}) },
  } : { recovery: 'Execution outcome is unconfirmed. Refresh and inspect this Run; do not start another acquisition.' }),
  ...(row.reason ? { reason: row.reason } : {}), ...options,
})

const requireIndexes = async deadline => {
  if (mongoose.connection.readyState !== 1) fail('ACQUISITION_STORAGE_UNAVAILABLE', 'Acquisition execution storage is unavailable.', 503)
  let indexes
  try { indexes = await RuntimeAcquisitionRun.collection.listIndexes(queryBudget(deadline)).toArray() }
  catch { fail('ACQUISITION_STORAGE_UNAVAILABLE', 'Acquisition execution storage has not been verified.', 503) }
  for (const [key, options] of RuntimeAcquisitionRun.schema.indexes()) {
    const found = indexes.find(index => index.name === options.name)
    if (!found || JSON.stringify(found.key) !== JSON.stringify(key) || Boolean(found.unique) !== Boolean(options.unique)
      || JSON.stringify(found.partialFilterExpression || null) !== JSON.stringify(options.partialFilterExpression || null))
      fail('ACQUISITION_INDEX_REQUIRED', 'Acquisition execution indexes have not been verified.', 503)
  }
}
const recordedAudit = async ({ context, phase, session, extra = {} }) => {
  const audit = await auditService.log({ actorUserId: context.actorUserId,
    action: auditService.AUDIT_ACTIONS.RUNTIME_ACQUISITION_RECORDED, resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
    resourceId: context.scope.runtimeInstanceId, requestId: context.auditRequest?.requestId,
    scope: { ...context.scope, runtimeInstanceKey: context.runtime.runtimeInstanceKey },
    diff: { runId: context.runId, executionAttemptId: context.executionAttemptId, phase,
      requestFingerprint: context.requestFingerprint, ...extra },
  }, { session, throwOnError: true })
  if (!audit?._id || !audit.signature || !audit.signatureVersion)
    fail('ACQUISITION_AUDIT_UNAVAILABLE', 'Acquisition execution audit could not be verified.', 503, context.runId)
  return audit
}

// Driver ABORTED state is not acknowledgement. The raw command respects remaining CSOT.
export const withAcquisitionTransaction = async (work, context) => {
  const session = await mongoose.startSession()
  const tracking = { commitPossible: false, abortConfirmed: false }
  if (context) context.transaction = tracking
  try {
    return await session.withTransaction(async () => {
      try {
        const result = await work(session)
        tracking.commitPossible = true
        return result
      } catch (error) {
        if (!tracking.commitPossible && session.inTransaction()) {
          try {
            const ack = await mongoose.connection.db.admin().command({ abortTransaction: 1 }, { session, timeoutMS: 6000 })
            tracking.abortConfirmed = ack.ok === 1
          } catch (abortError) { tracking.abortConfirmed = abortError.code === 251 }
        }
        throw error
      }
    }, ACQUISITION_TRANSACTION_OPTIONS)
  } finally { await session.endSession() }
}

const readExact = async (filter, deadline = Date.now() + 6000) => {
  try { return await RuntimeAcquisitionRun.collection.findOne(filter,
    { readConcern: { level: 'majority' }, ...queryBudget(deadline) }) }
  catch (error) {
    if (error.status) throw error
    fail('ACQUISITION_READ_UNAVAILABLE', 'Acquisition receipt could not be verified. Refresh and inspect its Run.', 503, filter.runId)
  }
}
const verifiedAudit = async (row, auditId, phase, deadline, session = null) => {
  const budget = queryBudget(deadline)
  const audit = await AuditLog.findOne({ _id: auditId, resourceId: row.runtimeInstanceId, actorUserId: row.actorUserId,
    action: auditService.AUDIT_ACTIONS.RUNTIME_ACQUISITION_RECORDED }).setOptions(session ? { maxTimeMS: budget.maxTimeMS, session } : budget)
  if (!audit || !audit.verifySignature() || audit.diff?.runId !== row.runId
    || audit.diff.executionAttemptId !== row.executionAttemptId || audit.diff.phase !== phase
    || audit.diff.requestFingerprint !== row.requestFingerprint)
    fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Acquisition receipt audit could not be verified. Refresh.', 503, row.runId)
  return audit
}
const verifyTerminal = async (row, deadline, session = null) => {
  const audit = await verifiedAudit(row, row.terminalAuditId, row.status, deadline, session)
  let save
  if (row.canonicalSaved) {
    // The terminal audit binds the signature returned by the same save transaction.
    // Read only its anchor; do not hydrate the legacy before/after runtime audit payload.
    const budget = queryBudget(deadline)
    save = await AuditLog.findOne({ _id: row.saveAuditId, resourceId: row.runtimeInstanceId, actorUserId: row.actorUserId })
      .select('action signature signatureVersion actorUserId resourceId').setOptions(session ? { maxTimeMS: budget.maxTimeMS, session } : budget)
  }
  return assertAcquisitionTerminalProof(row, audit, save)
}

// The caller has already performed its actual authorization/entitlement checks.
// Lookup before resolving defaults or checking current write lifecycle enables honest replay.
export const lookupAcquisitionRequest = async ({ runtimeInstance, payload = {}, actorUserId, actionKey, auditRequest }) => {
  const deadline = Date.now() + 6000
  await requireIndexes(deadline)
  const requestKey = payload.requestKey || randomUUID()
  if (!uuid.test(requestKey) || payload.predecessorRunId && !uuid.test(payload.predecessorRunId))
    fail('ACQUISITION_REQUEST_INVALID', 'A valid acquisition request identity is required.', 422)
  const context = { runtime: runtimeInstance, scope: scopeFor(runtimeInstance), actorUserId, actionKey, auditRequest,
    requestKey, requestFingerprint: acquisitionRequestFingerprint({ payload, actionKey, actorUserId }),
    runId: randomUUID(), executionAttemptId: randomUUID(), payload }
  const existing = await readExact({ ...context.scope, requestKey }, deadline)
  if (existing) {
    if (existing.requestFingerprint !== context.requestFingerprint)
      fail('ACQUISITION_REQUEST_CONFLICT', 'This request identity belongs to different inputs, authority or basis.', 409, existing.runId)
    if (!terminal(existing)) fail('ACQUISITION_RUN_IN_PROGRESS', 'This acquisition outcome is not yet confirmed. Inspect its Run before retrying.', 409, existing.runId)
    await verifyTerminal(existing, deadline)
    context.replay = publicAcquisitionRun(existing, { replay: true, requiresRefresh: true })
  }
  return context
}
const assertCurrentControl = async (context, session) => {
  const row = await RuntimeInstance.collection.findOne({ _id: context.scope.runtimeInstanceId,
    customerId: context.scope.customerId, tenantId: context.scope.tenantId }, { session, maxTimeMS: 2000,
    projection: { stateVersion: 1, updatedAt: 1, status: 1, executionStatus: 1, lockedAt: 1,
      'framework_state.lock': 1, 'framework_state.lifecycle': 1 } })
  if (!row || requireCanonicalRuntimeStateVersion(row) !== context.basisStateVersion
    || new Date(row.updatedAt).getTime() !== new Date(context.payload.expectedUpdatedAt).getTime())
    fail('ACQUISITION_RUN_STALE', 'The revision changed before acquisition. Refresh its current basis.', 409, context.runId)
  if (row.status !== 'ACTIVE' || ['RUNNING', 'VALIDATING', 'COMPLETE', 'ERROR'].includes(row.executionStatus)
    || isRuntimeLocked({ runtimeInstance: row }) || isRuntimeLifecycleTruthImmutable(row.framework_state))
    fail('ACQUISITION_RUN_LOCKED', 'This revision does not permit acquisition. Inspect or open an editable revision.', 409, context.runId)
}
export const startAcquisitionRun = async (context, inputs) => {
  const plan = planDiscoveryAcquisition({ inputs, acquisitionProfile: context.payload.acquisitionProfile,
    previousEvidencePack: context.runtime.framework_state?.evidence_pack || {} })
  context.plan = plan
  context.basisStateVersion = requireCanonicalRuntimeStateVersion(context.runtime)
  const documents = (context.payload.documentSources || []).map((input, inputIndex) =>
    ({ kind: 'DOCUMENT', inputIndex, contentHash: documentHash(input) }))
  const descriptors = [{ kind: 'BRIEF', inputIndex: 0, contentHash: snapshotHash(plan.normalizedInputs) },
    ...plan.websiteSources.map((url, inputIndex) => ({ kind: 'WEBSITE', inputIndex, contentHash: snapshotHash(url) })), ...documents]
  const base = { ...context.scope, rootRuntimeInstanceId: context.runtime.revision?.rootRuntimeId || context.scope.runtimeInstanceId,
    runtimeInstanceKey: context.runtime.runtimeInstanceKey,
    rootRuntimeInstanceKey: context.runtime.revision?.rootRuntimeInstanceKey || context.runtime.runtimeInstanceKey,
    runId: context.runId, requestKey: context.requestKey, executionAttemptId: context.executionAttemptId,
    requestFingerprint: context.requestFingerprint, plannerFingerprint: snapshotHash({ plan, descriptors }),
    contractVersion: ACQUISITION_RUN_VERSION, plannerVersion: ACQUISITION_PLANNER_VERSION,
    actorUserId: context.actorUserId, authority: 'VMF_UPDATE', actionKey: context.actionKey, acquisitionProfile: plan.profile,
    basisStateVersion: context.basisStateVersion, basisUpdatedAt: new Date(context.payload.expectedUpdatedAt),
    ...(context.payload.predecessorRunId ? { predecessorRunId: context.payload.predecessorRunId } : {}),
    inputs: descriptors, status: 'QUEUED', active: true, createdAt: new Date() }
  try {
    await withAcquisitionTransaction(async session => {
      await assertCurrentControl(context, session)
      if (base.predecessorRunId) {
        const predecessor = await RuntimeAcquisitionRun.collection.findOne({ ...context.scope, runId: base.predecessorRunId }, { session, maxTimeMS: 2000 })
        if (!predecessor || !['FAILED', 'PARTIALLY_SUCCEEDED'].includes(predecessor.status))
          fail('ACQUISITION_PREDECESSOR_INVALID', 'Retry must identify an unsuccessful Run in this exact revision.', 409, context.runId)
        await verifyTerminal(predecessor, Date.now() + 6000, session)
      }
      const audit = await recordedAudit({ context, phase: 'QUEUED', session })
      const row = new RuntimeAcquisitionRun({ ...base, admissionAuditId: audit._id, admissionAuditSignatureVersion: audit.signatureVersion })
      await row.save({ session })
    }, context)
  } catch (error) {
    const existing = await readExact({ ...context.scope, requestKey: context.requestKey })
    if (!existing || existing.executionAttemptId !== context.executionAttemptId || existing.requestFingerprint !== context.requestFingerprint) {
      if (error.code === 11000 || existing) {
        const active = existing || await readExact({ ...context.scope, active: true })
        fail('ACQUISITION_RUN_IN_PROGRESS', 'Another acquisition already owns this revision or request.', 409, active?.runId)
      }
      throw error
    }
  }
  let row = await readExact(identity(context))
  if (!row || row.status !== 'QUEUED') fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Acquisition admission could not be confirmed. Refresh.', 503, context.runId)
  await verifiedAudit(row, row.admissionAuditId, 'QUEUED', Date.now() + 6000)
  try {
    await withAcquisitionTransaction(async session => {
      await assertCurrentControl(context, session)
      const audit = await recordedAudit({ context, phase: 'RUNNING', session })
      const changed = await RuntimeAcquisitionRun.collection.updateOne({ ...identity(context), status: 'QUEUED', active: true },
        { $set: { status: 'RUNNING', startedAt: new Date(), startAuditId: audit._id, startAuditSignatureVersion: audit.signatureVersion } }, { session })
      if (changed.modifiedCount !== 1) fail('ACQUISITION_RUN_IN_PROGRESS', 'This execution has already been claimed.', 409, context.runId)
    }, context)
  } catch (error) {
    row = await readExact(identity(context))
    if (!row || row.status !== 'RUNNING') throw error
  }
  row = await readExact(identity(context))
  if (!row || row.status !== 'RUNNING') fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Acquisition start could not be confirmed.', 503, context.runId)
  await verifiedAudit(row, row.startAuditId, 'RUNNING', Date.now() + 6000)
  context.row = row
  return context
}

export const buildAcquisitionRunOutcomes = (context, pack, error) => {
  const channel = error?.details?.acquisitionOutcomes
  const website = pack?.acquisition?.websiteAcquisition?.latestAttempt?.items || channel?.websiteItems || []
  const documents = pack?.acquisition?.documentAcquisition?.latestAttempt?.items || channel?.documentItems || []
  const briefComplete = pack ? pack.inputComplete : channel?.briefComplete
  const invalid = () => fail('ACQUISITION_OUTCOME_INVALID', 'Actual acquisition outcomes do not match their execution inputs.', 409, context.runId)
  for (const [kind, items] of [['WEBSITE', website], ['DOCUMENT', documents]]) {
    const intended = context.row.inputs.filter(input => input.kind === kind)
    // A settled successful builder must account for every intended input. Only an
    // incomplete brief suppresses website execution; it never suppresses documents.
    const expected = kind === 'WEBSITE' && briefComplete === false ? 0 : intended.length
    if (!Array.isArray(items) || items.length > intended.length
      || pack && items.length !== expected || new Set(items.map(item => item?.inputIndex)).size !== items.length) invalid()
    for (const item of items) {
      if (!intended.some(input => input.inputIndex === item?.inputIndex)
        || !['SUCCEEDED', 'FAILED'].includes(item?.status)
        || item.status === 'SUCCEEDED' && (!Number.isSafeInteger(item.evidenceObjectCount) || item.evidenceObjectCount < 0)
        || item.status === 'FAILED' && item.evidenceObjectCount !== undefined && item.evidenceObjectCount !== 0
        || item.status === 'SUCCEEDED' && (typeof item.sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(item.sourceId))) invalid()
      if (pack && item.status === 'SUCCEEDED') {
        const matches = pack.lineage?.sources?.filter(source => source.sourceId === item.sourceId)
        if (matches?.length !== 1) invalid()
        const source = matches[0], hash = String(source.valueHash || '').replace(/^sha256:/, '')
        const evidence = pack.evidenceObjects?.filter(row => row.sourceId === item.sourceId)
        if (!Array.isArray(evidence) || evidence.length !== item.evidenceObjectCount
          || new Set(evidence.map(row => row.evidenceObjectId)).size !== evidence.length
          || evidence.some(row => typeof row.evidenceObjectId !== 'string' || !row.evidenceObjectId)
          || source.evidenceProduced !== item.evidenceObjectCount || source.status !== 'ACQUIRED'
          || source.acquisitionProfile !== context.row.acquisitionProfile || !/^[a-f0-9]{64}$/.test(hash)) invalid()
        const descriptor = intended.find(input => input.inputIndex === item.inputIndex)
        if (kind === 'WEBSITE') {
          if (source.sourceType !== 'WEBSITE' || source.type !== 'WEBSITE_ACQUISITION'
            || source.adapter !== 'website-html-fetch-v1' || snapshotHash(source.url) !== descriptor.contentHash) invalid()
        } else if (source.sourceType !== 'UPLOADED_DOCUMENT' || source.type !== 'UPLOADED_DOCUMENT'
          || source.documentStatus !== 'PROCESSED' || hash !== descriptor.contentHash
          || source.documentHash !== item.documentHash || source.valueHash !== item.documentHash) invalid()
      }
    }
  }
  if (pack && typeof briefComplete !== 'boolean') invalid()
  return context.row.inputs.map(input => {
    if (input.kind === 'BRIEF') return { kind: input.kind, inputIndex: 0,
      status: typeof briefComplete === 'boolean' ? briefComplete ? 'SUCCEEDED' : 'FAILED' : 'UNATTEMPTED', evidenceObjectCount: 0,
      ...(briefComplete === false ? { reason: 'BRIEF_INCOMPLETE' } : {}) }
    const item = (input.kind === 'WEBSITE' ? website : documents).find(item => item.inputIndex === input.inputIndex)
    if (!item) return { kind: input.kind, inputIndex: input.inputIndex, status: 'UNATTEMPTED', evidenceObjectCount: 0,
      reason: 'INPUT_NOT_ATTEMPTED' }
    const source = pack?.lineage?.sources?.find(source => source.sourceId === item.sourceId)
    const contentHash = String(input.kind === 'DOCUMENT' ? item.documentHash || '' : source?.valueHash || '').replace(/^sha256:/, '')
    if (pack && item.status === 'SUCCEEDED' && (!/^[a-f0-9]{64}$/.test(contentHash)
      || input.kind === 'DOCUMENT' && contentHash !== input.contentHash))
      fail('ACQUISITION_OUTCOME_INVALID', 'Actual acquired content does not match its execution basis.', 409, context.runId)
    return { kind: input.kind, inputIndex: input.inputIndex, status: item.status, ...(item.sourceId ? { sourceId: item.sourceId } : {}),
      ...(item.status === 'SUCCEEDED' && /^[a-f0-9]{64}$/.test(contentHash) ? { contentHash } : {}),
      evidenceObjectCount: item.status === 'SUCCEEDED' ? item.evidenceObjectCount : 0,
      ...(item.status === 'FAILED' ? { reason: input.kind === 'WEBSITE' ? 'WEBSITE_ACQUISITION_FAILED' : 'DOCUMENT_EXTRACTION_FAILED' } : {}) }
  })
}
export const bindAcquisitionSourceProcessing = (context, pack) => {
  const outcomes = buildAcquisitionRunOutcomes(context, pack)
  const updates = outcomes.filter(item => item.status === 'SUCCEEDED' && item.kind !== 'BRIEF').map(item => {
    const matches = pack.sourceRegistry?.filter(source => source.sourceId === item.sourceId)
    const contentHash = `sha256:${item.contentHash}`
    if (matches?.length !== 1
      || matches[0].sourceType !== (item.kind === 'DOCUMENT' ? 'UPLOADED_DOCUMENT' : 'WEBSITE')
      || item.kind === 'DOCUMENT' && matches[0].documentHash !== contentHash)
      fail('ACQUISITION_OUTCOME_INVALID', 'Acquired source registry does not match its execution basis.', 409, context.runId)
    return { source: matches[0], item, contentHash }
  })
  for (const { source, item, contentHash } of updates) {
    source.contentHash = contentHash
    if (item.kind === 'DOCUMENT') source.processingReceipt = {
      contractVersion: 'document-processing-receipt.v1', runId: context.runId,
      inputIndex: item.inputIndex, contentHash,
    }
  }
  return pack
}

export const executeAcquisitionBuild = async (context, build) => {
  let timer
  try {
    const result = await Promise.race([Promise.resolve().then(build), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Acquisition execution exceeded its caller deadline. Inspect its Run before retrying.'),
        { status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'ACQUISITION_OUTCOME_UNCONFIRMED', runId: context.runId } })), ACQUISITION_CALLER_DEADLINE_MS)
    })])
    context.extractionSettled = true
    return result
  } catch (error) {
    if (error.details?.reason !== 'ACQUISITION_OUTCOME_UNCONFIRMED') context.extractionSettled = true
    throw error
  } finally { clearTimeout(timer) }
}

export const recordAcquisitionTerminal = async ({ context, pack, error, outputStateVersion, saveAudit, session }) => {
  const canonicalSaved = Boolean(outputStateVersion && saveAudit?._id && saveAudit.signature && saveAudit.signatureVersion)
  const outcomes = buildAcquisitionRunOutcomes(context, pack, error)
  const status = canonicalSaved ? outcomes.every(item => item.status === 'SUCCEEDED') ? 'SUCCEEDED'
    : outcomes.some(item => item.status === 'SUCCEEDED') ? 'PARTIALLY_SUCCEEDED' : 'FAILED' : 'FAILED'
  const reason = canonicalSaved ? undefined : 'ACQUISITION_NOT_SAVED'
  const terminalAudit = await recordedAudit({ context, phase: status, session, extra: { outcomeHash: snapshotHash(outcomes),
    canonicalSaved, outputStateVersion: outputStateVersion || null, saveAuditId: saveAudit?._id ? String(saveAudit._id) : null,
    saveAuditSignature: saveAudit?.signature || null } })
  const fields = { status, active: false, outcomes, canonicalSaved, completedAt: new Date(),
    terminalAuditId: terminalAudit._id, terminalAuditSignatureVersion: terminalAudit.signatureVersion,
    ...(canonicalSaved ? { outputStateVersion, saveAuditId: saveAudit._id, saveAuditSignatureVersion: saveAudit.signatureVersion,
      saveAuditSignature: saveAudit.signature } : { reason }) }
  await new RuntimeAcquisitionRun({ ...context.row, ...fields }).validate()
  const changed = await RuntimeAcquisitionRun.collection.updateOne({ ...identity(context), status: 'RUNNING', active: true }, { $set: fields }, { session })
  if (changed.modifiedCount !== 1) fail('ACQUISITION_RUN_STALE', 'Acquisition terminal ownership changed.', 409, context.runId)
}
export const readCommittedAcquisition = async context => {
  const deadline = Date.now() + 6000
  const row = await readExact(identity(context), deadline)
  if (!terminal(row)) return null
  await verifyTerminal(row, deadline)
  return publicAcquisitionRun(row)
}
export const handleAcquisitionFailure = async (context, error, pack) => {
  if (!context?.row) throw error
  const committed = await readCommittedAcquisition(context)
  if (committed) return { acquisitionRun: { ...committed, replay: true, requiresRefresh: true } }
  if (!context.extractionSettled || context.rootPersistenceStarted
    && (!context.transaction?.abortConfirmed || context.transaction?.commitPossible))
    fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Acquisition outcome could not be confirmed. Refresh and inspect this Run before retrying.', 503, context.runId)
  try {
    await withAcquisitionTransaction(session => recordAcquisitionTerminal({ context, pack, error, session }))
  } catch {
    const receipt = await readCommittedAcquisition(context)
    if (!receipt) fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Acquisition failure recording could not be confirmed. Inspect its Run.', 503, context.runId)
  }
  const receipt = await readCommittedAcquisition(context)
  if (!receipt) fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Acquisition terminal receipt is unavailable. Inspect its Run.', 503, context.runId)
  error.details = { ...error.details, runId: context.runId, acquisitionRun: receipt }
  throw error
}

const loadReadContext = async (args, deadline) => {
  const session = await mongoose.startSession()
  let runtime
  try {
    await session.withTransaction(async () => {
      runtime = await getRuntimeInstance({ scopes: args.scopes, runtimeInstanceId: args.runtimeInstanceId,
        projection: 'customerId tenantId runtimeInstanceKey runtimeType revision stateVersion updatedAt',
        maxTimeMS: queryBudget(deadline).maxTimeMS, metadataMaxTimeMS: 2000, session })
      queryBudget(deadline)
      await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes,
        customerId: runtime.customerId, tenantId: runtime.tenantId, permission: 'VMF_VIEW', session, maxTimeMS: queryBudget(deadline).maxTimeMS })
    }, { ...ACQUISITION_TRANSACTION_OPTIONS, timeoutMS: queryBudget(deadline).timeoutMS })
  } finally { await session.endSession() }
  await requireIndexes(deadline)
  return runtime
}
const readAcquisitionRuns = async args => {
  const deadline = Date.now() + 6000
  const runtime = await loadReadContext(args, deadline), scope = scopeFor(runtime)
  const cursor = args.query?.cursor
  let after
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString())
      if (!mongoose.isValidObjectId(parsed.id) || !Number.isFinite(Date.parse(parsed.time))) throw new Error('Invalid cursor')
      after = { $or: [{ createdAt: { $lt: new Date(parsed.time) } }, { createdAt: new Date(parsed.time), _id: { $lt: new mongoose.Types.ObjectId(parsed.id) } }] }
    } catch { fail('ACQUISITION_CURSOR_INVALID', 'Acquisition history cursor is invalid.', 422) }
  }
  const projection = Object.fromEntries(['contractVersion', 'runId', 'requestKey', 'customerId', 'tenantId', 'runtimeInstanceId',
    'runtimeInstanceKey', 'rootRuntimeInstanceKey', 'actorUserId', 'authority', 'actionKey', 'acquisitionProfile', 'basisStateVersion',
    'basisUpdatedAt', 'status', 'createdAt', 'startedAt', 'completedAt', 'predecessorRunId', 'canonicalSaved', 'outputStateVersion',
    'outcomes.kind', 'outcomes.inputIndex', 'outcomes.status', 'outcomes.sourceId', 'outcomes.evidenceObjectCount', 'outcomes.reason',
    'admissionAuditId', 'startAuditId', 'terminalAuditId', 'saveAuditId', 'reason'].map(key => [key, 1]))
  const rows = await RuntimeAcquisitionRun.collection.find({ ...scope, ...after }, { ...queryBudget(deadline), projection })
    .sort({ createdAt: -1, _id: -1 }).limit(26).batchSize(26).toArray()
  const items = rows.slice(0, 25), last = items.at(-1), hasMore = rows.length > 25
  return { contractVersion: ACQUISITION_RUN_VERSION, scope: { ...Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, String(value)])),
    runtimeInstanceKey: runtime.runtimeInstanceKey }, observedStateVersion: runtime.stateVersion,
  items: items.map(row => publicAcquisitionRun(row)), hasMore,
  nextCursor: hasMore ? Buffer.from(JSON.stringify({ id: String(last._id), time: last.createdAt.toISOString() })).toString('base64url') : null,
  completeness: hasMore ? 'MORE_PAGES' : 'COMPLETE_PAGE', verification: 'RECORDED_HISTORY_PREVIEW',
  recovery: 'Open an exact Run to verify its signed terminal receipt.' }
}
const readAcquisitionRun = async args => {
  const deadline = Date.now() + 6000
  const runtime = await loadReadContext(args, deadline)
  const row = await readExact({ ...scopeFor(runtime), runId: args.runId }, deadline)
  if (!row) fail('ACQUISITION_RUN_NOT_FOUND', 'Acquisition Run not found in this revision.', 404)
  if (terminal(row)) await verifyTerminal(row, deadline)
  return publicAcquisitionRun(row, { observedStateVersion: runtime.stateVersion,
    currency: row.outputStateVersion === runtime.stateVersion ? 'CURRENT_OUTPUT' : terminal(row) ? 'HISTORICAL_OUTPUT' : 'ACTIVE' })
}
const safeRead = async (args, read) => {
  try { return await read(args) }
  catch (error) {
    if (error.status) throw error
    fail('ACQUISITION_READ_UNAVAILABLE', 'Acquisition history or receipt could not be verified. Refresh.', 503, args.runId)
  }
}
export const getAcquisitionRuns = args => safeRead(args, readAcquisitionRuns)
export const getAcquisitionRun = args => safeRead(args, readAcquisitionRun)
