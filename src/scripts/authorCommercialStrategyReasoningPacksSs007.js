import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

import { connectDb, disconnectDb } from '../config/db.js'
import {
  ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'
import {
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
  KNOWLEDGE_PACK_REVIEW_STATUSES,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
} from '../constants/outcomeKnowledgePacks.js'
import { KnowledgePack, KnowledgePackActivation, KnowledgePackVersion } from '../models/index.js'
import { buildKnowledgePackId } from '../models/KnowledgePack.js'
import { buildKnowledgePackVersionId } from '../models/KnowledgePackVersion.js'
import { buildKnowledgePackRelationshipChecksum } from '../services/knowledgePackRelationshipContract.js'
import {
  activateOutcomeKnowledgePackVersion,
  importOutcomeKnowledgePackSourceDocumentDraft,
  updateOutcomeKnowledgePackVersionReview,
  validateOutcomeKnowledgePackVersion,
} from '../services/outcomeKnowledgePackRegistryService.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, '../../..')

export const SS007_REASONING_PACK_CONFIRM_FLAG = '--confirm-dev-ss007-reasoning-packs'
export const DEFAULT_SS007_REASONING_SOURCE_DIR = path.resolve(workspaceRoot, 'docs/seed-data/support_assets')

const SEMANTIC_VERSION = '1.0.0'
const SOURCE_AUTHORITY = 'StorylineOS Product and Architecture'
const SYSTEM_ACTOR_ID = '000000000000000000000001'
const WORKSPACE_COMPATIBILITY = Object.freeze(['OUTCOME'])
const EMPTY_RELATIONSHIPS = Object.freeze([])
const EMPTY_RELATIONSHIP_CHECKSUM = buildKnowledgePackRelationshipChecksum(EMPTY_RELATIONSHIPS)

const SOURCE_FILENAME_BY_SEED_PACK_KEY = Object.freeze({
  'or-runtime-pack': 'system-reference-or-v1-0-observation-register-system.md',
  've-runtime-pack': 'system-reference-ve-v1-0-validation-evidence-system.md',
  'cr-runtime-pack': 'system-reference-cr-v1-0-contradiction-register.md',
  'cacr-runtime-pack': 'system-reference-cacr-v2-0-source-authority-runtime-artifact.md',
  'scr-runtime-pack': 'system-reference-scr-v3-0-source-authority-runtime-artifact.md',
  'et-runtime-pack': 'system-reference-et-v2-8-canonical-execution-translation-system.md',
  'et-rt-runtime-pack': 'system-reference-et-rt-v2-6-source-derived-canonical-runtime.md',
  'etl-runtime-pack': 'system-reference-etl-v1-3-rid-01b-regenerated-runtime-candidate.md',
  'ccr-runtime-pack': 'system-reference-ccr-v2-1-commercial-clarity-review-runtime.md',
  'dx-runtime-pack': 'system-reference-dx-v1-6-commercial-constraint-diagnostic-extension.md',
  'cdrm-runtime-pack': 'system-reference-cdrm-v1-2-canonical-runtime.md',
  'ccd-runtime-pack': 'system-reference-ccd-v1-2-commercial-clarity-dashboard-runtime.md',
  'fx-runtime-pack': 'system-reference-fx-v2-6-canonical-specification.md',
  'gx-runtime-pack': 'system-reference-gx-v2-7-canonical-specification.md',
  'ec-runtime-pack': 'system-reference-ec-v1-9-source-authority-runtime-artifact.md',
  'state-runtime-pack': 'system-reference-state-v1-4-source-authority-runtime-artifact.md',
  'st-runtime-pack': 'system-reference-st-v1-8-master-source-derived-canonical-runtime.md',
  'rgs-runtime-pack': 'system-reference-rgs-v1-0-render-governance-state.md',
  'arl-runtime-pack': 'system-reference-arl-v1-5-source-derived-canonical-runtime.md',
  'rl-runtime-pack': 'system-reference-rl-v2-9-source-derived-canonical-runtime.md',
})

const KNOWLEDGE_LAYER_BY_PACK_TYPE = Object.freeze({
  ARL: 'REASONING',
  RL: 'COMMUNICATION_PATTERN',
})

const CAPABILITY_KEY_BY_PACK_KEY = Object.freeze({
  'adaptive-reasoning-layer': 'adaptive-reasoning',
  'rendering-layer': 'rendering',
})

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex').toUpperCase()
const contentHash = (value) => `sha256:${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`
const normalizeArray = (values = []) => [...new Set(values.map(normalizeToken).filter(Boolean))].sort()
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/

const createScriptError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

const assertMutationResult = ({ result, operation }) => {
  if (!result || Number(result.matchedCount) !== 1) {
    throw createScriptError('SS007_REASONING_MUTATION_NOT_MATCHED', `Mutation did not match ${operation}.`, {
      operation,
      matchedCount: Number(result?.matchedCount || 0),
      modifiedCount: Number(result?.modifiedCount || 0),
    })
  }
}

const sourceFilenameForPack = (pack) => SOURCE_FILENAME_BY_SEED_PACK_KEY[pack.sourceSeedPackKey]

const knowledgeLayerForPack = (pack) => KNOWLEDGE_LAYER_BY_PACK_TYPE[pack.packType] || 'FRAMEWORK'

const capabilityKeyForPack = (pack) => (
  CAPABILITY_KEY_BY_PACK_KEY[pack.packKey] || pack.packKey
)

const knowledgeAssetIdForPack = (pack) => (
  `QA-SS007-${pack.packType}-${pack.packKey}`.replace(/[^a-z0-9]+/gi, '-').toUpperCase()
)

export const buildSs007ReasoningPackDefinitions = () => (
  ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS.map((pack) => {
    const filename = sourceFilenameForPack(pack)
    if (!filename) {
      throw createScriptError('SS007_REASONING_SOURCE_UNMAPPED', `No source asset mapping exists for ${pack.packKey}.`, {
        packKey: pack.packKey,
        sourceSeedPackKey: pack.sourceSeedPackKey,
      })
    }
    const definition = {
      packType: pack.packType,
      packKey: pack.packKey,
      sourceSeedPackKey: pack.sourceSeedPackKey,
      label: pack.name,
      description: pack.requiredFor,
      purposeCategory: 'SYSTEM',
      knowledgeLayer: knowledgeLayerForPack(pack),
      capabilityKey: capabilityKeyForPack(pack),
      knowledgeAssetId: knowledgeAssetIdForPack(pack),
      executionMode: KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
      filename,
      semanticVersion: SEMANTIC_VERSION,
      stageKey: pack.stageKey,
      kcpStage: pack.kcpStage,
      dependencyReferences: EMPTY_RELATIONSHIPS,
      relationshipContractVersion: KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
      relationshipChecksum: EMPTY_RELATIONSHIP_CHECKSUM,
    }
    return {
      ...definition,
      packId: buildKnowledgePackId(definition),
      versionId: buildKnowledgePackVersionId({
        packType: definition.packType,
        packKey: definition.packKey,
        semanticVersion: SEMANTIC_VERSION,
        scopeKey: 'GLOBAL',
      }),
    }
  })
)

export const loadSs007ReasoningPacks = async (
  sourceDir = DEFAULT_SS007_REASONING_SOURCE_DIR,
) => Promise.all(buildSs007ReasoningPackDefinitions().map(async (definition) => {
  const sourcePath = path.resolve(sourceDir, definition.filename)
  const extractedText = normalizeText(await fs.readFile(sourcePath, 'utf8'))
  if (!extractedText) {
    throw createScriptError('SS007_REASONING_SOURCE_EMPTY', `Source document is empty: ${sourcePath}`, {
      packKey: definition.packKey,
      sourcePath,
    })
  }
  return {
    ...definition,
    extractedText,
    sourcePath,
    expectedContentHash: contentHash(extractedText),
  }
}))

export const buildSs007ReasoningCatalogueDigest = (assets) => sha256(JSON.stringify(
  assets.map(({ extractedText, sourcePath, ...asset }) => ({
    ...asset,
    sourceSha256: sha256(extractedText),
  })),
))

const resolveAssetState = async (asset, models) => {
  const [pack, version, activations, identityConflict] = await Promise.all([
    models.KnowledgePack.findOne({ packId: asset.packId }).lean(),
    models.KnowledgePackVersion.findOne({ versionId: asset.versionId }).select('+content').lean(),
    models.KnowledgePackActivation.find({
      packId: asset.packId,
      status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
    }).lean(),
    models.KnowledgePack.findOne({
      knowledgeAssetId: asset.knowledgeAssetId,
      packId: { $ne: asset.packId },
    }).lean(),
  ])
  return { pack, version, activations, identityConflict }
}

const governanceMismatchFields = (row, asset, includeRelationships) => {
  if (!row) return ['missing']
  const fields = []
  if (normalizeToken(row.purposeCategory) !== asset.purposeCategory) fields.push('purposeCategory')
  if (normalizeToken(row.knowledgeLayer) !== asset.knowledgeLayer) fields.push('knowledgeLayer')
  if (normalizeLowerKey(row.capabilityKey) !== normalizeLowerKey(asset.capabilityKey)) fields.push('capabilityKey')
  if (normalizeToken(row.knowledgeAssetId) !== asset.knowledgeAssetId) fields.push('knowledgeAssetId')
  if (JSON.stringify(normalizeArray(row.workspaceCompatibility || [])) !== JSON.stringify(WORKSPACE_COMPATIBILITY)) {
    fields.push('workspaceCompatibility')
  }
  if (normalizeToken(row.executionMode) !== asset.executionMode) fields.push('executionMode')
  if (!includeRelationships) return fields
  if (normalizeToken(row.relationshipContractVersion) !== KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION) {
    fields.push('relationshipContractVersion')
  }
  if (
    normalizeText(row.relationshipChecksum).toLowerCase()
    !== buildKnowledgePackRelationshipChecksum(row.dependencyReferences || [])
  ) {
    fields.push('relationshipChecksum')
  }
  if (normalizeText(row.relationshipChecksum).toLowerCase() !== asset.relationshipChecksum) {
    fields.push('relationshipChecksumTarget')
  }
  return fields
}

const contentTextForHash = (value) => (
  typeof value === 'string' ? value : JSON.stringify(value ?? '')
)

const resolveExistingApprovedSourceBaseline = ({ version, activations }) => {
  if (!version) return { accepted: false, blocker: 'VERSION_MISSING' }
  const versionHash = normalizeText(version.contentHash)
  const content = contentTextForHash(version.content)
  const recomputedHash = contentHash(content)
  const sourceDocuments = Array.isArray(version.sourceDocuments) ? version.sourceDocuments : []
  const sourceFilenames = [
    normalizeText(version.sourceFilename),
    ...sourceDocuments.map((sourceDocument) => normalizeText(sourceDocument.filename)),
  ].filter(Boolean)
  const sourceHashes = sourceDocuments.map((sourceDocument) => normalizeText(sourceDocument.sourceHash))
    .filter(Boolean)
  if (normalizeToken(version.status) !== OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE) {
    return { accepted: false, blocker: 'VERSION_NOT_ACTIVE' }
  }
  if (normalizeToken(version.reviewStatus) !== KNOWLEDGE_PACK_REVIEW_STATUSES.APPROVED) {
    return { accepted: false, blocker: 'VERSION_NOT_APPROVED' }
  }
  if (!CONTENT_HASH_PATTERN.test(versionHash)) {
    return { accepted: false, blocker: 'VERSION_CONTENT_HASH_INVALID' }
  }
  if (versionHash !== recomputedHash) {
    return { accepted: false, blocker: 'VERSION_CONTENT_HASH_INTERNAL_MISMATCH' }
  }
  if (!sourceFilenames.length || !sourceHashes.length) {
    return { accepted: false, blocker: 'VERSION_SOURCE_METADATA_INCOMPLETE' }
  }
  if (activations.length !== 1) {
    return { accepted: false, blocker: 'ACTIVE_ACTIVATION_CARDINALITY_INVALID' }
  }
  const [activation] = activations
  if (normalizeToken(activation.status) !== OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE) {
    return { accepted: false, blocker: 'ACTIVATION_NOT_ACTIVE' }
  }
  if (normalizeText(activation.contentHash) !== versionHash) {
    return { accepted: false, blocker: 'ACTIVATION_CONTENT_HASH_MISMATCH' }
  }
  return {
    accepted: true,
    sourceBaseline: {
      mode: 'EXISTING_APPROVED_DATABASE_VERSION',
      contentHash: versionHash,
      sourceFilenames: [...new Set(sourceFilenames)].sort(),
      sourceHashes: [...new Set(sourceHashes)].sort(),
    },
  }
}

export const planSs007ReasoningPack = ({ asset, state }) => {
  const { pack, version, activations, identityConflict } = state
  if (identityConflict) {
    return {
      blocker: 'KNOWLEDGE_ASSET_ID_CONFLICT',
      conflictPackId: normalizeText(identityConflict.packId),
    }
  }
  if (!pack && !version && activations.length === 0) return { action: 'IMPORT' }
  if (!pack || !version) return { blocker: 'PARTIAL_ASSET_RECORDS' }
  const sourceBaseline = resolveExistingApprovedSourceBaseline({ version, activations })
  if (normalizeText(version.contentHash) !== asset.expectedContentHash && !sourceBaseline.accepted) {
    return {
      blocker: 'SOURCE_CONTENT_DRIFT',
      observedContentHash: normalizeText(version.contentHash),
      expectedContentHash: asset.expectedContentHash,
      sourceBaselineBlocker: sourceBaseline.blocker,
    }
  }
  const mismatches = [
    ...governanceMismatchFields(pack, asset, false).map((field) => `pack.${field}`),
    ...governanceMismatchFields(version, asset, true).map((field) => `version.${field}`),
  ]
  if (mismatches.length > 0) {
    return {
      action: 'UPDATE_GOVERNANCE_METADATA',
      mismatchFields: [...new Set(mismatches)].sort(),
      ...(sourceBaseline.accepted ? { sourceBaseline: sourceBaseline.sourceBaseline } : {}),
    }
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
    const activationMismatches = governanceMismatchFields(activations[0], asset, true)
      .map((field) => `activation.${field}`)
    if (activationMismatches.length > 0) {
      return {
        action: 'UPDATE_GOVERNANCE_METADATA',
        mismatchFields: [...new Set(activationMismatches)].sort(),
        ...(sourceBaseline.accepted ? { sourceBaseline: sourceBaseline.sourceBaseline } : {}),
      }
    }
    return {
      complete: true,
      ...(sourceBaseline.accepted ? { sourceBaseline: sourceBaseline.sourceBaseline } : {}),
    }
  }
  return { blocker: `LIFECYCLE_STATE_${status || 'MISSING'}_UNSUPPORTED` }
}

const classifyStageRow = (row) => {
  if (row.complete) return 'selected'
  if (row.action === 'IMPORT') return 'missing'
  if (row.action) return 'excluded'
  return 'blocked'
}

const buildStagePlan = (rows) => rows.reduce((result, row) => {
  const bucket = classifyStageRow(row)
  result[bucket].push({
    stageKey: row.stageKey,
    kcpStage: row.kcpStage,
    packType: row.packType,
    packKey: row.packKey,
    ...(row.action ? { proposedAction: row.action } : {}),
    ...(row.blocker ? { blocker: row.blocker } : {}),
  })
  return result
}, {
  selected: [],
  excluded: [],
  missing: [],
  blocked: [],
})

export const buildSs007ReasoningPackPlan = async ({ assets, models }) => {
  const rows = []
  for (const asset of assets) {
    const state = await resolveAssetState(asset, models)
    rows.push({
      stageKey: asset.stageKey,
      kcpStage: asset.kcpStage,
      packType: asset.packType,
      packKey: asset.packKey,
      sourceSeedPackKey: asset.sourceSeedPackKey,
      packId: asset.packId,
      versionId: asset.versionId,
      knowledgeAssetId: asset.knowledgeAssetId,
      expectedContentHash: asset.expectedContentHash,
      sourcePath: path.relative(workspaceRoot, asset.sourcePath).replace(/\\/g, '/'),
      ...planSs007ReasoningPack({ asset, state }),
    })
  }
  return {
    ok: rows.every((row) => !row.blocker),
    complete: rows.every((row) => row.complete === true),
    actionsRequired: rows.filter((row) => row.action).length,
    blockers: rows.filter((row) => row.blocker),
    stagePlan: buildStagePlan(rows),
    assets: rows,
  }
}

export const assertSs007ReasoningWriteEnvironment = ({ databaseName, nodeEnv }) => {
  const normalizedEnv = normalizeText(nodeEnv).toLowerCase()
  if (normalizedEnv === 'production' || !['development', 'test'].includes(normalizedEnv) || databaseName !== 'test') {
    throw createScriptError(
      'SS007_REASONING_ENVIRONMENT_BLOCKED',
      `Refusing SS-007 reasoning pack authoring in NODE_ENV=${normalizedEnv || '<missing>'}, database=${databaseName || '<missing>'}.`,
    )
  }
}

const buildPackGovernanceSet = (asset) => ({
  purposeCategory: asset.purposeCategory,
  knowledgeLayer: asset.knowledgeLayer,
  capabilityKey: normalizeLowerKey(asset.capabilityKey),
  knowledgeAssetId: asset.knowledgeAssetId,
  workspaceCompatibility: WORKSPACE_COMPATIBILITY,
  executionMode: asset.executionMode,
})

const buildVersionGovernanceSet = (asset) => ({
  ...buildPackGovernanceSet(asset),
  dependencyReferences: asset.dependencyReferences,
  relationshipContractVersion: KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
  relationshipChecksum: asset.relationshipChecksum,
})

const executeGovernanceMetadataUpdate = async ({ asset, models }) => {
  const state = await resolveAssetState(asset, models)
  const plan = planSs007ReasoningPack({ asset, state })
  if (plan.action !== 'UPDATE_GOVERNANCE_METADATA') {
    throw createScriptError(
      'SS007_REASONING_METADATA_UPDATE_UNSUPPORTED',
      `Cannot update metadata for ${asset.packKey}: expected UPDATE_GOVERNANCE_METADATA.`,
      { packKey: asset.packKey, plan },
    )
  }
  const protectedContentHash = plan.sourceBaseline?.contentHash || asset.expectedContentHash
  const packUpdate = await models.KnowledgePack.updateOne(
    { packId: asset.packId },
    { $set: buildPackGovernanceSet(asset) },
    { runValidators: true },
  )
  assertMutationResult({ result: packUpdate, operation: `KnowledgePack:${asset.packId}` })

  const versionUpdate = await models.KnowledgePackVersion.updateOne(
    { versionId: asset.versionId, contentHash: protectedContentHash },
    { $set: buildVersionGovernanceSet(asset) },
    { runValidators: true },
  )
  assertMutationResult({ result: versionUpdate, operation: `KnowledgePackVersion:${asset.versionId}` })

  if (state.activations.length === 1) {
    const activation = state.activations[0]
    const activationUpdate = await models.KnowledgePackActivation.updateOne(
      { activationId: activation.activationId, contentHash: protectedContentHash },
      { $set: buildVersionGovernanceSet(asset) },
      { runValidators: true },
    )
    assertMutationResult({
      result: activationUpdate,
      operation: `KnowledgePackActivation:${activation.activationId}`,
    })
  }
}

export const buildSs007ReasoningImportBody = (asset) => ({
  packType: asset.packType,
  packKey: asset.packKey,
  label: asset.label,
  description: asset.description,
  purposeCategory: asset.purposeCategory,
  knowledgeLayer: asset.knowledgeLayer,
  ...(asset.capabilityKey ? { capabilityKey: asset.capabilityKey } : {}),
  knowledgeAssetId: asset.knowledgeAssetId,
  workspaceCompatibility: WORKSPACE_COMPATIBILITY,
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

const executeSs007ReasoningAction = async ({ action, asset, models, services }) => {
  const common = { packId: asset.packId, versionId: asset.versionId, actorUserId: SYSTEM_ACTOR_ID }
  if (action === 'IMPORT') {
    await services.importDraft({ body: buildSs007ReasoningImportBody(asset), actorUserId: SYSTEM_ACTOR_ID })
    return
  }
  if (action === 'UPDATE_GOVERNANCE_METADATA') {
    await executeGovernanceMetadataUpdate({ asset, models })
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
  throw createScriptError('SS007_REASONING_ACTION_UNSUPPORTED', `Unsupported SS-007 authoring action: ${action}`)
}

export const convergeSs007ReasoningPacks = async ({ assets, models, services }) => {
  const actions = []
  for (const asset of assets) {
    for (let step = 0; step < 8; step += 1) {
      const state = await resolveAssetState(asset, models)
      const plan = planSs007ReasoningPack({ asset, state })
      if (plan.blocker) {
        throw createScriptError(
          'SS007_REASONING_CONVERGENCE_BLOCKED',
          `Cannot converge ${asset.packKey}: ${plan.blocker}`,
          { packKey: asset.packKey, blocker: plan.blocker },
        )
      }
      if (plan.complete) break
      actions.push({ packKey: asset.packKey, action: plan.action })
      await executeSs007ReasoningAction({ action: plan.action, asset, models, services })
      if (step === 7) {
        throw createScriptError(
          'SS007_REASONING_CONVERGENCE_LIMIT',
          `Convergence did not complete for ${asset.packKey}.`,
        )
      }
    }
  }
  const readback = await buildSs007ReasoningPackPlan({ assets, models })
  if (!readback.ok || !readback.complete || readback.actionsRequired !== 0) {
    throw createScriptError(
      'SS007_REASONING_READBACK_FAILED',
      'SS-007 reasoning pack readback was not complete.',
      readback,
    )
  }
  return { actions, readback }
}

export const parseSs007ReasoningPackArgs = (argv = process.argv.slice(2)) => {
  const digestIndex = argv.indexOf('--catalogue-sha256')
  return {
    json: argv.includes('--json'),
    apply: argv.includes('--apply'),
    confirm: argv.includes(SS007_REASONING_PACK_CONFIRM_FLAG),
    catalogueSha256: digestIndex >= 0 ? normalizeToken(argv[digestIndex + 1]) : '',
  }
}

export const runSs007ReasoningPackAuthoring = async ({
  args = parseSs007ReasoningPackArgs(),
  dependencies = {},
  logger = console.log,
  sourceDir = DEFAULT_SS007_REASONING_SOURCE_DIR,
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
    const assets = await loadSs007ReasoningPacks(sourceDir)
    const catalogueSha256 = buildSs007ReasoningCatalogueDigest(assets)
    const plan = await buildSs007ReasoningPackPlan({ assets, models })
    let result = null
    if (args.apply) {
      if (!args.confirm || args.catalogueSha256 !== catalogueSha256) {
        throw createScriptError(
          'SS007_REASONING_CONFIRMATION_REQUIRED',
          `Apply requires ${SS007_REASONING_PACK_CONFIRM_FLAG} and the exact dry-run --catalogue-sha256.`,
        )
      }
      if (!plan.ok) {
        throw createScriptError(
          'SS007_REASONING_PLAN_BLOCKED',
          'SS-007 reasoning pack dry run contains blockers.',
          plan,
        )
      }
      assertSs007ReasoningWriteEnvironment({
        databaseName: dependencies.databaseName || mongoose.connection.name,
        nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
      })
      result = await convergeSs007ReasoningPacks({ assets, models, services })
    }
    const report = {
      ok: plan.ok,
      mode: args.apply ? 'apply' : 'dry-run',
      databaseName: dependencies.databaseName || mongoose.connection.name,
      catalogueSha256,
      relationshipContractVersion: KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
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
  runSs007ReasoningPackAuthoring().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error.code || 'SS007_REASONING_PACK_AUTHORING_FAILED',
      message: error.message,
      details: error.details || {},
    }, null, 2))
    process.exitCode = 1
  })
}
