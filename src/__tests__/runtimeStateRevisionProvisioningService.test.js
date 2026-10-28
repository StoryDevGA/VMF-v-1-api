import { describe, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import { createRuntimeStateLegacyRowSet } from '../services/runtimeStateLegacyMapper.js'
import { createSectionHistoryReadContext, getSectionHistoryRowKey, hashSectionHistoryPair } from '../services/runtimeSectionHistoryContract.js'

import {
  RUNTIME_STATE_V2_REVISION_PROVISIONING_ERROR_CODE,
  stageRuntimeStateRevisionProvisioning,
} from '../services/runtimeStateRevisionProvisioningService.js'

const makeModel = (rows = []) => ({
  find: jest.fn((filter) => ({
    session: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maxTimeMS: jest.fn().mockReturnThis(),
    lean: jest.fn(async () => typeof rows === 'function' ? rows(filter) : rows),
  })),
  insertMany: jest.fn(async (documents) => documents),
})

const clone = value => JSON.parse(JSON.stringify(value))
const historyFixture = ({ count = 7, inlineIndices = [] } = {}) => {
  const now = new Date('2026-10-20T07:00:00.000Z')
  const source = { ...sourceRuntimeInstance, stateVersion: 'rsv2:22222222-2222-4222-8222-222222222222',
    framework_state: { sections: {}, evidence_pack: { sourceRegistry: [], evidenceObjects: [] },
      intelligence_graph: { graphVersion: 'unit-history-v1', nodes: [], edges: [] } } }
  const receiptId = '507f1f77bcf86cd799439015'
  const input = runtime => ({ legacyInput: { rawBsonBytes: 1024, sections: runtime.framework_state.sections,
    evidencePack: source.framework_state.evidence_pack, intelligenceGraph: source.framework_state.intelligence_graph }, scope: { customerId: runtime.customerId, tenantId: runtime.tenantId,
    runtimeInstanceId: runtime._id, runtimeInstanceKey: runtime.runtimeInstanceKey }, stateVersion: runtime.stateVersion,
  migrationReceiptId: receiptId, migrationTimestamp: now.toISOString() })
  const archives = Array.from({ length: count }, (_, index) => ({ revisionNumber: index + 1, reason: `Archive ${index + 1}`,
    generated: { summary: `Generated ${index}`, paragraphs: ['a'.repeat(6000), 'b'.repeat(6000), 'c'.repeat(6000), 'g'.repeat(6000)] },
    accepted: { summary: `Accepted ${index}`, paragraphs: ['d'.repeat(6000), 'e'.repeat(6000), 's'.repeat(6000)] } }))
  const targets = archives.map((record, index) => {
    const runtime = { ...source, stateVersion: `rsv2:33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
      framework_state: { sections: { customer_context: { generated: record.generated, accepted: record.accepted } } } }
    return { ...createRuntimeStateLegacyRowSet(input(runtime)).rows.sections[0], _id: new mongoose.Types.ObjectId(), current: false }
  })
  source.framework_state.sections.customer_context = { generated: archives.at(-1).generated, accepted: archives.at(-1).accepted, revisions: archives }
  const sourceRow = { ...createRuntimeStateLegacyRowSet(input(source), { sectionDetailProjector: detail => ({ ...detail,
    revisions: detail.revisions.map((record, index) => inlineIndices.includes(index) ? record : ({ ...record, generated: null, accepted: null,
      historyReference: { version: 'runtime-section-history.v1', stateVersion: targets[index].stateVersion,
        sourceHash: targets[index].sourceHash, index: -1, hash: hashSectionHistoryPair(record), hasGenerated: true, hasAccepted: true } })) }) }).rows.sections[0],
  _id: new mongoose.Types.ObjectId(), current: true }
  const revision = { ...revisionRuntimeInstance, framework_state: clone(source.framework_state) }
  const dependencies = makeDependencies()
  dependencies.createRuntimeStateLegacyRowSet = jest.fn(createRuntimeStateLegacyRowSet)
  dependencies.RuntimeStateSection = makeModel(filter => {
    if (String(filter.runtimeInstanceId) !== source._id) return []
    if (filter.current === true) return [sourceRow]
    return targets.filter(row => row.stateVersion === filter.stateVersion && row.sourceHash === filter.sourceHash)
  })
  const session = { inTransaction: () => true }
  return { source, revision, sourceRow, targets, dependencies, session, now, args: {
    sourceRuntimeInstance: source, revisionRuntimeInstance: revision, dependencies, session, now } }
}

describe('child-owned inherited section history (component persistence seams)', () => {
  test('projects seven full archives and restores them through child-owned bounded targets without changing the source', async () => {
    const f = historyFixture(), before = JSON.stringify({ source: f.source, sourceRow: f.sourceRow, targets: f.targets, revision: f.revision })
    expect(Buffer.byteLength(JSON.stringify(f.revision.framework_state.sections.customer_context))).toBeGreaterThan(256 * 1024)
    await stageRuntimeStateRevisionProvisioning(f.args)
    const calls = f.dependencies.RuntimeStateSection.insertMany.mock.calls
    expect(calls).toHaveLength(2)
    const historical = calls[0][0], current = calls[1][0]
    expect(historical).toHaveLength(7)
    expect(current).toHaveLength(1)
    expect(historical.every(row => row.current === false && String(row.runtimeInstanceId) === f.revision._id)).toBe(true)
    expect(new Set(historical.map(row => String(row._id))).size).toBe(7)
    for (const row of historical) {
      const original = f.targets.find(target => target.stateVersion === row.stateVersion)
      expect(String(row._id)).not.toBe(String(original._id))
      expect(row.sectionDetail).toEqual(original.sectionDetail)
      expect(row.sourceHash).toBe(original.sourceHash)
      expect(row.projectionReceipt).toEqual(original.projectionReceipt)
    }
    for (const row of [...historical, ...current]) expect(new RuntimeStateSection(row).validateSync()).toBeUndefined()
    expect(Buffer.byteLength(JSON.stringify(current[0].sectionDetail))).toBeLessThanOrEqual(256 * 1024)
    const restored = await createSectionHistoryReadContext({ readRows: async filter => historical.filter(row =>
      Object.entries(filter).every(([key, value]) => String(row[key]) === String(value))) }).verify(current)
    expect([...restored.get(getSectionHistoryRowKey(current[0])).values()]).toEqual(f.revision.framework_state.sections.customer_context.revisions)
    expect(JSON.stringify({ source: f.source, sourceRow: f.sourceRow, targets: f.targets, revision: f.revision })).toBe(before)
    for (const [, options] of calls) expect(options).toEqual({ ordered: true, session: f.session })
    expect(f.dependencies.RuntimeStateSection.find.mock.calls.every(([filter]) =>
      String(filter.runtimeInstanceId) === f.source._id || String(filter.runtimeInstanceId) === f.revision._id)).toBe(true)
  })

  test.each(['source-scope', 'source-state', 'source-domain', 'baseline', 'missing', 'ambiguous', 'tampered', 'changed-child', 'conflicting-version'])(
    'rejects %s before any child insert', async corruption => {
      const f = historyFixture()
      if (corruption === 'source-scope') f.sourceRow.customerId = '507f1f77bcf86cd799439099'
      if (corruption === 'source-state') f.sourceRow.sourceStateVersion = f.revision.stateVersion
      if (corruption === 'source-domain') {
        f.sourceRow.sourceHash = 'sha256:' + 'f'.repeat(64)
        f.sourceRow.projectionReceipt.sourceHash = f.sourceRow.sourceHash
      }
      if (corruption === 'baseline') f.sourceRow.migrationReceiptId = '507f1f77bcf86cd799439099'
      if (corruption === 'missing') f.targets.splice(0, 1)
      if (corruption === 'ambiguous') f.targets.push({ ...f.targets[0], _id: new mongoose.Types.ObjectId() })
      if (corruption === 'tampered') f.targets[0].sectionDetail.accepted.summary = 'Changed historical fact'
      if (corruption === 'changed-child') f.revision.framework_state.sections.customer_context.accepted.summary = 'Changed inherited fact'
      if (corruption === 'conflicting-version') {
        f.targets[1].stateVersion = f.targets[0].stateVersion
        f.targets[1].sourceStateVersion = f.targets[0].stateVersion
        f.targets[1].projectionReceipt.stateVersion = f.targets[0].stateVersion
        f.sourceRow.sectionDetail.revisions[1].historyReference.stateVersion = f.targets[0].stateVersion
      }
      await expect(stageRuntimeStateRevisionProvisioning(f.args)).rejects.toMatchObject({ code: RUNTIME_STATE_V2_REVISION_PROVISIONING_ERROR_CODE })
      expect(f.dependencies.RuntimeStateSection.insertMany).not.toHaveBeenCalled()
      expect(f.dependencies.RuntimeEvidenceObject.insertMany).not.toHaveBeenCalled()
    })

  test('requires the active caller transaction for inherited history', async () => {
    const f = historyFixture()
    f.args.session = {}
    await expect(stageRuntimeStateRevisionProvisioning(f.args)).rejects.toMatchObject({ code: RUNTIME_STATE_V2_REVISION_PROVISIONING_ERROR_CODE })
    expect(f.dependencies.RuntimeStateSection.insertMany).not.toHaveBeenCalled()
  })

  test.each([{ count: 7, inlineIndices: [0, 3], expectedTargets: 5 },
    { count: 2, inlineIndices: [0, 1], expectedTargets: 0 }])('restores original archive order with inline records: %j', async options => {
    const f = historyFixture(options), before = JSON.stringify({ source: f.source, sourceRow: f.sourceRow, targets: f.targets })
    await stageRuntimeStateRevisionProvisioning(f.args)
    const inserted = f.dependencies.RuntimeStateSection.insertMany.mock.calls.flatMap(([rows]) => rows)
    const current = inserted.filter(row => row.current), historical = inserted.filter(row => !row.current)
    expect(historical).toHaveLength(options.expectedTargets)
    const verified = await createSectionHistoryReadContext({ readRows: async filter => historical.filter(row =>
      Object.entries(filter).every(([key, value]) => String(row[key]) === String(value))) }).verify(current)
    const map = verified.get(getSectionHistoryRowKey(current[0]))
    const records = current[0].sectionDetail.revisions.map((record, index) => map.has(index) ? map.get(index) : record)
    expect(records).toEqual(f.revision.framework_state.sections.customer_context.revisions)
    for (const row of inserted) expect(new RuntimeStateSection(row).validateSync()).toBeUndefined()
    expect(JSON.stringify({ source: f.source, sourceRow: f.sourceRow, targets: f.targets })).toBe(before)
  })

  test.each(['logicalPath', 'sourceHash', 'stateVersion', 'mappingVersion'])('rejects a model-valid but noncanonical raw source projection %s', async field => {
    const f = historyFixture()
    if (field === 'mappingVersion') delete f.sourceRow.projectionReceipt.mappingVersion
    else f.sourceRow.projectionReceipt[field] = f.sourceRow.projectionReceipt[field].toUpperCase()
    expect(new RuntimeStateSection(f.sourceRow).validateSync()).toBeUndefined()
    await expect(stageRuntimeStateRevisionProvisioning(f.args)).rejects.toMatchObject({ code: RUNTIME_STATE_V2_REVISION_PROVISIONING_ERROR_CODE })
    expect(f.dependencies.RuntimeStateSection.insertMany).not.toHaveBeenCalled()
  })

  test('propagates historical insertion failure to the caller transaction without attempting current inserts', async () => {
    const f = historyFixture(), collision = Object.assign(new Error('Synthetic unique collision'), { code: 11000 })
    f.dependencies.RuntimeStateSection.insertMany.mockRejectedValueOnce(collision)
    await expect(stageRuntimeStateRevisionProvisioning(f.args)).rejects.toBe(collision)
    expect(f.dependencies.RuntimeStateSection.insertMany).toHaveBeenCalledTimes(1)
    expect(f.dependencies.RuntimeEvidenceObject.insertMany).not.toHaveBeenCalled()
  })
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
