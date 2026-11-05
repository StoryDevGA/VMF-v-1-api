import fs from 'node:fs'
import mongoose from 'mongoose'
import { beforeAll, afterAll, expect, jest, test } from '@jest/globals'
import { compileGovernedPrivateDocxInput } from '../services/outcomeGovernedDocxCandidateService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { prepareMasterLinkedDocxReviewTransport, prepareApprovedMasterLinkedDocxReviewTransport,
  assertApprovedMasterLinkedDocxReviewTransport } from '../services/outcomeMasterLinkedDocxReviewTransportService.js'
import { buildOpenAiMasterLinkedDocxReviewRequest, buildOpenAiMasterLinkedCategoryDocxReviewRequest,
  buildOpenAiApprovedMasterLinkedCategoryDocxReviewRequest } from '../services/openAiMasterLinkedDocxReviewRequest.js'
import { createGenuineMasterLinkedReviewAuthority } from '../services/masterLinkedGenuineReviewAuthorityService.js'
import { prepareApprovedMasterLinkedDocxReviewBinding } from '../services/outcomeMasterLinkedDocxReviewBindingService.js'
import { g1SubjectRoot, G1_MODES, G1_CATEGORY_QA_REQUEST } from '../services/masterLinkedGenuineReviewContract.js'
import { normalizeMasterLinkedCategoryReviewResponse, MASTER_LINKED_CATEGORY_RESPONSE_VERSION } from '../services/masterLinkedCategoryReviewResponseContract.js'
import { RENDERED_EXPRESSION_RL_DIMENSIONS } from '../utils/outcomeRenderedExpressionRlOutput.js'
import { OUTCOME_QUALITY_STAGE_OUTPUT_TYPES } from '../constants/outcomeGovernedQuality.js'
import { docxPagePreviewFixture } from './fixtures/docxPagePreviewFixture.js'
import { renditionReviewClaimFixture } from './fixtures/renditionReviewClaimFixture.js'
const retained = JSON.parse(fs.readFileSync(new URL('./fixtures/approvedCommercialSource.json', import.meta.url)))
const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/approvedDocxReadFixture.json', import.meta.url)))
const copy = v => JSON.parse(JSON.stringify(v))
let connect, network, args, transport
beforeAll(async () => {
  connect = jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect').mockImplementation(() => { throw Error('LIVE_MONGO_FORBIDDEN') })
  network = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('LIVE_PROVIDER_FORBIDDEN') })
  const envelope = copy(retained.sourceEnvelope), source = envelope.source, candidate = copy(metadata.candidate)
  const documents = source.content.shaping.outputContract.packs.map(pack => ({ source: { ...pack, contentFormat: 'MARKDOWN' },
    content: retained.selectedDocuments.find(d => d.receipt.packId === pack.packId).content }))
  const audienceDocument = { ...source.selectedPacks.AUDIENCE, available: true, status: 'ACTIVE', contentFormat: 'MARKDOWN',
    content: retained.selectedDocuments.find(d => d.layer === 'AUDIENCE').content }
  const compiled = await compileGovernedPrivateDocxInput({ envelope, documents, audienceDocument,
    approvedCompatibilityReference: candidate.masterBinding.compatibilityReference })
  candidate.inputFingerprint = compiled.inputFingerprint; candidate.artifact = compiled.artifact
  candidate.masterBinding.wrapperFingerprint = membershipHash({ contractVersion: 'meaning-master-private-docx-input.v3',
    masterReference: candidate.masterBinding.masterReference, expressionOrigin: candidate.masterBinding.expressionOrigin,
    renditionInput: compiled.input, renditionInputFingerprint: compiled.inputFingerprint,
    outputChecksum: compiled.artifact.outputChecksum, compatibilityReference: candidate.masterBinding.compatibilityReference })
  candidate.masterBindingFingerprint = membershipHash(candidate.masterBinding)
  const f = docxPagePreviewFixture(), m = renditionReviewClaimFixture(), preview = copy(metadata.preview), ref = retained.masterReference
  preview.candidateBodyFingerprint = candidate.bodyFingerprint; preview.masterBindingFingerprint = candidate.masterBindingFingerprint
  preview.inputFingerprint = candidate.inputFingerprint; preview.conversion.docxChecksum = candidate.artifact.outputChecksum
  const bytes = f.rendered.pages[0].buffer, pageReceipt = f.rendered.receipt.pages[0]
  preview.conversion.pages = Array.from({ length: 7 }, (_, i) => ({ ...pageReceipt, number: i + 1 }))
  preview.conversionFingerprint = membershipHash(preview.conversion)
  const planRef = source.plan, plan = { ...copy(m.plan), ...ref.scope, _id: planRef.recordId,
    ...Object.fromEntries(['planId', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].map(k => [k, planRef[k]])) }
  const master = { masterId: ref.masterId, version: ref.version, purpose: 'MEANING_SOURCE_ONLY', status: 'RECORDED_MEANING_SOURCE_ONLY',
    permittedUse: 'ISOLATED_ENGINEERING_TEST_ONLY', classification: candidate.classification, sourceFingerprint: ref.sourceFingerprint,
    sourceProjectionFingerprint: ref.sourceProjectionFingerprint,
    ...Object.fromEntries(['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable'].map(k => [k, false])) }
  args = { actorUserId: source.scope.actorUserId || '6a6c763dcace7a21bd41efa9', runtimeInstanceId: ref.scope.runtimeInstanceId,
    candidateId: candidate.candidateId, scopes: {}, deps: {
      readCandidate: async () => ({ candidate: copy(candidate), buffer: Buffer.from(compiled.buffer), candidateInput: copy(compiled.input), scope: copy(ref.scope) }),
      readPreview: async () => ({ preview: copy(preview), pages: Array.from({ length: 7 }, () => Buffer.from(bytes)) }),
      readMaster: async () => ({ master: copy(master), masterReference: copy(ref), sourceEnvelope: copy(envelope) }),
      loadPlan: async () => plan, assertPlanIntegrity: () => {}, loadPackContent: async query => query.packId === m.methodPack.packId
        ? { ...m.methodPack, available: true, content: m.methodContent }
        : { ...Object.values(source.selectedPacks).find(p => p.packId === query.packId), available: true, status: 'ACTIVE', contentFormat: 'MARKDOWN',
          content: retained.selectedDocuments.find(d => d.receipt.packId === query.packId).content },
    } }
  transport = await prepareApprovedMasterLinkedDocxReviewTransport(args)
})
afterAll(() => { expect(connect).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled(); connect.mockRestore(); network.mockRestore() })
test('builds a distinct private subject and exact seven-category request, with source limits still explicit', () => {
  const request = buildOpenAiApprovedMasterLinkedCategoryDocxReviewRequest(transport), wire = JSON.parse(request.serialized)
  expect(transport.subject.contractVersion).toBe('master-linked-docx-review-subject.v4')
  expect(transport.subject.policy).toMatchObject({ decision: 'PREPARATION_ONLY', schemaContentComplete: false,
    unresolvedFacts: ['NEXT_PERMITTED_OPERATIONAL_STEP', 'EXECUTION_APPROVER'], dispatchAvailable: false, externalDisclosureAvailable: false })
  expect(request.requestVersion).toBe('master-linked-docx-visual-review-request.v4')
  expect(wire.input[0].content.filter(c => c.type === 'input_image')).toHaveLength(7)
  expect(wire.text.format.schema.properties.findings.required).toEqual(RENDERED_EXPRESSION_RL_DIMENSIONS)
  expect(transport.context.expressionCompatibility.mappings).toHaveLength(11)
  expect(request.dispatchAvailable).toBe(false)
})
test('fake complete response decodes all seven categories without any review result or permission', () => {
  const decoded = normalizeMasterLinkedCategoryReviewResponse(JSON.stringify({ outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL,
    schemaVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION, overallStatus: 'PASS', findings: Object.fromEntries(RENDERED_EXPRESSION_RL_DIMENSIONS
      .map(d => [d, { status: 'PASS', finding: 'Synthetic protocol assertion only.', requiredChange: false }])) }))
  expect(decoded.findings).toHaveLength(7); expect(decoded.completionPersisted).toBeUndefined()
})
test('existing builders, preparation and genuine permission path reject the new candidate before I/O', async () => {
  expect(() => buildOpenAiMasterLinkedDocxReviewRequest(transport)).toThrow()
  expect(() => buildOpenAiMasterLinkedCategoryDocxReviewRequest(transport)).toThrow()
  await expect(prepareMasterLinkedDocxReviewTransport(args)).rejects.toThrow()
  expect(() => g1SubjectRoot(transport.subject, G1_CATEGORY_QA_REQUEST, G1_MODES.GENUINE)).toThrow()
  await expect(createGenuineMasterLinkedReviewAuthority().prepare({ actorUserId: args.actorUserId,
    runtimeInstanceId: args.runtimeInstanceId, candidateId: args.candidateId, approvalAuditId: 'a'.repeat(24),
    expected: buildOpenAiApprovedMasterLinkedCategoryDocxReviewRequest(transport).binding })).rejects.toMatchObject({ details: { reason: 'GENUINE_RELEASE_REQUIRED' } })
})
test('approved transport performs two fresh outer candidate observations; standalone binding retains its own two', async () => {
  const reader = jest.fn(args.deps.readCandidate), options = { ...args, deps: { ...args.deps, readCandidate: reader } }
  await prepareApprovedMasterLinkedDocxReviewTransport(options); expect(reader).toHaveBeenCalledTimes(2)
  reader.mockClear(); await prepareApprovedMasterLinkedDocxReviewBinding(options); expect(reader).toHaveBeenCalledTimes(2)
})
test.each(['body', 'master', 'input source', 'bytes', 'requirements', 'reader refusal'])('two-observation composition still rejects final %s drift', async kind => {
  let calls = 0
  const reader = async value => {
    const row = await args.deps.readCandidate(value)
    if (++calls === 2) {
      if (kind === 'reader refusal') throw Error('FINAL_SOURCE_UNAVAILABLE')
      if (kind === 'body') row.candidate.bodyFingerprint = 'a'.repeat(64)
      if (kind === 'master') row.candidate.masterBindingFingerprint = 'a'.repeat(64)
      if (kind === 'input source') row.candidateInput.sourceEnvelope.sourceFingerprint = 'a'.repeat(64)
      if (kind === 'bytes') row.buffer[0] ^= 1
      if (kind === 'requirements') row.candidateInput.selectedPacks.STYLE.contentHash = 'sha256:' + 'a'.repeat(64)
    }
    return row
  }
  await expect(prepareApprovedMasterLinkedDocxReviewTransport({ ...args, deps: { ...args.deps, readCandidate: reader } })).rejects.toThrow()
  expect(calls).toBe(2)
})
test('new approved preparation owns a finite twenty-minute deadline without changing older profiles', async () => {
  let time = 0
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => time)
  try {
    const readCandidate = async value => { const row = await args.deps.readCandidate(value); time = 700000; return row }
    await expect(prepareApprovedMasterLinkedDocxReviewTransport({ ...args, deps: { ...args.deps, readCandidate } })).resolves.toBeTruthy()
    time = 0
    await expect(prepareApprovedMasterLinkedDocxReviewTransport({ ...args, deps: { ...args.deps,
      readCandidate: async value => { const row = await args.deps.readCandidate(value); time = 1200001; return row } } })).rejects.toMatchObject({ details: { reason: 'PREPARATION_DEADLINE' } })
  } finally { clock.mockRestore() }
})
test.each(['source', 'compatibility', 'page', 'requirements', 'schema promotion', 'external disclosure'])('rejects changed %s preparation', kind => {
  const t = { ...copy({ ...transport, pages: [] }), pages: transport.pages.map(page => Buffer.from(page)) }
  if (kind === 'source') t.sourceEnvelope.sourceFingerprint = 'a'.repeat(64)
  if (kind === 'compatibility') t.subject.binding.compatibilityReference.decisionFingerprint = 'a'.repeat(64)
  if (kind === 'page') t.pages[6][0] = 0
  if (kind === 'requirements') t.subject.packs.STYLE.contentHash = 'sha256:' + 'a'.repeat(64)
  if (kind === 'schema promotion') t.context.expressionCompatibility.schemaContentComplete = true
  if (kind === 'external disclosure') t.subject.externalDisclosureAvailable = true
  expect(() => assertApprovedMasterLinkedDocxReviewTransport(t)).toThrow()
})
