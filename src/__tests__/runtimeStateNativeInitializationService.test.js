import mongoose from 'mongoose'
import { describe, expect, jest, test } from '@jest/globals'

import {
  buildRuntimeStateNativeInitialFrameworkState,
  buildRuntimeStateNativeCreationFrameworkState,
  normalizeRuntimeStateNativeSections,
  stageRuntimeStateNativeInitialization,
} from '../services/runtimeStateNativeInitializationService.js'
import { createRuntimeStateLegacySourceRowSet } from '../services/runtimeStateLegacyMapper.js'
import RuntimeInstance from '../models/RuntimeInstance.js'

const ids = {
  actorUserId: new mongoose.Types.ObjectId('64b000000000000000000001'),
  customerId: new mongoose.Types.ObjectId('64b000000000000000000002'),
  tenantId: new mongoose.Types.ObjectId('64b000000000000000000003'),
  runtimeInstanceId: new mongoose.Types.ObjectId('64b000000000000000000004'),
}
const stateVersion = 'rsv2:00000000-0000-4000-8000-000000000001'
const session = { id: 'native-create-transaction' }

const runtimeInstance = {
  _id: ids.runtimeInstanceId,
  customerId: ids.customerId,
  tenantId: ids.tenantId,
  runtimeInstanceKey: 'value-narrative-native',
  stateVersion,
  framework_state: { sections: {}, evidence_pack: {} },
}
const frameworkPackage = {
  frameworkKey: 'VMF',
  sections: [
    { sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context' },
    { sectionKey: 'output-requirements', runtimePath: 'framework_state.sections.output_requirements' },
  ],
}
const buildState = () => buildRuntimeStateNativeCreationFrameworkState({ frameworkPackage, stateVersion })

describe('runtimeStateNativeInitializationService', () => {
  test('builds only package-declared pristine drafts without changing the package', () => {
    const before = JSON.stringify(frameworkPackage)
    const state = buildState()
    expect(Object.keys(state.sections)).toEqual(['customer_context', 'output_requirements'])
    expect(state.sections.customer_context).toEqual({
      input: null, generated: null, accepted: null,
      state: { status: 'DRAFT' },
      lineage: { sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context' },
      revisions: [], evidenceObjects: [],
    })
    expect(JSON.stringify(frameworkPackage)).toBe(before)
    expect(buildRuntimeStateNativeCreationFrameworkState({ frameworkPackage: {}, stateVersion }))
      .toEqual({ sections: {}, evidence_pack: {} })
    const persisted = new RuntimeInstance({ ...runtimeInstance, framework_state: state }).toObject()
    expect(persisted.framework_state).toEqual({ ...state, lifecycle: { stage: 'DRAFT' } })
  })

  test.each([
    null,
    'not-an-array',
    [{ sectionKey: 'customer-context', runtimePath: 'framework_state.evidence_pack' }],
    [{ sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context.input' }],
    [{ sectionKey: 'constructor', runtimePath: 'framework_state.sections.constructor' }],
    [{ sectionKey: '__proto__', runtimePath: 'framework_state.sections.__proto__' }],
    [{ sectionKey: 'other', runtimePath: 'framework_state.sections.customer_context' }],
    [frameworkPackage.sections[0], { sectionKey: 'customer_context', runtimePath: 'framework_state.sections.customer-context' }],
  ].map((sections) => ({ sections })))('rejects malformed or ambiguous declarations: %j', ({ sections }) => {
    expect(() => buildRuntimeStateNativeCreationFrameworkState({ frameworkPackage: { sections }, stateVersion }))
      .toThrow(expect.objectContaining({ code: 'RUNTIME_STATE_V2_NATIVE_INITIALIZATION_INVALID' }))
  })

  test('inserts canonical draft rows and a matching receipt in the create transaction', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const insertMany = jest.fn().mockResolvedValue([])
    const Receipt = jest.fn().mockImplementation((payload) => ({ ...payload, receiptId: ids.runtimeInstanceId, save }))
    const root = { ...runtimeInstance, framework_state: buildState() }
    const now = new Date('2026-09-03T12:00:00.000Z')
    const receipt = await stageRuntimeStateNativeInitialization({
      actorUserId: ids.actorUserId, runtimeInstance: root, frameworkPackage, session, now,
      dependencies: { RuntimeStateMigrationReceipt: Receipt, RuntimeStateSection: { insertMany } },
    })
    const expected = createRuntimeStateLegacySourceRowSet({
      legacyInput: {
        rawBsonBytes: mongoose.mongo.BSON.serialize(root).length,
        sections: root.framework_state.sections,
        evidencePack: root.framework_state.evidence_pack,
        intelligenceGraph: root.framework_state.intelligence_graph,
      },
      scope: { runtimeInstanceId: String(ids.runtimeInstanceId), runtimeInstanceKey: root.runtimeInstanceKey,
        customerId: String(ids.customerId), tenantId: String(ids.tenantId) },
      stateVersion, migrationReceiptId: String(receipt.receiptId), migrationTimestamp: now.toISOString(),
    })
    expect(insertMany).toHaveBeenCalledWith(expected.rows.sections.map((row) => ({
      ...row, current: true, stateStatus: 'DRAFT',
    })), { session })
    expect(receipt.sourceSetHash).toBe(expected.sourceSetHash)
    expect(receipt.logicalSources.map((source) => source.recordCount)).toEqual([2, 0, 0])
    expect(save).toHaveBeenCalledWith({ session })
  })

  test.each(['accepted', 'input', 'extra', 'missing', 'evidence', 'graph'])('rejects injected initial %s before child writes', async (kind) => {
    const state = buildState()
    if (kind === 'accepted' || kind === 'input') state.sections.customer_context[kind] = { summary: 'not pristine' }
    if (kind === 'extra') state.sections.extra = state.sections.customer_context
    if (kind === 'missing') delete state.sections.customer_context
    if (kind === 'evidence') state.evidence_pack.evidenceObjects.push({ evidenceId: 'injected' })
    if (kind === 'graph') state.intelligence_graph.nodes.push({ id: 'injected' })
    const Receipt = jest.fn()
    const insertMany = jest.fn()
    await expect(stageRuntimeStateNativeInitialization({
      runtimeInstance: { ...runtimeInstance, framework_state: state }, frameworkPackage, session,
      dependencies: { RuntimeStateMigrationReceipt: Receipt, RuntimeStateSection: { insertMany } },
    })).rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_NATIVE_INITIALIZATION_INVALID' })
    expect(Receipt).not.toHaveBeenCalled()
    expect(insertMany).not.toHaveBeenCalled()
  })

  test('propagates child persistence failure without saving a verified receipt', async () => {
    const save = jest.fn()
    const Receipt = jest.fn().mockImplementation((payload) => ({ ...payload, receiptId: ids.runtimeInstanceId, save }))
    await expect(stageRuntimeStateNativeInitialization({
      runtimeInstance: { ...runtimeInstance, framework_state: buildState() }, frameworkPackage, session,
      dependencies: { RuntimeStateMigrationReceipt: Receipt,
        RuntimeStateSection: { insertMany: jest.fn().mockRejectedValue(new Error('child-write-failed')) } },
    })).rejects.toThrow('child-write-failed')
    expect(save).not.toHaveBeenCalled()
  })
  test('creates one verified native provenance receipt inside the supplied transaction', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const Receipt = jest.fn().mockImplementation((payload) => ({ ...payload, receiptId: ids.runtimeInstanceId, save }))

    const receipt = await stageRuntimeStateNativeInitialization({
      actorUserId: ids.actorUserId,
      runtimeInstance,
      session,
      now: new Date('2026-08-29T12:00:00.000Z'),
      dependencies: { RuntimeStateMigrationReceipt: Receipt },
    })

    expect(Receipt).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'NATIVE_INITIALIZATION',
      runtimeInstanceId: ids.runtimeInstanceId,
      runtimeInstanceKey: 'value-narrative-native',
      assignedStateVersion: stateVersion,
      status: 'VERIFIED',
      logicalSources: expect.arrayContaining([
        expect.objectContaining({ logicalPath: 'framework_state.sections', recordCount: 0 }),
        expect.objectContaining({ logicalPath: 'framework_state.evidence_pack', recordCount: 0 }),
        expect.objectContaining({ logicalPath: 'framework_state.intelligence_graph', recordCount: 0 }),
      ]),
    }))
    expect(save).toHaveBeenCalledWith({ session })
    expect(receipt.status).toBe('VERIFIED')
  })

  test('requires a transaction and rejects a non-empty initial source state', async () => {
    await expect(stageRuntimeStateNativeInitialization({ runtimeInstance }))
      .rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_NATIVE_INITIALIZATION_INVALID' })
    expect(() => buildRuntimeStateNativeInitialFrameworkState({
      frameworkState: { sections: { customer_context: {} }, evidence_pack: {} },
      stateVersion,
    })).toThrow(expect.objectContaining({
      code: 'RUNTIME_STATE_V2_NATIVE_INITIALIZATION_INVALID',
    }))
    expect(buildRuntimeStateNativeInitialFrameworkState({
      frameworkState: {},
      stateVersion,
    })).toEqual({
      sections: {},
      evidence_pack: { sourceRegistry: [], evidenceObjects: [] },
      intelligence_graph: { graphVersion: stateVersion, nodes: [], edges: [] },
    })
    const populatedEvidence = { sourceRegistry: [{ sourceId: 'source-1' }], evidenceObjects: [] }
    expect(normalizeRuntimeStateNativeSections({ evidence_pack: populatedEvidence })).toEqual({
      sections: {},
      evidence_pack: populatedEvidence,
    })
  })
})
