import { z } from 'zod'
import { createBodyValidator, createParamsValidator } from './shared.js'
import { privateDocxCandidateParamsSchema } from './outcomeDocxCandidate.validator.js'
export const docxPagePreviewCreateSchema = z.object({ expectedSourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedOutputChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict()
export const docxPagePreviewParamsSchema = privateDocxCandidateParamsSchema.extend({
  previewId: z.string().regex(/^docx_preview_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
}).strict()
export const validateDocxPagePreviewCreate = createBodyValidator(docxPagePreviewCreateSchema)
export const validateDocxPagePreviewParams = createParamsValidator(docxPagePreviewParamsSchema)
