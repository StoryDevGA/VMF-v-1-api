import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

import { connectDb, disconnectDb } from '../config/db.js'
import {
  OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS,
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
} from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_REVIEW_STATUSES,
} from '../constants/knowledgeRuntime.js'
import {
  AuditLog,
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackVersion,
} from '../models/index.js'
import { buildKnowledgePackVersionId } from '../models/KnowledgePackVersion.js'
import {
  activateOutcomeKnowledgePackVersion,
  importOutcomeKnowledgePackSourceDocumentDraft,
  updateOutcomeKnowledgePackVersionReview,
  validateOutcomeKnowledgePackVersion,
} from '../services/outcomeKnowledgePackRegistryService.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, '../../..')

export const SS005_RENDERING_CONFIRM_FLAG = '--confirm-ss005-rendering-layer-v1-0-1'
export const TARGET_SEMANTIC_VERSION = '1.0.1'
export const BASELINE_SEMANTIC_VERSION = '1.0.0'
export const PACK_TYPE = 'RL'
export const PACK_KEY = 'rendering-layer'
export const PACK_ID = 'kp-rl-rendering-layer'
export const KNOWLEDGE_ASSET_ID = 'QA-SS007-RL-RENDERING-LAYER'
export const BASELINE_CONTENT_HASH = 'sha256:19aa9523d207144f1c373c37372420226f33de542f03fc0d9d72e867b3ea484c'
export const PINNED_RAW_SHA256 = 'a0d194b8039e66259254e5491ae185bb1752ab2cb5fac7d0019e9afd11d6dc23'
export const PINNED_NORMALIZED_SHA256 = '02ead9f210ec1a7ad71e4099fa1d61ffa39cd203eb95e0ab26e77015f9f57e13'
export const SYSTEM_ACTOR_ID = '000000000000000000000001'
export const DEFAULT_SOURCE_PATH = path.resolve(
  workspaceRoot,
  'docs/product-specs/source-artifacts/2026-06-15-governed-outcome-studio-oes-002/knowledge-packs-v1/rendering-layer-v1.yaml',
)

const EXPECTED_AUDIT_ACTIONS = Object.freeze([
  'OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED',
  'OUTCOME_KNOWLEDGE_PACK_VERSION_VALIDATED',
  'KNOWLEDGE_PACK_REVIEW_STATUS_UPDATED',
  'OUTCOME_KNOWLEDGE_PACK_ACTIVATED',
])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLower = (value) => normalizeText(value).toLowerCase()
const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex')
const contentHash = (value) => `sha256:${sha256(value)}`
const createScriptError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}
const valuesEqual = (left, right) => JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
const sourceDocumentsProjection = (documents = []) => documents.map((document) => ({
  sourceDocumentId: normalizeText(document.sourceDocumentId),
  filename: normalizeText(document.filename),
  contentType: normalizeLower(document.contentType),
  fileExtension: normalizeLower(document.fileExtension),
  sourceHash: normalizeLower(document.sourceHash),
  sourceType: normalizeToken(document.sourceType),
}))

const packOwnershipProjection = (value = {}) => ({
  packId: normalizeText(value.packId),
  packCategory: normalizeToken(value.packCategory),
  purposeCategory: normalizeToken(value.purposeCategory),
  knowledgeLayer: normalizeToken(value.knowledgeLayer),
  capabilityKey: normalizeLower(value.capabilityKey),
  knowledgeAssetId: normalizeToken(value.knowledgeAssetId),
  workspaceCompatibility: (value.workspaceCompatibility || []).map(normalizeToken).sort(),
  packType: normalizeToken(value.packType),
  packKey: normalizeLower(value.packKey),
  sourceAuthority: normalizeText(value.sourceAuthority),
  executionMode: normalizeToken(value.executionMode),
  visibility: normalizeToken(value.visibility),
})

const EXPECTED_PACK_OWNERSHIP = Object.freeze({
  packId: PACK_ID,
  packCategory: 'OUTCOME',
  purposeCategory: 'SYSTEM',
  knowledgeLayer: 'COMMUNICATION_PATTERN',
  capabilityKey: 'rendering',
  knowledgeAssetId: KNOWLEDGE_ASSET_ID,
  workspaceCompatibility: ['OUTCOME'],
  packType: PACK_TYPE,
  packKey: PACK_KEY,
  sourceAuthority: 'StorylineOS Product and Architecture',
  executionMode: KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
  visibility: 'PLATFORM',
})

const versionProjection = (value = {}) => ({
  ...packOwnershipProjection(value),
  versionId: normalizeText(value.versionId),
  semanticVersion: normalizeText(value.semanticVersion),
  schemaVersion: normalizeText(value.schemaVersion),
  scopeType: normalizeToken(value.scopeType),
  scopeKey: normalizeToken(value.scopeKey),
  dependencyReferences: value.dependencyReferences || [],
  relationshipContractVersion: normalizeToken(value.relationshipContractVersion),
  relationshipChecksum: normalizeLower(value.relationshipChecksum),
  boundary: normalizeToken(value.boundary),
  contentHash: normalizeLower(value.contentHash),
  contentFormat: normalizeToken(value.contentFormat),
  sourceFilename: normalizeText(value.sourceFilename),
  sourceDocuments: sourceDocumentsProjection(value.sourceDocuments),
})

const buildSourceDocument = ({ normalizedSource, normalizedSha256 }) => ({
  sourceDocumentId: `kpsrc-${PACK_KEY}-${TARGET_SEMANTIC_VERSION.replace(/\./g, '-')}-${normalizedSha256.slice(0, 16)}`,
  filename: 'rendering-layer-v1.yaml',
  contentType: 'text/yaml',
  fileExtension: 'yaml',
  sourceHash: `sha256:${normalizedSha256}`,
  sourceType: 'SOURCE_DOCUMENT',
  sizeBytes: Buffer.byteLength(normalizedSource, 'utf8'),
})

export const buildRenderingLayerAsset = ({
  rawSource,
  expectedRawSha256 = PINNED_RAW_SHA256,
  expectedNormalizedSha256 = PINNED_NORMALIZED_SHA256,
} = {}) => {
  if (typeof rawSource !== 'string' || rawSource.length === 0) {
    throw createScriptError('SS005_RENDERING_SOURCE_EMPTY', 'The executable Rendering Layer source is empty.')
  }
  const rawSha256 = sha256(rawSource)
  const normalizedSource = normalizeText(rawSource)
  const normalizedSha256 = sha256(normalizedSource)
  if (rawSha256 !== expectedRawSha256 || normalizedSha256 !== expectedNormalizedSha256) {
    throw createScriptError('SS005_RENDERING_SOURCE_DRIFT', 'The Rendering Layer source does not match the pinned canonical digests.', {
      expectedRawSha256,
      observedRawSha256: rawSha256,
      expectedNormalizedSha256,
      observedNormalizedSha256: normalizedSha256,
    })
  }
  const sourceDocument = buildSourceDocument({ normalizedSource, normalizedSha256 })
  return {
    ...EXPECTED_PACK_OWNERSHIP,
    label: 'Rendering Layer',
    description: 'Mandatory Outcome Studio customer-safe post-generation rendering validation rules.',
    dependencyReferences: [],
    relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
    relationshipChecksum: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    semanticVersion: TARGET_SEMANTIC_VERSION,
    schemaVersion: BASELINE_SEMANTIC_VERSION,
    boundary: 'POST_GENERATION_VALIDATION',
    contentFormat: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML,
    extractedText: normalizedSource,
    rawSha256,
    normalizedSha256,
    contentHash: contentHash(normalizedSource),
    sourceDocument,
    sourceFilename: sourceDocument.filename,
    versionId: buildKnowledgePackVersionId({
      packType: PACK_TYPE,
      packKey: PACK_KEY,
      semanticVersion: TARGET_SEMANTIC_VERSION,
      scopeKey: 'GLOBAL',
    }),
    baselineVersionId: buildKnowledgePackVersionId({
      packType: PACK_TYPE,
      packKey: PACK_KEY,
      semanticVersion: BASELINE_SEMANTIC_VERSION,
      scopeKey: 'GLOBAL',
    }),
  }
}

export const buildRenderingLayerImportBody = (asset) => ({
  packType: asset.packType,
  packKey: asset.packKey,
  label: asset.label,
  description: asset.description,
  purposeCategory: asset.purposeCategory,
  knowledgeLayer: asset.knowledgeLayer,
  capabilityKey: asset.capabilityKey,
  knowledgeAssetId: asset.knowledgeAssetId,
  workspaceCompatibility: asset.workspaceCompatibility,
  dependencyReferences: asset.dependencyReferences,
  semanticVersion: asset.semanticVersion,
  schemaVersion: asset.schemaVersion,
  sourceAuthority: asset.sourceAuthority,
  executionMode: asset.executionMode,
  boundary: asset.boundary,
  visibility: asset.visibility,
  contentFormat: asset.contentFormat,
  sourceDocument: asset.sourceDocument,
  extractedText: asset.extractedText,
})

const expectedBaselineProjection = (asset) => ({
  ...EXPECTED_PACK_OWNERSHIP,
  versionId: asset.baselineVersionId,
  semanticVersion: BASELINE_SEMANTIC_VERSION,
  schemaVersion: BASELINE_SEMANTIC_VERSION,
  scopeType: 'GLOBAL',
  scopeKey: 'GLOBAL',
  dependencyReferences: [],
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: asset.relationshipChecksum,
  boundary: '',
  contentHash: BASELINE_CONTENT_HASH,
  contentFormat: 'MARKDOWN',
  sourceFilename: 'system-reference-rl-v2-9-source-derived-canonical-runtime.md',
  sourceDocuments: [{
    sourceDocumentId: 'kpsrc-rl-rendering-layer-1-0-0-19aa9523d207144f',
    filename: 'system-reference-rl-v2-9-source-derived-canonical-runtime.md',
    contentType: 'text/markdown',
    fileExtension: 'md',
    sourceHash: BASELINE_CONTENT_HASH,
    sourceType: 'SOURCE_DOCUMENT',
  }],
})

const expectedTargetProjection = (asset) => ({
  ...EXPECTED_PACK_OWNERSHIP,
  versionId: asset.versionId,
  semanticVersion: TARGET_SEMANTIC_VERSION,
  schemaVersion: BASELINE_SEMANTIC_VERSION,
  scopeType: 'GLOBAL',
  scopeKey: 'GLOBAL',
  dependencyReferences: [],
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: asset.relationshipChecksum,
  boundary: asset.boundary,
  contentHash: asset.contentHash,
  contentFormat: asset.contentFormat,
  sourceFilename: asset.sourceFilename,
  sourceDocuments: sourceDocumentsProjection([asset.sourceDocument]),
})

export const buildRenderingLayerVersionPlan = ({ asset, state }) => {
  const blockers = []
  if (!state.pack) blockers.push('PACK_NOT_FOUND')
  else if (!valuesEqual(packOwnershipProjection(state.pack), EXPECTED_PACK_OWNERSHIP)) blockers.push('PACK_OWNERSHIP_DRIFT')

  if (!state.baselineVersion) blockers.push('BASELINE_VERSION_NOT_FOUND')
  else if (!valuesEqual(versionProjection(state.baselineVersion), expectedBaselineProjection(asset))) blockers.push('BASELINE_VERSION_DRIFT')

  if (state.targetVersion) {
    const targetMatches = valuesEqual(versionProjection(state.targetVersion), expectedTargetProjection(asset))
      && normalizeText(state.targetVersion.content) === asset.extractedText
    if (!targetMatches) blockers.push('TARGET_VERSION_DRIFT')
  }

  const active = (state.activations || []).filter((activation) => (
    normalizeToken(activation.status) === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE
    && normalizeToken(activation.scopeKey) === 'GLOBAL'
  ))
  if (active.length > 1) blockers.push('ACTIVE_ACTIVATION_CARDINALITY_INVALID')
  const activeTarget = active.find((activation) => normalizeText(activation.versionId) === asset.versionId)

  if (blockers.length > 0) {
    return { ok: false, complete: false, actionsRequired: 0, blockers, targetVersionId: asset.versionId }
  }
  if (
    state.targetVersion
    && normalizeToken(state.targetVersion.status) === OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE
    && normalizeText(state.pack.latestVersionId) === asset.versionId
    && active.length === 1
    && activeTarget
  ) {
    return {
      ok: true,
      complete: true,
      actionsRequired: 0,
      blockers: [],
      targetVersionId: asset.versionId,
      activeVersionId: asset.versionId,
    }
  }

  if (!state.targetVersion) {
    return { ok: true, complete: false, actionsRequired: 1, blockers: [], nextAction: 'IMPORT', targetVersionId: asset.versionId }
  }
  const status = normalizeToken(state.targetVersion.status)
  const reviewStatus = normalizeToken(state.targetVersion.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT)
  if (status === OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT && reviewStatus === KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT) {
    return { ok: true, complete: false, actionsRequired: 1, blockers: [], nextAction: 'VALIDATE', targetVersionId: asset.versionId }
  }
  if (status === OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED) {
    if (reviewStatus === KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT) {
      return { ok: true, complete: false, actionsRequired: 1, blockers: [], nextAction: 'SUBMIT_FOR_REVIEW', targetVersionId: asset.versionId }
    }
    if (reviewStatus === KNOWLEDGE_PACK_REVIEW_STATUSES.READY_FOR_REVIEW) {
      return { ok: true, complete: false, actionsRequired: 1, blockers: [], nextAction: 'APPROVE', targetVersionId: asset.versionId }
    }
    if (reviewStatus === KNOWLEDGE_PACK_REVIEW_STATUSES.APPROVED) {
      return { ok: true, complete: false, actionsRequired: 1, blockers: [], nextAction: 'ACTIVATE', targetVersionId: asset.versionId }
    }
  }
  return {
    ok: false,
    complete: false,
    actionsRequired: 0,
    blockers: [`TARGET_LIFECYCLE_STATE_${status || 'MISSING'}_${reviewStatus || 'MISSING'}_UNSUPPORTED`],
    targetVersionId: asset.versionId,
  }
}

export const assertSs005RenderingWriteEnvironment = ({ databaseName, nodeEnv } = {}) => {
  const normalizedEnv = normalizeLower(nodeEnv)
  if (!['development', 'test'].includes(normalizedEnv) || databaseName !== 'test') {
    throw createScriptError(
      'SS005_RENDERING_WRITE_ENVIRONMENT_BLOCKED',
      `Refusing SS-005 Rendering Layer authoring in NODE_ENV=${normalizedEnv || '<missing>'}, database=${databaseName || '<missing>'}.`,
    )
  }
}

export const parseSs005RenderingArgs = (argv = process.argv.slice(2)) => {
  const digestIndex = argv.indexOf('--catalogue-sha256')
  return {
    apply: argv.includes('--apply'),
    confirm: argv.includes(SS005_RENDERING_CONFIRM_FLAG),
    json: argv.includes('--json'),
    catalogueSha256: normalizeLower(digestIndex >= 0 ? argv[digestIndex + 1] : ''),
  }
}

const resolveState = async ({ asset, models }) => {
  const [pack, baselineVersion, targetVersion, activations] = await Promise.all([
    models.KnowledgePack.findOne({ packId: asset.packId }).lean(),
    models.KnowledgePackVersion.findOne({ versionId: asset.baselineVersionId }).lean(),
    models.KnowledgePackVersion.findOne({ versionId: asset.versionId }).select('+content').lean(),
    models.KnowledgePackActivation.find({ packId: asset.packId }).sort({ activatedAt: -1 }).lean(),
  ])
  return { pack, baselineVersion, targetVersion, activations }
}

const executeAction = async ({ action, asset, services }) => {
  const common = { packId: asset.packId, versionId: asset.versionId, actorUserId: SYSTEM_ACTOR_ID }
  if (action === 'IMPORT') return services.importDraft({ body: buildRenderingLayerImportBody(asset), actorUserId: SYSTEM_ACTOR_ID })
  if (action === 'VALIDATE') return services.validate(common)
  if (action === 'SUBMIT_FOR_REVIEW') {
    return services.review({ ...common, body: { reviewStatus: KNOWLEDGE_PACK_REVIEW_STATUSES.READY_FOR_REVIEW } })
  }
  if (action === 'APPROVE') {
    return services.review({ ...common, body: { reviewStatus: KNOWLEDGE_PACK_REVIEW_STATUSES.APPROVED } })
  }
  if (action === 'ACTIVATE') return services.activate({ ...common, body: { scopeType: 'GLOBAL' } })
  throw createScriptError('SS005_RENDERING_ACTION_UNSUPPORTED', `Unsupported Rendering Layer authoring action: ${action}`)
}

export const convergeRenderingLayerVersion = async ({ asset, models, services, resolve = resolveState }) => {
  const actions = []
  for (let step = 0; step < 6; step += 1) {
    const state = await resolve({ asset, models })
    const plan = buildRenderingLayerVersionPlan({ asset, state })
    if (!plan.ok) throw createScriptError('SS005_RENDERING_PLAN_BLOCKED', 'Rendering Layer authoring plan is blocked.', plan)
    if (plan.complete) return { actions, readback: plan }
    actions.push(plan.nextAction)
    await executeAction({ action: plan.nextAction, asset, services })
  }
  throw createScriptError('SS005_RENDERING_CONVERGENCE_LIMIT', 'Rendering Layer lifecycle did not converge.')
}

export const reconcileAppliedState = async ({ asset, models, resolve = resolveState }) => {
  const state = await resolve({ asset, models })
  const plan = buildRenderingLayerVersionPlan({ asset, state })
  const active = state.activations.filter((activation) => normalizeToken(activation.status) === 'ACTIVE' && normalizeToken(activation.scopeKey) === 'GLOBAL')
  const priorActivation = state.activations.find((activation) => normalizeText(activation.versionId) === asset.baselineVersionId)
  const targetActivation = state.activations.find((activation) => normalizeText(activation.versionId) === asset.versionId)
  const audits = await models.AuditLog.find({
    action: { $in: EXPECTED_AUDIT_ACTIONS },
    'diff.versionId': asset.versionId,
  }).lean()
  const auditActions = audits.map((audit) => normalizeToken(audit.action))
  const failures = [
    ...(!plan.complete || plan.actionsRequired !== 0 ? ['POST_APPLY_PLAN_NOT_COMPLETE'] : []),
    ...(active.length !== 1 || normalizeText(active[0]?.versionId) !== asset.versionId ? ['ACTIVE_ACTIVATION_RECONCILIATION_FAILED'] : []),
    ...(normalizeText(targetActivation?.replacedActivationId) !== normalizeText(priorActivation?.activationId) ? ['ACTIVATION_REPLACEMENT_LINEAGE_MISSING'] : []),
    ...(normalizeToken(priorActivation?.status) !== 'ROLLED_BACK' || !priorActivation?.rolledBackAt || !normalizeText(priorActivation?.rollbackReason)
      ? ['BASELINE_ACTIVATION_ROLLBACK_EVIDENCE_MISSING']
      : []),
    ...(!EXPECTED_AUDIT_ACTIONS.every((action) => auditActions.includes(action)) ? ['LIFECYCLE_AUDIT_EVIDENCE_MISSING'] : []),
    ...(auditActions.filter((action) => action === 'KNOWLEDGE_PACK_REVIEW_STATUS_UPDATED').length < 2
      ? ['REVIEW_AUDIT_EVIDENCE_INCOMPLETE']
      : []),
  ]
  if (failures.length > 0) {
    throw createScriptError('SS005_RENDERING_RECONCILIATION_FAILED', 'Rendering Layer apply readback did not reconcile.', {
      failures,
      plan,
      auditActions,
    })
  }
  return {
    plan,
    activeActivationId: targetActivation.activationId,
    replacedActivationId: targetActivation.replacedActivationId,
    priorActivationStatus: priorActivation.status,
    auditActions,
  }
}

export const runSs005RenderingLayerAuthoring = async ({
  args = parseSs005RenderingArgs(),
  dependencies = {},
  logger = console.log,
  sourcePath = DEFAULT_SOURCE_PATH,
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const readFile = dependencies.readFile || fs.readFile
  const buildAsset = dependencies.buildAsset || buildRenderingLayerAsset
  const resolve = dependencies.resolveState || resolveState
  const models = dependencies.models || { AuditLog, KnowledgePack, KnowledgePackVersion, KnowledgePackActivation }
  const services = dependencies.services || {
    importDraft: importOutcomeKnowledgePackSourceDocumentDraft,
    validate: validateOutcomeKnowledgePackVersion,
    review: updateOutcomeKnowledgePackVersionReview,
    activate: activateOutcomeKnowledgePackVersion,
  }
  const rawSource = await readFile(sourcePath, 'utf8')
  const asset = buildAsset({ rawSource })
  await connect()
  try {
    const state = await resolve({ asset, models })
    const plan = buildRenderingLayerVersionPlan({ asset, state })
    let result = null
    let reconciliation = null
    if (args.apply) {
      if (!args.confirm || args.catalogueSha256 !== PINNED_RAW_SHA256) {
        throw createScriptError(
          'SS005_RENDERING_CONFIRMATION_REQUIRED',
          `Apply requires ${SS005_RENDERING_CONFIRM_FLAG} and --catalogue-sha256 ${PINNED_RAW_SHA256}.`,
        )
      }
      assertSs005RenderingWriteEnvironment({
        databaseName: dependencies.databaseName || mongoose.connection.name,
        nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
      })
      if (!plan.ok) throw createScriptError('SS005_RENDERING_PLAN_BLOCKED', 'Rendering Layer authoring plan is blocked.', plan)
      if (!plan.complete) result = await convergeRenderingLayerVersion({ asset, models, services, resolve })
      reconciliation = await reconcileAppliedState({ asset, models, resolve })
    }
    const report = {
      ok: plan.ok,
      mode: args.apply ? 'apply' : 'dry-run',
      databaseName: dependencies.databaseName || mongoose.connection.name,
      sourcePath,
      rawSha256: asset.rawSha256,
      normalizedSha256: asset.normalizedSha256,
      sourceContentHash: asset.contentHash,
      targetVersionId: asset.versionId,
      preservedBaselineVersionId: asset.baselineVersionId,
      applyContract: {
        confirmationFlag: SS005_RENDERING_CONFIRM_FLAG,
        catalogueSha256: PINNED_RAW_SHA256,
      },
      plan,
      ...(result ? { result } : {}),
      ...(reconciliation ? { reconciliation } : {}),
    }
    logger(args.json ? JSON.stringify(report, null, 2) : JSON.stringify(report))
    return report
  } finally {
    await disconnect()
  }
}

const isDirectExecution = () => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  runSs005RenderingLayerAuthoring().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error.code || 'SS005_RENDERING_AUTHORING_FAILED',
      message: error.message,
      details: error.details || {},
    }, null, 2))
    process.exitCode = 1
  })
}
