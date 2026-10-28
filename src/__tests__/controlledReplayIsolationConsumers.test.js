import { beforeEach, afterEach, describe, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'
const actualLicense = await import('../services/licenseEntitlementService.js')
const entitlement = jest.fn(async () => ({ featureEntitlements: ['VMF'] }))
jest.unstable_mockModule('../services/licenseEntitlementService.js', () => ({ ...actualLicense,
  resolveCustomerFeatureEntitlements: entitlement }))
const { getRuntimeInstance, RUNTIME_INSTANCE_RENDERER_PROJECTION } = await import('../services/runtimeInstanceService.js')
const { createRuntimeRevision } = await import('../services/runtimeRevisionService.js')
const { getGovernedReasoningExecution } = await import('../services/governedReasoningRuntimeService.js')
const { default: GovernedReasoningExecution } = await import('../models/GovernedReasoningExecution.js')
const { RuntimeInstance, Customer, Tenant, FrameworkPackage } = await import('../models/index.js')
const { default: RuntimeEvidenceSource } = await import('../models/RuntimeEvidenceSource.js')
const { default: RuntimeEvidenceObject } = await import('../models/RuntimeEvidenceObject.js')
const { assertNormalOutcomeRuntime } = await import('../services/syntheticOutcomeIsolationService.js')
const { copyControlledReplayIsolationWitness } = await import('../services/controlledReplayIsolationService.js')
const { EVIDENCE_SNAPSHOT_INTERNAL_READ } = await import('../services/runtimeEvidenceSnapshotContract.js')
const id = '1'.repeat(24), customerId = '2'.repeat(24), tenantId = '3'.repeat(24)
const base = () => ({ _id: id, customerId, tenantId, runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF',
  runtimeInstanceKey: 'controlled-consumer-r1', stateVersion: 'rsv2:11111111-1111-4111-8111-111111111111',
  updatedAt: new Date('2026-10-19T12:00:00.000Z'), framework_state: {}, status: 'ACTIVE' })
const scopes = () => ({ resolvedPermissions: { platform: { roleKeys: [], permissions: [] },
  tenants: [{ customerId, tenantId, permissions: ['VMF_VIEW', 'VMF_UPDATE'] }], customers: [] } })
const queries = []
const query = value => {
  const q = { select: jest.fn(), session: jest.fn(), maxTimeMS: jest.fn(), setOptions: jest.fn(), limit: jest.fn(), batchSize: jest.fn(),
    lean: jest.fn(async () => value), then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) }
  for (const key of ['select', 'session', 'maxTimeMS', 'setOptions', 'limit', 'batchSize']) q[key].mockReturnValue(q)
  queries.push(q); return q
}
let native, rootQuery, sourceQuery, evidenceQuery
beforeEach(() => {
  queries.length = 0; native = base(); entitlement.mockClear()
  rootQuery = query(native); sourceQuery = query(null); evidenceQuery = query(null)
  jest.spyOn(RuntimeInstance, 'findOne').mockImplementation(() => rootQuery)
  jest.spyOn(RuntimeEvidenceSource, 'findOne').mockImplementation(() => sourceQuery)
  jest.spyOn(RuntimeEvidenceObject, 'findOne').mockImplementation(() => evidenceQuery)
  jest.spyOn(Customer, 'findById').mockImplementation(() => query({ _id: customerId }))
  jest.spyOn(Tenant, 'findById').mockImplementation(() => query({ _id: tenantId, customerId, status: 'ENABLED' }))
})
afterEach(() => jest.restoreAllMocks())

describe('actual authenticated native loader and normal revision denial, with model/license seams only', () => {
  test.each([
    ['actual renderer', RUNTIME_INSTANCE_RENDERER_PROJECTION, 'revision'],
    ['object parent', { name: 1, revision: 1 }, 'revision'],
    ['sibling children', 'name revision.rootRuntimeId revision.parentRuntimeId', 'revision.rootRuntimeId'],
    ['mandatory marker parent', '_id controlledReplayIsolation.bindingDigest', 'controlledReplayIsolation'],
  ])('native projection union has no parent/child collision for %s', async (_name, projection, retainedPath) => {
    await getRuntimeInstance({ scopes: scopes(), runtimeInstanceId: id, projection })
    // Actual Mongoose outgoing shape, without executing a native database query.
    const outgoing = new mongoose.Query({}, {}, RuntimeInstance, RuntimeInstance.collection).select(rootQuery.select.mock.calls[0][0])
    outgoing._applyPaths()
    const fields = outgoing.projection()
    const included = Object.keys(fields).filter(key => fields[key] !== 0)
    expect(fields[retainedPath]).toBe(1)
    for (const path of included) expect(included.filter(parent => path.startsWith(`${parent}.`))).toEqual([])
    for (const required of ['_id', 'runtimeInstanceKey', 'customerId', 'tenantId', 'runtimeType', 'stateVersion',
      'runtimeStateVersion', 'revision.rootRuntimeId', 'revision.parentRuntimeId', 'controlledReplayIsolation']) {
      expect(included.some(path => path === required || required.startsWith(`${path}.`))).toBe(true)
    }
    if (retainedPath === 'revision') {
      expect(fields).not.toHaveProperty('revision.rootRuntimeId')
      expect(fields).not.toHaveProperty('revision.parentRuntimeId')
    }
    expect(RuntimeEvidenceSource.findOne).toHaveBeenCalledTimes(1)
    expect(RuntimeEvidenceObject.findOne).toHaveBeenCalledTimes(1)
  })
  test.each(['-revision -controlledReplayIsolation -framework_state',
    { revision: 0, controlledReplayIsolation: 0, framework_state: 0 }])('projection exclusions retain unrelated omission and cannot hide mandatory metadata %p', async projection => {
    await getRuntimeInstance({ scopes: scopes(), runtimeInstanceId: id, projection })
    const outgoing = new mongoose.Query({}, {}, RuntimeInstance, RuntimeInstance.collection).select(rootQuery.select.mock.calls[0][0])
    outgoing._applyPaths()
    const fields = outgoing.projection()
    expect(fields).toEqual({ framework_state: 0, runtimeCapacitySlot: 0 })
  })
  test.each(['absent', 'canonical-legacy-string', 'alias', 'matching-alias'])('actual loader preserves schema-valid %s basis while checking exact scoped current presence', async kind => {
    delete native.stateVersion
    if (kind === 'canonical-legacy-string') native.stateVersion = 'runtime-revision:1'
    if (kind === 'alias') native.runtimeStateVersion = 'runtime-revision:1'
    if (kind === 'matching-alias') native.stateVersion = native.runtimeStateVersion = 'legacy-current-basis'
    const plain = await getRuntimeInstance({ scopes: scopes(), runtimeInstanceId: id, projection: '_id customerId tenantId runtimeType' })
    expect(() => assertNormalOutcomeRuntime(plain)).not.toThrow()
    const filter = RuntimeEvidenceSource.findOne.mock.calls[0][0]
    expect(filter).toMatchObject({ customerId, tenantId, runtimeInstanceId: id, runtimeInstanceKey: native.runtimeInstanceKey,
      current: true, controlledReplayProvenance: { $exists: true } })
    if (kind === 'absent') expect(filter).not.toHaveProperty('stateVersion')
    else expect(filter.stateVersion).toBe(native.stateVersion || native.runtimeStateVersion)
    expect(rootQuery.select.mock.calls[0][0]).toContain('runtimeStateVersion')
    evidenceQuery.lean.mockResolvedValueOnce({ _id: 'legacy-orphan' })
    const orphan = await getRuntimeInstance({ scopes: scopes(), runtimeInstanceId: id })
    expect(() => assertNormalOutcomeRuntime(orphan)).toThrow(expect.objectContaining({ details: { reason: 'CONTROLLED_REPLAY_ISOLATED' } }))
  })
  test.each([null, '', 12, 'x'.repeat(201), '  '])('present invalid version %p cannot become unversioned fallback', async value => {
    native.stateVersion = value
    await expect(getRuntimeInstance({ scopes: scopes(), runtimeInstanceId: id })).rejects.toMatchObject({ details: { reason: 'CONTROLLED_REPLAY_ISOLATION_INVALID' } })
    expect(RuntimeEvidenceSource.findOne).not.toHaveBeenCalled()
  })
  test('conflicting aliases reject; SS044 identity never waives native controlled provenance probes', async () => {
    native.runtimeStateVersion = 'different-basis'
    await expect(getRuntimeInstance({ scopes: scopes(), runtimeInstanceId: id })).rejects.toMatchObject({ status: 409 })
    expect(RuntimeEvidenceSource.findOne).not.toHaveBeenCalled()
    delete native.runtimeStateVersion
    native._id = '6ace5ee09bd4472c6be0cb07'
    native.runtimeInstanceKey = 'ss044-disposable-synthetic-20261013-r1'
    sourceQuery.lean.mockResolvedValueOnce({ _id: 'controlled-orphan' })
    const result = await getRuntimeInstance({ scopes: scopes(), runtimeInstanceId: native._id })
    expect(RuntimeEvidenceSource.findOne).toHaveBeenCalledTimes(1)
    expect(RuntimeEvidenceObject.findOne).toHaveBeenCalledTimes(1)
    expect(() => assertNormalOutcomeRuntime(result)).toThrow(expect.objectContaining({ details: { reason: 'CONTROLLED_REPLAY_ISOLATED' } }))
  })
  test('separate native GRR reader checks permission and orphan state before direct execution lookup', async () => {
    const executionRead = jest.spyOn(GovernedReasoningExecution, 'findOne').mockImplementation(() => { throw new Error('Execution must not be read') })
    await expect(getGovernedReasoningExecution({ runtimeInstanceId: id, executionId: 'direct-record', scopes: {} }))
      .rejects.toMatchObject({ status: 403 })
    expect(RuntimeEvidenceSource.findOne).not.toHaveBeenCalled()
    sourceQuery.lean.mockResolvedValueOnce({ _id: 'orphan' })
    await expect(getGovernedReasoningExecution({ runtimeInstanceId: id, executionId: 'direct-record', scopes: scopes() }))
      .rejects.toMatchObject({ details: { reason: 'CONTROLLED_REPLAY_ISOLATED' } })
    expect(executionRead).not.toHaveBeenCalled()
    const failure = new Error('GRR native query failure')
    sourceQuery.lean.mockRejectedValueOnce(failure)
    await expect(getGovernedReasoningExecution({ runtimeInstanceId: id, executionId: 'direct-record', scopes: scopes() })).rejects.toBe(failure)
  })
  test('real VMF_VIEW check precedes both native orphan reads and rejected dependency cannot become empty success', async () => {
    await expect(getRuntimeInstance({ scopes: {}, runtimeInstanceId: id })).rejects.toMatchObject({ status: 403 })
    expect(RuntimeEvidenceSource.findOne).not.toHaveBeenCalled(); expect(RuntimeEvidenceObject.findOne).not.toHaveBeenCalled()
    expect(Customer.findById).not.toHaveBeenCalled()
    const failure = new Error('Native provenance read failed')
    sourceQuery.lean.mockRejectedValueOnce(failure)
    await expect(getRuntimeInstance({ scopes: scopes(), runtimeInstanceId: id })).rejects.toBe(failure)
  })
  test('actual serializer final DTO, internal snapshot copy and explicit server copy retain orphan denial privately', async () => {
    evidenceQuery.lean.mockResolvedValue({ _id: 'orphan-row' })
    const result = await getRuntimeInstance({ scopes: scopes(), runtimeInstanceId: id,
      projection: '_id customerId tenantId runtimeType', internalEvidenceSnapshotToken: EVIDENCE_SNAPSHOT_INTERNAL_READ })
    expect(rootQuery.select.mock.calls[0][0]).toContain('controlledReplayIsolation')
    expect(result.id).toBe(id)
    expect(() => assertNormalOutcomeRuntime(result)).toThrow(expect.objectContaining({ details: { reason: 'CONTROLLED_REPLAY_ISOLATED' } }))
    expect(() => assertNormalOutcomeRuntime(result.__evidenceSnapshotControl.runtime)).toThrow()
    expect(() => assertNormalOutcomeRuntime(copyControlledReplayIsolationWitness(result, { ...result }))).toThrow()
    expect(JSON.stringify(result)).not.toContain('native-controlled-replay-origin')
    expect(RuntimeEvidenceSource.findOne).toHaveBeenCalledWith(expect.objectContaining({ customerId, tenantId,
      runtimeInstanceId: id, stateVersion: native.stateVersion, current: true, controlledReplayProvenance: { $exists: true } }))
  })
  test('marker presence, including malformed, denies without orphan queries; plain native runtime remains normal', async () => {
    native.controlledReplayIsolation = null
    const result = await getRuntimeInstance({ scopes: scopes(), runtimeInstanceId: id, projection: '-controlledReplayIsolation -revision' })
    expect(rootQuery.select.mock.calls[0][0]).not.toContain('-controlledReplayIsolation')
    expect(rootQuery.select.mock.calls[0][0]).not.toContain('-revision')
    expect(() => assertNormalOutcomeRuntime(result)).toThrow()
    expect(RuntimeEvidenceSource.findOne).not.toHaveBeenCalled()
    delete native.controlledReplayIsolation
    const plain = await getRuntimeInstance({ scopes: scopes(), runtimeInstanceId: id })
    expect(() => assertNormalOutcomeRuntime(plain)).not.toThrow()
  })
  test.each(['marked', 'orphan'])('actual normal revision rejects %s parent before package or child provisioning', async kind => {
    native.status = 'LOCKED'
    native.framework_state = { lifecycle: { stage: 'PUBLISHED' }, publish: { state: 'PUBLISHED', published: true,
      snapshot: { snapshotId: 'published', snapshotHash: 'hash' } }, lock: { state: 'LOCKED', locked: true,
      snapshot: { snapshotId: 'locked', snapshotHash: 'hash' }, replayAnchor: { replayAnchorId: 'anchor', replayAnchorHash: 'hash' } } }
    if (kind === 'marked') native.controlledReplayIsolation = {}
    else sourceQuery.lean.mockResolvedValue({ _id: 'orphan-row' })
    const packageRead = jest.spyOn(FrameworkPackage, 'findById').mockImplementation(() => { throw new Error('Package must not be read') })
    const childWrite = jest.spyOn(RuntimeInstance, 'create').mockImplementation(() => { throw new Error('No child may be created') })
    await expect(createRuntimeRevision({ actorUserId: '4'.repeat(24), scopes: scopes(), runtimeInstanceId: id,
      payload: { expectedUpdatedAt: native.updatedAt.toISOString() } })).rejects.toMatchObject({
      status: 409, details: { reason: 'CONTROLLED_REPLAY_ISOLATED' } })
    expect(packageRead).not.toHaveBeenCalled(); expect(childWrite).not.toHaveBeenCalled()
  })
})
