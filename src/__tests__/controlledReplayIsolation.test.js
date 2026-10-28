import { beforeAll, beforeEach, afterEach, describe, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import { storedControlledReplayBindingDigest } from '../services/controlledReplayContract.js'
import { deriveControlledReplayIsolation, validateControlledReplayIsolation, controlledReplayIsolationWrite,
  controlledReplayIsolationCas, controlledReplayIsolationAudit, controlledReplayIsolationRollback,
  attachNativeControlledReplayIsolation, copyControlledReplayIsolationWitness, assertNoControlledReplayIsolation } from '../services/controlledReplayIsolationService.js'
import { assertNormalOutcomeRuntime, isControlledSyntheticOutcomeRuntime } from '../services/syntheticOutcomeIsolationService.js'

const runtime = () => ({ _id: '1'.repeat(24), customerId: '2'.repeat(24), tenantId: '3'.repeat(24),
  runtimeInstanceKey: 'synthetic-isolation-r1', stateVersion: 'rsv2:11111111-1111-4111-8111-111111111111',
  runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF', status: 'ACTIVE', executionStatus: 'IDLE',
  updatedAt: new Date('2026-10-19T12:00:00.000Z'), framework_state: { lifecycle: { stage: 'DRAFT' } } })
const candidate = (native = runtime()) => {
  const fixture = { fixtureId: 'ss049-ac8-long-page-r1', fixtureVersion: 1,
    fixtureFileSha256: '7b7fe9a7819a71a25a043a73d7de1f9ed5b2689c36332ca981e65d7422771fd9',
    htmlSha256: '7f89c175b0da167969061551865ee67ad42b793283e61aecaec9f84aadc35777', sourceUrl: 'https://controlled-context.example/case-study' }
  const binding = { contractVersion: 'controlled-replay-binding.v1', bindingId: 'metadata-only', bindingVersion: 1,
    classification: 'CONTROLLED_SYNTHETIC_REPLAY', environment: 'DEVELOPMENT_TEST', scope: { customerId: native.customerId,
      tenantId: native.tenantId, runtimeInstanceId: native._id }, revisionId: native.runtimeInstanceKey,
    basisStateVersion: 'rsv2:22222222-2222-4222-8222-222222222222', actorUserId: '4'.repeat(24),
    authorityRef: 'synthetic:authority', isolationRef: 'synthetic:isolation', fixture }
  const descriptor = { binding, provenance: { contractVersion: 'controlled-replay-provenance.v1', classification: 'CONTROLLED_SYNTHETIC_REPLAY',
    operation: 'CONTROLLED_HTML_REPLAY_CAPTURE', adapter: 'controlled-html-replay-v1', bindingId: binding.bindingId, bindingVersion: 1,
    bindingDigest: storedControlledReplayBindingDigest(binding), ...fixture } }
  const source = { sourceId: 'synthetic-source', sourceType: 'WEBSITE', acquisitionStatus: 'NOT_ATTEMPTED',
    controlledReplayProvenance: descriptor }
  return { evidence_pack: { evidenceReady: true, needsRefresh: false, sourceRegistry: [source], lineage: { sources: [source] },
    evidenceObjects: [{ evidenceObjectId: 'synthetic-evidence', sourceId: source.sourceId,
      extractedFact: 'The synthetic trial has not started.', reviewStatus: 'PENDING', acquisitionMethod: 'CUSTOMER_PROVIDED_INPUT',
      controlledReplayProvenance: descriptor }] } }
}
const query = value => {
  const result = { select: jest.fn(), maxTimeMS: jest.fn(), limit: jest.fn(), batchSize: jest.fn(), session: jest.fn(),
    setOptions: jest.fn(), lean: jest.fn(async () => value), then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) }
  for (const key of ['select', 'maxTimeMS', 'limit', 'batchSize', 'session', 'setOptions']) result[key].mockReturnValue(result)
  return result
}
afterEach(() => jest.restoreAllMocks())

describe('controlled replay denial marker and native orphan witness', () => {
  test('derives one native-bound immutable marker and never clears it on source removal', () => {
    const native = runtime(), state = candidate(native), marker = deriveControlledReplayIsolation(native, state)
    expect(marker).toMatchObject({ classification: 'CONTROLLED_SYNTHETIC_REPLAY', runtimeInstanceKey: native.runtimeInstanceKey })
    expect(deriveControlledReplayIsolation({ ...native, controlledReplayIsolation: marker }, {})).toEqual(marker)
    expect(controlledReplayIsolationCas(native)).toEqual({ controlledReplayIsolation: { $exists: false } })
    expect(controlledReplayIsolationCas({ ...native, controlledReplayIsolation: marker })).toEqual({ controlledReplayIsolation: marker })
    expect(controlledReplayIsolationAudit(native, state)).toEqual({ controlledReplayIsolation: { from: null, to: marker } })
    expect(() => controlledReplayIsolationWrite(native, state)).toThrow(expect.objectContaining({
      details: { reason: 'CONTROLLED_REPLAY_ISOLATION_TRANSACTION_REQUIRED' } }))
    expect(controlledReplayIsolationWrite(native, state, { inTransaction: () => true })).toEqual({ controlledReplayIsolation: marker })
    expect(controlledReplayIsolationRollback(native)).toEqual({ $unset: { controlledReplayIsolation: 1 } })
    expect(deriveControlledReplayIsolation(native, {})).toBeUndefined()
    for (const mutate of [value => { value.evidence_pack.evidenceObjects[0].controlledReplayProvenance = undefined },
      value => { value.evidence_pack.sourceRegistry[0].controlledReplayProvenance.binding.scope.tenantId = 'f'.repeat(24) },
      value => { value.evidence_pack.lineage.sources = [] }]) {
      const changed = candidate(native); mutate(changed)
      expect(() => deriveControlledReplayIsolation(native, changed)).toThrow()
    }
    const changed = candidate(native)
    for (const row of [changed.evidence_pack.sourceRegistry[0], changed.evidence_pack.evidenceObjects[0]]) {
      row.controlledReplayProvenance.binding.authorityRef = 'synthetic:other'
      row.controlledReplayProvenance.provenance.bindingDigest = storedControlledReplayBindingDigest(row.controlledReplayProvenance.binding)
    }
    expect(() => deriveControlledReplayIsolation({ ...native, controlledReplayIsolation: marker }, changed)).toThrow()
  })
  test('actual Mongoose update casting retains first marker and rejects raw unknown/accessor/type material', () => {
    const native = runtime(), marker = deriveControlledReplayIsolation(native, candidate(native))
    const operation = RuntimeInstance.findOneAndUpdate({ _id: native._id }, { $set: { controlledReplayIsolation: marker } }, { runValidators: true })
    const cast = operation._castUpdate(operation.getUpdate())
    expect(cast.$set.controlledReplayIsolation.toObject()).toEqual(marker)
    expect(RuntimeInstance.schema.path('controlledReplayIsolation').options.immutable).not.toBe(true)
    for (const value of [{ ...marker, approved: true }, { ...marker, bindingDigest: 12 },
      Object.defineProperty({}, 'classification', { enumerable: true, get: () => { throw new Error('getter executed') } })]) {
      const document = new RuntimeInstance({ ...native, controlledReplayIsolation: value })
      expect(document.validateSync().errors).toHaveProperty('controlledReplayIsolation')
      expect(() => validateControlledReplayIsolation(value)).toThrow('isolation could not be verified')
    }
    for (const value of [null, false, undefined, {}, marker]) {
      expect(() => assertNormalOutcomeRuntime({ ...native, controlledReplayIsolation: value })).toThrow(expect.objectContaining({
        details: { reason: 'CONTROLLED_REPLAY_ISOLATED' } }))
    }
    expect(isControlledSyntheticOutcomeRuntime({ ...native, controlledReplayIsolation: marker })).toBe(false)
  })
  test('two scoped limit1 id-only reads consume fresh budgets/session and private witness survives explicit copy only', async () => {
    const native = runtime(), session = {}, first = query(null), second = query({ _id: 'malformed-provenance-row' })
    jest.spyOn(RuntimeEvidenceSource, 'findOne').mockReturnValue(first)
    jest.spyOn(RuntimeEvidenceObject, 'findOne').mockReturnValue(second)
    const budget = jest.fn().mockReturnValueOnce({ maxTimeMS: 1200, timeoutMS: 1300 }).mockReturnValueOnce({ maxTimeMS: 900, timeoutMS: 1000 })
    await attachNativeControlledReplayIsolation(native, { session, readBudget: budget })
    expect(budget).toHaveBeenCalledTimes(2)
    const filter = { customerId: native.customerId, tenantId: native.tenantId, runtimeInstanceId: native._id,
      runtimeInstanceKey: native.runtimeInstanceKey, stateVersion: native.stateVersion, current: true, controlledReplayProvenance: { $exists: true } }
    for (const [Model, read, timeout] of [[RuntimeEvidenceSource, first, 1200], [RuntimeEvidenceObject, second, 900]]) {
      expect(Model.findOne).toHaveBeenCalledWith(filter)
      expect(read.select).toHaveBeenCalledWith({ _id: 1 }); expect(read.limit).toHaveBeenCalledWith(1)
      expect(read.session).toHaveBeenCalledWith(session); expect(read.maxTimeMS).toHaveBeenCalledWith(timeout)
    }
    expect(() => assertNoControlledReplayIsolation(native)).toThrow()
    expect(() => assertNoControlledReplayIsolation(copyControlledReplayIsolationWitness(native, { ...native }))).toThrow()
    expect(() => copyControlledReplayIsolationWitness(native, { ...native, runtimeInstanceKey: 'other' })).toThrow()
    first.lean.mockResolvedValue(null); second.lean.mockResolvedValue(null)
    const plain = await attachNativeControlledReplayIsolation(runtime())
    copyControlledReplayIsolationWitness(plain, native)
    expect(() => assertNoControlledReplayIsolation(native)).toThrow()
    expect(() => assertNoControlledReplayIsolation({ ...runtime(), nativeControlledReplay: true })).not.toThrow()
    expect(JSON.stringify(native)).not.toContain('native-controlled-replay-origin')
  })
  test('query failure, undefined results, exhausted budget and malformed native identity cannot become empty success', async () => {
    const unexpected = new Error('Native read rejected'), first = query(null), second = query(null)
    jest.spyOn(RuntimeEvidenceSource, 'findOne').mockReturnValue(first)
    jest.spyOn(RuntimeEvidenceObject, 'findOne').mockReturnValue(second)
    first.lean.mockRejectedValueOnce(unexpected)
    await expect(attachNativeControlledReplayIsolation(runtime())).rejects.toBe(unexpected)
    first.lean.mockResolvedValueOnce(undefined)
    await expect(attachNativeControlledReplayIsolation(runtime())).rejects.toMatchObject({ status: 503 })
    await expect(attachNativeControlledReplayIsolation(runtime(), { readBudget: () => ({ maxTimeMS: 0 }) })).rejects.toMatchObject({ status: 503 })
    await expect(attachNativeControlledReplayIsolation(runtime(), { readBudget: () => ({ timeoutMS: 0 }) })).rejects.toMatchObject({ status: 503 })
    await expect(attachNativeControlledReplayIsolation({ ...runtime(), stateVersion: undefined })).rejects.toMatchObject({ status: 409 })
    const plain = await attachNativeControlledReplayIsolation(runtime())
    expect(() => assertNormalOutcomeRuntime(plain)).not.toThrow()
    second.lean.mockRejectedValueOnce(unexpected)
    await expect(attachNativeControlledReplayIsolation(runtime())).rejects.toBe(unexpected)
    second.lean.mockResolvedValueOnce(undefined)
    await expect(attachNativeControlledReplayIsolation(runtime())).rejects.toMatchObject({ status: 503 })
  })
})

describe('actual guarded public writer CAS and audit fields with offline effect owners', () => {
  let action, mutate, models, auditService, saved, native, session, audit, update, previousReadyState
  beforeAll(async () => {
    const actual = await import('../services/runtimeInstanceService.js')
    jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...actual,
      assertRuntimePermission: jest.fn(async () => {}), assertCustomerTenantContext: jest.fn(async () => ({ customer: {} })),
      assertFeatureEntitlement: jest.fn(async () => {}) }))
    const renderer = await import('../services/runtimeRendererService.js')
    jest.unstable_mockModule('../services/runtimeRendererService.js', () => ({ ...renderer,
      getRuntimeRenderer: jest.fn(async () => ({ actions: [{ actionKey: 'RUN_VALIDATION', enabled: true }] })) }))
    const rollover = await import('../services/runtimeStateSourceRolloverService.js')
    jest.unstable_mockModule('../services/runtimeStateSourceRolloverService.js', () => ({ ...rollover,
      stageRuntimeStateSourceRollover: jest.fn(async () => ({ migrationReceiptId: 'receipt', counts: {}, sourceSetHash: 'hash' })) }))
    const graph = await import('../services/runtimeStateGraphSourceMutationService.js')
    jest.unstable_mockModule('../services/runtimeStateGraphSourceMutationService.js', () => ({ ...graph,
      stageRuntimeStateGraphSourceMutation: jest.fn(async () => ({ migrationReceiptId: 'receipt', status: 'STALE' })),
      finalizeRuntimeStateGraphSourceMutation: jest.fn(async args => ({ runtimeInstance: args.runtimeInstance })) }))
    ;({ executeRuntimeAction: action } = await import('../services/runtimeActionExecutionService.js'))
    ;({ mutateRuntimeState: mutate } = await import('../services/runtimeStateMutationService.js'))
    ;({ default: models } = await import('../models/index.js'))
    ;({ default: auditService } = await import('../services/auditService.js'))
  })
  beforeEach(() => {
    native = runtime(); native.framework_state = { ...native.framework_state, ...candidate(native),
      sections: { customer_context: { input: 'before' } } }
    session = { inTransaction: () => true, withTransaction: async fn => fn(), endSession: jest.fn() }
    previousReadyState = mongoose.connection._readyState
    mongoose.connection._readyState = 1
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session)
    jest.spyOn(RuntimeInstance, 'findOne').mockImplementation(() => query(native))
    jest.spyOn(RuntimeEvidenceSource, 'findOne').mockImplementation(() => query(null))
    jest.spyOn(RuntimeEvidenceObject, 'findOne').mockImplementation(() => query(null))
    jest.spyOn(models.FrameworkPackage, 'findById').mockImplementation(() => query({ sections: [
      { key: 'customer_context', runtimePath: 'framework_state.sections.customer_context', required: false } ] }))
    jest.spyOn(models.RuntimePathRegistry, 'findOne').mockImplementation(() => query({ pathKey: 'framework_state.sections.customer_context.input',
      status: 'ACTIVE', frameworkKeys: ['VMF'], allowedOperations: ['WRITE'], dataType: 'STRING' }))
    update = jest.spyOn(RuntimeInstance, 'findOneAndUpdate').mockImplementation(async (_filter, operation) => {
      // Invoke the real model update caster before simulating its persisted return.
      const castQuery = RuntimeInstance.updateOne({}, operation)
      const cast = castQuery._castUpdate(castQuery.getUpdate())
      const fields = { ...cast.$set }
      if (fields.controlledReplayIsolation?.toObject) fields.controlledReplayIsolation = fields.controlledReplayIsolation.toObject()
      saved = { ...native, ...fields, updatedAt: new Date('2026-10-19T12:01:00.000Z') }
      return saved
    })
    jest.spyOn(RuntimeInstance.collection, 'findOne').mockImplementation(async () => ({ framework_state: saved.framework_state }))
    audit = jest.spyOn(auditService, 'log').mockResolvedValue({ _id: 'offline-audit' })
  })
  afterEach(() => { mongoose.connection._readyState = previousReadyState })
  const run = kind => kind === 'action' ? action({ actorUserId: '4'.repeat(24), runtimeInstanceId: native._id, scopes: {},
    actionKey: 'RUN_VALIDATION', payload: { expectedUpdatedAt: native.updatedAt.toISOString() } })
    : mutate({ actorUserId: '4'.repeat(24), runtimeInstanceId: native._id, scopes: {}, payload: {
      expectedUpdatedAt: native.updatedAt.toISOString(), runtimePath: 'framework_state.sections.customer_context.input',
      operation: 'WRITE', value: 'updated synthetic input' } })
  test.each(['action', 'mutation'])('%s real CAS/update casting/audit bind first marker inside active transaction', async kind => {
    const marker = deriveControlledReplayIsolation(native, native.framework_state)
    await run(kind)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ controlledReplayIsolation: { $exists: false }, stateVersion: native.stateVersion }),
      expect.objectContaining({ $set: expect.objectContaining({ controlledReplayIsolation: marker }) }), expect.objectContaining({ session, runValidators: true }))
    expect(saved.controlledReplayIsolation).toEqual(marker)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ diff: expect.objectContaining({
      controlledReplayIsolation: { from: null, to: marker } }) }), expect.objectContaining({ session, throwOnError: true }))
  })
  test.each(['action', 'mutation'])('%s refuses first marker without transactional storage before root write', async kind => {
    mongoose.connection._readyState = 0
    await expect(run(kind)).rejects.toMatchObject({ status: 503, details: { reason: 'CONTROLLED_REPLAY_ISOLATION_TRANSACTION_REQUIRED' } })
    expect(update).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled()
  })
  test('required audit failure propagates inside transaction; no mocked rollback guarantee is claimed', async () => {
    const failure = new Error('Required audit failed')
    audit.mockRejectedValueOnce(failure)
    await expect(run('mutation')).rejects.toMatchObject({ status: 500, code: 'RUNTIME_STATE_MUTATION_AUDIT_FAILED',
      details: { auditError: { name: 'Error', message: 'Required audit failed' } } })
    expect(update).toHaveBeenCalledTimes(1)
    expect(session.endSession).toHaveBeenCalledTimes(1)
  })
})
