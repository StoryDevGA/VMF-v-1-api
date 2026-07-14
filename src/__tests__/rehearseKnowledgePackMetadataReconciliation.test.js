import { jest } from '@jest/globals'
import {
  applyDevRehearsalPlan,
  assertDevWriteEnvironment,
  buildDevBackup,
  buildDevRehearsalPlan,
  computeBackupArtifactSha256,
  computeAffectedStateDigest,
  loadDevPolicy,
  parseDevRehearsalArgs,
  rollbackDevRehearsal,
  validateBackup,
} from '../scripts/rehearseKnowledgePackMetadataReconciliation.js'
import {
  computeCorrectionRowsSha256,
  loadCorrectionManifest,
} from '../scripts/reconcileKnowledgePackMetadata.js'
import auditService from '../services/auditService.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
const makeBackupArtifact = (backup) => ({
  path: 'backup.json',
  sha256: computeBackupArtifactSha256(backup),
})

const resolveInitialValue = (pack, field, fallback) =>
  pack.corrections.find((correction) => correction.field === field)?.from || fallback

const resolvePackType = (pack) => {
  const correctedFrom = pack.corrections.find((correction) => correction.field === 'packType')?.from
  if (correctedFrom) return correctedFrom
  if (pack.packId.startsWith('kp-truth-certification-')) return 'TRUTH_CERTIFICATION'
  if (pack.packId.startsWith('kp-output-schema-')) return 'OUTPUT_SCHEMA'
  if (pack.packId.startsWith('kp-system-reference-')) return 'SYSTEM_REFERENCE'
  if (pack.packId.startsWith('kp-arl-')) return 'ARL'
  if (pack.packId.startsWith('kp-rl-')) return 'RL'
  if (pack.packId.startsWith('kp-err-')) return 'ERR'
  if (pack.packId.startsWith('kp-rgs-')) return 'RGS'
  if (pack.packId.startsWith('kp-cdrm-')) return 'CDRM'
  return 'SYSTEM'
}

const makeState = ({ manifest, policy }) => {
  const survivorByLegacy = new Map(
    policy.duplicateSurvivors.map((pair) => [pair.legacyPackId, pair.survivorPackId]),
  )
  const legacyBySurvivor = new Map(
    policy.duplicateSurvivors.map((pair) => [pair.survivorPackId, pair.legacyPackId]),
  )
  const contentKeyByPackId = new Map()
  manifest.packs.forEach((pack) => {
    const counterpartId = survivorByLegacy.get(pack.packId) || legacyBySurvivor.get(pack.packId)
    contentKeyByPackId.set(pack.packId, counterpartId ? pack.packKey : pack.packId)
  })

  const state = {
    KnowledgePack: [],
    KnowledgePackVersion: [],
    KnowledgePackActivation: [],
    KnowledgePackManifest: [],
  }
  manifest.packs.forEach((pack, index) => {
    const packType = resolvePackType(pack)
    const packCategory = resolveInitialValue(pack, 'packCategory', 'OUTCOME')
    const purposeCategory = resolveInitialValue(pack, 'purposeCategory', 'SYSTEM')
    const executionMode = resolveInitialValue(pack, 'executionMode', 'PROVIDER_CONTEXT')
    const versionId = `version-${pack.packId}`
    const contentKey = contentKeyByPackId.get(pack.packId)
    const contentHash = `sha256:${contentKey}`
    const sourceFilename = `${pack.packKey}.md`
    const sourceHash = `sha256:source-${contentKey}`
    const common = {
      packId: pack.packId,
      packKey: pack.packKey,
      packType,
      packCategory,
      purposeCategory,
      executionMode,
    }
    state.KnowledgePack.push({
      _id: `00000000000000000000${String(index + 1).padStart(4, '0')}`,
      ...common,
      latestVersionId: versionId,
      status: 'ACTIVE',
    })
    state.KnowledgePackVersion.push({
      _id: `10000000000000000000${String(index + 1).padStart(4, '0')}`,
      ...common,
      versionId,
      status: 'ACTIVE',
      semanticVersion: '1.0.0',
      schemaVersion: '1.0.0',
      contentFormat: 'MARKDOWN',
      contentHash,
      sourceFilename,
      sourceDocuments: [{
        filename: sourceFilename,
        fileExtension: 'md',
        contentType: 'text/markdown',
        sourceHash,
      }],
      content: `# ${contentKey}`,
    })
    state.KnowledgePackActivation.push({
      _id: `20000000000000000000${String(index + 1).padStart(4, '0')}`,
      ...common,
      activationId: `activation-${pack.packId}`,
      versionId,
      status: 'ACTIVE',
      contentHash,
    })
  })
  const renderingActivation = state.KnowledgePackActivation.find(
    (row) => row.packId === 'kp-rl-rendering-layer',
  )
  renderingActivation.purposeCategory = 'SYSTEM'
  return state
}

const matches = (row, filter) => Object.entries(filter).every(([key, expected]) => {
  if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
    return expected.$in.includes(row[key])
  }
  return row[key] === expected
})

const makeDependencies = ({ state, auditLog = jest.fn(async () => ({})) }) => {
  const makeModel = (collectionKey) => ({
    find: () => {
      const query = {
        lean: async () => clone(state[collectionKey]),
        select: () => query,
        session: () => query,
      }
      return query
    },
    updateOne: async (filter, update) => {
      const row = state[collectionKey].find((candidate) => matches(candidate, filter))
      if (!row) return { matchedCount: 0, modifiedCount: 0 }
      Object.assign(row, update.$set)
      return { matchedCount: 1, modifiedCount: 1 }
    },
    deleteMany: async (filter) => {
      const before = state[collectionKey].length
      state[collectionKey] = state[collectionKey].filter((row) => !matches(row, filter))
      return { deletedCount: before - state[collectionKey].length }
    },
    insertMany: async (documents) => {
      state[collectionKey].push(...clone(documents))
      return clone(documents)
    },
  })
  const manifestModel = {
    countDocuments: async () => state.KnowledgePackManifest.length,
    find: () => {
      const query = {
        lean: async () => clone(state.KnowledgePackManifest),
        session: () => query,
      }
      return query
    },
  }
  const session = {
    endSession: jest.fn(async () => {}),
    withTransaction: async (callback) => {
      const snapshot = clone(state)
      try {
        await callback()
      } catch (error) {
        Object.keys(snapshot).forEach((key) => {
          state[key] = snapshot[key]
        })
        throw error
      }
    },
  }
  return {
    auditService: {
      ...auditService,
      log: auditLog,
    },
    manifestModel,
    models: {
      KnowledgePack: makeModel('KnowledgePack'),
      KnowledgePackVersion: makeModel('KnowledgePackVersion'),
      KnowledgePackActivation: makeModel('KnowledgePackActivation'),
    },
    getDatabaseName: () => 'test',
    nodeEnv: 'test',
    startSession: jest.fn(async () => session),
  }
}

describe('development Knowledge Pack metadata reconciliation', () => {
  let manifest
  let policy

  beforeAll(async () => {
    manifest = await loadCorrectionManifest()
    policy = await loadDevPolicy({ manifest })
  })

  test('parses explicit apply and rollback modes', () => {
    expect(parseDevRehearsalArgs(['--apply', '--confirm-dev-knowledge-pack-reconciliation'])).toEqual({
      apply: true,
      confirm: true,
      help: false,
      json: false,
      rollbackPath: '',
      backupSha256: '',
    })
    expect(parseDevRehearsalArgs(['--rollback', 'backup.json'])).toEqual(expect.objectContaining({
      rollbackPath: 'backup.json',
    }))
  })

  test('blocks production and non-allowlisted databases', () => {
    expect(() => assertDevWriteEnvironment({ databaseName: 'test', nodeEnv: 'production', policy }))
      .toThrow(expect.objectContaining({ code: 'DEV_REHEARSAL_ENVIRONMENT_BLOCKED' }))
    expect(() => assertDevWriteEnvironment({ databaseName: 'storylineos', nodeEnv: 'development', policy }))
      .toThrow(expect.objectContaining({ code: 'DEV_REHEARSAL_ENVIRONMENT_BLOCKED' }))
    expect(() => assertDevWriteEnvironment({ databaseName: 'test', nodeEnv: '', policy }))
      .toThrow(expect.objectContaining({ code: 'DEV_REHEARSAL_ENVIRONMENT_BLOCKED' }))
    expect(() => assertDevWriteEnvironment({ databaseName: 'test', nodeEnv: 'development', policy }))
      .not.toThrow()
  })

  test('builds the approved safe subset and defers identity/runtime conflicts', () => {
    const state = makeState({ manifest, policy })
    const plan = buildDevRehearsalPlan({ manifest, policy, state })

    expect(plan.ok).toBe(true)
    expect(plan.summary).toEqual(expect.objectContaining({
      duplicatePairsToDelete: 7,
      recordsToUpdate: 93,
      fieldValuesToUpdate: 156,
      blockers: 0,
    }))
    expect(plan.deferredCorrections).toEqual(expect.arrayContaining([
      expect.objectContaining({ packId: 'kp-system-execution-translation', field: 'packType' }),
      expect.objectContaining({ packId: 'kp-arl-adaptive-reasoning-layer', field: 'executionMode' }),
      expect.objectContaining({ packId: 'kp-rl-rendering-layer', field: 'executionMode' }),
    ]))
  })

  test('blocks an unsupported enum value before opening a write transaction', () => {
    const invalidManifest = clone(manifest)
    const arlPack = invalidManifest.packs.find(
      (pack) => pack.packId === 'kp-arl-adaptive-reasoning-layer',
    )
    arlPack.corrections.find((correction) => correction.field === 'packCategory').to = 'INVALID_CATEGORY'
    invalidManifest.source.changeLogRowsSha256 = computeCorrectionRowsSha256(invalidManifest.packs)
    const invalidPolicy = {
      ...clone(policy),
      correctionRowsSha256: invalidManifest.source.changeLogRowsSha256,
    }
    const state = makeState({ manifest: invalidManifest, policy: invalidPolicy })

    const plan = buildDevRehearsalPlan({
      manifest: invalidManifest,
      policy: invalidPolicy,
      state,
    })

    expect(plan.ok).toBe(false)
    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'MANIFEST_VALUE_UNSUPPORTED',
      packId: 'kp-arl-adaptive-reasoning-layer',
      field: 'packCategory',
      value: 'INVALID_CATEGORY',
    }))
  })

  test('blocks duplicate deletion when extracted source content differs', () => {
    const state = makeState({ manifest, policy })
    state.KnowledgePackVersion.find(
      (row) => row.packId === policy.duplicateSurvivors[0].legacyPackId,
    ).content = 'different content'

    const plan = buildDevRehearsalPlan({ manifest, policy, state })

    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'DUPLICATE_CONTENT_PARITY_FAILED',
      legacyPackId: policy.duplicateSurvivors[0].legacyPackId,
    }))
  })

  test('rolls back all writes when mandatory audit persistence fails', async () => {
    const state = makeState({ manifest, policy })
    const before = clone(state)
    const plan = buildDevRehearsalPlan({ manifest, policy, state })
    const backup = buildDevBackup({ databaseName: 'test', manifest, policy, plan, state })
    const dependencies = makeDependencies({
      state,
      auditLog: jest.fn(async () => { throw new Error('audit unavailable') }),
    })

    await expect(applyDevRehearsalPlan({
      manifest,
      policy,
      plan,
      backup,
      backupArtifact: makeBackupArtifact(backup),
      dependencies,
    })).rejects.toThrow('audit unavailable')
    expect(state).toEqual(before)
  })

  test('write helpers enforce the environment even when called directly', async () => {
    const state = makeState({ manifest, policy })
    const plan = buildDevRehearsalPlan({ manifest, policy, state })
    const backup = buildDevBackup({ databaseName: 'test', manifest, policy, plan, state })
    const dependencies = {
      ...makeDependencies({ state }),
      nodeEnv: 'production',
    }

    await expect(applyDevRehearsalPlan({
      manifest,
      policy,
      plan,
      backup,
      backupArtifact: makeBackupArtifact(backup),
      dependencies,
    })).rejects.toThrow(expect.objectContaining({ code: 'DEV_REHEARSAL_ENVIRONMENT_BLOCKED' }))
    expect(dependencies.startSession).not.toHaveBeenCalled()
  })

  test('backup validation binds rollback to the exact manifest and policy scope', () => {
    const state = makeState({ manifest, policy })
    const plan = buildDevRehearsalPlan({ manifest, policy, state })
    const backup = buildDevBackup({ databaseName: 'test', manifest, policy, plan, state })
    backup.packIds = backup.packIds.slice(1)
    backup.preStateDigest = computeAffectedStateDigest({ state: backup.collections, packIds: backup.packIds })

    expect(() => validateBackup({ backup, databaseName: 'test', manifest, policy }))
      .toThrow(expect.objectContaining({ code: 'DEV_REHEARSAL_BACKUP_INVALID' }))
  })

  test('backup validation rejects out-of-scope collection rows', () => {
    const state = makeState({ manifest, policy })
    const plan = buildDevRehearsalPlan({ manifest, policy, state })
    const backup = buildDevBackup({ databaseName: 'test', manifest, policy, plan, state })
    backup.collections.KnowledgePack.push({
      ...backup.collections.KnowledgePack[0],
      _id: 'ffffffffffffffffffffffff',
      packId: 'kp-out-of-scope',
    })
    backup.preStateDigest = computeAffectedStateDigest({ state: backup.collections, packIds: backup.packIds })

    expect(() => validateBackup({ backup, databaseName: 'test', manifest, policy }))
      .toThrow(expect.objectContaining({ code: 'DEV_REHEARSAL_BACKUP_SCOPE_INVALID' }))
  })

  test('direct helpers reject a policy that differs from the checked-in policy', async () => {
    const state = makeState({ manifest, policy })
    const plan = buildDevRehearsalPlan({ manifest, policy, state })
    const backup = buildDevBackup({ databaseName: 'test', manifest, policy, plan, state })
    const unapprovedPolicy = {
      ...clone(policy),
      environmentGuard: {
        ...clone(policy.environmentGuard),
        allowedDatabaseNames: ['test', 'production'],
      },
    }

    await expect(applyDevRehearsalPlan({
      manifest,
      policy: unapprovedPolicy,
      plan,
      backup,
      backupArtifact: makeBackupArtifact(backup),
      dependencies: makeDependencies({ state }),
    })).rejects.toThrow(expect.objectContaining({ code: 'DEV_REHEARSAL_POLICY_NOT_APPROVED' }))
  })

  test('rejects a stale plan when duplicate source content changes before the transaction', async () => {
    const state = makeState({ manifest, policy })
    const plan = buildDevRehearsalPlan({ manifest, policy, state })
    const backup = buildDevBackup({ databaseName: 'test', manifest, policy, plan, state })
    state.KnowledgePackVersion.find(
      (row) => row.packId === policy.duplicateSurvivors[0].legacyPackId,
    ).content = 'changed after preflight'
    const dependencies = makeDependencies({ state })

    await expect(applyDevRehearsalPlan({
      manifest,
      policy,
      plan,
      backup,
      backupArtifact: makeBackupArtifact(backup),
      dependencies,
    })).rejects.toThrow(expect.objectContaining({ code: 'DEV_REHEARSAL_PLAN_CHANGED' }))
  })

  test('applies and then restores the exact pre-change snapshot', async () => {
    const state = makeState({ manifest, policy })
    const plan = buildDevRehearsalPlan({ manifest, policy, state })
    const backup = buildDevBackup({ databaseName: 'test', manifest, policy, plan, state })
    const dependencies = makeDependencies({ state })

    const applied = await applyDevRehearsalPlan({
      manifest,
      policy,
      plan,
      backup,
      backupArtifact: makeBackupArtifact(backup),
      dependencies,
    })
    expect(applied).toEqual(expect.objectContaining({
      fieldValuesUpdated: 156,
      packsDeleted: 7,
      versionsDeleted: 7,
      activationsDeleted: 7,
    }))
    expect(computeAffectedStateDigest({ state, packIds: backup.packIds }))
      .toBe(backup.expectedAppliedStateDigest)

    const rollbackResult = await rollbackDevRehearsal({
      backup,
      backupSha256: computeBackupArtifactSha256(backup),
      backupPath: 'backup.json',
      currentState: clone(state),
      manifest,
      policy,
      dependencies,
    })
    expect(rollbackResult.restoredStateDigest).toBe(backup.preStateDigest)
    expect(computeAffectedStateDigest({ state, packIds: backup.packIds }))
      .toBe(backup.preStateDigest)
  })

  test('treats a second apply as an idempotent no-op', async () => {
    const state = makeState({ manifest, policy })
    const firstPlan = buildDevRehearsalPlan({ manifest, policy, state })
    const firstBackup = buildDevBackup({
      databaseName: 'test',
      manifest,
      policy,
      plan: firstPlan,
      state,
    })
    const dependencies = makeDependencies({ state })
    await applyDevRehearsalPlan({
      manifest,
      policy,
      plan: firstPlan,
      backup: firstBackup,
      backupArtifact: makeBackupArtifact(firstBackup),
      dependencies,
    })

    const secondPlan = buildDevRehearsalPlan({ manifest, policy, state })
    expect(secondPlan.summary).toEqual(expect.objectContaining({
      duplicatePairsAlreadyRemoved: 7,
      duplicatePairsToDelete: 0,
      fieldValuesToUpdate: 0,
      recordsToUpdate: 0,
    }))
    const secondBackup = buildDevBackup({
      databaseName: 'test',
      manifest,
      policy,
      plan: secondPlan,
      state,
    })
    const secondResult = await applyDevRehearsalPlan({
      manifest,
      policy,
      plan: secondPlan,
      backup: secondBackup,
      backupArtifact: makeBackupArtifact(secondBackup),
      dependencies,
    })

    expect(secondResult).toEqual(expect.objectContaining({
      fieldValuesUpdated: 0,
      recordsUpdated: 0,
      packsDeleted: 0,
      versionsDeleted: 0,
      activationsDeleted: 0,
    }))
  })

  test('rolls back restoration writes when rollback audit persistence fails', async () => {
    const state = makeState({ manifest, policy })
    const plan = buildDevRehearsalPlan({ manifest, policy, state })
    const backup = buildDevBackup({ databaseName: 'test', manifest, policy, plan, state })
    const applyDependencies = makeDependencies({ state })
    await applyDevRehearsalPlan({
      manifest,
      policy,
      plan,
      backup,
      backupArtifact: makeBackupArtifact(backup),
      dependencies: applyDependencies,
    })
    const appliedState = clone(state)
    const rollbackDependencies = makeDependencies({
      state,
      auditLog: jest.fn(async () => { throw new Error('rollback audit unavailable') }),
    })

    await expect(rollbackDevRehearsal({
      backup,
      backupSha256: computeBackupArtifactSha256(backup),
      backupPath: 'backup.json',
      currentState: clone(state),
      manifest,
      policy,
      dependencies: rollbackDependencies,
    })).rejects.toThrow('rollback audit unavailable')
    expect(state).toEqual(appliedState)
  })
})
