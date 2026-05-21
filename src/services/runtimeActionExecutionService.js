import mongoose from 'mongoose'
import { FrameworkPackage, RuntimeInstance } from '../models/index.js'
import { RUNTIME_TYPES } from '../models/RuntimeInstance.js'
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
import { getRuntimeRenderer } from './runtimeRendererService.js'
import {
  buildRuntimeActionTransition,
  cloneRuntimeActionValue,
  getRuntimeActionStateGate,
  isSupportedSprint2RuntimeAction,
  normalizeRuntimeActionToken,
} from './runtimeActionPolicyService.js'

const buildActionError = ({
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

const normalizeUpdatedAtDate = (updatedAt) => {
  const updatedAtDate = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  return Number.isFinite(updatedAtDate.getTime()) ? updatedAtDate : null
}

const buildStaleActionError = ({ runtimeInstance, expectedUpdatedAt, currentUpdatedAt }) =>
  buildActionError({
    status: 409,
    code: 'CONFLICT',
    message: 'Runtime instance has changed since the action projection was loaded.',
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_STALE,
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
    throw buildStaleActionError({ runtimeInstance, expectedUpdatedAt })
  }
}

const resolveRuntimeInstanceDocument = async ({ runtimeInstanceId }) => {
  const runtimeInstance = await RuntimeInstance.findOne({
    $or: [
      ...(mongoose.isValidObjectId(runtimeInstanceId) ? [{ _id: runtimeInstanceId }] : []),
      { runtimeInstanceKey: String(runtimeInstanceId || '').trim().toLowerCase() },
    ],
  })

  if (!runtimeInstance) {
    throw buildActionError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Runtime instance not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_INSTANCE_NOT_FOUND,
      details: { runtimeInstanceId },
    })
  }

  return runtimeInstance
}

const assertSupportedRuntimeType = (runtimeInstance) => {
  const runtimeType = normalizeToken(runtimeInstance?.runtimeType)
  if (runtimeType === RUNTIME_TYPES.VALUE_NARRATIVE) return

  throw buildActionError({
    status: 422,
    code: 'VALIDATION_FAILED',
    message: 'Runtime action execution is only available for Value Narrative runtimes in Sprint 2.',
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_UNSUPPORTED_RUNTIME_TYPE,
    details: {
      runtimeType,
      supportedRuntimeTypes: [RUNTIME_TYPES.VALUE_NARRATIVE],
    },
  })
}

const assertActionSupported = (actionKey) => {
  if (isSupportedSprint2RuntimeAction(actionKey)) return

  throw buildActionError({
    status: 422,
    code: 'VALIDATION_FAILED',
    message: 'Runtime action is not supported in Sprint 2.',
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_UNSUPPORTED,
    details: {
      actionKey,
      supportedActions: [
        'SAVE_DRAFT',
        'RUN_VALIDATION',
        'MARK_READY',
        'SUBMIT_FOR_REVIEW',
        'RETURN_TO_DRAFT',
      ],
    },
  })
}

const resolveRendererAction = ({ renderer, actionKey }) => {
  const normalizedActionKey = normalizeRuntimeActionToken(actionKey)
  const action = (Array.isArray(renderer?.actions) ? renderer.actions : [])
    .find((candidate) =>
      normalizeRuntimeActionToken(candidate?.actionKey) === normalizedActionKey
      || normalizeRuntimeActionToken(candidate?.governedAction) === normalizedActionKey,
    )

  if (!action) {
    throw buildActionError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime action is not declared by the renderer projection.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_DECLARED,
      details: { actionKey: normalizedActionKey },
    })
  }

  if (!action.enabled) {
    throw buildActionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime action is not currently executable.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        actionKey: normalizedActionKey,
        disabledReason: action.disabledReason || 'Runtime action is disabled by server projection.',
      },
    })
  }

  return action
}

const buildActionAuditPayload = ({
  action,
  actionedAt,
  actorUserId,
  expectedUpdatedAt,
  nextExecutionStatus,
  nextFrameworkState,
  previousExecutionStatus,
  previousFrameworkState,
  runtimeInstance,
  updatedAtBefore,
  validationResult,
}) => ({
  action: auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED,
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
    actionKey: normalizeRuntimeActionToken(action?.actionKey),
    governedAction: normalizeRuntimeActionToken(action?.governedAction || action?.actionKey),
    policyKey: action?.policyKey || '',
    expectedUpdatedAt,
    updatedAtBefore,
    updatedAtAfter: runtimeInstance.updatedAt instanceof Date
      ? runtimeInstance.updatedAt.toISOString()
      : runtimeInstance.updatedAt,
    runtimeType: runtimeInstance.runtimeType,
    frameworkKey: runtimeInstance.frameworkKey,
    packageKey: runtimeInstance.packageKey,
    packageVersion: runtimeInstance.packageVersion,
    executionStatus: {
      from: previousExecutionStatus,
      to: nextExecutionStatus,
    },
    lifecycle: {
      from: previousFrameworkState?.lifecycle || {},
      to: nextFrameworkState?.lifecycle || {},
    },
    readiness: {
      from: previousFrameworkState?.readiness || {},
      to: nextFrameworkState?.readiness || {},
    },
    ...(validationResult ? {
      validation: {
        key: validationResult.key,
        status: validationResult.status,
        is_valid: validationResult.is_valid,
        missingRequiredSections: validationResult.missingRequiredSections,
      },
    } : {}),
    actionedAt,
  },
})

const logRuntimeActionExecuted = async ({
  action,
  actionedAt,
  actorUserId,
  auditRequest,
  expectedUpdatedAt,
  nextExecutionStatus,
  nextFrameworkState,
  previousExecutionStatus,
  previousFrameworkState,
  runtimeInstance,
  updatedAtBefore,
  validationResult,
  session = null,
}) => {
  const auditPayload = buildActionAuditPayload({
    action,
    actionedAt,
    actorUserId,
    expectedUpdatedAt,
    nextExecutionStatus,
    nextFrameworkState,
    previousExecutionStatus,
    previousFrameworkState,
    runtimeInstance,
    updatedAtBefore,
    validationResult,
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
  } catch {
    throw buildActionError({
      status: 500,
      code: 'RUNTIME_ACTION_AUDIT_FAILED',
      message: 'Runtime action audit could not be persisted.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED,
    })
  }
}

const atomicPersistRuntimeAction = async ({
  actorUserId,
  expectedUpdatedAt,
  nextExecutionStatus,
  nextFrameworkState,
  runtimeInstance,
  session = null,
}) => {
  const expectedUpdatedAtDate = normalizeUpdatedAtDate(expectedUpdatedAt)
  if (!expectedUpdatedAtDate) {
    throw buildStaleActionError({ runtimeInstance, expectedUpdatedAt })
  }

  const updatedRuntimeInstance = await RuntimeInstance.findOneAndUpdate(
    {
      _id: runtimeInstance._id,
      updatedAt: expectedUpdatedAtDate,
    },
    {
      $set: {
        framework_state: nextFrameworkState,
        executionStatus: nextExecutionStatus,
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
    throw buildStaleActionError({ runtimeInstance, expectedUpdatedAt, currentUpdatedAt: null })
  }

  return updatedRuntimeInstance
}

const rollbackRuntimeAction = async ({
  previousExecutionStatus,
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
        executionStatus: previousExecutionStatus,
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

const persistActionWithAudit = async ({
  action,
  actionedAt,
  actorUserId,
  auditRequest,
  expectedUpdatedAt,
  nextExecutionStatus,
  nextFrameworkState,
  previousExecutionStatus,
  previousFrameworkState,
  previousUpdatedBy,
  runtimeInstance,
  updatedAtBefore,
  validationResult,
}) => {
  if (mongoose.connection.readyState === 1) {
    const session = await mongoose.startSession()
    let updatedRuntimeInstance = null
    try {
      await session.withTransaction(async () => {
        updatedRuntimeInstance = await atomicPersistRuntimeAction({
          actorUserId,
          expectedUpdatedAt,
          nextExecutionStatus,
          nextFrameworkState,
          runtimeInstance,
          session,
        })
        await logRuntimeActionExecuted({
          action,
          actionedAt,
          actorUserId,
          auditRequest,
          expectedUpdatedAt,
          nextExecutionStatus,
          nextFrameworkState,
          previousExecutionStatus,
          previousFrameworkState,
          runtimeInstance: updatedRuntimeInstance,
          updatedAtBefore,
          validationResult,
          session,
        })
      })
    } finally {
      await session.endSession()
    }
    return updatedRuntimeInstance
  }

  const updatedRuntimeInstance = await atomicPersistRuntimeAction({
    actorUserId,
    expectedUpdatedAt,
    nextExecutionStatus,
    nextFrameworkState,
    runtimeInstance,
  })

  try {
    await logRuntimeActionExecuted({
      action,
      actionedAt,
      actorUserId,
      auditRequest,
      expectedUpdatedAt,
      nextExecutionStatus,
      nextFrameworkState,
      previousExecutionStatus,
      previousFrameworkState,
      runtimeInstance: updatedRuntimeInstance,
      updatedAtBefore,
      validationResult,
    })
  } catch (err) {
    try {
      const rollbackSucceeded = await rollbackRuntimeAction({
        previousExecutionStatus,
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

export const executeRuntimeAction = async ({
  actionKey,
  actorUserId,
  auditRequest,
  payload,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const normalizedActionKey = normalizeRuntimeActionToken(actionKey)
  const expectedUpdatedAt = payload?.expectedUpdatedAt

  assertActionSupported(normalizedActionKey)

  const runtimeInstance = await resolveRuntimeInstanceDocument({ runtimeInstanceId })

  assertSupportedRuntimeType(runtimeInstance)

  const customerId = toIdString(runtimeInstance.customerId)
  const tenantId = toIdString(runtimeInstance.tenantId)

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
    feature: getFeatureForRuntimeType(runtimeInstance.runtimeType),
  })

  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const renderer = await getRuntimeRenderer({ scopes, runtimeInstanceId })
  const action = resolveRendererAction({ renderer, actionKey: normalizedActionKey })
  const frameworkPackage = await FrameworkPackage.findById(runtimeInstance.packageId)
  if (!frameworkPackage) {
    throw buildActionError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Framework package not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.PACKAGE_NOT_FOUND,
      details: { packageId: toIdString(runtimeInstance.packageId) },
    })
  }

  const runtimeGate = getRuntimeActionStateGate({
    actionKey: normalizedActionKey,
    frameworkPackage,
    runtimeInstance,
    frameworkState: runtimeInstance.framework_state,
  })

  if (!runtimeGate.allowed) {
    throw buildActionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime action is not currently executable.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        actionKey: normalizedActionKey,
        disabledReason: runtimeGate.reason,
      },
    })
  }

  const previousFrameworkState = cloneRuntimeActionValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const previousExecutionStatus = runtimeInstance.executionStatus
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const transition = buildRuntimeActionTransition({
    actionKey: normalizedActionKey,
    actorUserId,
    frameworkPackage,
    runtimeInstance,
  })

  const updatedRuntimeInstance = await persistActionWithAudit({
    action,
    actionedAt: transition.actionedAt,
    actorUserId,
    auditRequest,
    expectedUpdatedAt,
    nextExecutionStatus: transition.nextExecutionStatus,
    nextFrameworkState: transition.nextFrameworkState,
    previousExecutionStatus,
    previousFrameworkState,
    previousUpdatedBy,
    runtimeInstance,
    updatedAtBefore,
    validationResult: transition.validationResult,
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
    action: {
      actionKey: normalizedActionKey,
      governedAction: normalizeRuntimeActionToken(action.governedAction || action.actionKey),
      policyKey: action.policyKey || '',
      actionedAt: transition.actionedAt,
    },
    state: {
      lifecycle: transition.nextFrameworkState.lifecycle,
      readiness: transition.nextFrameworkState.readiness,
      ...(transition.validationResult ? { validation: transition.validationResult } : {}),
    },
  }
}

const runtimeActionExecutionService = {
  executeRuntimeAction,
}

export default runtimeActionExecutionService
