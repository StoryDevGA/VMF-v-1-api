import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Execution from '../models/GovernedReasoningExecution.js'
import Audit from '../models/AuditLog.js'
import auditService from './auditService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { prepareDocxVisualReviewTransport } from './outcomeDocxVisualReviewContextService.js'
import { buildOpenAiDocxRenditionReviewRequest } from './openAiDocxRenditionReviewProviderAdapter.js'
import { readGovernedRenditionReviewClaim, assertRenditionClaimIndex } from './governedRenditionReviewClaimService.js'
import { RENDITION_DISPATCH_VERSION, RENDITION_DISPATCH_STATUS, RENDITION_REVIEW_OUTPUT, RENDITION_TRANSPORT,
  renditionClaimKey, assertRenditionClaimRecord, assertRenditionClaimAudit } from './outcomeRenditionReviewClaimContract.js'
import { RENDITION_DISPATCH_ACTION, RENDITION_RESPONSE_ACTION, RENDITION_UNCERTAINTY_ACTION,
  renditionDispatchError, renditionDispatchKey, assertRenditionDispatchBinding, assertRenditionDispatchRecord,
  renditionDispatchAuditDiff, assertRenditionDispatchAudit, renditionReceiptId, assertRenditionProviderIdentity,
  assertRenditionUncertainty } from './outcomeRenditionReviewDispatchContract.js'

const raw = value => value?.toObject ? value.toObject() : value
const same = (a, b) => membershipHash(a) === membershipHash(b)
const fail = (reason, status) => { throw renditionDispatchError(reason, status) }
const bindingKeys = ['requestIdentity', 'subjectFingerprint', 'contextFingerprint']
const context = async args => {
  const deps = args.deps || {}, transport = await (deps.prepareTransport || prepareDocxVisualReviewTransport)(args)
  const prepared = buildOpenAiDocxRenditionReviewRequest(transport)
  if (args.binding && !same(assertRenditionDispatchBinding(args.binding), prepared.binding)) fail('DISPATCH_REQUEST_CHANGED')
  const admitted = await (deps.readClaim || readGovernedRenditionReviewClaim)(args)
  if (!admitted?.claim || admitted.claim.subject.actorUserId !== String(args.actorUserId)
    || admitted.claim.subject.scope.runtimeInstanceId !== args.runtimeInstanceId
    || admitted.claim.subject.candidate.candidateId !== args.candidateId
    || membershipHash(admitted.claim.subject) !== prepared.binding.subjectFingerprint) fail('DISPATCH_ADMISSION_CHANGED')
  const ctx = { deps, subject: transport.subject, binding: prepared.binding, claim: admitted.claim, claimFingerprint: admitted.claimFingerprint,
    model: deps.Execution || Execution, auditModel: deps.Audit || Audit }
  if (ctx.model.db !== ctx.auditModel.db) fail('DISPATCH_DATABASE_OWNER_CHANGED')
  await assertRenditionClaimIndex(ctx.model)
  const indexes = await ctx.auditModel.collection.indexes()
  const identityIndex = indexes.find(index => index.name === '_id_')
  if (!identityIndex || !same(Object.entries(identityIndex.key), [['_id', 1]]) || identityIndex.sparse
    || identityIndex.partialFilterExpression || identityIndex.collation) fail('RECEIPT_ID_INDEX_NOT_READY', 503)
  return ctx
}
const selectReservation = (ctx, session) => {
  let query = ctx.model.findOne({ ...ctx.subject.scope, idempotencyKey: renditionDispatchKey(ctx.subject.source.plan.planId) })
  if (session) query = query.session(session)
  return query.lean()
}
const verifyReservation = async (record, ctx, session) => {
  if (!record) fail('DISPATCH_RESERVATION_NOT_FOUND', 404)
  const body = assertRenditionDispatchRecord(record)
  if (body.claimExecutionId !== ctx.claim.executionId || body.claimFingerprint !== ctx.claimFingerprint
    || body.planId !== ctx.subject.source.plan.planId || !same(body.scope, ctx.subject.scope)
    || body.actorUserId !== ctx.subject.actorUserId || !same(body.runtime, ctx.claim.runtime)
    || bindingKeys.some(key => body[key] !== ctx.binding[key])) fail('DISPATCH_RESERVATION_CONFLICT')
  let query = ctx.auditModel.findOne({ _id: record.executionEvidence.renditionReview.auditId })
  if (session) query = query.session(session)
  const audit = await query.lean()
  assertRenditionDispatchAudit(record, audit, row => ctx.auditModel.hydrate(row).verifySignature())
  return body
}
const reservationMetadata = record => ({ reservation: record.executionEvidence.renditionReview.body,
  reservationFingerprint: record.executionEvidence.renditionReview.reservationFingerprint, dispatchAvailable: false })

// Only a fresh verified transaction winner receives the ephemeral function.
// It is never stored, serializable, returned by replay or recreated on restart.
export const reserveGovernedRenditionReviewDispatch = async args => {
  assertRenditionDispatchBinding(args.binding)
  const ctx = await context(args), existing = await selectReservation(ctx)
  if (existing) { await verifyReservation(existing, ctx); return reservationMetadata(existing) }
  const executionId = `grr_rendition_dispatch_${randomUUID()}`, createdAt = new Date().toISOString()
  const body = { contractVersion: RENDITION_DISPATCH_VERSION, executionId, claimExecutionId: ctx.claim.executionId,
    claimFingerprint: ctx.claimFingerprint, scope: ctx.subject.scope, actorUserId: ctx.subject.actorUserId,
    planId: ctx.subject.source.plan.planId, runtime: ctx.claim.runtime, ...ctx.binding, createdAt,
    state: 'RESERVED_NOT_CONFIRMED_SUBMITTED', dispatchAvailable: false }
  const pending = { _id: new mongoose.Types.ObjectId(), executionId, ...body.scope, ...body.runtime, workspaceType: 'PLATFORM',
    outputTypeKey: RENDITION_REVIEW_OUTPUT, requestedOutputTypeKey: 'docx-rendition-review-dispatch',
    executionIntent: 'Reserve one exact private DOCX visual review submission.', idempotencyKey: renditionDispatchKey(body.planId),
    requestFingerprint: body.requestIdentity, status: RENDITION_DISPATCH_STATUS, contractVersion: RENDITION_DISPATCH_VERSION,
    providerMode: 'LIVE_TEST', provider: { ...RENDITION_TRANSPORT, state: body.state }, knowledgeManifest: {}, knowledgeBinding: {},
    reasoningContext: { contentVisible: false, packContentLoaded: false, dispatchAvailable: false }, certifiedTruth: {}, runtimeStateWrites: {},
    artifactIds: [], auditLogIds: [], warnings: [], limitations: [], requestedBy: body.actorUserId, requestedAt: new Date(createdAt),
    completedAt: null, failureReason: null, executionEvidence: { renditionReview: { body, reservationFingerprint: membershipHash(body),
      auditId: new mongoose.Types.ObjectId(), auditSignatureVersion: 1 } } }
  const session = await ctx.model.db.startSession()
  let fresh = false, saved
  try {
    await session.withTransaction(async () => {
      fresh = false
      const winner = await selectReservation(ctx, session)
      if (winner) { await verifyReservation(winner, ctx, session); saved = winner; return }
      const document = await (ctx.deps.auditService || auditService).log({ actorUserId: args.actorUserId, action: RENDITION_DISPATCH_ACTION,
        resourceType: 'GovernedReasoningExecution', resourceId: pending._id, scope: body.scope,
        requestId: args.auditRequest?.requestId, diff: renditionDispatchAuditDiff(pending) }, { session, throwOnError: true })
      const audit = raw(document), reservation = pending.executionEvidence.renditionReview
      reservation.auditId = audit?._id; reservation.auditSignatureVersion = audit?.signatureVersion; pending.auditLogIds = [String(audit?._id)]
      assertRenditionDispatchRecord(pending)
      assertRenditionDispatchAudit(pending, audit, row => ctx.auditModel.hydrate(row).verifySignature())
      const [created] = await ctx.model.create([pending], { session }); saved = raw(created); fresh = true
    })
  } catch (error) {
    if (error?.code !== 11000 || !error.message?.includes('runtimeInstanceId_1_idempotencyKey_1')
      || !same(Object.entries(error.keyPattern || {}), [['runtimeInstanceId', 1], ['idempotencyKey', 1]])) throw error
    const winner = await selectReservation(ctx)
    if (!winner) throw error
    await verifyReservation(winner, ctx); saved = winner; fresh = false
  } finally { await session.endSession() }
  const durable = await selectReservation(ctx)
  if (durable?.executionId !== saved?.executionId) fail('DISPATCH_DURABLE_READ_CHANGED')
  await verifyReservation(durable, ctx)
  const result = reservationMetadata(durable)
  if (fresh) {
    // Snapshot the verified joins: returned metadata and caller args are mutable.
    const owned = { ...ctx, ...JSON.parse(JSON.stringify({ subject: ctx.subject, binding: ctx.binding,
      claim: ctx.claim, claimFingerprint: ctx.claimFingerprint })), deps: { ...ctx.deps } }
    const executionId = durable.executionId, fingerprint = durable.executionEvidence.renditionReview.reservationFingerprint
    const requestId = args.auditRequest?.requestId
    let consumed = false, acknowledged = false, responseConsumed = false
    result.consumeAcknowledgement = binding => {
      if (consumed) fail('DISPATCH_CAPABILITY_CONSUMED')
      consumed = true
      if (!same(assertRenditionDispatchBinding(binding), owned.binding)) fail('DISPATCH_CAPABILITY_BINDING_CHANGED')
      acknowledged = true
      return Object.freeze({ state: 'DURABLE_DISPATCH_RESERVED', ...owned.binding, reservationExecutionId: executionId,
        reservationFingerprint: fingerprint })
    }
    result.recordResponseIdentity = async identity => {
      if (responseConsumed) fail('RESPONSE_CAPABILITY_CONSUMED')
      responseConsumed = true
      if (!acknowledged) fail('RESPONSE_DISPATCH_UNACKNOWLEDGED')
      if (!identity || Object.keys(identity).length !== 5
        || ![...bindingKeys, 'responseId', 'postRequestId'].every(key => Object.hasOwn(identity, key))) fail('RESPONSE_CAPABILITY_BINDING_CHANGED')
      const binding = assertRenditionDispatchBinding(Object.fromEntries(bindingKeys.map(key => [key, identity[key]])))
      if (!same(binding, owned.binding)) fail('RESPONSE_CAPABILITY_BINDING_CHANGED')
      const payload = assertRenditionProviderIdentity({ responseId: identity.responseId, postRequestId: identity.postRequestId })
      return saveOwnedResponse(owned, executionId, fingerprint, requestId, payload)
    }
  }
  return result
}

const receiptAction = kind => kind === 'RESPONSE' ? RENDITION_RESPONSE_ACTION : RENDITION_UNCERTAINTY_ACTION
const receiptDiff = (ctx, record, kind, payload) => ({ contractVersion: `outcome-rendition-${kind.toLowerCase()}-receipt.v1`,
  kind, reservationExecutionId: record.executionId, reservationFingerprint: record.executionEvidence.renditionReview.reservationFingerprint,
  claimExecutionId: ctx.claim.executionId, claimFingerprint: ctx.claimFingerprint, ...ctx.binding, ...payload, dispatchAvailable: false })
const verifyReceipt = (audit, ctx, record, kind, payload) => {
  const expectedId = renditionReceiptId(kind, record.executionId)
  if (!audit || String(audit._id) !== expectedId || audit.action !== receiptAction(kind) || audit.resourceType !== 'GovernedReasoningExecution'
    || String(audit.resourceId) !== String(record._id) || String(audit.actorUserId) !== ctx.subject.actorUserId
    || Object.keys(ctx.subject.scope).some(key => String(audit.scope?.[key]) !== ctx.subject.scope[key])
    || !same(audit.diff, receiptDiff(ctx, record, kind, payload)) || ctx.auditModel.hydrate(audit).verifySignature() !== true) fail('DISPATCH_RECEIPT_INVALID')
  return audit.diff
}
const findReceipt = async (ctx, record, kind, session) => {
  let query = ctx.auditModel.findOne({ _id: renditionReceiptId(kind, record.executionId) })
  if (session) query = query.session(session)
  return query.lean()
}
const receiptPayload = (row, kind) => kind === 'RESPONSE'
  ? assertRenditionProviderIdentity({ responseId: row.diff?.responseId, postRequestId: row.diff?.postRequestId })
  : assertRenditionUncertainty(Object.fromEntries(['reason', 'outcome', 'responseId', 'postRequestId'].map(key => [key, row.diff?.[key]])))

// Recording a known response is not a new admission or result acceptance. Only
// the fresh reservation closure can enter here; public recovery still rebuilds
// its normal context. All transaction operations use the driver's bounded session.
const saveOwnedResponse = async (ctx, executionId, fingerprint, requestId, payload) => {
  const deadline = Date.now() + 60000
  const remaining = () => {
    const ms = deadline - Date.now()
    if (ms <= 0) fail('RESPONSE_RECEIPT_TIMEOUT', 503)
    return ms
  }
  const session = await ctx.model.db.startSession()
  let record
  try {
    await session.withTransaction(async () => {
      remaining()
      const claimRecord = await ctx.model.findOne({ ...ctx.subject.scope,
        idempotencyKey: renditionClaimKey(ctx.subject.source.plan.planId) }).session(session).lean()
      const claim = assertRenditionClaimRecord(claimRecord)
      if (!same(claim, ctx.claim) || claimRecord.executionEvidence.renditionReview.claimFingerprint !== ctx.claimFingerprint) fail('RESPONSE_CLAIM_CHANGED')
      const claimAudit = await ctx.auditModel.findOne({ _id: claimRecord.executionEvidence.renditionReview.auditId }).session(session).lean()
      assertRenditionClaimAudit(claimRecord, claimAudit, row => ctx.auditModel.hydrate(row).verifySignature())
      record = await selectReservation(ctx, session)
      await verifyReservation(record, ctx, session)
      if (record.executionId !== executionId || record.executionEvidence.renditionReview.reservationFingerprint !== fingerprint) fail('RECEIPT_RESERVATION_CHANGED')
      const uncertainty = await findReceipt(ctx, record, 'UNCERTAINTY', session)
      if (uncertainty) {
        const known = receiptPayload(uncertainty, 'UNCERTAINTY')
        verifyReceipt(uncertainty, ctx, record, 'UNCERTAINTY', known)
        if (known.responseId && known.responseId !== payload.responseId) fail('PROVIDER_RESPONSE_ID_CONFLICT')
      }
      const winner = await findReceipt(ctx, record, 'RESPONSE', session)
      if (winner) { verifyReceipt(winner, ctx, record, 'RESPONSE', payload); return }
      const document = await (ctx.deps.auditService || auditService).log({
        _id: new mongoose.Types.ObjectId(renditionReceiptId('RESPONSE', executionId)), actorUserId: ctx.subject.actorUserId,
        action: RENDITION_RESPONSE_ACTION, resourceType: 'GovernedReasoningExecution', resourceId: record._id,
        scope: ctx.subject.scope, requestId, diff: receiptDiff(ctx, record, 'RESPONSE', payload),
      }, { session, throwOnError: true })
      verifyReceipt(raw(document), ctx, record, 'RESPONSE', payload)
      remaining()
    }, { timeoutMS: Math.min(50000, remaining()) })
  } catch (error) {
    // Only a deterministic response-slot race may reconcile; ambiguous commit
    // and other failures stay held. Neither outcome can recreate a POST capability.
    if (error?.code !== 11000 || !error.message?.includes('_id_')
      || !same(Object.entries(error.keyPattern || {}), [['_id', 1]]) || !record) throw error
  } finally { await session.endSession() }
  const durable = await ctx.auditModel.findOne({ _id: renditionReceiptId('RESPONSE', executionId) })
    .setOptions({ timeoutMS: remaining() }).lean()
  verifyReceipt(durable, ctx, record, 'RESPONSE', payload)
  remaining()
  return { state: 'DURABLE_RESPONSE_ID_RECORDED', ...ctx.binding, responseId: payload.responseId }
}

const saveReceipt = async (args, kind, payload) => {
  const ctx = await context(args), record = await selectReservation(ctx)
  await verifyReservation(record, ctx)
  if (args.reservationExecutionId !== record.executionId) fail('RECEIPT_RESERVATION_CHANGED')
  const otherKind = kind === 'RESPONSE' ? 'UNCERTAINTY' : 'RESPONSE', other = await findReceipt(ctx, record, otherKind)
  if (other) {
    const known = receiptPayload(other, otherKind); verifyReceipt(other, ctx, record, otherKind, known)
    if (known.responseId && payload.responseId && known.responseId !== payload.responseId) fail('PROVIDER_RESPONSE_ID_CONFLICT')
  }
  const session = await ctx.model.db.startSession()
  let saved
  try {
    await session.withTransaction(async () => {
      // A known response in an uncertainty receipt also occupies the same unique
      // response-identity slot. Distinct receipt IDs alone would allow write skew.
      if (kind === 'UNCERTAINTY' && payload.responseId) {
        const identity = { responseId: payload.responseId, postRequestId: payload.postRequestId }
        const existingIdentity = await findReceipt(ctx, record, 'RESPONSE', session)
        if (existingIdentity) verifyReceipt(existingIdentity, ctx, record, 'RESPONSE', identity)
        else {
          const identityDocument = await (ctx.deps.auditService || auditService).log({
            _id: new mongoose.Types.ObjectId(renditionReceiptId('RESPONSE', record.executionId)), actorUserId: args.actorUserId,
            action: RENDITION_RESPONSE_ACTION, resourceType: 'GovernedReasoningExecution', resourceId: record._id,
            scope: ctx.subject.scope, requestId: args.auditRequest?.requestId, diff: receiptDiff(ctx, record, 'RESPONSE', identity),
          }, { session, throwOnError: true })
          verifyReceipt(raw(identityDocument), ctx, record, 'RESPONSE', identity)
        }
      }
      const winner = await findReceipt(ctx, record, kind, session)
      if (winner) { verifyReceipt(winner, ctx, record, kind, payload); saved = winner; return }
      const document = await (ctx.deps.auditService || auditService).log({ _id: new mongoose.Types.ObjectId(renditionReceiptId(kind, record.executionId)),
        actorUserId: args.actorUserId, action: receiptAction(kind), resourceType: 'GovernedReasoningExecution', resourceId: record._id,
        scope: ctx.subject.scope, requestId: args.auditRequest?.requestId, diff: receiptDiff(ctx, record, kind, payload) }, { session, throwOnError: true })
      saved = raw(document); verifyReceipt(saved, ctx, record, kind, payload)
    })
  } catch (error) {
    if (error?.code !== 11000 || !error.message?.includes('_id_') || !same(Object.entries(error.keyPattern || {}), [['_id', 1]])) throw error
    const winner = await findReceipt(ctx, record, kind)
    if (!winner) throw error
    verifyReceipt(winner, ctx, record, kind, payload); saved = winner
  } finally { await session.endSession() }
  const durable = await findReceipt(ctx, record, kind)
  verifyReceipt(durable, ctx, record, kind, payload)
  if (String(durable._id) !== String(saved._id)) fail('RECEIPT_DURABLE_READ_CHANGED')
  return durable.diff
}

export const recordRenditionReviewResponseIdentity = async args => {
  assertRenditionDispatchBinding(args.binding)
  const payload = assertRenditionProviderIdentity({ responseId: args.responseId, postRequestId: args.postRequestId })
  const receipt = await saveReceipt(args, 'RESPONSE', payload)
  return { state: 'DURABLE_RESPONSE_ID_RECORDED', ...Object.fromEntries(bindingKeys.map(key => [key, receipt[key]])), responseId: receipt.responseId }
}
export const recordRenditionReviewUncertainty = async args => {
  assertRenditionDispatchBinding(args.binding)
  const uncertainty = assertRenditionUncertainty(args.uncertainty)
  return { receipt: await saveReceipt(args, 'UNCERTAINTY', uncertainty), dispatchAvailable: false }
}
export const readGovernedRenditionReviewDispatch = async args => {
  const ctx = await context(args), record = await selectReservation(ctx)
  if (!record) return { state: 'ADMITTED_NOT_RESERVED', dispatchAvailable: false }
  await verifyReservation(record, ctx)
  const receipts = {}
  for (const kind of ['RESPONSE', 'UNCERTAINTY']) {
    const row = await findReceipt(ctx, record, kind)
    if (row) { const payload = receiptPayload(row, kind); receipts[kind] = verifyReceipt(row, ctx, record, kind, payload) }
  }
  if (receipts.RESPONSE?.responseId && receipts.UNCERTAINTY?.responseId && receipts.RESPONSE.responseId !== receipts.UNCERTAINTY.responseId) fail('PROVIDER_RESPONSE_ID_CONFLICT')
  return { ...reservationMetadata(record), state: receipts.UNCERTAINTY ? 'RECORDED_UNCERTAINTY'
    : receipts.RESPONSE ? 'RESPONSE_KNOWN_AWAITING_RESULT' : 'RESERVED_OUTCOME_UNKNOWN', receipts }
}
