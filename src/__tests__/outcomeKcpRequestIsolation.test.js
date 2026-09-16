import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { jest, beforeAll, afterAll } from '@jest/globals'
import { OUTCOME_KCP_ERROR_CODES, OUTCOME_KCP_OPERATIONS, OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION, OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION } from '../constants/outcomeGovernedQuality.js'
import OutcomeKnowledgeCompositionPlan from '../models/OutcomeKnowledgeCompositionPlan.js'
import AuditLog from '../models/AuditLog.js'
import { RuntimeInstance } from '../models/index.js'
import {
  assertOutcomeKnowledgeCompositionPlanIntegrity, assertLegacyOutcomeKnowledgeCompositionPlan,
  assertOutcomeKcpRequestIndexes, assertOutcomeKcpLegacyIndexes, buildOutcomeKnowledgeCompositionPlanCandidate,
  buildOutcomeKnowledgeCompositionPlanForRuntime, createOutcomeKnowledgeCompositionPlan,
  getOutcomeRequestKnowledgeCompositionPlan, hashOutcomeKnowledgeCompositionSemanticValue,
} from '../services/outcomeKnowledgeCompositionPlanService.js'
import { executeOutcomeFrameworkGuidance } from '../services/outcomeFrameworkGuidanceExecutionService.js'
import { executeOutcomeWorkingDraft } from '../services/outcomeWorkingDraftExecutionService.js'
import { executeOutcomeRenderedExpressionRl } from '../services/outcomeRenderedExpressionRlExecutionService.js'
import { approveOutcomeWorkingDraftMeaning } from '../services/outcomeArlMeaningReviewService.js'
import { createOutcomeNarrativePlan } from '../services/outcomePostArlQualityChainService.js'
import { createOutcomeQualityStageExecution } from '../services/outcomeQualityStageExecutionService.js'

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
    policyVersion: '2.0.0',
    mandatorySafeguards: safeguards.filter((pack) => ['ARL', 'TRUTH_CERTIFICATION'].includes(pack.packType)),
    selectedByLayer: {
      COMMUNICATION_PATTERN: [safeguards[1]],
      VALIDATION: [packs.truthDependency],
      OUTPUT_TYPE: [safeguards[4], packs.outputType],
      OUTPUT_SCHEMA: [safeguards[2], packs.outputSchema],
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

const newScope = () => ({ requestId: randomUUID(), runtimeInstanceId: ids.runtime, tenantId: ids.tenant, customerId: ids.customer })
const goodIndexes = () => [{ name: 'uniq_outcome_kcp_request_version', key: { runtimeInstanceId: 1, requestId: 1, planVersion: 1 }, unique: true }]
const matches = (row, filter) => Object.entries(filter).every(([key, value]) => value?.$exists !== undefined
  ? Object.prototype.hasOwnProperty.call(row, key) === value.$exists
  : String(row[key] ?? '') === String(value ?? ''))
const queryOf = (read) => {
  let sort
  const query = { sort: jest.fn((value) => { sort = value; return query }), session: jest.fn(() => query),
    lean: jest.fn(async () => read(sort)), then: (resolve, reject) => Promise.resolve().then(() => read(sort)).then(resolve, reject) }
  return query
}
const memoryState = () => {
  const state = { rows: [], audits: [], runtime: makeRuntime(), binding: makeBinding(), context: makeContext() }
  function Model(payload) {
    Object.assign(this, { sourcePlanId: '', sourcePlanFingerprint: '', reResolutionReason: '' }, payload)
    this._id = new mongoose.Types.ObjectId()
    this.save = async () => { state.rows.push(this); return this }
  }
  Model.findOne = jest.fn((filter) => queryOf((sort) => {
    const rows = state.rows.filter((row) => matches(row, filter))
    return (sort ? rows.sort((a, b) => b.planVersion - a.planVersion) : rows)[0] || null
  }))
  Model.collection = { listIndexes: jest.fn(() => ({ toArray: async () => goodIndexes() })) }
  state.session = { endSession: jest.fn(), withTransaction: async (fn) => {
    const rows = [...state.rows], audits = [...state.audits]
    try { return await fn() } catch (error) { state.rows = rows; state.audits = audits; throw error }
  } }
  state.deps = {
    OutcomeKnowledgeCompositionPlan: Model,
    RuntimeInstance: { findById: jest.fn(() => queryOf(() => state.runtime)) },
    mongoose: { startSession: jest.fn(async () => state.session) }, assertTransactionSupport: jest.fn(),
    assertRuntimePermission: jest.fn(async () => {}),
    resolveBinding: jest.fn(async () => ({ binding: state.binding })),
    resolveContext: jest.fn(async () => ({ context: state.context })),
    auditService: { AUDIT_ACTIONS: { OUTCOME_KNOWLEDGE_COMPOSITION_PLAN_CREATED: 'OUTCOME_KNOWLEDGE_COMPOSITION_PLAN_CREATED' },
      RESOURCE_TYPES: { OutcomeKnowledgeCompositionPlan: 'OutcomeKnowledgeCompositionPlan' },
      log: jest.fn(async (entry) => { state.audits.push(entry); return entry }) },
  }
  return state
}
const requestArgs = (state, scope = newScope(), intent = consumerIntent()) => ({
  actorUserId: ids.actor, scopes: { fixture: 'trusted-scope' }, runtimeInstanceId: ids.runtime,
  requestScope: scope, expectedRuntimeUpdatedAt: runtimeUpdatedAt, consumerIntent: intent,
  expectedPlanFingerprint: buildOutcomeKnowledgeCompositionPlanCandidate({
    runtime: state.runtime, binding: state.binding, context: state.context, consumerIntent: intent, requestScope: scope,
  }).planFingerprint,
  deps: state.deps,
})
const nextArgs = (state, original, plan) => ({
  ...requestArgs(state, original.requestScope, { ...original.consumerIntent, outcome: 'Changed explicit outcome' }),
  operation: 'RE_RESOLUTION', expectedCurrentPlanVersion: plan.planVersion,
  sourcePlanId: plan.planId, sourcePlanFingerprint: plan.planFingerprint, reResolutionReason: 'Explicit changed request intent',
})

describe('request KCP isolation unit contract', () => {
  it('preserves legacy fingerprint shape while binding request identity in hash, serialization and audit', async () => {
    const state = memoryState(), args = requestArgs(state)
    const legacy = buildCandidate()
    expect(legacy.payload).not.toHaveProperty('requestId')
    expect(legacy.planFingerprint).toBe(hashOutcomeKnowledgeCompositionSemanticValue(legacy.payload))
    const result = await createOutcomeKnowledgeCompositionPlan(args)
    expect(result.plan.requestId).toBe(args.requestScope.requestId)
    expect(result.plan.planFingerprint).not.toBe(legacy.planFingerprint)
    expect(result.execution).toMatchObject({ status: 'BLOCKED', canExecute: false })
    expect(result.currentness).toMatchObject({ latestInRequest: true, current: false, evidenceStatus: 'NOT_REVALIDATED' })
    expect(state.audits[0].diff.requestId).toBe(args.requestScope.requestId)
    expect(state.deps.assertRuntimePermission).toHaveBeenCalledTimes(3)
    for (const [call] of state.deps.assertRuntimePermission.mock.calls) expect(call).toMatchObject({ actorUserId: ids.actor, scopes: args.scopes, customerId: ids.customer, tenantId: ids.tenant })
  })
  it('reads request-scoped runtime evidence through the transaction session during persistence revalidation', async () => {
    const state = memoryState()
    state.runtime.planningEvidence = {}
    const evidenceReader = jest.fn(async () => state.runtime)
    state.deps.readKcpRuntimeEvidence = evidenceReader
    const args = requestArgs(state)

    await createOutcomeKnowledgeCompositionPlan(args)

    expect(evidenceReader).toHaveBeenCalledTimes(3)
    expect(evidenceReader).toHaveBeenLastCalledWith(expect.objectContaining({ session: state.session }))
  })
  it('gives distinct identical requests independent version one histories', async () => {
    const state = memoryState()
    const one = await createOutcomeKnowledgeCompositionPlan(requestArgs(state))
    const two = await createOutcomeKnowledgeCompositionPlan(requestArgs(state))
    expect(one.plan.planVersion).toBe(1); expect(two.plan.planVersion).toBe(1)
    expect(one.plan.planId).not.toBe(two.plan.planId)
    expect(one.plan.planFingerprint).not.toBe(two.plan.planFingerprint)
    expect(state.audits).toHaveLength(2)
  })
  it('reuses original and successor exact retries after re-resolution without resolving current evidence', async () => {
    const state = memoryState(), args = requestArgs(state)
    const first = await createOutcomeKnowledgeCompositionPlan(args)
    const successorArgs = nextArgs(state, args, first.plan)
    const second = await createOutcomeKnowledgeCompositionPlan(successorArgs)
    state.context.status = 'BLOCKED'
    state.runtime.updatedAt = new Date('2026-09-16T12:00:00Z')
    state.deps.resolveBinding.mockClear()
    const retry = await createOutcomeKnowledgeCompositionPlan(args)
    expect(retry.plan).toEqual(first.plan)
    expect(retry).toMatchObject({ idempotent: true, currentness: { latestInRequest: false, current: false }, execution: { canExecute: false } })
    expect((await createOutcomeKnowledgeCompositionPlan(successorArgs)).plan).toEqual(second.plan)
    expect(state.deps.resolveBinding).not.toHaveBeenCalled()
    expect(state.rows).toHaveLength(2); expect(state.audits).toHaveLength(2)
  })
  it('requires explicit re-resolution for changed intent and rejects forged retry fingerprint', async () => {
    const state = memoryState(), args = requestArgs(state)
    await createOutcomeKnowledgeCompositionPlan(args)
    const changed = requestArgs(state, args.requestScope, { ...args.consumerIntent, outcome: 'Changed' })
    await expect(createOutcomeKnowledgeCompositionPlan(changed)).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.VERSION_CONFLICT })
    await expect(createOutcomeKnowledgeCompositionPlan({ ...args, consumerIntent: changed.consumerIntent })).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.FINGERPRINT_MISMATCH })
    expect(state.rows).toHaveLength(1)
  })
  it.each(['tenantId', 'customerId', 'runtimeInstanceId'])('rejects wrong request %s before writes or retry reuse', async (field) => {
    const state = memoryState(), args = requestArgs(state)
    await createOutcomeKnowledgeCompositionPlan(args)
    args.requestScope = { ...args.requestScope, [field]: new mongoose.Types.ObjectId() }
    await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ status: 422 })
    await expect(getOutcomeRequestKnowledgeCompositionPlan({ ...args, planId: state.rows[0].planId })).rejects.toMatchObject({ status: 422 })
    expect(state.rows).toHaveLength(1)
  })
  it.each([null, '', 'not-a-uuid'])('rejects malformed request identity %s', async (requestId) => {
    const state = memoryState(), args = requestArgs(state)
    args.requestScope.requestId = requestId
    await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ status: 422 })
    expect(state.rows).toHaveLength(0)
  })
  it('rejects read and retry after permission revocation with no audit or resolver call', async () => {
    const state = memoryState(), args = requestArgs(state)
    const first = await createOutcomeKnowledgeCompositionPlan(args)
    state.deps.assertRuntimePermission.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }))
    state.deps.resolveBinding.mockClear()
    await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ status: 403 })
    await expect(getOutcomeRequestKnowledgeCompositionPlan({ ...args, planId: first.plan.planId })).rejects.toMatchObject({ status: 403 })
    expect(state.audits).toHaveLength(1); expect(state.deps.resolveBinding).not.toHaveBeenCalled()
  })
  it('uses DEAL_UPDATE and DEAL_VIEW for request-scoped deal runtimes', async () => {
    const state = memoryState(); state.runtime.runtimeType = 'DEAL_ANALYSIS'
    const args = requestArgs(state), result = await createOutcomeKnowledgeCompositionPlan(args)
    await getOutcomeRequestKnowledgeCompositionPlan({ ...args, planId: result.plan.planId })
    expect(state.deps.assertRuntimePermission.mock.calls.map(([call]) => call.permission)).toEqual(['DEAL_UPDATE', 'DEAL_VIEW', 'DEAL_VIEW', 'DEAL_VIEW'])
  })
  it('cannot retrieve another request plan for a user shared across customers', async () => {
    const state = memoryState(), args = requestArgs(state), first = await createOutcomeKnowledgeCompositionPlan(args)
    await expect(getOutcomeRequestKnowledgeCompositionPlan({ ...args, requestScope: newScope(), planId: first.plan.planId })).rejects.toMatchObject({ status: 404 })
    state.runtime = { ...state.runtime, customerId: new mongoose.Types.ObjectId() }
    const otherScope = { ...args.requestScope, customerId: state.runtime.customerId }
    await expect(getOutcomeRequestKnowledgeCompositionPlan({ ...args, requestScope: otherScope, planId: first.plan.planId })).rejects.toMatchObject({ status: 404 })
  })
  it.each(['outcome', 'decisionPurpose', 'consumer', 'audience', 'requestedOutputTypeKey', 'format'])('missing %s is clarification/no write, never a default', async (field) => {
    const state = memoryState(), args = requestArgs(state)
    delete args.consumerIntent[field]
    await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ status: 422 })
    expect(state.rows).toHaveLength(0); expect(state.audits).toHaveLength(0)
  })
  it('BLOCKED never persists and neither does changed current evidence', async () => {
    const state = memoryState(); state.context.status = 'BLOCKED'
    const args = requestArgs(state)
    await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.RESOLUTION_BLOCKED })
    expect(state.rows).toHaveLength(0)
    state.context.status = 'READY'
    const ready = requestArgs(state)
    state.deps.resolveContext.mockImplementationOnce(async () => ({ context: state.context }))
      .mockImplementationOnce(async () => ({ context: { ...state.context,
        outputSchema: { ...state.context.outputSchema, version: '2.0.0' } } }))
    await expect(createOutcomeKnowledgeCompositionPlan(ready)).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.FINGERPRINT_MISMATCH })
    expect(state.rows).toHaveLength(0)
  })
  it('rejects cross-request predecessors and identical re-resolution', async () => {
    const state = memoryState(), args = requestArgs(state)
    const first = await createOutcomeKnowledgeCompositionPlan(args)
    const other = await createOutcomeKnowledgeCompositionPlan(requestArgs(state))
    await expect(createOutcomeKnowledgeCompositionPlan(nextArgs(state, args, other.plan))).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.PREDECESSOR_INVALID })
    await expect(createOutcomeKnowledgeCompositionPlan({ ...nextArgs(state, args, first.plan), consumerIntent: args.consumerIntent, expectedPlanFingerprint: args.expectedPlanFingerprint })).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.IDENTICAL_RE_RESOLUTION })
  })
  it('binds mirror request identity and rejects stripping/injecting it', async () => {
    const state = memoryState(), result = await createOutcomeKnowledgeCompositionPlan(requestArgs(state))
    const plan = structuredClone(result.plan)
    plan.requestId = randomUUID()
    expect(() => assertOutcomeKnowledgeCompositionPlanIntegrity(plan)).toThrow()
    delete plan.requestId
    expect(() => assertOutcomeKnowledgeCompositionPlanIntegrity(plan)).toThrow()
    expect(() => assertLegacyOutcomeKnowledgeCompositionPlan(result.plan)).toThrow()
    expect(() => assertLegacyOutcomeKnowledgeCompositionPlan(makePlanRecord())).not.toThrow()
  })
  it('disables model auto-indexing and validates null/empty identities', async () => {
    expect(OutcomeKnowledgeCompositionPlan.schema.options.autoIndex).toBe(false)
    for (const requestId of [null, '']) await expect(new OutcomeKnowledgeCompositionPlan({ ...makePlanRecord(), requestId }).validate()).rejects.toThrow()
  })
  it.each(['missing', 'old-key', 'old-name', 'nonunique', 'partial', 'sparse', 'hidden', 'collated', 'wrong-order'])('index guard rejects %s without DDL', async (kind) => {
    const indexes = goodIndexes()
    if (kind === 'missing') indexes.length = 0
    if (kind === 'old-key') indexes.push({ key: { runtimeInstanceId: 1, planVersion: 1 }, unique: true })
    if (kind === 'old-name') indexes.push({ name: 'uniq_outcome_kcp_runtime_version', key: { x: 1 } })
    if (kind === 'nonunique') indexes[0].unique = false
    if (kind === 'partial') indexes[0].partialFilterExpression = { requestId: { $exists: true } }
    if (kind === 'sparse') indexes[0].sparse = true
    if (kind === 'hidden') indexes[0].hidden = true
    if (kind === 'collated') indexes[0].collation = { locale: 'en' }
    if (kind === 'wrong-order') indexes[0].key = { requestId: 1, runtimeInstanceId: 1, planVersion: 1 }
    await expect(assertOutcomeKcpRequestIndexes({ collection: { listIndexes: () => ({ toArray: async () => indexes }) } })).rejects.toMatchObject({ status: 503, details: { field: 'requestIndexes' } })
  })
  it('rejects unavailable indexes before opening a transaction', async () => {
    const state = memoryState(), args = requestArgs(state)
    state.deps.OutcomeKnowledgeCompositionPlan.collection.listIndexes.mockImplementation(() => { throw new Error('unavailable') })
    await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ status: 503 })
    expect(state.deps.mongoose.startSession).not.toHaveBeenCalled()
  })
  it.each(['missing', 'nonunique', 'partial', 'sparse', 'hidden', 'collated'])('legacy write rejects %s indexes before any persistence', async (kind) => {
    const state = memoryState(), args = requestArgs(state)
    delete args.requestScope; args.expectedPlanFingerprint = buildCandidate().planFingerprint
    const indexes = [{ key: { runtimeInstanceId: 1, planVersion: 1 }, unique: true }]
    if (kind === 'missing') indexes.length = 0
    if (kind === 'nonunique') indexes[0].unique = false
    if (kind === 'partial') indexes[0].partialFilterExpression = { planVersion: { $gt: 0 } }
    if (kind === 'sparse') indexes[0].sparse = true
    if (kind === 'hidden') indexes[0].hidden = true
    if (kind === 'collated') indexes[0].collation = { locale: 'en' }
    state.deps.OutcomeKnowledgeCompositionPlan.collection.listIndexes.mockReturnValue({ toArray: async () => indexes })
    await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ status: 503 })
    expect(state.rows).toHaveLength(0); expect(state.audits).toHaveLength(0)
    expect(state.deps.mongoose.startSession).not.toHaveBeenCalled()
  })
  it.each(['legacy', 'request'])('legacy write accepts full unique %s index and rechecks inside transaction', async (kind) => {
    const state = memoryState(), args = requestArgs(state)
    delete args.requestScope; args.expectedPlanFingerprint = buildCandidate().planFingerprint
    const indexes = kind === 'legacy' ? [{ key: { runtimeInstanceId: 1, planVersion: 1 }, unique: true }] : goodIndexes()
    const list = state.deps.OutcomeKnowledgeCompositionPlan.collection.listIndexes.mockReturnValue({ toArray: async () => indexes })
    expect((await createOutcomeKnowledgeCompositionPlan(args)).plan.planVersion).toBe(1)
    expect(list).toHaveBeenCalledTimes(2)
    expect(state.audits).toHaveLength(1)
  })
  it.each(['legacy', 'request'])('%s fails closed if the qualifying index disappears inside transaction', async (kind) => {
    const state = memoryState(), args = requestArgs(state)
    if (kind === 'legacy') { delete args.requestScope; args.expectedPlanFingerprint = buildCandidate().planFingerprint }
    state.deps.OutcomeKnowledgeCompositionPlan.collection.listIndexes
      .mockReturnValueOnce({ toArray: async () => goodIndexes() })
      .mockReturnValueOnce({ toArray: async () => [] })
    await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ status: 503 })
    expect(state.rows).toHaveLength(0); expect(state.audits).toHaveLength(0)
  })
})

describe('all six legacy execution owners reject request plans', () => {
  it.each([
    ['guidance', executeOutcomeFrameworkGuidance], ['draft', executeOutcomeWorkingDraft],
    ['RL', executeOutcomeRenderedExpressionRl], ['ARL', approveOutcomeWorkingDraftMeaning],
    ['postARL', createOutcomeNarrativePlan], ['quality', createOutcomeQualityStageExecution],
  ])('%s rejects even a dependency returning a request row despite the legacy filter', async (name, execute) => {
    const state = memoryState(), result = await createOutcomeKnowledgeCompositionPlan(requestArgs(state))
    const readPlan = jest.fn(() => queryOf(() => result.plan))
    const provider = jest.fn()
    provider.configurationVersion = name === 'RL' ? OUTCOME_RENDERED_EXPRESSION_RL_PROVIDER_CONFIG_VERSION : OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION
    const stageRead = jest.fn(), write = jest.fn()
    await expect(execute({ actorUserId: ids.actor, runtimeInstanceId: ids.runtime, planRecordId: ids.plan,
      expectedPlanFingerprint: result.plan.planFingerprint, expectedAttemptFingerprint: 'a'.repeat(64),
      providerAdapter: provider, providerAdapterFactory: provider,
      providerDescriptor: { providerKey: 'openai', model: 'synthetic-no-call', providerMode: 'LIVE_TEST', environment: 'TEST', safeContextPolicyKey: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1', failurePosture: 'FAIL_CLOSED' },
      deps: { OutcomeKnowledgeCompositionPlan: { findOne: readPlan }, RuntimeInstance: { findOne: () => queryOf(() => makeRuntime()) },
        OutcomeQualityStageExecution: { findOne: stageRead, create: write }, assertTransactionSupport: jest.fn(), assertOutcomeQualityStageTransactionSupport: jest.fn() },
    })).rejects.toMatchObject({ status: 409 })
    expect(readPlan).toHaveBeenCalledTimes(2)
    for (const [filter] of readPlan.mock.calls) expect(filter.requestId).toEqual({ $exists: false })
    expect(provider).not.toHaveBeenCalled(); expect(stageRead).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled()
  })
})

// Only the dedicated launcher may enable real persistence. No .env URI is used.
const localUri = process.env.KCP_ISOLATION_TEST_URI
const standalone = process.env.KCP_ISOLATION_STANDALONE === 'true'
const real = localUri ? it : it.skip
const replica = localUri && !standalone ? it : it.skip
const single = localUri && standalone ? it : it.skip
beforeAll(async () => {
  if (!localUri) return
  const expected = `mongodb://127.0.0.1:${process.env.KCP_ISOLATION_PORT}/${process.env.KCP_ISOLATION_DATABASE}${standalone ? '' : '?replicaSet=kcp_isolation'}`
  if (localUri !== expected || !/^mongodb:\/\/127\.0\.0\.1:\d+\/kcp_isolation_\d+(\?replicaSet=kcp_isolation)?$/.test(localUri)) throw new Error('Fresh exact loopback test identity required')
  await mongoose.connect(localUri, { autoIndex: false, autoCreate: false })
  expect(mongoose.connection.getClient().topology.description.type).toBe(standalone ? 'Single' : 'ReplicaSetWithPrimary')
  await OutcomeKnowledgeCompositionPlan.createCollection()
  await AuditLog.createCollection()
  // Local synthetic DDL is explicit; the application never runs this operation.
  await OutcomeKnowledgeCompositionPlan.createIndexes()
  await RuntimeInstance.collection.insertOne(makeRuntime())
}, 30000)
afterAll(async () => { if (localUri) await mongoose.disconnect() })
const realState = () => {
  const state = memoryState()
  state.deps.OutcomeKnowledgeCompositionPlan = OutcomeKnowledgeCompositionPlan
  state.deps.RuntimeInstance = RuntimeInstance
  state.deps.mongoose = mongoose
  delete state.deps.assertTransactionSupport
  delete state.deps.auditService
  return state
}
const counts = async () => [await OutcomeKnowledgeCompositionPlan.countDocuments(), await AuditLog.countDocuments()]
const interleaveSaves = () => {
  const original = OutcomeKnowledgeCompositionPlan.prototype.save
  let arrived = 0, release
  const bothReady = new Promise((resolve) => { release = resolve })
  return jest.spyOn(OutcomeKnowledgeCompositionPlan.prototype, 'save').mockImplementation(async function (...args) {
    arrived += 1
    if (arrived <= 2) {
      if (arrived === 2) release()
      await bothReady
    }
    return original.apply(this, args)
  })
}

describe('real isolated request KCP persistence', () => {
  real('actual collection has exact new unique index and no legacy conflicting index', async () => {
    await expect(assertOutcomeKcpRequestIndexes()).resolves.toBeUndefined()
    expect(OutcomeKnowledgeCompositionPlan.schema.options.autoIndex).toBe(false)
  })
  real('actual old index blocks writes; removing only the synthetic index restores guard', async () => {
    const state = realState(), args = requestArgs(state), before = await counts()
    await OutcomeKnowledgeCompositionPlan.collection.createIndex({ runtimeInstanceId: 1, planVersion: 1 }, { unique: true, name: 'uniq_outcome_kcp_runtime_version' })
    try {
      await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ status: 503, details: { field: 'requestIndexes' } })
      expect(await counts()).toEqual(before)
    } finally { await OutcomeKnowledgeCompositionPlan.collection.dropIndex('uniq_outcome_kcp_runtime_version') }
  })
  real('actual missing compound index blocks writes without recreating it', async () => {
    const state = realState(), args = requestArgs(state), before = await counts()
    await OutcomeKnowledgeCompositionPlan.collection.dropIndex('uniq_outcome_kcp_request_version')
    try {
      await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ status: 503, details: { field: 'requestIndexes' } })
      expect((await OutcomeKnowledgeCompositionPlan.collection.listIndexes().toArray()).some((index) => index.name === 'uniq_outcome_kcp_request_version')).toBe(false)
      expect(await counts()).toEqual(before)
      const legacy = { ...args, expectedPlanFingerprint: buildCandidate().planFingerprint }
      delete legacy.requestScope
      await expect(createOutcomeKnowledgeCompositionPlan(legacy)).rejects.toMatchObject({ status: 503, details: { field: 'requestIndexes' } })
      expect(await counts()).toEqual(before)
    } finally { await OutcomeKnowledgeCompositionPlan.collection.createIndex({ runtimeInstanceId: 1, requestId: 1, planVersion: 1 }, { unique: true, name: 'uniq_outcome_kcp_request_version' }) }
  })
  real('BLOCKED and missing intent never write plans or audits', async () => {
    const state = realState(), before = await counts()
    state.context.status = 'BLOCKED'
    await expect(createOutcomeKnowledgeCompositionPlan(requestArgs(state))).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.RESOLUTION_BLOCKED })
    state.context.status = 'READY'
    const args = requestArgs(state); delete args.consumerIntent.consumer
    await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ status: 422 })
    expect(await counts()).toEqual(before)
  })
  replica('legacy creation succeeds under old-only index configuration without automatic new index creation', async () => {
    const runtime = { ...makeRuntime(), _id: new mongoose.Types.ObjectId() }
    await RuntimeInstance.collection.insertOne(runtime)
    const state = realState(); state.runtime = runtime
    const args = { ...requestArgs(state, { ...newScope(), runtimeInstanceId: runtime._id }), runtimeInstanceId: runtime._id }
    delete args.requestScope
    args.expectedPlanFingerprint = buildOutcomeKnowledgeCompositionPlanCandidate({ runtime, binding: state.binding, context: state.context, consumerIntent: args.consumerIntent }).planFingerprint
    await OutcomeKnowledgeCompositionPlan.collection.dropIndex('uniq_outcome_kcp_request_version')
    await OutcomeKnowledgeCompositionPlan.collection.createIndex({ runtimeInstanceId: 1, planVersion: 1 }, { unique: true, name: 'uniq_outcome_kcp_runtime_version' })
    try {
      await expect(assertOutcomeKcpLegacyIndexes()).resolves.toBeUndefined()
      expect((await createOutcomeKnowledgeCompositionPlan(args)).plan.planVersion).toBe(1)
      expect((await OutcomeKnowledgeCompositionPlan.collection.listIndexes().toArray()).some((index) => index.name === 'uniq_outcome_kcp_request_version')).toBe(false)
    } finally {
      await OutcomeKnowledgeCompositionPlan.collection.dropIndex('uniq_outcome_kcp_runtime_version')
      await OutcomeKnowledgeCompositionPlan.collection.createIndex({ runtimeInstanceId: 1, requestId: 1, planVersion: 1 }, { unique: true, name: 'uniq_outcome_kcp_request_version' })
    }
  })
  single('standalone refuses a ready request without any plan or audit insert', async () => {
    const state = realState(), before = await counts()
    await expect(createOutcomeKnowledgeCompositionPlan(requestArgs(state))).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.TRANSACTION_REQUIRED })
    expect(await counts()).toEqual(before)
  })
  replica('persists distinct identical requests independently with real signed audits and scoped retrieval', async () => {
    const state = realState(), oneArgs = requestArgs(state), twoArgs = requestArgs(state), before = await counts()
    const [one, two] = await Promise.all([createOutcomeKnowledgeCompositionPlan(oneArgs), createOutcomeKnowledgeCompositionPlan(twoArgs)])
    expect(one.plan.planVersion).toBe(1); expect(two.plan.planVersion).toBe(1)
    expect(one.plan.planId).not.toBe(two.plan.planId)
    expect(await counts()).toEqual(before.map((count) => count + 2))
    const read = await getOutcomeRequestKnowledgeCompositionPlan({ ...oneArgs, planId: one.plan.planId })
    expect(read.plan).toEqual(one.plan); expect(read.execution.canExecute).toBe(false)
    await expect(getOutcomeRequestKnowledgeCompositionPlan({ ...twoArgs, planId: one.plan.planId })).rejects.toMatchObject({ status: 404 })
    const audit = await AuditLog.findOne({ resourceId: new mongoose.Types.ObjectId(one.plan.id) }).lean()
    expect(audit.diff.requestId).toBe(oneArgs.requestScope.requestId)
    expect(audit.signature).toBeTruthy()
  })
  replica('exact creation and re-resolution retry return original immutable rows after a successor', async () => {
    const state = realState(), args = requestArgs(state), before = await counts()
    const one = await createOutcomeKnowledgeCompositionPlan(args), next = nextArgs(state, args, one.plan)
    const two = await createOutcomeKnowledgeCompositionPlan(next)
    const historical = await createOutcomeKnowledgeCompositionPlan(args)
    expect(historical.plan).toEqual(one.plan)
    expect(historical).toMatchObject({ idempotent: true, currentness: { latestInRequest: false, current: false }, execution: { canExecute: false } })
    expect((await createOutcomeKnowledgeCompositionPlan(next)).plan).toEqual(two.plan)
    expect(await counts()).toEqual(before.map((count) => count + 2))
    await expect(OutcomeKnowledgeCompositionPlan.updateOne({ planId: one.plan.planId }, { $set: { requestId: randomUUID() } })).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.IMMUTABLE })
  })
  replica('actual audit insert then failure rolls back plan and signed audit together', async () => {
    const state = realState(), args = requestArgs(state), before = await counts()
    const original = AuditLog.createLog
    let inserted = false
    const failure = jest.spyOn(AuditLog, 'createLog').mockImplementationOnce(async function (...call) {
      expect(call[1].session.inTransaction()).toBe(true)
      const row = await original.apply(this, call)
      expect(await AuditLog.countDocuments({ _id: row._id }).session(call[1].session)).toBe(1)
      expect(await OutcomeKnowledgeCompositionPlan.countDocuments({ requestId: args.requestScope.requestId }).session(call[1].session)).toBe(1)
      inserted = true
      throw new Error('Injected failure after signed audit insertion')
    })
    try { await expect(createOutcomeKnowledgeCompositionPlan(args)).rejects.toMatchObject({ code: OUTCOME_KCP_ERROR_CODES.AUDIT_FAILED }) }
    finally { failure.mockRestore() }
    expect(inserted).toBe(true); expect(await counts()).toEqual(before)
  })
  replica('interleaved exact retry inserts one plan/audit and both callers receive that exact plan', async () => {
    const state = realState(), args = requestArgs(state), before = await counts(), barrier = interleaveSaves()
    let results
    try { results = await Promise.all([createOutcomeKnowledgeCompositionPlan(args), createOutcomeKnowledgeCompositionPlan(args)]) }
    finally { barrier.mockRestore() }
    expect(results[0].plan).toEqual(results[1].plan)
    expect(results.map((result) => result.idempotent).sort()).toEqual([false, true])
    expect(await counts()).toEqual(before.map((count) => count + 1))
  }, 30000)
  replica('interleaved different successors have exactly one winner without predecessor auto-advance', async () => {
    const state = realState(), args = requestArgs(state), first = await createOutcomeKnowledgeCompositionPlan(args)
    const a = nextArgs(state, args, first.plan), b = { ...nextArgs(state, args, first.plan),
      ...requestArgs(state, args.requestScope, { ...args.consumerIntent, outcome: 'Other explicit outcome' }) }
    const before = await counts(), barrier = interleaveSaves()
    let results
    try { results = await Promise.allSettled([createOutcomeKnowledgeCompositionPlan(a), createOutcomeKnowledgeCompositionPlan(b)]) }
    finally { barrier.mockRestore() }
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected').reason.code).toBe(OUTCOME_KCP_ERROR_CODES.VERSION_CONFLICT)
    expect(await counts()).toEqual(before.map((count) => count + 1))
  }, 30000)
  replica('higher request versions do not change legacy creation/latest or reuse request fingerprints', async () => {
    const state = realState(), args = requestArgs(state), one = await createOutcomeKnowledgeCompositionPlan(args)
    await createOutcomeKnowledgeCompositionPlan(nextArgs(state, args, one.plan))
    const legacyArgs = { ...args, expectedPlanFingerprint: buildCandidate().planFingerprint }
    delete legacyArgs.requestScope
    const legacy = await createOutcomeKnowledgeCompositionPlan(legacyArgs)
    expect(legacy.plan.planVersion).toBe(1)
    expect(legacy.plan).not.toHaveProperty('requestId')
    const before = await counts()
    expect((await createOutcomeKnowledgeCompositionPlan(legacyArgs)).plan.planId).toBe(legacy.plan.planId)
    expect(await counts()).toEqual(before)
    const selected = await OutcomeKnowledgeCompositionPlan.findOne({ runtimeInstanceId: ids.runtime, requestId: { $exists: false } }).sort({ planVersion: -1 })
    expect(selected.planId).toBe(legacy.plan.planId)
  })
  replica('same actor with a different authorized customer scope cannot reuse old customer request rows', async () => {
    const state = realState(), args = requestArgs(state), result = await createOutcomeKnowledgeCompositionPlan(args)
    const otherRuntime = { ...makeRuntime(), _id: new mongoose.Types.ObjectId(), customerId: new mongoose.Types.ObjectId() }
    await RuntimeInstance.collection.insertOne(otherRuntime)
    const otherArgs = { ...args, runtimeInstanceId: otherRuntime._id, requestScope: { ...args.requestScope, runtimeInstanceId: otherRuntime._id, customerId: otherRuntime.customerId } }
    const before = await counts()
    await expect(getOutcomeRequestKnowledgeCompositionPlan({ ...otherArgs, planId: result.plan.planId })).rejects.toMatchObject({ status: 404 })
    await expect(createOutcomeKnowledgeCompositionPlan({ ...otherArgs, requestScope: args.requestScope })).rejects.toMatchObject({ status: 422 })
    expect(await counts()).toEqual(before)
  })
  replica('interleaved legacy creation retains unique runtime history with real new compound index', async () => {
    const runtime = { ...makeRuntime(), _id: new mongoose.Types.ObjectId() }
    await RuntimeInstance.collection.insertOne(runtime)
    const state = realState()
    const args = { actorUserId: ids.actor, runtimeInstanceId: runtime._id, expectedRuntimeUpdatedAt: runtimeUpdatedAt,
      consumerIntent: consumerIntent(), expectedPlanFingerprint: buildOutcomeKnowledgeCompositionPlanCandidate({ runtime, binding: state.binding, context: state.context, consumerIntent: consumerIntent() }).planFingerprint, deps: state.deps }
    const before = await counts(), barrier = interleaveSaves()
    let results
    try { results = await Promise.allSettled([createOutcomeKnowledgeCompositionPlan(args), createOutcomeKnowledgeCompositionPlan(args)]) }
    finally { barrier.mockRestore() }
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true)
    for (const result of results.filter((entry) => entry.status === 'rejected')) expect(result.reason.code).toBe(OUTCOME_KCP_ERROR_CODES.VERSION_CONFLICT)
    expect(await OutcomeKnowledgeCompositionPlan.countDocuments({ runtimeInstanceId: runtime._id })).toBe(1)
    expect(await counts()).toEqual(before.map((count) => count + 1))
  }, 30000)
})
