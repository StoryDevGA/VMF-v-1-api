import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import env from '../config/env.js'
import { connectDb, disconnectDb } from '../config/db.js'
import { User } from '../models/index.js'
import RuntimePathRegistry, {
  buildRuntimePathRegistryStableId,
  RUNTIME_PATH_REGISTRY_CATEGORIES,
  RUNTIME_PATH_REGISTRY_DATA_TYPES,
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_SCOPES,
  RUNTIME_PATH_REGISTRY_SOURCE_TYPES,
  RUNTIME_PATH_REGISTRY_STATUSES,
} from '../models/RuntimePathRegistry.js'

// NOTE:
// The temp spec in docs/temp-docs/ defines a stableId format without a hash, but the app's
// RuntimePathRegistry model uses `buildRuntimePathRegistryStableId(pathKey)` and treats it as immutable.
// This script follows the model as source-of-truth to avoid generating invalid/duplicated ids.

const STAGE_LIFECYCLE = 'lifecycle'

const STAGED_SEEDS = Object.freeze({
  [STAGE_LIFECYCLE]: Object.freeze([
    {
      pathKey: 'framework_state.lifecycle',
      label: 'Framework Lifecycle',
      description: 'Lifecycle container for the current framework state.',
      scope: RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE,
      allowedOperations: [
        RUNTIME_PATH_REGISTRY_OPERATIONS.READ,
        RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
        RUNTIME_PATH_REGISTRY_OPERATIONS.BIND,
      ],
      dataType: RUNTIME_PATH_REGISTRY_DATA_TYPES.OBJECT,
      category: RUNTIME_PATH_REGISTRY_CATEGORIES.LIFECYCLE,
      sourceType: RUNTIME_PATH_REGISTRY_SOURCE_TYPES.RUNTIME_STATE,
      isProtected: false,
      isSystem: true,
      introducedInVersion: '2.3.1',
      exampleValue: { stage: 'DRAFT' },
      compatibilityTags: ['VMF', '2.3.1'],
    },
    {
      pathKey: 'framework_state.lifecycle.stage',
      label: 'Framework Lifecycle Stage',
      description: 'Current lifecycle stage of the framework state.',
      scope: RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE,
      allowedOperations: [
        RUNTIME_PATH_REGISTRY_OPERATIONS.READ,
        RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
        RUNTIME_PATH_REGISTRY_OPERATIONS.BIND,
      ],
      dataType: RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING,
      category: RUNTIME_PATH_REGISTRY_CATEGORIES.LIFECYCLE,
      sourceType: RUNTIME_PATH_REGISTRY_SOURCE_TYPES.RUNTIME_STATE,
      isProtected: false,
      isSystem: true,
      introducedInVersion: '2.3.1',
      exampleValue: 'DRAFT',
      compatibilityTags: ['VMF', '2.3.1'],
    },
    {
      pathKey: 'framework_state.lifecycle.locked',
      label: 'Framework Locked',
      description: 'Whether the framework state is locked against edits.',
      scope: RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE,
      allowedOperations: [
        RUNTIME_PATH_REGISTRY_OPERATIONS.READ,
        RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
        RUNTIME_PATH_REGISTRY_OPERATIONS.BIND,
      ],
      dataType: RUNTIME_PATH_REGISTRY_DATA_TYPES.BOOLEAN,
      category: RUNTIME_PATH_REGISTRY_CATEGORIES.LIFECYCLE,
      sourceType: RUNTIME_PATH_REGISTRY_SOURCE_TYPES.RUNTIME_STATE,
      isProtected: false,
      isSystem: true,
      introducedInVersion: '2.3.1',
      exampleValue: false,
      compatibilityTags: ['VMF', '2.3.1'],
    },
    {
      pathKey: 'framework_state.lifecycle.published',
      label: 'Framework Published',
      description: 'Whether the framework state has been published.',
      scope: RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE,
      allowedOperations: [
        RUNTIME_PATH_REGISTRY_OPERATIONS.READ,
        RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
        RUNTIME_PATH_REGISTRY_OPERATIONS.BIND,
      ],
      dataType: RUNTIME_PATH_REGISTRY_DATA_TYPES.BOOLEAN,
      category: RUNTIME_PATH_REGISTRY_CATEGORIES.LIFECYCLE,
      sourceType: RUNTIME_PATH_REGISTRY_SOURCE_TYPES.RUNTIME_STATE,
      isProtected: false,
      isSystem: true,
      introducedInVersion: '2.3.1',
      exampleValue: false,
      compatibilityTags: ['VMF', '2.3.1'],
    },
    {
      pathKey: 'framework_state.lifecycle.last_transition_at',
      label: 'Last Lifecycle Transition At',
      description: 'Timestamp of the most recent lifecycle stage transition.',
      scope: RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE,
      allowedOperations: [
        RUNTIME_PATH_REGISTRY_OPERATIONS.READ,
        RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
        RUNTIME_PATH_REGISTRY_OPERATIONS.BIND,
      ],
      dataType: RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING,
      category: RUNTIME_PATH_REGISTRY_CATEGORIES.LIFECYCLE,
      sourceType: RUNTIME_PATH_REGISTRY_SOURCE_TYPES.RUNTIME_STATE,
      isProtected: false,
      isSystem: true,
      introducedInVersion: '2.3.1',
      exampleValue: '2026-04-22T00:00:00.000Z',
      compatibilityTags: ['VMF', '2.3.1'],
    },
  ]),
})

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = [...argv]
  const hasFlag = (flag) => args.includes(flag)
  const readValue = (name) => {
    const eq = args.find((value) => value.startsWith(`${name}=`))
    if (eq) return eq.slice(name.length + 1)
    const idx = args.indexOf(name)
    if (idx === -1) return null
    return args[idx + 1] || null
  }

  return {
    apply: hasFlag('--apply'),
    json: hasFlag('--json'),
    help: hasFlag('--help') || hasFlag('-h'),
    stage: (readValue('--stage') || STAGE_LIFECYCLE).trim().toLowerCase(),
    actorUserId: (readValue('--actor') || '').trim(),
    frameworkKeys: (readValue('--framework-keys') || 'VMF').trim(),
  }
}

const normalizeFrameworkKeys = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return ['VMF']
  return raw
    .split(',')
    .map((entry) => String(entry || '').trim().toUpperCase())
    .filter(Boolean)
}

const resolveActorUserId = async (configuredActorUserId) => {
  const normalized = String(configuredActorUserId || '').trim()
  if (normalized) return normalized

  if (env.systemActorUserId) return env.systemActorUserId

  const superAdmin = await User.findOne({
    memberships: { $elemMatch: { customerId: null, roles: 'SUPER_ADMIN' } },
  }).select('_id')

  if (!superAdmin?._id) {
    throw new Error('Unable to resolve system actor user. Set SYSTEM_ACTOR_USER_ID or pass --actor=<ObjectId>.')
  }

  return superAdmin._id
}

const toObjectId = (value) => {
  if (!value) return null
  if (value instanceof mongoose.Types.ObjectId) return value
  const stringValue = String(value || '').trim()
  if (!mongoose.Types.ObjectId.isValid(stringValue)) return null
  return new mongoose.Types.ObjectId(stringValue)
}

const isLowercase = (value) => String(value || '') === String(value || '').toLowerCase()

const validateSeed = (seed) => {
  const errors = []
  const pathKey = String(seed?.pathKey || '').trim()
  if (!pathKey) errors.push('pathKey missing')
  if (pathKey && /\s/.test(pathKey)) errors.push('pathKey contains whitespace')
  if (pathKey && !isLowercase(pathKey)) errors.push('pathKey must be lowercase')
  if (pathKey && pathKey.includes('VMF_STATE')) errors.push('pathKey must not contain VMF_STATE')
  if (pathKey && pathKey.startsWith('vmf.')) errors.push('pathKey must not start with vmf.')
  if (pathKey && /[A-Z]/.test(pathKey)) errors.push('pathKey must not contain uppercase characters')
  if (pathKey && !/^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(pathKey)) {
    errors.push('pathKey must use dot notation with snake_case segments')
  }

  if (!String(seed?.label || '').trim()) errors.push('label missing')
  if (!String(seed?.description || '').trim()) errors.push('description missing')

  if (!seed?.scope) errors.push('scope missing')
  if (!seed?.category) errors.push('category missing')
  if (!seed?.sourceType) errors.push('sourceType missing')
  if (!Array.isArray(seed?.allowedOperations) || seed.allowedOperations.length === 0) {
    errors.push('allowedOperations must be a non-empty array')
  }
  if (!seed?.dataType) errors.push('dataType missing')

  return errors
}

const buildUpsertOperation = ({
  seed,
  actorUserId,
  frameworkKeys,
  now,
}) => {
  const stableId = buildRuntimePathRegistryStableId(seed.pathKey)
  const updateSet = {
    label: seed.label,
    description: seed.description,
    status: RUNTIME_PATH_REGISTRY_STATUSES.ACTIVE,
    frameworkKeys,
    scope: seed.scope,
    allowedOperations: seed.allowedOperations,
    dataType: seed.dataType,
    category: seed.category,
    sourceType: seed.sourceType,
    isProtected: Boolean(seed.isProtected),
    isSystem: seed.isSystem !== false,
    introducedInVersion: seed.introducedInVersion || undefined,
    deprecatedInVersion: seed.deprecatedInVersion || undefined,
    replacementPathKey: seed.replacementPathKey || undefined,
    notes: seed.notes || undefined,
    displayOrder: Number.isFinite(seed.displayOrder) ? seed.displayOrder : undefined,
    exampleValue: seed.exampleValue ?? null,
    compatibilityTags: Array.isArray(seed.compatibilityTags) ? seed.compatibilityTags : [],
    updatedAt: now,
    updatedBy: actorUserId,
  }

  return {
    updateOne: {
      filter: { pathKey: seed.pathKey },
      update: {
        $set: updateSet,
        $setOnInsert: {
          stableId,
          createdAt: now,
          createdBy: actorUserId,
          __v: 0,
        },
      },
      upsert: true,
    },
  }
}

export const runSeedRuntimePathRegistryStaged = async ({
  apply = false,
  json = false,
  stage = STAGE_LIFECYCLE,
  actorUserId: configuredActorUserId,
  frameworkKeys: configuredFrameworkKeys,
  logger = console.log,
  dependencies = {},
} = {}) => {
  const {
    connect = connectDb,
    disconnect = disconnectDb,
  } = dependencies

  const stageKey = String(stage || '').trim().toLowerCase()
  const seeds = STAGED_SEEDS[stageKey]
  if (!seeds) {
    throw new Error(`Unknown stage "${stageKey}". Supported: ${Object.keys(STAGED_SEEDS).join(', ')}`)
  }

  await connect()
  try {
    const resolvedActor = await resolveActorUserId(configuredActorUserId)
    const actorUserId = toObjectId(resolvedActor)
    if (!actorUserId) {
      throw new Error('Actor user id must be a valid ObjectId. Set SYSTEM_ACTOR_USER_ID or pass --actor=<ObjectId>.')
    }
    const frameworkKeys = normalizeFrameworkKeys(configuredFrameworkKeys)
    const now = new Date()

    const invalid = []
    const ops = []
    for (const seed of seeds) {
      const errors = validateSeed(seed)
      if (errors.length > 0) {
        invalid.push({ pathKey: seed?.pathKey || null, errors })
        continue
      }
      ops.push(buildUpsertOperation({ seed, actorUserId, frameworkKeys, now }))
    }

    const summary = {
      mode: apply ? 'apply' : 'dry-run',
      stage: stageKey,
      totalSeeds: seeds.length,
      validSeeds: ops.length,
      invalidSeeds: invalid.length,
      inserted: 0,
      updated: 0,
      matched: 0,
      modified: 0,
      collection: RuntimePathRegistry.collection?.name || 'runtimepathregistries',
    }

    if (apply && ops.length > 0) {
      // Use the underlying collection bulkWrite to avoid Mongoose casting/defaults on upsert,
      // which currently breaks RuntimePathRegistry stableId defaults in bulk upserts.
      const result = await RuntimePathRegistry.collection.bulkWrite(ops, { ordered: false })
      summary.inserted = result.upsertedCount || 0
      summary.updated = result.modifiedCount || 0
      summary.matched = result.matchedCount || 0
      summary.modified = result.modifiedCount || 0
    }

    const output = { summary, invalid }

    if (json) {
      logger(JSON.stringify(output, null, 2))
    } else {
      logger(`[runtime-path-seed] mode=${summary.mode} stage=${summary.stage} collection=${summary.collection}`)
      logger(`[runtime-path-seed] total seeds: ${summary.totalSeeds}`)
      logger(`[runtime-path-seed] valid seeds: ${summary.validSeeds}`)
      logger(`[runtime-path-seed] invalid seeds: ${summary.invalidSeeds}`)
      if (apply) {
        logger(`[runtime-path-seed] inserted: ${summary.inserted} updated(modified): ${summary.updated}`)
      } else {
        logger('[runtime-path-seed] no writes were performed (dry-run). Re-run with --apply to persist.')
      }

      if (invalid.length > 0) {
        logger('[runtime-path-seed] invalid seed detail:')
        for (const row of invalid) {
          logger(`  - pathKey=${row.pathKey || 'null'} errors=${row.errors.join('; ')}`)
        }
      }
    }

    return output
  } finally {
    try {
      await disconnect()
    } catch {
      // ignore disconnect failures in scripts
    }
  }
}

const runFromCli = async () => {
  const args = parseArgs()
  if (args.help) {
    console.log('Usage: node src/scripts/seedRuntimePathRegistryStaged.js [--stage lifecycle] [--apply] [--json] [--actor <ObjectId>] [--framework-keys VMF]')
    console.log('')
    console.log('Defaults:')
    console.log(`- --stage ${STAGE_LIFECYCLE}`)
    console.log('- dry-run unless --apply is provided')
    process.exit(0)
  }
  try {
    await runSeedRuntimePathRegistryStaged(args)
    process.exit(0)
  } catch (err) {
    const message = err?.stack || err?.message || String(err)
    console.error(`[runtime-path-seed] failed: ${message}`)
    try {
      await disconnectDb()
    } catch {
      // ignore disconnect errors in failure path
    }
    process.exit(1)
  }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] === thisFile) {
  runFromCli()
}

export default runSeedRuntimePathRegistryStaged
