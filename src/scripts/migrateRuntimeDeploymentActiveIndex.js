import { fileURLToPath } from 'url'
import { connectDb, disconnectDb } from '../config/db.js'
import RuntimeDeployment, {
  RUNTIME_DEPLOYMENT_STATUSES,
} from '../models/RuntimeDeployment.js'

const LEGACY_ACTIVE_INDEX_NAMES = Object.freeze([
  'unique_active_runtime_deployment',
])

const TARGET_ACTIVE_INDEX_NAME = 'unique_active_runtime_deployment_per_package'
const TARGET_ACTIVE_INDEX_KEY = Object.freeze({
  frameworkKey: 1,
  packageId: 1,
  tenantScope: 1,
  deploymentMode: 1,
  status: 1,
})
const TARGET_ACTIVE_INDEX_OPTIONS = Object.freeze({
  unique: true,
  partialFilterExpression: { status: RUNTIME_DEPLOYMENT_STATUSES.ACTIVE },
  name: TARGET_ACTIVE_INDEX_NAME,
})

const parseArgs = (argv = process.argv.slice(2)) => ({
  apply: argv.includes('--apply'),
  json: argv.includes('--json'),
  help: argv.includes('--help') || argv.includes('-h'),
})

const hasKeyPath = (index = {}, path) =>
  Object.prototype.hasOwnProperty.call(index.key || {}, path)

const hasActiveStatusPartial = (index = {}) => {
  const serialized = JSON.stringify(index.partialFilterExpression || {})
  return serialized.includes('status') && serialized.includes(RUNTIME_DEPLOYMENT_STATUSES.ACTIVE)
}

export const isLegacyActiveRuntimeDeploymentIndex = (index = {}) => {
  if (!index || index.name === '_id_') return false
  if (LEGACY_ACTIVE_INDEX_NAMES.includes(index.name)) return true
  if (index.name === TARGET_ACTIVE_INDEX_NAME) return false
  if (hasKeyPath(index, 'packageId')) return false

  return index.unique === true
    && hasKeyPath(index, 'frameworkKey')
    && hasKeyPath(index, 'tenantScope')
    && hasKeyPath(index, 'deploymentMode')
    && hasKeyPath(index, 'status')
    && hasActiveStatusPartial(index)
}

const hasTargetActiveIndex = (indexes = []) =>
  indexes.some((index) => index.name === TARGET_ACTIVE_INDEX_NAME)

const listRuntimeDeploymentIndexes = async (collection) => {
  const indexes = await collection.indexes()
  return {
    indexes,
    legacyActiveIndexes: indexes
      .filter(isLegacyActiveRuntimeDeploymentIndex)
      .map((index) => index.name)
      .filter(Boolean),
    targetActiveIndexExists: hasTargetActiveIndex(indexes),
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

export const migrateRuntimeDeploymentActiveIndex = async ({
  apply = false,
  json = false,
  logger = console.log,
  dependencies = {},
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const model = dependencies.model || RuntimeDeployment

  await connect()

  try {
    const collection = model.collection
    const database = getDatabaseName(collection)
    const {
      legacyActiveIndexes,
      targetActiveIndexExists,
    } = await listRuntimeDeploymentIndexes(collection)

    if (!apply) {
      const summary = {
        ok: true,
        mode: 'dry-run',
        database,
        legacyActiveIndexes,
        droppedIndexes: [],
        targetActiveIndexExists,
        targetActiveIndexCreated: false,
      }
      logger(
        json
          ? JSON.stringify(summary, null, 2)
          : `Dry run on database ${database}: ${legacyActiveIndexes.length} legacy active Runtime Deployment index(es) found.`,
      )
      return summary
    }

    const targetActiveIndexCreated = targetActiveIndexExists
      ? false
      : Boolean(await collection.createIndex(TARGET_ACTIVE_INDEX_KEY, TARGET_ACTIVE_INDEX_OPTIONS))
    const droppedIndexes = await dropIndexes(collection, legacyActiveIndexes)
    const summary = {
      ok: true,
      mode: 'apply',
      database,
      legacyActiveIndexes,
      droppedIndexes,
      targetActiveIndexExists,
      targetActiveIndexCreated,
    }

    logger(
      json
        ? JSON.stringify(summary, null, 2)
        : `Migrated Runtime Deployment active index on database ${database}: droppedIndexes=${summary.droppedIndexes.length}, targetActiveIndexCreated=${summary.targetActiveIndexCreated}.`,
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
migrateRuntimeDeploymentActiveIndex.js

Usage:
  node src/scripts/migrateRuntimeDeploymentActiveIndex.js [--apply] [--json]

Defaults:
  Dry-run unless --apply is provided.
  Ensures Runtime Deployment allows one ACTIVE deployment per framework package,
  then drops the legacy one-ACTIVE-deployment-per-framework index.
`.trim())
}

if (isDirectExecution()) {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  migrateRuntimeDeploymentActiveIndex({
    apply: args.apply,
    json: args.json,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
