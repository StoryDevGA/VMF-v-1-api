import { z } from 'zod'
import { POST_LOCK_DISCOVERY_DISPOSITIONS } from './discoveryContractReadinessService.js'
import { postLockBindingSchema, validPostLockRow } from './postLockEvidenceIntakeContract.js'
import { membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { buildCanonicalJson, generateChecksum } from './governanceAudit/checksumService.js'

export const POST_LOCK_IMPACT_VERSION = 'post-lock-impact-decision.v1'
export const POST_LOCK_IMPACT_HISTORY_VERSION = 'post-lock-impact-history.v1'
export const POST_LOCK_IMPACT_HISTORY_MAX_BYTES = 128 * 1024
export const POST_LOCK_IMPACT_HISTORY_MAX_COUNT = 1000
const object = shape => z.object(shape).strict()
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().regex(/^[a-f0-9]{24}$/)
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
const rationale = z.string().trim().min(1).max(2000)
const disposition = z.enum(Object.values(POST_LOCK_DISCOVERY_DISPOSITIONS))
const time = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
export const postLockImpactRequestSchema = object({
  contractVersion: z.literal(POST_LOCK_IMPACT_VERSION), requestKey: uuid, expectedBinding: postLockBindingSchema,
  expectedSubmissionDigest: hash, expectedHeadHash: hash.nullable(), disposition, rationale, confirm: z.literal(true),
}).refine(value => Buffer.byteLength(buildCanonicalJson(value), 'utf8') <= 8192, 'Impact request exceeds 8 KiB.')
export const postLockImpactHistoryQuerySchema = object({ customerId: id, tenantId: id,
  afterSequence: z.coerce.number().int().min(0).max(POST_LOCK_IMPACT_HISTORY_MAX_COUNT).default(0),
  limit: z.coerce.number().int().min(1).max(25).default(20) })

export const postLockImpactError = (reason, status = 503) => Object.assign(new Error({
  POST_LOCK_IMPACT_STALE: 'The submission or previous impact decision changed. Refresh before recording.',
  POST_LOCK_IMPACT_IDEMPOTENCY_CONFLICT: 'This request key identifies a different impact decision.',
  POST_LOCK_IMPACT_POLICY_UNAVAILABLE: 'This revision has no supported human impact recording policy.',
  POST_LOCK_IMPACT_CAPACITY: 'The retained impact history is full. No previous decision was removed.',
  POST_LOCK_IMPACT_HISTORY_INVALID: 'The retained impact history could not be verified.',
  POST_LOCK_IMPACT_AUDIT_NOT_RECORDED: 'A required impact audit receipt is unavailable.',
  POST_LOCK_IMPACT_AUDIT_UNVERIFIED: 'A required impact audit signature or binding could not be verified.',
  POST_LOCK_IMPACT_READ_UNAVAILABLE: 'Impact history could not be read. Refresh before acting.',
  POST_LOCK_IMPACT_AUDIT_WRITE_FAILED: 'The required impact audit could not be saved and verified.',
  POST_LOCK_IMPACT_SUBMISSION_UNCONFIRMED: 'The impact decision outcome is unconfirmed. Inspect or retry the same request key.',
}[reason] || 'The impact request could not be processed.'), {
  status, code: status === 503 ? 'SERVICE_UNAVAILABLE' : status === 422 ? 'VALIDATION_FAILED' : 'CONFLICT', details: { reason },
})
export const parsePostLockImpactRequest = value => {
  try { return postLockImpactRequestSchema.parse(membershipJson(value)) }
  catch { throw postLockImpactError('POST_LOCK_IMPACT_REQUEST_INVALID', 422) }
}
export const postLockImpactPayloadHash = (request, reviewerUserId, submissionId) => generateChecksum({ ...request, reviewerUserId, submissionId })
export const postLockImpactDecisionId = (submissionId, requestKey) => `post_lock_impact_${generateChecksum({ submissionId, requestKey })}`
export const postLockImpactEntrySchema = object({
  contractVersion: z.literal(POST_LOCK_IMPACT_VERSION), decisionId: z.string().regex(/^post_lock_impact_[a-f0-9]{64}$/),
  payloadHash: hash, requestKey: uuid, sequence: z.number().int().min(1).max(POST_LOCK_IMPACT_HISTORY_MAX_COUNT),
  submissionId: hash, submissionRequestDigest: hash, binding: postLockBindingSchema,
  reviewerUserId: id, authority: z.literal('VMF_UPDATE'), disposition, rationale, decidedAt: time,
  previousDecisionHash: hash.nullable(), decisionHash: hash, auditId: id,
  auditSignatureVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
const historySchema = object({ contractVersion: z.literal(POST_LOCK_IMPACT_HISTORY_VERSION),
  entries: z.array(postLockImpactEntrySchema).min(1).max(POST_LOCK_IMPACT_HISTORY_MAX_COUNT), headHash: hash })
export const postLockImpactMaterial = entry => Object.fromEntries(Object.entries(entry)
  .filter(([key]) => !['decisionHash', 'auditId', 'auditSignatureVersion'].includes(key)))
export const postLockImpactDecisionHash = entry => generateChecksum(postLockImpactMaterial(entry))
export const postLockImpactRequestFromEntry = entry => ({ contractVersion: POST_LOCK_IMPACT_VERSION,
  requestKey: entry.requestKey, expectedBinding: entry.binding, expectedSubmissionDigest: entry.submissionRequestDigest,
  expectedHeadHash: entry.previousDecisionHash, disposition: entry.disposition, rationale: entry.rationale, confirm: true })
export const postLockImpactHistoryBytes = history => Buffer.byteLength(buildCanonicalJson(history), 'utf8')

export const assertPostLockImpactHistory = (value, association) => {
  try {
    const history = historySchema.parse(membershipJson(value))
    if (postLockImpactHistoryBytes(history) > POST_LOCK_IMPACT_HISTORY_MAX_BYTES) throw new Error('History bound')
    for (const key of ['requestKey', 'decisionId', 'auditId']) {
      if (new Set(history.entries.map(entry => entry[key])).size !== history.entries.length) throw new Error('Duplicate history identity')
    }
    for (const [index, entry] of history.entries.entries()) {
      if (entry.sequence !== index + 1 || entry.previousDecisionHash !== (index ? history.entries[index - 1].decisionHash : null)
        || entry.submissionId !== association.submissionId || entry.submissionRequestDigest !== association.requestDigest
        || generateChecksum(entry.binding) !== generateChecksum(association.binding)
        || entry.decisionId !== postLockImpactDecisionId(entry.submissionId, entry.requestKey)
        || entry.payloadHash !== postLockImpactPayloadHash(postLockImpactRequestFromEntry(entry), entry.reviewerUserId, entry.submissionId)
        || entry.decisionHash !== postLockImpactDecisionHash(entry)) throw new Error('History material binding')
    }
    if (history.headHash !== history.entries.at(-1).decisionHash) throw new Error('History head')
    return history
  } catch { throw postLockImpactError('POST_LOCK_IMPACT_HISTORY_INVALID') }
}
export const validPostLockImpactHistoryRow = input => {
  try {
    const row = typeof input.toObject === 'function' ? input.toObject({ depopulate: true }) : input
    if (!validPostLockRow(row, 'evidence')) return false
    assertPostLockImpactHistory(row.postLockImpactHistory, row.postLockAssociation)
    return true
  } catch { return false }
}
export const publicPostLockImpactEntry = (entry, verified, headHash) => ({
  decisionId: entry.decisionId, sequence: entry.sequence, disposition: entry.disposition, rationale: entry.rationale,
  reviewerUserId: entry.reviewerUserId, authority: entry.authority, decidedAt: entry.decidedAt,
  previousDecisionHash: entry.previousDecisionHash, decisionHash: entry.decisionHash,
  audit: { id: entry.auditId, signatureVersion: entry.auditSignatureVersion },
  verified, isCurrent: verified && entry.decisionHash === headHash,
})
