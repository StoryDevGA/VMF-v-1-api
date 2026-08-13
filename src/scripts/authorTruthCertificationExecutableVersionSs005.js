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
  KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES,
  KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS,
  KNOWLEDGE_PACK_RELATIONSHIP_TYPES,
} from '../constants/knowledgeRuntime.js'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackVersion,
} from '../models/index.js'
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

export const SS005_CONFIRM_FLAG = '--confirm-ss005-truth-certification-v1-0-1'
export const TARGET_SEMANTIC_VERSION = '1.0.1'
export const BASELINE_SEMANTIC_VERSION = '1.0.0'
export const PACK_TYPE = 'TRUTH_CERTIFICATION'
export const PACK_KEY = 'truth-certification-pack'
export const SOURCE_AUTHORITY = 'StorylineOS Product and Architecture'
export const SYSTEM_ACTOR_ID = '000000000000000000000001'
export const DEFAULT_SOURCE_PATH = path.resolve(
  workspaceRoot,
  'docs/product-specs/source-artifacts/2026-06-15-governed-outcome-studio-oes-002/knowledge-packs-v1/truth-certification-pack-v1.yaml',
)

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex')
const contentHash = (value) => `sha256:${sha256(value)}`
const createScriptError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

const truthDependencies = [
  'blocking-rules',
  'certification-levels',
  'export-metadata-rules',
  'prohibited-output-claims',
  'runtime-warning-rules',
  'truth-certification-framework',
  'truth-quality-dimensions',
].map((packKey) => ({
  relationshipType: KNOWLEDGE_PACK_RELATIONSHIP_TYPES.REQUIRED_AT_RUNTIME,
  targetPackType: PACK_TYPE,
  targetPackKey: packKey,
  requiredAt: KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS.RUNTIME,
  cardinality: KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ONE,
  versionConstraint: { exactVersion: BASELINE_SEMANTIC_VERSION },
}))

const buildSourceDocument = ({ extractedText, sourceHash, sourceDocumentId }) => ({
  sourceDocumentId,
  filename: 'truth-certification-pack-v1.yaml',
  contentType: 'text/yaml',
  fileExtension: 'yaml',
  sourceHash,
  sourceType: 'SOURCE_DOCUMENT',
  sizeBytes: Buffer.byteLength(extractedText, 'utf8'),
})

export const buildExecutableAsset = ({ extractedText } = {}) => {
  const normalizedText = normalizeText(extractedText)
  if (!normalizedText) throw createScriptError('SS005_SOURCE_EMPTY', 'The executable Truth Certification source is empty.')
  const sourceHash = contentHash(normalizedText)
  const sourceDocumentId = `kpsrc-${PACK_KEY}-${TARGET_SEMANTIC_VERSION.replace(/\./g, '-')}-${sha256(normalizedText).slice(0, 16)}`
  return {
    packType: PACK_TYPE,
    packKey: PACK_KEY,
    label: 'Truth Certification Pack',
    description: 'Mandatory Outcome Studio post-validation executable Truth Certification rules.',
    purposeCategory: 'VALIDATION',
    knowledgeLayer: 'VALIDATION',
    knowledgeAssetId: '',
    workspaceCompatibility: ['OUTCOME'],
    dependencyReferences: truthDependencies,
    semanticVersion: TARGET_SEMANTIC_VERSION,
    schemaVersion: BASELINE_SEMANTIC_VERSION,
    sourceAuthority: SOURCE_AUTHORITY,
    executionMode: KNOWLEDGE_PACK_EXECUTION_MODES.POST_VALIDATION,
    visibility: 'PLATFORM',
    contentFormat: OUTCOME_KNOWLEDGE_PACK_CONTENT_FORMATS.YAML,
    filename: 'truth-certification-pack-v1.yaml',
    extractedText: normalizedText,
    sourceHash,
    contentHash: sourceHash,
    sourceDocument: buildSourceDocument({
      extractedText: normalizedText,
      sourceHash,
      sourceDocumentId,
    }),
    packId: buildKnowledgePackId({ packType: PACK_TYPE, packKey: PACK_KEY }),
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

export const buildExecutableImportBody = (asset) => ({
  packType: asset.packType,
  packKey: asset.packKey,
  label: asset.label,
  description: asset.description,
  purposeCategory: asset.purposeCategory,
  knowledgeLayer: asset.knowledgeLayer,
  workspaceCompatibility: asset.workspaceCompatibility,
  dependencyReferences: asset.dependencyReferences,
  semanticVersion: asset.semanticVersion,
  schemaVersion: asset.schemaVersion,
  sourceAuthority: asset.sourceAuthority,
  executionMode: asset.executionMode,
  boundary: 'POST_GENERATION_VALIDATION',
  visibility: asset.visibility,
  contentFormat: asset.contentFormat,
  sourceDocument: asset.sourceDocument,
  extractedText: asset.extractedText,
})

const resolveState = async ({ asset, models }) => {
  const [pack, baselineVersion, targetVersion, activations] = await Promise.all([
    models.KnowledgePack.findOne({ packId: asset.packId }).lean(),
    models.KnowledgePackVersion.findOne({ versionId: asset.baselineVersionId }).lean(),
    models.KnowledgePackVersion.findOne({ versionId: asset.versionId }).lean(),
    models.KnowledgePackActivation.find({
      packId: asset.packId,
    }).sort({ activatedAt: -1 }).lean(),
  ])
  return { pack, baselineVersion, targetVersion, activations }
}

export const buildExecutableVersionPlan = ({ asset, state }) => {
  const blockers = []
  if (!state.pack) blockers.push('PACK_NOT_FOUND')
  if (!state.baselineVersion || normalizeText(state.baselineVersion.contentHash) === '') {
    blockers.push('BASELINE_VERSION_NOT_FOUND')
  }
  if (state.baselineVersion && normalizeText(state.baselineVersion.contentHash) !== 'sha256:53a19b91ea6eac60998246f1073071408be0f989b50f507f832a60ec18abdc03') {
    blockers.push('BASELINE_CONTENT_DRIFT')
  }
  if (state.targetVersion && normalizeText(state.targetVersion.contentHash) !== asset.contentHash) {
    blockers.push('TARGET_CONTENT_DRIFT')
  }
  const activeTarget = state.activations.find((activation) => (
    normalizeToken(activation.status) === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE
    && normalizeText(activation.versionId) === asset.versionId
  ))
  const activeCount = state.activations.filter((activation) => (
    normalizeToken(activation.status) === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE
  )).length
  if (activeCount > 1) blockers.push('ACTIVE_ACTIVATION_CARDINALITY_INVALID')

  if (blockers.length > 0) {
    return {
      ok: false,
      complete: false,
      actionsRequired: 0,
      blockers,
      targetVersionId: asset.versionId,
      preservedBaselineVersionId: asset.baselineVersionId,
      activeVersionId: state.activations.find((activation) => normalizeToken(activation.status) === 'ACTIVE')?.versionId || '',
    }
  }
  if (
    state.targetVersion
    && normalizeToken(state.targetVersion.status) === OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE
    && activeTarget
    && activeCount === 1
  ) {
    return {
      ok: true,
      complete: true,
      actionsRequired: 0,
      blockers: [],
      targetVersionId: asset.versionId,
      preservedBaselineVersionId: asset.baselineVersionId,
      activeVersionId: asset.versionId,
      targetStatus: state.targetVersion.status,
      targetReviewStatus: state.targetVersion.reviewStatus || '',
    }
  }

  const targetStatus = normalizeToken(state.targetVersion?.status || OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT)
  const targetReviewStatus = normalizeToken(
    state.targetVersion?.reviewStatus || KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT,
  )
  let nextAction = state.targetVersion ? 'VALIDATE' : 'IMPORT'
  if (targetStatus === OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED) {
    if (targetReviewStatus === KNOWLEDGE_PACK_REVIEW_STATUSES.DRAFT) nextAction = 'SUBMIT_FOR_REVIEW'
    else if (targetReviewStatus === KNOWLEDGE_PACK_REVIEW_STATUSES.READY_FOR_REVIEW) nextAction = 'APPROVE'
    else if (targetReviewStatus === KNOWLEDGE_PACK_REVIEW_STATUSES.APPROVED) nextAction = 'ACTIVATE'
    else blockers.push('TARGET_REVIEW_STATE_UNSUPPORTED')
  } else if (targetStatus !== OUTCOME_KNOWLEDGE_PACK_STATUSES.DRAFT) {
    blockers.push(`TARGET_LIFECYCLE_STATE_${targetStatus || 'MISSING'}_UNSUPPORTED`)
  }
  return {
    ok: blockers.length === 0,
    complete: false,
    actionsRequired: blockers.length === 0 ? 1 : 0,
    blockers,
    nextAction,
    targetVersionId: asset.versionId,
    preservedBaselineVersionId: asset.baselineVersionId,
    activeVersionId: state.activations.find((activation) => normalizeToken(activation.status) === 'ACTIVE')?.versionId || '',
    targetStatus,
    targetReviewStatus,
  }
}

export const assertSs005WriteEnvironment = ({ databaseName, nodeEnv } = {}) => {
  const normalizedEnv = normalizeText(nodeEnv).toLowerCase()
  if (normalizedEnv === 'production' || !['development', 'test'].includes(normalizedEnv) || databaseName !== 'test') {
    throw createScriptError(
      'SS005_WRITE_ENVIRONMENT_BLOCKED',
      `Refusing SS-005 Truth Certification authoring in NODE_ENV=${normalizedEnv || '<missing>'}, database=${databaseName || '<missing>'}.`,
    )
  }
}

export const parseSs005Args = (argv = process.argv.slice(2)) => {
  const digestIndex = argv.indexOf('--catalogue-sha256')
  return {
    apply: argv.includes('--apply'),
    confirm: argv.includes(SS005_CONFIRM_FLAG),
    json: argv.includes('--json'),
    catalogueSha256: normalizeText(digestIndex >= 0 ? argv[digestIndex + 1] : ''),
  }
}

const executeAction = async ({ action, asset, services }) => {
  const common = {
    packId: asset.packId,
    versionId: asset.versionId,
    actorUserId: SYSTEM_ACTOR_ID,
  }
  if (action === 'IMPORT') {
    await services.importDraft({
      body: buildExecutableImportBody(asset),
      actorUserId: SYSTEM_ACTOR_ID,
    })
    return
  }
  if (action === 'VALIDATE') {
    await services.validate(common)
    return
  }
  if (action === 'SUBMIT_FOR_REVIEW') {
    await services.review({ ...common, body: { reviewStatus: KNOWLEDGE_PACK_REVIEW_STATUSES.READY_FOR_REVIEW } })
    return
  }
  if (action === 'APPROVE') {
    await services.review({ ...common, body: { reviewStatus: KNOWLEDGE_PACK_REVIEW_STATUSES.APPROVED } })
    return
  }
  if (action === 'ACTIVATE') {
    await services.activate({ ...common, body: { scopeType: 'GLOBAL' } })
    return
  }
  throw createScriptError('SS005_ACTION_UNSUPPORTED', `Unsupported SS-005 authoring action: ${action}`)
}

export const convergeExecutableVersion = async ({ asset, models, services }) => {
  const actions = []
  for (let step = 0; step < 6; step += 1) {
    const state = await resolveState({ asset, models })
    const plan = buildExecutableVersionPlan({ asset, state })
    if (!plan.ok) throw createScriptError('SS005_PLAN_BLOCKED', 'SS-005 executable version plan is blocked.', plan)
    if (plan.complete) return { actions, readback: plan }
    actions.push(plan.nextAction)
    await executeAction({ action: plan.nextAction, asset, services })
  }
  throw createScriptError('SS005_CONVERGENCE_LIMIT', 'SS-005 executable version lifecycle did not converge.')
}

export const runSs005TruthCertificationAuthoring = async ({
  args = parseSs005Args(),
  dependencies = {},
  logger = console.log,
  sourcePath = DEFAULT_SOURCE_PATH,
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
  const rawSource = await fs.readFile(sourcePath, 'utf8')
  const asset = buildExecutableAsset({ extractedText: rawSource })
  const catalogueSha256 = sha256(asset.extractedText)
  await connect()
  try {
    const initialState = await resolveState({ asset, models })
    const plan = buildExecutableVersionPlan({ asset, state: initialState })
    let result = null
    if (args.apply) {
      if (!args.confirm || args.catalogueSha256 !== catalogueSha256) {
        throw createScriptError(
          'SS005_CONFIRMATION_REQUIRED',
          `Apply requires ${SS005_CONFIRM_FLAG} and the exact dry-run --catalogue-sha256.`,
          { catalogueSha256 },
        )
      }
      assertSs005WriteEnvironment({
        databaseName: dependencies.databaseName || mongoose.connection.name,
        nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
      })
      if (!plan.ok) throw createScriptError('SS005_PLAN_BLOCKED', 'SS-005 executable version plan is blocked.', plan)
      if (!plan.complete) result = await convergeExecutableVersion({ asset, models, services })
    }
    const report = {
      ok: plan.ok,
      mode: args.apply ? 'apply' : 'dry-run',
      databaseName: dependencies.databaseName || mongoose.connection.name,
      sourcePath,
      sourceContentHash: asset.contentHash,
      catalogueSha256,
      targetVersionId: asset.versionId,
      preservedBaselineVersionId: asset.baselineVersionId,
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
  runSs005TruthCertificationAuthoring().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error.code || 'SS005_AUTHORING_FAILED',
      message: error.message,
      details: error.details || {},
    }, null, 2))
    process.exitCode = 1
  })
}
