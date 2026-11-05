import { beforeAll, afterAll, jest, test, expect } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { masterLinkedDocxFixture } from './fixtures/masterLinkedDocxFixture.js'
import { renditionReviewClaimFixture } from './fixtures/renditionReviewClaimFixture.js'
import { hashOutcomeQualityStageValue } from '../services/outcomeQualityStageExecutionService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { prepareCorrectedMeaningMasterDocxRendition } from '../services/outcomeMeaningMasterRenditionService.js'
import { masterBindingFromBridge } from '../services/outcomeMasterLinkedDocxContract.js'
import { prepareMasterLinkedDocxReviewTransport, assertMasterLinkedDocxReviewTransport } from '../services/outcomeMasterLinkedDocxReviewTransportService.js'
import { buildOpenAiMasterLinkedDocxReviewRequest } from '../services/openAiMasterLinkedDocxReviewRequest.js'
import { assertG1FixedSubject } from '../services/masterLinkedGenuineReviewContract.js'
import { assertMasterLinkedPreparedSubject } from '../services/masterLinkedReviewSimulationContract.js'
import { createFakeNetworkMasterLinkedDocxReviewProviderAdapter } from '../services/openAiMasterLinkedDocxReviewProviderAdapter.js'
const copy = v => JSON.parse(JSON.stringify(v))
const full = 'These three quoted statements must not be read as assigning an execution approver, defining an approval procedure, or granting permission after review. This is descriptive organisation of the recorded question and outstanding review, not an adopted approval process. This paper assigns no such authority and adopts no decision.'
let connect
beforeAll(() => { connect = jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect').mockImplementation(() => { throw Error('LIVE_MONGO_FORBIDDEN') }) })
afterAll(() => { expect(connect).not.toHaveBeenCalled(); connect.mockRestore() })
// Unsigned source and generic PNG projections; never actual admission/review evidence.
const fixture = async () => {
  const f = await masterLinkedDocxFixture(null, source => {
    const example = copy(source.content.workingDraft.sections[0])
    source.content.shaping.expressionProfileVersion = 'outcome-commercial-expression.v4'
    source.content.shaping.sections[12].body = 'They do not assign an execution approver, define an approval procedure, adopt a decision or grant permission after review.\n\n> Trial execution is not authorised.'
    source.content.workingDraft.sections = source.content.shaping.sections.map((section, i) => ({ ...copy(example), order: i + 1,
      sectionKey: section.sectionKey, title: i === 12 ? 'Recorded question and review context' : 'Role ' + (i + 1), content: i === 12 ? full : example.content }))
    const fp = hashOutcomeQualityStageValue(source.content.workingDraft)
    source.stageRefs.find(r => r.stageKey === 'WORKING_DRAFT').outputFingerprint = fp
    source.content.approvedMeaning.workingDraftOutputFingerprint = fp
  })
  const correctionReference = { predecessorBodyFingerprint: f.record.bodyFingerprint, predecessor: {
    candidateId: f.record.candidateId, inputFingerprint: f.record.body.inputFingerprint, outputChecksum: f.record.body.artifact.outputChecksum,
    failedReviewExecutionId: 'master_docx_result_' + 'a'.repeat(40), failedReviewResultFingerprint: 'b'.repeat(64) } }
  const bridge = await prepareCorrectedMeaningMasterDocxRendition({ actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId,
    masterId: f.masterReceipt.masterReference.masterId, version: 1, correctionReference,
    deps: { readMaster: async () => copy(f.masterReceipt), loadPackContent: f.loadPackContent } })
  const input = bridge.input.renditionInput, masterBinding = masterBindingFromBridge(bridge)
  const candidate = { ...copy(f.record.body), candidateId: 'docx_candidate_' + randomUUID(), bodyFingerprint: 'c'.repeat(64),
    inputFingerprint: bridge.input.renditionInputFingerprint, renderer: input.renderer, masterBinding,
    masterBindingFingerprint: membershipHash(masterBinding), artifact: bridge.artifact }
  const observed = { candidate, candidateInput: input, buffer: Buffer.from(bridge.buffer), scope: f.scope }
  const bytes = Buffer.from(f.preview.pageBytes[0]), descriptor = f.preview.body.conversion.pages[0]
  const preview = { ...copy(f.preview.body), candidateId: candidate.candidateId, candidateBodyFingerprint: candidate.bodyFingerprint,
    masterBindingFingerprint: candidate.masterBindingFingerprint, inputFingerprint: candidate.inputFingerprint,
    conversion: { ...copy(f.preview.body.conversion), docxChecksum: candidate.artifact.outputChecksum,
      pages: Array.from({ length: 7 }, (_, i) => ({ ...copy(descriptor), number: i + 1 })) } }
  preview.conversionFingerprint = membershipHash(preview.conversion)
  const m = renditionReviewClaimFixture(), ref = f.envelope.source.plan
  const plan = { ...copy(m.plan), ...f.scope, _id: ref.recordId,
    ...Object.fromEntries(['planId', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].map(k => [k, ref[k]])) }
  const args = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, candidateId: candidate.candidateId, scopes: {}, deps: {
    readCandidate: jest.fn(async () => observed), readPreview: async () => ({ preview, pages: Array.from({ length: 7 }, () => Buffer.from(bytes)) }),
    readMaster: async () => copy(f.masterReceipt), loadPlan: async () => plan, assertPlanIntegrity: () => {},
    loadPackContent: async q => q.packId === m.methodPack.packId ? { ...m.methodPack, available: true, content: m.methodContent } : f.loadPackContent(q),
  } }
  return { f, candidate, observed, preview, args, correctionReference, prepare: () => prepareMasterLinkedDocxReviewTransport(args) }
}
test('prepares seven exact generic pages with separate versions and server-only failed-parent lineage', async () => {
  const f = await fixture(), t = await f.prepare(), r = buildOpenAiMasterLinkedDocxReviewRequest(t)
  expect(t.subject.contractVersion).toBe('master-linked-docx-review-subject.v3')
  expect(t.subject.binding.contractVersion).toBe('master-linked-docx-review-binding.v2')
  expect(t.subject.binding.correctionReference).toEqual(f.correctionReference)
  expect(t.context.contractVersion).toBe('master-linked-docx-correction-visual-review.v1')
  expect(t.pages).toHaveLength(7); expect(r.pageReceipts).toHaveLength(7); expect(r.dispatchAvailable).toBe(false)
  expect(t.document.markdown).toContain(full)
  for (const secret of [f.correctionReference.predecessor.candidateId, f.correctionReference.predecessor.failedReviewExecutionId,
    f.correctionReference.predecessor.failedReviewResultFingerprint, f.f.masterReceipt.masterReference.auditId]) expect(r.serialized).not.toContain(secret)
  for (const flag of ['dispatchAvailable', 'externalDisclosureAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable']) {
    expect(t.subject[flag]).toBe(false); expect(t.subject.policy[flag]).toBe(false)
  }
})
test('old execution and simulation authorities refuse corrected preparation without network or writes', async () => {
  const f = await fixture(), t = await f.prepare(), r = buildOpenAiMasterLinkedDocxReviewRequest(t)
  expect(() => assertG1FixedSubject(t.subject, r.binding)).toThrow()
  expect(() => assertMasterLinkedPreparedSubject(t.subject, r.binding, f.f.scope, f.f.actorUserId)).toThrow()
  const fetchImpl = jest.fn(); const adapter = createFakeNetworkMasterLinkedDocxReviewProviderAdapter({ fetchImpl })
  await expect(adapter(t)).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled()
})
test.each(['input version', 'binding version', 'self parent', 'predecessor body', 'predecessor result', 'wrapper', 'scope', 'bytes', 'renderer', 'flag', 'preview page'])('refuses changed %s during preparation', async kind => {
  const f = await fixture(), c = f.candidate, i = f.observed.candidateInput
  if (kind === 'input version') i.contractVersion = 'governed-private-docx-input.v1'
  if (kind === 'binding version') c.masterBinding.contractVersion = 'master-linked-private-docx-binding.v1'
  if (kind === 'self parent') c.masterBinding.correctionReference.predecessor.candidateId = c.candidateId
  if (kind === 'predecessor body') c.masterBinding.correctionReference.predecessorBodyFingerprint = '0'.repeat(64)
  if (kind === 'predecessor result') c.masterBinding.correctionReference.predecessor.failedReviewResultFingerprint = '0'.repeat(64)
  if (kind === 'wrapper') c.masterBinding.wrapperFingerprint = '0'.repeat(64)
  if (kind === 'scope') f.observed.scope = { ...f.observed.scope, customerId: '0'.repeat(24) }
  if (kind === 'bytes') f.observed.buffer[0] ^= 1
  if (kind === 'renderer') i.renderer.version = '0.1.2'
  if (kind === 'flag') c.authorisesApproval = true
  if (kind === 'preview page') f.preview.conversion.pages[6].sha256 = '0'.repeat(64)
  c.masterBindingFingerprint = membershipHash(c.masterBinding); c.inputFingerprint = membershipHash(i)
  await expect(f.prepare()).rejects.toThrow()
})
test.each(['subject', 'binding', 'context', 'server correction reference', 'master', 'text', 'page bytes', 'method', 'pack'])('refuses resealed transport %s', async kind => {
  const f = await fixture(), t = await f.prepare()
  if (kind === 'subject') t.subject.contractVersion = 'master-linked-docx-review-subject.v2'
  if (kind === 'binding') t.subject.binding.contractVersion = 'master-linked-docx-review-binding.v1'
  if (kind === 'context') t.context.contractVersion = 'master-linked-docx-visual-review.v2'
  if (kind === 'server correction reference') t.subject.binding.correctionReference.predecessorBodyFingerprint = '0'.repeat(64)
  if (kind === 'master') t.master.sourceFingerprint = '0'.repeat(64)
  if (kind === 'text') t.document.markdown += '\nChanged.'
  if (kind === 'page bytes') t.pages[6][0] ^= 1
  if (kind === 'method') t.context.methodDocument.chunks[0].text += '\nChanged.'
  if (kind === 'pack') t.context.selectedDocuments[0].content += '\nChanged.'
  t.contextFingerprint = membershipHash(t.context)
  expect(() => assertMasterLinkedDocxReviewTransport(t)).toThrow()
})
test('refuses a changed final candidate observation', async () => {
  const f = await fixture(); let reads = 0
  f.args.deps.readCandidate = async () => { if (++reads === 3) return { ...f.observed, buffer: Buffer.from('changed') }; return f.observed }
  await expect(f.prepare()).rejects.toThrow(); expect(reads).toBe(3)
})
