import mongoose from 'mongoose'
import RuntimeInstance from '../models/RuntimeInstance.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import AuditLog from '../models/AuditLog.js'
import { readVerifiedPostLockImpactContext } from './postLockImpactDecisionService.js'
import { assertPostLockRecordingBinding } from './postLockEvidenceIntakeContract.js'
import { attachNativeControlledReplayIsolation, assertNoControlledReplayIsolation } from './controlledReplayIsolationService.js'
import { generateChecksum } from './governanceAudit/checksumService.js'
import { membershipJson, membershipHash, buildPublishedEvidenceMembershipManifest,
  EVIDENCE_MEMBER_LIMITS } from './runtimeEvidenceSnapshotContract.js'
import { normalizeDiscoveryEvidenceObjects, buildDiscoverySourceRegistry } from './discoveryIntelligenceService.js'
import { createSectionHistoryReadContext } from './runtimeSectionHistoryContract.js'
import { parsePostLockAdmissionRequest, parsePostLockAdmissionReceipt, postLockAdmissionError,
  postLockAdmissionId, postLockRevisionAdmissionOperationHash, buildPostLockSuccessorCandidatePlan,
  assertPostLockAdmissionReceiptOrigin, projectPostLockOrigin,
  assertPostLockOriginPairs, validPostLockAdmissionRow, validPostLockRevisionAdmission } from './postLockSuccessorAdmissionContract.js'

const equal = (left, right) => left === undefined || right === undefined
  ? left === right : generateChecksum(left) === generateChecksum(right)
const options = session => ({ session, maxTimeMS: 2000 })
const requireValue = (condition, reason = 'POST_LOCK_ADMISSION_READBACK_INVALID', status = 503) => {
  if (!condition) throw postLockAdmissionError(reason, status)
}
const read = async work => {
  try { return await work() }
  catch (error) {
    if ((error.status && error.code) || error.hasErrorLabel?.('TransientTransactionError')) throw error
    throw postLockAdmissionError('POST_LOCK_ADMISSION_READ_UNAVAILABLE', 503)
  }
}
export const assertPostLockRevisionIndexes = async () => {
  requireValue(mongoose.connection.readyState === 1, 'POST_LOCK_ADMISSION_STORAGE_UNAVAILABLE')
  const indexes = await read(() => RuntimeInstance.collection.indexes())
  requireValue(indexes.some(index => index.unique === true
    && equal(index.key, { customerId: 1, tenantId: 1, 'revision.parentRuntimeId': 1 })
    && equal(index.partialFilterExpression, { 'revision.parentRuntimeId': { $type: 'objectId' } })
    && (!index.collation || index.collation.locale === 'simple')), 'POST_LOCK_ADMISSION_INDEX_REQUIRED')
}
export const readPostLockRevisionAdmissionContext = async (args, session) => {
  requireValue(session?.inTransaction?.() === true, 'POST_LOCK_ADMISSION_STORAGE_UNAVAILABLE')
  const request = parsePostLockAdmissionRequest(args.payload.postLockAdmission)
  const operationPayloadHash = postLockRevisionAdmissionOperationHash({ ...args.payload, actorUserId: String(args.actorUserId) })
  const ctx = await read(() => readVerifiedPostLockImpactContext({ ...args, submissionId: request.submissionId }, session))
  const sourceRuntimeInstance = await read(() => RuntimeInstance.findOne({ _id: ctx.scope.runtimeInstanceId,
    customerId: ctx.scope.customerId, tenantId: ctx.scope.tenantId }).setOptions(options(session)).lean())
  requireValue(sourceRuntimeInstance && String(sourceRuntimeInstance._id) === ctx.runtime.id
    && sourceRuntimeInstance.stateVersion === ctx.runtime.stateVersion, 'POST_LOCK_ADMISSION_STALE', 409)
  await attachNativeControlledReplayIsolation(sourceRuntimeInstance, { session, maxTimeMS: 2000 })
  assertNoControlledReplayIsolation(sourceRuntimeInstance)
  const sourceRow = await read(() => RuntimeEvidenceSource.collection.findOne({ ...ctx.scope, current: false,
    stateVersion: ctx.submission.binding.basisStateVersion, sourceId: `post-lock-source:${request.submissionId}` }, options(session)))
  requireValue(sourceRow, 'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
  const child = await read(() => RuntimeInstance.findOne({ customerId: ctx.scope.customerId, tenantId: ctx.scope.tenantId,
    'revision.parentRuntimeId': sourceRuntimeInstance._id }).setOptions(options(session)).lean())
  return { ...ctx, request, operationPayloadHash, sourceRuntimeInstance, sourceRow, child, actorUserId: String(args.actorUserId) }
}
export const requirePostLockRevisionAdmissionPolicy = async (ctx, session) => {
  const frameworkPackage = await read(() => FrameworkPackage.findOne({ _id: ctx.sourceRuntimeInstance.packageId })
    .setOptions(options(session)).lean())
  const policyHash = assertPostLockRecordingBinding({ frameworkPackage, runtime: ctx.sourceRuntimeInstance, operation: 'admission' })
  requireValue(policyHash === ctx.submission.binding.policyHash, 'POST_LOCK_ADMISSION_POLICY_UNAVAILABLE', 409)
  return frameworkPackage
}
const memberScope = runtime => ({ customerId: runtime.customerId, tenantId: runtime.tenantId,
  runtimeInstanceId: runtime._id, runtimeInstanceKey: runtime.runtimeInstanceKey })
const models = [[RuntimeEvidenceSource, 'sources'], [RuntimeEvidenceObject, 'evidence'], [RuntimeStateSection, 'sections']]
const readInitialMembers = async (runtime, session) => Object.fromEntries(await Promise.all(models.map(async ([model, family]) => {
  const rows = await read(() => model.find({ ...memberScope(runtime), stateVersion: runtime.stateVersion })
    .setOptions(options(session)).limit(EVIDENCE_MEMBER_LIMITS[family] + 1).lean())
  requireValue(rows.length <= EVIDENCE_MEMBER_LIMITS[family], 'POST_LOCK_ADMISSION_READ_UNAVAILABLE')
  return [family, rows]
})))
const initialBasis = (runtime, rows) => {
  // Initial versions remain readable after a later normal rollover. current is
  // housekeeping excluded by the material hash; this is historical reconstruction,
  // never a claim those rows are still current or the draft is published/locked.
  const manifest = buildPublishedEvidenceMembershipManifest({ runtime,
    ...Object.fromEntries(Object.entries(rows).map(([family, values]) => [family, values.map(row => ({ ...row, current: true }))])) })
  return { fingerprintVersion: 'post-lock-successor-initial-basis.v1', manifestContractVersion: manifest.contractVersion,
    basisStateVersion: runtime.stateVersion, membershipHash: membershipHash(manifest), scope: manifest.scope,
    package: manifest.package, counts: manifest.counts }
}
export const stagePostLockSuccessorCandidates = ({ ctx, child, auditId, auditSignatureVersion, admittedAt }) => {
  const plan = buildPostLockSuccessorCandidatePlan({ request: ctx.request, sourceRow: ctx.sourceRow, evidenceRow: ctx.row,
    target: { runtimeInstanceId: String(child._id), runtimeInstanceKey: child.runtimeInstanceKey, stateVersion: child.stateVersion },
    admission: { actorUserId: ctx.actorUserId, admittedAt, auditId: String(auditId), auditSignatureVersion } })
  const pack = child.framework_state.evidence_pack || {}, oldSources = pack.sourceRegistry || [], oldEvidence = pack.evidenceObjects || []
  requireValue(Array.isArray(oldSources) && Array.isArray(oldEvidence)
    && !oldSources.some(row => row.sourceId === plan.source.sourceId)
    && !oldEvidence.some(row => row.evidenceObjectId === plan.evidence.evidenceObjectId), 'POST_LOCK_ADMISSION_MATERIAL_INVALID')
  const lineage = pack.lineage || {}, lineageSources = lineage.sources || []
  requireValue(Array.isArray(lineageSources) && !lineageSources.some(row => row.sourceId === plan.source.sourceId))
  const sources = [...oldSources, plan.source], evidence = [...oldEvidence, plan.evidence]
  const normalized = normalizeDiscoveryEvidenceObjects({ evidenceObjects: evidence, sourceRegistry: sources,
    sources: [...lineageSources, plan.source] })
  const registry = buildDiscoverySourceRegistry({ sourceRegistry: sources, sources: [...lineageSources, plan.source], evidenceObjects: normalized })
  child.framework_state.evidence_pack = { ...pack, sourceRegistry: registry, evidenceObjects: normalized,
    lineage: { ...lineage, sources: [...lineageSources, membershipJson(plan.source)] }, accepted: false, evidenceReady: false,
    needsRefresh: true, reviewSummary: { ...(pack.reviewSummary || {}), pendingReviewCount: normalized.filter(row => row.reviewStatus === 'PENDING').length } }
  child.markModified('framework_state.evidence_pack')
  return plan
}
export const createPostLockAdmissionReceipt = async ({ args, ctx, child, plan, session }) => {
  const basis = initialBasis(child, await readInitialMembers(child, session)), admission = plan.source.postLockOrigin.admission
  return parsePostLockAdmissionReceipt({ contractVersion: 'post-lock-admission-receipt.v1', admissionId: plan.admissionId,
    requestKey: ctx.request.requestKey, nestedRequestPayloadHash: plan.payloadHash, operationPayloadHash: ctx.operationPayloadHash,
    request: ctx.request, expectedUpdatedAt: args.payload.expectedUpdatedAt, revisionReason: String(args.payload.reason || '').trim(),
    actorUserId: String(args.actorUserId), admittedAt: admission.admittedAt, target: admission.target,
    originHash: generateChecksum(plan.source.postLockOrigin), auditId: admission.auditId,
    auditSignatureVersion: admission.auditSignatureVersion, basis })
}
export const fencePostLockAdmission = async (ctx, receipt, session) => {
  requireValue(validPostLockAdmissionRow({ ...ctx.row, postLockAdmission: receipt }), 'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
  const changed = await RuntimeEvidenceObject.collection.updateOne({ _id: ctx.row._id, ...ctx.scope,
    runtimeInstanceKey: ctx.runtime.runtimeInstanceKey, stateVersion: ctx.submission.binding.basisStateVersion, current: false,
    'postLockAssociation.requestDigest': ctx.submission.requestDigest, 'postLockImpactHistory.headHash': ctx.request.expectedImpactHeadHash,
    postLockAdmission: { $exists: false } }, { $set: { postLockAdmission: receipt } }, { session })
  requireValue(changed.matchedCount === 1, 'POST_LOCK_ADMISSION_STALE', 409)
}
const historicalRuntime = receipt => ({ _id: new mongoose.Types.ObjectId(receipt.target.runtimeInstanceId),
  ...receipt.basis.package, ...receipt.basis.scope, stateVersion: receipt.target.stateVersion,
  revision: { revisionNumber: receipt.basis.scope.revisionNumber,
    rootRuntimeId: receipt.basis.scope.rootRuntimeInstanceId, rootRuntimeInstanceKey: receipt.basis.scope.rootRuntimeInstanceKey } })
export const verifyPostLockAdmissionReadback = async ({ ctx, child, receipt: input, session, fresh = false }) => {
  const receipt = parsePostLockAdmissionReceipt(input)
  const actualChild = await read(() => RuntimeInstance.findOne({ _id: child._id, customerId: ctx.scope.customerId,
    tenantId: ctx.scope.tenantId }).setOptions(options(session)).lean())
  const pending = await read(() => RuntimeEvidenceObject.collection.findOne({ _id: ctx.row._id, ...ctx.scope }, options(session)))
  requireValue(actualChild && pending && validPostLockRevisionAdmission(actualChild)
    && validPostLockAdmissionRow(pending) && equal(actualChild.revision.postLockAdmission, receipt)
    && equal(pending.postLockAdmission, receipt), 'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
  const historical = historicalRuntime(receipt), rows = await readInitialMembers(historical, session)
  let observedBasis
  try { observedBasis = initialBasis(historical, rows) }
  catch { throw postLockAdmissionError('POST_LOCK_ADMISSION_READBACK_INVALID', 503) }
  requireValue(equal(observedBasis, receipt.basis))
  try {
    await createSectionHistoryReadContext({ session, readRows: (filter, budget) => read(() => RuntimeStateSection.find(filter)
      .setOptions({ session, maxTimeMS: budget.maxTimeMS }).limit(budget.limit).lean()) }).verify(rows.sections)
  } catch (error) {
    if (error.hasErrorLabel?.('TransientTransactionError') || error.details?.reason === 'POST_LOCK_ADMISSION_READ_UNAVAILABLE') throw error
    throw postLockAdmissionError('POST_LOCK_ADMISSION_READBACK_INVALID', 503)
  }
  assertPostLockOriginPairs({ sources: rows.sources, evidenceObjects: rows.evidence })
  const sourceId = `post-lock-source:${receipt.request.submissionId}`, evidenceId = `post-lock:${receipt.request.submissionId}`
  const source = rows.sources.find(row => row.sourceId === sourceId), evidence = rows.evidence.find(row => row.evidenceObjectId === evidenceId)
  requireValue(source && evidence)
  const origin = projectPostLockOrigin(source, 'source').postLockOrigin
  requireValue(origin && equal(origin, projectPostLockOrigin(evidence, 'evidence').postLockOrigin))
  assertPostLockAdmissionReceiptOrigin(receipt, origin)
  if (fresh) {
    requireValue(rows.sources.every(row => row.current === true) && rows.evidence.every(row => row.current === true)
      && rows.sections.every(row => row.current === true) && actualChild.stateVersion === receipt.target.stateVersion
      && actualChild.framework_state?.readiness?.ready === false && actualChild.framework_state?.publish?.published === false
      && actualChild.framework_state?.lock?.locked === false && actualChild.framework_state.evidence_pack.accepted === false
      && actualChild.framework_state.evidence_pack.evidenceReady === false)
    const root = actualChild.framework_state.evidence_pack
    const rootSource = root.sourceRegistry?.find(row => row.sourceId === sourceId), rootEvidence = root.evidenceObjects?.find(row => row.evidenceObjectId === evidenceId)
    requireValue(rootSource && rootEvidence && equal(projectPostLockOrigin(rootSource, 'source'), projectPostLockOrigin(source, 'source'))
      && equal(projectPostLockOrigin(rootEvidence, 'evidence'), projectPostLockOrigin(evidence, 'evidence')))
  }
  const audit = await read(() => AuditLog.findById(receipt.auditId).setOptions(options(session)))
  requireValue(audit && audit.action === 'RUNTIME_REVISION_CREATED' && audit.resourceType === 'RuntimeInstance'
    && String(audit.resourceId) === receipt.target.runtimeInstanceId && String(audit.actorUserId) === receipt.actorUserId
    && ['customerId', 'tenantId'].every(key => String(audit.scope?.[key]) === String(ctx.scope[key]))
    && String(audit.scope?.runtimeInstanceId) === receipt.target.runtimeInstanceId
    && String(audit.diff?.sourceRuntimeInstance?.id) === String(ctx.scope.runtimeInstanceId)
    && audit.signatureVersion === receipt.auditSignatureVersion && equal(audit.diff?.postLockAdmission, receipt)
    && audit.verifySignature(), 'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
  return actualChild
}
// This exact-item view verifies retained receipts and the child control link.
// It deliberately does not rebuild the child's initial or current evidence basis.
export const readHistoricalPostLockAdmission = async (ctx, session, { readBudget } = {}) => {
  const queryOptions = () => ({ ...options(session), ...(readBudget ? readBudget() : {}) })
  const children = await RuntimeInstance.find({ customerId: ctx.scope.customerId, tenantId: ctx.scope.tenantId,
    'revision.parentRuntimeId': ctx.scope.runtimeInstanceId })
    .select('_id runtimeInstanceKey customerId tenantId revision.parentRuntimeId revision.parentRuntimeInstanceKey revision.revisionNumber revision.createdFromRevision revision.rootRuntimeId revision.rootRuntimeInstanceKey revision.postLockAdmission')
    .setOptions(queryOptions()).limit(2).lean()
  if (readBudget) readBudget.check()
  const result = admission => ({ admission, childExists: children.length > 0 })
  const unverified = reason => result({ state: 'UNVERIFIED', verification: { status: 'UNVERIFIED', reason }, initialBasis: null })
  const notRecorded = () => result({ state: 'NOT_RECORDED',
    verification: { status: 'NOT_APPLICABLE', reason: null }, initialBasis: null })
  if (children.length > 1) return unverified('POST_LOCK_ADMISSION_CHILD_AMBIGUOUS')
  const child = children[0], present = Object.hasOwn(ctx.row, 'postLockAdmission')
  if (!present) {
    if (child?.revision && Object.hasOwn(child.revision, 'postLockAdmission')) {
      try {
        if (parsePostLockAdmissionReceipt(child.revision.postLockAdmission).request.submissionId === ctx.submission.submissionId) {
          return unverified('POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
        }
      } catch { return unverified('POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED') }
    }
    return notRecorded()
  }
  if (!validPostLockAdmissionRow(ctx.row)) return unverified('POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
  const receipt = parsePostLockAdmissionReceipt(ctx.row.postLockAdmission)
  if (!child) return unverified('POST_LOCK_ADMISSION_CHILD_UNAVAILABLE')
  if (!validPostLockRevisionAdmission(child, { initial: false })
    || !equal(child.revision.postLockAdmission, receipt)) return unverified('POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
  const selected = ctx.history.entries.find(entry => entry.decisionHash === receipt.request.expectedImpactHeadHash)
  if (!selected || selected.disposition !== 'SUCCESSOR_REVISION_REQUIRED' || ctx.verification?.verified !== true) {
    return unverified('POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
  }
  const audit = await AuditLog.findById(receipt.auditId).setOptions(queryOptions()).lean()
  if (readBudget) readBudget.accountAuditRows(audit ? [audit] : [])
  if (!audit) return unverified('POST_LOCK_ADMISSION_AUDIT_NOT_RECORDED')
  if (!(audit.action === 'RUNTIME_REVISION_CREATED' && audit.resourceType === 'RuntimeInstance'
    && String(audit.resourceId) === receipt.target.runtimeInstanceId && String(audit.actorUserId) === receipt.actorUserId
    && ['customerId', 'tenantId'].every(key => String(audit.scope?.[key]) === String(ctx.scope[key]))
    && String(audit.scope?.runtimeInstanceId) === receipt.target.runtimeInstanceId
    && String(audit.diff?.sourceRuntimeInstance?.id) === String(ctx.scope.runtimeInstanceId)
    && audit.signatureVersion === receipt.auditSignatureVersion && equal(audit.diff?.postLockAdmission, receipt)
    && AuditLog.hydrate(audit).verifySignature())) return unverified('POST_LOCK_ADMISSION_AUDIT_UNVERIFIED')
  if (readBudget) readBudget.check()
  return result({ state: 'RECORDED', verification: { status: 'VERIFIED', reason: null },
    admissionId: receipt.admissionId, admittedAt: receipt.admittedAt, actorUserId: receipt.actorUserId,
    rationale: receipt.request.rationale,
    selectedDecision: { decisionId: selected.decisionId, decisionHash: selected.decisionHash,
      sequence: selected.sequence, disposition: selected.disposition },
    child: { runtimeInstanceId: receipt.target.runtimeInstanceId, runtimeInstanceKey: receipt.target.runtimeInstanceKey,
      revisionNumber: child.revision.revisionNumber },
    receipt: { auditId: receipt.auditId, signatureVersion: receipt.auditSignatureVersion },
    initialBasis: { status: 'NOT_REVALIDATED', basisStateVersion: receipt.basis.basisStateVersion,
      membershipHash: receipt.basis.membershipHash } })
}
export const readPostLockAdmissionReplay = async (ctx, session) => {
  const pendingReceipt = ctx.row.postLockAdmission
  if (!ctx.child) { requireValue(pendingReceipt === undefined, 'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED'); return null }
  if (!ctx.child.revision?.postLockAdmission) throw postLockAdmissionError('POST_LOCK_ADMISSION_CHILD_EXISTS', 409)
  const receipt = parsePostLockAdmissionReceipt(ctx.child.revision.postLockAdmission)
  if (receipt.requestKey !== ctx.request.requestKey) throw postLockAdmissionError(
    receipt.request.submissionId === ctx.request.submissionId ? 'POST_LOCK_ADMISSION_IDEMPOTENCY_CONFLICT' : 'POST_LOCK_ADMISSION_CHILD_EXISTS', 409)
  requireValue(receipt.operationPayloadHash === ctx.operationPayloadHash
    && receipt.admissionId === postLockAdmissionId(ctx.request), 'POST_LOCK_ADMISSION_IDEMPOTENCY_CONFLICT', 409)
  requireValue(pendingReceipt !== undefined, 'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
  const child = await verifyPostLockAdmissionReadback({ ctx, child: ctx.child, receipt, session })
  return { child, receipt }
}
