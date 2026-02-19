import { z } from 'zod'
import { createQueryValidator } from './shared.js'

const objectIdRegex = /^[a-f\d]{24}$/i

const deniedAccessLogQuerySchema = z.object({
  actorUserId: z.string().regex(objectIdRegex, 'actorUserId must be a valid ObjectId').optional(),
  startDate: z.string().datetime({ message: 'startDate must be a valid ISO date' }).optional(),
  endDate: z.string().datetime({ message: 'endDate must be a valid ISO date' }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateDeniedAccessLogQuery = createQueryValidator(deniedAccessLogQuerySchema)
