import { describe, test, expect, jest } from '@jest/globals'
import mongoose from 'mongoose'
import AuditLog from '../models/AuditLog.js'
import { prepareRuntimeEvidenceSnapshot, verifyRuntimeEvidenceSnapshotDocument } from '../services/runtimeEvidenceSnapshotService.js'

const fixture = async () => {
  const oid = n => new mongoose.Types.ObjectId(String(n).padStart(24, '0'))
  const at = '2026-10-28T12:00:00.000Z'
  const runtime = { _id: oid(1), customerId: oid(2), tenantId: oid(3), runtimeInstanceKey: 'snapshot-signature-unit',
    workspaceId: '', revision: { revisionNumber: 1 }, packageId: oid(4), packageKey: 'snapshot-fixture', packageVersion: '1.0',
    dependencyLockId: 'fixture-dependency', activationId: 'fixture-activation', deploymentId: 'fixture-deployment',
    stateVersion: 'rsv2:00000000-0000-4000-8000-000000000001', status: 'LOCKED', lockedAt: new Date(at), lockedBy: oid(9),
    framework_state: { lock: { locked: true, snapshot: { snapshotId: 'fixture-truth-lock', snapshotHash: 'a'.repeat(64),
      snapshotAt: at, contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' } } } }
  const common = { customerId: runtime.customerId, tenantId: runtime.tenantId, runtimeInstanceId: runtime._id,
    runtimeInstanceKey: runtime.runtimeInstanceKey, stateVersion: runtime.stateVersion, sourceStateVersion: runtime.stateVersion,
    sourceHash: 'sha256:' + 'b'.repeat(64), migrationReceiptId: oid(5), current: true, createdAt: new Date(at), updatedAt: new Date(at) }
  const rows = {
    sources: [{ ...common, _id: oid(6), sourceId: 'source-1', contentHash: 'sha256:' + 'c'.repeat(64) }],
    evidence: [{ ...common, _id: oid(7), evidenceObjectId: 'evidence-1', sourceId: 'source-1',
      extractedFact: 'Synthetic evidence only.', reviewStatus: 'ACCEPTED' }],
    sections: [{ ...common, _id: oid(8), sectionKey: 'output_requirements', sectionDetail: { accepted: {} } }],
  }
  const readRows = jest.fn(async kind => rows[kind])
  const prepared = await prepareRuntimeEvidenceSnapshot({ runtime, session: { inTransaction: () => true }, deps: { readRows } })
  const audit = new AuditLog({ actorUserId: oid(9), action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
    resourceId: runtime._id, scope: { customerId: runtime.customerId, tenantId: runtime.tenantId,
      runtimeInstanceId: runtime._id, runtimeInstanceKey: runtime.runtimeInstanceKey },
    diff: { actionKey: 'LOCK_RECORD', actionedAt: at, evidenceMembershipSnapshot: { ...prepared.pointer, counts: prepared.body.counts } } })
  audit.generateSignature()
  const doc = { ...prepared.body.scope, ...prepared.pointer, body: prepared.body, createdBy: oid(9), createdAt: at,
    lockAuditId: audit._id, lockAuditSignatureVersion: audit.signatureVersion }
  const onVerifiedMembership = jest.fn()
  const verify = raw => verifyRuntimeEvidenceSnapshotDocument({ runtime, pointer: prepared.pointer, doc,
    deps: { readRows, readAudit: async () => raw, onVerifiedMembership } })
  return { audit, verify, onVerifiedMembership }
}

describe('ordinary frozen snapshot audit signature', () => {
  test('verifies the real model signature before forwarding membership', async () => {
    const f = await fixture()
    await expect(f.verify(f.audit.toObject())).resolves.toMatchObject({ completeness: 'VERIFIED' })
    expect(f.onVerifiedMembership).toHaveBeenCalledTimes(1)
  })
  test.each(['missing', 'tampered', 'signed-material-changed'])('rejects %s without forwarding membership', async kind => {
    const f = await fixture(), raw = f.audit.toObject()
    if (kind === 'missing') delete raw.signature
    else if (kind === 'tampered') raw.signature = '0'.repeat(64)
    else raw.diff.unverifiedExtraField = 'Changed after signing'
    await expect(f.verify(raw)).rejects.toMatchObject({ code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID',
      details: { reason: 'AUDIT_SIGNATURE_INVALID' } })
    expect(f.onVerifiedMembership).not.toHaveBeenCalled()
  })
})
