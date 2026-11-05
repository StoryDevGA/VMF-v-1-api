import { jest } from '@jest/globals'
import Execution from '../models/GovernedReasoningExecution.js'
import Audit from '../models/AuditLog.js'
import { masterLinkedReviewSimulationFixture } from './fixtures/masterLinkedReviewSimulationFixture.js'
import { visualReviewOutput } from './fixtures/docxVisualReviewFixture.js'
import { admitMasterLinkedReviewSimulation as admit, reserveMasterLinkedReviewSimulation as reserve,
  executeMasterLinkedReviewSimulation as execute, readMasterLinkedReviewSimulation as read } from '../services/masterLinkedReviewSimulationService.js'
import { assertMasterReviewSimulationRecord, assertSimulationAudit, simulationKey, simulationReceiptId } from '../services/masterLinkedReviewSimulationContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { renditionReviewClaimFixture } from './fixtures/renditionReviewClaimFixture.js'
import { loadOutcomeMethodDocument, projectOutcomeMethodDocumentReceipt } from '../services/outcomeMethodDocumentService.js'
import { buildOpenAiMasterLinkedDocxReviewRequest } from '../services/openAiMasterLinkedDocxReviewRequest.js'

const store = async () => {
  const f = await masterLinkedReviewSimulationFixture(), executions = [], audits = [], counter = { prepares: 0 }
  // Unit storage seam only. Actual rollback/uniqueness requires the separate
  // approved reused-database sequence, never these array snapshots.
  const db = { startSession: async () => ({ withTransaction: async callback => {
    const x = [...executions], a = [...audits]
    try { return await callback() } catch (error) { executions.splice(0, executions.length, ...x); audits.splice(0, audits.length, ...a); throw error }
  }, endSession: async () => {} }) }
  const model = (rows, collection, create) => ({ db, collection: { indexes: async () => collection }, prototype: Audit.prototype,
    findOne: filter => { const query = { session: () => query, setOptions: () => query,
      lean: async () => rows.find(row => Object.entries(filter).every(([key, value]) => String(row[key]) === String(value))) }; return query }, create })
  const execution = model(executions, [{ name: 'runtimeInstanceId_1_idempotencyKey_1', key: { runtimeInstanceId: 1, idempotencyKey: 1 },
    unique: true, partialFilterExpression: { idempotencyKey: { $exists: true, $gt: '' } } }], async rows => {
    for (const row of rows) { await new Execution(row).validate(); executions.push(row) } return rows
  })
  const audit = model(audits, [{ name: '_id_', key: { _id: 1 } }])
  const prepare = f.args.deps.prepareTransport
  Object.assign(f.args.deps, { Execution: execution, Audit: audit, prepareTransport: async () => { counter.prepares++; return prepare() },
    auditService: { log: jest.fn(async data => { const doc = new Audit(data); doc.generateSignature(); const row = doc.toObject(); audits.push(row); return row }) } })
  return { ...f, executions, audits, counter, execution, audit }
}
const reply = async () => ({ responseId: 'simulated_unit_response', output: visualReviewOutput() })

test('signed simulation authority, one-use reservation, exact fake request and owned response; replay held', async () => {
  const f = await store(), simulate = jest.fn(reply), result = await execute({ ...f.args, simulate })
  expect(result).toMatchObject({ simulationOnly: true, genuineReviewUsed: false, completionPersisted: false, approvalAvailable: false })
  expect(simulate).toHaveBeenCalledTimes(1); expect(f.counter.prepares).toBe(2)
  expect(JSON.parse(simulate.mock.calls[0][0]).input[0].content[2].image_url).toContain('data:image/png;base64,')
  expect(f.executions).toHaveLength(2); expect(f.audits).toHaveLength(3)
  for (const row of f.executions) {
    assertMasterReviewSimulationRecord(row)
    assertSimulationAudit(row, f.audits.find(a => String(a._id) === String(row.executionEvidence.masterLinkedReview.auditId)), a => Audit.prototype.verifySignature.call(a))
  }
  expect(await execute({ ...f.args, simulate })).toMatchObject({ state: 'REPLAY_HELD', genuineReviewUsed: false })
  expect(simulate).toHaveBeenCalledTimes(1)
  const saved = await read(f.args); expect(saved.receipts.RESPONSE.payload.responseId).toBe('simulated_unit_response')
  expect(saved.receipts.UNCERTAINTY).toBeUndefined(); expect(saved.reservation.executeSimulation).toBeUndefined()
})
test.each([undefined, 'LIVE', 'GENUINE', 'LIVE_TEST'])('refuses %s mode before any dependency', async executionMode => {
  const prepareTransport = jest.fn()
  await expect(execute({ executionMode, simulate: reply, deps: { prepareTransport } })).rejects.toMatchObject({ details: { reason: 'GENUINE_REVIEW_HELD' } })
  expect(prepareTransport).not.toHaveBeenCalled()
})
test('requires explicit fake callback before preparation and writes', async () => {
  const f = await store(); await expect(execute(f.args)).rejects.toThrow(); expect(f.counter.prepares).toBe(0); expect(f.executions).toHaveLength(0)
})
test('only the first synchronous capability consumer can submit', async () => {
  const f = await store(); await admit(f.args); const saved = await reserve(f.args), simulate = jest.fn(reply)
  const results = await Promise.allSettled([saved.executeSimulation(simulate), saved.executeSimulation(simulate)])
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect(simulate).toHaveBeenCalledTimes(1)
  expect((await reserve(f.args)).executeSimulation).toBeUndefined()
})
test('returned metadata and caller hashes cannot mutate private capability joins', async () => {
  const f = await store(); await admit(f.args); const saved = await reserve(f.args)
  saved.body.request.requestIdentity = 'f'.repeat(64); f.args.expected.requestIdentity = 'f'.repeat(64)
  const result = await saved.executeSimulation(reply); expect(result.receipt.request.requestIdentity).not.toBe('f'.repeat(64))
})
test.each(['hash', 'permission', 'runtime', 'actor'])('refuses changed %s before authority write', async kind => {
  const f = await store()
  if (kind === 'hash') f.args.expected.requestIdentity = 'f'.repeat(64)
  if (kind === 'permission') f.args.deps.assertPermission = async () => { throw Error('DENIED') }
  if (kind === 'runtime') f.runtime.status = 'DRAFT'
  if (kind === 'actor') f.args.actorUserId = 'f'.repeat(24)
  await expect(admit(f.args)).rejects.toThrow(); expect(f.executions).toHaveLength(0)
})
test('source change after reservation holds its consumed slot without fake submission', async () => {
  const f = await store(); await admit(f.args); const saved = await reserve(f.args), simulate = jest.fn(reply)
  f.runtime.status = 'DRAFT'; await expect(saved.executeSimulation(simulate)).rejects.toThrow()
  expect(simulate).not.toHaveBeenCalled(); expect(f.audits.at(-1).diff.payload).toMatchObject({ reason: 'SIMULATION_SOURCE_CHANGED', state: 'HELD_NO_RETRY' })
  await expect(saved.executeSimulation(simulate)).rejects.toThrow()
})
test.each(['callback', 'identity', 'output', 'receipt'])('preserves %s failure and refuses a resend', async kind => {
  const f = await store(), writer = f.args.deps.auditService.log
  let injected = false
  if (kind === 'receipt') f.args.deps.auditService.log = async (data, options) => {
    if (data.action.endsWith('RESPONSE_RECORDED') && !injected) { injected = true; throw Error('WRITE_FAILED') } return writer(data, options)
  }
  const simulate = jest.fn(async () => {
    if (kind === 'callback') throw Error('FAILED')
    return { responseId: kind === 'identity' ? 'resp_real_is_forbidden' : 'simulated_unit_response', output: kind === 'output' ? {} : visualReviewOutput() }
  })
  await expect(execute({ ...f.args, simulate })).rejects.toThrow()
  const saved = await read(f.args); expect(saved.receipts.UNCERTAINTY.payload.state).toBe('HELD_NO_RETRY')
  expect(await execute({ ...f.args, simulate })).toMatchObject({ state: 'REPLAY_HELD' }); expect(simulate).toHaveBeenCalledTimes(1)
})
test.each(['audit', 'create', 'index'])('fails closed on %s with no authority capability', async kind => {
  const f = await store()
  if (kind === 'audit') f.args.deps.auditService.log = async () => { throw Error('AUDIT_FAILED') }
  if (kind === 'create') f.execution.create = async () => { throw Error('CREATE_FAILED') }
  if (kind === 'index') f.execution.collection.indexes = async () => []
  await expect(admit(f.args)).rejects.toThrow(); expect(f.executions).toHaveLength(0)
})
test('detects tampered signed records and receipts', async () => {
  const f = await store(); await execute({ ...f.args, simulate: reply })
  const reservation = f.executions.find(row => row.idempotencyKey === simulationKey(f.plan.planId, 'RESERVATION'))
  const receipt = f.audits.find(row => String(row._id) === simulationReceiptId('RESPONSE', reservation.executionId))
  receipt.diff.payload.responseId = 'simulated_changed'; await expect(read(f.args)).rejects.toThrow()
})

test('snapshots callback and reply output across asynchronous preparation and receipt storage', async () => {
  const f = await store(), original = f.args.deps.prepareTransport, first = jest.fn(reply), other = jest.fn(reply)
  const args = { ...f.args, simulate: first }; let prepares = 0
  f.args.deps.prepareTransport = async value => { if (++prepares === 1) args.simulate = other; return original(value) }
  const material = { responseId: 'simulated_snapshot', output: visualReviewOutput() }, writer = f.args.deps.auditService.log
  first.mockImplementation(async () => material)
  f.args.deps.auditService.log = async (data, options) => {
    if (data.action.endsWith('RESPONSE_RECORDED')) material.output.overallStatus = 'FAIL'
    return writer(data, options)
  }
  const result = await execute(args)
  expect(result.output.overallStatus).toBe('PASS'); expect(first).toHaveBeenCalledTimes(1); expect(other).not.toHaveBeenCalled()
})

test.each(['transport', 'method', 'pack', 'binding', 'policy', 'audit type', 'authority type'])('strict ledger rejects resealed %s', async kind => {
  const f = await store(); await admit(f.args); const row = JSON.parse(JSON.stringify(f.executions[0])), e = row.executionEvidence.masterLinkedReview, b = e.body
  // Retain BSON IDs for this pure-contract check; body dictionaries are plain.
  row._id = f.executions[0]._id; e.auditId = f.executions[0].executionEvidence.masterLinkedReview.auditId
  if (kind === 'transport') b.subject.transport.model = 'other'
  if (kind === 'method') b.subject.method.extra = true
  if (kind === 'pack') b.subject.packs.STYLE.extra = true
  if (kind === 'binding') b.subject.binding.extra = true
  if (kind === 'policy') b.subject.policy.permittedUse = 'CUSTOMER_APPROVED'
  if (kind === 'audit type') e.auditId = { toString: () => 'f'.repeat(24) }
  if (kind === 'authority type') {
    b.phase = 'RESERVATION'; row.status = 'MASTER_SIMULATION_RESERVED'; row.idempotencyKey = simulationKey(b.planId, b.phase)
    b.authority = { executionId: { toString: () => b.executionId }, bodyFingerprint: 'f'.repeat(64) }
  }
  b.request.subjectFingerprint = membershipHash(b.subject)
  if (kind !== 'authority type') e.bodyFingerprint = membershipHash(b)
  expect(() => assertMasterReviewSimulationRecord(row)).toThrow()
})

test('signed but contradictory known-response receipts cannot read as success', async () => {
  const f = await store(); await expect(execute({ ...f.args, simulate: async () => ({ responseId: 'simulated_known', output: {} }) })).rejects.toThrow()
  const uncertainty = f.audits.find(row => row.diff.kind === 'UNCERTAINTY'), doc = new Audit(uncertainty)
  doc.diff.payload.responseId = 'simulated_other'; doc.generateSignature()
  f.audits.splice(f.audits.indexOf(uncertainty), 1, doc.toObject())
  await expect(read(f.args)).rejects.toMatchObject({ details: { reason: 'SIMULATION_RESPONSE_CONFLICT' } })
})

test('late callback still records its known identity and uncertainty without retry', async () => {
  const f = await store(), now = Date.now(), spy = jest.spyOn(Date, 'now').mockReturnValue(now)
  try {
    await expect(execute({ ...f.args, simulate: async () => { spy.mockReturnValue(now + 600001); return reply() } })).rejects.toThrow()
    expect(f.audits.some(row => row.diff.kind === 'RESPONSE')).toBe(true)
    expect(f.audits.find(row => row.diff.kind === 'UNCERTAINTY').diff.payload.reason).toBe('SIMULATION_DEADLINE')
  } finally { spy.mockRestore() }
})

test('late replay cannot return successful metadata', async () => {
  const f = await store(); await admit(f.args)
  const now = Date.now(), spy = jest.spyOn(Date, 'now').mockReturnValue(now), original = f.audit.findOne
  f.audit.findOne = filter => { const query = original(filter), lean = query.lean; query.lean = async () => { const row = await lean(); spy.mockReturnValue(now + 600001); return row }; return query }
  try { await expect(admit(f.args)).rejects.toMatchObject({ details: { reason: 'SIMULATION_DEADLINE' } }) } finally { spy.mockRestore() }
})

test('late empty read cannot return successful metadata', async () => {
  const f = await store(), now = Date.now(), spy = jest.spyOn(Date, 'now').mockReturnValue(now), original = f.execution.findOne
  f.execution.findOne = filter => { const query = original(filter), lean = query.lean; query.lean = async () => { const row = await lean(); spy.mockReturnValue(now + 600001); return row }; return query }
  try { await expect(read(f.args)).rejects.toMatchObject({ details: { reason: 'SIMULATION_DEADLINE' } }) } finally { spy.mockRestore() }
})

test('accepts actual method-loader chunks that preserve a surrogate pair at the boundary', async () => {
  const f = await store(), m = renditionReviewClaimFixture(), content = 'a'.repeat(7999) + '😀' + 'b'.repeat(7999)
  const { createHash } = await import('node:crypto'), contentHash = `sha256:${createHash('sha256').update(content).digest('hex')}`
  const selection = { ...m.methodPack, contentHash }, document = await loadOutcomeMethodDocument({ role: 'RL', selection,
    loadPackContent: async () => ({ ...selection, available: true, content }) })
  expect(content.length).toBe(16000); expect(document.chunks).toHaveLength(3)
  f.transport.context.methodDocument = document; f.transport.subject.method = projectOutcomeMethodDocumentReceipt(document)
  f.transport.context.lineage.subjectFingerprint = membershipHash(f.transport.subject); f.transport.contextFingerprint = membershipHash(f.transport.context)
  f.args.expected = buildOpenAiMasterLinkedDocxReviewRequest(f.transport).binding
  await admit(f.args); expect(f.executions[0].executionEvidence.masterLinkedReview.body.subject.method.chunkCount).toBe(3)
})
