import { jest, beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { inspectAcquisitionRunIndexes, provisionAcquisitionRunIndexes } from '../../scripts/provisionAcquisitionRunIndexes.mjs'
import Run from '../models/RuntimeAcquisitionRun.js'

let replica, db
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }] })
  const name = `ss042_indexes_${randomUUID().replaceAll('-', '')}`
  const uri = replica.getUri(name)
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Isolated loopback replica required')
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false })
}, 120000)
beforeEach(async () => {
  jest.restoreAllMocks()
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' })
  db = mongoose.connection.getClient().db(`ss042_indexes_${randomUUID().replaceAll('-', '')}`)
  if ((await db.listCollections().toArray()).length) throw new Error('Fresh isolated database required')
})
afterAll(async () => { await mongoose.disconnect(); await replica?.stop() })
const apply = () => provisionAcquisitionRunIndexes(db, { apply: true, database: db.databaseName })
const collection = () => db.collection(Run.collection.collectionName)

test('dry-run does not create a collection and missing database acknowledgement cannot mutate it', async () => {
  const report = await provisionAcquisitionRunIndexes(db)
  expect(report.mode).toBe('dry-run'); expect(report.changed).toBe(false)
  expect(report.before.exists).toBe(false); expect(report.before.missing).toHaveLength(4)
  await expect(provisionAcquisitionRunIndexes(db, { apply: true })).rejects.toThrow('acknowledgement')
  await expect(provisionAcquisitionRunIndexes(db, { apply: true, database: 'another-database' })).rejects.toThrow('acknowledgement')
  expect(await db.listCollections().toArray()).toHaveLength(0)
})
test('creates exactly the reviewed catalogue and explicit rerun is a read-only no-op even with records', async () => {
  const report = await apply()
  expect(report.changed).toBe(true); expect(report.after.verified).toBe(true)
  expect(report.after.hasRecords).toBe(false); expect(report.after.indexes).toHaveLength(5)
  expect(report.after.missing).toEqual([])
  await collection().insertOne({ fixture: 'synthetic idempotence marker' })
  const before = await collection().findOne({})
  const rerun = await apply()
  expect(rerun.changed).toBe(false); expect(rerun.after.verified).toBe(true)
  expect(await collection().findOne({})).toEqual(before)
})
test.each([
  { unique: false }, { sparse: true }, { hidden: true }, { collation: { locale: 'en' } },
])('rejects incompatible index semantics without altering catalogue: %j', async override => {
  const [key, options] = Run.schema.indexes()[0]
  await collection().createIndex(key, { ...options, ...override })
  const before = await collection().listIndexes().toArray()
  await expect(apply()).rejects.toThrow('incompatible')
  expect(await collection().listIndexes().toArray()).toEqual(before)
})
test('refuses unexpected TTL index without removing it', async () => {
  await collection().createIndex({ completedAt: 1 }, { name: 'unexpected_expiry', expireAfterSeconds: 60 })
  await expect(apply()).rejects.toThrow('Unexpected acquisition indexes')
  expect((await collection().listIndexes().toArray()).some(index => index.name === 'unexpected_expiry')).toBe(true)
})
test('refuses populated missing-index state and capped collection options without touching records', async () => {
  await collection().insertOne({ fixture: 'synthetic incompatible marker' })
  await expect(apply()).rejects.toThrow('Populated acquisition collection')
  expect(await collection().countDocuments()).toBe(1)
  expect(await collection().listIndexes().toArray()).toHaveLength(1)
  const other = mongoose.connection.getClient().db(`ss042_indexes_${randomUUID().replaceAll('-', '')}`)
  await other.createCollection(Run.collection.collectionName, { capped: true, size: 1024 })
  await expect(provisionAcquisitionRunIndexes(other, { apply: true, database: other.databaseName })).rejects.toThrow('options are incompatible')
})
test('a real DDL failure does not return verified readiness and explicit inspection shows missing indexes', async () => {
  await db.createCollection(Run.collection.collectionName)
  await db.admin().command({ configureFailPoint: 'failCommand', mode: { times: 1 },
    data: { failCommands: ['createIndexes'], errorCode: 2 } })
  await expect(apply()).rejects.toThrow()
  expect((await inspectAcquisitionRunIndexes(db)).verified).toBe(false)
  expect(await collection().listIndexes().toArray()).toHaveLength(1)
})
test('reinspects a race-created populated namespace and refuses missing-index DDL', async () => {
  const create = db.createCollection.bind(db)
  jest.spyOn(db, 'createCollection').mockImplementationOnce(async (name, options) => {
    await create(name, options)
    await db.collection(name).insertOne({ fixture: 'synthetic namespace-race marker' })
    throw Object.assign(new Error('Namespace exists'), { code: 48 })
  })
  await expect(apply()).rejects.toThrow('changed during provision')
  expect(await collection().countDocuments()).toBe(1)
  expect(await collection().listIndexes().toArray()).toHaveLength(1)
})
test('reinspects race-created options and refuses incompatible namespace', async () => {
  const create = db.createCollection.bind(db)
  jest.spyOn(db, 'createCollection').mockImplementationOnce(async name => {
    await create(name, { capped: true, size: 1024 })
    throw Object.assign(new Error('Namespace exists'), { code: 48 })
  })
  await expect(apply()).rejects.toThrow('options are incompatible')
  expect((await db.listCollections({ name: Run.collection.collectionName }).toArray())[0].options.capped).toBe(true)
})
