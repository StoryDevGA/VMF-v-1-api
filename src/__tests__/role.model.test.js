import { beforeAll, describe, expect, test } from '@jest/globals'
import { SUPER_ADMIN_LOCKED_PERMISSION_KEYS } from '../constants/permissionCatalogue.js'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
})

let Role

const runSavePreHooks = (role) =>
  new Promise((resolve, reject) => {
    Role.schema.s.hooks.execPre('save', role, (err) => {
      if (err) {
        reject(err)
        return
      }

      resolve()
    })
  })

const buildSystemRoleDocument = (doc = {}) => ({
  _id: '707f1f77bcf86cd799439044',
  key: 'CUSTOMER_ADMIN',
  name: 'Customer Administrator',
  description: 'System customer administrator',
  scope: 'CUSTOMER',
  permissions: ['CUSTOMER_VIEW', 'USER_VIEW'],
  isSystem: true,
  isActive: true,
  createdAt: new Date('2026-03-31T10:00:00.000Z'),
  updatedAt: new Date('2026-03-31T10:00:00.000Z'),
  ...doc,
})

describe('Role model system-role save guard', () => {
  beforeAll(async () => {
    Role = (await import('../models/Role.js')).default
  })

  test('allows permission updates on legacy system roles with defaulted fields', async () => {
    const role = Role.hydrate(buildSystemRoleDocument({
      description: undefined,
      isActive: undefined,
    }))

    role.permissions = ['CUSTOMER_VIEW']

    await expect(runSavePreHooks(role)).resolves.toBeUndefined()
  })

  test('rejects disallowed system-role field changes', async () => {
    const role = Role.hydrate(buildSystemRoleDocument())

    role.name = 'Updated Customer Administrator'

    await expect(runSavePreHooks(role)).rejects.toThrow(
      'System roles can only have their permissions and activation status modified',
    )
  })

  test('rejects SUPER_ADMIN permission updates that remove locked baseline permissions', async () => {
    const role = Role.hydrate(buildSystemRoleDocument({
      key: 'SUPER_ADMIN',
      name: 'Super Administrator',
      description: 'System platform administrator',
      scope: 'PLATFORM',
      permissions: SUPER_ADMIN_LOCKED_PERMISSION_KEYS,
    }))

    role.permissions = SUPER_ADMIN_LOCKED_PERMISSION_KEYS.filter(
      (permissionKey) => permissionKey !== 'ROLE_MANAGE',
    )

    await expect(runSavePreHooks(role)).rejects.toThrow(
      'SUPER_ADMIN must retain locked baseline permissions: ROLE_MANAGE',
    )
  })
})
