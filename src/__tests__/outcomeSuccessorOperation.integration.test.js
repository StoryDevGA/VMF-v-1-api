import { jest } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import OutcomeSuccessorOperation from '../models/OutcomeSuccessorOperation.js'
import { OutcomeAsset, AuditLog } from '../models/index.js'
import auditService from '../services/auditService.js'
import { claimOutcomeSuccessorOperation, assertOutcomeSuccessorOperationIndexes } from '../services/outcomeSuccessorOperationService.js'

const enabled = process.env.RUN_OUTCOME_SUCCESSOR_ISOLATED === '1'
const run = enabled ? describe : describe.skip
run('successor isolated real Mongo claim and signed audit', () => {
  let server
  const ids = Object.fromEntries(['actor', 'customer', 'tenant', 'runtime', 'target', 'asset'].map((field) => [field, new mongoose.Types.ObjectId()]))
  const binding = (key = randomUUID()) => ({ actorUserId: String(ids.actor), idempotencyKey: key, requestId: randomUUID(),
    source: { customerId: String(ids.customer), tenantId: String(ids.tenant), runtimeInstanceId: String(ids.runtime),
      outcomeAssetId: 'source-asset', outcomeAssetVersionId: 'selected-version', sourceHash: 'a'.repeat(64),
      sourceVersionWitnessHash: 'e'.repeat(64) },
    target: { runtimeInstanceId: String(ids.target), revisionNumber: 2, stateVersion: 'new-state' },
    metadataFingerprint: 'b'.repeat(64), intentFingerprint: 'c'.repeat(64), contractFingerprint: 'd'.repeat(64) })
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ binary: { version: '7.0.14',
      ...(process.env.MONGOMS_SYSTEM_BINARY ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY } : {}) },
      replSet: { count: 1, storageEngine: 'wiredTiger' } })
    const uri = server.getUri('ss044_successor_isolated')
    const address = new URL(uri)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)
      || address.pathname !== '/ss044_successor_isolated') throw new Error('An exact loopback isolated target is required')
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
    expect(mongoose.connection.name).toBe('ss044_successor_isolated')
    await OutcomeSuccessorOperation.createCollection(); await OutcomeSuccessorOperation.createIndexes()
    await OutcomeAsset.createCollection(); await AuditLog.createCollection()
    await OutcomeAsset.collection.insertOne({ _id: ids.asset, outcomeAssetId: 'source-asset',
      customerId: ids.customer, tenantId: ids.tenant, runtimeInstanceId: ids.runtime,
      immutableWitness: 'original-source' })
  }, 60000)
  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      if (mongoose.connection.name !== 'ss044_successor_isolated'
        || !['127.0.0.1', 'localhost', '::1'].includes(mongoose.connection.host)) throw new Error('Unexpected cleanup database or host')
      await mongoose.connection.dropDatabase()
      expect(await mongoose.connection.db.listCollections().toArray()).toEqual([])
      await mongoose.disconnect()
    }
    if (server) { await server.stop(); expect(server.state).toBe('stopped') }
  }, 30000)
  it('commits one concurrent request and one model-signed truthful source audit', async () => {
    const sourceBefore = await OutcomeAsset.collection.findOne({ _id: ids.asset })
    const request = binding()
    const results = await Promise.all(Array.from({ length: 4 }, () => claimOutcomeSuccessorOperation({ binding: request })))
    expect(new Set(results.map((result) => result.operation.operationId)).size).toBe(1)
    expect(results[0].operation.binding.source.sourceVersionWitnessHash).toBe(request.source.sourceVersionWitnessHash)
    expect(results.filter((result) => !result.idempotent)).toHaveLength(1)
    expect(await OutcomeSuccessorOperation.countDocuments({ idempotencyKey: request.idempotencyKey })).toBe(1)
    const audits = await AuditLog.find({ action: auditService.AUDIT_ACTIONS.OUTCOME_SUCCESSOR_REQUESTED,
      'diff.successor.operationId': results[0].operation.operationId })
    expect(audits).toHaveLength(1)
    expect(audits[0].verifySignature()).toBe(true)
    expect(audits[0].resourceType).toBe('OutcomeAsset')
    expect(String(audits[0].resourceId)).toBe(String(ids.asset))
    expect(audits[0].summary).toContain('requested an Outcome Studio successor')
    expect(audits[0].summary).not.toContain('new draft')
    expect(await OutcomeAsset.collection.findOne({ _id: ids.asset })).toEqual(sourceBefore)
    await expect(claimOutcomeSuccessorOperation({ binding: { ...request, requestId: randomUUID() } })).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_IDEMPOTENCY_CONFLICT' })
  }, 30000)
  it('rolls back claim when required audit fails and permits one later unchanged attempt', async () => {
    const request = binding()
    await expect(claimOutcomeSuccessorOperation({ binding: request,
      deps: { writeClaimAudit: jest.fn(async () => { throw new Error('audit unavailable') }) } })).rejects.toThrow('audit unavailable')
    expect(await OutcomeSuccessorOperation.countDocuments({ idempotencyKey: request.idempotencyKey })).toBe(0)
    expect((await claimOutcomeSuccessorOperation({ binding: request })).idempotent).toBe(false)
  })
  it('rejects a different operation key trying to reuse the same target request identity', async () => {
    const request = binding()
    await claimOutcomeSuccessorOperation({ binding: request })
    await expect(claimOutcomeSuccessorOperation({ binding: { ...request, idempotencyKey: randomUUID() } }))
      .rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_TARGET_REQUEST_CONFLICT' })
    expect(await OutcomeSuccessorOperation.countDocuments({ requestId: request.requestId })).toBe(1)
  })
  it('rejects missing unique indexes before claim and never auto-creates them', async () => {
    await OutcomeSuccessorOperation.collection.dropIndex('uniq_outcome_successor_idempotency')
    await expect(assertOutcomeSuccessorOperationIndexes()).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_INDEXES_REQUIRED' })
    const request = binding()
    await expect(claimOutcomeSuccessorOperation({ binding: request })).rejects.toMatchObject({ reason: 'OUTCOME_SUCCESSOR_INDEXES_REQUIRED' })
    expect(await OutcomeSuccessorOperation.countDocuments({ idempotencyKey: request.idempotencyKey })).toBe(0)
    await OutcomeSuccessorOperation.createIndexes()
  })
})
