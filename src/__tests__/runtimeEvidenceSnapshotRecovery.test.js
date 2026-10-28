import { describe, test, expect, jest, beforeAll, beforeEach, afterEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import express from 'express'
import supertest from 'supertest'
import mongoose from 'mongoose'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import Recovery, { SNAPSHOT_RECOVERY_POLICY as p, assertSnapshotRecovery } from '../models/RuntimeEvidenceSnapshotRecovery.js'
import { snapshotRecoveryBodySchema, validateSnapshotRecoveryBody, validateReviewCompletionScope } from '../validators/reviewCompletion.validator.js'
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

const request = () => ({ requestKey: randomUUID(), expectedBasisHash: 'a'.repeat(64), expectedUpdatedAt: '2026-10-16T18:05:42.003Z',
  rationale: 'Repair only the exact serialized empty references object.', confirm: true })
describe('snapshot correction strict transport and immutable storage boundary', () => {
  test('binds exact controlled original and has no disposition or approval default', () => {
    expect(p).toMatchObject({ snapshotStorageId: '6ad267752b7668e0c1ae01af', actorUserId: '6a6c763dcace7a21bd41efa9' })
    expect(new Recovery().body).toBeUndefined()
    expect(Recovery.schema.options).toMatchObject({ minimize: false, strict: 'throw', autoCreate: false, autoIndex: false })
    expect(Recovery.schema.indexes().map(([fields, options]) => ({ fields, unique: options.unique, name: options.name }))).toEqual([
      { fields: { customerId: 1, tenantId: 1, runtimeInstanceId: 1, originalSnapshotStorageId: 1 }, unique: true, name: 'unique_scoped_snapshot_recovery' },
      { fields: { customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 }, unique: true, name: 'unique_scoped_snapshot_recovery_request' },
    ])
  })
  test.each(['requestKey', 'expectedBasisHash', 'expectedUpdatedAt', 'rationale', 'confirm'])('requires %s', key => {
    const input = request(); delete input[key]
    expect(snapshotRecoveryBodySchema.safeParse(input).success).toBe(false)
  })
  test.each([{ actorUserId: p.actorUserId }, { correctedBody: {} }, { snapshotId: p.snapshotId }, { allowSynthetic: true },
    { expectedUpdatedAt: 'yesterday' }, { expectedBasisHash: 'sha256:' + 'a'.repeat(64) }, { confirm: false }, { rationale: 'x'.repeat(2001) }])('rejects unsupported caller authority or material %j', extra => {
    expect(snapshotRecoveryBodySchema.safeParse({ ...request(), ...extra }).success).toBe(false)
  })
  test.each([{}, { body: {} }, { body: { correctedBody: {} } }])('rejects partial correction bodies without storage', value => {
    expect(() => assertSnapshotRecovery(value)).toThrow()
  })
  test.each(['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'])('rejects %s before connection', async method => {
    await expect(Recovery[method]({}, {})).rejects.toMatchObject({ details: { reason: 'IMMUTABLE' } })
  })
  test('creation validation cannot be bypassed by save, insertMany or bulk options', async () => {
    const insert = jest.spyOn(Recovery.collection, 'insertOne').mockImplementation(() => { throw new Error('Unexpected storage') })
    const many = jest.spyOn(Recovery.collection, 'insertMany').mockImplementation(() => { throw new Error('Unexpected storage') })
    const bulk = jest.spyOn(Recovery.collection, 'bulkWrite').mockImplementation(() => { throw new Error('Unexpected storage') })
    try {
      await expect(new Recovery({ body: {} }).save({ validateBeforeSave: false })).rejects.toThrow()
      await expect(Recovery.insertMany([{ body: {} }], { lean: true })).rejects.toThrow()
      await expect(Recovery.bulkWrite([{ insertOne: { document: { body: {} } } }], { skipValidation: true })).rejects.toThrow()
      expect(insert).not.toHaveBeenCalled(); expect(many).not.toHaveBeenCalled(); expect(bulk).not.toHaveBeenCalled()
    } finally { insert.mockRestore(); many.mockRestore(); bulk.mockRestore() }
  })
})
;(cachedProofEnabled ? describe : describe.skip)('cached native correction capture: real hashes/signatures, memory reads only', () => {
  let resolver, fixture, adapter
  beforeAll(async () => {
    for (const path of ['runtimeEvidenceSnapshotRecoveryService', 'runtimeProductAuthorityService', 'supplementalFindingReviewService', 'publishedDispositionRecoveryService']) jest.unstable_unmockModule('../services/' + path + '.js')
    resolver = (await import('../services/runtimeEvidenceSnapshotRecoveryService.js')).resolveRuntimeEvidenceSnapshotCorrection
  })
  beforeEach(async () => { fixture = await loadCachedProof(); adapter = await installCachedReads(fixture) })
  afterEach(() => adapter?.restore())
  test.each(['valid', 'missing-correction', 'invalid-audit', 'changed-control'])('forwards proof only after exact %s correction outcome', async kind => {
    const root = fixture.baseline.root, callback = jest.fn()
    if (kind === 'missing-correction') fixture.baseline.collections.runtime_evidence_snapshot_recoveries.length = 0
    if (kind === 'invalid-audit') fixture.audit.signature = 'tampered'
    if (kind === 'changed-control') root.updatedAt = new Date(root.updatedAt.getTime() + 1)
    const result = resolver({ runtime: root, pointer: root.lockedEvidenceSnapshot,
      doc: fixture.baseline.collections.runtime_evidence_snapshots[0], readBudget: () => ({ maxTimeMS: 2000 }),
      deps: { onVerifiedMembership: callback } })
    if (kind === 'valid') {
      await expect(result).resolves.toMatchObject({ completeness: 'VERIFIED', counts: { evidence: 47, sources: 8, sections: 6 } })
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0]).toMatchObject({ body: { basisStateVersion: p.stateVersion }, observed: { evidence: expect.any(Array) }, publishedFinding: { disposition: 'NOT_CONTRADICTORY' } })
    } else {
      await expect(result).rejects.toMatchObject({ code: 'SNAPSHOT_RECOVERY_INVALID', details: { reason: { 'missing-correction': 'CORRECTION_REQUIRED', 'invalid-audit': 'CORRECTION_AUDIT_INVALID', 'changed-control': 'STALE_CONTROL' }[kind] } })
      expect(callback).not.toHaveBeenCalled()
    }
    expect(adapter.writes).not.toHaveBeenCalled()
  })
})
describe('native correction controller, explicit simulated authenticated actor seam', () => {
  const inspect = jest.fn(), record = jest.fn()
  let app
  beforeAll(async () => {
    jest.unstable_mockModule('../services/runtimeEvidenceSnapshotRecoveryService.js', () => ({ inspectRuntimeEvidenceSnapshotRecovery: inspect, recordRuntimeEvidenceSnapshotRecovery: record }))
    jest.unstable_mockModule('../services/runtimeProductAuthorityService.js', () => ({ inspectRuntimeProductAuthority: jest.fn(), importRuntimeProductAuthority: jest.fn() }))
    jest.unstable_mockModule('../services/supplementalFindingReviewService.js', () => ({ inspectSupplementalFindingReview: jest.fn(), recordSupplementalFindingReview: jest.fn() }))
    jest.unstable_mockModule('../services/publishedDispositionRecoveryService.js', () => ({ inspectPublishedDispositionRecovery: jest.fn(), recordPublishedDispositionRecovery: jest.fn() }))
    jest.unstable_mockModule('../services/reviewCompletionService.js', () => ({ getReviewCompletion: jest.fn(), completeReview: jest.fn() }))
    jest.unstable_mockModule('../controllers/runtimeInstance.controller.js', () => ({ buildRuntimeStateRequestScopes: ({ scopes, query }) => ({ ...scopes, selectedCustomerId: query.customerId, selectedTenantId: query.tenantId }) }))
    const handlers = await import('../controllers/reviewCompletion.controller.js')
    app = express(); app.use(express.json())
    app.use((req, _res, next) => { req.context = { userId: p.actorUserId }; req.scopes = { nativeScopeTest: true }; req.requestId = 'correction-controller-test'; next() })
    app.get('/:runtimeInstanceId/evidence-snapshot-recovery', validateReviewCompletionScope, handlers.readEvidenceSnapshotRecovery)
    app.post('/:runtimeInstanceId/evidence-snapshot-recovery', validateReviewCompletionScope, validateSnapshotRecoveryBody, handlers.recordEvidenceSnapshotRecovery)
    app.use((_error, _req, res, _next) => res.status(500).json({ error: { code: 'DEPENDENCY_REJECTED' } }))
  })
  beforeEach(() => { inspect.mockReset(); record.mockReset() })
  const path = `/${p.runtimeInstanceId}/evidence-snapshot-recovery?customerId=${p.customerId}&tenantId=${p.tenantId}`
  test('forwards only authenticated actor, validated scopes and exact request', async () => {
    record.mockResolvedValue({ receipt: { authorisesARL: false }, replay: false })
    const payload = request(), response = await supertest(app).post(path).send(payload)
    expect(response.status).toBe(200)
    expect(record.mock.calls[0][0]).toMatchObject({ actorUserId: p.actorUserId, runtimeInstanceId: p.runtimeInstanceId, payload,
      scopes: { nativeScopeTest: true, selectedCustomerId: p.customerId, selectedTenantId: p.tenantId } })
    expect(response.body.data.receipt.authorisesARL).toBe(false)
  })
  test('rejects caller identity injection before owner', async () => {
    expect((await supertest(app).post(path).send({ ...request(), actorUserId: p.actorUserId })).status).toBe(422)
    expect(record).not.toHaveBeenCalled()
  })
  test('requires explicit query scope and rejects scope overrides', async () => {
    expect((await supertest(app).get(`/${p.runtimeInstanceId}/evidence-snapshot-recovery`)).status).toBe(422)
    expect((await supertest(app).get(path + '&actorUserId=' + p.actorUserId)).status).toBe(422)
    expect(inspect).not.toHaveBeenCalled()
  })
  test.each(['get', 'post'])('rejected %s dependency is not empty success', async method => {
    const operation = method === 'get' ? inspect : record
    operation.mockRejectedValue(new Error('Rejected owner dependency'))
    const response = method === 'get' ? await supertest(app).get(path) : await supertest(app).post(path).send(request())
    expect(response.status).toBe(500); expect(response.body.error.code).toBe('DEPENDENCY_REJECTED')
  })
})
