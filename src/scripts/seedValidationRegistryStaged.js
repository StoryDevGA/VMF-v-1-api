import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import env from '../config/env.js'
import { connectDb, disconnectDb } from '../config/db.js'
import { User } from '../models/index.js'
import ValidationRegistry, {
  buildValidationRegistryStableId,
  VALIDATION_REGISTRY_STATUSES,
} from '../models/ValidationRegistry.js'
import RuntimeSkill, { RUNTIME_SKILL_STATUSES } from '../models/RuntimeSkill.js'
import RuntimePathRegistry, { RUNTIME_PATH_REGISTRY_SCOPES } from '../models/RuntimePathRegistry.js'
import {
  VALIDATION_REGISTRY_SEED_STAGES,
  validationRegistrySeedsByStage,
} from '../seeds/validationRegistry.js'

const STAGE_MVP = VALIDATION_REGISTRY_SEED_STAGES.MVP

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
    stage: (readValue('--stage') || STAGE_MVP).trim().toLowerCase(),
    actorUserId: (readValue('--actor') || '').trim(),
  }
}

const toObjectId = (value) => {
  if (!value) return null
  if (value instanceof mongoose.Types.ObjectId) return value
  const stringValue = String(value || '').trim()
  if (!mongoose.Types.ObjectId.isValid(stringValue)) return null
  return new mongoose.Types.ObjectId(stringValue)
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

const validateSeed = (seed) => {
  const errors = []
  const key = String(seed?.key || '').trim()
  if (!key) errors.push('key missing')
  if (key && /\s/.test(key)) errors.push('key contains whitespace')
  if (key && key !== key.toLowerCase()) errors.push('key must be lowercase')
  if (key && !/^[a-z][a-z0-9-]*$/.test(key)) errors.push('key must use lowercase letters, numbers, or hyphens')

  if (!String(seed?.label || '').trim()) errors.push('label missing')
  if (!String(seed?.description || '').trim()) errors.push('description missing')
  if (!seed?.category) errors.push('category missing')
  if (!seed?.severity) errors.push('severity missing')
  if (!Array.isArray(seed?.supportedFrameworkKeys) || seed.supportedFrameworkKeys.length === 0) {
    errors.push('supportedFrameworkKeys must be a non-empty array')
  }
  if (!String(seed?.producerSkillId || '').trim()) errors.push('producerSkillId missing')
  if (!String(seed?.outputPath || '').trim()) errors.push('outputPath missing')

  if (seed?.blockingDefault && seed?.warningOnlyDefault) {
    errors.push('blockingDefault and warningOnlyDefault cannot both be true')
  }

  return errors
}

const resolveRuntimeSkillMap = async (skillIds) => {
  const uniqueIds = [...new Set(
    (Array.isArray(skillIds) ? skillIds : [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  )]
  if (uniqueIds.length === 0) return new Map()

  const rows = await RuntimeSkill.find({ stableId: { $in: uniqueIds } })
    .select('stableId status')
    .lean()

  return new Map(rows.map((row) => [String(row.stableId || '').trim().toLowerCase(), row]))
}

const resolveRuntimePathMap = async (pathKeys) => {
  const uniqueKeys = [...new Set(
    (Array.isArray(pathKeys) ? pathKeys : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )]
  if (uniqueKeys.length === 0) return new Map()

  const rows = await RuntimePathRegistry.find({ pathKey: { $in: uniqueKeys } })
    .select('pathKey status scope')
    .lean()

  return new Map(rows.map((row) => [row.pathKey, row]))
}

const buildUpsertOperation = ({ seed, actorUserId, now }) => {
  const stableId = buildValidationRegistryStableId(seed.key)
  const updateSet = {
    label: seed.label,
    description: seed.description,
    status: seed.status || VALIDATION_REGISTRY_STATUSES.ACTIVE,
    supportedFrameworkKeys: seed.supportedFrameworkKeys,
    category: seed.category,
    severity: seed.severity,
    producerSkillId: seed.producerSkillId,
    outputPath: seed.outputPath,
    passFieldPath: seed.passFieldPath || '',
    detailsFieldPath: seed.detailsFieldPath || '',
    policyUsable: Boolean(seed.policyUsable),
    packageUsable: Boolean(seed.packageUsable),
    freshnessDefaultMinutes: Number.isInteger(Number(seed.freshnessDefaultMinutes)) ? Number(seed.freshnessDefaultMinutes) : 30,
    blockingDefault: Boolean(seed.blockingDefault),
    warningOnlyDefault: Boolean(seed.warningOnlyDefault),
    updatedAt: now,
    updatedBy: actorUserId,
  }

  return {
    updateOne: {
      filter: { key: seed.key },
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

export const runSeedValidationRegistryStaged = async ({
  apply = false,
  json = false,
  stage = STAGE_MVP,
  actorUserId: configuredActorUserId,
  logger = console.log,
} = {}) => {
  const normalizedStage = String(stage || STAGE_MVP).trim().toLowerCase()
  const seeds = validationRegistrySeedsByStage[normalizedStage]

  if (!seeds) {
    throw new Error(`Unknown stage "${normalizedStage}". Supported: ${Object.keys(validationRegistrySeedsByStage).join(', ')}`)
  }

  await connectDb()

  try {
    const actorUserId = await resolveActorUserId(configuredActorUserId)
    const actorObjectId = toObjectId(actorUserId)
    if (!actorObjectId) {
      throw new Error('Actor user id must be a valid Mongo ObjectId.')
    }

    const validationErrors = []
    for (const seed of seeds) {
      const errors = validateSeed(seed)
      if (errors.length > 0) {
        validationErrors.push({ key: seed?.key || '<missing>', errors })
      }
    }

    if (validationErrors.length > 0) {
      const message = JSON.stringify({ stage: normalizedStage, validationErrors }, null, 2)
      throw new Error(`Seed validation failed:\n${message}`)
    }

    const skillIdMap = await resolveRuntimeSkillMap(seeds.map((seed) => seed.producerSkillId))
    const missingSkills = seeds
      .map((seed) => seed.producerSkillId)
      .filter((id) => id && !skillIdMap.has(String(id).trim().toLowerCase()))

    if (missingSkills.length > 0) {
      throw new Error(`Producer skill ids not found: ${[...new Set(missingSkills)].join(', ')}`)
    }

    const inactiveSkills = seeds
      .map((seed) => seed.producerSkillId)
      .filter((id) => {
        const row = skillIdMap.get(String(id).trim().toLowerCase())
        return row && String(row.status || '').trim().toUpperCase() !== RUNTIME_SKILL_STATUSES.ACTIVE
      })

    if (inactiveSkills.length > 0) {
      throw new Error(`Producer skill ids must be ACTIVE: ${[...new Set(inactiveSkills)].join(', ')}`)
    }

    const runtimePathMap = await resolveRuntimePathMap(seeds.flatMap((seed) => [
      seed.outputPath,
      seed.passFieldPath,
      seed.detailsFieldPath,
    ]))

    const missingPaths = []
    const invalidScopes = []
    const inactivePaths = []

    for (const seed of seeds) {
      for (const field of ['outputPath', 'passFieldPath', 'detailsFieldPath']) {
        const value = String(seed[field] || '').trim()
        if (!value) continue
        const row = runtimePathMap.get(value)
        if (!row) {
          missingPaths.push(value)
          continue
        }
        if (String(row.status || '').trim().toUpperCase() !== 'ACTIVE') {
          inactivePaths.push(value)
        }
        if (String(row.scope || '').trim().toUpperCase() !== RUNTIME_PATH_REGISTRY_SCOPES.VALIDATION_RESULT) {
          invalidScopes.push(value)
        }
      }
    }

    if (missingPaths.length > 0) {
      throw new Error(`Runtime paths not found: ${[...new Set(missingPaths)].join(', ')}`)
    }
    if (inactivePaths.length > 0) {
      throw new Error(`Runtime paths must be ACTIVE: ${[...new Set(inactivePaths)].join(', ')}`)
    }
    if (invalidScopes.length > 0) {
      throw new Error(`Runtime paths must be VALIDATION_RESULT: ${[...new Set(invalidScopes)].join(', ')}`)
    }

    const now = new Date()
    const operations = seeds.map((seed) =>
      buildUpsertOperation({ seed, actorUserId: actorObjectId, now }),
    )

    if (!apply) {
      const payload = {
        ok: true,
        dryRun: true,
        stage: normalizedStage,
        seedCount: seeds.length,
      }
      logger(json ? JSON.stringify(payload, null, 2) : `Dry run: ${payload.seedCount} validation seeds ready for stage "${payload.stage}".`)
      return payload
    }

    const result = await ValidationRegistry.collection.bulkWrite(operations, { ordered: false })

    const summary = {
      ok: true,
      dryRun: false,
      stage: normalizedStage,
      seedCount: seeds.length,
      matched: Number(result?.matchedCount) || 0,
      inserted: Number(result?.upsertedCount) || 0,
      modified: Number(result?.modifiedCount) || 0,
    }

    logger(json ? JSON.stringify(summary, null, 2) : `Applied stage "${summary.stage}": inserted=${summary.inserted}, modified=${summary.modified}.`)
    return summary
  } finally {
    await disconnectDb()
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
  // eslint-disable-next-line no-console
  console.log(`
seedValidationRegistryStaged.js

Usage:
  node src/scripts/seedValidationRegistryStaged.js [--apply] [--stage mvp] [--actor <ObjectId>] [--json]

Defaults:
  --stage mvp
  Dry-run unless --apply is provided.
`.trim())
}

if (isDirectExecution()) {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  runSeedValidationRegistryStaged({
    apply: args.apply,
    json: args.json,
    stage: args.stage,
    actorUserId: args.actorUserId,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err)
      process.exit(1)
    })
}
