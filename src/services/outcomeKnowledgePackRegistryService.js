import crypto from 'node:crypto'
import mongoose from 'mongoose'
import {
  KnowledgePack,
  KnowledgePackActivation,
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
  OUTCOME_KNOWLEDGE_PACK_SOURCE_BUNDLE_PATH,
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_TYPES,
} from '../constants/outcomeKnowledgePacks.js'
import { OUTCOME_KNOWLEDGE_PACK_STARTER_SOURCES } from '../constants/outcomeKnowledgePackStarterSources.js'
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
import { resolveKnowledgePackCategory } from '../constants/workspaceGovernance.js'
import { escapeRegex } from '../utils/controllerUtils.js'
import auditService from './auditService.js'
import {
  extractKnowledgePackSourceDocumentText,
  SOURCE_DOCUMENT_EXTRACTION_ERRORS,
} from './knowledgePackSourceDocumentExtractionService.js'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()
const normalizePackCategory = (value, packType) =>
  resolveKnowledgePackCategory({ packCategory: value, packType })

export const OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS = Object.freeze({
  AUDIT_PERSISTENCE_FAILED: 'AUDIT_PERSISTENCE_FAILED',
  PACK_SOURCE_NOT_AVAILABLE: 'PACK_SOURCE_NOT_AVAILABLE',
  PACK_SOURCE_FORMAT_UNSUPPORTED: 'PACK_SOURCE_FORMAT_UNSUPPORTED',
  PACK_SOURCE_EXTRACTION_REQUIRED: 'PACK_SOURCE_EXTRACTION_REQUIRED',
  PACK_SOURCE_EXTRACTION_FAILED: 'PACK_SOURCE_EXTRACTION_FAILED',
  PACK_SOURCE_TEXT_REQUIRED: 'PACK_SOURCE_TEXT_REQUIRED',
  PACK_NOT_FOUND: 'PACK_NOT_FOUND',
  PACK_ACTIVE_ACTIVATION_NOT_FOUND: 'PACK_ACTIVE_ACTIVATION_NOT_FOUND',
  PACK_VERSION_ALREADY_EXISTS: 'PACK_VERSION_ALREADY_EXISTS',
  PACK_VERSION_NOT_FOUND: 'PACK_VERSION_NOT_FOUND',
  PACK_VERSION_LIFECYCLE_CONFLICT: 'PACK_VERSION_LIFECYCLE_CONFLICT',
  PACK_VERSION_CONTENT_NOT_AVAILABLE: 'PACK_VERSION_CONTENT_NOT_AVAILABLE',
  PACK_VERSION_REQUIRES_VALIDATED: 'PACK_VERSION_REQUIRES_VALIDATED',
  PACK_VERSION_REVIEW_REQUIRED: 'PACK_VERSION_REVIEW_REQUIRED',
  PACK_VERSION_VALIDATION_FAILED: 'PACK_VERSION_VALIDATION_FAILED',
  UNSUPPORTED_SCOPE_TYPE: 'UNSUPPORTED_SCOPE_TYPE',
})

const STARTER_SOURCE_STATUS = 'SOURCE_ONLY'
const SOURCE_DOCUMENT_PRESENT_STATUS = 'SOURCE_DOCUMENT_PRESENT'
const SOURCE_VALIDATION_MODE = 'SOURCE_ONLY_TEXT_VALIDATION'
const SUPPORTED_SOURCE_PACK_KEYS = new Set(
  OUTCOME_STUDIO_REQUIRED_PACKS
    .filter((pack) => pack.sourceStatus === STARTER_SOURCE_STATUS)
    .map((pack) => `${pack.packType}:${pack.packKey}`),
)
const SEMANTIC_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const AUDIT_FALLBACK_OBJECT_ID = '000000000000000000000000'
const ROLLBACK_ELIGIBLE_VERSION_STATUSES = new Set([
  OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED,
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

const findRequiredPackDefinition = (packId) => {
  const normalizedPackId = normalizeText(packId)
  const normalizedPackKey = normalizeLowerKey(normalizedPackId)

  for (const pack of OUTCOME_STUDIO_REQUIRED_PACKS) {
    const generatedPackId = buildKnowledgePackId(pack)
    if (
      normalizedPackId === generatedPackId
      || normalizedPackKey === normalizeLowerKey(pack.packKey)
      || normalizedPackKey === normalizeLowerKey(`${pack.packType}:${pack.packKey}`)
    ) {
      return pack
    }
  }

  return null
}

const getSourceBackedPackDefinitionOrThrow = (packId) => {
  const packDefinition = findRequiredPackDefinition(packId)
  if (!packDefinition) {
    throw createKnowledgePackError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio knowledge pack was not found.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_NOT_FOUND,
      details: { packId },
    })
  }

  const requiredPackKey = `${packDefinition.packType}:${packDefinition.packKey}`
  if (!SUPPORTED_SOURCE_PACK_KEYS.has(requiredPackKey)) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'This Outcome Studio knowledge pack does not have an importable starter source in the current bundle.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_NOT_AVAILABLE,
      details: {
        packType: packDefinition.packType,
        packKey: packDefinition.packKey,
      },
    })
  }

  return packDefinition
}

const buildStarterPackSourceMetadata = ({ packDefinition, sourceFilename }) => ({
  sourceStatus: STARTER_SOURCE_STATUS,
  sourcePath: OUTCOME_KNOWLEDGE_PACK_SOURCE_BUNDLE_PATH,
  sourceFilename,
  importedFrom: 'OES-002 starter knowledge pack bundle',
})

const buildPackUpsertPayload = ({ packDefinition, actorUserId, versionId, semanticVersion, status }) => ({
  $setOnInsert: {
    packId: buildKnowledgePackId(packDefinition),
    packCategory: normalizePackCategory(packDefinition.packCategory, packDefinition.packType),
    packType: packDefinition.packType,
    packKey: packDefinition.packKey,
    description: `${packDefinition.label} starter knowledge pack for Outcome Studio.`,
    isSystem: true,
    createdBy: actorUserId || null,
  },
  $set: {
    packCategory: normalizePackCategory(packDefinition.packCategory, packDefinition.packType),
    label: packDefinition.label,
    updatedBy: actorUserId || null,
    sourceMetadata: buildStarterPackSourceMetadata({
      packDefinition,
      sourceFilename: packDefinition.sourceFilename,
    }),
    ...(status ? { status } : {}),
    ...(versionId ? { latestVersionId: versionId } : {}),
    ...(semanticVersion ? { latestSemanticVersion: semanticVersion } : {}),
  },
})

const ensureStarterPackRecord = async ({
  packDefinition,
  actorUserId,
  versionId = '',
  semanticVersion = '',
  status = '',
  session = null,
} = {}) => KnowledgePack.findOneAndUpdate(
  { packId: buildKnowledgePackId(packDefinition) },
  buildPackUpsertPayload({
    packDefinition,
    actorUserId,
    versionId,
    semanticVersion,
    status,
  }),
  {
    upsert: true,
    new: true,
    runValidators: true,
    setDefaultsOnInsert: true,
    ...(session ? { session } : {}),
  },
)

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

const buildValidationCheck = ({ code, passed, message }) => ({
  code,
  status: passed ? 'PASSED' : 'FAILED',
  message,
})

const contentIncludes = (content, needle) =>
  String(content || '').toLowerCase().includes(String(needle || '').toLowerCase())

const buildStarterPackValidationSummary = ({ packDefinition, content }) => {
  const text = String(content || '')
  const expectedKey = packDefinition.packKey
  const commonChecks = [
    buildValidationCheck({
      code: 'PACK_KEY_MATCH',
      passed: contentIncludes(text, `key: ${expectedKey}`),
      message: `Source must declare pack key ${expectedKey}.`,
    }),
    buildValidationCheck({
      code: 'PACK_SECTION_PRESENT',
      passed: contentIncludes(text, 'pack:'),
      message: 'Source must include a pack metadata section.',
    }),
    buildValidationCheck({
      code: 'CUSTOMER_SAFE_BOUNDARY_PRESENT',
      passed: contentIncludes(text, 'must not') || contentIncludes(text, 'prohibited'),
      message: 'Source must preserve explicit prohibited-output boundaries.',
    }),
  ]

  const typeChecksByPackType = {
    [OUTCOME_KNOWLEDGE_PACK_TYPES.ARL]: [
      buildValidationCheck({
        code: 'REASONING_STAGES_PRESENT',
        passed: contentIncludes(text, 'reasoning_stages:'),
        message: 'ARL pack must include reasoning stages.',
      }),
      buildValidationCheck({
        code: 'TRUTH_BINDING_RULES_PRESENT',
        passed: contentIncludes(text, 'truth_binding_rules:'),
        message: 'ARL pack must include truth binding rules.',
      }),
      buildValidationCheck({
        code: 'SAFETY_GATES_PRESENT',
        passed: contentIncludes(text, 'safety_gates:'),
        message: 'ARL pack must include safety gates.',
      }),
      buildValidationCheck({
        code: 'HIDDEN_REASONING_BOUNDARY_PRESENT',
        passed: contentIncludes(text, 'hidden_from_customer:'),
        message: 'ARL pack must include hidden-from-customer boundaries.',
      }),
    ],
    [OUTCOME_KNOWLEDGE_PACK_TYPES.RL]: [
      buildValidationCheck({
        code: 'RENDERING_RULES_PRESENT',
        passed: contentIncludes(text, 'rendering_rules:'),
        message: 'RL pack must include rendering rules.',
      }),
      buildValidationCheck({
        code: 'CUSTOMER_SAFE_OUTPUT_PRESENT',
        passed: contentIncludes(text, 'customer_safe_output:'),
        message: 'RL pack must define customer-safe output rules.',
      }),
      buildValidationCheck({
        code: 'EXPORT_RULES_PRESENT',
        passed: contentIncludes(text, 'export_rules:'),
        message: 'RL pack must include export rules.',
      }),
      buildValidationCheck({
        code: 'NO_INTERNAL_REASONING_PRESENT',
        passed: contentIncludes(text, 'no_internal_reasoning'),
        message: 'RL pack must block internal reasoning disclosure.',
      }),
    ],
    [OUTCOME_KNOWLEDGE_PACK_TYPES.OUTPUT_SCHEMA]: [
      buildValidationCheck({
        code: 'SCHEMAS_PRESENT',
        passed: contentIncludes(text, 'schemas:'),
        message: 'Output Schema pack must include schemas.',
      }),
      buildValidationCheck({
        code: 'EXECUTIVE_BRIEF_PRESENT',
        passed: contentIncludes(text, 'EXECUTIVE_BRIEF:'),
        message: 'Output Schema pack must include the Executive Brief schema.',
      }),
      buildValidationCheck({
        code: 'REQUIRED_SECTIONS_PRESENT',
        passed: contentIncludes(text, 'required_sections:'),
        message: 'Output Schema pack must define required sections.',
      }),
      buildValidationCheck({
        code: 'LINEAGE_RULE_PRESENT',
        passed: contentIncludes(text, 'lineage summary') || contentIncludes(text, 'lineage_summary'),
        message: 'Output Schema pack must preserve lineage summary requirements.',
      }),
    ],
    [OUTCOME_KNOWLEDGE_PACK_TYPES.TRUTH_CERTIFICATION]: [
      buildValidationCheck({
        code: 'CERTIFICATION_LEVELS_PRESENT',
        passed: contentIncludes(text, 'certification_levels:'),
        message: 'Truth Certification pack must include certification levels.',
      }),
      buildValidationCheck({
        code: 'BLOCKING_RULES_PRESENT',
        passed: contentIncludes(text, 'blocking_rules:'),
        message: 'Truth Certification pack must include blocking rules.',
      }),
      buildValidationCheck({
        code: 'WARNINGS_PRESENT',
        passed: contentIncludes(text, 'warnings:'),
        message: 'Truth Certification pack must include warnings.',
      }),
      buildValidationCheck({
        code: 'CERTIFIED_TRUTH_PRESENT',
        passed: contentIncludes(text, 'CERTIFIED_TRUTH:'),
        message: 'Truth Certification pack must include Certified Truth rules.',
      }),
    ],
    [OUTCOME_KNOWLEDGE_PACK_TYPES.OUTPUT_TYPE_DEFINITION]: [
      buildValidationCheck({
        code: 'OUTPUT_TYPES_PRESENT',
        passed: contentIncludes(text, 'output_types:'),
        message: 'Output Type Definition pack must include output types.',
      }),
      buildValidationCheck({
        code: 'ASSET_TYPES_PRESENT',
        passed: contentIncludes(text, 'asset_types:'),
        message: 'Output Type Definition pack must include derived asset types.',
      }),
      buildValidationCheck({
        code: 'SUPPORTED_FORMATS_PRESENT',
        passed: contentIncludes(text, 'supported_formats:'),
        message: 'Output Type Definition pack must include supported formats.',
      }),
      buildValidationCheck({
        code: 'PUBLISH_REQUIREMENTS_PRESENT',
        passed: contentIncludes(text, 'publish_requirements:'),
        message: 'Output Type Definition pack must include publish requirements.',
      }),
    ],
  }

  const typeChecks = typeChecksByPackType[packDefinition.packType] || []

  const checks = [...commonChecks, ...typeChecks]
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

const getValidatedSourceFilename = ({ packDefinition, sourceFilename }) => {
  const normalized = normalizeText(sourceFilename || packDefinition.sourceFilename)
  if (normalized !== packDefinition.sourceFilename) {
    throw createKnowledgePackError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Source filename does not match the known starter knowledge pack source.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_VALIDATION_FAILED,
      details: {
        field: 'sourceFilename',
        expected: packDefinition.sourceFilename,
        received: normalized,
      },
    })
  }

  return normalized
}

const getStarterSourceKey = (packDefinition = {}) =>
  `${normalizeToken(packDefinition.packType)}:${normalizeLowerKey(packDefinition.packKey)}`

const getStarterSourceForPackDefinitionOrThrow = (packDefinition) => {
  const source = OUTCOME_KNOWLEDGE_PACK_STARTER_SOURCES[getStarterSourceKey(packDefinition)]
  if (!source) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'This Outcome Studio knowledge pack does not have an importable starter source in the current bundle.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_NOT_AVAILABLE,
      details: {
        packType: packDefinition.packType,
        packKey: packDefinition.packKey,
      },
    })
  }

  return {
    ...source,
    sourceFilename: getValidatedSourceFilename({
      packDefinition,
      sourceFilename: source.sourceFilename,
    }),
    content: String(source.content || '').trim(),
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

const rollbackStarterImportAfterAuditFailure = async ({
  canonicalPackId,
  existingPackRecord = null,
  versionId,
}) => {
  const rollbackWrites = [
    KnowledgePackVersion.deleteOne({ versionId }),
  ]

  if (existingPackRecord) {
    const existingPack = toPlainObject(existingPackRecord) || {}
    const restoreSet = {
      status: normalizeToken(existingPack.status || OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT),
    }
    const restoreUnset = {}
    const fieldsToRestore = [
      'latestVersionId',
      'latestSemanticVersion',
      'packCategory',
      'label',
      'description',
      'sourceMetadata',
      'updatedBy',
    ]

    fieldsToRestore.forEach((field) => {
      if (existingPack[field] !== undefined) restoreSet[field] = existingPack[field]
      else if (field === 'packCategory') restoreUnset[field] = ''
    })

    const restoreUpdate = {
      $set: restoreSet,
      ...(Object.keys(restoreUnset).length ? { $unset: restoreUnset } : {}),
    }

    rollbackWrites.push(KnowledgePack.updateOne(
      { packId: canonicalPackId },
      restoreUpdate,
    ))
  } else if (typeof KnowledgePack.deleteOne === 'function') {
    rollbackWrites.push(KnowledgePack.deleteOne({ packId: canonicalPackId }))
  }

  await Promise.allSettled(rollbackWrites)
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
    packType: normalizeToken(plain.packType),
    packKey: normalizeLowerKey(plain.packKey),
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
    packType: normalizeToken(plain.packType),
    packKey: normalizeLowerKey(plain.packKey),
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

const buildSourceBackedPackFilter = () => ({
  $or: OUTCOME_STUDIO_REQUIRED_PACKS
    .filter((pack) => pack.sourceStatus === STARTER_SOURCE_STATUS)
    .map((pack) => ({
      packType: pack.packType,
      packKey: pack.packKey,
    })),
})

const buildSourcePackRecordMap = (registryPacks = []) => new Map(
  registryPacks
    .map((pack) => [getStarterSourceKey(pack), pack])
    .filter(([key]) => key !== ':'),
)

const buildOutcomeKnowledgePackStarterPackProjections = (registryPacks = []) => {
  const sourcePackRecordByKey = buildSourcePackRecordMap(registryPacks)

  return OUTCOME_STUDIO_REQUIRED_PACKS
    .filter((pack) => pack.sourceStatus === STARTER_SOURCE_STATUS)
    .map((pack) => {
      const record = sourcePackRecordByKey.get(getStarterSourceKey(pack))
      const latestVersionId = normalizeText(record?.latestVersionId)
      const latestSemanticVersion = normalizeText(record?.latestSemanticVersion)
      const registryStatus = normalizeToken(record?.status)

      return {
        packType: pack.packType,
        packKey: pack.packKey,
        packCategory: normalizePackCategory(pack.packCategory, pack.packType),
        label: pack.label,
        sourceFilename: pack.sourceFilename,
        runtimeBindable: false,
        importStatus: latestVersionId ? 'IMPORTED' : 'NOT_IMPORTED',
        ...(latestVersionId ? { latestVersionId } : {}),
        ...(latestSemanticVersion ? { latestSemanticVersion } : {}),
        ...(registryStatus ? { registryStatus } : {}),
      }
    })
}

export const buildOutcomeKnowledgePackSourceBundle = ({ registryPacks = [] } = {}) => ({
  status: 'SOURCE_ONLY',
  sourcePath: OUTCOME_KNOWLEDGE_PACK_SOURCE_BUNDLE_PATH,
  starterPacks: buildOutcomeKnowledgePackStarterPackProjections(registryPacks),
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
} = {}) => {
  const normalizedFrameworkKey = normalizeToken(frameworkKey)
  const normalizedRuntimeType = normalizeToken(runtimeType)
  const normalizedPackageKey = normalizeLowerKey(packageKey)
  const normalizedPackageVersion = normalizeText(packageVersion)
  const normalizedEnvironmentKey = normalizeToken(environmentKey)
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
  packType: pack.packType,
  packKey: pack.packKey,
  label: pack.label,
  status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
  runtimeBindable: true,
  activationId: activation.activationId,
  versionId: activation.versionId,
  semanticVersion: activation.semanticVersion,
  schemaVersion: activation.schemaVersion,
  scopeType: activation.scopeType,
  scopeKey: activation.scopeKey,
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
      status: pack.sourceStatus || 'MISSING',
      runtimeBindable: false,
    }
  })

export const resolveOutcomeStudioKnowledgePacks = async ({
  frameworkKey,
  runtimeType,
  packageKey,
  packageVersion,
  environmentKey,
} = {}) => {
  const scopeCandidates = buildOutcomeKnowledgePackScopeCandidates({
    frameworkKey,
    runtimeType,
    packageKey,
    packageVersion,
    environmentKey,
  })
  const requiredPackTypes = [...new Set(OUTCOME_STUDIO_REQUIRED_PACKS.map((pack) => pack.packType))]
  const requiredPackKeys = OUTCOME_STUDIO_REQUIRED_PACKS.map((pack) => pack.packKey)
  const scopeKeys = scopeCandidates.map((candidate) => candidate.scopeKey)
  const [activations, sourcePackRecords] = await Promise.all([
    KnowledgePackActivation.find({
      status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
      packType: { $in: requiredPackTypes },
      packKey: { $in: requiredPackKeys },
      scopeKey: { $in: scopeKeys },
    })
      .sort({ activatedAt: -1 })
      .lean(),
    KnowledgePack.find(buildSourceBackedPackFilter()).lean(),
  ])
  const activeActivationByPackKey = selectActiveActivations({
    activations,
    scopeCandidates,
  })
  const requiredPacks = buildRequiredPackProjection({ activeActivationByPackKey })
  const activePacks = requiredPacks.filter((pack) => pack.runtimeBindable === true)
  const unboundRequiredPacks = requiredPacks.filter((pack) => pack.runtimeBindable !== true)
  const status = unboundRequiredPacks.length === 0
    ? OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED
    : OUTCOME_STUDIO_BINDING_STATUSES.BLOCKED

  return {
    status,
    mode: OUTCOME_KNOWLEDGE_PACK_RESOLUTION_MODE,
    summary: status === OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED
      ? 'All required Outcome Studio knowledge pack bindings are active.'
      : 'Knowledge Pack Registry activation is required before Outcome Studio sessions can start.',
    activePacks,
    requiredPacks,
    sourceBundle: buildOutcomeKnowledgePackSourceBundle({ registryPacks: sourcePackRecords }),
    resolution: {
      status,
      scopeCandidates,
      activeCount: activePacks.length,
      requiredCount: requiredPacks.length,
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

const buildListFilter = ({
  q,
  packType,
  status,
  packKey,
} = {}) => {
  const filter = {}
  const normalizedPackType = normalizeToken(packType)
  const normalizedStatus = normalizeToken(status)
  const normalizedPackKey = normalizeLowerKey(packKey)

  if (normalizedPackType) filter.packType = normalizedPackType
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
  if (sortBy === 'status') return { status: direction, packKey: 1 }
  if (sortBy === 'updatedAt') return { updatedAt: direction, packKey: 1 }
  return { packType: 1, packKey: 1 }
}

export const listOutcomeKnowledgePacks = async ({ query = {} } = {}) => {
  const page = Number(query.page) || 1
  const pageSize = Number(query.pageSize) || 20
  const filter = buildListFilter(query)
  const [total, rows, sourcePackRecords] = await Promise.all([
    KnowledgePack.countDocuments(filter),
    KnowledgePack.find(filter)
      .sort(buildSort(query))
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    KnowledgePack.find(buildSourceBackedPackFilter()).lean(),
  ])

  return {
    data: rows.map(serializeKnowledgePack),
    sourceBundle: buildOutcomeKnowledgePackSourceBundle({ registryPacks: sourcePackRecords }),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    },
  }
}

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
  const starterPackDefinition = findRequiredPackDefinition(packId)
  if (starterPackDefinition) {
    const requiredPackKey = `${starterPackDefinition.packType}:${starterPackDefinition.packKey}`
    if (!SUPPORTED_SOURCE_PACK_KEYS.has(requiredPackKey)) {
      throw createKnowledgePackError({
        status: 409,
        code: 'CONFLICT',
        message: 'This Outcome Studio knowledge pack does not have an importable starter source in the current bundle.',
        reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_NOT_AVAILABLE,
        details: {
          packType: starterPackDefinition.packType,
          packKey: starterPackDefinition.packKey,
        },
      })
    }

    const canonicalPackId = buildKnowledgePackId(starterPackDefinition)
    const packRecord = await KnowledgePack.findOne({ packId: canonicalPackId }).lean()
    return {
      canonicalPackId,
      packDefinition: starterPackDefinition,
      packRecord: packRecordMatchesLookup(packRecord, canonicalPackId) ? packRecord : null,
    }
  }

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
  const starterPackDefinition = findRequiredPackDefinition(packId)
  if (starterPackDefinition) {
    const requiredPackKey = `${starterPackDefinition.packType}:${starterPackDefinition.packKey}`
    if (!SUPPORTED_SOURCE_PACK_KEYS.has(requiredPackKey)) {
      throw createKnowledgePackError({
        status: 409,
        code: 'CONFLICT',
        message: 'This Outcome Studio knowledge pack does not have an importable starter source in the current bundle.',
        reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_SOURCE_NOT_AVAILABLE,
        details: {
          packType: starterPackDefinition.packType,
          packKey: starterPackDefinition.packKey,
        },
      })
    }

    return {
      canonicalPackId: buildKnowledgePackId(starterPackDefinition),
      packDefinition: starterPackDefinition,
      packRecord: null,
      isImportedSourceDocument: false,
      isStarterSource: true,
    }
  }

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
    isImportedSourceDocument: true,
    isStarterSource: false,
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
  body = {},
  actorUserId = null,
  auditRequest = null,
} = {}) => {
  const packDefinition = getSourceBackedPackDefinitionOrThrow(packId)
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

  const content = String(body.content || '').trim()
  const sourceFilename = getValidatedSourceFilename({
    packDefinition,
    sourceFilename: body.sourceFilename,
  })
  const canonicalPackId = buildKnowledgePackId(packDefinition)
  const scopeType = OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL
  const scopeKey = OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL
  const versionId = buildKnowledgePackVersionId({
    packType: packDefinition.packType,
    packKey: packDefinition.packKey,
    semanticVersion,
    scopeKey,
  })

  const existingVersion = await KnowledgePackVersion.findOne({
    packType: packDefinition.packType,
    packKey: packDefinition.packKey,
    semanticVersion,
    scopeKey,
  }).lean()

  if (existingVersion) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack version already exists for this pack, semantic version, and scope.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_ALREADY_EXISTS,
      details: {
        packId: canonicalPackId,
        versionId,
        semanticVersion,
      },
    })
  }

  const packRecord = await ensureStarterPackRecord({
    packDefinition,
    actorUserId,
    versionId,
    semanticVersion,
    status: OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT,
  })
  const version = new KnowledgePackVersion({
    versionId,
    packId: canonicalPackId,
    packCategory: normalizePackCategory(packDefinition.packCategory, packDefinition.packType),
    packType: packDefinition.packType,
    packKey: packDefinition.packKey,
    semanticVersion,
    schemaVersion: normalizeText(body.schemaVersion || '1.0.0'),
    status: OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT,
    scopeType,
    scopeKey,
    contentHash: buildContentHash(content),
    contentFormat: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML,
    sourceFilename,
    content,
    sourceMetadata: buildStarterPackSourceMetadata({ packDefinition, sourceFilename }),
    uploadedBy: actorUserId || null,
  })

  await saveDocument(version)
  await logKnowledgePackAudit({
    auditRequest,
    action: auditService.AUDIT_ACTIONS.OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED,
    actorUserId,
    packRecord,
    packDefinition,
    version,
    diff: {
      status: { from: null, to: OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT },
      contentVisible: false,
    },
  })

  return {
    pack: serializeKnowledgePack(packRecord),
    version: serializeKnowledgePackVersion(version),
  }
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

  const packRecord = await ensureSourceDocumentDraftPackRecord({
    packDefinition,
    actorUserId,
    versionId,
    semanticVersion,
    scope,
  })
  const version = new KnowledgePackVersion({
    versionId,
    packId: canonicalPackId,
    packCategory: normalizePackCategory(packDefinition.packCategory, packDefinition.packType),
    purposeCategory: packDefinition.purposeCategory,
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

  await saveDocument(version)
  await logKnowledgePackAudit({
    auditRequest,
    action: auditService.AUDIT_ACTIONS.OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED,
    actorUserId,
    packRecord,
    packDefinition,
    version,
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
    },
  })

  return {
    pack: serializeKnowledgePack(packRecord),
    version: serializeKnowledgePackVersion(version),
  }
}

export const importOutcomeKnowledgePackStarterVersion = async ({
  packId,
  actorUserId = null,
  auditRequest = null,
} = {}) => {
  const packDefinition = getSourceBackedPackDefinitionOrThrow(packId)
  const starterSource = getStarterSourceForPackDefinitionOrThrow(packDefinition)
  const semanticVersion = normalizeText(starterSource.semanticVersion)
  if (!SEMANTIC_VERSION_RE.test(semanticVersion)) {
    throw createKnowledgePackError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Knowledge pack starter source semantic version must use major.minor.patch format.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_VALIDATION_FAILED,
      details: { field: 'semanticVersion' },
    })
  }

  const canonicalPackId = buildKnowledgePackId(packDefinition)
  const scopeType = OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL
  const scopeKey = OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL
  const versionId = buildKnowledgePackVersionId({
    packType: packDefinition.packType,
    packKey: packDefinition.packKey,
    semanticVersion,
    scopeKey,
  })
  const validationSummary = buildStarterPackValidationSummary({
    packDefinition,
    content: starterSource.content,
  })

  if (validationSummary.status !== 'PASSED') {
    throw createKnowledgePackError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Knowledge pack starter source validation failed.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_VALIDATION_FAILED,
      details: {
        packId: canonicalPackId,
        versionId,
        validationSummary,
      },
    })
  }

  const runImportMutation = async (session = null) => {
    const existingVersion = await resolveLeanQuery(withOptionalSession(
      KnowledgePackVersion.findOne({
        packType: packDefinition.packType,
        packKey: packDefinition.packKey,
        semanticVersion,
        scopeKey,
      }),
      session,
    ))

    if (existingVersion) {
      throw createKnowledgePackError({
        status: 409,
        code: 'CONFLICT',
        message: 'Knowledge pack starter version has already been imported.',
        reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_ALREADY_EXISTS,
        details: {
          packId: canonicalPackId,
          versionId,
          semanticVersion,
        },
      })
    }

    const existingPackRecord = await resolveLeanQuery(withOptionalSession(
      KnowledgePack.findOne({ packId: canonicalPackId }),
      session,
    ))
    const packRecord = await ensureStarterPackRecord({
      packDefinition,
      actorUserId,
      versionId,
      semanticVersion,
      status: OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED,
      session,
    })
    const version = new KnowledgePackVersion({
      versionId,
      packId: canonicalPackId,
      packCategory: normalizePackCategory(packDefinition.packCategory, packDefinition.packType),
      packType: packDefinition.packType,
      packKey: packDefinition.packKey,
      semanticVersion,
      schemaVersion: normalizeText(starterSource.schemaVersion || '1.0.0'),
      status: OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED,
      scopeType,
      scopeKey,
      contentHash: buildContentHash(starterSource.content),
      contentFormat: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML,
      sourceFilename: starterSource.sourceFilename,
      content: starterSource.content,
      sourceMetadata: buildStarterPackSourceMetadata({
        packDefinition,
        sourceFilename: starterSource.sourceFilename,
      }),
      validationSummary,
      validatedAt: new Date(validationSummary.checkedAt),
      uploadedBy: actorUserId || null,
    })

    await saveDocument(version, session)

    try {
      await logKnowledgePackAudit({
        auditRequest,
        action: auditService.AUDIT_ACTIONS.OUTCOME_KNOWLEDGE_PACK_STARTER_IMPORTED,
        actorUserId,
        packRecord,
        packDefinition,
        version,
        session,
        throwOnError: true,
        diff: {
          status: {
            from: null,
            to: OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED,
          },
          sourceFilename: starterSource.sourceFilename,
          sourcePath: OUTCOME_KNOWLEDGE_PACK_SOURCE_BUNDLE_PATH,
          importMode: 'BUNDLED_STARTER_SOURCE',
          contentVisible: false,
          contentIncludedInAudit: false,
          validationSummary,
        },
      })
    } catch (err) {
      err.outcomeKnowledgePackAuditFailure = true
      err.starterImportRollback = {
        canonicalPackId,
        existingPackRecord,
        versionId,
      }
      throw err
    }

    return {
      packRecord,
      validationSummary,
      version,
    }
  }

  let importResult = null
  let session = null

  try {
    if (mongoose.connection.readyState === 1) {
      session = await mongoose.startSession()
      await session.withTransaction(async () => {
        importResult = await runImportMutation(session)
      })
    } else {
      importResult = await runImportMutation()
    }
  } catch (err) {
    if (err?.outcomeKnowledgePackAuditFailure) {
      if (mongoose.connection.readyState !== 1 && err.starterImportRollback) {
        await rollbackStarterImportAfterAuditFailure(err.starterImportRollback)
      }

      throwKnowledgePackAuditError(err)
    }

    throw err
  } finally {
    await session?.endSession()
  }

  return {
    pack: serializeKnowledgePack(importResult.packRecord),
    version: serializeKnowledgePackVersion(importResult.version),
    validationSummary: importResult.validationSummary,
  }
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
    isImportedSourceDocument,
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

  const validationSummary = isImportedSourceDocument
    ? buildSourceDocumentDraftValidationSummary({
      packDefinition,
      packRecord: authoringContext.packRecord,
      version,
    })
    : buildStarterPackValidationSummary({
      packDefinition,
      content: version.content,
    })
  const validationPassed = validationSummary.status === 'PASSED'
  const previousStatus = normalizeToken(version.status || OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT)
  version.status = validationPassed
    ? OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED
    : OUTCOME_KNOWLEDGE_PACK_STATUSES.FAILED_VALIDATION
  version.validationSummary = validationSummary
  version.validatedAt = validationPassed ? new Date(validationSummary.checkedAt) : null

  await saveDocument(version)
  const packRecord = isImportedSourceDocument
    ? {
      ...toPlainObject(authoringContext.packRecord),
      status: version.status,
      latestVersionId: version.versionId,
      latestSemanticVersion: version.semanticVersion,
      updatedBy: actorUserId || null,
    }
    : await ensureStarterPackRecord({
      packDefinition,
      actorUserId,
      versionId: version.versionId,
      semanticVersion: version.semanticVersion,
      status: version.status,
    })

  if (isImportedSourceDocument) {
    await updateKnowledgePackLatestVersion({
      packId: canonicalPackId,
      status: version.status,
      versionId: version.versionId,
      semanticVersion: version.semanticVersion,
      actorUserId,
    })
  }

  await logKnowledgePackAudit({
    auditRequest,
    action: validationPassed
      ? auditService.AUDIT_ACTIONS.OUTCOME_KNOWLEDGE_PACK_VERSION_VALIDATED
      : auditService.AUDIT_ACTIONS.OUTCOME_KNOWLEDGE_PACK_VALIDATION_FAILED,
    actorUserId,
    packRecord,
    packDefinition,
    version,
    diff: {
      validationSummary,
      status: {
        from: previousStatus,
        to: version.status,
      },
    },
  })

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
    isImportedSourceDocument,
  } = authoringContext

  if (!isImportedSourceDocument) {
    throw createKnowledgePackError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge pack review workflow is available for imported source-document drafts only.',
      reason: OUTCOME_KNOWLEDGE_PACK_ERROR_REASONS.PACK_VERSION_LIFECYCLE_CONFLICT,
      details: { packId: canonicalPackId },
    })
  }

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
  await saveDocument(activation, session)

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
      { $set: { status: previousStatus } },
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
    isImportedSourceDocument,
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

  if (isImportedSourceDocument) {
    assertImportedSourceDocumentReadyForActivation({
      canonicalPackId,
      packDefinition,
      packRecord: authoringContext.packRecord,
      version,
    })
  }

  let packRecord = authoringContext.packRecord
  if (!packRecord) {
    const existingPackRecord = await KnowledgePack.findOne({ packId: canonicalPackId }).lean()
    packRecord = existingPackRecord || await ensureStarterPackRecord({
      packDefinition,
      actorUserId,
      versionId: version.versionId,
      semanticVersion: version.semanticVersion,
      status: previousStatus,
    })
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
  const packDefinition = getSourceBackedPackDefinitionOrThrow(packId)
  const canonicalPackId = buildKnowledgePackId(packDefinition)
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

  const existingPackRecord = await KnowledgePack.findOne({ packId: canonicalPackId }).lean()
  const packRecord = existingPackRecord || await ensureStarterPackRecord({
    packDefinition,
    actorUserId,
    versionId: version.versionId,
    semanticVersion: version.semanticVersion,
    status: previousStatus,
  })
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
  const packDefinition = getSourceBackedPackDefinitionOrThrow(packId)
  const canonicalPackId = buildKnowledgePackId(packDefinition)
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

  const existingPackRecord = await KnowledgePack.findOne({ packId: canonicalPackId }).lean()
  const packRecord = existingPackRecord || await ensureStarterPackRecord({
    packDefinition,
    actorUserId,
    versionId: targetVersion.versionId,
    semanticVersion: targetVersion.semanticVersion,
    status: previousStatus,
  })
  const activationTime = new Date()
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
