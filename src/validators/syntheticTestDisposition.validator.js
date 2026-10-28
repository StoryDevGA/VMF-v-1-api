import { z } from 'zod'
import { createBodyValidator } from './shared.js'
import { DISCOVERY_CONTRADICTION_DISPOSITIONS } from '../services/discoveryContradictionReviewService.js'

export const syntheticTestDispositionBodySchema = z.object({
  requestKey: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  expectedBasisHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedUpdatedAt: z.string().datetime(),
  amendmentDocumentText: z.string().min(1).max(16000),
  disposition: z.enum(DISCOVERY_CONTRADICTION_DISPOSITIONS),
  rationale: z.string().trim().min(10).max(2000),
  decisionSource: z.object({
    reference: z.string().trim().min(10).max(500),
    text: z.string().trim().min(20).max(8000),
    decidedAt: z.string().datetime(),
  }).strict(),
  conflictDisclosed: z.literal(true),
  recorderAttestsDecision: z.literal(true),
  confirm: z.literal(true),
}).strict()
export const validateSyntheticTestDispositionBody = createBodyValidator(syntheticTestDispositionBodySchema)
