import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import RuntimeAcquisitionRun from '../models/RuntimeAcquisitionRun.js'
import AuditLog from '../models/AuditLog.js'
import { assertStoppedRecoveryWitness, assertAcquisitionTerminalProof, ORIGINAL_EXTRACTION_UNCONFIRMED } from '../services/acquisitionReceiptProof.js'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'
import env from '../config/env.js'
import User from '../models/User.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import auditService from '../services/auditService.js'

const permissionSnapshot = jest.fn()
jest.unstable_mockModule('../services/performanceCacheService.js', () => ({
  default: {}, buildUserPermissionsSnapshot: permissionSnapshot,
  buildLegacyUserPermissionsSnapshot: jest.fn(), buildTenantStatusSnapshot: jest.fn(),
  buildCustomerTopologySnapshot: jest.fn(), buildLicenseLevelEntitlementSnapshot: jest.fn(),
}))
const { assertRecoveryWorkerStopped, recoverStoppedAcquisitionRun } = await import('../services/acquisitionRunService.js')

const fixture = () => {
  const row = { customerId: new mongoose.Types.ObjectId(), tenantId: new mongoose.Types.ObjectId(), runtimeInstanceId: new mongoose.Types.ObjectId(),
    rootRuntimeInstanceId: new mongoose.Types.ObjectId(), actorUserId: new mongoose.Types.ObjectId(), admissionAuditId: new mongoose.Types.ObjectId(),
    startAuditId: new mongoose.Types.ObjectId(), admissionAuditSignatureVersion: 3, startAuditSignatureVersion: 3,
    runtimeInstanceKey: 'synthetic-recovery', rootRuntimeInstanceKey: 'synthetic-recovery', runId: randomUUID(), requestKey: randomUUID(),
    executionAttemptId: randomUUID(), requestFingerprint: 'a'.repeat(64), plannerFingerprint: 'b'.repeat(64),
    authority: 'VMF_UPDATE', actionKey: 'SAVE_DISCOVERY_INPUTS', acquisitionProfile: 'STANDARD', contractVersion: 'acquisition-run.v1',
    plannerVersion: 'discovery-acquisition-planner.v1', basisStateVersion: 'rsv2:synthetic', basisUpdatedAt: new Date(Date.now() - 10000),
    createdAt: new Date(Date.now() - 5000), startedAt: new Date(Date.now() - 4000), active: true, status: 'RUNNING',
    inputs: [{ kind: 'BRIEF', inputIndex: 0, contentHash: 'c'.repeat(64) }, { kind: 'DOCUMENT', inputIndex: 0, contentHash: 'd'.repeat(64) }] }
  const proof = Object.fromEntries(['runId', 'requestKey', 'executionAttemptId', 'requestFingerprint', 'actorUserId', 'actionKey',
    'acquisitionProfile', 'basisStateVersion', 'customerId', 'tenantId', 'runtimeInstanceId', 'admissionAuditId', 'startAuditId'].map(key => [key, String(row[key])]))
  Object.assign(proof, { contractVersion: 'stopped-worker-acquisition-recovery.v1', workerPid: 2147483647,
    workerStartedAt: new Date(Date.now() - 6000).toISOString(), stoppedAt: new Date(Date.now() - 1000).toISOString(),
    basisUpdatedAt: row.basisUpdatedAt.toISOString(), inputsHash: snapshotHash(row.inputs), rootHash: 'e'.repeat(64),
    workerCommandHash: 'f'.repeat(64), servedSourceHash: '1'.repeat(64), operatorEvidenceHash: '2'.repeat(64),
    originalRequestId: 'original-request', originalResponseReason: 'ACQUISITION_OUTCOME_UNCONFIRMED' })
  return { row, proof }
}

describe('stopped-worker recovery proof and truthful outcome', () => {
  test('accepts the exact typed witness without changing its inputs', () => {
    const { row, proof } = fixture(), before = structuredClone(proof)
    expect(assertStoppedRecoveryWitness(row, proof)).toBe(proof); expect(proof).toEqual(before)
  })
  test.each(['runId', 'requestKey', 'executionAttemptId', 'requestFingerprint', 'actorUserId', 'customerId', 'tenantId',
    'runtimeInstanceId', 'inputsHash', 'basisStateVersion', 'basisUpdatedAt', 'admissionAuditId', 'startAuditId', 'workerCommandHash', 'servedSourceHash'])('rejects changed %s', key => {
    const { row, proof } = fixture(); proof[key] = 'wrong'
    expect(() => assertStoppedRecoveryWitness(row, proof)).toThrow('proof does not match')
  })
  test.each(['self pid', 'bad pid', 'future stop', 'stop before start', 'expired active', 'bad start'])('rejects %s', kind => {
    const { row, proof } = fixture()
    if (kind === 'self pid') proof.workerPid = process.pid
    if (kind === 'bad pid') proof.workerPid = '123'
    if (kind === 'future stop') proof.stoppedAt = new Date(Date.now() + 60000).toISOString()
    if (kind === 'stop before start') proof.stoppedAt = new Date(Date.now() - 60000).toISOString()
    if (kind === 'expired active') { proof.workerStartedAt = new Date(Date.now() - 3600000).toISOString(); row.createdAt = new Date(Date.now() - 3500000); row.startedAt = new Date(Date.now() - 3400000); proof.stoppedAt = new Date(Date.now() - 1900000).toISOString() }
    if (kind === 'bad start') proof.workerStartedAt = 'invalid'
    expect(() => assertStoppedRecoveryWitness(row, proof)).toThrow('proof does not match')
  })
  test('rejects a live worker and non-Development operational entry', async () => {
    expect(() => assertRecoveryWorkerStopped(process.pid)).toThrow('not been confirmed stopped')
    await expect(recoverStoppedAcquisitionRun({})).rejects.toMatchObject({ details: { reason: 'ACQUISITION_RECOVERY_PROOF_INVALID' } })
  })
  test('validates unsaved unknown observations through the existing model and signed terminal proof', async () => {
    const { row, proof } = fixture()
    Object.assign(row, { status: 'FAILED', active: false, reason: 'STOPPED_WORKER_RECOVERY', canonicalSaved: false, completedAt: new Date(),
      terminalAuditId: new mongoose.Types.ObjectId(), terminalAuditSignatureVersion: 3,
      outcomes: row.inputs.map(({ kind, inputIndex }) => ({ kind, inputIndex, status: 'FAILED', evidenceObjectCount: 0, reason: ORIGINAL_EXTRACTION_UNCONFIRMED })) })
    await expect(new RuntimeAcquisitionRun(row).validate()).resolves.toBeUndefined()
    const audit = new AuditLog({ _id: row.terminalAuditId, resourceId: row.runtimeInstanceId, actorUserId: row.actorUserId,
      action: 'RUNTIME_ACQUISITION_RECORDED', resourceType: 'RuntimeInstance', signatureVersion: 3,
      diff: { runId: row.runId, executionAttemptId: row.executionAttemptId, requestFingerprint: row.requestFingerprint,
        phase: 'FAILED', outcomeHash: snapshotHash(row.outcomes), outputStateVersion: null, canonicalSaved: false,
        saveAuditId: null, saveAuditSignature: null, recoveryWitness: proof } })
    // Signature mechanics are covered by native audit tests; this pure case exercises recovery binding.
    audit.verifySignature = () => true
    expect(assertAcquisitionTerminalProof(row, audit)).toBe(row)
    audit.diff.recoveryWitness.inputsHash = '3'.repeat(64)
    expect(() => assertAcquisitionTerminalProof(row, audit)).toThrow('proof does not match')
  })
})

describe('native stopped-worker recovery owner (offline dependencies, not real persistence)', () => {
  let state, args, session, originalEnv, originalDb, originalReadyState
  const signedShape = (row, phase, auditId, diff = {}) => {
    const audit = new AuditLog({ _id: auditId, resourceId: row.runtimeInstanceId, actorUserId: row.actorUserId,
      resourceType: 'RuntimeInstance', action: 'RUNTIME_ACQUISITION_RECORDED', signatureVersion: 3,
      signature: 'offline-signature-shape', requestId: 'original-request', diff: {
        runId: row.runId, executionAttemptId: row.executionAttemptId, requestFingerprint: row.requestFingerprint, phase, ...diff,
      } })
    audit.verifySignature = () => true
    return audit
  }
  beforeEach(() => {
    originalEnv = { nodeEnv: env.nodeEnv, appEnv: env.appEnv }; env.nodeEnv = 'development'; env.appEnv = 'development'
    const { row, proof } = fixture()
    const root = { _id: row.runtimeInstanceId, customerId: row.customerId, tenantId: row.tenantId,
      runtimeInstanceKey: row.runtimeInstanceKey, stateVersion: row.basisStateVersion, updatedAt: row.basisUpdatedAt,
      status: 'ACTIVE', executionStatus: 'IDLE', framework_state: { lifecycle: { stage: 'DRAFT' } } }
    proof.rootHash = snapshotHash(root)
    state = { row, root, auditFailure: false, loseCas: false, audits: new Map([
      [String(row.admissionAuditId), signedShape(row, 'QUEUED', row.admissionAuditId)],
      [String(row.startAuditId), signedShape(row, 'RUNNING', row.startAuditId)],
    ]) }
    args = { runId: row.runId, runtimeInstanceId: String(row.runtimeInstanceId), actorUserId: String(row.actorUserId), proof }
    permissionSnapshot.mockReset().mockResolvedValue({ isActive: true, user: { _id: row.actorUserId },
      resolvedPermissions: { platform: { roleKeys: [], permissions: [] }, customers: [], tenants: [{
        customerId: String(row.customerId), tenantId: String(row.tenantId), permissions: ['VMF_UPDATE'], roleKeys: [],
      }] } })
    jest.spyOn(User, 'findById').mockImplementation(() => ({ maxTimeMS() { return this }, session() { return this }, lean: async () => ({ _id: row.actorUserId, isActive: true }) }))
    // Offline driver double only: no connection or server is created.
    originalReadyState = mongoose.connection._readyState
    mongoose.connection._readyState = 1
    jest.spyOn(RuntimeAcquisitionRun.collection, 'listIndexes').mockReturnValue({ toArray: async () => RuntimeAcquisitionRun.schema.indexes().map(([key, options]) => ({ key, ...options })) })
    jest.spyOn(RuntimeAcquisitionRun.collection, 'findOne').mockImplementation(async filter => String(filter.actorUserId) === String(state.row.actorUserId) ? { ...state.row } : null)
    jest.spyOn(RuntimeInstance.collection, 'findOne').mockImplementation(async () => state.root)
    jest.spyOn(RuntimeInstance.collection, 'updateOne').mockImplementation(() => { throw new Error('Recovery must never write root') })
    jest.spyOn(AuditLog, 'findOne').mockImplementation(filter => ({ setOptions: async () => state.audits.get(String(filter._id)) || null }))
    jest.spyOn(auditService, 'log').mockImplementation(async payload => {
      const audit = signedShape(state.row, payload.diff.phase, new mongoose.Types.ObjectId(), payload.diff)
      state.audits.set(String(audit._id), audit)
      if (state.auditFailure) throw new Error('Offline rejected audit dependency')
      return audit
    })
    jest.spyOn(RuntimeAcquisitionRun.collection, 'updateOne').mockImplementation(async (filter, update) => {
      if (state.loseCas || state.row.status !== filter.status || state.row.active !== filter.active) return { modifiedCount: 0 }
      state.row = { ...state.row, ...update.$set }; return { modifiedCount: 1 }
    })
    originalDb = mongoose.connection.db
    mongoose.connection.db = { admin: () => ({ command: async () => ({ ok: 1 }) }) }
    session = { active: false, inTransaction: () => session.active, endSession: jest.fn(),
      withTransaction: async work => {
        const savedRow = state.row, savedAudits = new Map(state.audits)
        session.active = true
        try { const result = await work(); session.active = false; return result }
        catch (error) { state.row = savedRow; state.audits = savedAudits; session.active = false; throw error }
      } }
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session)
  })
  afterEach(() => { env.nodeEnv = originalEnv.nodeEnv; env.appEnv = originalEnv.appEnv; mongoose.connection.db = originalDb; mongoose.connection._readyState = originalReadyState; jest.restoreAllMocks() })
  test('dry run validates the actual owner without writes', async () => {
    await expect(recoverStoppedAcquisitionRun({ ...args, dryRun: true })).resolves.toMatchObject({ status: 'RECOVERY_DRY_RUN_PASS' })
    expect(auditService.log).not.toHaveBeenCalled(); expect(RuntimeAcquisitionRun.collection.updateOne).not.toHaveBeenCalled()
  })
  test('writes an unknown unsaved terminal through native audit/CAS, then returns idempotently', async () => {
    const result = await recoverStoppedAcquisitionRun(args)
    expect(result).toMatchObject({ status: 'FAILED', canonicalSaved: false, reason: 'STOPPED_WORKER_RECOVERY' })
    expect(result.outcomes.every(item => item.reason === ORIGINAL_EXTRACTION_UNCONFIRMED && item.evidenceObjectCount === 0)).toBe(true)
    expect(permissionSnapshot).toHaveBeenCalledTimes(2)
    expect(RuntimeInstance.collection.updateOne).not.toHaveBeenCalled()
    expect(auditService.log).toHaveBeenCalledTimes(1)
    await expect(recoverStoppedAcquisitionRun(args)).resolves.toMatchObject({ status: 'FAILED', replay: true })
    expect(auditService.log).toHaveBeenCalledTimes(1)
  })
  test.each(['permission dependency', 'inactive', 'revoked in transaction', 'root changed', 'audit binding', 'missing index', 'lost CAS', 'audit rejection'])('fails closed for %s', kind => {
    if (kind === 'permission dependency') permissionSnapshot.mockRejectedValue(new Error('Permission database unavailable'))
    if (kind === 'inactive') permissionSnapshot.mockResolvedValue({ isActive: false })
    if (kind === 'revoked in transaction') permissionSnapshot.mockResolvedValueOnce(permissionSnapshot.getMockImplementation()()).mockResolvedValue({ isActive: false })
    if (kind === 'root changed') state.root.stateVersion = 'rsv2:changed'
    if (kind === 'audit binding') state.audits.get(String(state.row.startAuditId)).requestId = 'other-request'
    if (kind === 'missing index') RuntimeAcquisitionRun.collection.listIndexes.mockReturnValue({ toArray: async () => [] })
    if (kind === 'lost CAS') state.loseCas = true
    if (kind === 'audit rejection') state.auditFailure = true
    return expect(recoverStoppedAcquisitionRun(args)).rejects.toBeDefined().then(() => {
      expect(state.row.status).toBe('RUNNING'); expect(state.audits.size).toBe(2)
      expect(RuntimeInstance.collection.updateOne).not.toHaveBeenCalled()
    })
  })
})
