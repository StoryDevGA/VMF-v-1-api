import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import Candidate from '../models/OutcomeDocxRenditionCandidate.js'
import Preview from '../models/OutcomeDocxPagePreview.js'
import Audit from '../models/AuditLog.js'
import { masterLinkedDocxFixture } from './fixtures/masterLinkedDocxFixture.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { MASTER_LINKED_CANDIDATE_VERSION, MASTER_LINKED_PREVIEW_VERSION, assertMasterLinkedCandidateBinding } from '../services/outcomeMasterLinkedDocxContract.js'
import { assertPrivateDocxCandidateRecord, assertPrivateDocxCandidateAudit } from '../services/outcomeDocxCandidateRecordContract.js'
import { assertDocxPagePreviewRecord } from '../services/outcomeDocxPagePreviewRecordContract.js'
import { createMasterLinkedPrivateDocxCandidate, readPrivateDocxCandidate } from '../services/outcomeDocxCandidatePersistenceService.js'
import { createDocxPagePreview, readCurrentDocxPagePreview } from '../services/outcomeDocxPagePreviewPersistenceService.js'
import { prepareMasterLinkedDocxReviewBinding } from '../services/outcomeMasterLinkedDocxReviewBindingService.js'
import { prepareMeaningMasterDocxRendition } from '../services/outcomeMeaningMasterRenditionService.js'

const copy = value => JSON.parse(JSON.stringify(value))
afterEach(() => jest.restoreAllMocks())

test('v2 model preserves exact bridge lineage/input/bytes and raw signed audit', async () => {
  const f = await masterLinkedDocxFixture(), model = new Candidate(f.record)
  await expect(model.validate()).resolves.toBeUndefined()
  expect(assertPrivateDocxCandidateRecord(model.toObject()).equals(f.bridge.buffer)).toBe(true)
  expect(assertMasterLinkedCandidateBinding(f.record.body)).toBe(membershipHash(f.record.body.masterBinding))
  expect(() => assertPrivateDocxCandidateAudit(f.record, f.audit, row => Audit.prototype.verifySignature.call(row))).not.toThrow()
  await expect(new Preview(f.preview).validate()).resolves.toBeUndefined()
})
test.each([
  ['binding missing', row => { delete row.body.masterBinding }],
  ['wrapper changed', row => { row.body.masterBinding.wrapperFingerprint = '0'.repeat(64) }],
  ['unknown binding field', row => { row.body.masterBinding.extra = true }],
  ['wrong source', row => { row.body.masterBinding.masterReference.sourceFingerprint = '0'.repeat(64) }],
  ['wrong scope', row => { row.body.masterBinding.masterReference.scope.customerId = '507f1f77bcf86cd799439099' }],
  ['array reference', row => { row.body.masterBinding.masterReference = [] }],
  ['wrong master body', row => { row.body.masterBinding.masterReference.bodyFingerprint = 'f'.repeat(64) }],
  ['unreviewed promotion', row => { row.body.masterBinding.expressionOrigin = 'APPROVED' }],
  ['authority', row => { row.body.authorisesApproval = true }],
  ['downgraded version', row => { row.body.contractVersion = 'private-docx-candidate.v1' }],
])('candidate v2 refuses %s after body hash recomputation', async (_name, mutate) => {
  const f = await masterLinkedDocxFixture(); mutate(f.record); f.record.bodyFingerprint = membershipHash(f.record.body)
  expect(() => assertPrivateDocxCandidateRecord(f.record)).toThrow()
})
test.each(['candidateBodyFingerprint', 'masterBindingFingerprint'])('preview v2 requires %s and cannot downgrade', async key => {
  const f = await masterLinkedDocxFixture(); delete f.preview.body[key]; f.preview.bodyFingerprint = membershipHash(f.preview.body)
  expect(() => assertDocxPagePreviewRecord(f.preview)).toThrow()
  f.preview.body.contractVersion = 'private-docx-page-preview.v1'; f.preview.bodyFingerprint = membershipHash(f.preview.body)
  expect(() => assertDocxPagePreviewRecord(f.preview)).toThrow()
})
test.each([Candidate, Preview])('v2 skipped-validation save still refuses malformed body', async Model => {
  const f = await masterLinkedDocxFixture(), row = Model === Candidate ? f.record : f.preview
  const doc = new Model(row); doc.bodyFingerprint = '0'.repeat(64)
  const insert = jest.spyOn(Model.collection, 'insertOne').mockResolvedValue({ acknowledged: true })
  await expect(doc.save({ validateBeforeSave: false })).rejects.toThrow()
  expect(insert).not.toHaveBeenCalled()
})

// Staged unit transactions prove branching only. Real rollback/races are a
// separately guarded isolated persistence check, never inferred from this fake.
const store = async () => {
  const f = await masterLinkedDocxFixture(), rows = [], previews = [], audits = []
  let staged = { rows: [], previews: [], audits: [] }
  const query = (list, name, filter) => { let session
    return { select() { return this }, maxTimeMS() { return this }, session(value) { session = value; return this },
      async lean() { return [...list, ...(session ? staged[name] : [])].find(row => Object.entries(filter).every(([k, v]) => String(row[k]) === String(v))) || null } }
  }
  const transaction = { endSession: jest.fn(), async withTransaction(fn) {
    try { await fn(); rows.push(...staged.rows); previews.push(...staged.previews); audits.push(...staged.audits) }
    finally { staged = { rows: [], previews: [], audits: [] } }
  } }
  const model = (Model, list, name) => ({ collection: { indexes: async () => Model.schema.indexes().map(([key, options]) => ({ ...options, key })) },
    db: { startSession: async () => transaction }, findOne: filter => query(list, name, filter),
    async create([row]) { const doc = new Model(row); await doc.validate(); const saved = doc.toObject(); staged[name].push(saved); return [saved] } })
  const candidateModel = model(Candidate, rows, 'rows'), previewModel = model(Preview, previews, 'previews')
  const auditModel = { prototype: Audit.prototype, findOne: filter => query(audits, 'audits', filter), hydrate: () => { throw Error('RAW_SIGNATURE_REQUIRED') } }
  const writer = { async log(input) { const doc = new Audit(input); doc.generateSignature(); const row = doc.toObject(); staged.audits.push(row); return row } }
  const readMaster = jest.fn(async () => copy(f.masterReceipt)), prepare = jest.fn(async () => f.bridge)
  const args = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, payload: f.payload,
    deps: { Candidate: candidateModel, Audit: auditModel, auditService: writer, readSource: async () => copy(f.envelope),
      readMaster, prepareMasterRendition: prepare, loadPackContent: f.loadPackContent } }
  const read = value => readPrivateDocxCandidate({ ...args, ...value, deps: args.deps })
  const previewArgs = candidateId => ({ actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, candidateId,
    payload: { expectedSourceFingerprint: f.envelope.sourceFingerprint, expectedOutputChecksum: f.bridge.artifact.outputChecksum },
    deps: { Preview: previewModel, Audit: auditModel, auditService: writer, readCandidate: read,
      readRuntime: async () => f.previewRuntime, renderPreview: async () => f.rendered } })
  return { ...f, rows, previews, audits, args, read, previewArgs, writer, candidateModel, readMaster, prepare, transaction }
}
test('service persists/replays v2, preview joins master/body, review binding is non-dispatchable', async () => {
  const f = await store(), first = await createMasterLinkedPrivateDocxCandidate(f.args)
  const replay = await createMasterLinkedPrivateDocxCandidate({ ...f.args, actorUserId: '507f1f77bcf86cd799439099' })
  expect(replay).toEqual({ ...first, idempotent: true }); expect(f.prepare).toHaveBeenCalledTimes(1)
  expect(first.candidate.contractVersion).toBe(MASTER_LINKED_CANDIDATE_VERSION)
  const args = f.previewArgs(first.candidate.candidateId), saved = await createDocxPagePreview(args)
  expect(saved.preview.contractVersion).toBe(MASTER_LINKED_PREVIEW_VERSION)
  expect(saved.preview.masterBindingFingerprint).toBe(first.candidate.masterBindingFingerprint)
  expect((await createDocxPagePreview(args)).idempotent).toBe(true)
  const result = await prepareMasterLinkedDocxReviewBinding({ ...args, deps: { readCandidate: f.read,
    readPreview: input => readCurrentDocxPagePreview({ ...args, ...input, deps: args.deps }) } })
  expect(result.dispatchAvailable).toBe(false); expect(result.authorisesApproval).toBe(false)
  expect(result.binding.masterBindingFingerprint).toBe(first.candidate.masterBindingFingerprint)
  expect(result.bindingFingerprint).toBe(membershipHash(result.binding))
  expect(result.pages[0].equals(f.rendered.pages[0].buffer)).toBe(true)
  expect(result.document.markdown).toBe(f.bridge.input.renditionInput.markdown)
  expect(f.rows).toHaveLength(1); expect(f.previews).toHaveLength(1); expect(f.audits).toHaveLength(2)
})
test.each(['audit', 'record'])('v2 %s failure leaves no staged pair', async kind => {
  const f = await store()
  if (kind === 'audit') f.writer.log = async () => { throw Error('REQUIRED_AUDIT_FAILED') }
  else f.candidateModel.create = async () => { throw Error('RECORD_FAILED') }
  await expect(createMasterLinkedPrivateDocxCandidate(f.args)).rejects.toThrow()
  expect(f.rows).toHaveLength(0); expect(f.audits).toHaveLength(0)
})
test('same key with changed master body is refused before compiling', async () => {
  const f = await store(); await createMasterLinkedPrivateDocxCandidate(f.args)
  f.masterReceipt.masterReference.bodyFingerprint = 'f'.repeat(64)
  const changed = { ...f.args, payload: { ...f.args.payload, expectedMasterBodyFingerprint: 'f'.repeat(64) } }
  await expect(createMasterLinkedPrivateDocxCandidate(changed)).rejects.toMatchObject({ details: { reason: 'CANDIDATE_REQUEST_KEY_CONFLICT' } })
  expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.rows).toHaveLength(1)
})
test('v2 transactional winner verification never invokes upstream master or pack readers', async () => {
  const f = await store(), first = await createMasterLinkedPrivateDocxCandidate(f.args)
  let active = false, hidePrecheck = true, packReads = 0
  const originalTransaction = f.transaction.withTransaction.bind(f.transaction)
  f.transaction.withTransaction = fn => originalTransaction(async () => { active = true; try { return await fn() } finally { active = false } })
  const find = f.candidateModel.findOne
  f.candidateModel.findOne = filter => {
    const query = find(filter)
    if (filter.requestKey && hidePrecheck) { hidePrecheck = false; query.lean = async () => null }
    return query
  }
  f.args.deps.loadPackContent = async input => { expect(active).toBe(false); packReads++; return f.loadPackContent(input) }
  f.readMaster.mockImplementation(async () => { expect(active).toBe(false); return copy(f.masterReceipt) })
  const replay = await createMasterLinkedPrivateDocxCandidate(f.args)
  expect(replay).toEqual({ ...first, idempotent: true })
  expect(packReads).toBeGreaterThanOrEqual(10)
  expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1)
})
test('read refuses changed current master reference', async () => {
  const f = await store(), first = await createMasterLinkedPrivateDocxCandidate(f.args)
  f.masterReceipt.masterReference.bodyFingerprint = 'f'.repeat(64)
  await expect(f.read({ candidateId: first.candidate.candidateId, includeBytes: true })).rejects.toMatchObject({ details: { reason: 'CANDIDATE_MASTER_CHANGED' } })
})
test('preview refuses changed master binding even after a fresh body hash', async () => {
  const f = await store(), first = await createMasterLinkedPrivateDocxCandidate(f.args), args = f.previewArgs(first.candidate.candidateId)
  await createDocxPagePreview(args)
  f.previews[0].body.masterBindingFingerprint = 'f'.repeat(64)
  f.previews[0].bodyFingerprint = membershipHash(f.previews[0].body)
  await expect(readCurrentDocxPagePreview(args)).rejects.toMatchObject({ details: { reason: 'PREVIEW_MASTER_BINDING_CHANGED' } })
})

test('v2 atomic audit timeout refuses and rolls back the staged pair', async () => {
  const f = await store(); let now = Date.now(); jest.spyOn(Date, 'now').mockImplementation(() => now)
  const log = f.writer.log
  f.writer.log = async input => { const audit = await log(input); now += 20001; return audit }
  await expect(createMasterLinkedPrivateDocxCandidate(f.args)).rejects.toMatchObject({ details: { reason: 'MASTER_CANDIDATE_ATOMIC_BUDGET' } })
  expect(f.rows).toHaveLength(0); expect(f.audits).toHaveLength(0)
})
test('post-commit master refusal preserves the immutable pair without reporting success', async () => {
  const f = await store(); f.args.deps.prepareMasterRendition = prepareMeaningMasterDocxRendition
  f.readMaster.mockResolvedValueOnce(copy(f.masterReceipt)).mockResolvedValueOnce(copy(f.masterReceipt)).mockRejectedValueOnce(Error('POST_COMMIT_SOURCE_REFUSAL'))
  await expect(createMasterLinkedPrivateDocxCandidate(f.args)).rejects.toThrow('POST_COMMIT_SOURCE_REFUSAL')
  expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1)
})
test('v2 strict payload refuses extra authority before source reads', async () => {
  const f = await store(); const source = jest.fn(); f.args.deps.readSource = source
  await expect(createMasterLinkedPrivateDocxCandidate({ ...f.args, payload: { ...f.payload, authorisesApproval: true } })).rejects.toMatchObject({ status: 422 })
  expect(source).not.toHaveBeenCalled()
})
test('v2 preview audit timeout rolls back only its new staged pair', async () => {
  const f = await store(), created = await createMasterLinkedPrivateDocxCandidate(f.args)
  let now = Date.now(); jest.spyOn(Date, 'now').mockImplementation(() => now)
  const log = f.writer.log
  f.writer.log = async input => { const audit = await log(input); now += 20001; return audit }
  await expect(createDocxPagePreview(f.previewArgs(created.candidate.candidateId))).rejects.toMatchObject({ details: { reason: 'MASTER_PREVIEW_ATOMIC_BUDGET' } })
  expect(f.previews).toHaveLength(0); expect(f.audits).toHaveLength(1)
})
test('converter cleanup uncertainty cannot persist a preview', async () => {
  const f = await store(), created = await createMasterLinkedPrivateDocxCandidate(f.args), args = f.previewArgs(created.candidate.candidateId)
  args.deps.renderPreview = async () => { throw Error('PROCESS_CLEANUP_UNVERIFIED') }
  await expect(createDocxPagePreview(args)).rejects.toThrow('PROCESS_CLEANUP_UNVERIFIED')
  expect(f.previews).toHaveLength(0); expect(f.audits).toHaveLength(1)
})
test('preview snapshots converter bytes and metadata before awaited candidate recheck', async () => {
  const f = await store(), created = await createMasterLinkedPrivateDocxCandidate(f.args), args = f.previewArgs(created.candidate.candidateId)
  const expected = Buffer.from(f.rendered.pages[0].buffer); let reads = 0
  args.deps.readCandidate = async value => {
    const result = await f.read(value)
    if (++reads === 2) { f.rendered.pages[0].buffer.fill(0); f.rendered.receipt.docxChecksum = 'changed' }
    return result
  }
  await createDocxPagePreview(args)
  expect(f.previews[0].body.conversion.docxChecksum).toBe(created.candidate.artifact.outputChecksum)
  const bytes = f.previews[0].pageBytes[0]
  expect(Buffer.from(bytes.value ? bytes.value(true) : bytes).equals(expected)).toBe(true)
})
test.each(['candidate body', 'master binding', 'input', 'bytes', 'page'])('non-dispatchable review binding refuses changed %s', async kind => {
  const f = await store(), created = await createMasterLinkedPrivateDocxCandidate(f.args), args = f.previewArgs(created.candidate.candidateId)
  await createDocxPagePreview(args)
  const readPreview = async value => {
    const saved = await readCurrentDocxPagePreview({ ...args, ...value, deps: args.deps })
    if (kind === 'candidate body') saved.preview.candidateBodyFingerprint = 'f'.repeat(64)
    if (kind === 'master binding') saved.preview.masterBindingFingerprint = 'f'.repeat(64)
    if (kind === 'page') saved.pages[0] = Buffer.from('not PNG')
    return saved
  }
  const readCandidate = async value => {
    const saved = await f.read(value)
    if (kind === 'input') saved.candidateInput.markdown += 'changed'
    if (kind === 'bytes') saved.buffer = Buffer.from('changed')
    return saved
  }
  await expect(prepareMasterLinkedDocxReviewBinding({ ...args, deps: { readCandidate, readPreview } })).rejects.toThrow()
})
