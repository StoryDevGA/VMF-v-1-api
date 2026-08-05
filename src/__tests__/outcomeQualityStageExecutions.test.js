import mongoose from 'mongoose'
import { jest } from '@jest/globals'

import {
  OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION,
  OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS,
  OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
  OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION,
  OUTCOME_QUALITY_STAGE_ERROR_CODES,
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
  OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
  OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
  OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
  OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS,
  OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import OutcomeQualityStageExecution from '../models/OutcomeQualityStageExecution.js'
import {
  assertOutcomeKnowledgeCompositionPlanIntegrity,
  buildOutcomeKnowledgeCompositionPlanCandidate,
  hashOutcomeKnowledgeCompositionSemanticValue,
} from '../services/outcomeKnowledgeCompositionPlanService.js'
import {
  buildOutcomeQualityVisibleGaps,
  buildOutcomeQualityStageExecutionCandidate,
  createOutcomeQualityStageExecution,
  hashOutcomeQualityStageValue,
  serializeOutcomeQualityStageExecution,
} from '../services/outcomeQualityStageExecutionService.js'
import {
  buildOutcomeNarrativePlanOutput,
  buildOutcomeShapedCandidateRevisionOutput,
  buildOutcomeShapedCandidateOutput,
} from '../services/outcomePostArlQualityChainService.js'
import {
  buildExpressionOnlyRevisionSection,
  isInternalRenderedExpressionText,
} from '../utils/outcomeRenderedExpressionRevision.js'

const ids = {
  runtime: new mongoose.Types.ObjectId('6a6c8115bb9cebc18a1eca9c'),
  tenant: new mongoose.Types.ObjectId('6a6b14eca737c717e99b8069'),
  customer: new mongoose.Types.ObjectId('6a6b12fea737c717e99b7f6b'),
  actor: new mongoose.Types.ObjectId('6a6b135ba737c717e99b7f8a'),
  plan: new mongoose.Types.ObjectId('6a705569a7b760264f6a501f'),
  stage: new mongoose.Types.ObjectId('6a7100000000000000000001'),
}

const runtimeUpdatedAt = '2026-08-02T18:59:29.591Z'
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
  makePack({ packType: 'RL', packKey: 'rendering-layer', knowledgeLayer: 'COMMUNICATION_PATTERN', suffix: '2' }),
  makePack({ packType: 'OUTPUT_SCHEMA', packKey: 'output-schemas-pack', knowledgeLayer: 'OUTPUT_SCHEMA', suffix: '3' }),
  makePack({ packType: 'TRUTH_CERTIFICATION', packKey: 'truth-certification-pack', knowledgeLayer: 'VALIDATION', suffix: '4' }),
  makePack({ packType: 'OUTPUT_TYPE_DEFINITION', packKey: 'outcome-output-types', knowledgeLayer: 'OUTPUT_TYPE', suffix: '5' }),
]

const makeBinding = () => {
  const safeguards = mandatory()
  const blocking = makePack({ packType: 'TRUTH_CERTIFICATION', packKey: 'blocking-rules', knowledgeLayer: 'VALIDATION', suffix: '6' })
  const outputType = makePack({ packType: 'OUTPUT_TYPE_DEFINITION', packKey: 'executive-brief', knowledgeLayer: 'OUTPUT_TYPE', capabilityKey: 'executive-brief', suffix: '7' })
  const outputSchema = makePack({ packType: 'OUTPUT_SCHEMA', packKey: 'executive-brief-schema', knowledgeLayer: 'OUTPUT_SCHEMA', capabilityKey: 'executive-brief-schema', suffix: '8' })
  const style = makePack({ packType: 'STYLE', packKey: 'executive-briefing-style', knowledgeLayer: 'STYLE', capabilityKey: 'executive-brief-style', suffix: '9' })
  const selected = [...safeguards, blocking, outputType, outputSchema, style]
  return {
    status: 'READY',
    mode: 'REQUEST_SPECIFIC',
    policyKey: 'outcome-studio-v1-required-packs',
    policyVersion: '1.0.0',
    mandatorySafeguards: safeguards,
    selectedByLayer: {
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

const makePlan = (intentOverrides = {}, runtime = makeRuntime()) => {
  const candidate = buildOutcomeKnowledgeCompositionPlanCandidate({
    runtime,
    binding: makeBinding(),
    context: makeContext(),
    consumerIntent: {
      outcome: 'One Parlon Executive Brief',
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
    planId: 'outcome_kcp_qa',
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

const makeLegacyPlan = () => {
  const plan = makePlan()
  plan.payload = structuredClone(plan.payload)
  delete plan.payload.lockedTruth.acceptedTruthIdentityContractVersion
  plan.payload.lockedTruth.acceptedSections.forEach((section) => {
    section.sectionKey = section.stateSectionKey
    delete section.stateSectionKey
  })
  plan.planFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(plan.payload)
  return plan
}

const makeOutput = (plan = makePlan()) => {
  const assigned = plan.payload.stagePlan
    .find((stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE)
    .assignedActivationIds
  const truth = plan.payload.lockedTruth.acceptedSections.map((section) => section.sectionKey)
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.FRAMEWORK_GUIDANCE_ANALYSIS,
    schemaVersion: OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
    title: 'Parlon Executive Brief Framework Analysis QA',
    sections: [{
      order: 1,
      sectionKey: 'governed_position',
      title: 'Governed position',
      analysis: 'The accepted sections establish the bounded context for the executive decision.',
      implications: ['Priorities must remain traceable to accepted truth.'],
      recommendations: ['Use the evidence boundary when ranking the next actions.'],
      qualification: 'No delivery file type or channel is inferred.',
      truthReferences: truth,
      contributingActivationIds: assigned,
      assumptions: [],
      gaps: [...plan.payload.consumerIntent.unresolvedGaps],
    }],
    decisionUsefulness: {
      summary: 'The evidence supports a bounded executive decision discussion.',
      priorities: ['Preserve the accepted evidence boundary.'],
      materialRisks: ['Unspecified delivery details remain visible.'],
      recommendedNextStep: 'Develop a Working Draft from this governed analysis after this stage is accepted.',
    },
    assumptions: [],
    visibleGaps: buildOutcomeQualityVisibleGaps(plan),
  }
}

const executionIdentity = (overrides = {}) => ({
  executionMode: 'LIVE_TEST',
  providerKey: 'openai',
  providerConfigurationVersion: overrides.providerKey === ''
    ? ''
    : OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
  model: 'qa-model',
  grrExecutionId: 'grr_exec_qa',
  grrRuntimeArtifactId: 'grr_art_qa',
  runtimeVersion: 'grr.v1',
  ...overrides,
})

const buildSuccess = (overrides = {}) => {
  const plan = overrides.plan || makePlan()
  return buildOutcomeQualityStageExecutionCandidate({
    plan,
    runtimeInstanceId: ids.runtime,
    expectedPlanFingerprint: plan.planFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    expectedLatestAttemptNumber: 0,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    output: makeOutput(plan),
    executionIdentity: executionIdentity(),
    startedAt: '2026-08-03T09:00:00.000Z',
    completedAt: '2026-08-03T09:00:01.250Z',
    ...overrides,
  })
}

const buildFailure = (status = OUTCOME_QUALITY_STAGE_STATUSES.FAILED, overrides = {}) => {
  const plan = overrides.plan || makePlan()
  return buildOutcomeQualityStageExecutionCandidate({
    plan,
    runtimeInstanceId: ids.runtime,
    expectedPlanFingerprint: plan.planFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    expectedLatestAttemptNumber: 0,
    status,
    failure: { failureCode: status, safeReason: 'The attempt did not succeed.', retryable: true },
    executionIdentity: executionIdentity({ providerKey: '', model: '', grrExecutionId: '', grrRuntimeArtifactId: '' }),
    startedAt: '2026-08-03T09:00:00.000Z',
    completedAt: '2026-08-03T09:00:00.250Z',
    ...overrides,
  })
}

const internalExecutionIdentity = () => executionIdentity({
  executionMode: 'INTERNAL_GOVERNED',
  providerKey: '',
  providerConfigurationVersion: '',
  model: '',
  grrExecutionId: '',
  grrRuntimeArtifactId: '',
  runtimeVersion: 'quality-chain.v1',
})

const workingDraftExecutionIdentity = () => executionIdentity({
  providerConfigurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
  runtimeVersion: 'working-draft.v1',
})

const makeFrameworkGuidanceSource = (plan = makePlan()) => {
  const candidate = buildSuccess({ plan })
  return {
    _id: ids.stage,
    stageExecutionId: 'outcome_quality_stage_framework_source',
    createdBy: ids.actor,
    createdAt: new Date('2026-08-03T09:00:02.000Z'),
    ...candidate,
  }
}

const makeWorkingDraftOutput = (plan, source) => {
  const truthReferences = plan.payload.lockedTruth.acceptedSections.map((section) => section.sectionKey)
  const contributingActivationIds = [...new Set(source.outputSnapshot.sections
    .flatMap((section) => section.contributingActivationIds))]
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT,
    schemaVersion: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
    draftVersion: 1,
    title: 'Parlon Executive Brief Working Draft QA',
    sections: [{
      order: 1,
      sectionKey: 'executive_position',
      title: 'Executive position',
      content: 'The governed evidence supports a bounded executive decision with explicit qualifications.',
      claims: [{
        claimKey: 'claim_governed_position',
        statement: 'The current position is bounded by the six accepted truth sections.',
        truthReferences,
        evidence: ['All six accepted truth identities are retained in the draft lineage.'],
      }],
      truthReferences,
      contributingActivationIds,
      assumptions: [],
      gaps: [...plan.payload.consumerIntent.unresolvedGaps],
    }],
    decisionLogic: [{
      decisionKey: 'preserve_evidence_boundary',
      rationale: 'The executive recommendation must not outrun accepted evidence.',
      priority: 'HIGH',
      truthReferences,
    }],
    compositionProvenance: {
      frameworkGuidanceStageExecutionId: source.stageExecutionId,
      frameworkGuidanceOutputFingerprint: source.outputFingerprint,
      planFingerprint: plan.planFingerprint,
    },
    revisionHistory: [{
      version: 1,
      summary: 'Initial governed Working Draft from successful Framework Guidance.',
      sourceStageExecutionId: source.stageExecutionId,
      sourceOutputFingerprint: source.outputFingerprint,
    }],
    assumptions: [],
    visibleGaps: buildOutcomeQualityVisibleGaps(plan),
  }
}

const buildWorkingDraft = (overrides = {}) => {
  const plan = overrides.plan || makePlan()
  const source = overrides.sourceStageExecution || makeFrameworkGuidanceSource(plan)
  return buildOutcomeQualityStageExecutionCandidate({
    plan,
    runtimeInstanceId: ids.runtime,
    expectedPlanFingerprint: plan.planFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
    expectedLatestAttemptNumber: 0,
    predecessorStageExecutionId: source.stageExecutionId,
    predecessorAttemptFingerprint: source.attemptFingerprint,
    sourceStageExecution: source,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    output: makeWorkingDraftOutput(plan, source),
    executionIdentity: workingDraftExecutionIdentity(),
    startedAt: '2026-08-03T09:01:00.000Z',
    completedAt: '2026-08-03T09:01:00.500Z',
    ...overrides,
  })
}

const makeWorkingDraftSource = (plan = makePlan()) => {
  const sourceStageExecution = makeFrameworkGuidanceSource(plan)
  const candidate = buildWorkingDraft({ plan, sourceStageExecution })
  return {
    _id: new mongoose.Types.ObjectId('6a7100000000000000000002'),
    stageExecutionId: 'outcome_quality_stage_working_draft_source',
    createdBy: ids.actor,
    createdAt: new Date('2026-08-03T09:01:01.000Z'),
    ...candidate,
  }
}

const makeArlOutput = (plan, source) => {
  const truthReferences = plan.payload.lockedTruth.acceptedSections.map((section) => section.sectionKey)
  const assigned = plan.payload.stagePlan
    .find((stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW)
    .assignedActivationIds
  const decisionLogicFingerprint = hashOutcomeQualityStageValue(source.outputSnapshot.decisionLogic)
  const meaningFingerprint = hashOutcomeQualityStageValue({
    workingDraftStageExecutionId: source.stageExecutionId,
    workingDraftOutputFingerprint: source.outputFingerprint,
    decisionLogicFingerprint,
  })
  const findings = [
    'ANALYTICAL_STRENGTH',
    'COHERENCE',
    'PRIORITISATION',
    'EVIDENCE_USE',
    'DECISION_USEFULNESS',
  ].map((dimension) => ({
    findingKey: `${dimension.toLowerCase()}_confirmed`,
    dimension,
    severity: 'LOW',
    finding: `${dimension.replaceAll('_', ' ')} is sufficient for the bounded decision.`,
    requiredChange: false,
    disposition: 'ACCEPTED_NO_CHANGE',
    changeApplied: false,
  }))
  return {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.ARL_MEANING_REVIEW,
    schemaVersion: OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
    workingDraftStageExecutionId: source.stageExecutionId,
    workingDraftOutputFingerprint: source.outputFingerprint,
    findings,
    approvedMeaning: {
      state: 'APPROVED',
      version: 1,
      workingDraftStageExecutionId: source.stageExecutionId,
      workingDraftOutputFingerprint: source.outputFingerprint,
      meaningSummary: 'The bounded executive position and its decision logic are approved for narrative planning.',
      decisionLogic: source.outputSnapshot.decisionLogic,
      meaningFingerprint,
      decisionLogicFingerprint,
    },
    truthReferences,
    contributingActivationIds: assigned,
    visibleGaps: buildOutcomeQualityVisibleGaps(plan),
  }
}

const buildArlReview = (overrides = {}) => {
  const plan = overrides.plan || makePlan()
  const source = overrides.sourceStageExecution || makeWorkingDraftSource(plan)
  return buildOutcomeQualityStageExecutionCandidate({
    plan,
    runtimeInstanceId: ids.runtime,
    expectedPlanFingerprint: plan.planFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
    expectedLatestAttemptNumber: 0,
    predecessorStageExecutionId: source.stageExecutionId,
    predecessorAttemptFingerprint: source.attemptFingerprint,
    sourceStageExecution: source,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    output: makeArlOutput(plan, source),
    executionIdentity: internalExecutionIdentity(),
    startedAt: '2026-08-03T09:02:00.000Z',
    completedAt: '2026-08-03T09:02:00.500Z',
    ...overrides,
  })
}

const makeArlSource = (plan = makePlan()) => {
  const workingDraftStage = makeWorkingDraftSource(plan)
  const candidate = buildArlReview({ plan, sourceStageExecution: workingDraftStage })
  return {
    workingDraftStage,
    arlStage: {
      _id: new mongoose.Types.ObjectId('6a7100000000000000000003'),
      stageExecutionId: 'outcome_quality_stage_arl_source',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:02:01.000Z'),
      ...candidate,
    },
  }
}

const buildNarrativePlan = (overrides = {}) => {
  const plan = overrides.plan || makePlan()
  const sources = overrides.sources || makeArlSource(plan)
  const output = buildOutcomeNarrativePlanOutput({
    plan,
    arlStage: sources.arlStage,
    workingDraftStage: sources.workingDraftStage,
  })
  return buildOutcomeQualityStageExecutionCandidate({
    plan,
    runtimeInstanceId: ids.runtime,
    expectedPlanFingerprint: plan.planFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
    expectedLatestAttemptNumber: 0,
    predecessorStageExecutionId: sources.arlStage.stageExecutionId,
    predecessorAttemptFingerprint: sources.arlStage.attemptFingerprint,
    sourceStageExecution: sources.arlStage,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    output,
    executionIdentity: internalExecutionIdentity(),
    startedAt: '2026-08-03T09:03:00.000Z',
    completedAt: '2026-08-03T09:03:00.100Z',
    ...overrides,
  })
}

const makeNarrativePlanSource = (plan = makePlan()) => ({
  _id: new mongoose.Types.ObjectId('6a7100000000000000000004'),
  stageExecutionId: 'outcome_quality_stage_narrative_plan_source',
  createdBy: ids.actor,
  createdAt: new Date('2026-08-03T09:03:01.000Z'),
  ...buildNarrativePlan({ plan }),
})

const buildShapedCandidate = (overrides = {}) => {
  const plan = overrides.plan || makePlan()
  const source = overrides.sourceStageExecution || makeNarrativePlanSource(plan)
  const output = buildOutcomeShapedCandidateOutput({
    plan,
    narrativePlanStage: source,
    title: 'Parlon Executive Brief',
  })
  return buildOutcomeQualityStageExecutionCandidate({
    plan,
    runtimeInstanceId: ids.runtime,
    expectedPlanFingerprint: plan.planFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
    expectedLatestAttemptNumber: 0,
    predecessorStageExecutionId: source.stageExecutionId,
    predecessorAttemptFingerprint: source.attemptFingerprint,
    sourceStageExecution: source,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    output,
    executionIdentity: internalExecutionIdentity(),
    startedAt: '2026-08-03T09:04:00.000Z',
    completedAt: '2026-08-03T09:04:00.100Z',
    ...overrides,
  })
}

const makeShapedCandidateSource = (plan = makePlan()) => ({
  _id: new mongoose.Types.ObjectId('6a7100000000000000000005'),
  stageExecutionId: 'outcome_quality_stage_shaped_candidate_source',
  createdBy: ids.actor,
  createdAt: new Date('2026-08-03T09:04:01.000Z'),
  ...buildShapedCandidate({ plan }),
})

const buildRenderedExpressionRl = (overrides = {}) => {
  const plan = overrides.plan || makePlan()
  const source = overrides.sourceStageExecution || makeShapedCandidateSource(plan)
  const assigned = plan.payload.stagePlan
    .find((stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL)
    .assignedActivationIds
  const output = {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL,
    schemaVersion: OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
    candidateStageExecutionId: source.stageExecutionId,
    candidateOutputFingerprint: source.outputFingerprint,
    overallStatus: 'PASS',
    findings: [
      'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
    ].map((dimension) => ({
      dimension,
      status: 'PASS',
      finding: `${dimension.replaceAll('_', ' ')} conforms to the governed candidate contract.`,
      requiredChange: false,
    })),
    truthReferences: [...source.outputSnapshot.truthReferences],
    contributingActivationIds: [...assigned],
    visibleGaps: [...source.outputSnapshot.visibleGaps],
  }
  return buildOutcomeQualityStageExecutionCandidate({
    plan,
    runtimeInstanceId: ids.runtime,
    expectedPlanFingerprint: plan.planFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    expectedLatestAttemptNumber: 0,
    predecessorStageExecutionId: source.stageExecutionId,
    predecessorAttemptFingerprint: source.attemptFingerprint,
    sourceStageExecution: source,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    output,
    executionIdentity: executionIdentity({
      providerConfigurationVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
      runtimeVersion: 'rendered-expression-rl.v1',
    }),
    startedAt: '2026-08-03T09:05:00.000Z',
    completedAt: '2026-08-03T09:05:00.500Z',
    ...overrides,
  })
}

const clone = (value) => structuredClone(value)

const makeFailedRlArtifact = (failedRl, findings) => ({
  runtimeArtifactId: failedRl.executionIdentity?.grrRuntimeArtifactId,
  executionId: failedRl.executionIdentity?.grrExecutionId,
  status: 'GENERATED',
  outputTypeKey: 'RENDERED_EXPRESSION_RL',
  generatedOutput: {
    outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL,
    schemaVersion: OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
    overallStatus: 'FAIL',
    findings,
  },
})

const refreshStageRecordFingerprints = (record) => {
  record.inputFingerprint = hashOutcomeQualityStageValue(record.inputSnapshot)
  record.attemptFingerprint = hashOutcomeQualityStageValue({
    qualityRunId: record.qualityRunId,
    planId: record.planId,
    planVersion: record.planVersion,
    planFingerprint: record.planFingerprint,
    stageKey: record.stageKey,
    stageOrder: record.stageOrder,
    attemptNumber: record.attemptNumber,
    predecessorStageExecutionId: record.predecessorStageExecutionId,
    predecessorAttemptFingerprint: record.predecessorAttemptFingerprint,
    status: record.status,
    inputFingerprint: record.inputFingerprint,
    outputFingerprint: record.outputFingerprint,
    output: record.outputSnapshot,
    failure: record.failure,
    executionIdentity: record.executionIdentity,
  })
}

const makeQuery = (value) => {
  const query = {
    lean: jest.fn(async () => value),
    session: jest.fn(() => query),
    sort: jest.fn(() => query),
  }
  return query
}

const makePersistenceDeps = ({
  latest = null,
  remediationStage = null,
  sourceStage = null,
  transactionSourceStage = sourceStage,
  auditError = null,
  saveError = null,
  plan: suppliedPlan = null,
  latestPlan: suppliedLatestPlan = null,
  runtime: suppliedRuntime = null,
  transactionPlan: suppliedTransactionPlan = null,
  transactionLatestPlan: suppliedTransactionLatestPlan = null,
  transactionRuntime: suppliedTransactionRuntime = null,
  invalidSession = false,
} = {}) => {
  const plan = suppliedPlan || makePlan()
  const latestPlan = suppliedLatestPlan || plan
  const runtime = suppliedRuntime || makeRuntime()
  const transactionPlan = suppliedTransactionPlan || plan
  const transactionLatestPlan = suppliedTransactionLatestPlan || latestPlan
  const transactionRuntime = suppliedTransactionRuntime || runtime
  const saved = []
  const committedAudits = []
  const pendingStages = []
  const pendingAudits = []
  let planReadCount = 0
  let latestPlanReadCount = 0
  let runtimeReadCount = 0
  let sourceStageReadCount = 0
  const planModel = {
    findOne: jest.fn((filter) => {
      if (filter._id) return makeQuery(planReadCount++ === 0 ? plan : transactionPlan)
      return makeQuery(latestPlanReadCount++ === 0 ? latestPlan : transactionLatestPlan)
    }),
  }
  const runtimeModel = {
    findOne: jest.fn(() => makeQuery(runtimeReadCount++ === 0 ? runtime : transactionRuntime)),
  }
  function StageModel(payload) {
    Object.assign(this, payload)
    this._id = ids.stage
    this.createdAt = new Date('2026-08-03T09:00:02.000Z')
    this.save = jest.fn(async () => {
      if (saveError) throw saveError
      pendingStages.push(this)
      return this
    })
  }
  StageModel.findOne = jest.fn((filter) => {
    if (filter.stageExecutionId) return makeQuery(
      remediationStage?.stageExecutionId === filter.stageExecutionId ? remediationStage : null,
    )
    const isSourceRead = sourceStage?.stageKey === filter.stageKey
      || transactionSourceStage?.stageKey === filter.stageKey
    if (isSourceRead) {
      return makeQuery(sourceStageReadCount++ === 0 ? sourceStage : transactionSourceStage)
    }
    return makeQuery(latest)
  })
  const audit = {
    AUDIT_ACTIONS: { OUTCOME_QUALITY_STAGE_RECORDED: 'OUTCOME_QUALITY_STAGE_RECORDED' },
    RESOURCE_TYPES: { OutcomeQualityStageExecution: 'OutcomeQualityStageExecution' },
    log: jest.fn(async () => {
      if (auditError) throw auditError
      const record = { _id: new mongoose.Types.ObjectId() }
      pendingAudits.push(record)
      return record
    }),
  }
  const session = {
    withTransaction: jest.fn(async (callback) => {
      try {
        const result = await callback()
        saved.push(...pendingStages.splice(0))
        committedAudits.push(...pendingAudits.splice(0))
        return result
      } catch (error) {
        pendingStages.splice(0)
        pendingAudits.splice(0)
        throw error
      }
    }),
    endSession: jest.fn(async () => {}),
  }
  const mongooseClient = { startSession: jest.fn(async () => (invalidSession ? {} : session)) }
  return {
    plan,
    saved,
    audit,
    committedAudits,
    session,
    deps: {
      OutcomeKnowledgeCompositionPlan: planModel,
      OutcomeQualityStageExecution: StageModel,
      RuntimeInstance: runtimeModel,
      auditService: audit,
      mongoose: mongooseClient,
      assertTransactionSupport: jest.fn(),
    },
  }
}

const createArgs = (plan, candidate, overrides = {}) => ({
  planRecordId: ids.plan,
  runtimeInstanceId: ids.runtime,
  expectedPlanFingerprint: plan.planFingerprint,
  stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
  expectedLatestAttemptNumber: 0,
  status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
  output: makeOutput(plan),
  executionIdentity: executionIdentity(),
  startedAt: '2026-08-03T09:00:00.000Z',
  completedAt: '2026-08-03T09:00:01.250Z',
  expectedAttemptFingerprint: candidate.attemptFingerprint,
  actorUserId: ids.actor,
  ...overrides,
})

describe('Outcome quality stage execution contract', () => {
  it('builds a deterministic KCP-derived framework/guidance success candidate', () => {
    const first = buildSuccess()
    const second = buildSuccess()
    expect(second).toEqual(first)
    expect(first).toMatchObject({
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      stageOrder: 1,
      attemptNumber: 1,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      outputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      attemptFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      durationMs: 1250,
      truthReferenceCount: 2,
    })
    expect(first.inputSnapshot).not.toHaveProperty('prompt')
    expect(first.inputSnapshot.lockedTruth).toMatchObject({
      acceptedTruthIdentityContractVersion: OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION,
    })
    expect(first.inputSnapshot.lockedTruth.acceptedSections[0]).toEqual(expect.objectContaining({
      sectionKey: 'customer_context',
      stateSectionKey: 'customer_context',
      runtimePath: 'framework_state.sections.customer_context',
    }))
    expect(first.inputSnapshot.stage.assignedPacks.every((pack) => !('content' in pack))).toBe(true)
  })

  it('preserves resolution and governed-context warnings through every governed stage', () => {
    const plan = makePlan()
    plan.payload.resolution.warnings = ['Knowledge resolution warning QA.']
    plan.payload.governedContext.warnings = ['Governed context warning QA.']
    plan.payload.optionalGapCount += 2
    plan.gapCount += 2
    const {
      resolutionFingerprint: _resolutionFingerprint,
      selectedPacks,
      consideredPacks,
      consideredPackCoverage: _consideredPackCoverage,
      ...resolution
    } = plan.payload.resolution
    plan.resolutionFingerprint = hashOutcomeKnowledgeCompositionSemanticValue({
      resolution,
      selectedPacks,
      consideredPacks,
    })
    plan.payload.resolution.resolutionFingerprint = plan.resolutionFingerprint
    const { contextFingerprint: _contextFingerprint, ...governedContext } = plan.payload.governedContext
    plan.contextFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(governedContext)
    plan.payload.governedContext.contextFingerprint = plan.contextFingerprint
    plan.planFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(plan.payload)
    const expected = [
      'Exact delivery file type is not specified',
      'Exact delivery channel is not specified',
      'Knowledge resolution warning QA.',
      'Governed context warning QA.',
    ]

    const stages = [
      makeFrameworkGuidanceSource(plan),
      makeWorkingDraftSource(plan),
      makeArlSource(plan).arlStage,
      makeNarrativePlanSource(plan),
      makeShapedCandidateSource(plan),
      buildRenderedExpressionRl({ plan, sourceStageExecution: makeShapedCandidateSource(plan) }),
    ]

    stages.forEach((stage) => expect(stage.outputSnapshot.visibleGaps).toEqual(expected))
  })

  it('builds a typed Working Draft from the exact successful Framework Guidance predecessor', async () => {
    const candidate = buildWorkingDraft()
    expect(candidate.stageKey).toBe(OUTCOME_QUALITY_STAGES.WORKING_DRAFT)
    expect(candidate.stageOrder).toBe(2)
    expect(candidate.attemptNumber).toBe(1)
    expect(candidate.assignedActivationCount).toBe(0)
    expect(candidate.inputSnapshot.sourceStage).toEqual(expect.objectContaining({
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      stageExecutionId: candidate.predecessorStageExecutionId,
    }))
    expect(candidate.outputSnapshot.outputType).toBe(OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT)
    expect(candidate.outputSnapshot).not.toHaveProperty('approvedMeaning')
    const document = new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_working_draft_model',
      ...candidate,
      createdBy: ids.actor,
    })
    await expect(document.validate()).resolves.toBeUndefined()
  })

  it('rejects Working Draft approval claims and invalid source-stage lineage', () => {
    const plan = makePlan()
    const source = makeFrameworkGuidanceSource(plan)
    const output = makeWorkingDraftOutput(plan, source)
    output.approvedMeaning = { state: 'APPROVED' }
    expect(() => buildWorkingDraft({ plan, sourceStageExecution: source, output }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    const semanticClaim = makeWorkingDraftOutput(plan, source)
    semanticClaim.sections[0].claims[0].statement = 'Meaning is approved.'
    expect(() => buildWorkingDraft({ plan, sourceStageExecution: source, output: semanticClaim }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    for (const statement of ['ARL approved the meaning.', 'The meaning received approval.']) {
      const equivalentClaim = makeWorkingDraftOutput(plan, source)
      equivalentClaim.sections[0].claims[0].statement = statement
      expect(() => buildWorkingDraft({ plan, sourceStageExecution: source, output: equivalentClaim }))
        .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    }
    const multilineClaim = makeWorkingDraftOutput(plan, source)
    multilineClaim.sections[0].claims[0].statement = 'Meaning\nis approved.'
    expect(() => buildWorkingDraft({ plan, sourceStageExecution: source, output: multilineClaim }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    expect(() => buildWorkingDraft({
      plan,
      sourceStageExecution: { ...source, status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED },
    })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.PREDECESSOR_INVALID }))
    expect(() => buildWorkingDraft({
      plan,
      sourceStageExecution: source,
      predecessorStageExecutionId: 'wrong-stage',
    })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.PREDECESSOR_INVALID }))
  })

  it('builds an ARL-approved meaning record from the exact successful Working Draft', async () => {
    const candidate = buildArlReview()
    expect(candidate.stageKey).toBe(OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW)
    expect(candidate.stageOrder).toBe(3)
    expect(candidate.outputSnapshot.approvedMeaning.state).toBe('APPROVED')
    expect(candidate.outputSnapshot.approvedMeaning.workingDraftStageExecutionId)
      .toBe(candidate.inputSnapshot.sourceStage.stageExecutionId)
    const document = new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_arl_model',
      ...candidate,
      createdBy: ids.actor,
    })
    await expect(document.validate()).resolves.toBeUndefined()
  })

  it('fails closed when ARL has an unresolved required change or mismatched meaning fingerprint', () => {
    const plan = makePlan()
    const source = makeWorkingDraftSource(plan)
    const unresolved = makeArlOutput(plan, source)
    unresolved.findings[0] = {
      ...unresolved.findings[0],
      requiredChange: true,
      disposition: 'OPEN',
      changeApplied: false,
    }
    expect(() => buildArlReview({ plan, sourceStageExecution: source, output: unresolved }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    const mismatched = makeArlOutput(plan, source)
    mismatched.approvedMeaning.meaningFingerprint = '9'.repeat(64)
    expect(() => buildArlReview({ plan, sourceStageExecution: source, output: mismatched }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    const missingDimension = makeArlOutput(plan, source)
    missingDimension.findings.pop()
    expect(() => buildArlReview({ plan, sourceStageExecution: source, output: missingDimension }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    const concealedBlocking = makeArlOutput(plan, source)
    concealedBlocking.findings[0].severity = 'BLOCKING'
    expect(() => buildArlReview({ plan, sourceStageExecution: source, output: concealedBlocking }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
  })

  it('builds the ordered ONP and deterministic Executive Brief candidate from exact approved meaning', async () => {
    const narrativePlan = buildNarrativePlan()
    expect(narrativePlan).toMatchObject({
      stageKey: OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
      stageOrder: 4,
      assignedActivationCount: 0,
      outputSnapshot: {
        outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.OUTCOME_NARRATIVE_PLAN,
        schemaVersion: OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION,
      },
    })
    expect(narrativePlan.outputSnapshot.sections.map((section) => section.order)).toEqual([1])

    const shaped = buildShapedCandidate()
    expect(shaped).toMatchObject({
      stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
      stageOrder: 5,
      outputSnapshot: {
        outputType: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION,
        schemaVersion: OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
        candidateType: 'EXECUTIVE_BRIEF',
      },
    })
    const rendered = shaped.outputSnapshot.sections[0]
    expect(rendered.heading).toBe('Executive position')
    expect(rendered.body).toBe(makeNarrativePlanSource().outputSnapshot.sections[0].keyMessages.join('\n\n'))
    expect(shaped.executionIdentity.providerKey).toBe('')

    await expect(new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_narrative_plan_model',
      ...narrativePlan,
      createdBy: ids.actor,
    }).validate()).resolves.toBeUndefined()
    await expect(new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_shaped_candidate_model',
      ...shaped,
      createdBy: ids.actor,
    }).validate()).resolves.toBeUndefined()
  })

  it('splits long or multiline approved draft content into bounded ordered narrative messages', () => {
    const plan = makePlan()
    const sources = makeArlSource(plan)
    sources.workingDraftStage.outputSnapshot.sections[0].content = `${'Approved wording '.repeat(350)}\nSecond approved paragraph.`
    sources.workingDraftStage.outputFingerprint = hashOutcomeQualityStageValue(sources.workingDraftStage.outputSnapshot)
    sources.workingDraftStage.attemptFingerprint = hashOutcomeQualityStageValue({
      previous: sources.workingDraftStage.attemptFingerprint,
      outputFingerprint: sources.workingDraftStage.outputFingerprint,
    })
    sources.arlStage.predecessorAttemptFingerprint = sources.workingDraftStage.attemptFingerprint
    sources.arlStage.outputSnapshot.workingDraftOutputFingerprint = sources.workingDraftStage.outputFingerprint
    sources.arlStage.outputSnapshot.approvedMeaning.workingDraftOutputFingerprint = sources.workingDraftStage.outputFingerprint
    sources.arlStage.outputSnapshot.approvedMeaning.meaningFingerprint = hashOutcomeQualityStageValue({
      workingDraftStageExecutionId: sources.workingDraftStage.stageExecutionId,
      workingDraftOutputFingerprint: sources.workingDraftStage.outputFingerprint,
      decisionLogicFingerprint: sources.arlStage.outputSnapshot.approvedMeaning.decisionLogicFingerprint,
    })
    const output = buildOutcomeNarrativePlanOutput({
      plan,
      arlStage: sources.arlStage,
      workingDraftStage: sources.workingDraftStage,
    })
    expect(output.sections[0].keyMessages.length).toBeGreaterThan(1)
    expect(output.sections[0].keyMessages.every((message) => message.length <= 4000 && !message.includes('\n'))).toBe(true)
  })

  it('rejects Stage 5 meaning drift instead of silently bypassing ARL', () => {
    const plan = makePlan()
    const source = makeNarrativePlanSource(plan)
    const output = buildOutcomeShapedCandidateOutput({
      plan,
      narrativePlanStage: source,
      title: 'Parlon Executive Brief',
    })
    output.sections[0].body = 'A new unsupported claim replaces the approved meaning.'
    expect(() => buildShapedCandidate({ plan, sourceStageExecution: source, output }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.STAGE_BINDING_INVALID }))
    output.sections[0].body = source.outputSnapshot.sections[0].keyMessages.join('\n\n')
    output.sections[0].heading = 'A materially different conclusion'
    expect(() => buildShapedCandidate({ plan, sourceStageExecution: source, output }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.STAGE_BINDING_INVALID }))
  })

  it('builds a bounded expression-only Stage 5 revision from the exact failed RL lineage', async () => {
    const plan = makePlan()
    const narrativePlan = makeNarrativePlanSource(plan)
    narrativePlan.outputSnapshot.sections[0].keyMessages.push(
      'Parlon can prioritise the evidence-backed operating choice while keeping unresolved constraints visible.',
    )
    narrativePlan.outputFingerprint = hashOutcomeQualityStageValue(narrativePlan.outputSnapshot)
    const priorCandidate = {
      _id: new mongoose.Types.ObjectId('6a7100000000000000000005'),
      stageExecutionId: 'outcome_quality_stage_shaped_candidate_source',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:04:01.000Z'),
      ...buildShapedCandidate({ plan, sourceStageExecution: narrativePlan }),
    }
    const failedRlCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
      expectedLatestAttemptNumber: 0,
      predecessorStageExecutionId: priorCandidate.stageExecutionId,
      predecessorAttemptFingerprint: priorCandidate.attemptFingerprint,
      sourceStageExecution: priorCandidate,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: {
        failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE',
        safeReason: 'Rendered expression requires customer-facing revision.',
        retryable: false,
      },
      executionIdentity: executionIdentity({
        providerConfigurationVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
        runtimeVersion: 'rendered-expression-rl.v1',
      }),
      startedAt: '2026-08-03T09:05:00.000Z',
      completedAt: '2026-08-03T09:05:00.500Z',
    })
    const failedRl = {
      _id: new mongoose.Types.ObjectId(),
      stageExecutionId: 'outcome_quality_stage_rendered_expression_rl_failed',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:05:01.000Z'),
      ...failedRlCandidate,
    }
    const findings = [
      'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
    ].map((dimension) => ({ dimension, status: 'FAIL', finding: `${dimension} requires revision.`, requiredChange: true }))
    const output = buildOutcomeShapedCandidateRevisionOutput({
      failedRlStage: failedRl,
      narrativePlanStage: narrativePlan,
      plan,
      priorCandidateStage: priorCandidate,
      rlArtifact: makeFailedRlArtifact(failedRl, findings),
      title: 'Parlon Executive Brief',
    })
    expect(output).toMatchObject({
      candidateType: 'EXECUTIVE_BRIEF',
      candidateVersion: 2,
      revisionScope: 'EXPRESSION_ONLY',
      revisionOfStageExecutionId: priorCandidate.stageExecutionId,
      revisionOfOutputFingerprint: priorCandidate.outputFingerprint,
      remediationSourceStageExecutionId: failedRl.stageExecutionId,
      remediationSourceAttemptFingerprint: failedRl.attemptFingerprint,
      remediationFailureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE',
      narrativePlanStageExecutionId: narrativePlan.stageExecutionId,
      narrativePlanOutputFingerprint: narrativePlan.outputFingerprint,
      truthReferences: narrativePlan.outputSnapshot.truthReferences,
      visibleGaps: narrativePlan.outputSnapshot.visibleGaps,
    })
    expect(output.sections.map((section) => section.sectionKey))
      .toEqual(narrativePlan.outputSnapshot.sections.map((section) => section.sectionKey))
    expect(output.sections.every((section) => section.body.startsWith('Executive takeaway: '))).toBe(true)
    expect(output.sections.every((section) => section.body.includes('\n\nEvidence\n- '))).toBe(true)
    expect(output.sections.every((section) => !section.qualification
      || section.qualification.startsWith('What remains unknown\n- '))).toBe(true)
    expect(output.sections.flatMap((section) => [section.heading, section.body, section.qualification])
      .every((value) => !isInternalRenderedExpressionText(value))).toBe(true)

    const revisionCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: priorCandidate.stageExecutionId,
      predecessorAttemptFingerprint: priorCandidate.attemptFingerprint,
      sourceStageExecution: narrativePlan,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output,
      executionIdentity: internalExecutionIdentity(),
      startedAt: '2026-08-03T09:06:00.000Z',
      completedAt: '2026-08-03T09:06:00.100Z',
    })
    await expect(new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_shaped_candidate_revision_model',
      ...revisionCandidate,
      createdBy: ids.actor,
    }).validate()).resolves.toBeUndefined()
  })

  it('translates the inherited governance heading without changing its decision purpose', () => {
    const section = buildExpressionOnlyRevisionSection({
      sectionKey: 'output-requirements',
      heading: 'Output requirements and governance constraints (review note)',
      keyMessages: [
        'Known (accepted truth): - Customer: Parlon. - Market: Global infrastructure. Downstream governance note: ARL approval remains required.',
        'Parlon is the customer organization in scope.',
      ],
      qualification: 'Only the supplied evidence supports the decision.',
      diagramIntent: '',
    })
    expect(section.heading).toBe('Delivery requirements')
    expect(isInternalRenderedExpressionText(section.heading)).toBe(false)
    expect(section.body).toContain('- Customer: Parlon.')
    expect(section.body).toContain('- Market: Global infrastructure.')
    expect(section.body).not.toContain('analytical review')
    expect(section.body).toMatch(/^Executive takeaway: (Customer: Parlon\.|Market: Global infrastructure\.)/)
    expect(section.body).toContain('\n\nEvidence\n')
  })

  it('separates exact facts, implications and compact unknowns without inventing an action', () => {
    const section = buildExpressionOnlyRevisionSection({
      sectionKey: 'customer-context',
      heading: 'Customer and offer context',
      keyMessages: [
        'Known (accepted truth): - Customer: Parlon. - Market: Global infrastructure. Decision-relevance implications (bounded by evidence): - Buying context is not evidenced. - Regional tailoring is unsupported. Downstream governance note: ARL approval is required.',
      ],
      qualification: 'Company website not provided. Decision owner not evidenced.',
      diagramIntent: '',
    })
    expect(section).toMatchObject({ heading: 'Executive context' })
    expect(section.body).toContain('Executive takeaway: Buying context is not established in the supplied information.')
    expect(section.body).toContain('Evidence\n- Customer: Parlon.\n- Market: Global infrastructure.')
    expect(section.body).toContain('Decision implications\n- Regional tailoring is unsupported.')
    expect(section.qualification).toBe('What remains unknown\n- Company website not provided.\n- Decision owner not established in the supplied information.')
    expect(section.body).not.toMatch(/recommend|immediate action|owner|KPI|date|benefit/i)
  })

  it('expresses evidence constraints conditionally without claiming delivery conformance', () => {
    const section = buildExpressionOnlyRevisionSection({
      sectionKey: 'output-requirements',
      heading: 'Output requirements',
      keyMessages: [
        'Known (accepted truth): - The brief must retain searchable and accessible text. - The brief must retain editable structure where supported. Decision-relevance implications (bounded by evidence): - Delivery logistics for file type and channel are a blocking dependency for final delivery but are not yet evidenced. - Counts do not establish proof for outcomes, comparisons, or quantified claims. Downstream governance note: ARL review follows.',
      ],
      qualification: 'Element-level source traceability will be implemented as traceable mappings from each substantive statement to validated source evidence reference keys and specific evidence items once itemization exists. The executive brief will likely require outcome or comparative statements; those require traceable, item-level support that is not yet present. A decision-ready executive brief may require cross-functional inputs depending on decision scope; such stakeholders are not yet evidenced.',
      diagramIntent: '',
    })
    const visible = `${section.body}\n${section.qualification}`
    expect(section.body).toContain('- Searchable and accessible text is a stated delivery requirement.')
    expect(section.body).toContain('- Editable structure, where supported, is a stated delivery requirement.')
    expect(section.body).toContain('Executive takeaway: If final delivery is required, the missing file type and channel remain unresolved constraints.')
    expect(section.body).toContain('- Source counts alone do not support outcomes, comparisons, or quantified claims.')
    expect(section.qualification).toContain('- The stated element-level source-traceability requirement depends on itemized evidence references, which are not yet available.')
    expect(section.qualification).toContain('- If the brief includes outcome or comparative statements, traceable item-level support is not yet available.')
    expect(section.qualification).toContain('- If the decision scope includes cross-functional review, the relevant stakeholders are not yet established in the supplied information.')
    expect(visible).not.toMatch(/blocking dependency|will likely require|may require|will be implemented|retains searchable|retains editable|validated source evidence|available role record|available counts alone|QA run|unevidenced/i)
    expect(section.diagram).toEqual({ present: false, description: '', accessibleText: '' })
  })

  it('keeps normalization grammar-safe for current-state and stakeholder limitations', () => {
    const currentState = buildExpressionOnlyRevisionSection({
      sectionKey: 'current-state-assessment',
      heading: 'Current state',
      keyMessages: [
        'Known (accepted truth): - Current-state guidance is supplied. Decision-relevance implications (bounded by evidence): - No evidenced performance baseline, observed friction profile (frequency/scale/cost), or constraints are available to support quantified comparisons or prioritization. Downstream governance note: review follows.',
      ],
      qualification: 'No evidenced baseline metrics. No evidenced constraints.',
      diagramIntent: '',
    })
    const stakeholders = buildExpressionOnlyRevisionSection({
      sectionKey: 'stakeholder-register',
      heading: 'Stakeholders',
      keyMessages: [
        'Known (accepted truth): - Quinn Fixture QA is sponsor. Decision-relevance implications (bounded by evidence): - Approval criteria are not evidenced. Downstream governance note: review follows.',
      ],
      qualification: 'No additional stakeholders evidenced beyond Quinn and Riley.',
      diagramIntent: '',
    })
    expect(currentState.body).toContain(
      'Executive takeaway: The supplied information provides no performance baseline, observed friction profile across frequency, scale and cost, or constraints to support quantified comparisons or prioritization.',
    )
    expect(stakeholders.qualification).toContain(
      '- The supplied information identifies no additional stakeholders beyond Quinn and Riley.',
    )
    expect(`${currentState.body}\n${currentState.qualification}\n${stakeholders.qualification}`)
      .not.toMatch(/contains no .* are available|\. beyond/i)
  })

  it.each([
    ['unsupported RL failure', (fixture) => { fixture.failedRl.failure.failureCode = 'RENDERED_EXPRESSION_RL_PROVIDER_OUTPUT_INVALID' }],
    ['different prior candidate', (fixture) => { fixture.failedRl.predecessorStageExecutionId = 'outcome_quality_stage_other_candidate' }],
    ['different narrative plan', (fixture) => { fixture.priorCandidate.outputSnapshot.narrativePlanOutputFingerprint = '9'.repeat(64) }],
    ['incomplete RL findings', (fixture) => { fixture.findings.pop() }],
    ['unrelated GRR artifact', (fixture) => { fixture.artifact.executionId = 'grr_exec_unrelated' }],
    ['duplicate RL dimension', (fixture) => { fixture.findings[6].dimension = 'STATEMENTS' }],
    ['all-pass RL findings', (fixture) => {
      fixture.artifact.generatedOutput.overallStatus = 'PASS'
      fixture.findings.forEach((finding) => { finding.status = 'PASS'; finding.requiredChange = false })
    }],
  ])('rejects expression-only revision when %s breaks the recovery contract', (_label, mutate) => {
    const plan = makePlan()
    const narrativePlan = makeNarrativePlanSource(plan)
    const priorCandidate = makeShapedCandidateSource(plan)
    const failedRl = {
      stageExecutionId: 'outcome_quality_stage_rendered_expression_rl_failed',
      stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      attemptFingerprint: '8'.repeat(64),
      predecessorStageExecutionId: priorCandidate.stageExecutionId,
      predecessorAttemptFingerprint: priorCandidate.attemptFingerprint,
      failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE', retryable: false },
      executionIdentity: { grrExecutionId: 'grr_exec_qa', grrRuntimeArtifactId: 'grr_art_qa' },
    }
    const findings = [
      'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
    ].map((dimension) => ({ dimension, status: 'FAIL', finding: 'Requires revision.', requiredChange: true }))
    const artifact = makeFailedRlArtifact(failedRl, findings)
    const fixture = { artifact, failedRl, findings, priorCandidate }
    mutate(fixture)
    expect(() => buildOutcomeShapedCandidateRevisionOutput({
      failedRlStage: fixture.failedRl,
      narrativePlanStage: narrativePlan,
      plan,
      priorCandidateStage: fixture.priorCandidate,
      rlArtifact: fixture.artifact,
      title: 'Parlon Executive Brief',
    })).toThrow('Expression-only remediation lineage is invalid.')
  })

  it('persists exactly one expression-only Stage 5 successor after a required-change RL failure', async () => {
    const plan = makePlan()
    const narrativePlan = makeNarrativePlanSource(plan)
    narrativePlan.outputSnapshot.sections[0].keyMessages.push('Parlon can prioritise the evidence-backed operating choice.')
    narrativePlan.outputFingerprint = hashOutcomeQualityStageValue(narrativePlan.outputSnapshot)
    const latestStage5 = {
      _id: new mongoose.Types.ObjectId(),
      stageExecutionId: 'outcome_quality_stage_shaped_candidate_attempt_1',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:04:01.000Z'),
      ...buildShapedCandidate({ plan, sourceStageExecution: narrativePlan }),
    }
    const failedRlCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
      expectedLatestAttemptNumber: 0,
      predecessorStageExecutionId: latestStage5.stageExecutionId,
      predecessorAttemptFingerprint: latestStage5.attemptFingerprint,
      sourceStageExecution: latestStage5,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE', safeReason: 'Revision required.', retryable: false },
      executionIdentity: executionIdentity({
        providerConfigurationVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
        runtimeVersion: 'rendered-expression-rl.v1',
      }),
      startedAt: '2026-08-03T09:05:00.000Z',
      completedAt: '2026-08-03T09:05:00.500Z',
    })
    const failedRl = {
      _id: new mongoose.Types.ObjectId(),
      stageExecutionId: 'outcome_quality_stage_rendered_expression_rl_failed',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:05:01.000Z'),
      ...failedRlCandidate,
    }
    const findings = [
      'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
    ].map((dimension) => ({ dimension, status: 'FAIL', finding: 'Requires revision.', requiredChange: true }))
    const output = buildOutcomeShapedCandidateRevisionOutput({
      failedRlStage: failedRl,
      narrativePlanStage: narrativePlan,
      plan,
      priorCandidateStage: latestStage5,
      rlArtifact: makeFailedRlArtifact(failedRl, findings),
      title: 'Parlon Executive Brief',
    })
    const candidateArgs = {
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latestStage5.stageExecutionId,
      predecessorAttemptFingerprint: latestStage5.attemptFingerprint,
      sourceStageExecution: narrativePlan,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output,
      executionIdentity: internalExecutionIdentity(),
      startedAt: '2026-08-03T09:06:00.000Z',
      completedAt: '2026-08-03T09:06:00.100Z',
    }
    const candidate = buildOutcomeQualityStageExecutionCandidate(candidateArgs)
    const fixture = makePersistenceDeps({
      latest: latestStage5,
      plan,
      remediationStage: failedRl,
      sourceStage: narrativePlan,
    })
    const result = await createOutcomeQualityStageExecution({
      planRecordId: ids.plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latestStage5.stageExecutionId,
      predecessorAttemptFingerprint: latestStage5.attemptFingerprint,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output,
      executionIdentity: internalExecutionIdentity(),
      startedAt: '2026-08-03T09:06:00.000Z',
      completedAt: '2026-08-03T09:06:00.100Z',
      expectedAttemptFingerprint: candidate.attemptFingerprint,
      actorUserId: ids.actor,
      remediationSourceStageExecutionId: failedRl.stageExecutionId,
      deps: fixture.deps,
    })
    expect(result.idempotent).toBe(false)
    expect(result.execution).toMatchObject({
      attemptNumber: 2,
      predecessorStageExecutionId: latestStage5.stageExecutionId,
      outputSnapshot: {
        revisionScope: 'EXPRESSION_ONLY',
        remediationSourceStageExecutionId: failedRl.stageExecutionId,
      },
    })
    expect(fixture.saved).toHaveLength(1)
    expect(fixture.committedAudits).toHaveLength(1)
  })

  it('persists a fresh Stage 6 review only against the exact expression-only successor', async () => {
    const plan = makePlan()
    const narrativePlan = makeNarrativePlanSource(plan)
    narrativePlan.outputSnapshot.sections[0].keyMessages.push('Parlon can prioritise the evidence-backed operating choice.')
    narrativePlan.outputFingerprint = hashOutcomeQualityStageValue(narrativePlan.outputSnapshot)
    const originalStage5 = {
      stageExecutionId: 'outcome_quality_stage_shaped_candidate_attempt_1',
      ...buildShapedCandidate({ plan, sourceStageExecution: narrativePlan }),
    }
    const failedRlCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
      expectedLatestAttemptNumber: 0,
      predecessorStageExecutionId: originalStage5.stageExecutionId,
      predecessorAttemptFingerprint: originalStage5.attemptFingerprint,
      sourceStageExecution: originalStage5,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE', safeReason: 'Revision required.', retryable: false },
      executionIdentity: executionIdentity({
        providerConfigurationVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
        runtimeVersion: 'rendered-expression-rl.v1',
      }),
      startedAt: '2026-08-03T09:05:00.000Z',
      completedAt: '2026-08-03T09:05:00.500Z',
    })
    const failedRl = { stageExecutionId: 'outcome_quality_stage_rendered_expression_rl_failed', ...failedRlCandidate }
    const findings = [
      'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
    ].map((dimension) => ({ dimension, status: 'FAIL', finding: 'Requires revision.', requiredChange: true }))
    const revisionOutput = buildOutcomeShapedCandidateRevisionOutput({
      failedRlStage: failedRl,
      narrativePlanStage: narrativePlan,
      plan,
      priorCandidateStage: originalStage5,
      rlArtifact: makeFailedRlArtifact(failedRl, findings),
      title: 'Parlon Executive Brief',
    })
    const revisedStage5 = {
      stageExecutionId: 'outcome_quality_stage_shaped_candidate_attempt_2',
      ...buildOutcomeQualityStageExecutionCandidate({
        plan,
        runtimeInstanceId: ids.runtime,
        expectedPlanFingerprint: plan.planFingerprint,
        stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
        expectedLatestAttemptNumber: 1,
        predecessorStageExecutionId: originalStage5.stageExecutionId,
        predecessorAttemptFingerprint: originalStage5.attemptFingerprint,
        sourceStageExecution: narrativePlan,
        status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
        output: revisionOutput,
        executionIdentity: internalExecutionIdentity(),
        startedAt: '2026-08-03T09:06:00.000Z',
        completedAt: '2026-08-03T09:06:00.100Z',
      }),
    }
    const rlOutput = buildRenderedExpressionRl({ sourceStageExecution: revisedStage5 }).outputSnapshot
    const rlArgs = {
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: failedRl.stageExecutionId,
      predecessorAttemptFingerprint: failedRl.attemptFingerprint,
      sourceStageExecution: revisedStage5,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output: rlOutput,
      executionIdentity: executionIdentity({
        providerConfigurationVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
        runtimeVersion: 'rendered-expression-rl.v1',
      }),
      startedAt: '2026-08-03T09:07:00.000Z',
      completedAt: '2026-08-03T09:07:00.500Z',
    }
    const candidate = buildOutcomeQualityStageExecutionCandidate(rlArgs)
    const fixture = makePersistenceDeps({ latest: failedRl, plan, sourceStage: revisedStage5 })
    const result = await createOutcomeQualityStageExecution({
      planRecordId: ids.plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: failedRl.stageExecutionId,
      predecessorAttemptFingerprint: failedRl.attemptFingerprint,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output: rlOutput,
      executionIdentity: rlArgs.executionIdentity,
      startedAt: rlArgs.startedAt,
      completedAt: rlArgs.completedAt,
      expectedAttemptFingerprint: candidate.attemptFingerprint,
      actorUserId: ids.actor,
      deps: fixture.deps,
    })
    expect(result.idempotent).toBe(false)
    expect(result.execution).toMatchObject({
      attemptNumber: 2,
      predecessorStageExecutionId: failedRl.stageExecutionId,
      inputSnapshot: { sourceStage: { stageExecutionId: revisedStage5.stageExecutionId } },
    })
  })

  it('builds the next expression-only revision from a later RL attempt source snapshot', () => {
    const plan = makePlan()
    const narrativePlan = makeNarrativePlanSource(plan)
    narrativePlan.outputSnapshot.sections[0].keyMessages = [
      'Known (accepted truth): - Customer: Parlon. Decision-relevance implications (bounded by evidence): - Buying context is not evidenced. Downstream governance note: ARL approval is required.',
    ]
    narrativePlan.outputFingerprint = hashOutcomeQualityStageValue(narrativePlan.outputSnapshot)
    const priorCandidate = {
      stageExecutionId: 'outcome_quality_stage_shaped_candidate_attempt_2',
      ...buildShapedCandidate({ plan, sourceStageExecution: narrativePlan }),
      attemptNumber: 2,
    }
    const failedRl = {
      stageExecutionId: 'outcome_quality_stage_rendered_expression_rl_attempt_2',
      stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      attemptNumber: 2,
      attemptFingerprint: '8'.repeat(64),
      predecessorStageExecutionId: 'outcome_quality_stage_rendered_expression_rl_attempt_1',
      predecessorAttemptFingerprint: '7'.repeat(64),
      inputSnapshot: {
        sourceStage: {
          stageExecutionId: priorCandidate.stageExecutionId,
          attemptFingerprint: priorCandidate.attemptFingerprint,
          outputFingerprint: priorCandidate.outputFingerprint,
        },
      },
      failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE', retryable: false },
      executionIdentity: { grrExecutionId: 'grr_exec_qa', grrRuntimeArtifactId: 'grr_art_qa' },
    }
    const findings = [
      'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
    ].map((dimension) => ({
      dimension,
      status: dimension === 'DIAGRAMS' ? 'PASS' : 'FAIL',
      finding: 'Expression revision required.',
      requiredChange: dimension !== 'DIAGRAMS',
    }))
    const output = buildOutcomeShapedCandidateRevisionOutput({
      failedRlStage: failedRl,
      narrativePlanStage: narrativePlan,
      plan,
      priorCandidateStage: priorCandidate,
      rlArtifact: makeFailedRlArtifact(failedRl, findings),
      title: 'Parlon Executive Brief',
    })
    expect(output).toMatchObject({
      candidateVersion: 2,
      revisionOfStageExecutionId: priorCandidate.stageExecutionId,
      remediationSourceStageExecutionId: failedRl.stageExecutionId,
    })
  })

  it('persists Stage 5 attempt 3 from the exact later RL source snapshot', async () => {
    const plan = makePlan()
    const narrativePlan = makeNarrativePlanSource(plan)
    narrativePlan.outputSnapshot.sections[0].keyMessages = [
      'Known (accepted truth): - Customer: Parlon. Decision-relevance implications (bounded by evidence): - Buying context is not evidenced. Downstream governance note: ARL approval is required.',
    ]
    narrativePlan.outputFingerprint = hashOutcomeQualityStageValue(narrativePlan.outputSnapshot)
    const stage5Attempt1 = {
      stageExecutionId: 'outcome_quality_stage_shaped_candidate_attempt_1',
      ...buildShapedCandidate({ plan, sourceStageExecution: narrativePlan }),
    }
    const failureIdentity = executionIdentity({
      providerConfigurationVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
      runtimeVersion: 'rendered-expression-rl.v1',
    })
    const failedRl1 = {
      stageExecutionId: 'outcome_quality_stage_rendered_expression_rl_attempt_1',
      ...buildOutcomeQualityStageExecutionCandidate({
        plan,
        runtimeInstanceId: ids.runtime,
        expectedPlanFingerprint: plan.planFingerprint,
        stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
        expectedLatestAttemptNumber: 0,
        predecessorStageExecutionId: stage5Attempt1.stageExecutionId,
        predecessorAttemptFingerprint: stage5Attempt1.attemptFingerprint,
        sourceStageExecution: stage5Attempt1,
        status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
        failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE', safeReason: 'Revision required.', retryable: false },
        executionIdentity: failureIdentity,
        startedAt: '2026-08-03T09:05:00.000Z',
        completedAt: '2026-08-03T09:05:00.500Z',
      }),
    }
    const findings = [
      'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
    ].map((dimension) => ({
      dimension,
      status: dimension === 'DIAGRAMS' ? 'PASS' : 'FAIL',
      finding: 'Expression revision required.',
      requiredChange: dimension !== 'DIAGRAMS',
    }))
    const output2 = buildOutcomeShapedCandidateRevisionOutput({
      failedRlStage: failedRl1,
      narrativePlanStage: narrativePlan,
      plan,
      priorCandidateStage: stage5Attempt1,
      rlArtifact: makeFailedRlArtifact(failedRl1, findings),
      title: 'Parlon Executive Brief',
    })
    const stage5Attempt2 = {
      stageExecutionId: 'outcome_quality_stage_shaped_candidate_attempt_2',
      ...buildOutcomeQualityStageExecutionCandidate({
        plan,
        runtimeInstanceId: ids.runtime,
        expectedPlanFingerprint: plan.planFingerprint,
        stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
        expectedLatestAttemptNumber: 1,
        predecessorStageExecutionId: stage5Attempt1.stageExecutionId,
        predecessorAttemptFingerprint: stage5Attempt1.attemptFingerprint,
        sourceStageExecution: narrativePlan,
        status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
        output: output2,
        executionIdentity: internalExecutionIdentity(),
        startedAt: '2026-08-03T09:06:00.000Z',
        completedAt: '2026-08-03T09:06:00.100Z',
      }),
    }
    const failedRl2 = {
      stageExecutionId: 'outcome_quality_stage_rendered_expression_rl_attempt_2',
      ...buildOutcomeQualityStageExecutionCandidate({
        plan,
        runtimeInstanceId: ids.runtime,
        expectedPlanFingerprint: plan.planFingerprint,
        stageKey: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
        expectedLatestAttemptNumber: 1,
        predecessorStageExecutionId: failedRl1.stageExecutionId,
        predecessorAttemptFingerprint: failedRl1.attemptFingerprint,
        sourceStageExecution: stage5Attempt2,
        status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
        failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE', safeReason: 'Revision required.', retryable: false },
        executionIdentity: failureIdentity,
        startedAt: '2026-08-03T09:07:00.000Z',
        completedAt: '2026-08-03T09:07:00.500Z',
      }),
    }
    const output3 = buildOutcomeShapedCandidateRevisionOutput({
      failedRlStage: failedRl2,
      narrativePlanStage: narrativePlan,
      plan,
      priorCandidateStage: stage5Attempt2,
      rlArtifact: makeFailedRlArtifact(failedRl2, findings),
      title: 'Parlon Executive Brief',
    })
    const candidateArgs = {
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
      expectedLatestAttemptNumber: 2,
      predecessorStageExecutionId: stage5Attempt2.stageExecutionId,
      predecessorAttemptFingerprint: stage5Attempt2.attemptFingerprint,
      sourceStageExecution: narrativePlan,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output: output3,
      executionIdentity: internalExecutionIdentity(),
      startedAt: '2026-08-03T09:08:00.000Z',
      completedAt: '2026-08-03T09:08:00.100Z',
    }
    const candidate = buildOutcomeQualityStageExecutionCandidate(candidateArgs)
    const fixture = makePersistenceDeps({ latest: stage5Attempt2, plan, remediationStage: failedRl2, sourceStage: narrativePlan })
    const result = await createOutcomeQualityStageExecution({
      planRecordId: ids.plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
      expectedLatestAttemptNumber: 2,
      predecessorStageExecutionId: stage5Attempt2.stageExecutionId,
      predecessorAttemptFingerprint: stage5Attempt2.attemptFingerprint,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output: output3,
      executionIdentity: internalExecutionIdentity(),
      startedAt: candidateArgs.startedAt,
      completedAt: candidateArgs.completedAt,
      expectedAttemptFingerprint: candidate.attemptFingerprint,
      actorUserId: ids.actor,
      remediationSourceStageExecutionId: failedRl2.stageExecutionId,
      deps: fixture.deps,
    })
    expect(result.execution).toMatchObject({
      attemptNumber: 3,
      predecessorStageExecutionId: stage5Attempt2.stageExecutionId,
      outputSnapshot: { candidateVersion: 3, remediationSourceStageExecutionId: failedRl2.stageExecutionId },
    })
  })

  it('binds rendered-expression RL to the exact candidate and all seven required dimensions', async () => {
    const rl = buildRenderedExpressionRl()
    expect(rl.stageOrder).toBe(6)
    expect(rl.outputSnapshot.findings).toHaveLength(7)
    expect(new Set(rl.outputSnapshot.findings.map((finding) => finding.dimension))).toEqual(new Set([
      'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
    ]))
    await expect(new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_rendered_expression_rl_model',
      ...rl,
      createdBy: ids.actor,
    }).validate()).resolves.toBeUndefined()

    const source = makeShapedCandidateSource()
    const missingDimension = clone(buildRenderedExpressionRl({ sourceStageExecution: source }).outputSnapshot)
    missingDimension.findings.pop()
    expect(() => buildRenderedExpressionRl({ sourceStageExecution: source, output: missingDimension }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    expect(() => buildRenderedExpressionRl({
      sourceStageExecution: source,
      predecessorStageExecutionId: 'wrong-candidate',
    })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.PREDECESSOR_INVALID }))
    expect(() => buildRenderedExpressionRl({
      sourceStageExecution: source,
      executionIdentity: internalExecutionIdentity(),
    })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
  })

  it('rejects fingerprint-consistent direct-model tampering in new stage nested shapes', async () => {
    const working = buildWorkingDraft()
    const workingRecord = {
      stageExecutionId: 'outcome_quality_stage_working_nested_tamper',
      ...clone(working),
      createdBy: ids.actor,
    }
    workingRecord.outputSnapshot.sections[0].claims[0].unknown = 'tampered'
    workingRecord.outputFingerprint = hashOutcomeQualityStageValue(workingRecord.outputSnapshot)
    refreshStageRecordFingerprints(workingRecord)
    await expect(new OutcomeQualityStageExecution(workingRecord).validate()).rejects.toBeDefined()

    const arl = buildArlReview()
    const arlRecord = {
      stageExecutionId: 'outcome_quality_stage_arl_fingerprint_tamper',
      ...clone(arl),
      createdBy: ids.actor,
    }
    arlRecord.outputSnapshot.approvedMeaning.decisionLogicFingerprint = '9'.repeat(64)
    arlRecord.outputFingerprint = hashOutcomeQualityStageValue(arlRecord.outputSnapshot)
    refreshStageRecordFingerprints(arlRecord)
    await expect(new OutcomeQualityStageExecution(arlRecord).validate()).rejects.toBeDefined()

    const arlMeaningTamper = {
      stageExecutionId: 'outcome_quality_stage_arl_meaning_tamper',
      ...clone(arl),
      createdBy: ids.actor,
    }
    arlMeaningTamper.outputSnapshot.approvedMeaning.decisionLogic = []
    arlMeaningTamper.outputSnapshot.approvedMeaning.decisionLogicFingerprint = hashOutcomeQualityStageValue([])
    arlMeaningTamper.outputSnapshot.approvedMeaning.meaningFingerprint = hashOutcomeQualityStageValue({
      workingDraftStageExecutionId: arlMeaningTamper.outputSnapshot.approvedMeaning.workingDraftStageExecutionId,
      workingDraftOutputFingerprint: arlMeaningTamper.outputSnapshot.approvedMeaning.workingDraftOutputFingerprint,
      decisionLogicFingerprint: arlMeaningTamper.outputSnapshot.approvedMeaning.decisionLogicFingerprint,
    })
    arlMeaningTamper.outputFingerprint = hashOutcomeQualityStageValue(arlMeaningTamper.outputSnapshot)
    refreshStageRecordFingerprints(arlMeaningTamper)
    await expect(new OutcomeQualityStageExecution(arlMeaningTamper).validate()).rejects.toBeDefined()
  })

  it('retains divergent storage lineage while allowing only semantic truth references', () => {
    const runtime = makeRuntime()
    runtime.framework_state.sections.section_1_customer_context = runtime.framework_state.sections.customer_context
    delete runtime.framework_state.sections.customer_context
    runtime.framework_state.sections.section_1_customer_context.accepted.runtimePath = 'framework_state.sections.section_1_customer_context'
    const plan = makePlan({}, runtime)
    const candidate = buildSuccess({ plan })
    expect(candidate.inputSnapshot.lockedTruth.acceptedSections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sectionKey: 'customer_context',
        stateSectionKey: 'section_1_customer_context',
      }),
    ]))
    const output = makeOutput(plan)
    output.sections[0].truthReferences = output.sections[0].truthReferences
      .map((reference) => reference === 'customer_context' ? 'section_1_customer_context' : reference)
    expect(() => buildSuccess({ plan, output })).toThrow(expect.objectContaining({
      code: OUTCOME_QUALITY_STAGE_ERROR_CODES.STAGE_BINDING_INVALID,
    }))
  })

  it('changes input, output and attempt fingerprints when governed semantic identity lineage changes', () => {
    const baseline = buildSuccess()
    const runtime = makeRuntime()
    runtime.framework_state.sections.customer_context.accepted.sectionKey = 'customer_context_v2'
    const changedPlan = makePlan({}, runtime)
    const changed = buildSuccess({ plan: changedPlan })
    expect(changed.inputFingerprint).not.toBe(baseline.inputFingerprint)
    expect(changed.outputFingerprint).not.toBe(baseline.outputFingerprint)
    expect(changed.attemptFingerprint).not.toBe(baseline.attemptFingerprint)
  })

  it('preserves exact marker-free stage input and fingerprint across a legacy retry', () => {
    const plan = makeLegacyPlan()
    const failed = buildFailure(OUTCOME_QUALITY_STAGE_STATUSES.FAILED, { plan })
    const retry = buildSuccess({
      plan,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: 'outcome_quality_stage_legacy_failed',
      predecessorAttemptFingerprint: failed.attemptFingerprint,
    })
    expect(failed.inputSnapshot.lockedTruth).not.toHaveProperty('acceptedTruthIdentityContractVersion')
    expect(failed.inputSnapshot.lockedTruth.acceptedSections[0]).not.toHaveProperty('stateSectionKey')
    expect(retry.inputSnapshot).toEqual(failed.inputSnapshot)
    expect(retry.inputFingerprint).toBe(failed.inputFingerprint)
  })

  it('accepts the minimum valid successful candidate at the direct model boundary', async () => {
    const candidate = buildSuccess()
    const document = new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_model_valid',
      ...candidate,
      createdBy: ids.actor,
    })
    await expect(document.validate()).resolves.toBeUndefined()
  })

  it('accepts an exact marker-free legacy stage shape at the direct model boundary', async () => {
    const candidate = buildSuccess({ plan: makeLegacyPlan() })
    const document = new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_model_legacy_valid',
      ...candidate,
      createdBy: ids.actor,
    })
    await expect(document.validate()).resolves.toBeUndefined()
  })

  it.each([
    ['unknown marker', (record) => { record.inputSnapshot.lockedTruth.acceptedTruthIdentityContractVersion = 'unknown.v1' }],
    ['marked missing storage key', (record) => { delete record.inputSnapshot.lockedTruth.acceptedSections[0].stateSectionKey }],
    ['marked accepted leaf', (record) => { record.inputSnapshot.lockedTruth.acceptedSections[0].runtimePath += '.accepted' }],
    ['duplicate semantic identity', (record) => {
      record.inputSnapshot.lockedTruth.acceptedSections[1].sectionKey = record.inputSnapshot.lockedTruth.acceptedSections[0].sectionKey
    }],
    ['duplicate storage identity', (record) => {
      record.inputSnapshot.lockedTruth.acceptedSections[1].stateSectionKey = record.inputSnapshot.lockedTruth.acceptedSections[0].stateSectionKey
      record.inputSnapshot.lockedTruth.acceptedSections[1].runtimePath = record.inputSnapshot.lockedTruth.acceptedSections[0].runtimePath
    }],
    ['marked path/storage mismatch', (record) => {
      record.inputSnapshot.lockedTruth.acceptedSections[0].runtimePath = 'framework_state.sections.section_1_customer_context'
    }],
    ['legacy mixed storage key', (record) => {
      delete record.inputSnapshot.lockedTruth.acceptedTruthIdentityContractVersion
      record.inputSnapshot.lockedTruth.acceptedSections[0].stateSectionKey = 'customer_context'
    }],
  ])('rejects direct-model accepted truth identity contradiction: %s', async (_label, mutate) => {
    const candidate = buildSuccess()
    const record = { stageExecutionId: 'outcome_quality_stage_model_identity_invalid', ...candidate, createdBy: ids.actor }
    mutate(record)
    refreshStageRecordFingerprints(record)
    const document = new OutcomeQualityStageExecution(record)
    await expect(document.validate()).rejects.toBeDefined()
  })

  it.each([
    OUTCOME_QUALITY_STAGE_STATUSES.BLOCKED,
    OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
  ])('accepts a valid direct-model %s shape', async (status) => {
    const candidate = buildFailure(status)
    const document = new OutcomeQualityStageExecution({
      stageExecutionId: `outcome_quality_stage_model_${status.toLowerCase()}`,
      ...candidate,
      createdBy: ids.actor,
    })
    await expect(document.validate()).resolves.toBeUndefined()
  })

  it('rejects a non-boolean retryable flag at the direct model boundary', async () => {
    const candidate = buildFailure()
    candidate.failure.retryable = 'false'
    const document = new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_model_retry_type',
      ...candidate,
      createdBy: ids.actor,
    })
    await expect(document.validate()).rejects.toBeDefined()
  })

  it.each([
    ['success without output', (record) => { delete record.outputSnapshot; record.outputFingerprint = '' }],
    ['success with failure', (record) => { record.failure = { failureCode: 'INVALID', safeReason: 'Invalid.', retryable: false } }],
    ['failed with output', (record) => { record.status = OUTCOME_QUALITY_STAGE_STATUSES.FAILED; record.failure = { failureCode: 'FAILED', safeReason: 'Failed.', retryable: false } }],
    ['input fingerprint mismatch', (record) => { record.inputFingerprint = '9'.repeat(64) }],
    ['output fingerprint mismatch', (record) => { record.outputFingerprint = '8'.repeat(64) }],
    ['attempt fingerprint mismatch', (record) => { record.attemptFingerprint = '7'.repeat(64) }],
    ['count mismatch', (record) => { record.contributingActivationCount += 1 }],
    ['duration mismatch', (record) => { record.durationMs += 1 }],
    ['string attempt number', (record) => { record.attemptNumber = '1' }],
    ['string stage order', (record) => { record.stageOrder = '1' }],
    ['string output order', (record) => { record.outputSnapshot.sections[0].order = '1' }],
    ['later-stage claim', (record) => { record.outputSnapshot.sections[0].analysis = 'Meaning is approved.' }],
  ])('rejects direct-model contradiction: %s', async (_label, mutate) => {
    const candidate = buildSuccess()
    const record = { stageExecutionId: 'outcome_quality_stage_model_invalid', ...candidate, createdBy: ids.actor }
    mutate(record)
    const document = new OutcomeQualityStageExecution(record)
    await expect(document.validate()).rejects.toBeDefined()
  })

  it.each([
    ['approved-meaning disposition', 'The approved meaning is complete.'],
    ['current meaning approval', 'Meaning is approved.'],
    ['multiline meaning approval', 'Meaning\nis approved.'],
    ['meaning approval record', 'This records approval of the meaning.'],
    ['final candidate disposition', 'The final candidate is ready.'],
    ['final asset publication', 'The final asset has been published.'],
    ['later quality stage', 'Working Draft is complete.'],
    ['out-of-scope delivery', 'The presentation is ready.'],
  ])('rejects a fingerprint-consistent direct-model %s claim', async (_label, claim) => {
    const candidate = buildSuccess()
    candidate.outputSnapshot.sections[0].analysis = claim
    candidate.outputFingerprint = hashOutcomeQualityStageValue(candidate.outputSnapshot)
    refreshStageRecordFingerprints(candidate)
    const document = new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_model_prohibited_claim',
      ...candidate,
      createdBy: ids.actor,
    })
    await expect(document.validate()).rejects.toBeDefined()
  })

  it.each([
    ['input', (record) => { record.inputSnapshot.prompt = 'unsafe' }],
    ['output', (record) => { record.outputSnapshot.sections[0].providerContext = 'unsafe' }],
    ['failure', (record) => { record.status = OUTCOME_QUALITY_STAGE_STATUSES.FAILED; delete record.outputSnapshot; record.outputFingerprint = ''; record.failure = { failureCode: 'FAILED', safeReason: 'Failed.', retryable: false, unexpected: true } }],
    ['execution identity', (record) => { record.executionIdentity.unexpected = true }],
  ])('rejects direct-model unknown nested key in %s', async (_label, mutate) => {
    const candidate = buildSuccess()
    const record = { stageExecutionId: 'outcome_quality_stage_model_unknown', ...candidate, createdBy: ids.actor }
    mutate(record)
    const document = new OutcomeQualityStageExecution(record)
    await expect(document.validate()).rejects.toBeDefined()
  })

  it('keeps undefined/omitted KCP properties persistence-equivalent', () => {
    const plan = makePlan()
    plan.payload.resolution.dependencyGraph.versionConstraint = undefined
    expect(() => assertOutcomeKnowledgeCompositionPlanIntegrity(plan)).not.toThrow()
    delete plan.payload.resolution.dependencyGraph.versionConstraint
    expect(() => assertOutcomeKnowledgeCompositionPlanIntegrity(plan)).not.toThrow()
  })

  it.each([
    ['unknown output key', (plan, output) => { output.unknown = true }],
    ['forbidden prompt field', (plan, output) => { output.sections[0].prompt = 'hidden' }],
    ['missing truth coverage', (plan, output) => { output.sections[0].truthReferences.pop() }],
    ['missing activation coverage', (plan, output) => { output.sections[0].contributingActivationIds.pop() }],
    ['duplicate truth reference', (plan, output) => { output.sections[0].truthReferences.push(output.sections[0].truthReferences[0]) }],
    ['additional truth reference', (plan, output) => { output.sections[0].truthReferences.push('not-accepted') }],
    ['duplicate activation reference', (plan, output) => { output.sections[0].contributingActivationIds.push(output.sections[0].contributingActivationIds[0]) }],
    ['additional activation reference', (plan, output) => { output.sections[0].contributingActivationIds.push('not-assigned') }],
    ['concealed visible gap', (plan, output) => { output.visibleGaps.pop() }],
    ['duplicate section key', (plan, output) => { output.sections.push({ ...clone(output.sections[0]), order: 2 }) }],
    ['later-stage claim', (plan, output) => { output.sections[0].analysis = 'The approved meaning is complete.' }],
    ['overlong title', (plan, output) => { output.title = 'x'.repeat(256) }],
    ['overlong analysis', (plan, output) => { output.sections[0].analysis = 'x'.repeat(12001) }],
    ['overlong array', (plan, output) => { output.sections[0].recommendations = Array(21).fill('bounded') }],
  ])('rejects %s', (_label, mutate) => {
    const plan = makePlan()
    const output = makeOutput(plan)
    mutate(plan, output)
    expect(() => buildSuccess({ plan, output })).toThrow(expect.objectContaining({
      code: expect.stringMatching(/^OUTCOME_QUALITY_STAGE_/),
    }))
  })

  it.each([
    'Meaning is approved.',
    'This records approval of the meaning.',
    'The final disposition is complete.',
    'The Working Draft has been completed.',
    'The Outcome Narrative Plan is ready.',
    'Output shaping was completed.',
    'Rendered-expression review is approved.',
    'Publication has been completed.',
    'The presentation is ready.',
    'The infographic was completed.',
    'The final asset has been published.',
  ])('rejects later-stage disposition wording: %s', (claim) => {
    const plan = makePlan()
    const output = makeOutput(plan)
    output.sections[0].analysis = claim
    expect(() => buildSuccess({ plan, output })).toThrow(expect.objectContaining({
      code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID,
    }))
  })

  it.each([
    ['pending approval', 'Meaning still requires ARL approval.'],
    ['explicit negation', 'This framework is not approved meaning.'],
    ['governed sequencing', 'Output shaping occurs only after ARL-approved meaning.'],
    ['accepted source', 'The approved source policy remains bounded evidence.'],
    ['historical source approval', 'The board approved the source policy in 2024.'],
  ])('permits %s language at the service and direct-model boundaries', async (_label, analysis) => {
    const plan = makePlan()
    const output = makeOutput(plan)
    output.sections[0].analysis = analysis
    const candidate = buildSuccess({ plan, output })
    const document = new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_model_allowed_claim_context',
      ...candidate,
      createdBy: ids.actor,
    })
    await expect(document.validate()).resolves.toBeUndefined()
  })

  it('accepts exact text/array boundaries and rejects boundary overflow', () => {
    const plan = makePlan()
    const output = makeOutput(plan)
    output.title = 'x'.repeat(255)
    output.sections[0].analysis = 'x'.repeat(12000)
    output.sections[0].recommendations = Array(20).fill('x'.repeat(2000))
    expect(() => buildSuccess({ plan, output })).not.toThrow()
    output.sections[0].recommendations[19] = 'x'.repeat(2001)
    expect(() => buildSuccess({ plan, output })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
  })

  it.each([
    ['output title', 255, (output, value) => { output.title = value }],
    ['section key', 140, (output, value) => { output.sections[0].sectionKey = `a${value.slice(1, -1)}a` }],
    ['section title', 255, (output, value) => { output.sections[0].title = value }],
    ['section analysis', 12000, (output, value) => { output.sections[0].analysis = value }],
    ['section qualification', 2000, (output, value) => { output.sections[0].qualification = value }],
    ['decision summary', 4000, (output, value) => { output.decisionUsefulness.summary = value }],
    ['recommended next step', 2000, (output, value) => { output.decisionUsefulness.recommendedNextStep = value }],
  ])('enforces boundary minus one, boundary and overflow for %s', (_label, max, mutate) => {
    for (const length of [max - 1, max]) {
      const plan = makePlan()
      const output = makeOutput(plan)
      mutate(output, 'x'.repeat(length))
      expect(() => buildSuccess({ plan, output })).not.toThrow()
    }
    const plan = makePlan()
    const output = makeOutput(plan)
    mutate(output, 'x'.repeat(max + 1))
    expect(() => buildSuccess({ plan, output })).toThrow(expect.objectContaining({
      code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID,
    }))
  })

  it.each([
    ['implications', (output, value) => { output.sections[0].implications = value }],
    ['recommendations', (output, value) => { output.sections[0].recommendations = value }],
    ['section assumptions', (output, value) => { output.sections[0].assumptions = value }],
    ['section gaps', (output, value) => { output.sections[0].gaps = value }],
    ['decision priorities', (output, value) => { output.decisionUsefulness.priorities = value }],
    ['material risks', (output, value) => { output.decisionUsefulness.materialRisks = value }],
    ['output assumptions', (output, value) => { output.assumptions = value }],
  ])('enforces item and array boundaries for %s', (_label, mutate) => {
    for (const count of [19, 20]) {
      const plan = makePlan()
      const output = makeOutput(plan)
      mutate(output, Array(count).fill('x'.repeat(2000)))
      expect(() => buildSuccess({ plan, output })).not.toThrow()
    }
    const overCountPlan = makePlan()
    const overCountOutput = makeOutput(overCountPlan)
    mutate(overCountOutput, Array(21).fill('x'))
    expect(() => buildSuccess({ plan: overCountPlan, output: overCountOutput })).toThrow(expect.objectContaining({
      code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID,
    }))
    const overItemPlan = makePlan()
    const overItemOutput = makeOutput(overItemPlan)
    mutate(overItemOutput, ['x'.repeat(2001)])
    expect(() => buildSuccess({ plan: overItemPlan, output: overItemOutput })).toThrow(expect.objectContaining({
      code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID,
    }))
  })

  it('enforces visible-gap item and array boundaries from the KCP', () => {
    for (const length of [1999, 2000]) {
      const plan = makePlan({ unresolvedGaps: ['x'.repeat(length)] })
      expect(() => buildSuccess({ plan, output: makeOutput(plan) })).not.toThrow()
    }
    const overItemPlan = makePlan({ unresolvedGaps: ['x'.repeat(2001)] })
    expect(() => buildSuccess({ plan: overItemPlan, output: makeOutput(overItemPlan) }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    const overCountPlan = makePlan({ unresolvedGaps: Array.from({ length: 51 }, (_, index) => `gap-${index}`) })
    expect(() => buildSuccess({ plan: overCountPlan, output: makeOutput(overCountPlan) }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
  })

  it.each([
    ['execution mode', 80, (identity, value) => { identity.executionMode = value }],
    ['provider key', 140, (identity, value) => { identity.providerKey = value }],
    ['model', 160, (identity, value) => { identity.model = value }],
    ['GRR execution id', 180, (identity, value) => { identity.grrExecutionId = value }],
    ['GRR artefact id', 180, (identity, value) => { identity.grrRuntimeArtifactId = value }],
    ['runtime version', 80, (identity, value) => { identity.runtimeVersion = value }],
  ])('enforces execution-identity boundary minus one, boundary and overflow for %s', (_label, max, mutate) => {
    for (const length of [max - 1, max]) {
      const identity = executionIdentity()
      mutate(identity, 'x'.repeat(length))
      expect(() => buildSuccess({ executionIdentity: identity })).not.toThrow()
    }
    const identity = executionIdentity()
    mutate(identity, 'x'.repeat(max + 1))
    expect(() => buildSuccess({ executionIdentity: identity })).toThrow(expect.objectContaining({
      code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID,
    }))
  })

  it('accepts only recognized provider configuration versions', () => {
    expect(OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION)
      .toBe(OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS)
    Object.values(OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS).forEach((version) => {
      expect(() => buildSuccess({
        executionIdentity: executionIdentity({ providerConfigurationVersion: version }),
      })).not.toThrow()
    })
    expect(() => buildSuccess({
      executionIdentity: executionIdentity({ providerConfigurationVersion: 'OUTCOME_FRAMEWORK_GUIDANCE_UNKNOWN' }),
    })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
  })

  it('accepts provider configuration identity only for its owning quality stage', async () => {
    expect(OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION)
      .toBe(OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V1)
    const workingIdentity = executionIdentity({
      providerConfigurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
    })
    const working = buildWorkingDraft({ executionIdentity: workingIdentity })
    await expect(new OutcomeQualityStageExecution({
      stageExecutionId: 'outcome_quality_stage_working_provider_identity',
      ...working,
      createdBy: ids.actor,
    }).validate()).resolves.toBeUndefined()
    expect(() => buildSuccess({ executionIdentity: workingIdentity }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    expect(() => buildWorkingDraft({ executionIdentity: executionIdentity() }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    expect(() => buildWorkingDraft({ executionIdentity: internalExecutionIdentity() }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
  })

  it('includes provider configuration identity in attempt fingerprints and serialization', () => {
    const v1 = buildSuccess({
      executionIdentity: executionIdentity({
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V1,
      }),
    })
    const active = buildSuccess()
    expect(v1.attemptFingerprint).not.toBe(active.attemptFingerprint)
    expect(serializeOutcomeQualityStageExecution({
      _id: ids.stage,
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:00:02.000Z'),
      stageExecutionId: 'outcome_quality_stage_serialized',
      ...active,
    }).executionIdentity.providerConfigurationVersion)
      .toBe(OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION)
  })

  it.each([
    ['failure code', 140, (failure, value) => { failure.failureCode = value }],
    ['safe reason', 500, (failure, value) => { failure.safeReason = value }],
  ])('enforces failure boundary minus one, boundary and overflow for %s', (_label, max, mutate) => {
    for (const length of [max - 1, max]) {
      const failure = { failureCode: 'FAILED', safeReason: 'Failed.', retryable: false }
      mutate(failure, 'x'.repeat(length))
      expect(() => buildFailure(OUTCOME_QUALITY_STAGE_STATUSES.FAILED, { failure })).not.toThrow()
    }
    const failure = { failureCode: 'FAILED', safeReason: 'Failed.', retryable: false }
    mutate(failure, 'x'.repeat(max + 1))
    expect(() => buildFailure(OUTCOME_QUALITY_STAGE_STATUSES.FAILED, { failure })).toThrow(expect.objectContaining({
      code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID,
    }))
  })

  it('accepts all optional output arrays at their zero boundary', () => {
    const plan = makePlan()
    const output = makeOutput(plan)
    output.sections[0].recommendations = []
    output.sections[0].assumptions = []
    output.sections[0].gaps = []
    output.decisionUsefulness.materialRisks = []
    output.assumptions = []
    expect(() => buildSuccess({ plan, output })).not.toThrow()
  })

  it.each([
    'executionMode',
    'providerKey',
    'providerConfigurationVersion',
    'model',
    'grrExecutionId',
    'grrRuntimeArtifactId',
    'runtimeVersion',
  ])
  ('rejects empty required successful execution identity field %s', (field) => {
    const identity = executionIdentity()
    identity[field] = ''
    expect(() => buildSuccess({ executionIdentity: identity })).toThrow(expect.objectContaining({
      code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID,
    }))
  })

  it.each(['failureCode', 'safeReason'])('rejects empty required failure field %s', (field) => {
    const failure = { failureCode: 'FAILED', safeReason: 'Failed.', retryable: false }
    failure[field] = ''
    expect(() => buildFailure(OUTCOME_QUALITY_STAGE_STATUSES.FAILED, { failure })).toThrow(expect.objectContaining({
      code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID,
    }))
  })

  it.each([
    ['empty required title', (output) => { output.title = '' }],
    ['empty required analysis', (output) => { output.sections[0].analysis = '' }],
    ['empty required implication list', (output) => { output.sections[0].implications = [] }],
    ['empty decision summary', (output) => { output.decisionUsefulness.summary = '' }],
    ['empty priority list', (output) => { output.decisionUsefulness.priorities = [] }],
    ['empty recommended next step', (output) => { output.decisionUsefulness.recommendedNextStep = '' }],
    ['overlong qualification', (output) => { output.sections[0].qualification = 'x'.repeat(2001) }],
    ['overlong assumption', (output) => { output.assumptions = ['x'.repeat(2001)] }],
    ['too many sections', (output) => { output.sections = Array.from({ length: 21 }, (_, index) => ({ ...clone(output.sections[0]), order: index + 1, sectionKey: `section-${index}` })) }],
    ['unknown decision key', (output) => { output.decisionUsefulness.unknown = 'x' }],
  ])('rejects field boundary violation: %s', (_label, mutate) => {
    const plan = makePlan()
    const output = makeOutput(plan)
    mutate(output)
    expect(() => buildSuccess({ plan, output })).toThrow(expect.objectContaining({
      code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID,
    }))
  })

  it('rejects non-finite, reversed and over-one-day timing', () => {
    expect(() => buildSuccess({ startedAt: 'not-a-date' })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    expect(() => buildSuccess({ completedAt: '2026-08-03T08:59:59.000Z' })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    expect(() => buildSuccess({ completedAt: '2026-08-04T09:00:00.001Z' })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
  })

  it('builds mutually exclusive blocked/failed attempts with no output fingerprint', () => {
    const plan = makePlan()
    const failed = buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      expectedLatestAttemptNumber: 0,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: { failureCode: 'PROVIDER_UNAVAILABLE', safeReason: 'The governed provider was unavailable.', retryable: true },
      executionIdentity: executionIdentity({ providerKey: '', model: '', grrExecutionId: '', grrRuntimeArtifactId: '' }),
      startedAt: '2026-08-03T09:00:00.000Z',
      completedAt: '2026-08-03T09:00:00.250Z',
    })
    expect(failed.outputFingerprint).toBe('')
    expect(failed).not.toHaveProperty('outputSnapshot')
    expect(failed.failure).toMatchObject({ retryable: true })
    expect(() => buildSuccess({ failure: { failureCode: 'X', safeReason: 'x', retryable: false } }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    expect(() => buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      status: OUTCOME_QUALITY_STAGE_STATUSES.BLOCKED,
      output: makeOutput(plan),
      failure: { failureCode: 'BLOCKED', safeReason: 'Blocked.', retryable: false },
      executionIdentity: executionIdentity({ providerKey: '', model: '', grrExecutionId: '', grrRuntimeArtifactId: '' }),
      startedAt: '2026-08-03T09:00:00.000Z',
      completedAt: '2026-08-03T09:00:00.250Z',
    })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
  })

  it('rejects unsafe execution/failure shapes and their bounds', () => {
    const plan = makePlan()
    expect(() => buildSuccess({ executionIdentity: { ...executionIdentity(), unexpected: true } }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    expect(() => buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: { failureCode: 'FAILED', safeReason: 'x'.repeat(501), retryable: true },
      executionIdentity: executionIdentity({ providerKey: '', model: '', grrExecutionId: '', grrRuntimeArtifactId: '' }),
      startedAt: '2026-08-03T09:00:00.000Z',
      completedAt: '2026-08-03T09:00:00.250Z',
    })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    expect(() => buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: { failureCode: 'FAILED', safeReason: 'Failed.', retryable: 'false' },
      executionIdentity: executionIdentity({ providerKey: '', model: '', grrExecutionId: '', grrRuntimeArtifactId: '' }),
      startedAt: '2026-08-03T09:00:00.000Z',
      completedAt: '2026-08-03T09:00:00.250Z',
    })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    expect(() => buildSuccess({ expectedLatestAttemptNumber: '0' }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
    const output = makeOutput(plan)
    output.sections[0].order = '1'
    expect(() => buildSuccess({ plan, output })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.INPUT_INVALID }))
  })

  it.each([
    ['plan fingerprint input', (plan) => { plan.payload.consumerIntent.consumer = 'Tampered QA' }],
    ['resolution fingerprint mirror', (plan) => { plan.resolutionFingerprint = '1'.repeat(64) }],
    ['context fingerprint mirror', (plan) => { plan.contextFingerprint = '2'.repeat(64) }],
    ['runtime scope mirror', (plan) => { plan.runtimeInstanceKey = 'tampered' }],
    ['tenant scope mirror', (plan) => { plan.tenantId = new mongoose.Types.ObjectId() }],
    ['customer scope mirror', (plan) => { plan.customerId = new mongoose.Types.ObjectId() }],
    ['publish snapshot mirror', (plan) => { plan.publishSnapshotId = 'tampered' }],
    ['lock snapshot mirror', (plan) => { plan.lockSnapshotId = 'tampered' }],
    ['replay anchor mirror', (plan) => { plan.replayAnchorId = 'tampered' }],
    ['dependency snapshot mirror', (plan) => { plan.dependencySnapshotId = 'tampered' }],
    ['pack count mirror', (plan) => { plan.selectedPackCount += 1 }],
    ['selected pack activation', (plan) => { plan.payload.resolution.selectedPacks[0].activationId = 'tampered' }],
    ['selected pack id', (plan) => { plan.payload.resolution.selectedPacks[0].packId = 'tampered' }],
    ['selected pack version', (plan) => { plan.payload.resolution.selectedPacks[0].versionId = 'tampered' }],
    ['selected pack content hash', (plan) => { plan.payload.resolution.selectedPacks[0].contentHash = `sha256:${'9'.repeat(64)}` }],
    ['selected pack stage role', (plan) => { plan.payload.resolution.selectedPacks[0].stageAssignments = [] }],
    ['considered pack identity', (plan) => { plan.payload.resolution.consideredPacks[0].activationId = 'tampered' }],
    ['gap count mirror', (plan) => { plan.gapCount += 1 }],
    ['optional gap count mirror', (plan) => { plan.payload.optionalGapCount += 1 }],
    ['stage plan order', (plan) => { plan.payload.stagePlan[0].order = 2 }],
    ['stage plan assignment', (plan) => { plan.payload.stagePlan[0].assignedActivationIds.pop() }],
    ['accepted truth hash', (plan) => { plan.payload.lockedTruth.acceptedSections[0].truthHash = `sha256:${'9'.repeat(64)}` }],
  ])('fails closed on KCP tamper: %s', (_label, mutate) => {
    const plan = makePlan()
    mutate(plan)
    expect(() => assertOutcomeKnowledgeCompositionPlanIntegrity(plan)).toThrow()
    expect(() => buildSuccess({ plan })).toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.KCP_INVALID }))
  })

  it('rejects unsupported stage and invalid predecessor shape', () => {
    expect(() => buildSuccess({ stageKey: OUTCOME_QUALITY_STAGES.CANDIDATE_DISPOSITION }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.STAGE_NOT_SUPPORTED }))
    expect(() => buildSuccess({ expectedLatestAttemptNumber: 1 }))
      .toThrow(expect.objectContaining({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.PREDECESSOR_INVALID }))
  })

  it('defines only the two approved unique indexes', () => {
    expect(OutcomeQualityStageExecution.schema.indexes()).toEqual(expect.arrayContaining([
      [{ stageExecutionId: 1 }, expect.objectContaining({ unique: true, name: 'uniq_outcome_quality_stage_execution_id' })],
      [{ runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 }, expect.objectContaining({ unique: true, name: 'uniq_outcome_quality_stage_attempt' })],
    ]))
    expect(OutcomeQualityStageExecution.schema.indexes()).toHaveLength(2)
  })

  it.each([
    ['updateOne', [{ stageExecutionId: 'qa' }, { $set: { status: 'FAILED' } }]],
    ['updateMany', [{ stageExecutionId: 'qa' }, { $set: { status: 'FAILED' } }]],
    ['findOneAndUpdate', [{ stageExecutionId: 'qa' }, { $set: { status: 'FAILED' } }]],
    ['replaceOne', [{ stageExecutionId: 'qa' }, { stageExecutionId: 'replacement' }]],
    ['findOneAndReplace', [{ stageExecutionId: 'qa' }, { stageExecutionId: 'replacement' }]],
    ['deleteOne', [{ stageExecutionId: 'qa' }]],
    ['deleteMany', [{ stageExecutionId: 'qa' }]],
    ['findOneAndDelete', [{ stageExecutionId: 'qa' }]],
  ])('rejects append-only mutation operation %s', async (operation, args) => {
    const query = OutcomeQualityStageExecution[operation](...args)
    await expect(query.exec()).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.IMMUTABLE })
  })

  it('persists one successful attempt and an exact content-safe audit in one session', async () => {
    const fixture = makePersistenceDeps()
    const candidate = buildSuccess({ plan: fixture.plan })
    const result = await createOutcomeQualityStageExecution({
      ...createArgs(fixture.plan, candidate),
      deps: fixture.deps,
    })
    expect(result.idempotent).toBe(false)
    expect(fixture.saved).toHaveLength(1)
    expect(fixture.saved[0].save).toHaveBeenCalledWith({ session: fixture.session })
    expect(fixture.saved).toHaveLength(1)
    expect(fixture.committedAudits).toHaveLength(1)
    expect(fixture.audit.log).toHaveBeenCalledTimes(1)
    const [auditPayload, auditOptions] = fixture.audit.log.mock.calls[0]
    expect(Object.keys(auditPayload.diff).sort()).toEqual([
      'assignedActivationCount',
      'attemptNumber',
      'contributingActivationCount',
      'durationMs',
      'failureCode',
      'inputFingerprint',
      'outputFingerprint',
      'planFingerprint',
      'planId',
      'planVersion',
      'predecessorStageExecutionId',
      'providerConfigurationVersion',
      'qualityRunId',
      'retryable',
      'stageExecutionId',
      'stageKey',
      'stageOrder',
      'status',
      'truthReferenceCount',
    ])
    expect(JSON.stringify(auditPayload.diff)).not.toMatch(/analysis|recommendation|prompt|content|truthHash/i)
    expect(auditPayload.diff.providerConfigurationVersion)
      .toBe(OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION)
    expect(auditOptions).toEqual({ session: fixture.session, throwOnError: true })
  })

  it('persists a first Working Draft only from the exact successful Framework Guidance source', async () => {
    const plan = makePlan()
    const sourceStage = makeFrameworkGuidanceSource(plan)
    const fixture = makePersistenceDeps({ plan, sourceStage })
    const output = makeWorkingDraftOutput(plan, sourceStage)
    const candidate = buildWorkingDraft({ plan, sourceStageExecution: sourceStage, output })
    const result = await createOutcomeQualityStageExecution({
      planRecordId: ids.plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
      expectedLatestAttemptNumber: 0,
      predecessorStageExecutionId: sourceStage.stageExecutionId,
      predecessorAttemptFingerprint: sourceStage.attemptFingerprint,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output,
      executionIdentity: workingDraftExecutionIdentity(),
      startedAt: '2026-08-03T09:01:00.000Z',
      completedAt: '2026-08-03T09:01:00.500Z',
      expectedAttemptFingerprint: candidate.attemptFingerprint,
      actorUserId: ids.actor,
      deps: fixture.deps,
    })
    expect(result.idempotent).toBe(false)
    expect(fixture.saved).toHaveLength(1)
    expect(fixture.saved[0].inputSnapshot.sourceStage.stageExecutionId).toBe(sourceStage.stageExecutionId)
    expect(fixture.audit.log).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(fixture.audit.log.mock.calls[0][0].diff))
      .not.toMatch(/statement|meaningSummary|decisionLogic|content|claims|findings/i)
  })

  it('fails closed when the successful source stage drifts inside the transaction', async () => {
    const plan = makePlan()
    const sourceStage = makeFrameworkGuidanceSource(plan)
    const transactionSourceStage = {
      ...clone(sourceStage),
      outputFingerprint: '9'.repeat(64),
    }
    const fixture = makePersistenceDeps({ plan, sourceStage, transactionSourceStage })
    const output = makeWorkingDraftOutput(plan, sourceStage)
    const candidate = buildWorkingDraft({ plan, sourceStageExecution: sourceStage, output })
    await expect(createOutcomeQualityStageExecution({
      planRecordId: ids.plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
      expectedLatestAttemptNumber: 0,
      predecessorStageExecutionId: sourceStage.stageExecutionId,
      predecessorAttemptFingerprint: sourceStage.attemptFingerprint,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output,
      executionIdentity: workingDraftExecutionIdentity(),
      startedAt: '2026-08-03T09:01:00.000Z',
      completedAt: '2026-08-03T09:01:00.500Z',
      expectedAttemptFingerprint: candidate.attemptFingerprint,
      actorUserId: ids.actor,
      deps: fixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.PREDECESSOR_INVALID })
    expect(fixture.saved).toHaveLength(0)
    expect(fixture.committedAudits).toHaveLength(0)
  })

  it('persists ARL approved meaning without persisting review prose in the audit diff', async () => {
    const plan = makePlan()
    const sourceStage = makeWorkingDraftSource(plan)
    const fixture = makePersistenceDeps({ plan, sourceStage })
    const output = makeArlOutput(plan, sourceStage)
    const candidate = buildArlReview({ plan, sourceStageExecution: sourceStage, output })
    const result = await createOutcomeQualityStageExecution({
      planRecordId: ids.plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
      expectedLatestAttemptNumber: 0,
      predecessorStageExecutionId: sourceStage.stageExecutionId,
      predecessorAttemptFingerprint: sourceStage.attemptFingerprint,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output,
      executionIdentity: internalExecutionIdentity(),
      startedAt: '2026-08-03T09:02:00.000Z',
      completedAt: '2026-08-03T09:02:00.500Z',
      expectedAttemptFingerprint: candidate.attemptFingerprint,
      actorUserId: ids.actor,
      deps: fixture.deps,
    })
    expect(result.execution.outputSnapshot.approvedMeaning.state).toBe('APPROVED')
    expect(fixture.saved).toHaveLength(1)
    expect(fixture.audit.log).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(fixture.audit.log.mock.calls[0][0].diff))
      .not.toMatch(/meaningSummary|decisionLogic|finding|statement|content/i)
  })

  it.each([
    ['superseded plan', () => {
      const plan = makePlan()
      const latestPlan = { ...clone(plan), _id: new mongoose.Types.ObjectId(), planId: 'outcome_kcp_qa_v2', planVersion: 2 }
      return makePersistenceDeps({ plan, latestPlan })
    }],
    ['runtime updated', () => {
      const runtime = makeRuntime()
      runtime.updatedAt = new Date('2026-08-03T09:30:00.000Z')
      return makePersistenceDeps({ runtime })
    }],
    ['publish snapshot drift', () => {
      const runtime = makeRuntime()
      runtime.framework_state.lock.publish.snapshotHash = '9'.repeat(64)
      return makePersistenceDeps({ runtime })
    }],
    ['lock snapshot drift', () => {
      const runtime = makeRuntime()
      runtime.framework_state.lock.snapshot.snapshotHash = '9'.repeat(64)
      return makePersistenceDeps({ runtime })
    }],
    ['dependency snapshot drift', () => {
      const runtime = makeRuntime()
      runtime.framework_state.lock.evidence.dependencySnapshotHash = '9'.repeat(64)
      return makePersistenceDeps({ runtime })
    }],
    ['accepted truth drift', () => {
      const runtime = makeRuntime()
      runtime.framework_state.sections.customer_context.accepted.truthHash = `sha256:${'9'.repeat(64)}`
      return makePersistenceDeps({ runtime })
    }],
    ['transaction-time runtime drift', () => {
      const transactionRuntime = makeRuntime()
      transactionRuntime.framework_state.lock.anchor.replayAnchorHash = '9'.repeat(64)
      return makePersistenceDeps({ transactionRuntime })
    }],
    ['transaction-time latest-plan drift', () => {
      const plan = makePlan()
      const transactionLatestPlan = { ...clone(plan), _id: new mongoose.Types.ObjectId(), planId: 'outcome_kcp_qa_v2', planVersion: 2 }
      return makePersistenceDeps({ plan, transactionLatestPlan })
    }],
  ])('fails closed on current KCP/runtime freshness: %s', async (_label, buildFixture) => {
    const fixture = buildFixture()
    const candidate = buildSuccess({ plan: fixture.plan })
    await expect(createOutcomeQualityStageExecution({
      ...createArgs(fixture.plan, candidate),
      deps: fixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.KCP_INVALID })
    expect(fixture.saved).toHaveLength(0)
    expect(fixture.committedAudits).toHaveLength(0)
  })

  it('fails closed when the selected KCP or current runtime freshness evidence is missing', async () => {
    for (const missing of ['plan', 'runtime']) {
      const fixture = makePersistenceDeps()
      if (missing === 'plan') fixture.deps.OutcomeKnowledgeCompositionPlan.findOne = jest.fn(() => makeQuery(null))
      if (missing === 'runtime') fixture.deps.RuntimeInstance.findOne = jest.fn(() => makeQuery(null))
      const candidate = buildSuccess({ plan: fixture.plan })
      await expect(createOutcomeQualityStageExecution({
        ...createArgs(fixture.plan, candidate),
        deps: fixture.deps,
      })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.KCP_INVALID })
    }
  })

  it('returns identical successful attempt idempotently without save or audit', async () => {
    const base = makePersistenceDeps()
    const candidate = buildSuccess({ plan: base.plan })
    const latest = {
      _id: ids.stage,
      stageExecutionId: 'outcome_quality_stage_existing',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:00:02.000Z'),
      ...candidate,
    }
    const fixture = makePersistenceDeps({ latest })
    const repeatCandidate = buildSuccess({ plan: fixture.plan })
    const result = await createOutcomeQualityStageExecution({
      ...createArgs(fixture.plan, repeatCandidate),
      deps: fixture.deps,
    })
    expect(result.idempotent).toBe(true)
    expect(fixture.saved).toHaveLength(0)
    expect(fixture.audit.log).not.toHaveBeenCalled()
  })

  it.each([
    OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
    OUTCOME_QUALITY_STAGE_STATUSES.BLOCKED,
  ])('allows an exact retry after a retryable %s predecessor', async (predecessorStatus) => {
    const initial = makePersistenceDeps()
    const plan = initial.plan
    const failedCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      expectedLatestAttemptNumber: 0,
      status: predecessorStatus,
      failure: { failureCode: predecessorStatus, safeReason: 'The prior attempt did not succeed.', retryable: true },
      executionIdentity: executionIdentity({ providerKey: '', model: '', grrExecutionId: '', grrRuntimeArtifactId: '' }),
      startedAt: '2026-08-03T09:00:00.000Z',
      completedAt: '2026-08-03T09:00:00.250Z',
    })
    const latest = {
      _id: ids.stage,
      stageExecutionId: 'outcome_quality_stage_failed',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:00:01.000Z'),
      ...failedCandidate,
    }
    const fixture = makePersistenceDeps({ latest })
    const retryCandidate = buildSuccess({
      plan: fixture.plan,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latest.stageExecutionId,
      predecessorAttemptFingerprint: latest.attemptFingerprint,
    })
    const result = await createOutcomeQualityStageExecution({
      ...createArgs(fixture.plan, retryCandidate, {
        expectedLatestAttemptNumber: 1,
        predecessorStageExecutionId: latest.stageExecutionId,
        predecessorAttemptFingerprint: latest.attemptFingerprint,
      }),
      deps: fixture.deps,
    })
    expect(result.execution.attemptNumber).toBe(2)
    expect(result.execution.predecessorAttemptFingerprint).toBe(latest.attemptFingerprint)
  })

  it('allows an exact retryable V2 timeout predecessor to advance to active V4', async () => {
    const initial = makePersistenceDeps()
    const plan = initial.plan
    const failedCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      expectedLatestAttemptNumber: 0,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: {
        failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_TIMEOUT',
        safeReason: 'The provider request timed out.',
        retryable: true,
      },
      executionIdentity: executionIdentity({
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
        grrExecutionId: '',
        grrRuntimeArtifactId: '',
      }),
      startedAt: '2026-08-03T09:00:00.000Z',
      completedAt: '2026-08-03T09:00:00.250Z',
    })
    const latest = {
      _id: ids.stage,
      stageExecutionId: 'outcome_quality_stage_v2_timeout',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:00:01.000Z'),
      ...failedCandidate,
    }
    const fixture = makePersistenceDeps({ latest })
    const retryCandidate = buildSuccess({
      plan: fixture.plan,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latest.stageExecutionId,
      predecessorAttemptFingerprint: latest.attemptFingerprint,
      executionIdentity: executionIdentity({
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
      }),
    })
    const result = await createOutcomeQualityStageExecution({
      ...createArgs(fixture.plan, retryCandidate, {
        expectedLatestAttemptNumber: 1,
        predecessorStageExecutionId: latest.stageExecutionId,
        predecessorAttemptFingerprint: latest.attemptFingerprint,
        executionIdentity: executionIdentity({
          providerConfigurationVersion:
            OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
        }),
      }),
      deps: fixture.deps,
    })
    expect(result.execution).toMatchObject({
      attemptNumber: 2,
      predecessorStageExecutionId: latest.stageExecutionId,
      executionIdentity: expect.objectContaining({
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
      }),
    })
  })

  it.each([
    OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
    OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
    OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
    OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
    OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
  ])('allows one exact legacy V1 output-contract recovery under repaired lineage %s', async (
    candidateConfigurationVersion,
  ) => {
    const base = makePersistenceDeps()
    const predecessorCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan: base.plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: base.plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      expectedLatestAttemptNumber: 0,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: {
        failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
        safeReason: 'The governed provider output was invalid.',
        retryable: false,
      },
      executionIdentity: executionIdentity({
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V1,
        grrExecutionId: '',
        grrRuntimeArtifactId: '',
      }),
      startedAt: '2026-08-03T09:00:00.000Z',
      completedAt: '2026-08-03T09:00:00.250Z',
    })
    const latest = {
      _id: ids.stage,
      stageExecutionId: 'outcome_quality_stage_v1_output_invalid',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:00:01.000Z'),
      ...predecessorCandidate,
    }
    delete latest.executionIdentity.providerConfigurationVersion
    const fixture = makePersistenceDeps({ latest })
    const retryCandidate = buildSuccess({
      plan: fixture.plan,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latest.stageExecutionId,
      predecessorAttemptFingerprint: latest.attemptFingerprint,
      executionIdentity: executionIdentity({
        providerConfigurationVersion: candidateConfigurationVersion,
      }),
    })
    const result = await createOutcomeQualityStageExecution({
      ...createArgs(fixture.plan, retryCandidate, {
        expectedLatestAttemptNumber: 1,
        predecessorStageExecutionId: latest.stageExecutionId,
        predecessorAttemptFingerprint: latest.attemptFingerprint,
        executionIdentity: executionIdentity({
          providerConfigurationVersion: candidateConfigurationVersion,
        }),
      }),
      deps: fixture.deps,
    })
    expect(result.execution).toMatchObject({
      attemptNumber: 2,
      predecessorStageExecutionId: latest.stageExecutionId,
      executionIdentity: expect.objectContaining({
        providerConfigurationVersion: candidateConfigurationVersion,
      }),
    })
  })

  it.each([
    ['successful V3-to-V4', OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS],
    ['failure-shaped V3-to-V4', OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS],
    ['successful V4-to-V5', OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION],
    ['failure-shaped V4-to-V5', OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION],
    ['successful V5-to-V6', OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['failure-shaped V5-to-V6', OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
  ])('allows one exact %s recovery candidate', async (
    _label,
    candidateStatus,
    predecessorConfigurationVersion,
    candidateConfigurationVersion,
  ) => {
    const base = makePersistenceDeps()
    const predecessorCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan: base.plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: base.plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      expectedLatestAttemptNumber: 0,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: {
        failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
        safeReason: 'The governed provider output was invalid.',
        retryable: false,
      },
      executionIdentity: executionIdentity({
        providerConfigurationVersion: predecessorConfigurationVersion,
        grrExecutionId: '',
        grrRuntimeArtifactId: '',
      }),
      startedAt: '2026-08-03T09:00:00.000Z',
      completedAt: '2026-08-03T09:00:00.250Z',
    })
    const latest = {
      _id: ids.stage,
      stageExecutionId: 'outcome_quality_stage_v3_output_invalid',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:00:01.000Z'),
      ...predecessorCandidate,
    }
    const fixture = makePersistenceDeps({ latest })
    const common = {
      plan: fixture.plan,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latest.stageExecutionId,
      predecessorAttemptFingerprint: latest.attemptFingerprint,
      executionIdentity: executionIdentity({
        providerConfigurationVersion: candidateConfigurationVersion,
        ...(candidateStatus === OUTCOME_QUALITY_STAGE_STATUSES.FAILED
          ? { grrExecutionId: '', grrRuntimeArtifactId: '' }
          : {}),
      }),
    }
    const failure = {
      failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      safeReason: 'The governed framework and guidance provider did not complete this attempt.',
      retryable: false,
    }
    const retryCandidate = candidateStatus === OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
      ? buildSuccess(common)
      : buildFailure(OUTCOME_QUALITY_STAGE_STATUSES.FAILED, { ...common, failure })
    const result = await createOutcomeQualityStageExecution({
      ...createArgs(fixture.plan, retryCandidate, {
        expectedLatestAttemptNumber: 1,
        predecessorStageExecutionId: latest.stageExecutionId,
        predecessorAttemptFingerprint: latest.attemptFingerprint,
        status: candidateStatus,
        ...(candidateStatus === OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
          ? { output: makeOutput(fixture.plan) }
          : { output: undefined, failure }),
        executionIdentity: common.executionIdentity,
      }),
      deps: fixture.deps,
    })
    expect(result.execution).toMatchObject({
      attemptNumber: 2,
      status: candidateStatus,
      predecessorStageExecutionId: latest.stageExecutionId,
      predecessorAttemptFingerprint: latest.attemptFingerprint,
      executionIdentity: expect.objectContaining({
        providerConfigurationVersion: candidateConfigurationVersion,
      }),
    })
    if (candidateStatus === OUTCOME_QUALITY_STAGE_STATUSES.FAILED) {
      expect(result.execution).toMatchObject({ failure })
      expect(result.execution).not.toHaveProperty('outputSnapshot')
      expect(fixture.audit.log).toHaveBeenCalledWith(expect.objectContaining({
        diff: expect.objectContaining({
          failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
          retryable: false,
          providerConfigurationVersion: candidateConfigurationVersion,
        }),
      }), { session: fixture.session, throwOnError: true })
      const auditPayload = fixture.audit.log.mock.calls[0][0]
      expect(auditPayload).not.toHaveProperty('diagnostic')
      expect(auditPayload.diff).not.toHaveProperty('diagnostic')
      expect(JSON.stringify(auditPayload)).not.toMatch(/rawProviderOutput|rawProviderBody|rawParlonContent/i)
    }
  })

  it.each([
    ['V2 output-invalid to V2', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2],
    ['V2 output-invalid to V4', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS],
    ['V3 output-invalid to V3', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND],
    ['V4 output-invalid to V3', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND],
    ['V4 output-invalid to V4', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS],
    ['V2 output-invalid to V5', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION],
    ['V3 output-invalid to V5', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION],
    ['V5 output-invalid to V5', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION],
    ['V2 output-invalid to V6', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['V3 output-invalid to V6', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['V4 output-invalid to V6', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['V6 output-invalid to V6', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['different non-retryable failure', 'FRAMEWORK_GUIDANCE_PROVIDER_REFUSED',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['provider identity drift', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
      { providerKey: 'different-provider' }],
    ['model identity drift', 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
      OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
      { model: 'different-model' }],
  ])('rejects provider-contract recovery for %s', async (
    _label,
    failureCode,
    predecessorVersion,
    candidateVersion,
    predecessorIdentityOverrides = {},
  ) => {
    const base = makePersistenceDeps()
    const predecessorCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan: base.plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: base.plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      expectedLatestAttemptNumber: 0,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: { failureCode, safeReason: 'The governed attempt failed.', retryable: false },
      executionIdentity: executionIdentity({
        providerConfigurationVersion: predecessorVersion,
        grrExecutionId: '',
        grrRuntimeArtifactId: '',
        ...predecessorIdentityOverrides,
      }),
      startedAt: '2026-08-03T09:00:00.000Z',
      completedAt: '2026-08-03T09:00:00.250Z',
    })
    const latest = {
      _id: ids.stage,
      stageExecutionId: 'outcome_quality_stage_non_retryable',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:00:01.000Z'),
      ...predecessorCandidate,
    }
    const fixture = makePersistenceDeps({ latest })
    const retryCandidate = buildSuccess({
      plan: fixture.plan,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latest.stageExecutionId,
      predecessorAttemptFingerprint: latest.attemptFingerprint,
      executionIdentity: executionIdentity({ providerConfigurationVersion: candidateVersion }),
    })
    await expect(createOutcomeQualityStageExecution({
      ...createArgs(fixture.plan, retryCandidate, {
        expectedLatestAttemptNumber: 1,
        predecessorStageExecutionId: latest.stageExecutionId,
        predecessorAttemptFingerprint: latest.attemptFingerprint,
        executionIdentity: executionIdentity({ providerConfigurationVersion: candidateVersion }),
      }),
      deps: fixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.PREDECESSOR_INVALID })
  })

  it.each([
    ['stage execution id', (latest) => ({
      predecessorStageExecutionId: `${latest.stageExecutionId}-wrong`,
      predecessorAttemptFingerprint: latest.attemptFingerprint,
    })],
    ['attempt fingerprint', (latest) => ({
      predecessorStageExecutionId: latest.stageExecutionId,
      predecessorAttemptFingerprint: '9'.repeat(64),
    })],
    ['input fingerprint', (latest) => {
      latest.inputFingerprint = '8'.repeat(64)
      return {
        predecessorStageExecutionId: latest.stageExecutionId,
        predecessorAttemptFingerprint: latest.attemptFingerprint,
      }
    }],
    ['quality run id', (latest) => {
      latest.qualityRunId = 'outcome_quality_run_mismatched'
      refreshStageRecordFingerprints(latest)
      return {
        predecessorStageExecutionId: latest.stageExecutionId,
        predecessorAttemptFingerprint: latest.attemptFingerprint,
      }
    }],
    ['plan fingerprint', (latest) => {
      latest.planFingerprint = '7'.repeat(64)
      refreshStageRecordFingerprints(latest)
      return {
        predecessorStageExecutionId: latest.stageExecutionId,
        predecessorAttemptFingerprint: latest.attemptFingerprint,
      }
    }],
  ])('rejects V5-to-V6 recovery predecessor mismatch in %s', async (_label, mismatch) => {
    const base = makePersistenceDeps()
    const failedCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan: base.plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: base.plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      expectedLatestAttemptNumber: 0,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: {
        failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
        safeReason: 'The governed provider output was invalid.',
        retryable: false,
      },
      executionIdentity: executionIdentity({
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
        grrExecutionId: '',
        grrRuntimeArtifactId: '',
      }),
      startedAt: '2026-08-03T09:00:00.000Z',
      completedAt: '2026-08-03T09:00:00.250Z',
    })
    const latest = {
      _id: ids.stage,
      stageExecutionId: 'outcome_quality_stage_failed',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:00:01.000Z'),
      ...failedCandidate,
    }
    const predecessor = mismatch(latest)
    const fixture = makePersistenceDeps({ latest })
    const retryCandidate = buildSuccess({
      plan: fixture.plan,
      expectedLatestAttemptNumber: 1,
      ...predecessor,
      executionIdentity: executionIdentity({
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
      }),
    })
    await expect(createOutcomeQualityStageExecution({
      ...createArgs(fixture.plan, retryCandidate, {
        expectedLatestAttemptNumber: 1,
        ...predecessor,
        executionIdentity: executionIdentity({
          providerConfigurationVersion:
            OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
        }),
      }),
      deps: fixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.PREDECESSOR_INVALID })
  })

  it.each([
    ['success predecessor', OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED, true, OUTCOME_QUALITY_STAGE_ERROR_CODES.RETRY_NOT_ALLOWED],
    ['non-retryable failure', OUTCOME_QUALITY_STAGE_STATUSES.FAILED, false, OUTCOME_QUALITY_STAGE_ERROR_CODES.PREDECESSOR_INVALID],
  ])('rejects retry after %s', async (_label, latestStatus, retryable, code) => {
    const base = makePersistenceDeps()
    const candidate = buildSuccess({ plan: base.plan })
    const latest = {
      _id: ids.stage,
      stageExecutionId: 'outcome_quality_stage_previous',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:00:02.000Z'),
      ...candidate,
      status: latestStatus,
      failure: latestStatus === OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
        ? undefined
        : { failureCode: 'BLOCKED', safeReason: 'Blocked.', retryable },
    }
    const fixture = makePersistenceDeps({ latest })
    const retryCandidate = buildSuccess({
      plan: fixture.plan,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latest.stageExecutionId,
      predecessorAttemptFingerprint: latest.attemptFingerprint,
    })
    await expect(createOutcomeQualityStageExecution({
      ...createArgs(fixture.plan, retryCandidate, {
        expectedLatestAttemptNumber: 1,
        predecessorStageExecutionId: latest.stageExecutionId,
        predecessorAttemptFingerprint: latest.attemptFingerprint,
      }),
      deps: fixture.deps,
    })).rejects.toMatchObject({ code })
  })

  it('does not apply Framework Guidance provider-output recovery to Working Draft retries', async () => {
    const plan = makePlan()
    const sourceStage = makeFrameworkGuidanceSource(plan)
    const failedCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
      expectedLatestAttemptNumber: 0,
      predecessorStageExecutionId: sourceStage.stageExecutionId,
      predecessorAttemptFingerprint: sourceStage.attemptFingerprint,
      sourceStageExecution: sourceStage,
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      failure: {
        failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
        safeReason: 'A deliberately stage-mismatched fixture failed.',
        retryable: false,
      },
      executionIdentity: workingDraftExecutionIdentity(),
      startedAt: '2026-08-03T09:01:00.000Z',
      completedAt: '2026-08-03T09:01:00.250Z',
    })
    const latest = {
      _id: new mongoose.Types.ObjectId(),
      stageExecutionId: 'outcome_quality_stage_working_non_retryable',
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:01:01.000Z'),
      ...failedCandidate,
    }
    const output = makeWorkingDraftOutput(plan, sourceStage)
    const retryCandidate = buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latest.stageExecutionId,
      predecessorAttemptFingerprint: latest.attemptFingerprint,
      sourceStageExecution: sourceStage,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output,
      executionIdentity: workingDraftExecutionIdentity(),
      startedAt: '2026-08-03T09:01:02.000Z',
      completedAt: '2026-08-03T09:01:02.500Z',
    })
    const fixture = makePersistenceDeps({ plan, latest, sourceStage })
    await expect(createOutcomeQualityStageExecution({
      planRecordId: ids.plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latest.stageExecutionId,
      predecessorAttemptFingerprint: latest.attemptFingerprint,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output,
      executionIdentity: workingDraftExecutionIdentity(),
      startedAt: '2026-08-03T09:01:02.000Z',
      completedAt: '2026-08-03T09:01:02.500Z',
      expectedAttemptFingerprint: retryCandidate.attemptFingerprint,
      actorUserId: ids.actor,
      deps: fixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.PREDECESSOR_INVALID })
    expect(fixture.saved).toHaveLength(0)
  })

  it('fails closed on expected-latest races, duplicate-key races, transaction absence and audit failure', async () => {
    const versionFixture = makePersistenceDeps({ latest: { attemptNumber: 1, status: 'FAILED' } })
    const versionCandidate = buildSuccess({ plan: versionFixture.plan })
    await expect(createOutcomeQualityStageExecution({
      ...createArgs(versionFixture.plan, versionCandidate),
      deps: versionFixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.VERSION_CONFLICT })

    const duplicateFixture = makePersistenceDeps({ saveError: Object.assign(new Error('E11000'), { code: 11000 }) })
    const duplicateCandidate = buildSuccess({ plan: duplicateFixture.plan })
    await expect(createOutcomeQualityStageExecution({
      ...createArgs(duplicateFixture.plan, duplicateCandidate),
      deps: duplicateFixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.VERSION_CONFLICT })

    const topologyFixture = makePersistenceDeps()
    topologyFixture.deps.assertTransactionSupport = jest.fn(() => { throw Object.assign(new Error('no transaction'), { code: OUTCOME_QUALITY_STAGE_ERROR_CODES.TRANSACTION_REQUIRED }) })
    const topologyCandidate = buildSuccess({ plan: topologyFixture.plan })
    await expect(createOutcomeQualityStageExecution({
      ...createArgs(topologyFixture.plan, topologyCandidate),
      deps: topologyFixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.TRANSACTION_REQUIRED })
    expect(topologyFixture.deps.mongoose.startSession).not.toHaveBeenCalled()

    const auditFixture = makePersistenceDeps({ auditError: new Error('audit unavailable') })
    const auditCandidate = buildSuccess({ plan: auditFixture.plan })
    await expect(createOutcomeQualityStageExecution({
      ...createArgs(auditFixture.plan, auditCandidate),
      deps: auditFixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.AUDIT_FAILED })
    expect(auditFixture.session.withTransaction).toHaveBeenCalledTimes(1)
    expect(auditFixture.saved).toHaveLength(0)
    expect(auditFixture.committedAudits).toHaveLength(0)

    const persistenceFixture = makePersistenceDeps({ saveError: new Error('persistence unavailable') })
    const persistenceCandidate = buildSuccess({ plan: persistenceFixture.plan })
    await expect(createOutcomeQualityStageExecution({
      ...createArgs(persistenceFixture.plan, persistenceCandidate),
      deps: persistenceFixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.PERSISTENCE_FAILED })
    expect(persistenceFixture.saved).toHaveLength(0)
    expect(persistenceFixture.committedAudits).toHaveLength(0)

    const invalidSessionFixture = makePersistenceDeps({ invalidSession: true })
    const invalidSessionCandidate = buildSuccess({ plan: invalidSessionFixture.plan })
    await expect(createOutcomeQualityStageExecution({
      ...createArgs(invalidSessionFixture.plan, invalidSessionCandidate),
      deps: invalidSessionFixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.TRANSACTION_REQUIRED })

    const readFailureFixture = makePersistenceDeps()
    readFailureFixture.deps.RuntimeInstance.findOne = jest.fn(() => { throw new Error('read unavailable') })
    const readFailureCandidate = buildSuccess({ plan: readFailureFixture.plan })
    await expect(createOutcomeQualityStageExecution({
      ...createArgs(readFailureFixture.plan, readFailureCandidate),
      deps: readFailureFixture.deps,
    })).rejects.toMatchObject({ code: OUTCOME_QUALITY_STAGE_ERROR_CODES.PERSISTENCE_FAILED })
  })

  it('serializes only the governed allowlist and excludes internal or unsafe top-level fields', () => {
    const candidate = buildSuccess()
    const serialized = serializeOutcomeQualityStageExecution({
      _id: ids.stage,
      stageExecutionId: 'outcome_quality_stage_serialized',
      ...candidate,
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T09:00:02.000Z'),
      __v: 7,
      secret: 'must-not-leak',
      internalProviderResponse: { prompt: 'must-not-leak' },
    })
    expect(serialized).not.toHaveProperty('__v')
    expect(serialized).not.toHaveProperty('secret')
    expect(serialized).not.toHaveProperty('internalProviderResponse')
    expect(Object.keys(serialized).sort()).toEqual([
      'assignedActivationCount', 'attemptFingerprint', 'attemptNumber', 'completedAt', 'contextFingerprint',
      'contractVersion', 'contributingActivationCount', 'createdAt', 'createdBy', 'customerId', 'durationMs', 'executionIdentity',
      'id', 'inputFingerprint', 'inputSnapshot', 'knowledgeCompositionPlanRecordId', 'outputFingerprint',
      'outputSnapshot', 'planFingerprint', 'planId', 'planVersion', 'predecessorAttemptFingerprint',
      'predecessorStageExecutionId', 'qualityRunId', 'resolutionFingerprint', 'runtimeInstanceId',
      'runtimeInstanceKey', 'stageExecutionId', 'stageKey', 'stageOrder', 'startedAt', 'status', 'tenantId',
      'truthReferenceCount',
    ].sort())
  })
})
