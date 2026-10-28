import mongoose from 'mongoose'
import { SYNTHETIC_TEST_DISPOSITION_POLICY as policy, parseSyntheticTestAmendment } from '../constants/syntheticTestDispositionPolicy.js'
import { PUBLISHED_DISPOSITION_POLICY as basisPolicy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { SUPPLEMENTAL_FINDING_POLICY as findingPolicy } from '../constants/supplementalFindingReviewPolicy.js'
import { syntheticTestDispositionBodySchema } from '../validators/syntheticTestDisposition.validator.js'
import { membershipHash, membershipJson, assertPublishedEvidenceMembershipManifest } from '../services/runtimeEvidenceSnapshotContract.js'
import { getDiscoveryContradictionReview } from '../services/discoveryContradictionReviewService.js'

export const syntheticTestBasisHash = (basis, authority) => membershipHash({ basis, authority,
  amendmentReference: policy.reference, amendmentHash: policy.documentHash, expectedUpdatedAt: basisPolicy.updatedAt })
export const assertSyntheticTestDispositionReceipt = record => {
  const body = membershipJson(record.body)
  const input = syntheticTestDispositionBodySchema.parse(body.input)
  const amendment = parseSyntheticTestAmendment(input.amendmentDocumentText)
  const manifest = assertPublishedEvidenceMembershipManifest(body.basis.manifest)
  const pair = getDiscoveryContradictionReview(body.basis.candidate, body.basis.evidence, null,
    basisPolicy.scope.runtimeInstanceId, findingPolicy.reviewEpoch)
  const expectedKeys = ['receiptType', 'mode', 'amendmentReference', 'amendmentHash', 'receiptId', 'input',
    'payloadHash', 'createdAt', 'recorder', 'decisionMaker', 'authority', 'basis']
  if (Object.keys(body).sort().join() !== expectedKeys.sort().join()
    || record.policyReference !== policy.reference || body.amendmentReference !== policy.reference
    || body.amendmentHash !== policy.documentHash || body.receiptType !== policy.receiptType || body.mode !== policy.mode
    || membershipHash(body) !== record.bodyHash || body.receiptId !== record.receiptId
    || input.requestKey !== record.requestKey || body.payloadHash !== record.payloadHash
    || input.expectedBasisHash !== syntheticTestBasisHash(body.basis, body.authority)
    || membershipHash({ ...input, actorUserId: policy.recorderUserId }) !== record.payloadHash
    || membershipHash(body.recorder) !== membershipHash({ userId: policy.recorderUserId, platformRole: 'SUPER_ADMIN', permission: 'VMF_UPDATE' })
    || membershipHash(body.decisionMaker) !== membershipHash({ name: 'Angus Gregory', role: 'Product Owner, StorylineOS',
      independent: false, dualRoleDisclosed: true, nativeUserId: null })
    || body.authority?.approvalReference !== amendment.priorAuthority.reference
    || body.authority?.bodyHash !== amendment.priorAuthority.bodyHash
    || !/^[a-f0-9]{64}$/.test(body.authority?.documentHash || '')
    || !/^[a-f0-9-]{36}$/.test(body.authority?.receiptId || '')
    || body.authority?.version !== 1
    || membershipHash(manifest) !== basisPolicy.manifestHash || body.basis.freezeHash !== basisPolicy.manifestHash
    || body.basis.runtimeWitnessHash !== basisPolicy.runtimeWitnessHash
    || membershipHash(body.basis.originalAudits) !== basisPolicy.originalAuditHash
    || membershipHash(body.basis.qualifications) !== basisPolicy.qualificationsHash
    || body.basis.reviewEpoch !== findingPolicy.reviewEpoch
    || body.basis.candidate?.contradictionId !== findingPolicy.contradictionId
    || body.basis.evidencePairHash !== findingPolicy.evidencePairHash || pair.evidencePairHash !== findingPolicy.evidencePairHash
    || membershipHash(pair.evidence) !== membershipHash(body.basis.evidence)
    || input.expectedUpdatedAt !== basisPolicy.updatedAt
    || !Number.isFinite(Date.parse(body.createdAt))
    || Date.parse(input.decisionSource.decidedAt) < Date.parse(policy.approvedAt)
    || Date.parse(input.decisionSource.decidedAt) > Date.parse(body.createdAt)
    || ['customerId', 'tenantId', 'runtimeInstanceId'].some(key => String(record[key]) !== basisPolicy.scope[key])
    || Buffer.byteLength(JSON.stringify(body)) > 512 * 1024)
    throw new Error('Synthetic test disposition receipt binding is invalid.')
  return body
}
const requiredText = maxlength => ({ type: String, required: true, maxlength })
const schema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  runtimeInstanceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  receiptId: requiredText(36), requestKey: requiredText(36),
  policyReference: { ...requiredText(120), enum: [policy.reference] },
  payloadHash: { ...requiredText(64), match: /^[a-f0-9]{64}$/ },
  bodyHash: { ...requiredText(64), match: /^[a-f0-9]{64}$/ },
  body: { type: mongoose.Schema.Types.Mixed, required: true },
  auditId: { type: mongoose.Schema.Types.ObjectId, required: true },
  auditSignatureVersion: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { collection: 'runtime_synthetic_test_disposition_receipts', strict: 'throw',
  minimize: false, versionKey: false, autoCreate: false, autoIndex: false })
schema.pre('validate', function (next) {
  try { assertSyntheticTestDispositionReceipt(this); next() } catch (error) { next(error) }
})
schema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Synthetic test receipts are immutable.'))
  try { assertSyntheticTestDispositionReceipt(this); next(this.validateSync()) } catch (error) { next(error) }
})
schema.pre('insertMany', function (next, records) {
  try { for (const record of records) { assertSyntheticTestDispositionReceipt(record); const error = new this(record).validateSync(); if (error) throw error }; next() }
  catch (error) { next(error) }
})
for (const method of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete', 'bulkWrite']) {
  schema.pre(method, function () { throw new Error('Synthetic test receipts are immutable.') })
}
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, policyReference: 1 },
  { unique: true, name: 'unique_synthetic_test_policy' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 },
  { unique: true, name: 'unique_synthetic_test_request' })
export default mongoose.model('RuntimeSyntheticTestDispositionReceipt', schema)
