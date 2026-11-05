import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Execution from '../models/GovernedReasoningExecution.js'
import Audit from '../models/AuditLog.js'
import auditService from './auditService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { prepareRenditionReviewAdmission } from './outcomeRenditionReviewAdmissionService.js'
import { RENDITION_CLAIM_VERSION, RENDITION_CLAIM_STATUS, RENDITION_REVIEW_OUTPUT, RENDITION_CLAIM_ACTION,
  RENDITION_TRANSPORT, renditionClaimError, renditionClaimKey, assertRenditionReviewSubject,
  assertRenditionClaimRecord, assertRenditionClaimAudit, renditionClaimAuditDiff } from './outcomeRenditionReviewClaimContract.js'

const raw = value => value?.toObject ? value.toObject() : value
const fail = (reason, status) => { throw renditionClaimError(reason, status) }
const keys = { runtimeInstanceId: 1, idempotencyKey: 1 }
const partial = { idempotencyKey: { $exists: true, $gt: '' } }
const indexName = 'runtimeInstanceId_1_idempotencyKey_1'
export const assertRenditionClaimIndex = async model => {
  let indexes
  try { indexes = await model.collection.indexes() } catch { fail('CLAIM_INDEX_NOT_READY', 503) }
  const index = indexes.find(item => item.name === indexName)
  if (!index?.unique || index.sparse || index.collation || membershipHash(Object.entries(index.key)) !== membershipHash(Object.entries(keys))
    || !index.partialFilterExpression || membershipHash(index.partialFilterExpression) !== membershipHash(partial)) fail('CLAIM_INDEX_NOT_READY', 503)
}
const select = (ctx, session) => {
  let query = ctx.model.findOne({ ...ctx.subject.scope, idempotencyKey: renditionClaimKey(ctx.subject.source.plan.planId) })
  if (session) query = query.session(session)
  return query.lean()
}
const verify = async (record, ctx, session) => {
  if (!record) fail('CLAIM_NOT_FOUND', 404)
  const body = assertRenditionClaimRecord(record)
  if (record.requestFingerprint !== membershipHash(ctx.subject) || membershipHash(body.runtime) !== membershipHash(ctx.runtime)) fail('CLAIM_SUBJECT_CONFLICT')
  let query = ctx.auditModel.findOne({ _id: record.executionEvidence.renditionReview.auditId })
  if (session) query = query.session(session)
  const audit = await query.lean()
  assertRenditionClaimAudit(record, audit, row => ctx.auditModel.hydrate(row).verifySignature())
  return body
}
const context = async args => {
  const deps = args.deps || {}, admission = await (deps.prepareAdmission || prepareRenditionReviewAdmission)(args)
  const subject = assertRenditionReviewSubject(admission?.subject)
  if (subject.actorUserId !== String(args.actorUserId) || subject.scope.runtimeInstanceId !== args.runtimeInstanceId
    || subject.candidate.candidateId !== args.candidateId) fail('CLAIM_ADMISSION_SCOPE_INVALID')
  const ctx = { deps, subject, runtime: admission.runtime, model: deps.Execution || Execution, auditModel: deps.Audit || Audit }
  await assertRenditionClaimIndex(ctx.model)
  return ctx
}
const result = (record, idempotent) => ({ claim: record.executionEvidence.renditionReview.body,
  claimFingerprint: record.executionEvidence.renditionReview.claimFingerprint, idempotent, dispatchAvailable: false })

export const readGovernedRenditionReviewClaim = async args => {
  const ctx = await context(args), record = await select(ctx)
  if (!record) return { claim: null, dispatchAvailable: false }
  await verify(record, ctx)
  return result(record, true)
}

// Admission only. The saved claim never constitutes provider dispatch authority.
export const claimGovernedRenditionReview = async args => {
  const ctx = await context(args), existing = await select(ctx)
  if (existing) { await verify(existing, ctx); return result(existing, true) }
  const current = await (ctx.deps.prepareAdmission || prepareRenditionReviewAdmission)(args)
  if (membershipHash(current.subject) !== membershipHash(ctx.subject) || membershipHash(current.runtime) !== membershipHash(ctx.runtime)) fail('CLAIM_ADMISSION_CHANGED')
  const executionId = `grr_rendition_claim_${randomUUID()}`, admittedAt = new Date().toISOString()
  const body = { contractVersion: RENDITION_CLAIM_VERSION, executionId, subject: ctx.subject, runtime: ctx.runtime, admittedAt, state: 'NOT_DISPATCHED', dispatchAvailable: false }
  const pending = { _id: new mongoose.Types.ObjectId(), executionId, ...ctx.subject.scope, ...ctx.runtime, workspaceType: 'PLATFORM',
    outputTypeKey: RENDITION_REVIEW_OUTPUT, requestedOutputTypeKey: 'docx-rendition-review',
    executionIntent: 'Admit one private DOCX rendition for a separate visual review.',
    idempotencyKey: renditionClaimKey(ctx.subject.source.plan.planId), requestFingerprint: membershipHash(ctx.subject),
    status: RENDITION_CLAIM_STATUS, contractVersion: RENDITION_CLAIM_VERSION, providerMode: 'LIVE_TEST',
    provider: { ...RENDITION_TRANSPORT, state: 'NOT_DISPATCHED' }, knowledgeManifest: {}, knowledgeBinding: {},
    reasoningContext: { contentVisible: false, packContentLoaded: false, dispatchAvailable: false }, certifiedTruth: {}, runtimeStateWrites: {},
    artifactIds: [], auditLogIds: [], warnings: [], limitations: [], requestedBy: ctx.subject.actorUserId,
    requestedAt: new Date(admittedAt), completedAt: null, failureReason: null,
    executionEvidence: { renditionReview: { body, claimFingerprint: membershipHash(body), auditId: new mongoose.Types.ObjectId(), auditSignatureVersion: 1 } } }
  const session = await ctx.model.db.startSession()
  let saved, replay = false
  try {
    await session.withTransaction(async () => {
      const winner = await select(ctx, session)
      if (winner) { await verify(winner, ctx, session); saved = winner; replay = true; return }
      const written = await (ctx.deps.auditService || auditService).log({ actorUserId: args.actorUserId, action: RENDITION_CLAIM_ACTION,
        resourceType: 'GovernedReasoningExecution', resourceId: pending._id, scope: ctx.subject.scope,
        requestId: args.auditRequest?.requestId, diff: renditionClaimAuditDiff(pending) }, { session, throwOnError: true })
      const audit = raw(written), claim = pending.executionEvidence.renditionReview
      claim.auditId = audit?._id; claim.auditSignatureVersion = audit?.signatureVersion
      pending.auditLogIds = [String(audit?._id)]
      assertRenditionClaimRecord(pending)
      assertRenditionClaimAudit(pending, audit, row => ctx.auditModel.hydrate(row).verifySignature())
      const [created] = await ctx.model.create([pending], { session }); saved = raw(created)
    })
  } catch (error) {
    if (error?.code !== 11000 || !error.message?.includes(indexName)
      || membershipHash(Object.entries(error.keyPattern || {})) !== membershipHash(Object.entries(keys))) throw error
    const winner = await select(ctx)
    if (!winner) throw error
    await verify(winner, ctx); saved = winner; replay = true
  } finally { await session.endSession() }
  const durable = await select(ctx)
  if (durable?.executionId !== saved?.executionId) fail('CLAIM_DURABLE_READ_CHANGED')
  await verify(durable, ctx)
  return result(durable, replay)
}
