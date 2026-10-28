import { storedControlledReplayBindingDigest } from '../services/controlledReplayContract.js'
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, jest, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import mongoose from 'mongoose'
import '../models/RuntimeEvidenceSnapshotRecovery.js'
import '../models/RuntimeSupplementalFindingReview.js'
import '../models/RuntimeProductAuthorityReceipt.js'
import '../models/RuntimePublishedDispositionReceipt.js'
import { RUNTIME_SECTION_DETAIL_FORBIDDEN_KEYS } from '../models/RuntimeStateSection.js'
import { buildRuntimeManagedSourceReceipt, evaluateRuntimeManagedSections } from '../services/runtimeManagedSectionService.js'
import { buildReasoningArtefactOutputs } from '../services/reasoningArtefactContractService.js'
import { hashSectionInput } from '../services/runtimeSectionModelService.js'
import { hashSectionHistoryPair } from '../services/runtimeSectionHistoryContract.js'
import { ingestUploadedDocumentDiscoveryEvidence } from '../services/discoveryIntelligenceService.js'
import { createRuntimeStateLegacySourceRowSet } from '../services/runtimeStateLegacyMapper.js'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'
import { contradictionReviewRequestHash, getDiscoveryContradictionReview } from '../services/discoveryContradictionReviewService.js'

const getRuntimeInstance = jest.fn()
const resolveFrameworkOutcomeStudioHandoff = jest.fn()
const buildOutcomePlanningRuntimeEvidence = jest.fn(({ runtimeInstance }) => runtimeInstance)
const buildFrameworkOutcomeHandoffV2ParityDigest = jest.fn(() => 'sha256:bounded-state-digest')
const FRAMEWORK_OUTCOME_HANDOFF_V2_PARITY_CONTRACT_VERSION = 'ss-014.runtime-state-v2.handoff-state-parity.v1'
const FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY = Object.freeze({
  policyVersion: 'ss-014.runtime-state-v2.handoff-dependencies.v1',
  maxTimeMS: 2000,
  packageLimit: 2,
  activationLimit: 501,
  versionLimit: 501,
  commandIds: Object.freeze([
    'HANDOFF_CONTROL_READ',
    'HANDOFF_FRAMEWORK_PACKAGE_READ',
    'HANDOFF_KNOWLEDGE_ACTIVATION_READ',
    'HANDOFF_KNOWLEDGE_VERSION_READ',
    'HANDOFF_RENDERER_CAPABILITY_READ',
  ]),
})

await jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({
  getRuntimeInstance,
  assertRuntimePermission: () => { throw new Error('Passive cached reads must not invoke mutation authorization') },
}))

await jest.unstable_mockModule('../services/outcomeFrameworkHandoffService.js', () => ({
  resolveFrameworkOutcomeStudioHandoff,
  FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY,
  FRAMEWORK_OUTCOME_HANDOFF_V2_PARITY_CONTRACT_VERSION,
  buildFrameworkOutcomeHandoffV2ParityDigest,
  buildOutcomePlanningRuntimeEvidence,
  OUTCOME_PLANNING_EVIDENCE_VERSIONS: { V1: 'outcome-planning-evidence.v1', V2: 'outcome-planning-evidence.v2' },
}))

const {
  RUNTIME_STATE_V2_COLLECTIONS,
  RUNTIME_STATE_V2_CONTROL_PROJECTION,
  RUNTIME_STATE_V2_ERROR_CODES,
  RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
  RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT,
  RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
  RUNTIME_STATE_V2_READ_MAX_TIME_MS,
  RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT,
  getRuntimeStateBootstrap,
  getRuntimeStateControl,
  getRuntimeStateLockBasis,
  getRuntimeStateGraphManifest,
  getRuntimeStateFindings,
  getRuntimeStateContradictionHistory,
  getRuntimeStateGraphProjection,
  getRuntimeStateOutcomeHandoffReadiness,
  getRuntimeOutcomePlanningEvidence,
  getRuntimeOutcomeEvidenceContractSnapshot,
  getRuntimeStateRendererSections,
  getRuntimeStateSectionSummary,
  listRuntimeStateEvidenceObjects,
  listRuntimeStateSources,
  __testables,
} = await import('../services/runtimeStateRepository.js')

const RUNTIME_ID = '507f1f77bcf86cd799439011'
const cachedProofDirectory = process.env.VMF_SNAPSHOT_RECOVERY_CACHED_PROOF_DIR
const cachedProofEnabled = Boolean(cachedProofDirectory)
const cachedProofPins = {
  'native-recovery-baseline-private.ejson.json': '1daeec72156b58fffd1833090bee23b04ae1df4d835b220c01b00286d44dc850',
  'native-record.json': 'e8118738f09daa0af8f5f50dfa60e4e62ea108787b723f08bf01779f2d365f72',
  'native-audit.json': '3f25b7f4e75b21af4ef84485f89e699b21cea7901a419f371cc901c66e3726e9',
}
const loadCachedProof = async () => {
  if (resolve(cachedProofDirectory).toLowerCase() !== resolve('C:/Dev/StoryLineOS/VMF-Evidence/ss-044/2026-10-16-snapshot-safe-recovery').toLowerCase()) throw new Error('Unexpected cached proof directory')
  const read = name => {
    const bytes = readFileSync(resolve(cachedProofDirectory, name))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(cachedProofPins[name])
    return bytes.toString('utf8')
  }
  const baseline = mongoose.mongo.BSON.EJSON.parse(read('native-recovery-baseline-private.ejson.json'))
  const RecoveryModel = (await import('../models/RuntimeEvidenceSnapshotRecovery.js')).default
  const AuditModel = (await import('../models/AuditLog.js')).default
  const record = RecoveryModel.hydrate(JSON.parse(read('native-record.json'))).toObject()
  const audit = AuditModel.hydrate(JSON.parse(read('native-audit.json'))).toObject()
  expect(AuditModel.hydrate(audit).verifySignature()).toBe(true)
  const { membershipHash, membershipJson } = await import('../services/runtimeEvidenceSnapshotContract.js')
  const originalMaterial = membershipJson(baseline.root)
  delete originalMaterial.updatedAt; delete originalMaterial.updatedBy
  expect(membershipHash(originalMaterial)).toBe('9d37411a3d4f26667cfda16fd56550bcd0718fb457372f18e0aeb288cf09159c')
  // Derived cached input: only actual committed metadata from the signed record.
  baseline.root.updatedAt = new Date(record.body.committed.updatedAt)
  baseline.root.updatedBy = new mongoose.Types.ObjectId(record.body.committed.updatedBy)
  baseline.collections.runtime_instances = [baseline.root]
  baseline.collections.runtime_evidence_snapshot_recoveries = [record]
  baseline.collections.auditlogs.push(audit)
  return { baseline, record, audit }
}
const installCachedReads = async ({ baseline }) => {
  const field = (row, path) => path.split('.').reduce((value, key) => value?.[key], row)
  const equal = (left, right) => left == null || right == null ? left === right : String(left) === String(right)
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every(item => matches(row, item))
    if (key === '$or') return value.some(item => matches(row, item))
    const actual = field(row, key)
    if (value && typeof value === 'object' && !value._bsontype && !(value instanceof Date)) {
      return Object.entries(value).every(([op, expected]) => {
        if (op === '$in') return expected.some(item => equal(actual, item))
        if (op === '$gt') return String(actual) > String(expected)
        if (op === '$exists') return (actual !== undefined) === expected
        if (op === '$eq') return equal(actual, expected)
        throw new Error('Unsupported cached query operator: ' + op)
      })
    }
    return equal(actual, value)
  })
  const project = (row, projection) => {
    if (!projection || !Object.keys(projection).length) return row
    const result = {}
    for (const path of Object.keys(projection)) {
      const value = field(row, path)
      if (value === undefined) continue
      const keys = path.split('.'); let target = result
      keys.slice(0, -1).forEach(key => { target = target[key] ||= {} })
      target[keys.at(-1)] = value
    }
    return result
  }
  const calls = [], writes = jest.fn(() => { throw new Error('Cached proof forbids writes') })
  const collection = name => {
    if (!(name in baseline.collections) && name !== 'runtime_synthetic_test_disposition_receipts') throw new Error('Unexpected cached collection: ' + name)
    const data = baseline.collections[name] || []
    return {
      find: (filter, options = {}) => {
        calls.push({ name, filter, options }); let result = data.filter(row => matches(row, filter)), maximum = Infinity
        const cursor = {
          maxTimeMS: value => { expect(value).toBeGreaterThan(0); expect(value).toBeLessThanOrEqual(2000); return cursor },
          sort: order => { result = [...result].sort((a, b) => { for (const [key, direction] of Object.entries(order)) { const x = String(field(a, key)), y = String(field(b, key)); if (x !== y) return (x < y ? -1 : 1) * direction }; return 0 }); return cursor },
          limit: limit => { maximum = limit; return cursor }, batchSize: () => cursor,
          skip: count => { result = result.slice(count); return cursor },
          toArray: async () => result.slice(0, maximum).map(row => project(row, options.projection)),
        }
        return cursor
      },
      findOne: async (filter, options = {}) => { calls.push({ name, filter, options }); const row = data.find(row => matches(row, filter)); return row ? project(row, options.projection) : null },
      countDocuments: async filter => data.filter(row => matches(row, filter)).length,
      insertOne: writes, insertMany: writes, updateOne: writes, deleteOne: writes,
    }
  }
  const priorDb = mongoose.connection.db
  const priorName = mongoose.connection.name
  mongoose.connection.name = 'ss044_00000000000000000000000000000001'
  const connect = jest.spyOn(mongoose, 'connect').mockImplementation(() => { throw new Error('Cached proof must never connect') })
  mongoose.connection.db = { collection }
  const spies = []
  for (const path of ['AuditLog', 'RuntimeSupplementalFindingReview', 'RuntimeProductAuthorityReceipt', 'RuntimePublishedDispositionReceipt']) {
    const Model = (await import('../models/' + path + '.js')).default
    const adapter = collection(Model.collection.name)
    spies.push(jest.spyOn(Model.collection, 'findOne').mockImplementation(adapter.findOne))
    spies.push(jest.spyOn(Model.collection, 'find').mockImplementation(adapter.find))
  }
  return { calls, writes, project, collection, restore: () => {
    spies.forEach(spy => spy.mockRestore()); mongoose.connection.db = priorDb; mongoose.connection.name = priorName
    expect(connect).not.toHaveBeenCalled(); connect.mockRestore()
  } }
}
const CUSTOMER_ID = '507f1f77bcf86cd799439012'
const TENANT_ID = '507f1f77bcf86cd799439013'
const SCOPES = {
  customer: { _id: CUSTOMER_ID },
  tenant: { _id: TENANT_ID, customerId: CUSTOMER_ID },
}
;(cachedProofEnabled ? describe : describe.skip)('cached native frozen Outcome handoff: repository plus strict readers', () => {
  let fixture, adapter
  beforeAll(() => { jest.unstable_unmockModule('../services/runtimeEvidenceSnapshotRecoveryService.js') })
  beforeEach(async () => {
    fixture = await loadCachedProof()
    adapter = await installCachedReads(fixture)
    for (const name of [...Object.keys(fixture.baseline.collections), 'runtime_synthetic_test_disposition_receipts']) collections.set(name, adapter.collection(name))
    // Explicit authorized selection/serializer seam. The native repository,
    // correction, material hashes, model validation and HMAC checks remain real.
    getRuntimeInstance.mockImplementation(async args => {
      const root = fixture.baseline.root
      expect(String(args.runtimeInstanceId)).toBe(String(root._id))
      const projection = typeof args.projection === 'string' ? Object.fromEntries(args.projection.split(' ').map(key => [key, 1])) : args.projection
      const selected = adapter.project(root, projection)
      const serialized = { ...selected, id: String(root._id), customerId: String(root.customerId), tenantId: String(root.tenantId),
        packageId: String(root.packageId), updatedBy: selected.updatedBy ? String(selected.updatedBy) : null,
        lockedBy: selected.lockedBy ? String(selected.lockedBy) : null }
      if (args.internalEvidenceSnapshotToken) {
        const runtime = { ...serialized, _id: serialized.id }
        expect(runtime.framework_state).not.toHaveProperty('sections')
        expect(runtime.framework_state).not.toHaveProperty('evidence_pack')
        expect(Buffer.byteLength(JSON.stringify(runtime))).toBeLessThanOrEqual(16384)
        serialized.__evidenceSnapshotControl = { runtime, pointer: root.lockedEvidenceSnapshot }
      }
      return serialized
    })
  })
  afterEach(() => adapter?.restore())
  const read = () => {
    const root = fixture.baseline.root
    return getRuntimeOutcomeEvidenceContractSnapshot({ runtimeInstanceId: String(root._id),
      scopes: { customer: { _id: root.customerId }, tenant: { _id: root.tenantId, customerId: root.customerId } },
      boundedInventoryRead: true, session: { cachedReadOnlySession: true }, readBudget: () => ({ maxTimeMS: 2000 }) })
  }
  test('private control to real correction to exact context and signed review, without adding facts', async () => {
    const result = await read()
    expect(result.inventoryReceipt).toMatchObject({ completeness: 'COMPLETE', sectionReadiness: 'REFERENCES_RESOLVED',
      collections: { evidence: { totalCount: 47 }, sources: { totalCount: 8 } },
      supplementalFinding: { disposition: 'NOT_CONTRADICTORY', storageId: String(fixture.baseline.collections.runtime_supplemental_finding_reviews[0]._id) } })
    expect(result.inventoryReceipt.sectionCoverage.every(row => row.missingReferences.length === 0)).toBe(true)
    expect(result.inventoryReceipt.selectedEvidenceIds).toHaveLength(result.evidenceObjects.length)
    expect(result.evidenceObjects.every(row => !['section_input', 'scoped_view'].includes(row.evidenceObjectId))).toBe(true)
    expect(result.inventoryReceipt.frozenMembership.body.sections.some(row => row.contextBindings?.references.length)).toBe(true)
    expect(getRuntimeInstance.mock.calls.some(([args]) => typeof args.internalEvidenceSnapshotToken === 'symbol')).toBe(true)
    expect(adapter.writes).not.toHaveBeenCalled()
  })
  test.each(['changed-candidate', 'added-candidate', 'changed-epoch', 'reopened-history'])('actual %s is not replaced by a saved review candidate', async kind => {
    const pack = fixture.baseline.root.framework_state.evidence_pack
    if (kind === 'changed-candidate') pack.discoveryHealth.contradictionCandidates[0] = { ...pack.discoveryHealth.contradictionCandidates[0], basis: 'Changed native basis' }
    if (kind === 'added-candidate') pack.discoveryHealth.contradictionCandidates.push({ ...pack.discoveryHealth.contradictionCandidates[0], contradictionId: 'new-native-candidate' })
    if (kind === 'changed-epoch') pack.contradictionReviewEpoch = '123e4567-e89b-42d3-a456-426614174000'
    if (kind === 'reopened-history') pack.contradictionReviews = [{ contradictionId: pack.discoveryHealth.contradictionCandidates[0].contradictionId, disposition: 'REOPENED' }]
    await expect(read()).rejects.toMatchObject({ code: 'OUTCOME_EVIDENCE_SUPPLEMENTAL_FINDING_STALE' })
    expect(adapter.writes).not.toHaveBeenCalled()
  })
})

;(cachedProofEnabled ? describe : describe.skip)('cached controlled direct R2 own frozen context', () => {
  let fixture, adapter, child, childRows, childAudit, childDoc
  beforeEach(async () => {
    fixture = await loadCachedProof()
    const root = fixture.baseline.root, clone = value => mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(value, { relaxed: false }))
    child = clone(root)
    child._id = new mongoose.Types.ObjectId('6ae200000000000000000001')
    child.runtimeInstanceKey = 'ss044-controlled-direct-r2-cached-only'
    child.stateVersion = 'rsv2:123e4567-e89b-42d3-a456-426614174000'
    child.revision = { revisionNumber: 2, createdFromRevision: 1, parentRuntimeId: root._id, rootRuntimeId: root._id,
      parentRuntimeInstanceKey: root.runtimeInstanceKey, rootRuntimeInstanceKey: root.runtimeInstanceKey,
      derivedFromPublishSnapshotId: root.framework_state.publish.snapshot.snapshotId,
      derivedFromPublishSnapshotHash: root.framework_state.publish.snapshot.snapshotHash,
      derivedFromLockSnapshotId: root.framework_state.lock.snapshot.snapshotId,
      derivedFromLockSnapshotHash: root.framework_state.lock.snapshot.snapshotHash,
      derivedFromReplayAnchorId: root.framework_state.lock.replayAnchor.replayAnchorId,
      derivedFromReplayAnchorHash: root.framework_state.lock.replayAnchor.replayAnchorHash }
    child.lockedAt = new Date('2026-10-18T11:00:00.000Z')
    child.framework_state.lock.snapshot = { ...child.framework_state.lock.snapshot,
      snapshotId: 'cached-child-lock', snapshotHash: 'a'.repeat(64), snapshotAt: child.lockedAt.toISOString() }
    child.framework_state.evidence_pack.discoveryHealth.contradictionCandidates = []
    child.framework_state.evidence_pack.contradictionReviews = []
    child.framework_state.evidence_pack.contradictionReviewEpoch = '123e4567-e89b-42d3-a456-426614174000'
    childRows = {}
    for (const [kind, name] of [['sources', 'runtime_evidence_sources'], ['evidence', 'runtime_evidence_objects'], ['sections', 'runtime_section_states']]) {
      childRows[kind] = fixture.baseline.collections[name].filter(row => row.stateVersion === root.stateVersion).map((row, index) => ({ ...clone(row),
        _id: new mongoose.Types.ObjectId(String(index + 1).padStart(24, '0')), runtimeInstanceId: child._id, runtimeInstanceKey: child.runtimeInstanceKey,
        stateVersion: child.stateVersion, sourceStateVersion: child.stateVersion, current: true }))
    }
    const { buildEvidenceMembershipBody, membershipHash } = await import('../services/runtimeEvidenceSnapshotContract.js')
    const body = buildEvidenceMembershipBody({ runtime: child, lockTruthRecord: child.framework_state.lock.snapshot, ...childRows })
    const pointer = { contractVersion: body.contractVersion, snapshotId: 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174000',
      membershipHash: membershipHash(body), basisStateVersion: child.stateVersion,
      lockSnapshotId: body.lockTruthRecord.snapshotId, lockSnapshotHash: body.lockTruthRecord.snapshotHash }
    child.lockedEvidenceSnapshot = pointer
    const Audit = (await import('../models/AuditLog.js')).default
    const audit = new Audit({ actorUserId: child.lockedBy, action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance', resourceId: child._id,
      scope: { customerId: child.customerId, tenantId: child.tenantId, runtimeInstanceId: child._id, runtimeInstanceKey: child.runtimeInstanceKey },
      diff: { actionKey: 'LOCK_RECORD', actionedAt: child.lockedAt.toISOString(), evidenceMembershipSnapshot: { ...pointer, counts: body.counts } } })
    audit.generateSignature(); childAudit = audit.toObject()
    expect(Audit.hydrate(childAudit).verifySignature()).toBe(true)
    childDoc = { _id: new mongoose.Types.ObjectId('6ae200000000000000000002'), ...body.scope, ...pointer, body,
      createdBy: child.lockedBy, createdAt: child.lockedAt, lockAuditId: childAudit._id, lockAuditSignatureVersion: childAudit.signatureVersion }
    fixture.baseline.collections.runtime_instances.push(child)
    fixture.baseline.collections.runtime_evidence_snapshots.push(childDoc)
    fixture.baseline.collections.auditlogs.push(childAudit)
    for (const [kind, name] of [['sources', 'runtime_evidence_sources'], ['evidence', 'runtime_evidence_objects'], ['sections', 'runtime_section_states']]) fixture.baseline.collections[name].push(...childRows[kind])
    adapter = await installCachedReads(fixture)
    for (const name of [...Object.keys(fixture.baseline.collections), 'runtime_synthetic_test_disposition_receipts']) collections.set(name, adapter.collection(name))
    getRuntimeInstance.mockImplementation(async args => {
      const row = String(args.runtimeInstanceId) === String(child._id) ? child : root
      expect([String(root._id), String(child._id)]).toContain(String(args.runtimeInstanceId))
      const projection = typeof args.projection === 'string' ? Object.fromEntries(args.projection.split(' ').map(key => [key, 1])) : args.projection
      const selected = adapter.project(row, projection)
      const serialized = { ...selected, id: String(row._id), customerId: String(row.customerId), tenantId: String(row.tenantId), packageId: String(row.packageId),
        lockedBy: String(row.lockedBy) }
      if (args.internalEvidenceSnapshotToken) {
        expect(selected.framework_state).not.toHaveProperty('sections')
        expect(selected.framework_state).not.toHaveProperty('evidence_pack')
        serialized.__evidenceSnapshotControl = { runtime: { ...serialized, _id: serialized.id }, pointer: row.lockedEvidenceSnapshot }
      }
      return serialized
    })
  })
  afterEach(() => adapter?.restore())
  const read = () => getRuntimeOutcomeEvidenceContractSnapshot({ runtimeInstanceId: String(child._id),
    scopes: { customer: { _id: child.customerId }, tenant: { _id: child.tenantId, customerId: child.customerId } },
    boundedInventoryRead: true, session: { cachedReadOnlySession: true }, readBudget: () => ({ maxTimeMS: 2000 }) })
  test('actual recovered parent and child reader transport own frozen metadata without inherited review', async () => {
    const result = await read()
    expect(result.inventoryReceipt).toMatchObject({ sectionReadiness: 'REFERENCES_RESOLVED', frozenMembership: {
      snapshotId: child.lockedEvidenceSnapshot.snapshotId, body: { scope: { runtimeInstanceId: String(child._id), revisionNumber: 2 }, basisStateVersion: child.stateVersion } } })
    expect(result.inventoryReceipt).not.toHaveProperty('supplementalFinding')
    expect(result.contradictionReviews).toEqual([])
    expect(result.inventoryReceipt.sectionCoverage.every(row => row.missingReferences.length === 0)).toBe(true)
    expect(result.evidenceObjects.every(row => !['section_input', 'scoped_view'].includes(row.evidenceObjectId))).toBe(true)
    expect(adapter.writes).not.toHaveBeenCalled()
    expect(getRuntimeInstance.mock.calls.some(([args]) => String(args.runtimeInstanceId) === String(fixture.baseline.root._id)
      && args.session?.cachedReadOnlySession && typeof args.readBudget === 'function')).toBe(true)
    expect(adapter.calls.some(call => call.name === 'auditlogs' && String(call.filter.resourceId) === String(child._id)
      && call.options.maxTimeMS <= 2000 && call.options.session?.cachedReadOnlySession)).toBe(true)
  })
  test.each(['parent', 'root', 'revision', 'created-from', 'package', 'customer', 'workspace', 'anchor', 'own-pointer', 'own-member', 'parent-pointer', 'child-body-review'])('rejects changed %s without context fallback', async kind => {
    if (kind === 'parent') child.revision.parentRuntimeId = new mongoose.Types.ObjectId('6ae200000000000000000003')
    if (kind === 'root') child.revision.rootRuntimeId = new mongoose.Types.ObjectId('6ae200000000000000000003')
    if (kind === 'revision') child.revision.revisionNumber = 3
    if (kind === 'created-from') child.revision.createdFromRevision = 2
    if (kind === 'package') child.packageVersion = 'changed'
    if (kind === 'customer') child.customerId = new mongoose.Types.ObjectId('6ae200000000000000000003')
    if (kind === 'workspace') child.workspaceId = 'changed'
    if (kind === 'anchor') child.revision.derivedFromReplayAnchorHash = 'b'.repeat(64)
    if (kind === 'own-pointer') delete child.lockedEvidenceSnapshot
    if (kind === 'own-member') childRows.sections[0].sectionDetail.accepted.supportingEvidenceRefs.push('tampered-ref')
    if (kind === 'parent-pointer') fixture.baseline.root.lockedEvidenceSnapshot.membershipHash = 'b'.repeat(64)
    if (kind === 'child-body-review') childDoc.body.publishedFinding = { parentReceipt: true }
    const code = kind === 'own-pointer' ? 'OUTCOME_EVIDENCE_FROZEN_MEMBERSHIP_REQUIRED'
      : ['own-member', 'parent-pointer', 'child-body-review'].includes(kind) ? 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID'
        : 'OUTCOME_EVIDENCE_DIRECT_REVISION_INVALID'
    await expect(read()).rejects.toMatchObject({ code })
    expect(adapter.writes).not.toHaveBeenCalled()
  })
  test.each(['tampered-signature', 'missing-audit', 'resealed-wrong-link'])('actual child HMAC and lock link reject %s', async kind => {
    const Audit = (await import('../models/AuditLog.js')).default
    if (kind === 'tampered-signature') childAudit.signature = 'tampered'
    if (kind === 'missing-audit') fixture.baseline.collections.auditlogs.splice(fixture.baseline.collections.auditlogs.indexOf(childAudit), 1)
    if (kind === 'resealed-wrong-link') {
      childAudit.diff.actionKey = 'WRONG_ACTION'
      const doc = Audit.hydrate(childAudit); doc.generateSignature(); childAudit.signature = doc.signature
      expect(Audit.hydrate(childAudit).verifySignature()).toBe(true)
    }
    await expect(read()).rejects.toMatchObject({ code: kind === 'resealed-wrong-link'
      ? 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID' : 'OUTCOME_EVIDENCE_DIRECT_REVISION_AUDIT_INVALID' })
    expect(adapter.writes).not.toHaveBeenCalled()
  })
})

const makeSectionDetail = (overrides = {}) => ({
  input: 'Migrated section input',
  generated: null,
  accepted: null,
  review: {},
  state: { status: 'DRAFT' },
  lineage: {
    sectionKey: 'section_1_executive_summary',
    runtimePath: 'framework_state.sections.section_1_executive_summary',
  },
  revisions: [],
  dependencies: {},
  validation: {},
  confidence: {},
  intelligence: {},
  metrics: {},
  additionalEvidence: {},
  evidenceObjects: [],
  gsilContext: {},
  ...overrides,
})

const makeControl = (overrides = {}) => ({
  id: RUNTIME_ID,
  runtimeInstanceKey: 'runtime-one',
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  runtimeType: 'VALUE_NARRATIVE',
  frameworkKey: 'VMF',
  packageId: '507f1f77bcf86cd799439014',
  packageKey: 'standard-package',
  packageVersion: '3.1.1',
  status: 'ACTIVE',
  executionStatus: 'IDLE',
  runtimeMode: 'INTERACTIVE',
  revision: { revisionNumber: 1 },
  stateVersion: 'runtime-revision:1',
  ...overrides,
})

const makeCursor = (rows) => ({
  maxTimeMS: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue(rows),
})

const collections = new Map()
// Model MongoDB inclusion projection, preserving array cardinality and nulls.
const projectRendererRow = (row, projection) => {
  const include = (value, paths) => {
    if (paths.some((path) => path.length === 0)) return value
    if (Array.isArray(value)) return value.map((entry) => include(entry, paths))
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
      const childPaths = paths.filter((path) => path[0] === key).map((path) => path.slice(1))
      return childPaths.length ? [[key, include(child, childPaths)]] : []
    }))
  }
  return include(JSON.parse(JSON.stringify(row)), Object.keys(projection).map((path) => path.split('.')))
}
const collectionSpy = jest.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
  const collection = collections.get(name)
  if (!collection) throw new Error(`Unexpected collection: ${name}`)
  return collection
})

const graphSessionSpy = jest.spyOn(mongoose, 'startSession').mockImplementation(async () => {
  let active = false
  return { startTransaction: () => { active = true }, inTransaction: () => active,
    commitTransaction: async () => { active = false }, abortTransaction: async () => { active = false }, endSession: async () => {} }
})

beforeEach(() => {
  getRuntimeInstance.mockReset()
  buildOutcomePlanningRuntimeEvidence.mockClear()
  getRuntimeInstance.mockResolvedValue(makeControl())
  resolveFrameworkOutcomeStudioHandoff.mockReset()
  resolveFrameworkOutcomeStudioHandoff.mockResolvedValue({
    handoff: {
      status: 'BLOCKED',
      blockerCount: 1,
    },
  })
  collectionSpy.mockClear()
  collections.clear()
  collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, {
    find: jest.fn().mockReturnValue(makeCursor([])),
  })
  collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, {
    find: jest.fn().mockReturnValue(makeCursor([])),
  })
  collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES, {
    find: jest.fn().mockReturnValue(makeCursor([{
      sourceId: 'source-1',
      sourceType: 'WEBSITE',
      title: 'Customer website',
      sourceRef: 'https://acme.example',
      acquisitionStatus: 'ACQUIRED',
      lineageRef: 'framework_state.evidence_pack.sources[0]',
      current: true,
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }])),
  })
})

afterAll(() => {
  collectionSpy.mockRestore()
  graphSessionSpy.mockRestore()
})

describe('immutable lock membership control boundary', () => {
  test('legacy control stays unavailable; private malformed pointer cannot leak or fabricate proof', async () => {
    const at = '2026-10-14T12:00:00.000Z'
    const runtime = makeControl({ lockedAt: at, status: 'LOCKED', framework_state: { lock: { locked: true, state: 'LOCKED', lockedAt: at,
      snapshot: { snapshotId: 'truth-lock-1', snapshotHash: 'a'.repeat(64), snapshotAt: at, actionKey: 'LOCK_RECORD', contractVersion: 'runtime-truth-snapshot-v1' } } } })
    getRuntimeInstance.mockResolvedValue(runtime)
    const legacy = await getRuntimeStateLockBasis({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(legacy.lockBasis.frozenInventory.reason).toBe('FROZEN_MEMBERSHIP_NOT_RECORDED')
    expect(legacy.lockBasis.outsideSnapshotIntake).toEqual({ contractVersion: 'post-lock-evidence-intake-capability.v1',
      available: false, reason: 'FROZEN_MEMBERSHIP_NOT_RECORDED', blockedBy: ['FROZEN_MEMBERSHIP_NOT_RECORDED'],
      policy: { status: 'NOT_CHECKED' }, frozenBasis: { available: false }, registrationAvailable: false,
      dispositionAvailable: false, impactApplicationAvailable: false })
    runtime.__evidenceSnapshotControl = { pointer: { snapshotId: 'bad-private-pointer' }, runtime: { ...runtime } }
    const invalid = await getRuntimeStateLockBasis({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(invalid.lockBasis.frozenInventory).toMatchObject({ available: false, reason: 'SNAPSHOT_ID_INVALID' })
    expect(invalid.lockBasis.outsideSnapshotIntake).toMatchObject({ available: false, reason: 'FROZEN_MEMBERSHIP_UNAVAILABLE', policy: { status: 'NOT_CHECKED' } })
    expect(JSON.stringify(invalid)).not.toMatch(/bad-private-pointer|__evidenceSnapshotControl|lockedEvidenceSnapshot/)
    expect(typeof getRuntimeInstance.mock.calls[0][0].internalEvidenceSnapshotToken).toBe('symbol')
    expect(getRuntimeInstance.mock.calls[0][0].projection).toContain('revision.rootRuntimeId')
    expect(collectionSpy).not.toHaveBeenCalled()
  })
})

describe('SS-042 bounded canonical source reads', () => {
  const input = { scopes: SCOPES, runtimeInstanceId: RUNTIME_ID }
  const setup = (count = 36, contribution = 853) => {
    const sources = collections.get(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES)
    sources.countDocuments = jest.fn().mockResolvedValue(count)
    const evidence = collections.get(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS)
    evidence.aggregate = jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ _id: 'source-1', count: contribution,
        invalidRuntimeIdentityCount: 0,
        versions: ['runtime-revision:1'], sourceVersions: ['runtime-revision:1'] }]),
    })
    return { sources, evidence }
  }
  test('projects recorded document receipt and filename without a verified processing count', async () => {
    const { sources } = setup(1, 0)
    const receipt = { contractVersion: 'document-processing-receipt.v1',
      runId: '123e4567-e89b-42d3-a456-426614174000', inputIndex: 0, contentHash: `sha256:${'a'.repeat(64)}` }
    sources.find.mockReturnValue(makeCursor([{ sourceId: 'source-1', sourceType: 'UPLOADED_DOCUMENT',
      sourceRef: 'synthetic.txt', contentHash: receipt.contentHash, processingReceipt: receipt,
      current: true, stateStatus: 'CURRENT', stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1' }]))
    const result = await listRuntimeStateSources(input)
    expect(result.sourceRegistry[0]).toMatchObject({ sourceRef: 'synthetic.txt', fileName: 'synthetic.txt', processingReceipt: receipt })
    expect(result).not.toHaveProperty('documentsProcessed')
  })
  test.each([null, { raw: 'unexpected storage material' }, { contractVersion: 'wrong' }])('rejects malformed stored processing receipt without exposing its content', async processingReceipt => {
    const { sources } = setup(1, 0)
    sources.find.mockReturnValue(makeCursor([{ sourceId: 'source-1', sourceType: 'UPLOADED_DOCUMENT', processingReceipt,
      current: true, stateStatus: 'CURRENT', stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1' }]))
    await expect(listRuntimeStateSources(input)).rejects.toMatchObject({ status: 503,
      code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
  })
  test('reads source-first with one scoped aggregate and real contribution totals', async () => {
    const { sources, evidence } = setup()
    const result = await listRuntimeStateSources({ ...input, page: 2, pageSize: 10 })
    expect(result).toMatchObject({ total: 36, totalPages: 4, hasMore: true,
      completeness: 'COMPLETE', currency: 'AS_READ',
      sourceRegistry: [{ sourceId: 'source-1', evidenceObjectCount: 853 }] })
    const cursor = sources.find.mock.results[0].value
    expect(cursor.skip).toHaveBeenCalledWith(10)
    expect(cursor.limit).toHaveBeenCalledWith(10)
    expect(evidence.find).not.toHaveBeenCalled()
    expect(evidence.aggregate).toHaveBeenCalledTimes(1)
    const [pipeline, options] = evidence.aggregate.mock.calls[0]
    expect(pipeline[0].$match).toMatchObject({ sourceId: { $in: ['source-1'] },
      $and: expect.any(Array), $or: expect.any(Array) })
    expect(pipeline.at(-1)).toEqual({ $limit: 1 })
    expect(options.maxTimeMS).toBeLessThanOrEqual(2000)
    expect(result.readReceipt.fullLegacyFrameworkStateFetched).toBe(false)
  })
  test.each([
    { runtimeInstanceId: '64b000000000000000000099' }, { runtimeInstanceKey: 'wrong-revision' },
    { runtimeInstanceId: null }, { runtimeInstanceKey: '' },
  ])('rejects contradictory present source identity before returning content: %j', async identity => {
    const { sources, evidence } = setup(1, 0)
    sources.find.mockReturnValue(makeCursor([{ sourceId: 'source-1', title: 'Not returned',
      runtimeInstanceId: RUNTIME_ID, runtimeInstanceKey: 'runtime-one', ...identity,
      current: true, stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1' }]))
    await expect(listRuntimeStateSources(input)).rejects.toMatchObject({
      code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING,
    })
    expect(evidence.aggregate).not.toHaveBeenCalled()
  })
  test('preserves missing runtime ID compatibility when the recorded runtime key matches', async () => {
    const { sources } = setup(1, 0)
    sources.find.mockReturnValue(makeCursor([{ sourceId: 'source-1', runtimeInstanceKey: 'runtime-one',
      current: true, stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1' }]))
    expect(await listRuntimeStateSources(input)).toMatchObject({ completeness: 'COMPLETE', sourceRegistry: [{ sourceId: 'source-1' }] })
  })
  test.each([1, undefined, -1, '0'])('rejects invalid contribution identity count %j', async invalidRuntimeIdentityCount => {
    const { evidence } = setup(1, 0)
    evidence.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([
      { _id: 'source-1', count: 1, invalidRuntimeIdentityCount,
        versions: ['runtime-revision:1'], sourceVersions: ['runtime-revision:1'] },
    ]) })
    await expect(listRuntimeStateSources(input)).rejects.toMatchObject({
      code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING,
    })
  })
  test('applies literal search before paging without replacing scope or currentness', async () => {
    const { sources } = setup()
    await listRuntimeStateSources({ ...input, search: 'a.*[$]' })
    const filter = sources.find.mock.calls[0][0]
    expect(filter.$or).toContainEqual({ current: true })
    expect(filter.$and).toHaveLength(4)
    expect(JSON.stringify(filter.$and.slice(0, 3))).toContain(CUSTOMER_ID)
    expect(JSON.stringify(filter.$and.slice(0, 3))).toContain(TENANT_ID)
    expect(filter.$and[3].$or[0]).toEqual({
      sourceId: { $regex: 'a\\.\\*\\[\\$\\]', $options: 'i' },
    })
    expect(sources.countDocuments.mock.calls[0][0]).toEqual(filter)
  })
  test.each([{ search: {} }, { search: ['one'] }, { sourceId: 1 },
    { sourceType: 'x'.repeat(101) }, { search: 'x'.repeat(241) }, { pageSize: 51 },
    { page: ['1'] }, { page: true }, { pageSize: {} }])(
    'rejects malformed bounded queries before storage: %j', async query => {
      await expect(listRuntimeStateSources({ ...input, ...query })).rejects.toMatchObject({ status: 400 })
      expect(getRuntimeInstance).not.toHaveBeenCalled()
    })
  test('does not fabricate capped totals or navigation', async () => {
    setup(1001, 1001)
    const result = await listRuntimeStateSources(input)
    expect(result).toMatchObject({ total: null, totalCapped: true, totalPages: null,
      hasMore: null, completeness: 'PARTIAL',
      sourceRegistry: [{ evidenceObjectCount: null, evidenceCountCapped: true }] })
  })
  test('returns a verified empty registry without reading evidence', async () => {
    const { sources, evidence } = setup(0)
    sources.find.mockReturnValue(makeCursor([]))
    expect(await listRuntimeStateSources(input)).toMatchObject({ total: 0, sourceRegistry: [],
      completeness: 'COMPLETE', hasMore: false })
    expect(evidence.aggregate).not.toHaveBeenCalled()
    await expect(listRuntimeStateSources({ ...input, sourceId: 'unknown' })).rejects.toMatchObject({ status: 404 })
  })
  test('fails closed on aggregate failure instead of zero contributions', async () => {
    const { evidence } = setup()
    evidence.aggregate.mockReturnValue({ toArray: jest.fn().mockRejectedValue(new Error('timeout')) })
    await expect(listRuntimeStateSources(input)).rejects.toMatchObject({
      status: 503, code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE,
    })
  })
  test('rejects mixed contribution versions', async () => {
    const { evidence } = setup()
    evidence.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([
      { _id: 'source-1', count: 2, invalidRuntimeIdentityCount: 0, versions: ['runtime-revision:1', 'stale'],
        sourceVersions: ['runtime-revision:1'] },
    ]) })
    await expect(listRuntimeStateSources(input)).rejects.toMatchObject({
      code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED,
    })
  })
  test('returns typed empty evidence search and rejects missing exact pairs', async () => {
    const evidence = collections.get(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS)
    evidence.countDocuments = jest.fn().mockResolvedValue(0)
    expect(await listRuntimeStateEvidenceObjects({ ...input, search: 'off-page needle' }))
      .toMatchObject({ evidenceObjects: [], total: 0, pageReceipt: { result: 'EMPTY_PAGE' } })
    const filter = evidence.find.mock.calls[0][0]
    expect(filter.$and).toHaveLength(4)
    expect(filter.$or).toContainEqual({ current: true })
    await expect(listRuntimeStateEvidenceObjects({ ...input, sourceId: 'wrong',
      evidenceObjectId: 'exact' })).rejects.toMatchObject({ status: 404 })
  })
  test('distinguishes a valid empty source from an unknown source', async () => {
    const evidence = collections.get(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS)
    evidence.countDocuments = jest.fn().mockResolvedValue(0)
    expect(await listRuntimeStateEvidenceObjects({ ...input, sourceId: 'source-1' }))
      .toMatchObject({ total: 0, evidenceObjects: [] })
    collections.get(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES).find.mockReturnValue(makeCursor([]))
    await expect(listRuntimeStateEvidenceObjects({ ...input, sourceId: 'unknown' }))
      .rejects.toMatchObject({ status: 404 })
  })
  test('rejects contradictory contribution currentness', async () => {
    const { evidence } = setup()
    evidence.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([
      { _id: 'source-1', count: 2, invalidCurrentCount: 1, invalidRuntimeIdentityCount: 0,
        versions: ['runtime-revision:1'], sourceVersions: ['runtime-revision:1'] },
    ]) })
    await expect(listRuntimeStateSources(input)).rejects.toMatchObject({
      code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_CURRENTNESS_INVALID,
    })
  })
})

describe('SS-040 complete inventory with bounded section projection', () => {
  const scoped = { customerId: CUSTOMER_ID, tenantId: TENANT_ID, runtimeInstanceId: RUNTIME_ID,
    runtimeInstanceKey: 'runtime-one', stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1', current: true }
  const setup = (size, metadata = {}) => {
    const rows = Array.from({ length: size }, (_, index) => ({ ...scoped, _id: String(index).padStart(6, '0'),
      evidenceObjectId: 'evidence-' + index, sourceId: 'source-1', extractedFact: 'Exact stored excerpt.',
      validationStatus: 'UNVALIDATED', proofDependency: [], proofOrderDisposition: 'UNRESOLVED', ...metadata.evidence }))
    const sources = [{ ...scoped, _id: 'source-row', sourceId: 'source-1', sourceType: 'WEBSITE',
      sourceRef: 'https://acme.example', acquisitionStatus: 'ACQUIRED', lineageRef: 'stored-source', ...metadata.source }]
    const sectionRows = [{ ...scoped, _id: 'section-row', sectionKey: 'section_1_executive_summary',
      sectionDetail: { accepted: { supportingEvidenceRefs: size ? [rows[0].evidenceObjectId] : [] } } }]
    for (const [name, values] of [[RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, rows],
      [RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES, sources], [RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, sectionRows]]) {
      collections.set(name, { countDocuments: jest.fn().mockResolvedValue(values.length),
        find: jest.fn((filter) => {
          const after = filter.$and?.flatMap((clause) => clause._id?.$gt ? [clause._id.$gt] : []).at(0)
            || filter._id?.$gt
          let pageSize = 150
          const cursor = makeCursor([])
          cursor.limit.mockImplementation((value) => { pageSize = value; return cursor })
          cursor.toArray.mockImplementation(async () => values.filter((row) => !after || row._id > after).slice(0, pageSize))
          return cursor
        }) })
    }
    return rows
  }
  test.each([499, 500, 501, 853])('reads complete %i inventory under one session with bounded exact projection', async (size) => {
    const rows = setup(size); const session = { id: 'snapshot-session' }
    const result = await getRuntimeOutcomeEvidenceContractSnapshot({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID, session })
    expect(result.inventoryReceipt).toMatchObject({ completeness: 'COMPLETE', collections: { evidence: { totalCount: size } } })
    expect(result.evidenceObjects).toEqual([rows[0]])
    expect(result.evidenceObjects[0]).not.toHaveProperty('currentness')
    const collection = collections.get(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS)
    expect(collection.find).toHaveBeenCalledWith(expect.objectContaining({ $and: expect.any(Array) }), expect.objectContaining({ session, projection: {} }))
    expect(collection.countDocuments).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ session }))
    for (const call of collection.find.mock.results) expect(call.value.limit).toHaveBeenCalledWith(150)
  })
  test('rejects absent source mapping without legacy fallback', async () => {
    const rows = setup(1); rows[0].sourceId = 'missing-source'
    await expect(getRuntimeOutcomeEvidenceContractSnapshot({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })).rejects.toMatchObject({
      code: 'OUTCOME_EVIDENCE_SNAPSHOT_SOURCE_REFERENCE_MISSING', details: { snapshotReceipt: { completeness: 'INCOMPLETE' } } })
  })
  test('rejects tenant/runtime mismatch before returning selected records', async () => {
    const rows = setup(501); rows[500].tenantId = 'other-tenant'
    await expect(getRuntimeOutcomeEvidenceContractSnapshot({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })).rejects.toMatchObject({
      code: 'OUTCOME_EVIDENCE_SNAPSHOT_OUTCOME_EVIDENCE_SCOPE_MISMATCH' })
  })
  test('empty inventory remains complete without invented evidence', async () => {
    setup(0)
    const result = await getRuntimeOutcomeEvidenceContractSnapshot({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(result.evidenceObjects).toEqual([])
    expect(result.inventoryReceipt.collections.evidence.totalCount).toBe(0)
  })
  test('actual repository legacy snapshot retains exact raw bytes and native row hashes without display descriptors', async () => {
    const rows = setup(1), originalBytes = JSON.stringify(rows[0])
    const result = await getRuntimeOutcomeEvidenceContractSnapshot({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(JSON.stringify(result.evidenceObjects[0])).toBe(originalBytes)
    expect(result.inventoryReceipt.collections.evidence.records[0].hash).toBe(snapshotHash(JSON.parse(originalBytes)))
    for (const row of [...result.evidenceObjects, ...result.sourceRegistry]) {
      for (const key of ['sourceCapture', 'evidenceSupport', 'sourceCaptureAvailability', 'evidenceSupportAvailability']) {
        expect(Object.hasOwn(row, key)).toBe(false)
      }
    }
    const replay = await getRuntimeOutcomeEvidenceContractSnapshot({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(JSON.stringify(replay.inventoryReceipt)).toBe(JSON.stringify(result.inventoryReceipt))
  })
  test('stored descriptor reaches raw inventory and bounded reader with exact native identity and admission basis', async () => {
    const descriptor = metadataDescriptor(scoped)
    const metadata = { source: { controlledReplayProvenance: descriptor, acquisitionStatus: 'NOT_ATTEMPTED',
      sourceRef: descriptor.binding.fixture.sourceUrl },
      evidence: { controlledReplayProvenance: descriptor } }
    setup(1, metadata)
    const snapshot = await getRuntimeOutcomeEvidenceContractSnapshot({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(snapshot.sourceRegistry[0].controlledReplayProvenance).toEqual(descriptor)
    expect(snapshot.evidenceObjects[0].controlledReplayProvenance).toEqual(descriptor)
    const page = await listRuntimeStateEvidenceObjects({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(page.sourceRegistry[0].controlledReplayProvenance).toEqual(descriptor)
    expect(page.evidenceObjects[0].controlledReplayProvenance).toEqual(descriptor)
    expect(page.stateVersion).not.toBe(descriptor.binding.basisStateVersion)
    expect(collections.get(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES).find.mock.calls.some(([, options]) =>
      options.projection.controlledReplayProvenance === 1)).toBe(true)
    for (const changed of [{ source: metadata.source }, { ...metadata, source: { ...metadata.source, acquisitionStatus: 'ACQUIRED' } }]) {
      setup(1, changed)
      await expect(listRuntimeStateEvidenceObjects({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })).rejects.toMatchObject({
        details: { reason: 'CONTROLLED_REPLAY_CONTRACT_INVALID' } })
      await expect(getRuntimeOutcomeEvidenceContractSnapshot({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })).rejects.toMatchObject({
        details: { reason: 'CONTROLLED_REPLAY_CONTRACT_INVALID' } })
    }
  })
  test('actual producer and native mapper metadata reaches raw inventory and bounded evidence read with exact scoped source reuse', async () => {
    const product = await ingestUploadedDocumentDiscoveryEvidence({ batchOutcomes: true, acquisitionProfile: 'STANDARD',
      capturedAt: '2026-10-14T12:00:00.000Z', documentSources: [{ fileName: 'qualified.txt', mimeType: 'text/plain',
        textContent: 'The fictional pilot reviewer has not provided support and has not approved the trial.' }] })
    const native = createRuntimeStateLegacySourceRowSet({ legacyInput: { rawBsonBytes: 4096, sections: {},
      evidencePack: { sourceRegistry: product.sourceRegistry, evidenceObjects: product.evidenceObjects }, intelligenceGraph: { graphVersion: 'fixture-v1', nodes: [], edges: [] } },
    scope: { runtimeInstanceId: RUNTIME_ID, runtimeInstanceKey: 'runtime-one', customerId: CUSTOMER_ID, tenantId: TENANT_ID },
    stateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174000', migrationReceiptId: '64b7f7a4e1e5f8320c000004',
    migrationTimestamp: '2026-10-14T12:00:00.000Z' })
    const source = { ...native.rows.evidenceSources[0], ...scoped, _id: 'source-row' }
    const evidence = { ...native.rows.evidenceObjects[0], ...scoped, _id: '000000' }
    setup(1, { source, evidence })
    const result = await getRuntimeOutcomeEvidenceContractSnapshot({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(result.evidenceObjects[0].evidenceSupport).toEqual(product.evidenceObjects[0].evidenceSupport)
    expect(result.sourceRegistry[0].sourceCapture).toEqual(product.sourceRegistry[0].sourceCapture)
    const page = await listRuntimeStateEvidenceObjects({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(page.evidenceObjects[0].evidenceSupport).toEqual(product.evidenceObjects[0].evidenceSupport)
    expect(page.sourceRegistry[0].sourceCaptureAvailability).toBe('RECORDED')
    expect(collections.get(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES).find.mock.calls.every(([filter]) =>
      JSON.stringify(filter).includes(CUSTOMER_ID) && JSON.stringify(filter).includes(TENANT_ID))).toBe(true)
    setup(1, { source: { ...source, sourceCapture: { ...source.sourceCapture, captureTextHash: 'sha256:' + 'f'.repeat(64) } }, evidence })
    await expect(listRuntimeStateEvidenceObjects({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })).rejects.toMatchObject({ code: 'SOURCE_EVIDENCE_CONTRACT_INVALID' })
    await expect(getRuntimeOutcomeEvidenceContractSnapshot({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })).rejects.toMatchObject({ code: 'SOURCE_EVIDENCE_CONTRACT_INVALID' })
  })
})

describe('runtime State Storage V2 repository', () => {
  test('bounded control includes root marker and explicitly transports a native private orphan witness', async () => {
    const { attachNativeControlledReplayIsolation, assertNoControlledReplayIsolation } = await import('../services/controlledReplayIsolationService.js')
    const { default: Source } = await import('../models/RuntimeEvidenceSource.js')
    const { default: Evidence } = await import('../models/RuntimeEvidenceObject.js')
    const native = makeControl({ stateVersion: 'rsv2:11111111-1111-4111-8111-111111111111' })
    const probe = value => ({ select() { return this }, maxTimeMS() { return this }, limit() { return this }, lean: async () => value })
    const first = jest.spyOn(Source, 'findOne').mockReturnValue(probe({ _id: 'orphan' }))
    const second = jest.spyOn(Evidence, 'findOne').mockReturnValue(probe(null))
    try {
      await attachNativeControlledReplayIsolation(native)
      getRuntimeInstance.mockResolvedValue(native)
      const control = await getRuntimeStateControl({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
      expect(() => assertNoControlledReplayIsolation(control)).toThrow()
      expect(getRuntimeInstance).toHaveBeenCalledWith(expect.objectContaining({ projection: expect.stringContaining('controlledReplayIsolation') }))
      getRuntimeInstance.mockResolvedValue(makeControl({ controlledReplayIsolation: null }))
      expect(() => assertNoControlledReplayIsolation(control)).toThrow()
      const marked = await getRuntimeStateControl({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
      expect(marked).toHaveProperty('controlledReplayIsolation', null)
      expect(() => assertNoControlledReplayIsolation(marked)).toThrow()
    } finally { first.mockRestore(); second.mockRestore() }
  })
  test('loads control through a projection that excludes framework_state', async () => {
    const control = await getRuntimeStateControl({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })

    expect(control).toMatchObject({
      id: RUNTIME_ID,
      runtimeInstanceKey: 'runtime-one',
      stateVersion: 'runtime-revision:1',
      source: 'runtime_state_v2.control_projection',
    })
    expect(control.readReceipt).toEqual({
      source: 'runtime_state_v2.control_projection',
      serializedPayloadBytes: expect.any(Number),
      maxSerializedPayloadBytes: RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
    expect(getRuntimeInstance).toHaveBeenCalledWith(expect.objectContaining({
      runtimeInstanceId: RUNTIME_ID,
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
      projection: RUNTIME_STATE_V2_CONTROL_PROJECTION,
    }))
    expect(RUNTIME_STATE_V2_CONTROL_PROJECTION).not.toContain('framework_state')
    expect(collectionSpy).not.toHaveBeenCalled()
  })

  test('loads renderer summaries without pretending they are selected section details', async () => {
    const section = {
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      current: true,
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      sectionDetail: makeSectionDetail(),
    }
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, {
      find: jest.fn((_filter, { projection }) => makeCursor([projectRendererRow(section, projection)])),
    })

    const result = await getRuntimeStateRendererSections({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result).toMatchObject({
      sectionCount: 1,
      stateVersion: 'runtime-revision:1',
      sections: [{
        sectionKey: 'section_1_executive_summary',
        projectionScope: 'RENDERER_SUMMARY',
        rendererSummary: projectRendererRow(section, __testables.RUNTIME_STATE_V2_RENDERER_SECTION_PROJECTION).sectionDetail,
      }],
      readReceipt: expect.objectContaining({
        source: 'runtime_state_v2.renderer_sections',
        bounded: true,
        fullLegacyFrameworkStateFetched: false,
      }),
    })
    expect(collectionSpy).toHaveBeenCalledWith(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS)
    expect(result.sections[0]).not.toHaveProperty('sectionDetail')
  })

  test('projects six rich rows below 512KB in MongoDB while selected detail stays full fidelity', async () => {
    const narrative = Array.from({ length: 6 }, () => 'n'.repeat(4000))
    const detail = JSON.parse(JSON.stringify(makeSectionDetail({
      generated: { content: 'Canonical generated', sectionIntelligence: { narrative }, sections: narrative, futureCache: narrative },
      accepted: { content: 'Canonical accepted', sections: narrative },
      intelligence: {
        sectionIntelligence: { sectionNarrative: 'Rich narrative', strategicTensions: narrative },
        displayProjection: { generatedInsight: { sections: narrative }, supportingEvidence: { items: narrative } },
        scopedEvidence: { sourceRefs: narrative.map((safeDisplay, index) => ({ refKey: `e${index}`, safeDisplay })), projection: { includedCount: 6 } },
        reasoningCoverage: { includedCount: 6, dimensionCoverage: narrative },
      },
      gsilContext: { excerpts: narrative },
    })))
    const rows = Array.from({ length: 6 }, (_, index) => ({
      sectionKey: `section_${index}`, current: true, stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1', sectionDetail: detail, futureCache: narrative,
    }))
    const original = structuredClone(rows)
    expect(Buffer.byteLength(JSON.stringify(rows))).toBeGreaterThan(RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES)
    const find = jest.fn((_filter, { projection }) => makeCursor(projection.sectionDetail === 1
      ? [rows[0]] : rows.map((row) => projectRendererRow(row, projection))))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })
    const result = await getRuntimeStateRendererSections({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(result.sectionCount).toBe(6)
    expect(result.readReceipt.serializedPayloadBytes).toBeLessThan(RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES)
    expect(Object.values(find.mock.calls[0][1].projection).every((value) => value === 1)).toBe(true)
    expect(find.mock.calls[0][1].projection).not.toHaveProperty('sectionDetail.generated.sectionIntelligence')
    expect(result.sections[0].rendererSummary.generated).toEqual({ content: 'Canonical generated' })
    expect(result.sections[0].rendererSummary).not.toHaveProperty('intelligence')
    expect(result.sections[0].rendererSummary).not.toHaveProperty('gsilContext')
    expect(result.sections[0].rendererSummary.generated).not.toHaveProperty('futureCache')
    expect(projectRendererRow(rows[0], find.mock.calls[0][1].projection)).not.toHaveProperty('futureCache')
    const selected = await getRuntimeStateSectionSummary({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID, sectionKey: 'section_0' })
    expect(selected.section.sectionDetail).toEqual(detail)
    expect(rows).toEqual(original)
  })

  test('still rejects renderer rows exceeding the cap after projection', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      sectionKey: `section_${index}`, sectionDetail: makeSectionDetail({ input: 'x'.repeat(100000) }),
    }))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find: jest.fn(() => makeCursor(rows)) })
    await expect(getRuntimeStateRendererSections({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID }))
      .rejects.toMatchObject({ status: 503, code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
  })

  test.each(RUNTIME_SECTION_DETAIL_FORBIDDEN_KEYS)('rejects nested forbidden section key %s in the summary', async (key) => {
    const row = {
      sectionKey: 'section_0', current: true, stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1',
      sectionDetail: makeSectionDetail({ input: { nested: { [key]: 'forbidden' } } }),
    }
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, {
      find: jest.fn((_filter, { projection }) => makeCursor([projectRendererRow(row, projection)])),
    })
    await expect(getRuntimeStateRendererSections({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID }))
      .rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DETAIL_INVALID })
  })

  test.each([
    [{}, 'missing scope'],
    [{ customer: { _id: CUSTOMER_ID } }, 'missing tenant'],
    [{ tenant: { _id: TENANT_ID } }, 'missing customer'],
    [{ customer: { _id: 'not-an-object-id' }, tenant: { _id: TENANT_ID } }, 'malformed customer'],
    [{ customer: { _id: CUSTOMER_ID }, tenant: { _id: TENANT_ID, customerId: '507f1f77bcf86cd799439099' } }, 'contradictory tenant customer'],
    [{ platformRoles: ['SUPER_ADMIN'] }, 'broad platform scope'],
  ])('fails closed before RuntimeInstance lookup for %s', async (scopes) => {
    await expect(getRuntimeStateControl({ scopes, runtimeInstanceId: RUNTIME_ID }))
      .rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_SCOPE_REQUIRED })
    expect(getRuntimeInstance).not.toHaveBeenCalled()
  })

  test('fails closed when the control identity is incomplete', async () => {
    getRuntimeInstance.mockResolvedValue(makeControl({ customerId: '' }))

    await expect(getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_INVALID })
  })

  test('fails closed when the control identity is malformed', async () => {
    getRuntimeInstance.mockResolvedValue(makeControl({ id: 'not-an-object-id' }))

    await expect(getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_INVALID })
  })

  test('fails closed when the control record is absent', async () => {
    getRuntimeInstance.mockResolvedValue(null)

    await expect(getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_INVALID })
  })

  test('fails closed when the control has no state version', async () => {
    getRuntimeInstance.mockResolvedValue(makeControl({ stateVersion: '', revision: { revisionNumber: 1 } }))

    await expect(getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING })
  })

  test('accepts a legacy runtimeStateVersion as a read-only compatibility alias', async () => {
    getRuntimeInstance.mockResolvedValue(makeControl({
      stateVersion: undefined,
      runtimeStateVersion: 'legacy-runtime-state-v1',
    }))

    const control = await getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(control.stateVersion).toBe('legacy-runtime-state-v1')
  })

  test('fails closed when explicit control state versions disagree', async () => {
    getRuntimeInstance.mockResolvedValue(makeControl({
      stateVersion: 'runtime-revision:1',
      runtimeStateVersion: 'runtime-revision:2',
    }))

    await expect(getRuntimeStateControl({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED })
  })

  test('returns validated detail only for the bounded selected section', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      truthStatus: 'ACCEPTED',
      truthHash: 'sha256:truth',
      summary: 'bounded summary',
      content: 'large content must not be returned',
      sectionDetail: makeSectionDetail(),
      evidenceRefs: [{ evidenceObjectId: 'evidence-1' }],
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    const result = await getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })

    expect(result.section).toMatchObject({
      sectionKey: 'section_1_executive_summary',
      stateVersion: 'runtime-revision:1',
      summary: 'bounded summary',
      sectionDetail: expect.objectContaining({ input: 'Migrated section input' }),
    })
    expect(result.section).not.toHaveProperty('content')
    expect(result.source).toBe('runtime_state_v2.section_summary')
    expect(result.readReceipt).toEqual({
      source: 'runtime_state_v2.section_summary',
      serializedPayloadBytes: expect.any(Number),
      maxSerializedPayloadBytes: RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots)/)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ $and: expect.any(Array) }),
      expect.objectContaining({
        projection: expect.any(Object),
        maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
      }),
    )
    expect(find.mock.calls[0][1].projection).toHaveProperty('sectionDetail', 1)
  })

  test.each(['-1', '100', '01', ['1'], {}, '1.5', '', 100, NaN])('rejects invalid history selector %j before storage reads', async historyRevision => {
    await expect(getRuntimeStateSectionSummary({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary', historyRevision })).rejects.toMatchObject({
      status: 400, code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_QUERY,
    })
  })

  test.each(['valid', 'tampered', 'missing', 'wrong-scope', 'wrong-owner', 'ambiguous'])('reads one history body with native scope and hash proof: %s', async kind => {
    const sectionKey = 'section_1_executive_summary'
    const pair = { generated: { content: 'Original bounded content', inputHash: 'a'.repeat(64) }, accepted: null }
    const targetState = 'rsv2:00000000-0000-4000-8000-000000000001'
    const sourceHash = `sha256:${'a'.repeat(64)}`
    const reference = { version: 'runtime-section-history.v1', stateVersion: targetState,
      sourceHash, index: -1, hash: hashSectionHistoryPair(pair), hasGenerated: true, hasAccepted: false }
    const common = { customerId: CUSTOMER_ID, tenantId: TENANT_ID,
      runtimeInstanceId: RUNTIME_ID, runtimeInstanceKey: 'runtime-one', sectionKey }
    const owner = { ...common, stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1',
      sectionDetail: makeSectionDetail({ revisions: [{ revisionNumber: 1, replacedAt: '2026-10-19T19:00:00.000Z',
        generated: null, historyReference: reference }] }) }
    const target = { ...common, stateVersion: targetState, sourceStateVersion: targetState, sourceHash, current: false,
      legacyPath: `framework_state.sections.${sectionKey}`,
      projectionReceipt: { stateVersion: targetState, sourceHash, logicalPath: `framework_state.sections.${sectionKey}`,
        algorithm: 'ss014-legacy-domain-canonical-json-v1', mappingVersion: 'ss014-v2-mapping-v1' },
      sectionDetail: makeSectionDetail(pair) }
    if (kind === 'tampered') target.sectionDetail.generated.content = 'changed'
    if (kind === 'wrong-scope') target.tenantId = '507f1f77bcf86cd799439099'
    if (kind === 'wrong-owner') owner.runtimeInstanceId = '507f1f77bcf86cd799439099'
    const find = jest.fn(filter => makeCursor(filter.stateVersion === targetState
      ? kind === 'missing' ? [] : kind === 'ambiguous' ? [target, target] : [target] : [owner]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })
    const read = () => getRuntimeStateSectionSummary({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID,
      sectionKey, historyRevision: '0' })
    if (kind !== 'valid') { await expect(read()).rejects.toHaveProperty('code'); return }
    const result = await read()
    expect(result.history).toEqual({ revisionIndex: 0, reference,
      revision: { revisionNumber: 1, replacedAt: '2026-10-19T19:00:00.000Z', generated: pair.generated } })
    expect(result.section).not.toHaveProperty('sectionDetail')
    expect(result.readReceipt).toMatchObject({ bounded: true, fullLegacyFrameworkStateFetched: false })
    expect(find.mock.calls[1][0]).toMatchObject({ ...common, stateVersion: targetState, sourceHash })
    expect(find.mock.calls[1][1]).toMatchObject({ maxTimeMS: expect.any(Number) })
  })

  test('restores empty object fields minimized by stored V2 section documents', async () => {
    const minimizedDetail = makeSectionDetail()
    delete minimizedDetail.validation
    delete minimizedDetail.confidence
    delete minimizedDetail.additionalEvidence
    delete minimizedDetail.gsilContext
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      sectionDetail: minimizedDetail,
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    const result = await getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })

    expect(result.section.sectionDetail).toMatchObject({
      validation: {},
      confidence: {},
      additionalEvidence: {},
      gsilContext: {},
    })
  })

  test('fails closed when selected-section detail is missing or invalid', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      summary: 'bounded summary',
      sectionDetail: { input: 'incomplete detail' },
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DETAIL_INVALID })
  })

  test('fails closed when selected-section detail exceeds the bounded payload limit', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'ACCEPTED',
      current: true,
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      summary: 'bounded summary',
      sectionDetail: makeSectionDetail({ input: 'x'.repeat((256 * 1024) + 1) }),
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DETAIL_INVALID })
  })

  test('applies the direct-read maxTimeMS bound to V2 cursors', async () => {
    const cursor = makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      summary: 'bounded summary',
      sectionDetail: makeSectionDetail(),
    }])
    const find = jest.fn(() => cursor)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })

    expect(find.mock.calls[0][1]).toMatchObject({ maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS })
    expect(cursor.maxTimeMS).toHaveBeenCalledWith(RUNTIME_STATE_V2_READ_MAX_TIME_MS)
  })

  test('fails closed when a V2 cursor cannot apply maxTimeMS', async () => {
    const find = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) }))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
  })

  test.each([
    ['limit', { sort: { updatedAt: -1 }, limit: 1 }],
    ['sort', { sort: { updatedAt: -1 }, limit: 1 }],
    ['skip', { sort: { updatedAt: -1 }, skip: 1, limit: 1 }],
  ])('fails closed when the requested cursor %s capability is unavailable', async (capability, options) => {
    const cursor = makeCursor([])
    delete cursor[capability]
    const find = jest.fn(() => cursor)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    const graphRead = __testables.readMany({
      collectionName: RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS,
      filter: {},
      ...options,
    })

    await expect(graphRead).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
    expect(cursor.toArray).not.toHaveBeenCalled()
  })

  test('fails closed when a projected row exceeds the serialized read ceiling', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      summary: 'x'.repeat(RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES),
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
  })

  test('fails closed when the selected section lacks a source-state receipt', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING })
  })

  test('sanitizes nested section evidence references while preserving logical lineage', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_1_executive_summary',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      sectionDetail: makeSectionDetail(),
      evidenceRefs: [{
        evidenceObjectId: 'evidence-1',
        source: 'runtime_evidence_objects',
        lineage: {
          logicalSource: 'framework_state.evidence_pack',
          canonicalSource: 'runtime_graph_elements',
        },
      }],
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    const result = await getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    })

    expect(result.section.evidenceRefs).toEqual([{
      evidenceObjectId: 'evidence-1',
      lineage: {
        logicalSource: 'framework_state.evidence_pack',
      },
    }])
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots|graph_elements)/)
  })

  test('rejects unsafe logical section keys before touching V2 storage', async () => {
    await expect(getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'framework_state.sections.$where',
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_SECTION_KEY })
    expect(collectionSpy).not.toHaveBeenCalled()
  })

  test('rejects unbounded evidence pages before touching V2 storage', async () => {
    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 51,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_PAGE })
    expect(collectionSpy).not.toHaveBeenCalled()

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1001,
      pageSize: 1,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.INVALID_PAGE })
    expect(collectionSpy).not.toHaveBeenCalled()
  })

  test('fails closed on mixed evidence state versions', async () => {
    const find = jest.fn(() => makeCursor([
      { evidenceObjectId: 'evidence-1', stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1' },
      { evidenceObjectId: 'evidence-2', stateVersion: 'runtime-revision:2', sourceStateVersion: 'runtime-revision:2' },
    ]))
    const countDocuments = jest.fn().mockResolvedValue(2)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 2,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED })
  })

  test('returns a bounded current section catalogue from the bootstrap read', async () => {
    const find = jest.fn(() => makeCursor([
      {
        sectionKey: 'section_b',
        stateStatus: 'ACCEPTED',
        current: true,
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        truthStatus: 'ACCEPTED',
        summary: 'second section',
        content: 'full content must not be returned',
      },
      {
        sectionKey: 'section_a',
        stateStatus: 'GENERATED',
        current: true,
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        truthStatus: 'GENERATED',
        summary: 'first section',
      },
    ]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    const result = await getRuntimeStateBootstrap({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result).toMatchObject({
      control: expect.objectContaining({ stateVersion: 'runtime-revision:1' }),
      sectionCount: 2,
      stateVersion: 'runtime-revision:1',
      source: 'runtime_state_v2.bootstrap',
    })
    expect(result.sections).toEqual([
      expect.objectContaining({ sectionKey: 'section_b', summary: 'second section' }),
      expect.objectContaining({ sectionKey: 'section_a', summary: 'first section' }),
    ])
    expect(result.sections[0]).not.toHaveProperty('content')
    expect(result.readReceipt).toEqual(expect.objectContaining({
      source: 'runtime_state_v2.bootstrap',
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    }))
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ $and: expect.any(Array) }),
      expect.objectContaining({
        projection: expect.any(Object),
        maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
      }),
    )
    expect(find.mock.calls[0][1].projection).not.toHaveProperty('sectionDetail')
    expect(find.mock.results[0].value.limit).toHaveBeenCalledWith(RUNTIME_STATE_V2_SECTION_CATALOGUE_LIMIT + 1)
  })

  test('fails closed when the bootstrap catalogue has mixed state versions', async () => {
    const find = jest.fn(() => makeCursor([
      {
        sectionKey: 'section_a',
        stateStatus: 'ACCEPTED',
        current: true,
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
      },
      {
        sectionKey: 'section_b',
        stateStatus: 'GENERATED',
        current: true,
        stateVersion: 'runtime-revision:2',
        sourceStateVersion: 'runtime-revision:2',
      },
    ]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateBootstrap({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID }))
      .rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED })
  })

  test('fails closed when the bootstrap catalogue contains duplicate logical sections', async () => {
    const find = jest.fn(() => makeCursor([
      {
        sectionKey: 'section_a',
        stateStatus: 'ACCEPTED',
        current: true,
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
      },
      {
        sectionKey: 'SECTION_A',
        stateStatus: 'GENERATED',
        current: true,
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
      },
    ]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateBootstrap({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID }))
      .rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_DUPLICATE })
  })

  test('fails closed when a bootstrap section lacks the canonical current marker', async () => {
    const find = jest.fn(() => makeCursor([{
      sectionKey: 'section_a',
      stateStatus: 'ACCEPTED',
      current: false,
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })

    await expect(getRuntimeStateBootstrap({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID }))
      .rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.SECTION_CURRENTNESS_INVALID })
  })

  test('limits evidence page and bounded count reads to current rows', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-current',
      sourceId: 'source-1',
      current: true,
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    const countDocuments = jest.fn().mockResolvedValue(1)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    await listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })

    const filter = find.mock.calls[0][0]
    expect(filter).toEqual(expect.objectContaining({
      $or: [
        { stateStatus: 'CURRENT' },
        { status: 'CURRENT' },
        { current: true },
        { isCurrent: true },
      ],
    }))
    expect(countDocuments).toHaveBeenCalledWith(
      filter,
      expect.objectContaining({
        maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
        limit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
      }),
    )
  })

  test('returns the bounded customer-safe evidence fields needed by the Runtime Workspace', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-current',
      sourceId: 'source-1',
      lineageRef: 'framework_state.evidence_pack.evidenceObjects[0]',
      sourceType: 'WEBSITE',
      extractedFact: 'A bounded extracted fact.',
      sourceLocation: { fieldPath: 'customer.observation', url: 'https://acme.example#finding' },
      validationStatus: 'VALID',
      confidence: { level: 'HIGH', score: 0.9, basis: ['source-backed'] },
      materiality: 'HIGH',
      materialityScore: 0.8,
      title: 'Customer problem',
      summary: 'A bounded summary.',
      reviewStatus: 'PENDING',
      acceptanceState: 'ELIGIBLE',
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    const countDocuments = jest.fn().mockResolvedValue(1)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    const result = await listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })

    expect(result.evidenceObjects).toEqual([expect.objectContaining({
      evidenceObjectId: 'evidence-current',
      sourceId: 'source-1',
      lineageRef: 'framework_state.evidence_pack.evidenceObjects[0]',
      sourceType: 'WEBSITE',
      extractedFact: 'A bounded extracted fact.',
      sourceLocation: { fieldPath: 'customer.observation', url: 'https://acme.example#finding' },
      validationStatus: 'VALID',
      confidence: { level: 'HIGH', score: 0.9, basis: ['source-backed'] },
      materiality: 'HIGH',
      materialityScore: 0.8,
      title: 'Customer problem',
      summary: 'A bounded summary.',
    })])
    expect(result.sourceRegistry).toEqual([expect.objectContaining({
      sourceId: 'source-1',
      sourceType: 'WEBSITE',
      label: 'Customer website',
      url: 'https://acme.example',
      acquisitionStatus: 'ACQUIRED',
      stateVersion: 'runtime-revision:1',
    })])
    expect(result.lineage.sources).toEqual(result.sourceRegistry)
    const sourceFind = collections.get(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES).find
    expect(sourceFind).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: { $in: ['source-1'] } }),
      expect.objectContaining({ maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS }),
    )
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots|graph_elements)/)
  })

  test.each([42, ['invalid'], 'x'.repeat(8193)])('rejects malformed persisted source locations on customer evidence reads: %#', sourceLocation => {
    expect(() => __testables.serializeEvidenceObject({ evidenceObjectId: 'fixture-evidence', sourceLocation }, 'fixture-revision'))
      .toThrow('The recorded source location is invalid.')
  })

  test('fails closed when page evidence does not have matching current source lineage', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-current',
      sourceId: 'missing-source',
      current: true,
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    const countDocuments = jest.fn().mockResolvedValue(1)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES, {
      find: jest.fn().mockReturnValue(makeCursor([])),
    })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_MISSING })
  })

  test('fails closed when an evidence source has contradictory currentness markers', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-current',
      sourceId: 'source-1',
      current: true,
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    const countDocuments = jest.fn().mockResolvedValue(1)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_SOURCES, {
      find: jest.fn().mockReturnValue(makeCursor([{
        sourceId: 'source-1',
        sourceType: 'WEBSITE',
        current: false,
        stateStatus: 'CURRENT',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
      }])),
    })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_SOURCE_CURRENTNESS_INVALID })
  })

  test('fails closed when an evidence object lacks a source-state receipt', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-1',
      sourceId: 'source-1',
      stateVersion: 'runtime-revision:1',
    }]))
    const countDocuments = jest.fn().mockResolvedValue(1)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING })
  })

  test('returns an explicit receipt for an empty non-first evidence page', async () => {
    const find = jest.fn(() => makeCursor([]))
    const countDocuments = jest.fn().mockResolvedValue(3)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    const result = await listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 2,
      pageSize: 2,
    })

    expect(result.evidenceObjects).toEqual([])
    expect(result.pageReceipt).toMatchObject({
      type: 'RUNTIME_STATE_V2_EVIDENCE_PAGE',
      result: 'EMPTY_PAGE',
      page: 2,
      stateVersion: 'runtime-revision:1',
      total: 3,
    })
    expect(countDocuments).toHaveBeenCalledWith(
      expect.any(Object),
      {
        maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
        limit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
      },
    )
    expect(result.source).toBe('runtime_state_v2.evidence_page')
    expect(result.readReceipt).toEqual({
      source: 'runtime_state_v2.evidence_page',
      serializedPayloadBytes: expect.any(Number),
      maxSerializedPayloadBytes: RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
  })

  test('returns an explicit capped-count receipt without an unbounded count', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-1',
      sourceId: 'source-1',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      createdAt: new Date('2026-08-22T00:00:00.000Z'),
    }]))
    const countDocuments = jest.fn().mockResolvedValue(RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    const result = await listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })

    expect(result).toMatchObject({
      total: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
      totalCapped: true,
      countLimit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
    })
    expect(countDocuments.mock.calls[0][1]).toEqual({
      maxTimeMS: RUNTIME_STATE_V2_READ_MAX_TIME_MS,
      limit: RUNTIME_STATE_V2_EVIDENCE_COUNT_LIMIT,
    })
  })

  test('fails closed when bounded evidence counting is unavailable', async () => {
    const find = jest.fn(() => makeCursor([{
      evidenceObjectId: 'evidence-1',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 1,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
  })

  test('fails closed when the first evidence page is empty despite a positive count', async () => {
    const find = jest.fn(() => makeCursor([]))
    const countDocuments = jest.fn().mockResolvedValue(3)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find, countDocuments })

    await expect(listRuntimeStateEvidenceObjects({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      page: 1,
      pageSize: 2,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.EVIDENCE_MISSING })
  })

  test('fails closed when the graph manifest is stale', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'STALE',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_NOT_CURRENT })
  })

  test('fails closed when the graph source version differs from the selected version', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:0',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED })
  })

  test('returns the graph source-state receipt for a current manifest', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      stateStatus: 'CURRENT',
      sourceStateVersion: 'runtime-revision:1',
      sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    const result = await getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result.manifest).toMatchObject({
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'CURRENT',
    })
    expect(result.source).toBe('runtime_state_v2.graph_manifest')
    expect(result.readReceipt).toEqual({
      maxTimeMS: 2000,
      requestTimeoutMS: 6000,
      workTimeoutMS: 5500,
      cleanupReserveMS: 500,
      source: 'runtime_state_v2.graph_manifest',
      serializedPayloadBytes: expect.any(Number),
      maxSerializedPayloadBytes: RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
  })

  test('returns a bounded current V2 graph projection with deterministic edge and endpoint reads', async () => {
    const snapshotFind = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      current: true,
      stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      graphVersion: '2.2',
      graphHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      counts: { nodeCount: 10, edgeCount: 20 },
      metadata: {
        artifactType: 'runtime-intelligence-graph',
        health: { state: 'HEALTHY' },
      },
    }]))
    const edgeCursor = makeCursor([{
      snapshotId: 'snapshot-1',
      graphVersion: '2.2',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      elementType: 'EDGE',
      elementKey: 'edge-1',
      fromElementKey: 'node-1',
      toElementKey: 'node-2',
      relationshipType: 'SOURCE_PRODUCES_EVIDENCE',
      attributes: { relationshipDisplayName: 'Source Produces Evidence', customerVisible: true },
    }])
    const nodeCursor = makeCursor([
      {
        snapshotId: 'snapshot-1',
        graphVersion: '2.2',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        elementType: 'NODE',
        elementKey: 'node-1',
        label: 'Website source',
        attributes: { nodeType: 'SOURCE', entityDisplayName: 'Source' },
      },
      {
        snapshotId: 'snapshot-1',
        graphVersion: '2.2',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        elementType: 'NODE',
        elementKey: 'node-2',
        label: 'Evidence',
        attributes: { nodeType: 'EVIDENCE', entityDisplayName: 'Evidence' },
      },
    ])
    const elementFind = jest.fn()
      .mockReturnValueOnce(edgeCursor)
      .mockReturnValueOnce(nodeCursor)
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find: snapshotFind })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_ELEMENTS, { find: elementFind })

    const result = await getRuntimeStateGraphProjection({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result.graph).toMatchObject({
      available: true,
      graphVersion: '2.2',
      totalNodeCount: 10,
      totalEdgeCount: 20,
      projection: { truncated: true, edgeLimit: 48, nodeLimit: 96 },
      nodes: [
        { nodeId: 'node-1', nodeType: 'SOURCE' },
        { nodeId: 'node-2', nodeType: 'EVIDENCE' },
      ],
      edges: [{
        edgeId: 'edge-1',
        edgeType: 'SOURCE_PRODUCES_EVIDENCE',
        fromNodeId: 'node-1',
        toNodeId: 'node-2',
      }],
    })
    expect(edgeCursor.sort).toHaveBeenCalledWith({ relationshipType: 1, elementKey: 1 })
    expect(edgeCursor.limit).toHaveBeenCalledWith(RUNTIME_STATE_V2_GRAPH_EDGE_LIMIT)
    expect(elementFind.mock.calls[0][0]).toMatchObject({
      snapshotId: 'snapshot-1',
      graphVersion: '2.2',
      stateVersion: 'runtime-revision:1',
      elementType: 'EDGE',
    })
    expect(JSON.stringify(elementFind.mock.calls[0][0])).toContain(CUSTOMER_ID)
    expect(JSON.stringify(elementFind.mock.calls[0][0])).toContain(TENANT_ID)
    expect(result.readReceipt).toMatchObject({
      source: 'runtime_state_v2.graph_projection',
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots|graph_elements)/)
  })

  test('fails closed when a bounded graph edge endpoint is missing', async () => {
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, {
      find: jest.fn(() => makeCursor([{
        snapshotId: 'snapshot-1',
        current: true,
        stateStatus: 'CURRENT',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        graphVersion: '2.2',
        counts: { nodeCount: 2, edgeCount: 1 },
      }])),
    })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_ELEMENTS, {
      find: jest.fn()
        .mockReturnValueOnce(makeCursor([{
          snapshotId: 'snapshot-1',
          graphVersion: '2.2',
          stateVersion: 'runtime-revision:1',
          sourceStateVersion: 'runtime-revision:1',
          elementType: 'EDGE',
          elementKey: 'edge-1',
          fromElementKey: 'node-1',
          toElementKey: 'node-missing',
          relationshipType: 'SOURCE_PRODUCES_EVIDENCE',
        }]))
        .mockReturnValueOnce(makeCursor([{
          snapshotId: 'snapshot-1',
          graphVersion: '2.2',
          stateVersion: 'runtime-revision:1',
          sourceStateVersion: 'runtime-revision:1',
          elementType: 'NODE',
          elementKey: 'node-1',
          attributes: { nodeType: 'SOURCE' },
        }])),
    })

    await expect(getRuntimeStateGraphProjection({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID })
  })

  test('fails closed when a current graph manifest has incomplete graph identity', async () => {
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, {
      find: jest.fn(() => makeCursor([{
        current: true,
        stateStatus: 'CURRENT',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        graphVersion: '2.2',
      }])),
    })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_IDENTITY_INVALID })
  })

  test('fails closed when graph elements carry a mixed source-state version', async () => {
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, {
      find: jest.fn(() => makeCursor([{
        snapshotId: 'snapshot-1',
        current: true,
        stateStatus: 'CURRENT',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:1',
        sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        graphVersion: '2.2',
        counts: { nodeCount: 2, edgeCount: 1 },
      }])),
    })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_ELEMENTS, {
      find: jest.fn(() => makeCursor([{
        snapshotId: 'snapshot-1',
        graphVersion: '2.2',
        stateVersion: 'runtime-revision:1',
        sourceStateVersion: 'runtime-revision:2',
        elementType: 'EDGE',
        elementKey: 'edge-1',
        fromElementKey: 'node-1',
        toElementKey: 'node-2',
        relationshipType: 'SOURCE_PRODUCES_EVIDENCE',
      }])),
    })

    await expect(getRuntimeStateGraphProjection({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_ELEMENTS_INVALID })
  })

  test.each([
    ['missing', undefined],
    ['malformed', 'sha256:not-a-digest'],
  ])('fails closed when a current graph manifest has a %s source hash', async (_label, sourceHash) => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      stateStatus: 'CURRENT',
      sourceStateVersion: 'runtime-revision:1',
      ...(sourceHash === undefined ? {} : { sourceHash }),
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_SOURCE_HASH_INVALID })
  })

  test('sanitizes nested graph counts while preserving bounded logical counts', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'CURRENT',
      sourceStateVersion: 'runtime-revision:1',
      sourceHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      graphVersion: '2.2',
      counts: {
        nodes: 3,
        edges: 2,
        sources: [{
          count: 1,
          logicalSource: 'framework_state.intelligence_graph',
          source: 'runtime_graph_elements',
        }],
        runtime_graph_elements: 99,
      },
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    const result = await getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result.manifest.counts).toEqual({
      nodes: 3,
      edges: 2,
      sources: [{
        count: 1,
        logicalSource: 'framework_state.intelligence_graph',
      }],
    })
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots|graph_elements)/)
  })

  test('fails closed when graph source-state receipt is missing', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'CURRENT',
      stateVersion: 'runtime-revision:1',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MISSING })
  })

  test('fails closed on contradictory graph currentness flags', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'STALE',
      current: true,
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_NOT_CURRENT })
  })

  test.each([
    ['missing status', {}],
    ['superseded status', { status: 'SUPERSEDED' }],
  ])('fails closed when graph current=true has %s', async (_label, statusFields) => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      ...statusFields,
      current: true,
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_NOT_CURRENT })
  })

  test('fails closed when graph status fields disagree', async () => {
    const find = jest.fn(() => makeCursor([{
      snapshotId: 'snapshot-1',
      status: 'CURRENT',
      stateStatus: 'STALE',
      stateVersion: 'runtime-revision:1',
      sourceStateVersion: 'runtime-revision:1',
      graphVersion: '2.2',
    }]))
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.GRAPH_SNAPSHOTS, { find })

    await expect(getRuntimeStateGraphManifest({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.GRAPH_NOT_CURRENT })
  })

  test('does not expose physical collection names in storage errors', async () => {
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, {})

    const error = await getRuntimeStateSectionSummary({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
      sectionKey: 'section_1_executive_summary',
    }).catch((caught) => caught)

    expect(error).toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
    expect(error.details).not.toHaveProperty('collection')
  })

  test('planning V2 reads use bounded canonical section reconstruction, never full legacy state', async () => {
    const frameworkPackage = { packageKey: 'standard-package', version: '3.1.1', sections: [] }
    resolveFrameworkOutcomeStudioHandoff.mockResolvedValueOnce({ frameworkPackage, handoff: { status: 'BLOCKED' } })
    const result = await getRuntimeOutcomePlanningEvidence({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(result.stateVersion).toBe('runtime-revision:1')
    expect(buildOutcomePlanningRuntimeEvidence).toHaveBeenCalledWith({ runtimeInstance: expect.objectContaining({
      framework_state: expect.objectContaining({ sections: {} }),
    }), frameworkPackage, handoff: { status: 'BLOCKED' }, planningEvidenceVersion: 'outcome-planning-evidence.v1' })
    for (const [call] of getRuntimeInstance.mock.calls) {
      expect(call.projection.split(' ')).not.toContain('framework_state')
      expect(call.projection.split(' ')).not.toContain('framework_state.sections')
      expect(call.maxTimeMS).toBe(2000)
    }
  })
  test.each(['stale-version', 'missing-source', 'not-current'])('planning rejects %s V2 section without legacy fallback', async (mode) => {
    const row = { sectionKey: 'section_1_executive_summary', current: true, stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1', sectionDetail: makeSectionDetail() }
    if (mode === 'stale-version') row.stateVersion = 'runtime-revision:old'
    if (mode === 'missing-source') delete row.sourceStateVersion
    if (mode === 'not-current') row.current = false
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find: jest.fn(() => makeCursor([row])) })
    await expect(getRuntimeOutcomePlanningEvidence({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })).rejects.toMatchObject({ status: expect.any(Number) })
    expect(buildOutcomePlanningRuntimeEvidence).not.toHaveBeenCalled()
    expect(resolveFrameworkOutcomeStudioHandoff).not.toHaveBeenCalled()
    for (const [call] of getRuntimeInstance.mock.calls) expect(call.projection.split(' ')).not.toContain('framework_state.sections')
  })
  test('legacy planning selects a bounded sections projection only when V2 identity is absent', async () => {
    getRuntimeInstance.mockResolvedValue(makeControl({ stateVersion: undefined }))
    await getRuntimeOutcomePlanningEvidence({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(getRuntimeInstance.mock.calls[1][0].projection.split(' ')).toContain('framework_state.sections')
    expect(getRuntimeInstance.mock.calls[1][0].projection.split(' ')).not.toContain('framework_state')
    expect(collectionSpy).not.toHaveBeenCalled()
  })
  test('planning fails closed on legacy-to-V2 identity change between reads', async () => {
    getRuntimeInstance.mockResolvedValueOnce(makeControl({ stateVersion: undefined })).mockResolvedValueOnce(makeControl())
    await expect(getRuntimeOutcomePlanningEvidence({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STATE_VERSION_MIXED })
    expect(buildOutcomePlanningRuntimeEvidence).not.toHaveBeenCalled()
  })
  test('returns a governed blocked handoff projection without legacy state retrieval', async () => {
    const result = await getRuntimeStateOutcomeHandoffReadiness({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result.status).toBe('BLOCKED')
    expect(result.readReceipt).toMatchObject({
      source: 'runtime_state_v2.bounded_handoff_projection',
      serializedPayloadBytes: expect.any(Number),
      maxSerializedPayloadBytes: RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES,
      bounded: true,
      fullLegacyFrameworkStateFetched: false,
    })
    expect(Object.keys(result.readReceipt).sort()).toEqual([
      'bounded',
      'fullLegacyFrameworkStateFetched',
      'maxSerializedPayloadBytes',
      'serializedPayloadBytes',
      'source',
    ])
    expect(result.handoff).toBeDefined()
    expect(resolveFrameworkOutcomeStudioHandoff).toHaveBeenCalledWith(expect.objectContaining({
      runtimeInstance: expect.objectContaining({
        id: RUNTIME_ID,
        stateVersion: 'runtime-revision:1',
      }),
      boundedDependencyPolicy: expect.objectContaining({
        policyVersion: FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY.policyVersion,
      }),
      boundedStateParityReceipt: {
        contractVersion: FRAMEWORK_OUTCOME_HANDOFF_V2_PARITY_CONTRACT_VERSION,
        stateVersion: 'runtime-revision:1',
        sectionCount: 0,
        evidenceObjectCount: 0,
        sectionKeys: [],
        stateDigest: 'sha256:bounded-state-digest',
      },
    }))
    expect(resolveFrameworkOutcomeStudioHandoff.mock.calls[0][0].runtimeInstance.framework_state).toEqual({
      lock: {},
      publish: {},
      sections: {},
      evidence_pack: { evidenceObjects: [] },
    })
    expect(result.control).not.toHaveProperty('handoffFrameworkState')
  })

  test.each([true, false])('preserves metadata-only %s through bounded handoff sanitization', async (metadataOnly) => {
    resolveFrameworkOutcomeStudioHandoff.mockResolvedValueOnce({
      handoff: { status: 'READY', knowledgeResolution: { context: { available: true, metadataOnly } } },
    })
    const result = await getRuntimeStateOutcomeHandoffReadiness({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(result.handoff.knowledgeResolution.context).toEqual({ available: true, metadataOnly })
    expect(result.readReceipt.fullLegacyFrameworkStateFetched).toBe(false)
  })

  test('preserves Discovery currentness through the actual bounded handoff reader and rejects changed acceptance', async () => {
    const section = { sectionKey: 'survey_findings', runtimePath: 'framework_state.sections.survey_findings', required: true }
    const declaration = {
      artefactKey: 'assuranceRecord', label: 'Assurance record', purpose: 'Internal completion proof.', required: true,
      lifecycleStage: 'GENERATED', sectionKeys: [section.sectionKey], workflowActionKeys: ['GENERATE_SECTION'],
      sourcePath: 'reasoningArtefacts.assuranceRecord', writePath: `${section.runtimePath}.generated.reasoningArtefacts.assuranceRecord`,
      schema: { type: 'object', required: ['value'], properties: { value: { type: 'string' } }, additionalProperties: false },
      validation: { currentnessFields: ['inputHash', 'generatedAt'], maxBytes: 4096 },
      handoff: { eligible: true, mappingKey: 'assuranceRecord', targetPath: 'outcome_studio.intermediate_reasoning.assuranceRecord' },
    }
    const frameworkPackage = {
      packageKey: 'custom-reader-proof', version: '1.0.0', dependencyLock: { snapshotId: 'snapshot-1', snapshotHash: hashSectionInput('dependencies') },
      sections: [section, { sectionKey: 'internal_packet', runtimePath: 'framework_state.sections.internal_packet', required: true, sectionMode: 'RUNTIME_MANAGED',
        runtimeManagedCompletion: { sourceSectionKeys: [section.sectionKey], reasoningArtefactKeys: ['assuranceRecord'] } }], reasoningArtefacts: [declaration],
    }
    const generated = { content: 'Accepted survey findings.', generatedAt: '2026-09-08T09:00:00.000Z', inputHash: hashSectionInput('Survey input') }
    const output = buildReasoningArtefactOutputs({ candidate: { reasoningArtefacts: { assuranceRecord: { value: 'Survey proof.' } } }, declarations: [declaration],
      packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version, sectionKey: section.sectionKey,
      inputHash: generated.inputHash, generatedAt: generated.generatedAt })
    Object.assign(generated, { reasoningArtefacts: output.values, reasoningArtefactReceipts: output.receipts })
    const detail = makeSectionDetail({ input: 'Survey input', generated, review: { status: 'ACCEPTED' }, state: { status: 'ACCEPTED' }, accepted: { content: generated.content, truthHash: 'fixture-truth', acceptedAt: '2026-09-08T09:01:00.000Z',
      inputHash: generated.inputHash, sourceGeneratedAt: generated.generatedAt, reasoningArtefacts: structuredClone(output.values), reasoningArtefactReceipts: structuredClone(output.receipts) } })
    const discovery = { accepted: true, acceptedAt: '2026-09-08T08:00:00.000Z', refreshedAt: '2026-09-08T07:00:00.000Z', inputs: { researchScope: 'Survey' }, needsRefresh: false, needs_refresh: false }
    const frameworkState = { sections: { survey_findings: detail }, evidence_pack: discovery }
    generated.runtimeManagedSourceReceipt = buildRuntimeManagedSourceReceipt({ frameworkPackage, frameworkState, section, generated })
    const expected = evaluateRuntimeManagedSections({ frameworkPackage, frameworkState })
    expect(expected).toMatchObject({ readySectionCount: 1, blockers: [] })
    const storedControl = makeControl({ _id: RUNTIME_ID, framework_state: { evidence_pack: { ...discovery, rawPayload: 'must-not-be-read' }, sections: { forbiddenLegacyPayload: true } } })
    getRuntimeInstance.mockImplementation(async ({ projection }) => {
      const projected = projectRendererRow(storedControl, Object.fromEntries(projection.split(/\s+/).filter(Boolean).map((path) => [path, 1])))
      // Match getRuntimeInstance's normal _id-to-id serialization after projection.
      return { ...projected, id: projected._id }
    })
    const row = { sectionKey: section.sectionKey, current: true, stateStatus: 'CURRENT', stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1', sectionDetail: detail }
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find: jest.fn((_filter, { projection }) => makeCursor([projectRendererRow(row, projection)])) })
    await getRuntimeStateOutcomeHandoffReadiness({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    const delegated = resolveFrameworkOutcomeStudioHandoff.mock.calls[0][0].runtimeInstance
    expect(delegated.framework_state.evidence_pack).toEqual({ ...discovery, evidenceObjects: [] })
    expect(delegated.framework_state.sections).not.toHaveProperty('forbiddenLegacyPayload')
    expect(evaluateRuntimeManagedSections({ frameworkPackage, frameworkState: delegated.framework_state })).toEqual(expected)
    expect(getRuntimeInstance.mock.calls[0][0].projection.split(/\s+/)).not.toContain('framework_state')
    storedControl.framework_state.evidence_pack.acceptedAt = '2026-09-08T10:00:00.000Z'
    await getRuntimeStateOutcomeHandoffReadiness({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    const changed = resolveFrameworkOutcomeStudioHandoff.mock.calls[1][0].runtimeInstance
    expect(evaluateRuntimeManagedSections({ frameworkPackage, frameworkState: changed.framework_state })).toMatchObject({
      readySectionCount: 0, blockers: [expect.objectContaining({ state: 'RUNTIME_MANAGED_PROOF_STALE' })],
    })
  })

  test('projects six rich handoff rows below the cap while retaining full accepted truth and empty fallbacks', async () => {
    const narrative = Array.from({ length: 6 }, () => 'n'.repeat(4000))
    const detail = {
      accepted: { content: 'Accepted truth', sectionIntelligence: { narrative } },
      generated: { content: narrative, sectionIntelligence: { narrative }, sections: narrative, evidenceProjection: {}, generationBoundaries: ['Boundary'], intelligence: { scopedEvidence: {} } },
      intelligence: { sectionIntelligence: { narrative }, displayProjection: { narrative }, scopedEvidence: {}, acceptedTruth: { truthHash: 'truth-hash' } },
      evidenceProjection: { included: [{ evidenceObjectId: 'fallback-must-not-win' }] },
      scopedEvidence: { sourceRefs: ['source-ref'] }, state: { status: 'ACCEPTED' },
    }
    const rows = Array.from({ length: 6 }, (_, index) => ({
      sectionKey: `section_${index}`, current: true, stateStatus: 'CURRENT',
      stateVersion: 'runtime-revision:1', sourceStateVersion: 'runtime-revision:1', sectionDetail: detail,
    }))
    expect(Buffer.byteLength(JSON.stringify(rows))).toBeGreaterThan(RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES)
    let projectedRows
    const partitionRows = []
    const find = jest.fn((filter, { projection }) => {
      const selectedRows = filter?.sectionKey
        ? rows.filter((row) => row.sectionKey === filter.sectionKey)
        : rows
      const projected = selectedRows.map((row) => projectRendererRow(row, projection))
      if (filter?.sectionKey) partitionRows.push(projected)
      else projectedRows = projected
      return makeCursor(projected)
    })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.SECTIONS, { find })
    await getRuntimeStateOutcomeHandoffReadiness({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID })
    expect(Buffer.byteLength(JSON.stringify(projectedRows))).toBeLessThan(RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES)
    expect(find).toHaveBeenCalledTimes(7)
    expect(partitionRows).toHaveLength(6)
    expect(partitionRows.every((partition) => (
      Buffer.byteLength(JSON.stringify(partition)) < RUNTIME_STATE_V2_MAX_SERIALIZED_READ_BYTES
    ))).toBe(true)
    expect(find.mock.calls[1][1].projection['sectionDetail.accepted']).toBe(1)
    const passed = resolveFrameworkOutcomeStudioHandoff.mock.calls[0][0].runtimeInstance.framework_state.sections.section_0
    expect(passed.accepted).toEqual(detail.accepted)
    expect(passed.generated.evidenceProjection).toEqual({})
    expect(passed.generated.sectionIntelligence).toEqual(detail.generated.sectionIntelligence)
    expect(passed.intelligence.scopedEvidence).toEqual({})
    expect(passed.generated.intelligence.scopedEvidence).toEqual({})
    expect(passed.generated.content).toEqual(detail.generated.content)
    expect(passed.intelligence).not.toHaveProperty('sectionIntelligence')
  })

  test('sanitizes delegated handoff diagnostics at the repository boundary', async () => {
    resolveFrameworkOutcomeStudioHandoff.mockResolvedValueOnce({
      handoff: {
        status: 'BLOCKED',
        reason: {
          code: 'HANDOFF_RESOLUTION_FAILED',
          detail: 'database collection runtime_graph_elements is unavailable',
        },
        source: 'runtime_graph_elements',
        metadata: {
          canonicalSource: 'runtime_graph_elements',
          error: [{ reason: 'provider timeout in runtime_graph_elements' }],
          details: [{
            reason: 'Mongo collection runtime_evidence_objects failed',
            detail: { message: 'socket timeout in runtime_graph_elements' },
          }],
        },
        contradictions: [{
          code: 'HANDOFF_RESOLUTION_FAILED',
          severity: 'ERROR',
          canonicalSource: 'runtime_evidence_objects',
          message: { detail: 'Mongo collection runtime_evidence_objects failed: provider timeout' },
        }],
      },
    })

    const result = await getRuntimeStateOutcomeHandoffReadiness({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })

    expect(result.handoff.contradictions[0]).toMatchObject({
      code: 'HANDOFF_RESOLUTION_FAILED',
      severity: 'ERROR',
    })
    expect(JSON.stringify(result.handoff.contradictions[0].message)).not.toMatch(/Mongo|runtime_evidence_objects|provider timeout/i)
    expect(result.handoff.contradictions[0]).not.toHaveProperty('canonicalSource')
    expect(JSON.stringify(result)).not.toMatch(/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots)/)
    expect(result.handoff).not.toHaveProperty('source')
    expect(result.handoff.reason).toEqual({
      code: 'HANDOFF_RESOLUTION_FAILED',
      detail: 'Additional handoff diagnostic detail is withheld by the bounded read contract.',
    })
    expect(result.handoff.metadata).not.toHaveProperty('canonicalSource')
    expect(result.handoff.metadata.error).toEqual([{
      reason: 'Additional handoff diagnostic detail is withheld by the bounded read contract.',
    }])
    expect(result.handoff.metadata.details).toEqual([{
      reason: 'Additional handoff diagnostic detail is withheld by the bounded read contract.',
      detail: {
        message: 'Additional handoff diagnostic detail is withheld by the bounded read contract.',
      },
    }])
    expect(result.handoff.contradictions[0].message).toEqual({
      detail: 'Additional handoff diagnostic detail is withheld by the bounded read contract.',
    })
  })

  test('fails closed when the final handoff result exceeds the serialized read ceiling', async () => {
    resolveFrameworkOutcomeStudioHandoff.mockResolvedValueOnce({
      handoff: {
        status: 'BLOCKED',
        contradictions: Array.from({ length: 100000 }, () => ({ code: 'HANDOFF_BLOCKED' })),
      },
    })

    await expect(getRuntimeStateOutcomeHandoffReadiness({
      scopes: SCOPES,
      runtimeInstanceId: RUNTIME_ID,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
  })
})

// Explicitly authored metadata witness, not a capture or native authorization receipt.
const metadataDescriptor = (native = { customerId: '1'.repeat(24), tenantId: '2'.repeat(24), runtimeInstanceId: '3'.repeat(24), runtimeInstanceKey: 'runtime-one' }) => {
  const fixture = { fixtureId: 'ss049-ac8-long-page-r1', fixtureVersion: 1,
    fixtureFileSha256: '7b7fe9a7819a71a25a043a73d7de1f9ed5b2689c36332ca981e65d7422771fd9',
    htmlSha256: '7f89c175b0da167969061551865ee67ad42b793283e61aecaec9f84aadc35777', sourceUrl: 'https://controlled-context.example/case-study' }
  const binding = { contractVersion: 'controlled-replay-binding.v1', bindingId: 'synthetic-metadata-only', bindingVersion: 1,
    classification: 'CONTROLLED_SYNTHETIC_REPLAY', environment: 'DEVELOPMENT_TEST',
    scope: Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, String(native[key])])),
    revisionId: native.runtimeInstanceKey, basisStateVersion: 'rsv2:11111111-1111-4111-8111-111111111111',
    actorUserId: '4'.repeat(24), authorityRef: 'synthetic:authority', isolationRef: 'synthetic:isolation', fixture }
  return { binding, provenance: { contractVersion: 'controlled-replay-provenance.v1', classification: 'CONTROLLED_SYNTHETIC_REPLAY',
    operation: 'CONTROLLED_HTML_REPLAY_CAPTURE', adapter: 'controlled-html-replay-v1', bindingId: binding.bindingId,
    bindingVersion: 1, bindingDigest: storedControlledReplayBindingDigest(binding), ...fixture } }
}

describe('inherited contradiction source ownership', () => {
  let basisSpy
  afterEach(() => basisSpy?.mockRestore())
  const parentId = '507f1f77bcf86cd799439091', rootId = '507f1f77bcf86cd799439090'
  const selection = { search: '', type: 'CONTRADICTION', population: 'DETECTED', sort: 'ID_ASC', page: 1, pageSize: 4 }
  const install = () => {
    const candidate = { contradictionId: 'contradiction-copied', domain: 'Scope', severity: 'LOW',
      basis: 'Recorded opposite statements', evidenceObjectIds: ['fact-a', 'fact-b'] }
    const runtime = makeControl({ revision: { revisionNumber: 3, createdFromRevision: 2,
      parentRuntimeId: parentId, parentRuntimeInstanceKey: 'runtime-parent', rootRuntimeId: rootId, rootRuntimeInstanceKey: 'runtime-root' } })
    const evidence = candidate.evidenceObjectIds.map((id, index) => ({ customerId: CUSTOMER_ID, tenantId: TENANT_ID,
      runtimeInstanceId: RUNTIME_ID, runtimeInstanceKey: runtime.runtimeInstanceKey, evidenceObjectId: id,
      sourceId: 'source-' + index, sourceType: 'DOCUMENT', lineageRef: '', extractedFact: 'Recorded statement ' + index,
      reviewStatus: 'ACCEPTED', current: true, stateVersion: runtime.stateVersion, sourceStateVersion: runtime.stateVersion,
      sourceHash: 'sha256:' + 'a'.repeat(64), migrationReceiptId: '507f1f77bcf86cd799439015' }))
    const pair = getDiscoveryContradictionReview(candidate, evidence, [], RUNTIME_ID, '')
    const review = { contractVersion: 'discovery-contradiction-review-v1', reviewId: '11111111-1111-4111-8111-111111111111',
      runtimeInstanceId: parentId, contradictionId: candidate.contradictionId, evidencePairHash: pair.evidencePairHash,
      disposition: 'NOT_CONTRADICTORY', rationale: 'Original native parent explanation.', reviewEpoch: '', reviewedBy: CUSTOMER_ID,
      reviewedAt: '2026-10-06T10:00:00.000Z', reviewedStateVersion: 'rsv2:parent-recorded',
      requestKey: '22222222-2222-4222-8222-222222222222', requestExpectedUpdatedAt: '2026-10-06T09:00:00.000Z' }
    review.requestPayloadHash = contradictionReviewRequestHash({ actorUserId: review.reviewedBy, runtimeInstanceId: parentId,
      contradictionId: review.contradictionId, expectedUpdatedAt: review.requestExpectedUpdatedAt,
      expectedEvidencePairHash: review.evidencePairHash, disposition: review.disposition, rationale: review.rationale, confirm: true })
    runtime.framework_state = { evidence_pack: { contradictionReviewEpoch: '', contradictionReviews: [structuredClone(review)],
      discoveryHealth: { contradictionCandidates: [candidate] } } }
    const parent = makeControl({ id: parentId, runtimeInstanceKey: 'runtime-parent', revision: { revisionNumber: 2, createdFromRevision: 1,
      parentRuntimeId: rootId, parentRuntimeInstanceKey: 'runtime-root',
      rootRuntimeId: rootId, rootRuntimeInstanceKey: 'runtime-root' }, framework_state: { evidence_pack: { contradictionReviews: [structuredClone(review)] } } })
    const root = makeControl({ id: rootId, runtimeInstanceKey: 'runtime-root', revision: { revisionNumber: 1 }, framework_state: {} })
    getRuntimeInstance.mockImplementation(async args => {
      expect(args.scopes).toBe(SCOPES); expect(args.session).toBeTruthy(); expect(typeof args.readBudget).toBe('function')
      expect(args.readBudget().maxTimeMS).toBeLessThanOrEqual(2000)
      if (args.runtimeInstanceId === RUNTIME_ID) return runtime
      expect(args.customerId).toBe(CUSTOMER_ID); expect(args.tenantId).toBe(TENANT_ID)
      expect(args.metadataMaxTimeMS).toBe(2000)
      expect(args.projection['framework_state.evidence_pack.contradictionReviews']).toEqual({ $slice: 1001 })
      if (args.runtimeInstanceId === parentId) return parent
      if (args.runtimeInstanceId === rootId) return root
      throw new Error('Unrelated runtime must never be loaded')
    })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find: jest.fn(() => makeCursor(evidence)) })
    basisSpy = jest.spyOn(mongoose.model('RuntimeInstance'), 'aggregate').mockImplementation(pipeline => {
      expect(String(pipeline[0].$match._id)).toBe(RUNTIME_ID)
      expect(pipeline[0].$match.stateVersion).toBe(runtime.stateVersion)
      return { session: session => {
        expect(session).toBeTruthy()
        return { option: async () => [{ version: 1, scope: { runtimeInstanceId: RUNTIME_ID,
          runtimeInstanceKey: runtime.runtimeInstanceKey, customerId: CUSTOMER_ID, tenantId: TENANT_ID,
          stateVersion: runtime.stateVersion }, candidates: runtime.framework_state.evidence_pack.discoveryHealth.contradictionCandidates,
          reviews: runtime.framework_state.evidence_pack.contradictionReviews, reviewEpoch: '',
          evidence, sources: evidence.map(e => ({ sourceId: e.sourceId, sourceType: e.sourceType })) }] }
      } }
    })
    return { runtime, parent, root, review, candidate }
  }
  const history = f => getRuntimeStateContradictionHistory({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID,
    findingId: f.candidate.contradictionId, page: 1, pageSize: 10 })

  test('actual repository keeps exact original source proof and projects STALE without leaking private ownership transport', async () => {
    const f = install(), before = JSON.stringify(f)
    const result = await getRuntimeStateFindings({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID, ...selection })
    expect(result.findings).toMatchObject({ available: true, records: [{ reviewStatus: 'STALE', latestReview: f.review }] })
    expect(result.control).not.toHaveProperty('inheritedContradictionRecords')
    expect(getRuntimeInstance.mock.calls.map(([args]) => args.runtimeInstanceId)).toEqual([RUNTIME_ID, parentId, rootId])
    expect(JSON.stringify(f)).toBe(before)
    const recorded = await history(f)
    expect(recorded.history).toMatchObject({ available: true, total: 1, records: [f.review] })
  })
  test('mixed own and copied records stay distinct; latest own decision uses unchanged current predicate', async () => {
    const f = install()
    f.runtime.framework_state.evidence_pack.contradictionReviews.push({ ...f.review,
      reviewId: '33333333-3333-4333-8333-333333333333', runtimeInstanceId: RUNTIME_ID,
      disposition: 'REOPENED', requestKey: undefined, requestPayloadHash: undefined, requestExpectedUpdatedAt: undefined })
    const result = await getRuntimeStateFindings({ scopes: SCOPES, runtimeInstanceId: RUNTIME_ID, ...selection })
    expect(result.findings.records[0]).toMatchObject({ reviewStatus: 'REOPENED', latestReview: { runtimeInstanceId: RUNTIME_ID } })
    expect((await history(f)).history.records.map(row => row.runtimeInstanceId)).toEqual([RUNTIME_ID, parentId])
  })
  test('direct revision two deduplicates the original root and immediate parent read', async () => {
    const f = install()
    f.runtime.revision = { revisionNumber: 2, createdFromRevision: 1, parentRuntimeId: parentId,
      parentRuntimeInstanceKey: 'runtime-parent', rootRuntimeId: parentId, rootRuntimeInstanceKey: 'runtime-parent' }
    f.parent.revision = { revisionNumber: 1 }
    expect((await history(f)).history).toMatchObject({ available: true, records: [f.review] })
    expect(getRuntimeInstance.mock.calls.map(([args]) => args.runtimeInstanceId)).toEqual([RUNTIME_ID, parentId])
  })
  test.each([
    ['customer', f => { f.parent.customerId = '507f1f77bcf86cd799439099' }],
    ['tenant', f => { f.parent.tenantId = '507f1f77bcf86cd799439099' }],
    ['workspace', f => { f.parent.workspaceId = 'another-workspace' }],
    ['package', f => { f.parent.packageId = '507f1f77bcf86cd799439099' }],
    ['native parent identity', f => { f.parent.id = rootId }],
    ['parent key', f => { f.parent.runtimeInstanceKey = 'another-key' }],
    ['root link', f => { f.parent.revision.rootRuntimeId = parentId }],
    ['actual parent edge', f => { f.parent.revision.parentRuntimeId = RUNTIME_ID }],
    ['actual parent key', f => { f.parent.revision.parentRuntimeInstanceKey = 'another-root' }],
    ['parent created from', f => { f.parent.revision.createdFromRevision = 2 }],
    ['unsupported depth', f => { f.runtime.revision.revisionNumber = 4; f.runtime.revision.createdFromRevision = 3 }],
    ['forged depth two parent', f => { f.runtime.revision.revisionNumber = 2; f.runtime.revision.createdFromRevision = 1; f.parent.revision.revisionNumber = 1 }],
    ['root identity', f => { f.root.id = parentId }],
    ['created from', f => { f.runtime.revision.createdFromRevision = 1 }],
    ['foreign owner', f => { f.runtime.framework_state.evidence_pack.contradictionReviews[0].runtimeInstanceId = '507f1f77bcf86cd799439099' }],
  ])('rejects wrong %s rather than admitting unrelated historical authority', async (_name, change) => {
    const f = install(); change(f)
    await expect(history(f)).rejects.toMatchObject({ code: RUNTIME_STATE_V2_ERROR_CODES.CONTROL_INVALID })
  })
  test.each([
    ['missing', f => { f.parent.framework_state.evidence_pack.contradictionReviews = [] }],
    ['changed', f => { f.parent.framework_state.evidence_pack.contradictionReviews[0].rationale = 'Changed ancestor explanation.' }],
    ['duplicate', f => { f.parent.framework_state.evidence_pack.contradictionReviews.push(structuredClone(f.review)) }],
    ['mixed duplicate', f => { f.parent.framework_state.evidence_pack.contradictionReviews.push({ ...f.review, rationale: 'Changed duplicate body.' }) }],
  ])('a %s original record invalidates the complete read, not a filtered partial success', async (_name, change) => {
    const f = install(); change(f)
    expect((await history(f)).history).toMatchObject({ available: false, reason: 'HISTORY_RECORD_INVALID', records: [], total: null })
  })
  test.each([new Error('Rejected ancestor dependency'), Object.assign(new Error('View permission denied'), { status: 403, code: 'FORBIDDEN' })])('rejected ancestor load stays rejected', async error => {
    const f = install(), actual = getRuntimeInstance.getMockImplementation()
    getRuntimeInstance.mockImplementation(args => args.runtimeInstanceId === parentId ? Promise.reject(error) : actual(args))
    await expect(history(f)).rejects.toMatchObject({ code: error.code || RUNTIME_STATE_V2_ERROR_CODES.STORAGE_UNAVAILABLE })
  })
  test('ordinary own-only and empty histories do not read ancestors', async () => {
    const f = install(); f.runtime.framework_state.evidence_pack.contradictionReviews = []
    expect((await history(f)).history).toMatchObject({ available: true, total: 0 })
    expect(getRuntimeInstance).toHaveBeenCalledTimes(1)
  })
})

// Explicit opt-in, immutable private files outside the repository. Native selection,
// serialization and sessions are component seams; the repository/projectors are real.
;(process.env.VMF_INHERITED_REVIEW_CACHED_DIR ? test : test.skip)('cached native R3 inherited review component transport', async () => {
  const directory = process.env.VMF_INHERITED_REVIEW_CACHED_DIR
  const inputPins = {
    'binding-v3-final-child-response.json': 'e56615e5c08a55bd9c4c0f8c74b14fb9cbabb7656ceaa573e366e3c3e076fa37',
    'binding-v3-after-r2-response.json': 'c989526a74dc45f248a644bf8aa0967950df727f55e7478425231e2bbfb09a18',
    'binding-v3-native-private.ejson.json': '782cb0a21f361303db874bcfc8fd77983f006f3c02b192fb118cd71618ba454f',
  }
  const readPinned = (path, sha256) => {
    const bytes = readFileSync(path)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256)
    return bytes.toString('utf8')
  }
  const manifestPath = process.env.VMF_INHERITED_REVIEW_SOURCE_MANIFEST
  const manifest = JSON.parse(readPinned(manifestPath, process.env.VMF_INHERITED_REVIEW_SOURCE_MANIFEST_SHA256))
  expect(manifest.files.length).toBeGreaterThanOrEqual(12)
  for (const pin of manifest.files) readPinned(resolve(process.cwd(), '..', pin.path), pin.sha256)
  const inputs = Object.fromEntries(Object.entries(inputPins).map(([name, sha256]) => [name, readPinned(resolve(directory, name), sha256)]))
  const child = JSON.parse(inputs['binding-v3-final-child-response.json']).body.data
  const parent = JSON.parse(inputs['binding-v3-after-r2-response.json']).body.data
  const root = JSON.parse(JSON.stringify(mongoose.mongo.BSON.EJSON.parse(readPinned(process.env.VMF_INHERITED_REVIEW_R1_CACHE,
    '7c428267f5db0166638316fb59c29cca5813c45008b58284daf53eba02130b38'), { relaxed: true }).r1))
  const captured = mongoose.mongo.BSON.EJSON.parse(inputs['binding-v3-native-private.ejson.json'], { relaxed: true })
  expect(child._id).toBe('6ad715c91f39fea112115875')
  expect(parent._id).toBe('6ad4b3cab439648c0f316453')
  expect(root._id).toBe('6ace5ee09bd4472c6be0cb07')
  const typed = [...new Map(captured.reads.filter(read => read.collection === 'runtime_evidence_objects')
    .flatMap(read => read.rows).filter(row => String(row.runtimeInstanceId) === child._id && row.current === true
      && row.stateVersion === child.stateVersion).map(row => [row.evidenceObjectId, JSON.parse(JSON.stringify(row))])).values()]
  expect(typed).toHaveLength(47)
  const native = new Map([child, parent, root].map(row => [row._id, row]))
  const snapshot = JSON.stringify([child, parent, root]), actualScopes = {
    customer: { _id: child.customerId }, tenant: { _id: child.tenantId, customerId: child.customerId },
  }
  const noConnect = jest.spyOn(mongoose, 'connect').mockImplementation(() => { throw new Error('Cached component must not connect') })
  try {
    getRuntimeInstance.mockImplementation(async args => {
      expect(args.scopes).toBe(actualScopes)
      expect(args.session).toBeTruthy(); expect(typeof args.readBudget).toBe('function')
      expect(args.readBudget().maxTimeMS).toBeLessThanOrEqual(2000)
      const stored = native.get(String(args.runtimeInstanceId)); expect(stored).toBeTruthy()
      const projection = typeof args.projection === 'string'
        ? Object.fromEntries(args.projection.split(' ').map(path => [path, 1])) : args.projection
      return { ...projectRendererRow(stored, projection), id: stored._id }
    })
    collections.set(RUNTIME_STATE_V2_COLLECTIONS.EVIDENCE_OBJECTS, { find: jest.fn((filter, options) => {
      expect(filter.$and).toEqual([
        { $or: [{ runtimeInstanceId: child._id }, { runtimeInstanceId: new mongoose.Types.ObjectId(child._id) },
          { runtimeInstanceKey: child.runtimeInstanceKey }] },
        { $or: [{ customerId: child.customerId }, { customerId: new mongoose.Types.ObjectId(child.customerId) }] },
        { $or: [{ tenantId: child.tenantId }, { tenantId: new mongoose.Types.ObjectId(child.tenantId) }] },
      ])
      expect(Object.keys(filter).sort()).toEqual(['$and', '$or', 'evidenceObjectId'])
      expect(filter.$or).toEqual([{ stateStatus: 'CURRENT' }, { status: 'CURRENT' }, { current: true }, { isCurrent: true }])
      expect(options.session).toBeTruthy(); expect(options.maxTimeMS).toBeLessThanOrEqual(2000)
      const matches = (row, query) => Object.entries(query).every(([key, value]) => {
        if (key === '$and') return value.every(part => matches(row, part))
        if (key === '$or') return value.some(part => matches(row, part))
        if (value && typeof value === 'object' && !value._bsontype) {
          expect(Object.keys(value)).toEqual(['$in'])
          return value.$in.some(item => String(item) === String(row[key]))
        }
        return row[key] != null && String(row[key]) === String(value)
      })
      return makeCursor(typed.filter(row => matches(row, filter)))
    }) })
    const findings = await getRuntimeStateFindings({ scopes: actualScopes, runtimeInstanceId: child._id,
      search: '', type: 'CONTRADICTION', population: 'DETECTED', sort: 'ID_ASC', page: 1, pageSize: 4 })
    expect(findings.findings).toMatchObject({ available: true, total: 1, records: [{
      findingId: 'contradiction_8d1dc05d4ca9', reviewStatus: 'STALE',
      latestReview: { reviewId: 'fc79906e-91c6-4a93-97a5-0b25841a4bab', runtimeInstanceId: parent._id },
    }] })
    const history = await getRuntimeStateContradictionHistory({ scopes: actualScopes, runtimeInstanceId: child._id,
      findingId: 'contradiction_8d1dc05d4ca9', page: 1, pageSize: 10 })
    expect(history.history).toMatchObject({ available: true, total: 1, currentness: 'NOT_ASSESSED',
      records: [{ runtimeInstanceId: parent._id, requestPayloadHash: child.framework_state.evidence_pack.contradictionReviews[0].requestPayloadHash }] })
    expect(JSON.stringify([child, parent, root])).toBe(snapshot)
    expect(noConnect).not.toHaveBeenCalled()
  } finally { noConnect.mockRestore() }
})

;(cachedProofEnabled ? describe : describe.skip)('cached exact successor R3 own frozen context', () => {
  let fixture, adapter, child, parent, childDoc, childAudit, parentAudit
  const readPinned = (path, expected) => {
    const bytes = readFileSync(path)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected)
    return mongoose.mongo.BSON.EJSON.parse(bytes.toString('utf8'), { relaxed: true })
  }
  beforeEach(async () => {
    fixture = await loadCachedProof()
    const root = fixture.baseline.root, clone = value => mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(value), { relaxed: true })
    const oldDir = 'C:/Dev/StoryLineOS/VMF-Evidence/ss-044/2026-10-19-section-detail-recovery'
    const native = readPinned(oldDir + '/native-lock-private.ejson.json', '7c428267f5db0166638316fb59c29cca5813c45008b58284daf53eba02130b38')
    const members = readPinned(oldDir + '/native-lock-members-private.ejson.json', '23a1cb48f51ad50c4cab9a40dd40c8789279cd23470b457c8fe3b70a796ff446')
    const rebound = readPinned('C:/Dev/StoryLineOS/VMF-Evidence/ss-044/2026-10-20-evidence-section-binding/native-r3-preparation/binding-v4-native-private.ejson.json',
      '0ac5a24e501971eee9b5e7e3e86bad063d0dcfa13f01868dd38e60e719dfdd83')
    parent = native.runtime
    child = clone(rebound.reads.find(r => r.collection === 'runtime_instances' && String(r.rows[0]?._id) === '6ad715c91f39fea112115875').rows[0])
    // Hypothetical own-lock component input. This is not an operational R3 review/LOCK.
    child.status = 'LOCKED'; child.executionStatus = 'COMPLETE'
    child.stateVersion = 'rsv2:33333333-3333-4333-8333-333333333333'
    child.lockedAt = new Date('2026-10-20T09:00:00.000Z'); child.lockedBy = root.lockedBy
    child.framework_state.lifecycle.stage = 'LOCKED'
    child.framework_state.publish = { state: 'PUBLISHED', published: true, snapshot: { snapshotId: 'component-r3-publish', snapshotHash: '7'.repeat(64) } }
    child.framework_state.lock = { locked: true, snapshot: { snapshotId: 'component-r3-lock', snapshotHash: '8'.repeat(64),
      snapshotAt: child.lockedAt.toISOString(), contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' } }
    const childRows = {}
    for (const [kind, name] of [['sources', 'runtime_evidence_sources'], ['evidence', 'runtime_evidence_objects'], ['sections', 'runtime_section_states']]) {
      const rows = rebound.reads.find(r => r.collection === name && r.filter.current === true && String(r.filter.runtimeInstanceId) === String(child._id)).rows
      childRows[kind] = clone(rows).map(row => ({ ...row, stateVersion: child.stateVersion, sourceStateVersion: child.stateVersion }))
      fixture.baseline.collections[name].push(...members.members[kind], ...childRows[kind])
    }
    const seen = new Set()
    for (const capture of [...(members.history || []), ...rebound.reads.filter(r => r.collection === 'runtime_section_states' && r.filter.current === false)]) {
      for (const row of capture.rows) if (!seen.has(String(row._id))) {
        seen.add(String(row._id)); fixture.baseline.collections.runtime_section_states.push(row)
      }
    }
    const { buildEvidenceMembershipBody, membershipHash } = await import('../services/runtimeEvidenceSnapshotContract.js')
    const body = buildEvidenceMembershipBody({ runtime: child, lockTruthRecord: child.framework_state.lock.snapshot, ...childRows })
    const pointer = { contractVersion: body.contractVersion, snapshotId: 'evidence_snapshot_33333333-3333-4333-8333-333333333333',
      membershipHash: membershipHash(body), basisStateVersion: child.stateVersion,
      lockSnapshotId: body.lockTruthRecord.snapshotId, lockSnapshotHash: body.lockTruthRecord.snapshotHash }
    child.lockedEvidenceSnapshot = pointer
    const Audit = (await import('../models/AuditLog.js')).default
    const audit = new Audit({ actorUserId: child.lockedBy, action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance', resourceId: child._id,
      scope: { customerId: child.customerId, tenantId: child.tenantId, runtimeInstanceId: child._id, runtimeInstanceKey: child.runtimeInstanceKey },
      diff: { actionKey: 'LOCK_RECORD', actionedAt: child.lockedAt.toISOString(), evidenceMembershipSnapshot: { ...pointer, counts: body.counts } } })
    audit.generateSignature(); childAudit = audit.toObject()
    childDoc = { _id: new mongoose.Types.ObjectId(), ...body.scope, ...pointer, body, createdBy: child.lockedBy,
      createdAt: child.lockedAt, lockAuditId: childAudit._id, lockAuditSignatureVersion: childAudit.signatureVersion }
    parentAudit = members.audits.find(row => String(row._id) === String(native.doc.lockAuditId))
    expect(parentAudit).toBeDefined()
    fixture.baseline.collections.runtime_evidence_snapshots.push(native.doc, childDoc)
    fixture.baseline.collections.auditlogs.push(parentAudit, childAudit)
    fixture.baseline.collections.runtime_instances.push(parent, child)
    adapter = await installCachedReads(fixture)
    for (const name of [...Object.keys(fixture.baseline.collections), 'runtime_synthetic_test_disposition_receipts']) collections.set(name, adapter.collection(name))
    getRuntimeInstance.mockImplementation(async args => {
      const row = [root, parent, child].find(value => String(value._id) === String(args.runtimeInstanceId))
      expect(row).toBeDefined(); expect(args.session).toBeTruthy(); expect(typeof args.readBudget).toBe('function')
      const projection = typeof args.projection === 'string' ? Object.fromEntries(args.projection.split(' ').map(key => [key, 1])) : args.projection
      const selected = adapter.project(row, projection), serialized = { ...selected, id: String(row._id), customerId: String(row.customerId),
        tenantId: String(row.tenantId), packageId: String(row.packageId), lockedBy: String(row.lockedBy) }
      if (args.internalEvidenceSnapshotToken) {
        expect(selected.framework_state).not.toHaveProperty('sections'); expect(selected.framework_state).not.toHaveProperty('evidence_pack')
        serialized.__evidenceSnapshotControl = { runtime: { ...serialized, _id: serialized.id }, pointer: row.lockedEvidenceSnapshot }
      }
      return serialized
    })
  })
  afterEach(() => adapter?.restore())
  const read = () => getRuntimeOutcomeEvidenceContractSnapshot({ runtimeInstanceId: String(child._id),
    scopes: { customer: { _id: child.customerId }, tenant: { _id: child.tenantId, customerId: child.customerId } },
    boundedInventoryRead: true, session: { cachedReadOnlySession: true }, readBudget: () => ({ maxTimeMS: 2000 }) })
  test('actual strict ancestor and own snapshot readers transport only own metadata while copied review stays STALE', async () => {
    const result = await read()
    expect(result.inventoryReceipt.frozenMembership.snapshotId).toBe(child.lockedEvidenceSnapshot.snapshotId)
    expect(result.inventoryReceipt.frozenMembership.body.scope.revisionNumber).toBe(3)
    expect(result.inventoryReceipt).not.toHaveProperty('supplementalFinding')
    expect(result.inventoryReceipt.sectionReadiness).toBe('REFERENCES_RESOLVED')
    expect(result.contradictionReviews).toEqual(child.framework_state.evidence_pack.contradictionReviews)
    const pack = child.framework_state.evidence_pack, candidate = pack.discoveryHealth.contradictionCandidates[0]
    expect(getDiscoveryContradictionReview(candidate, pack.evidenceObjects, pack.contradictionReviews,
      String(child._id), pack.contradictionReviewEpoch).reviewStatus).toBe('STALE')
    expect(adapter.calls.filter(call => call.name === 'auditlogs').some(call => String(call.filter.resourceId) === String(parent._id))).toBe(true)
    expect(adapter.calls.filter(call => call.name === 'auditlogs').some(call => String(call.filter.resourceId) === String(child._id))).toBe(true)
    expect(adapter.writes).not.toHaveBeenCalled()
  })
  test.each(['parent-hmac', 'own-hmac', 'parent-link', 'own-member', 'own-pointer'])('strict chain withholds metadata for %s', async kind => {
    if (kind === 'parent-hmac') parentAudit.signature = 'tampered'
    if (kind === 'own-hmac') childAudit.signature = 'tampered'
    if (kind === 'parent-link') child.revision.derivedFromReplayAnchorHash = 'f'.repeat(64)
    if (kind === 'own-member') childDoc.body.sections[0].materialHash = 'f'.repeat(64)
    if (kind === 'own-pointer') child.lockedEvidenceSnapshot.snapshotId = parent.lockedEvidenceSnapshot.snapshotId
    await expect(read()).rejects.toThrow()
    expect(adapter.writes).not.toHaveBeenCalled()
  })
})
