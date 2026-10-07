import { z } from 'zod'
import { createQueryValidator } from './shared.js'

const page = (maximum, fallback) => z.union([z.number(), z.string().regex(/^[1-9]\d*$/)])
  .transform(Number).pipe(z.number().int().min(1).max(maximum)).default(fallback)
export const contradictionHistorySelectionSchema = z.object({
  findingId: z.string().min(1).max(240).refine(value => value === value.trim()
    && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)),
  page: page(1000, 1), pageSize: page(20, 10),
}).strict()
export const validateContradictionHistoryQuery = createQueryValidator(contradictionHistorySelectionSchema.extend({
  customerId: z.string().regex(/^[a-f0-9]{24}$/i), tenantId: z.string().regex(/^[a-f0-9]{24}$/i),
}).strict())
