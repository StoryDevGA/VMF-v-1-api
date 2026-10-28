import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import Event from '../models/SyntheticOutcomeRunEvent.js'
import Audit from '../models/AuditLog.js'
import { withSyntheticOutcomeTransactionReads as attempt, readSyntheticOutcomeQuery as read,
  invalidateSyntheticOutcomeTransactionReads as invalidate } from '../services/syntheticOutcomeTransactionReads.js'

const query = (session, execute, { model = Event, op = 'findOne', filter = { phase: 'CLAIM' },
  projection, options = {}, mongooseOptions = {} } = {}) => {
  const value = model[op](filter).session(session).setOptions(options)
  if (projection) value.select(projection)
  Object.assign(value.mongooseOptions(), mongooseOptions)
  value.exec = execute
  return value
}

test('shares one read only in the same callback attempt and session, with detached BSON values', async () => {
  const session = {}, other = {}, id = new mongoose.Types.ObjectId(), date = new Date('2026-10-21T10:00:00Z')
  const execute = jest.fn(async () => ({ _id: id, createdAt: date, nested: { qualification: 'No execution approval.' } }))
  await attempt(session, async () => {
    const [a, b] = await Promise.all([read(query(session, execute), session), read(query(session, execute), session)])
    expect(execute).toHaveBeenCalledTimes(1)
    expect(a._id).toBeInstanceOf(mongoose.Types.ObjectId); expect(a._id.equals(id)).toBe(true)
    expect(a.createdAt).toEqual(date)
    a.nested.qualification = 'Changed local copy'; a.createdAt.setUTCFullYear(2000)
    expect(b.nested.qualification).toBe('No execution approval.'); expect(b.createdAt).toEqual(date)
    expect((await read(query(session, execute), session)).nested).toEqual(b.nested)
    await attempt(other, () => read(query(other, execute), other))
    expect(execute).toHaveBeenCalledTimes(2)
  })
  await read(query(session, execute), session)
  await read(query(session, execute), session)
  await attempt(session, () => read(query(session, execute), session))
  expect(execute).toHaveBeenCalledTimes(5)
})

test.each([
  ['filter/customer', { filter: { phase: 'CLAIM', customerId: 'other' } }],
  ['projection', { projection: { phase: 1 } }],
  ['sort', { options: { sort: { _id: -1 } } }],
  ['limit', { options: { limit: 2 } }],
  ['deadline', { options: { timeoutMS: 1 } }],
  ['operation', { op: 'find' }],
  ['model identity', { model: Audit }],
  ['mongoose options', { mongooseOptions: { lean: { getters: true } } }],
])('does not alias a different %s', async (_name, change) => {
  const session = {}, execute = jest.fn(async () => null)
  await attempt(session, async () => {
    await read(query(session, execute), session); await read(query(session, execute, change), session)
    expect(execute).toHaveBeenCalledTimes(2)
  })
})

test('preserves meaningful embedded-document and sort key order', async () => {
  const session = {}, execute = jest.fn(async () => [])
  await attempt(session, async () => {
    for (const filter of [{ record: { a: 1, b: 2 } }, { record: { b: 2, a: 1 } }]) {
      await read(query(session, execute, { filter }), session)
    }
    for (const sort of [{ a: 1, b: 1 }, { b: 1, a: 1 }]) {
      await read(query(session, execute, { options: { sort } }), session)
    }
    const id = new mongoose.Types.ObjectId()
    for (const owner of [id, id.toHexString()]) await read(query(session, execute, { filter: { owner } }), session)
    expect(execute).toHaveBeenCalledTimes(6)
  })
})

test('null is cached, write invalidation observes a new value, and a retried callback re-reads', async () => {
  const session = {}, execute = jest.fn().mockResolvedValueOnce(null).mockResolvedValue({ disposition: 'NOT_CONTRADICTORY' })
  await attempt(session, async () => {
    expect(await read(query(session, execute), session)).toBeNull()
    expect(await read(query(session, execute), session)).toBeNull(); expect(execute).toHaveBeenCalledTimes(1)
    invalidate(session)
    expect(await read(query(session, execute), session)).toEqual({ disposition: 'NOT_CONTRADICTORY' })
  })
  await attempt(session, () => read(query(session, execute), session))
  expect(execute).toHaveBeenCalledTimes(3)
})

test('a source or audit change after preflight is observed by the transaction', async () => {
  const session = {}; let hash = 'verified-before-preflight'
  const execute = jest.fn(async () => ({ hash }))
  expect(await read(query(null, execute), null)).toEqual({ hash })
  hash = 'changed-before-transaction'
  expect(await attempt(session, () => read(query(session, execute), session))).toEqual({ hash })
  hash = 'changed-before-next-attempt'
  expect(await attempt(session, () => read(query(session, execute), session))).toEqual({ hash })
  expect(execute).toHaveBeenCalledTimes(3)
})

test('rejected reads stay failed within an attempt and never poison a fresh callback', async () => {
  const session = {}, failure = new Error('Required audit read failed')
  const execute = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue({ signature: 'fresh' })
  await expect(attempt(session, async () => {
    await expect(read(query(session, execute), session)).rejects.toBe(failure)
    await read(query(session, execute), session)
  })).rejects.toBe(failure)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(await attempt(session, () => read(query(session, execute), session))).toEqual({ signature: 'fresh' })
})

test('unsupported options and queries without the exact session read normally', async () => {
  const session = {}, execute = jest.fn(async () => ({ valid: true }))
  await attempt(session, async () => {
    for (let i = 0; i < 2; i++) await read(query(session, execute, { options: { transform: () => true } }), session)
    for (let i = 0; i < 2; i++) await read(query(null, execute), session)
    expect(execute).toHaveBeenCalledTimes(4)
  })
})
