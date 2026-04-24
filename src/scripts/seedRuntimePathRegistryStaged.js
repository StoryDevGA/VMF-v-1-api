import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import env from '../config/env.js'
import { connectDb, disconnectDb } from '../config/db.js'
import { User } from '../models/index.js'
import RuntimePathRegistry, {
  RUNTIME_PATH_REGISTRY_CATEGORIES,
  RUNTIME_PATH_REGISTRY_DATA_TYPES,
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_SCOPES,
  RUNTIME_PATH_REGISTRY_SOURCE_TYPES,
  RUNTIME_PATH_REGISTRY_STATUSES,
  RUNTIME_PATH_REGISTRY_UI_CONTROLS,
} from '../models/RuntimePathRegistry.js'
import { getRuntimePathRegistryVmf231Seeds } from '../seeds/runtimePathRegistryVmf231.js'

// NOTE:
// The temp spec in docs/temp-docs/ defines a stableId format without a hash, but the app's
// RuntimePathRegistry model remains the source of truth. This script intentionally writes through
// real Mongoose documents so schema defaults, immutability, hooks, and validation stay aligned.

const STAGE_LIFECYCLE = 'lifecycle'
const STAGE_VMF_V231 = 'vmf-v2-3-1'

const STAGED_SEEDS = Object.freeze({
  [STAGE_LIFECYCLE]: () => Object.freeze([
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
      allowedValues: ['DRAFT', 'SUBMITTED', 'APPROVED'],
      allowedValueLabels: {
        DRAFT: 'Draft',
        SUBMITTED: 'Submitted',
        APPROVED: 'Approved',
      },
      uiControl: RUNTIME_PATH_REGISTRY_UI_CONTROLS.SELECT,
      placeholderText: 'Select lifecycle stage',
      helpText: 'Select the lifecycle stage for the framework state.',
      defaultValue: 'DRAFT',
      minLength: 1,
      maxLength: 40,
      isNullable: false,
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
      uiControl: RUNTIME_PATH_REGISTRY_UI_CONTROLS.CHECKBOX,
      helpText: 'When locked, the framework state is protected from edits.',
      defaultValue: false,
      isNullable: false,
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
      uiControl: RUNTIME_PATH_REGISTRY_UI_CONTROLS.CHECKBOX,
      helpText: 'Whether the current framework state has been published.',
      defaultValue: false,
      isNullable: false,
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
      placeholderText: 'YYYY-MM-DDTHH:mm:ss.sssZ',
      helpText: 'Most recent lifecycle transition timestamp (ISO 8601).',
      compatibilityTags: ['VMF', '2.3.1'],
    },
    {
      pathKey: 'framework_state.policy.last_result',
      label: 'Policy Last Result',
      description: 'Result summary from the most recent workflow policy evaluation.',
      scope: RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE,
      allowedOperations: [
        RUNTIME_PATH_REGISTRY_OPERATIONS.READ,
        RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
        RUNTIME_PATH_REGISTRY_OPERATIONS.BIND,
      ],
      dataType: RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING,
      category: RUNTIME_PATH_REGISTRY_CATEGORIES.SYSTEM,
      sourceType: RUNTIME_PATH_REGISTRY_SOURCE_TYPES.RUNTIME_STATE,
      isProtected: false,
      isSystem: true,
      introducedInVersion: '2.3.1',
      exampleValue: 'PASS',
      uiControl: RUNTIME_PATH_REGISTRY_UI_CONTROLS.TEXT,
      placeholderText: 'PASS',
      helpText: 'Most recent policy evaluation summary (implementation-defined).',
      minLength: 1,
      maxLength: 80,
      isNullable: true,
      compatibilityTags: ['VMF', '2.3.1'],
    },
    {
      pathKey: 'framework_state.validation.required_sections.is_valid',
      label: 'Required Sections Valid',
      description: 'Whether all required framework sections are present and valid.',
      scope: RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE,
      allowedOperations: [
        RUNTIME_PATH_REGISTRY_OPERATIONS.READ,
        RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
        RUNTIME_PATH_REGISTRY_OPERATIONS.BIND,
      ],
      dataType: RUNTIME_PATH_REGISTRY_DATA_TYPES.BOOLEAN,
      category: RUNTIME_PATH_REGISTRY_CATEGORIES.VALIDATION,
      sourceType: RUNTIME_PATH_REGISTRY_SOURCE_TYPES.RUNTIME_STATE,
      isProtected: false,
      isSystem: true,
      introducedInVersion: '2.3.1',
      exampleValue: true,
      uiControl: RUNTIME_PATH_REGISTRY_UI_CONTROLS.CHECKBOX,
      defaultValue: true,
      isNullable: false,
      compatibilityTags: ['VMF', '2.3.1'],
    },
    {
      pathKey: 'framework_state.policy.last_block_reason',
      label: 'Policy Last Block Reason',
      description: 'Reason text captured when policy evaluation blocks lifecycle progression.',
      scope: RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE,
      allowedOperations: [
        RUNTIME_PATH_REGISTRY_OPERATIONS.READ,
        RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
        RUNTIME_PATH_REGISTRY_OPERATIONS.BIND,
      ],
      dataType: RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING,
      category: RUNTIME_PATH_REGISTRY_CATEGORIES.SYSTEM,
      sourceType: RUNTIME_PATH_REGISTRY_SOURCE_TYPES.RUNTIME_STATE,
      isProtected: false,
      isSystem: true,
      introducedInVersion: '2.3.1',
      exampleValue: 'Missing required lifecycle approvals.',
      uiControl: RUNTIME_PATH_REGISTRY_UI_CONTROLS.TEXTAREA,
      placeholderText: 'Explain why the policy blocked progression...',
      helpText: 'If set, this message should explain the last policy block decision.',
      minLength: 0,
      maxLength: 800,
      isNullable: true,
      compatibilityTags: ['VMF', '2.3.1'],
    },
  ]),
  [STAGE_VMF_V231]: () => getRuntimePathRegistryVmf231Seeds(),
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
  if (pathKey && !/^[a-z0-9_]+(\.(\*|[a-z0-9_]+))*$/.test(pathKey)) {
    errors.push('pathKey must use dot notation with snake_case segments and may include "*" wildcard segments')
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

  const allowedValues = seed?.allowedValues
  const hasAllowedValues = Array.isArray(allowedValues) && allowedValues.length > 0
  if (allowedValues !== undefined && !Array.isArray(allowedValues)) {
    errors.push('allowedValues must be an array when provided')
  }
  if (Array.isArray(allowedValues) && allowedValues.some((value) => !String(value || '').trim())) {
    errors.push('allowedValues must not contain empty values')
  }

  const allowedValueLabels = seed?.allowedValueLabels
  if (allowedValueLabels !== undefined) {
    const isObject = allowedValueLabels
      && typeof allowedValueLabels === 'object'
      && !Array.isArray(allowedValueLabels)
    if (!isObject) errors.push('allowedValueLabels must be an object map when provided')
  }
  if (allowedValueLabels && typeof allowedValueLabels === 'object' && !Array.isArray(allowedValueLabels) && hasAllowedValues) {
    const allowedSet = new Set(allowedValues.map((value) => String(value)))
    const invalidLabelKeys = Object.keys(allowedValueLabels).filter((key) => !allowedSet.has(key))
    if (invalidLabelKeys.length > 0) {
      errors.push('allowedValueLabels keys must be included in allowedValues')
    }
  }
  if (allowedValueLabels && !hasAllowedValues) {
    errors.push('allowedValueLabels requires allowedValues')
  }

  const dataType = String(seed?.dataType || '').trim()
  const uiControl = seed?.uiControl ? String(seed.uiControl || '').trim().toUpperCase() : ''
  const stringLike = dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING
    || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.ENUM
    || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.MIXED
  const jsonLike = dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.OBJECT
    || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.ARRAY
    || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.MIXED

  if (uiControl) {
    if (!Object.values(RUNTIME_PATH_REGISTRY_UI_CONTROLS).includes(uiControl)) {
      errors.push('uiControl must be a supported runtime-path UI control')
    }

    if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.SELECT && !hasAllowedValues) {
      errors.push('uiControl=SELECT requires allowedValues')
    }

    if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.CHECKBOX && dataType !== RUNTIME_PATH_REGISTRY_DATA_TYPES.BOOLEAN) {
      errors.push('uiControl=CHECKBOX requires dataType=BOOLEAN')
    }

    if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.NUMBER && dataType !== RUNTIME_PATH_REGISTRY_DATA_TYPES.NUMBER) {
      errors.push('uiControl=NUMBER requires dataType=NUMBER')
    }

    if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.JSON && !jsonLike) {
      errors.push('uiControl=JSON requires dataType=OBJECT, ARRAY, or MIXED')
    }

    if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.TEXTAREA && !stringLike) {
      errors.push('uiControl=TEXTAREA requires dataType=STRING, ENUM, or MIXED')
    }

    if (uiControl === RUNTIME_PATH_REGISTRY_UI_CONTROLS.TEXT && !stringLike) {
      errors.push('uiControl=TEXT requires dataType=STRING, ENUM, or MIXED')
    }
  }

  const hasNumericConstraints = Number.isFinite(seed?.minValue) || Number.isFinite(seed?.maxValue)
  if (hasNumericConstraints && dataType !== RUNTIME_PATH_REGISTRY_DATA_TYPES.NUMBER) {
    errors.push('minValue/maxValue are only supported for dataType=NUMBER')
  }
  if (Number.isFinite(seed?.minValue) && Number.isFinite(seed?.maxValue) && seed.minValue > seed.maxValue) {
    errors.push('minValue must be <= maxValue')
  }

  const hasLengthConstraints = Number.isFinite(seed?.minLength) || Number.isFinite(seed?.maxLength)
  if (hasLengthConstraints && !(dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.ENUM)) {
    errors.push('minLength/maxLength are only supported for dataType=STRING or ENUM')
  }
  if (Number.isFinite(seed?.minLength) && Number.isFinite(seed?.maxLength) && seed.minLength > seed.maxLength) {
    errors.push('minLength must be <= maxLength')
  }

  const regexPattern = String(seed?.regexPattern || '').trim()
  if (regexPattern) {
    if (dataType !== RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING) {
      errors.push('regexPattern is only supported for dataType=STRING')
    } else {
      try {
        // eslint-disable-next-line no-new
        new RegExp(regexPattern)
      } catch {
        errors.push('regexPattern must be a valid regular expression')
      }
    }
  }

  if (seed?.defaultValue !== undefined) {
    if (seed.defaultValue === null && seed.isNullable === false) {
      errors.push('defaultValue cannot be null when isNullable is false')
    }

    if (seed.defaultValue !== null) {
      if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.BOOLEAN && typeof seed.defaultValue !== 'boolean') {
        errors.push('defaultValue must be boolean for dataType=BOOLEAN')
      }

      if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.NUMBER) {
        if (typeof seed.defaultValue !== 'number' || Number.isNaN(seed.defaultValue)) {
          errors.push('defaultValue must be number for dataType=NUMBER')
        } else {
          if (Number.isFinite(seed?.minValue) && seed.defaultValue < seed.minValue) {
            errors.push('defaultValue must be >= minValue')
          }
          if (Number.isFinite(seed?.maxValue) && seed.defaultValue > seed.maxValue) {
            errors.push('defaultValue must be <= maxValue')
          }
        }
      }

      if (stringLike) {
        if (typeof seed.defaultValue !== 'string') {
          errors.push('defaultValue must be string for string-like dataType')
        } else {
          if (hasAllowedValues && !allowedValues.includes(seed.defaultValue)) {
            errors.push('defaultValue must be included in allowedValues')
          }
          if (Number.isFinite(seed?.minLength) && seed.defaultValue.length < seed.minLength) {
            errors.push('defaultValue must be >= minLength')
          }
          if (Number.isFinite(seed?.maxLength) && seed.defaultValue.length > seed.maxLength) {
            errors.push('defaultValue must be <= maxLength')
          }
          if (regexPattern) {
            try {
              const regex = new RegExp(regexPattern)
              if (!regex.test(seed.defaultValue)) {
                errors.push('defaultValue must match regexPattern')
              }
            } catch {
              // ignore: invalid regex already surfaced above
            }
          }
        }
      }
    }
  }

  return errors
}

const buildSeedDocumentPayload = ({
  seed,
  frameworkKeys,
}) => {
  const payload = {
    pathKey: seed.pathKey,
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
    ...(Array.isArray(seed.allowedValues) ? { allowedValues: seed.allowedValues } : {}),
    ...(seed.allowedValueLabels && typeof seed.allowedValueLabels === 'object' && !Array.isArray(seed.allowedValueLabels)
      ? { allowedValueLabels: seed.allowedValueLabels }
      : {}),
    ...(seed.uiControl ? { uiControl: String(seed.uiControl || '').trim().toUpperCase() } : {}),
    ...(seed.placeholderText ? { placeholderText: String(seed.placeholderText || '').trim() } : {}),
    ...(seed.helpText ? { helpText: String(seed.helpText || '').trim() } : {}),
    ...(seed.defaultValue !== undefined ? { defaultValue: seed.defaultValue } : {}),
    ...(Number.isFinite(seed.minValue) ? { minValue: seed.minValue } : {}),
    ...(Number.isFinite(seed.maxValue) ? { maxValue: seed.maxValue } : {}),
    ...(Number.isFinite(seed.minLength) ? { minLength: seed.minLength } : {}),
    ...(Number.isFinite(seed.maxLength) ? { maxLength: seed.maxLength } : {}),
    ...(seed.regexPattern ? { regexPattern: String(seed.regexPattern || '').trim() } : {}),
    ...(seed.isNullable !== undefined ? { isNullable: Boolean(seed.isNullable) } : {}),
  }

  if (seed.allowedValues === undefined) payload.allowedValues = undefined
  if (!seed.allowedValueLabels) payload.allowedValueLabels = undefined
  if (!seed.uiControl) payload.uiControl = undefined
  if (!seed.placeholderText) payload.placeholderText = undefined
  if (!seed.helpText) payload.helpText = undefined
  if (seed.defaultValue === undefined) payload.defaultValue = undefined
  if (!Number.isFinite(seed.minValue)) payload.minValue = undefined
  if (!Number.isFinite(seed.maxValue)) payload.maxValue = undefined
  if (!Number.isFinite(seed.minLength)) payload.minLength = undefined
  if (!Number.isFinite(seed.maxLength)) payload.maxLength = undefined
  if (!seed.regexPattern) payload.regexPattern = undefined
  if (seed.isNullable === undefined) payload.isNullable = undefined

  return payload
}

const collectSchemaValidationErrors = async (doc) => {
  try {
    await doc.validate()
    return []
  } catch (validationError) {
    if (!validationError?.errors) {
      return [String(validationError?.message || 'Schema validation failed.').trim()]
    }

    return [...new Set(
      Object.values(validationError.errors)
        .map((error) => String(error?.message || '').trim())
        .filter(Boolean),
    )]
  }
}

const saveSeedDocument = async ({
  seed,
  actorUserId,
  frameworkKeys,
}) => {
  const payload = buildSeedDocumentPayload({ seed, frameworkKeys })
  const existing = await RuntimePathRegistry.findOne({ pathKey: seed.pathKey })

  if (existing) {
    existing.set(payload)
    existing.updatedBy = actorUserId
    const hasChanges = existing.modifiedPaths().length > 0
    await existing.save()

    return {
      inserted: 0,
      matched: 1,
      modified: hasChanges ? 1 : 0,
      updated: hasChanges ? 1 : 0,
    }
  }

  const nextDoc = new RuntimePathRegistry({
    ...payload,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  })
  await nextDoc.save()

  return {
    inserted: 1,
    matched: 0,
    modified: 0,
    updated: 0,
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
  const seedLoader = STAGED_SEEDS[stageKey]
  if (!seedLoader) {
    throw new Error(`Unknown stage "${stageKey}". Supported: ${Object.keys(STAGED_SEEDS).join(', ')}`)
  }
  const seeds = seedLoader()

  await connect()
  try {
    const resolvedActor = await resolveActorUserId(configuredActorUserId)
    const actorUserId = toObjectId(resolvedActor)
    if (!actorUserId) {
      throw new Error('Actor user id must be a valid ObjectId. Set SYSTEM_ACTOR_USER_ID or pass --actor=<ObjectId>.')
    }
    const frameworkKeys = normalizeFrameworkKeys(configuredFrameworkKeys)
    const invalid = []
    const validSeeds = []
    for (const seed of seeds) {
      const payload = buildSeedDocumentPayload({ seed, frameworkKeys })
      const candidate = new RuntimePathRegistry({
        ...payload,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      const errors = [...new Set([
        ...validateSeed(seed),
        ...(await collectSchemaValidationErrors(candidate)),
      ])]
      if (errors.length > 0) {
        invalid.push({ pathKey: seed?.pathKey || null, errors })
        continue
      }
      validSeeds.push(seed)
    }

    const summary = {
      mode: apply ? 'apply' : 'dry-run',
      stage: stageKey,
      totalSeeds: seeds.length,
      validSeeds: validSeeds.length,
      invalidSeeds: invalid.length,
      inserted: 0,
      updated: 0,
      matched: 0,
      modified: 0,
      collection: RuntimePathRegistry.collection?.name || 'runtimepathregistries',
    }

    if (apply && validSeeds.length > 0) {
      for (const seed of validSeeds) {
        const result = await saveSeedDocument({
          seed,
          actorUserId,
          frameworkKeys,
        })
        summary.inserted += result.inserted
        summary.updated += result.updated
        summary.matched += result.matched
        summary.modified += result.modified
      }
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
    console.log('Usage: node src/scripts/seedRuntimePathRegistryStaged.js [--stage lifecycle|vmf-v2-3-1] [--apply] [--json] [--actor <ObjectId>] [--framework-keys VMF]')
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
