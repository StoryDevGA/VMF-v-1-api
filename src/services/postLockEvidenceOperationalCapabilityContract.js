import { z } from 'zod'
import { membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { postLockBindingSchema } from './postLockEvidenceIntakeContract.js'

export const POST_LOCK_OPERATIONAL_CAPABILITY_VERSION = 'post-lock-evidence-operational-capability.v1'
export const OPERATIONAL_CAPABILITY_RESPONSE_BYTES = 16 * 1024
export const OPERATIONAL_CAPABILITY_POLICY_BYTES = 512 * 1024
export const OPERATIONAL_CAPABILITY_INDEX_BYTES = 64 * 1024
export const OPERATIONAL_CAPABILITY_INDEX_COUNT = 32
export const OPERATIONAL_CAPABILITY_BLOCKERS = Object.freeze(['VMF_UPDATE_REQUIRED', 'CONTROLLED_REPLAY_ISOLATED',
  'LOCK_BASIS_UNAVAILABLE', 'FROZEN_MEMBERSHIP_NOT_RECORDED', 'POST_LOCK_POLICY_NOT_RECORDED',
  'POST_LOCK_POLICY_UNAVAILABLE', 'POST_LOCK_INDEX_REQUIRED'])
const failures = new Set(['DEADLINE_EXCEEDED', 'DEPENDENCY_UNAVAILABLE', 'INDEX_CAPACITY_EXCEEDED',
  'POLICY_CAPACITY_EXCEEDED', 'RESPONSE_CAPACITY_EXCEEDED', 'RESPONSE_INVALID']
  .map(value => `POST_LOCK_OPERATIONAL_CAPABILITY_${value}`))
export const postLockOperationalCapabilityError = suffix => Object.assign(new Error('The post-lock recording capability could not complete its bounded read.'), {
  status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: `POST_LOCK_OPERATIONAL_CAPABILITY_${suffix}` },
})
export const isPostLockOperationalCapabilityError = error => error?.status === 503
  && error.code === 'SERVICE_UNAVAILABLE' && failures.has(error.details?.reason)
const object = shape => z.object(shape).strict()
const schema = object({
  contractVersion: z.literal(POST_LOCK_OPERATIONAL_CAPABILITY_VERSION),
  readAt: z.string().datetime().refine(value => new Date(value).toISOString() === value), currency: z.literal('AS_READ'),
  recording: object({ eligibility: z.enum(['ELIGIBLE_AS_READ', 'BLOCKED']),
    blockedBy: z.array(z.enum(OPERATIONAL_CAPABILITY_BLOCKERS)).max(OPERATIONAL_CAPABILITY_BLOCKERS.length),
    binding: postLockBindingSchema.nullable(), checks: object({
      authority: z.enum(['VMF_UPDATE_VERIFIED', 'VMF_UPDATE_REQUIRED']), isolation: z.enum(['CLEAR', 'BLOCKED']),
      frozenBasis: z.enum(['VERIFIED', 'LOCK_BASIS_UNAVAILABLE', 'NOT_RECORDED', 'NOT_CHECKED']),
      policy: z.enum(['VERIFIED', 'NOT_RECORDED', 'UNAVAILABLE', 'NOT_CHECKED']),
      storageIndexes: z.enum(['VERIFIED_AS_WRITER', 'MISMATCH', 'NOT_CHECKED']),
    }) }),
  impact: object({ eligibility: z.literal('ITEM_REQUIRED') }), admission: object({ eligibility: z.literal('ITEM_REQUIRED') }),
  execution: object({ mode: z.literal('EXPLICIT_SUBMIT_REQUIRED'), recheck: z.literal('SERVER_RECHECKS_ON_SUBMIT'),
    indexRead: z.literal('OUTSIDE_TRANSACTION_NOT_ATOMIC'), submissionMaterial: z.literal('NOT_CHECKED') }),
}).superRefine((value, ctx) => {
  const { checks, blockedBy, binding, eligibility } = value.recording
  const expected = OPERATIONAL_CAPABILITY_BLOCKERS.filter(reason => ({
    VMF_UPDATE_REQUIRED: checks.authority === 'VMF_UPDATE_REQUIRED', CONTROLLED_REPLAY_ISOLATED: checks.isolation === 'BLOCKED',
    LOCK_BASIS_UNAVAILABLE: checks.frozenBasis === 'LOCK_BASIS_UNAVAILABLE', FROZEN_MEMBERSHIP_NOT_RECORDED: checks.frozenBasis === 'NOT_RECORDED',
    POST_LOCK_POLICY_NOT_RECORDED: checks.policy === 'NOT_RECORDED', POST_LOCK_POLICY_UNAVAILABLE: checks.policy === 'UNAVAILABLE',
    POST_LOCK_INDEX_REQUIRED: checks.storageIndexes === 'MISMATCH',
  })[reason])
  const need = condition => { if (!condition) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Contradictory capability.' }) }
  need(JSON.stringify(blockedBy) === JSON.stringify(expected))
  need((eligibility === 'ELIGIBLE_AS_READ') === (blockedBy.length === 0))
  need((binding !== null) === (checks.frozenBasis === 'VERIFIED' && checks.policy === 'VERIFIED'))
  if (checks.isolation === 'BLOCKED') need(checks.frozenBasis === 'NOT_CHECKED')
  else need(checks.frozenBasis !== 'NOT_CHECKED')
  if (checks.frozenBasis !== 'VERIFIED') need(checks.policy === 'NOT_CHECKED')
  else need(checks.policy !== 'NOT_CHECKED')
  if (checks.policy !== 'VERIFIED') need(checks.storageIndexes === 'NOT_CHECKED')
  else need(checks.storageIndexes !== 'NOT_CHECKED')
})
export const assertPostLockOperationalMaterial = (value, maxBytes, failure) => {
  let bytes
  try { bytes = Buffer.byteLength(JSON.stringify(value), 'utf8') } catch { throw postLockOperationalCapabilityError(failure) }
  if (!Number.isSafeInteger(bytes) || bytes > maxBytes) throw postLockOperationalCapabilityError(failure)
  return value
}
export const parsePostLockOperationalCapability = value => {
  try { return schema.parse(membershipJson(value)) }
  catch { throw postLockOperationalCapabilityError('RESPONSE_INVALID') }
}
export const assertPostLockOperationalCapabilityEnvelope = value => assertPostLockOperationalMaterial(value,
  OPERATIONAL_CAPABILITY_RESPONSE_BYTES, 'RESPONSE_CAPACITY_EXCEEDED')
