import { beforeAll, afterAll, describe, test, expect } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import OutcomeKnowledgeCompositionPlan from '../models/OutcomeKnowledgeCompositionPlan.js'
import { makeSs041Fixture, freezeSs041Snapshot } from './fixtures/outcomeEvidenceToDraftFixtures.js'
import { compileEvidenceToMeaningContract } from '../services/outcomeEvidenceToMeaningContractService.js'
import { readRuntimeEvidenceToMeaningContract, projectRuntimeEvidenceToMeaningReadiness,
  projectRuntimeEvidenceOutputPlanBinding } from '../services/outcomeRuntimeEvidenceToMeaningService.js'
import { assertRuntimeEvidenceToMeaningReady, readRuntimeEvidenceToMeaningProviderProjection } from '../services/outcomeRuntimeEvidenceToMeaningService.js'
import { expandEvidenceToMeaningProviderClaims, EVIDENCE_TO_DRAFT_PROVIDER_VERSION } from '../services/outcomeEvidenceToMeaningProviderService.js'
import { assembleOutcomeEvidenceInventory } from '../utils/outcomeEvidenceSnapshot.js'

let replica
const proofDirectory = process.env.VMF_CONSUMED_CONTEXT_PROOF_DIR
const proofMode = process.env.VMF_CONSUMED_CONTEXT_PROOF === '1'
const proofTest = proofMode ? test : test.skip
const proofDatabase = 'ss049_consumed_context'
const assertProofOwned = () => {
  if (!proofMode || proofDirectory !== 'C:/Dev/StoryLineOS/VMF-Evidence/ss-049/2026-11-11-ss044-consumed-context-proof'
    || mongoose.connection.host !== '127.0.0.1' || mongoose.connection.port !== 27088
    || mongoose.connection.name !== proofDatabase) throw new Error('Owned consumed-context proof database required')
}
const saveProof = (name, value) => {
  assertProofOwned()
  fs.writeFileSync(`${proofDirectory}/${name}.json`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
}
beforeAll(async () => {
  if (proofMode && (proofDirectory !== 'C:/Dev/StoryLineOS/VMF-Evidence/ss-049/2026-11-11-ss044-consumed-context-proof'
    || process.env.MONGOMS_RUNTIME_DOWNLOAD !== 'false'
    || process.env.MONGOMS_SYSTEM_BINARY !== 'C:/Users/garya/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe')) throw new Error('Pinned external proof setup required')
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' },
    ...(proofMode ? { instanceOpts: [{ port: 27088, dbPath: `${proofDirectory}/mongo-data` }] } : {}) })
  const uri = replica.getUri(proofMode ? proofDatabase : `ss041_contract_${randomUUID().replaceAll('-', '')}`)
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Isolated loopback replica required')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  if (proofMode) {
    assertProofOwned()
    if ((await mongoose.connection.db.listCollections().toArray()).length) throw new Error('Fresh empty owned proof database required')
    for (const name of ['runtime_evidence_objects', 'runtime_evidence_sources', 'runtime_section_states']) await mongoose.connection.db.createCollection(name)
  }
  await OutcomeKnowledgeCompositionPlan.createCollection()
  await OutcomeKnowledgeCompositionPlan.createIndexes()
}, 120000)
afterAll(async () => {
  let captureError, stopped = false
  try {
    if (proofMode && mongoose.connection.readyState === 1) {
      const rows = {}
      for (const { name } of await mongoose.connection.db.listCollections().toArray()) {
        rows[name] = { records: await mongoose.connection.db.collection(name).find({}).sort({ _id: 1 }).toArray(),
          indexes: await mongoose.connection.db.collection(name).indexes() }
      }
      saveProof('database-readback', rows)
    }
  } catch (error) { captureError = error }
  try { await mongoose.disconnect() } finally { if (replica) { await replica.stop(); stopped = true } }
  if (proofMode) fs.writeFileSync(`${proofDirectory}/cleanup.json`, JSON.stringify({ ownedMongoStopped: stopped,
    dataRetained: fs.existsSync(`${proofDirectory}/mongo-data`), captureError: captureError?.message || null }) + '\n', { flag: 'wx' })
  if (captureError) throw captureError
})

// Admission proof only: authored source/section and truth preconditions, not an
// acquisition/lock/plan-writer proof or a downstream consumed-stage receipt.
const consumerFixture = async (unresolved = false) => {
  assertProofOwned()
  const { value } = await candidate(unresolved)
  const input = JSON.parse(value.payload.evidenceToMeaning.contractJson).inputs
  input.composition.providerCompatibility = { contractVersion: EVIDENCE_TO_DRAFT_PROVIDER_VERSION, status: 'READY' }
  const scope = input.sourceSnapshot.inventoryReceipt.scope
  const names = { evidence: 'runtime_evidence_objects', sources: 'runtime_evidence_sources', sections: 'runtime_section_states' }
  const collections = Object.fromEntries(Object.entries(names).map(([kind, name]) => [kind, mongoose.connection.db.collection(name)]))
  // String storage IDs are retained from the existing explicit synthetic fixture.
  // Namespace them per runtime so cases coexist without clearing any collection.
  for (const [kind, rows] of [['evidence', input.sourceSnapshot.evidenceObjects], ['sources', input.sourceSnapshot.sourceRegistry]]) {
    await collections[kind].insertMany(rows.map(row => ({ ...row, _id: scope.runtimeInstanceId + ':' + row._id })))
  }
  await collections.sections.insertMany(input.sourceSnapshot.inventoryReceipt.sectionSnapshot.map((row, index) => ({
    ...row, ...scope, _id: scope.runtimeInstanceId + ':' + index,
  })))
  let reads = 0
  const readSnapshot = async ({ runtimeInstanceId, scopes, session }) => {
    assertProofOwned()
    expect(String(runtimeInstanceId)).toBe(scope.runtimeInstanceId)
    expect(scopes).toEqual(scope)
    expect(session?.inTransaction()).toBe(true)
    reads++
    const sections = await collections.sections.find(scope, { session }).sort({ _id: 1 }).toArray()
    const result = await assembleOutcomeEvidenceInventory({ scope,
      sections: sections.map(({ sectionKey, references }) => ({ sectionKey, references })),
      readPage: (kind, after, limit) => collections[kind].find({ ...scope, ...(after === null ? {} : { _id: { $gt: after } }) }, { session })
        .sort({ _id: 1 }).limit(limit).toArray(),
      count: kind => collections[kind].countDocuments(scope, { session }),
      validateRows: (_kind, rows) => rows.forEach(row => Object.entries(scope).forEach(([key, expected]) => expect(String(row[key])).toBe(expected))),
    })
    return { ...input.sourceSnapshot, evidenceObjects: result.evidenceObjects, sourceRegistry: result.sourceRegistry, inventoryReceipt: result.receipt }
  }
  const session = await mongoose.startSession()
  try { await session.withTransaction(async () => { input.sourceSnapshot = await readSnapshot({ runtimeInstanceId: value.runtimeInstanceId, scopes: scope, session }) }) }
  finally { await session.endSession() }
  const contract = compileEvidenceToMeaningContract(input)
  value.payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
    contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
  value.planFingerprint = contract.contractHash
  const saved = await OutcomeKnowledgeCompositionPlan.create(value)
  reads = 0
  return { saved, contract, scope, collections, readSnapshot, reads: () => reads }
}
const admit = async (f, mutatePlan = plan => plan, readSnapshot = f.readSnapshot) => {
  const session = await mongoose.startSession()
  let result
  try {
    await session.withTransaction(async () => {
      const plan = mutatePlan(await OutcomeKnowledgeCompositionPlan.findById(f.saved._id).session(session).lean())
      const contract = await assertRuntimeEvidenceToMeaningReady({ plan, scopes: f.scope, session,
        deps: { readOutcomeEvidenceContractSnapshot: readSnapshot } })
      result = { contract, projection: readRuntimeEvidenceToMeaningProviderProjection(plan) }
    })
  } finally { await session.endSession() }
  return result
}
describe('provider-free consumed-context admission proof', () => {
  proofTest('admits the exact saved qualified contract after a real session-bound inventory reread', async () => {
    const f = await consumerFixture(), result = await admit(f)
    expect(result.contract).toEqual(f.contract)
    expect(f.reads()).toBe(1)
    expect(result.projection.contractHash).toBe(f.contract.contractHash)
    expect(result.projection.contractId).toBe(f.contract.contractId)
    expect(result.projection.contractVersion).toBe(EVIDENCE_TO_DRAFT_PROVIDER_VERSION)
    expect(expandEvidenceToMeaningProviderClaims(result.projection)).toEqual(f.contract.customerClaims)
    expect(f.contract.customerClaims[0]).toMatchObject({ claimStatus: 'SOURCE_PRESENTED', currentness: 'CURRENT',
      permittedInterpretation: 'EXACT_STATEMENT_ONLY', proofOrderDisposition: 'NOT_ESTABLISHED' })
    expect(result.projection.claimProjections[0]).toMatchObject({ meaningClass: 'QUALIFIED', proofDisposition: 'NOT_ESTABLISHED' })
    expect(result.projection.frameworkGuidance.label).toBe('FRAMEWORK_GUIDANCE_ONLY')
    const readback = await OutcomeKnowledgeCompositionPlan.findById(f.saved._id).lean()
    expect(readback.payload.evidenceToMeaning.contractJson).toBe(JSON.stringify(f.contract))
    saveProof('case-positive', { proof: 'ISOLATED_REAL_PERSISTENCE_CONSUMER_ADMISSION_ONLY', plan: readback,
      admittedContract: result.contract, projection: result.projection, snapshotReads: f.reads(),
      downstreamConsumedReceipt: 'NOT_CREATED', frozenMembershipBridge: 'NOT_PROVED' })
  })
  proofTest.each(['source', 'qualification'])('rejects saved %s drift without changing the immutable plan', async kind => {
    const f = await consumerFixture(), before = await OutcomeKnowledgeCompositionPlan.findById(f.saved._id).lean()
    await f.collections[kind === 'source' ? 'sources' : 'evidence'].updateOne(f.scope,
      { $set: kind === 'source' ? { label: 'Changed synthetic source' } : { confidenceWarnings: ['Changed synthetic qualification'] } })
    await expect(admit(f)).rejects.toMatchObject({ code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED',
      details: { reason: 'SOURCE_SNAPSHOT_CHANGED_RE_RESOLVE_REQUEST' } })
    expect(f.reads()).toBe(1)
    expect(await OutcomeKnowledgeCompositionPlan.findById(f.saved._id).lean()).toEqual(before)
    saveProof('case-' + kind, { reason: 'SOURCE_SNAPSHOT_CHANGED_RE_RESOLVE_REQUEST', planUnchanged: true, snapshotReads: f.reads() })
  })
  proofTest.each(['scope', 'receipt'])('rejects a %s mismatch before reading current evidence', async kind => {
    const f = await consumerFixture()
    await expect(admit(f, plan => {
      if (kind === 'scope') plan.tenantId = new mongoose.Types.ObjectId()
      else plan.payload.evidenceToMeaning.contractJson += 'corrupt'
      return plan
    })).rejects.toMatchObject({ code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED',
      details: { reason: 'CONTRACT_INTEGRITY_OR_BINDING_INVALID' } })
    expect(f.reads()).toBe(0)
    saveProof('case-' + kind, { reason: 'CONTRACT_INTEGRITY_OR_BINDING_INVALID', snapshotReads: 0,
      mismatch: 'in-memory copy of persisted plan only; saved plan not changed' })
  })
  proofTest('rejects unresolved required claim metadata before reading current evidence', async () => {
    const f = await consumerFixture(true)
    expect(f.contract.status).toBe('CLARIFICATION_REQUIRED')
    await expect(admit(f)).rejects.toMatchObject({ code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED',
      details: { contractHash: f.contract.contractHash } })
    expect(f.reads()).toBe(0)
    saveProof('case-required-support', { contract: f.contract, snapshotReads: 0 })
  })
  proofTest('fails closed on an explicitly injected snapshot-reader outage', async () => {
    const f = await consumerFixture()
    await expect(admit(f, plan => plan, async () => { throw new Error('Synthetic reader unavailable') }))
      .rejects.toMatchObject({ code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED', details: { reason: 'SOURCE_SNAPSHOT_UNAVAILABLE' } })
    saveProof('case-outage', { reason: 'SOURCE_SNAPSHOT_UNAVAILABLE', injectedReaderFailure: true,
      actualDatabaseOutageProved: false })
  })
})

const candidate = async (unresolved = false) => {
  const ids = Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId', 'createdBy'].map((key) => [key, new mongoose.Types.ObjectId()]))
  const input = await makeSs041Fixture()
  input.composition.runtimeBinding.runtimeInstanceId = String(ids.runtimeInstanceId)
  const scopeOverride = Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map((key) => [key, String(ids[key])]))
  if (unresolved) delete input.sourceSnapshot.evidenceObjects[0].claimStatus
  await freezeSs041Snapshot(input, { scopeOverride })
  const payload = { runtime: input.composition.runtimeBinding, lockedTruth: input.composition.truthBinding,
    consumerIntent: input.composition.requestBinding,
    resolution: { selectedPacks: Object.values(input.selectedTarget.receipt.contractIdentity).map((item) => item.selection) },
    governedContext: { outputType: { key: input.composition.outputBinding.outputTypeKey, version: '1.0.0' },
      outputSchema: { key: input.composition.outputBinding.outputSchemaKey, version: '1.0.0' } } }
  input.composition.truthBinding = { lockedTruth: payload.lockedTruth, frameworkHandoff: null }
  input.composition.requestBinding = { ...payload.consumerIntent, requestId: '' }
  input.composition.outputPlanBinding = projectRuntimeEvidenceOutputPlanBinding(payload)
  const contract = compileEvidenceToMeaningContract(input)
  payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
    contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
  const value = { ...ids, planId: `outcome_kcp_ss041_${randomUUID()}`, planVersion: 1,
    operation: 'INITIAL', status: 'READY', runtimeInstanceKey: 'ss041-synthetic', runtimeType: 'VALUE_NARRATIVE',
    frameworkKey: 'VMF', packageKey: 'synthetic-package', packageVersion: '1.0.0', requestedOutputTypeKey: 'executive-brief',
    publishSnapshotId: 'synthetic-publish', lockSnapshotId: 'synthetic-lock', replayAnchorId: 'synthetic-replay',
    dependencySnapshotId: 'synthetic-dependency', planFingerprint: contract.contractHash,
    resolutionFingerprint: 'a'.repeat(64), contextFingerprint: 'b'.repeat(64), selectedPackCount: 2,
    consideredPackCount: 2, gapCount: 0, payload }
  return { value, contract }
}

describe('SS-041 isolated real Mongo immutable plan contract', () => {
  test.each([false, true])('persists and reads back %s unresolved receipt with exact hash, snapshot and section lineage', async (unresolved) => {
    const { value, contract } = await candidate(unresolved)
    const saved = await OutcomeKnowledgeCompositionPlan.create(value)
    const readback = await OutcomeKnowledgeCompositionPlan.findById(saved._id).lean()
    expect(readback.payload.evidenceToMeaning.contractJson).toBe(JSON.stringify(contract))
    expect(readRuntimeEvidenceToMeaningContract(readback)).toEqual(contract)
    expect(projectRuntimeEvidenceToMeaningReadiness(readback)).toMatchObject({ status: unresolved ? 'CLARIFICATION_REQUIRED' : 'READY_TO_DRAFT', canExecute: !unresolved })
    expect(readback.payload.evidenceToMeaning.contractHash).toBe(contract.contractHash)
    await expect(OutcomeKnowledgeCompositionPlan.updateOne({ _id: saved._id }, { $set: { payload: {} } })).rejects.toMatchObject({ code: 'OUTCOME_KCP_IMMUTABLE' })
    expect(await OutcomeKnowledgeCompositionPlan.findById(saved._id).lean()).toMatchObject({ payload: readback.payload })
  })
  test('duplicate retry admits one immutable plan and exact winner', async () => {
    const { value } = await candidate()
    const outcomes = await Promise.allSettled([OutcomeKnowledgeCompositionPlan.create(value), OutcomeKnowledgeCompositionPlan.create(value)])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected').reason.code).toBe(11000)
    expect(await OutcomeKnowledgeCompositionPlan.countDocuments({ planId: value.planId })).toBe(1)
  })
  test('actual transaction rollback leaves no partial contract receipt', async () => {
    const { value } = await candidate()
    const session = await mongoose.startSession()
    try {
      await expect(session.withTransaction(async () => {
        await OutcomeKnowledgeCompositionPlan.create([value], { session })
        throw new Error('SS041 synthetic abort')
      })).rejects.toThrow('SS041 synthetic abort')
      expect(await OutcomeKnowledgeCompositionPlan.countDocuments({ planId: value.planId })).toBe(0)
    } finally { await session.endSession() }
  })
})
