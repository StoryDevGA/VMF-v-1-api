import crypto from 'node:crypto'
import { jest } from '@jest/globals'

import {
  applyGovernanceMappingPlan,
  assertGovernanceWriteEnvironment,
  buildGovernanceBackup,
  buildGovernanceMappingPlan,
  repairGovernanceMappingAuditEvidence,
  validateGovernancePolicy,
} from '../scripts/applyKnowledgePackGovernanceMapping.js'

const policy = validateGovernancePolicy({
  schemaVersion: '1.0.0',
  policyVersion: 'test-policy',
  environmentGuard: { allowedNodeEnvs: ['test'], allowedDatabaseNames: ['test'] },
  workspaceCompatibility: ['OUTCOME'],
  packTypeLayerMap: {
    OUTPUT_TYPE_DEFINITION: 'OUTPUT_TYPE',
    OUTPUT_SCHEMA: 'OUTPUT_SCHEMA',
    STYLE: 'STYLE',
  },
  capabilityRequiredLayers: ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'STYLE'],
  dependencyReferencesByPackKey: {
    'executive-brief': [
      {
        knowledgeLayer: 'OUTPUT_SCHEMA',
        requirement: 'REQUIRED',
        packType: 'OUTPUT_SCHEMA',
        packKey: 'executive-brief-schema',
      },
    ],
  },
  historicalPolicy: 'PRESERVE',
  manifestPolicy: 'BLOCK_IF_PRESENT',
})

const recordSet = ({ packId, packType, packKey, capabilityKey = '' }) => ({
  pack: { packId, packType, packKey },
  version: {
    versionId: `v-${packId}`,
    packId,
    packType,
    packKey,
    capabilityKey,
  },
  activation: {
    activationId: `a-${packId}`,
    versionId: `v-${packId}`,
    packId,
    packType,
    packKey,
    capabilityKey,
    status: 'ACTIVE',
    scopeKey: 'GLOBAL',
  },
})

const fileSha256 = (value) => crypto
  .createHash('sha256')
  .update(`${JSON.stringify(value, null, 2)}\n`)
  .digest('hex')
  .toUpperCase()

const buildMappingFixture = () => {
  const output = recordSet({
    packId: 'kp-output',
    packType: 'OUTPUT_TYPE_DEFINITION',
    packKey: 'executive-brief',
  })
  const schema = recordSet({
    packId: 'kp-schema',
    packType: 'OUTPUT_SCHEMA',
    packKey: 'executive-brief-schema',
  })
  const state = {
    packs: [
      { ...output.pack, latestVersionId: output.version.versionId },
      { ...schema.pack, latestVersionId: schema.version.versionId },
    ],
    versions: [output.version, schema.version],
    activations: [output.activation, schema.activation],
    manifests: [],
  }
  const plan = buildGovernanceMappingPlan({ ...state, policy })
  const convergedState = structuredClone(state)
  for (const update of plan.updates) {
    const rows = update.collectionKey === 'KnowledgePack'
      ? convergedState.packs
      : update.collectionKey === 'KnowledgePackVersion'
        ? convergedState.versions
        : convergedState.activations
    const row = rows.find((candidate) => candidate[update.idField] === update.recordKey)
    update.changes.forEach((change) => {
      row[change.field] = structuredClone(change.to)
    })
  }
  const backup = buildGovernanceBackup({
    databaseName: 'test',
    plan,
    policy,
    state,
    now: new Date('2026-07-14T19:00:00.000Z'),
  })
  const backupArtifact = {
    path: 'C:\\local\\backups\\kp-004-original-backup.json',
    sha256: fileSha256(backup),
  }
  return { backup, backupArtifact, convergedState, plan, state }
}

const modelForRows = (rowsByRead) => {
  let readIndex = 0
  return {
    find: jest.fn(() => {
      const rows = rowsByRead[Math.min(readIndex, rowsByRead.length - 1)]
      readIndex += 1
      const query = {
        session: jest.fn(() => query),
        lean: jest.fn().mockResolvedValue(rows),
      }
      return query
    }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  }
}

const buildModels = (...states) => ({
  KnowledgePack: modelForRows(states.map((state) => state.packs)),
  KnowledgePackVersion: modelForRows(states.map((state) => state.versions)),
  KnowledgePackActivation: modelForRows(states.map((state) => state.activations)),
  KnowledgePackManifest: modelForRows(states.map((state) => state.manifests)),
})

const buildSession = () => ({
  withTransaction: jest.fn(async (callback) => callback()),
  endSession: jest.fn().mockResolvedValue(undefined),
})

const buildTransactionalModels = (state) => {
  const modelForState = ({ idField, stateKey }) => ({
    find: jest.fn(() => {
      const query = {
        session: jest.fn(() => query),
        lean: jest.fn(async () => structuredClone(state[stateKey])),
      }
      return query
    }),
    updateOne: jest.fn(async (filter, update) => {
      const row = state[stateKey].find((candidate) => candidate[idField] === filter[idField])
      if (!row) return { modifiedCount: 0 }
      Object.assign(row, structuredClone(update.$set))
      return { modifiedCount: 1 }
    }),
  })

  return {
    KnowledgePack: modelForState({ idField: 'packId', stateKey: 'packs' }),
    KnowledgePackVersion: modelForState({ idField: 'versionId', stateKey: 'versions' }),
    KnowledgePackActivation: modelForState({ idField: 'activationId', stateKey: 'activations' }),
    KnowledgePackManifest: modelForState({ idField: 'manifestId', stateKey: 'manifests' }),
  }
}

const buildRollbackSession = (state) => ({
  withTransaction: jest.fn(async (callback) => {
    const snapshot = structuredClone(state)
    try {
      return await callback()
    } catch (error) {
      Object.keys(snapshot).forEach((stateKey) => {
        state[stateKey].splice(
          0,
          state[stateKey].length,
          ...structuredClone(snapshot[stateKey]),
        )
      })
      throw error
    }
  }),
  endSession: jest.fn().mockResolvedValue(undefined),
})

describe('KP-004 governance mapping guard', () => {
  test('maps current version and active activation and proves required dependencies', () => {
    const output = recordSet({
      packId: 'kp-output',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'executive-brief',
    })
    const schema = recordSet({
      packId: 'kp-schema',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'executive-brief-schema',
    })
    const plan = buildGovernanceMappingPlan({
      packs: [
        { ...output.pack, latestVersionId: output.version.versionId },
        { ...schema.pack, latestVersionId: schema.version.versionId },
      ],
      versions: [output.version, schema.version],
      activations: [output.activation, schema.activation],
      manifests: [],
      policy,
    })
    expect(plan.ok).toBe(true)
    expect(plan.recordsToUpdate).toBeGreaterThan(0)
    expect(plan.blockers).toEqual([])
  })

  test('blocks persisted manifests, missing dependencies, and projected capability collisions', () => {
    const first = recordSet({
      packId: 'kp-one',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'executive-brief',
    })
    const second = recordSet({
      packId: 'kp-two',
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: 'executive-brief',
    })
    const plan = buildGovernanceMappingPlan({
      packs: [
        { ...first.pack, latestVersionId: first.version.versionId },
        { ...second.pack, latestVersionId: second.version.versionId },
      ],
      versions: [first.version, second.version],
      activations: [first.activation, second.activation],
      manifests: [{ manifestId: 'legacy' }],
      policy,
    })
    expect(plan.ok).toBe(false)
    expect(plan.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining([
      'PERSISTED_MANIFESTS_PRESENT',
      'PROJECTED_CAPABILITY_COLLISION',
      'PROJECTED_REQUIRED_DEPENDENCY_MISSING',
    ]))
  })

  test('blocks writes outside the policy environment allowlist', () => {
    expect(() => assertGovernanceWriteEnvironment({
      databaseName: 'test',
      nodeEnv: 'production',
      policy,
    })).toThrow('Refusing Knowledge Pack governance mapping write')
  })

  test('applies writes and registered governance evidence inside one transaction', async () => {
    const fixture = buildMappingFixture()
    const models = buildModels(fixture.state, fixture.convergedState)
    const session = buildSession()
    const governanceAuditService = { logSystemEvent: jest.fn().mockResolvedValue({ id: 'audit-1' }) }

    const result = await applyGovernanceMappingPlan({
      backup: fixture.backup,
      backupArtifact: fixture.backupArtifact,
      plan: fixture.plan,
      policy,
      dependencies: {
        models,
        getDatabaseName: () => 'test',
        governanceAuditService,
        nodeEnv: 'test',
        startSession: async () => session,
      },
    })

    expect(result.recordsUpdated).toBe(fixture.plan.recordsToUpdate)
    expect(session.withTransaction).toHaveBeenCalledTimes(1)
    expect(governanceAuditService.logSystemEvent).toHaveBeenCalledWith(
      'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED',
      expect.objectContaining({
        snapshot: expect.objectContaining({
          evidenceMode: 'APPLY',
          backupFilename: 'kp-004-original-backup.json',
        }),
      }),
      { session, throwOnError: true },
    )
    const auditPayload = governanceAuditService.logSystemEvent.mock.calls[0][1]
    expect(JSON.stringify(auditPayload)).not.toContain('C:\\local')
    expect(session.endSession).toHaveBeenCalledTimes(1)
  })

  test('rolls back apply-path mutations when governance audit persistence fails', async () => {
    const fixture = buildMappingFixture()
    const transactionState = structuredClone(fixture.state)
    const models = buildTransactionalModels(transactionState)
    const session = buildRollbackSession(transactionState)
    const governanceAuditService = {
      logSystemEvent: jest.fn(async () => {
        expect(transactionState).toEqual(fixture.convergedState)
        throw new Error('governance audit unavailable')
      }),
    }

    await expect(applyGovernanceMappingPlan({
      backup: fixture.backup,
      backupArtifact: fixture.backupArtifact,
      plan: fixture.plan,
      policy,
      dependencies: {
        models,
        getDatabaseName: () => 'test',
        governanceAuditService,
        nodeEnv: 'test',
        startSession: async () => session,
      },
    })).rejects.toThrow('governance audit unavailable')

    expect(models.KnowledgePack.updateOne).toHaveBeenCalled()
    expect(models.KnowledgePackVersion.updateOne).toHaveBeenCalled()
    expect(models.KnowledgePackActivation.updateOne).toHaveBeenCalled()
    expect(governanceAuditService.logSystemEvent).toHaveBeenCalledWith(
      'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED',
      expect.any(Object),
      { session, throwOnError: true },
    )
    expect(transactionState).toEqual(fixture.state)
    expect(transactionState).not.toEqual(fixture.convergedState)
    expect(session.withTransaction).toHaveBeenCalledTimes(1)
    expect(session.endSession).toHaveBeenCalledTimes(1)
  })

  test('writes corrective v2 audit evidence only after exact zero-mutation convergence', async () => {
    const fixture = buildMappingFixture()
    const models = buildModels(fixture.convergedState)
    const session = buildSession()
    const governanceAuditService = { logSystemEvent: jest.fn().mockResolvedValue({ id: 'audit-2' }) }

    const result = await repairGovernanceMappingAuditEvidence({
      backup: fixture.backup,
      backupArtifact: fixture.backupArtifact,
      policy,
      dependencies: {
        models,
        getDatabaseName: () => 'test',
        governanceAuditService,
        nodeEnv: 'test',
        startSession: async () => session,
      },
    })

    expect(result).toEqual(expect.objectContaining({
      recordsMutated: 0,
      secondDryRunMutations: 0,
      readbackDigest: fixture.backup.expectedAppliedStateDigest,
    }))
    Object.values(models).forEach((model) => expect(model.updateOne).not.toHaveBeenCalled())
    const auditPayload = governanceAuditService.logSystemEvent.mock.calls[0][1]
    expect(auditPayload.snapshot).toEqual(expect.objectContaining({
      evidenceMode: 'CORRECTIVE_AUDIT_ONLY',
      backupFilename: 'kp-004-original-backup.json',
    }))
    expect(auditPayload.snapshot).not.toHaveProperty('backupPath')
    expect(JSON.stringify(auditPayload)).not.toContain('C:\\local')
  })

  test('fails closed when corrective audit persistence fails', async () => {
    const fixture = buildMappingFixture()
    const models = buildModels(fixture.convergedState)
    const session = buildSession()
    const governanceAuditService = {
      logSystemEvent: jest.fn().mockRejectedValue(new Error('audit unavailable')),
    }

    await expect(repairGovernanceMappingAuditEvidence({
      backup: fixture.backup,
      backupArtifact: fixture.backupArtifact,
      policy,
      dependencies: {
        models,
        getDatabaseName: () => 'test',
        governanceAuditService,
        nodeEnv: 'test',
        startSession: async () => session,
      },
    })).rejects.toThrow('audit unavailable')

    Object.values(models).forEach((model) => expect(model.updateOne).not.toHaveBeenCalled())
    expect(session.endSession).toHaveBeenCalledTimes(1)
  })
})
