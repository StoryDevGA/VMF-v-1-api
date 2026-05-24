import { RUNTIME_EXECUTION_STATUSES, RUNTIME_INSTANCE_STATUSES, RUNTIME_TYPES } from '../models/RuntimeInstance.js'
import {
  getRuntimeSectionGenerated,
  getRuntimeSectionInput,
  isRuntimeSectionObject,
} from './runtimeSectionModelService.js'

export const RUNTIME_ACTION_KEYS = Object.freeze({
  SAVE_DISCOVERY_INPUTS: 'SAVE_DISCOVERY_INPUTS',
  BUILD_EVIDENCE_PACK: 'BUILD_EVIDENCE_PACK',
  REFRESH_EVIDENCE_PACK: 'REFRESH_EVIDENCE_PACK',
  ACCEPT_EVIDENCE: 'ACCEPT_EVIDENCE',
  SAVE_DRAFT: 'SAVE_DRAFT',
  RUN_VALIDATION: 'RUN_VALIDATION',
  MARK_READY: 'MARK_READY',
  SUBMIT_FOR_REVIEW: 'SUBMIT_FOR_REVIEW',
  RETURN_TO_DRAFT: 'RETURN_TO_DRAFT',
  GENERATE_SECTION: 'GENERATE_SECTION',
  REGENERATE_SECTION: 'REGENERATE_SECTION',
  APPROVE: 'APPROVE',
  PUBLISH: 'PUBLISH',
  LOCK_RECORD: 'LOCK_RECORD',
})

export const RUNTIME_READINESS_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  BLOCKED: 'BLOCKED',
  VALIDATED: 'VALIDATED',
  READY: 'READY',
  IN_REVIEW: 'IN_REVIEW',
  APPROVED: 'APPROVED',
  PUBLISHED: 'PUBLISHED',
  LOCKED: 'LOCKED',
})

export const RUNTIME_VALIDATION_STATES = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
})

export const RUNTIME_LIFECYCLE_STAGES = Object.freeze({
  DRAFT: 'DRAFT',
  READY: 'READY',
  IN_REVIEW: 'IN_REVIEW',
  APPROVED: 'APPROVED',
  PUBLISHED: 'PUBLISHED',
  LOCKED: 'LOCKED',
})

const SUPPORTED_SPRINT_2_ACTIONS = new Set(Object.values(RUNTIME_ACTION_KEYS))

export const normalizeRuntimeActionToken = (value) => String(value || '').trim().toUpperCase()

export const cloneRuntimeActionValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (value._id && value._id !== value) return toIdString(value._id)
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const getValueAtPath = (source, path) => {
  const parts = String(path || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return undefined

  let cursor = source
  for (const part of parts) {
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

const isEmptyRequiredValue = (value) => {
  if (isRuntimeSectionObject(value)) {
    return isEmptyRequiredValue(getRuntimeSectionInput(value))
      && isEmptyRequiredValue(getRuntimeSectionGenerated(value))
  }
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

export const isSupportedSprint2RuntimeAction = (actionKey) =>
  SUPPORTED_SPRINT_2_ACTIONS.has(normalizeRuntimeActionToken(actionKey))

export const normalizeFrameworkStateForAction = (frameworkState = {}) => ({
  lifecycle: frameworkState.lifecycle || { stage: RUNTIME_LIFECYCLE_STAGES.DRAFT },
  evidence_pack: frameworkState.evidence_pack || frameworkState.evidencePack || {},
  sections: frameworkState.sections || {},
  validation: frameworkState.validation || {},
  readiness: frameworkState.readiness || {},
  publish: frameworkState.publish || {},
  lock: frameworkState.lock || {},
  policy: frameworkState.policy || {},
  attachments: frameworkState.attachments || {},
  artifacts: frameworkState.artifacts || {},
})

export const deriveRuntimeValidationState = (frameworkState = {}) => {
  const normalizedState = normalizeFrameworkStateForAction(frameworkState)
  const rows = Object.values(normalizedState.validation).filter(
    (value) => value && typeof value === 'object' && !Array.isArray(value),
  )

  if (rows.some((row) => row.is_valid === false)) return RUNTIME_VALIDATION_STATES.FAILED
  if (rows.some((row) => row.is_valid === true)) return RUNTIME_VALIDATION_STATES.PASSED
  return RUNTIME_VALIDATION_STATES.UNKNOWN
}

export const deriveRuntimeReadinessState = (frameworkState = {}) => {
  const normalizedState = normalizeFrameworkStateForAction(frameworkState)
  const readiness = normalizedState.readiness || {}
  const state = normalizeRuntimeActionToken(readiness.state)

  if (state) return state

  const stage = normalizeRuntimeActionToken(normalizedState.lifecycle?.stage || RUNTIME_LIFECYCLE_STAGES.DRAFT)
  if (stage === RUNTIME_LIFECYCLE_STAGES.LOCKED) return RUNTIME_READINESS_STATES.LOCKED
  if (stage === RUNTIME_LIFECYCLE_STAGES.PUBLISHED) return RUNTIME_READINESS_STATES.PUBLISHED
  if (stage === RUNTIME_LIFECYCLE_STAGES.APPROVED) return RUNTIME_READINESS_STATES.APPROVED
  if (stage === RUNTIME_LIFECYCLE_STAGES.IN_REVIEW) return RUNTIME_READINESS_STATES.IN_REVIEW
  if (stage === RUNTIME_LIFECYCLE_STAGES.READY) return RUNTIME_READINESS_STATES.READY

  const validationState = deriveRuntimeValidationState(normalizedState)
  if (validationState === RUNTIME_VALIDATION_STATES.PASSED) return RUNTIME_READINESS_STATES.VALIDATED
  if (validationState === RUNTIME_VALIDATION_STATES.FAILED) return RUNTIME_READINESS_STATES.BLOCKED

  return RUNTIME_READINESS_STATES.DRAFT
}

const hasPassedValidation = (frameworkState) =>
  deriveRuntimeValidationState(frameworkState) === RUNTIME_VALIDATION_STATES.PASSED

const hasCurrentRequiredSectionsPassed = ({ frameworkPackage, frameworkState }) => {
  if (!frameworkPackage) return hasPassedValidation(frameworkState)
  return validateRuntimeRequiredSections({ frameworkPackage, frameworkState }).is_valid === true
}

export const isRuntimeLocked = ({ runtimeInstance, frameworkState } = {}) => {
  const normalizedState = normalizeFrameworkStateForAction(frameworkState || runtimeInstance?.framework_state)
  return Boolean(
    runtimeInstance?.lockedAt
    || normalizeRuntimeActionToken(runtimeInstance?.status) === RUNTIME_INSTANCE_STATUSES.LOCKED
    || normalizeRuntimeActionToken(normalizedState.lifecycle?.stage) === RUNTIME_LIFECYCLE_STAGES.LOCKED
    || normalizedState.lock?.locked === true,
  )
}

export const isRuntimeLifecycleTruthImmutable = (frameworkState = {}) => {
  const normalizedState = normalizeFrameworkStateForAction(frameworkState)
  return [
    RUNTIME_LIFECYCLE_STAGES.APPROVED,
    RUNTIME_LIFECYCLE_STAGES.PUBLISHED,
    RUNTIME_LIFECYCLE_STAGES.LOCKED,
  ].includes(normalizeRuntimeActionToken(normalizedState.lifecycle?.stage))
}

const hasReviewSubmissionEvidence = (frameworkState = {}) => {
  const normalizedState = normalizeFrameworkStateForAction(frameworkState)
  const readiness = normalizedState.readiness || {}
  return Boolean(
    readiness.submittedForReview === true
    && readiness.submittedAt
  )
}

const hasApprovalEvidence = (frameworkState = {}) => {
  const normalizedState = normalizeFrameworkStateForAction(frameworkState)
  const lifecycle = normalizedState.lifecycle || {}
  const readiness = normalizedState.readiness || {}
  const approvedAt = readiness.approvedAt || lifecycle.approvedAt
  const approvedBy = readiness.approvedBy || lifecycle.approvedBy

  return Boolean(readiness.approved === true && approvedAt && approvedBy)
}

const hasCompletePublishEvidence = (frameworkState = {}) => {
  const normalizedState = normalizeFrameworkStateForAction(frameworkState)
  const publish = normalizedState.publish || {}
  const evidence = publish.evidence || {}
  const sourceApproval = publish.sourceApproval || {}

  return Boolean(
    publish.state === RUNTIME_READINESS_STATES.PUBLISHED
    && publish.published === true
    && publish.publishedAt
    && publish.publishedBy
    && publish.outputEligible === true
    && sourceApproval.approvedAt
    && sourceApproval.approvedBy
    && evidence.activationId
    && evidence.deploymentId
    && evidence.dependencySnapshotId
    && evidence.dependencySnapshotHash
  )
}

const isRuntimeActionEditBlocked = (runtimeInstance) => [
  RUNTIME_EXECUTION_STATUSES.RUNNING,
  RUNTIME_EXECUTION_STATUSES.VALIDATING,
  RUNTIME_EXECUTION_STATUSES.COMPLETE,
  RUNTIME_EXECUTION_STATUSES.ERROR,
].includes(normalizeRuntimeActionToken(runtimeInstance?.executionStatus))

const buildGate = (allowed, reason = '') => ({ allowed, reason })

export const getRuntimeActionStateGate = ({
  actionKey,
  frameworkPackage,
  runtimeInstance,
  frameworkState,
} = {}) => {
  const normalizedAction = normalizeRuntimeActionToken(actionKey)
  const normalizedFrameworkState = normalizeFrameworkStateForAction(frameworkState)
  const lifecycleStage = normalizeRuntimeActionToken(
    normalizedFrameworkState.lifecycle?.stage || RUNTIME_LIFECYCLE_STAGES.DRAFT,
  )
  const readinessState = deriveRuntimeReadinessState(normalizedFrameworkState)
  const runtimeStatus = normalizeRuntimeActionToken(runtimeInstance?.status)
  const executionStatus = normalizeRuntimeActionToken(runtimeInstance?.executionStatus)

  if (!isSupportedSprint2RuntimeAction(normalizedAction)) {
    return buildGate(false, 'This runtime action is not available for this runtime.')
  }

  if (normalizeRuntimeActionToken(runtimeInstance?.runtimeType) !== RUNTIME_TYPES.VALUE_NARRATIVE) {
    return buildGate(false, 'Runtime actions are only available for Value Narrative runtimes.')
  }

  if (isRuntimeLocked({ runtimeInstance, frameworkState: normalizedFrameworkState })) {
    return buildGate(false, 'Runtime is locked and cannot be mutated or actioned.')
  }

  if (runtimeStatus !== RUNTIME_INSTANCE_STATUSES.ACTIVE) {
    return buildGate(false, 'Runtime action execution requires an active runtime instance.')
  }

  if (normalizedAction !== RUNTIME_ACTION_KEYS.RETURN_TO_DRAFT && isRuntimeActionEditBlocked(runtimeInstance)) {
    return buildGate(false, 'Runtime action execution is blocked while execution is in progress or terminal.')
  }

  const isInReview = executionStatus === RUNTIME_EXECUTION_STATUSES.WAITING_APPROVAL
    || lifecycleStage === RUNTIME_LIFECYCLE_STAGES.IN_REVIEW
    || readinessState === RUNTIME_READINESS_STATES.IN_REVIEW

  if (isInReview && ![
    RUNTIME_ACTION_KEYS.APPROVE,
    RUNTIME_ACTION_KEYS.RETURN_TO_DRAFT,
  ].includes(normalizedAction)) {
    return buildGate(false, 'Runtime is waiting for review and can only be approved or returned to draft.')
  }

  if (executionStatus === RUNTIME_EXECUTION_STATUSES.WAITING_APPROVAL) {
    if (![
      RUNTIME_ACTION_KEYS.APPROVE,
      RUNTIME_ACTION_KEYS.RETURN_TO_DRAFT,
    ].includes(normalizedAction)) {
      return buildGate(false, 'Runtime is waiting for review and can only be approved or returned to draft.')
    }
  }

  if (lifecycleStage === RUNTIME_LIFECYCLE_STAGES.APPROVED && normalizedAction !== RUNTIME_ACTION_KEYS.PUBLISH) {
    return buildGate(false, 'Approved runtimes can only be published.')
  }

  if (lifecycleStage === RUNTIME_LIFECYCLE_STAGES.PUBLISHED && normalizedAction !== RUNTIME_ACTION_KEYS.LOCK_RECORD) {
    return buildGate(false, 'Published runtimes can only be locked.')
  }

  if (
    normalizedAction === RUNTIME_ACTION_KEYS.MARK_READY
    && !hasCurrentRequiredSectionsPassed({ frameworkPackage, frameworkState: normalizedFrameworkState })
  ) {
    return buildGate(false, 'Run validation successfully before marking this runtime ready.')
  }

  if (
    normalizedAction === RUNTIME_ACTION_KEYS.SUBMIT_FOR_REVIEW
    && (
      !hasCurrentRequiredSectionsPassed({ frameworkPackage, frameworkState: normalizedFrameworkState })
      || readinessState !== RUNTIME_READINESS_STATES.READY
    )
  ) {
    return buildGate(false, 'Mark this runtime ready after successful validation before submitting for review.')
  }

  if (normalizedAction === RUNTIME_ACTION_KEYS.RETURN_TO_DRAFT) {
    return lifecycleStage === RUNTIME_LIFECYCLE_STAGES.IN_REVIEW
      || readinessState === RUNTIME_READINESS_STATES.IN_REVIEW
      || executionStatus === RUNTIME_EXECUTION_STATUSES.WAITING_APPROVAL
      ? buildGate(true)
      : buildGate(false, 'Runtime is not currently in review.')
  }

  if (normalizedAction === RUNTIME_ACTION_KEYS.APPROVE) {
    const inReview = lifecycleStage === RUNTIME_LIFECYCLE_STAGES.IN_REVIEW
      || readinessState === RUNTIME_READINESS_STATES.IN_REVIEW
      || executionStatus === RUNTIME_EXECUTION_STATUSES.WAITING_APPROVAL

    if (!inReview) {
      return buildGate(false, 'Runtime must be submitted for review before approval.')
    }

    if (!hasCurrentRequiredSectionsPassed({ frameworkPackage, frameworkState: normalizedFrameworkState })) {
      return buildGate(false, 'Required runtime sections must remain valid before approval.')
    }

    if (!hasReviewSubmissionEvidence(normalizedFrameworkState)) {
      return buildGate(false, 'Runtime review submission evidence is required before approval.')
    }
  }

  if (
    normalizedAction === RUNTIME_ACTION_KEYS.PUBLISH
    && (
      lifecycleStage !== RUNTIME_LIFECYCLE_STAGES.APPROVED
      || readinessState !== RUNTIME_READINESS_STATES.APPROVED
      || !hasApprovalEvidence(normalizedFrameworkState)
      || !hasCurrentRequiredSectionsPassed({ frameworkPackage, frameworkState: normalizedFrameworkState })
    )
  ) {
    return buildGate(false, 'Approve this runtime with current validation evidence before publishing.')
  }

  if (
    normalizedAction === RUNTIME_ACTION_KEYS.LOCK_RECORD
    && (
      lifecycleStage !== RUNTIME_LIFECYCLE_STAGES.PUBLISHED
      || readinessState !== RUNTIME_READINESS_STATES.PUBLISHED
      || !hasCompletePublishEvidence(normalizedFrameworkState)
      || !hasCurrentRequiredSectionsPassed({ frameworkPackage, frameworkState: normalizedFrameworkState })
    )
  ) {
    return buildGate(false, 'Publish this runtime with current evidence before locking canonical truth.')
  }

  return buildGate(true)
}

export const applyRuntimeActionStateGate = ({
  action,
  frameworkPackage,
  runtimeInstance,
  frameworkState,
} = {}) => {
  const actionKey = normalizeRuntimeActionToken(action?.governedAction || action?.actionKey)
  const runtimeGate = getRuntimeActionStateGate({
    actionKey,
    frameworkPackage,
    runtimeInstance,
    frameworkState,
  })

  return {
    ...action,
    enabled: Boolean(action?.enabled && runtimeGate.allowed),
    disabledReason: action?.enabled && !runtimeGate.allowed
      ? runtimeGate.reason
      : action?.disabledReason || '',
    runtimeGate: {
      allowed: runtimeGate.allowed,
      reason: runtimeGate.reason,
    },
  }
}

export const validateRuntimeRequiredSections = ({ frameworkPackage, frameworkState } = {}) => {
  const normalizedState = normalizeFrameworkStateForAction(frameworkState)
  const requiredSections = (Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : [])
    .filter((section) => section?.required === true)
  const missingSections = requiredSections
    .map((section) => ({
      sectionKey: String(section?.sectionKey || '').trim(),
      runtimePath: String(section?.runtimePath || '').trim(),
      value: getValueAtPath({ framework_state: normalizedState }, section?.runtimePath),
    }))
    .filter((section) => section.sectionKey && isEmptyRequiredValue(section.value))

  const isValid = missingSections.length === 0
  const checkedAt = new Date().toISOString()

  return {
    key: 'runtime_required_sections',
    is_valid: isValid,
    blocking: !isValid,
    status: isValid ? RUNTIME_VALIDATION_STATES.PASSED : RUNTIME_VALIDATION_STATES.FAILED,
    message: isValid
      ? 'Required runtime sections are complete.'
      : 'Required runtime sections must be completed before this runtime can be marked ready.',
    messages: missingSections.map((section) => ({
      severity: 'ERROR',
      message: `${section.sectionKey} is required before this runtime can be marked ready.`,
      sectionKey: section.sectionKey,
      runtimePath: section.runtimePath,
    })),
    requiredSectionCount: requiredSections.length,
    missingRequiredSections: missingSections.map((section) => ({
      sectionKey: section.sectionKey,
      runtimePath: section.runtimePath,
    })),
    validatedAt: checkedAt,
  }
}

export const buildRuntimeActionTransition = ({
  actionKey,
  actorUserId,
  frameworkPackage,
  runtimeInstance,
} = {}) => {
  const normalizedAction = normalizeRuntimeActionToken(actionKey)
  const previousFrameworkState = normalizeFrameworkStateForAction(runtimeInstance?.framework_state)
  const nextFrameworkState = cloneRuntimeActionValue(previousFrameworkState)
  const actionedAt = new Date().toISOString()
  let nextExecutionStatus = runtimeInstance?.executionStatus || RUNTIME_EXECUTION_STATUSES.IDLE
  let validationResult = null
  let runtimeUpdate = {}

  nextFrameworkState.lifecycle = nextFrameworkState.lifecycle || { stage: RUNTIME_LIFECYCLE_STAGES.DRAFT }
  nextFrameworkState.validation = nextFrameworkState.validation || {}
  nextFrameworkState.readiness = nextFrameworkState.readiness || {}
  nextFrameworkState.publish = nextFrameworkState.publish || {}
  nextFrameworkState.lock = nextFrameworkState.lock || {}

  if (normalizedAction === RUNTIME_ACTION_KEYS.SAVE_DRAFT) {
    nextFrameworkState.lifecycle = {
      ...nextFrameworkState.lifecycle,
      stage: RUNTIME_LIFECYCLE_STAGES.DRAFT,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextFrameworkState.readiness = {
      ...nextFrameworkState.readiness,
      state: RUNTIME_READINESS_STATES.DRAFT,
      ready: false,
      submittedForReview: false,
      lastActionKey: normalizedAction,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextExecutionStatus = RUNTIME_EXECUTION_STATUSES.IDLE
  }

  if (normalizedAction === RUNTIME_ACTION_KEYS.RUN_VALIDATION) {
    validationResult = validateRuntimeRequiredSections({ frameworkPackage, frameworkState: nextFrameworkState })
    nextFrameworkState.validation = {
      ...nextFrameworkState.validation,
      [validationResult.key]: validationResult,
    }
    nextFrameworkState.readiness = {
      ...nextFrameworkState.readiness,
      state: validationResult.is_valid
        ? RUNTIME_READINESS_STATES.VALIDATED
        : RUNTIME_READINESS_STATES.BLOCKED,
      ready: false,
      validationState: validationResult.status,
      lastActionKey: normalizedAction,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextExecutionStatus = validationResult.is_valid
      ? RUNTIME_EXECUTION_STATUSES.IDLE
      : RUNTIME_EXECUTION_STATUSES.BLOCKED
  }

  if (normalizedAction === RUNTIME_ACTION_KEYS.MARK_READY) {
    nextFrameworkState.lifecycle = {
      ...nextFrameworkState.lifecycle,
      stage: RUNTIME_LIFECYCLE_STAGES.READY,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextFrameworkState.readiness = {
      ...nextFrameworkState.readiness,
      state: RUNTIME_READINESS_STATES.READY,
      ready: true,
      submittedForReview: false,
      validationState: RUNTIME_VALIDATION_STATES.PASSED,
      lastActionKey: normalizedAction,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextExecutionStatus = RUNTIME_EXECUTION_STATUSES.IDLE
  }

  if (normalizedAction === RUNTIME_ACTION_KEYS.SUBMIT_FOR_REVIEW) {
    nextFrameworkState.lifecycle = {
      ...nextFrameworkState.lifecycle,
      stage: RUNTIME_LIFECYCLE_STAGES.IN_REVIEW,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextFrameworkState.readiness = {
      ...nextFrameworkState.readiness,
      state: RUNTIME_READINESS_STATES.IN_REVIEW,
      ready: true,
      submittedForReview: true,
      validationState: RUNTIME_VALIDATION_STATES.PASSED,
      submittedAt: actionedAt,
      lastActionKey: normalizedAction,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextExecutionStatus = RUNTIME_EXECUTION_STATUSES.WAITING_APPROVAL
  }

  if (normalizedAction === RUNTIME_ACTION_KEYS.RETURN_TO_DRAFT) {
    nextFrameworkState.lifecycle = {
      ...nextFrameworkState.lifecycle,
      stage: RUNTIME_LIFECYCLE_STAGES.DRAFT,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextFrameworkState.readiness = {
      ...nextFrameworkState.readiness,
      state: RUNTIME_READINESS_STATES.DRAFT,
      ready: false,
      submittedForReview: false,
      returnedToDraftAt: actionedAt,
      lastActionKey: normalizedAction,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextExecutionStatus = RUNTIME_EXECUTION_STATUSES.IDLE
  }

  if (normalizedAction === RUNTIME_ACTION_KEYS.APPROVE) {
    nextFrameworkState.lifecycle = {
      ...nextFrameworkState.lifecycle,
      stage: RUNTIME_LIFECYCLE_STAGES.APPROVED,
      approvedAt: actionedAt,
      approvedBy: toIdString(actorUserId),
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextFrameworkState.readiness = {
      ...nextFrameworkState.readiness,
      state: RUNTIME_READINESS_STATES.APPROVED,
      ready: true,
      approved: true,
      approvedAt: actionedAt,
      approvedBy: toIdString(actorUserId),
      validationState: RUNTIME_VALIDATION_STATES.PASSED,
      lastActionKey: normalizedAction,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextExecutionStatus = RUNTIME_EXECUTION_STATUSES.IDLE
  }

  if (normalizedAction === RUNTIME_ACTION_KEYS.PUBLISH) {
    const evidence = {
      activationId: String(runtimeInstance?.evidence?.activationId || runtimeInstance?.activationId || '').trim(),
      deploymentId: String(runtimeInstance?.evidence?.deploymentId || runtimeInstance?.deploymentId || '').trim(),
      dependencySnapshotId: String(runtimeInstance?.evidence?.dependencySnapshotId || runtimeInstance?.dependencyLockId || '').trim(),
      dependencySnapshotHash: String(runtimeInstance?.evidence?.dependencySnapshotHash || '').trim(),
    }
    nextFrameworkState.lifecycle = {
      ...nextFrameworkState.lifecycle,
      stage: RUNTIME_LIFECYCLE_STAGES.PUBLISHED,
      publishedAt: actionedAt,
      publishedBy: toIdString(actorUserId),
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextFrameworkState.publish = {
      ...nextFrameworkState.publish,
      state: RUNTIME_READINESS_STATES.PUBLISHED,
      published: true,
      publishedAt: actionedAt,
      publishedBy: toIdString(actorUserId),
      sourceApproval: {
        approvedAt: nextFrameworkState.readiness?.approvedAt || nextFrameworkState.lifecycle?.approvedAt || null,
        approvedBy: nextFrameworkState.readiness?.approvedBy || nextFrameworkState.lifecycle?.approvedBy || '',
      },
      evidence,
      outputEligible: true,
      lastActionKey: normalizedAction,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextFrameworkState.readiness = {
      ...nextFrameworkState.readiness,
      state: RUNTIME_READINESS_STATES.PUBLISHED,
      ready: true,
      approved: true,
      published: true,
      outputEligible: true,
      validationState: RUNTIME_VALIDATION_STATES.PASSED,
      lastActionKey: normalizedAction,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextExecutionStatus = RUNTIME_EXECUTION_STATUSES.IDLE
  }

  if (normalizedAction === RUNTIME_ACTION_KEYS.LOCK_RECORD) {
    const evidence = {
      activationId: String(runtimeInstance?.evidence?.activationId || runtimeInstance?.activationId || '').trim(),
      deploymentId: String(runtimeInstance?.evidence?.deploymentId || runtimeInstance?.deploymentId || '').trim(),
      dependencySnapshotId: String(runtimeInstance?.evidence?.dependencySnapshotId || runtimeInstance?.dependencyLockId || '').trim(),
      dependencySnapshotHash: String(runtimeInstance?.evidence?.dependencySnapshotHash || '').trim(),
    }
    nextFrameworkState.lifecycle = {
      ...nextFrameworkState.lifecycle,
      stage: RUNTIME_LIFECYCLE_STAGES.LOCKED,
      lockedAt: actionedAt,
      lockedBy: toIdString(actorUserId),
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextFrameworkState.lock = {
      ...nextFrameworkState.lock,
      state: RUNTIME_READINESS_STATES.LOCKED,
      locked: true,
      lockedAt: actionedAt,
      lockedBy: toIdString(actorUserId),
      lockedReason: 'Runtime published truth locked for downstream canonical use.',
      publish: {
        publishedAt: nextFrameworkState.publish?.publishedAt || null,
        publishedBy: nextFrameworkState.publish?.publishedBy || '',
      },
      evidence,
      anchor: {
        relationship: 'LOCKED_VALUE_NARRATIVE',
        runtimeInstanceKey: runtimeInstance?.runtimeInstanceKey || '',
        runtimeType: runtimeInstance?.runtimeType || '',
      },
      lastActionKey: normalizedAction,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    nextFrameworkState.readiness = {
      ...nextFrameworkState.readiness,
      state: RUNTIME_READINESS_STATES.LOCKED,
      ready: true,
      approved: true,
      published: true,
      locked: true,
      outputEligible: true,
      validationState: RUNTIME_VALIDATION_STATES.PASSED,
      lastActionKey: normalizedAction,
      updatedAt: actionedAt,
      updatedBy: toIdString(actorUserId),
    }
    runtimeUpdate = {
      status: RUNTIME_INSTANCE_STATUSES.LOCKED,
      lockedAt: new Date(actionedAt),
      lockedBy: actorUserId || null,
      lockedReason: 'Runtime published truth locked for downstream canonical use.',
    }
    nextExecutionStatus = RUNTIME_EXECUTION_STATUSES.COMPLETE
  }

  return {
    actionedAt,
    nextExecutionStatus,
    nextFrameworkState,
    previousFrameworkState,
    runtimeUpdate,
    validationResult,
  }
}

const runtimeActionPolicyService = {
  applyRuntimeActionStateGate,
  buildRuntimeActionTransition,
  deriveRuntimeReadinessState,
  deriveRuntimeValidationState,
  getRuntimeActionStateGate,
  isSupportedSprint2RuntimeAction,
  isRuntimeLocked,
  isRuntimeLifecycleTruthImmutable,
  normalizeFrameworkStateForAction,
  normalizeRuntimeActionToken,
  validateRuntimeRequiredSections,
}

export default runtimeActionPolicyService
