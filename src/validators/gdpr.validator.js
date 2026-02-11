/**
 * GDPR Validators (Phase 5.2)
 *
 * Zod-based request validation middleware for GDPR compliance endpoints.
 *
 * Schemas:
 *   - exportParamsSchema              — validates :userId param
 *   - createDeletionRequestSchema     — validates POST body (userId, legalBasis, reason)
 *   - listDeletionRequestsSchema      — validates query filters (status, userId, page, pageSize)
 *   - requestIdParamsSchema           — validates :requestId param
 *   - processDeletionRequestSchema    — validates process body (decision, reviewerNotes)
 *
 * All validators set `req.validatedParams`, `req.validatedBody`, or
 * `req.validatedQuery` on success, or respond with a 422 VALIDATION_FAILED
 * error envelope on failure.
 */

import { z } from 'zod'

const objectIdRegex = /^[a-f\d]{24}$/i

const objectIdString = z.string().regex(objectIdRegex, 'Must be a valid ObjectId')

const exportParamsSchema = z.object({
  userId: objectIdString,
})

const createDeletionRequestSchema = z.object({
  userId: objectIdString,
  legalBasis: z
    .enum(['USER_REQUEST', 'ACCOUNT_CLOSURE', 'RETENTION_POLICY', 'ADMIN_REQUEST'])
    .optional(),
  reason: z.string().trim().max(2000, 'Reason must be 2000 characters or fewer').optional(),
})

const listDeletionRequestsSchema = z.object({
  status: z.enum(['PENDING', 'REJECTED', 'COMPLETED']).optional(),
  userId: objectIdString.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const requestIdParamsSchema = z.object({
  requestId: objectIdString,
})

const processDeletionRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reviewerNotes: z
    .string()
    .trim()
    .max(2000, 'Reviewer notes must be 2000 characters or fewer')
    .optional(),
})

const respondValidationError = (res, req, message, fieldErrors) =>
  res.status(422).json({
    error: {
      code: 'VALIDATION_FAILED',
      message,
      details: fieldErrors,
      requestId: req.requestId,
    },
  })

export const validateGdprExportParams = (req, res, next) => {
  const result = exportParamsSchema.safeParse(req.params)
  if (!result.success) {
    return respondValidationError(
      res,
      req,
      'Invalid export parameters',
      result.error.flatten().fieldErrors,
    )
  }
  req.validatedParams = result.data
  next()
}

export const validateCreateDeletionRequest = (req, res, next) => {
  const result = createDeletionRequestSchema.safeParse(req.body)
  if (!result.success) {
    return respondValidationError(
      res,
      req,
      'Invalid deletion request payload',
      result.error.flatten().fieldErrors,
    )
  }
  req.validatedBody = result.data
  next()
}

export const validateListDeletionRequests = (req, res, next) => {
  const result = listDeletionRequestsSchema.safeParse(req.query)
  if (!result.success) {
    return respondValidationError(
      res,
      req,
      'Invalid deletion request query',
      result.error.flatten().fieldErrors,
    )
  }
  req.validatedQuery = result.data
  next()
}

export const validateRequestIdParams = (req, res, next) => {
  const result = requestIdParamsSchema.safeParse(req.params)
  if (!result.success) {
    return respondValidationError(
      res,
      req,
      'Invalid request identifier',
      result.error.flatten().fieldErrors,
    )
  }
  req.validatedParams = result.data
  next()
}

export const validateProcessDeletionRequest = (req, res, next) => {
  const result = processDeletionRequestSchema.safeParse(req.body)
  if (!result.success) {
    return respondValidationError(
      res,
      req,
      'Invalid deletion processing payload',
      result.error.flatten().fieldErrors,
    )
  }
  req.validatedBody = result.data
  next()
}
