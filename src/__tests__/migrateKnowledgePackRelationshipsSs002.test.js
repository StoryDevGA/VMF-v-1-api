import fs from 'node:fs/promises'

import { describe, expect, jest, test } from '@jest/globals'

import {
  DEFAULT_SS002_MAPPING_PATH,
  SS002_RELATIONSHIP_MIGRATION_AUDIT_EVENT_KEY,
  applySs002MigrationPlan,
  assertSs002WriteEnvironment,
  buildSs002MigrationAuditPayload,
  buildSs002MigrationPlan,
  expandSs002Mapping,
  runSs002Migration,
  sha256Json,
} from '../scripts/migrateKnowledgePackRelationshipsSs002.js'
import { buildGovernanceAuditPayload } from '../services/governanceAudit/governanceAuditService.js'
import { getGovernanceAuditEvent } from '../services/governanceAudit/governanceAuditEvents.js'

const loadFixture = async () => JSON.parse(await fs.readFile(DEFAULT_SS002_MAPPING_PATH, 'utf8'))

const createLegacyState = (records) => ({
  packs: records.map((record) => ({
    packId: record.packId,
    packType: record.packType,
    packKey: record.packKey,
    status: 'ACTIVE',
    latestVersionId: record.versionId,
  })),
  versions: records.map((record) => ({
    versionId: record.versionId,
    packId: record.packId,
    packType: record.packType,
    packKey: record.packKey,
    semanticVersion: record.semanticVersion,
    status: 'ACTIVE',
    scopeType: 'GLOBAL',
    scopeKey: record.scopeKey,
    contentHash: `sha256:${record.packId}`,
    dependencyReferences: structuredClone(record.legacyRelationships),
  })),
  activations: records.map((record) => ({
    activationId: record.activationId,
    versionId: record.versionId,
    packId: record.packId,
    packType: record.packType,
    packKey: record.packKey,
    semanticVersion: record.semanticVersion,
    scopeType: 'GLOBAL',
    scopeKey: record.scopeKey,
    status: 'ACTIVE',
    contentHash: `sha256:${record.packId}`,
    dependencyReferences: structuredClone(record.legacyRelationships),
  })),
  manifestCount: 0,
})

const convergeState = ({ records, state }) => {
  records.forEach((record) => {
    Object.assign(state.packs.find((row) => row.packId === record.packId), {
      knowledgeAssetId: record.knowledgeAssetId,
    })
    const fields = {
      knowledgeAssetId: record.knowledgeAssetId,
      relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
      relationshipChecksum: record.relationshipChecksum,
      dependencyReferences: structuredClone(record.relationships),
    }
    Object.assign(state.versions.find((row) => row.versionId === record.versionId), fields)
    Object.assign(state.activations.find((row) => row.activationId === record.activationId), fields)
  })
  return state
}

const replaceArray = (target, source) => {
  target.splice(0, target.length, ...structuredClone(source))
}

const buildDependencies = ({ state, auditError = null }) => {
  const updateModel = (rows, idField) => ({
    find: () => ({ lean: async () => rows }),
    updateOne: jest.fn(async (filter, update, options) => {
      expect(options).toMatchObject({ runValidators: true })
      expect(options.session).toBeDefined()
      const row = rows.find((entry) => entry[idField] === filter[idField])
      if (!row) return { modifiedCount: 0 }
      Object.assign(row, structuredClone(update.$set))
      return { modifiedCount: 1 }
    }),
  })
  const audit = {
    logSystemEvent: auditError
      ? jest.fn(async () => { throw auditError })
      : jest.fn(async () => ({})),
  }
  const session = {
    withTransaction: jest.fn(async (callback) => {
      const before = structuredClone(state)
      try {
        return await callback()
      } catch (error) {
        replaceArray(state.packs, before.packs)
        replaceArray(state.versions, before.versions)
        replaceArray(state.activations, before.activations)
        throw error
      }
    }),
    endSession: jest.fn(async () => {}),
  }
  return {
    dependencies: {
      models: {
        KnowledgePack: updateModel(state.packs, 'packId'),
        KnowledgePackVersion: updateModel(state.versions, 'versionId'),
        KnowledgePackActivation: updateModel(state.activations, 'activationId'),
        KnowledgePackManifest: { countDocuments: jest.fn(async () => state.manifestCount) },
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

describe('SS-002 guarded Knowledge Pack relationship migration', () => {
  test('expands the explicit QA fixture into 41 distinct mapped packs', async () => {
    const expanded = expandSs002Mapping(await loadFixture())
    expect(expanded.records).toHaveLength(41)
    expect(new Set(expanded.records.map((row) => row.knowledgeAssetId)).size).toBe(41)
    expect(expanded.records.every((row) => row.knowledgeAssetId.startsWith('QA-SS002-'))).toBe(true)
    expect(expanded.records.find((row) => row.key === 'OUTPUT_TYPE_DEFINITION:executive-brief'))
      .toMatchObject({
        knowledgeAssetId: 'QA-SS002-OUTPUT-TYPE-EXECUTIVE-BRIEF',
        legacyRelationships: expect.arrayContaining([
          expect.objectContaining({ packKey: 'executive-brief-schema' }),
          expect.objectContaining({ capabilityKey: 'executive-brief-style' }),
        ]),
      })
  })

  test('plans 123 exact record updates and converges to a zero-change rerun', async () => {
    const expanded = expandSs002Mapping(await loadFixture())
    const state = createLegacyState(expanded.records)
    const plan = buildSs002MigrationPlan({ records: expanded.records, state })
    expect(plan).toMatchObject({
      ok: true,
      mappedPacks: 41,
      legacyPacks: 41,
      convergedPacks: 0,
      recordsToUpdate: 123,
      blockers: [],
    })
    expect(plan.recordEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        legacyRelationshipChecksum: expect.stringMatching(/^[A-F0-9]{64}$/),
        relationshipChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]))
    const originalContentDigest = plan.contentHashDigest
    convergeState({ records: expanded.records, state })
    const rerun = buildSs002MigrationPlan({ records: expanded.records, state })
    expect(rerun).toMatchObject({
      ok: true,
      legacyPacks: 0,
      convergedPacks: 41,
      recordsToUpdate: 0,
    })
    expect(rerun.contentHashDigest).toBe(originalContentDigest)
  })

  test('fails closed on partial state, identity collisions, manifests and lineage mismatch', async () => {
    const expanded = expandSs002Mapping(await loadFixture())
    const state = createLegacyState(expanded.records)
    state.packs[0].knowledgeAssetId = expanded.records[0].knowledgeAssetId
    state.packs.push({
      packId: 'foreign-pack',
      knowledgeAssetId: expanded.records[1].knowledgeAssetId,
    })
    state.versions[2].contentHash = 'sha256:changed'
    state.manifestCount = 1
    const plan = buildSs002MigrationPlan({ records: expanded.records, state })
    expect(plan.ok).toBe(false)
    expect(plan.blockers.map((row) => row.code)).toEqual(expect.arrayContaining([
      'SS002_MIGRATION_MANIFESTS_PRESENT',
      'SS002_MIGRATION_PARTIAL_OR_UNEXPECTED_STATE',
      'SS002_MIGRATION_IDENTITY_COLLISION',
      'SS002_MIGRATION_LINEAGE_MISMATCH',
    ]))
  })

  test('fails closed on unknown legacy fields and extra mapped-pack snapshots', async () => {
    const expanded = expandSs002Mapping(await loadFixture())
    const state = createLegacyState(expanded.records)
    state.versions[0].dependencyReferences[0] = {
      ...state.versions[0].dependencyReferences[0],
      relationshipType: 'REQUIRED_AT_RUNTIME',
    }
    state.activations.push({
      ...structuredClone(state.activations[1]),
      activationId: 'unexpected-historical-activation',
      status: 'ROLLED_BACK',
    })

    const plan = buildSs002MigrationPlan({ records: expanded.records, state })

    expect(plan.ok).toBe(false)
    expect(plan.blockers.map((row) => row.code)).toEqual(expect.arrayContaining([
      'SS002_MIGRATION_UNEXPECTED_LEGACY_SHAPE',
      'SS002_MIGRATION_RECORD_SET_MISMATCH',
    ]))
  })

  test('fails closed on every non-array mapped version and activation relationship shape', async () => {
    const expanded = expandSs002Mapping(await loadFixture())
    const malformedShapes = [
      { label: 'missing', set: (row) => { delete row.dependencyReferences } },
      { label: 'undefined', set: (row) => { row.dependencyReferences = undefined } },
      { label: 'null', set: (row) => { row.dependencyReferences = null } },
      { label: 'object', set: (row) => { row.dependencyReferences = { unexpected: true } } },
      { label: 'scalar', set: (row) => { row.dependencyReferences = 'unexpected' } },
    ]

    for (const stateKind of ['legacy', 'canonical']) {
      for (const collectionKey of ['versions', 'activations']) {
        for (const malformed of malformedShapes) {
          const state = createLegacyState(expanded.records)
          if (stateKind === 'canonical') convergeState({ records: expanded.records, state })
          malformed.set(state[collectionKey][0])

          const plan = buildSs002MigrationPlan({ records: expanded.records, state })

          expect(plan.ok).toBe(false)
          expect(plan.blockers).toEqual(expect.arrayContaining([
            expect.objectContaining({
              code: 'SS002_MIGRATION_UNEXPECTED_LEGACY_SHAPE',
              key: expanded.records[0].key,
            }),
          ]))
        }
      }
    }
  })

  test('accepts valid empty relationship arrays in legacy and canonical mapped snapshots', async () => {
    const expanded = expandSs002Mapping(await loadFixture())
    const legacyEmptyIndex = expanded.records.findIndex((row) => row.legacyRelationships.length === 0)
    const canonicalEmptyIndex = expanded.records.findIndex((row) => row.relationships.length === 0)
    expect(legacyEmptyIndex).toBeGreaterThanOrEqual(0)
    expect(canonicalEmptyIndex).toBeGreaterThanOrEqual(0)

    const legacyState = createLegacyState(expanded.records)
    legacyState.versions[legacyEmptyIndex].dependencyReferences = []
    legacyState.activations[legacyEmptyIndex].dependencyReferences = []
    expect(buildSs002MigrationPlan({ records: expanded.records, state: legacyState }).ok).toBe(true)

    const canonicalState = convergeState({
      records: expanded.records,
      state: createLegacyState(expanded.records),
    })
    canonicalState.versions[canonicalEmptyIndex].dependencyReferences = []
    canonicalState.activations[canonicalEmptyIndex].dependencyReferences = []
    expect(buildSs002MigrationPlan({ records: expanded.records, state: canonicalState })).toMatchObject({
      ok: true,
      recordsToUpdate: 0,
    })
  })

  test('restricts writes to the explicit Development QA environment', async () => {
    const expanded = expandSs002Mapping(await loadFixture())
    expect(() => assertSs002WriteEnvironment({
      databaseName: 'test',
      nodeEnv: 'development',
      mapping: expanded.mapping,
    })).not.toThrow()
    expect(() => assertSs002WriteEnvironment({
      databaseName: 'production',
      nodeEnv: 'production',
      mapping: expanded.mapping,
    })).toThrow('restricted')
  })

  test('applies through one transaction, preserves content hashes and writes strict audit evidence', async () => {
    const expanded = expandSs002Mapping(await loadFixture())
    const state = createLegacyState(expanded.records)
    const plan = buildSs002MigrationPlan({ records: expanded.records, state })
    const harness = buildDependencies({ state })
    const result = await applySs002MigrationPlan({
      expanded,
      mappingSha256: 'A'.repeat(64),
      plan,
      planSha256: sha256Json(plan),
      backupArtifact: { path: 'backup.json', sha256: 'B'.repeat(64) },
      dependencies: harness.dependencies,
    })
    expect(result).toMatchObject({
      recordsUpdated: 123,
      packsMigrated: 41,
      secondDryRunMutations: 0,
      contentHashDigest: plan.contentHashDigest,
    })
    expect(harness.session.withTransaction).toHaveBeenCalledTimes(1)
    expect(harness.audit.logSystemEvent).toHaveBeenCalledWith(
      SS002_RELATIONSHIP_MIGRATION_AUDIT_EVENT_KEY,
      expect.any(Object),
      expect.objectContaining({ session: harness.session, throwOnError: true }),
    )
    expect(harness.session.endSession).toHaveBeenCalledTimes(1)
  })

  test('builds the migration payload through the registered Knowledge Pack governance event', async () => {
    expect(getGovernanceAuditEvent(SS002_RELATIONSHIP_MIGRATION_AUDIT_EVENT_KEY)).toMatchObject({
      eventKey: 'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED',
      action: 'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED',
      resourceType: 'KnowledgePack',
      requiresSnapshot: true,
      requiresChecksum: true,
      isActive: true,
    })

    const expanded = expandSs002Mapping(await loadFixture())
    const plan = buildSs002MigrationPlan({
      records: expanded.records,
      state: createLegacyState(expanded.records),
    })
    const payload = buildSs002MigrationAuditPayload({
      mapping: expanded.mapping,
      mappingSha256: 'A'.repeat(64),
      plan,
      planSha256: sha256Json(plan),
      backupArtifact: { path: 'backup.json', sha256: 'B'.repeat(64) },
      result: {
        recordsUpdated: plan.recordsToUpdate,
        packsMigrated: plan.legacyPacks,
        contentHashDigest: plan.contentHashDigest,
        secondDryRunMutations: 0,
      },
    })

    const governancePayload = buildGovernanceAuditPayload(
      SS002_RELATIONSHIP_MIGRATION_AUDIT_EVENT_KEY,
      payload,
    )

    expect(governancePayload).toMatchObject({
      action: 'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED',
      systemEventType: 'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED',
      resourceType: 'KnowledgePack',
      snapshot: expect.objectContaining({
        operation: 'KNOWLEDGE_PACK_RELATIONSHIP_SS002_MIGRATION',
      }),
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(() => buildGovernanceAuditPayload(
      SS002_RELATIONSHIP_MIGRATION_AUDIT_EVENT_KEY,
      { ...payload, snapshot: {} },
    )).toThrow('snapshot')
  })

  test('lets audit persistence failure abort and roll back the transaction', async () => {
    const expanded = expandSs002Mapping(await loadFixture())
    const state = createLegacyState(expanded.records)
    const originalState = structuredClone(state)
    const plan = buildSs002MigrationPlan({ records: expanded.records, state })
    const harness = buildDependencies({ state, auditError: new Error('audit unavailable') })
    await expect(applySs002MigrationPlan({
      expanded,
      mappingSha256: 'A'.repeat(64),
      plan,
      planSha256: sha256Json(plan),
      backupArtifact: { path: 'backup.json', sha256: 'B'.repeat(64) },
      dependencies: harness.dependencies,
    })).rejects.toThrow('audit unavailable')
    expect(state).toEqual(originalState)
    expect(harness.session.endSession).toHaveBeenCalledTimes(1)
  })

  test('opens the standalone migration connection with automatic indexes disabled', async () => {
    const expanded = expandSs002Mapping(await loadFixture())
    const state = createLegacyState(expanded.records)
    const harness = buildDependencies({ state })
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})

    const report = await runSs002Migration({
      args: {
        apply: false,
        confirm: false,
        help: false,
        json: true,
        mappingSha256: '',
        planSha256: '',
      },
      dependencies: {
        ...harness.dependencies,
        connect,
        disconnect,
      },
      logger: jest.fn(),
    })

    expect(connect).toHaveBeenCalledWith({ autoIndex: false })
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(report).toMatchObject({ ok: true, mode: 'dry-run' })
  })
})
