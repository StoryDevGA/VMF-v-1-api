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

const GOVERNED_PACKAGE_STATUSES = Object.freeze(['VALIDATED', 'ACTIVE'])
const UI_CONTRACT_PACKAGE_LOCK_REASON = 'Referenced by validated or active Framework Package.'
const RUNTIME_CONTROL_VERSIONING_FIELDS_TO_ADD = Object.freeze([
  'componentVersion',
  'versionStatus',
  'lineageId',
  'isLocked',
  'lockedAt',
  'lockedBy',
  'lockedReason',
  'lockedByPackageKeys',
  'introducedInVersion',
  'deprecatedInVersion',
  'compatibilityTags',
  'compatibilityMode',
  'clonedFromStableId',
  'supersedesStableId',
  'supersededByStableId',
])
const FRAMEWORK_PACKAGE_FIELDS_TO_ADD = Object.freeze([
  ...RUNTIME_CONTROL_VERSIONING_FIELDS_TO_ADD,
  'dependencyLock',
  'lastCheckpointStatus',
  'lastCheckpointAt',
])
const UI_CONTRACT_LOCK_FIELDS_TO_APPLY = Object.freeze([
  'lockedByPackageKeys',
  'isLocked',
  'lockedAt',
  'lockedReason',
  'versionStatus',
])

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

const resolveQueryRows = async (query) => {
  if (!query) return []
  if (typeof query.select === 'function') {
    const selected = query.select('packageKey version uiContractKey status activatedAt lockedAt updatedAt')
    if (selected && typeof selected.lean === 'function') return selected.lean()
    return selected
  }
  if (typeof query.lean === 'function') return query.lean()
  return query
}

const buildUIContractPackageLockPlan = async ({ frameworkPackageModel }) => {
  if (!frameworkPackageModel || typeof frameworkPackageModel.find !== 'function') return []

  const rows = await resolveQueryRows(frameworkPackageModel.find({
    status: { $in: GOVERNED_PACKAGE_STATUSES },
    uiContractKey: { $nin: ['', null] },
  }))
  const grouped = new Map()

  for (const row of Array.isArray(rows) ? rows : []) {
    const uiContractKey = String(row?.uiContractKey || '').trim().toLowerCase()
    const packageKey = String(row?.packageKey || '').trim().toLowerCase()
    if (!uiContractKey || !packageKey) continue

    if (!grouped.has(uiContractKey)) {
      grouped.set(uiContractKey, {
        uiContractKey,
        packageKeys: [],
        packageVersions: [],
        lockedAt: row.activatedAt || row.lockedAt || row.updatedAt || new Date(),
      })
    }

    const plan = grouped.get(uiContractKey)
    plan.packageKeys.push(packageKey)
    if (row.version) plan.packageVersions.push(String(row.version))
    if (!plan.lockedAt && (row.activatedAt || row.lockedAt || row.updatedAt)) {
      plan.lockedAt = row.activatedAt || row.lockedAt || row.updatedAt
    }
  }

  return [...grouped.values()].map((plan) => ({
    ...plan,
    packageKeys: [...new Set(plan.packageKeys)],
    packageVersions: [...new Set(plan.packageVersions)],
  }))
}

const applyUIContractPackageLockPlan = async ({ uiContractModel, plan = [] }) => {
  const updateMany = uiContractModel?.updateMany
    ? uiContractModel.updateMany.bind(uiContractModel)
    : uiContractModel?.collection?.updateMany?.bind(uiContractModel.collection)
  if (!updateMany || plan.length === 0) return { modified: 0 }

  let modified = 0
  for (const item of plan) {
    const packageKeys = item.packageKeys.filter(Boolean)
    if (packageKeys.length === 0) continue

    const referenceResult = await updateMany(
      { uiContractKey: item.uiContractKey },
      {
        $addToSet: {
          lockedByPackageKeys: { $each: packageKeys },
        },
      },
    )
    const lockResult = await updateMany(
      {
        uiContractKey: item.uiContractKey,
        $or: [
          { isLocked: { $exists: false } },
          { isLocked: { $ne: true } },
        ],
      },
      {
        $set: {
          isLocked: true,
          lockedAt: item.lockedAt,
          lockedReason: UI_CONTRACT_PACKAGE_LOCK_REASON,
          versionStatus: RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE,
        },
      },
    )
    modified += Number(referenceResult.modifiedCount) || 0
    modified += Number(lockResult.modifiedCount) || 0
  }

  return { modified }
}

const serializeUIContractLockPlan = (plan = []) =>
  plan.map((item) => ({
    uiContractKey: item.uiContractKey,
    packageKeys: item.packageKeys,
    packageVersions: item.packageVersions,
    lockedAt: item.lockedAt,
    fieldsToApply: [...UI_CONTRACT_LOCK_FIELDS_TO_APPLY],
  }))

const formatBackfillSummary = (summary) => {
  const lines = [
    `Runtime Control versioning backfill ${summary.mode} on database ${summary.database}: matched=${summary.totalMatched}.`,
    `Runtime Control fields to add/normalize: ${RUNTIME_CONTROL_VERSIONING_FIELDS_TO_ADD.join(', ')}.`,
    `Framework Package fields to add/normalize: ${FRAMEWORK_PACKAGE_FIELDS_TO_ADD.join(', ')}.`,
    `UI Contract locks to apply: ${summary.uiContractPackageLocks.matched}; package references: ${summary.uiContractPackageLocks.packageReferences}.`,
  ]

  if (summary.uiContractPackageLocks.locksToApply.length > 0) {
    lines.push('UI Contract lock plan:')
    summary.uiContractPackageLocks.locksToApply.forEach((item) => {
      lines.push(
        `- ${item.uiContractKey}: packages=${item.packageKeys.join(', ')}; versions=${item.packageVersions.join(', ') || 'n/a'}; fields=${item.fieldsToApply.join(', ')}`,
      )
    })
  }

  return lines.join('\n')
}

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
  const uiContractModel = dependencies.uiContractModel || UIContract

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
        fieldsToAdd: [...RUNTIME_CONTROL_VERSIONING_FIELDS_TO_ADD],
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
    const uiContractLockPlan = await buildUIContractPackageLockPlan({ frameworkPackageModel })
    const uiContractPackageLockResult = apply
      ? await applyUIContractPackageLockPlan({ uiContractModel, plan: uiContractLockPlan })
      : { modified: 0 }
    const uiContractPackageReferences = uiContractLockPlan.reduce(
      (count, plan) => count + plan.packageKeys.length,
      0,
    )
    const totalMatched = runtimeControlRows.reduce(
      (sum, row) => sum + row.matched,
      frameworkPackageMatched + uiContractLockPlan.length,
    )

    const summary = {
      ok: true,
      mode: apply ? 'apply' : 'dry-run',
      database,
      totalMatched,
      runtimeControl: runtimeControlRows,
      frameworkPackages: {
        matched: frameworkPackageMatched,
        modified: Number(frameworkPackageResult.modifiedCount) || 0,
        fieldsToAdd: [...FRAMEWORK_PACKAGE_FIELDS_TO_ADD],
      },
      uiContractPackageLocks: {
        matched: uiContractLockPlan.length,
        packageReferences: uiContractPackageReferences,
        modified: Number(uiContractPackageLockResult.modified) || 0,
        locksToApply: serializeUIContractLockPlan(uiContractLockPlan),
      },
    }

    logger(
      json
        ? JSON.stringify(summary, null, 2)
        : formatBackfillSummary(summary),
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
