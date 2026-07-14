import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { connectDb, disconnectDb } from '../config/db.js'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackManifest,
  KnowledgePackVersion,
} from '../models/index.js'
import {
  OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_TYPES,
} from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES,
} from '../constants/knowledgeRuntime.js'
import { OUTCOME_STUDIO_REQUIRED_PACKS } from '../constants/runtimeOutcomeStudio.js'
import { KNOWLEDGE_PACK_CATEGORIES } from '../constants/workspaceGovernance.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
// Reports and workbook evidence intentionally live in the dev-v1 workspace, not the API package.
const workspaceRoot = path.resolve(scriptDir, '../../..')
const DEFAULT_MANIFEST_PATH = path.resolve(
  scriptDir,
  'data/knowledgePackMetadataCorrections.v1.json',
)
export const DEFAULT_REPORT_DIR = path.resolve(
  workspaceRoot,
  'docs/generated/knowledge-pack-metadata-reconciliation',
)

const SUPPORTED_SCHEMA_VERSION = '1.0.0'
const MANIFEST_SECTION_NAMES = Object.freeze([
  'mandatoryPacks',
  'optionalPacks',
  'validationPacks',
  'blockedPacks',
])
const ALLOWED_FIELDS = Object.freeze([
  'packType',
  'purposeCategory',
  'executionMode',
  'packCategory',
])

const MODEL_CONFIGS = Object.freeze([
  Object.freeze({
    collectionKey: 'KnowledgePack',
    idField: 'packId',
    selectFields: 'packId packType packKey packCategory purposeCategory executionMode status latestVersionId',
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackVersion',
    idField: 'versionId',
    selectFields: 'versionId packId packType packKey packCategory purposeCategory executionMode status semanticVersion scopeKey',
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackActivation',
    idField: 'activationId',
    selectFields: 'activationId packId versionId packType packKey packCategory purposeCategory executionMode status semanticVersion scopeKey',
  }),
])

export const VALID_VALUES_BY_FIELD = Object.freeze({
  packType: new Set(Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES)),
  purposeCategory: new Set(Object.values(KNOWLEDGE_PACK_PURPOSE_CATEGORIES)),
  executionMode: new Set(Object.values(KNOWLEDGE_PACK_EXECUTION_MODES)),
  packCategory: new Set(Object.values(KNOWLEDGE_PACK_CATEGORIES)),
})

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

const createScriptError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

export const parseArgs = (argv = process.argv.slice(2)) => {
  const args = new Set(argv)
  return {
    apply: args.has('--apply'),
    json: args.has('--json'),
    help: args.has('--help') || args.has('-h'),
  }
}

const countManifestCorrections = (manifest) =>
  manifest.packs.reduce((count, pack) => count + pack.corrections.length, 0)

const normalizeCorrectionRows = (packs = []) => packs
  .flatMap((pack) => pack.corrections.map((correction) => ({
    packId: pack.packId,
    packKey: pack.packKey,
    label: pack.label,
    ...correction,
  })))
  .sort((left, right) =>
    `${left.packId}:${left.field}`.localeCompare(`${right.packId}:${right.field}`),
  )

export const computeCorrectionRowsSha256 = (packs = []) => crypto
  .createHash('sha256')
  .update(JSON.stringify(normalizeCorrectionRows(packs)))
  .digest('hex')
  .toUpperCase()

export const validateCorrectionManifest = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createScriptError('MANIFEST_INVALID', 'Correction manifest must be an object.')
  }
  if (normalizeText(input.schemaVersion) !== SUPPORTED_SCHEMA_VERSION) {
    throw createScriptError(
      'MANIFEST_SCHEMA_UNSUPPORTED',
      `Correction manifest schema must be ${SUPPORTED_SCHEMA_VERSION}.`,
    )
  }
  if (!Array.isArray(input.packs) || input.packs.length === 0) {
    throw createScriptError('MANIFEST_INVALID', 'Correction manifest must contain packs.')
  }

  const declaredAllowedFields = Array.isArray(input.allowedFields)
    ? [...new Set(input.allowedFields.map(normalizeText).filter(Boolean))]
    : []
  if (
    declaredAllowedFields.length !== ALLOWED_FIELDS.length
    || ALLOWED_FIELDS.some((field) => !declaredAllowedFields.includes(field))
  ) {
    throw createScriptError(
      'MANIFEST_ALLOWED_FIELDS_MISMATCH',
      `Correction manifest allowedFields must be exactly: ${ALLOWED_FIELDS.join(', ')}.`,
    )
  }

  const packIds = new Set()
  const correctionKeys = new Set()
  const packs = input.packs.map((pack) => {
    const packId = normalizeText(pack?.packId)
    const packKey = normalizeLowerKey(pack?.packKey)
    const label = normalizeText(pack?.label)
    if (!packId || !packKey || !label || !Array.isArray(pack?.corrections) || pack.corrections.length === 0) {
      throw createScriptError('MANIFEST_PACK_INVALID', `Invalid manifest pack ${packId || '<missing>'}.`)
    }
    if (packIds.has(packId)) {
      throw createScriptError('MANIFEST_PACK_DUPLICATE', `Duplicate manifest pack ${packId}.`)
    }
    packIds.add(packId)

    const corrections = pack.corrections.map((correction) => {
      const field = normalizeText(correction?.field)
      const from = normalizeToken(correction?.from)
      const to = normalizeToken(correction?.to)
      const reason = normalizeText(correction?.reason)
      if (!ALLOWED_FIELDS.includes(field) || !from || !to || !reason || from === to) {
        throw createScriptError(
          'MANIFEST_CORRECTION_INVALID',
          `Invalid correction ${packId}.${field || '<missing>'}.`,
        )
      }
      const correctionKey = `${packId}:${field}`
      if (correctionKeys.has(correctionKey)) {
        throw createScriptError('MANIFEST_CORRECTION_DUPLICATE', `Duplicate correction ${correctionKey}.`)
      }
      correctionKeys.add(correctionKey)
      return { field, from, to, reason }
    })

    return { packId, packKey, label, corrections }
  })

  const expectedPacks = Number(input.expectations?.changedPacks)
  const expectedCorrections = Number(input.expectations?.corrections)
  const actualCorrections = countManifestCorrections({ packs })
  if (expectedPacks !== packs.length || expectedCorrections !== actualCorrections) {
    throw createScriptError('MANIFEST_EXPECTATIONS_MISMATCH', 'Manifest summary does not match its rows.', {
      expectedPacks,
      actualPacks: packs.length,
      expectedCorrections,
      actualCorrections,
    })
  }

  const expectedRowsHash = normalizeToken(input.source?.changeLogRowsSha256)
  const actualRowsHash = computeCorrectionRowsSha256(packs)
  if (!/^[A-F0-9]{64}$/.test(expectedRowsHash) || expectedRowsHash !== actualRowsHash) {
    throw createScriptError(
      'MANIFEST_SOURCE_ROWS_MISMATCH',
      'Correction manifest rows do not match the normalized source Change Log digest.',
      { expectedRowsHash, actualRowsHash },
    )
  }

  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    source: {
      workbook: normalizeText(input.source?.workbook),
      sheet: normalizeText(input.source?.sheet),
      sha256: normalizeToken(input.source?.sha256),
      changeLogRowsSha256: expectedRowsHash,
    },
    expectations: {
      correctedLibraryRecords: Number(input.expectations?.correctedLibraryRecords) || 0,
      changedPacks: packs.length,
      corrections: actualCorrections,
    },
    allowedFields: [...ALLOWED_FIELDS],
    packs,
  }
}

export const loadCorrectionManifest = async (manifestPath = DEFAULT_MANIFEST_PATH) => {
  const payload = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  return validateCorrectionManifest(payload)
}

export const verifyManifestSource = async ({ manifest, rootDir = workspaceRoot } = {}) => {
  const workbook = normalizeText(manifest?.source?.workbook)
  const expectedHash = normalizeToken(manifest?.source?.sha256)
  if (!workbook || !expectedHash) {
    return {
      ok: false,
      code: 'MANIFEST_SOURCE_MISSING',
      workbook,
      expectedHash,
      actualHash: '',
    }
  }

  const sourcePath = path.resolve(rootDir, workbook)
  const relativePath = path.relative(rootDir, sourcePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return {
      ok: false,
      code: 'MANIFEST_SOURCE_OUTSIDE_WORKSPACE',
      workbook,
      expectedHash,
      actualHash: '',
    }
  }

  try {
    const source = await fs.readFile(sourcePath)
    const actualHash = crypto.createHash('sha256').update(source).digest('hex').toUpperCase()
    return {
      ok: actualHash === expectedHash,
      code: actualHash === expectedHash ? 'SOURCE_HASH_MATCH' : 'SOURCE_HASH_MISMATCH',
      workbook,
      sourcePath,
      expectedHash,
      actualHash,
    }
  } catch (error) {
    return {
      ok: false,
      code: error?.code === 'ENOENT' ? 'MANIFEST_SOURCE_NOT_FOUND' : 'MANIFEST_SOURCE_READ_FAILED',
      workbook,
      sourcePath,
      expectedHash,
      actualHash: '',
    }
  }
}

const resolveQueryRows = async (query, selectFields) => {
  if (!query) return []
  if (typeof query.select === 'function') {
    const selected = query.select(selectFields)
    if (selected && typeof selected.lean === 'function') return selected.lean()
    return selected
  }
  if (typeof query.lean === 'function') return query.lean()
  return query
}

const createDefaultDependencies = () => ({
  connect: connectDb,
  disconnect: disconnectDb,
  models: {
    KnowledgePack,
    KnowledgePackActivation,
    KnowledgePackManifest,
    KnowledgePackVersion,
  },
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

export const readKnowledgePackMetadataRows = async ({ dependencies = {} } = {}) => {
  const resolved = resolveDependencies(dependencies)
  const rowsByCollection = {}
  for (const config of MODEL_CONFIGS) {
    const model = resolved.models[config.collectionKey]
    const rows = await resolveQueryRows(model?.find ? model.find({}) : [], config.selectFields)
    rowsByCollection[config.collectionKey] = Array.isArray(rows) ? rows : []
  }
  const manifestQuery = resolved.models.KnowledgePackManifest?.find
    ? resolved.models.KnowledgePackManifest.find({})
    : []
  const manifestRows = await resolveQueryRows(
    manifestQuery,
    'manifestId manifestKey manifestName status mandatoryPacks optionalPacks validationPacks blockedPacks',
  )
  rowsByCollection.KnowledgePackManifest = Array.isArray(manifestRows) ? manifestRows : []
  return rowsByCollection
}

const buildCorrectionMap = (manifest) => new Map(
  manifest.packs.map((pack) => [pack.packId, new Map(
    pack.corrections.map((correction) => [correction.field, correction]),
  )]),
)

const getRecordKey = (row, config) => normalizeText(row?.[config.idField] || row?._id)

const evaluateRecord = ({ row, config, pack, correctionMap }) => {
  const changes = []
  for (const correction of pack.corrections) {
    const rawCurrentValue = normalizeText(row?.[correction.field])
    const currentValue = normalizeToken(rawCurrentValue)
    let state = 'DRIFT'
    if (currentValue === correction.to) state = 'ALREADY_CORRECT'
    if (currentValue === correction.from) state = 'PENDING'
    changes.push({
      field: correction.field,
      expectedOriginalValue: correction.from,
      correctedValue: correction.to,
      currentValue,
      rawCurrentValue,
      reason: correction.reason,
      state,
    })
  }

  return {
    collectionKey: config.collectionKey,
    idField: config.idField,
    recordKey: getRecordKey(row, config),
    packId: normalizeText(row?.packId),
    packKey: normalizeLowerKey(row?.packKey),
    status: normalizeToken(row?.status),
    projectedPackType: correctionMap.get('packType')?.to || normalizeToken(row?.packType),
    changes,
  }
}

const projectRow = ({ row, correctionMap }) => {
  const projected = { ...row }
  if (correctionMap) {
    for (const [field, correction] of correctionMap.entries()) {
      projected[field] = correction.to
    }
  }
  return projected
}

const buildCollisionIdentity = (config, row) => {
  const packType = normalizeToken(row?.packType)
  const packKey = normalizeLowerKey(row?.packKey)
  if (!packType || !packKey) return ''
  if (config.collectionKey === 'KnowledgePack') return `${packType}:${packKey}`
  if (config.collectionKey === 'KnowledgePackVersion') {
    return `${packType}:${packKey}:${normalizeText(row?.semanticVersion)}:${normalizeToken(row?.scopeKey)}`
  }
  if (
    config.collectionKey === 'KnowledgePackActivation'
    && normalizeToken(row?.status) === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE
  ) {
    return `${packType}:${packKey}:${normalizeToken(row?.scopeKey)}:ACTIVE`
  }
  return ''
}

const findProjectedCollisions = ({ config, rows, correctionByPackId, targetPackIds }) => {
  const groups = new Map()
  for (const row of rows) {
    const packId = normalizeText(row?.packId)
    const projected = projectRow({ row, correctionMap: correctionByPackId.get(packId) })
    const identity = buildCollisionIdentity(config, projected)
    if (!identity) continue
    const group = groups.get(identity) || []
    group.push({
      recordKey: getRecordKey(row, config),
      packId,
      packType: normalizeToken(projected.packType),
      packKey: normalizeLowerKey(projected.packKey),
      status: normalizeToken(projected.status),
      semanticVersion: normalizeText(projected.semanticVersion),
      scopeKey: normalizeToken(projected.scopeKey),
      targeted: targetPackIds.has(packId),
    })
    groups.set(identity, group)
  }

  return [...groups.entries()]
    .filter(([, records]) => records.length > 1 && records.some((record) => record.targeted))
    .map(([identity, records]) => ({
      code: 'TARGET_IDENTITY_COLLISION',
      collectionKey: config.collectionKey,
      identity,
      records,
    }))
}

const summarizeCollection = ({ config, rows, recordPlans }) => ({
  collectionKey: config.collectionKey,
  idField: config.idField,
  scanned: rows.length,
  targeted: recordPlans.length,
  pending: recordPlans.reduce(
    (count, record) => count + record.changes.filter((change) => change.state === 'PENDING').length,
    0,
  ),
  alreadyCorrect: recordPlans.reduce(
    (count, record) => count + record.changes.filter((change) => change.state === 'ALREADY_CORRECT').length,
    0,
  ),
  drifted: recordPlans.reduce(
    (count, record) => count + record.changes.filter((change) => change.state === 'DRIFT').length,
    0,
  ),
  records: recordPlans,
})

const buildRequiredPackIdentity = ({ packType, packKey } = {}) =>
  `${normalizeToken(packType)}:${normalizeLowerKey(packKey)}`

const findManifestReferences = ({ manifestRows, manifest, packRowsById }) => {
  const targets = manifest.packs
    .map((pack) => {
      const packRow = packRowsById.get(pack.packId)
      if (!packRow) return null
      const packTypeCorrection = pack.corrections.find((correction) => correction.field === 'packType')
      return {
        pack,
        packKey: normalizeLowerKey(packRow.packKey),
        currentPackType: normalizeToken(packRow.packType),
        correctedPackType: packTypeCorrection?.to || normalizeToken(packRow.packType),
      }
    })
    .filter(Boolean)

  const references = []
  for (const manifestRow of manifestRows) {
    for (const section of MANIFEST_SECTION_NAMES) {
      const entries = Array.isArray(manifestRow?.[section]) ? manifestRow[section] : []
      entries.forEach((entry, index) => {
        const entryPackKey = normalizeLowerKey(entry?.packKey)
        const entryPackType = normalizeToken(entry?.packType)
        const target = targets.find((candidate) =>
          candidate.packKey === entryPackKey
          && [candidate.currentPackType, candidate.correctedPackType].includes(entryPackType),
        )
        if (!target) return

        const affectedFields = target.pack.corrections
          .filter((correction) => normalizeToken(entry?.[correction.field]) !== correction.to)
          .map((correction) => correction.field)
        if (affectedFields.length === 0) return

        references.push({
          manifestId: normalizeText(manifestRow?.manifestId || manifestRow?._id),
          manifestKey: normalizeLowerKey(manifestRow?.manifestKey),
          manifestName: normalizeText(manifestRow?.manifestName),
          manifestStatus: normalizeToken(manifestRow?.status),
          section,
          index,
          packId: target.pack.packId,
          packKey: target.packKey,
          entryPackType,
          correctedPackType: target.correctedPackType,
          affectedFields,
        })
      })
    }
  }
  return references
}

const findHistoricalRecords = ({ versionRows, activationRows, packRowsById, targetPackIds }) => {
  const records = []
  versionRows.forEach((row) => {
    const packId = normalizeText(row?.packId)
    if (!targetPackIds.has(packId)) return
    const latestVersionId = normalizeText(packRowsById.get(packId)?.latestVersionId)
    const versionId = normalizeText(row?.versionId || row?._id)
    if (latestVersionId && versionId !== latestVersionId) {
      records.push({
        collectionKey: 'KnowledgePackVersion',
        recordKey: versionId,
        packId,
        status: normalizeToken(row?.status),
        reason: 'NOT_LATEST_VERSION',
      })
    }
  })
  activationRows.forEach((row) => {
    const packId = normalizeText(row?.packId)
    if (
      targetPackIds.has(packId)
      && normalizeToken(row?.status) !== OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE
    ) {
      records.push({
        collectionKey: 'KnowledgePackActivation',
        recordKey: normalizeText(row?.activationId || row?._id),
        packId,
        status: normalizeToken(row?.status),
        reason: 'NOT_ACTIVE_ACTIVATION',
      })
    }
  })
  return records
}

export const buildKnowledgePackMetadataReconciliationPlan = ({
  manifest,
  rowsByCollection,
  sourceCheck = { ok: true, code: 'SOURCE_HASH_MATCH' },
} = {}) => {
  const validatedManifest = validateCorrectionManifest(manifest)
  const correctionByPackId = buildCorrectionMap(validatedManifest)
  const manifestByPackId = new Map(validatedManifest.packs.map((pack) => [pack.packId, pack]))
  const targetPackIds = new Set(manifestByPackId.keys())
  const blockers = []

  if (!sourceCheck?.ok) {
    blockers.push({
      code: sourceCheck?.code || 'MANIFEST_SOURCE_INVALID',
      workbook: sourceCheck?.workbook || validatedManifest.source.workbook,
      expectedHash: sourceCheck?.expectedHash || validatedManifest.source.sha256,
      actualHash: sourceCheck?.actualHash || '',
    })
  }

  for (const pack of validatedManifest.packs) {
    for (const correction of pack.corrections) {
      if (correction.field === 'packType') {
        blockers.push({
          code: 'PACK_TYPE_IDENTITY_STRATEGY_REQUIRED',
          packId: pack.packId,
          packKey: pack.packKey,
          currentPackType: correction.from,
          correctedPackType: correction.to,
        })
      }
      if (!VALID_VALUES_BY_FIELD[correction.field]?.has(correction.to)) {
        blockers.push({
          code: 'MANIFEST_VALUE_UNSUPPORTED',
          packId: pack.packId,
          field: correction.field,
          value: correction.to,
        })
      }
    }
  }

  const packRows = rowsByCollection?.KnowledgePack || []
  const packRowsById = new Map(packRows.map((row) => [normalizeText(row?.packId), row]))
  const versionRows = rowsByCollection?.KnowledgePackVersion || []
  const activationRows = rowsByCollection?.KnowledgePackActivation || []
  const manifestRows = rowsByCollection?.KnowledgePackManifest || []
  const requiredPackIdentities = new Set(OUTCOME_STUDIO_REQUIRED_PACKS.map(buildRequiredPackIdentity))

  for (const pack of validatedManifest.packs) {
    const packRow = packRowsById.get(pack.packId)
    if (!packRow) {
      blockers.push({ code: 'TARGET_PACK_MISSING', packId: pack.packId, packKey: pack.packKey })
      continue
    }
    if (normalizeLowerKey(packRow.packKey) !== pack.packKey) {
      blockers.push({
        code: 'TARGET_PACK_KEY_MISMATCH',
        packId: pack.packId,
        expectedPackKey: pack.packKey,
        actualPackKey: normalizeLowerKey(packRow.packKey),
      })
    }

    const executionModeCorrection = pack.corrections.find(
      (correction) => correction.field === 'executionMode',
    )
    if (
      executionModeCorrection
      && executionModeCorrection.to !== KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT
      && requiredPackIdentities.has(buildRequiredPackIdentity(packRow))
    ) {
      blockers.push({
        code: 'REQUIRED_PACK_EXECUTION_CONFLICT',
        packId: pack.packId,
        packType: normalizeToken(packRow.packType),
        packKey: normalizeLowerKey(packRow.packKey),
        correctedExecutionMode: executionModeCorrection.to,
      })
    }

    if (normalizeToken(packRow.status) === OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE) {
      const relatedVersions = versionRows.filter((row) => normalizeText(row?.packId) === pack.packId)
      const relatedActiveActivations = activationRows.filter((row) =>
        normalizeText(row?.packId) === pack.packId
        && normalizeToken(row?.status) === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
      )
      if (relatedVersions.length === 0) {
        blockers.push({ code: 'ACTIVE_PACK_VERSION_MISSING', packId: pack.packId })
      }
      if (relatedActiveActivations.length === 0) {
        blockers.push({ code: 'ACTIVE_PACK_ACTIVATION_MISSING', packId: pack.packId })
      }
      const relatedVersionIds = new Set(
        relatedVersions.map((row) => normalizeText(row?.versionId || row?._id)).filter(Boolean),
      )
      relatedActiveActivations.forEach((activation) => {
        const activationVersionId = normalizeText(activation?.versionId)
        if (!activationVersionId || !relatedVersionIds.has(activationVersionId)) {
          blockers.push({
            code: 'ACTIVE_ACTIVATION_VERSION_REFERENCE_INVALID',
            packId: pack.packId,
            activationId: normalizeText(activation?.activationId || activation?._id),
            versionId: activationVersionId,
          })
        }
      })
    }
  }

  const collections = MODEL_CONFIGS.map((config) => {
    const rows = rowsByCollection?.[config.collectionKey] || []
    const recordPlans = rows
      .filter((row) => targetPackIds.has(normalizeText(row?.packId)))
      .map((row) => {
        const packId = normalizeText(row?.packId)
        const pack = manifestByPackId.get(packId)
        return evaluateRecord({
          row,
          config,
          pack,
          correctionMap: correctionByPackId.get(packId),
        })
      })

    for (const record of recordPlans) {
      for (const change of record.changes.filter((item) => item.state === 'DRIFT')) {
        blockers.push({
          code: 'CURRENT_VALUE_DRIFT',
          collectionKey: config.collectionKey,
          recordKey: record.recordKey,
          packId: record.packId,
          field: change.field,
          expectedOriginalValue: change.expectedOriginalValue,
          correctedValue: change.correctedValue,
          currentValue: change.currentValue,
        })
      }
    }

    return summarizeCollection({ config, rows, recordPlans })
  })

  const collisions = MODEL_CONFIGS.flatMap((config) => findProjectedCollisions({
    config,
    rows: rowsByCollection?.[config.collectionKey] || [],
    correctionByPackId,
    targetPackIds,
  }))
  blockers.push(...collisions)

  const manifestReferences = findManifestReferences({
    manifestRows,
    manifest: validatedManifest,
    packRowsById,
  })
  manifestReferences.forEach((reference) => {
    blockers.push({
      code: 'MANIFEST_REFERENCE_REQUIRES_DECISION',
      ...reference,
    })
  })

  const historicalRecords = findHistoricalRecords({
    versionRows,
    activationRows,
    packRowsById,
    targetPackIds,
  })
  if (historicalRecords.length > 0) {
    blockers.push({
      code: 'HISTORICAL_METADATA_POLICY_REQUIRED',
      records: historicalRecords,
    })
  }

  const summary = {
    manifestPacks: validatedManifest.expectations.changedPacks,
    manifestCorrections: validatedManifest.expectations.corrections,
    collectionsScanned: collections.length,
    recordsScanned: collections.reduce((count, collection) => count + collection.scanned, 0),
    recordsTargeted: collections.reduce((count, collection) => count + collection.targeted, 0),
    pendingFieldChanges: collections.reduce((count, collection) => count + collection.pending, 0),
    alreadyCorrectFieldValues: collections.reduce(
      (count, collection) => count + collection.alreadyCorrect,
      0,
    ),
    driftedFieldValues: collections.reduce((count, collection) => count + collection.drifted, 0),
    blockers: blockers.length,
    collisions: collisions.length,
    manifestsScanned: manifestRows.length,
    manifestReferences: manifestReferences.length,
    historicalRecords: historicalRecords.length,
  }

  return {
    ok: blockers.length === 0,
    mode: 'dry-run',
    source: validatedManifest.source,
    sourceCheck,
    summary,
    collections,
    collisions,
    manifestReferences,
    historicalRecords,
    blockers,
  }
}

const buildTimestamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-')

export const writeReconciliationReport = async ({
  report,
  reportDir = DEFAULT_REPORT_DIR,
  now = new Date(),
} = {}) => {
  await fs.mkdir(reportDir, { recursive: true })
  const mode = 'dry-run'
  const reportPath = path.resolve(
    reportDir,
    `knowledge-pack-metadata-reconciliation-${mode}-${buildTimestamp(now)}.json`,
  )
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return reportPath
}

export const formatTextReport = (report) => {
  const lines = [
    `Knowledge Pack metadata reconciliation - ${report.mode.toUpperCase()}`,
    `Source: ${report.source.workbook} (${report.sourceCheck.code})`,
    `Manifest: ${report.summary.manifestPacks} packs, ${report.summary.manifestCorrections} corrections.`,
    `Database: scanned=${report.summary.recordsScanned}; targeted=${report.summary.recordsTargeted}; pendingFields=${report.summary.pendingFieldChanges}; alreadyCorrect=${report.summary.alreadyCorrectFieldValues}.`,
    `References: manifestsScanned=${report.summary.manifestsScanned}; affectedManifestEntries=${report.summary.manifestReferences}; historicalRecords=${report.summary.historicalRecords}.`,
    `Preflight: ${report.ok ? 'PASS' : 'BLOCKED'}; blockers=${report.summary.blockers}; collisions=${report.summary.collisions}; drift=${report.summary.driftedFieldValues}; applyEnabled=false.`,
  ]
  report.collections.forEach((collection) => {
    lines.push(
      `${collection.collectionKey}: scanned=${collection.scanned}; targeted=${collection.targeted}; pending=${collection.pending}; alreadyCorrect=${collection.alreadyCorrect}; drift=${collection.drifted}.`,
    )
  })
  report.blockers.forEach((blocker) => {
    const target = blocker.packId
      || blocker.identity
      || blocker.recordKey
      || blocker.workbook
      || (Array.isArray(blocker.records) ? `${blocker.records.length} historical records` : 'manifest')
    lines.push(`- ${blocker.code}: ${target}`)
  })
  if (report.reportPath) lines.push(`Report: ${report.reportPath}`)
  return lines.join('\n')
}

export const reconcileKnowledgePackMetadata = async ({
  apply = false,
  json = false,
  logger = console.log,
  dependencies = {},
  manifest: manifestInput = null,
  manifestPath = DEFAULT_MANIFEST_PATH,
  reportDir = DEFAULT_REPORT_DIR,
  now = new Date(),
} = {}) => {
  const resolved = resolveDependencies(dependencies)
  await resolved.connect()
  try {
    const manifest = manifestInput
      ? validateCorrectionManifest(manifestInput)
      : await loadCorrectionManifest(manifestPath)
    const sourceCheck = dependencies.sourceCheck
      || await verifyManifestSource({ manifest, rootDir: dependencies.workspaceRoot || workspaceRoot })
    const rowsByCollection = dependencies.rowsByCollection
      || await readKnowledgePackMetadataRows({ dependencies: resolved })
    const plan = buildKnowledgePackMetadataReconciliationPlan({
      manifest,
      rowsByCollection,
      sourceCheck,
    })
    const report = {
      ...plan,
      mode: 'dry-run',
      requestedMode: apply ? 'apply' : 'dry-run',
      applyEnabled: false,
    }
    const reportPath = await writeReconciliationReport({ report, reportDir, now })
    const result = { ...report, reportPath }
    logger(json ? JSON.stringify(result, null, 2) : formatTextReport(result))
    if (apply) {
      throw createScriptError(
        'APPLY_NOT_ENABLED',
        'Knowledge Pack metadata reconciliation is read-only until the reported governance decisions are resolved.',
        { reportPath, summary: result.summary },
      )
    }
    return result
  } finally {
    await resolved.disconnect()
  }
}

const isDirectExecution = () => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
  } catch {
    return false
  }
}

const printHelp = () => {
  console.log(`
reconcileKnowledgePackMetadata.js

Usage:
  node src/scripts/reconcileKnowledgePackMetadata.js [--json]
  node src/scripts/reconcileKnowledgePackMetadata.js --apply [--json]

Defaults:
  Dry-run only.
  Reads the checked-in Change Log manifest and reports pack/version/activation drift, identity
  collisions, fixed-runtime conflicts, historical records, and legacy manifest references.
  Apply is not implemented in this slice; every --apply request fails with APPLY_NOT_ENABLED after
  writing the same read-only diagnostic report.
`.trim())
}

if (isDirectExecution()) {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  reconcileKnowledgePackMetadata(args)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        code: error?.code || 'KNOWLEDGE_PACK_METADATA_RECONCILIATION_FAILED',
        message: error?.message || 'Knowledge Pack metadata reconciliation failed.',
        details: error?.details || {},
      }, null, 2))
      process.exit(1)
    })
}
