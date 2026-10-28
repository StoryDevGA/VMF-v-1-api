import { describe, test, expect, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Audit from '../models/AuditLog.js'
import env from '../config/env.js'
import Receipt, { assertSyntheticRevisionReceipt, syntheticRevisionReceiptType } from '../models/RuntimeSyntheticRevisionReceipt.js'
import { SYNTHETIC_REVISION_TEST_POLICY as p } from '../constants/syntheticRevisionTestPolicy.js'
import { membershipHash, membershipJson } from '../services/runtimeEvidenceSnapshotContract.js'
import { compileSyntheticRevisionBasis } from '../services/syntheticRevisionTestBasis.js'
import { inspectSyntheticRevisionDisposition, recordSyntheticRevisionDisposition, verifySyntheticRevisionForLock } from '../services/syntheticRevisionTestService.js'

test('exact new case binding preserves the original adopted amendment bytes', () => {
  const dir = '../../../docs/generated/harness-runs/ss-044/'
  const doc = readFileSync(new URL(dir + '2026-10-20-r3-test-completion-integration/scope-binding-v1.json', import.meta.url))
  expect(createHash('sha256').update(doc).digest('hex')).toBe(p.scopeBindingHash)
  const original = readFileSync(new URL(dir + '2026-10-16-synthetic-amendment-preflight/amendment-v1.json', import.meta.url))
  expect(createHash('sha256').update(original).digest('hex')).toBe(p.amendmentHash)
  expect(JSON.parse(original).scope.revision).toBe(1)
  expect(JSON.parse(doc).revision).toBe(3)
  expect(JSON.parse(doc).humanApprovalTimestamp).toBeNull()
  expect(JSON.parse(doc).humanTestDecision).toBe('NOT_SUPPLIED')
})
test('separate immutable receipt collection and scoped unique indexes do not auto-activate', () => {
  expect(Receipt.collection.name).toBe('runtime_synthetic_revision_receipts')
  expect(Receipt.schema.options.autoIndex).toBe(false)
  expect(Receipt.schema.options.autoCreate).toBe(false)
  expect(Receipt.schema.indexes().map(([key, options]) => ({ key, unique: options.unique }))).toEqual([
    { key: { customerId: 1, tenantId: 1, runtimeInstanceId: 1, kind: 1 }, unique: true },
    { key: { customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 }, unique: true },
  ])
})
test.each(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete'])('rejects immutable %s without database access', async method => {
  await expect(Receipt[method]({}, {})).rejects.toThrow('immutable')
})
test('rejects bulk mutations and invalid save even when validation is disabled', async () => {
  await expect(Receipt.bulkWrite([{ deleteOne: { filter: {} } }])).rejects.toThrow('immutable')
  await expect(new Receipt({}).save({ validateBeforeSave: false })).rejects.toThrow()
})
test('production and unconnected storage reject before opening sessions', async () => {
  const session = jest.spyOn(mongoose, 'startSession'), old = env.appEnv
  try {
    env.appEnv = 'production'
    await expect(inspectSyntheticRevisionDisposition({})).rejects.toThrow()
    await expect(recordSyntheticRevisionDisposition({})).rejects.toThrow()
    expect(session).not.toHaveBeenCalled()
  } finally { env.appEnv = old; session.mockRestore() }
})
test('unrelated runtimes cannot consume an R3 test completion', async () => {
  await expect(verifySyntheticRevisionForLock({ _id: p.parentRuntimeId }, null)).resolves.toBeNull()
})

const cachePath = process.env.VMF_R3_TEST_BASIS_CACHE
const cached = cachePath ? describe : describe.skip
cached('cached actual qualified R3 population (no database connection)', () => {
  const fixture = () => mongoose.mongo.BSON.EJSON.parse(readFileSync(cachePath, 'utf8'), { relaxed: true })
  const read = cache => async (name, filter, _session, cap) => {
    const exact = cache.reads.find(r => r.collection === name && membershipHash(r.filter) === membershipHash(filter))
    if (!exact) throw new Error('Unexpected cached query')
    expect(exact.rows.length).toBeLessThanOrEqual(cap)
    return exact.rows
  }
  const bodyRecord = (cache, disposition = 'REOPENED') => {
    const input = { requestKey: randomUUID(), expectedBasisHash: cache.basis.materialHash,
      expectedUpdatedAt: cache.basis.updatedAt, disposition,
      rationale: 'Engineering fixture input only; not an actual human disposition.',
      amendmentDocumentText: readFileSync(new URL('../../../docs/generated/harness-runs/ss-044/2026-10-16-synthetic-amendment-preflight/amendment-v1.json', import.meta.url), 'utf8'),
      decisionSource: { reference: 'engineering-component-fixture-only', text: 'This is a test input, not an actual Angus or Andrew decision.', decidedAt: new Date().toISOString() },
      conflictDisclosed: true, recorderAttestsDecision: true, confirm: true }
    const body = membershipJson({ version: 1, classification: p.classification, authoritative: false, policyReference: p.reference,
      amendmentHash: p.amendmentHash, scopeBindingHash: p.scopeBindingHash, kind: 'DISPOSITION', receiptType: syntheticRevisionReceiptType('DISPOSITION'),
      receiptId: randomUUID(), requestKey: input.requestKey, payloadHash: membershipHash({ kind: 'DISPOSITION', input, actorUserId: p.recorderUserId }),
      createdAt: new Date().toISOString(), recorderUserId: p.recorderUserId, decisionMaker: { name: 'Angus Gregory', role: 'StorylineOS Product Owner',
        independent: false, dualRoleDisclosed: true, nativeUserId: null }, basis: cache.basis, input, dispositionLink: null })
    return { customerId: p.customerId, tenantId: p.tenantId, runtimeInstanceId: p.runtimeInstanceId, kind: body.kind,
      receiptId: body.receiptId, requestKey: body.requestKey, payloadHash: body.payloadHash, body, bodyHash: membershipHash(body) }
  }
  test('full maintained mapper/history verifies actual root and typed population; both pair hashes remain explicit', async () => {
    const cache = fixture(), before = membershipHash(cache)
    expect(await compileSyntheticRevisionBasis(cache.root, null, { readRows: read(cache) })).toEqual(cache.basis)
    expect(cache.basis.manifest.rootEvidencePairHash).toBe(p.rootEvidencePairHash)
    expect(cache.basis.manifest.typedEvidencePairHash).not.toBe(p.rootEvidencePairHash)
    expect(cache.basis.materialHash).toBe(p.initialMaterialHash)
    expect(membershipHash(cache)).toBe(before)
  })
  test.each(['NOT_CONTRADICTORY', 'CONFIRMED', 'REOPENED'])('persists no predetermined disposition: valid explicit %s contract', disposition => {
    expect(assertSyntheticRevisionReceipt(bodyRecord(fixture(), disposition)).input.disposition).toBe(disposition)
  })
  test.each(['classification', 'authoritative', 'policyReference', 'amendmentHash', 'scopeBindingHash', 'recorderUserId', 'receiptType'])('rehashed receipt rejects forged %s', field => {
    const record = bodyRecord(fixture()); record.body[field] = field === 'authoritative' ? true : 'forged'
    record.bodyHash = membershipHash(record.body)
    expect(() => assertSyntheticRevisionReceipt(record)).toThrow()
  })
  test.each(['qualifications', 'source', 'section', 'history', 'type', 'membership', 'scope', 'rootPair'])('fails closed for changed %s without mutating cached source', async kind => {
    const c = fixture(), rows = c.reads.find(r => r.collection === 'runtime_evidence_objects').rows
    if (kind === 'qualifications') rows.find(e => e.draftQualification).draftQualification.facts.scope = 'forged'
    if (kind === 'source') c.reads.find(r => r.collection === 'runtime_evidence_sources').rows[0].sourceRef = 'forged'
    if (kind === 'section') c.reads.find(r => r.collection === 'runtime_section_states').rows[0].evidenceRefs = ['forged']
    if (kind === 'history') c.root.framework_state.evidence_pack.contradictionReviews = []
    if (kind === 'type') rows[0].sourceType = 'PUBLIC_RESEARCH'
    if (kind === 'membership') rows.pop()
    if (kind === 'scope') c.root.tenantId = new mongoose.Types.ObjectId()
    if (kind === 'rootPair') c.root.framework_state.evidence_pack.discoveryHealth.contradictionCandidates[0].domain = 'forged'
    await expect(compileSyntheticRevisionBasis(c.root, null, { readRows: read(c) })).rejects.toThrow()
  })
  test('new lifecycle state versions require signed provenance as well as current typed projections', async () => {
    const c = fixture(), old = c.root.stateVersion, next = `rsv2:${randomUUID()}`
    c.root.stateVersion = next; c.root.updatedAt = new Date(); c.root.framework_state.lifecycle.stage = 'PUBLISHED'
    for (const r of c.reads) {
      if (r.filter.stateVersion !== old) continue
      r.filter.stateVersion = next
      for (const row of r.rows) {
        row.stateVersion = next; row.sourceStateVersion = next
        if (row.projectionReceipt) row.projectionReceipt.stateVersion = next
      }
    }
    const reader = read(c)
    await expect(compileSyntheticRevisionBasis(c.root, null, { readRows: async (name, ...rest) => name === 'auditlogs' ? [] : reader(name, ...rest) })).rejects.toThrow()
    const a = new Audit({ actorUserId: p.recorderUserId, action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance',
      resourceId: p.runtimeInstanceId, scope: Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey'].map(k => [k, p[k]])),
      diff: { actionKey: 'PUBLISH', syntheticTestStateTransition: { from: old, to: next },
        updatedAtBefore: p.initialUpdatedAt, updatedAtAfter: c.root.updatedAt.toISOString(), runtimeStateSource: { sourceSetHash: 'component-fixture' } } })
    a.generateSignature()
    const signedReader = async (name, ...rest) => name === 'auditlogs' ? [a.toObject()] : reader(name, ...rest)
    const result = await compileSyntheticRevisionBasis(c.root, null, { readRows: signedReader })
    expect(result.stateVersion).toBe(next)
    expect(result.materialHash).toBe(p.initialMaterialHash)
    c.reads.find(r => r.collection === 'runtime_evidence_objects').rows[0].sourceStateVersion = old
    await expect(compileSyntheticRevisionBasis(c.root, null, { readRows: signedReader })).rejects.toThrow()
  })
  test('mixed canonical and compatibility state versions fail closed', async () => {
    const c = fixture(); c.root.runtimeStateVersion = `rsv2:${randomUUID()}`
    await expect(compileSyntheticRevisionBasis(c.root, null, { readRows: read(c) })).rejects.toMatchObject({ code: 'RUNTIME_STATE_VERSION_MIXED' })
  })
})
