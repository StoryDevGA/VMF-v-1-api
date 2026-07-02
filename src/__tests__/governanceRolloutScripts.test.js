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
import { unsetDeprecatedFrameworkPackageFields } from '../scripts/unsetDeprecatedFrameworkPackageFields.js'
import {
  dropLegacyFrameworkPackageActiveIndex,
  isLegacyActiveFrameworkPackageIndex,
} from '../scripts/dropLegacyFrameworkPackageActiveIndex.js'
import {
  migrateRuntimeDeploymentActiveIndex,
  isLegacyActiveRuntimeDeploymentIndex,
} from '../scripts/migrateRuntimeDeploymentActiveIndex.js'
import {
  restoreRuntimePackageDeployment,
} from '../scripts/restoreRuntimePackageDeployment.js'
import { backfillRuntimeControlVersioningFields } from '../scripts/backfillRuntimeControlVersioningFields.js'
import {
  applyReplacementPlan,
  assertDeterministicSeedStableIds,
  assertExistingStableIds,
  buildControlRecordPayload,
  buildPackageReplacementPayload,
  cloneBundleWithMappedKeys,
  withRequiredActorFields,
} from '../scripts/replaceActiveFrameworkPackageFromSeed.js'

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

describe('unsetDeprecatedFrameworkPackageFields', () => {
  test('discovers deprecated indexes by key path and reports the target database', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const collection = {
      db: { databaseName: 'vmf_test' },
      countDocuments: jest.fn().mockResolvedValue(2),
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        { name: 'legacy_validation_idx', key: { 'validationConfig.validationKey': 1, status: 1 } },
        { name: 'legacy_workflow_idx', key: { 'workflowPolicyConfig.policyKey': 1 } },
        { name: 'current_workflow_idx', key: { 'workflowBindings.policyKey': 1 } },
      ]),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
      dropIndex: jest.fn().mockResolvedValue({ ok: 1 }),
    }
    const logs = []

    const result = await unsetDeprecatedFrameworkPackageFields({
      apply: true,
      logger: (message) => logs.push(message),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })

    expect(connect).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
    expect(collection.dropIndex).toHaveBeenCalledWith('legacy_validation_idx')
    expect(collection.dropIndex).toHaveBeenCalledWith('legacy_workflow_idx')
    expect(collection.dropIndex).not.toHaveBeenCalledWith('current_workflow_idx')
    expect(result.database).toBe('vmf_test')
    expect(result.deprecatedIndexes).toEqual(['legacy_validation_idx', 'legacy_workflow_idx'])
    expect(logs[0]).toContain('database vmf_test')
  })
})

describe('dropLegacyFrameworkPackageActiveIndex', () => {
  test('detects only legacy unique active Framework Package indexes', () => {
    expect(isLegacyActiveFrameworkPackageIndex({
      name: 'unique_active_framework_package',
      key: { frameworkKey: 1, status: 1 },
      unique: true,
    })).toBe(true)
    expect(isLegacyActiveFrameworkPackageIndex({
      name: 'legacy_active_by_shape',
      key: { frameworkKey: 1, status: 1 },
      unique: true,
      partialFilterExpression: { status: 'ACTIVE' },
    })).toBe(true)
    expect(isLegacyActiveFrameworkPackageIndex({
      name: 'framework_package_status_lookup',
      key: { frameworkKey: 1, status: 1 },
    })).toBe(false)
    expect(isLegacyActiveFrameworkPackageIndex({
      name: 'unique_default_framework_package',
      key: { frameworkKey: 1, isDefault: 1 },
      unique: true,
      partialFilterExpression: { isDefault: true },
    })).toBe(false)
  })

  test('dry-run reports legacy active indexes without writing', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const collection = {
      db: { databaseName: 'vmf_test' },
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'unique_active_framework_package',
          key: { frameworkKey: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
        {
          name: 'unique_default_framework_package',
          key: { frameworkKey: 1, isDefault: 1 },
          unique: true,
          partialFilterExpression: { isDefault: true },
        },
      ]),
      dropIndex: jest.fn(),
      createIndex: jest.fn(),
    }
    const logs = []

    const result = await dropLegacyFrameworkPackageActiveIndex({
      logger: (message) => logs.push(message),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })

    expect(connect).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
    expect(collection.dropIndex).not.toHaveBeenCalled()
    expect(collection.createIndex).not.toHaveBeenCalled()
    expect(result.mode).toBe('dry-run')
    expect(result.legacyActiveIndexes).toEqual(['unique_active_framework_package'])
    expect(result.defaultPointerIndexExists).toBe(true)
    expect(logs[0]).toContain('database vmf_test')
  })

  test('apply drops legacy active indexes and creates the default pointer index when missing', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const collection = {
      db: { databaseName: 'vmf_test' },
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'unique_active_framework_package',
          key: { frameworkKey: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
      ]),
      dropIndex: jest.fn().mockResolvedValue({ ok: 1 }),
      createIndex: jest.fn().mockResolvedValue('unique_default_framework_package'),
    }

    const result = await dropLegacyFrameworkPackageActiveIndex({
      apply: true,
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })

    expect(collection.dropIndex).toHaveBeenCalledWith('unique_active_framework_package')
    expect(collection.createIndex).toHaveBeenCalledWith(
      { frameworkKey: 1, isDefault: 1 },
      {
        unique: true,
        partialFilterExpression: { isDefault: true },
        name: 'unique_default_framework_package',
      },
    )
    expect(result.droppedIndexes).toEqual(['unique_active_framework_package'])
    expect(result.defaultPointerIndexExists).toBe(false)
    expect(result.defaultPointerIndexCreated).toBe(true)
  })

  test('apply skips default pointer index creation when it already exists', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const collection = {
      db: { databaseName: 'vmf_test' },
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'unique_active_framework_package',
          key: { frameworkKey: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
        {
          name: 'unique_default_framework_package',
          key: { frameworkKey: 1, isDefault: 1 },
          unique: true,
          partialFilterExpression: { isDefault: true },
        },
      ]),
      dropIndex: jest.fn().mockResolvedValue({ ok: 1 }),
      createIndex: jest.fn(),
    }

    const result = await dropLegacyFrameworkPackageActiveIndex({
      apply: true,
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })

    expect(collection.createIndex).not.toHaveBeenCalled()
    expect(collection.dropIndex).toHaveBeenCalledWith('unique_active_framework_package')
    expect(result.defaultPointerIndexExists).toBe(true)
    expect(result.defaultPointerIndexCreated).toBe(false)
  })

  test('apply is a no-op when the database is already clean', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const collection = {
      db: { databaseName: 'vmf_test' },
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'unique_default_framework_package',
          key: { frameworkKey: 1, isDefault: 1 },
          unique: true,
          partialFilterExpression: { isDefault: true },
        },
      ]),
      dropIndex: jest.fn(),
      createIndex: jest.fn(),
    }

    const result = await dropLegacyFrameworkPackageActiveIndex({
      apply: true,
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })

    expect(collection.createIndex).not.toHaveBeenCalled()
    expect(collection.dropIndex).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.droppedIndexes).toEqual([])
    expect(result.defaultPointerIndexCreated).toBe(false)
  })

  test('apply swallows IndexNotFound when a legacy index is already gone', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const collection = {
      db: { databaseName: 'vmf_test' },
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'unique_active_framework_package',
          key: { frameworkKey: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
        {
          name: 'unique_default_framework_package',
          key: { frameworkKey: 1, isDefault: 1 },
          unique: true,
          partialFilterExpression: { isDefault: true },
        },
      ]),
      dropIndex: jest.fn().mockRejectedValue({ code: 27, codeName: 'IndexNotFound' }),
      createIndex: jest.fn(),
    }

    const result = await dropLegacyFrameworkPackageActiveIndex({
      apply: true,
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })

    expect(collection.dropIndex).toHaveBeenCalledWith('unique_active_framework_package')
    expect(result.droppedIndexes).toEqual([])
  })

  test('apply rethrows unexpected dropIndex errors', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const dropError = new Error('drop failed')
    const collection = {
      db: { databaseName: 'vmf_test' },
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'unique_active_framework_package',
          key: { frameworkKey: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
        {
          name: 'unique_default_framework_package',
          key: { frameworkKey: 1, isDefault: 1 },
          unique: true,
          partialFilterExpression: { isDefault: true },
        },
      ]),
      dropIndex: jest.fn().mockRejectedValue(dropError),
      createIndex: jest.fn(),
    }

    await expect(dropLegacyFrameworkPackageActiveIndex({
      apply: true,
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })).rejects.toThrow('drop failed')

    expect(disconnect).toHaveBeenCalled()
  })
})

describe('migrateRuntimeDeploymentActiveIndex', () => {
  test('detects only legacy unique active Runtime Deployment indexes', () => {
    expect(isLegacyActiveRuntimeDeploymentIndex({
      name: 'unique_active_runtime_deployment',
      key: { frameworkKey: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
      unique: true,
    })).toBe(true)
    expect(isLegacyActiveRuntimeDeploymentIndex({
      name: 'legacy_active_runtime_deployment_by_shape',
      key: { frameworkKey: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
      unique: true,
      partialFilterExpression: { status: 'ACTIVE' },
    })).toBe(true)
    expect(isLegacyActiveRuntimeDeploymentIndex({
      name: 'unique_active_runtime_deployment_per_package',
      key: { frameworkKey: 1, packageId: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
      unique: true,
      partialFilterExpression: { status: 'ACTIVE' },
    })).toBe(false)
    expect(isLegacyActiveRuntimeDeploymentIndex({
      name: 'runtime_deployment_status_lookup',
      key: { frameworkKey: 1, status: 1 },
    })).toBe(false)
  })

  test('dry-run reports legacy active Runtime Deployment indexes without writing', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const collection = {
      db: { databaseName: 'vmf_test' },
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'unique_active_runtime_deployment',
          key: { frameworkKey: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
      ]),
      dropIndex: jest.fn(),
      createIndex: jest.fn(),
    }
    const logs = []

    const result = await migrateRuntimeDeploymentActiveIndex({
      logger: (message) => logs.push(message),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })

    expect(connect).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
    expect(collection.dropIndex).not.toHaveBeenCalled()
    expect(collection.createIndex).not.toHaveBeenCalled()
    expect(result.mode).toBe('dry-run')
    expect(result.legacyActiveIndexes).toEqual(['unique_active_runtime_deployment'])
    expect(result.targetActiveIndexExists).toBe(false)
    expect(logs[0]).toContain('database vmf_test')
  })

  test('apply creates per-package active index before dropping legacy index', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const collection = {
      db: { databaseName: 'vmf_test' },
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'unique_active_runtime_deployment',
          key: { frameworkKey: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
      ]),
      dropIndex: jest.fn().mockResolvedValue({ ok: 1 }),
      createIndex: jest.fn().mockResolvedValue('unique_active_runtime_deployment_per_package'),
    }

    const result = await migrateRuntimeDeploymentActiveIndex({
      apply: true,
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })

    expect(collection.createIndex).toHaveBeenCalledWith(
      { frameworkKey: 1, packageId: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
      {
        unique: true,
        partialFilterExpression: { status: 'ACTIVE' },
        name: 'unique_active_runtime_deployment_per_package',
      },
    )
    expect(collection.dropIndex).toHaveBeenCalledWith('unique_active_runtime_deployment')
    expect(collection.createIndex.mock.invocationCallOrder[0]).toBeLessThan(
      collection.dropIndex.mock.invocationCallOrder[0],
    )
    expect(result.droppedIndexes).toEqual(['unique_active_runtime_deployment'])
    expect(result.targetActiveIndexCreated).toBe(true)
  })

  test('apply skips target creation when per-package active index already exists', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const collection = {
      db: { databaseName: 'vmf_test' },
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'unique_active_runtime_deployment',
          key: { frameworkKey: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
        {
          name: 'unique_active_runtime_deployment_per_package',
          key: { frameworkKey: 1, packageId: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
      ]),
      dropIndex: jest.fn().mockResolvedValue({ ok: 1 }),
      createIndex: jest.fn(),
    }

    const result = await migrateRuntimeDeploymentActiveIndex({
      apply: true,
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })

    expect(collection.createIndex).not.toHaveBeenCalled()
    expect(collection.dropIndex).toHaveBeenCalledWith('unique_active_runtime_deployment')
    expect(result.targetActiveIndexExists).toBe(true)
    expect(result.targetActiveIndexCreated).toBe(false)
  })

  test('apply is a no-op when Runtime Deployment indexes are already migrated', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const collection = {
      db: { databaseName: 'vmf_test' },
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'unique_active_runtime_deployment_per_package',
          key: { frameworkKey: 1, packageId: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
      ]),
      dropIndex: jest.fn(),
      createIndex: jest.fn(),
    }

    const result = await migrateRuntimeDeploymentActiveIndex({
      apply: true,
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })

    expect(collection.createIndex).not.toHaveBeenCalled()
    expect(collection.dropIndex).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.droppedIndexes).toEqual([])
    expect(result.targetActiveIndexCreated).toBe(false)
  })

  test('apply swallows IndexNotFound when a legacy runtime deployment index is already gone', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const collection = {
      db: { databaseName: 'vmf_test' },
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        {
          name: 'unique_active_runtime_deployment',
          key: { frameworkKey: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
        {
          name: 'unique_active_runtime_deployment_per_package',
          key: { frameworkKey: 1, packageId: 1, tenantScope: 1, deploymentMode: 1, status: 1 },
          unique: true,
          partialFilterExpression: { status: 'ACTIVE' },
        },
      ]),
      dropIndex: jest.fn().mockRejectedValue({ code: 27, codeName: 'IndexNotFound' }),
      createIndex: jest.fn(),
    }

    const result = await migrateRuntimeDeploymentActiveIndex({
      apply: true,
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        model: { collection },
      },
    })

    expect(collection.dropIndex).toHaveBeenCalledWith('unique_active_runtime_deployment')
    expect(result.droppedIndexes).toEqual([])
  })
})

describe('restoreRuntimePackageDeployment', () => {
  const packageRecord = {
    _id: '6a42b841aca8d97e82b956ce',
    frameworkKey: 'VMF',
    version: '3.1.0',
    packageKey: 'standard-package-vmf-3-1-rkm',
    status: 'ACTIVE',
    isDefault: false,
    visibility: 'INTERNAL_ONLY',
    customerAccessMode: 'ALL_CUSTOMERS',
    assignedCustomerIds: [],
  }
  const deploymentRecord = {
    _id: '6a43c5969828a0ca67e4f80b',
    deploymentId: 'deployment-vmf-global-production--20260630133310-82b956ce',
    activationId: 'activation-vmf-3-1-0-20260630133310-82b956ce',
    status: 'SUPERSEDED',
    tenantScope: 'GLOBAL',
    deploymentMode: 'PRODUCTION',
    supersededAt: new Date('2026-07-01T12:43:53.973Z'),
    supersededByDeploymentId: 'deployment-vmf-global-production--20260701124353-cfc173ca',
  }
  const snapshotRecord = {
    _id: '6a43c5969828a0ca67e4f809',
    activationId: 'activation-vmf-3-1-0-20260630133310-82b956ce',
    activationStatus: 'SUPERSEDED',
    supersededByActivationId: 'activation-vmf-3-1-1-20260701124353-cfc173ca',
  }

  const makeSelectLeanQuery = (value) => ({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
  })
  const makeSortLeanQuery = (value) => ({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
  })
  const makeRestoreModels = ({
    packageValue = packageRecord,
    deploymentValue = deploymentRecord,
    snapshotValue = snapshotRecord,
  } = {}) => ({
    FrameworkPackage: {
      findOne: jest.fn().mockReturnValue(makeSelectLeanQuery(packageValue)),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    },
    RuntimeDeployment: {
      findOne: jest.fn().mockReturnValue(makeSortLeanQuery(deploymentValue)),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    },
    RuntimeActivationSnapshot: {
      findOne: jest.fn().mockReturnValue(makeSortLeanQuery(snapshotValue)),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    },
  })

  test('dry-run reports package deployment restore actions without writing', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const models = makeRestoreModels()

    const result = await restoreRuntimePackageDeployment({
      packageKey: 'standard-package-vmf-3-1-rkm',
      customerVisible: true,
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        models,
      },
    })

    expect(connect).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
    expect(models.FrameworkPackage.findOne).toHaveBeenCalledWith({
      packageKey: 'standard-package-vmf-3-1-rkm',
    })
    expect(models.RuntimeDeployment.findOne).toHaveBeenCalledWith({
      frameworkKey: 'VMF',
      packageId: packageRecord._id,
      tenantScope: 'GLOBAL',
      deploymentMode: 'PRODUCTION',
    })
    expect(models.RuntimeActivationSnapshot.findOne).toHaveBeenCalledWith({
      activationId: deploymentRecord.activationId,
      packageId: packageRecord._id,
    })
    expect(models.FrameworkPackage.updateOne).not.toHaveBeenCalled()
    expect(models.RuntimeDeployment.updateOne).not.toHaveBeenCalled()
    expect(models.RuntimeActivationSnapshot.updateOne).not.toHaveBeenCalled()
    expect(result.mode).toBe('dry-run')
    expect(result.applied).toBe(false)
    expect(result.actions).toEqual({
      packageAccessUpdate: {
        visibility: 'CUSTOMER_VISIBLE',
        customerAccessMode: 'ALL_CUSTOMERS',
        assignedCustomerIds: [],
      },
      restoreDeployment: true,
      restoreActivationSnapshot: true,
    })
  })

  test('apply restores one package deployment and activation snapshot transactionally', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const models = makeRestoreModels()
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn(async () => {}),
    }

    const result = await restoreRuntimePackageDeployment({
      apply: true,
      packageKey: 'standard-package-vmf-3-1-rkm',
      customerVisible: true,
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        models,
        startSession: jest.fn().mockResolvedValue(session),
      },
    })

    expect(session.withTransaction).toHaveBeenCalled()
    expect(session.endSession).toHaveBeenCalled()
    expect(models.FrameworkPackage.updateOne).toHaveBeenCalledWith(
      { _id: packageRecord._id },
      {
        $set: {
          visibility: 'CUSTOMER_VISIBLE',
          customerAccessMode: 'ALL_CUSTOMERS',
          assignedCustomerIds: [],
        },
      },
      { session },
    )
    expect(models.RuntimeDeployment.updateOne).toHaveBeenCalledWith(
      { _id: deploymentRecord._id },
      {
        $set: {
          status: 'ACTIVE',
          supersededAt: null,
          supersededByDeploymentId: null,
        },
      },
      { session },
    )
    expect(models.RuntimeActivationSnapshot.updateOne).toHaveBeenCalledWith(
      { _id: snapshotRecord._id },
      {
        $set: {
          activationStatus: 'ACTIVE',
          supersededByActivationId: null,
        },
      },
      { session },
    )
    expect(result.mode).toBe('apply')
    expect(result.applied).toBe(true)
  })

  test('fails closed when the package is not active', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const models = makeRestoreModels({
      packageValue: {
        ...packageRecord,
        status: 'VALIDATED',
      },
    })

    await expect(restoreRuntimePackageDeployment({
      packageKey: 'standard-package-vmf-3-1-rkm',
      logger: jest.fn(),
      dependencies: {
        connect,
        disconnect,
        models,
      },
    })).rejects.toThrow('must be ACTIVE')

    expect(models.RuntimeDeployment.findOne).not.toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
  })
})

describe('replaceActiveFrameworkPackageFromSeed helpers', () => {
  const makePersistedDoc = (values) => {
    const doc = {
      ...values,
      $locals: {},
      set: jest.fn(function setPayload(payload) {
        Object.assign(this, payload)
      }),
      save: jest.fn(async () => {}),
    }
    return doc
  }

  const makeQuery = (doc) => {
    const exec = jest.fn(async () => doc)
    return {
      exec,
      lean: jest.fn(async () => doc),
      session: jest.fn(() => ({ exec })),
    }
  }

  const makeModel = ({ keyField, docs = [], findOne = null } = {}) => {
    function Model(payload) {
      const doc = makePersistedDoc(payload)
      Model.createdDocs.push(doc)
      return doc
    }
    Model.createdDocs = []
    Model.updateOne = jest.fn()
    Model.findOne = jest.fn((query) => {
      if (findOne) return makeQuery(findOne(query))
      const doc = docs.find((candidate) => String(candidate?.[keyField] || '') === String(query?.[keyField] || ''))
      return makeQuery(doc || null)
    })
    return Model
  }

  const makeReplacementPlan = () => ({
    target: {
      packageKey: 'standard-package-vmf-3-1-1-rkm',
      uiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
    },
    seedRecords: {
      package: {
        frameworkKey: 'VMF',
        packageKey: 'standard-package-vmf-3-1-1-rkm',
        version: '3.1.1',
        status: 'DRAFT',
        isDefault: false,
        isLocked: false,
        uiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
        workflowBindings: [{ policyKey: 'truth-generation-policy' }],
      },
      uiContract: {
        uiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
        stableId: 'ui-contract-standard-ui-contract-vmf-3-1-1-rkm',
        actions: [{ actionKey: 'RUN_VALIDATION' }],
      },
      runtimePaths: [{
        pathKey: 'framework_state.runtime.truth_projection',
        stableId: 'path-framework-state-runtime-truth-projection-164lldb',
        label: 'Truth Projection',
      }],
      workflowPolicies: [{
        key: 'truth-generation-policy',
        stableId: 'policy-truth-generation-policy',
        name: 'Truth Generation Policy',
      }],
    },
    existingRecords: {
      runtimePathMap: new Map([[
        'framework_state.runtime.truth_projection',
        { pathKey: 'framework_state.runtime.truth_projection', stableId: 'path-existing-runtime-truth-projection' },
      ]]),
      workflowPolicyMap: new Map([[
        'truth-generation-policy',
        { key: 'truth-generation-policy', stableId: 'policy-truth-generation-policy' },
      ]]),
    },
  })

  test('maps canonical r3 package and UI keys without mutating BSON-like ids', () => {
    const bsonLikeId = { toHexString: () => '698b3800f83b3257365fd7a3' }
    const bundle = [
      {
        label: 'Framework Packages',
        records: [
          {
            _id: bsonLikeId,
            packageKey: 'standard-package-vmf-3-1-1-rkm-canonical',
            uiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm-canonical',
            uiContractBinding: {
              key: 'standard-ui-contract-vmf-3-1-1-rkm-canonical',
              version: '3.1.1',
            },
            dependencyLock: {
              references: [
                {
                  targetKey: 'standard-package-vmf-3-1-1-rkm-canonical',
                  sourceUiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm-canonical',
                },
              ],
            },
          },
        ],
      },
    ]

    const mapped = cloneBundleWithMappedKeys(bundle, {
      sourcePackageKey: 'standard-package-vmf-3-1-1-rkm-canonical',
      targetPackageKey: 'standard-package-vmf-3-1-1-rkm',
      sourceUiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm-canonical',
      targetUiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
    })

    expect(mapped[0].records[0]._id).toBe(bsonLikeId)
    expect(mapped[0].records[0].packageKey).toBe('standard-package-vmf-3-1-1-rkm')
    expect(mapped[0].records[0].uiContractKey).toBe('standard-ui-contract-vmf-3-1-1-rkm')
    expect(mapped[0].records[0].uiContractBinding).toEqual({
      key: 'standard-ui-contract-vmf-3-1-1-rkm',
      version: '3.1.1',
    })
    expect(mapped[0].records[0].dependencyLock.references[0]).toEqual({
      targetKey: 'standard-package-vmf-3-1-1-rkm',
      sourceUiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
    })
  })

  test('builds locked control-record payloads while preserving existing package lock provenance', () => {
    const payload = buildControlRecordPayload({
      seedRecord: {
        _id: 'seed-id',
        key: 'truth-generation-policy',
        status: 'ACTIVE',
        isLocked: true,
        lockedByPackageKeys: ['standard-package-vmf-3-1-1-rkm'],
        steps: [{ stepKey: 'project-truth' }],
      },
      existingRecord: {
        lockedByPackageKeys: ['standard-package-vmf-3-1-rkm'],
      },
      targetPackageKey: 'standard-package-vmf-3-1-1-rkm',
    })

    expect(payload._id).toBeUndefined()
    expect(payload.isLocked).toBeUndefined()
    expect(payload.key).toBe('truth-generation-policy')
    expect(payload.steps).toEqual([{ stepKey: 'project-truth' }])
    expect(payload.lockedByPackageKeys).toEqual([
      'standard-package-vmf-3-1-1-rkm',
      'standard-package-vmf-3-1-rkm',
    ])
  })

  test('builds package payloads that preserve the active package identity', () => {
    const payload = buildPackageReplacementPayload({
      seedPackage: {
        frameworkKey: 'VMF',
        packageKey: 'standard-package-vmf-3-1-1-rkm-canonical',
        version: '3.1.1',
        status: 'DRAFT',
        isDefault: false,
        isLocked: false,
        uiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
        uiContractBinding: {
          key: 'standard-ui-contract-vmf-3-1-1-rkm',
          version: '3.1.1',
          status: 'DRAFT',
        },
        workflowBindings: [{ policyKey: 'truth-generation-policy' }],
        dependencyLock: { references: [{ targetKey: 'truth-generation-policy' }] },
      },
      existingPackage: {
        frameworkKey: 'VMF',
        packageKey: 'standard-package-vmf-3-1-1-rkm',
        version: '3.1.1',
        status: 'ACTIVE',
        isDefault: true,
        isLocked: true,
      },
    })

    expect(payload.packageKey).toBe('standard-package-vmf-3-1-1-rkm')
    expect(payload.version).toBe('3.1.1')
    expect(payload.status).toBe('ACTIVE')
    expect(payload.isDefault).toBe(true)
    expect(payload.isLocked).toBe(true)
    expect(payload.uiContractBinding).toEqual({
      key: 'standard-ui-contract-vmf-3-1-1-rkm',
      version: '3.1.1',
      status: 'DRAFT',
    })
    expect(payload.workflowBindings).toEqual([{ policyKey: 'truth-generation-policy' }])
    expect(payload.dependencyLock).toEqual({ references: [{ targetKey: 'truth-generation-policy' }] })
  })

  test('rejects seed control records whose stable ids do not match deterministic identities', () => {
    expect(() => assertDeterministicSeedStableIds({
      workflowPolicies: [{
        key: 'truth-generation-policy',
        stableId: 'policy-colliding-stale-id',
      }],
    })).toThrow(/does not match deterministic stableId "policy-truth-generation-policy"/)
  })

  test('rejects existing control records whose stable ids already drifted from deterministic identities', () => {
    expect(() => assertExistingStableIds({
      records: [{ key: 'run-validation-policy' }],
      existingMap: new Map([[
        'run-validation-policy',
        { key: 'run-validation-policy', stableId: 'workflow-policy-run-validation-policy' },
      ]]),
      keyField: 'key',
      buildStableId: (key) => `policy-${key}`,
      sourceLabel: 'Existing workflow policy',
    })).toThrow(/Existing workflow policy run-validation-policy stableId/)
  })

  test('backfills required actor fields for legacy persisted seed records', () => {
    const existingActorId = '507f1f77bcf86cd799439011'
    const payload = withRequiredActorFields(
      { label: 'Truth Projection', updatedBy: existingActorId },
      { createdBy: existingActorId },
    )
    const legacyPayload = withRequiredActorFields({ label: 'Truth Projection' }, {})

    expect(payload).not.toHaveProperty('createdBy')
    expect(String(payload.updatedBy)).toBe(existingActorId)
    expect(String(legacyPayload.createdBy)).toBe('000000000000000000000001')
    expect(String(legacyPayload.updatedBy)).toBe('000000000000000000000001')
  })

  test('applies replacement through hydrated document saves and preserves existing stable ids', async () => {
    const session = {}
    const packageDoc = makePersistedDoc({
      frameworkKey: 'VMF',
      packageKey: 'standard-package-vmf-3-1-1-rkm',
      version: '3.1.1',
      status: 'ACTIVE',
      isDefault: true,
      isLocked: true,
      stableId: 'package-existing',
    })
    const uiContractDoc = makePersistedDoc({
      uiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
      status: 'ACTIVE',
      stableId: 'ui-contract-existing',
    })
    const runtimePathDoc = makePersistedDoc({
      pathKey: 'framework_state.runtime.truth_projection',
      stableId: 'path-existing-runtime-truth-projection',
    })
    const workflowPolicyDoc = makePersistedDoc({
      key: 'truth-generation-policy',
      stableId: 'policy-truth-generation-policy',
    })
    const frameworkPackageModel = makeModel({
      findOne: (query) => (query?.packageKey?.$ne ? null : packageDoc),
    })
    const runtimePathModel = makeModel({
      keyField: 'pathKey',
      docs: [runtimePathDoc],
    })
    const workflowPolicyModel = makeModel({
      keyField: 'key',
      docs: [workflowPolicyDoc],
    })
    const uiContractModel = makeModel({
      keyField: 'uiContractKey',
      docs: [uiContractDoc],
    })

    await applyReplacementPlan({
      plan: makeReplacementPlan(),
      models: {
        FrameworkPackage: frameworkPackageModel,
        RuntimePathRegistry: runtimePathModel,
        WorkflowPolicy: workflowPolicyModel,
        UIContract: uiContractModel,
      },
      session,
      targetPackageKey: 'standard-package-vmf-3-1-1-rkm',
    })

    expect(runtimePathDoc.save).toHaveBeenCalledWith({ session })
    expect(workflowPolicyDoc.save).toHaveBeenCalledWith({ session })
    expect(uiContractDoc.save).toHaveBeenCalledWith({ session })
    expect(packageDoc.save).toHaveBeenCalledWith({ session })
    expect(runtimePathDoc.set.mock.calls[0][0]).not.toHaveProperty('stableId')
    expect(String(runtimePathDoc.set.mock.calls[0][0].createdBy)).toBe('000000000000000000000001')
    expect(String(runtimePathDoc.set.mock.calls[0][0].updatedBy)).toBe('000000000000000000000001')
    expect(runtimePathDoc.$locals.allowLockedRuntimeControlWrite).toBe(true)
    expect(runtimePathDoc.stableId).toBe('path-existing-runtime-truth-projection')
    expect(runtimePathModel.updateOne).not.toHaveBeenCalled()
    expect(workflowPolicyModel.updateOne).not.toHaveBeenCalled()
    expect(uiContractModel.updateOne).not.toHaveBeenCalled()
    expect(frameworkPackageModel.updateOne).not.toHaveBeenCalled()
  })

  test('rechecks the target package active invariant inside the apply transaction', async () => {
    const inactivePackageDoc = makePersistedDoc({
      frameworkKey: 'VMF',
      packageKey: 'standard-package-vmf-3-1-1-rkm',
      version: '3.1.1',
      status: 'DEPRECATED',
      isDefault: true,
      isLocked: true,
    })
    const uiContractDoc = makePersistedDoc({
      uiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
      status: 'ACTIVE',
    })
    const runtimePathModel = makeModel({ keyField: 'pathKey' })
    const workflowPolicyModel = makeModel({ keyField: 'key' })

    await expect(applyReplacementPlan({
      plan: makeReplacementPlan(),
      models: {
        FrameworkPackage: makeModel({ findOne: () => inactivePackageDoc }),
        RuntimePathRegistry: runtimePathModel,
        WorkflowPolicy: workflowPolicyModel,
        UIContract: makeModel({ findOne: () => uiContractDoc }),
      },
      session: {},
      targetPackageKey: 'standard-package-vmf-3-1-1-rkm',
    })).rejects.toThrow(/must still be ACTIVE during apply/)

    expect(runtimePathModel.createdDocs).toHaveLength(0)
    expect(workflowPolicyModel.createdDocs).toHaveLength(0)
  })
})

describe('backfillRuntimeControlVersioningFields', () => {
  test('dry-run reports Runtime Control and Framework Package matches without writing', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const runtimeCollection = {
      countDocuments: jest.fn().mockResolvedValue(2),
      updateMany: jest.fn(),
    }
    const frameworkPackageCollection = {
      db: { databaseName: 'vmf_test' },
      countDocuments: jest.fn().mockResolvedValue(1),
      updateMany: jest.fn(),
    }
    const logs = []

    const result = await backfillRuntimeControlVersioningFields({
      logger: (message) => logs.push(message),
      dependencies: {
        connect,
        disconnect,
        runtimeControlConfigs: [
          {
            collectionKey: 'RuntimePathRegistry',
            model: { collection: runtimeCollection },
            compatibilityMode: 'INHERITED_MINOR',
          },
        ],
        frameworkPackageModel: { collection: frameworkPackageCollection },
      },
    })

    expect(connect).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
    expect(result.mode).toBe('dry-run')
    expect(result.database).toBe('vmf_test')
    expect(result.runtimeControl[0]).toEqual(expect.objectContaining({
      collectionKey: 'RuntimePathRegistry',
      matched: 2,
      modified: 0,
    }))
    expect(result.runtimeControl[0].fieldsToAdd).toContain('componentVersion')
    expect(result.runtimeControl[0].fieldsToAdd).toContain('lockedByPackageKeys')
    expect(result.frameworkPackages).toEqual(expect.objectContaining({ matched: 1, modified: 0 }))
    expect(result.frameworkPackages.fieldsToAdd).toContain('dependencyLock')
    expect(runtimeCollection.updateMany).not.toHaveBeenCalled()
    expect(frameworkPackageCollection.updateMany).not.toHaveBeenCalled()
    expect(logs[0]).toContain('database vmf_test')
    expect(logs[0]).toContain('Runtime Control fields to add/normalize')
    expect(logs[0]).toContain('UI Contract locks to apply')
  })

  test('apply mode writes versioning backfill pipelines', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const runtimeCollection = {
      countDocuments: jest.fn().mockResolvedValue(2),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
    }
    const frameworkPackageCollection = {
      db: { databaseName: 'vmf_test' },
      countDocuments: jest.fn().mockResolvedValue(1),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    }

    const result = await backfillRuntimeControlVersioningFields({
      apply: true,
      dependencies: {
        connect,
        disconnect,
        runtimeControlConfigs: [
          {
            collectionKey: 'RuntimePathRegistry',
            model: { collection: runtimeCollection },
            compatibilityMode: 'INHERITED_MINOR',
          },
        ],
        frameworkPackageModel: { collection: frameworkPackageCollection },
      },
    })

    expect(result.mode).toBe('apply')
    expect(result.runtimeControl[0].modified).toBe(2)
    expect(result.frameworkPackages.modified).toBe(1)
    expect(runtimeCollection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          { lineageId: '' },
          { lineageId: null },
          { lockedAt: { $exists: false } },
          expect.objectContaining({
            $and: expect.arrayContaining([
              { isLocked: true },
              expect.objectContaining({
                $or: expect.arrayContaining([
                  { lockedAt: null },
                  { lockedReason: null },
                  { lockedReason: '' },
                ]),
              }),
            ]),
          }),
        ]),
      }),
      expect.arrayContaining([
        expect.objectContaining({
          $set: expect.objectContaining({
            lineageId: expect.any(Object),
            lockedAt: expect.any(Object),
            lockedReason: expect.any(Object),
            compatibilityMode: expect.any(Object),
          }),
        }),
      ]),
    )
    expect(frameworkPackageCollection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          { lockedAt: { $exists: false } },
          { lockedReason: { $exists: false } },
        ]),
      }),
      expect.arrayContaining([
        expect.objectContaining({
          $set: expect.objectContaining({
            lockedAt: expect.any(Object),
            lockedReason: expect.any(Object),
          }),
        }),
      ]),
    )
  })

  test('apply mode locks UI Contracts referenced by governed framework packages', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const updatedAt = new Date('2026-05-03T12:00:00.000Z')
    const frameworkPackageCollection = {
      db: { databaseName: 'vmf_test' },
      countDocuments: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    }
    const frameworkPackageModel = {
      collection: frameworkPackageCollection,
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              packageKey: 'vmf-qa-manual-951',
              version: '9.5.1',
              uiContractKey: 'vmf-qa-ui-contract-0429-1752',
              status: 'ACTIVE',
              updatedAt,
            },
          ]),
        }),
      }),
    }
    const uiContractModel = {
      updateMany: jest.fn()
        .mockResolvedValueOnce({ modifiedCount: 1 })
        .mockResolvedValueOnce({ modifiedCount: 1 }),
    }
    const logs = []

    const result = await backfillRuntimeControlVersioningFields({
      apply: true,
      logger: (message) => logs.push(message),
      dependencies: {
        connect,
        disconnect,
        runtimeControlConfigs: [],
        frameworkPackageModel,
        uiContractModel,
      },
    })

    expect(result.uiContractPackageLocks).toEqual(expect.objectContaining({
      matched: 1,
      packageReferences: 1,
      modified: 2,
    }))
    expect(result.uiContractPackageLocks.locksToApply[0]).toEqual(expect.objectContaining({
      uiContractKey: 'vmf-qa-ui-contract-0429-1752',
      packageKeys: ['vmf-qa-manual-951'],
      packageVersions: ['9.5.1'],
    }))
    expect(result.uiContractPackageLocks.locksToApply[0].fieldsToApply).toEqual(expect.arrayContaining([
      'lockedByPackageKeys',
      'isLocked',
      'lockedAt',
      'lockedReason',
      'versionStatus',
    ]))
    expect(logs[0]).toContain('vmf-qa-ui-contract-0429-1752')
    expect(logs[0]).toContain('vmf-qa-manual-951')
    expect(uiContractModel.updateMany).toHaveBeenNthCalledWith(
      1,
      { uiContractKey: 'vmf-qa-ui-contract-0429-1752' },
      {
        $addToSet: {
          lockedByPackageKeys: { $each: ['vmf-qa-manual-951'] },
        },
      },
    )
    expect(uiContractModel.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        uiContractKey: 'vmf-qa-ui-contract-0429-1752',
        $or: [
          { isLocked: { $exists: false } },
          { isLocked: { $ne: true } },
        ],
      },
      {
        $set: expect.objectContaining({
          isLocked: true,
          lockedAt: updatedAt,
          versionStatus: 'ACTIVE',
        }),
      },
    )
  })

  test('dry-run reports Runtime Agent package lock plan and missing agent references', async () => {
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const updatedAt = new Date('2026-05-05T14:40:00.000Z')
    const frameworkPackageCollection = {
      db: { databaseName: 'vmf_test' },
      countDocuments: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    }
    const frameworkPackageModel = {
      collection: frameworkPackageCollection,
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              packageKey: 'vmf-qa-manual-951',
              version: '9.5.1',
              status: 'ACTIVE',
              updatedAt,
              dependencyLock: {
                references: [
                  { collectionKey: 'RuntimeAgent', id: 'agent-vmf-submit-validator-agent' },
                  { collectionKey: 'RuntimeAgent', id: 'agent-missing-runtime-agent' },
                  { collectionKey: 'RuntimeSkill', id: 'skill-submit-validator' },
                ],
              },
            },
          ]),
        }),
      }),
    }
    const runtimeAgentModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { stableId: 'agent-vmf-submit-validator-agent' },
          ]),
        }),
      }),
      updateMany: jest.fn(),
    }
    const runtimeSkillModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { stableId: 'skill-submit-validator' },
          ]),
        }),
      }),
      updateMany: jest.fn(),
    }
    const logs = []

    const result = await backfillRuntimeControlVersioningFields({
      json: true,
      logger: (message) => logs.push(message),
      dependencies: {
        connect,
        disconnect,
        runtimeControlConfigs: [],
        frameworkPackageModel,
        runtimeAgentModel,
        runtimeSkillModel,
      },
    })

    expect(result.runtimeAgentPackageLocks).toEqual(expect.objectContaining({
      matched: 2,
      packageReferences: 2,
      modified: 0,
      missingAgentIds: ['agent-missing-runtime-agent'],
    }))
    expect(result.runtimeAgentPackageLocks.locksToApply[0]).toEqual(expect.objectContaining({
      agentId: 'agent-vmf-submit-validator-agent',
      packageKeys: ['vmf-qa-manual-951'],
      packageVersions: ['9.5.1'],
      fieldsToApply: expect.arrayContaining([
        'lockedByPackageKeys',
        'isLocked',
        'lockedAt',
        'lockedReason',
        'versionStatus',
      ]),
    }))
    expect(logs[0]).toContain('"runtimeAgentPackageLocks"')
    expect(logs[0]).toContain('agent-missing-runtime-agent')
    expect(result.runtimeSkillPackageLocks).toEqual(expect.objectContaining({
      matched: 1,
      packageReferences: 1,
      modified: 0,
      missingSkillIds: [],
    }))
    expect(result.runtimeSkillPackageLocks.locksToApply[0]).toEqual(expect.objectContaining({
      skillId: 'skill-submit-validator',
      packageKeys: ['vmf-qa-manual-951'],
      packageVersions: ['9.5.1'],
      fieldsToApply: expect.arrayContaining([
        'lockedByPackageKeys',
        'isLocked',
        'lockedAt',
        'lockedReason',
        'versionStatus',
      ]),
    }))
    expect(logs[0]).toContain('"runtimeSkillPackageLocks"')
    expect(runtimeAgentModel.updateMany).not.toHaveBeenCalled()
    expect(runtimeSkillModel.updateMany).not.toHaveBeenCalled()
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
