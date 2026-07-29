import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import UIContract, { buildUIContractStableId } from '../models/UIContract.js'
import WorkflowPolicy, { buildWorkflowPolicyStableId } from '../models/WorkflowPolicy.js'
import RuntimePathRegistry, { buildRuntimePathRegistryStableId } from '../models/RuntimePathRegistry.js'
import { RUNTIME_CONTROL_VERSION_STATUSES } from '../utils/runtimeControlVersioning.js'
import {
  loadSeedBundle,
  validateCrossReferences,
  validateWithMongoose,
} from './importFrameworkSeed.js'

const DEFAULT_SEED_VERSION = '3.1.1'
const DEFAULT_SOURCE_PACKAGE_KEY = 'standard-package-vmf-3-1-1-rkm-canonical'
const DEFAULT_TARGET_PACKAGE_KEY = 'standard-package-vmf-3-1-1-rkm'
const DEFAULT_SOURCE_UI_CONTRACT_KEY = 'standard-ui-contract-vmf-3-1-1-rkm-canonical'
const DEFAULT_TARGET_UI_CONTRACT_KEY = 'standard-ui-contract-vmf-3-1-1-rkm'
const CONFIRM_REPLACE = '--confirm-replace-active-framework-package'
const SEED_SYSTEM_ACTOR_ID = new mongoose.Types.ObjectId('000000000000000000000001')

const DEFAULT_MODELS = Object.freeze({
  FrameworkPackage,
  UIContract,
  WorkflowPolicy,
  RuntimePathRegistry,
})

const PACKAGE_PRESERVED_FIELDS = new Set([
  '_id',
  '__v',
  'id',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'activatedAt',
  'activatedBy',
  'assignedCustomerIds',
  'frameworkKey',
  'packageKey',
  'version',
  'status',
  'versionStatus',
  'isDefault',
  'isLocked',
  'lockedAt',
  'lockedBy',
  'lockedReason',
  'dependencyLock',
  'visibility',
  'customerAccessMode',
  'lastCheckpointAt',
  'lastCheckpointResult',
  'lastCheckpointStatus',
  'runtimeVerdict',
  'runtimeActivation',
  'runtimeActivationSnapshot',
])

const UI_CONTRACT_PRESERVED_FIELDS = new Set([
  '_id',
  '__v',
  'id',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'resolvedAt',
  'status',
  'versionStatus',
  'isLocked',
  'lockedAt',
  'lockedBy',
  'lockedReason',
])

const CONTROL_RECORD_PRESERVED_FIELDS = new Set([
  '_id',
  '__v',
  'id',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'isLocked',
  'lockedAt',
  'lockedBy',
  'lockedReason',
])

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = {
    apply: false,
    help: false,
    json: false,
    seedDir: '',
    seedVersion: DEFAULT_SEED_VERSION,
    sourcePackageKey: DEFAULT_SOURCE_PACKAGE_KEY,
    targetPackageKey: DEFAULT_TARGET_PACKAGE_KEY,
    sourceUiContractKey: DEFAULT_SOURCE_UI_CONTRACT_KEY,
    targetUiContractKey: DEFAULT_TARGET_UI_CONTRACT_KEY,
    confirmed: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--json') args.json = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === CONFIRM_REPLACE) args.confirmed = true
    else if (arg === '--seed-dir') {
      args.seedDir = String(argv[index + 1] || '').trim()
      index += 1
    } else if (arg === '--seed-version') {
      args.seedVersion = String(argv[index + 1] || '').trim()
      index += 1
    } else if (arg === '--source-package-key') {
      args.sourcePackageKey = String(argv[index + 1] || '').trim()
      index += 1
    } else if (arg === '--target-package-key') {
      args.targetPackageKey = String(argv[index + 1] || '').trim()
      index += 1
    } else if (arg === '--source-ui-contract-key') {
      args.sourceUiContractKey = String(argv[index + 1] || '').trim()
      index += 1
    } else if (arg === '--target-ui-contract-key') {
      args.targetUiContractKey = String(argv[index + 1] || '').trim()
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`)
    }
  }

  if (args.help) return args
  if (!args.seedDir) throw new Error('--seed-dir is required. Run with --help for usage.')
  if (!args.sourcePackageKey || !args.targetPackageKey) {
    throw new Error('--source-package-key and --target-package-key are required.')
  }
  if (!args.sourceUiContractKey || !args.targetUiContractKey) {
    throw new Error('--source-ui-contract-key and --target-ui-contract-key are required.')
  }
  if (args.apply && !args.confirmed) {
    throw new Error(`${CONFIRM_REPLACE} is required with --apply.`)
  }
  return args
}

const printHelp = () => {
  console.log(`
replaceActiveFrameworkPackageFromSeed.js

Usage:
  node src/scripts/replaceActiveFrameworkPackageFromSeed.js --seed-dir <path> [--apply] ${CONFIRM_REPLACE} [--json]

Purpose:
  Applies a normalized seed pack onto an already ACTIVE Framework Package while
  preserving the customer-facing package identity and deployment references.

Defaults:
  --seed-version ${DEFAULT_SEED_VERSION}
  --source-package-key ${DEFAULT_SOURCE_PACKAGE_KEY}
  --target-package-key ${DEFAULT_TARGET_PACKAGE_KEY}
  --source-ui-contract-key ${DEFAULT_SOURCE_UI_CONTRACT_KEY}
  --target-ui-contract-key ${DEFAULT_TARGET_UI_CONTRACT_KEY}

Safety:
  Dry-run is the default. Apply mode requires the explicit confirmation flag.
  This command does not reset Runtime Control collections and does not create a
  second Framework Package for the same framework/version.
`.trim())
}

const stringifyId = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const asPlain = (value) => {
  if (!value) return value
  if (typeof value.toObject === 'function') return value.toObject({ depopulate: true })
  return value
}

const mapSeedValue = (value, replacements) => {
  if (typeof value === 'string') return replacements.get(value) || value
  if (Array.isArray(value)) return value.map((item) => mapSeedValue(item, replacements))
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value
    if (typeof value.toHexString === 'function') return value
    return Object.entries(value).reduce((next, [key, entry]) => {
      next[key] = mapSeedValue(entry, replacements)
      return next
    }, {})
  }
  return value
}

const recordsForModelName = (bundle, modelName) => {
  const entry = bundle.find((step) => step.records && step.model?.modelName === modelName)
  return entry?.records || []
}

const cloneBundleWithMappedKeys = (bundle, options) => {
  const replacements = new Map([
    [options.sourcePackageKey, options.targetPackageKey],
    [options.sourceUiContractKey, options.targetUiContractKey],
    [`ui-contract-${options.sourceUiContractKey}`, buildUIContractStableId(options.targetUiContractKey)],
  ])

  return bundle.map((entry) => {
    if (!entry.records) return entry
    return {
      ...entry,
      records: entry.records.map((record) => mapSeedValue(record, replacements)),
    }
  })
}

const listContainsValue = (value, needle) => {
  if (typeof value === 'string') return value === needle
  if (Array.isArray(value)) return value.some((item) => listContainsValue(item, needle))
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => listContainsValue(item, needle))
  }
  return false
}

const findUnmappedSourceReferences = (bundle, options) => {
  const needles = [options.sourcePackageKey, options.sourceUiContractKey]
  const findings = []
  for (const entry of bundle.filter((step) => step.records)) {
    entry.records.forEach((record, index) => {
      for (const needle of needles) {
        if (listContainsValue(record, needle)) {
          findings.push({
            label: entry.label,
            index,
            sourceReference: needle,
          })
        }
      }
    })
  }
  return findings
}

const removePreservedFields = (record, preservedFields) =>
  Object.entries(record).reduce((payload, [field, value]) => {
    if (!preservedFields.has(field)) payload[field] = value
    return payload
  }, {})

const mergeLockedPackageKeys = (seedRecord, existingRecord, targetPackageKey) => {
  const values = [
    ...(Array.isArray(seedRecord.lockedByPackageKeys) ? seedRecord.lockedByPackageKeys : []),
    ...(Array.isArray(existingRecord?.lockedByPackageKeys) ? existingRecord.lockedByPackageKeys : []),
    targetPackageKey,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(values)]
}

const resolveActiveReplacementVersionStatus = (existingPackage) =>
  existingPackage?.status === 'ACTIVE'
    ? RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE
    : existingPackage?.versionStatus || RUNTIME_CONTROL_VERSION_STATUSES.DRAFT

const resolveActiveUiContractBindingStatus = (existingPackage) =>
  existingPackage?.status === 'ACTIVE'
    ? RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE
    : existingPackage?.uiContractBinding?.status || RUNTIME_CONTROL_VERSION_STATUSES.DRAFT

const buildPackageReplacementPayload = ({ seedPackage, existingPackage }) => ({
  ...removePreservedFields(seedPackage, PACKAGE_PRESERVED_FIELDS),
  frameworkKey: existingPackage.frameworkKey,
  packageKey: existingPackage.packageKey,
  version: existingPackage.version,
  status: existingPackage.status,
  versionStatus: resolveActiveReplacementVersionStatus(existingPackage),
  isDefault: existingPackage.isDefault === true,
  isLocked: existingPackage.isLocked === true,
  dependencyLock: existingPackage.dependencyLock || null,
  uiContractKey: seedPackage.uiContractKey,
  uiContractBinding: {
    ...(seedPackage.uiContractBinding || {}),
    key: seedPackage.uiContractKey,
    version: seedPackage.uiContractBinding?.version || seedPackage.version,
    status: resolveActiveUiContractBindingStatus(existingPackage),
    compatibilityMode: existingPackage.uiContractBinding?.compatibilityMode
      || seedPackage.uiContractBinding?.compatibilityMode,
    resolvedAt: existingPackage.uiContractBinding?.resolvedAt || seedPackage.uiContractBinding?.resolvedAt || new Date(),
  },
  updatedAt: new Date(),
})

const buildUiContractReplacementPayload = ({ seedUiContract, existingUiContract }) => ({
  ...removePreservedFields(seedUiContract, UI_CONTRACT_PRESERVED_FIELDS),
  uiContractKey: existingUiContract.uiContractKey,
  stableId: existingUiContract.stableId || buildUIContractStableId(existingUiContract.uiContractKey),
  status: existingUiContract.status,
  versionStatus: existingUiContract.versionStatus,
  isLocked: existingUiContract.isLocked === true,
  updatedAt: new Date(),
})

const buildControlRecordPayload = ({ seedRecord, existingRecord, targetPackageKey }) => ({
  ...removePreservedFields(seedRecord, CONTROL_RECORD_PRESERVED_FIELDS),
  lockedByPackageKeys: mergeLockedPackageKeys(seedRecord, existingRecord, targetPackageKey),
  updatedAt: new Date(),
})

const withRequiredActorFields = (payload = {}, existingDocument = null) => {
  const nextPayload = { ...payload }
  if (!existingDocument?.createdBy && !nextPayload.createdBy) {
    nextPayload.createdBy = SEED_SYSTEM_ACTOR_ID
  }
  if (!existingDocument?.updatedBy && !nextPayload.updatedBy) {
    nextPayload.updatedBy = SEED_SYSTEM_ACTOR_ID
  }
  return nextPayload
}

const leanOne = async (query) => {
  const leaned = typeof query?.lean === 'function' ? query.lean() : query
  return leaned
}

const leanMany = async (query) => {
  const leaned = typeof query?.lean === 'function' ? query.lean() : query
  return leaned
}

const buildExistingMap = async ({ model, field, values }) => {
  const uniqueValues = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
  if (uniqueValues.length === 0) return new Map()
  const records = await leanMany(model.find({ [field]: { $in: uniqueValues } }))
  return new Map((records || []).map((record) => [String(record[field] || '').trim(), record]))
}

const findOneDocument = async (model, query, session) => {
  let findQuery = model.findOne(query)
  if (session && typeof findQuery?.session === 'function') {
    findQuery = findQuery.session(session)
  }
  if (typeof findQuery?.exec === 'function') return findQuery.exec()
  return findQuery
}

const assertStableIdMatches = ({ record, expectedStableId, source }) => {
  const actualStableId = String(record?.stableId || '').trim().toLowerCase()
  if (actualStableId && actualStableId !== expectedStableId) {
    throw new Error(`${source} stableId "${actualStableId}" does not match deterministic stableId "${expectedStableId}".`)
  }
}

const assertDeterministicSeedStableIds = ({ runtimePaths = [], workflowPolicies = [], uiContract = null }) => {
  runtimePaths.forEach((record) => {
    assertStableIdMatches({
      record,
      expectedStableId: buildRuntimePathRegistryStableId(record.pathKey),
      source: `Runtime path ${record.pathKey}`,
    })
  })

  workflowPolicies.forEach((record) => {
    assertStableIdMatches({
      record,
      expectedStableId: buildWorkflowPolicyStableId(record.key),
      source: `Workflow policy ${record.key}`,
    })
  })

  if (uiContract) {
    assertStableIdMatches({
      record: uiContract,
      expectedStableId: buildUIContractStableId(uiContract.uiContractKey),
      source: `UI Contract ${uiContract.uiContractKey}`,
    })
  }
}

const assertExistingStableIds = ({
  records,
  existingMap,
  keyField,
  buildStableId,
  sourceLabel,
}) => {
  records.forEach((record) => {
    const key = String(record?.[keyField] || '').trim()
    const existingRecord = existingMap.get(key)
    if (!existingRecord?.stableId) return
    assertStableIdMatches({
      record: existingRecord,
      expectedStableId: buildStableId(key),
      source: `${sourceLabel} ${key}`,
    })
  })
}

const countActions = ({ records, existingMap, keyField }) => {
  let create = 0
  let update = 0
  for (const record of records) {
    const key = String(record[keyField] || '').trim()
    if (existingMap.has(key)) update += 1
    else create += 1
  }
  return { create, update }
}

const validateReplacementCandidate = async ({ bundle, notes }) => {
  validateCrossReferences(bundle, notes)
  await validateWithMongoose(bundle, notes)
  const errors = notes.filter((note) => note.level === 'error')
  if (errors.length > 0) {
    const preview = errors.slice(0, 5).map((note) => `${note.source}: ${note.message}`).join('; ')
    throw new Error(`Replacement seed failed validation with ${errors.length} error(s): ${preview}`)
  }
}

const buildReplacementPlan = async ({ bundle, options, models }) => {
  const notesEntry = bundle.find((entry) => entry.notes)
  const notes = notesEntry?.notes || []
  const sourceFindings = findUnmappedSourceReferences(bundle, options)
  if (sourceFindings.length > 0) {
    throw new Error(`Replacement mapping left ${sourceFindings.length} source package/UI references unresolved.`)
  }
  await validateReplacementCandidate({ bundle, notes })

  const [seedPackage] = recordsForModelName(bundle, 'FrameworkPackage')
  const [seedUiContract] = recordsForModelName(bundle, 'UIContract')
  const workflowPolicies = recordsForModelName(bundle, 'WorkflowPolicy')
  const runtimePaths = recordsForModelName(bundle, 'RuntimePathRegistry')

  if (!seedPackage) throw new Error('Mapped seed bundle does not contain a FrameworkPackage record.')
  if (!seedUiContract) throw new Error('Mapped seed bundle does not contain a UIContract record.')
  assertDeterministicSeedStableIds({
    runtimePaths,
    workflowPolicies,
    uiContract: seedUiContract,
  })

  const existingPackage = await leanOne(models.FrameworkPackage.findOne({ packageKey: options.targetPackageKey }))
  if (!existingPackage) throw new Error(`Target Framework Package not found: ${options.targetPackageKey}`)
  if (existingPackage.status !== 'ACTIVE') {
    throw new Error(`Target Framework Package must be ACTIVE for in-place replacement; current status is ${existingPackage.status}.`)
  }
  if (existingPackage.version !== seedPackage.version) {
    throw new Error(`Seed version ${seedPackage.version} does not match active package version ${existingPackage.version}.`)
  }
  if (existingPackage.frameworkKey !== seedPackage.frameworkKey) {
    throw new Error(`Seed framework ${seedPackage.frameworkKey} does not match active package framework ${existingPackage.frameworkKey}.`)
  }

  const duplicateVersion = await leanOne(models.FrameworkPackage.findOne({
    frameworkKey: existingPackage.frameworkKey,
    version: existingPackage.version,
    packageKey: { $ne: existingPackage.packageKey },
  }))
  if (duplicateVersion) {
    throw new Error(`A second ${existingPackage.frameworkKey} / ${existingPackage.version} package already exists: ${duplicateVersion.packageKey}`)
  }

  const existingUiContract = await leanOne(models.UIContract.findOne({ uiContractKey: options.targetUiContractKey }))
  if (!existingUiContract) throw new Error(`Target UI Contract not found: ${options.targetUiContractKey}`)

  const policyExistingMap = await buildExistingMap({
    model: models.WorkflowPolicy,
    field: 'key',
    values: workflowPolicies.map((record) => record.key),
  })
  const pathExistingMap = await buildExistingMap({
    model: models.RuntimePathRegistry,
    field: 'pathKey',
    values: runtimePaths.map((record) => record.pathKey),
  })
  assertExistingStableIds({
    records: workflowPolicies,
    existingMap: policyExistingMap,
    keyField: 'key',
    buildStableId: buildWorkflowPolicyStableId,
    sourceLabel: 'Existing workflow policy',
  })
  assertExistingStableIds({
    records: runtimePaths,
    existingMap: pathExistingMap,
    keyField: 'pathKey',
    buildStableId: buildRuntimePathRegistryStableId,
    sourceLabel: 'Existing runtime path',
  })

  const policyActions = countActions({
    records: workflowPolicies,
    existingMap: policyExistingMap,
    keyField: 'key',
  })
  const pathActions = countActions({
    records: runtimePaths,
    existingMap: pathExistingMap,
    keyField: 'pathKey',
  })

  return {
    mode: 'dry-run',
    source: {
      seedVersion: options.seedVersion,
      seedDir: options.seedDir,
      sourcePackageKey: options.sourcePackageKey,
      sourceUiContractKey: options.sourceUiContractKey,
    },
    target: {
      packageId: stringifyId(existingPackage._id),
      packageKey: existingPackage.packageKey,
      frameworkKey: existingPackage.frameworkKey,
      version: existingPackage.version,
      status: existingPackage.status,
      isDefault: existingPackage.isDefault === true,
      uiContractKey: existingPackage.uiContractKey,
      uiContractId: stringifyId(existingUiContract._id),
    },
    records: {
      runtimePaths: {
        loaded: runtimePaths.length,
        existing: pathExistingMap.size,
        create: pathActions.create,
        update: pathActions.update,
      },
      workflowPolicies: {
        loaded: workflowPolicies.length,
        existing: policyExistingMap.size,
        create: policyActions.create,
        update: policyActions.update,
      },
      uiContract: {
        actionCount: Array.isArray(seedUiContract.actions) ? seedUiContract.actions.length : 0,
        sectionCount: Array.isArray(seedUiContract.sections) ? seedUiContract.sections.length : 0,
      },
      frameworkPackage: {
        dependencyReferences: Array.isArray(seedPackage.dependencyLock?.references)
          ? seedPackage.dependencyLock.references.length
          : 0,
        workflowBindings: Array.isArray(seedPackage.workflowBindings)
          ? seedPackage.workflowBindings.length
          : 0,
      },
    },
    notes,
    sourceFindings,
    seedRecords: {
      package: seedPackage,
      uiContract: seedUiContract,
      runtimePaths,
      workflowPolicies,
    },
    existingRecords: {
      package: existingPackage,
      uiContract: existingUiContract,
      runtimePathMap: pathExistingMap,
      workflowPolicyMap: policyExistingMap,
    },
  }
}

const assertActiveReplacementTarget = async ({ plan, models, session }) => {
  const existingPackage = await findOneDocument(
    models.FrameworkPackage,
    { packageKey: plan.target.packageKey },
    session,
  )
  if (!existingPackage) throw new Error(`Target Framework Package not found during apply: ${plan.target.packageKey}`)
  if (existingPackage.status !== 'ACTIVE') {
    throw new Error(`Target Framework Package must still be ACTIVE during apply; current status is ${existingPackage.status}.`)
  }
  if (existingPackage.version !== plan.seedRecords.package.version) {
    throw new Error(`Seed version ${plan.seedRecords.package.version} does not match active package version ${existingPackage.version} during apply.`)
  }
  if (existingPackage.frameworkKey !== plan.seedRecords.package.frameworkKey) {
    throw new Error(`Seed framework ${plan.seedRecords.package.frameworkKey} does not match active package framework ${existingPackage.frameworkKey} during apply.`)
  }
  if (existingPackage.isLocked !== true) {
    throw new Error('Target Framework Package must remain locked during governed in-place replacement.')
  }

  const duplicateVersion = await findOneDocument(
    models.FrameworkPackage,
    {
      frameworkKey: existingPackage.frameworkKey,
      version: existingPackage.version,
      packageKey: { $ne: existingPackage.packageKey },
    },
    session,
  )
  if (duplicateVersion) {
    throw new Error(`A second ${existingPackage.frameworkKey} / ${existingPackage.version} package exists during apply: ${duplicateVersion.packageKey}`)
  }

  const existingUiContract = await findOneDocument(
    models.UIContract,
    { uiContractKey: plan.target.uiContractKey },
    session,
  )
  if (!existingUiContract) throw new Error(`Target UI Contract not found during apply: ${plan.target.uiContractKey}`)

  return { existingPackage, existingUiContract }
}

const setAndSaveDocument = async ({ document, payload, session, preserveStableId = true }) => {
  const updatePayload = withRequiredActorFields(payload, document)
  if (preserveStableId && document.stableId) delete updatePayload.stableId
  document.set(updatePayload)
  if (document.$locals) {
    document.$locals.allowLockedRuntimeControlWrite = true
  }
  if (document.$locals && Object.prototype.hasOwnProperty.call(updatePayload, 'resolvedAt')) {
    document.$locals.allowResolvedAtWrite = true
  }
  await document.save(session ? { session } : undefined)
}

const applyReplacementPlan = async ({ plan, models, session, targetPackageKey }) => {
  const { existingPackage, existingUiContract } = await assertActiveReplacementTarget({
    plan,
    models,
    session,
  })

  for (const runtimePath of plan.seedRecords.runtimePaths) {
    const existing = plan.existingRecords.runtimePathMap.get(runtimePath.pathKey)
    const payload = buildControlRecordPayload({
      seedRecord: runtimePath,
      existingRecord: existing,
      targetPackageKey,
    })
    if (existing) {
      const doc = await findOneDocument(models.RuntimePathRegistry, { pathKey: runtimePath.pathKey }, session)
      if (doc) {
        await setAndSaveDocument({ document: doc, payload, session })
      }
    } else {
      const doc = new models.RuntimePathRegistry(withRequiredActorFields({ ...runtimePath, ...payload }))
      await doc.save(session ? { session } : undefined)
    }
  }

  for (const workflowPolicy of plan.seedRecords.workflowPolicies) {
    const existing = plan.existingRecords.workflowPolicyMap.get(workflowPolicy.key)
    const payload = buildControlRecordPayload({
      seedRecord: workflowPolicy,
      existingRecord: existing,
      targetPackageKey,
    })
    if (existing) {
      const doc = await findOneDocument(models.WorkflowPolicy, { key: workflowPolicy.key }, session)
      if (doc) {
        await setAndSaveDocument({ document: doc, payload, session })
      }
    } else {
      const doc = new models.WorkflowPolicy(withRequiredActorFields({ ...workflowPolicy, ...payload }))
      await doc.save(session ? { session } : undefined)
    }
  }

  await setAndSaveDocument({
    document: existingUiContract,
    payload: buildUiContractReplacementPayload({
      seedUiContract: plan.seedRecords.uiContract,
      existingUiContract,
    }),
    session,
  })

  await setAndSaveDocument({
    document: existingPackage,
    payload: buildPackageReplacementPayload({
      seedPackage: plan.seedRecords.package,
      existingPackage,
    }),
    session,
  })
}

const publicPlan = (plan) => {
  const {
    seedRecords: _seedRecords,
    existingRecords: _existingRecords,
    ...visible
  } = plan
  return visible
}

const replaceActiveFrameworkPackageFromSeed = async ({
  apply = false,
  json = false,
  logger = console.log,
  dependencies = {},
  ...options
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const startSession = dependencies.startSession || (() => mongoose.startSession())
  const models = { ...DEFAULT_MODELS, ...(dependencies.models || {}) }
  const loadBundle = dependencies.loadSeedBundle || loadSeedBundle

  await connect()
  try {
    const rawBundle = loadBundle(options.seedDir, options.seedVersion || DEFAULT_SEED_VERSION)
    const mappedBundle = cloneBundleWithMappedKeys(rawBundle, options)
    const plan = await buildReplacementPlan({ bundle: mappedBundle, options, models })
    const result = {
      ...publicPlan(plan),
      mode: apply ? 'apply' : 'dry-run',
      applied: false,
    }

    if (apply) {
      const session = await startSession()
      try {
        await session.withTransaction(async () => {
          const activePackageRecheck = await models.FrameworkPackage.findOne({
            packageKey: options.targetPackageKey,
          }).session(session)
          if (!activePackageRecheck || activePackageRecheck.status !== 'ACTIVE') {
            throw new Error(
              `Target Framework Package is no longer ACTIVE or has been deleted; status is ${activePackageRecheck?.status || 'NOT_FOUND'}. Aborting apply.`,
            )
          }
          const duplicateRecheck = await models.FrameworkPackage.findOne({
            frameworkKey: activePackageRecheck.frameworkKey,
            version: activePackageRecheck.version,
            packageKey: { $ne: activePackageRecheck.packageKey },
          }).session(session)
          if (duplicateRecheck) {
            throw new Error(
              `A second ${activePackageRecheck.frameworkKey} / ${activePackageRecheck.version} package now exists. Aborting apply.`,
            )
          }
          await applyReplacementPlan({
            plan,
            models,
            session,
            targetPackageKey: options.targetPackageKey,
          })
        })
      } finally {
        await session.endSession()
      }
      result.applied = true
    }

    logger(
      json
        ? JSON.stringify(result, null, 2)
        : `${apply ? 'Applied' : 'Dry run'} active Framework Package replacement for ${result.target.packageKey}: applied=${result.applied}.`,
    )
    return result
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

if (isDirectExecution()) {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  replaceActiveFrameworkPackageFromSeed(args)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}

export {
  applyReplacementPlan,
  assertDeterministicSeedStableIds,
  assertExistingStableIds,
  buildControlRecordPayload,
  buildPackageReplacementPayload,
  buildReplacementPlan,
  buildUiContractReplacementPayload,
  cloneBundleWithMappedKeys,
  mapSeedValue,
  parseArgs,
  replaceActiveFrameworkPackageFromSeed,
  resolveActiveReplacementVersionStatus,
  resolveActiveUiContractBindingStatus,
  withRequiredActorFields,
}
