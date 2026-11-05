import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Audit from '../../models/AuditLog.js'
import { meaningMasterRecordFixture } from './meaningSourceMasterFixture.js'
import { governedDocxFixture } from './governedDocxCandidateFixture.js'
import { docxPagePreviewFixture } from './docxPagePreviewFixture.js'
import { projectMeaningMasterSource, meaningMasterRequestFingerprint, MEANING_MASTER_FLAGS } from '../../services/outcomeMeaningSourceMasterContract.js'
import { prepareMeaningMasterDocxRendition } from '../../services/outcomeMeaningMasterRenditionService.js'
import { hashOutcomeQualityStageValue } from '../../services/outcomeQualityStageExecutionService.js'
import { membershipHash } from '../../services/runtimeEvidenceSnapshotContract.js'
import { previewHash } from '../../services/docxPagePreviewRuntime.js'
import { MASTER_LINKED_CANDIDATE_VERSION, MASTER_LINKED_PREVIEW_VERSION, masterBindingFromBridge,
  masterLinkedRequestFingerprint } from '../../services/outcomeMasterLinkedDocxContract.js'
import { privateDocxAuditDiff } from '../../services/outcomeDocxCandidateRecordContract.js'
import { docxPagePreviewAuditDiff } from '../../services/outcomeDocxPagePreviewRecordContract.js'

const copy = value => JSON.parse(JSON.stringify(value))
// Unsigned upstream projections. Real recording audits below prove storage
// contracts only; these projections are never genuine source/review receipts.
export const masterLinkedDocxFixture = async (runtimeInstanceId = null, decorateSource = null) => {
  const f = meaningMasterRecordFixture(), g = governedDocxFixture()
  if (runtimeInstanceId) { f.scope.runtimeInstanceId = runtimeInstanceId; f.envelope.source.scope.runtimeInstanceId = runtimeInstanceId }
  f.envelope.source.selectedPacks = copy(g.envelope.source.selectedPacks)
  f.envelope.source.content.shaping = copy(g.shaping)
  if (decorateSource) decorateSource(f.envelope.source)
  f.envelope.source.stageRefs.find(ref => ref.stageKey === 'OUTPUT_SHAPING').outputFingerprint = hashOutcomeQualityStageValue(f.envelope.source.content.shaping)
  f.seal()
  const master = f.record, b = master.body
  master.runtimeInstanceId = f.scope.runtimeInstanceId; b.scope = f.scope
  master.sourceFingerprint = b.sourceFingerprint = f.envelope.sourceFingerprint
  master.requestFingerprint = b.requestFingerprint = meaningMasterRequestFingerprint(master.sourceFingerprint)
  b.sourceSnapshot = projectMeaningMasterSource(f.envelope); f.rehash()
  const masterReceipt = { master: { masterId: master.masterId, version: 1, purpose: b.purpose, status: b.status,
    permittedUse: b.permittedUse, classification: b.classification, sourceFingerprint: master.sourceFingerprint,
    sourceProjectionFingerprint: b.sourceProjectionFingerprint, ...Object.fromEntries(MEANING_MASTER_FLAGS.map(key => [key, false])) },
  masterReference: { storageId: String(master._id), masterId: master.masterId, version: 1, scope: f.scope,
    bodyFingerprint: master.bodyFingerprint, sourceFingerprint: master.sourceFingerprint,
    sourceProjectionFingerprint: b.sourceProjectionFingerprint, auditId: String(master.auditId), auditSignatureVersion: master.auditSignatureVersion },
  sourceEnvelope: f.envelope }
  const docs = [...g.documents.map(doc => ({ ...doc.source, content: doc.content, available: true, status: 'ACTIVE' })), g.audienceDocument]
  const loadPackContent = async query => docs.find(doc => doc.packId === query.packId && doc.versionId === query.versionId)
  const bridge = await prepareMeaningMasterDocxRendition({ actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId,
    masterId: master.masterId, version: 1, deps: { readMaster: async () => copy(masterReceipt), loadPackContent } })
  const body = { contractVersion: MASTER_LINKED_CANDIDATE_VERSION, candidateId: `docx_candidate_${randomUUID()}`, scope: f.scope,
    requestKey: randomUUID(), requestFingerprint: masterLinkedRequestFingerprint(masterReceipt.masterReference, bridge.renderer),
    createdBy: f.actorUserId, createdAt: '2026-10-29T19:10:00.000Z', classification: bridge.classification, status: 'PRIVATE_UNREVIEWED',
    ...Object.fromEntries(MEANING_MASTER_FLAGS.map(key => [key, false])), sourceFingerprint: f.envelope.sourceFingerprint,
    inputFingerprint: bridge.input.renditionInputFingerprint, input: bridge.input.renditionInput, artifact: bridge.artifact,
    packageValidation: bridge.packageValidation, masterBinding: masterBindingFromBridge(bridge) }
  const record = { _id: new mongoose.Types.ObjectId(), ...f.scope, candidateId: body.candidateId, requestKey: body.requestKey,
    requestFingerprint: body.requestFingerprint, bodyFingerprint: membershipHash(body), body, fileBytes: Buffer.from(bridge.buffer),
    auditId: new mongoose.Types.ObjectId(), auditSignatureVersion: 2 }
  const audit = new Audit({ _id: record.auditId, actorUserId: f.actorUserId, action: 'OUTCOME_DOCX_CANDIDATE_CREATED',
    resourceType: 'OutcomeDocxRenditionCandidate', resourceId: record._id, scope: f.scope, diff: privateDocxAuditDiff(record) })
  audit.generateSignature(); record.auditSignatureVersion = audit.signatureVersion
  const p = docxPagePreviewFixture(), conversion = copy(p.rendered.receipt)
  conversion.docxChecksum = body.artifact.outputChecksum
  const previewBody = { contractVersion: MASTER_LINKED_PREVIEW_VERSION, previewId: `docx_preview_${randomUUID()}`,
    candidateId: record.candidateId, scope: f.scope, createdBy: f.actorUserId, createdAt: body.createdAt, status: 'PRIVATE_PREVIEW_ONLY',
    classification: body.classification, ...Object.fromEntries(MEANING_MASTER_FLAGS.map(key => [key, false])),
    sourceFingerprint: body.sourceFingerprint, inputFingerprint: body.inputFingerprint, renderer: body.input.renderer,
    conversion, conversionFingerprint: previewHash(JSON.stringify(conversion)), candidateBodyFingerprint: record.bodyFingerprint,
    masterBindingFingerprint: membershipHash(body.masterBinding) }
  const preview = { _id: new mongoose.Types.ObjectId(), ...f.scope, candidateId: record.candidateId, previewId: previewBody.previewId,
    docxChecksum: body.artifact.outputChecksum, runtimeFingerprint: conversion.runtimeFingerprint,
    body: previewBody, bodyFingerprint: membershipHash(previewBody), pageBytes: p.rendered.pages.map(page => page.buffer),
    auditId: new mongoose.Types.ObjectId(), auditSignatureVersion: 2 }
  const previewAudit = new Audit({ _id: preview.auditId, actorUserId: f.actorUserId, action: 'OUTCOME_DOCX_PAGE_PREVIEW_CREATED',
    resourceType: 'OutcomeDocxPagePreview', resourceId: preview._id, scope: f.scope, diff: docxPagePreviewAuditDiff(preview) })
  previewAudit.generateSignature(); preview.auditSignatureVersion = previewAudit.signatureVersion
  return { ...f, masterRecord: master, masterReceipt, loadPackContent, bridge, record, audit: audit.toObject(), preview, previewAudit: previewAudit.toObject(),
    previewRuntime: p.runtime, rendered: { receipt: conversion, fingerprint: previewBody.conversionFingerprint,
      pages: p.rendered.pages },
    payload: { requestKey: body.requestKey, expectedSourceFingerprint: body.sourceFingerprint, format: 'DOCX',
      masterId: master.masterId, masterVersion: 1, expectedMasterBodyFingerprint: master.bodyFingerprint } }
}
