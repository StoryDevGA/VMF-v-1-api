import { z } from 'zod'
import mongoose from 'mongoose'
import { generateChecksum, buildCanonicalJson } from './governanceAudit/checksumService.js'
import { membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { discoveryPolicySchema, resolvePackageDiscoveryPolicy } from './discoveryPolicyContract.js'
import { POST_LOCK_DISCOVERY_DISPOSITIONS } from './discoveryContractReadinessService.js'

export const POST_LOCK_SUBMISSION_VERSION = 'post-lock-evidence-submission.v1'
export const POST_LOCK_ASSOCIATION_VERSION = 'post-lock-evidence-association.v1'
const object = shape => z.object(shape).strict()
const text = max => z.string().trim().min(1).max(max)
const id = z.string().regex(/^[a-f0-9]{24}$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
const date = z.string().datetime().refine(value => Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value, 'Use canonical UTC time.')
const unique = (schema, max) => z.array(schema).max(max).refine(rows => new Set(rows).size === rows.length, 'Values must be unique.')
const type = z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/)
export const postLockBindingSchema = object({
  customerId: id, tenantId: id, runtimeInstanceId: id, runtimeInstanceKey: text(160),
  revisionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  basisStateVersion: z.string().regex(/^rsv2:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  evidenceSnapshotId: z.string().regex(/^evidence_snapshot_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  membershipHash: hash, lockSnapshotId: text(240), lockSnapshotHash: hash,
  packageId: id, packageVersion: text(180), dependencySnapshotId: text(240), dependencySnapshotHash: hash, policyHash: hash,
})
export const postLockSourceSchema = object({
  sourceId: text(240), sourceType: type, title: text(1000),
  locator: object({
    url: text(2000).url().refine(value => {
      try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password }
      catch { return false }
    }, 'Use an HTTP or HTTPS URL without credentials.').optional(),
    passage: text(4000).optional(), page: z.number().int().min(1).max(100000).optional(),
  }).refine(value => Object.keys(value).length > 0, 'A locator is required.'),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/), retrievedAt: date,
  currentness: z.enum(['AS_OF', 'UNCONFIRMED', 'STALE']), asOfAt: date.optional(),
  qualifications: unique(text(500), 20),
  licensing: object({ licenceRef: text(2000), retentionPermitted: z.boolean(), retainUntil: date.nullable() }),
  provenance: object({ producerKey: text(180), producerVersion: text(180), receiptRef: text(1000), acquiredAt: date }),
}).refine(value => (value.currentness === 'AS_OF') === (value.asOfAt !== undefined), 'AS_OF requires its date; other states omit it.')
export const postLockEvidenceSchema = object({ title: text(1000), statement: text(8000), sectionKeys: unique(text(180), 100) })
export const postLockSubmissionSchema = object({
  contractVersion: z.literal(POST_LOCK_SUBMISSION_VERSION), requestKey: uuid, binding: postLockBindingSchema,
  source: postLockSourceSchema, evidence: postLockEvidenceSchema, reason: text(2000),
}).refine(value => Buffer.byteLength(buildCanonicalJson(value), 'utf8') <= 65536, 'Submission exceeds 64 KiB.')

export const postLockError = (reason, status = 409) => Object.assign(new Error({
  POST_LOCK_BINDING_STALE: 'The selected locked basis changed. Refresh before submitting.',
  POST_LOCK_POLICY_UNAVAILABLE: 'This revision has no supported post-lock intake policy.',
  POST_LOCK_IDEMPOTENCY_CONFLICT: 'This request key already identifies a different submission.',
  POST_LOCK_RETENTION_BLOCKED: 'This source does not permit retaining the submitted material.',
  POST_LOCK_RECEIPT_UNVERIFIED: 'The saved submission receipt could not be verified.',
  POST_LOCK_INDEX_REQUIRED: 'Post-lock intake storage indexes could not be verified.',
  POST_LOCK_STORAGE_UNAVAILABLE: 'Post-lock intake storage is unavailable.',
  POST_LOCK_SUBMISSION_UNCONFIRMED: 'Submission outcome is unconfirmed. Inspect this submission or retry the same request key.',
}[reason] || 'Post-lock evidence could not be read or recorded.'), {
  status, code: status === 503 ? 'SERVICE_UNAVAILABLE' : status === 422 ? 'VALIDATION_FAILED' : status === 404 ? 'NOT_FOUND' : 'CONFLICT',
  details: { reason },
})
export const parsePostLockSubmission = value => {
  const result = postLockSubmissionSchema.safeParse(membershipJson(value))
  if (!result.success) throw postLockError('POST_LOCK_SUBMISSION_INVALID', 422)
  return result.data
}
export const postLockSubmissionId = ({ binding, requestKey }) => generateChecksum({
  contractVersion: POST_LOCK_SUBMISSION_VERSION, customerId: binding.customerId, tenantId: binding.tenantId,
  runtimeInstanceId: binding.runtimeInstanceId, requestKey,
})
export const postLockRequestDigest = (submission, submittedBy) => generateChecksum({ ...submission, submittedBy })
export const postLockSourceHash = requestDigest => `sha256:${generateChecksum({ kind: 'post-lock-pending-material.v1', requestDigest })}`
// The runtime reader makes a native structuredClone. Preserve every descriptor
// across VM realms; the existing verifier still rejects unsafe or extra material.
export const postLockSnapshotPointer = value => Object.create(null, Object.getOwnPropertyDescriptors(value))
const commonAssociation = {
  contractVersion: z.literal(POST_LOCK_ASSOCIATION_VERSION), submissionId: hash, requestKey: uuid, requestDigest: hash,
  binding: postLockBindingSchema, submittedBy: id, submittedAt: date, receiptId: id, status: z.literal('PENDING_REVIEW'),
}
const associationSchemas = {
  source: object({ ...commonAssociation, source: postLockSourceSchema }),
  evidence: object({ ...commonAssociation, evidence: postLockEvidenceSchema, reason: text(2000) }),
}
export const parsePostLockAssociation = (value, kind) => {
  const plain = membershipJson(value)
  if (Buffer.byteLength(buildCanonicalJson(plain), 'utf8') > 65536) throw postLockError('POST_LOCK_RECEIPT_UNVERIFIED', 503)
  return associationSchemas[kind].parse(plain)
}
export const validPostLockRow = (input, kind) => {
  try {
    const row = typeof input.toObject === 'function' ? input.toObject({ depopulate: true }) : input
    const association = parsePostLockAssociation(row.postLockAssociation, kind)
    const binding = association.binding
    if (row.current !== false || ['stateStatus', 'status', 'isCurrent'].some(key => Object.hasOwn(row, key))
      || row.migrationReceiptId != null || row.stateVersion !== binding.basisStateVersion
      || row.sourceStateVersion !== binding.basisStateVersion || row.sourceHash !== postLockSourceHash(association.requestDigest)
      || ['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey'].some(key => String(row[key]) !== binding[key])
      || association.submissionId !== postLockSubmissionId(association)
      || row.sourceId !== `post-lock-source:${association.submissionId}` || row.reviewStatus !== 'PENDING_REVIEW') return false
    if (kind === 'source') return row.sourceType === association.source.sourceType && row.title === association.source.title
      && row.contentHash === association.source.contentHash && row.sourceRef === (association.source.locator.url || '')
      && row.lineageRef === association.source.provenance.receiptRef && row.acquisitionStatus === 'POST_LOCK_PENDING'
    return row.evidenceObjectId === `post-lock:${association.submissionId}` && row.title === association.evidence.title
      && row.extractedFact === association.evidence.statement && row.acceptanceState === 'POST_LOCK_PENDING'
  } catch { return false }
}

// This is an application recording contract, not a VMF semantic method or an
// installation/activation assertion. Unrelated discovery semantics stay unresolved.
export const POST_LOCK_RECORDING_REFERENCE = Object.freeze({
  mappingKey: 'post-lock-pending-evidence', ownerRuntime: 'Outcome Studio', resultType: POST_LOCK_SUBMISSION_VERSION,
  resultContractVersion: '1', sourceRef: 'https://drive.google.com/file/d/1GWIBV6O7VOoze2SMydet74ipxhNfegMv/view',
  sourceVersion: 'Draft1.0', implementationRef: 'post-lock-evidence-intake', implementationVersion: '1',
})
export const POST_LOCK_HUMAN_IMPACT_REFERENCE = Object.freeze({
  mappingKey: 'post-lock-human-impact', ownerRuntime: 'Outcome Studio', resultType: 'post-lock-impact-decision.v1',
  resultContractVersion: '1', sourceRef: POST_LOCK_RECORDING_REFERENCE.sourceRef, sourceVersion: 'Draft1.0',
  implementationRef: 'post-lock-impact-decision', implementationVersion: '1',
})
export const POST_LOCK_ADMISSION_REFERENCE = Object.freeze({
  mappingKey: 'post-lock-successor-admission', ownerRuntime: 'Outcome Studio', resultType: 'post-lock-successor-admission.v1',
  resultContractVersion: '1', sourceRef: POST_LOCK_RECORDING_REFERENCE.sourceRef, sourceVersion: 'Draft1.0',
  implementationRef: 'post-lock-successor-admission', implementationVersion: '1',
})
export const assertPostLockRecordingBinding = ({ frameworkPackage, runtime, operation = 'recording' }) => {
  const parsed = discoveryPolicySchema.safeParse(frameworkPackage?.discoveryPolicy)
  const policy = parsed.success && parsed.data.postLockDiscoveryPolicy
  const resolution = resolvePackageDiscoveryPolicy({ frameworkPackage, runtimeInstance: runtime })
  const references = policy?.references || []
  const recording = references.some(row => generateChecksum(row) === generateChecksum(POST_LOCK_RECORDING_REFERENCE))
  const admission = references.length === 3 && recording
    && references.some(row => generateChecksum(row) === generateChecksum(POST_LOCK_HUMAN_IMPACT_REFERENCE))
    && references.some(row => generateChecksum(row) === generateChecksum(POST_LOCK_ADMISSION_REFERENCE))
    && generateChecksum([...(policy.allowedDispositions || [])].sort()) === generateChecksum(Object.values(POST_LOCK_DISCOVERY_DISPOSITIONS).sort())
  const human = (references.length === 2 || admission) && recording
    && references.some(row => generateChecksum(row) === generateChecksum(POST_LOCK_HUMAN_IMPACT_REFERENCE))
    && generateChecksum([...(policy.allowedDispositions || [])].sort()) === generateChecksum(Object.values(POST_LOCK_DISCOVERY_DISPOSITIONS).sort())
  const recordingOnly = references.length === 1 && recording && policy.allowedDispositions === undefined
  if (!policy || policy.enabled !== true || policy.mutateLockedRevision !== false || !(recordingOnly || human)
    || !['recording', 'impact', 'admission'].includes(operation) || (operation === 'impact' && !human)
    || (operation === 'admission' && !admission)
    || resolution.reason !== 'DISCOVERY_POLICY_MAPPING_UNVERIFIED'
    || String(frameworkPackage._id) !== String(runtime.packageId) || frameworkPackage.frameworkKey !== runtime.frameworkKey
    || frameworkPackage.packageKey !== runtime.packageKey || frameworkPackage.version !== runtime.packageVersion
    // Publication remains blocked until SS-050 supplies its amended readiness
    // contract. Earlier reference policies are historical fixture contracts.
    || !(process.env.NODE_ENV === 'test' && process.env.VMF_POST_LOCK_FIXTURE_POLICY === '1'
      && frameworkPackage.frameworkKey === 'SS056_SYNTHETIC' && runtime.frameworkKey === 'SS056_SYNTHETIC'
      && frameworkPackage.packageKey === 'post-lock-contract-proof' && runtime.packageKey === 'post-lock-contract-proof'
      && (mongoose.connection.readyState === 0 || mongoose.connection.readyState === 1
        && mongoose.connection.host === '127.0.0.1' && mongoose.connection.name === 'ss056_post_lock_intake'))) {
    throw postLockError(operation === 'admission' ? 'POST_LOCK_ADMISSION_POLICY_UNAVAILABLE'
      : operation === 'impact' ? 'POST_LOCK_IMPACT_POLICY_UNAVAILABLE' : 'POST_LOCK_POLICY_UNAVAILABLE')
  }
  return resolution.policyHash
}
