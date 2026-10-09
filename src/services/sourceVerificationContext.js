import { z } from 'zod'
import { generateChecksum } from './governanceAudit/checksumService.js'

const text = (max) => z.string().trim().min(1).max(max)
export const sourceVerificationFactsSchema = z.object({
  authenticity: z.enum(['AUTHENTIC', 'UNVERIFIED', 'INVALID']),
  sourceOrigin: text(1000),
  organizationRelationship: text(1000),
  independenceGroup: text(240),
  supportingReference: text(2000),
  rationale: text(2000),
}).strict()

export const sourceVerificationContextSchema = sourceVerificationFactsSchema.extend({
  contractVersion: z.literal('source-recorded-review.v1'),
  status: z.literal('RECORDED_REVIEW'),
  reviewedBy: text(240),
  reviewedAt: z.string().datetime(),
  sourceFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict()

// The receipt binds material shared by the root registry and its native projection.
// The receipt itself must not participate in its own fingerprint.
export const sourceMaterialFingerprint = (source) => `sha256:${generateChecksum({
  sourceId: String(source.sourceId || '').trim(),
  sourceType: String(source.sourceType || '').trim().toUpperCase(),
  title: String(source.title ?? source.label ?? '').trim(),
  sourceRef: String(source.sourceRef ?? source.url ?? source.fileRef
    ?? (source.sourceType === 'UPLOADED_DOCUMENT' ? source.fileName : '') ?? '').trim(),
  // Legacy root sourceHash is a content alias; native sourceHash is a domain hash.
  contentHash: String(source.contentHash ??
    (Object.hasOwn(source, 'sourceStateVersion') || Object.hasOwn(source, 'migrationReceiptId') ? '' : source.sourceHash) ?? '').trim(),
  lineageRef: String(source.lineageRef ?? source.lineage ?? '').trim(),
})}`

export const resolveSourceRecordedReview = (source) => {
  const parsed = sourceVerificationContextSchema.safeParse(source?.verificationContext)
  if (!parsed.success || parsed.data.sourceFingerprint !== sourceMaterialFingerprint(source)) return null
  return parsed.data
}

export const recordSourceReview = ({ source, facts, actorUserId, reviewedAt = new Date().toISOString() }) =>
  sourceVerificationContextSchema.parse({ ...sourceVerificationFactsSchema.parse(facts),
    contractVersion: 'source-recorded-review.v1', status: 'RECORDED_REVIEW',
    reviewedBy: String(actorUserId || ''), reviewedAt, sourceFingerprint: sourceMaterialFingerprint(source) })

export const preserveSourceRecordedReviews = (sources, previousSources = []) => sources.map((source) => {
  const previous = previousSources.filter((row) => row.sourceId === source.sourceId)
  const review = previous.length === 1 ? resolveSourceRecordedReview(previous[0]) : null
  return review && review.sourceFingerprint === sourceMaterialFingerprint(source)
    ? { ...source, verificationContext: structuredClone(review) } : source
})
