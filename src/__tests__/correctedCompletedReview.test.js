import { jest } from '@jest/globals'
import fs from 'node:fs'
import mongoose from 'mongoose'
import Execution from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { G1_MODES, g1SubjectRoot, assertG1FixedSubject } from '../services/masterLinkedGenuineReviewContract.js'
import { createNetworkQaMasterLinkedCompletedReviewStore } from '../services/masterLinkedCompletedReviewService.js'
import { CORRECTED_COMPLETED_REVIEW_VERSION, CORRECTED_COMPLETED_ARTIFACT_VERSION, COMPLETED_REVIEW_VERSION,
  completedReviewFamily, completedReviewKey, completedReviewProfile, assertCompletedReviewInput, buildCompletedReviewStage,
  completedStageReference, assertCompletedReviewResult, assertCompletedReviewArtifact, assertCompletedReviewStage,
  hasCompletedReviewIdentity, hasCompletedArtifactIdentity, hasCompletedStageIdentity,
  completedResultFilter, completedArtifactFilter, completedStageFilter, carriesCompletedReviewValue } from '../services/masterLinkedCompletedReviewContract.js'
import { CORRECTED_MASTER_LINKED_REVIEW_STAGE_VERSION, CORRECTED_MASTER_LINKED_REVIEW_STAGE_KEY, originalOutcomeQualityStageFilter } from '../utils/outcomeQualityStageSubjects.js'
import { visualReviewOutput } from './fixtures/docxVisualReviewFixture.js'

const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/correctedReviewSubject.json', import.meta.url)))
const clone = v => JSON.parse(JSON.stringify(v))
const connect = jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect').mockRejectedValue(Error('LIVE_DATABASE_FORBIDDEN'))
const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(Error('REAL_PROVIDER_FORBIDDEN'))
afterAll(() => { expect(connect).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); connect.mockRestore(); fetch.mockRestore() })
// Exact retained subject metadata, but invented references/receipt for pure
// contract/model checks only. No source admission, authority or ownership.
const inputFixture = () => {
  const subject = clone(metadata.subject), binding = clone(metadata.request), b = subject.binding
  const onceRoot = g1SubjectRoot(subject, binding, G1_MODES.QA, 'ss055-release-proof-corrected-unit')
  const family = completedReviewFamily(onceRoot), phase = n => ({ executionId: `master_docx_dispatch_00000000-0000-4000-8000-00000000000${n}`, bodyFingerprint: String(n).repeat(64) })
  const grant = phase(1), reservation = phase(2), start = phase(3)
  const identity = { responseId: 'resp_corrected_findings_unit', postRequestId: 'req_unit', provider: 'OPENAI', model: 'gpt-5.2', accountFingerprint: '4'.repeat(64) }
  const source = (storageId, bodyFingerprint, auditId) => ({ storageId, bodyFingerprint, auditId, auditSignatureVersion: 3 })
  return { version: CORRECTED_COMPLETED_REVIEW_VERSION, mode: G1_MODES.QA, sourceProof: 'STORED_SOURCE_RECORDS', scope: clone(b.masterReference.scope),
    actorUserId: subject.actorUserId, onceRoot, qaCase: 'ss055-release-proof-corrected-unit',
    plan: { recordId: '5'.repeat(24), planId: 'unit-corrected-findings', requestId: 'unit-request', planVersion: 1,
      planFingerprint: '6'.repeat(64), resolutionFingerprint: '7'.repeat(64), contextFingerprint: '8'.repeat(64) },
    runtime: { runtimeInstanceKey: 'unit-corrected-findings', runtimeType: 'VMF', frameworkKey: 'VMF', packageKey: 'unit', packageVersion: '1.0.0' },
    subject, binding, grant, reservation, start,
    response: { auditId: '9'.repeat(24), signatureVersion: 3, diffFingerprint: 'a'.repeat(64), identity },
    sourceRecords: { master: source(b.masterReference.storageId, b.masterReference.bodyFingerprint, b.masterReference.auditId),
      candidate: source('b'.repeat(24), b.candidateBodyFingerprint, 'c'.repeat(24)), preview: source('d'.repeat(24), 'e'.repeat(64), 'f'.repeat(24)) },
    result: family.result, audits: family.audits,
    receipt: { version: 'master-linked-docx-visual-review-receipt.v2', mode: G1_MODES.QA, ...binding,
      responseId: identity.responseId, postRequestId: identity.postRequestId, grant, reservation, start,
      provider: clone(subject.transport), returnedModel: 'gpt-5.2', terminalStatus: 'completed', latencyMs: 10,
      pages: clone(b.pages), inputFingerprint: b.inputFingerprint, docxChecksum: b.docxChecksum,
      tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null }, storeRequested: false, temporaryProviderStorageForPolling: true },
    startedAt: '2026-11-03T00:00:00.000Z', completedAt: '2026-11-03T00:00:00.010Z' }
}
const bundleFixture = (failed = false) => {
  const input = inputFixture(), family = completedReviewFamily(input.onceRoot), output = visualReviewOutput(failed)
  const stage = { _id: new mongoose.Types.ObjectId(family.rowIds.stage), ...buildCompletedReviewStage(input, output) }, stageRef = completedStageReference(stage)
  const artifactBody = { version: CORRECTED_COMPLETED_ARTIFACT_VERSION, input, stage: stageRef, outputFingerprint: stage.outputFingerprint }
  const artifact = { _id: new mongoose.Types.ObjectId(family.rowIds.artifact), ...input.scope, runtimeArtifactId: input.result.runtimeArtifactId,
    executionId: input.result.executionId, runtimeInstanceKey: input.runtime.runtimeInstanceKey, frameworkKey: input.runtime.frameworkKey,
    outputTypeKey: 'MASTER_LINKED_DOCX_REVIEW', requestedOutputTypeKey: 'master-linked-docx-review-result', artifactType: 'MASTER_LINKED_DOCX_REVIEW_FINDINGS',
    status: 'GENERATED', contractVersion: CORRECTED_COMPLETED_ARTIFACT_VERSION, generatedOutput: output,
    lineageSummary: { masterLinkedCompletedReview: { body: artifactBody, bodyFingerprint: membershipHash(artifactBody), audit: input.audits.artifact } },
    safeJson: {}, markdown: '', certification: {}, warnings: [], limitations: [], generatedBy: input.actorUserId, generatedAt: input.completedAt }
  const resultBody = { version: input.version, input, reviewStatus: output.overallStatus, stage: stageRef,
    artifact: { runtimeArtifactId: artifact.runtimeArtifactId, bodyFingerprint: membershipHash(artifactBody) }, approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false }
  const result = { _id: new mongoose.Types.ObjectId(family.rowIds.result), ...input.scope, ...input.runtime, executionId: input.result.executionId,
    workspaceType: 'PLATFORM', outputTypeKey: 'MASTER_LINKED_DOCX_REVIEW', requestedOutputTypeKey: 'master-linked-docx-review-result',
    executionIntent: 'Record exact completed master-linked review findings without approval.', idempotencyKey: completedReviewKey(input.onceRoot),
    requestFingerprint: input.binding.requestIdentity, status: 'MASTER_DOCX_REVIEW_COMPLETED', contractVersion: input.version,
    providerMode: 'DETERMINISTIC_TEST', provider: { mode: input.mode, provenance: 'NETWORK_QA', state: 'COMPLETED', receipt: input.receipt },
    reasoningContext: { approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false },
    executionEvidence: { masterLinkedCompletedReview: { body: resultBody, bodyFingerprint: membershipHash(resultBody) } },
    artifactIds: [artifact.runtimeArtifactId], auditLogIds: ['result', 'artifact', 'stage'].map(k => input.audits[k].id),
    knowledgeManifest: {}, knowledgeBinding: {}, certifiedTruth: {}, runtimeStateWrites: {}, warnings: [], limitations: [],
    requestedBy: input.actorUserId, requestedAt: input.startedAt, completedAt: input.completedAt, failureReason: null }
  return { input, result, artifact, stage }
}

test.each([false, true])('corrected PASS/FAIL=%s keeps distinct v3 model family and held delivery', async failed => {
  const f = bundleFixture(failed)
  assertCompletedReviewResult(f.result); assertCompletedReviewArtifact(f.artifact); assertCompletedReviewStage(f.stage)
  await new Execution(f.result).validate(); await new Artifact(f.artifact).validate(); await new Stage(f.stage).validate()
  expect(f.stage.contractVersion).toBe(CORRECTED_MASTER_LINKED_REVIEW_STAGE_VERSION)
  expect(f.stage.stageKey).toBe(CORRECTED_MASTER_LINKED_REVIEW_STAGE_KEY)
  expect(f.stage.status).toBe(failed ? 'FAILED' : 'SUCCEEDED'); expect(f.result.reasoningContext.approvalAvailable).toBe(false)
  if (failed) expect(f.stage.failure.retryable).toBe(false)
})
test.each(['v2', 'genuine', 'in-memory', 'root', 'actor', 'tenant', 'candidate', 'page', 'pack', 'parent', 'policy', 'receipt', 'reference', 'family'])(
  'corrected input rejects %s', kind => {
    const input = inputFixture()
    if (kind === 'v2') input.version = COMPLETED_REVIEW_VERSION
    if (kind === 'genuine') input.mode = G1_MODES.GENUINE
    if (kind === 'in-memory') input.sourceProof = 'SIGNED_IN_MEMORY_TEST_FIXTURE'
    if (kind === 'root') input.onceRoot = input.onceRoot.replace('CORRECTED_', '')
    if (kind === 'actor') input.actorUserId = 'a'.repeat(24)
    if (kind === 'tenant') input.scope.tenantId = 'a'.repeat(24)
    if (kind === 'candidate') input.subject.binding.candidateId += '-other'
    if (kind === 'page') input.subject.binding.pages[0].sha256 = 'b'.repeat(64)
    if (kind === 'pack') input.subject.packs.STYLE.contentHash = 'sha256:' + 'b'.repeat(64)
    if (kind === 'parent') input.subject.binding.correctionReference.predecessor.failedReviewResultFingerprint = 'b'.repeat(64)
    if (kind === 'policy') input.subject.policy.dispatchAvailable = true
    if (kind === 'receipt') input.receipt.docxChecksum = 'sha256:' + 'b'.repeat(64)
    if (kind === 'reference') input.sourceRecords.candidate.bodyFingerprint = 'b'.repeat(64)
    if (kind === 'family') input.audits.stage.id = 'b'.repeat(24)
    expect(() => assertCompletedReviewInput(input)).toThrow()
  })
test('corrected subject cannot become genuine authority or accept caller-created result ownership', async () => {
  const input = inputFixture()
  expect(completedReviewProfile(input.subject, G1_MODES.GENUINE).stageKey).toBe('MASTER_LINKED_CORRECTED_RENDITION_RL')
  expect(() => assertG1FixedSubject(input.subject, input.binding)).toThrow()
  await expect(createNetworkQaMasterLinkedCompletedReviewStore().persist({ actorUserId: input.actorUserId, scopes: {}, providerResult: { receipt: input.receipt } })).rejects.toThrow()
})
test('original chain excludes only the two exact corrected stage tuples', () => {
  const clauses = originalOutcomeQualityStageFilter({}).$and[1].$nor
  expect(clauses).toContainEqual({ $expr: { $and: [{ $eq: ['$contractVersion', CORRECTED_MASTER_LINKED_REVIEW_STAGE_VERSION] }, { $eq: ['$stageKey', CORRECTED_MASTER_LINKED_REVIEW_STAGE_KEY] }] } })
  expect(clauses.filter(c => c.$expr.$and[0].$eq[1] === CORRECTED_MASTER_LINKED_REVIEW_STAGE_VERSION)).toHaveLength(2)
  expect(clauses).toContainEqual({ $expr: { $and: [{ $eq: ['$contractVersion', CORRECTED_MASTER_LINKED_REVIEW_STAGE_VERSION] }, { $eq: ['$stageKey', 'MASTER_LINKED_CORRECTED_RENDITION_RL'] }] } })
})
test.each(['stage-version', 'stage-key', 'provider-version', 'artifact-version', 'result-version'])(
  'actual models reject mixed corrected tuple %s', async kind => {
    const f = bundleFixture()
    if (kind === 'stage-version') f.stage.contractVersion = 'master-linked-docx-rendition-stage.v2'
    if (kind === 'stage-key') f.stage.stageKey = 'MASTER_LINKED_RENDITION_RL_QA'
    if (kind === 'provider-version') f.stage.executionIdentity.providerConfigurationVersion = 'MASTER_LINKED_DOCX_PREPARATION_V2'
    if (kind === 'artifact-version') f.artifact.contractVersion = 'master-linked-docx-review-artifact.v2'
    if (kind === 'result-version') f.result.contractVersion = COMPLETED_REVIEW_VERSION
    const [Model, row] = kind.startsWith('stage') || kind === 'provider-version' ? [Stage, f.stage] : kind.startsWith('artifact') ? [Artifact, f.artifact] : [Execution, f.result]
    await expect(new Model(row).validate()).rejects.toThrow()
  })
const recognises = (value, version) => value && typeof value === 'object' && (value.contractVersion === version || value.contractVersion?.$in?.includes(version)
  || Object.values(value).some(v => recognises(v, version)))
test.each([[Execution, CORRECTED_COMPLETED_REVIEW_VERSION, hasCompletedReviewIdentity, completedResultFilter],
  [Artifact, CORRECTED_COMPLETED_ARTIFACT_VERSION, hasCompletedArtifactIdentity, completedArtifactFilter],
  [Stage, CORRECTED_MASTER_LINKED_REVIEW_STAGE_VERSION, hasCompletedStageIdentity, completedStageFilter]]
  .map(([Model, version, detect, filter]) => ({ label: Model.modelName, Model, version, detect, filter })))(
  'version-only marker $label protects stored and incoming records', async ({ Model, version, detect, filter }) => {
    expect(detect({ contractVersion: version })).toBe(true); expect(carriesCompletedReviewValue(version)).toBe(true); expect(recognises(filter, version)).toBe(true)
    const exists = jest.spyOn(Model, 'exists').mockImplementation(query => { const q = Promise.resolve(recognises(query, version) ? { _id: new mongoose.Types.ObjectId() } : null); q.session = () => q; return q })
    const write = jest.spyOn(Model.collection, 'updateOne').mockResolvedValue({ acknowledged: true, matchedCount: 0 })
    try { await expect(Model.updateOne({ _id: new mongoose.Types.ObjectId() }, { $set: { warnings: [] } })).rejects.toThrow(); expect(write).not.toHaveBeenCalled() }
    finally { exists.mockRestore(); write.mockRestore() }
  })
test.each([[Execution, CORRECTED_COMPLETED_REVIEW_VERSION], [Artifact, CORRECTED_COMPLETED_ARTIFACT_VERSION],
  [Stage, CORRECTED_MASTER_LINKED_REVIEW_STAGE_VERSION]].map(([Model, version]) => ({ label: Model.modelName, Model, version })))(
  '$label corrected markers protect bulk and lean insertion before driver access', async ({ Model, version }) => {
    const exists = jest.spyOn(Model, 'exists').mockImplementation(query => { const q = Promise.resolve(recognises(query, version) ? { _id: new mongoose.Types.ObjectId() } : null); q.session = () => q; return q })
    const bulk = jest.spyOn(Model.collection, 'bulkWrite').mockResolvedValue({ acknowledged: true })
    const insert = jest.spyOn(Model.collection, 'insertMany').mockResolvedValue({ acknowledged: true })
    try {
      const existing = Model.bulkWrite([{ deleteOne: { filter: { _id: new mongoose.Types.ObjectId() } } }])
      if (Model === Stage) { await existing; expect(recognises(bulk.mock.calls[0][0][0].deleteOne.filter.$and[1].$nor, version)).toBe(true); bulk.mockClear() }
      else await expect(existing).rejects.toThrow()
      await expect(Model.bulkWrite([{ insertOne: { document: { contractVersion: version } } }], { skipValidation: true })).rejects.toThrow()
      await expect(Model.insertMany([{ contractVersion: version }], { lean: true })).rejects.toThrow()
      expect(bulk).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled()
    } finally { exists.mockRestore(); bulk.mockRestore(); insert.mockRestore() }
  })
test.each([[Execution, CORRECTED_COMPLETED_REVIEW_VERSION], [Artifact, CORRECTED_COMPLETED_ARTIFACT_VERSION],
  [Stage, CORRECTED_MASTER_LINKED_REVIEW_STAGE_VERSION]].map(([Model, version]) => ({ label: Model.modelName, Model, version })))(
  '$label negative prechecks preserve corrected atomic query and bulk exclusions', async ({ Model, version }) => {
    const exists = jest.spyOn(Model, 'exists').mockImplementation(() => { const q = Promise.resolve(null); q.session = () => q; return q })
    const remove = jest.spyOn(Model.collection, 'deleteOne').mockResolvedValue({ acknowledged: true, deletedCount: 0 })
    const bulk = jest.spyOn(Model.collection, 'bulkWrite').mockResolvedValue({ acknowledged: true })
    try {
      const ordinaryQuery = Model.deleteOne({ _id: new mongoose.Types.ObjectId() })
      if (Model === Stage) { await expect(ordinaryQuery).rejects.toThrow(); expect(remove).not.toHaveBeenCalled(); expect(exists).not.toHaveBeenCalled() }
      else { await ordinaryQuery; expect(recognises(remove.mock.calls[0][0].$and[1].$nor, version)).toBe(true) }
      await Model.bulkWrite([{ deleteOne: { filter: { _id: new mongoose.Types.ObjectId() } } }])
      expect(recognises(bulk.mock.calls[0][0][0].deleteOne.filter.$and[1].$nor, version)).toBe(true)
    } finally { exists.mockRestore(); remove.mockRestore(); bulk.mockRestore() }
  })
