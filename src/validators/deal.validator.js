/**
 * Deal Validators
 *
 * Zod schemas for Deal management endpoints:
 *   - createDeal  — POST /api/v1/vmfs/:vmfId/deals
 *   - updateDeal  — PATCH /api/v1/deals/:dealId
 */

import { z } from 'zod'
import { createBodyValidator } from './shared.js'

/* ------------------------------------------------------------------ */
/*  Schemas                                                           */
/* ------------------------------------------------------------------ */

const createDealSchema = z.object({
  title: z
    .string({ required_error: 'Title is required' })
    .trim()
    .min(1, 'Title must not be empty')
    .max(500, 'Title must be 500 characters or fewer'),
  stage: z
    .string()
    .trim()
    .max(100, 'Stage must be 100 characters or fewer')
    .optional(),
  data: z
    .object({})
    .passthrough()
    .optional(),
})

const updateDealSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title must not be empty')
    .max(500, 'Title must be 500 characters or fewer')
    .optional(),
  stage: z
    .string()
    .trim()
    .max(100, 'Stage must be 100 characters or fewer')
    .nullable()
    .optional(),
  data: z
    .object({})
    .passthrough()
    .nullable()
    .optional(),
  status: z
    .enum(['ACTIVE', 'ARCHIVED'], {
      invalid_type_error: 'Status must be ACTIVE or ARCHIVED',
    })
    .optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided' },
)

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

export const validateCreateDeal = createBodyValidator(createDealSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})
export const validateUpdateDeal = createBodyValidator(updateDealSchema, {
  message: 'Request validation failed.',
  rootIssueKey: '_root',
})
