import { test, expect } from '@jest/globals'
import JSZip from 'jszip'
import { governedDocxFixture } from './fixtures/governedDocxCandidateFixture.js'
import { buildGovernedPrivateDocxInput, compileGovernedPrivateDocxInput } from '../services/outcomeGovernedDocxCandidateService.js'
import { assertDocxSourceQualificationPresentation } from '../services/docxSourceQualificationPresentation.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { assertPrivateDocxCandidateRecord } from '../services/outcomeDocxCandidateRecordContract.js'

const fullBoundary = 'These three quoted statements must not be read as assigning an execution approver, defining an approval procedure, or granting permission after review. This is descriptive organisation of the recorded question and outstanding review, not an adopted approval process. This paper assigns no such authority and adopts no decision.'
const compressed = 'They do not assign an execution approver, define an approval procedure, adopt a decision or grant permission after review.'
const predecessor = { candidateId: 'docx_candidate_11111111-1111-4111-8111-111111111111', inputFingerprint: 'a'.repeat(64),
  outputChecksum: `sha256:${'b'.repeat(64)}`, failedReviewExecutionId: `master_docx_result_${'c'.repeat(40)}`,
  failedReviewResultFingerprint: 'd'.repeat(64) }
// Unsigned projections for local compiler checks only. This fixture does not
// establish source admission, a historical review or permission to dispatch.
const fixture = () => {
  const f = governedDocxFixture()
  f.shaping.expressionProfileVersion = 'outcome-commercial-expression.v4'
  f.envelope.source.content.workingDraft = { sections: f.shaping.sections.map((section, index) => ({
    sectionKey: section.sectionKey, title: index === 12 ? 'Recorded question and review context' : `Role ${index + 1}`,
    content: index === 12 ? `Quoted context.\n\n${fullBoundary}` : `Original content ${index + 1}.`,
  })) }
  f.shaping.sections[12].body = `${compressed}\n\n> Trial execution is not authorised.\n\n> Access review remains outstanding.`
  f.seal()
  return { ...f, correctionPredecessor: { ...predecessor } }
}

test('actual Word output exposes fourteen native roles and preserves messages, quotes, qualification blocks and private status', async () => {
  const f = fixture(), before = JSON.stringify(f), result = await compileGovernedPrivateDocxInput(f)
  expect(JSON.stringify(f)).toBe(before)
  expect(result).toMatchObject({ status: 'PRIVATE_UNREVIEWED', officialUse: false, normalOutputAvailable: false,
    authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false })
  expect(result.input.contractVersion).toBe('governed-private-docx-input.v2')
  expect(result.input.sourceEnvelope).toEqual(f.envelope)
  expect(result.input.expressionCorrection.predecessor).toEqual(predecessor)
  expect(result.inputFingerprint).toBe(membershipHash(result.input))
  const sections = result.input.model.sections
  for (const [index, section] of sections.entries()) {
    expect(section.key).toBe(f.shaping.sections[index].sectionKey)
    expect(section.heading).toBe(f.shaping.sections[index].heading)
    expect(section.qualificationMarkdown).toBe(f.shaping.sections[index].qualification)
    expect(section.truthReferences).toEqual(f.shaping.sections[index].truthReferences)
    if (index !== 12) expect(section.bodyMarkdown).toBe(f.shaping.sections[index].body)
  }
  expect(sections[12].bodyMarkdown).toBe(`> Trial execution is not authorised.\n\n> Access review remains outstanding.\n\n${fullBoundary}`)
  expect(sections[12].restoredParagraphSourcePath).toBe('workingDraft.sections[12].content')
  const zip = await JSZip.loadAsync(result.buffer), xml = await zip.file('word/document.xml').async('string')
  expect(xml.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(14)
  expect(xml.match(/<w:pStyle w:val="Heading2"\/>/g)).toHaveLength(14)
  expect(xml).toContain('13. Recorded question and review context')
  expect(xml).toContain(fullBoundary)
  expect(xml).not.toContain(compressed)
  expect(xml).toContain('Trial execution is not authorised.')
  expect(xml).toContain('Access review remains outstanding.')
  expect(xml).not.toContain(predecessor.candidateId)
  expect(xml).not.toContain(predecessor.failedReviewExecutionId)
  expect(xml).not.toContain('PRIVATE_UNREVIEWED')
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)
  expect(paragraphs.filter(p => p.includes('<w:top ') && p.includes('<w:bottom '))).toHaveLength(14)
  expect(assertDocxSourceQualificationPresentation(result.input)).toHaveLength(14)
})

test('legacy compiler and bytes remain unchanged when correction is not requested', async () => {
  const f = fixture(), { correctionPredecessor, ...legacy } = f
  const first = await compileGovernedPrivateDocxInput(legacy)
  await compileGovernedPrivateDocxInput(f)
  const after = await compileGovernedPrivateDocxInput(legacy)
  expect(first.input).toEqual(after.input)
  expect(first.buffer.equals(after.buffer)).toBe(true)
  expect(first.input.contractVersion).toBe('governed-private-docx-input.v1')
  expect(first.input.model.sections[12].bodyMarkdown).toBe(f.shaping.sections[12].body)
  expect(first.input).not.toHaveProperty('expressionCorrection')
  expect(correctionPredecessor).toEqual(predecessor)
})

test('legacy storage accepts its valid v1 record but rejects the real corrected input after fingerprints are recomputed', async () => {
  const f = fixture(), { correctionPredecessor, ...legacy } = f
  const old = await compileGovernedPrivateDocxInput(legacy), corrected = await compileGovernedPrivateDocxInput(f)
  const scope = Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map(key => [key, f.envelope.source.scope[key]]))
  const body = { contractVersion: 'private-docx-candidate.v1', candidateId: predecessor.candidateId, scope,
    requestKey: '11111111-1111-4111-8111-111111111111',
    requestFingerprint: membershipHash({ expectedSourceFingerprint: f.envelope.sourceFingerprint, format: 'DOCX' }),
    createdBy: '507f1f77bcf86cd799439011', createdAt: '2026-11-02T00:00:00.000Z',
    classification: old.classification, status: 'PRIVATE_UNREVIEWED', authoritative: false, officialUse: false,
    normalOutputAvailable: false, authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false,
    sourceFingerprint: f.envelope.sourceFingerprint, inputFingerprint: old.inputFingerprint, input: old.input,
    artifact: old.artifact, packageValidation: old.packageValidation }
  const record = { ...scope, candidateId: body.candidateId, requestKey: body.requestKey,
    requestFingerprint: body.requestFingerprint, body, bodyFingerprint: membershipHash(body), fileBytes: old.buffer,
    auditId: '507f1f77bcf86cd799439012', auditSignatureVersion: 2 }
  expect(assertPrivateDocxCandidateRecord(record).equals(old.buffer)).toBe(true)
  Object.assign(body, { input: corrected.input, inputFingerprint: corrected.inputFingerprint,
    artifact: corrected.artifact, packageValidation: corrected.packageValidation })
  record.fileBytes = corrected.buffer; record.bodyFingerprint = membershipHash(body)
  expect(() => assertPrivateDocxCandidateRecord(record)).toThrow(expect.objectContaining({
    code: 'PRIVATE_DOCX_CANDIDATE_BLOCKED', details: { reason: 'STORED_RECEIPT_INVALID', contentIncludedInError: false },
  }))
  expect(correctionPredecessor).toEqual(predecessor)
})

test.each([
  ['unknown correction version', input => { input.expressionCorrection.contractVersion = 'future' }],
  ['extra predecessor authority', input => { input.expressionCorrection.predecessor.authorisesReview = true }],
  ['invalid review identity', input => { input.expressionCorrection.predecessor.failedReviewExecutionId = 'invented' }],
  ['role replaced', input => { input.model.sections[0].roleLabel = 'Approved decision' }],
  ['role source path replaced', input => { input.model.sections[0].roleSourcePath = 'other' }],
  ['governance source path omitted', input => { delete input.model.sections[12].restoredParagraphSourcePath }],
  ['body altered', input => { input.model.sections[1].bodyMarkdown = 'Trial approved.' }],
  ['qualification altered', input => { input.model.sections[0].qualificationMarkdown = 'No limits.' }],
  ['truth references changed', input => { input.model.sections[0].truthReferences = [] }],
  ['sections reordered', input => { input.model.sections.reverse() }],
  ['flattened headings', input => { input.markdown = input.markdown.replace('# 1. Role 1', '## 1. Role 1') }],
  ['version downgrade', input => { input.contractVersion = 'governed-private-docx-input.v1' }],
  ['source changed', input => { input.sourceEnvelope.source.content.shaping.sections[0].body = 'Changed source' }],
])('rejects %s even when an outer caller could recompute fingerprints', (_name, mutate) => {
  const input = buildGovernedPrivateDocxInput(fixture())
  mutate(input)
  expect(() => assertDocxSourceQualificationPresentation(input)).toThrow()
})

test.each([
  ['unknown source profile', f => { f.shaping.expressionProfileVersion = 'future' }],
  ['missing full boundary', f => { f.envelope.source.content.workingDraft.sections[12].content = 'No paragraph.' }],
  ['ambiguous full boundary', f => { f.envelope.source.content.workingDraft.sections[12].content = `${fullBoundary}\n\n${fullBoundary}` }],
  ['unrecognised compressed boundary', f => { f.shaping.sections[12].body = 'A different approval meaning.' }],
  ['role includes Markdown', f => { f.envelope.source.content.workingDraft.sections[0].title = '*Approved*' }],
  ['draft section order mismatch', f => { f.envelope.source.content.workingDraft.sections.reverse() }],
  ['missing lineage', f => { f.correctionPredecessor = null }],
])('refuses %s before rendering', (_name, mutate) => {
  const f = fixture(); mutate(f); f.seal()
  expect(() => buildGovernedPrivateDocxInput(f)).toThrow()
})

test.each(Object.keys(predecessor))('lineage field %s must be a scalar string, not a coercible array', key => {
  const f = fixture()
  f.correctionPredecessor[key] = [f.correctionPredecessor[key]]
  expect(() => buildGovernedPrivateDocxInput(f)).toThrow()
  const input = buildGovernedPrivateDocxInput(fixture())
  input.expressionCorrection.predecessor[key] = [input.expressionCorrection.predecessor[key]]
  expect(() => assertDocxSourceQualificationPresentation(input)).toThrow()
})
