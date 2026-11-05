import { z } from 'zod'
import { createBodyValidator, createParamsValidator } from './shared.js'
export const privateDocxCandidateCreateSchema = z.object({ requestKey: z.string().uuid(),
  expectedSourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), format: z.literal('DOCX') }).strict()
// Server-only creation contract; the legacy HTTP validator remains unchanged.
export const masterLinkedDocxCandidateCreateSchema = privateDocxCandidateCreateSchema.extend({
  masterId: z.string().regex(/^meaning_master_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
  masterVersion: z.literal(1), expectedMasterBodyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export const correctedMasterLinkedDocxCandidateCreateSchema = masterLinkedDocxCandidateCreateSchema.extend({
  predecessorCandidateId: z.string().regex(/^docx_candidate_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  expectedPredecessorBodyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  failedReviewExecutionId: z.string().regex(/^master_docx_result_[a-f0-9]{40}$/),
  expectedFailedReviewResultFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
// Internal creation only. The existing HTTP body validator does not accept it.
export const approvedMasterLinkedDocxCandidateCreateSchema = masterLinkedDocxCandidateCreateSchema.extend({
  compatibilityAuditId: z.string().regex(/^[a-f0-9]{24}$/),
  expectedCompatibilityFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export const privateDocxCandidateParamsSchema = z.object({ runtimeInstanceId: z.string().regex(/^[a-f0-9]{24}$/),
  candidateId: z.string().regex(/^docx_candidate_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/) }).strict()
export const validatePrivateDocxCandidateCreate = createBodyValidator(privateDocxCandidateCreateSchema)
export const validatePrivateDocxCandidateParams = createParamsValidator(privateDocxCandidateParamsSchema)
