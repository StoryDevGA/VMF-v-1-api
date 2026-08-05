import mongoose from 'mongoose'
import { describe, expect, jest, test } from '@jest/globals'

import {
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
  OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
  OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import {
  buildOutcomeKnowledgeCompositionPlanCandidate,
  hashOutcomeKnowledgeCompositionSemanticValue,
} from '../services/outcomeKnowledgeCompositionPlanService.js'
import {
  buildOutcomeQualityVisibleGaps,
  buildOutcomeQualityStageExecutionCandidate,
  hashOutcomeQualityStageValue,
} from '../services/outcomeQualityStageExecutionService.js'
import {
  buildWorkingDraftStageOutputFromProviderOutput,
  executeOutcomeWorkingDraft,
} from '../services/outcomeWorkingDraftExecutionService.js'
import { buildOutcomeStudioProviderSafeRequest } from '../services/outcomeStudioProviderSafeContextService.js'

const ids = {
  runtime: new mongoose.Types.ObjectId('6a6c8115bb9cebc18a1eca9c'),
  tenant: new mongoose.Types.ObjectId('6a6b14eca737c717e99b8069'),
  customer: new mongoose.Types.ObjectId('6a6b12fea737c717e99b7f6b'),
  actor: new mongoose.Types.ObjectId('6a6b135ba737c717e99b7f8a'),
  plan: new mongoose.Types.ObjectId('6a705569a7b760264f6a501f'),
  frameworkStage: new mongoose.Types.ObjectId('6a7100000000000000000001'),
  workingDraftStage: new mongoose.Types.ObjectId('6a7100000000000000000002'),
}
const runtimeUpdatedAt = '2026-08-02T18:59:29.591Z'
const descriptor = {
  providerKey: 'openai',
  model: 'approved-working-draft-test-model',
  providerMode: 'LIVE_TEST',
  environment: 'TEST',
  safeContextPolicyKey: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
  failurePosture: 'FAIL_CLOSED',
}
const emptyRelationshipHash = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'

const makeSection = (key, suffix, content) => ({
  state: { status: 'ACCEPTED' },
  accepted: {
    sectionKey: key,
    runtimePath: `framework_state.sections.${key}`,
    content,
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
      customer_context: makeSection('customer_context', 'a', 'Parlon serves regulated teams with evidence-sensitive decisions.'),
      strategic_objectives: makeSection('strategic_objectives', 'b', 'Parlon needs faster executive decisions without losing traceability.'),
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

const makeBinding = () => {
  const mandatory = [
    makePack({ packType: 'ARL', packKey: 'adaptive-reasoning-layer', knowledgeLayer: 'REASONING', suffix: '1' }),
    makePack({ packType: 'RL', packKey: 'rendering-layer', knowledgeLayer: 'COMMUNICATION_PATTERN', suffix: '2' }),
    makePack({ packType: 'OUTPUT_SCHEMA', packKey: 'output-schemas-pack', knowledgeLayer: 'OUTPUT_SCHEMA', suffix: '3' }),
    makePack({ packType: 'TRUTH_CERTIFICATION', packKey: 'truth-certification-pack', knowledgeLayer: 'VALIDATION', suffix: '4' }),
    makePack({ packType: 'OUTPUT_TYPE_DEFINITION', packKey: 'outcome-output-types', knowledgeLayer: 'OUTPUT_TYPE', suffix: '5' }),
  ]
  const selected = [
    ...mandatory,
    makePack({ packType: 'TRUTH_CERTIFICATION', packKey: 'blocking-rules', knowledgeLayer: 'VALIDATION', suffix: '6' }),
    makePack({ packType: 'OUTPUT_TYPE_DEFINITION', packKey: 'executive-brief', knowledgeLayer: 'OUTPUT_TYPE', capabilityKey: 'executive-brief', suffix: '7' }),
    makePack({ packType: 'OUTPUT_SCHEMA', packKey: 'executive-brief-schema', knowledgeLayer: 'OUTPUT_SCHEMA', capabilityKey: 'executive-brief-schema', suffix: '8' }),
    makePack({ packType: 'STYLE', packKey: 'executive-briefing-style', knowledgeLayer: 'STYLE', capabilityKey: 'executive-brief-style', suffix: '9' }),
  ]
  return {
    status: 'READY',
    mode: 'REQUEST_SPECIFIC',
    policyKey: 'outcome-studio-v1-required-packs',
    policyVersion: '1.0.0',
    mandatorySafeguards: mandatory,
    selectedByLayer: {
      VALIDATION: [selected[5]],
      OUTPUT_TYPE: [selected[6]],
      OUTPUT_SCHEMA: [selected[7]],
      STYLE: [selected[8]],
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

const makePlan = (runtime = makeRuntime()) => {
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

const frameworkGuidanceOutput = (plan = makePlan()) => {
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

const frameworkIdentity = () => ({
  executionMode: 'LIVE_TEST',
  providerKey: 'openai',
  providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
  model: 'framework-model',
  grrExecutionId: 'grr_exec_framework_guidance',
  grrRuntimeArtifactId: 'grr_art_framework_guidance',
  runtimeVersion: 'runtime.v1',
})

const workingDraftIdentity = () => ({
  executionMode: 'LIVE_TEST',
  providerKey: 'openai',
  providerConfigurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
  model: descriptor.model,
  grrExecutionId: 'grr_exec_working_draft',
  grrRuntimeArtifactId: 'grr_art_working_draft',
  runtimeVersion: runtimeUpdatedAt,
})

const makeFrameworkGuidanceStage = (plan = makePlan(), overrides = {}) => {
  const candidate = buildOutcomeQualityStageExecutionCandidate({
    plan,
    runtimeInstanceId: ids.runtime,
    expectedPlanFingerprint: plan.planFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    expectedLatestAttemptNumber: 0,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    output: frameworkGuidanceOutput(plan),
    executionIdentity: frameworkIdentity(),
    startedAt: '2026-08-03T09:00:00.000Z',
    completedAt: '2026-08-03T09:00:01.000Z',
  })
  return {
    _id: ids.frameworkStage,
    stageExecutionId: 'outcome_quality_stage_framework_source',
    createdBy: ids.actor,
    createdAt: new Date('2026-08-03T09:00:02.000Z'),
    ...candidate,
    ...overrides,
  }
}

const providerOutput = (plan = makePlan()) => {
  const truth = plan.payload.lockedTruth.acceptedSections.map((section) => section.sectionKey)
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
        statement: 'The current position is bounded by accepted truth.',
        truthReferences: truth,
        evidence: ['Accepted truth provides the bounded source for the decision.'],
      }],
      truthReferences: truth,
      assumptions: [],
      gaps: [...plan.payload.consumerIntent.unresolvedGaps],
    }],
    decisionLogic: [{
      decisionKey: 'preserve_evidence_boundary',
      rationale: 'The executive recommendation must not outrun accepted evidence.',
      priority: 'HIGH',
      truthReferences: truth,
    }],
    assumptions: [],
    visibleGaps: buildOutcomeQualityVisibleGaps(plan),
  }
}

const makeWorkingDraftStage = (plan = makePlan(), source = makeFrameworkGuidanceStage(plan)) => {
  const output = buildWorkingDraftStageOutputFromProviderOutput({
    providerOutput: providerOutput(plan),
    plan,
    sourceStage: source,
  })
  const candidate = buildOutcomeQualityStageExecutionCandidate({
    plan,
    runtimeInstanceId: ids.runtime,
    expectedPlanFingerprint: plan.planFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
    expectedLatestAttemptNumber: 0,
    predecessorStageExecutionId: source.stageExecutionId,
    predecessorAttemptFingerprint: source.attemptFingerprint,
    sourceStageExecution: source,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    output,
    executionIdentity: workingDraftIdentity(),
    startedAt: '2026-08-03T09:01:00.000Z',
    completedAt: '2026-08-03T09:01:01.000Z',
  })
  return {
    _id: ids.workingDraftStage,
    stageExecutionId: 'outcome_quality_stage_working_draft_success',
    createdBy: ids.actor,
    createdAt: new Date('2026-08-03T09:01:02.000Z'),
    ...candidate,
  }
}

const makeQuery = (value) => {
  const query = {
    lean: jest.fn(async () => value),
    sort: jest.fn(() => query),
    session: jest.fn(() => query),
  }
  return query
}

const makeModels = ({
  plan = makePlan(),
  latestPlan = null,
  runtime = makeRuntime(),
  frameworkStage = null,
  workingDraftStage = null,
  grrExecution = null,
  grrArtifact = null,
} = {}) => ({
  OutcomeKnowledgeCompositionPlan: {
    findOne: jest.fn((filter) => makeQuery(filter._id ? plan : (latestPlan || plan))),
  },
  RuntimeInstance: {
    findOne: jest.fn(() => makeQuery(runtime)),
  },
  OutcomeQualityStageExecution: {
    findOne: jest.fn((filter) => {
      if (filter.stageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE) return makeQuery(frameworkStage)
      if (filter.stageKey === OUTCOME_QUALITY_STAGES.WORKING_DRAFT) return makeQuery(workingDraftStage)
      return makeQuery(null)
    }),
  },
  GovernedReasoningExecution: {
    findOne: jest.fn(() => makeQuery(grrExecution)),
  },
  GovernedRuntimeArtifact: {
    findOne: jest.fn(() => makeQuery(grrArtifact)),
  },
})

const makeGrrSuccess = (plan = makePlan()) => ({
  executionId: 'grr_exec_working_draft',
  provider: {
    providerKey: descriptor.providerKey,
    model: descriptor.model,
    providerMode: 'LIVE_TEST',
    liveProvider: true,
  },
  artifact: {
    runtimeArtifactId: 'grr_art_working_draft',
    generatedOutput: providerOutput(plan),
  },
  requestedAt: new Date('2026-08-03T09:01:00.000Z'),
  completedAt: new Date('2026-08-03T09:01:01.000Z'),
})

const makeCreateStage = () => jest.fn(async (call) => ({
  idempotent: false,
  execution: {
    id: ids.workingDraftStage.toString(),
    stageExecutionId: 'outcome_quality_stage_working_draft_persisted',
    createdBy: ids.actor.toString(),
    createdAt: '2026-08-03T09:01:02.000Z',
    ...call,
    deps: undefined,
  },
}))

const makeProviderAdapter = () => {
  const adapter = jest.fn()
  adapter.configurationVersion = OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION
  return adapter
}

const executeArgs = ({
  plan = makePlan(),
  runtime = makeRuntime(),
  frameworkStage = undefined,
  workingDraftStage = null,
  createGrr = null,
  createStage = null,
  latestPlan = null,
  grrExecution = null,
  grrArtifact = null,
} = {}) => ({
  actorUserId: ids.actor,
  auditRequest: { ip: '127.0.0.1' },
  expectedPlanFingerprint: plan.planFingerprint,
  planRecordId: ids.plan,
  providerAdapter: makeProviderAdapter(),
  providerDescriptor: descriptor,
  runtimeInstanceId: ids.runtime,
  scopes: { tenantId: ids.tenant, customerId: ids.customer },
  deps: {
    ...makeModels({
      plan,
      latestPlan,
      runtime,
      frameworkStage: frameworkStage === undefined ? makeFrameworkGuidanceStage(plan) : frameworkStage,
      workingDraftStage,
      grrExecution,
      grrArtifact,
    }),
    assertOutcomeQualityStageTransactionSupport: jest.fn(),
    createGovernedReasoningExecution: createGrr || jest.fn(async () => makeGrrSuccess(plan)),
    createOutcomeQualityStageExecution: createStage || makeCreateStage(),
  },
})

describe('executeOutcomeWorkingDraft', () => {
  test('accepts the complete ordered visible-gap contract when the plan contains warnings', () => {
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
    const source = makeFrameworkGuidanceStage(plan)

    expect(buildWorkingDraftStageOutputFromProviderOutput({
      providerOutput: providerOutput(plan),
      plan,
      sourceStage: source,
    }).visibleGaps).toEqual([
      'Exact delivery file type is not specified',
      'Exact delivery channel is not specified',
      'Knowledge resolution warning QA.',
      'Governed context warning QA.',
    ])
  })

  test('orchestrates Working Draft through GRR and rehydrates server-owned contribution lineage', async () => {
    const plan = makePlan()
    const args = executeArgs({ plan })
    const result = await executeOutcomeWorkingDraft(args)

    expect(result.stage.stageKey).toBe(OUTCOME_QUALITY_STAGES.WORKING_DRAFT)
    expect(args.deps.createGovernedReasoningExecution).toHaveBeenCalledTimes(1)
    const grrCall = args.deps.createGovernedReasoningExecution.mock.calls[0][0]
    expect(grrCall.payload.idempotencyKey).toMatch(/^WORKING_DRAFT:outcome_kcp_qa:v1:[a-f0-9]{24}$/)
    expect(grrCall.payload.requestedOutputTypeKey)
      .toBe(grrCall.deps.providerInput.request.requestedOutputTypeKey)
    expect(grrCall.deps.providerInput).toEqual(expect.objectContaining({
      customerPrompt: expect.stringContaining('Generate the governed Working Draft only'),
      currentDraftMarkdown: '',
      request: expect.objectContaining({ outputTypeKey: 'WORKING_DRAFT' }),
    }))
    expect(Object.keys(grrCall.deps.providerInput).sort()).toEqual(['currentDraftMarkdown', 'customerPrompt', 'request'])
    expect(grrCall.deps.buildProviderSafeContext).toEqual(expect.any(Function))
    expect(grrCall.deps.assertProviderSafeContext).toEqual(expect.any(Function))
    expect(grrCall.deps.providerContextContractVersion)
      .toBe(OUTCOME_QUALITY_STAGE_PROVIDER_SAFE_CONTEXT_VERSION)
    expect(grrCall.deps.providerContextBindingFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(grrCall.payload.executionIntent).toContain('successful Framework Guidance')
    expect(grrCall.payload.executionIntent).not.toContain('approved Framework Guidance')
    const providerContext = await grrCall.deps.buildProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: buildOutcomeStudioProviderSafeRequest({
        providerDescriptor: descriptor,
        providerInput: grrCall.deps.providerInput,
      }),
      truthSource: {
        acceptedTruth: plan.payload.lockedTruth.acceptedSections.map((section) => ({
          label: section.sectionKey,
          content: `Accepted ${section.sectionKey} truth.`,
        })),
      },
      knowledgeSelection: [],
    })
    expect(providerContext.sourceCandidate.sections[0].analysis)
      .toContain('bounded context for the executive decision')
    expect(grrCall.deps.assertProviderSafeContext(providerContext)).toBe(providerContext)
    expect(JSON.stringify(providerContext)).not.toMatch(/outcome_quality_stage_framework_source|activation-|sha256:/)
    const projectedLongTruth = await grrCall.deps.buildProviderSafeContext({
      providerDescriptor: descriptor,
      safeRequest: buildOutcomeStudioProviderSafeRequest({
        providerDescriptor: descriptor,
        providerInput: grrCall.deps.providerInput,
      }),
      truthSource: {
        acceptedTruth: [{
          label: 'customer_context',
          content: `Read https://example.com/source ${'x'.repeat(1000)}`,
        }],
      },
      knowledgeSelection: [],
    })
    expect(projectedLongTruth.truthSummaries[0].summary).toHaveLength(900)
    expect(projectedLongTruth.truthSummaries[0].summary).not.toContain('https://')
    expect(projectedLongTruth.truthSummaries[0].summary).toContain('[source link omitted]')
    const stageCall = args.deps.createOutcomeQualityStageExecution.mock.calls[0][0]
    expect(stageCall.output.compositionProvenance).toEqual({
      frameworkGuidanceStageExecutionId: 'outcome_quality_stage_framework_source',
      frameworkGuidanceOutputFingerprint: stageCall.sourceStageExecution.outputFingerprint,
      planFingerprint: plan.planFingerprint,
    })
    expect(stageCall.output.sections[0].contributingActivationIds)
      .toEqual(expect.arrayContaining(['activation-blocking-rules', 'activation-truth-certification-pack']))
    expect(stageCall.executionIdentity).toMatchObject({
      providerKey: 'openai',
      providerConfigurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
      model: descriptor.model,
      grrExecutionId: 'grr_exec_working_draft',
      grrRuntimeArtifactId: 'grr_art_working_draft',
    })
  })

  test('accepts multiline section content while rejecting other control characters', async () => {
    const plan = makePlan()
    const multiline = makeGrrSuccess(plan)
    multiline.artifact.generatedOutput.sections[0].content = 'First paragraph.\n\nSecond paragraph.'
    await expect(executeOutcomeWorkingDraft(executeArgs({
      plan,
      createGrr: jest.fn(async () => multiline),
    })))
      .resolves.toMatchObject({ stage: { stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT } })

    const unsafe = makeGrrSuccess(plan)
    unsafe.artifact.generatedOutput.sections[0].content = 'Unsafe\u0007content.'
    await expect(executeOutcomeWorkingDraft(executeArgs({
      plan,
      createGrr: jest.fn(async () => unsafe),
    })))
      .rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_EXECUTION_INVALID' })
  })

  test('fails closed before GRR when Framework Guidance is missing, failed or stale', async () => {
    const missing = executeArgs({ frameworkStage: null })
    await expect(executeOutcomeWorkingDraft(missing))
      .rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_STAGE_HISTORY_INVALID' })
    expect(missing.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()

    const plan = makePlan()
    const failedSource = makeFrameworkGuidanceStage(plan, {
      status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
      outputSnapshot: undefined,
      outputFingerprint: '',
      failure: { failureCode: 'FAILED', safeReason: 'Failed.', retryable: true },
    })
    const failed = executeArgs({ plan, frameworkStage: failedSource })
    await expect(executeOutcomeWorkingDraft(failed))
      .rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_STAGE_HISTORY_INVALID' })
    expect(failed.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()

    const stalePlan = makePlan()
    const staleSource = makeFrameworkGuidanceStage(stalePlan)
    staleSource.planFingerprint = '9'.repeat(64)
    const stale = executeArgs({ plan: stalePlan, frameworkStage: staleSource })
    await expect(executeOutcomeWorkingDraft(stale))
      .rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_STAGE_HISTORY_INVALID' })
    expect(stale.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
  })

  test('fails closed before GRR on current KCP/runtime drift', async () => {
    const plan = makePlan()
    const latestPlan = structuredClone(plan)
    latestPlan.planVersion = 2
    latestPlan.payload.consumerIntent.outcome = 'Changed outcome QA'
    latestPlan.planFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(latestPlan.payload)
    const args = executeArgs({ plan, latestPlan })

    await expect(executeOutcomeWorkingDraft(args))
      .rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_BINDING_INVALID' })
    expect(args.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
  })

  test('fails closed before GRR on provider identity, source integrity, or retry lineage drift', async () => {
    const invalidAdapter = executeArgs()
    invalidAdapter.providerAdapter.configurationVersion = 'fs-003-working-draft-provider.invalid'
    await expect(executeOutcomeWorkingDraft(invalidAdapter))
      .rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_EXECUTION_INVALID' })
    expect(invalidAdapter.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()

    const invalidPolicy = executeArgs()
    invalidPolicy.providerDescriptor = { ...descriptor, safeContextPolicyKey: 'UNSAFE' }
    await expect(executeOutcomeWorkingDraft(invalidPolicy))
      .rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_EXECUTION_INVALID' })
    expect(invalidPolicy.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()

    const plan = makePlan()
    const tamperedSource = makeFrameworkGuidanceStage(plan)
    tamperedSource.outputSnapshot.title = 'Tampered after fingerprinting QA'
    const sourceDrift = executeArgs({ plan, frameworkStage: tamperedSource })
    await expect(executeOutcomeWorkingDraft(sourceDrift))
      .rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_STAGE_HISTORY_INVALID' })
    expect(sourceDrift.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()

    const source = makeFrameworkGuidanceStage(plan)
    const retry = makeWorkingDraftStage(plan, source)
    retry.status = OUTCOME_QUALITY_STAGE_STATUSES.FAILED
    retry.outputSnapshot = undefined
    retry.outputFingerprint = ''
    retry.failure = { failureCode: 'WORKING_DRAFT_PROVIDER_TIMEOUT', safeReason: 'Timed out.', retryable: true }
    retry.inputSnapshot.sourceStage.outputFingerprint = '9'.repeat(64)
    const retryDrift = executeArgs({ plan, frameworkStage: source, workingDraftStage: retry })
    await expect(executeOutcomeWorkingDraft(retryDrift))
      .rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_STAGE_HISTORY_INVALID' })
    expect(retryDrift.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
  })

  test('persists only enumerated provider failures as failed stages with declared retryability', async () => {
    const plan = makePlan()
    const transient = new Error('provider timeout')
    transient.code = 'OUTCOME_WORKING_DRAFT_PROVIDER_FAILED'
    transient.details = { reason: 'WORKING_DRAFT_PROVIDER_TIMEOUT' }
    const createGrr = jest.fn(async () => { throw transient })
    const createStage = makeCreateStage()
    const args = executeArgs({ plan, createGrr, createStage })

    const result = await executeOutcomeWorkingDraft(args)
    expect(result.stage.status).toBe(OUTCOME_QUALITY_STAGE_STATUSES.FAILED)
    const stageCall = createStage.mock.calls[0][0]
    expect(stageCall.failure).toEqual({
      failureCode: 'WORKING_DRAFT_PROVIDER_TIMEOUT',
      safeReason: 'The governed Working Draft provider did not complete this attempt.',
      retryable: true,
    })
    expect(stageCall.executionIdentity).toMatchObject({
      providerKey: 'openai',
      providerConfigurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION,
      model: descriptor.model,
      grrExecutionId: '',
      grrRuntimeArtifactId: '',
    })

    const grrPersistence = new Error('grr audit failed')
    grrPersistence.code = 'GRR_AUDIT_FAILED'
    const grrErrorArgs = executeArgs({
      plan,
      createGrr: jest.fn(async () => { throw grrPersistence }),
      createStage: makeCreateStage(),
    })
    await expect(executeOutcomeWorkingDraft(grrErrorArgs)).rejects.toBe(grrPersistence)
    expect(grrErrorArgs.deps.createOutcomeQualityStageExecution).not.toHaveBeenCalled()
  })

  test('does not report success when stage persistence fails and keeps GRR idempotency stable for retry', async () => {
    const plan = makePlan()
    const createGrr = jest.fn(async () => makeGrrSuccess(plan))
    const stageError = new Error('stage audit failed')
    stageError.code = 'OUTCOME_QUALITY_STAGE_AUDIT_FAILED'
    const createStage = jest.fn(async () => { throw stageError })
    const first = executeArgs({ plan, createGrr, createStage })

    await expect(executeOutcomeWorkingDraft(first)).rejects.toBe(stageError)
    const firstKey = createGrr.mock.calls[0][0].payload.idempotencyKey

    const second = executeArgs({ plan, createGrr, createStage })
    await expect(executeOutcomeWorkingDraft(second)).rejects.toBe(stageError)
    expect(createGrr).toHaveBeenCalledTimes(2)
    expect(createGrr.mock.calls[1][0].payload.idempotencyKey).toBe(firstKey)
  })

  test('returns an existing successful Working Draft only after exact GRR artifact lineage verifies', async () => {
    const plan = makePlan()
    const source = makeFrameworkGuidanceStage(plan)
    const existingStage = makeWorkingDraftStage(plan, source)
    const grrExecution = {
      executionId: 'grr_exec_working_draft',
      runtimeInstanceId: ids.runtime,
      status: 'COMPLETED',
      provider: {
        providerKey: 'openai',
        model: descriptor.model,
        providerMode: 'LIVE_TEST',
        liveProvider: true,
      },
    }
    const grrArtifact = {
      runtimeArtifactId: 'grr_art_working_draft',
      executionId: 'grr_exec_working_draft',
      runtimeInstanceId: ids.runtime,
      status: 'GENERATED',
      generatedOutput: providerOutput(plan),
    }
    const args = executeArgs({
      plan,
      frameworkStage: source,
      workingDraftStage: existingStage,
      grrExecution,
      grrArtifact,
    })

    const result = await executeOutcomeWorkingDraft(args)
    expect(result.idempotent).toBe(true)
    expect(result.stage.stageExecutionId).toBe(existingStage.stageExecutionId)
    expect(args.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
    expect(args.deps.createOutcomeQualityStageExecution).not.toHaveBeenCalled()

    const tampered = executeArgs({
      plan,
      frameworkStage: source,
      workingDraftStage: existingStage,
      grrExecution,
      grrArtifact: { ...grrArtifact, generatedOutput: { ...grrArtifact.generatedOutput, title: 'Tampered QA' } },
    })
    await expect(executeOutcomeWorkingDraft(tampered))
      .rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_LINEAGE_INVALID' })
  })

  test('rejects provider output that claims approval or later-stage state before stage success', async () => {
    const plan = makePlan()
    const output = providerOutput(plan)
    output.approvedMeaning = { state: 'APPROVED' }
    const createGrr = jest.fn(async () => ({
      ...makeGrrSuccess(plan),
      artifact: {
        runtimeArtifactId: 'grr_art_working_draft',
        generatedOutput: output,
      },
    }))
    const args = executeArgs({ plan, createGrr })

    await expect(executeOutcomeWorkingDraft(args))
      .rejects.toMatchObject({ code: 'OUTCOME_WORKING_DRAFT_EXECUTION_INVALID' })
    expect(args.deps.createOutcomeQualityStageExecution).not.toHaveBeenCalled()
  })
})
