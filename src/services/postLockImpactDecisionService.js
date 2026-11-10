import mongoose from 'mongoose'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import AuditLog from '../models/AuditLog.js'
import auditService from './auditService.js'
import { assertRuntimePermission } from './runtimeInstanceService.js'
import { assertNoControlledReplayIsolation } from './controlledReplayIsolationService.js'
import { readVerifiedPostLockEvidenceContext, withPostLockEvidenceTransaction } from './postLockEvidenceIntakeService.js'
import { assertPostLockRecordingBinding } from './postLockEvidenceIntakeContract.js'
import { generateChecksum } from './governanceAudit/checksumService.js'
import { POST_LOCK_IMPACT_VERSION, POST_LOCK_IMPACT_HISTORY_VERSION, POST_LOCK_IMPACT_HISTORY_MAX_BYTES,
  POST_LOCK_IMPACT_HISTORY_MAX_COUNT, parsePostLockImpactRequest, postLockImpactError,
  postLockImpactPayloadHash, postLockImpactDecisionId, postLockImpactDecisionHash, postLockImpactMaterial,
  assertPostLockImpactHistory, postLockImpactHistoryBytes, publicPostLockImpactEntry } from './postLockImpactDecisionContract.js'

const options = (session, readBudget) => ({ session, maxTimeMS: 2000, ...(readBudget ? readBudget() : {}) })
const equal = (left, right) => generateChecksum(left) === generateChecksum(right)
const requireValue = (condition, reason = 'POST_LOCK_IMPACT_HISTORY_INVALID', status = 503) => {
  if (!condition) throw postLockImpactError(reason, status)
}
const read = async (work, { readBudget } = {}) => {
  try { return await work() }
  catch (error) {
    // The exact-item read owner classifies raw timeouts only after the shared
    // transaction has retained its normal retry opportunity.
    if (readBudget) throw error
    if (error.status && error.code) throw error
    if (error.hasErrorLabel?.('TransientTransactionError')) { error.postLockImpactReadFailure = true; throw error }
    throw postLockImpactError('POST_LOCK_IMPACT_READ_UNAVAILABLE')
  }
}
const scopeFor = runtime => ({ customerId: new mongoose.Types.ObjectId(runtime.customerId),
  tenantId: new mongoose.Types.ObjectId(runtime.tenantId), runtimeInstanceId: new mongoose.Types.ObjectId(runtime.id) })
const auditDiff = (entry, row) => ({ contractVersion: POST_LOCK_IMPACT_VERSION, submissionId: entry.submissionId,
  evidenceRowId: String(row._id), decisionHash: entry.decisionHash, decision: postLockImpactMaterial(entry) })
const assertArgs = args => requireValue(/^[a-f0-9]{64}$/.test(args.submissionId || ''), 'POST_LOCK_IMPACT_REQUEST_INVALID', 422)

const context = async (args, session, { readBudget } = {}) => {
  const original = await read(() => readVerifiedPostLockEvidenceContext(args, session,
    ...(readBudget ? [{ readBudget }] : [])), { readBudget })
  const { runtime, submission } = original
  const scope = scopeFor(runtime)
  const row = await read(() => RuntimeEvidenceObject.collection.findOne({ ...scope, current: false,
    stateVersion: submission.binding.basisStateVersion, evidenceObjectId: `post-lock:${submission.submissionId}` }, options(session, readBudget)), { readBudget })
  requireValue(row?.postLockAssociation?.requestDigest === submission.requestDigest
    && equal(row.postLockAssociation.binding, submission.binding))
  const present = Object.hasOwn(row, 'postLockImpactHistory')
  const history = present ? assertPostLockImpactHistory(row.postLockImpactHistory, row.postLockAssociation)
    : { entries: [], headHash: null }
  return { ...original, scope, row, history, present }
}
const verifyHistoryAudits = async (ctx, session, { readBudget } = {}) => {
  const { history, row, runtime, scope } = ctx
  if (!history.entries.length) return { verified: true, reason: null }
  // Query by receipt IDs first. Filtering out a wrong-scope existing receipt
  // would incorrectly present corruption as an absent/expired receipt.
  const audits = await read(() => AuditLog.collection.find({ _id: { $in: history.entries.map(entry => new mongoose.Types.ObjectId(entry.auditId)) } },
    options(session, readBudget)).limit(POST_LOCK_IMPACT_HISTORY_MAX_COUNT + 1).toArray(), { readBudget })
  if (readBudget) readBudget.accountAuditRows(audits)
  let missing = false
  for (const entry of history.entries) {
    if (readBudget) readBudget.check()
    const audit = audits.find(item => String(item._id) === entry.auditId)
    if (!audit) { missing = true; continue }
    requireValue(audit.action === 'POST_LOCK_IMPACT_DECISION_RECORDED' && audit.resourceType === 'RuntimeInstance'
      && String(audit.resourceId) === String(scope.runtimeInstanceId) && String(audit.actorUserId) === entry.reviewerUserId
      && audit.signatureVersion === entry.auditSignatureVersion
      && ['customerId', 'tenantId', 'runtimeInstanceId'].every(key => String(audit.scope?.[key]) === String(scope[key]))
      && audit.scope?.runtimeInstanceKey === runtime.runtimeInstanceKey && equal(audit.diff, auditDiff(entry, row))
      && AuditLog.hydrate(audit).verifySignature(), 'POST_LOCK_IMPACT_AUDIT_UNVERIFIED')
  }
  return missing ? { verified: false, reason: 'POST_LOCK_IMPACT_AUDIT_NOT_RECORDED' } : { verified: true, reason: null }
}
const requireUpdate = (args, ctx, session, { readBudget } = {}) => assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes,
  customerId: ctx.runtime.customerId, tenantId: ctx.runtime.tenantId, permission: 'VMF_UPDATE', session, maxTimeMS: 2000,
  ...(readBudget ? { ...readBudget(), readBudget } : {}) })
const reviewPolicy = async (ctx, session, { readBudget } = {}) => {
  const pack = await read(() => FrameworkPackage.findOne({ _id: ctx.runtime.packageId })
    .setOptions(options(session, readBudget)).lean(), { readBudget })
  const hash = assertPostLockRecordingBinding({ frameworkPackage: pack, runtime: ctx.runtime, operation: 'impact' })
  requireValue(hash === ctx.submission.binding.policyHash, 'POST_LOCK_IMPACT_POLICY_UNAVAILABLE', 409)
}
// Shared by the normal revision transaction. This does not create a nested
// transaction or decide whether a historical head is eligible for admission.
export const readVerifiedPostLockImpactContext = async (args, session) => {
  const ctx = await context(args, session)
  await requireUpdate(args, ctx, session)
  const verification = await verifyHistoryAudits(ctx, session)
  requireValue(verification.verified, verification.reason)
  return ctx
}
const available = async (args, ctx, verification, session, { readBudget } = {}) => {
  const blockedBy = []
  if (!verification.verified) blockedBy.push(verification.reason)
  try { assertNoControlledReplayIsolation(ctx.runtime) }
  catch (error) { if (error.details?.reason !== 'CONTROLLED_REPLAY_ISOLATED') throw error; blockedBy.push('CONTROLLED_REPLAY_ISOLATED') }
  try { await requireUpdate(args, ctx, session, { readBudget }) }
  catch (error) {
    if (error.status !== 403 || error.code !== 'FORBIDDEN' || error.details?.permission !== 'VMF_UPDATE') throw error
    blockedBy.push('VMF_UPDATE_REQUIRED')
  }
  try { await reviewPolicy(ctx, session, { readBudget }) }
  catch (error) {
    if (error.details?.reason !== 'POST_LOCK_IMPACT_POLICY_UNAVAILABLE') throw error
    blockedBy.push('POST_LOCK_IMPACT_POLICY_UNAVAILABLE')
  }
  if (ctx.history.entries.length >= POST_LOCK_IMPACT_HISTORY_MAX_COUNT
    || (ctx.present && postLockImpactHistoryBytes(ctx.history) >= POST_LOCK_IMPACT_HISTORY_MAX_BYTES)) blockedBy.push('POST_LOCK_IMPACT_CAPACITY')
  return { canRecord: blockedBy.length === 0, blockedBy: [...new Set(blockedBy)] }
}
// A passive viewer may inspect retained decisions without gaining the update
// authority required by the separate admission transaction helper above.
export const readPostLockImpactViewContext = async (args, session, { readBudget } = {}) => {
  assertArgs(args)
  const ctx = await context(args, session, { readBudget })
  let verification
  try { verification = await verifyHistoryAudits(ctx, session, { readBudget }) }
  catch (error) {
    if (error.status !== 503 || error.code !== 'SERVICE_UNAVAILABLE'
      || error.details?.reason !== 'POST_LOCK_IMPACT_AUDIT_UNVERIFIED') throw error
    verification = { verified: false, reason: 'POST_LOCK_IMPACT_AUDIT_UNVERIFIED' }
  }
  const capability = await available(args, ctx, verification, session, { readBudget })
  return { ...ctx, verification, capability }
}
const withImpactTransaction = async (work, decisionId) => {
  try { return await withPostLockEvidenceTransaction(work) }
  catch (error) {
    if (error.hasErrorLabel?.('UnknownTransactionCommitResult')) {
      if (!decisionId) throw postLockImpactError('POST_LOCK_IMPACT_READ_UNAVAILABLE')
      const uncertain = postLockImpactError('POST_LOCK_IMPACT_SUBMISSION_UNCONFIRMED')
      uncertain.details.decisionId = decisionId
      throw uncertain
    }
    if (error.postLockImpactReadFailure) throw postLockImpactError('POST_LOCK_IMPACT_READ_UNAVAILABLE')
    if (error.postLockImpactAuditFailure) throw postLockImpactError('POST_LOCK_IMPACT_AUDIT_WRITE_FAILED')
    throw error
  }
}

export const readPostLockImpactHistory = async args => {
  assertArgs(args)
  const afterSequence = args.afterSequence ?? 0, limit = args.limit ?? 20
  requireValue(Number.isInteger(afterSequence) && afterSequence >= 0 && afterSequence <= POST_LOCK_IMPACT_HISTORY_MAX_COUNT
    && Number.isInteger(limit) && limit >= 1 && limit <= 25, 'POST_LOCK_IMPACT_REQUEST_INVALID', 422)
  return withImpactTransaction(async session => {
    const ctx = await context(args, session), verification = await verifyHistoryAudits(ctx, session)
    const capability = await available(args, ctx, verification, session)
    const verified = verification.verified, head = verified ? ctx.history.headHash : null
    const page = ctx.history.entries.filter(entry => entry.sequence > afterSequence).slice(0, limit)
    return { contractVersion: POST_LOCK_IMPACT_HISTORY_VERSION, submissionId: args.submissionId, intakeStatus: 'PENDING_REVIEW',
      verification: { status: verified ? 'VERIFIED' : 'UNVERIFIED', reason: verification.reason },
      impact: { state: !verified ? 'UNVERIFIED' : ctx.history.entries.length ? 'RECORDED' : 'NOT_RECORDED', headHash: head,
        latestDecision: verified && ctx.history.entries.length ? publicPostLockImpactEntry(ctx.history.entries.at(-1), true, head) : null },
      entries: page.map(entry => publicPostLockImpactEntry(entry, verified, head)),
      pagination: { afterSequence, limit, nextAfterSequence: page.length && page.at(-1).sequence < ctx.history.entries.length ? page.at(-1).sequence : null,
        total: ctx.history.entries.length }, ...capability, admissionAvailable: false }
  })
}

export const recordPostLockImpactDecision = async args => {
  assertArgs(args)
  const request = parsePostLockImpactRequest(args.payload)
  requireValue(/^[a-f0-9]{24}$/.test(String(args.actorUserId || '')), 'POST_LOCK_IMPACT_REQUEST_INVALID', 422)
  const actor = String(args.actorUserId), payloadHash = postLockImpactPayloadHash(request, actor, args.submissionId)
  const decisionId = postLockImpactDecisionId(args.submissionId, request.requestKey)
  return withImpactTransaction(async session => {
    const ctx = await context(args, session)
    assertNoControlledReplayIsolation(ctx.runtime)
    await requireUpdate(args, ctx, session)
    await reviewPolicy(ctx, session)
    const verified = await verifyHistoryAudits(ctx, session)
    requireValue(verified.verified, verified.reason)
    const prior = ctx.history.entries.find(entry => entry.requestKey === request.requestKey)
    if (prior) {
      requireValue(prior.payloadHash === payloadHash && prior.reviewerUserId === actor, 'POST_LOCK_IMPACT_IDEMPOTENCY_CONFLICT', 409)
      return { contractVersion: POST_LOCK_IMPACT_VERSION, submissionId: args.submissionId, intakeStatus: 'PENDING_REVIEW',
        decision: publicPostLockImpactEntry(prior, true, ctx.history.headHash), verification: { status: 'VERIFIED', reason: null },
        observedHeadHash: ctx.history.headHash, replayed: true, admissionAvailable: false }
    }
    requireValue(request.expectedSubmissionDigest === ctx.submission.requestDigest && equal(request.expectedBinding, ctx.submission.binding)
      && request.expectedHeadHash === ctx.history.headHash, 'POST_LOCK_IMPACT_STALE', 409)
    requireValue(ctx.history.entries.length < POST_LOCK_IMPACT_HISTORY_MAX_COUNT, 'POST_LOCK_IMPACT_CAPACITY', 409)
    const material = { contractVersion: POST_LOCK_IMPACT_VERSION, decisionId, payloadHash, requestKey: request.requestKey,
      sequence: ctx.history.entries.length + 1, submissionId: args.submissionId, submissionRequestDigest: ctx.submission.requestDigest,
      binding: ctx.submission.binding, reviewerUserId: actor, authority: 'VMF_UPDATE', disposition: request.disposition,
      rationale: request.rationale, decidedAt: new Date().toISOString(), previousDecisionHash: ctx.history.headHash }
    // Provisional receipt metadata is in-memory only. The actual model-owned
    // receipt replaces it before complete validation and the atomic row update.
    let entry = { ...material, decisionHash: postLockImpactDecisionHash(material),
      auditId: String(new mongoose.Types.ObjectId()), auditSignatureVersion: new AuditLog().signatureVersion }
    const assemble = () => ({ contractVersion: POST_LOCK_IMPACT_HISTORY_VERSION, entries: [...ctx.history.entries, entry], headHash: entry.decisionHash })
    requireValue(postLockImpactHistoryBytes(assemble()) <= POST_LOCK_IMPACT_HISTORY_MAX_BYTES, 'POST_LOCK_IMPACT_CAPACITY', 409)
    assertPostLockImpactHistory(assemble(), ctx.row.postLockAssociation)
    let audit
    try {
      audit = await auditService.log({ actorUserId: actor, action: auditService.AUDIT_ACTIONS.POST_LOCK_IMPACT_DECISION_RECORDED,
        resourceType: 'RuntimeInstance', resourceId: ctx.scope.runtimeInstanceId,
        scope: { ...ctx.scope, runtimeInstanceKey: ctx.runtime.runtimeInstanceKey }, requestId: args.auditRequest?.requestId,
        diff: auditDiff(entry, ctx.row) }, { session, throwOnError: true })
    } catch (error) {
      if (error.hasErrorLabel?.('TransientTransactionError')) { error.postLockImpactAuditFailure = true; throw error }
      throw postLockImpactError('POST_LOCK_IMPACT_AUDIT_WRITE_FAILED')
    }
    requireValue(audit?._id && Number.isSafeInteger(audit.signatureVersion) && audit.signatureVersion > 0
      && audit.verifySignature?.() === true, 'POST_LOCK_IMPACT_AUDIT_WRITE_FAILED')
    entry = { ...entry, auditId: String(audit._id), auditSignatureVersion: audit.signatureVersion }
    const history = assemble()
    requireValue(postLockImpactHistoryBytes(history) <= POST_LOCK_IMPACT_HISTORY_MAX_BYTES, 'POST_LOCK_IMPACT_CAPACITY', 409)
    assertPostLockImpactHistory(history, ctx.row.postLockAssociation)
    const filter = { _id: ctx.row._id, ...ctx.scope, current: false, stateVersion: ctx.submission.binding.basisStateVersion,
      'postLockAssociation.requestDigest': ctx.submission.requestDigest,
      ...(ctx.present ? { 'postLockImpactHistory.headHash': ctx.history.headHash } : { postLockImpactHistory: { $exists: false } }) }
    const changed = await RuntimeEvidenceObject.collection.updateOne(filter, { $set: { postLockImpactHistory: history } }, { session })
    requireValue(changed.matchedCount === 1, 'POST_LOCK_IMPACT_STALE', 409)
    const saved = await context(args, session), receipt = await verifyHistoryAudits(saved, session)
    requireValue(receipt.verified, receipt.reason)
    return { contractVersion: POST_LOCK_IMPACT_VERSION, submissionId: args.submissionId, intakeStatus: 'PENDING_REVIEW',
      decision: publicPostLockImpactEntry(saved.history.entries.at(-1), true, saved.history.headHash),
      verification: { status: 'VERIFIED', reason: null }, observedHeadHash: saved.history.headHash,
      replayed: false, admissionAvailable: false }
  }, decisionId)
}
