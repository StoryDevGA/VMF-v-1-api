import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { Customer } from '../models/index.js'
import {
  adjustCustomerCredit,
  normalizeCreditBalances,
} from '../services/customerCreditService.js'
import { buildBackfillPlan } from '../scripts/backfillCustomerEntitlementHomeAndCredits.js'

describe('SS-031 customer credit boundaries', () => {
  beforeEach(() => {
    Customer.findOneAndUpdate = jest.fn()
  })

  test('normalizes absent legacy balances to safe zero values', () => {
    expect(normalizeCreditBalances()).toEqual({ websiteAnalysis: 0, documentImprovement: 0 })
    expect(normalizeCreditBalances({ websiteAnalysis: 4, documentImprovement: 2 })).toEqual({
      websiteAnalysis: 4,
      documentImprovement: 2,
    })
  })

  test('adjusts one product atomically and returns both balances', async () => {
    Customer.findOneAndUpdate.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      creditBalances: { websiteAnalysis: 12, documentImprovement: 2 },
    })

    const result = await adjustCustomerCredit({
      customerId: '507f1f77bcf86cd799439011',
      productKey: 'website',
      delta: 5,
    })

    expect(Customer.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: '507f1f77bcf86cd799439011' },
      { $inc: { 'creditBalances.websiteAnalysis': 5 } },
      { new: true, runValidators: true },
    )
    expect(result.balances).toEqual({ websiteAnalysis: 12, documentImprovement: 2 })
  })

  test('guards a negative adjustment with a balance predicate', async () => {
    Customer.findOneAndUpdate.mockResolvedValue(null)

    await expect(adjustCustomerCredit({
      customerId: '507f1f77bcf86cd799439011',
      productKey: 'DOCUMENTS',
      delta: -3,
    })).rejects.toMatchObject({ code: 'CREDIT_BALANCE_NEGATIVE', status: 409 })

    expect(Customer.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: '507f1f77bcf86cd799439011',
        'creditBalances.documentImprovement': { $gte: 3 },
      },
      { $inc: { 'creditBalances.documentImprovement': -3 } },
      { new: true, runValidators: true },
    )
  })

  test('builds an idempotent legacy-home and zero-balance backfill plan', () => {
    const plan = buildBackfillPlan({
      licenseLevels: [{ _id: 'lic-1', featureEntitlements: ['VMF'] }],
      customers: [{ _id: 'cust-1', creditBalances: { websiteAnalysis: 4 } }],
    })

    expect(plan.summary.pendingOperations).toBe(2)
    expect(plan.licenseOperations[0].updateOne.update.$set.homeExperience).toBe('CORE')
    expect(plan.customerOperations[0].updateOne.update.$set['creditBalances.documentImprovement']).toBe(0)
  })

  test('backfills invalid legacy home values without touching existing balances', () => {
    const plan = buildBackfillPlan({
      licenseLevels: [{ _id: 'lic-2', featureEntitlements: ['DEALS'], homeExperience: 'UNKNOWN' }],
      customers: [{ _id: 'cust-2', creditBalances: { websiteAnalysis: 4, documentImprovement: 8 } }],
    })

    expect(plan.summary.pendingOperations).toBe(1)
    expect(plan.licenseOperations[0].updateOne.update.$set.homeExperience).toBe('SIGNAL')
    expect(plan.customerOperations).toHaveLength(0)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })
})
