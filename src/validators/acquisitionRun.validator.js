import { z } from 'zod'
import { createQueryValidator, createParamsValidator, createBodyValidator } from './shared.js'
import { saveResearchConfigurationSchema } from '../services/researchConfigurationContract.js'

export const acquisitionRequestKeySchema = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
export const validateAcquisitionRunScope = createQueryValidator(z.object({
  customerId: z.string().regex(/^[a-f0-9]{24}$/i), tenantId: z.string().regex(/^[a-f0-9]{24}$/i),
  cursor: z.string().max(256).optional(), requestKey: acquisitionRequestKeySchema.optional(),
}).strict().refine(value => !(value.requestKey && value.cursor), 'An exact request lookup cannot use a cursor.'))
export const validateAcquisitionRunParams = createParamsValidator(z.object({
  runtimeInstanceId: z.string().trim().min(1).max(160), runId: acquisitionRequestKeySchema,
}).strict())
export const validateResearchConfigurationScope = createQueryValidator(z.object({
  customerId: z.string().regex(/^[a-f0-9]{24}$/i), tenantId: z.string().regex(/^[a-f0-9]{24}$/i),
}).strict())
export const validateResearchConfigurationSave = createBodyValidator(saveResearchConfigurationSchema)

export const validateAcquisitionCancellation = createBodyValidator(z.object({ executionAttemptId: acquisitionRequestKeySchema }).strict())
