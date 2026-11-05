import { jest, test, expect, afterAll } from '@jest/globals'
import fs from 'node:fs'
import mongoose from 'mongoose'
import Candidate from '../models/OutcomeDocxRenditionCandidate.js'
import * as sourceOwner from '../services/outcomeDocxRenditionSourceService.js'
import * as masterOwner from '../services/outcomeMeaningSourceMasterService.js'
import { PRIVATE_DOCX_CANDIDATE_INDEX, PRIVATE_DOCX_CANDIDATE_ID_INDEX } from '../services/outcomeDocxCandidateRecordContract.js'

// Unit default-import seams only: the actual persistence orchestration and
// private observation guard run, but no source admission or stored row is real.
const sourceRead = jest.fn(), masterRead = jest.fn(), compatibilityRead = jest.fn()
jest.unstable_mockModule('../services/outcomeDocxRenditionSourceService.js', () => ({ ...sourceOwner, readOutcomeDocxRenditionSource: sourceRead }))
jest.unstable_mockModule('../services/outcomeMeaningSourceMasterService.js', () => ({ ...masterOwner, readMeaningSourceMasterForRendition: masterRead }))
jest.unstable_mockModule('../services/commercialDocxCompatibilityService.js', () => ({ readApprovedCommercialCompatibility: compatibilityRead }))
const { createApprovedMasterLinkedPrivateDocxCandidate: createCandidate, assertPrivateDocxMasterObservation: assertObservation } =
  await import('../services/outcomeDocxCandidatePersistenceService.js')
const retained = JSON.parse(fs.readFileSync(new URL('./fixtures/approvedCommercialSource.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value))
const connect = jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect').mockImplementation(() => { throw Error('NETWORK_FORBIDDEN') })
const provider = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('PROVIDER_FORBIDDEN') })
const insert = jest.spyOn(mongoose.mongo.Collection.prototype, 'insertOne').mockImplementation(() => { throw Error('WRITE_FORBIDDEN') })
jest.spyOn(Candidate.collection, 'indexes').mockResolvedValue([
  { name: PRIVATE_DOCX_CANDIDATE_INDEX, unique: true, key: { tenantId: 1, customerId: 1, runtimeInstanceId: 1, requestKey: 1 } },
  { name: PRIVATE_DOCX_CANDIDATE_ID_INDEX, unique: true, key: { candidateId: 1 } },
])
const databaseRead = jest.spyOn(Candidate, 'findOne').mockImplementation(() => { throw Error('UNEXPECTED_DATABASE_READ') })
afterAll(() => {
  expect(connect).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled()
  expect(insert).not.toHaveBeenCalled(); expect(databaseRead).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})

test('only the same active default-owner operation can use its original unmodified unexpired master pointer', async () => {
  const receipt = { masterReference: copy(retained.masterReference), sourceEnvelope: copy(retained.sourceEnvelope) }
  const scope = retained.masterReference.scope
  const scopes = { customer: { _id: scope.customerId }, tenant: { _id: scope.tenantId, customerId: scope.customerId } }
  const args = { actorUserId: '6a6c763dcace7a21bd41efa9', runtimeInstanceId: scope.runtimeInstanceId, scopes,
    payload: { requestKey: '11111111-1111-4111-8111-111111111111', expectedSourceFingerprint: retained.sourceEnvelope.sourceFingerprint,
      masterId: retained.masterReference.masterId, masterVersion: 1, expectedMasterBodyFingerprint: retained.masterReference.bodyFingerprint,
      format: 'DOCX', compatibilityAuditId: 'a'.repeat(24), expectedCompatibilityFingerprint: 'b'.repeat(64) } }
  const bound = { actorUserId: args.actorUserId, runtimeInstanceId: args.runtimeInstanceId, scopes,
    masterId: retained.masterReference.masterId, version: 1 }
  const refuses = (value, context = bound, reason = 'CANDIDATE_MASTER_OBSERVATION_INVALID') =>
    expect(() => assertObservation(value, context)).toThrow(expect.objectContaining({
      details: expect.objectContaining({ reason }) }))
  const stop = Error('UNIT_STOP_BEFORE_COMPILATION_OR_STORAGE')
  sourceRead.mockResolvedValue(copy(retained.sourceEnvelope)); masterRead.mockResolvedValue(receipt)
  compatibilityRead.mockImplementationOnce(async (request, observation) => {
    expect(request.scopes).toBe(scopes); expect(observation).toBe(receipt)
    expect(assertObservation(observation, bound)).toBe(receipt)
    await Promise.resolve()
    expect(assertObservation(observation, bound)).toBe(receipt)
    refuses(copy(receipt))
    for (const changed of [{ ...bound, scopes: { ...scopes } }, { ...bound, actorUserId: 'a'.repeat(24) },
      { ...bound, runtimeInstanceId: 'a'.repeat(24) }, { ...bound, masterId: 'meaning_master_11111111-1111-4111-8111-111111111111' },
      { ...bound, version: 2 }]) refuses(observation, changed)
    const fingerprint = receipt.masterReference.bodyFingerprint
    receipt.masterReference.bodyFingerprint = '0'.repeat(64); refuses(observation)
    receipt.masterReference.bodyFingerprint = fingerprint
    expect(assertObservation(observation, bound)).toBe(receipt)
    const now = Date.now(), clock = jest.spyOn(Date, 'now').mockReturnValue(now + 480001)
    try { refuses(observation, bound, 'MASTER_CANDIDATE_DEADLINE') } finally { clock.mockRestore() }
    expect(assertObservation(observation, bound)).toBe(receipt)
    throw stop
  })
  await expect(createCandidate(args)).rejects.toBe(stop)
  refuses(receipt)
  expect(compatibilityRead).toHaveBeenCalledTimes(1)

  // A dependency override may return an old pointer but cannot reactivate the
  // earlier default context or gain a new same-operation observation.
  await expect(createCandidate({ ...args, deps: { readMaster: async () => receipt } })).rejects.toMatchObject({
    details: { reason: 'CANDIDATE_MASTER_OBSERVATION_INVALID' } })
  refuses(receipt)
  expect(compatibilityRead).toHaveBeenCalledTimes(1)
})
