import mongoose from 'mongoose'
import { SYNTHETIC_REVISION_TEST_POLICY as p } from '../constants/syntheticRevisionTestPolicy.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { syntheticTestDispositionBodySchema } from '../validators/syntheticTestDisposition.validator.js'
import { parseSyntheticTestAmendment } from '../constants/syntheticTestDispositionPolicy.js'
import { reviewCompletionBodySchema } from '../validators/reviewCompletion.validator.js'

export const syntheticRevisionScope = () => Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId']
  .map(key => [key, new mongoose.Types.ObjectId(p[key])]))
export const syntheticRevisionReceiptType = kind => kind === 'DISPOSITION'
  ? 'NON_AUTHORITATIVE_TEST_DISPOSITION_RECEIPT' : 'NON_AUTHORITATIVE_TEST_COMPLETION_RECEIPT'
const need = value => { if (!value) throw new Error('The R3 test-only receipt is invalid.') }
export const assertSyntheticRevisionReceipt = record => {
  const b = record.body
  need(b && ['DISPOSITION', 'COMPLETION'].includes(record.kind)
    && Object.keys(b).sort().join() === ['version', 'classification', 'authoritative', 'policyReference', 'amendmentHash', 'scopeBindingHash',
      'kind', 'receiptType', 'receiptId', 'requestKey', 'payloadHash', 'createdAt', 'recorderUserId', 'decisionMaker',
      'basis', 'input', 'dispositionLink'].sort().join())
  need(b.version === 1 && b.classification === p.classification && b.authoritative === false
    && b.policyReference === p.reference && b.amendmentHash === p.amendmentHash && b.scopeBindingHash === p.scopeBindingHash && b.kind === record.kind
    && b.receiptType === syntheticRevisionReceiptType(record.kind)
    && b.receiptId === record.receiptId && b.requestKey === record.requestKey && b.payloadHash === record.payloadHash
    && b.recorderUserId === p.recorderUserId && b.createdAt === new Date(b.createdAt).toISOString()
    && membershipHash(b) === record.bodyHash && Buffer.byteLength(JSON.stringify(b)) <= 512 * 1024
    && ['customerId', 'tenantId', 'runtimeInstanceId'].every(key => String(record[key]) === p[key]
      && b.basis?.manifest?.scope?.[key] === p[key])
    && b.basis?.manifest?.scope?.runtimeInstanceKey === p.runtimeInstanceKey
    && b.basis?.manifest?.scope?.revisionNumber === 3
    && membershipHash(b.basis.manifest) === b.basis.materialHash
    && /^rsv2:[a-f0-9-]{36}$/.test(b.basis.stateVersion)
    && Number.isFinite(Date.parse(b.basis.updatedAt))
    && b.basis.manifest.rootEvidencePairHash === p.rootEvidencePairHash
    && b.basis.materialHash === p.initialMaterialHash
    && /^sha256:[a-f0-9]{64}$/.test(b.basis.manifest.typedEvidencePairHash)
    && membershipHash(b.decisionMaker) === membershipHash({ name: 'Angus Gregory', role: 'StorylineOS Product Owner',
      independent: false, dualRoleDisclosed: true, nativeUserId: null }))
  if (record.kind === 'DISPOSITION') {
    const input = syntheticTestDispositionBodySchema.parse(b.input)
    parseSyntheticTestAmendment(input.amendmentDocumentText)
    need(b.dispositionLink === null && input.expectedBasisHash === b.basis.materialHash
      && input.expectedUpdatedAt === b.basis.updatedAt && b.basis.stateVersion === p.initialStateVersion
      && Date.parse(input.decisionSource.decidedAt) <= Date.parse(b.createdAt)
      && Date.parse(input.decisionSource.decidedAt) >= Date.parse('2026-10-20T00:00:00Z'))
  } else {
    reviewCompletionBodySchema.parse(b.input)
    need(b.dispositionLink && Object.keys(b.dispositionLink).sort().join() === 'bodyHash,receiptId'
      && /^[a-f0-9-]{36}$/.test(b.dispositionLink.receiptId) && /^[a-f0-9]{64}$/.test(b.dispositionLink.bodyHash))
    need(b.input.expectedPopulationHash === membershipHash({ basis: b.basis.materialHash, disposition: b.dispositionLink }))
  }
  need(record.payloadHash === membershipHash({ kind: record.kind, input: b.input, actorUserId: p.recorderUserId }))
  return b
}
const text = max => ({ type: String, required: true, maxlength: max })
const schema = new mongoose.Schema({
  ...Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, { type: mongoose.Schema.Types.ObjectId, required: true }])),
  kind: { type: String, required: true, enum: ['DISPOSITION', 'COMPLETION'] },
  receiptId: { ...text(36), match: /^[a-f0-9-]{36}$/ }, requestKey: { ...text(36), match: /^[a-f0-9-]{36}$/ },
  payloadHash: { ...text(64), match: /^[a-f0-9]{64}$/ }, bodyHash: { ...text(64), match: /^[a-f0-9]{64}$/ },
  body: { type: mongoose.Schema.Types.Mixed, required: true },
  auditId: { type: mongoose.Schema.Types.ObjectId, required: true },
  auditSignatureVersion: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { collection: 'runtime_synthetic_revision_receipts', strict: 'throw', minimize: false,
  versionKey: false, autoCreate: false, autoIndex: false })
schema.pre('validate', function (next) { try { assertSyntheticRevisionReceipt(this); next() } catch (e) { next(e) } })
schema.pre('save', function (next) {
  try { need(this.isNew); assertSyntheticRevisionReceipt(this); next(this.validateSync()) } catch (e) { next(e) }
})
schema.pre('insertMany', function (next, records) {
  try { for (const r of records) { assertSyntheticRevisionReceipt(r); const e = new this(r).validateSync(); if (e) throw e }; next() } catch (e) { next(e) }
})
for (const method of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete', 'bulkWrite']) schema.pre(method, function () { throw new Error('R3 test receipts are immutable.') })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, kind: 1 }, { unique: true, name: 'unique_synthetic_revision_kind' })
schema.index({ customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 }, { unique: true, name: 'unique_synthetic_revision_request' })
export default mongoose.model('RuntimeSyntheticRevisionReceipt', schema)
