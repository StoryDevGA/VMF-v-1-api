import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { LicenseLevel } from '../models/index.js'
import performanceCacheService from '../services/performanceCacheService.js'
import {
  resolveFrameworkPackageCustomerPresentation,
  serializeCustomerFrameworkPackage,
} from '../services/frameworkPackageAvailabilityService.js'

const CUSTOMER_ID = '607f1f77bcf86cd799439022'

const buildPackage = (overrides = {}) => ({
  _id: '927f1f77bcf86cd799439099',
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
  ...overrides,
})

const buildCustomer = (overrides = {}) => ({
  _id: CUSTOMER_ID,
  licenseLevelId: 'license-1',
  entitlements: [],
  ...overrides,
})

describe('framework package customer availability and presentation', () => {
  beforeEach(async () => {
    await performanceCacheService.resetForTests()
    LicenseLevel.findById = jest.fn(() => ({
      select: jest.fn().mockResolvedValue({
        _id: 'license-1',
        isActive: true,
        featureEntitlements: ['VMF'],
      }),
    }))
  })

  test('uses the existing VMF entitlement for a distinct Value Narrative package family', async () => {
    const presentation = await resolveFrameworkPackageCustomerPresentation({
      frameworkPackage: buildPackage(),
      customerId: CUSTOMER_ID,
      customer: buildCustomer(),
      runtimeType: 'VALUE_NARRATIVE',
    })

    expect(presentation).toEqual(expect.objectContaining({
      available: true,
      presentationMode: 'FULL',
      entitlementFeature: 'VMF',
      entitlementSource: 'LICENSE_LEVEL',
      licenseLevelId: 'license-1',
    }))
  })

  test('keeps package preview presentation bounded when the existing capability is not entitled', async () => {
    LicenseLevel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: 'license-1',
        isActive: true,
        featureEntitlements: ['DEALS'],
      }),
    })

    const presentation = await resolveFrameworkPackageCustomerPresentation({
      frameworkPackage: buildPackage(),
      customerId: CUSTOMER_ID,
      customer: buildCustomer(),
      runtimeType: 'VALUE_NARRATIVE',
    })

    expect(presentation).toEqual(expect.objectContaining({
      available: false,
      presentationMode: 'PREVIEW',
      availabilityReason: 'FEATURE_NOT_ENABLED',
      entitlementFeature: 'VMF',
      entitlementSource: 'LICENSE_LEVEL',
    }))
  })

  test('serializes package declaration and UI Contract association without adding licence fields to the package', () => {
    const row = serializeCustomerFrameworkPackage({
      frameworkPackage: buildPackage(),
      presentation: {
        available: true,
        presentationMode: 'FULL',
        entitlementFeature: 'VMF',
        entitlementSource: 'LICENSE_LEVEL',
      },
    })

    expect(row).toEqual(expect.objectContaining({
      id: '927f1f77bcf86cd799439099',
      frameworkKey: 'WEBSITE_ANALYSIS',
      uiContractKey: 'website-analysis-ui-v1',
      presentationMode: 'FULL',
      entitlementFeature: 'VMF',
    }))
    expect(row).not.toHaveProperty('websiteAnalysisLicenceKey')
  })
})
