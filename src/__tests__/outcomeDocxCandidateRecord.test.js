import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Candidate from '../models/OutcomeDocxRenditionCandidate.js'
import Audit from '../models/AuditLog.js'
import { governedDocxFixture } from './fixtures/governedDocxCandidateFixture.js'
import { compileGovernedPrivateDocxInput } from '../services/outcomeGovernedDocxCandidateService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { renderProfessionalDocumentCandidate } from '../services/professionalDocumentCandidateRenderer.js'
import { PRIVATE_DOCX_CANDIDATE_VERSION, assertPrivateDocxCandidateRecord, assertPrivateDocxCandidateAudit,
  privateDocxAuditDiff, privateDocxBytes, privateDocxByteHash } from '../services/outcomeDocxCandidateRecordContract.js'

const recordFixture = async () => {
  const f = governedDocxFixture()
  const scope = { tenantId: '507f1f77bcf86cd799439011', customerId: '507f1f77bcf86cd799439012', runtimeInstanceId: '507f1f77bcf86cd799439013' }
  Object.assign(f.envelope.source.scope, scope); f.seal()
  const compiled = await compileGovernedPrivateDocxInput(f)
  const requestFingerprint = membershipHash({ expectedSourceFingerprint: f.envelope.sourceFingerprint, format: 'DOCX' })
  const body = { contractVersion: PRIVATE_DOCX_CANDIDATE_VERSION, candidateId: `docx_candidate_${randomUUID()}`,
    scope, requestKey: randomUUID(), requestFingerprint, createdBy: '507f1f77bcf86cd799439014', createdAt: '2026-10-28T12:00:00.000Z',
    classification: compiled.classification, status: 'PRIVATE_UNREVIEWED', authoritative: false, officialUse: false,
    normalOutputAvailable: false, authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false,
    sourceFingerprint: f.envelope.sourceFingerprint, inputFingerprint: compiled.inputFingerprint, input: compiled.input,
    artifact: compiled.artifact, packageValidation: compiled.packageValidation }
  const record = { _id: new mongoose.Types.ObjectId(), ...scope, candidateId: body.candidateId, requestKey: body.requestKey,
    requestFingerprint, body, bodyFingerprint: membershipHash(body), fileBytes: compiled.buffer,
    auditId: new mongoose.Types.ObjectId(), auditSignatureVersion: 2 }
  const audit = new Audit({ _id: record.auditId, actorUserId: body.createdBy, action: 'OUTCOME_DOCX_CANDIDATE_CREATED',
    resourceType: 'OutcomeDocxRenditionCandidate', resourceId: record._id, scope, diff: privateDocxAuditDiff(record) })
  audit.generateSignature(); record.auditSignatureVersion = audit.signatureVersion
  return { record, audit: audit.toObject(), rehash: () => { record.bodyFingerprint = membershipHash(record.body) } }
}

test('immutable model accepts actual compiled bytes and the exact signed creation receipt', async () => {
  const f = await recordFixture(), document = new Candidate(f.record)
  await expect(document.validate()).resolves.toBeUndefined()
  expect(assertPrivateDocxCandidateRecord(document.toObject()).equals(f.record.fileBytes)).toBe(true)
  expect(() => assertPrivateDocxCandidateAudit(f.record, f.audit, row => Audit.hydrate(row).verifySignature())).not.toThrow()
  expect(Candidate.schema.options.autoCreate).toBe(false)
  expect(Candidate.schema.options.autoIndex).toBe(false)
  document.isNew = false
  await expect(document.save()).rejects.toMatchObject({ details: { reason: 'CANDIDATE_IMMUTABLE' } })
  await expect(Candidate.updateOne({}, { $set: { body: {} } })).rejects.toMatchObject({ details: { reason: 'CANDIDATE_IMMUTABLE' } })
})

test('historical renderer remains readable and unsupported presentation combinations reject', async () => {
  const f = await recordFixture(), body = f.record.body, input = body.input
  const resealInput = () => { body.inputFingerprint = membershipHash(input); f.rehash() }
  input.renderer.version = '0.1.1'
  resealInput()
  expect(() => assertPrivateDocxCandidateRecord(f.record)).toThrow()
  delete input.renderer.presentationProfile
  delete input.presentation
  input.model.title = input.sourceEnvelope.source.content.shaping.title
  input.markdown = input.markdown.replace(/^# [^\n]+/, `# ${input.model.title}`)
  input.documentMetadata = { ...input.documentMetadata, title: input.model.title, status: 'DRAFT' }
  const legacy = await renderProfessionalDocumentCandidate({ documentMetadata: input.documentMetadata,
    markdown: input.markdown, layoutProfile: input.renderer.layoutProfile })
  f.record.fileBytes = legacy.buffer
  body.artifact = { ...body.artifact, byteLength: legacy.buffer.length, outputChecksum: privateDocxByteHash(legacy.buffer) }
  resealInput()
  expect(() => assertPrivateDocxCandidateRecord(f.record)).not.toThrow()
  input.renderer.version = '0.1.3'; resealInput()
  expect(() => assertPrivateDocxCandidateRecord(f.record)).toThrow()
})

test.each(['titleRule', 'titleSourcePath', 'originalSourceTitle'])('new records require their bound %s', async field => {
  const f = await recordFixture()
  delete f.record.body.input.presentation[field]
  f.record.body.inputFingerprint = membershipHash(f.record.body.input); f.rehash()
  expect(() => assertPrivateDocxCandidateRecord(f.record)).toThrow()
})

test('version 0.1.2 remains readable without the new qualification receipt', async () => {
  const f = await recordFixture(), body = f.record.body, input = body.input
  input.renderer.version = '0.1.2'
  delete input.renderer.qualificationPolicy
  delete input.presentation.qualificationCallouts
  const rendered = await renderProfessionalDocumentCandidate({ documentMetadata: input.documentMetadata,
    markdown: input.markdown, layoutProfile: input.renderer.layoutProfile, presentationProfile: input.renderer.presentationProfile })
  f.record.fileBytes = rendered.buffer
  body.artifact = { ...body.artifact, byteLength: rendered.buffer.length, outputChecksum: privateDocxByteHash(rendered.buffer) }
  body.inputFingerprint = membershipHash(input); f.rehash()
  expect(() => assertPrivateDocxCandidateRecord(f.record)).not.toThrow()
})

test.each(['missing', 'shifted', 'foreign source', 'changed qualification', 'unknown field'])('stored qualification validation rejects %s after outer fingerprints are recomputed', async kind => {
  const f = await recordFixture(), input = f.record.body.input
  const receipt = input.presentation.qualificationCallouts
  if (kind === 'missing') delete input.presentation.qualificationCallouts
  if (kind === 'shifted') receipt.blocks[0].blockIndex--
  if (kind === 'foreign source') receipt.blocks[0].sourcePath = 'shaping.sections[0].body'
  if (kind === 'changed qualification') input.model.sections[0].qualificationMarkdown += ' Altered.'
  if (kind === 'unknown field') receipt.extra = 'unbound'
  f.record.body.inputFingerprint = membershipHash(input); f.rehash()
  expect(() => assertPrivateDocxCandidateRecord(f.record)).toThrow()
})

test.each([
  ['bytes', f => { f.record.fileBytes = Buffer.from('Changed') }],
  ['body', f => { f.record.body.createdAt = '2026-10-29T00:00:00.000Z' }],
  ['scope', f => { f.record.customerId = '507f1f77bcf86cd799439015' }],
  ['missing hold', f => { delete f.record.body.deliveryAvailable; f.rehash() }],
  ['official use', f => { f.record.body.officialUse = true; f.rehash() }],
  ['input fingerprint', f => { f.record.body.inputFingerprint = '0'.repeat(64); f.rehash() }],
  ['missing audit join', f => { delete f.record.auditId }],
])('rejects %s without default repair', async (_name, change) => {
  const f = await recordFixture(); change(f)
  expect(() => assertPrivateDocxCandidateRecord(f.record)).toThrow()
})

test('valid checksum cannot make an invalid package acceptable and BSON size includes metadata', async () => {
  const f = await recordFixture(); f.record.fileBytes = Buffer.from('Not a DOCX')
  f.record.body.artifact = { ...f.record.body.artifact, byteLength: f.record.fileBytes.length, outputChecksum: privateDocxByteHash(f.record.fileBytes) }; f.rehash()
  await expect(new Candidate(f.record).validate()).rejects.toThrow()
  const large = await recordFixture()
  large.record.body.input.unexpectedLargeMetadata = 'x'.repeat(12 * 1024 * 1024)
  large.record.body.inputFingerprint = membershipHash(large.record.body.input); large.rehash()
  expect(() => assertPrivateDocxCandidateRecord(large.record)).toThrow(expect.objectContaining({ details: { reason: 'STORED_BSON_LIMIT', contentIncludedInError: false } }))
})

test('Mongo binary conversion preserves exact bytes and rejects loose buffer-shaped JSON', () => {
  const bytes = Buffer.from([0, 1, 255])
  expect(privateDocxBytes(new mongoose.mongo.Binary(bytes)).equals(bytes)).toBe(true)
  expect(() => privateDocxBytes({ type: 'Buffer', data: [0, 1, 255] })).toThrow()
})

test.each(['signature', 'diff', 'scope', 'actor', 'missing version'])('rejects %s audit tampering', async kind => {
  const f = await recordFixture()
  if (kind === 'signature') f.audit.signature = '0'.repeat(64)
  if (kind === 'diff') f.audit.diff.byteLength++
  if (kind === 'scope') f.audit.scope.customerId = new mongoose.Types.ObjectId()
  if (kind === 'actor') f.audit.actorUserId = new mongoose.Types.ObjectId()
  if (kind === 'missing version') delete f.audit.signatureVersion
  expect(() => assertPrivateDocxCandidateAudit(f.record, f.audit, row => Audit.hydrate(row).verifySignature())).toThrow()
})
