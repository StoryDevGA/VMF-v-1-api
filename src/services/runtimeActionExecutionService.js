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
import {
  buildDiscoveryProjection,
  buildSectionGenerationEligibility,
  getDependencySectionKeys,
  getRuntimeRenderer,
} from './runtimeRendererService.js'
import {
  RUNTIME_ACTION_KEYS,
  buildRuntimeActionTransition,
  cloneRuntimeActionValue,
  getRuntimeActionStateGate,
  isSupportedSprint2RuntimeAction,
  normalizeRuntimeActionToken,
} from './runtimeActionPolicyService.js'
import {
  RUNTIME_SECTION_STATES,
  buildDeterministicGeneratedSection,
  buildRuntimeSectionRevision,
  cloneSectionValue,
  getRuntimeSectionGenerated,
  getRuntimeSectionInput,
  getRuntimeSectionRevisions,
  invalidateRuntimeSectionEvidence,
  normalizeRuntimeSectionObject,
} from './runtimeSectionModelService.js'
import {
  assertDiscoveryEvidenceAcceptable,
  assertRuntimeEvidencePackWritable,
  buildDiscoveryEvidencePack,
} from './runtimeStateMutationService.js'

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

const serializeErrorDetails = (err) => ({
  name: err?.name || 'Error',
  message: err?.message || 'Unknown error',
  ...(err?.code ? { code: err.code } : {}),
})

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
      supportedActions: Object.values(RUNTIME_ACTION_KEYS),
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

const isGenerationAction = (actionKey) => [
  RUNTIME_ACTION_KEYS.GENERATE_SECTION,
  RUNTIME_ACTION_KEYS.REGENERATE_SECTION,
].includes(normalizeRuntimeActionToken(actionKey))

const DISCOVERY_BUILD_ACTIONS = new Set([
  RUNTIME_ACTION_KEYS.SAVE_DISCOVERY_INPUTS,
  RUNTIME_ACTION_KEYS.BUILD_EVIDENCE_PACK,
  RUNTIME_ACTION_KEYS.REFRESH_EVIDENCE_PACK,
])

const isDiscoveryAction = (actionKey) => [
  RUNTIME_ACTION_KEYS.SAVE_DISCOVERY_INPUTS,
  RUNTIME_ACTION_KEYS.BUILD_EVIDENCE_PACK,
  RUNTIME_ACTION_KEYS.REFRESH_EVIDENCE_PACK,
  RUNTIME_ACTION_KEYS.ACCEPT_EVIDENCE,
].includes(normalizeRuntimeActionToken(actionKey))

const getRuntimeSectionStateKey = ({ runtimePath, sectionKey }) => {
  const normalizedRuntimePath = String(runtimePath || '').trim()
  const sectionRootPrefix = 'framework_state.sections.'

  if (normalizedRuntimePath.startsWith(sectionRootPrefix)) {
    const statePath = normalizedRuntimePath.slice(sectionRootPrefix.length).trim()
    if (statePath && !statePath.includes('.')) return statePath
  }

  return String(sectionKey || '').trim()
}

const resolveGenerationTargetSection = ({ frameworkPackage, payload }) => {
  const sectionKey = String(payload?.sectionKey || '').trim()
  const runtimePath = String(payload?.runtimePath || '').trim()
  const sections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  const sectionByKey = sectionKey
    ? sections.find((candidate) => String(candidate?.sectionKey || '').trim() === sectionKey)
    : null
  const sectionByPath = runtimePath
    ? sections.find((candidate) => String(candidate?.runtimePath || '').trim() === runtimePath)
    : null

  if (sectionKey && runtimePath && sectionByKey !== sectionByPath) {
    throw buildActionError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime generation sectionKey and runtimePath must target the same package section.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_TARGET_MISMATCH,
      details: {
        sectionKey,
        runtimePath,
      },
    })
  }

  const section = sectionByKey || sectionByPath

  if (!section) {
    throw buildActionError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime generation action requires a package-bound section target.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        sectionKey,
        runtimePath,
      },
    })
  }

  return {
    section,
    sectionKey: String(section.sectionKey || '').trim(),
    runtimePath: String(section.runtimePath || '').trim(),
    stateSectionKey: getRuntimeSectionStateKey({
      runtimePath: section.runtimePath,
      sectionKey: section.sectionKey,
    }),
  }
}

const applyRuntimeSectionGeneration = ({
  actionKey,
  actorUserId,
  frameworkPackage,
  payload,
  runtimeInstance,
}) => {
  const normalizedActionKey = normalizeRuntimeActionToken(actionKey)
  const actionedAt = new Date().toISOString()
  const previousFrameworkState = cloneRuntimeActionValue(runtimeInstance.framework_state || {})
  const nextFrameworkState = cloneRuntimeActionValue(previousFrameworkState)
  nextFrameworkState.sections = nextFrameworkState.sections || {}

  const target = resolveGenerationTargetSection({ frameworkPackage, payload })
  const previousRawSection = nextFrameworkState.sections[target.stateSectionKey]
  const discovery = buildDiscoveryProjection(nextFrameworkState)
  const generationEligibility = buildSectionGenerationEligibility({
    dependencySectionKeys: getDependencySectionKeys(target.section),
    discovery,
    frameworkState: nextFrameworkState,
    rawSectionValue: previousRawSection,
  })

  if (normalizedActionKey === RUNTIME_ACTION_KEYS.GENERATE_SECTION && generationEligibility.canGenerate !== true) {
    throw buildActionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime section cannot be generated before discovery evidence or section context exists.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        actionKey: normalizedActionKey,
        disabledReason: generationEligibility.reason,
        sectionKey: target.sectionKey,
        runtimePath: target.runtimePath,
      },
    })
  }

  const sectionObject = normalizeRuntimeSectionObject({
    value: previousRawSection,
    sectionKey: target.sectionKey,
    runtimePath: target.runtimePath,
    initializedAt: actionedAt,
  })
  const input = getRuntimeSectionInput(sectionObject)
  const previousGenerated = getRuntimeSectionGenerated(sectionObject)
  const existingRevisions = getRuntimeSectionRevisions(sectionObject)

  if (normalizedActionKey === RUNTIME_ACTION_KEYS.REGENERATE_SECTION && !previousGenerated) {
    throw buildActionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime section cannot be regenerated before generated content exists.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        actionKey: normalizedActionKey,
        sectionKey: target.sectionKey,
        runtimePath: target.runtimePath,
      },
    })
  }

  const generated = buildDeterministicGeneratedSection({
    actionKey: normalizedActionKey,
    actorUserId: toIdString(actorUserId),
    frameworkPackage,
    input,
    runtimeInstance,
    section: target.section,
    generatedAt: actionedAt,
  })
  const revisions = previousGenerated
    ? [
        ...existingRevisions,
        buildRuntimeSectionRevision({
          generated: previousGenerated,
          revisionNumber: existingRevisions.length + 1,
          replacedAt: actionedAt,
        }),
      ]
    : existingRevisions

  nextFrameworkState.sections[target.stateSectionKey] = {
    ...sectionObject,
    generated,
    revisions,
    review: {
      ...(sectionObject.review || {}),
      status: 'PENDING_REVIEW',
    },
    state: {
      ...(sectionObject.state || {}),
      status: normalizedActionKey === RUNTIME_ACTION_KEYS.REGENERATE_SECTION
        ? RUNTIME_SECTION_STATES.REGENERATED
        : RUNTIME_SECTION_STATES.GENERATED,
      generatedAt: actionedAt,
      lastActionKey: normalizedActionKey,
      revisionCount: revisions.length,
      updatedBy: toIdString(actorUserId),
    },
    lineage: {
      ...(sectionObject.lineage || {}),
      sectionKey: target.sectionKey,
      stateSectionKey: target.stateSectionKey,
      runtimePath: target.runtimePath,
      runtimeInstanceId: toIdString(runtimeInstance._id),
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
      packageId: toIdString(runtimeInstance.packageId),
      packageKey: runtimeInstance.packageKey,
      packageVersion: runtimeInstance.packageVersion,
      actionKey: normalizedActionKey,
      generatedAt: actionedAt,
      inputHash: generated.inputHash,
    },
  }
  invalidateRuntimeSectionEvidence({
    frameworkState: nextFrameworkState,
    invalidatedAt: actionedAt,
    runtimePath: target.runtimePath,
  })

  return {
    actionedAt,
    generationResult: {
      sectionKey: target.sectionKey,
      stateSectionKey: target.stateSectionKey,
      runtimePath: target.runtimePath,
      generated,
      previousGenerated: cloneSectionValue(previousGenerated),
      revisionCount: revisions.length,
    },
    nextExecutionStatus: runtimeInstance.executionStatus || 'IDLE',
    nextFrameworkState,
    previousFrameworkState,
    validationResult: null,
  }
}

const applyRuntimeDiscoveryAction = async ({
  actionKey,
  actorUserId,
  payload,
  runtimeInstance,
}) => {
  const normalizedActionKey = normalizeRuntimeActionToken(actionKey)
  const previousFrameworkState = cloneRuntimeActionValue(runtimeInstance.framework_state || {})
  const nextFrameworkState = cloneRuntimeActionValue(previousFrameworkState)
  const previousEvidencePack = cloneRuntimeActionValue(previousFrameworkState.evidence_pack || {})
  const actionedAt = new Date().toISOString()
  let nextEvidencePack = previousEvidencePack

  if (DISCOVERY_BUILD_ACTIONS.has(normalizedActionKey)) {
    nextEvidencePack = await buildDiscoveryEvidencePack({
      actorUserId,
      inputs: payload?.inputs || previousEvidencePack.inputs || {},
      previousEvidencePack,
      reason: normalizedActionKey,
      runtimeInstance,
    })
  }

  if (normalizedActionKey === RUNTIME_ACTION_KEYS.ACCEPT_EVIDENCE) {
    assertDiscoveryEvidenceAcceptable(previousEvidencePack)
    nextEvidencePack = {
      ...previousEvidencePack,
      inputComplete: true,
      evidenceReady: true,
      accepted: true,
      needsRefresh: false,
      acceptedAt: actionedAt,
      acceptedBy: toIdString(actorUserId),
      state: {
        ...(previousEvidencePack.state || {}),
        status: 'ACCEPTED',
        inputComplete: true,
        evidenceReady: true,
        accepted: true,
        needsRefresh: false,
      },
    }
  }

  await assertRuntimeEvidencePackWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    value: nextEvidencePack,
  })

  nextFrameworkState.evidence_pack = nextEvidencePack

  return {
    actionedAt,
    nextExecutionStatus: runtimeInstance.executionStatus || 'IDLE',
    nextFrameworkState,
    runtimeUpdate: {},
    validationResult: null,
    discoveryResult: {
      status: nextEvidencePack.state?.status || '',
      inputComplete: nextEvidencePack.inputComplete === true || nextEvidencePack.state?.inputComplete === true,
      evidenceReady: nextEvidencePack.evidenceReady === true || nextEvidencePack.state?.evidenceReady === true,
      accepted: nextEvidencePack.accepted === true || nextEvidencePack.state?.accepted === true,
      needsRefresh: nextEvidencePack.needsRefresh === true || nextEvidencePack.state?.needsRefresh === true,
      inputCount: Object.keys(nextEvidencePack.inputs || {}).length,
      sourceCount: Array.isArray(nextEvidencePack.lineage?.sources) ? nextEvidencePack.lineage.sources.length : 0,
    },
  }
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
  generationResult,
  discoveryResult,
  nextRuntimeUpdate = {},
  previousRuntimeStatus,
  previousLockedAt,
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
    runtimeStatus: {
      from: previousRuntimeStatus,
      to: nextRuntimeUpdate.status || runtimeInstance.status,
    },
    lock: {
      from: {
        lockedAt: previousLockedAt || null,
        state: previousFrameworkState?.lock || {},
      },
      to: {
        lockedAt: runtimeInstance.lockedAt || nextRuntimeUpdate.lockedAt || null,
        state: nextFrameworkState?.lock || {},
      },
    },
    publish: {
      from: previousFrameworkState?.publish || {},
      to: nextFrameworkState?.publish || {},
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
    ...(generationResult ? {
      generation: {
        sectionKey: generationResult.sectionKey,
        stateSectionKey: generationResult.stateSectionKey,
        runtimePath: generationResult.runtimePath,
        revisionCount: generationResult.revisionCount,
        generatedAt: generationResult.generated?.generatedAt,
        inputHash: generationResult.generated?.inputHash,
        previousGenerated: generationResult.previousGenerated ? true : false,
      },
    } : {}),
    ...(discoveryResult ? {
      discovery: {
        status: discoveryResult.status,
        inputComplete: discoveryResult.inputComplete,
        evidenceReady: discoveryResult.evidenceReady,
        accepted: discoveryResult.accepted,
        needsRefresh: discoveryResult.needsRefresh,
        inputCount: discoveryResult.inputCount,
        sourceCount: discoveryResult.sourceCount,
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
  generationResult,
  discoveryResult,
  nextRuntimeUpdate,
  previousRuntimeStatus,
  previousLockedAt,
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
    generationResult,
    discoveryResult,
    nextRuntimeUpdate,
    previousRuntimeStatus,
    previousLockedAt,
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
    throw buildActionError({
      status: 500,
      code: 'RUNTIME_ACTION_AUDIT_FAILED',
      message: 'Runtime action audit could not be persisted.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED,
      details: {
        auditError: serializeErrorDetails(err),
      },
    })
  }
}

const logRuntimeActionRollbackFailure = async ({
  auditError,
  rollbackError = null,
  runtimeInstance,
  updatedRuntimeInstance,
}) => auditService.log({
  action: auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED,
  resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
  resourceId: runtimeInstance?._id,
  actorType: 'SYSTEM',
  systemActor: 'runtime-action-rollback',
  isSystemEvent: true,
  systemEventType: 'RUNTIME_ACTION_ROLLBACK_FAILED',
  eventCategory: 'RUNTIME',
  eventSeverity: 'CRITICAL',
  scope: {
    customerId: toIdString(runtimeInstance?.customerId),
    tenantId: toIdString(runtimeInstance?.tenantId),
    runtimeInstanceId: toIdString(runtimeInstance?._id),
    runtimeInstanceKey: runtimeInstance?.runtimeInstanceKey,
  },
  diff: {
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED,
    auditError: serializeErrorDetails(auditError),
    ...(rollbackError ? { rollbackError: serializeErrorDetails(rollbackError) } : {}),
    attemptedRollbackUpdatedAt: updatedRuntimeInstance?.updatedAt instanceof Date
      ? updatedRuntimeInstance.updatedAt.toISOString()
      : updatedRuntimeInstance?.updatedAt,
  },
})

const atomicPersistRuntimeAction = async ({
  actorUserId,
  expectedUpdatedAt,
  nextExecutionStatus,
  nextFrameworkState,
  nextRuntimeUpdate = {},
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
        ...nextRuntimeUpdate,
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
  previousRuntimeStatus,
  previousLockedAt,
  previousLockedBy,
  previousLockedReason,
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
        status: previousRuntimeStatus,
        lockedAt: previousLockedAt || null,
        lockedBy: previousLockedBy || null,
        lockedReason: previousLockedReason || '',
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
  nextRuntimeUpdate,
  previousExecutionStatus,
  previousFrameworkState,
  previousRuntimeStatus,
  previousLockedAt,
  previousLockedBy,
  previousLockedReason,
  previousUpdatedBy,
  runtimeInstance,
  updatedAtBefore,
  validationResult,
  generationResult,
  discoveryResult,
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
          nextRuntimeUpdate,
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
          previousRuntimeStatus,
          previousLockedAt,
          runtimeInstance: updatedRuntimeInstance,
          updatedAtBefore,
          validationResult,
          generationResult,
          discoveryResult,
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
    nextRuntimeUpdate,
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
      previousRuntimeStatus,
      previousLockedAt,
      nextRuntimeUpdate,
      runtimeInstance: updatedRuntimeInstance,
      updatedAtBefore,
      validationResult,
      generationResult,
      discoveryResult,
    })
  } catch (err) {
    try {
      const rollbackSucceeded = await rollbackRuntimeAction({
        previousExecutionStatus,
        previousFrameworkState,
        previousRuntimeStatus,
        previousLockedAt,
        previousLockedBy,
        previousLockedReason,
        previousUpdatedBy,
        runtimeInstance,
        updatedRuntimeInstance,
      })
      if (!rollbackSucceeded) {
        err.details = {
          ...(err.details || {}),
          rollbackFailed: true,
        }
        await logRuntimeActionRollbackFailure({
          auditError: err,
          runtimeInstance,
          updatedRuntimeInstance,
        })
      }
    } catch (rollbackErr) {
      err.details = {
        ...(err.details || {}),
        rollbackFailed: true,
        rollbackError: serializeErrorDetails(rollbackErr),
      }
      await logRuntimeActionRollbackFailure({
        auditError: err,
        rollbackError: rollbackErr,
        runtimeInstance,
        updatedRuntimeInstance,
      })
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
  const previousRuntimeStatus = runtimeInstance.status
  const previousLockedAt = runtimeInstance.lockedAt || null
  const previousLockedBy = runtimeInstance.lockedBy || null
  const previousLockedReason = runtimeInstance.lockedReason || ''
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const transition = buildRuntimeActionTransition({
    actionKey: normalizedActionKey,
    actorUserId,
    frameworkPackage,
    runtimeInstance,
  })
  let resolvedTransition = transition
  if (isGenerationAction(normalizedActionKey)) {
    resolvedTransition = applyRuntimeSectionGeneration({
        actionKey: normalizedActionKey,
        actorUserId,
        frameworkPackage,
        payload,
        runtimeInstance,
      })
  } else if (isDiscoveryAction(normalizedActionKey)) {
    resolvedTransition = await applyRuntimeDiscoveryAction({
      actionKey: normalizedActionKey,
      actorUserId,
      payload,
      runtimeInstance,
    })
  }

  const updatedRuntimeInstance = await persistActionWithAudit({
    action,
    actionedAt: resolvedTransition.actionedAt,
    actorUserId,
    auditRequest,
    expectedUpdatedAt,
    nextExecutionStatus: resolvedTransition.nextExecutionStatus,
    nextFrameworkState: resolvedTransition.nextFrameworkState,
    nextRuntimeUpdate: resolvedTransition.runtimeUpdate || {},
    previousExecutionStatus,
    previousFrameworkState,
    previousRuntimeStatus,
    previousLockedAt,
    previousLockedBy,
    previousLockedReason,
    previousUpdatedBy,
    runtimeInstance,
    updatedAtBefore,
    validationResult: resolvedTransition.validationResult,
    generationResult: resolvedTransition.generationResult,
    discoveryResult: resolvedTransition.discoveryResult,
  })

  return {
    runtimeInstance: {
      id: toIdString(updatedRuntimeInstance._id),
      runtimeInstanceKey: updatedRuntimeInstance.runtimeInstanceKey,
      runtimeType: updatedRuntimeInstance.runtimeType,
      status: updatedRuntimeInstance.status,
      executionStatus: updatedRuntimeInstance.executionStatus,
      lockedAt: updatedRuntimeInstance.lockedAt instanceof Date
        ? updatedRuntimeInstance.lockedAt.toISOString()
        : updatedRuntimeInstance.lockedAt || null,
      updatedAt: updatedRuntimeInstance.updatedAt instanceof Date
        ? updatedRuntimeInstance.updatedAt.toISOString()
        : updatedRuntimeInstance.updatedAt,
    },
    action: {
      actionKey: normalizedActionKey,
      governedAction: normalizeRuntimeActionToken(action.governedAction || action.actionKey),
      policyKey: action.policyKey || '',
      actionedAt: resolvedTransition.actionedAt,
    },
    state: {
      lifecycle: resolvedTransition.nextFrameworkState.lifecycle,
      readiness: resolvedTransition.nextFrameworkState.readiness,
      publish: resolvedTransition.nextFrameworkState.publish || {},
      lock: resolvedTransition.nextFrameworkState.lock || {},
      ...(resolvedTransition.validationResult ? { validation: resolvedTransition.validationResult } : {}),
      ...(resolvedTransition.generationResult ? { generation: {
        sectionKey: resolvedTransition.generationResult.sectionKey,
        stateSectionKey: resolvedTransition.generationResult.stateSectionKey,
        runtimePath: resolvedTransition.generationResult.runtimePath,
        revisionCount: resolvedTransition.generationResult.revisionCount,
      } } : {}),
      ...(resolvedTransition.discoveryResult ? { discovery: resolvedTransition.discoveryResult } : {}),
    },
  }
}

const runtimeActionExecutionService = {
  executeRuntimeAction,
}

export default runtimeActionExecutionService
