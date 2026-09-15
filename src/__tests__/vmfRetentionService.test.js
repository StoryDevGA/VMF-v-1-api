import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'

let session

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
})

const VMF_ID = '807f1f77bcf86cd799439055'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'

const makeSoftDeletedVmf = (overrides = {}) => ({
  _id: VMF_ID,
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  name: 'Purged VMF',
  deletedAt: new Date('2026-02-01T00:00:00.000Z'),
  purgeAfter: new Date('2026-03-01T00:00:00.000Z'),
  ...overrides,
})

const mockVmfQuery = (VMF, rows) => {
  VMF.find.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(rows),
      }),
    }),
  })
}

let VMF
let Deal
let User
let performanceCacheService
let vmfRetentionService

beforeAll(async () => {
  const models = await import('../models/index.js')
  VMF = models.VMF
  Deal = models.Deal
  User = models.User
  performanceCacheService = (await import('../services/performanceCacheService.js')).default
  vmfRetentionService = (await import('../services/vmfRetentionService.js')).default
})

beforeEach(() => {
  session = { withTransaction: jest.fn(async (fn) => fn()), endSession: jest.fn() }
  mongoose.startSession = jest.fn().mockResolvedValue(session)
  VMF.find = jest.fn()
  VMF.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 })
  Deal.countDocuments = jest.fn().mockReturnValue({ session: jest.fn().mockResolvedValue(0) })
  Deal.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 })
  User.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 })
  performanceCacheService.invalidateAllUserPermissions = jest.fn().mockResolvedValue(undefined)
})

describe('vmfRetentionService.purgeExpiredSoftDeletedVmfs', () => {
  test('returns empty summary when no VMFs are eligible for purge', async () => {
    mockVmfQuery(VMF, [])

    const result = await vmfRetentionService.purgeExpiredSoftDeletedVmfs({
      now: new Date('2026-03-24T00:00:00.000Z'),
    })

    expect(result.scannedCount).toBe(0)
    expect(result.purgedCount).toBe(0)
    expect(result.skippedDueToActiveDeals).toBe(0)
    expect(result.failedCount).toBe(0)
    expect(performanceCacheService.invalidateAllUserPermissions).not.toHaveBeenCalled()
  })

  test('purges eligible VMFs and invalidates permission cache', async () => {
    mockVmfQuery(VMF, [makeSoftDeletedVmf()])

    const result = await vmfRetentionService.purgeExpiredSoftDeletedVmfs({
      now: new Date('2026-03-24T00:00:00.000Z'),
    })

    expect(result.scannedCount).toBe(1)
    expect(result.purgedCount).toBe(1)
    expect(Deal.updateMany).toHaveBeenCalledWith(
      { vmfId: VMF_ID },
      { $set: { status: 'ARCHIVED' } },
      { session },
    )
    expect(User.updateMany).toHaveBeenCalledWith(
      { 'vmfGrants.vmfId': VMF_ID },
      { $pull: { vmfGrants: { vmfId: VMF_ID } } },
      { session },
    )
    expect(VMF.deleteOne).toHaveBeenCalledWith(expect.objectContaining({ _id: VMF_ID, deletedAt: { $type: 'date' } }), { session })
    expect(performanceCacheService.invalidateAllUserPermissions).toHaveBeenCalled()
  })

  test('skips purge when active deals still exist', async () => {
    mockVmfQuery(VMF, [makeSoftDeletedVmf()])
    Deal.countDocuments.mockReturnValue({ session: jest.fn().mockResolvedValue(2) })

    const result = await vmfRetentionService.purgeExpiredSoftDeletedVmfs({
      now: new Date('2026-03-24T00:00:00.000Z'),
    })

    expect(result.scannedCount).toBe(1)
    expect(result.purgedCount).toBe(0)
    expect(result.skippedDueToActiveDeals).toBe(1)
    expect(Deal.updateMany).not.toHaveBeenCalled()
    expect(performanceCacheService.invalidateAllUserPermissions).not.toHaveBeenCalled()
  })

  test('does not count or clean up a candidate restored before the transaction', async () => {
    mockVmfQuery(VMF, [makeSoftDeletedVmf()])
    VMF.deleteOne.mockResolvedValue({ deletedCount: 0 })
    const result = await vmfRetentionService.purgeExpiredSoftDeletedVmfs()
    expect(result.purgedCount).toBe(0)
    expect(Deal.countDocuments).not.toHaveBeenCalled()
    expect(User.updateMany).not.toHaveBeenCalled()
    expect(session.endSession).toHaveBeenCalledTimes(1)
  })

  test('reports write failure and releases session without claiming purge', async () => {
    mockVmfQuery(VMF, [makeSoftDeletedVmf()])
    User.updateMany.mockRejectedValue(new Error('write failed'))
    const result = await vmfRetentionService.purgeExpiredSoftDeletedVmfs()
    expect(result.failedCount).toBe(1)
    expect(result.purgedCount).toBe(0)
    expect(session.endSession).toHaveBeenCalledTimes(1)
    expect(performanceCacheService.invalidateAllUserPermissions).not.toHaveBeenCalled()
  })
})
