/**
 * Customer & Tenant Management Tests
 *
 * Integration-style tests for Phase 3.1 endpoints:
 *
 *   Provisioning Service:
 *     - createCustomerWithDefaults (SINGLE_TENANT, MULTI_TENANT)
 *     - createTenantWithDefaults (with/without auto-VMF)
 *
 *   Customer Routes (SUPER_ADMIN):
 *     - GET    /api/v1/customers
 *     - POST   /api/v1/customers
 *     - GET    /api/v1/customers/:customerId
 *     - PATCH  /api/v1/customers/:customerId
 *     - PATCH  /api/v1/customers/:customerId/status
 *     - POST   /api/v1/customers/:customerId/admins
 *
 *   Tenant Routes:
 *     - GET    /api/v1/customers/:customerId/tenants
 *     - POST   /api/v1/customers/:customerId/tenants
 *     - PATCH  /api/v1/tenants/:tenantId
 *     - POST   /api/v1/tenants/:tenantId/enable
 *     - POST   /api/v1/tenants/:tenantId/disable
 *
 *   Validators:
 *     - Customer create / update / status / assignAdmin
 *     - Tenant create / update
 *
 * All Mongoose model statics are monkey-patched; no real database required.
 */

import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals'

/* ------------------------------------------------------------------ */
/*  Environment setup (must run before any app imports)               */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
})

/* ------------------------------------------------------------------ */
/*  Ids                                                               */
/* ------------------------------------------------------------------ */

const USER_ID = '507f1f77bcf86cd799439011'
const USER_ID_2 = '507f1f77bcf86cd799439099'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'
const TENANT_ID_2 = '707f1f77bcf86cd799439044'
const VMF_ID = '807f1f77bcf86cd799439055'

/* ------------------------------------------------------------------ */
/*  Factories                                                         */
/* ------------------------------------------------------------------ */

const makeFakeUser = (overrides = {}) => ({
  _id: USER_ID,
  id: USER_ID,
  email: 'admin@storylineos.com',
  name: 'Super Administrator',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  save: jest.fn(async function () { return this }),
  comparePassword: jest.fn(async () => true),
  toJSON: function () {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      isActive: this.isActive,
      identityPlus: this.identityPlus,
      memberships: this.memberships,
    }
  },
  ...overrides,
})

const makeFakeCustomer = (overrides = {}) => ({
  _id: CUSTOMER_ID,
  id: CUSTOMER_ID,
  name: 'Acme Corp',
  website: null,
  topology: 'MULTI_TENANT',
  vmfPolicy: 'PER_TENANT_MULTI',
  defaultTenantId: null,
  isServiceProvider: false,
  status: 'ACTIVE',
  entitlements: [],
  billing: { planCode: 'PRO', cycle: 'MONTHLY' },
  trial: { isTrial: false },
  createdBy: USER_ID,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  toJSON: function () {
    return {
      id: this._id,
      name: this.name,
      website: this.website,
      topology: this.topology,
      vmfPolicy: this.vmfPolicy,
      defaultTenantId: this.defaultTenantId,
      isServiceProvider: this.isServiceProvider,
      status: this.status,
      entitlements: this.entitlements,
      billing: this.billing,
      trial: this.trial,
    }
  },
  save: jest.fn(async function () { return this }),
  ...overrides,
})

const makeFakeTenant = (overrides = {}) => ({
  _id: TENANT_ID,
  id: TENANT_ID,
  customerId: CUSTOMER_ID,
  name: 'Tenant One',
  website: 'https://tenant1.example',
  status: 'ENABLED',
  isDefault: false,
  tenantAdminUserIds: [USER_ID],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  toJSON: function () {
    return {
      id: this._id,
      customerId: this.customerId,
      name: this.name,
      website: this.website,
      status: this.status,
      isDefault: this.isDefault,
      tenantAdminUserIds: this.tenantAdminUserIds,
    }
  },
  save: jest.fn(async function () { return this }),
  ...overrides,
})

/* ------------------------------------------------------------------ */
/*  Dynamic imports                                                   */
/* ------------------------------------------------------------------ */

let app, request, tokenService
let User, Customer, Tenant, VMF, AuditLog

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  Customer = models.Customer
  Tenant = models.Tenant
  VMF = models.VMF
  AuditLog = models.AuditLog
})

/* ------------------------------------------------------------------ */
/*  Auth helper                                                       */
/* ------------------------------------------------------------------ */

let superAdminToken

const getSuperAdminToken = async () => {
  if (superAdminToken) return superAdminToken
  const user = makeFakeUser()
  const tokens = await tokenService.generateTokens(user)
  superAdminToken = tokens.accessToken
  return superAdminToken
}

const getNonAdminToken = async () => {
  const user = makeFakeUser({
    _id: USER_ID_2,
    id: USER_ID_2,
    email: 'user@example.com',
    name: 'Regular User',
    memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
  })
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

/* ------------------------------------------------------------------ */
/*  Reset stubs before each test                                      */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  User.findById = jest.fn()
  User.findByEmail = jest.fn()
  Customer.findById = jest.fn()
  Customer.findOne = jest.fn()
  Customer.find = jest.fn()
  Customer.countDocuments = jest.fn()
  Tenant.findById = jest.fn()
  Tenant.find = jest.fn()
  Tenant.countDocuments = jest.fn()
  VMF.findById = jest.fn()
  VMF.countByTenant = jest.fn()
  AuditLog.createLog = jest.fn(async () => ({}))

  Customer.findOne.mockResolvedValue(null)

  // Default: loadScopes finds a SUPER_ADMIN user
  User.findById.mockImplementation((id) => {
    if (id === USER_ID || id === superAdminToken) {
      return Promise.resolve(makeFakeUser())
    }
    if (id === USER_ID_2) {
      return Promise.resolve(
        makeFakeUser({
          _id: USER_ID_2,
          id: USER_ID_2,
          memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
        }),
      )
    }
    return Promise.resolve(null)
  })
})

/* ================================================================== */
/*  CUSTOMER VALIDATOR TESTS                                          */
/* ================================================================== */

describe('Customer Validators', () => {
  describe('POST /api/v1/customers — validation', () => {
    test('returns 422 when name is missing', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          topology: 'SINGLE_TENANT',
          vmfPolicy: 'SINGLE',
          billing: { planCode: 'FREE' },
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('name')
    })

    test('returns 422 when topology is invalid', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Corp',
          topology: 'INVALID',
          vmfPolicy: 'SINGLE',
          billing: { planCode: 'FREE' },
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('topology')
    })

    test('returns 422 when topology/vmfPolicy mismatch', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Corp',
          topology: 'SINGLE_TENANT',
          vmfPolicy: 'PER_TENANT_SINGLE',
          billing: { planCode: 'FREE' },
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('vmfPolicy')
    })

    test('returns 422 when billing is missing', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Corp',
          topology: 'SINGLE_TENANT',
          vmfPolicy: 'SINGLE',
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when trial.isTrial=true but no endsAt', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Corp',
          topology: 'SINGLE_TENANT',
          vmfPolicy: 'SINGLE',
          billing: { planCode: 'FREE' },
          trial: { isTrial: true },
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })

  describe('PATCH /api/v1/customers/:customerId — validation', () => {
    test('returns 422 when name is empty string', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .patch(`/api/v1/customers/${CUSTOMER_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })

  describe('PATCH /api/v1/customers/:customerId/status — validation', () => {
    test('returns 422 when status is invalid', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .patch(`/api/v1/customers/${CUSTOMER_ID}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'BOGUS' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('status')
    })
  })

  describe('POST /api/v1/customers/:customerId/admins — validation', () => {
    test('returns 422 when userId is not a valid ObjectId', async () => {
      const token = await getSuperAdminToken()
      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: 'not-an-objectid' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('userId')
    })
  })
})

/* ================================================================== */
/*  TENANT VALIDATOR TESTS                                            */
/* ================================================================== */

describe('Tenant Validators', () => {
  describe('POST /api/v1/customers/:customerId/tenants — validation', () => {
    test('returns 422 when name is missing', async () => {
      const token = await getSuperAdminToken()
      // requireCustomerAccess needs Customer.findById
      Customer.findById.mockResolvedValue(makeFakeCustomer())

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          website: 'https://t.example',
          tenantAdminUserIds: [USER_ID],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('name')
    })

    test('returns 422 when website is not a URL', async () => {
      const token = await getSuperAdminToken()
      Customer.findById.mockResolvedValue(makeFakeCustomer())

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Tenant 2',
          website: 'not-a-url',
          tenantAdminUserIds: [USER_ID],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('website')
    })

    test('returns 422 when tenantAdminUserIds is empty', async () => {
      const token = await getSuperAdminToken()
      Customer.findById.mockResolvedValue(makeFakeCustomer())

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Tenant 2',
          website: 'https://t.example',
          tenantAdminUserIds: [],
        })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })
})

/* ================================================================== */
/*  AUTH / AUTHORIZATION GUARDS                                       */
/* ================================================================== */

describe('Authorization guards', () => {
  test('customer routes return 401 without auth token', async () => {
    const res = await request.get('/api/v1/customers')
    expect(res.status).toBe(401)
  })

  test('customer routes return 403 for non-SUPER_ADMIN', async () => {
    const token = await getNonAdminToken()
    const res = await request
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  test('tenant CRUD routes return 401 without auth token', async () => {
    const res = await request.get(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
    expect(res.status).toBe(401)
  })

  test('tenant admin routes return 401 without auth token', async () => {
    const res = await request.patch(`/api/v1/tenants/${TENANT_ID}`)
    expect(res.status).toBe(401)
  })
})

/* ================================================================== */
/*  CUSTOMER CRUD                                                     */
/* ================================================================== */

describe('GET /api/v1/customers', () => {
  test('returns paginated customer list', async () => {
    const token = await getSuperAdminToken()
    const customers = [makeFakeCustomer()]

    Customer.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(customers),
          }),
        }),
      }),
    })
    Customer.countDocuments.mockResolvedValue(1)

    const res = await request
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.total).toBe(1)
    expect(res.body.meta.page).toBe(1)
  })

  test('supports status filter', async () => {
    const token = await getSuperAdminToken()

    Customer.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    Customer.countDocuments.mockResolvedValue(0)

    const res = await request
      .get('/api/v1/customers?status=DISABLED')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Customer.find).toHaveBeenCalled()
  })
})

describe('POST /api/v1/customers', () => {
  test('returns 409 when customer name already exists (case-insensitive)', async () => {
    const token = await getSuperAdminToken()
    Customer.findOne.mockResolvedValue(makeFakeCustomer({ name: 'Acme Corp' }))

    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '  ACME CORP  ',
        topology: 'MULTI_TENANT',
        vmfPolicy: 'PER_TENANT_MULTI',
        billing: { planCode: 'PRO', cycle: 'MONTHLY' },
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.message).toContain('already exists')
    expect(Customer.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          expect.objectContaining({ nameNormalized: 'acme corp' }),
        ]),
      }),
    )
  })

  test('creates a multi-tenant customer successfully', async () => {
    const token = await getSuperAdminToken()

    // The provisioningService calls `new Customer()` then `.save()`.
    // We need to mock the Customer constructor. Since we can't easily mock
    // Mongoose constructors, we'll mock .save() on the prototype.
    const savedCustomer = makeFakeCustomer()
    const origPrototypeSave = Customer.prototype.save
    Customer.prototype.save = jest.fn(async function () {
      Object.assign(this, savedCustomer)
      this.toJSON = savedCustomer.toJSON.bind(savedCustomer)
      return this
    })

    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Acme Corp',
        topology: 'MULTI_TENANT',
        vmfPolicy: 'PER_TENANT_MULTI',
        billing: { planCode: 'PRO', cycle: 'MONTHLY' },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.customer).toBeDefined()
    expect(res.body.data.customer.name).toBe('Acme Corp')
    // Multi-tenant: no auto-tenant
    expect(res.body.data.tenant).toBeUndefined()

    Customer.prototype.save = origPrototypeSave
  })

  test('creates a customer with optional website', async () => {
    const token = await getSuperAdminToken()

    const savedCustomer = makeFakeCustomer({
      name: 'Acme Corp',
      website: 'https://acme.example',
    })
    const origPrototypeSave = Customer.prototype.save
    Customer.prototype.save = jest.fn(async function () {
      Object.assign(this, savedCustomer)
      this.toJSON = savedCustomer.toJSON.bind(savedCustomer)
      return this
    })

    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Acme Corp',
        website: 'https://acme.example',
        topology: 'MULTI_TENANT',
        vmfPolicy: 'PER_TENANT_MULTI',
        billing: { planCode: 'PRO', cycle: 'MONTHLY' },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.customer.website).toBe('https://acme.example')

    Customer.prototype.save = origPrototypeSave
  })

  test('creates a single-tenant customer with default tenant + VMF', async () => {
    const token = await getSuperAdminToken()

    const savedCustomer = makeFakeCustomer({
      topology: 'SINGLE_TENANT',
      vmfPolicy: 'SINGLE',
      defaultTenantId: TENANT_ID,
    })
    const savedTenant = makeFakeTenant({ isDefault: true })
    const savedVmf = {
      _id: VMF_ID,
      name: 'VMF 1',
      status: 'ACTIVE',
      toJSON: function () {
        return { id: this._id, name: this.name, status: this.status }
      },
    }

    // Track save calls by model type
    let saveCallIndex = 0
    const saveMocks = [
      // 1st save: Tenant (default)
      async function () {
        Object.assign(this, savedTenant)
        this.toJSON = savedTenant.toJSON.bind(savedTenant)
        return this
      },
      // 2nd save: Customer
      async function () {
        Object.assign(this, savedCustomer)
        this.toJSON = savedCustomer.toJSON.bind(savedCustomer)
        return this
      },
      // 3rd save: VMF
      async function () {
        Object.assign(this, savedVmf)
        this.toJSON = savedVmf.toJSON.bind(savedVmf)
        return this
      },
    ]

    const origCustomerSave = Customer.prototype.save
    const origTenantSave = Tenant.prototype.save
    const origVmfSave = VMF.prototype.save

    Customer.prototype.save = jest.fn(async function () {
      const fn = saveMocks[saveCallIndex++]
      if (fn) await fn.call(this)
      return this
    })
    Tenant.prototype.save = Customer.prototype.save
    VMF.prototype.save = Customer.prototype.save

    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Solo Corp',
        topology: 'SINGLE_TENANT',
        vmfPolicy: 'SINGLE',
        billing: { planCode: 'FREE' },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.customer).toBeDefined()
    expect(res.body.data.tenant).toBeDefined()
    expect(res.body.data.vmf).toBeDefined()

    Customer.prototype.save = origCustomerSave
    Tenant.prototype.save = origTenantSave
    VMF.prototype.save = origVmfSave
  })
})

describe('GET /api/v1/customers/:customerId', () => {
  test('returns 404 when customer does not exist', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('returns customer on success', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(CUSTOMER_ID)
    expect(res.body.data.name).toBe('Acme Corp')
  })
})

describe('PATCH /api/v1/customers/:customerId', () => {
  test('returns 404 when customer does not exist', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' })

    expect(res.status).toBe(404)
  })

  test('updates customer name', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed Corp' })

    expect(res.status).toBe(200)
    expect(customer.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('updates customer website', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ website: 'https://updated-company.example' })

    expect(res.status).toBe(200)
    expect(customer.website).toBe('https://updated-company.example')
    expect(customer.save).toHaveBeenCalled()
  })

  test('returns 409 when renaming to an existing customer name (case-insensitive)', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer({ _id: CUSTOMER_ID, id: CUSTOMER_ID, name: 'Current Corp' })
    Customer.findById.mockResolvedValue(customer)
    Customer.findOne.mockResolvedValue(
      makeFakeCustomer({ _id: '607f1f77bcf86cd799439088', id: '607f1f77bcf86cd799439088', name: 'Acme Corp' }),
    )

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '  ACME corp  ' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.message).toContain('already exists')
    expect(customer.save).not.toHaveBeenCalled()
    expect(Customer.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $ne: CUSTOMER_ID },
        $or: expect.arrayContaining([
          expect.objectContaining({ nameNormalized: 'acme corp' }),
        ]),
      }),
    )
  })
})

describe('PATCH /api/v1/customers/:customerId/status', () => {
  test('returns 404 when customer does not exist', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DISABLED' })

    expect(res.status).toBe(404)
  })

  test('updates customer status to DISABLED', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DISABLED' })

    expect(res.status).toBe(200)
    expect(customer.status).toBe('DISABLED')
    expect(customer.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('updates customer status to ARCHIVED', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer()
    Customer.findById.mockResolvedValue(customer)

    const res = await request
      .patch(`/api/v1/customers/${CUSTOMER_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARCHIVED' })

    expect(res.status).toBe(200)
    expect(customer.status).toBe('ARCHIVED')
  })
})

describe('POST /api/v1/customers/:customerId/admins', () => {
  test('returns 404 when customer does not exist', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(null)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: USER_ID_2 })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('returns 404 when user does not exist', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    // Override findById to only return SUPER_ADMIN for loadScopes,
    // then null for the target user
    let callCount = 0
    User.findById.mockImplementation((id) => {
      callCount++
      // First call = loadScopes (SUPER_ADMIN), subsequent = target user lookup
      if (id === USER_ID) return Promise.resolve(makeFakeUser())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: USER_ID_2 })

    expect(res.status).toBe(404)
  })

  test('returns 422 when user is disabled', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())
    User.findById.mockImplementation((id) => {
      if (id === USER_ID) return Promise.resolve(makeFakeUser())
      return Promise.resolve(makeFakeUser({ _id: USER_ID_2, isActive: false }))
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: USER_ID_2 })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })

  test('assigns CUSTOMER_ADMIN to user with no existing membership', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const targetUser = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      memberships: [],
    })
    User.findById.mockImplementation((id) => {
      if (id === USER_ID) return Promise.resolve(makeFakeUser())
      return Promise.resolve(targetUser)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: USER_ID_2 })

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('Admin role assigned')
    expect(targetUser.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('adds CUSTOMER_ADMIN role to existing membership', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const targetUser = makeFakeUser({
      _id: USER_ID_2,
      id: USER_ID_2,
      memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
    })
    User.findById.mockImplementation((id) => {
      if (id === USER_ID) return Promise.resolve(makeFakeUser())
      return Promise.resolve(targetUser)
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/admins`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: USER_ID_2 })

    expect(res.status).toBe(200)
    expect(targetUser.memberships[0].roles).toContain('CUSTOMER_ADMIN')
  })
})

/* ================================================================== */
/*  TENANT CRUD                                                       */
/* ================================================================== */

describe('GET /api/v1/customers/:customerId/tenants', () => {
  test('returns paginated tenant list', async () => {
    const token = await getSuperAdminToken()

    // requireCustomerAccess loads customer
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const tenants = [makeFakeTenant()]
    Tenant.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(tenants),
          }),
        }),
      }),
    })
    Tenant.countDocuments.mockResolvedValue(1)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.total).toBe(1)
  })
})

describe('POST /api/v1/customers/:customerId/tenants', () => {
  test('returns 422 for single-tenant customer', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({ topology: 'SINGLE_TENANT', vmfPolicy: 'SINGLE' }),
    )

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Extra Tenant',
        website: 'https://extra.example',
        tenantAdminUserIds: [USER_ID],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('TOPOLOGY_CONSTRAINT')
  })

  test('creates tenant for multi-tenant customer', async () => {
    const token = await getSuperAdminToken()
    Customer.findById.mockResolvedValue(makeFakeCustomer())

    const savedTenant = makeFakeTenant({ name: 'New Tenant' })
    const savedVmf = {
      _id: VMF_ID,
      name: 'VMF 1',
      status: 'ACTIVE',
      toJSON: function () {
        return { id: this._id, name: this.name, status: this.status }
      },
    }

    let saveIdx = 0
    const origTenantSave = Tenant.prototype.save
    const origVmfSave = VMF.prototype.save

    Tenant.prototype.save = jest.fn(async function () {
      Object.assign(this, savedTenant)
      this.toJSON = savedTenant.toJSON.bind(savedTenant)
      return this
    })

    VMF.prototype.save = jest.fn(async function () {
      Object.assign(this, savedVmf)
      this.toJSON = savedVmf.toJSON.bind(savedVmf)
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Tenant',
        website: 'https://newtenant.example',
        tenantAdminUserIds: [USER_ID],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.tenant).toBeDefined()
    // PER_TENANT_MULTI → auto-create VMF
    expect(res.body.data.vmf).toBeDefined()

    Tenant.prototype.save = origTenantSave
    VMF.prototype.save = origVmfSave
  })
})

describe('PATCH /api/v1/tenants/:tenantId', () => {
  test('returns 404 when tenant does not exist', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('updates tenant name', async () => {
    const token = await getSuperAdminToken()
    const tenant = makeFakeTenant()
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .patch(`/api/v1/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Tenant' })

    expect(res.status).toBe(200)
    expect(tenant.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('updates tenant website', async () => {
    const token = await getSuperAdminToken()
    const tenant = makeFakeTenant()
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .patch(`/api/v1/tenants/${TENANT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ website: 'https://updated.example' })

    expect(res.status).toBe(200)
    expect(tenant.website).toBe('https://updated.example')
  })
})

describe('POST /api/v1/tenants/:tenantId/enable', () => {
  test('returns 404 when tenant does not exist', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(null)

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('returns 200 when tenant is already enabled', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'ENABLED' }))

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.meta.message).toContain('already enabled')
  })

  test('returns 422 when tenant is archived', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'ARCHIVED' }))

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('Archived')
  })

  test('enables a disabled tenant', async () => {
    const token = await getSuperAdminToken()
    const tenant = makeFakeTenant({ status: 'DISABLED' })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/enable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(tenant.status).toBe('ENABLED')
    expect(tenant.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })
})

describe('POST /api/v1/tenants/:tenantId/disable', () => {
  test('returns 404 when tenant does not exist', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(null)

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('returns 422 when trying to disable default tenant', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ isDefault: true }))

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('Default tenants')
  })

  test('returns 200 when tenant is already disabled', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'DISABLED' }))

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.meta.message).toContain('already disabled')
  })

  test('returns 422 when tenant is archived', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'ARCHIVED' }))

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('Archived')
  })

  test('disables an enabled tenant', async () => {
    const token = await getSuperAdminToken()
    const tenant = makeFakeTenant({ status: 'ENABLED' })
    Tenant.findById.mockResolvedValue(tenant)

    const res = await request
      .post(`/api/v1/tenants/${TENANT_ID}/disable`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(tenant.status).toBe('DISABLED')
    expect(tenant.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  PROVISIONING SERVICE — UNIT TESTS                                 */
/* ================================================================== */

describe('Provisioning Service', () => {
  let createCustomerWithDefaults, createTenantWithDefaults

  beforeAll(async () => {
    const svc = await import('../services/provisioningService.js')
    createCustomerWithDefaults = svc.createCustomerWithDefaults
    createTenantWithDefaults = svc.createTenantWithDefaults
  })

  describe('createCustomerWithDefaults', () => {
    test('multi-tenant creates customer only (no tenant/VMF)', async () => {
      const origSave = Customer.prototype.save
      Customer.prototype.save = jest.fn(async function () { return this })

      const result = await createCustomerWithDefaults(
        {
          name: 'Multi Corp',
          topology: 'MULTI_TENANT',
          vmfPolicy: 'PER_TENANT_SINGLE',
          billing: { planCode: 'PRO' },
        },
        USER_ID,
      )

      expect(result.customer).toBeDefined()
      expect(result.tenant).toBeNull()
      expect(result.vmf).toBeNull()

      Customer.prototype.save = origSave
    })

    test('single-tenant creates customer + default tenant + VMF 1', async () => {
      const origCSave = Customer.prototype.save
      const origTSave = Tenant.prototype.save
      const origVSave = VMF.prototype.save

      Customer.prototype.save = jest.fn(async function () { return this })
      Tenant.prototype.save = jest.fn(async function () { return this })
      VMF.prototype.save = jest.fn(async function () { return this })

      const result = await createCustomerWithDefaults(
        {
          name: 'Single Corp',
          topology: 'SINGLE_TENANT',
          vmfPolicy: 'SINGLE',
          billing: { planCode: 'FREE' },
        },
        USER_ID,
      )

      expect(result.customer).toBeDefined()
      expect(result.tenant).toBeDefined()
      expect(result.vmf).toBeDefined()

      Customer.prototype.save = origCSave
      Tenant.prototype.save = origTSave
      VMF.prototype.save = origVSave
    })
  })

  describe('createTenantWithDefaults', () => {
    test('creates tenant with auto VMF for PER_TENANT_SINGLE policy', async () => {
      const origTSave = Tenant.prototype.save
      const origVSave = VMF.prototype.save

      Tenant.prototype.save = jest.fn(async function () { return this })
      VMF.prototype.save = jest.fn(async function () { return this })

      const customer = makeFakeCustomer({ vmfPolicy: 'PER_TENANT_SINGLE' })
      const result = await createTenantWithDefaults(
        {
          name: 'New Tenant',
          website: 'https://nt.example',
          tenantAdminUserIds: [USER_ID],
        },
        customer,
        USER_ID,
      )

      expect(result.tenant).toBeDefined()
      expect(result.vmf).toBeDefined()

      Tenant.prototype.save = origTSave
      VMF.prototype.save = origVSave
    })

    test('creates tenant without VMF for non-PER_TENANT policy', async () => {
      const origTSave = Tenant.prototype.save

      Tenant.prototype.save = jest.fn(async function () { return this })

      // Use a topology that doesn't auto-create VMFs
      const customer = makeFakeCustomer({
        topology: 'SINGLE_TENANT',
        vmfPolicy: 'SINGLE',
      })
      const result = await createTenantWithDefaults(
        {
          name: 'New Tenant',
          website: 'https://nt.example',
          tenantAdminUserIds: [USER_ID],
        },
        customer,
        USER_ID,
      )

      expect(result.tenant).toBeDefined()
      expect(result.vmf).toBeNull()

      Tenant.prototype.save = origTSave
    })
  })
})
