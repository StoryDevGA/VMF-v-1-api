import fs from 'node:fs'
import mongoose from 'mongoose'
import { jest } from '@jest/globals'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import RuntimeValidationAudit from '../models/RuntimeValidationAudit.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import KnowledgePackVersion from '../models/KnowledgePackVersion.js'
import KnowledgePackActivation from '../models/KnowledgePackActivation.js'
import { assembleOutcomeEvidenceInventory } from '../utils/outcomeEvidenceSnapshot.js'
import { resolveVE02RuntimeContext, VE02_SOURCE_BINDING, ve02MaterialRevision } from '../services/runtimeValidation/ve02RuntimeContextResolver.js'
import { validateRuntimeOperation } from '../services/runtimeValidation/runtimeValidationEngine.js'
import { VE02_RESULT_CONTRACT_ID } from '../services/runtimeValidation/ve02EvidenceAssessmentResultContract.js'
import { inspectDiscoveryPolicy, inspectInstalledDiscoveryPolicy, captureInstalledDiscoveryPolicy, discoveryPolicySnapshot,
  assertInstalledDiscoveryPolicySnapshot, fenceInstalledDiscoveryPolicy, resolveInstalledPackageDiscoveryPolicy,
  installedDiscoveryPolicyDetails } from '../services/discoveryPolicyContract.js'
import { UIContract, RuntimeActivationSnapshot, RuntimeDeployment, AuditLog, FrameworkRegistry } from '../models/index.js'
import { WorkflowPolicy } from '../models/index.js'
import RuntimeAcquisitionRun from '../models/RuntimeAcquisitionRun.js'
import RuntimeStateMigrationReceipt from '../models/RuntimeStateMigrationReceipt.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import RuntimePathRegistry from '../models/RuntimePathRegistry.js'
import { executeRuntimeAction } from '../services/runtimeActionExecutionService.js'
import { buildRuntimeStateNativeCreationFrameworkState, stageRuntimeStateNativeInitialization } from '../services/runtimeStateNativeInitializationService.js'
import { randomUUID } from 'node:crypto'
import auditService from '../services/auditService.js'
import { generateChecksum } from '../services/governanceAudit/checksumService.js'
import { validateFrameworkPackage, activateFrameworkPackage, runFrameworkPackageCheckpointEndpoint, updateFrameworkPackage } from '../controllers/frameworkPackage.controller.js'
import { captureFrameworkPackageUpdateFields, validateUpdateFrameworkPackage } from '../validators/frameworkPackage.validator.js'
import { resolveVE02ContractBinding, VE02_COMPOSITION_BINDING as VE02_GRADING_BINDING } from '../services/runtimeValidation/ve02ContractBindingRegistry.js'
import { prepareVE02SyntheticAssessment } from '../services/runtimeValidation/ve02SyntheticAssessment.js'
import { prepareVE02NativeAssessment } from '../services/runtimeValidation/ve02NativeAssessment.js'
import { classifyVE02NativeText } from '../services/runtimeValidation/ve02EvidenceClassifier.js'
import express from 'express'
import request from 'supertest'
import { validateRuntimeValidationBody, validateVE02AssessmentDraftBody, validateVE02SyntheticAssessmentBody, validateVE02NativeAssessmentBody } from '../validators/runtimeValidation.validator.js'
import { validateRuntimeOperationEndpoint, prepareVE02AssessmentDraftEndpoint, prepareVE02SyntheticAssessmentEndpoint, prepareVE02NativeAssessmentEndpoint } from '../controllers/runtimeValidation.controller.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import Customer from '../models/Customer.js'
import Tenant from '../models/Tenant.js'
import { executeVE02LocalAssessment } from '../services/runtimeValidation/ve02LocalAssessment.js'
import { executeVE02LocalAssessmentEndpoint } from '../controllers/runtimeValidation.controller.js'
import { resolveVE02ClaimBinding } from '../services/runtimeValidation/ve02ClaimBinding.js'
import { recordSourceReview } from '../services/sourceVerificationContext.js'
import { hashEvidenceToMeaningValue, compileEvidenceToMeaningContract } from '../services/outcomeEvidenceToMeaningContractService.js'
import OutcomeKnowledgeCompositionPlan from '../models/OutcomeKnowledgeCompositionPlan.js'
import { makeSs041Fixture } from './fixtures/outcomeEvidenceToDraftFixtures.js'
import { projectRuntimeEvidenceOutputPlanBinding } from '../services/outcomeRuntimeEvidenceToMeaningService.js'
import { hashOutcomeKnowledgeCompositionSemanticValue, assertOutcomeKnowledgeCompositionPlanIntegrity } from '../services/outcomeKnowledgeCompositionPlanService.js'
import { OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION, OUTCOME_QUALITY_STAGE_SEQUENCE } from '../constants/outcomeGovernedQuality.js'

// Isolated Mongo persistence/concurrency proof. Fixture lifecycle records and
// authorized runtime reads do not constitute customer or production acceptance.
let replica, runtime, evidence, source, activation, payload
const id = (number) => new mongoose.Types.ObjectId(number.toString(16).padStart(24, '0'))
const rawSource = fs.readFileSync(new URL('../runtime-contracts/ve02/VE02_EvidenceAssessmentResult_v1.0.md', import.meta.url), 'utf8')
const models = [RuntimeValidationAudit, RuntimeInstance, RuntimeEvidenceObject, RuntimeEvidenceSource,
  FrameworkPackage, KnowledgePackVersion, KnowledgePackActivation, Customer, Tenant, OutcomeKnowledgeCompositionPlan,
  UIContract, RuntimeActivationSnapshot, RuntimeDeployment, AuditLog, FrameworkRegistry]
models.push(WorkflowPolicy, RuntimeAcquisitionRun, RuntimeStateMigrationReceipt, RuntimeStateSection, RuntimeGraphSnapshot, RuntimeGraphElement, RuntimePathRegistry)
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, name: 'ss038_ve02_isolated' } })
  const uri = replica.getUri('ss038_ve02_receipts')
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/ss038_ve02_receipts\?/.test(uri)) throw new Error('Isolated loopback database required.')
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false })
  await RuntimeValidationAudit.createCollection()
  for (const model of [UIContract, RuntimeActivationSnapshot, RuntimeDeployment, AuditLog]) await model.createCollection()
  for (const model of [RuntimeAcquisitionRun, RuntimeStateMigrationReceipt, RuntimeStateSection, RuntimeGraphSnapshot, RuntimeGraphElement]) await model.createCollection()
  await RuntimeAcquisitionRun.createIndexes()
  const [keys, options] = RuntimeValidationAudit.schema.indexes().find(([, opts]) => opts.name === 'unique_ve02_consumption_result')
  await RuntimeValidationAudit.collection.createIndex(keys, options)
}, 60000)
afterAll(async () => { await mongoose.disconnect(); if (replica) await replica.stop() })
afterEach(() => jest.restoreAllMocks())
beforeEach(async () => {
  for (const model of models) await model.collection.deleteMany({})
  runtime = { _id: id(1), customerId: id(2), tenantId: id(3), runtimeInstanceKey: 'fixture-runtime',
    stateVersion: 'runtime-state-v2-fixture', frameworkKey: 'QMF', packageId: id(4),
    packageKey: 'ss038-fixture', packageVersion: '0.38.1', runtimeType: 'VALUE_NARRATIVE', __v: 0 }
  const scope = { customerId: runtime.customerId, tenantId: runtime.tenantId, runtimeInstanceId: runtime._id,
    runtimeInstanceKey: runtime.runtimeInstanceKey, stateVersion: runtime.stateVersion,
    sourceStateVersion: runtime.stateVersion, sourceHash: `sha256:${'a'.repeat(64)}`, current: true,
    createdAt: new Date('2026-10-07T00:00:00Z'), updatedAt: new Date('2026-10-07T00:00:00Z'), __v: 0 }
  evidence = { ...scope, _id: id(5), evidenceObjectId: 'fixture-evidence', sourceId: 'fixture-source',
    extractedFact: 'Fixture governed fact.', lineageRef: 'fixture-evidence-lineage', contentHash: `sha256:${'b'.repeat(64)}` }
  source = { ...scope, _id: id(6), sourceId: 'fixture-source', sourceType: 'DISCOVERY_NOTES',
    sourceRef: 'fixture-source-reference', contentHash: `sha256:${'c'.repeat(64)}` }
  activation = { _id: id(7), activationId: 'fixture-activation', packId: 'fixture-pack',
    versionId: 'fixture-ve02-version', packType: VE02_SOURCE_BINDING.packType, packKey: VE02_SOURCE_BINDING.packKey,
    status: 'ACTIVE', scopeKey: 'PACKAGE:QMF:SS038-FIXTURE:0.38.1', scopeType: 'PACKAGE',
    contentHash: VE02_SOURCE_BINDING.contentHash, __v: 0 }
  await RuntimeInstance.collection.insertOne(runtime)
  await RuntimeEvidenceObject.collection.insertOne(evidence)
  await RuntimeEvidenceSource.collection.insertOne(source)
  await FrameworkPackage.collection.insertOne({ _id: runtime.packageId, frameworkKey: 'QMF',
    packageKey: runtime.packageKey, dependencyLock: { status: 'PASS', references: [{ id: 'fixture-existing-dependency' }] } })
  await KnowledgePackActivation.collection.insertOne(activation)
  await KnowledgePackVersion.collection.insertOne({ _id: id(8), versionId: activation.versionId,
    status: 'VALIDATED', content: rawSource.trim(), contentHash: VE02_SOURCE_BINDING.contentHash,
    sourceDocuments: [{ sourceDocumentId: VE02_SOURCE_BINDING.sourceDocumentId, sourceHash: VE02_SOURCE_BINDING.contentHash }], __v: 0 })
  payload = { contract_id: VE02_RESULT_CONTRACT_ID, schema_version: '1.0',
    result_id: 'fixture-assessment-revision', result_status: 'COMPLETE', evidence_id: evidence.evidenceObjectId,
    evidence_revision_ref: ve02MaterialRevision(evidence, source), runtime_owner: 'VE02',
    runtime_version_ref: VE02_SOURCE_BINDING.governingRuntimeVersion, assessed_at: '2026-10-07T16:00:00Z',
    source_reliability: 'MODERATE', relevance: 'STRONG', specificity: 'MODERATE', independence: 'MODERATE',
    assessment_result: 'MODERATE', evidence_direction: 'SUPPORTS', assessment_reasons: ['Fixture governed assessment.'],
    restrictions: ['No truth promotion.'], contradiction_refs: [], provenance_refs: [source.sourceRef, evidence.lineageRef] }
})

const resolveContext = (input, { session }) => resolveVE02RuntimeContext({ input, scopes: {}, session, dependencies: {
  runtimeReader: async () => {
    const row = await RuntimeInstance.findById(runtime._id).session(session).lean()
    return { ...row, id: String(row._id), customerId: String(row.customerId), tenantId: String(row.tenantId), packageId: String(row.packageId) }
  },
  snapshotReader: async () => {
    const root = await RuntimeInstance.findById(runtime._id).session(session).lean()
    const scope = { customerId: String(root.customerId), tenantId: String(root.tenantId), runtimeInstanceId: String(root._id),
      runtimeInstanceKey: root.runtimeInstanceKey, stateVersion: root.stateVersion }
    const filter = { customerId: root.customerId, tenantId: root.tenantId, runtimeInstanceId: root._id, current: true }
    const rows = { evidence: await RuntimeEvidenceObject.find(filter).session(session).lean(),
      sources: await RuntimeEvidenceSource.find(filter).session(session).lean() }
    const assembled = await assembleOutcomeEvidenceInventory({ scope, sections: [],
      count: async (kind) => rows[kind].length, readPage: async (kind) => rows[kind], validateRows: () => {} })
    return { stateVersion: root.stateVersion, inventoryReceipt: assembled.receipt,
      evidenceObjects: assembled.evidenceObjects, sourceRegistry: assembled.sourceRegistry }
  },
} })
const consume = (changes = {}, resolver = resolveContext) => validateRuntimeOperation({
  operationType: 'OUTPUT_VALIDATION', mode: 'STRICT', packageId: String(runtime.packageId), frameworkKey: 'QMF',
  runtimeInstanceId: String(runtime._id), outputContract: { $id: VE02_RESULT_CONTRACT_ID }, payload, ...changes,
}, { resolveVE02Context: resolver })
const receiptCount = () => RuntimeValidationAudit.countDocuments({ 've02Receipt.resultId': payload.result_id })

const httpApp = express()
httpApp.use(express.json())
httpApp.post('/validate', (req, _res, next) => {
  req.scopes = { resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'], permissions: [] } } }
  next()
}, validateRuntimeValidationBody, validateRuntimeOperationEndpoint)
httpApp.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code } }))
const httpInput = (changes = {}) => ({ operationType: 'OUTPUT_VALIDATION', mode: 'STRICT',
  packageId: String(runtime.packageId), frameworkKey: 'QMF', payload,
  outputContract: { $id: VE02_RESULT_CONTRACT_ID, type: 'object' }, ...changes })

test.each(['QMF', 'VMF'])('installed source resolution is exact for %s and never certifies the assessment producer', async (frameworkKey) => {
  const query = { frameworkKey, packageKey: runtime.packageKey, packageVersion: runtime.packageVersion }
  await KnowledgePackActivation.collection.updateOne({ _id: activation._id }, { $set: {
    scopeKey: `PACKAGE:${frameworkKey}:SS038-FIXTURE:0.38.1`,
  } })
  const binding = await resolveVE02ContractBinding({ query })
  expect(binding.consumer).toMatchObject({ role: 'CONTRACT_CONSUMER', assessmentProducerStatus: 'UNVERIFIED' })
  const report = await inspectInstalledDiscoveryPolicy({ ...query, version: query.packageVersion,
    discoveryPolicy: { contractVersion: 'framework-package-discovery-policy-v1', policyKey: 'fixture-policy', policyVersion: '1',
      evidencePolicy: { ownerMappings: [{ mappingKey: 'quality', vmfCapabilityRef: 'VE02', ownerRuntime: 'VE02 / Bundle 02',
        implementationRef: 'validation-evidence-quality-check' }] } } })
  expect(report.status).toBe('UNRESOLVED')
  expect(report.unresolvedReferences[0].semanticTarget).toMatchObject({ installationStatus: 'VERIFIED_ACTIVE',
    implementationStatus: 'UNVERIFIED', typedConsumer: { role: 'CONTRACT_CONSUMER' } })
  await expect(resolveVE02ContractBinding({ query: { ...query, packageVersion: 'other' } })).rejects.toThrow(/active/i)
})

test('mounted validator/controller cannot accept caller-authored context or permissive schema as VE02 proof', async () => {
  const response = await request(httpApp).post('/validate').send(httpInput({
    payload: { ...payload, assessed_at: '2026-02-30T00:00:00Z' },
    ve02Context: { verified: true, resultRecords: [] }, persistAudit: false,
  }))
  expect(response.status).toBe(422)
  expect(response.body.error.validation.ve02ResultEligibility.eligible).toBe(false)
  expect(await receiptCount()).toBe(0)
})

test('mounted validator/controller rejects cross-scope runtime selection before receipt writes', async () => {
  const response = await request(httpApp).post('/validate').send(httpInput({
    runtimeInstanceId: String(runtime._id), customerId: String(id(999)), tenantId: String(runtime.tenantId),
    ve02Context: { verified: true },
  }))
  expect([403, 404]).toContain(response.status)
  expect(await receiptCount()).toBe(0)
  expect((await RuntimeInstance.findById(runtime._id).lean()).__v).toBe(0)
})

test('mounted controller cannot certify package readiness from a VE02 result', async () => {
  const response = await request(httpApp).post('/validate').send(httpInput({ isPackageLevelValidation: true }))
  expect(response.status).toBe(422)
  expect(await RuntimeValidationAudit.countDocuments()).toBe(0)
})

test('mounted controller consumes through native scoped runtime and complete inventory reads', async () => {
  await Customer.collection.insertOne({ _id: runtime.customerId, name: 'Isolated fixture customer',
    licenseLevelId: null, entitlements: ['VMF'], topology: 'SINGLE_TENANT' })
  await Tenant.collection.insertOne({ _id: runtime.tenantId, customerId: runtime.customerId, status: 'ENABLED' })
  const response = await request(httpApp).post('/validate').send(httpInput({
    runtimeInstanceId: String(runtime._id), customerId: String(runtime.customerId), tenantId: String(runtime.tenantId),
  }))
  expect(response.body).toMatchObject({ data: { ve02ResultEligibility: { eligible: true } } })
  expect(response.status).toBe(200)
  expect(await receiptCount()).toBe(1)
  const replay = await request(httpApp).post('/validate').send(httpInput({
    runtimeInstanceId: String(runtime._id), customerId: String(runtime.customerId), tenantId: String(runtime.tenantId),
  }))
  expect(replay.status).toBe(200)
  expect(replay.body.data.ve02ResultEligibility).toEqual(response.body.data.ve02ResultEligibility)
  await RuntimeEvidenceSource.collection.updateOne({ _id: source._id }, { $set: { contentHash: `sha256:${'d'.repeat(64)}` } })
  const stale = await request(httpApp).post('/validate').send(httpInput({
    runtimeInstanceId: String(runtime._id), customerId: String(runtime.customerId), tenantId: String(runtime.tenantId),
  }))
  expect(stale.status).toBe(422)
  expect(stale.body.error.validation.ve02ResultEligibility.eligible).toBe(false)
  expect(await receiptCount()).toBe(1)
})

test.each(['NON_COMPLETE_DO_NOT_CONSUME', 'TRANSPORT_PLACEHOLDER_NOT_AN_INSUFFICIENCY_FINDING',
  'SYNTHETIC_QMF_ONLY'])('mounted consumer rejects COMPLETE %s without fences or receipts', async restriction => {
  await Customer.collection.insertOne({ _id: runtime.customerId, name: 'Isolated fixture customer',
    licenseLevelId: null, entitlements: ['VMF'], topology: 'SINGLE_TENANT' })
  await Tenant.collection.insertOne({ _id: runtime.tenantId, customerId: runtime.customerId, status: 'ENABLED' })
  const before = await Promise.all([RuntimeInstance, RuntimeEvidenceSource, RuntimeEvidenceObject, KnowledgePackActivation]
    .map(model => model.find({}).lean()))
  const response = await request(httpApp).post('/validate').send(httpInput({
    runtimeInstanceId: String(runtime._id), customerId: String(runtime.customerId), tenantId: String(runtime.tenantId),
    payload: { ...payload, restrictions: [restriction] },
  }))
  expect(response.status).toBe(422)
  expect(response.body.error.validation.ve02ResultEligibility.eligible).toBe(false)
  expect(await receiptCount()).toBe(0)
  expect(await Promise.all([RuntimeInstance, RuntimeEvidenceSource, RuntimeEvidenceObject, KnowledgePackActivation]
    .map(model => model.find({}).lean()))).toEqual(before)
})

// Controlled authentication scopes + production role guard and native reads.
// This demonstrates draft preparation, not JWT login or a verified assessor.
const draftApp = express()
draftApp.use(express.json())
const draftAuth = (req, res, next) => {
  const role = req.get('x-fixture-role')
  if (!role) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } })
  req.scopes = { platformRoles: [role],
    resolvedPermissions: { platform: { roleKeys: [role], permissions: [] } } }
  return next()
}
draftApp.post('/ve02/assessment-draft', draftAuth, requirePlatformRole('SUPER_ADMIN'), validateVE02AssessmentDraftBody, prepareVE02AssessmentDraftEndpoint)
draftApp.post('/ve02/synthetic-assessment', draftAuth, requirePlatformRole('SUPER_ADMIN'), validateVE02SyntheticAssessmentBody, prepareVE02SyntheticAssessmentEndpoint)
draftApp.post('/ve02/synthetic-classification', draftAuth, requirePlatformRole('SUPER_ADMIN'), validateVE02NativeAssessmentBody, prepareVE02NativeAssessmentEndpoint)
draftApp.post('/ve02/local-assessment', draftAuth, requirePlatformRole('SUPER_ADMIN'), validateVE02NativeAssessmentBody, executeVE02LocalAssessmentEndpoint)
draftApp.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code, message: error.message } }))
const draftInput = () => ({ frameworkKey: runtime.frameworkKey, packageId: String(runtime.packageId),
  runtimeInstanceId: String(runtime._id), customerId: String(runtime.customerId), tenantId: String(runtime.tenantId),
  evidenceId: evidence.evidenceObjectId, expectedEvidenceRevisionRef: payload.evidence_revision_ref,
  proposedHypothesis: { statement: 'Proposed customer outcome improved.' },
  judgments: Object.fromEntries(['source_reliability', 'relevance', 'specificity', 'independence',
    'assessment_result', 'evidence_direction', 'assessment_reasons', 'restrictions', 'contradiction_refs']
    .map((field) => [field, payload[field]])),
})
const draftRecords = async () => Promise.all(models.map(async (model) => [model.modelName,
  await model.collection.find({}).sort({ _id: 1 }).toArray()]))
const draftCustomer = async () => {
  await Customer.collection.insertOne({ _id: runtime.customerId, name: 'Isolated draft fixture',
    licenseLevelId: null, entitlements: ['VMF'], topology: 'SINGLE_TENANT' })
  await Tenant.collection.insertOne({ _id: runtime.tenantId, customerId: runtime.customerId, status: 'ENABLED' })
}

test('mounted draft preparation uses native scoped snapshot reads without modifying any stored record', async () => {
  await draftCustomer()
  const before = await draftRecords()
  const response = await request(draftApp).post('/ve02/assessment-draft').set('x-fixture-role', 'SUPER_ADMIN').send(draftInput())
  expect(response.status).toBe(200)
  expect(response.body.data).toMatchObject({ status: 'PROPOSED', executionEligible: false,
    assessmentProcedureVerified: false, hypothesisVerified: false,
    basis: { evidenceRevisionRef: payload.evidence_revision_ref, runtimeInstanceId: String(runtime._id) },
    contractCandidate: { result_status: 'UNRESOLVED', provenance_refs: [source.sourceRef, evidence.lineageRef] } })
  expect(await draftRecords()).toEqual(before)
  expect(await RuntimeValidationAudit.countDocuments()).toBe(0)
})

test.each([['', 401], ['CUSTOMER_ADMIN', 403]])('mounted draft endpoint denies role %s before preparation', async (role, status) => {
  const before = await draftRecords()
  const operation = request(draftApp).post('/ve02/assessment-draft')
  if (role) operation.set('x-fixture-role', role)
  const response = await operation.send(draftInput())
  expect(response.status).toBe(status)
  expect(await draftRecords()).toEqual(before)
})

test('mounted draft endpoint rejects forged authority and stale source revisions without writes', async () => {
  await draftCustomer()
  const before = await draftRecords()
  const forged = await request(draftApp).post('/ve02/assessment-draft').set('x-fixture-role', 'SUPER_ADMIN')
    .send({ ...draftInput(), executionEligible: true, result_status: 'COMPLETE', provenance_refs: ['forged'] })
  expect(forged.status).toBe(422)
  expect(await draftRecords()).toEqual(before)
  await RuntimeEvidenceSource.collection.updateOne({ _id: source._id }, { $set: { contentHash: `sha256:${'d'.repeat(64)}` } })
  const changed = await draftRecords()
  const stale = await request(draftApp).post('/ve02/assessment-draft').set('x-fixture-role', 'SUPER_ADMIN').send(draftInput())
  expect(stale.status).toBe(409)
  expect(stale.body.error.code).toBe('VE02_DRAFT_BASIS_CHANGED')
  expect(await draftRecords()).toEqual(changed)
})

test('mounted draft endpoint rejects foreign scope and missing canonical evidence without writes', async () => {
  await draftCustomer()
  const before = await draftRecords()
  const foreign = await request(draftApp).post('/ve02/assessment-draft').set('x-fixture-role', 'SUPER_ADMIN')
    .send({ ...draftInput(), customerId: String(id(999)) })
  expect(foreign.status).toBe(404)
  const missing = await request(draftApp).post('/ve02/assessment-draft').set('x-fixture-role', 'SUPER_ADMIN')
    .send({ ...draftInput(), evidenceId: 'missing-evidence' })
  expect(missing.status).toBe(422)
  expect(missing.body.error.code).toBe('VE02_DRAFT_BASIS_UNAVAILABLE')
  expect(await draftRecords()).toEqual(before)
})

const installSyntheticGradingFixture = async () => {
  await draftCustomer()
  runtime.packageKey = 'ss038-synthetic-qmf-0-38-1'
  await RuntimeInstance.collection.updateOne({ _id: runtime._id }, { $set: { packageKey: runtime.packageKey } })
  await FrameworkPackage.collection.updateOne({ _id: runtime.packageId }, { $set: { packageKey: runtime.packageKey } })
  const scopeKey = 'PACKAGE:QMF:SS038-SYNTHETIC-QMF-0-38-1:0.38.1'
  await KnowledgePackActivation.collection.updateOne({ _id: activation._id }, { $set: { scopeKey } })
  await KnowledgePackActivation.collection.updateOne({ _id: activation._id }, { $set: {
    versionId: 'fixture-grading-version', contentHash: VE02_GRADING_BINDING.contentHash } })
  const content = rawSource.trim() + VE02_GRADING_BINDING.separator
    + fs.readFileSync(new URL('../runtime-contracts/ve02/VE02_Grading_Aggregation_Direction_v1.0_StorylineOS.md', import.meta.url), 'utf8').trim()
  await KnowledgePackVersion.collection.insertOne({ _id: id(99), versionId: 'fixture-grading-version', status: 'VALIDATED', content,
    contentHash: VE02_GRADING_BINDING.contentHash,
    sourceDocuments: [{ sourceDocumentId: VE02_GRADING_BINDING.sourceDocumentId, sourceHash: VE02_GRADING_BINDING.contentHash }] })
}

const nativeInput = () => {
  const { judgments, ...identity } = draftInput()
  return identity
}
const nativeProposal = async ({ passage }) => Object.fromEntries(['source_reliability', 'relevance', 'specificity',
  'independence', 'evidence_direction'].map((key) => [key, { grade: key === 'evidence_direction' ? 'SUPPORTS' : 'MODERATE',
  reason: 'Synthetic proposed interpretation of the exact native passage.', basis: 'EVIDENCE', field: 'passage', quote: passage }]))

const localFixture = async () => {
  await installSyntheticGradingFixture()
  const review = recordSourceReview({ source, actorUserId: 'fixture-reviewer', facts: {
    authenticity: 'AUTHENTIC', sourceOrigin: 'Controlled synthetic fixture', organizationRelationship: 'Independent fixture',
    independenceGroup: 'fixture-one', supportingReference: 'fixture:review', rationale: 'Isolated acceptance record' } })
  await RuntimeEvidenceSource.collection.updateOne({ _id: source._id }, { $set: { verificationContext: review } })
  const frozenEvidence = await RuntimeEvidenceObject.findById(evidence._id).lean()
  const frozenSource = await RuntimeEvidenceSource.findById(source._id).lean()
  const savedClaim = { claimKey: 'claim-fixture', evidenceReference: evidence.evidenceObjectId, sourceReference: source.sourceId,
    statement: evidence.extractedFact, evidenceHash: hashEvidenceToMeaningValue(frozenEvidence),
    sourceHash: hashEvidenceToMeaningValue(frozenSource), restriction: 'EXACT_STATEMENT_ONLY' }
  const contract = { contractHash: 'fixture-saved-contract', inputs: { sourceSnapshot: {
    inventoryReceipt: { scope: { runtimeInstanceId: String(runtime._id), customerId: String(runtime.customerId),
      tenantId: String(runtime.tenantId), stateVersion: runtime.stateVersion } },
    evidenceObjects: [frozenEvidence], sourceRegistry: [frozenSource] } }, customerClaims: [savedClaim] }
  const input = { ...nativeInput(), expectedEvidenceRevisionRef: ve02MaterialRevision(frozenEvidence, frozenSource),
    proposedHypothesis: { statement: savedClaim.statement },
    claimBinding: { planId: 'fixture-plan', requestId: 'fixture-request', claimKey: savedClaim.claimKey } }
  const dependencies = { enabled: true, model: 'gpt-4.1-mini', classify: jest.fn(nativeProposal),
    resolveContext: ({ input: operation, session }) => resolveContext(operation, { session }),
    resolveClaimBinding: args => resolveVE02ClaimBinding({ ...args, dependencies: {
      readPlan: async () => ({ planId: input.claimBinding.planId, requestId: input.claimBinding.requestId, planFingerprint: 'fixture-plan-hash' }),
      assertPlan: () => {}, readContract: () => contract } }) }
  return { input, dependencies, contract }
}
const localRun = fixture => executeVE02LocalAssessment({ ...fixture, scopes: {}, actorId: 'fixture-admin', requestId: 'fixture-request' })

const localPolicy = () => ({ contractVersion: 'framework-package-discovery-policy-v1', policyKey: 'controlled-quality', policyVersion: '1',
  evidencePolicy: { ownerMappings: [{ mappingKey: 'quality', vmfCapabilityRef: 'VE02', ownerRuntime: 'VE02 / Bundle 02',
    resultType: 'VMF.VE02.EvidenceAssessmentResult', resultContractVersion: '1.0',
    sourceRef: 'https://drive.google.com/file/d/17rkALp4x5q5VByzIn9adocJM3YtqdMgN/view',
    sourceVersion: 'Bundle 02 v1.4 / STATE v1.6 / DDS v1.8 — VE02RC001', implementationRef: 'validation-evidence-quality-check',
    implementationVersion: 'storylineos-ve02-local-assessor-v1' }] } })

const prepareLocalLifecycle = async () => {
  await installSyntheticGradingFixture()
  await FrameworkRegistry.collection.insertOne({ frameworkKey: 'QMF', name: 'Controlled QMF fixture', status: 'ACTIVE' })
  await FrameworkPackage.collection.deleteOne({ _id: runtime.packageId })
  const ui = { _id: id(105), stableId: 'controlled-ui', uiContractKey: 'controlled-ui', componentVersion: 1,
    frameworkKeys: ['QMF'], sourcePackageVersion: '0.38.1', compatibilityMode: 'STRICT',
    status: 'ACTIVE', versionStatus: 'ACTIVE', isLocked: true,
    sections: [{ sectionKey: 'context' }], actions: [], lifecycleStages: [] }
  await UIContract.collection.insertOne(ui)
  const pkg = await FrameworkPackage.create({ _id: runtime.packageId, frameworkKey: 'QMF', frameworkName: 'QMF',
    version: runtime.packageVersion, packageKey: runtime.packageKey, status: 'DRAFT', createdBy: id(101), updatedBy: id(101),
    discoveryPolicy: localPolicy(), sections: ui.sections, uiContractKey: ui.uiContractKey,
    uiContractBinding: { key: ui.uiContractKey, version: runtime.packageVersion, status: 'ACTIVE', compatibilityMode: 'STRICT' } })
  return { pkg, ui }
}
const promoteLocalFixture = async ({ pkg, ui, session }) => {
  const report = await inspectInstalledDiscoveryPolicy(pkg, { session })
  const snapshot = { status: 'PASS', resolvedAt: new Date(), packageKey: pkg.packageKey, packageVersion: pkg.version,
    references: [{ collectionKey: 'UIContract', id: ui.stableId, key: ui.uiContractKey,
      componentVersion: 1, status: 'ACTIVE', versionStatus: 'ACTIVE' }],
    uiContractSnapshot: { uiContractKey: ui.uiContractKey, stableId: ui.stableId, componentVersion: 1,
      actionCount: 0, lifecycleStageCount: 0, sectionMapping: { mapped: ['context'] } },
    ...discoveryPolicySnapshot(pkg.discoveryPolicy), ...captureInstalledDiscoveryPolicy(pkg, report) }
  pkg.dependencyLock = { snapshotId: 'controlled-local-snapshot', snapshotHash: generateChecksum(snapshot), ...snapshot }
  const { snapshotId: _snapshotId, snapshotHash: _snapshotHash, ...castSnapshot } = pkg.dependencyLock.toObject()
  pkg.dependencyLock.snapshotHash = generateChecksum(castSnapshot)
  pkg.status = 'VALIDATED'
  pkg.lastCheckpointStatus = 'PASS'
  await pkg.save({ session })
}

test.each(['success', 'audit-rollback', 'binding-disabled-during-acquisition'])(
  'mounted installed local candidate acquisition: %s', async kind => {
  const previous = [process.env.VE02_LOCAL_ASSESSMENT_ENABLED, process.env.VE02_CLASSIFICATION_MODEL]
  process.env.VE02_LOCAL_ASSESSMENT_ENABLED = 'true'; process.env.VE02_CLASSIFICATION_MODEL = 'gpt-4.1-mini'
  const session = await mongoose.startSession()
  try {
    const fixture = await prepareLocalLifecycle()
    fixture.pkg.sections[0].runtimePath = 'framework_state.sections.context'
    await RuntimePathRegistry.collection.insertOne({ pathKey: 'framework_state.evidence_pack', status: 'ACTIVE',
      frameworkKeys: ['QMF'], allowedOperations: ['READ', 'WRITE'], dataType: 'OBJECT', scope: 'FRAMEWORK_STATE' })
    fixture.pkg.workflowBindings = [{ policyKey: 'controlled-acquisition', executionContext: 'ON_RUN', priority: 100, enabled: true }]
    await UIContract.collection.updateOne({ _id: fixture.ui._id }, { $set: { actions: [{ actionKey: 'SAVE_DISCOVERY_INPUTS', governedAction: 'SAVE_DISCOVERY_INPUTS' }] } })
    await WorkflowPolicy.collection.insertOne({ key: 'controlled-acquisition', status: 'ACTIVE', versionStatus: 'ACTIVE', frameworkKeys: ['QMF'],
      governedAction: 'SAVE_DISCOVERY_INPUTS', decisionMode: 'ALLOW', conditions: [] })
    await session.withTransaction(() => promoteLocalFixture({ ...fixture, session }))
    // Installed synthetic renderer fixture; actual lifecycle activation is
    // independently exercised by the mounted lifecycle test below.
    await FrameworkPackage.collection.updateOne({ _id: fixture.pkg._id }, { $set: { status: 'ACTIVE' } })
    const deployment = { activationId: 'controlled-action-activation', deploymentId: 'controlled-action-deployment',
      packageId: fixture.pkg._id, packageKey: fixture.pkg.packageKey, frameworkKey: 'QMF', frameworkVersion: fixture.pkg.version,
      dependencySnapshotId: fixture.pkg.dependencyLock.snapshotId, dependencySnapshotHash: fixture.pkg.dependencyLock.snapshotHash }
    await RuntimeDeployment.collection.insertOne({ ...deployment, status: 'ACTIVE' })
    await RuntimeActivationSnapshot.collection.insertOne({ ...deployment, activationStatus: 'ACTIVE' })
    await RuntimeEvidenceObject.deleteMany({}); await RuntimeEvidenceSource.deleteMany({})
    runtime.stateVersion = `rsv2:${randomUUID()}`
    runtime.framework_state = buildRuntimeStateNativeCreationFrameworkState({ frameworkPackage: fixture.pkg, stateVersion: runtime.stateVersion })
    runtime.status = 'ACTIVE'; runtime.executionStatus = 'IDLE'; runtime.updatedAt = new Date()
    runtime.dependencyLockId = fixture.pkg.dependencyLock.snapshotId
    runtime.activationId = deployment.activationId
    runtime.deploymentId = deployment.deploymentId
    runtime.evidence = { activationId: deployment.activationId, deploymentId: deployment.deploymentId,
      dependencySnapshotId: fixture.pkg.dependencyLock.snapshotId, dependencySnapshotHash: fixture.pkg.dependencyLock.snapshotHash }
    await RuntimeInstance.collection.replaceOne({ _id: runtime._id }, runtime)
    await session.withTransaction(() => stageRuntimeStateNativeInitialization({ runtimeInstance: runtime, frameworkPackage: fixture.pkg, actorUserId: id(101), session }))
    const scopes = { customer: { _id: runtime.customerId }, tenant: { _id: runtime.tenantId, customerId: runtime.customerId },
      resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'], permissions: [] } } }
    const app = express(); app.use(express.json())
    app.post('/actions/:actionKey', async (req, res, next) => {
      try { res.json(await executeRuntimeAction({ actionKey: req.params.actionKey, actorUserId: String(id(101)),
        scopes, runtimeInstanceId: String(runtime._id), payload: req.body })) } catch (error) { next(error) }
    })
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message, details: error.details }))
    const before = await RuntimeInstance.findById(runtime._id).lean()
    const beforeReceiptCount = await RuntimeValidationAudit.countDocuments({ ve02Receipt: { $exists: true } })
    const beforeActivation = await KnowledgePackActivation.findById(activation._id).lean()
    const beforeSections = await RuntimeStateSection.find().lean()
    if (kind === 'audit-rollback') {
      const log = auditService.log.bind(auditService)
      jest.spyOn(auditService, 'log').mockImplementation((entry, options) => {
        if (entry.action === auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED) throw new Error('Required candidate action audit failed')
        return log(entry, options)
      })
    }
    if (kind === 'binding-disabled-during-acquisition') {
      const find = RuntimePathRegistry.findOne.bind(RuntimePathRegistry)
      jest.spyOn(RuntimePathRegistry, 'findOne').mockImplementationOnce((...args) => {
        const query = find(...args), lean = query.lean.bind(query)
        query.lean = async (...options) => {
          const row = await lean(...options)
          process.env.VE02_LOCAL_ASSESSMENT_ENABLED = 'false'
          return row
        }
        return query
      })
    }
    const acquired = await request(app).post('/actions/SAVE_DISCOVERY_INPUTS').send({ expectedUpdatedAt: before.updatedAt.toISOString(),
      requestKey: randomUUID(), inputs: { companyName: 'Controlled synthetic company' },
      documentSources: [{ fileName: 'controlled.txt', textContent: 'Controlled synthetic company serves a clearly defined market. This is synthetic evidence for an isolated candidate acquisition test.' }] })
    expect(await RuntimeValidationAudit.countDocuments({ ve02Receipt: { $exists: true } })).toBe(beforeReceiptCount)
    if (kind !== 'success') {
      expect(acquired.status).toBe(kind === 'audit-rollback' ? 500 : 409)
      const failedRun = await RuntimeAcquisitionRun.findOne({ runtimeInstanceId: runtime._id }).lean()
      expect(failedRun.canonicalSaved).not.toBe(true)
      expect(await RuntimeInstance.findById(runtime._id).lean()).toEqual(before)
      expect(await KnowledgePackActivation.findById(activation._id).lean()).toEqual(beforeActivation)
      expect(await RuntimeStateSection.find().lean()).toEqual(beforeSections)
      expect(await RuntimeEvidenceObject.countDocuments({ current: true })).toBe(0)
      return
    }
    expect(acquired.body).not.toHaveProperty('message')
    expect(acquired.status).toBe(200)
    const after = await RuntimeInstance.findById(runtime._id).lean()
    expect(after.stateVersion).not.toBe(before.stateVersion)
    expect(after.framework_state.sections).toEqual(before.framework_state.sections)
    expect(after.framework_state.evidence_pack.accepted).not.toBe(true)
    const candidates = await RuntimeEvidenceObject.find({ runtimeInstanceId: runtime._id, current: true }).lean()
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.every(row => row.reviewStatus === 'PENDING')).toBe(true)
    const sources = await RuntimeEvidenceSource.find({ runtimeInstanceId: runtime._id, current: true }).lean()
    expect(candidates.every(row => row.sourceHash && sources.some(sourceRow => sourceRow.sourceId === row.sourceId
      && sourceRow.stateVersion === row.stateVersion && sourceRow.sourceHash === row.sourceHash))).toBe(true)
    const denied = await request(app).post('/actions/ACCEPT_EVIDENCE').send({ expectedUpdatedAt: after.updatedAt.toISOString() })
    expect(denied.status).toBe(409)
    expect(await RuntimeInstance.findById(runtime._id).lean()).toEqual(after)
  } finally {
    await session.endSession()
    for (const [key, value] of [['VE02_LOCAL_ASSESSMENT_ENABLED', previous[0]], ['VE02_CLASSIFICATION_MODEL', previous[1]]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})

test.each(['success', 'audit-rollback', 'disabled'])('validated configured metadata PATCH: %s', async kind => {
  const previous = [process.env.VE02_LOCAL_ASSESSMENT_ENABLED, process.env.VE02_CLASSIFICATION_MODEL]
  process.env.VE02_LOCAL_ASSESSMENT_ENABLED = 'true'; process.env.VE02_CLASSIFICATION_MODEL = 'gpt-4.1-mini'
  const session = await mongoose.startSession()
  try {
    const fixture = await prepareLocalLifecycle()
    await session.withTransaction(() => promoteLocalFixture({ ...fixture, session }))
    const before = await FrameworkPackage.findById(fixture.pkg._id).lean()
    const activationBefore = await KnowledgePackActivation.findById(activation._id).lean()
    const versionBefore = await KnowledgePackVersion.findOne({ versionId: 'fixture-grading-version' }).lean()
    const auditsBefore = await AuditLog.find().lean()
    const app = express(); app.use(express.json())
    app.use((req, _res, next) => { req.context = { userId: String(id(101)) }; req.requestId = 'validated-metadata'; next() })
    app.patch('/packages/:packageId', captureFrameworkPackageUpdateFields, validateUpdateFrameworkPackage, updateFrameworkPackage)
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, message: error.message }))
    if (kind === 'audit-rollback') jest.spyOn(AuditLog, 'createLog').mockImplementationOnce(async () => { throw new Error('Required metadata audit failed') })
    if (kind === 'disabled') process.env.VE02_LOCAL_ASSESSMENT_ENABLED = 'false'
    const response = await request(app).patch(`/packages/${fixture.pkg._id}`).send({ description: 'Reviewed metadata update' })
    expect(response.status).toBe({ success: 200, 'audit-rollback': 500, disabled: 422 }[kind])
    const after = await FrameworkPackage.findById(fixture.pkg._id).lean()
    if (kind === 'success') {
      expect(after.description).toBe('Reviewed metadata update')
      expect(after.status).toBe('VALIDATED')
      expect(after.discoveryPolicy).toEqual(before.discoveryPolicy)
      expect(after.dependencyLock).toEqual(before.dependencyLock)
      const audits = await AuditLog.find({ action: auditService.AUDIT_ACTIONS.FRAMEWORK_PACKAGE_UPDATED }).lean()
      expect(audits).toHaveLength(1)
      expect(audits[0].diff.description).toEqual({ from: before.description, to: 'Reviewed metadata update' })
    } else {
      expect(after).toEqual(before)
      expect(await KnowledgePackActivation.findById(activation._id).lean()).toEqual(activationBefore)
      expect(await KnowledgePackVersion.findOne({ versionId: 'fixture-grading-version' }).lean()).toEqual(versionBefore)
      expect(await AuditLog.find().lean()).toEqual(auditsBefore)
    }
  } finally {
    await session.endSession()
    for (const [key, value] of [['VE02_LOCAL_ASSESSMENT_ENABLED', previous[0]], ['VE02_CLASSIFICATION_MODEL', previous[1]]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})

test.each(['categories', 'minimumRuntime', 'sourceTypes'])('unsupported authored %s blocks installed lifecycle readiness and promotion', async kind => {
  const previous = [process.env.VE02_LOCAL_ASSESSMENT_ENABLED, process.env.VE02_CLASSIFICATION_MODEL]
  process.env.VE02_LOCAL_ASSESSMENT_ENABLED = 'true'; process.env.VE02_CLASSIFICATION_MODEL = 'gpt-4.1-mini'
  const session = await mongoose.startSession()
  try {
    const fixture = await prepareLocalLifecycle()
    const policy = fixture.pkg.discoveryPolicy
    const path = kind === 'categories' ? 'discoveryPolicy.evidencePolicy.categories'
      : kind === 'minimumRuntime' ? 'discoveryPolicy.compatibility.minimumRuntimeCompatibilityVersion' : 'discoveryPolicy.sourcePolicy'
    if (kind === 'categories') policy.evidencePolicy.categories = ['UNSUPPORTED']
    if (kind === 'minimumRuntime') policy.compatibility = { packageContractVersion: policy.contractVersion, minimumRuntimeCompatibilityVersion: '999.0.0' }
    if (kind === 'sourceTypes') policy.sourcePolicy = { allowedSourceTypes: ['UNSUPPORTED'] }
    fixture.pkg.discoveryPolicy = { ...policy }
    await fixture.pkg.save()
    const before = await FrameworkPackage.findById(fixture.pkg._id).lean()
    const activationBefore = await KnowledgePackActivation.findById(activation._id).lean()
    const report = await inspectInstalledDiscoveryPolicy(fixture.pkg)
    expect(report.status).toBe('UNRESOLVED')
    expect(report.resolvedReferences).toHaveLength(1)
    expect(report.unresolvedReferences).toContainEqual(expect.objectContaining({ path, reason: 'DISCOVERY_POLICY_FIELD_UNSUPPORTED' }))
    expect(installedDiscoveryPolicyDetails(fixture.pkg, report)).toHaveProperty([path])
    expect(() => captureInstalledDiscoveryPolicy(fixture.pkg, report)).toThrow()
    await expect(session.withTransaction(() => promoteLocalFixture({ ...fixture, session }))).rejects.toThrow()
    expect(await FrameworkPackage.findById(fixture.pkg._id).lean()).toEqual(before)
    expect(await KnowledgePackActivation.findById(activation._id).lean()).toEqual(activationBefore)
    expect(await AuditLog.countDocuments()).toBe(0)
  } finally {
    await session.endSession()
    for (const [key, value] of [['VE02_LOCAL_ASSESSMENT_ENABLED', previous[0]], ['VE02_CLASSIFICATION_MODEL', previous[1]]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})

test('isolated local lifecycle captures installed bindings, certifies and registers a verified activation', async () => {
  const previous = [process.env.VE02_LOCAL_ASSESSMENT_ENABLED, process.env.VE02_CLASSIFICATION_MODEL]
  process.env.VE02_LOCAL_ASSESSMENT_ENABLED = 'true'; process.env.VE02_CLASSIFICATION_MODEL = 'gpt-4.1-mini'
  const session = await mongoose.startSession()
  try {
    const fixture = await prepareLocalLifecycle()
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { req.context = { userId: String(id(101)) }; req.userId = String(id(101)); req.requestId = 'controlled-lifecycle'; next() })
    app.post('/packages/:packageId/validate', validateFrameworkPackage)
    app.post('/packages/:packageId/activate', activateFrameworkPackage)
    app.post('/packages/:packageId/checkpoint', runFrameworkPackageCheckpointEndpoint)
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, message: error.message, checkpoint: error.checkpoint, details: error.details }))
    const promoted = await request(app).post(`/packages/${fixture.pkg._id}/validate`).send({})
    expect(promoted.body).not.toHaveProperty('error')
    expect(promoted.status).toBe(200)
    expect((await FrameworkPackage.findById(fixture.pkg._id).lean()).status).toBe('VALIDATED')
    const result = await validateRuntimeOperation({ packageId: String(fixture.pkg._id), frameworkKey: 'QMF',
      operationType: 'OUTPUT_VALIDATION', outputContract: {}, payload: {}, mode: 'STRICT', isPackageLevelValidation: true,
      actorId: String(id(101)) })
    expect(result.result).toBe('ALLOW')
    const activated = await request(app).post(`/packages/${fixture.pkg._id}/activate`).send({})
    expect(activated.body).not.toHaveProperty('error')
    expect(activated.status).toBe(200)
    expect((await FrameworkPackage.findById(fixture.pkg._id).lean()).status).toBe('ACTIVE')
    expect(await RuntimeActivationSnapshot.countDocuments({})).toBe(1)
    expect(await RuntimeDeployment.countDocuments({})).toBe(1)
    const checkpoint = await request(app).post(`/packages/${fixture.pkg._id}/checkpoint`).send({ persist: true })
    expect(checkpoint.status).toBe(200)
    expect(checkpoint.body.data.status).toBe('PASS')
    expect((await request(app).post(`/packages/${fixture.pkg._id}/validate`).send({})).status).toBe(200)
    const beforeAuditFailure = await FrameworkPackage.findById(fixture.pkg._id).lean()
    jest.spyOn(AuditLog, 'createLog').mockImplementationOnce(async () => { throw new Error('Required checkpoint audit failed') })
    const failedAudit = await request(app).post(`/packages/${fixture.pkg._id}/checkpoint`).send({ persist: true })
    expect(failedAudit.status).toBe(500)
    expect(await FrameworkPackage.findById(fixture.pkg._id).lean()).toEqual(beforeAuditFailure)
    jest.restoreAllMocks()
    process.env.VE02_LOCAL_ASSESSMENT_ENABLED = 'false'
    const beforeFailureAudits = await AuditLog.countDocuments({})
    const failedValidation = await request(app).post(`/packages/${fixture.pkg._id}/validate`).send({})
    expect(failedValidation.status).toBe(422)
    const disabledPackage = await FrameworkPackage.findById(fixture.pkg._id).lean()
    expect(disabledPackage.lastCheckpointStatus).toBe('FAIL')
    expect(disabledPackage.status).toBe('ACTIVE')
    expect(await AuditLog.countDocuments({})).toBeGreaterThan(beforeFailureAudits)
    await expect(assertInstalledDiscoveryPolicySnapshot(disabledPackage)).rejects.toMatchObject({ code: 'DISCOVERY_POLICY_MAPPING_UNVERIFIED' })
    const mixedTelemetry = await FrameworkPackage.findById(fixture.pkg._id)
    mixedTelemetry.lastCheckpointStatus = 'PASS'
    mixedTelemetry.discoveryPolicy = { ...mixedTelemetry.discoveryPolicy, label: 'Must remain blocked' }
    await expect(mixedTelemetry.save({ session })).rejects.toThrow()
    expect(await FrameworkPackage.findById(fixture.pkg._id).lean()).toEqual(disabledPackage)
  } finally {
    await session.endSession()
    for (const [key, value] of [['VE02_LOCAL_ASSESSMENT_ENABLED', previous[0]], ['VE02_CLASSIFICATION_MODEL', previous[1]]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})

test.each(['flag', 'model', 'snapshot', 'content', 'inactive', 'concurrent-disable', 'concurrent-content', 'rollback'])(
  'isolated local lifecycle rejects %s without retaining partial promotion or fences', async kind => {
    const previous = [process.env.VE02_LOCAL_ASSESSMENT_ENABLED, process.env.VE02_CLASSIFICATION_MODEL]
    process.env.VE02_LOCAL_ASSESSMENT_ENABLED = 'true'; process.env.VE02_CLASSIFICATION_MODEL = 'gpt-4.1-mini'
    const session = await mongoose.startSession()
    try {
      const fixture = await prepareLocalLifecycle()
      await session.withTransaction(() => promoteLocalFixture({ ...fixture, session }))
      const before = await FrameworkPackage.findById(fixture.pkg._id).lean()
      const persistedBefore = await FrameworkPackage.findById(fixture.pkg._id).lean()
      const activationBefore = await KnowledgePackActivation.findOne({ activationId: activation.activationId }).lean()
      const versionBefore = await KnowledgePackVersion.findOne({ versionId: 'fixture-grading-version' }).lean()
      const runtimeBinding = { ...runtime, packageId: before._id, dependencyLockId: before.dependencyLock.snapshotId,
        evidence: { dependencySnapshotHash: before.dependencyLock.snapshotHash } }
      expect((await resolveInstalledPackageDiscoveryPolicy({ frameworkPackage: before, runtimeInstance: runtimeBinding })).status).toBe('CONFIGURED_LOCAL')
      expect((await resolveInstalledPackageDiscoveryPolicy({ frameworkPackage: before,
        runtimeInstance: { ...runtimeBinding, dependencyLockId: 'stale' } })).reason).toBe('DISCOVERY_POLICY_CAPTURED_BINDING_MISMATCH')
      expect((await resolveInstalledPackageDiscoveryPolicy({ frameworkPackage: before,
        runtimeInstance: { ...runtimeBinding, packageKey: 'other' } })).reason).toBe('DISCOVERY_POLICY_PACKAGE_IDENTITY_MISMATCH')
      if (kind === 'flag') process.env.VE02_LOCAL_ASSESSMENT_ENABLED = 'false'
      if (kind === 'model') process.env.VE02_CLASSIFICATION_MODEL = 'other'
      if (kind === 'snapshot') before.dependencyLock.discoveryPolicyBindings.references[0].binding.decisionRef = 'invented'
      if (kind === 'content') await KnowledgePackVersion.collection.updateOne({ versionId: 'fixture-grading-version' }, { $set: { content: 'tampered' } })
      if (kind === 'inactive') await KnowledgePackActivation.collection.updateOne({ activationId: activation.activationId }, { $set: { status: 'SUPERSEDED' } })
      if (['flag', 'model', 'snapshot', 'content', 'inactive'].includes(kind)) {
        expect((await resolveInstalledPackageDiscoveryPolicy({ frameworkPackage: before, runtimeInstance: runtimeBinding })).status).toBe('BLOCKED')
      }
      if (kind.startsWith('concurrent')) {
        const write = KnowledgePackActivation.updateOne.bind(KnowledgePackActivation)
        jest.spyOn(KnowledgePackActivation, 'updateOne').mockImplementationOnce(async (...args) => {
          if (kind === 'concurrent-disable') await KnowledgePackActivation.collection.updateOne({ activationId: activation.activationId }, { $set: { status: 'SUPERSEDED' } })
          else await KnowledgePackVersion.collection.updateOne({ versionId: 'fixture-grading-version' }, { $set: { content: 'concurrent tampering' } })
          return write(...args)
        })
      }
      await expect(session.withTransaction(async () => {
        await fenceInstalledDiscoveryPolicy(before, { session })
        await FrameworkPackage.collection.updateOne({ _id: fixture.pkg._id }, { $set: { description: 'must roll back' } }, { session })
        if (kind === 'rollback') throw new Error('Required audit write failed')
      })).rejects.toThrow()
      const after = await FrameworkPackage.findById(fixture.pkg._id).lean()
      expect(after).toEqual(persistedBefore)
      expect(after.description).not.toBe('must roll back')
      expect(after.status).toBe('VALIDATED')
      expect((await KnowledgePackActivation.findOne({ activationId: activation.activationId }).lean()).__v).toBe(activationBefore.__v)
      expect((await KnowledgePackVersion.findOne({ versionId: 'fixture-grading-version' }).lean()).__v).toBe(versionBefore.__v)
      expect(await RuntimeActivationSnapshot.countDocuments({})).toBe(0)
    } finally {
      await session.endSession()
      for (const [key, value] of [['VE02_LOCAL_ASSESSMENT_ENABLED', previous[0]], ['VE02_CLASSIFICATION_MODEL', previous[1]]]) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value
      }
    }
  })

test.each(['active', 'mixed', 'misplaced', 'disabled', 'missing-model', 'wrong-model', 'wrong-version', 'wrong-scope', 'contract-only', 'tampered'])(
  'installed reference reporting %s separates local activation from VMF certification', async kind => {
    await installSyntheticGradingFixture()
    const previous = { flag: process.env.VE02_LOCAL_ASSESSMENT_ENABLED, model: process.env.VE02_CLASSIFICATION_MODEL }
    process.env.VE02_LOCAL_ASSESSMENT_ENABLED = kind === 'disabled' ? 'false' : 'true'
    process.env.VE02_CLASSIFICATION_MODEL = kind === 'wrong-model' ? 'other' : 'gpt-4.1-mini'
    if (kind === 'missing-model') delete process.env.VE02_CLASSIFICATION_MODEL
    if (kind === 'contract-only') await KnowledgePackActivation.collection.updateOne({ _id: activation._id }, { $set: {
      versionId: activation.versionId, contentHash: activation.contentHash } })
    if (kind === 'tampered') await KnowledgePackVersion.collection.updateOne({ versionId: 'fixture-grading-version' }, { $set: { content: 'changed' } })
    try {
      const packageRecord = { frameworkKey: 'QMF', packageKey: kind === 'wrong-scope' ? 'other' : runtime.packageKey,
        version: runtime.packageVersion, discoveryPolicy: { contractVersion: 'framework-package-discovery-policy-v1', policyKey: 'local-fixture', policyVersion: '1',
          evidencePolicy: { ownerMappings: [{ mappingKey: 'quality', vmfCapabilityRef: 'VE02', ownerRuntime: 'VE02 / Bundle 02',
            resultType: 'VMF.VE02.EvidenceAssessmentResult', resultContractVersion: '1.0',
            sourceRef: 'https://drive.google.com/file/d/17rkALp4x5q5VByzIn9adocJM3YtqdMgN/view',
            sourceVersion: 'Bundle 02 v1.4 / STATE v1.6 / DDS v1.8 — VE02RC001', implementationRef: 'validation-evidence-quality-check',
            implementationVersion: kind === 'wrong-version' ? 'other' : 'storylineos-ve02-local-assessor-v1' }] } } }
      if (kind === 'mixed') packageRecord.discoveryPolicy.evidencePolicy.ownerMappings.push({ mappingKey: 'unknown', vmfCapabilityRef: 'unknown' })
      if (kind === 'misplaced') {
        packageRecord.discoveryPolicy.readinessPolicy = { readinessEvaluations: packageRecord.discoveryPolicy.evidencePolicy.ownerMappings }
        delete packageRecord.discoveryPolicy.evidencePolicy
      }
      const report = await inspectInstalledDiscoveryPolicy(packageRecord)
      const locallyBound = ['active', 'mixed'].includes(kind)
      expect(report.status).toBe(kind === 'active' ? 'CONFIGURED_LOCAL' : 'UNRESOLVED')
      const reference = locallyBound ? report.resolvedReferences[0] : report.unresolvedReferences[0]
      expect(reference.semanticTarget).toMatchObject({ vmfProducerCertificationStatus: 'UNVERIFIED',
        localImplementationStatus: locallyBound ? 'STORYLINEOS_PROVISIONAL_ACTIVE' : 'UNAVAILABLE' })
      expect(report.resolvedReferences).toHaveLength(locallyBound ? 1 : 0)
      expect(report.unresolvedReferences).toHaveLength(kind === 'active' ? 0 : kind === 'misplaced' ? 2 : 1)
      if (locallyBound) {
        expect(reference.status).toBe('RESOLVED_LOCAL')
        expect(reference.semanticTarget.localProducerBinding.decisionRef).toBe('gary-storylineos-ve02-provisional-2026-10-09')
        expect(report.packageIdentity).toMatchObject({ frameworkKey: 'QMF', packageKey: runtime.packageKey, packageVersion: runtime.packageVersion })
        expect(report.policyHash).toBe(inspectDiscoveryPolicy(packageRecord.discoveryPolicy).policyHash)
      }
      if (kind === 'mixed') expect(report.unresolvedReferences[0].mappingKey).toBe('unknown')
    } finally {
      for (const [key, value] of [['VE02_LOCAL_ASSESSMENT_ENABLED', previous.flag], ['VE02_CLASSIFICATION_MODEL', previous.model]]) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value
      }
    }
  })

test('enabled mounted local producer binds real saved plan integrity, native revisions and persisted receipt', async () => {
  await installSyntheticGradingFixture()
  const input = await makeSs041Fixture()
  const { _id: ignoredEvidenceId, ...fixtureEvidence } = input.sourceSnapshot.evidenceObjects[0]
  const { _id: ignoredSourceId, ...fixtureSource } = input.sourceSnapshot.sourceRegistry[0]
  const scope = { customerId: runtime.customerId, tenantId: runtime.tenantId, runtimeInstanceId: runtime._id,
    stateVersion: runtime.stateVersion, current: true }
  await RuntimeEvidenceObject.collection.updateOne({ _id: evidence._id }, { $set: { ...fixtureEvidence, ...scope } })
  const currentSource = { ...source, ...fixtureSource, ...scope }
  const verificationContext = recordSourceReview({ source: currentSource, actorUserId: 'fixture-reviewer', facts: {
    authenticity: 'AUTHENTIC', sourceOrigin: 'Independent controlled fixture', organizationRelationship: 'Independent fixture',
    independenceGroup: 'fixture-one', supportingReference: 'fixture:review', rationale: 'Synthetic acceptance facts' } })
  await RuntimeEvidenceSource.collection.updateOne({ _id: source._id }, { $set: { ...fixtureSource, ...scope, verificationContext } })
  const frozenEvidence = await RuntimeEvidenceObject.findById(evidence._id).lean(), frozenSource = await RuntimeEvidenceSource.findById(source._id).lean()
  const inventoryScope = { ...scope, customerId: String(runtime.customerId), tenantId: String(runtime.tenantId), runtimeInstanceId: String(runtime._id) }
  const inventory = await assembleOutcomeEvidenceInventory({ scope: inventoryScope,
    sections: [{ sectionKey: 'executive-summary', references: [frozenEvidence.evidenceObjectId] }],
    count: async () => 1, readPage: async kind => kind === 'evidence' ? [frozenEvidence] : [frozenSource], validateRows: () => {} })
  input.sourceSnapshot = { ...input.sourceSnapshot, evidenceObjects: inventory.evidenceObjects,
    sourceRegistry: inventory.sourceRegistry, inventoryReceipt: inventory.receipt }
  const runtimeBinding = { ...input.composition.runtimeBinding, runtimeInstanceId: String(runtime._id),
    customerId: String(runtime.customerId), tenantId: String(runtime.tenantId), frameworkKey: 'QMF',
    packageKey: runtime.packageKey, packageVersion: runtime.packageVersion }
  const lockedTruth = { ...input.composition.truthBinding, publishSnapshotId: 'publish-fixture', lockSnapshotId: 'lock-fixture',
    replayAnchorId: 'replay-fixture', dependencySnapshotId: 'dependency-fixture', acceptedSections: [{ sectionKey: 'executive-summary',
      runtimePath: 'framework_state.sections.executive-summary', truthHash: `sha256:${'a'.repeat(64)}` }] }
  const requestId = '123e4567-e89b-42d3-a456-426614174000'
  const selectedPacks = Object.values(input.selectedTarget.receipt.contractIdentity).map(item => item.selection)
  const governedContext = { outputType: { key: input.composition.outputBinding.outputTypeKey, version: '1.0.0' },
    outputSchema: { key: input.composition.outputBinding.outputSchemaKey, version: '1.0.0' } }
  const savedPayload = { contractVersion: OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION, status: 'READY', runtime: runtimeBinding,
    lockedTruth, requestId, consumerIntent: input.composition.requestBinding, resolution: { selectedPacks, consideredPacks: selectedPacks },
    governedContext, optionalGapCount: 0, stagePlan: OUTCOME_QUALITY_STAGE_SEQUENCE.map((stageKey, index) => ({ stageKey, order: index + 1, assignedActivationIds: [] })) }
  const hash = hashOutcomeKnowledgeCompositionSemanticValue
  const resolutionFingerprint = hash({ resolution: {}, selectedPacks, consideredPacks: selectedPacks }), contextFingerprint = hash(governedContext)
  savedPayload.resolution.resolutionFingerprint = resolutionFingerprint
  savedPayload.governedContext.contextFingerprint = contextFingerprint
  input.composition.runtimeBinding = runtimeBinding
  input.composition.truthBinding = { lockedTruth, frameworkHandoff: null }
  input.composition.requestBinding = { ...savedPayload.consumerIntent, requestId }
  input.composition.outputPlanBinding = projectRuntimeEvidenceOutputPlanBinding(savedPayload)
  const compiled = compileEvidenceToMeaningContract(input)
  expect(compiled.customerClaims).toHaveLength(1)
  savedPayload.evidenceToMeaning = { contractVersion: compiled.contractVersion, contractId: compiled.contractId,
    contractHash: compiled.contractHash, contractJson: JSON.stringify(compiled) }
  const saved = { _id: id(120), planId: `outcome_kcp_${requestId}`, planVersion: 1, contractVersion: savedPayload.contractVersion,
    status: savedPayload.status, ...runtimeBinding, requestId, requestedOutputTypeKey: savedPayload.consumerIntent.requestedOutputTypeKey,
    ...Object.fromEntries(['publishSnapshotId', 'lockSnapshotId', 'replayAnchorId', 'dependencySnapshotId'].map(key => [key, lockedTruth[key]])),
    planFingerprint: hash(savedPayload), resolutionFingerprint, contextFingerprint, selectedPackCount: selectedPacks.length,
    consideredPackCount: selectedPacks.length, gapCount: 0, payload: savedPayload }
  expect(() => assertOutcomeKnowledgeCompositionPlanIntegrity(saved)).not.toThrow()
  await OutcomeKnowledgeCompositionPlan.collection.insertOne({ ...saved, runtimeInstanceId: runtime._id,
    customerId: runtime.customerId, tenantId: runtime.tenantId })
  const body = { ...nativeInput(), evidenceId: frozenEvidence.evidenceObjectId,
    expectedEvidenceRevisionRef: ve02MaterialRevision(frozenEvidence, frozenSource), proposedHypothesis: { statement: frozenEvidence.extractedFact },
    claimBinding: { planId: saved.planId, requestId, claimKey: compiled.customerClaims[0].claimKey } }
  const previous = Object.fromEntries(['VE02_LOCAL_ASSESSMENT_ENABLED', 'VE02_CLASSIFICATION_MODEL', 'VE02_CLASSIFICATION_API_KEY'].map(key => [key, process.env[key]]))
  process.env.VE02_LOCAL_ASSESSMENT_ENABLED = 'true'
  process.env.VE02_CLASSIFICATION_MODEL = 'gpt-4.1-mini'
  process.env.VE02_CLASSIFICATION_API_KEY = 'fixture-only'
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    const providerInput = JSON.parse(JSON.parse(options.body).input)
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text',
      text: JSON.stringify(await nativeProposal(providerInput)) }] }] }))
  })
  try {
    const response = await request(draftApp).post('/ve02/local-assessment').set('x-fixture-role', 'SUPER_ADMIN').send(body)
    expect({ status: response.status, error: response.body.error }).toEqual({ status: 200, error: undefined })
    expect(response.body.data).toMatchObject({ executionEligible: true, producerBinding: {
      claimPlanId: saved.planId, claimContractHash: compiled.contractHash, evidenceRevisionRef: body.expectedEvidenceRevisionRef } })
    const repeat = await request(draftApp).post('/ve02/local-assessment').set('x-fixture-role', 'SUPER_ADMIN').send(body)
    expect(repeat.status).toBe(200)
    expect(repeat.body.data.executionEligible).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(await RuntimeValidationAudit.countDocuments({ ve02Receipt: { $exists: true } })).toBe(2)
    expect((await OutcomeKnowledgeCompositionPlan.findOne({ planId: saved.planId }).lean()).planFingerprint).toBe(saved.planFingerprint)
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})

test('local producer consumes fresh native assessment, records provisional binding and repeats after metadata fences', async () => {
  const fixture = await localFixture()
  const first = await localRun(fixture)
  expect(first).toMatchObject({ status: 'COMPLETE', executionEligible: true,
    result: { result_status: 'COMPLETE', assessment_result: 'MODERATE' }, producerBinding: {
      authorityClass: 'STORYLINEOS_PROVISIONAL', implementationRef: 'validation-evidence-quality-check' } })
  const audit = await RuntimeValidationAudit.findById(first.validation.ve02ResultEligibility.receiptAuditId).lean()
  expect(audit.ve02Receipt.producerBinding).toEqual(first.producerBinding)
  expect(audit.ve02Receipt.payload).toEqual(first.result)
  expect(first.result.restrictions).not.toContain('SYNTHETIC_QMF_ONLY')
  expect(first.result.restrictions).toContain('STORYLINEOS_PROVISIONAL_ASSESSMENT')
  const second = await localRun(fixture)
  expect(second.executionEligible).toBe(true)
  expect(fixture.dependencies.classify).toHaveBeenCalledTimes(2)
  expect(await RuntimeValidationAudit.countDocuments({ ve02Receipt: { $exists: true } })).toBe(2)
  expect(fixture.contract.customerClaims[0].evidenceHash).toBe(hashEvidenceToMeaningValue(fixture.contract.inputs.sourceSnapshot.evidenceObjects[0]))
  const copied = await consume({ payload: first.result })
  expect(copied.ve02ResultEligibility.eligible).toBe(false)
  const before = await draftRecords()
  const forged = await request(httpApp).post('/validate').send(httpInput({
    runtimeInstanceId: String(runtime._id), customerId: String(runtime.customerId), tenantId: String(runtime.tenantId),
    payload: { ...first.result, result_id: 'renamed-copy', restrictions: [] } }))
  expect(forged.status).toBe(422)
  expect(forged.body.error.validation.ve02ResultEligibility.eligible).toBe(false)
  const after = await draftRecords()
  expect(after.filter(([name]) => name !== 'RuntimeValidationAudit')).toEqual(before.filter(([name]) => name !== 'RuntimeValidationAudit'))
  expect(await RuntimeValidationAudit.countDocuments({ ve02Receipt: { $exists: true } })).toBe(2)
})

test.each(['flag', 'activation', 'claim', 'source', 'provider'])('local assessment %s failure never writes a consumption receipt', async kind => {
  const fixture = await localFixture()
  let enabled = true
  fixture.dependencies = { ...fixture.dependencies, get enabled() { return enabled }, classify: async args => {
    if (kind === 'flag') enabled = false
    if (kind === 'activation') await KnowledgePackActivation.collection.updateOne({ _id: activation._id }, { $set: { status: 'DISABLED' } })
    if (kind === 'claim') fixture.contract.customerClaims[0].statement = 'Changed'
    if (kind === 'source') await RuntimeEvidenceSource.collection.updateOne({ _id: source._id }, { $set: { sourceRef: 'Changed' } })
    if (kind === 'provider') throw Object.assign(new Error('Fixture refusal'), { code: 'VE02_CLASSIFICATION_FAILED', status: 422 })
    return nativeProposal(args)
  } }
  await expect(localRun(fixture)).rejects.toThrow()
  expect(await RuntimeValidationAudit.countDocuments()).toBe(0)
  expect((await RuntimeEvidenceObject.findById(evidence._id).lean()).__v).toBe(0)
})

test('local producer receipt failure rolls back all fences', async () => {
  const fixture = await localFixture()
  jest.spyOn(RuntimeValidationAudit, 'create').mockRejectedValue(new Error('Local receipt failure'))
  await expect(localRun(fixture)).rejects.toThrow('Local receipt failure')
  expect(await RuntimeValidationAudit.countDocuments()).toBe(0)
  for (const model of [RuntimeInstance, RuntimeEvidenceObject, RuntimeEvidenceSource, KnowledgePackActivation]) {
    expect((await model.findOne({}).lean()).__v).toBe(0)
  }
  expect(fixture.dependencies.classify).toHaveBeenCalledTimes(1)
})

test.each([['', 401], ['CUSTOMER_ADMIN', 403], ['SUPER_ADMIN', 403]])('mounted local route %s preserves default-off/auth gates', async (role, status) => {
  await installSyntheticGradingFixture()
  const before = await draftRecords()
  const operation = request(draftApp).post('/ve02/local-assessment')
  if (role) operation.set('x-fixture-role', role)
  expect((await operation.send(nativeInput())).status).toBe(status)
  expect(await draftRecords()).toEqual(before)
})

test.each(['producerBinding', 'localActivation', 'result', 'judgments'])('mounted local route rejects caller %s attestation', async key => {
  await installSyntheticGradingFixture()
  expect((await request(draftApp).post('/ve02/local-assessment').set('x-fixture-role', 'SUPER_ADMIN')
    .send({ ...nativeInput(), [key]: {} })).status).toBe(422)
  expect(await RuntimeValidationAudit.countDocuments()).toBe(0)
})

// Explicit opt-in only: default suites never transmit data or use paid transport.
const liveProofTest = process.env.VE02_LIVE_CLASSIFICATION_PROOF === 'true' ? test : test.skip
liveProofTest(
  'live synthetic classifier traverses actual scoped native records and leaves them unchanged', async () => {
    await installSyntheticGradingFixture()
    const before = await draftRecords()
    const result = await prepareVE02NativeAssessment({ input: nativeInput(), scopes: {
      platformRoles: ['SUPER_ADMIN'], resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'], permissions: [] } },
      customer: { _id: runtime.customerId }, tenant: { _id: runtime.tenantId, customerId: runtime.customerId },
    }, dependencies: { enabled: true, classify: args => classifyVE02NativeText(args) } })
    expect(result).toMatchObject({ executionEligible: false, assessmentProcedureVerified: false,
      classificationStatus: 'PROPOSED_NATIVE_CLASSIFICATION', contractCandidate: { result_status: 'UNRESOLVED' } })
    expect(result.proposedGradingResult.status).toBe('PROPOSED_NON_CONSUMABLE')
    expect(await draftRecords()).toEqual(before)
  }, 60000)

test('native classifier reads actual scoped evidence, rechecks identity and leaves every stored record unchanged', async () => {
  await installSyntheticGradingFixture()
  const before = await draftRecords()
  const classify = jest.fn(nativeProposal)
  const result = await prepareVE02NativeAssessment({ input: nativeInput(), scopes: {
    platformRoles: ['SUPER_ADMIN'], resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'], permissions: [] } },
    customer: { _id: runtime.customerId }, tenant: { _id: runtime.tenantId, customerId: runtime.customerId },
  }, dependencies: { enabled: true, classify } })
  expect(classify.mock.calls[0][0].passage).toBe(evidence.extractedFact)
  expect(result.contractCandidate.result_status).toBe('UNRESOLVED')
  expect(result.executionEligible).toBe(false)
  expect(result.contractCandidate.provenance_refs).toEqual([source.sourceRef, evidence.lineageRef])
  expect(await draftRecords()).toEqual(before)
})

test('native classifier rejects actual evidence mutation during provider execution', async () => {
  await installSyntheticGradingFixture()
  await expect(prepareVE02NativeAssessment({ input: nativeInput(), scopes: {
    platformRoles: ['SUPER_ADMIN'], resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'], permissions: [] } },
    customer: { _id: runtime.customerId }, tenant: { _id: runtime.tenantId, customerId: runtime.customerId },
  }, dependencies: { enabled: true, classify: async (args) => {
    await RuntimeEvidenceObject.collection.updateOne({ _id: evidence._id }, { $set: { extractedFact: 'Changed actual evidence.' } })
    return nativeProposal(args)
  } } })).rejects.toMatchObject({ status: 409 })
  expect(await RuntimeValidationAudit.countDocuments()).toBe(0)
})

test.each([['', 401], ['CUSTOMER_ADMIN', 403], ['SUPER_ADMIN', 403]])('mounted native route %s rejects auth/default-off before provider or writes', async (role, status) => {
  await installSyntheticGradingFixture()
  const before = await draftRecords()
  const operation = request(draftApp).post('/ve02/synthetic-classification')
  if (role) operation.set('x-fixture-role', role)
  const response = await operation.send(nativeInput())
  expect(response.status).toBe(status)
  if (role === 'SUPER_ADMIN') expect(response.body.error).toMatchObject({ code: 'FORBIDDEN',
    details: { reason: 'VE02_NATIVE_SYNTHETIC_DISABLED' } })
  expect(await draftRecords()).toEqual(before)
})

test('synthetic mounted assessment grades scoped preclassified evidence without any receipt or data writes', async () => {
  await installSyntheticGradingFixture()
  const before = await draftRecords()
  process.env.VE02_SYNTHETIC_ASSESSMENT_ENABLED = 'true'
  try {
    const response = await request(draftApp).post('/ve02/synthetic-assessment').set('x-fixture-role', 'SUPER_ADMIN')
      .send({ draft: draftInput() })
    expect({ status: response.status, error: response.body.error }).toEqual({ status: 200, error: undefined })
    expect(response.body.data).toMatchObject({ executionEligible: false, hypothesisVerified: false,
      classificationStatus: 'PROPOSED_PRECLASSIFIED', contractCandidate: { result_status: 'COMPLETE', assessment_result: 'MODERATE' } })
    expect(await draftRecords()).toEqual(before)
    const conflicted = await request(draftApp).post('/ve02/synthetic-assessment').set('x-fixture-role', 'SUPER_ADMIN')
      .send({ draft: draftInput(), proposedConflict: { condition: 'same condition', scope: 'same scope', time: 'same time',
        lineageRefs: ['proposed:first', 'proposed:second'] } })
    expect(conflicted.status).toBe(200)
    expect(conflicted.body.data.contractCandidate.assessment_result).toBe('CONTRADICTORY')
    expect(conflicted.body.data.contractCandidate.result_id).not.toBe(response.body.data.contractCandidate.result_id)
    expect(await draftRecords()).toEqual(before)
    await KnowledgePackVersion.collection.updateOne({ versionId: 'fixture-grading-version' }, { $set: { content: 'tampered' } })
    const altered = await draftRecords()
    const rejected = await request(draftApp).post('/ve02/synthetic-assessment').set('x-fixture-role', 'SUPER_ADMIN').send({ draft: draftInput() })
    expect(rejected.status).toBe(422)
    expect(await draftRecords()).toEqual(altered)
  } finally { delete process.env.VE02_SYNTHETIC_ASSESSMENT_ENABLED }
})

test('synthetic default-off flag and native package boundary reject before writes', async () => {
  await draftCustomer()
  const before = await draftRecords()
  const operation = () => request(draftApp).post('/ve02/synthetic-assessment').set('x-fixture-role', 'SUPER_ADMIN').send({ draft: draftInput() })
  expect((await operation()).body.error.code).toBe('VE02_SYNTHETIC_DISABLED')
  process.env.VE02_SYNTHETIC_ASSESSMENT_ENABLED = 'true'
  try {
    expect((await operation()).body.error.code).toBe('VE02_SYNTHETIC_SCOPE_REQUIRED')
    expect(await draftRecords()).toEqual(before)
  } finally { delete process.env.VE02_SYNTHETIC_ASSESSMENT_ENABLED }
})

test('production cannot enable synthetic assessment even with an explicit internal flag', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    await expect(prepareVE02SyntheticAssessment({ input: {}, dependencies: { enabled: true } }))
      .rejects.toMatchObject({ code: 'VE02_SYNTHETIC_DISABLED' })
  } finally { process.env.NODE_ENV = previous }
})

test('persists an exact typed receipt, replays its original identity and preserves material/timestamps', async () => {
  const first = await consume()
  expect(first.ve02ResultEligibility.eligible).toBe(true)
  const replay = await consume()
  expect(replay.ve02ResultEligibility).toEqual(first.ve02ResultEligibility)
  expect(await receiptCount()).toBe(1)
  const currentEvidence = await RuntimeEvidenceObject.findById(evidence._id).lean()
  const currentSource = await RuntimeEvidenceSource.findById(source._id).lean()
  expect(ve02MaterialRevision(currentEvidence, currentSource)).toBe(payload.evidence_revision_ref)
  expect(currentEvidence.updatedAt).toEqual(evidence.updatedAt)
  expect(currentEvidence.extractedFact).toBe(evidence.extractedFact)
  expect(currentEvidence.__v).toBe(2)
  const audit = await RuntimeValidationAudit.findOne({ 've02Receipt.resultId': payload.result_id }).lean()
  expect(audit.ve02Receipt.payload).toEqual(payload)
})
test('concurrent exact replays produce one original receipt', async () => {
  const results = await Promise.all([consume(), consume()])
  expect(results.every((result) => result.ve02ResultEligibility.eligible)).toBe(true)
  expect(new Set(results.map((result) => result.ve02ResultEligibility.receiptAuditId)).size).toBe(1)
  expect(await receiptCount()).toBe(1)
})
test('concurrent conflicting result IDs cannot both be accepted', async () => {
  const results = await Promise.all([consume(), consume({ payload: { ...payload, relevance: 'WEAK' } })])
  expect(results.filter((result) => result.ve02ResultEligibility.eligible)).toHaveLength(1)
  expect(results.some((result) => result.result === 'BLOCK')).toBe(true)
  expect(await receiptCount()).toBe(1)
})
test('persistence failure aborts metadata fences and creates no receipt', async () => {
  jest.spyOn(RuntimeValidationAudit, 'create').mockRejectedValue(new Error('Fixture audit write failure'))
  await expect(consume()).rejects.toThrow('Fixture audit write failure')
  expect(await receiptCount()).toBe(0)
  for (const [model, key] of [[RuntimeInstance, runtime._id], [RuntimeEvidenceObject, evidence._id],
    [RuntimeEvidenceSource, source._id], [KnowledgePackActivation, activation._id]]) {
    expect((await model.findById(key).lean()).__v).toBe(0)
  }
})
test.each(['DISABLED', 'AUDIT_ONLY', 'WARN_ONLY'])('%s cannot create consumption eligibility', async (mode) => {
  expect((await consume({ mode })).ve02ResultEligibility.eligible).toBe(false)
  expect(await receiptCount()).toBe(0)
})
test('skipping persistence cannot create consumption eligibility', async () => {
  expect((await consume({ persistAudit: false })).ve02ResultEligibility.eligible).toBe(false)
  expect(await RuntimeValidationAudit.countDocuments()).toBe(0)
})
test('replay revalidates currentness after a child rollover', async () => {
  await consume()
  await RuntimeEvidenceObject.collection.updateOne({ _id: evidence._id }, { $set: { current: false } })
  const next = await consume()
  expect(next.ve02ResultEligibility.eligible).toBe(false)
  expect(next.result).toBe('BLOCK')
  expect(await receiptCount()).toBe(1)
})
test.each(['root', 'activation', 'child'])('a concurrent %s change cannot race a successful receipt', async (kind) => {
  let changed = false
  const resolver = async (input, options) => {
    const context = await resolveContext(input, options)
    if (!changed && context) {
      changed = true
      if (kind === 'root') await RuntimeInstance.collection.updateOne({ _id: runtime._id }, { $set: { stateVersion: 'runtime-state-v2-next' } })
      if (kind === 'activation') await KnowledgePackActivation.collection.updateOne({ _id: activation._id }, { $set: { status: 'DISABLED' } })
      if (kind === 'child') await RuntimeEvidenceObject.collection.updateOne({ _id: evidence._id }, { $set: { current: false } })
    }
    return context
  }
  if (kind === 'activation') await expect(consume({}, resolver)).rejects.toThrow(/active/i)
  else if (kind === 'root') await expect(consume({}, resolver)).rejects.toThrow(/inventory is incomplete/i)
  else expect((await consume({}, resolver)).ve02ResultEligibility.eligible).toBe(false)
  expect(await receiptCount()).toBe(0)
})
test('historical untyped audits remain intact and do not acquire receipt authority', async () => {
  const old = await RuntimeValidationAudit.create({ validationCode: 'fixture', severity: 'INFO',
    operationType: 'OUTPUT_VALIDATION', status: 'PASS', result: 'ALLOW', mode: 'STRICT', message: 'Historical fixture.' })
  await consume()
  expect((await RuntimeValidationAudit.findById(old._id).lean()).ve02Receipt).toBeUndefined()
})
test('VE02 cannot certify a package or mint a readiness verdict', async () => {
  await expect(consume({ isPackageLevelValidation: true })).rejects.toThrow('cannot certify package readiness')
  expect(await RuntimeValidationAudit.countDocuments()).toBe(0)
})
test('missing uniqueness index blocks consumption before any receipt or fence write', async () => {
  await RuntimeValidationAudit.collection.dropIndex('unique_ve02_consumption_result')
  try {
    await expect(consume()).rejects.toThrow('uniqueness index is unavailable')
    expect(await RuntimeValidationAudit.countDocuments()).toBe(0)
    expect((await RuntimeInstance.findById(runtime._id).lean()).__v).toBe(0)
  } finally {
    const [keys, options] = RuntimeValidationAudit.schema.indexes().find(([, opts]) => opts.name === 'unique_ve02_consumption_result')
    await RuntimeValidationAudit.collection.createIndex(keys, options)
  }
})

test('a narrower same-named uniqueness index cannot leave other receipts unprotected', async () => {
  const [keys, options] = RuntimeValidationAudit.schema.indexes().find(([, opts]) => opts.name === 'unique_ve02_consumption_result')
  await RuntimeValidationAudit.collection.dropIndex(options.name)
  try {
    await RuntimeValidationAudit.collection.createIndex(keys, { ...options,
      partialFilterExpression: { ...options.partialFilterExpression, 've02Receipt.consumerVersion': 'unrelated-version' } })
    await expect(consume()).rejects.toThrow('uniqueness index is unavailable')
    expect(await RuntimeValidationAudit.countDocuments()).toBe(0)
    expect((await RuntimeInstance.findById(runtime._id).lean()).__v).toBe(0)
  } finally {
    await RuntimeValidationAudit.collection.dropIndex(options.name)
    await RuntimeValidationAudit.collection.createIndex(keys, options)
  }
})
