import fs from 'node:fs'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import User from '../../models/User.js'
import Audit from '../../models/AuditLog.js'
import Execution from '../../models/GovernedReasoningExecution.js'
import Artifact from '../../models/GovernedRuntimeArtifact.js'
import Stage from '../../models/OutcomeQualityStageExecution.js'
import Master from '../../models/OutcomeMeaningSourceMaster.js'
import Candidate from '../../models/OutcomeDocxRenditionCandidate.js'
import Preview from '../../models/OutcomeDocxPagePreview.js'
import Plan from '../../models/OutcomeKnowledgeCompositionPlan.js'
import auditService from '../../services/auditService.js'
import * as masterContract from '../../services/outcomeMeaningSourceMasterContract.js'
import * as candidateContract from '../../services/outcomeDocxCandidateRecordContract.js'
import * as previewContract from '../../services/outcomeDocxPagePreviewRecordContract.js'
import * as bindingContract from '../../services/outcomeMasterLinkedDocxContract.js'
import { visualReviewOutput } from './docxVisualReviewFixture.js'

// Hermetic protocol fixture only. Native operator authentication, source
// loading/validation and serialization are explicit unit seams. No actual
// customer admission, file parity, transaction rollback or provider is proven.
export const correctedGenuineMetadata = JSON.parse(fs.readFileSync(new URL('./correctedReviewSubject.json', import.meta.url)))
let installedMetadata = correctedGenuineMetadata
const copy = v => JSON.parse(JSON.stringify(v)), oid = () => new mongoose.Types.ObjectId()
export const correctedGenuineSeams = { auth: jest.fn(), operator: jest.fn(), prepare: jest.fn(), permissions: jest.fn(), permission: jest.fn(), runtime: jest.fn(), plan: jest.fn(), fetch: jest.fn() }
const s = correctedGenuineSeams
jest.unstable_mockModule('../../services/masterLinkedReviewOperatorAuthority.js', () => ({
  authenticateMasterReviewNativeOperator: s.auth, readMasterReviewNativeOperator: s.operator,
  MASTER_REVIEW_DATABASE: 'ss044_1619d7db635949898c9abb4592d10bcf', releaseNeed: (ok, reason) => { if (!ok) throw Object.assign(Error('HELD'), { details: { reason } }) } }))
jest.unstable_mockModule('../../services/outcomeMasterLinkedDocxReviewTransportService.js', () => ({
  prepareMasterLinkedDocxReviewTransport: s.prepare, prepareApprovedMasterLinkedDocxReviewTransport: s.prepare,
  prepareNarrowMasterLinkedDocxReviewTransport: s.prepare }))
jest.unstable_mockModule('../../services/openAiMasterLinkedDocxReviewRequest.js', () => ({ buildOpenAiMasterLinkedDocxReviewRequest: t => ({
  binding: copy(t.request), serialized: '{"hermeticCorrectedProtocolOnly":true}', pageReceipts: copy(t.subject.binding.pages),
  inputFingerprint: t.subject.binding.inputFingerprint, docxChecksum: t.subject.binding.docxChecksum }),
buildOpenAiMasterLinkedCategoryDocxReviewRequest: t => ({ binding: copy(t.categoryRequest),
  serialized: '{"hermeticCategoryProtocolOnly":true}', pageReceipts: copy(t.subject.binding.pages),
  inputFingerprint: t.subject.binding.inputFingerprint, docxChecksum: t.subject.binding.docxChecksum }),
buildOpenAiApprovedMasterLinkedCategoryDocxReviewRequest: t => ({ binding: copy(t.request),
  serialized: '{"hermeticApprovedProtocolOnly":true}', pageReceipts: copy(t.subject.binding.pages),
  inputFingerprint: t.subject.binding.inputFingerprint, docxChecksum: t.subject.binding.docxChecksum }),
buildOpenAiNarrowMasterLinkedCategoryDocxReviewRequest: t => ({ binding: copy(t.request),
  serialized: '{"hermeticNarrowProtocolOnly":true}', pageReceipts: copy(t.subject.binding.pages),
  inputFingerprint: t.subject.binding.inputFingerprint, docxChecksum: t.subject.binding.docxChecksum }) }))
jest.unstable_mockModule('../../services/performanceCacheService.js', () => ({ buildUserPermissionsSnapshot: s.permissions }))
jest.unstable_mockModule('../../services/runtimeInstanceService.js', () => ({ assertRuntimePermission: s.permission, getRuntimeInstance: s.runtime }))
jest.unstable_mockModule('../../services/outcomeKnowledgeCompositionPlanService.js', () => ({ assertOutcomeKnowledgeCompositionPlanIntegrity: s.plan }))
jest.unstable_mockModule('../../services/outcomeMeaningSourceMasterContract.js', () => ({ ...masterContract, assertMeaningMasterRecord: () => {}, assertMeaningMasterAudit: () => {} }))
jest.unstable_mockModule('../../services/outcomeDocxCandidateRecordContract.js', () => ({ ...candidateContract, assertPrivateDocxCandidateRecord: () => {}, assertPrivateDocxCandidateAudit: () => {} }))
jest.unstable_mockModule('../../services/outcomeDocxPagePreviewRecordContract.js', () => ({ ...previewContract, assertDocxPagePreviewRecord: () => {}, assertDocxPagePreviewAudit: () => {} }))
jest.unstable_mockModule('../../services/outcomeMasterLinkedDocxContract.js', () => ({ ...bindingContract, assertMasterLinkedCandidateBinding: () => installedMetadata.subject.binding.masterBindingFingerprint }))

export const installCorrectedGenuineModelSeams = (metadata = correctedGenuineMetadata) => {
  installedMetadata = metadata
  const state = {}, database = 'ss044_1619d7db635949898c9abb4592d10bcf', oldName = Audit.db.name
  Audit.db.name = database
  const q = fn => { const query = { maxTimeMS: () => query, setOptions: () => query, select: () => query, session: () => query, lean: async () => fn() }; return query }
  const match = (row, filter) => Object.entries(filter).every(([k, v]) => v && typeof v === 'object' && '$in' in v ? v.$in.includes(row[k])
    : v && typeof v === 'object' && '$ne' in v ? String(row[k]) !== String(v.$ne) : String(row[k]) === String(v))
  const index = (name, key, extra = {}) => ({ name, key, unique: true, ...extra })
  const indexes = { Execution: [index('executionId_1', { executionId: 1 }), index('runtimeInstanceId_1_idempotencyKey_1', { runtimeInstanceId: 1, idempotencyKey: 1 }, { partialFilterExpression: { idempotencyKey: { $exists: true, $gt: '' } } })],
    Artifact: [index('runtimeArtifactId_1', { runtimeArtifactId: 1 })], Stage: [index('uniq_outcome_quality_stage_execution_id', { stageExecutionId: 1 }), index('uniq_outcome_quality_stage_attempt', { runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 })], Audit: [index('_id_', { _id: 1 })] }
  for (const [name, Model] of Object.entries({ Execution, Artifact, Stage, Audit })) {
    jest.spyOn(Model.collection, 'indexes').mockImplementation(async () => {
      state.indexCalls.push(name)
      if (state.indexFault === 'reject') throw Error('UNIT_INDEX_UNAVAILABLE')
      if (state.indexFault === 'hang') return new Promise(resolve => { state.resolveIndexes = () => resolve(indexes[name]) })
      return state.missingIndex === name ? [] : indexes[name]
    })
    jest.spyOn(Model, 'findOne').mockImplementation(filter => q(() => state[name].find(row => match(row, filter))))
    jest.spyOn(Model, 'exists').mockImplementation(() => { const result = Promise.resolve(null); result.session = () => result; return result })
    jest.spyOn(Model, 'create').mockImplementation(async values => {
      if (state.recordFault === name) throw Error('UNIT_RECORD_FAILURE')
      for (const row of values) { await new Model(row).validate(); state[name].push(row) } return values
    })
  }
  jest.spyOn(Audit, 'findById').mockImplementation(id => q(() => state.Audit.find(a => String(a._id) === String(id))))
  jest.spyOn(User, 'findById').mockImplementation(() => q(() => ({ _id: state.subject.actorUserId, isActive: true })))
  jest.spyOn(User, 'findOne').mockImplementation(() => q(() => ({ _id: state.subject.actorUserId, isActive: true })))
  for (const [name, Model] of Object.entries({ Master, Candidate, Preview, Plan })) jest.spyOn(Model, 'findOne').mockImplementation(() => q(() => state[name]))
  jest.spyOn(Audit.db, 'startSession').mockImplementation(async () => ({ endSession: async () => {}, withTransaction: async callback => {
    const old = ['Execution', 'Artifact', 'Stage', 'Audit'].map(k => [...state[k]])
    try { return await callback() } catch (e) { ['Execution', 'Artifact', 'Stage', 'Audit'].forEach((k, i) => { state[k].splice(0, state[k].length, ...old[i]) }); throw e }
  } }))
  jest.spyOn(auditService, 'log').mockImplementation(async data => {
    if (state.auditFault === data.action) throw Error('UNIT_AUDIT_FAILURE')
    const row = new Audit(data); row.generateSignature(); const value = row.toObject(); state.Audit.push(value); return value
  })
  const reset = () => {
    Object.assign(state, { Execution: [], Artifact: [], Stage: [], Audit: [], missingIndex: '', indexFault: '', indexCalls: [], resolveIndexes: null, auditFault: '', recordFault: '', failed: false,
      subject: copy(metadata.subject), request: copy(metadata.request) })
    const b = state.subject.binding, scope = b.masterReference.scope
    state.native = { realm: 'native-application-test.v1', operatorUserId: '698b3800f83b3257365fd7a3', fingerprint: 'a'.repeat(64) }
    const plan = { _id: oid(), ...scope, planId: 'unit-corrected-gen-plan', planVersion: 1, requestId: 'unit-request', planFingerprint: 'b'.repeat(64), resolutionFingerprint: 'c'.repeat(64), contextFingerprint: 'd'.repeat(64) }
    const planRef = { recordId: String(plan._id), ...Object.fromEntries(['planId', 'planVersion', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].map(k => [k, plan[k]])) }
    state.Plan = plan
    state.Master = { _id: b.masterReference.storageId, auditId: b.masterReference.auditId, auditSignatureVersion: 3, masterId: b.masterReference.masterId,
      version: 1, bodyFingerprint: b.masterReference.bodyFingerprint, sourceFingerprint: b.sourceFingerprint,
      body: { scope, sourceProjectionFingerprint: b.masterReference.sourceProjectionFingerprint, sourceSnapshot: { plan: planRef } } }
    state.Candidate = { _id: oid(), candidateId: b.candidateId, auditId: oid(), auditSignatureVersion: 3, bodyFingerprint: b.candidateBodyFingerprint,
      body: { inputFingerprint: b.inputFingerprint, sourceFingerprint: b.sourceFingerprint, artifact: { outputChecksum: b.docxChecksum },
        masterBinding: { masterReference: b.masterReference, correctionReference: b.correctionReference,
          ...(b.compatibilityReference ? { compatibilityReference: b.compatibilityReference } : {}) }, input: { renderer: b.renderer } } }
    state.Preview = { _id: oid(), previewId: b.previewId, candidateId: b.candidateId, auditId: oid(), auditSignatureVersion: 3, bodyFingerprint: 'e'.repeat(64),
      runtimeFingerprint: b.runtimeFingerprint, docxChecksum: b.docxChecksum, body: { candidateBodyFingerprint: b.candidateBodyFingerprint,
        masterBindingFingerprint: b.masterBindingFingerprint, conversionFingerprint: b.conversionFingerprint, inputFingerprint: b.inputFingerprint,
        sourceFingerprint: b.sourceFingerprint, renderer: b.renderer, conversion: { pages: b.pages } } }
    for (const row of [state.Master, state.Candidate, state.Preview]) state.Audit.push({ _id: row.auditId, fixtureOnlySourceAudit: true })
    s.auth.mockReset().mockImplementation(async () => copy(state.native)); s.operator.mockReset().mockImplementation(async () => copy(state.native))
    s.permissions.mockReset().mockResolvedValue({}); s.permission.mockReset().mockResolvedValue(undefined); s.plan.mockReset().mockResolvedValue(undefined)
    s.runtime.mockReset().mockImplementation(async () => ({ _id: scope.runtimeInstanceId, ...scope, status: 'LOCKED', runtimeInstanceKey: 'unit-corrected-gen', runtimeType: 'VMF', frameworkKey: 'VMF', packageKey: 'unit', packageVersion: '1.0.0' }))
    s.prepare.mockReset().mockImplementation(async () => ({ subject: copy(state.subject), request: copy(state.request), sourceEnvelope: { source: { plan: { planId: plan.planId } } } }))
    s.fetch.mockReset().mockImplementation(async (_url, options) => {
      if (options.method !== 'POST') throw Error('UNIT_UNEXPECTED_GET')
      return new Response(JSON.stringify({ id: 'resp_corrected_gen_hermetic', status: 'completed', model: 'gpt-5.2',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(visualReviewOutput(state.failed)) }] }] }), { headers: { 'x-request-id': 'req_corrected_gen_hermetic' } })
    })
    return state
  }
  return { state, reset, restoreName: () => { Audit.db.name = oldName } }
}
