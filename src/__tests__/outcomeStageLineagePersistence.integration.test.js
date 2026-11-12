import { buildOutcomeKnowledgeCompositionPlanCandidate, hashOutcomeKnowledgeCompositionSemanticValue, assertOutcomeKnowledgeCompositionPlanIntegrity } from '../services/outcomeKnowledgeCompositionPlanService.js'
import { attachSs040PlanFixtureContract, ss040TargetHashFor } from './fixtures/ss040EvidenceToMeaningFixtures.js'
import { freezeSs041Snapshot } from './fixtures/outcomeEvidenceToDraftFixtures.js'
import { compileEvidenceToMeaningContract } from '../services/outcomeEvidenceToMeaningContractService.js'
import { EVIDENCE_TO_DRAFT_INPUT_VERSION } from '../services/outcomeEvidenceToDraftContractService.js'
import { EVIDENCE_TO_MEANING_PROVIDER_VERSION, EVIDENCE_TO_DRAFT_PROVIDER_VERSION } from '../services/outcomeEvidenceToMeaningProviderService.js'
import { readRuntimeEvidenceToMeaningProviderProjection } from '../services/outcomeRuntimeEvidenceToMeaningService.js'
import { buildWorkingDraftStageOutputFromProviderOutput } from '../services/outcomeWorkingDraftExecutionService.js'
import { beforeAll, afterAll, describe, test, expect, jest } from '@jest/globals'
import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import OutcomeQualityStageExecution from '../models/OutcomeQualityStageExecution.js'
import { buildOutcomeQualityStageExecutionCandidate, buildOutcomeQualityVisibleGaps, hashOutcomeQualityStageValue, createOutcomeQualityStageExecution } from '../services/outcomeQualityStageExecutionService.js'
import OutcomeKnowledgeCompositionPlan from '../models/OutcomeKnowledgeCompositionPlan.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeEvidenceSnapshot from '../models/RuntimeEvidenceSnapshot.js'
import AuditLog from '../models/AuditLog.js'
import Customer from '../models/Customer.js'
import Tenant from '../models/Tenant.js'
import LicenseLevel from '../models/LicenseLevel.js'
import auditService from '../services/auditService.js'
import { prepareRuntimeEvidenceSnapshot, persistRuntimeEvidenceSnapshot } from '../services/runtimeEvidenceSnapshotService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { getRuntimeOutcomeEvidenceContractSnapshot } from '../services/runtimeStateRepository.js'
import { expandEvidenceToMeaningProviderClaims } from '../services/outcomeEvidenceToMeaningProviderService.js'
import { OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION, OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
  OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION } from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSION, OUTCOME_WORKING_DRAFT_SCHEMA_VERSION } from '../constants/outcomeGovernedQuality.js'

let replica, pointerCloneSpy
const frozenProof = process.env.VMF_FROZEN_CONSUMPTION_PROOF === '1'
const proofDirectory = process.env.VMF_FROZEN_CONSUMPTION_PROOF_DIR
const proofDatabase = 'ss049_frozen_consumption'
const proofTest = frozenProof ? test : test.skip
const assertProofOwned = () => {
  if (!frozenProof || proofDirectory !== 'C:/Dev/StoryLineOS/VMF-Evidence/ss-049/2026-11-11-frozen-consumption-proof'
    || mongoose.connection.host !== '127.0.0.1' || mongoose.connection.port !== 27089
    || mongoose.connection.name !== proofDatabase) throw new Error('Owned frozen-consumption database required')
}
const saveProof = (name, value) => {
  assertProofOwned()
  fs.writeFileSync(`${proofDirectory}/${name}.json`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
}
beforeAll(async () => {
  if (frozenProof && (proofDirectory !== 'C:/Dev/StoryLineOS/VMF-Evidence/ss-049/2026-11-11-frozen-consumption-proof'
    || process.env.MONGOMS_RUNTIME_DOWNLOAD !== 'false'
    || process.env.MONGOMS_SYSTEM_BINARY !== 'C:/Users/garya/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe'
    || createHash('sha256').update(fs.readFileSync(process.env.MONGOMS_SYSTEM_BINARY)).digest('hex')
      !== '919ce2ee9893ffcac72e95610f543beacce721a7c226867568856ca0754d49d8')) throw new Error('Pinned external fixture setup required')
  if (frozenProof) {
    const originalClone = globalThis.structuredClone
    pointerCloneSpy = jest.spyOn(globalThis, 'structuredClone').mockImplementation((value, ...options) => {
      const cloned = originalClone(value, ...options)
      if (value && Object.keys(value).sort().join(',') === 'basisStateVersion,contractVersion,lockSnapshotHash,lockSnapshotId,membershipHash,snapshotId') {
        // Jest injects the host clone. Normalize only this flat pointer's realm,
        // preserving descriptors and the exact hash; production guards stay real.
        const local = Object.create(null, Object.getOwnPropertyDescriptors(cloned))
        expect(membershipHash(local)).toBe(membershipHash(value))
        return local
      }
      return cloned
    })
  }
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' },
    ...(frozenProof ? { instanceOpts: [{ port: 27089, ip: '127.0.0.1', dbPath: `${proofDirectory}/mongo-data` }] } : {}) })
  const name = frozenProof ? proofDatabase : `outcome_stage_lineage_${randomUUID().replaceAll('-', '')}`
  const uri = replica.getUri(name)
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Fresh isolated loopback replica required')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  if (mongoose.connection.host !== '127.0.0.1' || mongoose.connection.name !== name
    || mongoose.connection.getClient().topology.description.type !== 'ReplicaSetWithPrimary'
    || (await mongoose.connection.db.listCollections().toArray()).length) throw new Error('Fresh isolated stage database required')
  await OutcomeQualityStageExecution.createCollection()
  await OutcomeQualityStageExecution.createIndexes()
  await mongoose.connection.db.createCollection('auditlogs')
  if (frozenProof) {
    assertProofOwned()
    for (const model of [RuntimeInstance, RuntimeEvidenceSnapshot, OutcomeKnowledgeCompositionPlan, Customer, Tenant, LicenseLevel]) {
      await model.createCollection()
      await model.createIndexes()
    }
    for (const name of ['runtime_evidence_sources', 'runtime_evidence_objects', 'runtime_section_states']) await mongoose.connection.db.createCollection(name)
  }
}, 120000)
afterAll(async () => {
  let captureError, stopped = false
  try {
    if (frozenProof && mongoose.connection.readyState === 1) {
      const rows = {}
      for (const { name } of await mongoose.connection.db.listCollections().toArray()) {
        rows[name] = { records: await mongoose.connection.db.collection(name).find({}).sort({ _id: 1 }).toArray(),
          indexes: await mongoose.connection.db.collection(name).indexes() }
      }
      saveProof('database-readback', rows)
    }
  } catch (error) { captureError = error }
  try {
    try { await mongoose.disconnect() } finally { if (replica) { await replica.stop(); stopped = true } }
  } finally { pointerCloneSpy?.mockRestore() }
  if (frozenProof) fs.writeFileSync(`${proofDirectory}/cleanup.json`, JSON.stringify({ ownedMongoStopped: stopped,
    dataRetained: fs.existsSync(`${proofDirectory}/mongo-data`), captureError: captureError?.message || null }) + '\n', { flag: 'wx' })
  if (captureError) throw captureError
})

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

// Explicit provider-free integration fixture. LOCKED/accepted truth and source
// qualification are authored preconditions, not executed lifecycle decisions.
const frozenConsumptionFixture = async (recordPointer = true) => {
  assertProofOwned()
  for (const key of Object.keys(ids)) ids[key] = new mongoose.Types.ObjectId()
  const runtime = makeRuntime(), at = '2026-10-02T09:00:00.000Z'
  Object.assign(runtime, { runtimeInstanceKey: 'ss049-frozen-' + randomUUID().slice(0, 12),
    stateVersion: 'rsv2:' + randomUUID(), revision: { revisionNumber: 1 },
    packageId: new mongoose.Types.ObjectId(), dependencyLockId: 'AUTHORED_FIXTURE_DEPENDENCY',
    activationId: 'AUTHORED_FIXTURE_ACTIVATION', deploymentId: 'AUTHORED_FIXTURE_DEPLOYMENT',
    executionStatus: 'IDLE', lockedAt: new Date(at), lockedBy: ids.actor })
  Object.assign(runtime.framework_state.lock.snapshot, { snapshotAt: at,
    contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' })
  runtime.framework_state.evidence_pack = { discoveryHealth: { contradictionCandidates: [] },
    lineage: { evidenceVersion: 'synthetic-frozen-consumption-v1' } }
  const scope = { customerId: ids.customer, tenantId: ids.tenant, runtimeInstanceId: ids.runtime,
    runtimeInstanceKey: runtime.runtimeInstanceKey, stateVersion: runtime.stateVersion }
  const scopes = { customer: { _id: String(ids.customer) }, tenant: { _id: String(ids.tenant), customerId: String(ids.customer) },
    resolvedPermissions: { tenants: [{ customerId: String(ids.customer), tenantId: String(ids.tenant), permissions: ['VMF_VIEW'] }] } }
  const licenseId = new mongoose.Types.ObjectId()
  await Customer.collection.insertOne({ _id: ids.customer, name: runtime.runtimeInstanceKey, nameNormalized: runtime.runtimeInstanceKey,
    topology: 'SINGLE_TENANT', licenseLevelId: licenseId, entitlements: [] })
  await Tenant.collection.insertOne({ _id: ids.tenant, customerId: ids.customer, status: 'ENABLED' })
  await LicenseLevel.collection.insertOne({ _id: licenseId, name: runtime.runtimeInstanceKey, nameNormalized: runtime.runtimeInstanceKey,
    isActive: true, featureEntitlements: ['VMF'], homeExperience: 'CORE' })
  const binding = makeBinding()
  Object.values(binding.selectedByLayer).flat().forEach(pack => {
    if (['executive-brief', 'executive-brief-schema'].includes(pack.capabilityKey)) pack.contentHash = ss040TargetHashFor(pack.capabilityKey)
  })
  const plan = makePlan({ resolutionBasis: { outcome: 'EXPLICIT_PROVIDER_FREE_FIXTURE' } }, runtime, binding)
  plan.runtimeInstanceKey = runtime.runtimeInstanceKey
  attachSs040PlanFixtureContract(plan.payload)
  const input = JSON.parse(plan.payload.evidenceToMeaning.contractJson).inputs
  input.composition.contractVersion = EVIDENCE_TO_DRAFT_INPUT_VERSION
  input.composition.providerCompatibility = { contractVersion: EVIDENCE_TO_DRAFT_PROVIDER_VERSION, status: 'READY' }
  const sourceKeys = Object.keys(runtime.framework_state.sections)
  const common = { ...scope, sourceStateVersion: runtime.stateVersion, current: true,
    sourceHash: 'sha256:' + '1'.repeat(64) }
  input.sourceSnapshot.evidenceObjects.forEach(row => Object.assign(row, {
    ...common, _id: new mongoose.Types.ObjectId(), claimStatus: 'SOURCE_PRESENTED',
    sourceLocation: 'source-1#synthetic-frozen-consumption', scope: { organisation: 'Provider-free synthetic fixture' },
    time: { from: '2026-01-01', to: '2026-10-01' }, materiality: 'SOURCE_RECORDED',
    proofOrderDisposition: 'NOT_ESTABLISHED', proofRequirementCodes: ['ATTRIBUTION'],
  }))
  input.composition.businessFactLedger.facts.forEach(fact => {
    const row = input.sourceSnapshot.evidenceObjects.find(row => row.evidenceObjectId === fact.evidenceObjectId)
    row.draftPlacement = { version: 'evidence-to-draft-placement.v1',
      targetReceiptFingerprint: input.selectedTarget.receiptFingerprint,
      sourceSectionKeys: sourceKeys, targetSectionKeys: [...fact.sectionKeys] }
    fact.sectionKeys = sourceKeys
  })
  const db = mongoose.connection.db
  await db.collection('runtime_evidence_objects').insertMany(input.sourceSnapshot.evidenceObjects)
  await db.collection('runtime_evidence_sources').insertMany(input.sourceSnapshot.sourceRegistry.map(row => ({
    ...row, ...common, _id: new mongoose.Types.ObjectId(),
  })))
  await db.collection('runtime_section_states').insertMany(sourceKeys.map(sectionKey => ({
    ...common, _id: new mongoose.Types.ObjectId(), sectionKey,
    sectionDetail: { accepted: { ...runtime.framework_state.sections[sectionKey].accepted,
      supportingEvidenceRefs: input.sourceSnapshot.evidenceObjects.map(row => row.evidenceObjectId) } },
  })))
  let prepared, lockAuditId
  if (recordPointer) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        prepared = await prepareRuntimeEvidenceSnapshot({ runtime, session })
        const audit = new AuditLog({ actorUserId: ids.actor, action: 'RUNTIME_ACTION_EXECUTED',
          resourceType: 'RuntimeInstance', resourceId: ids.runtime,
          scope: { ...scope }, diff: { actionKey: 'LOCK_RECORD', actionedAt: at,
            evidenceMembershipSnapshot: { ...prepared.pointer, counts: prepared.body.counts } } })
        audit.generateSignature()
        await audit.save({ session })
        expect(audit.verifySignature()).toBe(true)
        lockAuditId = audit._id
        await persistRuntimeEvidenceSnapshot({ prepared, actorUserId: ids.actor, audit, session })
      })
    } finally { await session.endSession() }
    runtime.lockedEvidenceSnapshot = prepared.pointer
  }
  await RuntimeInstance.collection.insertOne(runtime)
  // No snapshot-reader override: use real scope, permission, licence, repository,
  // signed membership verifier, paging and section/material guards throughout.
  input.sourceSnapshot = await getRuntimeOutcomeEvidenceContractSnapshot({ runtimeInstanceId: String(ids.runtime), scopes })
  if (!recordPointer) return { runtime, scopes, snapshot: input.sourceSnapshot }
  expect(input.sourceSnapshot.inventoryReceipt.frozenMembership).toEqual({
    snapshotId: prepared.pointer.snapshotId, membershipHash: prepared.pointer.membershipHash, body: prepared.body,
  })
  const contract = compileEvidenceToMeaningContract(input)
  expect(contract.status).toBe('READY_TO_DRAFT')
  plan.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
    contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
  plan.planFingerprint = hashOutcomeKnowledgeCompositionSemanticValue(plan.payload)
  const savedPlan = await OutcomeKnowledgeCompositionPlan.create(plan)
  assertOutcomeKnowledgeCompositionPlanIntegrity(await OutcomeKnowledgeCompositionPlan.findById(savedPlan._id).lean())
  const projection = readRuntimeEvidenceToMeaningProviderProjection(plan)
  const output = makeSyntheticStage().outputSnapshot
  output.title = 'Canned provider-free frozen-context storage fixture'
  Object.assign(output.sections[0], { implications: ['Inspect this synthetic binding only.'],
    recommendations: ['No customer or provider outcome is established.'], qualification: 'Canned provider-free fixture only.', assumptions: [], gaps: [] })
  output.sections[0].truthReferences = plan.payload.lockedTruth.acceptedSections.map(row => row.sectionKey)
  output.sections[0].contributingActivationIds = plan.payload.stagePlan.find(row => row.stageKey === 'FRAMEWORK_GUIDANCE').assignedActivationIds
  output.visibleGaps = buildOutcomeQualityVisibleGaps(plan)
  const stage = { runtimeInstanceId: ids.runtime, expectedPlanFingerprint: plan.planFingerprint,
    stageKey: 'FRAMEWORK_GUIDANCE', status: 'SUCCEEDED', output,
    executionIdentity: { executionMode: 'PROVIDER_FREE_FIXTURE', providerKey: 'provider-free-fixture', model: 'canned-output-no-model',
      providerConfigurationVersion: OUTCOME_FRAMEWORK_GUIDANCE_PROVIDER_CONFIG_VERSION,
      grrExecutionId: 'synthetic-no-grr-execution', grrRuntimeArtifactId: 'synthetic-no-grr-artifact', runtimeVersion: runtimeUpdatedAt },
    startedAt: '2026-10-02T10:00:00.000Z', completedAt: '2026-10-02T10:00:00.000Z' }
  const candidate = buildOutcomeQualityStageExecutionCandidate({ plan, ...stage })
  const command = { ...stage, planRecordId: savedPlan._id, actorUserId: ids.actor, scopes,
    expectedAttemptFingerprint: candidate.attemptFingerprint }
  return { runtime, scopes, prepared, lockAuditId, plan: savedPlan, contract, projection, candidate, command }
}
const frozenProofMaterial = async () => {
  assertProofOwned()
  const material = {}
  for (const { name } of await mongoose.connection.db.listCollections().toArray()) {
    const rows = await mongoose.connection.db.collection(name).find({}).sort({ _id: 1 }).toArray()
    material[name] = { count: rows.length,
      hash: createHash('sha256').update(Buffer.concat(rows.map(row => mongoose.mongo.BSON.serialize(row)))).digest('hex') }
  }
  return material
}
describe('provider-free frozen consumption proof', () => {
  proofTest.each(['positive', 'member-material', 'section-references', 'invalid-pointer', 'lock-audit', 'stage-audit-rollback', 'no-pointer'])('%s', async mode => {
    const f = await frozenConsumptionFixture(mode !== 'no-pointer')
    if (mode === 'no-pointer') {
      expect(f.snapshot.inventoryReceipt).not.toHaveProperty('frozenMembership')
      expect(f.snapshot.inventoryReceipt).toMatchObject({ completeness: 'COMPLETE', sectionReadiness: 'REFERENCES_RESOLVED' })
      saveProof('case-' + mode, { proof: 'ISOLATED_UNCHANGED_NO_POINTER_PATH', snapshot: f.snapshot, runtime: f.runtime })
      return
    }
    const before = await frozenProofMaterial()
    const db = mongoose.connection.db
    if (mode === 'member-material') await db.collection('runtime_evidence_objects').updateOne({ runtimeInstanceId: f.runtime._id },
      { $set: { confidenceWarnings: ['Changed synthetic qualification after freeze'] } })
    if (mode === 'section-references') await db.collection('runtime_section_states').updateOne({ runtimeInstanceId: f.runtime._id },
      { $set: { 'sectionDetail.accepted.supportingEvidenceRefs': [] } })
    if (mode === 'invalid-pointer') await RuntimeInstance.collection.updateOne({ _id: f.runtime._id },
      { $set: { 'lockedEvidenceSnapshot.membershipHash': '0'.repeat(64) } })
    if (mode === 'lock-audit') await AuditLog.collection.updateOne({ _id: f.lockAuditId }, { $set: { signature: '0'.repeat(64) } })
    if (['member-material', 'section-references', 'invalid-pointer', 'lock-audit'].includes(mode)) {
      const expected = ['member-material', 'section-references'].includes(mode) ? 'MEMBER_MATERIAL_CHANGED'
        : mode === 'invalid-pointer' ? 'POINTER_BINDING_INVALID' : 'AUDIT_SIGNATURE_INVALID'
      await expect(getRuntimeOutcomeEvidenceContractSnapshot({ runtimeInstanceId: String(f.runtime._id), scopes: f.scopes }))
        .rejects.toMatchObject({ details: { reason: expected } })
      await expect(createOutcomeQualityStageExecution(f.command)).rejects.toMatchObject({ code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED' })
      if (mode === 'invalid-pointer') {
        await RuntimeInstance.collection.updateOne({ _id: f.runtime._id }, { $set: { lockedEvidenceSnapshot: null } })
        await expect(getRuntimeOutcomeEvidenceContractSnapshot({ runtimeInstanceId: String(f.runtime._id), scopes: f.scopes }))
          .rejects.toMatchObject({ code: 'OUTCOME_EVIDENCE_FROZEN_MEMBERSHIP_REQUIRED' })
      }
      expect(await OutcomeQualityStageExecution.countDocuments({ runtimeInstanceId: f.runtime._id })).toBe(0)
      expect(await AuditLog.countDocuments({ resourceType: 'OutcomeQualityStageExecution', 'scope.runtimeInstanceId': f.runtime._id })).toBe(0)
      saveProof('case-' + mode, { reason: expected, downstreamReceiptCount: 0, stageAuditCount: 0,
        pointer: f.prepared.pointer, contractHash: f.contract.contractHash, before, after: await frozenProofMaterial() })
      return
    }
    if (mode === 'stage-audit-rollback') {
      const original = auditService.log.bind(auditService)
      let auditWritten = false
      const spy = jest.spyOn(auditService, 'log').mockImplementation(async (entry, options) => {
        const saved = await original(entry, options)
        if (entry.action === auditService.AUDIT_ACTIONS.OUTCOME_QUALITY_STAGE_RECORDED) {
          expect(options.session.inTransaction()).toBe(true)
          expect(saved.verifySignature()).toBe(true)
          auditWritten = true
          throw new Error('Intentional synthetic failure after required stage audit write')
        }
        return saved
      })
      try { await expect(createOutcomeQualityStageExecution(f.command)).rejects.toMatchObject({ code: 'OUTCOME_QUALITY_STAGE_AUDIT_FAILED' }) }
      finally { spy.mockRestore() }
      expect(auditWritten).toBe(true)
      expect(await frozenProofMaterial()).toEqual(before)
      saveProof('case-' + mode, { requiredAuditActuallyWrittenThenAborted: auditWritten, materialUnchanged: true,
        before, after: await frozenProofMaterial() })
      return
    }
    const result = await createOutcomeQualityStageExecution(f.command)
    const receipt = await OutcomeQualityStageExecution.findOne({ stageExecutionId: result.execution.stageExecutionId }).lean()
    const expected = Object.fromEntries(['contractVersion', 'contractId', 'contractHash', 'projectionHash'].map(key => [key, f.projection[key]]))
    expect(receipt.inputSnapshot.evidenceToMeaning).toEqual(expected)
    expect(receipt.inputFingerprint).toBe(hashOutcomeQualityStageValue(receipt.inputSnapshot))
    expect(receipt.attemptFingerprint).toBe(f.candidate.attemptFingerprint)
    expect(expandEvidenceToMeaningProviderClaims(f.projection)).toEqual(f.contract.customerClaims)
    expect(f.contract.customerClaims[0]).toMatchObject({ claimStatus: 'SOURCE_PRESENTED', currentness: 'CURRENT',
      permittedInterpretation: 'EXACT_STATEMENT_ONLY', proofOrderDisposition: 'NOT_ESTABLISHED' })
    const savedPlan = await OutcomeKnowledgeCompositionPlan.findById(f.plan._id).lean()
    const frozen = JSON.parse(savedPlan.payload.evidenceToMeaning.contractJson).inputs.sourceSnapshot.inventoryReceipt.frozenMembership
    expect(frozen.membershipHash).toBe(membershipHash(frozen.body))
    expect(frozen.body.counts).toEqual({ sources: 1, evidence: 1, sections: 2 })
    const audits = await AuditLog.find({ resourceType: 'OutcomeQualityStageExecution', resourceId: receipt._id })
    expect(audits).toHaveLength(1)
    expect(audits[0].verifySignature()).toBe(true)
    expect(audits[0].diff.inputFingerprint).toBe(receipt.inputFingerprint)
    await expect(OutcomeQualityStageExecution.updateOne({ _id: receipt._id }, { $unset: { 'inputSnapshot.evidenceToMeaning': 1 } }))
      .rejects.toMatchObject({ code: 'OUTCOME_QUALITY_STAGE_IMMUTABLE' })
    expect((await OutcomeQualityStageExecution.findById(receipt._id).lean()).inputSnapshot.evidenceToMeaning).toEqual(expected)
    saveProof('case-positive', { proof: 'ISOLATED_PROVIDER_FREE_CANNED_OUTPUT_CONSUMED_RECEIPT',
      noProviderOrModelExecuted: true, actualLockActionExecuted: false, fullQualityChainProved: false,
      runtime: f.runtime, prepared: f.prepared, savedPlan, contract: f.contract, projection: f.projection,
      receipt, audit: audits[0].toObject(), before, after: await frozenProofMaterial() })
  }, 30000)
})


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
