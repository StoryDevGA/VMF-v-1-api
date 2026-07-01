/**
 * VMF & Deal Management Tests
 *
 * Integration-style tests for Phase 3.3 endpoints:
 *
 *   VMF Routes (Tenant-scoped — TENANT_ADMIN / CUSTOMER_ADMIN):
 *     - GET    /api/v1/customers/:customerId/tenants/:tenantId/vmfs
 *     - POST   /api/v1/customers/:customerId/tenants/:tenantId/vmfs
 *
 *   VMF Routes (VMF-scoped — requireVmfAccess):
 *     - GET    /api/v1/vmfs/:vmfId
 *     - PATCH  /api/v1/vmfs/:vmfId
 *     - DELETE /api/v1/vmfs/:vmfId
 *     - POST   /api/v1/vmfs/:vmfId/grants
 *     - DELETE /api/v1/vmfs/:vmfId/grants/:userId
 *
 *   Deal Routes (VMF-scoped):
 *     - GET    /api/v1/vmfs/:vmfId/deals
 *     - POST   /api/v1/vmfs/:vmfId/deals
 *
 *   Deal Routes (Deal-scoped — hybrid capability + VMF grant access):
 *     - GET    /api/v1/deals/:dealId
 *     - PATCH  /api/v1/deals/:dealId
 *     - DELETE /api/v1/deals/:dealId
 *
 *   Validators:
 *     - VMF create / update / grantAccess
 *     - Deal create / update
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

const SUPER_ADMIN_ID = '507f1f77bcf86cd799439011'
const CUSTOMER_ADMIN_ID = '507f1f77bcf86cd799439012'
const TENANT_ADMIN_ID = '507f1f77bcf86cd799439013'
const REGULAR_USER_ID = '507f1f77bcf86cd799439014'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'
const VMF_ID = '807f1f77bcf86cd799439055'
const VMF_ID_2 = '807f1f77bcf86cd799439066'
const DEAL_ID = '907f1f77bcf86cd799439077'
const POLICY_ID = '917f1f77bcf86cd799439088'
const FRAMEWORK_PACKAGE_ID = '927f1f77bcf86cd799439099'
const FRAMEWORK_PACKAGE_ID_2 = '927f1f77bcf86cd799439100'
const RUNTIME_DEPLOYMENT_ID = 'runtime-deployment-vmf-active-package'
const RUNTIME_ACTIVATION_ID = 'runtime-activation-vmf-active-package'
const DEPENDENCY_SNAPSHOT_ID = 'dependency-snapshot-vmf-active-package'
const DEPENDENCY_SNAPSHOT_HASH = 'dependency-snapshot-hash-vmf-active-package'

/* ------------------------------------------------------------------ */
/*  Factories                                                         */
/* ------------------------------------------------------------------ */

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
  save: jest.fn(async function () { return this }),
  toJSON: function () {
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

const makeCustomerAdmin = (overrides = {}) => ({
  _id: CUSTOMER_ADMIN_ID,
  id: CUSTOMER_ADMIN_ID,
  email: 'custadmin@acme.com',
  name: 'Customer Admin',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] }],
  tenantMemberships: [],
  vmfGrants: [],
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      memberships: this.memberships,
    }
  },
  ...overrides,
})

const makeTenantAdmin = (overrides = {}) => ({
  _id: TENANT_ADMIN_ID,
  id: TENANT_ADMIN_ID,
  email: 'tenantadmin@acme.com',
  name: 'Tenant Admin',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
  tenantMemberships: [
    { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['TENANT_ADMIN'] },
  ],
  vmfGrants: [],
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      memberships: this.memberships,
      tenantMemberships: this.tenantMemberships,
    }
  },
  ...overrides,
})

const makeCustomerScopedTenantAdmin = (overrides = {}) => ({
  ...makeTenantAdmin(),
  memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
  tenantMemberships: [
    { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
  ],
  ...overrides,
})

const makeRegularUser = (overrides = {}) => ({
  _id: REGULAR_USER_ID,
  id: REGULAR_USER_ID,
  email: 'user@acme.com',
  name: 'Regular User',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: CUSTOMER_ID, roles: ['USER'] }],
  tenantMemberships: [
    { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
  ],
  vmfGrants: [],
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return {
      id: this._id,
      email: this.email,
      name: this.name,
      memberships: this.memberships,
    }
  },
  ...overrides,
})

const makeFakeCustomer = (overrides = {}) => ({
  _id: CUSTOMER_ID,
  id: CUSTOMER_ID,
  name: 'Acme Corp',
  topology: 'MULTI_TENANT',
  vmfPolicy: 'PER_TENANT_MULTI',
  governance: {
    maxTenants: 10,
    maxVmfsPerTenant: 10,
    customerAdminUserId: null,
  },
  defaultTenantId: null,
  isServiceProvider: false,
  status: 'ACTIVE',
  entitlements: [],
  billing: { planCode: 'PRO', cycle: 'MONTHLY' },
  save: jest.fn(async function () { return this }),
  toJSON: function () {
    return { id: this._id, name: this.name, topology: this.topology, vmfPolicy: this.vmfPolicy }
  },
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
  tenantAdminUserIds: [TENANT_ADMIN_ID],
  toJSON: function () {
    return { id: this._id, customerId: this.customerId, name: this.name, status: this.status }
  },
  save: jest.fn(async function () { return this }),
  ...overrides,
})

const makeFakeVmf = (overrides = {}) => ({
  _id: VMF_ID,
  id: VMF_ID,
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  name: 'VMF 1',
  description: 'Default VMF description',
  status: 'ACTIVE',
  lifecycleStatus: 'DRAFT',
  frameworkPackageId: null,
  frameworkVersion: '2.2',
  versionPolicyId: POLICY_ID,
  deletedAt: null,
  purgeAfter: null,
  createdBy: SUPER_ADMIN_ID,
  toJSON: function () {
    return {
      id: this._id,
      customerId: this.customerId,
      tenantId: this.tenantId,
      name: this.name,
      description: this.description,
      status: this.status,
      lifecycleStatus: this.lifecycleStatus,
      frameworkPackageId: this.frameworkPackageId,
      frameworkVersion: this.frameworkVersion,
      versionPolicyId: this.versionPolicyId,
      deletedAt: this.deletedAt,
      purgeAfter: this.purgeAfter,
    }
  },
  save: jest.fn(async function () { return this }),
  ...overrides,
})

const makeActivePolicy = (overrides = {}) => ({
  _id: POLICY_ID,
  id: POLICY_ID,
  version: 5,
  rules: {
    frameworkVersion: '2.2',
  },
  isActive: true,
  ...overrides,
})

const makeFrameworkPackage = (overrides = {}) => ({
  _id: FRAMEWORK_PACKAGE_ID,
  id: FRAMEWORK_PACKAGE_ID,
  frameworkKey: 'VMF',
  frameworkName: 'Value Management Framework',
  packageName: 'VMF Active Package',
  packageKey: 'vmf-active-package',
  version: '2.3.1',
  status: 'ACTIVE',
  isDefault: true,
  visibility: 'CUSTOMER_VISIBLE',
  customerAccessMode: 'ALL_CUSTOMERS',
  assignedCustomerIds: [],
  compatibleWorkflowKeys: ['vmf-publish'],
  defaultAgentIds: ['agent-validator'],
  requiredSkillIds: ['skill-snapshot'],
  capabilities: {
    supportsPreviewMode: true,
    supportsFullReport: true,
    requiresValidationBeforePublish: true,
  },
  validationRules: {
    requiredSections: ['overview'],
    publishChecks: ['validation-pass'],
  },
  dependencyLock: {
    status: 'PASS',
    snapshotId: DEPENDENCY_SNAPSHOT_ID,
    snapshotHash: DEPENDENCY_SNAPSHOT_HASH,
    references: [
      {
        collectionKey: 'RuntimeSkill',
        stableId: 'skill-snapshot',
        componentVersion: '1.0.0',
      },
    ],
  },
  updatedAt: '2026-04-09T12:00:00.000Z',
  ...overrides,
})

const makeRuntimeDeployment = (overrides = {}) => ({
  _id: RUNTIME_DEPLOYMENT_ID,
  deploymentId: RUNTIME_DEPLOYMENT_ID,
  activationId: RUNTIME_ACTIVATION_ID,
  packageId: FRAMEWORK_PACKAGE_ID,
  frameworkKey: 'VMF',
  status: 'ACTIVE',
  ...overrides,
})

const makeRuntimeActivationSnapshot = (overrides = {}) => ({
  _id: RUNTIME_ACTIVATION_ID,
  activationId: RUNTIME_ACTIVATION_ID,
  deploymentId: RUNTIME_DEPLOYMENT_ID,
  packageId: FRAMEWORK_PACKAGE_ID,
  frameworkKey: 'VMF',
  activationStatus: 'ACTIVE',
  dependencySnapshotId: DEPENDENCY_SNAPSHOT_ID,
  dependencySnapshotHash: DEPENDENCY_SNAPSHOT_HASH,
  ...overrides,
})

const makeRoleDefinition = (key, scope, permissions = []) => ({
  key,
  scope,
  permissions,
  isActive: true,
})

const makeFakeDeal = (overrides = {}) => ({
  _id: DEAL_ID,
  id: DEAL_ID,
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  vmfId: VMF_ID,
  title: 'Test Deal',
  stage: 'Discovery',
  data: { amount: 10000 },
  status: 'ACTIVE',
  createdBy: SUPER_ADMIN_ID,
  toJSON: function () {
    return {
      id: this._id,
      vmfId: this.vmfId,
      title: this.title,
      stage: this.stage,
      data: this.data,
      status: this.status,
    }
  },
  save: jest.fn(async function () { return this }),
  ...overrides,
})

/* ------------------------------------------------------------------ */
/*  Dynamic imports                                                   */
/* ------------------------------------------------------------------ */

let app, request, tokenService, performanceCacheService
let User, Customer, Tenant, VMF, Deal, AuditLog, SystemVersioningPolicy, Role, FrameworkPackage
let RuntimeDeployment, RuntimeActivationSnapshot

beforeAll(async () => {
  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  performanceCacheService = (await import('../services/performanceCacheService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  Customer = models.Customer
  Tenant = models.Tenant
  VMF = models.VMF
  Deal = models.Deal
  AuditLog = models.AuditLog
  SystemVersioningPolicy = models.SystemVersioningPolicy
  Role = models.Role
  FrameworkPackage = models.FrameworkPackage
  RuntimeDeployment = models.RuntimeDeployment
  RuntimeActivationSnapshot = models.RuntimeActivationSnapshot
})

const makeDefaultRoleDefinitions = () => ([
  makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
  makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
  makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
  makeRoleDefinition('USER', 'VMF', ['VMF_VIEW']),
])

const setRoleDefinitions = (definitions = makeDefaultRoleDefinitions()) => {
  Role.find = jest.fn().mockResolvedValue(definitions)
}

/* ------------------------------------------------------------------ */
/*  Auth helpers                                                      */
/* ------------------------------------------------------------------ */

let superAdminToken, customerAdminToken, tenantAdminToken, regularUserToken

const getSuperAdminToken = async () => {
  if (superAdminToken) return superAdminToken
  const tokens = await tokenService.generateTokens(makeSuperAdmin())
  superAdminToken = tokens.accessToken
  return superAdminToken
}

const getCustomerAdminToken = async () => {
  if (customerAdminToken) return customerAdminToken
  const tokens = await tokenService.generateTokens(makeCustomerAdmin())
  customerAdminToken = tokens.accessToken
  return customerAdminToken
}

const getTenantAdminToken = async () => {
  if (tenantAdminToken) return tenantAdminToken
  const tokens = await tokenService.generateTokens(makeTenantAdmin())
  tenantAdminToken = tokens.accessToken
  return tenantAdminToken
}

const getRegularUserToken = async () => {
  if (regularUserToken) return regularUserToken
  const tokens = await tokenService.generateTokens(makeRegularUser())
  regularUserToken = tokens.accessToken
  return regularUserToken
}

/* ------------------------------------------------------------------ */
/*  Reset stubs before each test                                      */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  performanceCacheService.resetForTests()

  User.findById = jest.fn()
  User.findOne = jest.fn()
  User.updateMany = jest.fn(async () => ({ modifiedCount: 0 }))
  Customer.findById = jest.fn()
  Customer.findById.mockResolvedValue(makeFakeCustomer())
  Tenant.findById = jest.fn()
  VMF.findById = jest.fn()
  VMF.findById.mockResolvedValue(makeFakeVmf())
  VMF.find = jest.fn()
  VMF.countDocuments = jest.fn()
  VMF.countByTenant = jest.fn()
  VMF.deleteOne = jest.fn(async () => ({ deletedCount: 1 }))
  SystemVersioningPolicy.findActive = jest.fn().mockResolvedValue(null)
  FrameworkPackage.findById = jest.fn().mockResolvedValue(null)
  FrameworkPackage.find = jest.fn().mockResolvedValue([])
  FrameworkPackage.countDocuments = jest.fn().mockResolvedValue(0)
  FrameworkPackage.findActiveByFrameworkKey = jest.fn().mockResolvedValue(null)
  RuntimeDeployment.find = jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue([]),
  })
  RuntimeActivationSnapshot.find = jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue([]),
  })
  Deal.findById = jest.fn()
  Deal.find = jest.fn()
  Deal.countDocuments = jest.fn()
  Deal.updateMany = jest.fn(async () => ({ modifiedCount: 0 }))
  AuditLog.createLog = jest.fn(async () => ({}))
  setRoleDefinitions()

  // Default: loadScopes finds the correct user by ID
  User.findById.mockImplementation((id) => {
    if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
    if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
    if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
    if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
    return Promise.resolve(null)
  })
})

/* ================================================================== */
/*  VMF VALIDATOR TESTS                                               */
/* ================================================================== */

describe('VMF Validators', () => {
  describe('POST /…/vmfs — validation', () => {
    test('returns 422 when name is missing', async () => {
      const token = await getSuperAdminToken()
      // requireTenantAccess needs Tenant.findById
      Tenant.findById.mockResolvedValue(makeFakeTenant())
      VMF.countByTenant.mockResolvedValue(0)

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('name')
    })

    test('returns 422 when name is empty string', async () => {
      const token = await getSuperAdminToken()
      Tenant.findById.mockResolvedValue(makeFakeTenant())
      VMF.countByTenant.mockResolvedValue(0)

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when frameworkPackageId is not a valid ObjectId', async () => {
      const token = await getSuperAdminToken()
      Tenant.findById.mockResolvedValue(makeFakeTenant())
      VMF.countByTenant.mockResolvedValue(0)

      const res = await request
        .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'New VMF',
          frameworkPackageId: 'not-an-object-id',
        })

      expect(res.status).toBe(422)
      expect(res.body.error.details.frameworkPackageId).toBe('frameworkPackageId must be a valid ObjectId')
    })
  })

  describe('PATCH /api/v1/vmfs/:vmfId — validation', () => {
    test('returns 422 when body is empty', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .patch(`/api/v1/vmfs/${VMF_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when status is invalid', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .patch(`/api/v1/vmfs/${VMF_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'BOGUS' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when lifecycleStatus is invalid', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .patch(`/api/v1/vmfs/${VMF_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lifecycleStatus: 'READY' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when runtime-control fields are sent to PATCH /vmfs/:vmfId', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .patch(`/api/v1/vmfs/${VMF_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ frameworkPackageId: FRAMEWORK_PACKAGE_ID })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })
  })

  describe('POST /api/v1/vmfs/:vmfId/grants — validation', () => {
    test('returns 422 when userId is missing', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .post(`/api/v1/vmfs/${VMF_ID}/grants`)
        .set('Authorization', `Bearer ${token}`)
        .send({ permissions: ['READ'] })

      expect(res.status).toBe(422)
      expect(res.body.error.details).toHaveProperty('userId')
    })

    test('returns 422 when permissions is empty array', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .post(`/api/v1/vmfs/${VMF_ID}/grants`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: REGULAR_USER_ID, permissions: [] })

      expect(res.status).toBe(422)
      expect(res.body.error.details).toHaveProperty('permissions')
    })
  })
})

/* ================================================================== */
/*  DEAL VALIDATOR TESTS                                              */
/* ================================================================== */

describe('Deal Validators', () => {
  describe('POST /api/v1/vmfs/:vmfId/deals — validation', () => {
    test('returns 422 when title is missing', async () => {
      const token = await getSuperAdminToken()
      VMF.findById.mockResolvedValue(makeFakeVmf())

      const res = await request
        .post(`/api/v1/vmfs/${VMF_ID}/deals`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
      expect(res.body.error.details).toHaveProperty('title')
    })
  })

  describe('PATCH /api/v1/deals/:dealId — validation', () => {
    test('returns 422 when body is empty', async () => {
      const token = await getSuperAdminToken()
      Deal.findById.mockResolvedValue(makeFakeDeal())

      const res = await request
        .patch(`/api/v1/deals/${DEAL_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    test('returns 422 when status is invalid', async () => {
      const token = await getSuperAdminToken()
      Deal.findById.mockResolvedValue(makeFakeDeal())

      const res = await request
        .patch(`/api/v1/deals/${DEAL_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DELETED' })

      expect(res.status).toBe(422)
    })
  })
})

/* ================================================================== */
/*  AUTH / AUTHORIZATION GUARDS                                       */
/* ================================================================== */

describe('VMF/Deal authorization guards', () => {
  test('tenant-scoped VMF routes return 401 without token', async () => {
    const res = await request.get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
    expect(res.status).toBe(401)
  })

  test('VMF-scoped routes return 401 without token', async () => {
    const res = await request.get(`/api/v1/vmfs/${VMF_ID}`)
    expect(res.status).toBe(401)
  })

  test('deal-scoped routes return 401 without token', async () => {
    const res = await request.get(`/api/v1/deals/${DEAL_ID}`)
    expect(res.status).toBe(401)
  })

  test('deal-scoped routes return 403 for callers without hybrid deal access', async () => {
    // Regular user has no DEAL_VIEW capability and no VMF grant — should be denied.
    const token = await getRegularUserToken()
    Deal.findById.mockResolvedValue(makeFakeDeal())

    const res = await request
      .get(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })
})

/* ================================================================== */
/*  LIST VMFs                                                         */
/* ================================================================== */

describe('GET /api/v1/customers/:customerId/tenants/:tenantId/vmfs', () => {
  test('returns paginated VMF list for Super Admin', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0) // topologyGuard + vmfCapacity

    const vmfs = [makeFakeVmf()]
    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(vmfs),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(1)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.total).toBe(1)
    expect(res.body.meta.vmfCapacity).toEqual({
      maxVmfs: 10,
      currentCount: 0,
      remainingCount: 10,
      isAtCapacity: false,
      countMode: 'ACTIVE',
    })
  })

  test('includes bound framework package metadata and runtime-status fields', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)

    const frameworkPackage = makeFrameworkPackage()
    const vmfs = [
      makeFakeVmf({
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        frameworkVersion: '2.3.1',
        versionPolicyId: null,
      }),
    ]

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(vmfs),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(1)
    FrameworkPackage.find.mockResolvedValue([frameworkPackage])
    FrameworkPackage.findActiveByFrameworkKey.mockResolvedValue(frameworkPackage)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0].frameworkPackageId).toBe(FRAMEWORK_PACKAGE_ID)
    expect(res.body.data[0].frameworkPackage.packageName).toBe('VMF Active Package')
    expect(res.body.data[0].frameworkPackage.packageKey).toBe('vmf-active-package')
    expect(res.body.data[0].frameworkPackage.version).toBe('2.3.1')
    expect(res.body.data[0].snapshotStatus).toBe('PACKAGE_BOUND')
    expect(res.body.data[0].completionState).toBe('NOT_TRACKED')
    expect(res.body.data[0].validationStatus).toBe('NOT_RUN')
    expect(res.body.data[0].lockStatus).toBe('UNLOCKED')
    expect(res.body.data[0].migrationAvailable).toBe(false)
  })

  test('resolves legacy frameworkVersion rows to package metadata and flags migration availability', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)

    const resolvedFrameworkPackage = makeFrameworkPackage({
      _id: FRAMEWORK_PACKAGE_ID_2,
      id: FRAMEWORK_PACKAGE_ID_2,
      version: '2.2',
      isDefault: false,
    })
    const activeFrameworkPackage = makeFrameworkPackage({
      _id: FRAMEWORK_PACKAGE_ID,
      id: FRAMEWORK_PACKAGE_ID,
      version: '2.3.1',
      isDefault: true,
    })

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              makeFakeVmf({
                frameworkPackageId: null,
                frameworkVersion: '2.2',
                versionPolicyId: POLICY_ID,
              }),
            ]),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(1)
    FrameworkPackage.find.mockResolvedValue([resolvedFrameworkPackage])
    FrameworkPackage.findActiveByFrameworkKey.mockResolvedValue(activeFrameworkPackage)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0].frameworkPackageId).toBe(FRAMEWORK_PACKAGE_ID_2)
    expect(res.body.data[0].frameworkPackage.version).toBe('2.2')
    expect(res.body.data[0].snapshotStatus).toBe('PACKAGE_INFERRED_FROM_VERSION')
    expect(res.body.data[0].migrationAvailable).toBe(true)
  })

  test('returns VMF list for Tenant Admin', async () => {
    const token = await getTenantAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
    expect(res.body.meta.vmfCapacity?.maxVmfs).toBe(10)
  })

  test('returns VMF list for a regular user with tenant access', async () => {
    const token = await getRegularUserToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
  })

  test('returns VMF list for a customer-scoped tenant admin on a tenant they administer', async () => {
    const scopedTenantAdmin = makeCustomerScopedTenantAdmin()
    const tokens = await tokenService.generateTokens(scopedTenantAdmin)

    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeCustomerScopedTenantAdmin())
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [TENANT_ADMIN_ID] }))
    VMF.countByTenant.mockResolvedValue(0)

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
  })

  test('returns 403 for a regular user when VMF_VIEW is not granted by their resolved tenant roles', async () => {
    const token = await getRegularUserToken()
    setRoleDefinitions([
      makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
      makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('USER', 'VMF', []),
    ])

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.message).toBe("Tenant permission 'VMF_VIEW' is required.")
    expect(Tenant.findById).not.toHaveBeenCalled()
  })

  test('returns VMF list for a single-tenant customer user without tenant membership', async () => {
    const tokens = await tokenService.generateTokens(
      makeRegularUser({ tenantMemberships: [] }),
    )

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({ tenantMemberships: [] }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })
    Customer.findById.mockResolvedValue(
      makeFakeCustomer({
        topology: 'SINGLE_TENANT',
        vmfPolicy: 'SINGLE',
        defaultTenantId: TENANT_ID,
      }),
    )
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
  })

  test('supports search by q param', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)

    VMF.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    VMF.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs?q=test`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(VMF.find).toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  LIST AVAILABLE VMF FRAMEWORK PACKAGES                             */
/* ================================================================== */

describe('GET /api/v1/customers/:customerId/tenants/:tenantId/vmfs/framework-packages', () => {
  test('lists multiple active runtime-ready VMF versions available to the tenant workspace', async () => {
    const token = await getTenantAdminToken()
    const packageRows = [
      makeFrameworkPackage({
        packageName: 'VMF v3.1.1 Runtime Knowledge Model',
        packageKey: 'standard-package-vmf-3-1-1-rkm',
        version: '3.1.1',
        isDefault: true,
        updatedAt: '2026-07-01T12:00:00.000Z',
      }),
      makeFrameworkPackage({
        _id: FRAMEWORK_PACKAGE_ID_2,
        id: FRAMEWORK_PACKAGE_ID_2,
        packageName: 'VMF v3.1 Runtime Knowledge Model',
        packageKey: 'standard-package-vmf-3-1-rkm',
        version: '3.1.0',
        isDefault: false,
        customerAccessMode: 'SELECTED_CUSTOMERS',
        assignedCustomerIds: [CUSTOMER_ID],
        dependencyLock: {
          status: 'PASS',
          snapshotId: 'dependency-snapshot-vmf-v3-1-rkm',
          snapshotHash: 'dependency-snapshot-hash-vmf-v3-1-rkm',
          references: [{ collectionKey: 'RuntimeSkill', stableId: 'skill-vmf-v3-1' }],
        },
        updatedAt: '2026-06-29T18:24:02.000Z',
      }),
    ]
    const sortPackages = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(packageRows),
    })

    Tenant.findById.mockResolvedValue(makeFakeTenant())
    FrameworkPackage.find.mockReturnValue({
      sort: sortPackages,
    })
    RuntimeDeployment.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        makeRuntimeDeployment(),
        makeRuntimeDeployment({
          _id: 'runtime-deployment-vmf-v3-1-rkm',
          deploymentId: 'runtime-deployment-vmf-v3-1-rkm',
          activationId: 'runtime-activation-vmf-v3-1-rkm',
          packageId: FRAMEWORK_PACKAGE_ID_2,
        }),
      ]),
    })
    RuntimeActivationSnapshot.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        makeRuntimeActivationSnapshot(),
        makeRuntimeActivationSnapshot({
          _id: 'runtime-activation-vmf-v3-1-rkm',
          activationId: 'runtime-activation-vmf-v3-1-rkm',
          deploymentId: 'runtime-deployment-vmf-v3-1-rkm',
          packageId: FRAMEWORK_PACKAGE_ID_2,
          dependencySnapshotId: 'dependency-snapshot-vmf-v3-1-rkm',
          dependencySnapshotHash: 'dependency-snapshot-hash-vmf-v3-1-rkm',
        }),
      ]),
    })

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs/framework-packages`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(FrameworkPackage.find).toHaveBeenCalledWith({
      frameworkKey: 'VMF',
      status: 'ACTIVE',
      $or: [
        { isDefault: true },
        {
          visibility: 'CUSTOMER_VISIBLE',
          customerAccessMode: 'ALL_CUSTOMERS',
        },
        {
          visibility: 'CUSTOMER_VISIBLE',
          customerAccessMode: 'SELECTED_CUSTOMERS',
          assignedCustomerIds: CUSTOMER_ID,
        },
      ],
      'dependencyLock.status': 'PASS',
      'dependencyLock.snapshotId': { $exists: true, $nin: [null, ''] },
      'dependencyLock.references.0': { $exists: true },
    })
    expect(sortPackages).toHaveBeenCalledWith({ isDefault: -1, updatedAt: -1, packageName: 1 })
    expect(res.body.data).toEqual([
      expect.objectContaining({
        id: FRAMEWORK_PACKAGE_ID,
        packageName: 'VMF v3.1.1 Runtime Knowledge Model',
        packageKey: 'standard-package-vmf-3-1-1-rkm',
        version: '3.1.1',
        isDefault: true,
        status: 'ACTIVE',
      }),
      expect.objectContaining({
        id: FRAMEWORK_PACKAGE_ID_2,
        packageName: 'VMF v3.1 Runtime Knowledge Model',
        packageKey: 'standard-package-vmf-3-1-rkm',
        version: '3.1.0',
        isDefault: false,
        status: 'ACTIVE',
      }),
    ])
  })

  test('allows VMF_VIEW-only tenant users to list customer-visible VMF packages', async () => {
    const token = await getRegularUserToken()
    const packageRows = [makeFrameworkPackage()]

    Tenant.findById.mockResolvedValue(makeFakeTenant())
    FrameworkPackage.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(packageRows),
      }),
    })
    RuntimeDeployment.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([makeRuntimeDeployment()]),
    })
    RuntimeActivationSnapshot.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([makeRuntimeActivationSnapshot()]),
    })

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs/framework-packages`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      id: FRAMEWORK_PACKAGE_ID,
      packageName: 'VMF Active Package',
      status: 'ACTIVE',
    }))
  })

  test('lists the active default VMF framework package even when it is not customer-visible', async () => {
    const token = await getTenantAdminToken()
    const packageRows = [
      makeFrameworkPackage({
        visibility: 'INTERNAL_ONLY',
        customerAccessMode: 'ALL_CUSTOMERS',
      }),
    ]

    Tenant.findById.mockResolvedValue(makeFakeTenant())
    FrameworkPackage.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(packageRows),
      }),
    })
    RuntimeDeployment.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([makeRuntimeDeployment()]),
    })
    RuntimeActivationSnapshot.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([makeRuntimeActivationSnapshot()]),
    })

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs/framework-packages`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      id: FRAMEWORK_PACKAGE_ID,
      packageName: 'VMF Active Package',
      isDefault: true,
      status: 'ACTIVE',
    }))
  })

  test('does not list active packages that are not runtime-creation ready', async () => {
    const token = await getCustomerAdminToken()
    const runtimeReadyPackage = makeFrameworkPackage({
      _id: FRAMEWORK_PACKAGE_ID_2,
      id: FRAMEWORK_PACKAGE_ID_2,
      packageName: 'Runtime Evidence Package',
      packageKey: 'vmf-runtime-evidence-package',
      version: '2.3.2',
      isDefault: false,
      dependencyLock: {
        status: 'PASS',
        snapshotId: 'dependency-snapshot-runtime-evidence-package',
        snapshotHash: 'dependency-snapshot-hash-runtime-evidence-package',
        references: [{ collectionKey: 'RuntimeSkill', stableId: 'skill-runtime-evidence' }],
      },
    })
    const invalidDefaultPackage = makeFrameworkPackage({
      packageName: 'Default Package Without Evidence',
      dependencyLock: null,
    })
    const mismatchPackage = makeFrameworkPackage({
      _id: '927f1f77bcf86cd799439101',
      id: '927f1f77bcf86cd799439101',
      packageName: 'Mismatched Evidence Package',
      packageKey: 'vmf-mismatched-evidence-package',
      isDefault: false,
      dependencyLock: {
        status: 'PASS',
        snapshotId: 'dependency-snapshot-mismatched-package',
        snapshotHash: 'dependency-snapshot-hash-mismatched-package',
        references: [{ collectionKey: 'RuntimeSkill', stableId: 'skill-mismatch' }],
      },
    })

    Tenant.findById.mockResolvedValue(makeFakeTenant())
    FrameworkPackage.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          invalidDefaultPackage,
          mismatchPackage,
          runtimeReadyPackage,
        ]),
      }),
    })
    RuntimeDeployment.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        makeRuntimeDeployment({
          _id: 'runtime-deployment-mismatched-package',
          deploymentId: 'runtime-deployment-mismatched-package',
          activationId: 'runtime-activation-mismatched-package',
          packageId: '927f1f77bcf86cd799439101',
        }),
        makeRuntimeDeployment({
          _id: 'runtime-deployment-runtime-evidence-package',
          deploymentId: 'runtime-deployment-runtime-evidence-package',
          activationId: 'runtime-activation-runtime-evidence-package',
          packageId: FRAMEWORK_PACKAGE_ID_2,
        }),
      ]),
    })
    RuntimeActivationSnapshot.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        makeRuntimeActivationSnapshot({
          _id: 'runtime-activation-mismatched-package',
          activationId: 'runtime-activation-mismatched-package',
          deploymentId: 'runtime-deployment-mismatched-package',
          packageId: '927f1f77bcf86cd799439101',
          dependencySnapshotId: 'different-snapshot',
          dependencySnapshotHash: 'different-hash',
        }),
        makeRuntimeActivationSnapshot({
          _id: 'runtime-activation-runtime-evidence-package',
          activationId: 'runtime-activation-runtime-evidence-package',
          deploymentId: 'runtime-deployment-runtime-evidence-package',
          packageId: FRAMEWORK_PACKAGE_ID_2,
          dependencySnapshotId: 'dependency-snapshot-runtime-evidence-package',
          dependencySnapshotHash: 'dependency-snapshot-hash-runtime-evidence-package',
        }),
      ]),
    })

    const res = await request
      .get(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs/framework-packages`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([
      expect.objectContaining({
        id: FRAMEWORK_PACKAGE_ID_2,
        packageName: 'Runtime Evidence Package',
        version: '2.3.2',
      }),
    ])
    expect(res.body.meta.total).toBe(1)
  })
})

/* ================================================================== */
/*  CREATE VMF                                                        */
/* ================================================================== */

describe('POST /api/v1/customers/:customerId/tenants/:tenantId/vmfs', () => {
  test('creates VMF against the active framework package by default', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0) // topologyGuard allows
    FrameworkPackage.findActiveByFrameworkKey.mockResolvedValue(makeFrameworkPackage())
    SystemVersioningPolicy.findActive.mockResolvedValue(
      makeActivePolicy({
        rules: { frameworkVersion: '2.3.1' },
      }),
    )

    const origSave = VMF.prototype.save
    VMF.prototype.save = jest.fn(async function () {
      this._id = VMF_ID
      this.id = VMF_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New VMF',
        description: 'Lifecycle-ready VMF',
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toBeDefined()
    expect(res.body.data.name).toBe('New VMF')
    expect(res.body.data.description).toBe('Lifecycle-ready VMF')
    expect(res.body.data.lifecycleStatus).toBe('DRAFT')
    expect(res.body.data.frameworkPackageId).toBe(FRAMEWORK_PACKAGE_ID)
    expect(res.body.data.frameworkVersion).toBe('2.3.1')
    expect(res.body.data.versionPolicyId).toBe(POLICY_ID)
    expect(res.body.data.frameworkPackage.version).toBe('2.3.1')
    expect(res.body.data.snapshotStatus).toBe('PACKAGE_BOUND')
    expect(AuditLog.createLog).toHaveBeenCalled()

    VMF.prototype.save = origSave
  })

  test('falls back to the legacy system versioning snapshot when no active framework package exists', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)
    SystemVersioningPolicy.findActive.mockResolvedValue(makeActivePolicy())

    const origSave = VMF.prototype.save
    VMF.prototype.save = jest.fn(async function () {
      this._id = VMF_ID
      this.id = VMF_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Legacy Snapshot VMF',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.frameworkPackageId).toBeNull()
    expect(res.body.data.frameworkVersion).toBe('2.2')
    expect(res.body.data.versionPolicyId).toBe(POLICY_ID)
    expect(res.body.data.snapshotStatus).toBe('LEGACY_POLICY_ONLY')

    VMF.prototype.save = origSave
  })

  test('accepts an explicit frameworkPackageId when it references an active VMF package', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackage())
    SystemVersioningPolicy.findActive.mockResolvedValue(
      makeActivePolicy({
        rules: { frameworkVersion: '2.3.1' },
      }),
    )

    const origSave = VMF.prototype.save
    VMF.prototype.save = jest.fn(async function () {
      this._id = VMF_ID
      this.id = VMF_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Explicit Package VMF',
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
      })

    expect(res.status).toBe(201)
    expect(res.body.data.frameworkPackageId).toBe(FRAMEWORK_PACKAGE_ID)
    expect(res.body.data.frameworkVersion).toBe('2.3.1')
    expect(res.body.data.snapshotStatus).toBe('PACKAGE_BOUND')

    VMF.prototype.save = origSave
  })

  test('accepts an explicit active default frameworkPackageId even when it is not customer-visible', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)
    FrameworkPackage.findById.mockResolvedValue(
      makeFrameworkPackage({
        visibility: 'INTERNAL_ONLY',
        customerAccessMode: 'ALL_CUSTOMERS',
      }),
    )
    SystemVersioningPolicy.findActive.mockResolvedValue(
      makeActivePolicy({
        rules: { frameworkVersion: '2.3.1' },
      }),
    )

    const origSave = VMF.prototype.save
    VMF.prototype.save = jest.fn(async function () {
      this._id = VMF_ID
      this.id = VMF_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Default Package VMF',
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
      })

    expect(res.status).toBe(201)
    expect(res.body.data.frameworkPackageId).toBe(FRAMEWORK_PACKAGE_ID)
    expect(res.body.data.snapshotStatus).toBe('PACKAGE_BOUND')

    VMF.prototype.save = origSave
  })

  test('returns 422 when frameworkPackageId is not available to the customer', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)
    FrameworkPackage.findById.mockResolvedValue(
      makeFrameworkPackage({
        isDefault: false,
        customerAccessMode: 'SELECTED_CUSTOMERS',
        assignedCustomerIds: ['607f1f77bcf86cd799439999'],
      }),
    )

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Unavailable Package VMF',
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.frameworkPackageId).toBe('Framework package is not available to this customer.')
  })

  test('returns 422 when frameworkPackageId targets a non-VMF package', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)
    FrameworkPackage.findById.mockResolvedValue(
      makeFrameworkPackage({
        frameworkKey: 'RLD',
      }),
    )

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Wrong Framework VMF',
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.frameworkPackageId).toBe('Framework package must target the VMF framework.')
  })

  test('returns 403 for a regular user without VMF_CREATE permission', async () => {
    const token = await getRegularUserToken()

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Blocked VMF' })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toBe("Tenant permission 'VMF_CREATE' is required.")
    expect(Tenant.findById).not.toHaveBeenCalled()
  })

  test('allows a regular tenant member to create a VMF when VMF_CREATE is granted to their role', async () => {
    const token = await getRegularUserToken()
    setRoleDefinitions([
      makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
      makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'VMF_CREATE']),
    ])
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)
    SystemVersioningPolicy.findActive.mockResolvedValue(makeActivePolicy())

    const origSave = VMF.prototype.save
    VMF.prototype.save = jest.fn(async function () {
      this._id = VMF_ID
      this.id = VMF_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Permission Driven VMF',
      })

    expect(res.status).toBe(201)
    expect(res.body.data?.name).toBe('Permission Driven VMF')

    VMF.prototype.save = origSave
  })

  test('re-evaluates VMF_CREATE after auth cache reset when a role gains the permission', async () => {
    const token = await getRegularUserToken()

    const deniedResponse = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Still Blocked VMF' })

    expect(deniedResponse.status).toBe(403)

    performanceCacheService.resetForTests()
    setRoleDefinitions([
      makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
      makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'VMF_CREATE']),
    ])
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(0)
    SystemVersioningPolicy.findActive.mockResolvedValue(makeActivePolicy())

    const origSave = VMF.prototype.save
    VMF.prototype.save = jest.fn(async function () {
      this._id = VMF_ID
      this.id = VMF_ID
      return this
    })

    const allowedResponse = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Permission Refresh VMF' })

    expect(allowedResponse.status).toBe(201)
    expect(allowedResponse.body.data?.name).toBe('Permission Refresh VMF')

    VMF.prototype.save = origSave
  })

  test('returns 403 for disabled tenant', async () => {
    const token = await getSuperAdminToken()
    Tenant.findById.mockResolvedValue(makeFakeTenant({ status: 'DISABLED' }))

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New VMF' })

    // requireTenantEnabled returns 403 for disabled tenants
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('TENANT_DISABLED')
  })

  test('returns 409 when policy forbids (PER_TENANT_SINGLE, already has 1)', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer({ vmfPolicy: 'PER_TENANT_SINGLE' })
    Customer.findById.mockResolvedValue(customer)
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(1) // already has a VMF

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second VMF' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  test('returns 409 when governance maxVmfsPerTenant limit is reached (boundary plus one)', async () => {
    const token = await getSuperAdminToken()
    const customer = makeFakeCustomer({
      vmfPolicy: 'PER_TENANT_MULTI',
      governance: {
        maxTenants: 10,
        maxVmfsPerTenant: 1,
        customerAdminUserId: null,
      },
    })
    Customer.findById.mockResolvedValue(customer)
    Tenant.findById.mockResolvedValue(makeFakeTenant())
    VMF.countByTenant.mockResolvedValue(1)

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second VMF' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details.limitType).toBe('MAX_VMFS_PER_TENANT')
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VMF_LIMIT_REJECTED',
    }))
  })

  test('allows customer-scoped tenant admin to create a VMF for a tenant they administer', async () => {
    const scopedTenantAdmin = makeCustomerScopedTenantAdmin()
    const tokens = await tokenService.generateTokens(scopedTenantAdmin)

    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeCustomerScopedTenantAdmin())
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [TENANT_ADMIN_ID] }))
    VMF.countByTenant.mockResolvedValue(0)
    SystemVersioningPolicy.findActive.mockResolvedValue(makeActivePolicy())

    const origSave = VMF.prototype.save
    VMF.prototype.save = jest.fn(async function () {
      this._id = VMF_ID
      this.id = VMF_ID
      return this
    })

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        name: 'Scoped Tenant Admin VMF',
      })

    expect(res.status).toBe(201)
    expect(res.body.data?.name).toBe('Scoped Tenant Admin VMF')

    VMF.prototype.save = origSave
  })

  test('denies customer-scoped tenant admin VMF creation when they are only linked to the tenant as a user', async () => {
    const scopedTenantAdmin = makeCustomerScopedTenantAdmin()
    const tokens = await tokenService.generateTokens(scopedTenantAdmin)

    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeCustomerScopedTenantAdmin())
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [] }))
    VMF.countByTenant.mockResolvedValue(0)
    SystemVersioningPolicy.findActive.mockResolvedValue(makeActivePolicy())

    const res = await request
      .post(`/api/v1/customers/${CUSTOMER_ID}/tenants/${TENANT_ID}/vmfs`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        name: 'Blocked Scoped Tenant Admin VMF',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toBe("Tenant permission 'VMF_CREATE' is required.")
  })
})

/* ================================================================== */
/*  GET VMF                                                           */
/* ================================================================== */

describe('GET /api/v1/vmfs/:vmfId', () => {
  test('returns VMF for Super Admin with bound package metadata', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(
      makeFakeVmf({
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        frameworkVersion: '2.3.1',
        versionPolicyId: null,
      }),
    )
    FrameworkPackage.find.mockResolvedValue([makeFrameworkPackage()])
    FrameworkPackage.findActiveByFrameworkKey.mockResolvedValue(makeFrameworkPackage())

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('VMF 1')
    expect(res.body.data.frameworkPackageId).toBe(FRAMEWORK_PACKAGE_ID)
    expect(res.body.data.frameworkPackage.version).toBe('2.3.1')
    expect(res.body.data.snapshotStatus).toBe('PACKAGE_BOUND')
  })

  test('returns legacy VMF detail with inferred package metadata and migration availability', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(
      makeFakeVmf({
        frameworkPackageId: null,
        frameworkVersion: '2.2',
        versionPolicyId: POLICY_ID,
      }),
    )
    FrameworkPackage.find.mockResolvedValue([
      makeFrameworkPackage({
        _id: FRAMEWORK_PACKAGE_ID_2,
        id: FRAMEWORK_PACKAGE_ID_2,
        version: '2.2',
        isDefault: false,
      }),
    ])
    FrameworkPackage.findActiveByFrameworkKey.mockResolvedValue(makeFrameworkPackage())

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.frameworkPackageId).toBe(FRAMEWORK_PACKAGE_ID_2)
    expect(res.body.data.snapshotStatus).toBe('PACKAGE_INFERRED_FROM_VERSION')
    expect(res.body.data.migrationAvailable).toBe(true)
  })

  test('returns 404 when VMF does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('returns 404 when VMF is soft-deleted', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(
      makeFakeVmf({
        status: 'ARCHIVED',
        deletedAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
    )

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

/* ================================================================== */
/*  UPDATE VMF                                                        */
/* ================================================================== */

describe('PATCH /api/v1/vmfs/:vmfId', () => {
  test('updates VMF name', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf()
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated VMF' })

    expect(res.status).toBe(200)
    expect(vmf.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('updates VMF status to DISABLED', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf()
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DISABLED' })

    expect(res.status).toBe(200)
    expect(vmf.status).toBe('DISABLED')
    expect(vmf.save).toHaveBeenCalled()
  })

  test('updates VMF lifecycle status from DRAFT to CANONISED', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf({ lifecycleStatus: 'DRAFT' })
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lifecycleStatus: 'CANONISED' })

    expect(res.status).toBe(200)
    expect(vmf.lifecycleStatus).toBe('CANONISED')
    expect(vmf.save).toHaveBeenCalled()
  })

  test('returns 422 for invalid lifecycle regression transition', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf({ lifecycleStatus: 'PUBLISHED' })
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lifecycleStatus: 'DRAFT' })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('INVALID_LIFECYCLE_TRANSITION')
    expect(vmf.save).not.toHaveBeenCalled()
  })

  test('returns 404 when VMF does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X' })

    expect(res.status).toBe(404)
  })

  test('allows customer-scoped tenant admin to update a VMF for a tenant they administer', async () => {
    const scopedTenantAdmin = makeCustomerScopedTenantAdmin()
    const tokens = await tokenService.generateTokens(scopedTenantAdmin)
    const vmf = makeFakeVmf()

    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeCustomerScopedTenantAdmin())
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [TENANT_ADMIN_ID] }))

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ name: 'Updated By Scoped Tenant Admin' })

    expect(res.status).toBe(200)
    expect(vmf.name).toBe('Updated By Scoped Tenant Admin')
    expect(vmf.save).toHaveBeenCalled()
  })

  test('allows regular user with scoped VMF_UPDATE to update a VMF without a VMF WRITE grant', async () => {
    const token = await getRegularUserToken()
    const vmf = makeFakeVmf()
    setRoleDefinitions([
      makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
      makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'VMF_UPDATE']),
    ])

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser({ vmfGrants: [] }))
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Scoped Update Without Grant' })

    expect(res.status).toBe(200)
    expect(vmf.name).toBe('Scoped Update Without Grant')
    expect(vmf.save).toHaveBeenCalled()
  })

  test('denies customer-scoped tenant admin VMF update when they are only linked to the tenant as a user', async () => {
    const scopedTenantAdmin = makeCustomerScopedTenantAdmin()
    const tokens = await tokenService.generateTokens(scopedTenantAdmin)
    const vmf = makeFakeVmf()

    User.findById.mockImplementation((id) => {
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeCustomerScopedTenantAdmin())
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)
    Tenant.findById.mockResolvedValue(makeFakeTenant({ tenantAdminUserIds: [] }))

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ name: 'Blocked Update By Scoped Tenant Admin' })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toBe("Tenant permission 'VMF_UPDATE' is required.")
    expect(vmf.save).not.toHaveBeenCalled()
  })

  test('denies regular user with WRITE grant when VMF_UPDATE is not granted by role permissions', async () => {
    const token = await getRegularUserToken()
    const vmf = makeFakeVmf()

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ', 'WRITE'] },
          ],
        }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .patch(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Blocked Update' })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain("Tenant permission 'VMF_UPDATE' is required.")
    expect(vmf.save).not.toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  DELETE VMF                                                        */
/* ================================================================== */

describe('DELETE /api/v1/vmfs/:vmfId', () => {
  test('soft-deletes a disabled VMF with no active deals', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf({ status: 'DISABLED' })
    VMF.findById.mockResolvedValue(vmf)
    Deal.countDocuments.mockResolvedValue(0)

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('deleted')
    expect(vmf.save).toHaveBeenCalled()
    expect(vmf.deletedAt).toBeDefined()
    expect(vmf.purgeAfter).toBeDefined()
    expect(User.updateMany).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('returns 422 when VMF is active', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf({ status: 'ACTIVE' }))

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('Disable or archive')
  })

  test('returns 422 when VMF has active deals', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf({ status: 'DISABLED' }))
    Deal.countDocuments.mockResolvedValue(3)

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('active deal')
  })

  test('returns 404 when VMF is already soft-deleted', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(
      makeFakeVmf({
        status: 'ARCHIVED',
        deletedAt: new Date('2026-03-01T00:00:00.000Z'),
        purgeAfter: new Date('2026-03-31T00:00:00.000Z'),
      }),
    )

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('returns 404 when VMF does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(null)

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('allows regular user with scoped VMF_UPDATE to delete a VMF without a VMF WRITE grant', async () => {
    const token = await getRegularUserToken()
    const vmf = makeFakeVmf({ status: 'DISABLED' })
    setRoleDefinitions([
      makeRoleDefinition('SUPER_ADMIN', 'PLATFORM', ['PLATFORM_MANAGE']),
      makeRoleDefinition('CUSTOMER_ADMIN', 'CUSTOMER', ['CUSTOMER_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('TENANT_ADMIN', 'TENANT', ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE']),
      makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'VMF_UPDATE']),
    ])

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) return Promise.resolve(makeRegularUser({ vmfGrants: [] }))
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)
    Deal.countDocuments.mockResolvedValue(0)

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(vmf.save).toHaveBeenCalled()
    expect(User.updateMany).toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  GRANT ACCESS                                                      */
/* ================================================================== */

describe('POST /api/v1/vmfs/:vmfId/grants', () => {
  test('grants user access to a VMF', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf()
    VMF.findById.mockResolvedValue(vmf)

    const targetUser = makeRegularUser()
    // Override findById to handle both auth user and target user
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(targetUser)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: REGULAR_USER_ID, permissions: ['READ', 'WRITE'] })

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('Access granted')
    expect(targetUser.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('returns 404 when target user does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null) // target user not found
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: REGULAR_USER_ID, permissions: ['READ'] })

    expect(res.status).toBe(404)
  })

  test('returns 422 when user does not belong to VMF customer', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const foreignUser = makeRegularUser({
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    })
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(foreignUser)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: REGULAR_USER_ID, permissions: ['READ'] })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('does not belong')
  })

  test('replaces permissions if grant already exists', async () => {
    const token = await getSuperAdminToken()
    const vmf = makeFakeVmf()
    VMF.findById.mockResolvedValue(vmf)

    const userWithGrant = makeRegularUser({
      vmfGrants: [
        { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ'] },
      ],
    })
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(userWithGrant)
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: REGULAR_USER_ID, permissions: ['READ', 'WRITE'] })

    expect(res.status).toBe(200)
    expect(userWithGrant.save).toHaveBeenCalled()
  })

  test('denies regular user with VMF WRITE grant when VMF_UPDATE capability is missing', async () => {
    const token = await getRegularUserToken()
    const vmf = makeFakeVmf()
    const targetUser = makeRegularUser({ _id: '507f1f77bcf86cd799439099', id: '507f1f77bcf86cd799439099' })

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ', 'WRITE'] },
          ],
        }))
      }
      if (id === '507f1f77bcf86cd799439099') return Promise.resolve(targetUser)
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })
    VMF.findById.mockResolvedValue(vmf)

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: '507f1f77bcf86cd799439099', permissions: ['READ'] })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain("Tenant permission 'VMF_UPDATE' is required.")
  })
})

/* ================================================================== */
/*  REVOKE ACCESS                                                     */
/* ================================================================== */

describe('DELETE /api/v1/vmfs/:vmfId/grants/:userId', () => {
  test('revokes user access to a VMF', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const userWithGrant = makeRegularUser({
      vmfGrants: [
        { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ'] },
      ],
    })
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(userWithGrant)
      return Promise.resolve(null)
    })

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}/grants/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('revoked')
    expect(userWithGrant.save).toHaveBeenCalled()
  })

  test('returns 404 when user has no grant for VMF', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const userNoGrant = makeRegularUser({ vmfGrants: [] })
    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === REGULAR_USER_ID) return Promise.resolve(userNoGrant)
      return Promise.resolve(null)
    })

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}/grants/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.message).toContain('does not have a grant')
  })

  test('returns 404 when target user does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    User.findById.mockImplementation((id) => {
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .delete(`/api/v1/vmfs/${VMF_ID}/grants/${REGULAR_USER_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

/* ================================================================== */
/*  LIST DEALS                                                        */
/* ================================================================== */

describe('GET /api/v1/vmfs/:vmfId/deals', () => {
  test('returns paginated deal list', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const deals = [makeFakeDeal()]
    Deal.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(deals),
          }),
        }),
      }),
    })
    Deal.countDocuments.mockResolvedValue(1)

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.meta.total).toBe(1)
  })

  test('supports search by q param', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    Deal.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })
    Deal.countDocuments.mockResolvedValue(0)

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}/deals?q=discovery`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })

  test('returns 403 for a regular user with VMF grant when DEAL_VIEW capability is missing', async () => {
    const token = await getRegularUserToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ'] },
          ],
        }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .get(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain("Tenant permission 'DEAL_VIEW' is required.")
  })
})

/* ================================================================== */
/*  CREATE DEAL                                                       */
/* ================================================================== */

describe('POST /api/v1/vmfs/:vmfId/deals', () => {
  test('creates deal successfully', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const origSave = Deal.prototype.save
    Deal.prototype.save = jest.fn(async function () {
      this._id = DEAL_ID
      this.id = DEAL_ID
      return this
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New Deal', stage: 'Discovery' })

    expect(res.status).toBe(201)
    expect(res.body.data).toBeDefined()
    expect(res.body.data.title).toBe('New Deal')
    expect(AuditLog.createLog).toHaveBeenCalled()

    Deal.prototype.save = origSave
  })

  test('creates deal with data object', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    const origSave = Deal.prototype.save
    Deal.prototype.save = jest.fn(async function () {
      this._id = DEAL_ID
      this.id = DEAL_ID
      return this
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Deal With Data', data: { amount: 50000, currency: 'USD' } })

    expect(res.status).toBe(201)

    Deal.prototype.save = origSave
  })

  test('returns 422 when VMF is not active', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(makeFakeVmf({ status: 'DISABLED' }))

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New Deal' })

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('inactive')
  })

  test('returns 404 when VMF does not exist', async () => {
    const token = await getSuperAdminToken()
    VMF.findById.mockResolvedValue(null)

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New Deal' })

    expect(res.status).toBe(404)
  })

  test('returns 403 for a regular user with VMF WRITE grant when DEAL_CREATE capability is missing', async () => {
    const token = await getRegularUserToken()
    VMF.findById.mockResolvedValue(makeFakeVmf())

    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ', 'WRITE'] },
          ],
        }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      if (id === CUSTOMER_ADMIN_ID) return Promise.resolve(makeCustomerAdmin())
      if (id === TENANT_ADMIN_ID) return Promise.resolve(makeTenantAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .post(`/api/v1/vmfs/${VMF_ID}/deals`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Blocked Deal' })

    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain("Tenant permission 'DEAL_CREATE' is required.")
  })
})

/* ================================================================== */
/*  GET DEAL                                                          */
/* ================================================================== */

describe('GET /api/v1/deals/:dealId', () => {
  test('returns deal for Super Admin', async () => {
    const token = await getSuperAdminToken()
    Deal.findById.mockResolvedValue(makeFakeDeal())

    const res = await request
      .get(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Test Deal')
  })

  test('returns 404 when deal does not exist', async () => {
    const token = await getSuperAdminToken()
    Deal.findById.mockResolvedValue(null)

    const res = await request
      .get(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  test('returns deal for a regular user with DEAL_VIEW capability and VMF READ grant', async () => {
    const token = await getRegularUserToken()
    const roleDefinitions = makeDefaultRoleDefinitions().map((roleDefinition) =>
      roleDefinition.key === 'USER'
        ? makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'DEAL_VIEW'])
        : roleDefinition,
    )

    setRoleDefinitions(roleDefinitions)
    Deal.findById.mockResolvedValue(makeFakeDeal())
    VMF.findById.mockResolvedValue(makeFakeVmf())
    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ'] },
          ],
        }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .get(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Test Deal')
  })
})

/* ================================================================== */
/*  UPDATE DEAL                                                       */
/* ================================================================== */

describe('PATCH /api/v1/deals/:dealId', () => {
  test('updates deal title', async () => {
    const token = await getSuperAdminToken()
    const deal = makeFakeDeal()
    Deal.findById.mockResolvedValue(deal)

    const res = await request
      .patch(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated Deal' })

    expect(res.status).toBe(200)
    expect(deal.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('updates deal stage and data', async () => {
    const token = await getSuperAdminToken()
    const deal = makeFakeDeal()
    Deal.findById.mockResolvedValue(deal)

    const res = await request
      .patch(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'Negotiation', data: { amount: 25000 } })

    expect(res.status).toBe(200)
    expect(deal.stage).toBe('Negotiation')
    expect(deal.save).toHaveBeenCalled()
  })

  test('archives deal via status update', async () => {
    const token = await getSuperAdminToken()
    const deal = makeFakeDeal()
    Deal.findById.mockResolvedValue(deal)

    const res = await request
      .patch(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARCHIVED' })

    expect(res.status).toBe(200)
    expect(deal.status).toBe('ARCHIVED')
  })

  test('returns 404 when deal does not exist', async () => {
    const token = await getSuperAdminToken()
    Deal.findById.mockResolvedValue(null)

    const res = await request
      .patch(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'X' })

    expect(res.status).toBe(404)
  })

  test('updates deal for a regular user with DEAL_UPDATE capability and VMF WRITE grant', async () => {
    const token = await getRegularUserToken()
    const roleDefinitions = makeDefaultRoleDefinitions().map((roleDefinition) =>
      roleDefinition.key === 'USER'
        ? makeRoleDefinition('USER', 'VMF', ['VMF_VIEW', 'DEAL_UPDATE'])
        : roleDefinition,
    )
    const deal = makeFakeDeal()

    setRoleDefinitions(roleDefinitions)
    Deal.findById.mockResolvedValue(deal)
    VMF.findById.mockResolvedValue(makeFakeVmf())
    User.findById.mockImplementation((id) => {
      if (id === REGULAR_USER_ID) {
        return Promise.resolve(makeRegularUser({
          vmfGrants: [
            { customerId: CUSTOMER_ID, tenantId: TENANT_ID, vmfId: VMF_ID, permissions: ['READ', 'WRITE'] },
          ],
        }))
      }
      if (id === SUPER_ADMIN_ID) return Promise.resolve(makeSuperAdmin())
      return Promise.resolve(null)
    })

    const res = await request
      .patch(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated By Hybrid Access' })

    expect(res.status).toBe(200)
    expect(deal.title).toBe('Updated By Hybrid Access')
    expect(deal.save).toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  ARCHIVE (DELETE) DEAL                                             */
/* ================================================================== */

describe('DELETE /api/v1/deals/:dealId', () => {
  test('archives an active deal', async () => {
    const token = await getSuperAdminToken()
    const deal = makeFakeDeal()
    Deal.findById.mockResolvedValue(deal)

    const res = await request
      .delete(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toContain('archived')
    expect(deal.status).toBe('ARCHIVED')
    expect(deal.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalled()
  })

  test('returns 422 when deal is already archived', async () => {
    const token = await getSuperAdminToken()
    Deal.findById.mockResolvedValue(makeFakeDeal({ status: 'ARCHIVED' }))

    const res = await request
      .delete(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('already archived')
  })

  test('returns 404 when deal does not exist', async () => {
    const token = await getSuperAdminToken()
    Deal.findById.mockResolvedValue(null)

    const res = await request
      .delete(`/api/v1/deals/${DEAL_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})
