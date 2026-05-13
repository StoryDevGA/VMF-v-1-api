import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import {
  RuntimeAgent,
  RuntimePathRegistry,
  RuntimeSkill,
  SkillRoleRegistry,
  UIContract,
  ValidationRegistry,
  WorkflowPolicy,
} from '../models/index.js'
import FrameworkPackage, {
  FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES,
  FRAMEWORK_PACKAGE_EVALUATION_MODES,
  FRAMEWORK_PACKAGE_EXECUTION_MODES,
  FRAMEWORK_PACKAGE_RETRY_POLICIES,
  FRAMEWORK_PACKAGE_SCOPES,
  FRAMEWORK_PACKAGE_STATE_BINDING_MODES,
  FRAMEWORK_PACKAGE_STATE_MODEL_MODES,
  FRAMEWORK_PACKAGE_STATE_MODELS,
  FRAMEWORK_PACKAGE_STATE_PERSISTENCE_MODES,
  FRAMEWORK_PACKAGE_STATUSES,
  FRAMEWORK_PACKAGE_TYPES,
  FRAMEWORK_PACKAGE_VALIDATION_TRIGGERS,
  FRAMEWORK_PACKAGE_VISIBILITY,
  FRAMEWORK_PACKAGE_WORKFLOW_EXECUTION_CONTEXTS,
} from '../models/FrameworkPackage.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const apiRoot = path.resolve(__dirname, '../..')
const workspaceRoot = path.resolve(apiRoot, '..')

const DEFAULT_SEED_DIR = path.resolve(workspaceRoot, 'docs/seed-data')
const DEFAULT_REPORT_DIR = path.resolve(workspaceRoot, 'docs/generated/seed-imports')
const DEFAULT_AUDIT_FILE = path.resolve(DEFAULT_SEED_DIR, 'canonical_seed_schema_conformance_audit.json')
const DEFAULT_EDITOR_CONSTANTS_FILE = path.resolve(
  workspaceRoot,
  'VMF-v-1-client/src/pages/SuperAdminFrameworkPackages/superAdminFrameworkPackages.constants.js',
)
const RESET_CONFIRMATION = '--confirm-reset-vmf-runtime-control'
const VMF_VERSION = '2.3.1'
const VMF_FRAMEWORK_KEY = 'VMF'
const SEED_ACTOR_ID = new mongoose.Types.ObjectId('000000000000000000000001')
const WORKFLOW_POLICY_DEFAULT_TIMEOUT_MS = 10000
const RUNTIME_PATH_CATEGORY_MAP = Object.freeze({
  APPENDIX: 'ARTIFACT',
  DEAL: 'STATE',
  DISCOVERY: 'OUTPUT',
  ECONOMICS: 'OUTPUT',
  EXECUTION: 'WORKFLOW',
  LOCKING: 'LIFECYCLE',
  POSITIONING: 'OUTPUT',
  PROOF: 'OUTPUT',
  QUERY: 'OUTPUT',
  RENDER: 'OUTPUT',
  RISK: 'POLICY',
  SPD: 'OUTPUT',
  TARGETING: 'OUTPUT',
  VALUE_DRIVER: 'OUTPUT',
  DELIVERY: 'OUTPUT',
  IMPACT: 'OUTPUT',
  INTEGRITY: 'VALIDATION',
})
const RUNTIME_SKILL_CATEGORY_MAP = Object.freeze({
  BOUNDARY: 'GOVERNANCE',
  DEAL: 'VALIDATION',
  DISCOVERY: 'GENERATION',
  DELIVERY: 'GENERATION',
  ECONOMICS: 'GENERATION',
  IMPACT: 'GENERATION',
  INTEGRITY: 'GOVERNANCE',
  POSITIONING: 'GENERATION',
  PROOF: 'GENERATION',
  QUERY: 'ANALYSIS',
  RENDER: 'OUTPUT',
  SECTION: 'GENERATION',
  SPD: 'GENERATION',
  TARGETING: 'GENERATION',
  VALUE_DRIVER: 'GENERATION',
})
const VALIDATION_CATEGORY_MAP = Object.freeze({
  DEAL: 'QUALITY',
  DISCOVERY: 'QUALITY',
  ECONOMICS: 'QUALITY',
  DSIC: 'QUALITY',
  GUARDRAIL: 'GOVERNANCE',
  IMPACT: 'QUALITY',
  INFERENCE: 'QUALITY',
  INTEGRITY: 'GOVERNANCE',
  ORCHESTRATION: 'GOVERNANCE',
  POSITIONING: 'QUALITY',
  PROOF: 'QUALITY',
  QUERY: 'GOVERNANCE',
  RISK: 'GOVERNANCE',
  RENDER: 'QUALITY',
  SEQUENCING: 'CONSISTENCY',
  SPD: 'QUALITY',
  STATE: 'LIFECYCLE',
  TARGETING: 'QUALITY',
  TRACEABILITY: 'QUALITY',
  VALUE_DRIVER: 'QUALITY',
})
const WORKFLOW_POLICY_TYPE_MAP = Object.freeze({
  BUILD_GATE: 'VALIDATION',
  DEAL_GATE: 'VALIDATION',
  DISCOVERY_GATE: 'VALIDATION',
  ECONOMICS_GATE: 'VALIDATION',
  INTEGRITY_GATE: 'VALIDATION',
  POSITIONING_GATE: 'VALIDATION',
  PROOF_GATE: 'VALIDATION',
  QUERY_GATE: 'ROUTING',
  RENDER_GATE: 'VALIDATION',
  RISK_GATE: 'VALIDATION',
  SPD_GATE: 'VALIDATION',
  STATE_GATE: 'LIFECYCLE_GATE',
  VALIDATION_GATE: 'VALIDATION',
})
const IMPORT_STEPS = Object.freeze([
  {
    label: 'Runtime Paths',
    fileName: 'v2_3_1_runtime_paths.json',
    arrayKey: 'runtimePathRegistries',
    model: RuntimePathRegistry,
    identityFields: ['stableId', 'pathKey'],
  },
  {
    label: 'Skill Roles',
    fileName: 'v2_3_1_skill_roles.json',
    arrayKey: 'skillRoles',
    model: SkillRoleRegistry,
    identityFields: ['stableId', 'roleKey'],
  },
  {
    label: 'Skills',
    fileName: 'v2_3_1_skills.json',
    arrayKey: 'runtimeSkills',
    model: RuntimeSkill,
    identityFields: ['stableId', 'key'],
  },
  {
    label: 'Validation Registry',
    fileName: 'v2_3_1_validations.json',
    arrayKey: 'validationRegistries',
    model: ValidationRegistry,
    identityFields: ['stableId', 'key'],
  },
  {
    label: 'Agents',
    fileName: 'v2_3_1_agents.json',
    arrayKey: 'runtimeAgents',
    model: RuntimeAgent,
    identityFields: ['stableId', 'key'],
  },
  {
    label: 'Workflow Policies',
    fileName: 'v2_3_1_policies.json',
    arrayKey: 'workflowPolicies',
    model: WorkflowPolicy,
    identityFields: ['stableId', 'key'],
  },
  {
    label: 'UI Contracts',
    fileName: 'v2_3_1_ui_contract.json',
    singleRecord: true,
    model: UIContract,
    identityFields: ['stableId', 'uiContractKey'],
  },
  {
    label: 'Framework Packages',
    fileName: 'v2_3_1_framework_package.json',
    singleRecord: true,
    model: FrameworkPackage,
    identityFields: ['packageKey'],
  },
])

const RESET_STEPS = [...IMPORT_STEPS].reverse()
const IMPORT_MANAGED_UPDATE_FIELDS = new Set([
  '_id',
  '__v',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'activatedAt',
  'activatedBy',
  'assignedCustomerIds',
  'dependencyLock',
  'isLocked',
  'lastCheckpointAt',
  'lastCheckpointResult',
  'lastCheckpointStatus',
  'lockedAt',
  'lockedBy',
  'lockedByPackageKeys',
  'lockedReason',
  'resolvedAt',
  'status',
  'uiContractBinding',
])

const printHelp = () => {
  console.log(`
VMF framework seed importer

Usage:
  node src/scripts/importFrameworkSeed.js [options]

Options:
  --seed-dir <path>                    Seed JSON directory. Defaults to ../docs/seed-data.
  --apply                              Write changes. Without this flag the script is a dry-run.
  --reset-runtime-control              Clear only Runtime Control seed collections before import.
  ${RESET_CONFIRMATION}    Required with --apply --reset-runtime-control.
  --report-dir <path>                  Import report directory. Defaults to docs/generated/seed-imports.
  --audit-file <path>                  Conformance audit file. Defaults to seed-dir/canonical_seed_schema_conformance_audit.json.
  --no-audit                           Skip conformance audit comparison.
  --no-editor-contract                 Skip Framework Package editor option contract guard.
  --no-report                          Do not write an import report.
  --json                               Print machine-readable summary JSON.
  --help                               Show this help.

Reset scope:
  RuntimePathRegistry, SkillRoleRegistry, RuntimeSkill, ValidationRegistry,
  RuntimeAgent, WorkflowPolicy, UIContract, FrameworkPackage.
  Auth/admin/user/customer/tenant collections are never touched.
`)
}

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = {
    apply: false,
    help: false,
    json: false,
    noAudit: false,
    noEditorContract: false,
    noReport: false,
    resetRuntimeControl: false,
    confirmReset: false,
    seedDir: DEFAULT_SEED_DIR,
    auditFile: DEFAULT_AUDIT_FILE,
    reportDir: DEFAULT_REPORT_DIR,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--json') args.json = true
    else if (arg === '--no-audit') args.noAudit = true
    else if (arg === '--no-editor-contract') args.noEditorContract = true
    else if (arg === '--no-report') args.noReport = true
    else if (arg === '--reset-runtime-control') args.resetRuntimeControl = true
    else if (arg === RESET_CONFIRMATION) args.confirmReset = true
    else if (arg === '--seed-dir') {
      index += 1
      args.seedDir = path.resolve(process.cwd(), argv[index] || '')
      if (args.auditFile === DEFAULT_AUDIT_FILE) {
        args.auditFile = path.resolve(args.seedDir, 'canonical_seed_schema_conformance_audit.json')
      }
    } else if (arg === '--audit-file') {
      index += 1
      args.auditFile = path.resolve(process.cwd(), argv[index] || '')
    } else if (arg === '--report-dir') {
      index += 1
      args.reportDir = path.resolve(process.cwd(), argv[index] || '')
    } else {
      throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`)
    }
  }

  if (args.resetRuntimeControl && (!args.apply || !args.confirmReset)) {
    throw new Error(
      `--reset-runtime-control requires --apply and ${RESET_CONFIRMATION}. `
      + 'This guard prevents accidental destructive cleanup.',
    )
  }

  return args
}

const isPlainObject = (value) =>
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && !(value instanceof Date)
  && Object.getPrototypeOf(value) === Object.prototype

const isBlank = (value) => typeof value === 'string' && value.trim() === ''

const normalizeNullableText = (value) => {
  if (value === undefined || value === null || isBlank(value)) return null
  return value
}

const normalizeToken = (value) => String(value ?? '').trim().toLowerCase()

const normalizeEnumToken = (value) => String(value ?? '').trim().toUpperCase()

const normalizeList = (values, normalizer = normalizeToken) => {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map((value) => normalizer(value)).filter(Boolean))]
}

const clone = (value) => {
  if (Array.isArray(value)) return value.map((item) => clone(item))
  if (value instanceof Date) return new Date(value.getTime())
  if (isPlainObject(value)) {
    return Object.entries(value).reduce((next, [key, entryValue]) => {
      next[key] = clone(entryValue)
      return next
    }, {})
  }
  return value
}

const convertExtendedJson = (value) => {
  if (Array.isArray(value)) return value.map((item) => convertExtendedJson(item))
  if (!isPlainObject(value)) return value

  const keys = Object.keys(value)
  if (keys.length === 1 && typeof value.$oid === 'string') {
    return new mongoose.Types.ObjectId(value.$oid)
  }
  if (keys.length === 1 && typeof value.$date === 'string') {
    return new Date(value.$date)
  }

  return Object.entries(value).reduce((next, [key, entryValue]) => {
    next[key] = convertExtendedJson(entryValue)
    return next
  }, {})
}

const stripImportOnlyFields = (record) => {
  const next = clone(record)
  delete next._id
  delete next.__v
  return next
}

const normalizeVersioningFields = (record) => {
  const nullableFields = [
    'deprecatedInVersion',
    'lockedAt',
    'lockedBy',
    'lockedReason',
    'clonedFromStableId',
    'supersedesStableId',
    'supersededByStableId',
  ]

  for (const field of nullableFields) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      record[field] = normalizeNullableText(record[field])
    }
  }

  if (!Array.isArray(record.lockedByPackageKeys)) record.lockedByPackageKeys = []
  if (!Array.isArray(record.compatibilityTags)) record.compatibilityTags = []
  if (!record.compatibilityTags.includes(VMF_FRAMEWORK_KEY)) record.compatibilityTags.push(VMF_FRAMEWORK_KEY)
  if (!record.compatibilityTags.includes(VMF_VERSION)) record.compatibilityTags.push(VMF_VERSION)

  return record
}

const stampSeedActorFields = (record) => {
  if (!record.createdBy) record.createdBy = SEED_ACTOR_ID
  if (!record.updatedBy) record.updatedBy = record.createdBy || SEED_ACTOR_ID
  return record
}

const recordName = (record) =>
  record.stableId || record.key || record.pathKey || record.roleKey || record.packageKey || record.uiContractKey || 'record'

const normalizeMappedEnum = ({ record, field, map, notes, sourceLabel }) => {
  const currentValue = normalizeEnumToken(record[field])
  const mappedValue = map[currentValue]
  if (!mappedValue) return

  record[field] = mappedValue
  notes.push({
    level: 'warning',
    source: sourceLabel,
    message: `${recordName(record)} ${field} "${currentValue}" normalized to "${mappedValue}".`,
  })
}

const normalizeRuntimeSkillOutputBindings = (record, notes, sourceLabel) => {
  if (!Array.isArray(record.outputBindings)) {
    record.outputBindings = []
    return
  }

  const structuredBindings = record.outputBindings.filter(isPlainObject)
  if (structuredBindings.length === 0) {
    record.outputBindings = normalizeList(record.outputBindings, (value) => String(value ?? '').trim())
    return
  }

  const readPaths = []
  const writePaths = []
  const outputKeys = []

  for (const binding of structuredBindings) {
    const outputKey = String(binding.outputKey ?? '').trim()
    const pathKey = String(binding.pathKey ?? '').trim()
    const operation = normalizeEnumToken(binding.operation)

    if (outputKey) outputKeys.push(outputKey)
    if (pathKey && operation === 'READ') readPaths.push(pathKey)
    if (pathKey && operation === 'WRITE') writePaths.push(pathKey)
  }

  record.allowedReadPaths = [
    ...new Set([...normalizeList(record.allowedReadPaths, (value) => String(value ?? '').trim()), ...readPaths]),
  ]
  record.allowedWritePaths = [
    ...new Set([...normalizeList(record.allowedWritePaths, (value) => String(value ?? '').trim()), ...writePaths]),
  ]
  // primaryOutputKey is the canonical single-output binding; legacy structured bindings only backfill it.
  record.outputBindings = record.primaryOutputKey
    ? []
    : [...new Set(outputKeys)]

  notes.push({
    level: 'warning',
    source: sourceLabel,
    message:
      `${record.key || record.stableId} structured outputBindings normalized to `
      + 'RuntimeSkill string output bindings and path boundary fields.',
  })
}

const normalizeRuntimePath = (record, notes, sourceLabel) => {
  normalizeMappedEnum({
    record,
    field: 'category',
    map: RUNTIME_PATH_CATEGORY_MAP,
    notes,
    sourceLabel,
  })
  return record
}

const normalizeRuntimeSkill = (record, notes, sourceLabel) => {
  normalizeMappedEnum({
    record,
    field: 'category',
    map: RUNTIME_SKILL_CATEGORY_MAP,
    notes,
    sourceLabel,
  })
  record.runtimeConfig = isPlainObject(record.runtimeConfig) ? record.runtimeConfig : {}
  if (!Object.prototype.hasOwnProperty.call(record.runtimeConfig, 'maxRetries')) {
    record.runtimeConfig.maxRetries = 0
    notes.push({
      level: 'warning',
      source: sourceLabel,
      message: `${record.key || record.stableId} missing runtimeConfig.maxRetries; defaulted to 0.`,
    })
  }
  normalizeRuntimeSkillOutputBindings(record, notes, sourceLabel)
  return record
}

const normalizeValidationRegistry = (record, notes, sourceLabel) => {
  normalizeMappedEnum({
    record,
    field: 'category',
    map: VALIDATION_CATEGORY_MAP,
    notes,
    sourceLabel,
  })
  return record
}

const normalizeWorkflowStepRows = (steps) => {
  if (!Array.isArray(steps)) return []
  return steps
    .map((step, index) => {
      if (!isPlainObject(step)) return null
      const order = Number(step.order)
      return {
        ...step,
        stepKey: normalizeToken(step.stepKey),
        stepType: normalizeEnumToken(step.stepType),
        agentId: normalizeToken(step.agentId),
        skillId: normalizeToken(step.skillId),
        validationKey: normalizeToken(step.validationKey),
        order: Number.isInteger(order) && order > 0 ? order : index + 1,
        required: step.required === undefined ? true : Boolean(step.required),
      }
    })
    .filter((step) => step && step.stepKey)
}

const deriveWorkflowPolicyExecutionFields = (record) => {
  const steps = normalizeWorkflowStepRows(record.steps)
  const hasCanonicalSteps = steps.length > 0
  const orderedSteps = hasCanonicalSteps
    ? [...steps]
      .sort((left, right) => Number(left.order) - Number(right.order))
      .map((step) => step.stepKey)
    : normalizeList(record.orderedSteps)
  const requiredAgentIds = [
    normalizeToken(record.primaryAgentId),
    normalizeToken(record.fallbackAgentId),
    ...(hasCanonicalSteps ? steps.map((step) => step.agentId) : normalizeList(record.requiredAgentIds)),
  ].filter(Boolean)
  const requiredSkillIds = hasCanonicalSteps
    ? steps.map((step) => step.skillId).filter(Boolean)
    : normalizeList(record.requiredSkillIds)

  return {
    steps,
    orderedSteps: [...new Set(orderedSteps)],
    requiredAgentIds: [...new Set(requiredAgentIds)],
    requiredSkillIds: [...new Set(requiredSkillIds)],
    gatingRules: [],
  }
}

const normalizeWorkflowPolicy = (record, notes, sourceLabel) => {
  normalizeMappedEnum({
    record,
    field: 'policyType',
    map: WORKFLOW_POLICY_TYPE_MAP,
    notes,
    sourceLabel,
  })

  if (record.timeoutMs === 0) {
    record.timeoutMs = WORKFLOW_POLICY_DEFAULT_TIMEOUT_MS
    notes.push({
      level: 'warning',
      source: sourceLabel,
      message: `${record.key || record.stableId} had timeoutMs: 0; normalized to ${WORKFLOW_POLICY_DEFAULT_TIMEOUT_MS}.`,
    })
  }

  for (const field of ['orderedSteps', 'requiredAgentIds', 'requiredSkillIds', 'gatingRules']) {
    if (Object.prototype.hasOwnProperty.call(record, field) && Array.isArray(record[field]) && record[field].length > 0) {
      notes.push({
        level: 'warning',
        source: sourceLabel,
        message: `${record.key || record.stableId} contains deprecated ${field}; importer derives/stabilizes persisted compatibility fields.`,
      })
    }
  }

  Object.assign(record, deriveWorkflowPolicyExecutionFields(record))
  return record
}

const normalizeFrameworkPackage = (record, notes, sourceLabel) => {
  if (record.lastCheckpointStatus && !record.lastCheckpointResult) {
    notes.push({
      level: 'warning',
      source: sourceLabel,
      message: `${recordName(record)} has imported dependency lock evidence but no checkpoint result; checkpoint state normalized to empty.`,
    })
    record.lastCheckpointStatus = null
    record.lastCheckpointAt = null
  }

  if (Array.isArray(record.defaultOutputStyles)) {
    const structuredStyles = record.defaultOutputStyles.filter(isPlainObject)
    if (structuredStyles.length > 0) {
      for (const style of structuredStyles) {
        if (!String(style.styleKey ?? '').trim()) {
          notes.push({
            level: 'warning',
            source: sourceLabel,
            message: `${recordName(record)} defaultOutputStyles entry missing styleKey was dropped.`,
          })
        }
      }
      record.defaultOutputStyles = [
        ...new Set(structuredStyles.map((style) => String(style.styleKey ?? '').trim()).filter(Boolean)),
      ]
      notes.push({
        level: 'warning',
        source: sourceLabel,
        message: `${recordName(record)} structured defaultOutputStyles normalized to style keys.`,
      })
    }
  }

  return record
}

const normalizeRecord = (step, rawRecord, notes) => {
  const sourceLabel = step.label
  const record = stampSeedActorFields(
    normalizeVersioningFields(stripImportOnlyFields(convertExtendedJson(rawRecord))),
  )

  if (step.model === RuntimePathRegistry) return normalizeRuntimePath(record, notes, sourceLabel)
  if (step.model === RuntimeSkill) return normalizeRuntimeSkill(record, notes, sourceLabel)
  if (step.model === ValidationRegistry) return normalizeValidationRegistry(record, notes, sourceLabel)
  if (step.model === WorkflowPolicy) return normalizeWorkflowPolicy(record, notes, sourceLabel)
  if (step.model === FrameworkPackage) return normalizeFrameworkPackage(record, notes, sourceLabel)
  return record
}

const getRecordsFromSeed = (step, parsedSeed) => {
  if (step.singleRecord) {
    const record = parsedSeed[step.arrayKey] || parsedSeed.record || parsedSeed[step.label] || parsedSeed
    if (!isPlainObject(record)) {
      throw new Error(`${step.fileName} must contain one seed object.`)
    }
    return [record]
  }

  const records = parsedSeed[step.arrayKey]
  if (!Array.isArray(records)) {
    throw new Error(`${step.fileName} must contain an array named ${step.arrayKey}.`)
  }
  return records
}

const loadSeedBundle = (seedDir) => {
  const notes = []
  return IMPORT_STEPS.map((step) => {
    const filePath = path.resolve(seedDir, step.fileName)
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing seed file: ${filePath}`)
    }

    const parsedSeed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const rawRecords = getRecordsFromSeed(step, parsedSeed)
    if (
      Number.isInteger(parsedSeed.recordCount)
      && parsedSeed.recordCount !== rawRecords.length
    ) {
      notes.push({
        level: 'warning',
        source: step.label,
        message: `${step.fileName} recordCount=${parsedSeed.recordCount} but loaded ${rawRecords.length}.`,
      })
    }

    return {
      ...step,
      filePath,
      records: rawRecords.map((record) => normalizeRecord(step, record, notes)),
    }
  }).concat({ notes })
}

const buildIndexes = (bundle) => {
  const runtimePaths = new Map()
  const runtimePathsByStableId = new Map()
  const skillRoles = new Map()
  const skills = new Map()
  const skillsByKey = new Map()
  const validations = new Map()
  const validationsByKey = new Map()
  const agents = new Map()
  const uiContractsByKey = new Map()
  const policiesByKey = new Map()
  const packagesByKey = new Map()

  for (const step of bundle.filter((entry) => entry.records)) {
    for (const record of step.records) {
      if (step.model === RuntimePathRegistry) {
        runtimePaths.set(record.pathKey, record)
        runtimePathsByStableId.set(record.stableId, record)
      } else if (step.model === SkillRoleRegistry) {
        skillRoles.set(normalizeEnumToken(record.roleKey), record)
      } else if (step.model === RuntimeSkill) {
        skills.set(normalizeToken(record.stableId), record)
        skillsByKey.set(normalizeToken(record.key), record)
      } else if (step.model === ValidationRegistry) {
        validations.set(normalizeToken(record.stableId), record)
        validationsByKey.set(normalizeToken(record.key), record)
      } else if (step.model === RuntimeAgent) {
        agents.set(normalizeToken(record.stableId), record)
      } else if (step.model === WorkflowPolicy) {
        policiesByKey.set(normalizeToken(record.key), record)
      } else if (step.model === UIContract) {
        uiContractsByKey.set(normalizeToken(record.uiContractKey), record)
      } else if (step.model === FrameworkPackage) {
        packagesByKey.set(normalizeToken(record.packageKey), record)
      }
    }
  }

  return {
    runtimePaths,
    runtimePathsByStableId,
    skillRoles,
    skills,
    skillsByKey,
    validations,
    validationsByKey,
    agents,
    uiContractsByKey,
    policiesByKey,
    packagesByKey,
  }
}

const recordsForModel = (bundle, model) =>
  bundle.find((entry) => entry.model === model)?.records || []

const countVmfStateNamespaceReferences = (value) => {
  if (typeof value === 'string') return value.includes('vmf_state') ? 1 : 0
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countVmfStateNamespaceReferences(item), 0)
  }
  if (isPlainObject(value)) {
    return Object.values(value).reduce((total, item) => total + countVmfStateNamespaceReferences(item), 0)
  }
  return 0
}

const buildConformanceActuals = (bundle) => {
  const runtimePaths = recordsForModel(bundle, RuntimePathRegistry)
  const skillRoles = recordsForModel(bundle, SkillRoleRegistry)
  const skills = recordsForModel(bundle, RuntimeSkill)
  const validations = recordsForModel(bundle, ValidationRegistry)
  const agents = recordsForModel(bundle, RuntimeAgent)
  const policies = recordsForModel(bundle, WorkflowPolicy)
  const uiContracts = recordsForModel(bundle, UIContract)
  const frameworkPackages = recordsForModel(bundle, FrameworkPackage)

  return {
    runtimePathCount: runtimePaths.length,
    skillRoleCount: skillRoles.length,
    skillCount: skills.length,
    validationCount: validations.length,
    agentCount: agents.length,
    policyCount: policies.length,
    packageDependencyReferenceCount: frameworkPackages.reduce(
      (count, frameworkPackage) => count + (frameworkPackage.dependencyLock?.references?.length || 0),
      0,
    ),
    uiSectionCount: uiContracts.reduce((count, contract) => count + (contract.sections?.length || 0), 0),
    vmfStateNamespaceReferences: bundle
      .filter((entry) => entry.records)
      .reduce((count, entry) => count + countVmfStateNamespaceReferences(entry.records), 0),
    objectTextareaViolations: runtimePaths.filter(
      (runtimePath) => runtimePath.dataType === 'OBJECT' && runtimePath.uiControl === 'TEXTAREA',
    ).length,
  }
}

const validateConformanceAudit = (bundle, options, notes) => {
  if (options.noAudit) {
    return { skipped: true, reason: '--no-audit supplied' }
  }

  if (!fs.existsSync(options.auditFile)) {
    notes.push({
      level: 'error',
      source: 'Conformance Audit',
      message: `Missing audit file: ${options.auditFile}`,
    })
    return { skipped: false, auditFile: options.auditFile, missing: true }
  }

  const audit = JSON.parse(fs.readFileSync(options.auditFile, 'utf8'))
  const expected = audit.v2_3_1
  if (!isPlainObject(expected)) {
    notes.push({
      level: 'error',
      source: 'Conformance Audit',
      message: 'Audit file must contain a v2_3_1 object.',
    })
    return { skipped: false, auditFile: options.auditFile, invalid: true }
  }

  const actual = buildConformanceActuals(bundle)
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (!Number.isInteger(expectedValue)) continue
    const actualValue = actual[field]
    if (actualValue !== expectedValue) {
      notes.push({
        level: 'error',
        source: 'Conformance Audit',
        message: `${field} expected ${expectedValue} but loaded ${actualValue}.`,
      })
    }
  }

  return {
    skipped: false,
    auditFile: options.auditFile,
    documentType: audit.documentType,
    schemaSet: audit.schemaSet,
    expected,
    actual,
  }
}

const hasOperation = (record, operation) =>
  Array.isArray(record?.allowedOperations) && record.allowedOperations.includes(operation)

const pathMatchesScope = (pathKey, scope) => {
  if (!pathKey || !scope) return false
  if (scope.endsWith('.*')) return pathKey.startsWith(scope.slice(0, -1))
  return pathKey === scope
}

const hasMatchingScope = (pathKey, scopes = []) =>
  scopes.some((scope) => pathMatchesScope(pathKey, scope))

const findRuntimePath = (indexes, pathKey) => indexes.runtimePaths.get(pathKey)

const isApprovedWildcardPath = (pathKey) => typeof pathKey === 'string' && pathKey.endsWith('.*')

const validatePathReference = ({ notes, level = 'error', source, pathKey, indexes, operation }) => {
  if (!pathKey) return
  if (isApprovedWildcardPath(pathKey)) return
  const runtimePath = findRuntimePath(indexes, pathKey)
  if (!runtimePath) {
    notes.push({
      level,
      source,
      message: `Runtime path "${pathKey}" is not present in the seed registry.`,
    })
    return
  }
  if (operation && !hasOperation(runtimePath, operation)) {
    notes.push({
      level,
      source,
      message: `Runtime path "${pathKey}" does not allow ${operation}.`,
    })
  }
}

const validateSectionRuntimePathReference = ({ notes, source, pathKey, indexes, frameworkKey }) => {
  validatePathReference({
    notes,
    level: 'error',
    source,
    pathKey,
    indexes,
    operation: 'BIND',
  })

  if (!pathKey || isApprovedWildcardPath(pathKey)) return
  const runtimePath = findRuntimePath(indexes, pathKey)
  if (!runtimePath) return

  const frameworkKeys = Array.isArray(runtimePath.frameworkKeys) ? runtimePath.frameworkKeys : []
  const validSectionPath = runtimePath.status === 'ACTIVE'
    && runtimePath.scope === 'FRAMEWORK_STATE'
    && runtimePath.category === 'SECTION'
    && pathKey.startsWith('framework_state.sections.')
    && (!frameworkKey || frameworkKeys.includes(frameworkKey))

  if (!validSectionPath) {
    notes.push({
      level: 'error',
      source,
      message:
        `Package section runtime path "${pathKey}" must be an ACTIVE FRAMEWORK_STATE/SECTION path `
        + 'under framework_state.sections.* and compatible with the package framework.',
    })
  }
}

const validateIdentity = (step, notes) => {
  const seen = new Map()
  for (const [index, record] of step.records.entries()) {
    const primaryField = step.identityFields.find((field) => record[field])
    if (!primaryField) {
      notes.push({
        level: 'error',
        source: step.label,
        message: `Record ${index + 1} is missing identity fields: ${step.identityFields.join(', ')}.`,
      })
      continue
    }
    const identity = `${primaryField}:${String(record[primaryField]).trim().toLowerCase()}`
    if (seen.has(identity)) {
      notes.push({
        level: 'error',
        source: step.label,
        message: `Duplicate seed identity ${identity}.`,
      })
    }
    seen.set(identity, record)
  }
}

const validateSkillRoles = (records, indexes, notes) => {
  for (const role of records) {
    const source = `Skill Role ${role.roleKey}`
    for (const scope of role.allowedReadScopes || []) {
      validatePathReference({ notes, level: 'warning', source, pathKey: scope, indexes, operation: 'READ' })
    }
    for (const scope of role.allowedWriteScopes || []) {
      validatePathReference({ notes, level: 'warning', source, pathKey: scope, indexes, operation: 'WRITE' })
    }
  }
}

const validateSkills = (records, indexes, notes) => {
  for (const skill of records) {
    const source = `Skill ${skill.key}`
    const role = indexes.skillRoles.get(normalizeEnumToken(skill.skillRoleKey))
    if (!role) {
      notes.push({ level: 'error', source, message: `Unknown skillRoleKey "${skill.skillRoleKey}".` })
    }

    for (const pathKey of skill.allowedReadPaths || []) {
      validatePathReference({ notes, level: 'warning', source, pathKey, indexes, operation: 'READ' })
    }
    for (const pathKey of skill.allowedWritePaths || []) {
      validatePathReference({ notes, level: 'error', source, pathKey, indexes, operation: 'WRITE' })
      if (role && !hasMatchingScope(pathKey, role.allowedWriteScopes || [])) {
        notes.push({
          level: 'error',
          source,
          message: `Write path "${pathKey}" is outside role ${role.roleKey} allowedWriteScopes.`,
        })
      }
    }
  }
}

const validateValidations = (records, indexes, notes) => {
  for (const validation of records) {
    const source = `Validation ${validation.key}`
    if (!indexes.skills.has(normalizeToken(validation.producerSkillId))) {
      notes.push({ level: 'error', source, message: `Unknown producerSkillId "${validation.producerSkillId}".` })
    }
    for (const agentId of validation.defaultAgentIds || []) {
      if (!indexes.agents.has(normalizeToken(agentId))) {
        notes.push({ level: 'error', source, message: `Unknown defaultAgentId "${agentId}".` })
      }
    }
    validatePathReference({ notes, level: 'error', source, pathKey: validation.outputPath, indexes, operation: 'WRITE' })
  }
}

const validateAgents = (records, indexes, notes) => {
  for (const agent of records) {
    const source = `Agent ${agent.key}`
    for (const roleKey of agent.requiredSkillRoleKeys || []) {
      if (!indexes.skillRoles.has(normalizeEnumToken(roleKey))) {
        notes.push({ level: 'error', source, message: `Unknown requiredSkillRoleKey "${roleKey}".` })
      }
    }
    for (const skillId of [...(agent.defaultSkillIds || []), ...(agent.primarySkillIds || []), ...(agent.optionalSkillIds || [])]) {
      if (!indexes.skills.has(normalizeToken(skillId))) {
        notes.push({ level: 'error', source, message: `Unknown skill id "${skillId}".` })
      }
    }
    for (const step of agent.executionPlan || []) {
      if (step.required && (step.readsFrom || []).length === 0 && (step.writesTo || []).length === 0) {
        notes.push({
          level: 'warning',
          source,
          message: `Required execution step "${step.stepKey}" has no readsFrom/writesTo runtime paths.`,
        })
      }
      for (const pathKey of step.readsFrom || []) {
        validatePathReference({ notes, level: 'warning', source, pathKey, indexes, operation: 'READ' })
      }
      for (const pathKey of step.writesTo || []) {
        validatePathReference({ notes, level: 'warning', source, pathKey, indexes, operation: 'WRITE' })
      }
    }
  }
}

const validateWorkflowPolicies = (records, indexes, notes) => {
  for (const policy of records) {
    const source = `Workflow Policy ${policy.key}`
    for (const agentId of policy.requiredAgentIds || []) {
      if (!indexes.agents.has(normalizeToken(agentId))) {
        notes.push({ level: 'error', source, message: `Unknown requiredAgentId "${agentId}".` })
      }
    }
    for (const skillId of policy.requiredSkillIds || []) {
      if (!indexes.skills.has(normalizeToken(skillId))) {
        notes.push({ level: 'error', source, message: `Unknown requiredSkillId "${skillId}".` })
      }
    }
    for (const validationKey of policy.requiredValidationKeys || []) {
      if (!indexes.validationsByKey.has(normalizeToken(validationKey))) {
        notes.push({ level: 'error', source, message: `Unknown requiredValidationKey "${validationKey}".` })
      }
    }
    for (const condition of policy.conditions || []) {
      validatePathReference({ notes, level: 'error', source, pathKey: condition.path, indexes, operation: 'READ' })
    }
    for (const effect of [...(policy.onPassEffects || []), ...(policy.onFailEffects || [])]) {
      validatePathReference({ notes, level: 'error', source, pathKey: effect.targetPath, indexes, operation: 'WRITE' })
    }
  }
}

const validateUiContracts = (records, indexes, notes) => {
  for (const contract of records) {
    const source = `UI Contract ${contract.uiContractKey}`
    const frameworkKey = Array.isArray(contract.frameworkKeys) ? contract.frameworkKeys[0] : undefined
    for (const section of contract.sections || []) {
      validateSectionRuntimePathReference({
        notes,
        source,
        pathKey: section.runtimePath,
        indexes,
        frameworkKey,
      })
    }
  }
}

const validateFrameworkPackages = (records, indexes, notes) => {
  for (const frameworkPackage of records) {
    const source = `Framework Package ${frameworkPackage.packageKey}`
    if (!indexes.uiContractsByKey.has(normalizeToken(frameworkPackage.uiContractKey))) {
      notes.push({ level: 'error', source, message: `Unknown uiContractKey "${frameworkPackage.uiContractKey}".` })
    }
    for (const section of frameworkPackage.sections || []) {
      validateSectionRuntimePathReference({
        notes,
        source,
        pathKey: section.runtimePath,
        indexes,
        frameworkKey: frameworkPackage.frameworkKey,
      })
    }
    for (const binding of frameworkPackage.validationBindings || []) {
      if (!indexes.validationsByKey.has(normalizeToken(binding.validationKey))) {
        notes.push({ level: 'error', source, message: `Unknown validationKey "${binding.validationKey}".` })
      }
    }
    for (const binding of frameworkPackage.workflowBindings || []) {
      const policy = indexes.policiesByKey.get(normalizeToken(binding.policyKey))
      if (!policy) {
        notes.push({ level: 'error', source, message: `Unknown workflow policyKey "${binding.policyKey}".` })
      } else if (
        binding.governedAction
        && policy.governedAction
        && normalizeEnumToken(binding.governedAction) !== normalizeEnumToken(policy.governedAction)
      ) {
        notes.push({
          level: 'error',
          source,
          message: `Workflow binding "${binding.policyKey}" governedAction does not match policy governedAction.`,
        })
      }
    }
  }
}

const validateCrossReferences = (bundle, notes) => {
  const indexes = buildIndexes(bundle)

  for (const step of bundle.filter((entry) => entry.records)) {
    validateIdentity(step, notes)
    if (step.model === SkillRoleRegistry) validateSkillRoles(step.records, indexes, notes)
    else if (step.model === RuntimeSkill) validateSkills(step.records, indexes, notes)
    else if (step.model === ValidationRegistry) validateValidations(step.records, indexes, notes)
    else if (step.model === RuntimeAgent) validateAgents(step.records, indexes, notes)
    else if (step.model === WorkflowPolicy) validateWorkflowPolicies(step.records, indexes, notes)
    else if (step.model === UIContract) validateUiContracts(step.records, indexes, notes)
    else if (step.model === FrameworkPackage) validateFrameworkPackages(step.records, indexes, notes)
  }
}

const loadFrameworkPackageEditorOptions = async (notes) => {
  if (!fs.existsSync(DEFAULT_EDITOR_CONSTANTS_FILE)) {
    const reason = `Missing editor constants file: ${DEFAULT_EDITOR_CONSTANTS_FILE}`
    if (!['development', 'test'].includes(String(process.env.NODE_ENV || '').trim())) {
      notes.push({
        level: 'warning',
        source: 'Framework Package Editor Contract',
        message: `${reason}. Editor option guard skipped for API-only deployment context.`,
      })
      return { __skipped: true, reason }
    }

    notes.push({
      level: 'error',
      source: 'Framework Package Editor Contract',
      message: reason,
    })
    return null
  }

  try {
    return await import(pathToFileURL(DEFAULT_EDITOR_CONSTANTS_FILE).href)
  } catch (error) {
    notes.push({
      level: 'error',
      source: 'Framework Package Editor Contract',
      message: `Could not load editor option constants: ${error.message}`,
    })
    return null
  }
}

const optionValues = (options) =>
  new Set(
    (Array.isArray(options) ? options : [])
      .map((option) => String(option?.value ?? '').trim())
      .filter(Boolean),
  )

const uniqueValues = (values) =>
  [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].sort()

const checkEditorOptionValues = ({ notes, source, field, values, clientValues, backendValues }) => {
  const seededValues = uniqueValues(values)
  const missingFromClient = seededValues.filter((value) => !clientValues.has(value))
  const missingFromBackend = backendValues
    ? seededValues.filter((value) => !backendValues.has(value))
    : []

  for (const value of missingFromClient) {
    notes.push({
      level: 'error',
      source,
      message:
        `${field} uses "${value}", but the Framework Package editor option set does not expose it. `
        + 'Add the value to the client option constants before importing this seed.',
    })
  }

  for (const value of missingFromBackend) {
    notes.push({
      level: 'error',
      source,
      message:
        `${field} uses "${value}", but the backend FrameworkPackage enum does not allow it. `
        + 'Add the value to the backend enum/model contract before importing this seed.',
    })
  }

  return {
    field,
    seededValues,
    missingFromClient,
    missingFromBackend,
  }
}

const validateFrameworkPackageEditorContract = async (bundle, options, notes) => {
  if (options.noEditorContract) {
    return { skipped: true, reason: '--no-editor-contract supplied' }
  }

  const clientConstants = await loadFrameworkPackageEditorOptions(notes)
  if (clientConstants?.__skipped) {
    return { skipped: true, reason: clientConstants.reason }
  }
  if (!clientConstants) {
    return { skipped: false, status: 'fail', checks: [] }
  }

  const frameworkPackages = recordsForModel(bundle, FrameworkPackage)
  const contract = [
    {
      field: 'status',
      values: frameworkPackages.map((record) => record.status),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_STATUS_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_STATUSES)),
    },
    {
      field: 'packageScope',
      values: frameworkPackages.map((record) => record.packageScope),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_SCOPE_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_SCOPES)),
    },
    {
      field: 'packageType',
      values: frameworkPackages.map((record) => record.packageType),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_TYPE_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_TYPES)),
    },
    {
      field: 'visibility',
      values: frameworkPackages.map((record) => record.visibility),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_VISIBILITY_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_VISIBILITY)),
    },
    {
      field: 'customerAccessMode',
      values: frameworkPackages.map((record) => record.customerAccessMode),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_MODES)),
    },
    {
      field: 'runtimeSettings.retryPolicy',
      values: frameworkPackages.map((record) => record.runtimeSettings?.retryPolicy),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_RETRY_POLICY_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_RETRY_POLICIES)),
    },
    {
      field: 'executionModel.mode',
      values: frameworkPackages.map((record) => record.executionModel?.mode),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_EXECUTION_MODE_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_EXECUTION_MODES)),
    },
    {
      field: 'executionModel.stateModel',
      values: frameworkPackages.map((record) => record.executionModel?.stateModel),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_STATE_MODEL_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_STATE_MODELS)),
    },
    {
      field: 'executionModel.evaluationMode',
      values: frameworkPackages.map((record) => record.executionModel?.evaluationMode),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_EVALUATION_MODE_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_EVALUATION_MODES)),
    },
    {
      field: 'validationBindings.trigger',
      values: frameworkPackages.flatMap((record) =>
        (record.validationBindings || []).map((binding) => binding.trigger)),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_VALIDATION_TRIGGER_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_VALIDATION_TRIGGERS)),
    },
    {
      field: 'workflowBindings.executionContext',
      values: frameworkPackages.flatMap((record) =>
        (record.workflowBindings || []).map((binding) => binding.executionContext)),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_WORKFLOW_EXECUTION_CONTEXT_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_WORKFLOW_EXECUTION_CONTEXTS)),
    },
    {
      field: 'stateModelMode',
      values: frameworkPackages.map((record) => record.stateModelMode),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_STATE_MODEL_REFERENCE_MODE_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_STATE_MODEL_MODES)),
    },
    {
      field: 'stateBindingMode',
      values: frameworkPackages.map((record) => record.stateBindingMode),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_STATE_BINDING_MODE_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_STATE_BINDING_MODES)),
    },
    {
      field: 'statePersistence',
      values: frameworkPackages.map((record) => record.statePersistence),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_STATE_PERSISTENCE_OPTIONS),
      backendValues: new Set(Object.values(FRAMEWORK_PACKAGE_STATE_PERSISTENCE_MODES)),
    },
    {
      field: 'availableOutputKeys',
      values: frameworkPackages.flatMap((record) => record.availableOutputKeys || []),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_OUTPUT_KEY_OPTIONS),
    },
    {
      field: 'defaultOutputStyles',
      values: frameworkPackages.flatMap((record) => record.defaultOutputStyles || []),
      clientValues: optionValues(clientConstants.FRAMEWORK_PACKAGE_OUTPUT_STYLE_OPTIONS),
    },
  ]

  const checks = contract.map((entry) =>
    checkEditorOptionValues({
      notes,
      source: 'Framework Package Editor Contract',
      ...entry,
    }))
  const failures = checks.reduce(
    (count, check) => count + check.missingFromClient.length + check.missingFromBackend.length,
    0,
  )

  return {
    skipped: false,
    status: failures > 0 ? 'fail' : 'pass',
    constantsFile: DEFAULT_EDITOR_CONSTANTS_FILE,
    failures,
    checks,
  }
}

const validateWithMongoose = async (bundle, notes) => {
  for (const step of bundle.filter((entry) => entry.records)) {
    for (const record of step.records) {
      const doc = new step.model(record)
      try {
        await doc.validate()
      } catch (error) {
        notes.push({
          level: 'error',
          source: step.label,
          message: `${recordName(record)}: ${error.message}`,
        })
      }
    }
  }
}

const buildLookupQuery = (step, record) => {
  const filters = step.identityFields
    .filter((field) => record[field])
    .map((field) => ({ [field]: record[field] }))

  if (filters.length === 0) {
    throw new Error(`${step.label} record is missing identity fields: ${step.identityFields.join(', ')}`)
  }
  return filters.length === 1 ? filters[0] : { $or: filters }
}

const buildImportUpdatePayload = (record) =>
  Object.entries(record).reduce((payload, [field, value]) => {
    if (!IMPORT_MANAGED_UPDATE_FIELDS.has(field)) {
      payload[field] = value
    }
    return payload
  }, {})

const resolveFindOne = (model, query, session) => {
  const findQuery = model.findOne(query)
  if (session && typeof findQuery?.session === 'function') {
    return findQuery.session(session).exec()
  }
  return findQuery.exec()
}

const importRecord = async (step, record, { session = null } = {}) => {
  const query = buildLookupQuery(step, record)
  const existing = await resolveFindOne(step.model, query, session)

  if (!existing) {
    const created = new step.model(record)
    await created.save(session ? { session } : undefined)
    return 'created'
  }

  const updatePayload = buildImportUpdatePayload(record)
  existing.set(updatePayload)
  if (step.model === UIContract && Object.prototype.hasOwnProperty.call(updatePayload, 'resolvedAt')) {
    existing.$locals.allowResolvedAtWrite = true
  }
  if (!existing.isModified()) return 'unchanged'
  await existing.save(session ? { session } : undefined)
  return 'updated'
}

const resetRuntimeControlCollections = async ({ session = null } = {}) => {
  const resetResults = []
  for (const step of RESET_STEPS) {
    const result = await step.model.deleteMany({}, session ? { session } : undefined)
    resetResults.push({
      collection: step.model.collection.name,
      deleted: result.deletedCount || 0,
    })
  }
  return resetResults
}

const applyImport = async (bundle, options) => {
  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    seedDir: options.seedDir,
    reset: [],
    collections: [],
  }

  if (!options.apply) {
    summary.collections = bundle.filter((entry) => entry.records).map((step) => ({
      label: step.label,
      fileName: step.fileName,
      loaded: step.records.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: step.records.length,
      failed: 0,
    }))
    return summary
  }

  if (options.manageConnection !== false) {
    await connectDb()
  }
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      if (options.resetRuntimeControl) {
        summary.reset = await resetRuntimeControlCollections({ session })
      }

      for (const step of bundle.filter((entry) => entry.records)) {
        const result = {
          label: step.label,
          fileName: step.fileName,
          loaded: step.records.length,
          created: 0,
          updated: 0,
          unchanged: 0,
          skipped: 0,
          failed: 0,
        }

        for (const record of step.records) {
          try {
            const status = await importRecord(step, record, { session })
            result[status] += 1
          } catch (error) {
            result.failed += 1
            throw new Error(`${step.label} import failed for ${recordName(record)}: ${error.message}`)
          }
        }

        summary.collections.push(result)
      }
    })
  } finally {
    await session.endSession()
    if (options.manageConnection !== false) {
      await disconnectDb()
    }
  }

  return summary
}

const writeReport = (options, payload) => {
  if (options.noReport) return { reportPath: null, reportError: null }
  try {
    fs.mkdirSync(options.reportDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const reportPath = path.join(options.reportDir, `vmf-2-3-1-seed-import-${stamp}.json`)
    fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    return { reportPath, reportError: null }
  } catch (error) {
    return { reportPath: null, reportError: error.message }
  }
}

const printSummary = (payload, reportPath, reportError, json) => {
  if (json) {
    console.log(JSON.stringify({ ...payload, reportPath, reportError }, null, 2))
    return
  }

  console.log(`VMF ${VMF_VERSION} seed import ${payload.summary.mode.toUpperCase()}`)
  console.log(`Seed dir: ${payload.summary.seedDir}`)
  if (payload.audit?.skipped) {
    console.log(`Audit: skipped (${payload.audit.reason})`)
  } else if (payload.audit?.auditFile) {
    console.log(`Audit: ${payload.audit.auditFile}`)
  }
  if (payload.editorOptionContract?.skipped) {
    console.log(`Editor option contract: skipped (${payload.editorOptionContract.reason})`)
  } else if (payload.editorOptionContract) {
    console.log(
      `Editor option contract: ${String(payload.editorOptionContract.status || 'unknown').toUpperCase()}`
      + ` (${payload.editorOptionContract.failures || 0} issue(s))`,
    )
  }
  for (const row of payload.summary.collections) {
    console.log(
      `- ${row.label}: loaded=${row.loaded}, created=${row.created}, `
      + `updated=${row.updated}, unchanged=${row.unchanged}, skipped=${row.skipped}, failed=${row.failed}`,
    )
  }
  if (payload.summary.reset.length > 0) {
    console.log('Reset collections:')
    for (const row of payload.summary.reset) {
      console.log(`- ${row.collection}: deleted=${row.deleted}`)
    }
  }

  const errors = payload.notes.filter((note) => note.level === 'error')
  const warnings = payload.notes.filter((note) => note.level === 'warning')
  console.log(`Preflight: ${errors.length} error(s), ${warnings.length} warning(s)`)
  for (const note of payload.notes.slice(0, 25)) {
    console.log(`[${note.level.toUpperCase()}] ${note.source}: ${note.message}`)
  }
  if (payload.notes.length > 25) {
    console.log(`... ${payload.notes.length - 25} additional note(s) written to the report.`)
  }
  if (reportPath) console.log(`Report: ${reportPath}`)
  if (reportError) console.log(`Report not written: ${reportError}`)
}

const importFrameworkSeed = async (optionOverrides = {}) => {
  const options = {
    ...parseArgs([]),
    ...optionOverrides,
  }
  const bundle = loadSeedBundle(options.seedDir)
  const notes = bundle.find((entry) => entry.notes)?.notes || []
  validateCrossReferences(bundle, notes)
  const editorOptionContract = await validateFrameworkPackageEditorContract(bundle, options, notes)
  const audit = validateConformanceAudit(bundle, options, notes)
  await validateWithMongoose(bundle, notes)

  const hasErrors = notes.some((note) => note.level === 'error')
  const summary = hasErrors
    ? {
      mode: options.apply ? 'apply-blocked' : 'dry-run-blocked',
      seedDir: options.seedDir,
      reset: [],
      collections: bundle.filter((entry) => entry.records).map((step) => ({
        label: step.label,
        fileName: step.fileName,
        loaded: step.records.length,
        created: 0,
        updated: 0,
        unchanged: 0,
        skipped: step.records.length,
        failed: 0,
      })),
    }
    : await applyImport(bundle, options)

  const payload = {
    generatedAt: new Date().toISOString(),
    version: VMF_VERSION,
    audit,
    editorOptionContract,
    summary,
    notes,
  }
  const { reportPath, reportError } = writeReport(options, payload)
  return {
    payload,
    reportPath,
    reportError,
    hasErrors,
  }
}

const main = async () => {
  const options = parseArgs()
  if (options.help) {
    printHelp()
    return
  }

  const { payload, reportPath, reportError, hasErrors } = await importFrameworkSeed(options)
  printSummary(payload, reportPath, reportError, options.json)

  if (hasErrors) {
    process.exitCode = 1
  }
}

export {
  applyImport,
  buildImportUpdatePayload,
  importFrameworkSeed,
  importRecord,
  parseArgs,
  validateWithMongoose,
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(async (error) => {
    try {
      if (mongoose.connection.readyState !== 0) await disconnectDb()
    } catch {
      // Preserve the original failure.
    }
    console.error(error.message)
    process.exitCode = 1
  })
}
