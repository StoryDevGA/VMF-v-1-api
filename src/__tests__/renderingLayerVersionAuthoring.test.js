import { jest } from '@jest/globals'

import {
  assertSs005RenderingWriteEnvironment,
  buildRenderingLayerAsset,
  buildRenderingLayerImportBody,
  buildRenderingLayerVersionPlan,
  convergeRenderingLayerVersion,
  parseSs005RenderingArgs,
  PINNED_RAW_SHA256,
  reconcileAppliedState,
  runSs005RenderingLayerAuthoring,
  SS005_RENDERING_CONFIRM_FLAG,
} from '../scripts/authorRenderingLayerExecutableVersionSs005.js'

const source = 'pack:\n  key: rendering-layer\nrendering_rules:\n  must_include:\n    - evidence boundaries\n'
const rawHash = '3936b7f0cdad45543f666fac28cc9d2b1bad9e8d1c3df1a46e575445d374ac19'
const normalizedHash = '1b1d68a3a5726b2d989180e9d1a96c2dacb93ee7ee2fe712ca05adfe15e1236d'

const buildAsset = () => buildRenderingLayerAsset({
  rawSource: source,
  expectedRawSha256: rawHash,
  expectedNormalizedSha256: normalizedHash,
})

const pack = (asset) => ({
  packId: asset.packId,
  packCategory: asset.packCategory,
  purposeCategory: asset.purposeCategory,
  knowledgeLayer: asset.knowledgeLayer,
  capabilityKey: asset.capabilityKey,
  knowledgeAssetId: asset.knowledgeAssetId,
  workspaceCompatibility: asset.workspaceCompatibility,
  packType: asset.packType,
  packKey: asset.packKey,
  sourceAuthority: asset.sourceAuthority,
  executionMode: asset.executionMode,
  visibility: asset.visibility,
  latestVersionId: asset.baselineVersionId,
})

const baseline = (asset) => ({
  ...pack(asset),
  versionId: asset.baselineVersionId,
  semanticVersion: '1.0.0',
  schemaVersion: '1.0.0',
  scopeType: 'GLOBAL',
  scopeKey: 'GLOBAL',
  dependencyReferences: [],
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: asset.relationshipChecksum,
  boundary: '',
  contentHash: 'sha256:19aa9523d207144f1c373c37372420226f33de542f03fc0d9d72e867b3ea484c',
  contentFormat: 'MARKDOWN',
  sourceFilename: 'system-reference-rl-v2-9-source-derived-canonical-runtime.md',
  sourceDocuments: [{
    sourceDocumentId: 'kpsrc-rl-rendering-layer-1-0-0-19aa9523d207144f',
    filename: 'system-reference-rl-v2-9-source-derived-canonical-runtime.md',
    contentType: 'text/markdown',
    fileExtension: 'md',
    sourceHash: 'sha256:19aa9523d207144f1c373c37372420226f33de542f03fc0d9d72e867b3ea484c',
    sourceType: 'SOURCE_DOCUMENT',
  }],
  status: 'ACTIVE',
})

const target = (asset, status = 'DRAFT', reviewStatus = 'DRAFT') => ({
  ...pack(asset),
  versionId: asset.versionId,
  semanticVersion: '1.0.1',
  schemaVersion: '1.0.0',
  scopeType: 'GLOBAL',
  scopeKey: 'GLOBAL',
  dependencyReferences: [],
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: asset.relationshipChecksum,
  boundary: 'POST_GENERATION_VALIDATION',
  contentHash: asset.contentHash,
  contentFormat: 'YAML',
  sourceFilename: asset.sourceFilename,
  sourceDocuments: [asset.sourceDocument],
  content: asset.extractedText,
  status,
  reviewStatus,
})

const state = (asset, overrides = {}) => ({
  pack: pack(asset),
  baselineVersion: baseline(asset),
  targetVersion: null,
  activations: [{ versionId: asset.baselineVersionId, status: 'ACTIVE', scopeKey: 'GLOBAL' }],
  ...overrides,
})

const completeState = (asset, overrides = {}) => state(asset, {
  pack: { ...pack(asset), latestVersionId: asset.versionId },
  targetVersion: target(asset, 'ACTIVE', 'APPROVED'),
  activations: [
    {
      activationId: 'baseline-activation',
      versionId: asset.baselineVersionId,
      status: 'ROLLED_BACK',
      scopeKey: 'GLOBAL',
      rolledBackAt: new Date('2026-08-12T12:00:00.000Z'),
      rollbackReason: 'Superseded by target-activation',
    },
    {
      activationId: 'target-activation',
      versionId: asset.versionId,
      status: 'ACTIVE',
      scopeKey: 'GLOBAL',
      replacedActivationId: 'baseline-activation',
    },
  ],
  ...overrides,
})

const auditRows = () => [
  { action: 'OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED' },
  { action: 'OUTCOME_KNOWLEDGE_PACK_VERSION_VALIDATED' },
  { action: 'KNOWLEDGE_PACK_REVIEW_STATUS_UPDATED' },
  { action: 'KNOWLEDGE_PACK_REVIEW_STATUS_UPDATED' },
  { action: 'OUTCOME_KNOWLEDGE_PACK_ACTIVATED' },
]

const auditModel = (rows = auditRows()) => ({
  find: jest.fn(() => ({ lean: jest.fn(async () => rows) })),
})

const lifecycleServices = () => ({
  importDraft: jest.fn(async () => undefined),
  validate: jest.fn(async () => undefined),
  review: jest.fn(async () => undefined),
  activate: jest.fn(async () => undefined),
})

const runDependencies = ({ asset, currentState, services = lifecycleServices(), overrides = {} }) => ({
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
  readFile: jest.fn(async () => source),
  buildAsset: jest.fn(() => asset),
  resolveState: jest.fn(async () => currentState),
  models: { AuditLog: auditModel() },
  services,
  databaseName: 'test',
  nodeEnv: 'development',
  ...overrides,
})

describe('SS-005 executable Rendering Layer authoring', () => {
  test('builds the immutable target identity and exact inherited import contract', () => {
    const asset = buildAsset()
    const body = buildRenderingLayerImportBody(asset)

    expect(asset.versionId).toBe('kpv-rl-rendering-layer-1-0-1-global')
    expect(asset.baselineVersionId).toBe('kpv-rl-rendering-layer-1-0-0-global')
    expect(body).toEqual(expect.objectContaining({
      knowledgeLayer: 'COMMUNICATION_PATTERN',
      capabilityKey: 'rendering',
      knowledgeAssetId: 'QA-SS007-RL-RENDERING-LAYER',
      executionMode: 'PROVIDER_CONTEXT',
      boundary: 'POST_GENERATION_VALIDATION',
      contentFormat: 'YAML',
    }))
  })

  test('rejects source drift against the pinned digests', () => {
    expect(() => buildRenderingLayerAsset({ rawSource: source })).toThrow('pinned canonical digests')
  })

  test.each([
    [null, 'IMPORT'],
    [target(buildAsset(), 'DRAFT', 'DRAFT'), 'VALIDATE'],
    [target(buildAsset(), 'VALIDATED', 'DRAFT'), 'SUBMIT_FOR_REVIEW'],
    [target(buildAsset(), 'VALIDATED', 'READY_FOR_REVIEW'), 'APPROVE'],
    [target(buildAsset(), 'VALIDATED', 'APPROVED'), 'ACTIVATE'],
  ])('resumes from the supported lifecycle state %#', (targetVersion, nextAction) => {
    const asset = buildAsset()
    const plan = buildRenderingLayerVersionPlan({ asset, state: state(asset, { targetVersion }) })

    expect(plan).toEqual(expect.objectContaining({ ok: true, complete: false, nextAction }))
  })

  test('reports complete only for the sole active target with pack latest aligned', () => {
    const asset = buildAsset()
    const plan = buildRenderingLayerVersionPlan({
      asset,
      state: state(asset, {
        pack: { ...pack(asset), latestVersionId: asset.versionId },
        targetVersion: target(asset, 'ACTIVE', 'APPROVED'),
        activations: [
          { versionId: asset.baselineVersionId, status: 'ROLLED_BACK', scopeKey: 'GLOBAL' },
          { versionId: asset.versionId, status: 'ACTIVE', scopeKey: 'GLOBAL' },
        ],
      }),
    })

    expect(plan).toEqual(expect.objectContaining({ ok: true, complete: true, actionsRequired: 0 }))
  })

  test.each([
    ['pack ownership', (asset) => state(asset, { pack: { ...pack(asset), capabilityKey: 'drift' } }), 'PACK_OWNERSHIP_DRIFT'],
    ['baseline', (asset) => state(asset, { baselineVersion: { ...baseline(asset), contentHash: 'sha256:drift' } }), 'BASELINE_VERSION_DRIFT'],
    ['target metadata', (asset) => state(asset, { targetVersion: { ...target(asset), boundary: 'GENERATION_CONTEXT' } }), 'TARGET_VERSION_DRIFT'],
    ['target content', (asset) => state(asset, { targetVersion: { ...target(asset), content: 'drift' } }), 'TARGET_VERSION_DRIFT'],
    ['activation cardinality', (asset) => state(asset, { activations: [
      { versionId: asset.baselineVersionId, status: 'ACTIVE', scopeKey: 'GLOBAL' },
      { versionId: asset.versionId, status: 'ACTIVE', scopeKey: 'GLOBAL' },
    ] }), 'ACTIVE_ACTIVATION_CARDINALITY_INVALID'],
  ])('fails closed for %s drift', (_label, buildState, blocker) => {
    const asset = buildAsset()
    const plan = buildRenderingLayerVersionPlan({ asset, state: buildState(asset) })

    expect(plan.ok).toBe(false)
    expect(plan.blockers).toContain(blocker)
  })

  test('rejects unsupported lifecycle states and unsafe write environments', () => {
    const asset = buildAsset()
    const plan = buildRenderingLayerVersionPlan({
      asset,
      state: state(asset, { targetVersion: target(asset, 'DEPRECATED', 'APPROVED') }),
    })

    expect(plan.ok).toBe(false)
    expect(plan.blockers[0]).toMatch(/TARGET_LIFECYCLE_STATE/)
    expect(() => assertSs005RenderingWriteEnvironment({ databaseName: 'production', nodeEnv: 'production' }))
      .toThrow('Refusing SS-005 Rendering Layer authoring')
    expect(() => assertSs005RenderingWriteEnvironment({ databaseName: 'test', nodeEnv: 'development' })).not.toThrow()
  })

  test('parses the explicit apply confirmation contract', () => {
    expect(parseSs005RenderingArgs([
      '--apply',
      SS005_RENDERING_CONFIRM_FLAG,
      '--catalogue-sha256',
      PINNED_RAW_SHA256,
      '--json',
    ])).toEqual({ apply: true, confirm: true, json: true, catalogueSha256: PINNED_RAW_SHA256 })
  })

  test('dry run reports the apply contract and never invokes lifecycle writes', async () => {
    const asset = buildAsset()
    const services = lifecycleServices()
    const dependencies = runDependencies({ asset, currentState: state(asset), services })

    const report = await runSs005RenderingLayerAuthoring({
      args: { apply: false, confirm: false, json: true, catalogueSha256: '' },
      dependencies,
      logger: jest.fn(),
    })

    expect(report).toEqual(expect.objectContaining({
      mode: 'dry-run',
      applyContract: {
        confirmationFlag: SS005_RENDERING_CONFIRM_FLAG,
        catalogueSha256: PINNED_RAW_SHA256,
      },
      plan: expect.objectContaining({ nextAction: 'IMPORT' }),
    }))
    expect(services.importDraft).not.toHaveBeenCalled()
    expect(services.validate).not.toHaveBeenCalled()
    expect(services.review).not.toHaveBeenCalled()
    expect(services.activate).not.toHaveBeenCalled()
    expect(dependencies.disconnect).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['missing confirmation', { confirm: false, catalogueSha256: PINNED_RAW_SHA256 }, {}],
    ['wrong digest', { confirm: true, catalogueSha256: 'wrong' }, {}],
    ['production environment', { confirm: true, catalogueSha256: PINNED_RAW_SHA256 }, { nodeEnv: 'production' }],
    ['wrong database', { confirm: true, catalogueSha256: PINNED_RAW_SHA256 }, { databaseName: 'other' }],
  ])('apply guard rejects %s before every lifecycle write', async (_label, args, overrides) => {
    const asset = buildAsset()
    const services = lifecycleServices()
    const dependencies = runDependencies({ asset, currentState: state(asset), services, overrides })

    await expect(runSs005RenderingLayerAuthoring({
      args: { apply: true, json: true, ...args },
      dependencies,
      logger: jest.fn(),
    })).rejects.toThrow()

    expect(services.importDraft).not.toHaveBeenCalled()
    expect(services.validate).not.toHaveBeenCalled()
    expect(services.review).not.toHaveBeenCalled()
    expect(services.activate).not.toHaveBeenCalled()
    expect(dependencies.disconnect).toHaveBeenCalledTimes(1)
  })

  test('convergence rereads state and executes each supported lifecycle transition once', async () => {
    const asset = buildAsset()
    const services = lifecycleServices()
    const states = [
      state(asset),
      state(asset, { targetVersion: target(asset, 'DRAFT', 'DRAFT') }),
      state(asset, { targetVersion: target(asset, 'VALIDATED', 'DRAFT') }),
      state(asset, { targetVersion: target(asset, 'VALIDATED', 'READY_FOR_REVIEW') }),
      state(asset, { targetVersion: target(asset, 'VALIDATED', 'APPROVED') }),
      completeState(asset),
    ]
    const resolve = jest.fn(async () => states.shift())

    const result = await convergeRenderingLayerVersion({ asset, models: {}, services, resolve })

    expect(result.actions).toEqual(['IMPORT', 'VALIDATE', 'SUBMIT_FOR_REVIEW', 'APPROVE', 'ACTIVATE'])
    expect(resolve).toHaveBeenCalledTimes(6)
    expect(services.importDraft).toHaveBeenCalledTimes(1)
    expect(services.validate).toHaveBeenCalledTimes(1)
    expect(services.review).toHaveBeenCalledTimes(2)
    expect(services.activate).toHaveBeenCalledTimes(1)
  })

  test('post-apply reconciliation accepts complete lifecycle, lineage, rollback, and audit evidence', async () => {
    const asset = buildAsset()
    const result = await reconcileAppliedState({
      asset,
      models: { AuditLog: auditModel() },
      resolve: jest.fn(async () => completeState(asset)),
    })

    expect(result).toEqual(expect.objectContaining({
      activeActivationId: 'target-activation',
      replacedActivationId: 'baseline-activation',
      priorActivationStatus: 'ROLLED_BACK',
      plan: expect.objectContaining({ complete: true, actionsRequired: 0 }),
    }))
  })

  test.each([
    ['final plan', (asset) => state(asset, { targetVersion: target(asset, 'VALIDATED', 'APPROVED') }), auditRows()],
    ['replacement lineage', (asset) => completeState(asset, { activations: completeState(asset).activations.map((item) => (
      item.versionId === asset.versionId ? { ...item, replacedActivationId: 'wrong' } : item
    )) }), auditRows()],
    ['rollback evidence', (asset) => completeState(asset, { activations: completeState(asset).activations.map((item) => (
      item.versionId === asset.baselineVersionId ? { ...item, rolledBackAt: null } : item
    )) }), auditRows()],
    ['audit evidence', (asset) => completeState(asset), [{ action: 'OUTCOME_KNOWLEDGE_PACK_ACTIVATED' }]],
    ['second review audit', (asset) => completeState(asset), auditRows().filter((row, index) => row.action !== 'KNOWLEDGE_PACK_REVIEW_STATUS_UPDATED' || index === 2)],
  ])('post-apply reconciliation rejects missing %s evidence', async (_label, buildState, audits) => {
    const asset = buildAsset()
    await expect(reconcileAppliedState({
      asset,
      models: { AuditLog: auditModel(audits) },
      resolve: jest.fn(async () => buildState(asset)),
    })).rejects.toMatchObject({ code: 'SS005_RENDERING_RECONCILIATION_FAILED' })
  })

  test('run propagates reconciliation failure and disconnects instead of reporting completion', async () => {
    const asset = buildAsset()
    const dependencies = runDependencies({
      asset,
      currentState: completeState(asset),
      overrides: { models: { AuditLog: auditModel([]) } },
    })

    await expect(runSs005RenderingLayerAuthoring({
      args: { apply: true, confirm: true, json: true, catalogueSha256: PINNED_RAW_SHA256 },
      dependencies,
      logger: jest.fn(),
    })).rejects.toMatchObject({ code: 'SS005_RENDERING_RECONCILIATION_FAILED' })
    expect(dependencies.disconnect).toHaveBeenCalledTimes(1)
  })
})
