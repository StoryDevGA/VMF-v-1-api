import { randomUUID } from 'node:crypto'
import { docxVisualReviewFixture, visualReviewOutput } from './docxVisualReviewFixture.js'
import { buildOpenAiDocxRenditionReviewRequest } from '../../services/openAiDocxRenditionReviewProviderAdapter.js'
import { buildRenditionQualityStage } from '../../services/outcomeRenditionQualityStageContract.js'
import { RENDITION_TRANSPORT } from '../../services/outcomeRenditionReviewClaimContract.js'

// Generic source/auth owners and invented provider receipt; never native proof.
export const renditionQualityStageFixture = async (failed = false) => {
  const f = docxVisualReviewFixture(), admission = await f.admission(), transport = await f.transport()
  const binding = buildOpenAiDocxRenditionReviewRequest(transport).binding
  const input = { contractVersion: 'outcome-rendition-stage-input.v1', subject: admission.subject, runtime: admission.runtime,
    planVersion: 1, claim: { executionId: `grr_rendition_claim_${randomUUID()}`, fingerprint: 'c'.repeat(64) },
    reservation: { executionId: `grr_rendition_dispatch_${randomUUID()}`, fingerprint: 'd'.repeat(64) },
    result: { executionId: `grr_rendition_result_${randomUUID()}`, runtimeArtifactId: `artifact_rendition_review_${randomUUID()}` }, binding,
    receipt: { contractVersion: 'docx-rendition-visual-review-receipt.v1', ...binding, responseId: 'resp_simulated_stage', postRequestId: 'req_simulated_stage',
      provider: { ...RENDITION_TRANSPORT }, terminalStatus: 'completed', latencyMs: 10, pages: admission.subject.preview.pages,
      inputFingerprint: admission.subject.candidate.inputFingerprint, docxChecksum: admission.subject.candidate.docxChecksum,
      tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null }, storeRequested: false, temporaryProviderStorageForPolling: true } }
  const args = { input, output: visualReviewOutput(failed), plan: { ...f.plan, planVersion: 1 },
    startedAt: '2026-10-28T18:40:00.000Z', completedAt: '2026-10-28T18:40:00.100Z' }
  return { ...f, input, stageArgs: args, row: buildRenditionQualityStage(args) }
}
