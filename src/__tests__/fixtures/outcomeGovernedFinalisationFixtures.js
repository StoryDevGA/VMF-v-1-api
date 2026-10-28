import mongoose from 'mongoose'
import { createHash } from 'node:crypto'
import { makeRequestScopedQualityChain, makeBinding, makePack, makeRuntime } from './outcomeQualityStageFixtures.js'
import { buildGovernedQualityChainManifest, __testables } from '../../services/outcomeStudioService.js'
import { OUTCOME_STUDIO_GOVERNED_PHASE } from '../../constants/runtimeOutcomeStudio.js'

// Explicit synthetic accepted truth and controlled provider receipts. This is
// isolated engineering evidence, never a customer sufficiency or ARL verdict.
export const makeGovernedFinalisationFixture = ({ revisionNumber = 1, rootRuntimeId = null, parentRuntimeId = null } = {}) => {
  const requestBinding = { requestId: '8abedafd-8555-4342-be49-76ab906a26f6',
    draftId: 'outcome_draft_8d91bfbd-6670-4cfe-807b-a6d41bd4181e',
    draftIterationId: 'outcome_draft_iteration_5eebbe35-cfba-47d0-883f-e0cb408c1905' }
  const binding = makeBinding()
  const styleContent = JSON.stringify({ tokens: { accentColor: '#333333' } })
  const visualContent = JSON.stringify({ allowedComponents: ['HEADING', 'PARAGRAPH'] })
  const checksum = (content) => `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`
  binding.selectedByLayer.STYLE[0].contentHash = checksum(styleContent)
  const visual = makePack({ packType: 'VISUAL_SYSTEM', packKey: 'synthetic-neutral-visual',
    knowledgeLayer: 'VISUAL_SYSTEM', capabilityKey: 'synthetic-neutral-visual', suffix: 'a' })
  visual.contentHash = checksum(visualContent)
  binding.selectedByLayer.VISUAL_SYSTEM = [visual]
  binding.lineage.activationIds.push(visual.activationId)
  binding.lineage.versionIds.push(visual.versionId)
  binding.lineage.contentHashes = [...binding.mandatorySafeguards, ...Object.values(binding.selectedByLayer).flat()].map((pack) => pack.contentHash)
  binding.activePacks = [...binding.mandatorySafeguards, ...Object.values(binding.selectedByLayer).flat()]
  binding.requiredPacks = binding.mandatorySafeguards
  binding.activeCount = binding.activePacks.length
  binding.requiredCount = binding.requiredPacks.length
  const runtime = makeRuntime()
  runtime.name = 'Synthetic governed finalisation runtime'
  runtime.packageId = new mongoose.Types.ObjectId('6a705569a7b760264f6a501e')
  runtime.dependencyLockId = 'synthetic-dependency-lock'
  runtime.activationId = 'synthetic-runtime-activation'
  runtime.deploymentId = 'synthetic-runtime-deployment'
  runtime.createdBy = runtime.framework_state.lock.lockedBy
  runtime.evidence = { activationId: runtime.activationId, deploymentId: runtime.deploymentId,
    dependencySnapshotId: 'dependency-qa', dependencySnapshotHash: 'f'.repeat(64) }
  runtime.revision = { revisionNumber, rootRuntimeId, parentRuntimeId }
  runtime.framework_state.intelligence_graph = { graphVersion: 'synthetic-graph-1', graphHash: 'synthetic-graph-hash' }
  const fixture = makeRequestScopedQualityChain(requestBinding, { fixtureRuntime: runtime, binding })
  const scope = { tenantId: runtime.tenantId, customerId: runtime.customerId, runtimeInstanceId: runtime._id }
  const sessionId = 'outcome_session_synthetic_finalisation'
  const chain = buildGovernedQualityChainManifest({ ...fixture, requestBinding })
  const truth = fixture.plan.payload.lockedTruth
  const truthSignature = { truthSignatureId: 'synthetic-truth-signature', status: 'PROJECTED', currentness: 'CURRENT',
    persistence: 'SESSION_BOUND', evidence: { publishSnapshotId: truth.publishSnapshotId, publishSnapshotHash: truth.publishSnapshotHash,
      lockSnapshotId: truth.lockSnapshotId, lockSnapshotHash: truth.lockSnapshotHash,
      replayAnchorId: truth.replayAnchorId, replayAnchorHash: truth.replayAnchorHash, runtimeRevision: String(revisionNumber) } }
  const session = { _id: new mongoose.Types.ObjectId(), ...scope, sessionId, status: 'ACTIVE', truthSignature,
    contextBindings: { requestPlan: { requestId: requestBinding.requestId, planId: fixture.plan.planId, planFingerprint: fixture.plan.planFingerprint } },
    phase: OUTCOME_STUDIO_GOVERNED_PHASE, sourceOutput: {}, sourceOutputTypeKey: 'EXECUTIVE_BRIEF',
    sourceOutputTypeLabel: 'Executive Brief', sourceOutputAssetId: 'synthetic-source', knowledgePackBinding: binding }
  const customerContent = __testables.buildGovernedDraftCustomerContent(fixture.stages[4]).customerContent
  const draft = { _id: new mongoose.Types.ObjectId(), ...scope, sessionId, draftId: requestBinding.draftId,
    status: 'ACTIVE', phase: OUTCOME_STUDIO_GOVERNED_PHASE, currentIterationId: requestBinding.draftIterationId, currentIterationNumber: 1,
    outputTypeKey: 'EXECUTIVE_BRIEF', outputTypeCapabilityKey: 'executive-brief', outputTypeLabel: 'Executive Brief',
    title: fixture.stages[4].outputSnapshot.title, truthSignature, knowledgePackBinding: binding,
    lineageSummary: { governedQualityChain: chain }, createdBy: fixture.plan.createdBy, warnings: [], limitations: [] }
  const iteration = { _id: new mongoose.Types.ObjectId(), ...scope, sessionId, draftId: draft.draftId,
    draftIterationId: requestBinding.draftIterationId, iterationNumber: 1, status: 'CURRENT', phase: OUTCOME_STUDIO_GOVERNED_PHASE,
    outputTypeKey: draft.outputTypeKey, outputTypeCapabilityKey: draft.outputTypeCapabilityKey, title: draft.title,
    customerContent, lineageSummary: { governedQualityChain: chain }, warnings: [], limitations: [], generatedBy: fixture.plan.createdBy }
  const loadRenderingPackReceipt = async ({ pack, role }) => {
    const content = role === 'STYLE' ? styleContent : visualContent
    if (pack.contentHash !== checksum(content)) throw new Error('Synthetic pack hash mismatch')
    return { packKey: pack.packKey, versionId: pack.versionId, version: pack.semanticVersion,
      contentHash: checksum(content), status: 'RESOLVED', ...JSON.parse(content) }
  }
  return { ...fixture, requestBinding, scope, session, draft, iteration, loadRenderingPackReceipt }
}
