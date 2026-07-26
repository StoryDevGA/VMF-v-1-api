import crypto from 'node:crypto'
import mongoose from 'mongoose'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackManifest,
  KnowledgePackVersion,
} from '../models/index.js'
import { buildKnowledgePackId } from '../models/KnowledgePack.js'
import { buildKnowledgePackVersionId } from '../models/KnowledgePackVersion.js'
import {
  buildKnowledgePackActivationId,
  buildKnowledgePackActivationScopeKey,
} from '../models/KnowledgePackActivation.js'
import {
  OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS,
  OUTCOME_KNOWLEDGE_PACK_RESOLUTION_MODE,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES,
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_TYPES,
} from '../constants/outcomeKnowledgePacks.js'
import {
  OUTCOME_STUDIO_BINDING_STATUSES,
  OUTCOME_STUDIO_REQUIRED_PACKS,
} from '../constants/runtimeOutcomeStudio.js'
import {
  KNOWLEDGE_PACK_AUTHORING_MODES,
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES,
  KNOWLEDGE_PACK_REVIEW_STATUSES,
  KNOWLEDGE_PACK_VISIBILITY_SCOPES,
} from '../constants/knowledgeRuntime.js'
import {
  KNOWLEDGE_PACK_CATEGORIES,
  resolveKnowledgePackCategory,
} from '../constants/workspaceGovernance.js'
import { escapeRegex } from '../utils/controllerUtils.js'
import auditService from './auditService.js'
import {
  extractKnowledgePackSourceDocumentText,
  SOURCE_DOCUMENT_EXTRACTION_ERRORS,
} from './knowledgePackSourceDocumentExtractionService.js'
import {
  findActiveCapabilityConflict,
  findSourceImportDuplicateWarnings,
  isActiveCapabilityConflictRace,
  isKnowledgePackVersionDuplicateRace,
  scanOutcomeKnowledgePackDuplicates,
} from './knowledgePackDuplicateGovernanceService.js'
import {
  discoverRequestSpecificOutputTypes,
  resolveRequestSpecificKnowledgePacks,
} from './knowledgePackRequestResolutionService.js'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()
const MONGO_TRANSACTION_TOPOLOGY_TYPES = new Set([
  'ReplicaSetWithPrimary',
  'Sharded',
])
const canUseSourceImportTransaction = () => (
  mongoose.connection.readyState === 1
  && MONGO_TRANSACTION_TOPOLOGY_TYPES.has(
    normalizeText(mongoose.connection.client?.topology?.description?.type),
  )
)
const normalizePackCategory = (value, packType) =>
  resolveKnowledgePackCategory({ packCategory: value, packType })
const normalizeTokenList = (values) => Array.isArray(values)
  ? [...new Set(values.map(normalizeToken).filter(Boolean))]
  : []
const normalizeDependencyReferences = (references) => Array.isArray(references)
  ? references.map((reference) => ({
    knowledgeLayer: normalizeToken(reference?.knowledgeLayer),
    requirement: normalizeToken(reference?.requirement || 'REQUIRED'),
    ...(normalizeToken(reference?.packType) ? { packType: normalizeToken(reference.packType) } : {}),
    ...(normalizeLowerKey(reference?.packKey) ? { packKey: normalizeLowerKey(reference.packKey) } : {}),
    ...(normalizeLowerKey(reference?.capabilityKey)
      ? { capabilityKey: normalizeLowerKey(reference.capabilityKey) }
      : {}),
  }))
  : []

export const OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS = Object.freeze({
  AUDIT_PERSISTENCE_FAILED: 'AUDIT_PERSISTENCE_FAILED',
  PACK_SOURCE_NOT_AVAILABLE: 'PACK_SOURCE_NOT_AVAILABLE',
  PACK_SOURCE_FORMAT_UNSUPPORTED: 'PACK_SOURCE_FORMAT_UNSUPPORTED',
  PACK_SOURCE_EXTRACTION_REQUIRED: 'PACK_SOURCE_EXTRACTION_REQUIRED',
  PACK_SOURCE_EXTRACTION_FAILED: 'PACK_SOURCE_EXTRACTION_FAILED',
  PACK_SOURCE_TEXT_REQUIRED: 'PACK_SOURCE_TEXT_REQUIRED',
  PACK_SOURCE_IMPORT_ROLLBACK_CONFLICT: 'PACK_SOURCE_IMPORT_ROLLBACK_CONFLICT',
  PACK_NOT_FOUND: 'PACK_NOT_FOUND',
  PACK_ACTIVE_ACTIVATION_NOT_FOUND: 'PACK_ACTIVE_ACTIVATION_NOT_FOUND',
  PACK_ACTIVE_CAPABILITY_CONFLICT: 'PACK_ACTIVE_CAPABILITY_CONFLICT',
  PACK_ACTIVATION_GOVERNANCE_METADATA_REQUIRED: 'PACK_ACTIVATION_GOVERNANCE_METADATA_REQUIRED',
  PACK_ACTIVATION_GOVERNANCE_METADATA_MISMATCH: 'PACK_ACTIVATION_GOVERNANCE_METADATA_MISMATCH',
  PACK_DUPLICATE_REVIEW_REQUIRED: 'PACK_DUPLICATE_REVIEW_REQUIRED',
  PACK_VERSION_ALREADY_EXISTS: 'PACK_VERSION_ALREADY_EXISTS',
  PACK_VERSION_NOT_FOUND: 'PACK_VERSION_NOT_FOUND',
  PACK_VERSION_LIFECYCLE_CONFLICT: 'PACK_VERSION_LIFECYCLE_CONFLICT',
  PACK_VERSION_CONTENT_NOT_AVAILABLE: 'PACK_VERSION_CONTENT_NOT_AVAILABLE',
  PACK_VERSION_REQUIRES_VALIDATED: 'PACK_VERSION_REQUIRES_VALIDATED',
  PACK_VERSION_REVIEW_REQUIRED: 'PACK_VERSION_REVIEW_REQUIRED',
  PACK_VERSION_VALIDATION_FAILED: 'PACK_VERSION_VALIDATION_FAILED',
  PACK_DELETE_BLOCKED_ACTIVE: 'PACK_DELETE_BLOCKED_ACTIVE',
  PACK_DELETE_BLOCKED_SYSTEM: 'PACK_DELETE_BLOCKED_SYSTEM',
  PACK_DELETE_BLOCKED_MANIFEST_BOUND: 'PACK_DELETE_BLOCKED_MANIFEST_BOUND',
  PACK_DELETE_TRANSACTION_REQUIRED: 'PACK_DELETE_TRANSACTION_REQUIRED',
  PACK_DELETE_CONFLICT: 'PACK_DELETE_CONFLICT',
  PACK_STARTER_AUTHORING_RETIRED: 'PACK_STARTER_AUTHORING_RETIRED',
  UNSUPPORTED_SCOPE_TYPE: 'UNSUPPORTED_SCOPE_TYPE',
})

const RETIRED_SOURCE_BUNDLE_STATUS = 'RETIRED'
const MISSING_REQUIRED_PACK_STATUS = 'MISSING'
const SOURCE_DOCUMENT_PRESENT_STATUS = 'SOURCE_DOCUMENT_PRESENT'
const SOURCE_VALIDATION_MODE = 'SOURCE_ONLY_TEXT_VALIDATION'
const SEMANTIC_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const AUDIT_FALLBACK_OBJECT_ID = '000000000000000000000000'
const ROLLBACK_ELIGIBLE_VERSION_STATUSES = new Set([
  OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED,
  OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE,
])
const OUTCOME_STUDIO_RESOLUTION_PACK_CATEGORIES = new Set([
  KNOWLEDGE_PACK_CATEGORIES.OUTCOME,
  KNOWLEDGE_PACK_CATEGORIES.FRAMEWORK,
  KNOWLEDGE_PACK_CATEGORIES.PLATFORM,
])
const OUTCOME_STUDIO_REGISTRY_POLICY = Object.freeze({
  sourceType: 'KNOWLEDGE_PACK_REGISTRY',
  policyKey: 'outcome-studio-v1-required-packs',
  policyVersion: '1.0.0',
})
const REQUEST_RESOLUTION_VERSION_STATUSES = new Set([
  OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE,
])

const createKnowledgePackError = ({
  status,
  code,
  message,
  reason,
  details = {},
}) => {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.details = {
    reason,
    ...details,
  }
  return err
}

const throwStarterAuthoringRetiredError = ({ packId } = {}) => {
  throw createKnowledgePackError({
    status: 410,
    code: 'GONE',
    message: 'Starter Knowledge Pack authoring has been retired. Use Import Source Document to create governed Knowledge Pack drafts and new versions.',
    reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_STARTER_AUTHORING_RETIRED,
    details: {
      packId: normalizeText(packId),
      replacementWorkflow: 'IMPORT_SOURCE_DOCUMENT',
    },
  })
}

const getObjectIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const cloneValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const buildContentHash = (content) =>
  `sha256:${crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex')}`

const SOURCE_DOCUMENT_FORMATS_BY_EXTENSION = Object.freeze({
  md: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.MARKDOWN,
  markdown: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.MARKDOWN,
  json: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.JSON,
  yaml: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML,
  yml: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML,
  docx: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.DOCX,
  pdf: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.PDF,
})

const CLIENT_TEXT_SOURCE_DOCUMENT_FORMATS = new Set([
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.JSON,
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.MARKDOWN,
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML,
])

const getFileExtension = (sourceDocument = {}) => {
  const explicitExtension = normalizeLowerKey(sourceDocument.fileExtension).replace(/^\./, '')
  if (explicitExtension) return explicitExtension

  const filename = normalizeText(sourceDocument.filename)
  const lastSegment = filename.includes('.') ? filename.split('.').pop() : ''
  return normalizeLowerKey(lastSegment).replace(/^\./, '')
}

const resolveSourceDocumentContentFormat = ({ contentFormat, sourceDocument }) => {
  const requestedFormat = normalizeToken(contentFormat)
  if (requestedFormat) return requestedFormat

  return SOURCE_DOCUMENT_FORMATS_BY_EXTENSION[getFileExtension(sourceDocument)] || ''
}

const assertSupportedSourceDocumentFormat = ({ contentFormat, sourceDocument }) => {
  const resolvedFormat = resolveSourceDocumentContentFormat({ contentFormat, sourceDocument })
  if (!Object.values(OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS).includes(resolvedFormat)) {
    throw createKnowledgePackError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Source document format is not supported for Knowledge Pack draft import.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_FORMAT_UNSUPPORTED,
      details: {
        filename: normalizeText(sourceDocument?.filename),
        fileExtension: getFileExtension(sourceDocument),
        supportedFormats: Object.values(OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS),
      },
    })
  }

  return resolvedFormat
}

const resolveSourceImportPurposeCategory = ({ packType, purposeCategory }) => {
  const normalizedPurposeCategory = normalizeToken(purposeCategory)
  if (Object.values(KNOWLEDGE_PACK_PURPOSE_CATEGORIES).includes(normalizedPurposeCategory)) {
    return normalizedPurposeCategory
  }

  const normalizedPackType = normalizeToken(packType)
  if (Object.values(KNOWLEDGE_PACK_PURPOSE_CATEGORIES).includes(normalizedPackType)) {
    return normalizedPackType
  }

  if (normalizedPackType === OUTCOME_KNOWLEDGE_PACK_TYPES.OUTPUT_SCHEMA) {
    return KNOWLEDGE_PACK_PURPOSE_CATEGORIES.OUTPUT
  }

  if (normalizedPackType === OUTCOME_KNOWLEDGE_PACK_TYPES.TRUTH_CERTIFICATION) {
    return KNOWLEDGE_PACK_PURPOSE_CATEGORIES.VALIDATION
  }

  return KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM
}

const buildSourceImportScope = ({ visibility, customerId, tenantId }) => {
  const normalizedVisibility = normalizeToken(visibility || KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM)
  const normalizedCustomerId = normalizeText(customerId)
  const normalizedTenantId = normalizeText(tenantId)

  if (normalizedVisibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.CUSTOMER) {
    return {
      scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.CUSTOMER,
      scopeKey: `CUSTOMER:${normalizedCustomerId}`,
      visibility: normalizedVisibility,
      customerId: normalizedCustomerId,
      tenantId: null,
    }
  }

  if (normalizedVisibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.TENANT) {
    return {
      scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.TENANT,
      scopeKey: `TENANT:${normalizedTenantId}`,
      visibility: normalizedVisibility,
      customerId: null,
      tenantId: normalizedTenantId,
    }
  }

  return {
    scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL,
    scopeKey: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL,
    visibility: KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM,
    customerId: null,
    tenantId: null,
  }
}

const normalizeSourceDocumentReference = (sourceDocument = {}) => {
  const filename = normalizeText(sourceDocument.filename)
  const fileExtension = getFileExtension(sourceDocument)

  return {
    sourceDocumentId: normalizeText(sourceDocument.sourceDocumentId),
    filename,
    contentType: normalizeText(sourceDocument.contentType),
    fileExtension,
    sourceHash: normalizeText(sourceDocument.sourceHash),
    sourceType: 'SOURCE_DOCUMENT',
  }
}

const normalizeIdSegment = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

const buildSourceDocumentImportHash = ({ extractedText, sourceDocument }) => {
  const sourceHash = normalizeText(sourceDocument?.sourceHash)
  if (sourceHash) return sourceHash

  if (normalizeText(extractedText)) return buildContentHash(extractedText)

  return buildContentHash(JSON.stringify({
    sourceDocumentId: normalizeText(sourceDocument?.sourceDocumentId),
    filename: normalizeText(sourceDocument?.filename),
    contentType: normalizeText(sourceDocument?.contentType),
    fileExtension: getFileExtension(sourceDocument),
  }))
}

const buildSourceDocumentId = ({
  packDefinition,
  semanticVersion,
  sourceDocument,
  sourceHash,
} = {}) => {
  const existingSourceDocumentId = normalizeText(sourceDocument?.sourceDocumentId)
  if (existingSourceDocumentId) return existingSourceDocumentId

  const hashSegment = normalizeLowerKey(sourceHash)
    .replace(/^sha256:/, '')
    .replace(/[^a-f0-9]/g, '')
    .slice(0, 16)
  const fallbackHashSegment = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      packType: packDefinition?.packType,
      packKey: packDefinition?.packKey,
      semanticVersion,
      filename: sourceDocument?.filename,
    }))
    .digest('hex')
    .slice(0, 16)

  return [
    'kpsrc',
    normalizeIdSegment(packDefinition?.packType || 'knowledge-pack'),
    normalizeIdSegment(packDefinition?.packKey || 'source'),
    normalizeIdSegment(semanticVersion || 'draft'),
    hashSegment || fallbackHashSegment,
  ]
    .filter(Boolean)
    .join('-')
    .slice(0, 180)
}

const ensureSourceDocumentDraftPackRecord = async ({
  packDefinition,
  actorUserId,
  versionId,
  semanticVersion,
  scope,
  session = null,
} = {}) => KnowledgePack.findOneAndUpdate(
  { packId: buildKnowledgePackId(packDefinition) },
  {
    $setOnInsert: {
      packId: buildKnowledgePackId(packDefinition),
      createdBy: actorUserId || null,
      isSystem: false,
    },
    $set: {
      packCategory: normalizePackCategory(packDefinition.packCategory, packDefinition.packType),
      purposeCategory: packDefinition.purposeCategory,
      ...(packDefinition.knowledgeLayer ? { knowledgeLayer: packDefinition.knowledgeLayer } : {}),
      ...(packDefinition.capabilityKey ? { capabilityKey: packDefinition.capabilityKey } : {}),
      ...(packDefinition.workspaceCompatibility?.length > 0
        ? { workspaceCompatibility: packDefinition.workspaceCompatibility }
        : {}),
      packType: normalizeToken(packDefinition.packType),
      packKey: normalizeLowerKey(packDefinition.packKey),
      label: normalizeText(packDefinition.label),
      description: normalizeText(packDefinition.description),
      status: OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT,
      latestVersionId: versionId,
      latestSemanticVersion: semanticVersion,
      sourceAuthority: normalizeText(packDefinition.sourceAuthority),
      executionMode: normalizeToken(packDefinition.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT),
      visibility: scope.visibility,
      customerId: scope.customerId || null,
      tenantId: scope.tenantId || null,
      authoringMode: KNOWLEDGE_PACK_AUTHORING_MODES.IMPORT_SOURCE_DOCUMENT,
      reviewStatus: KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT,
      updatedBy: actorUserId || null,
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: SOURCE_DOCUMENT_PRESENT_STATUS,
        sourceFilename: packDefinition.sourceDocument?.filename || '',
        sourceDocumentId: packDefinition.sourceDocument?.sourceDocumentId || '',
        sourceHash: packDefinition.sourceDocument?.sourceHash || '',
        sourceDocument: packDefinition.sourceDocument,
        contentPersisted: true,
      },
    },
  },
  {
    upsert: true,
    new: true,
    runValidators: true,
    setDefaultsOnInsert: true,
    ...(session ? { session } : {}),
  },
)

const SOURCE_DOCUMENT_IMPORT_PACK_FIELDS = [
  'packCategory',
  'purposeCategory',
  'knowledgeLayer',
  'capabilityKey',
  'workspaceCompatibility',
  'packType',
  'packKey',
  'label',
  'description',
  'status',
  'latestVersionId',
  'latestSemanticVersion',
  'sourceAuthority',
  'executionMode',
  'visibility',
  'customerId',
  'tenantId',
  'authoringMode',
  'reviewStatus',
  'updatedBy',
  'sourceMetadata',
]

const buildSourceDocumentImportRollbackGuard = ({ failedImportPackRecord, packId }) => {
  const guard = { packId }
  const recordId = failedImportPackRecord?._id
  const updatedAt = failedImportPackRecord?.updatedAt
  if (recordId) guard._id = recordId
  if (updatedAt) guard.updatedAt = updatedAt
  if (!updatedAt) {
    guard.latestVersionId = normalizeText(failedImportPackRecord?.latestVersionId)
    guard.latestSemanticVersion = normalizeText(failedImportPackRecord?.latestSemanticVersion)
    guard.reviewStatus = normalizeToken(failedImportPackRecord?.reviewStatus)
    guard['sourceMetadata.sourceDocumentId'] = normalizeText(
      failedImportPackRecord?.sourceMetadata?.sourceDocumentId,
    )
  }
  return guard
}

const throwSourceDocumentImportRollbackConflict = ({ packId, message }) => {
  throw createKnowledgePackError({
    status: 500,
    code: 'OUTCOME_KNOWLEDGE_PACK_ROLLBACK_FAILED',
    message,
    reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_IMPORT_ROLLBACK_CONFLICT,
    details: { packId },
  })
}

const restoreSourceDocumentImportPackRecord = async ({
  existingPackRecord,
  failedImportPackRecord,
  packId,
}) => {
  const rollbackGuard = buildSourceDocumentImportRollbackGuard({
    failedImportPackRecord,
    packId,
  })
  const currentPackRecord = await resolveLeanQuery(KnowledgePack.findOne(rollbackGuard))
  if (!currentPackRecord) {
    throwSourceDocumentImportRollbackConflict({
      packId,
      message: 'Knowledge pack source import rollback was blocked by a concurrent pack change.',
    })
  }

  if (!existingPackRecord) {
    const result = await KnowledgePack.deleteOne(rollbackGuard)
    if (Number(result?.deletedCount || 0) !== 1) {
      throwSourceDocumentImportRollbackConflict({
        packId,
        message: 'Knowledge pack source import rollback could not remove the failed draft.',
      })
    }
    return
  }

  const update = { $set: {}, $unset: {} }
  SOURCE_DOCUMENT_IMPORT_PACK_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(existingPackRecord, field)) {
      update.$set[field] = existingPackRecord[field]
    } else {
      update.$unset[field] = ''
    }
  })
  if (Object.keys(update.$unset).length === 0) delete update.$unset
  const result = await KnowledgePack.updateOne(rollbackGuard, update, { runValidators: true })
  if (Number(result?.matchedCount ?? result?.modifiedCount ?? 0) !== 1) {
    throwSourceDocumentImportRollbackConflict({
      packId,
      message: 'Knowledge pack source import rollback was blocked by a concurrent pack change.',
    })
  }
}

const buildValidationCheck = ({ code, passed, message }) => ({
  code,
  status: passed ? 'PASSED' : 'FAILED',
  message,
})

const getSourceDocumentHash = ({ version = {}, packRecord = {} } = {}) => {
  const sourceDocuments = Array.isArray(version.sourceDocuments) ? version.sourceDocuments : []
  const primarySourceDocument = sourceDocuments[0] || {}
  return normalizeText(
    primarySourceDocument.sourceHash
      || version.sourceMetadata?.sourceHash
      || version.sourceMetadata?.sourceDocument?.sourceHash
      || packRecord.sourceMetadata?.sourceHash
      || packRecord.sourceMetadata?.sourceDocument?.sourceHash,
  )
}

const getSourceDocumentId = ({ version = {}, packRecord = {} } = {}) => {
  const sourceDocuments = Array.isArray(version.sourceDocuments) ? version.sourceDocuments : []
  const primarySourceDocument = sourceDocuments[0] || {}
  return normalizeText(
    primarySourceDocument.sourceDocumentId
      || version.sourceMetadata?.sourceDocumentId
      || version.sourceMetadata?.sourceDocument?.sourceDocumentId
      || packRecord.sourceMetadata?.sourceDocumentId
      || packRecord.sourceMetadata?.sourceDocument?.sourceDocumentId,
  )
}

const buildSourceDocumentDraftValidationSummary = ({
  packDefinition,
  packRecord,
  version,
}) => {
  const text = typeof version?.content === 'string'
    ? version.content
    : JSON.stringify(version?.content ?? '')
  const expectedContentHash = buildContentHash(text)
  const sourceFilename = normalizeText(
    version?.sourceFilename
      || version?.sourceMetadata?.sourceFilename
      || packDefinition?.sourceFilename,
  )
  const sourceStatus = normalizeToken(
    version?.sourceMetadata?.sourceStatus
      || packRecord?.sourceMetadata?.sourceStatus,
  )
  const sourceHash = getSourceDocumentHash({ version, packRecord })
  const sourceDocumentId = getSourceDocumentId({ version, packRecord })
  const contentHash = normalizeText(version?.contentHash)

  const checks = [
    buildValidationCheck({
      code: 'PACK_METADATA_PRESENT',
      passed: Boolean(
        normalizeToken(packDefinition?.packType)
          && normalizeLowerKey(packDefinition?.packKey)
          && normalizeText(packDefinition?.label),
      ),
      message: 'Draft pack must include governed pack type, key, and label.',
    }),
    buildValidationCheck({
      code: 'SOURCE_DOCUMENT_PRESENT',
      passed: Boolean(
        sourceStatus === SOURCE_DOCUMENT_PRESENT_STATUS
          && sourceFilename
          && sourceDocumentId,
      ),
      message: 'Draft pack must reference the imported source document.',
    }),
    buildValidationCheck({
      code: 'SOURCE_HASH_PRESENT',
      passed: Boolean(sourceHash),
      message: 'Draft pack must retain the source document hash.',
    }),
    buildValidationCheck({
      code: 'SOURCE_TEXT_PERSISTED',
      passed: Boolean(text.trim() && version?.sourceMetadata?.contentPersisted === true),
      message: 'Draft pack must have persisted extracted source text before validation.',
    }),
    buildValidationCheck({
      code: 'CONTENT_HASH_MATCH',
      passed: Boolean(contentHash && contentHash === expectedContentHash),
      message: 'Persisted content hash must match the extracted source text.',
    }),
  ]

  const issues = checks
    .filter((check) => check.status === 'FAILED')
    .map((check) => ({
      code: check.code,
      message: check.message,
    }))

  return {
    status: issues.length === 0 ? 'PASSED' : 'FAILED',
    mode: SOURCE_VALIDATION_MODE,
    checkedAt: new Date().toISOString(),
    checks,
    issues,
  }
}

const buildActivationScope = ({
  scopeType = OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL,
  frameworkKey,
  runtimeType,
  packageKey,
  packageVersion,
  environmentKey,
} = {}) => {
  const normalizedScopeType = normalizeToken(scopeType || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL)
  if (![
    OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL,
    OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.FRAMEWORK,
    OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.RUNTIME_TYPE,
    OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.PACKAGE,
    OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.ENVIRONMENT,
  ].includes(normalizedScopeType)) {
    throw createKnowledgePackError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Knowledge pack activation scope is not supported for Outcome Studio runtime resolution.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.UNSUPPORTED_SCOPE_TYPE,
      details: { scopeType: normalizedScopeType },
    })
  }

  const normalizedScope = {
    scopeType: normalizedScopeType,
    frameworkKey: normalizeToken(frameworkKey),
    runtimeType: normalizeToken(runtimeType),
    packageKey: normalizeLowerKey(packageKey),
    packageVersion: normalizeText(packageVersion),
    environmentKey: normalizeToken(environmentKey),
  }

  return {
    ...normalizedScope,
    scopeKey: buildKnowledgePackActivationScopeKey(normalizedScope),
  }
}

const getAuditResourceId = (packRecord) => {
  const id = packRecord?._id || packRecord?.id
  return mongoose.isValidObjectId(id) ? id : new mongoose.Types.ObjectId(AUDIT_FALLBACK_OBJECT_ID)
}

const withOptionalSession = (query, session) => (
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query
)

const resolveLeanQuery = async (query) => (
  query && typeof query.lean === 'function'
    ? query.lean()
    : query
)

const countDocumentsWithOptionalSession = async (model, filter, session = null) => {
  const query = model.countDocuments(filter)
  return Number(await withOptionalSession(query, session)) || 0
}

const findKnowledgePackVersionWithContent = async ({ packId, versionId, session = null }) => {
  const query = withOptionalSession(KnowledgePackVersion.findOne({ packId, versionId }), session)
  return query && typeof query.select === 'function'
    ? query.select('+content')
    : query
}

const saveDocument = async (doc, session = null) => (
  session ? doc.save({ session }) : doc.save()
)

const updateKnowledgePackLatestVersion = async ({
  packId,
  status,
  versionId,
  semanticVersion,
  actorUserId,
  session = null,
}) => KnowledgePack.updateOne(
  { packId },
  {
    $set: {
      status,
      latestVersionId: versionId,
      latestSemanticVersion: semanticVersion,
      updatedBy: actorUserId || null,
    },
  },
  {
    runValidators: true,
    ...(session ? { session } : {}),
  },
)

const buildKnowledgePackAuditPayload = ({
  action,
  actorUserId,
  packRecord,
  packDefinition,
  version,
  activation = null,
  diff = {},
}) => ({
  action,
  actorUserId,
  resourceType: auditService.RESOURCE_TYPES.KnowledgePack,
  resourceId: getAuditResourceId(packRecord),
  display: {
    resourceLabel: packDefinition?.label || normalizeText(packRecord?.label) || normalizeText(version?.packKey),
  },
  diff: {
    packId: normalizeText(version?.packId || packRecord?.packId),
    versionId: normalizeText(version?.versionId),
    packType: normalizeToken(version?.packType || packDefinition?.packType),
    packKey: normalizeLowerKey(version?.packKey || packDefinition?.packKey),
    semanticVersion: normalizeText(version?.semanticVersion),
    status: normalizeToken(version?.status),
    contentHash: normalizeText(version?.contentHash),
    ...(activation ? {
      activationId: normalizeText(activation.activationId),
      scopeType: normalizeToken(activation.scopeType),
      scopeKey: normalizeToken(activation.scopeKey),
    } : {}),
    ...diff,
  },
})

const logKnowledgePackAudit = async ({
  auditRequest,
  action,
  actorUserId,
  packRecord,
  packDefinition,
  version,
  activation,
  diff,
  session = null,
  throwOnError = false,
}) => {
  const payload = buildKnowledgePackAuditPayload({
    action,
    actorUserId,
    packRecord,
    packDefinition,
    version,
    activation,
    diff,
  })
  const options = {
    throwOnError,
    ...(session ? { session } : {}),
  }

  if (auditRequest) {
    return auditService.logFromRequest(auditRequest, payload, options)
  }

  return auditService.log(payload, options)
}

const throwKnowledgePackAuditError = (err) => {
  throw createKnowledgePackError({
    status: 500,
    code: 'OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED',
    message: 'Outcome Studio knowledge pack audit could not be persisted.',
    reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.AUDIT_PERSISTENCE_FAILED,
    details: {
      auditError: err?.message || 'Audit persistence failed.',
    },
  })
}

const toDateString = (value) => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

const toPlainObject = (value) => {
  if (!value) return null
  if (typeof value.toJSON === 'function') return value.toJSON()
  if (typeof value.toObject === 'function') return value.toObject()
  return { ...value }
}

const toRawPlainObject = (value) => {
  if (!value) return null
  if (typeof value.toObject === 'function') return value.toObject({ transform: false })
  return toPlainObject(value)
}

const stripRestrictedPackContent = (plain = {}) => {
  const clone = { ...plain }
  delete clone.content
  delete clone.rawContent
  delete clone.compiledContent
  delete clone.arl
  delete clone.rl
  delete clone.reasoningRules
  return clone
}

const serializeKnowledgePack = (pack) => {
  const plain = stripRestrictedPackContent(toPlainObject(pack) || {})
  const packId = plain.packId || plain.id || ''
  delete plain._id
  delete plain.__v
  return {
    ...plain,
    id: packId,
    packId,
    packCategory: normalizePackCategory(plain.packCategory, plain.packType),
    purposeCategory: normalizeToken(plain.purposeCategory || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM),
    knowledgeLayer: normalizeToken(plain.knowledgeLayer),
    capabilityKey: normalizeLowerKey(plain.capabilityKey),
    workspaceCompatibility: normalizeTokenList(plain.workspaceCompatibility),
    packType: normalizeToken(plain.packType),
    packKey: normalizeLowerKey(plain.packKey),
    label: normalizeText(plain.label || plain.packKey),
    status: normalizeToken(plain.status || OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT),
    sourceAuthority: normalizeText(plain.sourceAuthority),
    executionMode: normalizeToken(plain.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT),
    visibility: normalizeToken(plain.visibility || KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM),
    customerId: plain.customerId ? normalizeText(plain.customerId) : null,
    tenantId: plain.tenantId ? normalizeText(plain.tenantId) : null,
    authoringMode: normalizeToken(plain.authoringMode || KNOWLEDGE_PACK_AUTHORING_MODES.CREATE_BLANK),
    reviewStatus: normalizeToken(plain.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT),
  }
}

const serializeKnowledgePackVersion = (version) => {
  if (!version) return null
  const plain = stripRestrictedPackContent(toPlainObject(version) || {})
  const versionId = plain.versionId || plain.id || ''
  delete plain._id
  delete plain.__v
  return {
    ...plain,
    id: versionId,
    versionId,
    packCategory: normalizePackCategory(plain.packCategory, plain.packType),
    purposeCategory: normalizeToken(plain.purposeCategory || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM),
    knowledgeLayer: normalizeToken(plain.knowledgeLayer),
    capabilityKey: normalizeLowerKey(plain.capabilityKey),
    workspaceCompatibility: normalizeTokenList(plain.workspaceCompatibility),
    dependencyReferences: normalizeDependencyReferences(plain.dependencyReferences),
    packType: normalizeToken(plain.packType),
    packKey: normalizeLowerKey(plain.packKey),
    status: normalizeToken(plain.status || OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT),
    scopeKey: normalizeToken(plain.scopeKey || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL),
    sourceAuthority: normalizeText(plain.sourceAuthority),
    executionMode: normalizeToken(plain.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT),
    visibility: normalizeToken(plain.visibility || KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM),
    customerId: plain.customerId ? normalizeText(plain.customerId) : null,
    tenantId: plain.tenantId ? normalizeText(plain.tenantId) : null,
    authoringMode: normalizeToken(plain.authoringMode || KNOWLEDGE_PACK_AUTHORING_MODES.IMPORT_SOURCE_DOCUMENT),
    reviewStatus: normalizeToken(plain.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT),
    validatedAt: toDateString(plain.validatedAt),
  }
}

const serializeKnowledgePackContentPreview = ({ version, packDefinition }) => {
  if (!version) return null
  const plain = toRawPlainObject(version) || {}
  const content = typeof plain.content === 'string'
    ? plain.content
    : JSON.stringify(plain.content ?? '', null, 2)
  const versionId = plain.versionId || plain.id || ''

  return {
    id: versionId,
    versionId,
    packId: normalizeText(plain.packId),
    packCategory: normalizePackCategory(plain.packCategory || packDefinition?.packCategory, plain.packType || packDefinition?.packType),
    purposeCategory: normalizeToken(plain.purposeCategory || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM),
    knowledgeLayer: normalizeToken(plain.knowledgeLayer || packDefinition?.knowledgeLayer),
    capabilityKey: normalizeLowerKey(plain.capabilityKey || packDefinition?.capabilityKey),
    workspaceCompatibility: normalizeTokenList(
      plain.workspaceCompatibility || packDefinition?.workspaceCompatibility,
    ),
    dependencyReferences: normalizeDependencyReferences(plain.dependencyReferences),
    packType: normalizeToken(plain.packType || packDefinition?.packType),
    packKey: normalizeLowerKey(plain.packKey || packDefinition?.packKey),
    semanticVersion: normalizeText(plain.semanticVersion),
    schemaVersion: normalizeText(plain.schemaVersion),
    status: normalizeToken(plain.status || OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT),
    scopeType: normalizeToken(plain.scopeType || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL),
    scopeKey: normalizeToken(plain.scopeKey || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL),
    contentFormat: normalizeToken(plain.contentFormat || OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML),
    sourceAuthority: normalizeText(plain.sourceAuthority),
    sourceFilename: normalizeText(plain.sourceFilename || plain.sourceMetadata?.sourceFilename || packDefinition?.sourceFilename),
    sourceDocuments: Array.isArray(plain.sourceDocuments) ? plain.sourceDocuments : [],
    executionMode: normalizeToken(plain.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT),
    visibility: normalizeToken(plain.visibility || KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM),
    customerId: plain.customerId ? normalizeText(plain.customerId) : null,
    tenantId: plain.tenantId ? normalizeText(plain.tenantId) : null,
    authoringMode: normalizeToken(plain.authoringMode || KNOWLEDGE_PACK_AUTHORING_MODES.IMPORT_SOURCE_DOCUMENT),
    reviewStatus: normalizeToken(plain.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT),
    contentHash: normalizeText(plain.contentHash),
    contentLength: content.length,
    contentVisible: true,
    previewMode: 'SOURCE_BACKED_SUPER_ADMIN_ONLY',
    content,
  }
}

const serializeKnowledgePackActivation = (activation) => {
  if (!activation) return null
  const plain = stripRestrictedPackContent(toPlainObject(activation) || {})
  const activationId = plain.activationId || plain.id || ''
  delete plain._id
  delete plain.__v
  return {
    activationId,
    packId: normalizeText(plain.packId),
    versionId: normalizeText(plain.versionId),
    packCategory: normalizePackCategory(plain.packCategory, plain.packType),
    purposeCategory: normalizeToken(plain.purposeCategory || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM),
    knowledgeLayer: normalizeToken(plain.knowledgeLayer),
    capabilityKey: normalizeLowerKey(plain.capabilityKey),
    workspaceCompatibility: normalizeTokenList(plain.workspaceCompatibility),
    dependencyReferences: normalizeDependencyReferences(plain.dependencyReferences),
    packType: normalizeToken(plain.packType),
    packKey: normalizeLowerKey(plain.packKey),
    label: normalizeText(plain.label || plain.packKey),
    semanticVersion: normalizeText(plain.semanticVersion),
    schemaVersion: normalizeText(plain.schemaVersion),
    status: normalizeToken(plain.status || OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE),
    scopeType: normalizeToken(plain.scopeType || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL),
    scopeKey: normalizeToken(plain.scopeKey || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL),
    frameworkKey: normalizeToken(plain.frameworkKey),
    runtimeType: normalizeToken(plain.runtimeType),
    packageKey: normalizeLowerKey(plain.packageKey),
    packageVersion: normalizeText(plain.packageVersion),
    environmentKey: normalizeToken(plain.environmentKey),
    executionMode: normalizeToken(plain.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT),
    visibility: normalizeToken(plain.visibility || KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM),
    customerId: plain.customerId ? normalizeText(plain.customerId) : null,
    tenantId: plain.tenantId ? normalizeText(plain.tenantId) : null,
    contentHash: normalizeText(plain.contentHash),
    activatedAt: toDateString(plain.activatedAt),
  }
}

export const buildOutcomeKnowledgePackSourceBundle = () => ({
  status: RETIRED_SOURCE_BUNDLE_STATUS,
  sourceDocuments: [],
})

const buildScopeCandidate = ({ scopeType, scopeKey, precedence }) => ({
  scopeType,
  scopeKey,
  precedence,
})

export const buildOutcomeKnowledgePackScopeCandidates = ({
  frameworkKey,
  runtimeType,
  packageKey,
  packageVersion,
  environmentKey,
  customerId,
  tenantId,
  runtimeInstanceId,
} = {}) => {
  const normalizedFrameworkKey = normalizeToken(frameworkKey)
  const normalizedRuntimeType = normalizeToken(runtimeType)
  const normalizedPackageKey = normalizeLowerKey(packageKey)
  const normalizedPackageVersion = normalizeText(packageVersion)
  const normalizedEnvironmentKey = normalizeToken(environmentKey)
  const normalizedCustomerId = normalizeText(customerId)
  const normalizedTenantId = normalizeText(tenantId)
  const normalizedRuntimeInstanceId = normalizeText(runtimeInstanceId)
  const candidates = [
    buildScopeCandidate({
      scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL,
      scopeKey: normalizeToken(OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL),
      precedence: 0,
    }),
  ]

  if (normalizedEnvironmentKey) {
    candidates.push(buildScopeCandidate({
      scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.ENVIRONMENT,
      scopeKey: normalizeToken(`ENVIRONMENT:${normalizedEnvironmentKey}`),
      precedence: 1,
    }))
  }

  if (normalizedFrameworkKey) {
    candidates.push(buildScopeCandidate({
      scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.FRAMEWORK,
      scopeKey: normalizeToken(`FRAMEWORK:${normalizedFrameworkKey}`),
      precedence: 2,
    }))
  }

  if (normalizedRuntimeType) {
    candidates.push(buildScopeCandidate({
      scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.RUNTIME_TYPE,
      scopeKey: normalizeToken(`RUNTIME_TYPE:${normalizedRuntimeType}`),
      precedence: 3,
    }))
  }

  if (normalizedPackageKey) {
    candidates.push(buildScopeCandidate({
      scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.PACKAGE,
      scopeKey: normalizeToken(`PACKAGE:${normalizedFrameworkKey || '*'}:${normalizedPackageKey}:${normalizedPackageVersion || '*'}`),
      precedence: 4,
    }))
  }

  if (normalizedCustomerId) {
    candidates.push(buildScopeCandidate({
      scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.CUSTOMER,
      scopeKey: normalizeToken(`CUSTOMER:${normalizedCustomerId}`),
      precedence: 5,
    }))
  }

  if (normalizedTenantId) {
    candidates.push(buildScopeCandidate({
      scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.TENANT,
      scopeKey: normalizeToken(`TENANT:${normalizedTenantId}`),
      precedence: 6,
    }))
  }

  if (normalizedRuntimeInstanceId) {
    candidates.push(buildScopeCandidate({
      scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.RUNTIME_INSTANCE,
      scopeKey: normalizeToken(`RUNTIME_INSTANCE:${normalizedRuntimeInstanceId}`),
      precedence: 7,
    }))
  }

  return candidates
}

const buildRequiredPackKey = (pack) =>
  `${normalizeToken(pack?.packType)}:${normalizeLowerKey(pack?.packKey)}`

const compareActivationSpecificity = (left, right, scopePrecedenceByKey) => {
  const leftScopeScore = scopePrecedenceByKey.get(normalizeToken(left?.scopeKey)) ?? -1
  const rightScopeScore = scopePrecedenceByKey.get(normalizeToken(right?.scopeKey)) ?? -1
  if (leftScopeScore !== rightScopeScore) return leftScopeScore - rightScopeScore

  const leftActivatedAt = new Date(left?.activatedAt || 0).getTime() || 0
  const rightActivatedAt = new Date(right?.activatedAt || 0).getTime() || 0
  return leftActivatedAt - rightActivatedAt
}

const selectActiveActivations = ({ activations = [], scopeCandidates = [] }) => {
  const scopePrecedenceByKey = new Map(
    scopeCandidates.map((candidate) => [normalizeToken(candidate.scopeKey), candidate.precedence]),
  )
  const selected = new Map()

  for (const activation of activations.map(serializeKnowledgePackActivation).filter(Boolean)) {
    if (activation.status !== OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE) continue

    const requiredPackKey = buildRequiredPackKey(activation)
    const existing = selected.get(requiredPackKey)
    if (!existing || compareActivationSpecificity(existing, activation, scopePrecedenceByKey) < 0) {
      selected.set(requiredPackKey, activation)
    }
  }

  return selected
}

const buildActivePackProjection = (pack, activation) => ({
  packCategory: normalizePackCategory(pack.packCategory || activation.packCategory, pack.packType),
  purposeCategory: normalizeToken(activation.purposeCategory || pack.purposeCategory),
  knowledgeLayer: normalizeToken(activation.knowledgeLayer),
  capabilityKey: normalizeLowerKey(activation.capabilityKey),
  workspaceCompatibility: normalizeTokenList(activation.workspaceCompatibility),
  dependencyReferences: normalizeDependencyReferences(activation.dependencyReferences),
  packType: normalizeToken(pack.packType || activation.packType),
  packKey: normalizeLowerKey(pack.packKey || activation.packKey),
  label: normalizeText(pack.label || activation.label || activation.packKey),
  status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
  runtimeBindable: true,
  activationId: activation.activationId,
  versionId: activation.versionId,
  semanticVersion: activation.semanticVersion,
  schemaVersion: activation.schemaVersion,
  scopeType: activation.scopeType,
  scopeKey: activation.scopeKey,
  executionMode: activation.executionMode,
  visibility: activation.visibility,
  customerId: activation.customerId,
  tenantId: activation.tenantId,
  contentHash: activation.contentHash,
  activatedAt: activation.activatedAt,
})

const buildRequiredPackProjection = ({ activeActivationByPackKey }) =>
  OUTCOME_STUDIO_REQUIRED_PACKS.map((pack) => {
    const activation = activeActivationByPackKey.get(buildRequiredPackKey(pack))
    if (activation) {
      return buildActivePackProjection(pack, activation)
    }

    return {
      ...pack,
      status: MISSING_REQUIRED_PACK_STATUS,
      runtimeBindable: false,
    }
  })

const isActivationVisibleToRuntime = ({ activation, customerId, tenantId }) => {
  const visibility = normalizeToken(activation?.visibility)
  if (visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM) return true

  if (visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.CUSTOMER) {
    const scopedCustomerId = normalizeText(activation?.customerId)
    return Boolean(scopedCustomerId && scopedCustomerId === normalizeText(customerId))
  }

  if (visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.TENANT) {
    const scopedTenantId = normalizeText(activation?.tenantId)
    return Boolean(scopedTenantId && scopedTenantId === normalizeText(tenantId))
  }

  return false
}

const isOutcomeStudioActivation = (activation) =>
  OUTCOME_STUDIO_RESOLUTION_PACK_CATEGORIES.has(
    normalizePackCategory(activation?.packCategory, activation?.packType),
  )

const classifyAdditionalActivePacks = ({ activations = [], contextCategories = [] }) => {
  const requiredPackKeys = new Set(OUTCOME_STUDIO_REQUIRED_PACKS.map(buildRequiredPackKey))
  const requestedCategories = new Set(
    contextCategories.map(normalizeToken).filter(Boolean),
  )
  const optionalPacks = []
  const validationPacks = []
  const blockedPacks = []

  for (const activation of activations) {
    if (requiredPackKeys.has(buildRequiredPackKey(activation))) continue

    const projectedPack = buildActivePackProjection(activation, activation)
    const purposeCategory = normalizeToken(projectedPack.purposeCategory)
    const executionMode = normalizeToken(projectedPack.executionMode)

    if (
      executionMode === KNOWLEDGE_PACK_EXECUTION_MODES.SYSTEM_ONLY
      || purposeCategory === KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM
    ) {
      blockedPacks.push({
        ...projectedPack,
        runtimeBindable: false,
        blockedReason: 'SYSTEM_ONLY_PACK',
      })
      continue
    }

    // Validation packs apply independently of provider-context category selection.
    if (
      executionMode === KNOWLEDGE_PACK_EXECUTION_MODES.PRE_VALIDATION
      || executionMode === KNOWLEDGE_PACK_EXECUTION_MODES.POST_VALIDATION
      || purposeCategory === KNOWLEDGE_PACK_PURPOSE_CATEGORIES.VALIDATION
    ) {
      validationPacks.push(projectedPack)
      continue
    }

    if (executionMode !== KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT) {
      blockedPacks.push({
        ...projectedPack,
        runtimeBindable: false,
        blockedReason: 'EXECUTION_MODE_NOT_RUNTIME_BINDABLE',
      })
      continue
    }

    if (requestedCategories.size > 0 && !requestedCategories.has(purposeCategory)) continue
    optionalPacks.push(projectedPack)
  }

  return { optionalPacks, validationPacks, blockedPacks }
}

const canonicalizeGovernanceList = (values = []) => JSON.stringify(
  [...values].map((value) => (
    value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
      : value
  )).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
)

const resolveRequestRuntimeVersionEvidence = async ({ activations = [] } = {}) => {
  const activationRows = activations.map(serializeKnowledgePackActivation).filter(Boolean)
  const versionIds = [...new Set(activationRows.map((activation) => activation.versionId).filter(Boolean))]
  const versionRows = versionIds.length > 0
    ? await KnowledgePackVersion.find({ versionId: { $in: versionIds } }).lean()
    : []
  const versionById = new Map(
    versionRows
      .map(serializeKnowledgePackVersion)
      .filter(Boolean)
      .map((version) => [version.versionId, version]),
  )
  const requiredPackKeys = new Set(OUTCOME_STUDIO_REQUIRED_PACKS.map(buildRequiredPackKey))
  const eligible = []
  const excluded = []

  const exclude = (activation, blockedReason) => {
    excluded.push({
      ...buildActivePackProjection(activation, activation),
      runtimeBindable: false,
      blockedReason,
    })
  }

  for (const activation of activationRows) {
    const version = versionById.get(activation.versionId)
    if (!version) {
      exclude(activation, 'VERSION_EVIDENCE_MISSING')
      continue
    }
    if (!REQUEST_RESOLUTION_VERSION_STATUSES.has(normalizeToken(version.status))) {
      exclude(activation, 'VERSION_NOT_ACTIVE')
      continue
    }
    if (normalizeToken(version.reviewStatus) !== KNOWLEDGE_PACK_REVIEW_STATUSES.APPROVED) {
      exclude(activation, 'VERSION_NOT_APPROVED')
      continue
    }
    if (!normalizeText(version.contentHash) || version.contentHash !== activation.contentHash) {
      exclude(activation, 'VERSION_CONTENT_HASH_MISMATCH')
      continue
    }

    const mandatorySafeguard = requiredPackKeys.has(buildRequiredPackKey(activation))
    if (!mandatorySafeguard) {
      const versionLayer = normalizeToken(version.knowledgeLayer)
      const versionCapability = normalizeLowerKey(version.capabilityKey)
      const versionCompatibility = normalizeTokenList(version.workspaceCompatibility)
      const versionDependencies = normalizeDependencyReferences(version.dependencyReferences)
      if (!versionLayer || versionLayer !== normalizeToken(activation.knowledgeLayer)) {
        exclude(activation, 'VERSION_LAYER_EVIDENCE_MISMATCH')
        continue
      }
      if (versionCapability !== normalizeLowerKey(activation.capabilityKey)) {
        exclude(activation, 'VERSION_CAPABILITY_EVIDENCE_MISMATCH')
        continue
      }
      if (
        canonicalizeGovernanceList(versionCompatibility)
        !== canonicalizeGovernanceList(normalizeTokenList(activation.workspaceCompatibility))
      ) {
        exclude(activation, 'VERSION_WORKSPACE_EVIDENCE_MISMATCH')
        continue
      }
      if (
        canonicalizeGovernanceList(versionDependencies)
        !== canonicalizeGovernanceList(normalizeDependencyReferences(activation.dependencyReferences))
      ) {
        exclude(activation, 'VERSION_DEPENDENCY_EVIDENCE_MISMATCH')
        continue
      }
    }

    eligible.push(activation)
  }

  return { eligible, excluded }
}

const hasRequestSpecificSelectors = ({
  requestedOutputTypeKey,
  requestedStyleKey,
  audienceKeys,
  industryKeys,
  languageKey,
  channelKey,
} = {}) => Boolean(
  normalizeLowerKey(requestedOutputTypeKey)
  || normalizeLowerKey(requestedStyleKey)
  || normalizeTokenList(audienceKeys).length
  || normalizeTokenList(industryKeys).length
  || normalizeLowerKey(languageKey)
  || normalizeLowerKey(channelKey)
)

const uniquePacksByActivation = (packs = []) => {
  const selected = new Map()
  for (const pack of packs.filter(Boolean)) {
    const key = normalizeText(pack.activationId)
      || `${normalizeToken(pack.packType)}:${normalizeLowerKey(pack.packKey)}:${normalizeText(pack.versionId)}`
    if (!selected.has(key)) selected.set(key, pack)
  }
  return [...selected.values()]
}

export const resolveOutcomeStudioKnowledgePacks = async ({
  frameworkKey,
  runtimeType,
  packageKey,
  packageVersion,
  environmentKey,
  customerId,
  tenantId,
  runtimeInstanceId,
  contextCategories = [],
  workspaceType = 'OUTCOME',
  requestedOutputTypeKey,
  requestedStyleKey,
  audienceKeys = [],
  industryKeys = [],
  languageKey,
  channelKey,
  resolvedAt,
} = {}) => {
  const scopeCandidates = buildOutcomeKnowledgePackScopeCandidates({
    frameworkKey,
    runtimeType,
    packageKey,
    packageVersion,
    environmentKey,
    customerId,
    tenantId,
    runtimeInstanceId,
  })
  const scopeKeys = scopeCandidates.map((candidate) => candidate.scopeKey)
  const activations = await KnowledgePackActivation.find({
    status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
    scopeKey: { $in: scopeKeys },
  })
    .sort({ activatedAt: -1 })
    .lean()
  let eligibleActivations = activations
    .map(serializeKnowledgePackActivation)
    .filter(Boolean)
    .filter(isOutcomeStudioActivation)
    .filter((activation) => isActivationVisibleToRuntime({ activation, customerId, tenantId }))
  const requestSpecific = hasRequestSpecificSelectors({
    requestedOutputTypeKey,
    requestedStyleKey,
    audienceKeys,
    industryKeys,
    languageKey,
    channelKey,
  })
  const hasDiscoverableOutputTypes = eligibleActivations.some((activation) => (
    normalizeToken(activation.knowledgeLayer) === 'OUTPUT_TYPE'
    && !OUTCOME_STUDIO_REQUIRED_PACKS
      .some((requiredPack) => buildRequiredPackKey(requiredPack) === buildRequiredPackKey(activation))
  ))
  let versionEvidenceExclusions = []
  if (requestSpecific || hasDiscoverableOutputTypes) {
    const versionEvidence = await resolveRequestRuntimeVersionEvidence({
      activations: eligibleActivations,
    })
    eligibleActivations = versionEvidence.eligible
    versionEvidenceExclusions = versionEvidence.excluded
  }
  const activeActivationByPackKey = selectActiveActivations({
    activations: eligibleActivations,
    scopeCandidates,
  })
  const requiredPacks = buildRequiredPackProjection({ activeActivationByPackKey })
  const additionalPacks = classifyAdditionalActivePacks({
    activations: [...activeActivationByPackKey.values()],
    contextCategories,
  })
  const activeRequiredPacks = requiredPacks.filter((pack) => pack.runtimeBindable === true)
  const activePacks = [
    ...activeRequiredPacks,
    ...additionalPacks.optionalPacks,
    ...additionalPacks.validationPacks,
  ]
  const unboundRequiredPacks = requiredPacks.filter((pack) => pack.runtimeBindable !== true)
  if (requestSpecific) {
    const requestResolution = resolveRequestSpecificKnowledgePacks({
      mandatorySafeguards: activeRequiredPacks,
      candidates: [...activeActivationByPackKey.values()].filter(
        (activation) => !OUTCOME_STUDIO_REQUIRED_PACKS
          .some((requiredPack) => buildRequiredPackKey(requiredPack) === buildRequiredPackKey(activation)),
      ),
      request: {
        workspaceType,
        requestedOutputTypeKey,
        requestedStyleKey,
        audienceKeys,
        industryKeys,
        languageKey,
        channelKey,
        resolvedAt,
      },
      scopeCandidates,
    })
    const selectedPacks = uniquePacksByActivation([
      ...requestResolution.providerContextPacks,
      ...requestResolution.preValidationPacks,
      ...requestResolution.postValidationPacks,
      ...requestResolution.systemOnlyPacks,
    ])
    const providerContextPacks = requestResolution.providerContextPacks.filter(
      (pack) => !OUTCOME_STUDIO_REQUIRED_PACKS
        .some((requiredPack) => buildRequiredPackKey(requiredPack) === buildRequiredPackKey(pack)),
    )
    const validationPacks = uniquePacksByActivation([
      ...requestResolution.preValidationPacks,
      ...requestResolution.postValidationPacks,
    ])
    const summaryByStatus = {
      READY: 'Request-specific Knowledge Pack resolution is ready.',
      READY_WITH_GAPS: 'Request-specific Knowledge Pack resolution is ready with optional gaps.',
      BLOCKED: 'Request-specific Knowledge Pack resolution is blocked by missing governed knowledge.',
      AMBIGUOUS: 'Request-specific Knowledge Pack resolution found multiple equally eligible candidates.',
    }

    return {
      status: requestResolution.status,
      mode: OUTCOME_KNOWLEDGE_PACK_RESOLUTION_MODE,
      summary: summaryByStatus[requestResolution.status],
      activePacks: selectedPacks.filter(
        (pack) => normalizeToken(pack.executionMode) !== KNOWLEDGE_PACK_EXECUTION_MODES.SYSTEM_ONLY,
      ),
      requiredPacks: requestResolution.mandatorySafeguards,
      mandatorySafeguards: requestResolution.mandatorySafeguards,
      optionalPacks: providerContextPacks,
      validationPacks,
      providerContextPacks: requestResolution.providerContextPacks,
      preValidationPacks: requestResolution.preValidationPacks,
      postValidationPacks: requestResolution.postValidationPacks,
      systemOnlyPacks: requestResolution.systemOnlyPacks,
      blockedPacks: [
        ...versionEvidenceExclusions,
        ...additionalPacks.blockedPacks,
      ],
      sourceBundle: buildOutcomeKnowledgePackSourceBundle(),
      selectedByLayer: requestResolution.selectedByLayer,
      missingDependencies: requestResolution.missingDependencies,
      ambiguousCandidates: requestResolution.ambiguousCandidates,
      excludedCandidates: requestResolution.excludedCandidates,
      warnings: requestResolution.warnings,
      dependencyGraph: requestResolution.dependencyGraph,
      lineage: requestResolution.lineage,
      resolution: {
        ...requestResolution,
        scopeCandidates,
        activeCount: requestResolution.mandatorySafeguards
          .filter((pack) => pack.runtimeBindable === true).length,
        resolvedCount: selectedPacks.length,
        requiredCount: requestResolution.mandatorySafeguards.length,
        optionalCount: providerContextPacks.length,
        validationCount: validationPacks.length,
        blockedCount: versionEvidenceExclusions.length
          + requestResolution.missingDependencies.length
          + requestResolution.ambiguousCandidates.length,
        requestedContextCategories: contextCategories.map(normalizeToken).filter(Boolean),
        unboundRequiredPacks: requestResolution.mandatorySafeguards
          .filter((pack) => pack.runtimeBindable !== true)
          .map((pack) => ({
            packCategory: normalizePackCategory(pack.packCategory, pack.packType),
            packType: pack.packType,
            packKey: pack.packKey,
            label: pack.label,
            status: pack.status,
          })),
      },
    }
  }

  const status = unboundRequiredPacks.length === 0
    ? OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED
    : OUTCOME_STUDIO_BINDING_STATUSES.BLOCKED
  const availableOutputTypes = discoverRequestSpecificOutputTypes({
    mandatorySafeguards: activeRequiredPacks,
    candidates: [...activeActivationByPackKey.values()].filter(
      (activation) => !OUTCOME_STUDIO_REQUIRED_PACKS
        .some((requiredPack) => buildRequiredPackKey(requiredPack) === buildRequiredPackKey(activation)),
    ),
    request: {
      workspaceType,
      resolvedAt,
    },
    scopeCandidates,
  })

  return {
    status,
    mode: OUTCOME_KNOWLEDGE_PACK_RESOLUTION_MODE,
    summary: status === OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED
      ? 'All required Outcome Studio knowledge pack bindings are active.'
      : 'Knowledge Pack Registry activation is required before Outcome Studio sessions can start.',
    activePacks,
    requiredPacks,
    optionalPacks: additionalPacks.optionalPacks,
    validationPacks: additionalPacks.validationPacks,
    blockedPacks: [
      ...versionEvidenceExclusions,
      ...additionalPacks.blockedPacks,
    ],
    availableOutputTypes,
    sourceBundle: buildOutcomeKnowledgePackSourceBundle(),
    resolution: {
      status,
      scopeCandidates,
      activeCount: activeRequiredPacks.length,
      resolvedCount: activePacks.length,
      requiredCount: requiredPacks.length,
      optionalCount: additionalPacks.optionalPacks.length,
      validationCount: additionalPacks.validationPacks.length,
      blockedCount: versionEvidenceExclusions.length + additionalPacks.blockedPacks.length,
      requestedContextCategories: contextCategories.map(normalizeToken).filter(Boolean),
      unboundRequiredPacks: unboundRequiredPacks.map((pack) => ({
        packCategory: normalizePackCategory(pack.packCategory, pack.packType),
        packType: pack.packType,
        packKey: pack.packKey,
        label: pack.label,
        status: pack.status,
      })),
    },
  }
}

export const resolveOutcomeStudioKnowledgePackBinding = async ({ query = {} } = {}) => {
  const binding = await resolveOutcomeStudioKnowledgePacks(query)

  return {
    manifest: {
      ...OUTCOME_STUDIO_REGISTRY_POLICY,
      status: binding.status,
    },
    binding: {
      ...binding,
      resolutionSource: OUTCOME_STUDIO_REGISTRY_POLICY.sourceType,
      policyKey: OUTCOME_STUDIO_REGISTRY_POLICY.policyKey,
      policyVersion: OUTCOME_STUDIO_REGISTRY_POLICY.policyVersion,
      previewOnly: false,
      contentVisible: false,
    },
  }
}

const buildListFilter = ({
  q,
  knowledgeLayer,
  packType,
  status,
  packKey,
} = {}) => {
  const filter = {}
  const normalizedPackType = normalizeToken(packType)
  const normalizedKnowledgeLayer = normalizeToken(knowledgeLayer)
  const normalizedStatus = normalizeToken(status)
  const normalizedPackKey = normalizeLowerKey(packKey)

  if (normalizedPackType) filter.packType = normalizedPackType
  if (normalizedKnowledgeLayer) filter.knowledgeLayer = normalizedKnowledgeLayer
  if (normalizedStatus) filter.status = normalizedStatus
  if (normalizedPackKey) filter.packKey = normalizedPackKey

  const normalizedQuery = normalizeText(q)
  if (normalizedQuery) {
    const regex = new RegExp(escapeRegex(normalizedQuery), 'i')
    filter.$or = [
      { packId: regex },
      { packKey: regex },
      { label: regex },
      { description: regex },
    ]
  }

  return filter
}

const buildSort = ({ sortBy, sortOrder } = {}) => {
  const direction = String(sortOrder || '').trim().toLowerCase() === 'asc' ? 1 : -1
  if (sortBy === 'label') return { label: direction, packKey: 1 }
  if (sortBy === 'packKey') return { packKey: direction }
  if (sortBy === 'packType') return { packType: direction, packKey: 1 }
  if (sortBy === 'knowledgeLayer') return { knowledgeLayer: direction, packType: 1, packKey: 1 }
  if (sortBy === 'status') return { status: direction, packKey: 1 }
  if (sortBy === 'updatedAt') return { updatedAt: direction, packKey: 1 }
  return { packType: 1, packKey: 1 }
}

export const listOutcomeKnowledgePacks = async ({ query = {} } = {}) => {
  const page = Number(query.page) || 1
  const pageSize = Number(query.pageSize) || 20
  const filter = buildListFilter(query)
  const [total, rows] = await Promise.all([
    KnowledgePack.countDocuments(filter),
    KnowledgePack.find(filter)
      .sort(buildSort(query))
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ])

  return {
    data: rows.map(serializeKnowledgePack),
    sourceBundle: buildOutcomeKnowledgePackSourceBundle(),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    },
  }
}

export const getOutcomeKnowledgePackDuplicateDiagnostics = async () =>
  scanOutcomeKnowledgePackDuplicates()

const buildPackLookup = (packId) => {
  const normalizedPackId = normalizeText(packId)
  const clauses = [
    { packId: normalizedPackId },
    { packKey: normalizeLowerKey(normalizedPackId) },
  ]
  if (mongoose.isValidObjectId(normalizedPackId)) clauses.push({ _id: normalizedPackId })
  return { $or: clauses }
}

const packRecordMatchesLookup = (packRecord, packId) => {
  if (!packRecord) return false
  const normalizedPackId = normalizeText(packId)
  const normalizedLookupKey = normalizeLowerKey(normalizedPackId)
  return normalizeLowerKey(packRecord.packId) === normalizedLookupKey
    || normalizeLowerKey(packRecord.packKey) === normalizedLookupKey
    || normalizeText(packRecord._id) === normalizedPackId
    || normalizeText(packRecord.id) === normalizedPackId
}

const buildPersistedPackDefinition = (packRecord = {}) => ({
  packCategory: normalizePackCategory(packRecord.packCategory, packRecord.packType),
  purposeCategory: normalizeToken(packRecord.purposeCategory || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM),
  knowledgeLayer: normalizeToken(packRecord.knowledgeLayer),
  capabilityKey: normalizeLowerKey(packRecord.capabilityKey),
  workspaceCompatibility: normalizeTokenList(packRecord.workspaceCompatibility),
  packType: normalizeToken(packRecord.packType),
  packKey: normalizeLowerKey(packRecord.packKey),
  label: normalizeText(packRecord.label || packRecord.packKey),
  sourceFilename: normalizeText(
    packRecord.sourceFilename
      || packRecord.sourceMetadata?.sourceFilename
      || packRecord.sourceMetadata?.sourceDocument?.filename,
  ),
})

const isImportedSourceDocumentPack = (packRecord = {}) => (
  normalizeToken(packRecord.authoringMode) === KNOWLEDGE_PACK_AUTHORING_MODES.IMPORT_SOURCE_DOCUMENT
    || normalizeToken(packRecord.sourceMetadata?.importMode) === 'SOURCE_DOCUMENT_IMPORT_DRAFT'
    || normalizeToken(packRecord.sourceMetadata?.sourceStatus) === SOURCE_DOCUMENT_PRESENT_STATUS
)

const resolveKnowledgePackContentPreviewContext = async ({ packId } = {}) => {
  const packRecord = await KnowledgePack.findOne(buildPackLookup(packId)).lean()
  if (!packRecord || !packRecordMatchesLookup(packRecord, packId)) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_NOT_FOUND,
      details: { packId },
    })
  }

  if (!isImportedSourceDocumentPack(packRecord)) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'This Outcome Studio knowledge pack does not have source-document content available for preview.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_NOT_AVAILABLE,
      details: {
        packId: normalizeText(packRecord.packId),
        packType: normalizeToken(packRecord.packType),
        packKey: normalizeLowerKey(packRecord.packKey),
      },
    })
  }

  return {
    canonicalPackId: normalizeText(packRecord.packId),
    packDefinition: buildPersistedPackDefinition(packRecord),
    packRecord,
  }
}

const resolveKnowledgePackAuthoringContext = async ({ packId, session = null } = {}) => {
  const packRecordQuery = KnowledgePack.findOne(buildPackLookup(packId))
  const packRecord = await resolveLeanQuery(withOptionalSession(packRecordQuery, session))
  if (!packRecord || !packRecordMatchesLookup(packRecord, packId)) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_NOT_FOUND,
      details: { packId },
    })
  }

  if (!isImportedSourceDocumentPack(packRecord)) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'This Outcome Studio knowledge pack does not use the imported source-document authoring workflow.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_NOT_AVAILABLE,
      details: {
        packId: normalizeText(packRecord.packId),
        packType: normalizeToken(packRecord.packType),
        packKey: normalizeLowerKey(packRecord.packKey),
      },
    })
  }

  return {
    canonicalPackId: normalizeText(packRecord.packId),
    packDefinition: buildPersistedPackDefinition(packRecord),
    packRecord,
  }
}

export const getOutcomeKnowledgePack = async ({ packId } = {}) => {
  const pack = await KnowledgePack.findOne(buildPackLookup(packId)).lean()

  if (!pack) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_NOT_FOUND,
      details: { packId },
    })
  }

  const serializedPack = serializeKnowledgePack(pack)
  const [versions, activations] = await Promise.all([
    KnowledgePackVersion.find({ packId: serializedPack.packId })
      .sort({ updatedAt: -1 })
      .limit(20)
      .lean(),
    KnowledgePackActivation.find({ packId: serializedPack.packId })
      .sort({ activatedAt: -1 })
      .limit(20)
      .lean(),
  ])

  return {
    ...serializedPack,
    versions: versions.map(serializeKnowledgePackVersion).filter(Boolean),
    activations: activations.map(serializeKnowledgePackActivation).filter(Boolean),
  }
}

export const createOutcomeKnowledgePackVersion = async ({
  packId,
} = {}) => {
  throwStarterAuthoringRetiredError({ packId })
}

export const importOutcomeKnowledgePackSourceDocumentDraft = async ({
  body = {},
  actorUserId = null,
  auditRequest = null,
} = {}) => {
  const semanticVersion = normalizeText(body.semanticVersion)
  if (!SEMANTIC_VERSION_RE.test(semanticVersion)) {
    throw createKnowledgePackError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Knowledge pack semantic version must use major.minor.patch format.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_VALIDATION_FAILED,
      details: { field: 'semanticVersion' },
    })
  }

  const sourceDocumentPayload = body.sourceDocument || {}
  const sourceDocumentInput = normalizeSourceDocumentReference(sourceDocumentPayload)
  const contentFormat = assertSupportedSourceDocumentFormat({
    contentFormat: body.contentFormat,
    sourceDocument: sourceDocumentInput,
  })
  if (CLIENT_TEXT_SOURCE_DOCUMENT_FORMATS.has(contentFormat) && !normalizeText(body.extractedText)) {
    throw createKnowledgePackError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Extracted source text is required before a Knowledge Pack draft can be created.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_TEXT_REQUIRED,
      details: {
        contentFormat,
        filename: sourceDocumentInput.filename,
      },
    })
  }
  let extraction
  try {
    extraction = await extractKnowledgePackSourceDocumentText({
      contentFormat,
      extractedText: body.extractedText,
      sourceDocument: sourceDocumentPayload,
    })
  } catch (err) {
    const isExtractionRequired = err?.code === SOURCE_DOCUMENT_EXTRACTION_ERRORS.EXTRACTION_REQUIRED
    const isNoReadableText = err?.code === SOURCE_DOCUMENT_EXTRACTION_ERRORS.NO_READABLE_TEXT
    throw createKnowledgePackError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: isExtractionRequired
        ? 'This Knowledge Pack import path requires deterministic source document extraction before draft creation.'
        : 'Source document text could not be extracted deterministically for Knowledge Pack draft import.',
      reason: isExtractionRequired
        ? OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_EXTRACTION_REQUIRED
        : OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_EXTRACTION_FAILED,
      details: {
        contentFormat,
        filename: sourceDocumentInput.filename,
        extractionError: isNoReadableText
          ? SOURCE_DOCUMENT_EXTRACTION_ERRORS.NO_READABLE_TEXT
          : err?.code || SOURCE_DOCUMENT_EXTRACTION_ERRORS.EXTRACTION_FAILED,
        supportedFormats: Object.values(OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS),
      },
    })
  }
  const extractedText = normalizeText(extraction.text)
  if (!extractedText) {
    throw createKnowledgePackError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Extracted source text is required before a Knowledge Pack draft can be created.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_TEXT_REQUIRED,
      details: {
        contentFormat,
        filename: sourceDocumentInput.filename,
      },
    })
  }
  const scope = buildSourceImportScope({
    visibility: body.visibility,
    customerId: body.customerId,
    tenantId: body.tenantId,
  })
  const packDefinition = {
    packType: normalizeToken(body.packType),
    packKey: normalizeLowerKey(body.packKey),
    label: normalizeText(body.label),
    description: normalizeText(body.description),
    purposeCategory: resolveSourceImportPurposeCategory({
      packType: body.packType,
      purposeCategory: body.purposeCategory,
    }),
    knowledgeLayer: normalizeToken(body.knowledgeLayer),
    capabilityKey: normalizeLowerKey(body.capabilityKey),
    workspaceCompatibility: normalizeTokenList(body.workspaceCompatibility),
    dependencyReferences: normalizeDependencyReferences(body.dependencyReferences),
    sourceAuthority: normalizeText(body.sourceAuthority),
    executionMode: normalizeToken(body.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT),
    sourceDocument: sourceDocumentInput,
  }
  const canonicalPackId = buildKnowledgePackId(packDefinition)
  const versionId = buildKnowledgePackVersionId({
    packType: packDefinition.packType,
    packKey: packDefinition.packKey,
    semanticVersion,
    scopeKey: scope.scopeKey,
  })
  const sourceHash = normalizeText(extraction.sourceHash) || buildSourceDocumentImportHash({
    extractedText,
    sourceDocument: sourceDocumentInput,
  })
  const contentHash = buildContentHash(extractedText)
  const sourceDocument = normalizeSourceDocumentReference({
    ...sourceDocumentInput,
    sourceHash,
    sourceDocumentId: buildSourceDocumentId({
      packDefinition,
      semanticVersion,
      sourceDocument: sourceDocumentInput,
      sourceHash,
    }),
  })
  packDefinition.sourceDocument = sourceDocument

  const existingVersion = await KnowledgePackVersion.findOne({
    packType: packDefinition.packType,
    packKey: packDefinition.packKey,
    semanticVersion,
    scopeKey: scope.scopeKey,
  }).lean()

  if (existingVersion) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack source document draft already exists for this pack, semantic version, and scope.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_ALREADY_EXISTS,
      details: {
        packId: canonicalPackId,
        versionId,
        semanticVersion,
        scopeKey: scope.scopeKey,
      },
    })
  }

  const duplicateWarnings = await findSourceImportDuplicateWarnings({
    canonicalPackId,
    contentHash,
    label: packDefinition.label,
    sourceHash,
    scopeKey: scope.scopeKey,
  })
  const duplicateOverrideReason = normalizeText(body.duplicateOverrideReason)
  if (duplicateWarnings.length > 0 && !duplicateOverrideReason) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Potential duplicate Knowledge Pack records require review before this draft can be created.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_DUPLICATE_REVIEW_REQUIRED,
      details: {
        duplicateStatus: 'REVIEW_REQUIRED',
        classifications: [...new Set(duplicateWarnings.map((warning) => warning.classification))],
        candidates: duplicateWarnings.map((warning) => ({
          classification: warning.classification,
          ...warning.candidate,
        })),
        allowedActions: ['VIEW_EXISTING', 'CONTINUE_WITH_REASON', 'CANCEL'],
      },
    })
  }

  const buildSourceImportVersion = (metadataPackRecord = null) => {
    const versionKnowledgeLayer = packDefinition.knowledgeLayer
      || normalizeToken(metadataPackRecord?.knowledgeLayer)
    const versionCapabilityKey = packDefinition.capabilityKey
      || normalizeLowerKey(metadataPackRecord?.capabilityKey)
    const versionWorkspaceCompatibility = packDefinition.workspaceCompatibility.length > 0
      ? packDefinition.workspaceCompatibility
      : normalizeTokenList(metadataPackRecord?.workspaceCompatibility)

    return new KnowledgePackVersion({
      versionId,
      packId: canonicalPackId,
      packCategory: normalizePackCategory(packDefinition.packCategory, packDefinition.packType),
      purposeCategory: packDefinition.purposeCategory,
      knowledgeLayer: versionKnowledgeLayer || undefined,
      capabilityKey: versionCapabilityKey || undefined,
      workspaceCompatibility: versionWorkspaceCompatibility.length > 0
        ? versionWorkspaceCompatibility
        : undefined,
      dependencyReferences: packDefinition.dependencyReferences.length > 0
        ? packDefinition.dependencyReferences
        : undefined,
      packType: packDefinition.packType,
      packKey: packDefinition.packKey,
      semanticVersion,
      schemaVersion: normalizeText(body.schemaVersion || '1.0.0'),
      status: OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT,
      scopeType: scope.scopeType,
      scopeKey: scope.scopeKey,
      contentHash,
      contentFormat,
      sourceAuthority: packDefinition.sourceAuthority,
      sourceFilename: sourceDocument.filename,
      sourceDocuments: [sourceDocument],
      content: extractedText,
      sourceMetadata: {
        importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
        sourceStatus: SOURCE_DOCUMENT_PRESENT_STATUS,
        sourceFilename: sourceDocument.filename,
        sourceDocumentId: sourceDocument.sourceDocumentId,
        sourceHash,
        contentFormat,
        sourceDocument,
        parserStatus: extraction.parserStatus || 'TEXT_CAPTURED',
        extractionMode: extraction.extractionMode || 'DETERMINISTIC_TEXT',
        extractionMethod: extraction.extractionMethod || 'CLIENT_TEXT',
        extractionAdapter: extraction.extractionAdapter || 'knowledge-pack-text-import-v1',
        sourceSizeBytes: extraction.sourceSizeBytes,
        contentPersisted: true,
      },
      validationSummary: {
        status: 'NOT_RUN',
        mode: 'HUMAN_REVIEW_REQUIRED',
        checkedAt: null,
        checks: [],
        issues: [],
      },
      executionMode: packDefinition.executionMode,
      visibility: scope.visibility,
      customerId: scope.customerId,
      tenantId: scope.tenantId,
      authoringMode: KNOWLEDGE_PACK_AUTHORING_MODES.IMPORT_SOURCE_DOCUMENT,
      reviewStatus: KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT,
      uploadedBy: actorUserId || null,
    })
  }

  const useTransaction = canUseSourceImportTransaction()
  const existingPackRecord = useTransaction
    ? null
    : await resolveLeanQuery(KnowledgePack.findOne({ packId: canonicalPackId }))
  let packRecord = null
  let version = null
  let versionPersisted = false
  let packPersisted = false
  let session = null

  const persistSourceImport = async ({ transactionSession = null, versionFirst = false } = {}) => {
    if (versionFirst) {
      version = buildSourceImportVersion(existingPackRecord)
      await saveDocument(version)
      versionPersisted = true
    }

    packRecord = await ensureSourceDocumentDraftPackRecord({
      packDefinition,
      actorUserId,
      versionId,
      semanticVersion,
      scope,
      session: transactionSession,
    })
    packPersisted = true

    if (!versionFirst) {
      version = buildSourceImportVersion(packRecord)
      await saveDocument(version, transactionSession)
      versionPersisted = true
    }

    try {
      await logKnowledgePackAudit({
        auditRequest,
        action: auditService.AUDIT_ACTIONS.OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED,
        actorUserId,
        packRecord,
        packDefinition,
        version,
        session: transactionSession,
        throwOnError: true,
        diff: {
          status: { from: null, to: OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT },
          importMode: 'SOURCE_DOCUMENT_IMPORT_DRAFT',
          sourceStatus: SOURCE_DOCUMENT_PRESENT_STATUS,
          sourceFilename: sourceDocument.filename,
          sourceDocumentId: sourceDocument.sourceDocumentId,
          sourceHash,
          contentFormat,
          contentVisible: false,
          contentIncludedInAudit: false,
          reviewStatus: KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT,
          activationCreated: false,
          ...(duplicateWarnings.length > 0
            ? {
              duplicateOverrideReason,
              duplicateClassifications: [...new Set(
                duplicateWarnings.map((warning) => warning.classification),
              )],
              duplicateCandidatePackIds: [...new Set(
                duplicateWarnings.map((warning) => warning.candidate.packId).filter(Boolean),
              )],
            }
            : {}),
        },
      })
    } catch (err) {
      err.outcomeKnowledgePackAuditFailure = true
      throw err
    }
  }

  try {
    if (useTransaction) {
      session = await mongoose.startSession()
      await session.withTransaction(async () => {
        await persistSourceImport({ transactionSession: session })
      })
    } else {
      await persistSourceImport({ versionFirst: true })
    }
  } catch (err) {
    if (!useTransaction) {
      if (packPersisted) {
        await restoreSourceDocumentImportPackRecord({
          existingPackRecord,
          failedImportPackRecord: packRecord,
          packId: canonicalPackId,
        })
      }
      if (versionPersisted) {
        await KnowledgePackVersion.deleteOne({ versionId })
      }
    }

    if (err?.outcomeKnowledgePackAuditFailure) {
      throwKnowledgePackAuditError(err)
    }
    if (isKnowledgePackVersionDuplicateRace(err)) {
      throw createKnowledgePackError({
        status: 409,
        code: 'CONFLICT',
        message: 'Knowledge pack source document draft already exists for this pack, semantic version, and scope.',
        reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_ALREADY_EXISTS,
        details: {
          packId: canonicalPackId,
          versionId,
          semanticVersion,
          scopeKey: scope.scopeKey,
          conflictSource: 'UNIQUE_INDEX',
        },
      })
    }
    throw err
  } finally {
    await session?.endSession()
  }

  return {
    pack: serializeKnowledgePack(packRecord),
    version: serializeKnowledgePackVersion(version),
  }
}

export const importOutcomeKnowledgePackStarterVersion = async ({
  packId,
} = {}) => {
  throwStarterAuthoringRetiredError({ packId })
}

export const getOutcomeKnowledgePackVersion = async ({ packId, versionId } = {}) => {
  const packRecord = await KnowledgePack.findOne(buildPackLookup(packId)).lean()
  if (!packRecord) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_NOT_FOUND,
      details: { packId },
    })
  }

  const canonicalPackId = normalizeText(packRecord.packId || packId)
  const version = await KnowledgePackVersion.findOne({
    packId: canonicalPackId,
    versionId: normalizeText(versionId),
  }).lean()

  if (!version) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack version was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_NOT_FOUND,
      details: { packId: canonicalPackId, versionId },
    })
  }

  return serializeKnowledgePackVersion(version)
}

export const previewOutcomeKnowledgePackVersionContent = async ({
  packId,
  versionId,
  actorUserId = null,
  auditRequest = null,
} = {}) => {
  const {
    canonicalPackId,
    packDefinition,
    packRecord,
  } = await resolveKnowledgePackContentPreviewContext({ packId })
  const normalizedVersionId = normalizeText(versionId)
  const version = await findKnowledgePackVersionWithContent({
    packId: canonicalPackId,
    versionId: normalizedVersionId,
  })

  if (!version) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack version was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_NOT_FOUND,
      details: { packId: canonicalPackId, versionId },
    })
  }

  const plainVersion = toRawPlainObject(version) || {}
  if (plainVersion.content === undefined || plainVersion.content === null) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack version content is not available for preview.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_CONTENT_NOT_AVAILABLE,
      details: { packId: canonicalPackId, versionId: normalizedVersionId },
    })
  }

  const preview = serializeKnowledgePackContentPreview({
    version,
    packDefinition,
  })
  const auditPackRecord = packRecord || {
    packId: canonicalPackId,
    packType: packDefinition.packType,
    packKey: packDefinition.packKey,
    label: packDefinition.label,
  }

  try {
    await logKnowledgePackAudit({
      auditRequest,
      action: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_CONTENT_PREVIEWED,
      actorUserId,
      packRecord: auditPackRecord,
      packDefinition,
      version,
      throwOnError: true,
      diff: {
        contentFormat: preview.contentFormat,
        sourceFilename: preview.sourceFilename,
        contentLength: preview.contentLength,
        contentVisible: true,
        contentIncludedInAudit: false,
        previewMode: preview.previewMode,
      },
    })
  } catch (err) {
    throwKnowledgePackAuditError(err)
  }

  return preview
}

export const validateOutcomeKnowledgePackVersion = async ({
  packId,
  versionId,
  actorUserId = null,
  auditRequest = null,
} = {}) => {
  const authoringContext = await resolveKnowledgePackAuthoringContext({ packId })
  const {
    canonicalPackId,
    packDefinition,
  } = authoringContext
  const version = await findKnowledgePackVersionWithContent({
    packId: canonicalPackId,
    versionId: normalizeText(versionId),
  })

  if (!version) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack version was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_NOT_FOUND,
      details: { packId: canonicalPackId, versionId },
    })
  }

  const validationSummary = buildSourceDocumentDraftValidationSummary({
    packDefinition,
    packRecord: authoringContext.packRecord,
    version,
  })
  const validationPassed = validationSummary.status === 'PASSED'
  const previousStatus = normalizeToken(version.status || OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT)
  const previousVersionState = {
    status: previousStatus,
    validationSummary: cloneValue(version.validationSummary),
    validatedAt: version.validatedAt || null,
  }
  const previousPackState = {
    status: normalizeToken(authoringContext.packRecord?.status),
    latestVersionId: normalizeText(authoringContext.packRecord?.latestVersionId),
    latestSemanticVersion: normalizeText(authoringContext.packRecord?.latestSemanticVersion),
    updatedBy: authoringContext.packRecord?.updatedBy || null,
  }
  const nextStatus = validationPassed
    ? OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED
    : OUTCOME_KNOWLEDGE_PACK_STATUSES.FAILED_VALIDATION
  let packRecord = null
  let session = null

  const applyValidationMutation = async (transactionSession = null) => {
    version.status = nextStatus
    version.validationSummary = validationSummary
    version.validatedAt = validationPassed ? new Date(validationSummary.checkedAt) : null
    await saveDocument(version, transactionSession)

    packRecord = {
      ...toPlainObject(authoringContext.packRecord),
      status: version.status,
      latestVersionId: version.versionId,
      latestSemanticVersion: version.semanticVersion,
      updatedBy: actorUserId || null,
    }
    await updateKnowledgePackLatestVersion({
      packId: canonicalPackId,
      status: version.status,
      versionId: version.versionId,
      semanticVersion: version.semanticVersion,
      actorUserId,
      session: transactionSession,
    })

    try {
      await logKnowledgePackAudit({
        auditRequest,
        action: validationPassed
          ? auditService.AUDIT_ACTIONS.OUTCOME_KNOWLEDGE_PACK_VERSION_VALIDATED
          : auditService.AUDIT_ACTIONS.OUTCOME_KNOWLEDGE_PACK_VALIDATION_FAILED,
        actorUserId,
        packRecord,
        packDefinition,
        version,
        session: transactionSession,
        throwOnError: true,
        diff: {
          validationSummary,
          status: {
            from: previousStatus,
            to: version.status,
          },
        },
      })
    } catch (err) {
      err.outcomeKnowledgePackAuditFailure = true
      throw err
    }
  }

  try {
    if (mongoose.connection.readyState === 1) {
      session = await mongoose.startSession()
      await session.withTransaction(async () => {
        await applyValidationMutation(session)
      })
    } else {
      await applyValidationMutation()
    }
  } catch (err) {
    version.status = previousVersionState.status
    version.validationSummary = previousVersionState.validationSummary
    version.validatedAt = previousVersionState.validatedAt

    if (err?.outcomeKnowledgePackAuditFailure) {
      if (mongoose.connection.readyState !== 1) {
        await KnowledgePackVersion.updateOne(
          { versionId: version.versionId },
          {
            $set: {
              status: previousVersionState.status,
              validationSummary: previousVersionState.validationSummary,
              validatedAt: previousVersionState.validatedAt,
            },
          },
        )
        await KnowledgePack.updateOne(
          { packId: canonicalPackId },
          { $set: previousPackState },
          { runValidators: true },
        )
      }
      throwKnowledgePackAuditError(err)
    }
    throw err
  } finally {
    await session?.endSession()
  }

  if (!validationPassed) {
    throw createKnowledgePackError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Knowledge pack source validation failed.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_VALIDATION_FAILED,
      details: {
        packId: canonicalPackId,
        versionId: version.versionId,
        validationSummary,
      },
    })
  }

  return {
    pack: serializeKnowledgePack(packRecord),
    version: serializeKnowledgePackVersion(version),
    validationSummary,
  }
}

const REVIEW_TRANSITIONS = Object.freeze({
  [KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT]: new Set([
    KNOWLEDGE_PACK_REVIEW_STATUSES.READY_FOR_REVIEW,
  ]),
  [KNOWLEDGE_PACK_REVIEW_STATUSES.REJECTED]: new Set([
    KNOWLEDGE_PACK_REVIEW_STATUSES.READY_FOR_REVIEW,
  ]),
  [KNOWLEDGE_PACK_REVIEW_STATUSES.READY_FOR_REVIEW]: new Set([
    KNOWLEDGE_PACK_REVIEW_STATUSES.APPROVED,
    KNOWLEDGE_PACK_REVIEW_STATUSES.REJECTED,
  ]),
})

const REVIEW_ACTION_LABELS = Object.freeze({
  [KNOWLEDGE_PACK_REVIEW_STATUSES.READY_FOR_REVIEW]: 'SUBMIT_FOR_REVIEW',
  [KNOWLEDGE_PACK_REVIEW_STATUSES.APPROVED]: 'APPROVE_REVIEW',
  [KNOWLEDGE_PACK_REVIEW_STATUSES.REJECTED]: 'REJECT_REVIEW',
})

const assertKnowledgePackReviewTransitionAllowed = ({
  canonicalPackId,
  requestedReviewStatus,
  version,
}) => {
  const lifecycleStatus = normalizeToken(version.status)
  if (lifecycleStatus !== OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack version must be validated before review status can change.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_REQUIRES_VALIDATED,
      details: {
        packId: canonicalPackId,
        versionId: version.versionId,
        status: lifecycleStatus,
      },
    })
  }

  const previousReviewStatus = normalizeToken(
    version.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT,
  )
  const allowedStatuses = REVIEW_TRANSITIONS[previousReviewStatus] || new Set()
  if (!allowedStatuses.has(requestedReviewStatus)) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack review status transition is not allowed.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_LIFECYCLE_CONFLICT,
      details: {
        packId: canonicalPackId,
        versionId: version.versionId,
        reviewStatus: previousReviewStatus,
        requestedReviewStatus,
      },
    })
  }

  return previousReviewStatus
}

const rollbackKnowledgePackReviewAfterAuditFailure = async ({
  packRecord = null,
  packReviewStatusUpdated = false,
  previousPackReviewStatus,
  previousReviewStatus,
  version,
}) => {
  const rollbackWrites = [
    KnowledgePackVersion.updateOne(
      { versionId: version.versionId },
      { $set: { reviewStatus: previousReviewStatus } },
    ),
  ]

  if (packReviewStatusUpdated && packRecord) {
    rollbackWrites.push(KnowledgePack.updateOne(
      { packId: version.packId },
      { $set: { reviewStatus: previousPackReviewStatus } },
    ))
  }

  await Promise.allSettled(rollbackWrites)
  version.reviewStatus = previousReviewStatus
}

const applyKnowledgePackReviewMutation = async ({
  actorUserId,
  auditRequest,
  packDefinition,
  packRecord,
  requestedReviewStatus,
  version,
  session = null,
}) => {
  const previousReviewStatus = normalizeToken(
    version.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT,
  )
  const previousPackReviewStatus = normalizeToken(
    packRecord?.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT,
  )
  const latestVersionId = normalizeText(packRecord?.latestVersionId)
  const packReviewStatusUpdated = !latestVersionId
    || latestVersionId === normalizeText(version.versionId)

  version.reviewStatus = requestedReviewStatus
  await saveDocument(version, session)

  if (packReviewStatusUpdated) {
    await KnowledgePack.updateOne(
      { packId: version.packId },
      {
        $set: {
          reviewStatus: requestedReviewStatus,
          updatedBy: actorUserId || null,
        },
      },
      {
        runValidators: true,
        ...(session ? { session } : {}),
      },
    )
  }

  const mutationResult = {
    packReviewStatusUpdated,
    previousPackReviewStatus,
    previousReviewStatus,
  }

  try {
    await logKnowledgePackAudit({
      auditRequest,
      action: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_REVIEW_STATUS_UPDATED,
      actorUserId,
      packRecord,
      packDefinition,
      version,
      session,
      throwOnError: true,
      diff: {
        reviewAction: REVIEW_ACTION_LABELS[requestedReviewStatus] || 'UPDATE_REVIEW_STATUS',
        reviewStatus: {
          from: previousReviewStatus,
          to: requestedReviewStatus,
        },
      },
    })
  } catch (err) {
    err.outcomeKnowledgePackAuditFailure = true
    err.reviewResult = mutationResult
    throw err
  }

  return mutationResult
}

export const updateOutcomeKnowledgePackVersionReview = async ({
  packId,
  versionId,
  body = {},
  actorUserId = null,
  auditRequest = null,
} = {}) => {
  const authoringContext = await resolveKnowledgePackAuthoringContext({ packId })
  const {
    canonicalPackId,
    packDefinition,
    packRecord,
  } = authoringContext

  const requestedReviewStatus = normalizeToken(body.reviewStatus)
  const version = await findKnowledgePackVersionWithContent({
    packId: canonicalPackId,
    versionId: normalizeText(versionId),
  })

  if (!version) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack version was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_NOT_FOUND,
      details: { packId: canonicalPackId, versionId },
    })
  }

  assertKnowledgePackReviewTransitionAllowed({
    canonicalPackId,
    requestedReviewStatus,
    version,
  })

  let mutationResult = null
  let session = null

  try {
    if (mongoose.connection.readyState === 1) {
      session = await mongoose.startSession()
      await session.withTransaction(async () => {
        mutationResult = await applyKnowledgePackReviewMutation({
          actorUserId,
          auditRequest,
          packDefinition,
          packRecord,
          requestedReviewStatus,
          version,
          session,
        })
      })
    } else {
      mutationResult = await applyKnowledgePackReviewMutation({
        actorUserId,
        auditRequest,
        packDefinition,
        packRecord,
        requestedReviewStatus,
        version,
      })
    }
  } catch (err) {
    const reviewResult = mutationResult || err?.reviewResult
    if (err?.outcomeKnowledgePackAuditFailure) {
      if (mongoose.connection.readyState !== 1) {
        await rollbackKnowledgePackReviewAfterAuditFailure({
          packRecord,
          packReviewStatusUpdated: reviewResult?.packReviewStatusUpdated === true,
          previousPackReviewStatus: reviewResult?.previousPackReviewStatus,
          previousReviewStatus: reviewResult?.previousReviewStatus,
          version,
        })
      }

      throwKnowledgePackAuditError(err)
    }

    throw err
  } finally {
    await session?.endSession()
  }

  const packReviewStatusUpdated = mutationResult?.packReviewStatusUpdated === true
  return {
    pack: serializeKnowledgePack({
      ...toPlainObject(packRecord),
      ...(packReviewStatusUpdated ? { reviewStatus: requestedReviewStatus } : {}),
    }),
    version: serializeKnowledgePackVersion(version),
  }
}

const applyKnowledgePackActivationMutation = async ({
  activationTime,
  activationIdSuffix = '',
  actorUserId,
  auditAction = auditService.AUDIT_ACTIONS.OUTCOME_KNOWLEDGE_PACK_ACTIVATED,
  auditDiff = {},
  auditRequest,
  packDefinition,
  packRecord,
  scope,
  statusFrom = OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED,
  supersedeReason = '',
  version,
  session = null,
}) => {
  const knowledgeLayer = normalizeToken(version.knowledgeLayer)
  const capabilityKey = normalizeLowerKey(version.capabilityKey)
  const workspaceCompatibility = normalizeTokenList(version.workspaceCompatibility)
  const missingFields = [
    ...(!knowledgeLayer ? ['knowledgeLayer'] : []),
    ...(!capabilityKey ? ['capabilityKey'] : []),
    ...(workspaceCompatibility.length === 0 ? ['workspaceCompatibility'] : []),
  ]

  if (missingFields.length > 0) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack activation requires complete governance metadata.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_ACTIVATION_GOVERNANCE_METADATA_REQUIRED,
      details: {
        packId: version.packId,
        versionId: version.versionId,
        missingFields,
      },
    })
  }

  const packKnowledgeLayer = normalizeToken(packRecord?.knowledgeLayer)
  const packCapabilityKey = normalizeLowerKey(packRecord?.capabilityKey)
  const packWorkspaceCompatibility = normalizeTokenList(packRecord?.workspaceCompatibility)
  const mismatchFields = [
    ...(packKnowledgeLayer && packKnowledgeLayer !== knowledgeLayer ? ['knowledgeLayer'] : []),
    ...(packCapabilityKey && packCapabilityKey !== capabilityKey ? ['capabilityKey'] : []),
    ...(
      packWorkspaceCompatibility.length > 0
      && canonicalizeGovernanceList(packWorkspaceCompatibility)
        !== canonicalizeGovernanceList(workspaceCompatibility)
        ? ['workspaceCompatibility']
        : []
    ),
  ]

  if (mismatchFields.length > 0) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack version governance metadata does not match the pack.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_ACTIVATION_GOVERNANCE_METADATA_MISMATCH,
      details: {
        packId: version.packId,
        versionId: version.versionId,
        mismatchFields,
      },
    })
  }

  const capabilityConflict = await findActiveCapabilityConflict({
    capabilityKey,
    knowledgeLayer,
    packId: version.packId,
    scopeKey: scope.scopeKey,
    session,
  })
  if (capabilityConflict) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'A different Knowledge Pack is already active for this knowledge capability and scope.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_ACTIVE_CAPABILITY_CONFLICT,
      details: {
        packId: version.packId,
        versionId: version.versionId,
        knowledgeLayer,
        capabilityKey,
        scopeKey: scope.scopeKey,
        conflictingActivation: capabilityConflict,
      },
    })
  }

  const previousActivationQuery = KnowledgePackActivation.findOne({
    packType: version.packType,
    packKey: version.packKey,
    scopeKey: scope.scopeKey,
    status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
  }).sort({ activatedAt: -1 })
  const previousActivation = await resolveLeanQuery(withOptionalSession(previousActivationQuery, session))
  const activationId = buildKnowledgePackActivationId({
    packType: version.packType,
    packKey: version.packKey,
    versionId: version.versionId,
    scopeKey: scope.scopeKey,
  }) + (activationIdSuffix ? `-${activationIdSuffix}` : '')
  const activation = new KnowledgePackActivation({
    activationId,
    packId: version.packId,
    versionId: version.versionId,
    packCategory: normalizePackCategory(version.packCategory || packDefinition?.packCategory, version.packType),
    purposeCategory: normalizeToken(
      version.purposeCategory
      || packRecord?.purposeCategory
      || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM,
    ),
    knowledgeLayer,
    capabilityKey,
    workspaceCompatibility,
    ...(Array.isArray(version.dependencyReferences)
      ? { dependencyReferences: normalizeDependencyReferences(version.dependencyReferences) }
      : {}),
    packType: version.packType,
    packKey: version.packKey,
    label: packDefinition?.label || packRecord?.label || version.packKey,
    semanticVersion: version.semanticVersion,
    schemaVersion: version.schemaVersion,
    status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
    scopeType: scope.scopeType,
    scopeKey: scope.scopeKey,
    frameworkKey: scope.frameworkKey,
    runtimeType: scope.runtimeType,
    packageKey: scope.packageKey,
    packageVersion: scope.packageVersion,
    environmentKey: scope.environmentKey,
    executionMode: normalizeToken(
      version.executionMode
      || packRecord?.executionMode
      || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
    ),
    visibility: normalizeToken(
      version.visibility
      || packRecord?.visibility
      || KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM,
    ),
    customerId: version.customerId || packRecord?.customerId || null,
    tenantId: version.tenantId || packRecord?.tenantId || null,
    contentHash: version.contentHash,
    activatedBy: actorUserId || null,
    activatedAt: activationTime,
    replacedActivationId: previousActivation?.activationId || '',
  })

  await KnowledgePackActivation.updateMany(
    {
      packType: version.packType,
      packKey: version.packKey,
      scopeKey: scope.scopeKey,
      status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
    },
    {
      $set: {
        status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ROLLED_BACK,
        rolledBackAt: activationTime,
        rollbackReason: supersedeReason || `Superseded by ${activationId}`,
      },
    },
    {
      runValidators: true,
      ...(session ? { session } : {}),
    },
  )
  try {
    await saveDocument(activation, session)
  } catch (err) {
    err.activationResult = {
      activation,
      previousActivation,
    }
    throw err
  }

  version.status = OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE
  await saveDocument(version, session)
  await updateKnowledgePackLatestVersion({
    packId: version.packId,
    status: OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE,
    versionId: version.versionId,
    semanticVersion: version.semanticVersion,
    actorUserId,
    session,
  })
  const mutationResult = {
    activation,
    previousActivation,
  }

  try {
    await logKnowledgePackAudit({
      auditRequest,
      action: auditAction,
      actorUserId,
      packRecord,
      packDefinition,
      version,
      activation,
      session,
      throwOnError: true,
      diff: {
        status: {
          from: statusFrom,
          to: OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE,
        },
        replacedActivationId: previousActivation?.activationId || '',
        ...auditDiff,
      },
    })
  } catch (err) {
    err.outcomeKnowledgePackAuditFailure = true
    err.activationResult = mutationResult
    throw err
  }

  return mutationResult
}

const rollbackActivationAfterAuditFailure = async ({
  activationId,
  version,
  previousStatus,
  previousPackState,
  previousActivation = null,
}) => {
  const rollbackWrites = [
    KnowledgePackActivation.updateOne(
      { activationId },
      {
        $set: {
          status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ROLLED_BACK,
          rolledBackAt: new Date(),
          rollbackReason: 'Activation audit persistence failed.',
        },
      },
    ),
    KnowledgePackVersion.updateOne(
      { versionId: version.versionId },
      { $set: { status: previousStatus } },
    ),
    KnowledgePack.updateOne(
      { packId: version.packId },
      {
        $set: {
          status: previousPackState.status,
          latestVersionId: previousPackState.latestVersionId,
          latestSemanticVersion: previousPackState.latestSemanticVersion,
          updatedBy: previousPackState.updatedBy,
        },
      },
    ),
  ]

  if (previousActivation?.activationId) {
    rollbackWrites.push(KnowledgePackActivation.updateOne(
      { activationId: previousActivation.activationId },
      {
        $set: {
          status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
          rolledBackAt: null,
          rollbackReason: '',
        },
      },
    ))
  }

  await Promise.allSettled(rollbackWrites)
}

const assertImportedSourceDocumentReadyForActivation = ({
  canonicalPackId,
  packDefinition,
  packRecord,
  version,
}) => {
  const reviewStatus = normalizeToken(version.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT)
  if (reviewStatus !== KNOWLEDGE_PACK_REVIEW_STATUSES.APPROVED) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Imported source-document knowledge pack versions require approved review before activation.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_REVIEW_REQUIRED,
      details: {
        packId: canonicalPackId,
        versionId: version.versionId,
        reviewStatus,
      },
    })
  }

  if (normalizeToken(version.validationSummary?.status) !== 'PASSED') {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Imported source-document knowledge pack versions require passed validation before activation.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_VALIDATION_FAILED,
      details: {
        packId: canonicalPackId,
        versionId: version.versionId,
        validationStatus: normalizeToken(version.validationSummary?.status),
      },
    })
  }

  const validationSummary = buildSourceDocumentDraftValidationSummary({
    packDefinition,
    packRecord,
    version,
  })
  if (validationSummary.status !== 'PASSED') {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Imported source-document knowledge pack source evidence is not activation ready.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_VALIDATION_FAILED,
      details: {
        packId: canonicalPackId,
        versionId: version.versionId,
        validationSummary,
      },
    })
  }
}

export const activateOutcomeKnowledgePackVersion = async ({
  packId,
  versionId,
  body = {},
  actorUserId = null,
  auditRequest = null,
} = {}) => {
  const authoringContext = await resolveKnowledgePackAuthoringContext({ packId })
  const {
    canonicalPackId,
    packDefinition,
  } = authoringContext
  const version = await findKnowledgePackVersionWithContent({
    packId: canonicalPackId,
    versionId: normalizeText(versionId),
  })

  if (!version) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack version was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_NOT_FOUND,
      details: { packId: canonicalPackId, versionId },
    })
  }

  const previousStatus = normalizeToken(version.status)
  if (previousStatus !== OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack version must be validated before activation.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_REQUIRES_VALIDATED,
      details: {
        packId: canonicalPackId,
        versionId: version.versionId,
        status: previousStatus,
      },
    })
  }

  assertImportedSourceDocumentReadyForActivation({
    canonicalPackId,
    packDefinition,
    packRecord: authoringContext.packRecord,
    version,
  })

  const packRecord = authoringContext.packRecord
  const previousPackState = {
    status: normalizeToken(packRecord.status),
    latestVersionId: normalizeText(packRecord.latestVersionId),
    latestSemanticVersion: normalizeText(packRecord.latestSemanticVersion),
    updatedBy: packRecord.updatedBy || null,
  }
  const scope = buildActivationScope(body)
  const activationTime = new Date()
  let activationResult = null
  let session = null

  try {
    if (mongoose.connection.readyState === 1) {
      session = await mongoose.startSession()
      await session.withTransaction(async () => {
        activationResult = await applyKnowledgePackActivationMutation({
          activationTime,
          actorUserId,
          auditRequest,
          packDefinition,
          packRecord,
          scope,
          version,
          session,
        })
      })
    } else {
      activationResult = await applyKnowledgePackActivationMutation({
        activationTime,
        actorUserId,
        auditRequest,
        packDefinition,
        packRecord,
        scope,
        version,
      })
    }
  } catch (err) {
    const rollbackActivationResult = activationResult || err?.activationResult
    if (err?.outcomeKnowledgePackAuditFailure) {
      if (rollbackActivationResult?.activation?.activationId && mongoose.connection.readyState !== 1) {
        await rollbackActivationAfterAuditFailure({
          activationId: rollbackActivationResult.activation.activationId,
          version,
          previousStatus,
          previousPackState,
          previousActivation: rollbackActivationResult.previousActivation,
        })
      }

      throwKnowledgePackAuditError(err)
    }

    if (rollbackActivationResult?.activation?.activationId && mongoose.connection.readyState !== 1) {
      await rollbackActivationAfterAuditFailure({
        activationId: rollbackActivationResult.activation.activationId,
        version,
        previousStatus,
        previousPackState,
        previousActivation: rollbackActivationResult.previousActivation,
      })
    }

    if (isActiveCapabilityConflictRace(err)) {
      throw createKnowledgePackError({
        status: 409,
        code: 'CONFLICT',
        message: 'A different Knowledge Pack became active for this knowledge capability and scope.',
        reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_ACTIVE_CAPABILITY_CONFLICT,
        details: {
          packId: version.packId,
          versionId: version.versionId,
          knowledgeLayer: normalizeToken(version.knowledgeLayer),
          capabilityKey: normalizeLowerKey(version.capabilityKey),
          scopeKey: scope.scopeKey,
          conflictSource: 'UNIQUE_INDEX',
        },
      })
    }

    throw err
  } finally {
    await session?.endSession()
  }

  return {
    pack: serializeKnowledgePack({
      ...toPlainObject(packRecord),
      status: OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE,
      latestVersionId: version.versionId,
      latestSemanticVersion: version.semanticVersion,
    }),
    version: serializeKnowledgePackVersion(version),
    activation: serializeKnowledgePackActivation(activationResult.activation),
    previousActivation: serializeKnowledgePackActivation(activationResult.previousActivation),
  }
}

const shouldUpdateKnowledgePackLifecycleStatus = ({ packRecord, version, previousStatus }) => {
  const latestVersionId = normalizeText(packRecord?.latestVersionId)
  return !latestVersionId
    || latestVersionId === normalizeText(version.versionId)
    || previousStatus === OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE
}

const rollbackKnowledgePackVersionLifecycleAfterAuditFailure = async ({
  activeActivationIds = [],
  packRecord = null,
  packStatusUpdated = false,
  previousStatus,
  version,
}) => {
  const rollbackWrites = [
    KnowledgePackVersion.updateOne(
      { versionId: version.versionId },
      { $set: { status: previousStatus } },
    ),
  ]

  if (activeActivationIds.length > 0) {
    rollbackWrites.push(KnowledgePackActivation.updateMany(
      { activationId: { $in: activeActivationIds } },
      {
        $set: {
          status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
        },
      },
    ))
  }

  if (packStatusUpdated && packRecord) {
    const packSet = {
      status: normalizeToken(packRecord.status || previousStatus),
    }
    if (packRecord.latestVersionId !== undefined) {
      packSet.latestVersionId = normalizeText(packRecord.latestVersionId)
    }
    if (packRecord.latestSemanticVersion !== undefined) {
      packSet.latestSemanticVersion = normalizeText(packRecord.latestSemanticVersion)
    }

    rollbackWrites.push(KnowledgePack.updateOne(
      { packId: version.packId },
      { $set: packSet },
    ))
  }

  await Promise.allSettled(rollbackWrites)
}

const applyKnowledgePackVersionLifecycleMutation = async ({
  activationStatus,
  actorUserId,
  auditAction,
  auditRequest,
  lifecycleAction,
  packDefinition,
  packRecord,
  version,
  versionStatus,
  session = null,
}) => {
  const previousStatus = normalizeToken(version.status)
  const activeActivationsQuery = KnowledgePackActivation.find({
    packId: version.packId,
    versionId: version.versionId,
    status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
  })
  const activeActivations = await resolveLeanQuery(withOptionalSession(activeActivationsQuery, session)) || []
  const activeActivationIds = activeActivations
    .map((activation) => normalizeText(activation.activationId))
    .filter(Boolean)
  const packStatusUpdated = shouldUpdateKnowledgePackLifecycleStatus({
    packRecord,
    version,
    previousStatus,
  })

  version.status = versionStatus
  await saveDocument(version, session)

  if (activeActivationIds.length > 0) {
    await KnowledgePackActivation.updateMany(
      {
        activationId: { $in: activeActivationIds },
        status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
      },
      {
        $set: {
          status: activationStatus,
        },
      },
      {
        runValidators: true,
        ...(session ? { session } : {}),
      },
    )
  }

  if (packStatusUpdated) {
    await updateKnowledgePackLatestVersion({
      packId: version.packId,
      status: versionStatus,
      versionId: version.versionId,
      semanticVersion: version.semanticVersion,
      actorUserId,
      session,
    })
  }

  const mutationResult = {
    activeActivationIds,
    packStatusUpdated,
    previousStatus,
  }

  try {
    await logKnowledgePackAudit({
      auditRequest,
      action: auditAction,
      actorUserId,
      packRecord,
      packDefinition,
      version,
      session,
      throwOnError: true,
      diff: {
        lifecycleAction,
        status: {
          from: previousStatus,
          to: versionStatus,
        },
        activationStatus: {
          from: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
          to: activationStatus,
        },
        affectedActivationIds: activeActivationIds,
      },
    })
  } catch (err) {
    err.outcomeKnowledgePackAuditFailure = true
    err.lifecycleResult = mutationResult
    throw err
  }

  return mutationResult
}

const updateOutcomeKnowledgePackVersionLifecycle = async ({
  packId,
  versionId,
  actorUserId = null,
  auditRequest = null,
  lifecycleAction,
  versionStatus,
  activationStatus,
  auditAction,
  allowedPreviousStatuses,
} = {}) => {
  const authoringContext = await resolveKnowledgePackAuthoringContext({ packId })
  const {
    canonicalPackId,
    packDefinition,
    packRecord,
  } = authoringContext
  const version = await findKnowledgePackVersionWithContent({
    packId: canonicalPackId,
    versionId: normalizeText(versionId),
  })

  if (!version) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack version was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_NOT_FOUND,
      details: { packId: canonicalPackId, versionId },
    })
  }

  const previousStatus = normalizeToken(version.status)
  if (previousStatus === versionStatus || !allowedPreviousStatuses.has(previousStatus)) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: `Knowledge pack version cannot be ${lifecycleAction.toLowerCase()}d from its current lifecycle status.`,
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_LIFECYCLE_CONFLICT,
      details: {
        packId: canonicalPackId,
        versionId: version.versionId,
        status: previousStatus,
        requestedStatus: versionStatus,
      },
    })
  }

  let mutationResult = null
  let session = null

  try {
    if (mongoose.connection.readyState === 1) {
      session = await mongoose.startSession()
      await session.withTransaction(async () => {
        mutationResult = await applyKnowledgePackVersionLifecycleMutation({
          activationStatus,
          actorUserId,
          auditAction,
          auditRequest,
          lifecycleAction,
          packDefinition,
          packRecord,
          version,
          versionStatus,
          session,
        })
      })
    } else {
      mutationResult = await applyKnowledgePackVersionLifecycleMutation({
        activationStatus,
        actorUserId,
        auditAction,
        auditRequest,
        lifecycleAction,
        packDefinition,
        packRecord,
        version,
        versionStatus,
      })
    }
  } catch (err) {
    const lifecycleResult = mutationResult || err?.lifecycleResult
    if (err?.outcomeKnowledgePackAuditFailure) {
      if (mongoose.connection.readyState !== 1) {
        await rollbackKnowledgePackVersionLifecycleAfterAuditFailure({
          activeActivationIds: lifecycleResult?.activeActivationIds || [],
          packRecord,
          packStatusUpdated: lifecycleResult?.packStatusUpdated === true,
          previousStatus,
          version,
        })
      }

      throwKnowledgePackAuditError(err)
    }

    throw err
  } finally {
    await session?.endSession()
  }

  const packStatusUpdated = mutationResult?.packStatusUpdated === true
  return {
    pack: serializeKnowledgePack({
      ...toPlainObject(packRecord),
      ...(packStatusUpdated ? {
        status: versionStatus,
        latestVersionId: version.versionId,
        latestSemanticVersion: version.semanticVersion,
      } : {}),
    }),
    version: serializeKnowledgePackVersion(version),
    affectedActivationIds: mutationResult?.activeActivationIds || [],
  }
}

export const deprecateOutcomeKnowledgePackVersion = (args = {}) =>
  updateOutcomeKnowledgePackVersionLifecycle({
    ...args,
    lifecycleAction: 'DEPRECATE',
    versionStatus: OUTCOME_KNOWLEDGE_PACK_STATUSES.DEPRECATED,
    activationStatus: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.DEPRECATED,
    auditAction: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_DEPRECATED,
    allowedPreviousStatuses: new Set([
      OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED,
      OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE,
    ]),
  })

export const disableOutcomeKnowledgePackVersion = (args = {}) =>
  updateOutcomeKnowledgePackVersionLifecycle({
    ...args,
    lifecycleAction: 'DISABLE',
    versionStatus: OUTCOME_KNOWLEDGE_PACK_STATUSES.DISABLED,
    activationStatus: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.DISABLED,
    auditAction: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_DISABLED,
    allowedPreviousStatuses: new Set([
      OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT,
      OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATING,
      OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED,
      OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE,
      OUTCOME_KNOWLEDGE_PACK_STATUSES.DEPRECATED,
      OUTCOME_KNOWLEDGE_PACK_STATUSES.FAILED_VALIDATION,
      OUTCOME_KNOWLEDGE_PACK_STATUSES.ROLLED_BACK,
    ]),
  })

export const rollbackOutcomeKnowledgePack = async ({
  packId,
  body = {},
  actorUserId = null,
  auditRequest = null,
} = {}) => {
  const authoringContext = await resolveKnowledgePackAuthoringContext({ packId })
  const {
    canonicalPackId,
    packDefinition,
    packRecord,
  } = authoringContext
  const targetVersion = await findKnowledgePackVersionWithContent({
    packId: canonicalPackId,
    versionId: normalizeText(body.versionId),
  })

  if (!targetVersion) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack rollback target version was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_NOT_FOUND,
      details: { packId: canonicalPackId, versionId: body.versionId },
    })
  }

  const previousStatus = normalizeToken(targetVersion.status)
  if (!ROLLBACK_ELIGIBLE_VERSION_STATUSES.has(previousStatus)) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack rollback target must be a validated version.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_REQUIRES_VALIDATED,
      details: {
        packId: canonicalPackId,
        versionId: targetVersion.versionId,
        status: previousStatus,
      },
    })
  }

  assertImportedSourceDocumentReadyForActivation({
    canonicalPackId,
    packDefinition,
    packRecord,
    version: targetVersion,
  })

  const scope = buildActivationScope(body)
  const activeActivationQuery = KnowledgePackActivation.findOne({
    packType: targetVersion.packType,
    packKey: targetVersion.packKey,
    scopeKey: scope.scopeKey,
    status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
  }).sort({ activatedAt: -1 })
  const activeActivation = await resolveLeanQuery(activeActivationQuery)

  if (!activeActivation) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack rollback requires an active activation in the requested scope.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_ACTIVE_ACTIVATION_NOT_FOUND,
      details: {
        packId: canonicalPackId,
        versionId: targetVersion.versionId,
        scopeKey: scope.scopeKey,
      },
    })
  }

  if (normalizeText(activeActivation.versionId) === normalizeText(targetVersion.versionId)) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack rollback target is already active in the requested scope.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_LIFECYCLE_CONFLICT,
      details: {
        packId: canonicalPackId,
        versionId: targetVersion.versionId,
        scopeKey: scope.scopeKey,
      },
    })
  }

  const activationTime = new Date()
  const previousPackState = {
    status: normalizeToken(packRecord.status),
    latestVersionId: normalizeText(packRecord.latestVersionId),
    latestSemanticVersion: normalizeText(packRecord.latestSemanticVersion),
    updatedBy: packRecord.updatedBy || null,
  }
  const rollbackReason = normalizeText(body.rollbackReason)
    || `Rollback from ${activeActivation.versionId} to ${targetVersion.versionId}`
  let activationResult = null
  let session = null

  try {
    const activationMutation = {
      activationTime,
      activationIdSuffix: `rollback-${activationTime.getTime()}-${crypto.randomBytes(3).toString('hex')}`,
      actorUserId,
      auditAction: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_ROLLED_BACK,
      auditDiff: {
        rollbackFromActivationId: normalizeText(activeActivation.activationId),
        rollbackFromVersionId: normalizeText(activeActivation.versionId),
        rollbackReason,
      },
      auditRequest,
      packDefinition,
      packRecord,
      scope,
      statusFrom: previousStatus,
      supersedeReason: rollbackReason,
      version: targetVersion,
    }

    if (mongoose.connection.readyState === 1) {
      session = await mongoose.startSession()
      await session.withTransaction(async () => {
        activationResult = await applyKnowledgePackActivationMutation({
          ...activationMutation,
          session,
        })
      })
    } else {
      activationResult = await applyKnowledgePackActivationMutation(activationMutation)
    }
  } catch (err) {
    const rollbackActivationResult = activationResult || err?.activationResult
    if (err?.outcomeKnowledgePackAuditFailure) {
      if (rollbackActivationResult?.activation?.activationId && mongoose.connection.readyState !== 1) {
        await rollbackActivationAfterAuditFailure({
          activationId: rollbackActivationResult.activation.activationId,
          version: targetVersion,
          previousStatus,
          previousPackState,
          previousActivation: rollbackActivationResult.previousActivation,
        })
      }

      throwKnowledgePackAuditError(err)
    }

    if (rollbackActivationResult?.activation?.activationId && mongoose.connection.readyState !== 1) {
      await rollbackActivationAfterAuditFailure({
        activationId: rollbackActivationResult.activation.activationId,
        version: targetVersion,
        previousStatus,
        previousPackState,
        previousActivation: rollbackActivationResult.previousActivation,
      })
    }

    throw err
  } finally {
    await session?.endSession()
  }

  return {
    pack: serializeKnowledgePack({
      ...toPlainObject(packRecord),
      status: OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE,
      latestVersionId: targetVersion.versionId,
      latestSemanticVersion: targetVersion.semanticVersion,
    }),
    version: serializeKnowledgePackVersion(targetVersion),
    activation: serializeKnowledgePackActivation(activationResult.activation),
    previousActivation: serializeKnowledgePackActivation(activationResult.previousActivation),
  }
}

const buildManifestPackReferenceFilter = ({ packType, packKey } = {}) => {
  const normalizedPackType = normalizeToken(packType)
  const normalizedPackKey = normalizeLowerKey(packKey)
  const sectionFilters = [
    'mandatoryPacks',
    'optionalPacks',
    'validationPacks',
    'blockedPacks',
  ].map((section) => ({
    [section]: {
      $elemMatch: {
        packType: normalizedPackType,
        packKey: normalizedPackKey,
      },
    },
  }))

  return { $or: sectionFilters }
}

const findManifestReferenceSample = async ({ filter, session = null } = {}) => {
  const query = KnowledgePackManifest.find(filter).limit(5)
  return resolveLeanQuery(withOptionalSession(query, session))
}

const buildPackDeleteEligibility = async ({ packRecord, session = null } = {}) => {
  const canonicalPackId = normalizeText(packRecord?.packId)
  const packType = normalizeToken(packRecord?.packType)
  const packKey = normalizeLowerKey(packRecord?.packKey)
  const manifestFilter = buildManifestPackReferenceFilter({ packType, packKey })
  const versionCount = await countDocumentsWithOptionalSession(KnowledgePackVersion, { packId: canonicalPackId }, session)
  const activationCount = await countDocumentsWithOptionalSession(KnowledgePackActivation, { packId: canonicalPackId }, session)
  const activeActivationCount = await countDocumentsWithOptionalSession(KnowledgePackActivation, {
    packId: canonicalPackId,
    status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
  }, session)
  const manifestReferenceCount = await countDocumentsWithOptionalSession(KnowledgePackManifest, manifestFilter, session)

  return {
    activeActivationCount,
    activationCount,
    isSystem: packRecord?.isSystem === true,
    manifestFilter,
    manifestReferenceCount,
    packId: canonicalPackId,
    packKey,
    packType,
    status: normalizeToken(packRecord?.status),
    versionCount,
  }
}

const assertKnowledgePackCanBeDeleted = async ({
  eligibility,
  session = null,
} = {}) => {
  if (eligibility.isSystem) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'System knowledge packs cannot be deleted.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_DELETE_BLOCKED_SYSTEM,
      details: {
        packId: eligibility.packId,
        packType: eligibility.packType,
        packKey: eligibility.packKey,
      },
    })
  }

  if (
    eligibility.status === OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE
    || eligibility.activeActivationCount > 0
  ) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Active knowledge packs cannot be deleted. Disable or deprecate the active version first.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_DELETE_BLOCKED_ACTIVE,
      details: {
        packId: eligibility.packId,
        packType: eligibility.packType,
        packKey: eligibility.packKey,
        status: eligibility.status,
        activeActivationCount: eligibility.activeActivationCount,
      },
    })
  }

  if (eligibility.manifestReferenceCount > 0) {
    const referencedManifests = await findManifestReferenceSample({
      filter: eligibility.manifestFilter,
      session,
    }) || []

    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge packs referenced by manifests cannot be deleted.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_DELETE_BLOCKED_MANIFEST_BOUND,
      details: {
        packId: eligibility.packId,
        packType: eligibility.packType,
        packKey: eligibility.packKey,
        manifestReferenceCount: eligibility.manifestReferenceCount,
        manifestIds: referencedManifests
          .map((manifest) => normalizeText(manifest.manifestId))
          .filter(Boolean),
      },
    })
  }
}

const applyKnowledgePackHardDelete = async ({
  actorUserId,
  auditRequest,
  eligibility,
  packRecord,
  session,
}) => {
  const packDefinition = buildPersistedPackDefinition(packRecord)
  const deletionSummary = {
    packId: eligibility.packId,
    packType: eligibility.packType,
    packKey: eligibility.packKey,
    status: eligibility.status,
    expectedVersionCount: eligibility.versionCount,
    expectedActivationCount: eligibility.activationCount,
    manifestReferenceCount: eligibility.manifestReferenceCount,
    hardDelete: true,
  }

  try {
    await logKnowledgePackAudit({
      auditRequest,
      action: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_DELETED,
      actorUserId,
      packRecord,
      packDefinition,
      session,
      throwOnError: true,
      diff: deletionSummary,
    })
  } catch (err) {
    err.outcomeKnowledgePackAuditFailure = true
    throw err
  }

  const versionDeleteResult = await KnowledgePackVersion.deleteMany(
    { packId: eligibility.packId },
    { session },
  )
  const activationDeleteResult = await KnowledgePackActivation.deleteMany(
    { packId: eligibility.packId },
    { session },
  )
  const packDeleteResult = await KnowledgePack.deleteOne(
    { packId: eligibility.packId },
    { session },
  )

  if (Number(packDeleteResult?.deletedCount) !== 1) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack delete could not be completed because the pack changed during the request.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_DELETE_CONFLICT,
      details: {
        packId: eligibility.packId,
      },
    })
  }

  return {
    deletedCounts: {
      packs: Number(packDeleteResult?.deletedCount) || 0,
      versions: Number(versionDeleteResult?.deletedCount) || 0,
      activations: Number(activationDeleteResult?.deletedCount) || 0,
    },
  }
}

export const deleteOutcomeKnowledgePack = async ({
  packId,
  actorUserId = null,
  auditRequest = null,
} = {}) => {
  const packRecord = await KnowledgePack.findOne(buildPackLookup(packId)).lean()

  if (!packRecord || !packRecordMatchesLookup(packRecord, packId)) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_NOT_FOUND,
      details: { packId },
    })
  }

  const initialEligibility = await buildPackDeleteEligibility({ packRecord })
  await assertKnowledgePackCanBeDeleted({ eligibility: initialEligibility })

  if (mongoose.connection.readyState !== 1) {
    throw createKnowledgePackError({
      status: 503,
      code: 'OUTCOME_KNOWLEDGE_PACK_DELETE_UNAVAILABLE',
      message: 'Knowledge pack delete requires transactional registry persistence.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_DELETE_TRANSACTION_REQUIRED,
      details: {
        packId: initialEligibility.packId,
      },
    })
  }

  let deleteResult = null
  let session = null

  try {
    session = await mongoose.startSession()
    await session.withTransaction(async () => {
      const transactionalPackRecord = await resolveLeanQuery(withOptionalSession(
        KnowledgePack.findOne({ packId: initialEligibility.packId }),
        session,
      ))

      if (!transactionalPackRecord) {
        throw createKnowledgePackError({
          status: 404,
          code: 'NOT_FOUND',
          message: 'Outcome Studio knowledge pack was not found.',
          reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_NOT_FOUND,
          details: { packId: initialEligibility.packId },
        })
      }

      const transactionalEligibility = await buildPackDeleteEligibility({
        packRecord: transactionalPackRecord,
        session,
      })
      await assertKnowledgePackCanBeDeleted({
        eligibility: transactionalEligibility,
        session,
      })

      deleteResult = await applyKnowledgePackHardDelete({
        actorUserId,
        auditRequest,
        eligibility: transactionalEligibility,
        packRecord: transactionalPackRecord,
        session,
      })
    })
  } catch (err) {
    if (err?.outcomeKnowledgePackAuditFailure) {
      throwKnowledgePackAuditError(err)
    }

    throw err
  } finally {
    await session?.endSession()
  }

  return {
    deleted: true,
    packId: initialEligibility.packId,
    packType: initialEligibility.packType,
    packKey: initialEligibility.packKey,
    deletedCounts: deleteResult?.deletedCounts || {
      packs: 0,
      versions: 0,
      activations: 0,
    },
  }
}

export const previewOutcomeKnowledgePackResolution = async ({ query = {} } = {}) => {
  const binding = await resolveOutcomeStudioKnowledgePacks({
    frameworkKey: query.frameworkKey,
    runtimeType: query.runtimeType,
    packageKey: query.packageKey,
    packageVersion: query.packageVersion,
    environmentKey: query.environmentKey,
  })

  return {
    ...cloneValue(binding),
    previewOnly: true,
    contentVisible: false,
  }
}
