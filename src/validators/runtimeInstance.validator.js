import { z } from 'zod'
import { RUNTIME_INSTANCE_STATUSES, RUNTIME_TYPES } from '../models/RuntimeInstance.js'
import { createBodyValidator, createParamsValidator, createQueryValidator } from './shared.js'

const objectIdRegex = /^[a-f\d]{24}$/i

const runtimeInstanceIdSchema = z.object({
  runtimeInstanceId: z
    .string({ required_error: 'runtimeInstanceId is required' })
    .trim()
    .min(1, 'runtimeInstanceId is required')
    .max(180, 'runtimeInstanceId must be 180 characters or fewer'),
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
}).strict()

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

export const validateCreateRuntimeInstance = createBodyValidator(createRuntimeInstanceSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateMutateRuntimeState = createBodyValidator(mutateRuntimeStateSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})

export const validateListRuntimeInstances = createQueryValidator(listRuntimeInstancesSchema, {
  message: 'Invalid query parameters.',
  rootIssueKey: '_root',
})

export const validateRuntimeInstanceId = createParamsValidator(runtimeInstanceIdSchema, {
  message: 'Invalid request parameters.',
  rootIssueKey: '_root',
})
