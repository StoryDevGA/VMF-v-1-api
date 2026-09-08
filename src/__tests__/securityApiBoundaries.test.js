import { beforeAll, beforeEach, afterEach, test, expect, jest } from '@jest/globals'
import express from 'express'
import supertest from 'supertest'

const USER_ID = '507f1f77bcf86cd799439011'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const OTHER_CUSTOMER_ID = '607f1f77bcf86cd799439023'
const TENANT_ID = '707f1f77bcf86cd799439033'
const VMF_ID = '807f1f77bcf86cd799439044'
let request, env, models, cache, audit, accessToken, errorHandler, normalizeHttpError
let customer, tenant, snapshot, queryChains

const chain = (rows = []) => {
  const result = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(rows) }
  return result
}
const makeCustomer = (id = CUSTOMER_ID) => ({ _id: id, id, name: 'Boundary customer', status: 'ACTIVE',
  topology: 'MULTI_TENANT', vmfPolicy: 'PER_TENANT_MULTI', governance: { maxTenants: 10, maxVmfsPerTenant: 10 },
  save: jest.fn(async function () { return this }), toJSON() { return { id: this.id, status: this.status } } })
const makeSnapshot = () => ({ isActive: true, user: { _id: USER_ID }, isPlatformUser: true,
  platformRoles: ['SUPER_ADMIN'], memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
  tenantMemberships: [], vmfGrants: [], resolvedPermissions: {
    platform: { roleKeys: ['SUPER_ADMIN'], permissions: ['ROLE_MANAGE'] }, customers: [], tenants: [],
  } })

beforeAll(async () => {
  Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'api-boundary-test-access-secret-long-enough',
    JWT_REFRESH_SECRET: 'api-boundary-test-refresh-secret-long-enough',
    MONGODB_URI: 'mongodb://localhost:27017/vmf_test' })
  models = await import('../models/index.js')
  cache = (await import('../services/performanceCacheService.js')).default
  audit = (await import('../services/auditService.js')).default
  env = (await import('../config/env.js')).default
  ;({ default: errorHandler, normalizeHttpError } = await import('../middleware/errorHandler.js'))
  request = supertest((await import('../app.js')).default)
  accessToken = (await (await import('../services/tokenService.js')).default.generateTokens({ _id: USER_ID })).accessToken
})

beforeEach(() => {
  env.nodeEnv = 'test'
  env.governanceInactiveEnforcementEnabled = true
  customer = makeCustomer()
  tenant = { _id: TENANT_ID, customerId: CUSTOMER_ID, status: 'ENABLED', tenantAdminUserIds: [], isDefault: false }
  snapshot = makeSnapshot()
  queryChains = {}
  jest.spyOn(cache, 'getUserPermissions').mockImplementation(async () => snapshot)
  jest.spyOn(cache, 'getCustomerTopology').mockResolvedValue(null)
  jest.spyOn(cache, 'getTenantStatus').mockResolvedValue(null)
  jest.spyOn(cache, 'setCustomerTopology').mockResolvedValue()
  jest.spyOn(cache, 'setTenantStatus').mockResolvedValue()
  jest.spyOn(cache, 'invalidateCustomerTopology').mockResolvedValue()
  jest.spyOn(audit, 'logFromRequest').mockResolvedValue()
  jest.spyOn(models.Customer, 'findById').mockResolvedValue(customer)
  jest.spyOn(models.Tenant, 'findById').mockResolvedValue(tenant)
  jest.spyOn(models.VMF, 'findById').mockResolvedValue({ _id: VMF_ID, customerId: CUSTOMER_ID, tenantId: TENANT_ID, status: 'ACTIVE' })
  for (const name of ['Customer', 'Tenant', 'VMF', 'Deal']) {
    queryChains[name] = chain()
    jest.spyOn(models[name], 'find').mockReturnValue(queryChains[name])
    jest.spyOn(models[name], 'countDocuments').mockResolvedValue(0)
  }
  jest.spyOn(models.VMF, 'countByTenant').mockResolvedValue(0)
  jest.spyOn(models.Role, 'find').mockResolvedValue([
    { key: 'CUSTOMER_ADMIN', scope: 'CUSTOMER', permissions: ['TENANT_VIEW'], isActive: true },
  ])
})
afterEach(() => { env.nodeEnv = 'test'; env.governanceInactiveEnforcementEnabled = true; jest.restoreAllMocks() })

const listCases = [
  ['Customer', '/api/v1/customers'],
  ['Tenant', `/api/v1/customers/${CUSTOMER_ID}/tenants`],
  ['VMF', `/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`],
  ['Deal', `/api/v1/vmfs/${VMF_ID}/deals`],
]
const invalidQueries = ['q%5B%24gt%5D=x', 'status%5B%24ne%5D=NOTHING', 'q=x&q=y', `q=${'x'.repeat(251)}`,
  'page=0', 'page=1e100', 'pageSize=101', 'pageSize%5B%24gt%5D=0']

test.each(listCases)('%s list rejects object, operator, array and oversized query values before list execution', async (name, url) => {
  for (const query of invalidQueries) {
    const response = await request.get(`${url}?${query}`).set('Authorization', `Bearer ${accessToken}`)
    expect({ query, status: response.status, code: response.body.error?.code })
      .toEqual({ query, status: 422, code: 'VALIDATION_FAILED' })
  }
  expect(models[name].find).not.toHaveBeenCalled()
  expect(models[name].countDocuments).not.toHaveBeenCalled()
})

test.each(listCases)('%s list preserves bounded pagination and treats regex metacharacters literally', async (name, url) => {
  const response = await request.get(url).query({ q: '(a+)+$', page: '2', pageSize: '7' })
    .set('Authorization', `Bearer ${accessToken}`)
  expect(response.status).toBe(200)
  expect(response.body.meta).toMatchObject({ page: 2, pageSize: 7 })
  expect(queryChains[name].skip).toHaveBeenCalledWith(7)
  expect(queryChains[name].limit).toHaveBeenCalledWith(7)
  const filter = models[name].find.mock.calls[0][0]
  const searches = filter.$or || [filter]
  const fields = name === 'Deal' ? ['title', 'stage'] : name === 'VMF' ? ['name', 'description'] : ['name']
  fields.forEach((field, index) => {
    expect(searches[index][field].$regex).toBe('\\(a\\+\\)\\+\\$')
    const regex = new RegExp(searches[index][field].$regex)
    expect(regex.test('(a+)+$')).toBe(true)
    expect(regex.test('aaaaaaaaa')).toBe(false)
  })
})

test('disabling and re-enabling a customer preserves global user activation and independent tenant state', async () => {
  const userWrites = jest.spyOn(models.User, 'updateMany')
  const tenantWrites = jest.spyOn(models.Tenant, 'updateMany')
  for (const status of ['DISABLED', 'ACTIVE']) {
    const response = await request.patch(`/api/v1/customers/${CUSTOMER_ID}/status`)
      .set('Authorization', `Bearer ${accessToken}`).send({ status })
    expect(response.status).toBe(200)
    expect(customer.status).toBe(status)
  }
  expect(customer.save).toHaveBeenCalledTimes(2)
  expect(cache.invalidateCustomerTopology).toHaveBeenCalledTimes(2)
  expect(userWrites).not.toHaveBeenCalled()
  expect(tenantWrites).not.toHaveBeenCalled()
  expect(tenant.status).toBe('ENABLED')
})

test('customer status gate blocks only the inactive customer and permits the same user in another active customer', async () => {
  customer.status = 'DISABLED'
  const other = makeCustomer(OTHER_CUSTOMER_ID)
  snapshot.platformRoles = []
  snapshot.memberships = [CUSTOMER_ID, OTHER_CUSTOMER_ID].map((customerId) => ({ customerId, roles: ['CUSTOMER_ADMIN'] }))
  snapshot.resolvedPermissions = { platform: { roleKeys: [], permissions: [] }, tenants: [],
    customers: [CUSTOMER_ID, OTHER_CUSTOMER_ID].map((customerId) => ({ customerId, roleKeys: ['CUSTOMER_ADMIN'], permissions: ['TENANT_VIEW'] })) }
  models.Customer.findById.mockImplementation(async (id) => id === CUSTOMER_ID ? customer : other)
  const inactive = await request.get(`/api/v1/customers/${CUSTOMER_ID}/tenants`).set('Authorization', `Bearer ${accessToken}`)
  expect(inactive.status).toBe(403)
  expect(inactive.body.error.code).toBe('CUSTOMER_INACTIVE')
  const active = await request.get(`/api/v1/customers/${OTHER_CUSTOMER_ID}/tenants`).set('Authorization', `Bearer ${accessToken}`)
  expect(active.status).toBe(200)
  env.governanceInactiveEnforcementEnabled = false
  const compatibility = await request.get(`/api/v1/customers/${CUSTOMER_ID}/tenants`).set('Authorization', `Bearer ${accessToken}`)
  expect(compatibility.status).toBe(200)
})

test('actual super-admin mount sets server-only context while customer URL/header/query cannot bypass status gates', async () => {
  customer.status = 'DISABLED'
  snapshot.platformRoles = ['ROLE_OPERATOR']
  snapshot.memberships = [{ customerId: null, roles: ['ROLE_OPERATOR'] }, { customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }]
  snapshot.resolvedPermissions = { platform: { roleKeys: ['ROLE_OPERATOR'], permissions: ['ROLE_MANAGE'] },
    customers: [{ customerId: CUSTOMER_ID, roleKeys: ['CUSTOMER_ADMIN'], permissions: ['TENANT_VIEW'] }], tenants: [] }
  const platform = await request.get('/api/v1/super-admin/roles/permissions/catalogue').set('Authorization', `Bearer ${accessToken}`)
  expect(platform.status).toBe(200)
  expect(models.Customer.findById).not.toHaveBeenCalled()
  const spoof = await request.get(`/api/v1/customers/${CUSTOMER_ID}/tenants?skipInactiveCustomerCheck=true`)
    .set('Authorization', `Bearer ${accessToken}`).set('skipInactiveCustomerCheck', 'true')
  expect(spoof.status).toBe(403)
  expect(spoof.body.error.code).toBe('CUSTOMER_INACTIVE')
  snapshot.resolvedPermissions.platform.permissions = []
  const denied = await request.get('/api/v1/super-admin/roles/permissions/catalogue').set('Authorization', `Bearer ${accessToken}`)
  expect(denied.status).toBe(403)
})

test('actual ingestion limiter rejects before the large JSON parser', async () => {
  env.nodeEnv = 'development'
  const url = '/api/v1/runtime-instances/boundary-runtime/section-evidence'
  for (let index = 0; index < 10; index += 1) {
    const parsed = await request.patch(url).set('Authorization', `Bearer ${accessToken}`).type('json').send('{')
    expect(parsed.status).toBe(400)
  }
  const throttled = await request.patch(url).set('Authorization', `Bearer ${accessToken}`).type('json').send('{')
  expect(throttled.status).toBe(429)
  expect(throttled.body.error.code).toBe('RATE_LIMIT_EXCEEDED')
  expect(throttled.headers['retry-after']).toBeDefined()
})

test.each([
  [{ code: 11000 }, 500, 'INTERNAL_ERROR'], [{ code: 'ECONNREFUSED' }, 500, 'INTERNAL_ERROR'],
  [{ status: 409, code: 'CONFLICT', message: 'Already exists' }, 409, 'CONFLICT'],
  [{ status: 422, code: 'UNKNOWN_DRIVER_CODE', message: 'Invalid field' }, 422, 'REQUEST_ERROR'],
  [{ status: 200, code: 'OK' }, 500, 'INTERNAL_ERROR'], [{ status: 999 }, 500, 'INTERNAL_ERROR'],
  [{ status: '422' }, 500, 'INTERNAL_ERROR'], [null, 500, 'INTERNAL_ERROR'], ['secret', 500, 'INTERNAL_ERROR'],
])('error boundary normalizes untrusted codes and status values (%p)', (error, status, code) => {
  expect(normalizeHttpError(error)).toMatchObject({ status, code })
})

test('mounted error handler masks internal driver message and emits the stable envelope', async () => {
  const app = express()
  app.get('/failure', (req, _res, next) => {
    req.requestId = 'boundary-failure'
    req.log = { error: jest.fn() }
    next(Object.assign(new Error('database secret address'), { code: 11000 }))
  })
  app.use(errorHandler)
  const original = env.isProduction
  env.isProduction = true
  try {
    const response = await supertest(app).get('/failure')
    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error', requestId: 'boundary-failure' } })
  } finally { env.isProduction = original }
})

test('mounted unmatched and disabled fake-auth routes share the error envelope', async () => {
  const original = env.fakeAuthAllowed
  env.fakeAuthAllowed = false
  try {
    for (const path of ['/api/v1/nonexistent-boundary', '/api/v1/fake-auth/invitations/anything/public']) {
      const response = await request.get(path)
      expect(response.status).toBe(404)
      expect(response.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Not Found', requestId: expect.any(String) })
    }
  } finally { env.fakeAuthAllowed = original }
})
