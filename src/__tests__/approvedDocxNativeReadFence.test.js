import { beforeAll, afterAll, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'
import { installControlledDocxReadFence } from '../services/controlledDocxReadFence.js'
const driver = mongoose.mongo, recorder = '698b3800f83b3257365fd7a3', originals = new Map()
let native, foreign, fence, connect, findOne, find, cursor
const user = () => ({ _id: new driver.ObjectId(recorder), isActive: true,
  memberships: [{ customerId: null, roles: [' super_admin ', 'SUPER_ADMIN'] }, { customerId: new driver.ObjectId(), roles: ['CUSTOMER_ADMIN'] }] })
const userCursor = () => {
  const result = { limit: jest.fn(value => { expect(value).toBe(-1); return result }),
    batchSize: jest.fn(value => { expect(value).toBe(1); return result }), next: jest.fn(async () => user()), close: jest.fn(async () => {}) }
  return result
}
const userQuery = () => ({ _id: new driver.ObjectId(recorder) })
const userOptions = () => ({ projection: { _id: 1, isActive: 1, memberships: 1 }, maxTimeMS: 3000 })
const roleQuery = () => ({ key: { $in: ['SUPER_ADMIN'] }, scope: 'PLATFORM' })
const roleOptions = () => ({ projection: { key: 1, scope: 1, permissions: 1, isActive: 1 }, maxTimeMS: 3000 })
const client = options => new driver.MongoClient('mongodb://127.0.0.1:1/test', { dbName: 'test', maxPoolSize: 1,
  serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000, socketTimeoutMS: 3000, ...options })
beforeAll(async () => {
  for (const p of [driver.MongoClient.prototype, driver.Collection.prototype, driver.Db.prototype, driver.Admin.prototype]) originals.set(p, Object.getOwnPropertyDescriptors(p))
  connect = jest.spyOn(driver.MongoClient.prototype, 'connect').mockImplementation(async function () { return this })
  // Delegate the actual installed driver's findOne. Only cursor I/O is offline.
  findOne = jest.spyOn(driver.Collection.prototype, 'findOne')
  cursor = { limit: jest.fn(), toArray: jest.fn(async () => [{ key: 'SUPER_ADMIN', scope: 'PLATFORM', isActive: true, permissions: ['*'] }]) }
  find = jest.spyOn(driver.Collection.prototype, 'find').mockImplementation(function () { return this.collectionName === 'users' ? userCursor() : cursor })
  fence = installControlledDocxReadFence(driver, { database: 'isolated', nativeRecorderId: recorder })
  native = client(); foreign = client(); await native.connect()
})
afterAll(async () => {
  for (const [p, descriptors] of originals) Object.defineProperties(p, descriptors)
  await native.close(); await foreign.close()
})
test('actual driver receivers allow only the current recorder and membership-derived bounded role read (offline delegates)', async () => {
  await native.db('test').collection('users').findOne(userQuery(), userOptions())
  const rows = await native.db('test').collection('roles').find(roleQuery(), roleOptions()).limit(129).toArray()
  expect(rows[0].key).toBe('SUPER_ADMIN'); expect(cursor.limit).toHaveBeenCalledWith(129)
  expect(findOne).toHaveBeenCalledTimes(1); expect(find).toHaveBeenCalledTimes(2); expect(connect).toHaveBeenCalledTimes(1)
})
test.each(['unregistered', 'other database', 'other collection', 'other user', 'string id', 'extra filter', 'projection', 'timeout', 'extra option', 'aggregate', 'write', 'command'])('denies %s', kind => {
  const q = userQuery(), o = userOptions()
  let db = native.db('test'), collection = 'users'
  if (kind === 'unregistered') db = foreign.db('test')
  if (kind === 'other database') db = native.db('other')
  if (kind === 'other collection') collection = 'customers'
  if (kind === 'other user') q._id = new driver.ObjectId()
  if (kind === 'string id') q._id = recorder
  if (kind === 'extra filter') q.isActive = true
  if (kind === 'projection') o.projection.email = 1
  if (kind === 'timeout') o.maxTimeMS = 4000
  if (kind === 'extra option') o.limit = 1
  expect(() => {
    if (kind === 'aggregate') return db.collection('users').aggregate([])
    if (kind === 'write') return db.collection('users').updateOne(q, { $set: { isActive: true } })
    if (kind === 'command') return db.command({ ping: 1 })
    return db.collection(collection).findOne(q, o)
  }).toThrow('CONTROLLED_READ_FENCE')
})
test.each(['keys', 'scope', 'projection', 'filter', 'option', 'limit', 'unlimited', 'repeat limit', 'repeat consume'])('denies role %s', async kind => {
  await native.db('test').collection('users').findOne(userQuery(), userOptions())
  const q = roleQuery(), o = roleOptions()
  if (kind === 'keys') q.key.$in.push('CUSTOMER_ADMIN')
  if (kind === 'scope') q.scope = 'CUSTOMER'
  if (kind === 'projection') o.projection.name = 1
  if (kind === 'filter') q.isActive = true
  if (kind === 'option') o.sort = { key: 1 }
  expect(() => {
    const c = native.db('test').collection('roles').find(q, o)
    if (kind === 'limit') return c.limit(130)
    if (kind === 'unlimited') return c.toArray()
    c.limit(129)
    if (kind === 'repeat limit') return c.limit(129)
    c.toArray(); return c.toArray()
  }).toThrow('CONTROLLED_READ_FENCE')
})
test('failed connect and wrong native client options cannot obtain a read registration', async () => {
  const wrong = client({ maxPoolSize: 2 })
  await expect(wrong.connect()).rejects.toThrow('CONTROLLED_READ_FENCE'); await wrong.close()
  const failed = client(); connect.mockRejectedValueOnce(Error('NATIVE_CONNECT_FAILED'))
  await expect(failed.connect()).rejects.toThrow('NATIVE_CONNECT_FAILED')
  expect(() => failed.db('test').collection('users').findOne(userQuery(), userOptions())).toThrow('CONTROLLED_READ_FENCE')
  await failed.close()
})
test('direct user cursors remain blocked while a real findOne is awaiting I/O and after it returns', async () => {
  let release
  const c = userCursor(); c.next.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  find.mockReturnValueOnce(c)
  const users = native.db('test').collection('users'), pending = users.findOne(userQuery(), userOptions())
  expect(() => users.find(userQuery(), userOptions())).toThrow('CONTROLLED_READ_FENCE')
  release(user()); await pending
  expect(c.limit).toHaveBeenCalledWith(-1); expect(c.batchSize).toHaveBeenCalledWith(1); expect(c.close).toHaveBeenCalledTimes(1)
  expect(() => users.find(userQuery(), userOptions())).toThrow('CONTROLLED_READ_FENCE')
})
test.each(['copied query', 'copied options', 'reentrant findOne', 'second delegation'])('refuses internal %s without leaving a delegation', async kind => {
  findOne.mockImplementationOnce(function (q, o) {
    if (kind === 'copied query') return this.find({ ...q }, o)
    if (kind === 'copied options') return this.find(q, { ...o })
    if (kind === 'reentrant findOne') return this.findOne(q, o)
    this.find(q, o); return this.find(q, o)
  })
  const users = native.db('test').collection('users')
  await expect(Promise.resolve().then(() => users.findOne(userQuery(), userOptions()))).rejects.toThrow('CONTROLLED_READ_FENCE')
  expect(() => users.find(userQuery(), userOptions())).toThrow('CONTROLLED_READ_FENCE')
  await expect(users.findOne(userQuery(), userOptions())).resolves.toMatchObject({ isActive: true })
})
