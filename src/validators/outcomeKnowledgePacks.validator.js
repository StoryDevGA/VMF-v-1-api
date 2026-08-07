import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import {
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES,
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_TYPES,
} from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_PACK_AUTHORING_MODES,
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_LAYERS,
  KNOWLEDGE_PACK_MANIFEST_STATUSES,
  KNOWLEDGE_PACK_MANIFEST_TYPES,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES,
  KNOWLEDGE_PACK_REVIEW_STATUSES,
  KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES,
  KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
  KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS,
  KNOWLEDGE_PACK_RELATIONSHIP_TYPES,
  KNOWLEDGE_PACK_VISIBILITY_SCOPES,
  KNOWLEDGE_ASSET_ID_PATTERN,
} from '../constants/knowledgeRuntime.js'
import {
  KNOWLEDGE_PACK_CATEGORIES,
  WORKSPACE_TYPES,
} from '../constants/workspaceGovernance.js'

const frameworkKeyRegex = /^[A-Z][A-Z0-9_]*$/
const packIdRegex = /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,179}$/
const manifestIdRegex = /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,219}$/
const versionIdRegex = /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,239}$/
const semanticVersionRegex = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const objectIdRegex = /^[a-f\d]{24}$/i
const sourceDocumentContentBase64MaxLength = 12_000_000

const optionalFrameworkKeySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => !value || frameworkKeyRegex.test(value), 'Framework key must use uppercase letters, numbers, or underscores')
  .optional()

const optionalRuntimeTypeSchema = z
  .string()
  .trim()
  .max(80)
  .transform((value) => value.toUpperCase())
  .optional()

const optionalKeySchema = (label, max = 140) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .optional()

const listKnowledgePacksQuerySchema = z.object({
  q: optionalKeySchema('Search query', 255),
  packType: z.enum(Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES)).optional(),
  knowledgeLayer: z.enum(Object.values(KNOWLEDGE_PACK_LAYERS)).optional(),
  packKey: optionalKeySchema('Pack key'),
  status: z.enum(Object.values(OUTCOME_KNOWLEDGE_PACK_STATUSES)).optional(),
  sortBy: z.enum(['label', 'packKey', 'packType', 'knowledgeLayer', 'status', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const listKnowledgePackManifestsQuerySchema = z.object({
  q: optionalKeySchema('Search query', 255),
  manifestKey: optionalKeySchema('Manifest key', 160),
  status: z.enum(Object.values(KNOWLEDGE_PACK_MANIFEST_STATUSES)).optional(),
  workspaceType: z.enum(Object.values(WORKSPACE_TYPES)).optional(),
  frameworkKey: optionalFrameworkKeySchema,
  runtimeType: optionalRuntimeTypeSchema,
  packageKey: optionalKeySchema('Package key'),
  outputKey: optionalKeySchema('Output key'),
  sortBy: z.enum(['manifestName', 'manifestKey', 'status', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const knowledgePackIdParamsSchema = z.object({
  packId: z
    .string({ required_error: 'packId is required' })
    .trim()
    .refine((value) => packIdRegex.test(value), 'packId must use a safe identifier format'),
})

const knowledgePackVersionParamsSchema = knowledgePackIdParamsSchema.extend({
  versionId: z
    .string({ required_error: 'versionId is required' })
    .trim()
    .refine((value) => versionIdRegex.test(value), 'versionId must use a safe identifier format'),
})

const manifestIdParamsSchema = z.object({
  manifestId: z
    .string({ required_error: 'manifestId is required' })
    .trim()
    .refine((value) => manifestIdRegex.test(value), 'manifestId must use a safe identifier format'),
})

const compareManifestParamsSchema = manifestIdParamsSchema.extend({
  targetManifestId: z
    .string({ required_error: 'targetManifestId is required' })
    .trim()
    .refine((value) => manifestIdRegex.test(value), 'targetManifestId must use a safe identifier format'),
})

const previewResolutionQuerySchema = z.object({
  frameworkKey: optionalFrameworkKeySchema,
  runtimeType: optionalRuntimeTypeSchema,
  packageKey: optionalKeySchema('Package key'),
  packageVersion: optionalKeySchema('Package version', 60),
  environmentKey: optionalRuntimeTypeSchema,
})

const reasoningContextPurposeCategories = [
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.STYLE,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.AUDIENCE,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.INDUSTRY,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.LANGUAGE,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.BRAND,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.DECISION,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.COMPLIANCE,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.DOMAIN,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.ADVISOR,
]

const normalizeQueryList = (value) => {
  if (value === undefined) return []
  const values = Array.isArray(value) ? value : [value]
  return values
    .flatMap((item) => String(item || '').split(','))
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
}

const reasoningContextPreviewQuerySchema = previewResolutionQuerySchema.extend({
  outputKey: optionalKeySchema('Output key'),
  contextCategories: z
    .preprocess(
      normalizeQueryList,
      z.array(z.enum(reasoningContextPurposeCategories)).max(12),
    )
    .default([]),
  customerId: z
    .string()
    .trim()
    .regex(objectIdRegex, 'customerId must be a valid ObjectId')
    .optional(),
  tenantId: z
    .string()
    .trim()
    .regex(objectIdRegex, 'tenantId must be a valid ObjectId')
    .optional(),
}).strict()

const manifestPackReferenceSchema = z.object({
  packCategory: z.enum(Object.values(KNOWLEDGE_PACK_CATEGORIES)).optional(),
  purposeCategory: z.enum(Object.values(KNOWLEDGE_PACK_PURPOSE_CATEGORIES)).optional(),
  packType: z
    .string({ required_error: 'packType is required' })
    .trim()
    .min(1, 'packType is required')
    .max(80, 'packType must be 80 characters or fewer')
    .transform((value) => value.toUpperCase()),
  packKey: z
    .string({ required_error: 'packKey is required' })
    .trim()
    .min(1, 'packKey is required')
    .max(140, 'packKey must be 140 characters or fewer'),
  label: z
    .string()
    .trim()
    .max(160, 'label must be 160 characters or fewer')
    .optional(),
  executionMode: z
    .enum(Object.values(KNOWLEDGE_PACK_EXECUTION_MODES))
    .default(KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT),
  required: z.boolean().optional(),
  dependencyKeys: z
    .array(z.string().trim().min(1).max(180))
    .max(50, 'dependencyKeys can contain at most 50 entries')
    .default([]),
  sourceAuthority: z
    .string()
    .trim()
    .max(120, 'sourceAuthority must be 120 characters or fewer')
    .optional(),
  metadata: z.record(z.any()).default({}),
}).strict()

const manifestPackSectionSchema = z
  .array(manifestPackReferenceSchema)
  .max(100, 'manifest pack section can contain at most 100 pack references')
  .default([])

const manifestAuthoringBaseSchema = {
  manifestName: z
    .string()
    .trim()
    .min(1, 'manifestName is required')
    .max(180, 'manifestName must be 180 characters or fewer'),
  manifestType: z
    .enum(Object.values(KNOWLEDGE_PACK_MANIFEST_TYPES))
    .default(KNOWLEDGE_PACK_MANIFEST_TYPES.FRAMEWORK_RUNTIME),
  description: z
    .string()
    .trim()
    .max(1200, 'description must be 1200 characters or fewer')
    .optional(),
  workspaceType: z.enum(Object.values(WORKSPACE_TYPES)).default(WORKSPACE_TYPES.OUTCOME),
  frameworkKey: optionalFrameworkKeySchema,
  runtimeType: optionalRuntimeTypeSchema,
  packageKey: optionalKeySchema('Package key'),
  outputKey: optionalKeySchema('Output key'),
  mandatoryPacks: manifestPackSectionSchema,
  optionalPacks: manifestPackSectionSchema,
  validationPacks: manifestPackSectionSchema,
  blockedPacks: manifestPackSectionSchema,
  resolutionPolicy: z.record(z.any()).default({}),
  validationPolicy: z.record(z.any()).default({}),
  sourceMetadata: z.record(z.any()).default({}),
}

const createKnowledgePackManifestBodySchema = z.object({
  manifestKey: z
    .string({ required_error: 'manifestKey is required' })
    .trim()
    .min(1, 'manifestKey is required')
    .max(160, 'manifestKey must be 160 characters or fewer'),
  semanticVersion: z
    .string({ required_error: 'semanticVersion is required' })
    .trim()
    .regex(semanticVersionRegex, 'semanticVersion must use major.minor.patch format'),
  scopeType: z
    .enum(Object.values(OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES))
    .default(OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL),
  scopeKey: z
    .string()
    .trim()
    .max(260, 'scopeKey must be 260 characters or fewer')
    .optional(),
  ...manifestAuthoringBaseSchema,
}).strict()

const updateKnowledgePackManifestBodySchema = z.object({
  manifestName: manifestAuthoringBaseSchema.manifestName.optional(),
  manifestType: manifestAuthoringBaseSchema.manifestType.optional(),
  description: manifestAuthoringBaseSchema.description,
  workspaceType: manifestAuthoringBaseSchema.workspaceType.optional(),
  frameworkKey: optionalFrameworkKeySchema,
  runtimeType: optionalRuntimeTypeSchema,
  packageKey: optionalKeySchema('Package key'),
  outputKey: optionalKeySchema('Output key'),
  mandatoryPacks: manifestPackSectionSchema.optional(),
  optionalPacks: manifestPackSectionSchema.optional(),
  validationPacks: manifestPackSectionSchema.optional(),
  blockedPacks: manifestPackSectionSchema.optional(),
  resolutionPolicy: z.record(z.any()).optional(),
  validationPolicy: z.record(z.any()).optional(),
  sourceMetadata: z.record(z.any()).optional(),
}).strict()

const cloneKnowledgePackManifestBodySchema = z.object({
  manifestKey: z
    .string({ required_error: 'manifestKey is required' })
    .trim()
    .min(1, 'manifestKey is required')
    .max(160, 'manifestKey must be 160 characters or fewer'),
  semanticVersion: z
    .string({ required_error: 'semanticVersion is required' })
    .trim()
    .regex(semanticVersionRegex, 'semanticVersion must use major.minor.patch format'),
  manifestName: z
    .string()
    .trim()
    .min(1, 'manifestName is required')
    .max(180, 'manifestName must be 180 characters or fewer')
    .optional(),
  description: manifestAuthoringBaseSchema.description,
  scopeType: z
    .enum(Object.values(OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES))
    .optional(),
  scopeKey: z
    .string()
    .trim()
    .max(260, 'scopeKey must be 260 characters or fewer')
    .optional(),
  mandatoryPacks: manifestPackSectionSchema.optional(),
  optionalPacks: manifestPackSectionSchema.optional(),
  validationPacks: manifestPackSectionSchema.optional(),
  blockedPacks: manifestPackSectionSchema.optional(),
  resolutionPolicy: z.record(z.any()).optional(),
  validationPolicy: z.record(z.any()).optional(),
  sourceMetadata: z.record(z.any()).optional(),
}).strict()

const createKnowledgePackVersionBodySchema = z.object({
  semanticVersion: z
    .string({ required_error: 'semanticVersion is required' })
    .trim()
    .regex(semanticVersionRegex, 'semanticVersion must use major.minor.patch format'),
  schemaVersion: z
    .string()
    .trim()
    .regex(semanticVersionRegex, 'schemaVersion must use major.minor.patch format')
    .default('1.0.0'),
  contentFormat: z
    .enum([OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML])
    .default(OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML),
  sourceFilename: z
    .string()
    .trim()
    .max(180, 'sourceFilename must be 180 characters or fewer')
    .optional(),
  content: z
    .string({ required_error: 'content is required' })
    .trim()
    .min(40, 'content must include the knowledge pack source content')
    .max(750000, 'content must be 750000 characters or fewer'),
}).strict()

const sourceDocumentSchema = z.object({
  sourceDocumentId: z
    .string()
    .trim()
    .max(180, 'sourceDocumentId must be 180 characters or fewer')
    .optional(),
  filename: z
    .string({ required_error: 'source document filename is required' })
    .trim()
    .min(1, 'source document filename is required')
    .max(220, 'filename must be 220 characters or fewer'),
  contentType: z
    .string()
    .trim()
    .max(120, 'contentType must be 120 characters or fewer')
    .optional(),
  fileExtension: z
    .string()
    .trim()
    .max(24, 'fileExtension must be 24 characters or fewer')
    .optional(),
  sourceHash: z
    .string()
    .trim()
    .max(140, 'sourceHash must be 140 characters or fewer')
    .optional(),
  sizeBytes: z.coerce
    .number()
    .int()
    .min(0, 'sizeBytes must be zero or greater')
    .max(10_000_000, 'sizeBytes must be 10000000 bytes or fewer')
    .optional(),
  contentBase64: z
    .string()
    .trim()
    .max(
      sourceDocumentContentBase64MaxLength,
      `contentBase64 must be ${sourceDocumentContentBase64MaxLength} characters or fewer`,
    )
    .optional(),
}).strict()

const governedKnowledgeAssetIdSchema = z
  .string()
  .trim()
  .transform((value) => value.normalize('NFKC').toUpperCase())
  .refine(
    (value) => KNOWLEDGE_ASSET_ID_PATTERN.test(value),
    'knowledgeAssetId must be a governed uppercase hyphenated identity',
  )

const knowledgePackVersionConstraintSchema = z.object({
  exactVersion: z.string().trim().regex(semanticVersionRegex).optional(),
  minimumVersionInclusive: z.string().trim().regex(semanticVersionRegex).optional(),
  maximumVersionExclusive: z.string().trim().regex(semanticVersionRegex).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.exactVersion && (value.minimumVersionInclusive || value.maximumVersionExclusive)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'versionConstraint cannot mix exact and range fields',
    })
  }
  if (!value.exactVersion && !value.minimumVersionInclusive && !value.maximumVersionExclusive) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'versionConstraint must include an exact or range field',
    })
  }
})

const knowledgePackDependencyReferenceSchema = z.object({
  relationshipType: z.enum(Object.values(KNOWLEDGE_PACK_RELATIONSHIP_TYPES)),
  targetPackType: z.enum(Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES)).optional(),
  targetPackKey: optionalKeySchema('Relationship target pack key'),
  targetCapabilityKey: optionalKeySchema('Relationship target capability key'),
  targetKnowledgeAssetId: governedKnowledgeAssetIdSchema.optional(),
  targetKnowledgeLayer: z.enum(Object.values(KNOWLEDGE_PACK_LAYERS)).optional(),
  requiredAt: z.enum(Object.values(KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS)),
  cardinality: z.enum(Object.values(KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES)),
  versionConstraint: knowledgePackVersionConstraintSchema.optional(),
}).strict()

const importSourceDocumentDraftBodySchema = z.object({
  packType: z.enum(Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES), {
    required_error: 'packType is required',
  }),
  packKey: z
    .string({ required_error: 'packKey is required' })
    .trim()
    .min(1, 'packKey is required')
    .max(140, 'packKey must be 140 characters or fewer'),
  label: z
    .string({ required_error: 'label is required' })
    .trim()
    .min(1, 'label is required')
    .max(160, 'label must be 160 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(1000, 'description must be 1000 characters or fewer')
    .optional(),
  purposeCategory: z.enum(Object.values(KNOWLEDGE_PACK_PURPOSE_CATEGORIES)).optional(),
  knowledgeLayer: z.enum(Object.values(KNOWLEDGE_PACK_LAYERS)).optional(),
  capabilityKey: optionalKeySchema('Capability key'),
  knowledgeAssetId: governedKnowledgeAssetIdSchema.optional(),
  workspaceCompatibility: z
    .array(z.enum(Object.values(WORKSPACE_TYPES)))
    .max(Object.values(WORKSPACE_TYPES).length, 'workspaceCompatibility contains too many entries')
    .optional(),
  dependencyReferences: z
    .array(knowledgePackDependencyReferenceSchema)
    .max(100, 'dependencyReferences can contain at most 100 entries')
    .optional(),
  relationshipContractVersion: z
    .literal(KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION)
    .optional(),
  semanticVersion: z
    .string({ required_error: 'semanticVersion is required' })
    .trim()
    .regex(semanticVersionRegex, 'semanticVersion must use major.minor.patch format'),
  schemaVersion: z
    .string()
    .trim()
    .regex(semanticVersionRegex, 'schemaVersion must use major.minor.patch format')
    .default('1.0.0'),
  sourceAuthority: z
    .string()
    .trim()
    .max(160, 'sourceAuthority must be 160 characters or fewer')
    .optional(),
  executionMode: z
    .enum(Object.values(KNOWLEDGE_PACK_EXECUTION_MODES))
    .default(KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT),
  visibility: z
    .enum(Object.values(KNOWLEDGE_PACK_VISIBILITY_SCOPES))
    .default(KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM),
  customerId: z
    .string()
    .trim()
    .regex(objectIdRegex, 'customerId must be a valid ObjectId')
    .optional(),
  tenantId: z
    .string()
    .trim()
    .regex(objectIdRegex, 'tenantId must be a valid ObjectId')
    .optional(),
  authoringMode: z
    .enum(Object.values(KNOWLEDGE_PACK_AUTHORING_MODES))
    .default(KNOWLEDGE_PACK_AUTHORING_MODES.IMPORT_SOURCE_DOCUMENT),
  reviewStatus: z
    .enum(Object.values(KNOWLEDGE_PACK_REVIEW_STATUSES))
    .default(KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT),
  contentFormat: z
    .enum(Object.values(OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS))
    .optional(),
  sourceDocument: sourceDocumentSchema,
  extractedText: z
    .string()
    .trim()
    .max(750000, 'extractedText must be 750000 characters or fewer')
    .optional(),
  duplicateOverrideReason: z
    .string()
    .trim()
    .min(10, 'duplicateOverrideReason must be at least 10 characters')
    .max(500, 'duplicateOverrideReason must be 500 characters or fewer')
    .optional(),
}).strict().superRefine((value, ctx) => {
  if (value.visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.CUSTOMER && !value.customerId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customerId'],
      message: 'customerId is required for CUSTOMER visibility',
    })
  }

  if (value.visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.TENANT && !value.tenantId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tenantId'],
      message: 'tenantId is required for TENANT visibility',
    })
  }

  if (
    value.dependencyReferences !== undefined
    && value.relationshipContractVersion !== KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['relationshipContractVersion'],
      message: `relationshipContractVersion must be ${KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION}`,
    })
  }
})

const emptyBodySchema = z.object({}).strict()

const supportedActivationScopeTypes = [
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.FRAMEWORK,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.RUNTIME_TYPE,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.PACKAGE,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.ENVIRONMENT,
]

const activationScopeFields = {
  scopeType: z
    .enum(supportedActivationScopeTypes)
    .default(OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL),
  frameworkKey: optionalFrameworkKeySchema,
  runtimeType: optionalRuntimeTypeSchema,
  packageKey: optionalKeySchema('Package key'),
  packageVersion: optionalKeySchema('Package version', 60),
  environmentKey: optionalRuntimeTypeSchema,
}

const validateActivationScope = (value, ctx) => {
  if (value.scopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.FRAMEWORK && !value.frameworkKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['frameworkKey'],
      message: 'frameworkKey is required for FRAMEWORK scope',
    })
  }

  if (value.scopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.RUNTIME_TYPE && !value.runtimeType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['runtimeType'],
      message: 'runtimeType is required for RUNTIME_TYPE scope',
    })
  }

  if (value.scopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.PACKAGE && !value.packageKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['packageKey'],
      message: 'packageKey is required for PACKAGE scope',
    })
  }

  if (value.scopeType === OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.ENVIRONMENT && !value.environmentKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['environmentKey'],
      message: 'environmentKey is required for ENVIRONMENT scope',
    })
  }
}

const activateKnowledgePackVersionBodySchema = z
  .object(activationScopeFields)
  .strict()
  .superRefine(validateActivationScope)

const updateKnowledgePackReviewBodySchema = z.object({
  reviewStatus: z.enum([
    KNOWLEDGE_PACK_REVIEW_STATUSES.READY_FOR_REVIEW,
    KNOWLEDGE_PACK_REVIEW_STATUSES.APPROVED,
    KNOWLEDGE_PACK_REVIEW_STATUSES.REJECTED,
  ], {
    required_error: 'reviewStatus is required',
  }),
}).strict()

const rollbackKnowledgePackBodySchema = z
  .object({
    versionId: z
      .string({ required_error: 'versionId is required' })
      .trim()
      .refine((value) => versionIdRegex.test(value), 'versionId must use a safe identifier format'),
    rollbackReason: optionalKeySchema('Rollback reason', 500),
    ...activationScopeFields,
  })
  .strict()
  .superRefine(validateActivationScope)

export const validateListKnowledgePacks = createQueryValidator(listKnowledgePacksQuerySchema)
export const validateListKnowledgePackManifests = createQueryValidator(listKnowledgePackManifestsQuerySchema)
export const validateKnowledgePackId = createParamsValidator(knowledgePackIdParamsSchema)
export const validateKnowledgePackManifestId = createParamsValidator(manifestIdParamsSchema)
export const validateCompareKnowledgePackManifestParams = createParamsValidator(compareManifestParamsSchema)
export const validateKnowledgePackVersionParams = createParamsValidator(knowledgePackVersionParamsSchema)
export const validateKnowledgePackResolutionPreview = createQueryValidator(previewResolutionQuerySchema)
export const validateReasoningContextPreview = createQueryValidator(reasoningContextPreviewQuerySchema)
export const validateCreateKnowledgePackManifest = createBodyValidator(createKnowledgePackManifestBodySchema)
export const validateUpdateKnowledgePackManifest = createBodyValidator(updateKnowledgePackManifestBodySchema)
export const validateCloneKnowledgePackManifest = createBodyValidator(cloneKnowledgePackManifestBodySchema)
export const validateCreateKnowledgePackVersion = createBodyValidator(createKnowledgePackVersionBodySchema)
export const validateImportSourceDocumentDraft = createBodyValidator(importSourceDocumentDraftBodySchema)
export const validateImportKnowledgePackStarterVersion = createBodyValidator(emptyBodySchema)
export const validateKnowledgePackVersionActionBody = createBodyValidator(emptyBodySchema)
export const validateActivateKnowledgePackVersion = createBodyValidator(activateKnowledgePackVersionBodySchema)
export const validateUpdateKnowledgePackReview = createBodyValidator(updateKnowledgePackReviewBodySchema)
export const validateRollbackKnowledgePack = createBodyValidator(rollbackKnowledgePackBodySchema)
