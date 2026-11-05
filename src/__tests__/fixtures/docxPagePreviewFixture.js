import { randomUUID } from 'node:crypto'
import { createCanvas } from '@napi-rs/canvas'
import { previewHash, validatePreviewPng } from '../../services/docxPagePreviewRuntime.js'
import { SYNTHETIC_OUTCOME_CLASSIFICATION } from '../../models/SyntheticOutcomeRunEvent.js'

export const docxPagePreviewFixture = () => {
  const scope = { tenantId: '507f1f77bcf86cd799439011', customerId: '507f1f77bcf86cd799439012', runtimeInstanceId: '507f1f77bcf86cd799439013' }
  const actorUserId = '507f1f77bcf86cd799439014', buffer = Buffer.from('Generic verified candidate seam')
  const runtimeReceipt = { contractVersion: 'DOCX_PAGE_RUNTIME_V1', dpi: 150, platform: 'win32',
    standardFontPolicy: 'PDFJS_BUNDLED_BASE14_V1', installationFingerprint: 'a'.repeat(64), productVersion: '26.8.1.1' }
  const runtime = { profile: { fixture: true }, receipt: runtimeReceipt, fingerprint: previewHash(JSON.stringify(runtimeReceipt)) }
  const candidate = { candidateId: `docx_candidate_${randomUUID()}`, classification: SYNTHETIC_OUTCOME_CLASSIFICATION,
    sourceFingerprint: 'b'.repeat(64), inputFingerprint: 'c'.repeat(64), renderer: { name: 'generic-test-renderer', version: '1.0.0' },
    artifact: { outputChecksum: `sha256:${previewHash(buffer)}` } }
  const canvas = createCanvas(120, 160), drawing = canvas.getContext('2d')
  drawing.fillStyle = 'white'; drawing.fillRect(0, 0, 120, 160); drawing.fillStyle = 'black'; drawing.fillRect(10, 10, 80, 8)
  const png = canvas.toBuffer('image/png'), page = { number: 1, ...validatePreviewPng(png) }
  const receipt = { contractVersion: 'DOCX_PAGE_PREVIEW_V1', status: 'PRIVATE_PREVIEW_ONLY', authorisesApproval: false,
    finalisationAvailable: false, deliveryAvailable: false, docxChecksum: candidate.artifact.outputChecksum,
    pdfChecksum: `sha256:${'d'.repeat(64)}`, runtime: runtimeReceipt, runtimeFingerprint: runtime.fingerprint, pages: [page] }
  return { scope, actorUserId, verified: { candidate, buffer, scope,
    document: { title: 'Generic paper', markdown: '# Generic paper\n\nA qualified generic claim.', inputFingerprint: candidate.inputFingerprint } }, runtime,
    rendered: { receipt, fingerprint: previewHash(JSON.stringify(receipt)), pages: [{ ...page, buffer: png }] },
    payload: { expectedSourceFingerprint: candidate.sourceFingerprint, expectedOutputChecksum: candidate.artifact.outputChecksum } }
}
