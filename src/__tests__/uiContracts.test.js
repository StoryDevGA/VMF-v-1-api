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
const UI_CONTRACT_ID = '607f1f77bcf86cd799439061'

const makeFakeUser = (overrides = {}) => ({
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

const buildRoleQueryChain = (rows) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildDefaultRoleRows = () => ([
  {
    key: 'SUPER_ADMIN',
    scope: 'PLATFORM',
    permissions: ['PLATFORM_MANAGE', 'AUDIT_VIEW_ALL'],
    isActive: true,
  },
])

const buildSelectLeanChain = (rows) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
})

const buildFrameworkPackageQueryChain = (rows) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildFrameworkPackageFindOneChain = (row) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(row),
  }),
})

const buildUIContractListQueryChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const makeSourceFrameworkPackage = (overrides = {}) => ({
  packageKey: 'vmf-2-3-1',
  frameworkKey: 'VMF',
  version: '2.3.1',
  status: 'ACTIVE',
  sections: [
    {
      sectionKey: 'customer_problem',
      runtimePath: 'framework_state.sections.customer_problem',
      required: true,
    },
  ],
  ...overrides,
})

let app
let request
let tokenService
let User
let Role
let FrameworkRegistry
let FrameworkPackage
let RuntimePathRegistry
let WorkflowPolicy
let UIContract
let AuditLog
let mockRedisClient
let originalUIContractSave
let originalUIContractPopulate

const getAccessTokenForUser = async (user) => {
  const tokens = await tokenService.generateTokens(user)
  return tokens.accessToken
}

const makeUIContractDoc = (overrides = {}) => {
  const uiContract = new UIContract({
    _id: UI_CONTRACT_ID,
    uiContractKey: 'vmf-ui-contract-v1',
    name: 'VMF UI Contract',
    description: 'Presentation contract for VMF.',
    status: 'ACTIVE',
    frameworkKeys: ['VMF'],
    introducedInVersion: '2.3.1',
    compatibilityMode: 'INHERITED_MINOR',
    sections: [],
    lifecycleStages: [],
    actions: [],
    createdBy: SUPER_ADMIN_ID,
    updatedBy: SUPER_ADMIN_ID,
    ...overrides,
  })

  uiContract.save = jest.fn(async function save() {
    return this
  })
  uiContract.populate = jest.fn(async function populate() {
    return this
  })

  return uiContract
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
  FrameworkRegistry = models.FrameworkRegistry
  FrameworkPackage = models.FrameworkPackage
  RuntimePathRegistry = models.RuntimePathRegistry
  WorkflowPolicy = models.WorkflowPolicy
  UIContract = models.UIContract
  AuditLog = models.AuditLog

  originalUIContractSave = UIContract.prototype.save
  originalUIContractPopulate = UIContract.prototype.populate
})

afterAll(() => {
  UIContract.prototype.save = originalUIContractSave
  UIContract.prototype.populate = originalUIContractPopulate
})

beforeEach(() => {
  User.findById = jest.fn().mockResolvedValue(makeFakeUser())
  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))
  FrameworkRegistry.find = jest.fn().mockReturnValue(buildSelectLeanChain([
    { frameworkKey: 'VMF', status: 'ACTIVE' },
  ]))
  FrameworkPackage.find = jest.fn().mockReturnValue(buildFrameworkPackageQueryChain([]))
  FrameworkPackage.findOne = jest.fn().mockReturnValue(buildFrameworkPackageFindOneChain(null))
  RuntimePathRegistry.find = jest.fn().mockReturnValue(buildSelectLeanChain([]))
  RuntimePathRegistry.findOne = jest.fn().mockReturnValue(buildSelectLeanChain(null))
  WorkflowPolicy.find = jest.fn().mockReturnValue(buildSelectLeanChain([]))
  UIContract.findOne = jest.fn().mockReturnValue({
    select: jest.fn().mockResolvedValue(null),
  })
  UIContract.findById = jest.fn().mockResolvedValue(null)
  UIContract.findByStableId = jest.fn().mockResolvedValue(null)
  UIContract.countDocuments = jest.fn().mockResolvedValue(0)
  UIContract.find = jest.fn().mockReturnValue(buildUIContractListQueryChain([]))
  UIContract.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 })
  UIContract.prototype.save = jest.fn(async function save() {
    return this
  })
  UIContract.prototype.populate = jest.fn(async function populate() {
    return this
  })
  AuditLog.createLog = jest.fn(async () => ({}))
  mockRedisClient.set.mockResolvedValue('OK')
  mockRedisClient.setex.mockResolvedValue('OK')
  mockRedisClient.get.mockResolvedValue('1')
  mockRedisClient.del.mockResolvedValue(1)
})

describe('UI Contract Routes', () => {
  test('GET /api/v1/super-admin/runtime-control/ui-contracts returns 401 without auth token', async () => {
    const res = await request.get('/api/v1/super-admin/runtime-control/ui-contracts')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  test('GET /api/v1/super-admin/runtime-control/ui-contracts normalizes legacy blank optional fields', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    UIContract.countDocuments.mockResolvedValue(1)
    UIContract.find.mockReturnValue(buildUIContractListQueryChain([
      {
        id: 'ui-contract-vmf-ui-contract-v1',
        uiContractKey: 'vmf-ui-contract-v1',
        name: 'VMF UI Contract',
        status: 'DRAFT',
        frameworkKeys: ['VMF'],
        deprecatedInVersion: '',
        lockedReason: '',
      },
    ]))

    const res = await request
      .get('/api/v1/super-admin/runtime-control/ui-contracts')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0].deprecatedInVersion).toBeNull()
    expect(res.body.data[0].lockedReason).toBeNull()
  })

  test('GET /api/v1/super-admin/runtime-control/ui-contracts/:uiContractId normalizes legacy blank optional fields', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    UIContract.findById.mockResolvedValue(makeUIContractDoc({
      deprecatedInVersion: '',
      lockedReason: '',
    }))

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/ui-contracts/${UI_CONTRACT_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.deprecatedInVersion).toBeNull()
    expect(res.body.data.lockedReason).toBeNull()
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts creates a UI Contract', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findOne.mockReturnValue(buildFrameworkPackageFindOneChain(makeSourceFrameworkPackage()))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/ui-contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'vmf-ui-contract-v1',
        name: 'VMF UI Contract',
        description: 'Presentation contract for VMF.',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        introducedInVersion: '2.3.1',
        deprecatedInVersion: null,
        sourcePackageKey: 'vmf-2-3-1',
        sourcePackageVersion: '2.3.1',
        sourceFrameworkKey: 'VMF',
        sections: [
          {
            sectionKey: 'customer_problem',
            runtimePath: 'framework_state.sections.customer_problem',
            sourcePackageKey: 'vmf-2-3-1',
            label: 'Customer Problem',
            helpText: 'Describe the core customer problem.',
            displayOrder: 10,
            isEditable: true,
          },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.uiContractKey).toBe('vmf-ui-contract-v1')
    expect(res.body.data.sections[0].label).toBe('Customer Problem')
    expect(res.body.data.sections[0].runtimePath).toBe('framework_state.sections.customer_problem')
    expect(res.body.data.sections[0].source).toBe('PACKAGE')
    expect(res.body.data.sections[0].isCustom).toBe(false)
    expect(res.body.data.deprecatedInVersion).toBeNull()
    expect(new Date(res.body.data.resolvedAt).toISOString()).toBe(res.body.data.resolvedAt)
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UI_CONTRACT_CREATED',
      resourceType: 'UIContract',
    }))
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts accepts legacy package lookup by framework and version', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findOne
      .mockReturnValueOnce(buildFrameworkPackageFindOneChain(null))
      .mockReturnValueOnce(buildFrameworkPackageFindOneChain({
        packageKey: '',
        frameworkKey: 'VMF',
        version: '2.3.1',
        status: 'ACTIVE',
      }))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/ui-contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'vmf-ui-contract-v1',
        name: 'VMF UI Contract',
        description: 'Presentation contract for VMF.',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        sourcePackageKey: 'vmf-2-3-1',
        sourcePackageVersion: '2.3.1',
        sourceFrameworkKey: 'VMF',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.sourcePackageKey).toBe('vmf-2-3-1')
    expect(FrameworkPackage.findOne).toHaveBeenNthCalledWith(1, { packageKey: 'vmf-2-3-1' })
    expect(FrameworkPackage.findOne).toHaveBeenNthCalledWith(2, { frameworkKey: 'VMF', version: '2.3.1' })
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts rejects package-backed sections with empty runtime paths', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/ui-contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'vmf-ui-contract-v1',
        name: 'VMF UI Contract',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        sourcePackageKey: 'vmf-2-3-1',
        sourcePackageVersion: '2.3.1',
        sourceFrameworkKey: 'VMF',
        sections: [
          {
            sectionKey: 'customer_problem',
            runtimePath: '',
            label: 'Customer Problem',
            displayOrder: 10,
          },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details['sections.0.runtimePath']).toBe(
      'Package-backed UI Contract sections require a runtime path.',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts rejects orphan package-backed sections', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findOne.mockReturnValue(buildFrameworkPackageFindOneChain(makeSourceFrameworkPackage()))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/ui-contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'vmf-ui-contract-v1',
        name: 'VMF UI Contract',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        sourcePackageKey: 'vmf-2-3-1',
        sourcePackageVersion: '2.3.1',
        sourceFrameworkKey: 'VMF',
        sections: [
          {
            sectionKey: 'overview',
            runtimePath: 'framework_state.sections.overview',
            label: 'Overview',
            displayOrder: 10,
          },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.sections).toContain(
      'UI Contract sections must exist in the source package unless marked custom: overview.',
    )
    expect(res.body.error.details.sections).toContain(
      'Required package sections must have mapped UI Contract sections: customer_problem.',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts rejects runtime path mismatches', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findOne.mockReturnValue(buildFrameworkPackageFindOneChain(makeSourceFrameworkPackage()))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/ui-contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'vmf-ui-contract-v1',
        name: 'VMF UI Contract',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        sourcePackageKey: 'vmf-2-3-1',
        sourcePackageVersion: '2.3.1',
        sourceFrameworkKey: 'VMF',
        sections: [
          {
            sectionKey: 'customer_problem',
            runtimePath: 'framework_state.sections.wrong_problem',
            label: 'Customer Problem',
            displayOrder: 10,
          },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.sections).toContain(
      'UI Contract section runtime paths must match the source package: customer_problem expected framework_state.sections.customer_problem.',
    )
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts rejects invalid lifecycle stages', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    RuntimePathRegistry.findOne.mockReturnValue(buildSelectLeanChain({
      pathKey: 'framework_state.lifecycle.stage',
      allowedValues: ['DRAFT', 'PUBLISHED'],
    }))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/ui-contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'vmf-ui-contract-v1',
        name: 'VMF UI Contract',
        status: 'DRAFT',
        frameworkKeys: ['VMF'],
        lifecycleStages: [
          {
            stageKey: 'APPROVED',
            label: 'Approved',
            displayOrder: 10,
          },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.lifecycleStages).toContain('APPROVED')
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts rejects workflow policy key action mappings', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    FrameworkPackage.findOne.mockReturnValue(buildFrameworkPackageFindOneChain(makeSourceFrameworkPackage({
      workflowBindings: [{ policyKey: 'vmf-submit-gate' }],
    })))
    WorkflowPolicy.find.mockReturnValue(buildSelectLeanChain([
      {
        key: 'vmf-submit-gate',
        status: 'ACTIVE',
        governedAction: 'SUBMIT_FOR_REVIEW',
      },
    ]))

    const res = await request
      .post('/api/v1/super-admin/runtime-control/ui-contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'vmf-ui-contract-v1',
        name: 'VMF UI Contract',
        status: 'ACTIVE',
        frameworkKeys: ['VMF'],
        sourcePackageKey: 'vmf-2-3-1',
        sourcePackageVersion: '2.3.1',
        sourceFrameworkKey: 'VMF',
        sections: [
          {
            sectionKey: 'customer_problem',
            runtimePath: 'framework_state.sections.customer_problem',
            label: 'Customer Problem',
            displayOrder: 10,
          },
        ],
        actions: [
          {
            actionKey: 'submit',
            governedAction: 'VMF_SUBMIT_GATE',
            buttonLabel: 'Submit',
            displayOrder: 10,
          },
        ],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.actions).toContain('workflow policy keys')
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts allows explicit custom sections without runtime paths', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/ui-contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'vmf-ui-contract-v1',
        name: 'VMF UI Contract',
        status: 'DRAFT',
        frameworkKeys: ['VMF'],
        sections: [
          {
            sectionKey: 'overview',
            runtimePath: '',
            source: 'CUSTOM',
            isCustom: true,
            label: 'Overview',
            displayOrder: 10,
          },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.sections[0].source).toBe('CUSTOM')
    expect(res.body.data.sections[0].isCustom).toBe(true)
  })

  test('PATCH /api/v1/super-admin/runtime-control/ui-contracts/:uiContractId keeps omitted fields unchanged', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const previousResolvedAt = '2026-04-29T08:00:00.000Z'
    UIContract.findById.mockResolvedValue(makeUIContractDoc({
      name: 'VMF UI Contract',
      introducedInVersion: '2.3.1',
      deprecatedInVersion: null,
      resolvedAt: new Date(previousResolvedAt),
    }))

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/ui-contracts/${UI_CONTRACT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated VMF UI Contract',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Updated VMF UI Contract')
    expect(res.body.data.introducedInVersion).toBe('2.3.1')
    expect(res.body.data.deprecatedInVersion).toBeNull()
    expect(new Date(res.body.data.resolvedAt).toISOString()).toBe(res.body.data.resolvedAt)
    expect(new Date(res.body.data.resolvedAt).getTime()).toBeGreaterThan(new Date(previousResolvedAt).getTime())
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UI_CONTRACT_UPDATED',
      diff: expect.objectContaining({
        name: { from: 'VMF UI Contract', to: 'Updated VMF UI Contract' },
        _resolution: { resolvedAt: res.body.data.resolvedAt },
      }),
    }))
  })

  test('UIContract model blocks direct resolvedAt mutation on existing records', async () => {
    const uiContract = makeUIContractDoc({
      resolvedAt: new Date('2026-04-29T08:00:00.000Z'),
    })
    uiContract.$isNew = false
    uiContract.resolvedAt = new Date('2026-04-29T09:00:00.000Z')

    await expect(uiContract.validate()).rejects.toThrow(
      'resolvedAt is server-managed governance metadata and cannot be edited directly.',
    )
  })

  test('PATCH /api/v1/super-admin/runtime-control/ui-contracts/:uiContractId rejects immutable keys', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/ui-contracts/${UI_CONTRACT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'renamed-ui-contract',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.uiContractKey).toContain('server-managed governance metadata')
    expect(UIContract.findById).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts rejects direct governance metadata edits', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/runtime-control/ui-contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'vmf-ui-contract-v1',
        name: 'VMF UI Contract',
        status: 'DRAFT',
        frameworkKeys: ['VMF'],
        isLocked: false,
        resolvedAt: '2026-04-29T08:00:00.000Z',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.isLocked).toContain('server-managed governance metadata')
    expect(res.body.error.details.resolvedAt).toContain('server-managed governance metadata')
  })

  test('PATCH /api/v1/super-admin/runtime-control/ui-contracts/:uiContractId blocks locked edits', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    UIContract.findById.mockResolvedValue(makeUIContractDoc({
      isLocked: true,
      lockedByPackageKeys: ['vmf-qa-manual-951'],
    }))

    const res = await request
      .patch(`/api/v1/super-admin/runtime-control/ui-contracts/${UI_CONTRACT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated VMF UI Contract',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.message).toContain('Clone the record')
    expect(res.body.error.details.reason).toBe('UI_CONTRACT_LOCKED')
    expect(res.body.error.details.lockedByPackageKeys).toEqual(['vmf-qa-manual-951'])
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts/:uiContractId/clone creates an unlocked draft successor', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const source = makeUIContractDoc({
      componentVersion: 3,
      lineageId: 'ui-contract-vmf-ui-contract-v1',
      sourcePackageKey: 'vmf-2-3-1',
      sourcePackageVersion: '2.3.1',
      sourceFrameworkKey: 'VMF',
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          sourcePackageKey: 'vmf-2-3-1',
          label: 'Customer Problem',
          displayOrder: 10,
        },
      ],
      actions: [
        {
          actionKey: 'save',
          governedAction: 'SAVE',
          buttonLabel: 'Save',
          displayOrder: 10,
        },
      ],
    })
    UIContract.findById.mockResolvedValue(source)
    FrameworkPackage.findOne.mockReturnValue(buildFrameworkPackageFindOneChain(makeSourceFrameworkPackage({
      workflowBindings: [{ policyKey: 'vmf-submit-gate' }],
    })))

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/ui-contracts/${UI_CONTRACT_ID}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        uiContractKey: 'vmf-ui-contract-v2',
        name: 'VMF UI Contract v2',
        description: 'Draft successor.',
      })

    expect(res.status).toBe(201)
    expect(res.body.data.uiContractKey).toBe('vmf-ui-contract-v2')
    expect(res.body.data.status).toBe('DRAFT')
    expect(res.body.data.componentVersion).toBe(4)
    expect(res.body.data.versionStatus).toBe('DRAFT')
    expect(res.body.data.isLocked).toBe(false)
    expect(res.body.data.lockedReason).toBeNull()
    expect(new Date(res.body.data.resolvedAt).toISOString()).toBe(res.body.data.resolvedAt)
    expect(source.save).not.toHaveBeenCalled()
    expect(UIContract.updateOne).toHaveBeenCalledWith(
      { _id: source._id },
      {
        $set: {
          supersededByStableId: 'ui-contract-vmf-ui-contract-v2',
          updatedBy: SUPER_ADMIN_ID,
        },
      },
      { runValidators: false },
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UI_CONTRACT_CLONED',
      resourceType: 'UIContract',
    }))
  })

  test('POST /api/v1/super-admin/runtime-control/ui-contracts/:uiContractId/validate records validation audit', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    UIContract.findById.mockResolvedValue(makeUIContractDoc({
      sourcePackageKey: 'vmf-2-3-1',
      sourcePackageVersion: '2.3.1',
      sourceFrameworkKey: 'VMF',
      sections: [
        {
          sectionKey: 'customer_problem',
          runtimePath: 'framework_state.sections.customer_problem',
          sourcePackageKey: 'vmf-2-3-1',
          label: 'Customer Problem',
          displayOrder: 10,
        },
      ],
    }))
    FrameworkPackage.findOne.mockReturnValue(buildFrameworkPackageFindOneChain(makeSourceFrameworkPackage()))

    const res = await request
      .post(`/api/v1/super-admin/runtime-control/ui-contracts/${UI_CONTRACT_ID}/validate`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.valid).toBe(true)
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UI_CONTRACT_VALIDATION_RUN',
      resourceType: 'UIContract',
    }))
  })

  test('GET /api/v1/super-admin/runtime-control/ui-contracts/:uiContractId/dependencies returns referencing packages', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    UIContract.findById.mockResolvedValue(makeUIContractDoc())
    FrameworkPackage.find.mockReturnValue(buildFrameworkPackageQueryChain([
      {
        _id: '607f1f77bcf86cd799439071',
        frameworkKey: 'VMF',
        version: '2.3.1',
        packageName: 'VMF 2.3.1',
        status: 'ACTIVE',
      },
    ]))

    const res = await request
      .get(`/api/v1/super-admin/runtime-control/ui-contracts/${UI_CONTRACT_ID}/dependencies`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.uiContractKey).toBe('vmf-ui-contract-v1')
    expect(res.body.data.dependencies.summary.frameworkPackages).toBe(1)
    expect(res.body.data.dependencies.hasActiveDependencies).toBe(true)
  })
})
