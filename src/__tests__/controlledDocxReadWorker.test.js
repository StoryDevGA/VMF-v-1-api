import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import {
  CONTROLLED_DOCX_IDENTITY as fixed, CONTROLLED_DOCX_READ_VERSION, CONTROLLED_DOCX_RESULT_VERSION,
  controlledScope, assertControlledReadRequest,
} from '../services/controlledDocxReadContract.js'
import { runControlledDocxReadChild, readControlledDocx, controlledDocxWorkerEnvironment } from '../services/controlledDocxReadService.js'
import { executeControlledDocxReadWorker } from '../services/controlledDocxReadWorker.js'
import { installControlledDocxReadFence } from '../services/controlledDocxReadFence.js'

const request = () => ({ contractVersion: CONTROLLED_DOCX_READ_VERSION, operation: 'LIST',
  scope: Object.fromEntries(['actorUserId', 'customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, fixed[key]])) })
const data = () => ({ scope: controlledScope(), sourceFingerprint: 'a'.repeat(64), candidates: [{
  candidateId: fixed.candidateId, contractVersion: 'private-docx-candidate.v2', status: 'PRIVATE_UNREVIEWED',
  classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', authoritative: false, officialUse: false,
  normalOutputAvailable: false, authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false,
  renderer: { version: '0.1.3' }, sourceFingerprint: 'a'.repeat(64), inputFingerprint: 'b'.repeat(64),
  bodyFingerprint: 'c'.repeat(64), masterBindingFingerprint: 'd'.repeat(64), artifact: { format: 'DOCX', outputChecksum: `sha256:${'1'.repeat(64)}` },
}] })
class FakeChild extends EventEmitter {
  constructor(action) { super(); this.pid = 999; this.exitCode = null; this.signalCode = null; this.stdout = new PassThrough(); this.stderr = new PassThrough(); this.action = action }
  send(message, callback) { callback?.(); queueMicrotask(() => this.action(this, message)) }
  finish(code = 0, signal = null) { this.exitCode = code; this.signalCode = signal; this.emit('close', code, signal) }
  kill() { queueMicrotask(() => this.finish(null, 'SIGTERM')); return true }
}
const reply = () => ({ contractVersion: CONTROLLED_DOCX_RESULT_VERSION, operation: 'LIST', status: 'SUCCESS', data: data() })

describe('finite controlled reader lifecycle with simulated child only', () => {
  let connect
  beforeAll(() => { connect = jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect').mockImplementation(() => { throw new Error('LIVE_MONGO_FORBIDDEN') }) })
  afterAll(() => { expect(connect).not.toHaveBeenCalled(); connect.mockRestore() })
  test('buffers a valid message until the same child closes normally', async () => {
    let child, settled = false
    const pending = runControlledDocxReadChild(request(), { forkChild: (_path, _args, options) => {
      expect(options.execArgv).toEqual(['--max-old-space-size=384']); expect(options.windowsHide).toBe(true)
      child = new FakeChild(c => c.emit('message', reply())); return child
    } }).then(value => { settled = true; return value })
    await new Promise(resolve => setImmediate(resolve)); expect(settled).toBe(false)
    child.finish(); await expect(pending).resolves.toEqual(data())
  })
  test.each(['duplicate', 'wrong version', 'wrong operation', 'extra keys', 'nonzero', 'missing message', 'oversized diagnostics'])('refuses %s before publication', async kind => {
    const forkChild = () => new FakeChild(c => {
      const value = reply()
      if (kind === 'wrong version') value.contractVersion = 'unknown'
      if (kind === 'wrong operation') value.operation = 'CURRENT_PREVIEW'
      if (kind === 'extra keys') value.internal = 'must not publish'
      if (kind === 'oversized diagnostics') { c.stdout.write(Buffer.alloc(4097)); return }
      if (kind !== 'missing message') c.emit('message', value)
      if (kind === 'duplicate') c.emit('message', value)
      c.finish(kind === 'nonzero' ? 1 : 0)
    })
    await expect(runControlledDocxReadChild(request(), { forkChild })).rejects.toMatchObject({ code: 'CONTROLLED_DOCX_READ_UNAVAILABLE' })
  })
  test('cancellation terminates the owned child and discards its buffered data', async () => {
    const abort = new AbortController(); let child
    const pending = runControlledDocxReadChild(request(), { signal: abort.signal, forkChild: () => {
      child = new FakeChild(c => c.emit('message', reply())); return child
    } })
    await new Promise(resolve => setImmediate(resolve)); abort.abort()
    await expect(pending).rejects.toMatchObject({ details: { reason: 'READ_CANCELLED' } })
    expect(child.signalCode).toBe('SIGTERM')
  })
  test('pre-aborted request cannot launch a child', async () => {
    const abort = new AbortController(); abort.abort(); const forkChild = jest.fn()
    await expect(runControlledDocxReadChild(request(), { signal: abort.signal, forkChild })).rejects.toThrow()
    expect(forkChild).not.toHaveBeenCalled()
  })
  test('deadline terminates only the owned simulated child and refuses publication', async () => {
    jest.useFakeTimers()
    try {
      const child = new FakeChild(() => {})
      child.kill = jest.fn(() => { child.finish(null, 'SIGTERM'); return true })
      const pending = runControlledDocxReadChild(request(), { forkChild: () => child })
      const checked = expect(pending).rejects.toMatchObject({ details: { reason: 'READ_DEADLINE' } })
      await jest.advanceTimersByTimeAsync(480000)
      await checked; expect(child.kill).toHaveBeenCalledTimes(1)
    } finally { jest.useRealTimers() }
  })
  test('concurrent requests cannot start a second reader and capacity returns after closure', async () => {
    let release
    const waiting = new Promise(resolve => { release = resolve })
    const deps = { env: { nodeEnv: 'test', appEnv: 'development', controlledDocxReadEnabled: true },
      readAuthority: jest.fn(async () => ({ actorUserId: fixed.actorUserId, fingerprint: 'a'.repeat(64) })),
      runChild: jest.fn(async () => { await waiting; return data() }) }
    const args = { ...request().scope, operation: 'LIST', authorization: 'unused-unit-fixture' }
    const first = readControlledDocx(args, deps)
    await expect(readControlledDocx(args, deps)).rejects.toMatchObject({ status: 429 })
    release(); await first
    expect(deps.runChild).toHaveBeenCalledTimes(1)
    await readControlledDocx(args, deps); expect(deps.runChild).toHaveBeenCalledTimes(2)
  })
  test.each(['database', 'uri', 'deps', 'workerPath', 'authorization'])('request cannot select %s', async key => {
    const invalid = { ...request(), [key]: 'forbidden' }
    expect(() => assertControlledReadRequest(invalid)).toThrow()
    await expect(executeControlledDocxReadWorker(invalid)).rejects.toThrow()
  })
  test('invalid and foreign source identity fails before default worker setup', async () => {
    const invalid = request(); invalid.scope.actorUserId = '000000000000000000000001'
    await expect(executeControlledDocxReadWorker(invalid)).rejects.toThrow()
    expect(connect).not.toHaveBeenCalled()
  })
  test('child receives no provider key or injected Node options', () => {
    const childEnv = controlledDocxWorkerEnvironment()
    expect(childEnv.NODE_OPTIONS).toBe(''); expect(childEnv.OUTCOME_STUDIO_PROVIDER_ENABLED).toBe('false')
    expect(childEnv.VMF_SECTION_REASONING_PROVIDER_ENABLED).toBe('false')
    for (const key of ['OPENAI_API_KEY', 'OUTCOME_STUDIO_PROVIDER_API_KEY', 'VMF_SECTION_REASONING_PROVIDER_API_KEY']) expect(childEnv[key]).toBe('')
  })
  test('narrow child environment selects only V4 without credentials or injected Node options', () => {
    const childEnv = controlledDocxWorkerEnvironment(false, false, true)
    expect(childEnv.CONTROLLED_DOCX_READ_ENABLED).toBe('true')
    expect(childEnv.CONTROLLED_DOCX_READ_NARROW_ENABLED).toBe('true')
    expect(childEnv.CONTROLLED_DOCX_READ_APPROVED_ENABLED).toBe('false')
    expect(childEnv.CONTROLLED_DOCX_READ_CORRECTION_ENABLED).toBe('false')
    expect(childEnv.NODE_OPTIONS).toBe('')
    for (const key of ['OPENAI_API_KEY', 'OUTCOME_STUDIO_PROVIDER_API_KEY', 'VMF_SECTION_REASONING_PROVIDER_API_KEY']) expect(childEnv[key]).toBe('')
    expect(controlledDocxWorkerEnvironment().CONTROLLED_DOCX_READ_NARROW_ENABLED).toBe('false')
  })
  test('unconfirmed child termination holds all later worker launches', async () => {
    jest.useFakeTimers()
    try {
      const child = new FakeChild(() => {}); child.kill = jest.fn(() => true)
      const pending = runControlledDocxReadChild(request(), { forkChild: () => child })
      const checked = expect(pending).rejects.toMatchObject({ details: { reason: 'PROCESS_CLEANUP_UNVERIFIED' } })
      await jest.advanceTimersByTimeAsync(485000); await checked
      const forkChild = jest.fn()
      await expect(runControlledDocxReadChild(request(), { forkChild })).rejects.toMatchObject({ details: { reason: 'PROCESS_CLEANUP_UNVERIFIED' } })
      expect(forkChild).not.toHaveBeenCalled()
    } finally { jest.useRealTimers() }
  })
})

describe('worker installed-driver read fence, disconnected actual receivers', () => {
  const driver = mongoose.mongo, originals = new Map()
  let connect, client, foreign, fence
  beforeAll(() => {
    for (const prototype of [driver.Collection.prototype, driver.Db.prototype, driver.MongoClient.prototype, driver.Admin.prototype]) originals.set(prototype, Object.getOwnPropertyDescriptors(prototype))
    connect = jest.spyOn(driver.MongoClient.prototype, 'connect').mockImplementation(() => { throw new Error('OFFLINE_IO_FORBIDDEN') })
    fence = installControlledDocxReadFence(driver, { database: 'test' })
    client = new driver.MongoClient('mongodb://127.0.0.1:1/test'); foreign = new driver.MongoClient('mongodb://127.0.0.1:1/test')
    fence.register(client); fence.addNames(['users'])
  })
  afterAll(async () => {
    expect(connect).not.toHaveBeenCalled(); connect.mockRestore()
    for (const [prototype, descriptors] of originals) Object.defineProperties(prototype, descriptors)
    await client.close(); await foreign.close()
  })
  const denied = fn => expect(fn).toThrow('CONTROLLED_READ_FENCE')
  test('wrong database/client/collection cannot construct a read cursor', () => {
    denied(() => foreign.db('test').collection('users').find({}))
    denied(() => client.db('other').collection('users').find({}))
    denied(() => client.db('test').collection('other').find({}))
  })
  test('every non-read Db entry including command cursors is denied', () => {
    const db = client.db('test')
    for (const [method, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(driver.Db.prototype))) {
      if (method !== 'constructor' && typeof descriptor.value === 'function' && !['collection', 'listCollections', 'aggregate', 'collections', 'collectionExists'].includes(method)) denied(() => db[method]({ aggregate: 'users', pipeline: [{ $out: 'sink' }], cursor: {} }))
    }
  })
  test('every non-read Collection entry is denied', () => {
    const collection = client.db('test').collection('users')
    for (const [method, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(driver.Collection.prototype))) {
      if (method !== 'constructor' && typeof descriptor.value === 'function' && !['find', 'findOne', 'aggregate', 'listIndexes', 'indexes', 'countDocuments', 'estimatedDocumentCount', 'distinct'].includes(method)) denied(() => collection[method]({}))
    }
  })
  test('client-wide bulk, change streams and direct administration are denied', () => {
    denied(() => client.bulkWrite([])); denied(() => client.watch([]))
    const admin = new driver.Admin(client.db('test'))
    for (const [method, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(driver.Admin.prototype))) if (method !== 'constructor' && typeof descriptor.value === 'function') denied(() => admin[method]({}))
  })
  test.each(['$out', '$merge'])('both aggregate receivers reject %s including nested output', stage => {
    const pipeline = [{ $facet: { nested: [{ [stage]: 'sink' }] } }]
    denied(() => client.db('test').aggregate(pipeline))
    denied(() => client.db('test').collection('users').aggregate(pipeline))
  })
  test('allowed receivers still construct and close lazy read cursors without IO', async () => {
    const cursors = [client.db('test').collection('users').find({}), client.db('test').aggregate([]), client.db('test').listCollections({})]
    expect(cursors.every(cursor => typeof cursor.toArray === 'function')).toBe(true)
    for (const cursor of cursors) await cursor.close()
    expect(connect).not.toHaveBeenCalled()
  })
})
