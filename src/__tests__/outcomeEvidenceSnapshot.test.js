import { beforeAll, describe, expect, jest, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { assembleOutcomeEvidenceInventory, assertOutcomeEvidenceInventory, snapshotHash, isOutcomeContextMetadataReference,
  assertOutcomeSupplementalFinding, isOutcomeSourceMetadataReference, assertOutcomeRecordedFinding } from '../utils/outcomeEvidenceSnapshot.js'
import { getDiscoveryContradictionReview } from '../services/discoveryContradictionReviewService.js'
import { projectOutcomeStudioBusinessFactLedger } from '../services/outcomeStudioEvidenceCompositionService.js'
import { compileEvidenceToMeaningContract } from '../services/outcomeEvidenceToMeaningContractService.js'
import { makeSs041Fixture } from './fixtures/outcomeEvidenceToDraftFixtures.js'
import { buildSourceCapture, buildEvidenceSupport, sourceEvidenceHash, assertSourceEvidenceMetadataPairs } from '../services/sourceEvidenceContract.js'
import { acquireWebsiteDiscoveryEvidence, normalizeDiscoveryEvidenceObjects, buildDiscoverySourceRegistry } from '../services/discoveryIntelligenceService.js'
import { createRuntimeStateLegacySourceRowSet } from '../services/runtimeStateLegacyMapper.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import { buildRuntimeSectionEvidenceQualifications } from '../services/runtimeSectionEvidenceQualificationService.js'
import mongoose from 'mongoose'
import RuntimeEvidenceSnapshot from '../models/RuntimeEvidenceSnapshot.js'
import { buildEvidenceMembershipBody, evidenceMaterialHash, membershipHash, EVIDENCE_MEMBERSHIP_VERSION } from '../services/runtimeEvidenceSnapshotContract.js'
import { prepareRuntimeEvidenceSnapshot, persistRuntimeEvidenceSnapshot, readVerifiedRuntimeEvidenceSnapshot, verifyRuntimeEvidenceSnapshotDocument,
  projectPublicEvidenceSnapshotInventory } from '../services/runtimeEvidenceSnapshotService.js'

describe('snapshot correction public error and inventory compatibility only', () => {
  const resolveCorrection = jest.fn()
  beforeAll(() => {
    // Only this wrapper seam is simulated. Real attestation and historical
    // membership verification belong to the isolated persistence suite.
    jest.unstable_mockModule('../services/runtimeEvidenceSnapshotRecoveryService.js', () => ({ resolveRuntimeEvidenceSnapshotCorrection: resolveCorrection }))
  })
  const readArgs = () => ({
    runtime: { _id: '6ace5ee09bd4472c6be0cb07', customerId: '6a6c75f2cace7a21bd41ef98', tenantId: '6a6c76e3cace7a21bd41eff9',
      runtimeInstanceKey: 'ss044-disposable-synthetic-20261013-r1', revision: { revisionNumber: 1 } },
    pointer: { snapshotId: 'evidence_snapshot_f8546faf-bdde-4453-8ae8-38c5bfa9c733' }, session: { testSessionIdentity: true }, readBudget: jest.fn(),
    deps: { readSnapshots: async () => [{ _id: '6ad267752b7668e0c1ae01af' }] },
  })
  test('only internal provenance is omitted without changing inventory fields or input', () => {
    const ordinary = { available: true, completeness: 'VERIFIED', reason: null, contractVersion: 'runtime-evidence-membership.v1',
      snapshotId: 'evidence_snapshot_f8546faf-bdde-4453-8ae8-38c5bfa9c733', membershipHash: 'a'.repeat(64), basisStateVersion: 'state',
      lockSnapshotId: 'lock', lockSnapshotHash: 'b'.repeat(64), revisionNumber: 1, counts: { sources: 8, evidence: 47, sections: 6 },
      verification: { auditLinkVerified: true } }
    const internal = Object.freeze({ ...ordinary, serializationCorrection: { receiptId: 'recovery-provenance' } })
    expect(projectPublicEvidenceSnapshotInventory(internal)).toEqual(ordinary)
    expect(projectPublicEvidenceSnapshotInventory(ordinary)).toEqual(ordinary)
    expect(internal.serializationCorrection).toEqual({ receiptId: 'recovery-provenance' })
  })
  test('known correction rejection becomes ordinary unavailable membership error', async () => {
    resolveCorrection.mockReset().mockRejectedValue(Object.assign(new Error('Correction missing'), {
      code: 'SNAPSHOT_RECOVERY_INVALID', details: { reason: 'CORRECTION_REQUIRED' },
    }))
    const args = readArgs()
    await expect(readVerifiedRuntimeEvidenceSnapshot(args)).rejects.toMatchObject({ code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID', details: { reason: 'CORRECTION_REQUIRED' } })
    expect(resolveCorrection).toHaveBeenCalledWith(expect.objectContaining({ session: args.session, readBudget: args.readBudget }))
  })
  test.each(['DB_DEPENDENCY_REJECTED', 'READ_DEADLINE_EXCEEDED'])('unknown %s errors retain original failure identity', async code => {
    const error = Object.assign(new Error('Dependency failed'), { code })
    resolveCorrection.mockReset().mockRejectedValue(error)
    await expect(readVerifiedRuntimeEvidenceSnapshot(readArgs())).rejects.toBe(error)
  })
})

const scope = { customerId: 'customer', tenantId: 'tenant', runtimeInstanceId: 'runtime', stateVersion: 'version' }
const fixture = (size) => {
  const evidence = Array.from({ length: size }, (_, index) => ({ ...scope,
    _id: String(index).padStart(6, '0'), evidenceObjectId: `evidence-${index}`, sourceId: 'source',
    extractedFact: `Stored fact ${index}`, proofDependency: [] }))
  const sources = [{ ...scope, _id: 'source-row', sourceId: 'source' }]
  const rows = { evidence, sources }
  return { evidence, args: { scope, sections: [{ sectionKey: 'section', references: size ? ['evidence-0'] : [] }],
    readPage: jest.fn(async (kind, after, limit) => rows[kind].filter((row) => after === null || row._id > after).slice(0, limit)),
    count: jest.fn(async (kind) => rows[kind].length), validateRows: (kind, page) => {
      if (page.some((row) => row.customerId !== scope.customerId || row.tenantId !== scope.tenantId
        || row.runtimeInstanceId !== scope.runtimeInstanceId)) throw Object.assign(new Error('Scope mismatch'), { code: 'SCOPE_MISMATCH' })
    } } }
}
describe('complete evidence inventory with governed projection', () => {
  test('recorded source/support metadata changes member, page and overall hashes without changing the snapshot algorithm', async () => {
    const baseline = fixture(1), original = await assembleOutcomeEvidenceInventory(baseline.args)
    const captureText = 'The fictional pilot reviewer has not approved the trial.'
    const sourceCapture = buildSourceCapture({ sourceId: 'source', originalContentHash: sourceEvidenceHash(captureText),
      captureText, adapter: 'document-txt-text-extraction-v1', extractionMethod: 'TEXT_NATIVE',
      capturedAt: '2026-10-14T12:00:00.000Z', inputIndex: 0 })
    const modified = fixture(1)
    modified.evidence[0].evidenceSupport = buildEvidenceSupport({ captureText, exactSegment: captureText, sourceCapture })
    const enriched = await assembleOutcomeEvidenceInventory(modified.args)
    expect(enriched.receipt.version).toBe(original.receipt.version)
    expect(enriched.receipt.collections.evidence.records[0].hash).not.toBe(original.receipt.collections.evidence.records[0].hash)
    expect(enriched.receipt.collections.evidence.pages[0].hash).not.toBe(original.receipt.collections.evidence.pages[0].hash)
    expect(enriched.receipt.overallHash).not.toBe(original.receipt.overallHash)
    const replay = await assembleOutcomeEvidenceInventory(modified.args)
    expect(replay.receipt.overallHash).toBe(enriched.receipt.overallHash)
    expect(Object.hasOwn(original.evidenceObjects[0], 'evidenceSupport')).toBe(false)
  })
  test.each([0, 499, 500, 501, 853])('completely inventories %i records without raising projected limits', async (size) => {
    const { args } = fixture(size)
    const result = await assembleOutcomeEvidenceInventory(args)
    expect(result.receipt.completeness).toBe('COMPLETE')
    expect(result.receipt.collections.evidence.totalCount).toBe(size)
    expect(result.receipt.collections.evidence.orderedIds).toHaveLength(size)
    expect(result.receipt.collections.evidence.pages).toHaveLength(Math.ceil(size / 150))
    expect(result.evidenceObjects).toHaveLength(size ? 1 : 0)
    args.readPage.mock.calls.forEach((call) => expect(call[2]).toBe(150))
    expect(() => assertOutcomeEvidenceInventory({ ...result, inventoryReceipt: result.receipt })).not.toThrow()
  })
  test('missing page preserves an incomplete receipt', async () => {
    const { args } = fixture(501); const read = args.readPage
    args.readPage = jest.fn((kind, after, limit) => kind === 'evidence' && after ? [] : read(kind, after, limit))
    await expect(assembleOutcomeEvidenceInventory(args)).rejects.toMatchObject({
      code: 'OUTCOME_EVIDENCE_SNAPSHOT_PAGE_MISSING_OR_INVALID', details: { snapshotReceipt: { completeness: 'INCOMPLETE' } } })
  })
  test('duplicate page is rejected rather than counted twice', async () => {
    const { args } = fixture(501); const read = args.readPage
    args.readPage = jest.fn((kind, after, limit) => read(kind, null, limit))
    await expect(assembleOutcomeEvidenceInventory(args)).rejects.toMatchObject({ code: 'OUTCOME_EVIDENCE_SNAPSHOT_DUPLICATE_OR_UNORDERED_RECORD' })
  })
  test('same-count evidence mutation is detected by the independent full-body re-read', async () => {
    const { args } = fixture(501); const read = args.readPage; let starts = 0
    args.readPage = jest.fn(async (kind, after, limit) => {
      if (kind === 'evidence' && !after) starts++
      const page = await read(kind, after, limit)
      return starts > 1 && kind === 'evidence' ? page.map((row) => ({ ...row, extractedFact: 'changed' })) : page
    })
    await expect(assembleOutcomeEvidenceInventory(args)).rejects.toMatchObject({ code: 'OUTCOME_EVIDENCE_SNAPSHOT_RECORDS_CHANGED' })
  })
  test.each(['customerId', 'tenantId', 'runtimeInstanceId'])('rejects %s mismatch even on unselected evidence', async (field) => {
    const { args, evidence } = fixture(501); evidence[499][field] = 'outside'
    await expect(assembleOutcomeEvidenceInventory(args)).rejects.toMatchObject({ code: 'OUTCOME_EVIDENCE_SNAPSHOT_SCOPE_MISMATCH' })
  })
  test('retries produce identical manifests and projection hashes', async () => {
    const { args } = fixture(853)
    expect(await assembleOutcomeEvidenceInventory(args)).toEqual(await assembleOutcomeEvidenceInventory(args))
  })
  test('source references and original resolvable proof dependencies extend section closure', async () => {
    const { args, evidence } = fixture(501); evidence[0].proofDependency = ['evidence-500', 'economics']
    const result = await assembleOutcomeEvidenceInventory(args)
    expect(result.evidenceObjects.map((row) => row.evidenceObjectId)).toEqual(['evidence-0', 'evidence-500'])
    expect(result.evidenceObjects[0].proofDependency).toEqual(['evidence-500', 'economics'])
  })
  test('unresolved section reference remains distinct from complete inventory', async () => {
    const { args } = fixture(853); args.sections[0].references.push('missing')
    const result = await assembleOutcomeEvidenceInventory(args)
    expect(result.receipt).toMatchObject({ completeness: 'COMPLETE', sectionReadiness: 'UNRESOLVED' })
    expect(result.receipt.sectionCoverage[0].missingReferences).toEqual(['missing'])
    expect(() => assertOutcomeEvidenceInventory({ ...result, inventoryReceipt: result.receipt })).not.toThrow()
  })
  test.each(['added', 'omitted', 'changed', 'page-missing'])('compiler validation rejects %s projected record or page', async (mutation) => {
    const { args, evidence } = fixture(853); const result = await assembleOutcomeEvidenceInventory(args)
    const snapshot = { evidenceObjects: result.evidenceObjects, sourceRegistry: result.sourceRegistry, inventoryReceipt: result.receipt }
    if (mutation === 'added') snapshot.evidenceObjects.push(evidence[500])
    if (mutation === 'omitted') snapshot.evidenceObjects = []
    if (mutation === 'changed') snapshot.evidenceObjects[0].extractedFact = 'changed'
    if (mutation === 'page-missing') {
      snapshot.inventoryReceipt.collections.evidence.pages.pop()
      const { overallHash, ...body } = snapshot.inventoryReceipt
      snapshot.inventoryReceipt.overallHash = snapshotHash(body)
    }
    expect(() => assertOutcomeEvidenceInventory(snapshot)).toThrow()
  })
  test.each(['proofReferences', 'sourceReference', 'storageId', 'sectionSnapshot'])('rejects rehashed %s metadata rather than losing proof or coverage', async (field) => {
    const { args, evidence } = fixture(853)
    evidence[0].proofDependency = ['evidence-500']
    const result = await assembleOutcomeEvidenceInventory(args)
    const snapshot = { evidenceObjects: result.evidenceObjects, sourceRegistry: result.sourceRegistry, inventoryReceipt: result.receipt }
    const receipt = result.receipt
    if (field === 'proofReferences') {
      receipt.collections.evidence.records[0].proofReferences = []
      receipt.selectedEvidenceIds = ['evidence-0']
      snapshot.evidenceObjects = snapshot.evidenceObjects.filter((row) => row.evidenceObjectId === 'evidence-0')
    } else if (field === 'sectionSnapshot') receipt.sectionCoverage[0].references = ['evidence-500']
    else receipt.collections.evidence.records[0][field] = 'forged'
    for (const collection of Object.values(receipt.collections)) {
      let offset = 0
      for (const page of collection.pages) { page.hash = snapshotHash(collection.records.slice(offset, offset + page.ids.length)); offset += page.ids.length }
    }
    const { overallHash, ...body } = receipt
    receipt.overallHash = snapshotHash(body)
    expect(() => assertOutcomeEvidenceInventory(snapshot)).toThrow()
  })

})

// Controlled native metadata fixtures: no database, provider or ARL verdict.
const membershipFixture = () => {
  const oid = n => new mongoose.Types.ObjectId(String(n).padStart(24, '0'))
  const state = 'rsv2:123e4567-e89b-42d3-a456-426614174000'
  const at = '2026-10-14T12:00:00.000Z'
  const runtime = { _id: oid(1), customerId: oid(2), tenantId: oid(3), runtimeInstanceKey: 'controlled-r1',
    workspaceId: '', revision: { revisionNumber: 1 }, packageId: oid(4), packageKey: 'controlled-package', packageVersion: '1.0',
    dependencyLockId: 'dependency-1', activationId: 'activation-1', deploymentId: 'deployment-1', stateVersion: state,
    status: 'LOCKED', lockedAt: new Date(at), lockedBy: oid(9), framework_state: { lock: { locked: true, snapshot: {
      snapshotId: 'truth-lock-1', snapshotHash: 'a'.repeat(64), snapshotAt: at, contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' } } } }
  const common = { customerId: runtime.customerId, tenantId: runtime.tenantId, runtimeInstanceId: runtime._id,
    runtimeInstanceKey: runtime.runtimeInstanceKey, stateVersion: state, sourceStateVersion: state,
    sourceHash: 'sha256:' + 'b'.repeat(64), migrationReceiptId: oid(5), current: true, createdAt: new Date(at), updatedAt: new Date(at) }
  const rows = { sources: [{ ...common, _id: oid(6), sourceId: 'source-1', contentHash: 'sha256:' + 'c'.repeat(64) }],
    evidence: [{ ...common, _id: oid(7), evidenceObjectId: 'evidence-1', sourceId: 'source-1', extractedFact: 'A fictional trial remains pending.', reviewStatus: 'ACCEPTED' }],
    sections: [{ ...common, _id: oid(8), sectionKey: 'section-1', sectionDetail: { accepted: { evidenceRefs: ['source-1'] } } }] }
  const session = { inTransaction: () => true }
  return { runtime, rows, session, oid, at }
}
const contextMembershipFixture = () => {
  const f = membershipFixture(), detail = f.rows.sections[0].sectionDetail
  detail.input = '  Describe the bounded trial without claiming approval.  '
  detail.accepted.supportingEvidenceRefs = ['section_input', 'scoped_view', 'source-1']
  detail.intelligence = {
    supportingEvidence: [
      { label: 'Customer section context', refKey: 'section_input', sourceType: 'USER_CONTEXT', summary: detail.input.trim() },
      { label: 'Section-scoped evidence view', refKey: 'scoped_view', sourceType: 'DISCOVERY', summary: 'A fictional trial remains pending.' },
    ],
    scopedEvidence: { evidenceHash: 'd'.repeat(64), projection: { status: 'pending' }, sourceRefs: [
      { label: 'Customer section context', refKey: 'section_input', type: 'USER_CONTEXT', safeDisplay: detail.input.trim() },
      { label: 'Section-scoped evidence view', refKey: 'scoped_view', type: 'DISCOVERY_FIELD', safeDisplay: 'A fictional trial remains pending.' },
    ] },
  }
  return f
}
describe('future LOCK immutable evidence membership', () => {
  const prepare = f => prepareRuntimeEvidenceSnapshot({ runtime: f.runtime, session: f.session,
    snapshotId: 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174000', deps: { readRows: async kind => f.rows[kind] } })
  test('freezes exact post-rollover rows and retains source-ID reference aliases', async () => {
    const f = membershipFixture(), before = membershipHash(f.rows), p = await prepare(f)
    expect(p.body.basisStateVersion).toBe(f.runtime.stateVersion)
    expect(p.body.sections[0].references).toEqual({ evidenceRefs: ['source-1'] })
    expect(p.body.sections[0].resolvedEvidenceIds).toEqual(['evidence-1'])
    expect(p.body.evidence[0]).not.toHaveProperty('proofDependency')
    expect(p.pointer.lockSnapshotHash).toBe('a'.repeat(64))
    expect(p.pointer.membershipHash).not.toBe(p.pointer.lockSnapshotHash)
    expect(membershipHash(f.rows)).toBe(before)
    expect(p.pointer.membershipHash).toBe('ee87a7d12cc2ad01f51b670312c2bcb47f452c2a4a0c7f24f8805d5db594c970')
    expect(p.body.sections[0]).not.toHaveProperty('contextBindings')
  })
  test.each(['unknown', 'missing-support', 'missing-mirror', 'duplicate-support', 'duplicate-mirror', 'blank', 'type', 'mirror-type', 'summary', 'label', 'input', 'collision', 'evidenceRefs', 'proofDependency'])('rejects unresolved or ambiguous native context: %s', async kind => {
    const f = contextMembershipFixture(), detail = f.rows.sections[0].sectionDetail
    const support = detail.intelligence.supportingEvidence, mirrors = detail.intelligence.scopedEvidence.sourceRefs
    if (kind === 'unknown') detail.accepted.supportingEvidenceRefs.push('unknown_context')
    if (kind === 'missing-support') support.shift()
    if (kind === 'missing-mirror') mirrors.shift()
    if (kind === 'duplicate-support') support.push({ ...support[0] })
    if (kind === 'duplicate-mirror') mirrors.push({ ...mirrors[0] })
    if (kind === 'blank') support[0].summary = mirrors[0].safeDisplay = ' '
    if (kind === 'type') support[0].sourceType = 'DISCOVERY'
    if (kind === 'mirror-type') mirrors[1].type = 'USER_CONTEXT'
    if (kind === 'summary') mirrors[0].safeDisplay = 'Different input'
    if (kind === 'label') mirrors[0].label = 'Other section'
    if (kind === 'input') detail.input = 'Different input'
    if (kind === 'collision') f.rows.evidence[0].evidenceObjectId = 'section_input'
    if (kind === 'evidenceRefs') detail.accepted.evidenceRefs.push('section_input')
    if (kind === 'proofDependency') f.rows.evidence[0].proofDependency = ['scoped_view']
    await expect(prepare(f)).rejects.toMatchObject({ code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID' })
  })
  test.each([0, 1])('rejects matching but foreign labels for native context %s', async index => {
    const f = contextMembershipFixture(), intelligence = f.rows.sections[0].sectionDetail.intelligence
    intelligence.supportingEvidence[index].label = intelligence.scopedEvidence.sourceRefs[index].label = 'Foreign label'
    await expect(prepare(f)).rejects.toMatchObject({ details: { reason: 'CONTEXT_REFERENCE_MISMATCH' } })
  })
  test('genuine empty native families retain zero counts, missing families reject', async () => {
    const f = membershipFixture(); f.rows = { sources: [], evidence: [], sections: [] }
    expect((await prepare(f)).body.counts).toEqual({ sources: 0, evidence: 0, sections: 0 })
    f.rows.sources = undefined
    await expect(prepare(f)).rejects.toMatchObject({ details: { reason: 'MEMBER_BOUND' } })
  })
  test.each(['customerId', 'tenantId', 'runtimeInstanceId', 'stateVersion', 'sourceStateVersion'])('rejects stale or cross-scope %s before creating a receipt', async field => {
    const f = membershipFixture(); f.rows.evidence[0][field] = field.includes('Version') ? 'stale' : f.oid(99)
    await expect(prepare(f)).rejects.toMatchObject({ details: { reason: 'MEMBER_SCOPE_INVALID' } })
  })
  test.each(['reviewStatus', 'extractedFact', 'sourceId'])('material hashes retain %s', field => {
    const f = membershipFixture(), hash = evidenceMaterialHash(f.rows.evidence[0])
    expect(evidenceMaterialHash({ ...f.rows.evidence[0], [field]: 'changed' })).not.toBe(hash)
  })
  test('housekeeping changes and omitted undefined do not change material, accessors reject', () => {
    const row = membershipFixture().rows.evidence[0], expected = evidenceMaterialHash(row)
    expect(evidenceMaterialHash({ ...row, current: false, updatedAt: new Date(), __v: 9, optional: undefined })).toBe(expected)
    Object.defineProperty(row, 'unsafe', { enumerable: true, get: () => 'untrusted' })
    expect(() => evidenceMaterialHash(row)).toThrow('membership')
  })
  test('array accessors are rejected before any getter runs and hidden own keys cannot disappear', () => {
    const row = membershipFixture().rows.evidence[0], getter = jest.fn(() => 'untrusted')
    const array = []
    Object.defineProperty(array, '0', { enumerable: true, get: getter })
    expect(() => evidenceMaterialHash({ ...row, support: array })).toThrow('membership')
    expect(getter).not.toHaveBeenCalled()
    const hidden = ['ordinary']
    Object.defineProperty(hidden, 'hidden', { value: 'must not disappear' })
    expect(() => evidenceMaterialHash({ ...row, support: hidden })).toThrow('membership')
  })
  test.each(['accessor', 'unsafe', 'material'])('hidden own object %s cannot disappear from material normalization', kind => {
    const row = membershipFixture().rows.evidence[0], getter = jest.fn(() => 'must never run'), hidden = {}
    if (kind === 'accessor') Object.defineProperty(hidden, 'private', { get: getter })
    if (kind === 'unsafe') Object.defineProperty(hidden, '__proto__', { value: 'unsafe' })
    if (kind === 'material') Object.defineProperty(hidden, 'private', { value: 'hidden material' })
    expect(() => evidenceMaterialHash({ ...row, qualification: hidden })).toThrow('membership')
    expect(getter).not.toHaveBeenCalled()
    expect(evidenceMaterialHash({ ...row, optional: undefined })).toBe(evidenceMaterialHash(row))
  })
  test('all actual historical proof references resolve and missing ones reject', async () => {
    const f = membershipFixture(); f.rows.evidence[0].proofDependency = ['source-1']
    expect((await prepare(f)).body.evidence).toHaveLength(1)
    f.rows.evidence[0].proofDependency = ['missing']
    await expect(prepare(f)).rejects.toMatchObject({ details: { reason: 'REFERENCE_UNRESOLVED' } })
  })
  test('writer needs a live transaction and an actual required audit link; creates a fresh document', async () => {
    const f = membershipFixture(), p = await prepare(f), model = { create: jest.fn(async docs => docs) }
    await expect(persistRuntimeEvidenceSnapshot({ prepared: p, actorUserId: f.oid(9), audit: {}, session: f.session, deps: { model } })).rejects.toMatchObject({ details: { reason: 'AUDIT_LINK_INVALID' } })
    await expect(prepareRuntimeEvidenceSnapshot({ runtime: f.runtime, session: null })).rejects.toMatchObject({ details: { reason: 'TRANSACTION_REQUIRED' } })
    const args = { prepared: p, actorUserId: f.oid(9), audit: { id: String(f.oid(10)), signatureVersion: 3, actorUserId: { id: String(f.oid(9)) },
      action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance', resourceId: String(f.runtime._id), scope: p.body.scope,
      diff: { actionKey: 'LOCK_RECORD', actionedAt: f.at, evidenceMembershipSnapshot: { ...p.pointer, counts: p.body.counts } } }, session: f.session, deps: { model } }
    await persistRuntimeEvidenceSnapshot(args); await persistRuntimeEvidenceSnapshot(args)
    expect(model.create.mock.calls[0][0][0]).not.toBe(model.create.mock.calls[1][0][0])
    expect(model.create.mock.calls[0][0][0].body).toEqual(p.body)
  })
  const readerFixture = async (f = membershipFixture(), prepared) => {
    const p = prepared || await prepare(f)
    const doc = { ...p.body.scope, ...p.pointer, body: p.body, createdAt: new Date(f.at), createdBy: f.oid(9), lockAuditId: f.oid(10), lockAuditSignatureVersion: 3 }
    const audit = { _id: f.oid(10), actorUserId: f.oid(9), action: 'RUNTIME_ACTION_EXECUTED', resourceType: 'RuntimeInstance', resourceId: f.runtime._id,
      scope: { ...p.body.scope }, signatureVersion: 3, ts: new Date('2026-10-14T12:00:01.000Z'),
      diff: { actionKey: 'LOCK_RECORD', actionedAt: f.at, evidenceMembershipSnapshot: { ...p.pointer, counts: p.body.counts } } }
    const calls = []
    const args = { runtime: f.runtime, pointer: p.pointer, deps: { readSnapshots: async () => [doc], readAudit: async () => audit,
      readRows: async (kind, filter) => { calls.push({ kind, filter }); return f.rows[kind] } } }
    return { f, p, doc, audit, args, calls }
  }
  test('shared strict document verifier preserves ordinary native reader result and missing-material rejection', async () => {
    const { doc, args } = await readerFixture()
    expect(await verifyRuntimeEvidenceSnapshotDocument({ ...args, doc })).toEqual(await readVerifiedRuntimeEvidenceSnapshot(args))
    const bad = { ...doc, body: { ...doc.body, counts: { ...doc.body.counts, sources: 2 } } }
    await expect(verifyRuntimeEvidenceSnapshotDocument({ ...args, doc: bad })).rejects.toMatchObject({ code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID' })
  })
  test('trusted context capture occurs only after the same strict historical reader succeeds', async () => {
    const { doc, args, f } = await readerFixture(contextMembershipFixture())
    const capture = jest.fn()
    args.deps.onVerifiedMembership = capture
    await verifyRuntimeEvidenceSnapshotDocument({ ...args, doc })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0][0]).toMatchObject({ body: doc.body, observed: f.rows })
    capture.mockClear()
    args.deps.readAudit = async () => null
    await expect(verifyRuntimeEvidenceSnapshotDocument({ ...args, doc })).rejects.toThrow()
    expect(capture).not.toHaveBeenCalled()
  })
  test('binds native section contexts through prepare/model/persist/historical read without promoting them to evidence', async () => {
    const f = contextMembershipFixture(), before = membershipHash(f.rows)
    const { p, doc, audit, args } = await readerFixture(f)
    const section = p.body.sections[0]
    expect(section.contextBindings).toMatchObject({ contractVersion: 'section-context-reference.v1', references: [
      { refKey: 'scoped_view', sourceType: 'DISCOVERY', materialHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { refKey: 'section_input', sourceType: 'USER_CONTEXT', materialHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ] })
    expect(section.references.supportingEvidenceRefs).toEqual(['scoped_view', 'section_input', 'source-1'])
    expect(section.resolvedEvidenceIds).toEqual(['evidence-1'])
    expect(new RuntimeEvidenceSnapshot(doc).validateSync()).toBeUndefined()
    const model = { create: jest.fn(async docs => docs) }
    await persistRuntimeEvidenceSnapshot({ prepared: p, actorUserId: f.oid(9), audit: { ...audit, id: String(audit._id) }, session: f.session, deps: { model } })
    expect(model.create.mock.calls[0][0][0].body).toEqual(p.body)
    expect(membershipHash(f.rows)).toBe(before)
    for (const row of Object.values(f.rows).flat()) row.current = false
    expect(await readVerifiedRuntimeEvidenceSnapshot(args)).toMatchObject({ completeness: 'VERIFIED', counts: { evidence: 1, sources: 1, sections: 1 } })
  })
  test.each(['version', 'extra', 'empty', 'duplicate', 'order', 'unknown', 'type', 'hash'])('rejects malformed binding metadata before storage: %s', async kind => {
    const { doc } = await readerFixture(contextMembershipFixture())
    const binding = doc.body.sections[0].contextBindings
    if (kind === 'version') binding.contractVersion = 'unrecognised'
    if (kind === 'extra') binding.extra = true
    if (kind === 'empty') binding.references = []
    if (kind === 'duplicate') binding.references[1] = { ...binding.references[0] }
    if (kind === 'order') binding.references.reverse()
    if (kind === 'unknown') binding.references[0].refKey = 'unknown'
    if (kind === 'type') binding.references[0].sourceType = 'USER_CONTEXT'
    if (kind === 'hash') binding.references[0].materialHash = 'not-a-hash'
    doc.membershipHash = membershipHash(doc.body)
    expect(new RuntimeEvidenceSnapshot(doc).validateSync()).toBeDefined()
  })
  test('historical rebuild rejects a well-shaped forged context hash even with a matching body pointer', async () => {
    const { p, doc, audit, args } = await readerFixture(contextMembershipFixture())
    doc.body.sections[0].contextBindings.references[0].materialHash = 'e'.repeat(64)
    doc.membershipHash = p.pointer.membershipHash = membershipHash(doc.body)
    audit.diff.evidenceMembershipSnapshot.membershipHash = doc.membershipHash
    await expect(readVerifiedRuntimeEvidenceSnapshot(args)).rejects.toMatchObject({ details: { reason: 'MEMBERSHIP_CHANGED' } })
  })
  test('historical evidence-only bodies keep their declared meaning for a reserved source alias', async () => {
    const f = contextMembershipFixture()
    f.rows.evidence.push({ ...f.rows.evidence[0], _id: f.oid(11), evidenceObjectId: 'section_input' },
      { ...f.rows.evidence[0], _id: f.oid(12), evidenceObjectId: 'scoped_view' })
    const body = buildEvidenceMembershipBody({ runtime: f.runtime, lockTruthRecord: f.runtime.framework_state.lock.snapshot,
      ...f.rows, contextBindingSectionKeys: [] })
    expect(body.sections[0]).not.toHaveProperty('contextBindings')
    const p = { body, pointer: { ...(await prepare(membershipFixture())).pointer, membershipHash: membershipHash(body) } }
    const { args } = await readerFixture(f, p)
    expect(await readVerifiedRuntimeEvidenceSnapshot(args)).toMatchObject({ completeness: 'VERIFIED' })
    await expect(prepare(f)).rejects.toMatchObject({ details: { reason: 'CONTEXT_REFERENCE_AMBIGUOUS' } })
  })
  test('verifies all historical material and audit action time, independent of current flag/audit.ts', async () => {
    const { f, args, calls } = await readerFixture()
    for (const row of Object.values(f.rows).flat()) row.current = false
    const dto = await readVerifiedRuntimeEvidenceSnapshot(args)
    expect(dto).toMatchObject({ available: true, completeness: 'VERIFIED', contractVersion: EVIDENCE_MEMBERSHIP_VERSION,
      counts: { sources: 1, evidence: 1, sections: 1 }, verification: { auditLinkVerified: true } })
    expect(calls.every(call => !Object.hasOwn(call.filter, 'current') && String(call.filter.customerId) === String(f.runtime.customerId))).toBe(true)
    expect(dto).not.toHaveProperty('body'); expect(dto).not.toHaveProperty('lockAuditId')
  })
  test.each(['actor', 'action', 'resource', 'scope', 'diff', 'signature'])('writer rejects returned audit %s mismatch before persistence', async kind => {
    const { f, p, audit } = await readerFixture()
    const dto = { ...audit, id: String(audit._id) }, model = { create: jest.fn() }
    if (kind === 'actor') dto.actorUserId = f.oid(99)
    if (kind === 'action') dto.action = 'OTHER'
    if (kind === 'resource') dto.resourceId = f.oid(99)
    if (kind === 'scope') dto.scope = { ...dto.scope, tenantId: String(f.oid(99)) }
    if (kind === 'diff') dto.diff = { ...dto.diff, actionKey: 'PUBLISH' }
    if (kind === 'signature') dto.signatureVersion = 0
    await expect(persistRuntimeEvidenceSnapshot({ prepared: p, actorUserId: f.oid(9), audit: dto, session: f.session, deps: { model } }))
      .rejects.toMatchObject({ details: { reason: 'AUDIT_LINK_INVALID' } })
    expect(model.create).not.toHaveBeenCalled()
  })
  test.each(['material', 'audit-time', 'audit-scope', 'audit-diff', 'audit-id', 'audit-actor', 'created-at', 'created-by', 'lock-actor', 'package', 'pointer'])('rejects corrupted persisted %s', async kind => {
    const { f, doc, audit, args } = await readerFixture()
    if (kind === 'material') f.rows.evidence[0].extractedFact = 'changed'
    if (kind === 'audit-time') audit.diff.actionedAt = 'later'
    if (kind === 'audit-scope') audit.scope.tenantId = String(f.oid(99))
    if (kind === 'audit-diff') audit.diff.evidenceMembershipSnapshot.membershipHash = 'd'.repeat(64)
    if (kind === 'audit-id') audit._id = f.oid(99)
    if (kind === 'audit-actor') audit.actorUserId = { id: String(f.oid(99)) }
    if (kind === 'created-at') doc.createdAt = new Date('2026-10-14T12:00:01Z')
    if (kind === 'created-by') doc.createdBy = f.oid(99)
    if (kind === 'lock-actor') f.runtime.lockedBy = f.oid(99)
    if (kind === 'package') f.runtime.activationId = 'changed'
    if (kind === 'pointer') args.pointer = { ...args.pointer, extra: true }
    await expect(readVerifiedRuntimeEvidenceSnapshot(args)).rejects.toMatchObject({ code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID' })
  })
  test('model validates exact body/document hash and rejects query mutation without contacting storage', async () => {
    const f = membershipFixture(), p = await prepare(f)
    const data = { ...p.body.scope, ...p.pointer, body: p.body, createdBy: f.oid(9), createdAt: f.at, lockAuditId: f.oid(10), lockAuditSignatureVersion: 3 }
    expect(new RuntimeEvidenceSnapshot(data).validateSync()).toBeUndefined()
    expect(new RuntimeEvidenceSnapshot({ ...data, membershipHash: 'd'.repeat(64) }).validateSync()).toBeDefined()
    expect(new RuntimeEvidenceSnapshot({ ...data, snapshotId: 'evidence_snapshot_' + 'a'.repeat(36) }).validateSync()).toBeDefined()
    expect(new RuntimeEvidenceSnapshot({ ...data, createdAt: new Date('2026-10-14T12:00:01Z') }).validateSync()).toBeDefined()
    const malformed = JSON.parse(JSON.stringify(p.body))
    malformed.sections[0].references.evidenceRefs = 'source-1'
    expect(new RuntimeEvidenceSnapshot({ ...data, body: malformed, membershipHash: membershipHash(malformed) }).validateSync()).toBeDefined()
    await expect(RuntimeEvidenceSnapshot.updateOne({}, { $set: { membershipHash: 'd'.repeat(64) } })).rejects.toMatchObject({ details: { reason: 'SNAPSHOT_IMMUTABLE' } })
    await expect(RuntimeEvidenceSnapshot.bulkWrite([{ updateOne: { filter: {}, update: { $set: { body: {} } } } }])).rejects.toMatchObject({ details: { reason: 'SNAPSHOT_IMMUTABLE' } })
  })
  test('new saves with disabled validation and insert options cannot bypass body binding before storage', async () => {
    const f = membershipFixture(), p = await prepare(f)
    const data = { ...p.body.scope, ...p.pointer, body: p.body, createdBy: f.oid(9), createdAt: f.at,
      lockAuditId: f.oid(10), lockAuditSignatureVersion: 3, membershipHash: 'd'.repeat(64) }
    const insertOne = jest.spyOn(RuntimeEvidenceSnapshot.collection, 'insertOne').mockImplementation(() => { throw new Error('Unexpected storage') })
    const insertMany = jest.spyOn(RuntimeEvidenceSnapshot.collection, 'insertMany').mockImplementation(() => { throw new Error('Unexpected storage') })
    const bulk = jest.spyOn(RuntimeEvidenceSnapshot.collection, 'bulkWrite').mockImplementation(() => { throw new Error('Unexpected storage') })
    try {
      await expect(new RuntimeEvidenceSnapshot(data).save({ validateBeforeSave: false })).rejects.toMatchObject({ name: 'ValidationError' })
      await expect(RuntimeEvidenceSnapshot.insertMany([data], { lean: true })).rejects.toMatchObject({ name: 'ValidationError' })
      await expect(RuntimeEvidenceSnapshot.bulkWrite([{ insertOne: { document: data } }], { skipValidation: true })).rejects.toMatchObject({ name: 'ValidationError' })
      expect(insertOne).not.toHaveBeenCalled(); expect(insertMany).not.toHaveBeenCalled(); expect(bulk).not.toHaveBeenCalled()
    } finally { insertOne.mockRestore(); insertMany.mockRestore(); bulk.mockRestore() }
  })
  test('default model serialization preserves empty required references and the exact membership hash', async () => {
    const f = membershipFixture()
    f.rows.sections[0].sectionDetail.accepted = {}
    const p = await prepare(f)
    expect(p.body.sections[0].references).toEqual({})
    const document = new RuntimeEvidenceSnapshot({ ...p.body.scope, ...p.pointer, body: p.body,
      createdBy: f.oid(9), createdAt: f.at, lockAuditId: f.oid(10), lockAuditSignatureVersion: 3 })
    expect(document.validateSync()).toBeUndefined()
    for (const body of [document.toObject().body, JSON.parse(JSON.stringify(document)).body]) {
      expect(body.sections[0]).toHaveProperty('references', {})
      expect(body).toEqual(p.body)
      expect(membershipHash(body)).toBe(p.pointer.membershipHash)
    }
    const malformed = JSON.parse(JSON.stringify(p.body))
    delete malformed.sections[0].references
    expect(new RuntimeEvidenceSnapshot({ ...document.toObject(), body: malformed,
      membershipHash: membershipHash(malformed) }).validateSync()).toBeDefined()
  })
})

describe('Outcome frozen context and supplemental metadata transport (offline structural fixtures)', () => {
  const inventory = async (withProof = true, withFinding = false) => {
    const f = contextMembershipFixture()
    if (withFinding) f.rows.evidence.push({ ...f.rows.evidence[0], _id: f.oid(22), evidenceObjectId: 'evidence-2', extractedFact: 'A second fictional reviewer remains unknown.' })
    const body = buildEvidenceMembershipBody({ runtime: f.runtime, lockTruthRecord: f.runtime.framework_state.lock.snapshot, ...f.rows })
    const member = body.sections[0], scope = { ...body.scope, stateVersion: body.basisStateVersion }
    delete scope.revisionNumber; delete scope.workspaceId
    const candidate = { contradictionId: 'candidate-1', evidenceObjectIds: ['evidence-1', 'evidence-2'], domain: 'decision', severity: 'REVIEW', basis: 'Compare positions' }
    const pair = getDiscoveryContradictionReview(candidate, f.rows.evidence, null, scope.runtimeInstanceId, '')
    const supplementalFinding = { receiptId: '123e4567-e89b-42d3-a456-426614174000', storageId: String(f.oid(23)), bodyHash: 'c'.repeat(64),
      auditId: String(f.oid(24)), auditSignatureVersion: 1, createdAt: f.at, reviewerUserId: String(f.oid(9)), disposition: 'NOT_CONTRADICTORY',
      candidate, evidence: pair.evidence, evidencePairHash: pair.evidencePairHash, reviewEpoch: '', rationale: 'Exact synthetic review only.',
      authority: { receiptId: '123e4567-e89b-42d3-a456-426614174001', bodyHash: 'd'.repeat(64), approvalReference: 'test-authority', version: 'v1', documentHash: 'e'.repeat(64) },
      frozenMembershipHash: 'f'.repeat(64), snapshotMembershipHash: membershipHash(body), scope }
    const args = { scope, sections: [{ sectionKey: member.sectionKey, references: f.rows.sections[0].sectionDetail.accepted.supportingEvidenceRefs,
      ...(withProof ? { storageId: member.storageId, materialHash: member.materialHash } : {}) }],
    ...(withProof ? { frozenMembership: { snapshotId: 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174000', membershipHash: membershipHash(body), body } } : {}),
    ...(withFinding ? { supplementalFinding, contradictionReferences: candidate.evidenceObjectIds } : {}),
    count: async kind => f.rows[kind].length, readPage: async (kind, after) => after ? [] : f.rows[kind], validateRows: () => {} }
    const result = await assembleOutcomeEvidenceInventory(args)
    return { ...result, inventoryReceipt: result.receipt,
      ...(withFinding ? { discoveryHealth: { contradictionCandidates: [candidate] }, contradictionReviewEpoch: '' } : {}) }
  }
  test('retains raw refs as context without adding evidence or changing factual selection', async () => {
    const snapshot = await inventory()
    expect(snapshot.inventoryReceipt.sectionCoverage[0]).toMatchObject({ references: ['scoped_view', 'section_input', 'source-1'], evidenceIds: ['evidence-1'], missingReferences: [] })
    expect(snapshot.evidenceObjects).toHaveLength(1)
    expect(isOutcomeContextMetadataReference(snapshot, 'section-1', 'section_input')).toBe(true)
    expect(() => assertOutcomeEvidenceInventory(snapshot)).not.toThrow()
    const unverified = await inventory(false)
    expect(unverified.inventoryReceipt.sectionCoverage[0].missingReferences).toEqual(['scoped_view', 'section_input'])
    expect(unverified.inventoryReceipt.selectedEvidenceIds).toEqual(snapshot.inventoryReceipt.selectedEvidenceIds)
  })
  test('only an exact frozen current note reference is source metadata, never an evidence selection', async () => {
    const snapshot = await inventory(), source = snapshot.sourceRegistry[0]
    source.sourceType = 'DISCOVERY_NOTES'; source.current = true
    source.sourceStateVersion = snapshot.inventoryReceipt.scope.stateVersion
    const frozen = snapshot.inventoryReceipt.frozenMembership
    frozen.body.sources[0].materialHash = evidenceMaterialHash(source)
    frozen.membershipHash = membershipHash(frozen.body)
    expect(isOutcomeSourceMetadataReference(snapshot, 'section-1', source.sourceId)).toBe(true)
    for (const kind of ['type', 'hash', 'scope', 'state', 'duplicate', 'unselected-collision']) {
      const changed = JSON.parse(JSON.stringify(snapshot)), row = changed.sourceRegistry[0]
      if (kind === 'type') row.sourceType = 'UPLOADED_DOCUMENT'
      if (kind === 'hash') row.label = 'changed material'
      if (kind === 'scope') row.customerId = 'foreign'
      if (kind === 'state') row.sourceStateVersion = 'old'
      if (kind === 'duplicate') changed.sourceRegistry.push(row)
      if (kind === 'unselected-collision') changed.inventoryReceipt.frozenMembership.body.evidence[0].evidenceObjectId = row.sourceId
      expect(isOutcomeSourceMetadataReference(changed, 'section-1', row.sourceId)).toBe(false)
    }
    expect(snapshot.evidenceObjects).toHaveLength(1)
    expect(isOutcomeSourceMetadataReference(snapshot, 'missing-section', source.sourceId)).toBe(false)
  })
  test('missing recorded witness stays absent; incomplete or forged bindings fail closed', async () => {
    const snapshot = await inventory()
    expect(assertOutcomeRecordedFinding(snapshot)).toBeNull()
    snapshot.inventoryReceipt.recordedReviewCompletion = { contractVersion: 'outcome-recorded-review-completion.v1', link: {} }
    expect(() => assertOutcomeRecordedFinding(snapshot)).toThrow(expect.objectContaining({ code: 'OUTCOME_EVIDENCE_SNAPSHOT_RECORDED_FINDING_INVALID' }))
  })
  test.each(['hash', 'section', 'scope', 'collision'])('rejects contextual %s tamper', async kind => {
    const snapshot = await inventory(), receipt = snapshot.inventoryReceipt
    if (kind === 'hash') receipt.frozenMembership.membershipHash = '0'.repeat(64)
    if (kind === 'section') receipt.sectionSnapshot[0].storageId = String(new mongoose.Types.ObjectId())
    if (kind === 'scope') receipt.scope.runtimeInstanceId = String(new mongoose.Types.ObjectId())
    if (kind === 'collision') receipt.collections.evidence.records[0].id = 'section_input'
    const { overallHash, ...body } = receipt; receipt.overallHash = snapshotHash(body)
    expect(() => assertOutcomeEvidenceInventory(snapshot)).toThrow()
  })
  test('supplemental provenance is separate from ordinary review and never supplies missing dimensions', async () => {
    const snapshot = await inventory(true, true)
    expect(assertOutcomeSupplementalFinding(snapshot).disposition).toBe('NOT_CONTRADICTORY')
    expect(snapshot).not.toHaveProperty('contradictionReviews')
    expect(snapshot.evidenceObjects[0]).not.toHaveProperty('scope')
    expect(() => assertOutcomeEvidenceInventory(snapshot)).not.toThrow()
    for (const disposition of ['CONFIRMED', 'REOPENED']) {
      const changed = structuredClone(snapshot)
      changed.inventoryReceipt.supplementalFinding.disposition = disposition
      expect(() => assertOutcomeSupplementalFinding(changed)).toThrow()
    }
    snapshot.contradictionReviews = []
    expect(() => assertOutcomeSupplementalFinding(snapshot)).toThrow()
  })
  test('actual composition emits contexts only as metadata omissions, never facts', async () => {
    const snapshot = await inventory()
    const ledger = projectOutcomeStudioBusinessFactLedger({ frameworkState: { evidence_pack: snapshot,
      sections: { 'section-1': { accepted: { supportingEvidenceRefs: ['section_input', 'scoped_view', 'source-1'] } } } } })
    expect(ledger.omitted.filter(row => ['section_input', 'scoped_view'].includes(row.reference))).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: 'section_input', reason: 'CONTEXT_METADATA' }),
      expect.objectContaining({ reference: 'scoped_view', reason: 'CONTEXT_METADATA' }),
    ]))
    expect(ledger.facts.some(row => ['section_input', 'scoped_view'].includes(row.evidenceObjectId))).toBe(false)
  })
  test('real v2 compiler consumes receipt-qualified NOT without upgrading dimensions or absent placements', async () => {
    const input = await makeSs041Fixture(), snapshot = await inventory(true, true)
    const template = input.composition.businessFactLedger.facts[0]
    input.sourceSnapshot = snapshot
    input.composition.runtimeBinding.runtimeInstanceId = snapshot.inventoryReceipt.scope.runtimeInstanceId
    input.composition.businessFactLedger.facts = snapshot.evidenceObjects.map(row => ({ ...template, evidenceObjectId: row.evidenceObjectId,
      sourceId: row.sourceId, statement: row.extractedFact, validationStatus: '', reviewStatus: row.reviewStatus,
      provenance: { lineageRef: '' }, qualification: [], sectionKeys: ['section-1'] }))
    input.composition.businessFactLedger.omitted = []
    input.composition.businessFactLedger.contradictions = [snapshot.inventoryReceipt.supplementalFinding.candidate]
    const contract = compileEvidenceToMeaningContract(input)
    expect(contract.contradictionLedger[0]).toMatchObject({ disposition: 'NOT_CONTRADICTORY', dimensions: { scope: 'UNRESOLVED', time: 'UNRESOLVED', materiality: 'UNRESOLVED' },
      supplementalReview: { receiptId: snapshot.inventoryReceipt.supplementalFinding.receiptId } })
    expect(contract.status).toBe('CLARIFICATION_REQUIRED')
    expect(contract.sectionLedger.some(row => row.reasons.includes('DRAFT_PLACEMENT_REQUIRED'))).toBe(true)
    expect(contract.sectionLedger.every(row => !row.reasons.includes('CONTRADICTION_CANDIDATE_UNRESOLVED'))).toBe(true)
    snapshot.contradictionReviews = [{ disposition: 'REOPENED' }]
    expect(() => compileEvidenceToMeaningContract(input)).toThrow('inventory')
    expect(() => assertOutcomeSupplementalFinding(snapshot)).toThrow()
  })
})

describe('offline captured website material through membership and Outcome inventory', () => {
  const captureFixture = JSON.parse(readFileSync(new URL('./fixtures/controlledWebsiteCapture.json', import.meta.url), 'utf8'))
  const pipeline = async (recordSourceCapture = true) => {
    const originalFetch = globalThis.fetch, originalDns = globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
    let product
    try {
      globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
      globalThis.fetch = jest.fn(async () => ({ ok: true, status: 200, url: captureFixture.url,
        headers: { get: key => key === 'content-type' ? 'text/html' : key === 'content-length' ? String(Buffer.byteLength(captureFixture.html)) : null }, text: async () => captureFixture.html }))
      product = await acquireWebsiteDiscoveryEvidence({ websiteUrl: captureFixture.url, acquiredAt: captureFixture.capturedAt,
        acquisitionProfile: 'STANDARD', recordSourceCapture })
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    } finally { globalThis.fetch = originalFetch; globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = originalDns }
    const evidenceObjects = normalizeDiscoveryEvidenceObjects({ sources: [product.source], evidenceObjects: product.evidenceObjects })
    const sourceRegistry = buildDiscoverySourceRegistry({ sources: [product.source], sourceRegistry: [product.sourceRegistryEntry], evidenceObjects })
    const f = membershipFixture()
    const mapped = createRuntimeStateLegacySourceRowSet({ scope: { runtimeInstanceId: f.runtime._id, runtimeInstanceKey: f.runtime.runtimeInstanceKey,
      customerId: f.runtime.customerId, tenantId: f.runtime.tenantId }, stateVersion: f.runtime.stateVersion,
      migrationReceiptId: f.oid(5), migrationTimestamp: f.at, legacyInput: { rawBsonBytes: 4096, sections: {},
        evidencePack: { sourceRegistry, evidenceObjects }, intelligenceGraph: { graphVersion: 'offline-controlled', nodes: [], edges: [] } } })
    const modelRows = (Model, rows, start) => rows.map((row, index) => {
      const model = new Model({ ...row, _id: f.oid(start + index), current: true })
      expect(model.validateSync()).toBeUndefined()
      return model.toObject()
    })
    f.rows.sources = modelRows(RuntimeEvidenceSource, mapped.rows.evidenceSources, 20)
    f.rows.evidence = modelRows(RuntimeEvidenceObject, mapped.rows.evidenceObjects, 30)
    // Reused LOCKED/accepted-section shapes are synthetic reference containers,
    // not a native lock, accepted website evidence, or reviewer authority.
    const sourceId = product.source.sourceId
    f.rows.sections[0].sectionDetail.accepted = { evidenceRefs: [sourceId], supportingEvidenceRefs: [sourceId] }
    const bodyNow = () => buildEvidenceMembershipBody({ runtime: f.runtime, lockTruthRecord: f.runtime.framework_state.lock.snapshot, ...f.rows })
    const body = bodyNow(), member = body.sections[0]
    const args = { scope: { customerId: String(f.runtime.customerId), tenantId: String(f.runtime.tenantId), runtimeInstanceId: String(f.runtime._id),
      runtimeInstanceKey: f.runtime.runtimeInstanceKey, stateVersion: f.runtime.stateVersion },
    sections: [{ sectionKey: member.sectionKey, references: [sourceId], storageId: member.storageId, materialHash: member.materialHash }],
    frozenMembership: { snapshotId: 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174000', membershipHash: membershipHash(body), body },
    count: async kind => f.rows[kind].length, readPage: async (kind, after) => after ? [] : f.rows[kind],
    validateRows: (kind, page) => {
      for (const row of page) {
        const error = new (kind === 'sources' ? RuntimeEvidenceSource : RuntimeEvidenceObject)(row).validateSync()
        if (error) throw error
      }
      assertSourceEvidenceMetadataPairs({ sources: f.rows.sources, evidenceObjects: f.rows.evidence })
    } }
    const inventory = async () => {
      const result = await assembleOutcomeEvidenceInventory(args)
      return { ...result, inventoryReceipt: result.receipt }
    }
    return { ...f, product, body, bodyNow, args, inventory }
  }
  test('actual captured pairs preserve deterministic body/inventory hashes and unverified qualifications', async () => {
    const f = await pipeline(), snapshot = await f.inventory(), replay = await pipeline()
    expect(() => assertOutcomeEvidenceInventory(snapshot)).not.toThrow()
    expect(membershipHash(f.body)).toBe(membershipHash(replay.body))
    expect((await replay.inventory()).receipt.overallHash).toBe(snapshot.receipt.overallHash)
    expect(snapshot.receipt).toMatchObject({ completeness: 'COMPLETE', sectionReadiness: 'REFERENCES_RESOLVED',
      selectedEvidenceIds: f.product.evidenceObjects.map(row => row.evidenceObjectId).sort() })
    expect(snapshot.sourceRegistry[0].sourceCapture).toEqual(f.product.source.sourceCapture)
    expect(snapshot.sourceRegistry[0].contentHash).toBe(f.product.source.contentHash)
    expect(snapshot.sourceRegistry[0].sourceRef).toBe(captureFixture.url)
    for (const row of snapshot.evidenceObjects) {
      expect(row.reviewStatus).toBe('PENDING')
      expect(row.evidenceSupport).toEqual(f.product.evidenceObjects.find(item => item.evidenceObjectId === row.evidenceObjectId).evidenceSupport)
      expect(f.body.evidence.find(item => item.evidenceObjectId === row.evidenceObjectId).materialHash).toBe(evidenceMaterialHash(row))
    }
    const qualified = buildRuntimeSectionEvidenceQualifications({ evidenceObjects: snapshot.evidenceObjects, sourceRegistry: snapshot.sourceRegistry,
      lineageSources: [f.product.source], admittedEvidenceIds: snapshot.receipt.selectedEvidenceIds })
    expect(qualified.sources[0].sourceReview).toEqual({ status: 'NOT_RECORDED', authenticity: null })
    expect(qualified.evidence.every(row => row.reviewStatus === 'PENDING' && row.evidenceSupport.epistemicType === 'SOURCE_ASSERTION')).toBe(true)
  })
  test.each(['drop optional pair', 'capture time', 'exact support'])('post-freeze %s changes hashes and fails actual frozen inventory binding', async kind => {
    const f = await pipeline(), original = await f.inventory()
    if (kind === 'drop optional pair') {
      delete f.rows.sources[0].sourceCapture
      f.rows.evidence.forEach(row => { delete row.evidenceSupport })
    }
    if (kind === 'capture time') f.rows.sources[0].sourceCapture.capturedAt = '2026-10-19T10:01:00.000Z'
    if (kind === 'exact support') {
      const row = f.rows.evidence[0]
      row.evidenceSupport = buildEvidenceSupport({ captureText: captureFixture.captureText,
        exactSegment: row.evidenceSupport.exactExcerpt.slice(1), sourceCapture: f.rows.sources[0].sourceCapture })
    }
    expect(membershipHash(f.bodyNow())).not.toBe(membershipHash(f.body))
    const changed = await f.inventory()
    expect(changed.receipt.overallHash).not.toBe(original.receipt.overallHash)
    expect(() => assertOutcomeEvidenceInventory(changed)).toThrow(expect.objectContaining({ code: 'OUTCOME_EVIDENCE_SNAPSHOT_FROZEN_CONTEXT_INVALID' }))
  })
  test('actual inventory re-read rejects same-count website material drift', async () => {
    const f = await pipeline(), read = f.args.readPage
    let reads = 0
    f.args.readPage = async (kind, after, limit) => {
      const rows = await read(kind, after, limit)
      return kind === 'evidence' && ++reads === 2 ? rows.map(row => ({ ...row, extractedFact: row.extractedFact + ' Changed controlled text.' })) : rows
    }
    await expect(f.inventory()).rejects.toMatchObject({ code: 'OUTCOME_EVIDENCE_SNAPSHOT_RECORDS_CHANGED' })
  })
  test('missing referenced website source fails actual pure membership closure', async () => {
    const f = await pipeline()
    f.rows.sources = []
    expect(f.bodyNow).toThrow(expect.objectContaining({ details: { reason: 'SOURCE_UNRESOLVED' } }))
  })
  test('cross-scope website rows fail membership and projected inventory owners', async () => {
    const f = await pipeline(), snapshot = await f.inventory()
    f.rows.evidence[0].tenantId = f.oid(99)
    expect(f.bodyNow).toThrow(expect.objectContaining({ details: { reason: 'MEMBER_SCOPE_INVALID' } }))
    expect(() => assertOutcomeEvidenceInventory(snapshot)).toThrow(expect.objectContaining({ code: 'OUTCOME_EVIDENCE_SNAPSHOT_SCOPE_MISMATCH' }))
  })
  test('semantic envelope errors fail shared validators/model checks, distinct from hash verification', async () => {
    const f = await pipeline(), row = f.rows.evidence[0], support = row.evidenceSupport
    for (const change of [value => { value.sourceId = 'foreign-source' }, value => { value.excerptHash = 'sha256:' + 'f'.repeat(64) }]) {
      row.evidenceSupport = JSON.parse(JSON.stringify(support)); change(row.evidenceSupport)
      expect(() => assertSourceEvidenceMetadataPairs({ sources: f.rows.sources, evidenceObjects: f.rows.evidence }))
        .toThrow(expect.objectContaining({ code: 'SOURCE_EVIDENCE_CONTRACT_INVALID' }))
      expect(new RuntimeEvidenceObject(row).validateSync()).toBeDefined()
    }
  })
  test('actual default-off legacy rows remain valid with absent optional metadata before freezing', async () => {
    const f = await pipeline(false), snapshot = await f.inventory()
    expect(snapshot.sourceRegistry[0]).not.toHaveProperty('sourceCapture')
    expect(snapshot.evidenceObjects.every(row => !Object.hasOwn(row, 'evidenceSupport'))).toBe(true)
    expect(() => assertOutcomeEvidenceInventory(snapshot)).not.toThrow()
  })
})
