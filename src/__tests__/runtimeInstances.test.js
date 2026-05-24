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
const SUPER_ADMIN_ID = '507f1f77bcf86cd799439013'
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

const makeSuperAdmin = (overrides = {}) => ({
  _id: SUPER_ADMIN_ID,
  id: SUPER_ADMIN_ID,
  email: 'superadmin@storylineos.test',
  name: 'Super Admin',
  isActive: true,
  identityPlus: { trustStatus: 'TRUSTED' },
  memberships: [{ customerId: null, roles: ['SUPER_ADMIN'] }],
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

const makeCustomerScopedTenantAdmin = (overrides = {}) => makeRegularUser({
  name: 'Customer Scoped Tenant Admin',
  memberships: [{ customerId: CUSTOMER_ID, roles: ['TENANT_ADMIN', 'USER'] }],
  tenantMemberships: [
    { customerId: CUSTOMER_ID, tenantId: TENANT_ID, roles: ['USER'] },
  ],
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
  lockedAt: null,
  lockedBy: null,
  lockedReason: '',
  framework_state: {
    lifecycle: { stage: 'DRAFT' },
    sections: {},
    validation: {},
    readiness: {},
    publish: {},
    lock: {},
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

const makeRuntimeInstanceDocument = (overrides = {}) => {
  const document = {
    ...makeRuntimeInstance(overrides),
    save: jest.fn(async function save() { return this }),
    markModified: jest.fn(),
    toJSON: function toJSON() {
      return { ...this, id: this._id }
    },
  }

  return document
}

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

const makeEvidencePackRuntimePathRecord = (overrides = {}) => makeRuntimePathRecord({
  stableId: 'path-framework-state-evidence-pack',
  pathKey: 'framework_state.evidence_pack',
  label: 'Discovery Evidence Pack',
  allowedOperations: ['READ', 'WRITE'],
  dataType: 'OBJECT',
  category: 'STATE',
  uiControl: 'JSON',
  displayOrder: 1,
  ...overrides,
})

const makeReadyDiscoveryEvidencePack = (overrides = {}) => ({
  inputComplete: true,
  evidenceReady: true,
  accepted: false,
  needsRefresh: false,
  refreshedAt: '2026-05-19T08:00:30.000Z',
  inputs: {
    companyWebsite: 'https://acme.example',
    companyName: 'Acme',
    marketRegion: 'UK enterprise',
    targetOffer: 'Managed proposal platform',
  },
  evidence: {
    source: 'DISCOVERY_INPUTS',
    inputKeys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer'],
    requiredInputKeys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer'],
    missingInputKeys: [],
    builtAt: '2026-05-19T08:00:30.000Z',
  },
  scopedViews: {
    customer_problem: {
      source: 'DISCOVERY_EVIDENCE_PACK',
      inputKeys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer'],
    },
  },
  state: {
    status: 'EVIDENCE_READY',
    inputComplete: true,
    evidenceReady: true,
    accepted: false,
    needsRefresh: false,
  },
  ...overrides,
})

const actionLabels = {
  RUN_VALIDATION: 'Run Validation',
  MARK_READY: 'Mark Ready',
  SUBMIT_FOR_REVIEW: 'Submit for Review',
  RETURN_TO_DRAFT: 'Return to Draft',
  SAVE_DRAFT: 'Save Draft',
  GENERATE_SECTION: 'Generate Section',
  REGENERATE_SECTION: 'Regenerate Section',
  APPROVE: 'Approve',
  PUBLISH: 'Publish',
  LOCK_RECORD: 'Lock Record',
}

const makeActionPolicyKey = (actionKey) =>
  `${String(actionKey || '').trim().toLowerCase().replace(/_/g, '-')}-policy`

const makeWorkflowBinding = (actionKey, overrides = {}) => ({
  policyKey: makeActionPolicyKey(actionKey),
  executionContext: 'MANUAL_RUN',
  priority: 10,
  enabled: true,
  ...overrides,
})

const makeUIAction = (actionKey, overrides = {}) => ({
  actionKey,
  governedAction: actionKey,
  buttonLabel: actionLabels[actionKey] || actionKey,
  confirmationMessage: '',
  successMessage: `${actionLabels[actionKey] || actionKey} completed.`,
  displayOrder: 10,
  isVisible: true,
  requiresConfirmation: false,
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
    makeUIAction('SUBMIT_FOR_REVIEW', {
      confirmationMessage: 'Submit this framework for review?',
      requiresConfirmation: true,
    }),
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

const makeActionWorkflowPolicy = (actionKey, overrides = {}) => makeWorkflowPolicy({
  stableId: `policy-${makeActionPolicyKey(actionKey)}`,
  key: makeActionPolicyKey(actionKey),
  name: actionLabels[actionKey] || actionKey,
  governedAction: actionKey,
  triggerEvent: 'MANUAL_RUN',
  conditions: [],
  passMessage: `${actionLabels[actionKey] || actionKey} is available.`,
  failMessage: `${actionLabels[actionKey] || actionKey} is not available.`,
  ...overrides,
})

const mockRuntimeInstanceForActionExecution = ({ document, rendererRuntimeInstance = document }) => {
  RuntimeInstance.findOne = jest.fn()
    .mockImplementationOnce(() => Promise.resolve(document))
    .mockImplementation(() => buildLeanQuery(rendererRuntimeInstance))
}

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

const buildAuditLogFindChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildDefaultRoleRows = () => ([
  {
    key: 'SUPER_ADMIN',
    scope: 'PLATFORM',
    permissions: ['CUSTOMER_VIEW', 'VMF_CREATE', 'VMF_UPDATE', 'VMF_VIEW'],
    isActive: true,
  },
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

const buildTenantAdminRoleRows = () => ([
  ...buildDefaultRoleRows(),
  {
    key: 'TENANT_ADMIN',
    scope: 'TENANT',
    permissions: ['TENANT_VIEW', 'VMF_VIEW', 'VMF_CREATE'],
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

    if (userId === SUPER_ADMIN_ID) {
      return buildUserQueryChain(makeSuperAdmin())
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
  RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
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
  RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
    ...makeRuntimeInstance(),
    ...(update?.$set || {}),
    updatedAt: new Date('2026-05-19T08:01:00.000Z'),
  }))
  RuntimeInstance.countDocuments = jest.fn().mockResolvedValue(1)
  RuntimeInstance.distinct = jest.fn().mockResolvedValue([1])
  RuntimeInstance.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 })
  AuditLog.find = jest.fn().mockReturnValue(buildAuditLogFindChain([]))
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
      evidence_pack: {},
      validation: {},
      readiness: {},
      publish: {},
      lock: {},
      policy: {},
      attachments: {},
      artifacts: {},
    })
    expect(res.body.data.runtimeCapacitySlot).toBeUndefined()
    expect(FrameworkPackage.findById).toHaveBeenCalledWith(FRAMEWORK_PACKAGE_ID)
    expect(FrameworkPackage.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.countDocuments).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      status: 'ACTIVE',
    })
    expect(RuntimeInstance.distinct).toHaveBeenCalledWith('runtimeCapacitySlot', {
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      status: 'ACTIVE',
      runtimeCapacitySlot: { $type: 'number' },
    })
    expect(RuntimeInstance.prototype.save.mock.contexts[0].runtimeCapacitySlot).toBe(2)
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

  test('rejects Value Narrative runtime creation when tenant runtime capacity is exhausted', async () => {
    Customer.findById = jest.fn().mockResolvedValue(makeCustomer({
      governance: {
        maxTenants: 10,
        maxVmfsPerTenant: 1,
      },
    }))
    RuntimeInstance.countDocuments = jest.fn().mockResolvedValue(1)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        name: 'Capacity Blocked Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'VMF_LIMIT_REACHED',
      limitType: 'MAX_VMFS_PER_TENANT',
      limit: 1,
      currentCount: 1,
      tenantId: TENANT_ID,
    }))
    expect(FrameworkPackage.findById).not.toHaveBeenCalled()
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects concurrent Value Narrative runtime creation when the capacity slot is already taken', async () => {
    RuntimeInstance.countDocuments = jest.fn().mockResolvedValue(0)
    RuntimeInstance.distinct = jest.fn().mockResolvedValue([])
    RuntimeInstance.prototype.save = jest.fn(async () => {
      const err = new Error('E11000 duplicate key error runtimeCapacitySlot')
      err.code = 11000
      err.keyPattern = {
        customerId: 1,
        tenantId: 1,
        runtimeType: 1,
        status: 1,
        runtimeCapacitySlot: 1,
      }
      err.keyValue = {
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
        status: 'ACTIVE',
        runtimeCapacitySlot: 1,
      }
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
        name: 'Concurrent Narrative',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'VMF_LIMIT_REACHED',
      limitType: 'MAX_VMFS_PER_TENANT',
      limit: 10,
      currentCount: 10,
      tenantId: TENANT_ID,
    }))
    expect(RuntimeInstance.prototype.save.mock.contexts[0].runtimeCapacitySlot).toBe(1)
    expect(AuditLog.createLog).not.toHaveBeenCalled()
    expect(RuntimeInstance.deleteOne).not.toHaveBeenCalled()
  })

  test('allows a customer-scoped tenant admin assigned to the tenant to create a Value Narrative runtime', async () => {
    const tenantAdmin = makeCustomerScopedTenantAdmin()
    User.findById = jest.fn().mockImplementation((userId) => {
      if (userId === REGULAR_USER_ID) return buildUserQueryChain(tenantAdmin)
      return buildUserQueryChain(null)
    })
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildTenantAdminRoleRows()))
    Tenant.findById = jest.fn().mockResolvedValue(makeTenant({
      tenantAdminUserIds: [REGULAR_USER_ID],
    }))
    const token = await getAccessTokenForUser(tenantAdmin)

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        frameworkKey: 'VMF',
        runtimeType: 'VALUE_NARRATIVE',
        name: 'Assigned Tenant Admin Narrative',
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toEqual(expect.objectContaining({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      name: 'Assigned Tenant Admin Narrative',
    }))
    expect(RuntimeInstance.prototype.save).toHaveBeenCalledTimes(1)
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_INSTANCE_CREATED',
      resourceType: 'RuntimeInstance',
    }))
  })

  test('rejects customer-scoped tenant admin runtime creation for an unassigned tenant', async () => {
    const tenantAdmin = makeCustomerScopedTenantAdmin()
    User.findById = jest.fn().mockImplementation((userId) => {
      if (userId === REGULAR_USER_ID) return buildUserQueryChain(tenantAdmin)
      return buildUserQueryChain(null)
    })
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildTenantAdminRoleRows()))
    Tenant.findById = jest.fn().mockResolvedValue(makeTenant({
      tenantAdminUserIds: [],
    }))
    const token = await getAccessTokenForUser(tenantAdmin)

    const res = await request
      .post('/api/v1/runtime-instances')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        frameworkKey: 'VMF',
        runtimeType: 'VALUE_NARRATIVE',
        name: 'Unassigned Tenant Admin Narrative',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('FORBIDDEN')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
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
    expect(RuntimeInstance.countDocuments).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      status: 'ACTIVE',
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
      runtimeCapacity: {
        runtimeType: 'VALUE_NARRATIVE',
        maxRuntimeInstances: 10,
        currentCount: 1,
        remainingCount: 9,
        isAtCapacity: false,
        countMode: 'ACTIVE_RUNTIME_INSTANCES',
        tenantId: TENANT_ID,
      },
    }))
  })

  test('searches runtime instances by customer-visible identity and package fields', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
        q: 'Northwind',
      })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(RuntimeInstance.find).toHaveBeenCalledWith(expect.objectContaining({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      $or: expect.arrayContaining([
        { name: expect.any(RegExp) },
        { description: expect.any(RegExp) },
        { runtimeInstanceKey: expect.any(RegExp) },
        { packageKey: expect.any(RegExp) },
        { packageVersion: expect.any(RegExp) },
      ]),
    }))
    expect(RuntimeInstance.countDocuments).toHaveBeenCalledWith(expect.objectContaining({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeType: 'VALUE_NARRATIVE',
      $or: expect.any(Array),
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

  test('allows assigned customer-scoped tenant admins to list, open, and render runtime instances', async () => {
    const tenantAdmin = makeCustomerScopedTenantAdmin({
      tenantMemberships: [],
    })
    User.findById = jest.fn().mockImplementation((userId) => {
      if (userId === REGULAR_USER_ID) return buildUserQueryChain(tenantAdmin)
      return buildUserQueryChain(null)
    })
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildTenantAdminRoleRows()))
    Tenant.findById = jest.fn().mockResolvedValue(makeTenant({
      tenantAdminUserIds: [REGULAR_USER_ID],
    }))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [
        makeUIAction('SUBMIT_FOR_REVIEW'),
        makeUIAction('GENERATE_SECTION'),
        makeUIAction('REGENERATE_SECTION'),
      ],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([
      makeWorkflowPolicy(),
      makeActionWorkflowPolicy('GENERATE_SECTION'),
      makeActionWorkflowPolicy('REGENERATE_SECTION'),
    ]))
    const token = await getAccessTokenForUser(tenantAdmin)

    const listRes = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
      })
      .set('Authorization', `Bearer ${token}`)
    const detailRes = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}`)
      .set('Authorization', `Bearer ${token}`)
    const rendererRes = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(listRes.status).toBe(200)
    expect(detailRes.status).toBe(200)
    expect(rendererRes.status).toBe(200)
    expect(rendererRes.body.data.runtimeInstance.runtimeInstanceKey).toBe('value-narrative-439111')
  })

  test('rejects unassigned customer-scoped tenant admins on list, detail, and renderer access', async () => {
    const tenantAdmin = makeCustomerScopedTenantAdmin({
      tenantMemberships: [],
    })
    User.findById = jest.fn().mockImplementation((userId) => {
      if (userId === REGULAR_USER_ID) return buildUserQueryChain(tenantAdmin)
      return buildUserQueryChain(null)
    })
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildTenantAdminRoleRows()))
    Tenant.findById = jest.fn().mockResolvedValue(makeTenant({
      tenantAdminUserIds: [],
    }))
    const token = await getAccessTokenForUser(tenantAdmin)

    const listRes = await request
      .get('/api/v1/runtime-instances')
      .query({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeType: 'VALUE_NARRATIVE',
      })
      .set('Authorization', `Bearer ${token}`)
    const detailRes = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}`)
      .set('Authorization', `Bearer ${token}`)
    const rendererRes = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(listRes.status).toBe(403)
    expect(detailRes.status).toBe(403)
    expect(rendererRes.status).toBe(403)
    expect(listRes.body.error.details.reason).toBe('FORBIDDEN')
    expect(detailRes.body.error.details.reason).toBe('FORBIDDEN')
    expect(rendererRes.body.error.details.reason).toBe('FORBIDDEN')
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

  test('PATCH /api/v1/runtime-instances/:id/data writes a section value through runtime state mutation audit', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
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
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      },
      {
        $set: expect.objectContaining({
          framework_state: expect.objectContaining({
            sections: expect.objectContaining({
              customer_problem: expect.objectContaining({
                input: 'Proposal teams lack a shared story.',
                generated: null,
                review: {},
                state: expect.objectContaining({
                  status: 'DRAFT',
                }),
                lineage: expect.objectContaining({
                  sectionKey: 'customer_problem',
                  runtimePath: 'framework_state.sections.customer_problem',
                }),
                revisions: [],
              }),
            }),
          }),
          updatedBy: CUSTOMER_ADMIN_ID,
        }),
      },
      {
        new: true,
        runValidators: true,
      },
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      scope: expect.objectContaining({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeInstanceId: RUNTIME_INSTANCE_ID,
        runtimeInstanceKey: 'value-narrative-439111',
      }),
      diff: expect.objectContaining({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        previousValue: 'Proposal creation is slow.',
        nextValue: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      }),
    }))
    expect(res.body.data.mutation).toEqual({
      runtimePath: 'framework_state.sections.customer_problem',
      operation: 'WRITE',
      previousValue: 'Proposal creation is slow.',
      value: 'Proposal teams lack a shared story.',
    })
    expect(res.body.data.advance).toBeUndefined()
  })

  test('PATCH /api/v1/runtime-instances/:id/data returns server-owned advance when Save and Next is requested', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
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
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
        {
          sectionKey: 'internal_hidden',
          runtimePath: 'framework_state.sections.internal_hidden',
          required: true,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
        },
      ],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-internal-hidden',
        pathKey: 'framework_state.sections.internal_hidden',
        label: 'Internal Hidden',
        displayOrder: 20,
      }),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
        displayOrder: 30,
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        makeUIContract().sections[0],
        {
          sectionKey: 'internal_hidden',
          runtimePath: 'framework_state.sections.internal_hidden',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Internal Hidden',
          displayOrder: 20,
          isVisible: false,
          isEditable: true,
          isRequiredDisplay: true,
          isReadOnlyDisplay: false,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 30,
          isVisible: true,
          isEditable: true,
          isRequiredDisplay: true,
          isReadOnlyDisplay: false,
        },
      ],
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        saveAndNext: true,
      })

    expect(res.status).toBe(200)
    expect(FrameworkPackage.findById).toHaveBeenCalledWith(FRAMEWORK_PACKAGE_ID)
    expect(res.body.data.advance).toEqual({
      requested: true,
      hasNext: true,
      currentRuntimePath: 'framework_state.sections.customer_problem',
      currentSectionKey: 'customer_problem',
      nextRuntimePath: 'framework_state.sections.value_drivers',
      nextSectionKey: 'value_drivers',
      reason: '',
    })
  })

  test('PATCH /api/v1/runtime-instances/:id/data returns terminal advance when no next rendered section exists', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
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
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        saveAndNext: true,
      })

    expect(res.status).toBe(200)
    expect(res.body.data.advance).toEqual({
      requested: true,
      hasNext: false,
      currentRuntimePath: 'framework_state.sections.customer_problem',
      currentSectionKey: 'customer_problem',
      nextRuntimePath: '',
      nextSectionKey: '',
      reason: 'END_OF_GUIDED_SECTIONS',
    })
  })

  test('PATCH /api/v1/runtime-instances/:id/data does not advance from a current section the renderer would not project', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
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
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([]))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
        },
      ],
    }))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        saveAndNext: true,
      })

    expect(res.status).toBe(200)
    expect(res.body.data.advance).toEqual({
      requested: true,
      hasNext: false,
      currentRuntimePath: 'framework_state.sections.customer_problem',
      currentSectionKey: 'customer_problem',
      nextRuntimePath: '',
      nextSectionKey: '',
      reason: 'CURRENT_SECTION_NOT_PROJECTABLE',
    })
  })

  test('PATCH /api/v1/runtime-instances/:id/data invalidates validation and readiness evidence after a section write', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'READY' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'READY',
          ready: true,
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: '',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          framework_state: expect.objectContaining({
            validation: {},
            readiness: expect.objectContaining({
              state: 'DRAFT',
              ready: false,
              submittedForReview: false,
              validationState: 'UNKNOWN',
              invalidatedByRuntimePath: 'framework_state.sections.customer_problem',
              invalidatedAt: expect.any(String),
            }),
          }),
        }),
      },
      expect.any(Object),
    )
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-inputs persists a real evidence pack with audit', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-hidden-secret',
        pathKey: 'framework_state.sections.hidden_secret',
        label: 'Hidden Secret',
        allowedOperations: ['READ', 'WRITE'],
        displayOrder: 20,
      }),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-write-only',
        pathKey: 'framework_state.sections.write_only',
        label: 'Write Only',
        allowedOperations: ['WRITE'],
        displayOrder: 30,
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          displayOrder: 10,
          isVisible: true,
        },
        {
          sectionKey: 'hidden_secret',
          runtimePath: 'framework_state.sections.hidden_secret',
          displayOrder: 20,
          isVisible: false,
        },
      ],
    })))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
        {
          sectionKey: 'hidden_secret',
          runtimePath: 'framework_state.sections.hidden_secret',
          required: false,
        },
        {
          sectionKey: 'write_only',
          runtimePath: 'framework_state.sections.write_only',
          required: false,
        },
        {
          sectionKey: 'unregistered',
          runtimePath: 'framework_state.sections.unregistered',
          required: false,
        },
      ],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
          notes: 'Use only customer-provided discovery context.',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack).toEqual(expect.objectContaining({
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      needsRefresh: false,
      inputs: {
        companyWebsite: 'https://acme.example',
        companyName: 'Acme',
        marketRegion: 'UK enterprise',
        targetOffer: 'Managed proposal platform',
        notes: 'Use only customer-provided discovery context.',
      },
      evidence: expect.objectContaining({
        source: 'DISCOVERY_INPUTS',
        inputKeys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer', 'notes'],
        missingInputKeys: [],
      }),
      scopedViews: {
        customer_problem: expect.objectContaining({
          source: 'DISCOVERY_EVIDENCE_PACK',
          inputKeys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer', 'notes'],
        }),
      },
    }))
    expect(persistedEvidencePack.scopedViews.hidden_secret).toBeUndefined()
    expect(persistedEvidencePack.scopedViews.write_only).toBeUndefined()
    expect(persistedEvidencePack.scopedViews.unregistered).toBeUndefined()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      diff: expect.objectContaining({
        runtimePath: 'framework_state.evidence_pack',
        operation: 'WRITE',
        previousValue: {},
        nextValue: expect.objectContaining({
          inputComplete: true,
          evidenceReady: true,
        }),
      }),
    }))
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      needsRefresh: false,
      inputSummary: {
        keys: ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer', 'notes'],
        count: 5,
      },
      scopedViewSummary: {
        keys: ['customer_problem'],
        count: 1,
      },
    }))
  })

  test.each([
    ['missing registry path', null, 'is not registered'],
    ['read-only registry path', makeEvidencePackRuntimePathRecord({ allowedOperations: ['READ'] }), 'does not allow WRITE'],
    ['protected registry path', makeEvidencePackRuntimePathRecord({ isProtected: true }), 'protected from runtime writes'],
  ])('rejects discovery input writes when the evidence pack path is %s', async (_caseName, pathRecord, messageFragment) => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(pathRecord))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_INVALID_PATH')
    expect(res.body.error.details.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining(messageFragment),
      }),
    ]))
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects stale discovery input writes before state or audit persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:30:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_STALE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects discovery input writes when the actor lacks mutation access', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(403)
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects undocumented discovery refresh flags', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        refreshEvidence: false,
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details._root).toContain('Unrecognized key')
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('discovery input writes with incomplete required inputs persist input-required evidence without scoped views', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyName: 'Acme',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack).toEqual(expect.objectContaining({
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      scopedViews: {},
      state: expect.objectContaining({
        status: 'INPUT_REQUIRED',
      }),
      evidence: expect.objectContaining({
        missingInputKeys: ['companyWebsite', 'marketRegion', 'targetOffer'],
      }),
    }))
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      inputComplete: false,
      evidenceReady: false,
      scopedViewSummary: {
        keys: [],
        count: 0,
      },
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
    }))
  })

  test('rolls back discovery input writes when audit persistence fails', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {},
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          evidence_pack: {
            inputComplete: true,
            evidenceReady: true,
          },
        },
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-inputs`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          marketRegion: 'UK enterprise',
          targetOffer: 'Managed proposal platform',
        },
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('PATCH /api/v1/runtime-instances/:id/discovery-acceptance persists accepted discovery truth with audit', async () => {
    const evidencePack = makeReadyDiscoveryEvidencePack()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:02:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedEvidencePack = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.evidence_pack
    expect(persistedEvidencePack).toEqual(expect.objectContaining({
      inputComplete: true,
      evidenceReady: true,
      accepted: true,
      needsRefresh: false,
      acceptedAt: expect.any(String),
      acceptedBy: CUSTOMER_ADMIN_ID,
      state: expect.objectContaining({
        status: 'ACCEPTED',
        accepted: true,
        needsRefresh: false,
      }),
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      diff: expect.objectContaining({
        runtimePath: 'framework_state.evidence_pack',
        operation: 'WRITE',
        previousValue: evidencePack,
        nextValue: expect.objectContaining({
          accepted: true,
          acceptedBy: CUSTOMER_ADMIN_ID,
        }),
      }),
    }))
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      inputComplete: true,
      evidenceReady: true,
      accepted: true,
      needsRefresh: false,
      acceptedAt: expect.any(String),
      acceptedBy: CUSTOMER_ADMIN_ID,
    }))
  })

  test.each([
    ['missing evidence pack', {}, 'Discovery evidence must be refreshed before it can be accepted.'],
    ['incomplete evidence pack', {
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      needsRefresh: false,
      state: { status: 'INPUT_REQUIRED', inputComplete: false, evidenceReady: false },
    }, 'Discovery evidence is not ready for acceptance.'],
    ['stale evidence pack', {
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      needsRefresh: true,
      state: { status: 'NEEDS_REFRESH', inputComplete: true, evidenceReady: true, needsRefresh: true },
    }, 'Discovery evidence must be refreshed before acceptance.'],
    ['already accepted evidence pack', {
      inputComplete: true,
      evidenceReady: true,
      accepted: true,
      needsRefresh: false,
      state: { status: 'ACCEPTED', inputComplete: true, evidenceReady: true, accepted: true },
    }, 'Discovery evidence is already accepted.'],
    ['flag-only evidence pack', {
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      needsRefresh: false,
      state: { status: 'EVIDENCE_READY', inputComplete: true, evidenceReady: true },
    }, 'Discovery evidence is incomplete and must be refreshed before acceptance.'],
  ])('rejects discovery acceptance for %s', async (_caseName, evidencePack, message) => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe(message)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects stale discovery acceptance before state or audit persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:30:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack(),
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_STALE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects discovery acceptance when the actor lacks mutation access', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: makeReadyDiscoveryEvidencePack(),
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(403)
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects discovery acceptance when the evidence pack path is not writable', async () => {
    const evidencePack = makeReadyDiscoveryEvidencePack()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord({
      allowedOperations: ['READ'],
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_INVALID_PATH')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rolls back discovery acceptance when audit persistence fails', async () => {
    const evidencePack = makeReadyDiscoveryEvidencePack()
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: evidencePack,
        sections: {},
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          evidence_pack: {
            ...evidencePack,
            accepted: true,
          },
        },
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:03:00.000Z'),
      }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeEvidencePackRuntimePathRecord()))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/discovery-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:01:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('PATCH /api/v1/runtime-instances/:id/section-acceptance persists accepted section truth with audit', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              format: 'TEXT',
              content: 'Customer Problem: Proposal creation is slow.',
              summary: 'Generated from current runtime input.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              actionKey: 'GENERATE_SECTION',
              inputHash: 'hash-1',
            },
            accepted: null,
            review: {
              status: 'PENDING_REVIEW',
            },
            state: {
              status: 'GENERATED',
              revisionCount: 0,
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:02:00.000Z'),
    }))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.customer_problem
    expect(persistedSection.accepted).toEqual(expect.objectContaining({
      content: 'Customer Problem: Proposal creation is slow.',
      acceptedBy: CUSTOMER_ADMIN_ID,
      sourceActionKey: 'GENERATE_SECTION',
      sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
      inputHash: 'hash-1',
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
    }))
    expect(persistedSection.generated).toEqual(runtimeInstanceDoc.framework_state.sections.customer_problem.generated)
    expect(persistedSection.review).toEqual(expect.objectContaining({
      status: 'ACCEPTED',
      acceptedBy: CUSTOMER_ADMIN_ID,
    }))
    expect(persistedSection.state).toEqual(expect.objectContaining({
      status: 'ACCEPTED',
      acceptedBy: CUSTOMER_ADMIN_ID,
      acceptedSourceGeneratedAt: '2026-05-19T08:01:00.000Z',
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_STATE_MUTATED',
      resourceType: 'RuntimeInstance',
      diff: expect.objectContaining({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        previousValue: null,
        nextValue: expect.objectContaining({
          content: 'Customer Problem: Proposal creation is slow.',
          sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
        }),
      }),
    }))
    expect(res.body.data.section).toEqual(expect.objectContaining({
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      accepted: expect.objectContaining({
        content: 'Customer Problem: Proposal creation is slow.',
      }),
      previousAccepted: null,
    }))
  })

  test('rejects section acceptance before generated content exists without state or audit persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: null,
            review: {},
            state: { status: 'DRAFT' },
            lineage: {},
            revisions: [],
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects already-current section acceptance without state or audit persistence', async () => {
    const generated = {
      content: 'Customer Problem: Proposal creation is slow.',
      generatedAt: '2026-05-19T08:01:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: 'hash-1',
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated,
            accepted: {
              content: generated.content,
              sourceGeneratedAt: generated.generatedAt,
              inputHash: generated.inputHash,
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED' },
            lineage: {},
            revisions: [],
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe('Runtime section generated content is already accepted.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects legacy already-accepted section content without source metadata', async () => {
    const generated = {
      content: 'Customer Problem: Proposal creation is slow.',
      actionKey: 'GENERATE_SECTION',
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated,
            accepted: {
              content: generated.content,
              acceptedAt: '2026-05-19T08:02:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
            },
            review: { status: 'ACCEPTED' },
            state: { status: 'ACCEPTED' },
            lineage: {},
            revisions: [],
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe('Runtime section generated content is already accepted.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects stale section acceptance and target mismatches before persistence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-1',
            },
          },
        },
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
        },
      ],
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const staleRes = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T07:59:00.000Z',
      })

    expect(staleRes.status).toBe(409)
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()

    const mismatchRes = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sectionKey: 'customer_problem',
        runtimePath: 'framework_state.sections.value_drivers',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(mismatchRes.status).toBe(422)
    expect(mismatchRes.body.error.details.reason).toBe('RUNTIME_ACTION_TARGET_MISMATCH')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rolls back section acceptance when audit persistence fails', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              format: 'TEXT',
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              actionKey: 'GENERATE_SECTION',
              inputHash: 'hash-1',
            },
            accepted: null,
            review: { status: 'PENDING_REVIEW' },
            state: { status: 'GENERATED', revisionCount: 0 },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          sections: {
            customer_problem: {
              ...runtimeInstanceDoc.framework_state.sections.customer_problem,
              accepted: {
                content: 'Customer Problem: Proposal creation is slow.',
              },
            },
          },
        },
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:03:00.000Z'),
      }))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/section-acceptance`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        sectionKey: 'customer_problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('PATCH /api/v1/runtime-instances/:id/data updates section input without discarding generated lineage', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
            },
            review: {
              status: 'PENDING_REVIEW',
            },
            state: {
              status: 'GENERATED',
              revisionCount: 1,
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
              actionKey: 'GENERATE_SECTION',
            },
            revisions: [
              {
                revisionNumber: 1,
                generated: {
                  content: 'Customer Problem: Older generated content.',
                },
                replacedAt: '2026-05-19T08:01:00.000Z',
              },
            ],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord()))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Proposal teams lack a shared story.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(200)
    const persistedSection = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections.customer_problem
    expect(persistedSection).toEqual(expect.objectContaining({
      input: 'Proposal teams lack a shared story.',
      generated: expect.objectContaining({
        content: 'Customer Problem: Proposal creation is slow.',
      }),
      review: {
        status: 'PENDING_REVIEW',
      },
      state: expect.objectContaining({
        status: 'GENERATED',
        revisionCount: 1,
      }),
      lineage: expect.objectContaining({
        sectionKey: 'customer_problem',
        runtimePath: 'framework_state.sections.customer_problem',
      }),
      revisions: [
        expect.objectContaining({
          revisionNumber: 1,
        }),
      ],
    }))
    expect(res.body.data.mutation).toEqual(expect.objectContaining({
      previousValue: 'Proposal creation is slow.',
      value: 'Proposal teams lack a shared story.',
    }))
  })

  test('rejects runtime state mutation outside framework_state.sections scope', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.lifecycle.stage',
        operation: 'WRITE',
        value: 'READY',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_FORBIDDEN_PATH')
    expect(RuntimeInstance.prototype.save).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime state mutation when the registered path lacks WRITE', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord({
      allowedOperations: ['READ'],
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_INVALID_PATH')
    expect(res.body.error.details.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('does not allow WRITE'),
      }),
    ]))
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime state mutation when the registered path is protected', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimePathRecord({
      isProtected: true,
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_INVALID_PATH')
    expect(res.body.error.details.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('protected from runtime writes'),
      }),
    ]))
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects stale runtime state mutation before writing state or audit', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:30:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_STALE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime state mutation when the atomic updatedAt guard loses a write race', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn().mockResolvedValue(null)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_STALE')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          framework_state: expect.any(Object),
        }),
      }),
      {
        new: true,
        runValidators: true,
      },
    )
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime state mutation when the actor lacks VMF_UPDATE access', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('FORBIDDEN')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime state mutation for non-Value Narrative runtime types in Sprint 1', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      runtimeType: 'DEAL_ANALYSIS',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_UNSUPPORTED_RUNTIME_TYPE')
    expect(res.body.error.details.supportedRuntimeTypes).toEqual(['VALUE_NARRATIVE'])
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rolls back a non-transactional runtime state mutation when audit persistence fails', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Original problem.',
        },
        validation: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          sections: {
            customer_problem: 'Updated problem.',
          },
        },
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Updated problem.',
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_STATE_MUTATION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('POST /api/v1/runtime-instances/:id/actions/RUN_VALIDATION persists governed validation and audit evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'READY',
          ready: true,
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      },
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            validation: expect.objectContaining({
              runtime_required_sections: expect.objectContaining({
                is_valid: true,
                status: 'PASSED',
              }),
            }),
            readiness: expect.objectContaining({
              state: 'VALIDATED',
              validationState: 'PASSED',
              lastActionKey: 'RUN_VALIDATION',
            }),
          }),
          updatedBy: CUSTOMER_ADMIN_ID,
        }),
      },
      {
        new: true,
        runValidators: true,
      },
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      scope: expect.objectContaining({
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeInstanceId: RUNTIME_INSTANCE_ID,
        runtimeInstanceKey: 'value-narrative-439111',
      }),
      diff: expect.objectContaining({
        actionKey: 'RUN_VALIDATION',
        governedAction: 'RUN_VALIDATION',
        executionStatus: {
          from: 'IDLE',
          to: 'IDLE',
        },
        validation: expect.objectContaining({
          key: 'runtime_required_sections',
          status: 'PASSED',
          is_valid: true,
        }),
      }),
    }))
    expect(res.body.data.state.readiness).toEqual(expect.objectContaining({
      state: 'VALIDATED',
      validationState: 'PASSED',
    }))
  })

  test('RUN_VALIDATION records blocked readiness when required runtime sections are missing', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {},
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'BLOCKED',
          framework_state: expect.objectContaining({
            validation: expect.objectContaining({
              runtime_required_sections: expect.objectContaining({
                is_valid: false,
                status: 'FAILED',
                missingRequiredSections: [
                  {
                    sectionKey: 'customer_problem',
                    runtimePath: 'framework_state.sections.customer_problem',
                  },
                ],
              }),
            }),
            readiness: expect.objectContaining({
              state: 'BLOCKED',
              validationState: 'FAILED',
              lastActionKey: 'RUN_VALIDATION',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        validation: expect.objectContaining({
          status: 'FAILED',
          is_valid: false,
        }),
      }),
    }))
  })

  test('rejects MARK_READY before validation evidence has passed', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('MARK_READY')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('MARK_READY')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('MARK_READY')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/MARK_READY`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Run validation successfully')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects MARK_READY when stale validation evidence no longer matches required section state', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: '',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'VALIDATED',
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('MARK_READY')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('MARK_READY')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('MARK_READY')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/MARK_READY`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Run validation successfully')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('MARK_READY transitions a currently valid runtime to ready', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'VALIDATED',
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('MARK_READY')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('MARK_READY')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('MARK_READY')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/MARK_READY`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            lifecycle: expect.objectContaining({
              stage: 'READY',
            }),
            readiness: expect.objectContaining({
              state: 'READY',
              ready: true,
              lastActionKey: 'MARK_READY',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
  })

  test('SUBMIT_FOR_REVIEW transitions a ready runtime into review and waiting approval', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'READY' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'READY',
          ready: true,
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('SUBMIT_FOR_REVIEW')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('SUBMIT_FOR_REVIEW')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('SUBMIT_FOR_REVIEW')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/SUBMIT_FOR_REVIEW`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'WAITING_APPROVAL',
          framework_state: expect.objectContaining({
            lifecycle: expect.objectContaining({
              stage: 'IN_REVIEW',
            }),
            readiness: expect.objectContaining({
              state: 'IN_REVIEW',
              submittedForReview: true,
              lastActionKey: 'SUBMIT_FOR_REVIEW',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        executionStatus: {
          from: 'IDLE',
          to: 'WAITING_APPROVAL',
        },
      }),
    }))
  })

  test('SAVE_DRAFT returns readiness to draft without requiring validation evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'READY' },
        sections: {},
        validation: {},
        readiness: {
          state: 'READY',
          ready: true,
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('SAVE_DRAFT')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('SAVE_DRAFT')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('SAVE_DRAFT')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/SAVE_DRAFT`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            lifecycle: expect.objectContaining({
              stage: 'DRAFT',
            }),
            readiness: expect.objectContaining({
              state: 'DRAFT',
              ready: false,
              submittedForReview: false,
              lastActionKey: 'SAVE_DRAFT',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
  })

  test('RETURN_TO_DRAFT transitions an in-review runtime back to draft', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      executionStatus: 'WAITING_APPROVAL',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'IN_REVIEW' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'IN_REVIEW',
          ready: true,
          submittedForReview: true,
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RETURN_TO_DRAFT')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RETURN_TO_DRAFT')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RETURN_TO_DRAFT')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RETURN_TO_DRAFT`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            lifecycle: expect.objectContaining({
              stage: 'DRAFT',
            }),
            readiness: expect.objectContaining({
              state: 'DRAFT',
              ready: false,
              submittedForReview: false,
              lastActionKey: 'RETURN_TO_DRAFT',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
  })

  test('APPROVE transitions an in-review runtime into approved state with audit evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      executionStatus: 'WAITING_APPROVAL',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'IN_REVIEW' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'IN_REVIEW',
          ready: true,
          submittedForReview: true,
          submittedAt: '2026-05-19T07:55:00.000Z',
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('APPROVE')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('APPROVE')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('APPROVE')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/APPROVE`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            lifecycle: expect.objectContaining({
              stage: 'APPROVED',
              approvedAt: expect.any(String),
              approvedBy: CUSTOMER_ADMIN_ID,
            }),
            readiness: expect.objectContaining({
              state: 'APPROVED',
              approved: true,
              lastActionKey: 'APPROVE',
            }),
          }),
        }),
      },
      expect.any(Object),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        actionKey: 'APPROVE',
        lifecycle: expect.objectContaining({
          to: expect.objectContaining({ stage: 'APPROVED' }),
        }),
      }),
    }))
  })

  test('rejects APPROVE without review submission evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      executionStatus: 'WAITING_APPROVAL',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'IN_REVIEW' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'IN_REVIEW',
          ready: true,
          submittedForReview: true,
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('APPROVE')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('APPROVE')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('APPROVE')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/APPROVE`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('review submission evidence')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('PUBLISH records publish evidence only after approval and current validation', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: {
          stage: 'APPROVED',
          approvedAt: '2026-05-19T08:00:00.000Z',
          approvedBy: CUSTOMER_ADMIN_ID,
        },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'APPROVED',
          approved: true,
          approvedAt: '2026-05-19T08:00:00.000Z',
          approvedBy: CUSTOMER_ADMIN_ID,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {},
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('PUBLISH')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('PUBLISH')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('PUBLISH')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/PUBLISH`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    const persistedState = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state
    expect(persistedState.lifecycle).toEqual(expect.objectContaining({
      stage: 'PUBLISHED',
      publishedAt: expect.any(String),
      publishedBy: CUSTOMER_ADMIN_ID,
    }))
    expect(persistedState.publish).toEqual(expect.objectContaining({
      state: 'PUBLISHED',
      published: true,
      outputEligible: true,
      evidence: expect.objectContaining({
        activationId: 'activation-vmf-2-3-1-001',
        deploymentId: 'deployment-vmf-global-production-001',
        dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
      }),
    }))
    expect(res.body.data.state.publish).toEqual(expect.objectContaining({
      published: true,
      outputEligible: true,
    }))
  })

  test('rejects PUBLISH before approval evidence exists', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'READY' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'READY',
          ready: true,
          validationState: 'PASSED',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('PUBLISH')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('PUBLISH')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('PUBLISH')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/PUBLISH`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Approve this runtime')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects PUBLISH when approved labels lack approval evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'APPROVED' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'APPROVED',
          approved: true,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {},
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('PUBLISH')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('PUBLISH')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('PUBLISH')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/PUBLISH`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Approve this runtime')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('LOCK_RECORD freezes a published runtime as canonical truth', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: {
          stage: 'PUBLISHED',
          publishedAt: '2026-05-19T08:00:00.000Z',
          publishedBy: CUSTOMER_ADMIN_ID,
        },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'PUBLISHED',
          published: true,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {
          state: 'PUBLISHED',
          published: true,
          publishedAt: '2026-05-19T08:00:00.000Z',
          publishedBy: CUSTOMER_ADMIN_ID,
          outputEligible: true,
          sourceApproval: {
            approvedAt: '2026-05-19T07:55:00.000Z',
            approvedBy: CUSTOMER_ADMIN_ID,
          },
          evidence: {
            activationId: 'activation-vmf-2-3-1-001',
            deploymentId: 'deployment-vmf-global-production-001',
            dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
            dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
          },
        },
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('LOCK_RECORD')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('LOCK_RECORD')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('LOCK_RECORD')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RECORD`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(200)
    const persistedSet = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set
    expect(persistedSet).toEqual(expect.objectContaining({
      status: 'LOCKED',
      executionStatus: 'COMPLETE',
      lockedAt: expect.any(Date),
      lockedBy: CUSTOMER_ADMIN_ID,
      lockedReason: 'Runtime published truth locked for downstream canonical use.',
    }))
    expect(persistedSet.framework_state.lifecycle).toEqual(expect.objectContaining({
      stage: 'LOCKED',
      lockedAt: expect.any(String),
    }))
    expect(persistedSet.framework_state.lock).toEqual(expect.objectContaining({
      state: 'LOCKED',
      locked: true,
      evidence: expect.objectContaining({
        activationId: 'activation-vmf-2-3-1-001',
        deploymentId: 'deployment-vmf-global-production-001',
      }),
      anchor: expect.objectContaining({
        relationship: 'LOCKED_VALUE_NARRATIVE',
        runtimeInstanceKey: 'value-narrative-439111',
      }),
    }))
    expect(res.body.data.runtimeInstance).toEqual(expect.objectContaining({
      status: 'LOCKED',
      executionStatus: 'COMPLETE',
      lockedAt: expect.any(String),
    }))
  })

  test('rejects LOCK_RECORD before publish evidence exists', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'PUBLISHED' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'PUBLISHED',
          approved: true,
          published: true,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {},
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('LOCK_RECORD')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('LOCK_RECORD')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('LOCK_RECORD')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RECORD`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Publish this runtime')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects LOCK_RECORD when publish evidence is partial', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: {
          stage: 'PUBLISHED',
          publishedAt: '2026-05-19T08:00:00.000Z',
          publishedBy: CUSTOMER_ADMIN_ID,
        },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'PUBLISHED',
          approved: true,
          published: true,
          ready: true,
          validationState: 'PASSED',
        },
        publish: {
          state: 'PUBLISHED',
          published: true,
          publishedAt: '2026-05-19T08:00:00.000Z',
          outputEligible: true,
          evidence: {
            activationId: 'activation-vmf-2-3-1-001',
          },
        },
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('LOCK_RECORD')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('LOCK_RECORD')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('LOCK_RECORD')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RECORD`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('Publish this runtime')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test.each([
    ['APPROVED', 'approved'],
    ['PUBLISHED', 'published'],
  ])('rejects section mutation after a runtime is %s', async (lifecycleStage, messageFragment) => {
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:10:00.000Z'),
      framework_state: {
        lifecycle: { stage: lifecycleStage },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: lifecycleStage,
        },
        publish: {},
        lock: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Mutating locked truth.',
        expectedUpdatedAt: '2026-05-19T08:10:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_NOT_EDITABLE')
    expect(res.body.error.message).toContain(messageFragment)
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects section mutation after a runtime is locked', async () => {
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(makeRuntimeInstanceDocument({
      status: 'LOCKED',
      executionStatus: 'COMPLETE',
      lockedAt: new Date('2026-05-19T08:10:00.000Z'),
      updatedAt: new Date('2026-05-19T08:10:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'LOCKED' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'LOCKED',
          locked: true,
        },
        publish: {
          state: 'PUBLISHED',
          published: true,
          publishedAt: '2026-05-19T08:00:00.000Z',
        },
        lock: {
          state: 'LOCKED',
          locked: true,
          lockedAt: '2026-05-19T08:10:00.000Z',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .patch(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/data`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        runtimePath: 'framework_state.sections.customer_problem',
        operation: 'WRITE',
        value: 'Mutating locked truth.',
        expectedUpdatedAt: '2026-05-19T08:10:00.000Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_MUTATION_NOT_EDITABLE')
    expect(res.body.error.message).toContain('locked')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects mutating runtime actions after lock', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      status: 'LOCKED',
      executionStatus: 'COMPLETE',
      lockedAt: new Date('2026-05-19T08:10:00.000Z'),
      updatedAt: new Date('2026-05-19T08:10:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'LOCKED' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'LOCKED',
          locked: true,
        },
        publish: {
          state: 'PUBLISHED',
          published: true,
          publishedAt: '2026-05-19T08:00:00.000Z',
        },
        lock: {
          state: 'LOCKED',
          locked: true,
          lockedAt: '2026-05-19T08:10:00.000Z',
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:10:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('locked')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('GENERATE_SECTION persists governed generated content and audit evidence', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        runtimePath: 'framework_state.sections.customer_problem',
      })

    expect(res.status).toBe(200)
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          executionStatus: 'IDLE',
          framework_state: expect.objectContaining({
            sections: expect.objectContaining({
              customer_problem: expect.objectContaining({
                input: 'Proposal creation is slow.',
                generated: expect.objectContaining({
                  content: 'Customer Problem: Proposal creation is slow.',
                  actionKey: 'GENERATE_SECTION',
                  generator: expect.objectContaining({
                    mode: 'DETERMINISTIC_TEMPLATE',
                  }),
                  inputHash: expect.any(String),
                }),
                review: expect.objectContaining({
                  status: 'PENDING_REVIEW',
                }),
                state: expect.objectContaining({
                  status: 'GENERATED',
                  lastActionKey: 'GENERATE_SECTION',
                  revisionCount: 0,
                }),
                lineage: expect.objectContaining({
                  sectionKey: 'customer_problem',
                  runtimePath: 'framework_state.sections.customer_problem',
                  actionKey: 'GENERATE_SECTION',
                  inputHash: expect.any(String),
                }),
                revisions: [],
              }),
            }),
            validation: {},
            readiness: expect.objectContaining({
              state: 'DRAFT',
              ready: false,
              submittedForReview: false,
              validationState: 'UNKNOWN',
              invalidatedByRuntimePath: 'framework_state.sections.customer_problem',
              invalidatedAt: expect.any(String),
            }),
          }),
        }),
      },
      expect.any(Object),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUNTIME_ACTION_EXECUTED',
      diff: expect.objectContaining({
        actionKey: 'GENERATE_SECTION',
        generation: expect.objectContaining({
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          revisionCount: 0,
          previousGenerated: false,
          inputHash: expect.any(String),
        }),
      }),
    }))
    expect(res.body.data.state.generation).toEqual(expect.objectContaining({
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      revisionCount: 0,
    }))
  })

  test('rejects direct GENERATE_SECTION when target section has no eligible context', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: '',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn()
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        runtimePath: 'framework_state.sections.customer_problem',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toBe('Add discovery evidence or section context before generating this section.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('GENERATE_SECTION writes generated content under the runtime path section key', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          section_1_executive_summary: 'Show the board why proposal creation is slow.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'section-executive-summary',
          runtimePath: 'framework_state.sections.section_1_executive_summary',
          required: true,
          validationKeys: ['required-sections-check'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord({
        pathKey: 'framework_state.sections.section_1_executive_summary',
        label: 'Executive Summary',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'section-executive-summary',
          runtimePath: 'framework_state.sections.section_1_executive_summary',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Executive Summary',
          displayOrder: 10,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'section-executive-summary',
        runtimePath: 'framework_state.sections.section_1_executive_summary',
      })

    expect(res.status).toBe(200)
    const persistedSections = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state.sections
    expect(persistedSections).toEqual(expect.objectContaining({
      section_1_executive_summary: expect.objectContaining({
        input: 'Show the board why proposal creation is slow.',
        generated: expect.objectContaining({
          content: 'Section Executive Summary: Show the board why proposal creation is slow.',
        }),
        lineage: expect.objectContaining({
          sectionKey: 'section-executive-summary',
          stateSectionKey: 'section_1_executive_summary',
          runtimePath: 'framework_state.sections.section_1_executive_summary',
        }),
      }),
    }))
    expect(persistedSections['section-executive-summary']).toBeUndefined()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({
        generation: expect.objectContaining({
          sectionKey: 'section-executive-summary',
          stateSectionKey: 'section_1_executive_summary',
          runtimePath: 'framework_state.sections.section_1_executive_summary',
        }),
      }),
    }))
    expect(res.body.data.state.generation).toEqual(expect.objectContaining({
      sectionKey: 'section-executive-summary',
      stateSectionKey: 'section_1_executive_summary',
    }))
  })

  test('REGENERATE_SECTION preserves previous generated content as a revision', async () => {
    const previousGenerated = {
      content: 'Customer Problem: Earlier generated narrative.',
      generatedAt: '2026-05-19T07:55:00.000Z',
      actionKey: 'GENERATE_SECTION',
      inputHash: 'old-input-hash',
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: previousGenerated,
            review: { status: 'PENDING_REVIEW' },
            state: { status: 'GENERATED', revisionCount: 0 },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
            },
            revisions: [],
          },
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('REGENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('REGENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('REGENERATE_SECTION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn(async (_filter, update) => makeRuntimeInstanceDocument({
      ...runtimeInstanceDoc,
      ...(update?.$set || {}),
      updatedAt: new Date('2026-05-19T08:01:00.000Z'),
    }))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/REGENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
      })

    expect(res.status).toBe(200)
    const persistedFrameworkState = RuntimeInstance.findOneAndUpdate.mock.calls[0][1].$set.framework_state
    expect(persistedFrameworkState.sections.customer_problem).toEqual(expect.objectContaining({
      input: 'Proposal creation is slow.',
      generated: expect.objectContaining({
        content: 'Customer Problem: Proposal creation is slow.',
        actionKey: 'REGENERATE_SECTION',
      }),
      state: expect.objectContaining({
        status: 'REGENERATED',
        revisionCount: 1,
      }),
      revisions: [
        expect.objectContaining({
          revisionNumber: 1,
          generated: previousGenerated,
          replacedAt: expect.any(String),
        }),
      ],
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({
        actionKey: 'REGENERATE_SECTION',
        generation: expect.objectContaining({
          sectionKey: 'customer_problem',
          revisionCount: 1,
          previousGenerated: true,
        }),
      }),
    }))
  })

  test('rejects REGENERATE_SECTION before generated content exists', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('REGENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('REGENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('REGENERATE_SECTION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/REGENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects section generation without a request target', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(422)
    expect(res.body.error.details._root).toBe('Generation actions require runtimePath or sectionKey.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects non-generation runtime actions that include section targets', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        runtimePath: 'framework_state.sections.customer_problem',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details._root).toBe('runtimePath and sectionKey are only allowed for generation actions.')
    expect(RuntimeInstance.findOne).not.toHaveBeenCalled()
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects section generation when sectionKey and runtimePath target different package sections', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
          value_drivers: 'Manual revenue reporting creates delay.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
          validationKeys: ['required-sections-check'],
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Customer Problem',
          displayOrder: 10,
          isVisible: true,
          isEditable: true,
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 20,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/GENERATE_SECTION`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        expectedUpdatedAt: '2026-05-19T08:00:00.000Z',
        sectionKey: 'customer_problem',
        runtimePath: 'framework_state.sections.value_drivers',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_TARGET_MISMATCH')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects non-return actions from persisted in-review state even when execution is idle', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      executionStatus: 'IDLE',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'IN_REVIEW' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {
          runtime_required_sections: {
            is_valid: true,
            status: 'PASSED',
          },
        },
        readiness: {
          state: 'IN_REVIEW',
          ready: true,
          submittedForReview: true,
        },
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('MARK_READY')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('MARK_READY')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('MARK_READY')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/MARK_READY`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('waiting for review')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects stale runtime actions when the atomic updatedAt guard loses a write race', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn().mockResolvedValue(null)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_STALE')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime action execution when the actor lacks VMF_UPDATE access', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('FORBIDDEN')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects unsupported runtime action keys before resolving runtime state', async () => {
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RUNTIME`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_UNSUPPORTED')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects action execution for unsupported runtime types', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      runtimeType: 'DEAL_ANALYSIS',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    RuntimeInstance.findOne = jest.fn().mockResolvedValue(runtimeInstanceDoc)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_UNSUPPORTED_RUNTIME_TYPE')
    expect(res.body.error.details.supportedRuntimeTypes).toEqual(['VALUE_NARRATIVE'])
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime actions that are not declared by the renderer projection', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_DECLARED')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('rejects runtime actions when the runtime instance is inactive', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      status: 'ARCHIVED',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('active runtime instance')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects runtime actions when execution is terminal', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      executionStatus: 'COMPLETE',
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toContain('blocked while execution is in progress or terminal')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rejects renderer-projected action denial from workflow policy decision mode', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([
      makeActionWorkflowPolicy('RUN_VALIDATION', { decisionMode: 'DENY' }),
    ]))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_NOT_AVAILABLE')
    expect(res.body.error.details.disabledReason).toBe('Workflow policy decision mode is not executable by the renderer.')
    expect(RuntimeInstance.findOneAndUpdate).not.toHaveBeenCalled()
  })

  test('rolls back a non-transactional runtime action when audit persistence fails', async () => {
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedBy: CUSTOMER_ADMIN_ID,
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
        },
        validation: {},
        readiness: {},
        policy: {},
        attachments: {},
        artifacts: {},
      },
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('RUN_VALIDATION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('RUN_VALIDATION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('RUN_VALIDATION')]))
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        framework_state: {
          ...runtimeInstanceDoc.framework_state,
          readiness: { state: 'VALIDATED' },
        },
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/RUN_VALIDATION`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_ACTION_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      },
      {
        $set: {
          framework_state: runtimeInstanceDoc.framework_state,
          executionStatus: runtimeInstanceDoc.executionStatus,
          status: runtimeInstanceDoc.status,
          lockedAt: null,
          lockedBy: null,
          lockedReason: '',
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
  })

  test('rolls back LOCK_RECORD fields when audit persistence fails', async () => {
    const publishedFrameworkState = {
      lifecycle: {
        stage: 'PUBLISHED',
        publishedAt: '2026-05-19T08:00:00.000Z',
        publishedBy: CUSTOMER_ADMIN_ID,
      },
      sections: {
        customer_problem: 'Proposal creation is slow.',
      },
      validation: {
        runtime_required_sections: {
          is_valid: true,
          status: 'PASSED',
        },
      },
      readiness: {
        state: 'PUBLISHED',
        approved: true,
        published: true,
        ready: true,
        validationState: 'PASSED',
      },
      publish: {
        state: 'PUBLISHED',
        published: true,
        publishedAt: '2026-05-19T08:00:00.000Z',
        publishedBy: CUSTOMER_ADMIN_ID,
        outputEligible: true,
        sourceApproval: {
          approvedAt: '2026-05-19T07:55:00.000Z',
          approvedBy: CUSTOMER_ADMIN_ID,
        },
        evidence: {
          activationId: 'activation-vmf-2-3-1-001',
          deploymentId: 'deployment-vmf-global-production-001',
          dependencySnapshotId: 'dep-lock-vmf-standard-2-3-1',
          dependencySnapshotHash: 'hash-vmf-standard-2-3-1',
        },
      },
      lock: {},
      policy: {},
      attachments: {},
      artifacts: {},
    }
    const runtimeInstanceDoc = makeRuntimeInstanceDocument({
      updatedBy: CUSTOMER_ADMIN_ID,
      updatedAt: new Date('2026-05-19T08:00:00.000Z'),
      framework_state: publishedFrameworkState,
    })
    mockRuntimeInstanceForActionExecution({ document: runtimeInstanceDoc })
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('LOCK_RECORD')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('LOCK_RECORD')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('LOCK_RECORD')]))
    RuntimeInstance.findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        status: 'LOCKED',
        executionStatus: 'COMPLETE',
        lockedAt: new Date('2026-05-19T08:01:00.000Z'),
        lockedBy: CUSTOMER_ADMIN_ID,
        lockedReason: 'Runtime published truth locked for downstream canonical use.',
        framework_state: {
          ...publishedFrameworkState,
          lifecycle: { stage: 'LOCKED' },
          lock: { state: 'LOCKED', locked: true },
        },
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      }))
      .mockResolvedValueOnce(makeRuntimeInstanceDocument({
        ...runtimeInstanceDoc,
        updatedAt: new Date('2026-05-19T08:02:00.000Z'),
      }))
    AuditLog.createLog = jest.fn(async () => {
      throw new Error('audit unavailable')
    })
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .post(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/actions/LOCK_RECORD`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedUpdatedAt: '2026-05-19T08:00:00.000Z' })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('RUNTIME_ACTION_AUDIT_FAILED')
    expect(RuntimeInstance.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.findOneAndUpdate.mock.calls[1]).toEqual([
      {
        _id: RUNTIME_INSTANCE_ID,
        updatedAt: new Date('2026-05-19T08:01:00.000Z'),
      },
      {
        $set: {
          framework_state: publishedFrameworkState,
          executionStatus: 'IDLE',
          status: 'ACTIVE',
          lockedAt: null,
          lockedBy: null,
          lockedReason: '',
          updatedBy: CUSTOMER_ADMIN_ID,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ])
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
        generationEligibility: expect.objectContaining({
          canGenerate: true,
          reason: '',
          sources: ['SECTION_CONTEXT'],
        }),
      }),
    ])
    expect(res.body.data.discovery).toEqual({
      state: {
        status: 'EVIDENCE_NOT_READY',
      },
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      needsRefresh: false,
      scopedViews: {},
      inputSummary: {
        keys: [],
        count: 0,
      },
      evidenceSummary: {
        keys: [],
        count: 0,
      },
      scopedViewSummary: {
        keys: [],
        count: 0,
      },
      inputValues: {},
    })
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        buttonLabel: 'Submit for Review',
        enabled: false,
        disabledReason: 'Mark this runtime ready after successful validation before submitting for review.',
        requiresConfirmation: true,
        confirmationMessage: 'Submit this framework for review?',
        policyKey: 'submit-for-review-policy',
      }),
    ])
    expect(res.body.data.validation).toEqual(expect.objectContaining({
      state: 'UNKNOWN',
      messages: [],
    }))
    expect(res.body.data.readiness).toEqual(expect.objectContaining({
      state: 'DRAFT',
      ready: false,
      submittedForReview: false,
    }))
    expect(res.body.data.signals).toEqual([])
    expect(res.body.data.activity).toEqual([])
    expect(res.body.data.runtimeInstance.framework_state).toBeUndefined()
    expect(res.body.data.frameworkState).toBeUndefined()
    expect(res.body.data.runtimeData).toEqual({
      readablePaths: [],
    })
    expect(res.body.data.diagnostics.runtimePathVisibility).toBe('HIDDEN')
    expect(res.body.data.diagnostics.configWarnings).toEqual([])
    expect(res.body.meta.renderTraceId).toMatch(/^render-/)
  })

  test('projects runtime activity from persisted audit rows without exposing raw audit payloads', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    const auditFindChain = buildAuditLogFindChain([
      {
        _id: '64f000000000000000000001',
        ts: '2026-05-19T08:04:00.000Z',
        action: 'RUNTIME_STATE_MUTATED',
        resourceType: 'RuntimeInstance',
        resourceId: RUNTIME_INSTANCE_ID,
        summary: 'Customer Problem saved.',
        display: {
          actorLabel: 'Jill Faithful',
        },
        scope: {
          customerId: CUSTOMER_ID,
          runtimeInstanceId: RUNTIME_INSTANCE_ID,
        },
        diff: {
          after: {
            'framework_state.sections.customer_problem.input': 'Proposal creation is slow.',
          },
        },
      },
      {
        _id: '64f000000000000000000002',
        ts: '2026-05-19T08:03:00.000Z',
        action: 'RUNTIME_ACTION_EXECUTED',
        resourceType: 'RuntimeInstance',
        resourceId: RUNTIME_INSTANCE_ID,
        display: {
          title: 'Validation ran',
        },
      },
    ])
    AuditLog.find = jest.fn().mockReturnValue(auditFindChain)
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(AuditLog.find).toHaveBeenCalledWith({
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
    })
    expect(auditFindChain.sort).toHaveBeenCalledWith({ ts: -1 })
    expect(auditFindChain.limit).toHaveBeenCalledWith(10)
    expect(res.body.data.signals).toEqual([])
    expect(res.body.data.activity).toEqual([
      {
        eventId: '64f000000000000000000001',
        action: 'RUNTIME_STATE_MUTATED',
        summary: 'Runtime state updated',
        occurredAt: '2026-05-19T08:04:00.000Z',
        actorLabel: 'Jill Faithful',
      },
      {
        eventId: '64f000000000000000000002',
        action: 'RUNTIME_ACTION_EXECUTED',
        summary: 'Runtime action executed',
        occurredAt: '2026-05-19T08:03:00.000Z',
      },
    ])
    expect(res.body.data.activity[0].diff).toBeUndefined()
    expect(res.body.data.activity[0].scope).toBeUndefined()
    expect(res.body.data.activity[0].resourceId).toBeUndefined()
  })

  test('projects accepted section truth from framework_state without deriving it from generated content', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Generated but not final.',
              generatedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-1',
            },
            accepted: {
              content: 'Accepted customer problem truth.',
              acceptedAt: '2026-05-19T08:02:00.000Z',
              acceptedBy: CUSTOMER_ADMIN_ID,
              sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
              inputHash: 'hash-1',
            },
            review: {
              status: 'ACCEPTED',
            },
            state: {
              status: 'ACCEPTED',
            },
            lineage: {},
            revisions: [],
          },
        },
      },
    })))
    const token = await getAccessTokenForUser(makeCustomerAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections[0].generated).toEqual(expect.objectContaining({
      content: 'Generated but not final.',
    }))
    expect(res.body.data.sections[0].accepted).toEqual(expect.objectContaining({
      content: 'Accepted customer problem truth.',
      acceptedBy: CUSTOMER_ADMIN_ID,
      sourceGeneratedAt: '2026-05-19T08:01:00.000Z',
    }))
  })

  test('projects real discovery evidence pack state without fabricating evidence content', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {
          state: {
            status: 'ACCEPTED',
          },
          inputComplete: true,
          evidenceReady: true,
          accepted: true,
          acceptedAt: '2026-05-24T09:00:00.000Z',
          inputs: {
            source: 'customer-interview',
          },
          evidence: {
            priorities: ['Reduce proposal cycle time'],
          },
          scopedViews: {
            customer_problem: {
              summary: 'Proposal teams need a shared governed narrative.',
            },
          },
        },
        sections: {
          customer_problem: '',
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
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      state: expect.objectContaining({
        status: 'ACCEPTED',
      }),
      inputComplete: true,
      evidenceReady: true,
      accepted: true,
      needsRefresh: false,
      acceptedAt: '2026-05-24T09:00:00.000Z',
      inputSummary: {
        keys: ['source'],
        count: 1,
      },
      evidenceSummary: {
        keys: ['priorities'],
        count: 1,
      },
      scopedViewSummary: {
        keys: ['customer_problem'],
        count: 1,
      },
      scopedViews: {
        customer_problem: {
          summary: 'Proposal teams need a shared governed narrative.',
        },
      },
    }))
    expect(res.body.data.sections[0].generationEligibility).toEqual(expect.objectContaining({
      canGenerate: true,
      sources: ['DISCOVERY_ACCEPTED'],
    }))
    expect(res.body.data.discovery.inputs).toBeUndefined()
    expect(res.body.data.discovery.evidence).toBeUndefined()
    expect(res.body.data.runtimeInstance.framework_state).toBeUndefined()
    expect(res.body.data.frameworkState).toBeUndefined()
  })

  test('normalizes discovery booleans strictly and keeps stale accepted evidence ineligible', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        evidence_pack: {
          state: {
            status: 'ACCEPTED',
            inputComplete: 'false',
            evidenceReady: 'false',
            accepted: 'false',
            needsRefresh: true,
          },
          inputComplete: 'false',
          evidenceReady: 'false',
          accepted: true,
          needsRefresh: true,
          inputs: {
            source: 'customer-interview',
          },
          evidence: {
            priorities: ['Reduce proposal cycle time'],
          },
        },
        sections: {
          customer_problem: '',
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
    expect(res.body.data.discovery).toEqual(expect.objectContaining({
      state: expect.objectContaining({
        status: 'NEEDS_REFRESH',
      }),
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      needsRefresh: true,
    }))
    expect(res.body.data.sections[0].generationEligibility).toEqual(expect.objectContaining({
      canGenerate: false,
      sources: [],
    }))
  })

  test('disables section generation eligibility when no discovery or section context exists', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: '',
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
    expect(res.body.data.sections[0].generationEligibility).toEqual({
      canGenerate: false,
      reason: 'Add discovery evidence or section context before generating this section.',
      sources: [],
      dependencySectionKeys: [],
      satisfiedDependencySectionKeys: [],
    })
    expect(res.body.data.actions).toEqual([
      expect.objectContaining({
        actionKey: 'GENERATE_SECTION',
        enabled: true,
      }),
    ])
  })

  test('enables section generation eligibility from satisfied declared dependency context only', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
          validationKeys: ['required-sections-check'],
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
          dependsOnSectionKeys: ['customer_problem'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        makeUIContract().sections[0],
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 20,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: 'Proposal creation is slow.',
          value_drivers: '',
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
    const valueDrivers = res.body.data.sections.find((section) => section.sectionKey === 'value_drivers')
    expect(valueDrivers.generationEligibility).toEqual(expect.objectContaining({
      canGenerate: true,
      sources: ['DEPENDENT_SECTION_CONTEXT'],
      dependencySectionKeys: ['customer_problem'],
      satisfiedDependencySectionKeys: ['customer_problem'],
    }))
  })

  test('keeps dependency-context generation ineligible when declared dependencies lack context', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          required: true,
          validationKeys: ['required-sections-check'],
        },
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          required: true,
          validationKeys: ['required-sections-check'],
          dependsOnSectionKeys: ['customer_problem'],
        },
      ],
      workflowBindings: [makeWorkflowBinding('GENERATE_SECTION')],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([
      makeRuntimePathRecord(),
      makeRuntimePathRecord({
        stableId: 'path-framework-state-sections-value-drivers',
        pathKey: 'framework_state.sections.value_drivers',
        label: 'Value Drivers',
      }),
    ]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      sections: [
        makeUIContract().sections[0],
        {
          sectionKey: 'value_drivers',
          runtimePath: 'framework_state.sections.value_drivers',
          source: 'PACKAGE',
          isCustom: false,
          label: 'Value Drivers',
          displayOrder: 20,
          isVisible: true,
          isEditable: true,
        },
      ],
      actions: [makeUIAction('GENERATE_SECTION')],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeActionWorkflowPolicy('GENERATE_SECTION')]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: '',
          value_drivers: '',
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
    const valueDrivers = res.body.data.sections.find((section) => section.sectionKey === 'value_drivers')
    expect(valueDrivers.generationEligibility).toEqual(expect.objectContaining({
      canGenerate: false,
      sources: [],
      dependencySectionKeys: ['customer_problem'],
      satisfiedDependencySectionKeys: [],
    }))
  })

  test('includes readable runtime path projection only for platform debug actors', async () => {
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
    const token = await getAccessTokenForUser(makeSuperAdmin())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.runtimeData).toEqual({
      readablePaths: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          value: 'Proposal creation is slow.',
        },
      ],
    })
    expect(res.body.data.diagnostics.runtimePathVisibility).toBe('VISIBLE')
  })

  test('does not allow raw platform roles alone to expose readable runtime paths', async () => {
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(
      buildDefaultRoleRows().filter((role) => role.key !== 'SUPER_ADMIN'),
    ))
    User.findById = jest.fn().mockReturnValue(buildUserQueryChain(makeCustomerAdmin({
      memberships: [
        { customerId: null, roles: ['SUPER_ADMIN'] },
        { customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] },
      ],
    })))
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
    const token = await getAccessTokenForUser(makeCustomerAdmin({
      memberships: [
        { customerId: null, roles: ['SUPER_ADMIN'] },
        { customerId: CUSTOMER_ID, roles: ['CUSTOMER_ADMIN'] },
      ],
    }))

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.runtimeData).toEqual({
      readablePaths: [],
    })
    expect(res.body.data.diagnostics.runtimePathVisibility).toBe('HIDDEN')
  })

  test('renders governed section object model without exposing raw framework state', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    RuntimeInstance.findOne = jest.fn().mockReturnValue(buildLeanQuery(makeRuntimeInstance({
      framework_state: {
        lifecycle: { stage: 'DRAFT' },
        sections: {
          customer_problem: {
            input: 'Proposal creation is slow.',
            generated: {
              content: 'Customer Problem: Proposal creation is slow.',
              generatedAt: '2026-05-19T08:01:00.000Z',
            },
            review: {
              status: 'PENDING_REVIEW',
            },
            state: {
              status: 'GENERATED',
              revisionCount: 1,
            },
            lineage: {
              sectionKey: 'customer_problem',
              runtimePath: 'framework_state.sections.customer_problem',
              actionKey: 'GENERATE_SECTION',
            },
            revisions: [
              {
                revisionNumber: 1,
                generated: {
                  content: 'Customer Problem: Previous generated content.',
                },
                replacedAt: '2026-05-19T08:01:00.000Z',
              },
            ],
          },
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
    expect(res.body.data.sections).toEqual([
      expect.objectContaining({
        key: 'customer_problem',
        value: 'Proposal creation is slow.',
        generated: expect.objectContaining({
          content: 'Customer Problem: Proposal creation is slow.',
        }),
        review: expect.objectContaining({
          status: 'PENDING_REVIEW',
        }),
        state: expect.objectContaining({
          status: 'GENERATED',
          revisionCount: 1,
        }),
        lineage: expect.objectContaining({
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
        }),
        revisions: [
          expect.objectContaining({
            revisionNumber: 1,
            generated: expect.objectContaining({
              content: 'Customer Problem: Previous generated content.',
            }),
          }),
        ],
      }),
    ])
    expect(res.body.data.runtimeData).toEqual({
      readablePaths: [],
    })
    expect(res.body.data.diagnostics.runtimePathVisibility).toBe('HIDDEN')
    expect(res.body.data.runtimeInstance.framework_state).toBeUndefined()
    expect(res.body.data.frameworkState).toBeUndefined()
  })

  test('renders section fields as read-only when the actor can view but cannot mutate runtime state', async () => {
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage({
      workflowBindings: [
        makeWorkflowBinding('SUBMIT_FOR_REVIEW', { executionContext: 'ON_SUBMIT' }),
        makeWorkflowBinding('GENERATE_SECTION'),
        makeWorkflowBinding('REGENERATE_SECTION'),
      ],
    }))
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract({
      actions: [
        makeUIAction('SUBMIT_FOR_REVIEW', {
          confirmationMessage: 'Submit this framework for review?',
          requiresConfirmation: true,
        }),
        makeUIAction('GENERATE_SECTION'),
        makeUIAction('REGENERATE_SECTION'),
      ],
    })))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([
      makeWorkflowPolicy(),
      makeActionWorkflowPolicy('GENERATE_SECTION'),
      makeActionWorkflowPolicy('REGENERATE_SECTION'),
    ]))
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
    const token = await getAccessTokenForUser(makeRegularUser())

    const res = await request
      .get(`/api/v1/runtime-instances/${RUNTIME_INSTANCE_ID}/renderer`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.sections).toEqual([
      expect.objectContaining({
        key: 'customer_problem',
        editable: false,
        readonlyReason: 'Current role or permissions do not allow runtime section mutation.',
        requiredPermissions: ['VMF_UPDATE'],
      }),
    ])
    expect(res.body.data.discovery.inputValues).toBeUndefined()
    expect(res.body.data.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionKey: 'SUBMIT_FOR_REVIEW',
        enabled: false,
        disabledReason: 'Current role or permissions do not allow this runtime action.',
      }),
      expect.objectContaining({
        actionKey: 'GENERATE_SECTION',
        enabled: false,
        disabledReason: 'Current role or permissions do not allow this runtime action.',
        requiredPermissions: ['VMF_UPDATE'],
      }),
      expect.objectContaining({
        actionKey: 'REGENERATE_SECTION',
        enabled: false,
        disabledReason: 'Current role or permissions do not allow this runtime action.',
        requiredPermissions: ['VMF_UPDATE'],
      }),
    ]))
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
      readablePaths: [],
    })
    expect(JSON.stringify(res.body.data)).not.toContain('LEAKED_SECRET_VALUE')
    expect(JSON.stringify(res.body.data)).not.toContain('WRITE_ONLY_SECRET_VALUE')
    expect(res.body.data.runtimeInstance.framework_state).toBeUndefined()
    expect(res.body.data.frameworkState).toBeUndefined()
    expect(res.body.data.diagnostics.configWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RUNTIME_PATH_NOT_FOUND',
        severity: 'ERROR',
        sectionKey: 'hidden_secret',
      }),
      expect.objectContaining({
        code: 'RUNTIME_PATH_NOT_READABLE',
        severity: 'ERROR',
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
        severity: 'ERROR',
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
        severity: 'WARNING',
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
        severity: 'WARNING',
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

  test('disables action UI for customer-scoped tenant admins who can view but are not assigned to mutate the tenant', async () => {
    const tenantAdmin = makeCustomerScopedTenantAdmin()
    User.findById = jest.fn().mockImplementation((userId) => {
      if (userId === REGULAR_USER_ID) return buildUserQueryChain(tenantAdmin)
      return buildUserQueryChain(null)
    })
    Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildTenantAdminRoleRows()))
    Tenant.findById = jest.fn().mockResolvedValue(makeTenant({
      tenantAdminUserIds: [],
    }))
    FrameworkPackage.findById.mockResolvedValue(makeRendererFrameworkPackage())
    RuntimePathRegistry.find.mockReturnValue(buildLeanQuery([makeRuntimePathRecord()]))
    UIContract.findOne.mockReturnValue(buildLeanQuery(makeUIContract()))
    WorkflowPolicy.find.mockReturnValue(buildLeanQuery([makeWorkflowPolicy()]))
    const token = await getAccessTokenForUser(tenantAdmin)

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
