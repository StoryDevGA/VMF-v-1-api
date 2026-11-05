import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Master from '../../models/OutcomeMeaningSourceMaster.js'
import Audit from '../../models/AuditLog.js'
import auditService from '../../services/auditService.js'
import { createMeaningSourceMaster, readMeaningSourceMaster } from '../../services/outcomeMeaningSourceMasterService.js'
import { assertMeaningMasterRecord, assertMeaningMasterAudit, MEANING_MASTER_FLAGS } from '../../services/outcomeMeaningSourceMasterContract.js'
import { membershipHash } from '../../services/runtimeEvidenceSnapshotContract.js'
import { meaningSourceMasterFixture } from './meaningSourceMasterFixture.js'

// Repeatable real-persistence cases; caller MUST supply the separately reviewed
// exact-database fence/supervisor. Fixture source seams prove storage, not provenance.
export const runMeaningMasterPersistenceCases = async ({ prefix, registerCase, recordCase }) => {
  assert.equal(mongoose.connection.name, 'ss044_1619d7db635949898c9abb4592d10bcf')
  assert(/^qa-ss055-master-[a-f0-9]{8}$/.test(prefix))
  const results = []
  const run = async (name, fn) => {
    const result = await fn()
    const entry = { name, status: 'PASS', sourceProof: 'UNSIGNED_TEST_SEAM_NOT_GENUINE_REVIEW', ...result }
    results.push(entry); await recordCase(entry)
  }
  const make = name => {
    const f = meaningSourceMasterFixture(new mongoose.Types.ObjectId().toString())
    const requestKey = prefix + '-' + name
    registerCase({ scope: f.scope, actorUserIds: [f.actorUserId], sourceFingerprint: f.envelope.sourceFingerprint,
      requestKeys: [requestKey], sourceProof: 'UNSIGNED_TEST_FIXTURE' })
    return { ...f, requestKey, args: { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId,
      payload: { requestKey, expectedSourceFingerprint: f.envelope.sourceFingerprint },
      deps: { authorize: async () => f.scope, readSource: async () => f.envelope } } }
  }
  const pairCount = async key => ({ masters: await Master.countDocuments({ requestKey: key }),
    audits: await Audit.countDocuments({ action: 'OUTCOME_MEANING_SOURCE_RECORDED', 'diff.requestKey': key }) })
  const verifyDurable = async args => {
    const row = await Master.findOne({ ...args.scope, requestKey: args.requestKey }).lean()
    assert(row); assertMeaningMasterRecord(row)
    const audit = await Audit.findOne({ _id: row.auditId }).lean()
    assertMeaningMasterAudit(row, audit, value => Audit.prototype.verifySignature.call(value))
    assert(MEANING_MASTER_FLAGS.every(key => row.body[key] === false))
    assert.deepEqual(row.body.sourceSnapshot.meaning.workingDraft, args.envelope.source.content.workingDraft)
    assert.deepEqual(row.body.sourceSnapshot.meaning.approvedMeaning, args.envelope.source.content.approvedMeaning)
    assert.deepEqual(row.body.sourceSnapshot.reviewState, args.envelope.source.reviewState)
    return row
  }
  await run('rollback-after-required-audit-insert', async () => {
    const f = make('audit-rollback')
    f.args.deps.auditService = { log: async (...args) => { await auditService.log(...args); throw Error('INJECTED_AFTER_AUDIT_INSERT') } }
    await assert.rejects(createMeaningSourceMaster(f.args), /INJECTED_AFTER_AUDIT_INSERT/)
    assert.deepEqual(await pairCount(f.requestKey), { masters: 0, audits: 0 })
    return { durablePairCount: 0 }
  })
  await run('rollback-after-master-and-audit-inserts', async () => {
    const f = make('master-rollback')
    f.args.deps.Master = new Proxy(Master, { get(target, key) {
      if (key === 'create') return async (...args) => { await target.create(...args); throw Error('INJECTED_AFTER_MASTER_INSERT') }
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
    } })
    await assert.rejects(createMeaningSourceMaster(f.args), /INJECTED_AFTER_MASTER_INSERT/)
    assert.deepEqual(await pairCount(f.requestKey), { masters: 0, audits: 0 })
    return { durablePairCount: 0 }
  })
  await run('pre-write-source-drift', async () => {
    const f = make('pre-drift'), changed = JSON.parse(JSON.stringify(f.envelope))
    changed.source.basis.basisStateVersion = 'fixture-changed-state'; changed.sourceFingerprint = membershipHash(changed.source)
    let calls = 0; f.args.deps.readSource = async () => ++calls === 1 ? f.envelope : changed
    await assert.rejects(createMeaningSourceMaster(f.args), error => error.details?.reason === 'MASTER_SOURCE_CHANGED')
    assert.deepEqual(await pairCount(f.requestKey), { masters: 0, audits: 0 })
    return { durablePairCount: 0 }
  })
  await run('same-key-concurrency-replay-and-immutability', async () => {
    const f = make('same-key-race')
    const [one, two] = await Promise.all([createMeaningSourceMaster(f.args), createMeaningSourceMaster(f.args)])
    assert.equal(one.master.masterId, two.master.masterId)
    assert(one.idempotent || two.idempotent)
    assert.deepEqual(await pairCount(f.requestKey), { masters: 1, audits: 1 })
    const row = await verifyDurable(f), before = membershipHash(row)
    const replay = await createMeaningSourceMaster(f.args)
    assert(replay.idempotent); assert.equal(replay.master.masterId, row.masterId)
    assert.deepEqual((await readMeaningSourceMaster({ ...f.args, masterId: row.masterId, version: 1 })).master, replay.master)
    const otherKey = prefix + '-duplicate-source'
    await assert.rejects(createMeaningSourceMaster({ ...f.args, payload: { ...f.args.payload, requestKey: otherKey } }),
      error => error.details?.reason === 'MEANING_SOURCE_ALREADY_RECORDED')
    await assert.rejects(createMeaningSourceMaster({ ...f.args, payload: { ...f.args.payload, expectedSourceFingerprint: '0'.repeat(64) } }),
      error => error.details?.reason === 'MASTER_SOURCE_CHANGED')
    for (const mutation of [() => Master.updateOne({ _id: row._id }, { $set: { permittedUse: 'APPROVED' } }),
      () => Master.deleteOne({ _id: row._id }), () => Master.bulkWrite([{ deleteOne: { filter: { _id: row._id } } }])]) {
      await assert.rejects(mutation(), error => error.details?.reason === 'MASTER_IMMUTABLE')
    }
    assert.equal(membershipHash(await Master.findOne({ _id: row._id }).lean()), before)
    return { masterId: row.masterId, durablePairCount: 1, exactReplay: true }
  })
  await run('different-key-source-index-race', async () => {
    const f = make('source-race-a'), otherKey = prefix + '-source-race-b'
    registerCase({ scope: f.scope, actorUserIds: [f.actorUserId], sourceFingerprint: f.envelope.sourceFingerprint,
      requestKeys: [otherKey], sourceProof: 'UNSIGNED_TEST_FIXTURE' })
    const outcomes = await Promise.allSettled([createMeaningSourceMaster(f.args),
      createMeaningSourceMaster({ ...f.args, payload: { ...f.args.payload, requestKey: otherKey } })])
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
    const rejected = outcomes.find(result => result.status === 'rejected')
    assert.equal(rejected.reason.details?.reason, 'MEANING_SOURCE_ALREADY_RECORDED')
    assert.equal(await Master.countDocuments({ ...f.scope }), 1)
    const winner = await Master.findOne({ ...f.scope }).lean()
    await verifyDurable({ ...f, requestKey: winner.requestKey })
    return { masterId: winner.masterId, durablePairCount: 1 }
  })
  await run('post-commit-drift-retains-stale-pair-and-refuses-use', async () => {
    const f = make('post-drift'), changed = JSON.parse(JSON.stringify(f.envelope))
    changed.source.basis.basisStateVersion = 'fixture-newer-state'; changed.sourceFingerprint = membershipHash(changed.source)
    let calls = 0; f.args.deps.readSource = async () => ++calls < 3 ? f.envelope : changed
    await assert.rejects(createMeaningSourceMaster(f.args), error => error.details?.reason === 'MASTER_SOURCE_STALE')
    assert.deepEqual(await pairCount(f.requestKey), { masters: 1, audits: 1 })
    const row = await verifyDurable(f)
    await assert.rejects(readMeaningSourceMaster({ ...f.args, masterId: row.masterId, version: 1 }),
      error => error.details?.reason === 'MASTER_SOURCE_STALE')
    return { masterId: row.masterId, durablePairCount: 1, rollbackClaimed: false }
  })
  return results
}
