import { describe, expect, jest, test } from '@jest/globals'

import {
  finalizeRuntimeStateGraphSourceMutation,
  stageRuntimeStateGraphSourceMutation,
} from '../services/runtimeStateGraphSourceMutationService.js'

const ids = {
  customerId: '64b000000000000000000001',
  tenantId: '64b000000000000000000002',
  runtimeInstanceId: '64b000000000000000000003',
  receiptId: '64b000000000000000000004',
}

const stateVersion = 'rsv2:00000000-0000-4000-8000-000000000001'
const nextStateVersion = 'rsv2:00000000-0000-4000-8000-000000000002'
const session = { id: 'source-transaction' }
const runtimeInstance = {
  _id: ids.runtimeInstanceId,
  customerId: ids.customerId,
  tenantId: ids.tenantId,
  runtimeInstanceKey: 'value-narrative-fixture',
  stateVersion,
  updatedAt: new Date('2026-08-28T20:00:00.000Z'),
}

const makeModels = ({ snapshots = [], receipts = [], strayElement = null } = {}) => ({
  RuntimeGraphSnapshot: {
    find: jest.fn().mockResolvedValue(snapshots),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
  RuntimeGraphElement: {
    findOne: jest.fn().mockResolvedValue(strayElement),
    countDocuments: jest.fn().mockResolvedValue(3),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
  },
  RuntimeStateMigrationReceipt: {
    find: jest.fn().mockResolvedValue(receipts),
  },
})

const currentSnapshot = {
  snapshotId: 'rgs:fixture',
  stateVersion,
  migrationReceiptId: ids.receiptId,
  counts: { nodeCount: 2, edgeCount: 1 },
}

const verifiedReceipt = {
  receiptId: ids.receiptId,
  status: 'VERIFIED',
}

describe('runtimeStateGraphSourceMutationService', () => {
  test('marks the exact current graph stale inside the source transaction', async () => {
    const models = makeModels({ snapshots: [currentSnapshot], receipts: [verifiedReceipt] })

    const result = await stageRuntimeStateGraphSourceMutation({
      runtimeInstance,
      expectedStateVersion: stateVersion,
      graphWillRebuild: true,
      session,
      dependencies: models,
    })

    expect(result).toEqual({
      migrationReceiptId: ids.receiptId,
      previousSnapshotId: 'rgs:fixture',
      status: 'STALE',
    })
    expect(models.RuntimeGraphElement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        current: true,
        snapshotId: 'rgs:fixture',
        stateVersion,
        migrationReceiptId: ids.receiptId,
      }),
      { $set: { current: false } },
      { session },
    )
    expect(models.RuntimeGraphSnapshot.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ current: true, snapshotId: 'rgs:fixture', stateVersion }),
      { $set: { current: false, stateStatus: 'STALE' } },
      { session },
    )
  })

  test('rejects contradictory current graph receipt lineage before writes', async () => {
    const models = makeModels({
      snapshots: [{ ...currentSnapshot, migrationReceiptId: '64b000000000000000000099' }],
      receipts: [verifiedReceipt],
    })

    await expect(stageRuntimeStateGraphSourceMutation({
      runtimeInstance,
      expectedStateVersion: stateVersion,
      graphWillRebuild: true,
      session,
      dependencies: models,
    })).rejects.toMatchObject({ code: 'RUNTIME_STATE_V2_GRAPH_SOURCE_MUTATION_INVALID' })
    expect(models.RuntimeGraphElement.updateMany).not.toHaveBeenCalled()
    expect(models.RuntimeGraphSnapshot.updateOne).not.toHaveBeenCalled()
  })

  test('rejects current graph elements when no current snapshot exists', async () => {
    const models = makeModels({ receipts: [verifiedReceipt], strayElement: { elementKey: 'node:orphan' } })

    await expect(stageRuntimeStateGraphSourceMutation({
      runtimeInstance,
      expectedStateVersion: stateVersion,
      session,
      dependencies: models,
    })).rejects.toThrow('current elements without a current snapshot')
  })

  test('rejects extra current elements outside the selected snapshot', async () => {
    const models = makeModels({ snapshots: [currentSnapshot], receipts: [verifiedReceipt] })
    models.RuntimeGraphElement.countDocuments.mockResolvedValue(4)

    await expect(stageRuntimeStateGraphSourceMutation({
      runtimeInstance,
      expectedStateVersion: stateVersion,
      graphWillRebuild: true,
      session,
      dependencies: models,
    })).rejects.toThrow('current element set does not match')
    expect(models.RuntimeGraphElement.updateMany).not.toHaveBeenCalled()
  })

  test('returns the promotion-refreshed root timestamp', async () => {
    const promotedUpdatedAt = new Date('2026-08-28T20:00:02.000Z')
    const committedRuntime = { ...runtimeInstance, stateVersion: nextStateVersion }
    const refreshedRuntime = { ...committedRuntime, updatedAt: promotedUpdatedAt }
    const createCandidate = jest.fn().mockReturnValue({ snapshot: { snapshotId: 'rgs:new' } })
    const promoteCandidate = jest.fn().mockResolvedValue({ status: 'PROMOTED', snapshotId: 'rgs:new' })
    const RuntimeInstance = { findOne: jest.fn().mockResolvedValue(refreshedRuntime) }

    const result = await finalizeRuntimeStateGraphSourceMutation({
      actorUserId: ids.customerId,
      graph: { validation: { status: 'VALID' } },
      migrationReceiptId: ids.receiptId,
      runtimeInstance: committedRuntime,
      dependencies: {
        RuntimeInstance,
        createRuntimeStateGraphCandidate: createCandidate,
        promoteRuntimeStateGraphCandidate: promoteCandidate,
      },
    })

    expect(result.status).toBe('PROMOTED')
    expect(result.runtimeInstance.updatedAt).toEqual(promotedUpdatedAt)
    expect(createCandidate).toHaveBeenCalledWith(expect.objectContaining({ stateVersion: nextStateVersion }))
    expect(RuntimeInstance.findOne).toHaveBeenCalledWith(expect.objectContaining({ stateVersion: nextStateVersion }))
  })

  test('normalizes document identity values before building a graph candidate', async () => {
    const identityValue = (value) => ({ _id: value })
    const committedRuntime = {
      ...runtimeInstance,
      _id: identityValue(ids.runtimeInstanceId),
      customerId: identityValue(ids.customerId),
      tenantId: identityValue(ids.tenantId),
      stateVersion: nextStateVersion,
    }
    const createCandidate = jest.fn().mockReturnValue({ snapshot: { snapshotId: 'rgs:new' } })

    await finalizeRuntimeStateGraphSourceMutation({
      actorUserId: ids.customerId,
      graph: { validation: { status: 'VALID' } },
      migrationReceiptId: identityValue(ids.receiptId),
      runtimeInstance: committedRuntime,
      dependencies: {
        RuntimeInstance: { findOne: jest.fn().mockResolvedValue(committedRuntime) },
        createRuntimeStateGraphCandidate: createCandidate,
        promoteRuntimeStateGraphCandidate: jest.fn().mockResolvedValue({ status: 'PROMOTED' }),
      },
    })

    expect(createCandidate).toHaveBeenCalledWith(expect.objectContaining({
      scope: {
        runtimeInstanceId: ids.runtimeInstanceId,
        runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
        customerId: ids.customerId,
        tenantId: ids.tenantId,
      },
      migrationReceiptId: ids.receiptId,
    }))
  })

  test('preserves the committed source mutation when promotion fails', async () => {
    const committedRuntime = { ...runtimeInstance, stateVersion: nextStateVersion }

    const result = await finalizeRuntimeStateGraphSourceMutation({
      actorUserId: ids.customerId,
      graph: { validation: { status: 'VALID' } },
      migrationReceiptId: ids.receiptId,
      runtimeInstance: committedRuntime,
      dependencies: {
        createRuntimeStateGraphCandidate: jest.fn().mockReturnValue({ snapshot: { snapshotId: 'rgs:new' } }),
        promoteRuntimeStateGraphCandidate: jest.fn().mockRejectedValue(Object.assign(new Error('promotion failed'), {
          code: 'RUNTIME_STATE_V2_GRAPH_TRANSACTION_FAILED',
        })),
      },
    })

    expect(result).toMatchObject({
      errorCode: 'RUNTIME_STATE_V2_GRAPH_TRANSACTION_FAILED',
      runtimeInstance: committedRuntime,
      status: 'PROMOTION_FAILED',
    })
  })

  test('returns the committed promotion timestamp when root refresh fails', async () => {
    const committedRuntime = { ...runtimeInstance, stateVersion: nextStateVersion }
    const promotedUpdatedAt = new Date('2026-08-28T20:00:03.000Z')

    const result = await finalizeRuntimeStateGraphSourceMutation({
      actorUserId: ids.customerId,
      graph: { validation: { status: 'VALID' } },
      migrationReceiptId: ids.receiptId,
      runtimeInstance: committedRuntime,
      dependencies: {
        RuntimeInstance: { findOne: jest.fn().mockResolvedValue(null) },
        createRuntimeStateGraphCandidate: jest.fn().mockReturnValue({ snapshot: { snapshotId: 'rgs:new' } }),
        promoteRuntimeStateGraphCandidate: jest.fn().mockResolvedValue({
          status: 'PROMOTED',
          snapshotId: 'rgs:new',
          updatedAt: promotedUpdatedAt,
        }),
      },
    })

    expect(result.status).toBe('PROMOTED')
    expect(result.runtimeInstance.updatedAt).toEqual(promotedUpdatedAt)
  })

  test('reconciles a cleanup failure reported after promotion commit', async () => {
    const committedRuntime = { ...runtimeInstance, stateVersion: nextStateVersion }
    const reconciledRuntime = { ...committedRuntime, updatedAt: new Date('2026-08-28T20:00:04.000Z') }

    const result = await finalizeRuntimeStateGraphSourceMutation({
      actorUserId: ids.customerId,
      graph: { validation: { status: 'VALID' } },
      migrationReceiptId: ids.receiptId,
      runtimeInstance: committedRuntime,
      dependencies: {
        RuntimeInstance: { findOne: jest.fn().mockResolvedValue(reconciledRuntime) },
        createRuntimeStateGraphCandidate: jest.fn().mockReturnValue({ snapshot: { snapshotId: 'rgs:new' } }),
        promoteRuntimeStateGraphCandidate: jest.fn().mockRejectedValue(Object.assign(new Error('cleanup failed'), {
          code: 'RUNTIME_STATE_V2_GRAPH_CLEANUP_FAILED',
          details: { committed: true },
        })),
      },
    })

    expect(result).toMatchObject({
      errorCode: 'RUNTIME_STATE_V2_GRAPH_CLEANUP_FAILED',
      runtimeInstance: reconciledRuntime,
      status: 'PROMOTION_RECONCILED',
    })
  })

  test('uses the idempotent winner timestamp when root refresh fails', async () => {
    const committedRuntime = { ...runtimeInstance, stateVersion: nextStateVersion }
    const winnerUpdatedAt = new Date('2026-08-28T20:00:05.000Z')

    const result = await finalizeRuntimeStateGraphSourceMutation({
      actorUserId: ids.customerId,
      graph: { validation: { status: 'VALID' } },
      migrationReceiptId: ids.receiptId,
      runtimeInstance: committedRuntime,
      dependencies: {
        RuntimeInstance: { findOne: jest.fn().mockResolvedValue(null) },
        createRuntimeStateGraphCandidate: jest.fn().mockReturnValue({ snapshot: { snapshotId: 'rgs:new' } }),
        promoteRuntimeStateGraphCandidate: jest.fn().mockResolvedValue({
          status: 'ALREADY_CURRENT',
          snapshotId: 'rgs:new',
          updatedAt: winnerUpdatedAt,
        }),
      },
    })

    expect(result.status).toBe('ALREADY_CURRENT')
    expect(result.runtimeInstance.updatedAt).toEqual(winnerUpdatedAt)
  })
})
