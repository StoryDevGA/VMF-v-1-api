import { z } from 'zod'
import { createBodyValidator, createQueryValidator } from './shared.js'
import { DISCOVERY_CONTRADICTION_DISPOSITIONS } from '../services/discoveryContradictionReviewService.js'

export const reviewCompletionBodySchema = z.object({
  requestKey: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  expectedPopulationHash: z.string().regex(/^[a-f0-9]{64}$/),
  rationale: z.string().trim().min(10).max(2000), confirm: z.literal(true),
}).strict()
export const validateReviewCompletionBody = createBodyValidator(reviewCompletionBodySchema)
export const publishedDispositionBodySchema = z.object({
  requestKey: z.string().uuid(), expectedBasisHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedUpdatedAt: z.string().datetime(), rationale: z.string().trim().min(10).max(2000), confirm: z.literal(true),
}).strict()
export const validatePublishedDispositionBody = createBodyValidator(publishedDispositionBodySchema)
export const supplementalFindingBodySchema = z.object({
  requestKey: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  expectedBasisHash: z.string().regex(/^[a-f0-9]{64}$/), expectedUpdatedAt: z.string().datetime(),
  disposition: z.enum(DISCOVERY_CONTRADICTION_DISPOSITIONS),
  rationale: z.string().trim().min(10).max(2000), confirm: z.literal(true),
}).strict()
export const validateSupplementalFindingBody = createBodyValidator(supplementalFindingBodySchema)
export const runtimeProductAuthorityBodySchema = z.object({
  requestKey: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  expectedBasisHash: z.string().regex(/^[a-f0-9]{64}$/), expectedUpdatedAt: z.string().datetime(),
  approvalDocumentText: z.string().min(1).max(16000), confirm: z.literal(true),
}).strict()
export const validateRuntimeProductAuthorityBody = createBodyValidator(runtimeProductAuthorityBodySchema)
export const snapshotRecoveryBodySchema = z.object({
  requestKey: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  expectedBasisHash: z.string().regex(/^[a-f0-9]{64}$/), expectedUpdatedAt: z.string().datetime(),
  rationale: z.string().trim().min(10).max(2000), confirm: z.literal(true),
}).strict()
export const validateSnapshotRecoveryBody = createBodyValidator(snapshotRecoveryBodySchema)
export const validateReviewCompletionScope = createQueryValidator(z.object({
  customerId: z.string().regex(/^[a-f0-9]{24}$/i), tenantId: z.string().regex(/^[a-f0-9]{24}$/i),
}).strict())
