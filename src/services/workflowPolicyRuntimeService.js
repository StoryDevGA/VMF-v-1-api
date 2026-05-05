import FrameworkPackage from '../models/FrameworkPackage.js'
import WorkflowPolicy, {
  WORKFLOW_POLICY_STATUSES,
  WORKFLOW_POLICY_STEP_TYPES,
} from '../models/WorkflowPolicy.js'
import { RUNTIME_CONTROL_VERSION_STATUSES } from '../utils/runtimeControlVersioning.js'

const normalizeLower = (value) => String(value || '').trim().toLowerCase()
const normalizeUpper = (value) => String(value || '').trim().toUpperCase()

const normalizeWorkflowSteps = (policy = {}) => {
  const structuredSteps = Array.isArray(policy.steps) ? policy.steps : []
  if (structuredSteps.length > 0) {
    return structuredSteps
      .map((step) => ({
        stepKey: normalizeLower(step?.stepKey),
        type: normalizeUpper(step?.type),
        order: Number(step?.order) || 0,
        bindingKeys: Array.isArray(step?.bindingKeys)
          ? step.bindingKeys.map(normalizeLower).filter(Boolean)
          : [],
        targetPath: String(step?.targetPath || '').trim(),
        value: step?.value === undefined ? '' : step.value,
        agentId: normalizeLower(step?.agentId),
        skillId: normalizeLower(step?.skillId),
        eventKey: normalizeLower(step?.eventKey),
        blocking: step?.blocking !== false,
        parameters:
          step?.parameters && typeof step.parameters === 'object' && !Array.isArray(step.parameters)
            ? step.parameters
            : {},
      }))
      .sort((left, right) => left.order - right.order)
  }

  return (Array.isArray(policy.orderedSteps) ? policy.orderedSteps : [])
    .map((stepKey, index) => ({
      stepKey: normalizeLower(stepKey),
      type: WORKFLOW_POLICY_STEP_TYPES.EVENT_EMIT,
      order: index + 1,
      bindingKeys: [],
      targetPath: '',
      value: '',
      agentId: '',
      skillId: '',
      eventKey: normalizeLower(stepKey),
      blocking: true,
      parameters: {},
    }))
}

export const resolveWorkflowPoliciesForRuntime = async ({
  governedAction,
  frameworkKey,
  packageKey,
  frameworkPackageModel = FrameworkPackage,
  workflowPolicyModel = WorkflowPolicy,
} = {}) => {
  const normalizedAction = normalizeUpper(governedAction)
  const normalizedFrameworkKey = normalizeUpper(frameworkKey)
  const normalizedPackageKey = normalizeLower(packageKey)

  if (!normalizedAction) {
    return {
      package: null,
      policies: [],
      issues: ['governedAction is required.'],
    }
  }

  if (!normalizedFrameworkKey) {
    return {
      package: null,
      policies: [],
      issues: ['frameworkKey is required.'],
    }
  }

  const packageFilter = {
    frameworkKey: normalizedFrameworkKey,
    ...(normalizedPackageKey ? { packageKey: normalizedPackageKey } : { status: 'ACTIVE', isDefault: true }),
  }
  const frameworkPackage = await frameworkPackageModel.findOne(packageFilter)
    .select('packageKey version frameworkKey status workflowBindings')
    .lean()

  if (!frameworkPackage) {
    return {
      package: null,
      policies: [],
      issues: [`Framework Package for "${normalizedFrameworkKey}" was not found.`],
    }
  }

  const policyKeys = [
    ...new Set((Array.isArray(frameworkPackage.workflowBindings) ? frameworkPackage.workflowBindings : [])
      .map((binding) => normalizeLower(binding?.policyKey))
      .filter(Boolean)),
  ]

  if (policyKeys.length === 0) {
    return {
      package: frameworkPackage,
      policies: [],
      issues: [],
    }
  }

  const policyRows = await workflowPolicyModel.find({
    key: { $in: policyKeys },
    status: WORKFLOW_POLICY_STATUSES.ACTIVE,
    versionStatus: RUNTIME_CONTROL_VERSION_STATUSES.ACTIVE,
    governedAction: normalizedAction,
    frameworkKeys: normalizedFrameworkKey,
  })
    .select('stableId key name priority governedAction triggerEvent executionType steps orderedSteps componentVersion versionStatus lineageId')
    .lean()

  const policyByKey = new Map(policyRows.map((policy) => [normalizeLower(policy.key), policy]))
  const missingPolicyKeys = policyKeys.filter((policyKey) => !policyByKey.has(policyKey))

  return {
    package: frameworkPackage,
    policies: policyRows
      .map((policy) => ({
        id: policy.stableId,
        key: policy.key,
        name: policy.name || policy.key,
        priority: Number(policy.priority) || 0,
        governedAction: policy.governedAction,
        triggerEvent: policy.triggerEvent,
        executionType: policy.executionType || '',
        componentVersion: Number(policy.componentVersion) || 1,
        versionStatus: policy.versionStatus || '',
        lineageId: policy.lineageId || policy.stableId,
        steps: normalizeWorkflowSteps(policy),
      }))
      .sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key)),
    issues: missingPolicyKeys.map((policyKey) =>
      `Workflow policy "${policyKey}" is not ACTIVE, not version-active, incompatible, or not mapped to governed action "${normalizedAction}".`),
  }
}
