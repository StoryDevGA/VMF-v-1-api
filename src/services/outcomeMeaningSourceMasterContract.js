import mongoose from 'mongoose'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { hashOutcomeQualityStageValue } from './outcomeQualityStageExecutionService.js'
import { OUTCOME_QUALITY_STAGE_SEQUENCE } from '../constants/outcomeGovernedQuality.js'
import { SYNTHETIC_OUTCOME_CLASSIFICATION } from '../models/SyntheticOutcomeRunEvent.js'
import { OUTCOME_DOCX_RENDITION_SOURCE_VERSION } from './outcomeDocxRenditionSourceService.js'

export const MEANING_MASTER_VERSION = 'meaning-source-master.v1'
export const MEANING_MASTER_USE = 'ISOLATED_ENGINEERING_TEST_ONLY'
export const MEANING_MASTER_FLAGS = Object.freeze(['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable'])
export const MEANING_MASTER_INDEXES = Object.freeze({
  meaning_master_scope_version_unique: { tenantId: 1, customerId: 1, runtimeInstanceId: 1, masterId: 1, version: 1 },
  meaning_master_scope_request_unique: { tenantId: 1, customerId: 1, runtimeInstanceId: 1, requestKey: 1 },
  meaning_master_scope_source_unique: { tenantId: 1, customerId: 1, runtimeInstanceId: 1, sourceFingerprint: 1, permittedUse: 1, contractVersion: 1 },
})
export const meaningMasterFailure = (reason, status = 409) => Object.assign(new Error('The meaning-only source snapshot is unavailable.'), {
  code: 'MEANING_SOURCE_MASTER_BLOCKED', status, details: { reason, contentIncludedInError: false },
})
const need = (value, reason) => { if (!value) throw meaningMasterFailure(reason) }
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export const meaningMasterObjectId = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value === value.trim()
export const meaningMasterRequestKey = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(value)
export const meaningMasterId = value => typeof value === 'string' && /^meaning_master_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const scopeKeys = ['tenantId', 'customerId', 'runtimeInstanceId']
const projectionKeys = ['kind', 'scope', 'basis', 'plan', 'logicalDraft', 'stageRefs', 'selectedPacks', 'journal', 'reviewState', 'priorRuns', 'meaning']
const bodyKeys = ['contractVersion', 'masterId', 'version', 'purpose', 'permittedUse', 'classification', 'status', 'scope', 'requestKey',
  'requestFingerprint', 'createdBy', 'createdAt', ...MEANING_MASTER_FLAGS, 'sourceFingerprint', 'sourceProjectionFingerprint', 'sourceSnapshot']
const recordKeys = ['_id', 'masterId', 'version', ...scopeKeys, 'requestKey', 'requestFingerprint', 'sourceFingerprint', 'permittedUse',
  'contractVersion', 'bodyFingerprint', 'body', 'auditId', 'auditSignatureVersion']
export const meaningMasterRequestFingerprint = sourceFingerprint => membershipHash({ contractVersion: MEANING_MASTER_VERSION,
  purpose: 'MEANING_SOURCE_ONLY', permittedUse: MEANING_MASTER_USE, expectedSourceFingerprint: sourceFingerprint })

const assertProjection = snapshot => {
  need(exact(snapshot, projectionKeys) && snapshot.kind === 'GOVERNED_STAGE_CHAIN', 'SOURCE_PROJECTION_INVALID')
  need(scopeKeys.every(key => meaningMasterObjectId(snapshot.scope?.[key]))
    && snapshot.scope.classification === SYNTHETIC_OUTCOME_CLASSIFICATION && snapshot.scope.authoritative === false, 'SOURCE_SCOPE_INVALID')
  need(text(snapshot.basis?.snapshotId) && digest(snapshot.basis.membershipHash) && text(snapshot.basis.basisStateVersion)
    && digest(snapshot.basis.lockSnapshotHash) && meaningMasterObjectId(snapshot.plan?.recordId)
    && text(snapshot.plan.planId) && text(snapshot.plan.requestId) && digest(snapshot.plan.planFingerprint)
    && digest(snapshot.plan.resolutionFingerprint) && digest(snapshot.plan.contextFingerprint)
    && text(snapshot.logicalDraft?.draftId) && text(snapshot.logicalDraft.draftIterationId)
    && text(snapshot.journal?.claimEventId) && text(snapshot.journal.resultEventId)
    && Array.isArray(snapshot.priorRuns) && snapshot.reviewState && snapshot.selectedPacks, 'SOURCE_BASIS_INVALID')
  const refs = snapshot.stageRefs, sequence = OUTCOME_QUALITY_STAGE_SEQUENCE.slice(0, 6)
  need(Array.isArray(refs) && refs.length === sequence.length && new Set(refs.map(ref => ref.stageExecutionId)).size === sequence.length
    && refs.every((ref, index) => ref.stageKey === sequence[index] && text(ref.stageExecutionId)
      && (index < 5 ? ref.status === 'SUCCEEDED' : ['SUCCEEDED', 'FAILED', 'BLOCKED'].includes(ref.status))
      && digest(ref.inputFingerprint) && digest(ref.attemptFingerprint) && digest(ref.materialHash)
      && (ref.status === 'SUCCEEDED' ? digest(ref.outputFingerprint) : ref.outputFingerprint === '')), 'SOURCE_HISTORY_INVALID')
  need(exact(snapshot.meaning, ['workingDraft', 'approvedMeaning']), 'SOURCE_MEANING_INVALID')
  const { workingDraft, approvedMeaning } = snapshot.meaning
  need(workingDraft && Array.isArray(workingDraft.sections) && workingDraft.sections.length > 0
    && approvedMeaning?.state === 'APPROVED' && approvedMeaning.workingDraftStageExecutionId === refs[1].stageExecutionId
    && approvedMeaning.workingDraftOutputFingerprint === refs[1].outputFingerprint
    && hashOutcomeQualityStageValue(workingDraft) === refs[1].outputFingerprint
    && hashOutcomeQualityStageValue(workingDraft.decisionLogic) === approvedMeaning.decisionLogicFingerprint
    && membershipHash(workingDraft.decisionLogic) === membershipHash(approvedMeaning.decisionLogic), 'SOURCE_MEANING_BINDING_INVALID')
}

export const projectMeaningMasterSource = envelope => {
  need(envelope?.contractVersion === OUTCOME_DOCX_RENDITION_SOURCE_VERSION && envelope.sourceAdmission === 'VERIFIED_READ_ONLY_CHAIN'
    && envelope.classification === SYNTHETIC_OUTCOME_CLASSIFICATION
    && ['authoritative', 'normalOutputAvailable', 'authorisesApproval', 'renderingAvailable', 'finalisationAvailable', 'deliveryAvailable']
      .every(key => envelope[key] === false)
    && digest(envelope.sourceFingerprint) && membershipHash(envelope.source) === envelope.sourceFingerprint, 'SOURCE_ENVELOPE_INVALID')
  const source = envelope.source
  const snapshot = JSON.parse(JSON.stringify(Object.fromEntries(projectionKeys.map(key => [key,
    key === 'meaning' ? { workingDraft: source.content?.workingDraft, approvedMeaning: source.content?.approvedMeaning } : source[key]]))))
  assertProjection(snapshot)
  return snapshot
}

export const assertMeaningMasterBody = body => {
  need(exact(body, bodyKeys) && body.contractVersion === MEANING_MASTER_VERSION && body.version === 1
    && meaningMasterId(body.masterId) && body.purpose === 'MEANING_SOURCE_ONLY'
    && body.permittedUse === MEANING_MASTER_USE && body.status === 'RECORDED_MEANING_SOURCE_ONLY'
    && body.classification === SYNTHETIC_OUTCOME_CLASSIFICATION && MEANING_MASTER_FLAGS.every(key => body[key] === false), 'MASTER_ROLE_INVALID')
  need(exact(body.scope, scopeKeys) && scopeKeys.every(key => meaningMasterObjectId(body.scope[key]))
    && meaningMasterObjectId(body.createdBy) && meaningMasterRequestKey(body.requestKey)
    && typeof body.createdAt === 'string' && Number.isFinite(Date.parse(body.createdAt)) && new Date(body.createdAt).toISOString() === body.createdAt,
  'MASTER_IDENTITY_INVALID')
  assertProjection(body.sourceSnapshot)
  need(digest(body.sourceFingerprint) && body.requestFingerprint === meaningMasterRequestFingerprint(body.sourceFingerprint)
    && body.sourceProjectionFingerprint === membershipHash(body.sourceSnapshot)
    && scopeKeys.every(key => body.scope[key] === body.sourceSnapshot.scope[key]), 'MASTER_SOURCE_BINDING_INVALID')
  need(Buffer.byteLength(JSON.stringify(body)) <= 1024 ** 2, 'MASTER_BODY_LIMIT')
}

export const assertMeaningMasterRecord = record => {
  need(exact(record, recordKeys), 'MASTER_RECORD_FIELDS_INVALID')
  assertMeaningMasterBody(record.body)
  need(scopeKeys.every(key => String(record[key]) === record.body.scope[key])
    && ['masterId', 'version', 'requestKey', 'requestFingerprint', 'sourceFingerprint', 'permittedUse', 'contractVersion'].every(key => record[key] === record.body[key])
    && record.bodyFingerprint === membershipHash(record.body)
    && meaningMasterObjectId(String(record._id)) && meaningMasterObjectId(String(record.auditId))
    && Number.isInteger(record.auditSignatureVersion) && record.auditSignatureVersion > 0, 'MASTER_RECORD_BINDING_INVALID')
  need(mongoose.mongo.BSON.calculateObjectSize(record) <= 2 * 1024 ** 2, 'MASTER_BSON_LIMIT')
}
export const meaningMasterAuditDiff = record => Object.fromEntries(['masterId', 'version', 'requestKey', 'requestFingerprint', 'sourceFingerprint',
  'permittedUse', 'contractVersion', 'bodyFingerprint'].map(key => [key, record[key]]))
export const assertMeaningMasterAudit = (record, audit, verify) => {
  need(audit && String(audit._id) === String(record.auditId) && audit.signatureVersion === record.auditSignatureVersion
    && audit.action === 'OUTCOME_MEANING_SOURCE_RECORDED' && audit.resourceType === 'OutcomeMeaningSourceMaster'
    && String(audit.resourceId) === String(record._id) && String(audit.actorUserId) === record.body.createdBy
    && scopeKeys.every(key => String(audit.scope?.[key]) === record.body.scope[key])
    && membershipHash(audit.diff) === membershipHash(meaningMasterAuditDiff(record)) && verify(audit) === true, 'MASTER_SIGNED_AUDIT_INVALID')
}
