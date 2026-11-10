import { z } from 'zod'
import { buildCanonicalJson, generateChecksum } from './governanceAudit/checksumService.js'
import { membershipJson, EVIDENCE_MEMBERSHIP_VERSION } from './runtimeEvidenceSnapshotContract.js'

export const POST_LOCK_EVIDENCE_LIST_VERSION = 'post-lock-evidence-list.v1'
export const LIST_MATERIAL_MAX_BYTES = 512 * 1024
export const LIST_RESPONSE_MAX_BYTES = 128 * 1024
const CURSOR_VERSION = 'post-lock-evidence-list-cursor.v1'
const CURSOR_PREFIX = `${POST_LOCK_EVIDENCE_LIST_VERSION}.`
const failures = Object.freeze({
  POST_LOCK_EVIDENCE_LIST_QUERY_INVALID: [422, 'VALIDATION_FAILED'],
  POST_LOCK_EVIDENCE_LIST_CURSOR_INVALID: [422, 'VALIDATION_FAILED'],
  POST_LOCK_EVIDENCE_LIST_CURSOR_STALE: [409, 'CONFLICT'],
  POST_LOCK_EVIDENCE_LIST_MATERIAL_CAPACITY_EXCEEDED: [503, 'SERVICE_UNAVAILABLE'],
  POST_LOCK_EVIDENCE_LIST_AUDIT_CAPACITY_EXCEEDED: [503, 'SERVICE_UNAVAILABLE'],
  POST_LOCK_EVIDENCE_LIST_RESPONSE_CAPACITY_EXCEEDED: [503, 'SERVICE_UNAVAILABLE'],
  POST_LOCK_EVIDENCE_LIST_DEADLINE_EXCEEDED: [503, 'SERVICE_UNAVAILABLE'],
  POST_LOCK_EVIDENCE_LIST_DEPENDENCY_UNAVAILABLE: [503, 'SERVICE_UNAVAILABLE'],
})
export const postLockEvidenceListError = reason => {
  const selectedReason = typeof reason === 'string' && Object.hasOwn(failures, reason)
    ? reason : 'POST_LOCK_EVIDENCE_LIST_DEPENDENCY_UNAVAILABLE'
  const [status, code] = failures[selectedReason]
  return Object.assign(new Error('The original post-lock submission list could not complete its bounded read.'), {
    status, code, details: { reason: selectedReason },
  })
}
export const isPostLockEvidenceListError = error => {
  const reason = error?.details?.reason
  const identity = typeof reason === 'string' && Object.hasOwn(failures, reason) ? failures[reason] : null
  return Boolean(identity && error.status === identity[0] && error.code === identity[1])
}
const fail = reason => { throw postLockEvidenceListError(reason) }
const object = shape => z.object(shape).strict()
const id = z.string().regex(/^[a-f0-9]{24}$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const text = max => z.string().min(1).max(max).refine(value => value === value.trim())
const time = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)
const stateVersion = z.string().regex(/^rsv2:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
const evidenceId = z.string().regex(/^post-lock:[a-f0-9]{64}$/)
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const cursorSchema = object({ contractVersion: z.literal(CURSOR_VERSION), basisHash: hash, afterEvidenceObjectId: evidenceId })
const pageSizeSchema = z.union([z.number().int().min(1).max(10), z.string().regex(/^(?:[1-9]|10)$/)])
  .transform(Number).default(5)
const querySchema = object({ customerId: z.string().regex(/^[a-f0-9]{24}$/i).transform(value => value.toLowerCase()),
  tenantId: z.string().regex(/^[a-f0-9]{24}$/i).transform(value => value.toLowerCase()),
  pageSize: pageSizeSchema, cursor: z.string().optional() })
const bytes = (value, reason) => {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') }
  catch { fail(reason) }
}

export const encodePostLockEvidenceListCursor = ({ basisHash, afterEvidenceObjectId }) => {
  try {
    const value = cursorSchema.parse({ contractVersion: CURSOR_VERSION, basisHash, afterEvidenceObjectId })
    return CURSOR_PREFIX + Buffer.from(buildCanonicalJson(value), 'utf8').toString('base64url')
  } catch { fail('POST_LOCK_EVIDENCE_LIST_CURSOR_INVALID') }
}
export const parsePostLockEvidenceListCursor = cursor => {
  if (cursor === undefined) return null
  try {
    if (typeof cursor !== 'string' || Buffer.byteLength(cursor, 'utf8') > 1024 || !cursor.startsWith(CURSOR_PREFIX)) throw new Error('Cursor.')
    const encoded = cursor.slice(CURSOR_PREFIX.length)
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Encoding.')
    const buffer = Buffer.from(encoded, 'base64url')
    if (buffer.length > 512 || buffer.toString('base64url') !== encoded) throw new Error('Cursor bound.')
    const json = buffer.toString('utf8'), parsed = cursorSchema.parse(membershipJson(JSON.parse(json)))
    if (buildCanonicalJson(parsed) !== json) throw new Error('Canonical cursor.')
    return parsed
  } catch { fail('POST_LOCK_EVIDENCE_LIST_CURSOR_INVALID') }
}
export const parsePostLockEvidenceListQuery = value => {
  let query
  try { query = querySchema.parse(membershipJson(value)) }
  catch { fail('POST_LOCK_EVIDENCE_LIST_QUERY_INVALID') }
  parsePostLockEvidenceListCursor(query.cursor)
  return query
}

const fullScopeSchema = object({ customerId: id, tenantId: id, runtimeInstanceId: id, runtimeInstanceKey: text(160),
  rootRuntimeInstanceId: id, rootRuntimeInstanceKey: text(160), revisionNumber: positive,
  workspaceId: z.string().max(160).refine(value => value === value.trim()) })
const packageSchema = object({ packageId: id, packageKey: text(240), packageVersion: text(240),
  dependencyLockId: text(240), activationId: text(240), deploymentId: text(240) })
const pointerSchema = object({ contractVersion: z.literal(EVIDENCE_MEMBERSHIP_VERSION),
  snapshotId: z.string().regex(/^evidence_snapshot_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  membershipHash: hash, basisStateVersion: stateVersion, lockSnapshotId: text(240), lockSnapshotHash: hash })
export const buildPostLockEvidenceListBasis = ({ runtime, body, pointer }) => {
  try {
    const scope = fullScopeSchema.parse(membershipJson(body.scope)), pack = packageSchema.parse(membershipJson(body.package))
    const frozen = pointerSchema.parse(membershipJson(pointer))
    if (scope.runtimeInstanceId !== String(runtime.id || runtime._id) || scope.runtimeInstanceKey !== runtime.runtimeInstanceKey
      || scope.customerId !== String(runtime.customerId) || scope.tenantId !== String(runtime.tenantId)
      || scope.revisionNumber !== runtime.revision?.revisionNumber || frozen.basisStateVersion !== runtime.stateVersion
      || body.basisStateVersion !== runtime.stateVersion) throw new Error('Frame.')
    const basisHash = generateChecksum({ contractVersion: 'post-lock-evidence-list-basis.v1', scope, package: pack, pointer: frozen,
      frameworkKey: text(240).parse(runtime.frameworkKey), dependencySnapshotHash: hash.parse(runtime.evidence?.dependencySnapshotHash) })
    return { basisHash,
      scope: { customerId: scope.customerId, tenantId: scope.tenantId, runtimeInstanceId: scope.runtimeInstanceId,
        runtimeInstanceKey: scope.runtimeInstanceKey, revisionNumber: scope.revisionNumber },
      basis: { basisHash, basisStateVersion: frozen.basisStateVersion, evidenceSnapshotId: frozen.snapshotId,
        membershipHash: frozen.membershipHash, lockSnapshotId: frozen.lockSnapshotId, lockSnapshotHash: frozen.lockSnapshotHash } }
  } catch { fail('POST_LOCK_EVIDENCE_LIST_RESPONSE_CAPACITY_EXCEEDED') }
}

const summarySchema = object({ submissionId: hash, submittedAt: time, submittedBy: id, evidenceTitle: text(1000),
  source: object({ sourceId: text(240), sourceType: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/), title: text(1000) }),
  originalIntake: object({ recordedStatus: z.literal('PENDING_REVIEW'), outsideFrozenMembership: z.literal(true),
    receipt: object({ id, signatureVersion: positive, verified: z.literal(true) }) }),
  detail: object({ contractVersion: z.literal('post-lock-evidence-read-state.v1'),
    impact: z.literal('NOT_LOADED'), admission: z.literal('NOT_LOADED') }) })
const responseSchema = object({ contractVersion: z.literal(POST_LOCK_EVIDENCE_LIST_VERSION), readAt: time, currency: z.literal('AS_READ'),
  population: z.literal('ORIGINAL_POST_LOCK_SUBMISSION_RECEIPTS'),
  scope: object({ customerId: id, tenantId: id, runtimeInstanceId: id, runtimeInstanceKey: text(160), revisionNumber: positive }),
  basis: object({ basisHash: hash, basisStateVersion: stateVersion, evidenceSnapshotId: pointerSchema.shape.snapshotId,
    membershipHash: hash, lockSnapshotId: text(240), lockSnapshotHash: hash }),
  items: z.array(summarySchema).max(10), pagination: object({ pageSize: z.number().int().min(1).max(10),
    hasMore: z.boolean(), nextCursor: z.string().nullable() }) })
export const projectPostLockEvidenceList = ({ frame, receipts, pageSize, readAt = new Date().toISOString() }) => {
  try {
    const size = z.number().int().min(1).max(10).parse(pageSize), basis = buildPostLockEvidenceListBasis(frame)
    if (!Array.isArray(receipts) || receipts.length > size + 1) throw new Error('Page.')
    const all = receipts.map(receipt => {
      if (receipt.status !== 'PENDING_REVIEW' || receipt.outsideFrozenMembership !== true) throw new Error('Receipt status.')
      return summarySchema.parse({ submissionId: receipt.submissionId, submittedAt: receipt.submittedAt,
        submittedBy: receipt.submittedBy, evidenceTitle: receipt.evidence.title,
        source: { sourceId: receipt.source.sourceId, sourceType: receipt.source.sourceType, title: receipt.source.title },
        originalIntake: { recordedStatus: receipt.status, outsideFrozenMembership: receipt.outsideFrozenMembership,
          receipt: receipt.receipt }, detail: { contractVersion: 'post-lock-evidence-read-state.v1', impact: 'NOT_LOADED', admission: 'NOT_LOADED' } })
    })
    if (new Set(all.map(row => row.submissionId)).size !== all.length
      || all.some((row, index) => index && row.submissionId <= all[index - 1].submissionId)) throw new Error('Page order.')
    const items = all.slice(0, size), hasMore = all.length > size
    const data = responseSchema.parse({ contractVersion: POST_LOCK_EVIDENCE_LIST_VERSION, readAt, currency: 'AS_READ',
      population: 'ORIGINAL_POST_LOCK_SUBMISSION_RECEIPTS', scope: basis.scope, basis: basis.basis, items,
      pagination: { pageSize: size, hasMore, nextCursor: hasMore ? encodePostLockEvidenceListCursor({ basisHash: basis.basisHash,
        afterEvidenceObjectId: `post-lock:${items.at(-1).submissionId}` }) : null } })
    assertPostLockEvidenceListResponseEnvelope({ data, meta: { requestId: '00000000-0000-4000-8000-000000000000', version: 'v1' } })
    return data
  } catch { fail('POST_LOCK_EVIDENCE_LIST_RESPONSE_CAPACITY_EXCEEDED') }
}
export const assertPostLockEvidenceListMaterialSize = (evidenceRows, sourceRows) => {
  if (!Array.isArray(evidenceRows) || !Array.isArray(sourceRows)
    || bytes({ evidenceRows, sourceRows }, 'POST_LOCK_EVIDENCE_LIST_MATERIAL_CAPACITY_EXCEEDED') > LIST_MATERIAL_MAX_BYTES) {
    fail('POST_LOCK_EVIDENCE_LIST_MATERIAL_CAPACITY_EXCEEDED')
  }
}
export const assertPostLockEvidenceListResponseEnvelope = envelope => {
  if (bytes(envelope, 'POST_LOCK_EVIDENCE_LIST_RESPONSE_CAPACITY_EXCEEDED') > LIST_RESPONSE_MAX_BYTES) {
    fail('POST_LOCK_EVIDENCE_LIST_RESPONSE_CAPACITY_EXCEEDED')
  }
  return envelope
}
