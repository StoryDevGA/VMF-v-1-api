import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
})

const CUSTOMER_ADMIN_ID = '507f1f77bcf86cd799439012'
const REGULAR_USER_ID = '507f1f77bcf86cd799439014'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const OTHER_CUSTOMER_ID = '607f1f77bcf86cd799439023'
const TENANT_ID = '707f1f77bcf86cd799439033'
const OTHER_TENANT_ID = '707f1f77bcf86cd799439034'
const FRAMEWORK_PACKAGE_ID = '927f1f77bcf86cd799439099'
const RUNTIME_INSTANCE_ID = 'a27f1f77bcf86cd799439111'
const UI_CONTRACT_KEY = 'vmf-cli-ui-contract'

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
  save: jest.fn(async function save() { return this }),
  toJSON: function toJSON() {
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
  save: jest.fn(async function save() { return this }),
  toJSON: function toJSON() {
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

const makeCustomer = (overrides = {}) => ({
  _id: CUSTOMER_ID,
  id: CUSTOMER_ID,
  name: 'Acme Corp',
  topology: 'MULTI_TENANT',
  vmfPolicy: 'PER_TENANT_MULTI',
  defaultTenantId: null,
  status: 'ACTIVE',
  entitlements: ['VMF'],
  licenseLevelId: null,
  governance: {
    maxTenants: 10,
    maxVmfsPerTenant: 10,
  },
  ...overrides,
})

const makeTenant = (overrides = {}) => ({
  _id: TENANT_ID,
  id: TENANT_ID,
  customerId: CUSTOMER_ID,
  name: 'Tenant One',
  status: 'ENABLED',
  isDefault: false,
  ...overrides,
})

const makeFrameworkPackage = (overrides = {}) => ({
  _id: FRAMEWORK_PACKAGE_ID,
  id: FRAMEWORK_PACKAGE_ID,
  frameworkKey: 'VMF',
  frameworkName: 'Value Messaging Framework',
  packageName: 'VMF Standard',
  packageKey: 'vmf-standard-2-3-1',
  version: '2.3.1',
  status: 'ACTIVE',
  isDefault: true,
  visibility: 'INTERNAL_ONLY',
  customerAccessMode: 'ALL_CUSTOMERS',
  assignedCustomerIds: [],
  dependencyLock: {
    status: 'PASS',
    snapshotId: 'dep-lock-vmf-standard-2-3-1',
    snapshotHash: 'hash-vmf-standard-2-3-1',
    references: [
      {
        componentType: 'UI_CONTRACT',
        stableId: 'vmf-cli-ui-contract',
        componentVersion: '2.3.1',
      },
    ],
  },
  runtimeVerdict: {
    result: 'ALLOW',
    auditPersisted: true,
    dependencyLockState: 'LOCKED',
    lastValidatedAt: '2026-05-18T10:00:00.000Z',
  },
  ...overrides,
})

const makeRuntimeDeployment = (overrides = {}) => ({
  _id: 'b27f1f77bcf86cd799439111',
  deploymentId: 'deployment-vmf-global-production-001',
  activationId: 'activation-vmf-2-3-1-001',
  packageId: FRAMEWORK_PACKAGE_ID,
  packageKey: 'vmf-standard-2-3-1',
  frameworkKey: 'VMF',
  frameworkVersion: '2.3.1',
  status: 'ACTIVE',
  registeredAt: '2026-05-18T10:05:00.000Z',
  ...overrides,
})

const makeRuntimeActivationSnapshot = (overrides = {}) => ({
  _id: 'c27f1f77bcf86cd799439111',
  activationId: 'activation-vmf-2-3-1-001',
  deploymentId: 'deployment-vmf-global-production-001',
  packageId: FRAMEWORK_PACKAGE_ID,
  packageKey: 'vmf-standard-2-3-1',
  frameworkKey: 'VMF',
  frameworkVersion: '2.3.1',
  activationStatus: 'ACTIVE',
  dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
  dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
  activatedAt: '2026-05-18T10:00:00.000Z',
  ...overrides,
})

const makeRuntimeInstance = (overrides = {}) => ({
  _id: RUNTIME_INSTANCE_ID,
  id: RUNTIME_INSTANCE_ID,
  runtimeInstanceKey: 'value-narrative-439111',
  customerId: CUSTOMER_ID,
  tenantId: TENANT_ID,
  workspaceId: '',
  runtimeType: 'VALUE_NARRATIVE',
  frameworkKey: 'VMF',
  packageId: FRAMEWORK_PACKAGE_ID,
  packageKey: 'vmf-standard-2-3-1',
  packageVersion: '2.3.1',
  dependencyLockId: 'dep-lock-vmf-standard-2-3-1',
  activationId: 'activation-vmf-2-3-1-001',
  deploymentId: 'deployment-vmf-global-production-001',
  evidence: {
    activationId: 'activation-vmf-2-3-1-001',
    deploymentId: 'deployment-vmf-global-production-001',
    dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
    dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
  },
  status: 'ACTIVE',
  executionStatus: 'IDLE',
  runtimeMode: 'INTERACTIVE',
  name: 'Acme Value Narrative',
  description: '',
  framework_state: {
    lifecycle: { stage: 'DRAFT' },
    sections: {},
    validation: {},
    policy: {},
    attachments: {},
    artifacts: {},
  },
  assignedTo: [],
  anchors: [],
  createdBy: CUSTOMER_ADMIN_ID,
  updatedBy: CUSTOMER_ADMIN_ID,
  createdAt: '2026-05-19T08:00:00.000Z',
  updatedAt: '2026-05-19T08:00:00.000Z',
  toJSON: function toJSON() {
    return { ...this, id: this._id }
  },
  ...overrides,
})

const makeRendererFrameworkPackage = (overrides = {}) => makeFrameworkPackage({
  uiContractKey: UI_CONTRACT_KEY,
  uiContractBinding: {
    key: UI_CONTRACT_KEY,
    version: '2.3.1',
    status: 'ACTIVE',
    compatibilityMode: 'INHERITED_MINOR',
    resolvedAt: '2026-05-18T10:00:00.000Z',
  },
  sections: [
    {
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      required: true,
      validationKeys: ['required-sections-check'],
    },
  ],
  workflowBindings: [
    {
      policyKey: 'submit-for-review-policy',
      executionContext: 'ON_SUBMIT',
      priority: 10,
      enabled: true,
    },
  ],
  ...overrides,
})

const makeRuntimePathRecord = (overrides = {}) => ({
  stableId: 'path-framework-state-sections-customer-problem',
  pathKey: 'framework_state.sections.customer_problem',
  label: 'Customer Problem',
  status: 'ACTIVE',
  frameworkKeys: ['VMF'],
  scope: 'FRAMEWORK_STATE',
  allowedOperations: ['READ', 'WRITE', 'BIND'],
  dataType: 'STRING',
  category: 'SECTION',
  sourceType: 'RUNTIME_STATE',
  uiControl: 'TEXTAREA',
  helpText: 'Describe the core problem.',
  placeholderText: 'Example: Proposal creation is slow.',
  displayOrder: 10,
  ...overrides,
})

const makeUIContract = (overrides = {}) => ({
  stableId: `ui-contract-${UI_CONTRACT_KEY}`,
  uiContractKey: UI_CONTRACT_KEY,
  name: 'VMF CLI UI Contract',
  status: 'ACTIVE',
  frameworkKeys: ['VMF'],
  sections: [
    {
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      source: 'PACKAGE',
      isCustom: false,
      label: 'Customer Problem',
      shortLabel: 'Problem',
      helpText: 'Describe the core problem.',
      placeholder: 'Example: Proposal creation is slow.',
      displayOrder: 10,
      isVisible: true,
      isEditable: true,
      isRequiredDisplay: true,
      isReadOnlyDisplay: false,
    },
  ],
  actions: [
    {
      actionKey: 'SUBMIT_FOR_REVIEW',
      governedAction: 'SUBMIT_FOR_REVIEW',
      buttonLabel: 'Submit for Review',
      confirmationMessage: 'Submit this framework for review?',
      successMessage: 'Framework submitted for review.',
      displayOrder: 10,
      isVisible: true,
      requiresConfirmation: true,
    },
  ],
  ...overrides,
})

const makeWorkflowPolicy = (overrides = {}) => ({
  stableId: 'policy-submit-for-review-policy',
  key: 'submit-for-review-policy',
  name: 'Submit for Review',
  status: 'ACTIVE',
  frameworkKeys: ['VMF'],
  governedAction: 'SUBMIT_FOR_REVIEW',
  triggerEvent: 'ON_SUBMIT',
  decisionMode: 'ALLOW',
  priority: 10,
  conditions: [
    {
      path: 'framework_state.lifecycle.stage',
      operator: '=',
      value: 'DRAFT',
    },
  ],
  passMessage: 'Submit action is available.',
  failMessage: 'Submit action is not available.',
  ...overrides,
})

const buildRoleQueryChain = (rows) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildUserQueryChain = (value) => {
  const promise = Promise.resolve(value)
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockImplementation(() => promise),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
}

const buildLeanQuery = (value) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const buildSelectableLeanQuery = (value) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
})

const buildRuntimeInstanceFindChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildDefaultRoleRows = () => ([
  {
    key: 'CUSTOMER_ADMIN',
    scope: 'CUSTOMER',
    permissions: ['CUSTOMER_VIEW', 'VMF_CREATE', 'VMF_UPDATE', 'VMF_VIEW'],
    isActive: true,
  },
  {
    key: 'USER',
    scope: 'VMF',
    permissions: ['VMF_VIEW', 'DEAL_VIEW'],
    isActive: true,
  },
])

let app
let request
let tokenService
let User
let Role
let Customer
let Tenant
let FrameworkPackage
let RuntimeDeployment
let RuntimeActivationSnapshot
let RuntimeInstance
let RuntimePathRegistry
let UIContract
let WorkflowPolicy
let AuditLog
let mockRedisClient

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

beforeAll(async () => {
  mockRedisClient = {
    set: jest.fn(),
    setex: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  }

  await jest.unstable_mockModule('../config/redis.js', () => ({
    connectRedis: jest.fn(),
    getRedis: jest.fn(() => mockRedisClient),
    isRedisConnected: jest.fn(() => true),
    disconnectRedis: jest.fn(),
  }))

  const supertest = (await import('supertest')).default
  app = (await import('../app.js')).default
  tokenService = (await import('../services/tokenService.js')).default
  request = supertest(app)

  const models = await import('../models/index.js')
  User = models.User
  Role = models.Role
  Customer = models.Customer
  Tenant = models.Tenant
  FrameworkPackage = models.FrameworkPackage
  RuntimeDeployment = models.RuntimeDeployment
  RuntimeActivationSnapshot = models.RuntimeActivationSnapshot
  RuntimeInstance = models.RuntimeInstance
  RuntimePathRegistry = models.RuntimePathRegistry
  UIContract = models.UIContract
  WorkflowPolicy = models.WorkflowPolicy
  AuditLog = models.AuditLog
})

beforeEach(() => {
  User.findById = jest.fn().mockImplementation((userId) => {
    if (userId === CUSTOMER_ADMIN_ID) {
      return buildUserQueryChain(makeCustomerAdmin())
    }

    if (userId === REGULAR_USER_ID) {
      return buildUserQueryChain(makeRegularUser())
    }

    return buildUserQueryChain(null)
  })

  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))
  Customer.findById = jest.fn().mockResolvedValue(makeCustomer())
  Tenant.findById = jest.fn().mockResolvedValue(makeTenant())
  FrameworkPackage.findById = jest.fn().mockResolvedValue(makeFrameworkPackage())
  FrameworkPackage.findOne = jest.fn()
  RuntimeDeployment.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeDeployment()))
  RuntimeActivationSnapshot.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeActivationSnapshot()))
  RuntimePathRegistry.find = jest.fn().mockReturnValue(buildLeanQuery([]))
  UIContract.findOne = jest.fn().mockReturnValue(buildLeanQuery(null))
  WorkflowPolicy.find = jest.fn().mockReturnValue(buildLeanQuery([]))
  RuntimeInstance.prototype.save = jest.fn(async function save() { return this })
  RuntimeInstance.find = jest.fn().mockReturnValue(buildRuntimeInstanceFindChain([makeRuntimeInstance()]))
  RuntimeInstance.findOne = jest.fn().mockImplementation((query) => {
    if (query?.runtimeInstanceKey) {
      return buildSelectableLeanQuery(null)
    }

    return buildLeanQuery(makeRuntimeInstance())
  })
  RuntimeInstance.countDocuments = jest.fn().mockResolvedValue(1)
  RuntimeInstance.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 })
  AuditLog.createLog = jest.fn(async () => ({}))
})

describe('Runtime Instance API', () => {
  test('POST /api/v1/runtime-instances returns 401 without auth token', async () => {
    const res = await request.post('/api/v1/runtime-instances').send({})
    expect(res.status).toBe(401)
  })

  test('creates a runtime instance from an ACTIVE package with certified activation evidence', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        frameworkKey: 'VMF',
        runtimeType: 'VALUE_NARRATIVE',
        name: 'Acme Value Narrative',
        description: 'Draft narrative',
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toEqual(expect.objectContaining({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      frameworkKey: 'VMF',
      packageId: FRAMEWORK_PACKAGE_ID,
      packageKey: 'vmf-standard-2-3-1',
      packageVersion: '2.3.1',
      dependencyLockId: 'dep-lock-vmf-standard-2-3-1',
      activationId: 'activation-vmf-2-3-1-001',
      deploymentId: 'deployment-vmf-global-production-001',
      status: 'ACTIVE',
      executionStatus: 'IDLE',
      runtimeMode: 'INTERACTIVE',
      name: 'Acme Value Narrative',
    }))
    expect(res.body.data.framework_state).toEqual({
      lifecycle: { stage: 'DRAFT' },
      sections: {},
      validation: {},
      policy: {},
      attachments: {},
      artifacts: {},
    })
    expect(FrameworkPackage.findById).toHaveBeenCalledWith(FRAMEWORK_PACKAGE_ID)
    expect(FrameworkPackage.findOne).not.toHaveBeenCalled()
    expect(RuntimeDeployment.findOne).toHaveBeenCalledWith({
      packageId: expect.anything(),
      frameworkKey: 'VMF',
      status: 'ACTIVE',
    })
    expect(RuntimeActivationSnapshot.findOne).toHaveBeenCalledWith({
      activationId: 'activation-vmf-2-3-1-001',
      packageId: expect.anything(),
      activationStatus: 'ACTIVE',
    })
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_INSTANCE_CREATED',
      resourceType: 'RuntimeInstance',
      resourceId: expect.anything(),
    }))
  })

  test('allows the default active VMF package even when visibility is internal-only', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackage({
      isDefault: true,
      visibility: 'INTERNAL_ONLY',
      customerAccessMode: 'ALL_CUSTOMERS',
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Default Package Narrative',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.packageKey).toBe('vmf-standard-2-3-1')
  })

  test('rejects Deal Analysis runtime creation until a locked VMF anchor is supplied', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        frameworkKey: 'VMF',
        runtimeType: 'DEAL_ANALYSIS',
        name: 'Acme Deal Analysis',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('DEAL_ANALYSIS_ANCHOR_REQUIRED')
    expect(FrameworkPackage.findById).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation for a non-active framework package', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackage({ status: 'VALIDATED' }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Inactive Package Narrative',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('PACKAGE_NOT_ACTIVE')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when dependency-lock evidence is missing', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackage({
      dependencyLock: {
        status: 'PASS',
        snapshotId: '',
        references: [],
      },
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Missing Evidence Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('DEPENDENCY_LOCK_REQUIRED')
    expect(RuntimeDeployment.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when active deployment evidence is missing', async () => {
    RuntimeDeployment.findOne.mockReturnValue(buildLeanQuery(null))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Missing Deployment Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('DEPLOYMENT_EVIDENCE_REQUIRED')
    expect(RuntimeActivationSnapshot.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when activation snapshot evidence is missing', async () => {
    RuntimeActivationSnapshot.findOne.mockReturnValue(buildLeanQuery(null))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Missing Activation Snapshot Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('ACTIVATION_EVIDENCE_REQUIRED')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when activation snapshot dependency evidence differs from package lock', async () => {
    RuntimeActivationSnapshot.findOne.mockReturnValue(buildLeanQuery(makeRuntimeActivationSnapshot({
      dependencySnapshotId: 'dep-lock-previous-certified-snapshot',
      dependencySnapshotHash: 'hash-previous-certified-snapshot',
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Mismatched Evidence Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('DEPENDENCY_LOCK_EVIDENCE_MISMATCH')
    expect(res.body.error.details.packageDependencySnapshotId).toBe('dep-lock-vmf-standard-2-3-1')
    expect(res.body.error.details.activationDependencySnapshotId).toBe('dep-lock-previous-certified-snapshot')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when package is not available to the customer', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeFrameworkPackage({
      isDefault: false,
      visibility: 'CUSTOMER_VISIBLE',
      customerAccessMode: 'SELECTED_CUSTOMERS',
      assignedCustomerIds: [OTHER_CUSTOMER_ID],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Unavailable Package Narrative',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('PACKAGE_NOT_AVAILABLE_TO_CUSTOMER')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when the customer lacks the VMF entitlement', async () => {
    Customer.findById = jest.fn().mockResolvedValue(makeCustomer({ entitlements: ['DEALS'] }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Unentitled Narrative',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('LICENSE_FEATURE_NOT_ENABLED')
    expect(res.body.error.details.reason).toBe('FEATURE_NOT_ENABLED')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation for a user without create permission', async () => {
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'User Created Narrative',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('FORBIDDEN')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('rejects runtime creation when runtimeInstanceKey already exists before save', async () => {
    RuntimeInstance.findOne = jest.fn().mockImplementation((query) => {
      if (query?.runtimeInstanceKey === 'value-narrative-existing') {
        return buildSelectableLeanQuery({ _id: RUNTIME_INSTANCE_ID })
      }

      return buildLeanQuery(makeRuntimeInstance())
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        runtimeInstanceKey: 'value-narrative-existing',
        name: 'Duplicate Key Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_INSTANCE_KEY_CONFLICT')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
  })

  test('translates runtimeInstanceKey unique-index races to a stable conflict response', async () => {
    RuntimeInstance.prototype.save = jest.fn(async () => {
      const err = new Error('E11000 duplicate key error collection: runtime_instances index: runtimeInstanceKey_1 dup key')
      err.code = 11000
      err.keyPattern = { runtimeInstanceKey: 1 }
      err.keyValue = { runtimeInstanceKey: 'value-narrative-race' }
      throw err
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        runtimeInstanceKey: 'value-narrative-race',
        name: 'Duplicate Race Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_INSTANCE_KEY_CONFLICT')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('fails closed and does not persist runtime creation when audit write fails', async () => {
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit store unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Audit Required Narrative',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_INSTANCE_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('AUDIT_PERSISTENCE_FAILED')
    expect(RuntimeInstance.prototype.save).toHaveBeenCalledTimes(1)
    expect(RuntimeInstance.deleteOne).toHaveBeenCalledWith({ _id: expect.anything() })
  })

  test('lists runtime instances inside the requested customer and tenant scope', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
        page: 1,
        pageSize: 5,
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimeInstance.find).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
    })
    expect(RuntimeInstance.countDocuments).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
    })
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      id: RUNTIME_INSTANCE_ID,
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
    }))
    expect(res.body.meta).toEqual(expect.objectContaining({
      page: 1,
      pageSize: 5,
      total: 1,
      totalPages: 1,
      version: 'v1',
    }))
  })

  test('requires runtimeType when listing runtime instances instead of falling back to VMF entitlement', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.details.runtimeType).toBe('runtimeType is required')
    expect(RuntimeInstance.find).not.toHaveBeenCalled()
  })

  test('returns 403 when listing another tenant without matching access', async () => {
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: OTHER_TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('FORBIDDEN')
    expect(RuntimeInstance.find).not.toHaveBeenCalled()
  })

  test('returns a runtime instance only after scope permission passes', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOne).toHaveBeenCalledWith({
      $or: [
        { _id: RUNTIME_INSTANCE_ID },
        { runtimeInstanceKey: RUNTIME_INSTANCE_ID },
      ],
    })
    expect(res.body.data).toEqual(expect.objectContaining({
      id: RUNTIME_INSTANCE_ID,
      runtimeInstanceKey: 'value-narrative-439111',
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
    }))
  })

  test('renders a runtime workspace from package sections, runtime paths, UI Contract, workflow policy, and framework_state', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(FrameworkPackage.findById).toHaveBeenCalledWith(FRAMEWORK_PACKAGE_ID)
    expect(UIContract.findOne).toHaveBeenCalledWith({
      uiContractKey: UI_CONTRACT_KEY,
      status: 'ACTIVE',
      frameworkKeys: 'VMF',
    })
    expect(RuntimePathRegistry.find).toHaveBeenCalledWith({
      pathKey: { $in: ['framework_state.sections.customer_problem'] },
      status: 'ACTIVE',
      frameworkKeys: 'VMF',
    })
    expect(WorkflowPolicy.find).toHaveBeenCalledWith({
      key: { $in: ['submit-for-review-policy'] },
      status: 'ACTIVE',
      frameworkKeys: 'VMF',
    })
    expect(res.body.data).toEqual(expect.objectContaining({
      rendererContractVersion: 'runtime-renderer.v1.read-projection',
      runtimeInstanceKey: 'value-narrative-439111',
      projectionGeneratedAt: expect.any(String),
    }))
    expect(Number.isNaN(Date.parse(res.body.data.projectionGeneratedAt))).toBe(false)
    expect(res.body.data.workspace).toEqual(expect.objectContaining({
      workspaceId: RUNTIME_INSTANCE_ID,
      workspaceKey: 'value-narrative-439111',
      routeKey: RUNTIME_INSTANCE_ID,
    }))
    expect(res.body.data.sections).toEqual([
      expect.objectContaining({
        key: 'customer_problem',
        runtimePath: 'framework_state.sections.customer_problem',
        label: 'Customer Problem',
        control: 'TEXTAREA',
        required: true,
        helpText: 'Describe the core problem.',
        placeholder: 'Example: Proposal creation is slow.',
        value: 'Proposal creation is slow.',
        validationKeys: ['required-sections-check'],
        editable: true,
      }),
    ])
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        buttonLabel: 'Submit for Review',
        enabled: true,
        requiresConfirmation: true,
        confirmationMessage: 'Submit this framework for review?',
        policyKey: 'submit-for-review-policy',
      }),
    ])
    expect(res.body.data.signals).toEqual([])
    expect(res.body.data.activity).toEqual([])
    expect(res.body.data.runtimeInstance.framework_state).toBeUndefined()
    expect(res.body.data.frameworkState).toBeUndefined()
    expect(res.body.data.runtimeData).toEqual({
      readablePaths: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          value: 'Proposal creation is slow.',
        },
      ],
    })
    expect(res.body.data.diagnostics.configWarnings).toEqual([])
    expect(res.body.meta.renderTraceId).toMatch(/^render-/)
  })

  test('does not expose runtime data outside registered READ runtime paths', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
          validationKeys: ['required-sections-check'],
        },
        {
          sectionKey: 'hidden_secret',
          runtimePath: 'framework_state.sections.hidden_secret',
          required: false,
          validationKeys: [],
        },
        {
          sectionKey: 'write_only',
          runtimePath: 'framework_state.sections.write_only',
          required: false,
          validationKeys: [],
        },
      ],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-write-only',
        pathKey: 'framework_state.sections.write_only',
        label: 'Write Only',
        allowedOperations: ['WRITE'],
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
          hidden_secret: 'LEAKED_SECRET_VALUE',
          write_only: 'WRITE_ONLY_SECRET_VALUE',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections).toHaveLength(1)
    expect(res.body.data.runtimeData).toEqual({
      readablePaths: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          value: 'Proposal creation is slow.',
        },
      ],
    })
    expect(JSON.stringify(res.body.data)).not.toContain('LEAKED_SECRET_VALUE')
    expect(JSON.stringify(res.body.data)).not.toContain('WRITE_ONLY_SECRET_VALUE')
    expect(res.body.data.runtimeInstance.framework_state).toBeUndefined()
    expect(res.body.data.frameworkState).toBeUndefined()
    expect(res.body.data.diagnostics.configWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RUNTIME_PATH_NOT_FOUND',
        sectionKey: 'hidden_secret',
      }),
      expect.objectContaining({
        code: 'RUNTIME_PATH_NOT_READABLE',
        sectionKey: 'write_only',
      }),
    ]))
  })

  test('skips package sections whose runtime path is not registered and returns a renderer config warning', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections).toEqual([])
    expect(res.body.data.diagnostics.configWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RUNTIME_PATH_NOT_FOUND',
        sectionKey: 'customer_problem',
        runtimePath: 'framework_state.sections.customer_problem',
      }),
    ]))
  })

  test('disables UI Contract actions that have no matching active workflow policy', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        enabled: false,
        warnings: ['ACTION_POLICY_MISSING'],
      }),
    ])
    expect(res.body.data.diagnostics.configWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'ACTION_POLICY_MISSING',
        actionKey: 'SUBMIT_FOR_REVIEW',
        governedAction: 'SUBMIT_FOR_REVIEW',
      }),
    ]))
  })

  test('does not render workflow policy actions that are absent from the UI Contract', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({ actions: [] })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.actions).toEqual([])
    expect(res.body.data.diagnostics.configWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'POLICY_ACTION_MISSING',
        governedAction: 'SUBMIT_FOR_REVIEW',
        policyKey: 'submit-for-review-policy',
      }),
    ]))
  })

  test('disables action UI for non-executable workflow policy decisions', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([
      makeWorkflowPolicy({ decisionMode: 'WARN_ONLY' }),
    ]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        enabled: false,
        policyDecisionMode: 'WARN_ONLY',
        disabledReason: 'Workflow policy decision mode is not executable by the renderer.',
      }),
    ])
  })

  test('disables action UI when the actor lacks the action-level runtime permission', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        enabled: false,
        requiredPermissions: ['VMF_UPDATE'],
        disabledReason: 'Current role or permissions do not allow this runtime action.',
      }),
    ])
  })

  test('fails closed when runtime deployment snapshot evidence is missing', async () => {
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      evidence: {
        activationId: 'activation-vmf-2-3-1-001',
        deploymentId: 'deployment-vmf-global-production-001',
        dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
        dependencySnapshotHash: '',
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('DEPLOYMENT_SNAPSHOT_MISMATCH')
    expect(res.body.error.details.missingEvidence).toEqual(['dependencySnapshotHash'])
    expect(RuntimePathRegistry.find).not.toHaveBeenCalled()
    expect(UIContract.findOne).not.toHaveBeenCalled()
    expect(WorkflowPolicy.find).not.toHaveBeenCalled()
  })

  test('fails closed for Deal Analysis renderer requests without a locked runtime anchor', async () => {
    Customer.findById = jest.fn().mockResolvedValue(makeCustomer({ entitlements: ['DEALS'] }))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      runtimeType: 'DEAL_ANALYSIS',
      anchors: [],
    })))
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('DEAL_ANALYSIS_ANCHOR_REQUIRED')
    expect(FrameworkPackage.findById).not.toHaveBeenCalled()
    expect(RuntimePathRegistry.find).not.toHaveBeenCalled()
    expect(UIContract.findOne).not.toHaveBeenCalled()
    expect(WorkflowPolicy.find).not.toHaveBeenCalled()
  })

  test('fails closed for Deal Analysis renderer requests whose anchor is not a locked VMF runtime in scope', async () => {
    Customer.findById = jest.fn().mockResolvedValue(makeCustomer({ entitlements: ['DEALS'] }))
    RuntimeInstance.findOne = jest.fn()
      .mockReturnValueOnce(buildLeanQuery(makeRuntimeInstance({
        runtimeType: 'DEAL_ANALYSIS',
        frameworkKey: 'DEALS',
        anchors: [
          {
            runtimeInstanceId: 'b37f1f77bcf86cd799439222',
            runtimeInstanceKey: 'value-narrative-anchor',
            runtimeType: 'VALUE_NARRATIVE',
            relationship: 'VALUE_NARRATIVE_ANCHOR',
            lockedAt: '2026-05-19T12:00:00.000Z',
          },
        ],
      })))
      .mockReturnValueOnce(buildLeanQuery(makeRuntimeInstance({
        _id: 'b37f1f77bcf86cd799439222',
        id: 'b37f1f77bcf86cd799439222',
        runtimeInstanceKey: 'value-narrative-anchor',
        runtimeType: 'VALUE_NARRATIVE',
        frameworkKey: 'VMF',
        status: 'ACTIVE',
      })))
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('DEAL_ANALYSIS_ANCHOR_REQUIRED')
    expect(res.body.error.details.failedChecks).toEqual(['status'])
    expect(FrameworkPackage.findById).not.toHaveBeenCalled()
    expect(RuntimePathRegistry.find).not.toHaveBeenCalled()
    expect(UIContract.findOne).not.toHaveBeenCalled()
    expect(WorkflowPolicy.find).not.toHaveBeenCalled()
  })
})
