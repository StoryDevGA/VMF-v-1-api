import { z } from 'zod'
import { createBodyValidator, createParamsValidator, createQueryValidator } from './shared.js'

const objectIdRegex = /^[a-f\d]{24}$/i

const createInvitationSchema = z.object({
  recipientEmail: z
    .string({ required_error: 'recipientEmail is required' })
    .trim()
    .toLowerCase()
    .email('recipientEmail must be a valid email')
    .max(255, 'recipientEmail must be 255 characters or fewer'),
  recipientName: z
    .string({ required_error: 'recipientName is required' })
    .trim()
    .min(1, 'recipientName is required')
    .max(255, 'recipientName must be 255 characters or fewer'),
  company: z.object({
    name: z
      .string({ required_error: 'company.name is required' })
      .trim()
      .min(1, 'company.name is required')
      .max(255, 'company.name must be 255 characters or fewer'),
    website: z
      .string()
      .trim()
      .url('company.website must be a valid URL')
      .max(500, 'company.website must be 500 characters or fewer')
      .optional(),
    registrationNumber: z.string().trim().max(255).optional(),
    address: z.string().trim().max(500).optional(),
    industry: z.string().trim().max(255).optional(),
    size: z.string().trim().max(50).optional(),
  }),
})

const invitationIdSchema = z.object({
  invitationId: z
    .string({ required_error: 'invitationId is required' })
    .regex(objectIdRegex, 'invitationId must be a valid ObjectId'),
})

const revokeInvitationSchema = z.object({
  reason: z
    .string({ required_error: 'reason is required' })
    .trim()
    .min(1, 'reason is required')
    .max(500, 'reason must be 500 characters or fewer'),
})

const listInvitationsQuerySchema = z.object({
  status: z
    .enum(['created', 'sent', 'send_failed', 'accessed', 'authenticated', 'expired', 'revoked'])
    .optional(),
  q: z.string().trim().max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const validateCreateInvitation = createBodyValidator(createInvitationSchema)
export const validateInvitationId = createParamsValidator(invitationIdSchema)
export const validateRevokeInvitation = createBodyValidator(revokeInvitationSchema)
export const validateListInvitationsQuery = createQueryValidator(listInvitationsQuerySchema)
