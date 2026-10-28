import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import env from '../config/env.js'
import Audit from '../models/AuditLog.js'
import Receipt, { assertSyntheticRevisionReceipt, syntheticRevisionScope, syntheticRevisionReceiptType } from '../models/RuntimeSyntheticRevisionReceipt.js'
import { SYNTHETIC_REVISION_TEST_POLICY as p, isSyntheticRevisionTestRuntime } from '../constants/syntheticRevisionTestPolicy.js'
import { parseSyntheticTestAmendment } from '../constants/syntheticTestDispositionPolicy.js'
import { syntheticTestDispositionBodySchema } from '../validators/syntheticTestDisposition.validator.js'
import { reviewCompletionBodySchema } from '../validators/reviewCompletion.validator.js'
import { getRuntimeInstance, assertRuntimePermission } from './runtimeInstanceService.js'
import { membershipHash, membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { compileSyntheticRevisionBasis, syntheticRevisionFailure as fail, requireSyntheticRevision as need } from './syntheticRevisionTestBasis.js'
import auditService from './auditService.js'
import { isRuntimeLifecycleTruthImmutable } from './runtimeActionPolicyService.js'

const options = session => ({ session, maxTimeMS: 3000 })
const environment = () => need(['development', 'test'].includes(env.nodeEnv) && env.appEnv === 'development'
  && /^(test|ss044_[a-f0-9]{32})$/.test(mongoose.connection.name || ''), 'DEV_TEST_ONLY')
const recorder = args => {
  environment()
  if (String(args.actorUserId) !== p.recorderUserId || !args.scopes?.platformRoles?.includes('SUPER_ADMIN'))
    fail('NAMED_TECHNICAL_RECORDER_REQUIRED', 403)
}
const ownRuntime = session => mongoose.connection.db.collection('runtime_instances').findOne({
  _id: new mongoose.Types.ObjectId(p.runtimeInstanceId), customerId: new mongoose.Types.ObjectId(p.customerId),
  tenantId: new mongoose.Types.ObjectId(p.tenantId),
}, options(session))
const load = async (args, session) => {
  recorder(args)
  const selected = await getRuntimeInstance({ runtimeInstanceId: args.runtimeInstanceId, scopes: args.scopes,
    projection: 'customerId tenantId runtimeInstanceKey', session, maxTimeMS: 3000 })
  need(isSyntheticRevisionTestRuntime(selected) && String(selected.customerId) === p.customerId
    && String(selected.tenantId) === p.tenantId && selected.runtimeInstanceKey === p.runtimeInstanceKey, 'EXACT_SCOPE_REQUIRED')
  await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes,
    customerId: selected.customerId, tenantId: selected.tenantId, permission: 'VMF_UPDATE', session })
  const runtime = await ownRuntime(session)
  need(runtime && runtime.status === 'ACTIVE' && runtime.framework_state?.lock?.locked !== true
    && !['RUNNING', 'VALIDATING', 'COMPLETE', 'ERROR'].includes(runtime.executionStatus), 'EDITABLE_TEST_RUNTIME_REQUIRED')
  return runtime
}
const transaction = async work => {
  const session = await mongoose.startSession()
  try { return await session.withTransaction(() => work(session), { readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' }, maxCommitTimeMS: 5000, timeoutMS: 20000 }) }
  finally { await session.endSession() }
}
const readRecord = async (kind, session) => {
  const rows = await Receipt.find({ ...syntheticRevisionScope(), kind }).session(session).limit(2).maxTimeMS(3000).lean()
  need(rows.length <= 1, 'RECEIPT_AMBIGUOUS'); return rows[0] || null
}
const auditDiff = record => ({ operation: 'SYNTHETIC_REVISION_TEST_' + record.kind,
  receiptType: syntheticRevisionReceiptType(record.kind), classification: p.classification, authoritative: false,
  policyReference: p.reference, receiptId: record.receiptId, bodyHash: record.bodyHash,
  materialHash: record.body.basis.materialHash, stateVersion: record.body.basis.stateVersion,
  dispositionLink: record.body.dispositionLink })
const verify = async (record, basis, session) => {
  need(record, 'RECEIPT_REQUIRED')
  try { assertSyntheticRevisionReceipt(record) } catch { fail('RECEIPT_INVALID') }
  need(record.body.basis.materialHash === basis.materialHash, 'STALE_QUALIFIED_POPULATION')
  const audit = await Audit.collection.findOne({ _id: record.auditId, resourceId: new mongoose.Types.ObjectId(p.runtimeInstanceId),
    ...Object.fromEntries(Object.entries(syntheticRevisionScope()).map(([key, value]) => ['scope.' + key, value])) }, options(session))
  need(audit && Audit.hydrate(audit).verifySignature() && audit.signatureVersion === record.auditSignatureVersion
    && String(audit.actorUserId) === p.recorderUserId && audit.action === 'RUNTIME_STATE_MUTATED'
    && audit.resourceType === 'RuntimeInstance' && audit.requestId === record.requestKey
    && membershipHash(audit.diff) === membershipHash(auditDiff(record)), 'SIGNED_AUDIT_INVALID')
  return record
}
const dispositionLink = record => ({ receiptId: record.receiptId, bodyHash: record.bodyHash })
const populationHash = (basis, disposition) => membershipHash({ basis: basis.materialHash, disposition: dispositionLink(disposition) })
const dto = record => record && ({ receiptId: record.receiptId, receiptType: record.body.receiptType,
  classification: p.classification, authoritative: false, bodyHash: record.bodyHash, createdAt: record.body.createdAt,
  basisStateVersion: record.body.basis.stateVersion, materialHash: record.body.basis.materialHash,
  decisionMaker: record.body.decisionMaker, recorderUserId: record.body.recorderUserId,
  disposition: record.kind === 'DISPOSITION' ? record.body.input.disposition : null,
  rationale: record.body.input.rationale, auditId: String(record.auditId), execution: 'HELD',
  officialVMFAcceptance: false, lockExecuted: false, arlExecuted: false })
const inspect = kind => async args => {
  recorder(args)
  return transaction(async session => {
  const runtime = await load(args, session), basis = await compileSyntheticRevisionBasis(runtime, session)
  const disposition = await readRecord('DISPOSITION', session)
  if (disposition) await verify(disposition, basis, session)
  const record = kind === 'DISPOSITION' ? disposition : await readRecord('COMPLETION', session)
  if (record && kind === 'COMPLETION') {
    await verify(record, basis, session)
    need(disposition && disposition.body.input.disposition === 'NOT_CONTRADICTORY'
      && membershipHash(record.body.dispositionLink) === membershipHash(dispositionLink(disposition)), 'DISPOSITION_LINK_INVALID')
  }
  return { classification: p.classification, authoritative: false, policyReference: p.reference,
    amendmentReference: p.amendmentReference, expectedUpdatedAt: basis.updatedAt, stateVersion: basis.stateVersion,
    expectedBasisHash: basis.materialHash, expectedPopulationHash: disposition ? populationHash(basis, disposition) : null,
    canRecord: !runtime.framework_state?.publish?.published && !runtime.lockedAt
      && !isRuntimeLifecycleTruthImmutable(runtime.framework_state)
      && (kind === 'DISPOSITION' ? runtime.stateVersion === p.initialStateVersion
        : Boolean(disposition?.body.input.disposition === 'NOT_CONTRADICTORY')),
    evidencePairHash: basis.manifest.rootEvidencePairHash, typedEvidencePairHash: basis.manifest.typedEvidencePairHash,
    candidate: basis.manifest.finding, receipt: dto(record), execution: 'HELD' }
  })
}
export const inspectSyntheticRevisionDisposition = inspect('DISPOSITION')
export const inspectSyntheticRevisionCompletion = inspect('COMPLETION')
const indexes = async () => {
  let rows
  try { rows = await Receipt.collection.listIndexes({ maxTimeMS: 3000 }).toArray() } catch { fail('UNIQUE_INDEX_REQUIRED', 503) }
  for (const [name, field] of [['unique_synthetic_revision_kind', 'kind'], ['unique_synthetic_revision_request', 'requestKey']]) {
    const index = rows.find(row => row.name === name)
    need(index?.unique && !index.sparse && !index.partialFilterExpression
      && JSON.stringify(index.key) === JSON.stringify({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, [field]: 1 }), 'UNIQUE_INDEX_REQUIRED')
  }
}
const record = kind => async args => {
  recorder(args)
  const parsed = (kind === 'DISPOSITION' ? syntheticTestDispositionBodySchema : reviewCompletionBodySchema).safeParse(args.payload)
  if (!parsed.success) fail('EXPLICIT_TEST_DECISION_REQUIRED', 422)
  const input = parsed.data
  if (kind === 'DISPOSITION') {
    try { parseSyntheticTestAmendment(input.amendmentDocumentText) } catch { fail('ADOPTED_AMENDMENT_REQUIRED', 422) }
    if (Date.parse(input.decisionSource.decidedAt) < Date.parse('2026-10-20T00:00:00Z')
      || Date.parse(input.decisionSource.decidedAt) > Date.now()) fail('ACTUAL_PROSPECTIVE_DECISION_REQUIRED', 422)
  }
  await indexes()
  return transaction(async session => {
    const runtime = await load(args, session), basis = await compileSyntheticRevisionBasis(runtime, session)
    // A real write fence serializes concurrent requests without changing the
    // committed runtime. Missing version metadata cannot be guessed.
    need(Number.isSafeInteger(runtime.__v) && runtime.__v >= 0, 'VERSION_FENCE_REQUIRED')
    const filter = { _id: runtime._id, customerId: runtime.customerId, tenantId: runtime.tenantId,
      stateVersion: runtime.stateVersion, updatedAt: runtime.updatedAt, __v: runtime.__v }
    const runtimeCollection = mongoose.connection.db.collection('runtime_instances')
    need((await runtimeCollection.updateOne(filter, { $inc: { __v: 1 } }, options(session))).modifiedCount === 1, 'STALE_RUNTIME')
    const payloadHash = membershipHash({ kind, input, actorUserId: p.recorderUserId })
    const existing = await readRecord(kind, session)
    let disposition = kind === 'COMPLETION' ? await verify(await readRecord('DISPOSITION', session), basis, session) : null
    if (kind === 'COMPLETION') need(disposition.body.input.disposition === 'NOT_CONTRADICTORY', 'TEST_FINDING_BLOCKING')
    if (existing) {
      await verify(existing, basis, session)
      need(existing.requestKey === input.requestKey && existing.payloadHash === payloadHash, 'CONFLICTING_RETRY')
      if (kind === 'COMPLETION') need(membershipHash(existing.body.dispositionLink) === membershipHash(dispositionLink(disposition)), 'DISPOSITION_LINK_INVALID')
    } else {
      need(runtime.framework_state?.publish?.published !== true
        && !runtime.lockedAt && !isRuntimeLifecycleTruthImmutable(runtime.framework_state), 'PREPUBLICATION_TEST_RECEIPT_REQUIRED')
      if (kind === 'DISPOSITION') need(runtime.stateVersion === p.initialStateVersion
        && input.expectedUpdatedAt === basis.updatedAt && input.expectedBasisHash === basis.materialHash, 'STALE_DECISION_BASIS')
      else need(input.expectedPopulationHash === populationHash(basis, disposition), 'STALE_COMPLETION_BASIS')
    }
    let saved = existing
    if (!saved) {
      const body = membershipJson({ version: 1, classification: p.classification, authoritative: false,
        policyReference: p.reference, amendmentHash: p.amendmentHash, scopeBindingHash: p.scopeBindingHash,
        kind, receiptType: syntheticRevisionReceiptType(kind),
        receiptId: randomUUID(), requestKey: input.requestKey, payloadHash, createdAt: new Date().toISOString(),
        recorderUserId: p.recorderUserId, decisionMaker: { name: 'Angus Gregory', role: 'StorylineOS Product Owner',
          independent: false, dualRoleDisclosed: true, nativeUserId: null }, basis, input,
        dispositionLink: disposition ? dispositionLink(disposition) : null })
      const data = { ...syntheticRevisionScope(), kind, receiptId: body.receiptId, requestKey: input.requestKey,
        payloadHash, body, bodyHash: membershipHash(body) }
      const audit = await auditService.log({ actorUserId: args.actorUserId, action: 'RUNTIME_STATE_MUTATED',
        resourceType: 'RuntimeInstance', resourceId: runtime._id, scope: { ...syntheticRevisionScope(), runtimeInstanceKey: p.runtimeInstanceKey },
        requestId: input.requestKey, diff: auditDiff(data) }, { session, throwOnError: true })
      need(audit?._id && Audit.hydrate(audit.toObject ? audit.toObject() : audit).verifySignature(), 'AUDIT_WRITE_FAILED')
      const records = await Receipt.create([{ ...data, auditId: audit._id, auditSignatureVersion: audit.signatureVersion }], { session })
      need(records.length === 1, 'RECEIPT_WRITE_FAILED'); saved = records[0].toObject()
      await verify(saved, basis, session)
    }
    need((await runtimeCollection.updateOne({ ...filter, __v: runtime.__v + 1 }, { $inc: { __v: -1 } }, options(session))).modifiedCount === 1, 'FENCE_RESTORE_FAILED')
    return { receipt: dto(saved), replay: Boolean(existing) }
  })
}
export const recordSyntheticRevisionDisposition = record('DISPOSITION')
export const recordSyntheticRevisionCompletion = record('COMPLETION')

// These consumers never write a receipt, make a human decision or execute lock.
export const verifySyntheticRevisionForLock = async (runtime, session) => {
  if (!isSyntheticRevisionTestRuntime(runtime)) return null
  environment(); need(session?.inTransaction?.() === true, 'LOCK_TRANSACTION_REQUIRED')
  const current = await ownRuntime(session)
  need(current && String(current._id) === String(runtime._id || runtime.id)
    && current.stateVersion === runtime.stateVersion && current.framework_state?.publish?.published === true
    && current.framework_state?.lock?.locked !== true, 'PUBLISHED_CURRENT_RUNTIME_REQUIRED')
  const recorded = await (await import('./syntheticRecordedReviewLockService.js')).verifyRecordedSyntheticReviewForLock({ runtime: current, session })
  if (recorded) return recorded
  const basis = await compileSyntheticRevisionBasis(current, session)
  const disposition = await verify(await readRecord('DISPOSITION', session), basis, session)
  need(disposition.body.input.disposition === 'NOT_CONTRADICTORY', 'TEST_FINDING_BLOCKING')
  const completion = await verify(await readRecord('COMPLETION', session), basis, session)
  need(membershipHash(completion.body.dispositionLink) === membershipHash(dispositionLink(disposition)), 'DISPOSITION_LINK_INVALID')
  return { classification: p.classification, authoritative: false, policyReference: p.reference,
    disposition: dispositionLink(disposition), completion: dispositionLink(completion), materialHash: basis.materialHash }
}
export const verifySyntheticRevisionLockLink = async ({ runtime, audit, session }) => {
  if (!isSyntheticRevisionTestRuntime(runtime)) return
  environment()
  need(audit && Audit.hydrate(audit).verifySignature() && audit.action === 'RUNTIME_ACTION_EXECUTED'
    && audit.diff?.actionKey === 'LOCK_RECORD' && String(audit.resourceId) === p.runtimeInstanceId
    && ['customerId', 'tenantId', 'runtimeInstanceId'].every(key => String(audit.scope?.[key]) === p[key]), 'LOCK_AUDIT_INVALID')
  // Snapshot callers intentionally project only bounded runtime control. Fetch
  // the current full source internally; never assume the caller supplied it.
  const current = await ownRuntime(session)
  need(current && current.stateVersion === runtime.stateVersion && current.status === 'LOCKED'
    && current.framework_state?.lock?.locked === true, 'CURRENT_LOCKED_SOURCE_REQUIRED')
  const recorded = await (await import('./syntheticRecordedReviewLockService.js')).verifyRecordedSyntheticReviewForLock({ runtime: current, session, lockAudit: audit })
  if (recorded) return recorded
  const basis = await compileSyntheticRevisionBasis(current, session)
  const disposition = await verify(await readRecord('DISPOSITION', session), basis, session)
  need(disposition.body.input.disposition === 'NOT_CONTRADICTORY', 'TEST_FINDING_BLOCKING')
  const completion = await verify(await readRecord('COMPLETION', session), basis, session)
  const expected = { classification: p.classification, authoritative: false, policyReference: p.reference,
    disposition: dispositionLink(disposition), completion: dispositionLink(completion), materialHash: basis.materialHash }
  need(membershipHash(completion.body.dispositionLink) === membershipHash(expected.disposition)
    && membershipHash(audit.diff.syntheticTestCompletion) === membershipHash(expected), 'SIGNED_LOCK_LINK_INVALID')
}
