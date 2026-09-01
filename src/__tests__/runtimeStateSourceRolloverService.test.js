import { describe, expect, jest, test } from '@jest/globals'

import { stageRuntimeStateSourceRollover } from '../services/runtimeStateSourceRolloverService.js'

const ids = {
  customerId: '64b000000000000000000001',
  tenantId: '64b000000000000000000002',
  runtimeInstanceId: '64b000000000000000000003',
  receiptId: '64b000000000000000000004',
}

const previousStateVersion = 'rsv2:00000000-0000-4000-8000-000000000001'
const nextStateVersion = 'rsv2:00000000-0000-4000-8000-000000000002'
const session = { id: 'source-transaction' }
const runtimeInstance = {
  _id: ids.runtimeInstanceId,
  customerId: ids.customerId,
  tenantId: ids.tenantId,
  runtimeInstanceKey: 'value-narrative-fixture',
  stateVersion: previousStateVersion,
  framework_state: {
    sections: { customer_context: {} },
    evidence_pack: { sources: [], evidenceObjects: [] },
    intelligence_graph: { nodes: [], edges: [] },
  },
}

const sourceHash = (family, version) => `sha256:${String(family + version).padEnd(64, '0').slice(0, 64)}`

const makeRow = ({ identityKey, identity, stateVersion, family }) => ({
  [identityKey]: identity,
  stateVersion,
  migrationReceiptId: ids.receiptId,
  sourceHash: sourceHash(family, stateVersion),
  current: false,
})

const previousRows = {
  sections: [
    makeRow({ identityKey: 'sectionKey', identity: 'customer_context', stateVersion: previousStateVersion, family: 'sections' }),
    makeRow({ identityKey: 'sectionKey', identity: 'objectives', stateVersion: previousStateVersion, family: 'sections' }),
  ],
  evidenceSources: [
    makeRow({ identityKey: 'sourceId', identity: 'source-1', stateVersion: previousStateVersion, family: 'evidence' }),
  ],
  evidenceObjects: [
    makeRow({ identityKey: 'evidenceObjectId', identity: 'evidence-1', stateVersion: previousStateVersion, family: 'evidence' }),
    makeRow({ identityKey: 'evidenceObjectId', identity: 'evidence-2', stateVersion: previousStateVersion, family: 'evidence' }),
  ],
}

const nextRows = {
  sections: [
    makeRow({ identityKey: 'sectionKey', identity: 'objectives', stateVersion: nextStateVersion, family: 'sections' }),
    makeRow({ identityKey: 'sectionKey', identity: 'risks', stateVersion: nextStateVersion, family: 'sections' }),
  ],
  evidenceSources: [
    makeRow({ identityKey: 'sourceId', identity: 'source-2', stateVersion: nextStateVersion, family: 'evidence' }),
  ],
  evidenceObjects: [
    makeRow({ identityKey: 'evidenceObjectId', identity: 'evidence-2', stateVersion: nextStateVersion, family: 'evidence' }),
  ],
}

const makeRowSet = (stateVersion) => {
  const rows = stateVersion === previousStateVersion ? previousRows : nextRows
  return {
    sourceSetHash: sourceHash('set', stateVersion),
    stateVersion,
    counts: {
      sectionCount: rows.sections.length,
      sourceCount: rows.evidenceSources.length,
      evidenceObjectCount: rows.evidenceObjects.length,
    },
    rows,
  }
}

const makeModel = (observedRows) => ({
  find: jest.fn().mockResolvedValue(observedRows.map((row) => ({ ...row, current: true }))),
  insertMany: jest.fn().mockImplementation(async (rows) => rows),
  updateMany: jest.fn().mockImplementation(async (filter) => ({
    modifiedCount: filter.stateVersion === previousStateVersion ? observedRows.length : nextRowsFor(filter, observedRows),
  })),
})

const nextRowsFor = (filter, observedRows) => {
  if (Object.prototype.hasOwnProperty.call(observedRows[0] || {}, 'sectionKey')) return nextRows.sections.length
  if (Object.prototype.hasOwnProperty.call(observedRows[0] || {}, 'sourceId')) return nextRows.evidenceSources.length
  return nextRows.evidenceObjects.length
}

const makeDependencies = () => ({
  RuntimeStateMigrationReceipt: {
    find: jest.fn().mockResolvedValue([{
      receiptId: ids.receiptId,
      assignedStateVersion: previousStateVersion,
      status: 'VERIFIED',
      verifiedAt: new Date('2026-08-28T20:00:00.000Z'),
    }]),
  },
  RuntimeStateSection: makeModel(previousRows.sections),
  RuntimeEvidenceSource: makeModel(previousRows.evidenceSources),
  RuntimeEvidenceObject: makeModel(previousRows.evidenceObjects),
  createRuntimeStateLegacySourceRowSet: jest.fn(({ stateVersion }) => makeRowSet(stateVersion)),
})

const execute = (dependencies) => stageRuntimeStateSourceRollover({
  runtimeInstance,
  expectedStateVersion: previousStateVersion,
  nextStateVersion,
  nextFrameworkState: runtimeInstance.framework_state,
  mutationTimestamp: new Date('2026-08-28T20:01:00.000Z'),
  session,
  dependencies,
})

describe('runtimeStateSourceRolloverService', () => {
  test('accepts native initialization lineage and canonicalizes the empty previous state', async () => {
    const nativeRuntime = {
      ...runtimeInstance,
      framework_state: { sections: {}, evidence_pack: {} },
    }
    const emptyRows = { sections: [], evidenceSources: [], evidenceObjects: [] }
    const dependencies = {
      RuntimeStateMigrationReceipt: {
        find: jest.fn().mockResolvedValue([{
          receiptId: ids.receiptId,
          operationType: 'NATIVE_INITIALIZATION',
          assignedStateVersion: previousStateVersion,
          status: 'VERIFIED',
          verifiedAt: new Date('2026-08-29T12:00:00.000Z'),
        }]),
      },
      RuntimeStateSection: makeModel([]),
      RuntimeEvidenceSource: makeModel([]),
      RuntimeEvidenceObject: makeModel([]),
      createRuntimeStateLegacySourceRowSet: jest.fn(() => ({
        sourceSetHash: sourceHash('native', previousStateVersion),
        stateVersion: previousStateVersion,
        counts: { sectionCount: 0, sourceCount: 0, evidenceObjectCount: 0 },
        rows: emptyRows,
      })),
    }

    await expect(stageRuntimeStateSourceRollover({
      runtimeInstance: nativeRuntime,
      expectedStateVersion: previousStateVersion,
      nextStateVersion,
      nextFrameworkState: nativeRuntime.framework_state,
      mutationTimestamp: new Date('2026-08-29T12:01:00.000Z'),
      session,
      dependencies,
    })).resolves.toMatchObject({ migrationReceiptId: ids.receiptId })

    expect(dependencies.RuntimeStateMigrationReceipt.find).toHaveBeenCalledWith(expect.objectContaining({
      operationType: { $in: ['LEGACY_BASELINE', 'NATIVE_INITIALIZATION'] },
    }))
    expect(dependencies.createRuntimeStateLegacySourceRowSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
      legacyInput: expect.objectContaining({
        evidencePack: { sourceRegistry: [], evidenceObjects: [] },
        intelligenceGraph: { graphVersion: previousStateVersion, nodes: [], edges: [] },
      }),
    }))
  })

  test('uses strict persisted native state after the initialization version advances', async () => {
    const advancedVersion = 'rsv2:00000000-0000-4000-8000-000000000003'
    const laterVersion = 'rsv2:00000000-0000-4000-8000-000000000004'
    const populatedState = {
      sections: {},
      evidence_pack: { sourceRegistry: [], evidenceObjects: [], state: { status: 'EVIDENCE_READY' } },
      intelligence_graph: { graphVersion: advancedVersion, nodes: [], edges: [] },
    }
    const dependencies = {
      RuntimeStateMigrationReceipt: {
        find: jest.fn().mockResolvedValue([{
          receiptId: ids.receiptId,
          operationType: 'NATIVE_INITIALIZATION',
          assignedStateVersion: previousStateVersion,
          status: 'VERIFIED',
          verifiedAt: new Date('2026-08-29T12:00:00.000Z'),
        }]),
      },
      RuntimeStateSection: makeModel([]),
      RuntimeEvidenceSource: makeModel([]),
      RuntimeEvidenceObject: makeModel([]),
      createRuntimeStateLegacySourceRowSet: jest.fn(({ stateVersion }) => ({
        sourceSetHash: sourceHash('native-repeat', stateVersion),
        stateVersion,
        counts: { sectionCount: 0, sourceCount: 0, evidenceObjectCount: 0 },
        rows: { sections: [], evidenceSources: [], evidenceObjects: [] },
      })),
    }

    await stageRuntimeStateSourceRollover({
      runtimeInstance: {
        ...runtimeInstance,
        stateVersion: advancedVersion,
        framework_state: new Map(),
        toObject: () => ({
          ...runtimeInstance,
          stateVersion: advancedVersion,
          framework_state: populatedState,
        }),
      },
      expectedStateVersion: advancedVersion,
      nextStateVersion: laterVersion,
      nextFrameworkState: populatedState,
      mutationTimestamp: new Date('2026-08-29T12:02:00.000Z'),
      session,
      dependencies,
    })

    expect(dependencies.createRuntimeStateLegacySourceRowSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
      legacyInput: expect.objectContaining({
        evidencePack: populatedState.evidence_pack,
        intelligenceGraph: populatedState.intelligence_graph,
      }),
    }))
  })

  test('immutably rolls all section and evidence families to one next version with added and removed identities', async () => {
    const dependencies = makeDependencies()

    const result = await execute(dependencies)

    expect(result).toMatchObject({
      migrationReceiptId: ids.receiptId,
      counts: { sectionCount: 2, sourceCount: 1, evidenceObjectCount: 1 },
    })
    expect(dependencies.RuntimeStateMigrationReceipt.find).toHaveBeenCalledWith(
      expect.not.objectContaining({ assignedStateVersion: previousStateVersion }),
    )
    for (const [modelKey, rows] of [
      ['RuntimeStateSection', nextRows.sections],
      ['RuntimeEvidenceSource', nextRows.evidenceSources],
      ['RuntimeEvidenceObject', nextRows.evidenceObjects],
    ]) {
      const model = dependencies[modelKey]
      expect(model.insertMany).toHaveBeenCalledWith(rows, { ordered: true, session })
      expect(model.updateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ stateVersion: previousStateVersion, current: true }),
        { $set: { current: false } },
        { session },
      )
      expect(model.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ stateVersion: nextStateVersion, current: false }),
        { $set: { current: true } },
        { session },
      )
    }
  })

  test('rejects a previous current identity mismatch before any child write', async () => {
    const dependencies = makeDependencies()
    dependencies.RuntimeStateSection.find.mockResolvedValue([
      { ...previousRows.sections[0], current: true },
      { ...previousRows.sections[0], sectionKey: 'unexpected', current: true },
    ])

    await expect(execute(dependencies)).rejects.toMatchObject({
      code: 'RUNTIME_STATE_V2_SOURCE_ROLLOVER_INVALID',
    })
    expect(dependencies.RuntimeStateSection.insertMany).not.toHaveBeenCalled()
    expect(dependencies.RuntimeEvidenceSource.insertMany).not.toHaveBeenCalled()
    expect(dependencies.RuntimeEvidenceObject.insertMany).not.toHaveBeenCalled()
  })

  test('rolls a second mutation from the persisted current family hash', async () => {
    const dependencies = makeDependencies()
    const persistedSectionHash = sourceHash('persisted-sections', previousStateVersion)
    dependencies.RuntimeStateSection.find.mockResolvedValue(
      previousRows.sections.map((row) => ({
        ...row,
        sourceHash: persistedSectionHash,
        current: true,
      })),
    )

    await expect(execute(dependencies)).resolves.toMatchObject({
      migrationReceiptId: ids.receiptId,
    })
    expect(dependencies.RuntimeStateSection.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stateVersion: previousStateVersion,
        sourceHash: persistedSectionHash,
        current: true,
      }),
      { $set: { current: false } },
      { session },
    )
  })

  test('propagates a child write failure while every attempted write remains in the source transaction', async () => {
    const dependencies = makeDependencies()
    dependencies.RuntimeEvidenceSource.insertMany.mockRejectedValue(new Error('source insert failed'))

    await expect(execute(dependencies)).rejects.toThrow('source insert failed')
    expect(dependencies.RuntimeStateSection.insertMany).toHaveBeenCalledWith(
      nextRows.sections,
      { ordered: true, session },
    )
    expect(dependencies.RuntimeStateSection.updateMany).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      { session },
    )
    expect(dependencies.RuntimeEvidenceSource.insertMany).toHaveBeenCalledWith(
      nextRows.evidenceSources,
      { ordered: true, session },
    )
    expect(dependencies.RuntimeEvidenceObject.insertMany).not.toHaveBeenCalled()
  })

  test('fails before child reads or writes when canonical source projection is invalid', async () => {
    const dependencies = makeDependencies()
    dependencies.createRuntimeStateLegacySourceRowSet.mockImplementation(() => {
      throw Object.assign(new Error('invalid source projection'), { code: 'SS014_V2_MAPPING_INPUT_INVALID' })
    })

    await expect(execute(dependencies)).rejects.toMatchObject({
      code: 'SS014_V2_MAPPING_INPUT_INVALID',
    })
    expect(dependencies.RuntimeStateSection.find).not.toHaveBeenCalled()
    expect(dependencies.RuntimeStateSection.insertMany).not.toHaveBeenCalled()
  })
})
