import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Execution from '../models/GovernedReasoningExecution.js'
import Audit from '../models/AuditLog.js'
import User from '../models/User.js'
import auditService from './auditService.js'
import { buildUserPermissionsSnapshot } from './performanceCacheService.js'
import { assertRuntimePermission, getRuntimeInstance } from './runtimeInstanceService.js'
import { prepareMasterLinkedDocxReviewTransport, prepareApprovedMasterLinkedDocxReviewTransport, prepareNarrowMasterLinkedDocxReviewTransport } from './outcomeMasterLinkedDocxReviewTransportService.js'
import { buildOpenAiMasterLinkedDocxReviewRequest } from './openAiMasterLinkedDocxReviewRequest.js'
import * as reviewRequestBuilders from './openAiMasterLinkedDocxReviewRequest.js'
import { assertRenditionClaimIndex } from './governedRenditionReviewClaimService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { readMasterReviewNativeOperator } from './masterLinkedReviewOperatorAuthority.js'
import { simulationSame as same, simulationExact as exact } from './masterLinkedReviewSimulationContract.js'
import { APPROVED_DOCX_OPERATION_LIMITS } from './approvedDocxReadProfile.js'
import { G1_VERSION, G1_OUTPUT, G1_MODES, G1_STATUSES, G1_ACTIONS, G1_FIXED, G1_CORRECTED_GENUINE_RELEASE, g1ApprovalReference, g1SubjectRoot, assertG1CorrectedSubject, g1Need as need, g1Key, g1ReceiptId,
  G1_APPROVED_GENUINE_RELEASE, G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE, G1_NARROW_GENUINE_RELEASE, g1PostIdempotencyKey,
  assertG1ApprovedSubject, assertG1NarrowSubject, g1RequestProfile,
  assertG1FixedSubject, assertG1CategoryQaSubject, isG1CategoryQaRequest, assertG1Approval, assertG1QaRelease, assertG1Record, assertG1Audit, g1AuditDiff, g1Reference } from './masterLinkedGenuineReviewContract.js'

const capabilities = new WeakMap(), copy = value => JSON.parse(JSON.stringify(value))
const raw = value => value?.toObject ? value.toObject() : value
const body = record => record.executionEvidence.masterDocxDispatch.body
const read = (model, filter, session, timeoutMS = 3000) => {
  let query = model.findOne(filter)
  // withTransaction owns the timeout for all its operations. The installed
  // driver rejects a per-operation timeout when that transaction budget exists.
  if (session) query = query.session(session)
  else query = query.setOptions({ timeoutMS })
  return query.lean()
}
const refEqual = (a, b) => same(g1Reference(a), g1Reference(b))
const metadata = record => ({ ...copy(record.executionEvidence.masterDocxDispatch),
  dispatchAvailable: false, approvalAvailable: false, finalisationAvailable: false })
const remaining = deadline => { const ms = deadline - Date.now(); need(ms > 0, 'OWNER_DEADLINE'); return ms }

// Only branded capabilities issued to the fresh transaction winner can reach
// the start barrier. No callback supplied to an adapter can impersonate it.
export const consumeMasterLinkedReviewCapability = async (capability, mode, category = false, approved = false) => {
  const owned = capabilities.get(capability)
  need(typeof category === 'boolean' && [false, true, 'NARROW'].includes(approved) && owned && owned.mode === mode
    && owned.category === category && owned.approved === approved && !owned.consumed, 'CAPABILITY_UNAVAILABLE')
  owned.consumed = true
  return owned.begin()
}

const createOwner = (mode, dependencies, approvedProfile = false) => {
  const narrow = approvedProfile === 'NARROW'
  need(!narrow || mode === G1_MODES.GENUINE, 'NARROW_GENUINE_PROFILE_REQUIRED')
  const deps = { Execution, Audit, User, auditService,
    prepareTransport: narrow ? prepareNarrowMasterLinkedDocxReviewTransport : approvedProfile ? prepareApprovedMasterLinkedDocxReviewTransport : prepareMasterLinkedDocxReviewTransport,
    assertPermission: assertRuntimePermission, readRuntime: getRuntimeInstance, permissions: buildUserPermissionsSnapshot, ...dependencies }
  const signature = audit => deps.Audit.prototype.verifySignature.call(audit)
  const permission = async request => {
    let scopes = request.scopes
    if (mode === G1_MODES.GENUINE || request.qaReleaseAuditId !== undefined) {
      const user = await read(deps.User, { _id: request.actorUserId })
      need(user?.isActive === true, 'APP_ACTOR_INACTIVE')
      scopes = { ...copy(scopes || {}), ...await deps.permissions(user) }
    }
    await deps.assertPermission({ actorUserId: request.actorUserId, scopes, ...request.scope, permission: 'VMF_UPDATE', maxTimeMS: 3000 })
    return scopes
  }
  const verifyApproval = async (ctx, current = true) => {
    if (mode === G1_MODES.QA && ctx.approval === null) return
    const audit = await read(deps.Audit, { _id: ctx.approvalId })
    const release = mode === G1_MODES.QA ? assertG1QaRelease(audit, ctx.subject, ctx.expected, signature, Date.now(), ctx.qaCase, current)
      : assertG1Approval(audit, ctx.subject, ctx.expected, signature, Date.now(), current)
    need(same(ctx.approval, g1ApprovalReference(ctx.subject, mode, audit)), 'APPROVAL_CHANGED')
    const correction = ctx.subject.contractVersion === 'master-linked-docx-review-subject.v3' || approvedProfile
    if (mode === G1_MODES.QA || correction) need(ctx.grantCreatedAt === release.issuedAt && ctx.expiresAt === release.expiresAt,
      mode === G1_MODES.QA ? 'QA_RELEASE_TIME_CHANGED' : 'CORRECTED_GENUINE_RELEASE_TIME_CHANGED')
    if (current) {
      if (mode === G1_MODES.QA || correction || release.version === 'ss055-genuine-release-approval.v2') {
        const operator = await readMasterReviewNativeOperator(release.approvingOperatorUserId)
        need(same(operator, release.operatorAuthority), 'OPERATOR_CHANGED')
        return
      }
      const operator = await read(deps.User, { _id: release.approvingOperatorUserId })
      need(operator?.isActive === true, 'OPERATOR_INACTIVE')
      const permissions = await deps.permissions(operator)
      need(permissions.resolvedPermissions?.platform?.roleKeys?.includes('SUPER_ADMIN'), 'OPERATOR_NOT_AUTHORISED')
    }
  }
  const context = async original => {
    need(original && original.deps === undefined && original.executionMode === undefined, 'CALLER_OVERRIDE_FORBIDDEN')
    need(!approvedProfile || approvedProfile === g1RequestProfile(original.expected), 'REVIEW_PROFILE_MISMATCH')
    const args = copy(original), deadline = Date.now() + (approvedProfile
      ? APPROVED_DOCX_OPERATION_LIMITS.APPROVED_REVIEW_PREPARATION.deadlineMs : 900000)
    need(approvedProfile === g1RequestProfile(args.expected), 'REVIEW_PROFILE_MISMATCH')
    const category = Boolean(approvedProfile) || isG1CategoryQaRequest(args.expected)
    if (mode === G1_MODES.QA) need(args.approvalAuditId === undefined, 'QA_RELEASE_REFERENCE_REQUIRED')
    if (args.qaReleaseAuditId !== undefined) need(mode === G1_MODES.QA && typeof args.qaReleaseAuditId === 'string'
      && /^[a-f0-9]{24}$/.test(args.qaReleaseAuditId), 'QA_RELEASE_REFERENCE_REQUIRED')
    if (approvedProfile && mode === G1_MODES.QA) need(args.actorUserId === G1_FIXED.actorUserId
      && args.runtimeInstanceId === G1_FIXED.runtimeInstanceId && args.candidateId === G1_APPROVED_GENUINE_RELEASE.candidateId
      && typeof args.qaReleaseAuditId === 'string' && /^[a-f0-9]{24}$/.test(args.qaReleaseAuditId), 'APPROVED_QA_RELEASE_REQUIRED')
    if (mode === G1_MODES.GENUINE) need(args.actorUserId === G1_FIXED.actorUserId && args.runtimeInstanceId === G1_FIXED.runtimeInstanceId
      && (approvedProfile ? args.candidateId === (narrow ? G1_NARROW_GENUINE_RELEASE.candidateId : G1_APPROVED_GENUINE_RELEASE.candidateId)
        : [G1_FIXED.candidateId, G1_CORRECTED_GENUINE_RELEASE.candidateId].includes(args.candidateId))
      && typeof args.approvalAuditId === 'string' && /^[a-f0-9]{24}$/.test(args.approvalAuditId), 'GENUINE_RELEASE_REQUIRED')
    const transport = await deps.prepareTransport(args), prepared = narrow
      ? reviewRequestBuilders.buildOpenAiNarrowMasterLinkedCategoryDocxReviewRequest(transport) : approvedProfile
      ? reviewRequestBuilders.buildOpenAiApprovedMasterLinkedCategoryDocxReviewRequest(transport) : category
        ? reviewRequestBuilders.buildOpenAiMasterLinkedCategoryDocxReviewRequest(transport) : buildOpenAiMasterLinkedDocxReviewRequest(transport)
    const subject = copy(transport.subject), scope = copy(subject.binding.masterReference.scope)
    need(same(prepared.binding, args.expected) && subject.actorUserId === args.actorUserId && scope.runtimeInstanceId === args.runtimeInstanceId
      && subject.binding.candidateId === args.candidateId, 'REQUEST_CHANGED')
    const ctx = { mode, args, expected: copy(prepared.binding), subject, scope, prepared: copy(prepared), deadline,
      planId: transport.sourceEnvelope.source.plan.planId, qaCase: mode === G1_MODES.QA ? args.qaCase : '', approvalId: args.qaReleaseAuditId || args.approvalAuditId }
    const correction = subject.contractVersion === 'master-linked-docx-review-subject.v3' || approvedProfile
    if (correction) need(mode === G1_MODES.QA ? args.qaReleaseAuditId !== undefined : args.approvalAuditId !== undefined,
      mode === G1_MODES.QA ? 'CORRECTED_QA_RELEASE_REQUIRED' : 'CORRECTED_GENUINE_RELEASE_REQUIRED')
    const scopes = await permission({ ...args, scope })
    const runtime = await deps.readRuntime({ ...scope, scopes, projection: 'runtimeInstanceKey runtimeType frameworkKey packageKey packageVersion status', maxTimeMS: 3000, metadataMaxTimeMS: 3000 })
    need(runtime && String(runtime.id || runtime._id) === scope.runtimeInstanceId && runtime.status === 'LOCKED'
      && ['tenantId', 'customerId'].every(k => String(runtime[k]) === scope[k]), 'RUNTIME_CHANGED')
    ctx.runtime = Object.fromEntries(['runtimeInstanceKey', 'runtimeType', 'frameworkKey', 'packageKey', 'packageVersion'].map(k => [k, runtime[k] || '']))
    if (mode === G1_MODES.GENUINE || args.qaReleaseAuditId !== undefined) {
      if (narrow) assertG1NarrowSubject(subject, ctx.expected)
      else if (approvedProfile) assertG1ApprovedSubject(subject, ctx.expected)
      else if (category) assertG1CategoryQaSubject(subject, ctx.expected)
      else if (correction) assertG1CorrectedSubject(subject, ctx.expected)
      else assertG1FixedSubject(subject, ctx.expected)
      const approval = await read(deps.Audit, { _id: ctx.approvalId })
      const release = mode === G1_MODES.QA ? assertG1QaRelease(approval, subject, ctx.expected, signature, Date.now(), ctx.qaCase)
        : assertG1Approval(approval, subject, ctx.expected, signature, Date.now())
      ctx.approval = g1ApprovalReference(subject, mode, approval)
      ctx.grantCreatedAt = release.issuedAt; ctx.expiresAt = release.expiresAt
      await verifyApproval(ctx)
    } else {
      const issuedAt = Date.now()
      ctx.approval = null; ctx.grantCreatedAt = new Date(issuedAt).toISOString(); ctx.expiresAt = new Date(issuedAt + 1800000).toISOString()
    }
    // Select the separate attempt only after its exact signed release has
    // passed the source, operator and expiry checks. Old references omit version.
    ctx.root = g1SubjectRoot(subject, ctx.expected, mode, ctx.qaCase, ctx.approval?.version ?? null)
    if (mode === G1_MODES.GENUINE) {
      for (const phase of Object.keys(G1_STATUSES)) {
        const occupied = await read(deps.Execution, { tenantId: scope.tenantId, customerId: scope.customerId,
          idempotencyKey: g1Key(ctx.root, phase), runtimeInstanceId: { $ne: G1_FIXED.runtimeInstanceId } })
        need(!occupied, 'ONCE_ROOT_RUNTIME_CONFLICT')
      }
    }
    need(deps.Execution.db === deps.Audit.db, 'DATABASE_OWNER')
    await assertRenditionClaimIndex(deps.Execution)
    const index = (await deps.Audit.collection.indexes()).find(i => i.name === '_id_')
    need(index && same(Object.entries(index.key), [['_id', 1]]) && !index.sparse && !index.partialFilterExpression && !index.collation, 'RECEIPT_INDEX')
    remaining(deadline)
    return ctx
  }
  const find = (ctx, phase, session) => read(deps.Execution, { ...ctx.scope, idempotencyKey: g1Key(ctx.root, phase) }, session)
  const verify = async (ctx, record, phase, session) => {
    need(record, 'RECORD_MISSING')
    const b = assertG1Record(record)
    need(b.phase === phase && b.mode === mode && b.onceRoot === ctx.root && same(b.subject, ctx.subject) && same(b.request, ctx.expected)
      && same(b.runtime, ctx.runtime) && b.planId === ctx.planId && same(b.approval, ctx.approval), 'RECORD_CONFLICT')
    const audit = await read(deps.Audit, { _id: record.executionEvidence.masterDocxDispatch.auditId }, session)
    assertG1Audit(record, audit, signature)
    if (phase !== 'GRANT') {
      const grant = await find(ctx, 'GRANT', session); await verify(ctx, grant, 'GRANT', session)
      need(same(b.grant, g1Reference(grant)) && b.grantCreatedAt === body(grant).grantCreatedAt && b.expiresAt === body(grant).expiresAt, 'GRANT_JOIN')
      if (b.reservation) {
        const reservation = await find(ctx, 'RESERVATION', session); await verify(ctx, reservation, 'RESERVATION', session)
        need(same(b.reservation, g1Reference(reservation)), 'RESERVATION_JOIN')
      }
      if (phase === 'HOLD_AFTER_START') {
        const start = await find(ctx, 'START_OR_REVOKE', session); await verify(ctx, start, 'START_OR_REVOKE', session)
        need(body(start).decision === 'START_ALLOWED', 'HOLD_START_JOIN')
      }
    }
    remaining(ctx.deadline)
    return b
  }
  const linked = async (ctx, phase, session) => { const row = await find(ctx, phase, session); await verify(ctx, row, phase, session); return row }
  const write = async (ctx, phase, decision, grant = null, reservation = null) => {
    const existing = await find(ctx, phase)
    if (existing) { await verify(ctx, existing, phase); return { record: existing, fresh: false } }
    const b = { version: G1_VERSION, phase, decision, executionId: `master_docx_dispatch_${randomUUID()}`, scope: ctx.scope,
      actorUserId: ctx.subject.actorUserId, planId: ctx.planId, runtime: ctx.runtime, subject: ctx.subject, request: ctx.expected,
      mode, qaCase: ctx.qaCase, onceRoot: ctx.root, approval: ctx.approval, grantCreatedAt: ctx.grantCreatedAt,
      expiresAt: ctx.expiresAt, createdAt: new Date(Date.now()).toISOString(), grant: grant ? g1Reference(grant) : null, reservation: reservation ? g1Reference(reservation) : null }
    const pending = { _id: new mongoose.Types.ObjectId(), executionId: b.executionId, ...ctx.scope, ...ctx.runtime, workspaceType: 'PLATFORM',
      outputTypeKey: G1_OUTPUT, requestedOutputTypeKey: 'master-linked-docx-dispatch', executionIntent: 'Record bounded master-linked DOCX review authority; no customer approval.',
      idempotencyKey: g1Key(ctx.root, phase), requestFingerprint: ctx.expected.requestIdentity, status: G1_STATUSES[phase], contractVersion: G1_VERSION,
      providerMode: mode === G1_MODES.QA ? 'DETERMINISTIC_TEST' : 'LIVE_TEST', provider: { mode, provenance: mode === G1_MODES.QA ? 'NETWORK_QA' : 'GEN', phase },
      knowledgeManifest: {}, knowledgeBinding: {}, certifiedTruth: {}, runtimeStateWrites: {}, reasoningContext: { dispatchAvailable: false, approvalAvailable: false, finalisationAvailable: false },
      artifactIds: [], auditLogIds: [], warnings: [], limitations: [], requestedBy: b.actorUserId, requestedAt: new Date(b.createdAt), completedAt: null, failureReason: null,
      executionEvidence: { masterDocxDispatch: { body: b, bodyFingerprint: membershipHash(b), auditId: new mongoose.Types.ObjectId(), auditSignatureVersion: 3 } } }
    const session = await deps.Execution.db.startSession(), deadline = Math.min(ctx.deadline, Date.now() + 20000)
    let saved, fresh = false, attempts = 0
    try {
      await session.withTransaction(async () => {
        need(++attempts <= 2, 'TRANSACTION_ATTEMPTS'); remaining(deadline); fresh = false
        if (grant) need(refEqual(await linked(ctx, 'GRANT', session), grant), 'GRANT_CHANGED')
        if (reservation) need(refEqual(await linked(ctx, 'RESERVATION', session), reservation), 'RESERVATION_CHANGED')
        if (phase === 'HOLD_AFTER_START') need(body(await linked(ctx, 'START_OR_REVOKE', session)).decision === 'START_ALLOWED', 'START_MISSING')
        const winner = await find(ctx, phase, session)
        if (winner) { await verify(ctx, winner, phase, session); saved = winner; return }
        const audit = raw(await deps.auditService.log({ actorUserId: b.actorUserId, action: G1_ACTIONS[phase], resourceType: 'GovernedReasoningExecution',
          resourceId: pending._id, scope: ctx.scope, diff: g1AuditDiff(pending) }, { session, throwOnError: true }))
        const e = pending.executionEvidence.masterDocxDispatch
        e.auditId = audit?._id; e.auditSignatureVersion = audit?.signatureVersion; pending.auditLogIds = [String(audit?._id)]
        assertG1Record(pending); assertG1Audit(pending, audit, signature); remaining(deadline)
        const [row] = await deps.Execution.create([pending], { session }); saved = raw(row); fresh = true; remaining(deadline)
      }, { timeoutMS: Math.max(1, deadline - Date.now()) })
    } catch (error) {
      if (!(error?.code === 11000 && error.message?.includes('runtimeInstanceId_1_idempotencyKey_1')
        && same(Object.entries(error.keyPattern || {}), [['runtimeInstanceId', 1], ['idempotencyKey', 1]]))) {
        if (error?.code === 'MASTER_DOCX_REVIEW_HELD' || error?.name === 'ValidationError') throw error
        need(false, 'ATOMIC_WRITE_FAILED')
      }
      saved = await linked(ctx, phase); fresh = false
    } finally { await session.endSession() }
    const durable = await linked(ctx, phase)
    need(durable.executionId === saved?.executionId, 'DURABLE_READ_CHANGED')
    return { record: durable, fresh }
  }
  const adoptGrantTimes = (ctx, grant) => Object.assign(ctx, { grantCreatedAt: body(grant).grantCreatedAt, expiresAt: body(grant).expiresAt })
  const validPost = ctx => need(Date.parse(ctx.grantCreatedAt) <= Date.now() && Date.now() < Date.parse(ctx.expiresAt), 'GRANT_EXPIRED')
  const load = async original => {
    const args = copy(original)
    need(args?.deps === undefined && typeof args.grantExecutionId === 'string', 'GRANT_REFERENCE_REQUIRED')
    const row = await read(deps.Execution, { executionId: args.grantExecutionId })
    const b = assertG1Record(row)
    need(approvedProfile === g1RequestProfile(b.request), 'REVIEW_PROFILE_MISMATCH')
    need(b.mode === mode && b.phase === 'GRANT' && b.actorUserId === args.actorUserId, 'GRANT_ACTOR_MODE')
    const ctx = { mode, args, deadline: Date.now() + 60000, subject: copy(b.subject), scope: copy(b.scope), expected: copy(b.request),
      runtime: copy(b.runtime), planId: b.planId, root: b.onceRoot, qaCase: b.qaCase, approval: copy(b.approval), approvalId: b.approval?.auditId,
      grantCreatedAt: b.grantCreatedAt, expiresAt: b.expiresAt }
    if (mode === G1_MODES.QA && b.approval !== null) args.qaReleaseAuditId = b.approval.auditId
    await permission({ ...args, scope: ctx.scope }); await verify(ctx, row, 'GRANT'); await verifyApproval(ctx, false)
    return { ctx, grant: row }
  }
  const receiptDiff = (ctx, reservation, kind, payload) => ({ version: G1_VERSION, mode, kind, onceRoot: ctx.root,
    reservation: g1Reference(reservation), request: ctx.expected, payload })
  const validPayload = (kind, payload) => {
    need(payload && typeof payload.responseId === 'string' && typeof payload.postRequestId === 'string'
      && (payload.postRequestId === '' || /^[A-Za-z0-9._:-]{1,200}$/.test(payload.postRequestId))
      && payload.provider === 'OPENAI' && payload.model === 'gpt-5.2' && typeof payload.accountFingerprint === 'string' && /^[a-f0-9]{64}$/.test(payload.accountFingerprint)
      && (kind === 'RESPONSE' ? exact(payload, ['responseId', 'postRequestId', 'provider', 'model', 'accountFingerprint']) && /^resp_[A-Za-z0-9_-]{1,195}$/.test(payload.responseId)
        : kind === 'UNCERTAINTY' && exact(payload, ['responseId', 'postRequestId', 'provider', 'model', 'accountFingerprint', 'reason', 'state'])
        && (payload.responseId === '' || /^resp_[A-Za-z0-9_-]{1,195}$/.test(payload.responseId))
        && ['PROVIDER_FAILED', 'RECEIPT_FAILED'].includes(payload.reason) && payload.state === 'HELD_NO_RETRY'), 'RECEIPT_PAYLOAD')
  }
  const verifyReceipt = (ctx, reservation, kind, payload, row) => {
    validPayload(kind, payload)
    need(row && String(row._id) === g1ReceiptId(reservation.executionId, kind) && row.signatureVersion === 3 && row.action === G1_ACTIONS[kind]
      && row.resourceType === 'GovernedReasoningExecution' && String(row.resourceId) === String(reservation._id)
      && String(row.actorUserId) === ctx.subject.actorUserId && Object.entries(ctx.scope).every(([k, v]) => String(row.scope?.[k]) === v)
      && same(row.diff, receiptDiff(ctx, reservation, kind, payload)) && signature(row) === true, 'SIGNED_RECEIPT')
  }
  const saveReceipt = async (original, reservation, kind, material) => {
    const payload = copy(material), ctx = { ...original, deadline: Date.now() + 60000 }; validPayload(kind, payload)
    const session = await deps.Execution.db.startSession(); let attempts = 0
    const put = async (slot, value) => {
      const _id = new mongoose.Types.ObjectId(g1ReceiptId(reservation.executionId, slot)), existing = await read(deps.Audit, { _id }, session)
      if (existing) { verifyReceipt(ctx, reservation, slot, value, existing); return }
      const row = raw(await deps.auditService.log({ _id, actorUserId: ctx.subject.actorUserId, action: G1_ACTIONS[slot], resourceType: 'GovernedReasoningExecution',
        resourceId: reservation._id, scope: ctx.scope, diff: receiptDiff(ctx, reservation, slot, value) }, { session, throwOnError: true }))
      verifyReceipt(ctx, reservation, slot, value, row)
    }
    try {
      await session.withTransaction(async () => {
        need(++attempts <= 2, 'RECEIPT_ATTEMPTS'); remaining(ctx.deadline)
        const grant = await linked(ctx, 'GRANT', session), saved = await linked(ctx, 'RESERVATION', session), start = await linked(ctx, 'START_OR_REVOKE', session)
        need(refEqual(saved, reservation) && same(body(saved).grant, g1Reference(grant)) && body(start).decision === 'START_ALLOWED'
          && same(body(start).reservation, g1Reference(saved)), 'RECEIPT_JOIN')
        if (payload.responseId) await put('RESPONSE', Object.fromEntries(['responseId', 'postRequestId', 'provider', 'model', 'accountFingerprint'].map(k => [k, payload[k]])))
        await put(kind, payload); remaining(ctx.deadline)
      }, { timeoutMS: Math.min(50000, remaining(ctx.deadline)) })
    } catch (error) {
      need(error?.code === 11000 && same(Object.entries(error.keyPattern || {}), [['_id', 1]]), 'RECEIPT_ATOMIC_WRITE_FAILED')
      // Only a matching durable winner can reconcile an audit _id race. This
      // never retries the POST or overwrites either signed receipt.
    } finally { await session.endSession() }
    const durable = await read(deps.Audit, { _id: new mongoose.Types.ObjectId(g1ReceiptId(reservation.executionId, kind)) }, null, remaining(ctx.deadline))
    verifyReceipt(ctx, reservation, kind, payload, durable); remaining(ctx.deadline)
    return { state: 'DURABLE_RESPONSE_ID_RECORDED', ...copy(ctx.expected), ...payload }
  }
  const preparedContext = ctx => ({ mode, serialized: ctx.prepared.serialized, binding: copy(ctx.expected), subject: copy(ctx.subject),
    pageReceipts: copy(ctx.prepared.pageReceipts), inputFingerprint: ctx.prepared.inputFingerprint, docxChecksum: ctx.prepared.docxChecksum,
    expiresAt: ctx.expiresAt, approvalAvailable: false, finalisationAvailable: false,
    ...(ctx.approval?.version === G1_APPROVED_DIAGNOSTIC_GENUINE_RELEASE.version
      ? { postIdempotencyKey: g1PostIdempotencyKey(ctx.expected, ctx.root, ctx.approval.version) } : {}) })
  return Object.freeze({
    prepare: async args => {
      const ctx = await context(args); validPost(ctx)
      const admitted = await write(ctx, 'GRANT', 'GRANT'), grant = admitted.record; adoptGrantTimes(ctx, grant); validPost(ctx)
      const reserved = await write(ctx, 'RESERVATION', 'RESERVATION', grant), result = { grant: metadata(grant), reservation: metadata(reserved.record) }
      if (!reserved.fresh) return { ...result, state: 'REPLAY_HELD' }
      const reservation = reserved.record, capability = Object.freeze({})
      capabilities.set(capability, { mode, category: Boolean(approvedProfile) || isG1CategoryQaRequest(ctx.expected), approved: approvedProfile, consumed: false, begin: async () => {
        const fresh = await context(ctx.args)
        need(same(fresh.subject, ctx.subject) && same(fresh.runtime, ctx.runtime) && fresh.prepared.serialized === ctx.prepared.serialized
          && fresh.root === ctx.root && same(fresh.approval, ctx.approval), 'SOURCE_CHANGED')
        validPost(ctx); await verifyApproval(ctx)
        const start = await write(ctx, 'START_OR_REVOKE', 'START_ALLOWED', grant, reservation)
        need(start.fresh && body(start.record).decision === 'START_ALLOWED', 'START_NOT_OWNED'); validPost(ctx)
        return Object.freeze({ ...preparedContext(ctx), grant: g1Reference(grant), reservation: g1Reference(reservation), start: g1Reference(start.record),
          recordResponse: value => saveReceipt(ctx, reservation, 'RESPONSE', value), recordUncertainty: value => saveReceipt(ctx, reservation, 'UNCERTAINTY', value) })
      } })
      return { ...result, state: 'FRESH_RESERVATION', capability }
    },
    read: async args => {
      const { ctx, grant } = await load(args), records = { GRANT: metadata(grant) }, receipts = {}
      for (const phase of ['RESERVATION', 'START_OR_REVOKE', 'HOLD_AFTER_START']) {
        const row = await find(ctx, phase)
        if (row) { await verify(ctx, row, phase); records[phase] = metadata(row) }
      }
      const reservation = await find(ctx, 'RESERVATION')
      if (reservation) for (const kind of ['RESPONSE', 'UNCERTAINTY']) {
        const row = await read(deps.Audit, { _id: new mongoose.Types.ObjectId(g1ReceiptId(reservation.executionId, kind)) })
        if (row) { verifyReceipt(ctx, reservation, kind, row.diff?.payload, row); receipts[kind] = copy(row.diff) }
      }
      if (receipts.RESPONSE && receipts.UNCERTAINTY?.payload.responseId) need(same(receipts.RESPONSE.payload,
        Object.fromEntries(['responseId', 'postRequestId', 'provider', 'model', 'accountFingerprint'].map(k => [k, receipts.UNCERTAINTY.payload[k]]))), 'RECEIPT_ID_CONFLICT')
      const consumed = records.START_OR_REVOKE?.body.decision === 'START_ALLOWED'
      need(!Object.keys(receipts).length || consumed, 'RECEIPT_WITHOUT_START')
      remaining(ctx.deadline)
      return { mode, records, receipts, genuineAttemptConsumed: mode === G1_MODES.GENUINE && consumed,
        genuineReviewUsed: mode === G1_MODES.QA || !consumed ? false : receipts.RESPONSE ? true : null,
        submissionState: receipts.RESPONSE ? 'KNOWN_RESPONSE' : consumed ? 'START_CONSUMED_SUBMISSION_UNCONFIRMED' : 'NOT_STARTED',
        dispatchAvailable: false, approvalAvailable: false, finalisationAvailable: false }
    },
    revoke: async args => {
      const { ctx, grant } = await load(args), result = await write(ctx, 'START_OR_REVOKE', 'REVOKED', grant)
      if (body(result.record).decision === 'REVOKED') return metadata(result.record)
      const reservation = await linked(ctx, 'RESERVATION')
      return metadata((await write(ctx, 'HOLD_AFTER_START', 'HOLD_AFTER_START', grant, reservation)).record)
    },
    recover: async args => {
      const { ctx } = await load(args), reservation = await linked(ctx, 'RESERVATION'), start = await linked(ctx, 'START_OR_REVOKE')
      need(body(start).decision === 'START_ALLOWED' && same(body(start).reservation, g1Reference(reservation)), 'RECOVERY_START')
      const receipt = await read(deps.Audit, { _id: new mongoose.Types.ObjectId(g1ReceiptId(reservation.executionId, 'RESPONSE')) })
      verifyReceipt(ctx, reservation, 'RESPONSE', receipt?.diff?.payload, receipt)
      remaining(ctx.deadline)
      const capability = Object.freeze({})
      capabilities.set(capability, { mode, category: Boolean(approvedProfile) || isG1CategoryQaRequest(ctx.expected), approved: approvedProfile, consumed: false, begin: async () => {
        remaining(ctx.deadline); await permission({ ...ctx.args, scope: ctx.scope }); remaining(ctx.deadline)
        await linked(ctx, 'GRANT'); await linked(ctx, 'RESERVATION'); await linked(ctx, 'START_OR_REVOKE')
        return { ...preparedContext({ ...ctx, prepared: { serialized: null,
        pageReceipts: ctx.subject.binding.pages, inputFingerprint: ctx.subject.binding.inputFingerprint, docxChecksum: ctx.subject.binding.docxChecksum } }),
        recoveryOnly: true, responseId: receipt.diff.payload.responseId, responseIdentity: copy(receipt.diff.payload),
        grant: g1Reference(await linked(ctx, 'GRANT')), reservation: g1Reference(reservation), start: g1Reference(start),
        recordResponse: value => saveReceipt(ctx, reservation, 'RESPONSE', value), recordUncertainty: value => saveReceipt(ctx, reservation, 'UNCERTAINTY', value) }
      } })
      return { capability, mode, recoveryOnly: true, dispatchAvailable: false }
    },
  })
}

export const createGenuineMasterLinkedReviewAuthority = (...args) => { need(args.length === 0, 'GENUINE_OVERRIDES_FORBIDDEN'); return createOwner(G1_MODES.GENUINE, {}) }
export const createNetworkQaMasterLinkedReviewAuthority = (dependencies = {}) => createOwner(G1_MODES.QA, { ...dependencies })
export const createApprovedGenuineMasterLinkedReviewAuthority = (...args) => {
  need(args.length === 0, 'GENUINE_OVERRIDES_FORBIDDEN')
  return createOwner(G1_MODES.GENUINE, {}, true)
}
export const createApprovedNetworkQaMasterLinkedReviewAuthority = (...args) => {
  need(args.length === 0, 'QA_OVERRIDES_FORBIDDEN')
  return createOwner(G1_MODES.QA, {}, true)
}
export const createNarrowGenuineMasterLinkedReviewAuthority = (...args) => {
  need(args.length === 0, 'GENUINE_OVERRIDES_FORBIDDEN')
  return createOwner(G1_MODES.GENUINE, {}, 'NARROW')
}
