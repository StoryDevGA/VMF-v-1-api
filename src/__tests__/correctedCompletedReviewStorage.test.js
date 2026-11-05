import { jest } from '@jest/globals'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import Audit from '../models/AuditLog.js'
import Execution from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import * as masterContract from '../services/outcomeMeaningSourceMasterContract.js'
import * as candidateContract from '../services/outcomeDocxCandidateRecordContract.js'
import * as previewContract from '../services/outcomeDocxPagePreviewRecordContract.js'
import * as bindingContract from '../services/outcomeMasterLinkedDocxContract.js'
import { G1_VERSION, G1_OUTPUT, G1_MODES, G1_STATUSES, G1_ACTIONS, G1_FIXED, G1_CORRECTED_QA_RELEASE,
  g1SubjectRoot, g1Key, g1ReceiptId, g1Reference, g1AuditDiff } from '../services/masterLinkedGenuineReviewContract.js'
import { createNetworkQaMasterLinkedReviewAuthority } from '../services/masterLinkedGenuineReviewAuthorityService.js'
import { createFakeNetworkMasterLinkedDocxReviewProviderAdapter } from '../services/openAiMasterLinkedDocxReviewProviderAdapter.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { visualReviewOutput } from './fixtures/docxVisualReviewFixture.js'
import { completedReviewRecoveryCases } from './fixtures/completedReviewRecoveryFixture.js'

// These seams isolate the new signed-release service join. Source admission
// and stored file bytes are NOT proven here; the real proof uses default owners.
const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/correctedReviewSubject.json', import.meta.url)))
jest.unstable_mockModule('../services/outcomeMeaningSourceMasterContract.js', () => ({ ...masterContract, assertMeaningMasterRecord: () => {}, assertMeaningMasterAudit: () => {} }))
jest.unstable_mockModule('../services/outcomeDocxCandidateRecordContract.js', () => ({ ...candidateContract, assertPrivateDocxCandidateRecord: () => {}, assertPrivateDocxCandidateAudit: () => {} }))
jest.unstable_mockModule('../services/outcomeDocxPagePreviewRecordContract.js', () => ({ ...previewContract, assertDocxPagePreviewRecord: () => {}, assertDocxPagePreviewAudit: () => {} }))
jest.unstable_mockModule('../services/outcomeMasterLinkedDocxContract.js', () => ({ ...bindingContract, assertMasterLinkedCandidateBinding: () => metadata.subject.binding.masterBindingFingerprint }))
const { createNetworkQaMasterLinkedCompletedReviewStore } = await import('../services/masterLinkedCompletedReviewService.js')
const clone = v => JSON.parse(JSON.stringify(v)), oid = () => new mongoose.Types.ObjectId()
const connect = jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect').mockRejectedValue(Error('LIVE_DATABASE_FORBIDDEN'))
const realFetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(Error('REAL_PROVIDER_FORBIDDEN'))
const offlineClient = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:1', { serverSelectionTimeoutMS: 1 })
afterAll(async () => { expect(connect).not.toHaveBeenCalled(); expect(realFetch).not.toHaveBeenCalled(); await offlineClient.close(); connect.mockRestore(); realFetch.mockRestore() })
const setup = async () => {
  const subject = clone(metadata.subject), request = clone(metadata.request), b = subject.binding, scope = clone(b.masterReference.scope)
  const qaCase = 'ss055-release-proof-corrected-unit', root = g1SubjectRoot(subject, request, G1_MODES.QA, qaCase)
  const runtime = { runtimeInstanceKey: 'unit-corrected-storage', runtimeType: 'VMF', frameworkKey: 'VMF', packageKey: 'unit', packageVersion: '1.0.0' }
  const issuedAt = '2026-11-03T00:00:00.000Z', expiresAt = '2026-11-03T00:30:00.000Z', operator = '698b3800f83b3257365fd7a3'
  const sign = data => { const row = new Audit(data); row.generateSignature(); return row.toObject() }
  const release = sign({ _id: oid(), actorUserId: operator, action: G1_CORRECTED_QA_RELEASE.action, resourceType: 'RuntimeInstance', resourceId: scope.runtimeInstanceId, scope,
    signatureVersion: 3, diff: { version: G1_CORRECTED_QA_RELEASE.version, approvingOperatorUserId: operator,
      operatorAuthority: { realm: 'native-application-test.v1', operatorUserId: operator, fingerprint: 'a'.repeat(64) },
      appActorUserId: subject.actorUserId, onceRoot: root, scope, candidateId: b.candidateId, masterId: b.masterReference.masterId, requestBinding: request,
      legacyReconciliationFingerprint: G1_FIXED.reconciliation, approvalReference: 'Unit-only release join', issuedAt, expiresAt,
      permittedUse: 'CONTROLLED_DEVELOPMENT_TEST_ONLY', maximumAttempts: 1, customerApproval: false, productionUse: false, automaticFinalisation: false, qaCase, genuineReviewEligible: false } })
  const executions = [], audits = [release], artifacts = [], stages = [], trace = { dropRelease: false, transactionDrop: false, sourceBarrier: false, writes: 0 }
  const phaseRows = {}
  for (const [index, phase] of ['GRANT', 'RESERVATION', 'START_OR_REVOKE'].entries()) {
    const body = { version: G1_VERSION, phase, decision: phase === 'START_OR_REVOKE' ? 'START_ALLOWED' : phase,
      executionId: `master_docx_dispatch_00000000-0000-4000-8000-00000000000${index + 1}`, scope, actorUserId: subject.actorUserId,
      planId: 'unit-corrected-plan', runtime, subject, request, mode: G1_MODES.QA, qaCase, onceRoot: root,
      approval: { kind: G1_CORRECTED_QA_RELEASE.kind, auditId: String(release._id), diffFingerprint: membershipHash(release.diff) },
      grantCreatedAt: issuedAt, expiresAt, createdAt: issuedAt, grant: index ? g1Reference(phaseRows.GRANT) : null,
      reservation: index === 2 ? g1Reference(phaseRows.RESERVATION) : null }
    const auditId = oid(), row = { _id: oid(), executionId: body.executionId, ...scope, ...runtime, workspaceType: 'PLATFORM', outputTypeKey: G1_OUTPUT,
      requestedOutputTypeKey: 'master-linked-docx-dispatch', executionIntent: 'Record bounded master-linked DOCX review authority; no customer approval.',
      idempotencyKey: g1Key(root, phase), requestFingerprint: request.requestIdentity, status: G1_STATUSES[phase], contractVersion: G1_VERSION,
      providerMode: 'DETERMINISTIC_TEST', provider: { mode: G1_MODES.QA, provenance: 'NETWORK_QA', phase },
      knowledgeManifest: {}, knowledgeBinding: {}, certifiedTruth: {}, runtimeStateWrites: {}, reasoningContext: { dispatchAvailable: false, approvalAvailable: false, finalisationAvailable: false },
      artifactIds: [], auditLogIds: [String(auditId)], warnings: [], limitations: [], requestedBy: subject.actorUserId, requestedAt: new Date(issuedAt), completedAt: null, failureReason: null,
      executionEvidence: { masterDocxDispatch: { body, bodyFingerprint: membershipHash(body), auditId, auditSignatureVersion: 3 } } }
    executions.push(row); phaseRows[phase] = row
    audits.push(sign({ _id: auditId, actorUserId: subject.actorUserId, action: G1_ACTIONS[phase], resourceType: 'GovernedReasoningExecution', resourceId: row._id,
      scope, diff: g1AuditDiff(row), signatureVersion: 3 }))
  }
  const identity = { responseId: 'resp_corrected_service_unit', postRequestId: 'req_unit', provider: 'OPENAI', model: 'gpt-5.2',
    accountFingerprint: createHash('sha256').update('SS055_FAKE_NETWORK_ONLY').digest('hex') }
  audits.push(sign({ _id: new mongoose.Types.ObjectId(g1ReceiptId(phaseRows.RESERVATION.executionId, 'RESPONSE')), actorUserId: subject.actorUserId,
    action: G1_ACTIONS.RESPONSE, resourceType: 'GovernedReasoningExecution', resourceId: phaseRows.RESERVATION._id, scope, signatureVersion: 3,
    diff: { version: G1_VERSION, mode: G1_MODES.QA, kind: 'RESPONSE', onceRoot: root, reservation: g1Reference(phaseRows.RESERVATION), request, payload: identity } }))
  const all = [executions, audits, artifacts, stages], session = { endSession: async () => {}, withTransaction: async fn => {
    const old = all.map(r => [...r]); if (trace.transactionDrop) trace.dropRelease = true
    try { return await fn() } catch (e) { all.forEach((r, i) => r.splice(0, r.length, ...old[i])); throw e }
  } }, db = { startSession: async () => session }
  const match = (row, filter) => Object.entries(filter).every(([k, v]) => String(row[k]) === String(v))
  const model = (rows, Model, indexList) => ({ db, prototype: Audit.prototype, collection: { indexes: async () => indexList },
    findOne: filter => { const q = { setOptions: () => q, select: () => q, session: () => q, lean: async () => {
      const row = rows.find(r => match(r, filter)); return trace.dropRelease && row === release ? null : row
    } }; return q }, create: async values => { for (const row of values) { await new Model(row).validate(); rows.push(row); trace.writes++ } return values } })
  const index = (name, key, extra = {}) => ({ name, key, unique: true, ...extra })
  const models = { Execution: model(executions, Execution, [index('executionId_1', { executionId: 1 }), index('runtimeInstanceId_1_idempotencyKey_1', { runtimeInstanceId: 1, idempotencyKey: 1 }, { partialFilterExpression: { idempotencyKey: { $exists: true, $gt: '' } } })]),
    Audit: model(audits, Audit, [{ name: '_id_', key: { _id: 1 } }]), Artifact: model(artifacts, Artifact, [index('runtimeArtifactId_1', { runtimeArtifactId: 1 })]),
    Stage: model(stages, Stage, [index('uniq_outcome_quality_stage_execution_id', { stageExecutionId: 1 }), index('uniq_outcome_quality_stage_attempt', { runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 })]) }
  const actorModel = model([{ _id: subject.actorUserId, isActive: true }], null, [])
  const authority = createNetworkQaMasterLinkedReviewAuthority({ ...models, User: actorModel, assertPermission: async () => {}, permissions: async () => ({}) })
  const readArgs = { actorUserId: subject.actorUserId, scopes: {}, grantExecutionId: phaseRows.GRANT.executionId }
  const recovery = await authority.recover(readArgs)
  const fetch = jest.fn(async (_url, options) => {
    expect(options.method).toBe('GET'); return new Response(JSON.stringify({ id: identity.responseId, status: 'completed', model: 'gpt-5.2',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(visualReviewOutput()) }] }] }))
  })
  const providerResult = await createFakeNetworkMasterLinkedDocxReviewProviderAdapter({ fetchImpl: fetch })(recovery.capability)
  const plan = { _id: oid(), ...scope, planId: 'unit-corrected-plan', planVersion: 1, requestId: 'unit-request', planFingerprint: 'b'.repeat(64), resolutionFingerprint: 'c'.repeat(64), contextFingerprint: 'd'.repeat(64) }
  const planRef = { recordId: String(plan._id), ...Object.fromEntries(['planId', 'planVersion', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].map(k => [k, plan[k]])) }
  const master = { _id: b.masterReference.storageId, auditId: b.masterReference.auditId, auditSignatureVersion: b.masterReference.auditSignatureVersion,
    masterId: b.masterReference.masterId, version: 1, bodyFingerprint: b.masterReference.bodyFingerprint, sourceFingerprint: b.sourceFingerprint,
    body: { scope, sourceProjectionFingerprint: b.masterReference.sourceProjectionFingerprint, sourceSnapshot: { plan: planRef } } }
  const candidate = { _id: oid(), candidateId: b.candidateId, auditId: oid(), auditSignatureVersion: 3, bodyFingerprint: b.candidateBodyFingerprint,
    body: { inputFingerprint: b.inputFingerprint, sourceFingerprint: b.sourceFingerprint, artifact: { outputChecksum: b.docxChecksum },
      masterBinding: { masterReference: b.masterReference, correctionReference: b.correctionReference }, input: { renderer: b.renderer } } }
  const preview = { _id: oid(), previewId: b.previewId, candidateId: b.candidateId, auditId: oid(), auditSignatureVersion: 3, bodyFingerprint: 'e'.repeat(64),
    runtimeFingerprint: b.runtimeFingerprint, docxChecksum: b.docxChecksum, body: { candidateBodyFingerprint: b.candidateBodyFingerprint,
      masterBindingFingerprint: b.masterBindingFingerprint, conversionFingerprint: b.conversionFingerprint, inputFingerprint: b.inputFingerprint,
      sourceFingerprint: b.sourceFingerprint, renderer: b.renderer, conversion: { pages: b.pages } } }
  const sourceModel = row => ({ findOne: () => { if (trace.sourceBarrier) throw Error('SOURCE_READ_TEST_BARRIER'); const q = { setOptions: () => q, select: () => q, session: () => q, lean: async () => row }; return q } })
  const writer = { log: jest.fn(async data => { trace.writes++; const row = sign(data); audits.push(row); return row }) }
  // Authority projection is a seam here, keeping signed-release checks inside
  // the G2 owner under test instead of failing earlier in G1 historical read.
  const state = await authority.read(readArgs)
  const deps = { ...models, Master: sourceModel(master), Candidate: sourceModel(candidate), Preview: sourceModel(preview), Plan: sourceModel(plan),
    assertPlanIntegrity: async () => {}, readAuthority: async () => clone(state), auditService: writer }
  const resignPhaseReferences = () => {
    for (const [index, phase] of ['GRANT', 'RESERVATION', 'START_OR_REVOKE'].entries()) {
      const row = phaseRows[phase], evidence = row.executionEvidence.masterDocxDispatch, body = evidence.body
      body.approval.diffFingerprint = membershipHash(release.diff)
      if (index) body.grant = g1Reference(phaseRows.GRANT)
      if (index === 2) body.reservation = g1Reference(phaseRows.RESERVATION)
      evidence.bodyFingerprint = membershipHash(body)
      const auditIndex = audits.findIndex(a => String(a._id) === String(evidence.auditId))
      audits[auditIndex] = sign({ ...audits[auditIndex], diff: g1AuditDiff(row) })
      state.records[phase] = clone(evidence)
    }
  }
  return { store: createNetworkQaMasterLinkedCompletedReviewStore(deps), args: { actorUserId: subject.actorUserId, scopes: {}, providerResult },
    readArgs, trace, release, sign, audits, executions, artifacts, stages, deps, fetch, state, writer, resignPhaseReferences,
    changeSource: () => { candidate.body.artifact.outputChecksum = 'f'.repeat(64) } }
}

completedReviewRecoveryCases('corrected completed-review recovery', setup, () => offlineClient.startSession())
test('corrected signed permission reaches the source boundary with real signature and G1 joins', async () => {
  const f = await setup(); f.trace.sourceBarrier = true
  await expect(f.store.read(f.readArgs)).rejects.toThrow('SOURCE_READ_TEST_BARRIER'); expect(f.trace.writes).toBe(0)
})
test.each(['missing', 'tampered', 'fingerprint', 'time'])('corrected service refuses %s permission before writes', async kind => {
  const f = await setup()
  if (kind === 'missing') f.trace.dropRelease = true
  if (kind === 'tampered') f.release.diff.approvalReference += '-tampered'
  if (kind === 'fingerprint') { f.release.diff.approvalReference += '-resealed'; const next = f.sign(f.release); Object.assign(f.release, next) }
  if (kind === 'time') {
    f.release.diff.expiresAt = '2026-11-03T00:29:59.000Z'; Object.assign(f.release, f.sign(f.release)); f.resignPhaseReferences()
    // Hashes and signatures are current: only the phase/release lifetime join
    // is wrong. Historical read isolates that check from owned-receipt refs.
    expect(f.state.records.GRANT.body.approval.diffFingerprint).toBe(membershipHash(f.release.diff))
    await expect(f.store.read(f.readArgs)).rejects.toMatchObject({ details: { reason: 'CORRECTED_QA_RELEASE_CHANGED' } })
  } else await expect(f.store.persist(f.args)).rejects.toThrow()
  expect(f.trace.writes).toBe(0); expect(f.writer.log).not.toHaveBeenCalled()
})
test('corrected permission is reread in transaction and post-await disappearance prevents all bundle writes', async () => {
  const f = await setup(); f.trace.transactionDrop = true
  await expect(f.store.persist(f.args)).rejects.toThrow(); expect(f.trace.writes).toBe(0); expect(f.writer.log).not.toHaveBeenCalled()
  expect(f.executions).toHaveLength(3); expect(f.audits).toHaveLength(5)
})
