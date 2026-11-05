import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Execution from '../models/GovernedReasoningExecution.js'
import Audit from '../models/AuditLog.js'
import auditService from './auditService.js'
import { assertRuntimePermission, getRuntimeInstance } from './runtimeInstanceService.js'
import { prepareMasterLinkedDocxReviewTransport } from './outcomeMasterLinkedDocxReviewTransportService.js'
import { buildOpenAiMasterLinkedDocxReviewRequest } from './openAiMasterLinkedDocxReviewRequest.js'
import { assertRenditionClaimIndex } from './governedRenditionReviewClaimService.js'
import { normalizeOutcomeRenderedExpressionRlProviderOutput } from './openAiOutcomeRenderedExpressionRlProviderAdapter.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { MASTER_SIMULATION_VERSION, MASTER_SIMULATION_OUTPUT, MASTER_SIMULATION_STATUSES, MASTER_SIMULATION_ACTIONS,
  simulationPolicy, simulationKey, assertSimulationBinding, assertMasterReviewSimulationRecord, simulationAuditDiff, assertSimulationAudit,
  simulationReceiptId, assertSimulationResponse, assertSimulationUncertainty, simulationNeed as need, simulationSame as same, simulationExact as exact } from './masterLinkedReviewSimulationContract.js'

const copy = value => JSON.parse(JSON.stringify(value)), raw = value => value?.toObject ? value.toObject() : value
const runtimeKeys = ['runtimeInstanceKey', 'runtimeType', 'frameworkKey', 'packageKey', 'packageVersion']
const read = (model, filter, session, timeoutMS) => {
  let query = model.findOne(filter)
  if (session) query = query.session(session)
  if (timeoutMS) query = query.setOptions({ timeoutMS })
  return query.lean()
}
const signature = (ctx, audit) => ctx.Audit.prototype.verifySignature.call(audit)
const mode = args => {
  need(args.executionMode === 'SIMULATED', 'GENUINE_REVIEW_HELD')
  assertSimulationBinding(args.expected)
}
const context = async args => {
  mode(args)
  const deadline = Date.now() + 600000, deps = { ...args.deps }, expected = copy(args.expected), request = copy({ actorUserId: args.actorUserId,
    runtimeInstanceId: args.runtimeInstanceId, candidateId: args.candidateId, scopes: args.scopes })
  const transport = await (deps.prepareTransport || prepareMasterLinkedDocxReviewTransport)(request)
  const prepared = buildOpenAiMasterLinkedDocxReviewRequest(transport), subject = copy(transport.subject)
  need(same(expected, prepared.binding) && subject.actorUserId === String(request.actorUserId)
    && subject.binding.candidateId === request.candidateId && subject.binding.masterReference.scope.runtimeInstanceId === request.runtimeInstanceId, 'SIMULATION_REQUEST_CHANGED')
  const scope = copy(subject.binding.masterReference.scope)
  await (deps.assertPermission || assertRuntimePermission)({ actorUserId: request.actorUserId, scopes: request.scopes, ...scope, permission: 'VMF_UPDATE', maxTimeMS: 3000 })
  const current = await (deps.readRuntime || getRuntimeInstance)({ scopes: request.scopes, ...scope,
    projection: 'runtimeInstanceKey runtimeType frameworkKey packageKey packageVersion status', maxTimeMS: 3000, metadataMaxTimeMS: 3000 })
  need(current && String(current.id || current._id) === scope.runtimeInstanceId && current.status === 'LOCKED'
    && ['tenantId', 'customerId'].every(key => String(current[key]) === scope[key]), 'SIMULATION_RUNTIME_CHANGED')
  const runtime = Object.fromEntries(runtimeKeys.map(key => [key, current[key] || '']))
  const ctx = { request: copy(request), executionMode: 'SIMULATED', expected: copy(prepared.binding), deps: { ...deps }, deadline,
    subject, scope, runtime, planId: transport.sourceEnvelope.source.plan.planId, serialized: prepared.serialized,
    Execution: deps.Execution || Execution, Audit: deps.Audit || Audit }
  need(ctx.Execution.db === ctx.Audit.db, 'SIMULATION_DATABASE_OWNER')
  await assertRenditionClaimIndex(ctx.Execution)
  const index = (await ctx.Audit.collection.indexes()).find(item => item.name === '_id_')
  need(index && same(Object.entries(index.key), [['_id', 1]]) && !index.sparse && !index.partialFilterExpression && !index.collation, 'SIMULATION_RECEIPT_INDEX')
  need(Date.now() <= deadline, 'SIMULATION_DEADLINE')
  return ctx
}
const find = (ctx, phase, session, timeout) => read(ctx.Execution, { ...ctx.scope, idempotencyKey: simulationKey(ctx.planId, phase) }, session, timeout)
const checkDeadline = ctx => need(Date.now() <= ctx.deadline, 'SIMULATION_DEADLINE')
const verify = async (ctx, record, phase, session, timeout) => {
  need(record, 'SIMULATION_RECORD_MISSING')
  const body = assertMasterReviewSimulationRecord(record)
  need(body.phase === phase && same(body.subject, ctx.subject) && same(body.request, ctx.expected) && same(body.runtime, ctx.runtime)
    && body.planId === ctx.planId && same(body.scope, ctx.scope), 'SIMULATION_RECORD_CONFLICT')
  const audit = await read(ctx.Audit, { _id: record.executionEvidence.masterLinkedReview.auditId }, session, timeout)
  assertSimulationAudit(record, audit, row => signature(ctx, row))
  checkDeadline(ctx)
  return body
}
const metadata = record => ({ ...copy(record.executionEvidence.masterLinkedReview), simulationOnly: true,
  dispatchAvailable: false, genuineReviewUsed: false, approvalAvailable: false })
const authorityReference = record => ({ executionId: record.executionId, bodyFingerprint: record.executionEvidence.masterLinkedReview.bodyFingerprint })
const verifyAuthority = async (ctx, session, timeout) => {
  const row = await find(ctx, 'AUTHORITY', session, timeout); await verify(ctx, row, 'AUTHORITY', session, timeout); return row
}
const createRecord = async (ctx, phase, authority = null) => {
  const existing = await find(ctx, phase)
  if (existing) {
    const body = await verify(ctx, existing, phase)
    if (authority) need(same(body.authority, authorityReference(authority)), 'SIMULATION_AUTHORITY_CHANGED')
    checkDeadline(ctx); return { record: existing, fresh: false }
  }
  const body = { contractVersion: MASTER_SIMULATION_VERSION, phase, executionId: `master_review_sim_${randomUUID()}`,
    scope: ctx.scope, actorUserId: ctx.subject.actorUserId, planId: ctx.planId, runtime: ctx.runtime, subject: ctx.subject,
    request: ctx.expected, policy: simulationPolicy(), authority: authority ? authorityReference(authority) : null, createdAt: new Date().toISOString() }
  const pending = { _id: new mongoose.Types.ObjectId(), executionId: body.executionId, ...ctx.scope, ...ctx.runtime,
    workspaceType: 'PLATFORM', outputTypeKey: MASTER_SIMULATION_OUTPUT, requestedOutputTypeKey: 'master-review-simulation',
    executionIntent: 'Record simulation-only review authority or reservation; genuine review held.', idempotencyKey: simulationKey(ctx.planId, phase),
    requestFingerprint: ctx.expected.requestIdentity, status: MASTER_SIMULATION_STATUSES[phase], contractVersion: MASTER_SIMULATION_VERSION,
    providerMode: 'DETERMINISTIC_TEST', provider: { executionMode: 'SIMULATED', phase }, knowledgeManifest: {}, knowledgeBinding: {},
    certifiedTruth: {}, runtimeStateWrites: {}, reasoningContext: { contentVisible: false, packContentLoaded: false, dispatchAvailable: false, approvalAvailable: false },
    artifactIds: [], auditLogIds: [], warnings: [], limitations: [], requestedBy: ctx.subject.actorUserId,
    requestedAt: new Date(body.createdAt), completedAt: null, failureReason: null,
    executionEvidence: { masterLinkedReview: { body, bodyFingerprint: membershipHash(body), auditId: new mongoose.Types.ObjectId(), auditSignatureVersion: 1 } } }
  const session = await ctx.Execution.db.startSession(), deadline = Math.min(ctx.deadline, Date.now() + 20000)
  let saved, fresh = false, attempts = 0
  const budget = () => need(Date.now() <= deadline && attempts <= 2, 'SIMULATION_TRANSACTION_BUDGET')
  try {
    await session.withTransaction(async () => {
      fresh = false; attempts++; budget()
      if (authority) need(same(authorityReference(await verifyAuthority(ctx, session)), body.authority), 'SIMULATION_AUTHORITY_CHANGED')
      const winner = await find(ctx, phase, session)
      if (winner) { await verify(ctx, winner, phase, session); saved = winner; return }
      const audit = raw(await (ctx.deps.auditService || auditService).log({ actorUserId: body.actorUserId, action: MASTER_SIMULATION_ACTIONS[phase],
        resourceType: 'GovernedReasoningExecution', resourceId: pending._id, scope: ctx.scope, diff: simulationAuditDiff(pending) }, { session, throwOnError: true }))
      pending.executionEvidence.masterLinkedReview.auditId = audit?._id; pending.executionEvidence.masterLinkedReview.auditSignatureVersion = audit?.signatureVersion
      pending.auditLogIds = [String(audit?._id)]
      assertMasterReviewSimulationRecord(pending); assertSimulationAudit(pending, audit, row => signature(ctx, row)); budget()
      const [document] = await ctx.Execution.create([pending], { session }); saved = raw(document); fresh = true; budget()
    }, { timeoutMS: Math.min(20000, Math.max(1, deadline - Date.now())) })
  } catch (error) {
    need(error?.code === 11000 && error.message?.includes('runtimeInstanceId_1_idempotencyKey_1')
      && same(Object.entries(error.keyPattern || {}), [['runtimeInstanceId', 1], ['idempotencyKey', 1]]), 'SIMULATION_ATOMIC_WRITE_FAILED')
    saved = await find(ctx, phase); await verify(ctx, saved, phase); fresh = false
  } finally { await session.endSession() }
  const durable = await find(ctx, phase); await verify(ctx, durable, phase)
  need(durable.executionId === saved?.executionId && Date.now() <= ctx.deadline, 'SIMULATION_DURABLE_READ_CHANGED')
  return { record: durable, fresh }
}
const receiptDiff = (ctx, reservation, kind, payload) => ({ contractVersion: MASTER_SIMULATION_VERSION, kind,
  reservation: authorityReference(reservation), authority: reservation.executionEvidence.masterLinkedReview.body.authority,
  request: ctx.expected, simulationOnly: true, genuineReviewUsed: false, payload })
const verifyReceipt = (ctx, reservation, kind, payload, row) => {
  if (kind === 'RESPONSE') assertSimulationResponse(payload)
  else { need(kind === 'UNCERTAINTY', 'SIMULATION_RECEIPT_KIND'); assertSimulationUncertainty(payload) }
  need(row && String(row._id) === simulationReceiptId(kind, reservation.executionId) && row.action === MASTER_SIMULATION_ACTIONS[kind]
    && row.resourceType === 'GovernedReasoningExecution' && String(row.resourceId) === String(reservation._id)
    && String(row.actorUserId) === ctx.subject.actorUserId && Object.keys(ctx.scope).every(key => String(row.scope?.[key]) === ctx.scope[key])
    && same(row.diff, receiptDiff(ctx, reservation, kind, payload)) && signature(ctx, row) === true, 'SIMULATION_RECEIPT_INVALID')
}
// Bounded owned closure: no expensive source or pack reconstruction after the
// simulated submission. Raw transaction joins and model signatures remain live.
const saveReceipt = async (ctx, reservation, kind, payload) => {
  if (kind === 'RESPONSE') assertSimulationResponse(payload)
  else { need(kind === 'UNCERTAINTY', 'SIMULATION_RECEIPT_KIND'); assertSimulationUncertainty(payload) }
  const deadline = Date.now() + 60000, remaining = () => { const ms = deadline - Date.now(); need(ms > 0, 'SIMULATION_RECEIPT_TIMEOUT'); return ms }
  // Receipt durability has its own budget even if overall execution ran late.
  // Recording what happened cannot authorise another submission.
  const receiptCtx = { ...ctx, deadline }
  const id = new mongoose.Types.ObjectId(simulationReceiptId(kind, reservation.executionId)), session = await ctx.Execution.db.startSession()
  const write = async (current, slot, material, transaction) => {
    const slotId = new mongoose.Types.ObjectId(simulationReceiptId(slot, current.executionId)), existing = await read(ctx.Audit, { _id: slotId }, transaction)
    if (existing) { verifyReceipt(ctx, current, slot, material, existing); return }
    const row = raw(await (ctx.deps.auditService || auditService).log({ _id: slotId, actorUserId: ctx.subject.actorUserId,
      action: MASTER_SIMULATION_ACTIONS[slot], resourceType: 'GovernedReasoningExecution', resourceId: current._id, scope: ctx.scope,
      diff: receiptDiff(ctx, current, slot, material) }, { session: transaction, throwOnError: true }))
    verifyReceipt(ctx, current, slot, material, row)
  }
  const checkResponse = async (current, transaction) => {
    const known = await read(ctx.Audit, { _id: new mongoose.Types.ObjectId(simulationReceiptId('RESPONSE', current.executionId)) }, transaction)
    if (known) {
      const identity = assertSimulationResponse(known.diff?.payload); verifyReceipt(ctx, current, 'RESPONSE', identity, known)
      need(!payload.responseId || identity.responseId === payload.responseId, 'SIMULATION_RESPONSE_CONFLICT')
    }
    // A known identity in uncertainty occupies the same slot as RESPONSE. Two
    // different receipt IDs alone would permit conflicting concurrent commits.
    else if (kind === 'UNCERTAINTY' && payload.responseId) await write(current, 'RESPONSE', { responseId: payload.responseId }, transaction)
  }
  try {
    await session.withTransaction(async () => {
      remaining(); const authority = await verifyAuthority(receiptCtx, session), current = await find(receiptCtx, 'RESERVATION', session)
      const body = await verify(receiptCtx, current, 'RESERVATION', session)
      need(same(authorityReference(current), authorityReference(reservation)) && same(body.authority, authorityReference(authority)), 'SIMULATION_RECEIPT_JOIN')
      await checkResponse(current, session)
      await write(current, kind, payload, session); remaining()
    }, { timeoutMS: Math.min(50000, remaining()) })
  } finally { await session.endSession() }
  const durable = await read(ctx.Audit, { _id: id }, null, remaining()); verifyReceipt(ctx, reservation, kind, payload, durable); remaining()
  return copy(durable.diff)
}
const reservationResult = (ctx, reserved) => {
  checkDeadline(ctx)
  const result = metadata(reserved.record)
  if (!reserved.fresh) return result
  // Privately snapshot everything used by the capability; metadata and caller
  // objects remain freely mutable without changing its authority.
  const owned = { ...ctx, ...copy({ request: ctx.request, expected: ctx.expected, subject: ctx.subject, scope: ctx.scope, runtime: ctx.runtime }), deps: { ...ctx.deps } }
  const record = raw(reserved.record), reservation = { ...copy(record), _id: record._id }, serialized = ctx.serialized
  let consumed = false
  result.executeSimulation = async simulate => {
    need(!consumed, 'SIMULATION_CAPABILITY_CONSUMED'); consumed = true
    need(typeof simulate === 'function', 'SIMULATION_CALLBACK_REQUIRED')
    let responseId = '', reason = 'SIMULATION_SOURCE_CHANGED'
    try {
      const current = await context({ ...owned.request, executionMode: 'SIMULATED', expected: owned.expected, deps: owned.deps })
      need(same(current.runtime, owned.runtime) && current.planId === owned.planId && Date.now() <= owned.deadline, 'SIMULATION_SOURCE_CHANGED')
      const authority = await verifyAuthority(owned), saved = await find(owned, 'RESERVATION'); await verify(owned, saved, 'RESERVATION')
      need(same(authorityReference(saved), authorityReference(reservation))
        && same(saved.executionEvidence.masterLinkedReview.body.authority, authorityReference(authority)), 'SIMULATION_SOURCE_CHANGED')
      reason = 'SIMULATION_CALLBACK_FAILED'
      const reply = await simulate(serialized, Object.freeze({ ...owned.expected }))
      reason = 'SIMULATION_RESPONSE_INVALID'
      need(exact(reply, ['responseId', 'output']), 'SIMULATION_RESPONSE_INVALID'); assertSimulationResponse({ responseId: reply.responseId }); responseId = reply.responseId
      reason = 'SIMULATION_OUTPUT_INVALID'
      const capturedOutput = copy(reply.output)
      reason = 'SIMULATION_RECEIPT_FAILED'
      const receipt = await saveReceipt(owned, reservation, 'RESPONSE', { responseId })
      reason = 'SIMULATION_OUTPUT_INVALID'
      const output = normalizeOutcomeRenderedExpressionRlProviderOutput(capturedOutput)
      reason = 'SIMULATION_DEADLINE'
      need(Date.now() <= owned.deadline, 'SIMULATION_DEADLINE')
      return { output, receipt, simulationOnly: true, genuineReviewUsed: false, approvalAvailable: false, completionPersisted: false }
    } catch {
      await saveReceipt(owned, reservation, 'UNCERTAINTY', { reason, responseId, state: 'HELD_NO_RETRY' })
      need(false, reason)
    }
  }
  return result
}
export const admitMasterLinkedReviewSimulation = async args => metadata((await createRecord(await context(args), 'AUTHORITY')).record)
export const reserveMasterLinkedReviewSimulation = async args => {
  const ctx = await context(args), authority = await verifyAuthority(ctx)
  return reservationResult(ctx, await createRecord(ctx, 'RESERVATION', authority))
}
export const executeMasterLinkedReviewSimulation = async args => {
  mode(args); const simulate = args.simulate; need(typeof simulate === 'function', 'SIMULATION_CALLBACK_REQUIRED')
  const ctx = await context(args), authority = (await createRecord(ctx, 'AUTHORITY')).record
  const reserved = reservationResult(ctx, await createRecord(ctx, 'RESERVATION', authority))
  checkDeadline(ctx)
  return reserved.executeSimulation ? reserved.executeSimulation(simulate) : { ...reserved, state: 'REPLAY_HELD' }
}
export const readMasterLinkedReviewSimulation = async args => {
  const ctx = await context(args), authority = await find(ctx, 'AUTHORITY'), reservation = await find(ctx, 'RESERVATION')
  if (!authority) { need(!reservation, 'SIMULATION_ORPHAN_RESERVATION'); checkDeadline(ctx); return { state: 'NOT_RECORDED', genuineReviewUsed: false } }
  await verify(ctx, authority, 'AUTHORITY')
  if (!reservation) { checkDeadline(ctx); return { authority: metadata(authority), state: 'AUTHORISED_SIMULATION_ONLY', genuineReviewUsed: false } }
  const body = await verify(ctx, reservation, 'RESERVATION'); need(same(body.authority, authorityReference(authority)), 'SIMULATION_AUTHORITY_CHANGED')
  const receipts = {}
  for (const kind of ['RESPONSE', 'UNCERTAINTY']) {
    const row = await read(ctx.Audit, { _id: new mongoose.Types.ObjectId(simulationReceiptId(kind, reservation.executionId)) })
    if (row) { verifyReceipt(ctx, reservation, kind, row.diff.payload, row); receipts[kind] = copy(row.diff) }
  }
  need(!receipts.UNCERTAINTY?.payload.responseId || receipts.RESPONSE?.payload.responseId === receipts.UNCERTAINTY.payload.responseId, 'SIMULATION_RESPONSE_CONFLICT')
  checkDeadline(ctx)
  return { authority: metadata(authority), reservation: metadata(reservation), receipts, state: 'RESERVED_HELD', genuineReviewUsed: false, dispatchAvailable: false }
}
