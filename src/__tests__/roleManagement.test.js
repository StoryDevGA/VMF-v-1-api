import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals'

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
  permissions: ['PLATFORM_MANAGE', 'ROLE_MANAGE'],
  isSystem: true,
  ...overrides,
})

let app
let request
let tokenService
let User
let Role
let AuditLog
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

  originalRoleSave = Role.prototype.save
})

afterAll(() => {
  Role.prototype.save = originalRoleSave
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

  User.countDocuments = jest.fn().mockResolvedValue(0)

  Role.find = jest.fn()
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
    }))
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
    expect(res.body.data.description).toBe('Can create and update VMFs')
    expect(res.body.data.permissions).toEqual(['VMF_CREATE', 'VMF_UPDATE'])
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_UPDATED',
      resourceType: 'Role',
      resourceId: ROLE_ID,
    }))
  })

  test('PATCH /api/v1/super-admin/roles/:roleId blocks updates for system roles', async () => {
    const token = await getAccessTokenForUser(makeSuperAdmin())
    Role.findById.mockResolvedValue(makeSystemRole())

    const res = await request
      .patch(`/api/v1/super-admin/roles/${SYSTEM_ROLE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_MUTATION_BLOCKED',
      resourceType: 'Role',
      resourceId: SYSTEM_ROLE_ID,
    }))
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
    }))
  })
})
