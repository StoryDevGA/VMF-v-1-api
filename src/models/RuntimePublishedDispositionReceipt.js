import mongoose from 'mongoose'
import { assertPublishedEvidenceMembershipManifest, membershipHash, membershipJson } from '../services/runtimeEvidenceSnapshotContract.js'
import { PUBLISHED_DISPOSITION_POLICY as policy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { assertPublishedDispositionPopulation, assertPublishedFindingLink, publishedDispositionExpectedBasisHash } from '../services/publishedDispositionPopulationService.js'

const text = max => ({ type: String, required: true, maxlength: max })
const hash = { ...text(64), match: /^[a-f0-9]{64}$/ }
const id = ref => ({ type: mongoose.Schema.Types.ObjectId, ref, required: true })
export const assertPublishedDispositionReceipt = (record, { requireCurrent = false } = {}) => {
  const body = membershipJson(record.body)
  const current = Object.hasOwn(body, 'findingReview')
  if (requireCurrent && !current) throw new Error('A new completion requires verified independent finding provenance.')
  const keys = ['contractVersion', 'policyVersion', 'approvalReference', 'approvalTextHash', 'approvedBy', 'receiptId',
    'requestKey', 'payloadHash', 'observedStateVersion', 'originalUpdatedAt', 'originalUpdatedBy', 'committedUpdatedAt', 'createdAt',
    'reviewer', 'rationale', 'runtimeWitnessHash', 'frozenMembership', 'freezeHash', 'reviewPopulation',
    'originalAudits', 'originalAuditHash', 'qualifications', ...(current ? ['findingReview', 'predecessorControl', 'requestBasis'] : [])]
  const manifest = assertPublishedEvidenceMembershipManifest(body?.frozenMembership)
  if (Object.keys(body).sort().join(',') !== keys.sort().join(',')
    || Object.keys(body.reviewer || {}).sort().join(',') !== 'authorityReference,permission,userId'
    || !current && Object.keys(body.reviewPopulation || {}).sort().join(',') !== 'inventoryHash,manifest,populationHash,summary'
    || record.policyVersion !== policy.policyVersion || membershipHash(body) !== record.bodyHash || body.contractVersion !== policy.contractVersion
    || body.policyVersion !== policy.policyVersion || body.approvalReference !== policy.approval.approvalReference
    || body.approvalTextHash !== policy.approval.textHash || body.approvedBy !== policy.approval.approvedBy
    || membershipHash(manifest) !== body.freezeHash || body.freezeHash !== policy.manifestHash
    || body.runtimeWitnessHash !== policy.runtimeWitnessHash || body.originalAuditHash !== policy.originalAuditHash
    || membershipHash(body.originalAudits) !== body.originalAuditHash
    || membershipHash(body.qualifications) !== policy.qualificationsHash
    || body.reviewPopulation?.populationHash !== membershipHash(body.reviewPopulation?.manifest)
    || body.reviewPopulation?.summary?.complete !== true
    || body.observedStateVersion !== policy.stateVersion || body.originalUpdatedAt !== policy.updatedAt
    || body.originalUpdatedBy !== policy.originalUpdatedBy
    || body.requestKey !== record.requestKey || body.payloadHash !== record.payloadHash
    || body.receiptId !== record.receiptId || body.reviewer?.permission !== 'VMF_UPDATE'
    || body.reviewer?.authorityReference !== policy.policyVersion || !mongoose.isValidObjectId(body.reviewer?.userId)
    || typeof body.rationale !== 'string' || body.rationale.trim().length < 10 || body.rationale.length > 2000
    || !Number.isFinite(Date.parse(body.createdAt)) || body.createdAt !== body.committedUpdatedAt
    || Date.parse(body.createdAt) <= Date.parse(body.originalUpdatedAt)
    || Object.entries(policy.scope).some(([key, value]) => String(manifest.scope[key]) !== String(value))
    || ['customerId', 'tenantId', 'runtimeInstanceId'].some(key => String(record[key]) !== policy.scope[key])
    || Buffer.byteLength(JSON.stringify(body)) > 512 * 1024) throw new Error('Published disposition receipt binding is invalid.')
  if (current) {
    assertPublishedDispositionPopulation(body.reviewPopulation)
    assertPublishedFindingLink(body.findingReview)
    if (membershipHash(body.findingReview) !== membershipHash(body.reviewPopulation.manifest.findingReview)
      || membershipHash(body.predecessorControl) !== membershipHash({ updatedAt: body.findingReview.createdAt, updatedBy: body.findingReview.reviewerUserId })
      || Date.parse(body.createdAt) <= Date.parse(body.predecessorControl.updatedAt)
      || Object.keys(body.requestBasis || {}).sort().join() !== 'confirm,expectedBasisHash,expectedUpdatedAt,rationale'
      || body.requestBasis.expectedUpdatedAt !== body.predecessorControl.updatedAt || body.requestBasis.confirm !== true
      || typeof body.requestBasis.rationale !== 'string' || body.requestBasis.rationale.trim() !== body.rationale
      || body.requestBasis.expectedBasisHash !== publishedDispositionExpectedBasisHash({ freezeHash: body.freezeHash,
        runtimeWitnessHash: body.runtimeWitnessHash, population: body.reviewPopulation,
        findingReview: body.findingReview, predecessorControl: body.predecessorControl })
      || membershipHash({ ...body.requestBasis, requestKey: body.requestKey, actorUserId: body.reviewer.userId }) !== body.payloadHash)
      throw new Error('Published disposition predecessor and request binding is invalid.')
    for (const [kind, key] of [['evidence', 'evidenceObjectId'], ['sources', 'sourceId'], ['sections', 'sectionKey']]) {
      for (const item of body.reviewPopulation.manifest[kind]) {
        const member = manifest[kind].find(row => row[key] === item.id)
        if (!member || member.materialHash !== item.materialHash || kind === 'evidence' && member.sourceId !== item.sourceId)
          throw new Error('Supplemental population does not match the frozen membership.')
      }
    }
  }
  return body
}
const schema = new mongoose.Schema({
  customerId: id('Customer'), tenantId: id('Tenant'), runtimeInstanceId: id('RuntimeInstance'),
  receiptId: { ...text(36), match: /^[a-f0-9-]{36}$/ }, requestKey: { ...text(36), match: /^[a-f0-9-]{36}$/ },
  policyVersion: { ...text(100), enum: [policy.policyVersion] }, payloadHash: hash, bodyHash: hash,
  body: { type: mongoose.Schema.Types.Mixed, required: true },
  auditId: id('AuditLog'), auditSignatureVersion: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { collection: 'runtime_published_disposition_receipts', strict: 'throw', minimize: false, versionKey: false, autoCreate: false, autoIndex: false })
schema.pre('validate', function (next) {
  try { assertPublishedDispositionReceipt(this, { requireCurrent: this.isNew }); next() } catch (error) { next(error) }
})
schema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Published disposition receipts are immutable.'))
  try { assertPublishedDispositionReceipt(this, { requireCurrent: true }); next(this.validateSync()) } catch (error) { next(error) }
})
schema.pre('insertMany', function (next, records) {
  try { for (const record of records) { assertPublishedDispositionReceipt(record, { requireCurrent: true }); const error = new this(record).validateSync(); if (error) throw error }; next() }
  catch (error) { next(error) }
})
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function () { throw new Error('Published disposition receipts are immutable.') })
}
schema.pre('bulkWrite', function (next, operations) {
  try {
    for (const operation of operations) {
      if (Object.keys(operation).length !== 1 || !operation.insertOne) throw new Error('Published disposition receipts are immutable.')
      assertPublishedDispositionReceipt(operation.insertOne.document, { requireCurrent: true })
      const error = new this(operation.insertOne.document).validateSync(); if (error) throw error
    }
    next()
  } catch (error) { next(error) }
})
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, policyVersion: 1 }, { unique: true, name: 'unique_published_disposition_policy' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 }, { unique: true, name: 'unique_published_disposition_request' })
export default mongoose.model('RuntimePublishedDispositionReceipt', schema)
