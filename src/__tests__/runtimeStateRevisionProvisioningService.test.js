import { describe, expect, jest, test } from '@jest/globals'

import {
  RUNTIME_STATE_V2_REVISION_PROVISIONING_ERROR_CODE,
  stageRuntimeStateRevisionProvisioning,
} from '../services/runtimeStateRevisionProvisioningService.js'

const makeModel = (rows = []) => ({
  find: jest.fn(() => ({
    session: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  })),
  insertMany: jest.fn(async (documents) => documents),
})

const sourceRuntimeInstance = {
  _id: '507f1f77bcf86cd799439011',
  customerId: '507f1f77bcf86cd799439012',
  tenantId: '507f1f77bcf86cd799439013',
  runtimeInstanceKey: 'runtime-source',
}

const revisionRuntimeInstance = {
  _id: '507f1f77bcf86cd799439014',
  customerId: sourceRuntimeInstance.customerId,
  tenantId: sourceRuntimeInstance.tenantId,
  runtimeInstanceKey: 'runtime-source-rev-2',
  stateVersion: 'rsv2:11111111-1111-4111-8111-111111111111',
  framework_state: {
    sections: { customer_context: { accepted: { summary: 'Accepted context' } } },
    evidence_pack: { evidenceObjects: [] },
    intelligence_graph: {},
  },
}

const makeDependencies = ({ existingSectionRows = [] } = {}) => {
  const receipt = {
    receiptId: '507f1f77bcf86cd799439015',
    status: 'VERIFIED',
  }
  const dependencies = {
    RuntimeStateMigrationReceipt: makeModel([receipt]),
    RuntimeStateSection: makeModel(existingSectionRows),
    RuntimeEvidenceSource: makeModel(),
    RuntimeEvidenceObject: makeModel(),
    RuntimeGraphSnapshot: makeModel(),
    RuntimeGraphElement: makeModel(),
    createRuntimeStateLegacyRowSet: jest.fn(() => ({
      counts: {
        sections: 1,
        evidenceSources: 1,
        evidenceObjects: 1,
        graphSnapshots: 1,
        graphElements: 1,
      },
      sourceSetHash: 'sha256:source-set',
      rows: {
        sections: [{ sectionKey: 'customer_context', current: false }],
        evidenceSources: [{ sourceId: 'source-1', current: false }],
        evidenceObjects: [{ evidenceObjectId: 'evidence-1', current: false }],
        graphSnapshots: [{ snapshotId: 'snapshot-1', current: false, stateStatus: 'STALE' }],
        graphElements: [{ elementKey: 'node-1', current: false }],
      },
    })),
  }
  return dependencies
}

describe('Runtime State V2 revision provisioning', () => {
  test('provisions current source rows and leaves inherited graph rows stale in the revision transaction', async () => {
    const dependencies = makeDependencies()
    const session = { id: 'revision-session' }

    const result = await stageRuntimeStateRevisionProvisioning({
      sourceRuntimeInstance,
      revisionRuntimeInstance,
      session,
      now: new Date('2026-08-29T12:00:00.000Z'),
      dependencies,
    })

    expect(result).toMatchObject({
      migrationReceiptId: '507f1f77bcf86cd799439015',
      sourceSetHash: 'sha256:source-set',
    })
    expect(dependencies.RuntimeStateSection.insertMany).toHaveBeenCalledWith(
      [expect.objectContaining({ sectionKey: 'customer_context', current: true })],
      { ordered: true, session },
    )
    expect(dependencies.RuntimeEvidenceObject.insertMany).toHaveBeenCalledWith(
      [expect.objectContaining({ evidenceObjectId: 'evidence-1', current: true })],
      { ordered: true, session },
    )
    expect(dependencies.RuntimeGraphSnapshot.insertMany).toHaveBeenCalledWith(
      [expect.objectContaining({ snapshotId: 'snapshot-1', current: false, stateStatus: 'STALE' })],
      { ordered: true, session },
    )
  })

  test('fails before inserts when the revision target already has V2 child state', async () => {
    const dependencies = makeDependencies({ existingSectionRows: [{ sectionKey: 'customer_context' }] })

    await expect(stageRuntimeStateRevisionProvisioning({
      sourceRuntimeInstance,
      revisionRuntimeInstance,
      session: { id: 'revision-session' },
      dependencies,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_V2_REVISION_PROVISIONING_ERROR_CODE })

    expect(dependencies.RuntimeStateSection.insertMany).not.toHaveBeenCalled()
    expect(dependencies.RuntimeEvidenceObject.insertMany).not.toHaveBeenCalled()
  })
})
