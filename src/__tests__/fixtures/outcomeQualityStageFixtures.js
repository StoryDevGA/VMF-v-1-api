import mongoose from 'mongoose'
import {
  OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
  OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
  OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
  OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
  OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
} from '../../constants/outcomeGovernedQuality.js'
import {
  buildOutcomeKnowledgeCompositionPlanCandidate,
  hashOutcomeKnowledgeCompositionSemanticValue,
} from '../../services/outcomeKnowledgeCompositionPlanService.js'
import {
  buildOutcomeQualityVisibleGaps,
  buildOutcomeQualityStageExecutionCandidate,
  hashOutcomeQualityStageValue,
} from '../../services/outcomeQualityStageExecutionService.js'
import {
  buildOutcomeNarrativePlanOutput,
  buildOutcomeShapedCandidateOutput,
  buildOutcomeShapedCandidateRevisionOutput,
} from '../../services/outcomePostArlQualityChainService.js'

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
        statement: 'The supplied summary presents Parlon as claiming this outcome; independent verification is not established in the supplied summaries.',
        truthReferences,
        evidence: ['All six accepted truth identities are retained in the draft lineage.'],
        meaningClass: 'SOURCE_PRESENTED',
        proofDependencies: [],
        validationStatus: 'NOT_STATED',
        proofDisposition: 'NOT_ESTABLISHED',
        whatCanBeSaidNow: 'The supplied summary presents Parlon as claiming this outcome.',
        blockedStrongerClaim: 'An achieved outcome is not established in the supplied summaries.',
        evidenceRequiredToSubstantiate: ['Evidence identifying the measure, scope, baseline, method and measurement window.'],
      }],
      truthReferences,
      contributingActivationIds,
      assumptions: [],
      gaps: [...plan.payload.consumerIntent.unresolvedGaps],
    }],
    decisionLogic: [{
      decisionKey: 'preserve_evidence_boundary',
      rationale: 'Interpretive placeholder: Source-presented framing: the supplied summary presents Parlon as expressing the claim. Recognition gap: recognition is not established in the supplied summaries. Understanding gap: measurement meaning is not established in the supplied summaries. Bounded interpretation now: the supplied summary presents Parlon as claiming this outcome. Qualified Reality: an achieved outcome is not established in the supplied summaries. Unresolved proof dependencies: Any proof questions not stated in accepted truth are author-added placeholders, not adopted Parlon requirements. Ordering is not established in the supplied evidence.',
      priority: 'NOT_ESTABLISHED',
      priorityBasis: 'NOT_ESTABLISHED',
      closureState: 'INCOMPLETE',
      actionAuthorization: 'NONE',
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

export const makeRequestScopedQualityChain = (requestBinding, { frameworkGuidancePrior = null, fixtureRuntime = makeRuntime(), binding = makeBinding() } = {}) => {
  const plan = makePlan({}, fixtureRuntime, binding)
  plan.requestId = requestBinding.requestId
  plan.payload.requestId = requestBinding.requestId
  plan.planFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(plan.payload)
  const stages = []
  const append = (candidate) => {
    const stage = { stageExecutionId: `outcome_quality_stage_${stages.length + 1}`, ...candidate }
    stages.push(stage)
    return stage
  }
  const common = { plan, requestBinding }
  const guidance = append(buildSuccess({ ...common, ...(frameworkGuidancePrior ? {
    expectedLatestAttemptNumber: frameworkGuidancePrior.attemptNumber,
    predecessorStageExecutionId: frameworkGuidancePrior.stageExecutionId,
    predecessorAttemptFingerprint: frameworkGuidancePrior.attemptFingerprint,
  } : {}) }))
  const workingDraft = append(buildWorkingDraft({ ...common, sourceStageExecution: guidance }))
  const arl = append(buildArlReview({
    ...common, sourceStageExecution: workingDraft,
    executionIdentity: { ...internalExecutionIdentity(), grrExecutionId: 'grr_exec_3', grrRuntimeArtifactId: 'grr_art_3' },
  }))
  const narrative = append(buildNarrativePlan({ ...common, sources: { workingDraftStage: workingDraft, arlStage: arl } }))
  const shaped = append(buildShapedCandidate({ ...common, sourceStageExecution: narrative }))
  append(buildRenderedExpressionRl({
    ...common, sourceStageExecution: shaped,
    executionIdentity: executionIdentity({ providerConfigurationVersion: OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION,
      grrExecutionId: 'grr_exec_6', grrRuntimeArtifactId: 'grr_art_6' }),
  }))
  return { plan, stages, runtime: fixtureRuntime }
}

export const makeRemediatedRequestScopedQualityChain = (requestBinding) => {
  const input = { ...makeRequestScopedQualityChain(requestBinding), requestBinding }
  const original = input.stages[4]
  const failed = { stageExecutionId: 'rl_failed', ...buildRenderedExpressionRl({
    plan: input.plan, requestBinding, sourceStageExecution: original, status: 'FAILED', output: undefined,
    failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE', safeReason: 'Expression requires changes.', retryable: false },
  }) }
  const findings = ['STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION']
    .map((dimension, index) => ({ dimension, status: index ? 'PASS' : 'FAIL', finding: 'Bounded expression finding.', requiredChange: !index }))
  const output = buildOutcomeShapedCandidateRevisionOutput({
    failedRlStage: failed, narrativePlanStage: input.stages[3], plan: input.plan, priorCandidateStage: original,
    title: original.outputSnapshot.title,
    rlArtifact: { runtimeArtifactId: failed.executionIdentity.grrRuntimeArtifactId,
      executionId: failed.executionIdentity.grrExecutionId, status: 'GENERATED', outputTypeKey: 'RENDERED_EXPRESSION_RL',
      generatedOutput: { outputType: 'RENDERED_EXPRESSION_RL', schemaVersion: input.stages[5].outputSnapshot.schemaVersion,
        overallStatus: 'FAIL', findings } },
  })
  const revised = { stageExecutionId: 'shaping_revised', ...buildOutcomeQualityStageExecutionCandidate({
    plan: input.plan, runtimeInstanceId: input.plan.runtimeInstanceId, expectedPlanFingerprint: input.plan.planFingerprint,
    stageKey: 'OUTPUT_SHAPING', expectedLatestAttemptNumber: 1,
    predecessorStageExecutionId: original.stageExecutionId, predecessorAttemptFingerprint: original.attemptFingerprint,
    sourceStageExecution: input.stages[3], status: 'SUCCEEDED', output,
    executionIdentity: original.executionIdentity, startedAt: original.startedAt, completedAt: original.completedAt, requestBinding,
  }) }
  const reviewed = { stageExecutionId: 'rl_revised', ...buildRenderedExpressionRl({
    plan: input.plan, requestBinding, sourceStageExecution: revised, expectedLatestAttemptNumber: 1,
    predecessorStageExecutionId: failed.stageExecutionId, predecessorAttemptFingerprint: failed.attemptFingerprint,
  }) }
  return { ...input, stages: [...input.stages.slice(0, 5), failed, revised, reviewed],
    recordedStages: [...input.stages.slice(0, 4), revised, reviewed] }
}

export {
  ids,
  runtimeUpdatedAt,
  emptyRelationshipHash,
  makeSection,
  makeRuntime,
  makePack,
  mandatory,
  makeBinding,
  makeContext,
  makePlan,
  makeLegacyPlan,
  makeOutput,
  executionIdentity,
  buildSuccess,
  buildFailure,
  internalExecutionIdentity,
  workingDraftExecutionIdentity,
  makeFrameworkGuidanceSource,
  makeWorkingDraftOutput,
  buildWorkingDraft,
  makeWorkingDraftSource,
  makeArlOutput,
  buildArlReview,
  makeArlSource,
  buildNarrativePlan,
  makeNarrativePlanSource,
  buildShapedCandidate,
  makeShapedCandidateSource,
  buildRenderedExpressionRl,
}
