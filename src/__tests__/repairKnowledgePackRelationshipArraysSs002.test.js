import crypto from 'node:crypto'

import { describe, expect, jest, test } from '@jest/globals'

import {
  DEFAULT_SS002_MAPPING_PATH,
  loadSs002Mapping,
} from '../scripts/migrateKnowledgePackRelationshipsSs002.js'
import {
  applySs002ArrayRepairPlan,
  assertSs002ArrayRepairEnvironment,
  buildSs002ArrayRepairBackup,
  buildSs002ArrayRepairPlan,
  runSs002ArrayRepair,
  sha256ExactJson,
} from '../scripts/repairKnowledgePackRelationshipArraysSs002.js'

const loadExpanded = () => loadSs002Mapping(DEFAULT_SS002_MAPPING_PATH)
const candidatesFrom = (expanded) => expanded.records.filter((record) => record.legacyRelationships.length === 0)

const createMissingState = (records) => {
  const candidates = records.filter((record) => record.legacyRelationships.length === 0)
  return {
    packs: candidates.map((record, index) => ({
      _id: `pack-${index}`,
      packId: record.packId,
      packType: record.packType,
      packKey: record.packKey,
      status: 'ACTIVE',
      latestVersionId: record.versionId,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
    versions: candidates.map((record, index) => ({
      _id: `version-${index}`,
      versionId: record.versionId,
      packId: record.packId,
      packType: record.packType,
      packKey: record.packKey,
      semanticVersion: record.semanticVersion,
      status: 'ACTIVE',
      scopeType: 'GLOBAL',
      scopeKey: 'GLOBAL',
      contentHash: `sha256:${record.packId}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
    activations: candidates.map((record, index) => ({
      _id: `activation-${index}`,
      activationId: record.activationId,
      versionId: record.versionId,
      packId: record.packId,
      packType: record.packType,
      packKey: record.packKey,
      semanticVersion: record.semanticVersion,
      status: 'ACTIVE',
      scopeType: 'GLOBAL',
      scopeKey: 'GLOBAL',
      contentHash: `sha256:${record.packId}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
    manifestCount: 0,
  }
}

const sha256Text = (value) => crypto.createHash('sha256').update(value).digest('hex').toUpperCase()

const buildApplyHarness = ({ state, auditError = null, transactionStateMutation = null }) => {
  let readCount = 0
  const readState = jest.fn(async () => {
    readCount += 1
    if (readCount === 1 && transactionStateMutation) transactionStateMutation(state)
    return state
  })
  const findRow = (rows, filter) => rows.find((row) => Object.entries(filter).every(([field, expected]) => {
    if (field === 'dependencyReferences') return expected?.$exists === false && !Object.hasOwn(row, field)
    return row[field] === expected
  }))
  const updateModel = (rows) => ({
    updateOne: jest.fn(async (filter, update, options) => {
      expect(options).toMatchObject({ runValidators: true, timestamps: false })
      expect(options.session).toBeDefined()
      const row = findRow(rows, filter)
      if (!row) return { matchedCount: 0, modifiedCount: 0 }
      Object.assign(row, structuredClone(update.$set))
      return { matchedCount: 1, modifiedCount: 1 }
    }),
  })
  const audit = {
    logSystemEvent: auditError
      ? jest.fn(async () => { throw auditError })
      : jest.fn(async () => ({ id: 'audit-1' })),
  }
  const session = {
    withTransaction: jest.fn(async (callback) => {
      const before = structuredClone(state)
      try {
        return await callback()
      } catch (error) {
        Object.assign(state, before)
        throw error
      }
    }),
    endSession: jest.fn(async () => {}),
  }
  return {
    dependencies: {
      readState,
      models: {
        KnowledgePackVersion: updateModel(state.versions),
        KnowledgePackActivation: updateModel(state.activations),
      },
      getDatabaseName: () => 'test',
      nodeEnv: 'development',
      startSession: async () => session,
      governanceAuditService: audit,
    },
    audit,
    session,
  }
}

const buildApprovedInput = async ({ state, expanded }) => {
  const plan = buildSs002ArrayRepairPlan({ records: expanded.records, state })
  const backup = buildSs002ArrayRepairBackup({
    databaseName: 'test',
    expanded,
    plan,
    state,
    now: new Date('2026-08-02T21:00:00.000Z'),
  })
  const backupPayload = `${JSON.stringify(backup, null, 2)}\n`
  return {
    plan,
    backup,
    backupArtifact: { path: 'ss002-array-backup.json', sha256: sha256Text(backupPayload) },
  }
}

describe('SS-002 exact missing relationship array remediation', () => {
  test('plans exactly 28 eligible pairs and 56 field-only writes', async () => {
    const expanded = await loadExpanded()
    const state = createMissingState(expanded.records)
    const plan = buildSs002ArrayRepairPlan({ records: expanded.records, state })

    expect(candidatesFrom(expanded)).toHaveLength(28)
    expect(plan).toMatchObject({
      ok: true,
      mappedCandidates: 28,
      recordsScanned: 84,
      missingBoth: 28,
      converged: 0,
      recordsToUpdate: 56,
      blockers: [],
    })
    expect(plan.updates.every((update) => exactExistsFalse(update.filter.dependencyReferences))).toBe(true)
  })

  test('classifies two empty arrays as converged with zero writes', async () => {
    const expanded = await loadExpanded()
    const state = createMissingState(expanded.records)
    state.versions.forEach((row) => { row.dependencyReferences = [] })
    state.activations.forEach((row) => { row.dependencyReferences = [] })

    expect(buildSs002ArrayRepairPlan({ records: expanded.records, state })).toMatchObject({
      ok: true,
      missingBoth: 0,
      converged: 28,
      recordsToUpdate: 0,
    })
  })

  test('blocks every one-sided or present malformed pair state, including own undefined', async () => {
    const expanded = await loadExpanded()
    const pairMutations = [
      (version) => { version.dependencyReferences = [] },
      (version, activation) => { activation.dependencyReferences = [] },
      (version, activation) => {
        version.dependencyReferences = undefined
        activation.dependencyReferences = undefined
      },
      (version, activation) => {
        version.dependencyReferences = null
        activation.dependencyReferences = null
      },
      (version, activation) => {
        version.dependencyReferences = { unexpected: true }
        activation.dependencyReferences = { unexpected: true }
      },
      (version, activation) => {
        version.dependencyReferences = 'unexpected'
        activation.dependencyReferences = 'unexpected'
      },
      (version, activation) => {
        version.dependencyReferences = 1
        activation.dependencyReferences = 1
      },
      (version, activation) => {
        version.dependencyReferences = false
        activation.dependencyReferences = false
      },
      (version, activation) => {
        version.dependencyReferences = [{ unexpected: true }]
        activation.dependencyReferences = [{ unexpected: true }]
      },
    ]

    for (const mutate of pairMutations) {
      const state = createMissingState(expanded.records)
      mutate(state.versions[0], state.activations[0])
      const plan = buildSs002ArrayRepairPlan({ records: expanded.records, state })
      expect(plan.ok).toBe(false)
      expect(plan.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'SS002_ARRAY_REPAIR_UNEXPECTED_PAIR_STATE' }),
      ]))
    }
  })

  test('blocks multiplicity, manifests, lineage and partial governance state', async () => {
    const expanded = await loadExpanded()
    const cases = [
      (state) => { state.versions.push(structuredClone(state.versions[0])) },
      (state) => { state.activations.push(structuredClone(state.activations[0])) },
      (state) => { state.manifestCount = 1 },
      (state) => { state.packs[0].packType = 'STYLE' },
      (state) => { state.packs[0].packKey = 'wrong' },
      (state) => { state.packs[0].status = 'DRAFT' },
      (state) => { state.packs[0].latestVersionId = 'wrong' },
      (state) => { state.versions[0].packType = 'STYLE' },
      (state) => { state.versions[0].packKey = 'wrong' },
      (state) => { state.versions[0].semanticVersion = '2.0.0' },
      (state) => { state.versions[0].status = 'DRAFT' },
      (state) => { state.versions[0].scopeType = 'TENANT' },
      (state) => { state.versions[0].scopeKey = 'TENANT:QA' },
      (state) => { state.versions[0].contentHash = '' },
      (state) => { state.activations[0].versionId = 'wrong' },
      (state) => { state.activations[0].packType = 'STYLE' },
      (state) => { state.activations[0].packKey = 'wrong' },
      (state) => { state.activations[0].semanticVersion = '2.0.0' },
      (state) => { state.activations[0].status = 'DISABLED' },
      (state) => { state.activations[0].scopeType = 'TENANT' },
      (state) => { state.activations[0].scopeKey = 'TENANT:QA' },
      (state) => { state.activations[0].contentHash = 'sha256:wrong' },
      (state) => { state.packs[0].knowledgeAssetId = 'partial' },
      (state) => { state.versions[0].knowledgeAssetId = 'partial' },
      (state) => { state.activations[0].knowledgeAssetId = 'partial' },
      (state) => { state.versions[0].relationshipContractVersion = 'SS002_RELATIONSHIP_V1' },
      (state) => { state.activations[0].relationshipChecksum = 'abc' },
    ]

    for (const mutate of cases) {
      const state = createMissingState(expanded.records)
      mutate(state)
      expect(buildSs002ArrayRepairPlan({ records: expanded.records, state }).ok).toBe(false)
    }
  })

  test('restricts mutation to the explicit Development QA environment', async () => {
    const expanded = await loadExpanded()
    expect(() => assertSs002ArrayRepairEnvironment({
      databaseName: 'test',
      nodeEnv: 'development',
      mapping: expanded.mapping,
    })).not.toThrow()
    expect(() => assertSs002ArrayRepairEnvironment({
      databaseName: 'production',
      nodeEnv: 'production',
      mapping: expanded.mapping,
    })).toThrow('restricted')
  })

  test('applies in one transaction, changes only the field, audits, and converges', async () => {
    const expanded = await loadExpanded()
    const state = createMissingState(expanded.records)
    const before = structuredClone(state)
    const approved = await buildApprovedInput({ state, expanded })
    const harness = buildApplyHarness({ state })

    const result = await applySs002ArrayRepairPlan({
      ...approved,
      expanded,
      dependencies: harness.dependencies,
    })

    expect(result).toMatchObject({ pairsRepaired: 28, recordsUpdated: 56, secondDryRunMutations: 0 })
    expect(harness.session.withTransaction).toHaveBeenCalledTimes(1)
    expect(harness.session.endSession).toHaveBeenCalledTimes(1)
    expect(harness.audit.logSystemEvent).toHaveBeenCalledWith(
      'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED',
      expect.objectContaining({ frameworkKey: 'SS-002', snapshot: expect.any(Object) }),
      expect.objectContaining({ session: harness.session, throwOnError: true }),
    )
    expect(state.versions.every((row) => Array.isArray(row.dependencyReferences))).toBe(true)
    expect(state.activations.every((row) => Array.isArray(row.dependencyReferences))).toBe(true)
    const stripField = (row) => {
      const copy = structuredClone(row)
      delete copy.dependencyReferences
      return copy
    }
    expect(state.versions.map(stripField)).toEqual(before.versions.map(stripField))
    expect(state.activations.map(stripField)).toEqual(before.activations.map(stripField))
  })

  test('rejects transaction-state drift before writing', async () => {
    const expanded = await loadExpanded()
    const state = createMissingState(expanded.records)
    const approved = await buildApprovedInput({ state, expanded })
    const harness = buildApplyHarness({
      state,
      transactionStateMutation: (current) => { current.versions[0].status = 'DRAFT' },
    })

    await expect(applySs002ArrayRepairPlan({
      ...approved,
      expanded,
      dependencies: harness.dependencies,
    })).rejects.toMatchObject({ code: 'SS002_ARRAY_REPAIR_PLAN_CHANGED' })
    expect(harness.dependencies.models.KnowledgePackVersion.updateOne).not.toHaveBeenCalled()
    expect(harness.dependencies.models.KnowledgePackActivation.updateOne).not.toHaveBeenCalled()
  })

  test('audit failure rolls back every field change', async () => {
    const expanded = await loadExpanded()
    const state = createMissingState(expanded.records)
    const before = structuredClone(state)
    const approved = await buildApprovedInput({ state, expanded })
    const harness = buildApplyHarness({ state, auditError: new Error('audit unavailable') })

    await expect(applySs002ArrayRepairPlan({
      ...approved,
      expanded,
      dependencies: harness.dependencies,
    })).rejects.toThrow('audit unavailable')
    expect(state).toEqual(before)
  })

  test('rejects an unverified backup artifact before starting a transaction', async () => {
    const expanded = await loadExpanded()
    const state = createMissingState(expanded.records)
    const approved = await buildApprovedInput({ state, expanded })
    const harness = buildApplyHarness({ state })

    await expect(applySs002ArrayRepairPlan({
      ...approved,
      backupArtifact: { ...approved.backupArtifact, sha256: '0'.repeat(64) },
      expanded,
      dependencies: harness.dependencies,
    })).rejects.toMatchObject({ code: 'SS002_ARRAY_REPAIR_BACKUP_INVALID' })
    expect(harness.session.withTransaction).not.toHaveBeenCalled()
  })

  test('fails and rolls back on an exact write-count mismatch', async () => {
    const expanded = await loadExpanded()
    const state = createMissingState(expanded.records)
    const before = structuredClone(state)
    const approved = await buildApprovedInput({ state, expanded })
    const harness = buildApplyHarness({ state })
    harness.dependencies.models.KnowledgePackVersion.updateOne
      .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 })

    await expect(applySs002ArrayRepairPlan({
      ...approved,
      expanded,
      dependencies: harness.dependencies,
    })).rejects.toMatchObject({ code: 'SS002_ARRAY_REPAIR_WRITE_COUNT_MISMATCH' })
    expect(state).toEqual(before)
  })

  test('fails and rolls back when an unrelated timestamp changes during readback', async () => {
    const expanded = await loadExpanded()
    const state = createMissingState(expanded.records)
    const before = structuredClone(state)
    const approved = await buildApprovedInput({ state, expanded })
    const harness = buildApplyHarness({ state })
    const originalVersionUpdate = harness.dependencies.models.KnowledgePackVersion.updateOne
    harness.dependencies.models.KnowledgePackVersion.updateOne = jest.fn(async (...args) => {
      const result = await originalVersionUpdate(...args)
      if (result.modifiedCount === 1) state.versions[0].updatedAt = '2026-08-02T21:30:00.000Z'
      return result
    })

    await expect(applySs002ArrayRepairPlan({
      ...approved,
      expanded,
      dependencies: harness.dependencies,
    })).rejects.toMatchObject({ code: 'SS002_ARRAY_REPAIR_READBACK_MISMATCH' })
    expect(state).toEqual(before)
  })

  test('requires explicit confirmation and exact dry-run digests before backup or apply', async () => {
    const expanded = await loadExpanded()
    const state = createMissingState(expanded.records)
    const plan = buildSs002ArrayRepairPlan({ records: expanded.records, state })
    const baseDependencies = {
      readState: async () => state,
      getDatabaseName: () => 'test',
      nodeEnv: 'development',
      connect: jest.fn(async () => {}),
      disconnect: jest.fn(async () => {}),
      writeBackup: jest.fn(async () => { throw new Error('must not write') }),
    }

    await expect(runSs002ArrayRepair({
      args: {
        apply: true,
        confirm: false,
        json: true,
        help: false,
        mappingSha256: expanded.rawSha256,
        planSha256: sha256ExactJson(plan),
      },
      dependencies: baseDependencies,
      logger: jest.fn(),
    })).rejects.toMatchObject({ code: 'SS002_ARRAY_REPAIR_CONFIRMATION_REQUIRED' })

    await expect(runSs002ArrayRepair({
      args: {
        apply: true,
        confirm: true,
        json: true,
        help: false,
        mappingSha256: expanded.rawSha256,
        planSha256: '0'.repeat(64),
      },
      dependencies: baseDependencies,
      logger: jest.fn(),
    })).rejects.toMatchObject({ code: 'SS002_ARRAY_REPAIR_DIGEST_REQUIRED' })
    expect(baseDependencies.writeBackup).not.toHaveBeenCalled()
  })

  test('writes and hashes backup before transaction start in apply mode', async () => {
    const expanded = await loadExpanded()
    const state = createMissingState(expanded.records)
    const plan = buildSs002ArrayRepairPlan({ records: expanded.records, state })
    const order = []
    const harness = buildApplyHarness({ state })
    const originalStartSession = harness.dependencies.startSession
    harness.dependencies.startSession = async () => {
      order.push('transaction')
      return originalStartSession()
    }
    const writeBackup = jest.fn(async ({ backup }) => {
      order.push('backup')
      return {
        path: 'ss002-array-backup.json',
        sha256: sha256Text(`${JSON.stringify(backup, null, 2)}\n`),
      }
    })

    const report = await runSs002ArrayRepair({
      args: {
        apply: true,
        confirm: true,
        json: true,
        help: false,
        mappingSha256: expanded.rawSha256,
        planSha256: sha256ExactJson(plan),
      },
      dependencies: {
        ...harness.dependencies,
        connect: jest.fn(async () => {}),
        disconnect: jest.fn(async () => {}),
        writeBackup,
      },
      logger: jest.fn(),
      now: new Date('2026-08-02T21:00:00.000Z'),
    })

    expect(order).toEqual(['backup', 'transaction'])
    expect(writeBackup).toHaveBeenCalledTimes(1)
    expect(report.result).toMatchObject({ recordsUpdated: 56 })
  })
})

function exactExistsFalse(value) {
  return value?.$exists === false && Object.keys(value).length === 1
}
