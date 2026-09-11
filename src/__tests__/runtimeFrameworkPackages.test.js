import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import {
  Customer,
  FrameworkPackage,
  LicenseLevel,
  RuntimeActivationSnapshot,
  RuntimeDeployment,
  Tenant,
} from '../models/index.js'
import performanceCacheService from '../services/performanceCacheService.js'
import { listAvailableFrameworkPackages } from '../services/runtimeInstanceService.js'

const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'
const PACKAGE_ID = '927f1f77bcf86cd799439099'

const packageRow = {
  _id: PACKAGE_ID,
  packageKey: 'website-analysis-1-0-0',
  packageName: 'Website Analysis',
  frameworkKey: 'WEBSITE_ANALYSIS',
  frameworkName: 'Website Analysis',
  version: '1.0.0',
  status: 'ACTIVE',
  isDefault: false,
  visibility: 'CUSTOMER_VISIBLE',
  customerAccessMode: 'ALL_CUSTOMERS',
  assignedCustomerIds: [],
  uiContractKey: 'website-analysis-ui-v1',
  sections: [{
    sectionKey: 'website_url',
    runtimePath: 'framework_state.sections.website_url',
    required: true,
  }],
  capabilities: { supportsPreviewMode: true, supportsFullReport: false },
  dependencyLock: {
    status: 'PASS',
    snapshotId: 'website-snapshot-1',
    snapshotHash: 'website-hash-1',
    references: [{ collectionKey: 'UIContract', key: 'website-analysis-ui-v1' }],
  },
}

const buildScopes = () => ({
  resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'], permissions: [] } },
})

const buildCustomer = () => ({
  _id: CUSTOMER_ID,
  licenseLevelId: 'license-1',
  entitlements: [],
  topology: 'MULTI_TENANT',
})

describe('generic customer Framework Package catalogue', () => {
  beforeEach(async () => {
    await performanceCacheService.resetForTests()
    Customer.findById = jest.fn().mockResolvedValue(buildCustomer())
    Tenant.findById = jest.fn().mockResolvedValue({
      _id: TENANT_ID,
      customerId: CUSTOMER_ID,
      status: 'ENABLED',
    })
    FrameworkPackage.find = jest.fn(() => ({
      sort: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([packageRow]) })),
    }))
    RuntimeDeployment.find = jest.fn(() => ({
      lean: jest.fn().mockResolvedValue([{
        packageId: PACKAGE_ID,
        frameworkKey: 'WEBSITE_ANALYSIS',
        status: 'ACTIVE',
        activationId: 'activation-website-1',
      }]),
    }))
    RuntimeActivationSnapshot.find = jest.fn(() => ({
      lean: jest.fn().mockResolvedValue([{
        packageId: PACKAGE_ID,
        activationId: 'activation-website-1',
        activationStatus: 'ACTIVE',
        dependencySnapshotId: 'website-snapshot-1',
        dependencySnapshotHash: 'website-hash-1',
      }]),
    }))
    LicenseLevel.findById = jest.fn(() => ({
      select: jest.fn().mockResolvedValue({
        _id: 'license-1',
        isActive: true,
        featureEntitlements: ['VMF'],
      }),
    }))
  })

  test('resolves a distinct package through the same catalogue and entitlement path as VMF', async () => {
    const result = await listAvailableFrameworkPackages({
      scopes: buildScopes(),
      query: {
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkKey: 'WEBSITE_ANALYSIS',
        runtimeType: 'VALUE_NARRATIVE',
      },
    })

    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toEqual(expect.objectContaining({
      frameworkKey: 'WEBSITE_ANALYSIS',
      uiContractKey: 'website-analysis-ui-v1',
      available: true,
      presentationMode: 'FULL',
      entitlementFeature: 'VMF',
      entitlementSource: 'LICENSE_LEVEL',
    }))
    expect(result.data[0].sections).toEqual([
      expect.objectContaining({
        sectionKey: 'website_url',
        runtimePath: 'framework_state.sections.website_url',
      }),
    ])
  })

  test('returns preview presentation without inventing a Website-specific licence key', async () => {
    LicenseLevel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: 'license-1',
        isActive: true,
        featureEntitlements: ['DEALS'],
      }),
    })

    const result = await listAvailableFrameworkPackages({
      scopes: buildScopes(),
      query: {
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkKey: 'WEBSITE_ANALYSIS',
        runtimeType: 'VALUE_NARRATIVE',
      },
    })

    expect(result.data[0]).toEqual(expect.objectContaining({
      available: false,
      presentationMode: 'PREVIEW',
      entitlementFeature: 'VMF',
    }))
    expect(result.data[0]).not.toHaveProperty('websiteAnalysisLicenceKey')
  })
})
