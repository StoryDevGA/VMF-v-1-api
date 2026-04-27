import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import RuntimePathRegistry, {
  RUNTIME_PATH_REGISTRY_CATEGORIES,
} from '../models/RuntimePathRegistry.js'

const CATEGORY_RULES = Object.freeze([
  [RUNTIME_PATH_REGISTRY_CATEGORIES.POLICY, [/^framework_state\.policy\./i, /^policy\./i]],
  [RUNTIME_PATH_REGISTRY_CATEGORIES.WORKFLOW, [/^framework_state\.workflow\./i, /^workflow\./i]],
  [RUNTIME_PATH_REGISTRY_CATEGORIES.AUDIT, [/^framework_state\.audit\./i, /^audit\./i]],
  [RUNTIME_PATH_REGISTRY_CATEGORIES.APPROVAL, [/^framework_state\.approval\./i, /^approval\./i]],
  [RUNTIME_PATH_REGISTRY_CATEGORIES.ESCALATION, [/^framework_state\.escalation\./i, /^escalation\./i]],
  [RUNTIME_PATH_REGISTRY_CATEGORIES.NOTIFICATION, [/^framework_state\.notification\./i, /^notification\./i]],
  [RUNTIME_PATH_REGISTRY_CATEGORIES.COMMENT, [/^framework_state\.comment\./i, /^comment\./i]],
  [RUNTIME_PATH_REGISTRY_CATEGORIES.TASK, [/^framework_state\.task\./i, /^task\./i]],
  [RUNTIME_PATH_REGISTRY_CATEGORIES.STYLE, [/^framework_state\.style\./i, /^style\./i]],
  [RUNTIME_PATH_REGISTRY_CATEGORIES.GENERATION, [/^framework_state\.generation\./i, /^generation\./i]],
  [RUNTIME_PATH_REGISTRY_CATEGORIES.METRIC, [/^framework_state\.metrics?\./i, /^metrics?\./i]],
])

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = [...argv]
  const hasFlag = (flag) => args.includes(flag)
  const readValue = (name) => {
    const eq = args.find((value) => value.startsWith(`${name}=`))
    if (eq) return eq.slice(name.length + 1)
    const index = args.indexOf(name)
    if (index === -1) return null
    return args[index + 1] || null
  }

  return {
    apply: hasFlag('--apply'),
    json: hasFlag('--json'),
    help: hasFlag('--help') || hasFlag('-h'),
    actorUserId: String(readValue('--actor') || '').trim(),
  }
}

const toObjectId = (value) => {
  const normalized = String(value || '').trim()
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null
  return new mongoose.Types.ObjectId(normalized)
}

export const inferRuntimePathCategory = (pathKey) => {
  const normalizedPathKey = String(pathKey || '').trim()
  if (!normalizedPathKey) return null

  for (const [category, patterns] of CATEGORY_RULES) {
    if (patterns.some((pattern) => pattern.test(normalizedPathKey))) {
      return category
    }
  }

  return null
}

const buildCategoryChanges = (rows) =>
  rows
    .map((row) => {
      const nextCategory = inferRuntimePathCategory(row.pathKey)
      const currentCategory = String(row.category || '').trim().toUpperCase()

      if (!nextCategory || nextCategory === currentCategory) return null

      return {
        id: String(row._id),
        pathKey: row.pathKey,
        previousCategory: currentCategory,
        nextCategory,
      }
    })
    .filter(Boolean)

export const reclassifyRuntimePathCategories = async ({
  apply = false,
  json = false,
  actorUserId = '',
  logger = console.log,
  dependencies = {},
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const model = dependencies.model || RuntimePathRegistry

  await connect()

  try {
    const rows = await model
      .find({}, { pathKey: 1, category: 1 })
      .lean()

    const changes = buildCategoryChanges(rows)

    if (!apply || changes.length === 0) {
      const summary = {
        ok: true,
        mode: apply ? 'apply' : 'dry-run',
        scanned: rows.length,
        changed: 0,
        pending: changes.length,
        changes,
      }
      logger(json ? JSON.stringify(summary, null, 2) : `Dry run: ${changes.length} runtime path categories would be updated.`)
      return summary
    }

    const now = new Date()
    const actorObjectId = toObjectId(actorUserId)
    const operations = changes.map((change) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(change.id) },
        update: {
          $set: {
            category: change.nextCategory,
            updatedAt: now,
            ...(actorObjectId ? { updatedBy: actorObjectId } : {}),
          },
        },
      },
    }))

    const result = await model.collection.bulkWrite(operations, { ordered: false })
    const summary = {
      ok: true,
      mode: 'apply',
      scanned: rows.length,
      changed: Number(result?.modifiedCount) || 0,
      pending: 0,
      changes,
    }

    logger(json ? JSON.stringify(summary, null, 2) : `Applied runtime path category updates: changed=${summary.changed}.`)
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
reclassifyRuntimePathCategories.js

Usage:
  node src/scripts/reclassifyRuntimePathCategories.js [--apply] [--actor <ObjectId>] [--json]

Defaults:
  Dry-run unless --apply is provided.
  --actor is optional and, when valid, sets updatedBy on changed records.
`.trim())
}

if (isDirectExecution()) {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  reclassifyRuntimePathCategories({
    apply: args.apply,
    json: args.json,
    actorUserId: args.actorUserId,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
