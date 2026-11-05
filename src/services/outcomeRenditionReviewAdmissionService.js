import Plan from '../models/OutcomeKnowledgeCompositionPlan.js'
import { assertRuntimePermission, getRuntimeInstance } from './runtimeInstanceService.js'
import { readPrivateDocxCandidate } from './outcomeDocxCandidatePersistenceService.js'
import { readCurrentDocxPagePreview } from './outcomeDocxPagePreviewPersistenceService.js'
import { readOutcomeDocxRenditionSource } from './outcomeDocxRenditionSourceService.js'
import { assertOutcomeKnowledgeCompositionPlanIntegrity } from './outcomeKnowledgeCompositionPlanService.js'
import { loadOutcomeKnowledgePackVersionContent } from './outcomeKnowledgePackRegistryService.js'
import { loadOutcomeMethodDocument, projectOutcomeMethodDocumentReceipt } from './outcomeMethodDocumentService.js'
import { resolveKnowledgePackBoundary } from '../constants/knowledgeRuntime.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { previewHash } from './docxPagePreviewRuntime.js'
import { assertRenditionReviewSubject, RENDITION_TRANSPORT, renditionClaimError } from './outcomeRenditionReviewClaimContract.js'

const fail = reason => { throw renditionClaimError(reason) }
const same = (a, b) => membershipHash(a) === membershipHash(b)
const id = value => String(value || '')
const flags = ['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable']

// Server-only admission. Existing owners verify source, signatures, file bytes,
// pages and current packs. No read result grants dispatch or source-lock authority.
export const prepareRenditionReviewAdmission = async args => {
  const deps = args.deps || {}, input = { actorUserId: args.actorUserId, runtimeInstanceId: args.runtimeInstanceId,
    candidateId: args.candidateId, scopes: args.scopes }
  const source = await (deps.readSource || readOutcomeDocxRenditionSource)(input), scope = source?.source?.scope
  if (!scope || scope.runtimeInstanceId !== args.runtimeInstanceId || !/^[a-f0-9]{24}$/.test(id(args.actorUserId))) fail('ADMISSION_SCOPE_INVALID')
  const trustedScope = Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map(key => [key, scope[key]]))
  await (deps.assertPermission || assertRuntimePermission)({ actorUserId: args.actorUserId, scopes: args.scopes,
    ...trustedScope, permission: 'VMF_UPDATE', maxTimeMS: 3000 })
  const runtime = await (deps.readRuntime || getRuntimeInstance)({ scopes: args.scopes, ...trustedScope,
    projection: 'runtimeInstanceKey runtimeType frameworkKey packageKey packageVersion status', maxTimeMS: 3000, metadataMaxTimeMS: 3000 })
  if (!runtime || id(runtime.id || runtime._id) !== trustedScope.runtimeInstanceId
    || ['tenantId', 'customerId'].some(key => id(runtime[key]) !== trustedScope[key]) || runtime.status !== 'LOCKED') fail('ADMISSION_RUNTIME_CHANGED')
  const verified = await (deps.readCandidate || readPrivateDocxCandidate)({ ...input, includeBytes: true })
  const candidate = verified?.candidate
  // A v1 subject omits master lineage. Never downgrade a linked candidate into
  // the existing claim/dispatch pipeline, even when DOCX bytes are identical.
  if (candidate?.contractVersion === 'private-docx-candidate.v2' || candidate?.masterBinding !== undefined
    || candidate?.masterBindingFingerprint !== undefined) fail('MASTER_LINKED_REVIEW_BINDING_REQUIRED')
  if (!candidate || !same(verified.scope, trustedScope) || candidate.candidateId !== args.candidateId
    || candidate.sourceFingerprint !== source.sourceFingerprint || source.sourceAdmission !== 'VERIFIED_READ_ONLY_CHAIN'
    || source.classification !== 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST' || candidate.classification !== source.classification
    || flags.some(key => candidate[key] !== false) || !Buffer.isBuffer(verified.buffer)
    || candidate.artifact?.byteLength !== verified.buffer.length || candidate.artifact.outputChecksum !== `sha256:${previewHash(verified.buffer)}`) fail('ADMISSION_CANDIDATE_CHANGED')
  const result = await (deps.readPreview || readCurrentDocxPagePreview)({ ...input, includePages: true }), preview = result?.preview
  if (!preview || preview.candidateId !== candidate.candidateId || !same(preview.scope, trustedScope)
    || preview.sourceFingerprint !== source.sourceFingerprint || preview.inputFingerprint !== candidate.inputFingerprint
    || !same(preview.renderer, candidate.renderer) || preview.classification !== source.classification || flags.some(key => preview[key] !== false)
    || preview.conversion?.docxChecksum !== candidate.artifact.outputChecksum || !Array.isArray(result.pages)
    || result.pages.length !== preview.conversion.pages?.length
    || result.pages.some((buffer, index) => !Buffer.isBuffer(buffer) || previewHash(buffer) !== preview.conversion.pages[index].sha256
      || buffer.length !== preview.conversion.pages[index].byteLength)) fail('ADMISSION_PREVIEW_CHANGED')
  const planRef = source.source.plan
  const plan = await (deps.loadPlan || (filter => Plan.findOne(filter).lean()))({ ...trustedScope, _id: planRef.recordId, planId: planRef.planId, requestId: planRef.requestId })
  ;(deps.assertPlanIntegrity || assertOutcomeKnowledgeCompositionPlanIntegrity)(plan)
  if (!plan || id(plan._id || plan.id) !== planRef.recordId || ['tenantId', 'customerId', 'runtimeInstanceId'].some(key => id(plan[key]) !== trustedScope[key])
    || ['planId', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].some(key => plan[key] !== planRef[key])) fail('ADMISSION_PLAN_CHANGED')
  const assignments = plan.payload.stagePlan.filter(stage => stage.stageKey === 'RENDERED_EXPRESSION_RL')
  if (assignments.length !== 1 || assignments[0].order !== 6 || assignments[0].assignedActivationIds?.length !== 1) fail('ADMISSION_METHOD_ASSIGNMENT_INVALID')
  const selected = plan.payload.resolution.selectedPacks.filter(pack => pack.activationId === assignments[0].assignedActivationIds[0])
  const pack = selected[0]
  if (selected.length !== 1 || pack.packType !== 'RL' || !(pack.stageAssignments || []).includes('RENDERED_EXPRESSION_RL')
    || !['ACTIVE'].includes(pack.status || pack.lifecycleStatus) || resolveKnowledgePackBoundary(pack) !== 'POST_GENERATION_VALIDATION') fail('ADMISSION_METHOD_ASSIGNMENT_INVALID')
  const method = await loadOutcomeMethodDocument({ role: 'RL', selection: { ...pack, status: 'ACTIVE' },
    loadPackContent: deps.loadPackContent || loadOutcomeKnowledgePackVersionContent })
  const profilePacks = {}
  for (const layer of ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'AUDIENCE', 'STYLE', 'VISUAL_SYSTEM']) {
    const receipt = candidate.selectedPacks?.[layer], fromSource = source.source.selectedPacks?.[layer]
    if (!receipt || !fromSource || ['packId', 'versionId', 'activationId', 'contentHash'].some(key => receipt[key] !== fromSource[key])) fail('ADMISSION_PROFILE_CHANGED')
    profilePacks[layer] = Object.fromEntries(['packId', 'versionId', 'activationId', 'contentHash'].map(key => [key, receipt[key]]))
  }
  const subject = assertRenditionReviewSubject({ contractVersion: 'outcome-docx-review-subject.v1', actorUserId: id(args.actorUserId), scope: trustedScope,
    classification: source.classification, ...Object.fromEntries(flags.map(key => [key, false])),
    source: { sourceFingerprint: source.sourceFingerprint, admission: source.sourceAdmission, plan: planRef, logicalDraft: source.source.logicalDraft,
      stageRefs: source.source.stageRefs.map(ref => Object.fromEntries(['stageExecutionId', 'attemptFingerprint', 'outputFingerprint'].map(key => [key, ref[key] || '']))) },
    candidate: { candidateId: candidate.candidateId, inputFingerprint: candidate.inputFingerprint, docxChecksum: candidate.artifact.outputChecksum,
      byteLength: candidate.artifact.byteLength, renderer: { key: candidate.renderer.key, version: candidate.renderer.version, fingerprint: membershipHash(candidate.renderer) }, packs: profilePacks },
    preview: { previewId: preview.previewId, conversionFingerprint: preview.conversionFingerprint, runtimeFingerprint: preview.conversion.runtimeFingerprint, pages: preview.conversion.pages },
    method: projectOutcomeMethodDocumentReceipt(method), transport: { ...RENDITION_TRANSPORT } })
  const expected = args.expected
  if (!expected || expected.sourceFingerprint !== subject.source.sourceFingerprint || expected.inputFingerprint !== subject.candidate.inputFingerprint
    || expected.docxChecksum !== subject.candidate.docxChecksum || expected.previewId !== subject.preview.previewId
    || expected.conversionFingerprint !== subject.preview.conversionFingerprint) fail('ADMISSION_EXPECTATION_CHANGED')
  return { subject, runtime: Object.fromEntries(['runtimeInstanceKey', 'runtimeType', 'frameworkKey', 'packageKey', 'packageVersion'].map(key => [key, runtime[key] || ''])) }
}
