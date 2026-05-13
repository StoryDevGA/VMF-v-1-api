import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import {
  FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES,
  FRAMEWORK_PACKAGE_EVALUATION_MODES,
  FRAMEWORK_PACKAGE_EXECUTION_MODES,
  FRAMEWORK_PACKAGE_RETRY_POLICIES,
  FRAMEWORK_PACKAGE_SCOPES,
  FRAMEWORK_PACKAGE_STATE_BINDING_MODES,
  FRAMEWORK_PACKAGE_STATE_MODEL_MODES,
  FRAMEWORK_PACKAGE_STATE_MODELS,
  FRAMEWORK_PACKAGE_STATE_PERSISTENCE_MODES,
  FRAMEWORK_PACKAGE_STATUSES,
  FRAMEWORK_PACKAGE_TYPES,
  FRAMEWORK_PACKAGE_VALIDATION_TRIGGERS,
  FRAMEWORK_PACKAGE_VISIBILITY,
  FRAMEWORK_PACKAGE_WORKFLOW_EXECUTION_CONTEXTS,
} from '../models/FrameworkPackage.js'
import { DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES } from '../constants/frameworkPackageContract.js'

const objectIdRegex = /^[a-f\d]{24}$/i
const frameworkKeyRegex = /^[A-Z][A-Z0-9_]*$/
const versionRegex = /^\d+\.\d+\.\d+$/
const tokenRegex = /^[a-z][a-z0-9-]*$/
const sectionKeyRegex = /^[a-z][a-z0-9_-]*$/
const runtimePathRegex = /^\S+$/
const customerIdRegex = /^[A-Za-z0-9][A-Za-z0-9_-]{1,119}$/
const validationParametersMaxCharacters = 4096
const validationParametersMaxDepth = 5

const createStatusValues = [
  FRAMEWORK_PACKAGE_STATUSES.DRAFT,
  FRAMEWORK_PACKAGE_STATUSES.VALIDATED,
  FRAMEWORK_PACKAGE_STATUSES.DEPRECATED,
]

const updateStatusValues = Object.values(FRAMEWORK_PACKAGE_STATUSES)
const checkpointModeValues = ['FULL', 'DRY_RUN']

const tokenListItemSchema = z
  .string()
  .trim()
  .min(1, 'Value is required')
  .max(120, 'Value must be 120 characters or fewer')
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => tokenRegex.test(value),
    'Value must use lowercase letters, numbers, or hyphens',
  )

const tokenListSchema = z
  .array(tokenListItemSchema)
  .max(200, 'List must contain 200 items or fewer')
  .transform((values) => [...new Set(values)])

const sectionKeySchema = z
  .string()
  .trim()
  .min(1, 'Section key is required')
  .max(120, 'Section key must be 120 characters or fewer')
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => sectionKeyRegex.test(value),
    'Section key must use lowercase letters, numbers, underscores, or hyphens',
  )

const runtimePathSchema = z
  .string()
  .trim()
  .min(1, 'Runtime path is required')
  .max(240, 'Runtime path must be 240 characters or fewer')
  .refine(
    (value) => runtimePathRegex.test(value),
    'Runtime path must not contain whitespace',
  )

const optionalTokenSchema = z
  .string()
  .trim()
  .max(120, 'Value must be 120 characters or fewer')
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => !value || tokenRegex.test(value),
    'Value must use lowercase letters, numbers, or hyphens',
  )
  .default('')

const nullableTokenSchema = z.preprocess(
  (value) => {
    const normalized = String(value ?? '').trim().toLowerCase()
    return normalized || null
  },
  z.union([
    z
      .string()
      .max(120, 'Value must be 120 characters or fewer')
      .refine(
        (value) => tokenRegex.test(value),
        'Value must use lowercase letters, numbers, or hyphens',
      ),
    z.null(),
  ]).default(null),
)

const nullableStringSchema = z.preprocess(
  (value) => {
    const normalized = String(value ?? '').trim()
    return normalized || null
  },
  z.union([
    z.string().max(50, 'Value must be 50 characters or fewer'),
    z.null(),
  ]).default(null),
)

const stateModelModeSchema = z.preprocess(
  (value) => String(value ?? FRAMEWORK_PACKAGE_STATE_MODEL_MODES.INTERNAL).trim().toUpperCase()
    || FRAMEWORK_PACKAGE_STATE_MODEL_MODES.INTERNAL,
  z.enum(Object.values(FRAMEWORK_PACKAGE_STATE_MODEL_MODES))
    .default(FRAMEWORK_PACKAGE_STATE_MODEL_MODES.INTERNAL),
)

const stateBindingModeSchema = z.preprocess(
  (value) => String(value ?? FRAMEWORK_PACKAGE_STATE_BINDING_MODES.STRICT).trim().toUpperCase()
    || FRAMEWORK_PACKAGE_STATE_BINDING_MODES.STRICT,
  z.enum(Object.values(FRAMEWORK_PACKAGE_STATE_BINDING_MODES))
    .default(FRAMEWORK_PACKAGE_STATE_BINDING_MODES.STRICT),
)

const statePersistenceSchema = z.preprocess(
  (value) => String(value ?? FRAMEWORK_PACKAGE_STATE_PERSISTENCE_MODES.SESSION).trim().toUpperCase()
    || FRAMEWORK_PACKAGE_STATE_PERSISTENCE_MODES.SESSION,
  z.enum(Object.values(FRAMEWORK_PACKAGE_STATE_PERSISTENCE_MODES))
    .default(FRAMEWORK_PACKAGE_STATE_PERSISTENCE_MODES.SESSION),
)

const customerIdListSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'Customer id is required')
      .max(120, 'Customer id must be 120 characters or fewer')
      .refine(
        (value) => customerIdRegex.test(value),
        'Customer id must use letters, numbers, underscores, or hyphens',
      ),
  )
  .max(200, 'Assigned customers must contain 200 items or fewer')
  .transform((values) => [...new Set(values)])

const capabilitiesSchema = z.object({
  supportsPreviewMode: z.boolean().default(false),
  supportsFullReport: z.boolean().default(false),
  requiresValidationBeforePublish: z.boolean().default(true),
})

const applyUniqueBy = (items, ctx, getKey, pathField, message) => {
  const seen = new Set()
  items.forEach((item, index) => {
    const key = getKey(item)
    if (!key) return

    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        // Parent array schemas prepend their field name, so this becomes e.g. validationBindings.1.bindingKey.
        path: [index, pathField],
        message,
      })
    }
    seen.add(key)
  })
}

const getJsonDepth = (value, depth = 0) => {
  if (value === null || typeof value !== 'object') return depth

  const values = Array.isArray(value) ? value : Object.values(value)
  if (values.length === 0) return depth + 1

  return Math.max(...values.map((child) => getJsonDepth(child, depth + 1)))
}

const validationParametersSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .superRefine((value, ctx) => {
    if (value === undefined) return

    let serialized = ''
    try {
      serialized = JSON.stringify(value)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Validation binding parameters must be serializable JSON.',
      })
      return
    }

    if (serialized.length > validationParametersMaxCharacters) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Validation binding parameters must be ${validationParametersMaxCharacters} characters or fewer.`,
      })
    }

    if (getJsonDepth(value) > validationParametersMaxDepth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Validation binding parameters cannot be nested more than ${validationParametersMaxDepth} levels.`,
      })
    }
  })

const sectionSchema = z.object({
  sectionKey: sectionKeySchema,
  runtimePath: runtimePathSchema,
  required: z.boolean().default(true),
  validationKeys: tokenListSchema.default([]),
  notes: z.string().trim().max(500, 'Section notes must be 500 characters or fewer').default(''),
})

const sectionsSchema = z
  .array(sectionSchema)
  .max(100, 'Sections must contain 100 items or fewer')
  .superRefine((items, ctx) => {
    applyUniqueBy(
      items,
      ctx,
      (item) => item.sectionKey,
      'sectionKey',
      'Section keys must be unique.',
    )
    applyUniqueBy(
      items,
      ctx,
      (item) => item.runtimePath,
      'runtimePath',
      'Section runtime paths must be unique.',
    )
  })

const runtimeSettingsSchema = z.object({
  enablePreviewMode: z.boolean().default(true),
  enableRuntimeValidation: z.boolean().default(true),
  requireValidationBeforePublish: z.boolean().default(true),
  allowManualValidationRun: z.boolean().default(true),
  allowPolicyRetry: z.boolean().default(true),
  retryPolicy: z.enum(Object.values(FRAMEWORK_PACKAGE_RETRY_POLICIES))
    .default(FRAMEWORK_PACKAGE_RETRY_POLICIES.RETRY_ONCE),
  defaultTimeoutMs: z.number().int().min(0).max(300000).default(30000),
  maxPolicyExecutionsPerRun: z.number().int().min(1).max(100).default(10),
})

const executionModelSchema = z.object({
  mode: z.enum(Object.values(FRAMEWORK_PACKAGE_EXECUTION_MODES))
    .default(FRAMEWORK_PACKAGE_EXECUTION_MODES.EVENT_DRIVEN),
  stateModel: z.enum(Object.values(FRAMEWORK_PACKAGE_STATE_MODELS))
    .default(FRAMEWORK_PACKAGE_STATE_MODELS.LIFECYCLE_BASED),
  evaluationMode: z.enum(Object.values(FRAMEWORK_PACKAGE_EVALUATION_MODES))
    .default(FRAMEWORK_PACKAGE_EVALUATION_MODES.POLICY_DRIVEN),
})

const deprecatedFrameworkPackageFieldSchema = (message) =>
  z.unknown().optional().superRefine((value, ctx) => {
    if (value === undefined) return

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
    })
  })

const validationBindingSchema = z.object({
  bindingKey: tokenListItemSchema,
  validationKey: tokenListItemSchema,
  trigger: z.enum(Object.values(FRAMEWORK_PACKAGE_VALIDATION_TRIGGERS)),
  blocking: z.boolean().default(true),
  priority: z.number().int().min(1).max(10000).default(100),
  freshnessMinutes: z.union([z.number().int().min(1).max(10080), z.null()]).default(null),
  enabled: z.boolean().default(true),
  parameters: validationParametersSchema,
  notes: z.string().trim().max(500, 'Validation binding notes must be 500 characters or fewer').default(''),
})

const validationBindingsSchema = z
  .array(validationBindingSchema)
  .max(100, 'Validation bindings must contain 100 items or fewer')
  .superRefine((items, ctx) => {
    applyUniqueBy(
      items,
      ctx,
      (item) => `${item.bindingKey}`,
      'bindingKey',
      'Validation binding id must be unique within a package.',
    )
  })

const workflowBindingSchema = z.object({
  policyKey: tokenListItemSchema,
  executionContext: z.enum(Object.values(FRAMEWORK_PACKAGE_WORKFLOW_EXECUTION_CONTEXTS)),
  priority: z.number().int().min(1).max(10000).default(100),
  enabled: z.boolean().default(true),
  notes: z.string().trim().max(500, 'Workflow binding notes must be 500 characters or fewer').default(''),
})

const workflowBindingsSchema = z
  .array(workflowBindingSchema)
  .max(100, 'Workflow bindings must contain 100 items or fewer')
  .superRefine((items, ctx) => {
    applyUniqueBy(
      items,
      ctx,
      (item) => `${item.policyKey}:${item.executionContext}`,
      'policyKey',
      'Workflow binding already exists for this execution context.',
    )
    applyUniqueBy(
      items,
      ctx,
      (item) => `${item.executionContext}:${item.priority}`,
      'priority',
      'Workflow binding priority must be unique within an execution context.',
    )
  })

const applyAccessRules = (value, ctx) => {
  if (
    value.visibility === FRAMEWORK_PACKAGE_VISIBILITY.CUSTOMER_VISIBLE
    && value.customerAccessMode === FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.SELECTED_CUSTOMERS
    && (!Array.isArray(value.assignedCustomerIds) || value.assignedCustomerIds.length === 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assignedCustomerIds'],
      message: 'Assigned customers are required when customer access is selected customers.',
    })
  }

  if (
    value.visibility === FRAMEWORK_PACKAGE_VISIBILITY.INTERNAL_ONLY
    && value.customerAccessMode === FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.SELECTED_CUSTOMERS
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customerAccessMode'],
      message: 'Internal-only packages must use all-customers access mode.',
    })
  }

  if (
    value.visibility === FRAMEWORK_PACKAGE_VISIBILITY.INTERNAL_ONLY
    && Array.isArray(value.assignedCustomerIds)
    && value.assignedCustomerIds.length > 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assignedCustomerIds'],
      message: 'Internal-only packages cannot be assigned to customers.',
    })
  }

  if (
    value.customerAccessMode === FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.ALL_CUSTOMERS
    && Array.isArray(value.assignedCustomerIds)
    && value.assignedCustomerIds.length > 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assignedCustomerIds'],
      message: 'Assigned customers must be empty when access mode is all customers.',
    })
  }
}

const createFrameworkPackageSchema = z.object({
  frameworkKey: z
    .string({ required_error: 'Framework key is required' })
    .trim()
    .min(1, 'Framework key is required')
    .max(100, 'Framework key must be 100 characters or fewer')
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => frameworkKeyRegex.test(value),
      'Framework key must use uppercase letters, numbers, or underscores',
    ),
  frameworkName: z
    .string({ required_error: 'Framework name is required' })
    .trim()
    .min(1, 'Framework name is required')
    .max(120, 'Framework name must be 120 characters or fewer'),
  version: z
    .string({ required_error: 'Version is required' })
    .trim()
    .min(1, 'Version is required')
    .max(50, 'Version must be 50 characters or fewer')
    .refine((value) => versionRegex.test(value), 'Version must use semantic version format'),
  packageKey: tokenListItemSchema.optional(),
  packageName: z
    .string()
    .trim()
    .max(160, 'Package name must be 160 characters or fewer')
    .optional(),
  packageScope: z
    .enum(Object.values(FRAMEWORK_PACKAGE_SCOPES))
    .default(FRAMEWORK_PACKAGE_SCOPES.SYSTEM),
  packageType: z
    .enum(Object.values(FRAMEWORK_PACKAGE_TYPES))
    .default(FRAMEWORK_PACKAGE_TYPES.STANDARD),
  derivedFromPackageId: z
    .string()
    .trim()
    .max(120, 'Derived package id must be 120 characters or fewer')
    .default(''),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .default(''),
  status: z
    .enum(createStatusValues)
    .default(FRAMEWORK_PACKAGE_STATUSES.DRAFT),
  visibility: z
    .enum(Object.values(FRAMEWORK_PACKAGE_VISIBILITY))
    .default(FRAMEWORK_PACKAGE_VISIBILITY.INTERNAL_ONLY),
  customerAccessMode: z
    .enum(Object.values(FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES))
    .default(FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES.ALL_CUSTOMERS),
  assignedCustomerIds: customerIdListSchema.default([]),
  sections: sectionsSchema.default([]),
  runtimeSettings: runtimeSettingsSchema.default({
    enablePreviewMode: true,
    enableRuntimeValidation: true,
    requireValidationBeforePublish: true,
    allowManualValidationRun: true,
    allowPolicyRetry: true,
    retryPolicy: FRAMEWORK_PACKAGE_RETRY_POLICIES.RETRY_ONCE,
    defaultTimeoutMs: 30000,
    maxPolicyExecutionsPerRun: 10,
  }),
  executionModel: executionModelSchema.default({
    mode: FRAMEWORK_PACKAGE_EXECUTION_MODES.EVENT_DRIVEN,
    stateModel: FRAMEWORK_PACKAGE_STATE_MODELS.LIFECYCLE_BASED,
    evaluationMode: FRAMEWORK_PACKAGE_EVALUATION_MODES.POLICY_DRIVEN,
  }),
  validationConfig: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.validationConfig),
  workflowPolicyConfig: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.workflowPolicyConfig),
  validationBindings: validationBindingsSchema.default([]),
  workflowBindings: workflowBindingsSchema.default([]),
  uiContractKey: optionalTokenSchema,
  stateModelKey: nullableTokenSchema,
  stateModelVersion: nullableStringSchema,
  stateModelMode: stateModelModeSchema,
  stateBindingMode: stateBindingModeSchema,
  statePersistence: statePersistenceSchema,
  stateContractNotes: z.string().trim().max(1000, 'State Contract notes must be 1000 characters or fewer').default(''),
  availableOutputKeys: tokenListSchema.default([]),
  defaultOutputStyles: tokenListSchema.default([]),
  allowCustomerOutputDefinitions: z.boolean().default(false),
  artifactRetentionDays: z.number().int().min(0).max(3650).default(365),
  allowOutputRevisionHistory: z.boolean().default(true),
  compatibleWorkflowKeys: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.compatibleWorkflowKeys),
  defaultAgentIds: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.defaultAgentIds),
  requiredSkillIds: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.requiredSkillIds),
  capabilities: capabilitiesSchema.default({
    supportsPreviewMode: false,
    supportsFullReport: false,
    requiresValidationBeforePublish: true,
  }),
  validationRules: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.validationRules),
}).superRefine(applyAccessRules)

const updateFrameworkPackageSchema = z.object({
  frameworkKey: z
    .string()
    .trim()
    .min(1, 'Framework key must not be empty')
    .max(100, 'Framework key must be 100 characters or fewer')
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => frameworkKeyRegex.test(value),
      'Framework key must use uppercase letters, numbers, or underscores',
    )
    .optional(),
  frameworkName: z
    .string()
    .trim()
    .min(1, 'Framework name must not be empty')
    .max(120, 'Framework name must be 120 characters or fewer')
    .optional(),
  version: z
    .string()
    .trim()
    .min(1, 'Version must not be empty')
    .max(50, 'Version must be 50 characters or fewer')
    .refine((value) => versionRegex.test(value), 'Version must use semantic version format')
    .optional(),
  packageKey: tokenListItemSchema.optional(),
  packageName: z
    .string()
    .trim()
    .max(160, 'Package name must be 160 characters or fewer')
    .optional(),
  packageScope: z
    .enum(Object.values(FRAMEWORK_PACKAGE_SCOPES))
    .optional(),
  packageType: z
    .enum(Object.values(FRAMEWORK_PACKAGE_TYPES))
    .optional(),
  derivedFromPackageId: z
    .string()
    .trim()
    .max(120, 'Derived package id must be 120 characters or fewer')
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .optional(),
  status: z
    .enum(updateStatusValues)
    .optional(),
  visibility: z
    .enum(Object.values(FRAMEWORK_PACKAGE_VISIBILITY))
    .optional(),
  customerAccessMode: z
    .enum(Object.values(FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES))
    .optional(),
  assignedCustomerIds: customerIdListSchema.optional(),
  sections: sectionsSchema.optional(),
  runtimeSettings: runtimeSettingsSchema.optional(),
  executionModel: executionModelSchema.optional(),
  validationConfig: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.validationConfig),
  workflowPolicyConfig: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.workflowPolicyConfig),
  validationBindings: validationBindingsSchema.optional(),
  workflowBindings: workflowBindingsSchema.optional(),
  uiContractKey: optionalTokenSchema.optional(),
  stateModelKey: nullableTokenSchema.optional(),
  stateModelVersion: nullableStringSchema.optional(),
  stateModelMode: stateModelModeSchema.optional(),
  stateBindingMode: stateBindingModeSchema.optional(),
  statePersistence: statePersistenceSchema.optional(),
  stateContractNotes: z.string().trim().max(1000, 'State Contract notes must be 1000 characters or fewer').optional(),
  availableOutputKeys: tokenListSchema.optional(),
  defaultOutputStyles: tokenListSchema.optional(),
  allowCustomerOutputDefinitions: z.boolean().optional(),
  artifactRetentionDays: z.number().int().min(0).max(3650).optional(),
  allowOutputRevisionHistory: z.boolean().optional(),
  compatibleWorkflowKeys: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.compatibleWorkflowKeys),
  defaultAgentIds: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.defaultAgentIds),
  requiredSkillIds: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.requiredSkillIds),
  capabilities: capabilitiesSchema.optional(),
  validationRules: deprecatedFrameworkPackageFieldSchema(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES.validationRules),
}).superRefine(applyAccessRules).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one updatable field is required.', path: ['frameworkKey'] },
)

const frameworkPackageIdSchema = z.object({
  packageId: z
    .string({ required_error: 'packageId is required' })
    .regex(objectIdRegex, 'packageId must be a valid ObjectId'),
})

const listFrameworkPackagesQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(255, 'Search query must be 255 characters or fewer')
    .optional(),
  status: z
    .enum(updateStatusValues)
    .optional(),
  frameworkKey: z
    .string()
    .trim()
    .min(1, 'Framework key must not be empty')
    .max(100, 'Framework key must be 100 characters or fewer')
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => frameworkKeyRegex.test(value),
      'Framework key must use uppercase letters, numbers, or underscores',
    )
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const runFrameworkPackageCheckpointBodySchema = z.object({
  mode: z
    .enum(checkpointModeValues, {
      errorMap: () => ({ message: 'Checkpoint mode must be FULL or DRY_RUN.' }),
    })
    .default('FULL'),
  persist: z.boolean().default(false),
}).strict()

const cloneFrameworkPackageSchema = z.object({
  version: z
    .string({ required_error: 'Version is required.' })
    .trim()
    .min(1, 'Version is required.')
    .max(50, 'Version must be 50 characters or fewer')
    .refine(
      (value) => versionRegex.test(value),
      'Version must use semantic version format.',
    ),
  packageKey: z
    .string({ required_error: 'Package key is required.' })
    .trim()
    .min(1, 'Package key is required.')
    .max(120, 'Package key must be 120 characters or fewer')
    .transform((value) => value.toLowerCase())
    .refine(
      (value) => tokenRegex.test(value),
      'Package key must use lowercase letters, numbers, or hyphens',
    ),
  packageName: z
    .string()
    .trim()
    .max(160, 'Package name must be 160 characters or fewer')
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer')
    .optional(),
}).strict()

export const captureFrameworkPackageUpdateFields = (req, _res, next) => {
  req.frameworkPackageUpdateFields = new Set(Object.keys(req.body && typeof req.body === 'object' ? req.body : {}))
  next()
}

export const validateCreateFrameworkPackage = createBodyValidator(createFrameworkPackageSchema)
export const validateUpdateFrameworkPackage = createBodyValidator(updateFrameworkPackageSchema)
export const validateCloneFrameworkPackage = createBodyValidator(cloneFrameworkPackageSchema)
export const validateFrameworkPackageId = createParamsValidator(frameworkPackageIdSchema)
export const validateListFrameworkPackages = createQueryValidator(listFrameworkPackagesQuerySchema)
export const validateRunFrameworkPackageCheckpoint = createBodyValidator(
  runFrameworkPackageCheckpointBodySchema,
)
