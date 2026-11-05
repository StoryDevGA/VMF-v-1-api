import { randomUUID, createHash } from 'node:crypto'
import { docxPagePreviewFixture } from './docxPagePreviewFixture.js'
import { prepareRenditionReviewAdmission } from '../../services/outcomeRenditionReviewAdmissionService.js'

export const renditionReviewClaimFixture = () => {
  const f = docxPagePreviewFixture(), { scope, actorUserId } = f
  const flags = Object.fromEntries(['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable'].map(key => [key, false]))
  const methodContent = '# Review method\n\nEvaluate the seven governed expression dimensions without altering meaning.'
  const methodPack = { packId: 'rl-pack', packKey: 'rendered-expression-rl', versionId: 'rl-v1', semanticVersion: '1.0.0',
    activationId: 'rl-activation', capabilityKey: 'rendered-expression-rl', packType: 'RL', status: 'ACTIVE',
    contentHash: `sha256:${createHash('sha256').update(methodContent).digest('hex')}`, contentFormat: 'MARKDOWN',
    boundary: 'POST_GENERATION_VALIDATION', executionMode: 'POST_VALIDATION', stageAssignments: ['RENDERED_EXPRESSION_RL'] }
  const packs = Object.fromEntries(['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'AUDIENCE', 'STYLE', 'VISUAL_SYSTEM'].map(layer => [layer,
    { packId: `${layer}-pack`, versionId: `${layer}-version`, activationId: `${layer}-active`, contentHash: `sha256:${'a'.repeat(64)}` }]))
  Object.assign(f.verified.candidate, flags, { renderer: { key: 'generic-renderer', version: '1.0.0' }, selectedPacks: packs })
  f.verified.candidate.artifact.byteLength = f.verified.buffer.length
  const plan = { _id: '507f1f77bcf86cd799439015', ...scope, planId: 'authentic-fixture-plan', requestId: randomUUID(), planVersion: 1,
    planFingerprint: '1'.repeat(64), resolutionFingerprint: '2'.repeat(64), contextFingerprint: '3'.repeat(64),
    payload: { stagePlan: [{ stageKey: 'RENDERED_EXPRESSION_RL', order: 6, assignedActivationIds: [methodPack.activationId] }], resolution: { selectedPacks: [methodPack] } } }
  const source = { sourceAdmission: 'VERIFIED_READ_ONLY_CHAIN', classification: f.verified.candidate.classification,
    sourceFingerprint: f.verified.candidate.sourceFingerprint, source: { scope, selectedPacks: packs,
      plan: { recordId: plan._id, ...Object.fromEntries(['planId', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].map(key => [key, plan[key]])) },
      logicalDraft: { draftId: 'source-logical-draft', draftIterationId: 'source-logical-iteration' },
      stageRefs: Array.from({ length: 6 }, (_, index) => ({ stageExecutionId: `stage-${index}`, attemptFingerprint: `${index}`.repeat(64), outputFingerprint: index === 5 ? '' : `${index}`.repeat(64) })) } }
  const preview = { ...flags, classification: source.classification, scope, previewId: `docx_preview_${randomUUID()}`,
    candidateId: f.verified.candidate.candidateId, sourceFingerprint: source.sourceFingerprint, inputFingerprint: f.verified.candidate.inputFingerprint,
    renderer: f.verified.candidate.renderer, conversion: f.rendered.receipt, conversionFingerprint: f.rendered.fingerprint }
  const runtime = { id: scope.runtimeInstanceId, ...scope, runtimeInstanceKey: 'generic-review-fixture', runtimeType: 'VMF', frameworkKey: 'VMF',
    packageKey: 'generic-package', packageVersion: '1.0.0', status: 'LOCKED' }
  const deps = { readSource: async () => source, assertPermission: async () => {}, readRuntime: async () => runtime,
    readCandidate: async () => f.verified, readPreview: async () => ({ preview, pages: f.rendered.pages.map(page => page.buffer) }),
    loadPlan: async () => plan, assertPlanIntegrity: () => {}, loadPackContent: async () => ({ ...methodPack, available: true, content: methodContent }) }
  const expected = { sourceFingerprint: source.sourceFingerprint, inputFingerprint: preview.inputFingerprint,
    docxChecksum: f.verified.candidate.artifact.outputChecksum, previewId: preview.previewId, conversionFingerprint: preview.conversionFingerprint }
  const args = { actorUserId, runtimeInstanceId: scope.runtimeInstanceId, candidateId: preview.candidateId, scopes: { selectedCustomerId: scope.customerId }, expected, deps }
  return { ...f, flags, methodContent, methodPack, plan, source, preview, runtime, deps, args,
    admission: () => prepareRenditionReviewAdmission(args) }
}
