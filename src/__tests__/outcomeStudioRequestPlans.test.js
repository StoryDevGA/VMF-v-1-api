import { randomUUID, createHmac } from 'node:crypto'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import { OutcomeKnowledgeCompositionPlan, RuntimeInstance, AuditLog, Customer, Tenant, FrameworkPackage } from '../models/index.js'
import { getRuntimeOutcomePlanningEvidence, RUNTIME_STATE_V2_COLLECTIONS } from '../services/runtimeStateRepository.js'
import encryption from '../services/fieldEncryptionService.js'
import { OUTCOME_KCP_OPERATIONS } from '../constants/outcomeGovernedQuality.js'
import { buildOutcomeKnowledgeCompositionPlanCandidate } from '../services/outcomeKnowledgeCompositionPlanService.js'
import { buildOutcomePlanningRuntimeEvidence } from '../services/outcomeFrameworkHandoffService.js'
import { inferOutcomeStudioRequestIntent, planOutcomeStudioRequest, confirmOutcomeStudioRequestPlan, retrieveOutcomeStudioRequestPlan } from '../services/outcomeStudioRequestPlanService.js'
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

const secret = 'synthetic-planning-receipt-secret-longer-than-32'
const receiptKey = createHmac('sha256', secret).update('outcome-studio.request-planning:encryption:v1').digest('hex')
const fixture = () => {
  const state = memoryState()
  state.runtime = buildOutcomePlanningRuntimeEvidence({ runtimeInstance: state.runtime,
    frameworkPackage: { packageKey: state.runtime.packageKey, version: state.runtime.packageVersion,
      sections: Object.keys(state.runtime.framework_state.sections).map((sectionKey) => ({
        sectionKey, runtimePath: `framework_state.sections.${sectionKey}`, required: true, sectionMode: 'GUIDED',
      })) } })
  const packs = requestPacks()
  state.binding.availableOutputTypes = [{ status: 'READY', capabilityKey: 'executive-brief', outputType: packs.outputType, outputSchema: packs.outputSchema }]
  Object.assign(state.deps, {
    receiptSecret: secret,
    readRuntimeControl: jest.fn(async () => state.runtime),
    readKcpRuntimeEvidence: jest.fn(async () => state.runtime),
    OutcomeSession: { findOne: jest.fn(() => ({ lean: async () => null })) },
  })
  return state
}
const args = (state, payload) => ({ actorUserId: ids.actor, runtimeInstanceId: ids.runtime, scopes: { fixture: true }, payload, deps: state.deps })
const start = (state) => planOutcomeStudioRequest(args(state, { prompt: 'Prepare an executive brief' }))
const complete = async (state, initial) => {
  let result = initial || await start(state)
  for (const prompt of ['Support the executive sponsor decision', 'Board; Finance']) {
    if (result.status === 'CONFIRMATION_REQUIRED') break
    result = await planOutcomeStudioRequest(args(state, { prompt, continuation: result.continuation }))
  }
  return result
}
const confirm = (state, result) => confirmOutcomeStudioRequestPlan({ ...args(state, { continuation: result.continuation, confirm: true }), requestId: result.requestId })

describe('prompt-only planning contract', () => {
  it('infers the exact Parlon request and reaches confirmation without unnecessary questions or writes', async () => {
    const prompt = 'Create a Commercial Strategy and Decision Paper for Parlon leadership using the current governed Parlon evidence base. Focus on how Parlon should move from a coherent replacement proposition to a repeatable, evidence-backed buying decision system. Preserve all evidence boundaries, claim restrictions and governance gates.'
    const resolution = {
      selectedOutputType: { key: 'commercial-strategy-and-decision-paper', label: 'Commercial Strategy and Decision Paper' },
      audience: { label: 'Executive leadership' },
      purpose: { label: 'Decision or recommendation' },
    }
    expect(inferOutcomeStudioRequestIntent({ prompt, resolution, deliverables: [resolution.selectedOutputType] })).toMatchObject({
      originalRequest: prompt,
      requestedOutputTypeKey: 'commercial-strategy-and-decision-paper',
      audience: ['Parlon leadership'],
      decisionPurpose: 'how Parlon should move from a coherent replacement proposition to a repeatable, evidence-backed buying decision system',
      evidenceSource: 'the current governed Parlon evidence base',
      constraints: ['Preserve evidence boundaries', 'Preserve claim restrictions', 'Preserve governance gates'],
      format: 'document', channel: '', missingRequiredFields: [], clarificationQuestions: [],
    })

    const state = fixture()
    const commercial = requestPacks()
    commercial.outputType = { ...commercial.outputType, capabilityKey: 'commercial-strategy-and-decision-paper', label: 'Commercial Strategy and Decision Paper' }
    state.binding.availableOutputTypes = [{ status: 'READY', capabilityKey: 'commercial-strategy-and-decision-paper',
      outputType: commercial.outputType, outputSchema: commercial.outputSchema }]
    state.deps.buildKcpCandidate = jest.fn(async () => ({ status: 'READY', planFingerprint: 'a'.repeat(64) }))
    const preview = await planOutcomeStudioRequest(args(state, { prompt }))
    expect(preview).toMatchObject({ status: 'CONFIRMATION_REQUIRED', question: '',
      intent: { requestedOutputTypeKey: 'commercial-strategy-and-decision-paper', audience: ['Parlon leadership'],
        missingRequiredFields: [], clarificationQuestions: [] } })
    expect(state.rows).toHaveLength(0); expect(state.audits).toHaveLength(0)
  })

  it('collects genuinely missing facts without writes, then confirms once with a persisted Clarification receipt', async () => {
    const state = fixture(), first = await start(state)
    expect(first.status).toBe('CLARIFICATION_REQUIRED')
    expect(first.intent).toMatchObject({ requestedOutputTypeKey: 'executive-brief',
      missingRequiredFields: ['decisionPurpose', 'audience'] })
    expect(first.continuation).toMatch(/^enc:v1:/)
    expect(first.continuation).not.toContain(String(ids.actor))
    expect(JSON.stringify(first)).not.toContain(String(ids.runtime))
    const preview = await complete(state, first)
    expect(preview.status).toBe('CONFIRMATION_REQUIRED')
    expect(preview.intent).toMatchObject({ outcome: 'Prepare an executive brief',
      decisionPurpose: 'Support the executive sponsor decision', audience: ['Board', 'Finance'], channel: '' })
    expect(state.rows).toHaveLength(0); expect(state.audits).toHaveLength(0)
    expect(state.deps.OutcomeSession.findOne).not.toHaveBeenCalled()
    const saved = await confirm(state, preview)
    expect(saved).toMatchObject({ status: 'SAVED', execution: { canExecute: true }, plan: { planVersion: 1,
      clarificationReceipt: { stageKey: 'CLARIFICATION', status: 'PASSED', requestId: saved.requestId } } })
    expect(saved.plan).not.toHaveProperty('payload')
    expect(JSON.stringify(saved)).not.toContain(String(ids.tenant))
    expect(state.rows[0].payload.requestAssociation).toEqual({ sessionId: '' })
    expect(state.rows[0].payload.clarificationReceipt).toMatchObject({
      contractVersion: 'outcome-studio.clarification-execution-receipt.v1',
      stageKey: 'CLARIFICATION', status: 'PASSED', requestId: saved.requestId,
    })
    expect(state.rows).toHaveLength(1); expect(state.audits).toHaveLength(1)
  })
  it('re-infers a natural-language amendment before confirmation without persisting the preview', async () => {
    const state = fixture()
    state.deps.buildKcpCandidate = jest.fn(async () => ({ status: 'READY', planFingerprint: 'b'.repeat(64) }))
    const first = await complete(state)
    const amended = await planOutcomeStudioRequest(args(state, {
      action: 'RE_RESOLVE', continuation: first.continuation,
      prompt: 'Prepare an Executive Brief for the Board to decide the next investment step using the current governed evidence base.',
    }))
    expect(amended).toMatchObject({ status: 'CONFIRMATION_REQUIRED',
      intent: { audience: ['Board'], decisionPurpose: 'decide the next investment step using the current governed evidence base' } })
    expect(state.rows).toHaveLength(0); expect(state.audits).toHaveLength(0)
  })
  it('samples the clock once per seal even when each sample advances', async () => {
    const state = fixture(); let clock = 100000
    state.deps.now = () => ++clock
    const first = await start(state)
    const claims = JSON.parse(encryption.decrypt(first.continuation, receiptKey))
    expect(claims.expiresAt - claims.issuedAt).toBe(1800000)
    expect((await planOutcomeStudioRequest(args(state, { prompt: 'Explicit outcome', continuation: first.continuation }))).status).toBe('CLARIFICATION_REQUIRED')
  })
  it.each(['expired', 'purpose', 'version', 'actor', 'tenant', 'customer', 'runtime', 'tampered', 'plaintext'])('rejects %s continuation without writes', async (kind) => {
    const state = fixture(), first = await start(state)
    const claim = JSON.parse(encryption.decrypt(first.continuation, receiptKey))
    if (kind === 'expired') state.deps.now = () => claim.expiresAt + 1
    if (kind === 'purpose') claim.purpose = 'login'
    if (kind === 'version') claim.version = 2
    if (kind === 'actor') claim.actorUserId = String(new mongoose.Types.ObjectId())
    if (kind === 'tenant') claim.scope.tenantId = String(new mongoose.Types.ObjectId())
    if (kind === 'customer') claim.scope.customerId = String(new mongoose.Types.ObjectId())
    if (kind === 'runtime') claim.scope.runtimeInstanceId = String(new mongoose.Types.ObjectId())
    let continuation = encryption.encrypt(JSON.stringify(claim), receiptKey)
    if (kind === 'tampered') continuation = continuation.slice(0, -6) + 'aaaaaa'
    if (kind === 'plaintext') continuation = JSON.stringify(claim)
    await expect(planOutcomeStudioRequest(args(state, { prompt: 'Answer', continuation }))).rejects.toMatchObject({ status: 403 })
    expect(state.rows).toHaveLength(0); expect(state.audits).toHaveLength(0)
  })
  it('reauthorizes every continuation, including confirmation after permission revocation', async () => {
    const state = fixture(), preview = await complete(state)
    state.deps.assertRuntimePermission.mockRejectedValue(Object.assign(new Error('deny'), { status: 403 }))
    await expect(confirm(state, preview)).rejects.toMatchObject({ status: 403 })
    expect(state.rows).toHaveLength(0)
  })
  it('requires an exact persisted session association and rechecks it at confirmation', async () => {
    const state = fixture()
    await expect(planOutcomeStudioRequest(args(state, { prompt: 'Executive brief', sessionId: 'foreign-session' }))).rejects.toMatchObject({ status: 404 })
    state.deps.OutcomeSession.findOne.mockImplementation((filter) => ({ lean: async () => filter.sessionId === 'owned' ? { sessionId: 'owned' } : null }))
    const first = await planOutcomeStudioRequest(args(state, { prompt: 'Executive brief', sessionId: 'owned' }))
    const preview = await complete(state, first)
    const saved = await confirm(state, preview)
    expect(state.rows[0].payload.requestAssociation).toEqual({ sessionId: 'owned' })
    for (const [filter] of state.deps.OutcomeSession.findOne.mock.calls) expect(filter).toMatchObject({ tenantId: String(ids.tenant), customerId: String(ids.customer), runtimeInstanceId: String(ids.runtime) })
    state.deps.OutcomeSession.findOne.mockReturnValue({ lean: async () => null })
    await expect(retrieveOutcomeStudioRequestPlan({ ...args(state), requestId: saved.requestId, planId: saved.plan.planId })).rejects.toMatchObject({ status: 404 })
  })
  it('historical confirm retry reuses original plan without duplicate audit after explicit re-resolution', async () => {
    const state = fixture(), firstPreview = await complete(state), first = await confirm(state, firstPreview)
    const re = await planOutcomeStudioRequest(args(state, { prompt: 'Decision changed', action: 'RE_RESOLVE', continuation: first.continuation }))
    const output = await planOutcomeStudioRequest(args(state, { prompt: 'Executive brief', continuation: re.continuation }))
    let next = await planOutcomeStudioRequest(args(state, { prompt: 'Changed explicit outcome', continuation: output.continuation }))
    for (const prompt of ['Approve next step', 'Sponsor', 'Board', 'PDF', 'skip', 'skip']) next = await planOutcomeStudioRequest(args(state, { prompt, continuation: next.continuation }))
    expect((await confirm(state, next)).plan.planVersion).toBe(2)
    const retry = await confirm(state, firstPreview)
    expect(retry.plan).toMatchObject({ planId: first.plan.planId, idempotent: true, currentness: { current: false, latestInRequest: false } })
    expect(state.rows).toHaveLength(2); expect(state.audits).toHaveLength(2)
  })
  it.each(['BLOCKED', 'AMBIGUOUS'])('no eligible %s configuration is blocked, not an intent question loop', async (status) => {
    const state = fixture(); state.binding.status = status
    const result = await start(state)
    expect(result).toMatchObject({ status: 'BLOCKED', question: '', blockers: ['NO_ELIGIBLE_OUTPUT_CONTRACT'] })
    expect(result.message).toMatch(/administrator/)
    expect(state.rows).toHaveLength(0)
  })
  it('available contracts plus unmatched customer intent requests clarification, not configuration repair', async () => {
    const state = fixture()
    const result = await planOutcomeStudioRequest(args(state, { prompt: 'Something unclear' }))
    expect(result.status).toBe('CLARIFICATION_REQUIRED'); expect(result.question).toMatch(/output type/)
  })
  it('requires explicit confirmation and rejects direct confirmation of an incomplete receipt', async () => {
    const state = fixture(), first = await start(state)
    await expect(confirm(state, first)).rejects.toMatchObject({ status: 422 })
    const preview = await complete(state, first)
    await expect(confirmOutcomeStudioRequestPlan({ ...args(state, { continuation: preview.continuation }), requestId: preview.requestId })).rejects.toMatchObject({ status: 422 })
    expect(state.rows).toHaveLength(0)
  })
  it('source evidence drift between preview and confirmation fails closed', async () => {
    const state = fixture(), preview = await complete(state)
    state.runtime.framework_state.sections.customer_context.accepted.truthHash = `sha256:${'1'.repeat(64)}`
    await expect(confirm(state, preview)).rejects.toMatchObject({ status: 409 })
    expect(state.rows).toHaveLength(0)
  })
  it('confirms unchanged semantic context despite a fresh resolver observation identity', async () => {
    const state = fixture(), preview = await complete(state)
    state.context.contextId = 'new-observation-context-id'
    state.context.lineage.resolvedAt = '2026-09-16T14:00:00.000Z'
    const saved = await confirm(state, preview)
    expect(saved.status).toBe('SAVED')
    expect(state.rows).toHaveLength(1)
  })
  it('rejects missing planning evidence with a stable stale error before persistence', async () => {
    const state = fixture(), preview = await complete(state)
    delete state.runtime.planningEvidence
    await expect(confirm(state, preview)).rejects.toMatchObject({ status: 409, details: { field: 'planningEvidence' } })
    expect(state.rows).toHaveLength(0)
    expect(state.audits).toHaveLength(0)
  })
})

describe('canonical planning section classification', () => {
  const pkg = () => ({ packageKey: makeRuntime().packageKey, version: makeRuntime().packageVersion,
    sections: ['customer_context', 'output_requirements'].map((sectionKey) => ({ sectionKey, runtimePath: `framework_state.sections.${sectionKey}`, required: true, sectionMode: 'GUIDED' })) })
  it('projects declared customer truth and binds storage version without changing legacy inputs', () => {
    const runtime = makeRuntime(), before = structuredClone(runtime)
    const projected = buildOutcomePlanningRuntimeEvidence({ runtimeInstance: { ...runtime, stateVersion: 'rsv2:test' }, frameworkPackage: pkg() })
    expect(projected.framework_state.sections).toEqual(runtime.framework_state.sections)
    expect(projected.planningEvidence.stateVersion).toBe('rsv2:test')
    expect(runtime).toEqual(before)
  })
  it.each(['missing', 'undeclared', 'duplicate', 'package'])('rejects %s canonical evidence instead of filtering it away', (kind) => {
    const runtime = makeRuntime(), frameworkPackage = pkg()
    if (kind === 'missing') delete runtime.framework_state.sections.customer_context
    if (kind === 'undeclared') runtime.framework_state.sections.unknown = makeSection('unknown', 'a')
    if (kind === 'duplicate') frameworkPackage.sections.push(frameworkPackage.sections[0])
    if (kind === 'package') frameworkPackage.version = 'other'
    expect(() => buildOutcomePlanningRuntimeEvidence({ runtimeInstance: runtime, frameworkPackage })).toThrow()
  })
})

// Explicit fresh loopback launcher only; never consume the configured application URI.
const localUri = process.env.KCP_ISOLATION_TEST_URI
const standalone = process.env.KCP_ISOLATION_STANDALONE === 'true'
const replica = localUri && !standalone ? it : it.skip
const single = localUri && standalone ? it : it.skip
beforeAll(async () => {
  if (!localUri) return
  const expected = `mongodb://127.0.0.1:${process.env.KCP_ISOLATION_PORT}/${process.env.KCP_ISOLATION_DATABASE}${standalone ? '' : '?replicaSet=kcp_isolation'}`
  if (localUri !== expected || !/^mongodb:\/\/127\.0\.0\.1:\d+\/kcp_isolation_\d+(\?replicaSet=kcp_isolation)?$/.test(localUri)) throw new Error('Fresh loopback identity required')
  await mongoose.connect(localUri, { autoIndex: false, autoCreate: false })
  await OutcomeKnowledgeCompositionPlan.createCollection()
  await AuditLog.createCollection()
  await OutcomeKnowledgeCompositionPlan.createIndexes()
  await RuntimeInstance.collection.insertOne(makeRuntime())
}, 30000)
afterAll(async () => { if (localUri) await mongoose.disconnect() })
const persistedFixture = () => {
  const state = fixture()
  Object.assign(state.deps, { OutcomeKnowledgeCompositionPlan, RuntimeInstance, mongoose })
  delete state.deps.assertTransactionSupport
  delete state.deps.auditService
  // Resolver/auth remain synthetic; real persistence and signed transactional audit are exercised.
  return state
}
const persistedCounts = async () => [await OutcomeKnowledgeCompositionPlan.countDocuments(), await AuditLog.countDocuments()]
describe('isolated real planning orchestration persistence', () => {
  replica('real bounded repository reconstructs V2 truth and rejects stale receipts without legacy fallback', async () => {
    const runtime = makeRuntime(), packageId = new mongoose.Types.ObjectId()
    runtime._id = new mongoose.Types.ObjectId()
    runtime.runtimeInstanceKey = `planning-v2-${runtime._id}`
    runtime.packageId = packageId
    runtime.stateVersion = 'runtime-revision:planning-test'
    await Customer.collection.insertOne({ _id: ids.customer, status: 'ACTIVE', entitlements: ['VMF'] })
    await Tenant.collection.insertOne({ _id: ids.tenant, customerId: ids.customer, status: 'ENABLED' })
    await FrameworkPackage.collection.insertOne({ _id: packageId, packageKey: runtime.packageKey,
      version: runtime.packageVersion, frameworkKey: runtime.frameworkKey, status: 'ACTIVE',
      visibility: 'CUSTOMER_VISIBLE', customerAccessMode: 'ALL_CUSTOMERS',
      sections: Object.keys(runtime.framework_state.sections).map((sectionKey) => ({ sectionKey,
        runtimePath: `framework_state.sections.${sectionKey}`, sectionMode: 'GUIDED', required: true })) })
    const sections = JSON.parse(JSON.stringify(runtime.framework_state.sections))
    // A legacy decoy must never become planning truth for a V2 runtime.
    runtime.framework_state.sections = { decoy: makeSection('decoy', 'c') }
    await RuntimeInstance.collection.insertOne(runtime)
    const collection = mongoose.connection.collection(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS)
    await collection.insertMany(Object.entries(sections).map(([sectionKey, sectionDetail]) => ({
      runtimeInstanceId: runtime._id, tenantId: ids.tenant, customerId: ids.customer, sectionKey,
      current: true, stateStatus: 'CURRENT', stateVersion: runtime.stateVersion,
      sourceStateVersion: runtime.stateVersion, sectionDetail,
    })))
    const scopes = { customer: { _id: String(ids.customer) }, tenant: { _id: String(ids.tenant), customerId: String(ids.customer) },
      resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'], permissions: [] }, customers: [], tenants: [] } }
    const input = { runtimeInstanceId: runtime._id, scopes }
    const projected = await getRuntimeOutcomePlanningEvidence(input)
    expect(projected.framework_state.sections).toEqual(sections)
    expect(projected.planningEvidence.stateVersion).toBe(runtime.stateVersion)
    await collection.updateOne({ runtimeInstanceId: runtime._id, sectionKey: 'customer_context' }, { $set: { sourceStateVersion: 'runtime-revision:stale' } })
    await expect(getRuntimeOutcomePlanningEvidence(input)).rejects.toMatchObject({ status: 409 })
    expect(await RuntimeInstance.findById(runtime._id).lean()).toMatchObject({ framework_state: { sections: { decoy: expect.any(Object) } } })
  })
  replica('clarification writes nothing; confirmation persists and retry/retrieval reuse the exact plan', async () => {
    const state = persistedFixture(), before = await persistedCounts()
    const runtimeBefore = await RuntimeInstance.findById(ids.runtime).lean()
    const preview = await complete(state)
    expect(await persistedCounts()).toEqual(before)
    const saved = await confirm(state, preview)
    expect(saved.execution.canExecute).toBe(true)
    expect(await persistedCounts()).toEqual(before.map((count) => count + 1))
    const retry = await confirm(state, preview)
    expect(retry.plan.planId).toBe(saved.plan.planId)
    expect(retry.plan.idempotent).toBe(true)
    const retrieved = await retrieveOutcomeStudioRequestPlan({ ...args(state), requestId: saved.requestId, planId: saved.plan.planId })
    expect(retrieved.plan.planId).toBe(saved.plan.planId)
    expect(await persistedCounts()).toEqual(before.map((count) => count + 1))
    expect(await RuntimeInstance.findById(ids.runtime).lean()).toEqual(runtimeBefore)
    const row = await OutcomeKnowledgeCompositionPlan.findOne({ planId: saved.plan.planId }).lean()
    expect((await AuditLog.findOne({ resourceId: row._id }).lean()).signature).toBeTruthy()
  })
  replica('distinct server-issued requests with identical answers persist separate histories', async () => {
    const state = persistedFixture(), before = await persistedCounts()
    const a = await complete(state), b = await complete(state)
    const [one, two] = await Promise.all([confirm(state, a), confirm(state, b)])
    expect(one.requestId).not.toBe(two.requestId)
    expect(one.plan.planId).not.toBe(two.plan.planId)
    expect(one.plan.planVersion).toBe(1)
    expect(two.plan.planVersion).toBe(1)
    expect(await persistedCounts()).toEqual(before.map((count) => count + 2))
  })
  replica('signed audit insert followed by failure rolls back the confirmed plan and audit', async () => {
    const state = persistedFixture(), preview = await complete(state), before = await persistedCounts()
    const original = AuditLog.createLog
    const spy = jest.spyOn(AuditLog, 'createLog').mockImplementationOnce(async function (...call) {
      const row = await original.apply(this, call)
      expect(await AuditLog.countDocuments({ _id: row._id }).session(call[1].session)).toBe(1)
      throw new Error('Synthetic failure after audit insertion')
    })
    try { await expect(confirm(state, preview)).rejects.toMatchObject({ status: 503 }) }
    finally { spy.mockRestore() }
    expect(await persistedCounts()).toEqual(before)
  })
  single('standalone confirmation fails closed without plan or audit writes', async () => {
    const state = persistedFixture(), preview = await complete(state), before = await persistedCounts()
    await expect(confirm(state, preview)).rejects.toMatchObject({ status: 503 })
    expect(await persistedCounts()).toEqual(before)
  })
})
