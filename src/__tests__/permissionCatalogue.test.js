import { describe, expect, test } from '@jest/globals'
import {
  ALL_PERMISSION_KEYS,
  getPermissionsForScope,
  PERMISSION_CATALOGUE,
  SUPER_ADMIN_LOCKED_PERMISSION_KEYS,
} from '../constants/permissionCatalogue.js'

describe('permissionCatalogue', () => {
  test('exports grouped permission metadata with unique keys', () => {
    expect(PERMISSION_CATALOGUE).toHaveLength(7)
    expect(ALL_PERMISSION_KEYS).toHaveLength(25)
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length)
    expect(PERMISSION_CATALOGUE[0]).toEqual(expect.objectContaining({
      groupKey: 'PLATFORM_MANAGEMENT',
      groupLabel: 'Platform Management',
    }))
  })

  test('returns the current platform-scoped system role defaults', () => {
    expect(getPermissionsForScope('PLATFORM')).toEqual([
      'PLATFORM_MANAGE',
      'CUSTOMER_CREATE',
      'CUSTOMER_UPDATE',
      'CUSTOMER_DELETE',
      'CUSTOMER_VIEW',
      'ROLE_MANAGE',
      'AUDIT_VIEW_ALL',
      'SYSTEM_HEALTH_VIEW',
    ])
    expect(SUPER_ADMIN_LOCKED_PERMISSION_KEYS).toEqual(getPermissionsForScope('PLATFORM'))
  })

  test('returns the current customer, tenant, and vmf-scoped defaults', () => {
    expect(getPermissionsForScope('customer')).toEqual([
      'CUSTOMER_VIEW',
      'USER_CREATE',
      'USER_UPDATE',
      'USER_DELETE',
      'USER_VIEW',
      'TENANT_CREATE',
      'TENANT_UPDATE',
      'TENANT_DELETE',
      'TENANT_VIEW',
      'VMF_CREATE',
      'VMF_UPDATE',
      'VMF_VIEW',
      'AUDIT_VIEW_CUSTOMER',
    ])

    expect(getPermissionsForScope('TENANT')).toEqual([
      'TENANT_VIEW',
      'USER_VIEW_TENANT',
      'VMF_CREATE',
      'VMF_UPDATE',
      'VMF_VIEW',
      'DEAL_CREATE',
      'DEAL_UPDATE',
      'DEAL_DELETE',
      'DEAL_VIEW',
    ])

    expect(getPermissionsForScope('VMF')).toEqual([
      'VMF_VIEW',
      'DEAL_CREATE',
      'DEAL_UPDATE',
      'DEAL_VIEW',
    ])
  })

  test('returns an empty array for unknown scopes', () => {
    expect(getPermissionsForScope('')).toEqual([])
    expect(getPermissionsForScope('UNKNOWN_SCOPE')).toEqual([])
  })
})
