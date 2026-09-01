import mongoose from 'mongoose'
import { describe, expect, jest, test } from '@jest/globals'

import {
  buildRuntimeStateNativeInitialFrameworkState,
  normalizeRuntimeStateNativeSections,
  stageRuntimeStateNativeInitialization,
} from '../services/runtimeStateNativeInitializationService.js'

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

describe('runtimeStateNativeInitializationService', () => {
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
