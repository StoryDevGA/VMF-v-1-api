import mongoose from 'mongoose'
import { PUBLISHED_DISPOSITION_POLICY as basisPolicy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { SUPPLEMENTAL_FINDING_POLICY as policy } from '../constants/supplementalFindingReviewPolicy.js'
import { RUNTIME_PRODUCT_AUTHORITY_POLICY as authorityPolicy } from '../constants/runtimeProductAuthorityPolicy.js'
import { DISCOVERY_CONTRADICTION_DISPOSITIONS, getDiscoveryContradictionReview } from '../services/discoveryContradictionReviewService.js'
import { assertPublishedEvidenceMembershipManifest, membershipHash, membershipJson } from '../services/runtimeEvidenceSnapshotContract.js'

const text = max => ({ type: String, required: true, maxlength: max })
const hash = { ...text(64), match: /^[a-f0-9]{64}$/ }
const id = ref => ({ type: mongoose.Schema.Types.ObjectId, ref, required: true })
export const assertSupplementalFindingReview = record => {
  const body = membershipJson(record.body)
  const keys = ['contractVersion', 'policyVersion', 'approval', 'authority', 'receiptId', 'requestKey', 'payloadHash',
    'stateVersion', 'originalUpdatedAt', 'originalUpdatedBy', 'committedUpdatedAt', 'createdAt', 'reviewer',
    'rationale', 'disposition', 'candidate', 'evidence', 'reviewEpoch', 'evidencePairHash', 'originalReviewHistory',
    'runtimeWitnessHash', 'frozenMembership', 'freezeHash', 'originalAudits', 'originalAuditHash', 'qualifications']
  const manifest = assertPublishedEvidenceMembershipManifest(body?.frozenMembership)
  const pair = getDiscoveryContradictionReview(body.candidate, body.evidence, null,
    basisPolicy.scope.runtimeInstanceId, body.reviewEpoch)
  if (Object.keys(body).sort().join(',') !== keys.sort().join(',')
    || Object.keys(body.reviewer || {}).sort().join(',') !== 'authorityReference,permission,userId'
    || record.policyVersion !== policy.policyVersion || body.policyVersion !== policy.policyVersion
    || body.contractVersion !== policy.contractVersion || membershipHash(body) !== record.bodyHash
    || membershipHash(body.approval) !== membershipHash(policy.approval)
    || Object.keys(body.authority || {}).sort().join(',') !== 'approvalReference,bodyHash,documentHash,receiptId,version'
    || body.authority?.approvalReference !== authorityPolicy.approvalReference || body.authority?.version !== authorityPolicy.version
    || body.authority?.documentHash !== authorityPolicy.documentHash || !/^[a-f0-9]{64}$/.test(body.authority?.bodyHash || '')
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.authority?.receiptId || '')
    || body.candidate?.contradictionId !== policy.contradictionId || body.reviewEpoch !== policy.reviewEpoch
    || body.evidencePairHash !== policy.evidencePairHash || pair.evidencePairHash !== policy.evidencePairHash
    || membershipHash(pair.evidence) !== membershipHash(body.evidence)
    || !DISCOVERY_CONTRADICTION_DISPOSITIONS.includes(body.disposition) || body.originalReviewHistory !== 'ABSENT'
    || body.stateVersion !== basisPolicy.stateVersion || body.originalUpdatedAt !== basisPolicy.updatedAt
    || body.originalUpdatedBy !== basisPolicy.originalUpdatedBy || body.runtimeWitnessHash !== basisPolicy.runtimeWitnessHash
    || membershipHash(manifest) !== basisPolicy.manifestHash || body.freezeHash !== basisPolicy.manifestHash
    || membershipHash(body.originalAudits) !== basisPolicy.originalAuditHash || body.originalAuditHash !== basisPolicy.originalAuditHash
    || membershipHash(body.qualifications) !== basisPolicy.qualificationsHash
    || body.receiptId !== record.receiptId || body.requestKey !== record.requestKey || body.payloadHash !== record.payloadHash
    || body.reviewer?.userId !== authorityPolicy.reviewerUserId || body.reviewer?.permission !== 'VMF_UPDATE'
    || body.reviewer?.authorityReference !== authorityPolicy.approvalReference
    || Date.parse(body.createdAt) < Date.parse('2026-10-16T11:12:23Z')
    || typeof body.rationale !== 'string' || body.rationale.trim().length < 10 || body.rationale.length > 2000
    || !Number.isFinite(Date.parse(body.createdAt)) || body.createdAt !== body.committedUpdatedAt
    || Date.parse(body.createdAt) <= Date.parse(body.originalUpdatedAt)
    || Object.entries(basisPolicy.scope).some(([key, value]) => String(manifest.scope[key]) !== String(value))
    || ['customerId', 'tenantId', 'runtimeInstanceId'].some(key => String(record[key]) !== basisPolicy.scope[key])
    || Buffer.byteLength(JSON.stringify(body)) > 512 * 1024) throw new Error('Supplemental finding review binding is invalid.')
  return body
}
const schema = new mongoose.Schema({
  customerId: id('Customer'), tenantId: id('Tenant'), runtimeInstanceId: id('RuntimeInstance'),
  receiptId: { ...text(36), match: /^[a-f0-9-]{36}$/ }, requestKey: { ...text(36), match: /^[a-f0-9-]{36}$/ },
  policyVersion: { ...text(100), enum: [policy.policyVersion] }, payloadHash: hash, bodyHash: hash,
  body: { type: mongoose.Schema.Types.Mixed, required: true }, auditId: id('AuditLog'),
  auditSignatureVersion: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { collection: 'runtime_supplemental_finding_reviews', strict: 'throw', minimize: false, versionKey: false, autoCreate: false, autoIndex: false })
schema.pre('validate', function (next) {
  try { assertSupplementalFindingReview(this); next() } catch (error) { next(error) }
})
schema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Supplemental finding reviews are immutable.'))
  try { assertSupplementalFindingReview(this); next(this.validateSync()) } catch (error) { next(error) }
})
schema.pre('insertMany', function (next, records) {
  try { for (const record of records) { assertSupplementalFindingReview(record); const error = new this(record).validateSync(); if (error) throw error }; next() }
  catch (error) { next(error) }
})
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function () { throw new Error('Supplemental finding reviews are immutable.') })
}
schema.pre('bulkWrite', function (next, operations) {
  try {
    for (const operation of operations) {
      if (Object.keys(operation).length !== 1 || !operation.insertOne) throw new Error('Supplemental finding reviews are immutable.')
      assertSupplementalFindingReview(operation.insertOne.document)
      const error = new this(operation.insertOne.document).validateSync(); if (error) throw error
    }
    next()
  } catch (error) { next(error) }
})
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, policyVersion: 1 }, { unique: true, name: 'unique_supplemental_finding_policy' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 }, { unique: true, name: 'unique_supplemental_finding_request' })
export default mongoose.model('RuntimeSupplementalFindingReview', schema)
