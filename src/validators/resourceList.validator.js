import { z } from 'zod'
import { createQueryValidator } from './shared.js'

const integerQuery = (maximum) => z.string().regex(/^\d+$/).transform(Number)
  .pipe(z.number().int().min(1).max(maximum)).optional()
const common = {
  q: z.string().max(250).optional(),
  page: integerQuery(Number.MAX_SAFE_INTEGER / 100),
  pageSize: integerQuery(100),
}

export const validateCustomerList = createQueryValidator(z.object({
  ...common,
  status: z.enum(['ACTIVE', 'INACTIVE', 'DISABLED', 'ARCHIVED']).optional(),
  topology: z.enum(['SINGLE_TENANT', 'MULTI_TENANT']).optional(),
}).strict())
export const validateTenantList = createQueryValidator(z.object({
  ...common,
  status: z.enum(['ENABLED', 'DISABLED', 'ARCHIVED']).optional(),
}).strict())
export const validateVmfList = createQueryValidator(z.object({
  ...common,
  status: z.enum(['ACTIVE', 'DISABLED', 'ARCHIVED']).optional(),
  lifecycleStatus: z.enum(['DRAFT', 'CANONISED', 'PUBLISHED']).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
}).strict())
export const validateDealList = createQueryValidator(z.object({
  ...common,
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
}).strict())
