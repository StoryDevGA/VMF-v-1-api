import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'

const customerFindById = jest.fn()
const customerFindOneAndUpdate = jest.fn()
const licenseLevelFindById = jest.fn()
const auditLogFromRequest = jest.fn()

jest.unstable_mockModule('../models/index.js', () => ({
  Customer: {
    findById: customerFindById,
    findOneAndUpdate: customerFindOneAndUpdate,
  },
  Invitation: {},
  LicenseLevel: { findById: licenseLevelFindById },
  Tenant: {},
  User: {},
}))
jest.unstable_mockModule('../services/auditService.js', () => ({
  default: {
    logFromRequest: auditLogFromRequest,
    AUDIT_ACTIONS: { CUSTOMER_CREDIT_ADJUSTED: 'CUSTOMER_CREDIT_ADJUSTED' },
    RESOURCE_TYPES: { Customer: 'Customer' },
  },
}))
jest.unstable_mockModule('../services/provisioningService.js', () => ({ createCustomerWithDefaults: jest.fn() }))
jest.unstable_mockModule('../services/performanceCacheService.js', () => ({
  default: {},
}))
jest.unstable_mockModule('../services/customerGovernanceService.js', () => ({ default: {} }))
jest.unstable_mockModule('../services/emailService.js', () => ({ default: {} }))
jest.unstable_mockModule('../services/invitationService.js', () => ({ default: {} }))
jest.unstable_mockModule('../services/manualTestPasswordBootstrapService.js', () => ({
  applyManualTestPasswordBootstrap: jest.fn(),
}))
jest.unstable_mockModule('../config/logger.js', () => ({ default: {} }))
jest.unstable_mockModule('../config/env.js', () => ({ default: {} }))

const { adjustCustomerCredits } = await import('../controllers/customer.controller.js')

const CUSTOMER_ID = '507f1f77bcf86cd799439011'
const LICENSE_ID = '607f1f77bcf86cd799439022'

const makeSelectSessionQuery = (value) => ({
  select: jest.fn(() => ({
    session: jest.fn().mockResolvedValue(value),
  })),
})

const makeResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
})

const makeRequest = (overrides = {}) => ({
  params: { customerId: CUSTOMER_ID },
  body: { productKey: 'WEBSITE', delta: 2, reason: 'Support adjustment', source: 'MANUAL' },
  requestId: 'request-1',
  ...overrides,
})

describe('SS-031 customer credit controller guard', () => {
  let session

  beforeEach(() => {
    jest.clearAllMocks()
    session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session)
    customerFindOneAndUpdate.mockReturnValue({
      session: jest.fn().mockResolvedValue({
        _id: CUSTOMER_ID,
        creditBalances: { websiteAnalysis: 5, documentImprovement: 0 },
      }),
    })
    auditLogFromRequest.mockResolvedValue(undefined)
  })

  test('adjusts credits only for a Signal licence and writes the audit record', async () => {
    customerFindById.mockReturnValue(makeSelectSessionQuery({ _id: CUSTOMER_ID, licenseLevelId: LICENSE_ID }))
    licenseLevelFindById.mockReturnValue(makeSelectSessionQuery({ homeExperience: 'SIGNAL' }))
    const response = makeResponse()

    await adjustCustomerCredits(makeRequest(), response, jest.fn())

    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customerId: CUSTOMER_ID, resultingBalance: 5 }),
    }))
    expect(auditLogFromRequest).toHaveBeenCalledTimes(1)
  })

  test('rejects credit adjustment for a non-Signal licence without mutating or auditing', async () => {
    customerFindById.mockReturnValue(makeSelectSessionQuery({ _id: CUSTOMER_ID, licenseLevelId: LICENSE_ID }))
    licenseLevelFindById.mockReturnValue(makeSelectSessionQuery({ homeExperience: 'CORE' }))
    const response = makeResponse()

    await adjustCustomerCredits(makeRequest(), response, jest.fn())

    expect(response.status).toHaveBeenCalledWith(422)
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    }))
    expect(customerFindOneAndUpdate).not.toHaveBeenCalled()
    expect(auditLogFromRequest).not.toHaveBeenCalled()
  })

  test('returns 404 when the customer does not exist', async () => {
    customerFindById.mockReturnValue(makeSelectSessionQuery(null))
    const response = makeResponse()

    await adjustCustomerCredits(makeRequest(), response, jest.fn())

    expect(response.status).toHaveBeenCalledWith(404)
    expect(customerFindOneAndUpdate).not.toHaveBeenCalled()
  })

  test('passes audit failures to the error boundary so the transaction can roll back', async () => {
    customerFindById.mockReturnValue(makeSelectSessionQuery({ _id: CUSTOMER_ID, licenseLevelId: LICENSE_ID }))
    licenseLevelFindById.mockReturnValue(makeSelectSessionQuery({ homeExperience: 'SIGNAL' }))
    const auditError = new Error('audit unavailable')
    auditLogFromRequest.mockRejectedValue(auditError)
    const response = makeResponse()
    const next = jest.fn()

    await adjustCustomerCredits(makeRequest(), response, next)

    expect(session.withTransaction).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledWith(auditError)
    expect(response.status).not.toHaveBeenCalled()
  })
})
