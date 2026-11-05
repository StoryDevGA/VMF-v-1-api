import { randomUUID } from 'node:crypto'
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import Stage, { validateHistoricalArlMeaningStageForRead } from '../models/OutcomeQualityStageExecution.js'
import { buildArlReview, ids } from './fixtures/outcomeQualityStageFixtures.js'
import { hashOutcomeQualityStageValue } from '../services/outcomeQualityStageExecutionService.js'
import { OUTCOME_QUALITY_STAGE_PROVIDER_CONFIG_VERSIONS } from '../constants/outcomeGovernedQuality.js'

const legacy = 'OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V11_REASONING'
const seal = row => {
  row.attemptFingerprint = hashOutcomeQualityStageValue({
    qualityRunId: row.qualityRunId, planId: row.planId, planVersion: row.planVersion, planFingerprint: row.planFingerprint,
    stageKey: row.stageKey, stageOrder: row.stageOrder, attemptNumber: row.attemptNumber,
    predecessorStageExecutionId: row.predecessorStageExecutionId, predecessorAttemptFingerprint: row.predecessorAttemptFingerprint,
    status: row.status, inputFingerprint: row.inputFingerprint, outputFingerprint: row.outputFingerprint,
    output: row.outputSnapshot, executionIdentity: row.executionIdentity,
  })
  return row
}
const fixture = () => {
  const row = new Stage({ ...buildArlReview(), stageExecutionId: 'outcome_quality_stage_' + randomUUID(),
    createdBy: ids.actor, createdAt: new Date('2026-09-25T16:17:41.824Z') }).toObject({ depopulate: true })
  Object.assign(row.executionIdentity, { executionMode: 'LIVE_TEST', providerKey: 'openai', providerConfigurationVersion: legacy,
    model: 'gpt-5.2', grrExecutionId: 'grr_exec_historical', grrRuntimeArtifactId: 'grr_art_historical' })
  return seal(row)
}
afterEach(() => jest.restoreAllMocks())

test('validates a private historical copy without mutating raw input or granting creation/admission authority', async () => {
  const raw = fixture(), before = mongoose.mongo.BSON.serialize(raw)
  await expect(new Stage(raw).validate()).rejects.toThrow()
  const receipt = await validateHistoricalArlMeaningStageForRead(raw)
  expect(Object.isFrozen(receipt)).toBe(true)
  expect(receipt).toMatchObject({ contractVersion: 'historical-arl-read.v1', status: 'VALIDATED_FOR_READ_ONLY',
    stageExecutionId: raw.stageExecutionId, outputFingerprint: raw.outputFingerprint, attemptFingerprint: raw.attemptFingerprint,
    provesProvenance: false, authorisesCreation: false, authorisesAdmission: false, authorisesApproval: false })
  expect(receipt).not.toHaveProperty('document')
  expect(mongoose.mongo.BSON.serialize(raw).equals(before)).toBe(true)
  expect(OUTCOME_QUALITY_STAGE_PROVIDER_CONFIG_VERSIONS.ARL_MEANING_REVIEW).not.toContain(legacy)
  await expect(new Stage(raw).validate()).rejects.toThrow()
})

test.each([
  ['unknown version', raw => { raw.executionIdentity.providerConfigurationVersion += '_UNKNOWN'; seal(raw) }],
  ['wrong stage', raw => { raw.stageKey = 'WORKING_DRAFT'; seal(raw) }],
  ['failed source', raw => { raw.status = 'FAILED'; seal(raw) }],
  ['wrong provider', raw => { raw.executionIdentity.providerKey = 'unknown'; seal(raw) }],
  ['missing provider artifact', raw => { raw.executionIdentity.grrRuntimeArtifactId = ''; seal(raw) }],
  ['changed output', raw => { raw.outputSnapshot.approvedMeaning.meaningSummary += ' changed' }],
  ['changed input', raw => { raw.inputSnapshot.consumerIntent = {} }],
  ['changed attempt', raw => { raw.attemptFingerprint = '0'.repeat(64) }],
])('read validation rejects %s', async (_name, change) => {
  const raw = fixture(); change(raw)
  await expect(validateHistoricalArlMeaningStageForRead(raw)).rejects.toThrow()
})

test('caller flags cannot obtain the private allowance and failures release it', async () => {
  const raw = fixture(), document = new Stage(raw)
  Object.assign(document.$locals, { historicalRead: true, allowHistoricalRead: true })
  await expect(document.validate({ historicalRead: true })).rejects.toThrow()
  let internal
  const validate = Stage.prototype.validate
  jest.spyOn(Stage.prototype, 'validate').mockImplementationOnce(function () {
    internal = this
    return Promise.reject(new Error('INJECTED_VALIDATION_FAILURE'))
  })
  await expect(validateHistoricalArlMeaningStageForRead(raw)).rejects.toThrow('INJECTED_VALIDATION_FAILURE')
  await expect(validate.call(internal)).rejects.toThrow()
})

test('concurrent read validation does not grant ordinary documents an allowance', async () => {
  const raw = fixture()
  const [first, second, ordinary] = await Promise.allSettled([
    validateHistoricalArlMeaningStageForRead(raw), validateHistoricalArlMeaningStageForRead(raw), new Stage(raw).validate(),
  ])
  expect(first.status).toBe('fulfilled')
  expect(second.status).toBe('fulfilled')
  expect(ordinary.status).toBe('rejected')
})

test('save with validation disabled refuses historical creation before the collection', async () => {
  const write = jest.spyOn(Stage.collection, 'insertOne').mockResolvedValue({ acknowledged: true })
  await expect(new Stage(fixture()).save({ validateBeforeSave: false })).rejects.toMatchObject({ code: 'OUTCOME_QUALITY_STAGE_IMMUTABLE' })
  expect(write).not.toHaveBeenCalled()
})

test.each([false, true])('insertMany lean=%s rejects trimmed historical identities before the collection', async lean => {
  const raw = fixture(); raw.executionIdentity.providerConfigurationVersion = ' ' + legacy + ' '
  const write = jest.spyOn(Stage.collection, 'insertMany').mockResolvedValue({ acknowledged: true })
  await expect(Stage.insertMany([raw], { lean })).rejects.toMatchObject({ code: 'OUTCOME_QUALITY_STAGE_IMMUTABLE' })
  expect(write).not.toHaveBeenCalled()
})

test.each([
  ['insert', () => ({ insertOne: { document: fixture() } })],
  ['dotted assignment', () => ({ updateOne: { filter: { stageExecutionId: 'test' }, update: { $set: { 'executionIdentity.providerConfigurationVersion': ' ' + legacy + ' ' } } } })],
  ['parent assignment', () => ({ updateOne: { filter: { stageExecutionId: 'test' }, update: { $set: { executionIdentity: { providerConfigurationVersion: legacy } } } } })],
  ['replacement', () => ({ replaceOne: { filter: { stageExecutionId: 'test' }, replacement: fixture() } })],
  ['upsert value', () => ({ updateOne: { filter: { stageExecutionId: 'test' }, upsert: true, update: { $setOnInsert: { 'executionIdentity.providerConfigurationVersion': legacy } } } })],
  ['upsert filter', () => ({ updateOne: { filter: { $and: [{ 'executionIdentity.providerConfigurationVersion': { $eq: legacy } }] }, upsert: true, update: { $set: { stageExecutionId: 'test' } } } })],
  ['whole-parent equality upsert', () => ({ updateOne: { filter: { $and: [{ executionIdentity: { $eq: { providerConfigurationVersion: ' ' + legacy + ' ' } } }] }, upsert: true, update: { $set: { stageExecutionId: 'test' } } } })],
  ['rename field', () => ({ updateOne: { filter: {}, update: { $rename: { other: 'executionIdentity.providerConfigurationVersion' } } } })],
  ['rename parent', () => ({ updateOne: { filter: {}, update: { $rename: { other: 'executionIdentity' } } } })],
])('bulkWrite skipValidation rejects %s before the collection', async (_name, operation) => {
  const write = jest.spyOn(Stage.collection, 'bulkWrite').mockResolvedValue({ acknowledged: true })
  await expect(Stage.bulkWrite([operation()], { skipValidation: true })).rejects.toMatchObject({ code: 'OUTCOME_QUALITY_STAGE_IMMUTABLE' })
  expect(write).not.toHaveBeenCalled()
})
