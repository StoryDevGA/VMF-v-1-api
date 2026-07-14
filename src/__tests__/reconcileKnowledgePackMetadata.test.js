import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { jest } from '@jest/globals'
import {
  buildKnowledgePackMetadataReconciliationPlan,
  computeCorrectionRowsSha256,
  formatTextReport,
  loadCorrectionManifest,
  parseArgs,
  reconcileKnowledgePackMetadata,
  validateCorrectionManifest,
  verifyManifestSource,
  writeReconciliationReport,
} from '../scripts/reconcileKnowledgePackMetadata.js'

const makeManifest = ({
  corrections = [
    {
      field: 'executionMode',
      from: 'PROVIDER_CONTEXT',
      to: 'SYSTEM_ONLY',
      reason: 'Test correction',
    },
  ],
  packId = 'kp-system-example',
  packKey = 'example',
} = {}) => {
  const manifest = {
    schemaVersion: '1.0.0',
    source: {
      workbook: 'docs/source.xlsx',
      sheet: 'Change Log',
      sha256: 'A'.repeat(64),
      changeLogRowsSha256: '',
    },
    expectations: {
      correctedLibraryRecords: 1,
      changedPacks: 1,
      corrections: corrections.length,
    },
    allowedFields: [
      'packType',
      'purposeCategory',
      'executionMode',
      'packCategory',
    ],
    packs: [
      {
        packId,
        packKey,
        label: 'Example',
        corrections,
      },
    ],
  }
  manifest.source.changeLogRowsSha256 = computeCorrectionRowsSha256(manifest.packs)
  return manifest
}

const makeRows = ({
  executionMode = 'PROVIDER_CONTEXT',
  packType = 'SYSTEM',
  packCategory = 'OUTCOME',
  purposeCategory = 'SYSTEM',
  packId = 'kp-system-example',
  packKey = 'example',
} = {}) => ({
  KnowledgePack: [
    {
      packId,
      packKey,
      packType,
      packCategory,
      purposeCategory,
      executionMode,
      status: 'ACTIVE',
      latestVersionId: 'kpv-system-example-1-0-0-global',
    },
  ],
  KnowledgePackVersion: [
    {
      versionId: 'kpv-system-example-1-0-0-global',
      packId,
      packKey,
      packType,
      packCategory,
      purposeCategory,
      executionMode,
      status: 'ACTIVE',
      semanticVersion: '1.0.0',
      scopeKey: 'GLOBAL',
    },
  ],
  KnowledgePackActivation: [
    {
      activationId: 'kpa-system-example-1-0-0-global',
      versionId: 'kpv-system-example-1-0-0-global',
      packId,
      packKey,
      packType,
      packCategory,
      purposeCategory,
      executionMode,
      status: 'ACTIVE',
      semanticVersion: '1.0.0',
      scopeKey: 'GLOBAL',
    },
  ],
})

describe('reconcileKnowledgePackMetadata script', () => {
  test('parses dry-run and read-only apply arguments without implying a confirmation path', () => {
    expect(parseArgs([])).toEqual({ apply: false, json: false, help: false })
    expect(parseArgs([
      '--apply',
      '--json',
    ])).toEqual({ apply: true, json: true, help: false })
  })

  test('loads the workbook-derived manifest with the expected pack and correction counts', async () => {
    const manifest = await loadCorrectionManifest()

    expect(manifest.expectations).toEqual(expect.objectContaining({
      correctedLibraryRecords: 89,
      changedPacks: 39,
      corrections: 85,
    }))
    expect(manifest.packs).toHaveLength(39)
  })

  test('rejects duplicate field corrections before reading database state', () => {
    const correction = {
      field: 'executionMode',
      from: 'PROVIDER_CONTEXT',
      to: 'SYSTEM_ONLY',
      reason: 'Test correction',
    }
    const manifest = makeManifest({ corrections: [correction, correction] })

    expect(() => validateCorrectionManifest(manifest)).toThrow(
      expect.objectContaining({ code: 'MANIFEST_CORRECTION_DUPLICATE' }),
    )
  })

  test('rejects a manifest row changed after workbook generation even when counts still match', () => {
    const manifest = makeManifest()
    manifest.packs[0].corrections[0].reason = 'Tampered reason'

    expect(() => validateCorrectionManifest(manifest)).toThrow(
      expect.objectContaining({ code: 'MANIFEST_SOURCE_ROWS_MISMATCH' }),
    )
  })

  test('verifies the archived workbook hash used to generate the manifest', async () => {
    const manifest = await loadCorrectionManifest()
    const sourceCheck = await verifyManifestSource({ manifest })

    expect(sourceCheck).toEqual(expect.objectContaining({
      ok: true,
      code: 'SOURCE_HASH_MATCH',
      expectedHash: manifest.source.sha256,
      actualHash: manifest.source.sha256,
    }))
  })

  test('rejects a workbook path that escapes the configured workspace', async () => {
    const manifest = makeManifest()
    manifest.source.workbook = '../outside.xlsx'

    const sourceCheck = await verifyManifestSource({
      manifest,
      rootDir: path.join(os.tmpdir(), 'knowledge-pack-workspace'),
    })

    expect(sourceCheck).toEqual(expect.objectContaining({
      ok: false,
      code: 'MANIFEST_SOURCE_OUTSIDE_WORKSPACE',
      workbook: '../outside.xlsx',
    }))
  })

  test('plans the same pending correction across pack, version, and activation records', () => {
    const plan = buildKnowledgePackMetadataReconciliationPlan({
      manifest: makeManifest(),
      rowsByCollection: makeRows(),
    })

    expect(plan.ok).toBe(true)
    expect(plan.summary).toEqual(expect.objectContaining({
      recordsTargeted: 3,
      pendingFieldChanges: 3,
      alreadyCorrectFieldValues: 0,
      blockers: 0,
    }))
    expect(plan.collections.map((collection) => collection.pending)).toEqual([1, 1, 1])
  })

  test('treats corrected values as idempotent with zero pending writes', () => {
    const plan = buildKnowledgePackMetadataReconciliationPlan({
      manifest: makeManifest(),
      rowsByCollection: makeRows({ executionMode: 'SYSTEM_ONLY' }),
    })

    expect(plan.ok).toBe(true)
    expect(plan.summary.pendingFieldChanges).toBe(0)
    expect(plan.summary.alreadyCorrectFieldValues).toBe(3)
  })

  test('blocks unexpected current values instead of overwriting drift', () => {
    const rows = makeRows()
    rows.KnowledgePackActivation[0].executionMode = 'POST_VALIDATION'

    const plan = buildKnowledgePackMetadataReconciliationPlan({
      manifest: makeManifest(),
      rowsByCollection: rows,
    })

    expect(plan.ok).toBe(false)
    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'CURRENT_VALUE_DRIFT',
      collectionKey: 'KnowledgePackActivation',
      field: 'executionMode',
      currentValue: 'POST_VALIDATION',
    }))
  })

  test('blocks missing active-pack version and activation records', () => {
    const rows = makeRows()
    rows.KnowledgePackVersion = []
    rows.KnowledgePackActivation = []

    const plan = buildKnowledgePackMetadataReconciliationPlan({
      manifest: makeManifest(),
      rowsByCollection: rows,
    })

    expect(plan.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACTIVE_PACK_VERSION_MISSING' }),
      expect.objectContaining({ code: 'ACTIVE_PACK_ACTIVATION_MISSING' }),
    ]))
  })

  test('blocks an active activation whose version reference does not resolve for the pack', () => {
    const rows = makeRows()
    rows.KnowledgePackActivation[0].versionId = 'kpv-system-example-missing'

    const plan = buildKnowledgePackMetadataReconciliationPlan({
      manifest: makeManifest(),
      rowsByCollection: rows,
    })

    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'ACTIVE_ACTIVATION_VERSION_REFERENCE_INVALID',
      activationId: 'kpa-system-example-1-0-0-global',
      versionId: 'kpv-system-example-missing',
    }))
  })

  test('reports corrected enum values that the backend does not support', () => {
    const manifest = makeManifest({
      corrections: [
        {
          field: 'packType',
          from: 'SYSTEM',
          to: 'ET_RUNTIME',
          reason: 'Workbook correction',
        },
      ],
    })

    const plan = buildKnowledgePackMetadataReconciliationPlan({
      manifest,
      rowsByCollection: makeRows(),
    })

    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'MANIFEST_VALUE_UNSUPPORTED',
      field: 'packType',
      value: 'ET_RUNTIME',
    }))
  })

  test('blocks every pack type correction until the derived identity strategy is defined', () => {
    const manifest = makeManifest({
      corrections: [
        {
          field: 'packType',
          from: 'SYSTEM',
          to: 'ET',
          reason: 'Workbook correction',
        },
      ],
    })

    const plan = buildKnowledgePackMetadataReconciliationPlan({
      manifest,
      rowsByCollection: makeRows(),
    })

    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'PACK_TYPE_IDENTITY_STRATEGY_REQUIRED',
      currentPackType: 'SYSTEM',
      correctedPackType: 'ET',
    }))
  })

  test('blocks required Outcome Studio packs that would become non-provider context', () => {
    const packId = 'kp-arl-adaptive-reasoning-layer'
    const packKey = 'adaptive-reasoning-layer'
    const plan = buildKnowledgePackMetadataReconciliationPlan({
      manifest: makeManifest({ packId, packKey }),
      rowsByCollection: makeRows({ packId, packKey, packType: 'ARL' }),
    })

    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'REQUIRED_PACK_EXECUTION_CONFLICT',
      packId,
      correctedExecutionMode: 'SYSTEM_ONLY',
    }))
  })

  test('reports legacy manifest entries that embed metadata being corrected', () => {
    const rows = makeRows()
    rows.KnowledgePackManifest = [
      {
        manifestId: 'kpm-outcome-studio-default-1-0-0-global',
        manifestKey: 'outcome-studio-default',
        manifestName: 'Outcome Studio Default',
        status: 'ACTIVE',
        mandatoryPacks: [
          {
            packType: 'SYSTEM',
            packKey: 'example',
            executionMode: 'PROVIDER_CONTEXT',
          },
        ],
      },
    ]

    const plan = buildKnowledgePackMetadataReconciliationPlan({
      manifest: makeManifest(),
      rowsByCollection: rows,
    })

    expect(plan.summary).toEqual(expect.objectContaining({
      manifestsScanned: 1,
      manifestReferences: 1,
    }))
    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'MANIFEST_REFERENCE_REQUIRES_DECISION',
      manifestId: 'kpm-outcome-studio-default-1-0-0-global',
      section: 'mandatoryPacks',
      affectedFields: ['executionMode'],
    }))
  })

  test('blocks historical versions and activations until evidence-retention policy is defined', () => {
    const rows = makeRows()
    rows.KnowledgePackVersion.push({
      ...rows.KnowledgePackVersion[0],
      versionId: 'kpv-system-example-0-9-0-global',
      semanticVersion: '0.9.0',
      status: 'SUPERSEDED',
    })
    rows.KnowledgePackActivation.push({
      ...rows.KnowledgePackActivation[0],
      activationId: 'kpa-system-example-0-9-0-global',
      versionId: 'kpv-system-example-0-9-0-global',
      semanticVersion: '0.9.0',
      status: 'DEPRECATED',
    })

    const plan = buildKnowledgePackMetadataReconciliationPlan({
      manifest: makeManifest(),
      rowsByCollection: rows,
    })

    expect(plan.summary.historicalRecords).toBe(2)
    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'HISTORICAL_METADATA_POLICY_REQUIRED',
      records: expect.arrayContaining([
        expect.objectContaining({ reason: 'NOT_LATEST_VERSION' }),
        expect.objectContaining({ reason: 'NOT_ACTIVE_ACTIVATION' }),
      ]),
    }))
    expect(formatTextReport(plan)).toContain(
      '- HISTORICAL_METADATA_POLICY_REQUIRED: 2 historical records',
    )
  })

  test('detects projected identity collisions in all unique-indexed collections', () => {
    const manifest = makeManifest({
      corrections: [
        {
          field: 'packType',
          from: 'SYSTEM',
          to: 'TRUTH_CERTIFICATION',
          reason: 'Workbook correction',
        },
      ],
    })
    const rows = makeRows()
    rows.KnowledgePack.push({
      ...rows.KnowledgePack[0],
      packId: 'kp-truth-certification-example',
      packType: 'TRUTH_CERTIFICATION',
    })
    rows.KnowledgePackVersion.push({
      ...rows.KnowledgePackVersion[0],
      versionId: 'kpv-truth-certification-example-1-0-0-global',
      packId: 'kp-truth-certification-example',
      packType: 'TRUTH_CERTIFICATION',
    })
    rows.KnowledgePackActivation.push({
      ...rows.KnowledgePackActivation[0],
      activationId: 'kpa-truth-certification-example-1-0-0-global',
      versionId: 'kpv-truth-certification-example-1-0-0-global',
      packId: 'kp-truth-certification-example',
      packType: 'TRUTH_CERTIFICATION',
    })

    const plan = buildKnowledgePackMetadataReconciliationPlan({ manifest, rowsByCollection: rows })

    expect(plan.ok).toBe(false)
    expect(plan.collisions.map((collision) => collision.collectionKey)).toEqual([
      'KnowledgePack',
      'KnowledgePackVersion',
      'KnowledgePackActivation',
    ])
  })

  test('rejects every apply request after writing a read-only report and starts no write path', async () => {
    const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pack-apply-disabled-'))
    const connect = jest.fn(async () => {})
    const disconnect = jest.fn(async () => {})
    const startSession = jest.fn()
    const bulkWrite = jest.fn()
    try {
      await expect(reconcileKnowledgePackMetadata({
        apply: true,
        confirm: true,
        manifest: makeManifest(),
        reportDir,
        logger: jest.fn(),
        now: new Date('2026-07-14T12:00:00.000Z'),
        dependencies: {
          connect,
          disconnect,
          sourceCheck: { ok: true, code: 'SOURCE_HASH_MATCH' },
          rowsByCollection: makeRows(),
          startSession,
          models: {
            KnowledgePack: { collection: { bulkWrite } },
            KnowledgePackVersion: { collection: { bulkWrite } },
            KnowledgePackActivation: { collection: { bulkWrite } },
          },
        },
      })).rejects.toMatchObject({
        code: 'APPLY_NOT_ENABLED',
        details: {
          reportPath: expect.stringContaining('knowledge-pack-metadata-reconciliation-dry-run-'),
        },
      })

      expect(connect).toHaveBeenCalledTimes(1)
      expect(disconnect).toHaveBeenCalledTimes(1)
      expect(startSession).not.toHaveBeenCalled()
      expect(bulkWrite).not.toHaveBeenCalled()

      const reportFiles = await fs.readdir(reportDir)
      expect(reportFiles).toEqual([
        'knowledge-pack-metadata-reconciliation-dry-run-2026-07-14T12-00-00-000Z.json',
      ])
      const report = JSON.parse(await fs.readFile(path.join(reportDir, reportFiles[0]), 'utf8'))
      expect(report).toEqual(expect.objectContaining({
        mode: 'dry-run',
        requestedMode: 'apply',
        applyEnabled: false,
      }))
    } finally {
      await fs.rm(reportDir, { recursive: true, force: true })
    }
  })

  test('writes an operator-readable JSON report', async () => {
    const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pack-reconciliation-'))
    try {
      const plan = buildKnowledgePackMetadataReconciliationPlan({
        manifest: makeManifest(),
        rowsByCollection: makeRows(),
      })
      const reportPath = await writeReconciliationReport({
        report: plan,
        reportDir,
        now: new Date('2026-07-14T12:00:00.000Z'),
      })
      const persisted = JSON.parse(await fs.readFile(reportPath, 'utf8'))

      expect(path.basename(reportPath)).toBe(
        'knowledge-pack-metadata-reconciliation-dry-run-2026-07-14T12-00-00-000Z.json',
      )
      expect(persisted.summary.pendingFieldChanges).toBe(3)
    } finally {
      await fs.rm(reportDir, { recursive: true, force: true })
    }
  })
})
