import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeStateMigrationReceipt from '../models/RuntimeStateMigrationReceipt.js'
import RuntimeReviewCompletion, { REVIEW_COMPLETION_VERSION, REVIEW_POPULATION_POLICY } from '../models/RuntimeReviewCompletion.js'
import { getRuntimeInstance, assertRuntimePermission } from './runtimeInstanceService.js'
import { isRuntimeLocked, isRuntimeLifecycleTruthImmutable } from './runtimeActionPolicyService.js'
import { requireCanonicalRuntimeStateVersion } from './runtimeStateVersionService.js'
import { getDiscoveryContradictionReview, isBoundedContradictionReviewHistory } from './discoveryContradictionReviewService.js'
import auditService from './auditService.js'
import { assembleOutcomeEvidenceInventory, snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'

const MAX_BYTES = 512 * 1024
const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }) }
const remaining = (deadline) => {
  const value = Math.min(2000, deadline - Date.now())
  if (value <= 0) fail('REVIEW_READ_DEADLINE', 'Review population could not be verified in time. Refresh to retry.', 503)
  return value
}
const readOptions = (deadline, readBudget) => readBudget ? readBudget() : { maxTimeMS: remaining(deadline) }
const bound = (value) => { if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES)
  fail('REVIEW_POPULATION_BOUND', 'The complete review population exceeds the verified read budget.') }
const key = (value) => String(value || '')
const scopeFor = (runtime) => ({ customerId: new mongoose.Types.ObjectId(runtime.customerId),
  tenantId: new mongoose.Types.ObjectId(runtime.tenantId), runtimeInstanceId: new mongoose.Types.ObjectId(runtime.id) })
const projection = 'customerId tenantId runtimeInstanceKey runtimeType revision stateVersion runtimeStateVersion status executionStatus lockedAt updatedAt framework_state.lock framework_state.lifecycle framework_state.evidence_pack.state framework_state.evidence_pack.evidenceReady framework_state.evidence_pack.needsRefresh framework_state.evidence_pack.needs_refresh framework_state.evidence_pack.contradictionReviewEpoch framework_state.evidence_pack.contradictionReviews framework_state.evidence_pack.discoveryHealth.contradictionCandidates'
const editable = (runtime) => runtime.runtimeType === 'VALUE_NARRATIVE' && runtime.status === 'ACTIVE'
  && !['RUNNING', 'VALIDATING', 'COMPLETE', 'ERROR'].includes(runtime.executionStatus)
  && !isRuntimeLocked({ runtimeInstance: runtime }) && !isRuntimeLifecycleTruthImmutable(runtime.framework_state)
const load = async (args, session, deadline, readBudget) => {
  const runtime = await getRuntimeInstance({ scopes: args.scopes, runtimeInstanceId: args.runtimeInstanceId,
    projection, session, maxTimeMS: remaining(deadline), readBudget })
  requireCanonicalRuntimeStateVersion(runtime)
  return runtime
}
const currentFilter = (scope) => ({ ...scope, $or: [
  { current: true }, { isCurrent: true }, { stateStatus: 'CURRENT' }, { status: 'CURRENT' },
] })
const semanticEvidence = (row) => Object.fromEntries(['evidenceObjectId', 'sourceId', 'sourceType', 'lineageRef',
  'extractedFact', 'reviewStatus', 'acceptanceState', 'validationStatus', 'contentHash', 'truthHash', 'lineageHash']
  .map((field) => [field, row[field] ?? null]))
const semanticSource = (row) => Object.fromEntries(['sourceId', 'sourceType', 'sourceRef', 'lineageRef', 'contentHash']
  .map((field) => [field, row[field] ?? null]))

// Server-only minimal projections reuse the complete SS-040 inventory scan. UI filters never enter this read.
const compile = async (runtime, session, deadline, readBudget) => {
  const scope = scopeFor(runtime), version = requireCanonicalRuntimeStateVersion(runtime)
  const pack = runtime.framework_state?.evidence_pack || {}
  let candidates = pack.discoveryHealth?.contradictionCandidates
  let reviews = pack.contradictionReviews
  if (candidates !== undefined && (!Array.isArray(candidates) || candidates.length > 8)
    || reviews !== undefined && !isBoundedContradictionReviewHistory(reviews)) {
    fail('REVIEW_POPULATION_UNKNOWN', 'The current finding population cannot be verified.')
  }
  if (Array.isArray(candidates) && (new Set(candidates.map((item) => item?.contradictionId)).size !== candidates.length
    || candidates.some((item) => !item?.contradictionId || !Array.isArray(item.evidenceObjectIds)
      || item.evidenceObjectIds.length !== 2 || new Set(item.evidenceObjectIds).size !== 2))) {
    fail('REVIEW_POPULATION_UNKNOWN', 'The current finding population cannot be verified.')
  }
  const [{ evidenceCount, sourceCount, decisions } = {}] = await RuntimeInstance.aggregate([
    { $match: { _id: scope.runtimeInstanceId, customerId: scope.customerId, tenantId: scope.tenantId, stateVersion: version } },
    { $project: { evidenceCount: { $cond: [{ $isArray: '$framework_state.evidence_pack.evidenceObjects' },
      { $size: '$framework_state.evidence_pack.evidenceObjects' }, null] },
    sourceCount: { $cond: [{ $isArray: '$framework_state.evidence_pack.sourceRegistry' },
      { $size: '$framework_state.evidence_pack.sourceRegistry' }, null] },
    decisions: { $map: { input: { $cond: [{ $isArray: '$framework_state.evidence_pack.evidenceObjects' },
      '$framework_state.evidence_pack.evidenceObjects', []] }, as: 'item', in: {
      id: '$$item.evidenceObjectId', status: '$$item.reviewStatus', acceptedBy: '$$item.acceptedBy',
      acceptanceTimestamp: '$$item.acceptanceTimestamp', rejectedBy: '$$item.rejectedBy', rejectionTimestamp: '$$item.rejectionTimestamp',
    } } } } },
  ]).session(session).option(readOptions(deadline, readBudget))
  bound(decisions || [])
  let expectedEvidence = evidenceCount, expectedSources = sourceCount
  const detectorMissing = candidates === undefined || reviews === undefined
  if (evidenceCount == null || sourceCount == null || detectorMissing) {
    const receipt = await RuntimeStateMigrationReceipt.findOne({ customerId: scope.customerId, tenantId: scope.tenantId,
      runtimeInstanceId: runtime.revision?.rootRuntimeId || scope.runtimeInstanceId,
      operationType: 'NATIVE_INITIALIZATION', status: 'VERIFIED', assignedStateVersion: version })
      .select('logicalSources').session(session).setOptions(readOptions(deadline, readBudget)).lean()
    if (evidenceCount != null && evidenceCount !== 0 || sourceCount != null && sourceCount !== 0
      || !receipt?.logicalSources?.some((item) =>
      item.logicalPath === 'framework_state.evidence_pack' && item.recordCount === 0)) {
      fail('REVIEW_POPULATION_UNKNOWN', 'The expected review inventory is unavailable.')
    }
    expectedEvidence = 0; expectedSources = 0
    candidates ??= []; reviews ??= []
  }
  const decisionMap = new Map((decisions || []).map((item) => [item.id, item]))
  if (decisionMap.size !== expectedEvidence) fail('REVIEW_POPULATION_UNKNOWN', 'Evidence decision identities are ambiguous.')
  const semantic = { evidence: new Map(), sources: new Map() }
  const models = { evidence: RuntimeEvidenceObject, sources: RuntimeEvidenceSource }
  const facts = new Map()
  const candidateIds = new Set(candidates.flatMap((item) => item.evidenceObjectIds))
  const filter = currentFilter(scope)
  const inventory = await assembleOutcomeEvidenceInventory({
    scope: { ...Object.fromEntries(Object.entries(scope).map(([name, value]) => [name, key(value)])),
      runtimeInstanceKey: runtime.runtimeInstanceKey, stateVersion: version }, sections: [],
    contradictionReferences: [...candidateIds],
    count: async (kind) => {
      const result = await models[kind].countDocuments(filter).session(session).setOptions(readOptions(deadline, readBudget))
      if (result !== (kind === 'evidence' ? expectedEvidence : expectedSources))
        fail('REVIEW_INVENTORY_MISMATCH', 'The complete source and evidence inventory does not reconcile.')
      return result
    },
    readPage: async (kind, after, limit) => {
      const rows = await models[kind].find({ ...filter, ...(after ? { _id: { $gt: after } } : {}) })
        .select(kind === 'evidence' ? 'customerId tenantId runtimeInstanceId runtimeInstanceKey stateVersion sourceStateVersion sourceHash migrationReceiptId current isCurrent status stateStatus evidenceObjectId sourceId sourceType lineageRef extractedFact reviewStatus acceptanceState validationStatus contentHash truthHash lineageHash'
          : 'customerId tenantId runtimeInstanceId runtimeInstanceKey stateVersion sourceStateVersion sourceHash migrationReceiptId current isCurrent status stateStatus sourceId sourceType sourceRef lineageRef contentHash')
        .sort({ _id: 1 }).limit(limit).batchSize(limit).session(session).setOptions(readOptions(deadline, readBudget)).lean()
      bound(rows)
      return rows.map((row) => {
        const id = kind === 'evidence' ? row.evidenceObjectId : row.sourceId
        const decision = decisionMap.get(id)
        if (kind === 'evidence' && (!decision || decision.status !== row.reviewStatus
          || !['PENDING', 'ACCEPTED', 'REJECTED'].includes(row.reviewStatus)))
          fail('REVIEW_POPULATION_UNKNOWN', 'An evidence decision state cannot be verified.')
        if (kind === 'evidence' && row.reviewStatus !== 'PENDING') {
          const actor = row.reviewStatus === 'ACCEPTED' ? decision.acceptedBy : decision.rejectedBy
          const time = row.reviewStatus === 'ACCEPTED' ? decision.acceptanceTimestamp : decision.rejectionTimestamp
          if (!mongoose.isValidObjectId(actor) || typeof time !== 'string' || !Number.isFinite(Date.parse(time)))
            fail('REVIEW_DECISION_PROOF_MISSING', 'An evidence disposition has no verifiable actor and time. Inspect its governed decision history.')
        }
        const semanticHash = snapshotHash(kind === 'evidence' ? { evidence: semanticEvidence(row), decision } : semanticSource(row))
        semantic[kind].set(id, { id, basisHash: semanticHash, ...(kind === 'evidence' ? { status: row.reviewStatus } : {}) })
        if (kind === 'evidence' && candidateIds.has(id)) facts.set(id, semanticEvidence(row))
        const { extractedFact, ...compact } = row
        return { ...compact, semanticHash }
      })
    },
    validateRows: (kind, rows) => {
      if (rows.some((row) => row.current !== true || row.isCurrent === false
        || row.status && row.status !== 'CURRENT' || row.stateStatus && row.stateStatus !== 'CURRENT'
        || row.stateVersion !== version || row.sourceStateVersion !== version
        || !/^sha256:[a-f0-9]{64}$/.test(row.sourceHash || '') || !mongoose.isValidObjectId(row.migrationReceiptId)
        || row.runtimeInstanceKey !== runtime.runtimeInstanceKey || !row.sourceId
        || kind === 'evidence' && !row.evidenceObjectId)) {
        fail('REVIEW_INVENTORY_INVALID', 'Review inventory identity, currentness or version is invalid.')
      }
    },
  }).catch((error) => {
    const reason = error.details?.snapshotReceipt?.reason
    if (reason === 'REVIEW_READ_DEADLINE' || typeof reason === 'number' || reason === 'READ_UNAVAILABLE')
      fail('REVIEW_READ_UNAVAILABLE', 'The complete review population could not be verified. Refresh to retry.', 503)
    throw error
  })
  const contradictions = candidates.map((candidate) => {
    const result = getDiscoveryContradictionReview(candidate, [...facts.values()], reviews,
      key(scope.runtimeInstanceId), pack.contradictionReviewEpoch ?? '')
    if (!result.evidencePairHash) fail('REVIEW_POPULATION_UNKNOWN', 'A finding evidence basis cannot be verified.')
    return { id: candidate.contradictionId, evidencePairHash: result.evidencePairHash,
      status: result.reviewStatus, reviewId: result.latestReview?.reviewId ?? null,
      decisionHash: result.latestReview ? snapshotHash(Object.fromEntries(['reviewId', 'reviewEpoch', 'evidencePairHash',
        'disposition', 'reviewedBy', 'reviewedAt', 'rationale'].map((field) => [field, result.latestReview[field] ?? null]))) : null }
  }).sort((a, b) => a.id.localeCompare(b.id))
  const refreshNeeded = pack.needsRefresh === true || pack.needs_refresh === true || pack.state?.needsRefresh === true
    || pack.state?.needs_refresh === true
  if (expectedEvidence > 0 && pack.evidenceReady !== true && pack.state?.evidenceReady !== true)
    fail('REVIEW_POPULATION_UNKNOWN', 'The current evidence readiness basis is unavailable.')
  const manifest = { policy: REVIEW_POPULATION_POLICY, refreshNeeded,
    evidence: [...semantic.evidence.values()].sort((a, b) => a.id.localeCompare(b.id)),
    sources: [...semantic.sources.values()].sort((a, b) => a.id.localeCompare(b.id)), contradictions }
  bound(manifest)
  const pendingEvidence = manifest.evidence.filter((item) => item.status === 'PENDING').length
  const pendingFindings = contradictions.filter((item) => !['NOT_CONTRADICTORY', 'CONFIRMED'].includes(item.status)).length
  const complete = pendingEvidence + pendingFindings === 0 && !refreshNeeded
  return { manifest, populationHash: snapshotHash(manifest), inventoryHash: inventory.receipt.overallHash,
    summary: { completeness: 'COMPLETE', policy: REVIEW_POPULATION_POLICY, target: null,
      evidenceCount: expectedEvidence, sourceCount: expectedSources, pendingEvidence, pendingFindings,
      confirmedReadinessBlockers: contradictions.filter((item) => item.status === 'CONFIRMED').length,
      decisionCount: expectedEvidence + contradictions.length, complete,
      reason: refreshNeeded ? 'EVIDENCE_REFRESH_REQUIRED' : complete ? 'ALL_MANDATORY_DECISIONS_DISPOSED' : 'OUTSTANDING_DECISIONS' } }
}
const publicReceipt = (receipt, populationHash) => ({ receiptId: receipt.receiptId, completedAt: receipt.completedAt,
  actorUserId: key(receipt.actorUserId), authority: receipt.authority, rationale: receipt.rationale,
  populationHash: receipt.populationHash, populationPolicy: receipt.populationPolicy,
  observedStateVersion: receipt.observedStateVersion, auditId: key(receipt.auditId),
  auditSignatureVersion: receipt.auditSignatureVersion,
  currency: receipt.populationHash === populationHash ? 'CURRENT' : 'STALE' })
const response = async (runtime, population, session, deadline, { replay = false, receipt = null, canComplete = false, readBudget } = {}) => {
  const history = await RuntimeReviewCompletion.find(scopeFor(runtime)).select('-manifest -payloadHash -requestKey')
    .sort({ completedAt: -1, _id: -1 }).limit(26).session(session).setOptions(readOptions(deadline, readBudget)).lean()
  return { contractVersion: REVIEW_COMPLETION_VERSION,
    scope: { ...Object.fromEntries(Object.entries(scopeFor(runtime)).map(([name, value]) => [name, key(value)])),
      runtimeInstanceKey: runtime.runtimeInstanceKey,
      rootRuntimeInstanceKey: runtime.revision?.rootRuntimeInstanceKey || runtime.runtimeInstanceKey },
    stateVersion: runtime.stateVersion, runtimeUpdatedAt: runtime.updatedAt,
    population: { ...population.summary, hash: population.populationHash },
    canComplete: canComplete && population.summary.complete && editable(runtime), replay,
    receipt: receipt ? publicReceipt(receipt, population.populationHash) : null,
    latestReceipt: history[0] ? publicReceipt(history[0], population.populationHash) : null,
    history: { records: history.slice(0, 25).map((item) => publicReceipt(item, population.populationHash)),
      hasMore: history.length > 25, completeness: history.length > 25 ? 'PARTIAL' : 'COMPLETE' } }
}
const withinTransaction = async (operation) => {
  const deadline = Date.now() + 6000
  const session = await mongoose.connection.startSession()
  try {
    return await session.withTransaction(() => operation(session, deadline),
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, timeoutMS: deadline - Date.now(), maxCommitTimeMS: 2000 })
  } catch (error) {
    if (error.status && error.code) throw error
    fail('REVIEW_COMPLETION_UNAVAILABLE', 'Review Completion could not be confirmed. Refresh and inspect the recorded receipt before retrying.', 503)
  } finally { await session.endSession() }
}

export const getReviewCompletion = async (args) => {
  const deadline = Date.now() + 6000, workDeadline = deadline - 500
  const readBudget = () => {
    const timeoutMS = remaining(workDeadline)
    return { timeoutMS, maxTimeMS: timeoutMS }
  }
  const session = await mongoose.connection.startSession()
  try {
    session.startTransaction({ readConcern: { level: 'snapshot' }, readPreference: 'primary', maxCommitTimeMS: 2000 })
    const runtime = await load(args, session, workDeadline, readBudget)
    const population = await compile(runtime, session, workDeadline, readBudget)
    let canComplete = false
    try { await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes,
      customerId: runtime.customerId, tenantId: runtime.tenantId, permission: 'VMF_UPDATE', session, readBudget }); canComplete = true }
    catch (error) { if (error.status !== 403) throw error }
    const result = await response(runtime, population, session, workDeadline, { canComplete, readBudget })
    readBudget()
    await session.commitTransaction({ timeoutMS: readBudget().timeoutMS })
    readBudget()
    return { ...result, currency: 'AS_READ', readAt: new Date().toISOString(),
      readReceipt: { bounded: true, maxTimeMS: 2000, requestTimeoutMS: 6000, workTimeoutMS: 5500,
        cleanupReserveMS: 500, inventoryPageSize: 150, historyLimit: 25, maxManifestBytes: MAX_BYTES,
        fullLegacyFrameworkStateFetched: false } }
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction({ timeoutMS: Math.max(1, Math.min(2000, deadline - Date.now())) })
    if (error.status && error.code) throw error
    fail('REVIEW_COMPLETION_UNAVAILABLE', 'Review Completion could not be confirmed. Refresh and inspect the recorded receipt before retrying.', 503)
  } finally { await session.endSession() }
}

export const completeReview = (args) => withinTransaction(async (session, deadline) => {
  const { payload } = args
  if (!payload || Object.keys(payload).some((name) => !['requestKey', 'expectedPopulationHash', 'rationale', 'confirm'].includes(name))
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.requestKey || '')
    || !/^[a-f0-9]{64}$/.test(payload.expectedPopulationHash || '') || payload.confirm !== true
    || typeof payload.rationale !== 'string' || payload.rationale.trim().length < 10 || payload.rationale.length > 2000
    || !mongoose.isValidObjectId(args.actorUserId)) fail('REVIEW_COMPLETION_INVALID', 'Explicit review confirmation, rationale and a valid request identity are required.', 422)
  const runtime = await load(args, session, deadline)
  await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes,
    customerId: runtime.customerId, tenantId: runtime.tenantId, permission: 'VMF_UPDATE', session })
  const scope = scopeFor(runtime)
  const payloadHash = snapshotHash({ ...payload, actorUserId: key(args.actorUserId) })
  const existing = await RuntimeReviewCompletion.findOne({ ...scope, requestKey: payload.requestKey })
    .session(session).maxTimeMS(remaining(deadline)).lean()
  if (existing && existing.payloadHash !== payloadHash) fail('REVIEW_COMPLETION_REQUEST_CONFLICT', 'This request identity belongs to a different decision or basis.')
  const population = await compile(runtime, session, deadline)
  if (existing) return response(runtime, population, session, deadline, { replay: true, receipt: existing, canComplete: true })
  if (!editable(runtime)) fail('REVIEW_COMPLETION_LOCKED', 'This revision permits inspection only. Open an editable revision to complete review.')
  if (population.populationHash !== payload.expectedPopulationHash) fail('REVIEW_COMPLETION_STALE', 'The mandatory decision basis changed. Refresh and inspect the current population.')
  if (!population.summary.complete) fail('REVIEW_COMPLETION_PENDING', 'Mandatory review decisions or evidence refresh remain outstanding.')
  const time = new Date(Math.max(Date.now(), new Date(runtime.updatedAt).getTime() + 1))
  if (!Number.isFinite(time.getTime())) fail('REVIEW_CONTROL_INVALID', 'The review concurrency basis is unavailable.')
  const guarded = await RuntimeInstance.updateOne({ _id: scope.runtimeInstanceId, customerId: scope.customerId,
    tenantId: scope.tenantId, stateVersion: runtime.stateVersion, updatedAt: new Date(runtime.updatedAt) },
  { $set: { updatedAt: time, updatedBy: args.actorUserId } }, { session, timestamps: false, maxTimeMS: remaining(deadline) })
  if (guarded.modifiedCount !== 1) fail('REVIEW_COMPLETION_STALE', 'The revision changed during review completion. Refresh to retry.')
  const receiptId = randomUUID()
  const audit = await auditService.log({ actorUserId: args.actorUserId,
    action: auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED, resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
    resourceId: scope.runtimeInstanceId, scope: { ...scope, runtimeInstanceKey: runtime.runtimeInstanceKey },
    requestId: args.auditRequest?.requestId,
    diff: { action: 'REVIEW_COMPLETION', receiptId, populationPolicy: REVIEW_POPULATION_POLICY,
      populationHash: population.populationHash, stateVersion: runtime.stateVersion, rationale: payload.rationale.trim() },
  }, { session, throwOnError: true })
  remaining(deadline)
  if (!audit?._id || !audit.signature || !audit.signatureVersion) fail('REVIEW_COMPLETION_AUDIT_FAILED', 'Review Completion audit could not be verified.', 503)
  const [receipt] = await RuntimeReviewCompletion.create([{ ...scope,
    runtimeInstanceKey: runtime.runtimeInstanceKey, rootRuntimeInstanceKey: runtime.revision?.rootRuntimeInstanceKey || runtime.runtimeInstanceKey,
    receiptId, requestKey: payload.requestKey, payloadHash, contractVersion: REVIEW_COMPLETION_VERSION,
    populationPolicy: REVIEW_POPULATION_POLICY, populationHash: population.populationHash,
    observedStateVersion: runtime.stateVersion, manifest: population.manifest,
    actorUserId: args.actorUserId, authority: 'VMF_UPDATE', rationale: payload.rationale.trim(), completedAt: time,
    auditId: audit._id, auditSignatureVersion: audit.signatureVersion,
  }], { session })
  remaining(deadline)
  return response({ ...runtime, updatedAt: time }, population, session, deadline, { receipt, canComplete: true })
})
