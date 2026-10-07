import { buildOutcomeKnowledgeCompositionPlanCandidate, hashOutcomeKnowledgeCompositionSemanticValue } from '../services/outcomeKnowledgeCompositionPlanService.js'
import { attachSs040PlanFixtureContract, ss040TargetHashFor } from './fixtures/ss040EvidenceToMeaningFixtures.js'
import { freezeSs041Snapshot } from './fixtures/outcomeEvidenceToDraftFixtures.js'
import { compileEvidenceToMeaningContract } from '../services/outcomeEvidenceToMeaningContractService.js'
import { EVIDENCE_TO_DRAFT_INPUT_VERSION } from '../services/outcomeEvidenceToDraftContractService.js'
import { EVIDENCE_TO_MEANING_PROVIDER_VERSION, EVIDENCE_TO_DRAFT_PROVIDER_VERSION } from '../services/outcomeEvidenceToMeaningProviderService.js'
import { readRuntimeEvidenceToMeaningProviderProjection } from '../services/outcomeRuntimeEvidenceToMeaningService.js'
import { buildWorkingDraftStageOutputFromProviderOutput } from '../services/outcomeWorkingDraftExecutionService.js'
import { beforeAll, afterAll, describe, test, expect } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import OutcomeQualityStageExecution from '../models/OutcomeQualityStageExecution.js'
import { buildOutcomeQualityStageExecutionCandidate, buildOutcomeQualityVisibleGaps, hashOutcomeQualityStageValue } from '../services/outcomeQualityStageExecutionService.js'
import { OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION, OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION } from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION, OUTCOME_WORKING_DRAFT_SCHEMA_VERSION } from '../constants/outcomeGovernedQuality.js'

let replica
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  const name = `outcome_stage_lineage_${randomUUID().replaceAll('-', '')}`
  const uri = replica.getUri(name)
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Fresh isolated loopback replica required')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  if (mongoose.connection.host !== '127.0.0.1' || mongoose.connection.name !== name
    || mongoose.connection.getClient().topology.description.type !== 'ReplicaSetWithPrimary'
    || (await mongoose.connection.db.listCollections().toArray()).length) throw new Error('Fresh isolated stage database required')
  await OutcomeQualityStageExecution.createCollection()
  await OutcomeQualityStageExecution.createIndexes()
  await mongoose.connection.db.createCollection('auditlogs')
}, 120000)
afterAll(async () => { await mongoose.disconnect(); await replica?.stop() })

// Explicit synthetic model fixture: no live provider output or real customer data.
const makeSyntheticStage = (version) => {
  const tenantId = new mongoose.Types.ObjectId(), customerId = new mongoose.Types.ObjectId()
  const runtimeInstanceId = new mongoose.Types.ObjectId(), recordId = new mongoose.Types.ObjectId()
  const planId = `outcome_kcp_${randomUUID()}`, planFingerprint = 'a'.repeat(64)
  const intent = { originalRequest: '', outcome: 'Review the synthetic source', decisionPurpose: 'Investigate',
    consumer: 'Synthetic reviewer', audience: ['Synthetic reviewer'], requestedOutputTypeKey: 'executive-brief',
    format: 'Document', channel: '', requirements: [], unresolvedGaps: [], outputTypeLabel: '', evidenceSource: '',
    constraints: [], resolutionBasis: {}, missingRequiredFields: [], clarificationQuestions: [], answeredClarificationQuestions: [] }
  const inputSnapshot = {
    ...(version ? { evidenceToMeaning: { contractVersion: version, contractId: `etm_${'b'.repeat(64)}`,
      contractHash: 'b'.repeat(64), projectionHash: 'c'.repeat(64) } } : {}),
    plan: { recordId: String(recordId), planId, planVersion: 1, planFingerprint,
      resolutionFingerprint: 'd'.repeat(64), contextFingerprint: 'e'.repeat(64) },
    lockedTruth: { acceptedTruthIdentityContractVersion: OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION,
      publishSnapshotId: 'synthetic-publish', publishSnapshotHash: '1'.repeat(64),
      lockSnapshotId: 'synthetic-lock', lockSnapshotHash: '2'.repeat(64),
      replayAnchorId: 'synthetic-replay', replayAnchorHash: '3'.repeat(64),
      dependencySnapshotId: 'synthetic-dependency', dependencySnapshotHash: '4'.repeat(64),
      acceptedSectionCount: 1, acceptedSections: [{ sectionKey: 'customer-context', stateSectionKey: 'customer_context',
        runtimePath: 'framework_state.sections.customer_context', truthHash: `sha256:${'5'.repeat(64)}` }] },
    consumerIntent: intent, consumerIntentFingerprint: hashOutcomeQualityStageValue(intent),
    stage: { stageKey: 'FRAMEWORK_GUIDANCE', stageOrder: 1, assignedActivationCount: 1, assignedPacks: [{
      activationId: 'synthetic-activation', packId: 'synthetic-pack', versionId: 'synthetic-version',
      contentHash: `sha256:${'6'.repeat(64)}`, packType: 'OUTCOME', packKey: 'synthetic-guidance',
      knowledgeLayer: 'METHOD', executionMode: 'PROVIDER_CONTEXT', requirement: 'REQUIRED', stageRole: 'FRAMEWORK_GUIDANCE',
    }] }, visibleGaps: [],
  }
  const output = { outputType: 'FRAMEWORK_GUIDANCE_ANALYSIS', schemaVersion: OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
    title: 'Synthetic model persistence fixture', sections: [{ order: 1, sectionKey: 'synthetic-analysis',
      title: 'Synthetic source context', analysis: 'Explicit synthetic source for validation of storage only.',
      truthReferences: ['customer-context'], contributingActivationIds: ['synthetic-activation'] }],
    decisionUsefulness: { summary: 'Synthetic fixture', priorities: ['Investigate'], materialRisks: [], recommendedNextStep: 'Inspect source' },
    assumptions: [], visibleGaps: [] }
  const identity = { executionMode: 'LIVE_TEST', providerKey: 'openai', providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
    model: 'gpt-5.2', grrExecutionId: 'synthetic-grr', grrRuntimeArtifactId: 'synthetic-artifact', runtimeVersion: '2026-10-02T09:00:00.000Z' }
  const qualityRunId = `quality_run_${hashOutcomeQualityStageValue({ tenantId, customerId, runtimeInstanceId, planId, planVersion: 1, planFingerprint }).slice(0, 40)}`
  const inputFingerprint = hashOutcomeQualityStageValue(inputSnapshot), outputFingerprint = hashOutcomeQualityStageValue(output)
  const candidate = { stageExecutionId: `outcome_quality_stage_${randomUUID()}`, qualityRunId,
    tenantId, customerId, runtimeInstanceId, runtimeInstanceKey: 'synthetic-stage-persistence',
    knowledgeCompositionPlanRecordId: recordId, planId, planVersion: 1, planFingerprint,
    resolutionFingerprint: inputSnapshot.plan.resolutionFingerprint, contextFingerprint: inputSnapshot.plan.contextFingerprint,
    stageKey: 'FRAMEWORK_GUIDANCE', stageOrder: 1, attemptNumber: 1, predecessorStageExecutionId: '', predecessorAttemptFingerprint: '',
    status: 'SUCCEEDED', inputFingerprint, outputFingerprint, inputSnapshot, outputSnapshot: output, executionIdentity: identity,
    assignedActivationCount: 1, contributingActivationCount: 1, truthReferenceCount: 1,
    startedAt: '2026-10-02T10:00:00.000Z', completedAt: '2026-10-02T10:00:00.000Z', durationMs: 0,
    createdBy: new mongoose.Types.ObjectId() }
  candidate.attemptFingerprint = hashOutcomeQualityStageValue({ qualityRunId, planId, planVersion: 1, planFingerprint,
    stageKey: candidate.stageKey, stageOrder: 1, attemptNumber: 1, predecessorStageExecutionId: '', predecessorAttemptFingerprint: '',
    status: 'SUCCEEDED', inputFingerprint, outputFingerprint, output, executionIdentity: identity })
  return candidate
}

// Authored synthetic KCP fixture exercises the genuine compiler/projector/stage writer.
const ids = Object.fromEntries(['runtime', 'tenant', 'customer', 'actor', 'plan'].map((key, index) => [key, new mongoose.Types.ObjectId('04130000000000000000000' + (index + 1))]))
const runtimeUpdatedAt = '2026-10-02T09:00:00.000Z'
const emptyRelationshipHash = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
const makeSection = (key, suffix) => ({
  state: { status: 'ACCEPTED' },
  accepted: {
    sectionKey: key,
    runtimePath: `framework_state.sections.${key}`,
    truthHash: `sha256:${suffix.repeat(64).slice(0, 64)}`,
    acceptedAt: '2026-08-01T20:00:00.000Z',
    acceptedBy: ids.actor,
    sourceActionKey: 'GENERATE_SECTION',
    sourceGeneratedAt: '2026-08-01T19:59:00.000Z',
  },
})

const makeRuntime = () => ({
  _id: ids.runtime,
  tenantId: ids.tenant,
  customerId: ids.customer,
  runtimeInstanceKey: 'value-narrative-ebc18a1eca9c',
  runtimeType: 'VALUE_NARRATIVE',
  frameworkKey: 'VMF',
  packageKey: 'standard-package-vmf-3-1-3-rkm',
  packageVersion: '3.1.3',
  status: 'LOCKED',
  updatedAt: new Date(runtimeUpdatedAt),
  framework_state: {
    sections: {
      customer_context: makeSection('customer_context', 'a'),
      strategic_objectives: makeSection('strategic_objectives', 'b'),
    },
    publish: { snapshot: { snapshotId: 'publish-qa', snapshotHash: 'c'.repeat(64) } },
    lock: {
      state: 'LOCKED',
      locked: true,
      lockedAt: '2026-08-02T18:59:29.533Z',
      lockedBy: ids.actor,
      publish: { snapshotId: 'publish-qa', snapshotHash: 'c'.repeat(64) },
      snapshot: { snapshotId: 'lock-qa', snapshotHash: 'd'.repeat(64) },
      anchor: { replayAnchorId: 'replay-qa', replayAnchorHash: 'e'.repeat(64) },
      evidence: { dependencySnapshotId: 'dependency-qa', dependencySnapshotHash: 'f'.repeat(64) },
      outputEligibility: { canonicalOutputEligible: true },
    },
  },
})

const makePack = ({ packType, packKey, knowledgeLayer, capabilityKey = '', suffix }) => ({
  activationId: `activation-${packKey}`,
  packId: `pack-${packKey}`,
  versionId: `version-${packKey}`,
  knowledgeAssetId: `QA-${packKey.toUpperCase()}`,
  packCategory: packType === 'TRUTH_CERTIFICATION' ? 'PLATFORM' : 'OUTCOME',
  purposeCategory: packType === 'TRUTH_CERTIFICATION' ? 'VALIDATION' : 'SYSTEM',
  knowledgeLayer,
  capabilityKey,
  packType,
  packKey,
  label: packKey,
  semanticVersion: '1.0.0',
  schemaVersion: '1.0.0',
  status: 'ACTIVE',
  scopeType: 'GLOBAL',
  scopeKey: 'GLOBAL',
  executionMode: packType === 'TRUTH_CERTIFICATION' ? 'POST_VALIDATION' : 'PROVIDER_CONTEXT',
  visibility: 'PLATFORM',
  workspaceCompatibility: ['OUTCOME'],
  contentHash: `sha256:${suffix.repeat(64).slice(0, 64)}`,
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: emptyRelationshipHash,
  relationshipGovernanceError: '',
  dependencyReferences: [],
})

const mandatory = () => [
  makePack({ packType: 'ARL', packKey: 'adaptive-reasoning-layer', knowledgeLayer: 'REASONING', suffix: '1' }),
  makePack({ packType: 'TRUTH_CERTIFICATION', packKey: 'truth-certification-pack', knowledgeLayer: 'VALIDATION', suffix: '4' }),
]

const makeBinding = () => {
  const safeguards = mandatory()
  const expressionReview = makePack({ packType: 'RL', packKey: 'expression-review', knowledgeLayer: 'COMMUNICATION_PATTERN', suffix: '2' })
  const blocking = makePack({ packType: 'TRUTH_CERTIFICATION', packKey: 'blocking-rules', knowledgeLayer: 'VALIDATION', suffix: '6' })
  const outputType = makePack({ packType: 'OUTPUT_TYPE_DEFINITION', packKey: 'executive-brief', knowledgeLayer: 'OUTPUT_TYPE', capabilityKey: 'executive-brief', suffix: '7' })
  const outputSchema = makePack({ packType: 'OUTPUT_SCHEMA', packKey: 'executive-brief-schema', knowledgeLayer: 'OUTPUT_SCHEMA', capabilityKey: 'executive-brief-schema', suffix: '8' })
  const style = makePack({ packType: 'STYLE', packKey: 'executive-briefing-style', knowledgeLayer: 'STYLE', capabilityKey: 'executive-brief-style', suffix: '9' })
  const selected = [...safeguards, expressionReview, blocking, outputType, outputSchema, style]
  return {
    status: 'READY',
    mode: 'REQUEST_SPECIFIC',
    policyKey: 'outcome-studio-v1-required-packs',
    policyVersion: '2.0.0',
    mandatorySafeguards: safeguards,
    selectedByLayer: {
      COMMUNICATION_PATTERN: [expressionReview],
      VALIDATION: [blocking],
      OUTPUT_TYPE: [outputType],
      OUTPUT_SCHEMA: [outputSchema],
      STYLE: [style],
    },
    excludedCandidates: [],
    blockedPacks: [],
    missingDependencies: [],
    relationshipFailures: [],
    ambiguousCandidates: [],
    incompatibleCandidates: [],
    warnings: [],
    dependencyGraph: { nodes: [], edges: [], cycles: [], depthOverflows: [] },
    lineage: {
      activationIds: selected.map((pack) => pack.activationId),
      versionIds: selected.map((pack) => pack.versionId),
      contentHashes: selected.map((pack) => pack.contentHash),
    },
    resolution: {
      request: { workspaceType: 'OUTCOME', requestedOutputTypeKey: 'executive-brief' },
      scopeCandidates: [{ scopeKey: 'GLOBAL' }],
    },
  }
}

const makeContext = () => ({
  contractVersion: 'outcome-studio-knowledge-context.v1',
  contextId: 'context-qa',
  status: 'READY',
  available: true,
  blockerReason: '',
  requestedOutputTypeKey: 'executive-brief',
  outputType: { key: 'executive-brief', label: 'Executive Brief', version: '1.0.0' },
  outputSchema: { key: 'executive-brief-schema', label: 'Executive Brief Schema', version: '1.0.0' },
  style: { key: 'executive-brief-style', label: 'Executive Briefing Style', version: '1.0.0' },
  renderer: { rendererKey: 'current-document' },
  warnings: [],
  lineage: { activationIds: ['activation-executive-brief'] },
})

const makePlan = (intentOverrides = {}, runtime = makeRuntime(), binding = makeBinding()) => {
  const candidate = buildOutcomeKnowledgeCompositionPlanCandidate({
    runtime,
    binding,
    context: makeContext(),
    consumerIntent: {
      outcome: 'One Governed Executive Brief',
      decisionPurpose: 'Support the executive sponsor decision with governed meaning.',
      consumer: 'Quinn Fixture QA',
      audience: ['Quinn Fixture QA', 'Riley Fixture QA'],
      requestedOutputTypeKey: 'executive-brief',
      format: 'Executive Brief with searchable and accessible text',
      channel: '',
      requirements: ['Editable structure where supported', 'Element-level lineage'],
      unresolvedGaps: ['Exact delivery file type is not specified', 'Exact delivery channel is not specified'],
      ...intentOverrides,
    },
  })
  return {
    _id: ids.plan,
    planId: `outcome_kcp_${randomUUID()}`,
    planVersion: 1,
    contractVersion: candidate.payload.contractVersion,
    operation: 'INITIAL',
    status: candidate.status,
    tenantId: ids.tenant,
    customerId: ids.customer,
    runtimeInstanceId: ids.runtime,
    runtimeInstanceKey: 'value-narrative-ebc18a1eca9c',
    runtimeType: 'VALUE_NARRATIVE',
    frameworkKey: 'VMF',
    packageKey: 'standard-package-vmf-3-1-3-rkm',
    packageVersion: '3.1.3',
    requestedOutputTypeKey: 'executive-brief',
    publishSnapshotId: candidate.payload.lockedTruth.publishSnapshotId,
    lockSnapshotId: candidate.payload.lockedTruth.lockSnapshotId,
    replayAnchorId: candidate.payload.lockedTruth.replayAnchorId,
    dependencySnapshotId: candidate.payload.lockedTruth.dependencySnapshotId,
    planFingerprint: candidate.planFingerprint,
    resolutionFingerprint: candidate.resolutionFingerprint,
    contextFingerprint: candidate.contextFingerprint,
    selectedPackCount: candidate.selectedPackCount,
    consideredPackCount: candidate.consideredPackCount,
    gapCount: candidate.gapCount,
    payload: candidate.payload,
    createdBy: ids.actor,
    createdAt: new Date('2026-08-03T08:46:33.351Z'),
  }
}


describe('real isolated quality-stage evidence lineage persistence', () => {
  test.each([EVIDENCE_TO_MEANING_PROVIDER_VERSION, EVIDENCE_TO_DRAFT_PROVIDER_VERSION])('persists actual compiler/projector/service-produced %s receipt without manual version assignment', async (version) => {
    const binding = makeBinding()
    Object.values(binding.selectedByLayer).flat().forEach((pack) => {
      if (['executive-brief', 'executive-brief-schema'].includes(pack.capabilityKey)) pack.contentHash = ss040TargetHashFor(pack.capabilityKey)
    })
    const plan = makePlan({}, makeRuntime(), binding)
    attachSs040PlanFixtureContract(plan.payload)
    const input = JSON.parse(plan.payload.evidenceToMeaning.contractJson).inputs
    input.composition.providerCompatibility = { contractVersion: version, status: 'READY' }
    if (version === EVIDENCE_TO_DRAFT_PROVIDER_VERSION) {
      input.composition.contractVersion = EVIDENCE_TO_DRAFT_INPUT_VERSION
      input.sourceSnapshot.evidenceObjects.forEach((row) => Object.assign(row, {
        claimStatus: 'SOURCE_PRESENTED', sourceLocation: 'source-1#synthetic-storage-regression',
        scope: { organisation: 'Explicit synthetic storage regression' }, time: { from: '2026-01-01', to: '2026-10-01' },
        materiality: 'SOURCE_RECORDED', proofOrderDisposition: 'NOT_ESTABLISHED', proofRequirementCodes: ['ATTRIBUTION'],
      }))
      input.composition.businessFactLedger.facts.forEach((fact) => {
        input.sourceSnapshot.evidenceObjects.find((row) => row.evidenceObjectId === fact.evidenceObjectId).draftPlacement = {
          version: 'evidence-to-draft-placement.v1', targetReceiptFingerprint: input.selectedTarget.receiptFingerprint,
          sourceSectionKeys: ['customer_context'], targetSectionKeys: [...fact.sectionKeys],
        }
        fact.sectionKeys = ['customer_context']
      })
      await freezeSs041Snapshot(input, { scopeOverride: { tenantId: String(plan.tenantId),
        customerId: String(plan.customerId), runtimeInstanceId: String(plan.runtimeInstanceId) },
      sourceSections: [{ sectionKey: 'customer_context', references: input.sourceSnapshot.evidenceObjects.map((row) => row.evidenceObjectId) }] })
    }
    const contract = compileEvidenceToMeaningContract(input)
    expect(['READY', 'READY_TO_DRAFT']).toContain(contract.status)
    plan.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
      contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
    plan.planFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(plan.payload)
    const projection = readRuntimeEvidenceToMeaningProviderProjection(plan)
    const output = makeSyntheticStage().outputSnapshot
    Object.assign(output.sections[0], { implications: ['Keep the synthetic evidence boundary explicit.'],
      recommendations: ['Inspect exact source lineage.'], qualification: 'Explicit synthetic storage regression only.', assumptions: [], gaps: [] })
    output.sections[0].truthReferences = plan.payload.lockedTruth.acceptedSections.map((section) => section.sectionKey)
    output.sections[0].contributingActivationIds = plan.payload.stagePlan.find((stage) => stage.stageKey === 'FRAMEWORK_GUIDANCE').assignedActivationIds
    output.visibleGaps = buildOutcomeQualityVisibleGaps(plan)
    const candidate = buildOutcomeQualityStageExecutionCandidate({ plan, runtimeInstanceId: plan.runtimeInstanceId,
      expectedPlanFingerprint: plan.planFingerprint, stageKey: 'FRAMEWORK_GUIDANCE', status: 'SUCCEEDED', output,
      executionIdentity: { executionMode: 'LIVE_TEST', providerKey: 'openai', model: 'synthetic-storage-model',
        providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
        grrExecutionId: 'synthetic-grr', grrRuntimeArtifactId: 'synthetic-artifact', runtimeVersion: runtimeUpdatedAt },
      startedAt: '2026-10-02T10:00:00.000Z', completedAt: '2026-10-02T10:00:00.000Z' })
    const receipt = Object.fromEntries(['contractVersion', 'contractId', 'contractHash', 'projectionHash'].map((field) => [field, projection[field]]))
    expect(receipt.contractVersion).toBe(version)
    expect(candidate.inputSnapshot.evidenceToMeaning).toEqual(receipt)
    const saved = await OutcomeQualityStageExecution.create({ ...candidate,
      stageExecutionId: `outcome_quality_stage_${randomUUID()}`, createdBy: ids.actor })
    const readback = await OutcomeQualityStageExecution.findById(saved._id).lean()
    expect(readback.inputSnapshot.evidenceToMeaning).toEqual(receipt)
    expect(readback.inputFingerprint).toBe(candidate.inputFingerprint)
    expect(readback.attemptFingerprint).toBe(candidate.attemptFingerprint)
    expect(hashOutcomeQualityStageValue(readback.inputSnapshot)).toBe(candidate.inputFingerprint)
    if (version === EVIDENCE_TO_DRAFT_PROVIDER_VERSION) {
      const providerOutput = { outputType: 'WORKING_DRAFT', schemaVersion: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
        draftVersion: 1, title: 'Working Draft', sections: projection.sectionLedger.filter((row) => row.status === 'SUPPORTED').map((row, index) => ({
          order: index + 1, sectionKey: row.targetSectionKey, title: row.heading,
          content: projection.claimProjections.filter((claim) => row.claimKeys.includes(claim.claimKey)).map((claim) => claim.statement).join(' '),
          claims: projection.claimProjections.filter((claim) => row.claimKeys.includes(claim.claimKey)),
          truthReferences: [row.targetSectionKey], assumptions: [], gaps: buildOutcomeQualityVisibleGaps(plan),
        })), decisionLogic: projection.decisionProjections, assumptions: [], visibleGaps: buildOutcomeQualityVisibleGaps(plan) }
      const workingOutput = buildWorkingDraftStageOutputFromProviderOutput({ providerOutput, plan, sourceStage: readback })
      const working = buildOutcomeQualityStageExecutionCandidate({ plan, runtimeInstanceId: plan.runtimeInstanceId,
        expectedPlanFingerprint: plan.planFingerprint, stageKey: 'WORKING_DRAFT', status: 'SUCCEEDED', output: workingOutput,
        sourceStageExecution: readback, predecessorStageExecutionId: readback.stageExecutionId,
        predecessorAttemptFingerprint: readback.attemptFingerprint,
        executionIdentity: { executionMode: 'LIVE_TEST', providerKey: 'openai', model: 'synthetic-storage-model',
          providerConfigurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
          grrExecutionId: 'synthetic-working-grr', grrRuntimeArtifactId: 'synthetic-working-artifact', runtimeVersion: runtimeUpdatedAt },
        startedAt: '2026-10-02T10:01:00.000Z', completedAt: '2026-10-02T10:01:00.000Z' })
      const first = { ...working, stageExecutionId: `outcome_quality_stage_${randomUUID()}`, createdBy: ids.actor }
      const second = { ...first, stageExecutionId: `outcome_quality_stage_${randomUUID()}` }
      const race = await Promise.allSettled([OutcomeQualityStageExecution.create(first), OutcomeQualityStageExecution.create(second)])
      expect(race.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
      expect(race.find((row) => row.status === 'rejected').reason.keyPattern)
        .toEqual({ runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 })
      const stored = await OutcomeQualityStageExecution.findOne({ planId: plan.planId, stageKey: 'WORKING_DRAFT' }).lean()
      expect(stored.inputSnapshot.workingDraftReferenceLedger).toEqual(working.inputSnapshot.workingDraftReferenceLedger)
      expect(stored.inputSnapshot.evidenceToMeaning).toEqual(receipt)
      expect(stored.inputFingerprint).toBe(working.inputFingerprint)
      expect(stored.predecessorStageExecutionId).toBe(readback.stageExecutionId)
      await expect(OutcomeQualityStageExecution.updateOne({ _id: stored._id }, { $unset: { 'inputSnapshot.workingDraftReferenceLedger': 1 } }))
        .rejects.toMatchObject({ code: 'OUTCOME_QUALITY_STAGE_IMMUTABLE' })
      const session = await mongoose.startSession()
      const rollbackCandidate = buildOutcomeQualityStageExecutionCandidate({ plan, runtimeInstanceId: plan.runtimeInstanceId,
        expectedPlanFingerprint: plan.planFingerprint, stageKey: 'WORKING_DRAFT', status: 'SUCCEEDED', output: workingOutput,
        sourceStageExecution: readback, expectedLatestAttemptNumber: 1, predecessorStageExecutionId: stored.stageExecutionId,
        predecessorAttemptFingerprint: stored.attemptFingerprint, executionIdentity: working.executionIdentity,
        startedAt: '2026-10-02T10:02:00.000Z', completedAt: '2026-10-02T10:02:00.000Z' })
      try {
        await expect(session.withTransaction(async () => {
          await OutcomeQualityStageExecution.create([{ ...rollbackCandidate,
            stageExecutionId: `outcome_quality_stage_${randomUUID()}`, createdBy: ids.actor }], { session })
          throw new Error('Synthetic working-stage rollback')
        })).rejects.toThrow('Synthetic working-stage rollback')
      } finally { await session.endSession() }
      expect((await OutcomeQualityStageExecution.findById(stored._id).lean()).inputSnapshot.workingDraftReferenceLedger)
        .toEqual(working.inputSnapshot.workingDraftReferenceLedger)
      expect(await OutcomeQualityStageExecution.countDocuments({ planId: plan.planId, stageKey: 'WORKING_DRAFT' })).toBe(1)
    }
  })
  test.each([undefined, EVIDENCE_TO_MEANING_PROVIDER_VERSION, EVIDENCE_TO_DRAFT_PROVIDER_VERSION])('saves exact %s lineage and input fingerprint through the actual model', async (version) => {
    const candidate = makeSyntheticStage(version)
    const saved = await OutcomeQualityStageExecution.create(candidate)
    const readback = await OutcomeQualityStageExecution.findById(saved._id).lean()
    expect(readback.inputSnapshot.evidenceToMeaning).toEqual(candidate.inputSnapshot.evidenceToMeaning)
    expect(readback.inputFingerprint).toBe(candidate.inputFingerprint)
    expect(readback.attemptFingerprint).toBe(candidate.attemptFingerprint)
    expect(hashOutcomeQualityStageValue(readback.inputSnapshot)).toBe(candidate.inputFingerprint)
    await expect(OutcomeQualityStageExecution.updateOne({ _id: saved._id }, { $set: { inputFingerprint: 'f'.repeat(64) } }))
      .rejects.toMatchObject({ code: 'OUTCOME_QUALITY_STAGE_IMMUTABLE' })
    expect((await OutcomeQualityStageExecution.findById(saved._id).lean()).inputFingerprint).toBe(candidate.inputFingerprint)
  })
  test('admits one exact winner for duplicate stage attempts with a valid receipt', async () => {
    const candidate = makeSyntheticStage(EVIDENCE_TO_DRAFT_PROVIDER_VERSION)
    const competing = { ...candidate, stageExecutionId: `outcome_quality_stage_${randomUUID()}` }
    const result = await Promise.allSettled([OutcomeQualityStageExecution.create(candidate), OutcomeQualityStageExecution.create(competing)])
    expect(result.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
    expect(result.find((row) => row.status === 'rejected').reason.code).toBe(11000)
    expect(result.find((row) => row.status === 'rejected').reason.keyPattern)
      .toEqual({ runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 })
    const rows = await OutcomeQualityStageExecution.find({ planId: candidate.planId }).lean()
    expect(rows).toHaveLength(1)
    expect(rows[0].inputSnapshot.evidenceToMeaning).toEqual(candidate.inputSnapshot.evidenceToMeaning)
    expect(rows[0].attemptFingerprint).toBe(candidate.attemptFingerprint)
  })
  test('rolls back stage and a synthetic audit marker together in a real transaction', async () => {
    const candidate = makeSyntheticStage(EVIDENCE_TO_DRAFT_PROVIDER_VERSION)
    const session = await mongoose.startSession()
    try {
      await expect(session.withTransaction(async () => {
        await OutcomeQualityStageExecution.create([candidate], { session })
        await mongoose.connection.db.collection('auditlogs').insertOne({ syntheticTestMarker: candidate.stageExecutionId }, { session })
        throw new Error('Synthetic lineage transaction abort')
      })).rejects.toThrow('Synthetic lineage transaction abort')
      expect(await OutcomeQualityStageExecution.countDocuments({ planId: candidate.planId })).toBe(0)
      expect(await mongoose.connection.db.collection('auditlogs').countDocuments({ syntheticTestMarker: candidate.stageExecutionId })).toBe(0)
    } finally { await session.endSession() }
  })
})
