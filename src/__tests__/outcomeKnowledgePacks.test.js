import mongoose from 'mongoose'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals'
import { buildKnowledgePackRelationshipChecksum } from '../services/knowledgePackRelationshipContract.js'

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

const escapeDocxXmlText = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const buildDocxBuffer = (documentText) => {
  const fileNameBuffer = Buffer.from('word/document.xml', 'utf8')
  const xmlBuffer = Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>${escapeDocxXmlText(documentText)}</w:t></w:r></w:p></w:body>
    </w:document>`, 'utf8')
  const compressedData = zlib.deflateRawSync(xmlBuffer)
  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt16LE(0, 6)
  localHeader.writeUInt16LE(8, 8)
  localHeader.writeUInt16LE(0, 10)
  localHeader.writeUInt16LE(0, 12)
  localHeader.writeUInt32LE(0, 14)
  localHeader.writeUInt32LE(compressedData.length, 18)
  localHeader.writeUInt32LE(xmlBuffer.length, 22)
  localHeader.writeUInt16LE(fileNameBuffer.length, 26)
  localHeader.writeUInt16LE(0, 28)

  const centralDirectoryOffset = localHeader.length + fileNameBuffer.length + compressedData.length
  const centralHeader = Buffer.alloc(46)
  centralHeader.writeUInt32LE(0x02014b50, 0)
  centralHeader.writeUInt16LE(20, 4)
  centralHeader.writeUInt16LE(20, 6)
  centralHeader.writeUInt16LE(0, 8)
  centralHeader.writeUInt16LE(8, 10)
  centralHeader.writeUInt16LE(0, 12)
  centralHeader.writeUInt16LE(0, 14)
  centralHeader.writeUInt32LE(0, 16)
  centralHeader.writeUInt32LE(compressedData.length, 20)
  centralHeader.writeUInt32LE(xmlBuffer.length, 24)
  centralHeader.writeUInt16LE(fileNameBuffer.length, 28)
  centralHeader.writeUInt16LE(0, 30)
  centralHeader.writeUInt16LE(0, 32)
  centralHeader.writeUInt16LE(0, 34)
  centralHeader.writeUInt16LE(0, 36)
  centralHeader.writeUInt32LE(0, 38)
  centralHeader.writeUInt32LE(0, 42)
  const centralDirectory = Buffer.concat([centralHeader, fileNameBuffer])

  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(0, 4)
  endOfCentralDirectory.writeUInt16LE(0, 6)
  endOfCentralDirectory.writeUInt16LE(1, 8)
  endOfCentralDirectory.writeUInt16LE(1, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12)
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16)
  endOfCentralDirectory.writeUInt16LE(0, 20)

  return Buffer.concat([
    localHeader,
    fileNameBuffer,
    compressedData,
    centralDirectory,
    endOfCentralDirectory,
  ])
}

const buildZipBuffer = (entries = []) => {
  const localParts = []
  const centralParts = []
  let localOffset = 0

  entries.forEach((entry) => {
    const fileNameBuffer = Buffer.from(entry.fileName, 'utf8')
    const compressionMethod = entry.compressionMethod ?? 8
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(String(entry.data || ''), 'utf8')
    const compressedData = entry.compressedData
      || (compressionMethod === 8 ? zlib.deflateRawSync(data) : data)
    const uncompressedSize = entry.uncompressedSize ?? data.length

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(compressionMethod, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(0, 14)
    localHeader.writeUInt32LE(compressedData.length, 18)
    localHeader.writeUInt32LE(uncompressedSize, 22)
    localHeader.writeUInt16LE(fileNameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, fileNameBuffer, compressedData)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(compressionMethod, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(0, 16)
    centralHeader.writeUInt32LE(compressedData.length, 20)
    centralHeader.writeUInt32LE(uncompressedSize, 24)
    centralHeader.writeUInt16LE(fileNameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(localOffset, 42)
    centralParts.push(centralHeader, fileNameBuffer)

    localOffset += localHeader.length + fileNameBuffer.length + compressedData.length
  })

  const localContent = Buffer.concat(localParts)
  const centralDirectory = Buffer.concat(centralParts)
  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(0, 4)
  endOfCentralDirectory.writeUInt16LE(0, 6)
  endOfCentralDirectory.writeUInt16LE(entries.length, 8)
  endOfCentralDirectory.writeUInt16LE(entries.length, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12)
  endOfCentralDirectory.writeUInt32LE(localContent.length, 16)
  endOfCentralDirectory.writeUInt16LE(0, 20)

  return Buffer.concat([localContent, centralDirectory, endOfCentralDirectory])
}

const buildDocxXmlBuffer = (documentText) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body><w:p><w:r><w:t>${escapeDocxXmlText(documentText)}</w:t></w:r></w:p></w:body>
  </w:document>`, 'utf8')

const buildPdfBuffer = (documentText) => {
  const escapedText = String(documentText || '').replace(/[()\\]/g, '\\$&')
  const stream = `BT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET`
  return Buffer.from(`%PDF-1.4
1 0 obj
<< /Length ${Buffer.byteLength(stream, 'latin1')} >>
stream
${stream}
endstream
endobj
%%EOF
`, 'latin1')
}

const buildTestContentHash = (content) =>
  `sha256:${crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex')}`
const EMPTY_RELATIONSHIP_CHECKSUM = crypto
  .createHash('sha256')
  .update('[]')
  .digest('hex')
const makeKnowledgeAssetId = (packType, packKey) => (
  `QA-${String(packType)}-${String(packKey)}`
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
)
const runtimeDependency = (targetKnowledgeLayer, targetCapabilityKey) => ({
  relationshipType: 'REQUIRED_AT_RUNTIME',
  targetKnowledgeLayer,
  targetCapabilityKey,
  requiredAt: 'RUNTIME',
  cardinality: 'ONE',
})
const relationshipChecksum = (relationships) => buildKnowledgePackRelationshipChecksum(relationships)

const DEFAULT_SOURCE_DOCUMENT_TEXT =
  'Output Schemas source document with required sections, schema guidance, and prohibited unsupported claims.'

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
  reviewStatus: doc.reviewStatus,
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
  description: 'Imported output schema pack.',
  status: 'VALIDATED',
  latestVersionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
  latestSemanticVersion: '1.0.0',
  sourceMetadata: {
    importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
    sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
    sourceFilename: 'output-schemas-pack-v1.md',
    sourceDocumentId: 'kpsrc-output-schema-output-schemas-pack-1-0-0-source-hash',
    sourceHash: 'sha256:source-hash',
    contentPersisted: true,
    sourceDocument: {
      sourceDocumentId: 'kpsrc-output-schema-output-schemas-pack-1-0-0-source-hash',
      filename: 'output-schemas-pack-v1.md',
      fileExtension: 'md',
      sourceHash: 'sha256:source-hash',
    },
  },
  authoringMode: 'IMPORT_SOURCE_DOCUMENT',
  reviewStatus: 'APPROVED',
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
  knowledgeAssetId: 'OSC-QA-001',
  knowledgeLayer: 'OUTPUT_SCHEMA',
  capabilityKey: 'output-schemas-pack',
  knowledgeAssetId: 'OSC-QA-001',
  workspaceCompatibility: ['OUTCOME'],
  dependencyReferences: [],
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: EMPTY_RELATIONSHIP_CHECKSUM,
  semanticVersion: '1.0.0',
  schemaVersion: '1.0.0',
  status: 'VALIDATED',
  scopeType: 'GLOBAL',
  scopeKey: 'GLOBAL',
  contentHash: buildTestContentHash(DEFAULT_SOURCE_DOCUMENT_TEXT),
  content: DEFAULT_SOURCE_DOCUMENT_TEXT,
  contentFormat: 'MARKDOWN',
  sourceFilename: 'output-schemas-pack-v1.md',
  sourceDocuments: [{
    sourceDocumentId: 'kpsrc-output-schema-output-schemas-pack-1-0-0-source-hash',
    filename: 'output-schemas-pack-v1.md',
    fileExtension: 'md',
    sourceHash: 'sha256:source-hash',
  }],
  sourceMetadata: {
    importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
    sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
    sourceFilename: 'output-schemas-pack-v1.md',
    sourceDocumentId: 'kpsrc-output-schema-output-schemas-pack-1-0-0-source-hash',
    sourceHash: 'sha256:source-hash',
    contentPersisted: true,
  },
  validationSummary: { status: 'PASSED' },
  authoringMode: 'IMPORT_SOURCE_DOCUMENT',
  reviewStatus: 'APPROVED',
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
  purposeCategory: pack.purposeCategory || 'GOVERNANCE',
  packType: pack.packType,
  packKey: pack.packKey,
  knowledgeAssetId: pack.knowledgeAssetId || makeKnowledgeAssetId(pack.packType, pack.packKey),
  label: pack.label || pack.packKey,
  semanticVersion: '1.0.0',
  schemaVersion: '1.0.0',
  status: 'ACTIVE',
  scopeType: 'GLOBAL',
  scopeKey: 'GLOBAL',
  executionMode: pack.executionMode || 'PROVIDER_CONTEXT',
  visibility: pack.visibility || 'PLATFORM',
  customerId: pack.customerId || null,
  tenantId: pack.tenantId || null,
  contentHash: `sha256:${pack.packKey}`,
  dependencyReferences: [],
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: EMPTY_RELATIONSHIP_CHECKSUM,
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
  knowledgeAssetId: activation.knowledgeAssetId,
  dependencyReferences: activation.dependencyReferences || [],
  relationshipContractVersion: activation.relationshipContractVersion,
  relationshipChecksum: activation.relationshipChecksum,
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
let originalMongooseClientDescriptor
let resolveOutcomeStudioKnowledgePackBinding
let resolveOutcomeStudioKnowledgePacks
let validateImportSourceDocumentDraft

const setMongooseReadyState = (readyState) => {
  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    get: () => readyState,
  })
}

const setMongooseTopologyType = (type) => {
  Object.defineProperty(mongoose.connection, 'client', {
    configurable: true,
    value: {
      topology: {
        description: { type },
      },
    },
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

const restoreMongooseClient = () => {
  if (originalMongooseClientDescriptor) {
    Object.defineProperty(mongoose.connection, 'client', originalMongooseClientDescriptor)
  } else {
    delete mongoose.connection.client
  }
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
  ;({
    resolveOutcomeStudioKnowledgePackBinding,
    resolveOutcomeStudioKnowledgePacks,
  } = await import('../services/outcomeKnowledgePackRegistryService.js'))
  ;({
    validateImportSourceDocumentDraft,
  } = await import('../validators/outcomeKnowledgePacks.validator.js'))
  originalMongooseReadyStateDescriptor = Object.getOwnPropertyDescriptor(
    mongoose.connection,
    'readyState',
  )
  originalMongooseClientDescriptor = Object.getOwnPropertyDescriptor(
    mongoose.connection,
    'client',
  )
  startSessionSpy = jest.spyOn(mongoose, 'startSession')
})

afterAll(() => {
  startSessionSpy?.mockRestore()
  restoreMongooseReadyState()
  restoreMongooseClient()
})

beforeEach(() => {
  restoreMongooseReadyState()
  restoreMongooseClient()
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
  KnowledgePackVersion.find = jest.fn().mockImplementation((filter = {}) => {
    if (
      Object.prototype.hasOwnProperty.call(filter, 'contentHash')
      || Object.prototype.hasOwnProperty.call(filter, 'sourceDocuments.sourceHash')
      || Array.isArray(filter.$or)
    ) {
      return buildFindChain([])
    }
    return buildFindChain([makeKnowledgePackVersion()])
  })
  KnowledgePackVersion.countDocuments = jest.fn().mockResolvedValue(1)
  KnowledgePackVersion.findOne = jest.fn().mockReturnValue(buildVersionFindOneChain(null))
  KnowledgePackVersion.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 })
  KnowledgePackVersion.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 })
  KnowledgePackVersion.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 1 })
  KnowledgePackVersion.prototype.save = jest.fn(async function save() {
    return this
  })
  KnowledgePackActivation.find = jest.fn().mockReturnValue(buildFindChain([]))
  KnowledgePackActivation.countDocuments = jest.fn().mockResolvedValue(0)
  KnowledgePackActivation.findOne = jest.fn().mockReturnValue(buildActivationFindOneChain(null))
  KnowledgePackActivation.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 })
  KnowledgePackActivation.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 })
  KnowledgePackActivation.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 0 })
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
  test('Knowledge Pack models accept SS-003 canonical types and legacy aliases', async () => {
    const acceptedTypes = [
      'VISUAL_SYSTEM',
      'ASSESSMENT_MODEL',
      'OUTPUT_PATTERN',
      'ET_RT',
      'OR',
      'DX',
      'VE',
      'CR',
    ]

    for (const packType of acceptedTypes) {
      const normalizedKey = packType.toLowerCase().replace(/_/g, '-')

      await expect(new KnowledgePack({
        packType,
        packKey: `model-${normalizedKey}`,
        knowledgeAssetId: `KP-${packType.replace(/_/g, '-')}`,
        label: `Model ${packType}`,
        purposeCategory: 'REFERENCE',
      }).validate()).resolves.toBeUndefined()

      await expect(new KnowledgePackVersion({
        packType,
        packKey: `version-${normalizedKey}`,
        knowledgeAssetId: `KPV-${packType.replace(/_/g, '-')}`,
        semanticVersion: '1.0.0',
        purposeCategory: 'REFERENCE',
        contentFormat: 'MARKDOWN',
      }).validate()).resolves.toBeUndefined()

      await expect(new KnowledgePackActivation({
        packType,
        packKey: `activation-${normalizedKey}`,
        knowledgeAssetId: `KPA-${packType.replace(/_/g, '-')}`,
        versionId: `kpv-${normalizedKey}-1-0-0-global`,
        semanticVersion: '1.0.0',
        purposeCategory: 'REFERENCE',
        status: 'DISABLED',
        scopeKey: 'GLOBAL',
      }).validate()).resolves.toBeUndefined()
    }
  })

  test('source import validator accepts SS-003 canonical types and mandatory legacy aliases', () => {
    const acceptedTypes = [
      'VISUAL_SYSTEM',
      'ASSESSMENT_MODEL',
      'OUTPUT_PATTERN',
      'ET_RT',
      'OR',
      'DX',
      'VE',
      'CR',
    ]

    acceptedTypes.forEach((packType) => {
      const req = {
        requestId: `req-${packType}`,
        body: {
          packType,
          packKey: `${packType.toLowerCase().replace(/_/g, '-')}-pack`,
          knowledgeAssetId: `SRC-${packType.replace(/_/g, '-')}`,
          label: `${packType} Pack`,
          purposeCategory: 'REFERENCE',
          semanticVersion: '1.0.0',
          contentFormat: 'MARKDOWN',
          sourceDocument: { filename: `${packType}.md` },
          extractedText: `${packType} source text.`,
        },
      }
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      }
      const next = jest.fn()

      validateImportSourceDocumentDraft(req, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
      expect(req.body.packType).toBe(packType)
      expect(req.body.purposeCategory).toBe('REFERENCE')
    })
  })

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs returns safe registry metadata and retired source bundle status', async () => {
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
      status: 'RETIRED',
      sourceDocuments: [],
    }))
    expect(JSON.stringify(res.body)).not.toContain('Pack content must not leak')
    expect(KnowledgePack.find).toHaveBeenCalledWith({})
  })

  test('GET knowledge-packs applies an exact controlled knowledge-layer filter', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs?knowledgeLayer=VALIDATION')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(KnowledgePack.find).toHaveBeenCalledWith({ knowledgeLayer: 'VALIDATION' })
  })

  test('GET duplicate-diagnostics classifies deterministic conflicts without exposing source content or hashes', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const firstPack = makeKnowledgePack({
      packId: 'kp-style-board-executive',
      packType: 'STYLE',
      packKey: 'board-executive',
      label: 'Board Executive Style',
      content: 'Pack content must never be returned.',
    })
    const secondPack = makeKnowledgePack({
      packId: 'kp-style-board-executive-copy',
      packType: 'STYLE',
      packKey: 'board-executive-copy',
      label: 'Board Executive Style',
      content: 'Second private pack body.',
    })
    const sharedContentHash = 'sha256:shared-content-hash'
    const sharedSourceHash = 'sha256:shared-source-hash'
    const firstVersion = makeKnowledgePackVersion({
      packId: firstPack.packId,
      versionId: 'kpv-style-board-executive-1-0-0-global',
      packType: firstPack.packType,
      packKey: firstPack.packKey,
      contentHash: sharedContentHash,
      sourceDocuments: [{ filename: 'board-style.md', sourceHash: sharedSourceHash }],
      content: 'Provider instructions must not leak.',
    })
    const secondVersion = makeKnowledgePackVersion({
      packId: secondPack.packId,
      versionId: 'kpv-style-board-executive-copy-1-0-0-global',
      packType: secondPack.packType,
      packKey: secondPack.packKey,
      contentHash: sharedContentHash,
      sourceDocuments: [{ filename: 'board-style-copy.md', sourceHash: sharedSourceHash }],
      content: 'More private instructions.',
    })
    const firstActivation = makeActivation({
      packCategory: 'OUTCOME',
      packType: 'STYLE',
      packKey: firstPack.packKey,
      label: firstPack.label,
    }, {
      packId: firstPack.packId,
      activationId: 'kpa-board-executive',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
    })
    const secondActivation = makeActivation({
      packCategory: 'OUTCOME',
      packType: 'STYLE',
      packKey: secondPack.packKey,
      label: secondPack.label,
    }, {
      packId: secondPack.packId,
      activationId: 'kpa-board-executive-copy',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
    })
    KnowledgePack.find.mockReturnValueOnce(buildFindChain([firstPack, secondPack]))
    KnowledgePackVersion.find.mockReturnValueOnce(buildFindChain([firstVersion, secondVersion]))
    KnowledgePackActivation.find.mockReturnValueOnce(buildFindChain([firstActivation, secondActivation]))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/duplicate-diagnostics')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      status: 'BLOCKED',
      summary: expect.objectContaining({
        blockingGroups: 1,
        reviewRequiredGroups: 4,
        affectedPacks: 2,
      }),
    }))
    expect(res.body.data.groups.map((group) => group.classification)).toEqual(expect.arrayContaining([
      'CONTENT_DUPLICATE',
      'SOURCE_DUPLICATE',
      'NORMALIZED_NAME_MATCH',
      'ACTIVE_CAPABILITY_CONFLICT',
    ]))
    expect(JSON.stringify(res.body)).not.toContain('Provider instructions')
    expect(JSON.stringify(res.body)).not.toContain('shared-content-hash')
    expect(JSON.stringify(res.body)).not.toContain('shared-source-hash')
  })

  test('DELETE /api/v1/super-admin/outcome-studio/knowledge-packs/:packId hard-deletes an eligible draft pack with audit in one transaction', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const deleteSession = buildSession()
    const draftPack = makeKnowledgePack({
      packId: 'kp-et-et-v2-8-global',
      packType: 'ET',
      packKey: 'et-v2-8',
      label: 'ET v2.8',
      status: 'DRAFT',
      latestVersionId: 'kpv-et-et-v2-8-2-8-0-global',
      latestSemanticVersion: '2.8.0',
      isSystem: false,
      sourceMetadata: {
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Enterprise Technology v2.8.pdf',
      },
    })
    setMongooseReadyState(1)
    startSessionSpy.mockResolvedValueOnce(deleteSession)
    KnowledgePack.findOne.mockReturnValue(buildFindOneChain(draftPack))
    KnowledgePackVersion.countDocuments.mockResolvedValue(1)
    KnowledgePackActivation.countDocuments.mockResolvedValue(0)
    KnowledgePackManifest.countDocuments.mockResolvedValue(0)
    KnowledgePackVersion.deleteMany.mockResolvedValueOnce({ deletedCount: 1 })
    KnowledgePackActivation.deleteMany.mockResolvedValueOnce({ deletedCount: 0 })
    KnowledgePack.deleteOne.mockResolvedValueOnce({ deletedCount: 1 })

    const res = await request
      .delete('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-et-et-v2-8-global')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(expect.objectContaining({
      deleted: true,
      packId: 'kp-et-et-v2-8-global',
      packType: 'ET',
      packKey: 'et-v2-8',
      deletedCounts: {
        packs: 1,
        versions: 1,
        activations: 0,
      },
    }))
    expect(deleteSession.withTransaction).toHaveBeenCalled()
    expect(deleteSession.endSession).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'KNOWLEDGE_PACK_DELETED',
        resourceType: 'KnowledgePack',
        diff: expect.objectContaining({
          packId: 'kp-et-et-v2-8-global',
          hardDelete: true,
          expectedVersionCount: 1,
          expectedActivationCount: 0,
        }),
      }),
      expect.objectContaining({ session: deleteSession }),
    )
    expect(KnowledgePackVersion.deleteMany).toHaveBeenCalledWith(
      { packId: 'kp-et-et-v2-8-global' },
      { session: deleteSession },
    )
    expect(KnowledgePackActivation.deleteMany).toHaveBeenCalledWith(
      { packId: 'kp-et-et-v2-8-global' },
      { session: deleteSession },
    )
    expect(KnowledgePack.deleteOne).toHaveBeenCalledWith(
      { packId: 'kp-et-et-v2-8-global' },
      { session: deleteSession },
    )
  })

  test('DELETE /api/v1/super-admin/outcome-studio/knowledge-packs/:packId blocks active packs before destructive writes', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePack({
      packId: 'kp-et-active',
      packType: 'ET',
      packKey: 'active-et',
      status: 'ACTIVE',
      isSystem: false,
    })))

    const res = await request
      .delete('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-et-active')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('PACK_DELETE_BLOCKED_ACTIVE')
    expect(KnowledgePackVersion.deleteMany).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.deleteMany).not.toHaveBeenCalled()
    expect(KnowledgePack.deleteOne).not.toHaveBeenCalled()
  })

  test('DELETE /api/v1/super-admin/outcome-studio/knowledge-packs/:packId blocks system packs before destructive writes', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePack({
      packId: 'kp-et-system',
      packType: 'ET',
      packKey: 'system-et',
      status: 'DRAFT',
      isSystem: true,
    })))

    const res = await request
      .delete('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-et-system')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('PACK_DELETE_BLOCKED_SYSTEM')
    expect(KnowledgePackVersion.deleteMany).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.deleteMany).not.toHaveBeenCalled()
    expect(KnowledgePack.deleteOne).not.toHaveBeenCalled()
  })

  test('DELETE /api/v1/super-admin/outcome-studio/knowledge-packs/:packId blocks manifest-bound packs', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePack({
      packId: 'kp-et-manifest-bound',
      packType: 'ET',
      packKey: 'manifest-bound-et',
      status: 'DRAFT',
      isSystem: false,
    })))
    KnowledgePackManifest.countDocuments.mockResolvedValue(1)
    KnowledgePackManifest.find.mockReturnValue(buildFindChain([
      makeKnowledgePackManifest({
        manifestId: 'kpm-et-runtime-1-0-0-global',
        mandatoryPacks: [
          {
            packCategory: 'OUTCOME',
            purposeCategory: 'FRAMEWORK',
            packType: 'ET',
            packKey: 'manifest-bound-et',
            label: 'Manifest Bound ET',
            executionMode: 'PROVIDER_CONTEXT',
            required: true,
            dependencyKeys: [],
            metadata: {},
          },
        ],
      }),
    ]))

    const res = await request
      .delete('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-et-manifest-bound')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('PACK_DELETE_BLOCKED_MANIFEST_BOUND')
    expect(res.body.error.details.manifestIds).toEqual(['kpm-et-runtime-1-0-0-global'])
    expect(KnowledgePackVersion.deleteMany).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.deleteMany).not.toHaveBeenCalled()
    expect(KnowledgePack.deleteOne).not.toHaveBeenCalled()
  })

  test('DELETE /api/v1/super-admin/outcome-studio/knowledge-packs/:packId fails closed when delete audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const deleteSession = buildSession()
    setMongooseReadyState(1)
    startSessionSpy.mockResolvedValueOnce(deleteSession)
    KnowledgePack.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePack({
      packId: 'kp-et-audit-failure',
      packType: 'ET',
      packKey: 'audit-failure-et',
      status: 'DRAFT',
      isSystem: false,
    })))
    KnowledgePackManifest.countDocuments.mockResolvedValue(0)
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'KNOWLEDGE_PACK_DELETED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .delete('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-et-audit-failure')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('AUDIT_PERSISTENCE_FAILED')
    expect(deleteSession.withTransaction).toHaveBeenCalled()
    expect(KnowledgePackVersion.deleteMany).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.deleteMany).not.toHaveBeenCalled()
    expect(KnowledgePack.deleteOne).not.toHaveBeenCalled()
  })

  test('DELETE /api/v1/super-admin/outcome-studio/knowledge-packs/:packId returns 404 for non-existent pack', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    setMongooseReadyState(1)
    KnowledgePack.findOne.mockReturnValue(buildFindOneChain(null))

    const res = await request
      .delete('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-nonexistent')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  test('DELETE /api/v1/super-admin/outcome-studio/knowledge-packs/:packId returns 503 when transactions are unavailable', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    setMongooseReadyState(0)
    KnowledgePack.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePack({
      packId: 'kp-et-notrans',
      packType: 'ET',
      packKey: 'notrans-et',
      status: 'DRAFT',
      isSystem: false,
    })))
    KnowledgePackManifest.countDocuments.mockResolvedValue(0)

    const res = await request
      .delete('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-et-notrans')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_DELETE_UNAVAILABLE')
  })

  test('DELETE /api/v1/super-admin/outcome-studio/knowledge-packs/:packId returns 409 when concurrent delete conflicts', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const deleteSession = buildSession()
    setMongooseReadyState(1)
    startSessionSpy.mockResolvedValueOnce(deleteSession)
    KnowledgePack.findOne.mockReturnValue(buildFindOneChain(makeKnowledgePack({
      packId: 'kp-et-conflict',
      packType: 'ET',
      packKey: 'conflict-et',
      status: 'DRAFT',
      isSystem: false,
    })))
    KnowledgePackManifest.countDocuments.mockResolvedValue(0)
    KnowledgePack.deleteOne.mockResolvedValue({ deletedCount: 0 })

    const res = await request
      .delete('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-et-conflict')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
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
        status: 'MISSING',
        runtimeBindable: false,
      }),
      expect.objectContaining({
        packType: 'RL',
        status: 'MISSING',
        runtimeBindable: false,
      }),
      expect.objectContaining({
        packType: 'OUTPUT_SCHEMA',
        status: 'MISSING',
        runtimeBindable: false,
      }),
      expect.objectContaining({
        packType: 'TRUTH_CERTIFICATION',
        status: 'MISSING',
        runtimeBindable: false,
      }),
      expect.objectContaining({
        packType: 'OUTPUT_TYPE_DEFINITION',
        status: 'MISSING',
        runtimeBindable: false,
      }),
    ]))
    expect(res.body.data.sourceBundle).toEqual(expect.objectContaining({
      status: 'RETIRED',
      sourceDocuments: [],
    }))
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

  test('registry resolution dynamically classifies eligible active packs without using a fixed pack filter', async () => {
    const activations = [
      ...makeAllRequiredActivations(),
      makeActivation({
        packCategory: 'OUTCOME',
        purposeCategory: 'STYLE',
        packType: 'STYLE',
        packKey: 'executive-board-style',
        label: 'Executive Board Style',
        executionMode: 'PROVIDER_CONTEXT',
      }),
      makeActivation({
        packCategory: 'PLATFORM',
        purposeCategory: 'VALIDATION',
        packType: 'COMPLIANCE',
        packKey: 'contradiction-review',
        label: 'Contradiction Review',
        executionMode: 'POST_VALIDATION',
      }),
      makeActivation({
        packCategory: 'PLATFORM',
        purposeCategory: 'SYSTEM',
        packType: 'SYSTEM',
        packKey: 'runtime-concepts',
        label: 'Runtime Concepts',
        executionMode: 'SYSTEM_ONLY',
      }),
      makeActivation({
        packCategory: 'OUTCOME',
        purposeCategory: 'STYLE',
        packType: 'STYLE',
        packKey: 'manual-reference-style',
        label: 'Manual Reference Style',
        executionMode: 'MANUAL_REFERENCE',
      }),
      makeActivation({
        packCategory: 'DISCOVERY',
        purposeCategory: 'DOMAIN',
        packType: 'DOMAIN',
        packKey: 'discovery-only-domain',
        label: 'Discovery Only Domain',
        executionMode: 'PROVIDER_CONTEXT',
      }),
      makeActivation({
        packCategory: 'OUTCOME',
        purposeCategory: 'BRAND',
        packType: 'BRAND',
        packKey: 'other-tenant-brand',
        label: 'Other Tenant Brand',
        executionMode: 'PROVIDER_CONTEXT',
        visibility: 'TENANT',
        tenantId: '507f1f77bcf86cd799439099',
      }),
    ]
    KnowledgePackActivation.find.mockReturnValue(buildFindChain(activations))

    const resolutionResult = await resolveOutcomeStudioKnowledgePackBinding({
      query: {
        frameworkKey: 'VMF',
        runtimeType: 'VALUE_NARRATIVE',
        tenantId: '507f1f77bcf86cd799439012',
      },
    })
    const { binding } = resolutionResult

    expect(resolutionResult.manifest).toEqual({
      sourceType: 'KNOWLEDGE_PACK_REGISTRY',
      policyKey: 'outcome-studio-v1-required-packs',
      policyVersion: '1.0.0',
      status: 'PROJECTED',
    })
    expect(resolutionResult.manifest).not.toHaveProperty('manifestId')
    expect(binding).toEqual(expect.objectContaining({
      status: 'PROJECTED',
      resolutionSource: 'KNOWLEDGE_PACK_REGISTRY',
      optionalPacks: [expect.objectContaining({
        packKey: 'executive-board-style',
        label: 'Executive Board Style',
        purposeCategory: 'STYLE',
        executionMode: 'PROVIDER_CONTEXT',
      })],
      validationPacks: [expect.objectContaining({
        packKey: 'contradiction-review',
        executionMode: 'POST_VALIDATION',
      })],
      blockedPacks: expect.arrayContaining([
        expect.objectContaining({
          packKey: 'runtime-concepts',
          blockedReason: 'SYSTEM_ONLY_PACK',
        }),
        expect.objectContaining({
          packKey: 'manual-reference-style',
          blockedReason: 'EXECUTION_MODE_NOT_RUNTIME_BINDABLE',
          runtimeBindable: false,
        }),
      ]),
      resolution: expect.objectContaining({
        activeCount: 5,
        resolvedCount: 7,
        requiredCount: 5,
        optionalCount: 1,
        validationCount: 1,
        blockedCount: 2,
      }),
    }))
    expect(binding.activePacks).toHaveLength(7)
    expect(binding.requiredPacks).toContainEqual(expect.objectContaining({
      packId: 'kp-arl-adaptive-reasoning-layer',
      knowledgeAssetId: makeKnowledgeAssetId('ARL', 'adaptive-reasoning-layer'),
      relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
      relationshipChecksum: EMPTY_RELATIONSHIP_CHECKSUM,
      dependencyReferences: [],
    }))
    expect(binding.activePacks.map((pack) => pack.packKey)).not.toEqual(expect.arrayContaining([
      'discovery-only-domain',
      'other-tenant-brand',
      'runtime-concepts',
      'manual-reference-style',
    ]))
    expect(KnowledgePackActivation.find).toHaveBeenCalledWith({
      status: 'ACTIVE',
      scopeKey: { $in: expect.arrayContaining(['GLOBAL', 'TENANT:507F1F77BCF86CD799439012']) },
    })
    expect(JSON.stringify(binding)).not.toContain('Activation content must not leak')
  })

  test('request-specific registry resolution excludes stale version hash evidence and blocks the required layer', async () => {
    const outputTypeRelationships = [
      runtimeDependency('OUTPUT_SCHEMA', 'executive-brief-schema'),
      runtimeDependency('STYLE', 'executive'),
    ]
    const outputType = makeActivation({
      packCategory: 'OUTCOME',
      purposeCategory: 'OUTPUT',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'executive-brief-output',
      label: 'Executive Brief',
    }, {
      knowledgeLayer: 'OUTPUT_TYPE',
      capabilityKey: 'executive-brief',
      workspaceCompatibility: ['OUTCOME'],
      dependencyReferences: outputTypeRelationships,
      relationshipChecksum: relationshipChecksum(outputTypeRelationships),
    })
    const outputSchema = makeActivation({
      packCategory: 'OUTCOME',
      purposeCategory: 'OUTPUT',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'executive-brief-schema',
      label: 'Executive Brief Schema',
    }, {
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'executive-brief-schema',
      workspaceCompatibility: ['OUTCOME'],
      dependencyReferences: [],
    })
    const style = makeActivation({
      packCategory: 'CONTEXT',
      purposeCategory: 'STYLE',
      packType: 'STYLE',
      packKey: 'executive-style',
      label: 'Executive Style',
    }, {
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive',
      workspaceCompatibility: ['OUTCOME'],
      dependencyReferences: [],
    })
    const activations = [
      ...makeAllRequiredActivations(),
      outputType,
      outputSchema,
      style,
    ]
    const versions = activations.map((activation) => makeVersionForActivation(activation, {
      status: 'ACTIVE',
      knowledgeLayer: activation.knowledgeLayer,
      capabilityKey: activation.capabilityKey,
      workspaceCompatibility: activation.workspaceCompatibility || [],
      dependencyReferences: activation.dependencyReferences || [],
    }))
    const staleStyleVersion = versions.find((version) => version.versionId === style.versionId)
    staleStyleVersion.contentHash = 'sha256:stale-style-content'
    KnowledgePackActivation.find.mockReturnValue(buildFindChain(activations))
    KnowledgePackVersion.find.mockReturnValue(buildFindChain(versions))

    const binding = await resolveOutcomeStudioKnowledgePacks({
      frameworkKey: 'VMF',
      runtimeType: 'VALUE_NARRATIVE',
      workspaceType: 'OUTCOME',
      requestedOutputTypeKey: 'executive-brief',
      resolvedAt: '2026-07-14T12:00:00.000Z',
    })

    expect(binding.status).toBe('BLOCKED')
    expect(binding.blockedPacks).toContainEqual(expect.objectContaining({
      activationId: style.activationId,
      blockedReason: 'VERSION_CONTENT_HASH_MISMATCH',
    }))
    expect(binding.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'MISSING_RELATIONSHIP',
      relationship: expect.objectContaining({ targetKnowledgeLayer: 'STYLE' }),
    }))
    expect(binding.providerContextPacks).not.toContainEqual(expect.objectContaining({
      activationId: style.activationId,
    }))
  })

  test('request-specific registry resolution rejects identity, contract and checksum snapshot drift', async () => {
    const outputTypeRelationships = [
      runtimeDependency('OUTPUT_SCHEMA', 'executive-brief-schema'),
      runtimeDependency('STYLE', 'executive'),
    ]
    const outputType = makeActivation({
      packCategory: 'OUTCOME',
      purposeCategory: 'OUTPUT',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'executive-brief-output',
    }, {
      knowledgeLayer: 'OUTPUT_TYPE',
      capabilityKey: 'executive-brief',
      workspaceCompatibility: ['OUTCOME'],
      dependencyReferences: outputTypeRelationships,
      relationshipChecksum: relationshipChecksum(outputTypeRelationships),
    })
    const outputSchema = makeActivation({
      packCategory: 'OUTCOME',
      purposeCategory: 'OUTPUT',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'executive-brief-schema',
    }, {
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'executive-brief-schema',
      workspaceCompatibility: ['OUTCOME'],
    })
    const style = makeActivation({
      packCategory: 'CONTEXT',
      purposeCategory: 'STYLE',
      packType: 'STYLE',
      packKey: 'executive-style',
    }, {
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive',
      workspaceCompatibility: ['OUTCOME'],
    })
    const activations = [...makeAllRequiredActivations(), outputType, outputSchema, style]
    const versions = makeVersionsForActivations(activations).map((version) => ({
      ...version,
      status: 'ACTIVE',
    }))
    versions.find((row) => row.versionId === outputType.versionId).relationshipChecksum = '0'.repeat(64)
    versions.find((row) => row.versionId === outputSchema.versionId).relationshipContractVersion = 'SS002-LEGACY'
    versions.find((row) => row.versionId === style.versionId).knowledgeAssetId = 'QA-DIFFERENT-STYLE'
    KnowledgePackActivation.find.mockReturnValue(buildFindChain(activations))
    KnowledgePackVersion.find.mockReturnValue(buildFindChain(versions))

    const binding = await resolveOutcomeStudioKnowledgePacks({
      frameworkKey: 'VMF',
      runtimeType: 'VALUE_NARRATIVE',
      workspaceType: 'OUTCOME',
      requestedOutputTypeKey: 'executive-brief',
      resolvedAt: '2026-07-14T12:00:00.000Z',
    })

    expect(binding.status).toBe('BLOCKED')
    expect(binding.relationshipFailures).toContainEqual(expect.objectContaining({
      code: 'MISSING_GOVERNANCE_METADATA',
      observedState: 'VERSION_RELATIONSHIP_CHECKSUM_MISMATCH',
    }))
    expect(binding.blockedPacks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        activationId: outputType.activationId,
        blockedReason: 'VERSION_RELATIONSHIP_CHECKSUM_MISMATCH',
      }),
      expect.objectContaining({
        activationId: outputSchema.activationId,
        blockedReason: 'VERSION_RELATIONSHIP_CONTRACT_MISMATCH',
      }),
      expect.objectContaining({
        activationId: style.activationId,
        blockedReason: 'VERSION_KNOWLEDGE_ASSET_ID_MISMATCH',
      }),
    ]))
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
          contentHash: buildTestContentHash(DEFAULT_SOURCE_DOCUMENT_TEXT),
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
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
      workspaceCompatibility: ['OUTCOME'],
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
    const packRecord = makeKnowledgePack({
      packId: 'kp-arl-adaptive-reasoning-layer',
      packCategory: 'OUTCOME',
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      label: 'Adaptive Reasoning Layer',
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'adaptive-reasoning-layer-v1.yaml',
        sourceDocumentId: 'kpsrc-arl-adaptive-reasoning-layer-1-0-0-source-hash',
        sourceHash: 'sha256:source-hash',
        contentPersisted: true,
      },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'APPROVED',
    })
    const versionDoc = makeKnowledgePackVersionDoc({
      versionId: 'kpv-arl-adaptive-reasoning-layer-1-0-0-global',
      packId: 'kp-arl-adaptive-reasoning-layer',
      packType: 'ARL',
      packKey: 'adaptive-reasoning-layer',
      content: ARL_YAML,
      contentHash: buildTestContentHash(ARL_YAML),
      contentFormat: 'YAML',
      sourceFilename: 'adaptive-reasoning-layer-v1.yaml',
    })
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(packRecord))
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .get(`/api/v1/super-admin/outcome-studio/knowledge-packs/adaptive-reasoning-layer/versions/${versionDoc.versionId}/content-preview`)
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

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/content-preview returns imported source-document draft content', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const extractedText = 'Enterprise Technology methodology principles capability governance and architecture guidance.'
    const draftPack = makeKnowledgePack({
      packId: 'kp-et-et',
      packCategory: 'FRAMEWORK',
      packType: 'ET',
      packKey: 'et',
      label: 'ET v2.8',
      status: 'DRAFT',
      purposeCategory: 'FRAMEWORK',
      knowledgeLayer: 'FRAMEWORK',
      capabilityKey: 'enterprise-technology',
      workspaceCompatibility: ['OUTCOME', 'ADVISOR'],
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'ET v2.8 - Canonical Execution Translation System.docx',
      },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
      latestVersionId: 'kpv-et-et-1-0-0-global',
      latestSemanticVersion: '1.0.0',
    })
    const versionDoc = makeKnowledgePackVersionDoc({
      versionId: 'kpv-et-et-1-0-0-global',
      packId: 'kp-et-et',
      packCategory: 'FRAMEWORK',
      packType: 'ET',
      packKey: 'et',
      semanticVersion: '1.0.0',
      status: 'DRAFT',
      purposeCategory: 'FRAMEWORK',
      content: extractedText,
      contentFormat: 'DOCX',
      sourceFilename: 'ET v2.8 - Canonical Execution Translation System.docx',
      sourceMetadata: {
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        parserStatus: 'TEXT_CAPTURED',
        extractionMode: 'DETERMINISTIC_DOCX',
        contentPersisted: true,
      },
      sourceDocuments: [
        {
          sourceDocumentId: 'kpsrc-et-et-1-0-0-1234567890abcdef',
          filename: 'ET v2.8 - Canonical Execution Translation System.docx',
          fileExtension: 'docx',
          sourceHash: 'sha256:docx-source-hash',
        },
      ],
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
    })
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(draftPack))
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .get('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-et-et/versions/kpv-et-et-1-0-0-global/content-preview')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(KnowledgePackVersion.findOne).toHaveBeenCalledWith({
      packId: 'kp-et-et',
      versionId: 'kpv-et-et-1-0-0-global',
    })
    expect(res.body.data).toEqual(expect.objectContaining({
      packId: 'kp-et-et',
      versionId: 'kpv-et-et-1-0-0-global',
      packType: 'ET',
      packKey: 'et',
      status: 'DRAFT',
      contentFormat: 'DOCX',
      sourceFilename: 'ET v2.8 - Canonical Execution Translation System.docx',
      contentVisible: true,
      previewMode: 'SOURCE_BACKED_SUPER_ADMIN_ONLY',
      content: extractedText,
      contentLength: extractedText.length,
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
    }))
    const auditPayload = AuditLog.createLog.mock.calls.find(
      ([payload]) => payload.action === 'KNOWLEDGE_PACK_CONTENT_PREVIEWED',
    )?.[0]
    expect(auditPayload).toEqual(expect.objectContaining({
      action: 'KNOWLEDGE_PACK_CONTENT_PREVIEWED',
      diff: expect.objectContaining({
        contentFormat: 'DOCX',
        sourceFilename: 'ET v2.8 - Canonical Execution Translation System.docx',
        contentVisible: true,
        contentIncludedInAudit: false,
        contentLength: extractedText.length,
      }),
    }))
    expect(JSON.stringify(auditPayload)).not.toContain(extractedText)
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

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/starter-import is retired in favor of source-document import', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/output-schemas-pack/starter-import')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(410)
    expect(res.body.error.code).toBe('GONE')
    expect(res.body.error.details.reason).toBe('PACK_STARTER_AUTHORING_RETIRED')
    expect(res.body.error.details.replacementWorkflow).toBe('IMPORT_SOURCE_DOCUMENT')
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions is retired in favor of source-document import', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        semanticVersion: '1.0.0',
        schemaVersion: '1.0.0',
        content: OUTPUT_SCHEMAS_YAML,
      })

    expect(res.status).toBe(410)
    expect(res.body.error.code).toBe('GONE')
    expect(res.body.error.details.reason).toBe('PACK_STARTER_AUTHORING_RETIRED')
    expect(res.body.error.details.replacementWorkflow).toBe('IMPORT_SOURCE_DOCUMENT')
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import creates a text source-document draft with server-derived source metadata', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      packId: 'kp-style-board-executive-style',
      packType: 'STYLE',
      packKey: 'board-executive-style',
      label: 'Board Executive Style',
      status: 'DRAFT',
      purposeCategory: 'STYLE',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
      workspaceCompatibility: ['OUTCOME'],
      sourceAuthority: 'StorylineOS Methodology',
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Board Executive Style.md',
        sourceDocumentId: 'kpsrc-style-board-executive-style-1-0-0-derived',
        sourceHash: 'sha256:derived',
      },
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
        knowledgeAssetId: 'STY-QA-001',
        label: 'Board Executive Style',
        purposeCategory: 'STYLE',
        knowledgeLayer: 'STYLE',
        capabilityKey: 'executive-board',
        workspaceCompatibility: ['OUTCOME'],
        dependencyReferences: [{
          relationshipType: 'REQUIRED_AT_RUNTIME',
          targetKnowledgeLayer: 'OUTPUT_SCHEMA',
          targetPackType: 'OUTPUT_SCHEMA',
          targetPackKey: 'board-summary',
          requiredAt: 'RUNTIME',
          cardinality: 'ONE',
        }],
        relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
        semanticVersion: '1.0.0',
        sourceAuthority: 'StorylineOS Methodology',
        contentFormat: 'MARKDOWN',
        sourceDocument: {
          filename: 'Board Executive Style.md',
          contentType: 'text/markdown',
        },
        extractedText: 'pack:\n  key: board-executive-style\n\nProvider instructions hidden from list responses.',
      })

    expect(res.status).toBe(201)
    expect(KnowledgePack.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        packId: 'kp-style-board-executive-style',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          sourceMetadata: expect.objectContaining({
            sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
            sourceFilename: 'Board Executive Style.md',
            contentPersisted: true,
          }),
        }),
      }),
      expect.any(Object),
    )
    expect(res.body.data.pack).toEqual(expect.objectContaining({
      packId: 'kp-style-board-executive-style',
      packType: 'STYLE',
      purposeCategory: 'STYLE',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
      workspaceCompatibility: ['OUTCOME'],
      sourceMetadata: expect.objectContaining({
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Board Executive Style.md',
      }),
      visibility: 'PLATFORM',
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
    }))
    expect(res.body.data.version).toEqual(expect.objectContaining({
      versionId: 'kpv-style-board-executive-style-1-0-0-global',
      packType: 'STYLE',
      packKey: 'board-executive-style',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
      workspaceCompatibility: ['OUTCOME'],
      dependencyReferences: [{
        relationshipType: 'REQUIRED_AT_RUNTIME',
        targetKnowledgeLayer: 'OUTPUT_SCHEMA',
        targetPackType: 'OUTPUT_SCHEMA',
        targetPackKey: 'board-summary',
        requiredAt: 'RUNTIME',
        cardinality: 'ONE',
      }],
      status: 'DRAFT',
      contentFormat: 'MARKDOWN',
      sourceFilename: 'Board Executive Style.md',
      sourceAuthority: 'StorylineOS Methodology',
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
    }))
    expect(res.body.data.version.sourceDocuments).toEqual([
      expect.objectContaining({
        sourceDocumentId: expect.stringMatching(/^kpsrc-style-board-executive-style-1-0-0-[a-f0-9]{16}$/),
        filename: 'Board Executive Style.md',
        fileExtension: 'md',
        sourceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    ])
    const savedVersion = KnowledgePackVersion.prototype.save.mock.contexts[0]
    expect(savedVersion.get('content')).toContain('key: board-executive-style')
    expect(savedVersion.get('content')).toContain('Provider instructions hidden from list responses.')
    expect(savedVersion.get('knowledgeLayer')).toBe('STYLE')
    expect(savedVersion.get('capabilityKey')).toBe('executive-board')
    expect(savedVersion.get('workspaceCompatibility')).toEqual(['OUTCOME'])
    expect(savedVersion.get('dependencyReferences')).toEqual([
      expect.objectContaining({
        relationshipType: 'REQUIRED_AT_RUNTIME',
        targetKnowledgeLayer: 'OUTPUT_SCHEMA',
        targetPackType: 'OUTPUT_SCHEMA',
        targetPackKey: 'board-summary',
        requiredAt: 'RUNTIME',
        cardinality: 'ONE',
      }),
    ])
    expect(savedVersion).toEqual(expect.objectContaining({
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      sourceMetadata: expect.objectContaining({
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Board Executive Style.md',
        parserStatus: 'TEXT_CAPTURED',
        extractionMode: 'DETERMINISTIC_TEXT',
        contentPersisted: true,
      }),
    }))
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
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Board Executive Style.md',
        sourceDocumentId: expect.stringMatching(/^kpsrc-style-board-executive-style-1-0-0-[a-f0-9]{16}$/),
        sourceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        contentIncludedInAudit: false,
        activationCreated: false,
      }),
    }))
  })

  test('POST source-document-import rejects ambiguous KP-004 dependency selectors before persistence', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-style-invalid-dependency',
        label: 'Board Style Invalid Dependency',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: {
          filename: 'Board Style.md',
          contentType: 'text/markdown',
        },
        extractedText: 'Board style source text.',
        dependencyReferences: [{
          knowledgeLayer: 'OUTPUT_SCHEMA',
          packType: 'OUTPUT_SCHEMA',
          packKey: 'board-summary',
          capabilityKey: 'board-summary',
        }],
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import creates a DOCX source-document draft with deterministic extraction', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const documentText = 'Enterprise Technology methodology principles capability governance and architecture guidance.'
    const docxBuffer = buildDocxBuffer(documentText)
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      packId: 'kp-system-enterprise-technology',
      packType: 'SYSTEM',
      packKey: 'enterprise-technology',
      label: 'Enterprise Technology',
      status: 'DRAFT',
      purposeCategory: 'FRAMEWORK',
      knowledgeLayer: 'FRAMEWORK',
      capabilityKey: 'enterprise-technology',
      workspaceCompatibility: ['OUTCOME', 'ADVISOR'],
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Enterprise Technology Framework v5.docx',
      },
      executionMode: 'PROVIDER_CONTEXT',
      visibility: 'PLATFORM',
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
      latestVersionId: 'kpv-system-enterprise-technology-5-0-0-global',
      latestSemanticVersion: '5.0.0',
    }))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'SYSTEM',
        packKey: 'enterprise-technology',
        knowledgeAssetId: 'SYS-QA-001',
        label: 'Enterprise Technology',
        purposeCategory: 'FRAMEWORK',
        knowledgeLayer: 'FRAMEWORK',
        capabilityKey: 'enterprise-technology',
        workspaceCompatibility: ['OUTCOME', 'ADVISOR'],
        semanticVersion: '5.0.0',
        contentFormat: 'DOCX',
        sourceDocument: {
          filename: 'Enterprise Technology Framework v5.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sizeBytes: docxBuffer.length,
          contentBase64: docxBuffer.toString('base64'),
        },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.version).toEqual(expect.objectContaining({
      packType: 'SYSTEM',
      packKey: 'enterprise-technology',
      status: 'DRAFT',
      contentFormat: 'DOCX',
      sourceFilename: 'Enterprise Technology Framework v5.docx',
      knowledgeLayer: 'FRAMEWORK',
      capabilityKey: 'enterprise-technology',
      workspaceCompatibility: ['OUTCOME', 'ADVISOR'],
    }))
    const savedVersion = KnowledgePackVersion.prototype.save.mock.contexts[0]
    expect(savedVersion.get('content')).toContain(documentText)
    expect(savedVersion.get('knowledgeLayer')).toBe('FRAMEWORK')
    expect(savedVersion.get('capabilityKey')).toBe('enterprise-technology')
    expect(savedVersion.get('workspaceCompatibility')).toEqual(['OUTCOME', 'ADVISOR'])
    expect(savedVersion).toEqual(expect.objectContaining({
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      sourceMetadata: expect.objectContaining({
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        parserStatus: 'TEXT_CAPTURED',
        extractionMode: 'DETERMINISTIC_DOCX',
        extractionMethod: 'DOCX_XML_TEXT',
        extractionAdapter: 'knowledge-pack-docx-text-extraction-v1',
        sourceSizeBytes: docxBuffer.length,
        contentPersisted: true,
      }),
    }))
    expect(JSON.stringify(res.body)).not.toContain(documentText)
    expect(JSON.stringify(savedVersion)).not.toContain(docxBuffer.toString('base64'))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({
        sourceFilename: 'Enterprise Technology Framework v5.docx',
        sourceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        contentIncludedInAudit: false,
        activationCreated: false,
      }),
    }))
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import extracts DOCX content without inflating unrelated zip entries', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const documentText = 'Enterprise Technology methodology principles capability model governance architecture guidance.'
    const docxBuffer = buildZipBuffer([
      {
        fileName: 'word/unused.xml',
        compressedData: Buffer.from('not-valid-deflate-data', 'utf8'),
        uncompressedSize: 128,
      },
      {
        fileName: 'word/document.xml',
        data: buildDocxXmlBuffer(documentText),
      },
    ])
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      packId: 'kp-system-enterprise-technology-lazy-docx',
      packType: 'SYSTEM',
      packKey: 'enterprise-technology-lazy-docx',
      label: 'Enterprise Technology Lazy DOCX',
      status: 'DRAFT',
      purposeCategory: 'FRAMEWORK',
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Enterprise Technology Framework v5.docx',
      },
      executionMode: 'PROVIDER_CONTEXT',
      visibility: 'PLATFORM',
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
      latestVersionId: 'kpv-system-enterprise-technology-lazy-docx-5-0-0-global',
      latestSemanticVersion: '5.0.0',
    }))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'SYSTEM',
        packKey: 'enterprise-technology-lazy-docx',
        knowledgeAssetId: 'SYS-QA-002',
        label: 'Enterprise Technology Lazy DOCX',
        purposeCategory: 'FRAMEWORK',
        semanticVersion: '5.0.0',
        contentFormat: 'DOCX',
        sourceDocument: {
          filename: 'Enterprise Technology Framework v5.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sizeBytes: docxBuffer.length,
          contentBase64: docxBuffer.toString('base64'),
        },
      })

    expect(res.status).toBe(201)
    const savedVersion = KnowledgePackVersion.prototype.save.mock.contexts[0]
    expect(savedVersion.get('content')).toContain(documentText)
    expect(savedVersion.sourceMetadata).toEqual(expect.objectContaining({
      extractionMode: 'DETERMINISTIC_DOCX',
      extractionMethod: 'DOCX_XML_TEXT',
      contentPersisted: true,
    }))
    expect(JSON.stringify(res.body)).not.toContain(documentText)
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import rejects DOCX content that inflates beyond the deterministic extraction limit', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const oversizedXml = Buffer.concat([
      Buffer.from('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>', 'utf8'),
      Buffer.alloc(3_100_000, 65),
      Buffer.from('</w:t></w:r></w:p></w:body></w:document>', 'utf8'),
    ])
    const docxBuffer = buildZipBuffer([
      {
        fileName: 'word/document.xml',
        data: oversizedXml,
      },
    ])

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'SYSTEM',
        packKey: 'enterprise-technology-bomb-docx',
        knowledgeAssetId: 'SYS-QA-003',
        label: 'Enterprise Technology Bomb DOCX',
        purposeCategory: 'FRAMEWORK',
        semanticVersion: '5.0.0',
        contentFormat: 'DOCX',
        sourceDocument: {
          filename: 'Enterprise Technology Framework v5.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sizeBytes: docxBuffer.length,
          contentBase64: docxBuffer.toString('base64'),
        },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('PACK_SOURCE_EXTRACTION_FAILED')
    expect(res.body.error.details.extractionError).toBe('SOURCE_DOCUMENT_EXTRACTION_FAILED')
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import creates a PDF source-document draft with deterministic extraction', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const documentText = 'Enterprise Technology framework assessment governance templates examples glossary principles.'
    const pdfBuffer = buildPdfBuffer(documentText)
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      packId: 'kp-system-enterprise-technology-pdf',
      packType: 'SYSTEM',
      packKey: 'enterprise-technology-pdf',
      label: 'Enterprise Technology PDF',
      status: 'DRAFT',
      purposeCategory: 'FRAMEWORK',
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Enterprise Technology Framework v5.pdf',
      },
      executionMode: 'PROVIDER_CONTEXT',
      visibility: 'PLATFORM',
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
      latestVersionId: 'kpv-system-enterprise-technology-pdf-5-0-0-global',
      latestSemanticVersion: '5.0.0',
    }))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'SYSTEM',
        packKey: 'enterprise-technology-pdf',
        knowledgeAssetId: 'SYS-QA-004',
        label: 'Enterprise Technology PDF',
        purposeCategory: 'FRAMEWORK',
        semanticVersion: '5.0.0',
        contentFormat: 'PDF',
        sourceDocument: {
          filename: 'Enterprise Technology Framework v5.pdf',
          contentType: 'application/pdf',
          sizeBytes: pdfBuffer.length,
          contentBase64: pdfBuffer.toString('base64'),
        },
      })

    expect(res.status).toBe(201)
    const savedVersion = KnowledgePackVersion.prototype.save.mock.contexts[0]
    expect(savedVersion.get('content')).toBe(documentText)
    expect(savedVersion).toEqual(expect.objectContaining({
      contentFormat: 'PDF',
      sourceMetadata: expect.objectContaining({
        parserStatus: 'TEXT_CAPTURED',
        extractionMode: 'DETERMINISTIC_PDF',
        extractionAdapter: 'knowledge-pack-pdf-text-extraction-v1',
        sourceSizeBytes: pdfBuffer.length,
      }),
    }))
    expect([
      'PDF_OPERATOR_TEXT',
      'PDF_TEXT_LAYER',
    ]).toContain(savedVersion.sourceMetadata.extractionMethod)
    expect(JSON.stringify(res.body)).not.toContain(documentText)
    expect(JSON.stringify(savedVersion)).not.toContain(pdfBuffer.toString('base64'))
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

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import rejects binary formats without source content', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'PDF',
        sourceDocument: {
          filename: 'Board Executive Style.pdf',
        },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('PACK_SOURCE_EXTRACTION_REQUIRED')
    expect(res.body.error.details.supportedFormats).toEqual(['YAML', 'JSON', 'MARKDOWN', 'DOCX', 'PDF'])
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import rejects unreadable binary source content', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'PDF',
        sourceDocument: {
          filename: 'Board Executive Style.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1').toString('base64'),
        },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('PACK_SOURCE_EXTRACTION_FAILED')
    expect(res.body.error.details.extractionError).toBe('SOURCE_DOCUMENT_NO_READABLE_TEXT')
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import rejects text imports without extracted source text', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: {
          filename: 'Board Executive Style.md',
        },
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.reason).toBe('PACK_SOURCE_TEXT_REQUIRED')
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import requires governed Knowledge Asset ID', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: {
          filename: 'Board Executive Style.md',
          contentType: 'text/markdown',
        },
        extractedText: 'Provider instructions without governed front matter.',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.message).toContain('Knowledge Asset ID is missing')
    expect(res.body.error.details).toEqual(expect.objectContaining({
      field: 'knowledgeAssetId',
      reason: 'MISSING_GOVERNANCE_METADATA',
    }))
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
        contentFormat: 'MARKDOWN',
        sourceDocument: {
          filename: 'Board Executive Style.md',
        },
        knowledgeAssetId: 'STY-QA-001',
        extractedText: 'Board executive style source text.',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('PACK_VERSION_ALREADY_EXISTS')
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST source-document-import requires duplicate review before persistence for repeated content', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const extractedText = 'Board executive style source text.'
    const duplicateVersion = makeKnowledgePackVersion({
      packId: 'kp-style-existing-board-style',
      versionId: 'kpv-style-existing-board-style-1-0-0-global',
      packType: 'STYLE',
      packKey: 'existing-board-style',
      semanticVersion: '1.0.0',
      scopeKey: 'GLOBAL',
      contentHash: buildTestContentHash(extractedText),
      content: 'This private content must not leak.',
    })
    const secondDuplicateVersion = makeKnowledgePackVersion({
      packId: 'kp-style-second-board-style',
      versionId: 'kpv-style-second-board-style-2-0-0-global',
      packType: 'STYLE',
      packKey: 'second-board-style',
      semanticVersion: '2.0.0',
      scopeKey: 'GLOBAL',
      contentHash: buildTestContentHash(extractedText),
      content: 'This second private content must not leak.',
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(null))
    KnowledgePackVersion.find
      .mockReturnValueOnce(buildFindChain([duplicateVersion, secondDuplicateVersion]))
      .mockReturnValueOnce(buildFindChain([]))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        knowledgeAssetId: 'STY-QA-001',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: { filename: 'Board Executive Style.md' },
        extractedText,
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'PACK_DUPLICATE_REVIEW_REQUIRED',
      duplicateStatus: 'REVIEW_REQUIRED',
      classifications: ['CONTENT_DUPLICATE'],
      allowedActions: ['VIEW_EXISTING', 'CONTINUE_WITH_REASON', 'CANCEL'],
    }))
    expect(res.body.error.details.candidates).toEqual([
      expect.objectContaining({
        classification: 'CONTENT_DUPLICATE',
        packId: 'kp-style-existing-board-style',
        versionId: 'kpv-style-existing-board-style-1-0-0-global',
      }),
      expect.objectContaining({
        classification: 'CONTENT_DUPLICATE',
        packId: 'kp-style-second-board-style',
        versionId: 'kpv-style-second-board-style-2-0-0-global',
      }),
    ])
    expect(JSON.stringify(res.body)).not.toContain('private content')
    expect(KnowledgePackVersion.find).toHaveBeenNthCalledWith(1, {
      contentHash: buildTestContentHash(extractedText),
      scopeKey: 'GLOBAL',
    })
    expect(KnowledgePackVersion.find).toHaveBeenNthCalledWith(2, {
      scopeKey: 'GLOBAL',
      $or: [
        { 'sourceDocuments.sourceHash': expect.stringMatching(/^sha256:/) },
        { 'sourceMetadata.sourceHash': expect.stringMatching(/^sha256:/) },
      ],
    })
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST source-document-import detects a legacy sourceMetadata hash in the same scope', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const extractedText = 'Legacy duplicate source hash text.'
    const legacyDuplicateVersion = makeKnowledgePackVersion({
      packId: 'kp-style-legacy-board-style',
      versionId: 'kpv-style-legacy-board-style-1-0-0-global',
      packType: 'STYLE',
      packKey: 'legacy-board-style',
      sourceDocuments: [],
      sourceMetadata: {
        sourceHash: buildTestContentHash(extractedText),
      },
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(null))
    KnowledgePackVersion.find
      .mockReturnValueOnce(buildFindChain([]))
      .mockReturnValueOnce(buildFindChain([legacyDuplicateVersion]))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        knowledgeAssetId: 'STY-QA-001',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: { filename: 'Board Executive Style.md' },
        extractedText,
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'PACK_DUPLICATE_REVIEW_REQUIRED',
      classifications: ['SOURCE_DUPLICATE'],
    }))
    expect(res.body.error.details.candidates).toContainEqual(expect.objectContaining({
      classification: 'SOURCE_DUPLICATE',
      packId: legacyDuplicateVersion.packId,
      versionId: legacyDuplicateVersion.versionId,
    }))
    expect(KnowledgePackVersion.find).toHaveBeenNthCalledWith(2, {
      scopeKey: 'GLOBAL',
      $or: [
        { 'sourceDocuments.sourceHash': buildTestContentHash(extractedText) },
        { 'sourceMetadata.sourceHash': buildTestContentHash(extractedText) },
      ],
    })
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST source-document-import records an explicit duplicate override reason in the upload audit', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const extractedText = 'Board executive style source text.'
    const duplicateVersion = makeKnowledgePackVersion({
      packId: 'kp-style-existing-board-style',
      versionId: 'kpv-style-existing-board-style-1-0-0-global',
      packType: 'STYLE',
      packKey: 'existing-board-style',
      semanticVersion: '1.0.0',
      scopeKey: 'GLOBAL',
      contentHash: buildTestContentHash(extractedText),
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(null))
    KnowledgePackVersion.find
      .mockReturnValueOnce(buildFindChain([duplicateVersion]))
      .mockReturnValueOnce(buildFindChain([]))
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(makeKnowledgePack({
      packId: 'kp-style-board-executive-style',
      packType: 'STYLE',
      packKey: 'board-executive-style',
      knowledgeAssetId: 'STY-QA-001',
      label: 'Board Executive Style',
      status: 'DRAFT',
    }))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        knowledgeAssetId: 'STY-QA-001',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: { filename: 'Board Executive Style.md' },
        extractedText,
        duplicateOverrideReason: 'Confirmed as a separately governed style variant.',
      })

    expect(res.status).toBe(201)
    expect(KnowledgePackVersion.prototype.save).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED',
      diff: expect.objectContaining({
        duplicateOverrideReason: 'Confirmed as a separately governed style variant.',
        duplicateClassifications: ['CONTENT_DUPLICATE'],
        duplicateCandidatePackIds: ['kp-style-existing-board-style'],
      }),
    }))
  })

  test('POST source-document-import fails closed and compensates when duplicate override audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const extractedText = 'Board executive style source text.'
    const previousPackRecord = makeKnowledgePack({
      packId: 'kp-style-board-executive-style',
      packType: 'STYLE',
      packKey: 'board-executive-style',
      label: 'Board Executive Style',
      status: 'VALIDATED',
      latestVersionId: 'kpv-style-board-executive-style-0-9-0-global',
      latestSemanticVersion: '0.9.0',
      updatedAt: '2026-07-14T10:00:00.000Z',
    })
    const failedImportPackRecord = makeKnowledgePack({
      ...previousPackRecord,
      status: 'DRAFT',
      latestVersionId: 'kpv-style-board-executive-style-1-0-0-global',
      latestSemanticVersion: '1.0.0',
      reviewStatus: 'DRAFT',
      updatedAt: '2026-07-14T10:05:00.000Z',
    })
    const duplicateVersion = makeKnowledgePackVersion({
      packId: 'kp-style-existing-board-style',
      versionId: 'kpv-style-existing-board-style-1-0-0-global',
      packType: 'STYLE',
      packKey: 'existing-board-style',
      semanticVersion: '1.0.0',
      scopeKey: 'GLOBAL',
      contentHash: buildTestContentHash(extractedText),
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(null))
    KnowledgePackVersion.find
      .mockReturnValueOnce(buildFindChain([duplicateVersion]))
      .mockReturnValueOnce(buildFindChain([]))
    KnowledgePack.findOne
      .mockReturnValueOnce(buildFindOneChain(previousPackRecord))
      .mockReturnValueOnce(buildFindOneChain(failedImportPackRecord))
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(failedImportPackRecord)
    AuditLog.createLog.mockRejectedValueOnce(new Error('audit unavailable'))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        knowledgeAssetId: 'STY-QA-001',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: { filename: 'Board Executive Style.md' },
        extractedText,
        duplicateOverrideReason: 'Confirmed as a separately governed style variant.',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('AUDIT_PERSISTENCE_FAILED')
    expect(KnowledgePack.updateOne).toHaveBeenCalledWith(
      {
        packId: 'kp-style-board-executive-style',
        _id: failedImportPackRecord._id,
        updatedAt: failedImportPackRecord.updatedAt,
      },
      expect.objectContaining({ $set: expect.any(Object) }),
      { runValidators: true },
    )
    expect(KnowledgePackVersion.deleteOne).toHaveBeenCalledWith({
      versionId: 'kpv-style-board-executive-style-1-0-0-global',
    })
  })

  test('POST source-document-import refuses to overwrite a concurrent pack change during compensation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const previousPackRecord = makeKnowledgePack({
      packId: 'kp-style-board-executive-style',
      packType: 'STYLE',
      packKey: 'board-executive-style',
      updatedAt: '2026-07-14T10:00:00.000Z',
    })
    const failedImportPackRecord = makeKnowledgePack({
      ...previousPackRecord,
      status: 'DRAFT',
      latestVersionId: 'kpv-style-board-executive-style-1-0-0-global',
      latestSemanticVersion: '1.0.0',
      reviewStatus: 'DRAFT',
      updatedAt: '2026-07-14T10:05:00.000Z',
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(null))
    KnowledgePack.findOne
      .mockReturnValueOnce(buildFindOneChain(null))
      .mockReturnValueOnce(buildFindOneChain(previousPackRecord))
      .mockReturnValueOnce(buildFindOneChain(null))
    KnowledgePack.findOneAndUpdate.mockResolvedValueOnce(failedImportPackRecord)
    AuditLog.createLog.mockRejectedValueOnce(new Error('audit unavailable'))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        knowledgeAssetId: 'STY-QA-001',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: { filename: 'Board Executive Style.md' },
        extractedText: 'Board executive style source text.',
      })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_ROLLBACK_FAILED')
    expect(res.body.error.details.reason).toBe('PACK_SOURCE_IMPORT_ROLLBACK_CONFLICT')
    expect(KnowledgePack.updateOne).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.deleteOne).not.toHaveBeenCalled()
  })

  test('POST source-document-import uses guarded compensation on standalone MongoDB topology', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    setMongooseReadyState(1)
    setMongooseTopologyType('Single')
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(null))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'standalone-style',
        knowledgeAssetId: 'STY-QA-002',
        label: 'Standalone Style',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: { filename: 'Standalone Style.md' },
        extractedText: 'Standalone source import content.',
      })

    expect(res.status).toBe(201)
    expect(startSessionSpy).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).toHaveBeenCalledWith()
    expect(KnowledgePack.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.not.objectContaining({ session: expect.anything() }),
    )
  })

  test('POST source-document-import preserves an explicit canonical purpose category instead of fallback inference', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(null))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'OUTPUT_SCHEMA',
        packKey: 'visual-system-schema',
        knowledgeAssetId: 'VS-001',
        label: 'Visual System Schema',
        purposeCategory: 'VISUAL',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: { filename: 'Visual System Schema.md' },
        extractedText: 'Visual system schema source text.',
      })

    expect(res.status).toBe(201)
    const [, packUpdate] = KnowledgePack.findOneAndUpdate.mock.calls.at(-1)
    expect(packUpdate).toEqual(expect.objectContaining({
      $set: expect.objectContaining({
        packType: 'OUTPUT_SCHEMA',
        purposeCategory: 'VISUAL',
      }),
    }))
    expect(KnowledgePackVersion.prototype.save.mock.contexts[0]).toEqual(expect.objectContaining({
      packType: 'OUTPUT_SCHEMA',
      purposeCategory: 'VISUAL',
    }))
  })

  test('POST source-document-import binds pack, version, and override audit writes to one Mongo transaction', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const transactionSession = buildSession()
    setMongooseReadyState(1)
    setMongooseTopologyType('ReplicaSetWithPrimary')
    startSessionSpy.mockResolvedValueOnce(transactionSession)
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(null))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        knowledgeAssetId: 'STY-QA-001',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: { filename: 'Board Executive Style.md' },
        extractedText: 'Board executive style source text.',
      })

    expect(res.status).toBe(201)
    expect(transactionSession.withTransaction).toHaveBeenCalledTimes(1)
    expect(KnowledgePack.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ session: transactionSession }),
    )
    expect(KnowledgePackVersion.prototype.save).toHaveBeenCalledWith({
      session: transactionSession,
    })
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED' }),
      expect.objectContaining({ session: transactionSession }),
    )
    expect(transactionSession.endSession).toHaveBeenCalled()
  })

  test('POST source-document-import translates a concurrent version insert race without mutating pack metadata', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const raceError = new Error('E11000 duplicate key collection: knowledgepackversions')
    raceError.code = 11000
    raceError.keyPattern = {
      packType: 1,
      packKey: 1,
      semanticVersion: 1,
      scopeKey: 1,
    }
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(null))
    KnowledgePackVersion.prototype.save.mockRejectedValueOnce(raceError)

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        knowledgeAssetId: 'STY-QA-001',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: { filename: 'Board Executive Style.md' },
        extractedText: 'Board executive style source text.',
      })

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'PACK_VERSION_ALREADY_EXISTS',
      conflictSource: 'UNIQUE_INDEX',
    }))
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.deleteOne).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST source-document-import rejects a duplicate override reason shorter than the audit contract', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/source-document-import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        packType: 'STYLE',
        packKey: 'board-executive-style',
        knowledgeAssetId: 'STY-QA-001',
        label: 'Board Executive Style',
        semanticVersion: '1.0.0',
        contentFormat: 'MARKDOWN',
        sourceDocument: { filename: 'Board Executive Style.md' },
        extractedText: 'Board executive style source text.',
        duplicateOverrideReason: 'Too short',
      })

    expect(res.status).toBe(422)
    expect(res.body.error.details.duplicateOverrideReason).toContain('at least 10 characters')
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(KnowledgePackVersion.prototype.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/validate marks valid source-document content as validated', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'DRAFT',
      content: OUTPUT_SCHEMAS_YAML,
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
      validationSummary: {},
      validatedAt: null,
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

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
    expect(KnowledgePack.updateOne).toHaveBeenCalledWith(
      { packId: 'kp-output-schema-output-schemas-pack' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'VALIDATED',
          latestVersionId: versionDoc.versionId,
          latestSemanticVersion: versionDoc.semanticVersion,
        }),
      }),
      expect.any(Object),
    )
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

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/validate marks imported source-document drafts as validated', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const extractedText = 'Enterprise Technology methodology principles, capability model, governance, and architecture guidance.'
    const draftPack = makeKnowledgePack({
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      label: 'Enterprise Technology',
      status: 'DRAFT',
      purposeCategory: 'FRAMEWORK',
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Enterprise Technology.md',
        sourceDocumentId: 'kpsrc-system-et-5-0-0-source-hash',
        sourceHash: 'sha256:source-hash',
        contentPersisted: true,
      },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
      latestVersionId: 'kpv-system-et-5-0-0-global',
      latestSemanticVersion: '5.0.0',
    })
    const versionDoc = makeKnowledgePackVersionDoc({
      versionId: 'kpv-system-et-5-0-0-global',
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      semanticVersion: '5.0.0',
      status: 'DRAFT',
      purposeCategory: 'FRAMEWORK',
      content: extractedText,
      contentHash: buildTestContentHash(extractedText),
      contentFormat: 'MARKDOWN',
      sourceFilename: 'Enterprise Technology.md',
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Enterprise Technology.md',
        sourceDocumentId: 'kpsrc-system-et-5-0-0-source-hash',
        sourceHash: 'sha256:source-hash',
        contentPersisted: true,
      },
      sourceDocuments: [
        {
          sourceDocumentId: 'kpsrc-system-et-5-0-0-source-hash',
          filename: 'Enterprise Technology.md',
          fileExtension: 'md',
          sourceHash: 'sha256:source-hash',
        },
      ],
      validationSummary: {},
      validatedAt: null,
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
    })
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(draftPack))
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-system-et/versions/kpv-system-et-5-0-0-global/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(versionDoc.status).toBe('VALIDATED')
    expect(versionDoc.validatedAt).toBeInstanceOf(Date)
    expect(res.body.data.validationSummary).toEqual(expect.objectContaining({
      status: 'PASSED',
      mode: 'SOURCE_ONLY_TEXT_VALIDATION',
    }))
    expect(KnowledgePack.updateOne).toHaveBeenCalledWith(
      { packId: 'kp-system-et' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'VALIDATED',
          latestVersionId: 'kpv-system-et-5-0-0-global',
          latestSemanticVersion: '5.0.0',
        }),
      }),
      expect.any(Object),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OUTCOME_KNOWLEDGE_PACK_VERSION_VALIDATED',
    }))
    expect(JSON.stringify(res.body)).not.toContain(extractedText)
  })

  test('POST validate fails closed and compensates when validation audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'DRAFT',
      content: OUTPUT_SCHEMAS_YAML,
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
      validationSummary: {},
      validatedAt: null,
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'OUTCOME_KNOWLEDGE_PACK_VERSION_VALIDATED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(versionDoc.status).toBe('DRAFT')
    expect(KnowledgePackVersion.updateOne).toHaveBeenCalledWith(
      { versionId: versionDoc.versionId },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'DRAFT' }) }),
    )
    expect(KnowledgePack.updateOne).toHaveBeenCalledWith(
      { packId: 'kp-output-schema-output-schemas-pack' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'VALIDATED' }) }),
      { runValidators: true },
    )
  })

  test('POST validate binds version, pack, and audit writes to one Mongo transaction', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'DRAFT',
      content: OUTPUT_SCHEMAS_YAML,
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
      validationSummary: {},
      validatedAt: null,
    })
    const transactionSession = buildSession()
    setMongooseReadyState(1)
    startSessionSpy.mockResolvedValueOnce(transactionSession)
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(transactionSession.withTransaction).toHaveBeenCalledTimes(1)
    expect(versionDoc.save).toHaveBeenCalledWith({ session: transactionSession })
    expect(KnowledgePack.updateOne).toHaveBeenCalledWith(
      { packId: 'kp-output-schema-output-schemas-pack' },
      expect.any(Object),
      expect.objectContaining({ session: transactionSession }),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'OUTCOME_KNOWLEDGE_PACK_VERSION_VALIDATED' }),
      expect.objectContaining({ session: transactionSession }),
    )
    expect(transactionSession.endSession).toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/review submits validated imported drafts for review', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const draftPack = makeKnowledgePack({
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      label: 'Enterprise Technology',
      status: 'VALIDATED',
      purposeCategory: 'FRAMEWORK',
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
      },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
      latestVersionId: 'kpv-system-et-5-0-0-global',
      latestSemanticVersion: '5.0.0',
    })
    const versionDoc = makeKnowledgePackVersionDoc({
      versionId: 'kpv-system-et-5-0-0-global',
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      semanticVersion: '5.0.0',
      status: 'VALIDATED',
      validationSummary: { status: 'PASSED' },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
    })
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(draftPack))
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-system-et/versions/kpv-system-et-5-0-0-global/review')
      .set('Authorization', `Bearer ${token}`)
      .send({ reviewStatus: 'READY_FOR_REVIEW' })

    expect(res.status).toBe(200)
    expect(versionDoc.reviewStatus).toBe('READY_FOR_REVIEW')
    expect(KnowledgePack.updateOne).toHaveBeenCalledWith(
      { packId: 'kp-system-et' },
      expect.objectContaining({
        $set: expect.objectContaining({
          reviewStatus: 'READY_FOR_REVIEW',
        }),
      }),
      expect.any(Object),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'KNOWLEDGE_PACK_REVIEW_STATUS_UPDATED',
      diff: expect.objectContaining({
        reviewAction: 'SUBMIT_FOR_REVIEW',
        reviewStatus: {
          from: 'DRAFT',
          to: 'READY_FOR_REVIEW',
        },
      }),
    }))
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/review fails closed when review audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const draftPack = makeKnowledgePack({
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      label: 'Enterprise Technology',
      status: 'VALIDATED',
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
      },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
      latestVersionId: 'kpv-system-et-5-0-0-global',
      latestSemanticVersion: '5.0.0',
    })
    const versionDoc = makeKnowledgePackVersionDoc({
      versionId: 'kpv-system-et-5-0-0-global',
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      semanticVersion: '5.0.0',
      status: 'VALIDATED',
      validationSummary: { status: 'PASSED' },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
    })
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(draftPack))
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'KNOWLEDGE_PACK_REVIEW_STATUS_UPDATED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-system-et/versions/kpv-system-et-5-0-0-global/review')
      .set('Authorization', `Bearer ${token}`)
      .send({ reviewStatus: 'READY_FOR_REVIEW' })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(res.body.error.details.reason).toBe('AUDIT_PERSISTENCE_FAILED')
    expect(versionDoc.reviewStatus).toBe('DRAFT')
    expect(KnowledgePackVersion.updateOne).toHaveBeenCalledWith(
      { versionId: 'kpv-system-et-5-0-0-global' },
      { $set: { reviewStatus: 'DRAFT' } },
    )
    expect(KnowledgePack.updateOne).toHaveBeenCalledWith(
      { packId: 'kp-system-et' },
      { $set: { reviewStatus: 'DRAFT' } },
    )
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/review uses transaction rollback when review audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const draftPack = makeKnowledgePack({
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      label: 'Enterprise Technology',
      status: 'VALIDATED',
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
      },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
      latestVersionId: 'kpv-system-et-5-0-0-global',
      latestSemanticVersion: '5.0.0',
    })
    const versionDoc = makeKnowledgePackVersionDoc({
      versionId: 'kpv-system-et-5-0-0-global',
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      semanticVersion: '5.0.0',
      status: 'VALIDATED',
      validationSummary: { status: 'PASSED' },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'DRAFT',
    })
    const rollbackSession = buildRollbackSession([versionDoc])
    setMongooseReadyState(1)
    startSessionSpy.mockResolvedValueOnce(rollbackSession)
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(draftPack))
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    AuditLog.createLog.mockImplementation(async (payload) => {
      if (payload.action === 'KNOWLEDGE_PACK_REVIEW_STATUS_UPDATED') {
        throw new Error('audit unavailable')
      }
      return {}
    })

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-system-et/versions/kpv-system-et-5-0-0-global/review')
      .set('Authorization', `Bearer ${token}`)
      .send({ reviewStatus: 'READY_FOR_REVIEW' })

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED')
    expect(startSessionSpy).toHaveBeenCalled()
    expect(rollbackSession.withTransaction).toHaveBeenCalled()
    expect(rollbackSession.endSession).toHaveBeenCalled()
    expect(versionDoc.save).toHaveBeenCalledWith({ session: rollbackSession })
    expect(KnowledgePack.updateOne).toHaveBeenCalledWith(
      { packId: 'kp-system-et' },
      expect.objectContaining({
        $set: expect.objectContaining({
          reviewStatus: 'READY_FOR_REVIEW',
        }),
      }),
      expect.objectContaining({ session: rollbackSession }),
    )
    expect(AuditLog.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'KNOWLEDGE_PACK_REVIEW_STATUS_UPDATED' }),
      expect.objectContaining({ session: rollbackSession }),
    )
    expect(KnowledgePackVersion.updateOne).not.toHaveBeenCalled()
    expect(versionDoc.reviewStatus).toBe('DRAFT')
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/activate rejects imported drafts before review approval', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const extractedText = 'Enterprise Technology methodology principles, capability model, governance, and architecture guidance.'
    const draftPack = makeKnowledgePack({
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      label: 'Enterprise Technology',
      status: 'VALIDATED',
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Enterprise Technology.md',
      },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'READY_FOR_REVIEW',
      latestVersionId: 'kpv-system-et-5-0-0-global',
      latestSemanticVersion: '5.0.0',
    })
    const versionDoc = makeKnowledgePackVersionDoc({
      versionId: 'kpv-system-et-5-0-0-global',
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      semanticVersion: '5.0.0',
      status: 'VALIDATED',
      content: extractedText,
      contentHash: buildTestContentHash(extractedText),
      contentFormat: 'MARKDOWN',
      sourceFilename: 'Enterprise Technology.md',
      sourceMetadata: {
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Enterprise Technology.md',
        sourceDocumentId: 'kpsrc-system-et-5-0-0-source-hash',
        sourceHash: 'sha256:source-hash',
        contentPersisted: true,
      },
      sourceDocuments: [
        {
          sourceDocumentId: 'kpsrc-system-et-5-0-0-source-hash',
          filename: 'Enterprise Technology.md',
          fileExtension: 'md',
          sourceHash: 'sha256:source-hash',
        },
      ],
      validationSummary: { status: 'PASSED' },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'READY_FOR_REVIEW',
    })
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(draftPack))
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-system-et/versions/kpv-system-et-5-0-0-global/activate')
      .set('Authorization', `Bearer ${token}`)
      .send({ scopeType: 'GLOBAL' })

    expect(res.status).toBe(409)
    expect(res.body.error.details.reason).toBe('PACK_VERSION_REVIEW_REQUIRED')
    expect(KnowledgePackActivation.updateMany).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.prototype.save).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/activate activates approved imported source-document drafts', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const extractedText = 'Enterprise Technology methodology principles, capability model, governance, and architecture guidance.'
    const draftPack = makeKnowledgePack({
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      label: 'Enterprise Technology',
      purposeCategory: 'FRAMEWORK',
      executionMode: 'PROVIDER_CONTEXT',
      visibility: 'CUSTOMER',
      customerId: '507f1f77bcf86cd799439011',
      status: 'VALIDATED',
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Enterprise Technology.md',
      },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'APPROVED',
      latestVersionId: 'kpv-system-et-5-0-0-global',
      latestSemanticVersion: '5.0.0',
    })
    const versionDoc = makeKnowledgePackVersionDoc({
      versionId: 'kpv-system-et-5-0-0-global',
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      purposeCategory: 'FRAMEWORK',
      executionMode: 'PROVIDER_CONTEXT',
      visibility: 'CUSTOMER',
      customerId: '507f1f77bcf86cd799439011',
      semanticVersion: '5.0.0',
      status: 'VALIDATED',
      content: extractedText,
      contentHash: buildTestContentHash(extractedText),
      contentFormat: 'MARKDOWN',
      sourceFilename: 'Enterprise Technology.md',
      sourceMetadata: {
        sourceStatus: 'SOURCE_DOCUMENT_PRESENT',
        sourceFilename: 'Enterprise Technology.md',
        sourceDocumentId: 'kpsrc-system-et-5-0-0-source-hash',
        sourceHash: 'sha256:source-hash',
        contentPersisted: true,
      },
      sourceDocuments: [
        {
          sourceDocumentId: 'kpsrc-system-et-5-0-0-source-hash',
          filename: 'Enterprise Technology.md',
          fileExtension: 'md',
          sourceHash: 'sha256:source-hash',
        },
      ],
      validationSummary: { status: 'PASSED' },
      authoringMode: 'IMPORT_SOURCE_DOCUMENT',
      reviewStatus: 'APPROVED',
    })
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(draftPack))
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .post('/api/v1/super-admin/outcome-studio/knowledge-packs/kp-system-et/versions/kpv-system-et-5-0-0-global/activate')
      .set('Authorization', `Bearer ${token}`)
      .send({ scopeType: 'GLOBAL' })

    expect(res.status).toBe(200)
    expect(versionDoc.status).toBe('ACTIVE')
    expect(res.body.data.activation).toEqual(expect.objectContaining({
      packId: 'kp-system-et',
      packCategory: 'FRAMEWORK',
      packType: 'SYSTEM',
      packKey: 'et',
      status: 'ACTIVE',
      purposeCategory: 'FRAMEWORK',
      executionMode: 'PROVIDER_CONTEXT',
      visibility: 'CUSTOMER',
      customerId: '507f1f77bcf86cd799439011',
    }))
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OUTCOME_KNOWLEDGE_PACK_ACTIVATED',
    }))
    expect(JSON.stringify(res.body)).not.toContain(extractedText)
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

  test.each([
    ['knowledgeLayer', { knowledgeLayer: undefined }],
    ['capabilityKey', { capabilityKey: undefined }],
    ['workspaceCompatibility', { workspaceCompatibility: [] }],
  ])('POST activate fails closed before reads or writes when version-owned %s is absent', async (
    missingField,
    governanceOverride,
  ) => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(makeKnowledgePack({
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'output-schemas-pack',
      workspaceCompatibility: ['OUTCOME'],
    })))
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      content: OUTPUT_SCHEMAS_YAML,
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
      ...governanceOverride,
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scopeType: 'GLOBAL' })

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'PACK_ACTIVATION_GOVERNANCE_METADATA_REQUIRED',
      packId: versionDoc.packId,
      versionId: versionDoc.versionId,
      missingFields: [missingField],
    }))
    expect(KnowledgePackActivation.findOne).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.updateMany).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.prototype.save).not.toHaveBeenCalled()
    expect(versionDoc.save).not.toHaveBeenCalled()
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test.each([
    ['knowledgeLayer', { knowledgeLayer: 'STYLE' }],
    ['capabilityKey', { capabilityKey: 'different-output-schemas-pack' }],
    ['workspaceCompatibility', { workspaceCompatibility: ['ADVISOR'] }],
  ])('POST activate fails closed before reads or writes when pack %s mismatches the version', async (
    mismatchField,
    packGovernanceOverride,
  ) => {
    const token = await getAccessTokenForUser(makeFakeUser())
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(makeKnowledgePack({
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'output-schemas-pack',
      workspaceCompatibility: ['OUTCOME'],
      ...packGovernanceOverride,
    })))
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      content: OUTPUT_SCHEMAS_YAML,
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scopeType: 'GLOBAL' })

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'PACK_ACTIVATION_GOVERNANCE_METADATA_MISMATCH',
      packId: versionDoc.packId,
      versionId: versionDoc.versionId,
      mismatchFields: [mismatchField],
    }))
    expect(KnowledgePackActivation.findOne).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.updateMany).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.prototype.save).not.toHaveBeenCalled()
    expect(versionDoc.save).not.toHaveBeenCalled()
    expect(KnowledgePack.findOneAndUpdate).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/activate creates active activation after validation', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      content: OUTPUT_SCHEMAS_YAML,
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
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

  test('POST activate blocks a different active pack for the same knowledge capability and scope', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
      content: OUTPUT_SCHEMAS_YAML,
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
    })
    const conflict = makeActivation({
      packCategory: 'OUTCOME',
      packType: 'STYLE',
      packKey: 'existing-board-style',
      label: 'Existing Board Style',
    }, {
      packId: 'kp-style-existing-board-style',
      activationId: 'kpa-style-existing-board-style',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
      scopeKey: 'GLOBAL',
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    KnowledgePackActivation.findOne.mockReturnValueOnce(buildActivationFindOneChain(conflict))

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scopeType: 'GLOBAL' })

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'PACK_ACTIVE_CAPABILITY_CONFLICT',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
      scopeKey: 'GLOBAL',
      conflictingActivation: expect.objectContaining({
        packId: 'kp-style-existing-board-style',
        activationId: 'kpa-style-existing-board-style',
      }),
    }))
    expect(KnowledgePackActivation.updateMany).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.prototype.save).not.toHaveBeenCalled()
    expect(versionDoc.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
  })

  test('POST activate allows same-pack version replacement for a classified capability', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'executive-summary',
      semanticVersion: '1.1.0',
      versionId: 'kpv-output-schema-output-schemas-pack-1-1-0-global',
      content: OUTPUT_SCHEMAS_YAML,
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
    })
    const previousActivation = makeActivation(REQUIRED_PACKS[2], {
      packId: versionDoc.packId,
      activationId: 'kpa-output-schema-1-0-0',
      versionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
      knowledgeLayer: 'OUTPUT_SCHEMA',
      capabilityKey: 'executive-summary',
      semanticVersion: '1.0.0',
      scopeKey: 'GLOBAL',
    })
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    KnowledgePackActivation.findOne
      .mockReturnValueOnce(buildActivationFindOneChain(null))
      .mockReturnValueOnce(buildActivationFindOneChain(previousActivation))

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scopeType: 'GLOBAL' })

    expect(res.status).toBe(200)
    expect(res.body.data.previousActivation).toEqual(expect.objectContaining({
      activationId: 'kpa-output-schema-1-0-0',
      packId: versionDoc.packId,
    }))
    expect(KnowledgePackActivation.updateMany).toHaveBeenCalled()
    expect(AuditLog.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OUTCOME_KNOWLEDGE_PACK_ACTIVATED',
    }))
  })

  test('POST activate translates the active capability unique-index race to the stable conflict response', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const previousUpdatedBy = '607f1f77bcf86cd799439777'
    const packRecord = makeKnowledgePack({
      status: 'ACTIVE',
      latestVersionId: 'kpv-output-schema-output-schemas-pack-0-9-0-global',
      latestSemanticVersion: '0.9.0',
      updatedBy: previousUpdatedBy,
    })
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
      content: OUTPUT_SCHEMAS_YAML,
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
    })
    const raceError = new Error('E11000 duplicate key index: uniq_active_knowledge_capability_scope')
    raceError.code = 11000
    raceError.keyPattern = { knowledgeLayer: 1, capabilityKey: 1 }
    const previousActivation = makeActivation(REQUIRED_PACKS[2], {
      packId: versionDoc.packId,
      activationId: 'kpa-output-schema-previous-active',
      versionId: 'kpv-output-schema-output-schemas-pack-0-9-0-global',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
      semanticVersion: '0.9.0',
      scopeKey: 'GLOBAL',
    })
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(packRecord))
    KnowledgePackVersion.findOne.mockReturnValueOnce(buildVersionFindOneChain(versionDoc))
    KnowledgePackActivation.findOne
      .mockReturnValueOnce(buildActivationFindOneChain(null))
      .mockReturnValueOnce(buildActivationFindOneChain(previousActivation))
    KnowledgePackActivation.prototype.save.mockRejectedValueOnce(raceError)

    const res = await request
      .post(`/api/v1/super-admin/outcome-studio/knowledge-packs/kp-output-schema-output-schemas-pack/versions/${versionDoc.versionId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scopeType: 'GLOBAL' })

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual(expect.objectContaining({
      reason: 'PACK_ACTIVE_CAPABILITY_CONFLICT',
      knowledgeLayer: 'STYLE',
      capabilityKey: 'executive-board',
      scopeKey: 'GLOBAL',
      conflictSource: 'UNIQUE_INDEX',
    }))
    expect(versionDoc.status).toBe('VALIDATED')
    expect(versionDoc.save).not.toHaveBeenCalled()
    expect(AuditLog.createLog).not.toHaveBeenCalled()
    expect(KnowledgePackActivation.updateOne).toHaveBeenCalledWith(
      { activationId: 'kpa-output-schema-previous-active' },
      {
        $set: {
          status: 'ACTIVE',
          rolledBackAt: null,
          rollbackReason: '',
        },
      },
    )
    expect(KnowledgePack.updateOne).toHaveBeenCalledWith(
      { packId: versionDoc.packId },
      {
        $set: {
          status: 'ACTIVE',
          latestVersionId: 'kpv-output-schema-output-schemas-pack-0-9-0-global',
          latestSemanticVersion: '0.9.0',
          updatedBy: previousUpdatedBy,
        },
      },
    )
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/activate fails closed when activation audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const previousUpdatedBy = '607f1f77bcf86cd799439888'
    const packRecord = makeKnowledgePack({
      status: 'ACTIVE',
      latestVersionId: 'kpv-output-schema-output-schemas-pack-0-9-0-global',
      latestSemanticVersion: '0.9.0',
      updatedBy: previousUpdatedBy,
    })
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      content: OUTPUT_SCHEMAS_YAML,
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
    })
    KnowledgePack.findOne.mockReturnValueOnce(buildFindOneChain(packRecord))
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
    expect(KnowledgePack.updateOne).toHaveBeenCalledWith(
      { packId: versionDoc.packId },
      {
        $set: {
          status: 'ACTIVE',
          latestVersionId: 'kpv-output-schema-output-schemas-pack-0-9-0-global',
          latestSemanticVersion: '0.9.0',
          updatedBy: previousUpdatedBy,
        },
      },
    )
  })

  test('POST /api/v1/super-admin/outcome-studio/knowledge-packs/:packId/versions/:versionId/activate uses transaction rollback when activation audit cannot persist', async () => {
    const token = await getAccessTokenForUser(makeFakeUser())
    const versionDoc = makeKnowledgePackVersionDoc({
      status: 'VALIDATED',
      content: OUTPUT_SCHEMAS_YAML,
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
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
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
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
      .mockReturnValueOnce(buildActivationFindOneChain(null))
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
      contentHash: buildTestContentHash(OUTPUT_SCHEMAS_YAML),
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
      .mockReturnValueOnce(buildActivationFindOneChain(null))
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

  test('GET /api/v1/super-admin/outcome-studio/knowledge-packs/resolution-preview remains blocked when required bindings are incomplete', async () => {
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
