import { z } from 'zod'
import { createBodyValidator, createQueryValidator } from './shared.js'

export const reviewCompletionBodySchema = z.object({
  requestKey: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  expectedPopulationHash: z.string().regex(/^[a-f0-9]{64}$/),
  rationale: z.string().trim().min(10).max(2000), confirm: z.literal(true),
}).strict()
export const validateReviewCompletionBody = createBodyValidator(reviewCompletionBodySchema)
export const validateReviewCompletionScope = createQueryValidator(z.object({
  customerId: z.string().regex(/^[a-f0-9]{24}$/i), tenantId: z.string().regex(/^[a-f0-9]{24}$/i),
}).strict())
