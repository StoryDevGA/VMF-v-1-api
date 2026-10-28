import { describe, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import env from '../config/env.js'
import Evidence from '../models/RuntimeEvidenceObject.js'
import Source from '../models/RuntimeEvidenceSource.js'
import Audit from '../models/AuditLog.js'
import auditService from '../services/auditService.js'
import { recordEvidenceDraftQualification, assertEvidenceDraftQualification } from '../services/evidenceDraftQualification.js'
import { makeSs041Fixture } from './fixtures/outcomeEvidenceToDraftFixtures.js'

const database = process.env.VMF_QUALIFICATION_ISOLATED_DB
if (database && !/^ss044_[a-f0-9]{32}$/.test(database)) throw new Error('A unique isolated UUID database is required.')
const isolated = database ? describe : describe.skip
// These are real model/transaction tests, with controlled fixture selection.
// They do not prove the native author endpoint, permissions, or live registry.
isolated('draft qualification existing replica model and audit persistence', () => {
  let owned = false, selectedTarget, owner, row, common
  const author = new mongoose.Types.ObjectId()
  const scope = { customerId: new mongoose.Types.ObjectId(), tenantId: new mongoose.Types.ObjectId(),
    runtimeInstanceId: new mongoose.Types.ObjectId(), runtimeInstanceKey: 'controlled-qualification-fixture' }
  const createRow = () => ({ ...common, ...row, _id: new mongoose.Types.ObjectId() })
  const createAudit = session => auditService.log({ action: 'RUNTIME_STATE_MUTATED', resourceType: 'RuntimeInstance',
    resourceId: scope.runtimeInstanceId, actorUserId: author, scope,
    diff: { action: 'ISOLATED_QUALIFICATION_MODEL_TEST', envelope: row.draftQualification } }, { session, throwOnError: true })
  const transaction = async fn => {
    const session = await mongoose.startSession()
    try { return await session.withTransaction(() => fn(session)) } finally { await session.endSession() }
  }
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) throw new Error('Fresh disconnected test process required.')
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false,
      maxPoolSize: 2, serverSelectionTimeoutMS: 10000 })
    expect(mongoose.connection.name).toBe(database)
    const hello = await mongoose.connection.db.admin().command({ hello: 1 })
    expect(hello.setName).toEqual(expect.any(String))
    expect(hello.isWritablePrimary).toBe(true)
    expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    await Source.createCollection(); await Evidence.createCollection(); await Evidence.createIndexes(); await Audit.createCollection()
    selectedTarget = (await makeSs041Fixture()).selectedTarget
    const version = `rsv2:${randomUUID()}`
    common = { ...scope, stateVersion: version, sourceStateVersion: version,
      sourceHash: `sha256:${'a'.repeat(64)}`, migrationReceiptId: new mongoose.Types.ObjectId(), current: true }
    owner = { sourceId: 'source-1', sourceType: 'CUSTOMER_DOCUMENT', title: 'Disposable synthetic source',
      sourceRef: 'fixture://controlled-source', lineageRef: 'lineage:source-1' }
    await Source.create({ ...common, ...owner })
    row = { evidenceObjectId: 'evidence-1', sourceId: owner.sourceId, lineageRef: owner.lineageRef,
      extractedFact: 'The bounded synthetic proposal remains subject to access review.',
      reviewStatus: 'ACCEPTED', validationStatus: 'UNVALIDATED' }
    row.draftQualification = recordEvidenceDraftQualification({ evidence: row, source: owner,
      sourceSectionKeys: ['customer_context'], selectedTarget,
      targetSectionKeys: [selectedTarget.receipt.targetSections.required[0].targetSectionKey], actorUserId: String(author),
      authoredAt: new Date().toISOString(), facts: { claimStatus: 'SOURCE_PRESENTED', classification: 'CUSTOMER_EVIDENCE',
        currentness: 'CURRENT', sourceLocation: 'fixture://controlled-source#paragraph-1', scope: 'Disposable synthetic proposal only.',
        time: 'At this controlled source capture.', attribution: owner.title, permittedStatement: row.extractedFact,
        permittedInterpretation: 'EXACT_STATEMENT_ONLY', confidenceWarnings: ['Not independently validated.'],
        blockedStrongerClaim: ['Real trial execution is authorised.'], proofDependency: [], proofOrderDisposition: 'NOT_ESTABLISHED',
        proofOrder: [], proofRequirementCodes: [], evidenceRequiredToSubstantiate: ['Access review and an actual trial decision.'] } })
  }, 30000)
  beforeEach(async () => {
    if (!owned || mongoose.connection.name !== database) throw new Error('Isolated database ownership lost.')
    await Evidence.deleteMany({ ...scope }); await Audit.deleteMany({ 'scope.runtimeInstanceId': scope.runtimeInstanceId })
  })
  afterAll(async () => {
    try {
      if (owned && mongoose.connection.name === database && /^ss044_[a-f0-9]{32}$/.test(database)) {
        const names = (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name)
        if (names.some(name => !['runtime_evidence_objects', 'runtime_evidence_sources', 'auditlogs'].includes(name))) {
          throw new Error('Unexpected collection: refuse cleanup outside test ownership.')
        }
        await mongoose.connection.dropDatabase()
      }
    } finally { await mongoose.disconnect() }
  })
  test('saves and reads the unchanged envelope and a real signed audit', async () => {
    await transaction(async session => { await Evidence.create([createRow()], { session }); await createAudit(session) })
    const saved = await Evidence.findOne(scope).lean()
    expect(saved.draftQualification).toEqual(row.draftQualification)
    expect(saved.reviewStatus).toBe('ACCEPTED'); expect(saved.validationStatus).toBe('UNVALIDATED')
    expect(assertEvidenceDraftQualification({ evidence: saved, source: owner,
      sourceSectionKeys: ['customer_context'], selectedTarget })).toEqual(row.draftQualification)
    const audits = await Audit.find({ 'scope.runtimeInstanceId': scope.runtimeInstanceId })
    expect(audits).toHaveLength(1); expect(audits[0].verifySignature()).toBe(true)
  })
  test('required audit failure rolls back envelope persistence', async () => {
    await expect(transaction(async session => {
      await Evidence.create([createRow()], { session })
      await auditService.log({ action: 'RUNTIME_STATE_MUTATED', resourceType: 'RuntimeInstance',
        actorUserId: author, scope, diff: {} }, { session, throwOnError: true })
    })).rejects.toThrow()
    expect(await Evidence.countDocuments(scope)).toBe(0)
    expect(await Audit.countDocuments({ 'scope.runtimeInstanceId': scope.runtimeInstanceId })).toBe(0)
  })
  test('concurrent inserts yield one committed evidence/audit pair', async () => {
    const results = await Promise.allSettled([1, 2].map(() => transaction(async session => {
      await Evidence.create([createRow()], { session }); await createAudit(session)
    })))
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(await Evidence.countDocuments(scope)).toBe(1)
    expect(await Audit.countDocuments({ 'scope.runtimeInstanceId': scope.runtimeInstanceId })).toBe(1)
  })
  test('changed passage cannot retain the old envelope', async () => {
    await expect(Evidence.create({ ...createRow(), extractedFact: 'A stronger unapproved statement.' })).rejects.toThrow()
    expect(await Evidence.countDocuments(scope)).toBe(0)
  })
})
