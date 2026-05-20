import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import {
  FrameworkPackage,
  RuntimeActivationSnapshot,
  RuntimeDeployment,
  RuntimeInstance,
  RuntimePathRegistry,
  UIContract,
  WorkflowPolicy,
} from '../models/index.js'
import { FRAMEWORK_PACKAGE_STATUSES } from '../models/FrameworkPackage.js'
import { RUNTIME_ACTIVATION_STATUSES } from '../models/RuntimeActivationSnapshot.js'
import { RUNTIME_DEPLOYMENT_STATUSES } from '../models/RuntimeDeployment.js'
import {
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_STATUSES,
  RUNTIME_PATH_REGISTRY_UI_CONTROLS,
} from '../models/RuntimePathRegistry.js'
import {
  RUNTIME_EXECUTION_STATUSES,
  RUNTIME_INSTANCE_STATUSES,
  RUNTIME_TYPES,
} from '../models/RuntimeInstance.js'
import { UI_CONTRACT_STATUSES } from '../models/UIContract.js'
import {
  WORKFLOW_POLICY_CONDITION_LOGIC,
  WORKFLOW_POLICY_CONDITION_OPERATORS,
  WORKFLOW_POLICY_DECISION_MODES,
  WORKFLOW_POLICY_STATUSES,
} from '../models/WorkflowPolicy.js'
import { getRuntimeInstance } from './runtimeInstanceService.js'

export const RUNTIME_RENDERER_ERROR_REASONS = Object.freeze({
  PACKAGE_NOT_FOUND: 'PACKAGE_NOT_FOUND',
  PACKAGE_FRAMEWORK_MISMATCH: 'PACKAGE_FRAMEWORK_MISMATCH',
  PACKAGE_NOT_ACTIVE: 'PACKAGE_NOT_ACTIVE',
  DEPLOYMENT_SNAPSHOT_MISMATCH: 'DEPLOYMENT_SNAPSHOT_MISMATCH',
  UI_CONTRACT_REQUIRED: 'UI_CONTRACT_REQUIRED',
  UI_CONTRACT_NOT_FOUND: 'UI_CONTRACT_NOT_FOUND',
  DEAL_ANALYSIS_ANCHOR_REQUIRED: 'DEAL_ANALYSIS_ANCHOR_REQUIRED',
})

const CONFIG_WARNING_CODES = Object.freeze({
  PACKAGE_SECTION_MISSING_RUNTIME_PATH: 'PACKAGE_SECTION_MISSING_RUNTIME_PATH',
  RUNTIME_PATH_NOT_FOUND: 'RUNTIME_PATH_NOT_FOUND',
  RUNTIME_PATH_NOT_READABLE: 'RUNTIME_PATH_NOT_READABLE',
  UI_CONTRACT_SECTION_MISSING: 'UI_CONTRACT_SECTION_MISSING',
  UI_CONTRACT_SECTION_ORPHANED: 'UI_CONTRACT_SECTION_ORPHANED',
  ACTION_POLICY_MISSING: 'ACTION_POLICY_MISSING',
  POLICY_ACTION_MISSING: 'POLICY_ACTION_MISSING',
})

const VALUE_NOT_FOUND = Symbol('VALUE_NOT_FOUND')
const VMF_FRAMEWORK_KEY = 'VMF'
const MUTATING_RUNTIME_ACTIONS = new Set([
  'APPROVE',
  'ARCHIVE',
  'BUILD_SECTIONS',
  'INITIALISE_STATE',
  'PUBLISH',
  'RETURN_TO_DRAFT',
  'RUN_VALIDATION',
  'SAVE',
  'START_REVIEW',
  'SUBMIT_FOR_REVIEW',
])
const DEAL_ANALYSIS_ANCHOR_RELATIONSHIPS = new Set([
  'LOCKED_VMF_RUNTIME',
  'LOCKED_VALUE_NARRATIVE',
  'VALUE_NARRATIVE_ANCHOR',
])
const RENDERABLE_DEPLOYMENT_STATUSES = new Set([
  RUNTIME_DEPLOYMENT_STATUSES.ACTIVE,
  RUNTIME_DEPLOYMENT_STATUSES.ROLLBACK_ACTIVE,
  RUNTIME_DEPLOYMENT_STATUSES.SUPERSEDED,
])
const RENDERABLE_ACTIVATION_STATUSES = new Set([
  RUNTIME_ACTIVATION_STATUSES.ACTIVE,
  RUNTIME_ACTIVATION_STATUSES.SUPERSEDED,
])
export const RUNTIME_RENDERER_CONTRACT_VERSION = 'runtime-renderer.v1.read-projection'

const toPlainObject = (value) => {
  if (!value) return null
  if (typeof value.toJSON === 'function') return value.toJSON()
  if (typeof value.toObject === 'function') return value.toObject()
  return { ...value }
}

const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (value._id && value._id !== value) return toIdString(value._id)
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const normalizeToken = (value) => String(value || '').trim().toUpperCase()
const normalizeKey = (value) => String(value || '').trim().toLowerCase()
const uniqueTokens = (values = []) => [...new Set(
  (Array.isArray(values) ? values : [])
    .map(normalizeToken)
    .filter(Boolean),
)]

const createRuntimeRendererError = ({
  status,
  code,
  message,
  reason,
  details = {},
}) => {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.details = {
    reason,
    ...details,
  }
  return err
}

const createConfigWarning = ({
  code,
  message,
  sectionKey,
  runtimePath,
  actionKey,
  governedAction,
  policyKey,
}) => ({
  code,
  message,
  ...(sectionKey ? { sectionKey } : {}),
  ...(runtimePath ? { runtimePath } : {}),
  ...(actionKey ? { actionKey } : {}),
  ...(governedAction ? { governedAction } : {}),
  ...(policyKey ? { policyKey } : {}),
})

const getValueAtPath = (source, path) => {
  const parts = String(path || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return VALUE_NOT_FOUND

  let cursor = source
  for (const part of parts) {
    if (
      cursor === null
      || cursor === undefined
      || typeof cursor !== 'object'
      || !Object.prototype.hasOwnProperty.call(cursor, part)
    ) {
      return VALUE_NOT_FOUND
    }
    cursor = cursor[part]
  }

  return cursor
}

const getRuntimePathValue = (frameworkState, runtimePath) => {
  const normalizedPath = String(runtimePath || '').trim()
  if (!normalizedPath.startsWith('framework_state.')) return undefined

  const value = getValueAtPath(
    { framework_state: frameworkState || {} },
    normalizedPath,
  )

  return value === VALUE_NOT_FOUND ? undefined : value
}

const titleFromKey = (key) =>
  String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())

const resolveControlType = (runtimePathRecord) => {
  const explicitControl = normalizeToken(runtimePathRecord?.uiControl)
  if (explicitControl) return explicitControl

  const dataType = normalizeToken(runtimePathRecord?.dataType)
  if (dataType === 'NUMBER') return RUNTIME_PATH_REGISTRY_UI_CONTROLS.NUMBER
  if (dataType === 'BOOLEAN') return RUNTIME_PATH_REGISTRY_UI_CONTROLS.CHECKBOX
  if (dataType === 'ENUM') return RUNTIME_PATH_REGISTRY_UI_CONTROLS.SELECT
  if (dataType === 'OBJECT' || dataType === 'ARRAY') return RUNTIME_PATH_REGISTRY_UI_CONTROLS.JSON
  return RUNTIME_PATH_REGISTRY_UI_CONTROLS.TEXT
}

const isRuntimeEditable = (runtimeInstance) => {
  const runtimeStatus = normalizeToken(runtimeInstance?.status)
  const executionStatus = normalizeToken(runtimeInstance?.executionStatus)

  if (runtimeStatus !== RUNTIME_INSTANCE_STATUSES.ACTIVE) return false

  return ![
    RUNTIME_EXECUTION_STATUSES.RUNNING,
    RUNTIME_EXECUTION_STATUSES.VALIDATING,
    RUNTIME_EXECUTION_STATUSES.COMPLETE,
    RUNTIME_EXECUTION_STATUSES.ERROR,
  ].includes(executionStatus)
}

const buildSectionValidationMessages = ({ frameworkState, validationKeys }) => {
  const validationState = frameworkState?.validation || {}
  if (!Array.isArray(validationKeys) || validationKeys.length === 0) return []

  return validationKeys.flatMap((validationKey) => {
    const normalizedKey = String(validationKey || '').trim()
    const underscoreKey = normalizedKey.replace(/-/g, '_')
    const result = validationState[normalizedKey] || validationState[underscoreKey]

    if (!result || typeof result !== 'object' || Array.isArray(result)) return []

    const messages = []
    if (result.message) {
      messages.push({
        validationKey: normalizedKey,
        severity: result.is_valid === false ? 'ERROR' : 'INFO',
        message: String(result.message),
      })
    }

    if (Array.isArray(result.messages)) {
      result.messages.forEach((message) => {
        if (!message) return
        if (typeof message === 'string') {
          messages.push({
            validationKey: normalizedKey,
            severity: result.is_valid === false ? 'ERROR' : 'INFO',
            message,
          })
          return
        }

        messages.push({
          validationKey: normalizedKey,
          severity: normalizeToken(message.severity || (result.is_valid === false ? 'ERROR' : 'INFO')),
          message: String(message.message || ''),
        })
      })
    }

    return messages.filter((message) => message.message)
  })
}

const deriveValidationState = (frameworkState) => {
  const validationState = frameworkState?.validation || {}
  const rows = Object.values(validationState).filter(
    (value) => value && typeof value === 'object' && !Array.isArray(value),
  )

  if (rows.some((row) => row.blocking === true && row.is_valid === false)) return 'BLOCKED'
  if (rows.some((row) => row.is_valid === false)) return 'FAILED'
  if (rows.some((row) => row.is_valid === true)) return 'PASSED'
  return 'UNKNOWN'
}

const evaluateCondition = (condition, runtimeContext) => {
  const path = String(condition?.path || '').trim()
  const operator = String(condition?.operator || '').trim()
  const expected = condition?.value
  const current = getValueAtPath(runtimeContext, path)
  const exists = current !== VALUE_NOT_FOUND && current !== undefined && current !== null

  switch (operator) {
    case WORKFLOW_POLICY_CONDITION_OPERATORS.EXISTS:
      return exists
    case WORKFLOW_POLICY_CONDITION_OPERATORS.NOT_EXISTS:
      return !exists
    case WORKFLOW_POLICY_CONDITION_OPERATORS.NOT_EQUALS:
      return current !== expected
    case WORKFLOW_POLICY_CONDITION_OPERATORS.CONTAINS:
      if (!exists) return false
      if (Array.isArray(current)) return current.includes(expected)
      return String(current).includes(String(expected))
    case WORKFLOW_POLICY_CONDITION_OPERATORS.IN:
      return Array.isArray(expected) && expected.includes(current)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.NOT_IN:
      return Array.isArray(expected) && !expected.includes(current)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.GREATER_THAN:
      return Number(current) > Number(expected)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.LESS_THAN:
      return Number(current) < Number(expected)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.GREATER_THAN_OR_EQUAL:
      return Number(current) >= Number(expected)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.LESS_THAN_OR_EQUAL:
      return Number(current) <= Number(expected)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.EQUALS:
    default:
      return current === expected
  }
}

const evaluatePolicyConditions = ({ policy, runtimeContext }) => {
  const conditions = Array.isArray(policy?.conditions) ? policy.conditions : []
  if (conditions.length === 0) return true

  let aggregate = evaluateCondition(conditions[0], runtimeContext)

  for (let index = 1; index < conditions.length; index += 1) {
    const previousLogic = normalizeToken(conditions[index - 1]?.logic || WORKFLOW_POLICY_CONDITION_LOGIC.AND)
    const currentResult = evaluateCondition(conditions[index], runtimeContext)
    aggregate = previousLogic === WORKFLOW_POLICY_CONDITION_LOGIC.OR
      ? aggregate || currentResult
      : aggregate && currentResult
  }

  return aggregate
}

const buildRuntimeContext = (runtimeInstance) => ({
  framework_state: runtimeInstance.framework_state || {},
  runtimeInstance,
  runtime: {
    id: runtimeInstance.id,
    runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
    runtimeType: runtimeInstance.runtimeType,
    status: runtimeInstance.status,
    executionStatus: runtimeInstance.executionStatus,
    runtimeMode: runtimeInstance.runtimeMode,
    workspaceId: runtimeInstance.workspaceId,
    customerId: runtimeInstance.customerId,
    tenantId: runtimeInstance.tenantId,
  },
})

const getResolvedPermissionsSnapshot = (scopes = {}) => ({
  platform: scopes?.resolvedPermissions?.platform || { roleKeys: [], permissions: [] },
  customers: Array.isArray(scopes?.resolvedPermissions?.customers)
    ? scopes.resolvedPermissions.customers
    : [],
  tenants: Array.isArray(scopes?.resolvedPermissions?.tenants)
    ? scopes.resolvedPermissions.tenants
    : [],
})

const getCustomerBucket = (scopes, customerId) =>
  getResolvedPermissionsSnapshot(scopes).customers.find(
    (bucket) => toIdString(bucket?.customerId) === String(customerId),
  ) || null

const getTenantBucket = (scopes, customerId, tenantId) =>
  getResolvedPermissionsSnapshot(scopes).tenants.find(
    (bucket) =>
      toIdString(bucket?.customerId) === String(customerId)
      && toIdString(bucket?.tenantId) === String(tenantId),
  ) || null

const getRuntimeRoleKeys = ({ scopes, runtimeInstance }) => {
  const resolved = getResolvedPermissionsSnapshot(scopes)
  const customerBucket = getCustomerBucket(scopes, runtimeInstance.customerId)
  const tenantBucket = getTenantBucket(scopes, runtimeInstance.customerId, runtimeInstance.tenantId)

  return uniqueTokens([
    ...(resolved.platform.roleKeys || []),
    ...(customerBucket?.roleKeys || []),
    ...(tenantBucket?.roleKeys || []),
  ])
}

const hasRuntimePermission = ({ scopes, runtimeInstance, permission }) => {
  const normalizedPermission = normalizeToken(permission)
  if (!normalizedPermission) return true

  const resolved = getResolvedPermissionsSnapshot(scopes)
  if ((resolved.platform.roleKeys || []).includes('SUPER_ADMIN')) return true
  if ((resolved.platform.permissions || []).includes(normalizedPermission)) return true

  const customerBucket = getCustomerBucket(scopes, runtimeInstance.customerId)
  if ((customerBucket?.permissions || []).includes(normalizedPermission)) return true

  const tenantBucket = getTenantBucket(scopes, runtimeInstance.customerId, runtimeInstance.tenantId)
  return (tenantBucket?.permissions || []).includes(normalizedPermission)
}

const getRuntimeEvidence = (runtimeInstance) => ({
  activationId: String(runtimeInstance.evidence?.activationId || runtimeInstance.activationId || '').trim(),
  deploymentId: String(runtimeInstance.evidence?.deploymentId || runtimeInstance.deploymentId || '').trim(),
  dependencySnapshotId: String(runtimeInstance.evidence?.dependencySnapshotId || runtimeInstance.dependencyLockId || '').trim(),
  dependencySnapshotHash: String(runtimeInstance.evidence?.dependencySnapshotHash || '').trim(),
})

const createSnapshotMismatchError = ({ runtimeInstance, message, details = {} }) =>
  createRuntimeRendererError({
    status: 409,
    code: 'CONFLICT',
    message,
    reason: RUNTIME_RENDERER_ERROR_REASONS.DEPLOYMENT_SNAPSHOT_MISMATCH,
    details: {
      runtimeInstanceId: runtimeInstance.id,
      packageId: runtimeInstance.packageId,
      ...details,
    },
  })

const assertDeploymentSnapshotEvidence = async ({ runtimeInstance, frameworkPackage }) => {
  const evidence = getRuntimeEvidence(runtimeInstance)
  const missingEvidence = Object.entries(evidence)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missingEvidence.length > 0) {
    throw createSnapshotMismatchError({
      runtimeInstance,
      message: 'Runtime renderer requires immutable deployment and snapshot evidence.',
      details: { missingEvidence },
    })
  }

  const [deployment, activationSnapshot] = await Promise.all([
    RuntimeDeployment.findOne({
      deploymentId: evidence.deploymentId,
      activationId: evidence.activationId,
      packageId: runtimeInstance.packageId,
      frameworkKey: runtimeInstance.frameworkKey,
    }).lean(),
    RuntimeActivationSnapshot.findOne({
      activationId: evidence.activationId,
      deploymentId: evidence.deploymentId,
      packageId: runtimeInstance.packageId,
    }).lean(),
  ])

  if (!deployment || !activationSnapshot) {
    throw createSnapshotMismatchError({
      runtimeInstance,
      message: 'Runtime renderer could not resolve immutable deployment snapshot evidence.',
      details: {
        deploymentId: evidence.deploymentId,
        activationId: evidence.activationId,
        deploymentFound: Boolean(deployment),
        activationSnapshotFound: Boolean(activationSnapshot),
      },
    })
  }

  const mismatches = []
  if (toIdString(deployment.packageId) !== toIdString(runtimeInstance.packageId)) mismatches.push('deployment.packageId')
  if (toIdString(activationSnapshot.packageId) !== toIdString(runtimeInstance.packageId)) mismatches.push('activationSnapshot.packageId')
  if (normalizeToken(deployment.frameworkKey) !== normalizeToken(runtimeInstance.frameworkKey)) mismatches.push('deployment.frameworkKey')
  if (normalizeToken(activationSnapshot.frameworkKey) !== normalizeToken(runtimeInstance.frameworkKey)) mismatches.push('activationSnapshot.frameworkKey')
  if (!RENDERABLE_DEPLOYMENT_STATUSES.has(normalizeToken(deployment.status))) mismatches.push('deployment.status')
  if (!RENDERABLE_ACTIVATION_STATUSES.has(normalizeToken(activationSnapshot.activationStatus))) mismatches.push('activationSnapshot.activationStatus')
  if (String(deployment.packageKey || '') !== String(runtimeInstance.packageKey || '')) mismatches.push('deployment.packageKey')
  if (String(activationSnapshot.packageKey || '') !== String(runtimeInstance.packageKey || '')) mismatches.push('activationSnapshot.packageKey')
  if (String(deployment.frameworkVersion || '') !== String(runtimeInstance.packageVersion || frameworkPackage.version || '')) mismatches.push('deployment.frameworkVersion')
  if (String(activationSnapshot.frameworkVersion || '') !== String(runtimeInstance.packageVersion || frameworkPackage.version || '')) mismatches.push('activationSnapshot.frameworkVersion')
  if (String(activationSnapshot.dependencySnapshotId || '').trim() !== evidence.dependencySnapshotId) mismatches.push('activationSnapshot.dependencySnapshotId')
  if (String(activationSnapshot.dependencySnapshotHash || '').trim() !== evidence.dependencySnapshotHash) mismatches.push('activationSnapshot.dependencySnapshotHash')

  if (mismatches.length > 0) {
    throw createSnapshotMismatchError({
      runtimeInstance,
      message: 'Runtime renderer snapshot evidence does not match immutable activation evidence.',
      details: {
        deploymentId: evidence.deploymentId,
        activationId: evidence.activationId,
        dependencySnapshotId: evidence.dependencySnapshotId,
        mismatches,
      },
    })
  }
}

const resolvePackage = async ({ runtimeInstance }) => {
  const frameworkPackage = toPlainObject(await FrameworkPackage.findById(runtimeInstance.packageId))

  if (!frameworkPackage) {
    throw createRuntimeRendererError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Framework package not found for runtime renderer.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.PACKAGE_NOT_FOUND,
      details: {
        runtimeInstanceId: runtimeInstance.id,
        packageId: runtimeInstance.packageId,
      },
    })
  }

  if (normalizeToken(frameworkPackage.frameworkKey) !== normalizeToken(runtimeInstance.frameworkKey)) {
    throw createRuntimeRendererError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Framework package does not match the runtime instance framework.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.PACKAGE_FRAMEWORK_MISMATCH,
      details: {
        runtimeInstanceId: runtimeInstance.id,
        packageId: runtimeInstance.packageId,
        runtimeFrameworkKey: runtimeInstance.frameworkKey,
        packageFrameworkKey: frameworkPackage.frameworkKey,
      },
    })
  }

  if (frameworkPackage.status !== FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
    throw createRuntimeRendererError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime renderer requires an ACTIVE framework package.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.PACKAGE_NOT_ACTIVE,
      details: {
        runtimeInstanceId: runtimeInstance.id,
        packageId: runtimeInstance.packageId,
        packageStatus: frameworkPackage.status,
      },
    })
  }

  await assertDeploymentSnapshotEvidence({ runtimeInstance, frameworkPackage })

  return frameworkPackage
}

const resolveUIContract = async ({ frameworkPackage }) => {
  const packageSections = Array.isArray(frameworkPackage.sections) ? frameworkPackage.sections : []
  const uiContractKey = normalizeKey(frameworkPackage.uiContractBinding?.key || frameworkPackage.uiContractKey)

  if (packageSections.length > 0 && !uiContractKey) {
    throw createRuntimeRendererError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime renderer requires a UI Contract for packages with sections.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.UI_CONTRACT_REQUIRED,
      details: {
        packageId: toIdString(frameworkPackage._id || frameworkPackage.id),
        packageKey: frameworkPackage.packageKey,
      },
    })
  }

  if (!uiContractKey) return null

  const uiContract = await UIContract.findOne({
    uiContractKey,
    status: UI_CONTRACT_STATUSES.ACTIVE,
    frameworkKeys: normalizeToken(frameworkPackage.frameworkKey),
  }).lean()

  if (!uiContract) {
    throw createRuntimeRendererError({
      status: 409,
      code: 'CONFLICT',
      message: 'Active UI Contract could not be resolved for runtime renderer.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.UI_CONTRACT_NOT_FOUND,
      details: {
        packageId: toIdString(frameworkPackage._id || frameworkPackage.id),
        packageKey: frameworkPackage.packageKey,
        uiContractKey,
      },
    })
  }

  return uiContract
}

const resolveRuntimePathRecords = async ({ frameworkPackage }) => {
  const runtimePaths = (Array.isArray(frameworkPackage.sections) ? frameworkPackage.sections : [])
    .map((section) => String(section?.runtimePath || '').trim())
    .filter(Boolean)

  if (runtimePaths.length === 0) return new Map()

  const rows = await RuntimePathRegistry.find({
    pathKey: { $in: [...new Set(runtimePaths)] },
    status: RUNTIME_PATH_REGISTRY_STATUSES.ACTIVE,
    frameworkKeys: normalizeToken(frameworkPackage.frameworkKey || VMF_FRAMEWORK_KEY),
  }).lean()

  return new Map(
    (Array.isArray(rows) ? rows : [])
      .map((row) => [String(row?.pathKey || '').trim(), row]),
  )
}

const buildSectionIndex = (uiContract) => {
  const sections = Array.isArray(uiContract?.sections) ? uiContract.sections : []
  const byExactKey = new Map()
  const packageSectionKeys = new Set()

  sections.forEach((section) => {
    const sectionKey = normalizeKey(section?.sectionKey)
    const runtimePath = String(section?.runtimePath || '').trim()
    if (!sectionKey) return
    if (!section.isCustom) packageSectionKeys.add(sectionKey)
    if (runtimePath) byExactKey.set(`${sectionKey}::${runtimePath}`, section)
  })

  return { byExactKey, packageSectionKeys, sections }
}

const buildRendererSections = ({
  frameworkPackage,
  runtimeInstance,
  runtimePathRecords,
  uiContract,
  configWarnings,
}) => {
  const packageSections = Array.isArray(frameworkPackage.sections) ? frameworkPackage.sections : []
  const { byExactKey, sections: uiSections } = buildSectionIndex(uiContract)
  const packageSectionKeys = new Set()
  const frameworkState = runtimeInstance.framework_state || {}
  const runtimeEditable = isRuntimeEditable(runtimeInstance)
  const renderedSections = []

  packageSections.forEach((packageSection, packageIndex) => {
    const sectionKey = normalizeKey(packageSection?.sectionKey)
    const runtimePath = String(packageSection?.runtimePath || '').trim()
    if (sectionKey) packageSectionKeys.add(sectionKey)

    if (!sectionKey) return

    if (!runtimePath) {
      configWarnings.push(createConfigWarning({
        code: CONFIG_WARNING_CODES.PACKAGE_SECTION_MISSING_RUNTIME_PATH,
        message: 'Package section is missing a runtime path and cannot be rendered.',
        sectionKey,
      }))
      return
    }

    const runtimePathRecord = runtimePathRecords.get(runtimePath)
    if (!runtimePathRecord) {
      configWarnings.push(createConfigWarning({
        code: CONFIG_WARNING_CODES.RUNTIME_PATH_NOT_FOUND,
        message: 'Package section runtime path is not registered and cannot be rendered.',
        sectionKey,
        runtimePath,
      }))
      return
    }

    const allowedOperations = Array.isArray(runtimePathRecord.allowedOperations)
      ? runtimePathRecord.allowedOperations.map(normalizeToken)
      : []

    if (!allowedOperations.includes(RUNTIME_PATH_REGISTRY_OPERATIONS.READ)) {
      configWarnings.push(createConfigWarning({
        code: CONFIG_WARNING_CODES.RUNTIME_PATH_NOT_READABLE,
        message: 'Package section runtime path does not allow READ and cannot be rendered.',
        sectionKey,
        runtimePath,
      }))
      return
    }

    const uiSection = byExactKey.get(`${sectionKey}::${runtimePath}`) || null
    if (!uiSection) {
      configWarnings.push(createConfigWarning({
        code: CONFIG_WARNING_CODES.UI_CONTRACT_SECTION_MISSING,
        message: 'Runtime path is missing a UI Contract section; fallback presentation was applied.',
        sectionKey,
        runtimePath,
      }))
    }

    const uiVisible = uiSection?.isVisible !== false
    const uiEditable = uiSection?.isEditable !== false && uiSection?.isReadOnlyDisplay !== true
    const pathWritable = allowedOperations.includes(RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE)
    const editable = Boolean(runtimeEditable && uiEditable && pathWritable)
    const validationKeys = Array.isArray(packageSection.validationKeys)
      ? packageSection.validationKeys.map((key) => String(key || '').trim()).filter(Boolean)
      : []

    renderedSections.push({
      key: sectionKey,
      sectionKey,
      runtimePath,
      label: uiSection?.label || runtimePathRecord.label || titleFromKey(sectionKey),
      shortLabel: uiSection?.shortLabel || '',
      control: resolveControlType(runtimePathRecord),
      dataType: normalizeToken(runtimePathRecord.dataType),
      allowedValues: Array.isArray(runtimePathRecord.allowedValues) ? runtimePathRecord.allowedValues : [],
      allowedValueLabels: runtimePathRecord.allowedValueLabels || {},
      required: Boolean(packageSection.required),
      helpText: uiSection?.helpText || runtimePathRecord.helpText || '',
      placeholder: uiSection?.placeholder || runtimePathRecord.placeholderText || '',
      value: getRuntimePathValue(frameworkState, runtimePath) ?? runtimePathRecord.defaultValue ?? '',
      validationKeys,
      validationMessages: buildSectionValidationMessages({ frameworkState, validationKeys }),
      editable,
      visible: uiVisible,
      readonlyReason: editable ? '' : 'Renderer editability is governed by runtime status, execution status, UI Contract, and runtime path operations.',
      allowedOperations,
      source: {
        package: true,
        runtimePath: true,
        uiContract: Boolean(uiSection),
      },
      displayOrder: Number.isFinite(Number(uiSection?.displayOrder))
        ? Number(uiSection.displayOrder)
        : Number.isFinite(Number(runtimePathRecord.displayOrder))
          ? Number(runtimePathRecord.displayOrder)
          : (packageIndex + 1) * 10,
      sectionGroup: uiSection?.sectionGroup || '',
      presentationKey: uiSection?.presentationKey || '',
      collapsedByDefault: Boolean(uiSection?.isCollapsedByDefault),
    })
  })

  uiSections.forEach((uiSection) => {
    const sectionKey = normalizeKey(uiSection?.sectionKey)
    if (!sectionKey || uiSection?.isCustom === true) return
    if (packageSectionKeys.has(sectionKey)) return

    configWarnings.push(createConfigWarning({
      code: CONFIG_WARNING_CODES.UI_CONTRACT_SECTION_ORPHANED,
      message: 'UI Contract section is not present in the package and was ignored.',
      sectionKey,
      runtimePath: uiSection.runtimePath,
    }))
  })

  return renderedSections
    .filter((section) => section.visible)
    .sort((left, right) => left.displayOrder - right.displayOrder || left.sectionKey.localeCompare(right.sectionKey))
}

const resolveWorkflowPolicies = async ({ frameworkPackage }) => {
  const workflowBindings = Array.isArray(frameworkPackage.workflowBindings)
    ? frameworkPackage.workflowBindings.filter((binding) => binding?.enabled !== false)
    : []
  const policyKeys = [...new Set(
    workflowBindings
      .map((binding) => normalizeKey(binding?.policyKey))
      .filter(Boolean),
  )]

  if (policyKeys.length === 0) {
    return { policies: [], bindingByPolicyKey: new Map() }
  }

  const rows = await WorkflowPolicy.find({
    key: { $in: policyKeys },
    status: WORKFLOW_POLICY_STATUSES.ACTIVE,
    frameworkKeys: normalizeToken(frameworkPackage.frameworkKey || VMF_FRAMEWORK_KEY),
  }).lean()

  const bindingByPolicyKey = new Map(
    workflowBindings.map((binding) => [normalizeKey(binding?.policyKey), binding]),
  )

  return {
    policies: Array.isArray(rows) ? rows : [],
    bindingByPolicyKey,
  }
}

const isExecutablePolicyDecision = (decisionMode) =>
  normalizeToken(decisionMode) === WORKFLOW_POLICY_DECISION_MODES.ALLOW

const getDefaultRuntimeActionPermission = ({ runtimeInstance, governedAction }) => {
  const runtimeType = normalizeToken(runtimeInstance?.runtimeType)
  const actionToken = normalizeToken(governedAction)
  const isMutatingAction = MUTATING_RUNTIME_ACTIONS.has(actionToken)

  if (runtimeType === RUNTIME_TYPES.DEAL_ANALYSIS) {
    return isMutatingAction ? 'DEAL_UPDATE' : 'DEAL_VIEW'
  }

  return isMutatingAction ? 'VMF_UPDATE' : 'VMF_VIEW'
}

const getActionAccess = ({ action, runtimeInstance, scopes, governedAction }) => {
  const requiredPermissions = uniqueTokens(
    action?.requiredPermissions
    || action?.permissions
    || [getDefaultRuntimeActionPermission({ runtimeInstance, governedAction })],
  )
  const rolesAllowed = uniqueTokens(action?.rolesAllowed)
  const actorRoleKeys = getRuntimeRoleKeys({ scopes, runtimeInstance })
  const hasAllowedRole = rolesAllowed.length === 0
    || rolesAllowed.some((roleKey) => actorRoleKeys.includes(roleKey))
  const hasRequiredPermissions = requiredPermissions.every((permission) =>
    hasRuntimePermission({ scopes, runtimeInstance, permission }),
  )

  return {
    allowed: hasAllowedRole && hasRequiredPermissions,
    requiredPermissions,
    rolesAllowed,
  }
}

const buildRendererAction = ({
  action,
  policy,
  policyBinding,
  conditionResult,
  actionAccess,
  warningCode,
}) => {
  const governedAction = normalizeToken(action?.governedAction || policy?.governedAction || action?.actionKey || policy?.key)
  const actionKey = normalizeToken(action?.actionKey || governedAction || policy?.key)
  const policyKey = normalizeKey(policy?.key || policyBinding?.policyKey)
  const decisionMode = normalizeToken(policy?.decisionMode || WORKFLOW_POLICY_DECISION_MODES.ALLOW)
  const policyExecutable = Boolean(policy && isExecutablePolicyDecision(decisionMode))
  const actionVisible = action?.isVisible !== false
  const outputEnabled = Boolean(actionVisible && policyExecutable && conditionResult && actionAccess?.allowed)
  const disabledReason = !actionVisible
    ? 'Action is hidden by the UI Contract.'
    : !policy
      ? 'Action availability requires a matching active workflow policy.'
      : !policyExecutable
        ? 'Workflow policy decision mode is not executable by the renderer.'
        : !conditionResult
          ? 'Workflow policy runtime conditions are not currently satisfied.'
          : actionAccess?.allowed === false
            ? 'Current role or permissions do not allow this runtime action.'
            : 'Action availability is governed by active workflow policies and runtime state conditions.'

  return {
    actionKey,
    governedAction,
    buttonLabel: action?.buttonLabel || titleFromKey(governedAction || policyKey),
    enabled: outputEnabled,
    disabledReason: outputEnabled ? '' : disabledReason,
    requiresConfirmation: Boolean(action?.requiresConfirmation || action?.confirmationMessage),
    confirmationTitle: action?.confirmationTitle || '',
    confirmationMessage: action?.confirmationMessage || '',
    successMessage: action?.successMessage || policy?.passMessage || '',
    failureMessage: action?.failureMessage || policy?.failMessage || '',
    loadingMessage: action?.loadingMessage || '',
    triggerEvent: normalizeToken(policy?.triggerEvent),
    policyKey,
    policyDecisionMode: decisionMode,
    requiredPermissions: actionAccess?.requiredPermissions || [],
    rolesAllowed: actionAccess?.rolesAllowed || [],
    displayOrder: Number.isFinite(Number(action?.displayOrder))
      ? Number(action.displayOrder)
      : Number.isFinite(Number(policyBinding?.priority))
        ? Number(policyBinding.priority)
        : Number.isFinite(Number(policy?.priority))
          ? Number(policy.priority)
          : 1000,
    source: {
      uiContract: Boolean(action),
      workflowPolicy: Boolean(policy),
    },
    warnings: warningCode
      ? [warningCode]
      : [],
  }
}

const buildRendererActions = ({
  uiContract,
  workflowPolicies,
  bindingByPolicyKey,
  runtimeContext,
  runtimeInstance,
  scopes,
  configWarnings,
}) => {
  const uiActions = Array.isArray(uiContract?.actions)
    ? uiContract.actions.filter((action) => action?.isVisible !== false)
    : []
  const policyByGovernedAction = new Map()

  workflowPolicies.forEach((policy) => {
    const governedAction = normalizeToken(policy?.governedAction)
    if (!governedAction) return
    const existing = policyByGovernedAction.get(governedAction)
    if (!existing || Number(policy.priority || 1000) < Number(existing.priority || 1000)) {
      policyByGovernedAction.set(governedAction, policy)
    }
  })

  const renderedActions = uiActions.map((action) => {
    const governedAction = normalizeToken(action?.governedAction || action?.actionKey)
    const policy = policyByGovernedAction.get(governedAction) || null
    const policyBinding = bindingByPolicyKey.get(normalizeKey(policy?.key)) || null
    const conditionResult = policy ? evaluatePolicyConditions({ policy, runtimeContext }) : false
    const actionAccess = getActionAccess({
      action,
      runtimeInstance,
      scopes,
      governedAction,
    })

    if (!policy) {
      configWarnings.push(createConfigWarning({
        code: CONFIG_WARNING_CODES.ACTION_POLICY_MISSING,
        message: 'UI Contract action has no matching active workflow policy and was disabled.',
        actionKey: normalizeToken(action?.actionKey),
        governedAction,
      }))
    }

    return buildRendererAction({
      action,
      policy,
      policyBinding,
      conditionResult,
      actionAccess,
      warningCode: policy ? '' : CONFIG_WARNING_CODES.ACTION_POLICY_MISSING,
    })
  })

  const uiGovernedActions = new Set(
    uiActions.map((action) => normalizeToken(action?.governedAction || action?.actionKey)).filter(Boolean),
  )

  workflowPolicies.forEach((policy) => {
    const governedAction = normalizeToken(policy?.governedAction)
    if (!governedAction || uiGovernedActions.has(governedAction)) return

    configWarnings.push(createConfigWarning({
      code: CONFIG_WARNING_CODES.POLICY_ACTION_MISSING,
      message: 'Active workflow policy has no UI Contract action and was not rendered.',
      governedAction,
      policyKey: policy.key,
    }))
  })

  return renderedActions
    .sort((left, right) => left.displayOrder - right.displayOrder || left.actionKey.localeCompare(right.actionKey))
}

const resolveAnchorRuntimeInstance = async (anchor) => {
  const anchorRuntimeInstanceId = toIdString(anchor?.runtimeInstanceId)
  const anchorRuntimeInstanceKey = normalizeKey(anchor?.runtimeInstanceKey)
  const anchorQuery = {
    $or: [
      ...(mongoose.isValidObjectId(anchorRuntimeInstanceId) ? [{ _id: anchorRuntimeInstanceId }] : []),
      ...(anchorRuntimeInstanceKey ? [{ runtimeInstanceKey: anchorRuntimeInstanceKey }] : []),
    ],
  }

  if (anchorQuery.$or.length === 0) return null

  return RuntimeInstance.findOne(anchorQuery).lean()
}

const isDealAnalysisAnchorShape = (anchor) =>
  normalizeToken(anchor?.runtimeType) === RUNTIME_TYPES.VALUE_NARRATIVE
  && DEAL_ANALYSIS_ANCHOR_RELATIONSHIPS.has(normalizeToken(anchor?.relationship))
  && Boolean(anchor?.lockedAt)

const assertDealAnalysisAnchorRenderable = async (runtimeInstance) => {
  const anchors = Array.isArray(runtimeInstance.anchors) ? runtimeInstance.anchors : []
  const anchor = anchors.find(isDealAnalysisAnchorShape)

  if (!anchor) {
    throw createRuntimeRendererError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Deal Analysis rendering requires a locked VMF runtime anchor.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.DEAL_ANALYSIS_ANCHOR_REQUIRED,
      details: {
        runtimeInstanceId: runtimeInstance.id,
        runtimeType: runtimeInstance.runtimeType,
        anchorReason: 'LOCKED_VALUE_NARRATIVE_ANCHOR_REQUIRED',
      },
    })
  }

  const anchorRuntimeInstance = await resolveAnchorRuntimeInstance(anchor)
  const anchorEvidence = getRuntimeEvidence(anchorRuntimeInstance || {})
  const missingAnchorEvidence = Object.entries(anchorEvidence)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  const anchorChecks = {
    found: Boolean(anchorRuntimeInstance),
    runtimeType: normalizeToken(anchorRuntimeInstance?.runtimeType) === RUNTIME_TYPES.VALUE_NARRATIVE,
    frameworkKey: normalizeToken(anchorRuntimeInstance?.frameworkKey) === VMF_FRAMEWORK_KEY,
    customerId: toIdString(anchorRuntimeInstance?.customerId) === toIdString(runtimeInstance.customerId),
    tenantId: toIdString(anchorRuntimeInstance?.tenantId) === toIdString(runtimeInstance.tenantId),
    status: normalizeToken(anchorRuntimeInstance?.status) === RUNTIME_INSTANCE_STATUSES.LOCKED,
    evidence: missingAnchorEvidence.length === 0,
  }
  const failedChecks = Object.entries(anchorChecks)
    .filter(([, passed]) => !passed)
    .map(([key]) => key)

  if (failedChecks.length > 0) {
    throw createRuntimeRendererError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Deal Analysis rendering requires a locked VMF runtime anchor in the same tenant scope.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.DEAL_ANALYSIS_ANCHOR_REQUIRED,
      details: {
        runtimeInstanceId: runtimeInstance.id,
        runtimeType: runtimeInstance.runtimeType,
        anchorRuntimeInstanceId: toIdString(anchor.runtimeInstanceId),
        anchorRuntimeInstanceKey: anchor.runtimeInstanceKey || '',
        failedChecks,
        missingAnchorEvidence,
      },
    })
  }
}

const assertRuntimeTypeRenderable = async (runtimeInstance) => {
  const runtimeType = normalizeToken(runtimeInstance.runtimeType)

  if (runtimeType === RUNTIME_TYPES.DEAL_ANALYSIS) {
    await assertDealAnalysisAnchorRenderable(runtimeInstance)
  }
}

const buildRendererRuntimeInstance = (runtimeInstance) => {
  const { framework_state: _frameworkState, ...safeRuntimeInstance } = runtimeInstance || {}
  return safeRuntimeInstance
}

const buildRuntimeDataProjection = (sections) => ({
  readablePaths: (Array.isArray(sections) ? sections : []).map((section) => ({
    sectionKey: section.sectionKey,
    runtimePath: section.runtimePath,
    value: section.value,
  })),
})

const buildValidationProjection = ({ frameworkState, sections }) => ({
  state: deriveValidationState(frameworkState),
  messages: (Array.isArray(sections) ? sections : [])
    .flatMap((section) => Array.isArray(section.validationMessages) ? section.validationMessages : []),
})

export const getRuntimeRenderer = async ({
  scopes,
  runtimeInstanceId,
} = {}) => {
  const runtimeInstance = await getRuntimeInstance({ scopes, runtimeInstanceId })
  await assertRuntimeTypeRenderable(runtimeInstance)

  const frameworkPackage = await resolvePackage({ runtimeInstance })
  const [uiContract, runtimePathRecords, workflowPolicyContext] = await Promise.all([
    resolveUIContract({ frameworkPackage }),
    resolveRuntimePathRecords({ frameworkPackage }),
    resolveWorkflowPolicies({ frameworkPackage }),
  ])
  const configWarnings = []
  const runtimeContext = buildRuntimeContext(runtimeInstance)
  const sections = buildRendererSections({
    frameworkPackage,
    runtimeInstance,
    runtimePathRecords,
    uiContract,
    configWarnings,
  })
  const actions = buildRendererActions({
    uiContract,
    workflowPolicies: workflowPolicyContext.policies,
    bindingByPolicyKey: workflowPolicyContext.bindingByPolicyKey,
    runtimeContext,
    runtimeInstance,
    scopes,
    configWarnings,
  })
  const frameworkState = runtimeInstance.framework_state || {}
  const workspaceId = runtimeInstance.workspaceId || runtimeInstance.id

  return {
    rendererContractVersion: RUNTIME_RENDERER_CONTRACT_VERSION,
    runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
    projectionGeneratedAt: new Date().toISOString(),
    runtimeInstance: buildRendererRuntimeInstance(runtimeInstance),
    workspace: {
      workspaceId,
      workspaceKey: runtimeInstance.workspaceId || runtimeInstance.runtimeInstanceKey || runtimeInstance.id,
      routeKey: runtimeInstance.id,
    },
    package: {
      packageId: toIdString(frameworkPackage._id || frameworkPackage.id),
      packageKey: frameworkPackage.packageKey,
      packageName: frameworkPackage.packageName,
      frameworkKey: frameworkPackage.frameworkKey,
      frameworkVersion: frameworkPackage.version,
      deploymentId: runtimeInstance.deploymentId,
      activationId: runtimeInstance.activationId,
      snapshotId: runtimeInstance.dependencyLockId || runtimeInstance.evidence?.dependencySnapshotId || '',
      uiContractKey: normalizeKey(frameworkPackage.uiContractBinding?.key || frameworkPackage.uiContractKey),
    },
    lifecycle: {
      runtimeStatus: runtimeInstance.status,
      executionStatus: runtimeInstance.executionStatus,
      runtimeMode: runtimeInstance.runtimeMode,
      stage: frameworkState.lifecycle?.stage || 'DRAFT',
    },
    sections,
    actions,
    validation: buildValidationProjection({ frameworkState, sections }),
    signals: [],
    activity: [],
    runtimeData: buildRuntimeDataProjection(sections),
    diagnostics: {
      renderTraceId: `render-${randomUUID()}`,
      configWarnings,
      configErrors: [],
    },
  }
}

const runtimeRendererService = {
  getRuntimeRenderer,
}

export default runtimeRendererService
