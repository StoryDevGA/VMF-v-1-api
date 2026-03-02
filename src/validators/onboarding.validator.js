import { z } from 'zod'
import { createBodyValidator } from './shared.js'

const objectIdRegex = /^[a-f\d]{24}$/i

const objectIdString = z
  .string()
  .regex(objectIdRegex, 'Must be a valid ObjectId')

const topologyEnum = z.enum(['SINGLE_TENANT', 'MULTI_TENANT'])
const vmfPolicyEnum = z.enum(['SINGLE', 'MULTI', 'PER_TENANT_SINGLE', 'PER_TENANT_MULTI'])

const trialSchema = z
  .object({
    isTrial: z.boolean().default(false),
    endsAt: z.string().datetime({ message: 'endsAt must be a valid ISO date' }).optional(),
  })
  .refine(
    (value) => !value.isTrial || Boolean(value.endsAt),
    { message: 'endsAt is required when isTrial is true', path: ['endsAt'] },
  )

const onboardingCustomerSchema = z
  .object({
    companyName: z
      .string({ required_error: 'customer.companyName is required' })
      .trim()
      .min(1, 'customer.companyName is required')
      .max(255, 'customer.companyName must be 255 characters or fewer'),
    website: z
      .string()
      .trim()
      .url('customer.website must be a valid URL')
      .max(500, 'customer.website must be 500 characters or fewer')
      .optional(),
    serviceProvider: z.boolean().default(false),
    licenseLevelId: objectIdString,
    billingCycle: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']).default('MONTHLY'),
    planCode: z
      .string()
      .trim()
      .min(1, 'customer.planCode must not be empty')
      .max(100, 'customer.planCode must be 100 characters or fewer')
      .default('DEFAULT'),
    maxTenants: z.number().int().min(1).max(10000).default(1),
    maxVmfsPerTenant: z.number().int().min(1).max(10000).default(1),
    topology: topologyEnum.default('MULTI_TENANT'),
    vmfPolicy: vmfPolicyEnum.optional(),
    entitlements: z.array(z.string().trim()).default([]),
    trial: trialSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const effectivePolicy =
      value.vmfPolicy || (value.topology === 'SINGLE_TENANT' ? 'SINGLE' : 'PER_TENANT_MULTI')

    if (value.topology === 'SINGLE_TENANT' && !['SINGLE', 'MULTI'].includes(effectivePolicy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vmfPolicy'],
        message: 'SINGLE_TENANT requires vmfPolicy SINGLE or MULTI.',
      })
    }

    if (
      value.topology === 'MULTI_TENANT' &&
      !['PER_TENANT_SINGLE', 'PER_TENANT_MULTI'].includes(effectivePolicy)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vmfPolicy'],
        message: 'MULTI_TENANT requires vmfPolicy PER_TENANT_SINGLE or PER_TENANT_MULTI.',
      })
    }
  })
  .transform((value) => ({
    ...value,
    vmfPolicy:
      value.vmfPolicy || (value.topology === 'SINGLE_TENANT' ? 'SINGLE' : 'PER_TENANT_MULTI'),
  }))

const onboardingAdminSchema = z.object({
  name: z
    .string({ required_error: 'adminUser.name is required' })
    .trim()
    .min(1, 'adminUser.name is required')
    .max(255, 'adminUser.name must be 255 characters or fewer'),
  email: z
    .string({ required_error: 'adminUser.email is required' })
    .trim()
    .email('adminUser.email must be a valid email')
    .max(255, 'adminUser.email must be 255 characters or fewer'),
})

const onboardCustomerSchema = z.object({
  customer: onboardingCustomerSchema,
  adminUser: onboardingAdminSchema,
})

export const validateOnboardCustomer = createBodyValidator(onboardCustomerSchema, {
  message: 'Please provide valid onboarding data.',
})
