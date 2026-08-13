import crypto from 'node:crypto'
import { jest } from '@jest/globals'

import {
  applySs005BoundaryPlan,
  buildSs005BoundaryPlan,
  sha256Json,
  validateSs005BoundaryPolicy,
} from '../scripts/applyKnowledgePackBoundaryPolicySs005.js'

const policy = {
  schemaVersion: '1.0.0',
  policyVersion: 'ss-005-test-policy',
  status: 'APPROVED_FOR_DEVELOPMENT_TEST_APPLY',
  applyPosture: 'DEVELOPMENT_TEST_ONLY_WITH_EXPLICIT_CONFIRMATION',
  environmentGuard: {
    allowedNodeEnvs: ['test'],
    allowedDatabaseNames: ['test'],
  },
  boundaries: {
    GENERATION_CONTEXT: ['executive-brief'],
  },
  requiredPackCount: 1,
  expectedMatches: {
    KnowledgePack: 1,
    KnowledgePackVersion: 1,
    KnowledgePackActivation: 1,
  },
}
validateSs005BoundaryPolicy(policy)

const buildState = () => ({
  KnowledgePack: [{
    collectionKey: 'KnowledgePack',
    idField: 'packId',
    recordKey: 'kp-executive-brief',
    packKey: 'executive-brief',
    boundary: '',
    executionMode: 'PROVIDER_CONTEXT',
    status: 'ACTIVE',
    semanticVersion: '1.0.0',
  }],
  KnowledgePackVersion: [{
    collectionKey: 'KnowledgePackVersion',
    idField: 'versionId',
    recordKey: 'kpv-executive-brief-1-0-0',
    packKey: 'executive-brief',
    boundary: '',
    executionMode: 'PROVIDER_CONTEXT',
    status: 'ACTIVE',
    semanticVersion: '1.0.0',
  }],
  KnowledgePackActivation: [{
    collectionKey: 'KnowledgePackActivation',
    idField: 'activationId',
    recordKey: 'kpa-executive-brief-1-0-0',
    packKey: 'executive-brief',
    boundary: '',
    executionMode: 'PROVIDER_CONTEXT',
    status: 'ACTIVE',
    semanticVersion: '1.0.0',
  }],
})

const buildModels = (state) => {
  const configs = [
    ['KnowledgePack', 'packId'],
    ['KnowledgePackVersion', 'versionId'],
    ['KnowledgePackActivation', 'activationId'],
  ]
  return Object.fromEntries(configs.map(([collectionKey, idField]) => {
    const model = {
      find: jest.fn(() => {
        const query = {
          select: jest.fn(() => query),
          session: jest.fn(() => query),
          lean: jest.fn(async () => structuredClone(state[collectionKey].map((row) => ({
            [idField]: row.recordKey,
            packKey: row.packKey,
            boundary: row.boundary,
            executionMode: row.executionMode,
            status: row.status,
            semanticVersion: row.semanticVersion,
          })))),
        }
        return query
      }),
      updateOne: jest.fn(async (filter, update) => {
        const row = state[collectionKey].find((candidate) => candidate.recordKey === filter[idField])
        if (!row) return { modifiedCount: 0 }
        Object.assign(row, structuredClone(update.$set))
        return { modifiedCount: 1 }
      }),
    }
    return [collectionKey, model]
  }))
}

const fileSha256 = (value) => crypto
  .createHash('sha256')
  .update(`${JSON.stringify(value, null, 2)}\n`)
  .digest('hex')
  .toUpperCase()

const buildFixture = () => {
  const state = buildState()
  const plan = buildSs005BoundaryPlan({ state, policy })
  const backup = {
    schemaVersion: '1.0.0',
    databaseName: 'test',
    policyVersion: policy.policyVersion,
    policySha256: sha256Json(policy),
    planSha256: sha256Json(plan),
    capturedAt: '2026-08-13T00:00:00.000Z',
    preStateDigest: plan.preStateDigest,
    expectedAppliedStateDigest: plan.expectedAppliedStateDigest,
    state,
  }
  return {
    backup,
    backupArtifact: { path: 'C:\\local\\ss005-backup.json', sha256: fileSha256(backup) },
    models: buildModels(state),
    plan,
  }
}

const buildSession = () => ({
  withTransaction: jest.fn(async (callback) => callback()),
  endSession: jest.fn().mockResolvedValue(undefined),
})

describe('SS-005 boundary policy apply guard', () => {
  test('requires the backup database and exact state digests', async () => {
    const fixture = buildFixture()
    const startSession = jest.fn(async () => buildSession())

    await expect(applySs005BoundaryPlan({
      ...fixture,
      policy,
      backup: { ...fixture.backup, databaseName: 'production' },
      dependencies: { databaseName: 'test', nodeEnv: 'test', startSession },
    })).rejects.toMatchObject({ code: 'SS005_BOUNDARY_BACKUP_DATABASE_INVALID' })

    await expect(applySs005BoundaryPlan({
      ...fixture,
      policy,
      backup: { ...fixture.backup, preStateDigest: 'BAD' },
      dependencies: { databaseName: 'test', nodeEnv: 'test', startSession },
    })).rejects.toMatchObject({ code: 'SS005_BOUNDARY_BACKUP_STATE_DIGEST_INVALID' })

    expect(startSession).not.toHaveBeenCalled()
  })

  test('applies only the exact plan and records the dedicated SS-005 audit event', async () => {
    const fixture = buildFixture()
    const session = buildSession()
    const governanceAuditService = { logSystemEvent: jest.fn().mockResolvedValue({ id: 'audit-ss005-1' }) }

    const result = await applySs005BoundaryPlan({
      ...fixture,
      policy,
      dependencies: {
        databaseName: 'test',
        nodeEnv: 'test',
        models: fixture.models,
        startSession: async () => session,
        governanceAuditService,
      },
    })

    expect(result).toEqual(expect.objectContaining({
      recordsUpdated: 3,
      secondDryRunMutations: 0,
      readbackDigest: fixture.plan.expectedAppliedStateDigest,
    }))
    expect(governanceAuditService.logSystemEvent).toHaveBeenCalledWith(
      'SS005_BOUNDARY_POLICY_APPLIED',
      expect.objectContaining({ snapshot: expect.objectContaining({ operation: 'SS005_BOUNDARY_POLICY_APPLY' }) }),
      { session, throwOnError: true },
    )
    expect(session.withTransaction).toHaveBeenCalledTimes(1)
    expect(session.endSession).toHaveBeenCalledTimes(1)
  })
})
