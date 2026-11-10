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
  return { runtime, rows, prepared, doc, audit, verify, onVerifiedMembership }
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

describe('bounded native frozen-membership family responses', () => {
  const families = { runtime_evidence_sources: ['sources', 'sourceId', 1000],
    runtime_evidence_objects: ['evidence', 'evidenceObjectId', 5000], runtime_section_states: ['sections', 'sectionKey', 100] }
  const withNativeRows = async (f, { counts = {}, returned = {} } = {}, work) => {
    const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'db')
    const collections = Object.fromEntries(Object.entries(families).map(([name, [kind]]) => {
      const cursor = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(Object.hasOwn(returned, kind) ? returned[kind] : f.rows[kind]) }
      return [name, { cursor, countDocuments: jest.fn().mockResolvedValue(Object.hasOwn(counts, kind) ? counts[kind] : f.rows[kind].length),
        find: jest.fn(() => cursor) }]
    }))
    Object.defineProperty(mongoose.connection, 'db', { configurable: true, value: {
      collection: name => {
        if (!Object.hasOwn(collections, name)) throw new Error('Unexpected native test collection.')
        return collections[name]
      },
    } })
    try { return await work(collections) }
    finally {
      if (descriptor) Object.defineProperty(mongoose.connection, 'db', descriptor)
      else delete mongoose.connection.db
    }
  }
  test('preparation counts and reads the same bounded snapshot before building its full body', async () => {
    const f = await fixture(), session = { inTransaction: () => true }
    await withNativeRows(f, {}, async collections => {
      const prepared = await prepareRuntimeEvidenceSnapshot({ runtime: f.runtime, session })
      expect(prepared.body.counts).toEqual({ sources: 1, evidence: 1, sections: 1 })
      for (const [name, [, key, limit]] of Object.entries(families)) {
        const selected = collections[name], [filter, options] = selected.find.mock.calls[0]
        expect(selected.countDocuments).toHaveBeenCalledWith(filter, { session, maxTimeMS: 2000, limit: limit + 1 })
        expect(selected.countDocuments.mock.invocationCallOrder[0]).toBeLessThan(selected.find.mock.invocationCallOrder[0])
        expect(filter).toMatchObject({ runtimeInstanceId: f.runtime._id, current: true, stateVersion: f.runtime.stateVersion })
        expect(options).toEqual({ session, maxTimeMS: 2000, singleBatch: true, batchSize: limit + 1 })
        expect(options).not.toHaveProperty('timeoutMS')
        expect(selected.cursor.sort).toHaveBeenCalledWith({ [key]: 1, _id: 1 })
        expect(selected.cursor.limit).toHaveBeenCalledWith(limit + 1)
      }
    })
  })
  test.each([-1, NaN, 0.5, undefined, 1001])('invalid or excessive native preparation count %s cannot become a smaller freeze', async count => {
    const f = await fixture()
    await withNativeRows(f, { counts: { sources: count } }, async collections => {
      await expect(prepareRuntimeEvidenceSnapshot({ runtime: f.runtime, session: { inTransaction: () => true } }))
        .rejects.toMatchObject({ status: 409, code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID', details: { reason: 'MEMBER_BOUND' } })
      expect(collections.runtime_evidence_sources.find).not.toHaveBeenCalled()
    })
  })
  test('a partial preparation response rejects instead of returning an incomplete body', async () => {
    const f = await fixture()
    await withNativeRows(f, { returned: { evidence: [] } }, async () => {
      await expect(prepareRuntimeEvidenceSnapshot({ runtime: f.runtime, session: { inTransaction: () => true } }))
        .rejects.toMatchObject({ status: 409, code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID', details: { reason: 'MEMBER_BOUND' } })
    })
  })
  test('a rejected preparation count remains a rejected dependency', async () => {
    const f = await fixture(), failure = new Error('Synthetic count unavailable.')
    await withNativeRows(f, {}, async collections => {
      collections.runtime_evidence_sources.countDocuments.mockRejectedValue(failure)
      await expect(prepareRuntimeEvidenceSnapshot({ runtime: f.runtime, session: { inTransaction: () => true } })).rejects.toBe(failure)
      expect(collections.runtime_evidence_sources.find).not.toHaveBeenCalled()
    })
  })
  test('recorded-ID verification retains its budget and adds no preparation counts', async () => {
    const f = await fixture(), session = { inTransaction: () => true }, readBudget = jest.fn(() => ({ maxTimeMS: 137 }))
    await withNativeRows(f, {}, async collections => {
      await expect(verifyRuntimeEvidenceSnapshotDocument({ runtime: f.runtime, pointer: f.prepared.pointer, doc: f.doc,
        session, readBudget, deps: { readAudit: async () => f.audit.toObject() } })).resolves.toMatchObject({ completeness: 'VERIFIED' })
      for (const [name, [, , limit]] of Object.entries(families)) {
        expect(collections[name].countDocuments).not.toHaveBeenCalled()
        expect(collections[name].find.mock.calls[0][1]).toEqual({ session, maxTimeMS: 137, singleBatch: true, batchSize: limit + 1 })
      }
    })
  })
  test('a partial recorded-ID response fails MEMBER_MISSING without forwarding verified membership', async () => {
    const f = await fixture(), onVerifiedMembership = jest.fn()
    await withNativeRows(f, { returned: { evidence: [] } }, async collections => {
      await expect(verifyRuntimeEvidenceSnapshotDocument({ runtime: f.runtime, pointer: f.prepared.pointer, doc: f.doc,
        deps: { readAudit: async () => f.audit.toObject(), onVerifiedMembership } })).rejects.toMatchObject({
        status: 409, code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID', details: { reason: 'MEMBER_MISSING' },
      })
      expect(onVerifiedMembership).not.toHaveBeenCalled()
      for (const selected of Object.values(collections)) expect(selected.countDocuments).not.toHaveBeenCalled()
    })
  })
})
