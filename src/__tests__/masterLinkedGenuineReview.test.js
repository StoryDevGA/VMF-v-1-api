import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import Execution from '../models/GovernedReasoningExecution.js'
import Audit from '../models/AuditLog.js'
import { masterLinkedReviewSimulationFixture } from './fixtures/masterLinkedReviewSimulationFixture.js'
import { visualReviewOutput } from './fixtures/docxVisualReviewFixture.js'
import { createNetworkQaMasterLinkedReviewAuthority, createGenuineMasterLinkedReviewAuthority,
  consumeMasterLinkedReviewCapability } from '../services/masterLinkedGenuineReviewAuthorityService.js'
import { createFakeNetworkMasterLinkedDocxReviewProviderAdapter, snapshotOwnedMasterLinkedReviewResult } from '../services/openAiMasterLinkedDocxReviewProviderAdapter.js'
import { G1_MODES, G1_FIXED, g1Root, assertG1Record, assertG1Audit, assertG1Approval, hasG1Identity } from '../services/masterLinkedGenuineReviewContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'

const clone = v => JSON.parse(JSON.stringify(v))
// Real driver option validation, with no cursor iteration or network topology.
// Rows and rollback below remain unit seams, never real persistence evidence.
const offlineClient = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:1', { serverSelectionTimeoutMS: 1 })
const offlineCollection = offlineClient.db('ss044_1619d7db635949898c9abb4592d10bcf').collection('governed_reasoning_executions')
const connect = jest.spyOn(offlineClient, 'connect').mockRejectedValue(new Error('NETWORK_FORBIDDEN'))
afterAll(async () => { expect(connect).not.toHaveBeenCalled(); expect(offlineClient.topology).toBeUndefined(); await offlineClient.close() })
const store = async () => {
  const f = await masterLinkedReviewSimulationFixture(), rows = [], audits = [], counter = { prepares: 0 }, queryOptions = [], transactionBudgets = []
  // Unit-only snapshots do not establish real rollback or concurrent commits.
  const db = { startSession: async () => {
    const session = offlineClient.startSession(), run = session.withTransaction.bind(session)
    session.withTransaction = async (fn, options) => {
      transactionBudgets.push(options.timeoutMS)
      return run(async () => {
        const before = [...rows], old = [...audits]
        try { return await fn() } catch (e) { rows.splice(0, rows.length, ...before); audits.splice(0, audits.length, ...old); throw e }
      }, options)
    }
    return session
  } }
  const model = (records, indexes, create) => ({ db, prototype: Audit.prototype, collection: { indexes: async () => indexes }, create,
    findOne: filter => { const options = {}, q = { setOptions: value => { Object.assign(options, value); return q }, session: value => { options.session = value; return q }, lean: async () => {
      const cursor = offlineCollection.find(filter, options)
      queryOptions.push({ timeoutMS: options.timeoutMS, hasTimeout: Object.hasOwn(options, 'timeoutMS'), transaction: options.session?.inTransaction() === true })
      await cursor.close()
      return records.find(r => Object.entries(filter).every(([k, v]) => String(r[k]) === String(v)))
    } }; return q } })
  const execution = model(rows, [{ name: 'runtimeInstanceId_1_idempotencyKey_1', key: { runtimeInstanceId: 1, idempotencyKey: 1 }, unique: true,
    partialFilterExpression: { idempotencyKey: { $exists: true, $gt: '' } } }], async values => {
    for (const row of values) { await new Execution(row).validate(); rows.push(row) } return values
  })
  const deps = { ...f.args.deps, Execution: execution, Audit: model(audits, [{ name: '_id_', key: { _id: 1 } }]),
    prepareTransport: async () => { counter.prepares++; return f.args.deps.prepareTransport() }, auditService: { log: jest.fn(async value => {
      const doc = new Audit(value); doc.generateSignature(); const row = doc.toObject(); audits.push(row); return row
    }) } }
  const { executionMode: _mode, deps: _deps, ...args } = f.args
  args.qaCase = 'unit-one'
  const owner = createNetworkQaMasterLinkedReviewAuthority(deps)
  return { ...f, rows, audits, deps, args, owner, counter, queryOptions, transactionBudgets,
    lookup: grant => ({ actorUserId: args.actorUserId, scopes: args.scopes, grantExecutionId: grant.body.executionId }) }
}
const response = (output = visualReviewOutput(), status = 'completed', id = 'resp_unit_one', model = 'gpt-5.2') => new Response(JSON.stringify({ id, model, status,
  output: status === 'completed' ? [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] : [] }), { headers: { 'x-request-id': 'req_unit' } })
const adapter = fetchImpl => createFakeNetworkMasterLinkedDocxReviewProviderAdapter({ fetchImpl, sleep: async () => {} })

test('fake POST and GET preserve strict signed authority/start/response and owned v2 result', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args), fetch = jest.fn().mockImplementationOnce(async () => response(undefined, 'queued')).mockImplementationOnce(async () => response())
  const result = await adapter(fetch)(grant.capability), snapshot = snapshotOwnedMasterLinkedReviewResult(result)
  expect(fetch.mock.calls.map(c => c[1].method)).toEqual(['POST', 'GET'])
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer SS055_FAKE_NETWORK_ONLY' } })
  expect(JSON.parse(fetch.mock.calls[0][1].body).input[0].content[2].image_url).toContain('data:image/png;base64,')
  expect(snapshot).toMatchObject({ genuineProviderEligible: false, completionPersisted: false, approvalAvailable: false, receipt: { mode: G1_MODES.QA, ...f.args.expected } })
  expect(f.rows).toHaveLength(3); expect(f.audits).toHaveLength(4); expect(f.counter.prepares).toBe(2)
  for (const row of f.rows) { assertG1Record(row); assertG1Audit(row, f.audits.find(a => String(a._id) === String(row.executionEvidence.masterDocxDispatch.auditId)), a => Audit.prototype.verifySignature.call(a)) }
  expect((await f.owner.prepare(f.args)).state).toBe('REPLAY_HELD')
  await expect(adapter(fetch)(grant.capability)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(2)
})
test('installed driver rejects operation timeout inside a timeout-owned transaction before network', async () => {
  const session = offlineClient.startSession()
  try {
    await session.withTransaction(async () => {
      expect(() => offlineCollection.find({}, { session, timeoutMS: 3000 })).toThrow('An operation cannot be given a timeoutMS setting')
      const cursor = offlineCollection.find({}, { session }); await cursor.close()
    }, { timeoutMS: 20000 })
    expect(offlineClient.topology).toBeUndefined()
  } finally { await session.endSession() }
})
test('G1 transaction reads inherit owner budgets while standalone reads keep their operation timeout', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args)
  await adapter(async () => response())(grant.capability)
  expect(f.queryOptions.some(o => o.transaction)).toBe(true)
  expect(f.queryOptions.filter(o => o.transaction).every(o => o.hasTimeout === false)).toBe(true)
  expect(f.queryOptions.filter(o => !o.transaction).every(o => o.hasTimeout && o.timeoutMS > 0)).toBe(true)
  expect(f.transactionBudgets.slice(0, 3).every(b => b > 0 && b <= 20000)).toBe(true)
  expect(f.transactionBudgets.at(-1)).toBeLessThanOrEqual(50000)
  expect(f.transactionBudgets.at(-1)).toBeGreaterThan(20000)
})
test('root is tenant/customer-wide for genuine and ignores candidate actor and runtime', () => {
  const scope = { tenantId: G1_FIXED.tenantId, customerId: G1_FIXED.customerId, runtimeInstanceId: G1_FIXED.runtimeInstanceId }
  expect(g1Root(scope, G1_MODES.GENUINE)).toBe(g1Root({ ...scope, runtimeInstanceId: 'f'.repeat(24), candidateId: 'other' }, G1_MODES.GENUINE))
  expect(g1Root(scope, G1_MODES.QA, 'case-one')).not.toBe(g1Root(scope, G1_MODES.GENUINE))
  expect(g1Root(scope, G1_MODES.QA, 'case-one')).not.toBe(g1Root(scope, G1_MODES.QA, 'case-two'))
})
test.each(['qaCase', 'expected', 'permission', 'actor', 'runtime', 'overrides'])('rejects changed %s before grant writes', async kind => {
  const f = await store()
  if (kind === 'qaCase') f.args.qaCase = '../escape'
  if (kind === 'expected') f.args.expected.policyFingerprint = 'f'.repeat(64)
  if (kind === 'actor') f.args.actorUserId = 'f'.repeat(24)
  if (kind === 'runtime') f.runtime.status = 'DRAFT'
  if (kind === 'overrides') f.args.deps = {}
  if (kind === 'permission') f.deps.assertPermission = async () => { throw Error('DENIED') }
  // Dependencies are captured when the private QA constructor is called.
  const owner = createNetworkQaMasterLinkedReviewAuthority(f.deps)
  await expect(owner.prepare(f.args)).rejects.toThrow(); expect(f.rows).toHaveLength(0)
})
test('genuine owner refuses missing release before source/network/data and disallows overrides', async () => {
  expect(() => createGenuineMasterLinkedReviewAuthority({})).toThrow()
  await expect(createGenuineMasterLinkedReviewAuthority().prepare({ actorUserId: G1_FIXED.actorUserId, runtimeInstanceId: G1_FIXED.runtimeInstanceId,
    candidateId: G1_FIXED.candidateId })).rejects.toMatchObject({ details: { reason: 'GENUINE_RELEASE_REQUIRED' } })
})
test('revocation before start blocks all fake POST; replay does not recreate capability', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args), fetch = jest.fn()
  expect((await f.owner.revoke(f.lookup(grant.grant))).body.decision).toBe('REVOKED')
  await expect(adapter(fetch)(grant.capability)).rejects.toMatchObject({ details: { reason: 'START_NOT_OWNED' } })
  expect(fetch).not.toHaveBeenCalled(); expect((await f.owner.prepare(f.args)).capability).toBeUndefined()
})
test('late revocation holds approval and preserves GET-only receipt recovery without source regeneration', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args), fetch = jest.fn(async () => response())
  await adapter(fetch)(grant.capability)
  expect((await f.owner.revoke(f.lookup(grant.grant))).body.phase).toBe('HOLD_AFTER_START')
  const recovery = await f.owner.recover(f.lookup(grant.grant)), before = f.counter.prepares
  const resumed = await adapter(fetch)(recovery.capability)
  expect(f.counter.prepares).toBe(before); expect(fetch.mock.calls.at(-1)[1].method).toBe('GET')
  expect(resumed.approvalAvailable).toBe(false)
  await expect(adapter(fetch)(recovery.capability)).rejects.toThrow()
})
test('capability consumption is synchronous, mode-bound and rejects forged plain objects', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args)
  await expect(consumeMasterLinkedReviewCapability(grant.capability, G1_MODES.GENUINE)).rejects.toThrow()
  await expect(consumeMasterLinkedReviewCapability({}, G1_MODES.QA)).rejects.toThrow()
  const fetch = jest.fn(async () => response()), run = adapter(fetch)
  const settled = await Promise.allSettled([run(grant.capability), run(grant.capability)])
  expect(settled.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(fetch).toHaveBeenCalledTimes(1)
})
test('caller and returned metadata mutations cannot change private prepared request', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args)
  const expected = f.args.expected.requestIdentity
  grant.reservation.body.request.requestIdentity = 'f'.repeat(64); f.args.expected.requestIdentity = 'f'.repeat(64)
  const result = await adapter(async () => response())(grant.capability)
  expect(result.receipt.requestIdentity).toBe(expected)
  expect(() => snapshotOwnedMasterLinkedReviewResult(clone(result))).toThrow()
  result.receipt.mode = G1_MODES.GENUINE; expect(() => snapshotOwnedMasterLinkedReviewResult(result)).toThrow()
})
test('source change consumes capability without reaching provider', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args), fetch = jest.fn(); f.runtime.status = 'DRAFT'
  await expect(adapter(fetch)(grant.capability)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled()
  await expect(adapter(fetch)(grant.capability)).rejects.toThrow()
})
test.each(['id', 'model', 'refusal', 'incomplete', 'invalid', 'oversize', 'network', 'http', 'context'])('preserves %s provider failure and never resends', async kind => {
  const f = await store(), grant = await f.owner.prepare(f.args)
  const fetch = jest.fn(async () => {
    if (kind === 'network') throw Error('private provider payload')
    if (kind === 'http' || kind === 'context') return new Response(JSON.stringify({ error: { code: kind === 'context' ? 'context_length_exceeded' : 'other' } }), { status: 400 })
    if (kind === 'oversize') return new Response('x'.repeat(512 * 1024 + 1))
    if (kind === 'refusal') return new Response(JSON.stringify({ id: 'resp_unit_one', model: 'gpt-5.2', status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }))
    return response(kind === 'invalid' ? {} : undefined, kind === 'incomplete' ? 'incomplete' : 'completed', kind === 'id' ? 'bad' : 'resp_unit_one', kind === 'model' ? 'wrong' : 'gpt-5.2')
  })
  await expect(adapter(fetch)(grant.capability)).rejects.toMatchObject({ code: 'MASTER_DOCX_PROVIDER_FAILED', details: { dispatchAvailable: false } })
  await expect(adapter(fetch)(grant.capability)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1)
  expect(f.audits.at(-1).diff).toMatchObject({ kind: 'UNCERTAINTY', payload: { state: 'HELD_NO_RETRY' } })
})
test('valid seven-dimension quality FAIL remains an owned failure with no retry or approval', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args), output = visualReviewOutput(true)
  const fetch = jest.fn(async () => response(output))
  const result = await adapter(fetch)(grant.capability)
  expect(snapshotOwnedMasterLinkedReviewResult(result).output.overallStatus).toBe('FAIL')
  expect(result.approvalAvailable).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('all G1 markers are detected independently and malformed records fail the model', async () => {
  const f = await store(); await f.owner.prepare(f.args); const row = f.rows[0]
  for (const key of ['contractVersion', 'outputTypeKey', 'status', 'idempotencyKey', 'executionEvidence']) expect(hasG1Identity({ [key]: row[key] })).toBe(true)
  for (const change of [r => { r.providerMode = 'LIVE_TEST' }, r => { r.executionEvidence.masterDocxDispatch.body.subject.authoritative = true },
    r => { r.executionEvidence.masterDocxDispatch.body.extra = true }, r => { r.auditLogIds = [] },
    r => { r.executionEvidence.masterDocxDispatch.auditId = [String(r.executionEvidence.masterDocxDispatch.auditId)] }]) {
    const changed = clone(row); change(changed); await expect(new Execution(changed).validate()).rejects.toThrow()
  }
})
test('strict operator release shape cannot be replaced by an ordinary signed audit', async () => {
  const f = await store()
  expect(() => assertG1Approval({ diff: {}, signatureVersion: 3 }, f.transport.subject, f.args.expected, () => true, Date.now())).toThrow()
  expect(membershipHash(f.transport.subject)).toBe(f.args.expected.subjectFingerprint)
})
test('one issue instant prevents grant expiry exceeding30minutes when successive clock reads advance', async () => {
  const f = await store(); let time = Date.now()
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => ++time)
  try {
    const granted = await f.owner.prepare(f.args), b = granted.grant.body
    expect(Date.parse(b.expiresAt) - Date.parse(b.grantCreatedAt)).toBe(1800000)
  } finally { clock.mockRestore() }
})
test('expired grant cannot start POST, while a known response remains recoverable through GET', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args), fetch = jest.fn(async () => response())
  await adapter(fetch)(grant.capability)
  const time = Date.parse(grant.grant.body.expiresAt) + 1, clock = jest.spyOn(Date, 'now').mockReturnValue(time)
  try {
    const recovery = await f.owner.recover(f.lookup(grant.grant))
    await adapter(fetch)(recovery.capability)
    expect(fetch.mock.calls.map(c => c[1].method)).toEqual(['POST', 'GET'])
    await expect(f.owner.prepare(f.args)).rejects.toThrow()
  } finally { clock.mockRestore() }
})
test('durable response retains request/account/model binding and read exposes no completion claim', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args)
  await adapter(async () => response())(grant.capability)
  const saved = await f.owner.read(f.lookup(grant.grant))
  expect(saved).toMatchObject({ genuineReviewUsed: false, submissionState: 'KNOWN_RESPONSE', dispatchAvailable: false,
    receipts: { RESPONSE: { payload: { responseId: 'resp_unit_one', postRequestId: 'req_unit', provider: 'OPENAI', model: 'gpt-5.2' } } } })
  expect(saved.receipts.RESPONSE.payload.accountFingerprint).toMatch(/^[a-f0-9]{64}$/)
})
test('phase audit failure rolls back the unit seam and cannot issue a capability', async () => {
  const f = await store(); f.deps.auditService.log.mockRejectedValue(Error('audit unavailable'))
  await expect(f.owner.prepare(f.args)).rejects.toThrow()
  expect(f.rows).toHaveLength(0); expect(f.audits).toHaveLength(0)
})
test('strict receipt types reject arrays without coercion', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args), owned = await consumeMasterLinkedReviewCapability(grant.capability, G1_MODES.QA)
  await expect(owned.recordResponse({ responseId: ['resp_coerced'], postRequestId: '', provider: 'OPENAI', model: 'gpt-5.2', accountFingerprint: 'a'.repeat(64) }))
    .rejects.toMatchObject({ details: { reason: 'RECEIPT_PAYLOAD' } })
  expect(f.audits).toHaveLength(3)
})
test('response identity changes during polling hold the original durable response and never POST again', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args), fetch = jest.fn().mockImplementationOnce(async () => response(undefined, 'queued'))
    .mockImplementationOnce(async () => response(undefined, 'completed', 'resp_changed'))
  await expect(adapter(fetch)(grant.capability)).rejects.toMatchObject({ details: { reason: 'PROVIDER_RESPONSE_ID_CHANGED' } })
  const saved = await f.owner.read(f.lookup(grant.grant))
  expect(saved.receipts.RESPONSE.payload.responseId).toBe('resp_unit_one')
  expect(saved.receipts.UNCERTAINTY.payload.responseId).toBe('resp_unit_one')
  expect(fetch.mock.calls.filter(c => c[1].method === 'POST')).toHaveLength(1)
})
test('recovery capability rechecks permission when consumed and cannot outlive its60second budget', async () => {
  const f = await store(), grant = await f.owner.prepare(f.args)
  await adapter(async () => response())(grant.capability)
  const recovered = await f.owner.recover(f.lookup(grant.grant)), clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60001), fetch = jest.fn()
  try { await expect(adapter(fetch)(recovered.capability)).rejects.toMatchObject({ details: { reason: 'OWNER_DEADLINE' } }) } finally { clock.mockRestore() }
  expect(fetch).not.toHaveBeenCalled()
})
test('fake factory requires an explicit network and never defaults to global fetch', () => {
  expect(() => createFakeNetworkMasterLinkedDocxReviewProviderAdapter()).toThrow()
  expect(() => createFakeNetworkMasterLinkedDocxReviewProviderAdapter({ fetchImpl: null })).toThrow()
})
test('QA record accepts only its explicitly tagged release reference, retaining legacy null', async () => {
  const f = await store(); await f.owner.prepare(f.args)
  const row = clone(f.rows[0]), body = row.executionEvidence.masterDocxDispatch.body
  expect(assertG1Record(row).approval).toBeNull()
  body.approval = { kind: 'NETWORK_QA_RELEASE', auditId: 'a'.repeat(24), diffFingerprint: 'b'.repeat(64) }
  row.executionEvidence.masterDocxDispatch.bodyFingerprint = membershipHash(body)
  expect(assertG1Record(row).approval.kind).toBe('NETWORK_QA_RELEASE')
  for (const approval of [{ auditId: 'a'.repeat(24), diffFingerprint: 'b'.repeat(64) },
    { ...body.approval, kind: 'GENUINE' }, { ...body.approval, auditId: ['a'.repeat(24)] }, { ...body.approval, extra: false }]) {
    body.approval = approval; row.executionEvidence.masterDocxDispatch.bodyFingerprint = membershipHash(body)
    expect(() => assertG1Record(row)).toThrow()
  }
})

const approvalFixture = () => {
  // Pure signed-shape fixture only. This creates no application/database release
  // and cannot bypass genuine-owner user/role/source checks.
  const scope = Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map(k => [k, G1_FIXED[k]]))
  const subject = { actorUserId: G1_FIXED.actorUserId, binding: { masterReference: { scope, masterId: G1_FIXED.masterId }, candidateId: G1_FIXED.candidateId } }
  const request = { requestIdentity: 'c5a51616e1783e96a6ac7395d490ce83522de8c88b34a05fd92c91f9774bf8ff',
    subjectFingerprint: '03361f15efa60ebd630449449931a64d633d225df50b3f5d862b398bd8d60504', contextFingerprint: 'd9fba3835d2c9ddfd6195ab202543a305cb96f293e45309a99b310f85ca8015b',
    policyFingerprint: '1ac4b2f41724224645c15553c6123c7e47eb151905e902adbde9f3a02623eff4' }
  const now = Date.now(), operator = 'a'.repeat(24), diff = { version: 'ss055-genuine-release-approval.v1', approvingOperatorUserId: operator,
    appActorUserId: G1_FIXED.actorUserId, onceRoot: g1Root(scope, G1_MODES.GENUINE), scope, candidateId: G1_FIXED.candidateId,
    masterId: G1_FIXED.masterId, requestBinding: request, legacyReconciliationFingerprint: G1_FIXED.reconciliation, approvalReference: 'Pure fixture; never an actual release',
    issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1799000).toISOString(), permittedUse: 'CONTROLLED_DEVELOPMENT_TEST_ONLY', maximumAttempts: 1,
    customerApproval: false, productionUse: false, automaticFinalisation: false }
  const seal = d => { const row = new Audit({ actorUserId: operator, action: 'MASTER_GENUINE_REVIEW_RELEASE_APPROVED', resourceType: 'RuntimeInstance',
    resourceId: scope.runtimeInstanceId, scope, diff: d }); row.generateSignature(); return row.toObject() }
  return { subject, request, diff, now, seal, verify: a => Audit.prototype.verifySignature.call(a) }
}
test('pure release shape requires exact signed binding and permits receipts after expiry, never POST', () => {
  const f = approvalFixture(), audit = f.seal(f.diff)
  expect(assertG1Approval(audit, f.subject, f.request, f.verify, f.now)).toEqual(f.diff)
  expect(() => assertG1Approval(audit, f.subject, f.request, f.verify, f.now + 1800000)).toThrow()
  expect(assertG1Approval(audit, f.subject, f.request, f.verify, f.now + 1800000, false)).toEqual(f.diff)
  audit.diff.approvalReference = 'changed'; expect(() => assertG1Approval(audit, f.subject, f.request, f.verify, f.now)).toThrow()
})
test.each(['extra', 'attempts', 'customer', 'production', 'finalisation', 'scope', 'binding', 'reconciliation', 'duration', 'reference', 'operator'])(
  'pure signed release still rejects wrong %s', kind => {
    const f = approvalFixture(), d = clone(f.diff)
    if (kind === 'extra') d.extra = false
    if (kind === 'attempts') d.maximumAttempts = 2
    if (kind === 'customer') d.customerApproval = true
    if (kind === 'production') d.productionUse = true
    if (kind === 'finalisation') d.automaticFinalisation = true
    if (kind === 'scope') d.scope.runtimeInstanceId = 'f'.repeat(24)
    if (kind === 'binding') d.requestBinding.policyFingerprint = 'f'.repeat(64)
    if (kind === 'reconciliation') d.legacyReconciliationFingerprint = 'f'.repeat(64)
    if (kind === 'duration') d.expiresAt = new Date(Date.parse(d.issuedAt) + 1800001).toISOString()
    if (kind === 'reference') d.approvalReference = ' '
    if (kind === 'operator') d.approvingOperatorUserId = ['a'.repeat(24)]
    expect(() => assertG1Approval(f.seal(d), f.subject, f.request, f.verify, f.now)).toThrow()
  })
