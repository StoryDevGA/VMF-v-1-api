import { isDeepStrictEqual } from 'node:util'
import semver from 'semver'

const METADATA = [
  '_id', 'id', '__v', 'packageKey', 'packageName', 'description', 'version',
  'derivedFromPackageId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
  'activatedAt', 'activatedBy', 'lockedAt', 'lockedBy', 'lockedReason', 'isDefault',
  'dependencyLock', 'lastCheckpointStatus', 'lastCheckpointAt', 'lastCheckpointResult', 'runtimeVerdict',
]
const UI_METADATA = [
  ...METADATA, 'stableId', 'uiContractKey', 'name', 'sourcePackageKey', 'sourcePackageVersion',
  'introducedInVersion', 'componentVersion', 'versionStatus', 'lineageId', 'clonedFromStableId',
  'lockedByPackageKeys', 'resolvedAt',
]
const ACTION_FIELDS = [
  'actionKey', 'governedAction', 'buttonLabel', 'confirmationTitle', 'confirmationMessage',
  'successMessage', 'failureMessage', 'loadingMessage', 'displayOrder', 'isVisible',
  'requiresConfirmation', 'presentationKey',
]
const POLICY_EMPTY_ARRAYS = [
  'conditions', 'steps', 'orderedSteps', 'gatingRules', 'onPassEffects', 'onFailEffects',
  'requiredAgentIds', 'requiredSkillIds', 'requiredValidationKeys',
]
const POLICY_EMPTY_STRINGS = ['primaryAgentId', 'fallbackAgentId', 'escalationRoleKey', 'escalateTo']
const POLICY_VALUES = {
  status: 'ACTIVE', isLocked: true, governedAction: 'RETURN_TO_DRAFT',
  policyType: 'LIFECYCLE_GATE', appliesTo: 'FRAMEWORK_LIFECYCLE',
  triggerEvent: 'ON_STAGE_CHANGE', triggerMode: 'PRE_ACTION', actorScope: 'ANY',
  decisionMode: 'ALLOW', executionType: 'SINGLE_STEP', requireSuccess: true,
  overrideAllowed: false, approvalRequired: false,
}

const object = (value) => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype
const jsonValue = (value, ancestors = new Set()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if ((!Array.isArray(value) && !object(value)) || ancestors.has(value)) return false
  const next = new Set(ancestors).add(value)
  return Reflect.ownKeys(value).every((key) => {
    if (Array.isArray(value) && key === 'length') return true
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return typeof key === 'string' && descriptor.enumerable && 'value' in descriptor
      && (!Array.isArray(value) || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length))
      && jsonValue(descriptor.value, next)
  }) && (!Array.isArray(value) || Object.keys(value).length === value.length)
}
export { jsonValue as isRuntimeReleaseJsonValue }
const text = (value) => typeof value === 'string' && value.trim().length > 0
const identity = (value) => text(value?._id) && (!('id' in value) || value.id === value._id)
const only = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key))
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
const same = isDeepStrictEqual
const activeLocked = (value) => value.status === 'ACTIVE' && value.isLocked === true
const validMetadata = (value) => {
  const strings = [...METADATA, ...UI_METADATA].filter((key) => ![
    '__v', 'isDefault', 'dependencyLock', 'lastCheckpointResult', 'runtimeVerdict',
    'componentVersion', 'lockedByPackageKeys',
  ].includes(key))
  return strings.every((key) => !(key in value) || value[key] === null || typeof value[key] === 'string')
    && ['__v', 'componentVersion'].every((key) => !(key in value) || (Number.isInteger(value[key]) && value[key] >= 0))
    && (!('isDefault' in value) || typeof value.isDefault === 'boolean')
    && ['dependencyLock', 'lastCheckpointResult', 'runtimeVerdict'].every((key) => !(key in value)
      || value[key] === null || object(value[key]))
    && (!('lockedByPackageKeys' in value) || (Array.isArray(value.lockedByPackageKeys)
      && value.lockedByPackageKeys.every(text)))
}
const result = (reason) => ({
  contractVersion: 'runtime-release-authored-compatibility.v1',
  authoredConfigurationCompatible: reason === null,
  reason,
  adoptionReady: false,
})

// Accept complete JSON package/UI records and an explicitly projected policy descriptor.
// This compares authored configuration ONLY. Reference contents, release certification,
// authorization, persistence and rollback require separate gates before adoption.
export const checkRuntimeReleaseAuthoredCompatibility = (input) => {
  if (!object(input) || !jsonValue(input)
    || !only(input, ['sourcePackage', 'targetPackage', 'sourceUi', 'targetUi', 'addedPolicy'])) {
    return result('INVALID_INPUT')
  }
  const { sourcePackage: source, targetPackage: target, sourceUi, targetUi, addedPolicy: policy } = input
  if (![source, target, sourceUi, targetUi, policy].every(object)) return result('INVALID_INPUT')
  if (![source, target, sourceUi, targetUi].every(validMetadata)) return result('INVALID_METADATA')
  if (![source, target, sourceUi, targetUi].every(identity)) return result('INVALID_IDENTITY')
  if (![source, target, sourceUi, targetUi].every(activeLocked)) return result('RELEASE_NOT_ACTIVE_LOCKED')
  if (!text(source.packageKey) || !text(target.packageKey) || !text(source.frameworkKey)
    || source._id === target._id || source.packageKey === target.packageKey
    || target.frameworkKey !== source.frameworkKey
    || ![source._id, source.packageKey].includes(target.derivedFromPackageId)) {
    return result('NOT_DIRECT_SUCCESSOR')
  }
  if (!semver.valid(source.version) || !semver.valid(target.version)
    || !semver.gt(target.version, source.version)) return result('SUCCESSOR_VERSION_REQUIRED')
  if (!Array.isArray(source.sections) || source.sections.length === 0
    || !object(source.runtimeSettings) || !object(source.executionModel)
    || !Array.isArray(source.validationBindings) || !Array.isArray(sourceUi.sections)
    || sourceUi.sections.length === 0 || !Array.isArray(sourceUi.lifecycleStages)) return result('INCOMPLETE_CONFIGURATION')
  if (!text(sourceUi.uiContractKey) || !text(targetUi.uiContractKey)
    || sourceUi._id === targetUi._id || sourceUi.uiContractKey === targetUi.uiContractKey) {
    return result('UI_SUCCESSOR_REQUIRED')
  }
  for (const [pkg, ui] of [[source, sourceUi], [target, targetUi]]) {
    if (pkg.uiContractKey !== ui.uiContractKey || !object(pkg.uiContractBinding)
      || pkg.uiContractBinding.key !== ui.uiContractKey) return result('UI_BINDING_MISMATCH')
    const binding = pkg.uiContractBinding
    if (('version' in binding && binding.version !== null && typeof binding.version !== 'string')
      || ('resolvedAt' in binding && binding.resolvedAt !== null
        && (typeof binding.resolvedAt !== 'string' || !Number.isFinite(Date.parse(binding.resolvedAt))))) {
      return result('INVALID_METADATA')
    }
  }
  if (!same(omit(source.uiContractBinding, ['key', 'version', 'resolvedAt']),
    omit(target.uiContractBinding, ['key', 'version', 'resolvedAt']))) return result('UI_BINDING_CHANGED')
  if (!same(omit(source, [...METADATA, 'workflowBindings', 'uiContractKey', 'uiContractBinding']),
    omit(target, [...METADATA, 'workflowBindings', 'uiContractKey', 'uiContractBinding']))) {
    return result('PACKAGE_BEHAVIOUR_CHANGED')
  }
  if (!same(omit(sourceUi, [...UI_METADATA, 'actions']), omit(targetUi, [...UI_METADATA, 'actions']))) {
    return result('UI_BEHAVIOUR_CHANGED')
  }
  const oldActions = sourceUi.actions
  const actions = targetUi.actions
  if (!Array.isArray(oldActions) || !Array.isArray(actions) || !oldActions.every(object)
    || actions.length !== oldActions.length + 1 || !same(oldActions, actions.slice(0, -1))
    || oldActions.some((action) => action.actionKey === 'RETURN_TO_DRAFT'
      || action.governedAction === 'RETURN_TO_DRAFT')) return result('ACTION_DELTA_INVALID')
  const action = actions.at(-1)
  if (!only(action, ACTION_FIELDS) || action.actionKey !== 'RETURN_TO_DRAFT'
    || action.governedAction !== 'RETURN_TO_DRAFT' || action.isVisible !== true
    || action.requiresConfirmation !== true || !text(action.buttonLabel)
    || !Number.isInteger(action.displayOrder) || action.displayOrder < 0 || action.displayOrder > 10000
    || Object.entries(action).some(([key, value]) => !['displayOrder', 'isVisible', 'requiresConfirmation'].includes(key)
      && typeof value !== 'string')) return result('ACTION_DELTA_INVALID')
  const policyFields = ['key', 'frameworkKeys', ...Object.keys(POLICY_VALUES), ...POLICY_EMPTY_ARRAYS, ...POLICY_EMPTY_STRINGS]
  if (!only(policy, policyFields) || !text(policy.key) || !same(policy.frameworkKeys, [source.frameworkKey])
    || Object.entries(POLICY_VALUES).some(([key, value]) => policy[key] !== value)
    || POLICY_EMPTY_ARRAYS.some((key) => !same(policy[key], []))
    || POLICY_EMPTY_STRINGS.some((key) => policy[key] !== '')) return result('POLICY_DELTA_INVALID')
  const oldBindings = source.workflowBindings
  const bindings = target.workflowBindings
  if (!Array.isArray(oldBindings) || !oldBindings.every(object) || !Array.isArray(bindings)
    || bindings.length !== oldBindings.length + 1 || !same(oldBindings, bindings.slice(0, -1))) {
    return result('WORKFLOW_DELTA_INVALID')
  }
  const binding = bindings.at(-1)
  if (!only(binding, ['policyKey', 'executionContext', 'priority', 'enabled', 'notes'])
    || binding.policyKey !== policy.key || binding.executionContext !== 'ON_STAGE_EXIT'
    || binding.enabled !== true || !Number.isInteger(binding.priority) || binding.priority < 1 || binding.priority > 10000
    || ('notes' in binding && typeof binding.notes !== 'string')
    || oldBindings.some((old) => old.policyKey === binding.policyKey
      || (old.executionContext === binding.executionContext && old.priority === binding.priority))) {
    return result('WORKFLOW_DELTA_INVALID')
  }
  return result(null)
}
