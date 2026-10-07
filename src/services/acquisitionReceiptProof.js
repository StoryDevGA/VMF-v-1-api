import AuditLog from '../models/AuditLog.js'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'

export const assertAcquisitionTerminalProof = (row, terminalAudit, saveAnchor) => {
  const invalid = () => { throw Object.assign(new Error('Acquisition receipt audit could not be verified. Refresh.'), {
    code: 'SERVICE_UNAVAILABLE', status: 503,
    details: { reason: 'ACQUISITION_RECEIPT_UNVERIFIED', runId: row.runId },
  }) }
  const audit = terminalAudit instanceof AuditLog ? terminalAudit : terminalAudit ? AuditLog.hydrate(terminalAudit) : null
  if (!audit || !audit.verifySignature()
    || ![1, 2, 3].includes(row.terminalAuditSignatureVersion)
    || audit.signatureVersion !== row.terminalAuditSignatureVersion
    || String(audit._id) !== String(row.terminalAuditId)
    || String(audit.resourceId) !== String(row.runtimeInstanceId)
    || String(audit.actorUserId) !== String(row.actorUserId)
    || audit.action !== 'RUNTIME_ACQUISITION_RECORDED'
    || audit.diff?.runId !== row.runId || audit.diff.executionAttemptId !== row.executionAttemptId
    || audit.diff.phase !== row.status || audit.diff.requestFingerprint !== row.requestFingerprint
    || audit.diff.outcomeHash !== snapshotHash(row.outcomes)
    || audit.diff.outputStateVersion !== (row.outputStateVersion || null)
    || audit.diff.canonicalSaved !== row.canonicalSaved
    || String(audit.diff.saveAuditId || '') !== String(row.saveAuditId || '')
    || (audit.diff.saveAuditSignature || '') !== (row.saveAuditSignature || '')) invalid()
  if (row.canonicalSaved && (!saveAnchor
    || String(saveAnchor._id) !== String(row.saveAuditId)
    || String(saveAnchor.resourceId) !== String(row.runtimeInstanceId)
    || String(saveAnchor.actorUserId) !== String(row.actorUserId)
    || saveAnchor.signature !== row.saveAuditSignature
    || saveAnchor.signatureVersion !== row.saveAuditSignatureVersion
    || !['RUNTIME_STATE_MUTATED', 'RUNTIME_ACTION_EXECUTED'].includes(saveAnchor.action))) invalid()
  return row
}
