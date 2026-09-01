import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { Customer, User } from '../models/index.js'
import LicenseLevel from '../models/LicenseLevel.js'
import WorkflowPolicy from '../models/WorkflowPolicy.js'
import { generateChecksum } from '../services/governanceAudit/checksumService.js'
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
  assertPackageWorkflowPolicyDependencyReferences,
  buildControlRecordPayload,
  buildPackageReplacementPayload,
  buildReplacementDependencyLock,
  cloneBundleWithMappedKeys,
  withRequiredActorFields,
} from '../scripts/replaceActiveFrameworkPackageFromSeed.js'
import {
  buildReleaseMetadataRepairPlan,
} from '../scripts/repairActiveFrameworkPackageReleaseMetadata.js'
import {
  buildSectionGenerationActionRepairPlan,
} from '../scripts/repairActiveFrameworkPackageSectionGenerationActions.js'

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
        dependencyLock: {
          snapshotId: 'seed-lock-standard-package-vmf-3-1-1-rkm',
          status: 'PASS',
          packageKey: 'standard-package-vmf-3-1-1-rkm',
          packageVersion: '3.1.1',
          references: [{
            collectionKey: 'WorkflowPolicy',
            id: 'policy-truth-generation-policy',
            key: 'truth-generation-policy',
            status: 'ACTIVE',
            versionStatus: 'ACTIVE',
            componentVersion: 1,
            lineageId: 'policy-truth-generation-policy',
          }],
        },
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
        status: 'ACTIVE',
        versionStatus: 'ACTIVE',
        componentVersion: 1,
        lineageId: 'policy-truth-generation-policy',
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

  const makeApplyHarness = ({
    packageOverrides = {},
    duplicatePackage = null,
    runtimePathSaveError = null,
  } = {}) => {
    const packageDoc = makePersistedDoc({
      frameworkKey: 'VMF',
      packageKey: 'standard-package-vmf-3-1-1-rkm',
      version: '3.1.1',
      status: 'ACTIVE',
      isDefault: false,
      isLocked: true,
      stableId: 'package-existing',
      ...packageOverrides,
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
    if (runtimePathSaveError) {
      runtimePathDoc.save.mockRejectedValueOnce(runtimePathSaveError)
    }

    const models = {
      FrameworkPackage: makeModel({
        findOne: (query) => (query?.packageKey?.$ne ? duplicatePackage : packageDoc),
      }),
      RuntimePathRegistry: makeModel({
        keyField: 'pathKey',
        docs: [runtimePathDoc],
      }),
      WorkflowPolicy: makeModel({
        keyField: 'key',
        docs: [workflowPolicyDoc],
      }),
      UIContract: makeModel({
        keyField: 'uiContractKey',
        docs: [uiContractDoc],
      }),
    }

    return {
      docs: {
        packageDoc,
        uiContractDoc,
        runtimePathDoc,
        workflowPolicyDoc,
      },
      models,
    }
  }

  const expectNoReplacementWrites = ({ docs, models }) => {
    expect(docs.runtimePathDoc.save).not.toHaveBeenCalled()
    expect(docs.workflowPolicyDoc.save).not.toHaveBeenCalled()
    expect(docs.uiContractDoc.save).not.toHaveBeenCalled()
    expect(docs.packageDoc.save).not.toHaveBeenCalled()
    expect(models.RuntimePathRegistry.createdDocs).toHaveLength(0)
    expect(models.WorkflowPolicy.createdDocs).toHaveLength(0)
    expect(models.UIContract.createdDocs).toHaveLength(0)
    expect(models.FrameworkPackage.createdDocs).toHaveLength(0)
  }

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

  test('builds package payloads that preserve active identity while adopting the amended seed lock', () => {
    const payload = buildPackageReplacementPayload({
      seedPackage: {
        frameworkKey: 'VMF',
        packageKey: 'standard-package-vmf-3-1-1-rkm',
        version: '3.1.1',
        status: 'DRAFT',
        versionStatus: 'DRAFT',
        isDefault: false,
        isLocked: false,
        uiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
        uiContractBinding: {
          key: 'standard-ui-contract-vmf-3-1-1-rkm',
          version: '3.1.1',
          status: 'DRAFT',
        },
        workflowBindings: [{ policyKey: 'truth-generation-policy' }],
        dependencyLock: {
          snapshotId: 'seed-lock-standard-package-vmf-3-1-1-rkm',
          snapshotHash: 'stale-seed-hash',
          status: 'PASS',
          packageKey: 'standard-package-vmf-3-1-1-rkm',
          packageVersion: '3.1.1',
          references: [{
            collectionKey: 'WorkflowPolicy',
            id: 'policy-truth-generation-policy',
            key: 'truth-generation-policy',
            status: 'ACTIVE',
            versionStatus: 'ACTIVE',
            componentVersion: 1,
            lineageId: 'policy-truth-generation-policy',
          }],
        },
      },
      existingPackage: {
        frameworkKey: 'VMF',
        packageKey: 'standard-package-vmf-3-1-1-rkm',
        version: '3.1.1',
        status: 'ACTIVE',
        versionStatus: 'ACTIVE',
        isDefault: true,
        isLocked: true,
        dependencyLock: {
          snapshotId: 'dep-lock-standard-package-vmf-3-1-1-rkm-3-1-1-20260701124144',
          snapshotHash: '621c63f74b2ff7a53a3a19e727fd45c6f88a885f126fa3e0e7ddbd21a8d417c5',
          status: 'PASS',
          packageKey: 'standard-package-vmf-3-1-1-rkm',
          packageVersion: '3.1.1',
          references: [{ key: 'active-reference' }],
        },
        uiContractBinding: {
          key: 'standard-ui-contract-vmf-3-1-1-rkm',
          version: '3.1.1',
          status: 'ACTIVE',
          compatibilityMode: 'INHERITED_MINOR',
          resolvedAt: new Date('2026-07-01T12:43:53.000Z'),
        },
      },
      workflowPolicies: [{
        key: 'truth-generation-policy',
        stableId: 'policy-truth-generation-policy',
        name: 'Truth Generation Policy',
        status: 'ACTIVE',
        versionStatus: 'ACTIVE',
        componentVersion: 1,
        lineageId: 'policy-truth-generation-policy',
      }],
    })

    expect(payload.packageKey).toBe('standard-package-vmf-3-1-1-rkm')
    expect(payload.version).toBe('3.1.1')
    expect(payload.status).toBe('ACTIVE')
    expect(payload.versionStatus).toBe('ACTIVE')
    expect(payload.isDefault).toBe(true)
    expect(payload.isLocked).toBe(true)
    expect(payload.uiContractBinding).toEqual({
      key: 'standard-ui-contract-vmf-3-1-1-rkm',
      version: '3.1.1',
      status: 'ACTIVE',
      compatibilityMode: 'INHERITED_MINOR',
      resolvedAt: new Date('2026-07-01T12:43:53.000Z'),
    })
    expect(payload.workflowBindings).toEqual([{ policyKey: 'truth-generation-policy' }])
    expect(payload.dependencyLock).toEqual(expect.objectContaining({
      snapshotId: 'seed-lock-standard-package-vmf-3-1-1-rkm',
      status: 'PASS',
      packageKey: 'standard-package-vmf-3-1-1-rkm',
      packageVersion: '3.1.1',
      references: [{
        collectionKey: 'WorkflowPolicy',
        id: 'policy-truth-generation-policy',
        key: 'truth-generation-policy',
        name: 'Truth Generation Policy',
        status: 'ACTIVE',
        versionStatus: 'ACTIVE',
        componentVersion: 1,
        lineageId: 'policy-truth-generation-policy',
      }],
    }))
    expect(payload.dependencyLock.snapshotHash).toMatch(/^[a-f0-9]{64}$/)
    expect(payload.dependencyLock.snapshotHash).toBe(generateChecksum({
      status: payload.dependencyLock.status,
      resolvedAt: payload.dependencyLock.resolvedAt,
      resolvedBy: payload.dependencyLock.resolvedBy,
      packageKey: payload.dependencyLock.packageKey,
      packageVersion: payload.dependencyLock.packageVersion,
      references: payload.dependencyLock.references,
    }))
    expect(payload.dependencyLock.references).not.toEqual([{ key: 'active-reference' }])
  })

  test('normalizes missing Workflow Policy lock metadata without mutating the seed package', () => {
    const seedPackage = {
      packageKey: 'standard-package-value-mapping-framework-3-1-2-runtime-knowledge-model',
      version: '3.1.2',
      workflowBindings: [{ policyKey: 'generate-section-gate-v3-1-2' }],
      dependencyLock: {
        snapshotId: '',
        resolvedAt: '2026-08-21T00:00:00.000Z',
        status: 'PASS',
        packageKey: 'standard-package-value-mapping-framework-3-1-2-runtime-knowledge-model',
        packageVersion: '3.1.2',
        references: [{
          collectionKey: 'WorkflowPolicy',
          id: 'policy-generate-section-gate-v3-1-2',
          key: 'generate-section-gate-v3-1-2',
          status: 'DRAFT',
          versionStatus: 'DRAFT',
          componentVersion: 2,
          lineageId: 'policy-wrong-lineage',
        }],
      },
    }
    const before = JSON.stringify(seedPackage)
    const lock = buildReplacementDependencyLock({
      seedPackage,
      workflowPolicies: [{
        key: 'generate-section-gate-v3-1-2',
        stableId: 'policy-generate-section-gate-v3-1-2',
        status: 'ACTIVE',
        versionStatus: 'ACTIVE',
        componentVersion: 1,
        lineageId: 'policy-generate-section-gate',
      }],
    })

    expect(lock.references[0]).toEqual(expect.objectContaining({
      versionStatus: 'ACTIVE',
      componentVersion: 1,
      lineageId: 'policy-generate-section-gate',
    }))
    expect(lock.snapshotId).toBe(
      'dep-lock-standard-package-value-mapping-framework-3-1-2-runtime-knowledge-model-3-1-2-20260821000000',
    )
    expect(JSON.stringify(seedPackage)).toBe(before)
  })

  test.each([
    ['missing', [], /found 0/],
    ['duplicate', [
      {
        collectionKey: 'WorkflowPolicy',
        id: 'policy-generate-section-gate-v3-1-2',
        key: 'generate-section-gate-v3-1-2',
        status: 'ACTIVE',
        versionStatus: 'ACTIVE',
        componentVersion: 1,
        lineageId: 'policy-generate-section-gate',
      },
      {
        collectionKey: 'WorkflowPolicy',
        id: 'policy-generate-section-gate-v3-1-2',
        key: 'generate-section-gate-v3-1-2',
        status: 'ACTIVE',
        versionStatus: 'ACTIVE',
        componentVersion: 1,
        lineageId: 'policy-generate-section-gate',
      },
    ], /found 2/],
    ['mismatched stable id', [{
      collectionKey: 'WorkflowPolicy',
      id: 'policy-stale',
      key: 'generate-section-gate-v3-1-2',
      status: 'ACTIVE',
      versionStatus: 'ACTIVE',
      componentVersion: 1,
      lineageId: 'policy-stale',
    }], /does not match/],
  ])('fails closed for %s package-bound Workflow Policy lock reference', (_label, references, expectedError) => {
    expect(() => assertPackageWorkflowPolicyDependencyReferences({
      packageRecord: {
        workflowBindings: [{ policyKey: 'generate-section-gate-v3-1-2' }],
      },
      workflowPolicies: [{
        key: 'generate-section-gate-v3-1-2',
        stableId: 'policy-generate-section-gate-v3-1-2',
      }],
      references,
    })).toThrow(expectedError)
  })

  test('fails closed when a package-bound Workflow Policy is absent from the seed records', () => {
    expect(() => assertPackageWorkflowPolicyDependencyReferences({
      packageRecord: {
        workflowBindings: [{ policyKey: 'generate-section-gate-v3-1-2' }],
      },
      workflowPolicies: [],
      references: [{
        collectionKey: 'WorkflowPolicy',
        id: 'policy-generate-section-gate-v3-1-2',
        key: 'generate-section-gate-v3-1-2',
        status: 'ACTIVE',
        versionStatus: 'ACTIVE',
        componentVersion: 1,
        lineageId: 'policy-generate-section-gate',
      }],
    })).toThrow(/no matching seeded Workflow Policy record/)
  })

  test.each([
    ['status', { status: 'DRAFT' }],
    ['version status', { versionStatus: 'DRAFT' }],
    ['component version', { componentVersion: 2 }],
    ['lineage', { lineageId: 'policy-wrong-lineage' }],
  ])('fails closed when Workflow Policy lock %s does not match the source policy', (_label, override) => {
    expect(() => assertPackageWorkflowPolicyDependencyReferences({
      packageRecord: {
        workflowBindings: [{ policyKey: 'generate-section-gate-v3-1-2' }],
      },
      workflowPolicies: [{
        key: 'generate-section-gate-v3-1-2',
        stableId: 'policy-generate-section-gate-v3-1-2',
        status: 'ACTIVE',
        versionStatus: 'ACTIVE',
        componentVersion: 1,
        lineageId: 'policy-generate-section-gate',
      }],
      references: [{
        collectionKey: 'WorkflowPolicy',
        id: 'policy-generate-section-gate-v3-1-2',
        key: 'generate-section-gate-v3-1-2',
        status: 'ACTIVE',
        versionStatus: 'ACTIVE',
        componentVersion: 1,
        lineageId: 'policy-generate-section-gate',
        ...override,
      }],
    })).toThrow(/incomplete active component metadata/)
  })

  test('fails closed when dependency-lock identity does not match the target package', () => {
    expect(() => buildReplacementDependencyLock({
      seedPackage: {
        packageKey: 'source-package',
        version: '3.1.2',
        workflowBindings: [],
        dependencyLock: {
          snapshotId: 'seed-lock',
          status: 'PASS',
          packageKey: 'source-package',
          packageVersion: '3.1.2',
          references: [],
        },
      },
      expectedPackageKey: 'target-package',
      expectedPackageVersion: '3.1.2',
    })).toThrow(/identity does not match/)
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

  test.each([false, true])(
    'applies replacement through hydrated document saves and preserves isDefault=%s',
    async (isDefault) => {
    const session = {}
    const { docs, models } = makeApplyHarness({
      packageOverrides: { isDefault },
    })

    await applyReplacementPlan({
      plan: makeReplacementPlan(),
      models,
      session,
      targetPackageKey: 'standard-package-vmf-3-1-1-rkm',
    })

    expect(docs.runtimePathDoc.save).toHaveBeenCalledWith({ session })
    expect(docs.workflowPolicyDoc.save).toHaveBeenCalledWith({ session })
    expect(docs.uiContractDoc.save).toHaveBeenCalledWith({ session })
    expect(docs.packageDoc.save).toHaveBeenCalledWith({ session })
    expect(docs.packageDoc.set.mock.calls[0][0].isDefault).toBe(isDefault)
    expect(docs.runtimePathDoc.set.mock.calls[0][0]).not.toHaveProperty('stableId')
    expect(String(docs.runtimePathDoc.set.mock.calls[0][0].createdBy)).toBe('000000000000000000000001')
    expect(String(docs.runtimePathDoc.set.mock.calls[0][0].updatedBy)).toBe('000000000000000000000001')
    expect(docs.runtimePathDoc.$locals.allowLockedRuntimeControlWrite).toBe(true)
    expect(docs.runtimePathDoc.stableId).toBe('path-existing-runtime-truth-projection')
    expect(models.RuntimePathRegistry.updateOne).not.toHaveBeenCalled()
    expect(models.WorkflowPolicy.updateOne).not.toHaveBeenCalled()
    expect(models.UIContract.updateOne).not.toHaveBeenCalled()
    expect(models.FrameworkPackage.updateOne).not.toHaveBeenCalled()
  })

  test.each([
    ['unlocked target', { isLocked: false }, /must remain locked during governed in-place replacement/],
    ['inactive target', { status: 'DEPRECATED' }, /must still be ACTIVE during apply/],
    ['version mismatch', { version: '3.1.0' }, /does not match active package version 3.1.0 during apply/],
    ['framework mismatch', { frameworkKey: 'DEAL' }, /does not match active package framework DEAL during apply/],
  ])('rejects %s before any replacement writes', async (_label, packageOverrides, expectedError) => {
    const harness = makeApplyHarness({ packageOverrides })

    await expect(applyReplacementPlan({
      plan: makeReplacementPlan(),
      models: harness.models,
      session: {},
      targetPackageKey: 'standard-package-vmf-3-1-1-rkm',
    })).rejects.toThrow(expectedError)

    expectNoReplacementWrites(harness)
  })

  test('rejects a duplicate framework version before any replacement writes', async () => {
    const harness = makeApplyHarness({
      duplicatePackage: {
        frameworkKey: 'VMF',
        version: '3.1.1',
        packageKey: 'duplicate-vmf-3-1-1',
      },
    })

    await expect(applyReplacementPlan({
      plan: makeReplacementPlan(),
      models: harness.models,
      session: {},
      targetPackageKey: 'standard-package-vmf-3-1-1-rkm',
    })).rejects.toThrow(/A second VMF \/ 3.1.1 package exists during apply: duplicate-vmf-3-1-1/)

    expectNoReplacementWrites(harness)
  })

  test('propagates a first control-record save failure without later writes', async () => {
    const persistenceError = new Error('runtime path save failed')
    const harness = makeApplyHarness({ runtimePathSaveError: persistenceError })

    await expect(applyReplacementPlan({
      plan: makeReplacementPlan(),
      models: harness.models,
      session: {},
      targetPackageKey: 'standard-package-vmf-3-1-1-rkm',
    })).rejects.toBe(persistenceError)

    expect(harness.docs.runtimePathDoc.save).toHaveBeenCalledTimes(1)
    expect(harness.docs.workflowPolicyDoc.save).not.toHaveBeenCalled()
    expect(harness.docs.uiContractDoc.save).not.toHaveBeenCalled()
    expect(harness.docs.packageDoc.save).not.toHaveBeenCalled()
    expect(harness.models.RuntimePathRegistry.createdDocs).toHaveLength(0)
    expect(harness.models.WorkflowPolicy.createdDocs).toHaveLength(0)
    expect(harness.models.UIContract.createdDocs).toHaveLength(0)
    expect(harness.models.FrameworkPackage.createdDocs).toHaveLength(0)
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

describe('repairActiveFrameworkPackageReleaseMetadata helpers', () => {
  const makeRepairInput = (overrides = {}) => ({
    frameworkPackage: {
      _id: '6a45094226228691cfc173ca',
      frameworkKey: 'VMF',
      packageKey: 'standard-package-vmf-3-1-1-rkm',
      version: '3.1.1',
      status: 'ACTIVE',
      versionStatus: 'DRAFT',
      isLocked: true,
      lockedAt: new Date('2026-07-01T12:41:44.390Z'),
      lockedBy: '698b3800f83b3257365fd7a3',
      uiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
      uiContractBinding: {
        key: 'standard-ui-contract-vmf-3-1-1-rkm',
        version: '3.1.1',
        status: 'DRAFT',
        compatibilityMode: 'INHERITED_MINOR',
        resolvedAt: new Date('2026-06-29T12:00:00.000Z'),
      },
      dependencyLock: {
        snapshotId: '',
        snapshotHash: '',
        status: 'PASS',
        packageKey: 'standard-package-vmf-3-1-rkm',
        packageVersion: '3.1',
        references: [{ key: 'truth-generation-policy' }],
      },
    },
    deployment: {
      deploymentId: 'deployment-vmf-global-production--20260701124353-cfc173ca',
      activationId: 'activation-vmf-3-1-1-20260701124353-cfc173ca',
      status: 'ACTIVE',
    },
    activationSnapshot: {
      activationId: 'activation-vmf-3-1-1-20260701124353-cfc173ca',
      activationStatus: 'ACTIVE',
      dependencySnapshotId: 'dep-lock-standard-package-vmf-3-1-1-rkm-3-1-1-20260701124144',
      dependencySnapshotHash: '621c63f74b2ff7a53a3a19e727fd45c6f88a885f126fa3e0e7ddbd21a8d417c5',
      activatedAt: new Date('2026-07-01T12:43:55.327Z'),
    },
    ...overrides,
  })

  test('repairs active package metadata from the active activation snapshot', () => {
    const plan = buildReleaseMetadataRepairPlan(makeRepairInput())

    expect(plan.before.versionStatus).toBe('DRAFT')
    expect(plan.before.dependencyLock.snapshotId).toBe('')
    expect(plan.before.dependencyLock.packageKey).toBe('standard-package-vmf-3-1-rkm')
    expect(plan.before.uiContractBinding.status).toBe('DRAFT')
    expect(plan.after.versionStatus).toBe('ACTIVE')
    expect(plan.after.dependencyLock).toEqual({
      snapshotId: 'dep-lock-standard-package-vmf-3-1-1-rkm-3-1-1-20260701124144',
      snapshotHash: '621c63f74b2ff7a53a3a19e727fd45c6f88a885f126fa3e0e7ddbd21a8d417c5',
      status: 'PASS',
      packageKey: 'standard-package-vmf-3-1-1-rkm',
      packageVersion: '3.1.1',
      references: 1,
    })
    expect(plan.after.uiContractBinding).toEqual({
      key: 'standard-ui-contract-vmf-3-1-1-rkm',
      version: '3.1.1',
      status: 'ACTIVE',
    })
    expect(plan.update.dependencyLock.references).toEqual([{ key: 'truth-generation-policy' }])
  })

  test('fails closed when activation snapshot dependency evidence is missing', () => {
    expect(() => buildReleaseMetadataRepairPlan(makeRepairInput({
      activationSnapshot: {
        activationId: 'activation-vmf-3-1-1-20260701124353-cfc173ca',
        activationStatus: 'ACTIVE',
        dependencySnapshotId: '',
        dependencySnapshotHash: '',
      },
    }))).toThrow(/missing dependency snapshot evidence/)
  })
})

describe('repairActiveFrameworkPackageSectionGenerationActions helpers', () => {
  const makeSectionActionRepairInput = (overrides = {}) => ({
    frameworkPackage: {
      packageKey: 'standard-package-vmf-3-1-1-rkm',
      status: 'ACTIVE',
      workflowBindings: [
        { policyKey: 'truth-generation-policy', executionContext: 'ON_GENERATE_TRUTH' },
      ],
    },
    uiContract: {
      uiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
      status: 'ACTIVE',
      actions: [
        { actionKey: 'GENERATE_TRUTH', governedAction: 'GENERATE_TRUTH' },
      ],
    },
    policies: [
      { key: 'truth-generation-policy', governedAction: 'GENERATE_TRUTH' },
    ],
    ...overrides,
  })

  test('plans missing Runtime Workspace action bridge UI actions, policies, and bindings', () => {
    const plan = buildSectionGenerationActionRepairPlan(makeSectionActionRepairInput())

    expect(plan.missing).toEqual({
      actions: ['GENERATE_SECTION', 'REGENERATE_SECTION', 'MARK_READY', 'APPROVE', 'LOCK_RECORD'],
      bindings: [
        'generate-section-gate:ON_SECTION_GENERATE',
        'regenerate-section-gate:ON_SECTION_REGENERATE',
        'mark-ready-policy:ON_MARK_READY',
        'lifecycle-approval-policy:ON_APPROVE',
        'lock-record-policy:ON_LOCK',
      ],
      policies: [
        'generate-section-gate',
        'regenerate-section-gate',
        'mark-ready-policy',
        'lifecycle-approval-policy',
        'lock-record-policy',
      ],
    })
    expect(plan.updates.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionKey: 'GENERATE_SECTION',
        governedAction: 'GENERATE_SECTION',
        presentationKey: 'section-action',
      }),
      expect.objectContaining({
        actionKey: 'REGENERATE_SECTION',
        governedAction: 'REGENERATE_SECTION',
        presentationKey: 'section-action',
      }),
      expect.objectContaining({
        actionKey: 'MARK_READY',
        governedAction: 'MARK_READY',
        presentationKey: 'primary-action',
      }),
      expect.objectContaining({
        actionKey: 'APPROVE',
        governedAction: 'APPROVE',
        presentationKey: 'primary-action',
      }),
      expect.objectContaining({
        actionKey: 'LOCK_RECORD',
        governedAction: 'LOCK_RECORD',
        presentationKey: 'primary-action',
      }),
    ]))
    expect(plan.updates.policies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'lifecycle-approval-policy',
        governedAction: 'APPROVE',
        triggerEvent: 'ON_APPROVE',
        decisionMode: 'REQUIRE_AGENT_AND_SKILL_EXECUTION',
        executionType: 'ORDERED_WORKFLOW',
        requiredAgentIds: ['agent-validation-agent'],
        requiredSkillIds: ['skill-truth-integrity-validator', 'skill-decision-readiness-validator'],
      }),
    ]))
    expect(plan.updates.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        policyKey: 'lifecycle-approval-policy',
        executionContext: 'ON_APPROVE',
      }),
    ]))
  })

  test('builds a schema-valid approval policy when APPROVE governance is missing', () => {
    const plan = buildSectionGenerationActionRepairPlan(makeSectionActionRepairInput())
    const approvalPolicy = plan.updates.policies.find((policy) => policy.key === 'lifecycle-approval-policy')

    expect(approvalPolicy).toEqual(expect.objectContaining({
      governedAction: 'APPROVE',
      triggerEvent: 'ON_APPROVE',
      decisionMode: 'REQUIRE_AGENT_AND_SKILL_EXECUTION',
      executionType: 'ORDERED_WORKFLOW',
    }))
    const validationError = new WorkflowPolicy(approvalPolicy).validateSync()

    expect(validationError).toBeUndefined()
  })

  test('is idempotent when Runtime Workspace action bridge already exists', () => {
    const plan = buildSectionGenerationActionRepairPlan(makeSectionActionRepairInput({
      frameworkPackage: {
        packageKey: 'standard-package-vmf-3-1-1-rkm',
        status: 'ACTIVE',
        workflowBindings: [
          { policyKey: 'truth-generation-policy', executionContext: 'ON_GENERATE_TRUTH' },
          { policyKey: 'generate-section-gate', executionContext: 'ON_SECTION_GENERATE' },
          { policyKey: 'regenerate-section-gate', executionContext: 'ON_SECTION_REGENERATE' },
          { policyKey: 'mark-ready-policy', executionContext: 'ON_MARK_READY' },
          { policyKey: 'lifecycle-approval-policy', executionContext: 'ON_APPROVE' },
          { policyKey: 'lock-record-policy', executionContext: 'ON_LOCK' },
        ],
      },
      uiContract: {
        uiContractKey: 'standard-ui-contract-vmf-3-1-1-rkm',
        status: 'ACTIVE',
        actions: [
          { actionKey: 'GENERATE_TRUTH', governedAction: 'GENERATE_TRUTH' },
          { actionKey: 'GENERATE_SECTION', governedAction: 'GENERATE_SECTION' },
          { actionKey: 'REGENERATE_SECTION', governedAction: 'REGENERATE_SECTION' },
          { actionKey: 'MARK_READY', governedAction: 'MARK_READY' },
          { actionKey: 'APPROVE', governedAction: 'APPROVE' },
          { actionKey: 'LOCK_RECORD', governedAction: 'LOCK_RECORD' },
        ],
      },
      policies: [
        { key: 'truth-generation-policy', governedAction: 'GENERATE_TRUTH' },
        { key: 'generate-section-gate', governedAction: 'GENERATE_SECTION' },
        { key: 'regenerate-section-gate', governedAction: 'REGENERATE_SECTION' },
        { key: 'mark-ready-policy', governedAction: 'MARK_READY' },
        { key: 'lifecycle-approval-policy', governedAction: 'APPROVE' },
        { key: 'lock-record-policy', governedAction: 'LOCK_RECORD' },
      ],
    }))

    expect(plan.missing).toEqual({
      actions: [],
      bindings: [],
      policies: [],
    })
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
