import { afterAll, afterEach, beforeAll, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { VMF, Deal, User, Tenant } from '../models/index.js'
import { purgeExpiredSoftDeletedVmfs } from '../services/vmfRetentionService.js'
import { saveDealWithVmfGuard } from '../services/dealPersistenceService.js'
import cache from '../services/performanceCacheService.js'

let server
let invalidation
const cutoff = new Date('2026-09-15T00:00:00Z')
beforeAll(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.14' } })
  const uri = server.getUri('vmf_retention_synthetic')
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) throw new Error('Synthetic loopback database required')
  await mongoose.connect(uri, { autoIndex: false })
  for (const model of [VMF, Deal, User, Tenant]) await model.createCollection()
}, 180000)
afterEach(() => jest.restoreAllMocks())
afterAll(async () => {
  await mongoose.disconnect()
  if (server) await server.stop()
})

const fixture = async ({ active = false, live = false } = {}) => {
  const ids = Object.fromEntries(['vmf', 'tenant', 'customer', 'user', 'deal'].map((key) => [key, new mongoose.Types.ObjectId()]))
  await Tenant.collection.insertOne({ _id: ids.tenant, status: 'ENABLED' })
  await VMF.collection.insertOne({ _id: ids.vmf, customerId: ids.customer, tenantId: ids.tenant,
    name: 'Synthetic retention fixture', status: live ? 'ACTIVE' : 'ARCHIVED',
    deletedAt: live ? null : new Date('2026-07-01'), purgeAfter: new Date('2026-08-01'), __v: 0 })
  await Deal.collection.insertOne({ _id: ids.deal, vmfId: ids.vmf, customerId: ids.customer,
    tenantId: ids.tenant, createdBy: ids.user, title: 'Synthetic deal', status: active ? 'ACTIVE' : 'ARCHIVED' })
  await User.collection.insertOne({ _id: ids.user, vmfGrants: [{ vmfId: ids.vmf }] })
  invalidation = jest.spyOn(cache, 'invalidateAllUserPermissions').mockResolvedValue({ skipped: false })
  return ids
}
const snapshot = async (ids) => ({
  vmf: await VMF.collection.findOne({ _id: ids.vmf }),
  deal: await Deal.collection.findOne({ _id: ids.deal }),
  user: await User.collection.findOne({ _id: ids.user }),
})
const isolateCandidate = (ids) => {
  const find = VMF.find.bind(VMF)
  jest.spyOn(VMF, 'find').mockImplementation((filter) => find({ ...filter, _id: ids.vmf }))
}

test.each(['parent', 'deals', 'grants'])('rolls back every document when the %s write fails', async (stage) => {
  const ids = await fixture()
  isolateCandidate(ids)
  const before = await snapshot(ids)
  const model = stage === 'parent' ? VMF : stage === 'deals' ? Deal : User
  jest.spyOn(model, stage === 'parent' ? 'deleteOne' : 'updateMany').mockRejectedValue(new Error('Synthetic write fault'))
  const result = await purgeExpiredSoftDeletedVmfs({ now: cutoff })
  expect(result).toMatchObject({ failedCount: 1, purgedCount: 0 })
  expect(await snapshot(ids)).toEqual(before)
  expect(invalidation).not.toHaveBeenCalled()
})

test('active deal rejection rolls back parent deletion and preserves grants', async () => {
  const ids = await fixture({ active: true })
  isolateCandidate(ids)
  const before = await snapshot(ids)
  const result = await purgeExpiredSoftDeletedVmfs({ now: cutoff })
  expect(result).toMatchObject({ skippedDueToActiveDeals: 1, purgedCount: 0, failedCount: 0 })
  expect(await snapshot(ids)).toEqual(before)
})

test('commits cleanup once under competing purge workers and preserves unrelated records', async () => {
  const other = await fixture({ live: true })
  const beforeOther = await snapshot(other)
  const ids = await fixture()
  isolateCandidate(ids)
  const results = await Promise.all([purgeExpiredSoftDeletedVmfs({ now: cutoff }), purgeExpiredSoftDeletedVmfs({ now: cutoff })])
  expect(results.reduce((sum, result) => sum + result.purgedCount, 0)).toBe(1)
  expect(await VMF.findById(ids.vmf)).toBeNull()
  expect((await User.collection.findOne({ _id: ids.user })).vmfGrants).toEqual([])
  expect(await snapshot(other)).toEqual(beforeOther)
  expect(invalidation).toHaveBeenCalledTimes(1)
})

test('stale candidate restored before transaction remains intact', async () => {
  const ids = await fixture()
  const candidate = await VMF.findById(ids.vmf)
  await VMF.updateOne({ _id: ids.vmf }, { $set: { deletedAt: null, status: 'ACTIVE' } })
  jest.spyOn(VMF, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ select: async () => [candidate] }) }) })
  const before = await snapshot(ids)
  const result = await purgeExpiredSoftDeletedVmfs({ now: cutoff })
  expect(result.purgedCount).toBe(0)
  expect(await snapshot(ids)).toEqual(before)
})

test.each(['create', 'restore'])('concurrent %s cannot leave an active deal after purge', async (mode) => {
  const ids = await fixture()
  isolateCandidate(ids)
  const deal = mode === 'create'
    ? new Deal({ vmfId: ids.vmf, tenantId: ids.tenant, customerId: ids.customer, createdBy: ids.user, title: 'New synthetic deal' })
    : await Deal.findById(ids.deal)
  deal.status = 'ACTIVE'
  const [write, purge] = await Promise.allSettled([saveDealWithVmfGuard(deal), purgeExpiredSoftDeletedVmfs({ now: cutoff })])
  expect(write.status).toBe('rejected')
  expect(purge.value.purgedCount).toBe(1)
  expect(await Deal.countDocuments({ vmfId: ids.vmf, status: 'ACTIVE' })).toBe(0)
})

test('deal save fault rolls back the shared parent version write', async () => {
  const ids = await fixture({ live: true })
  const deal = await Deal.findById(ids.deal)
  deal.status = 'ACTIVE'
  jest.spyOn(deal, 'save').mockRejectedValue(new Error('Synthetic child write fault'))
  await expect(saveDealWithVmfGuard(deal)).rejects.toThrow('Synthetic child write fault')
  expect((await VMF.findById(ids.vmf)).__v).toBe(0)
})

test('valid creation and model restore commit a shared parent write', async () => {
  const ids = await fixture({ live: true })
  const deal = new Deal({ vmfId: ids.vmf, tenantId: ids.tenant, customerId: ids.customer, createdBy: ids.user, title: 'Synthetic create' })
  await saveDealWithVmfGuard(deal)
  await (await Deal.findById(ids.deal)).restore()
  expect((await VMF.findById(ids.vmf)).__v).toBe(2)
  expect(await Deal.countDocuments({ vmfId: ids.vmf, status: 'ACTIVE' })).toBe(2)
})

test('in-flight deal save holds a parent write conflict against a competing deletion', async () => {
  const ids = await fixture({ live: true })
  const deal = new Deal({ vmfId: ids.vmf, tenantId: ids.tenant, customerId: ids.customer, createdBy: ids.user, title: 'Synthetic locked create' })
  const save = deal.save.bind(deal)
  let conflict
  jest.spyOn(deal, 'save').mockImplementation(async (options) => {
    const competing = await mongoose.startSession()
    try {
      competing.startTransaction()
      await VMF.deleteOne({ _id: ids.vmf }, { session: competing, maxTimeMS: 100 })
    } catch (error) {
      conflict = error
    } finally {
      if (competing.inTransaction()) await competing.abortTransaction()
      await competing.endSession()
    }
    return save(options)
  })
  await saveDealWithVmfGuard(deal)
  expect([24, 50, 112]).toContain(conflict?.code)
  expect(await VMF.findById(ids.vmf)).not.toBeNull()
  expect(await Deal.countDocuments({ _id: deal._id, status: 'ACTIVE' })).toBe(1)
})
