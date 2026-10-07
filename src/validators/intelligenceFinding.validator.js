import { z } from 'zod'
import { createQueryValidator } from './shared.js'

const page = (maximum, fallback) => z.union([z.number(), z.string().regex(/^[1-9]\d*$/)])
  .transform(Number).pipe(z.number().int().min(1).max(maximum)).default(fallback)
export const findingSelectionSchema = z.object({
  search: z.string().max(240).refine(value => !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)).default(''),
  type: z.enum(['CONTRADICTION', 'MISSING_COVERAGE', 'WEAK_CONFIDENCE', 'DUPLICATE_SOURCE']).default('CONTRADICTION'),
  population: z.enum(['DETECTED', 'OPEN', 'RECORDED']).default('OPEN'),
  sort: z.enum(['ID_ASC', 'ID_DESC']).default('ID_ASC'),
  page: page(1000, 1), pageSize: page(20, 10),
}).strict()
export const validateIntelligenceFindingQuery = createQueryValidator(findingSelectionSchema.extend({
  customerId: z.string().regex(/^[a-f0-9]{24}$/i), tenantId: z.string().regex(/^[a-f0-9]{24}$/i),
}).strict())
