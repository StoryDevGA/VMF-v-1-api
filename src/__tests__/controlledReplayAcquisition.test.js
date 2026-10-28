import { beforeEach, afterEach, describe, test, expect, jest } from '@jest/globals'
import mongoose from 'mongoose'

// Module imports, native rows/storage/permission effects are explicit unit seams.
// No native authority, HTTP, transaction rollback, index installation or durable retry proof.
const shippedCatalog = await import('../constants/controlledReplayBindings.js')
const files = await import('node:fs/promises')
const { default: nativeEnv } = await import('../config/env.js')
const catalog = [], authority = jest.fn(), exclusions = jest.fn(), readAsset = jest.fn()
jest.unstable_mockModule('../constants/controlledReplayBindings.js', () => ({ CONTROLLED_REPLAY_BINDINGS: catalog,
  verifyControlledReplayAuthority: authority, verifyControlledReplayExclusions: exclusions }))
jest.unstable_mockModule('node:fs/promises', () => ({ ...files, readFile: readAsset }))
// Native development-app scenario only; authority still comes solely from mocked imported owners.
jest.unstable_mockModule('../config/env.js', () => ({ default: { ...nativeEnv, nodeEnv: 'test', appEnv: 'development' } }))
const nativeService = await import('../services/runtimeInstanceService.js')
const permission = jest.fn(), customerContext = jest.fn(), entitlement = jest.fn()
jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({ ...nativeService,
  assertRuntimePermission: permission, assertCustomerTenantContext: customerContext, assertFeatureEntitlement: entitlement }))
const renderer = await import('../services/runtimeRendererService.js')
const rendererRead = jest.fn()
jest.unstable_mockModule('../services/runtimeRendererService.js', () => ({ ...renderer, getRuntimeRenderer: rendererRead }))
const rollover = await import('../services/runtimeStateSourceRolloverService.js')
const stageSources = jest.fn()
jest.unstable_mockModule('../services/runtimeStateSourceRolloverService.js', () => ({ ...rollover, stageRuntimeStateSourceRollover: stageSources }))
const graphStorage = await import('../services/runtimeStateGraphSourceMutationService.js')
const stageGraph = jest.fn(), finalizeGraph = jest.fn()
jest.unstable_mockModule('../services/runtimeStateGraphSourceMutationService.js', () => ({ ...graphStorage,
  stageRuntimeStateGraphSourceMutation: stageGraph, finalizeRuntimeStateGraphSourceMutation: finalizeGraph }))
const { resolveControlledReplayAcquisition: resolve, assertResolvedControlledReplay, assertControlledReplayCurrent } =
  await import('../services/controlledReplayAcquisitionService.js')
const { buildDiscoveryEvidencePack } = await import('../services/runtimeStateMutationService.js')
const { executeRuntimeAction } = await import('../services/runtimeActionExecutionService.js')
const { acquisitionRequestFingerprint, lookupAcquisitionRequest, startAcquisitionRun, buildAcquisitionRunOutcomes,
  bindAcquisitionSourceProcessing, recordAcquisitionTerminal, publicAcquisitionRun } = await import('../services/acquisitionRunService.js')
const { storedControlledReplayBindingDigest, controlledReplayProvenanceForRow } = await import('../services/controlledReplayContract.js')
const { default: Run } = await import('../models/RuntimeAcquisitionRun.js')
const { default: AuditLog } = await import('../models/AuditLog.js')
const { default: RuntimeInstance } = await import('../models/RuntimeInstance.js')
const { default: FrameworkPackage } = await import('../models/FrameworkPackage.js')
const { default: RuntimePathRegistry } = await import('../models/RuntimePathRegistry.js')
const { default: RuntimeEvidenceSource } = await import('../models/RuntimeEvidenceSource.js')
const { default: RuntimeEvidenceObject } = await import('../models/RuntimeEvidenceObject.js')
const { default: auditService } = await import('../services/auditService.js')
const { createRuntimeStateLegacySourceRowSet } = await import('../services/runtimeStateLegacyMapper.js')
const { deriveControlledReplayIsolation } = await import('../services/controlledReplayIsolationService.js')
const { snapshotHash } = await import('../utils/outcomeEvidenceSnapshot.js')
const { assertAcquisitionTerminalProof } = await import('../services/acquisitionReceiptProof.js')
const stamp = '2026-10-19T10:00:00.000Z', state = 'rsv2:11111111-1111-4111-8111-111111111111'
const runtime = () => ({ _id: '3'.repeat(24), customerId: '1'.repeat(24), tenantId: '2'.repeat(24),
  runtimeInstanceKey: 'synthetic-unit-r1', stateVersion: state, updatedAt: new Date(stamp), status: 'ACTIVE', executionStatus: 'IDLE', framework_state: {} })
const actor = '4'.repeat(24)
const binding = () => ({ contractVersion: 'controlled-replay-binding.v1', bindingId: 'synthetic-unit.1', bindingVersion: 1,
  classification: 'CONTROLLED_SYNTHETIC_REPLAY', environment: 'DEVELOPMENT_TEST', scope: {
    customerId: '1'.repeat(24), tenantId: '2'.repeat(24), runtimeInstanceId: '3'.repeat(24) }, revisionId: 'synthetic-unit-r1',
  basisStateVersion: state, actorUserId: actor, authorityRef: 'SYNTHETIC_UNIT:authority', isolationRef: 'SYNTHETIC_UNIT:exclusions',
  fixture: { fixtureId: 'ss049-ac8-long-page-r1', fixtureVersion: 1,
    fixtureFileSha256: '7b7fe9a7819a71a25a043a73d7de1f9ed5b2689c36332ca981e65d7422771fd9',
    htmlSha256: '7f89c175b0da167969061551865ee67ad42b793283e61aecaec9f84aadc35777', sourceUrl: 'https://controlled-context.example/case-study' } })
const payload = () => ({ controlledReplay: { bindingId: 'synthetic-unit.1' }, expectedUpdatedAt: stamp,
  requestKey: '55555555-5555-4555-8555-555555555555', acquisitionProfile: 'STANDARD' })
const resolveArgs = (native = runtime()) => ({ payload: payload(), runtimeInstance: native, actorUserId: actor, actionKey: 'BUILD_EVIDENCE_PACK' })
const readQuery = value => {
  const query = { then: (yes, no) => Promise.resolve(value).then(yes, no) }
  for (const key of ['setOptions', 'select', 'maxTimeMS', 'session', 'lean', 'limit', 'batchSize']) query[key] = () => query
  return query
}
beforeEach(() => {
  catalog.splice(0, catalog.length, { binding: binding() })
  // These replace unavailable imported native owners; they are NOT declarations interpreted by production code.
  authority.mockReset().mockResolvedValue({ classification: 'SYNTHETIC_UNIT', authorityRef: binding().authorityRef })
  exclusions.mockReset().mockResolvedValue({ classification: 'SYNTHETIC_UNIT', isolationRef: binding().isolationRef, parlon: false, heldSs044Family: false })
  readAsset.mockReset().mockImplementation(files.readFile)
  permission.mockReset().mockResolvedValue(undefined)
  customerContext.mockReset().mockResolvedValue({ customer: {} })
  entitlement.mockReset().mockResolvedValue(undefined)
  rendererRead.mockReset().mockResolvedValue({ actions: [{ actionKey: 'BUILD_EVIDENCE_PACK', enabled: true }] })
  stageSources.mockReset().mockResolvedValue({ migrationReceiptId: '8'.repeat(24), counts: {}, sourceSetHash: 'sha256:' + 'a'.repeat(64) })
  stageGraph.mockReset().mockResolvedValue({ migrationReceiptId: '8'.repeat(24), status: 'STALE' })
  finalizeGraph.mockReset().mockImplementation(async ({ runtimeInstance }) => ({ runtimeInstance }))
  jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Unexpected network') })
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(() => { throw new Error('Unexpected DNS') })
})
afterEach(() => { jest.restoreAllMocks(); delete globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ })

describe('inactive controlled acquisition with synthetic imported-owner witnesses', () => {
  test('shipped catalog stays empty/frozen and native authority and exclusions remain unavailable even in tests', () => {
    expect(shippedCatalog.CONTROLLED_REPLAY_BINDINGS).toEqual([])
    expect(Object.isFrozen(shippedCatalog.CONTROLLED_REPLAY_BINDINGS)).toBe(true)
    expect(() => shippedCatalog.verifyControlledReplayAuthority()).toThrow(expect.objectContaining({ details: { reason: 'CONTROLLED_REPLAY_AUTHORITY_UNVERIFIED' } }))
    expect(() => shippedCatalog.verifyControlledReplayExclusions()).toThrow(expect.objectContaining({ details: { reason: 'CONTROLLED_REPLAY_PROTECTED_SCOPE_UNVERIFIED' } }))
  })
  test('empty catalog and unavailable owners reject before any fixed asset or admission work', async () => {
    catalog.length = 0
    await expect(resolve(resolveArgs())).rejects.toMatchObject({ details: { reason: 'CONTROLLED_REPLAY_NOT_ACTIVATED' } })
    expect(authority).not.toHaveBeenCalled(); expect(readAsset).not.toHaveBeenCalled()
    catalog.push({ binding: binding() })
    authority.mockRejectedValueOnce(Object.assign(new Error('unverified'), { details: { reason: 'CONTROLLED_REPLAY_AUTHORITY_UNVERIFIED' } }))
    await expect(resolve(resolveArgs())).rejects.toMatchObject({ details: { reason: 'CONTROLLED_REPLAY_AUTHORITY_UNVERIFIED' } })
    exclusions.mockResolvedValueOnce({ isolationRef: binding().isolationRef })
    await expect(resolve(resolveArgs())).rejects.toMatchObject({ details: { reason: 'CONTROLLED_REPLAY_PROTECTED_SCOPE_UNVERIFIED' } })
    expect(readAsset).not.toHaveBeenCalled()
  })
  test('only original resolved references work; cloning, wrong native scope/actor and mixed input reject', async () => {
    const context = await resolve(resolveArgs())
    expect(assertResolvedControlledReplay(context)).toBe(context)
    for (const forged of [{ ...context }, JSON.parse(JSON.stringify(context)), {}]) expect(() => assertResolvedControlledReplay(forged)).toThrow()
    await expect(resolve({ ...resolveArgs(), actorUserId: '6'.repeat(24) })).rejects.toThrow()
    await expect(resolve(resolveArgs({ ...runtime(), customerId: '6'.repeat(24) }))).rejects.toThrow()
    await expect(resolve({ ...resolveArgs(), payload: { ...payload(), inputs: {} } })).rejects.toThrow()
    expect(() => acquisitionRequestFingerprint({ payload: payload(), actorUserId: actor, controlledContext: { ...context } })).toThrow()
    expect(() => assertControlledReplayCurrent(context, { ...runtime(), lockedAt: new Date() }, payload())).toThrow()
    expect(() => assertControlledReplayCurrent(context, { ...runtime(), stateVersion: 'later-output' }, payload())).toThrow()
  })
  test.each(['missing', 'bytes', 'html'])('fixed asset %s cannot fall back to network', async fault => {
    if (fault === 'missing') readAsset.mockRejectedValueOnce(new Error('missing'))
    else readAsset.mockResolvedValueOnce(Buffer.from(fault === 'bytes' ? '{}' : '{"html":"changed"}'))
    await expect(resolve(resolveArgs())).rejects.toMatchObject({ details: { reason: 'CONTROLLED_REPLAY_ASSET_UNVERIFIED' } })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).not.toHaveBeenCalled()
  })
  test('actual controlled semantic pack survives native mapper/models with pending assertions and exact spans', async () => {
    const native = runtime(), context = await resolve(resolveArgs(native))
    const execution = { runId: '66666666-6666-4666-8666-666666666666', executionAttemptId: '77777777-7777-4777-8777-777777777777' }
    const pack = await buildDiscoveryEvidencePack({ runtimeInstance: native, actorUserId: actor, controlledContext: context,
      acquisitionExecution: execution, acquisitionProfile: 'STANDARD' })
    expect(pack.evidenceObjects.length).toBeGreaterThan(0)
    expect(pack.accepted).toBe(false)
    expect(pack.lineage.sources[0]).toMatchObject({ type: 'CONTROLLED_HTML_REPLAY', acquisitionStatus: 'CAPTURED',
      sourceCapture: { captureReceipt: { runId: execution.runId, attemptId: execution.executionAttemptId, inputIndex: 0 } } })
    for (const row of pack.evidenceObjects) {
      expect(row.reviewStatus).toBe('PENDING'); expect(row.acquisitionMethod).toBe('CONTROLLED_HTML_REPLAY')
      expect(row.confidence.basis).not.toContain('WEBSITE_PAGE_ACQUIRED')
      if (row.evidenceSupport) expect(row.evidenceSupport.epistemicType).toBe('SOURCE_ASSERTION')
      expect(() => controlledReplayProvenanceForRow({ ...row, sourceType: 'WEBSITE', acquisitionMethod: 'WEBSITE_PAGE_ACQUIRED' })).toThrow()
    }
    const mapped = createRuntimeStateLegacySourceRowSet({ legacyInput: { rawBsonBytes: 4096, sections: {}, evidencePack: pack,
      intelligenceGraph: { graphVersion: 'SYNTHETIC_UNIT.v1', nodes: [], edges: [] } },
      scope: { ...binding().scope, runtimeInstanceKey: native.runtimeInstanceKey }, stateVersion: state,
      migrationReceiptId: '8'.repeat(24), migrationTimestamp: stamp })
    for (const row of mapped.rows.evidenceSources) expect(new RuntimeEvidenceSource(row).validateSync()).toBeUndefined()
    for (const row of mapped.rows.evidenceObjects) expect(new RuntimeEvidenceObject(row).validateSync()).toBeUndefined()
    expect(new RuntimeEvidenceObject(mapped.rows.evidenceObjects[0]).sourceType).toBe('')
    expect(mapped.rows.evidenceSources[0].sourceCapture).toEqual(pack.sourceRegistry[0].sourceCapture)
    expect(mapped.rows.evidenceObjects).toHaveLength(pack.evidenceObjects.length)
    expect(new Set(mapped.rows.evidenceObjects.map(row => row.evidenceObjectId)).size).toBe(pack.evidenceObjects.length)
    expect(mapped.rows.evidenceObjects.map(row => row.evidenceObjectId).sort()).toEqual(pack.evidenceObjects.map(row => row.evidenceObjectId).sort())
    for (const row of mapped.rows.evidenceObjects)
      expect(row.evidenceSupport).toEqual(pack.evidenceObjects.find(item => item.evidenceObjectId === row.evidenceObjectId).evidenceSupport)
    const stored = mapped.rows.evidenceObjects.find(row => row.evidenceSupport)
    expect(stored.current).toBe(false)
    expect(controlledReplayProvenanceForRow(stored, stored)).toEqual(context.descriptor)
    expect(() => controlledReplayProvenanceForRow({ ...stored, acquisitionMethod: 'WEBSITE_PAGE_ACQUIRED' }, stored)).toThrow()
    const rootMissingMethod = { ...pack.evidenceObjects.find(row => row.evidenceSupport) }
    delete rootMissingMethod.acquisitionMethod
    expect(() => controlledReplayProvenanceForRow(rootMissingMethod,
      { ...binding().scope, runtimeInstanceKey: native.runtimeInstanceKey })).toThrow()
    expect(() => controlledReplayProvenanceForRow({ ...pack.evidenceObjects.find(row => row.evidenceSupport), sourceType: '' },
      { ...binding().scope, runtimeInstanceKey: native.runtimeInstanceKey })).toThrow()
    expect(deriveControlledReplayIsolation(native, { evidence_pack: pack }).bindingDigest).toBe(storedControlledReplayBindingDigest(binding()))
  })
  test('maintained Run admission, actual processing, signed terminal and exact retry after own output with offline storage seams', async () => {
    const native = runtime(), controlledContext = await resolve(resolveArgs(native)), records = [], audits = new Map()
    const oldReady = mongoose.connection._readyState
    mongoose.connection._readyState = 1
    const session = { inTransaction: () => true, withTransaction: async work => work(session), endSession: jest.fn() }
    const matches = (row, filter) => Object.entries(filter).every(([key, value]) => String(row[key]) === String(value))
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session)
    jest.spyOn(Run.collection, 'listIndexes').mockReturnValue({ toArray: async () => Run.schema.indexes().map(([key, options]) => ({ key, ...options })) })
    jest.spyOn(Run.collection, 'findOne').mockImplementation(async filter => records.find(row => matches(row, filter)) || null)
    jest.spyOn(Run.prototype, 'save').mockImplementation(async function () { await this.validate(); records.push(this.toObject()); return this })
    jest.spyOn(Run.collection, 'updateOne').mockImplementation(async (filter, update) => {
      const row = records.find(value => matches(value, filter)); if (!row) return { modifiedCount: 0 }
      Object.assign(row, update.$set); return { modifiedCount: 1 }
    })
    jest.spyOn(RuntimeInstance.collection, 'findOne').mockImplementation(async () => native)
    jest.spyOn(auditService, 'log').mockImplementation(async data => {
      const audit = new AuditLog(data); audit.generateSignature(); audits.set(String(audit._id), audit); return audit
    })
    jest.spyOn(AuditLog, 'findOne').mockImplementation(filter => readQuery(audits.get(String(filter._id))))
    try {
      const context = await lookupAcquisitionRequest({ runtimeInstance: native, payload: payload(), actorUserId: actor,
        actionKey: 'BUILD_EVIDENCE_PACK', controlledContext })
      await startAcquisitionRun(context, {})
      expect(context.row.contractVersion).toBe('controlled-acquisition-run.v1')
      expect(context.row.inputs).toEqual([{ kind: 'CONTROLLED', inputIndex: 0, contentHash: binding().fixture.htmlSha256 }])
      const pack = await buildDiscoveryEvidencePack({ runtimeInstance: native, actorUserId: actor, controlledContext,
        acquisitionExecution: context, acquisitionProfile: 'STANDARD' })
      bindAcquisitionSourceProcessing(context, pack)
      expect(buildAcquisitionRunOutcomes(context, pack)).toMatchObject([{ kind: 'CONTROLLED', status: 'SUCCEEDED', evidenceObjectCount: pack.evidenceObjects.length }])
      for (const change of ['run', 'method', 'descriptor']) {
        const bad = JSON.parse(JSON.stringify(pack))
        if (change === 'run') bad.lineage.sources[0].sourceCapture.captureReceipt.runId = '99999999-9999-4999-8999-999999999999'
        if (change === 'method') bad.evidenceObjects[0].acquisitionMethod = 'WEBSITE_PAGE_ACQUIRED'
        if (change === 'descriptor') bad.sourceRegistry[0].controlledReplayProvenance.binding.authorityRef = 'changed'
        expect(() => buildAcquisitionRunOutcomes(context, bad)).toThrow()
      }
      const saveAudit = new AuditLog({ actorUserId: actor, resourceType: 'RuntimeInstance', resourceId: native._id,
        action: 'RUNTIME_ACTION_EXECUTED', diff: { synthetic: true } }); saveAudit.generateSignature(); audits.set(String(saveAudit._id), saveAudit)
      const outputStateVersion = 'rsv2:99999999-9999-4999-8999-999999999999'
      await recordAcquisitionTerminal({ context, pack, outputStateVersion, saveAudit, session })
      native.stateVersion = outputStateVersion; native.updatedAt = new Date('2026-10-19T11:00:00.000Z')
      native.controlledReplayIsolation = deriveControlledReplayIsolation(native, { evidence_pack: pack })
      const retryContext = await resolve(resolveArgs(native))
      const replay = await lookupAcquisitionRequest({ runtimeInstance: native, payload: payload(), actorUserId: actor,
        actionKey: 'BUILD_EVIDENCE_PACK', controlledContext: retryContext })
      expect(replay.replay).toMatchObject({ runId: context.runId, replay: true, canonicalSaved: true })
      expect(publicAcquisitionRun(records[0]).controlledReplayProvenance).toEqual(controlledContext.descriptor)
      expect(() => assertControlledReplayCurrent(retryContext, native, payload())).toThrow()
      const terminal = audits.get(String(records[0].terminalAuditId))
      for (const change of [{ basisStateVersion: outputStateVersion }, { actorUserId: '9'.repeat(24) }, { actionKey: 'SAVE_DISCOVERY_INPUTS' }]) {
        const row = { ...records[0], ...change }
        expect(() => assertAcquisitionTerminalProof(row, terminal, saveAudit)).toThrow()
        expect(() => publicAcquisitionRun(row)).toThrow()
      }
      const bindingProof = terminal.diff.controlledRun
      delete terminal.diff.controlledRun; terminal.generateSignature()
      expect(terminal.verifySignature()).toBe(true)
      expect(() => assertAcquisitionTerminalProof(records[0], terminal, saveAudit)).toThrow(expect.objectContaining({
        status: 503, details: { reason: 'ACQUISITION_RECEIPT_UNVERIFIED', runId: context.runId } }))
      await expect(lookupAcquisitionRequest({ runtimeInstance: native, payload: payload(), actorUserId: actor,
        actionKey: 'BUILD_EVIDENCE_PACK', controlledContext: retryContext })).rejects.toMatchObject({ status: 503,
        details: { reason: 'ACQUISITION_RECEIPT_UNVERIFIED' } })
      terminal.diff.controlledRun = { ...bindingProof, descriptorHash: 'changed' }; terminal.generateSignature()
      await expect(lookupAcquisitionRequest({ runtimeInstance: native, payload: payload(), actorUserId: actor,
        actionKey: 'BUILD_EVIDENCE_PACK', controlledContext: retryContext })).rejects.toMatchObject({ details: { reason: 'ACQUISITION_RECEIPT_UNVERIFIED' } })
    } finally { mongoose.connection._readyState = oldReady }
  })
  test('actual executeRuntimeAction carries original context and Run execution through root CAS/save audit and terminal proof', async () => {
    const native = { ...runtime(), runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF', packageId: '9'.repeat(24),
      framework_state: { sections: { customer_context: { input: 'Synthetic controlled context' } } } }
    const frameworkPackage = { _id: native.packageId, frameworkKey: 'VMF', packageKey: 'synthetic-unit-package',
      version: '1.0.0', sections: [{ key: 'customer_context', runtimePath: 'framework_state.sections.customer_context', required: false }] }
    const records = [], audits = new Map(), oldReady = mongoose.connection._readyState
    let saved = native
    mongoose.connection._readyState = 1
    const session = { inTransaction: () => true, withTransaction: async work => work(session), endSession: jest.fn() }
    const matches = (row, filter) => Object.entries(filter).every(([key, value]) => String(row[key]) === String(value))
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session)
    jest.spyOn(RuntimeInstance, 'findOne').mockImplementation(() => readQuery(saved))
    jest.spyOn(RuntimeEvidenceSource, 'findOne').mockImplementation(() => readQuery(null))
    jest.spyOn(RuntimeEvidenceObject, 'findOne').mockImplementation(() => readQuery(null))
    jest.spyOn(FrameworkPackage, 'findById').mockImplementation(() => readQuery(frameworkPackage))
    const readPath = jest.spyOn(RuntimePathRegistry, 'findOne').mockImplementation(({ pathKey }) => {
      if (pathKey !== 'framework_state.evidence_pack') throw new Error('Unexpected native runtime path read')
      return readQuery({ pathKey, status: 'ACTIVE', frameworkKeys: ['VMF'], allowedOperations: ['WRITE'], dataType: 'OBJECT' })
    })
    jest.spyOn(RuntimeInstance.collection, 'findOne').mockImplementation(async () => saved)
    const updateRoot = jest.spyOn(RuntimeInstance, 'findOneAndUpdate').mockImplementation(async (_filter, operation) => {
      const caster = RuntimeInstance.updateOne({}, operation), cast = caster._castUpdate(caster.getUpdate())
      const fields = { ...cast.$set }
      if (fields.controlledReplayIsolation?.toObject) fields.controlledReplayIsolation = fields.controlledReplayIsolation.toObject()
      saved = { ...native, ...fields, updatedAt: new Date() }
      return saved
    })
    jest.spyOn(Run.collection, 'listIndexes').mockReturnValue({ toArray: async () => Run.schema.indexes().map(([key, options]) => ({ key, ...options })) })
    jest.spyOn(Run.collection, 'findOne').mockImplementation(async filter => records.find(row => matches(row, filter)) || null)
    jest.spyOn(Run.prototype, 'save').mockImplementation(async function () { await this.validate(); records.push(this.toObject()); return this })
    jest.spyOn(Run.collection, 'updateOne').mockImplementation(async (filter, update) => {
      const row = records.find(value => matches(value, filter)); if (!row) return { modifiedCount: 0 }
      Object.assign(row, update.$set); return { modifiedCount: 1 }
    })
    const auditWrite = jest.spyOn(auditService, 'log').mockImplementation(async data => {
      const audit = new AuditLog(data); audit.generateSignature(); audits.set(String(audit._id), audit); return audit
    })
    jest.spyOn(AuditLog, 'findOne').mockImplementation(filter => readQuery(audits.get(String(filter._id))))
    try {
      const response = await executeRuntimeAction({ actionKey: 'BUILD_EVIDENCE_PACK', actorUserId: actor,
        scopes: { synthetic: true }, payload: payload(), runtimeInstanceId: native._id })
      expect(permission).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actor,
        customerId: native.customerId, tenantId: native.tenantId, permission: 'VMF_UPDATE' }))
      expect(authority).toHaveBeenCalledWith(expect.objectContaining({ runtimeInstance: native, actorUserId: actor }))
      expect(readAsset).toHaveBeenCalledTimes(1)
      expect(readPath).toHaveBeenCalledWith({ pathKey: 'framework_state.evidence_pack' })
      expect(records).toHaveLength(1)
      const run = records[0], pack = saved.framework_state.evidence_pack
      expect(response.acquisitionRun).toMatchObject({ runId: run.runId, status: 'SUCCEEDED', canonicalSaved: true,
        outputStateVersion: saved.stateVersion, controlledReplayProvenance: run.controlledReplayProvenance })
      expect(run.inputs).toEqual([{ kind: 'CONTROLLED', inputIndex: 0, contentHash: binding().fixture.htmlSha256 }])
      expect(pack.lineage.sources[0].sourceCapture.captureReceipt).toMatchObject({ runId: run.runId,
        attemptId: run.executionAttemptId, operation: 'CONTROLLED_HTML_REPLAY_CAPTURE' })
      expect(pack.acquisition.runId).toBe(run.runId)
      expect(pack.evidenceObjects.every(row => row.acquisitionMethod === 'CONTROLLED_HTML_REPLAY' && row.reviewStatus === 'PENDING')).toBe(true)
      expect(updateRoot).toHaveBeenCalledWith(expect.objectContaining({ stateVersion: state, updatedAt: new Date(stamp),
        controlledReplayIsolation: { $exists: false } }), expect.objectContaining({ $set: expect.objectContaining({
        controlledReplayIsolation: saved.controlledReplayIsolation, stateVersion: saved.stateVersion }) }),
      expect.objectContaining({ session, runValidators: true }))
      expect(saved.controlledReplayIsolation.bindingDigest).toBe(storedControlledReplayBindingDigest(binding()))
      expect(saved.stateVersion).not.toBe(state)
      const saveAudit = audits.get(String(run.saveAuditId)), terminal = audits.get(String(run.terminalAuditId))
      expect(saveAudit.action).toBe('RUNTIME_ACTION_EXECUTED')
      expect(saveAudit.diff.controlledReplayIsolation).toEqual({ from: null, to: saved.controlledReplayIsolation })
      expect(terminal.diff.saveAuditSignature).toBe(saveAudit.signature)
      expect(() => assertAcquisitionTerminalProof(run, terminal, saveAudit)).not.toThrow()
      for (const [, options] of auditWrite.mock.calls) expect(options).toMatchObject({ session, throwOnError: true })
      expect(stageSources).toHaveBeenCalledWith(expect.objectContaining({ session, nextStateVersion: saved.stateVersion }))
      expect(stageGraph).toHaveBeenCalledWith(expect.objectContaining({ session, graphWillRebuild: true }))
      expect(saved.framework_state.intelligence_graph.validation.status).toBe('VALID')
      expect(globalThis.fetch).not.toHaveBeenCalled()
      expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).not.toHaveBeenCalled()
    } finally { mongoose.connection._readyState = oldReady }
  })
})
