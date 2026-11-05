import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import Candidate from '../../models/OutcomeDocxRenditionCandidate.js'
import Preview from '../../models/OutcomeDocxPagePreview.js'
import Audit from '../../models/AuditLog.js'
import auditService from '../../services/auditService.js'
import { masterLinkedDocxFixture } from './masterLinkedDocxFixture.js'
import { createMasterLinkedPrivateDocxCandidate, readPrivateDocxCandidate } from '../../services/outcomeDocxCandidatePersistenceService.js'
import { createDocxPagePreview } from '../../services/outcomeDocxPagePreviewPersistenceService.js'

// Repeatable caller: externally guarded SS-055 proof worker, documented in the
// master-linked persistence contract. No automatic DB setup/reset/cleanup.
// All upstream source/master/pack/converter seams here are unsigned fixtures.
export const runMasterLinkedPersistenceCases = async ({ registerCase, recordCase }) => {
  const results = []
  const fresh = async name => {
    const f = await masterLinkedDocxFixture(new mongoose.Types.ObjectId().toString())
    registerCase({ name, sourceProof: 'UNSIGNED_STORAGE_FIXTURE', scope: f.scope, actorUserIds: [f.actorUserId],
      requestKeys: [f.payload.requestKey], masterReference: f.masterReceipt.masterReference,
      outputChecksum: f.bridge.artifact.outputChecksum, byteLength: f.bridge.buffer.length })
    const deps = { readSource: async () => f.envelope, readMaster: async () => f.masterReceipt,
      prepareMasterRendition: async () => f.bridge, loadPackContent: f.loadPackContent }
    return { ...f, args: { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, payload: f.payload, deps } }
  }
  const counts = async f => Promise.all([Candidate.countDocuments(f.scope), Preview.countDocuments(f.scope), Audit.countDocuments({
    'scope.runtimeInstanceId': new mongoose.Types.ObjectId(f.scope.runtimeInstanceId), action: { $in: ['OUTCOME_DOCX_CANDIDATE_CREATED', 'OUTCOME_DOCX_PAGE_PREVIEW_CREATED'] } })])
  const done = async (name, f, expected, extra = {}) => {
    assert.deepEqual(await counts(f), expected)
    const result = { name, status: 'PASS', sourceProof: 'UNSIGNED_STORAGE_FIXTURE', committedCandidates: expected[0], committedPreviews: expected[1], committedAudits: expected[2], ...extra }
    results.push(result); recordCase(result)
  }
  {
    const f = await fresh('candidate-audit-failure-rollback')
    f.args.deps.auditService = { async log(...args) { await auditService.log(...args); throw Error('INJECTED_AFTER_AUDIT') } }
    await assert.rejects(createMasterLinkedPrivateDocxCandidate(f.args), /INJECTED_AFTER_AUDIT/)
    await done('candidate-audit-failure-rollback', f, [0, 0, 0])
  }
  {
    const f = await fresh('candidate-pair-failure-rollback')
    f.args.deps.Candidate = { collection: Candidate.collection, db: Candidate.db, findOne: (...args) => Candidate.findOne(...args),
      async create(...args) { await Candidate.create(...args); throw Error('INJECTED_AFTER_PAIR') } }
    await assert.rejects(createMasterLinkedPrivateDocxCandidate(f.args), /INJECTED_AFTER_PAIR/)
    await done('candidate-pair-failure-rollback', f, [0, 0, 0])
  }
  {
    const f = await fresh('candidate-same-key-race-replay')
    const winners = await Promise.all([createMasterLinkedPrivateDocxCandidate(f.args), createMasterLinkedPrivateDocxCandidate(f.args)])
    assert.equal(winners[0].candidate.candidateId, winners[1].candidate.candidateId)
    const replay = await createMasterLinkedPrivateDocxCandidate(f.args)
    assert.equal(replay.idempotent, true);assert.deepEqual(replay.candidate, winners[0].candidate)
    const first = await readPrivateDocxCandidate({ ...f.args, candidateId: replay.candidate.candidateId, includeBytes: true })
    assert(first.buffer.equals(f.bridge.buffer))
    const changed = JSON.parse(JSON.stringify(f.masterReceipt));changed.masterReference.bodyFingerprint = 'f'.repeat(64)
    await assert.rejects(createMasterLinkedPrivateDocxCandidate({ ...f.args,
      payload: { ...f.payload, expectedMasterBodyFingerprint: 'f'.repeat(64) },
      deps: { ...f.args.deps, readMaster: async () => changed } }), error => error.details?.reason === 'CANDIDATE_REQUEST_KEY_CONFLICT')
    await done('candidate-same-key-race-replay', f, [1, 0, 1], { candidateId: replay.candidate.candidateId })
    const previewArgs = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, candidateId: replay.candidate.candidateId,
      payload: { expectedSourceFingerprint: f.envelope.sourceFingerprint, expectedOutputChecksum: f.bridge.artifact.outputChecksum },
      deps: { readCandidate: input => readPrivateDocxCandidate({ ...f.args, ...input, deps: f.args.deps }), readRuntime: async () => f.previewRuntime,
        renderPreview: async () => f.rendered } }
    const failed = { ...previewArgs, deps: { ...previewArgs.deps, auditService: {
      async log(...args) { await auditService.log(...args); throw Error('INJECTED_PREVIEW_AUDIT_FAILURE') } } } }
    await assert.rejects(createDocxPagePreview(failed), /INJECTED_PREVIEW_AUDIT_FAILURE/)
    await done('preview-audit-failure-rollback', f, [1, 0, 1])
    const previewWinners = await Promise.all([createDocxPagePreview(previewArgs), createDocxPagePreview(previewArgs)])
    assert.equal(previewWinners[0].preview.previewId, previewWinners[1].preview.previewId)
    const previewReplay = await createDocxPagePreview(previewArgs)
    assert.equal(previewReplay.idempotent, true)
    assert.equal(previewReplay.preview.masterBindingFingerprint, replay.candidate.masterBindingFingerprint)
    await done('preview-same-key-race-replay', f, [1, 1, 2], { previewId: previewReplay.preview.previewId })
  }
  return results
}
