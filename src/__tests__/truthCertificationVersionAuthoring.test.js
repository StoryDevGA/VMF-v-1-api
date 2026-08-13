import KnowledgePackActivation from '../models/KnowledgePackActivation.js'
import {
  assertSs005WriteEnvironment,
  buildExecutableAsset,
  buildExecutableImportBody,
  buildExecutableVersionPlan,
  parseSs005Args,
  SS005_CONFIRM_FLAG,
} from '../scripts/authorTruthCertificationExecutableVersionSs005.js'

const source = `pack:\n  key: truth-certification-pack\nblocking_rules:\n  - key: MISSING_LOCK_PROOF\n    outcome: BLOCK\n`

describe('SS-005 executable Truth Certification authoring', () => {
  test('builds an immutable target identity and YAML import body from the canonical source', () => {
    const asset = buildExecutableAsset({ extractedText: source })
    const body = buildExecutableImportBody(asset)

    expect(asset.versionId).toBe('kpv-truth-certification-truth-certification-pack-1-0-1-global')
    expect(asset.baselineVersionId).toBe('kpv-truth-certification-truth-certification-pack-1-0-0-global')
    expect(asset.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(body.contentFormat).toBe('YAML')
    expect(body.executionMode).toBe('POST_VALIDATION')
    expect(body).not.toHaveProperty('capabilityKey')
    expect(body.extractedText).toBe(source.trim())
  })

  test('plans import and later lifecycle actions without treating the preserved baseline as mutable', () => {
    const asset = buildExecutableAsset({ extractedText: source })
    const plan = buildExecutableVersionPlan({
      asset,
      state: {
        pack: { packId: asset.packId },
        baselineVersion: { versionId: asset.baselineVersionId, contentHash: 'sha256:53a19b91ea6eac60998246f1073071408be0f989b50f507f832a60ec18abdc03' },
        targetVersion: null,
        activations: [{ versionId: asset.baselineVersionId, status: 'ACTIVE' }],
      },
    })

    expect(plan).toEqual(expect.objectContaining({
      ok: true,
      complete: false,
      nextAction: 'IMPORT',
      preservedBaselineVersionId: asset.baselineVersionId,
    }))
  })

  test('fails closed for baseline drift and unsafe write environments', () => {
    const asset = buildExecutableAsset({ extractedText: source })
    const plan = buildExecutableVersionPlan({
      asset,
      state: {
        pack: { packId: asset.packId },
        baselineVersion: { versionId: asset.baselineVersionId, contentHash: 'sha256:drift' },
        targetVersion: null,
        activations: [],
      },
    })

    expect(plan.blockers).toContain('BASELINE_CONTENT_DRIFT')
    expect(() => assertSs005WriteEnvironment({ databaseName: 'production', nodeEnv: 'production' }))
      .toThrow('Refusing SS-005 Truth Certification authoring')
    expect(() => assertSs005WriteEnvironment({ databaseName: 'test', nodeEnv: 'development' })).not.toThrow()
  })

  test('parses the explicit apply confirmation contract', () => {
    expect(parseSs005Args(['--apply', SS005_CONFIRM_FLAG, '--catalogue-sha256', 'abc', '--json']))
      .toEqual({ apply: true, confirm: true, json: true, catalogueSha256: 'abc' })
  })
})

describe('Truth Certification activation governance boundary', () => {
  test('permits a validation activation without a provider capability key', async () => {
    const activation = new KnowledgePackActivation({
      activationId: 'kpa-truth-certification-test',
      packId: 'kp-truth-certification-truth-certification-pack',
      versionId: 'kpv-truth-certification-truth-certification-pack-1-0-1-global',
      packType: 'TRUTH_CERTIFICATION',
      packKey: 'truth-certification-pack',
      knowledgeLayer: 'VALIDATION',
      knowledgeAssetId: 'QA-SS002-TRUTH-CERTIFICATION-PACK',
      workspaceCompatibility: ['OUTCOME'],
      relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
      relationshipChecksum: 'checksum',
      semanticVersion: '1.0.1',
      scopeType: 'GLOBAL',
      scopeKey: 'GLOBAL',
      executionMode: 'POST_VALIDATION',
      visibility: 'PLATFORM',
      contentHash: 'sha256:truth',
      status: 'ACTIVE',
    })

    await expect(activation.validate()).resolves.toBeUndefined()
  })

  test('continues to require a capability key for provider-bound active packs', async () => {
    const activation = new KnowledgePackActivation({
      activationId: 'kpa-output-schema-test',
      packId: 'kp-output-schema-test',
      versionId: 'kpv-output-schema-test-1-0-1-global',
      packType: 'OUTPUT_SCHEMA',
      packKey: 'output-schema-test',
      knowledgeLayer: 'OUTPUT_SCHEMA',
      knowledgeAssetId: 'QA-OUTPUT-SCHEMA-TEST',
      workspaceCompatibility: ['OUTCOME'],
      relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
      relationshipChecksum: 'checksum',
      semanticVersion: '1.0.1',
      scopeType: 'GLOBAL',
      scopeKey: 'GLOBAL',
      executionMode: 'PROVIDER_CONTEXT',
      visibility: 'PLATFORM',
      contentHash: 'sha256:output',
      status: 'ACTIVE',
    })

    await expect(activation.validate()).rejects.toThrow(/capabilityKey/)
  })
})
