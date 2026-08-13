import { jest } from '@jest/globals'

const makeDependencies = (rows) => ({
  connect: jest.fn(async () => {}),
  disconnect: jest.fn(async () => {}),
  modelConfigs: [
    {
      collectionKey: 'KnowledgePackVersion',
      idField: 'versionId',
      model: {
        collection: { db: { databaseName: 'test' } },
        find: () => ({
          select: () => ({ lean: async () => rows }),
        }),
      },
    },
  ],
})

const policy = {
  policyVersion: 'test-policy',
  status: 'PROPOSED_PENDING_OWNER_CONFIRMATION',
  boundaries: {
    GENERATION_CONTEXT: ['provider-pack'],
    POST_GENERATION_VALIDATION: ['rendering-layer'],
  },
}

describe('Knowledge Pack boundary readiness audit', () => {
  test('model accepts an enumerated boundary and rejects an unknown value', async () => {
    const { default: KnowledgePack } = await import('../models/KnowledgePack.js')
    const base = {
      packCategory: 'OUTCOME',
      purposeCategory: 'SYSTEM',
      packType: 'ARL',
      packKey: 'boundary-model-test',
      label: 'Boundary model test',
      status: 'DRAFT',
      executionMode: 'PROVIDER_CONTEXT',
    }

    await expect(new KnowledgePack({
      ...base,
      boundary: 'GENERATION_CONTEXT',
    }).validate()).resolves.toBeUndefined()

    await expect(new KnowledgePack({
      ...base,
      packKey: 'boundary-model-invalid-test',
      boundary: 'UNKNOWN_BOUNDARY',
    }).validate()).rejects.toThrow(/boundary/i)
  })

  test('reports a missing explicit boundary as proposed without authorizing a write', async () => {
    const { buildKnowledgePackBoundaryAuditRow } = await import('../scripts/auditKnowledgePackBoundaryReadiness.js')
    const row = buildKnowledgePackBoundaryAuditRow({
      collectionKey: 'KnowledgePackVersion',
      idField: 'versionId',
      policy,
      row: {
        versionId: 'kpv-provider-pack-1-0-0-global',
        packType: 'SYSTEM',
        packKey: 'provider-pack',
        executionMode: 'PROVIDER_CONTEXT',
      },
    })

    expect(row.proposalStatus).toBe('PROPOSED')
    expect(row.proposedBoundary).toBe('GENERATION_CONTEXT')
    expect(row.resolvedBoundary).toBe('GENERATION_CONTEXT')
    expect(row.writeAuthorized).toBe(false)
  })

  test('reports a mismatched persisted boundary explicitly', async () => {
    const { buildKnowledgePackBoundaryAuditRow } = await import('../scripts/auditKnowledgePackBoundaryReadiness.js')
    const row = buildKnowledgePackBoundaryAuditRow({
      collectionKey: 'KnowledgePackVersion',
      idField: 'versionId',
      policy,
      row: {
        versionId: 'kpv-rendering-layer-1-0-0-global',
        packType: 'RL',
        packKey: 'rendering-layer',
        executionMode: 'PROVIDER_CONTEXT',
        boundary: 'GENERATION_CONTEXT',
      },
    })

    expect(row.proposalStatus).toBe('MISMATCHED')
    expect(row.resolvedBoundary).toBe('GENERATION_CONTEXT')
    expect(row.issues).toContain('BOUNDARY_POLICY_MISMATCH')
  })

  test('read-only audit closes the database connection and never marks rows writable', async () => {
    const { auditKnowledgePackBoundaryReadiness } = await import('../scripts/auditKnowledgePackBoundaryReadiness.js')
    const dependencies = makeDependencies([
      {
        versionId: 'kpv-provider-pack-1-0-0-global',
        packType: 'SYSTEM',
        packKey: 'provider-pack',
        executionMode: 'PROVIDER_CONTEXT',
      },
      {
        versionId: 'kpv-rendering-layer-1-0-0-global',
        packType: 'RL',
        packKey: 'rendering-layer',
        executionMode: 'PROVIDER_CONTEXT',
      },
    ])
    const summary = await auditKnowledgePackBoundaryReadiness({
      dependencies: { ...dependencies, policy },
      logger: jest.fn(),
      json: true,
    })

    expect(summary.writePosture).toBe('READ_ONLY_NO_APPLY_MODE')
    expect(summary.totalProposed).toBe(2)
    expect(summary.collections[0].rows.every((row) => row.writeAuthorized === false)).toBe(true)
    expect(dependencies.disconnect).toHaveBeenCalledTimes(1)
  })
})
