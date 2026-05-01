import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import {
  UI_CONTRACT_COMPATIBILITY_MODES,
  UI_CONTRACT_SECTION_SOURCES,
  UI_CONTRACT_STATUSES,
} from '../models/UIContract.js'

const objectIdOrStableIdRegex = /^(?:[a-f\d]{24}|ui-contract-[a-z][a-z0-9-]*)$/i
const keyRegex = /^[a-z][a-z0-9-]*$/
const frameworkKeyRegex = /^[A-Z][A-Z0-9_]*$/
const semverRegex = /^\d+\.\d+\.\d+$/

const frameworkKeysSchema = z
  .array(
    z.string()
      .trim()
      .min(1, 'Framework key is required')
      .max(100, 'Framework key must be 100 characters or fewer')
      .transform((value) => value.toUpperCase())
      .refine((value) => frameworkKeyRegex.test(value), 'Framework key must use uppercase letters, numbers, or underscores'),
  )
  .min(1, 'At least one framework key is required.')
  .max(50, 'Framework keys must contain 50 items or fewer')
  .transform((values) => [...new Set(values)])

const tokenListBaseSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(100, 'Compatibility tags must contain 100 items or fewer')
  .transform((values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))])

const tokenListSchema = tokenListBaseSchema
  .default([])

const versionValueSchema = z
  .preprocess((value) => {
    if (value === undefined || value === null) return null
    const normalized = String(value).trim()
    return normalized || null
  }, z.string().max(50).refine((value) => semverRegex.test(value), 'Version must use semantic version format.').nullable())

const optionalVersionSchema = versionValueSchema
  .default(null)

const keyValueSchema = z
  .string()
  .trim()
  .max(140)
  .transform((value) => value.toLowerCase())
  .refine((value) => !value || keyRegex.test(value), 'Value must use lowercase letters, numbers, or hyphens.')

const optionalKeySchema = keyValueSchema.default('')

const frameworkKeyValueSchema = z
  .string()
  .trim()
  .max(100)
  .transform((value) => value.toUpperCase())
  .refine((value) => !value || frameworkKeyRegex.test(value), 'Framework key must use uppercase letters, numbers, or underscores')

const optionalFrameworkKeySchema = frameworkKeyValueSchema.default('')

const sectionSchema = z.object({
  sectionKey: z.string().trim().min(1).max(140),
  runtimePath: z.string().trim().max(240).default(''),
  sourcePackageKey: optionalKeySchema,
  source: z.enum(Object.values(UI_CONTRACT_SECTION_SOURCES)).default(UI_CONTRACT_SECTION_SOURCES.PACKAGE),
  isCustom: z.boolean().default(false),
  label: z.string().trim().min(1, 'Section label is required.').max(140),
  shortLabel: z.string().trim().max(80).default(''),
  helpText: z.string().trim().max(500).default(''),
  placeholder: z.string().trim().max(250).default(''),
  displayOrder: z.number().int().min(0).max(10000).default(0),
  isVisible: z.boolean().default(true),
  isEditable: z.boolean().default(true),
  isRequiredDisplay: z.boolean().default(false),
  isReadOnlyDisplay: z.boolean().default(false),
  isCollapsedByDefault: z.boolean().default(false),
  sectionGroup: z.string().trim().max(120).default(''),
  iconKey: z.string().trim().max(120).default(''),
  presentationKey: z.string().trim().max(120).default(''),
}).transform((value) => {
  const isCustom = value.isCustom || value.source === UI_CONTRACT_SECTION_SOURCES.CUSTOM
  return {
    ...value,
    source: isCustom ? UI_CONTRACT_SECTION_SOURCES.CUSTOM : UI_CONTRACT_SECTION_SOURCES.PACKAGE,
    isCustom,
  }
}).superRefine((value, ctx) => {
  if (value.isCustom) return
  if (String(value.runtimePath || '').trim()) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['runtimePath'],
    message: 'Package-backed UI Contract sections require a runtime path.',
  })
})

const lifecycleStageSchema = z.object({
  stageKey: z.string().trim().min(1).max(120).transform((value) => value.toUpperCase()),
  label: z.string().trim().min(1, 'Lifecycle label is required.').max(120),
  description: z.string().trim().max(250).default(''),
  badgeLabel: z.string().trim().max(80).default(''),
  displayOrder: z.number().int().min(0).max(10000).default(0),
  isVisible: z.boolean().default(true),
  badgePresentationKey: z.string().trim().max(120).default(''),
})

const actionSchema = z.object({
  actionKey: z.string().trim().min(1).max(120).transform((value) => value.toUpperCase()),
  governedAction: z.string().trim().max(120).default('').transform((value) => value.toUpperCase()),
  buttonLabel: z.string().trim().min(1, 'Button label is required.').max(120),
  confirmationTitle: z.string().trim().max(160).default(''),
  confirmationMessage: z.string().trim().max(500).default(''),
  successMessage: z.string().trim().max(250).default(''),
  failureMessage: z.string().trim().max(250).default(''),
  loadingMessage: z.string().trim().max(250).default(''),
  displayOrder: z.number().int().min(0).max(10000).default(0),
  isVisible: z.boolean().default(true),
  requiresConfirmation: z.boolean().default(false),
  presentationKey: z.string().trim().max(120).default(''),
}).transform((value) => ({
  ...value,
  governedAction: value.governedAction || value.actionKey,
}))

const assertUnique = (items, ctx, getKey, path, message) => {
  const seen = new Set()
  items.forEach((item, index) => {
    const key = getKey(item)
    if (!key) return
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, path],
        message,
      })
    }
    seen.add(key)
  })
}

const assertUniqueVisibleOrder = (items, ctx, path, message) => {
  const seen = new Set()
  items.forEach((item, index) => {
    if (item?.isVisible === false) return
    const key = String(item?.displayOrder ?? '').trim()
    if (!key) return
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, path],
        message,
      })
    }
    seen.add(key)
  })
}

const sectionsBaseSchema = z.array(sectionSchema).max(100).superRefine((items, ctx) => {
  assertUnique(items, ctx, (item) => String(item.sectionKey).trim().toLowerCase(), 'sectionKey', 'Section keys must be unique.')
  assertUniqueVisibleOrder(items, ctx, 'displayOrder', 'Visible section display order values must be unique.')
  items.forEach((item, index) => {
    if (item.isVisible !== false && !String(item.label || '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'label'],
        message: 'Visible sections require a label.',
      })
    }
  })
})

const sectionsSchema = sectionsBaseSchema.default([])

const lifecycleStagesBaseSchema = z.array(lifecycleStageSchema).max(100).superRefine((items, ctx) => {
  assertUnique(items, ctx, (item) => item.stageKey, 'stageKey', 'Lifecycle stage keys must be unique.')
  assertUniqueVisibleOrder(items, ctx, 'displayOrder', 'Visible lifecycle display order values must be unique.')
})

const lifecycleStagesSchema = lifecycleStagesBaseSchema.default([])

const actionsBaseSchema = z.array(actionSchema).max(100).superRefine((items, ctx) => {
  assertUnique(items, ctx, (item) => item.actionKey, 'actionKey', 'Action keys must be unique.')
  assertUniqueVisibleOrder(items, ctx, 'displayOrder', 'Visible action display order values must be unique.')
})

const actionsSchema = actionsBaseSchema.default([])

const createUIContractSchema = z.object({
  uiContractKey: z.string().trim().min(1).max(140).transform((value) => value.toLowerCase())
    .refine((value) => keyRegex.test(value), 'UI contract key must use lowercase letters, numbers, or hyphens.'),
  name: z.string().trim().min(1, 'Name is required.').max(160),
  description: z.string().trim().max(800).default(''),
  status: z.enum(Object.values(UI_CONTRACT_STATUSES)).default(UI_CONTRACT_STATUSES.DRAFT),
  frameworkKeys: frameworkKeysSchema,
  introducedInVersion: optionalVersionSchema,
  deprecatedInVersion: optionalVersionSchema,
  compatibilityTags: tokenListSchema,
  compatibilityMode: z.enum(Object.values(UI_CONTRACT_COMPATIBILITY_MODES)).default(UI_CONTRACT_COMPATIBILITY_MODES.INHERITED_MINOR),
  sourcePackageKey: optionalKeySchema,
  sourcePackageVersion: optionalVersionSchema,
  sourceFrameworkKey: optionalFrameworkKeySchema,
  sections: sectionsSchema,
  lifecycleStages: lifecycleStagesSchema,
  actions: actionsSchema,
  isSystem: z.boolean().default(false),
  isProtected: z.boolean().default(false),
  isLocked: z.boolean().default(false),
  clonedFromStableId: z.string().trim().max(180).default(''),
})

const updateUIContractSchema = z.object({
  uiContractKey: z.string().trim().min(1).max(140).transform((value) => value.toLowerCase())
    .refine((value) => keyRegex.test(value), 'UI contract key must use lowercase letters, numbers, or hyphens.')
    .optional(),
  name: z.string().trim().min(1, 'Name is required.').max(160).optional(),
  description: z.string().trim().max(800).optional(),
  status: z.enum(Object.values(UI_CONTRACT_STATUSES)).optional(),
  frameworkKeys: frameworkKeysSchema.optional(),
  introducedInVersion: versionValueSchema.optional(),
  deprecatedInVersion: versionValueSchema.optional(),
  compatibilityTags: tokenListBaseSchema.optional(),
  compatibilityMode: z.enum(Object.values(UI_CONTRACT_COMPATIBILITY_MODES)).optional(),
  sourcePackageKey: keyValueSchema.optional(),
  sourcePackageVersion: versionValueSchema.optional(),
  sourceFrameworkKey: frameworkKeyValueSchema.optional(),
  sections: sectionsBaseSchema.optional(),
  lifecycleStages: lifecycleStagesBaseSchema.optional(),
  actions: actionsBaseSchema.optional(),
  isSystem: z.boolean().optional(),
  isProtected: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  clonedFromStableId: z.string().trim().max(180).optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one updatable field is required.', path: ['name'] },
)

const uiContractIdSchema = z.object({
  uiContractId: z.string().trim().regex(objectIdOrStableIdRegex, 'uiContractId must be a valid id.'),
})

const listUIContractsQuerySchema = z.object({
  q: z.string().trim().max(255).optional(),
  status: z.enum(Object.values(UI_CONTRACT_STATUSES)).optional(),
  frameworkKey: z.string().trim().transform((value) => value.toUpperCase()).refine((value) => frameworkKeyRegex.test(value), 'Framework key must use uppercase letters, numbers, or underscores').optional(),
  version: z.string().trim().refine((value) => !value || semverRegex.test(value), 'Version must use semantic version format.').optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateCreateUIContract = createBodyValidator(createUIContractSchema)
export const validateUpdateUIContract = createBodyValidator(updateUIContractSchema)
export const validateUIContractId = createParamsValidator(uiContractIdSchema)
export const validateListUIContracts = createQueryValidator(listUIContractsQuerySchema)
