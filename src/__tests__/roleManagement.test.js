import { describe, test, expect, beforeAll, beforeEach, afterAll, afterEach, jest } from '@jest/globals'
import {
  PERMISSION_CATALOGUE,
  SUPER_ADMIN_LOCKED_PERMISSION_KEYS,
} from '../constants/permissionCatalogue.js'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
})

const SUPER_ADMIN_ID = '507f1f77bcf86cd799439011'
const NON_ADMIN_ID = '507f1f77bcf86cd799439012'
const ROLE_ID = '707f1f77bcf86cd799439033'
const SYSTEM_ROLE_ID = '707f1f77bcf86cd799439044'

const makeSuperAdmin = (overrides = {}) => ({
  _id: SUPER_ADMIN_ID,
  id: SUPER_ADMIN_ID,
  email: 'admin@storylineos.com',
  name: 'Super Administrator',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  save: jest.fn(async function save() {
    return this
  }),
  toJSON: function toJSON() {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      isActive: this.isActive,
      memberships: this.memberships,
    }
  },
  ...overrides,
})

const makeCustomRole = (overrides = {}) => ({
  _id: ROLE_ID,
  id: ROLE_ID,
  key: 'VMF_CREATOR',
  name: 'VMF Creator',
  description: 'Can create VMFs',
  scope: 'VMF',
  permissions: ['VMF_CREATE'],
  isSystem: false,
  isActive: true,
  save: jest.fn(async function save() {
    return this
  }),
  toJSON: function toJSON() {
    return {
      id: this._id,
      key: this.key,
      name: this.name,
      description: this.description,
      scope: this.scope,
      permissions: this.permissions,
      isSystem: this.isSystem,
      isActive: this.isActive,
    }
  },
  ...overrides,
})

const makeSystemRole = (overrides = {}) => makeCustomRole({
  _id: SYSTEM_ROLE_ID,
  id: SYSTEM_ROLE_ID,
  key: 'SUPER_ADMIN',
  name: 'Super Administrator',
  description: 'System platform administrator',
  scope: 'PLATFORM',
  permissions: [...SUPER_ADMIN_LOCKED_PERMISSION_KEYS],
  isSystem: true,
  ...overrides,
})

const makeEditableSystemRole = (overrides = {}) => makeCustomRole({
  _id: SYSTEM_ROLE_ID,
  id: SYSTEM_ROLE_ID,
  key: 'CUSTOMER_ADMIN',
  name: 'Customer Administrator',
  description: 'System customer administrator',
  scope: 'CUSTOMER',
  permissions: ['CUSTOMER_VIEW', 'USER_VIEW'],
  isSystem: true,
  ...overrides,
})

const makeUserSystemRole = (overrides = {}) => makeCustomRole({
  _id: SYSTEM_ROLE_ID,
  id: SYSTEM_ROLE_ID,
  key: 'USER',
  name: 'User',
  description: 'System tenant and VMF user role',
  scope: 'VMF',
  permissions: ['VMF_VIEW'],
  isSystem: true,
  ...overrides,
})

let app
let request
let tokenService
let User
let Role
let AuditLog

const buildRoleQueryChain = (rows) => {
  const chain = {
    lean: jest.fn().mockResolvedValue(rows),
  }
  chain.select = jest.fn().mockReturnValue(chain)
  chain.sort = jest.fn().mockReturnValue(chain)
  chain.skip = jest.fn().mockReturnValue(chain)
  chain.limit = jest.fn().mockReturnValue(chain)
  return chain
}

const buildDefaultRoleRows = () => ([
  {
    key: 'SUPER_ADMIN',
    scope: 'PLATFORM',
    permissions: ['PLATFORM_MANAGE', 'SYSTEM_HEALTH_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_VIEW', 'ROLE_MANAGE', 'AUDIT_VIEW_ALL'],
    isActive: true,
  },
  {
    key: 'USER',
    scope: 'VMF',
    permissions: ['VMF_VIEW', 'DEAL_CREATE', 'DEAL_UPDATE', 'DEAL_VIEW'],
    isActive: true,
  },
])
let logger
let performanceCacheService
let originalRoleSave

const mockFindOneSelect = (value) => {
  const select = jest.fn().mockResolvedValue(value)
  Role.findOne.mockReturnValue({ select })
  return select
}

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  Role = models.Role
  AuditLog = models.AuditLog
  logger = (await import('../config/logger.js')).default
  performanceCacheService = (await import('../services/performanceCacheService.js')).default

  originalRoleSave = Role.prototype.save
})

afterAll(() => {
  Role.prototype.save = originalRoleSave
})

afterEach(() => {
  jest.restoreAllMocks()
})

beforeEach(() => {
  User.findById = jest.fn().mockImplementation((userId) => {
    if (userId === SUPER_ADMIN_ID) {
      return Promise.resolve(makeSuperAdmin())
    }

    if (userId === NON_ADMIN_ID) {
      return Promise.resolve(
        makeSuperAdmin({
          _id: NON_ADMIN_ID,
          id: NON_ADMIN_ID,
          email: 'user@storylineos.com',
          memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
        }),
      )
    }

    return Promise.resolve(null)
  })

  User.find = jest.fn().mockReturnValue({
    select() {
      return this
    },
    maxTimeMS() {
      return this
    },
    limit() {
      return this
    },
    lean: jest.fn().mockResolvedValue([]),
  })
  User.countDocuments = jest.fn().mockResolvedValue(0)
  User.distinct = jest.fn().mockResolvedValue([])

  Role.find = jest.fn().mockImplementation(() => buildRoleQueryChain(buildDefaultRoleRows()))
  Role.countDocuments = jest.fn()
  Role.findOne = jest.fn()
  Role.findById = jest.fn()
  Role.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 })
  Role.prototype.save = jest.fn(async function save() {
    return this
  })

  AuditLog.createLog = jest.fn(async () => ({}))
})

describe('Role Management Routes', () => {
  test('GET /api/v1/super-admin/roles returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/roles')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('GET /api/v1/super-admin/roles returns 403 for non-SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(
      makeSuperAdmin({
        _id: NON_ADMIN_ID,
        id: NON_ADMIN_ID,
        email: 'user@storylineos.com',
        memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
      }),
    )

    const res = await request
      .get('/api/v1/super-admin/roles')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  test('POST /api/v1/super-admin/roles returns 422 when key is missing', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())

    const res = await request
      .post('/api/v1/super-admin/roles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'VMF Creator',
        scope: 'VMF',
        permissions: ['VMF_CREATE'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toHaveProperty('key')
  })

  test('POST /api/v1/super-admin/roles creates a custom role', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    mockFindOneSelect(null)

    const res = await request
      .post('/api/v1/super-admin/roles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'vmf_creator',
        name: 'VMF Creator',
        description: 'Can create VMFs',
        scope: 'VMF',
        permissions: ['vmf_create', 'vmf_update'],
        isActive: true,
      })

    expect(res.status).toBe(201)
    expect(res.body.data.key).toBe('VMF_CREATOR')
    expect(res.body.data.permissions).toEqual(['VMF_CREATE', 'VMF_UPDATE'])
    expect(Role.prototype.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_CREATED',
      resourceType: 'Role',
      summary: expect.stringContaining('created role'),
      display: expect.objectContaining({
        resourceLabel: expect.any(String),
      }),
    }))
  })

  test('POST /api/v1/super-admin/roles creates a custom role with empty permissions', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    mockFindOneSelect(null)

    const res = await request
      .post('/api/v1/super-admin/roles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'vmf_viewer',
        name: 'VMF Viewer',
        scope: 'VMF',
        permissions: [],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.key).toBe('VMF_VIEWER')
    expect(res.body.data.permissions).toEqual([])
    expect(Role.prototype.save).toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/roles returns 422 for unknown permissions', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())

    const res = await request
      .post('/api/v1/super-admin/roles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'vmf_viewer',
        name: 'VMF Viewer',
        scope: 'VMF',
        permissions: ['fake_perm'],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.permissions).toBe('Unknown permissions: FAKE_PERM')
    expect(Role.findOne).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/roles returns 409 for duplicate key', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    mockFindOneSelect({ _id: '607f1f77bcf86cd799439088' })

    const res = await request
      .post('/api/v1/super-admin/roles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'VMF_CREATOR',
        name: 'VMF Creator',
        scope: 'VMF',
        permissions: ['VMF_CREATE'],
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  test('GET /api/v1/super-admin/roles returns paginated roles', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())

    const rows = [
      {
        _id: ROLE_ID,
        key: 'VMF_CREATOR',
        name: 'VMF Creator',
        description: 'Can create VMFs',
        scope: 'VMF',
        permissions: ['VMF_CREATE'],
        isSystem: false,
        isActive: true,
      },
    ]

    Role.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue(buildDefaultRoleRows()),
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    })
    Role.countDocuments.mockResolvedValue(1)

    const res = await request
      .get('/api/v1/super-admin/roles?scope=VMF&isSystem=false&page=1&pageSize=20')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.total).toBe(1)
    expect(res.body.meta.page).toBe(1)
  })

  test('GET /api/v1/super-admin/roles/permissions/catalogue returns grouped permission metadata', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())

    const res = await request
      .get('/api/v1/super-admin/roles/permissions/catalogue')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(PERMISSION_CATALOGUE)
    expect(res.body.meta.version).toBe('v1')
    expect(res.body.meta.requestId).toBeDefined()
  })

  test('GET /api/v1/super-admin/roles/:roleId returns 404 when not found', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    Role.findById.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/super-admin/roles/${ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('PATCH /api/v1/super-admin/roles/:roleId updates custom role', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeCustomRole()
    const planInvalidation = jest
      .spyOn(performanceCacheService, 'planUserPermissionInvalidationForRoleKey')
      .mockResolvedValue({
        roleKey: 'VMF_CREATOR',
        affectedUserIds: ['user-1', 'user-2'],
        affectedUserCount: 2,
        skipped: false,
        globalInvalidation: false,
        globalInvalidationReason: null,
      })
    const loggerInfo = jest.spyOn(logger, 'info').mockImplementation(() => undefined)
    const invalidateRoleCaches = jest
      .spyOn(performanceCacheService, 'invalidateUserPermissionsForRoleKey')
      .mockResolvedValue({
        roleKey: 'VMF_CREATOR',
        affectedUserCount: 2,
        invalidatedUserCount: 2,
        globalInvalidation: false,
        globalInvalidationReason: null,
        redisFailureCount: 0,
        skipped: false,
      })
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'Can create and update VMFs',
        permissions: ['VMF_CREATE', 'VMF_UPDATE'],
      })

    expect(res.status).toBe(200)
    expect(role.save).toHaveBeenCalled()
    expect(planInvalidation).toHaveBeenCalledWith('VMF_CREATOR')
    expect(invalidateRoleCaches).toHaveBeenCalledWith(
      'VMF_CREATOR',
      expect.objectContaining({
        affectedUserIds: ['user-1', 'user-2'],
        affectedUserCount: 2,
        invalidationPlan: expect.objectContaining({
          affectedUserCount: 2,
          globalInvalidation: false,
        }),
      }),
    )
    expect(loggerInfo).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.any(String),
      roleId: ROLE_ID,
      roleKey: 'VMF_CREATOR',
      changedFields: ['permissions'],
      affectedUserCount: 2,
      invalidatedUserCount: 2,
      globalInvalidation: false,
      globalInvalidationReason: null,
      redisFailureCount: 0,
      skipped: false,
    }), 'role authorization cache invalidation completed')
    expect(res.body.data.description).toBe('Can create and update VMFs')
    expect(res.body.data.permissions).toEqual(['VMF_CREATE', 'VMF_UPDATE'])
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_UPDATED',
      resourceType: 'Role',
      resourceId: ROLE_ID,
      summary: expect.stringContaining('updated role'),
      display: expect.objectContaining({
        resourceLabel: expect.any(String),
      }),
    }))
  })

  test('PATCH /api/v1/super-admin/roles/:roleId skips cache invalidation for metadata-only updates', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeCustomRole()
    const invalidateRoleCaches = jest
      .spyOn(performanceCacheService, 'invalidateUserPermissionsForRoleKey')
      .mockResolvedValue({
        roleKey: 'VMF_CREATOR',
        affectedUserCount: 0,
        invalidatedUserCount: 0,
        globalInvalidation: false,
        globalInvalidationReason: null,
        redisFailureCount: 0,
        skipped: false,
      })
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Updated copy only' })

    expect(res.status).toBe(200)
    expect(role.save).toHaveBeenCalled()
    expect(invalidateRoleCaches).not.toHaveBeenCalled()
    expect(res.body.data.description).toBe('Updated copy only')
  })

  test('PATCH /api/v1/super-admin/roles/:roleId invalidates caches for scope-only updates', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeCustomRole()
    const invalidateRoleCaches = jest
      .spyOn(performanceCacheService, 'invalidateUserPermissionsForRoleKey')
      .mockResolvedValue({
        roleKey: 'VMF_CREATOR',
        affectedUserCount: 1,
        invalidatedUserCount: 1,
        globalInvalidation: false,
        globalInvalidationReason: null,
        redisFailureCount: 0,
        skipped: false,
      })
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scope: 'TENANT' })

    expect(res.status).toBe(200)
    expect(role.save).toHaveBeenCalled()
    expect(invalidateRoleCaches).toHaveBeenCalledWith(
      'VMF_CREATOR',
      expect.objectContaining({ affectedUserIds: [] }),
    )
    expect(res.body.data.scope).toBe('TENANT')
  })

  test('PATCH /api/v1/super-admin/roles/:roleId invalidates caches for activation changes', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeCustomRole()
    const invalidateRoleCaches = jest
      .spyOn(performanceCacheService, 'invalidateUserPermissionsForRoleKey')
      .mockResolvedValue({
        roleKey: 'VMF_CREATOR',
        affectedUserCount: 1,
        invalidatedUserCount: 1,
        globalInvalidation: false,
        globalInvalidationReason: null,
        redisFailureCount: 0,
        skipped: false,
      })
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })

    expect(res.status).toBe(200)
    expect(role.save).toHaveBeenCalled()
    expect(invalidateRoleCaches).toHaveBeenCalledWith(
      'VMF_CREATOR',
      expect.objectContaining({ affectedUserIds: [] }),
    )
    expect(res.body.data.isActive).toBe(false)
  })

  test('PATCH /api/v1/super-admin/roles/:roleId updates an editable system role permissions', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeEditableSystemRole()
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permissions: ['CUSTOMER_VIEW'] })

    expect(res.status).toBe(200)
    expect(role.save).toHaveBeenCalled()
    expect(res.body.data.permissions).toEqual(['CUSTOMER_VIEW'])
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_UPDATED',
      resourceType: 'Role',
      resourceId: SYSTEM_ROLE_ID,
    }))
  })

  test('PATCH /api/v1/super-admin/roles/:roleId allows clearing all permissions for editable system roles', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeEditableSystemRole()
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permissions: [] })

    expect(res.status).toBe(200)
    expect(role.save).toHaveBeenCalled()
    expect(res.body.data.permissions).toEqual([])
  })

  test('PATCH /api/v1/super-admin/roles/:roleId rejects deactivating the USER system role', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeUserSystemRole()
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(res.body.error.message).toBe(
      'USER role must remain active because tenant visibility assignments depend on it.',
    )
    expect(role.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_MUTATION_BLOCKED',
      resourceType: 'Role',
      resourceId: SYSTEM_ROLE_ID,
      summary: expect.stringContaining('blocked role mutation'),
      display: expect.objectContaining({
        resourceLabel: expect.any(String),
      }),
    }))
  })

  test('PATCH /api/v1/super-admin/roles/:roleId returns 422 for unknown permissions', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())

    const res = await request
      .patch(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permissions: ['fake_perm'] })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details.permissions).toBe('Unknown permissions: FAKE_PERM')
  })

  test('PATCH /api/v1/super-admin/roles/:roleId returns 403 when the model guard rejects the save', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeEditableSystemRole({
      save: jest.fn(async () => {
        throw new Error('System roles can only have their permissions and activation status modified')
      }),
    })
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permissions: ['CUSTOMER_VIEW'] })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(res.body.error.message).toBe(
      'System roles can only have their permissions and activation status modified',
    )
  })

  test('PATCH /api/v1/super-admin/roles/:roleId rejects disallowed fields for editable system roles', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeEditableSystemRole()
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(res.body.error.message).toContain('permissions, isActive')
    expect(role.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_MUTATION_BLOCKED',
      resourceType: 'Role',
      resourceId: SYSTEM_ROLE_ID,
      summary: expect.stringContaining('blocked role mutation'),
      display: expect.objectContaining({
        resourceLabel: expect.any(String),
      }),
    }))
  })

  test('PATCH /api/v1/super-admin/roles/:roleId rejects mixed allowed and disallowed fields for editable system roles', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeEditableSystemRole()
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        permissions: [],
        name: 'New Name',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(res.body.error.message).toContain('Disallowed fields: name')
    expect(role.save).not.toHaveBeenCalled()
  })

  test('PATCH /api/v1/super-admin/roles/:roleId allows adding extra permissions to SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeSystemRole()
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permissions: [...SUPER_ADMIN_LOCKED_PERMISSION_KEYS, 'VMF_CREATE'] })

    expect(res.status).toBe(200)
    expect(role.save).toHaveBeenCalled()
    expect(res.body.data.permissions).toEqual([...SUPER_ADMIN_LOCKED_PERMISSION_KEYS, 'VMF_CREATE'])
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_UPDATED',
      resourceType: 'Role',
      resourceId: SYSTEM_ROLE_ID,
      summary: expect.stringContaining('updated role'),
      display: expect.objectContaining({
        resourceLabel: expect.any(String),
      }),
    }))
  })

  test('PATCH /api/v1/super-admin/roles/:roleId rejects removing locked baseline permissions from SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeSystemRole()
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        permissions: SUPER_ADMIN_LOCKED_PERMISSION_KEYS.filter(
          (permissionKey) => permissionKey !== 'ROLE_MANAGE',
        ),
      })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(res.body.error.message).toContain('ROLE_MANAGE')
    expect(role.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_MUTATION_BLOCKED',
      resourceType: 'Role',
      resourceId: SYSTEM_ROLE_ID,
    }))
  })

  test('PATCH /api/v1/super-admin/roles/:roleId rejects name and scope changes for SUPER_ADMIN', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    const role = makeSystemRole()
    Role.findById.mockResolvedValue(role)

    const res = await request
      .patch(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated Super Administrator',
        scope: 'CUSTOMER',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(res.body.error.message).toContain('Disallowed fields: name, scope')
    expect(role.save).not.toHaveBeenCalled()
  })

  test('DELETE /api/v1/super-admin/roles/:roleId blocks delete for system roles', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    Role.findById.mockResolvedValue(makeSystemRole())

    const res = await request
      .delete(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_MUTATION_BLOCKED',
      resourceType: 'Role',
      resourceId: SYSTEM_ROLE_ID,
    }))
  })

  test('DELETE /api/v1/super-admin/roles/:roleId returns 409 when role is assigned', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    Role.findById.mockResolvedValue(makeCustomRole())
    User.countDocuments.mockResolvedValue(2)

    const res = await request
      .delete(`/api/v1/super-admin/roles/${ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details.reason).toBe('ROLE_IN_USE')
    expect(Role.deleteOne).not.toHaveBeenCalled()
  })

  test('DELETE /api/v1/super-admin/roles/:roleId deletes a custom role', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    Role.findById.mockResolvedValue(makeCustomRole())
    User.countDocuments.mockResolvedValue(0)

    const res = await request
      .delete(`/api/v1/super-admin/roles/${ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Role.deleteOne).toHaveBeenCalledWith({ _id: ROLE_ID })
    expect(res.body.data.key).toBe('VMF_CREATOR')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_DELETED',
      resourceType: 'Role',
      resourceId: ROLE_ID,
      summary: expect.stringContaining('deleted role'),
      display: expect.objectContaining({
        resourceLabel: expect.any(String),
      }),
    }))
  })
})
