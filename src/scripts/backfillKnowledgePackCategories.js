import { fileURLToPath } from 'url'
import { connectDb, disconnectDb } from '../config/db.js'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackVersion,
} from '../models/index.js'
import { OUTCOME_KNOWLEDGE_PACK_TYPES } from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_PACK_CATEGORIES,
  PLATFORM_KNOWLEDGE_PACK_TYPES,
  resolveKnowledgePackCategory,
} from '../constants/workspaceGovernance.js'

const parseArgs = (argv = process.argv.slice(2)) => ({
  apply: argv.includes('--apply'),
  json: argv.includes('--json'),
  help: argv.includes('--help') || argv.includes('-h'),
})

const VALID_CATEGORIES = Object.freeze(Object.values(KNOWLEDGE_PACK_CATEGORIES))
const VALID_OUTCOME_PACK_TYPES = Object.freeze(Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES))
const CATEGORY_FIELDS_TO_NORMALIZE = Object.freeze(['packCategory'])

const KNOWLEDGE_PACK_CATEGORY_MODEL_CONFIGS = Object.freeze([
  Object.freeze({
    collectionKey: 'KnowledgePack',
    model: KnowledgePack,
    idField: 'packId',
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackVersion',
    model: KnowledgePackVersion,
    idField: 'versionId',
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackActivation',
    model: KnowledgePackActivation,
    idField: 'activationId',
  }),
])

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

const getDatabaseName = (collection) =>
  collection?.db?.databaseName
  || collection?.db?.s?.databaseName
  || collection?.conn?.name
  || 'unknown'

const buildSelectFields = (idField) =>
  `_id ${idField} packCategory packType packKey updatedAt`

const isPlatformPackType = (packType) =>
  PLATFORM_KNOWLEDGE_PACK_TYPES.has(normalizeToken(packType))

export const resolveBackfilledKnowledgePackCategory = (row = {}) => {
  const packType = normalizeToken(row.packType)
  if (isPlatformPackType(packType)) {
    return KNOWLEDGE_PACK_CATEGORIES.PLATFORM
  }

  return resolveKnowledgePackCategory({
    packCategory: row.packCategory,
    packType,
  })
}

export const buildKnowledgePackCategoryBackfillFilter = () => ({
  packType: { $in: VALID_OUTCOME_PACK_TYPES },
  $or: [
    { packCategory: { $exists: false } },
    { packCategory: null },
    { packCategory: '' },
    { packCategory: { $nin: VALID_CATEGORIES } },
    {
      $and: [
        { packType: { $in: [...PLATFORM_KNOWLEDGE_PACK_TYPES] } },
        { packCategory: { $ne: KNOWLEDGE_PACK_CATEGORIES.PLATFORM } },
      ],
    },
  ],
})

const resolveQueryRows = async (query, idField) => {
  if (!query) return []
  if (typeof query.select === 'function') {
    const selected = query.select(buildSelectFields(idField))
    if (selected && typeof selected.lean === 'function') return selected.lean()
    return selected
  }
  if (typeof query.lean === 'function') return query.lean()
  return query
}

export const buildKnowledgePackCategoryChanges = ({ rows = [], idField }) =>
  rows
    .map((row) => {
      const packType = normalizeToken(row?.packType)
      if (!VALID_OUTCOME_PACK_TYPES.includes(packType)) return null

      const currentCategory = normalizeToken(row?.packCategory)
      const nextCategory = resolveBackfilledKnowledgePackCategory(row)

      if (currentCategory === nextCategory) return null

      return {
        id: normalizeText(row?._id),
        recordKey: normalizeText(row?.[idField]),
        packType,
        packKey: normalizeLowerKey(row?.packKey),
        previousCategory: currentCategory,
        nextCategory,
      }
    })
    .filter(Boolean)

const applyCategoryChanges = async ({ model, idField, changes = [] }) => {
  const bulkWrite = model?.collection?.bulkWrite?.bind(model.collection)
  if (!bulkWrite || changes.length === 0) return { changed: 0 }

  const now = new Date()
  const operations = changes
    .filter((change) => change.recordKey)
    .map((change) => ({
      updateOne: {
        filter: { [idField]: change.recordKey },
        update: {
          $set: {
            packCategory: change.nextCategory,
            updatedAt: now,
          },
        },
      },
    }))

  if (operations.length === 0) return { changed: 0 }

  const result = await bulkWrite(operations, { ordered: false })
  return { changed: Number(result?.modifiedCount) || 0 }
}

const summarizeCollectionRows = ({ collectionKey, idField, rows = [], changes = [], changed = 0 }) => ({
  collectionKey,
  scanned: rows.length,
  pending: changes.length,
  changed,
  idField,
  fieldsToNormalize: [...CATEGORY_FIELDS_TO_NORMALIZE],
  changes,
})

const formatBackfillSummary = (summary) => {
  const lines = [
    `Knowledge Pack category backfill ${summary.mode} on database ${summary.database}: scanned=${summary.totalScanned}; pending=${summary.totalPending}; changed=${summary.totalChanged}.`,
    `Fields to normalize: ${CATEGORY_FIELDS_TO_NORMALIZE.join(', ')}.`,
    'Unique-index posture: unchanged; existing Knowledge Pack indexes remain category-neutral.',
  ]

  summary.collections.forEach((collection) => {
    lines.push(
      `${collection.collectionKey}: scanned=${collection.scanned}; pending=${collection.pending}; changed=${collection.changed}.`,
    )
    collection.changes.forEach((change) => {
      lines.push(
        `- ${collection.collectionKey} ${change.recordKey || change.id}: ${change.packType}:${change.packKey} ${change.previousCategory || '(missing)'} -> ${change.nextCategory}`,
      )
    })
  })

  return lines.join('\n')
}

export const backfillKnowledgePackCategories = async ({
  apply = false,
  json = false,
  logger = console.log,
  dependencies = {},
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const modelConfigs = dependencies.modelConfigs || KNOWLEDGE_PACK_CATEGORY_MODEL_CONFIGS

  await connect()

  try {
    const firstCollection = modelConfigs.find((config) => config.model?.collection)?.model.collection
    const database = getDatabaseName(firstCollection)
    const collections = []

    for (const config of modelConfigs) {
      const query = config.model?.find
        ? config.model.find(buildKnowledgePackCategoryBackfillFilter())
        : []
      const rows = await resolveQueryRows(query, config.idField)
      const changes = buildKnowledgePackCategoryChanges({
        rows: Array.isArray(rows) ? rows : [],
        idField: config.idField,
      })
      const result = apply
        ? await applyCategoryChanges({
          model: config.model,
          idField: config.idField,
          changes,
        })
        : { changed: 0 }

      collections.push(summarizeCollectionRows({
        collectionKey: config.collectionKey,
        idField: config.idField,
        rows: Array.isArray(rows) ? rows : [],
        changes,
        changed: result.changed,
      }))
    }

    const summary = {
      ok: true,
      mode: apply ? 'apply' : 'dry-run',
      database,
      totalScanned: collections.reduce((sum, collection) => sum + collection.scanned, 0),
      totalPending: collections.reduce((sum, collection) => sum + collection.pending, 0),
      totalChanged: collections.reduce((sum, collection) => sum + collection.changed, 0),
      indexPosture: 'UNCHANGED_CATEGORY_NEUTRAL_UNIQUE_INDEXES',
      collections,
    }

    logger(json ? JSON.stringify(summary, null, 2) : formatBackfillSummary(summary))
    return summary
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

const printHelp = () => {
  console.log(`
backfillKnowledgePackCategories.js

Usage:
  node src/scripts/backfillKnowledgePackCategories.js [--apply] [--json]

Defaults:
  Dry-run unless --apply is provided.
  Normalizes missing, invalid, lowercase, or platform-pack category metadata for Knowledge Pack records.
  Does not change Knowledge Pack unique indexes.
`.trim())
}

if (isDirectExecution()) {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  backfillKnowledgePackCategories({
    apply: args.apply,
    json: args.json,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
