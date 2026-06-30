import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import {
  Deal,
  FrameworkPackage,
  KnowledgePackActivation,
  KnowledgePackManifest,
  OutcomeAsset,
  OutcomeAssetVersion,
  OutcomeMessage,
  OutcomeSession,
  RuntimeActivationSnapshot,
  RuntimeAgent,
  RuntimeDeployment,
  RuntimeGraphRelationship,
  RuntimeInstance,
  RuntimeOutputAsset,
  RuntimeOutputRequest,
  RuntimePathRegistry,
  RuntimeSkill,
  RuntimeValidationAudit,
  SkillRoleRegistry,
  TruthSignature,
  UIContract,
  ValidationRegistry,
  VMF,
  WorkflowPolicy,
} from '../models/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const apiRoot = path.resolve(__dirname, '../..')
const workspaceRoot = path.resolve(apiRoot, '..')

export const DEFAULT_FRAMEWORK_KEY = 'VMF'
export const DEFAULT_MINIMUM_VERSION = '3.1'
export const DELETE_CONFIRMATION = '--confirm-delete-pre-v3-1-vmf'
export const DEFAULT_REPORT_DIR = path.resolve(workspaceRoot, 'docs/generated/cleanup-reports')

const DEFAULT_MODELS = Object.freeze({
  Deal,
  FrameworkPackage,
  KnowledgePackActivation,
  KnowledgePackManifest,
  OutcomeAsset,
  OutcomeAssetVersion,
  OutcomeMessage,
  OutcomeSession,
  RuntimeActivationSnapshot,
  RuntimeAgent,
  RuntimeDeployment,
  RuntimeGraphRelationship,
  RuntimeInstance,
  RuntimeOutputAsset,
  RuntimeOutputRequest,
  RuntimePathRegistry,
  RuntimeSkill,
  RuntimeValidationAudit,
  SkillRoleRegistry,
  TruthSignature,
  UIContract,
  ValidationRegistry,
  VMF,
  WorkflowPolicy,
})

const RUNTIME_CONTROL_PROJECTION = [
  '_id',
  'stableId',
  'key',
  'pathKey',
  'roleKey',
  'uiContractKey',
  'packageKey',
  'frameworkKey',
  'frameworkKeys',
  'supportedFrameworkKeys',
  'sourceFrameworkKey',
  'sourcePackageKey',
  'sourcePackageVersion',
  'version',
  'introducedInVersion',
  'deprecatedInVersion',
  'compatibilityTags',
  'lockedByPackageKeys',
  'status',
].join(' ')

const RUNTIME_RECORD_PROJECTION = [
  '_id',
  'runtimeInstanceId',
  'runtimeInstanceKey',
  'frameworkKey',
  'frameworkVersion',
  'frameworkPackageId',
  'packageId',
  'packageKey',
  'packageVersion',
  'activationId',
  'deploymentId',
  'outputRequestId',
  'outputAssetId',
  'sessionId',
  'outcomeAssetId',
  'outcomeAssetVersionId',
  'truthSignatureId',
  'relationshipId',
  'validationCode',
  'workspaceId',
  'vmfId',
  'name',
  'title',
  'status',
].join(' ')

const normalizeFrameworkKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()

const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()

const normalizeText = (value) =>
  String(value || '')
    .trim()

const unique = (values) => [...new Set(values.filter(Boolean))]

const stringifyId = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value.$oid) return String(value.$oid)
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

export const parseVersionParts = (value) => {
  const normalized = normalizeText(value)
  const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/)
  if (!match) return null

  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2] || '0', 10),
    Number.parseInt(match[3] || '0', 10),
  ]
}

export const isVersionBeforeMinimum = (version, minimumVersion = DEFAULT_MINIMUM_VERSION) => {
  const versionParts = parseVersionParts(version)
  const minimumParts = parseVersionParts(minimumVersion)
  if (!versionParts || !minimumParts) return false

  for (let index = 0; index < 3; index += 1) {
    if (versionParts[index] < minimumParts[index]) return true
    if (versionParts[index] > minimumParts[index]) return false
  }

  return false
}

const readFlagValue = (argv, index, flagName) => {
  const value = argv[index + 1]
  if (!value || String(value).startsWith('--')) {
    throw new Error(`${flagName} requires a value. Run with --help for usage.`)
  }
  return value
}

export const parseArgs = (argv = process.argv.slice(2)) => {
  const args = {
    apply: false,
    confirmDelete: false,
    frameworkKey: DEFAULT_FRAMEWORK_KEY,
    help: false,
    json: false,
    minimumVersion: DEFAULT_MINIMUM_VERSION,
    noReport: false,
    reportDir: DEFAULT_REPORT_DIR,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === DELETE_CONFIRMATION) args.confirmDelete = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--json') args.json = true
    else if (arg === '--no-report') args.noReport = true
    else if (arg === '--framework-key') {
      args.frameworkKey = normalizeFrameworkKey(readFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--minimum-version') {
      args.minimumVersion = normalizeText(readFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--report-dir') {
      args.reportDir = path.resolve(process.cwd(), readFlagValue(argv, index, arg))
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`)
    }
  }

  if (!parseVersionParts(args.minimumVersion)) {
    throw new Error(`--minimum-version must be a numeric version. Received: ${args.minimumVersion}`)
  }

  if (args.apply && !args.confirmDelete) {
    throw new Error(
      `--apply requires ${DELETE_CONFIRMATION}. `
      + 'Run without --apply first and review the dry-run report before deleting old VMF data.',
    )
  }

  return args
}

const getCollectionName = (model, fallback) =>
  model?.collection?.name
  || model?.collectionName
  || fallback

const queryLean = async (model, filter = {}, projection = '') => {
  if (!model || typeof model.find !== 'function') return []

  const query = model.find(filter)
  const selected = projection && typeof query?.select === 'function'
    ? query.select(projection)
    : query
  const leanQuery = typeof selected?.lean === 'function'
    ? selected.lean()
    : selected

  const records = await leanQuery
  return Array.isArray(records) ? records : []
}

const hasFrameworkValue = (record, field, frameworkKey) => {
  const value = record?.[field]
  if (Array.isArray(value)) {
    return value.map(normalizeFrameworkKey).includes(frameworkKey)
  }
  return normalizeFrameworkKey(value) === frameworkKey
}

const hasOldVersionField = (record, field, minimumVersion) => {
  const value = record?.[field]
  return isVersionBeforeMinimum(value, minimumVersion)
}

const collectOldVersionReasons = (record, fields, minimumVersion) =>
  fields
    .filter((field) => hasOldVersionField(record, field, minimumVersion))
    .map((field) => `${field}:${normalizeText(record[field])}`)

const collectOldCompatibilityTagReasons = (record, minimumVersion) => {
  const tags = Array.isArray(record?.compatibilityTags) ? record.compatibilityTags : []
  return tags
    .map(normalizeText)
    .filter((tag) => isVersionBeforeMinimum(tag, minimumVersion))
    .map((tag) => `compatibilityTags:${tag}`)
}

const collectOldPackageReasons = (record, context, fields = {}) => {
  const reasons = []
  for (const field of fields.packageKeyFields || []) {
    const value = normalizeKey(record?.[field])
    if (value && context.oldPackageKeySet.has(value)) reasons.push(`${field}:${value}`)
  }
  for (const field of fields.packageIdFields || []) {
    const value = stringifyId(record?.[field])
    if (value && context.oldPackageIdSet.has(value)) reasons.push(`${field}:${value}`)
  }
  return reasons
}

const collectLockedPackageReasons = (record, context) => {
  const lockedByPackageKeys = Array.isArray(record?.lockedByPackageKeys)
    ? record.lockedByPackageKeys.map(normalizeKey)
    : []
  return lockedByPackageKeys
    .filter((packageKey) => context.oldPackageKeySet.has(packageKey))
    .map((packageKey) => `lockedByPackageKeys:${packageKey}`)
}

const collectRuntimeInstanceReasons = (record, context, field = 'runtimeInstanceId') => {
  const runtimeInstanceId = stringifyId(record?.[field])
  return runtimeInstanceId && context.oldRuntimeInstanceIdSet.has(runtimeInstanceId)
    ? [`${field}:${runtimeInstanceId}`]
    : []
}

const collectVmfReasons = (record, context, field = 'vmfId') => {
  const vmfId = stringifyId(record?.[field])
  return vmfId && context.oldVmfIdSet.has(vmfId)
    ? [`${field}:${vmfId}`]
    : []
}

const summarizeRecord = (record, reasons) => ({
  id: stringifyId(record?._id),
  stableId: normalizeText(record?.stableId),
  key: normalizeText(
    record?.key
    || record?.pathKey
    || record?.roleKey
    || record?.uiContractKey
    || record?.packageKey
    || record?.activationId
    || record?.deploymentId
    || record?.runtimeInstanceKey
    || record?.outputRequestId
    || record?.outputAssetId
    || record?.sessionId
    || record?.outcomeAssetId
    || record?.outcomeAssetVersionId
    || record?.truthSignatureId
    || record?.relationshipId
    || record?.validationCode
    || record?.name
    || record?.title
  ),
  frameworkKey: normalizeFrameworkKey(record?.frameworkKey || record?.sourceFrameworkKey),
  packageKey: normalizeKey(record?.packageKey || record?.sourcePackageKey),
  version: normalizeText(
    record?.version
    || record?.packageVersion
    || record?.frameworkVersion
    || record?.sourcePackageVersion
    || record?.introducedInVersion
  ),
  reasons,
})

const buildPlanEntry = ({ key, label, model, records, reasonForRecord }) => {
  const candidates = []
  const skippedWithoutId = []

  for (const record of records) {
    const reasons = unique(reasonForRecord(record))
    if (reasons.length === 0) continue

    const id = stringifyId(record?._id)
    if (!id) {
      skippedWithoutId.push(summarizeRecord(record, reasons))
      continue
    }
    candidates.push({ record, reasons })
  }

  return {
    key,
    label,
    collection: getCollectionName(model, key),
    matched: candidates.length,
    deleteIds: candidates.map(({ record }) => record._id),
    records: candidates.map(({ record, reasons }) => summarizeRecord(record, reasons)),
    skippedWithoutId,
    deleted: 0,
  }
}

const addEntry = (entries, entry) => {
  entries.push(entry)
  return entry
}

const getRuntimeControlReasonBuilder = ({
  context,
  frameworkFields = [],
  versionFields = ['introducedInVersion'],
  packageKeyFields = [],
  packageIdFields = [],
  allowUnscopedVersionMatch = false,
  minimumVersion,
}) => (record) => {
  const frameworkScoped = frameworkFields.length === 0
    ? allowUnscopedVersionMatch
    : frameworkFields.some((field) => hasFrameworkValue(record, field, context.frameworkKey))

  const reasons = [
    ...collectOldPackageReasons(record, context, { packageKeyFields, packageIdFields }),
    ...collectLockedPackageReasons(record, context),
  ]

  if (frameworkScoped) {
    reasons.push(...collectOldVersionReasons(record, versionFields, minimumVersion))
    reasons.push(...collectOldCompatibilityTagReasons(record, minimumVersion))
  }

  return reasons
}

const getRuntimeRecordReasonBuilder = ({
  context,
  frameworkRequired = true,
  versionFields = ['packageVersion'],
  packageKeyFields = ['packageKey'],
  packageIdFields = ['packageId'],
  includeRuntimeInstance = false,
  includeVmf = false,
  minimumVersion,
}) => (record) => {
  if (frameworkRequired && !hasFrameworkValue(record, 'frameworkKey', context.frameworkKey)) return []

  return [
    ...collectOldVersionReasons(record, versionFields, minimumVersion),
    ...collectOldPackageReasons(record, context, { packageKeyFields, packageIdFields }),
    ...(includeRuntimeInstance ? collectRuntimeInstanceReasons(record, context) : []),
    ...(includeVmf ? collectVmfReasons(record, context) : []),
  ]
}

const createContext = ({ frameworkKey, minimumVersion }) => ({
  frameworkKey,
  minimumVersion,
  oldPackageIds: [],
  oldPackageIdSet: new Set(),
  oldPackageKeys: [],
  oldPackageKeySet: new Set(),
  oldRuntimeInstanceIds: [],
  oldRuntimeInstanceIdSet: new Set(),
  oldVmfIds: [],
  oldVmfIdSet: new Set(),
})

const updateOldPackageContext = (context, packageEntry) => {
  context.oldPackageIds = unique(packageEntry.records.map((record) => record.id))
  context.oldPackageIdSet = new Set(context.oldPackageIds)
  context.oldPackageKeys = unique(packageEntry.records.map((record) => normalizeKey(record.packageKey || record.key)))
  context.oldPackageKeySet = new Set(context.oldPackageKeys)
}

const updateRuntimeInstanceContext = (context, runtimeInstanceEntry) => {
  context.oldRuntimeInstanceIds = unique(runtimeInstanceEntry.records.map((record) => record.id))
  context.oldRuntimeInstanceIdSet = new Set(context.oldRuntimeInstanceIds)
}

const updateVmfContext = (context, vmfEntry) => {
  context.oldVmfIds = unique(vmfEntry.records.map((record) => record.id))
  context.oldVmfIdSet = new Set(context.oldVmfIds)
}

const findOldFrameworkPackages = async ({ models, context, minimumVersion }) => {
  const records = await queryLean(
    models.FrameworkPackage,
    { frameworkKey: context.frameworkKey },
    RUNTIME_CONTROL_PROJECTION,
  )

  return buildPlanEntry({
    key: 'FrameworkPackage',
    label: 'Framework Packages',
    model: models.FrameworkPackage,
    records,
    reasonForRecord: (record) =>
      hasFrameworkValue(record, 'frameworkKey', context.frameworkKey)
      && hasOldVersionField(record, 'version', minimumVersion)
        ? [`version:${normalizeText(record.version)}`]
        : [],
  })
}

const buildRuntimeControlEntries = async ({ models, context, minimumVersion }) => {
  const entries = []
  const specs = [
    {
      key: 'RuntimePathRegistry',
      label: 'Runtime Path Registry',
      model: models.RuntimePathRegistry,
      filter: { frameworkKeys: context.frameworkKey },
      frameworkFields: ['frameworkKeys'],
    },
    {
      key: 'SkillRoleRegistry',
      label: 'Skill Role Registry',
      model: models.SkillRoleRegistry,
      filter: {
        $or: [
          { introducedInVersion: { $exists: true } },
          { compatibilityTags: context.frameworkKey },
          { lockedByPackageKeys: { $in: context.oldPackageKeys } },
        ],
      },
      allowUnscopedVersionMatch: true,
    },
    {
      key: 'RuntimeSkill',
      label: 'Runtime Skills',
      model: models.RuntimeSkill,
      filter: { supportedFrameworkKeys: context.frameworkKey },
      frameworkFields: ['supportedFrameworkKeys'],
    },
    {
      key: 'ValidationRegistry',
      label: 'Validation Registry',
      model: models.ValidationRegistry,
      filter: { supportedFrameworkKeys: context.frameworkKey },
      frameworkFields: ['supportedFrameworkKeys'],
    },
    {
      key: 'RuntimeAgent',
      label: 'Runtime Agents',
      model: models.RuntimeAgent,
      filter: { supportedFrameworkKeys: context.frameworkKey },
      frameworkFields: ['supportedFrameworkKeys'],
    },
    {
      key: 'WorkflowPolicy',
      label: 'Workflow Policies',
      model: models.WorkflowPolicy,
      filter: { frameworkKeys: context.frameworkKey },
      frameworkFields: ['frameworkKeys'],
    },
    {
      key: 'UIContract',
      label: 'UI Contracts',
      model: models.UIContract,
      filter: {
        $or: [
          { frameworkKeys: context.frameworkKey },
          { sourceFrameworkKey: context.frameworkKey },
          { sourcePackageKey: { $in: context.oldPackageKeys } },
        ],
      },
      frameworkFields: ['frameworkKeys', 'sourceFrameworkKey'],
      versionFields: ['introducedInVersion', 'sourcePackageVersion'],
      packageKeyFields: ['sourcePackageKey'],
    },
    {
      key: 'KnowledgePackManifest',
      label: 'Knowledge Pack Manifests',
      model: models.KnowledgePackManifest,
      filter: {
        frameworkKey: context.frameworkKey,
        packageKey: { $in: context.oldPackageKeys },
      },
      frameworkFields: ['frameworkKey'],
      versionFields: [],
      packageKeyFields: ['packageKey'],
    },
  ]

  for (const spec of specs) {
    const records = await queryLean(spec.model, spec.filter, RUNTIME_CONTROL_PROJECTION)
    addEntry(entries, buildPlanEntry({
      key: spec.key,
      label: spec.label,
      model: spec.model,
      records,
      reasonForRecord: getRuntimeControlReasonBuilder({
        context,
        frameworkFields: spec.frameworkFields || [],
        versionFields: spec.versionFields || ['introducedInVersion'],
        packageKeyFields: spec.packageKeyFields || [],
        packageIdFields: spec.packageIdFields || [],
        allowUnscopedVersionMatch: spec.allowUnscopedVersionMatch === true,
        minimumVersion,
      }),
    }))
  }

  return entries
}

const buildRuntimeFoundationEntries = async ({ models, context, minimumVersion }) => {
  const entries = []

  const runtimeInstances = await queryLean(
    models.RuntimeInstance,
    { frameworkKey: context.frameworkKey },
    RUNTIME_RECORD_PROJECTION,
  )
  const runtimeInstanceEntry = buildPlanEntry({
    key: 'RuntimeInstance',
    label: 'Runtime Instances',
    model: models.RuntimeInstance,
    records: runtimeInstances,
    reasonForRecord: getRuntimeRecordReasonBuilder({
      context,
      versionFields: ['packageVersion'],
      packageKeyFields: ['packageKey'],
      packageIdFields: ['packageId'],
      minimumVersion,
    }),
  })
  updateRuntimeInstanceContext(context, runtimeInstanceEntry)
  addEntry(entries, runtimeInstanceEntry)

  const vmfs = await queryLean(
    models.VMF,
    {
      $or: [
        { frameworkVersion: { $exists: true } },
        { frameworkPackageId: { $in: context.oldPackageIds } },
      ],
    },
    RUNTIME_RECORD_PROJECTION,
  )
  const vmfEntry = buildPlanEntry({
    key: 'VMF',
    label: 'VMF Customer Records',
    model: models.VMF,
    records: vmfs,
    reasonForRecord: (record) => [
      ...collectOldVersionReasons(record, ['frameworkVersion'], minimumVersion),
      ...collectOldPackageReasons(record, context, { packageIdFields: ['frameworkPackageId'] }),
    ],
  })
  updateVmfContext(context, vmfEntry)
  addEntry(entries, vmfEntry)

  return entries
}

const buildDependentRuntimeEntries = async ({ models, context, minimumVersion }) => {
  const entries = []
  const specs = [
    {
      key: 'RuntimeGraphRelationship',
      label: 'Runtime Graph Relationships',
      model: models.RuntimeGraphRelationship,
      filter: { runtimeInstanceId: { $in: context.oldRuntimeInstanceIds } },
      frameworkRequired: false,
      versionFields: [],
      packageKeyFields: [],
      packageIdFields: [],
      includeRuntimeInstance: true,
    },
    {
      key: 'OutcomeMessage',
      label: 'Outcome Messages',
      model: models.OutcomeMessage,
      filter: {
        $or: [
          { frameworkKey: context.frameworkKey },
          { runtimeInstanceId: { $in: context.oldRuntimeInstanceIds } },
        ],
      },
      includeRuntimeInstance: true,
    },
    {
      key: 'OutcomeAssetVersion',
      label: 'Outcome Asset Versions',
      model: models.OutcomeAssetVersion,
      filter: {
        $or: [
          { frameworkKey: context.frameworkKey },
          { runtimeInstanceId: { $in: context.oldRuntimeInstanceIds } },
        ],
      },
      includeRuntimeInstance: true,
    },
    {
      key: 'OutcomeAsset',
      label: 'Outcome Assets',
      model: models.OutcomeAsset,
      filter: {
        $or: [
          { frameworkKey: context.frameworkKey },
          { runtimeInstanceId: { $in: context.oldRuntimeInstanceIds } },
        ],
      },
      includeRuntimeInstance: true,
    },
    {
      key: 'OutcomeSession',
      label: 'Outcome Sessions',
      model: models.OutcomeSession,
      filter: {
        $or: [
          { frameworkKey: context.frameworkKey },
          { runtimeInstanceId: { $in: context.oldRuntimeInstanceIds } },
        ],
      },
      includeRuntimeInstance: true,
    },
    {
      key: 'TruthSignature',
      label: 'Truth Signatures',
      model: models.TruthSignature,
      filter: {
        $or: [
          { frameworkKey: context.frameworkKey },
          { runtimeInstanceId: { $in: context.oldRuntimeInstanceIds } },
        ],
      },
      includeRuntimeInstance: true,
    },
    {
      key: 'RuntimeOutputAsset',
      label: 'Runtime Output Assets',
      model: models.RuntimeOutputAsset,
      filter: {
        $or: [
          { frameworkKey: context.frameworkKey },
          { runtimeInstanceId: { $in: context.oldRuntimeInstanceIds } },
        ],
      },
      includeRuntimeInstance: true,
    },
    {
      key: 'RuntimeOutputRequest',
      label: 'Runtime Output Requests',
      model: models.RuntimeOutputRequest,
      filter: {
        $or: [
          { frameworkKey: context.frameworkKey },
          { runtimeInstanceId: { $in: context.oldRuntimeInstanceIds } },
        ],
      },
      includeRuntimeInstance: true,
    },
    {
      key: 'RuntimeValidationAudit',
      label: 'Runtime Validation Audit',
      model: models.RuntimeValidationAudit,
      filter: {
        frameworkKey: context.frameworkKey,
        packageId: { $in: context.oldPackageIds },
      },
      versionFields: [],
      packageKeyFields: [],
      packageIdFields: ['packageId'],
    },
    {
      key: 'KnowledgePackActivation',
      label: 'Knowledge Pack Activations',
      model: models.KnowledgePackActivation,
      filter: {
        $or: [
          { frameworkKey: context.frameworkKey },
          { packageKey: { $in: context.oldPackageKeys } },
          { packageVersion: { $exists: true } },
        ],
      },
      versionFields: ['packageVersion'],
      packageKeyFields: ['packageKey'],
      packageIdFields: [],
    },
    {
      key: 'RuntimeDeployment',
      label: 'Runtime Deployments',
      model: models.RuntimeDeployment,
      filter: { frameworkKey: context.frameworkKey },
      versionFields: ['frameworkVersion'],
      packageKeyFields: ['packageKey'],
      packageIdFields: ['packageId'],
    },
    {
      key: 'RuntimeActivationSnapshot',
      label: 'Runtime Activation Snapshots',
      model: models.RuntimeActivationSnapshot,
      filter: { frameworkKey: context.frameworkKey },
      versionFields: ['frameworkVersion'],
      packageKeyFields: ['packageKey'],
      packageIdFields: ['packageId'],
    },
    {
      key: 'Deal',
      label: 'Deals Linked To Old VMFs',
      model: models.Deal,
      filter: { vmfId: { $in: context.oldVmfIds } },
      frameworkRequired: false,
      versionFields: [],
      packageKeyFields: [],
      packageIdFields: [],
      includeVmf: true,
    },
  ]

  for (const spec of specs) {
    const records = await queryLean(spec.model, spec.filter, RUNTIME_RECORD_PROJECTION)
    addEntry(entries, buildPlanEntry({
      key: spec.key,
      label: spec.label,
      model: spec.model,
      records,
      reasonForRecord: getRuntimeRecordReasonBuilder({
        context,
        frameworkRequired: spec.frameworkRequired !== false,
        versionFields: spec.versionFields || ['packageVersion'],
        packageKeyFields: spec.packageKeyFields || ['packageKey'],
        packageIdFields: spec.packageIdFields || ['packageId'],
        includeRuntimeInstance: spec.includeRuntimeInstance === true,
        includeVmf: spec.includeVmf === true,
        minimumVersion,
      }),
    }))
  }

  return entries
}

const calculateTotals = (entries) => ({
  matched: entries.reduce((total, entry) => total + entry.matched, 0),
  deleted: entries.reduce((total, entry) => total + (entry.deleted || 0), 0),
  skippedWithoutId: entries.reduce((total, entry) => total + entry.skippedWithoutId.length, 0),
})

export const buildPreV31VmfCleanupPlan = async ({
  frameworkKey = DEFAULT_FRAMEWORK_KEY,
  minimumVersion = DEFAULT_MINIMUM_VERSION,
  dependencies = {},
} = {}) => {
  const models = { ...DEFAULT_MODELS, ...(dependencies.models || {}) }
  const context = createContext({
    frameworkKey: normalizeFrameworkKey(frameworkKey),
    minimumVersion,
  })
  const entries = []

  const frameworkPackageEntry = await findOldFrameworkPackages({ models, context, minimumVersion })
  updateOldPackageContext(context, frameworkPackageEntry)

  const foundationEntries = await buildRuntimeFoundationEntries({ models, context, minimumVersion })
  const dependentEntries = await buildDependentRuntimeEntries({ models, context, minimumVersion })
  entries.push(...dependentEntries)
  entries.push(...foundationEntries)

  const runtimeControlEntries = await buildRuntimeControlEntries({ models, context, minimumVersion })
  entries.push(...runtimeControlEntries)
  entries.push(frameworkPackageEntry)

  return {
    ok: true,
    frameworkKey: context.frameworkKey,
    minimumVersion,
    oldPackageIds: context.oldPackageIds,
    oldPackageKeys: context.oldPackageKeys,
    oldRuntimeInstanceIds: context.oldRuntimeInstanceIds,
    oldVmfIds: context.oldVmfIds,
    entries,
    totals: calculateTotals(entries),
  }
}

const applyCleanupPlan = async ({ entries, models, session }) => {
  for (const entry of entries) {
    if (entry.deleteIds.length === 0) continue
    const model = models[entry.key]
    if (!model || typeof model.deleteMany !== 'function') {
      throw new Error(`No deleteMany implementation available for ${entry.key}.`)
    }
    const result = await model.deleteMany(
      { _id: { $in: entry.deleteIds } },
      session ? { session } : undefined,
    )
    entry.deleted = Number(result?.deletedCount) || 0
  }
}

const redactPlanForOutput = (summary) => ({
  ...summary,
  entries: summary.entries.map((entry) => ({
    ...entry,
    deleteIds: entry.deleteIds.map(stringifyId),
  })),
})

const writeReport = ({ summary, reportDir }) => {
  fs.mkdirSync(reportDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(reportDir, `pre-v3-1-vmf-cleanup-${summary.mode}-${timestamp}.json`)
  fs.writeFileSync(reportPath, `${JSON.stringify(redactPlanForOutput(summary), null, 2)}\n`, 'utf8')
  return reportPath
}

const logSummary = ({ summary, json, logger }) => {
  if (json) {
    logger(JSON.stringify(redactPlanForOutput(summary), null, 2))
    return
  }

  logger(
    `${summary.mode === 'apply' ? 'Applied' : 'Dry run'} pre-v3.1 ${summary.frameworkKey} cleanup: `
    + `${summary.totals.matched} stale record(s) matched, ${summary.totals.deleted} deleted.`,
  )
  for (const entry of summary.entries.filter((item) => item.matched > 0 || item.deleted > 0)) {
    logger(`- ${entry.label}: matched=${entry.matched}, deleted=${entry.deleted}`)
  }
  if (summary.reportPath) logger(`Report: ${summary.reportPath}`)
}

export const cleanupPreV31VmfRecords = async ({
  apply = false,
  confirmDelete = false,
  frameworkKey = DEFAULT_FRAMEWORK_KEY,
  json = false,
  logger = console.log,
  minimumVersion = DEFAULT_MINIMUM_VERSION,
  noReport = false,
  reportDir = DEFAULT_REPORT_DIR,
  dependencies = {},
} = {}) => {
  if (apply && !confirmDelete) {
    throw new Error(
      `apply=true requires ${DELETE_CONFIRMATION}. `
      + 'Run a dry-run and review the report before deleting old VMF data.',
    )
  }

  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const startSession = dependencies.startSession || (() => mongoose.startSession())
  const models = { ...DEFAULT_MODELS, ...(dependencies.models || {}) }

  await connect()

  try {
    const plan = await buildPreV31VmfCleanupPlan({
      frameworkKey,
      minimumVersion,
      dependencies: { models },
    })
    const summary = {
      ...plan,
      mode: apply ? 'apply' : 'dry-run',
      generatedAt: new Date().toISOString(),
    }

    if (apply) {
      const session = await startSession()
      try {
        await session.withTransaction(async () => {
          await applyCleanupPlan({ entries: summary.entries, models, session })
        })
      } finally {
        await session.endSession()
      }
      summary.totals = calculateTotals(summary.entries)
    }

    if (!noReport) {
      summary.reportPath = writeReport({ summary, reportDir })
    }

    logSummary({ summary, json, logger })
    return redactPlanForOutput(summary)
  } finally {
    await disconnect()
  }
}

const printHelp = () => {
  console.log(`
cleanupPreV31VmfRecords.js

Usage:
  node src/scripts/cleanupPreV31VmfRecords.js [options]

Options:
  --framework-key <key>          Framework key to clean. Defaults to VMF.
  --minimum-version <version>    Keep this version and newer. Defaults to 3.1.
  --apply                        Delete matched records. Omit for dry-run.
  ${DELETE_CONFIRMATION} Required with --apply.
  --report-dir <path>            Report directory. Defaults to docs/generated/cleanup-reports.
  --no-report                    Do not write a JSON report.
  --json                         Print machine-readable JSON.
  --help                         Show this help.

Safety:
  Dry-run is the default. Apply is blocked unless the explicit confirmation
  flag is present. Unknown or unversioned rows are not deleted unless they are
  explicitly linked to an old VMF package/runtime record.
`.trim())
}

const isDirectExecution = () => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  cleanupPreV31VmfRecords(args)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
