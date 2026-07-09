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
    expect(result.status).toBe('COMPLETED')
    expect(result.idempotencyKey).toBe('')
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

  test('reuses a completed execution for the same idempotency key', async () => {
    const deps = makeDeps()
    const existingExecution = {
      executionId: 'grr_exec_existing',
      status: 'COMPLETED',
      providerMode: 'DETERMINISTIC_TEST',
      runtimeStateWrites: {
        status: 'NOT_WRITTEN',
        reason: 'NO_REVIEWED_GRR_RUNTIME_PATH_V1',
      },
      idempotencyKey: 'OUTCOME:SESSION:MESSAGE:GENERATE_RESPONSE',
    }
    const existingArtifact = {
      runtimeArtifactId: 'grr_art_existing',
      executionId: 'grr_exec_existing',
      status: 'GENERATED',
      certification: {
        certifiedTruthOnly: true,
        runtimeArtifactIsCertifiedTruth: false,
      },
    }
    GovernedReasoningExecution.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(existingExecution),
    })
    GovernedRuntimeArtifact.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(existingArtifact),
    })

    const result = await createGovernedReasoningExecution({
      actorUserId: ACTOR_ID,
      auditRequest: { requestId: 'req-idempotent' },
      deps,
      payload: {
        outputTypeKey: 'CUSTOMER_PROPOSAL',
        idempotencyKey: 'OUTCOME:SESSION:MESSAGE:GENERATE_RESPONSE',
      },
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      scopes: {},
    })

    expect(result.executionId).toBe('grr_exec_existing')
    expect(result.artifact.runtimeArtifactId).toBe('grr_art_existing')
    expect(deps.resolveKnowledgeBinding).not.toHaveBeenCalled()
    expect(deps.providerAdapter).not.toHaveBeenCalled()
    expect(GovernedReasoningExecution.prototype.save).not.toHaveBeenCalled()
    expect(GovernedRuntimeArtifact.prototype.save).not.toHaveBeenCalled()
    expect(deps.logAudit).not.toHaveBeenCalled()
  })
})
