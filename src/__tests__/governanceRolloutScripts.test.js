import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { Customer, User } from '../models/index.js'
import LicenseLevel from '../models/LicenseLevel.js'
import {
  buildBackfillPlan,
  runBackfillCustomerLicenseGovernance,
} from '../scripts/backfillCustomerLicenseGovernance.js'
import {
  buildInvariantViolationReport,
  ISSUE_CODES,
} from '../scripts/reportCustomerAdminInvariantViolations.js'

const ACTOR_ID = '507f1f77bcf86cd799439011'
const LICENSE_LEVEL_ID = '607f1f77bcf86cd799439022'

const makeChainableSelectLean = (resolvedValue) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(resolvedValue),
  }),
})

let originalCustomerFind
let originalCustomerBulkWrite
let originalUserFindOne
let originalUserAggregate
let originalLicenseLevelFindOne

beforeEach(() => {
  originalCustomerFind = Customer.find
  originalCustomerBulkWrite = Customer.bulkWrite
  originalUserFindOne = User.findOne
  originalUserAggregate = User.aggregate
  originalLicenseLevelFindOne = LicenseLevel.findOne
})

afterEach(() => {
  Customer.find = originalCustomerFind
  Customer.bulkWrite = originalCustomerBulkWrite
  User.findOne = originalUserFindOne
  User.aggregate = originalUserAggregate
  LicenseLevel.findOne = originalLicenseLevelFindOne
  jest.restoreAllMocks()
})

describe('buildBackfillPlan', () => {
  test('builds dry-run summary and remediation rows deterministically', () => {
    const customers = [
      {
        _id: 'c1',
        name: 'Alpha',
        status: 'ACTIVE',
        licenseLevelId: null,
        governance: {},
      },
      {
        _id: 'c2',
        name: 'Bravo',
        status: 'ACTIVE',
        licenseLevelId: 'l2',
        governance: {
          maxTenants: 3,
          maxVmfsPerTenant: 2,
          customerAdminUserId: 'u2',
        },
      },
      {
        _id: 'c3',
        name: 'Charlie',
        status: 'ACTIVE',
        licenseLevelId: 'l3',
        governance: {
          maxTenants: 2,
          maxVmfsPerTenant: 2,
          customerAdminUserId: null,
        },
      },
      {
        _id: 'c4',
        name: 'Delta',
        status: 'ACTIVE',
        licenseLevelId: 'l4',
        governance: {
          maxTenants: 2,
          maxVmfsPerTenant: 1,
          customerAdminUserId: null,
        },
      },
      {
        _id: 'c5',
        name: 'Echo',
        status: 'DISABLED',
        licenseLevelId: null,
        governance: {},
      },
    ]

    const activeAdminMap = new Map([
      ['c1', new Set(['u1'])],
      ['c2', new Set(['u2'])],
      ['c3', new Set(['u3', 'u4'])],
    ])

    const result = buildBackfillPlan({
      customers,
      activeAdminMap,
      defaultLicenseLevelId: LICENSE_LEVEL_ID,
    })

    expect(result.summary).toMatchObject({
      totalCustomers: 5,
      pendingUpdates: 2,
      licenseLevelBackfilled: 2,
      governanceMaxTenantsBackfilled: 2,
      governanceMaxVmfsPerTenantBackfilled: 2,
      canonicalAdminBackfilled: 1,
      activeCustomersWithZeroAdmins: 1,
      activeCustomersWithMultipleAdmins: 1,
    })

    expect(result.operations).toHaveLength(2)
    expect(result.remediation).toHaveLength(2)
    expect(result.remediation.map((row) => row.reason).sort()).toEqual([
      'MULTIPLE_ACTIVE_CUSTOMER_ADMINS',
      'ZERO_ACTIVE_CUSTOMER_ADMINS',
    ])
  })
})

describe('runBackfillCustomerLicenseGovernance', () => {
  test('apply mode writes planned updates', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})

    User.findOne = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: ACTOR_ID }),
    })

    LicenseLevel.findOne = jest.fn().mockResolvedValue({
      _id: LICENSE_LEVEL_ID,
      name: 'LEGACY_DEFAULT',
    })

    Customer.find = jest.fn().mockReturnValue(
      makeChainableSelectLean([
        {
          _id: 'c1',
          name: 'Alpha',
          status: 'ACTIVE',
          licenseLevelId: null,
          governance: {},
        },
      ]),
    )

    User.aggregate = jest.fn().mockResolvedValue([
      { userId: 'u1', customerId: 'c1' },
    ])

    Customer.bulkWrite = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })

    const logs = []
    const result = await runBackfillCustomerLicenseGovernance({
      apply: true,
      logger: (message) => logs.push(message),
      dependencies: {
        connect,
        disconnect,
      },
    })

    expect(connect).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
    expect(Customer.bulkWrite).toHaveBeenCalledTimes(1)
    expect(result.appliedOperations).toBe(1)
    expect(result.summary.pendingUpdates).toBe(1)
    expect(logs.some((line) => String(line).includes('applied operations: 1'))).toBe(true)
  })
})

describe('buildInvariantViolationReport', () => {
  test('reports canonical/admin violations for active customers', () => {
    const customers = [
      {
        _id: 'c1',
        name: 'Alpha',
        governance: { customerAdminUserId: null },
      },
      {
        _id: 'c2',
        name: 'Bravo',
        governance: { customerAdminUserId: 'u2' },
      },
    ]

    const activeAdminMap = new Map([
      ['c1', new Set()],
      ['c2', new Set(['u3'])],
    ])

    const canonicalUsersById = new Map([
      [
        'u2',
        {
          _id: 'u2',
          isActive: false,
          memberships: [{ customerId: 'c2', roles: ['USER'] }],
        },
      ],
    ])

    const report = buildInvariantViolationReport({
      customers,
      activeAdminMap,
      canonicalUsersById,
    })

    expect(report.summary.totalActiveCustomers).toBe(2)
    expect(report.summary.violatingCustomers).toBe(2)
    expect(report.summary.issuesByCode[ISSUE_CODES.ZERO_ACTIVE_CUSTOMER_ADMINS]).toBe(1)
    expect(report.summary.issuesByCode[ISSUE_CODES.CANONICAL_ADMIN_MISSING]).toBe(1)
    expect(report.summary.issuesByCode[ISSUE_CODES.CANONICAL_ADMIN_NOT_ACTIVE]).toBe(1)
    expect(report.summary.issuesByCode[ISSUE_CODES.CANONICAL_ADMIN_NOT_CUSTOMER_ADMIN]).toBe(1)
    expect(report.summary.issuesByCode[ISSUE_CODES.CANONICAL_ADMIN_MISMATCH]).toBe(1)
  })
})
