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
  { packType: 'ARL', packKey: 'adaptive-reasoning-layer', label: 'Adaptive Reasoning Layer' },
  { packType: 'RL', packKey: 'rendering-layer', label: 'Rendering Layer' },
  { packType: 'OUTPUT_SCHEMA', packKey: 'output-schemas-pack', label: 'Output Schemas' },
  { packType: 'TRUTH_CERTIFICATION', packKey: 'truth-certification-pack', label: 'Truth Certification' },
  { packType: 'OUTPUT_TYPE_DEFINITION', packKey: 'outcome-output-types', label: 'Outcome Output Types' },
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
  lean: jest.fn().mockResolvedValue(rows),
})

const buildFindOneChain = (row) => ({
  lean: jest.fn().mockResolvedValue(row),
})

const buildVersionFindOneChain = (row) => ({
  lean: jest.fn().mockResolvedValue(row),
  select: jest.fn().mockResolvedValue(row),
})

const buildActivationFindOneChain = (row) => ({
  sort: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(row),
  session: jest.fn().mockReturnThis(),
})

const makeKnowledgePack = (overrides = {}) => ({
  _id: '607f1f77bcf86cd799439001',
  packId: 'kp-output-schema-output-schemas-pack',
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

const makeActivation = (pack, overrides = {}) => ({
  activationId: `kpa-${pack.packKey}-${overrides.scopeKey || 'global'}`,
  packId: `kp-${pack.packType.toLowerCase().replace(/_/g, '-')}-${pack.packKey}`,
  versionId: `kpv-${pack.packKey}-1-0-0-global`,
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
  AuditLog = models.AuditLog
  KnowledgePack = models.KnowledgePack
  KnowledgePackVersion = models.KnowledgePackVersion
  KnowledgePackActivation = models.KnowledgePackActivation
})

afterAll(() => {})

beforeEach(() => {
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
        packType: 'OUTPUT_SCHEMA',
        packKey: 'output-schemas-pack',
        status: 'VALIDATED',
      }),
    ])
    expect(res.body.sourceBundle).toEqual(expect.objectContaining({
      status: 'SOURCE_ONLY',
      starterPacks: expect.arrayContaining([
        expect.objectContaining({
          packType: 'ARL',
          sourceFilename: 'adaptive-reasoning-layer-v1.yaml',
          runtimeBindable: false,
          importStatus: 'NOT_IMPORTED',
        }),
        expect.objectContaining({
          packType: 'RL',
          sourceFilename: 'rendering-layer-v1.yaml',
          runtimeBindable: false,
          importStatus: 'NOT_IMPORTED',
        }),
        expect.objectContaining({
          packType: 'OUTPUT_SCHEMA',
          sourceFilename: 'output-schemas-pack-v1.yaml',
          runtimeBindable: false,
          importStatus: 'IMPORTED',
          latestVersionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
          latestSemanticVersion: '1.0.0',
          registryStatus: 'VALIDATED',
        }),
        expect.objectContaining({
          packType: 'TRUTH_CERTIFICATION',
          sourceFilename: 'truth-certification-pack-v1.yaml',
          runtimeBindable: false,
          importStatus: 'NOT_IMPORTED',
        }),
        expect.objectContaining({
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
      label: 'Output Schemas',
    }))
    expect(res.body.data.version).toEqual(expect.objectContaining({
      versionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
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
