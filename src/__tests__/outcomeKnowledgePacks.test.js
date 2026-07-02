import mongoose from 'mongoose'
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

const REQUIRED_PACKS = [
  { packCategory: 'OUTCOME', packType: 'ARL', packKey: 'adaptive-reasoning-layer', label: 'Adaptive Reasoning Layer' },
  { packCategory: 'OUTCOME', packType: 'RL', packKey: 'rendering-layer', label: 'Rendering Layer' },
  { packCategory: 'OUTCOME', packType: 'OUTPUT_SCHEMA', packKey: 'output-schemas-pack', label: 'Output Schemas' },
  { packCategory: 'PLATFORM', packType: 'TRUTH_CERTIFICATION', packKey: 'truth-certification-pack', label: 'Truth Certification' },
  { packCategory: 'OUTCOME', packType: 'OUTPUT_TYPE_DEFINITION', packKey: 'outcome-output-types', label: 'Outcome Output Types' },
]

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
    permissions: [
      'PLATFORM_MANAGE',
      'SYSTEM_HEALTH_VIEW',
      'CUSTOMER_CREATE',
      'CUSTOMER_UPDATE',
      'CUSTOMER_VIEW',
      'ROLE_MANAGE',
      'AUDIT_VIEW_ALL',
    ],
    isActive: true,
  },
  {
    key: 'USER',
    scope: 'VMF',
    permissions: ['VMF_VIEW', 'DEAL_VIEW'],
    isActive: true,
  },
])

const buildFindChain = (rows) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  session: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

const buildFindOneChain = (row) => ({
  session: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(row),
})

const buildFindOneAndUpdateChain = (row) => ({
  lean: jest.fn().mockResolvedValue(row),
})

const buildVersionFindOneChain = (row) => ({
  session: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(row),
  select: jest.fn().mockResolvedValue(row),
})

const buildActivationFindOneChain = (row) => ({
  sort: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(row),
  session: jest.fn().mockReturnThis(),
})

const snapshotKnowledgePackMutationState = (doc) => ({
  status: doc.status,
  latestVersionId: doc.latestVersionId,
  latestSemanticVersion: doc.latestSemanticVersion,
})

const restoreKnowledgePackMutationState = (doc, snapshot) => {
  Object.entries(snapshot).forEach(([field, value]) => {
    doc[field] = value
  })
}

const buildSession = () => ({
  withTransaction: jest.fn(async (callback) => callback()),
  endSession: jest.fn(async () => {}),
})

const buildRollbackSession = (docs = []) => ({
  withTransaction: jest.fn(async (callback) => {
    const snapshots = docs.map((doc) => ({
      doc,
      snapshot: snapshotKnowledgePackMutationState(doc),
    }))
    try {
      return await callback()
    } catch (err) {
      snapshots.forEach(({ doc, snapshot }) =>
        restoreKnowledgePackMutationState(doc, snapshot))
      throw err
    }
  }),
  endSession: jest.fn(async () => {}),
})

const makeKnowledgePack = (overrides = {}) => ({
  _id: '607f1f77bcf86cd799439001',
  packId: 'kp-output-schema-output-schemas-pack',
  packCategory: 'OUTCOME',
  packType: 'OUTPUT_SCHEMA',
  packKey: 'output-schemas-pack',
  label: 'Output Schemas',
  description: 'Starter output schema pack.',
  status: 'VALIDATED',
  latestVersionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
  latestSemanticVersion: '1.0.0',
  sourceMetadata: {
    sourceFilename: 'output-schemas-pack-v1.yaml',
  },
  content: {
    hidden: 'Pack content must not leak from list/detail responses.',
  },
  createdAt: '2026-06-15T09:00:00.000Z',
  updatedAt: '2026-06-15T09:00:00.000Z',
  ...overrides,
})

const makeKnowledgePackVersion = (overrides = {}) => ({
  versionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
  packId: 'kp-output-schema-output-schemas-pack',
  packCategory: 'OUTCOME',
  packType: 'OUTPUT_SCHEMA',
  packKey: 'output-schemas-pack',
  semanticVersion: '1.0.0',
  schemaVersion: '1.0.0',
  status: 'VALIDATED',
  scopeType: 'GLOBAL',
  scopeKey: 'GLOBAL',
  contentHash: 'sha256:output-schema-content',
  content: {
    hidden: 'Version content must not leak from detail responses.',
  },
  sourceMetadata: {},
  validationSummary: {},
  validatedAt: '2026-06-15T09:10:00.000Z',
  ...overrides,
})

const makeKnowledgePackVersionDoc = (overrides = {}) => ({
  ...makeKnowledgePackVersion(overrides),
  save: jest.fn(async function save() {
    return this
  }),
})

const makeKnowledgePackManifest = (overrides = {}) => ({
  manifestId: 'kpm-vmf-outcome-studio-1-0-0-global',
  manifestKey: 'vmf-outcome-studio',
  manifestName: 'VMF Outcome Studio Manifest',
  manifestType: 'FRAMEWORK_RUNTIME',
  description: 'Persisted VMF manifest.',
  semanticVersion: '1.0.0',
  status: 'VALIDATED',
  workspaceType: 'OUTCOME',
  frameworkKey: 'VMF',
  runtimeType: 'VALUE_NARRATIVE',
  packageKey: 'standard-package-vmf-3-1-rkm',
  outputKey: '',
  scopeType: 'PACKAGE',
  scopeKey: 'PACKAGE:VMF:standard-package-vmf-3-1-rkm:3.1',
  mandatoryPacks: [
    {
      packCategory: 'OUTCOME',
      purposeCategory: 'GOVERNANCE',
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      label: 'Adaptive Reasoning Layer',
      executionMode: 'PROVIDER_CONTEXT',
      required: true,
      dependencyKeys: [],
      metadata: {},
    },
  ],
  optionalPacks: [],
  validationPacks: [],
  blockedPacks: [],
  resolutionPolicy: {},
  validationPolicy: {},
  sourceMetadata: {},
  isSystem: false,
  createdAt: '2026-06-29T09:00:00.000Z',
  updatedAt: '2026-06-29T09:00:00.000Z',
  ...overrides,
})

const makeAllRequiredActivations = () =>
  REQUIRED_PACKS.map((pack) => makeActivation(pack, {
    versionId: `kpv-${pack.packKey}-1-0-0-global`,
    contentHash: `sha256:${pack.packKey}`,
  }))

const makeActivation = (pack, overrides = {}) => ({
  activationId: `kpa-${pack.packKey}-${overrides.scopeKey || 'global'}`,
  packId: `kp-${pack.packType.toLowerCase().replace(/_/g, '-')}-${pack.packKey}`,
  versionId: `kpv-${pack.packKey}-1-0-0-global`,
  packCategory: pack.packCategory || 'OUTCOME',
  packType: pack.packType,
  packKey: pack.packKey,
  semanticVersion: '1.0.0',
  schemaVersion: '1.0.0',
  status: 'ACTIVE',
  scopeType: 'GLOBAL',
  scopeKey: 'GLOBAL',
  contentHash: `sha256:${pack.packKey}`,
  content: {
    hidden: 'Activation content must not leak from preview responses.',
  },
  activatedAt: '2026-06-15T09:30:00.000Z',
  ...overrides,
})

const makeVersionForActivation = (activation, overrides = {}) => makeKnowledgePackVersion({
  versionId: activation.versionId,
  packId: activation.packId,
  packCategory: activation.packCategory,
  packType: activation.packType,
  packKey: activation.packKey,
  semanticVersion: activation.semanticVersion,
  schemaVersion: activation.schemaVersion,
  status: 'VALIDATED',
  scopeType: activation.scopeType,
  scopeKey: activation.scopeKey,
  contentHash: activation.contentHash,
  ...overrides,
})

const makeVersionsForActivations = (activations = []) =>
  activations.map((activation) => makeVersionForActivation(activation))

const OUTPUT_SCHEMAS_YAML = `
pack:
  key: output-schemas-pack
  name: Output Schemas Pack
global_rules:
  must_not_introduce:
    - unsupported claims
schemas:
  EXECUTIVE_BRIEF:
    required_sections:
      - Executive Summary
      - Lineage Summary
    prohibited:
      - invent ROI
`

const TRUTH_CERTIFICATION_YAML = `
pack:
  key: truth-certification-pack
  name: Truth Certification Pack
principle: Truth certification must not create new truth.
certification_levels:
  CERTIFIED_TRUTH:
    minimum_requirements:
      coverage_score: ">=70"
blocking_rules:
  - key: MISSING_LOCK_PROOF
    outcome: BLOCK
warnings:
  LOW_COVERAGE:
    instruction: Preserve gaps.
prohibited_output_claims:
  - Proven ROI
`

const ARL_YAML = `
pack:
  key: adaptive-reasoning-layer
  name: Adaptive Reasoning Layer
principle: ARL must not create new truth.
truth_binding_rules:
  must_not:
    - introduce unsupported facts
reasoning_stages:
  - key: BIND_PROMPT_TO_TRUTH
safety_gates:
  - key: TRUTH_SIGNATURE_CURRENT
hidden_from_customer:
  - chain of reasoning
prohibited:
  - raw source text
`

const RL_YAML = `
pack:
  key: rendering-layer
  name: Rendering Layer
principle: RL must not expose internal reasoning.
rendering_rules:
  must_not:
    - reveal ARL or RL internal notes
customer_safe_output:
  prohibited:
    - no_internal_reasoning
export_rules:
  MARKDOWN:
    allowed: true
prohibited:
  - raw source text
`

const OUTPUT_TYPES_YAML = `
pack:
  key: outcome-output-types
  name: Outcome Output Types
principle: Output types must not create truth.
output_types:
  GOVERNED_RESPONSE:
    supported_formats:
      - INLINE_TEXT
asset_types:
  CUSTOMER_PROPOSAL:
    publish_requirements:
      - current_truth_signature
supported_formats:
  MARKDOWN:
    exportable: true
publish_requirements:
  must_not:
    - publish raw pack source
`

let app
let request
let tokenService
let User
let Role
let KnowledgePack
let KnowledgePackVersion
let KnowledgePackActivation
let KnowledgePackManifest
let AuditLog
let mockRedisClient
let startSessionSpy
let originalMongooseReadyStateDescriptor

const setMongooseReadyState = (readyState) => {
  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    get: () => readyState,
  })
}

const restoreMongooseReadyState = () => {
  if (originalMongooseReadyStateDescriptor) {
    Object.defineProperty(
      mongoose.connection,
      'readyState',
      originalMongooseReadyStateDescriptor,
    )
    return
  }

  delete mongoose.connection.readyState
}

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
  AuditLog = models.AuditLog
  KnowledgePack = models.KnowledgePack
  KnowledgePackVersion = models.KnowledgePackVersion
  KnowledgePackActivation = models.KnowledgePackActivation
  KnowledgePackManifest = models.KnowledgePackManifest
  originalMongooseReadyStateDescriptor = Object.getOwnPropertyDescriptor(
    mongoose.connection,
    'readyState',
  )
  startSessionSpy = jest.spyOn(mongoose, 'startSession')
})

afterAll(() => {
  startSessionSpy?.mockRestore()
  restoreMongooseReadyState()
})

beforeEach(() => {
  restoreMongooseReadyState()
  startSessionSpy.mockReset()
  startSessionSpy.mockResolvedValue(buildSession())

  User.findById = jest.fn().mockImplementation((userId) => {
    if (userId === SUPER_ADMIN_ID) {
      return Promise.resolve(makeFakeUser())
    }

    if (userId === NON_ADMIN_ID) {
      return Promise.resolve(
        makeFakeUser({
          _id: NON_ADMIN_ID,
          id: NON_ADMIN_ID,
          email: 'user@storylineos.com',
          memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
        }),
      )
    }

    return Promise.resolve(null)
  })

  Role.find = jest.fn().mockReturnValue(buildRoleQueryChain(buildDefaultRoleRows()))
  KnowledgePack.countDocuments = jest.fn().mockResolvedValue(1)
  KnowledgePack.find = jest.fn().mockReturnValue(buildFindChain([makeKnowledgePack()]))
  KnowledgePack.findOne = jest.fn().mockReturnValue(buildFindOneChain(makeKnowledgePack()))
  KnowledgePack.findOneAndUpdate = jest.fn().mockResolvedValue(makeKnowledgePack())
  KnowledgePack.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 })
  KnowledgePack.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 })
  KnowledgePackVersion.find = jest.fn().mockReturnValue(buildFindChain([makeKnowledgePackVersion()]))
  KnowledgePackVersion.findOne = jest.fn().mockReturnValue(buildVersionFindOneChain(null))
  KnowledgePackVersion.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 })
  KnowledgePackVersion.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 })
  KnowledgePackVersion.prototype.save = jest.fn(async function save() {
    return this
  })
  KnowledgePackActivation.find = jest.fn().mockReturnValue(buildFindChain([]))
  KnowledgePackActivation.findOne = jest.fn().mockReturnValue(buildActivationFindOneChain(null))
  KnowledgePackActivation.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 })
  KnowledgePackActivation.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 })
  KnowledgePackActivation.prototype.save = jest.fn(async function save() {
    return this
  })
  KnowledgePackManifest.countDocuments = jest.fn().mockResolvedValue(1)
  KnowledgePackManifest.find = jest.fn().mockReturnValue(buildFindChain([makeKnowledgePackManifest()]))
  KnowledgePackManifest.findOne = jest.fn().mockReturnValue(buildFindOneChain(makeKnowledgePackManifest()))
  KnowledgePackManifest.exists = jest.fn().mockResolvedValue(null)
  KnowledgePackManifest.findOneAndUpdate = jest.fn().mockReturnValue(buildFindOneAndUpdateChain(makeKnowledgePackManifest({
    status: 'DRAFT',
  })))
  KnowledgePackManifest.prototype.save = jest.fn(async function save() {
    return this
  })
  AuditLog.createLog = jest.fn(async () => ({}))
})

describe('Outcome Studio Knowledge Pack Registry API', () => {
  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs returns safe registry metadata and source-only starter bundle', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([
      expect.objectContaining({
        packId: 'kp-output-schema-output-schemas-pack',
        packCategory: 'OUTCOME',
        packType: 'OUTPUT_SCHEMA',
        packKey: 'output-schemas-pack',
        status: 'VALIDATED',
      }),
    ])
    expect(res.body.sourceBundle).toEqual(expect.objectContaining({
      status: 'SOURCE_ONLY',
      starterPacks: expect.arrayContaining([
        expect.objectContaining({
          packCategory: 'OUTCOME',
          packType: 'ARL',
          sourceFilename: 'adaptive-reasoning-layer-v1.yaml',
          runtimeBindable: false,
          importStatus: 'NOT_IMPORTED',
        }),
        expect.objectContaining({
          packCategory: 'OUTCOME',
          packType: 'RL',
          sourceFilename: 'rendering-layer-v1.yaml',
          runtimeBindable: false,
          importStatus: 'NOT_IMPORTED',
        }),
        expect.objectContaining({
          packCategory: 'OUTCOME',
          packType: 'OUTPUT_SCHEMA',
          sourceFilename: 'output-schemas-pack-v1.yaml',
          runtimeBindable: false,
          importStatus: 'IMPORTED',
          latestVersionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
          latestSemanticVersion: '1.0.0',
          registryStatus: 'VALIDATED',
        }),
        expect.objectContaining({
          packCategory: 'PLATFORM',
          packType: 'TRUTH_CERTIFICATION',
          sourceFilename: 'truth-certification-pack-v1.yaml',
          runtimeBindable: false,
          importStatus: 'NOT_IMPORTED',
        }),
        expect.objectContaining({
          packCategory: 'OUTCOME',
          packType: 'OUTPUT_TYPE_DEFINITION',
          sourceFilename: 'outcome-output-types-v1.yaml',
          runtimeBindable: false,
          importStatus: 'NOT_IMPORTED',
        }),
      ]),
    }))
    expect(JSON.stringify(res.body)).not.toContain('Pack content must not leak')
    expect(KnowledgePack.find).toHaveBeenCalledWith({})
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests returns default and persisted manifest metadata', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([
      expect.objectContaining({
        manifestId: 'kpm-outcome-studio-default-1-0-0-global',
        manifestKey: 'outcome-studio-default',
        manifestName: 'Outcome Studio Default Knowledge Manifest',
        status: 'ACTIVE',
        isSystem: true,
        mandatoryPacks: expect.arrayContaining([
          expect.objectContaining({
            packType: 'ARL',
            packKey: 'adaptive-reasoning-layer',
            purposeCategory: 'GOVERNANCE',
            executionMode: 'PROVIDER_CONTEXT',
          }),
        ]),
      }),
      expect.objectContaining({
        manifestId: 'kpm-vmf-outcome-studio-1-0-0-global',
        manifestKey: 'vmf-outcome-studio',
        status: 'VALIDATED',
        frameworkKey: 'VMF',
      }),
    ])
    expect(res.body.meta).toEqual(expect.objectContaining({
      total: 2,
      defaultManifestIncluded: true,
    }))
    expect(KnowledgePackManifest.find).toHaveBeenCalledWith({})
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId returns the default OES manifest without DB lookup', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/outcome-studio-default')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      manifestId: 'kpm-outcome-studio-default-1-0-0-global',
      manifestType: 'OUTCOME_STUDIO_DEFAULT',
      mandatoryPacks: expect.arrayContaining([
        expect.objectContaining({
          packType: 'TRUTH_CERTIFICATION',
          packKey: 'truth-certification-pack',
          packCategory: 'PLATFORM',
        }),
      ]),
    }))
    expect(KnowledgePackManifest.findOne).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/manifests creates a draft manifest with validation packs and audits the mutation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        manifestKey: 'vmf-outcome-studio-authoring',
        manifestName: 'VMF Outcome Studio Authoring',
        semanticVersion: '1.0.0',
        manifestType: 'FRAMEWORK_RUNTIME',
        workspaceType: 'OUTCOME',
        frameworkKey: 'VMF',
        runtimeType: 'VALUE_NARRATIVE',
        packageKey: 'standard-package-vmf-3-1-rkm',
        mandatoryPacks: [
          {
            packCategory: 'OUTCOME',
            purposeCategory: 'GOVERNANCE',
            packType: 'ARL',
            packKey: 'adaptive-reasoning-layer',
            label: 'Adaptive Reasoning Layer',
          },
        ],
        validationPacks: [
          {
            packCategory: 'PLATFORM',
            purposeCategory: 'VALIDATION',
            packType: 'TRUTH_CERTIFICATION',
            packKey: 'truth-certification-pack',
            label: 'Truth Certification',
            executionMode: 'POST_VALIDATION',
            dependencyKeys: ['adaptive-reasoning-layer'],
          },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toEqual(expect.objectContaining({
      manifestId: 'kpm-vmf-outcome-studio-authoring-1-0-0-global',
      manifestKey: 'vmf-outcome-studio-authoring',
      status: 'DRAFT',
      frameworkKey: 'VMF',
      validationPacks: [
        expect.objectContaining({
          packType: 'TRUTH_CERTIFICATION',
          packKey: 'truth-certification-pack',
          executionMode: 'POST_VALIDATION',
          required: true,
        }),
      ],
      isSystem: false,
    }))
    expect(KnowledgePackManifest.exists).toHaveBeenCalled()
    expect(KnowledgePackManifest.prototype.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'KNOWLEDGE_PACK_MANIFEST_CREATED',
        resourceType: 'KnowledgePackManifest',
        resourceId: 'kpm-vmf-outcome-studio-authoring-1-0-0-global',
        diff: expect.objectContaining({
          operation: 'CREATE_MANIFEST',
          manifest: expect.objectContaining({
            contentVisible: false,
            validationCount: 1,
          }),
        }),
      }),
      expect.objectContaining({ session: expect.any(Object) }),
    )
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/manifests rejects duplicate manifest identity before saving', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackManifest.exists.mockResolvedValue({ _id: 'existing-manifest' })

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        manifestKey: 'vmf-outcome-studio',
        manifestName: 'VMF Outcome Studio',
        semanticVersion: '1.0.0',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('MANIFEST_ALREADY_EXISTS')
    expect(KnowledgePackManifest.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('PUT /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId updates draft authoring fields and keeps identity immutable', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const draftManifest = makeKnowledgePackManifest({
      status: 'DRAFT',
      isSystem: false,
      manifestName: 'Draft Manifest',
    })
    const updatedManifest = {
      ...draftManifest,
      manifestName: 'Draft Manifest Updated',
      validationPacks: [
        {
          packCategory: 'PLATFORM',
          purposeCategory: 'VALIDATION',
          packType: 'TRUTH_CERTIFICATION',
          packKey: 'truth-certification-pack',
          label: 'Truth Certification',
          executionMode: 'POST_VALIDATION',
          required: true,
          dependencyKeys: [],
          metadata: {},
        },
      ],
    }
    KnowledgePackManifest.findOne.mockReturnValue(buildFindOneChain(draftManifest))
    KnowledgePackManifest.findOneAndUpdate.mockReturnValue(buildFindOneAndUpdateChain(updatedManifest))

    const res = await request
      .put('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global')
      .set('Authorization', `Bearer ${token}`)
      .send({
        manifestName: 'Draft Manifest Updated',
        validationPacks: [
          {
            packCategory: 'PLATFORM',
            purposeCategory: 'VALIDATION',
            packType: 'TRUTH_CERTIFICATION',
            packKey: 'truth-certification-pack',
            executionMode: 'POST_VALIDATION',
          },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      manifestId: 'kpm-vmf-outcome-studio-1-0-0-global',
      manifestName: 'Draft Manifest Updated',
      validationPacks: [expect.objectContaining({ packKey: 'truth-certification-pack' })],
    }))
    expect(KnowledgePackManifest.findOneAndUpdate).toHaveBeenCalledWith(
      { manifestId: 'kpm-vmf-outcome-studio-1-0-0-global' },
      expect.objectContaining({
        $set: expect.not.objectContaining({
          manifestKey: expect.anything(),
          semanticVersion: expect.anything(),
          scopeKey: expect.anything(),
        }),
      }),
      expect.objectContaining({ new: true, runValidators: true }),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'KNOWLEDGE_PACK_MANIFEST_UPDATED',
        resourceType: 'KnowledgePackManifest',
        resourceId: 'kpm-vmf-outcome-studio-1-0-0-global',
      }),
      expect.objectContaining({ session: expect.any(Object) }),
    )
  })

  test('PUT /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId rejects active manifest edits before update and audit', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackManifest.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePackManifest({
      status: 'ACTIVE',
      isSystem: false,
    })))

    const res = await request
      .put('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global')
      .set('Authorization', `Bearer ${token}`)
      .send({ manifestName: 'Blocked Edit' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('MANIFEST_IMMUTABLE')
    expect(KnowledgePackManifest.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/clone creates a new draft manifest with source lineage', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const sourceManifest = makeKnowledgePackManifest({
      status: 'VALIDATED',
      manifestName: 'VMF Outcome Studio Manifest',
    })
    KnowledgePackManifest.findOne.mockReturnValue(buildFindOneChain(sourceManifest))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/clone')
      .set('Authorization', `Bearer ${token}`)
      .send({
        manifestKey: 'vmf-outcome-studio-variant',
        semanticVersion: '1.1.0',
        manifestName: 'VMF Outcome Studio Variant',
      })

    expect(res.status).toBe(201)
    expect(res.body.data).toEqual(expect.objectContaining({
      manifestId: 'kpm-vmf-outcome-studio-variant-1-1-0-package-vmf-standard-package-vmf-3-1-rkm-3-1',
      manifestKey: 'vmf-outcome-studio-variant',
      manifestName: 'VMF Outcome Studio Variant',
      status: 'DRAFT',
      sourceMetadata: expect.objectContaining({
        clonedFromManifestId: 'kpm-vmf-outcome-studio-1-0-0-global',
      }),
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'KNOWLEDGE_PACK_MANIFEST_CLONED',
        resourceType: 'KnowledgePackManifest',
        resourceId: 'kpm-vmf-outcome-studio-variant-1-1-0-package-vmf-standard-package-vmf-3-1-rkm-3-1',
        diff: expect.objectContaining({
          operation: 'CLONE_MANIFEST',
          clonedFromManifestId: 'kpm-vmf-outcome-studio-1-0-0-global',
        }),
      }),
      expect.objectContaining({ session: expect.any(Object) }),
    )
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/compare/:targetManifestId returns safe section deltas', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const sourceManifest = makeKnowledgePackManifest({
      manifestId: 'kpm-vmf-outcome-studio-1-0-0-global',
      semanticVersion: '1.0.0',
      mandatoryPacks: [
        {
          packCategory: 'OUTCOME',
          purposeCategory: 'GOVERNANCE',
          packType: 'ARL',
          packKey: 'adaptive-reasoning-layer',
          label: 'Adaptive Reasoning Layer',
          executionMode: 'PROVIDER_CONTEXT',
          required: true,
          dependencyKeys: [],
          metadata: {},
        },
      ],
    })
    const targetManifest = makeKnowledgePackManifest({
      manifestId: 'kpm-vmf-outcome-studio-1-1-0-global',
      semanticVersion: '1.1.0',
      mandatoryPacks: [],
      validationPacks: [
        {
          packCategory: 'PLATFORM',
          purposeCategory: 'VALIDATION',
          packType: 'TRUTH_CERTIFICATION',
          packKey: 'truth-certification-pack',
          label: 'Truth Certification',
          executionMode: 'POST_VALIDATION',
          required: true,
          dependencyKeys: [],
          metadata: {},
        },
      ],
      content: {
        hidden: 'Manifest compare must not leak hidden source content.',
      },
    })
    KnowledgePackManifest.findOne
      .mockReturnValueOnce(buildFindOneChain(sourceManifest))
      .mockReturnValueOnce(buildFindOneChain(targetManifest))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/compare/kpm-vmf-outcome-studio-1-1-0-global')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      status: 'COMPARED',
      contentVisible: false,
      source: expect.objectContaining({ semanticVersion: '1.0.0' }),
      target: expect.objectContaining({ semanticVersion: '1.1.0' }),
      sections: expect.objectContaining({
        mandatoryPacks: expect.objectContaining({ removedCount: 1 }),
        validationPacks: expect.objectContaining({ addedCount: 1 }),
      }),
      summary: expect.objectContaining({
        semanticVersionChanged: true,
        totalAdded: 1,
        totalRemoved: 1,
      }),
    }))
    expect(JSON.stringify(res.body)).not.toContain('hidden source content')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/resolution-preview wraps existing OES resolver for the default manifest', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackActivation.find.mockReturnValue(buildFindChain(makeAllRequiredActivations()))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/outcome-studio-default/resolution-preview?frameworkKey=VMF&runtimeType=VALUE_NARRATIVE&packageKey=standard-package-vmf-3-1-rkm&packageVersion=3.1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      manifest: expect.objectContaining({
        manifestId: 'kpm-outcome-studio-default-1-0-0-global',
        manifestKey: 'outcome-studio-default',
      }),
      binding: expect.objectContaining({
        status: 'PROJECTED',
        mode: 'REGISTRY_RESOLUTION',
        manifestId: 'kpm-outcome-studio-default-1-0-0-global',
        manifestVersion: '1.0.0',
        previewOnly: true,
        contentVisible: false,
        resolution: expect.objectContaining({
          activeCount: 5,
          requiredCount: 5,
        }),
      }),
    }))
    expect(res.body.data.binding.activePacks).toHaveLength(5)
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/resolution-preview resolves a persisted manifest without exposing pack content', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const manifest = makeKnowledgePackManifest({
      mandatoryPacks: [
        {
          packCategory: 'OUTCOME',
          purposeCategory: 'GOVERNANCE',
          packType: 'ARL',
          packKey: 'adaptive-reasoning-layer',
          label: 'Adaptive Reasoning Layer',
          executionMode: 'PROVIDER_CONTEXT',
          required: true,
          dependencyKeys: ['rendering-layer'],
          metadata: {},
        },
        {
          packCategory: 'OUTCOME',
          purposeCategory: 'GOVERNANCE',
          packType: 'RL',
          packKey: 'rendering-layer',
          label: 'Rendering Layer',
          executionMode: 'PROVIDER_CONTEXT',
          required: true,
          dependencyKeys: [],
          metadata: {},
        },
      ],
    })
    const activations = [
      makeActivation({ packCategory: 'OUTCOME', packType: 'ARL', packKey: 'adaptive-reasoning-layer', label: 'Adaptive Reasoning Layer' }),
      makeActivation({ packCategory: 'OUTCOME', packType: 'RL', packKey: 'rendering-layer', label: 'Rendering Layer' }),
    ]
    KnowledgePackManifest.findOne.mockReturnValue(buildFindOneChain(manifest))
    KnowledgePackActivation.find.mockReturnValue(buildFindChain(activations))
    KnowledgePackVersion.find.mockReturnValue(buildFindChain(makeVersionsForActivations(activations)))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/resolution-preview?frameworkKey=VMF&runtimeType=VALUE_NARRATIVE&packageKey=standard-package-vmf-3-1-rkm&packageVersion=3.1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.binding).toEqual(expect.objectContaining({
      status: 'PROJECTED',
      manifestId: 'kpm-vmf-outcome-studio-1-0-0-global',
      manifestKey: 'vmf-outcome-studio',
      previewOnly: true,
      contentVisible: false,
      dependencyGraph: expect.objectContaining({
        status: 'RESOLVED',
        edgeCount: 1,
      }),
      resolution: expect.objectContaining({
        activeCount: 2,
        requiredCount: 2,
        dependencyCount: 1,
      }),
    }))
    expect(res.body.data.binding.activePacks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packType: 'ARL',
        packKey: 'adaptive-reasoning-layer',
        executionMode: 'PROVIDER_CONTEXT',
        contentHash: 'sha256:adaptive-reasoning-layer',
      }),
      expect.objectContaining({
        packType: 'RL',
        packKey: 'rendering-layer',
        runtimeBindable: true,
      }),
    ]))
    expect(JSON.stringify(res.body)).not.toContain('Activation content must not leak')
    expect(JSON.stringify(res.body)).not.toContain('Version content must not leak')
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/resolution-preview resolves validation packs as required manifest entries', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const manifest = makeKnowledgePackManifest({
      mandatoryPacks: [
        {
          packCategory: 'OUTCOME',
          purposeCategory: 'GOVERNANCE',
          packType: 'ARL',
          packKey: 'adaptive-reasoning-layer',
          label: 'Adaptive Reasoning Layer',
          executionMode: 'PROVIDER_CONTEXT',
          required: true,
          dependencyKeys: [],
          metadata: {},
        },
      ],
      validationPacks: [
        {
          packCategory: 'PLATFORM',
          purposeCategory: 'VALIDATION',
          packType: 'TRUTH_CERTIFICATION',
          packKey: 'truth-certification-pack',
          label: 'Truth Certification',
          executionMode: 'POST_VALIDATION',
          required: true,
          dependencyKeys: ['adaptive-reasoning-layer'],
          metadata: {},
        },
      ],
    })
    const activations = [
      makeActivation({ packCategory: 'OUTCOME', packType: 'ARL', packKey: 'adaptive-reasoning-layer', label: 'Adaptive Reasoning Layer' }),
      makeActivation({ packCategory: 'PLATFORM', packType: 'TRUTH_CERTIFICATION', packKey: 'truth-certification-pack', label: 'Truth Certification' }),
    ]
    KnowledgePackManifest.findOne.mockReturnValue(buildFindOneChain(manifest))
    KnowledgePackActivation.find.mockReturnValue(buildFindChain(activations))
    KnowledgePackVersion.find.mockReturnValue(buildFindChain(makeVersionsForActivations(activations)))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/resolution-preview?frameworkKey=VMF&runtimeType=VALUE_NARRATIVE&packageKey=standard-package-vmf-3-1-rkm&packageVersion=3.1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.binding).toEqual(expect.objectContaining({
      status: 'PROJECTED',
      validationPacks: [
        expect.objectContaining({
          packType: 'TRUTH_CERTIFICATION',
          packKey: 'truth-certification-pack',
          manifestSection: 'validation',
          required: true,
          runtimeBindable: true,
        }),
      ],
      resolution: expect.objectContaining({
        activeCount: 2,
        requiredCount: 2,
        validationCount: 1,
        dependencyCount: 1,
      }),
    }))
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/reasoning-context-preview selects requested context packs without exposing content', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const stylePack = {
      packCategory: 'CONTEXT',
      purposeCategory: 'STYLE',
      packType: 'STYLE',
      packKey: 'board-reporting-style',
      label: 'Board Reporting Style',
      executionMode: 'PROVIDER_CONTEXT',
      required: false,
      dependencyKeys: [],
      metadata: {},
    }
    const audiencePack = {
      packCategory: 'CONTEXT',
      purposeCategory: 'AUDIENCE',
      packType: 'AUDIENCE',
      packKey: 'c-suite-audience',
      label: 'C-Suite Audience',
      executionMode: 'PROVIDER_CONTEXT',
      required: false,
      dependencyKeys: [],
      metadata: {},
    }
    const decisionPack = {
      packCategory: 'CONTEXT',
      purposeCategory: 'DECISION',
      packType: 'DECISION',
      packKey: 'investment-committee-decision',
      label: 'Investment Committee Decision',
      executionMode: 'PROVIDER_CONTEXT',
      required: false,
      dependencyKeys: [],
      metadata: {},
    }
    const manifest = makeKnowledgePackManifest({
      outputKey: 'executive_brief',
      mandatoryPacks: [
        {
          packCategory: 'OUTCOME',
          purposeCategory: 'GOVERNANCE',
          packType: 'ARL',
          packKey: 'adaptive-reasoning-layer',
          label: 'Adaptive Reasoning Layer',
          executionMode: 'PROVIDER_CONTEXT',
          required: true,
          dependencyKeys: [],
          metadata: {},
        },
      ],
      optionalPacks: [stylePack, audiencePack, decisionPack],
    })
    const activations = [
      makeActivation({ packCategory: 'OUTCOME', packType: 'ARL', packKey: 'adaptive-reasoning-layer', label: 'Adaptive Reasoning Layer' }),
      makeActivation(stylePack, { contentHash: 'sha256:style-pack' }),
      makeActivation(audiencePack, { contentHash: 'sha256:audience-pack' }),
      makeActivation(decisionPack, { contentHash: 'sha256:decision-pack' }),
    ]
    KnowledgePackManifest.findOne.mockReturnValue(buildFindOneChain(manifest))
    KnowledgePackActivation.find.mockReturnValue(buildFindChain(activations))
    KnowledgePackVersion.find.mockReturnValue(buildFindChain(makeVersionsForActivations(activations)))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/reasoning-context-preview?frameworkKey=VMF&runtimeType=VALUE_NARRATIVE&packageKey=standard-package-vmf-3-1-rkm&packageVersion=3.1&outputKey=EXECUTIVE_BRIEF&contextCategories=STYLE,AUDIENCE,DECISION')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      status: 'PROJECTED',
      previewOnly: true,
      contentVisible: false,
      generatedOutput: false,
      providerExecution: false,
      request: expect.objectContaining({
        outputKey: 'executive_brief',
        contextCategories: ['STYLE', 'AUDIENCE', 'DECISION'],
      }),
      context: expect.objectContaining({
        assemblyMode: 'PREVIEW_ONLY',
        basePacks: [
          expect.objectContaining({
            packType: 'ARL',
            packKey: 'adaptive-reasoning-layer',
            runtimeBindable: true,
          }),
        ],
        selectedContextPacks: expect.arrayContaining([
          expect.objectContaining({
            purposeCategory: 'STYLE',
            packKey: 'board-reporting-style',
            contentHash: 'sha256:style-pack',
          }),
          expect.objectContaining({
            purposeCategory: 'AUDIENCE',
            packKey: 'c-suite-audience',
          }),
          expect.objectContaining({
            purposeCategory: 'DECISION',
            packKey: 'investment-committee-decision',
          }),
        ]),
        resolution: expect.objectContaining({
          status: 'PROJECTED',
          basePackCount: 1,
          selectedContextPackCount: 3,
          requestedContextCategories: ['STYLE', 'AUDIENCE', 'DECISION'],
        }),
      }),
      safeguards: expect.arrayContaining([
        'PREVIEW_ONLY_NO_PROVIDER_EXECUTION',
        'NO_GENERATED_OUTPUT',
        'NO_PACK_CONTENT_EXPOSED',
        'NO_RUNTIME_TRUTH_EXPOSED',
      ]),
    }))
    expect(JSON.stringify(res.body)).not.toContain('Activation content must not leak')
    expect(JSON.stringify(res.body)).not.toContain('Version content must not leak')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/reasoning-context-preview fails closed when a requested context category is not runtime-bindable', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const stylePack = {
      packCategory: 'CONTEXT',
      purposeCategory: 'STYLE',
      packType: 'STYLE',
      packKey: 'board-reporting-style',
      label: 'Board Reporting Style',
      executionMode: 'PROVIDER_CONTEXT',
      required: false,
      dependencyKeys: [],
      metadata: {},
    }
    const audiencePack = {
      packCategory: 'CONTEXT',
      purposeCategory: 'AUDIENCE',
      packType: 'AUDIENCE',
      packKey: 'c-suite-audience',
      label: 'C-Suite Audience',
      executionMode: 'PROVIDER_CONTEXT',
      required: false,
      dependencyKeys: [],
      metadata: {},
    }
    const arlPack = {
      packCategory: 'OUTCOME',
      purposeCategory: 'GOVERNANCE',
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      label: 'Adaptive Reasoning Layer',
    }
    KnowledgePackManifest.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePackManifest({
      mandatoryPacks: [{
        ...arlPack,
        executionMode: 'PROVIDER_CONTEXT',
        required: true,
        dependencyKeys: [],
        metadata: {},
      }],
      optionalPacks: [stylePack, audiencePack],
    })))
    const activations = [
      makeActivation(arlPack),
      makeActivation(stylePack),
    ]
    KnowledgePackActivation.find.mockReturnValue(buildFindChain(activations))
    KnowledgePackVersion.find.mockReturnValue(buildFindChain(makeVersionsForActivations(activations)))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/reasoning-context-preview?contextCategories=STYLE,AUDIENCE')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('REASONING_CONTEXT_PACK_MISSING')
    expect(res.body.error.details.purposeCategory).toBe('AUDIENCE')
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/reasoning-context-preview rejects tenant-scoped context packs outside the requested tenant', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const brandPack = {
      packCategory: 'CONTEXT',
      purposeCategory: 'BRAND',
      packType: 'BRAND',
      packKey: 'customer-brand',
      label: 'Customer Brand',
      executionMode: 'PROVIDER_CONTEXT',
      required: false,
      dependencyKeys: [],
      metadata: {},
    }
    const arlPack = {
      packCategory: 'OUTCOME',
      purposeCategory: 'GOVERNANCE',
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      label: 'Adaptive Reasoning Layer',
    }
    KnowledgePackManifest.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePackManifest({
      mandatoryPacks: [{
        ...arlPack,
        executionMode: 'PROVIDER_CONTEXT',
        required: true,
        dependencyKeys: [],
        metadata: {},
      }],
      optionalPacks: [brandPack],
    })))
    const activations = [
      makeActivation(arlPack),
      makeActivation(brandPack, {
        visibility: 'TENANT',
        tenantId: '507f1f77bcf86cd799439099',
      }),
    ]
    KnowledgePackActivation.find.mockReturnValue(buildFindChain(activations))
    KnowledgePackVersion.find.mockReturnValue(buildFindChain(makeVersionsForActivations(activations)))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/reasoning-context-preview?contextCategories=BRAND&tenantId=507f1f77bcf86cd799439012')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.details.reason).toBe('REASONING_CONTEXT_PACK_SCOPE_FORBIDDEN')
    expect(res.body.error.details).toEqual(expect.objectContaining({
      purposeCategory: 'BRAND',
      packType: 'BRAND',
      packKey: 'customer-brand',
      visibility: 'TENANT',
    }))
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/reasoning-context-preview rejects unsupported context categories at the validator boundary', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/reasoning-context-preview?contextCategories=STYLE,UNKNOWN')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(KnowledgePackManifest.findOne).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/resolution-preview rejects non-bindable manifests before activation lookup', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackManifest.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePackManifest({
      status: 'DRAFT',
    })))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/resolution-preview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('MANIFEST_NOT_RUNTIME_BINDABLE')
    expect(KnowledgePackActivation.find).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/resolution-preview fails closed when a mandatory pack is missing', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackActivation.find.mockReturnValue(buildFindChain([]))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/resolution-preview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('MANDATORY_PACK_MISSING')
    expect(res.body.error.details.packType).toBe('ARL')
    expect(KnowledgePackVersion.find).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/resolution-preview fails closed when a mandatory activation is inactive', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackActivation.find.mockReturnValue(buildFindChain([
      makeActivation(
        { packCategory: 'OUTCOME', packType: 'ARL', packKey: 'adaptive-reasoning-layer', label: 'Adaptive Reasoning Layer' },
        { status: 'DISABLED' },
      ),
    ]))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/resolution-preview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('MANDATORY_PACK_INACTIVE')
    expect(res.body.error.details.observedStatuses).toEqual(['DISABLED'])
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/resolution-preview fails closed on ambiguous active activations', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const pack = { packCategory: 'OUTCOME', packType: 'ARL', packKey: 'adaptive-reasoning-layer', label: 'Adaptive Reasoning Layer' }
    KnowledgePackActivation.find.mockReturnValue(buildFindChain([
      makeActivation(pack, { activationId: 'kpa-arl-global-one' }),
      makeActivation(pack, { activationId: 'kpa-arl-global-two' }),
    ]))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/resolution-preview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('MANDATORY_PACK_AMBIGUOUS')
    expect(res.body.error.details.activationIds).toEqual(['kpa-arl-global-one', 'kpa-arl-global-two'])
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/resolution-preview rejects dependency cycles before activation lookup', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackManifest.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePackManifest({
      mandatoryPacks: [
        {
          packCategory: 'OUTCOME',
          purposeCategory: 'GOVERNANCE',
          packType: 'ARL',
          packKey: 'adaptive-reasoning-layer',
          label: 'Adaptive Reasoning Layer',
          executionMode: 'PROVIDER_CONTEXT',
          dependencyKeys: ['rendering-layer'],
        },
        {
          packCategory: 'OUTCOME',
          purposeCategory: 'GOVERNANCE',
          packType: 'RL',
          packKey: 'rendering-layer',
          label: 'Rendering Layer',
          executionMode: 'PROVIDER_CONTEXT',
          dependencyKeys: ['adaptive-reasoning-layer'],
        },
      ],
    })))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/resolution-preview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('MANIFEST_DEPENDENCY_CYCLE')
    expect(KnowledgePackActivation.find).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/resolution-preview fails closed when a mandatory dependency is unresolved', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const arlActivation = makeActivation(
      { packCategory: 'OUTCOME', packType: 'ARL', packKey: 'adaptive-reasoning-layer', label: 'Adaptive Reasoning Layer' },
    )
    KnowledgePackManifest.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePackManifest({
      mandatoryPacks: [
        {
          packCategory: 'OUTCOME',
          purposeCategory: 'GOVERNANCE',
          packType: 'ARL',
          packKey: 'adaptive-reasoning-layer',
          label: 'Adaptive Reasoning Layer',
          executionMode: 'PROVIDER_CONTEXT',
          dependencyKeys: ['rendering-layer'],
        },
      ],
      optionalPacks: [
        {
          packCategory: 'OUTCOME',
          purposeCategory: 'GOVERNANCE',
          packType: 'RL',
          packKey: 'rendering-layer',
          label: 'Rendering Layer',
          executionMode: 'PROVIDER_CONTEXT',
          dependencyKeys: [],
        },
      ],
    })))
    KnowledgePackActivation.find.mockReturnValue(buildFindChain([arlActivation]))
    KnowledgePackVersion.find.mockReturnValue(buildFindChain([makeVersionForActivation(arlActivation)]))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/resolution-preview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('MANIFEST_DEPENDENCY_UNRESOLVED')
    expect(res.body.error.details.dependencyKey).toBe('rendering-layer')
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/manifests/:manifestId/resolution-preview fails closed when the activated version is draft', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const activation = makeActivation(
      { packCategory: 'OUTCOME', packType: 'ARL', packKey: 'adaptive-reasoning-layer', label: 'Adaptive Reasoning Layer' },
    )
    KnowledgePackActivation.find.mockReturnValue(buildFindChain([activation]))
    KnowledgePackVersion.find.mockReturnValue(buildFindChain([
      makeVersionForActivation(activation, { status: 'DRAFT' }),
    ]))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/manifests/kpm-vmf-outcome-studio-1-0-0-global/resolution-preview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('KNOWLEDGE_PACK_VERSION_NOT_RUNTIME_BINDABLE')
    expect(res.body.error.details.versionStatus).toBe('DRAFT')
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/resolution-preview fails closed when required packs are unbound', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/resolution-preview?frameworkKey=VMF&runtimeType=VALUE_NARRATIVE&packageKey=vmf-standard-2-3-1&packageVersion=2.3.1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      status: 'BLOCKED',
      mode: 'REGISTRY_RESOLUTION',
      previewOnly: true,
      contentVisible: false,
      activePacks: [],
    }))
    expect(res.body.data.requiredPacks).toHaveLength(5)
    expect(res.body.data.resolution.unboundRequiredPacks.map((pack) => pack.packType)).toEqual([
      'ARL',
      'RL',
      'OUTPUT_SCHEMA',
      'TRUTH_CERTIFICATION',
      'OUTPUT_TYPE_DEFINITION',
    ])
    expect(res.body.data.requiredPacks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packType: 'ARL',
        status: 'SOURCE_ONLY',
        runtimeBindable: false,
      }),
      expect.objectContaining({
        packType: 'RL',
        status: 'SOURCE_ONLY',
        runtimeBindable: false,
      }),
      expect.objectContaining({
        packType: 'OUTPUT_SCHEMA',
        status: 'SOURCE_ONLY',
        runtimeBindable: false,
      }),
      expect.objectContaining({
        packType: 'TRUTH_CERTIFICATION',
        status: 'SOURCE_ONLY',
        runtimeBindable: false,
      }),
      expect.objectContaining({
        packType: 'OUTPUT_TYPE_DEFINITION',
        status: 'SOURCE_ONLY',
        runtimeBindable: false,
      }),
    ]))
    expect(res.body.data.sourceBundle.starterPacks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packType: 'ARL',
        importStatus: 'NOT_IMPORTED',
      }),
      expect.objectContaining({
        packType: 'RL',
        importStatus: 'NOT_IMPORTED',
      }),
      expect.objectContaining({
        packType: 'OUTPUT_SCHEMA',
        importStatus: 'IMPORTED',
        latestVersionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
        latestSemanticVersion: '1.0.0',
        registryStatus: 'VALIDATED',
      }),
      expect.objectContaining({
        packType: 'TRUTH_CERTIFICATION',
        importStatus: 'NOT_IMPORTED',
      }),
      expect.objectContaining({
        packType: 'OUTPUT_TYPE_DEFINITION',
        importStatus: 'NOT_IMPORTED',
      }),
    ]))
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/resolution-preview resolves active packs without exposing content', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackActivation.find.mockReturnValue(buildFindChain([
      makeActivation(REQUIRED_PACKS[0], {
        semanticVersion: '1.0.0',
        scopeType: 'GLOBAL',
        scopeKey: 'GLOBAL',
        activatedAt: '2026-06-15T09:20:00.000Z',
      }),
      makeActivation(REQUIRED_PACKS[0], {
        activationId: 'kpa-adaptive-reasoning-layer-package',
        versionId: 'kpv-adaptive-reasoning-layer-1-1-0-package',
        semanticVersion: '1.1.0',
        scopeType: 'PACKAGE',
        scopeKey: 'PACKAGE:VMF:vmf-standard-2-3-1:2.3.1',
        activatedAt: '2026-06-15T09:10:00.000Z',
      }),
      ...REQUIRED_PACKS.slice(1).map((pack) => makeActivation(pack)),
    ]))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/resolution-preview?frameworkKey=VMF&runtimeType=VALUE_NARRATIVE&packageKey=vmf-standard-2-3-1&packageVersion=2.3.1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      status: 'PROJECTED',
      mode: 'REGISTRY_RESOLUTION',
      previewOnly: true,
      contentVisible: false,
    }))
    expect(res.body.data.activePacks).toHaveLength(5)
    expect(res.body.data.resolution.unboundRequiredPacks).toEqual([])
    expect(res.body.data.activePacks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packType: 'ARL',
        semanticVersion: '1.1.0',
        scopeKey: 'PACKAGE:VMF:VMF-STANDARD-2-3-1:2.3.1',
        runtimeBindable: true,
      }),
    ]))
    expect(JSON.stringify(res.body)).not.toContain('Activation content must not leak')
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/:packId returns detail without version content', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackActivation.find.mockReturnValue(buildFindChain([makeActivation(REQUIRED_PACKS[2])]))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      packId: 'kp-output-schema-output-schemas-pack',
      versions: [
        expect.objectContaining({
          versionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
          contentHash: 'sha256:output-schema-content',
        }),
      ],
      activations: [
        expect.objectContaining({
          packType: 'OUTPUT_SCHEMA',
          packKey: 'output-schemas-pack',
        }),
      ],
    }))
    expect(JSON.stringify(res.body)).not.toContain('Version content must not leak')
    expect(JSON.stringify(res.body)).not.toContain('Activation content must not leak')
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId returns source-document draft metadata', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const draftPack = makeKnowledgePack({
      packId: 'kp-style-board-executive-style',
      packCategory: 'STYLE',
      packType: 'STYLE',
      packKey: 'board-executive-style',
      label: 'Board Executive Style',
      status: 'DRAFT',
      purposeCategory: 'STYLE',
      sourceAuthority: 'StorylineOS Methodology',
      executionMode: 'PROVIDER_CONTEXT',
      visibility: 'PLATFORM',
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
      latestVersionId: 'kpv-style-board-executive-style-1-0-0-global',
      latestSemanticVersion: '1.0.0',
    })
    const draftVersion = makeKnowledgePackVersion({
      versionId: 'kpv-style-board-executive-style-1-0-0-global',
      packId: 'kp-style-board-executive-style',
      packCategory: 'STYLE',
      packType: 'STYLE',
      packKey: 'board-executive-style',
      status: 'DRAFT',
      purposeCategory: 'STYLE',
      sourceAuthority: 'StorylineOS Methodology',
      contentFormat: 'DOCX',
      sourceFilename: 'Board Executive Style.docx',
      content: 'Source document extracted text must not leak from metadata endpoint.',
      sourceDocuments: [
        {
          sourceDocumentId: 'style-doc-1',
          filename: 'Board Executive Style.docx',
          fileExtension: 'docx',
          sourceHash: 'sha256:style-doc-hash',
        },
      ],
      validationSummary: {
        status: 'NOT_RUN',
        mode: 'HUMAN_REVIEW_REQUIRED',
      },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
    })
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(draftPack))
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(draftVersion))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-style-board-executive-style/versions/kpv-style-board-executive-style-1-0-0-global')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      versionId: 'kpv-style-board-executive-style-1-0-0-global',
      packId: 'kp-style-board-executive-style',
      packType: 'STYLE',
      packKey: 'board-executive-style',
      status: 'DRAFT',
      contentFormat: 'DOCX',
      sourceFilename: 'Board Executive Style.docx',
      sourceAuthority: 'StorylineOS Methodology',
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
      validationSummary: expect.objectContaining({
        status: 'NOT_RUN',
        mode: 'HUMAN_REVIEW_REQUIRED',
      }),
    }))
    expect(JSON.stringify(res.body)).not.toContain('Source document extracted text must not leak')
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/content-preview returns source content on a dedicated audited endpoint', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      content: OUTPUT_SCHEMAS_YAML,
      contentFormat: 'YAML',
      sourceFilename: 'output-schemas-pack-v1.yaml',
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .get(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/content-preview`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      versionId: versionDoc.versionId,
      packType: 'OUTPUT_SCHEMA',
      packKey: 'output-schemas-pack',
      contentFormat: 'YAML',
      sourceFilename: 'output-schemas-pack-v1.yaml',
      contentVisible: true,
      previewMode: 'SOURCE_BACKED_SUPER_ADMIN_ONLY',
      content: expect.stringContaining('EXECUTIVE_BRIEF'),
      contentLength: OUTPUT_SCHEMAS_YAML.length,
    }))
    const auditPayload = AuditLog.createLog.mock.calls.find(
      ([payload]) => payload.action === 'KNOWLEDGE_PACK_CONTENT_PREVIEWED',
    )?.[0]
    expect(auditPayload).toEqual(expect.objectContaining({
      action: 'KNOWLEDGE_PACK_CONTENT_PREVIEWED',
      diff: expect.objectContaining({
        contentVisible: true,
        contentIncludedInAudit: false,
        contentLength: OUTPUT_SCHEMAS_YAML.length,
      }),
    }))
    expect(JSON.stringify(auditPayload)).not.toContain('EXECUTIVE_BRIEF')
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/content-preview returns approved ARL source content only through preview', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      versionId: 'kpv-arl-adaptive-reasoning-layer-1-0-0-global',
      packId: 'kp-arl-adaptive-reasoning-layer',
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      content: ARL_YAML,
      contentFormat: 'YAML',
      sourceFilename: 'adaptive-reasoning-layer-v1.yaml',
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/adaptive-reasoning-layer/versions/kpv-adaptive-reasoning-layer-1-0-0-global/content-preview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      versionId: versionDoc.versionId,
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      sourceFilename: 'adaptive-reasoning-layer-v1.yaml',
      contentVisible: true,
      content: expect.stringContaining('reasoning_stages'),
      contentLength: ARL_YAML.length,
    }))
    const auditPayload = AuditLog.createLog.mock.calls.find(
      ([payload]) => payload.action === 'KNOWLEDGE_PACK_CONTENT_PREVIEWED',
    )?.[0]
    expect(auditPayload).toEqual(expect.objectContaining({
      action: 'KNOWLEDGE_PACK_CONTENT_PREVIEWED',
      diff: expect.objectContaining({
        contentVisible: true,
        contentIncludedInAudit: false,
        contentLength: ARL_YAML.length,
      }),
    }))
    expect(JSON.stringify(auditPayload)).not.toContain('reasoning_stages')
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/content-preview fails closed when preview audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      content: OUTPUT_SCHEMAS_YAML,
      contentFormat: 'YAML',
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'KNOWLEDGE_PACK_CONTENT_PREVIEWED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .get(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/content-preview`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('AUDIT_PERSISTENCE_FAILED')
    expect(JSON.stringify(res.body)).not.toContain('EXECUTIVE_BRIEF')
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/starter-import imports bundled starter source as validated without activation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      status: 'VALIDATED',
      latestVersionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
      latestSemanticVersion: '1.0.0',
    }))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/output-schemas-pack/starter-import')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(201)
    const [, packUpsert] = KnowledgePack.findOneAndUpdate.mock.calls[0]
    expect(Object.keys(packUpsert.$setOnInsert)).not.toContain('label')
    expect(packUpsert.$set).toEqual(expect.objectContaining({
      packCategory: 'OUTCOME',
      label: 'Output Schemas',
    }))
    expect(KnowledgePackVersion.prototype.save.mock.contexts[0]).toEqual(expect.objectContaining({
      packCategory: 'OUTCOME',
    }))
    expect(res.body.data.version).toEqual(expect.objectContaining({
      versionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
      packCategory: 'OUTCOME',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'output-schemas-pack',
      status: 'VALIDATED',
      contentFormat: 'YAML',
      sourceFilename: 'output-schemas-pack-v1.yaml',
      validatedAt: expect.any(String),
    }))
    expect(res.body.data.version.contentHash).toMatch(/^sha256:/)
    expect(res.body.data.validationSummary).toEqual(expect.objectContaining({
      status: 'PASSED',
      mode: 'SOURCE_ONLY_TEXT_VALIDATION',
    }))
    expect(KnowledgePackVersion.prototype.save).toHaveBeenCalled()
    expect(KnowledgePackActivation.updateMany).not.toHaveBeenCalled()
    const auditPayload = AuditLog.createLog.mock.calls.find(
      ([payload]) => payload.action === 'OUTCOME_KNOWLEDGE_PACK_STARTER_IMPORTED',
    )?.[0]
    expect(auditPayload).toEqual(expect.objectContaining({
      action: 'OUTCOME_KNOWLEDGE_PACK_STARTER_IMPORTED',
      diff: expect.objectContaining({
        contentVisible: false,
        contentIncludedInAudit: false,
        importMode: 'BUNDLED_STARTER_SOURCE',
        sourceFilename: 'output-schemas-pack-v1.yaml',
      }),
    }))
    expect(JSON.stringify(res.body)).not.toContain('Executive Summary')
    expect(JSON.stringify(res.body)).not.toContain('required_sections')
    expect(JSON.stringify(AuditLog.createLog.mock.calls)).not.toContain('Executive Summary')
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/starter-import rejects duplicate bundled imports', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackVersion.findOne.mockReturnValueOnce(
      buildVersionFindOneChain(makeKnowledgePackVersion()),
    )

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/output-schemas-pack/starter-import')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('PACK_VERSION_ALREADY_EXISTS')
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/starter-import imports bundled ARL starter source', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      packId: 'kp-arl-adaptive-reasoning-layer',
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      label: 'Adaptive Reasoning Layer',
      status: 'VALIDATED',
      latestVersionId: 'kpv-arl-adaptive-reasoning-layer-1-0-0-global',
      latestSemanticVersion: '1.0.0',
    }))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/adaptive-reasoning-layer/starter-import')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(201)
    expect(res.body.data.version).toEqual(expect.objectContaining({
      versionId: 'kpv-arl-adaptive-reasoning-layer-1-0-0-global',
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      status: 'VALIDATED',
      contentFormat: 'YAML',
      sourceFilename: 'adaptive-reasoning-layer-v1.yaml',
      validatedAt: expect.any(String),
    }))
    expect(res.body.data.validationSummary).toEqual(expect.objectContaining({
      status: 'PASSED',
      mode: 'SOURCE_ONLY_TEXT_VALIDATION',
    }))
    const auditPayload = AuditLog.createLog.mock.calls.find(
      ([payload]) => payload.action === 'OUTCOME_KNOWLEDGE_PACK_STARTER_IMPORTED',
    )?.[0]
    expect(auditPayload.diff).toEqual(expect.objectContaining({
      contentVisible: false,
      contentIncludedInAudit: false,
      importMode: 'BUNDLED_STARTER_SOURCE',
      sourceFilename: 'adaptive-reasoning-layer-v1.yaml',
    }))
    expect(JSON.stringify(res.body)).not.toContain('reasoning_stages')
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/starter-import fails closed and rolls back when import audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(null))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'OUTCOME_KNOWLEDGE_PACK_STARTER_IMPORTED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/output-schemas-pack/starter-import')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('AUDIT_PERSISTENCE_FAILED')
    expect(KnowledgePackVersion.deleteOne).toHaveBeenCalledWith({
      versionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
    })
    expect(KnowledgePack.deleteOne).toHaveBeenCalledWith({
      packId: 'kp-output-schema-output-schemas-pack',
    })
    expect(JSON.stringify(res.body)).not.toContain('EXECUTIVE_BRIEF')
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/starter-import uses transaction rollback when connected', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const rollbackSession = buildRollbackSession()
    setMongooseReadyState(1)
    startSessionSpy.mockResolvedValueOnce(rollbackSession)
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(null))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'OUTCOME_KNOWLEDGE_PACK_STARTER_IMPORTED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/output-schemas-pack/starter-import')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(startSessionSpy).toHaveBeenCalled()
    expect(rollbackSession.withTransaction).toHaveBeenCalled()
    expect(rollbackSession.endSession).toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).toHaveBeenCalledWith({ session: rollbackSession })
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'OUTCOME_KNOWLEDGE_PACK_STARTER_IMPORTED' }),
      expect.objectContaining({ session: rollbackSession }),
    )
    expect(KnowledgePackVersion.deleteOne).not.toHaveBeenCalled()
    expect(KnowledgePack.deleteOne).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/starter-import removes new category metadata when existing-row audit rollback runs', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const existingPack = makeKnowledgePack({
      status: 'DRAFT',
      latestVersionId: 'kpv-output-schema-output-schemas-pack-0-9-0-global',
      latestSemanticVersion: '0.9.0',
    })
    delete existingPack.packCategory
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(existingPack))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'OUTCOME_KNOWLEDGE_PACK_STARTER_IMPORTED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/output-schemas-pack/starter-import')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(500)
    expect(KnowledgePackVersion.deleteOne).toHaveBeenCalledWith({
      versionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
    })
    expect(KnowledgePack.deleteOne).not.toHaveBeenCalled()
    expect(KnowledgePack.updateOne).toHaveBeenCalledWith(
      { packId: 'kp-output-schema-output-schemas-pack' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'DRAFT',
          latestVersionId: 'kpv-output-schema-output-schemas-pack-0-9-0-global',
          latestSemanticVersion: '0.9.0',
        }),
        $unset: {
          packCategory: '',
        },
      }),
    )
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions uploads starter source as draft without activation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      status: 'DRAFT',
      latestVersionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
      latestSemanticVersion: '1.0.0',
    }))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        semanticVersion: '1.0.0',
        schemaVersion: '1.0.0',
        content: OUTPUT_SCHEMAS_YAML,
      })

    expect(res.status).toBe(201)
    expect(res.body.data.version).toEqual(expect.objectContaining({
      versionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'output-schemas-pack',
      status: 'DRAFT',
      contentFormat: 'YAML',
      sourceFilename: 'output-schemas-pack-v1.yaml',
    }))
    expect(res.body.data.version.contentHash).toMatch(/^sha256:/)
    expect(JSON.stringify(res.body)).not.toContain('Executive Summary')
    expect(KnowledgePackActivation.updateMany).not.toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED',
    }))
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions uploads RL starter source as draft without activation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      packId: 'kp-rl-rendering-layer',
      packType: 'RL',
      packKey: 'rendering-layer',
      label: 'Rendering Layer',
      status: 'DRAFT',
      latestVersionId: 'kpv-rendering-layer-1-0-0-global',
      latestSemanticVersion: '1.0.0',
    }))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/rendering-layer/versions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        semanticVersion: '1.0.0',
        schemaVersion: '1.0.0',
        content: RL_YAML,
      })

    expect(res.status).toBe(201)
    expect(res.body.data.version).toEqual(expect.objectContaining({
      versionId: 'kpv-rl-rendering-layer-1-0-0-global',
      packType: 'RL',
      packKey: 'rendering-layer',
      status: 'DRAFT',
      contentFormat: 'YAML',
      sourceFilename: 'rendering-layer-v1.yaml',
    }))
    expect(KnowledgePackVersion.prototype.save).toHaveBeenCalled()
    expect(KnowledgePackActivation.updateMany).not.toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED',
    }))
    expect(JSON.stringify(res.body)).not.toContain('rendering_rules')
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import creates a source-document draft without activation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      packId: 'kp-style-board-executive-style',
      packType: 'STYLE',
      packKey: 'board-executive-style',
      label: 'Board Executive Style',
      status: 'DRAFT',
      purposeCategory: 'STYLE',
      sourceAuthority: 'StorylineOS Methodology',
      executionMode: 'PROVIDER_CONTEXT',
      visibility: 'PLATFORM',
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
      latestVersionId: 'kpv-style-board-executive-style-1-0-0-global',
      latestSemanticVersion: '1.0.0',
    }))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        label: 'Board Executive Style',
        purposeCategory: 'STYLE',
        semanticVersion: '1.0.0',
        sourceAuthority: 'StorylineOS Methodology',
        sourceDocument: {
          sourceDocumentId: 'style-doc-1',
          filename: 'Board Executive Style.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sourceHash: 'sha256:style-doc-hash',
        },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.pack).toEqual(expect.objectContaining({
      packId: 'kp-style-board-executive-style',
      packType: 'STYLE',
      purposeCategory: 'STYLE',
      visibility: 'PLATFORM',
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
    }))
    expect(res.body.data.version).toEqual(expect.objectContaining({
      versionId: 'kpv-style-board-executive-style-1-0-0-global',
      packType: 'STYLE',
      packKey: 'board-executive-style',
      status: 'DRAFT',
      contentFormat: 'DOCX',
      sourceFilename: 'Board Executive Style.docx',
      sourceAuthority: 'StorylineOS Methodology',
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
    }))
    expect(res.body.data.version.sourceDocuments).toEqual([
      expect.objectContaining({
        sourceDocumentId: 'style-doc-1',
        filename: 'Board Executive Style.docx',
        fileExtension: 'docx',
        sourceHash: 'sha256:style-doc-hash',
      }),
    ])
    expect(res.body.data.version.validationSummary).toEqual(expect.objectContaining({
      status: 'NOT_RUN',
      mode: 'HUMAN_REVIEW_REQUIRED',
    }))
    expect(JSON.stringify(res.body)).not.toContain('Provider instructions hidden from list responses')
    expect(KnowledgePackActivation.updateMany).not.toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED',
      diff: expect.objectContaining({
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        contentIncludedInAudit: false,
        activationCreated: false,
      }),
    }))
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import rejects unsupported source document formats', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        sourceDocument: {
          filename: 'Board Executive Style.exe',
        },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('PACK_SOURCE_FORMAT_UNSUPPORTED')
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import requires owner ids for scoped drafts', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'BRAND',
        packKey: 'acme-brand',
        label: 'Acme Brand',
        semanticVersion: '1.0.0',
        visibility: 'CUSTOMER',
        sourceDocument: {
          filename: 'Acme Brand Guidelines.pdf',
        },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.customerId).toBe('customerId is required for CUSTOMER visibility')
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import rejects duplicate draft versions for the same scope', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackVersion.findOne.mockReturnValueOnce(
      buildVersionFindOneChain(makeKnowledgePackVersion({
        versionId: 'kpv-style-board-executive-style-1-0-0-global',
        packType: 'STYLE',
        packKey: 'board-executive-style',
        semanticVersion: '1.0.0',
        scopeKey: 'GLOBAL',
      })),
    )

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        sourceDocument: {
          filename: 'Board Executive Style.docx',
        },
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('PACK_VERSION_ALREADY_EXISTS')
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/validate marks valid starter source as validated', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'DRAFT',
      content: OUTPUT_SCHEMAS_YAML,
      validationSummary: {},
      validatedAt: null,
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      status: 'VALIDATED',
      latestVersionId: versionDoc.versionId,
      latestSemanticVersion: versionDoc.semanticVersion,
    }))

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(versionDoc.status).toBe('VALIDATED')
    expect(versionDoc.save).toHaveBeenCalled()
    expect(res.body.data.version).toEqual(expect.objectContaining({
      status: 'VALIDATED',
      versionId: versionDoc.versionId,
    }))
    expect(res.body.data.validationSummary).toEqual(expect.objectContaining({
      status: 'PASSED',
      mode: 'SOURCE_ONLY_TEXT_VALIDATION',
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OUTCOME_KNOWLEDGE_PACK_VERSION_VALIDATED',
    }))
    expect(JSON.stringify(res.body)).not.toContain('Executive Summary')
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/validate returns 422 and persists failed validation status', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'DRAFT',
      content: 'pack:\n  key: output-schemas-pack\n',
      validationSummary: {},
      validatedAt: null,
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('PACK_VERSION_VALIDATION_FAILED')
    expect(res.body.error.details.validationSummary).toEqual(expect.objectContaining({
      status: 'FAILED',
    }))
    expect(versionDoc.status).toBe('FAILED_VALIDATION')
    expect(versionDoc.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OUTCOME_KNOWLEDGE_PACK_VALIDATION_FAILED',
    }))
    expect(KnowledgePackActivation.updateMany).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/activate rejects draft versions', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'DRAFT',
      content: OUTPUT_SCHEMAS_YAML,
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scopeType: 'GLOBAL' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('PACK_VERSION_REQUIRES_VALIDATED')
    expect(KnowledgePackActivation.updateMany).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/activate creates active activation after validation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      content: OUTPUT_SCHEMAS_YAML,
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      status: 'VALIDATED',
      latestVersionId: versionDoc.versionId,
      latestSemanticVersion: versionDoc.semanticVersion,
    }))

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scopeType: 'GLOBAL' })

    expect(res.status).toBe(200)
    expect(versionDoc.status).toBe('ACTIVE')
    expect(versionDoc.save).toHaveBeenCalled()
    expect(KnowledgePackActivation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        packType: 'OUTPUT_SCHEMA',
        packKey: 'output-schemas-pack',
        scopeKey: 'GLOBAL',
        status: 'ACTIVE',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'ROLLED_BACK' }),
      }),
      expect.any(Object),
    )
    expect(KnowledgePackActivation.prototype.save).toHaveBeenCalled()
    expect(res.body.data.activation).toEqual(expect.objectContaining({
      packCategory: 'OUTCOME',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'output-schemas-pack',
      status: 'ACTIVE',
      scopeType: 'GLOBAL',
      scopeKey: 'GLOBAL',
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OUTCOME_KNOWLEDGE_PACK_ACTIVATED',
      diff: expect.objectContaining({
        contentHash: versionDoc.contentHash,
        scopeKey: 'GLOBAL',
      }),
    }))
    expect(JSON.stringify(res.body)).not.toContain('EXECUTIVE_BRIEF')
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/activate fails closed when activation audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      content: OUTPUT_SCHEMAS_YAML,
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'OUTCOME_KNOWLEDGE_PACK_ACTIVATED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scopeType: 'GLOBAL' })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('AUDIT_PERSISTENCE_FAILED')
    expect(KnowledgePackActivation.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        activationId: 'kpa-output-schema-output-schemas-pack-kpv-output-schema-output-schemas-pack-1-0-0-global-global',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'ROLLED_BACK',
          rollbackReason: 'Activation audit persistence failed.',
        }),
      }),
    )
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/activate uses transaction rollback when activation audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      content: OUTPUT_SCHEMAS_YAML,
    })
    const rollbackSession = buildRollbackSession([versionDoc])
    setMongooseReadyState(1)
    startSessionSpy.mockResolvedValueOnce(rollbackSession)
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'OUTCOME_KNOWLEDGE_PACK_ACTIVATED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scopeType: 'GLOBAL' })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(rollbackSession.withTransaction).toHaveBeenCalled()
    expect(rollbackSession.endSession).toHaveBeenCalled()
    expect(versionDoc.status).toBe('VALIDATED')
    expect(KnowledgePackActivation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        packType: 'OUTPUT_SCHEMA',
        packKey: 'output-schemas-pack',
        scopeKey: 'GLOBAL',
        status: 'ACTIVE',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'ROLLED_BACK' }),
      }),
      expect.objectContaining({ session: rollbackSession }),
    )
    expect(KnowledgePackActivation.prototype.save).toHaveBeenCalledWith({ session: rollbackSession })
    expect(versionDoc.save).toHaveBeenCalledWith({ session: rollbackSession })
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'OUTCOME_KNOWLEDGE_PACK_ACTIVATED' }),
      expect.objectContaining({ session: rollbackSession }),
    )
    expect(KnowledgePackActivation.updateOne).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.updateOne).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/disable disables active version bindings and audits the lifecycle event', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'ACTIVE',
      content: OUTPUT_SCHEMAS_YAML,
    })
    const activeActivation = makeActivation(REQUIRED_PACKS[2], {
      activationId: 'kpa-output-schema-current-active',
      versionId: versionDoc.versionId,
      status: 'ACTIVE',
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(makeKnowledgePack({
      status: 'ACTIVE',
      latestVersionId: versionDoc.versionId,
      latestSemanticVersion: versionDoc.semanticVersion,
    })))
    KnowledgePackActivation.find.mockReturnValueOnce(buildFindChain([activeActivation]))

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(versionDoc.status).toBe('DISABLED')
    expect(versionDoc.save).toHaveBeenCalled()
    expect(KnowledgePackActivation.updateMany).toHaveBeenCalledWith(
      {
        activationId: { $in: ['kpa-output-schema-current-active'] },
        status: 'ACTIVE',
      },
      {
        $set: {
          status: 'DISABLED',
        },
      },
      expect.any(Object),
    )
    expect(res.body.data.version).toEqual(expect.objectContaining({
      status: 'DISABLED',
      versionId: versionDoc.versionId,
    }))
    expect(res.body.data.affectedActivationIds).toEqual(['kpa-output-schema-current-active'])
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'KNOWLEDGE_PACK_DISABLED',
      diff: expect.objectContaining({
        lifecycleAction: 'DISABLE',
        affectedActivationIds: ['kpa-output-schema-current-active'],
      }),
    }))
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/deprecate deprecates a validated version without creating runtime bindings', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      content: OUTPUT_SCHEMAS_YAML,
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(makeKnowledgePack({
      status: 'VALIDATED',
      latestVersionId: versionDoc.versionId,
      latestSemanticVersion: versionDoc.semanticVersion,
    })))

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/deprecate`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(versionDoc.status).toBe('DEPRECATED')
    expect(KnowledgePackActivation.updateMany).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'KNOWLEDGE_PACK_DEPRECATED',
      diff: expect.objectContaining({
        lifecycleAction: 'DEPRECATE',
        affectedActivationIds: [],
      }),
    }))
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/disable fails closed when lifecycle audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'ACTIVE',
      content: OUTPUT_SCHEMAS_YAML,
    })
    const activeActivation = makeActivation(REQUIRED_PACKS[2], {
      activationId: 'kpa-output-schema-current-active',
      versionId: versionDoc.versionId,
      status: 'ACTIVE',
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(makeKnowledgePack({
      status: 'ACTIVE',
      latestVersionId: versionDoc.versionId,
      latestSemanticVersion: versionDoc.semanticVersion,
    })))
    KnowledgePackActivation.find.mockReturnValueOnce(buildFindChain([activeActivation]))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'KNOWLEDGE_PACK_DISABLED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('AUDIT_PERSISTENCE_FAILED')
    expect(KnowledgePackVersion.updateOne).toHaveBeenCalledWith(
      { versionId: versionDoc.versionId },
      { $set: { status: 'ACTIVE' } },
    )
    expect(KnowledgePackActivation.updateMany).toHaveBeenCalledWith(
      { activationId: { $in: ['kpa-output-schema-current-active'] } },
      {
        $set: {
          status: 'ACTIVE',
        },
      },
    )
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/disable uses transaction rollback when lifecycle audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'ACTIVE',
      content: OUTPUT_SCHEMAS_YAML,
    })
    const activeActivation = makeActivation(REQUIRED_PACKS[2], {
      activationId: 'kpa-output-schema-current-active',
      versionId: versionDoc.versionId,
      status: 'ACTIVE',
    })
    const rollbackSession = buildRollbackSession([versionDoc])
    setMongooseReadyState(1)
    startSessionSpy.mockResolvedValueOnce(rollbackSession)
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(makeKnowledgePack({
      status: 'ACTIVE',
      latestVersionId: versionDoc.versionId,
      latestSemanticVersion: versionDoc.semanticVersion,
    })))
    KnowledgePackActivation.find.mockReturnValueOnce(buildFindChain([activeActivation]))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'KNOWLEDGE_PACK_DISABLED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/disable`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(rollbackSession.withTransaction).toHaveBeenCalled()
    expect(rollbackSession.endSession).toHaveBeenCalled()
    expect(versionDoc.status).toBe('ACTIVE')
    expect(versionDoc.save).toHaveBeenCalledWith({ session: rollbackSession })
    expect(KnowledgePackActivation.updateMany).toHaveBeenCalledTimes(1)
    expect(KnowledgePackActivation.updateMany).toHaveBeenCalledWith(
      {
        activationId: { $in: ['kpa-output-schema-current-active'] },
        status: 'ACTIVE',
      },
      {
        $set: {
          status: 'DISABLED',
        },
      },
      expect.objectContaining({ session: rollbackSession }),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'KNOWLEDGE_PACK_DISABLED' }),
      expect.objectContaining({ session: rollbackSession }),
    )
    expect(KnowledgePackVersion.updateOne).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/rollback activates the selected validated version and audits rollback lineage', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const targetVersionDoc = makeKnowledgePackVersionDoc({
      versionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
      semanticVersion: '1.0.0',
      status: 'VALIDATED',
      content: OUTPUT_SCHEMAS_YAML,
    })
    const activeActivation = makeActivation(REQUIRED_PACKS[2], {
      activationId: 'kpa-output-schema-v1-1-active',
      versionId: 'kpv-output-schema-output-schemas-pack-1-1-0-global',
      semanticVersion: '1.1.0',
      status: 'ACTIVE',
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(targetVersionDoc))
    KnowledgePackActivation.findOne
      .mockReturnValueOnce(buildActivationFindOneChain(activeActivation))
      .mockReturnValueOnce(buildActivationFindOneChain(activeActivation))
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(makeKnowledgePack({
      status: 'ACTIVE',
      latestVersionId: activeActivation.versionId,
      latestSemanticVersion: activeActivation.semanticVersion,
    })))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/rollback')
      .set('Authorization', `Bearer ${token}`)
      .send({
        versionId: targetVersionDoc.versionId,
        scopeType: 'GLOBAL',
        rollbackReason: 'Restore previous certified schema set.',
      })

    expect(res.status).toBe(200)
    expect(targetVersionDoc.status).toBe('ACTIVE')
    expect(KnowledgePackActivation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        packType: 'OUTPUT_SCHEMA',
        packKey: 'output-schemas-pack',
        scopeKey: 'GLOBAL',
        status: 'ACTIVE',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'ROLLED_BACK',
          rollbackReason: 'Restore previous certified schema set.',
        }),
      }),
      expect.any(Object),
    )
    expect(KnowledgePackActivation.prototype.save).toHaveBeenCalled()
    expect(res.body.data.activation).toEqual(expect.objectContaining({
      versionId: targetVersionDoc.versionId,
      semanticVersion: '1.0.0',
      status: 'ACTIVE',
      scopeKey: 'GLOBAL',
    }))
    expect(res.body.data.previousActivation).toEqual(expect.objectContaining({
      activationId: 'kpa-output-schema-v1-1-active',
      versionId: 'kpv-output-schema-output-schemas-pack-1-1-0-global',
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'KNOWLEDGE_PACK_ROLLED_BACK',
      diff: expect.objectContaining({
        rollbackFromActivationId: 'kpa-output-schema-v1-1-active',
        rollbackFromVersionId: 'kpv-output-schema-output-schemas-pack-1-1-0-global',
        rollbackReason: 'Restore previous certified schema set.',
      }),
    }))
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/rollback uses transaction rollback when rollback audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const targetVersionDoc = makeKnowledgePackVersionDoc({
      versionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
      semanticVersion: '1.0.0',
      status: 'VALIDATED',
      content: OUTPUT_SCHEMAS_YAML,
    })
    const activeActivation = makeActivation(REQUIRED_PACKS[2], {
      activationId: 'kpa-output-schema-v1-1-active',
      versionId: 'kpv-output-schema-output-schemas-pack-1-1-0-global',
      semanticVersion: '1.1.0',
      status: 'ACTIVE',
    })
    const rollbackSession = buildRollbackSession([targetVersionDoc])
    setMongooseReadyState(1)
    startSessionSpy.mockResolvedValueOnce(rollbackSession)
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(targetVersionDoc))
    KnowledgePackActivation.findOne
      .mockReturnValueOnce(buildActivationFindOneChain(activeActivation))
      .mockReturnValueOnce(buildActivationFindOneChain(activeActivation))
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(makeKnowledgePack({
      status: 'ACTIVE',
      latestVersionId: activeActivation.versionId,
      latestSemanticVersion: activeActivation.semanticVersion,
    })))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'KNOWLEDGE_PACK_ROLLED_BACK') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/rollback')
      .set('Authorization', `Bearer ${token}`)
      .send({
        versionId: targetVersionDoc.versionId,
        scopeType: 'GLOBAL',
        rollbackReason: 'Restore previous certified schema set.',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(rollbackSession.withTransaction).toHaveBeenCalled()
    expect(rollbackSession.endSession).toHaveBeenCalled()
    expect(targetVersionDoc.status).toBe('VALIDATED')
    expect(KnowledgePackActivation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        packType: 'OUTPUT_SCHEMA',
        packKey: 'output-schemas-pack',
        scopeKey: 'GLOBAL',
        status: 'ACTIVE',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'ROLLED_BACK',
          rollbackReason: 'Restore previous certified schema set.',
        }),
      }),
      expect.objectContaining({ session: rollbackSession }),
    )
    expect(KnowledgePackActivation.prototype.save).toHaveBeenCalledWith({ session: rollbackSession })
    expect(targetVersionDoc.save).toHaveBeenCalledWith({ session: rollbackSession })
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'KNOWLEDGE_PACK_ROLLED_BACK' }),
      expect.objectContaining({ session: rollbackSession }),
    )
    expect(KnowledgePackActivation.updateOne).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.updateOne).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/rollback rejects non-validated rollback targets', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const targetVersionDoc = makeKnowledgePackVersionDoc({
      status: 'DRAFT',
      content: OUTPUT_SCHEMAS_YAML,
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(targetVersionDoc))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/rollback')
      .set('Authorization', `Bearer ${token}`)
      .send({
        versionId: targetVersionDoc.versionId,
        scopeType: 'GLOBAL',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('PACK_VERSION_REQUIRES_VALIDATED')
    expect(KnowledgePackActivation.findOne).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/resolution-preview remains blocked when only starter source packs are active', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackActivation.find.mockReturnValue(buildFindChain([
      makeActivation(REQUIRED_PACKS[2]),
      makeActivation(REQUIRED_PACKS[3]),
    ]))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/resolution-preview?frameworkKey=VMF&runtimeType=VALUE_NARRATIVE&packageKey=vmf-standard-2-3-1&packageVersion=2.3.1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('BLOCKED')
    expect(res.body.data.activePacks).toHaveLength(2)
    expect(res.body.data.resolution).toEqual(expect.objectContaining({
      activeCount: 2,
      requiredCount: 5,
    }))
    expect(res.body.data.resolution.unboundRequiredPacks.map((pack) => pack.packType)).toEqual([
      'ARL',
      'RL',
      'OUTPUT_TYPE_DEFINITION',
    ])
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions rejects non-Super Admin callers', async () => {
    const token = await getAccessTokenForUser(makeFakeUser({
      _id: NON_ADMIN_ID,
      id: NON_ADMIN_ID,
      email: 'user@storylineos.com',
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    }))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        semanticVersion: '1.0.0',
        schemaVersion: '1.0.0',
        content: OUTPUT_SCHEMAS_YAML,
      })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs rejects non-Super Admin callers', async () => {
    const token = await getAccessTokenForUser(makeFakeUser({
      _id: NON_ADMIN_ID,
      id: NON_ADMIN_ID,
      email: 'user@storylineos.com',
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    }))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(KnowledgePack.find).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.find).not.toHaveBeenCalled()
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/content-preview rejects non-Super Admin callers', async () => {
    const token = await getAccessTokenForUser(makeFakeUser({
      _id: NON_ADMIN_ID,
      id: NON_ADMIN_ID,
      email: 'user@storylineos.com',
      memberships: [{ customerId: '607f1f77bcf86cd799439099', roles: ['USER'] }],
    }))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/kpv-output-schema-output-schemas-pack-1-0-0-global/content-preview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(KnowledgePackVersion.findOne).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })
})
