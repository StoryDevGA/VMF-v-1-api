import { z } from 'zod'
import {
  createBodyValidator,
  createParamsValidator,
  createQueryValidator,
} from './shared.js'

const objectIdRegex = /^[a-f\d]{24}$/i
const entitlementRegex = /^[A-Z][A-Z0-9_]*$/

const entitlementSchema = z
  .string()
  .trim()
  .min(1, 'Feature entitlement key is required')
  .max(100, 'Feature entitlement key must be 100 characters or fewer')
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => entitlementRegex.test(value),
    'Feature entitlement key must use uppercase letters, numbers, and underscores',
  )

const createLicenseLevelSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(1, 'Name is required')
    .max(255, 'Name must be 255 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(1000, 'Description must be 1000 characters or fewer')
    .optional(),
  featureEntitlements: z
    .array(entitlementSchema)
    .max(500, 'Feature entitlement list must contain 500 items or fewer')
    .default([])
    .refine(
      (entitlements) => new Set(entitlements).size === entitlements.length,
      'Feature entitlement keys must be unique',
    ),
  isActive: z.boolean().default(true),
})

const updateLicenseLevelSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name must not be empty')
      .max(255, 'Name must be 255 characters or fewer')
      .optional(),
    description: z
      .string()
      .trim()
      .max(1000, 'Description must be 1000 characters or fewer')
      .optional(),
    featureEntitlements: z
      .array(entitlementSchema)
      .max(500, 'Feature entitlement list must contain 500 items or fewer')
      .refine(
        (entitlements) => new Set(entitlements).size === entitlements.length,
        'Feature entitlement keys must be unique',
      )
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.featureEntitlements !== undefined ||
      value.isActive !== undefined,
    {
      message:
        'At least one updatable field is required: name, description, featureEntitlements, or isActive',
      path: ['name'],
    },
  )

const listLicenseLevelsQuerySchema = z.object({
  q: z.string().trim().max(255, 'Search query must be 255 characters or fewer').optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const licenseLevelIdSchema = z.object({
  licenseLevelId: z
    .string({ required_error: 'licenseLevelId is required' })
    .regex(objectIdRegex, 'licenseLevelId must be a valid ObjectId'),
})

export const validateCreateLicenseLevel = createBodyValidator(createLicenseLevelSchema)
export const validateUpdateLicenseLevel = createBodyValidator(updateLicenseLevelSchema)
export const validateListLicenseLevels = createQueryValidator(listLicenseLevelsQuerySchema)
export const validateLicenseLevelId = createParamsValidator(licenseLevelIdSchema)
