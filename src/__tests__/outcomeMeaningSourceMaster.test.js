import { jest } from '@jest/globals'
import Master from '../models/OutcomeMeaningSourceMaster.js'
import Audit from '../models/AuditLog.js'
import { meaningSourceMasterFixture, meaningMasterRecordFixture } from './fixtures/meaningSourceMasterFixture.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { assertMeaningMasterRecord, assertMeaningMasterAudit, meaningMasterAuditDiff, projectMeaningMasterSource,
  MEANING_MASTER_FLAGS, MEANING_MASTER_INDEXES } from '../services/outcomeMeaningSourceMasterContract.js'
import { createMeaningSourceMaster, readMeaningSourceMaster, readMeaningSourceMasterForRendition, assertMeaningMasterIndexes } from '../services/outcomeMeaningSourceMasterService.js'

afterEach(() => jest.restoreAllMocks())
test('meaning-only record retains exact approved meaning and failed expression history without content promotion', async () => {
  const f = meaningMasterRecordFixture(), before = JSON.stringify(f.envelope)
  await new Master(f.record).validate()
  expect(new Master(f.record).toObject().body.sourceSnapshot.selectedPacks).toEqual({})
  expect(f.record.body.sourceSnapshot.meaning.workingDraft).toEqual(f.envelope.source.content.workingDraft)
  expect(f.record.body.sourceSnapshot.meaning.approvedMeaning).toEqual(f.envelope.source.content.approvedMeaning)
  expect(f.record.body.sourceSnapshot.reviewState).toEqual(f.envelope.source.reviewState)
  expect(f.record.body.sourceSnapshot.stageRefs[5].status).toBe('FAILED')
  expect(f.record.body.sourceSnapshot).not.toHaveProperty('content.shaping')
  expect(JSON.stringify(f.envelope)).toBe(before)
})
test.each([...MEANING_MASTER_FLAGS, 'purpose', 'permittedUse', 'classification', 'status', 'version'])('rejects altered %s after body hash recomputation', field => {
  const f = meaningMasterRecordFixture()
  f.record.body[field] = MEANING_MASTER_FLAGS.includes(field) ? true : 'ALTERED'
  f.rehash()
  expect(() => assertMeaningMasterRecord(f.record)).toThrow()
})
test.each([
  ['unknown body field', f => { f.record.body.extra = true }],
  ['unknown outer field', f => { f.record.extra = true }],
  ['unknown projection field', f => { f.record.body.sourceSnapshot.extra = true }],
  ['array actor', f => { f.record.body.createdBy = [f.actorUserId] }],
  ['malformed master ID', f => { f.record.masterId = f.record.body.masterId = 'meaning_master_' + '-'.repeat(36) }],
  ['array master ID', f => { f.record.masterId = f.record.body.masterId = [f.record.masterId] }],
  ['noncanonical time', f => { f.record.body.createdAt = '2026-10-29 14:00:00Z' }],
  ['foreign scope', f => { f.record.customerId = '507f1f77bcf86cd799439099' }],
  ['changed meaning', f => { f.record.body.sourceSnapshot.meaning.workingDraft.title += ' changed' }],
  ['missing history', f => { f.record.body.sourceSnapshot.stageRefs.pop() }],
  ['missing audit', f => { delete f.record.auditId }],
  ['body overflow', f => { f.record.body.sourceSnapshot.selectedPacks.large = 'x'.repeat(1024 ** 2) }],
  ['BSON overflow', f => { f.record.body.sourceSnapshot.selectedPacks.large = Array(250000).fill(0) }],
])('record rejects %s', (_name, change) => {
  const f = meaningMasterRecordFixture(); change(f); f.rehash()
  expect(() => assertMeaningMasterRecord(f.record)).toThrow()
})
test.each(['authoritative', 'authorisesApproval', 'renderingAvailable', 'deliveryAvailable'])('source %s cannot be promoted', flag => {
  const f = meaningSourceMasterFixture(); f.envelope[flag] = true
  expect(() => projectMeaningMasterSource(f.envelope)).toThrow()
})
test('model-owned signed audit must bind exact body, creator and scope', () => {
  const f = meaningMasterRecordFixture()
  const audit = new Audit({ _id: f.record.auditId, actorUserId: f.actorUserId, action: 'OUTCOME_MEANING_SOURCE_RECORDED',
    resourceType: 'OutcomeMeaningSourceMaster', resourceId: f.record._id, scope: f.scope, diff: meaningMasterAuditDiff(f.record) })
  audit.generateSignature(); f.record.auditSignatureVersion = audit.signatureVersion
  const verify = row => Audit.hydrate(row).verifySignature()
  expect(() => assertMeaningMasterAudit(f.record, audit.toObject(), verify)).not.toThrow()
  const changed = audit.toObject(); changed.diff.sourceFingerprint = '0'.repeat(64)
  expect(() => assertMeaningMasterAudit(f.record, changed, verify)).toThrow()
})
test.each(['bulkWrite', 'insertMany', 'updateOne', 'replaceOne', 'deleteMany'])('actual ODM %s refuses before the collection', async operation => {
  const write = jest.spyOn(Master.collection, operation).mockResolvedValue({ acknowledged: true })
  const promise = operation === 'bulkWrite' ? Master.bulkWrite([{ insertOne: { document: meaningMasterRecordFixture().record } }], { skipValidation: true })
    : operation === 'insertMany' ? Master.insertMany([meaningMasterRecordFixture().record], { lean: true })
      : operation === 'deleteMany' ? Master.deleteMany({}) : Master[operation]({}, { body: {} })
  await expect(promise).rejects.toMatchObject({ details: { reason: 'MASTER_IMMUTABLE', contentIncludedInError: false } })
  expect(write).not.toHaveBeenCalled()
})
test('save with skipped validation still rejects invalid new records and all existing changes', async () => {
  const write = jest.spyOn(Master.collection, 'insertOne').mockResolvedValue({ acknowledged: true })
  const f = meaningMasterRecordFixture(); f.record.body.authorisesApproval = true; f.rehash()
  await expect(new Master(f.record).save({ validateBeforeSave: false })).rejects.toThrow()
  const document = new Master(meaningMasterRecordFixture().record); document.isNew = false
  await expect(document.save({ validateBeforeSave: false })).rejects.toThrow()
  expect(write).not.toHaveBeenCalled()
})
test('index verification rejects partial, wrong order and missing indexes', async () => {
  const valid = Object.entries(MEANING_MASTER_INDEXES).map(([name, key]) => ({ name, key, unique: true }))
  await expect(assertMeaningMasterIndexes({ collection: { indexes: async () => valid } })).resolves.toBeUndefined()
  for (const invalid of [valid.slice(1), [{ ...valid[0], sparse: true }, ...valid.slice(1)],
    [{ ...valid[0], key: Object.fromEntries(Object.entries(valid[0].key).reverse()) }, ...valid.slice(1)]]) {
    await expect(assertMeaningMasterIndexes({ collection: { indexes: async () => invalid } })).rejects.toThrow()
  }
})

// Unit transaction staging only; real rollback/concurrency are separate isolated evidence.
const store = () => {
  const f = meaningSourceMasterFixture(), rows = [], audits = [], pending = { rows: [], audits: [] }
  const query = (list, filter) => {
    let session
    return { maxTimeMS() { return this }, session(value) { session = value; return this }, async lean() {
      return [...list, ...(session ? list === rows ? pending.rows : pending.audits : [])].find(row => Object.entries(filter).every(([k, v]) => String(row[k]) === String(v))) || null
    } }
  }
  const endSession = jest.fn(), transaction = { async withTransaction(fn) {
    try { await fn(); rows.push(...pending.rows); audits.push(...pending.audits) }
    finally { pending.rows = []; pending.audits = [] }
  }, endSession }
  const model = { collection: { indexes: async () => Object.entries(MEANING_MASTER_INDEXES).map(([name, key]) => ({ name, key, unique: true })) },
    db: { startSession: async () => transaction }, findOne: filter => query(rows, filter),
    async create([row]) { await new Master(row).validate(); pending.rows.push(row); return [row] } }
  const auditModel = { findOne: filter => query(audits, filter), prototype: Audit.prototype }
  const writer = { async log(input) { const audit = new Audit(input); audit.generateSignature(); const row = audit.toObject(); pending.audits.push(row); return row } }
  const readSource = jest.fn(async () => f.envelope)
  const args = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId,
    payload: { requestKey: 'unit-master-request', expectedSourceFingerprint: f.envelope.sourceFingerprint },
    deps: { Master: model, Audit: auditModel, auditService: writer, authorize: async () => f.scope, readSource } }
  return { ...f, rows, audits, args, readSource, model, writer, endSession }
}
test('service saves/readbacks exact snapshot and signed audit; replay preserves original actor', async () => {
  const hydrate = jest.spyOn(Audit, 'hydrate').mockImplementation(() => { throw Error('MUST_VERIFY_RAW_AUDIT') })
  const f = store(), first = await createMeaningSourceMaster(f.args)
  expect(first.idempotent).toBe(false)
  expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1)
  const second = await createMeaningSourceMaster({ ...f.args, actorUserId: '507f1f77bcf86cd799439099' })
  expect(second.idempotent).toBe(true)
  expect(second.master).toEqual(first.master)
  expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1)
  expect(await readMeaningSourceMaster({ ...f.args, masterId: first.master.masterId, version: 1 })).toEqual({ master: first.master })
  expect(f.endSession).toHaveBeenCalledTimes(2)
  expect(hydrate).not.toHaveBeenCalled()
})
test('different key for same source conflicts without appending', async () => {
  const f = store(); await createMeaningSourceMaster(f.args)
  await expect(createMeaningSourceMaster({ ...f.args, payload: { ...f.args.payload, requestKey: 'different-request' } }))
    .rejects.toMatchObject({ details: { reason: 'MEANING_SOURCE_ALREADY_RECORDED', contentIncludedInError: false } })
  expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1)
})

test('server-only rendition read binds the durable reference and matched fresh source without changing public metadata', async () => {
  const f = store(), created = await createMeaningSourceMaster(f.args)
  const args = { ...f.args, masterId: created.master.masterId, version: 1 }
  const privateRead = await readMeaningSourceMasterForRendition(args)
  expect(privateRead.master).toEqual(created.master)
  expect(privateRead.sourceEnvelope).toEqual(f.envelope)
  expect(privateRead.masterReference).toMatchObject({ masterId: created.master.masterId, version: 1,
    storageId: String(f.rows[0]._id), bodyFingerprint: f.rows[0].bodyFingerprint,
    auditId: String(f.rows[0].auditId), sourceFingerprint: f.envelope.sourceFingerprint })
  expect(await readMeaningSourceMaster(args)).toEqual({ master: created.master })
  privateRead.sourceEnvelope.source.reviewState.status = 'MUTATED_COPY'
  expect(f.envelope.source.reviewState.status).toBe('FAILED')
  expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1)
})

test.each(['missing', 'stale', 'audit', 'permission'])('server-only rendition read refuses %s', async kind => {
  const f = store(), created = await createMeaningSourceMaster(f.args)
  if (kind === 'missing') f.rows.length = 0
  if (kind === 'stale') { f.envelope.source.basis.basisStateVersion = 'changed'; f.seal() }
  if (kind === 'audit') f.audits[0].signature = 'invalid'
  if (kind === 'permission') f.args.deps.authorize = async () => { throw Error('PERMISSION_DENIED') }
  await expect(readMeaningSourceMasterForRendition({ ...f.args, masterId: created.master.masterId, version: 1 })).rejects.toThrow()
})
test('required audit failure leaves no staged master or audit', async () => {
  const f = store(); f.writer.log = async () => { throw Error('REQUIRED_AUDIT_FAILED') }
  await expect(createMeaningSourceMaster(f.args)).rejects.toThrow('REQUIRED_AUDIT_FAILED')
  expect(f.rows).toHaveLength(0); expect(f.audits).toHaveLength(0)
  expect(f.endSession).toHaveBeenCalled()
})
test.each([2, 3])('source observation drift at call %s aborts or refuses stale committed history', async call => {
  const f = store(), changed = JSON.parse(JSON.stringify(f.envelope))
  changed.source.basis.basisStateVersion = 'changed-state'; changed.sourceFingerprint = membershipHash(changed.source)
  let count = 0; f.readSource.mockImplementation(async () => ++count >= call ? changed : f.envelope)
  await expect(createMeaningSourceMaster(f.args)).rejects.toThrow()
  expect(f.rows).toHaveLength(call === 2 ? 0 : 1)
  expect(f.audits).toHaveLength(call === 2 ? 0 : 1)
})
test('foreign selected scope and unexpected request fields fail without writes', async () => {
  const f = store()
  await expect(createMeaningSourceMaster({ ...f.args, scopes: { tenant: { _id: '507f1f77bcf86cd799439099' } } })).rejects.toThrow()
  await expect(createMeaningSourceMaster({ ...f.args, payload: { ...f.args.payload, authoritative: true } })).rejects.toThrow()
  expect(f.rows).toHaveLength(0)
})

test.each(['meaning_master_' + '-'.repeat(36), ['meaning_master_12345678-1234-1234-1234-123456789012']])('read rejects noncanonical master ID %j before context', async masterId => {
  const f = store()
  await expect(readMeaningSourceMaster({ ...f.args, masterId, version: 1 })).rejects.toMatchObject({ status: 422 })
  expect(f.readSource).not.toHaveBeenCalled()
})
test.each(['create', 'read'])('deadline crossed during final %s audit lookup refuses success', async operation => {
  const f = store(), first = operation === 'read' ? await createMeaningSourceMaster(f.args) : null
  let now = Date.now(); jest.spyOn(Date, 'now').mockImplementation(() => now)
  const original = f.args.deps.Audit.findOne
  f.args.deps.Audit.findOne = filter => {
    const query = original(filter), lean = query.lean
    query.lean = async () => { const row = await lean.call(query); now += 480001; return row }
    return query
  }
  const work = operation === 'read' ? readMeaningSourceMaster({ ...f.args, masterId: first.master.masterId, version: 1 }) : createMeaningSourceMaster(f.args)
  await expect(work).rejects.toMatchObject({ details: { reason: 'MASTER_OBSERVATION_DEADLINE', contentIncludedInError: false } })
  expect(f.rows).toHaveLength(1)
})
test('an unrelated duplicate-index name with the owned pattern is not swallowed', async () => {
  const f = store(), keyPattern = MEANING_MASTER_INDEXES.meaning_master_scope_request_unique
  const unrelated = Object.assign(new Error('E11000 duplicate key error index: other_meaning_master_scope_request_unique_suffix dup key: {}'), { code: 11000, keyPattern })
  f.model.create = async () => { throw unrelated }
  await expect(createMeaningSourceMaster(f.args)).rejects.toBe(unrelated)
  expect(f.rows).toHaveLength(0); expect(f.audits).toHaveLength(0)
})
