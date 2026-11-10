import { z } from 'zod'
import FrameworkPackage from '../models/FrameworkPackage.js'
import { isBoundedSafeJson } from '../models/runtimeStateSchemas.js'
import { membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { withPostLockEvidenceTransaction } from './postLockEvidenceIntakeService.js'
import { readPostLockImpactViewContext } from './postLockImpactDecisionService.js'
import { readHistoricalPostLockAdmission } from './postLockSuccessorAdmissionService.js'
import { assertPostLockRecordingBinding, postLockBindingSchema } from './postLockEvidenceIntakeContract.js'
import { publicPostLockImpactEntry, postLockImpactEntrySchema } from './postLockImpactDecisionContract.js'
import { RUNTIME_INSTANCE_ERROR_REASONS } from './runtimeInstanceService.js'

export const POST_LOCK_READ_STATE_VERSION = 'post-lock-evidence-read-state.v1'
export const READ_STATE_MAX_BYTES = 48 * 1024
export const READ_RESPONSE_MAX_BYTES = 128 * 1024
export const READ_AUDIT_MAX_BYTES = 512 * 1024
const READ_TIMEOUT_MS = 6000
const reasons = Object.freeze({
  deadline: 'POST_LOCK_READ_STATE_DEADLINE_EXCEEDED',
  audits: 'POST_LOCK_READ_STATE_AUDIT_CAPACITY_EXCEEDED',
  state: 'POST_LOCK_READ_STATE_CAPACITY_EXCEEDED',
  response: 'POST_LOCK_READ_RESPONSE_CAPACITY_EXCEEDED',
  dependency: 'POST_LOCK_READ_STATE_DEPENDENCY_UNAVAILABLE',
})
export const postLockReadStateError = reason => Object.assign(new Error('The selected post-lock item could not complete its bounded read.'), {
  status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason },
})
const serializedBytes = (value, reason) => {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') }
  catch { throw postLockReadStateError(reason) }
}

// One closure is shared by all helpers and every transaction callback retry.
// The transaction owns client timeouts; queries receive only remaining maxTimeMS.
export const createPostLockReadBudget = ({ now = Date.now } = {}) => {
  const deadline = now() + READ_TIMEOUT_MS
  let auditBytes = 0
  const remainingMS = () => {
    const remaining = Math.floor(deadline - now())
    if (remaining <= 0) throw postLockReadStateError(reasons.deadline)
    return remaining
  }
  const budget = () => ({ maxTimeMS: Math.min(2000, remainingMS()) })
  budget.remainingMS = remainingMS
  budget.check = () => { remainingMS() }
  budget.isExpired = () => now() >= deadline
  budget.accountAuditRows = rows => {
    budget.check()
    if (!Array.isArray(rows)) throw postLockReadStateError(reasons.audits)
    auditBytes += serializedBytes(rows, reasons.audits)
    if (auditBytes > READ_AUDIT_MAX_BYTES) throw postLockReadStateError(reasons.audits)
    budget.check()
  }
  return budget
}
const isTimeout = error => [50, 262].includes(error?.code)
  || ['MaxTimeMSExpired', 'ExceededTimeLimit'].includes(error?.codeName)
  || ['MongoOperationTimeoutError', 'MongoNetworkTimeoutError'].includes(error?.name)
// Exact identities from the scoped runtime, intake and retained-basis owners.
// A dependency cannot expose an arbitrary typed error through this new endpoint.
const protectedReadErrors = [
  [401, 'UNAUTHENTICATED', [undefined]],
  [403, 'FORBIDDEN', [undefined, RUNTIME_INSTANCE_ERROR_REASONS.FORBIDDEN]],
  [403, 'BOUNDED_SCOPE_REQUIRED', ['RUNTIME_INSTANCE_BOUNDED_SCOPE_REQUIRED']],
  [403, 'TENANT_DISABLED', [RUNTIME_INSTANCE_ERROR_REASONS.TENANT_DISABLED]],
  [403, 'LICENSE_FEATURE_NOT_ENABLED', [RUNTIME_INSTANCE_ERROR_REASONS.FEATURE_NOT_ENABLED]],
  [404, 'NOT_FOUND', [RUNTIME_INSTANCE_ERROR_REASONS.CUSTOMER_NOT_FOUND,
    RUNTIME_INSTANCE_ERROR_REASONS.TENANT_NOT_FOUND, RUNTIME_INSTANCE_ERROR_REASONS.TENANT_NOT_IN_CUSTOMER,
    RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_INSTANCE_NOT_FOUND, 'POST_LOCK_SUBMISSION_NOT_FOUND']],
  [503, 'BOUNDED_READ_UNAVAILABLE', ['RUNTIME_INSTANCE_BOUNDED_READ_UNAVAILABLE']],
  [409, 'CONFLICT', ['POST_LOCK_BINDING_STALE', 'CONTROLLED_REPLAY_ISOLATION_INVALID', 'CONTROLLED_REPLAY_ISOLATED']],
  [422, 'VALIDATION_FAILED', ['POST_LOCK_SUBMISSION_INVALID', 'POST_LOCK_IMPACT_REQUEST_INVALID']],
  [503, 'SERVICE_UNAVAILABLE', ['POST_LOCK_RECEIPT_UNVERIFIED', 'POST_LOCK_STORAGE_UNAVAILABLE',
    'POST_LOCK_IMPACT_HISTORY_INVALID', 'CONTROLLED_REPLAY_ISOLATION_UNAVAILABLE']],
]
// runtimeEvidenceSnapshotContract/Service and the section-history reader supply
// these reasons through the existing membershipError(409) owner. The correction
// reader's known material reasons are wrapped by that same snapshot owner.
const protectedMembershipReasons = new Set([
  'MATERIAL_DEPTH', 'MATERIAL_TIME', 'MATERIAL_NUMBER', 'MATERIAL_OBJECT', 'MATERIAL_ARRAY', 'MATERIAL_ACCESSOR',
  'MATERIAL_ARRAY_VALUE', 'MATERIAL_PROTOTYPE', 'MATERIAL_ROW', 'REVISION_INVALID', 'ROOT_REVISION_MISSING',
  'SCOPE_INVALID', 'PACKAGE_INVALID', 'REFERENCES_INVALID', 'REFERENCE_UNRESOLVED', 'CONTEXT_REFERENCE_AMBIGUOUS',
  'CONTEXT_REFERENCE_UNRESOLVED', 'CONTEXT_REFERENCE_MISMATCH', 'CONTEXT_INPUT_MISMATCH', 'STATE_VERSION_INVALID',
  'MEMBER_BOUND', 'MEMBER_SCOPE_INVALID', 'MEMBER_DUPLICATE', 'SOURCE_UNRESOLVED', 'CONTEXT_SECTION_INVALID',
  'BODY_INVALID', 'LOCK_INVALID', 'COUNT_INVALID', 'MEMBER_INVALID', 'CONTEXT_BINDING_INVALID', 'MEMBER_ORDER',
  'MEMBERSHIP_BYTE_BOUND', 'AUDIT_LINK_INVALID', 'SNAPSHOT_ID_INVALID', 'SNAPSHOT_MISSING_OR_AMBIGUOUS',
  'SNAPSHOT_BINDING_INVALID', 'POINTER_BINDING_INVALID', 'DOCUMENT_BINDING_INVALID', 'MEMBER_MISSING',
  'MEMBER_MATERIAL_CHANGED', 'MEMBERSHIP_CHANGED', 'AUDIT_SIGNATURE_INVALID', 'SECTION_HISTORY_INVALID',
  'READ_BUDGET_EXHAUSTED', 'REVISION_MISSING', 'REFERENCE_INVALID', 'REVISION_BODY_LIMIT', 'REFERENCE_LIMIT',
  'REFERENCE_TARGET_INVALID', 'SCOPE_MISSING', 'REFERENCE_TARGET_MISSING', 'READ_BYTE_LIMIT', 'REFERENCE_SCOPE_MISMATCH',
  'REFERENCE_HASH_MISMATCH', 'REFERENCE_PRESENCE_INVALID', 'REFERENCE_METADATA_MISMATCH', 'CORRECTION_INVALID',
  'CORRECTION_AMBIGUOUS', 'RUNTIME_BINDING', 'SYNTHETIC_PIPELINE_HELD', 'ORIGINAL_BINDING', 'MEMBERSHIP_BOUND',
  'MEMBERSHIP_MISSING', 'CORRECTED_HASH', 'LOSS_PATH', 'LOSS_NOT_EXACT', 'LOCK_SIGNATURE', 'NATIVE_RECEIPT_MISSING',
  'NATIVE_RECEIPT_INVALID', 'CORRECTION_REQUIRED', 'CORRECTION_BASIS_CHANGED', 'CORRECTION_AUDIT_INVALID',
  'BODY_SHAPE', 'DOCUMENT_BINDING', 'CORRECTED_BINDING', 'POINTER_BINDING', 'CONTROL_BINDING', 'RECEIPT_BINDING',
  'REQUEST_BINDING', 'BASIS_BINDING', 'PAYLOAD_BINDING', 'BODY_BOUND', 'CONTROL_BOUND', 'PASSIVE_CONTROL_CHANGED', 'STALE_CONTROL',
])
const isProtectedReadError = error => protectedReadErrors.some(([status, code, values]) => error?.status === status
  && error.code === code && values.includes(error.details?.reason))
  || error?.status === 409 && error.code === 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID'
    && protectedMembershipReasons.has(error.details?.reason)
export const normalizePostLockReadStateError = (error, readBudget) => {
  const own = error?.status === 503 && error.code === 'SERVICE_UNAVAILABLE'
    && Object.values(reasons).includes(error.details?.reason)
  // Existing typed scope, intake and frozen-material failures retain their contract.
  if (isProtectedReadError(error)) return error
  if (readBudget?.isExpired() || isTimeout(error)) return postLockReadStateError(reasons.deadline)
  if (own) return error
  return postLockReadStateError(reasons.dependency)
}

const object = shape => z.object(shape).strict()
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().regex(/^[a-f0-9]{24}$/)
const text = max => z.string().min(1).max(max).refine(value => value === value.trim())
const time = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const impactReasons = ['POST_LOCK_IMPACT_AUDIT_NOT_RECORDED', 'POST_LOCK_IMPACT_AUDIT_UNVERIFIED']
const admissionReasons = ['POST_LOCK_ADMISSION_AUDIT_NOT_RECORDED', 'POST_LOCK_ADMISSION_AUDIT_UNVERIFIED',
  'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED', 'POST_LOCK_ADMISSION_CHILD_UNAVAILABLE', 'POST_LOCK_ADMISSION_CHILD_AMBIGUOUS']
const recordBlockers = ['VMF_UPDATE_REQUIRED', 'CONTROLLED_REPLAY_ISOLATED', 'POST_LOCK_IMPACT_POLICY_UNAVAILABLE',
  ...impactReasons, 'POST_LOCK_IMPACT_CAPACITY']
const admissionBlockers = ['VMF_UPDATE_REQUIRED', 'CONTROLLED_REPLAY_ISOLATED', 'POST_LOCK_ADMISSION_POLICY_UNAVAILABLE',
  ...impactReasons, 'POST_LOCK_ADMISSION_DECISION_REQUIRED', 'POST_LOCK_ADMISSION_DISPOSITION_BLOCKED',
  'POST_LOCK_ADMISSION_RETENTION_BLOCKED', 'POST_LOCK_ADMISSION_CHILD_EXISTS', 'POST_LOCK_ADMISSION_ALREADY_RECORDED',
  'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED']
const verification = object({ status: z.literal('VERIFIED'), reason: z.null() })
const latestDecision = object({ decisionId: postLockImpactEntrySchema.shape.decisionId,
  sequence: postLockImpactEntrySchema.shape.sequence, disposition: postLockImpactEntrySchema.shape.disposition,
  rationale: text(2000), reviewerUserId: id, authority: z.literal('VMF_UPDATE'), decidedAt: time,
  previousDecisionHash: hash.nullable(), decisionHash: hash,
  audit: object({ id, signatureVersion: positive }), verified: z.literal(true), isCurrent: z.literal(true) })
const impactSchema = object({ state: z.enum(['NOT_RECORDED', 'RECORDED', 'UNVERIFIED']),
  verification: z.union([verification, object({ status: z.literal('UNVERIFIED'), reason: z.enum(impactReasons) })]),
  headHash: hash.nullable(), latestDecision: latestDecision.nullable(), decisionCount: z.number().int().min(0).max(1000) })
const admissionSchema = z.union([
  object({ state: z.literal('NOT_RECORDED'), verification: object({ status: z.literal('NOT_APPLICABLE'), reason: z.null() }),
    initialBasis: z.null() }),
  object({ state: z.literal('UNVERIFIED'), verification: object({ status: z.literal('UNVERIFIED'), reason: z.enum(admissionReasons) }),
    initialBasis: z.null() }),
  object({ state: z.literal('RECORDED'), verification,
    admissionId: z.string().regex(/^post_lock_admission_[a-f0-9]{64}$/), admittedAt: time, actorUserId: id, rationale: text(2000),
    selectedDecision: object({ decisionId: postLockImpactEntrySchema.shape.decisionId, decisionHash: hash,
      sequence: postLockImpactEntrySchema.shape.sequence, disposition: z.literal('SUCCESSOR_REVISION_REQUIRED') }),
    child: object({ runtimeInstanceId: id, runtimeInstanceKey: text(160), revisionNumber: positive }),
    receipt: object({ auditId: id, signatureVersion: positive }),
    initialBasis: object({ status: z.literal('NOT_REVALIDATED'),
      basisStateVersion: postLockBindingSchema.shape.basisStateVersion, membershipHash: hash }) }),
])
const blockers = values => z.array(z.enum(values)).max(16).refine(rows => new Set(rows).size === rows.length)
const action = values => object({ eligibility: z.enum(['ELIGIBLE_AS_READ', 'BLOCKED']), blockedBy: blockers(values) })
const readStateSchema = object({ contractVersion: z.literal(POST_LOCK_READ_STATE_VERSION), readAt: time, currency: z.literal('AS_READ'),
  impact: impactSchema, admission: admissionSchema,
  actions: object({ recordImpact: action(recordBlockers), admission: action(admissionBlockers).extend({
    operationalChecks: object({ indexes: z.literal('NOT_CHECKED'), execution: z.literal('RECHECKED_ON_SUBMIT') }),
  }).strict() }),
}).superRefine((value, ctx) => {
  const { impact, admission, actions } = value
  const need = condition => { if (!condition) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Contradictory retained read state.' }) }
  for (const entry of [actions.recordImpact, actions.admission]) need((entry.eligibility === 'ELIGIBLE_AS_READ') === !entry.blockedBy.length)
  if (impact.state === 'NOT_RECORDED') {
    need(impact.verification.status === 'VERIFIED' && impact.decisionCount === 0 && impact.headHash === null && impact.latestDecision === null)
  } else if (impact.state === 'UNVERIFIED') {
    need(impact.verification.status === 'UNVERIFIED' && impact.decisionCount > 0 && impact.headHash === null && impact.latestDecision === null)
    need(actions.recordImpact.blockedBy.includes(impact.verification.reason) && actions.admission.blockedBy.includes(impact.verification.reason))
  } else {
    need(impact.verification.status === 'VERIFIED' && impact.decisionCount > 0 && impact.latestDecision !== null
      && impact.latestDecision?.sequence === impact.decisionCount && impact.headHash === impact.latestDecision?.decisionHash)
    if (impact.latestDecision) need((impact.latestDecision.sequence === 1) === (impact.latestDecision.previousDecisionHash === null))
  }
  if (impact.verification.status === 'VERIFIED') {
    need(![...actions.recordImpact.blockedBy, ...actions.admission.blockedBy].some(reason => impactReasons.includes(reason)))
    if (impact.state === 'NOT_RECORDED') need(actions.admission.blockedBy.includes('POST_LOCK_ADMISSION_DECISION_REQUIRED'))
    else if (impact.latestDecision?.disposition !== 'SUCCESSOR_REVISION_REQUIRED') {
      need(actions.admission.blockedBy.includes('POST_LOCK_ADMISSION_DISPOSITION_BLOCKED'))
    }
  }
  if (admission.state === 'UNVERIFIED') need(actions.admission.blockedBy.includes('POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED'))
  if (admission.state === 'RECORDED') {
    need(impact.state === 'RECORDED' && admission.selectedDecision.sequence <= impact.decisionCount
      && admission.child.revisionNumber >= 2 && actions.admission.blockedBy.includes('POST_LOCK_ADMISSION_ALREADY_RECORDED'))
    if (admission.selectedDecision.sequence === impact.latestDecision?.sequence) need(admission.selectedDecision.decisionId === impact.latestDecision.decisionId
      && admission.selectedDecision.decisionHash === impact.latestDecision.decisionHash)
  }
  if (actions.admission.eligibility === 'ELIGIBLE_AS_READ') need(admission.state === 'NOT_RECORDED'
    && impact.state === 'RECORDED' && impact.latestDecision?.disposition === 'SUCCESSOR_REVISION_REQUIRED')
})

export const parsePostLockEvidenceReadState = value => {
  try {
    // Descriptor checks precede the generic JSON guard's clone operation.
    const plain = membershipJson(value)
    if (!isBoundedSafeJson(value, { maxDepth: 12, maxEntries: 10000, maxBytes: READ_STATE_MAX_BYTES, maxStringScalars: 8000 })) throw new Error('Unsafe state.')
    const parsed = readStateSchema.parse(plain)
    if (serializedBytes(parsed, reasons.state) > READ_STATE_MAX_BYTES) throw new Error('State bound.')
    return parsed
  } catch { throw postLockReadStateError(reasons.state) }
}
export const assertPostLockReadResponseEnvelope = envelope => {
  if (serializedBytes(envelope, reasons.response) > READ_RESPONSE_MAX_BYTES) throw postLockReadStateError(reasons.response)
  return envelope
}
const unique = rows => [...new Set(rows)]
const eligible = blockedBy => ({ eligibility: blockedBy.length ? 'BLOCKED' : 'ELIGIBLE_AS_READ', blockedBy: unique(blockedBy) })

export const readPostLockEvidenceState = async (args, { readBudget = createPostLockReadBudget() } = {}) => {
  try {
    readBudget.check()
    const result = await withPostLockEvidenceTransaction(async session => {
      readBudget.check()
      const ctx = await readPostLockImpactViewContext(args, session, { readBudget })
      const historical = await readHistoricalPostLockAdmission(ctx, session, { readBudget })
      const impactVerified = ctx.verification.verified, latest = ctx.history.entries.at(-1)
      const impact = { state: !impactVerified ? 'UNVERIFIED' : latest ? 'RECORDED' : 'NOT_RECORDED',
        verification: { status: impactVerified ? 'VERIFIED' : 'UNVERIFIED', reason: ctx.verification.reason },
        headHash: impactVerified ? ctx.history.headHash : null,
        latestDecision: impactVerified && latest ? publicPostLockImpactEntry(latest, true, ctx.history.headHash) : null,
        decisionCount: ctx.history.entries.length }
      const blockedBy = ctx.capability.blockedBy.filter(reason => ['VMF_UPDATE_REQUIRED', 'CONTROLLED_REPLAY_ISOLATED', ...impactReasons].includes(reason))
      const frameworkPackage = await FrameworkPackage.findOne({ _id: ctx.runtime.packageId }).setOptions({ session, ...readBudget() }).lean()
      try {
        if (assertPostLockRecordingBinding({ frameworkPackage, runtime: ctx.runtime, operation: 'admission' }) !== ctx.submission.binding.policyHash) {
          blockedBy.push('POST_LOCK_ADMISSION_POLICY_UNAVAILABLE')
        }
      } catch (error) {
        if (error.details?.reason !== 'POST_LOCK_ADMISSION_POLICY_UNAVAILABLE') throw error
        blockedBy.push('POST_LOCK_ADMISSION_POLICY_UNAVAILABLE')
      }
      if (impactVerified) {
        if (!latest) blockedBy.push('POST_LOCK_ADMISSION_DECISION_REQUIRED')
        else if (latest.disposition !== 'SUCCESSOR_REVISION_REQUIRED') blockedBy.push('POST_LOCK_ADMISSION_DISPOSITION_BLOCKED')
      }
      const readAt = new Date().toISOString(), licensing = ctx.submission.source.licensing
      if (!licensing.retentionPermitted || licensing.retainUntil !== null && Date.parse(licensing.retainUntil) <= Date.parse(readAt)) {
        blockedBy.push('POST_LOCK_ADMISSION_RETENTION_BLOCKED')
      }
      if (historical.childExists) blockedBy.push('POST_LOCK_ADMISSION_CHILD_EXISTS')
      if (historical.admission.state === 'RECORDED') blockedBy.push('POST_LOCK_ADMISSION_ALREADY_RECORDED')
      if (historical.admission.state === 'UNVERIFIED') blockedBy.push('POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
      const readState = parsePostLockEvidenceReadState({ contractVersion: POST_LOCK_READ_STATE_VERSION, readAt, currency: 'AS_READ',
        impact, admission: historical.admission, actions: { recordImpact: eligible(ctx.capability.blockedBy),
          admission: { ...eligible(blockedBy), operationalChecks: { indexes: 'NOT_CHECKED', execution: 'RECHECKED_ON_SUBMIT' } } } })
      readBudget.check()
      return { ...ctx.submission, readState }
    }, { timeoutMS: readBudget.remainingMS() })
    readBudget.check()
    return result
  } catch (error) { throw normalizePostLockReadStateError(error, readBudget) }
}
