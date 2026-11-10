import { beforeAll, afterAll, beforeEach, describe, test, expect, jest } from '@jest/globals'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { Customer, Tenant, LicenseLevel, FrameworkPackage, RuntimeInstance, AuditLog } from '../models/index.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceSnapshot from '../models/RuntimeEvidenceSnapshot.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import RuntimeStateMigrationReceipt from '../models/RuntimeStateMigrationReceipt.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import auditService from '../services/auditService.js'
import { discoveryPolicySnapshot } from '../services/discoveryPolicyContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { prepareRuntimeEvidenceSnapshot, persistRuntimeEvidenceSnapshot, readVerifiedRuntimeEvidenceSnapshot } from '../services/runtimeEvidenceSnapshotService.js'
import { POST_LOCK_RECORDING_REFERENCE, POST_LOCK_HUMAN_IMPACT_REFERENCE, POST_LOCK_ADMISSION_REFERENCE, postLockSubmissionId } from '../services/postLockEvidenceIntakeContract.js'
import { submitPostLockEvidence, readPostLockEvidence } from '../services/postLockEvidenceIntakeService.js'
import { recordPostLockImpactDecision, readPostLockImpactHistory } from '../services/postLockImpactDecisionService.js'
import { POST_LOCK_DISCOVERY_DISPOSITIONS } from '../services/discoveryContractReadinessService.js'
import { __testables as repository, listRuntimeStateSources, listRuntimeStateEvidenceObjects } from '../services/runtimeStateRepository.js'
import { stageRuntimeStateNativeInitialization } from '../services/runtimeStateNativeInitializationService.js'
import { stageRuntimeStateSourceRollover } from '../services/runtimeStateSourceRolloverService.js'
import { createRuntimeRevision } from '../services/runtimeRevisionService.js'
import { POST_LOCK_ADMISSION_VERSION, parsePostLockAdmissionReceipt, parsePostLockAdmissionRequest } from '../services/postLockSuccessorAdmissionContract.js'
import { normalizeRuntimeSectionObject } from '../services/runtimeSectionModelService.js'
import { RUNTIME_STATE_VERSION_PATTERN } from '../models/runtimeStateSchemas.js'
import { readPostLockEvidenceState } from '../services/postLockEvidenceReadStateService.js'
import { listPostLockEvidence, __testables as listQueries } from '../services/postLockEvidenceListService.js'
import { parsePostLockSubmission, postLockSubmissionSchema } from '../services/postLockEvidenceIntakeContract.js'
import { readVerifiedPostLockLockedContext, withPostLockEvidenceTransaction } from '../services/postLockEvidenceIntakeService.js'
import { encodePostLockEvidenceListCursor } from '../services/postLockEvidenceListContract.js'
import { readPostLockOperationalCapability } from '../services/postLockEvidenceOperationalCapabilityService.js'
import { buildDiscoveryEvidencePack } from '../services/runtimeStateMutationService.js'

// Maintained opt-in persistence contract. Never uses the configured Mongo URI.
// Execution requires the separate fixture gate recorded in the SS-056 preflight.
const isolated = process.env.VMF_POST_LOCK_ISOLATED === '1' ? describe : describe.skip
const database = 'ss056_post_lock_intake'
const binaryHash = '919ce2ee9893ffcac72e95610f543beacce721a7c226867568856ca0754d49d8'
const inventory = [
  [RuntimeInstance, 'runtime_instances'], [FrameworkPackage, 'frameworkpackages'], [Customer, 'customers'],
  [Tenant, 'tenants'], [LicenseLevel, 'licenselevels'], [RuntimeEvidenceSource, 'runtime_evidence_sources'],
  [RuntimeEvidenceObject, 'runtime_evidence_objects'], [RuntimeEvidenceSnapshot, 'runtime_evidence_snapshots'],
  [RuntimeStateSection, 'runtime_section_states'], [AuditLog, 'auditlogs'],
  [RuntimeStateMigrationReceipt, 'runtime_state_migration_receipts'],
  [RuntimeGraphSnapshot, 'runtime_graph_snapshots'], [RuntimeGraphElement, 'runtime_graph_elements'],
]
const oid = n => new mongoose.Types.ObjectId(String(n).padStart(24, '0'))
const at = '2026-11-06T12:00:00.000Z', state = 'rsv2:123e4567-e89b-42d3-a456-426614174000'
isolated('post-lock pending recording on one owned loopback replica', () => {
  let replica, owned = false, connectedByFixture = false, runtime, pack, pointer, body
  const previousFixturePolicy = process.env.VMF_POST_LOCK_FIXTURE_POLICY
  const assertOwned = () => {
    if (!owned || mongoose.connection.name !== database || mongoose.connection.host !== '127.0.0.1'
      || inventory.some(([model, name]) => model.collection.name !== name)) throw new Error('SS-056 isolated ownership refused.')
  }
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0 || inventory.some(([model, name]) => model.collection.name !== name)) {
      throw new Error('Disconnected connection and exact collection inventory required.')
    }
    const binary = process.env.VMF_POST_LOCK_MONGOD
    if (!binary || createHash('sha256').update(readFileSync(binary)).digest('hex') !== binaryHash) throw new Error('Reviewed mongod binary required.')
    replica = await MongoMemoryReplSet.create({ binary: { systemBinary: binary, version: '7.0.14' },
      replSet: { count: 1, storageEngine: 'wiredTiger' } })
    const uri = replica.getUri(database)
    if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Owned loopback URI required.')
    await mongoose.connect(uri, { autoCreate: false, autoIndex: false, maxPoolSize: 6, serverSelectionTimeoutMS: 10000,
      monitorCommands: true })
    connectedByFixture = true
    if (mongoose.connection.name !== database || (await mongoose.connection.db.listCollections().toArray()).length) {
      throw new Error('Empty fixed isolated database required.')
    }
    owned = true; assertOwned()
    process.env.VMF_POST_LOCK_FIXTURE_POLICY = '1'
    for (const [model] of inventory) await model.createCollection()
    for (const model of [RuntimeEvidenceSource, RuntimeEvidenceObject, RuntimeEvidenceSnapshot, RuntimeInstance]) await model.createIndexes()
    const hello = await mongoose.connection.db.admin().command({ hello: 1 })
    expect(hello.setName).toEqual(expect.any(String))
    console.info(JSON.stringify({ proof: 'SS056_OWNED_BASELINE', database, host: mongoose.connection.host,
      collections: inventory.map(([, name]) => name), binaryHash,
      indexes: await Promise.all([RuntimeEvidenceSource, RuntimeEvidenceObject, RuntimeInstance].map(model => model.collection.indexes())) }))
  }, 120000)
  afterAll(async () => {
    jest.restoreAllMocks()
    if (previousFixturePolicy === undefined) delete process.env.VMF_POST_LOCK_FIXTURE_POLICY
    else process.env.VMF_POST_LOCK_FIXTURE_POLICY = previousFixturePolicy
    try {
      if (connectedByFixture) {
        if (mongoose.connection.name !== database || mongoose.connection.host !== '127.0.0.1') {
          throw new Error('Refusing to close a connection outside this fixture.')
        }
        await mongoose.disconnect()
        connectedByFixture = false
      }
    } finally {
      await replica?.stop()
      owned = false
    }
  })
  beforeEach(async () => {
    assertOwned(); jest.restoreAllMocks()
    const actual = (await mongoose.connection.db.listCollections().toArray()).map(row => row.name).sort()
    expect(actual).toEqual(inventory.map(([, name]) => name).sort())
    // Only these explicitly owned collections are reset. No dropDatabase or
    // configured/native cluster connection is available through this fixture.
    for (const [model] of inventory) await model.collection.deleteMany({})
    const name = expect.getState().currentTestName || ''
    const admission = name.includes('successor admission')
    const humanImpact = admission || name.includes('human impact') && !name.includes('recording-only policy')
    // Select/capture support before the original lock and submission. Never
    // upgrade a previously locked package to make a review test pass.
    const policy = { contractVersion: 'framework-package-discovery-policy-v1', policyKey: 'ss056-pending', policyVersion: '1.0',
      postLockDiscoveryPolicy: { enabled: true, mutateLockedRevision: false,
        references: [{ ...POST_LOCK_RECORDING_REFERENCE }, ...(humanImpact ? [{ ...POST_LOCK_HUMAN_IMPACT_REFERENCE }] : []),
          ...(admission && !name.includes('review-only policy') ? [{ ...POST_LOCK_ADMISSION_REFERENCE }] : [])],
        ...(humanImpact ? { allowedDispositions: Object.values(POST_LOCK_DISCOVERY_DISPOSITIONS) } : {}) } }
    pack = { _id: oid(104), frameworkKey: 'SS056_SYNTHETIC', packageKey: 'post-lock-contract-proof', version: '1.0',
      discoveryPolicy: policy, dependencyLock: { ...discoveryPolicySnapshot(policy), snapshotId: 'synthetic-dependency', snapshotHash: 'f'.repeat(64) } }
    runtime = { _id: oid(101), customerId: oid(102), tenantId: oid(103), runtimeInstanceKey: 'ss056-pending-synthetic',
      runtimeType: 'VALUE_NARRATIVE', status: 'LOCKED', executionStatus: 'IDLE', stateVersion: state,
      revision: { revisionNumber: 1 }, workspaceId: '', packageId: pack._id, frameworkKey: pack.frameworkKey,
      packageKey: pack.packageKey, packageVersion: pack.version, dependencyLockId: pack.dependencyLock.snapshotId,
      activationId: 'synthetic-activation-reference', deploymentId: 'synthetic-deployment-reference',
      evidence: { dependencySnapshotId: pack.dependencyLock.snapshotId, dependencySnapshotHash: pack.dependencyLock.snapshotHash },
      lockedAt: new Date(at), lockedBy: oid(109), updatedAt: new Date(at), createdAt: new Date(at),
      framework_state: { lock: { locked: true, snapshot: { snapshotId: 'synthetic-truth-lock', snapshotHash: 'a'.repeat(64),
        snapshotAt: at, contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' } },
      sections: {}, evidence_pack: { evidenceObjects: [], lineage: { sources: [] } } } }
    await Customer.collection.insertOne({ _id: oid(102), topology: 'SINGLE_TENANT', licenseLevelId: oid(110), entitlements: [] })
    await Tenant.collection.insertOne({ _id: oid(103), customerId: oid(102) })
    await LicenseLevel.collection.insertOne({ _id: oid(110), isActive: true, featureEntitlements: ['VMF'], homeExperience: 'CORE' })
    await FrameworkPackage.collection.insertOne(pack)
    if (admission) {
      await createCoherentAdmissionPredecessor()
      return
    }
    const common = { customerId: oid(102), tenantId: oid(103), runtimeInstanceId: oid(101), runtimeInstanceKey: runtime.runtimeInstanceKey,
      stateVersion: state, sourceStateVersion: state, sourceHash: `sha256:${'b'.repeat(64)}`, migrationReceiptId: oid(105), current: true }
    await RuntimeEvidenceSource.create({ ...common, _id: oid(106), sourceId: 'original-source', sourceType: 'MANUAL_DOCUMENT', title: 'Original source' })
    await RuntimeEvidenceObject.create({ ...common, _id: oid(107), evidenceObjectId: 'original-evidence', sourceId: 'original-source',
      sourceType: 'MANUAL_DOCUMENT', extractedFact: 'Original immutable synthetic fact.', reviewStatus: 'ACCEPTED' })
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const prepared = await prepareRuntimeEvidenceSnapshot({ runtime, session,
          snapshotId: 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174002' })
        pointer = prepared.pointer; body = prepared.body
        const audit = new AuditLog({ actorUserId: oid(109), action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
          resourceId: oid(101), scope: { customerId: oid(102), tenantId: oid(103), runtimeInstanceId: oid(101), runtimeInstanceKey: runtime.runtimeInstanceKey },
          diff: { actionKey: 'LOCK_RECORD', actionedAt: at, evidenceMembershipSnapshot: { ...pointer, counts: body.counts } } })
        audit.generateSignature(); await audit.save({ session })
        await persistRuntimeEvidenceSnapshot({ prepared, actorUserId: oid(109), audit, session })
      })
    } finally { await session.endSession() }
    runtime.lockedEvidenceSnapshot = pointer
    await RuntimeInstance.collection.insertOne(runtime)
  })
  const scopes = permissions => ({ customer: { _id: String(oid(102)) },
    tenant: { _id: String(oid(103)), customerId: String(oid(102)) }, resolvedPermissions: {
      tenants: [{ customerId: String(oid(102)), tenantId: String(oid(103)), permissions: permissions || ['VMF_VIEW', 'VMF_UPDATE'] }],
    } })
  const payload = () => ({ contractVersion: 'post-lock-evidence-submission.v1', requestKey: '123e4567-e89b-42d3-a456-426614174001',
    binding: { customerId: String(oid(102)), tenantId: String(oid(103)), runtimeInstanceId: String(oid(101)),
      runtimeInstanceKey: runtime.runtimeInstanceKey, revisionNumber: 1, basisStateVersion: runtime.stateVersion,
      evidenceSnapshotId: pointer.snapshotId, membershipHash: pointer.membershipHash, lockSnapshotId: pointer.lockSnapshotId,
      lockSnapshotHash: pointer.lockSnapshotHash, packageId: String(oid(104)), packageVersion: '1.0',
      dependencySnapshotId: pack.dependencyLock.snapshotId, dependencySnapshotHash: pack.dependencyLock.snapshotHash,
      policyHash: pack.dependencyLock.discoveryPolicyHash },
    source: { sourceId: 'manual-document-1', sourceType: 'MANUAL_DOCUMENT', title: 'Synthetic later source',
      locator: { url: 'https://example.org/synthetic', passage: 'A synthetic supplied passage.' },
      contentHash: `sha256:${'c'.repeat(64)}`, retrievedAt: at, currentness: 'UNCONFIRMED', qualifications: ['Synthetic; not independently verified.'],
      licensing: { licenceRef: 'synthetic-owner-permission', retentionPermitted: true, retainUntil: null },
      provenance: { producerKey: 'manual', producerVersion: '1', receiptRef: 'synthetic-receipt-1', acquiredAt: at } },
    evidence: { title: 'Later synthetic evidence', statement: 'Synthetic later statement awaiting impact review.', sectionKeys: [] },
    reason: 'Check the effect on a future revision.',
  })
  const args = (input = payload(), permission) => ({ runtimeInstanceId: runtime.runtimeInstanceKey, actorUserId: String(oid(109)),
    scopes: scopes(permission), payload: input })
  const counts = async () => ({ sources: await RuntimeEvidenceSource.countDocuments(), evidence: await RuntimeEvidenceObject.countDocuments(), audits: await AuditLog.countDocuments() })
  const predecessor = async () => membershipHash({
    runtime: await RuntimeInstance.collection.findOne({ _id: oid(101) }), pack: await FrameworkPackage.collection.findOne({ _id: oid(104) }),
    source: await RuntimeEvidenceSource.collection.findOne({ _id: oid(106) }), evidence: await RuntimeEvidenceObject.collection.findOne({ _id: oid(107) }),
    snapshots: await RuntimeEvidenceSnapshot.collection.find({}).toArray(), audits: await AuditLog.collection.find({ action: 'RUNTIME_ACTION_EXECUTED' }).toArray(),
  })

  // Admission fixtures obtain a genuine native-initialization receipt, then use
  // the existing rollover owner to build a coherent nonempty root/native basis.
  // The publish/lock eligibility below is synthetic pre-lock fixture material;
  // it is not proof of the customer's normal publish or review journey.
  async function createCoherentAdmissionPredecessor() {
    const initialState = 'rsv2:123e4567-e89b-42d3-a456-426614174009'
    const initial = new RuntimeInstance({ ...runtime, name: 'Owned synthetic admission predecessor',
      createdBy: oid(109),
      status: 'ACTIVE', stateVersion: initialState, lockedAt: null, lockedBy: null,
      evidence: { ...runtime.evidence, activationId: runtime.activationId, deploymentId: runtime.deploymentId },
      framework_state: { lifecycle: { stage: 'DRAFT' }, sections: {}, evidence_pack: {}, intelligence_graph: {} } })
    const originalSource = { sourceId: 'original-source', sourceType: 'MANUAL_DOCUMENT', title: 'Original source',
      label: 'Original source', sourceRef: 'https://example.org/original', contentHash: `sha256:${'b'.repeat(64)}`,
      acquisitionStatus: 'CAPTURED', lineageRef: 'synthetic:original-source', reviewStatus: 'ACCEPTED' }
    const originalEvidence = { evidenceObjectId: 'original-evidence', sourceId: originalSource.sourceId,
      sourceType: originalSource.sourceType, title: 'Original evidence', extractedFact: 'Original immutable synthetic fact.',
      reviewStatus: 'ACCEPTED', acceptanceState: 'ACCEPTED', acceptedBy: String(oid(109)),
      acceptanceTimestamp: '2026-11-06T11:59:00.000Z', lineageRef: originalSource.lineageRef,
      confidence: { level: 'SYNTHETIC', score: 0.8, basis: ['Owned fixture, not source verification.'] } }
    const referencedHistory = (expect.getState().currentTestName || '').includes('referenced history')
    // Three approximately106KiB generated/accepted pairs produce a root over
    // 256KiB at S3. Actual rollover projectors then retain bounded references to
    // the genuine historical S2 row; no receipt or initial fingerprint is forged.
    const archives = referencedHistory ? Array.from({ length: 3 }, (_, index) => ({ revisionNumber: index + 1,
      reason: `Owned historical section ${index + 1}`,
      generated: { summary: `Generated ${index + 1}`, paragraphs: Array.from({ length: 9 }, () => 'g'.repeat(5900)) },
      accepted: { summary: `Accepted ${index + 1}`, paragraphs: Array.from({ length: 9 }, () => 'a'.repeat(5900)) },
    })) : []
    const sectionAt = index => normalizeRuntimeSectionObject({ value: { generated: archives[index].generated,
      accepted: archives[index].accepted, revisions: archives.slice(0, index) }, sectionKey: 'customer_context',
      runtimePath: 'framework_state.sections.customer_context', initializedAt: '2026-11-06T11:59:00.000Z' })
    const nextFrameworkState = { lifecycle: { stage: 'DRAFT' },
      sections: referencedHistory ? { customer_context: sectionAt(0) } : {},
      evidence_pack: { sourceRegistry: [originalSource], evidenceObjects: [originalEvidence],
        lineage: { sources: [{ ...originalSource, type: originalSource.sourceType, status: 'AVAILABLE' }] },
        accepted: true, evidenceReady: true, needsRefresh: false },
      intelligence_graph: { graphVersion: state, nodes: [], edges: [] } }
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        await initial.save({ session })
        await stageRuntimeStateNativeInitialization({ actorUserId: oid(109), runtimeInstance: initial,
          frameworkPackage: pack, session, now: new Date('2026-11-06T11:58:00.000Z') })
        await stageRuntimeStateSourceRollover({ runtimeInstance: initial, expectedStateVersion: initialState,
          nextStateVersion: state, nextFrameworkState, mutationTimestamp: '2026-11-06T11:59:00.000Z', session })
        await RuntimeInstance.collection.updateOne({ _id: initial._id }, { $set: { stateVersion: state,
          updatedAt: new Date('2026-11-06T11:59:00.000Z'), framework_state: nextFrameworkState } }, { session })
        runtime = await RuntimeInstance.collection.findOne({ _id: initial._id }, { session })
        for (let index = 1; index < archives.length; index++) {
          const nextStateVersion = `rsv2:123e4567-e89b-42d3-a456-${String(700 + index).padStart(12, '0')}`
          const next = JSON.parse(JSON.stringify(runtime.framework_state))
          next.sections.customer_context = sectionAt(index)
          next.intelligence_graph.graphVersion = nextStateVersion
          await stageRuntimeStateSourceRollover({ runtimeInstance: runtime, expectedStateVersion: runtime.stateVersion,
            nextStateVersion, nextFrameworkState: next, mutationTimestamp: `2026-11-06T11:59:0${index}.000Z`, session })
          await RuntimeInstance.collection.updateOne({ _id: runtime._id }, { $set: { stateVersion: nextStateVersion,
            framework_state: next } }, { session })
          runtime = await RuntimeInstance.collection.findOne({ _id: runtime._id }, { session })
        }
        const lockedFrameworkState = { ...runtime.framework_state, lifecycle: { stage: 'PUBLISHED' },
          publish: { state: 'PUBLISHED', published: true, snapshot: { snapshotId: 'synthetic-publish-proof', snapshotHash: 'd'.repeat(64) } },
          lock: { state: 'LOCKED', locked: true, snapshot: { snapshotId: 'synthetic-truth-lock', snapshotHash: 'a'.repeat(64),
            snapshotAt: at, contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' },
          replayAnchor: { replayAnchorId: 'synthetic-replay-anchor', replayAnchorHash: 'e'.repeat(64) } } }
        await RuntimeInstance.collection.updateOne({ _id: runtime._id }, { $set: { framework_state: lockedFrameworkState,
          status: 'LOCKED', lockedAt: new Date(at), lockedBy: oid(109), updatedAt: new Date(at) } }, { session })
        runtime = await RuntimeInstance.collection.findOne({ _id: runtime._id }, { session })
        const prepared = await prepareRuntimeEvidenceSnapshot({ runtime, session,
          snapshotId: 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174002' })
        pointer = prepared.pointer; body = prepared.body
        const audit = new AuditLog({ actorUserId: oid(109), action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
          resourceId: runtime._id, scope: { customerId: runtime.customerId, tenantId: runtime.tenantId,
            runtimeInstanceId: runtime._id, runtimeInstanceKey: runtime.runtimeInstanceKey },
          diff: { actionKey: 'LOCK_RECORD', actionedAt: at, evidenceMembershipSnapshot: { ...pointer, counts: body.counts } } })
        audit.generateSignature()
        await audit.save({ session })
        await persistRuntimeEvidenceSnapshot({ prepared, actorUserId: oid(109), audit, session })
        await RuntimeInstance.collection.updateOne({ _id: runtime._id }, { $set: { lockedEvidenceSnapshot: pointer } }, { session })
        runtime.lockedEvidenceSnapshot = pointer
      })
    } finally { await session.endSession() }
  }

  test('persists pending outside exact frozen IDs and reads all provenance without predecessor changes', async () => {
    const before = await predecessor(), input = payload(), result = await submitPostLockEvidence(args(input))
    expect(result).toMatchObject({ status: 'PENDING_REVIEW', outsideFrozenMembership: true, replayed: false,
      source: input.source, evidence: input.evidence, binding: input.binding, receipt: { verified: true } })
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 2 })
    expect(await predecessor()).toBe(before)
    const read = await readPostLockEvidence({ ...args(), submissionId: result.submissionId })
    expect(read.source).toEqual(input.source); expect(read.evidence).toEqual(input.evidence)
    expect(await readVerifiedRuntimeEvidenceSnapshot({ runtime, pointer })).toMatchObject({ membershipHash: pointer.membershipHash })
    const session = await mongoose.startSession()
    try { await session.withTransaction(async () => {
      const rebuilt = await prepareRuntimeEvidenceSnapshot({ runtime, session })
      expect(membershipHash(rebuilt.body)).toBe(membershipHash(body))
    }) } finally { await session.endSession() }
    for (const model of [RuntimeEvidenceSource, RuntimeEvidenceObject]) {
      expect(await model.countDocuments(repository.buildCurrentStateFilter())).toBe(1)
      // Both existing promotion families require migrationReceiptId. Pending
      // rows must not match even if the state version is otherwise identical.
      expect(await model.countDocuments({ current: false, stateVersion: state, migrationReceiptId: oid(105) })).toBe(0)
    }
  })
  test.each(['membershipHash', 'basisStateVersion', 'lockSnapshotHash', 'runtimeInstanceId', 'tenantId', 'policyHash'])('stale %s rejects with zero partial writes', async field => {
    const input = payload(), before = await predecessor()
    input.binding[field] = field === 'basisStateVersion' ? 'rsv2:123e4567-e89b-42d3-a456-426614174009'
      : field.endsWith('Id') ? String(oid(999)) : '0'.repeat(64)
    await expect(submitPostLockEvidence(args(input))).rejects.toMatchObject({ status: 409, details: { reason: 'POST_LOCK_BINDING_STALE' } })
    expect(await counts()).toEqual({ sources: 1, evidence: 1, audits: 1 }); expect(await predecessor()).toBe(before)
  })
  test('same-key concurrent callers have one pair and audit; passive retry reads winner and conflicts on changed material', async () => {
    const input = payload(), before = await predecessor()
    const results = await Promise.all([submitPostLockEvidence(args(input)), submitPostLockEvidence(args(input))])
    expect(results.map(row => row.submissionId)).toEqual([postLockSubmissionId(input), postLockSubmissionId(input)])
    expect(results.filter(row => row.replayed === false)).toHaveLength(1)
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 2 })
    expect(await submitPostLockEvidence(args(input))).toMatchObject({ replayed: true, receipt: { verified: true } })
    input.reason = 'Different request material.'
    await expect(submitPostLockEvidence(args(input))).rejects.toMatchObject({ details: { reason: 'POST_LOCK_IDEMPOTENCY_CONFLICT' } })
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 2 }); expect(await predecessor()).toBe(before)
  })
  test.each(['audit', 'source', 'evidence'])('%s write failure rolls back every new record', async phase => {
    const before = await predecessor()
    const target = phase === 'audit' ? auditService : phase === 'source' ? RuntimeEvidenceSource : RuntimeEvidenceObject
    jest.spyOn(target, phase === 'audit' ? 'log' : 'create').mockRejectedValue(new Error(`Synthetic ${phase} failure`))
    await expect(submitPostLockEvidence(args())).rejects.toThrow(`Synthetic ${phase} failure`)
    expect(await counts()).toEqual({ sources: 1, evidence: 1, audits: 1 }); expect(await predecessor()).toBe(before)
  })
  test.each(['isCurrent', 'status', 'stateStatus', 'signature'])('raw %s corruption cannot verify as a committed winner', async field => {
    const result = await submitPostLockEvidence(args())
    if (field === 'signature') await AuditLog.collection.updateOne({ action: 'POST_LOCK_EVIDENCE_SUBMITTED' }, { $set: { signature: 'invalid' } })
    else await RuntimeEvidenceObject.collection.updateOne({ evidenceObjectId: `post-lock:${result.submissionId}` },
      { $set: { [field]: field === 'isCurrent' ? true : 'CURRENT' } })
    await expect(readPostLockEvidence({ ...args(), submissionId: result.submissionId })).rejects.toMatchObject({ details: { reason: 'POST_LOCK_RECEIPT_UNVERIFIED' } })
    await expect(submitPostLockEvidence(args())).rejects.toMatchObject({ details: { reason: 'POST_LOCK_RECEIPT_UNVERIFIED' } })
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 2 })
  })
  test('view-only user cannot submit and controlled-replay marker denies before any pending write', async () => {
    await expect(submitPostLockEvidence(args(payload(), ['VMF_VIEW']))).rejects.toMatchObject({ status: 403 })
    await RuntimeInstance.collection.updateOne({ _id: oid(101) }, { $set: { controlledReplayIsolation: {
      contractVersion: 'controlled-replay-runtime-isolation.v1', classification: 'CONTROLLED_SYNTHETIC_REPLAY',
      scope: { customerId: String(oid(102)), tenantId: String(oid(103)), runtimeInstanceId: String(oid(101)) },
      runtimeInstanceKey: runtime.runtimeInstanceKey, bindingDigest: `sha256:${'d'.repeat(64)}` } } })
    await expect(submitPostLockEvidence(args())).rejects.toMatchObject({ details: { reason: 'CONTROLLED_REPLAY_ISOLATED' } })
    expect(await counts()).toEqual({ sources: 1, evidence: 1, audits: 1 })
  })
  test('unexpected stored pointer fields remain rejected by the unchanged frozen verifier', async () => {
    await RuntimeInstance.collection.updateOne({ _id: oid(101) }, { $set: { 'lockedEvidenceSnapshot.unexpected': 'must reject' } })
    await expect(submitPostLockEvidence(args())).rejects.toMatchObject({
      code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID', details: { reason: 'POINTER_BINDING_INVALID' },
    })
    expect(await counts()).toEqual({ sources: 1, evidence: 1, audits: 1 })
  })
  test('Public-Research-shaped source uses the same contract without contacting a provider', async () => {
    const network = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('No provider/network calls permitted.') })
    const input = payload()
    input.source.sourceId = 'synthetic-public-register-record'
    input.source.sourceType = 'PUBLIC_RESEARCH'
    input.source.provenance.producerKey = 'synthetic-public-research-fixture'
    input.source.currentness = 'AS_OF'; input.source.asOfAt = at
    input.source.qualifications = ['Synthetic register-shaped metadata only.', 'Licensing is a fixture assertion, not a live provider approval.']
    const result = await submitPostLockEvidence(args(input))
    expect(result.source).toEqual(input.source); expect(network).not.toHaveBeenCalled()
  })

  const prepareImpact = async () => submitPostLockEvidence(args())
  const impactArgs = (submission, overrides = {}, permission) => ({ ...args(undefined, permission), submissionId: submission.submissionId,
    payload: { contractVersion: 'post-lock-impact-decision.v1', requestKey: '123e4567-e89b-42d3-a456-426614174003',
      expectedBinding: submission.binding, expectedSubmissionDigest: submission.requestDigest, expectedHeadHash: null,
      disposition: 'SUCCESSOR_REVISION_REQUIRED', rationale: 'A human impact conclusion; evidence acceptance and admission are separate.',
      confirm: true, ...overrides } })
  const pendingRow = submission => RuntimeEvidenceObject.collection.findOne({ evidenceObjectId: `post-lock:${submission.submissionId}` })
  const withoutImpact = row => { const result = { ...row }; delete result.postLockImpactHistory; return result }

  test.each(Object.values(POST_LOCK_DISCOVERY_DISPOSITIONS))('human impact %s records a signed decision without acceptance or predecessor mutation', async disposition => {
    const submission = await prepareImpact(), before = await predecessor(), original = await pendingRow(submission)
    const result = await recordPostLockImpactDecision(impactArgs(submission, { disposition }))
    expect(result).toMatchObject({ replayed: false, intakeStatus: 'PENDING_REVIEW', admissionAvailable: false,
      decision: { disposition, reviewerUserId: String(oid(109)), authority: 'VMF_UPDATE', verified: true, isCurrent: true } })
    const row = await pendingRow(submission)
    expect(membershipHash(withoutImpact(row))).toBe(membershipHash(original))
    expect(await predecessor()).toBe(before)
    expect(await RuntimeInstance.countDocuments()).toBe(1)
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 3 })
    const history = await readPostLockImpactHistory(impactArgs(submission))
    expect(history).toMatchObject({ verification: { status: 'VERIFIED', reason: null }, impact: { state: 'RECORDED' },
      canRecord: true, admissionAvailable: false, pagination: { total: 1 } })
    expect(history.entries[0].decisionId).toBe(result.decision.decisionId)
    for (const audit of await AuditLog.find()) expect(audit.verifySignature()).toBe(true)
  })
  test('human impact recording-only policy stays compatible for intake but denies human decisions', async () => {
    const submission = await prepareImpact()
    await expect(recordPostLockImpactDecision(impactArgs(submission))).rejects.toMatchObject({
      status: 409, details: { reason: 'POST_LOCK_IMPACT_POLICY_UNAVAILABLE' },
    })
    const history = await readPostLockImpactHistory(impactArgs(submission))
    expect(history).toMatchObject({ canRecord: false, entries: [], impact: { state: 'NOT_RECORDED' } })
    expect(history.blockedBy).toContain('POST_LOCK_IMPACT_POLICY_UNAVAILABLE')
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 2 })
  })
  test('human impact historical retry after a later decision returns its own receipt without restoring the old head', async () => {
    const submission = await prepareImpact(), firstArgs = impactArgs(submission)
    const first = await recordPostLockImpactDecision(firstArgs)
    const second = await recordPostLockImpactDecision(impactArgs(submission, { requestKey: '123e4567-e89b-42d3-a456-426614174004',
      expectedHeadHash: first.observedHeadHash, disposition: 'CURRENTNESS_REVIEW_REQUIRED', rationale: 'Currentness still needs review.' }))
    const before = await pendingRow(submission), replay = await recordPostLockImpactDecision(firstArgs)
    expect(replay).toMatchObject({ replayed: true, observedHeadHash: second.observedHeadHash,
      decision: { decisionId: first.decision.decisionId, isCurrent: false } })
    expect(membershipHash(await pendingRow(submission))).toBe(membershipHash(before))
    const page = await readPostLockImpactHistory({ ...impactArgs(submission), limit: 1, afterSequence: 0 })
    expect(page.entries[0]).toMatchObject({ decisionId: first.decision.decisionId, isCurrent: false })
    expect(page).toMatchObject({ pagination: { nextAfterSequence: 1, total: 2 }, impact: { latestDecision: { decisionId: second.decision.decisionId } } })
    const last = await readPostLockImpactHistory({ ...impactArgs(submission), limit: 1, afterSequence: 1 })
    expect(last.entries[0]).toMatchObject({ isCurrent: true, disposition: 'CURRENTNESS_REVIEW_REQUIRED' })
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 4 })
    await expect(recordPostLockImpactDecision(impactArgs(submission, { rationale: 'Changed under the old key.' })))
      .rejects.toMatchObject({ details: { reason: 'POST_LOCK_IMPACT_IDEMPOTENCY_CONFLICT' } })
  })
  test.each(['head', 'binding', 'digest'])('human impact stale %s has zero committed writes', async fault => {
    const submission = await prepareImpact(), request = impactArgs(submission), before = await pendingRow(submission)
    if (fault === 'head') request.payload.expectedHeadHash = '0'.repeat(64)
    if (fault === 'binding') request.payload.expectedBinding = { ...submission.binding, tenantId: String(oid(999)) }
    if (fault === 'digest') request.payload.expectedSubmissionDigest = '0'.repeat(64)
    await expect(recordPostLockImpactDecision(request)).rejects.toMatchObject({ status: 409, details: { reason: 'POST_LOCK_IMPACT_STALE' } })
    expect(membershipHash(await pendingRow(submission))).toBe(membershipHash(before))
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 2 })
  })
  test.each(['audit', 'cas'])('human impact %s failure rolls back the required audit and head together', async fault => {
    const submission = await prepareImpact(), before = await pendingRow(submission)
    if (fault === 'audit') jest.spyOn(auditService, 'log').mockRejectedValue(new Error('Synthetic impact audit failure'))
    else jest.spyOn(RuntimeEvidenceObject.collection, 'updateOne').mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })
    await expect(recordPostLockImpactDecision(impactArgs(submission))).rejects.toMatchObject({
      status: fault === 'audit' ? 503 : 409, details: { reason: fault === 'audit' ? 'POST_LOCK_IMPACT_AUDIT_WRITE_FAILED' : 'POST_LOCK_IMPACT_STALE' },
    })
    expect(membershipHash(await pendingRow(submission))).toBe(membershipHash(before))
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 2 })
  })
  test.each(['same-key', 'different-key'])('human impact concurrent %s callers leave one decision and audit', async mode => {
    const submission = await prepareImpact(), first = impactArgs(submission)
    const second = impactArgs(submission, mode === 'same-key' ? {} : { requestKey: '123e4567-e89b-42d3-a456-426614174004' })
    const results = await Promise.allSettled([recordPostLockImpactDecision(first), recordPostLockImpactDecision(second)])
    if (mode === 'same-key') {
      expect(results.every(result => result.status === 'fulfilled')).toBe(true)
      expect(results.filter(result => result.value.replayed === false)).toHaveLength(1)
    } else {
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find(result => result.status === 'rejected').reason).toMatchObject({
        status: 409, details: { reason: 'POST_LOCK_IMPACT_STALE' },
      })
    }
    expect((await pendingRow(submission)).postLockImpactHistory.entries).toHaveLength(1)
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 3 })
  })
  test('human impact missing audit retains decision material but removes verified/current/executable authority', async () => {
    const submission = await prepareImpact(), result = await recordPostLockImpactDecision(impactArgs(submission)), before = await pendingRow(submission)
    // Exact owned fixture record only; this simulates an unavailable receipt,
    // not the passage of seven years or execution of MongoDB's TTL monitor.
    await AuditLog.collection.deleteOne({ _id: new mongoose.Types.ObjectId(result.decision.audit.id) })
    const history = await readPostLockImpactHistory(impactArgs(submission))
    expect(history).toMatchObject({ verification: { status: 'UNVERIFIED', reason: 'POST_LOCK_IMPACT_AUDIT_NOT_RECORDED' },
      impact: { state: 'UNVERIFIED', headHash: null, latestDecision: null }, canRecord: false, admissionAvailable: false })
    expect(history.entries[0]).toMatchObject({ decisionId: result.decision.decisionId, verified: false, isCurrent: false })
    await expect(recordPostLockImpactDecision(impactArgs(submission))).rejects.toMatchObject({
      status: 503, details: { reason: 'POST_LOCK_IMPACT_AUDIT_NOT_RECORDED' },
    })
    expect(membershipHash(await pendingRow(submission))).toBe(membershipHash(before))
  })
  test.each(['signature', 'head', 'rationale'])('human impact corrupted %s never projects trusted history', async field => {
    const submission = await prepareImpact(), result = await recordPostLockImpactDecision(impactArgs(submission))
    if (field === 'signature') await AuditLog.collection.updateOne({ _id: new mongoose.Types.ObjectId(result.decision.audit.id) }, { $set: { signature: 'invalid' } })
    else await RuntimeEvidenceObject.collection.updateOne({ evidenceObjectId: `post-lock:${submission.submissionId}` }, {
      $set: field === 'head' ? { 'postLockImpactHistory.headHash': '0'.repeat(64) } : { 'postLockImpactHistory.entries.0.rationale': 'Altered without a signed decision.' },
    })
    await expect(readPostLockImpactHistory(impactArgs(submission))).rejects.toMatchObject({ status: 503,
      details: { reason: field === 'signature' ? 'POST_LOCK_IMPACT_AUDIT_UNVERIFIED' : 'POST_LOCK_IMPACT_HISTORY_INVALID' } })
  })
  test('human impact failed audit lookup rejects through a mounted controller instead of appearing absent', async () => {
    const submission = await prepareImpact(); await recordPostLockImpactDecision(impactArgs(submission))
    const cursor = { limit: jest.fn().mockReturnThis(), toArray: jest.fn().mockRejectedValue(new Error('Synthetic audit read failure')) }
    jest.spyOn(AuditLog.collection, 'find').mockReturnValue(cursor)
    const { default: express } = await import('express'), { default: supertest } = await import('supertest')
    const { getRuntimePostLockImpactHistory } = await import('../controllers/runtimeInstance.controller.js')
    const app = express()
    // Authentication is an explicit fixture seam here; actual auth middleware
    // rejection is checked separately in runtimeInstances.test.js.
    app.use((req, _res, next) => { req.scopes = scopes(); req.context = { userId: String(oid(109)) }; next() })
    app.get('/runtime-instances/:runtimeInstanceId/post-lock-evidence/:submissionId/impact-decisions', getRuntimePostLockImpactHistory)
    const response = await supertest(app).get(`/runtime-instances/${runtime.runtimeInstanceKey}/post-lock-evidence/${submission.submissionId}/impact-decisions`)
      .query({ customerId: String(oid(102)), tenantId: String(oid(103)) })
    expect(response.status).toBe(503)
    expect(response.body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_IMPACT_READ_UNAVAILABLE' } })
    expect(response.body).not.toHaveProperty('data')
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 3 })
  })
  test('human impact view-only and wrong selected tenant refuse without granting new access', async () => {
    const submission = await prepareImpact()
    await expect(recordPostLockImpactDecision(impactArgs(submission, {}, ['VMF_VIEW']))).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    const view = await readPostLockImpactHistory(impactArgs(submission, {}, ['VMF_VIEW']))
    expect(view).toMatchObject({ canRecord: false, blockedBy: ['VMF_UPDATE_REQUIRED'] })
    const wrong = impactArgs(submission)
    wrong.scopes = { ...wrong.scopes, customer: { _id: String(oid(999)) }, tenant: { _id: String(oid(998)), customerId: String(oid(999)) } }
    await expect(readPostLockImpactHistory(wrong)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: 2 })
  })
  test('human impact byte capacity refuses another large decision without removing prior history', async () => {
    const submission = await prepareImpact()
    let head = null, committed = 0, refused = false
    for (let index = 1; index <= 100; index++) {
      const request = impactArgs(submission, { requestKey: `123e4567-e89b-42d3-a456-${String(index + 20).padStart(12, '0')}`,
        expectedHeadHash: head, rationale: 'r'.repeat(2000) })
      const before = await pendingRow(submission)
      try {
        const result = await recordPostLockImpactDecision(request)
        head = result.observedHeadHash; committed++
      } catch (error) {
        expect(error).toMatchObject({ status: 409, details: { reason: 'POST_LOCK_IMPACT_CAPACITY' } })
        expect(membershipHash(await pendingRow(submission))).toBe(membershipHash(before))
        refused = true; break
      }
    }
    expect(refused).toBe(true); expect(committed).toBeGreaterThan(0)
    expect((await pendingRow(submission)).postLockImpactHistory.entries).toHaveLength(committed)
    expect(await counts()).toEqual({ sources: 2, evidence: 2, audits: committed + 2 })
  }, 30000)

  const allOwnedMaterial = async () => membershipHash(await Promise.all(inventory.map(async ([model, name]) => ({
    name, rows: await model.collection.find({}).sort({ _id: 1 }).toArray(),
  }))))
  const waitForBarrier = async signal => {
    let timer
    try {
      await Promise.race([signal, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Owned admission race did not reach its expected write barrier.')), 10000)
      })])
    } finally { clearTimeout(timer) }
  }
  const immutableAdmissionPredecessor = async () => membershipHash({
    runtime: await RuntimeInstance.collection.findOne({ _id: oid(101) }),
    package: await FrameworkPackage.collection.findOne({ _id: oid(104) }),
    sources: await RuntimeEvidenceSource.collection.find({ runtimeInstanceId: oid(101), sourceId: 'original-source' }).toArray(),
    evidence: await RuntimeEvidenceObject.collection.find({ runtimeInstanceId: oid(101), evidenceObjectId: 'original-evidence' }).toArray(),
    snapshots: await RuntimeEvidenceSnapshot.collection.find({ runtimeInstanceId: oid(101) }).toArray(),
    locks: await AuditLog.collection.find({ action: 'RUNTIME_ACTION_EXECUTED' }).toArray(),
  })
  const prepareAdmission = async ({ disposition = 'SUCCESSOR_REVISION_REQUIRED', mutate = () => {} } = {}) => {
    const input = payload(); mutate(input)
    const submission = await submitPostLockEvidence(args(input))
    const decision = await recordPostLockImpactDecision(impactArgs(submission, { disposition }))
    return { input, submission, decision, request: { ...args(), payload: { expectedUpdatedAt: runtime.updatedAt.toISOString(),
      reason: 'Create the ordinary draft with one explicitly selected candidate.',
      postLockAdmission: { contractVersion: POST_LOCK_ADMISSION_VERSION, requestKey: '123e4567-e89b-42d3-a456-426614174601',
        submissionId: submission.submissionId, expectedSubmissionDigest: submission.requestDigest,
        expectedBinding: submission.binding, expectedImpactHeadHash: decision.observedHeadHash,
        rationale: 'Explicit admission to a draft; ordinary evidence acceptance remains pending.', confirm: true } } } }
  }
  const childFor = result => RuntimeInstance.collection.findOne({ _id: new mongoose.Types.ObjectId(result.runtimeInstance.id) })
  const nextDecision = (fixture, overrides = {}) => impactArgs(fixture.submission, {
    requestKey: '123e4567-e89b-42d3-a456-426614174602', expectedHeadHash: fixture.decision.observedHeadHash,
    disposition: 'CURRENTNESS_REVIEW_REQUIRED', rationale: 'A later human conclusion does not rewrite a historical admission.', ...overrides,
  })

  test.each(['recording-only', 'human impact', 'successor admission'])('publication gate blocks legacy %s intake and advertised availability without writes', async () => {
    const previous = process.env.VMF_POST_LOCK_FIXTURE_POLICY
    delete process.env.VMF_POST_LOCK_FIXTURE_POLICY
    try {
      const before = await allOwnedMaterial()
      await expect(submitPostLockEvidence(args())).rejects.toMatchObject({ status: 409,
        details: { reason: 'POST_LOCK_POLICY_UNAVAILABLE' } })
      const capability = await readPostLockOperationalCapability(args())
      expect(capability.recording).toMatchObject({ eligibility: 'BLOCKED', binding: null,
        blockedBy: ['POST_LOCK_POLICY_UNAVAILABLE'], checks: { policy: 'UNAVAILABLE', storageIndexes: 'NOT_CHECKED' } })
      expect(await allOwnedMaterial()).toBe(before)
    } finally { process.env.VMF_POST_LOCK_FIXTURE_POLICY = previous }
  })
  test('successor admission publication gate blocks new review and admission while preserving historical reads', async () => {
    const f = await prepareAdmission(), previous = process.env.VMF_POST_LOCK_FIXTURE_POLICY
    delete process.env.VMF_POST_LOCK_FIXTURE_POLICY
    try {
      const before = await allOwnedMaterial()
      await expect(recordPostLockImpactDecision(nextDecision(f))).rejects.toMatchObject({ status: 409,
        details: { reason: 'POST_LOCK_IMPACT_POLICY_UNAVAILABLE' } })
      await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 409,
        details: { reason: 'POST_LOCK_ADMISSION_POLICY_UNAVAILABLE' } })
      const item = await readPostLockEvidenceState({ ...args(), submissionId: f.submission.submissionId })
      expect(item.readState.actions.recordImpact).toMatchObject({ eligibility: 'BLOCKED', blockedBy: ['POST_LOCK_IMPACT_POLICY_UNAVAILABLE'] })
      expect(item.readState.actions.admission).toMatchObject({ eligibility: 'BLOCKED', blockedBy: ['POST_LOCK_ADMISSION_POLICY_UNAVAILABLE'] })
      expect(item.receipt.verified).toBe(true)
      expect(item.readState.impact.latestDecision.verified).toBe(true)
      expect(await submitPostLockEvidence(args(f.input))).toMatchObject({ replayed: true, submissionId: f.submission.submissionId })
      expect(await allOwnedMaterial()).toBe(before)
    } finally { process.env.VMF_POST_LOCK_FIXTURE_POLICY = previous }
  })

  // Exact-item additions retain the preceding 75 cases and the same 13 owners.
  // All new reads use the real service; dependency faults are named explicitly.
  const readItem = (submission, permissions) => readPostLockEvidenceState({ ...args(undefined, permissions), submissionId: submission.submissionId })
  const expectPassiveItem = async (submission, inspect, permissions) => {
    const before = await allOwnedMaterial(), result = await readItem(submission, permissions)
    expect(result).toMatchObject({ submissionId: submission.submissionId, status: 'PENDING_REVIEW',
      outsideFrozenMembership: true, receipt: { verified: true },
      readState: { contractVersion: 'post-lock-evidence-read-state.v1', currency: 'AS_READ' } })
    expect(result.binding).toEqual(submission.binding)
    expect(result.source).toEqual(submission.source); expect(result.evidence).toEqual(submission.evidence)
    expect(result.receipt).toEqual(submission.receipt)
    inspect(result.readState)
    expect(await allOwnedMaterial()).toBe(before)
    return result
  }
  test('successor admission exact item pending read preserves the original receipt and requires a decision', async () => {
    const submission = await submitPostLockEvidence(args())
    await expectPassiveItem(submission, value => {
      expect(value.impact).toEqual({ state: 'NOT_RECORDED', verification: { status: 'VERIFIED', reason: null },
        headHash: null, latestDecision: null, decisionCount: 0 })
      expect(value.admission).toEqual({ state: 'NOT_RECORDED', verification: { status: 'NOT_APPLICABLE', reason: null }, initialBasis: null })
      expect(value.actions.recordImpact).toEqual({ eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] })
      expect(value.actions.admission).toEqual({ eligibility: 'BLOCKED', blockedBy: ['POST_LOCK_ADMISSION_DECISION_REQUIRED'],
        operationalChecks: { indexes: 'NOT_CHECKED', execution: 'RECHECKED_ON_SUBMIT' } })
    })
  })
  test.each(Object.values(POST_LOCK_DISCOVERY_DISPOSITIONS))('successor admission exact item reviewed %s retains current head and action-specific meaning', async disposition => {
    const f = await prepareAdmission({ disposition })
    await expectPassiveItem(f.submission, value => {
      expect(value.impact).toMatchObject({ state: 'RECORDED', verification: { status: 'VERIFIED', reason: null },
        headHash: f.decision.observedHeadHash, latestDecision: { disposition, verified: true, isCurrent: true }, decisionCount: 1 })
      expect(value.admission.state).toBe('NOT_RECORDED')
      expect(value.actions.recordImpact).toEqual({ eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] })
      expect(value.actions.admission).toMatchObject(disposition === 'SUCCESSOR_REVISION_REQUIRED'
        ? { eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] }
        : { eligibility: 'BLOCKED', blockedBy: ['POST_LOCK_ADMISSION_DISPOSITION_BLOCKED'] })
      expect(value.actions.admission.operationalChecks).toEqual({ indexes: 'NOT_CHECKED', execution: 'RECHECKED_ON_SUBMIT' })
    })
  })
  test('successor admission exact item historical admission remains readable to a view-only caller without gaining authority', async () => {
    const f = await prepareAdmission(), result = await createRuntimeRevision(f.request), child = await childFor(result)
    const receipt = child.revision.postLockAdmission
    await expectPassiveItem(f.submission, value => {
      expect(value.admission).toMatchObject({ state: 'RECORDED', verification: { status: 'VERIFIED', reason: null },
        admissionId: receipt.admissionId, child: { runtimeInstanceId: String(child._id), runtimeInstanceKey: child.runtimeInstanceKey, revisionNumber: 2 },
        selectedDecision: { decisionHash: f.decision.observedHeadHash, disposition: 'SUCCESSOR_REVISION_REQUIRED' },
        initialBasis: { status: 'NOT_REVALIDATED', basisStateVersion: receipt.basis.basisStateVersion, membershipHash: receipt.basis.membershipHash } })
      expect(value.actions.recordImpact.blockedBy).toContain('VMF_UPDATE_REQUIRED')
      expect(value.actions.admission.blockedBy).toEqual(expect.arrayContaining(['VMF_UPDATE_REQUIRED', 'POST_LOCK_ADMISSION_ALREADY_RECORDED']))
      for (const key of ['signature', 'diff', 'postLockOrigin', 'request', 'ready', 'accepted', 'currentBasis']) expect(value.admission).not.toHaveProperty(key)
    }, ['VMF_VIEW'])
  })
  test('successor admission exact item keeps historical admission after later impact and ordinary child rollover', async () => {
    const f = await prepareAdmission(), created = await createRuntimeRevision(f.request), child = await childFor(created)
    const receipt = child.revision.postLockAdmission
    const later = await recordPostLockImpactDecision(nextDecision(f)), nextState = 'rsv2:123e4567-e89b-42d3-a456-426614174604'
    const next = JSON.parse(JSON.stringify(child.framework_state))
    next.evidence_pack.evidenceObjects.find(row => row.evidenceObjectId === `post-lock:${f.submission.submissionId}`).reviewStatus = 'REJECTED'
    const session = await mongoose.startSession()
    try { await session.withTransaction(async () => {
      await stageRuntimeStateSourceRollover({ runtimeInstance: child, expectedStateVersion: child.stateVersion,
        nextStateVersion: nextState, nextFrameworkState: next, mutationTimestamp: new Date().toISOString(), session })
      await RuntimeInstance.collection.updateOne({ _id: child._id, stateVersion: child.stateVersion },
        { $set: { stateVersion: nextState, framework_state: next } }, { session })
    }) } finally { await session.endSession() }
    await expectPassiveItem(f.submission, value => {
      expect(value.impact).toMatchObject({ state: 'RECORDED', headHash: later.observedHeadHash, decisionCount: 2,
        latestDecision: { disposition: 'CURRENTNESS_REVIEW_REQUIRED' } })
      expect(value.admission).toMatchObject({ state: 'RECORDED', selectedDecision: { decisionHash: f.decision.observedHeadHash },
        initialBasis: { status: 'NOT_REVALIDATED', basisStateVersion: receipt.target.stateVersion } })
      expect(value.admission.initialBasis.basisStateVersion).not.toBe(nextState)
      expect(value.actions.recordImpact).toEqual({ eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] })
      expect(value.actions.admission.blockedBy).toContain('POST_LOCK_ADMISSION_ALREADY_RECORDED')
    })
  })
  test.each(['reviewed', 'admitted'])('successor admission exact item %s remains readable after current policy revocation', async phase => {
    const f = await prepareAdmission()
    if (phase === 'admitted') await createRuntimeRevision(f.request)
    await FrameworkPackage.collection.updateOne({ _id: pack._id }, { $set: { 'discoveryPolicy.postLockDiscoveryPolicy.enabled': false } })
    await expectPassiveItem(f.submission, value => {
      expect(value.impact.state).toBe('RECORDED')
      expect(value.admission.state).toBe(phase === 'admitted' ? 'RECORDED' : 'NOT_RECORDED')
      expect(value.actions.recordImpact.blockedBy).toContain('POST_LOCK_IMPACT_POLICY_UNAVAILABLE')
      expect(value.actions.admission.blockedBy).toContain('POST_LOCK_ADMISSION_POLICY_UNAVAILABLE')
    })
  })
  test('successor admission exact item expired retention blocks admission but not a new impact conclusion', async () => {
    const f = await prepareAdmission({ mutate: input => { input.source.licensing.retainUntil = at } })
    await expectPassiveItem(f.submission, value => {
      expect(value.actions.recordImpact).toEqual({ eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] })
      expect(value.actions.admission.blockedBy).toContain('POST_LOCK_ADMISSION_RETENTION_BLOCKED')
    })
  })
  test.each(['missing', 'signature'])('successor admission exact item %s impact audit blocks both actions without a current head', async fault => {
    const f = await prepareAdmission(); await createRuntimeRevision(f.request)
    const id = new mongoose.Types.ObjectId(f.decision.decision.audit.id)
    if (fault === 'missing') await AuditLog.collection.deleteOne({ _id: id })
    else await AuditLog.collection.updateOne({ _id: id }, { $set: { signature: 'invalid-impact-signature' } })
    await expectPassiveItem(f.submission, value => {
      const reason = fault === 'missing' ? 'POST_LOCK_IMPACT_AUDIT_NOT_RECORDED' : 'POST_LOCK_IMPACT_AUDIT_UNVERIFIED'
      expect(value.impact).toMatchObject({ state: 'UNVERIFIED', verification: { status: 'UNVERIFIED', reason }, headHash: null, latestDecision: null })
      expect(value.admission.state).toBe('UNVERIFIED'); expect(value.admission).not.toHaveProperty('child')
      expect(value.actions.recordImpact.blockedBy).toContain(reason)
      expect(value.actions.admission.blockedBy).toContain(reason)
    })
  })
  test.each(['missing', 'signature', 'signed wrong parent'])('successor admission exact item %s admission audit blocks admission independently', async fault => {
    const f = await prepareAdmission(), created = await createRuntimeRevision(f.request), child = await childFor(created)
    const id = new mongoose.Types.ObjectId(child.revision.postLockAdmission.auditId)
    if (fault === 'missing') await AuditLog.collection.deleteOne({ _id: id })
    else if (fault === 'signature') await AuditLog.collection.updateOne({ _id: id }, { $set: { signature: 'invalid-admission-signature' } })
    else {
      const audit = AuditLog.hydrate(await AuditLog.collection.findOne({ _id: id }))
      audit.diff.sourceRuntimeInstance.id = String(oid(999)); audit.generateSignature()
      expect(audit.verifySignature()).toBe(true)
      await AuditLog.collection.replaceOne({ _id: id }, audit.toObject())
    }
    await expectPassiveItem(f.submission, value => {
      expect(value.impact.state).toBe('RECORDED')
      expect(value.admission).toEqual({ state: 'UNVERIFIED', verification: { status: 'UNVERIFIED',
        reason: fault === 'missing' ? 'POST_LOCK_ADMISSION_AUDIT_NOT_RECORDED' : 'POST_LOCK_ADMISSION_AUDIT_UNVERIFIED' }, initialBasis: null })
      expect(value.actions.recordImpact).toEqual({ eligibility: 'ELIGIBLE_AS_READ', blockedBy: [] })
      expect(value.actions.admission.blockedBy).toContain('POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
      expect(value.actions.recordImpact.blockedBy).not.toContain('POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
    })
  })
  test('successor admission exact item missing promised child is unverified rather than not recorded', async () => {
    const f = await prepareAdmission(), created = await createRuntimeRevision(f.request)
    await RuntimeInstance.collection.deleteOne({ _id: new mongoose.Types.ObjectId(created.runtimeInstance.id) })
    await expectPassiveItem(f.submission, value => {
      expect(value.admission).toEqual({ state: 'UNVERIFIED', verification: { status: 'UNVERIFIED', reason: 'POST_LOCK_ADMISSION_CHILD_UNAVAILABLE' }, initialBasis: null })
      expect(value.actions.recordImpact.eligibility).toBe('ELIGIBLE_AS_READ')
      expect(value.actions.admission.blockedBy).toContain('POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
    })
  })
  test('successor admission exact item one-sided child receipt cannot become an admitted link', async () => {
    const f = await prepareAdmission(); await createRuntimeRevision(f.request)
    await RuntimeEvidenceObject.collection.updateOne({ _id: (await pendingRow(f.submission))._id }, { $unset: { postLockAdmission: '' } })
    await expectPassiveItem(f.submission, value => {
      expect(value.admission).toEqual({ state: 'UNVERIFIED', verification: { status: 'UNVERIFIED', reason: 'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED' }, initialBasis: null })
      expect(value.actions.recordImpact.eligibility).toBe('ELIGIBLE_AS_READ')
    })
  })
  test('successor admission exact item ordinary child blocks a new admission without marking this item admitted', async () => {
    const f = await prepareAdmission(); await createRuntimeRevision({ ...f.request, payload: { expectedUpdatedAt: f.request.payload.expectedUpdatedAt, reason: 'Ordinary child.' } })
    await expectPassiveItem(f.submission, value => {
      expect(value.admission.state).toBe('NOT_RECORDED')
      expect(value.actions.admission.blockedBy).toContain('POST_LOCK_ADMISSION_CHILD_EXISTS')
    })
  })
  test('successor admission exact item another selected submission child does not admit this item', async () => {
    const first = await prepareAdmission(), second = await prepareAdmission({ mutate: input => { input.requestKey = '123e4567-e89b-42d3-a456-426614174605' } })
    await createRuntimeRevision(first.request)
    await expectPassiveItem(second.submission, value => {
      expect(value.admission.state).toBe('NOT_RECORDED')
      expect(value.actions.admission.blockedBy).toContain('POST_LOCK_ADMISSION_CHILD_EXISTS')
    })
  })
  test('successor admission exact item malformed retained impact chain rejects the whole read', async () => {
    const f = await prepareAdmission()
    await RuntimeEvidenceObject.collection.updateOne({ _id: (await pendingRow(f.submission))._id }, { $set: { 'postLockImpactHistory.headHash': '0'.repeat(64) } })
    const before = await allOwnedMaterial()
    await expect(readItem(f.submission)).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_IMPACT_HISTORY_INVALID' } })
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('successor admission exact item missing original intake audit keeps its protected failure', async () => {
    const f = await prepareAdmission()
    await AuditLog.collection.deleteOne({ _id: new mongoose.Types.ObjectId(f.submission.receipt.id) })
    const before = await allOwnedMaterial()
    await expect(readItem(f.submission)).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_RECEIPT_UNVERIFIED' } })
    expect(await allOwnedMaterial()).toBe(before)
  })
  test.each(['impact', 'admission'])('successor admission exact item rejected %s audit lookup is dependency failure rather than missing history', async owner => {
    const f = await prepareAdmission(), created = await createRuntimeRevision(f.request), child = await childFor(created)
    const before = await allOwnedMaterial(), method = owner === 'impact' ? 'find' : 'findOne'
    const original = AuditLog.collection[method].bind(AuditLog.collection)
    const spy = jest.spyOn(AuditLog.collection, method).mockImplementation((filter, ...rest) => {
      const selected = owner === 'impact' ? Boolean(filter._id?.$in) : String(filter._id) === child.revision.postLockAdmission.auditId
      if (!selected) return original(filter, ...rest)
      if (owner === 'admission') return Promise.reject(new Error('Private rejected admission dependency.'))
      const cursor = { limit: () => cursor, toArray: async () => { throw new Error('Private rejected impact dependency.') } }
      return cursor
    })
    try { await expect(readItem(f.submission)).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE',
      details: { reason: 'POST_LOCK_READ_STATE_DEPENDENCY_UNAVAILABLE' } }) }
    finally { spy.mockRestore() }
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('successor admission exact item audit verification stage enforces its cumulative byte cap before hydration', async () => {
    const f = await prepareAdmission()
    await AuditLog.collection.updateOne({ _id: new mongoose.Types.ObjectId(f.decision.decision.audit.id) }, { $set: { unexpectedAuditPadding: 'x'.repeat(512 * 1024) } })
    const before = await allOwnedMaterial()
    await expect(readItem(f.submission)).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_READ_STATE_AUDIT_CAPACITY_EXCEEDED' } })
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('successor admission exact item real controller returns one bounded view-only envelope at the declared scope seam', async () => {
    const f = await prepareAdmission(); await createRuntimeRevision(f.request)
    const [{ default: express }, { default: supertest }, { getRuntimePostLockEvidence }] = await Promise.all([
      import('express'), import('supertest'), import('../controllers/runtimeInstance.controller.js')])
    const app = express()
    app.use((req, _res, next) => { req.scopes = scopes(['VMF_VIEW']); req.context = { userId: String(oid(109)) };
      req.requestId = '123e4567-e89b-42d3-a456-426614174777'; next() })
    app.get('/runtime-instances/:runtimeInstanceId/post-lock-evidence/:submissionId', getRuntimePostLockEvidence)
    const before = await allOwnedMaterial()
    const response = await supertest(app).get(`/runtime-instances/${runtime.runtimeInstanceKey}/post-lock-evidence/${f.submission.submissionId}`)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ data: { status: 'PENDING_REVIEW', outsideFrozenMembership: true,
      readState: { admission: { state: 'RECORDED' }, actions: { recordImpact: { blockedBy: ['VMF_UPDATE_REQUIRED'] } } } },
      meta: { requestId: '123e4567-e89b-42d3-a456-426614174777', version: 'v1' } })
    expect(Buffer.byteLength(JSON.stringify(response.body))).toBeLessThanOrEqual(128 * 1024)
    expect(await allOwnedMaterial()).toBe(before)
  })

  test('successor admission provisions one normal draft candidate and preserves the nonempty frozen predecessor', async () => {
    const f = await prepareAdmission({ mutate: input => { input.evidence.statement = 'Synthetic  statement\nwith exact internal whitespace.' } })
    const before = await immutableAdmissionPredecessor(), pendingBefore = await pendingRow(f.submission)
    const sourceBefore = await RuntimeEvidenceSource.collection.findOne({ sourceId: `post-lock-source:${f.submission.submissionId}` })
    const result = await createRuntimeRevision(f.request), child = await childFor(result)
    expect(result.admission).toMatchObject({ contractVersion: POST_LOCK_ADMISSION_VERSION, replayed: false })
    expect(child).toMatchObject({ status: 'ACTIVE', framework_state: { lifecycle: { stage: 'DRAFT' },
      readiness: { ready: false }, publish: { published: false }, lock: { locked: false } } })
    expect(String(child.revision.parentRuntimeId)).toBe(String(runtime._id))
    expect(child.stateVersion).not.toBe(runtime.stateVersion)
    const receipt = parsePostLockAdmissionReceipt(child.revision.postLockAdmission)
    expect((await pendingRow(f.submission)).postLockAdmission).toEqual(receipt)
    const source = await RuntimeEvidenceSource.collection.findOne({ runtimeInstanceId: child._id, sourceId: `post-lock-source:${f.submission.submissionId}`, current: true })
    const evidence = await RuntimeEvidenceObject.collection.findOne({ runtimeInstanceId: child._id, evidenceObjectId: `post-lock:${f.submission.submissionId}`, current: true })
    expect(source.postLockOrigin).toEqual(evidence.postLockOrigin)
    expect(source.postLockOrigin.submission.source).toEqual(f.input.source)
    expect(evidence.postLockOrigin.submission.evidence).toEqual(f.input.evidence)
    expect(evidence.extractedFact).toBe(f.input.evidence.statement)
    expect(evidence).toMatchObject({ reviewStatus: 'PENDING', acceptanceState: 'CANDIDATE', stateVersion: child.stateVersion })
    expect(child.framework_state.evidence_pack).toMatchObject({ accepted: false, evidenceReady: false })
    expect(child.framework_state.evidence_pack.evidenceObjects.find(row => row.evidenceObjectId === evidence.evidenceObjectId).extractedFact)
      .toBe(f.input.evidence.statement)
    expect(await RuntimeEvidenceSource.countDocuments({ runtimeInstanceId: child._id, current: true })).toBe(2)
    expect(await RuntimeEvidenceObject.countDocuments({ runtimeInstanceId: child._id, current: true })).toBe(2)
    expect(await RuntimeGraphSnapshot.countDocuments({ runtimeInstanceId: child._id })).toBe(1)
    expect(await immutableAdmissionPredecessor()).toBe(before)
    expect(membershipHash(await RuntimeEvidenceSource.collection.findOne({ _id: sourceBefore._id }))).toBe(membershipHash(sourceBefore))
    const pendingAfter = await pendingRow(f.submission); delete pendingAfter.postLockAdmission
    expect(membershipHash(pendingAfter)).toBe(membershipHash(pendingBefore))
    expect(await readVerifiedRuntimeEvidenceSnapshot({ runtime, pointer })).toMatchObject({ membershipHash: pointer.membershipHash })
    expect(await AuditLog.countDocuments({ action: 'RUNTIME_REVISION_CREATED' })).toBe(1)
    for (const audit of await AuditLog.find()) expect(audit.verifySignature()).toBe(true)
  })

  test('successor admission public view-only reads retain exact historical origin without changing owned material', async () => {
    const f = await prepareAdmission({ mutate: input => {
      input.source.title = 'Synthetic historical source '.repeat(20).trim()
      input.evidence.title = 'Synthetic historical evidence '.repeat(20).trim()
      input.evidence.statement = 'Synthetic  statement\nwith exact\tinternal whitespace.'
    } })
    expect(f.input.evidence.title.length).toBeGreaterThan(300)
    const predecessorBefore = await immutableAdmissionPredecessor()
    const result = await createRuntimeRevision(f.request), child = await childFor(result)
    const sourceId = `post-lock-source:${f.submission.submissionId}`
    const evidenceObjectId = `post-lock:${f.submission.submissionId}`
    const source = await RuntimeEvidenceSource.collection.findOne({ runtimeInstanceId: child._id, sourceId, current: true })
    const evidence = await RuntimeEvidenceObject.collection.findOne({ runtimeInstanceId: child._id, evidenceObjectId, current: true })
    const beforeReads = await allOwnedMaterial()
    const readArgs = { scopes: scopes(['VMF_VIEW']), runtimeInstanceId: String(child._id), pageSize: 1, sourceId }
    const sourcePage = await listRuntimeStateSources(readArgs)
    const evidencePage = await listRuntimeStateEvidenceObjects({ ...readArgs, evidenceObjectId })

    expect(sourcePage).toMatchObject({ pageSize: 1, total: 1, stateVersion: child.stateVersion })
    expect(sourcePage.sourceRegistry).toHaveLength(1)
    expect(evidencePage).toMatchObject({ pageSize: 1, total: 1, stateVersion: child.stateVersion })
    expect(evidencePage.evidenceObjects).toHaveLength(1)
    expect(evidencePage.sourceRegistry).toHaveLength(1)
    expect(evidencePage.lineage.sources).toEqual(evidencePage.sourceRegistry)
    const publicSources = [...sourcePage.sourceRegistry, ...evidencePage.sourceRegistry, ...evidencePage.lineage.sources]
    for (const row of publicSources) {
      expect(row).toMatchObject({ sourceId, label: f.input.source.title, sourceRef: f.input.source.locator.url })
      expect(row.postLockOrigin).toEqual(source.postLockOrigin)
      expect(row.postLockOrigin.submission.source).toEqual(f.input.source)
    }
    const publicEvidence = evidencePage.evidenceObjects[0]
    expect(publicEvidence).toMatchObject({ evidenceObjectId, sourceId, title: f.input.evidence.title,
      extractedFact: f.input.evidence.statement, sourceLocation: f.input.source.locator,
      reviewStatus: 'PENDING', acceptanceState: 'CANDIDATE' })
    expect(publicEvidence.postLockOrigin).toEqual(evidence.postLockOrigin)
    expect(publicEvidence.postLockOrigin.submission.evidence).toEqual(f.input.evidence)
    expect(publicEvidence.postLockOrigin).toEqual(source.postLockOrigin)
    for (const row of [...publicSources, publicEvidence]) {
      for (const key of ['postLockAssociation', 'postLockImpactHistory', 'postLockAdmission']) expect(row).not.toHaveProperty(key)
    }
    // Public origins are retained historical material, not a fresh audit or admission verdict.
    expect(await allOwnedMaterial()).toBe(beforeReads)
    expect(await immutableAdmissionPredecessor()).toBe(predecessorBefore)
  })

  test('successor admission exact retry is a passive historical result after a later impact decision', async () => {
    const f = await prepareAdmission(), first = await createRuntimeRevision(f.request)
    await recordPostLockImpactDecision(nextDecision(f))
    const before = await allOwnedMaterial(), replay = await createRuntimeRevision(f.request)
    expect(replay.admission).toMatchObject({ replayed: true, admissionId: first.admission.admissionId })
    expect(replay.runtimeInstance.id).toBe(first.runtimeInstance.id)
    expect(await allOwnedMaterial()).toBe(before)
    expect((await pendingRow(f.submission)).postLockImpactHistory.entries).toHaveLength(2)
  })

  test('successor admission historical replay survives a normal child source rollover and review change', async () => {
    const f = await prepareAdmission(), first = await createRuntimeRevision(f.request), child = await childFor(first)
    const originalReceipt = child.revision.postLockAdmission, nextState = 'rsv2:123e4567-e89b-42d3-a456-426614174603'
    const next = JSON.parse(JSON.stringify(child.framework_state))
    const predecessorBefore = await immutableAdmissionPredecessor()
    next.evidence_pack = await buildDiscoveryEvidencePack({ acquisitionProfile: 'STANDARD', actorUserId: oid(109),
      runtimeInstance: child, previousEvidencePack: next.evidence_pack,
      inputs: { companyName: 'Synthetic', marketRegion: 'Synthetic', targetOffer: 'Synthetic', companyWebsite: '', notes: '' } })
    const admittedId = `post-lock:${f.submission.submissionId}`
    expect(next.evidence_pack.evidenceObjects.filter(row => row.evidenceObjectId === admittedId)).toHaveLength(1)
    expect(next.evidence_pack.sourceRegistry.filter(row => row.postLockOrigin)).toHaveLength(1)
    expect(next.evidence_pack.lineage.sources.filter(row => row.postLockOrigin)).toHaveLength(1)
    next.evidence_pack.evidenceObjects.find(row => row.evidenceObjectId === `post-lock:${f.submission.submissionId}`).reviewStatus = 'REJECTED'
    const session = await mongoose.startSession()
    try { await session.withTransaction(async () => {
      await stageRuntimeStateSourceRollover({ runtimeInstance: child, expectedStateVersion: child.stateVersion,
        nextStateVersion: nextState, nextFrameworkState: next, mutationTimestamp: new Date().toISOString(), session })
      await RuntimeInstance.collection.updateOne({ _id: child._id, stateVersion: child.stateVersion },
        { $set: { stateVersion: nextState, framework_state: next } }, { session })
    }) } finally { await session.endSession() }
    const active = await RuntimeEvidenceObject.collection.findOne({ runtimeInstanceId: child._id, current: true, evidenceObjectId: admittedId })
    expect(active).toMatchObject({ stateVersion: nextState, reviewStatus: 'REJECTED', postLockOrigin: child.framework_state.evidence_pack.evidenceObjects.find(row => row.evidenceObjectId === admittedId).postLockOrigin })
    expect(await immutableAdmissionPredecessor()).toBe(predecessorBefore)
    const before = await allOwnedMaterial(), replay = await createRuntimeRevision(f.request)
    expect(replay.admission.replayed).toBe(true)
    expect(replay.runtimeInstance.stateVersion).toBe(nextState)
    expect((await childFor(replay)).revision.postLockAdmission).toEqual(originalReceipt)
    expect(await allOwnedMaterial()).toBe(before)
  })

  test.each(['actor', 'rationale', 'revision-reason', 'revision-timestamp'])('successor admission replay rejects changed %s without touching the winner', async fault => {
    const f = await prepareAdmission(); await createRuntimeRevision(f.request)
    const changed = JSON.parse(JSON.stringify(f.request)), before = await allOwnedMaterial()
    expect(parsePostLockAdmissionRequest(changed.payload.postLockAdmission)).toEqual(f.request.payload.postLockAdmission)
    if (fault === 'actor') changed.actorUserId = String(oid(111))
    if (fault === 'rationale') changed.payload.postLockAdmission.rationale = 'Changed admission rationale under the same key.'
    if (fault === 'revision-reason') changed.payload.reason = 'Changed normal revision reason.'
    if (fault === 'revision-timestamp') changed.payload.expectedUpdatedAt = '2026-11-06T12:00:00.001Z'
    await expect(createRuntimeRevision(changed)).rejects.toMatchObject({ status: 409,
      details: { reason: 'POST_LOCK_ADMISSION_IDEMPOTENCY_CONFLICT' } })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test.each(['NO_REVISION_IMPACT', 'CORROBORATIVE', 'CURRENTNESS_REVIEW_REQUIRED'])('successor admission rejects latest %s with no child or receipt', async disposition => {
    const f = await prepareAdmission({ disposition }), before = await allOwnedMaterial()
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 409,
      details: { reason: 'POST_LOCK_ADMISSION_DISPOSITION_BLOCKED' } })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test.each(['binding', 'digest', 'head'])('successor admission rejects stale %s without partial native rows', async fault => {
    const f = await prepareAdmission(), selected = f.request.payload.postLockAdmission, before = await allOwnedMaterial()
    if (fault === 'binding') selected.expectedBinding = { ...selected.expectedBinding, membershipHash: '0'.repeat(64) }
    if (fault === 'digest') selected.expectedSubmissionDigest = '0'.repeat(64)
    if (fault === 'head') selected.expectedImpactHeadHash = '0'.repeat(64)
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 409, details: { reason: 'POST_LOCK_ADMISSION_STALE' } })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test('successor admission review-only policy records impact but cannot acquire admission authority', async () => {
    const f = await prepareAdmission(), before = await allOwnedMaterial()
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 409,
      details: { reason: 'POST_LOCK_ADMISSION_POLICY_UNAVAILABLE' } })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test('successor admission view-only caller cannot create a successor or gain new access', async () => {
    const f = await prepareAdmission(), before = await allOwnedMaterial()
    f.request.scopes = scopes(['VMF_VIEW'])
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test('successor admission preserves an ordinary existing child rather than adopting it as an admission', async () => {
    const f = await prepareAdmission()
    await createRuntimeRevision({ ...f.request, payload: { expectedUpdatedAt: f.request.payload.expectedUpdatedAt, reason: 'Ordinary explicit revision.' } })
    const before = await allOwnedMaterial()
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 409,
      details: { reason: 'POST_LOCK_ADMISSION_CHILD_EXISTS' } })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test.each(['audit', 'fence'])('successor admission %s failure rolls back child, native rows and receipt', async fault => {
    const f = await prepareAdmission(), before = await allOwnedMaterial()
    if (fault === 'audit') {
      const original = auditService.log.bind(auditService)
      jest.spyOn(auditService, 'log').mockImplementation((data, options) => data.action === 'RUNTIME_REVISION_CREATED'
        ? Promise.reject(new Error('Owned synthetic revision audit failure')) : original(data, options))
    } else {
      const original = RuntimeEvidenceObject.collection.updateOne.bind(RuntimeEvidenceObject.collection)
      jest.spyOn(RuntimeEvidenceObject.collection, 'updateOne').mockImplementation((filter, update, options) => update.$set?.postLockAdmission
        ? Promise.resolve({ matchedCount: 0, modifiedCount: 0 }) : original(filter, update, options))
    }
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: fault === 'audit' ? 503 : 409,
      details: { reason: fault === 'audit' ? 'POST_LOCK_ADMISSION_AUDIT_WRITE_FAILED' : 'POST_LOCK_ADMISSION_STALE' } })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test.each(['same-key', 'different-key'])('successor admission real concurrent %s callers commit one child and required audit', async mode => {
    const f = await prepareAdmission(), other = JSON.parse(JSON.stringify(f.request))
    expect(parsePostLockAdmissionRequest(other.payload.postLockAdmission)).toEqual(f.request.payload.postLockAdmission)
    if (mode === 'different-key') other.payload.postLockAdmission.requestKey = '123e4567-e89b-42d3-a456-426614174604'
    const results = await Promise.allSettled([createRuntimeRevision(f.request), createRuntimeRevision(other)])
    if (mode === 'same-key') {
      expect(results.every(result => result.status === 'fulfilled')).toBe(true)
      expect(results.filter(result => result.value.admission.replayed === false)).toHaveLength(1)
      expect(new Set(results.map(result => result.value.runtimeInstance.id)).size).toBe(1)
    } else {
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ status: 409,
        details: { reason: 'POST_LOCK_ADMISSION_IDEMPOTENCY_CONFLICT' } })
    }
    expect(await RuntimeInstance.countDocuments({ 'revision.parentRuntimeId': oid(101) })).toBe(1)
    expect(await AuditLog.countDocuments({ action: 'RUNTIME_REVISION_CREATED' })).toBe(1)
  })

  test('successor admission missing historical initial rows rejects replay without creating a replacement', async () => {
    const f = await prepareAdmission(), first = await createRuntimeRevision(f.request), child = await childFor(first)
    await RuntimeEvidenceSource.collection.deleteOne({ runtimeInstanceId: child._id, sourceId: 'original-source', stateVersion: child.stateVersion })
    const before = await allOwnedMaterial()
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 503,
      details: { reason: 'POST_LOCK_ADMISSION_READBACK_INVALID' } })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test('successor admission mounted normal revision controller returns a child DTO201 and exact replay200 at the explicit scope seam', async () => {
    const f = await prepareAdmission()
    const { default: express } = await import('express'), { default: supertest } = await import('supertest')
    const { createRuntimeRevision: controller } = await import('../controllers/runtimeInstance.controller.js')
    const { validateCreateRuntimeRevision } = await import('../validators/runtimeInstance.validator.js')
    const app = express()
    app.use(express.json())
    // Real validator/controller/service/database transport at a declared auth
    // seam. This does not authenticate a native JWT or grant an actual account.
    app.use((req, _res, next) => { req.scopes = scopes(); req.context = { userId: String(oid(109)) };
      req.requestId = 'owned-ss056-admission-mounted'; next() })
    app.post('/runtime-instances/:runtimeInstanceId/revisions', validateCreateRuntimeRevision, controller)
    const url = `/runtime-instances/${runtime.runtimeInstanceKey}/revisions`
    const created = await supertest(app).post(url).send(f.request.payload)
    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({ status: 'ACTIVE', revision: { revisionNumber: 2 } })
    expect(created.body.data).not.toHaveProperty('runtimeInstance')
    expect(created.body.meta).toMatchObject({ version: 'v1', admission: {
      contractVersion: POST_LOCK_ADMISSION_VERSION, replayed: false,
    } })
    const before = await allOwnedMaterial(), replay = await supertest(app).post(url).send(f.request.payload)
    expect(replay.status).toBe(200)
    expect(replay.body.data.id).toBe(created.body.data.id)
    expect(replay.body.data).not.toHaveProperty('runtimeInstance')
    expect(replay.body.meta.admission).toMatchObject({ contractVersion: POST_LOCK_ADMISSION_VERSION,
      admissionId: created.body.meta.admission.admissionId, replayed: true })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test.each(['missing', 'corrupt'])('successor admission referenced history %s target blocks historical replay without resealing the initial basis', async fault => {
    const f = await prepareAdmission(), first = await createRuntimeRevision(f.request), child = await childFor(first)
    const current = await RuntimeStateSection.collection.findOne({ runtimeInstanceId: child._id, current: true,
      stateVersion: child.stateVersion, sectionKey: 'customer_context' })
    const ref = current.sectionDetail.revisions.find(record => record.historyReference)?.historyReference
    expect(ref).toBeDefined()
    const target = await RuntimeStateSection.collection.findOne({ runtimeInstanceId: child._id, current: false,
      sectionKey: current.sectionKey, stateVersion: ref.stateVersion, sourceHash: ref.sourceHash })
    expect(target).not.toBeNull()
    expect((await createRuntimeRevision(f.request)).admission.replayed).toBe(true)
    const originalReceipt = JSON.stringify(child.revision.postLockAdmission)
    if (fault === 'missing') await RuntimeStateSection.collection.deleteOne({ _id: target._id })
    else await RuntimeStateSection.collection.updateOne({ _id: target._id }, { $set: {
      [ref.index === -1 ? 'sectionDetail.generated.summary' : `sectionDetail.revisions.${ref.index}.generated.summary`]: 'Corrupted owned history material.',
    } })
    const before = await allOwnedMaterial()
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 503,
      details: { reason: 'POST_LOCK_ADMISSION_READBACK_INVALID' } })
    expect(await allOwnedMaterial()).toBe(before)
    expect(JSON.stringify((await childFor(first)).revision.postLockAdmission)).toBe(originalReceipt)
    expect(await RuntimeInstance.countDocuments({ 'revision.parentRuntimeId': runtime._id })).toBe(1)
  })

  test('successor admission expired retained licence refuses copying material into the successor', async () => {
    const f = await prepareAdmission({ mutate: input => { input.source.licensing.retainUntil = at } })
    const before = await allOwnedMaterial()
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 409,
      details: { reason: 'POST_LOCK_ADMISSION_RETENTION_BLOCKED' } })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test('successor admission a valid model-signed audit naming the wrong parent cannot verify a committed replay', async () => {
    const f = await prepareAdmission(), result = await createRuntimeRevision(f.request), child = await childFor(result)
    const auditId = new mongoose.Types.ObjectId(child.revision.postLockAdmission.auditId)
    const raw = await AuditLog.collection.findOne({ _id: auditId })
    expect(raw.scope).not.toHaveProperty('sourceRuntimeInstanceId')
    expect(raw.diff.sourceRuntimeInstance.id).toBe(String(runtime._id))
    expect(AuditLog.hydrate(raw).verifySignature()).toBe(true)
    // Deliberate privileged corruption of this one owned synthetic record only.
    // The application offers no audit-edit operation. Use the actual model's
    // signature method so parent matching is tested independently of bad HMAC.
    const altered = AuditLog.hydrate(raw)
    altered.diff = { ...raw.diff, sourceRuntimeInstance: { ...raw.diff.sourceRuntimeInstance, id: String(oid(999)) } }
    altered.generateSignature()
    expect(altered.verifySignature()).toBe(true)
    await AuditLog.collection.updateOne({ _id: auditId }, { $set: { diff: altered.diff, signature: altered.signature } })
    const persisted = await AuditLog.collection.findOne({ _id: auditId })
    expect(persisted.diff.sourceRuntimeInstance.id).toBe(String(oid(999)))
    expect(AuditLog.hydrate(persisted).verifySignature()).toBe(true)
    const before = await allOwnedMaterial()
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 503,
      details: { reason: 'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED' } })
    expect(await allOwnedMaterial()).toBe(before)
    expect(await RuntimeInstance.countDocuments({ 'revision.parentRuntimeId': runtime._id })).toBe(1)
  })

  test('successor admission missing parent unique index refuses creation and restores only the owned index', async () => {
    const f = await prepareAdmission(), before = await allOwnedMaterial()
    const index = (await RuntimeInstance.collection.indexes()).find(item => item.unique === true && item.key['revision.parentRuntimeId'] === 1)
    expect(index).toBeDefined()
    await RuntimeInstance.collection.dropIndex(index.name)
    try {
      await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 503,
        details: { reason: 'POST_LOCK_ADMISSION_INDEX_REQUIRED' } })
      expect(await allOwnedMaterial()).toBe(before)
    } finally { await RuntimeInstance.createIndexes() }
  })

  test.each(['signature', 'missing'])('successor admission %s impact audit cannot become a current verified head', async fault => {
    const f = await prepareAdmission(), id = new mongoose.Types.ObjectId(f.decision.decision.audit.id)
    if (fault === 'signature') await AuditLog.collection.updateOne({ _id: id }, { $set: { signature: 'invalid-owned-fixture-signature' } })
    else await AuditLog.collection.deleteOne({ _id: id })
    const before = await allOwnedMaterial()
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 503,
      details: { reason: fault === 'signature' ? 'POST_LOCK_IMPACT_AUDIT_UNVERIFIED' : 'POST_LOCK_IMPACT_AUDIT_NOT_RECORDED' } })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test('successor admission rejected impact audit dependency propagates instead of becoming empty history', async () => {
    const f = await prepareAdmission(), before = await allOwnedMaterial()
    jest.spyOn(AuditLog.collection, 'find').mockReturnValue({ limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockRejectedValue(new Error('Owned synthetic impact lookup unavailable')) })
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 503,
      details: { reason: 'POST_LOCK_IMPACT_READ_UNAVAILABLE' } })
    jest.restoreAllMocks()
    expect(await allOwnedMaterial()).toBe(before)
  })

  test('successor admission actual provisioning insert failure rolls every staged row back', async () => {
    const f = await prepareAdmission(), before = await allOwnedMaterial()
    jest.spyOn(RuntimeGraphSnapshot, 'insertMany').mockRejectedValue(new Error('Owned synthetic provisioning insert failure'))
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 503,
      details: { reason: 'POST_LOCK_ADMISSION_STORAGE_UNAVAILABLE' } })
    expect(await allOwnedMaterial()).toBe(before)
  })

  test('successor admission native basis read failure aborts provisional native rows without an audit', async () => {
    const f = await prepareAdmission(), before = await allOwnedMaterial()
    const original = RuntimeEvidenceSource.collection.find.bind(RuntimeEvidenceSource.collection)
    const rejectBasisRead = jest.fn().mockRejectedValue(new Error('Owned synthetic child basis read unavailable'))
    jest.spyOn(RuntimeEvidenceSource.collection, 'find').mockImplementation((filter, options) => {
      if (String(filter.customerId) === String(runtime.customerId) && String(filter.tenantId) === String(runtime.tenantId)
        && filter.runtimeInstanceId && String(filter.runtimeInstanceId) !== String(runtime._id)
        && typeof filter.runtimeInstanceKey === 'string' && filter.runtimeInstanceKey !== runtime.runtimeInstanceKey
        && typeof filter.stateVersion === 'string' && RUNTIME_STATE_VERSION_PATTERN.test(filter.stateVersion)) return {
        sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
        toArray: rejectBasisRead,
      }
      return original(filter, options)
    })
    await expect(createRuntimeRevision(f.request)).rejects.toMatchObject({ status: 503,
      details: { reason: 'POST_LOCK_ADMISSION_READ_UNAVAILABLE' } })
    expect(rejectBasisRead).toHaveBeenCalled()
    jest.restoreAllMocks()
    expect(await allOwnedMaterial()).toBe(before)
  })

  test('successor admission two different pending selections compete for the existing single-child boundary', async () => {
    const first = await prepareAdmission()
    const other = await prepareAdmission({ mutate: input => { input.requestKey = '123e4567-e89b-42d3-a456-426614174605' } })
    other.request.payload.postLockAdmission.requestKey = '123e4567-e89b-42d3-a456-426614174606'
    const results = await Promise.allSettled([createRuntimeRevision(first.request), createRuntimeRevision(other.request)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ status: 409,
      details: { reason: 'POST_LOCK_ADMISSION_CHILD_EXISTS' } })
    expect(await RuntimeInstance.countDocuments({ 'revision.parentRuntimeId': oid(101) })).toBe(1)
    expect(await AuditLog.countDocuments({ action: 'RUNTIME_REVISION_CREATED' })).toBe(1)
    expect(await RuntimeEvidenceObject.countDocuments({ runtimeInstanceId: oid(101), postLockAdmission: { $exists: true } })).toBe(1)
  })

  test('successor admission waits behind an ordinary winner without leaving a pending claim', async () => {
    const f = await prepareAdmission()
    const ordinary = { ...f.request, payload: { expectedUpdatedAt: f.request.payload.expectedUpdatedAt, reason: 'Ordinary winner.' } }
    const original = RuntimeInstance.prototype.save
    let release, reached, held = false
    const released = new Promise(resolve => { release = resolve }), waiting = new Promise(resolve => { reached = resolve })
    jest.spyOn(RuntimeInstance.prototype, 'save').mockImplementation(async function (options) {
      if (this.revision?.postLockAdmission && !held) { held = true; reached(); await released }
      return original.call(this, options)
    })
    const delayed = createRuntimeRevision(f.request).then(value => ({ value }), error => ({ error }))
    try {
      await waitForBarrier(waiting)
      await createRuntimeRevision(ordinary)
      const before = await allOwnedMaterial()
      release()
      expect((await delayed).error).toMatchObject({ status: 409, details: { reason: 'POST_LOCK_ADMISSION_CHILD_EXISTS' } })
      expect(await allOwnedMaterial()).toBe(before)
      expect((await pendingRow(f.submission)).postLockAdmission).toBeUndefined()
    } finally { release(); await delayed }
  }, 30000)

  test.each(['impact-first', 'admission-first'])('successor admission real head fence orders %s commits', async order => {
    const f = await prepareAdmission(), original = RuntimeEvidenceObject.collection.updateOne.bind(RuntimeEvidenceObject.collection)
    let release, reached, held = false
    const released = new Promise(resolve => { release = resolve }), waiting = new Promise(resolve => { reached = resolve })
    jest.spyOn(RuntimeEvidenceObject.collection, 'updateOne').mockImplementation(async (filter, update, options) => {
      const selected = order === 'impact-first' ? update.$set?.postLockAdmission : update.$set?.postLockImpactHistory
      if (selected && !held) { held = true; reached(); await released }
      return original(filter, update, options)
    })
    const delayed = order === 'impact-first'
      ? createRuntimeRevision(f.request).then(value => ({ value }), error => ({ error }))
      : recordPostLockImpactDecision(nextDecision(f)).then(value => ({ value }), error => ({ error }))
    try {
      await waitForBarrier(waiting)
      if (order === 'impact-first') {
        await recordPostLockImpactDecision(nextDecision(f))
        release()
        expect((await delayed).error).toMatchObject({ status: 409, details: { reason: 'POST_LOCK_ADMISSION_STALE' } })
        expect(await RuntimeInstance.countDocuments({ 'revision.parentRuntimeId': oid(101) })).toBe(0)
        expect((await pendingRow(f.submission)).postLockAdmission).toBeUndefined()
      } else {
        const admitted = await createRuntimeRevision(f.request), receipt = (await childFor(admitted)).revision.postLockAdmission
        release()
        expect((await delayed).value.decision.disposition).toBe('CURRENTNESS_REVIEW_REQUIRED')
        expect((await pendingRow(f.submission)).postLockAdmission).toEqual(receipt)
        expect((await pendingRow(f.submission)).postLockImpactHistory.entries).toHaveLength(2)
      }
    } finally { release(); await delayed }
  }, 30000)

  // Receipt-list additions preserve all100 preceding cases and exact owned guards.
  const listArgs = (query = {}, permissions) => ({ ...args(undefined, permissions), query: {
    customerId: String(oid(102)), tenantId: String(oid(103)), ...query,
  } })
  const listRead = (query, permissions) => listPostLockEvidence(listArgs(query, permissions))
  const submitNumber = async (number, input = payload()) => {
    input.requestKey = '123e4567-e89b-42d3-a456-' + String(900 + number).padStart(12, '0')
    return submitPostLockEvidence(args(input))
  }
  const listPassive = async (query, permissions) => {
    const before = await allOwnedMaterial(), result = await listRead(query, permissions)
    expect(await allOwnedMaterial()).toBe(before)
    return result
  }
  const maximumListInput = number => {
    const value = payload()
    value.requestKey = '123e4567-e89b-42d3-a456-' + String(900 + number).padStart(12, '0')
    value.source.title = '漢'.repeat(1000); value.evidence.title = '漢'.repeat(1000)
    value.evidence.statement = '漢"\\'.repeat(1999)
    value.source.qualifications = Array.from({ length: 20 }, (_, i) => String(i).padStart(2, '0') + '漢'.repeat(498))
    value.reason = '漢'.repeat(2000)
    let low = 1, high = 4000
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      value.source.locator.passage = '\u0001'.repeat(mid)
      if (postLockSubmissionSchema.safeParse(value).success) low = mid
      else high = mid - 1
    }
    value.source.locator.passage = '\u0001'.repeat(low)
    const parsed = parsePostLockSubmission(value), bytes = Buffer.byteLength(JSON.stringify(parsed))
    expect(bytes).toBeGreaterThan(65520); expect(bytes).toBeLessThanOrEqual(65536)
    return parsed
  }
  test('receipt list verified empty page is passive and does not load detail', async () => {
    const result = await listPassive({}, ['VMF_VIEW'])
    expect(result).toMatchObject({ contractVersion: 'post-lock-evidence-list.v1', currency: 'AS_READ',
      population: 'ORIGINAL_POST_LOCK_SUBMISSION_RECEIPTS', items: [], pagination: { pageSize: 5, hasMore: false, nextCursor: null } })
    expect(result).not.toHaveProperty('pendingCount'); expect(result).not.toHaveProperty('total')
  })
  test('receipt list one item retains full titles and historical original receipt only', async () => {
    const input = payload(); input.source.title = 'Source ' + '漢'.repeat(900); input.evidence.title = 'Evidence ' + '漢'.repeat(900)
    const saved = await submitNumber(1, input), result = await listPassive({ pageSize: 1 }, ['VMF_VIEW'])
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual({ submissionId: saved.submissionId, submittedAt: saved.submittedAt, submittedBy: saved.submittedBy,
      evidenceTitle: saved.evidence.title, source: { sourceId: saved.source.sourceId, sourceType: saved.source.sourceType, title: saved.source.title },
      originalIntake: { recordedStatus: 'PENDING_REVIEW', outsideFrozenMembership: true, receipt: saved.receipt },
      detail: { contractVersion: 'post-lock-evidence-read-state.v1', impact: 'NOT_LOADED', admission: 'NOT_LOADED' } })
    expect(result.pagination).toEqual({ pageSize: 1, hasMore: false, nextCursor: null })
  })
  test('receipt list lexical keyset pages have no duplicate or omitted committed receipt', async () => {
    const saved = await Promise.all([1, 2, 3].map(n => submitNumber(n)))
    const before = await allOwnedMaterial(), seen = []; let cursor
    for (let i = 0; i < 3; i++) {
      const result = await listRead({ pageSize: 1, ...(cursor ? { cursor } : {}) })
      expect(result.items).toHaveLength(1); seen.push(result.items[0].submissionId)
      expect(result.pagination.hasMore).toBe(i < 2)
      cursor = result.pagination.nextCursor
    }
    expect(cursor).toBeNull(); expect(seen).toEqual(saved.map(x => x.submissionId).sort())
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('receipt list policy removal does not erase receipts or invalidate the original basis cursor', async () => {
    await submitNumber(1); await submitNumber(2)
    const first = await listRead({ pageSize: 1 })
    await FrameworkPackage.collection.updateOne({ _id: oid(104) }, { $unset: { discoveryPolicy: '' } })
    const result = await listPassive({ pageSize: 1, cursor: first.pagination.nextCursor }, ['VMF_VIEW'])
    expect(result.items).toHaveLength(1); expect(result.basis).toEqual(first.basis)
  })
  test('receipt list successor admission leaves the original submission discoverable', async () => {
    const f = await prepareAdmission(); await createRuntimeRevision(f.request)
    const result = await listPassive({}, ['VMF_VIEW'])
    expect(result.items.map(x => x.submissionId)).toEqual([f.submission.submissionId])
    expect(result.items[0].originalIntake.recordedStatus).toBe('PENDING_REVIEW')
    expect(result.items[0].detail).toEqual({ contractVersion: 'post-lock-evidence-read-state.v1', impact: 'NOT_LOADED', admission: 'NOT_LOADED' })
  })
  test.each(['current marker', 'missing source', 'missing audit', 'wrong material', 'bad signature', 'native origin'])('receipt list observed %s fails closed without a partial page', async fault => {
    const saved = await submitNumber(1), evidence = await pendingRow(saved)
    if (fault === 'current marker') await RuntimeEvidenceObject.collection.updateOne({ _id: evidence._id }, { $set: { current: true } })
    if (fault === 'missing source') await RuntimeEvidenceSource.collection.deleteOne({ sourceId: evidence.sourceId })
    if (fault === 'missing audit') await AuditLog.collection.deleteOne({ _id: new mongoose.Types.ObjectId(saved.receipt.id) })
    if (fault === 'wrong material') await RuntimeEvidenceObject.collection.updateOne({ _id: evidence._id }, { $set: { extractedFact: 'Contradictory stored statement.' } })
    if (fault === 'bad signature') await AuditLog.collection.updateOne({ _id: new mongoose.Types.ObjectId(saved.receipt.id) }, { $set: { signature: '0'.repeat(64) } })
    if (fault === 'native origin') await RuntimeEvidenceObject.collection.updateOne({ _id: evidence._id }, { $set: { postLockOrigin: {} } })
    const before = await allOwnedMaterial()
    await expect(listRead()).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_RECEIPT_UNVERIFIED' } })
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('receipt list invalid lookahead refuses the whole page rather than asserting hasMore', async () => {
    const saved = await Promise.all([1, 2].map(n => submitNumber(n))), last = saved.sort((a, b) => a.submissionId.localeCompare(b.submissionId))[1]
    await AuditLog.collection.deleteOne({ _id: new mongoose.Types.ObjectId(last.receipt.id) })
    const before = await allOwnedMaterial()
    await expect(listRead({ pageSize: 1 })).rejects.toMatchObject({ status: 503, details: { reason: 'POST_LOCK_RECEIPT_UNVERIFIED' } })
    expect(await allOwnedMaterial()).toBe(before)
  })
  test.each(['source', 'audit'])('receipt list rejected %s batch returns safe dependency failure', async owner => {
    await submitNumber(1)
    const model = owner === 'source' ? RuntimeEvidenceSource : AuditLog, original = model.collection.find.bind(model.collection)
    const before = await allOwnedMaterial()
    const spy = jest.spyOn(model.collection, 'find').mockImplementation((filter, ...rest) => {
      if (!(owner === 'source' ? filter.sourceId?.$in : filter._id?.$in)) return original(filter, ...rest)
      const cursor = { sort: () => cursor, limit: () => cursor, batchSize: () => cursor,
        toArray: async () => { throw Object.assign(new Error('Private rejected batch detail.'), { status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'UNKNOWN_DEPENDENCY' } }) } }
      return cursor
    })
    try { await expect(listRead()).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_EVIDENCE_LIST_DEPENDENCY_UNAVAILABLE' } }) }
    finally { spy.mockRestore() }
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('receipt list valid maximum escaped Unicode page1 and verified lookahead fit declared bounds', async () => {
    const first = await submitNumber(1, maximumListInput(1)), second = await submitNumber(2, maximumListInput(2))
    const result = await listPassive({ pageSize: 1 })
    expect(result.items).toHaveLength(1); expect(result.pagination.hasMore).toBe(true)
    expect([first.submissionId, second.submissionId]).toContain(result.items[0].submissionId)
    expect(result.items[0].source.title).toHaveLength(1000); expect(result.items[0].evidenceTitle).toHaveLength(1000)
  })
  test('receipt list oversized valid page fails without truncation and permits smaller page refresh', async () => {
    for (let n = 1; n <= 11; n++) await submitNumber(n, maximumListInput(n))
    const before = await allOwnedMaterial()
    await expect(listRead({ pageSize: 10 })).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE',
      details: { reason: 'POST_LOCK_EVIDENCE_LIST_MATERIAL_CAPACITY_EXCEEDED' } })
    const smaller = await listRead({ pageSize: 1 })
    expect(smaller.items).toHaveLength(1); expect(smaller.pagination.hasMore).toBe(true)
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('receipt list large validly resealed intake audit fails the declared cumulative audit bound', async () => {
    const saved = await submitNumber(1), raw = await AuditLog.collection.findOne({ _id: new mongoose.Types.ObjectId(saved.receipt.id) })
    const audit = AuditLog.hydrate(raw); audit.userAgent = 'x'.repeat(512 * 1024); audit.generateSignature()
    expect(audit.verifySignature()).toBe(true)
    await AuditLog.collection.replaceOne({ _id: raw._id }, audit.toObject({ depopulate: true }))
    const before = await allOwnedMaterial()
    await expect(listRead()).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'POST_LOCK_EVIDENCE_LIST_AUDIT_CAPACITY_EXCEEDED' } })
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('receipt list actual controller returns bounded VIEW envelope at the declared auth seam', async () => {
    const saved = await submitNumber(1)
    const [{ default: express }, { default: supertest }, { getRuntimePostLockEvidenceList }] = await Promise.all([
      import('express'), import('supertest'), import('../controllers/runtimeInstance.controller.js')])
    const app = express()
    app.use((req, _res, next) => { req.scopes = scopes(['VMF_VIEW']); req.context = { userId: String(oid(109)) }; req.requestId = '123e4567-e89b-42d3-a456-426614174778'; next() })
    app.get('/runtime-instances/:runtimeInstanceId/post-lock-evidence', getRuntimePostLockEvidenceList)
    const before = await allOwnedMaterial(), response = await supertest(app).get('/runtime-instances/' + runtime.runtimeInstanceKey + '/post-lock-evidence')
      .query({ customerId: String(oid(102)), tenantId: String(oid(103)), pageSize: 1 })
    expect(response.status).toBe(200); expect(response.body.data.items[0].submissionId).toBe(saved.submissionId)
    expect(response.body.meta.version).toBe('v1'); expect(Buffer.byteLength(JSON.stringify(response.body))).toBeLessThanOrEqual(128 * 1024)
    expect(await allOwnedMaterial()).toBe(before)
  })


  // Only owned synthetic fixture state is made lock-eligible here. This calls
  // the real membership/audit persistence owners, not the customer's lifecycle.
  const sealListFixture = async (selected, snapshotId) => {
    const lockAt = new Date().toISOString(), session = await mongoose.startSession()
    let sealed
    try {
      await session.withTransaction(async () => {
        const framework = { ...selected.framework_state, lifecycle: { stage: 'PUBLISHED' },
          publish: { state: 'PUBLISHED', published: true, snapshot: { snapshotId: 'synthetic-list-publish', snapshotHash: 'd'.repeat(64) } },
          lock: { state: 'LOCKED', locked: true, snapshot: { snapshotId: 'synthetic-list-lock-' + String(selected._id), snapshotHash: 'a'.repeat(64),
            snapshotAt: lockAt, contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' } } }
        await RuntimeInstance.collection.updateOne({ _id: selected._id }, { $set: { framework_state: framework, status: 'LOCKED',
          lockedAt: new Date(lockAt), lockedBy: oid(109), updatedAt: new Date(lockAt) } }, { session })
        const locked = await RuntimeInstance.collection.findOne({ _id: selected._id }, { session })
        const prepared = await prepareRuntimeEvidenceSnapshot({ runtime: locked, session, snapshotId })
        const audit = new AuditLog({ actorUserId: oid(109), action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
          resourceId: locked._id, scope: { customerId: locked.customerId, tenantId: locked.tenantId, runtimeInstanceId: locked._id, runtimeInstanceKey: locked.runtimeInstanceKey },
          diff: { actionKey: 'LOCK_RECORD', actionedAt: lockAt, evidenceMembershipSnapshot: { ...prepared.pointer, counts: prepared.body.counts } } })
        audit.generateSignature(); await audit.save({ session })
        await persistRuntimeEvidenceSnapshot({ prepared, actorUserId: oid(109), audit, session })
        await RuntimeInstance.collection.updateOne({ _id: locked._id }, { $set: { lockedEvidenceSnapshot: prepared.pointer } }, { session })
        sealed = { runtime: { ...locked, lockedEvidenceSnapshot: prepared.pointer }, pointer: prepared.pointer, body: prepared.body }
      })
    } finally { await session.endSession() }
    return sealed
  }
  const useListFixture = sealed => { runtime = sealed.runtime; pointer = sealed.pointer; body = sealed.body }
  const selectedListPayload = () => {
    const value = payload()
    value.binding.runtimeInstanceId = String(runtime._id); value.binding.revisionNumber = runtime.revision.revisionNumber
    return value
  }
  const assertListExplain = async (model, plan, expectedIndex, label) => {
    const result = await model.collection.find(plan.filter, { ...plan.options, maxTimeMS: 2000 }).sort(plan.sort)
      .limit(plan.limit).batchSize(plan.batchSize).explain('executionStats')
    const winning = result.queryPlanner.winningPlan, stages = [], scans = []
    const visit = value => {
      if (!value || typeof value !== 'object') return
      if (typeof value.stage === 'string') stages.push(value.stage)
      if (value.stage === 'IXSCAN') scans.push(value)
      for (const item of Object.values(value)) if (Array.isArray(item)) item.forEach(visit); else if (item && typeof item === 'object') visit(item)
    }
    visit(winning)
    expect(stages).not.toContain('COLLSCAN'); expect(stages).not.toContain('SORT')
    const scan = scans.find(value => value.indexName === expectedIndex)
    expect(scan).toBeDefined()
    for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) expect(JSON.stringify(scan.indexBounds[key])).toContain(String(plan.filter[key]))
    if (plan.filter.evidenceObjectId) {
      const range = plan.filter.evidenceObjectId, exclusive = Object.hasOwn(range, '$gt')
      expect(scan.indexBounds.evidenceObjectId).toEqual([
        `${exclusive ? '(' : '['}${JSON.stringify(exclusive ? range.$gt : range.$gte)}, ${JSON.stringify(range.$lt)})`,
      ])
    } else {
      expect(scan.indexBounds.sourceId).toEqual([...plan.filter.sourceId.$in].sort()
        .map(value => `[${JSON.stringify(value)}, ${JSON.stringify(value)}]`))
    }
    expect(result.executionStats.nReturned).toBeGreaterThan(0)
    expect(result.executionStats.totalKeysExamined).toBeGreaterThanOrEqual(result.executionStats.nReturned)
    console.info(JSON.stringify({ proof: label, queryHash: membershipHash(plan), index: expectedIndex,
      exclusionCount: plan.filter._id?.$nin?.length || 0, nReturned: result.executionStats.nReturned,
      totalKeysExamined: result.executionStats.totalKeysExamined, totalDocsExamined: result.executionStats.totalDocsExamined,
      executionTimeMillis: result.executionStats.executionTimeMillis, indexBounds: scan.indexBounds }))
  }
  const captureFrozenFamilyCommands = async work => {
    assertOwned()
    const client = mongoose.connection.getClient(), commands = [], pending = new Map()
    const families = new Set(['runtime_evidence_sources', 'runtime_evidence_objects', 'runtime_section_states'])
    const started = event => {
      if (event.databaseName !== database || !['find', 'getMore'].includes(event.commandName)) return
      const command = event.command, name = event.commandName === 'find' ? command.find : command.collection
      if (!families.has(name)) return
      // Retain transport metadata only, never filters, documents, cursor or session IDs.
      const entry = { commandName: event.commandName, database, collection: name,
        batchSize: typeof command.batchSize === 'number' ? command.batchSize : null,
        limit: typeof command.limit === 'number' ? command.limit : null,
        singleBatch: command.singleBatch === true, maxTimeMS: typeof command.maxTimeMS === 'number' ? command.maxTimeMS : null,
        sessionPresent: Object.hasOwn(command, 'lsid'), transactionPresent: Object.hasOwn(command, 'txnNumber') }
      commands.push(entry); pending.set(event.requestId, entry)
    }
    const succeeded = event => {
      const entry = pending.get(event.requestId)
      if (!entry || event.commandName !== 'find') return
      const cursor = event.reply?.cursor
      entry.returnedCount = Array.isArray(cursor?.firstBatch) ? cursor.firstBatch.length : null
      entry.cursorClosed = cursor?.id !== undefined && String(cursor.id) === '0'
      pending.delete(event.requestId)
    }
    client.on('commandStarted', started); client.on('commandSucceeded', succeeded)
    try { return { value: await work(), commands } }
    catch (error) { return { error, commands } }
    finally { client.off('commandStarted', started); client.off('commandSucceeded', succeeded) }
  }
  const assertClosedFamilyCommands = (capture, label) => {
    expect(capture.commands.filter(command => command.commandName === 'getMore')).toEqual([])
    const limits = { runtime_evidence_sources: 1001, runtime_evidence_objects: 5001, runtime_section_states: 101 }
    const finds = capture.commands.filter(command => command.commandName === 'find')
    expect(finds.length).toBeGreaterThan(0)
    for (const command of finds) {
      expect(command).toMatchObject({ singleBatch: true, batchSize: limits[command.collection],
        limit: limits[command.collection], cursorClosed: true, sessionPresent: true, transactionPresent: true })
    }
    // CSOT may replace wire maxTimeMS with the remaining transaction deadline.
    // Record its actual value; do not claim a two-second wire bound.
    console.info(JSON.stringify({ proof: label, commands: capture.commands }))
  }
  const rawCursorFixture = async (large = false) => {
    const selected = { ...runtime, _id: oid(30001), runtimeInstanceKey: 'ss056-frozen-response-owned', revision: { revisionNumber: 1 },
      framework_state: { ...runtime.framework_state, sections: {}, evidence_pack: { evidenceObjects: [], lineage: { sources: [] } } } }
    delete selected.lockedEvidenceSnapshot
    await RuntimeInstance.collection.insertOne(selected)
    const common = { customerId: selected.customerId, tenantId: selected.tenantId, runtimeInstanceId: selected._id,
      runtimeInstanceKey: selected.runtimeInstanceKey, stateVersion: selected.stateVersion, sourceStateVersion: selected.stateVersion,
      sourceHash: 'sha256:' + 'b'.repeat(64), migrationReceiptId: oid(105), current: true }
    const source = { ...common, _id: oid(30002), sourceId: 'cursor-source', sourceType: 'MANUAL_DOCUMENT', title: 'Owned protocol source' }
    const expanded = { extractedFact: '漢'.repeat(8000), summary: '漢'.repeat(8000), title: '漢'.repeat(1000) }
    const rows = Array.from({ length: 400 }, (_, index) => ({ ...common, _id: oid(31000 + index),
      evidenceObjectId: 'cursor-member-' + String(index).padStart(4, '0'), sourceId: source.sourceId, sourceType: source.sourceType,
      extractedFact: 'Owned compact protocol fact.', summary: 'Owned compact summary.', title: 'Owned protocol title',
      ...(large ? expanded : {}) }))
    expect(new RuntimeEvidenceSource(source).validateSync()).toBeUndefined()
    for (const row of rows) expect(new RuntimeEvidenceObject(row).validateSync()).toBeUndefined()
    await RuntimeEvidenceSource.collection.insertOne(source)
    await RuntimeEvidenceObject.collection.insertMany(rows)
    return { selected, rows, expanded }
  }
  test('receipt list valid foreign basis cursor returns one stale reason without partial data', async () => {
    await submitNumber(1)
    const cursor = encodePostLockEvidenceListCursor({ basisHash: '0'.repeat(64), afterEvidenceObjectId: 'post-lock:' + 'a'.repeat(64) })
    const before = await allOwnedMaterial()
    await expect(listRead({ cursor })).rejects.toMatchObject({ status: 409, code: 'CONFLICT', details: { reason: 'POST_LOCK_EVIDENCE_LIST_CURSOR_STALE' } })
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('receipt list one shared caller cannot borrow VIEW from another customer bucket', async () => {
    await submitNumber(1)
    const foreign = { ...runtime, _id: oid(201), customerId: oid(202), tenantId: oid(203), runtimeInstanceKey: 'ss056-list-foreign-owned' }
    await RuntimeInstance.collection.insertOne(foreign)
    await Customer.collection.insertOne({ _id: oid(202), topology: 'SINGLE_TENANT', licenseLevelId: oid(110), entitlements: [] })
    await Tenant.collection.insertOne({ _id: oid(203), customerId: oid(202) })
    const shared = scopes(['VMF_VIEW'])
    shared.resolvedPermissions.tenants.push({ customerId: String(oid(202)), tenantId: String(oid(203)), permissions: ['VMF_UPDATE'] })
    const before = await allOwnedMaterial()
    const own = await listPostLockEvidence({ ...listArgs(), scopes: shared })
    expect(own.items).toHaveLength(1)
    await expect(listPostLockEvidence({ ...listArgs({ customerId: String(oid(202)), tenantId: String(oid(203)) }),
      runtimeInstanceId: foreign.runtimeInstanceKey, scopes: { ...shared, customer: { _id: String(oid(202)) },
        tenant: { _id: String(oid(203)), customerId: String(oid(202)) } } })).rejects.toMatchObject({
      status: 403, code: 'FORBIDDEN', details: { permission: 'VMF_VIEW', customerId: String(oid(202)), tenantId: String(oid(203)) },
    })
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('receipt list successor admission inherited frozen native origins are excluded by verified storage identity', async () => {
    const f = await prepareAdmission(), created = await createRuntimeRevision(f.request), child = await childFor(created)
    const parentWitness = async () => membershipHash(await Promise.all(inventory.map(async ([model, name]) => ({ name,
      rows: await model.collection.find({ $or: [{ _id: oid(101) }, { runtimeInstanceId: oid(101) }, { resourceId: oid(101) }] }).sort({ _id: 1 }).toArray(),
    }))))
    const parentBefore = await parentWitness()
    useListFixture(await sealListFixture(child, 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174912'))
    expect(body.evidence.some(row => row.evidenceObjectId === 'post-lock:' + f.submission.submissionId)).toBe(true)
    const native = await RuntimeEvidenceObject.collection.findOne({ runtimeInstanceId: runtime._id, evidenceObjectId: 'post-lock:' + f.submission.submissionId })
    expect(native.current).toBe(true); expect(native.postLockOrigin).toBeDefined(); expect(native.postLockAssociation).toBeUndefined()
    const saved = await submitNumber(1, selectedListPayload()), result = await listPassive({}, ['VMF_VIEW'])
    expect(result.items.map(row => row.submissionId)).toEqual([saved.submissionId])
    expect(result.items.map(row => row.submissionId)).not.toContain(f.submission.submissionId)
    expect(await parentWitness()).toBe(parentBefore)
  })
  test('receipt list genuine512-member frozen namespace remains readable with actual scoped index plans', async () => {
    const selected = { ...runtime, _id: oid(301), runtimeInstanceKey: 'ss056-list-compact-owned', revision: { revisionNumber: 1 },
      framework_state: { sections: {}, evidence_pack: { evidenceObjects: [], lineage: { sources: [] } } } }
    delete selected.lockedEvidenceSnapshot
    await RuntimeInstance.collection.insertOne(selected)
    const common = { customerId: selected.customerId, tenantId: selected.tenantId, runtimeInstanceId: selected._id, runtimeInstanceKey: selected.runtimeInstanceKey,
      stateVersion: selected.stateVersion, sourceStateVersion: selected.stateVersion, sourceHash: 'sha256:' + 'b'.repeat(64), migrationReceiptId: oid(105), current: true }
    await RuntimeEvidenceSource.collection.insertOne({ ...common, _id: oid(302), sourceId: 'compact-source', sourceType: 'MANUAL_DOCUMENT', title: 'Compact synthetic source' })
    await RuntimeEvidenceObject.collection.insertMany(Array.from({ length: 512 }, (_, n) => ({ ...common, _id: oid(400 + n),
      evidenceObjectId: 'post-lock:' + n.toString(16).padStart(64, '0'), sourceId: 'compact-source', sourceType: 'MANUAL_DOCUMENT', extractedFact: 'Compact synthetic immutable fact.' })))
    useListFixture(await sealListFixture(selected, 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174913'))
    expect(body.evidence).toHaveLength(512); expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(512 * 1024)
    const transportBefore = await allOwnedMaterial()
    const transport = await captureFrozenFamilyCommands(() => withPostLockEvidenceTransaction(session =>
      readVerifiedRuntimeEvidenceSnapshot({ runtime, pointer, session })))
    expect(transport.error).toBeUndefined(); expect(transport.value).toMatchObject({ completeness: 'VERIFIED' })
    expect(transport.commands.find(command => command.collection === 'runtime_evidence_objects').returnedCount).toBe(512)
    assertClosedFamilyCommands(transport, 'SS056_FROZEN_GENUINE512_SINGLE_RESPONSE')
    expect(await allOwnedMaterial()).toBe(transportBefore)
    const saved = [await submitNumber(1, selectedListPayload()), await submitNumber(2, selectedListPayload())]
    const before = await allOwnedMaterial(), result = await listRead({ pageSize: 1 })
    expect(result.items.map(row => row.submissionId)).toEqual([saved.map(row => row.submissionId).sort()[0]])
    expect(result.pagination.hasMore).toBe(true)
    const frame = await withPostLockEvidenceTransaction(session => readVerifiedPostLockLockedContext(listArgs(), session))
    await assertListExplain(RuntimeEvidenceObject, listQueries.buildEvidenceQuery({ frame, pageSize: 1 }), 'unique_runtime_evidence_object_version', 'SS056_LIST_GENUINE512_EVIDENCE_PLAN')
    await assertListExplain(RuntimeEvidenceObject, listQueries.buildEvidenceQuery({ frame, pageSize: 1,
      afterEvidenceObjectId: 'post-lock:' + result.items[0].submissionId }), 'unique_runtime_evidence_object_version', 'SS056_LIST_GENUINE512_CURSOR_PLAN')
    await assertListExplain(RuntimeEvidenceSource, listQueries.buildSourceQuery({ frame, sourceIds: saved.map(row => 'post-lock-source:' + row.submissionId) }), 'unique_runtime_evidence_source_version', 'SS056_LIST_GENUINE512_SOURCE_PLAN')
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('receipt list selector-only5000 exclusion cost uses exact plans without claiming a valid frozen snapshot', async () => {
    const saved = []
    for (let n = 1; n <= 10; n++) saved.push(await submitNumber(n))
    const frame = await withPostLockEvidenceTransaction(session => readVerifiedPostLockLockedContext(listArgs(), session))
    const ids = Array.from({ length: 5000 }, (_, n) => oid(10000 + n))
    const common = { ...frame.scope, runtimeInstanceKey: runtime.runtimeInstanceKey, stateVersion: runtime.stateVersion }
    // Explain-only selector rows are deliberately not asserted as valid evidence.
    await RuntimeEvidenceObject.collection.insertMany(ids.map((_id, n) => ({ ...common, _id, evidenceObjectId: 'post-lock:' + n.toString(16).padStart(64, '0') })))
    const foreign = [
      { ...frame.scope, customerId: oid(202), tenantId: oid(203), runtimeInstanceId: oid(201) },
      { ...frame.scope, tenantId: oid(203) }, { ...frame.scope, runtimeInstanceId: oid(201) },
    ]
    for (let n = 0; n < foreign.length; n++) {
      await RuntimeEvidenceObject.collection.insertMany(Array.from({ length: 24 }, (_, j) => ({ ...common, ...foreign[n], _id: oid(20000 + n * 100 + j), evidenceObjectId: 'post-lock:' + j.toString(16).padStart(64, '0') })))
      await RuntimeEvidenceSource.collection.insertMany(saved.map((row, j) => ({ ...common, ...foreign[n], _id: oid(21000 + n * 100 + j), sourceId: 'post-lock-source:' + row.submissionId })))
    }
    await RuntimeEvidenceObject.collection.insertMany(Array.from({ length: 24 }, (_, j) => ({ ...common, _id: oid(22000 + j),
      stateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174914', evidenceObjectId: 'post-lock:' + j.toString(16).padStart(64, '0') })))
    const selector = { ...frame, body: { ...frame.body, evidence: ids.map(id => ({ storageId: String(id) })) } }, before = await allOwnedMaterial()
    await assertListExplain(RuntimeEvidenceObject, listQueries.buildEvidenceQuery({ frame: selector, pageSize: 1 }), 'unique_runtime_evidence_object_version', 'SS056_LIST_SELECTOR_ONLY5000_EVIDENCE_PLAN')
    await assertListExplain(RuntimeEvidenceSource, listQueries.buildSourceQuery({ frame, sourceIds: saved.map(row => 'post-lock-source:' + row.submissionId) }), 'unique_runtime_evidence_source_version', 'SS056_LIST_SELECTOR_ONLY5000_SOURCE_PLAN')
    expect(await allOwnedMaterial()).toBe(before)
  })

  test('frozen preparation refuses an actual first-response truncation above16MiB without creating a partial snapshot', async () => {
    // Deliberately oversized owned raw storage, not a canonical-domain customer state.
    const f = await rawCursorFixture(true)
    const bsonBytes = f.rows.reduce((sum, row) => sum + mongoose.mongo.BSON.calculateObjectSize(row), 0)
    expect(bsonBytes).toBeGreaterThan(16 * 1024 * 1024)
    expect(f.rows.every(row => mongoose.mongo.BSON.calculateObjectSize(row) < 16 * 1024 * 1024)).toBe(true)
    const before = await allOwnedMaterial()
    const capture = await captureFrozenFamilyCommands(() => withPostLockEvidenceTransaction(session =>
      prepareRuntimeEvidenceSnapshot({ runtime: f.selected, session })))
    expect(capture.error).toMatchObject({ status: 409, code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID', details: { reason: 'MEMBER_BOUND' } })
    expect(capture.value).toBeUndefined()
    const response = capture.commands.find(command => command.collection === 'runtime_evidence_objects')
    expect(response.returnedCount).toBeGreaterThan(0); expect(response.returnedCount).toBeLessThan(f.rows.length)
    assertClosedFamilyCommands(capture, 'SS056_FROZEN_OVERSIZED_PREPARATION_REJECTED')
    expect(await RuntimeEvidenceObject.countDocuments({ runtimeInstanceId: f.selected._id, current: true })).toBe(400)
    expect(await allOwnedMaterial()).toBe(before)
    console.info(JSON.stringify({ proof: 'SS056_FROZEN_OVERSIZED_RAW_BYTES', phase: 'preparation', bsonBytes,
      expectedCount: f.rows.length, returnedCount: response.returnedCount, classification: 'OWNED_RAW_PROTOCOL_NEGATIVE' }))
  }, 30000)
  test('frozen verification refuses an actual partial response for an existing recorded-ID set', async () => {
    const f = await rawCursorFixture(false)
    const sealed = await sealListFixture(f.selected, 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174932')
    expect(sealed.body.evidence).toHaveLength(400)
    expect(Buffer.byteLength(JSON.stringify(sealed.body))).toBeLessThanOrEqual(512 * 1024)
    const expandedRows = f.rows.map(row => ({ ...row, ...f.expanded }))
    for (const row of expandedRows) expect(new RuntimeEvidenceObject(row).validateSync()).toBeUndefined()
    const bsonBytes = expandedRows.reduce((sum, row) => sum + mongoose.mongo.BSON.calculateObjectSize(row), 0)
    expect(bsonBytes).toBeGreaterThan(16 * 1024 * 1024)
    // The compact snapshot is genuine. This intentional expansion invalidates
    // its raw material; no oversized successful basis or replacement is claimed.
    await RuntimeEvidenceObject.collection.updateMany({ runtimeInstanceId: f.selected._id, sourceId: 'cursor-source' }, { $set: f.expanded })
    const before = await allOwnedMaterial(), onVerifiedMembership = jest.fn()
    const capture = await captureFrozenFamilyCommands(() => withPostLockEvidenceTransaction(session =>
      readVerifiedRuntimeEvidenceSnapshot({ runtime: sealed.runtime, pointer: sealed.pointer, session, deps: { onVerifiedMembership } })))
    expect(capture.error).toMatchObject({ status: 409, code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID', details: { reason: 'MEMBER_MISSING' } })
    expect(onVerifiedMembership).not.toHaveBeenCalled(); expect(capture.value).toBeUndefined()
    const response = capture.commands.find(command => command.collection === 'runtime_evidence_objects')
    expect(response.returnedCount).toBeGreaterThan(0); expect(response.returnedCount).toBeLessThan(400)
    assertClosedFamilyCommands(capture, 'SS056_FROZEN_OVERSIZED_VERIFICATION_REJECTED')
    expect(await allOwnedMaterial()).toBe(before)
    console.info(JSON.stringify({ proof: 'SS056_FROZEN_OVERSIZED_RAW_BYTES', phase: 'verification', bsonBytes,
      expectedCount: 400, returnedCount: response.returnedCount, classification: 'INTENTIONALLY_CHANGED_OWNED_MEMBERS' }))
  }, 30000)

  // Seventeen additive operational-capability cases retain all125 preceding
  // cases and the same owned target/configuration. Separate execution required.
  const operationalRead = permissions => readPostLockOperationalCapability(args(undefined, permissions))
  const operationalPassive = async permissions => {
    const before = await allOwnedMaterial(), result = await operationalRead(permissions)
    expect(await allOwnedMaterial()).toBe(before)
    expect(JSON.stringify(result)).not.toMatch(/pointerRecorded|__evidenceSnapshotControl|partialFilterExpression|implementationRef|signatureVersion/)
    return result
  }
  test.each(['recording-only', 'human impact', 'successor admission'])('operational capability exact%s reference returns actual recording binding and all model index prerequisites', async () => {
    const result = await operationalPassive()
    expect(result.recording).toEqual({ eligibility: 'ELIGIBLE_AS_READ', blockedBy: [], binding: payload().binding,
      checks: { authority: 'VMF_UPDATE_VERIFIED', isolation: 'CLEAR', frozenBasis: 'VERIFIED', policy: 'VERIFIED', storageIndexes: 'VERIFIED_AS_WRITER' } })
    expect(result.impact).toEqual({ eligibility: 'ITEM_REQUIRED' }); expect(result.admission).toEqual({ eligibility: 'ITEM_REQUIRED' })
    for (const model of [RuntimeEvidenceSource, RuntimeEvidenceObject]) {
      const actual = await model.collection.indexes()
      for (const [, expected] of model.schema.indexes()) expect(actual.some(row => row.name === expected.name)).toBe(true)
    }
  })
  test('operational capability VIEW-only caller sees prerequisites without recording authority', async () => {
    const result = await operationalPassive(['VMF_VIEW'])
    expect(result.recording).toMatchObject({ eligibility: 'BLOCKED', blockedBy: ['VMF_UPDATE_REQUIRED'], binding: payload().binding,
      checks: { authority: 'VMF_UPDATE_REQUIRED', storageIndexes: 'VERIFIED_AS_WRITER' } })
  })
  test('operational capability no recorded policy blocks new recording without erasing original receipts', async () => {
    const saved = await submitPostLockEvidence(args())
    await FrameworkPackage.collection.updateOne({ _id: pack._id }, { $unset: { discoveryPolicy: '' } })
    const result = await operationalPassive()
    expect(result.recording).toMatchObject({ eligibility: 'BLOCKED', blockedBy: ['POST_LOCK_POLICY_NOT_RECORDED'], binding: null,
      checks: { frozenBasis: 'VERIFIED', policy: 'NOT_RECORDED', storageIndexes: 'NOT_CHECKED' } })
    const before = await allOwnedMaterial()
    expect((await readItem(saved, ['VMF_VIEW'])).receipt.verified).toBe(true)
    expect((await listRead()).items.map(row => row.submissionId)).toContain(saved.submissionId)
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('operational capability unlocked runtime is blocked without attempting a frozen-basis read', async () => {
    await RuntimeInstance.collection.updateOne({ _id: runtime._id }, { $set: { status: 'ACTIVE', 'framework_state.lock.locked': false } })
    const result = await operationalPassive()
    expect(result.recording).toMatchObject({ eligibility: 'BLOCKED', blockedBy: ['LOCK_BASIS_UNAVAILABLE'], binding: null,
      checks: { frozenBasis: 'LOCK_BASIS_UNAVAILABLE', policy: 'NOT_CHECKED', storageIndexes: 'NOT_CHECKED' } })
  })
  test('operational capability truly absent locked membership is a known legacy blocker', async () => {
    await RuntimeInstance.collection.updateOne({ _id: runtime._id }, { $unset: { lockedEvidenceSnapshot: '' } })
    const result = await operationalPassive()
    expect(result.recording).toMatchObject({ eligibility: 'BLOCKED', blockedBy: ['FROZEN_MEMBERSHIP_NOT_RECORDED'], binding: null,
      checks: { frozenBasis: 'NOT_RECORDED', policy: 'NOT_CHECKED', storageIndexes: 'NOT_CHECKED' } })
  })
  test('operational capability actual owned missing index blocks and the fixture restores its identical definition', async () => {
    assertOwned()
    const indexName = 'unique_runtime_evidence_source_version'
    const [key, options] = RuntimeEvidenceSource.schema.indexes().find(([, value]) => value.name === indexName)
    const indexWitness = async () => membershipHash((await RuntimeEvidenceSource.collection.indexes()).sort((a, b) => a.name.localeCompare(b.name)))
    const metadataBefore = await indexWitness()
    await RuntimeEvidenceSource.collection.dropIndex(indexName)
    try {
      const result = await operationalPassive()
      expect(result.recording).toMatchObject({ eligibility: 'BLOCKED', blockedBy: ['POST_LOCK_INDEX_REQUIRED'], binding: payload().binding,
        checks: { storageIndexes: 'MISMATCH' } })
    } finally { assertOwned(); await RuntimeEvidenceSource.collection.createIndex(key, options) }
    expect(await indexWitness()).toBe(metadataBefore)
  })
  test('operational capability rejected actual metadata dependency is503 and not a missing-index descriptor', async () => {
    const before = await allOwnedMaterial(), cursor = { next: jest.fn(async () => { throw new Error('Private metadata detail.') }), close: jest.fn(async () => {}) }
    const spy = jest.spyOn(RuntimeEvidenceSource.collection, 'listIndexes').mockReturnValue(cursor)
    try { await expect(operationalRead()).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE',
      details: { reason: 'POST_LOCK_OPERATIONAL_CAPABILITY_DEPENDENCY_UNAVAILABLE' } }); expect(cursor.close).toHaveBeenCalledTimes(1) }
    finally { spy.mockRestore() }
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('operational capability rejected package dependency is503 and not absent policy', async () => {
    const before = await allOwnedMaterial(), query = { select: () => query, setOptions: () => query,
      lean: async () => { throw new Error('Private policy detail.') } }
    const spy = jest.spyOn(FrameworkPackage, 'findOne').mockReturnValue(query)
    try { await expect(operationalRead()).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE',
      details: { reason: 'POST_LOCK_OPERATIONAL_CAPABILITY_DEPENDENCY_UNAVAILABLE' } }) }
    finally { spy.mockRestore() }
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('operational capability AS_READ binding cannot bypass the unchanged submit-time revoked policy', async () => {
    const result = await operationalPassive(), input = payload()
    input.binding = result.recording.binding
    await FrameworkPackage.collection.updateOne({ _id: pack._id }, { $unset: { discoveryPolicy: '' } })
    const before = await allOwnedMaterial()
    await expect(submitPostLockEvidence(args(input))).rejects.toMatchObject({ status: 409, code: 'CONFLICT', details: { reason: 'POST_LOCK_POLICY_UNAVAILABLE' } })
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('operational capability shared caller cannot borrow another customer UPDATE or VIEW bucket', async () => {
    const shared = scopes(['VMF_VIEW'])
    shared.resolvedPermissions.tenants.push({ customerId: String(oid(202)), tenantId: String(oid(203)), permissions: ['VMF_UPDATE'] })
    const foreign = { ...runtime, _id: oid(201), customerId: oid(202), tenantId: oid(203), runtimeInstanceKey: 'ss056-capability-foreign-owned' }
    await RuntimeInstance.collection.insertOne(foreign)
    const before = await allOwnedMaterial()
    expect((await readPostLockOperationalCapability({ ...args(), scopes: shared })).recording.blockedBy).toEqual(['VMF_UPDATE_REQUIRED'])
    await expect(readPostLockOperationalCapability({ ...args(), runtimeInstanceId: foreign.runtimeInstanceKey,
      scopes: { ...shared, customer: { _id: String(oid(202)) }, tenant: { _id: String(oid(203)), customerId: String(oid(202)) } } }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', details: { permission: 'VMF_VIEW' } })
    expect(await allOwnedMaterial()).toBe(before)
  })
  test('operational capability mounted controller returns bounded200 at the explicit authenticated scope seam', async () => {
    const { default: express } = await import('express'), { default: supertest } = await import('supertest')
    const { getRuntimePostLockOperationalCapability: controller } = await import('../controllers/runtimeInstance.controller.js')
    const { validateReviewCompletionScope } = await import('../validators/reviewCompletion.validator.js')
    const { validateRuntimeInstanceId } = await import('../validators/runtimeInstance.validator.js')
    const app = express()
    app.use((req, _res, next) => { req.scopes = scopes(); req.context = { userId: String(oid(109)) }; req.requestId = 'owned-operational-capability'; next() })
    app.get('/runtime-instances/:runtimeInstanceId/post-lock-evidence-capability', validateRuntimeInstanceId, validateReviewCompletionScope, controller)
    const before = await allOwnedMaterial(), result = await supertest(app).get(`/runtime-instances/${runtime.runtimeInstanceKey}/post-lock-evidence-capability`)
      .query({ customerId: String(oid(102)), tenantId: String(oid(103)) })
    expect(result.status).toBe(200)
    expect(result.body.data.recording).toMatchObject({ eligibility: 'ELIGIBLE_AS_READ', binding: payload().binding })
    expect(result.body.meta).toEqual({ requestId: 'owned-operational-capability', version: 'v1' })
    expect(Buffer.byteLength(JSON.stringify(result.body))).toBeLessThanOrEqual(16 * 1024)
    expect(await allOwnedMaterial()).toBe(before)
  })
  test.each([['null', null], ['false', false], ['zero', 0], ['empty string', '']])('operational capability present raw%s locked pointer rejects rather than becoming legacy absence', async (_label, value) => {
    await RuntimeInstance.collection.updateOne({ _id: runtime._id }, { $set: { lockedEvidenceSnapshot: value } })
    const before = await allOwnedMaterial()
    await expect(operationalRead()).rejects.toMatchObject({ status: 409, code: 'CONFLICT', details: { reason: 'POST_LOCK_BINDING_STALE' } })
    expect(await allOwnedMaterial()).toBe(before)
  })

})
