import { afterAll, beforeAll, describe, expect, test } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import FrameworkPackage from '../models/FrameworkPackage.js'
import { inspectDiscoveryPolicy, discoveryPolicySnapshot } from '../services/discoveryPolicyContract.js'

let replica, connection, Package
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, name: 'ss038_isolated' } })
  const uri = replica.getUri('ss038_policy_test')
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/ss038_policy_test\?/.test(uri)) throw new Error('Only an isolated loopback database is permitted.')
  connection = await mongoose.createConnection(uri).asPromise()
  Package = connection.model('FrameworkPackage', FrameworkPackage.schema)
  await Package.init()
}, 60000)
afterAll(async () => {
  if (connection) await connection.close()
  if (replica) await replica.stop()
})
const policy = (key) => ({ contractVersion: 'framework-package-discovery-policy-v1', policyKey: `${key}-policy`, policyVersion: '1.0.0', evidencePolicy: { ownerMappings: [{ mappingKey: 'synthetic', vmfCapabilityRef: 'unverified', ownerRuntime: 'unverified', resultType: 'unverified' }] } })
const fixture = (key) => ({ frameworkKey: key, frameworkName: key, version: '1.0.0', packageKey: `${key.toLowerCase()}-ss038`, status: 'DRAFT', createdBy: new mongoose.Types.ObjectId(), updatedBy: new mongoose.Types.ObjectId(), discoveryPolicy: policy(key) })

describe('isolated Discovery Policy persistence', () => {
  test.each(['VMF', 'WEBSITE'])('roundtrips %s draft configuration without activating provisional semantics', async (key) => {
    const source = await Package.create(fixture(key))
    const read = await Package.findById(source._id).lean()
    expect(read.discoveryPolicy).toEqual(policy(key))
    expect(inspectDiscoveryPolicy(read.discoveryPolicy).status).toBe('UNRESOLVED')
    source.discoveryPolicy = { ...source.discoveryPolicy, label: 'Saved draft' }
    await source.save()
    expect((await Package.findById(source._id).lean()).discoveryPolicy.label).toBe('Saved draft')
    source.status = 'VALIDATED'
    await expect(source.save()).rejects.toThrow(/governing method source/)
    expect((await Package.findById(source._id).lean()).status).toBe('DRAFT')
  })
  test('isolated transaction abort preserves policy bytes and checksum', async () => {
    const source = await Package.create({ ...fixture('TX'), dependencyLock: { snapshotId: 'synthetic', status: 'PASS', packageKey: 'tx-ss038', packageVersion: '1.0.0', ...discoveryPolicySnapshot(policy('TX')) } })
    const before = await Package.findById(source._id).lean()
    const session = await connection.startSession()
    try {
      await expect(session.withTransaction(async () => {
        const candidate = await Package.findById(source._id).session(session)
        candidate.discoveryPolicy = { ...candidate.discoveryPolicy, label: 'Aborted' }
        await candidate.save({ session })
        throw new Error('Synthetic transaction failure')
      })).rejects.toThrow('Synthetic transaction failure')
    } finally { await session.endSession() }
    const after = await Package.findById(source._id).lean()
    expect(after.discoveryPolicy).toEqual(before.discoveryPolicy)
    expect(after.dependencyLock.discoveryPolicyHash).toBe(before.dependencyLock.discoveryPolicyHash)
  })
})
