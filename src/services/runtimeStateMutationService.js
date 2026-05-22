import mongoose from 'mongoose'
import RuntimePathRegistry, {
  RUNTIME_PATH_REGISTRY_DATA_TYPES,
  RUNTIME_PATH_REGISTRY_OPERATIONS,
} from '../models/RuntimePathRegistry.js'
import RuntimeInstance, {
  RUNTIME_EXECUTION_STATUSES,
  RUNTIME_INSTANCE_STATUSES,
  RUNTIME_TYPES,
} from '../models/RuntimeInstance.js'
import auditService from './auditService.js'
import {
  RUNTIME_INSTANCE_ERROR_REASONS,
  assertCustomerTenantContext,
  assertFeatureEntitlement,
  assertRuntimePermission,
  createRuntimeInstanceError,
  getFeatureForRuntimeType,
  normalizeToken,
  toIdString,
} from './runtimeInstanceService.js'
import {
  getRuntimeSectionInput,
  invalidateRuntimeSectionEvidence,
  normalizeRuntimeSectionObject,
} from './runtimeSectionModelService.js'
import { validateRuntimeMutation } from './runtimeValidation/runtimeMutationValidator.js'
import {
  isRuntimeLifecycleTruthImmutable,
  isRuntimeLocked,
  normalizeFrameworkStateForAction,
  normalizeRuntimeActionToken,
} from './runtimeActionPolicyService.js'

const SECTION_WRITE_SCOPE = 'framework_state.sections.*'
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

const cloneValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const normalizeRuntimePath = (value) => String(value || '').trim()

const buildMutationError = ({
  status,
  code,
  message,
  reason,
  details = {},
}) => createRuntimeInstanceError({
  status,
  code,
  message,
  reason,
  details,
})

const getValueAtPath = (source, pathParts) => {
  let cursor = source
  for (const part of pathParts) {
    if (
      cursor === null
      || cursor === undefined
      || typeof cursor !== 'object'
      || !Object.prototype.hasOwnProperty.call(cursor, part)
    ) {
      return undefined
    }
    cursor = cursor[part]
  }
  return cursor
}

const assertSafeRuntimePathParts = (runtimePath) => {
  const pathParts = normalizeRuntimePath(runtimePath).split('.').filter(Boolean)

  if (
    pathParts.length < 3
    || pathParts[0] !== 'framework_state'
    || pathParts[1] !== 'sections'
  ) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime mutation path is outside the Sprint 1 writable section scope.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_FORBIDDEN_PATH,
      details: { runtimePath, allowedScope: SECTION_WRITE_SCOPE },
    })
  }

  const unsafeSegment = pathParts.find((part) => FORBIDDEN_PATH_SEGMENTS.has(part))
  if (unsafeSegment) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime mutation path contains an unsafe segment.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_INVALID_PATH,
      details: { runtimePath, unsafeSegment },
    })
  }

  return pathParts
}

const setValueAtPath = ({ frameworkState, runtimePath, value }) => {
  const pathParts = assertSafeRuntimePathParts(runtimePath)
  const mutableState = cloneValue(frameworkState || {})
  let cursor = mutableState

  pathParts.slice(1, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {}
    }
    cursor = cursor[part]
  })

  const leafKey = pathParts[pathParts.length - 1]
  const previousRawValue = getValueAtPath({ framework_state: frameworkState || {} }, pathParts)
  const isSectionRootWrite = pathParts.length === 3
  const nextValue = isSectionRootWrite
    ? {
        ...normalizeRuntimeSectionObject({
          value: previousRawValue,
          sectionKey: leafKey,
          runtimePath,
        }),
        input: cloneValue(value),
      }
    : value

  cursor[leafKey] = nextValue

  return {
    nextFrameworkState: mutableState,
    previousValue: cloneValue(isSectionRootWrite ? getRuntimeSectionInput(previousRawValue) : previousRawValue),
  }
}

const invalidateSectionMutationEvidence = ({ nextFrameworkState, runtimePath }) =>
  invalidateRuntimeSectionEvidence({ frameworkState: nextFrameworkState, runtimePath })

const assertRuntimeEditable = (runtimeInstance) => {
  const runtimeStatus = normalizeToken(runtimeInstance?.status)
  const executionStatus = normalizeToken(runtimeInstance?.executionStatus)
  const frameworkState = normalizeFrameworkStateForAction(runtimeInstance?.framework_state)
  const lifecycleStage = normalizeRuntimeActionToken(frameworkState.lifecycle?.stage)

  if (isRuntimeLocked({ runtimeInstance })) {
    throw buildMutationError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime instance is locked and cannot be mutated.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_NOT_EDITABLE,
      details: {
        runtimeStatus,
        lockedAt: runtimeInstance?.lockedAt || runtimeInstance?.framework_state?.lock?.lockedAt || null,
      },
    })
  }

  if (isRuntimeLifecycleTruthImmutable(frameworkState)) {
    throw buildMutationError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime lifecycle truth is approved or published and cannot be directly mutated.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_NOT_EDITABLE,
      details: {
        lifecycleStage,
        immutableLifecycleStages: ['APPROVED', 'PUBLISHED', 'LOCKED'],
      },
    })
  }

  if (runtimeStatus !== RUNTIME_INSTANCE_STATUSES.ACTIVE) {
    throw buildMutationError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime instance is not editable in its current status.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_NOT_EDITABLE,
      details: {
        runtimeStatus,
        editableStatuses: [RUNTIME_INSTANCE_STATUSES.ACTIVE],
      },
    })
  }

  const blockedExecutionStatuses = [
    RUNTIME_EXECUTION_STATUSES.RUNNING,
    RUNTIME_EXECUTION_STATUSES.VALIDATING,
    RUNTIME_EXECUTION_STATUSES.COMPLETE,
    RUNTIME_EXECUTION_STATUSES.ERROR,
  ]

  if (blockedExecutionStatuses.includes(executionStatus)) {
    throw buildMutationError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime instance is not editable while execution is in progress or terminal.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_NOT_EDITABLE,
      details: {
        executionStatus,
        blockedExecutionStatuses,
      },
    })
  }
}

const buildStaleMutationError = ({ runtimeInstance, expectedUpdatedAt, currentUpdatedAt }) =>
  buildMutationError({
    status: 409,
    code: 'CONFLICT',
    message: 'Runtime instance has changed since the renderer projection was loaded.',
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_STALE,
    details: {
      expectedUpdatedAt,
      currentUpdatedAt: currentUpdatedAt ?? (
        runtimeInstance?.updatedAt instanceof Date
          ? runtimeInstance.updatedAt.toISOString()
          : runtimeInstance?.updatedAt
      ),
    },
  })

const assertExpectedUpdatedAt = ({ runtimeInstance, expectedUpdatedAt }) => {
  const expectedTime = new Date(expectedUpdatedAt).getTime()
  const currentTime = new Date(runtimeInstance.updatedAt).getTime()

  if (!Number.isFinite(expectedTime) || !Number.isFinite(currentTime) || expectedTime !== currentTime) {
    throw buildStaleMutationError({ runtimeInstance, expectedUpdatedAt })
  }
}

const assertSupportedMutationRuntimeType = (runtimeType) => {
  const normalizedRuntimeType = normalizeToken(runtimeType)
  if (normalizedRuntimeType === RUNTIME_TYPES.VALUE_NARRATIVE) return

  throw buildMutationError({
    status: 422,
    code: 'VALIDATION_FAILED',
    message: 'Runtime state mutation is only available for Value Narrative runtimes in Sprint 1.',
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_UNSUPPORTED_RUNTIME_TYPE,
    details: {
      runtimeType: normalizedRuntimeType,
      supportedRuntimeTypes: [RUNTIME_TYPES.VALUE_NARRATIVE],
    },
  })
}

const buildRuntimePathValueIssue = (message, runtimePath) => ({
  code: 'RUNTIME_PATH_VALUE_INVALID',
  severity: 'BLOCKING',
  message,
  path: 'value',
  runtimePath,
  source: 'runtime-state-mutation-service',
})

const validateRuntimePathValue = ({ runtimePathRecord, runtimePath, value }) => {
  const dataType = normalizeToken(runtimePathRecord?.dataType)
  const issues = []

  if (value === null) {
    if (runtimePathRecord?.isNullable === false) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" does not allow null values.`, runtimePath))
    }
    return issues
  }

  if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.STRING || dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.ENUM) {
    if (typeof value !== 'string') {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires a string value.`, runtimePath))
      return issues
    }

    const minLength = Number(runtimePathRecord?.minLength)
    const maxLength = Number(runtimePathRecord?.maxLength)
    if (Number.isFinite(minLength) && value.length < minLength) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires at least ${minLength} characters.`, runtimePath))
    }
    if (Number.isFinite(maxLength) && value.length > maxLength) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" must be ${maxLength} characters or fewer.`, runtimePath))
    }

    const allowedValues = Array.isArray(runtimePathRecord?.allowedValues)
      ? runtimePathRecord.allowedValues
      : []
    if (allowedValues.length > 0 && !allowedValues.includes(value)) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires one of its configured allowed values.`, runtimePath))
    }

    const regexPattern = String(runtimePathRecord?.regexPattern || '').trim()
    if (regexPattern) {
      try {
        if (!new RegExp(regexPattern).test(value)) {
          issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" value does not match its configured pattern.`, runtimePath))
        }
      } catch {
        issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" has an invalid configured value pattern.`, runtimePath))
      }
    }
  }

  if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.NUMBER) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires a numeric value.`, runtimePath))
      return issues
    }

    const minValue = Number(runtimePathRecord?.minValue)
    const maxValue = Number(runtimePathRecord?.maxValue)
    if (Number.isFinite(minValue) && value < minValue) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires a value greater than or equal to ${minValue}.`, runtimePath))
    }
    if (Number.isFinite(maxValue) && value > maxValue) {
      issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires a value less than or equal to ${maxValue}.`, runtimePath))
    }
  }

  if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.BOOLEAN && typeof value !== 'boolean') {
    issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires a boolean value.`, runtimePath))
  }

  if (
    dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.OBJECT
    && (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
    )
  ) {
    issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires an object value.`, runtimePath))
  }

  if (dataType === RUNTIME_PATH_REGISTRY_DATA_TYPES.ARRAY && !Array.isArray(value)) {
    issues.push(buildRuntimePathValueIssue(`Runtime path "${runtimePath}" requires an array value.`, runtimePath))
  }

  return issues
}

const resolveRuntimePathRecord = async (runtimePath) => {
  const query = RuntimePathRegistry.findOne({ pathKey: runtimePath })
  return typeof query.lean === 'function' ? query.lean() : query
}

const assertRuntimePathWritable = async ({ frameworkKey, runtimePath, value }) => {
  const issues = await validateRuntimeMutation({
    runtimePath,
    operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
    frameworkKey,
    allowedWriteScopes: [SECTION_WRITE_SCOPE],
  })

  if (issues.length > 0) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime state mutation path is not writable.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_INVALID_PATH,
      details: { runtimePath, issues },
    })
  }

  const runtimePathRecord = await resolveRuntimePathRecord(runtimePath)
  const valueIssues = validateRuntimePathValue({ runtimePathRecord, runtimePath, value })

  if (valueIssues.length > 0) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime state mutation value is invalid.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_INVALID_PATH,
      details: { runtimePath, issues: valueIssues },
    })
  }

  return runtimePathRecord
}

const resolveRuntimeInstanceForMutation = async ({ actorUserId, runtimeInstanceId, scopes }) => {
  const runtimeInstance = await RuntimeInstance.findOne({
    $or: [
      ...(mongoose.isValidObjectId(runtimeInstanceId) ? [{ _id: runtimeInstanceId }] : []),
      { runtimeInstanceKey: String(runtimeInstanceId || '').trim().toLowerCase() },
    ],
  })

  if (!runtimeInstance) {
    throw buildMutationError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Runtime instance not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_INSTANCE_NOT_FOUND,
      details: { runtimeInstanceId },
    })
  }

  const customerId = toIdString(runtimeInstance.customerId)
  const tenantId = toIdString(runtimeInstance.tenantId)
  const runtimeType = normalizeToken(runtimeInstance.runtimeType)

  assertSupportedMutationRuntimeType(runtimeType)

  await assertRuntimePermission({
    actorUserId,
    scopes,
    customerId,
    tenantId,
    permission: 'VMF_UPDATE',
  })

  const { customer } = await assertCustomerTenantContext({ customerId, tenantId })
  await assertFeatureEntitlement({
    customerId,
    customer,
    feature: getFeatureForRuntimeType(runtimeType),
  })

  return runtimeInstance
}

const buildMutationAuditPayload = ({
  actorUserId,
  runtimeInstance,
  runtimePath,
  previousValue,
  nextValue,
  expectedUpdatedAt,
  updatedAtBefore,
}) => ({
  action: auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED,
  resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
  resourceId: runtimeInstance._id,
  actorUserId,
  scope: {
    customerId: toIdString(runtimeInstance.customerId),
    tenantId: toIdString(runtimeInstance.tenantId),
    runtimeInstanceId: toIdString(runtimeInstance._id),
    runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
  },
  diff: {
    runtimePath,
    operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
    previousValue,
    nextValue,
    expectedUpdatedAt,
    updatedAtBefore,
    updatedAtAfter: runtimeInstance.updatedAt instanceof Date
      ? runtimeInstance.updatedAt.toISOString()
      : runtimeInstance.updatedAt,
    runtimeType: runtimeInstance.runtimeType,
    frameworkKey: runtimeInstance.frameworkKey,
    packageKey: runtimeInstance.packageKey,
    packageVersion: runtimeInstance.packageVersion,
  },
})

const logRuntimeStateMutated = async ({
  actorUserId,
  auditRequest,
  runtimeInstance,
  runtimePath,
  previousValue,
  nextValue,
  expectedUpdatedAt,
  updatedAtBefore,
  session = null,
}) => {
  const auditPayload = buildMutationAuditPayload({
    actorUserId,
    runtimeInstance,
    runtimePath,
    previousValue,
    nextValue,
    expectedUpdatedAt,
    updatedAtBefore,
  })
  const auditOptions = {
    throwOnError: true,
    ...(session ? { session } : {}),
  }

  try {
    if (auditRequest) {
      await auditService.logFromRequest(auditRequest, auditPayload, auditOptions)
      return
    }

    await auditService.log(auditPayload, auditOptions)
  } catch (err) {
    throw buildMutationError({
      status: 500,
      code: 'RUNTIME_STATE_MUTATION_AUDIT_FAILED',
      message: 'Runtime state mutation audit could not be persisted.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_AUDIT_PERSISTENCE_FAILED,
    })
  }
}

const normalizeUpdatedAtDate = (updatedAt) => {
  const updatedAtDate = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  return Number.isFinite(updatedAtDate.getTime()) ? updatedAtDate : null
}

const atomicPersistRuntimeState = async ({
  actorUserId,
  expectedUpdatedAt,
  nextFrameworkState,
  runtimeInstance,
  session = null,
}) => {
  const expectedUpdatedAtDate = normalizeUpdatedAtDate(expectedUpdatedAt)
  if (!expectedUpdatedAtDate) {
    throw buildStaleMutationError({ runtimeInstance, expectedUpdatedAt })
  }

  const updatedRuntimeInstance = await RuntimeInstance.findOneAndUpdate(
    {
      _id: runtimeInstance._id,
      updatedAt: expectedUpdatedAtDate,
    },
    {
      $set: {
        framework_state: nextFrameworkState,
        updatedBy: actorUserId || runtimeInstance.updatedBy || null,
      },
    },
    {
      new: true,
      runValidators: true,
      ...(session ? { session } : {}),
    },
  )

  if (!updatedRuntimeInstance) {
    throw buildStaleMutationError({ runtimeInstance, expectedUpdatedAt, currentUpdatedAt: null })
  }

  return updatedRuntimeInstance
}

const rollbackRuntimeStateMutation = async ({
  previousFrameworkState,
  previousUpdatedBy,
  runtimeInstance,
  updatedRuntimeInstance,
}) => {
  const rollbackUpdatedAt = normalizeUpdatedAtDate(updatedRuntimeInstance?.updatedAt)
  if (!rollbackUpdatedAt) return false

  const rolledBackRuntimeInstance = await RuntimeInstance.findOneAndUpdate(
    {
      _id: runtimeInstance._id,
      updatedAt: rollbackUpdatedAt,
    },
    {
      $set: {
        framework_state: previousFrameworkState,
        updatedBy: previousUpdatedBy || null,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  )

  return Boolean(rolledBackRuntimeInstance)
}

const persistMutationWithAudit = async ({
  actorUserId,
  auditRequest,
  runtimeInstance,
  nextFrameworkState,
  previousFrameworkState,
  previousUpdatedBy,
  runtimePath,
  previousValue,
  nextValue,
  expectedUpdatedAt,
  updatedAtBefore,
}) => {
  if (mongoose.connection.readyState === 1) {
    const session = await mongoose.startSession()
    let updatedRuntimeInstance = null
    try {
      await session.withTransaction(async () => {
        updatedRuntimeInstance = await atomicPersistRuntimeState({
          actorUserId,
          expectedUpdatedAt,
          nextFrameworkState,
          runtimeInstance,
          session,
        })
        await logRuntimeStateMutated({
          actorUserId,
          auditRequest,
          runtimeInstance: updatedRuntimeInstance,
          runtimePath,
          previousValue,
          nextValue,
          expectedUpdatedAt,
          updatedAtBefore,
          session,
        })
      })
    } finally {
      await session.endSession()
    }
    return updatedRuntimeInstance
  }

  const updatedRuntimeInstance = await atomicPersistRuntimeState({
    actorUserId,
    expectedUpdatedAt,
    nextFrameworkState,
    runtimeInstance,
  })

  try {
    await logRuntimeStateMutated({
      actorUserId,
      auditRequest,
      runtimeInstance: updatedRuntimeInstance,
      runtimePath,
      previousValue,
      nextValue,
      expectedUpdatedAt,
      updatedAtBefore,
    })
  } catch (err) {
    try {
      const rollbackSucceeded = await rollbackRuntimeStateMutation({
        previousFrameworkState,
        previousUpdatedBy,
        runtimeInstance,
        updatedRuntimeInstance,
      })
      if (!rollbackSucceeded) {
        err.details = {
          ...(err.details || {}),
          rollbackFailed: true,
        }
      }
    } catch {
      err.details = {
        ...(err.details || {}),
        rollbackFailed: true,
      }
    }
    throw err
  }

  return updatedRuntimeInstance
}

export const mutateRuntimeState = async ({
  actorUserId,
  auditRequest,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const runtimePath = normalizeRuntimePath(payload?.runtimePath)
  const operation = normalizeToken(payload?.operation)
  const value = payload?.value
  const expectedUpdatedAt = payload?.expectedUpdatedAt

  if (operation !== RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE) {
    throw buildMutationError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime state mutation only supports WRITE in Sprint 1.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_MUTATION_INVALID_PATH,
      details: { operation, supportedOperations: [RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE] },
    })
  }

  assertSafeRuntimePathParts(runtimePath)

  const runtimeInstance = await resolveRuntimeInstanceForMutation({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  assertRuntimeEditable(runtimeInstance)
  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })
  await assertRuntimePathWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    runtimePath,
    value,
  })

  const previousFrameworkState = cloneValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const { nextFrameworkState: frameworkStateAfterWrite, previousValue } = setValueAtPath({
    frameworkState: runtimeInstance.framework_state || {},
    runtimePath,
    value,
  })
  const nextFrameworkState = invalidateSectionMutationEvidence({
    nextFrameworkState: frameworkStateAfterWrite,
    runtimePath,
  })

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    auditRequest,
    runtimeInstance,
    nextFrameworkState,
    previousFrameworkState,
    previousUpdatedBy,
    runtimePath,
    previousValue,
    nextValue: cloneValue(value),
    expectedUpdatedAt,
    updatedAtBefore,
  })

  return {
    runtimeInstance: {
      id: toIdString(updatedRuntimeInstance._id),
      runtimeInstanceKey: updatedRuntimeInstance.runtimeInstanceKey,
      runtimeType: updatedRuntimeInstance.runtimeType,
      status: updatedRuntimeInstance.status,
      executionStatus: updatedRuntimeInstance.executionStatus,
      updatedAt: updatedRuntimeInstance.updatedAt instanceof Date
        ? updatedRuntimeInstance.updatedAt.toISOString()
        : updatedRuntimeInstance.updatedAt,
    },
    mutation: {
      runtimePath,
      operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
      previousValue,
      value: cloneValue(value),
    },
  }
}

const runtimeStateMutationService = {
  mutateRuntimeState,
}

export default runtimeStateMutationService
