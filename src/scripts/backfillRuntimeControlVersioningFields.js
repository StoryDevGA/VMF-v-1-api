import { fileURLToPath } from 'url'
import { connectDb, disconnectDb } from '../config/db.js'
import {
  FrameworkPackage,
  RuntimeAgent,
  RuntimePathRegistry,
  RuntimeSkill,
  SkillRoleRegistry,
  UIContract,
  ValidationRegistry,
  WorkflowPolicy,
} from '../models/index.js'
import {
  RUNTIME_CONTROL_COMPATIBILITY_MODES,
  RUNTIME_CONTROL_VERSION_STATUSES,
} from '../utils/runtimeControlVersioning.js'

const parseArgs = (argv = process.argv.slice(2)) => ({
  apply: argv.includes('--apply'),
  json: argv.includes('--json'),
  help: argv.includes('--help') || argv.includes('-h'),
})

const RUNTIME_CONTROL_MODEL_CONFIGS = Object.freeze([
  Object.freeze({
    collectionKey: 'RuntimePathRegistry',
    model: RuntimePathRegistry,
    compatibilityMode: RUNTIME_CONTROL_COMPATIBILITY_MODES.INHERITED_MINOR,
  }),
  Object.freeze({
    collectionKey: 'SkillRoleRegistry',
    model: SkillRoleRegistry,
    compatibilityMode: RUNTIME_CONTROL_COMPATIBILITY_MODES.OPEN,
  }),
  Object.freeze({
    collectionKey: 'RuntimeSkill',
    model: RuntimeSkill,
    compatibilityMode: RUNTIME_CONTROL_COMPATIBILITY_MODES.INHERITED_MINOR,
  }),
  Object.freeze({
    collectionKey: 'ValidationRegistry',
    model: ValidationRegistry,
    compatibilityMode: RUNTIME_CONTROL_COMPATIBILITY_MODES.INHERITED_MINOR,
  }),
  Object.freeze({
    collectionKey: 'RuntimeAgent',
    model: RuntimeAgent,
    compatibilityMode: RUNTIME_CONTROL_COMPATIBILITY_MODES.INHERITED_MINOR,
  }),
  Object.freeze({
    collectionKey: 'WorkflowPolicy',
    model: WorkflowPolicy,
    compatibilityMode: RUNTIME_CONTROL_COMPATIBILITY_MODES.INHERITED_MINOR,
  }),
  Object.freeze({
    collectionKey: 'UIContract',
    model: UIContract,
    compatibilityMode: RUNTIME_CONTROL_COMPATIBILITY_MODES.INHERITED_MINOR,
  }),
])

const getDatabaseName = (collection) =>
  collection?.db?.databaseName
  || collection?.db?.s?.databaseName
  || collection?.conn?.name
  || 'unknown'

const buildMissingVersioningFilter = () => ({
  $or: [
    { componentVersion: { $exists: false } },
    { componentVersion: null },
    { versionStatus: { $exists: false } },
    { versionStatus: null },
    { versionStatus: '' },
    { lineageId: { $exists: false } },
    { lineageId: null },
    { lineageId: '' },
    { isLocked: { $exists: false } },
    { lockedAt: { $exists: false } },
    { lockedBy: { $exists: false } },
    { lockedReason: { $exists: false } },
    { lockedByPackageKeys: { $exists: false } },
    { compatibilityTags: { $exists: false } },
    { compatibilityMode: { $exists: false } },
    { compatibilityMode: null },
    { compatibilityMode: '' },
    { clonedFromStableId: '' },
    { supersedesStableId: '' },
    { supersededByStableId: '' },
    { introducedInVersion: '' },
    { deprecatedInVersion: '' },
    {
      $and: [
        { isLocked: true },
        {
          $or: [
            { lockedAt: null },
            { lockedReason: null },
            { lockedReason: '' },
          ],
        },
      ],
    },
  ],
})

const buildRuntimeControlBackfillPipeline = ({ compatibilityMode }) => ([
  {
    $set: {
      componentVersion: { $ifNull: ['$componentVersion', 1] },
      versionStatus: {
        $ifNull: [
          '$versionStatus',
          {
            $switch: {
              branches: [
                {
                  case: { $eq: ['$status', 'ACTIVE'] },
                  then: RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE,
                },
                {
                  case: { $eq: ['$status', 'DEPRECATED'] },
                  then: RUNTIME_CONTROL_VERSION_STATUSES.DEPRECATED,
                },
                {
                  case: { $in: ['$status', ['INACTIVE', 'ARCHIVED']] },
                  then: RUNTIME_CONTROL_VERSION_STATUSES.ARCHIVED,
                },
              ],
              default: RUNTIME_CONTROL_VERSION_STATUSES.DRAFT,
            },
          },
        ],
      },
      lineageId: {
        $cond: [
          { $eq: ['$lineageId', ''] },
          '$stableId',
          { $ifNull: ['$lineageId', '$stableId'] },
        ],
      },
      isLocked: { $ifNull: ['$isLocked', false] },
      lockedAt: {
        $cond: [
          {
            $and: [
              { $eq: [{ $ifNull: ['$isLocked', false] }, true] },
              { $eq: [{ $ifNull: ['$lockedAt', null] }, null] },
            ],
          },
          { $ifNull: ['$updatedAt', '$createdAt'] },
          { $ifNull: ['$lockedAt', null] },
        ],
      },
      lockedBy: { $ifNull: ['$lockedBy', null] },
      lockedReason: {
        $cond: [
          {
            $and: [
              { $eq: [{ $ifNull: ['$isLocked', false] }, true] },
              { $in: [{ $ifNull: ['$lockedReason', ''] }, ['', null]] },
            ],
          },
          'Backfilled runtime control lock metadata.',
          { $ifNull: ['$lockedReason', ''] },
        ],
      },
      lockedByPackageKeys: { $ifNull: ['$lockedByPackageKeys', []] },
      introducedInVersion: {
        $cond: [
          { $eq: ['$introducedInVersion', ''] },
          null,
          { $ifNull: ['$introducedInVersion', null] },
        ],
      },
      deprecatedInVersion: {
        $cond: [
          { $eq: ['$deprecatedInVersion', ''] },
          null,
          { $ifNull: ['$deprecatedInVersion', null] },
        ],
      },
      compatibilityTags: { $ifNull: ['$compatibilityTags', []] },
      compatibilityMode: {
        $cond: [
          { $in: [{ $ifNull: ['$compatibilityMode', ''] }, ['', null]] },
          compatibilityMode,
          '$compatibilityMode',
        ],
      },
      clonedFromStableId: {
        $cond: [
          { $eq: ['$clonedFromStableId', ''] },
          null,
          { $ifNull: ['$clonedFromStableId', null] },
        ],
      },
      supersedesStableId: {
        $cond: [
          { $eq: ['$supersedesStableId', ''] },
          null,
          { $ifNull: ['$supersedesStableId', null] },
        ],
      },
      supersededByStableId: {
        $cond: [
          { $eq: ['$supersededByStableId', ''] },
          null,
          { $ifNull: ['$supersededByStableId', null] },
        ],
      },
    },
  },
])

const buildFrameworkPackageFilter = () => ({
  $or: [
    { versionStatus: { $exists: false } },
    { isLocked: { $exists: false } },
    { lockedAt: { $exists: false } },
    { lockedBy: { $exists: false } },
    { lockedReason: { $exists: false } },
    { dependencyLock: { $exists: false } },
    { lastCheckpointStatus: { $exists: false } },
    { lastCheckpointAt: { $exists: false } },
    {
      $and: [
        { status: { $in: ['VALIDATED', 'ACTIVE'] } },
        {
          $or: [
            { lockedAt: null },
            { lockedReason: null },
            { lockedReason: '' },
          ],
        },
      ],
    },
  ],
})

const buildFrameworkPackageBackfillPipeline = () => ([
  {
    $set: {
      versionStatus: {
        $ifNull: [
          '$versionStatus',
          {
            $switch: {
              branches: [
                {
                  case: { $in: ['$status', ['VALIDATED', 'ACTIVE']] },
                  then: RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE,
                },
                {
                  case: { $eq: ['$status', 'DEPRECATED'] },
                  then: RUNTIME_CONTROL_VERSION_STATUSES.DEPRECATED,
                },
              ],
              default: RUNTIME_CONTROL_VERSION_STATUSES.DRAFT,
            },
          },
        ],
      },
      isLocked: { $ifNull: ['$isLocked', { $in: ['$status', ['VALIDATED', 'ACTIVE']] }] },
      lockedAt: {
        $cond: [
          {
            $and: [
              { $in: ['$status', ['VALIDATED', 'ACTIVE']] },
              { $eq: [{ $ifNull: ['$lockedAt', null] }, null] },
            ],
          },
          { $ifNull: ['$activatedAt', { $ifNull: ['$updatedAt', '$createdAt'] }] },
          { $ifNull: ['$lockedAt', null] },
        ],
      },
      lockedBy: { $ifNull: ['$lockedBy', null] },
      lockedReason: {
        $cond: [
          {
            $and: [
              { $in: ['$status', ['VALIDATED', 'ACTIVE']] },
              { $in: [{ $ifNull: ['$lockedReason', ''] }, ['', null]] },
            ],
          },
          'Backfilled framework package lock metadata.',
          { $ifNull: ['$lockedReason', ''] },
        ],
      },
      dependencyLock: { $ifNull: ['$dependencyLock', null] },
      lastCheckpointStatus: { $ifNull: ['$lastCheckpointStatus', null] },
      lastCheckpointAt: { $ifNull: ['$lastCheckpointAt', null] },
    },
  },
])

export const backfillRuntimeControlVersioningFields = async ({
  apply = false,
  json = false,
  logger = console.log,
  dependencies = {},
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const runtimeControlConfigs = dependencies.runtimeControlConfigs || RUNTIME_CONTROL_MODEL_CONFIGS
  const frameworkPackageModel = dependencies.frameworkPackageModel || FrameworkPackage

  await connect()

  try {
    const database = getDatabaseName(frameworkPackageModel.collection)
    const runtimeControlRows = []

    for (const config of runtimeControlConfigs) {
      const filter = buildMissingVersioningFilter()
      const matched = await config.model.collection.countDocuments(filter)
      const result = apply && matched > 0
        ? await config.model.collection.updateMany(
          filter,
          buildRuntimeControlBackfillPipeline({ compatibilityMode: config.compatibilityMode }),
        )
        : { modifiedCount: 0 }

      runtimeControlRows.push({
        collectionKey: config.collectionKey,
        matched,
        modified: Number(result.modifiedCount) || 0,
      })
    }

    const frameworkPackageFilter = buildFrameworkPackageFilter()
    const frameworkPackageMatched = await frameworkPackageModel.collection.countDocuments(frameworkPackageFilter)
    const frameworkPackageResult = apply && frameworkPackageMatched > 0
      ? await frameworkPackageModel.collection.updateMany(
        frameworkPackageFilter,
        buildFrameworkPackageBackfillPipeline(),
      )
      : { modifiedCount: 0 }

    const summary = {
      ok: true,
      mode: apply ? 'apply' : 'dry-run',
      database,
      runtimeControl: runtimeControlRows,
      frameworkPackages: {
        matched: frameworkPackageMatched,
        modified: Number(frameworkPackageResult.modifiedCount) || 0,
      },
    }

    logger(
      json
        ? JSON.stringify(summary, null, 2)
        : `Runtime Control versioning backfill ${summary.mode} on database ${database}: matched=${runtimeControlRows.reduce((sum, row) => sum + row.matched, frameworkPackageMatched)}.`,
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
backfillRuntimeControlVersioningFields.js

Usage:
  node src/scripts/backfillRuntimeControlVersioningFields.js [--apply] [--json]

Defaults:
  Dry-run unless --apply is provided.
  Backfills shared Runtime Control versioning, locking, lineage, and Framework Package checkpoint fields.
`.trim())
}

if (isDirectExecution()) {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  backfillRuntimeControlVersioningFields({
    apply: args.apply,
    json: args.json,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
