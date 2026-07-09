import { isIP } from 'node:net'
import { z } from 'zod'
import {
  DISCOVERY_ACQUISITION_PROFILE_ERROR_MESSAGE,
  ENABLED_DISCOVERY_ACQUISITION_PROFILES,
} from '../constants/discoveryAcquisitionProfiles.js'
import {
  OUTPUT_LAB_EXPORT_FORMATS,
  OUTPUT_LAB_OUTPUT_TYPE_KEYS,
} from '../constants/runtimeOutputLab.js'
import { OUTCOME_STUDIO_EXPORT_FORMATS } from '../constants/runtimeOutcomeStudio.js'
import { RUNTIME_INSTANCE_STATUSES, RUNTIME_TYPES } from '../models/RuntimeInstance.js'
import { createBodyValidator, createParamsValidator, createQueryValidator } from './shared.js'

const objectIdRegex = /^[a-f\d]{24}$/i
const DOCUMENT_MAX_FILE_BYTES = 2_500_000
const PPTX_DOCUMENT_MAX_FILE_BYTES = 40_000_000
const DOCUMENT_MAX_CONTENT_BASE64_CHARACTERS = 4_000_000
const PPTX_DOCUMENT_MAX_CONTENT_BASE64_CHARACTERS = 54_000_000
const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const getDocumentSourceExtension = (fileName = '') => {
  const normalized = String(fileName || '').trim().toLowerCase()
  const dotIndex = normalized.lastIndexOf('.')
  return dotIndex >= 0 ? normalized.slice(dotIndex) : ''
}

const isPptxDocumentSource = (documentSource = {}) => {
  const mimeType = String(documentSource?.mimeType || '').trim().toLowerCase().split(';')[0]
  return mimeType === PPTX_MIME_TYPE || getDocumentSourceExtension(documentSource?.fileName) === '.pptx'
}

const getDocumentSourceMaxFileBytes = (documentSource = {}) =>
  isPptxDocumentSource(documentSource) ? PPTX_DOCUMENT_MAX_FILE_BYTES : DOCUMENT_MAX_FILE_BYTES

const getDocumentSourceMaxContentBase64Characters = (documentSource = {}) =>
  isPptxDocumentSource(documentSource)
    ? PPTX_DOCUMENT_MAX_CONTENT_BASE64_CHARACTERS
    : DOCUMENT_MAX_CONTENT_BASE64_CHARACTERS

const validateDocumentSourcePayload = (data, ctx) => {
  if (!data.contentBase64 && !data.textContent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contentBase64'],
      message: 'contentBase64 or textContent is required',
    })
  }

  if (data.sizeBytes !== undefined) {
    const maxFileBytes = getDocumentSourceMaxFileBytes(data)
    if (data.sizeBytes > maxFileBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sizeBytes'],
        message: `sizeBytes must be ${maxFileBytes} bytes or fewer`,
      })
    }
  }

  if (data.contentBase64 !== undefined) {
    const maxContentBase64Characters = getDocumentSourceMaxContentBase64Characters(data)
    if (data.contentBase64.length > maxContentBase64Characters) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contentBase64'],
        message: 'contentBase64 is too large',
      })
    }
  }
}

const runtimeInstanceIdSchema = z.object({
  runtimeInstanceId: z
    .string({ required_error: 'runtimeInstanceId is required' })
    .trim()
    .min(1, 'runtimeInstanceId is required')
    .max(180, 'runtimeInstanceId must be 180 characters or fewer'),
})

const runtimeDiscoveryEvidenceParamsSchema = runtimeInstanceIdSchema.extend({
  evidenceObjectId: z
    .string({ required_error: 'evidenceObjectId is required' })
    .trim()
    .min(1, 'evidenceObjectId is required')
    .max(180, 'evidenceObjectId must be 180 characters or fewer'),
})

const runtimeSectionEvidenceParamsSchema = runtimeDiscoveryEvidenceParamsSchema

const runtimeIntelligenceGraphNodeParamsSchema = runtimeInstanceIdSchema.extend({
  nodeId: z
    .string({ required_error: 'nodeId is required' })
    .trim()
    .min(1, 'nodeId is required')
    .max(240, 'nodeId must be 240 characters or fewer'),
})

const runtimeIntelligenceGraphSectionParamsSchema = runtimeInstanceIdSchema.extend({
  sectionKey: z
    .string({ required_error: 'sectionKey is required' })
    .trim()
    .min(1, 'sectionKey is required')
    .max(120, 'sectionKey must be 120 characters or fewer'),
})

const runtimeIntelligenceGraphQueryParamsSchema = runtimeInstanceIdSchema.extend({
  queryType: z
    .string({ required_error: 'queryType is required' })
    .trim()
    .transform((value) => value.toLowerCase())
    .refine((value) => [
      'support',
      'contradictions',
      'coverage',
      'dependencies',
      'readiness',
      'decisions',
    ].includes(value), {
      message: 'queryType must be support, contradictions, coverage, dependencies, readiness, or decisions',
    }),
})

const runtimeActionParamsSchema = runtimeInstanceIdSchema.extend({
  actionKey: z
    .string({ required_error: 'actionKey is required' })
    .trim()
    .min(1, 'actionKey is required')
    .max(80, 'actionKey must be 80 characters or fewer')
    .transform((value) => value.toUpperCase()),
})

const runtimeOutputRequestParamsSchema = runtimeInstanceIdSchema.extend({
  outputRequestId: z
    .string({ required_error: 'outputRequestId is required' })
    .trim()
    .min(1, 'outputRequestId is required')
    .max(180, 'outputRequestId must be 180 characters or fewer'),
})

const runtimeOutputAssetParamsSchema = runtimeInstanceIdSchema.extend({
  outputAssetId: z
    .string({ required_error: 'outputAssetId is required' })
    .trim()
    .min(1, 'outputAssetId is required')
    .max(180, 'outputAssetId must be 180 characters or fewer'),
})

const governedReasoningExecutionParamsSchema = runtimeInstanceIdSchema.extend({
  executionId: z
    .string({ required_error: 'executionId is required' })
    .trim()
    .min(1, 'executionId is required')
    .max(180, 'executionId must be 180 characters or fewer'),
})

const runtimeOutputAssetExportParamsSchema = runtimeOutputAssetParamsSchema.extend({
  format: z
    .string({ required_error: 'format is required' })
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => Object.values(OUTPUT_LAB_EXPORT_FORMATS).includes(value), {
      message: 'format must be MARKDOWN or JSON',
    }),
})

const expectedUpdatedAtSchema = z
  .string({ required_error: 'expectedUpdatedAt is required' })
  .trim()
  .min(1, 'expectedUpdatedAt is required')
  .refine((value) => Number.isFinite(new Date(value).getTime()), {
    message: 'expectedUpdatedAt must be a valid timestamp',
  })

const createRuntimeInstanceSchema = z.object({
  customerId: z
    .string({ required_error: 'customerId is required' })
    .regex(objectIdRegex, 'customerId must be a valid ObjectId'),
  tenantId: z
    .string({ required_error: 'tenantId is required' })
    .regex(objectIdRegex, 'tenantId must be a valid ObjectId'),
  frameworkPackageId: z
    .string({ required_error: 'frameworkPackageId is required' })
    .regex(objectIdRegex, 'frameworkPackageId must be a valid ObjectId'),
  frameworkKey: z
    .string()
    .trim()
    .min(1, 'frameworkKey must not be empty')
    .max(80, 'frameworkKey must be 80 characters or fewer')
    .optional()
    .default('VMF'),
  runtimeType: z
    .enum(Object.values(RUNTIME_TYPES), {
      invalid_type_error: 'runtimeType must be a supported runtime type',
    })
    .optional()
    .default(RUNTIME_TYPES.VALUE_NARRATIVE),
  runtimeInstanceKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{2,159}$/, 'runtimeInstanceKey must use lowercase letters, numbers, or hyphens')
    .optional(),
  workspaceId: z
    .string()
    .trim()
    .max(160, 'workspaceId must be 160 characters or fewer')
    .optional(),
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(1, 'Name must not be empty')
    .max(255, 'Name must be 255 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(1000, 'Description must be 1000 characters or fewer')
    .optional()
    .default(''),
}).strict()

const createRuntimeRevisionSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  reason: z
    .string()
    .trim()
    .max(1000, 'Reason must be 1000 characters or fewer')
    .optional()
    .default(''),
}).strict()

const mutateRuntimeStateSchema = z.object({
  runtimePath: z
    .string({ required_error: 'runtimePath is required' })
    .trim()
    .min(1, 'runtimePath is required')
    .max(200, 'runtimePath must be 200 characters or fewer'),
  operation: z
    .string({ required_error: 'operation is required' })
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value === 'WRITE', {
      message: 'operation must be WRITE',
    }),
  value: z
    .any()
    .refine((value) => value !== undefined, {
      message: 'value is required',
    }),
  expectedUpdatedAt: expectedUpdatedAtSchema,
  saveAndNext: z.boolean().optional(),
}).strict()

const DISCOVERY_WEBSITE_SOURCE_LIMIT = 10

const normalizeDiscoveryWebsiteHostname = (hostname) =>
  String(hostname || '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')

const isBlockedDiscoveryIpv4 = (hostname) => {
  const parts = String(hostname || '').split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false

  const [a, b, c] = parts
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

const isBlockedDiscoveryIpv6 = (hostname) => {
  const normalizedHostname = normalizeDiscoveryWebsiteHostname(hostname)
  return normalizedHostname === '::'
    || normalizedHostname === '::1'
    || normalizedHostname.startsWith('::ffff:')
    || normalizedHostname.startsWith('64:ff9b:')
    || normalizedHostname.startsWith('100:')
    || normalizedHostname.startsWith('2001:db8:')
    || normalizedHostname.startsWith('2002:')
    || normalizedHostname.startsWith('fc')
    || normalizedHostname.startsWith('fd')
    || /^fe[89ab]/i.test(normalizedHostname)
    || normalizedHostname.startsWith('ff')
}

const isBlockedDiscoveryWebsiteHostname = (hostname) => {
  const normalizedHostname = normalizeDiscoveryWebsiteHostname(hostname)
  if (!normalizedHostname) return true
  if (normalizedHostname === 'localhost' || normalizedHostname.endsWith('.localhost')) return true

  const ipType = isIP(normalizedHostname)
  if (ipType === 4) return isBlockedDiscoveryIpv4(normalizedHostname)
  if (ipType === 6) return isBlockedDiscoveryIpv6(normalizedHostname)

  return false
}

const normalizeWebsiteSourceForValidation = (value) => {
  try {
    const parsedUrl = new URL(String(value || '').trim())
    parsedUrl.hash = ''
    parsedUrl.hostname = parsedUrl.hostname.toLowerCase()
    return parsedUrl.toString()
  } catch {
    return ''
  }
}

const discoveryWebsiteSourceSchema = z
  .string()
  .trim()
  .max(500, 'Website source URL must be 500 characters or fewer')
  .refine((value) => /^https:\/\//i.test(value), {
    message: 'Enter the full URL including https://',
  })
  .refine((value) => {
    if (!/^https:\/\//i.test(value)) return true
    try {
      const parsedUrl = new URL(value)
      return parsedUrl.protocol === 'https:' && !parsedUrl.username && !parsedUrl.password
    } catch {
      return false
    }
  }, {
    message: 'Website source must be a valid https URL.',
  })
  .refine((value) => {
    try {
      const parsedUrl = new URL(value)
      if (parsedUrl.protocol !== 'https:') return true
      return !isBlockedDiscoveryWebsiteHostname(parsedUrl.hostname)
    } catch {
      return true
    }
  }, {
    message: 'Website source must be a publicly accessible domain.',
  })

const discoveryInputsSchema = z.object({
  companyWebsite: z.string().trim().max(500, 'companyWebsite must be 500 characters or fewer').optional().default(''),
  websiteSources: z
    .array(discoveryWebsiteSourceSchema)
    .max(DISCOVERY_WEBSITE_SOURCE_LIMIT, `websiteSources must contain ${DISCOVERY_WEBSITE_SOURCE_LIMIT} URLs or fewer`)
    .optional()
    .default([]),
  companyName: z.string().trim().max(255, 'companyName must be 255 characters or fewer').optional().default(''),
  marketRegion: z.string().trim().max(255, 'marketRegion must be 255 characters or fewer').optional().default(''),
  targetOffer: z.string().trim().max(500, 'targetOffer must be 500 characters or fewer').optional().default(''),
  notes: z.string().trim().max(4000, 'notes must be 4000 characters or fewer').optional().default(''),
}).strict().superRefine((data, ctx) => {
  const seenWebsiteSources = new Set()

  data.websiteSources.forEach((websiteSource, index) => {
    const normalizedSource = normalizeWebsiteSourceForValidation(websiteSource)
    if (!normalizedSource) return
    if (seenWebsiteSources.has(normalizedSource)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['websiteSources', index],
        message: 'Website source URLs must not contain duplicates.',
      })
      return
    }
    seenWebsiteSources.add(normalizedSource)
  })
})

const discoveryAcquisitionProfileSchema = z
  .preprocess(
    (value) => {
      if (value === undefined || value === null) return undefined
      const normalized = String(value).trim().toUpperCase()
      return normalized || undefined
    },
    z
      .string()
      .refine((value) => ENABLED_DISCOVERY_ACQUISITION_PROFILES.includes(value), {
        message: DISCOVERY_ACQUISITION_PROFILE_ERROR_MESSAGE,
      })
      .optional(),
  )

const updateDiscoveryInputsSchema = z.object({
  inputs: discoveryInputsSchema,
  acquisitionProfile: discoveryAcquisitionProfileSchema,
  documentSources: z.array(z.object({
    fileName: z
      .string({ required_error: 'fileName is required' })
      .trim()
      .min(1, 'fileName is required')
      .max(255, 'fileName must be 255 characters or fewer'),
    mimeType: z
      .string()
      .trim()
      .max(120, 'mimeType must be 120 characters or fewer')
      .optional()
      .default(''),
    assetType: z
      .string()
      .trim()
      .max(80, 'assetType must be 80 characters or fewer')
      .optional()
      .default('CUSTOMER_DOCUMENT'),
    sizeBytes: z
      .number()
      .int()
      .min(1, 'sizeBytes must be at least 1')
      .optional(),
    contentBase64: z
      .string()
      .trim()
      .optional(),
    textContent: z
      .string()
      .trim()
      .max(80000, 'textContent must be 80000 characters or fewer')
      .optional(),
  }).strict().superRefine(validateDocumentSourcePayload)).max(5, 'documentSources must contain 5 documents or fewer').optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
}).strict()

const sectionEvidenceDocumentSourceSchema = z.object({
  fileName: z
    .string({ required_error: 'fileName is required' })
    .trim()
    .min(1, 'fileName is required')
    .max(255, 'fileName must be 255 characters or fewer'),
  mimeType: z
    .string()
    .trim()
    .max(120, 'mimeType must be 120 characters or fewer')
    .optional()
    .default(''),
  assetType: z
    .string()
    .trim()
    .max(80, 'assetType must be 80 characters or fewer')
    .optional()
    .default('SECTION_SUPPORTING_FILE'),
  sizeBytes: z
    .number()
    .int()
    .min(1, 'sizeBytes must be at least 1')
    .optional(),
  contentBase64: z
    .string()
    .trim()
    .optional(),
  textContent: z
    .string()
    .trim()
    .max(80000, 'textContent must be 80000 characters or fewer')
    .optional(),
}).strict().superRefine(validateDocumentSourcePayload)

const sectionEvidenceTargetSchema = {
  expectedUpdatedAt: expectedUpdatedAtSchema,
  runtimePath: z
    .string()
    .trim()
    .min(1, 'runtimePath must not be empty')
    .max(200, 'runtimePath must be 200 characters or fewer')
    .optional(),
  sectionKey: z
    .string()
    .trim()
    .min(1, 'sectionKey must not be empty')
    .max(120, 'sectionKey must be 120 characters or fewer')
    .optional(),
}

const refineSectionEvidenceTarget = (label) => (data, ctx) => {
  if (!data.runtimePath && !data.sectionKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_root'],
      message: `${label} requires runtimePath or sectionKey.`,
    })
    return
  }

  if (data.runtimePath && !getSectionKeyFromRuntimePath(data.runtimePath)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['runtimePath'],
      message: 'runtimePath must resolve under framework_state.sections.',
    })
  }

  if (data.runtimePath && data.sectionKey) {
    const runtimePathSectionKey = getSectionKeyFromRuntimePath(data.runtimePath)
    const sectionKeyLooksStateBacked = /^[a-z][a-z0-9_]*$/i.test(data.sectionKey)
    if (sectionKeyLooksStateBacked && runtimePathSectionKey && runtimePathSectionKey !== data.sectionKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['_root'],
        message: 'runtimePath and sectionKey must target the same section.',
      })
    }
  }
}

const updateRuntimeSectionEvidenceSchema = z.object({
  ...sectionEvidenceTargetSchema,
  documentSources: z
    .array(sectionEvidenceDocumentSourceSchema)
    .min(1, 'documentSources must contain at least 1 document')
    .max(5, 'documentSources must contain 5 documents or fewer'),
}).strict().superRefine(refineSectionEvidenceTarget('Section evidence upload'))

const reviewRuntimeSectionEvidenceSchema = z.object({
  ...sectionEvidenceTargetSchema,
  reviewStatus: z
    .string({ required_error: 'reviewStatus is required' })
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => ['PENDING', 'ACCEPTED', 'REJECTED'].includes(value), {
      message: 'reviewStatus must be PENDING, ACCEPTED, or REJECTED',
    }),
}).strict().superRefine(refineSectionEvidenceTarget('Section evidence review'))

const reviewAllRuntimeSectionEvidenceSchema = z.object({
  ...sectionEvidenceTargetSchema,
  reviewStatus: z
    .string({ required_error: 'reviewStatus is required' })
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value === 'ACCEPTED', {
      message: 'reviewStatus must be ACCEPTED',
    }),
}).strict().superRefine(refineSectionEvidenceTarget('Section evidence bulk review'))

const clearRuntimeSectionEvidenceSchema = z.object({
  ...sectionEvidenceTargetSchema,
  confirmClear: z
    .boolean({ required_error: 'confirmClear is required' })
    .refine((value) => value === true, {
      message: 'confirmClear must be true',
    }),
  reason: z
    .string()
    .trim()
    .max(500, 'reason must be 500 characters or fewer')
    .optional()
    .default('USER_REQUESTED_SECTION_EVIDENCE_CLEAR'),
}).strict().superRefine(refineSectionEvidenceTarget('Section evidence clear'))

const acceptRuntimeDiscoverySchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
}).strict()

const rebuildRuntimeIntelligenceGraphSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  trigger: z
    .string()
    .trim()
    .max(80, 'trigger must be 80 characters or fewer')
    .transform((value) => value.toUpperCase())
    .optional()
    .default('EXPLICIT_REBUILD'),
}).strict()

const resetRuntimeDiscoverySchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  confirmReset: z
    .boolean({ required_error: 'confirmReset is required' })
    .refine((value) => value === true, {
      message: 'confirmReset must be true',
    }),
  reason: z
    .string()
    .trim()
    .max(500, 'reason must be 500 characters or fewer')
    .optional()
    .default('USER_REQUESTED_DISCOVERY_RESET'),
}).strict()

const reviewRuntimeDiscoveryEvidenceSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  reviewStatus: z
    .string({ required_error: 'reviewStatus is required' })
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => ['PENDING', 'ACCEPTED', 'REJECTED'].includes(value), {
      message: 'reviewStatus must be PENDING, ACCEPTED, or REJECTED',
    }),
}).strict()

const acceptRuntimeSectionSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  runtimePath: z
    .string()
    .trim()
    .min(1, 'runtimePath must not be empty')
    .max(200, 'runtimePath must be 200 characters or fewer')
    .optional(),
  sectionKey: z
    .string()
    .trim()
    .min(1, 'sectionKey must not be empty')
    .max(120, 'sectionKey must be 120 characters or fewer')
    .optional(),
}).strict()

const executeRuntimeActionSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  inputs: discoveryInputsSchema.optional(),
  acquisitionProfile: discoveryAcquisitionProfileSchema,
  documentSources: z.array(z.object({
    fileName: z
      .string({ required_error: 'fileName is required' })
      .trim()
      .min(1, 'fileName is required')
      .max(255, 'fileName must be 255 characters or fewer'),
    mimeType: z
      .string()
      .trim()
      .max(120, 'mimeType must be 120 characters or fewer')
      .optional()
      .default(''),
    assetType: z
      .string()
      .trim()
      .max(80, 'assetType must be 80 characters or fewer')
      .optional()
      .default('CUSTOMER_DOCUMENT'),
    sizeBytes: z
      .number()
      .int()
      .min(1, 'sizeBytes must be at least 1')
      .optional(),
    contentBase64: z
      .string()
      .trim()
      .optional(),
    textContent: z
      .string()
      .trim()
      .max(80000, 'textContent must be 80000 characters or fewer')
      .optional(),
  }).strict().superRefine(validateDocumentSourcePayload)).max(5, 'documentSources must contain 5 documents or fewer').optional(),
  runtimePath: z
    .string()
    .trim()
    .min(1, 'runtimePath must not be empty')
    .max(200, 'runtimePath must be 200 characters or fewer')
    .optional(),
  sectionKey: z
    .string()
    .trim()
    .min(1, 'sectionKey must not be empty')
    .max(120, 'sectionKey must be 120 characters or fewer')
    .optional(),
  forceRegenerateReason: z
    .string()
    .trim()
    .min(1, 'forceRegenerateReason must not be empty')
    .max(500, 'forceRegenerateReason must be 500 characters or fewer')
    .optional(),
  additionalContext: z
    .string()
    .trim()
    .min(1, 'additionalContext must not be empty')
    .max(4000, 'additionalContext must be 4000 characters or fewer')
    .optional(),
  generationMode: z
    .enum(['ENRICHED_SECTION_TRUTH'])
    .optional(),
}).strict()

const GENERATION_RUNTIME_ACTIONS = new Set(['GENERATE_SECTION', 'REGENERATE_SECTION'])
const DISCOVERY_INPUT_RUNTIME_ACTIONS = new Set([
  'SAVE_DISCOVERY_INPUTS',
  'BUILD_EVIDENCE_PACK',
  'REFRESH_EVIDENCE_PACK',
])

const getSectionKeyFromRuntimePath = (runtimePath) => {
  const pathParts = String(runtimePath || '').trim().split('.').filter(Boolean)
  if (pathParts[0] !== 'framework_state' || pathParts[1] !== 'sections') return ''
  return String(pathParts[2] || '').trim()
}

const buildExecuteRuntimeActionSchema = (actionKey) => executeRuntimeActionSchema.superRefine((data, ctx) => {
  const hasRuntimePath = data.runtimePath !== undefined
  const hasSectionKey = data.sectionKey !== undefined
  const hasInputs = data.inputs !== undefined
  const hasAcquisitionProfile = data.acquisitionProfile !== undefined
  const hasDocumentSources = data.documentSources !== undefined
  const hasForceRegenerateReason = data.forceRegenerateReason !== undefined
  const hasAdditionalContext = data.additionalContext !== undefined
  const hasGenerationMode = data.generationMode !== undefined

  if (GENERATION_RUNTIME_ACTIONS.has(actionKey)) {
    if (!hasRuntimePath && !hasSectionKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['_root'],
        message: 'Generation actions require runtimePath or sectionKey.',
      })
    }

    if (hasRuntimePath && hasSectionKey) {
      const runtimePathSectionKey = getSectionKeyFromRuntimePath(data.runtimePath)
      const sectionKeyLooksStateBacked = /^[a-z][a-z0-9_]*$/i.test(data.sectionKey)
      if (sectionKeyLooksStateBacked && runtimePathSectionKey && runtimePathSectionKey !== data.sectionKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['_root'],
          message: 'runtimePath and sectionKey must target the same section.',
        })
      }
    }
  } else if (hasRuntimePath || hasSectionKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_root'],
      message: 'runtimePath and sectionKey are only allowed for generation actions.',
    })
  }

  if ((hasAdditionalContext || hasGenerationMode) && !GENERATION_RUNTIME_ACTIONS.has(actionKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_root'],
      message: 'additionalContext and generationMode are only allowed for generation actions.',
    })
  }

  if (hasForceRegenerateReason && actionKey !== 'REGENERATE_SECTION') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_root'],
      message: 'forceRegenerateReason is only allowed for REGENERATE_SECTION.',
    })
  }

  if (hasInputs && !DISCOVERY_INPUT_RUNTIME_ACTIONS.has(actionKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_root'],
      message: 'inputs are only allowed for Intelligence Hub evidence build actions.',
    })
  }

  if (hasAcquisitionProfile && !DISCOVERY_INPUT_RUNTIME_ACTIONS.has(actionKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_root'],
      message: 'acquisitionProfile is only allowed for Intelligence Hub evidence build actions.',
    })
  }

  if (hasDocumentSources && !DISCOVERY_INPUT_RUNTIME_ACTIONS.has(actionKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_root'],
      message: 'documentSources are only allowed for Intelligence Hub evidence build actions.',
    })
  }
})

const buildValidationErrorResponse = ({ details, message, requestId }) => ({
  error: {
    code: 'VALIDATION_FAILED',
    message,
    details,
    requestId,
  },
})

const listRuntimeInstancesSchema = z.object({
  customerId: z
    .string({ required_error: 'customerId is required' })
    .regex(objectIdRegex, 'customerId must be a valid ObjectId'),
  tenantId: z
    .string({ required_error: 'tenantId is required' })
    .regex(objectIdRegex, 'tenantId must be a valid ObjectId'),
  // Keep preprocess instead of z.enum(required_error): this Zod version emits
  // the generic enum message for missing query values.
  runtimeType: z
    .preprocess(
      (value) => (value === undefined ? '' : value),
      z
        .string()
        .trim()
        .min(1, 'runtimeType is required')
        .refine(
          (value) => !value || Object.values(RUNTIME_TYPES).includes(value),
          'runtimeType must be a supported runtime type',
        ),
    ),
  status: z
    .enum(Object.values(RUNTIME_INSTANCE_STATUSES), {
      invalid_type_error: 'status must be a supported runtime instance status',
    })
    .optional(),
  q: z
    .string()
    .trim()
    .max(255, 'Search query must be 255 characters or fewer')
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict()

const createRuntimeOutputRequestSchema = z.object({
  outputTypeKey: z
    .string({ required_error: 'outputTypeKey is required' })
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => Object.values(OUTPUT_LAB_OUTPUT_TYPE_KEYS).includes(value), {
      message: 'outputTypeKey must be a supported Output Lab type',
    }),
}).strict()

const createGovernedReasoningExecutionSchema = z.object({
  outputTypeKey: z
    .string({ required_error: 'outputTypeKey is required' })
    .trim()
    .min(1, 'outputTypeKey is required')
    .max(80, 'outputTypeKey must be 80 characters or fewer')
    .transform((value) => value.toUpperCase()),
  executionIntent: z
    .string()
    .trim()
    .max(2000, 'executionIntent must be 2000 characters or fewer')
    .optional(),
  manifestId: z
    .string()
    .trim()
    .min(1, 'manifestId must not be empty')
    .max(260, 'manifestId must be 260 characters or fewer')
    .optional(),
  workspaceType: z
    .string()
    .trim()
    .min(1, 'workspaceType must not be empty')
    .max(80, 'workspaceType must be 80 characters or fewer')
    .transform((value) => value.toUpperCase())
    .optional(),
  environmentKey: z
    .string()
    .trim()
    .min(1, 'environmentKey must not be empty')
    .max(80, 'environmentKey must be 80 characters or fewer')
    .transform((value) => value.toUpperCase())
    .optional(),
  contextCategories: z
    .array(z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()))
    .max(12, 'contextCategories must contain 12 entries or fewer')
    .optional(),
}).strict()

const createRuntimeOutcomeSessionSchema = z.object({
  sourceOutputAssetId: z
    .string()
    .trim()
    .min(1, 'sourceOutputAssetId must not be empty')
    .max(180, 'sourceOutputAssetId must be 180 characters or fewer')
    .optional(),
  prompt: z
    .string()
    .trim()
    .min(1, 'prompt must not be empty')
    .max(2000, 'prompt must be 2000 characters or fewer')
    .optional(),
}).strict()

const createRuntimeOutcomeMessageSchema = z.object({
  prompt: z
    .string({ required_error: 'prompt is required' })
    .trim()
    .min(1, 'prompt must not be empty')
    .max(2000, 'prompt must be 2000 characters or fewer'),
}).strict()

const runtimeOutcomeSessionParamsSchema = runtimeInstanceIdSchema.extend({
  sessionId: z
    .string({ required_error: 'sessionId is required' })
    .trim()
    .min(1, 'sessionId is required')
    .max(180, 'sessionId must be 180 characters or fewer'),
})

const runtimeOutcomeMessageParamsSchema = runtimeOutcomeSessionParamsSchema.extend({
  messageId: z
    .string({ required_error: 'messageId is required' })
    .trim()
    .min(1, 'messageId is required')
    .max(180, 'messageId must be 180 characters or fewer'),
})

const runtimeOutcomeAssetParamsSchema = runtimeInstanceIdSchema.extend({
  outcomeAssetId: z
    .string({ required_error: 'outcomeAssetId is required' })
    .trim()
    .min(1, 'outcomeAssetId is required')
    .max(180, 'outcomeAssetId must be 180 characters or fewer'),
})

const runtimeOutcomeAssetVersionParamsSchema = runtimeOutcomeAssetParamsSchema.extend({
  outcomeAssetVersionId: z
    .string({ required_error: 'outcomeAssetVersionId is required' })
    .trim()
    .min(1, 'outcomeAssetVersionId is required')
    .max(180, 'outcomeAssetVersionId must be 180 characters or fewer'),
})

const runtimeOutcomeAssetExportParamsSchema = runtimeOutcomeAssetParamsSchema.extend({
  format: z
    .string({ required_error: 'format is required' })
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => Object.values(OUTCOME_STUDIO_EXPORT_FORMATS).includes(value), {
      message: 'format must be MARKDOWN, JSON, DOCX, or PDF',
    }),
})

const emptyRuntimeOutputMutationSchema = z.object({}).strict()

export const validateCreateRuntimeInstance = createBodyValidator(createRuntimeInstanceSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateCreateRuntimeRevision = createBodyValidator(createRuntimeRevisionSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateMutateRuntimeState = createBodyValidator(mutateRuntimeStateSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateUpdateDiscoveryInputs = createBodyValidator(updateDiscoveryInputsSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateAcceptRuntimeDiscovery = createBodyValidator(acceptRuntimeDiscoverySchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateRebuildRuntimeIntelligenceGraph = createBodyValidator(rebuildRuntimeIntelligenceGraphSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateResetRuntimeDiscovery = createBodyValidator(resetRuntimeDiscoverySchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateRuntimeDiscoveryEvidenceParams = createParamsValidator(runtimeDiscoveryEvidenceParamsSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateReviewRuntimeDiscoveryEvidence = createBodyValidator(reviewRuntimeDiscoveryEvidenceSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateRuntimeSectionEvidenceParams = createParamsValidator(runtimeSectionEvidenceParamsSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateUpdateRuntimeSectionEvidence = createBodyValidator(updateRuntimeSectionEvidenceSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateReviewRuntimeSectionEvidence = createBodyValidator(reviewRuntimeSectionEvidenceSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateReviewAllRuntimeSectionEvidence = createBodyValidator(reviewAllRuntimeSectionEvidenceSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateClearRuntimeSectionEvidence = createBodyValidator(clearRuntimeSectionEvidenceSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateAcceptRuntimeSection = (req, res, next) => {
  const result = acceptRuntimeSectionSchema.safeParse(req.body)

  if (!result.success) {
    const details = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_root'
      details[key] = issue.message
    }

    return res.status(422).json(buildValidationErrorResponse({
      details,
      message: 'Request validation failed.',
      requestId: req.requestId,
    }))
  }

  if (!result.data.runtimePath && !result.data.sectionKey) {
    return res.status(422).json(buildValidationErrorResponse({
      details: {
        _root: 'Section acceptance requires runtimePath or sectionKey.',
      },
      message: 'Request validation failed.',
      requestId: req.requestId,
    }))
  }

  req.body = result.data
  return next()
}

export const validateExecuteRuntimeAction = (req, res, next) => {
  const actionKey = String(req.params?.actionKey || '').trim().toUpperCase()
  const result = buildExecuteRuntimeActionSchema(actionKey).safeParse(req.body)

  if (!result.success) {
    const details = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_root'
      details[key] = issue.message
    }

    return res.status(422).json(buildValidationErrorResponse({
      details,
      message: 'Request validation failed.',
      requestId: req.requestId,
    }))
  }

  req.body = result.data
  return next()
}

export const validateListRuntimeInstances = createQueryValidator(listRuntimeInstancesSchema, {
  message: 'Invalid query parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeInstanceId = createParamsValidator(runtimeInstanceIdSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeIntelligenceGraphNodeParams = createParamsValidator(runtimeIntelligenceGraphNodeParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeIntelligenceGraphSectionParams = createParamsValidator(runtimeIntelligenceGraphSectionParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeIntelligenceGraphQueryParams = createParamsValidator(runtimeIntelligenceGraphQueryParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeActionParams = createParamsValidator(runtimeActionParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeOutputRequestParams = createParamsValidator(runtimeOutputRequestParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeOutputAssetParams = createParamsValidator(runtimeOutputAssetParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateGovernedReasoningExecutionParams = createParamsValidator(governedReasoningExecutionParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeOutputAssetExportParams = createParamsValidator(runtimeOutputAssetExportParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateCreateRuntimeOutputRequest = createBodyValidator(createRuntimeOutputRequestSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateCreateGovernedReasoningExecution = createBodyValidator(createGovernedReasoningExecutionSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateCreateRuntimeOutcomeSession = createBodyValidator(createRuntimeOutcomeSessionSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateCreateRuntimeOutcomeMessage = createBodyValidator(createRuntimeOutcomeMessageSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateRuntimeOutcomeSessionParams = createParamsValidator(runtimeOutcomeSessionParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeOutcomeMessageParams = createParamsValidator(runtimeOutcomeMessageParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeOutcomeAssetParams = createParamsValidator(runtimeOutcomeAssetParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeOutcomeAssetVersionParams = createParamsValidator(runtimeOutcomeAssetVersionParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeOutcomeAssetExportParams = createParamsValidator(runtimeOutcomeAssetExportParamsSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})

export const validateGenerateRuntimeOutcomeResponse = createBodyValidator(emptyRuntimeOutputMutationSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateUpdateRuntimeOutcomeSessionFromLatestTruth = createBodyValidator(emptyRuntimeOutputMutationSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validatePublishRuntimeOutcomeAsset = createBodyValidator(emptyRuntimeOutputMutationSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateGenerateRuntimeOutputRequest = createBodyValidator(emptyRuntimeOutputMutationSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validatePublishRuntimeOutputAsset = createBodyValidator(emptyRuntimeOutputMutationSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})
