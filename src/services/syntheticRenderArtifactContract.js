import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { isControlledSyntheticOutcomeRuntime } from './syntheticOutcomeIsolationService.js'
import { PUBLISHED_DISPOSITION_POLICY as scopePolicy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { SYNTHETIC_TEST_DISPOSITION_POLICY as amendment } from '../constants/syntheticTestDispositionPolicy.js'

const id = value => String(value || '').trim().toLowerCase()
const fail = (code, message) => { throw Object.assign(new Error(message), { code, status: 409, details: { reason: code } }) }
const classificationPresent = object => Object.hasOwn(object || {}, 'artifactClassification')
const origins = (model, source, revision) => [
  { runtimeInstanceId: model.runtimeInstanceId, id: model.runtimeRevision?.id,
    runtimeInstanceKey: model.runtimeInstanceKey, revision: model.runtimeRevision },
  { id: model.runtimeRevision?.revisionId },
  { id: model.runtimeRevisionId },
  { runtimeInstanceId: source.runtimeInstanceId, id: source.runtimeRevisionId,
    runtimeInstanceKey: source.runtimeInstanceKey, revision: source.revision },
  { runtimeInstanceId: source.runtimeRevision?.id, id: source.runtimeRevision?.revisionId, revision: source.runtimeRevision },
  { id: source.lineageSummary?.runtimeRevisionId },
  { runtimeInstanceId: revision.id, id: revision.revisionId, revision },
]
export const deriveSyntheticRenderClassification = (model, { source = {}, runtimeRevision = {} } = {}) => {
  if (!origins(model, source, runtimeRevision).some(isControlledSyntheticOutcomeRuntime)) return null
  const sourceRevisionIds = [model.runtimeRevision?.revisionId, model.runtimeRevisionId,
    source.runtimeRevisionId, source.runtimeRevision?.id, source.runtimeRevision?.revisionId,
    source.lineageSummary?.runtimeRevisionId, runtimeRevision.id, runtimeRevision.revisionId].filter(Boolean)
  const sourceRevisionNumbers = [model.runtimeRevision?.revisionNumber, source.runtimeRevisionNumber, source.runtimeRevision?.number,
    source.runtimeRevision?.revisionNumber, source.lineageSummary?.runtimeRevisionNumber,
    runtimeRevision.number, runtimeRevision.revisionNumber].filter(value => value !== undefined && value !== null)
  if (id(model.runtimeInstanceId) !== scopePolicy.scope.runtimeInstanceId
    || id(model.runtimeRevision?.id) !== scopePolicy.scope.runtimeInstanceId || model.runtimeRevision?.number !== 1
    || id(model.customerId) !== scopePolicy.scope.customerId || id(model.tenantId) !== scopePolicy.scope.tenantId
    || sourceRevisionIds.some(value => id(value) !== scopePolicy.scope.runtimeInstanceId)
    || sourceRevisionNumbers.some(value => Number(value) !== 1)
    || [model.runtimeRevision, source.runtimeRevision, source.revision, runtimeRevision]
      .some(value => value?.parentRuntimeId || (value?.rootRuntimeId && id(value.rootRuntimeId) !== scopePolicy.scope.runtimeInstanceId))
    || ![model.assetId, model.assetVersionId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 180 && value === value.trim())
    || !Number.isSafeInteger(model.versionNumber) || model.versionNumber < 1
    || !/^sha256:[a-f0-9]{64}$/.test(model.sourceContentChecksum || ''))
    fail('SYNTHETIC_ARTIFACT_BINDING_INVALID', 'Synthetic render scope, revision or source binding is unsupported.')
  const body = Object.freeze({ contractVersion: 'synthetic-render-artifact-classification.v1',
    domain: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST_RENDER_CANDIDATE',
    amendmentReference: amendment.reference, amendmentHash: amendment.documentHash,
    runtimeInstanceId: scopePolicy.scope.runtimeInstanceId, runtimeRevisionId: scopePolicy.scope.runtimeInstanceId,
    runtimeRevisionNumber: 1, customerId: scopePolicy.scope.customerId, tenantId: scopePolicy.scope.tenantId,
    assetId: model.assetId, assetVersionId: model.assetVersionId, versionNumber: model.versionNumber,
    originalSourceContentChecksum: model.sourceContentChecksum, deliveryStatus: 'HELD', officialUse: false })
  return Object.freeze({ body, checksum: membershipHash(body) })
}
export const assertSyntheticRenderClassification = model => {
  const expected = deriveSyntheticRenderClassification(model)
  if (expected) {
    if (!classificationPresent(model) || membershipHash(model.artifactClassification) !== membershipHash(expected))
      fail('SYNTHETIC_ARTIFACT_CLASSIFICATION_INVALID', 'The synthetic render classification is missing or changed.')
  } else if (classificationPresent(model)) {
    fail('SYNTHETIC_ARTIFACT_CLASSIFICATION_INVALID', 'Classification cannot be moved to a different native artifact.')
  }
  return expected
}
export const assertSyntheticRenderDeliveryHeld = model => {
  const classification = assertSyntheticRenderClassification(model)
  if (classification) fail('SYNTHETIC_TEST_DELIVERY_HELD', 'Synthetic render delivery requires the genuine governed predecessor chain; it remains held.')
}
export const assertNoAuthoredRenderClassification = source => {
  if (classificationPresent(source)) fail('SYNTHETIC_ARTIFACT_CLASSIFICATION_INVALID', 'Source versions cannot author a render classification.')
}
// This insertion guard is not a transaction, audit signature or raw-collection/query-update guarantee.
export const assertNoSyntheticRenderRecordInsertion = record => {
  const receipt = record.renderReceipt || {}
  const source = receipt.source || {}
  if (isControlledSyntheticOutcomeRuntime({ runtimeInstanceId: record.runtimeInstanceId,
    id: record.runtimeRevisionId, revision: { rootRuntimeId: source.runtimeRevision?.rootRuntimeId,
      parentRuntimeId: source.runtimeRevision?.parentRuntimeId } })
    || isControlledSyntheticOutcomeRuntime({ runtimeInstanceId: source.runtimeInstanceId, id: source.runtimeRevision?.id })
    || isControlledSyntheticOutcomeRuntime({ runtimeInstanceId: source.runtimeRevisionId, id: source.runtimeRevision?.revisionId })
    || classificationPresent(record) || classificationPresent(receipt) || classificationPresent(source)
    || classificationPresent(record.artifact) || Object.hasOwn(source, 'classificationChecksum')
    || Object.hasOwn(record.artifact || {}, 'classificationChecksum'))
    fail('SYNTHETIC_TEST_DELIVERY_HELD', 'Synthetic render records cannot be persisted before governed test delivery is available.')
}
