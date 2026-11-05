import { createHash } from 'node:crypto'
import { createCanvas } from '@napi-rs/canvas'
import { renditionReviewClaimFixture } from './renditionReviewClaimFixture.js'
import { membershipHash } from '../../services/runtimeEvidenceSnapshotContract.js'
import { prepareDocxVisualReviewTransport } from '../../services/outcomeDocxVisualReviewContextService.js'
import { previewHash, validatePreviewPng } from '../../services/docxPagePreviewRuntime.js'
import { OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION } from '../../constants/outcomeGovernedQuality.js'

export const docxVisualReviewFixture = () => {
  const f = renditionReviewClaimFixture(), contents = {}
  const canvas = createCanvas(120, 160), drawing = canvas.getContext('2d')
  drawing.fillStyle = '#cccccc'; drawing.fillRect(0, 0, 120, 160)
  const buffer = canvas.toBuffer('image/png'), second = { number: 2, ...validatePreviewPng(buffer) }
  f.rendered.receipt.pages.push(second); f.rendered.pages.push({ ...second, buffer })
  f.rendered.fingerprint = previewHash(JSON.stringify(f.rendered.receipt))
  f.preview.conversionFingerprint = f.rendered.fingerprint; f.args.expected.conversionFingerprint = f.rendered.fingerprint
  for (const [layer, receipt] of Object.entries(f.verified.candidate.selectedPacks)) {
    contents[receipt.packId] = `# ${layer} requirements\n\nPreserve the selected paper structure, qualifications and readable expression.`
    receipt.contentHash = `sha256:${createHash('sha256').update(contents[receipt.packId]).digest('hex')}`
  }
  f.source.source.content = { approvedMeaning: { state: 'APPROVED', meaningSummary: 'A bounded qualified internal trial.' },
    shaping: { sections: [{ order: 1, heading: 'Decision', body: 'A bounded trial remains under consideration.', qualification: 'Access review is outstanding.',
      diagram: { present: false, description: '', accessibleText: '' } },
    { order: 2, heading: 'Evidence limits', body: 'No measured benefit is evidenced.', qualification: 'This is a synthetic test example.',
      diagram: { present: false, description: '', accessibleText: '' } }], visibleGaps: ['Trial execution is not approved.'] } }
  f.source.sourceFingerprint = membershipHash(f.source.source)
  f.verified.candidate.sourceFingerprint = f.source.sourceFingerprint; f.preview.sourceFingerprint = f.source.sourceFingerprint
  f.args.expected.sourceFingerprint = f.source.sourceFingerprint
  f.verified.candidateInput = { contractVersion: 'governed-private-docx-input.v1', model: { title: f.verified.document.title },
    markdown: f.verified.document.markdown, sourceEnvelope: f.source, renderer: f.verified.candidate.renderer, selectedPacks: f.verified.candidate.selectedPacks }
  const inputFingerprint = membershipHash(f.verified.candidateInput)
  f.verified.candidate.inputFingerprint = inputFingerprint; f.verified.document.inputFingerprint = inputFingerprint
  f.preview.inputFingerprint = inputFingerprint; f.args.expected.inputFingerprint = inputFingerprint
  f.deps.loadPackContent = async ({ packId }) => packId === f.methodPack.packId
    ? { ...f.methodPack, available: true, content: f.methodContent }
    : { ...Object.values(f.verified.candidate.selectedPacks).find(pack => pack.packId === packId), available: true, status: 'ACTIVE', contentFormat: 'MARKDOWN', content: contents[packId] }
  f.deps.prepareAdmission = f.admission
  return { ...f, contents, transport: () => prepareDocxVisualReviewTransport(f.args) }
}

export const visualReviewOutput = (failed = false) => ({ outputType: 'RENDERED_EXPRESSION_RL', schemaVersion: OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
  overallStatus: failed ? 'FAIL' : 'PASS', findings: ['STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION']
    .map((dimension, index) => ({ dimension, status: failed && !index ? 'FAIL' : 'PASS', finding: failed && !index ? 'A qualification needs clearer placement.' : 'The supplied expression is preserved.', requiredChange: failed && !index })) })

// Reseal only generic owner fixtures so privacy tests reach policy validation
// with consistent source/input receipts. This never reseals a production record.
export const resealVisualReviewFixture = f => {
  f.source.sourceFingerprint = membershipHash(f.source.source)
  f.verified.candidate.sourceFingerprint = f.source.sourceFingerprint; f.preview.sourceFingerprint = f.source.sourceFingerprint
  f.args.expected.sourceFingerprint = f.source.sourceFingerprint
  const inputFingerprint = membershipHash(f.verified.candidateInput)
  f.verified.candidate.inputFingerprint = inputFingerprint; f.verified.document.inputFingerprint = inputFingerprint
  f.preview.inputFingerprint = inputFingerprint; f.args.expected.inputFingerprint = inputFingerprint
}
