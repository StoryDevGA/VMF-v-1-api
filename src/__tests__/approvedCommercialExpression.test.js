import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import JSZip from 'jszip'
import { compileGovernedPrivateDocxInput } from '../services/outcomeGovernedDocxCandidateService.js'
import { APPROVED_EXPRESSION_VERSION, APPROVED_EXPRESSION_FIXED as fixed, APPROVED_SECTION13_STATE,
  APPROVED_SECTION13_BOUNDARY, buildApprovedQualificationMapping, assertApprovedCommercialExpression } from '../services/commercialDocxApprovedExpression.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { approvedMasterLinkedRequestFingerprint, masterBindingFromBridge, APPROVED_MASTER_WRAPPER_VERSION,
  APPROVED_MASTER_EXPRESSION_ORIGIN } from '../services/outcomeMasterLinkedDocxContract.js'
import { assertPrivateDocxCandidateRecord } from '../services/outcomeDocxCandidateRecordContract.js'
import { assertMasterLinkedReviewInput } from '../services/outcomeMasterLinkedDocxReviewBindingService.js'
import { privateDocxCandidateCreateSchema, approvedMasterLinkedDocxCandidateCreateSchema } from '../validators/outcomeDocxCandidate.validator.js'

const retained = JSON.parse(readFileSync(new URL('./fixtures/approvedCommercialSource.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value))
const hash = value => createHash('sha256').update(value).digest('hex')
const fixture = () => {
  const envelope = copy(retained.sourceEnvelope), source = envelope.source
  const documents = source.content.shaping.outputContract.packs.map(pack => ({ source: { ...pack, contentFormat: 'MARKDOWN' },
    content: retained.selectedDocuments.find(d => d.receipt.packId === pack.packId).content }))
  const audienceDocument = { ...source.selectedPacks.AUDIENCE, available: true, status: 'ACTIVE', contentFormat: 'MARKDOWN',
    content: retained.selectedDocuments.find(d => d.layer === 'AUDIENCE').content }
  const approvedCompatibilityReference = { version: APPROVED_EXPRESSION_VERSION, auditId: 'a'.repeat(24), decisionFingerprint: 'b'.repeat(64),
    mappingFingerprint: membershipHash(buildApprovedQualificationMapping(envelope)), masterId: fixed.masterId,
    sourceFingerprint: fixed.sourceFingerprint, predecessorCandidateId: fixed.predecessorCandidateId,
    failedReviewExecutionId: fixed.failedReviewExecutionId, failedReviewResultFingerprint: fixed.failedReviewResultFingerprint,
    section13State: APPROVED_SECTION13_STATE }
  return { envelope, documents, audienceDocument, approvedCompatibilityReference }
}
let prepared
beforeAll(async () => { prepared = await compileGovernedPrivateDocxInput(fixture()) })

test('eleven source bindings retain original order and only the approved coded expressions change', () => {
  const f = fixture(), mapping = buildApprovedQualificationMapping(f.envelope)
  expect(mapping).toHaveLength(11)
  expect(mapping.filter(m => m.source === 'ss044-synthetic-pilot-r1.txt')).toHaveLength(6)
  expect(mapping.filter(m => m.source === 'controlled-synthetic-source-capture.docx')).toHaveLength(5)
  expect(mapping.filter(m => m.original === m.customerExpression)).toHaveLength(5)
  expect(new Set(mapping.map(m => m.customerExpression)).size).toBe(6)
  expect(mapping.filter(m => m.original.startsWith('Current R2')).every(m => m.customerExpression.startsWith('The cited source revision records'))).toBe(true)
  expect(mapping.filter(m => m.original.startsWith('Legacy text')).every(m => m.source === 'ss044-synthetic-pilot-r1.txt')).toBe(true)
  expect(mapping.some(m => /contradiction_[a-f\d]+|\b(?:R1|R2|SOURCE_PRESENTED|UNREVIEWED|VALIDATED|ACCEPTED)\b/.test(m.customerExpression))).toBe(false)
})

test('actual new Word file has fourteen roles, exact quotations, native labels, approved restrictions and no boxed generic qualification pointers', async () => {
  const f = fixture(), original = JSON.stringify(f), compiled = await compileGovernedPrivateDocxInput(f)
  expect(JSON.stringify(f)).toBe(original)
  expect(compiled.input.sourceEnvelope).toEqual(retained.sourceEnvelope)
  expect(compiled.input.renderer).toMatchObject({ version: '0.1.4', qualificationPolicy: 'SOURCE_QUALIFICATION_PARAGRAPHS_V2' })
  expect(compiled).toMatchObject({ status: 'PRIVATE_UNREVIEWED', officialUse: false, authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false })
  const input = compiled.input, zip = await JSZip.loadAsync(compiled.buffer), xml = await zip.file('word/document.xml').async('string')
  expect(xml.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(14)
  expect(xml.match(/<w:pStyle w:val="Heading2"\/>/g)).toHaveLength(14)
  expect(xml).toContain('13. Next legal downstream action')
  expect(xml).toContain('Recorded question and review context')
  expect(xml).toContain(APPROVED_SECTION13_BOUNDARY)
  for (const label of ['Question under consideration', 'Outstanding access review, from its own source', 'Source statement about permission']) expect(xml).toContain(label)
  expect(xml).toContain(input.sourceEnvelope.source.content.workingDraft.sections[12].content.split('\n\n').at(-1))
  expect(xml).not.toContain('Quotation limits apply only to:')
  expect(xml).not.toContain('<w:top ')
  expect(xml).not.toMatch(/contradiction_[a-f\d]+|SOURCE_PRESENTED|UNREVIEWED|PRIVATE_UNREVIEWED/)
  const quotations = input.markdown.match(/^> .+$/gm)
  expect(quotations).toHaveLength(23)
  expect(quotations.every(q => retained.sourceEnvelope.source.content.workingDraft.sections.some(s => s.content.includes(q)))).toBe(true)
  for (const mapping of buildApprovedQualificationMapping(f.envelope)) expect(input.markdown).toContain(mapping.customerExpression)
  for (const section of input.model.sections.slice(1, 13)) {
    const usesText = section.bodyMarkdown.includes('**Source: ss044-synthetic-pilot-r1.txt**')
    expect(section.qualificationMarkdown.includes('Legacy text-source location')).toBe(usesText)
  }
  expect(assertApprovedCommercialExpression(input)).toEqual(f.approvedCompatibilityReference)
})

test('old source, v1 Word bytes and v2 correction bytes remain byte-identical', async () => {
  const f = fixture(), { approvedCompatibilityReference, ...base } = f
  const old = await compileGovernedPrivateDocxInput(base)
  expect(hash(old.buffer)).toBe('a97d7831465cf5f13dab5acee6946d31d6acce00c93214619cfa09657800ff00')
  const correctionPredecessor = { candidateId: 'docx_candidate_45e4cd08-6750-4ebf-88d2-a97c81dc3d4b',
    inputFingerprint: old.inputFingerprint, outputChecksum: old.artifact.outputChecksum,
    failedReviewExecutionId: 'master_docx_result_5766391dc7a21de7c6dfcb591a0c5bc2ef98909f',
    failedReviewResultFingerprint: 'd1156af367532dbdcdfecedd7c32bb04142aa765f389efbeb77a892b1f34606f' }
  const previous = await compileGovernedPrivateDocxInput({ ...base, correctionPredecessor })
  expect(hash(previous.buffer)).toBe('da0cac47f6341732477992fc211f66ee020e0d46997c2c6d5554d8484be59421')
  expect((await compileGovernedPrivateDocxInput(base)).buffer.equals(old.buffer)).toBe(true)
  expect(approvedCompatibilityReference.sourceFingerprint).toBe(fixed.sourceFingerprint)
})

test.each([
  ['missing signed-decision reference', f => { delete f.approvedCompatibilityReference.auditId }],
  ['array audit identity', f => { f.approvedCompatibilityReference.auditId = ['a'.repeat(24)] }],
  ['wrapped string audit identity', f => { f.approvedCompatibilityReference.auditId = Object('a'.repeat(24)) }],
  ['wrong mapping', f => { f.approvedCompatibilityReference.mappingFingerprint = '0'.repeat(64) }],
  ['wrong source', f => { f.approvedCompatibilityReference.sourceFingerprint = '0'.repeat(64) }],
  ['wrong predecessor', f => { f.approvedCompatibilityReference.predecessorCandidateId = 'docx_candidate_11111111-1111-4111-8111-111111111111' }],
  ['wrong failed receipt', f => { f.approvedCompatibilityReference.failedReviewResultFingerprint = '0'.repeat(64) }],
  ['invented authority state', f => { f.approvedCompatibilityReference.section13State = 'APPROVED_AFTER_ACCESS_REVIEW' }],
  ['source changed and resealed', f => { f.envelope.source.content.workingDraft.sections[13].content += '\nNew authority.'; f.envelope.sourceFingerprint = membershipHash(f.envelope.source) }],
  ['mixed correction mode', f => { f.correctionPredecessor = {} }],
])('refuses %s before producing a candidate', async (_label, mutate) => {
  const f = fixture(); mutate(f)
  await expect(compileGovernedPrivateDocxInput(f)).rejects.toThrow()
})

test.each([
  ['new execution permission', input => { input.model.sections[12].bodyMarkdown += '\nExecution is approved.' }],
  ['wrong source applicability', input => { input.model.sections[2].qualificationMarkdown += '\nCapture document has no native text span.' }],
  ['missing mapped qualification', input => { input.presentation.approvedQualificationMapping.mappings.pop() }],
  ['new renderer engine', input => { input.renderer.engine.version = 'unreviewed-engine' }],
  ['boxed old qualification policy', input => { input.renderer.qualificationPolicy = 'SOURCE_QUALIFICATION_CALLOUT_V1' }],
  ['unbound extra authority', input => { input.expressionCorrection.businessApproved = true }],
  ['unbound top-level authority', input => { input.approvedForExecution = true }],
])('strict v3 reconstruction refuses %s even with a new outer fingerprint', (_label, mutate) => {
  const input = copy(prepared.input); mutate(input)
  expect(membershipHash(input)).not.toBe(prepared.inputFingerprint)
  expect(() => assertApprovedCommercialExpression(input)).toThrow()
})

test('new record branch binds the same wrapper, master and authority while old review input refuses v3', () => {
  const f = fixture(), input = copy(prepared.input), compatibilityReference = f.approvedCompatibilityReference
  const wrapper = { contractVersion: APPROVED_MASTER_WRAPPER_VERSION, masterReference: retained.masterReference,
    expressionOrigin: APPROVED_MASTER_EXPRESSION_ORIGIN, renditionInput: input, renditionInputFingerprint: prepared.inputFingerprint,
    outputChecksum: prepared.artifact.outputChecksum, compatibilityReference }
  const masterBinding = masterBindingFromBridge({ input: wrapper, inputFingerprint: membershipHash(wrapper) })
  const body = { contractVersion: 'private-docx-candidate.v2', candidateId: 'docx_candidate_11111111-1111-4111-8111-111111111111',
    scope: retained.masterReference.scope, requestKey: '11111111-1111-4111-8111-111111111111',
    requestFingerprint: approvedMasterLinkedRequestFingerprint(retained.masterReference, input.renderer, compatibilityReference),
    createdBy: fixed.actorUserId, createdAt: '2026-11-03T20:00:00.000Z', classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST',
    status: 'PRIVATE_UNREVIEWED', authoritative: false, officialUse: false, normalOutputAvailable: false,
    authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false,
    sourceFingerprint: fixed.sourceFingerprint, inputFingerprint: prepared.inputFingerprint,
    input, artifact: prepared.artifact, packageValidation: prepared.packageValidation, masterBinding }
  const record = { _id: new mongoose.Types.ObjectId(), ...body.scope, candidateId: body.candidateId,
    requestKey: body.requestKey, requestFingerprint: body.requestFingerprint, body, bodyFingerprint: membershipHash(body),
    fileBytes: prepared.buffer, auditId: new mongoose.Types.ObjectId(), auditSignatureVersion: 3 }
  expect(assertPrivateDocxCandidateRecord(record).equals(prepared.buffer)).toBe(true)
  for (const badId of [['a'.repeat(24)], Object('a'.repeat(24))]) {
    const changed = copy(body)
    changed.input.expressionCorrection.compatibilityReference.auditId = badId
    changed.masterBinding.compatibilityReference.auditId = badId
    // Scalar-wrapper objects are rejected even by canonical hashing; arrays
    // can be rehashed and must still be rejected by the typed record contract.
    expect(() => {
      changed.inputFingerprint = membershipHash(changed.input)
      changed.requestFingerprint = approvedMasterLinkedRequestFingerprint(retained.masterReference, input.renderer, changed.masterBinding.compatibilityReference)
      const changedWrapper = { ...wrapper, renditionInput: changed.input, renditionInputFingerprint: changed.inputFingerprint,
        compatibilityReference: changed.masterBinding.compatibilityReference }
      changed.masterBinding.wrapperFingerprint = membershipHash(changedWrapper)
      assertPrivateDocxCandidateRecord({ ...record, body: changed, bodyFingerprint: membershipHash(changed), requestFingerprint: changed.requestFingerprint })
    }).toThrow()
  }
  expect(() => assertMasterLinkedReviewInput(input, masterBinding, body.candidateId, body.artifact.outputChecksum))
    .toThrow(expect.objectContaining({ code: 'MASTER_LINKED_REVIEW_BINDING_BLOCKED', details: { reason: 'REVIEW_INPUT_VERSION_PAIR', dispatchAvailable: false } }))
  body.masterBinding.compatibilityReference.decisionFingerprint = 'c'.repeat(64); record.bodyFingerprint = membershipHash(body)
  expect(() => assertPrivateDocxCandidateRecord(record)).toThrow()
})

test('the public create validator rejects new internal authority fields', () => {
  const payload = { requestKey: '11111111-1111-4111-8111-111111111111', expectedSourceFingerprint: fixed.sourceFingerprint,
    format: 'DOCX', masterId: fixed.masterId, masterVersion: 1, expectedMasterBodyFingerprint: retained.masterReference.bodyFingerprint,
    compatibilityAuditId: 'a'.repeat(24), expectedCompatibilityFingerprint: 'b'.repeat(64) }
  expect(approvedMasterLinkedDocxCandidateCreateSchema.safeParse(payload).success).toBe(true)
  expect(privateDocxCandidateCreateSchema.safeParse(payload).success).toBe(false)
  expect(approvedMasterLinkedDocxCandidateCreateSchema.safeParse({ ...payload, approval: { businessApproved: true } }).success).toBe(false)
})
