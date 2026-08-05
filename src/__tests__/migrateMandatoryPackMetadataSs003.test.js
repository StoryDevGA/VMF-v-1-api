import crypto from 'node:crypto'
import { jest } from '@jest/globals'

import {
  applySs003MigrationPlan,
  assertConvergedSs003Plan,
  assertInitialSs003Plan,
  assertSs003WriteEnvironment,
  buildSs003Backup,
  buildSs003MigrationPlan,
  runSs003RollbackProbe,
  runSs003Migration,
  sha256Json,
  validateSs003Mapping,
} from '../scripts/migrateMandatoryPackMetadataSs003.js'

const EMPTY_CHECKSUM = crypto.createHash('sha256').update('[]').digest('hex')
const baseRows = [
  ['ARL', 'adaptive-reasoning-layer', '45e7863824e8abaa4530cfee27f91613d14415be537d463037e9cfe181016953'],
  ['OUTPUT_SCHEMA', 'output-schemas-pack', '6d1c422889a47f682f1b164ab9fa46c330c44b9b027cf523c1792bd8422a75a5'],
  ['OUTPUT_TYPE_DEFINITION', 'outcome-output-types', '5d33a6c6034c8219b3a68197789a86f588e109b93c6a895d5c9b666f935fe10b'],
  ['RL', 'rendering-layer', 'cb7f3f55c9ef1e5d4013dec1add125adb3ef876518a257c4f16a3848a8812ceb'],
]
const segment = (value) => value.toLowerCase().replace(/_/g, '-')
const assetId = (type, key) => `QA-SS003-${type}-${key}`.replace(/[^a-z0-9]+/gi, '-').toUpperCase()
const mappingInput = () => ({
  schemaVersion: '1.0.0',
  policyVersion: 'SS-003-PARLON-METADATA-QA-V1',
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: EMPTY_CHECKSUM,
  authority: 'USER_AUTHORIZED_QA_FIXTURE_AND_SOURCE_BACKED_PACK_IDENTITY',
  environmentGuard: { allowedNodeEnvs: ['development', 'test'], allowedDatabaseNames: ['test'] },
  expectedSemanticVersion: '1.0.0',
  expectedScopeKey: 'GLOBAL',
  packs: baseRows.map(([packType, packKey, hash]) => ({
    packType,
    packKey,
    packId: `kp-${segment(packType)}-${packKey}`,
    versionId: `kpv-${segment(packType)}-${packKey}-1-0-0-global`,
    activationId: `kpa-${segment(packType)}-${packKey}-kpv-${segment(packType)}-${packKey}-1-0-0-global-global`,
    knowledgeAssetId: assetId(packType, packKey),
    expectedContentHash: `sha256:${hash}`,
  })),
})
const expanded = () => {
  const mapping = validateSs003Mapping(mappingInput())
  return {
    mapping,
    rawSha256: 'A'.repeat(64),
    records: mapping.packs.map((row) => ({
      key: `${row.packType}:${row.packKey}`,
      ...row,
      semanticVersion: '1.0.0',
      scopeKey: 'GLOBAL',
      relationships: [],
      legacyRelationships: [],
      legacyRelationshipChecksum: '',
      relationshipChecksum: EMPTY_CHECKSUM,
    })),
  }
}
const legacyState = (definition = expanded()) => ({
  packs: definition.records.map((row) => ({
    packId: row.packId,
    packType: row.packType,
    packKey: row.packKey,
    status: 'ACTIVE',
    latestVersionId: row.versionId,
  })),
  versions: definition.records.map((row) => ({
    versionId: row.versionId,
    packId: row.packId,
    packType: row.packType,
    packKey: row.packKey,
    semanticVersion: row.semanticVersion,
    status: 'ACTIVE',
    scopeType: 'GLOBAL',
    scopeKey: 'GLOBAL',
    dependencyReferences: null,
    contentHash: row.expectedContentHash,
  })),
  activations: definition.records.map((row) => ({
    activationId: row.activationId,
    versionId: row.versionId,
    packId: row.packId,
    packType: row.packType,
    packKey: row.packKey,
    semanticVersion: row.semanticVersion,
    status: 'ACTIVE',
    scopeType: 'GLOBAL',
    scopeKey: 'GLOBAL',
    dependencyReferences: null,
    contentHash: row.expectedContentHash,
  })),
  manifestCount: 0,
})
const applyUpdates = (state, plan) => {
  const result = structuredClone(state)
  for (const update of plan.updates) {
    const rows = update.collectionKey === 'KnowledgePack'
      ? result.packs
      : update.collectionKey === 'KnowledgePackVersion'
        ? result.versions
        : result.activations
    const row = rows.find((candidate) => candidate[update.idField] === update.recordId)
    Object.assign(row, structuredClone(update.set))
  }
  return result
}
const queryModel = (states, stateKey, idField) => {
  let readIndex = 0
  return {
    find: jest.fn(() => ({
      lean: jest.fn(async () => structuredClone(states[Math.min(readIndex++, states.length - 1)][stateKey])),
    })),
    updateOne: jest.fn(async (filter, update) => {
      const live = states[states.length - 1][stateKey]
      const row = live.find((candidate) => candidate[idField] === filter[idField])
      if (!row) return { matchedCount: 0, modifiedCount: 0 }
      Object.assign(row, structuredClone(update.$set))
      return { matchedCount: 1, modifiedCount: 1 }
    }),
  }
}
const buildModels = (states) => ({
  KnowledgePack: queryModel(states, 'packs', 'packId'),
  KnowledgePackVersion: queryModel(states, 'versions', 'versionId'),
  KnowledgePackActivation: queryModel(states, 'activations', 'activationId'),
  KnowledgePackManifest: { countDocuments: jest.fn().mockResolvedValue(0) },
})
const session = () => ({
  withTransaction: jest.fn(async (callback) => callback()),
  endSession: jest.fn().mockResolvedValue(undefined),
})
const rollbackSession = (state) => ({
  withTransaction: jest.fn(async (callback) => {
    const snapshot = structuredClone(state)
    try {
      return await callback()
    } catch (error) {
      state.packs.splice(0, state.packs.length, ...snapshot.packs)
      state.versions.splice(0, state.versions.length, ...snapshot.versions)
      state.activations.splice(0, state.activations.length, ...snapshot.activations)
      throw error
    }
  }),
  endSession: jest.fn().mockResolvedValue(undefined),
})

describe('SS-003 mandatory pack metadata migration', () => {
  test('accepts only the exact four-row QA allowlist', () => {
    expect(validateSs003Mapping(mappingInput()).packs).toHaveLength(4)
    const changed = mappingInput()
    changed.packs[0].knowledgeAssetId = 'QA-DIFFERENT'
    expect(() => validateSs003Mapping(changed)).toThrow('exact four approved pack identities')
  })

  test('builds the exact 4-pack, 12-record, 12-update initial plan', () => {
    const definition = expanded()
    const plan = buildSs003MigrationPlan({ records: definition.records, state: legacyState(definition) })
    expect(plan).toEqual(expect.objectContaining({
      ok: true,
      mappedPacks: 4,
      legacyPacks: 4,
      convergedPacks: 0,
      recordsScanned: 12,
      recordsToUpdate: 12,
    }))
    expect(() => assertInitialSs003Plan(plan)).not.toThrow()
  })

  test('blocks partial plans, identity collisions, and protected content drift', () => {
    const definition = expanded()
    const state = legacyState(definition)
    state.packs[0].knowledgeAssetId = definition.records[0].knowledgeAssetId
    state.packs.push({
      packId: 'different-pack',
      knowledgeAssetId: definition.records[1].knowledgeAssetId,
    })
    state.versions[2].contentHash = 'sha256:changed'
    state.activations[2].contentHash = 'sha256:changed'
    const plan = buildSs003MigrationPlan({ records: definition.records, state })
    expect(plan.ok).toBe(false)
    expect(plan.blockers.map((row) => row.code)).toEqual(expect.arrayContaining([
      'SS003_METADATA_PARTIAL_OR_UNEXPECTED_STATE',
      'SS003_METADATA_IDENTITY_COLLISION',
      'SS003_METADATA_SOURCE_HASH_MISMATCH',
    ]))
    expect(() => assertInitialSs003Plan({ ...plan, ok: true, blockers: [], recordsToUpdate: 9 })).toThrow('exactly four legacy packs')
  })

  test('blocks writes outside Development test', () => {
    const definition = expanded()
    expect(() => assertSs003WriteEnvironment({
      databaseName: 'production',
      nodeEnv: 'production',
      mapping: definition.mapping,
    })).toThrow('restricted to the explicit Development QA environment')
  })

  test('rejects missing confirmation and either incorrect apply digest before writes', async () => {
    const definition = expanded()
    const buildDependencies = () => {
      const models = buildModels([legacyState(definition)])
      return {
        models,
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        getDatabaseName: () => 'test',
        nodeEnv: 'test',
      }
    }
    const run = (args, dependencies) => runSs003Migration({
      args: { rollbackProbe: false, json: true, ...args },
      dependencies,
      logger: jest.fn(),
    })

    const noConfirmation = buildDependencies()
    await expect(run({ apply: true, confirm: false }, noConfirmation))
      .rejects.toMatchObject({ code: 'SS003_CONFIRMATION_REQUIRED' })
    Object.values(noConfirmation.models).forEach((model) => {
      if (model.updateOne) expect(model.updateOne).not.toHaveBeenCalled()
    })

    const wrongMapping = buildDependencies()
    await expect(run({
      apply: true,
      confirm: true,
      mappingSha256: '0'.repeat(64),
      planSha256: '0'.repeat(64),
    }, wrongMapping)).rejects.toMatchObject({ code: 'SS003_DIGEST_REQUIRED' })
    Object.values(wrongMapping.models).forEach((model) => {
      if (model.updateOne) expect(model.updateOne).not.toHaveBeenCalled()
    })

    const wrongPlan = buildDependencies()
    await expect(run({
      apply: true,
      confirm: true,
      mappingSha256: '83094C6977F119C6B086D2C5A1EB8D2CFF31C0C5FA91D141E53ECEA3D3EBEC01',
      planSha256: '0'.repeat(64),
    }, wrongPlan)).rejects.toMatchObject({ code: 'SS003_DIGEST_REQUIRED' })
    Object.values(wrongPlan.models).forEach((model) => {
      if (model.updateOne) expect(model.updateOne).not.toHaveBeenCalled()
    })
  })

  test.each([
    ['wrong exact ID', (state) => { state.versions[0].versionId = 'wrong-version-id' }, 'SS003_METADATA_RECORD_SET_MISMATCH'],
    ['missing record', (state) => { state.activations.pop() }, 'SS003_METADATA_RECORD_SET_MISMATCH'],
    ['duplicate record', (state) => { state.versions.push(structuredClone(state.versions[0])) }, 'SS003_METADATA_RECORD_SET_MISMATCH'],
    ['extra record', (state) => {
      state.activations.push({ ...structuredClone(state.activations[0]), activationId: 'extra-activation', status: 'INACTIVE' })
    }, 'SS003_METADATA_RECORD_SET_MISMATCH'],
    ['inactive target', (state) => { state.activations[0].status = 'INACTIVE' }, 'SS003_METADATA_LINEAGE_MISMATCH'],
  ])('blocks %s', (_label, mutate, expectedCode) => {
    const definition = expanded()
    const state = legacyState(definition)
    mutate(state)
    const plan = buildSs003MigrationPlan({ records: definition.records, state })
    expect(plan.ok).toBe(false)
    expect(plan.blockers.map((row) => row.code)).toContain(expectedCode)
  })

  test('blocks non-empty and malformed legacy relationship state', () => {
    const definition = expanded()
    const nonEmpty = legacyState(definition)
    const legacyRelationship = {
      knowledgeLayer: 'OUTPUT_SCHEMA',
      requirement: 'REQUIRED',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'executive-brief-schema',
    }
    nonEmpty.versions[0].dependencyReferences = [legacyRelationship]
    nonEmpty.activations[0].dependencyReferences = [legacyRelationship]
    expect(buildSs003MigrationPlan({ records: definition.records, state: nonEmpty }).blockers
      .map((row) => row.code)).toContain('SS003_METADATA_PARTIAL_OR_UNEXPECTED_STATE')

    const malformed = legacyState(definition)
    malformed.versions[0].dependencyReferences = 'not-an-array'
    expect(buildSs003MigrationPlan({ records: definition.records, state: malformed }).blockers
      .map((row) => row.code)).toContain('SS003_METADATA_UNEXPECTED_LEGACY_SHAPE')
  })

  test('limits updates to the exact governance fields', () => {
    const definition = expanded()
    const plan = buildSs003MigrationPlan({ records: definition.records, state: legacyState(definition) })
    const expectedByCollection = {
      KnowledgePack: ['knowledgeAssetId'],
      KnowledgePackVersion: [
        'dependencyReferences',
        'knowledgeAssetId',
        'relationshipChecksum',
        'relationshipContractVersion',
      ],
      KnowledgePackActivation: [
        'dependencyReferences',
        'knowledgeAssetId',
        'relationshipChecksum',
        'relationshipContractVersion',
      ],
    }
    expect(plan.updates).toHaveLength(12)
    plan.updates.forEach((update) => {
      expect(Object.keys(update.set).sort()).toEqual(expectedByCollection[update.collectionKey])
    })
  })

  test('separates the exact initial plan from converged idempotence evidence', () => {
    const definition = expanded()
    const initialState = legacyState(definition)
    const initialPlan = buildSs003MigrationPlan({ records: definition.records, state: initialState })
    const convergedState = applyUpdates(initialState, initialPlan)
    const convergedPlan = buildSs003MigrationPlan({ records: definition.records, state: convergedState })

    expect(convergedPlan).toEqual(expect.objectContaining({
      ok: true,
      mappedPacks: 4,
      legacyPacks: 0,
      convergedPacks: 4,
      recordsScanned: 12,
      recordsToUpdate: 0,
    }))
    expect(() => assertInitialSs003Plan(initialPlan)).not.toThrow()
    expect(() => assertConvergedSs003Plan(convergedPlan)).not.toThrow()
    expect(() => assertInitialSs003Plan(convergedPlan)).toThrow('exactly four legacy packs')
    expect(() => assertConvergedSs003Plan(initialPlan)).toThrow('zero-mutation four-pack state')
  })

  test('applies exactly twelve writes and persists the registered audit in one transaction', async () => {
    const definition = expanded()
    const before = legacyState(definition)
    const plan = buildSs003MigrationPlan({ records: definition.records, state: before })
    const after = applyUpdates(before, plan)
    const models = buildModels([before, after])
    const governanceAuditService = { logSystemEvent: jest.fn().mockResolvedValue({ id: 'audit-1' }) }
    const tx = session()
    const backup = buildSs003Backup({
      databaseName: 'test',
      mappingSha256: definition.rawSha256,
      plan,
      state: before,
      now: new Date('2026-08-03T07:00:00.000Z'),
    })
    const result = await applySs003MigrationPlan({
      expanded: definition,
      mappingSha256: definition.rawSha256,
      plan,
      planSha256: sha256Json(plan),
      backupArtifact: { path: 'C:\\qa\\backup.json', sha256: 'B'.repeat(64) },
      dependencies: {
        models,
        getDatabaseName: () => 'test',
        governanceAuditService,
        nodeEnv: 'test',
        startSession: async () => tx,
      },
    })
    expect(backup.records).toHaveLength(4)
    expect(result).toEqual(expect.objectContaining({ recordsUpdated: 12, packsMigrated: 4, secondDryRunMutations: 0 }))
    expect(governanceAuditService.logSystemEvent).toHaveBeenCalledWith(
      'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED',
      expect.objectContaining({ snapshot: expect.objectContaining({ operation: 'KNOWLEDGE_PACK_METADATA_SS003_MIGRATION' }) }),
      { session: tx, throwOnError: true },
    )
  })

  test('rollback probe requires the forced failure and exact no-change/no-audit readback', async () => {
    const definition = expanded()
    const before = legacyState(definition)
    const plan = buildSs003MigrationPlan({ records: definition.records, state: before })
    const models = buildModels([before])
    const tx = rollbackSession(before)
    const result = await runSs003RollbackProbe({
      expanded: definition,
      mappingSha256: definition.rawSha256,
      plan,
      planSha256: sha256Json(plan),
      backupArtifact: { path: 'C:\\qa\\backup.json', sha256: 'B'.repeat(64) },
      dependencies: {
        models,
        getDatabaseName: () => 'test',
        nodeEnv: 'test',
        startSession: async () => tx,
        countAudits: jest.fn().mockResolvedValue(0),
      },
    })
    expect(result).toEqual(expect.objectContaining({
      pass: true,
      failureCode: 'SS003_FORCED_AUDIT_FAILURE',
      beforeAuditCount: 0,
      afterAuditCount: 0,
    }))
    expect(result.beforeDigest).toBe(result.afterDigest)
  })
})
