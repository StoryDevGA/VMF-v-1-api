import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, test } from '@jest/globals'
import { CONTROLLED_DOCX_READ_VERSION, CORRECTED_DOCX_READ_VERSION, CONTROLLED_DOCX_READ_LIMITS,
  controlledReadProfile, controlledScope, assertControlledReadRequest, assertControlledReadData } from '../services/controlledDocxReadContract.js'
import { APPROVED_DOCX_READ_VERSION, APPROVED_DOCX_OPERATION_LIMITS,
  NARROW_DOCX_READ_VERSION as version, NARROW_DOCX_RESULT_VERSION, NARROW_DOCX_READ_SELECTION as selected,
  NARROW_DOCX_READ_HASHES, NARROW_DOCX_READ_PREVIEW_HASHES, NARROW_DOCX_READ_PAGES } from '../services/approvedDocxReadProfile.js'

// Actual saved metadata only. No PNG bytes, database read, native admission,
// browser result, review or customer approval is supplied by this unit fixture.
const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/narrowDocxReadFixture.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value))
const jsonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const profile = controlledReadProfile(version)
const scope = Object.fromEntries(['actorUserId', 'customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, profile.identity[key]]))
const list = () => ({ scope: controlledScope(), sourceFingerprint: metadata.candidate.sourceFingerprint, candidates: [copy(metadata.candidate)] })
const previewMetadata = () => ({ preview: copy(metadata.preview),
  pages: metadata.preview.conversion.pages.map(page => ({ number: page.number, mimeType: 'image/png', base64: 'AAAA' })),
  document: { title: metadata.candidate.selectedPacks.OUTPUT_TYPE.label, markdown: 'Metadata-only refusal fixture.',
    inputFingerprint: metadata.candidate.inputFingerprint } })
const refuses = (operation, data, reason) => expect(() => assertControlledReadData(operation, data, version))
  .toThrow(expect.objectContaining({ details: { reason } }))

test('V4 pins the exact saved correction and seven measured page receipts without changing old read caps', () => {
  expect(profile).toMatchObject({ resultVersion: NARROW_DOCX_RESULT_VERSION, pages: 7,
    corrected: false, approved: false, narrow: true })
  expect(selected.candidateId).toBe(metadata.candidate.candidateId)
  expect(selected.previewId).toBe(metadata.preview.previewId)
  for (const [key, expected] of Object.entries(NARROW_DOCX_READ_HASHES)) {
    expect(key === 'outputChecksum' ? metadata.candidate.artifact.outputChecksum : metadata.candidate[key]).toBe(expected)
  }
  expect(NARROW_DOCX_READ_PAGES).toEqual(metadata.preview.conversion.pages)
  expect(Object.isFrozen(NARROW_DOCX_READ_PAGES)).toBe(true)
  expect(NARROW_DOCX_READ_PREVIEW_HASHES).toEqual({ conversionFingerprint: metadata.preview.conversionFingerprint,
    runtimeFingerprint: metadata.preview.conversion.runtimeFingerprint })
  expect(jsonHash(metadata.preview.conversion)).toBe(NARROW_DOCX_READ_PREVIEW_HASHES.conversionFingerprint)
  expect(jsonHash(metadata.preview.conversion.runtime)).toBe(NARROW_DOCX_READ_PREVIEW_HASHES.runtimeFingerprint)
  expect(CONTROLLED_DOCX_READ_LIMITS.readCalls).toBe(10000)
  expect(APPROVED_DOCX_OPERATION_LIMITS.APPROVED_CANDIDATE).toEqual({ methodCalls: 20000 })
  expect(APPROVED_DOCX_OPERATION_LIMITS.APPROVED_REVIEW_PREPARATION).toEqual({ methodCalls: 50000, deadlineMs: 1200000 })
  expect(APPROVED_DOCX_OPERATION_LIMITS.NARROW_CANDIDATE).toEqual({ methodCalls: 20000 })
})

test('only V4 accepts the new exact held LIST metadata; no old profile substitutes this correction', () => {
  const data = list()
  expect(assertControlledReadData('LIST', data, version)).toBe(data)
  expect(data.candidates[0]).toMatchObject({ status: 'PRIVATE_UNREVIEWED', authoritative: false,
    authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false })
  for (const old of [CONTROLLED_DOCX_READ_VERSION, CORRECTED_DOCX_READ_VERSION, APPROVED_DOCX_READ_VERSION]) {
    expect(() => assertControlledReadData('LIST', list(), old)).toThrow()
  }
})

test('V4 rejects substituted candidate commitments, legacy bindings, renderer layout and promoted authority', () => {
  const changes = [
    c => { c.candidateId = 'docx_candidate_c396012f-ebf6-4da0-b4e8-71580a359024' },
    ...['sourceFingerprint', 'inputFingerprint', 'bodyFingerprint', 'masterBindingFingerprint'].map(key => c => { c[key] = '0'.repeat(64) }),
    c => { c.artifact.outputChecksum = 'sha256:' + '0'.repeat(64) },
    c => { c.artifact.byteLength++ },
    c => { c.renderer.version = '0.1.4' },
    c => { c.renderer.layoutProfile = 'KEEP_LABEL_WITH_QUOTE_V1' },
    c => { c.masterBinding.contractVersion = 'master-linked-private-docx-binding.v3' },
    c => { c.masterBinding.compatibilityReference.version = 'commercial-docx-approved-expression.v1' },
    c => { c.masterBinding.expressionOrigin = 'APPROVED_EXPRESSION_PRIVATE_CORRECTION_UNREVIEWED' },
    c => { c.authorisesApproval = true },
  ]
  for (const change of changes) { const data = list(); change(data.candidates[0]); refuses('LIST', data, 'RESULT_CANDIDATE_INVALID') }
})

test('V4 requests keep the fixed scope/candidate and reject caller profile or transport overrides', () => {
  const request = { contractVersion: version, operation: 'CURRENT_PREVIEW', scope, candidateId: selected.candidateId }
  expect(assertControlledReadRequest(request)).toBe(request)
  for (const changed of [{ ...request, candidateId: 'docx_candidate_c396012f-ebf6-4da0-b4e8-71580a359024' },
    { ...request, scope: { ...scope, tenantId: '0'.repeat(24) } },
    { ...request, contractVersion: 'CONTROLLED_DOCX_READ_V5' }]) expect(() => assertControlledReadRequest(changed)).toThrow()
  for (const field of ['profile', 'uri', 'authorization', 'readPurpose', 'methodCallLimit']) {
    expect(() => assertControlledReadRequest({ ...request, [field]: 'injected' })).toThrow()
  }
})

test('actual preview metadata reaches the byte-integrity gate; metadata alone never supplies valid page images', () => {
  refuses('CURRENT_PREVIEW', previewMetadata(), 'RESULT_PAGE_INVALID')
  expect(Object.keys(metadata)).toEqual(['candidate', 'preview'])
  expect(metadata.preview.conversion.pages.every(page => !Object.hasOwn(page, 'base64'))).toBe(true)
})

test('V4 rejects changed preview commitments even when a conversion is resealed', () => {
  const changes = [
    p => { p.previewId = 'docx_preview_49c7c65f-3d60-4a76-8a85-c5794567c2e1' },
    p => { p.inputFingerprint = '0'.repeat(64) },
    p => { p.renderer.layoutProfile = 'KEEP_LABEL_WITH_QUOTE_V1' },
    p => { p.conversion.runtimeFingerprint = '0'.repeat(64); p.conversionFingerprint = jsonHash(p.conversion) },
    p => { p.conversion.pages[0].sha256 = '0'.repeat(64); p.conversionFingerprint = jsonHash(p.conversion) },
  ]
  for (const change of changes) { const data = previewMetadata(); change(data.preview); refuses('CURRENT_PREVIEW', data, 'RESULT_PREVIEW_INVALID') }
})
