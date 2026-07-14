import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackManifest,
  KnowledgePackVersion,
} from '../models/index.js'
import auditService from '../services/auditService.js'
import {
  computeCorrectionRowsSha256,
  loadCorrectionManifest,
  VALID_VALUES_BY_FIELD,
  validateCorrectionManifest,
  verifyManifestSource,
} from './reconcileKnowledgePackMetadata.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
// Reports, backups, and workbook evidence intentionally live in the dev-v1 workspace.
const workspaceRoot = path.resolve(scriptDir, '../../..')
const DEFAULT_POLICY_PATH = path.resolve(
  scriptDir,
  'data/knowledgePackMetadataDevPolicy.v1.json',
)
export const DEFAULT_DEV_REHEARSAL_DIR = path.resolve(
  workspaceRoot,
  'docs/generated/knowledge-pack-metadata-reconciliation/dev-rehearsal',
)

const CONFIRM_FLAG = '--confirm-dev-knowledge-pack-reconciliation'
const SUPPORTED_POLICY_SCHEMA_VERSION = '1.0.0'
const SYSTEM_ACTOR_ID = '000000000000000000000001'
const RECONCILIATION_RESOURCE_ID = '000000000000000000000002'
const ACTIVE_STATUS = 'ACTIVE'
const MUTABLE_FIELDS = new Set([
  'purposeCategory',
  'executionMode',
  'packCategory',
])

const COLLECTION_CONFIGS = Object.freeze([
  Object.freeze({
    collectionKey: 'KnowledgePack',
    idField: 'packId',
    model: KnowledgePack,
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackVersion',
    idField: 'versionId',
    model: KnowledgePackVersion,
    select: '+content',
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackActivation',
    idField: 'activationId',
    model: KnowledgePackActivation,
  }),
])

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const unique = (values) => [...new Set(values)]

const createScriptError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

const stableClone = (value) => JSON.parse(JSON.stringify(value))

const stableSortObject = (value) => {
  if (Array.isArray(value)) return value.map(stableSortObject)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (['updatedAt', '__v'].includes(key)) return result
      result[key] = stableSortObject(value[key])
      return result
    }, {})
}

const sha256Json = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(stableSortObject(value)) ?? 'undefined')
  .digest('hex')
  .toUpperCase()

const buildTimestamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-')

export const parseDevRehearsalArgs = (argv = process.argv.slice(2)) => {
  const rollbackIndex = argv.indexOf('--rollback')
  const backupSha256Index = argv.indexOf('--backup-sha256')
  return {
    apply: argv.includes('--apply'),
    confirm: argv.includes(CONFIRM_FLAG),
    help: argv.includes('--help') || argv.includes('-h'),
    json: argv.includes('--json'),
    rollbackPath: rollbackIndex >= 0 ? normalizeText(argv[rollbackIndex + 1]) : '',
    backupSha256: backupSha256Index >= 0 ? normalizeToken(argv[backupSha256Index + 1]) : '',
  }
}

export const validateDevPolicy = (input, manifest) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createScriptError('DEV_POLICY_INVALID', 'Development reconciliation policy must be an object.')
  }
  if (normalizeText(input.schemaVersion) !== SUPPORTED_POLICY_SCHEMA_VERSION) {
    throw createScriptError(
      'DEV_POLICY_SCHEMA_UNSUPPORTED',
      `Development reconciliation policy schema must be ${SUPPORTED_POLICY_SCHEMA_VERSION}.`,
    )
  }

  const correctionRowsSha256 = normalizeToken(input.correctionRowsSha256)
  const actualCorrectionRowsSha256 = computeCorrectionRowsSha256(manifest.packs)
  if (correctionRowsSha256 !== actualCorrectionRowsSha256) {
    throw createScriptError(
      'DEV_POLICY_CORRECTION_MANIFEST_MISMATCH',
      'Development policy does not match the checked-in correction manifest.',
      { correctionRowsSha256, actualCorrectionRowsSha256 },
    )
  }

  const allowedNodeEnvs = unique(
    (input.environmentGuard?.allowedNodeEnvs || []).map((value) => normalizeText(value).toLowerCase()),
  )
  const allowedDatabaseNames = unique(
    (input.environmentGuard?.allowedDatabaseNames || []).map(normalizeText),
  )
  if (allowedNodeEnvs.length === 0 || allowedDatabaseNames.length === 0) {
    throw createScriptError('DEV_POLICY_ENVIRONMENT_GUARD_MISSING', 'Development policy requires environment and database allowlists.')
  }

  const manifestPackIds = new Set(manifest.packs.map((pack) => pack.packId))
  const legacyIds = new Set()
  const survivorIds = new Set()
  const duplicateSurvivors = (input.duplicateSurvivors || []).map((entry) => {
    const legacyPackId = normalizeText(entry?.legacyPackId)
    const survivorPackId = normalizeText(entry?.survivorPackId)
    if (
      !legacyPackId
      || !survivorPackId
      || legacyPackId === survivorPackId
      || legacyIds.has(legacyPackId)
      || survivorIds.has(survivorPackId)
      || !manifestPackIds.has(legacyPackId)
      || !manifestPackIds.has(survivorPackId)
    ) {
      throw createScriptError('DEV_POLICY_DUPLICATE_MAP_INVALID', `Invalid duplicate survivor map for ${legacyPackId || '<missing>'}.`)
    }
    legacyIds.add(legacyPackId)
    survivorIds.add(survivorPackId)
    return { legacyPackId, survivorPackId }
  })
  if (duplicateSurvivors.length !== 7) {
    throw createScriptError('DEV_POLICY_DUPLICATE_MAP_INCOMPLETE', 'Development policy must name exactly seven approved duplicate survivors.')
  }

  const excludedCorrectionKeys = new Set()
  const excludedCorrections = (input.excludedCorrections || []).map((entry) => {
    const packId = normalizeText(entry?.packId)
    const field = normalizeText(entry?.field)
    const reason = normalizeText(entry?.reason)
    if ((!manifestPackIds.has(packId) && packId !== '*') || !field || !reason) {
      throw createScriptError('DEV_POLICY_EXCLUSION_INVALID', `Invalid excluded correction ${packId}.${field}.`)
    }
    const key = `${packId}:${field}`
    if (excludedCorrectionKeys.has(key)) {
      throw createScriptError('DEV_POLICY_EXCLUSION_DUPLICATE', `Duplicate excluded correction ${key}.`)
    }
    excludedCorrectionKeys.add(key)
    return { packId, field, reason }
  })

  const overrideKeys = new Set()
  const expectedCurrentOverrides = (input.expectedCurrentOverrides || []).map((entry) => {
    const packId = normalizeText(entry?.packId)
    const collectionKey = normalizeText(entry?.collectionKey)
    const field = normalizeText(entry?.field)
    const manifestFrom = normalizeToken(entry?.manifestFrom)
    const actualFrom = normalizeToken(entry?.actualFrom)
    const to = normalizeToken(entry?.to)
    const reason = normalizeText(entry?.reason)
    const manifestPack = manifest.packs.find((pack) => pack.packId === packId)
    const correction = manifestPack?.corrections.find((item) => item.field === field)
    if (
      !correction
      || !COLLECTION_CONFIGS.some((config) => config.collectionKey === collectionKey)
      || correction.from !== manifestFrom
      || correction.to !== to
      || !actualFrom
      || actualFrom === to
      || !reason
    ) {
      throw createScriptError('DEV_POLICY_CURRENT_OVERRIDE_INVALID', `Invalid current-value override ${packId}.${field}.`)
    }
    const key = `${packId}:${collectionKey}:${field}`
    if (overrideKeys.has(key)) {
      throw createScriptError('DEV_POLICY_CURRENT_OVERRIDE_DUPLICATE', `Duplicate current-value override ${key}.`)
    }
    overrideKeys.add(key)
    return { packId, collectionKey, field, manifestFrom, actualFrom, to, reason }
  })

  if (normalizeToken(input.historicalPolicy) !== 'PRESERVE') {
    throw createScriptError('DEV_POLICY_HISTORICAL_POLICY_INVALID', 'Historical records must be preserved.')
  }
  if (normalizeToken(input.manifestPolicy) !== 'BLOCK_IF_PRESENT') {
    throw createScriptError('DEV_POLICY_MANIFEST_POLICY_INVALID', 'Persisted manifests must block the rehearsal.')
  }

  return {
    schemaVersion: SUPPORTED_POLICY_SCHEMA_VERSION,
    correctionRowsSha256,
    environmentGuard: { allowedNodeEnvs, allowedDatabaseNames },
    duplicateSurvivors,
    excludedCorrections,
    expectedCurrentOverrides,
    historicalPolicy: 'PRESERVE',
    manifestPolicy: 'BLOCK_IF_PRESENT',
  }
}

export const loadDevPolicy = async ({
  manifest,
  policyPath = DEFAULT_POLICY_PATH,
} = {}) => validateDevPolicy(
  JSON.parse(await fs.readFile(policyPath, 'utf8')),
  manifest,
)

export const assertDevWriteEnvironment = ({ databaseName, nodeEnv, policy } = {}) => {
  const normalizedNodeEnv = normalizeText(nodeEnv).toLowerCase()
  const normalizedDatabaseName = normalizeText(databaseName)
  if (
    normalizedNodeEnv === 'production'
    || !policy.environmentGuard.allowedNodeEnvs.includes(normalizedNodeEnv)
    || !policy.environmentGuard.allowedDatabaseNames.includes(normalizedDatabaseName)
  ) {
    throw createScriptError(
      'DEV_REHEARSAL_ENVIRONMENT_BLOCKED',
      `Refusing Knowledge Pack reconciliation write in NODE_ENV=${normalizedNodeEnv || '<missing>'}, database=${normalizedDatabaseName || '<missing>'}.`,
      {
        nodeEnv: normalizedNodeEnv,
        databaseName: normalizedDatabaseName,
        allowedNodeEnvs: policy.environmentGuard.allowedNodeEnvs,
        allowedDatabaseNames: policy.environmentGuard.allowedDatabaseNames,
      },
    )
  }
}

const createDefaultDependencies = () => ({
  auditService,
  connect: connectDb,
  disconnect: disconnectDb,
  getDatabaseName: () => mongoose.connection.name,
  models: Object.fromEntries(COLLECTION_CONFIGS.map((config) => [config.collectionKey, config.model])),
  manifestModel: KnowledgePackManifest,
  nodeEnv: process.env.NODE_ENV || '',
  startSession: () => mongoose.startSession(),
})

const resolveDependencies = (dependencies = {}) => {
  const defaults = createDefaultDependencies()
  return {
    ...defaults,
    ...dependencies,
    models: {
      ...defaults.models,
      ...(dependencies.models || {}),
    },
  }
}

const resolveQueryRows = async ({ model, select = '', session = null } = {}) => {
  let query = model.find({})
  if (select && typeof query.select === 'function') query = query.select(select)
  if (session && typeof query.session === 'function') query = query.session(session)
  if (typeof query.lean === 'function') query = query.lean()
  const rows = await query
  return Array.isArray(rows) ? rows : []
}

export const readDevRehearsalState = async ({ dependencies = {}, session = null } = {}) => {
  const resolved = resolveDependencies(dependencies)
  const state = {}
  for (const config of COLLECTION_CONFIGS) {
    state[config.collectionKey] = await resolveQueryRows({
      model: resolved.models[config.collectionKey],
      select: config.select,
      session,
    })
  }
  state.KnowledgePackManifest = await resolveQueryRows({
    model: resolved.manifestModel,
    session,
  })
  return state
}

const getId = (row, idField) => normalizeText(row?.[idField] || row?._id)

const getSourceIdentity = (version) => ({
  contentDigest: sha256Json(version?.content),
  contentHash: normalizeText(version?.contentHash),
  contentFormat: normalizeToken(version?.contentFormat),
  schemaVersion: normalizeText(version?.schemaVersion),
  semanticVersion: normalizeText(version?.semanticVersion),
  sourceDocuments: (version?.sourceDocuments || []).map((source) => ({
    contentType: normalizeText(source?.contentType),
    fileExtension: normalizeText(source?.fileExtension).toLowerCase(),
    filename: normalizeText(source?.filename),
    sourceHash: normalizeText(source?.sourceHash),
  })),
  sourceFilename: normalizeText(version?.sourceFilename),
})

const isCorrectionExcluded = ({ policy, packId, field }) => policy.excludedCorrections.some(
  (entry) => entry.field === field && [packId, '*'].includes(entry.packId),
)

const getCurrentOverride = ({ policy, packId, collectionKey, field }) => policy.expectedCurrentOverrides.find(
  (entry) => entry.packId === packId && entry.collectionKey === collectionKey && entry.field === field,
)

const groupUpdates = (updates) => {
  const grouped = new Map()
  for (const update of updates) {
    const key = `${update.collectionKey}:${update.recordKey}`
    const current = grouped.get(key) || {
      collectionKey: update.collectionKey,
      idField: update.idField,
      recordKey: update.recordKey,
      packId: update.packId,
      changes: [],
    }
    current.changes.push(update.change)
    grouped.set(key, current)
  }
  return [...grouped.values()].sort((left, right) =>
    `${left.collectionKey}:${left.recordKey}`.localeCompare(`${right.collectionKey}:${right.recordKey}`),
  )
}

export const buildDevRehearsalPlan = ({ manifest, policy, state } = {}) => {
  const validatedManifest = validateCorrectionManifest(manifest)
  const validatedPolicy = validateDevPolicy(policy, validatedManifest)
  const blockers = []
  const deferredCorrections = []
  const duplicatePairs = []
  const updates = []
  const legacyPackIds = new Set(validatedPolicy.duplicateSurvivors.map((entry) => entry.legacyPackId))
  const packRows = state?.KnowledgePack || []
  const versionRows = state?.KnowledgePackVersion || []
  const activationRows = state?.KnowledgePackActivation || []
  const manifestRows = state?.KnowledgePackManifest || []
  const packById = new Map(packRows.map((row) => [normalizeText(row?.packId), row]))

  if (manifestRows.length > 0) {
    blockers.push({
      code: 'PERSISTED_MANIFESTS_PRESENT',
      count: manifestRows.length,
      manifestIds: manifestRows.map((row) => normalizeText(row?.manifestId || row?._id)),
    })
  }

  for (const pair of validatedPolicy.duplicateSurvivors) {
    const legacyPack = packById.get(pair.legacyPackId)
    const survivorPack = packById.get(pair.survivorPackId)
    if (!legacyPack) {
      if (!survivorPack) {
        blockers.push({ code: 'DUPLICATE_PAIR_BOTH_MISSING', ...pair })
      } else {
        duplicatePairs.push({ ...pair, state: 'ALREADY_REMOVED' })
      }
      continue
    }
    if (!survivorPack) {
      blockers.push({ code: 'DUPLICATE_SURVIVOR_MISSING', ...pair })
      continue
    }

    const legacyVersions = versionRows.filter((row) => normalizeText(row?.packId) === pair.legacyPackId)
    const survivorVersions = versionRows.filter((row) => normalizeText(row?.packId) === pair.survivorPackId)
    const legacyActivations = activationRows.filter((row) => normalizeText(row?.packId) === pair.legacyPackId)
    const survivorActivations = activationRows.filter((row) => normalizeText(row?.packId) === pair.survivorPackId)
    if (
      legacyVersions.length !== 1
      || survivorVersions.length !== 1
      || legacyActivations.length !== 1
      || survivorActivations.length !== 1
      || normalizeToken(legacyActivations[0]?.status) !== ACTIVE_STATUS
      || normalizeToken(survivorActivations[0]?.status) !== ACTIVE_STATUS
    ) {
      blockers.push({
        code: 'DUPLICATE_PAIR_CARDINALITY_INVALID',
        ...pair,
        legacyVersions: legacyVersions.length,
        survivorVersions: survivorVersions.length,
        legacyActivations: legacyActivations.length,
        survivorActivations: survivorActivations.length,
      })
      continue
    }

    const legacySource = getSourceIdentity(legacyVersions[0])
    const survivorSource = getSourceIdentity(survivorVersions[0])
    if (
      normalizeText(legacyPack?.packKey) !== normalizeText(survivorPack?.packKey)
      || normalizeText(legacyPack?.latestVersionId) !== getId(legacyVersions[0], 'versionId')
      || normalizeText(survivorPack?.latestVersionId) !== getId(survivorVersions[0], 'versionId')
      || normalizeText(legacyActivations[0]?.versionId) !== getId(legacyVersions[0], 'versionId')
      || normalizeText(survivorActivations[0]?.versionId) !== getId(survivorVersions[0], 'versionId')
      || !legacySource.contentHash
      || legacySource.contentHash !== survivorSource.contentHash
      || sha256Json(legacySource) !== sha256Json(survivorSource)
      || normalizeText(legacyActivations[0]?.contentHash) !== normalizeText(survivorActivations[0]?.contentHash)
    ) {
      blockers.push({
        code: 'DUPLICATE_CONTENT_PARITY_FAILED',
        ...pair,
        legacySource,
        survivorSource,
      })
      continue
    }
    duplicatePairs.push({
      ...pair,
      state: 'DELETE_LEGACY',
      contentHash: legacySource.contentHash,
      legacyVersionId: getId(legacyVersions[0], 'versionId'),
      legacyActivationId: getId(legacyActivations[0], 'activationId'),
    })
  }

  for (const pack of validatedManifest.packs) {
    if (legacyPackIds.has(pack.packId)) {
      pack.corrections.forEach((correction) => deferredCorrections.push({
        packId: pack.packId,
        field: correction.field,
        from: correction.from,
        to: correction.to,
        reason: 'Legacy duplicate is deleted in favour of the approved canonical survivor.',
      }))
      continue
    }

    const packRow = packById.get(pack.packId)
    if (!packRow) {
      blockers.push({ code: 'TARGET_PACK_MISSING', packId: pack.packId })
      continue
    }
    const relatedVersions = versionRows.filter((row) => normalizeText(row?.packId) === pack.packId)
    const latestVersionId = normalizeText(packRow?.latestVersionId)
    const latestVersions = relatedVersions.filter((row) => getId(row, 'versionId') === latestVersionId)
    const activeActivations = activationRows.filter((row) =>
      normalizeText(row?.packId) === pack.packId && normalizeToken(row?.status) === ACTIVE_STATUS,
    )
    const historicalActivations = activationRows.filter((row) =>
      normalizeText(row?.packId) === pack.packId && normalizeToken(row?.status) !== ACTIVE_STATUS,
    )
    if (relatedVersions.length !== 1 || latestVersions.length !== 1 || activeActivations.length !== 1 || historicalActivations.length > 0) {
      blockers.push({
        code: 'CURRENT_RECORD_CARDINALITY_INVALID',
        packId: pack.packId,
        versions: relatedVersions.length,
        latestVersions: latestVersions.length,
        activeActivations: activeActivations.length,
        historicalActivations: historicalActivations.length,
      })
      continue
    }

    const records = COLLECTION_CONFIGS.map((config) => {
      if (config.collectionKey === 'KnowledgePack') return packRow
      if (config.collectionKey === 'KnowledgePackVersion') return latestVersions[0]
      return activeActivations[0]
    })

    for (const correction of pack.corrections) {
      if (isCorrectionExcluded({ policy: validatedPolicy, packId: pack.packId, field: correction.field })) {
        deferredCorrections.push({ packId: pack.packId, ...correction })
        continue
      }
      if (!MUTABLE_FIELDS.has(correction.field)) {
        blockers.push({
          code: 'UNSAFE_CORRECTION_NOT_EXCLUDED',
          packId: pack.packId,
          field: correction.field,
        })
        continue
      }
      if (!VALID_VALUES_BY_FIELD[correction.field]?.has(correction.to)) {
        blockers.push({
          code: 'MANIFEST_VALUE_UNSUPPORTED',
          packId: pack.packId,
          field: correction.field,
          value: correction.to,
        })
        continue
      }
      for (let index = 0; index < COLLECTION_CONFIGS.length; index += 1) {
        const config = COLLECTION_CONFIGS[index]
        const row = records[index]
        const override = getCurrentOverride({
          policy: validatedPolicy,
          packId: pack.packId,
          collectionKey: config.collectionKey,
          field: correction.field,
        })
        const expectedCurrentValue = override?.actualFrom || correction.from
        const currentValue = normalizeToken(row?.[correction.field])
        if (currentValue === correction.to) continue
        if (currentValue !== expectedCurrentValue) {
          blockers.push({
            code: 'CURRENT_VALUE_DRIFT',
            collectionKey: config.collectionKey,
            recordKey: getId(row, config.idField),
            packId: pack.packId,
            field: correction.field,
            expectedCurrentValue,
            currentValue,
            correctedValue: correction.to,
          })
          continue
        }
        updates.push({
          collectionKey: config.collectionKey,
          idField: config.idField,
          recordKey: getId(row, config.idField),
          packId: pack.packId,
          change: {
            field: correction.field,
            from: expectedCurrentValue,
            to: correction.to,
            manifestFrom: correction.from,
            reason: override?.reason || correction.reason,
          },
        })
      }
    }
  }

  const groupedUpdates = groupUpdates(updates)
  const pendingDuplicatePairs = duplicatePairs.filter((pair) => pair.state === 'DELETE_LEGACY')
  return {
    ok: blockers.length === 0,
    mode: 'dev-rehearsal-dry-run',
    summary: {
      blockers: blockers.length,
      deferredCorrections: deferredCorrections.length,
      duplicatePairsAlreadyRemoved: duplicatePairs.length - pendingDuplicatePairs.length,
      duplicatePairsToDelete: pendingDuplicatePairs.length,
      recordsToUpdate: groupedUpdates.length,
      fieldValuesToUpdate: groupedUpdates.reduce((count, update) => count + update.changes.length, 0),
      manifestsPresent: manifestRows.length,
    },
    duplicatePairs,
    updates: groupedUpdates,
    deferredCorrections,
    blockers,
  }
}

const getAffectedPackIds = ({ manifest, policy }) => unique([
  ...manifest.packs.map((pack) => pack.packId),
  ...policy.duplicateSurvivors.flatMap((pair) => [pair.legacyPackId, pair.survivorPackId]),
]).sort()

const selectAffectedState = ({ state, packIds }) => {
  const targetIds = new Set(packIds)
  return Object.fromEntries(COLLECTION_CONFIGS.map((config) => [
    config.collectionKey,
    (state?.[config.collectionKey] || [])
      .filter((row) => targetIds.has(normalizeText(row?.packId)))
      .map(stableClone)
      .sort((left, right) => getId(left, config.idField).localeCompare(getId(right, config.idField))),
  ]))
}

export const computeAffectedStateDigest = ({ state, packIds }) => sha256Json(
  selectAffectedState({ state, packIds }),
)

const projectAppliedState = ({ state, packIds, plan }) => {
  const projected = selectAffectedState({ state, packIds })
  const deletedPackIds = new Set(
    plan.duplicatePairs
      .filter((pair) => pair.state === 'DELETE_LEGACY')
      .map((pair) => pair.legacyPackId),
  )
  for (const config of COLLECTION_CONFIGS) {
    projected[config.collectionKey] = projected[config.collectionKey]
      .filter((row) => !deletedPackIds.has(normalizeText(row?.packId)))
  }
  for (const update of plan.updates) {
    const config = COLLECTION_CONFIGS.find((entry) => entry.collectionKey === update.collectionKey)
    const row = projected[update.collectionKey].find(
      (entry) => getId(entry, config.idField) === update.recordKey,
    )
    if (!row) throw createScriptError('PROJECTED_UPDATE_TARGET_MISSING', `Missing projected target ${update.collectionKey}:${update.recordKey}.`)
    update.changes.forEach((change) => {
      row[change.field] = change.to
    })
  }
  return projected
}

export const buildDevBackup = ({ databaseName, manifest, policy, plan, state, now = new Date() } = {}) => {
  const packIds = getAffectedPackIds({ manifest, policy })
  const collections = selectAffectedState({ state, packIds })
  const expectedAppliedState = projectAppliedState({ state, packIds, plan })
  return {
    schemaVersion: '1.0.0',
    createdAt: now.toISOString(),
    databaseName: normalizeText(databaseName),
    correctionRowsSha256: policy.correctionRowsSha256,
    policySha256: sha256Json(policy),
    planSha256: sha256Json(plan),
    packIds,
    preStateDigest: sha256Json(collections),
    expectedAppliedStateDigest: sha256Json(expectedAppliedState),
    plan,
    collections,
  }
}

const writeJsonArtifact = async ({ directory, filename, value }) => {
  await fs.mkdir(directory, { recursive: true })
  const artifactPath = path.resolve(directory, filename)
  const payload = `${JSON.stringify(value, null, 2)}\n`
  await fs.writeFile(artifactPath, payload, 'utf8')
  return {
    path: artifactPath,
    sha256: crypto.createHash('sha256').update(payload).digest('hex').toUpperCase(),
  }
}

export const computeBackupArtifactSha256 = (backup) => crypto
  .createHash('sha256')
  .update(`${JSON.stringify(backup, null, 2)}\n`)
  .digest('hex')
  .toUpperCase()

export const writeDevBackup = async ({
  backup,
  reportDir = DEFAULT_DEV_REHEARSAL_DIR,
  now = new Date(),
} = {}) => writeJsonArtifact({
  directory: path.resolve(reportDir, 'backups'),
  filename: `knowledge-pack-metadata-dev-backup-${buildTimestamp(now)}.json`,
  value: backup,
})

const buildApplyAuditPayload = ({ plan, result, backupArtifact }) => ({
  actorUserId: SYSTEM_ACTOR_ID,
  action: auditService.AUDIT_ACTIONS.GOVERNANCE_OVERRIDE_APPLIED,
  resourceType: auditService.RESOURCE_TYPES.KnowledgePack,
  resourceId: RECONCILIATION_RESOURCE_ID,
  isSystemEvent: true,
  systemEventType: 'KNOWLEDGE_PACK_METADATA_DEV_RECONCILIATION_APPLIED',
  eventCategory: 'KNOWLEDGE_PACK',
  eventSeverity: 'HIGH',
  summary: `Applied ${result.fieldValuesUpdated} Knowledge Pack metadata correction(s) and removed ${result.packsDeleted} duplicate pack(s) in the development database.`,
  display: {
    actorLabel: 'System',
    targetLabel: 'Knowledge Pack metadata development reconciliation',
  },
  diff: {
    operation: 'KNOWLEDGE_PACK_METADATA_DEV_RECONCILIATION',
    backupPath: backupArtifact.path,
    backupSha256: backupArtifact.sha256,
    duplicatePairs: plan.duplicatePairs,
    updates: plan.updates,
    result,
  },
})

const buildRollbackAuditPayload = ({ backup, backupPath }) => ({
  actorUserId: SYSTEM_ACTOR_ID,
  action: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_ROLLED_BACK,
  resourceType: auditService.RESOURCE_TYPES.KnowledgePack,
  resourceId: RECONCILIATION_RESOURCE_ID,
  isSystemEvent: true,
  systemEventType: 'KNOWLEDGE_PACK_METADATA_DEV_RECONCILIATION_ROLLED_BACK',
  eventCategory: 'KNOWLEDGE_PACK',
  eventSeverity: 'HIGH',
  summary: 'Restored the pre-reconciliation Knowledge Pack development snapshot.',
  display: {
    actorLabel: 'System',
    targetLabel: 'Knowledge Pack metadata development reconciliation',
  },
  diff: {
    operation: 'ROLLBACK_KNOWLEDGE_PACK_METADATA_DEV_RECONCILIATION',
    backupPath,
    restoredStateDigest: backup.preStateDigest,
  },
})

const assertMutationResult = ({ result, expected, operation }) => {
  const actual = Number(result?.modifiedCount ?? result?.deletedCount ?? result?.insertedCount ?? 0)
  if (actual !== expected) {
    throw createScriptError('DEV_REHEARSAL_WRITE_COUNT_MISMATCH', `${operation} expected ${expected} row(s), received ${actual}.`, {
      operation,
      expected,
      actual,
    })
  }
}

const countPersistedManifests = async ({ model, session }) => {
  if (typeof model.countDocuments === 'function') return model.countDocuments({}, { session })
  const rows = await resolveQueryRows({ model, session })
  return rows.length
}

export const applyDevRehearsalPlan = async ({
  manifest,
  policy,
  plan,
  backup,
  backupArtifact,
  dependencies = {},
} = {}) => {
  const validatedManifest = validateCorrectionManifest(manifest)
  const validatedPolicy = validateDevPolicy(policy, validatedManifest)
  const approvedPolicy = await loadDevPolicy({ manifest: validatedManifest })
  if (sha256Json(validatedPolicy) !== sha256Json(approvedPolicy)) {
    throw createScriptError('DEV_REHEARSAL_POLICY_NOT_APPROVED', 'Write helper requires the exact checked-in development policy.')
  }
  if (!plan?.ok) throw createScriptError('DEV_REHEARSAL_PLAN_BLOCKED', 'Cannot apply a blocked development reconciliation plan.')
  const resolved = resolveDependencies(dependencies)
  assertDevWriteEnvironment({
    databaseName: resolved.getDatabaseName(),
    nodeEnv: resolved.nodeEnv,
    policy: approvedPolicy,
  })
  validateBackup({
    backup,
    databaseName: resolved.getDatabaseName(),
    manifest: validatedManifest,
    policy: approvedPolicy,
  })
  if (
    !normalizeText(backupArtifact?.path)
    || normalizeToken(backupArtifact?.sha256) !== computeBackupArtifactSha256(backup)
  ) {
    throw createScriptError('DEV_REHEARSAL_BACKUP_HASH_MISMATCH', 'Apply helper requires the exact written backup SHA-256.')
  }
  const session = await resolved.startSession()
  try {
    let result = null
    await session.withTransaction(async () => {
      const transactionalState = await readDevRehearsalState({ dependencies: resolved, session })
      const transactionalPlan = buildDevRehearsalPlan({
        manifest: validatedManifest,
        policy: approvedPolicy,
        state: transactionalState,
      })
      if (!transactionalPlan.ok || sha256Json(transactionalPlan) !== sha256Json(plan)) {
        throw createScriptError(
          'DEV_REHEARSAL_PLAN_CHANGED',
          'Knowledge Pack state changed after preflight; refusing to apply a stale plan.',
          {
            preflightPlanDigest: sha256Json(plan),
            transactionalPlanDigest: sha256Json(transactionalPlan),
            blockers: transactionalPlan.blockers,
          },
        )
      }
      const manifestCount = await countPersistedManifests({ model: resolved.manifestModel, session })
      if (manifestCount !== 0) {
        throw createScriptError('PERSISTED_MANIFESTS_PRESENT', 'Persisted manifests appeared after preflight.', { manifestCount })
      }

      let fieldValuesUpdated = 0
      for (const update of transactionalPlan.updates) {
        const model = resolved.models[update.collectionKey]
        const filter = { [update.idField]: update.recordKey }
        const set = {}
        update.changes.forEach((change) => {
          filter[change.field] = change.from
          set[change.field] = change.to
        })
        const updateResult = await model.updateOne(filter, { $set: set }, {
          runValidators: true,
          session,
        })
        assertMutationResult({ result: updateResult, expected: 1, operation: `update ${update.collectionKey}:${update.recordKey}` })
        fieldValuesUpdated += update.changes.length
      }

      const legacyPackIds = transactionalPlan.duplicatePairs
        .filter((pair) => pair.state === 'DELETE_LEGACY')
        .map((pair) => pair.legacyPackId)
      const deletionCounts = {}
      for (const config of [...COLLECTION_CONFIGS].reverse()) {
        const identifiers = transactionalPlan.duplicatePairs
          .filter((pair) => pair.state === 'DELETE_LEGACY')
          .map((pair) => {
            if (config.collectionKey === 'KnowledgePackVersion') return pair.legacyVersionId
            if (config.collectionKey === 'KnowledgePackActivation') return pair.legacyActivationId
            return pair.legacyPackId
          })
        const deleteResult = legacyPackIds.length > 0
          ? await resolved.models[config.collectionKey].deleteMany(
            { [config.idField]: { $in: identifiers } },
            { session },
          )
          : { deletedCount: 0 }
        assertMutationResult({
          result: deleteResult,
          expected: legacyPackIds.length,
          operation: `delete ${config.collectionKey} legacy duplicates`,
        })
        deletionCounts[config.collectionKey] = Number(deleteResult.deletedCount) || 0
      }

      const stateAfterWrites = await readDevRehearsalState({ dependencies: resolved, session })
      const appliedStateDigest = computeAffectedStateDigest({
        state: stateAfterWrites,
        packIds: backup.packIds,
      })
      if (appliedStateDigest !== backup.expectedAppliedStateDigest) {
        throw createScriptError('DEV_REHEARSAL_POST_WRITE_DIGEST_MISMATCH', 'Transactional readback did not match the projected applied state.', {
          expected: backup.expectedAppliedStateDigest,
          actual: appliedStateDigest,
        })
      }

      result = {
        appliedStateDigest,
        fieldValuesUpdated,
        recordsUpdated: transactionalPlan.updates.length,
        packsDeleted: deletionCounts.KnowledgePack || 0,
        versionsDeleted: deletionCounts.KnowledgePackVersion || 0,
        activationsDeleted: deletionCounts.KnowledgePackActivation || 0,
      }
      await resolved.auditService.log(buildApplyAuditPayload({
        plan: transactionalPlan,
        result,
        backupArtifact,
      }), {
        session,
        throwOnError: true,
      })
    })
    return result
  } finally {
    await session.endSession()
  }
}

export const validateBackup = ({ backup, databaseName, manifest, policy }) => {
  const expectedPackIds = getAffectedPackIds({ manifest, policy })
  const expectedPackIdSet = new Set(expectedPackIds)
  if (
    !backup
    || backup.schemaVersion !== '1.0.0'
    || normalizeText(backup.databaseName) !== normalizeText(databaseName)
    || normalizeToken(backup.correctionRowsSha256) !== policy.correctionRowsSha256
    || normalizeToken(backup.policySha256) !== sha256Json(policy)
    || normalizeToken(backup.planSha256) !== sha256Json(backup.plan)
    || !Array.isArray(backup.packIds)
    || JSON.stringify([...backup.packIds].sort()) !== JSON.stringify(expectedPackIds)
    || !backup.collections
  ) {
    throw createScriptError('DEV_REHEARSAL_BACKUP_INVALID', 'Rollback backup does not match this database and correction policy.')
  }
  const alreadyRemovedLegacyIds = new Set(
    (backup.plan?.duplicatePairs || [])
      .filter((pair) => pair.state === 'ALREADY_REMOVED')
      .map((pair) => pair.legacyPackId),
  )
  const expectedPresentPackIds = expectedPackIds.filter(
    (packId) => !alreadyRemovedLegacyIds.has(packId),
  )
  for (const config of COLLECTION_CONFIGS) {
    const rows = backup.collections[config.collectionKey]
    if (!Array.isArray(rows)) {
      throw createScriptError('DEV_REHEARSAL_BACKUP_SCOPE_INVALID', `Backup collection ${config.collectionKey} is missing.`)
    }
    const recordIds = new Set()
    const rowPackIds = new Set()
    for (const row of rows) {
      const packId = normalizeText(row?.packId)
      const recordId = getId(row, config.idField)
      if (!expectedPackIdSet.has(packId) || !recordId || recordIds.has(recordId)) {
        throw createScriptError('DEV_REHEARSAL_BACKUP_SCOPE_INVALID', `Backup collection ${config.collectionKey} contains an out-of-scope or duplicate row.`)
      }
      recordIds.add(recordId)
      rowPackIds.add(packId)
    }
    if (JSON.stringify([...rowPackIds].sort()) !== JSON.stringify(expectedPresentPackIds)) {
      throw createScriptError('DEV_REHEARSAL_BACKUP_SCOPE_INVALID', `Backup collection ${config.collectionKey} does not cover the approved pack scope.`)
    }
  }
  const actualPreStateDigest = sha256Json(backup.collections)
  if (actualPreStateDigest !== normalizeToken(backup.preStateDigest)) {
    throw createScriptError('DEV_REHEARSAL_BACKUP_TAMPERED', 'Rollback backup content digest is invalid.')
  }
  const reconstructedPlan = buildDevRehearsalPlan({
    manifest,
    policy,
    state: {
      ...backup.collections,
      KnowledgePackManifest: [],
    },
  })
  if (!reconstructedPlan.ok || sha256Json(reconstructedPlan) !== normalizeToken(backup.planSha256)) {
    throw createScriptError('DEV_REHEARSAL_BACKUP_PLAN_INVALID', 'Rollback backup plan does not match its collection snapshot.')
  }
  const actualAppliedStateDigest = sha256Json(projectAppliedState({
    state: backup.collections,
    packIds: backup.packIds,
    plan: reconstructedPlan,
  }))
  if (actualAppliedStateDigest !== normalizeToken(backup.expectedAppliedStateDigest)) {
    throw createScriptError('DEV_REHEARSAL_BACKUP_PROJECTION_INVALID', 'Rollback backup applied-state projection is invalid.')
  }
  return backup
}

export const rollbackDevRehearsal = async ({
  backup,
  backupSha256,
  backupPath,
  currentState,
  manifest,
  policy,
  dependencies = {},
} = {}) => {
  const validatedManifest = validateCorrectionManifest(manifest)
  const validatedPolicy = validateDevPolicy(policy, validatedManifest)
  const approvedPolicy = await loadDevPolicy({ manifest: validatedManifest })
  if (sha256Json(validatedPolicy) !== sha256Json(approvedPolicy)) {
    throw createScriptError('DEV_REHEARSAL_POLICY_NOT_APPROVED', 'Rollback helper requires the exact checked-in development policy.')
  }
  const resolved = resolveDependencies(dependencies)
  assertDevWriteEnvironment({
    databaseName: resolved.getDatabaseName(),
    nodeEnv: resolved.nodeEnv,
    policy: approvedPolicy,
  })
  validateBackup({
    backup,
    databaseName: resolved.getDatabaseName(),
    manifest: validatedManifest,
    policy: approvedPolicy,
  })
  if (normalizeToken(backupSha256) !== computeBackupArtifactSha256(backup)) {
    throw createScriptError('DEV_REHEARSAL_BACKUP_HASH_MISMATCH', 'Rollback helper requires the exact backup SHA-256.')
  }
  const currentDigest = computeAffectedStateDigest({ state: currentState, packIds: backup.packIds })
  if (currentDigest !== backup.expectedAppliedStateDigest) {
    throw createScriptError('DEV_REHEARSAL_ROLLBACK_STATE_DRIFT', 'Current affected rows no longer match the recorded applied state.', {
      expected: backup.expectedAppliedStateDigest,
      actual: currentDigest,
    })
  }

  const session = await resolved.startSession()
  try {
    await session.withTransaction(async () => {
      const transactionalCurrentState = await readDevRehearsalState({
        dependencies: resolved,
        session,
      })
      const transactionalCurrentDigest = computeAffectedStateDigest({
        state: transactionalCurrentState,
        packIds: backup.packIds,
      })
      if (transactionalCurrentDigest !== backup.expectedAppliedStateDigest) {
        throw createScriptError(
          'DEV_REHEARSAL_ROLLBACK_STATE_DRIFT',
          'Affected rows changed after rollback preflight.',
          {
            expected: backup.expectedAppliedStateDigest,
            actual: transactionalCurrentDigest,
          },
        )
      }
      const manifestCount = await countPersistedManifests({ model: resolved.manifestModel, session })
      if (manifestCount !== 0) {
        throw createScriptError('PERSISTED_MANIFESTS_PRESENT', 'Persisted manifests block rollback.', { manifestCount })
      }
      for (const config of [...COLLECTION_CONFIGS].reverse()) {
        const currentRows = (currentState?.[config.collectionKey] || [])
          .filter((row) => backup.packIds.includes(normalizeText(row?.packId)))
        const deleteResult = await resolved.models[config.collectionKey].deleteMany(
          { packId: { $in: backup.packIds } },
          { session },
        )
        assertMutationResult({
          result: deleteResult,
          expected: currentRows.length,
          operation: `clear ${config.collectionKey} before rollback`,
        })
      }
      for (const config of COLLECTION_CONFIGS) {
        const documents = backup.collections[config.collectionKey] || []
        if (documents.length > 0) {
          const inserted = await resolved.models[config.collectionKey].insertMany(documents, {
            ordered: true,
            session,
          })
          if (!Array.isArray(inserted) || inserted.length !== documents.length) {
            throw createScriptError('DEV_REHEARSAL_WRITE_COUNT_MISMATCH', `Rollback insert for ${config.collectionKey} did not restore every row.`)
          }
        }
      }
      const restoredState = await readDevRehearsalState({ dependencies: resolved, session })
      const restoredDigest = computeAffectedStateDigest({ state: restoredState, packIds: backup.packIds })
      if (restoredDigest !== backup.preStateDigest) {
        throw createScriptError('DEV_REHEARSAL_ROLLBACK_DIGEST_MISMATCH', 'Transactional rollback readback did not match the backup.', {
          expected: backup.preStateDigest,
          actual: restoredDigest,
        })
      }
      await resolved.auditService.log(buildRollbackAuditPayload({ backup, backupPath }), {
        session,
        throwOnError: true,
      })
    })
    return { restoredStateDigest: backup.preStateDigest }
  } finally {
    await session.endSession()
  }
}

export const writeDevRehearsalReport = async ({
  report,
  reportDir = DEFAULT_DEV_REHEARSAL_DIR,
  now = new Date(),
} = {}) => writeJsonArtifact({
  directory: reportDir,
  filename: `knowledge-pack-metadata-dev-${report.mode}-${buildTimestamp(now)}.json`,
  value: report,
})

export const formatDevRehearsalReport = (report) => {
  const lines = [
    `Knowledge Pack metadata development rehearsal - ${normalizeToken(report.mode)}`,
    `Database: ${report.databaseName}; NODE_ENV=${report.nodeEnv}.`,
  ]
  if (report.plan) {
    lines.push(
      `Plan: ${report.plan.summary.recordsToUpdate} records / ${report.plan.summary.fieldValuesToUpdate} field values to update; ${report.plan.summary.duplicatePairsToDelete} duplicate triplets to delete; ${report.plan.summary.deferredCorrections} corrections deferred; ${report.plan.summary.blockers} blockers.`,
    )
  }
  if (report.applyResult) {
    lines.push(
      `Applied: ${report.applyResult.fieldValuesUpdated} field values; deleted ${report.applyResult.packsDeleted} packs, ${report.applyResult.versionsDeleted} versions, ${report.applyResult.activationsDeleted} activations.`,
      `Backup: ${report.backup.path} (${report.backup.sha256}).`,
    )
  }
  if (report.rollbackResult) lines.push(`Rollback restored digest ${report.rollbackResult.restoredStateDigest}.`)
  if (report.reportPath) lines.push(`Report: ${report.reportPath}`)
  return lines.join('\n')
}

export const runDevKnowledgePackMetadataRehearsal = async ({
  argv = process.argv.slice(2),
  dependencies = {},
  logger = console.log,
  manifest: manifestInput = null,
  policy: policyInput = null,
  reportDir = DEFAULT_DEV_REHEARSAL_DIR,
  now = new Date(),
} = {}) => {
  const args = parseDevRehearsalArgs(argv)
  if ((args.apply || args.rollbackPath) && !args.confirm) {
    throw createScriptError('DEV_REHEARSAL_CONFIRMATION_REQUIRED', `Refusing write without ${CONFIRM_FLAG}.`)
  }
  if (args.apply && args.rollbackPath) {
    throw createScriptError('DEV_REHEARSAL_MODE_INVALID', 'Choose either --apply or --rollback, not both.')
  }
  if (args.rollbackPath && !/^[A-F0-9]{64}$/.test(args.backupSha256)) {
    throw createScriptError(
      'DEV_REHEARSAL_BACKUP_HASH_REQUIRED',
      'Rollback requires --backup-sha256 with the hash emitted by apply.',
    )
  }

  const resolved = resolveDependencies(dependencies)
  await resolved.connect()
  try {
    const manifest = manifestInput
      ? validateCorrectionManifest(manifestInput)
      : await loadCorrectionManifest()
    const policy = policyInput
      ? validateDevPolicy(policyInput, manifest)
      : await loadDevPolicy({ manifest })
    const sourceCheck = dependencies.sourceCheck
      || await verifyManifestSource({ manifest, rootDir: dependencies.workspaceRoot || workspaceRoot })
    if (!sourceCheck.ok) {
      throw createScriptError('DEV_REHEARSAL_SOURCE_INVALID', 'Archived workbook verification failed.', sourceCheck)
    }
    const databaseName = normalizeText(resolved.getDatabaseName())
    const nodeEnv = normalizeText(resolved.nodeEnv).toLowerCase()

    if (args.apply || args.rollbackPath) {
      assertDevWriteEnvironment({ databaseName, nodeEnv, policy })
    }

    if (args.rollbackPath) {
      const backupPath = path.resolve(args.rollbackPath)
      const backupPayload = await fs.readFile(backupPath, 'utf8')
      const actualBackupSha256 = crypto.createHash('sha256').update(backupPayload).digest('hex').toUpperCase()
      if (actualBackupSha256 !== args.backupSha256) {
        throw createScriptError('DEV_REHEARSAL_BACKUP_HASH_MISMATCH', 'Rollback backup file does not match the supplied SHA-256.', {
          expected: args.backupSha256,
          actual: actualBackupSha256,
        })
      }
      const backup = validateBackup({
        backup: JSON.parse(backupPayload),
        databaseName,
        manifest,
        policy,
      })
      const currentState = await readDevRehearsalState({ dependencies: resolved })
      const rollbackResult = await rollbackDevRehearsal({
        backup,
        backupSha256: args.backupSha256,
        backupPath,
        currentState,
        manifest,
        policy,
        dependencies: resolved,
      })
      const report = { mode: 'rollback', databaseName, nodeEnv, rollbackResult }
      const artifact = await writeDevRehearsalReport({ report, reportDir, now })
      const result = { ...report, reportPath: artifact.path, reportSha256: artifact.sha256 }
      logger(args.json ? JSON.stringify(result, null, 2) : formatDevRehearsalReport(result))
      return result
    }

    const state = dependencies.state || await readDevRehearsalState({ dependencies: resolved })
    const plan = buildDevRehearsalPlan({ manifest, policy, state })
    let backupArtifact = null
    let applyResult = null
    if (args.apply) {
      if (!plan.ok) {
        throw createScriptError('DEV_REHEARSAL_PLAN_BLOCKED', 'Development reconciliation preflight is blocked.', {
          blockers: plan.blockers,
        })
      }
      const backup = buildDevBackup({ databaseName, manifest, policy, plan, state, now })
      backupArtifact = await writeDevBackup({ backup, reportDir, now })
      applyResult = await applyDevRehearsalPlan({
        manifest,
        policy,
        plan,
        backup,
        backupArtifact,
        dependencies: resolved,
      })
    }

    const report = {
      mode: args.apply ? 'apply' : 'dry-run',
      databaseName,
      nodeEnv,
      sourceCheck,
      plan,
      ...(backupArtifact ? { backup: backupArtifact } : {}),
      ...(applyResult ? { applyResult } : {}),
    }
    const artifact = await writeDevRehearsalReport({ report, reportDir, now })
    const result = { ...report, reportPath: artifact.path, reportSha256: artifact.sha256 }
    logger(args.json ? JSON.stringify(result, null, 2) : formatDevRehearsalReport(result))
    return result
  } finally {
    await resolved.disconnect()
  }
}

const printHelp = () => console.log(`
rehearseKnowledgePackMetadataReconciliation.js

Usage:
  node src/scripts/rehearseKnowledgePackMetadataReconciliation.js [--json]
  node src/scripts/rehearseKnowledgePackMetadataReconciliation.js --apply ${CONFIRM_FLAG} [--json]
  node src/scripts/rehearseKnowledgePackMetadataReconciliation.js --rollback <backup.json> --backup-sha256 <sha256> ${CONFIRM_FLAG} [--json]

Writes are allowed only in the checked-in development/test environment allowlist. The production-facing
knowledge-packs:reconcile-metadata command remains read-only.
`.trim())

const isDirectExecution = () => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  const args = parseDevRehearsalArgs()
  if (args.help) {
    printHelp()
  } else {
    runDevKnowledgePackMetadataRehearsal().catch((error) => {
      console.error(`${error.code || 'ERROR'}: ${error.message}`)
      if (error.details && Object.keys(error.details).length > 0) {
        console.error(JSON.stringify(error.details, null, 2))
      }
      process.exitCode = 1
    })
  }
}
