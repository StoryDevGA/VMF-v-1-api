import { describe, expect, test } from '@jest/globals'
import mongoose from 'mongoose'
import { docxPagePreviewFixture } from './fixtures/docxPagePreviewFixture.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { previewHash } from '../services/docxPagePreviewRuntime.js'
import { assertDocxPagePreviewRecord, DOCX_PREVIEW_VERSION } from '../services/outcomeDocxPagePreviewRecordContract.js'
import { readConfiguredDocxPreviewRuntime } from '../services/outcomeDocxPagePreviewPersistenceService.js'

const fixture = () => {
  const f = docxPagePreviewFixture(), previewId = 'docx_preview_12345678-1234-4234-8234-123456789012'
  const body = { contractVersion: DOCX_PREVIEW_VERSION, previewId, candidateId: f.verified.candidate.candidateId, scope: f.scope,
    createdBy: f.actorUserId, createdAt: new Date().toISOString(), status: 'PRIVATE_PREVIEW_ONLY', classification: f.verified.candidate.classification,
    authoritative: false, officialUse: false, normalOutputAvailable: false, authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false,
    sourceFingerprint: f.verified.candidate.sourceFingerprint, inputFingerprint: f.verified.candidate.inputFingerprint,
    renderer: f.verified.candidate.renderer, conversion: f.rendered.receipt, conversionFingerprint: f.rendered.fingerprint }
  return { _id: new mongoose.Types.ObjectId(), ...f.scope, previewId, candidateId: body.candidateId,
    body, bodyFingerprint: membershipHash(body), docxChecksum: body.conversion.docxChecksum,
    runtimeFingerprint: f.runtime.fingerprint, auditId: new mongoose.Types.ObjectId(), auditSignatureVersion: 1,
    pageBytes: f.rendered.pages.map(page => page.buffer) }
}
const reseal = record => {
  record.body.conversionFingerprint = previewHash(JSON.stringify(record.body.conversion))
  record.bodyFingerprint = membershipHash(record.body)
}
describe('private preview record corruption boundaries', () => {
  test('accepts exact ordered PNG bytes', () => { const row = fixture(); expect(assertDocxPagePreviewRecord(row)[0].equals(row.pageBytes[0])).toBe(true) })
  test.each(['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable'])('rejects promoted %s even when resealed', key => {
    const row = fixture(); row.body[key] = true; reseal(row); expect(() => assertDocxPagePreviewRecord(row)).toThrow()
  })
  test.each(['docxChecksum', 'runtimeFingerprint', 'bodyFingerprint', 'candidateId', 'customerId'])('rejects changed top-level %s', key => {
    const row = fixture(); row[key] = '0'.repeat(64); expect(() => assertDocxPagePreviewRecord(row)).toThrow()
  })
  test.each(['number', 'width', 'height', 'byteLength', 'sha256'])('checks actual PNG %s against receipt', key => {
    const row = fixture(); row.body.conversion.pages[0][key] = key === 'sha256' ? '0'.repeat(64) : 999; reseal(row)
    expect(() => assertDocxPagePreviewRecord(row)).toThrow()
  })
  test('rejects unbounded BSON metadata even with a correct body fingerprint', () => {
    const row = fixture(); row.body.renderer = { value: 'x'.repeat(12 * 1024 ** 2) }; reseal(row)
    expect(() => assertDocxPagePreviewRecord(row)).toThrow('unavailable')
  })
  test.each([{ pages: [] }, { pages: [Buffer.from('not PNG')] }])('rejects missing or corrupt page arrays: %p', ({ pages }) => {
    const row = fixture(); row.pageBytes = pages; expect(() => assertDocxPagePreviewRecord(row)).toThrow()
  })
  test('unconfigured runtime is a structured safe refusal', async () => {
    const before = process.env.DOCX_PAGE_PREVIEW_RUNTIME_FILE
    delete process.env.DOCX_PAGE_PREVIEW_RUNTIME_FILE
    try { await expect(readConfiguredDocxPreviewRuntime()).rejects.toMatchObject({ status: 503, code: 'DOCX_PREVIEW_BLOCKED', details: { reason: 'PREVIEW_RUNTIME_NOT_READY' } }) }
    finally { if (before !== undefined) process.env.DOCX_PAGE_PREVIEW_RUNTIME_FILE = before }
  })
})
