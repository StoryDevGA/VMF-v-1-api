import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import FrameworkPackage, { FRAMEWORK_PACKAGE_STATUSES } from '../models/FrameworkPackage.js'
import UIContract, { UI_CONTRACT_STATUSES } from '../models/UIContract.js'
import WorkflowPolicy, {
  WORKFLOW_POLICY_APPLIES_TO,
  WORKFLOW_POLICY_DECISION_MODES,
  WORKFLOW_POLICY_EXECUTION_TYPES,
  WORKFLOW_POLICY_STATUSES,
  WORKFLOW_POLICY_TRIGGER_MODES,
  WORKFLOW_POLICY_TYPES,
} from '../models/WorkflowPolicy.js'

const DEFAULT_PACKAGE_KEY = 'standard-package-vmf-3-1-1-rkm'
const CONFIRM_REPAIR = '--confirm-repair-section-generation-actions'
const DEFAULT_SYSTEM_ACTOR_ID = '698b3800f83b3257365fd7a3'

const DEFAULT_MODELS = Object.freeze({
  FrameworkPackage,
  UIContract,
  WorkflowPolicy,
})

const SECTION_ACTIONS = Object.freeze([
  Object.freeze({
    actionKey: 'GENERATE_SECTION',
    governedAction: 'GENERATE_SECTION',
    buttonLabel: 'Generate Section',
    confirmationTitle: '',
    confirmationMessage: '',
    successMessage: 'Section generated.',
    failureMessage: 'Section could not be generated.',
    loadingMessage: 'Generating section...',
    displayOrder: 21,
    isVisible: true,
    requiresConfirmation: false,
    presentationKey: 'section-action',
  }),
  Object.freeze({
    actionKey: 'REGENERATE_SECTION',
    governedAction: 'REGENERATE_SECTION',
    buttonLabel: 'Regenerate Section',
    confirmationTitle: '',
    confirmationMessage: '',
    successMessage: 'Section regenerated.',
    failureMessage: 'Section could not be regenerated.',
    loadingMessage: 'Regenerating section...',
    displayOrder: 22,
    isVisible: true,
    requiresConfirmation: false,
    presentationKey: 'section-action',
  }),
])

const LIFECYCLE_ACTIONS = Object.freeze([
  Object.freeze({
    actionKey: 'MARK_READY',
    governedAction: 'MARK_READY',
    buttonLabel: 'Mark Ready',
    confirmationTitle: '',
    confirmationMessage: '',
    successMessage: 'Runtime marked ready.',
    failureMessage: 'Runtime could not be marked ready.',
    loadingMessage: 'Marking runtime ready...',
    displayOrder: 25,
    isVisible: true,
    requiresConfirmation: false,
    presentationKey: 'primary-action',
  }),
  Object.freeze({
    actionKey: 'APPROVE',
    governedAction: 'APPROVE',
    buttonLabel: 'Approve',
    confirmationTitle: '',
    confirmationMessage: '',
    successMessage: 'Runtime approved.',
    failureMessage: 'Runtime could not be approved.',
    loadingMessage: 'Approving runtime...',
    displayOrder: 35,
    isVisible: true,
    requiresConfirmation: true,
    presentationKey: 'primary-action',
  }),
  Object.freeze({
    actionKey: 'LOCK_RECORD',
    governedAction: 'LOCK_RECORD',
    buttonLabel: 'Lock Record',
    confirmationTitle: '',
    confirmationMessage: '',
    successMessage: 'Runtime locked.',
    failureMessage: 'Runtime could not be locked.',
    loadingMessage: 'Locking runtime...',
    displayOrder: 45,
    isVisible: true,
    requiresConfirmation: true,
    presentationKey: 'primary-action',
  }),
])

const ACTION_BRIDGE_ACTIONS = Object.freeze([
  ...SECTION_ACTIONS,
  ...LIFECYCLE_ACTIONS,
])

const SECTION_POLICIES = Object.freeze([
  Object.freeze({
    key: 'generate-section-gate',
    name: 'Generate Section Gate',
    description: 'Allows governed section generation from accepted Intelligence Hub evidence for VMF v3.1.1 runtimes.',
    status: WORKFLOW_POLICY_STATUSES.ACTIVE,
    policyType: WORKFLOW_POLICY_TYPES.AUTOMATION,
    priority: 301,
    frameworkKeys: ['VMF'],
    appliesTo: WORKFLOW_POLICY_APPLIES_TO.FRAMEWORK_STATE,
    triggerEvent: 'ON_SECTION_GENERATE',
    triggerMode: WORKFLOW_POLICY_TRIGGER_MODES.PRE_ACTION,
    actorScope: 'ANY',
    governedAction: 'GENERATE_SECTION',
    decisionMode: WORKFLOW_POLICY_DECISION_MODES.ALLOW,
    executionType: WORKFLOW_POLICY_EXECUTION_TYPES.SINGLE_STEP,
    passMessage: 'Generate Section Gate passed.',
    failMessage: 'Generate Section Gate blocked.',
    requireSuccess: true,
    version: 1,
    componentVersion: 1,
    versionStatus: 'ACTIVE',
    lineageId: 'policy-generate-section-gate',
    introducedInVersion: '3.1.1',
    compatibilityTags: ['VMF', '3.1.1', 'RUNTIME_KNOWLEDGE_MODEL', 'ACTION_ALIGNMENT_PATCH_R3'],
    compatibilityMode: 'INHERITED_MINOR',
    createdBy: DEFAULT_SYSTEM_ACTOR_ID,
    updatedBy: DEFAULT_SYSTEM_ACTOR_ID,
  }),
  Object.freeze({
    key: 'regenerate-section-gate',
    name: 'Regenerate Section Gate',
    description: 'Allows governed section regeneration from accepted Intelligence Hub evidence for VMF v3.1.1 runtimes.',
    status: WORKFLOW_POLICY_STATUSES.ACTIVE,
    policyType: WORKFLOW_POLICY_TYPES.AUTOMATION,
    priority: 302,
    frameworkKeys: ['VMF'],
    appliesTo: WORKFLOW_POLICY_APPLIES_TO.FRAMEWORK_STATE,
    triggerEvent: 'ON_SECTION_REGENERATE',
    triggerMode: WORKFLOW_POLICY_TRIGGER_MODES.PRE_ACTION,
    actorScope: 'ANY',
    governedAction: 'REGENERATE_SECTION',
    decisionMode: WORKFLOW_POLICY_DECISION_MODES.ALLOW,
    executionType: WORKFLOW_POLICY_EXECUTION_TYPES.SINGLE_STEP,
    passMessage: 'Regenerate Section Gate passed.',
    failMessage: 'Regenerate Section Gate blocked.',
    requireSuccess: true,
    version: 1,
    componentVersion: 1,
    versionStatus: 'ACTIVE',
    lineageId: 'policy-regenerate-section-gate',
    introducedInVersion: '3.1.1',
    compatibilityTags: ['VMF', '3.1.1', 'RUNTIME_KNOWLEDGE_MODEL', 'ACTION_ALIGNMENT_PATCH_R3'],
    compatibilityMode: 'INHERITED_MINOR',
    createdBy: DEFAULT_SYSTEM_ACTOR_ID,
    updatedBy: DEFAULT_SYSTEM_ACTOR_ID,
  }),
])

const LIFECYCLE_POLICIES = Object.freeze([
  Object.freeze({
    key: 'mark-ready-policy',
    name: 'Mark Ready Policy',
    description: 'Exposes the governed MARK_READY lifecycle transition once runtime validation has passed for VMF v3.1.1 runtimes.',
    status: WORKFLOW_POLICY_STATUSES.ACTIVE,
    policyType: WORKFLOW_POLICY_TYPES.RUNTIME_KNOWLEDGE_POLICY,
    priority: 1375,
    frameworkKeys: ['VMF'],
    appliesTo: WORKFLOW_POLICY_APPLIES_TO.FRAMEWORK_LIFECYCLE,
    triggerEvent: 'ON_MARK_READY',
    triggerMode: WORKFLOW_POLICY_TRIGGER_MODES.ACTION_OR_EVENT,
    actorScope: 'ANY',
    governedAction: 'MARK_READY',
    decisionMode: WORKFLOW_POLICY_DECISION_MODES.ALLOW,
    executionType: WORKFLOW_POLICY_EXECUTION_TYPES.SINGLE_STEP,
    passMessage: 'Mark Ready Policy passed.',
    failMessage: 'Mark Ready Policy blocked.',
    requireSuccess: true,
    version: 1,
    componentVersion: 1,
    versionStatus: 'ACTIVE',
    lineageId: 'policy-mark-ready-policy',
    introducedInVersion: '3.1.1',
    compatibilityTags: ['VMF', '3.1.1', 'RUNTIME_KNOWLEDGE_MODEL', 'ACTION_ALIGNMENT_PATCH_R3'],
    compatibilityMode: 'INHERITED_MINOR',
    createdBy: DEFAULT_SYSTEM_ACTOR_ID,
    updatedBy: DEFAULT_SYSTEM_ACTOR_ID,
  }),
  Object.freeze({
    key: 'lifecycle-approval-policy',
    name: 'Lifecycle Approval Policy',
    description: 'Lifecycle Approval Policy for VMF v3.1 Runtime Knowledge Model.',
    status: WORKFLOW_POLICY_STATUSES.ACTIVE,
    policyType: WORKFLOW_POLICY_TYPES.RUNTIME_KNOWLEDGE_POLICY,
    priority: 1700,
    frameworkKeys: ['VMF'],
    appliesTo: WORKFLOW_POLICY_APPLIES_TO.FRAMEWORK_LIFECYCLE,
    triggerEvent: 'ON_APPROVE',
    triggerMode: WORKFLOW_POLICY_TRIGGER_MODES.ACTION_OR_EVENT,
    actorScope: 'ANY',
    governedAction: 'APPROVE',
    decisionMode: WORKFLOW_POLICY_DECISION_MODES.REQUIRE_AGENT_AND_SKILL_EXECUTION,
    executionType: WORKFLOW_POLICY_EXECUTION_TYPES.ORDERED_WORKFLOW,
    steps: [
      {
        stepKey: 'pre-validation',
        type: 'VALIDATION_GATE',
        order: 10,
        blocking: true,
        parameters: {
          validationKeys: ['truth-integrity-check', 'decision-readiness-check', 'package-integrity-check'],
        },
      },
      {
        stepKey: 'select-runtime-agent',
        type: 'AGENT_SELECTION',
        order: 20,
        agentId: 'agent-validation-agent',
        blocking: true,
      },
      {
        stepKey: 'execute-truth-integrity-validator',
        type: 'SKILL_EXECUTION',
        order: 30,
        skillId: 'skill-truth-integrity-validator',
        blocking: true,
        parameters: {
          writePaths: ['framework_state.validation.summary'],
        },
      },
      {
        stepKey: 'execute-decision-readiness-validator',
        type: 'SKILL_EXECUTION',
        order: 40,
        skillId: 'skill-decision-readiness-validator',
        blocking: true,
        parameters: {
          writePaths: ['framework_state.sections.decision_framework'],
        },
      },
      {
        stepKey: 'project-generated-truth',
        type: 'RUNTIME_STATE_PROJECTION',
        order: 900,
        targetPath: 'framework_state.runtime.truth_projection',
        blocking: false,
        parameters: {
          sourcePaths: ['framework_state.runtime.*', 'framework_state.advisor.*', 'framework_state.outputs.*'],
        },
      },
      {
        stepKey: 'post-validation',
        type: 'VALIDATION_GATE',
        order: 910,
        blocking: true,
        parameters: {
          validationKeys: ['truth-integrity-check', 'decision-readiness-check', 'package-integrity-check'],
        },
      },
      {
        stepKey: 'complete-policy',
        type: 'STATE_UPDATE',
        order: 920,
        targetPath: 'framework_state.runtime.execution_status',
        value: 'COMPLETED',
        blocking: false,
      },
    ],
    passMessage: 'Policy passed.',
    failMessage: 'Policy blocked or requires attention.',
    severity: 'BLOCKING',
    conditions: [],
    routingMode: 'FIXED_AGENT',
    primaryAgentId: 'agent-validation-agent',
    timeoutMs: 15000,
    retryOverride: 'RETRY_ONCE',
    requireSuccess: true,
    requiredValidationKeys: ['truth-integrity-check', 'decision-readiness-check', 'package-integrity-check'],
    validationBlockingOnFail: true,
    validationWarningOnly: false,
    validationFreshnessMinutes: 30,
    validationRequireLatestRun: true,
    onPassEffects: [
      {
        type: 'SET_VALUE',
        targetPath: 'framework_state.policy.last_result',
        value: 'PASS',
      },
      {
        type: 'SET_VALUE',
        targetPath: 'framework_state.runtime.execution_status',
        value: 'lifecycle-approval-policy:COMPLETED',
      },
    ],
    onFailEffects: [
      {
        type: 'SET_VALUE',
        targetPath: 'framework_state.policy.last_result',
        value: 'FAIL',
      },
      {
        type: 'SET_VALUE',
        targetPath: 'framework_state.policy.last_block_reason',
        value: 'Lifecycle Approval Policy failed',
      },
    ],
    overrideAllowed: false,
    overrideRoles: [],
    approvalRequired: false,
    version: 1,
    componentVersion: 1,
    versionStatus: 'ACTIVE',
    orderedSteps: [
      'pre-validation',
      'select-runtime-agent',
      'execute-truth-integrity-validator',
      'execute-decision-readiness-validator',
      'project-generated-truth',
      'post-validation',
      'complete-policy',
    ],
    requiredAgentIds: ['agent-validation-agent'],
    requiredSkillIds: ['skill-truth-integrity-validator', 'skill-decision-readiness-validator'],
    gatingRules: ['truth-integrity-check', 'decision-readiness-check', 'package-integrity-check'],
    lineageId: 'policy-lifecycle-approval-policy',
    introducedInVersion: '3.1.1',
    compatibilityTags: ['VMF', '3.1.1', 'RUNTIME_KNOWLEDGE_MODEL', 'CANONICAL_EXECUTABLE_ORCHESTRATION'],
    compatibilityMode: 'INHERITED_MINOR',
    createdBy: DEFAULT_SYSTEM_ACTOR_ID,
    updatedBy: DEFAULT_SYSTEM_ACTOR_ID,
  }),
  Object.freeze({
    key: 'lock-record-policy',
    name: 'Lock Record Policy',
    description: 'Exposes the governed LOCK_RECORD lifecycle transition once a VMF v3.1.1 runtime has publish evidence.',
    status: WORKFLOW_POLICY_STATUSES.ACTIVE,
    policyType: WORKFLOW_POLICY_TYPES.RUNTIME_KNOWLEDGE_POLICY,
    priority: 1850,
    frameworkKeys: ['VMF'],
    appliesTo: WORKFLOW_POLICY_APPLIES_TO.FRAMEWORK_LIFECYCLE,
    triggerEvent: 'ON_LOCK',
    triggerMode: WORKFLOW_POLICY_TRIGGER_MODES.ACTION_OR_EVENT,
    actorScope: 'ANY',
    governedAction: 'LOCK_RECORD',
    decisionMode: WORKFLOW_POLICY_DECISION_MODES.ALLOW,
    executionType: WORKFLOW_POLICY_EXECUTION_TYPES.SINGLE_STEP,
    passMessage: 'Lock Record Policy passed.',
    failMessage: 'Lock Record Policy blocked.',
    requireSuccess: true,
    version: 1,
    componentVersion: 1,
    versionStatus: 'ACTIVE',
    lineageId: 'policy-lock-record-policy',
    introducedInVersion: '3.1.1',
    compatibilityTags: ['VMF', '3.1.1', 'RUNTIME_KNOWLEDGE_MODEL', 'ACTION_ALIGNMENT_PATCH_R3'],
    compatibilityMode: 'INHERITED_MINOR',
    createdBy: DEFAULT_SYSTEM_ACTOR_ID,
    updatedBy: DEFAULT_SYSTEM_ACTOR_ID,
  }),
])

const ACTION_BRIDGE_POLICIES = Object.freeze([
  ...SECTION_POLICIES,
  ...LIFECYCLE_POLICIES,
])

const SECTION_BINDINGS = Object.freeze([
  Object.freeze({
    policyKey: 'generate-section-gate',
    executionContext: 'ON_SECTION_GENERATE',
    priority: 310,
    enabled: true,
    notes: 'Restores executable section generation bridge for the current Runtime Workspace component.',
  }),
  Object.freeze({
    policyKey: 'regenerate-section-gate',
    executionContext: 'ON_SECTION_REGENERATE',
    priority: 320,
    enabled: true,
    notes: 'Restores executable section regeneration bridge for the current Runtime Workspace component.',
  }),
])

const LIFECYCLE_BINDINGS = Object.freeze([
  Object.freeze({
    policyKey: 'mark-ready-policy',
    executionContext: 'ON_MARK_READY',
    priority: 1375,
    enabled: true,
    notes: 'Exposes the ready lifecycle bridge required before submit-for-review.',
  }),
  Object.freeze({
    policyKey: 'lifecycle-approval-policy',
    executionContext: 'ON_APPROVE',
    priority: 1700,
    enabled: true,
    notes: 'Exposes the approval lifecycle bridge required before publish.',
  }),
  Object.freeze({
    policyKey: 'lock-record-policy',
    executionContext: 'ON_LOCK',
    priority: 1850,
    enabled: true,
    notes: 'Exposes the canonical lock bridge required after publish.',
  }),
])

const ACTION_BRIDGE_BINDINGS = Object.freeze([
  ...SECTION_BINDINGS,
  ...LIFECYCLE_BINDINGS,
])

const normalizeKey = (value) => String(value || '').trim().toLowerCase()
const normalizeToken = (value) => String(value || '').trim().toUpperCase()

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = {
    apply: false,
    confirmed: false,
    help: false,
    json: false,
    packageKey: DEFAULT_PACKAGE_KEY,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--json') args.json = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === CONFIRM_REPAIR) args.confirmed = true
    else if (arg === '--package-key') {
      args.packageKey = String(argv[index + 1] || '').trim()
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

const usage = () => `
Repair active Framework Package Runtime Workspace action bridge bindings.

Dry-run:
  npm run framework-packages:repair-section-generation-actions -- --package-key ${DEFAULT_PACKAGE_KEY} --json

Apply:
  npm run framework-packages:repair-section-generation-actions -- --apply ${CONFIRM_REPAIR} --package-key ${DEFAULT_PACKAGE_KEY} --json
`

const sessionQuery = (query, session) => {
  if (session && typeof query?.session === 'function') return query.session(session)
  return query
}

const findInputs = async ({ packageKey, models, session = null }) => {
  const frameworkPackage = await sessionQuery(
    models.FrameworkPackage.findOne({ packageKey: normalizeKey(packageKey) }),
    session,
  )
  if (!frameworkPackage) return { frameworkPackage: null, uiContract: null }

  const uiContractKey = normalizeKey(frameworkPackage.uiContractBinding?.key || frameworkPackage.uiContractKey)
  const uiContract = uiContractKey
    ? await sessionQuery(
      models.UIContract.findOne({
        uiContractKey,
        status: UI_CONTRACT_STATUSES.ACTIVE,
      }),
      session,
    )
    : null

  const policyKeys = ACTION_BRIDGE_POLICIES.map((policy) => policy.key)
  const policies = await sessionQuery(
    models.WorkflowPolicy.find({ key: { $in: policyKeys } }),
    session,
  )

  return { frameworkPackage, uiContract, policies }
}

const buildPlan = ({ frameworkPackage, uiContract, policies = [] }) => {
  if (!frameworkPackage) throw new Error('Framework Package not found.')
  if (normalizeToken(frameworkPackage.status) !== FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
    throw new Error(`Framework Package must be ACTIVE; current status is ${frameworkPackage.status || 'UNKNOWN'}.`)
  }
  if (!uiContract) throw new Error('Active UI Contract not found for Framework Package.')

  const currentActions = Array.isArray(uiContract.actions) ? uiContract.actions : []
  const currentBindings = Array.isArray(frameworkPackage.workflowBindings) ? frameworkPackage.workflowBindings : []
  const currentPolicyByKey = new Map((Array.isArray(policies) ? policies : []).map((policy) => [normalizeKey(policy.key), policy]))
  const actionKeys = new Set(currentActions.map((action) => normalizeToken(action.actionKey)))
  const bindingKeys = new Set(currentBindings.map((binding) =>
    `${normalizeKey(binding.policyKey)}:${normalizeToken(binding.executionContext)}`,
  ))

  const missingActions = ACTION_BRIDGE_ACTIONS.filter((action) => !actionKeys.has(action.actionKey))
  const missingBindings = ACTION_BRIDGE_BINDINGS.filter((binding) =>
    !bindingKeys.has(`${binding.policyKey}:${binding.executionContext}`),
  )
  const missingPolicies = ACTION_BRIDGE_POLICIES.filter((policy) => !currentPolicyByKey.has(policy.key))

  return {
    packageKey: frameworkPackage.packageKey,
    uiContractKey: uiContract.uiContractKey,
    before: {
      actionKeys: currentActions.map((action) => normalizeToken(action.actionKey)),
      bindingKeys: currentBindings.map((binding) =>
        `${normalizeKey(binding.policyKey)}:${normalizeToken(binding.executionContext)}`,
      ),
      policyKeys: [...currentPolicyByKey.keys()],
    },
    missing: {
      actions: missingActions.map((action) => action.actionKey),
      bindings: missingBindings.map((binding) => `${binding.policyKey}:${binding.executionContext}`),
      policies: missingPolicies.map((policy) => policy.key),
    },
    updates: {
      actions: missingActions,
      bindings: missingBindings,
      policies: missingPolicies,
    },
  }
}

const applyPlan = async ({ plan, inputs, models, session }) => {
  if (plan.updates.policies.length > 0) {
    for (const policy of plan.updates.policies) {
      const doc = new models.WorkflowPolicy(policy)
      await doc.save({ session })
    }
  }

  if (plan.updates.actions.length > 0) {
    inputs.uiContract.actions = [
      ...(Array.isArray(inputs.uiContract.actions) ? inputs.uiContract.actions : []),
      ...plan.updates.actions,
    ]
    if (inputs.uiContract.$locals) {
      inputs.uiContract.$locals.allowLockedRuntimeControlWrite = true
    }
    await inputs.uiContract.save({ session })
  }

  if (plan.updates.bindings.length > 0) {
    inputs.frameworkPackage.workflowBindings = [
      ...(Array.isArray(inputs.frameworkPackage.workflowBindings) ? inputs.frameworkPackage.workflowBindings : []),
      ...plan.updates.bindings,
    ]
    if (inputs.frameworkPackage.$locals) {
      inputs.frameworkPackage.$locals.allowLockedRuntimeControlWrite = true
    }
    await inputs.frameworkPackage.save({ session })
  }
}

const repairActiveFrameworkPackageSectionGenerationActions = async ({
  apply = false,
  confirmed = false,
  json = false,
  logger = console.log,
  packageKey = DEFAULT_PACKAGE_KEY,
  dependencies = {},
} = {}) => {
  if (!packageKey) throw new Error('--package-key is required.')
  if (apply && !confirmed) throw new Error(`Apply mode requires ${CONFIRM_REPAIR}.`)

  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const startSession = dependencies.startSession || (() => mongoose.startSession())
  const models = { ...DEFAULT_MODELS, ...(dependencies.models || {}) }

  await connect()
  try {
    const inputs = await findInputs({ packageKey, models })
    const plan = buildPlan(inputs)
    const result = {
      ...plan,
      updates: undefined,
      mode: apply ? 'apply' : 'dry-run',
      applied: false,
    }

    if (apply) {
      const session = await startSession()
      try {
        await session.withTransaction(async () => {
          const freshInputs = await findInputs({ packageKey, models, session })
          const freshPlan = buildPlan(freshInputs)
          await applyPlan({ plan: freshPlan, inputs: freshInputs, models, session })
          result.before = freshPlan.before
          result.missing = freshPlan.missing
        })
      } finally {
        await session.endSession()
      }
      result.applied = true
    }

    logger(json
      ? JSON.stringify(result, null, 2)
      : `${apply ? 'Applied' : 'Dry run'} Runtime Workspace action bridge repair for ${result.packageKey}: applied=${result.applied}.`)
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
  let args
  try {
    args = parseArgs()
    if (args.help) {
      console.log(usage())
      process.exit(0)
    }
  } catch (error) {
    console.error(error.message)
    console.error(usage())
    process.exit(1)
  }

  repairActiveFrameworkPackageSectionGenerationActions(args)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}

export {
  buildPlan as buildSectionGenerationActionRepairPlan,
  parseArgs,
  repairActiveFrameworkPackageSectionGenerationActions,
}
