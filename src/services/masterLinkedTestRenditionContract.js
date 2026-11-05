import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'

export const TEST_RENDITION_PREFLIGHT_VERSION = 'master-linked-test-rendition-preflight.v1'
export const TEST_RENDITION_PROBE_TYPE = 'MASTER_LINKED_TEST_RENDITION_PROBE'
export const TEST_RENDITION_PROBE_ACTION = 'MASTER_LINKED_TEST_RENDITION_PROBED'
const prefix = 'artifact_master_linked_test_rendition_'
export const testRenditionHeld = reason => Object.assign(new Error('The test rendition preflight is held.'), {
  status: 409, code: 'MASTER_LINKED_TEST_RENDITION_HELD', details: { reason, approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false },
})
export const testRenditionNeed = (value, reason) => { if (!value) throw testRenditionHeld(reason) }
const need = testRenditionNeed
export const testRenditionExact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
export const testRenditionSame = (a, b) => membershipHash(a) === membershipHash(b)
const exact = testRenditionExact, same = testRenditionSame
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const oid = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const refId = value => oid(value) || value instanceof mongoose.Types.ObjectId
// Model validators must remain independent of source-reader/renderer imports.
// The operational service additionally verifies the actual signed source chain.
const sourceFalseFlags = ['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval',
  'finalisationAvailable', 'deliveryAvailable', 'dispatchAvailable', 'externalDisclosureAvailable']
const storedBytes = value => {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value?._bsontype === 'Binary' && typeof value.value === 'function') return Buffer.from(value.value(true))
  throw testRenditionHeld('PROBE_BYTES_INVALID')
}
export const testRenditionFalseFlags = () => ({ finalAssetCreated: false, approvalAvailable: false,
  finalisationAvailable: false, deliveryAvailable: false, docxExportAvailable: false, pdfExportAvailable: false })

export const assertTestRenditionDescriptor = d => {
  need(exact(d, ['contractVersion', 'classification', 'actorUserId', 'scope', 'subject', 'request', 'docx',
    'qaReservation', 'genuineReview', 'approvalReference', ...Object.keys(testRenditionFalseFlags())])
    && d.contractVersion === TEST_RENDITION_PREFLIGHT_VERSION && d.classification === 'CONTROLLED_TEST_ONLY'
    && oid(d.actorUserId) && d.approvalReference === null
    && Object.keys(testRenditionFalseFlags()).every(key => d[key] === false), 'DESCRIPTOR_SHAPE')
  const b = d.subject?.binding, ref = b?.masterReference
  need(exact(ref, ['storageId', 'masterId', 'version', 'scope', 'bodyFingerprint', 'sourceFingerprint',
    'sourceProjectionFingerprint', 'auditId', 'auditSignatureVersion']) && oid(ref.storageId) && oid(ref.auditId)
    && /^meaning_master_[a-f0-9-]{36}$/.test(ref.masterId) && ref.version === 1
    && exact(ref.scope, ['tenantId', 'customerId', 'runtimeInstanceId']) && Object.values(ref.scope).every(oid)
    && ['bodyFingerprint', 'sourceFingerprint', 'sourceProjectionFingerprint'].every(key => hash(ref[key]))
    && Number.isSafeInteger(ref.auditSignatureVersion) && ref.auditSignatureVersion > 0, 'MASTER_REFERENCE')
  need(same(d.scope, ref.scope) && d.subject.actorUserId === d.actorUserId
    && sourceFalseFlags.every(key => d.subject[key] === false)
    && exact(d.request, ['requestIdentity', 'subjectFingerprint', 'contextFingerprint', 'policyFingerprint'])
    && Object.values(d.request).every(hash) && d.request.subjectFingerprint === membershipHash(d.subject)
    && d.request.policyFingerprint === d.subject.policyFingerprint && Array.isArray(b.pages) && b.pages.length > 0
    && exact(d.docx, ['checksum', 'byteLength']) && d.docx.checksum === b.docxChecksum
    && /^sha256:[a-f0-9]{64}$/.test(d.docx.checksum) && Number.isSafeInteger(d.docx.byteLength)
    && d.docx.byteLength > 0 && d.docx.byteLength <= 12 * 1024 ** 2
    && exact(d.qaReservation, ['executionId', 'bodyFingerprint']) && hash(d.qaReservation.bodyFingerprint)
    && /^master_docx_dispatch_[a-f0-9-]{36}$/.test(d.qaReservation.executionId), 'DESCRIPTOR_BINDING')
  const review = d.genuineReview
  need(exact(review, ['state', 'reference']) && ['GENUINE_REQUIRED', 'GENUINE_PASS_APPROVAL_REQUIRED', 'GENUINE_FAIL_HELD'].includes(review.state), 'REVIEW_STATE')
  if (review.state === 'GENUINE_REQUIRED') need(review.reference === null, 'REVIEW_REFERENCE')
  else need(exact(review.reference, ['kind', 'executionId', 'runtimeArtifactId', 'stageExecutionId', 'resultFingerprint'])
    && review.reference.kind === 'GENUINE_MASTER_LINKED_REVIEW' && hash(review.reference.resultFingerprint)
    && ['executionId', 'runtimeArtifactId', 'stageExecutionId'].every(key => typeof review.reference[key] === 'string'
      && /^[A-Za-z0-9_-]{1,180}$/.test(review.reference[key])), 'REVIEW_REFERENCE')
  return d
}
export const testRenditionProbeFamily = descriptor => {
  const d = assertTestRenditionDescriptor(descriptor), key = membershipHash({ version: d.contractVersion,
    actorUserId: d.actorUserId, scope: d.scope, candidateId: d.subject.binding.candidateId, qaReservation: d.qaReservation })
  const id = purpose => createHash('sha256').update(purpose + key).digest('hex').slice(0, 24)
  return { runtimeArtifactId: prefix + key.slice(0, 24), storageId: id('TEST_RENDITION_PROBE:'), auditId: id('TEST_RENDITION_PROBE_AUDIT:') }
}
export const hasTestRenditionProbeIdentity = value => value?.artifactType === TEST_RENDITION_PROBE_TYPE
  || value?.contractVersion === TEST_RENDITION_PREFLIGHT_VERSION
  || typeof value?.runtimeArtifactId === 'string' && value.runtimeArtifactId.startsWith(prefix)
  || Object.hasOwn(value?.lineageSummary || {}, 'masterLinkedTestRendition')
  || value?.testRenditionFileBytes !== undefined
export const testRenditionProbeFilter = { $or: [{ artifactType: TEST_RENDITION_PROBE_TYPE },
  { contractVersion: TEST_RENDITION_PREFLIGHT_VERSION }, { runtimeArtifactId: { $regex: '^' + prefix } },
  { 'lineageSummary.masterLinkedTestRendition': { $exists: true } }, { testRenditionFileBytes: { $exists: true } }] }
export const carriesTestRenditionProbeValue = value => typeof value === 'string'
  ? [TEST_RENDITION_PROBE_TYPE, TEST_RENDITION_PREFLIGHT_VERSION].includes(value.trim()) || value.trim().startsWith(prefix)
  : value && typeof value === 'object' && !Buffer.isBuffer(value) && value._bsontype !== 'Binary'
    && (hasTestRenditionProbeIdentity(value) || Object.entries(value).some(([key, child]) =>
      key.startsWith('lineageSummary.masterLinkedTestRendition') || key === 'testRenditionFileBytes' || carriesTestRenditionProbeValue(child)))

export const assertTestRenditionProbeArtifact = value => {
  const row = value?.toObject ? value.toObject({ depopulate: true }) : value, output = row?.generatedOutput
  need(exact(output, ['contractVersion', 'descriptor', 'descriptorFingerprint'])
    && output.contractVersion === TEST_RENDITION_PREFLIGHT_VERSION, 'PROBE_OUTPUT')
  const d = assertTestRenditionDescriptor(output.descriptor), family = testRenditionProbeFamily(d)
  need(d.genuineReview.state === 'GENUINE_REQUIRED' && output.descriptorFingerprint === membershipHash(d)
    && refId(row._id) && String(row._id) === family.storageId && row.runtimeArtifactId === family.runtimeArtifactId
    && row.contractVersion === TEST_RENDITION_PREFLIGHT_VERSION && row.artifactType === TEST_RENDITION_PROBE_TYPE
    && row.outputTypeKey === TEST_RENDITION_PROBE_TYPE && row.requestedOutputTypeKey === 'master-linked-test-rendition-probe'
    && row.status === 'GENERATED' && row.executionId === d.qaReservation.executionId
    && refId(row.generatedBy) && String(row.generatedBy) === d.actorUserId
    && Object.entries(d.scope).every(([key, id]) => refId(row[key]) && String(row[key]) === id)
    && exact(row.lineageSummary, ['masterLinkedTestRendition'])
    && exact(row.lineageSummary.masterLinkedTestRendition, ['auditId', 'auditSignatureVersion'])
    && String(row.lineageSummary.masterLinkedTestRendition.auditId) === family.auditId
    && row.lineageSummary.masterLinkedTestRendition.auditSignatureVersion === 3, 'PROBE_BINDING')
  const bytes = storedBytes(row.testRenditionFileBytes)
  need(bytes.length === d.docx.byteLength && 'sha256:' + createHash('sha256').update(bytes).digest('hex') === d.docx.checksum, 'PROBE_BYTES_CHANGED')
  return d
}
export const testRenditionProbeAuditDiff = row => {
  const d = assertTestRenditionProbeArtifact(row)
  return { version: TEST_RENDITION_PREFLIGHT_VERSION, runtimeArtifactId: row.runtimeArtifactId,
    descriptorFingerprint: membershipHash(d), qaReservation: d.qaReservation, docx: d.docx, ...testRenditionFalseFlags() }
}
export const assertTestRenditionProbeAudit = (row, audit, verify) => {
  const d = assertTestRenditionProbeArtifact(row), family = testRenditionProbeFamily(d)
  need(audit && refId(audit._id) && String(audit._id) === family.auditId && audit.signatureVersion === 3
    && audit.action === TEST_RENDITION_PROBE_ACTION && audit.resourceType === 'GovernedRuntimeArtifact'
    && refId(audit.resourceId) && refId(audit.actorUserId)
    && String(audit.resourceId) === family.storageId && String(audit.actorUserId) === d.actorUserId
    && Object.entries(d.scope).every(([key, id]) => refId(audit.scope?.[key]) && String(audit.scope[key]) === id)
    && same(audit.diff, testRenditionProbeAuditDiff(row)) && verify(audit) === true, 'PROBE_AUDIT')
}
