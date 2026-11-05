import mongoose from 'mongoose'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Audit from '../models/AuditLog.js'
import Master from '../models/OutcomeMeaningSourceMaster.js'
import Candidate from '../models/OutcomeDocxRenditionCandidate.js'
import Preview from '../models/OutcomeDocxPagePreview.js'
import Plan from '../models/OutcomeKnowledgeCompositionPlan.js'
import auditService from './auditService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { prepareMasterLinkedDocxReviewTransport } from './outcomeMasterLinkedDocxReviewTransportService.js'
import { buildOpenAiMasterLinkedDocxReviewRequest } from './openAiMasterLinkedDocxReviewRequest.js'
import { readPrivateDocxCandidate } from './outcomeDocxCandidatePersistenceService.js'
import { createNetworkQaMasterLinkedReviewAuthority } from './masterLinkedGenuineReviewAuthorityService.js'
import { createGenuineMasterLinkedCompletedReviewStore } from './masterLinkedCompletedReviewService.js'
import { assertCompletedReviewArtifact } from './masterLinkedCompletedReviewContract.js'
import { G1_MODES } from './masterLinkedGenuineReviewContract.js'
import { assertMeaningMasterRecord, assertMeaningMasterAudit } from './outcomeMeaningSourceMasterContract.js'
import { assertPrivateDocxCandidateRecord, assertPrivateDocxCandidateAudit, privateDocxByteHash } from './outcomeDocxCandidateRecordContract.js'
import { assertDocxPagePreviewRecord, assertDocxPagePreviewAudit } from './outcomeDocxPagePreviewRecordContract.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity } from './outcomeKnowledgeCompositionPlanService.js'
import { TEST_RENDITION_PREFLIGHT_VERSION as version, TEST_RENDITION_PROBE_TYPE as type, TEST_RENDITION_PROBE_ACTION as action,
  testRenditionNeed as need, testRenditionExact as exact, testRenditionSame as same, testRenditionFalseFlags,
  assertTestRenditionDescriptor, testRenditionProbeFamily, assertTestRenditionProbeArtifact,
  testRenditionProbeAuditDiff, assertTestRenditionProbeAudit } from './masterLinkedTestRenditionContract.js'

const copy = value => JSON.parse(JSON.stringify(value)), raw = value => value?.toObject ? value.toObject({ depopulate: true }) : value
const database = 'ss044_1619d7db635949898c9abb4592d10bcf'
const owner = dependencies => {
  const deps = { Artifact, Audit, Master, Candidate, Preview, Plan, auditService,
    prepareTransport: prepareMasterLinkedDocxReviewTransport, readCandidate: readPrivateDocxCandidate,
    readQa: args => createNetworkQaMasterLinkedReviewAuthority().read(args),
    readGenuine: args => createGenuineMasterLinkedCompletedReviewStore().read(args),
    assertPlanIntegrity: assertOutcomeKnowledgeCompositionPlanIntegrity, ...dependencies }
  const verify = audit => deps.Audit.prototype.verifySignature.call(audit)
  const remaining = ctx => { const ms = ctx.deadline - Date.now(); need(ms > 0, 'PREFLIGHT_DEADLINE'); return ms }
  const read = async (ctx, model, filter, session, fields) => {
    remaining(ctx); let q = model.findOne(filter)
    if (fields) q = q.select(fields)
    q = session ? q.session(session) : q.setOptions({ timeoutMS: Math.min(3000, remaining(ctx)) })
    return q.lean()
  }
  const context = async input => {
    const keys = ['actorUserId', 'runtimeInstanceId', 'candidateId', 'scopes', 'expected', 'qaGrantExecutionId']
    need(exact(input, [...keys, ...(Object.hasOwn(input || {}, 'reviewGrantExecutionId') ? ['reviewGrantExecutionId'] : [])]), 'PREFLIGHT_INPUT')
    need(typeof input.qaGrantExecutionId === 'string' && /^master_docx_dispatch_[a-f0-9-]{36}$/.test(input.qaGrantExecutionId), 'QA_PARENT_REQUIRED')
    const args = copy(input), ctx = { args, deadline: Date.now() + 900000 }
    const transport = await deps.prepareTransport({ actorUserId: args.actorUserId, runtimeInstanceId: args.runtimeInstanceId,
      candidateId: args.candidateId, scopes: args.scopes })
    const request = buildOpenAiMasterLinkedDocxReviewRequest(transport).binding, b = transport.subject.binding
    need(same(request, args.expected) && transport.subject.actorUserId === args.actorUserId
      && b.masterReference.scope.runtimeInstanceId === args.runtimeInstanceId && b.candidateId === args.candidateId, 'PREFLIGHT_SUBJECT_CHANGED')
    const qa = await deps.readQa({ actorUserId: args.actorUserId, scopes: args.scopes, grantExecutionId: args.qaGrantExecutionId })
    need(qa.mode === G1_MODES.QA && qa.genuineReviewUsed === false && qa.genuineAttemptConsumed === false
      && qa.submissionState === 'KNOWN_RESPONSE', 'QA_PARENT_NOT_COMPLETE')
    for (const phase of ['GRANT', 'RESERVATION', 'START_OR_REVOKE']) {
      const record = qa.records?.[phase], body = record?.body
      need(body && body.phase === phase && body.mode === G1_MODES.QA && body.actorUserId === args.actorUserId
        && record.bodyFingerprint === membershipHash(body) && same(body.subject, transport.subject)
        && same(body.request, request), 'QA_PARENT_CHANGED')
    }
    need(qa.records.GRANT.body.executionId === args.qaGrantExecutionId
      && qa.records.START_OR_REVOKE.body.decision === 'START_ALLOWED', 'QA_PARENT_CHANGED')
    const file = await deps.readCandidate({ actorUserId: args.actorUserId, runtimeInstanceId: args.runtimeInstanceId,
      candidateId: args.candidateId, scopes: args.scopes, includeBytes: true })
    need(Buffer.isBuffer(file.buffer) && file.candidate.bodyFingerprint === b.candidateBodyFingerprint
      && privateDocxByteHash(file.buffer) === b.docxChecksum && file.buffer.length === file.candidate.artifact.byteLength, 'SOURCE_BYTES_CHANGED')
    let genuineReview = { state: 'GENUINE_REQUIRED', reference: null }
    if (args.reviewGrantExecutionId !== undefined) {
      need(typeof args.reviewGrantExecutionId === 'string' && /^master_docx_dispatch_[a-f0-9-]{36}$/.test(args.reviewGrantExecutionId), 'GENUINE_REFERENCE')
      const completed = await deps.readGenuine({ actorUserId: args.actorUserId, scopes: args.scopes, grantExecutionId: args.reviewGrantExecutionId })
      if (completed.completionConfirmed === true) {
        need(completed.mode === G1_MODES.GENUINE && completed.genuineReviewUsed === true
          && completed.sourceProof === 'STORED_SOURCE_RECORDS' && ['PASS', 'FAIL'].includes(completed.reviewStatus), 'GENUINE_REVIEW_REQUIRED')
        const artifact = await read(ctx, deps.Artifact, { runtimeArtifactId: completed.runtimeArtifactId })
        const material = assertCompletedReviewArtifact(artifact)
        need(same(material.input.subject, transport.subject) && same(material.input.binding, request)
          && material.input.grant.executionId === args.reviewGrantExecutionId, 'GENUINE_REVIEW_CHANGED')
        genuineReview = { state: completed.reviewStatus === 'PASS' ? 'GENUINE_PASS_APPROVAL_REQUIRED' : 'GENUINE_FAIL_HELD',
          reference: { kind: 'GENUINE_MASTER_LINKED_REVIEW', executionId: completed.executionId, runtimeArtifactId: completed.runtimeArtifactId,
            stageExecutionId: completed.stageExecutionId, resultFingerprint: completed.resultFingerprint } }
      } else need(completed.state === 'COMPLETED_REVIEW_NOT_RECORDED', 'GENUINE_REVIEW_UNCONFIRMED')
    }
    const reservation = qa.records.RESERVATION
    const descriptor = assertTestRenditionDescriptor({ contractVersion: version, classification: 'CONTROLLED_TEST_ONLY',
      actorUserId: args.actorUserId, scope: copy(b.masterReference.scope), subject: copy(transport.subject), request: copy(request),
      docx: { checksum: b.docxChecksum, byteLength: file.buffer.length },
      qaReservation: { executionId: reservation.body.executionId, bodyFingerprint: reservation.bodyFingerprint },
      genuineReview, approvalReference: null, ...testRenditionFalseFlags() })
    Object.assign(ctx, { descriptor, bytes: Buffer.from(file.buffer), runtime: copy(qa.records.GRANT.body.runtime),
      scope: descriptor.scope, binding: b, family: testRenditionProbeFamily(descriptor) }); remaining(ctx); return ctx
  }
  const sourceCheck = async (ctx, session) => {
    const b = ctx.binding, scope = ctx.scope
    const master = await read(ctx, deps.Master, { ...scope, _id: b.masterReference.storageId }, session)
    const candidate = await read(ctx, deps.Candidate, { ...scope, candidateId: b.candidateId }, session, '+fileBytes')
    const preview = await read(ctx, deps.Preview, { ...scope, previewId: b.previewId }, session, '+pageBytes')
    need(master && candidate && preview, 'SOURCE_RECORD_MISSING')
    const audits = {}
    for (const [key, row] of Object.entries({ master, candidate, preview })) audits[key] = await read(ctx, deps.Audit, { _id: row.auditId }, session)
    assertMeaningMasterRecord(master); assertMeaningMasterAudit(master, audits.master, verify)
    const bytes = assertPrivateDocxCandidateRecord(candidate); assertPrivateDocxCandidateAudit(candidate, audits.candidate, verify)
    assertDocxPagePreviewRecord(preview); assertDocxPagePreviewAudit(preview, audits.preview, verify)
    need(master.masterId === b.masterReference.masterId && master.bodyFingerprint === b.masterReference.bodyFingerprint
      && String(master.auditId) === b.masterReference.auditId && candidate.bodyFingerprint === b.candidateBodyFingerprint
      && bytes.equals(ctx.bytes) && preview.body.candidateBodyFingerprint === b.candidateBodyFingerprint
      && preview.docxChecksum === b.docxChecksum && preview.runtimeFingerprint === b.runtimeFingerprint
      && preview.body.conversionFingerprint === b.conversionFingerprint && same(preview.body.conversion.pages, b.pages), 'SOURCE_REFERENCES_CHANGED')
    const ref = master.body.sourceSnapshot.plan
    const plan = await read(ctx, deps.Plan, { ...scope, _id: ref.recordId, planId: ref.planId }, session)
    need(plan && Object.entries(ref).every(([key, value]) => String(key === 'recordId' ? plan._id : plan[key]) === String(value)), 'SOURCE_PLAN_CHANGED')
    await deps.assertPlanIntegrity(plan); remaining(ctx)
  }
  const metadata = row => {
    const descriptor = assertTestRenditionProbeArtifact(row)
    return { state: 'NONFINAL_TEST_PROBE_STORED', runtimeArtifactId: row.runtimeArtifactId,
      descriptor: copy(descriptor), descriptorFingerprint: membershipHash(descriptor), ...testRenditionFalseFlags() }
  }
  const find = (ctx, session) => read(ctx, deps.Artifact, { ...ctx.scope, _id: ctx.family.storageId }, session, '+testRenditionFileBytes')
  const verifyRow = async (ctx, row, session) => {
    need(row && same(assertTestRenditionProbeArtifact(row), ctx.descriptor), 'PROBE_CHANGED')
    assertTestRenditionProbeAudit(row, await read(ctx, deps.Audit, { _id: ctx.family.auditId }, session), verify)
    return metadata(row)
  }
  return Object.freeze({
    prepare: async args => { const ctx = await context(args); return { descriptor: copy(ctx.descriptor), descriptorFingerprint: membershipHash(ctx.descriptor) } },
    read: async args => { const ctx = await context(args); await sourceCheck(ctx); return verifyRow(ctx, await find(ctx)) },
    persist: async args => {
      need(!Object.hasOwn(args || {}, 'reviewGrantExecutionId'), 'PROBE_IS_PREFLIGHT_ONLY')
      const ctx = await context(args)
      need(deps.Artifact.db === deps.Audit.db && deps.Artifact.db.name === database, 'PROBE_DATABASE_OWNER')
      const indexes = await deps.Artifact.collection.indexes({ maxTimeMS: 3000 })
      need(indexes.some(index => index.unique === true && same(index.key, { runtimeArtifactId: 1 })), 'PROBE_INDEX_REQUIRED')
      const session = await deps.Artifact.db.startSession(); let calls = 0, replay = false
      try {
        await session.withTransaction(async () => {
          need(++calls <= 2, 'PROBE_TRANSACTION_ATTEMPTS'); await sourceCheck(ctx, session)
          const saved = await find(ctx, session)
          if (saved) { await verifyRow(ctx, saved, session); replay = true; return }
          const row = new deps.Artifact({ _id: new mongoose.Types.ObjectId(ctx.family.storageId), runtimeArtifactId: ctx.family.runtimeArtifactId,
            executionId: ctx.descriptor.qaReservation.executionId, ...ctx.scope, runtimeInstanceKey: ctx.runtime.runtimeInstanceKey,
            frameworkKey: ctx.runtime.frameworkKey, outputTypeKey: type, requestedOutputTypeKey: 'master-linked-test-rendition-probe',
            artifactType: type, status: 'GENERATED', contractVersion: version,
            generatedOutput: { contractVersion: version, descriptor: copy(ctx.descriptor), descriptorFingerprint: membershipHash(ctx.descriptor) },
            testRenditionFileBytes: Buffer.from(ctx.bytes), lineageSummary: { masterLinkedTestRendition: {
              auditId: ctx.family.auditId, auditSignatureVersion: 3 } }, generatedBy: ctx.args.actorUserId })
          const audit = raw(await deps.auditService.log({ _id: ctx.family.auditId, actorUserId: ctx.args.actorUserId,
            action, resourceType: 'GovernedRuntimeArtifact', resourceId: row._id, scope: ctx.scope,
            diff: testRenditionProbeAuditDiff(raw(row)), signatureVersion: 3 }, { session, throwOnError: true }))
          assertTestRenditionProbeAudit(raw(row), audit, verify); await row.save({ session })
          await verifyRow(ctx, await find(ctx, session), session)
        }, { timeoutMS: Math.min(50000, remaining(ctx)) })
      } finally { await session.endSession() }
      remaining(ctx); return { ...await verifyRow(ctx, await find(ctx)), idempotent: replay }
    },
  })
}
// Used by the exact-candidate pre-dispatch worker. Neither factory dispatches,
// approves or creates a final asset; QA seams cannot enter the genuine stores.
export const createMasterLinkedTestRenditionPreflight = (...args) => { need(args.length === 0, 'PREFLIGHT_OVERRIDES_FORBIDDEN'); return owner({}) }
export const createQaMasterLinkedTestRenditionPreflight = (dependencies = {}) => owner(dependencies)
