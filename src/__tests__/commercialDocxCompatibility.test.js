import { jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import Audit from '../models/AuditLog.js'
import User from '../models/User.js'
import Execution from '../models/GovernedReasoningExecution.js'
import auditService from '../services/auditService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { APPROVED_EXPRESSION_FIXED as fixed, buildApprovedQualificationMapping } from '../services/commercialDocxApprovedExpression.js'

const retained = JSON.parse(readFileSync(new URL('./fixtures/approvedCommercialSource.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value))
const native = { realm: 'native-application-test.v1', operatorUserId: '698b3800f83b3257365fd7a3', fingerprint: 'e'.repeat(64) }
const seams = { authenticate: jest.fn(), native: jest.fn(), permissions: jest.fn(), candidate: jest.fn(), master: jest.fn(), result: jest.fn(), completed: jest.fn() }
jest.unstable_mockModule('../services/masterLinkedReviewOperatorAuthority.js', () => ({
  authenticateMasterReviewNativeOperator: seams.authenticate, readMasterReviewNativeOperator: seams.native,
  MASTER_REVIEW_DATABASE: 'ss044_1619d7db635949898c9abb4592d10bcf',
}))
jest.unstable_mockModule('../services/performanceCacheService.js', () => ({ buildUserPermissionsSnapshot: seams.permissions }))
jest.unstable_mockModule('../services/outcomeDocxCandidatePersistenceService.js', () => ({ readPrivateDocxCandidate: seams.candidate }))
jest.unstable_mockModule('../services/outcomeMeaningSourceMasterService.js', () => ({ readMeaningSourceMasterForRendition: seams.master }))
jest.unstable_mockModule('../services/masterLinkedCompletedReviewContract.js', () => ({ assertCompletedReviewResult: seams.result }))
jest.unstable_mockModule('../services/masterLinkedCompletedReviewService.js', () => ({ createGenuineMasterLinkedCompletedReviewStore: () => ({ read: seams.completed }) }))
const { recordApprovedCommercialCompatibility, readApprovedCommercialCompatibility } = await import('../services/commercialDocxCompatibilityService.js')

// All upstream projections are explicitly unsigned unit seams. Only the
// decision audit signature uses the real model; no source/review/native/DB proof.
const scopes = () => ({ customer: { _id: fixed.customerId }, tenant: { _id: fixed.tenantId, customerId: fixed.customerId } })
const args = () => ({ authorization: 'Bearer unit-only-authentication', approvalReference: 'Unit transcription of explicit HCP189 Product instruction; no business or review authority',
  expectedSourceFingerprint: fixed.sourceFingerprint, expectedMappingFingerprint: membershipHash(buildApprovedQualificationMapping(retained.sourceEnvelope)) })
const readArgs = result => ({ actorUserId: fixed.actorUserId, runtimeInstanceId: fixed.runtimeInstanceId, scopes: scopes(),
  auditId: result.compatibilityReference.auditId, expectedDecisionFingerprint: result.compatibilityReference.decisionFingerprint })
const q = fn => { const query = { session: () => query, maxTimeMS: () => query, lean: async () => fn() }; return query }
let rows, writes, sessionsClosed, priorDbName, source, candidate, master, body, completed, spies
beforeAll(() => { priorDbName = Audit.db.name; Audit.db.name = 'ss044_1619d7db635949898c9abb4592d10bcf' })
afterAll(() => { Audit.db.name = priorDbName })
beforeEach(() => {
  rows = new Map(); writes = 0; sessionsClosed = 0; source = copy(retained.sourceEnvelope)
  candidate = { candidateInput: { contractVersion: 'governed-private-docx-input.v2', sourceEnvelope: source },
    candidate: { bodyFingerprint: fixed.predecessorBodyFingerprint, inputFingerprint: 'a'.repeat(64),
      artifact: { outputChecksum: 'sha256:da0cac47f6341732477992fc211f66ee020e0d46997c2c6d5554d8484be59421' },
      masterBinding: { contractVersion: 'master-linked-private-docx-binding.v2', masterReference: copy(retained.masterReference) } } }
  master = { sourceEnvelope: source, masterReference: copy(retained.masterReference) }
  body = { version: 'master-linked-docx-review-result.v5', reviewStatus: 'FAIL', input: {
    mode: 'GENUINE_CONTROLLED_TEST', sourceProof: 'STORED_SOURCE_RECORDS', grant: { executionId: 'unit-previous-grant' },
    subject: { binding: { candidateId: fixed.predecessorCandidateId, candidateBodyFingerprint: fixed.predecessorBodyFingerprint,
      inputFingerprint: candidate.candidate.inputFingerprint, docxChecksum: candidate.candidate.artifact.outputChecksum } } } }
  completed = { completionConfirmed: true, completionPersisted: true, genuineReviewUsed: true, mode: 'GENUINE_CONTROLLED_TEST',
    sourceProof: 'STORED_SOURCE_RECORDS', executionId: fixed.failedReviewExecutionId, reviewStatus: 'FAIL',
    resultFingerprint: fixed.failedReviewResultFingerprint, docxChecksum: candidate.candidate.artifact.outputChecksum,
    approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false }
  for (const s of Object.values(seams)) s.mockReset()
  seams.authenticate.mockResolvedValue(native); seams.native.mockResolvedValue(native)
  seams.permissions.mockResolvedValue(scopes()); seams.candidate.mockImplementation(async () => copy(candidate))
  seams.master.mockImplementation(async () => copy(master)); seams.result.mockImplementation(() => copy(body))
  seams.completed.mockImplementation(async () => copy(completed))
  spies = [jest.spyOn(User, 'findById').mockImplementation(() => q(() => ({ isActive: true }))),
    jest.spyOn(Execution, 'findOne').mockImplementation(() => q(() => ({ executionEvidence: {
      masterLinkedCompletedReview: { bodyFingerprint: fixed.failedReviewResultFingerprint } } }))),
    jest.spyOn(Audit, 'findById').mockImplementation(id => q(() => rows.get(String(id)) || null)),
    jest.spyOn(Audit.db, 'startSession').mockImplementation(async () => ({
      withTransaction: async fn => { const before = new Map(rows); try { return await fn() } catch (e) { rows = before; throw e } },
      endSession: async () => { sessionsClosed++ },
    })),
    jest.spyOn(auditService, 'log').mockImplementation(async data => {
      const record = new Audit(data); record.generateSignature(); const raw = record.toObject()
      rows.set(String(raw._id), raw); writes++; return record
    })]
})
afterEach(() => { for (const s of spies) s.mockRestore() })

test('records one signed controlled-render decision, reads it and replays without renewal or review authority', async () => {
  const first = await recordApprovedCommercialCompatibility(args()), second = await recordApprovedCommercialCompatibility(args())
  expect(second).toEqual(first); expect(writes).toBe(1); expect(rows.size).toBe(1); expect(sessionsClosed).toBe(2)
  const audit = [...rows.values()][0]
  expect(Audit.prototype.verifySignature.call(audit)).toBe(true)
  expect(audit.diff.body).toMatchObject({ admission: 'CONTROLLED_PRIVATE_RENDER_ONLY', schemaContentComplete: false,
    customerCatalogueVerbatim: false, literalSourcePreserved: true, sourceMeaningApprovalChanged: false,
    customerApproved: false, reviewAvailable: false, dispatchAvailable: false, finalisationAvailable: false })
  expect(audit.diff.body.unresolvedFacts).toEqual(['NEXT_PERMITTED_OPERATIONAL_STEP', 'EXECUTION_APPROVER'])
  expect(audit.diff.body.qualificationMapping).toHaveLength(11)
  expect(audit.diff.recorderAuthority).toEqual(native)
  expect(await readApprovedCommercialCompatibility(readArgs(first))).toEqual(first.compatibilityReference)
  expect(seams.authenticate).toHaveBeenCalledTimes(4)
  expect(seams.native).toHaveBeenCalledTimes(1)
})

test.each([
  ['inactive actor', () => { spies[0].mockImplementation(() => q(() => ({ isActive: false }))) }],
  ['changed predecessor', () => { candidate.candidate.bodyFingerprint = '0'.repeat(64) }],
  ['changed master', () => { master.masterReference.bodyFingerprint = '0'.repeat(64) }],
  ['changed and resealed source', () => { source.source.content.workingDraft.sections[13].content += '\nNew clause'; source.sourceFingerprint = membershipHash(source.source) }],
  ['non-genuine result', () => { body.input.mode = 'QA_ONLY' }],
  ['historical wrong result version', () => { body.version = 'master-linked-docx-review-result.v1' }],
  ['result is not FAIL', () => { body.reviewStatus = 'PASS' }],
  ['wrong result candidate', () => { body.input.subject.binding.candidateId = 'wrong' }],
  ['completion not stored', () => { completed.completionPersisted = false }],
  ['completion is QA', () => { completed.mode = 'QA_ONLY' }],
  ['completion used no genuine attempt', () => { completed.genuineReviewUsed = false }],
  ['completion allows finalisation', () => { completed.finalisationAvailable = true }],
  ['recorder changed across source reads', () => { seams.authenticate.mockResolvedValueOnce(native).mockResolvedValue({ ...native, fingerprint: 'f'.repeat(64) }) }],
])('refuses %s with no decision audit', async (_label, corrupt) => {
  corrupt()
  await expect(recordApprovedCommercialCompatibility(args())).rejects.toThrow()
  expect(writes).toBe(0); expect(rows.size).toBe(0)
})

test('authentication failure propagates before reading sources or writing', async () => {
  seams.authenticate.mockRejectedValue(Object.assign(Error('Unit auth failure'), { status: 401 }))
  await expect(recordApprovedCommercialCompatibility(args())).rejects.toMatchObject({ status: 401 })
  expect(seams.candidate).not.toHaveBeenCalled(); expect(writes).toBe(0)
})
test('audit persistence failure propagates, ends the session and leaves no unit state', async () => {
  spies.at(-1).mockRejectedValue(Error('Unit audit failure'))
  await expect(recordApprovedCommercialCompatibility(args())).rejects.toThrow('Unit audit failure')
  expect(sessionsClosed).toBe(1); expect(rows.size).toBe(0)
})
test('a differently attributed instruction cannot renew an existing decision', async () => {
  await recordApprovedCommercialCompatibility(args())
  await expect(recordApprovedCommercialCompatibility({ ...args(), approvalReference: 'Another approval reference' })).rejects.toThrow()
  expect(writes).toBe(1); expect(rows.size).toBe(1)
})
test.each([
  ['signature', audit => { audit.signature = 'tampered' }, false],
  ['schema completion', audit => { audit.diff.body.schemaContentComplete = true }, true],
  ['review authority', audit => { audit.diff.body.reviewAvailable = true }, true],
  ['source mapping', audit => { audit.diff.body.qualificationMapping.pop() }, true],
  ['resource', audit => { audit.resourceId = '507f1f77bcf86cd799439011' }, true],
])('default decision read refuses changed %s including a re-signed wrong body', async (_label, mutate, resign) => {
  const first = await recordApprovedCommercialCompatibility(args()), record = [...rows.values()][0]
  mutate(record)
  if (resign) { const a = new Audit(record); a.generateSignature(); rows.set(String(a._id), a.toObject()) }
  await expect(readApprovedCommercialCompatibility(readArgs(first))).rejects.toThrow()
})
test('read rejects wrong scope, decision fingerprint and stale recorder without writing', async () => {
  const first = await recordApprovedCommercialCompatibility(args()), a = readArgs(first)
  await expect(readApprovedCommercialCompatibility({ ...a, actorUserId: '507f1f77bcf86cd799439011' })).rejects.toThrow()
  await expect(readApprovedCommercialCompatibility({ ...a, expectedDecisionFingerprint: '0'.repeat(64) })).rejects.toThrow()
  seams.native.mockResolvedValue({ ...native, fingerprint: 'f'.repeat(64) })
  await expect(readApprovedCommercialCompatibility(a)).rejects.toThrow()
  expect(writes).toBe(1)
})
test('caller authority bodies and mismatched expected mapping are not accepted', async () => {
  await expect(recordApprovedCommercialCompatibility({ ...args(), decision: { approved: true } })).rejects.toThrow()
  await expect(recordApprovedCommercialCompatibility({ ...args(), expectedMappingFingerprint: '0'.repeat(64) })).rejects.toThrow()
  expect(writes).toBe(0)
})

test('only an exact _id race recovers its matching signed winner without another audit', async () => {
  const first = await recordApprovedCommercialCompatibility(args())
  spies[2].mockImplementationOnce(() => q(() => null))
  spies.at(-1).mockRejectedValueOnce(Object.assign(Error('E11000 index: _id_ dup key:'), { code: 11000, keyPattern: { _id: 1 } }))
  expect(await recordApprovedCommercialCompatibility(args())).toEqual(first)
  expect(writes).toBe(1); expect(rows.size).toBe(1); expect(sessionsClosed).toBe(2)
})
test.each([
  ['unrelated index', 'E11000 index: unrelated_1 dup key:', { other: 1 }],
  ['misleading key pattern', 'E11000 index: _id_ dup key:', { other: 1 }],
])('refuses %s duplicate errors rather than accepting any existing audit', async (_label, message, keyPattern) => {
  await recordApprovedCommercialCompatibility(args())
  spies[2].mockImplementationOnce(() => q(() => null))
  spies.at(-1).mockRejectedValueOnce(Object.assign(Error(message), { code: 11000, keyPattern }))
  await expect(recordApprovedCommercialCompatibility(args())).rejects.toThrow(message)
  expect(writes).toBe(1)
})
test('an _id race with no durable winner is not reported as success', async () => {
  spies.at(-1).mockRejectedValueOnce(Object.assign(Error('E11000 index: _id_ dup key:'), { code: 11000, keyPattern: { _id: 1 } }))
  await expect(recordApprovedCommercialCompatibility(args())).rejects.toMatchObject({ code: 11000 })
  expect(rows.size).toBe(0); expect(writes).toBe(0)
})
