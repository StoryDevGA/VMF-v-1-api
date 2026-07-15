import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import mongoose from 'mongoose'
import GovernedReasoningExecution from '../models/GovernedReasoningExecution.js'
import GovernedRuntimeArtifact from '../models/GovernedRuntimeArtifact.js'
import {
  createGovernedReasoningExecution,
} from '../services/governedReasoningRuntimeService.js'

const TENANT_ID = '707f1f77bcf86cd799439033'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const RUNTIME_INSTANCE_ID = 'a27f1f77bcf86cd799439111'
const ACTOR_ID = '507f1f77bcf86cd799439012'

const makeReadyGraph = () => ({
  artifactType: 'runtime_intelligence_graph',
  graphVersion: '2.2',
  runtimeId: RUNTIME_INSTANCE_ID,
  runtimeInstanceId: RUNTIME_INSTANCE_ID,
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  graphHash: 'sha256:graph-hash',
  build: {
    status: 'VALID',
    nodeCount: 2,
    edgeCount: 1,
  },
  nodes: [],
  edges: [],
  coverage: {
    coverageModel: 'EVIDENCE_DOMAIN_COVERAGE',
    coveragePercent: 100,
    coveredDomainCount: 4,
    totalDomainCount: 4,
    missingDomains: [],
    domains: [],
  },
  dependencies: {
    sectionDependencyCount: 0,
    missingDependencyTruthCount: 0,
    sections: [],
  },
  health: {
    state: 'READY',
    nodeCount: 2,
    edgeCount: 1,
    acceptedEvidenceCount: 1,
    orphanEvidenceCount: 0,
    lowQualityEvidenceCount: 0,
    unclassifiedEvidenceCount: 0,
    missingDomainCount: 0,
    dependencyCount: 0,
    contradictionCount: 0,
  },
  validation: {
    status: 'VALID',
    issues: [],
  },
})

const makeRuntimeInstance = (overrides = {}) => ({
  _id: RUNTIME_INSTANCE_ID,
  tenantId: TENANT_ID,
  customerId: CUSTOMER_ID,
  runtimeInstanceKey: 'vmf-runtime-fixture',
  runtimeType: 'VALUE_NARRATIVE',
  frameworkKey: 'VMF',
  packageKey: 'standard-package-vmf-3-1-rkm',
  packageVersion: '3.1',
  packageId: '927f1f77bcf86cd799439099',
  framework_state: {
    publish: {
      published: true,
      snapshot: {
        snapshotId: 'publish-snapshot-1',
        snapshotHash: 'sha256:publish-hash',
      },
    },
    lock: {
      locked: true,
      snapshot: {
        snapshotId: 'lock-snapshot-1',
        snapshotHash: 'sha256:lock-hash',
      },
      replayAnchor: {
        replayAnchorId: 'replay-anchor-1',
        replayAnchorHash: 'sha256:replay-hash',
      },
      outputEligibility: {
        outputEligible: true,
        canonicalOutputEligible: true,
        anchorEligible: true,
        intelligenceEligible: true,
      },
    },
    sections: {
      situation: {
        accepted: {
          content: 'The customer needs a governed value narrative.',
          acceptedAt: '2026-07-09T08:00:00.000Z',
          acceptedBy: ACTOR_ID,
          truthHash: 'sha256:situation-truth',
        },
      },
      commercial_problem: {
        accepted: {
          content: 'The commercial problem is fragmented proof and unclear value.',
          acceptedAt: '2026-07-09T08:05:00.000Z',
          acceptedBy: ACTOR_ID,
          truthHash: 'sha256:commercial-problem-truth',
        },
      },
    },
    intelligence_graph: makeReadyGraph(),
  },
  ...overrides,
})

const makeFrameworkPackage = (overrides = {}) => ({
  _id: '927f1f77bcf86cd799439099',
  packageKey: 'standard-package-vmf-3-1-rkm',
  frameworkKey: 'VMF',
  sections: [
    {
      sectionKey: 'situation',
      runtimePath: 'framework_state.sections.situation',
      label: 'Situation',
      required: true,
    },
    {
      sectionKey: 'commercial_problem',
      runtimePath: 'framework_state.sections.commercial_problem',
      label: 'Commercial Problem',
      required: true,
    },
  ],
  ...overrides,
})

const makeKnowledgeBinding = () => ({
  manifest: {
    manifestId: 'kpm-outcome-studio-default-1-0-0-global',
    manifestKey: 'outcome-studio-default',
    manifestName: 'Outcome Studio Default',
    semanticVersion: '1.0.0',
    status: 'ACTIVE',
  },
  binding: {
    status: 'PROJECTED',
    mode: 'DEFAULT_OUTCOME_STUDIO',
    requiredPacks: [
      {
        packType: 'ARL',
        packKey: 'adaptive-reasoning-layer',
        versionId: 'kpv-arl',
        activationId: 'kpa-arl',
        label: 'Adaptive Reasoning Layer',
        purposeCategory: 'FRAMEWORK',
        executionMode: 'PROVIDER_CONTEXT',
        scopeType: 'GLOBAL',
        scopeKey: 'GLOBAL',
      },
    ],
    optionalPacks: [],
    validationPacks: [],
    dependencyGraph: {
      status: 'RESOLVED',
      edges: [],
      edgeCount: 0,
    },
    resolution: {
      requiredPackCount: 1,
    },
  },
})

const makeProviderResult = () => ({
  generatedAt: new Date('2026-07-09T09:00:00.000Z'),
  provider: {
    providerKey: 'test-provider',
    providerMode: 'DETERMINISTIC_TEST',
    liveProvider: false,
  },
  output: {
    title: 'Governed output',
    outputTypeKey: 'CUSTOMER_PROPOSAL',
    sections: [
      {
        heading: 'Situation',
        narrative: 'The customer needs a governed value narrative.',
      },
    ],
    markdown: '# Governed output',
  },
  metadata: {
    deterministic: true,
  },
})

const makeDeps = (overrides = {}) => ({
  resolveRuntimeInstance: jest.fn().mockResolvedValue(makeRuntimeInstance()),
  resolveFrameworkPackage: jest.fn().mockResolvedValue(makeFrameworkPackage()),
  resolveKnowledgeBinding: jest.fn().mockResolvedValue(makeKnowledgeBinding()),
  providerAdapter: jest.fn().mockResolvedValue(makeProviderResult()),
  logAudit: jest.fn().mockResolvedValue({ _id: 'audit-log-1' }),
  ...overrides,
})

describe('Governed Reasoning Runtime models and service', () => {
  let originalProviderMode

  beforeEach(() => {
    originalProviderMode = process.env.STORYLINEOS_GRR_PROVIDER_MODE
    delete process.env.STORYLINEOS_GRR_PROVIDER_MODE
    delete process.env.STORYLINEOS_GRR_DETERMINISTIC_PROVIDER_ENABLED
    GovernedReasoningExecution.prototype.save = jest.fn(async function save() {
      return this
    })
    GovernedRuntimeArtifact.prototype.save = jest.fn(async function save() {
      return this
    })
    GovernedReasoningExecution.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    })
    GovernedRuntimeArtifact.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    })
    GovernedReasoningExecution.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 })
    GovernedRuntimeArtifact.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 })
  })

  afterEach(() => {
    if (originalProviderMode === undefined) {
      delete process.env.STORYLINEOS_GRR_PROVIDER_MODE
    } else {
      process.env.STORYLINEOS_GRR_PROVIDER_MODE = originalProviderMode
    }
    delete process.env.STORYLINEOS_GRR_DETERMINISTIC_PROVIDER_ENABLED
  })

  test('normalizes governed execution and artifact records at the schema boundary', async () => {
    const execution = new GovernedReasoningExecution({
      executionId: ' grr_exec_fixture ',
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      runtimeInstanceKey: ' VMF-RUNTIME-FIXTURE ',
      runtimeType: ' value_narrative ',
      workspaceType: ' outcome ',
      frameworkKey: ' vmf ',
      outputTypeKey: ' customer_proposal ',
      providerMode: ' deterministic_test ',
      requestedBy: ACTOR_ID,
    })

    const artifact = new GovernedRuntimeArtifact({
      runtimeArtifactId: ' grr_art_fixture ',
      executionId: ' grr_exec_fixture ',
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      runtimeInstanceKey: ' VMF-RUNTIME-FIXTURE ',
      frameworkKey: ' vmf ',
      outputTypeKey: ' customer_proposal ',
      generatedBy: ACTOR_ID,
    })

    await expect(execution.validate()).resolves.toBeUndefined()
    await expect(artifact.validate()).resolves.toBeUndefined()
    expect(execution.runtimeType).toBe('VALUE_NARRATIVE')
    expect(execution.workspaceType).toBe('OUTCOME')
    expect(execution.frameworkKey).toBe('VMF')
    expect(execution.outputTypeKey).toBe('CUSTOMER_PROPOSAL')
    expect(artifact.frameworkKey).toBe('VMF')
    expect(artifact.outputTypeKey).toBe('CUSTOMER_PROPOSAL')
  })

  test('creates a governed reasoning execution from Certified Truth and Knowledge Manifest metadata', async () => {
    const deps = makeDeps()

    const result = await createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-1' },
      deps,
      payload: {
        outputTypeKey: 'CUSTOMER_PROPOSAL',
        executionIntent: 'Create a customer-ready proposal.',
      },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })

    expect(deps.resolveKnowledgeBinding).toHaveBeenCalledWith(expect.objectContaining({
      manifestId: undefined,
      query: expect.objectContaining({
        frameworkKey: 'VMF',
        runtimeType: 'VALUE_NARRATIVE',
        outputKey: 'customer_proposal',
      }),
    }))
    expect(deps.providerAdapter).toHaveBeenCalled()
    expect(deps.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1' }),
      expect.objectContaining({
        action: 'GOVERNED_REASONING_EXECUTED',
        resourceType: 'GovernedReasoningExecution',
      }),
      { throwOnError: true },
    )
    const auditPayload = deps.logAudit.mock.calls[0][1]
    expect(mongoose.Types.ObjectId.isValid(auditPayload.resourceId)).toBe(true)
    expect(auditPayload.resourceId).not.toBe(auditPayload.diff.executionId)
    expect(auditPayload.diff.executionId).toMatch(/^grr_exec_/)
    expect(result.status).toBe('COMPLETED')
    expect(result.idempotencyKey).toBe('')
    expect(result.requestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(result.runtimeStateWrites).toEqual(expect.objectContaining({
      status: 'NOT_WRITTEN',
      reason: 'NO_REVIEWED_GRR_RUNTIME_PATH_V1',
    }))
    expect(result.certifiedTruth.sourceTruthSummary).toHaveLength(2)
    expect(result.knowledgeBinding.contentVisible).toBe(false)
    expect(result.artifact.certification).toEqual(expect.objectContaining({
      certifiedTruthOnly: true,
      runtimeArtifactIsCertifiedTruth: false,
    }))
  })

  test('normalizes every request capability selector before registry resolution', async () => {
    const deps = makeDeps()

    await createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-normalized-capabilities' },
      deps,
      payload: {
        outputTypeKey: 'BOARD_SUMMARY',
        requestedOutputTypeKey: 'BOARD_SUMMARY',
        requestedStyleKey: 'EXECUTIVE_BOARD_STYLE',
        audienceKeys: ['EXECUTIVE_BOARD', 'executive_board'],
        industryKeys: ['FINANCIAL_SERVICES'],
        languageKey: 'UK_ENGLISH',
        channelKey: 'BOARD_PORTAL',
      },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })

    expect(deps.resolveKnowledgeBinding).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({
        requestedOutputTypeKey: 'board-summary',
        requestedStyleKey: 'executive-board-style',
        audienceKeys: ['executive-board'],
        industryKeys: ['financial-services'],
        languageKey: 'uk-english',
        channelKey: 'board-portal',
      }),
    }))
  })

  test('passes only projected Knowledge Pack metadata and Certified Truth summaries to providers', async () => {
    let persistedExecution
    let persistedArtifact
    GovernedReasoningExecution.prototype.save = jest.fn(async function save() {
      persistedExecution = this
      return this
    })
    GovernedRuntimeArtifact.prototype.save = jest.fn(async function save() {
      persistedArtifact = this
      return this
    })
    const runtimeInstance = makeRuntimeInstance()
    runtimeInstance.framework_state.rawSourceText = 'RAW_RUNTIME_SOURCE_SHOULD_NOT_LEAK'
    runtimeInstance.framework_state.sections.situation.accepted.rawSourceText = 'RAW_ACCEPTED_SOURCE_SHOULD_NOT_LEAK'
    runtimeInstance.framework_state.sections.situation.accepted.sourceBundle = {
      content: 'RAW_SOURCE_BUNDLE_SHOULD_NOT_LEAK',
    }
    runtimeInstance.framework_state.intelligence_graph = {
      ...makeReadyGraph(),
      nodes: [
        {
          nodeId: 'graph-node-db-id-should-not-leak',
          rawContent: 'RAW_GRAPH_CONTENT_SHOULD_NOT_LEAK',
        },
      ],
      edges: [
        {
          edgeId: 'graph-edge-db-id-should-not-leak',
          sourceText: 'RAW_GRAPH_EDGE_SOURCE_SHOULD_NOT_LEAK',
        },
      ],
    }
    const knowledgeBinding = makeKnowledgeBinding()
    knowledgeBinding.binding.requiredPacks = [
      {
        ...knowledgeBinding.binding.requiredPacks[0],
        _id: 'knowledge-pack-db-id-should-not-leak',
        id: 'knowledge-pack-id-should-not-leak',
        activationId: 'knowledge-pack-activation-id-should-not-leak',
        packId: 'knowledge-pack-pack-id-should-not-leak',
        customerId: CUSTOMER_ID,
        rawPackContent: 'RAW_PACK_CONTENT_SHOULD_NOT_LEAK',
        sourceBundle: {
          sourceText: 'RAW_PACK_SOURCE_SHOULD_NOT_LEAK',
        },
        promptAssembly: 'RAW_PROVIDER_PROMPT_SHOULD_NOT_LEAK',
      },
    ]
    knowledgeBinding.binding.dependencyGraph = {
      status: 'RESOLVED',
      edgeCount: 1,
      edges: [
        {
          from: 'ARL:adaptive-reasoning-layer',
          to: 'RL:reasoning-layer',
          fromPackKey: 'adaptive-reasoning-layer',
          toPackKey: 'reasoning-layer',
          nodeId: 'dependency-node-id-should-not-leak',
          rawContent: 'RAW_DEPENDENCY_CONTENT_SHOULD_NOT_LEAK',
        },
      ],
    }
    knowledgeBinding.binding.resolution = {
      status: 'PROJECTED',
      activeCount: 1,
      requiredCount: 1,
      activationIds: ['knowledge-pack-activation-id-should-not-leak'],
      scopeCandidates: [
        {
          customerId: CUSTOMER_ID,
          tenantId: TENANT_ID,
        },
      ],
    }
    knowledgeBinding.binding.lineage = {
      resolvedAt: '2026-07-14T12:00:00.000Z',
      activationIds: ['knowledge-pack-activation-id-should-not-leak'],
      versionIds: ['kpv-arl'],
      contentHashes: ['sha256:arl'],
    }
    const preValidationPack = {
      packType: 'TRUTH_CERTIFICATION',
      packKey: 'truth-certification-internal',
      versionId: 'kpv-truth-certification',
      executionMode: 'PRE_VALIDATION',
      knowledgeLayer: 'VALIDATION',
      capabilityKey: 'truth-certification',
    }
    const postValidationPack = {
      packType: 'COMPLIANCE',
      packKey: 'contradiction-review-internal',
      versionId: 'kpv-contradiction-review',
      executionMode: 'POST_VALIDATION',
      knowledgeLayer: 'VALIDATION',
      capabilityKey: 'contradiction-review',
    }
    const systemOnlyPack = {
      packType: 'SYSTEM',
      packKey: 'runtime-coordinator-internal',
      versionId: 'kpv-runtime-coordinator',
      executionMode: 'SYSTEM_ONLY',
      knowledgeLayer: 'FRAMEWORK',
      capabilityKey: 'runtime-coordinator',
    }
    knowledgeBinding.binding.validationPacks = [preValidationPack, postValidationPack]
    knowledgeBinding.binding.preValidationPacks = [preValidationPack]
    knowledgeBinding.binding.postValidationPacks = [postValidationPack]
    knowledgeBinding.binding.systemOnlyPacks = [systemOnlyPack]
    knowledgeBinding.binding.providerContextPacks = knowledgeBinding.binding.requiredPacks
    knowledgeBinding.binding.selectedByLayer = {
      REASONING: knowledgeBinding.binding.requiredPacks,
      VALIDATION: [preValidationPack, postValidationPack],
      FRAMEWORK: [systemOnlyPack],
    }
    const deps = makeDeps({
      resolveRuntimeInstance: jest.fn().mockResolvedValue(runtimeInstance),
      resolveKnowledgeBinding: jest.fn().mockResolvedValue(knowledgeBinding),
    })

    const result = await createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-provider-projection' },
      deps,
      payload: {
        outputTypeKey: 'BOARD_SUMMARY',
        executionIntent: 'Create a board summary from certified runtime truth.',
        contextCategories: ['style', 'audience'],
      },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })

    const providerCall = deps.providerAdapter.mock.calls[0][0]
    expect(providerCall.providerContext).toEqual(expect.objectContaining({
      assemblyMode: 'CERTIFIED_TRUTH_WITH_KNOWLEDGE_BINDING_METADATA',
      contentVisible: false,
      packContentLoaded: false,
    }))
    expect(providerCall.payload).toEqual(expect.objectContaining({
      outputTypeKey: 'BOARD_SUMMARY',
      contextCategories: ['STYLE', 'AUDIENCE'],
      executionIntent: 'Create a board summary from certified runtime truth.',
    }))
    expect(providerCall.truthContext.acceptedTruth).toBeUndefined()
    expect(providerCall.truthContext.summary.sourceTruthSummary).toEqual([
      expect.objectContaining({
        sectionKey: 'situation',
        summary: 'The customer needs a governed value narrative.',
        truthHash: 'sha256:situation-truth',
      }),
      expect.objectContaining({
        sectionKey: 'commercial_problem',
        summary: 'The commercial problem is fragmented proof and unclear value.',
        truthHash: 'sha256:commercial-problem-truth',
      }),
    ])
    expect(providerCall.truthContext.summary.sourceTruthSummary[0]).not.toHaveProperty('runtimePath')
    expect(providerCall.truthContext.summary.sourceTruthSummary[0]).not.toHaveProperty('acceptedBy')
    expect(providerCall.knowledgeContext.binding.requiredPacks[0]).toEqual(expect.objectContaining({
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      versionId: 'kpv-arl',
      contentHash: '',
    }))
    expect(providerCall.knowledgeContext.binding.requiredPacks[0]).not.toHaveProperty('activationId')
    expect(providerCall.knowledgeContext.binding.requiredPacks[0]).not.toHaveProperty('packId')
    expect(providerCall.knowledgeContext.binding.requiredPacks[0].dependencyReferences).toEqual([])
    expect(providerCall.knowledgeContext.binding).not.toHaveProperty('validationPacks')
    expect(providerCall.knowledgeContext.binding).not.toHaveProperty('preValidationPacks')
    expect(providerCall.knowledgeContext.binding).not.toHaveProperty('postValidationPacks')
    expect(providerCall.knowledgeContext.binding).not.toHaveProperty('systemOnlyPacks')
    expect(providerCall.knowledgeContext.binding).not.toHaveProperty('dependencyGraph')
    expect(result.reasoningContext.certifiedTruthProjection).toEqual(expect.objectContaining({
      status: 'PROJECTED',
      source: 'CERTIFIED_RUNTIME_TRUTH',
      outputTypeKey: 'BOARD_SUMMARY',
      relevanceBasis: expect.objectContaining({
        outputTypeKey: 'BOARD_SUMMARY',
        selection: 'CERTIFIED_RUNTIME_TRUTH_SUMMARY',
        structuredRuntimeSectionMapApplied: false,
      }),
      sectionCount: 2,
    }))

    const projectedJson = JSON.stringify({
      providerCall,
      reasoningContext: result.reasoningContext,
      knowledgeBinding: result.knowledgeBinding,
    })
    expect(projectedJson).not.toContain('RAW_RUNTIME_SOURCE_SHOULD_NOT_LEAK')
    expect(projectedJson).not.toContain('RAW_ACCEPTED_SOURCE_SHOULD_NOT_LEAK')
    expect(projectedJson).not.toContain('RAW_SOURCE_BUNDLE_SHOULD_NOT_LEAK')
    expect(projectedJson).not.toContain('RAW_GRAPH_CONTENT_SHOULD_NOT_LEAK')
    expect(projectedJson).not.toContain('RAW_GRAPH_EDGE_SOURCE_SHOULD_NOT_LEAK')
    expect(projectedJson).not.toContain('RAW_PACK_CONTENT_SHOULD_NOT_LEAK')
    expect(projectedJson).not.toContain('RAW_PACK_SOURCE_SHOULD_NOT_LEAK')
    expect(projectedJson).not.toContain('RAW_PROVIDER_PROMPT_SHOULD_NOT_LEAK')
    expect(projectedJson).not.toContain('RAW_DEPENDENCY_CONTENT_SHOULD_NOT_LEAK')
    expect(projectedJson).not.toContain('knowledge-pack-db-id-should-not-leak')
    expect(projectedJson).not.toContain('knowledge-pack-activation-id-should-not-leak')
    expect(projectedJson).not.toContain('dependency-node-id-should-not-leak')
    expect(projectedJson).not.toContain(CUSTOMER_ID)
    expect(projectedJson).not.toContain(TENANT_ID)
    const providerJson = JSON.stringify(providerCall)
    expect(providerJson).not.toContain('truth-certification-internal')
    expect(providerJson).not.toContain('contradiction-review-internal')
    expect(providerJson).not.toContain('runtime-coordinator-internal')
    expect(persistedExecution.knowledgeBinding.lineage).toEqual({
      resolvedAt: '2026-07-14T12:00:00.000Z',
      activationIds: ['knowledge-pack-activation-id-should-not-leak'],
      versionIds: ['kpv-arl'],
      contentHashes: ['sha256:arl'],
    })
    expect(persistedArtifact.lineageSummary.knowledgeBinding.lineage).toEqual(
      persistedExecution.knowledgeBinding.lineage,
    )
    expect(persistedExecution.knowledgeBinding.validationPacks).toHaveLength(2)
    expect(persistedExecution.knowledgeBinding.systemOnlyPacks).toHaveLength(1)
  })

  test('blocks ambiguous Knowledge Pack resolution before provider execution or persistence', async () => {
    const knowledgeBinding = makeKnowledgeBinding()
    knowledgeBinding.binding.status = 'AMBIGUOUS'
    knowledgeBinding.binding.ambiguousCandidates = [{
      selector: { knowledgeLayer: 'STYLE', capabilityKey: 'executive' },
      candidates: [
        { activationId: 'kpa-style-one' },
        { activationId: 'kpa-style-two' },
      ],
    }]
    const deps = makeDeps({
      resolveKnowledgeBinding: jest.fn().mockResolvedValue(knowledgeBinding),
    })

    await expect(createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-ambiguous-knowledge' },
      deps,
      payload: { outputTypeKey: 'CUSTOMER_PROPOSAL' },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })).rejects.toMatchObject({
      code: 'GRR_KNOWLEDGE_BINDING_AMBIGUOUS',
      details: expect.objectContaining({
        reason: 'KNOWLEDGE_BINDING_AMBIGUOUS',
        status: 'AMBIGUOUS',
      }),
    })

    expect(deps.providerAdapter).not.toHaveBeenCalled()
    expect(GovernedReasoningExecution.prototype.save).not.toHaveBeenCalled()
    expect(GovernedRuntimeArtifact.prototype.save).not.toHaveBeenCalled()
    expect(deps.logAudit).not.toHaveBeenCalled()
  })

  test('blocks before manifest resolution when Certified Truth is missing', async () => {
    const deps = makeDeps({
      resolveRuntimeInstance: jest.fn().mockResolvedValue(makeRuntimeInstance({
        framework_state: {
          sections: {},
          publish: {},
          lock: {},
          intelligence_graph: {},
        },
      })),
    })

    await expect(createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-2' },
      deps,
      payload: { outputTypeKey: 'CUSTOMER_PROPOSAL' },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })).rejects.toMatchObject({
      code: 'GRR_CERTIFIED_TRUTH_BLOCKED',
      details: expect.objectContaining({
        reason: 'CERTIFIED_TRUTH_MISSING',
      }),
    })

    expect(deps.resolveKnowledgeBinding).not.toHaveBeenCalled()
    expect(deps.providerAdapter).not.toHaveBeenCalled()
    expect(GovernedReasoningExecution.prototype.save).not.toHaveBeenCalled()
  })

  test('fails closed without persisting when no provider posture is configured', async () => {
    const deps = makeDeps({
      providerAdapter: undefined,
    })

    await expect(createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-3' },
      deps,
      payload: { outputTypeKey: 'CUSTOMER_PROPOSAL' },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })).rejects.toMatchObject({
      code: 'GRR_PROVIDER_UNAVAILABLE',
      details: expect.objectContaining({
        reason: 'PROVIDER_UNAVAILABLE',
      }),
    })

    expect(GovernedReasoningExecution.prototype.save).not.toHaveBeenCalled()
    expect(GovernedRuntimeArtifact.prototype.save).not.toHaveBeenCalled()
  })

  test('rolls back execution and artifact records when audit persistence fails', async () => {
    const deps = makeDeps({
      logAudit: jest.fn().mockRejectedValue(new Error('audit unavailable')),
    })

    await expect(createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-4' },
      deps,
      payload: { outputTypeKey: 'CUSTOMER_PROPOSAL' },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })).rejects.toMatchObject({
      code: 'GRR_AUDIT_FAILED',
      details: expect.objectContaining({
        reason: 'AUDIT_PERSISTENCE_FAILED',
      }),
    })

    expect(GovernedRuntimeArtifact.deleteOne).toHaveBeenCalledWith(expect.objectContaining({
      runtimeArtifactId: expect.stringMatching(/^grr_art_/),
    }))
    expect(GovernedReasoningExecution.deleteOne).toHaveBeenCalledWith(expect.objectContaining({
      executionId: expect.stringMatching(/^grr_exec_/),
    }))
  })

  test('rolls back execution when artifact persistence fails before audit', async () => {
    const deps = makeDeps()
    GovernedRuntimeArtifact.prototype.save = jest.fn(async () => {
      throw new Error('artifact store unavailable')
    })

    await expect(createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-artifact-failure' },
      deps,
      payload: { outputTypeKey: 'CUSTOMER_PROPOSAL' },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })).rejects.toMatchObject({
      code: 'GRR_PERSISTENCE_FAILED',
      details: expect.objectContaining({
        reason: 'PERSISTENCE_FAILED',
        cause: 'artifact store unavailable',
      }),
    })

    expect(GovernedReasoningExecution.prototype.save).toHaveBeenCalledTimes(1)
    expect(GovernedRuntimeArtifact.prototype.save).toHaveBeenCalledTimes(1)
    expect(deps.logAudit).not.toHaveBeenCalled()
    expect(GovernedRuntimeArtifact.deleteOne).toHaveBeenCalledWith(expect.objectContaining({
      runtimeArtifactId: expect.stringMatching(/^grr_art_/),
    }))
    expect(GovernedReasoningExecution.deleteOne).toHaveBeenCalledWith(expect.objectContaining({
      executionId: expect.stringMatching(/^grr_exec_/),
    }))
  })

  test('persists execution, artifact, and audit inside one Mongo transaction when connected', async () => {
    const deps = makeDeps()
    const originalStartSession = mongoose.startSession
    const readyStateDescriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState')
    const dbSession = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(),
    }
    mongoose.startSession = jest.fn().mockResolvedValue(dbSession)
    Object.defineProperty(mongoose.connection, 'readyState', {
      configurable: true,
      value: 1,
    })

    try {
      const result = await createGovernedReasoningExecution({
        actorUserId: ACTOR_ID,
        auditRequest: { requestId: 'req-transaction' },
        deps,
        payload: { outputTypeKey: 'CUSTOMER_PROPOSAL' },
        runtimeInstanceId: RUNTIME_INSTANCE_ID,
        scopes: {},
      })

      expect(result.status).toBe('COMPLETED')
      expect(mongoose.startSession).toHaveBeenCalledTimes(1)
      expect(dbSession.withTransaction).toHaveBeenCalledTimes(1)
      expect(dbSession.endSession).toHaveBeenCalledTimes(1)
      expect(GovernedReasoningExecution.prototype.save).toHaveBeenNthCalledWith(1, { session: dbSession })
      expect(GovernedRuntimeArtifact.prototype.save).toHaveBeenCalledWith({ session: dbSession })
      expect(deps.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-transaction' }),
        expect.objectContaining({
          action: 'GOVERNED_REASONING_EXECUTED',
          resourceType: 'GovernedReasoningExecution',
        }),
        { throwOnError: true, session: dbSession },
      )
      expect(GovernedReasoningExecution.prototype.save).toHaveBeenNthCalledWith(2, { session: dbSession })
    } finally {
      mongoose.startSession = originalStartSession
      if (readyStateDescriptor) {
        Object.defineProperty(mongoose.connection, 'readyState', readyStateDescriptor)
      } else {
        delete mongoose.connection.readyState
      }
    }
  })

  test('stores a deterministic request fingerprint and reuses the same idempotent request', async () => {
    const deps = makeDeps()
    const payload = {
      outputTypeKey: 'CUSTOMER_PROPOSAL',
      executionIntent: 'Create a customer-ready proposal.',
      requestedOutputTypeKey: 'customer-proposal',
      requestedStyleKey: 'executive',
      audienceKeys: ['board'],
      industryKeys: ['technology'],
      languageKey: 'en-gb',
      channelKey: 'proposal',
      manifestId: 'kpm-outcome-studio-default-1-0-0-global',
      workspaceType: 'OUTCOME',
      environmentKey: 'PRODUCTION',
      contextCategories: ['STYLE', 'AUDIENCE'],
      idempotencyKey: 'OUTCOME:SESSION:MESSAGE:GENERATE_RESPONSE',
    }
    let persistedExecution
    let persistedArtifact
    GovernedReasoningExecution.prototype.save = jest.fn(async function save() {
      persistedExecution = this
      return this
    })
    GovernedRuntimeArtifact.prototype.save = jest.fn(async function save() {
      persistedArtifact = this
      return this
    })

    const firstResult = await createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-idempotent-first' },
      deps,
      payload,
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })

    expect(firstResult.requestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(persistedExecution.requestFingerprint).toBe(firstResult.requestFingerprint)
    GovernedReasoningExecution.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(persistedExecution.toObject()),
    })
    GovernedRuntimeArtifact.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(persistedArtifact.toObject()),
    })
    deps.resolveKnowledgeBinding.mockClear()
    deps.providerAdapter.mockClear()
    deps.logAudit.mockClear()
    GovernedReasoningExecution.prototype.save.mockClear()
    GovernedRuntimeArtifact.prototype.save.mockClear()

    const result = await createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-idempotent-retry' },
      deps,
      payload: { ...payload },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })

    expect(result.executionId).toBe(firstResult.executionId)
    expect(result.requestFingerprint).toBe(firstResult.requestFingerprint)
    expect(result.artifact.runtimeArtifactId).toBe(firstResult.artifact.runtimeArtifactId)
    expect(deps.resolveKnowledgeBinding).not.toHaveBeenCalled()
    expect(deps.providerAdapter).not.toHaveBeenCalled()
    expect(GovernedReasoningExecution.prototype.save).not.toHaveBeenCalled()
    expect(GovernedRuntimeArtifact.prototype.save).not.toHaveBeenCalled()
    expect(deps.logAudit).not.toHaveBeenCalled()
  })

  test('returns a stable 409 when an idempotency key is reused with different request selectors', async () => {
    const deps = makeDeps()
    const idempotencyKey = 'OUTCOME:SESSION:MESSAGE:SELECTOR_CONFLICT'
    let persistedExecution
    GovernedReasoningExecution.prototype.save = jest.fn(async function save() {
      persistedExecution = this
      return this
    })

    await createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-selector-original' },
      deps,
      payload: {
        outputTypeKey: 'CUSTOMER_PROPOSAL',
        requestedStyleKey: 'executive',
        idempotencyKey,
      },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })

    GovernedReasoningExecution.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(persistedExecution.toObject()),
    })
    GovernedRuntimeArtifact.findOne.mockClear()
    deps.resolveKnowledgeBinding.mockClear()
    deps.providerAdapter.mockClear()
    deps.logAudit.mockClear()
    GovernedReasoningExecution.prototype.save.mockClear()
    GovernedRuntimeArtifact.prototype.save.mockClear()

    await expect(createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-selector-conflict' },
      deps,
      payload: {
        outputTypeKey: 'CUSTOMER_PROPOSAL',
        requestedStyleKey: 'concise',
        idempotencyKey,
      },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })).rejects.toMatchObject({
      status: 409,
      code: 'GRR_IDEMPOTENCY_REQUEST_CONFLICT',
      details: {
        reason: 'IDEMPOTENCY_REQUEST_CONFLICT',
        fingerprintState: 'MISMATCHED',
      },
    })

    expect(GovernedRuntimeArtifact.findOne).not.toHaveBeenCalled()
    expect(deps.resolveKnowledgeBinding).not.toHaveBeenCalled()
    expect(deps.providerAdapter).not.toHaveBeenCalled()
    expect(GovernedReasoningExecution.prototype.save).not.toHaveBeenCalled()
    expect(GovernedRuntimeArtifact.prototype.save).not.toHaveBeenCalled()
    expect(deps.logAudit).not.toHaveBeenCalled()
  })

  test('returns the same stable 409 for a legacy idempotent execution without a fingerprint', async () => {
    const deps = makeDeps()
    GovernedReasoningExecution.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        executionId: 'grr_exec_legacy',
        idempotencyKey: 'OUTCOME:SESSION:MESSAGE:LEGACY_RESPONSE',
      }),
    })

    await expect(createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-legacy-idempotent' },
      deps,
      payload: {
        outputTypeKey: 'CUSTOMER_PROPOSAL',
        idempotencyKey: 'OUTCOME:SESSION:MESSAGE:LEGACY_RESPONSE',
      },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })).rejects.toMatchObject({
      status: 409,
      code: 'GRR_IDEMPOTENCY_REQUEST_CONFLICT',
      details: {
        reason: 'IDEMPOTENCY_REQUEST_CONFLICT',
        fingerprintState: 'MISSING',
      },
    })

    expect(GovernedRuntimeArtifact.findOne).not.toHaveBeenCalled()
    expect(deps.resolveKnowledgeBinding).not.toHaveBeenCalled()
    expect(deps.providerAdapter).not.toHaveBeenCalled()
    expect(GovernedReasoningExecution.prototype.save).not.toHaveBeenCalled()
    expect(GovernedRuntimeArtifact.prototype.save).not.toHaveBeenCalled()
    expect(deps.logAudit).not.toHaveBeenCalled()
  })

  test('recovers the completed winner when concurrent idempotent persistence loses a unique-index race', async () => {
    const deps = makeDeps()
    const idempotencyKey = 'OUTCOME:SESSION:MESSAGE:CONCURRENT_RESPONSE'
    let attemptedFingerprint
    const existingExecution = {
      executionId: 'grr_exec_concurrent_winner',
      status: 'COMPLETED',
      providerMode: 'DETERMINISTIC_TEST',
      runtimeStateWrites: {
        status: 'NOT_WRITTEN',
        reason: 'NO_REVIEWED_GRR_RUNTIME_PATH_V1',
      },
      idempotencyKey,
    }
    const existingArtifact = {
      runtimeArtifactId: 'grr_art_concurrent_winner',
      executionId: existingExecution.executionId,
      status: 'GENERATED',
      certification: {
        certifiedTruthOnly: true,
        runtimeArtifactIsCertifiedTruth: false,
      },
    }
    GovernedReasoningExecution.findOne = jest.fn()
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({
        lean: jest.fn(async () => ({
          ...existingExecution,
          requestFingerprint: attemptedFingerprint,
        })),
      })
    GovernedRuntimeArtifact.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(existingArtifact),
    })
    GovernedReasoningExecution.prototype.save = jest.fn(async function save() {
      attemptedFingerprint = this.requestFingerprint
      const error = new Error('duplicate runtimeInstanceId_1_idempotencyKey_1')
      error.code = 11000
      error.keyPattern = { runtimeInstanceId: 1, idempotencyKey: 1 }
      throw error
    })

    const result = await createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-concurrent-idempotent' },
      deps,
      payload: {
        outputTypeKey: 'CUSTOMER_PROPOSAL',
        idempotencyKey,
      },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })

    expect(result.executionId).toBe(existingExecution.executionId)
    expect(result.artifact.runtimeArtifactId).toBe(existingArtifact.runtimeArtifactId)
    expect(deps.providerAdapter).toHaveBeenCalledTimes(1)
    expect(deps.logAudit).not.toHaveBeenCalled()
    expect(GovernedRuntimeArtifact.deleteOne).toHaveBeenCalledTimes(1)
    expect(GovernedReasoningExecution.deleteOne).toHaveBeenCalledTimes(1)
  })

  test('returns the stable 409 when a unique-index race winner has a different fingerprint', async () => {
    const deps = makeDeps()
    const idempotencyKey = 'OUTCOME:SESSION:MESSAGE:CONCURRENT_CONFLICT'
    GovernedReasoningExecution.findOne = jest.fn()
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          executionId: 'grr_exec_concurrent_conflict',
          idempotencyKey,
          requestFingerprint: 'sha256:different-request',
        }),
      })
    GovernedReasoningExecution.prototype.save = jest.fn(async () => {
      const error = new Error('duplicate runtimeInstanceId_1_idempotencyKey_1')
      error.code = 11000
      error.keyPattern = { runtimeInstanceId: 1, idempotencyKey: 1 }
      throw error
    })

    await expect(createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-concurrent-conflict' },
      deps,
      payload: {
        outputTypeKey: 'CUSTOMER_PROPOSAL',
        idempotencyKey,
      },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })).rejects.toMatchObject({
      status: 409,
      code: 'GRR_IDEMPOTENCY_REQUEST_CONFLICT',
      details: {
        reason: 'IDEMPOTENCY_REQUEST_CONFLICT',
        fingerprintState: 'MISMATCHED',
      },
    })

    expect(deps.providerAdapter).toHaveBeenCalledTimes(1)
    expect(deps.logAudit).not.toHaveBeenCalled()
    expect(GovernedRuntimeArtifact.findOne).not.toHaveBeenCalled()
    expect(GovernedRuntimeArtifact.deleteOne).toHaveBeenCalledTimes(1)
    expect(GovernedReasoningExecution.deleteOne).toHaveBeenCalledTimes(1)
  })
})
