import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'
import { installControlledDocxReadFence } from '../services/controlledDocxReadFence.js'
import { APPROVED_DOCX_READ_SELECTION } from '../services/approvedDocxReadProfile.js'
const driver = mongoose.mongo, database = 'ss044_1619d7db635949898c9abb4592d10bcf'
let originals, client
beforeEach(() => {
  originals = new Map([driver.Collection.prototype, driver.Db.prototype, driver.Admin.prototype, driver.MongoClient.prototype]
    .map(p => [p, Object.getOwnPropertyDescriptors(p)]))
  jest.spyOn(driver.Collection.prototype, 'find').mockReturnValue({ offlineCursorOnly: true })
})
afterEach(async () => { for (const [p, d] of originals) Object.defineProperties(p, d); await client?.close(); client = null })
test.each([[null, 10000], ['APPROVED_CANDIDATE', 20000], ['APPROVED_REVIEW_PREPARATION', 50000]])('finite %s method-entry cap preserves its exact boundary', (readPurpose, limit) => {
  const fence = installControlledDocxReadFence(driver, { database, readPurpose,
    ...(readPurpose ? { nativeRecorderId: APPROVED_DOCX_READ_SELECTION.recorderUserId } : {}) })
  client = new driver.MongoClient('mongodb://127.0.0.1:1/unused', { dbName: database })
  fence.register(client); fence.addNames(['auditlogs'])
  const collection = client.db(database).collection('auditlogs')
  for (let i = 0; i < limit; i++) collection.find({})
  expect(fence.observation()).toMatchObject({ methodCalls: limit, methodCallLimit: limit })
  expect(() => collection.find({})).toThrow('CONTROLLED_READ_FENCE')
})
test.each(['wrong database', 'missing recorder', 'wrong recorder', 'unknown purpose', 'coerced purpose', 'prototype purpose'])('rejects %s before extending any budget', kind => {
  const options = { database, readPurpose: 'APPROVED_CANDIDATE', nativeRecorderId: APPROVED_DOCX_READ_SELECTION.recorderUserId }
  if (kind === 'wrong database') options.database = 'test'
  if (kind === 'missing recorder') delete options.nativeRecorderId
  if (kind === 'wrong recorder') options.nativeRecorderId = 'a'.repeat(24)
  if (kind === 'unknown purpose') options.readPurpose = 'UNBOUNDED'
  if (kind === 'coerced purpose') options.readPurpose = ['APPROVED_CANDIDATE']
  if (kind === 'prototype purpose') options.readPurpose = '__proto__'
  expect(() => installControlledDocxReadFence(driver, options)).toThrow('CONTROLLED_READ_FENCE')
})
test('approved allowance still refuses writes, foreign namespaces and native aggregate commands', () => {
  const fence = installControlledDocxReadFence(driver, { database, readPurpose: 'APPROVED_REVIEW_PREPARATION',
    nativeRecorderId: APPROVED_DOCX_READ_SELECTION.recorderUserId })
  client = new driver.MongoClient('mongodb://127.0.0.1:1/unused', { dbName: database }); fence.register(client); fence.addNames(['auditlogs'])
  expect(() => client.db(database).collection('auditlogs').insertOne({})).toThrow('CONTROLLED_READ_FENCE')
  expect(() => client.db(database).collection('other').find({})).toThrow('CONTROLLED_READ_FENCE')
  expect(() => client.db('test').collection('users').aggregate([])).toThrow('CONTROLLED_READ_FENCE')
  expect(() => client.db(database).command({ ping: 1 })).toThrow('CONTROLLED_READ_FENCE')
})
