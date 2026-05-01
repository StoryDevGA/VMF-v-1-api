import { fileURLToPath } from 'url'
import { connectDb, disconnectDb } from '../config/db.js'
import FrameworkPackage from '../models/FrameworkPackage.js'

const DEPRECATED_FRAMEWORK_PACKAGE_FIELDS = Object.freeze([
  'compatibleWorkflowKeys',
  'defaultAgentIds',
  'requiredSkillIds',
  'validationRules',
  'validationConfig',
  'workflowPolicyConfig',
])

const DEPRECATED_FRAMEWORK_PACKAGE_INDEX_NAMES = Object.freeze([
  'compatibleWorkflowKeys_1_status_1_updatedAt_-1',
  'validationConfig.validationKey_1_status_1_updatedAt_-1',
  'workflowPolicyConfig.policyKey_1_status_1_updatedAt_-1',
])

const parseArgs = (argv = process.argv.slice(2)) => ({
  apply: argv.includes('--apply'),
  json: argv.includes('--json'),
  help: argv.includes('--help') || argv.includes('-h'),
})

const buildLegacyFieldFilter = () => ({
  $or: DEPRECATED_FRAMEWORK_PACKAGE_FIELDS.map((field) => ({
    [field]: { $exists: true },
  })),
})

const buildUnsetDocument = () =>
  Object.fromEntries(DEPRECATED_FRAMEWORK_PACKAGE_FIELDS.map((field) => [field, '']))

const listExistingDeprecatedIndexes = async (collection) => {
  const indexes = await collection.indexes()
  const indexNames = new Set(indexes.map((index) => index.name))
  return DEPRECATED_FRAMEWORK_PACKAGE_INDEX_NAMES.filter((name) => indexNames.has(name))
}

const dropDeprecatedIndexes = async (collection, indexNames) => {
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

export const unsetDeprecatedFrameworkPackageFields = async ({
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
    const filter = buildLegacyFieldFilter()
    const matchedCount = await collection.countDocuments(filter)
    const deprecatedIndexes = await listExistingDeprecatedIndexes(collection)

    if (!apply) {
      const summary = {
        ok: true,
        mode: 'dry-run',
        matched: matchedCount,
        modified: 0,
        deprecatedFields: DEPRECATED_FRAMEWORK_PACKAGE_FIELDS,
        deprecatedIndexes,
        droppedIndexes: [],
      }
      logger(json ? JSON.stringify(summary, null, 2) : `Dry run: ${matchedCount} framework package record(s) contain deprecated fields.`)
      return summary
    }

    const updateResult = matchedCount > 0
      ? await collection.updateMany(filter, { $unset: buildUnsetDocument() })
      : { modifiedCount: 0 }
    const droppedIndexes = await dropDeprecatedIndexes(collection, deprecatedIndexes)
    const summary = {
      ok: true,
      mode: 'apply',
      matched: matchedCount,
      modified: Number(updateResult.modifiedCount) || 0,
      deprecatedFields: DEPRECATED_FRAMEWORK_PACKAGE_FIELDS,
      deprecatedIndexes,
      droppedIndexes,
    }

    logger(
      json
        ? JSON.stringify(summary, null, 2)
        : `Unset deprecated framework package fields: matched=${summary.matched}, modified=${summary.modified}, droppedIndexes=${summary.droppedIndexes.length}.`,
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
unsetDeprecatedFrameworkPackageFields.js

Usage:
  node src/scripts/unsetDeprecatedFrameworkPackageFields.js [--apply] [--json]

Defaults:
  Dry-run unless --apply is provided.
  Removes deprecated Framework Package contract fields and drops their legacy indexes.
`.trim())
}

if (isDirectExecution()) {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  unsetDeprecatedFrameworkPackageFields({
    apply: args.apply,
    json: args.json,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
