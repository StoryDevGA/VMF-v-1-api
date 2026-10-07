import { z } from 'zod'
import { createQueryValidator, createParamsValidator } from './shared.js'

export const acquisitionRequestKeySchema = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
export const validateAcquisitionRunScope = createQueryValidator(z.object({
  customerId: z.string().regex(/^[a-f0-9]{24}$/i), tenantId: z.string().regex(/^[a-f0-9]{24}$/i),
  cursor: z.string().max(256).optional(),
}).strict())
export const validateAcquisitionRunParams = createParamsValidator(z.object({
  runtimeInstanceId: z.string().trim().min(1).max(160), runId: acquisitionRequestKeySchema,
}).strict())
