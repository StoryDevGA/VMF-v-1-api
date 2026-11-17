import { validateResearchRunConfiguration, researchConfigurationReference, PROVIDER_FREE_SEARCH_RUN_VERSION,
  validateProviderFreeSearchRun, providerFreeSearchAuditBinding } from './researchConfigurationContract.js'
import AuditLog from '../models/AuditLog.js'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'
import { validateControlledReplayRunIdentity, validateStoredControlledReplayProvenance } from './controlledReplayContract.js'
import { PUBLIC_RESEARCH_RUN_VERSION, validatePublicResearchRun } from './publicResearchContract.js'

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
  const retry = row.predecessorExecutionAttemptId ? { predecessorRunId: row.predecessorRunId, predecessorExecutionAttemptId: row.predecessorExecutionAttemptId } : null
  if (row.contractVersion === PROVIDER_FREE_SEARCH_RUN_VERSION) {
    let record
    try { record = validateProviderFreeSearchRun(row) } catch { invalid() }
    if (snapshotHash(audit?.diff?.providerFreeSearch) !== snapshotHash(providerFreeSearchAuditBinding(record))) invalid()
  } else if (row.providerFreeSearch !== undefined || row.receiptRecorded !== undefined || audit?.diff?.providerFreeSearch !== undefined) invalid()
  if (snapshotHash(retry) !== snapshotHash(audit?.diff?.researchRetry || null)
    || row.researchConfiguration && Boolean(row.predecessorRunId) !== Boolean(row.predecessorExecutionAttemptId)
    || row.predecessorExecutionAttemptId && !row.researchConfiguration) invalid()
  if (row.researchConfiguration !== undefined || audit?.diff?.researchConfiguration !== undefined) {
    let record
    try { record = validateResearchRunConfiguration(row) } catch { invalid() }
    if (snapshotHash(researchConfigurationReference(record) || null) !== snapshotHash(audit?.diff?.researchConfiguration || null)) invalid()
  }
  if (row.contractVersion === PUBLIC_RESEARCH_RUN_VERSION) {
    try {
      validatePublicResearchRun(row)
      if (row.controlledReplayProvenance) validateStoredControlledReplayProvenance(row.controlledReplayProvenance, {
        customerId: String(row.customerId), tenantId: String(row.tenantId), runtimeInstanceId: String(row.runtimeInstanceId),
        runtimeInstanceKey: row.runtimeInstanceKey })
    } catch { invalid() }
    if (audit?.diff?.publicResearchPlanHash !== row.publicResearch.plan.planHash
      || audit?.diff?.publicResearchReceiptHash !== row.publicResearch.ledgerHash
      || audit?.diff?.publicResearchLedgerSequence !== row.publicResearch.ledgerSequence
      || audit?.diff?.publicResearchControlledDescriptorHash !== (row.controlledReplayProvenance ? snapshotHash(row.controlledReplayProvenance) : null)
      || audit?.diff?.controlledRun !== undefined) invalid()
  } else if (row.contractVersion === 'controlled-acquisition-run.v1') {
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
  if (row.status === 'CANCELLED') {
    if (!['controlled-acquisition-run.v1', PUBLIC_RESEARCH_RUN_VERSION].includes(row.contractVersion) || !row.researchConfiguration || row.active !== false
      || row.canonicalSaved !== false || row.outputStateVersion || row.saveAuditId || row.reason !== 'CANCELLED_BEFORE_SAVE'
      || Boolean(row.startedAt) !== Boolean(row.startAuditId) || Boolean(row.startedAt) !== Boolean(row.startAuditSignatureVersion)
      || audit.diff.cancellationStage !== (row.startedAt ? 'RUNNING' : 'QUEUED') || audit.diff.workerStopConfirmed !== false
      || audit.diff.cancelledAt !== new Date(row.completedAt).toISOString()
      || row.outcomes?.some(item => item.status !== 'CANCELLED' || item.evidenceObjectCount !== 0 || item.reason !== 'CANCELLED_BEFORE_SAVE' || item.sourceId || item.contentHash)) invalid()
  } else if (row.outcomes?.some(item => item.status === 'CANCELLED')) invalid()
  if (row.reason === STOPPED_WORKER_RECOVERY_REASON || row.outcomes?.some(item => item.reason === ORIGINAL_EXTRACTION_UNCONFIRMED)) {
    assertStoppedRecoveryWitness(row, audit.diff.recoveryWitness)
    if (row.reason !== STOPPED_WORKER_RECOVERY_REASON || row.status !== 'FAILED' || row.canonicalSaved !== false
      || row.outcomes?.length !== row.inputs?.length || row.outcomes.some((item, index) => item.kind !== row.inputs[index].kind
        || item.inputIndex !== row.inputs[index].inputIndex || item.status !== 'FAILED' || item.evidenceObjectCount !== 0
        || item.reason !== ORIGINAL_EXTRACTION_UNCONFIRMED || item.sourceId || item.contentHash)) invalid()
  }
  return row
}
