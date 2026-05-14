import { fileURLToPath } from 'url'
import { connectDb, disconnectDb } from '../config/db.js'
import FrameworkPackage from '../models/FrameworkPackage.js'

const LEGACY_ACTIVE_INDEX_NAMES = Object.freeze([
  'unique_active_framework_package',
])

const DEFAULT_POINTER_INDEX_NAME = 'unique_default_framework_package'
const DEFAULT_POINTER_INDEX_KEY = Object.freeze({ frameworkKey: 1, isDefault: 1 })
const DEFAULT_POINTER_INDEX_OPTIONS = Object.freeze({
  unique: true,
  partialFilterExpression: { isDefault: true },
  name: DEFAULT_POINTER_INDEX_NAME,
})

const parseArgs = (argv = process.argv.slice(2)) => ({
  apply: argv.includes('--apply'),
  json: argv.includes('--json'),
  help: argv.includes('--help') || argv.includes('-h'),
})

const hasKeyPath = (index = {}, path) =>
  Object.prototype.hasOwnProperty.call(index.key || {}, path)

const hasActiveStatusPartial = (index = {}) => {
  // This migration targets FrameworkPackage only; that schema has no other unique
  // partial indexes whose expression combines status and ACTIVE.
  const serialized = JSON.stringify(index.partialFilterExpression || {})
  return serialized.includes('status') && serialized.includes('ACTIVE')
}

export const isLegacyActiveFrameworkPackageIndex = (index = {}) => {
  if (!index || index.name === '_id_') return false
  if (LEGACY_ACTIVE_INDEX_NAMES.includes(index.name)) return true

  return index.unique === true
    && hasKeyPath(index, 'frameworkKey')
    && hasKeyPath(index, 'status')
    && hasActiveStatusPartial(index)
}

const hasDefaultPointerIndex = (indexes = []) =>
  indexes.some((index) => index.name === DEFAULT_POINTER_INDEX_NAME)

const listLegacyActiveIndexes = async (collection) => {
  const indexes = await collection.indexes()
  return {
    indexes,
    legacyActiveIndexes: indexes
      .filter(isLegacyActiveFrameworkPackageIndex)
      .map((index) => index.name)
      .filter(Boolean),
    hasDefaultPointerIndex: hasDefaultPointerIndex(indexes),
  }
}

const getDatabaseName = (collection) =>
  collection?.db?.databaseName
  || collection?.db?.s?.databaseName
  || collection?.conn?.name
  || 'unknown'

const dropIndexes = async (collection, indexNames) => {
  const dropped = []

  for (const indexName of indexNames) {
    try {
      await collection.dropIndex(indexName)
      dropped.push(indexName)
    } catch (err) {
      if (err?.codeName !== 'IndexNotFound' && err?.code !== 27) {
        throw err
      }
    }
  }

  return dropped
}

export const dropLegacyFrameworkPackageActiveIndex = async ({
  apply = false,
  json = false,
  logger = console.log,
  dependencies = {},
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const model = dependencies.model || FrameworkPackage

  await connect()

  try {
    const collection = model.collection
    const database = getDatabaseName(collection)
    const {
      legacyActiveIndexes,
      hasDefaultPointerIndex: defaultPointerIndexExists,
    } = await listLegacyActiveIndexes(collection)

    if (!apply) {
      const summary = {
        ok: true,
        mode: 'dry-run',
        database,
        legacyActiveIndexes,
        droppedIndexes: [],
        defaultPointerIndexExists,
        defaultPointerIndexCreated: false,
      }
      logger(
        json
          ? JSON.stringify(summary, null, 2)
          : `Dry run on database ${database}: ${legacyActiveIndexes.length} legacy active Framework Package index(es) found.`,
      )
      return summary
    }

    const defaultPointerIndexCreated = defaultPointerIndexExists
      ? false
      : Boolean(await collection.createIndex(DEFAULT_POINTER_INDEX_KEY, DEFAULT_POINTER_INDEX_OPTIONS))
    const droppedIndexes = await dropIndexes(collection, legacyActiveIndexes)
    const summary = {
      ok: true,
      mode: 'apply',
      database,
      legacyActiveIndexes,
      droppedIndexes,
      defaultPointerIndexExists,
      defaultPointerIndexCreated,
    }

    logger(
      json
        ? JSON.stringify(summary, null, 2)
        : `Dropped legacy active Framework Package indexes on database ${database}: droppedIndexes=${summary.droppedIndexes.length}, defaultPointerIndexCreated=${summary.defaultPointerIndexCreated}.`,
    )
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
dropLegacyFrameworkPackageActiveIndex.js

Usage:
  node src/scripts/dropLegacyFrameworkPackageActiveIndex.js [--apply] [--json]

Defaults:
  Dry-run unless --apply is provided.
  Drops legacy unique ACTIVE Framework Package indexes and ensures the current
  unique default-pointer index exists.
`.trim())
}

if (isDirectExecution()) {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  dropLegacyFrameworkPackageActiveIndex({
    apply: args.apply,
    json: args.json,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
