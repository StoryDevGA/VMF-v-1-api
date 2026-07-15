import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

import { connectDb, disconnectDb } from '../config/db.js'
import {
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_REVIEW_STATUSES,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
} from '../constants/outcomeKnowledgePacks.js'
import { KnowledgePack, KnowledgePackActivation, KnowledgePackVersion } from '../models/index.js'
import { buildKnowledgePackId } from '../models/KnowledgePack.js'
import { buildKnowledgePackVersionId } from '../models/KnowledgePackVersion.js'
import {
  activateOutcomeKnowledgePackVersion,
  importOutcomeKnowledgePackSourceDocumentDraft,
  updateOutcomeKnowledgePackVersionReview,
  validateOutcomeKnowledgePackVersion,
} from '../services/outcomeKnowledgePackRegistryService.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, '../../..')

export const V1_ASSET_CONFIRM_FLAG = '--confirm-dev-kp004-v1-assets'
export const DEFAULT_V1_ASSET_SOURCE_DIR = path.resolve(
  workspaceRoot,
  'docs/product-specs/source-artifacts/2026-07-14-kp-004-dynamic-knowledge-resolution-duplicate-governance/v1-authored-assets',
)
const SYSTEM_ACTOR_ID = '000000000000000000000001'
const SEMANTIC_VERSION = '1.0.0'
const SOURCE_AUTHORITY = 'StorylineOS Product and Architecture'

const outputDependencies = (schemaPackKey, styleCapabilityKey) => [
  {
    knowledgeLayer: 'OUTPUT_SCHEMA',
    requirement: 'REQUIRED',
    packType: 'OUTPUT_SCHEMA',
    packKey: schemaPackKey,
  },
  {
    knowledgeLayer: 'STYLE',
    requirement: 'REQUIRED',
    capabilityKey: styleCapabilityKey,
  },
]

const truthDependencies = [
  'blocking-rules',
  'certification-levels',
  'export-metadata-rules',
  'prohibited-output-claims',
  'runtime-warning-rules',
  'truth-certification-framework',
  'truth-quality-dimensions',
].map((packKey) => ({
  knowledgeLayer: 'VALIDATION',
  requirement: 'REQUIRED',
  packType: 'TRUTH_CERTIFICATION',
  packKey,
}))

export const V1_KNOWLEDGE_ASSET_DEFINITIONS = Object.freeze([
  {
    packType: 'OUTPUT_TYPE_DEFINITION',
    packKey: 'executive-brief',
    label: 'Executive Brief',
    description: 'Governed Outcome Studio output definition for executive briefs.',
    purposeCategory: 'OUTPUT',
    knowledgeLayer: 'OUTPUT_TYPE',
    capabilityKey: 'executive-brief',
    executionMode: KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
    filename: 'executive-brief.md',
    dependencyReferences: outputDependencies('executive-brief-schema', 'executive-brief-style'),
  },
  {
    packType: 'OUTPUT_TYPE_DEFINITION',
    packKey: 'sales-narrative',
    label: 'Sales Narrative',
    description: 'Governed Outcome Studio output definition for customer sales narratives.',
    purposeCategory: 'OUTPUT',
    knowledgeLayer: 'OUTPUT_TYPE',
    capabilityKey: 'sales-narrative',
    executionMode: KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
    filename: 'sales-narrative.md',
    dependencyReferences: outputDependencies('sales-narrative-schema', 'customer-value-narrative-style'),
  },
  {
    packType: 'OUTPUT_TYPE_DEFINITION',
    packKey: 'commercial-assessment',
    label: 'Commercial Assessment',
    description: 'Governed Outcome Studio output definition for commercial assessments.',
    purposeCategory: 'OUTPUT',
    knowledgeLayer: 'OUTPUT_TYPE',
    capabilityKey: 'commercial-assessment',
    executionMode: KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
    filename: 'commercial-assessment.md',
    dependencyReferences: outputDependencies('commercial-assessment-schema', 'commercial-assessment-style'),
  },
  {
    packType: 'OUTPUT_TYPE_DEFINITION',
    packKey: 'board-summary',
    label: 'Board Summary',
    description: 'Governed Outcome Studio output definition for board-level summaries.',
    purposeCategory: 'OUTPUT',
    knowledgeLayer: 'OUTPUT_TYPE',
    capabilityKey: 'board-summary',
    executionMode: KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
    filename: 'board-summary.md',
    dependencyReferences: outputDependencies('board-summary-schema', 'board-executive-style'),
  },
  {
    packType: 'STYLE',
    packKey: 'commercial-assessment-style',
    label: 'Commercial Assessment Style',
    description: 'Governed communication style for evidence-led commercial assessments.',
    purposeCategory: 'STYLE',
    knowledgeLayer: 'STYLE',
    capabilityKey: 'commercial-assessment-style',
    executionMode: KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
    filename: 'commercial-assessment-style.md',
    dependencyReferences: [],
  },
  {
    packType: 'TRUTH_CERTIFICATION',
    packKey: 'truth-certification-pack',
    label: 'Truth Certification Pack',
    description: 'Mandatory Outcome Studio post-validation umbrella for Truth Certification.',
    purposeCategory: 'VALIDATION',
    knowledgeLayer: 'VALIDATION',
    capabilityKey: '',
    executionMode: KNOWLEDGE_PACK_EXECUTION_MODES.POST_VALIDATION,
    filename: 'truth-certification-pack.md',
    dependencyReferences: truthDependencies,
  },
])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex').toUpperCase()
const contentHash = (value) => `sha256:${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`

const createScriptError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

export const loadV1KnowledgeAssets = async (
  sourceDir = DEFAULT_V1_ASSET_SOURCE_DIR,
) => Promise.all(V1_KNOWLEDGE_ASSET_DEFINITIONS.map(async (definition) => {
  const sourcePath = path.resolve(sourceDir, definition.filename)
  const extractedText = normalizeText(await fs.readFile(sourcePath, 'utf8'))
  if (!extractedText) {
    throw createScriptError('V1_ASSET_SOURCE_EMPTY', `Source document is empty: ${sourcePath}`)
  }
  return {
    ...definition,
    extractedText,
    sourcePath,
    packId: buildKnowledgePackId(definition),
    versionId: buildKnowledgePackVersionId({
      packType: definition.packType,
      packKey: definition.packKey,
      semanticVersion: SEMANTIC_VERSION,
      scopeKey: 'GLOBAL',
    }),
    expectedContentHash: contentHash(extractedText),
  }
}))

export const buildV1AssetCatalogueDigest = (assets) => sha256(JSON.stringify(
  assets.map(({ extractedText, sourcePath, ...asset }) => ({
    ...asset,
    sourceSha256: sha256(extractedText),
  })),
))

const resolveAssetState = async (asset, models) => {
  const pack = await models.KnowledgePack.findOne({ packId: asset.packId }).lean()
  const version = await models.KnowledgePackVersion.findOne({ versionId: asset.versionId }).lean()
  const activations = await models.KnowledgePackActivation.find({
    packId: asset.packId,
    status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
  }).lean()
  return { pack, version, activations }
}

const governanceMatches = (row, asset, includeDependencies) => {
  if (!row) return false
  const baseMatches = normalizeToken(row.knowledgeLayer) === asset.knowledgeLayer
    && normalizeLowerKey(row.capabilityKey) === normalizeLowerKey(asset.capabilityKey)
    && JSON.stringify([...(row.workspaceCompatibility || [])].sort()) === JSON.stringify(['OUTCOME'])
  if (!baseMatches || !includeDependencies) return baseMatches
  return JSON.stringify(row.dependencyReferences || []) === JSON.stringify(asset.dependencyReferences)
}

export const planV1Asset = ({ asset, state }) => {
  const { pack, version, activations } = state
  if (!pack && !version && activations.length === 0) return { action: 'IMPORT' }
  if (!pack || !version) return { blocker: 'PARTIAL_ASSET_RECORDS' }
  if (normalizeText(version.contentHash) !== asset.expectedContentHash) {
    return { blocker: 'SOURCE_CONTENT_DRIFT' }
  }
  if (!governanceMatches(pack, asset, false) || !governanceMatches(version, asset, true)) {
    return { blocker: 'GOVERNANCE_METADATA_DRIFT' }
  }

  const status = normalizeToken(version.status)
  const reviewStatus = normalizeToken(version.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT)
  if (status === OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT) return { action: 'VALIDATE' }
  if (status === OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED) {
    if (reviewStatus === KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT) return { action: 'SUBMIT_FOR_REVIEW' }
    if (reviewStatus === KNOWLEDGE_PACK_REVIEW_STATUSES.READY_FOR_REVIEW) return { action: 'APPROVE' }
    if (reviewStatus === KNOWLEDGE_PACK_REVIEW_STATUSES.APPROVED) return { action: 'ACTIVATE' }
    return { blocker: 'REVIEW_STATE_UNSUPPORTED' }
  }
  if (status === OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE) {
    if (activations.length !== 1) return { blocker: 'ACTIVE_ACTIVATION_CARDINALITY_INVALID' }
    if (!governanceMatches(activations[0], asset, true)) {
      return { blocker: 'ACTIVATION_GOVERNANCE_DRIFT' }
    }
    return { complete: true }
  }
  return { blocker: `LIFECYCLE_STATE_${status || 'MISSING'}_UNSUPPORTED` }
}

export const buildV1AssetPlan = async ({ assets, models }) => {
  const rows = []
  for (const asset of assets) {
    const state = await resolveAssetState(asset, models)
    rows.push({
      packType: asset.packType,
      packKey: asset.packKey,
      packId: asset.packId,
      versionId: asset.versionId,
      ...planV1Asset({ asset, state }),
    })
  }
  return {
    ok: rows.every((row) => !row.blocker),
    complete: rows.every((row) => row.complete === true),
    actionsRequired: rows.filter((row) => row.action).length,
    blockers: rows.filter((row) => row.blocker),
    assets: rows,
  }
}

export const assertV1AssetWriteEnvironment = ({ databaseName, nodeEnv }) => {
  const normalizedEnv = normalizeText(nodeEnv).toLowerCase()
  // This one-off V1 catalogue authoring path is intentionally narrower than reusable
  // governance migration policy: it may only converge the shared dev/test database.
  if (normalizedEnv === 'production' || !['development', 'test'].includes(normalizedEnv) || databaseName !== 'test') {
    throw createScriptError(
      'V1_ASSET_ENVIRONMENT_BLOCKED',
      `Refusing V1 Knowledge Asset authoring in NODE_ENV=${normalizedEnv || '<missing>'}, database=${databaseName || '<missing>'}.`,
    )
  }
}

const buildImportBody = (asset) => ({
  packType: asset.packType,
  packKey: asset.packKey,
  label: asset.label,
  description: asset.description,
  purposeCategory: asset.purposeCategory,
  knowledgeLayer: asset.knowledgeLayer,
  ...(asset.capabilityKey ? { capabilityKey: asset.capabilityKey } : {}),
  workspaceCompatibility: ['OUTCOME'],
  dependencyReferences: asset.dependencyReferences,
  semanticVersion: SEMANTIC_VERSION,
  schemaVersion: SEMANTIC_VERSION,
  sourceAuthority: SOURCE_AUTHORITY,
  executionMode: asset.executionMode,
  visibility: 'PLATFORM',
  contentFormat: 'MARKDOWN',
  sourceDocument: {
    filename: asset.filename,
    contentType: 'text/markdown',
    fileExtension: 'md',
    sizeBytes: Buffer.byteLength(asset.extractedText, 'utf8'),
  },
  extractedText: asset.extractedText,
})

const executeAssetAction = async ({ action, asset, services }) => {
  const common = { packId: asset.packId, versionId: asset.versionId, actorUserId: SYSTEM_ACTOR_ID }
  if (action === 'IMPORT') {
    await services.importDraft({ body: buildImportBody(asset), actorUserId: SYSTEM_ACTOR_ID })
    return
  }
  if (action === 'VALIDATE') {
    await services.validate(common)
    return
  }
  if (action === 'SUBMIT_FOR_REVIEW') {
    await services.review({ ...common, body: { reviewStatus: 'READY_FOR_REVIEW' } })
    return
  }
  if (action === 'APPROVE') {
    await services.review({ ...common, body: { reviewStatus: 'APPROVED' } })
    return
  }
  if (action === 'ACTIVATE') {
    await services.activate({ ...common, body: { scopeType: 'GLOBAL' } })
    return
  }
  throw createScriptError('V1_ASSET_ACTION_UNSUPPORTED', `Unsupported authoring action: ${action}`)
}

export const convergeV1KnowledgeAssets = async ({ assets, models, services }) => {
  const actions = []
  for (const asset of assets) {
    for (let step = 0; step < 6; step += 1) {
      const state = await resolveAssetState(asset, models)
      const plan = planV1Asset({ asset, state })
      if (plan.blocker) {
        throw createScriptError('V1_ASSET_CONVERGENCE_BLOCKED', `Cannot converge ${asset.packKey}: ${plan.blocker}`)
      }
      if (plan.complete) break
      actions.push({ packKey: asset.packKey, action: plan.action })
      await executeAssetAction({ action: plan.action, asset, services })
      if (step === 5) {
        throw createScriptError('V1_ASSET_CONVERGENCE_LIMIT', `Convergence did not complete for ${asset.packKey}.`)
      }
    }
  }
  const readback = await buildV1AssetPlan({ assets, models })
  if (!readback.ok || !readback.complete || readback.actionsRequired !== 0) {
    throw createScriptError('V1_ASSET_READBACK_FAILED', 'V1 Knowledge Asset readback was not complete.', readback)
  }
  return { actions, readback }
}

export const parseV1AssetArgs = (argv = process.argv.slice(2)) => {
  const digestIndex = argv.indexOf('--catalogue-sha256')
  return {
    apply: argv.includes('--apply'),
    confirm: argv.includes(V1_ASSET_CONFIRM_FLAG),
    json: argv.includes('--json'),
    catalogueSha256: digestIndex >= 0 ? normalizeToken(argv[digestIndex + 1]) : '',
  }
}

export const runV1KnowledgeAssetAuthoring = async ({
  args = parseV1AssetArgs(),
  dependencies = {},
  logger = console.log,
  sourceDir = DEFAULT_V1_ASSET_SOURCE_DIR,
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const models = dependencies.models || { KnowledgePack, KnowledgePackVersion, KnowledgePackActivation }
  const services = dependencies.services || {
    importDraft: importOutcomeKnowledgePackSourceDocumentDraft,
    validate: validateOutcomeKnowledgePackVersion,
    review: updateOutcomeKnowledgePackVersionReview,
    activate: activateOutcomeKnowledgePackVersion,
  }
  await connect()
  try {
    const assets = await loadV1KnowledgeAssets(sourceDir)
    const catalogueSha256 = buildV1AssetCatalogueDigest(assets)
    const plan = await buildV1AssetPlan({ assets, models })
    let result = null
    if (args.apply) {
      if (!args.confirm || args.catalogueSha256 !== catalogueSha256) {
        throw createScriptError(
          'V1_ASSET_CONFIRMATION_REQUIRED',
          `Apply requires ${V1_ASSET_CONFIRM_FLAG} and the exact dry-run --catalogue-sha256.`,
        )
      }
      if (!plan.ok) {
        throw createScriptError('V1_ASSET_PLAN_BLOCKED', 'V1 Knowledge Asset dry run contains blockers.', plan)
      }
      assertV1AssetWriteEnvironment({
        databaseName: dependencies.databaseName || mongoose.connection.name,
        nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
      })
      result = await convergeV1KnowledgeAssets({ assets, models, services })
    }
    const report = {
      ok: plan.ok,
      mode: args.apply ? 'apply' : 'dry-run',
      databaseName: dependencies.databaseName || mongoose.connection.name,
      catalogueSha256,
      plan,
      ...(result ? { result } : {}),
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
  runV1KnowledgeAssetAuthoring().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error.code || 'V1_ASSET_AUTHORING_FAILED',
      message: error.message,
      details: error.details || {},
    }, null, 2))
    process.exitCode = 1
  })
}
