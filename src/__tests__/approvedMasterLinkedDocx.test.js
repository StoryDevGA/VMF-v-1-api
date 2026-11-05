import { jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import Audit from '../models/AuditLog.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { APPROVED_EXPRESSION_VERSION, APPROVED_EXPRESSION_FIXED as fixed, APPROVED_SECTION13_STATE,
  NARROW_EXPRESSION_VERSION, NARROW_EXPRESSION_FIXED,
  buildApprovedQualificationMapping } from '../services/commercialDocxApprovedExpression.js'
import { PRIVATE_DOCX_CANDIDATE_INDEX, PRIVATE_DOCX_CANDIDATE_ID_INDEX } from '../services/outcomeDocxCandidateRecordContract.js'

const copy = value => JSON.parse(JSON.stringify(value))
const retained = JSON.parse(readFileSync(new URL('./fixtures/approvedCommercialSource.json', import.meta.url)))
const compatibilityRead = jest.fn()
jest.unstable_mockModule('../services/commercialDocxCompatibilityService.js', () => ({ readApprovedCommercialCompatibility: compatibilityRead }))
const { createApprovedMasterLinkedPrivateDocxCandidate, readPrivateDocxCandidate, listCurrentPrivateDocxCandidates } = await import('../services/outcomeDocxCandidatePersistenceService.js')
const scope = retained.masterReference.scope
const flags = Object.fromEntries(['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable'].map(key => [key, false]))
const value = (row, key) => key.split('.').reduce((v, part) => v?.[part], row)
const matches = (row, filter) => Object.entries(filter).every(([key, expected]) => String(value(row, key)) === String(expected))
let candidates, audits, inTransaction, masterReads, compatibilityReads, auditWrites, closed, failCreate, hideExistingOnce, afterCommitDrift
let candidateModel, auditModel, args, ref
const q = fn => { const query = { select: () => query, sort: () => query, limit: () => query, session: () => query,
  maxTimeMS: () => query, lean: async () => fn() }; return query }
beforeEach(() => {
  candidates = new Map(); audits = new Map(); inTransaction = false; masterReads = 0; compatibilityReads = 0
  auditWrites = 0; closed = 0; failCreate = false; hideExistingOnce = false; afterCommitDrift = false
  ref = { version: APPROVED_EXPRESSION_VERSION, auditId: 'a'.repeat(24), decisionFingerprint: 'b'.repeat(64),
    mappingFingerprint: membershipHash(buildApprovedQualificationMapping(retained.sourceEnvelope)), masterId: fixed.masterId,
    sourceFingerprint: fixed.sourceFingerprint, predecessorCandidateId: fixed.predecessorCandidateId,
    failedReviewExecutionId: fixed.failedReviewExecutionId, failedReviewResultFingerprint: fixed.failedReviewResultFingerprint,
    section13State: APPROVED_SECTION13_STATE }
  compatibilityRead.mockReset().mockImplementation(async () => {
    expect(inTransaction).toBe(false); compatibilityReads++
    return { ...ref, ...(afterCommitDrift && candidates.size ? { decisionFingerprint: 'c'.repeat(64) } : {}) }
  })
  const session = { withTransaction: async fn => {
    const originalCandidates = new Map(candidates), originalAudits = new Map(audits)
    inTransaction = true
    try { return await fn() } catch (error) { candidates = originalCandidates; audits = originalAudits; throw error }
    finally { inTransaction = false }
  }, endSession: async () => { closed++ } }
  candidateModel = {
    collection: { indexes: async () => [{ name: PRIVATE_DOCX_CANDIDATE_INDEX, unique: true,
      key: { tenantId: 1, customerId: 1, runtimeInstanceId: 1, requestKey: 1 } },
    { name: PRIVATE_DOCX_CANDIDATE_ID_INDEX, unique: true, key: { candidateId: 1 } }] },
    db: { startSession: async () => session },
    findOne: filter => q(() => {
      if (hideExistingOnce && !inTransaction && filter.requestKey) { hideExistingOnce = false; return null }
      return [...candidates.values()].find(row => matches(row, filter)) || null
    }),
    find: filter => q(() => [...candidates.values()].filter(row => matches(row, filter))),
    create: async (rows, options) => {
      expect(inTransaction).toBe(true); expect(options.session).toBe(session)
      if (failCreate) throw Error('UNIT_CANDIDATE_WRITE_FAILURE')
      for (const row of rows) candidates.set(row.candidateId, row)
      return rows
    },
  }
  auditModel = { prototype: Audit.prototype, findOne: filter => q(() => audits.get(String(filter._id)) || null) }
  const source = copy(retained.sourceEnvelope)
  const master = { master: { masterId: fixed.masterId, version: 1, purpose: 'MEANING_SOURCE_ONLY', status: 'RECORDED_MEANING_SOURCE_ONLY',
    permittedUse: 'ISOLATED_ENGINEERING_TEST_ONLY', classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', ...flags,
    sourceFingerprint: fixed.sourceFingerprint, sourceProjectionFingerprint: retained.masterReference.sourceProjectionFingerprint },
  masterReference: copy(retained.masterReference), sourceEnvelope: source }
  const loadPackContent = async query => {
    expect(inTransaction).toBe(false)
    const doc = retained.selectedDocuments.find(d => d.receipt.packId === query.packId && d.receipt.versionId === query.versionId)
    const receipt = Object.values(source.source.selectedPacks).find(d => d.packId === query.packId)
    return { ...receipt, content: doc.content, contentFormat: 'MARKDOWN', available: true, status: 'ACTIVE' }
  }
  args = { actorUserId: fixed.actorUserId, runtimeInstanceId: fixed.runtimeInstanceId,
    scopes: { customer: { _id: fixed.customerId }, tenant: { _id: fixed.tenantId, customerId: fixed.customerId } },
    payload: { requestKey: '11111111-1111-4111-8111-111111111111', expectedSourceFingerprint: fixed.sourceFingerprint,
      masterId: fixed.masterId, masterVersion: 1, expectedMasterBodyFingerprint: retained.masterReference.bodyFingerprint,
      format: 'DOCX', compatibilityAuditId: ref.auditId, expectedCompatibilityFingerprint: ref.decisionFingerprint },
    deps: { Candidate: candidateModel, Audit: auditModel, readSource: async () => { expect(inTransaction).toBe(false); return copy(source) },
      readMaster: async () => { expect(inTransaction).toBe(false); masterReads++; return copy(master) }, loadPackContent,
      auditService: { log: async (data, options) => {
        expect(inTransaction).toBe(true); expect(options.session).toBe(session); expect(options.throwOnError).toBe(true)
        const audit = new Audit(data); audit.generateSignature(); const row = audit.toObject()
        audits.set(String(row._id), row); auditWrites++; return audit
      } } },
  }
})

// Native source, compatibility evidence and persistence are unit seams here.
// These checks prove v3 orchestration/session placement, not real Mongo rollback.
test('v3 creates one signed private pair and replay/read/list preserve exact bytes and identity', async () => {
  const first = await createApprovedMasterLinkedPrivateDocxCandidate(args)
  expect(first.idempotent).toBe(false); expect(candidates.size).toBe(1); expect(audits.size).toBe(1)
  expect(first.candidate).toMatchObject({ status: 'PRIVATE_UNREVIEWED', renderer: { version: '0.1.4' },
    authorisesApproval: false, finalisationAvailable: false, masterBinding: { contractVersion: 'master-linked-private-docx-binding.v3' } })
  const replay = await createApprovedMasterLinkedPrivateDocxCandidate(args)
  expect(replay.idempotent).toBe(true); expect(replay.candidate.candidateId).toBe(first.candidate.candidateId)
  expect(auditWrites).toBe(1); expect(closed).toBe(1)
  const read = await readPrivateDocxCandidate({ ...args, candidateId: first.candidate.candidateId, includeBytes: true, includeInput: true })
  expect(read.buffer.equals([...candidates.values()][0].fileBytes)).toBe(true)
  expect(read.candidateInput.contractVersion).toBe('governed-private-docx-input.v3')
  expect((await listCurrentPrivateDocxCandidates(args)).candidates.map(c => c.candidateId)).toEqual([first.candidate.candidateId])
  expect(masterReads).toBeGreaterThan(1); expect(compatibilityReads).toBeGreaterThan(1)
})
test('compatibility drift after compilation refuses before the atomic window', async () => {
  compatibilityRead.mockImplementation(async () => {
    expect(inTransaction).toBe(false); compatibilityReads++
    return { ...ref, ...(compatibilityReads > 1 ? { decisionFingerprint: 'c'.repeat(64) } : {}) }
  })
  await expect(createApprovedMasterLinkedPrivateDocxCandidate(args)).rejects.toMatchObject({ details: { reason: 'CANDIDATE_APPROVED_COMPATIBILITY_CHANGED' } })
  expect(candidates.size).toBe(0); expect(audits.size).toBe(0); expect(auditWrites).toBe(0)
})
test('atomic winner verification uses the observed master/compatibility and no upstream reads inside the session', async () => {
  const first = await createApprovedMasterLinkedPrivateDocxCandidate(args)
  hideExistingOnce = true
  const winner = await createApprovedMasterLinkedPrivateDocxCandidate(args)
  expect(winner.idempotent).toBe(true); expect(winner.candidate.candidateId).toBe(first.candidate.candidateId)
  expect(candidates.size).toBe(1); expect(audits.size).toBe(1); expect(auditWrites).toBe(1); expect(closed).toBe(2)
})
test('candidate failure uses the same audit session and propagates without a unit durable pair', async () => {
  failCreate = true
  await expect(createApprovedMasterLinkedPrivateDocxCandidate(args)).rejects.toThrow('UNIT_CANDIDATE_WRITE_FAILURE')
  expect(auditWrites).toBe(1); expect(candidates.size).toBe(0); expect(audits.size).toBe(0); expect(closed).toBe(1)
})
test('post-commit compatibility drift holds the response without deleting or reissuing the private record', async () => {
  afterCommitDrift = true
  await expect(createApprovedMasterLinkedPrivateDocxCandidate(args)).rejects.toMatchObject({ details: { reason: 'CANDIDATE_APPROVED_COMPATIBILITY_CHANGED' } })
  expect(candidates.size).toBe(1); expect(audits.size).toBe(1); expect(auditWrites).toBe(1); expect(closed).toBe(1)
  afterCommitDrift = false
  expect((await createApprovedMasterLinkedPrivateDocxCandidate(args)).idempotent).toBe(true)
  expect(auditWrites).toBe(1)
})

test('v4 default owner selects the verified narrow profile and preserves one held save across replay/read/list', async () => {
  Object.assign(ref, { version: NARROW_EXPRESSION_VERSION,
    predecessorCandidateId: NARROW_EXPRESSION_FIXED.predecessorCandidateId,
    failedReviewExecutionId: NARROW_EXPRESSION_FIXED.failedReviewExecutionId,
    failedReviewResultFingerprint: NARROW_EXPRESSION_FIXED.failedReviewResultFingerprint })
  const first = await createApprovedMasterLinkedPrivateDocxCandidate(args)
  expect(first.idempotent).toBe(false)
  expect(first.candidate).toMatchObject({ status: 'PRIVATE_UNREVIEWED', authorisesApproval: false,
    finalisationAvailable: false, deliveryAvailable: false,
    renderer: { version: '0.1.5', layoutProfile: 'SOURCE_SCOPED_QUOTATIONS_V2' },
    masterBinding: { contractVersion: 'master-linked-private-docx-binding.v4',
      expressionOrigin: 'NARROW_EXPRESSION_PRIVATE_CORRECTION_UNREVIEWED', compatibilityReference: ref } })
  const read = await readPrivateDocxCandidate({ ...args, candidateId: first.candidate.candidateId, includeBytes: true, includeInput: true })
  expect(read.candidateInput.contractVersion).toBe('governed-private-docx-input.v4')
  expect(read.buffer.equals([...candidates.values()][0].fileBytes)).toBe(true)
  expect((await listCurrentPrivateDocxCandidates(args)).candidates.map(c => c.candidateId)).toEqual([first.candidate.candidateId])
  const replay = await createApprovedMasterLinkedPrivateDocxCandidate(args)
  expect(replay.idempotent).toBe(true)
  expect(replay.candidate.candidateId).toBe(first.candidate.candidateId)
  expect(candidates.size).toBe(1); expect(audits.size).toBe(1); expect(auditWrites).toBe(1)
})

test('v4 compatibility with the consumed v1 predecessor is refused before candidate or audit writes', async () => {
  ref.version = NARROW_EXPRESSION_VERSION
  await expect(createApprovedMasterLinkedPrivateDocxCandidate(args)).rejects.toMatchObject({
    code: 'APPROVED_DOCX_CORRECTION_BLOCKED', details: { reason: 'APPROVED_COMPATIBILITY_REFERENCE' } })
  expect(candidates.size).toBe(0); expect(audits.size).toBe(0); expect(auditWrites).toBe(0); expect(closed).toBe(0)
})
