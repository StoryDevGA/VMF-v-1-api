import { beforeAll, afterAll, describe, test, expect } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import OutcomeKnowledgeCompositionPlan from '../models/OutcomeKnowledgeCompositionPlan.js'
import { makeSs041Fixture, freezeSs041Snapshot } from './fixtures/outcomeEvidenceToDraftFixtures.js'
import { compileEvidenceToMeaningContract } from '../services/outcomeEvidenceToMeaningContractService.js'
import { readRuntimeEvidenceToMeaningContract, projectRuntimeEvidenceToMeaningReadiness,
  projectRuntimeEvidenceOutputPlanBinding } from '../services/outcomeRuntimeEvidenceToMeaningService.js'

let replica
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  const uri = replica.getUri(`ss041_contract_${randomUUID().replaceAll('-', '')}`)
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Isolated loopback replica required')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  await OutcomeKnowledgeCompositionPlan.createCollection()
  await OutcomeKnowledgeCompositionPlan.createIndexes()
}, 120000)
afterAll(async () => {
  await mongoose.disconnect()
  await replica?.stop()
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
