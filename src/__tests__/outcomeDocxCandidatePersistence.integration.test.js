import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import env from '../config/env.js'
import Candidate from '../models/OutcomeDocxRenditionCandidate.js'
import Audit from '../models/AuditLog.js'
import { governedDocxFixture } from './fixtures/governedDocxCandidateFixture.js'
import { prepareGovernedPrivateDocxCandidate } from '../services/outcomeGovernedDocxCandidateService.js'
import { createPrivateDocxCandidate, readPrivateDocxCandidate, listCurrentPrivateDocxCandidates } from '../services/outcomeDocxCandidatePersistenceService.js'
import { PRIVATE_DOCX_CANDIDATE_INDEX, privateDocxByteHash } from '../services/outcomeDocxCandidateRecordContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { renderProfessionalDocumentCandidate } from '../services/professionalDocumentCandidateRenderer.js'

// Real transactions, indexes and signed audits. Generic source/pack seams do
// not establish native source authorization, browser behaviour or provider proof.
const database = process.env.VMF_DOCX_CANDIDATE_ISOLATED_DB
const run = database ? describe : describe.skip
run('immutable private DOCX real persistence', () => {
  jest.setTimeout(30000)
  let owned = false, f, deps, args, evidencePath
  const snapshots = []
  const scope = { tenantId: '507f1f77bcf86cd799439011', customerId: '507f1f77bcf86cd799439012', runtimeInstanceId: '507f1f77bcf86cd799439013' }
  const actorUserId = '507f1f77bcf86cd799439014'
  const collection = name => {
    if (!owned || mongoose.connection.name !== database || !/^ss055_[a-f0-9]{32}$/.test(database)
      || ![Candidate.collection.name, Audit.collection.name].includes(name)) throw new Error('Owned isolated collection required')
    return mongoose.connection.db.collection(name)
  }
  const counts = async () => [await Candidate.countDocuments({}), await Audit.countDocuments({})]
  beforeAll(async () => {
    if (!/^ss055_[a-f0-9]{32}$/.test(database) || mongoose.connection.readyState !== 0) throw new Error('Fresh isolated database required')
    evidencePath = path.resolve(process.env.VMF_DOCX_CANDIDATE_EVIDENCE_FILE || '')
    if (!evidencePath.toLowerCase().startsWith('c:\\dev\\storylineos\\vmf-evidence\\ss-055\\')) throw new Error('External evidence path required')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 6, serverSelectionTimeoutMS: 10000 })
    expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toEqual(expect.any(String))
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    await Candidate.createCollection(); await Candidate.createIndexes(); await Audit.createCollection()
  }, 30000)
  beforeEach(() => {
    f = governedDocxFixture(); Object.assign(f.envelope.source.scope, scope); f.seal()
    const documents = new Map([...f.documents.map(document => [document.source.versionId,
      { ...document.source, available: true, status: 'ACTIVE', content: document.content }]), [f.audienceDocument.versionId, f.audienceDocument]])
    deps = { Candidate, Audit,
      readSource: jest.fn(async input => {
        if (input.actorUserId !== actorUserId || input.scopes?.selectedCustomerId !== scope.customerId) throw Object.assign(new Error('Denied'), { status: 403, code: 'SOURCE_DENIED' })
        return f.envelope
      }),
      loadPackContent: jest.fn(async ({ versionId }) => documents.get(versionId)),
      compileCandidate: jest.fn(prepareGovernedPrivateDocxCandidate),
      auditService: { log: jest.fn((data, options) => Audit.createLog(data, { session: options.session })) } }
    args = { actorUserId, runtimeInstanceId: scope.runtimeInstanceId, scopes: { selectedCustomerId: scope.customerId },
      payload: { requestKey: randomUUID(), expectedSourceFingerprint: f.envelope.sourceFingerprint, format: 'DOCX' }, deps }
  })
  afterEach(async () => {
    if (!owned) return
    const candidates = await collection(Candidate.collection.name).find({}).toArray()
    const audits = await collection(Audit.collection.name).find({}).toArray()
    snapshots.push({ case: expect.getState().currentTestName, candidates, audits,
      auditSignaturesValid: audits.map(audit => Audit.hydrate(audit).verifySignature()) })
    writeFileSync(evidencePath, JSON.stringify({ database, evidenceBoundary: 'Real isolated persistence; generic source/pack seams', snapshots }, null, 2))
    // Evidence is saved before clearing only these newly owned fixture rows.
    await collection(Candidate.collection.name).deleteMany({}); await collection(Audit.collection.name).deleteMany({})
  })
  afterAll(async () => {
    if (owned) expect(await counts()).toEqual([0, 0])
    await mongoose.disconnect()
  })

  test('creation, signed receipt, exact byte read and replay without compilation', async () => {
    const created = await createPrivateDocxCandidate(args)
    expect(created.idempotent).toBe(false); expect(await counts()).toEqual([1, 1])
    const replay = await createPrivateDocxCandidate(args)
    expect(replay).toEqual({ ...created, idempotent: true })
    expect(deps.compileCandidate).toHaveBeenCalledTimes(1)
    const read = await readPrivateDocxCandidate({ ...args, candidateId: created.candidate.candidateId, includeBytes: true })
    const stored = await collection(Candidate.collection.name).findOne({ candidateId: created.candidate.candidateId })
    expect(read.buffer.equals(Buffer.from(stored.fileBytes.value(true)))).toBe(true)
    expect(read.candidate.artifact.outputChecksum).toBe(stored.body.artifact.outputChecksum)
    expect(read.scope).toEqual(scope)
    expect(read.document).toEqual({ title: stored.body.input.model.title, markdown: stored.body.input.markdown, inputFingerprint: stored.body.inputFingerprint })
    expect(read.candidateInput).toBeUndefined()
    const internal = await readPrivateDocxCandidate({ ...args, candidateId: created.candidate.candidateId, includeBytes: true, includeInput: true })
    expect(internal.candidateInput).toEqual(stored.body.input)
    expect((await readPrivateDocxCandidate({ ...args, candidateId: created.candidate.candidateId, includeInput: true })).candidateInput).toBeUndefined()
    expect(Audit.hydrate(await Audit.findOne({}).lean()).verifySignature()).toBe(true)
  })
  test('current-source discovery returns verified metadata without input or bytes and does not compile or write', async () => {
    expect((await listCurrentPrivateDocxCandidates(args)).candidates).toEqual([])
    const created = await createPrivateDocxCandidate(args)
    const listed = await listCurrentPrivateDocxCandidates(args)
    expect(listed.scope).toEqual(scope); expect(listed.candidates).toEqual([created.candidate])
    expect(JSON.stringify(listed)).not.toMatch(/fileBytes|"input":|bodyMarkdown/)
    expect(deps.compileCandidate).toHaveBeenCalledTimes(1); expect(await counts()).toEqual([1, 1])
  })
  test('historical 0.1.2 and new 0.1.3 keep independent signed bytes and immutable replay', async () => {
    deps.compileCandidate.mockImplementationOnce(async inputArgs => {
      const compiled = await prepareGovernedPrivateDocxCandidate(inputArgs), input = compiled.input
      input.renderer.version = '0.1.2'
      delete input.renderer.qualificationPolicy
      delete input.presentation.qualificationCallouts
      const rendered = await renderProfessionalDocumentCandidate({ documentMetadata: input.documentMetadata,
        markdown: input.markdown, layoutProfile: input.renderer.layoutProfile, presentationProfile: input.renderer.presentationProfile })
      return { ...compiled, inputFingerprint: membershipHash(input), buffer: rendered.buffer,
        artifact: { ...compiled.artifact, byteLength: rendered.buffer.length, outputChecksum: privateDocxByteHash(rendered.buffer) } }
    })
    const old = await createPrivateDocxCandidate(args)
    const oldBefore = await readPrivateDocxCandidate({ ...args, candidateId: old.candidate.candidateId, includeBytes: true, includeInput: true })
    const current = await createPrivateDocxCandidate({ ...args, payload: { ...args.payload, requestKey: randomUUID() } })
    const currentRead = await readPrivateDocxCandidate({ ...args, candidateId: current.candidate.candidateId, includeBytes: true, includeInput: true })
    expect(oldBefore.candidateInput.renderer.version).toBe('0.1.2')
    expect(currentRead.candidateInput.renderer.version).toBe('0.1.3')
    expect(currentRead.candidateInput.markdown).toBe(oldBefore.candidateInput.markdown)
    expect(currentRead.candidateInput.model).toEqual(oldBefore.candidateInput.model)
    expect(currentRead.buffer.equals(oldBefore.buffer)).toBe(false)
    expect((await createPrivateDocxCandidate(args))).toEqual({ ...old, idempotent: true })
    expect(deps.compileCandidate).toHaveBeenCalledTimes(2)
    const oldAfter = await readPrivateDocxCandidate({ ...args, candidateId: old.candidate.candidateId, includeBytes: true, includeInput: true })
    expect(oldAfter).toEqual(oldBefore)
    expect((await listCurrentPrivateDocxCandidates(args)).candidates).toHaveLength(2)
    expect(await counts()).toEqual([2, 2])
  })
  test('discovery refuses a corrupt current record and a shared-user wrong customer', async () => {
    await createPrivateDocxCandidate(args)
    await expect(listCurrentPrivateDocxCandidates({ ...args, scopes: { selectedCustomerId: '507f1f77bcf86cd799439015' } })).rejects.toMatchObject({ status: 403 })
    await collection(Candidate.collection.name).updateOne({}, { $set: { fileBytes: Buffer.from('Corrupt') } })
    await expect(listCurrentPrivateDocxCandidates(args)).rejects.toThrow(); expect(await counts()).toEqual([1, 1])
  })
  test('discovery orders verified candidates deterministically and excludes a different source', async () => {
    const first = await createPrivateDocxCandidate(args)
    const second = await createPrivateDocxCandidate({ ...args, payload: { ...args.payload, requestKey: randomUUID() } })
    expect((await listCurrentPrivateDocxCandidates(args)).candidates.map(row => row.candidateId)).toEqual([second.candidate.candidateId, first.candidate.candidateId])
    deps.readSource.mockResolvedValue({ ...f.envelope, sourceFingerprint: '0'.repeat(64) })
    expect((await listCurrentPrivateDocxCandidates(args)).candidates).toEqual([])
    expect(await counts()).toEqual([2, 2])
  })
  test('discovery limit rejects before validating deliberately over-limit raw fixture rows', async () => {
    await createPrivateDocxCandidate(args)
    const stored = await collection(Candidate.collection.name).findOne({})
    await collection(Candidate.collection.name).insertMany(Array.from({ length: 20 }, () => ({ ...stored,
      _id: new mongoose.Types.ObjectId(), candidateId: `docx_candidate_${randomUUID()}`, requestKey: randomUUID() })))
    await expect(listCurrentPrivateDocxCandidates(args)).rejects.toMatchObject({ details: { reason: 'CANDIDATE_DISCOVERY_LIMIT' } })
    expect(await counts()).toEqual([21, 1])
  })
  test('simultaneous same request has one candidate and one signed audit', async () => {
    const results = await Promise.all([createPrivateDocxCandidate(args), createPrivateDocxCandidate(args)])
    expect(results[0].candidate.candidateId).toBe(results[1].candidate.candidateId)
    expect(await counts()).toEqual([1, 1])
  })
  test('simultaneous changed source under one key has one winner and one conflict', async () => {
    const other = governedDocxFixture(); Object.assign(other.envelope.source.scope, scope)
    other.shaping.sections[0].qualification = 'Different generic source snapshot.'; other.seal()
    const otherArgs = { ...args, payload: { ...args.payload, expectedSourceFingerprint: other.envelope.sourceFingerprint },
      deps: { ...deps, readSource: async () => other.envelope } }
    const results = await Promise.allSettled([createPrivateDocxCandidate(args), createPrivateDocxCandidate(otherArgs)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ details: { reason: 'CANDIDATE_REQUEST_KEY_CONFLICT' } })
    expect(await counts()).toEqual([1, 1])
  })
  test('changed request under the same key conflicts instead of replacing stored bytes', async () => {
    await createPrivateDocxCandidate(args)
    f.shaping.sections[0].qualification = 'Changed generic qualification.'; f.seal()
    args.payload.expectedSourceFingerprint = f.envelope.sourceFingerprint
    await expect(createPrivateDocxCandidate(args)).rejects.toMatchObject({ details: { reason: 'CANDIDATE_REQUEST_KEY_CONFLICT' } })
    expect(deps.compileCandidate).toHaveBeenCalledTimes(1); expect(await counts()).toEqual([1, 1])
  })
  test('required audit failure rolls the transaction back', async () => {
    deps.auditService.log.mockRejectedValue(new Error('Injected audit unavailable'))
    await expect(createPrivateDocxCandidate(args)).rejects.toThrow('Injected audit unavailable')
    expect(await counts()).toEqual([0, 0])
  })
  test('post-audit insertion validation failure rolls the real audit back', async () => {
    deps.compileCandidate.mockImplementation(async input => {
      const compiled = await prepareGovernedPrivateDocxCandidate(input)
      compiled.artifact.byteLength++; return compiled
    })
    await expect(createPrivateDocxCandidate(args)).rejects.toMatchObject({ details: { reason: 'STORED_FILE_CHANGED' } })
    expect(deps.auditService.log).toHaveBeenCalledTimes(1); expect(await counts()).toEqual([0, 0])
  })
  test('source changes at the pre-write observation produce no record or audit', async () => {
    deps.readSource.mockResolvedValueOnce(f.envelope).mockResolvedValueOnce({ ...f.envelope, sourceFingerprint: '0'.repeat(64) })
    await expect(createPrivateDocxCandidate(args)).rejects.toMatchObject({ details: { reason: 'CANDIDATE_SOURCE_CHANGED' } })
    expect(await counts()).toEqual([0, 0])
  })
  test('missing required unique index fails before compilation or write', async () => {
    await collection(Candidate.collection.name).dropIndex(PRIVATE_DOCX_CANDIDATE_INDEX)
    try {
      await expect(createPrivateDocxCandidate(args)).rejects.toMatchObject({ status: 503, details: { reason: 'CANDIDATE_INDEXES_NOT_READY' } })
      expect(deps.compileCandidate).not.toHaveBeenCalled(); expect(await counts()).toEqual([0, 0])
    } finally { await Candidate.createIndexes() }
  })
  test('a matching index name with sparse/nonunique shape is not accepted', async () => {
    const ownedCollection = collection(Candidate.collection.name)
    await ownedCollection.dropIndex(PRIVATE_DOCX_CANDIDATE_INDEX)
    await ownedCollection.createIndex({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, requestKey: 1 },
      { name: PRIVATE_DOCX_CANDIDATE_INDEX, sparse: true })
    try {
      await expect(createPrivateDocxCandidate(args)).rejects.toMatchObject({ status: 503, details: { reason: 'CANDIDATE_INDEXES_NOT_READY' } })
      expect(await counts()).toEqual([0, 0])
    } finally { await ownedCollection.dropIndex(PRIVATE_DOCX_CANDIDATE_INDEX); await Candidate.createIndexes() }
  })
  test('stale source and retired exact pack deny byte reads without deleting history', async () => {
    const created = await createPrivateDocxCandidate(args)
    const readArgs = { ...args, candidateId: created.candidate.candidateId, includeBytes: true }
    deps.readSource.mockResolvedValueOnce({ ...f.envelope, sourceFingerprint: '0'.repeat(64) })
    await expect(readPrivateDocxCandidate(readArgs)).rejects.toMatchObject({ details: { reason: 'CANDIDATE_SOURCE_CHANGED' } })
    const realLoader = deps.loadPackContent.getMockImplementation()
    deps.loadPackContent.mockImplementation(async query => ({ ...await realLoader(query), status: 'RETIRED' }))
    await expect(readPrivateDocxCandidate(readArgs)).rejects.toMatchObject({ details: { reason: 'CANDIDATE_PACK_NO_LONGER_ELIGIBLE' } })
    expect(await counts()).toEqual([1, 1])
  })
  test('raw stored byte corruption is rejected rather than regenerated', async () => {
    const created = await createPrivateDocxCandidate(args)
    await collection(Candidate.collection.name).updateOne({ candidateId: created.candidate.candidateId }, { $set: { fileBytes: Buffer.from('Corrupt') } })
    await expect(readPrivateDocxCandidate({ ...args, candidateId: created.candidate.candidateId, includeBytes: true }))
      .rejects.toMatchObject({ details: { reason: 'STORED_FILE_CHANGED' } })
    expect(deps.compileCandidate).toHaveBeenCalledTimes(1)
  })
  test('a tampered stored audit signature blocks reads', async () => {
    const created = await createPrivateDocxCandidate(args)
    await collection(Audit.collection.name).updateOne({}, { $set: { signature: '0'.repeat(64) } })
    await expect(readPrivateDocxCandidate({ ...args, candidateId: created.candidate.candidateId, includeBytes: true }))
      .rejects.toMatchObject({ details: { reason: 'REQUIRED_SIGNED_AUDIT_INVALID' } })
    expect(deps.compileCandidate).toHaveBeenCalledTimes(1)
  })
  test('shared actor selecting another customer is denied before candidate lookup', async () => {
    const created = await createPrivateDocxCandidate(args)
    await expect(readPrivateDocxCandidate({ ...args, scopes: { selectedCustomerId: '507f1f77bcf86cd799439015' },
      candidateId: created.candidate.candidateId, includeBytes: true })).rejects.toMatchObject({ status: 403, code: 'SOURCE_DENIED' })
    expect(await counts()).toEqual([1, 1])
  })
})
