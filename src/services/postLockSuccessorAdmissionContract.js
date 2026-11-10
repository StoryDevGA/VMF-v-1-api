import { z } from 'zod'
import { buildCanonicalJson, generateChecksum } from './governanceAudit/checksumService.js'
import { membershipJson } from './runtimeEvidenceSnapshotContract.js'
import { POST_LOCK_SUBMISSION_VERSION, postLockBindingSchema, postLockSubmissionSchema,
  parsePostLockAssociation, postLockSubmissionId, postLockRequestDigest, validPostLockRow } from './postLockEvidenceIntakeContract.js'
import { postLockImpactEntrySchema, assertPostLockImpactHistory, postLockImpactDecisionId,
  postLockImpactDecisionHash, postLockImpactPayloadHash, postLockImpactRequestFromEntry } from './postLockImpactDecisionContract.js'

// Material checks are not authority: the normal revision owner supplies actual
// permission, signature verification, concurrency fencing and native readback.
export const POST_LOCK_ADMISSION_VERSION = 'post-lock-successor-admission.v1'
export const POST_LOCK_ORIGIN_VERSION = 'post-lock-successor-origin.v1'
export const POST_LOCK_ORIGIN_MAX_BYTES = 96 * 1024
const object = shape => z.object(shape).strict()
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().regex(/^[a-f0-9]{24}$/)
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
const text = max => z.string().trim().min(1).max(max)
const time = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
const signatureVersion = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const equal = (left, right) => left === undefined || right === undefined
  ? left === right : generateChecksum(left) === generateChecksum(right)
const bytes = value => Buffer.byteLength(buildCanonicalJson(value), 'utf8')
export const postLockAdmissionError = (reason, status = 409) => Object.assign(new Error({
  POST_LOCK_ADMISSION_REQUEST_INVALID: 'The explicit successor admission request is invalid.',
  POST_LOCK_ADMISSION_MATERIAL_INVALID: 'The retained admission material is inconsistent.',
  POST_LOCK_ADMISSION_STALE: 'The selected submission or impact head changed. Refresh before admission.',
  POST_LOCK_ADMISSION_DISPOSITION_BLOCKED: 'The latest impact conclusion does not require a successor revision.',
  POST_LOCK_ADMISSION_RETENTION_BLOCKED: 'The selected source does not permit retention at admission time.',
  POST_LOCK_ADMISSION_TARGET_INVALID: 'A distinct successor target is required.',
}[reason] || 'Successor admission material could not be planned.'), {
  status, code: status === 422 ? 'VALIDATION_FAILED' : status === 503 ? 'SERVICE_UNAVAILABLE' : 'CONFLICT', details: { reason },
})
const requireValue = (condition, reason = 'POST_LOCK_ADMISSION_MATERIAL_INVALID', status = 503) => {
  if (!condition) throw postLockAdmissionError(reason, status)
}
export const postLockAdmissionRequestSchema = object({
  contractVersion: z.literal(POST_LOCK_ADMISSION_VERSION), requestKey: uuid, submissionId: hash,
  expectedSubmissionDigest: hash, expectedBinding: postLockBindingSchema, expectedImpactHeadHash: hash,
  rationale: text(2000), confirm: z.literal(true),
}).refine(value => bytes(value) <= 8192, 'Admission request exceeds 8 KiB.')
export const parsePostLockAdmissionRequest = value => {
  try { return postLockAdmissionRequestSchema.parse(membershipJson(value)) }
  catch { throw postLockAdmissionError('POST_LOCK_ADMISSION_REQUEST_INVALID', 422) }
}
export const postLockAdmissionId = request => `post_lock_admission_${generateChecksum({
  customerId: request.expectedBinding.customerId, tenantId: request.expectedBinding.tenantId,
  runtimeInstanceId: request.expectedBinding.runtimeInstanceId, requestKey: request.requestKey,
})}`
export const postLockAdmissionPayloadHash = (request, actorUserId) => generateChecksum({ ...request, actorUserId })
const targetSchema = object({ runtimeInstanceId: id, runtimeInstanceKey: text(160),
  stateVersion: postLockBindingSchema.shape.basisStateVersion })
const metadataSchema = object({ actorUserId: id, admittedAt: time, auditId: id, auditSignatureVersion: signatureVersion })
const originSchema = object({
  contractVersion: z.literal(POST_LOCK_ORIGIN_VERSION), submission: postLockSubmissionSchema,
  submittedBy: id, submittedAt: time, receiptId: id, impact: postLockImpactEntrySchema,
  admission: object({ admissionId: z.string().regex(/^post_lock_admission_[a-f0-9]{64}$/), requestKey: uuid,
    payloadHash: hash, actorUserId: id, admittedAt: time, rationale: text(2000), target: targetSchema,
    auditId: id, auditSignatureVersion: signatureVersion }),
})
const retained = (source, at) => source.licensing.retentionPermitted === true
  && (source.licensing.retainUntil === null || Date.parse(source.licensing.retainUntil) > Date.parse(at))
const distinctTarget = (target, binding) => target.runtimeInstanceId !== binding.runtimeInstanceId
  && target.runtimeInstanceKey !== binding.runtimeInstanceKey && target.stateVersion !== binding.basisStateVersion
const requestFromOrigin = origin => ({ contractVersion: POST_LOCK_ADMISSION_VERSION,
  requestKey: origin.admission.requestKey, submissionId: postLockSubmissionId(origin.submission),
  expectedSubmissionDigest: postLockRequestDigest(origin.submission, origin.submittedBy),
  expectedBinding: origin.submission.binding, expectedImpactHeadHash: origin.impact.decisionHash,
  rationale: origin.admission.rationale, confirm: true })

// This verifies retained material relationships, not signatures or permission.
export const parsePostLockSuccessorOrigin = value => {
  try {
    const plain = membershipJson(value), origin = originSchema.parse(plain)
    requireValue(bytes(origin) <= POST_LOCK_ORIGIN_MAX_BYTES && equal(plain, origin))
    const request = parsePostLockAdmissionRequest(requestFromOrigin(origin)), entry = origin.impact
    requireValue(entry.submissionId === request.submissionId && entry.submissionRequestDigest === request.expectedSubmissionDigest
      && equal(entry.binding, request.expectedBinding) && entry.disposition === 'SUCCESSOR_REVISION_REQUIRED'
      && entry.decisionId === postLockImpactDecisionId(entry.submissionId, entry.requestKey)
      && entry.payloadHash === postLockImpactPayloadHash(postLockImpactRequestFromEntry(entry), entry.reviewerUserId, entry.submissionId)
      && entry.decisionHash === postLockImpactDecisionHash(entry)
      && origin.admission.admissionId === postLockAdmissionId(request)
      && origin.admission.payloadHash === postLockAdmissionPayloadHash(request, origin.admission.actorUserId)
      && distinctTarget(origin.admission.target, origin.submission.binding)
      && Date.parse(origin.submittedAt) <= Date.parse(entry.decidedAt)
      && Date.parse(entry.decidedAt) <= Date.parse(origin.admission.admittedAt)
      && retained(origin.submission.source, origin.admission.admittedAt))
    return origin
  } catch { throw postLockAdmissionError('POST_LOCK_ADMISSION_MATERIAL_INVALID', 503) }
}

export const buildPostLockSuccessorCandidatePlan = ({ request: input, sourceRow, evidenceRow, target: inputTarget,
  admission: inputAdmission } = {}) => {
  const request = parsePostLockAdmissionRequest(input)
  let source, evidence, history
  try {
    requireValue(validPostLockRow(sourceRow, 'source') && validPostLockRow(evidenceRow, 'evidence'))
    requireValue(['sourceType', 'contentHash', 'lineageRef'].every(key => evidenceRow[key] === sourceRow[key]))
    source = parsePostLockAssociation(sourceRow.postLockAssociation, 'source')
    evidence = parsePostLockAssociation(evidenceRow.postLockAssociation, 'evidence')
    requireValue(equal(sourceRow.postLockAssociation, source) && equal(evidenceRow.postLockAssociation, evidence))
    for (const key of ['submissionId', 'requestKey', 'requestDigest', 'binding', 'submittedBy', 'submittedAt', 'receiptId', 'status']) {
      requireValue(equal(source[key], evidence[key]))
    }
    history = assertPostLockImpactHistory(evidenceRow.postLockImpactHistory, evidence)
  } catch { throw postLockAdmissionError('POST_LOCK_ADMISSION_MATERIAL_INVALID', 503) }
  const submission = { contractVersion: POST_LOCK_SUBMISSION_VERSION, requestKey: source.requestKey, binding: source.binding,
    source: source.source, evidence: evidence.evidence, reason: evidence.reason }
  requireValue(postLockSubmissionId(submission) === source.submissionId
    && postLockRequestDigest(submission, source.submittedBy) === source.requestDigest)
  requireValue(request.submissionId === source.submissionId && request.expectedSubmissionDigest === source.requestDigest
    && equal(request.expectedBinding, source.binding) && request.expectedImpactHeadHash === history.headHash,
  'POST_LOCK_ADMISSION_STALE', 409)
  const impact = history.entries.at(-1)
  requireValue(impact.disposition === 'SUCCESSOR_REVISION_REQUIRED', 'POST_LOCK_ADMISSION_DISPOSITION_BLOCKED', 409)
  let target, metadata
  try { target = targetSchema.parse(membershipJson(inputTarget)); metadata = metadataSchema.parse(membershipJson(inputAdmission)) }
  catch { throw postLockAdmissionError('POST_LOCK_ADMISSION_TARGET_INVALID', 422) }
  requireValue(distinctTarget(target, source.binding), 'POST_LOCK_ADMISSION_TARGET_INVALID', 422)
  requireValue(retained(source.source, metadata.admittedAt), 'POST_LOCK_ADMISSION_RETENTION_BLOCKED', 409)
  const admissionId = postLockAdmissionId(request), payloadHash = postLockAdmissionPayloadHash(request, metadata.actorUserId)
  const origin = parsePostLockSuccessorOrigin({ contractVersion: POST_LOCK_ORIGIN_VERSION, submission,
    submittedBy: source.submittedBy, submittedAt: source.submittedAt, receiptId: source.receiptId, impact,
    admission: { admissionId, requestKey: request.requestKey, payloadHash, ...metadata, rationale: request.rationale, target } })
  const sourceId = `post-lock-source:${source.submissionId}`, lineageRef = source.source.provenance.receiptRef
  const copyOrigin = () => membershipJson(origin)
  return { contractVersion: 'post-lock-successor-candidate-plan.v1', admissionId, payloadHash,
    source: { sourceId, sourceType: source.source.sourceType, title: source.source.title, label: source.source.title,
      contentHash: source.source.contentHash, sourceRef: source.source.locator.url || '',
      ...(source.source.locator.url ? { url: source.source.locator.url } : {}),
      acquisitionStatus: 'POST_LOCK_ADMITTED', lineageRef, reviewStatus: 'PENDING_REVIEW', postLockOrigin: copyOrigin() },
    evidence: { evidenceObjectId: `post-lock:${source.submissionId}`, sourceId, sourceType: source.source.sourceType,
      title: evidence.evidence.title, extractedFact: evidence.evidence.statement, sourceLocation: membershipJson(source.source.locator),
      reviewStatus: 'PENDING_REVIEW', acceptanceState: 'CANDIDATE', lineageRef, postLockOrigin: copyOrigin() },
  }
}

const initialScopeSchema = object({ customerId: id, tenantId: id, runtimeInstanceId: id, runtimeInstanceKey: text(160),
  rootRuntimeInstanceId: id, rootRuntimeInstanceKey: text(160), revisionNumber: z.number().int().positive(),
  workspaceId: z.string().trim().max(160) })
const initialPackageSchema = object({ packageId: id, packageKey: text(240), packageVersion: text(240),
  dependencyLockId: text(240), activationId: text(240), deploymentId: text(240) })
const receiptSchema = object({ contractVersion: z.literal('post-lock-admission-receipt.v1'),
  admissionId: z.string().regex(/^post_lock_admission_[a-f0-9]{64}$/), requestKey: uuid,
  nestedRequestPayloadHash: hash, operationPayloadHash: hash, request: postLockAdmissionRequestSchema,
  expectedUpdatedAt: time, revisionReason: z.string().trim().max(1000), actorUserId: id, admittedAt: time,
  target: targetSchema, originHash: hash, auditId: id, auditSignatureVersion: signatureVersion,
  basis: object({ fingerprintVersion: z.literal('post-lock-successor-initial-basis.v1'),
    manifestContractVersion: z.literal('published-evidence-membership.v1'), basisStateVersion: postLockBindingSchema.shape.basisStateVersion,
    membershipHash: hash, scope: initialScopeSchema, package: initialPackageSchema,
    counts: object({ sources: z.number().int().min(1).max(1000), evidence: z.number().int().min(1).max(5000),
      sections: z.number().int().min(0).max(100) }) }),
})
export const postLockRevisionAdmissionOperationHash = ({ postLockAdmission, actorUserId, expectedUpdatedAt, reason = '' }) => {
  try {
    const request = parsePostLockAdmissionRequest(postLockAdmission)
    return generateChecksum({ contractVersion: 'post-lock-revision-admission-operation.v1', actorUserId: id.parse(actorUserId),
      expectedUpdatedAt: time.parse(expectedUpdatedAt), reason: z.string().trim().max(1000).parse(reason), postLockAdmission: request })
  } catch { throw postLockAdmissionError('POST_LOCK_ADMISSION_REQUEST_INVALID', 422) }
}
export const parsePostLockAdmissionReceipt = value => {
  try {
    const plain = membershipJson(value), receipt = receiptSchema.parse(plain), request = receipt.request, binding = request.expectedBinding
    requireValue(bytes(receipt) <= 16384 && equal(plain, receipt)
      && receipt.admissionId === postLockAdmissionId(request) && receipt.requestKey === request.requestKey
      && receipt.nestedRequestPayloadHash === postLockAdmissionPayloadHash(request, receipt.actorUserId)
      && receipt.operationPayloadHash === postLockRevisionAdmissionOperationHash({ postLockAdmission: request,
        actorUserId: receipt.actorUserId, expectedUpdatedAt: receipt.expectedUpdatedAt, reason: receipt.revisionReason })
      && distinctTarget(receipt.target, binding) && receipt.basis.basisStateVersion === receipt.target.stateVersion
      && receipt.basis.scope.runtimeInstanceId === receipt.target.runtimeInstanceId
      && receipt.basis.scope.runtimeInstanceKey === receipt.target.runtimeInstanceKey
      && receipt.basis.scope.customerId === binding.customerId && receipt.basis.scope.tenantId === binding.tenantId
      && receipt.basis.scope.revisionNumber === binding.revisionNumber + 1
      && receipt.basis.package.packageId === binding.packageId && receipt.basis.package.packageVersion === binding.packageVersion)
    return receipt
  } catch { throw postLockAdmissionError('POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED', 503) }
}
export const assertPostLockAdmissionReceiptOrigin = (receiptValue, originValue) => {
  const receipt = parsePostLockAdmissionReceipt(receiptValue), origin = parsePostLockSuccessorOrigin(originValue), admission = origin.admission
  requireValue(receipt.originHash === generateChecksum(origin) && equal(receipt.request, requestFromOrigin(origin))
    && receipt.admissionId === admission.admissionId && receipt.nestedRequestPayloadHash === admission.payloadHash
    && receipt.actorUserId === admission.actorUserId && receipt.admittedAt === admission.admittedAt
    && receipt.auditId === admission.auditId && receipt.auditSignatureVersion === admission.auditSignatureVersion
    && equal(receipt.target, admission.target), 'POST_LOCK_ADMISSION_RECEIPT_UNVERIFIED')
  return receipt
}
export const projectPostLockOrigin = (input, kind) => {
  const row = typeof input?.toObject === 'function' ? input.toObject({ depopulate: true }) : input
  if (!row || !Object.hasOwn(row, 'postLockOrigin')) return {}
  const origin = parsePostLockSuccessorOrigin(row.postLockOrigin), submissionId = postLockSubmissionId(origin.submission)
  const source = origin.submission.source, evidence = origin.submission.evidence, sourceId = `post-lock-source:${submissionId}`
  requireValue(['source', 'evidence'].includes(kind) && !Object.hasOwn(row, 'postLockAssociation')
    && !Object.hasOwn(row, 'postLockImpactHistory') && !Object.hasOwn(row, 'postLockAdmission')
    && row.sourceId === sourceId && (row.sourceType ?? row.type) === source.sourceType
    && (row.type === undefined || row.type === source.sourceType)
    && row.lineageRef === source.provenance.receiptRef)
  if (row.customerId !== undefined) requireValue(String(row.customerId) === origin.submission.binding.customerId)
  if (row.tenantId !== undefined) requireValue(String(row.tenantId) === origin.submission.binding.tenantId)
  if (kind === 'source') {
    requireValue(row.contentHash === source.contentHash
      && (row.title !== undefined || row.label !== undefined)
      && (row.title === undefined || row.title === source.title) && (row.label === undefined || row.label === source.title)
      && (row.sourceRef === undefined || row.sourceRef === (source.locator.url || ''))
      && (row.url === undefined || row.url === source.locator.url)
      && (!source.locator.url || row.sourceRef === source.locator.url || row.url === source.locator.url))
  } else {
    requireValue(row.evidenceObjectId === `post-lock:${submissionId}` && row.title === evidence.title
      && row.extractedFact === evidence.statement && equal(membershipJson(row.sourceLocation), source.locator)
      && (row.contentHash === undefined || row.contentHash === source.contentHash))
  }
  return { postLockOrigin: origin }
}
export const assertPostLockOriginPairs = ({ sources = [], evidenceObjects = [] } = {}) => {
  const hasOrigin = row => row && Object.hasOwn(row, 'postLockOrigin')
  if (![...sources, ...evidenceObjects].some(hasOrigin)) return
  for (const source of sources) if (hasOrigin(source)) {
    projectPostLockOrigin(source, 'source')
    requireValue(evidenceObjects.filter(row => row?.sourceId === source.sourceId && hasOrigin(row)).length === 1)
  }
  for (const evidence of evidenceObjects) {
    const matches = sources.filter(source => source?.sourceId === evidence?.sourceId)
    if (!hasOrigin(evidence) && !matches.some(hasOrigin)) continue
    requireValue(matches.length === 1 && hasOrigin(evidence) && hasOrigin(matches[0]))
    requireValue(equal(projectPostLockOrigin(evidence, 'evidence'), projectPostLockOrigin(matches[0], 'source')))
  }
}
export const validPostLockAdmissionRow = input => {
  try {
    const row = typeof input?.toObject === 'function' ? input.toObject({ depopulate: true }) : input
    requireValue(validPostLockRow(row, 'evidence') && !Object.hasOwn(row, 'postLockOrigin'))
    const receipt = parsePostLockAdmissionReceipt(row.postLockAdmission), association = row.postLockAssociation
    requireValue(receipt.request.submissionId === association.submissionId
      && receipt.request.expectedSubmissionDigest === association.requestDigest
      && equal(receipt.request.expectedBinding, association.binding))
    const history = assertPostLockImpactHistory(row.postLockImpactHistory, association)
    requireValue(history.entries.some(entry => entry.decisionHash === receipt.request.expectedImpactHeadHash
      && entry.disposition === 'SUCCESSOR_REVISION_REQUIRED'))
    return true
  } catch { return false }
}
export const validPostLockRevisionAdmission = (input, { initial = input?.isNew === true } = {}) => {
  try {
    const runtime = typeof input?.toObject === 'function' ? input.toObject({ depopulate: true }) : input
    const receipt = parsePostLockAdmissionReceipt(runtime.revision.postLockAdmission), binding = receipt.request.expectedBinding
    requireValue(String(runtime._id || runtime.id) === receipt.target.runtimeInstanceId
      && runtime.runtimeInstanceKey === receipt.target.runtimeInstanceKey
      && String(runtime.customerId) === binding.customerId && String(runtime.tenantId) === binding.tenantId
      && String(runtime.revision.parentRuntimeId) === binding.runtimeInstanceId
      && runtime.revision.parentRuntimeInstanceKey === binding.runtimeInstanceKey
      && runtime.revision.revisionNumber === binding.revisionNumber + 1
      && runtime.revision.createdFromRevision === binding.revisionNumber
      && String(runtime.revision.rootRuntimeId) === receipt.basis.scope.rootRuntimeInstanceId
      && runtime.revision.rootRuntimeInstanceKey === receipt.basis.scope.rootRuntimeInstanceKey
      && (!initial || runtime.stateVersion === receipt.target.stateVersion))
    return true
  } catch { return false }
}
