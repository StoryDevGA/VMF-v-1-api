import { buildRuntimeStateRequestScopes } from '../controllers/runtimeInstance.controller.js'

describe('Runtime State V2 request scope adapter', () => {
  test('preserves the authenticated snapshot and replaces only selected scope objects', () => {
    const scopes = {
      user: { _id: 'user-1' },
      resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'] } },
      memberships: [{ customerId: 'customer-membership' }],
      tenantMemberships: [{ tenantId: 'tenant-membership' }],
      platformRoles: ['SUPER_ADMIN'],
      vmfGrants: [{ vmfId: 'vmf-1' }],
      customerIds: ['customer-membership'],
      customer: { _id: 'old-customer', permissions: ['VMF_VIEW'] },
      tenant: { _id: 'old-tenant', customerId: 'old-customer', permissions: ['VMF_VIEW'] },
    }

    const result = buildRuntimeStateRequestScopes({
      scopes,
      query: {
        customerId: '507f1f77bcf86cd799439012',
        tenantId: '507f1f77bcf86cd799439013',
      },
    })

    expect(result).toMatchObject({
      user: scopes.user,
      resolvedPermissions: scopes.resolvedPermissions,
      memberships: scopes.memberships,
      tenantMemberships: scopes.tenantMemberships,
      platformRoles: scopes.platformRoles,
      vmfGrants: scopes.vmfGrants,
      customerIds: scopes.customerIds,
      customer: { _id: '507f1f77bcf86cd799439012', permissions: ['VMF_VIEW'] },
      tenant: {
        _id: '507f1f77bcf86cd799439013',
        customerId: '507f1f77bcf86cd799439012',
        permissions: ['VMF_VIEW'],
      },
    })
    expect(scopes.customer._id).toBe('old-customer')
    expect(scopes.tenant._id).toBe('old-tenant')
  })

  test('leaves missing request scope invalid for the repository guard', () => {
    const result = buildRuntimeStateRequestScopes({
      scopes: { platformRoles: ['SUPER_ADMIN'] },
      query: {},
    })

    expect(result.customer).toEqual({ _id: undefined })
    expect(result.tenant).toEqual({ _id: undefined, customerId: undefined })
    expect(result.platformRoles).toEqual(['SUPER_ADMIN'])
  })
})
