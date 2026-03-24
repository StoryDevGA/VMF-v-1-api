import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'

const objectIdRegex = /^[a-f\d]{24}$/i
const roleKeyRegex = /^[A-Z_]+$/
const permissionKeyRegex = /^[A-Z][A-Z0-9_]*$/
const roleScopes = ['PLATFORM', 'CUSTOMER', 'TENANT', 'VMF']

const roleKeySchema = z
  .string({ required_error: 'Role key is required' })
  .trim()
  .min(1, 'Role key is required')
  .max(100, 'Role key must be 100 characters or fewer')
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => roleKeyRegex.test(value),
    'Role key must contain only uppercase letters and underscores',
  )

const permissionSchema = z
  .string()
  .trim()
  .min(1, 'Permission key is required')
  .max(100, 'Permission key must be 100 characters or fewer')
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => permissionKeyRegex.test(value),
    'Permission key must use uppercase letters, numbers, and underscores',
  )

const createRoleSchema = z.object({
  key: roleKeySchema,
  name: z
    .string({ required_error: 'Role name is required' })
    .trim()
    .min(1, 'Role name is required')
    .max(255, 'Role name must be 255 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(1000, 'Description must be 1000 characters or fewer')
    .optional(),
  scope: z
    .enum(roleScopes, { errorMap: () => ({ message: 'Role scope is invalid' }) })
    .default('VMF'),
  permissions: z
    .array(permissionSchema)
    .min(1, 'At least one permission is required')
    .max(500, 'Permission list must contain 500 items or fewer')
    .refine(
      (permissions) => new Set(permissions).size === permissions.length,
      'Permission keys must be unique',
    ),
  isActive: z.boolean().default(true),
})

const updateRoleSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Role name must not be empty')
      .max(255, 'Role name must be 255 characters or fewer')
      .optional(),
    description: z
      .string()
      .trim()
      .max(1000, 'Description must be 1000 characters or fewer')
      .optional(),
    scope: z
      .enum(roleScopes, { errorMap: () => ({ message: 'Role scope is invalid' }) })
      .optional(),
    permissions: z
      .array(permissionSchema)
      .min(1, 'At least one permission is required')
      .max(500, 'Permission list must contain 500 items or fewer')
      .refine(
        (permissions) => new Set(permissions).size === permissions.length,
        'Permission keys must be unique',
      )
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined
      || value.description !== undefined
      || value.scope !== undefined
      || value.permissions !== undefined
      || value.isActive !== undefined,
    {
      message:
        'At least one updatable field is required: name, description, scope, permissions, or isActive',
      path: ['name'],
    },
  )

const listRolesQuerySchema = z.object({
  q: z.string().trim().max(255, 'Search query must be 255 characters or fewer').optional(),
  scope: z
    .enum(roleScopes, { errorMap: () => ({ message: 'Role scope is invalid' }) })
    .optional(),
  isSystem: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const roleIdSchema = z.object({
  roleId: z
    .string({ required_error: 'roleId is required' })
    .regex(objectIdRegex, 'roleId must be a valid ObjectId'),
})

export const validateCreateRole = createBodyValidator(createRoleSchema)
export const validateUpdateRole = createBodyValidator(updateRoleSchema)
export const validateListRoles = createQueryValidator(listRolesQuerySchema)
export const validateRoleId = createParamsValidator(roleIdSchema)
