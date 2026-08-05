import { createHash } from 'node:crypto'

import mongoose from 'mongoose'
import { afterEach, describe, expect, jest, test } from '@jest/globals'

import {
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS,
  OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
} from '../constants/outcomeGovernedQuality.js'
import KnowledgePackVersion from '../models/KnowledgePackVersion.js'
import {
  buildOutcomeKnowledgeCompositionPlanCandidate,
  hashOutcomeKnowledgeCompositionSemanticValue,
} from '../services/outcomeKnowledgeCompositionPlanService.js'
import {
  buildOutcomeQualityStageExecutionCandidate,
  hashOutcomeQualityStageValue,
} from '../services/outcomeQualityStageExecutionService.js'
import {
  buildOutcomeStudioProviderSafeRequest,
} from '../services/outcomeStudioProviderSafeContextService.js'
import { createOpenAiOutcomeFrameworkGuidanceProviderAdapter } from '../services/openAiOutcomeFrameworkGuidanceProviderAdapter.js'
import { executeOutcomeFrameworkGuidance } from '../services/outcomeFrameworkGuidanceExecutionService.js'
import {
  findOutcomeFrameworkGuidanceStageClaim,
  OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_ID_VALUES,
} from '../utils/outcomeFrameworkGuidanceStageClaims.js'

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
const descriptor = {
  providerKey: 'openai',
  model: 'approved-test-model',
  providerMode: 'LIVE_TEST',
  environment: 'TEST',
  safeContextPolicyKey: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
  failurePosture: 'FAIL_CLOSED',
}

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
      customer_context: makeSection('customer_context', 'a', 'Parlon serves regulated decision makers who require clear evidence and qualification.'),
      strategic_objectives: makeSection('strategic_objectives', 'b', 'Parlon intends to improve decision speed while preserving confidence and traceability.'),
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
  activationId: `kpa-${packKey}`,
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

const makePlan = (runtime = makeRuntime()) => {
  const candidate = buildOutcomeKnowledgeCompositionPlanCandidate({
    runtime,
    binding: makeBinding(),
    context: makeContext(),
    consumerIntent: {
      outcome: 'One Parlon Executive Brief',
      decisionPurpose: 'Support an executive sponsor decision with governed meaning.',
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

const makeLegacyPlan = ({ acceptedLeaf = false, runtime = makeRuntime() } = {}) => {
  const plan = makePlan(runtime)
  plan.payload = structuredClone(plan.payload)
  delete plan.payload.lockedTruth.acceptedTruthIdentityContractVersion
  plan.payload.lockedTruth.acceptedSections.forEach((section) => {
    section.sectionKey = section.stateSectionKey
    delete section.stateSectionKey
    if (acceptedLeaf) section.runtimePath = `${section.runtimePath}.accepted`
  })
  plan.planFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(plan.payload)
  return plan
}

const makeOutput = (plan = makePlan()) => {
  const assigned = plan.payload.stagePlan.find((stage) => (
    stage.stageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
  )).assignedActivationIds
  const truth = plan.payload.lockedTruth.acceptedSections.map((section) => section.sectionKey)
  return {
    outputType: 'FRAMEWORK_GUIDANCE_ANALYSIS',
    schemaVersion: OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
    title: 'Parlon decision analysis QA',
    sections: truth.map((sectionKey, index) => ({
      order: index + 1,
      sectionKey: `analysis_${index + 1}`,
      title: `Decision area ${index + 1}`,
      analysis: `The verified information for ${sectionKey} has a material decision implication.`,
      implications: ['Leadership should test the consequence against the stated objective.'],
      recommendations: ['Use the verified information to sequence the next decision.'],
      qualification: 'The analysis remains bounded by the supplied information.',
      truthReferences: [sectionKey],
      contributingActivationIds: [...assigned],
      assumptions: [],
      gaps: [],
    })),
    decisionUsefulness: {
      summary: 'The analysis identifies the main decision priorities and their qualifications.',
      priorities: ['Confirm the primary decision and sequence the supporting actions.'],
      materialRisks: ['Unspecified delivery choices remain visible.'],
      recommendedNextStep: 'Review the analytical meaning before any draft is created.',
    },
    assumptions: [],
    visibleGaps: [...plan.payload.consumerIntent.unresolvedGaps],
  }
}

const makeModels = ({ plan = makePlan(), runtime = makeRuntime(), latestStage = null } = {}) => ({
  OutcomeKnowledgeCompositionPlan: {
    findOne: jest.fn((filter) => {
      if (filter._id) return { lean: jest.fn().mockResolvedValue(plan) }
      return { sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(plan) }) }
    }),
  },
  RuntimeInstance: {
    findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(runtime) }),
  },
  OutcomeQualityStageExecution: {
    findOne: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(latestStage) }),
    }),
  },
  GovernedReasoningExecution: { findOne: jest.fn() },
  GovernedRuntimeArtifact: { findOne: jest.fn() },
})

const mockPackVersions = (plan = makePlan(), { hashOverride = null } = {}) => {
  const assigned = new Set(plan.payload.stagePlan.find((stage) => (
    stage.stageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
  )).assignedActivationIds)
  const versions = plan.payload.resolution.selectedPacks.filter((pack) => assigned.has(pack.activationId)).map((pack, index) => ({
    versionId: pack.versionId,
    contentHash: index === 0 && hashOverride ? hashOverride : pack.contentHash,
    content: `# Validation Criteria\nApply validation rule ${index + 1} only to the supplied information.`,
  }))
  const lean = jest.fn().mockResolvedValue(versions)
  const select = jest.fn().mockReturnValue({ lean })
  jest.spyOn(KnowledgePackVersion, 'find').mockReturnValue({ select })
  return versions
}

const truthSource = (runtime = makeRuntime()) => ({
  acceptedTruth: Object.values(runtime.framework_state.sections).map((section) => ({
    label: 'Verified information',
    content: section.accepted.content,
  })),
})

const makeSuccessGrr = (plan = makePlan()) => ({
  executionId: 'grr_exec_framework_guidance_qa',
  requestedAt: '2026-08-03T10:00:00.000Z',
  completedAt: '2026-08-03T10:00:04.000Z',
  provider: {
    providerKey: 'openai',
    model: 'approved-test-model',
    providerMode: 'LIVE_TEST',
    liveProvider: true,
  },
  artifact: {
    runtimeArtifactId: 'grr_art_framework_guidance_qa',
    generatedOutput: makeOutput(plan),
  },
})

const configuredProviderAdapter = (
  adapter = jest.fn(),
  configurationVersion = OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
) => {
  Object.defineProperty(adapter, 'configurationVersion', {
    value: configurationVersion,
    enumerable: false,
  })
  return adapter
}

const executeArgs = ({
  adapterConfigurationVersion = OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
  plan = makePlan(),
  runtime = makeRuntime(),
  latestStage = null,
  overrides = {},
} = {}) => {
  const models = makeModels({ plan, runtime, latestStage })
  const providerAdapter = configuredProviderAdapter(jest.fn(), adapterConfigurationVersion)
  return {
    args: {
      actorUserId: ids.actor,
      auditRequest: { requestId: 'qa-request' },
      expectedPlanFingerprint: plan.planFingerprint,
      planRecordId: ids.plan,
      providerAdapterFactory: jest.fn().mockReturnValue(providerAdapter),
      providerDescriptor: descriptor,
      runtimeInstanceId: ids.runtime,
      scopes: { user: { id: ids.actor } },
      deps: {
        ...models,
        assertOutcomeQualityStageTransactionSupport: jest.fn(),
        createGovernedReasoningExecution: jest.fn().mockResolvedValue(makeSuccessGrr(plan)),
        createOutcomeQualityStageExecution: jest.fn().mockImplementation(async (input) => ({
          idempotent: false,
          execution: { attemptFingerprint: input.expectedAttemptFingerprint, status: input.status },
        })),
      },
      ...overrides,
    },
    models,
  }
}

const makeNonRetryableProviderStage = ({
  plan = makePlan(),
  failureCode = 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
  providerConfigurationVersion = OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V1,
  legacyConfigurationIdentity = false,
  providerKey = descriptor.providerKey,
  model = descriptor.model,
  retryable = false,
} = {}) => {
  const candidate = buildOutcomeQualityStageExecutionCandidate({
    plan,
    runtimeInstanceId: ids.runtime,
    expectedPlanFingerprint: plan.planFingerprint,
    stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    expectedLatestAttemptNumber: 0,
    status: OUTCOME_QUALITY_STAGE_STATUSES.FAILED,
    failure: {
      failureCode,
      safeReason: 'The governed provider attempt failed.',
      retryable,
    },
    executionIdentity: {
      executionMode: 'LIVE_TEST',
      providerKey,
      providerConfigurationVersion,
      model,
      grrExecutionId: '',
      grrRuntimeArtifactId: '',
      runtimeVersion: runtimeUpdatedAt,
    },
    startedAt: '2026-08-03T10:00:00.000Z',
    completedAt: '2026-08-03T10:00:01.000Z',
  })
  const stage = {
    _id: ids.stage,
    stageExecutionId: 'outcome_quality_stage_provider_failure_qa',
    createdBy: ids.actor,
    createdAt: new Date('2026-08-03T10:00:01.500Z'),
    ...candidate,
  }
  if (legacyConfigurationIdentity) delete stage.executionIdentity.providerConfigurationVersion
  return stage
}

const expectBindingRejectedBeforeDownstream = async ({ plan, runtime, field }) => {
  const { args } = executeArgs({ plan, runtime })
  await expect(executeOutcomeFrameworkGuidance(args)).rejects.toMatchObject({
    code: 'OUTCOME_FRAMEWORK_GUIDANCE_BINDING_INVALID',
    ...(field ? { details: expect.objectContaining({ field }) } : {}),
  })
  expect(args.providerAdapterFactory).not.toHaveBeenCalled()
  expect(args.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
  expect(args.deps.createOutcomeQualityStageExecution).not.toHaveBeenCalled()
}

const semanticSection = (anchorActivationId, suffix) => ({
  title: `Decision context ${suffix}`,
  analysis: 'The verified information supports a focused decision sequence.',
  implications: ['Leadership can concentrate on the highest-value decision first.'],
  recommendations: ['Sequence the next action against the verified objective.'],
  qualification: 'The assessment is limited to the supplied information.',
  anchorActivationId,
  assumptions: [],
  gaps: [],
})

const semanticProviderOutput = {
  title: 'Parlon decision analysis QA',
  sections: {
    customer_context: semanticSection('kpa-blocking-rules', 'one'),
    strategic_objectives: semanticSection('kpa-truth-certification-pack', 'two'),
  },
  activationCoverage: {
    'kpa-blocking-rules': { sectionKeys: ['customer_context'] },
    'kpa-truth-certification-pack': { sectionKeys: ['strategic_objectives'] },
  },
  decisionUsefulness: {
    summary: 'The analysis clarifies the immediate decision and material constraints.',
    priorities: ['Confirm the decision sequence.'],
    materialRisks: ['Delivery choices remain unspecified.'],
    recommendedNextStep: 'Review the analytical meaning before drafting.',
  },
  assumptions: [],
}

const providerBody = (output = semanticProviderOutput) => ({
  id: 'resp_framework_qa',
  created_at: 1784707200,
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 1000, output_tokens: 600, total_tokens: 1600 },
})

const response = ({ body = providerBody(), status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: jest.fn().mockReturnValue('req_framework_qa') },
  json: jest.fn().mockResolvedValue(body),
})

const outputContract = {
  truthReferenceKeys: ['customer_context', 'strategic_objectives'],
  activationReferenceIds: ['kpa-blocking-rules', 'kpa-truth-certification-pack'],
  visibleGaps: ['Exact delivery file type is not specified', 'Exact delivery channel is not specified'],
}

const expectSafeOutputDiagnostic = (error, expected) => {
  expect(error).toMatchObject({
    code: 'OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_FAILED',
    details: {
      reason: 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      diagnostic: {
        diagnosticSchemaVersion: 2,
        adapterConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
        providerLifecycleStatus: 'completed',
        failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
        rawProviderBodyPersisted: false,
        rawProviderOutputPersisted: false,
        rawParlonContentPersisted: false,
        ...expected,
      },
    },
  })
  expect(error.message).toBe('The governed framework and guidance provider could not complete this request.')
  const diagnostic = error.details.diagnostic
  const commonKeys = [
    'diagnosticSchemaVersion', 'adapterConfigurationVersion', 'providerLifecycleStatus',
    'failureCode', 'diagnosticClass', 'diagnosticSubcode', 'rawProviderBodyPersisted',
    'rawProviderOutputPersisted', 'rawParlonContentPersisted',
  ]
  const fieldKeysByClass = {
    OUTPUT_EXTRACTION: ['providerOutputTextCount', 'providerOutputTextLengthBucket'],
    OUTPUT_JSON_PARSE: ['providerOutputTextCount', 'providerOutputTextLengthBucket'],
    OUTPUT_SCHEMA: [
      'providerOutputTextCount', 'providerOutputTextLengthBucket', 'schemaIssueCount',
      'issueCodes', 'issuePathClasses',
    ],
    REFERENCE_CONTRACT: ['duplicateReferenceCount', 'unknownReferenceCount'],
    PROHIBITED_STAGE_CLAIM: ['patternId', 'fieldPathClass'],
  }
  expect(Object.keys(diagnostic).sort()).toEqual([
    ...commonKeys,
    ...fieldKeysByClass[diagnostic.diagnosticClass],
  ].sort())
  Object.entries(diagnostic).forEach(([key, value]) => {
    if (key.endsWith('Count')) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1000)
    }
  })
  if (diagnostic.diagnosticClass === 'OUTPUT_SCHEMA') {
    expect(diagnostic.issueCodes.every((value) => (
      /^(?:REQUIRED_FIELD_MISSING|UNRECOGNIZED_FIELD|TYPE_MISMATCH|STRING_BOUNDARY|ARRAY_BOUNDARY|STRICT_OBJECT_FAILURE)$/.test(value)
    ))).toBe(true)
    expect(diagnostic.issuePathClasses.every((value) => (
      /^(?:root|title|assumptions|sections\.\*(?:\.(?:title|analysis|implications|recommendations|qualification|anchorActivationId|assumptions|gaps))?|activationCoverage\.\*(?:\.sectionKeys)?|decisionUsefulness(?:\.(?:summary|priorities|materialRisks|recommendedNextStep))?)$/.test(value)
    ))).toBe(true)
  }
}

const makeAdapter = ({
  completionTimeoutMs = 60000,
  fetchImpl,
  maxRetries = 0,
  now = Date.now,
  outputContract: adapterOutputContract = outputContract,
  pollIntervalMs = 100,
  sleep = jest.fn(),
} = {}) => createOpenAiOutcomeFrameworkGuidanceProviderAdapter({
  apiKey: 'test-secret-not-real',
  completionTimeoutMs,
  fetchImpl,
  maxOutputTokens: 4000,
  maxRetries,
  model: descriptor.model,
  now,
  outputContract: adapterOutputContract,
  pollIntervalMs,
  providerKey: descriptor.providerKey,
  sleep,
  timeoutMs: 5000,
})

afterEach(() => jest.restoreAllMocks())

describe('OpenAI framework/guidance provider profile', () => {
  test('classifies only the closed five stage-claim IDs without returning matched text', () => {
    expect(OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_ID_VALUES).toEqual([
      'APPROVED_MEANING_TERM',
      'APPROVED_MEANING_CLAIM',
      'FINAL_ASSET_CLAIM',
      'LATER_QUALITY_STAGE_CLAIM',
      'OUT_OF_SCOPE_DELIVERY_CLAIM',
    ])
    for (const [text, expected] of [
      ['The approved meaning is complete.', 'APPROVED_MEANING_TERM'],
      ['Meaning is approved.', 'APPROVED_MEANING_CLAIM'],
      ['This records approval of the meaning.', 'APPROVED_MEANING_CLAIM'],
      ['The final candidate is ready.', 'FINAL_ASSET_CLAIM'],
      ['The final asset has been published.', 'FINAL_ASSET_CLAIM'],
      ['Working Draft is complete.', 'LATER_QUALITY_STAGE_CLAIM'],
      ['The presentation is ready.', 'OUT_OF_SCOPE_DELIVERY_CLAIM'],
      ['Meaning still requires ARL approval.', null],
      ['This framework is not approved meaning.', null],
      ['Output shaping occurs only after ARL-approved meaning.', null],
      ['The approved source policy remains bounded evidence.', null],
      ['The board approved the source policy in 2024.', null],
    ]) {
      expect(findOutcomeFrameworkGuidanceStageClaim(text)).toBe(expected)
    }
  })

  test('sends one bounded strict request and assembles server-owned stage fields', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response())
    const adapter = makeAdapter({ fetchImpl })
    const result = await adapter({
      providerContext: {
        businessRequest: { instruction: 'Analyse the verified information.' },
        truthSummaries: [{ label: 'customer_context', summary: 'A verified customer context.' }],
        guidance: { validationCriteria: ['Preserve qualification.'] },
        safeguards: ['FAIL_CLOSED_ON_UNSAFE_CONTEXT'],
      },
    })
    const [, options] = fetchImpl.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body).toMatchObject({
      model: descriptor.model,
      background: true,
      store: false,
      reasoning: { effort: 'none' },
      max_output_tokens: 4000,
    })
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(body.text.format.name).toBe('framework_guidance_analysis_v2')
    expect(body.text.format.schema.properties.sections.required).toEqual(outputContract.truthReferenceKeys)
    expect(body.text.format.schema.properties.activationCoverage.required)
      .toEqual(outputContract.activationReferenceIds)
    expect(body.text.format.schema.properties.sections.properties.customer_context
      .properties.anchorActivationId.enum).toEqual(outputContract.activationReferenceIds)
    expect(options.headers.Authorization).toBe('Bearer test-secret-not-real')
    expect(options.headers['Idempotency-Key']).toMatch(/^[a-f0-9]{64}$/)
    expect(result.output).toMatchObject({
      outputType: 'FRAMEWORK_GUIDANCE_ANALYSIS',
      schemaVersion: OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
      visibleGaps: outputContract.visibleGaps,
    })
    expect(result.output.sections[0].order).toBe(1)
    expect(result.output.sections.map(({ sectionKey }) => sectionKey)).toEqual(outputContract.truthReferenceKeys)
    expect(result.output.sections.every(({ contributingActivationIds }) => (
      contributingActivationIds.length >= 1
    ))).toBe(true)
    expect(adapter.configurationVersion).toBe(OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION)
    expect(result.limitations).toEqual(outputContract.visibleGaps)
    expect(result.metadata).toMatchObject({
      requestIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
      httpRequestId: 'req_framework_qa',
      responseId: 'resp_framework_qa',
      terminalStatus: 'completed',
      storeRequested: false,
      temporaryProviderStorageForPolling: true,
    })
    expect(result.metadata).not.toHaveProperty('storedByProvider')
    expect(result).not.toHaveProperty('diagnostic')
    expect(result.metadata).not.toHaveProperty('diagnostic')
    expect(JSON.stringify(result)).not.toContain('test-secret-not-real')
  })

  test('freezes the hardened pre-ARL request under the active V6 diagnostics identity', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response())
    const adapter = makeAdapter({ fetchImpl })
    const result = await adapter({ providerContext: {} })
    const [, options] = fetchImpl.mock.calls[0]
    const requestHash = createHash('sha256').update(options.body).digest('hex')
    expect(requestHash).toBe('47c3c1b9f7d1658ac3af779e227950d5fa6c37e4e1045d980e4be9eb20cbb998')
    expect(options.headers['Idempotency-Key']).toBe(requestHash)
    const requestBody = JSON.parse(options.body)
    expect(requestBody.instructions).toContain('Framework Guidance occurs before ARL review')
    expect(requestBody.instructions).toContain('remain unapproved')
    expect(requestBody.instructions).toContain('ARL approval is still required downstream')
    expect(requestBody.instructions).toContain('approved source evidence and historical source approvals')
    expect(result.metadata.configurationVersion)
      .toBe(OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS)
    expect(result).not.toHaveProperty('diagnostic')
    expect(result.metadata).not.toHaveProperty('diagnostic')
  })

  test.each([
    ['completion timeout', { completionTimeoutMs: 59999 }],
    ['polling interval', { pollIntervalMs: 99 }],
    ['clock', { now: 'not-a-function' }],
  ])('rejects invalid %s before fetch', (_label, adapterOverrides) => {
    const fetchImpl = jest.fn()
    expect(() => makeAdapter({ fetchImpl, ...adapterOverrides })).toThrow(TypeError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('fails before fetch when the injected clock returns a non-finite value', async () => {
    const fetchImpl = jest.fn()
    const adapter = makeAdapter({ fetchImpl, now: () => Number.NaN })
    await expect(adapter({ providerContext: {} })).rejects.toThrow(TypeError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('uses one deterministic provider idempotency identity across identical calls', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response())
    const adapter = makeAdapter({ fetchImpl })
    const context = {
      businessRequest: { instruction: 'Analyse the verified information.' },
      truthSummaries: [],
      guidance: {},
      safeguards: [],
    }
    await adapter({ providerContext: context })
    await adapter({ providerContext: context })
    expect(fetchImpl.mock.calls[0][1].headers['Idempotency-Key'])
      .toBe(fetchImpl.mock.calls[1][1].headers['Idempotency-Key'])
  })

  test('rejects prohibited direct reference classes in truthReferenceKeys before fetch', () => {
    const fetchImpl = jest.fn()
    const prohibitedReferences = [
      '6a6c8115bb9cebc18a1eca9c',
      'ref-6a6c8115bb9cebc18a1eca9c',
      '280e08e8-1d02-4ec0-8e20-1815c06dbc93',
      'ref-280e08e8-1d02-4ec0-8e20-1815c06dbc93',
      'a'.repeat(64),
      'manifest',
      'rule-manifest-source',
      'activation',
      'rule.activation.source',
    ]
    prohibitedReferences.forEach((reference) => {
      expect(() => makeAdapter({
        fetchImpl,
        outputContract: { ...outputContract, truthReferenceKeys: [reference] },
      })).toThrow(TypeError)
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('rejects prohibited direct reference classes in activationReferenceIds before fetch', () => {
    const fetchImpl = jest.fn()
    const prohibitedReferences = [
      '6a6c8115bb9cebc18a1eca9c',
      'ref-6a6c8115bb9cebc18a1eca9c',
      '280e08e8-1d02-4ec0-8e20-1815c06dbc93',
      'ref-280e08e8-1d02-4ec0-8e20-1815c06dbc93',
      'a'.repeat(64),
      'manifest',
      'rule-manifest-source',
      'activation',
      'rule.activation.source',
    ]
    prohibitedReferences.forEach((reference) => {
      expect(() => makeAdapter({
        fetchImpl,
        outputContract: { ...outputContract, activationReferenceIds: [reference] },
      })).toThrow(TypeError)
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('retains FRAMEWORK_GUIDANCE_PROVIDER_RESPONSE_INVALID for unreadable JSON without response leakage', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: jest.fn().mockReturnValue('req_framework_invalid_json_qa') },
      json: jest.fn().mockRejectedValue(new SyntaxError('secret malformed response content')),
    })
    const adapter = makeAdapter({ fetchImpl })
    const caught = await adapter({
      providerContext: { businessRequest: {}, truthSummaries: [], guidance: {}, safeguards: [] },
    }).catch((error) => error)
    expect(caught).toMatchObject({
      code: 'OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_FAILED',
      details: { reason: 'FRAMEWORK_GUIDANCE_PROVIDER_RESPONSE_INVALID' },
    })
    expect(caught.message).not.toContain('secret malformed response content')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('classifies multiple output texts without retaining either output', async () => {
    const body = providerBody()
    body.output[0].content.push({
      type: 'output_text',
      text: '{"forbidden":"SECOND_OUTPUT_SECRET_QA"}',
    })
    const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body })) })
    const caught = await adapter({ providerContext: {} }).catch((error) => error)
    expectSafeOutputDiagnostic(caught, {
      diagnosticClass: 'OUTPUT_EXTRACTION',
      diagnosticSubcode: 'MULTIPLE_OUTPUT_TEXTS',
      providerOutputTextCount: 2,
    })
    expect(JSON.stringify(caught)).not.toContain('SECOND_OUTPUT_SECRET_QA')
    expect(JSON.stringify(caught)).not.toContain(semanticProviderOutput.title)
  })

  test('classifies malformed JSON without retaining raw text or parse details', async () => {
    const body = providerBody()
    body.output[0].content[0].text = '{"forbidden":"MALFORMED_OUTPUT_SECRET_QA"'
    const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body })) })
    const caught = await adapter({ providerContext: {} }).catch((error) => error)
    expectSafeOutputDiagnostic(caught, {
      diagnosticClass: 'OUTPUT_JSON_PARSE',
      diagnosticSubcode: 'MALFORMED_JSON',
      providerOutputTextCount: 1,
      providerOutputTextLengthBucket: '1_TO_1024',
    })
    const serialized = JSON.stringify(caught)
    expect(serialized).not.toContain('MALFORMED_OUTPUT_SECRET_QA')
    expect(serialized).not.toContain('SyntaxError')
    expect(serialized).not.toContain('Unexpected')
  })

  test.each([
    ['missing required field', {
      sections: semanticProviderOutput.sections,
      activationCoverage: semanticProviderOutput.activationCoverage,
      decisionUsefulness: semanticProviderOutput.decisionUsefulness,
      assumptions: semanticProviderOutput.assumptions,
    }, 'REQUIRED_FIELD_MISSING'],
    ['unrecognized field', {
      ...semanticProviderOutput,
      forbiddenSchemaField: 'SCHEMA_OUTPUT_SECRET_QA',
    }, 'UNRECOGNIZED_FIELD'],
    ['wrong type', { ...semanticProviderOutput, title: 42 }, 'TYPE_MISMATCH'],
    ['string boundary', { ...semanticProviderOutput, title: 'x'.repeat(256) }, 'STRING_BOUNDARY'],
    ['array boundary', {
      ...semanticProviderOutput,
      assumptions: Array.from({ length: 21 }, () => 'bounded assumption'),
    }, 'ARRAY_BOUNDARY'],
  ])('classifies %s schema failure without values or raw schema messages', async (
    _label, output, expectedSubcode,
  ) => {
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body: providerBody(output) })),
    })
    const caught = await adapter({ providerContext: {} }).catch((error) => error)
    expectSafeOutputDiagnostic(caught, {
      diagnosticClass: 'OUTPUT_SCHEMA',
      diagnosticSubcode: expectedSubcode,
      schemaIssueCount: expect.any(Number),
      issueCodes: expect.arrayContaining([expectedSubcode]),
      issuePathClasses: expect.any(Array),
    })
    const serialized = JSON.stringify(caught)
    expect(serialized).not.toContain('SCHEMA_OUTPUT_SECRET_QA')
    expect(serialized).not.toContain('forbiddenSchemaField')
    expect(serialized).not.toContain('received')
    expect(serialized).not.toContain('expected')
  })

  test.each([
    ['missing truth section', {
      ...semanticProviderOutput,
      sections: { customer_context: semanticProviderOutput.sections.customer_context },
    }, 'OUTPUT_SCHEMA', 'REQUIRED_FIELD_MISSING'],
    ['missing activation coverage', {
      ...semanticProviderOutput,
      activationCoverage: {
        'kpa-blocking-rules': semanticProviderOutput.activationCoverage['kpa-blocking-rules'],
      },
    }, 'OUTPUT_SCHEMA', 'REQUIRED_FIELD_MISSING'],
    ['missing section anchor and no mapped activation', {
      ...semanticProviderOutput,
      sections: {
        ...semanticProviderOutput.sections,
        strategic_objectives: {
          ...semanticProviderOutput.sections.strategic_objectives,
          anchorActivationId: undefined,
        },
      },
      activationCoverage: {
        'kpa-blocking-rules': { sectionKeys: ['customer_context'] },
        'kpa-truth-certification-pack': { sectionKeys: ['customer_context'] },
      },
    }, 'OUTPUT_SCHEMA', 'REQUIRED_FIELD_MISSING'],
    ['invalid section anchor', {
      ...semanticProviderOutput,
      sections: {
        ...semanticProviderOutput.sections,
        customer_context: {
          ...semanticProviderOutput.sections.customer_context,
          anchorActivationId: 'invented-activation',
        },
      },
    }, 'REFERENCE_CONTRACT', 'UNKNOWN_ANCHOR_ACTIVATION'],
    ['invented activation coverage section', {
      ...semanticProviderOutput,
      activationCoverage: {
        ...semanticProviderOutput.activationCoverage,
        'kpa-blocking-rules': { sectionKeys: ['invented-section'] },
      },
    }, 'REFERENCE_CONTRACT', 'UNKNOWN_SECTION_KEY'],
    ['duplicate activation coverage section', {
      ...semanticProviderOutput,
      activationCoverage: {
        ...semanticProviderOutput.activationCoverage,
        'kpa-blocking-rules': { sectionKeys: ['customer_context', 'customer_context'] },
      },
    }, 'REFERENCE_CONTRACT', 'DUPLICATE_SECTION_KEY', null],
    ['approved-meaning disposition claim', {
      ...semanticProviderOutput,
      title: 'The approved meaning is complete.',
    }, 'PROHIBITED_STAGE_CLAIM', 'PROHIBITED_STAGE_CLAIM_DETECTED', 'APPROVED_MEANING_TERM', 'title'],
    ['current meaning approval claim', {
      ...semanticProviderOutput,
      title: 'Meaning is approved.',
    }, 'PROHIBITED_STAGE_CLAIM', 'PROHIBITED_STAGE_CLAIM_DETECTED', 'APPROVED_MEANING_CLAIM', 'title'],
    ['meaning approval record claim', {
      ...semanticProviderOutput,
      title: 'This records approval of the meaning.',
    }, 'PROHIBITED_STAGE_CLAIM', 'PROHIBITED_STAGE_CLAIM_DETECTED', 'APPROVED_MEANING_CLAIM', 'title'],
    ['final candidate claim', {
      ...semanticProviderOutput,
      title: 'The final candidate is ready.',
    }, 'PROHIBITED_STAGE_CLAIM', 'PROHIBITED_STAGE_CLAIM_DETECTED', 'FINAL_ASSET_CLAIM', 'title'],
    ['final asset publication claim', {
      ...semanticProviderOutput,
      title: 'The final asset has been published.',
    }, 'PROHIBITED_STAGE_CLAIM', 'PROHIBITED_STAGE_CLAIM_DETECTED', 'FINAL_ASSET_CLAIM', 'title'],
    ['later-stage claim', {
      ...semanticProviderOutput,
      title: 'Working Draft is complete',
    }, 'PROHIBITED_STAGE_CLAIM', 'PROHIBITED_STAGE_CLAIM_DETECTED', 'LATER_QUALITY_STAGE_CLAIM', 'title'],
    ['out-of-scope delivery claim', {
      ...semanticProviderOutput,
      title: 'The presentation is ready.',
    }, 'PROHIBITED_STAGE_CLAIM', 'PROHIBITED_STAGE_CLAIM_DETECTED', 'OUT_OF_SCOPE_DELIVERY_CLAIM', 'title'],
  ])('fails closed with safe diagnostics for %s', async (
    _label, output, diagnosticClass, diagnosticSubcode, expectedPatternId = null, expectedFieldPathClass = null,
  ) => {
    const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body: providerBody(output) })) })
    const caught = await adapter({
      providerContext: { businessRequest: {}, truthSummaries: [], guidance: {}, safeguards: [] },
    }).catch((error) => error)
    expectSafeOutputDiagnostic(caught, { diagnosticClass, diagnosticSubcode })
    if (diagnosticClass === 'PROHIBITED_STAGE_CLAIM') {
      expect(caught.details.diagnostic.patternId).toBe(expectedPatternId)
      expect(caught.details.diagnostic.fieldPathClass).toBe(expectedFieldPathClass)
      expect(JSON.stringify(caught)).not.toContain(output.title)
    }
    if (diagnosticClass === 'REFERENCE_CONTRACT') {
      expect(caught.details.diagnostic).toMatchObject({
        duplicateReferenceCount: expect.any(Number),
        unknownReferenceCount: expect.any(Number),
      })
    }
    expect(JSON.stringify(caught)).not.toContain('invented-activation')
    expect(JSON.stringify(caught)).not.toContain('invented-section')
    expect(JSON.stringify(caught)).not.toContain('Working Draft is complete')
  })

  test.each([
    ['section title', (output) => { output.sections.customer_context.title = 'Meaning is approved.' }, 'sections.*.title'],
    ['section analysis', (output) => { output.sections.customer_context.analysis = 'Meaning is approved.' }, 'sections.*.analysis'],
    ['section implication', (output) => { output.sections.customer_context.implications[0] = 'Meaning is approved.' }, 'sections.*.implications'],
    ['section recommendation', (output) => { output.sections.customer_context.recommendations[0] = 'Meaning is approved.' }, 'sections.*.recommendations'],
    ['section qualification', (output) => { output.sections.customer_context.qualification = 'Meaning is approved.' }, 'sections.*.qualification'],
    ['section assumption', (output) => { output.sections.customer_context.assumptions = ['Meaning is approved.'] }, 'sections.*.assumptions'],
    ['section gap', (output) => { output.sections.customer_context.gaps = ['Meaning is approved.'] }, 'sections.*.gaps'],
    ['decision summary', (output) => { output.decisionUsefulness.summary = 'Meaning is approved.' }, 'decisionUsefulness.summary'],
    ['decision priority', (output) => { output.decisionUsefulness.priorities[0] = 'Meaning is approved.' }, 'decisionUsefulness.priorities'],
    ['decision risk', (output) => { output.decisionUsefulness.materialRisks = ['Meaning is approved.'] }, 'decisionUsefulness.materialRisks'],
    ['decision next step', (output) => { output.decisionUsefulness.recommendedNextStep = 'Meaning is approved.' }, 'decisionUsefulness.recommendedNextStep'],
    ['root assumption', (output) => { output.assumptions = ['Meaning is approved.'] }, 'assumptions'],
  ])('reports only the safe field class for an approval claim in %s', async (_label, mutate, fieldPathClass) => {
    const output = structuredClone(semanticProviderOutput)
    mutate(output)
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body: providerBody(output) })),
    })
    const caught = await adapter({ providerContext: {} }).catch((error) => error)
    expectSafeOutputDiagnostic(caught, {
      diagnosticClass: 'PROHIBITED_STAGE_CLAIM',
      diagnosticSubcode: 'PROHIBITED_STAGE_CLAIM_DETECTED',
      patternId: 'APPROVED_MEANING_CLAIM',
      fieldPathClass,
    })
    const serialized = JSON.stringify(caught)
    expect(serialized).not.toContain('Meaning is approved.')
    expect(serialized).not.toContain('customer_context')
    expect(serialized).not.toContain('kpa-blocking-rules')
  })

  test.each([
    ['pending approval', 'Meaning still requires ARL approval.'],
    ['explicit negation', 'This framework is not approved meaning.'],
    ['governed sequencing', 'Output shaping occurs only after ARL-approved meaning.'],
    ['accepted source', 'The approved source policy remains bounded evidence.'],
    ['historical source approval', 'The board approved the source policy in 2024.'],
  ])('permits %s language without weakening the provider boundary', async (_label, title) => {
    const output = { ...semanticProviderOutput, title }
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({ body: providerBody(output) })),
    })
    await expect(adapter({ providerContext: {} })).resolves.toMatchObject({
      output: { title },
    })
  })

  test('retries transient responses at most twice with the same request identity', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ status: 429 }))
      .mockResolvedValueOnce(response({ status: 503 }))
      .mockResolvedValueOnce(response())
    const sleep = jest.fn().mockResolvedValue()
    const adapter = makeAdapter({ fetchImpl, maxRetries: 2, sleep })
    await adapter({ providerContext: { businessRequest: {}, truthSummaries: [], guidance: {}, safeguards: [] } })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[250], [500]])
    expect(new Set(fetchImpl.mock.calls.map((call) => call[1].headers['Idempotency-Key'])).size).toBe(1)
  })

  test('retries a pre-ID network failure with the same create identity', async () => {
    const networkError = new Error('socket reset')
    networkError.code = 'ECONNRESET'
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(response())
    const adapter = makeAdapter({ fetchImpl, maxRetries: 1 })
    await adapter({ providerContext: {} })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.map(([url, options]) => ({
      url,
      method: options.method,
      key: options.headers['Idempotency-Key'],
    }))).toEqual([
      expect.objectContaining({ method: 'POST', key: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ method: 'POST', key: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ])
    expect(fetchImpl.mock.calls[0][1].headers['Idempotency-Key'])
      .toBe(fetchImpl.mock.calls[1][1].headers['Idempotency-Key'])
  })

  test('polls the exact background response through queued and in-progress states', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: { ...providerBody(), status: 'queued', output: [] } }))
      .mockResolvedValueOnce(response({ body: { ...providerBody(), status: 'in_progress', output: [] } }))
      .mockResolvedValueOnce(response())
    const sleep = jest.fn().mockResolvedValue()
    const adapter = makeAdapter({ fetchImpl, sleep })
    const result = await adapter({ providerContext: {} })
    expect(fetchImpl.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ['https://api.openai.com/v1/responses', 'POST'],
      ['https://api.openai.com/v1/responses/resp_framework_qa', 'GET'],
      ['https://api.openai.com/v1/responses/resp_framework_qa', 'GET'],
    ])
    expect(fetchImpl.mock.calls.slice(1).every(([, options]) => (
      options.headers['Idempotency-Key'] === undefined
    ))).toBe(true)
    expect(sleep.mock.calls).toEqual([[100], [100]])
    expect(result.metadata.terminalStatus).toBe('completed')
  })

  test.each([
    ['transient status', response({ status: 503 })],
    ['network error', Object.assign(new Error('poll reset'), { code: 'ECONNRESET' })],
  ])('retries a %s during retrieve without issuing another create', async (_label, failure) => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: { ...providerBody(), status: 'queued', output: [] } }))
    if (failure instanceof Error) fetchImpl.mockRejectedValueOnce(failure)
    else fetchImpl.mockResolvedValueOnce(failure)
    fetchImpl.mockResolvedValueOnce(response())
    const adapter = makeAdapter({ fetchImpl, maxRetries: 1 })
    await adapter({ providerContext: {} })
    expect(fetchImpl.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'GET', 'GET'])
    expect(fetchImpl.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
  })

  test('maps unreadable retrieve JSON to response-invalid without another create', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: { ...providerBody(), status: 'queued', output: [] } }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue('req_bad_poll_json') },
        json: jest.fn().mockRejectedValue(new SyntaxError('secret poll body')),
      })
    const adapter = makeAdapter({ fetchImpl })
    await expect(adapter({ providerContext: {} })).rejects.toMatchObject({
      details: { reason: 'FRAMEWORK_GUIDANCE_PROVIDER_RESPONSE_INVALID' },
    })
    expect(fetchImpl.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'GET'])
  })

  test.each([
    ['missing initial ID', { ...providerBody(), id: '' }],
    ['unsafe initial ID', { ...providerBody(), id: 'resp_unsafe/path?query=1' }],
  ])('rejects %s before retrieve or output parsing', async (_label, body) => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ body }))
    const adapter = makeAdapter({ fetchImpl })
    await expect(adapter({ providerContext: {} })).rejects.toMatchObject({
      details: { reason: 'FRAMEWORK_GUIDANCE_PROVIDER_RESPONSE_INVALID' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('rejects response-ID drift on retrieve', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: { ...providerBody(), status: 'queued', output: [] } }))
      .mockResolvedValueOnce(response({ body: { ...providerBody(), id: 'resp_drifted_qa' } }))
    const adapter = makeAdapter({ fetchImpl })
    await expect(adapter({ providerContext: {} })).rejects.toMatchObject({
      details: { reason: 'FRAMEWORK_GUIDANCE_PROVIDER_RESPONSE_INVALID' },
    })
    expect(fetchImpl.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'GET'])
  })

  test('maps another terminal background status to request-failed', async () => {
    const adapter = makeAdapter({
      fetchImpl: jest.fn().mockResolvedValue(response({
        body: { ...providerBody(), status: 'failed', output: [] },
      })),
    })
    await expect(adapter({ providerContext: {} })).rejects.toMatchObject({
      details: { reason: 'FRAMEWORK_GUIDANCE_PROVIDER_REQUEST_FAILED' },
    })
  })

  test('does not fetch after the overall deadline expires', async () => {
    let clock = 0
    const now = () => clock
    const sleep = jest.fn(async (delayMs) => { clock += delayMs })
    const fetchImpl = jest.fn().mockResolvedValue(response({
      body: { ...providerBody(), status: 'queued', output: [] },
    }))
    const adapter = makeAdapter({
      completionTimeoutMs: 60000,
      fetchImpl,
      now,
      pollIntervalMs: 10000,
      sleep,
    })
    await expect(adapter({ providerContext: {} })).rejects.toMatchObject({
      details: { reason: 'FRAMEWORK_GUIDANCE_PROVIDER_TIMEOUT' },
    })
    expect(clock).toBe(60000)
    expect(sleep).toHaveBeenCalledTimes(6)
    expect(fetchImpl.mock.calls.map(([, options]) => options.method)).toEqual([
      'POST', 'GET', 'GET', 'GET', 'GET', 'GET',
    ])
  })

  test('caps retrieve and cancellation request timers by the remaining overall deadline', async () => {
    let clock = 0
    const now = () => clock
    const sleep = jest.fn(async () => { clock = 56000 })
    const timeoutSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(() => ({ unref: jest.fn() }))
    jest.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {})
    const abortError = Object.assign(new Error('request timeout'), { name: 'AbortError' })
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: { ...providerBody(), status: 'queued', output: [] } }))
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(response({ body: { id: 'resp_framework_qa', status: 'cancelled' } }))
    const adapter = makeAdapter({
      completionTimeoutMs: 60000,
      fetchImpl,
      now,
      sleep,
      timeoutMs: 5000,
    })
    await expect(adapter({ providerContext: {} })).rejects.toMatchObject({
      details: { reason: 'FRAMEWORK_GUIDANCE_PROVIDER_TIMEOUT' },
    })
    expect(timeoutSpy.mock.calls.map(([, delayMs]) => delayMs)).toEqual([5000, 4000, 4000])
    expect(fetchImpl.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'GET', 'POST'])
  })

  test('makes one best-effort encoded cancel after a post-ID request timeout with budget', async () => {
    const abortError = Object.assign(new Error('request timeout'), { name: 'AbortError' })
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: { ...providerBody(), status: 'queued', output: [] } }))
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(response({
        body: { id: 'resp_framework_qa', status: 'cancelled' },
      }))
    const adapter = makeAdapter({ fetchImpl })
    await expect(adapter({ providerContext: {} })).rejects.toMatchObject({
      details: { reason: 'FRAMEWORK_GUIDANCE_PROVIDER_TIMEOUT' },
    })
    expect(fetchImpl.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ['https://api.openai.com/v1/responses', 'POST'],
      ['https://api.openai.com/v1/responses/resp_framework_qa', 'GET'],
      ['https://api.openai.com/v1/responses/resp_framework_qa/cancel', 'POST'],
    ])
  })

  test('does not let a best-effort cancellation failure replace the safe timeout', async () => {
    const abortError = Object.assign(new Error('request timeout'), { name: 'AbortError' })
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ body: { ...providerBody(), status: 'queued', output: [] } }))
      .mockRejectedValueOnce(abortError)
      .mockRejectedValueOnce(new Error('secret cancellation transport detail'))
    const adapter = makeAdapter({ fetchImpl })
    const caught = await adapter({ providerContext: {} }).catch((error) => error)
    expect(caught).toMatchObject({
      code: 'OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_FAILED',
      details: { reason: 'FRAMEWORK_GUIDANCE_PROVIDER_TIMEOUT' },
    })
    expect(caught.message).not.toContain('secret cancellation transport detail')
    expect(fetchImpl.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'GET', 'POST'])
  })

  test.each([
    ['refusal', providerBody({}), { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }, 'FRAMEWORK_GUIDANCE_PROVIDER_REFUSED'],
    ['incomplete', providerBody({}), { status: 'incomplete', output: [] }, 'FRAMEWORK_GUIDANCE_PROVIDER_RESPONSE_INCOMPLETE'],
  ])('maps %s without exposing response content', async (_label, _unused, bodyOverride, reason) => {
    const adapter = makeAdapter({ fetchImpl: jest.fn().mockResolvedValue(response({ body: { ...providerBody(), ...bodyOverride } })) })
    await expect(adapter({ providerContext: { businessRequest: {}, truthSummaries: [], guidance: {}, safeguards: [] } }))
      .rejects.toMatchObject({ code: 'OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_FAILED', details: { reason } })
  })
})

describe('framework/guidance orchestration contract', () => {
  test('binds exact KCP truth and packs through GRR before persisting one typed stage', async () => {
    const plan = makePlan()
    const runtime = makeRuntime()
    mockPackVersions(plan)
    const { args } = executeArgs({ plan, runtime })
    args.deps.createGovernedReasoningExecution.mockImplementation(async (call) => {
      expect(call.payload.idempotencyKey).toContain(plan.planId)
      expect(call.deps.resolveKnowledgeBinding).toEqual(expect.any(Function))
      const facade = await call.deps.resolveKnowledgeBinding()
      const selected = facade.binding.postValidationPacks.map(({ versionId, knowledgeLayer, executionMode }) => ({
        versionId,
        knowledgeLayer,
        executionMode,
      }))
      const safeRequest = buildOutcomeStudioProviderSafeRequest({
        providerDescriptor: descriptor,
        providerInput: call.deps.providerInput,
      })
      const safeContext = await call.deps.buildProviderSafeContext({
        providerDescriptor: descriptor,
        safeRequest,
        truthSource: truthSource(runtime),
        knowledgeSelection: selected,
      })
      expect(safeContext.draftContext).toEqual({ content: '' })
      expect(safeContext.truthSummaries.map(({ label }) => label))
        .toEqual(plan.payload.lockedTruth.acceptedSections.map(({ sectionKey }) => sectionKey))
      expect(safeContext.guidance.validationCriteria.length).toBeGreaterThan(0)
      return makeSuccessGrr(plan)
    })
    const result = await executeOutcomeFrameworkGuidance(args)
    expect(args.deps.assertOutcomeQualityStageTransactionSupport.mock.invocationCallOrder[0])
      .toBeLessThan(args.deps.createGovernedReasoningExecution.mock.invocationCallOrder[0])
    expect(args.providerAdapterFactory).toHaveBeenCalledWith(expect.objectContaining({
      providerDescriptor: descriptor,
      outputContract: expect.objectContaining({
        truthReferenceKeys: plan.payload.lockedTruth.acceptedSections.map(({ sectionKey }) => sectionKey),
      }),
    }))
    expect(args.deps.createOutcomeQualityStageExecution).toHaveBeenCalledTimes(1)
    expect(args.deps.createOutcomeQualityStageExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: 'SUCCEEDED',
      startedAt: '2026-08-03T10:00:00.000Z',
      completedAt: '2026-08-03T10:00:04.000Z',
      executionIdentity: expect.objectContaining({
        grrExecutionId: 'grr_exec_framework_guidance_qa',
        grrRuntimeArtifactId: 'grr_art_framework_guidance_qa',
      }),
    }))
    expect(result.grr).toEqual({
      executionId: 'grr_exec_framework_guidance_qa',
      runtimeArtifactId: 'grr_art_framework_guidance_qa',
    })
  })

  test.each([
    OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
    OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
    OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
    OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
    OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
  ])('allows exact legacy V1 output-invalid recovery under repaired-output adapter %s', async (
    adapterConfigurationVersion,
  ) => {
    const plan = makePlan()
    const latestStage = makeNonRetryableProviderStage({
      plan,
      legacyConfigurationIdentity: true,
    })
    mockPackVersions(plan)
    const { args } = executeArgs({ adapterConfigurationVersion, plan, latestStage })
    const result = await executeOutcomeFrameworkGuidance(args)
    expect(result.stage.status).toBe(OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED)
    expect(args.deps.createOutcomeQualityStageExecution).toHaveBeenCalledWith(expect.objectContaining({
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latestStage.stageExecutionId,
      predecessorAttemptFingerprint: latestStage.attemptFingerprint,
      executionIdentity: expect.objectContaining({
        providerConfigurationVersion: adapterConfigurationVersion,
      }),
    }))
  })

  test('allows exact retryable V2 timeout to advance to the active V6 adapter', async () => {
    const plan = makePlan()
    const latestStage = makeNonRetryableProviderStage({
      plan,
      failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_TIMEOUT',
      providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
      retryable: true,
    })
    mockPackVersions(plan)
    const { args } = executeArgs({ plan, latestStage })
    await expect(executeOutcomeFrameworkGuidance(args)).resolves.toMatchObject({
      stage: expect.objectContaining({ status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED }),
    })
    expect(args.deps.createOutcomeQualityStageExecution).toHaveBeenCalledWith(expect.objectContaining({
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latestStage.stageExecutionId,
      predecessorAttemptFingerprint: latestStage.attemptFingerprint,
      executionIdentity: expect.objectContaining({
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
      }),
    }))
  })

  test('allows exact non-retryable V3 output-invalid recovery under the active V4 adapter', async () => {
    const plan = makePlan()
    const latestStage = makeNonRetryableProviderStage({
      plan,
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
    })
    mockPackVersions(plan)
    const { args } = executeArgs({
      adapterConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
      plan,
      latestStage,
    })
    const result = await executeOutcomeFrameworkGuidance(args)
    expect(result.stage.status).toBe(OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED)
    expect(args.deps.createOutcomeQualityStageExecution).toHaveBeenCalledWith(expect.objectContaining({
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latestStage.stageExecutionId,
      predecessorAttemptFingerprint: latestStage.attemptFingerprint,
      executionIdentity: expect.objectContaining({
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
      }),
    }))
  })

  test('allows exact non-retryable V4 output-invalid recovery under the active V5 adapter', async () => {
    const plan = makePlan()
    const latestStage = makeNonRetryableProviderStage({
      plan,
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
    })
    mockPackVersions(plan)
    const { args } = executeArgs({
      adapterConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
      plan,
      latestStage,
    })
    const result = await executeOutcomeFrameworkGuidance(args)
    expect(result.stage.status).toBe(OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED)
    expect(args.deps.createOutcomeQualityStageExecution).toHaveBeenCalledWith(expect.objectContaining({
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latestStage.stageExecutionId,
      predecessorAttemptFingerprint: latestStage.attemptFingerprint,
      executionIdentity: expect.objectContaining({
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
      }),
    }))
  })

  test('allows exact non-retryable V5 output-invalid recovery under the active V6 adapter', async () => {
    const plan = makePlan()
    const latestStage = makeNonRetryableProviderStage({
      plan,
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
    })
    mockPackVersions(plan)
    const { args } = executeArgs({ plan, latestStage })
    const result = await executeOutcomeFrameworkGuidance(args)
    expect(result.stage.status).toBe(OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED)
    expect(args.deps.createOutcomeQualityStageExecution).toHaveBeenCalledWith(expect.objectContaining({
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latestStage.stageExecutionId,
      predecessorAttemptFingerprint: latestStage.attemptFingerprint,
      executionIdentity: expect.objectContaining({
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
      }),
    }))
  })

  test.each([
    ['V2 output-invalid to V2', {
      providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2],
    ['V2 output-invalid to V4', {
      providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS],
    ['V3 output-invalid to V3', {
      providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND],
    ['V4 output-invalid to V3', {
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND],
    ['V4 output-invalid to V4', {
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS],
    ['V2 output-invalid to V5', {
      providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION],
    ['V3 output-invalid to V5', {
      providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION],
    ['V5 output-invalid to V5', {
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION],
    ['V2 output-invalid to V6', {
      providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V2,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['V3 output-invalid to V6', {
      providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V3_BACKGROUND,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['V4 output-invalid to V6', {
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V4_SAFE_OUTPUT_DIAGNOSTICS,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['V6 output-invalid to V6', {
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['different non-retryable failure', {
      failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_REFUSED',
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['provider identity drift', {
      providerKey: 'different-provider',
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
    ['model identity drift', {
      model: 'different-model',
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
    }, OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS],
  ])('rejects non-retryable predecessor recovery for %s', async (
    _label,
    latestOverrides,
    adapterConfigurationVersion,
  ) => {
    const plan = makePlan()
    const latestStage = makeNonRetryableProviderStage({ plan, ...latestOverrides })
    mockPackVersions(plan)
    const { args } = executeArgs({ adapterConfigurationVersion, plan, latestStage })
    await expect(executeOutcomeFrameworkGuidance(args)).rejects.toMatchObject({
      code: 'OUTCOME_FRAMEWORK_GUIDANCE_STAGE_HISTORY_INVALID',
      details: expect.objectContaining({ field: 'retryPredecessor' }),
    })
    expect(args.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
    expect(args.deps.createOutcomeQualityStageExecution).not.toHaveBeenCalled()
  })

  test.each([
    ['missing stage execution id', (latest) => { latest.stageExecutionId = '' }],
    ['missing attempt fingerprint', (latest) => { latest.attemptFingerprint = '' }],
    ['malformed attempt fingerprint', (latest) => { latest.attemptFingerprint = 'not-a-fingerprint' }],
  ])('rejects V5-to-V6 recovery with %s before GRR or stage persistence', async (_label, mutate) => {
    const plan = makePlan()
    const latestStage = makeNonRetryableProviderStage({
      plan,
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
    })
    mutate(latestStage)
    mockPackVersions(plan)
    const { args } = executeArgs({ plan, latestStage })
    await expect(executeOutcomeFrameworkGuidance(args)).rejects.toMatchObject({
      code: 'OUTCOME_QUALITY_STAGE_PREDECESSOR_INVALID',
    })
    expect(args.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
    expect(args.deps.createOutcomeQualityStageExecution).not.toHaveBeenCalled()
  })

  test('binds divergent package and storage identity while exposing semantic truth references', async () => {
    const runtime = makeRuntime()
    runtime.framework_state.sections.section_1_customer_context = runtime.framework_state.sections.customer_context
    delete runtime.framework_state.sections.customer_context
    runtime.framework_state.sections.section_1_customer_context.accepted.runtimePath = 'framework_state.sections.section_1_customer_context'
    const plan = makePlan(runtime)
    mockPackVersions(plan)
    const { args } = executeArgs({ plan, runtime })
    await expect(executeOutcomeFrameworkGuidance(args)).resolves.toMatchObject({
      stage: expect.objectContaining({ status: 'SUCCEEDED' }),
    })
    expect(args.providerAdapterFactory).toHaveBeenCalledWith(expect.objectContaining({
      outputContract: expect.objectContaining({
        truthReferenceKeys: expect.arrayContaining(['customer_context', 'strategic_objectives']),
      }),
    }))
    expect(args.providerAdapterFactory.mock.calls[0][0].outputContract.truthReferenceKeys)
      .not.toContain('section_1_customer_context')
  })

  test('retains exact accepted-leaf compatibility for an aligned marker-free plan', async () => {
    const runtime = makeRuntime()
    Object.values(runtime.framework_state.sections).forEach((section) => {
      section.accepted.runtimePath = `${section.accepted.runtimePath}.accepted`
    })
    const plan = makeLegacyPlan({ acceptedLeaf: true })
    mockPackVersions(plan)
    const { args } = executeArgs({ plan, runtime })
    await expect(executeOutcomeFrameworkGuidance(args)).resolves.toMatchObject({
      stage: expect.objectContaining({ status: 'SUCCEEDED' }),
    })
  })

  test('rejects a marked accepted-leaf path before adapter, GRR or stage persistence', async () => {
    const runtime = makeRuntime()
    const plan = makePlan(runtime)
    plan.payload = structuredClone(plan.payload)
    plan.payload.lockedTruth.acceptedSections[0].runtimePath += '.accepted'
    plan.planFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(plan.payload)
    await expectBindingRejectedBeforeDownstream({ plan, runtime })
  })

  test.each([
    ['accepted semantic-key mismatch', (runtime) => {
      runtime.framework_state.sections.customer_context.accepted.sectionKey = 'customer_context_v2'
    }],
    ['accepted runtime-path mismatch', (runtime) => {
      runtime.framework_state.sections.customer_context.accepted.runtimePath = 'framework_state.sections.customer_context_v2'
    }],
  ])('rejects %s before adapter, GRR or stage persistence', async (_label, mutate) => {
    const runtime = makeRuntime()
    const plan = makePlan(runtime)
    mutate(runtime)
    await expectBindingRejectedBeforeDownstream({ plan, runtime })
  })

  test.each([
    'framework_state.sections.customer_context.accepted.content',
    'framework_state.sections.customer_context.accepted.extra',
    'framework_state.sections.customer_context.generated',
  ])('rejects marker-free non-exact descendant %s before downstream activity', async (runtimePath) => {
    const runtime = makeRuntime()
    const plan = makeLegacyPlan()
    plan.payload.lockedTruth.acceptedSections.find(({ sectionKey }) => sectionKey === 'customer_context').runtimePath = runtimePath
    plan.planFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(plan.payload)
    await expectBindingRejectedBeforeDownstream({ plan, runtime })
  })

  test('rejects marker-free divergent current accepted identity before downstream activity', async () => {
    const runtime = makeRuntime()
    runtime.framework_state.sections.section_1_customer_context = runtime.framework_state.sections.customer_context
    delete runtime.framework_state.sections.customer_context
    runtime.framework_state.sections.section_1_customer_context.accepted.runtimePath = 'framework_state.sections.section_1_customer_context'
    const plan = makeLegacyPlan({ runtime })
    await expectBindingRejectedBeforeDownstream({ plan, runtime })
  })

  test.each([
    ['missing accepted truth', (section) => { delete section.accepted }],
    ['null accepted truth', (section) => { section.accepted = null }],
    ['empty accepted content', (section) => { section.accepted.content = '' }],
    ['whitespace accepted content', (section) => { section.accepted.content = '   ' }],
  ])('rejects %s without substituting root, input, generated or review content', async (_label, mutate) => {
    const runtime = makeRuntime()
    const plan = makePlan(runtime)
    const section = runtime.framework_state.sections.customer_context
    section.content = 'Unaccepted root content.'
    section.input = { content: 'Unaccepted input content.' }
    section.generated = { content: 'Unaccepted generated content.' }
    section.review = { summary: 'Unaccepted review content.' }
    mutate(section)
    await expectBindingRejectedBeforeDownstream({ plan, runtime })
  })

  test('ignores hostile grrDeps replacements for every application-owned GRR dependency', async () => {
    const plan = makePlan()
    const serverProviderAdapter = jest.fn()
    const hostile = {
      executionMode: 'SIMULATED',
      providerAdapter: jest.fn(),
      providerDescriptor: { providerKey: 'hostile', model: 'hostile-model' },
      providerInput: { customerPrompt: 'Hostile provider input.' },
      resolveKnowledgeBinding: jest.fn(),
      buildProviderSafeContext: jest.fn(),
    }
    const { args } = executeArgs({ plan })
    args.providerAdapterFactory.mockReturnValue(configuredProviderAdapter(serverProviderAdapter))
    args.deps.grrDeps = hostile
    args.deps.createGovernedReasoningExecution.mockImplementation(async (call) => {
      expect(call.deps.executionMode).toBe('LIVE_TEST')
      expect(call.deps.providerAdapter).toBe(serverProviderAdapter)
      expect(call.deps.providerDescriptor).toBe(descriptor)
      expect(call.deps.providerInput).not.toBe(hostile.providerInput)
      expect(call.deps.providerInput.customerPrompt).not.toBe(hostile.providerInput.customerPrompt)
      expect(call.deps.resolveKnowledgeBinding).not.toBe(hostile.resolveKnowledgeBinding)
      expect(call.deps.buildProviderSafeContext).not.toBe(hostile.buildProviderSafeContext)
      return makeSuccessGrr(plan)
    })
    await executeOutcomeFrameworkGuidance(args)
    expect(hostile.providerAdapter).not.toHaveBeenCalled()
    expect(hostile.resolveKnowledgeBinding).not.toHaveBeenCalled()
    expect(hostile.buildProviderSafeContext).not.toHaveBeenCalled()
  })

  test('fails topology preflight before KCP reads, adapter construction or GRR', async () => {
    const { args, models } = executeArgs()
    args.deps.assertOutcomeQualityStageTransactionSupport.mockImplementation(() => {
      const error = new Error('transaction required')
      error.code = 'OUTCOME_QUALITY_STAGE_TRANSACTION_REQUIRED'
      throw error
    })
    await expect(executeOutcomeFrameworkGuidance(args)).rejects.toMatchObject({
      code: 'OUTCOME_QUALITY_STAGE_TRANSACTION_REQUIRED',
    })
    expect(models.OutcomeKnowledgeCompositionPlan.findOne).not.toHaveBeenCalled()
    expect(args.providerAdapterFactory).not.toHaveBeenCalled()
    expect(args.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
  })

  test('fails a superseded KCP before adapter construction, GRR or stage persistence', async () => {
    const selected = makePlan()
    const latest = { ...makePlan(), _id: new mongoose.Types.ObjectId('6a705569a7b760264f6a5020') }
    const { args, models } = executeArgs({ plan: selected })
    models.OutcomeKnowledgeCompositionPlan.findOne.mockImplementation((filter) => {
      if (filter._id) return { lean: jest.fn().mockResolvedValue(selected) }
      return { sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(latest) }) }
    })
    await expect(executeOutcomeFrameworkGuidance(args)).rejects.toMatchObject({
      code: 'OUTCOME_FRAMEWORK_GUIDANCE_BINDING_INVALID',
    })
    expect(args.providerAdapterFactory).not.toHaveBeenCalled()
    expect(args.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
    expect(args.deps.createOutcomeQualityStageExecution).not.toHaveBeenCalled()
  })

  test('blocks reduced GRR selection drift before the provider adapter', async () => {
    const plan = makePlan()
    const runtime = makeRuntime()
    const { args } = executeArgs({ plan, runtime })
    args.deps.createGovernedReasoningExecution.mockImplementation(async (call) => {
      const safeRequest = buildOutcomeStudioProviderSafeRequest({ providerDescriptor: descriptor, providerInput: call.deps.providerInput })
      await call.deps.buildProviderSafeContext({
        providerDescriptor: descriptor,
        safeRequest,
        truthSource: truthSource(runtime),
        knowledgeSelection: [{ versionId: 'substituted-version', knowledgeLayer: 'VALIDATION', executionMode: 'POST_VALIDATION' }],
      })
    })
    await expect(executeOutcomeFrameworkGuidance(args)).rejects.toMatchObject({
      code: 'OUTCOME_FRAMEWORK_GUIDANCE_BINDING_INVALID',
    })
    expect(args.deps.createOutcomeQualityStageExecution).not.toHaveBeenCalled()
  })

  test('blocks an exact selected-version content-hash mismatch before provider or stage persistence', async () => {
    const plan = makePlan()
    const runtime = makeRuntime()
    mockPackVersions(plan, { hashOverride: `sha256:${'f'.repeat(64)}` })
    const providerAdapter = configuredProviderAdapter()
    const { args } = executeArgs({ plan, runtime })
    args.providerAdapterFactory.mockReturnValue(providerAdapter)
    args.deps.createGovernedReasoningExecution.mockImplementation(async (call) => {
      const facade = await call.deps.resolveKnowledgeBinding()
      const selected = facade.binding.postValidationPacks.map(({ versionId, knowledgeLayer, executionMode }) => ({ versionId, knowledgeLayer, executionMode }))
      const safeRequest = buildOutcomeStudioProviderSafeRequest({ providerDescriptor: descriptor, providerInput: call.deps.providerInput })
      return call.deps.buildProviderSafeContext({
        providerDescriptor: descriptor,
        safeRequest,
        truthSource: truthSource(runtime),
        knowledgeSelection: selected,
      })
    })
    await expect(executeOutcomeFrameworkGuidance(args)).rejects.toMatchObject({
      code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
    })
    expect(providerAdapter).not.toHaveBeenCalled()
    expect(args.deps.createOutcomeQualityStageExecution).not.toHaveBeenCalled()
  })

  test('records only an allowlisted provider failure as a safe retryable FAILED stage', async () => {
    const plan = makePlan()
    const { args } = executeArgs({ plan })
    const error = new Error('masked')
    error.code = 'OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_FAILED'
    error.details = { reason: 'FRAMEWORK_GUIDANCE_PROVIDER_TRANSIENT_FAILURE' }
    args.deps.createGovernedReasoningExecution.mockRejectedValue(error)
    const result = await executeOutcomeFrameworkGuidance(args)
    expect(args.deps.createOutcomeQualityStageExecution).toHaveBeenCalledWith(expect.objectContaining({
      status: 'FAILED',
      failure: {
        failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_TRANSIENT_FAILURE',
        safeReason: 'The governed framework and guidance provider did not complete this attempt.',
        retryable: true,
      },
      executionIdentity: expect.objectContaining({ grrExecutionId: '', grrRuntimeArtifactId: '' }),
    }))
    expect(result.grr).toBeNull()
  })

  test('persists response-invalid as one non-retryable FAILED stage with empty GRR lineage', async () => {
    const { args } = executeArgs()
    const error = new Error('masked')
    error.code = 'OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_FAILED'
    error.details = { reason: 'FRAMEWORK_GUIDANCE_PROVIDER_RESPONSE_INVALID' }
    args.deps.createGovernedReasoningExecution.mockRejectedValue(error)
    const result = await executeOutcomeFrameworkGuidance(args)
    expect(args.deps.createOutcomeQualityStageExecution).toHaveBeenCalledTimes(1)
    const stageCall = args.deps.createOutcomeQualityStageExecution.mock.calls[0][0]
    expect(stageCall).toMatchObject({
      status: 'FAILED',
      failure: {
        failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_RESPONSE_INVALID',
        safeReason: 'The governed framework and guidance provider did not complete this attempt.',
        retryable: false,
      },
      executionIdentity: { grrExecutionId: '', grrRuntimeArtifactId: '' },
    })
    expect(stageCall).not.toHaveProperty('output')
    expect(result.grr).toBeNull()
  })

  test('does not project adapter diagnostics into the governed failed-stage shape', async () => {
    const plan = makePlan()
    const latestStage = makeNonRetryableProviderStage({
      plan,
      providerConfigurationVersion:
        OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V5_SEMANTIC_CLAIM_CALIBRATION,
    })
    mockPackVersions(plan)
    const { args } = executeArgs({ plan, latestStage })
    const error = new Error('masked')
    error.code = 'OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_FAILED'
    error.details = {
      reason: 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      diagnostic: {
        diagnosticSchemaVersion: 2,
        diagnosticClass: 'OUTPUT_SCHEMA',
        diagnosticSubcode: 'UNRECOGNIZED_FIELD',
        forbiddenValue: 'PERSISTENCE_DIAGNOSTIC_SECRET_QA',
        stack: 'PERSISTENCE_STACK_SECRET_QA',
        message: 'PERSISTENCE_MESSAGE_SECRET_QA',
      },
    }
    args.deps.createGovernedReasoningExecution.mockRejectedValue(error)
    const result = await executeOutcomeFrameworkGuidance(args)
    const stageCall = args.deps.createOutcomeQualityStageExecution.mock.calls[0][0]
    expect(stageCall.failure).toEqual({
      failureCode: 'FRAMEWORK_GUIDANCE_PROVIDER_OUTPUT_INVALID',
      safeReason: 'The governed framework and guidance provider did not complete this attempt.',
      retryable: false,
    })
    expect(stageCall).toMatchObject({
      expectedLatestAttemptNumber: 1,
      predecessorStageExecutionId: latestStage.stageExecutionId,
      predecessorAttemptFingerprint: latestStage.attemptFingerprint,
      executionIdentity: {
        providerConfigurationVersion:
          OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V6_ARL_BOUNDARY_DIAGNOSTICS,
        grrExecutionId: '',
        grrRuntimeArtifactId: '',
      },
    })
    expect(stageCall).not.toHaveProperty('output')
    expect(JSON.stringify(stageCall)).not.toContain('PERSISTENCE_DIAGNOSTIC_SECRET_QA')
    expect(JSON.stringify(stageCall)).not.toContain('PERSISTENCE_STACK_SECRET_QA')
    expect(JSON.stringify(stageCall)).not.toContain('PERSISTENCE_MESSAGE_SECRET_QA')
    expect(result.grr).toBeNull()
  })

  test.each([
    'OUTCOME_STUDIO_LIVE_TEST_READINESS_BLOCKED',
    'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
    'GRR_AUDIT_FAILED',
    'GRR_PERSISTENCE_FAILED',
    'GRR_IDEMPOTENCY_REQUEST_CONFLICT',
  ])('does not synthesize a stage for %s', async (code) => {
    const { args } = executeArgs()
    const error = new Error('safe')
    error.code = code
    args.deps.createGovernedReasoningExecution.mockRejectedValue(error)
    await expect(executeOutcomeFrameworkGuidance(args)).rejects.toBe(error)
    expect(args.deps.createOutcomeQualityStageExecution).not.toHaveBeenCalled()
  })

  test('returns an existing successful stage only after exact persisted GRR lineage verification', async () => {
    const plan = makePlan()
    const output = makeOutput(plan)
    const candidate = buildOutcomeQualityStageExecutionCandidate({
      plan,
      runtimeInstanceId: ids.runtime,
      expectedPlanFingerprint: plan.planFingerprint,
      stageKey: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
      output,
      executionIdentity: {
        executionMode: 'LIVE_TEST',
        providerKey: descriptor.providerKey,
        providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
        model: descriptor.model,
        grrExecutionId: 'grr_exec_framework_guidance_qa',
        grrRuntimeArtifactId: 'grr_art_framework_guidance_qa',
        runtimeVersion: runtimeUpdatedAt,
      },
      startedAt: '2026-08-03T10:00:00.000Z',
      completedAt: '2026-08-03T10:00:04.000Z',
    })
    const latestStage = {
      _id: ids.stage,
      stageExecutionId: 'outcome_quality_stage_existing_qa',
      ...candidate,
      createdBy: ids.actor,
      createdAt: new Date('2026-08-03T10:00:05.000Z'),
    }
    const { args, models } = executeArgs({ plan, latestStage })
    models.GovernedReasoningExecution.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
      executionId: 'grr_exec_framework_guidance_qa',
      status: 'COMPLETED',
      provider: { providerKey: descriptor.providerKey, model: descriptor.model },
    }) })
    models.GovernedRuntimeArtifact.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
      runtimeArtifactId: 'grr_art_framework_guidance_qa',
      executionId: 'grr_exec_framework_guidance_qa',
      status: 'GENERATED',
      generatedOutput: output,
    }) })
    const result = await executeOutcomeFrameworkGuidance(args)
    expect(result.idempotent).toBe(true)
    expect(result.grr.executionId).toBe('grr_exec_framework_guidance_qa')
    expect(args.providerAdapterFactory).not.toHaveBeenCalled()
    expect(args.deps.createGovernedReasoningExecution).not.toHaveBeenCalled()
    expect(args.deps.createOutcomeQualityStageExecution).not.toHaveBeenCalled()
    expect(hashOutcomeQualityStageValue(output)).toBe(candidate.outputFingerprint)
  })

  test('reuses stable persisted GRR timing and candidate identity after a stage-only failure', async () => {
    const plan = makePlan()
    const { args } = executeArgs({ plan })
    const fingerprints = []
    args.deps.createOutcomeQualityStageExecution
      .mockImplementationOnce(async (input) => {
        fingerprints.push(input.expectedAttemptFingerprint)
        const error = new Error('stage unavailable')
        error.code = 'OUTCOME_QUALITY_STAGE_PERSISTENCE_FAILED'
        throw error
      })
      .mockImplementationOnce(async (input) => {
        fingerprints.push(input.expectedAttemptFingerprint)
        return { idempotent: false, execution: { attemptFingerprint: input.expectedAttemptFingerprint, status: input.status } }
      })
    await expect(executeOutcomeFrameworkGuidance(args)).rejects.toMatchObject({
      code: 'OUTCOME_QUALITY_STAGE_PERSISTENCE_FAILED',
    })
    const result = await executeOutcomeFrameworkGuidance(args)
    expect(args.deps.createGovernedReasoningExecution).toHaveBeenCalledTimes(2)
    expect(args.deps.createGovernedReasoningExecution.mock.calls[0][0].payload.idempotencyKey)
      .toBe(args.deps.createGovernedReasoningExecution.mock.calls[1][0].payload.idempotencyKey)
    expect(fingerprints[0]).toBe(fingerprints[1])
    expect(result.stage.status).toBe('SUCCEEDED')
  })
})
