import AuditLog from '../models/AuditLog.js'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'
import { validateControlledReplayRunIdentity } from './controlledReplayContract.js'

export const STOPPED_WORKER_RECOVERY_REASON = 'STOPPED_WORKER_RECOVERY'
export const ORIGINAL_EXTRACTION_UNCONFIRMED = 'ORIGINAL_EXTRACTION_OUTCOME_UNCONFIRMED'

export const assertStoppedRecoveryWitness = (row, proof) => {
  const invalid = () => { throw Object.assign(new Error('Stopped-worker recovery proof does not match this Run.'), {
    status: 422, code: 'VALIDATION_ERROR', details: { reason: 'ACQUISITION_RECOVERY_PROOF_INVALID', runId: row.runId },
  }) }
  const fields = ['runId', 'requestKey', 'executionAttemptId', 'requestFingerprint', 'actorUserId', 'actionKey',
    'acquisitionProfile', 'basisStateVersion', 'customerId', 'tenantId', 'runtimeInstanceId', 'admissionAuditId', 'startAuditId']
  if (!proof || proof.contractVersion !== 'stopped-worker-acquisition-recovery.v1'
    || fields.some(key => typeof proof[key] !== 'string' || proof[key] !== String(row[key]))
    || proof.inputsHash !== snapshotHash(row.inputs)
    || ['rootHash', 'workerCommandHash', 'servedSourceHash', 'operatorEvidenceHash'].some(key => typeof proof[key] !== 'string' || !/^[a-f0-9]{64}$/.test(proof[key]))
    || !Number.isSafeInteger(proof.workerPid) || proof.workerPid <= 0 || proof.workerPid === process.pid
    || typeof proof.originalRequestId !== 'string' || !proof.originalRequestId || proof.originalRequestId.length > 100
    || proof.originalResponseReason !== 'ACQUISITION_OUTCOME_UNCONFIRMED') invalid()
  for (const key of ['workerStartedAt', 'stoppedAt', 'basisUpdatedAt']) {
    if (typeof proof[key] !== 'string' || !Number.isFinite(Date.parse(proof[key]))) invalid()
  }
  const stopped = Date.parse(proof.stoppedAt)
  if (Date.parse(proof.basisUpdatedAt) !== new Date(row.basisUpdatedAt).getTime()
    || Date.parse(proof.workerStartedAt) >= new Date(row.createdAt).getTime()
    || !row.startedAt || stopped <= new Date(row.startedAt).getTime() || stopped > Date.now()
    || row.active && Date.now() - stopped > 30 * 60 * 1000) invalid()
  return proof
}

export const assertAcquisitionTerminalProof = (row, terminalAudit, saveAnchor) => {
  const invalid = () => { throw Object.assign(new Error('Acquisition receipt audit could not be verified. Refresh.'), {
    code: 'SERVICE_UNAVAILABLE', status: 503,
    details: { reason: 'ACQUISITION_RECEIPT_UNVERIFIED', runId: row.runId },
  }) }
  const audit = terminalAudit instanceof AuditLog ? terminalAudit : terminalAudit ? AuditLog.hydrate(terminalAudit) : null
  if (row.contractVersion === 'controlled-acquisition-run.v1') {
    if (audit?.diff?.controlledRun === undefined) invalid()
    let descriptor
    try { descriptor = validateControlledReplayRunIdentity(row) } catch { invalid() }
    if (row.plannerVersion !== 'controlled-acquisition-planner.v1'
      || snapshotHash(audit?.diff?.controlledRun) !== snapshotHash({ contractVersion: row.contractVersion,
        plannerVersion: row.plannerVersion, descriptorHash: snapshotHash(descriptor) })
      || row.inputs?.length !== 1 || row.inputs[0].kind !== 'CONTROLLED' || row.inputs[0].inputIndex !== 0
      || row.inputs[0].contentHash !== descriptor.binding.fixture.htmlSha256
      || row.outcomes?.length !== 1 || row.outcomes[0].kind !== 'CONTROLLED' || row.outcomes[0].inputIndex !== 0
      || row.canonicalSaved && row.outcomes[0].contentHash !== row.inputs[0].contentHash) invalid()
  } else if (row.controlledReplayProvenance !== undefined || audit?.diff?.controlledRun !== undefined) invalid()
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
  if (row.reason === STOPPED_WORKER_RECOVERY_REASON || row.outcomes?.some(item => item.reason === ORIGINAL_EXTRACTION_UNCONFIRMED)) {
    assertStoppedRecoveryWitness(row, audit.diff.recoveryWitness)
    if (row.reason !== STOPPED_WORKER_RECOVERY_REASON || row.status !== 'FAILED' || row.canonicalSaved !== false
      || row.outcomes?.length !== row.inputs?.length || row.outcomes.some((item, index) => item.kind !== row.inputs[index].kind
        || item.inputIndex !== row.inputs[index].inputIndex || item.status !== 'FAILED' || item.evidenceObjectCount !== 0
        || item.reason !== ORIGINAL_EXTRACTION_UNCONFIRMED || item.sourceId || item.contentHash)) invalid()
  }
  return row
}
