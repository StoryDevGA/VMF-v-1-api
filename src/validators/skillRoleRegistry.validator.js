import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'
import {
  SKILL_ROLE_REGISTRY_CATEGORIES,
  SKILL_ROLE_REGISTRY_OPERATIONS,
  SKILL_ROLE_REGISTRY_STATUSES,
} from '../models/SkillRoleRegistry.js'

const roleIdRegex = /^role-[a-z0-9][a-z0-9-]*$/
const roleKeyRegex = /^[A-Z][A-Z0-9_]*$/
const skillRoleSortFieldValues = ['label', 'updatedAt', 'usageCount']
const sortOrderValues = ['asc', 'desc']
const governedMetadataFields = Object.freeze([
  'componentVersion',
  'versionStatus',
  'stableId',
  'lineageId',
  'isLocked',
  'lockedAt',
  'lockedBy',
  'lockedReason',
  'lockedByPackageKeys',
  'introducedInVersion',
  'deprecatedInVersion',
  'compatibilityMode',
  'compatibilityTags',
  'clonedFromStableId',
  'supersedesStableId',
  'supersededByStableId',
])

const skillRoleIdSchema = z.object({
  roleId: z
    .string({ required_error: 'roleId is required' })
    .trim()
    .transform((value) => value.toLowerCase())
    .refine((value) => roleIdRegex.test(value), 'roleId must use the stable role-<token> format'),
})

const listSkillRolesQuerySchema = z.object({
  q: z.string().trim().max(255, 'Search query must be 255 characters or fewer').optional(),
  status: z.enum(Object.values(SKILL_ROLE_REGISTRY_STATUSES)).optional(),
  sortBy: z.enum(skillRoleSortFieldValues).optional(),
  sortOrder: z.enum(sortOrderValues).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(20),
})

const roleKeySchema = z
  .string({ required_error: 'Role key is required' })
  .trim()
  .min(1, 'Role key is required')
  .max(80, 'Role key must be 80 characters or fewer')
  .transform((value) => value.toUpperCase())
  .refine((value) => roleKeyRegex.test(value), 'Role key must use uppercase letters, numbers, or underscores')

const immutableSystemFlagSchema = z
  .any()
  .optional()
  .refine(
    (value) => value === undefined,
    'System flag is managed by the platform and cannot be changed.',
  )

const governedMetadataFieldsSchema = Object.fromEntries(governedMetadataFields.map((field) => [
  field,
  z.any().optional().refine(
    (value) => value === undefined,
    `${field} is managed by the platform and cannot be changed.`,
  ),
]))

const tokenListSchema = z
  .array(z.string().trim().min(1).max(240))
  .default([])
  .transform((values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))])

const operationListSchema = z
  .array(z.enum(Object.values(SKILL_ROLE_REGISTRY_OPERATIONS)))
  .default([SKILL_ROLE_REGISTRY_OPERATIONS.READ])
  .transform((values) => [...new Set(values.map((value) => value.toUpperCase()))])

const createSkillRoleBodySchema = z.object({
  roleKey: roleKeySchema,
  label: z.string({ required_error: 'Label is required' }).trim().min(1, 'Label is required').max(120),
  description: z.string({ required_error: 'Description is required' }).trim().min(1, 'Description is required').max(800),
  status: z.enum(Object.values(SKILL_ROLE_REGISTRY_STATUSES)).default(SKILL_ROLE_REGISTRY_STATUSES.DRAFT),
  category: z.enum(Object.values(SKILL_ROLE_REGISTRY_CATEGORIES)).default(SKILL_ROLE_REGISTRY_CATEGORIES.EXECUTION_ROLE),
  allowedOperations: operationListSchema,
  allowedReadScopes: tokenListSchema,
  allowedWriteScopes: tokenListSchema,
  isSystem: immutableSystemFlagSchema,
  ...governedMetadataFieldsSchema,
})

const updateSkillRoleBodySchema = z.object({
  roleKey: roleKeySchema.optional(),
  label: z.string().trim().min(1, 'Label is required').max(120).optional(),
  description: z.string().trim().min(1, 'Description is required').max(800).optional(),
  status: z.enum(Object.values(SKILL_ROLE_REGISTRY_STATUSES)).optional(),
  category: z.enum(Object.values(SKILL_ROLE_REGISTRY_CATEGORIES)).optional(),
  allowedOperations: operationListSchema.optional(),
  allowedReadScopes: tokenListSchema.optional(),
  allowedWriteScopes: tokenListSchema.optional(),
  isSystem: immutableSystemFlagSchema,
  ...governedMetadataFieldsSchema,
})

const cloneSkillRoleBodySchema = z.object({
  roleKey: roleKeySchema,
  label: z.string({ required_error: 'Label is required' }).trim().min(1, 'Label is required').max(120),
  description: z.string({ required_error: 'Description is required' }).trim().min(1, 'Description is required').max(800),
  status: z.enum([SKILL_ROLE_REGISTRY_STATUSES.DRAFT]).optional(),
  category: z.enum(Object.values(SKILL_ROLE_REGISTRY_CATEGORIES)).optional(),
  allowedOperations: operationListSchema.optional(),
  allowedReadScopes: tokenListSchema.optional(),
  allowedWriteScopes: tokenListSchema.optional(),
  isSystem: immutableSystemFlagSchema,
  ...governedMetadataFieldsSchema,
})

export const validateSkillRoleId = createParamsValidator(skillRoleIdSchema)
export const validateListSkillRoles = createQueryValidator(listSkillRolesQuerySchema)
export const validateCreateSkillRole = createBodyValidator(createSkillRoleBodySchema)
export const validateUpdateSkillRole = createBodyValidator(updateSkillRoleBodySchema)
export const validateCloneSkillRole = createBodyValidator(cloneSkillRoleBodySchema)
