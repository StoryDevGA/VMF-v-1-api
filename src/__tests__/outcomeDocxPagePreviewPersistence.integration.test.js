import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import env from '../config/env.js'
import Preview from '../models/OutcomeDocxPagePreview.js'
import Audit from '../models/AuditLog.js'
import { docxPagePreviewFixture } from './fixtures/docxPagePreviewFixture.js'
import { createDocxPagePreview, readDocxPagePreview, readCurrentDocxPagePreview } from '../services/outcomeDocxPagePreviewPersistenceService.js'
import { DOCX_PREVIEW_IDENTITY_INDEX } from '../services/outcomeDocxPagePreviewRecordContract.js'

const database = process.env.VMF_DOCX_PREVIEW_ISOLATED_DB
const run = database ? describe : describe.skip
run('immutable preview real isolated persistence; candidate/runtime/converter seams', () => {
  jest.setTimeout(30000)
  let owned = false, evidencePath, f, deps, args
  const snapshots = []
  const collection = name => {
    if (!owned || mongoose.connection.name !== database || !/^ss055_[a-f0-9]{32}$/.test(database)
      || ![Preview.collection.name, Audit.collection.name].includes(name)) throw new Error('Owned isolated collection required')
    return mongoose.connection.db.collection(name)
  }
  const counts = async () => [await Preview.countDocuments({}), await Audit.countDocuments({})]
  beforeAll(async () => {
    if (!/^ss055_[a-f0-9]{32}$/.test(database) || mongoose.connection.readyState !== 0) throw new Error('Fresh isolated database required')
    evidencePath = path.resolve(process.env.VMF_DOCX_PREVIEW_EVIDENCE_FILE || '')
    if (!evidencePath.toLowerCase().startsWith('c:\\dev\\storylineos\\vmf-evidence\\ss-055\\')) throw new Error('External evidence required')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 6, serverSelectionTimeoutMS: 10000 })
    expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toEqual(expect.any(String))
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    await Preview.createCollection(); await Preview.createIndexes(); await Audit.createCollection()
  })
  beforeEach(() => {
    f = docxPagePreviewFixture()
    deps = { Preview, Audit, readRuntime: jest.fn(async () => f.runtime), renderPreview: jest.fn(async () => f.rendered),
      readCandidate: jest.fn(async input => {
        if (input.actorUserId !== f.actorUserId || input.scopes?.selectedCustomerId !== f.scope.customerId
          || input.candidateId !== f.verified.candidate.candidateId) throw Object.assign(new Error('Denied'), { status: 403, code: 'SOURCE_DENIED' })
        return f.verified
      }), auditService: { log: jest.fn((data, options) => Audit.createLog(data, { session: options.session })) } }
    args = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, candidateId: f.verified.candidate.candidateId,
      scopes: { selectedCustomerId: f.scope.customerId }, payload: f.payload, deps }
  })
  afterEach(async () => {
    if (!owned) return
    const previews = await collection(Preview.collection.name).find({}).toArray(), audits = await collection(Audit.collection.name).find({}).toArray()
    snapshots.push({ case: expect.getState().currentTestName, previews, audits, auditSignaturesValid: audits.map(row => Audit.hydrate(row).verifySignature()) })
    writeFileSync(evidencePath, JSON.stringify({ database, boundary: 'Real isolated transactions/indexes; generic verified candidate/runtime/converter seams', snapshots }, null, 2))
    await collection(Preview.collection.name).deleteMany({}); await collection(Audit.collection.name).deleteMany({})
  })
  afterAll(async () => { if (owned) expect(await counts()).toEqual([0, 0]); await mongoose.disconnect() })
  test('signed creation, exact stored bundle, metadata and replay without conversion', async () => {
    expect(await readCurrentDocxPagePreview(args)).toEqual({ preview: null })
    const created = await createDocxPagePreview(args)
    expect(created.idempotent).toBe(false); expect(await counts()).toEqual([1, 1])
    expect(await createDocxPagePreview(args)).toEqual({ ...created, idempotent: true })
    expect(deps.renderPreview).toHaveBeenCalledTimes(1)
    const read = await readDocxPagePreview({ ...args, previewId: created.preview.previewId, includePages: true })
    expect(read.pages[0].equals(f.rendered.pages[0].buffer)).toBe(true)
    expect((await readCurrentDocxPagePreview(args)).preview).toEqual(created.preview)
    const currentBundle = await readCurrentDocxPagePreview({ ...args, includePages: true })
    expect(currentBundle.pages[0].equals(read.pages[0])).toBe(true); expect(currentBundle.document).toEqual(f.verified.document)
    expect((await readDocxPagePreview({ ...args, previewId: created.preview.previewId })).pages).toBeUndefined()
    expect(Audit.hydrate(await Audit.findOne({}).lean()).verifySignature()).toBe(true)
  })
  test('concurrent requests converge on one record and signed audit', async () => {
    const results = await Promise.all([createDocxPagePreview(args), createDocxPagePreview(args)])
    expect(results[0].preview.previewId).toBe(results[1].preview.previewId); expect(await counts()).toEqual([1, 1])
  })
  test('required audit failure rolls back', async () => {
    deps.auditService.log.mockRejectedValue(new Error('Audit unavailable'))
    await expect(createDocxPagePreview(args)).rejects.toThrow('Audit unavailable'); expect(await counts()).toEqual([0, 0])
  })
  test('post-audit insertion failure rolls the signed audit back', async () => {
    const create = jest.spyOn(Preview, 'create').mockRejectedValueOnce(new Error('Insertion unavailable'))
    try { await expect(createDocxPagePreview(args)).rejects.toThrow('Insertion unavailable') } finally { create.mockRestore() }
    expect(deps.auditService.log).toHaveBeenCalledTimes(1); expect(await counts()).toEqual([0, 0])
  })
  test.each(['source', 'pack', 'runtime'])('%s becomes ineligible before write: no successful pair', async kind => {
    if (kind === 'pack') deps.readCandidate.mockResolvedValueOnce(f.verified).mockRejectedValueOnce(new Error('Retired pack'))
    if (kind === 'source') deps.readCandidate.mockResolvedValueOnce(f.verified).mockResolvedValueOnce({ ...f.verified,
      candidate: { ...f.verified.candidate, sourceFingerprint: '0'.repeat(64) } })
    if (kind === 'runtime') deps.readRuntime.mockResolvedValueOnce(f.runtime).mockResolvedValueOnce({ ...f.runtime, fingerprint: '0'.repeat(64) })
    await expect(createDocxPagePreview(args)).rejects.toThrow(); expect(await counts()).toEqual([0, 0])
  })
  test('uncertain converter cleanup cannot create preview or audit', async () => {
    deps.renderPreview.mockRejectedValue(Object.assign(new Error('Unavailable'), { details: { reason: 'PROCESS_CLEANUP_UNVERIFIED' } }))
    await expect(createDocxPagePreview(args)).rejects.toMatchObject({ details: { reason: 'PROCESS_CLEANUP_UNVERIFIED' } })
    expect(await counts()).toEqual([0, 0])
  })
  test.each(['missing', 'wrong'])('%s identity index blocks before conversion', async kind => {
    await collection(Preview.collection.name).dropIndex(DOCX_PREVIEW_IDENTITY_INDEX)
    if (kind === 'wrong') await collection(Preview.collection.name).createIndex({ candidateId: 1 }, { name: DOCX_PREVIEW_IDENTITY_INDEX, unique: true })
    try { await expect(createDocxPagePreview(args)).rejects.toMatchObject({ status: 503, details: { reason: 'PREVIEW_INDEXES_NOT_READY' } }) }
    finally { if (kind === 'wrong') await collection(Preview.collection.name).dropIndex(DOCX_PREVIEW_IDENTITY_INDEX); await Preview.createIndexes() }
    expect(deps.renderPreview).not.toHaveBeenCalled(); expect(await counts()).toEqual([0, 0])
  })
  test.each(['page', 'audit'])('tampered %s is retained and rejected', async kind => {
    const created = await createDocxPagePreview(args)
    if (kind === 'page') await collection(Preview.collection.name).updateOne({}, { $set: { pageBytes: [Buffer.from('corrupt')] } })
    else await collection(Audit.collection.name).updateOne({}, { $set: { signature: 'corrupt' } })
    await expect(readDocxPagePreview({ ...args, previewId: created.preview.previewId, includePages: true })).rejects.toThrow()
    expect(await counts()).toEqual([1, 1]); expect(deps.renderPreview).toHaveBeenCalledTimes(1)
  })
  test('changed current runtime denies historical preview and retains it', async () => {
    const created = await createDocxPagePreview(args)
    deps.readRuntime.mockResolvedValue({ ...f.runtime, fingerprint: '0'.repeat(64) })
    await expect(readDocxPagePreview({ ...args, previewId: created.preview.previewId })).rejects.toMatchObject({ details: { reason: 'PREVIEW_CANDIDATE_OR_RUNTIME_CHANGED' } })
    expect(await counts()).toEqual([1, 1])
  })
  test('shared-user cross-customer read propagates denial', async () => {
    const created = await createDocxPagePreview(args)
    await expect(readDocxPagePreview({ ...args, previewId: created.preview.previewId, scopes: { selectedCustomerId: '507f1f77bcf86cd799439015' } })).rejects.toMatchObject({ status: 403 })
    expect(await counts()).toEqual([1, 1])
  })
  test('model rejects mutation and bulk insertion of a valid record', async () => {
    const created = await createDocxPagePreview(args)
    await expect(Preview.updateOne({ previewId: created.preview.previewId }, { $set: { docxChecksum: 'changed' } })).rejects.toMatchObject({ details: { reason: 'PREVIEW_IMMUTABLE' } })
    await expect(Preview.deleteMany({})).rejects.toMatchObject({ details: { reason: 'PREVIEW_IMMUTABLE' } })
    await expect(Preview.insertMany([])).rejects.toMatchObject({ details: { reason: 'PREVIEW_BULK_INSERT_UNSUPPORTED' } })
    expect(await counts()).toEqual([1, 1])
  })
})
