import mongoose from 'mongoose'
import { jest } from '@jest/globals'

import {
  OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION,
  OUTCOME_KCP_ERROR_CODES,
  OUTCOME_KCP_OPERATIONS,
  OUTCOME_KCP_STATUSES,
  OUTCOME_QUALITY_STAGE_SEQUENCE,
  OUTCOME_QUALITY_STAGES,
} from '../constants/outcomeGovernedQuality.js'
import OutcomeKnowledgeCompositionPlan from '../models/OutcomeKnowledgeCompositionPlan.js'
import {
  assertOutcomeKnowledgeCompositionPlanIntegrity,
  assertOutcomeKnowledgeCompositionPlanMatchesRuntime,
  buildOutcomeKnowledgeCompositionPlanCandidate,
  createOutcomeKnowledgeCompositionPlan,
  hashOutcomeKnowledgeCompositionValue,
  hashOutcomeKnowledgeCompositionSemanticValue,
} from '../services/outcomeKnowledgeCompositionPlanService.js'

const ids = {
  runtime: new mongoose.Types.ObjectId('6a6c8115bb9cebc18a1eca9c'),
  tenant: new mongoose.Types.ObjectId('6a6b14eca737c717e99b8069'),
  customer: new mongoose.Types.ObjectId('6a6b12fea737c717e99b7f6b'),
  actor: new mongoose.Types.ObjectId('6a6b135ba737c717e99b7f8a'),
  plan: new mongoose.Types.ObjectId('6a7000000000000000000001'),
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
  runtimeInstanceKey: 'value-narrative-qa',
  runtimeType: 'VALUE_NARRATIVE',
  frameworkKey: 'VMF',
  packageKey: 'standard-package-vmf-3-1-3-rkm',
  packageVersion: '3.1.3',
  status: 'LOCKED',
  updatedAt: new Date(runtimeUpdatedAt),
  framework_state: {
    sections: {
      customer_context: makeSection('customer_context', 'a'),
      output_requirements: makeSection('output_requirements', 'b'),
    },
    publish: {
      snapshot: {
        snapshotId: 'publish-snapshot-qa',
        snapshotHash: 'c'.repeat(64),
      },
    },
    lock: {
      state: 'LOCKED',
      locked: true,
      lockedAt: '2026-08-02T18:59:29.533Z',
      lockedBy: ids.actor,
      publish: {
        snapshotId: 'publish-snapshot-qa',
        snapshotHash: 'c'.repeat(64),
      },
      snapshot: {
        snapshotId: 'lock-snapshot-qa',
        snapshotHash: 'd'.repeat(64),
      },
      anchor: {
        replayAnchorId: 'replay-anchor-qa',
        replayAnchorHash: 'e'.repeat(64),
      },
      evidence: {
        dependencySnapshotId: 'dependency-snapshot-qa',
        dependencySnapshotHash: 'f'.repeat(64),
      },
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

const requestPacks = () => ({
  truthDependency: makePack({ packType: 'TRUTH_CERTIFICATION', packKey: 'blocking-rules', knowledgeLayer: 'VALIDATION', suffix: '6' }),
  outputType: makePack({ packType: 'OUTPUT_TYPE_DEFINITION', packKey: 'executive-brief', knowledgeLayer: 'OUTPUT_TYPE', capabilityKey: 'executive-brief', suffix: '7' }),
  outputSchema: makePack({ packType: 'OUTPUT_SCHEMA', packKey: 'executive-brief-schema', knowledgeLayer: 'OUTPUT_SCHEMA', capabilityKey: 'executive-brief-schema', suffix: '8' }),
  style: makePack({ packType: 'STYLE', packKey: 'executive-briefing-style', knowledgeLayer: 'STYLE', capabilityKey: 'executive-brief-style', suffix: '9' }),
  excluded: makePack({ packType: 'STYLE', packKey: 'commercial-assessment-style', knowledgeLayer: 'STYLE', suffix: 'a' }),
})

const makeBinding = () => {
  const safeguards = mandatory()
  const packs = requestPacks()
  const selected = [...safeguards, packs.truthDependency, packs.outputType, packs.outputSchema, packs.style]
  return {
    status: 'READY',
    mode: 'REQUEST_SPECIFIC',
    policyKey: 'outcome-studio-v1-required-packs',
    policyVersion: '1.0.0',
    mandatorySafeguards: safeguards,
    selectedByLayer: {
      VALIDATION: [packs.truthDependency],
      OUTPUT_TYPE: [packs.outputType],
      OUTPUT_SCHEMA: [packs.outputSchema],
      STYLE: [packs.style],
    },
    excludedCandidates: [{ reason: 'NOT_SELECTED', candidate: packs.excluded }],
    blockedPacks: [{ ...packs.excluded, blockedReason: 'SYSTEM_ONLY_PACK' }],
    missingDependencies: [],
    relationshipFailures: [],
    ambiguousCandidates: [],
    incompatibleCandidates: [],
    warnings: [],
    dependencyGraph: {
      nodes: selected.map((pack) => ({ nodeId: pack.activationId, activationId: pack.activationId })),
      edges: [
        { from: safeguards[3].activationId, to: packs.truthDependency.activationId, requirement: 'REQUIRED', relationshipType: 'REQUIRED_AT_RUNTIME', requiredAt: 'RUNTIME', cardinality: 'ONE' },
        { from: packs.outputType.activationId, to: packs.outputSchema.activationId, requirement: 'REQUIRED', relationshipType: 'REQUIRES_COMPATIBLE_PACK', requiredAt: 'RUNTIME', cardinality: 'ONE_OR_MORE' },
        { from: packs.outputType.activationId, to: packs.style.activationId, requirement: 'REQUIRED', relationshipType: 'REQUIRED_AT_RUNTIME', requiredAt: 'RUNTIME', cardinality: 'ONE' },
      ],
      cycles: [],
      depthOverflows: [],
    },
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

const consumerIntent = () => ({
  outcome: 'One Parlon Executive Brief',
  decisionPurpose: 'Support the executive sponsor decision with governed meaning.',
  consumer: 'Quinn Fixture QA',
  audience: ['Quinn Fixture QA', 'Riley Fixture QA'],
  requestedOutputTypeKey: 'executive-brief',
  format: 'Executive Brief with searchable and accessible text',
  channel: '',
  requirements: ['Element-level lineage', 'Editable structure where supported'],
  unresolvedGaps: ['Exact delivery file type is not specified'],
})

const buildCandidate = (overrides = {}) => buildOutcomeKnowledgeCompositionPlanCandidate({
  runtime: overrides.runtime || makeRuntime(),
  binding: overrides.binding || makeBinding(),
  context: overrides.context || makeContext(),
  consumerIntent: overrides.consumerIntent || consumerIntent(),
})

const makePlanRecord = (candidate = buildCandidate()) => ({
  _id: ids.plan,
  planId: 'outcome_kcp_qa',
  planVersion: 1,
  contractVersion: candidate.payload.contractVersion,
  operation: OUTCOME_KCP_OPERATIONS.INITIAL,
  status: candidate.status,
  tenantId: ids.tenant,
  customerId: ids.customer,
  runtimeInstanceId: ids.runtime,
  runtimeInstanceKey: 'value-narrative-qa',
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
})

const makeLegacyPlan = ({ runtime = makeRuntime(), acceptedLeaf = false } = {}) => {
  const candidate = buildCandidate({ runtime: acceptedLeaf ? makeRuntime() : runtime })
  const plan = makePlanRecord(candidate)
  plan.payload = structuredClone(candidate.payload)
  delete plan.payload.lockedTruth.acceptedTruthIdentityContractVersion
  plan.payload.lockedTruth.acceptedSections.forEach((section) => {
    section.sectionKey = section.stateSectionKey
    delete section.stateSectionKey
    if (acceptedLeaf) section.runtimePath = `${section.runtimePath}.accepted`
  })
  plan.planFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(plan.payload)
  return plan
}

const makeRuntimeModel = (runtime) => ({
  findById: jest.fn(() => {
    const query = {
      session: jest.fn(() => query),
      lean: jest.fn(async () => runtime),
    }
    return query
  }),
})

const makePersistenceDeps = ({ latest = null, auditError = null, saveError = null } = {}) => {
  const runtime = makeRuntime()
  const saved = []
  function PlanModel(payload) {
    Object.assign(this, payload)
    this._id = ids.plan
    this.createdAt = new Date('2026-08-03T07:00:00.000Z')
    this.save = jest.fn(async () => {
      if (saveError) throw saveError
      saved.push(this)
      return this
    })
  }
  PlanModel.findOne = jest.fn(() => ({
    sort: jest.fn(() => ({
      session: jest.fn(async () => latest),
    })),
  }))
  const audit = {
    AUDIT_ACTIONS: { OUTCOME_KNOWLEDGE_COMPOSITION_PLAN_CREATED: 'OUTCOME_KNOWLEDGE_COMPOSITION_PLAN_CREATED' },
    RESOURCE_TYPES: { OutcomeKnowledgeCompositionPlan: 'OutcomeKnowledgeCompositionPlan' },
    log: jest.fn(async () => {
      if (auditError) throw auditError
      return { _id: new mongoose.Types.ObjectId() }
    }),
  }
  const session = {
    withTransaction: jest.fn(async (callback) => callback()),
    endSession: jest.fn(async () => {}),
  }
  const mongooseClient = { startSession: jest.fn(async () => session) }
  const deps = {
    RuntimeInstance: makeRuntimeModel(runtime),
    OutcomeKnowledgeCompositionPlan: PlanModel,
    resolveBinding: jest.fn(async () => ({ binding: makeBinding() })),
    resolveContext: jest.fn(async () => ({ context: makeContext() })),
    assertRuntimePermission: jest.fn(async () => {}),
    auditService: audit,
    mongoose: mongooseClient,
    assertTransactionSupport: jest.fn(),
  }
  return { deps, audit, session, saved }
}

describe('Outcome Knowledge Composition Plan contract', () => {
  it('hashes canonical object key order while retaining governed IDs', () => {
    expect(hashOutcomeKnowledgeCompositionValue({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(hashOutcomeKnowledgeCompositionValue({ a: { c: 3, d: 4 }, b: 2 }))
    expect(hashOutcomeKnowledgeCompositionValue({ activationId: 'activation-a' }))
      .not.toBe(hashOutcomeKnowledgeCompositionValue({ activationId: 'activation-b' }))
  })

  it('builds the ordered stage plan and one-to-one considered decision table', () => {
    const candidate = buildCandidate()
    expect(candidate.status).toBe(OUTCOME_KCP_STATUSES.READY_WITH_GAPS)
    expect(candidate.payload.stagePlan.map((stage) => stage.stageKey)).toEqual(OUTCOME_QUALITY_STAGE_SEQUENCE)
    expect(candidate.payload.stagePlan.find((stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW).assignedActivationIds).toEqual(['activation-adaptive-reasoning-layer'])
    expect(candidate.payload.stagePlan.find((stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL).assignedActivationIds).toEqual(['activation-rendering-layer'])
    expect(candidate.payload.stagePlan.find((stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.WORKING_DRAFT).assignedActivationIds).toEqual([])
    expect(candidate.payload.stagePlan.find((stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN).assignedActivationIds).toEqual([])
    const decisions = candidate.payload.resolution.consideredPacks
    expect(new Set(decisions.map((decision) => decision.activationId)).size).toBe(decisions.length)
    expect(candidate.payload.resolution.consideredPackCoverage).toMatchObject({
      rawActivationOccurrenceCount: 11,
      exposedActivationCount: 10,
      classifiedActivationCount: 10,
      repeatedIdenticalActivationCount: 1,
      conflictingActivationCount: 0,
      missingDecisionCount: 0,
      unclassifiedCandidateCount: 0,
    })
    expect(decisions.find((decision) => decision.activationId === 'activation-commercial-assessment-style')).toMatchObject({
      decision: 'BLOCKED',
      sources: expect.arrayContaining(['BLOCKED_PACK', 'EXCLUDED_CANDIDATE']),
    })
  })

  it('retains locked truth, consumer intent, relationships, cardinality and visible optional gaps', () => {
    const candidate = buildCandidate()
    expect(candidate.payload.lockedTruth).toMatchObject({
      acceptedTruthIdentityContractVersion: OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION,
      publishSnapshotId: 'publish-snapshot-qa',
      lockSnapshotId: 'lock-snapshot-qa',
      replayAnchorId: 'replay-anchor-qa',
      dependencySnapshotId: 'dependency-snapshot-qa',
    })
    expect(candidate.payload.lockedTruth.acceptedSections).toHaveLength(2)
    expect(candidate.payload.lockedTruth.acceptedSections[0]).toMatchObject({
      sectionKey: 'customer_context',
      stateSectionKey: 'customer_context',
      runtimePath: 'framework_state.sections.customer_context',
    })
    expect(candidate.payload.consumerIntent.unresolvedGaps).toEqual(['Exact delivery file type is not specified'])
    expect(candidate.payload.resolution.dependencyGraph.edges[1]).toMatchObject({
      relationshipType: 'REQUIRES_COMPATIBLE_PACK',
      cardinality: 'ONE_OR_MORE',
    })
    expect(candidate.gapCount).toBe(1)
  })

  it('produces the same fingerprint for equivalent inputs and changes for governed identity changes', () => {
    const first = buildCandidate()
    const second = buildCandidate()
    expect(first.planFingerprint).toBe(second.planFingerprint)
    const changed = makeBinding()
    changed.selectedByLayer.STYLE[0].activationId = 'activation-executive-briefing-style-v2'
    expect(buildCandidate({ binding: changed }).planFingerprint).not.toBe(first.planFingerprint)

    const divergent = makeRuntime()
    divergent.framework_state.sections.section_1_customer_context = divergent.framework_state.sections.customer_context
    delete divergent.framework_state.sections.customer_context
    divergent.framework_state.sections.section_1_customer_context.accepted.runtimePath = 'framework_state.sections.section_1_customer_context'
    expect(buildCandidate({ runtime: divergent }).planFingerprint).not.toBe(first.planFingerprint)
  })

  it.each([
    ['semantic section key', (payload) => {
      payload.lockedTruth.acceptedSections[0].sectionKey = 'customer_context_v2'
    }],
    ['storage section key', (payload) => {
      payload.lockedTruth.acceptedSections[0].stateSectionKey = 'section_1_customer_context'
    }],
    ['runtime path', (payload) => {
      payload.lockedTruth.acceptedSections[0].runtimePath = 'framework_state.sections.section_1_customer_context'
    }],
  ])('includes %s independently in the semantic KCP fingerprint', (_label, mutate) => {
    const baseline = buildCandidate().payload
    const changed = structuredClone(baseline)
    mutate(changed)
    expect(hashOutcomeKnowledgeCompositionSemanticValue(changed))
      .not.toBe(hashOutcomeKnowledgeCompositionSemanticValue(baseline))
  })

  it('retains distinct semantic and storage identity for a divergent package section', () => {
    const runtime = makeRuntime()
    runtime.framework_state.sections.section_1_customer_context = runtime.framework_state.sections.customer_context
    delete runtime.framework_state.sections.customer_context
    runtime.framework_state.sections.section_1_customer_context.accepted.runtimePath = 'framework_state.sections.section_1_customer_context'
    const candidate = buildCandidate({ runtime })
    expect(candidate.payload.lockedTruth.acceptedSections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sectionKey: 'customer_context',
        stateSectionKey: 'section_1_customer_context',
        runtimePath: 'framework_state.sections.section_1_customer_context',
      }),
    ]))
  })

  it.each([
    ['missing accepted semantic key', (runtime) => { delete runtime.framework_state.sections.customer_context.accepted.sectionKey }],
    ['nested accepted path', (runtime) => { runtime.framework_state.sections.customer_context.accepted.runtimePath += '.accepted' }],
    ['another storage root', (runtime) => { runtime.framework_state.sections.customer_context.accepted.runtimePath = 'framework_state.sections.output_requirements' }],
    ['duplicate semantic key', (runtime) => { runtime.framework_state.sections.output_requirements.accepted.sectionKey = 'customer_context' }],
  ])('rejects marked KCP source truth with %s', (_label, mutate) => {
    const runtime = makeRuntime()
    mutate(runtime)
    expect(() => buildCandidate({ runtime })).toThrow(expect.objectContaining({
      code: OUTCOME_KCP_ERROR_CODES.SOURCE_TRUTH_INCOMPLETE,
    }))
  })

  it('preserves an aligned marker-free plan and exact accepted-leaf compatibility without changing its fingerprint', () => {
    const runtime = makeRuntime()
    Object.values(runtime.framework_state.sections).forEach((section) => {
      section.accepted.runtimePath = `${section.accepted.runtimePath}.accepted`
    })
    const plan = makeLegacyPlan({ runtime, acceptedLeaf: true })
    const fingerprint = plan.planFingerprint
    expect(assertOutcomeKnowledgeCompositionPlanIntegrity(plan).planFingerprint).toBe(fingerprint)
    expect(assertOutcomeKnowledgeCompositionPlanMatchesRuntime(plan, runtime).planFingerprint).toBe(fingerprint)
    expect(plan.payload.lockedTruth).not.toHaveProperty('acceptedTruthIdentityContractVersion')
    expect(plan.payload.lockedTruth.acceptedSections[0]).not.toHaveProperty('stateSectionKey')
  })

  it('fails currentness for a marker-free plan produced from divergent package and storage identity', () => {
    const runtime = makeRuntime()
    runtime.framework_state.sections.section_1_customer_context = runtime.framework_state.sections.customer_context
    delete runtime.framework_state.sections.customer_context
    runtime.framework_state.sections.section_1_customer_context.accepted.runtimePath = 'framework_state.sections.section_1_customer_context'
    const plan = makeLegacyPlan({ runtime })
    expect(() => assertOutcomeKnowledgeCompositionPlanIntegrity(plan)).not.toThrow()
    expect(() => assertOutcomeKnowledgeCompositionPlanMatchesRuntime(plan, runtime)).toThrow(expect.objectContaining({
      code: OUTCOME_KCP_ERROR_CODES.SOURCE_TRUTH_INCOMPLETE,
    }))
  })

  it.each([
    ['unknown marker', (plan) => { plan.payload.lockedTruth.acceptedTruthIdentityContractVersion = 'unknown.v1' }],
    ['missing storage identity', (plan) => { delete plan.payload.lockedTruth.acceptedSections[0].stateSectionKey }],
    ['mixed identity shape', (plan) => { delete plan.payload.lockedTruth.acceptedTruthIdentityContractVersion }],
    ['marked accepted leaf', (plan) => { plan.payload.lockedTruth.acceptedSections[0].runtimePath += '.accepted' }],
    ['duplicate semantic identity', (plan) => {
      plan.payload.lockedTruth.acceptedSections[1].sectionKey = plan.payload.lockedTruth.acceptedSections[0].sectionKey
    }],
    ['duplicate storage identity', (plan) => {
      plan.payload.lockedTruth.acceptedSections[1].stateSectionKey = plan.payload.lockedTruth.acceptedSections[0].stateSectionKey
      plan.payload.lockedTruth.acceptedSections[1].runtimePath = plan.payload.lockedTruth.acceptedSections[0].runtimePath
    }],
  ])('rejects %s after fingerprint-consistent payload construction', (_label, mutate) => {
    const plan = makePlanRecord()
    plan.payload = structuredClone(plan.payload)
    mutate(plan)
    plan.planFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(plan.payload)
    expect(() => assertOutcomeKnowledgeCompositionPlanIntegrity(plan)).toThrow(expect.objectContaining({
      code: OUTCOME_KCP_ERROR_CODES.RESOLUTION_INTEGRITY_INVALID,
    }))
  })

  it('excludes operational timestamps from semantic fingerprints while retaining them in the payload', () => {
    const baseline = buildCandidate()
    const runtime = makeRuntime()
    runtime.updatedAt = new Date('2026-08-03T01:02:03.000Z')
    runtime.framework_state.lock.lockedAt = '2026-08-03T01:02:04.000Z'
    runtime.framework_state.sections.customer_context.accepted.acceptedAt = '2026-08-03T01:02:05.000Z'
    runtime.framework_state.sections.customer_context.accepted.sourceGeneratedAt = '2026-08-03T01:02:06.000Z'
    const binding = makeBinding()
    binding.lineage.resolvedAt = '2026-08-03T01:02:07.000Z'
    binding.blockedPacks[0].activatedAt = '2026-08-03T01:02:08.000Z'
    const context = makeContext()
    context.lineage.resolvedAt = '2026-08-03T01:02:09.000Z'
    const timestampOnly = buildCandidate({ runtime, binding, context })

    expect(timestampOnly.planFingerprint).toBe(baseline.planFingerprint)
    expect(timestampOnly.resolutionFingerprint).toBe(baseline.resolutionFingerprint)
    expect(timestampOnly.contextFingerprint).toBe(baseline.contextFingerprint)
    expect(timestampOnly.payload.lockedTruth).toMatchObject({
      runtimeUpdatedAt: '2026-08-03T01:02:03.000Z',
      lockedAt: '2026-08-03T01:02:04.000Z',
    })
    expect(timestampOnly.payload.lockedTruth.acceptedSections[0]).toMatchObject({
      acceptedAt: '2026-08-03T01:02:05.000Z',
      sourceGeneratedAt: '2026-08-03T01:02:06.000Z',
    })
  })

  it('keeps semantic dates, relationship timing, truth hashes, warnings, gaps and stage drivers in the fingerprint', () => {
    const baseline = buildCandidate()
    const datedIntent = { ...consumerIntent(), requirements: [...consumerIntent().requirements, 'Decision deadline 2026-09-01'] }
    expect(buildCandidate({ consumerIntent: datedIntent }).planFingerprint).not.toBe(baseline.planFingerprint)

    const relationship = makeBinding()
    relationship.dependencyGraph.edges[0].requiredAt = 'ACTIVATION'
    expect(buildCandidate({ binding: relationship }).planFingerprint).not.toBe(baseline.planFingerprint)

    const truth = makeRuntime()
    truth.framework_state.sections.customer_context.accepted.truthHash = `sha256:${'9'.repeat(64)}`
    expect(buildCandidate({ runtime: truth }).planFingerprint).not.toBe(baseline.planFingerprint)

    const warning = makeBinding()
    warning.warnings = [{ code: 'QA_WARNING' }]
    expect(buildCandidate({ binding: warning }).planFingerprint).not.toBe(baseline.planFingerprint)

    const stageDriver = makeBinding()
    stageDriver.selectedByLayer.STYLE[0].packType = 'RL'
    expect(buildCandidate({ binding: stageDriver }).planFingerprint).not.toBe(baseline.planFingerprint)
  })

  it('rejects an unlocked runtime and incomplete accepted truth', () => {
    const unlocked = makeRuntime()
    unlocked.status = 'ACTIVE'
    expect(() => buildCandidate({ runtime: unlocked })).toThrow(expect.objectContaining({ code: OUTCOME_KCP_ERROR_CODES.SOURCE_TRUTH_NOT_LOCKED }))
    const incomplete = makeRuntime()
    delete incomplete.framework_state.sections.customer_context.accepted.truthHash
    expect(() => buildCandidate({ runtime: incomplete })).toThrow(expect.objectContaining({ code: OUTCOME_KCP_ERROR_CODES.SOURCE_TRUTH_INCOMPLETE }))
  })

  it('rejects incomplete selected-pack lineage and a missing mandatory safeguard', () => {
    const invalidLineage = makeBinding()
    invalidLineage.selectedByLayer.STYLE[0].knowledgeAssetId = ''
    expect(() => buildCandidate({ binding: invalidLineage })).toThrow(expect.objectContaining({ code: OUTCOME_KCP_ERROR_CODES.RESOLUTION_INTEGRITY_INVALID }))
    const missingMandatory = makeBinding()
    missingMandatory.mandatorySafeguards.pop()
    expect(() => buildCandidate({ binding: missingMandatory })).toThrow(expect.objectContaining({ code: OUTCOME_KCP_ERROR_CODES.RESOLUTION_INTEGRITY_INVALID }))
  })

  it.each([
    ['packCategory', ''],
    ['purposeCategory', ''],
    ['knowledgeLayer', ''],
    ['schemaVersion', ''],
    ['scopeType', ''],
    ['executionMode', ''],
    ['visibility', ''],
    ['workspaceCompatibility', []],
  ])('rejects selected packs missing governed %s metadata', (field, value) => {
    const binding = makeBinding()
    binding.selectedByLayer.STYLE[0][field] = value
    expect(() => buildCandidate({ binding })).toThrow(expect.objectContaining({
      code: OUTCOME_KCP_ERROR_CODES.RESOLUTION_INTEGRITY_INVALID,
    }))
  })

  it.each([
    ['mandatorySafeguards', (binding, pack) => { binding.mandatorySafeguards[0] = pack }],
    ['selectedByLayer', (binding, pack) => { binding.selectedByLayer.STYLE[0] = pack }],
    ['excludedCandidates', (binding, pack) => { binding.excludedCandidates = [{ candidate: pack }] }],
    ['blockedPacks', (binding, pack) => { binding.blockedPacks = [pack] }],
    ['ambiguousCandidates', (binding, pack) => { binding.ambiguousCandidates = [{ candidates: [pack] }] }],
    ['incompatibleCandidates', (binding, pack) => { binding.incompatibleCandidates = [{ candidate: pack }] }],
  ])('rejects a candidate without activation identity on %s', (_surface, assign) => {
    const binding = makeBinding()
    const pack = { ...requestPacks().excluded, activationId: '' }
    assign(binding, pack)
    expect(() => buildCandidate({ binding })).toThrow(expect.objectContaining({
      code: OUTCOME_KCP_ERROR_CODES.RESOLUTION_INTEGRITY_INVALID,
    }))
  })

  it.each([
    ['packId', 'pack-conflict'],
    ['versionId', 'version-conflict'],
    ['contentHash', `sha256:${'f'.repeat(64)}`],
    ['relationshipChecksum', 'f'.repeat(64)],
    ['scopeKey', 'TENANT:QA'],
    ['executionMode', 'POST_VALIDATION'],
    ['packType', 'RL'],
  ])('rejects conflicting %s metadata for one activation identity', (field, value) => {
    const binding = makeBinding()
    const selectedStyle = binding.selectedByLayer.STYLE[0]
    binding.blockedPacks.push({ ...selectedStyle, [field]: value })
    expect(() => buildCandidate({ binding })).toThrow(expect.objectContaining({
      code: OUTCOME_KCP_ERROR_CODES.RESOLUTION_INTEGRITY_INVALID,
    }))
  })

  it('merges identical cross-surface activation evidence with selected precedence', () => {
    const binding = makeBinding()
    const selectedStyle = binding.selectedByLayer.STYLE[0]
    binding.blockedPacks.push({ ...selectedStyle, blockedReason: 'GENERAL_BINDABILITY_BLOCK' })
    const candidate = buildCandidate({ binding })
    const decision = candidate.payload.resolution.consideredPacks.find(
      (row) => row.activationId === selectedStyle.activationId,
    )

    expect(decision).toMatchObject({
      decision: 'SELECTED',
      sources: expect.arrayContaining(['RESOLVER_SELECTION', 'BLOCKED_PACK']),
      rationale: expect.arrayContaining(['GENERAL_BINDABILITY_BLOCK']),
    })
    expect(candidate.payload.resolution.consideredPackCoverage).toMatchObject({
      rawActivationOccurrenceCount: 12,
      exposedActivationCount: 10,
      classifiedActivationCount: 10,
      repeatedIdenticalActivationCount: 2,
      conflictingActivationCount: 0,
    })
  })

  it('retains each activation-less missing selector as one explicit MISSING decision', () => {
    const binding = makeBinding()
    binding.status = 'READY_WITH_GAPS'
    binding.missingDependencies = [{
      requirement: 'OPTIONAL',
      reason: 'OPTIONAL_DEPENDENCY_MISSING',
      selector: { targetKnowledgeLayer: 'STYLE', targetCapabilityKey: 'optional-style' },
      requiredBy: { activationId: 'activation-executive-brief' },
      relationship: { relationshipType: 'OPTIONAL', requiredAt: 'RUNTIME', cardinality: 'ZERO_OR_ONE' },
    }]
    const candidate = buildCandidate({ binding })
    const missing = candidate.payload.resolution.consideredPacks.filter(
      (decision) => decision.decision === 'MISSING',
    )

    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({
      decisionId: expect.stringMatching(/^missing-[a-f0-9]{24}$/),
      activationId: '',
      requirement: 'OPTIONAL',
      sources: ['MISSING_DEPENDENCY'],
      selector: { targetKnowledgeLayer: 'STYLE', targetCapabilityKey: 'optional-style' },
    })
    expect(candidate.payload.resolution.consideredPackCoverage).toMatchObject({
      missingDecisionCount: 1,
      unclassifiedCandidateCount: 0,
    })
  })

  it('keeps missing mandatory safeguard placeholders out of selected activation evidence', () => {
    const binding = makeBinding()
    binding.status = 'BLOCKED'
    binding.mandatorySafeguards[0] = {
      packCategory: 'OUTCOME',
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      label: 'Adaptive Reasoning Layer',
      status: 'MISSING',
      runtimeBindable: false,
    }
    binding.mandatorySafeguards[1] = {
      packCategory: 'OUTCOME',
      packType: 'RL',
      packKey: 'rendering-layer',
      label: 'Rendering Layer',
      status: 'MISSING',
      runtimeBindable: false,
    }
    binding.missingDependencies = [
      {
        requirement: 'REQUIRED',
        reason: 'MANDATORY_SAFEGUARD_MISSING',
        selector: { packType: 'ARL', packKey: 'adaptive-reasoning-layer' },
        requiredBy: 'MANDATORY_SAFEGUARD_POLICY',
      },
      {
        requirement: 'REQUIRED',
        reason: 'MANDATORY_SAFEGUARD_MISSING',
        selector: { packType: 'RL', packKey: 'rendering-layer' },
        requiredBy: 'MANDATORY_SAFEGUARD_POLICY',
      },
    ]

    const candidate = buildCandidate({ binding })
    const selectedPackKeys = candidate.payload.resolution.selectedPacks.map((pack) => pack.packKey)
    const missingDecisions = candidate.payload.resolution.consideredPacks.filter(
      (decision) => decision.decision === 'MISSING',
    )

    expect(candidate.status).toBe(OUTCOME_KCP_STATUSES.BLOCKED)
    expect(selectedPackKeys).not.toEqual(expect.arrayContaining([
      'adaptive-reasoning-layer',
      'rendering-layer',
    ]))
    expect(missingDecisions).toHaveLength(2)
    expect(missingDecisions.map((decision) => decision.selector)).toEqual(expect.arrayContaining([
      { packType: 'ARL', packKey: 'adaptive-reasoning-layer' },
      { packType: 'RL', packKey: 'rendering-layer' },
    ]))
    expect(candidate.payload.stagePlan.find(
      (stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
    ).assignedActivationIds).toEqual([])
    expect(candidate.payload.stagePlan.find(
      (stage) => stage.stageKey === OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    ).assignedActivationIds).toEqual([])
    expect(candidate.payload.stagePlan.flatMap((stage) => stage.assignedActivationIds)).not.toContain('')
    expect(candidate.payload.resolution.consideredPackCoverage).toMatchObject({
      missingDecisionCount: 2,
      unclassifiedCandidateCount: 0,
    })
  })

  it('counts optional missing dependencies and retained warnings exactly once', () => {
    const missing = {
      requirement: 'OPTIONAL',
      reason: 'OPTIONAL_DEPENDENCY_MISSING',
      selector: { targetKnowledgeLayer: 'STYLE', targetCapabilityKey: 'optional-style' },
    }
    const withoutWarning = makeBinding()
    withoutWarning.status = 'READY_WITH_GAPS'
    withoutWarning.missingDependencies = [missing]
    const candidateWithoutWarning = buildCandidate({ binding: withoutWarning })
    expect(candidateWithoutWarning).toMatchObject({ status: OUTCOME_KCP_STATUSES.READY_WITH_GAPS, gapCount: 2 })
    expect(candidateWithoutWarning.payload.optionalGapCount).toBe(2)

    const withWarning = makeBinding()
    withWarning.status = 'READY_WITH_GAPS'
    withWarning.missingDependencies = [missing]
    withWarning.warnings = [{ code: 'OPTIONAL_DEPENDENCY_MISSING' }]
    const candidateWithWarning = buildCandidate({ binding: withWarning })
    expect(candidateWithWarning).toMatchObject({ status: OUTCOME_KCP_STATUSES.READY_WITH_GAPS, gapCount: 3 })
    expect(candidateWithWarning.payload.optionalGapCount).toBe(3)
    expect(candidateWithWarning.payload.resolution.consideredPacks.filter(
      (decision) => decision.decision === 'MISSING',
    )).toHaveLength(1)
  })

  it('marks required and ambiguous resolver failures blocked while retaining their evidence', () => {
    const requiredGap = makeBinding()
    requiredGap.status = 'BLOCKED'
    requiredGap.missingDependencies = [{ requirement: 'REQUIRED', selector: { knowledgeAssetId: 'missing' } }]
    expect(buildCandidate({ binding: requiredGap }).status).toBe(OUTCOME_KCP_STATUSES.BLOCKED)

    const ambiguous = makeBinding()
    const candidatePack = requestPacks().excluded
    ambiguous.status = 'AMBIGUOUS'
    ambiguous.ambiguousCandidates = [{ reason: 'EXACT_TIE', candidates: [candidatePack] }]
    const result = buildCandidate({ binding: ambiguous })
    expect(result.status).toBe(OUTCOME_KCP_STATUSES.BLOCKED)
    expect(result.payload.resolution.consideredPacks.filter((decision) => decision.activationId === candidatePack.activationId)).toHaveLength(1)
  })

  it('normalizes model fields and declares immutable unique history indexes', async () => {
    const candidate = buildCandidate()
    const doc = new OutcomeKnowledgeCompositionPlan({
      planId: ' plan-qa ',
      planVersion: 1,
      operation: OUTCOME_KCP_OPERATIONS.INITIAL,
      status: candidate.status,
      tenantId: ids.tenant,
      customerId: ids.customer,
      runtimeInstanceId: ids.runtime,
      runtimeInstanceKey: ' VALUE-NARRATIVE-QA ',
      runtimeType: 'value_narrative',
      frameworkKey: 'vmf',
      packageKey: 'standard-package-vmf-3-1-3-rkm',
      packageVersion: '3.1.3',
      requestedOutputTypeKey: 'EXECUTIVE-BRIEF',
      publishSnapshotId: 'publish-snapshot-qa',
      lockSnapshotId: 'lock-snapshot-qa',
      replayAnchorId: 'replay-anchor-qa',
      dependencySnapshotId: 'dependency-snapshot-qa',
      planFingerprint: candidate.planFingerprint,
      resolutionFingerprint: candidate.resolutionFingerprint,
      contextFingerprint: candidate.contextFingerprint,
      selectedPackCount: candidate.selectedPackCount,
      consideredPackCount: candidate.consideredPackCount,
      gapCount: candidate.gapCount,
      payload: candidate.payload,
      createdBy: ids.actor,
    })
    await doc.validate()
    expect(doc.runtimeInstanceKey).toBe('value-narrative-qa')
    expect(doc.frameworkKey).toBe('VMF')
    expect(doc.toJSON()).not.toHaveProperty('_id')
    const indexes = OutcomeKnowledgeCompositionPlan.schema.indexes()
    expect(indexes).toEqual(expect.arrayContaining([
      [{ planId: 1 }, expect.objectContaining({ unique: true, name: 'uniq_outcome_kcp_plan_id' })],
      [{ runtimeInstanceId: 1, planVersion: 1 }, expect.objectContaining({ unique: true, name: 'uniq_outcome_kcp_runtime_version' })],
    ]))
  })

  it.each(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'])('rejects append-only %s operations', async (operation) => {
    const query = operation.includes('delete')
      ? OutcomeKnowledgeCompositionPlan[operation]({ planId: 'plan-qa' })
      : OutcomeKnowledgeCompositionPlan[operation]({ planId: 'plan-qa' }, { $set: { status: 'READY' } })
    await expect(query.exec()).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.IMMUTABLE, status: 409 })
  })

  it('rejects an apply fingerprint mismatch before opening a session', async () => {
    const state = makePersistenceDeps()
    await expect(createOutcomeKnowledgeCompositionPlan({
      runtimeInstanceId: ids.runtime,
      expectedRuntimeUpdatedAt: runtimeUpdatedAt,
      consumerIntent: consumerIntent(),
      actorUserId: ids.actor,
      expectedPlanFingerprint: '0'.repeat(64),
      deps: state.deps,
    })).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.FINGERPRINT_MISMATCH })
    expect(state.deps.mongoose.startSession).not.toHaveBeenCalled()
  })

  it('creates version 1 and a compact same-session audit', async () => {
    const dry = buildCandidate()
    const state = makePersistenceDeps()
    const result = await createOutcomeKnowledgeCompositionPlan({
      runtimeInstanceId: ids.runtime,
      expectedRuntimeUpdatedAt: runtimeUpdatedAt,
      consumerIntent: consumerIntent(),
      actorUserId: ids.actor,
      expectedPlanFingerprint: dry.planFingerprint,
      expectedCurrentPlanVersion: 0,
      deps: state.deps,
    })
    expect(result.idempotent).toBe(false)
    expect(result.plan).toMatchObject({ planVersion: 1, planFingerprint: dry.planFingerprint })
    expect(state.saved).toHaveLength(1)
    expect(state.audit.log).toHaveBeenCalledTimes(1)
    const [auditPayload, auditOptions] = state.audit.log.mock.calls[0]
    expect(auditOptions).toMatchObject({ session: state.session, throwOnError: true })
    expect(auditPayload.diff).toEqual(expect.objectContaining({
      planVersion: 1,
      planFingerprint: dry.planFingerprint,
      selectedPackCount: dry.selectedPackCount,
    }))
    expect(JSON.stringify(auditPayload.diff)).not.toMatch(/customer_context|payload|prompt|hidden/i)
  })

  it('returns the existing identical initial plan without a write or audit', async () => {
    const dry = buildCandidate()
    const existing = {
      _id: ids.plan,
      planId: 'outcome_kcp_existing',
      planVersion: 1,
      planFingerprint: dry.planFingerprint,
      payload: dry.payload,
    }
    const state = makePersistenceDeps({ latest: existing })
    const result = await createOutcomeKnowledgeCompositionPlan({
      runtimeInstanceId: ids.runtime,
      expectedRuntimeUpdatedAt: runtimeUpdatedAt,
      consumerIntent: consumerIntent(),
      actorUserId: ids.actor,
      expectedPlanFingerprint: dry.planFingerprint,
      expectedCurrentPlanVersion: 0,
      deps: state.deps,
    })
    expect(result.idempotent).toBe(true)
    expect(state.saved).toHaveLength(0)
    expect(state.audit.log).not.toHaveBeenCalled()
  })

  it('fails closed when audit persistence fails in the transaction', async () => {
    const dry = buildCandidate()
    const state = makePersistenceDeps({ auditError: new Error('audit unavailable') })
    await expect(createOutcomeKnowledgeCompositionPlan({
      runtimeInstanceId: ids.runtime,
      expectedRuntimeUpdatedAt: runtimeUpdatedAt,
      consumerIntent: consumerIntent(),
      actorUserId: ids.actor,
      expectedPlanFingerprint: dry.planFingerprint,
      deps: state.deps,
    })).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.AUDIT_FAILED })
    expect(state.session.withTransaction).toHaveBeenCalledTimes(1)
    expect(state.saved).toHaveLength(1)
  })

  it('maps a unique-index race to the stable version conflict', async () => {
    const dry = buildCandidate()
    const duplicate = Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
    const state = makePersistenceDeps({ saveError: duplicate })
    await expect(createOutcomeKnowledgeCompositionPlan({
      runtimeInstanceId: ids.runtime,
      expectedRuntimeUpdatedAt: runtimeUpdatedAt,
      consumerIntent: consumerIntent(),
      actorUserId: ids.actor,
      expectedPlanFingerprint: dry.planFingerprint,
      deps: state.deps,
    })).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.VERSION_CONFLICT })
    expect(state.audit.log).not.toHaveBeenCalled()
  })

  it('requires exact changed predecessor evidence for re-resolution', async () => {
    const dry = buildCandidate()
    const existing = {
      _id: ids.plan,
      planId: 'outcome_kcp_existing',
      planVersion: 1,
      planFingerprint: dry.planFingerprint,
      payload: dry.payload,
    }
    const state = makePersistenceDeps({ latest: existing })
    await expect(createOutcomeKnowledgeCompositionPlan({
      runtimeInstanceId: ids.runtime,
      expectedRuntimeUpdatedAt: runtimeUpdatedAt,
      consumerIntent: consumerIntent(),
      actorUserId: ids.actor,
      expectedPlanFingerprint: dry.planFingerprint,
      expectedCurrentPlanVersion: 1,
      operation: OUTCOME_KCP_OPERATIONS.RE_RESOLUTION,
      sourcePlanId: existing.planId,
      sourcePlanFingerprint: existing.planFingerprint,
      reResolutionReason: 'Re-resolve after governed input change.',
      deps: state.deps,
    })).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.IDENTICAL_RE_RESOLUTION })
    expect(state.saved).toHaveLength(0)
  })

  it('creates version 2 with exact predecessor lineage for changed governed meaning', async () => {
    const source = buildCandidate()
    const changedIntent = {
      ...consumerIntent(),
      decisionPurpose: 'Support a changed governed executive decision.',
    }
    const changed = buildCandidate({ consumerIntent: changedIntent })
    expect(changed.planFingerprint).not.toBe(source.planFingerprint)
    const existing = {
      _id: ids.plan,
      planId: 'outcome_kcp_existing',
      planVersion: 1,
      planFingerprint: source.planFingerprint,
      payload: source.payload,
    }
    const state = makePersistenceDeps({ latest: existing })
    const result = await createOutcomeKnowledgeCompositionPlan({
      runtimeInstanceId: ids.runtime,
      expectedRuntimeUpdatedAt: runtimeUpdatedAt,
      consumerIntent: changedIntent,
      actorUserId: ids.actor,
      expectedPlanFingerprint: changed.planFingerprint,
      expectedCurrentPlanVersion: 1,
      operation: OUTCOME_KCP_OPERATIONS.RE_RESOLUTION,
      sourcePlanId: existing.planId,
      sourcePlanFingerprint: existing.planFingerprint,
      reResolutionReason: 'Re-resolve after governed meaning changed.',
      deps: state.deps,
    })

    expect(result.idempotent).toBe(false)
    expect(result.plan).toMatchObject({
      planVersion: 2,
      planFingerprint: changed.planFingerprint,
      sourcePlanId: existing.planId,
      sourcePlanFingerprint: existing.planFingerprint,
      reResolutionReason: 'Re-resolve after governed meaning changed.',
    })
    expect(state.saved).toHaveLength(1)
    expect(state.audit.log).toHaveBeenCalledTimes(1)
    expect(state.audit.log.mock.calls[0][1]).toMatchObject({
      session: state.session,
      throwOnError: true,
    })
  })

  it.each([
    ['wrong source plan id', { sourcePlanId: 'outcome_kcp_wrong' }],
    ['wrong source fingerprint', { sourcePlanFingerprint: 'f'.repeat(64) }],
    ['missing re-resolution reason', { reResolutionReason: '' }],
  ])('rejects %s without saving or auditing', async (_label, overrides) => {
    const source = buildCandidate()
    const changedIntent = {
      ...consumerIntent(),
      decisionPurpose: 'Support a changed governed executive decision.',
    }
    const changed = buildCandidate({ consumerIntent: changedIntent })
    const existing = {
      _id: ids.plan,
      planId: 'outcome_kcp_existing',
      planVersion: 1,
      planFingerprint: source.planFingerprint,
      payload: source.payload,
    }
    const state = makePersistenceDeps({ latest: existing })

    await expect(createOutcomeKnowledgeCompositionPlan({
      runtimeInstanceId: ids.runtime,
      expectedRuntimeUpdatedAt: runtimeUpdatedAt,
      consumerIntent: changedIntent,
      actorUserId: ids.actor,
      expectedPlanFingerprint: changed.planFingerprint,
      expectedCurrentPlanVersion: 1,
      operation: OUTCOME_KCP_OPERATIONS.RE_RESOLUTION,
      sourcePlanId: existing.planId,
      sourcePlanFingerprint: existing.planFingerprint,
      reResolutionReason: 'Re-resolve after governed meaning changed.',
      ...overrides,
      deps: state.deps,
    })).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.PREDECESSOR_INVALID })
    expect(state.saved).toHaveLength(0)
    expect(state.audit.log).not.toHaveBeenCalled()
  })

  it('rejects an optimistic current-version mismatch before save or audit', async () => {
    const source = buildCandidate()
    const changedIntent = {
      ...consumerIntent(),
      decisionPurpose: 'Support a changed governed executive decision.',
    }
    const changed = buildCandidate({ consumerIntent: changedIntent })
    const existing = {
      _id: ids.plan,
      planId: 'outcome_kcp_existing',
      planVersion: 2,
      planFingerprint: source.planFingerprint,
      payload: source.payload,
    }
    const state = makePersistenceDeps({ latest: existing })

    await expect(createOutcomeKnowledgeCompositionPlan({
      runtimeInstanceId: ids.runtime,
      expectedRuntimeUpdatedAt: runtimeUpdatedAt,
      consumerIntent: changedIntent,
      actorUserId: ids.actor,
      expectedPlanFingerprint: changed.planFingerprint,
      expectedCurrentPlanVersion: 1,
      operation: OUTCOME_KCP_OPERATIONS.RE_RESOLUTION,
      sourcePlanId: existing.planId,
      sourcePlanFingerprint: existing.planFingerprint,
      reResolutionReason: 'Re-resolve after governed meaning changed.',
      deps: state.deps,
    })).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.VERSION_CONFLICT })
    expect(state.saved).toHaveLength(0)
    expect(state.audit.log).not.toHaveBeenCalled()
  })
})
