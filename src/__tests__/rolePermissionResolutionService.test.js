import { beforeAll, describe, expect, jest, test } from '@jest/globals'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
})

const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const CUSTOMER_ID_2 = '607f1f77bcf86cd799439023'
const TENANT_ID = '707f1f77bcf86cd799439033'
const TENANT_ID_2 = '707f1f77bcf86cd799439034'

const makeRoleModel = (roleDocuments = []) => {
  const query = {
    lean: jest.fn().mockResolvedValue(roleDocuments),
  }
  query.select = jest.fn().mockReturnValue(query)

  return {
    find: jest.fn().mockReturnValue(query),
    query,
  }
}

describe('rolePermissionResolutionService', () => {
  let createEmptyResolvedPermissions
  let resolveRolePermissions

  beforeAll(async () => {
    const mod = await import('../services/rolePermissionResolutionService.js')
    createEmptyResolvedPermissions = mod.createEmptyResolvedPermissions
    resolveRolePermissions = mod.resolveRolePermissions
  })

  test('createEmptyResolvedPermissions returns the locked empty shape', () => {
    expect(createEmptyResolvedPermissions()).toEqual({
      platform: {
        roleKeys: [],
        permissions: [],
      },
      customers: [],
      tenants: [],
    })
  })

  test('resolveRolePermissions returns the empty shape without querying roles when no assignments exist', async () => {
    const roleModel = makeRoleModel([
      {
        key: 'SHOULD_NOT_BE_USED',
        scope: 'CUSTOMER',
        permissions: ['CUSTOMER_VIEW'],
        isActive: true,
      },
    ])

    const resolvedPermissions = await resolveRolePermissions({
      memberships: [],
      tenantMemberships: [],
      roleModel,
      log: { warn: jest.fn() },
    })

    expect(resolvedPermissions).toEqual(createEmptyResolvedPermissions())
    expect(roleModel.find).not.toHaveBeenCalled()
  })

  test('resolveRolePermissions groups canonical platform, customer, and tenant assignments deterministically', async () => {
    const roleModel = makeRoleModel([
      {
        key: 'USER',
        scope: 'TENANT',
        permissions: ['VMF_VIEW', 'VMF_CREATE', 'VMF_VIEW'],
        isActive: true,
      },
      {
        key: 'CUSTOMER_ADMIN',
        scope: 'CUSTOMER',
        permissions: ['USER_VIEW', 'CUSTOMER_VIEW'],
        isActive: true,
      },
      {
        key: 'SUPER_ADMIN',
        scope: 'PLATFORM',
        permissions: ['SYSTEM_HEALTH_VIEW', 'PLATFORM_MANAGE'],
        isActive: true,
      },
      {
        key: 'VMF_EDITOR',
        scope: 'VMF',
        permissions: ['VMF_UPDATE', 'VMF_VIEW'],
        isActive: true,
      },
    ])

    const resolvedPermissions = await resolveRolePermissions({
      memberships: [
        { customerId: null, roles: ['super_admin'] },
        { customerId: CUSTOMER_ID, roles: ['customer_admin', 'customer_admin'] },
      ],
      tenantMemberships: [
        { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['vmf_editor', 'user', 'user'] },
      ],
      roleModel,
      log: { warn: jest.fn() },
    })

    expect(roleModel.find).toHaveBeenCalledWith({
      key: { $in: ['CUSTOMER_ADMIN', 'SUPER_ADMIN', 'USER', 'VMF_EDITOR'] },
    })
    expect(roleModel.query.select).toHaveBeenCalledWith('key scope permissions isActive')
    expect(roleModel.query.lean).toHaveBeenCalled()
    expect(resolvedPermissions).toEqual({
      platform: {
        roleKeys: ['SUPER_ADMIN'],
        permissions: ['PLATFORM_MANAGE', 'SYSTEM_HEALTH_VIEW'],
      },
      customers: [
        {
          customerId: CUSTOMER_ID,
          roleKeys: ['CUSTOMER_ADMIN'],
          permissions: ['CUSTOMER_VIEW', 'USER_VIEW'],
        },
      ],
      tenants: [
        {
          customerId: CUSTOMER_ID,
          tenantId: TENANT_ID,
          roleKeys: ['USER', 'VMF_EDITOR'],
          permissions: ['VMF_CREATE', 'VMF_UPDATE', 'VMF_VIEW'],
        },
      ],
    })
  })

  test('resolveRolePermissions sorts multiple customer and tenant buckets deterministically', async () => {
    const roleModel = makeRoleModel([
      {
        key: 'CUSTOMER_ALPHA',
        scope: 'CUSTOMER',
        permissions: ['CUSTOMER_VIEW'],
        isActive: true,
      },
      {
        key: 'CUSTOMER_BETA',
        scope: 'CUSTOMER',
        permissions: ['USER_VIEW'],
        isActive: true,
      },
      {
        key: 'TENANT_ALPHA',
        scope: 'TENANT',
        permissions: ['VMF_VIEW'],
        isActive: true,
      },
      {
        key: 'TENANT_BETA',
        scope: 'TENANT',
        permissions: ['VMF_CREATE'],
        isActive: true,
      },
    ])

    const resolvedPermissions = await resolveRolePermissions({
      memberships: [
        { customerId: CUSTOMER_ID_2, roles: ['customer_beta'] },
        { customerId: CUSTOMER_ID, roles: ['customer_alpha'] },
      ],
      tenantMemberships: [
        { customerId: CUSTOMER_ID_2, tenantId: TENANT_ID_2, roles: ['tenant_beta'] },
        { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['tenant_alpha'] },
      ],
      roleModel,
      log: { warn: jest.fn() },
    })

    expect(resolvedPermissions).toEqual({
      platform: {
        roleKeys: [],
        permissions: [],
      },
      customers: [
        {
          customerId: CUSTOMER_ID,
          roleKeys: ['CUSTOMER_ALPHA'],
          permissions: ['CUSTOMER_VIEW'],
        },
        {
          customerId: CUSTOMER_ID_2,
          roleKeys: ['CUSTOMER_BETA'],
          permissions: ['USER_VIEW'],
        },
      ],
      tenants: [
        {
          customerId: CUSTOMER_ID,
          tenantId: TENANT_ID,
          roleKeys: ['TENANT_ALPHA'],
          permissions: ['VMF_VIEW'],
        },
        {
          customerId: CUSTOMER_ID_2,
          tenantId: TENANT_ID_2,
          roleKeys: ['TENANT_BETA'],
          permissions: ['VMF_CREATE'],
        },
      ],
    })
  })

  test('resolveRolePermissions maps legacy TENANT and VMF roles in memberships into the customer bucket', async () => {
    const roleModel = makeRoleModel([
      {
        key: 'VMF_EDITOR',
        scope: 'VMF',
        permissions: ['VMF_UPDATE', 'VMF_VIEW'],
        isActive: true,
      },
      {
        key: 'TENANT_ADMIN',
        scope: 'TENANT',
        permissions: ['TENANT_VIEW', 'TENANT_UPDATE'],
        isActive: true,
      },
    ])

    const resolvedPermissions = await resolveRolePermissions({
      memberships: [
        { customerId: CUSTOMER_ID_2, roles: ['vmf_editor', 'tenant_admin'] },
      ],
      tenantMemberships: [],
      roleModel,
      log: { warn: jest.fn() },
    })

    expect(resolvedPermissions).toEqual({
      platform: {
        roleKeys: [],
        permissions: [],
      },
      customers: [
        {
          customerId: CUSTOMER_ID_2,
          roleKeys: ['TENANT_ADMIN', 'VMF_EDITOR'],
          permissions: ['TENANT_UPDATE', 'TENANT_VIEW', 'VMF_UPDATE', 'VMF_VIEW'],
        },
      ],
      tenants: [],
    })
  })

  test('resolveRolePermissions ignores missing, inactive, and mis-scoped assignments with structured warnings', async () => {
    const log = { warn: jest.fn() }
    const roleModel = makeRoleModel([
      {
        key: 'DISABLED_ROLE',
        scope: 'CUSTOMER',
        permissions: ['CUSTOMER_VIEW'],
        isActive: false,
      },
      {
        key: 'CUSTOMER_ADMIN',
        scope: 'CUSTOMER',
        permissions: ['CUSTOMER_VIEW'],
        isActive: true,
      },
      {
        key: 'PLATFORM_ADMIN',
        scope: 'PLATFORM',
        permissions: ['PLATFORM_MANAGE'],
        isActive: true,
      },
    ])

    const resolvedPermissions = await resolveRolePermissions({
      user: { _id: '507f1f77bcf86cd799439011' },
      memberships: [
        { customerId: CUSTOMER_ID, roles: ['missing_role', 'disabled_role', 'platform_admin'] },
      ],
      tenantMemberships: [
        { customerId: CUSTOMER_ID, tenantId: TENANT_ID_2, roles: ['customer_admin'] },
      ],
      roleModel,
      log,
    })

    expect(resolvedPermissions).toEqual({
      platform: {
        roleKeys: [],
        permissions: [],
      },
      customers: [],
      tenants: [],
    })

    expect(log.warn).toHaveBeenCalledTimes(4)
    expect(log.warn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actorUserId: '507f1f77bcf86cd799439011',
        customerId: CUSTOMER_ID,
        roleKey: 'MISSING_ROLE',
        reason: 'missing_role',
        source: 'customer_membership',
      }),
      'resolved permission role skipped',
    )
    expect(log.warn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actorUserId: '507f1f77bcf86cd799439011',
        customerId: CUSTOMER_ID,
        roleKey: 'DISABLED_ROLE',
        roleScope: 'CUSTOMER',
        reason: 'inactive_role',
        source: 'customer_membership',
      }),
      'resolved permission role skipped',
    )
    expect(log.warn).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        actorUserId: '507f1f77bcf86cd799439011',
        customerId: CUSTOMER_ID,
        roleKey: 'PLATFORM_ADMIN',
        roleScope: 'PLATFORM',
        reason: 'customer_membership_scope_mismatch',
        source: 'customer_membership',
      }),
      'resolved permission role skipped',
    )
    expect(log.warn).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        actorUserId: '507f1f77bcf86cd799439011',
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID_2,
        roleKey: 'CUSTOMER_ADMIN',
        roleScope: 'CUSTOMER',
        reason: 'tenant_membership_scope_mismatch',
        source: 'tenant_membership',
      }),
      'resolved permission role skipped',
    )
  })

  test('resolveRolePermissions serializes ObjectId-like ids to strings in customer and tenant buckets', async () => {
    const customerId = { toString: () => CUSTOMER_ID }
    const tenantId = { toString: () => TENANT_ID }
    const roleModel = makeRoleModel([
      {
        key: 'CUSTOMER_ADMIN',
        scope: 'CUSTOMER',
        permissions: ['CUSTOMER_VIEW'],
        isActive: true,
      },
      {
        key: 'USER',
        scope: 'TENANT',
        permissions: ['VMF_VIEW'],
        isActive: true,
      },
    ])

    const resolvedPermissions = await resolveRolePermissions({
      memberships: [{ customerId, roles: ['customer_admin'] }],
      tenantMemberships: [{ customerId, tenantId, roles: ['user'] }],
      roleModel,
      log: { warn: jest.fn() },
    })

    expect(resolvedPermissions).toEqual({
      platform: {
        roleKeys: [],
        permissions: [],
      },
      customers: [
        {
          customerId: CUSTOMER_ID,
          roleKeys: ['CUSTOMER_ADMIN'],
          permissions: ['CUSTOMER_VIEW'],
        },
      ],
      tenants: [
        {
          customerId: CUSTOMER_ID,
          tenantId: TENANT_ID,
          roleKeys: ['USER'],
          permissions: ['VMF_VIEW'],
        },
      ],
    })
  })

  test('resolveRolePermissions warns for unsupported scope, platform mismatch, and invalid tenant membership without creating empty buckets', async () => {
    const log = { warn: jest.fn() }
    const roleModel = makeRoleModel([
      {
        key: 'CUSTOMER_ADMIN',
        scope: 'CUSTOMER',
        permissions: ['CUSTOMER_VIEW'],
        isActive: true,
      },
      {
        key: 'BROKEN_ROLE',
        scope: 'ALIEN',
        permissions: ['VMF_VIEW'],
        isActive: true,
      },
      {
        key: 'USER',
        scope: 'TENANT',
        permissions: ['VMF_VIEW'],
        isActive: true,
      },
    ])

    const resolvedPermissions = await resolveRolePermissions({
      user: { _id: '507f1f77bcf86cd799439099' },
      memberships: [
        { customerId: null, roles: ['customer_admin'] },
        { customerId: { toString: () => CUSTOMER_ID }, roles: ['broken_role'] },
      ],
      tenantMemberships: [
        { customerId: { toString: () => CUSTOMER_ID }, tenantId: null, roles: ['user'] },
      ],
      roleModel,
      log,
    })

    expect(resolvedPermissions).toEqual({
      platform: {
        roleKeys: [],
        permissions: [],
      },
      customers: [],
      tenants: [],
    })
    expect(log.warn).toHaveBeenCalledTimes(3)
    expect(log.warn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actorUserId: '507f1f77bcf86cd799439099',
        customerId: null,
        tenantId: null,
        roleKey: 'CUSTOMER_ADMIN',
        roleScope: 'CUSTOMER',
        reason: 'platform_membership_scope_mismatch',
        source: 'platform_membership',
      }),
      'resolved permission role skipped',
    )
    expect(log.warn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actorUserId: '507f1f77bcf86cd799439099',
        customerId: CUSTOMER_ID,
        tenantId: null,
        roleKey: 'BROKEN_ROLE',
        roleScope: 'ALIEN',
        reason: 'unsupported_scope',
        source: 'customer_membership',
      }),
      'resolved permission role skipped',
    )
    expect(log.warn).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        actorUserId: '507f1f77bcf86cd799439099',
        customerId: CUSTOMER_ID,
        tenantId: null,
        roleKey: 'USER',
        reason: 'invalid_tenant_membership',
        source: 'tenant_membership',
      }),
      'resolved permission role skipped',
    )
  })
})