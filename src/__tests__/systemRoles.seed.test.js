import { describe, expect, test } from '@jest/globals'
import { getPermissionsForScope } from '../constants/permissionCatalogue.js'
import { systemRoles } from '../seeds/systemRoles.js'

describe('systemRoles seed defaults', () => {
  test('derive each seeded system role permission set from the catalogue scope helper', () => {
    expect(systemRoles).toEqual([
      expect.objectContaining({
        key: 'SUPER_ADMIN',
        scope: 'PLATFORM',
        permissions: getPermissionsForScope('PLATFORM'),
      }),
      expect.objectContaining({
        key: 'CUSTOMER_ADMIN',
        scope: 'CUSTOMER',
        permissions: getPermissionsForScope('CUSTOMER'),
      }),
      expect.objectContaining({
        key: 'TENANT_ADMIN',
        scope: 'TENANT',
        permissions: getPermissionsForScope('TENANT'),
      }),
      expect.objectContaining({
        key: 'USER',
        scope: 'VMF',
        permissions: getPermissionsForScope('VMF'),
      }),
    ])
  })
})
