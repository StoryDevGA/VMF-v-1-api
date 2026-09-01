import mongoose from 'mongoose'
import { FrameworkPackage, RuntimeInstance } from '../models/index.js'
import {
  RUNTIME_EXECUTION_STATUSES,
  RUNTIME_INSTANCE_STATUSES,
  RUNTIME_MODES,
  RUNTIME_TYPES,
} from '../models/RuntimeInstance.js'
import auditService from './auditService.js'
import {
  assertRuntimePermission,
  createRuntimeInstanceError,
  RUNTIME_INSTANCE_ERROR_REASONS,
  serializeRuntimeInstance,
  toIdString,
} from './runtimeInstanceService.js'
import {
  createRuntimeStateVersion,
  requireCanonicalRuntimeStateVersion,
} from './runtimeStateVersionService.js'
import { stageRuntimeStateRevisionProvisioning } from './runtimeStateRevisionProvisioningService.js'
import {
  RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS,
  buildRuntimeIntelligenceGraphForFrameworkState,
} from './runtimeIntelligenceGraphService.js'

const VMF_UPDATE_PERMISSION = 'VMF_UPDATE'
const EXPECTED_UPDATED_AT_TOLERANCE_MS = 1000

const normalizeToken = (value) => String(value || '').trim().toUpperCase()
const normalizeKey = (value) => String(value || '').trim().toLowerCase()
const deepClone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

const resolveQueryValue = async (queryOrValue) => {
  if (queryOrValue && typeof queryOrValue.lean === 'function') {
    return await queryOrValue.lean()
  }

  return queryOrValue
}

const buildRuntimeLookupFilter = (runtimeInstanceId) => {
  const normalizedRuntimeInstanceId = String(runtimeInstanceId || '').trim()
  if (mongoose.Types.ObjectId.isValid(normalizedRuntimeInstanceId)) {
    return { _id: normalizedRuntimeInstanceId }
  }

  return { runtimeInstanceKey: normalizeKey(normalizedRuntimeInstanceId) }
}

const getSourceUpdatedAtIso = (runtimeInstance) => (
  runtimeInstance?.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : String(runtimeInstance?.updatedAt || '')
)

const buildRevisionError = ({ status, code, message, reason, details = {} }) =>
  createRuntimeInstanceError({
    status,
    code,
    message,
    reason,
    details,
  })

const assertExpectedUpdatedAt = ({ runtimeInstance, expectedUpdatedAt }) => {
  const expectedTime = new Date(expectedUpdatedAt).getTime()
  const currentTime = new Date(runtimeInstance?.updatedAt).getTime()
  const deltaMs = Math.abs(expectedTime - currentTime)

  if (
    !Number.isFinite(expectedTime)
    || !Number.isFinite(currentTime)
    || deltaMs > EXPECTED_UPDATED_AT_TOLERANCE_MS
  ) {
    throw buildRevisionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime instance has changed since the renderer projection was loaded.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_STALE,
      details: {
        expectedUpdatedAt,
        currentUpdatedAt: getSourceUpdatedAtIso(runtimeInstance),
        toleranceMs: EXPECTED_UPDATED_AT_TOLERANCE_MS,
      },
    })
  }
}

const getSnapshotId = (snapshot = {}) => String(snapshot.snapshotId || snapshot.id || '').trim()
const getSnapshotHash = (snapshot = {}) => String(snapshot.snapshotHash || snapshot.hash || '').trim()
const getReplayAnchorId = (anchor = {}) => String(anchor.replayAnchorId || anchor.anchorId || anchor.id || '').trim()
const getReplayAnchorHash = (anchor = {}) => String(anchor.replayAnchorHash || anchor.anchorHash || anchor.hash || '').trim()

const assertSourceCanCreateRevision = (sourceRuntimeInstance) => {
  const frameworkState = sourceRuntimeInstance.framework_state || {}
  const lifecycleStage = normalizeToken(frameworkState.lifecycle?.stage)
  const publish = frameworkState.publish || {}
  const lock = frameworkState.lock || {}
  const publishSnapshot = publish.snapshot || {}
  const lockSnapshot = lock.snapshot || {}
  const replayAnchor = lock.replayAnchor || lock.anchor || {}

  if (normalizeToken(sourceRuntimeInstance.runtimeType) !== RUNTIME_TYPES.VALUE_NARRATIVE) {
    throw buildRevisionError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Only Value Narrative runtime instances can create runtime revisions.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_UNSUPPORTED_RUNTIME_TYPE,
      details: { runtimeType: sourceRuntimeInstance.runtimeType },
    })
  }

  if (normalizeToken(publish.state) !== 'PUBLISHED' || publish.published !== true || lifecycleStage === 'DRAFT') {
    throw buildRevisionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime revision source must be published before a revision can be created.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_SOURCE_NOT_PUBLISHED,
      details: {
        publishState: publish.state || '',
        published: Boolean(publish.published),
        lifecycleStage,
      },
    })
  }

  if (
    normalizeToken(sourceRuntimeInstance.status) !== RUNTIME_INSTANCE_STATUSES.LOCKED
    || normalizeToken(lock.state) !== 'LOCKED'
    || lock.locked !== true
  ) {
    throw buildRevisionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime revision source must be locked before a revision can be created.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_SOURCE_NOT_LOCKED,
      details: {
        runtimeStatus: sourceRuntimeInstance.status || '',
        lockState: lock.state || '',
        locked: Boolean(lock.locked),
      },
    })
  }

  if (!getSnapshotId(publishSnapshot) || !getSnapshotHash(publishSnapshot)) {
    throw buildRevisionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime revision source is missing publish snapshot proof.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_PUBLISH_SNAPSHOT_REQUIRED,
      details: {
        hasSnapshotId: Boolean(getSnapshotId(publishSnapshot)),
        hasSnapshotHash: Boolean(getSnapshotHash(publishSnapshot)),
      },
    })
  }

  if (!getSnapshotId(lockSnapshot) || !getSnapshotHash(lockSnapshot)) {
    throw buildRevisionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime revision source is missing lock snapshot proof.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_LOCK_SNAPSHOT_REQUIRED,
      details: {
        hasSnapshotId: Boolean(getSnapshotId(lockSnapshot)),
        hasSnapshotHash: Boolean(getSnapshotHash(lockSnapshot)),
      },
    })
  }

  if (!getReplayAnchorId(replayAnchor) || !getReplayAnchorHash(replayAnchor)) {
    throw buildRevisionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime revision source is missing replay anchor proof.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_REPLAY_ANCHOR_REQUIRED,
      details: {
        hasReplayAnchorId: Boolean(getReplayAnchorId(replayAnchor)),
        hasReplayAnchorHash: Boolean(getReplayAnchorHash(replayAnchor)),
      },
    })
  }
}

const buildRevisionKey = ({ sourceRuntimeInstance, revisionNumber, targetId }) => {
  const sourceKey = normalizeKey(sourceRuntimeInstance.runtimeInstanceKey)
  const suffix = toIdString(targetId).slice(-8)
  const base = sourceKey
    ? `${sourceKey}-rev-${revisionNumber}`
    : `value-narrative-rev-${revisionNumber}`
  return `${base}-${suffix}`.slice(0, 160)
}

const resetRevisionFrameworkState = ({ sourceFrameworkState, nowIso }) => {
  const source = deepClone(sourceFrameworkState || {}) || {}
  return {
    ...source,
    lifecycle: {
      stage: 'DRAFT',
      sourceLifecycleStage: source.lifecycle?.stage || '',
      revisionDerivedAt: nowIso,
    },
    validation: {},
    readiness: {
      state: 'DRAFT',
      ready: false,
      submittedForReview: false,
      validationState: '',
      updatedAt: nowIso,
    },
    publish: {
      state: 'UNPUBLISHED',
      published: false,
      outputEligible: false,
      outputEligibility: {
        outputEligible: false,
        reasons: ['REVISION_DRAFT_REQUIRES_REPUBLISH'],
      },
      snapshot: {},
      evidence: {},
      sourceApproval: {},
    },
    lock: {
      state: 'UNLOCKED',
      locked: false,
      outputEligible: false,
      outputEligibility: {
        outputEligible: false,
        reasons: ['REVISION_DRAFT_REQUIRES_RELOCK'],
      },
      snapshot: {},
      replayAnchor: {},
      anchor: {},
      evidence: {},
    },
    policy: {},
    artifacts: {},
  }
}

const buildRevisionRuntimeInstance = ({
  actorUserId,
  frameworkPackage,
  reason,
  sourceRuntimeInstance,
  now,
}) => {
  try {
    requireCanonicalRuntimeStateVersion(sourceRuntimeInstance)
  } catch (error) {
    throw buildRevisionError({
      status: error.status || 409,
      code: 'CONFLICT',
      message: error.message,
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_STATE_VERSION_REQUIRED,
      details: error.details || {},
    })
  }

  const targetId = new mongoose.Types.ObjectId()
  const nowIso = now.toISOString()
  const sourceRevision = sourceRuntimeInstance.revision || {}
  const sourceRevisionNumber = Number(sourceRevision.revisionNumber) > 0 ? Number(sourceRevision.revisionNumber) : 1
  const revisionNumber = sourceRevisionNumber + 1
  const frameworkState = sourceRuntimeInstance.framework_state || {}
  const publishSnapshot = frameworkState.publish?.snapshot || {}
  const lockSnapshot = frameworkState.lock?.snapshot || {}
  const replayAnchor = frameworkState.lock?.replayAnchor || frameworkState.lock?.anchor || {}
  const rootRuntimeId = sourceRevision.rootRuntimeId || sourceRuntimeInstance._id
  const rootRuntimeInstanceKey = sourceRevision.rootRuntimeInstanceKey || sourceRuntimeInstance.runtimeInstanceKey || ''

  const runtimeInstanceKey = buildRevisionKey({
    sourceRuntimeInstance,
    revisionNumber,
    targetId,
  })
  const revisionFrameworkState = resetRevisionFrameworkState({
    sourceFrameworkState: frameworkState,
    nowIso,
  })
  const revisionRuntimeInstance = new RuntimeInstance({
    _id: targetId,
    runtimeInstanceKey,
    customerId: sourceRuntimeInstance.customerId,
    tenantId: sourceRuntimeInstance.tenantId,
    workspaceId: sourceRuntimeInstance.workspaceId || '',
    runtimeType: sourceRuntimeInstance.runtimeType,
    frameworkKey: sourceRuntimeInstance.frameworkKey,
    packageId: sourceRuntimeInstance.packageId,
    packageKey: sourceRuntimeInstance.packageKey,
    packageVersion: sourceRuntimeInstance.packageVersion,
    dependencyLockId: sourceRuntimeInstance.dependencyLockId,
    activationId: sourceRuntimeInstance.activationId,
    deploymentId: sourceRuntimeInstance.deploymentId,
    evidence: deepClone(sourceRuntimeInstance.evidence || {}),
    stateVersion: createRuntimeStateVersion(),
    revision: {
      revisionNumber,
      parentRuntimeId: sourceRuntimeInstance._id,
      parentRuntimeInstanceKey: sourceRuntimeInstance.runtimeInstanceKey || '',
      rootRuntimeId,
      rootRuntimeInstanceKey,
      createdFromRevision: sourceRevisionNumber,
      revisionReason: reason,
      derivedFromPublishSnapshotId: getSnapshotId(publishSnapshot),
      derivedFromPublishSnapshotHash: getSnapshotHash(publishSnapshot),
      derivedFromLockSnapshotId: getSnapshotId(lockSnapshot),
      derivedFromLockSnapshotHash: getSnapshotHash(lockSnapshot),
      derivedFromReplayAnchorId: getReplayAnchorId(replayAnchor),
      derivedFromReplayAnchorHash: getReplayAnchorHash(replayAnchor),
      createdAt: now,
      createdBy: actorUserId,
    },
    status: RUNTIME_INSTANCE_STATUSES.ACTIVE,
    executionStatus: RUNTIME_EXECUTION_STATUSES.IDLE,
    runtimeMode: sourceRuntimeInstance.runtimeMode || RUNTIME_MODES.INTERACTIVE,
    runtimeCapacitySlot: null,
    name: `${sourceRuntimeInstance.name || 'Value Narrative'} Revision ${revisionNumber}`.slice(0, 255),
    description: sourceRuntimeInstance.description || '',
    framework_state: revisionFrameworkState,
    lockedAt: null,
    lockedBy: null,
    lockedReason: '',
    assignedTo: Array.isArray(sourceRuntimeInstance.assignedTo)
      ? sourceRuntimeInstance.assignedTo.map((assignee) => assignee?._id || assignee)
      : [],
    anchors: Array.isArray(sourceRuntimeInstance.anchors) ? deepClone(sourceRuntimeInstance.anchors) : [],
    createdBy: actorUserId,
    updatedBy: actorUserId,
  })

  revisionRuntimeInstance.framework_state.intelligence_graph = buildRuntimeIntelligenceGraphForFrameworkState({
    actorUserId,
    buildTrigger: RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EXPLICIT_REBUILD,
    builtAt: nowIso,
    frameworkPackage,
    frameworkState: revisionFrameworkState,
    runtimeInstance: revisionRuntimeInstance,
  })
  revisionRuntimeInstance.markModified('framework_state.intelligence_graph')

  return revisionRuntimeInstance
}

const saveRevisionRuntimeInstance = async ({ runtimeInstance, session = null }) => {
  try {
    if (session) {
      await runtimeInstance.save({ session })
      return
    }

    await runtimeInstance.save()
  } catch (err) {
    if (err?.code === 11000 && err?.keyPattern?.runtimeInstanceKey) {
      throw buildRevisionError({
        status: 409,
        code: 'CONFLICT',
        message: 'Runtime revision key already exists.',
        reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_KEY_CONFLICT,
        details: { runtimeInstanceKey: runtimeInstance.runtimeInstanceKey },
      })
    }

    if (err?.code === 11000 && err?.keyPattern?.['revision.parentRuntimeId']) {
      throw buildRevisionError({
        status: 409,
        code: 'CONFLICT',
        message: 'A runtime revision already exists for this locked source.',
        reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_BRANCH_UNSUPPORTED,
        details: {
          sourceRuntimeInstanceId: toIdString(runtimeInstance.revision?.parentRuntimeId),
          runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
        },
      })
    }

    throw err
  }
}

const logRuntimeRevisionCreated = async ({
  actorUserId,
  auditRequest,
  sourceRuntimeInstance,
  revisionRuntimeInstance,
  session = null,
}) => {
  const source = serializeRuntimeInstance(sourceRuntimeInstance)
  const revision = serializeRuntimeInstance(revisionRuntimeInstance)
  const auditPayload = {
    action: auditService.AUDIT_ACTIONS.RUNTIME_REVISION_CREATED,
    resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
    resourceId: revisionRuntimeInstance._id,
    actorUserId,
    scope: {
      customerId: revision.customerId,
      tenantId: revision.tenantId,
      runtimeInstanceId: revision.id,
      sourceRuntimeInstanceId: source.id,
    },
    diff: {
      revision: revision.revision,
      sourceRuntimeInstance: {
        id: source.id,
        runtimeInstanceKey: source.runtimeInstanceKey,
        status: source.status,
        revision: source.revision,
      },
      targetRuntimeInstance: {
        id: revision.id,
        runtimeInstanceKey: revision.runtimeInstanceKey,
        status: revision.status,
        lifecycleStage: revision.framework_state?.lifecycle?.stage || '',
      },
      resetState: {
        validation: true,
        readiness: true,
        publish: true,
        lock: true,
        policy: true,
        artifacts: true,
      },
    },
  }

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
    throw buildRevisionError({
      status: 500,
      code: 'RUNTIME_REVISION_AUDIT_FAILED',
      message: 'Runtime revision creation audit could not be persisted.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_AUDIT_PERSISTENCE_FAILED,
    })
  }
}

const persistRevisionWithAudit = async ({
  actorUserId,
  auditRequest,
  sourceRuntimeInstance,
  revisionRuntimeInstance,
}) => {
  if (mongoose.connection.readyState === 1) {
    const session = await mongoose.startSession()
    let serializedRevision = null

    try {
      await session.withTransaction(async () => {
        await assertNoExistingChildRevision(sourceRuntimeInstance, { session })
        await saveRevisionRuntimeInstance({ runtimeInstance: revisionRuntimeInstance, session })
        await stageRuntimeStateRevisionProvisioning({
          sourceRuntimeInstance,
          revisionRuntimeInstance,
          session,
        })
        await logRuntimeRevisionCreated({
          actorUserId,
          auditRequest,
          sourceRuntimeInstance,
          revisionRuntimeInstance,
          session,
        })
        serializedRevision = serializeRuntimeInstance(revisionRuntimeInstance)
      })
    } finally {
      await session.endSession()
    }

    return serializedRevision
  }

  await saveRevisionRuntimeInstance({ runtimeInstance: revisionRuntimeInstance })

  try {
    await logRuntimeRevisionCreated({
      actorUserId,
      auditRequest,
      sourceRuntimeInstance,
      revisionRuntimeInstance,
    })
  } catch (err) {
    try {
      await RuntimeInstance.deleteOne({ _id: revisionRuntimeInstance._id })
    } catch {
      err.details = {
        ...(err.details || {}),
        rollbackFailed: true,
      }
    }

    throw err
  }

  return serializeRuntimeInstance(revisionRuntimeInstance)
}

const withSession = (query, session) => (
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query
)

const assertNoExistingChildRevision = async (sourceRuntimeInstance, { session = null } = {}) => {
  const childRevision = await resolveQueryValue(withSession(RuntimeInstance.findOne({
    customerId: sourceRuntimeInstance.customerId,
    tenantId: sourceRuntimeInstance.tenantId,
    'revision.parentRuntimeId': sourceRuntimeInstance._id,
  }), session))

  if (childRevision) {
    throw buildRevisionError({
      status: 409,
      code: 'CONFLICT',
      message: 'A runtime revision already exists for this locked source.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_BRANCH_UNSUPPORTED,
      details: {
        sourceRuntimeInstanceId: toIdString(sourceRuntimeInstance._id),
        childRuntimeInstanceId: toIdString(childRevision._id || childRevision.id),
        childRuntimeInstanceKey: childRevision.runtimeInstanceKey || '',
      },
    })
  }
}

export const createRuntimeRevision = async ({
  actorUserId,
  auditRequest,
  scopes,
  runtimeInstanceId,
  payload,
} = {}) => {
  const sourceRuntimeInstance = await resolveQueryValue(RuntimeInstance.findOne(buildRuntimeLookupFilter(runtimeInstanceId)))

  if (!sourceRuntimeInstance) {
    throw buildRevisionError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Runtime revision source was not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_SOURCE_NOT_FOUND,
      details: { runtimeInstanceId },
    })
  }

  await assertRuntimePermission({
    actorUserId,
    scopes,
    customerId: sourceRuntimeInstance.customerId,
    tenantId: sourceRuntimeInstance.tenantId,
    permission: VMF_UPDATE_PERMISSION,
  })

  assertExpectedUpdatedAt({
    runtimeInstance: sourceRuntimeInstance,
    expectedUpdatedAt: payload.expectedUpdatedAt,
  })
  assertSourceCanCreateRevision(sourceRuntimeInstance)

  const frameworkPackage = await resolveQueryValue(FrameworkPackage.findById(sourceRuntimeInstance.packageId))
  if (!frameworkPackage) {
    throw buildRevisionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime revision source Framework Package was not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_REVISION_SOURCE_NOT_FOUND,
      details: { packageId: toIdString(sourceRuntimeInstance.packageId) },
    })
  }

  const revisionRuntimeInstance = buildRevisionRuntimeInstance({
    actorUserId,
    frameworkPackage,
    reason: String(payload.reason || '').trim(),
    sourceRuntimeInstance,
    now: new Date(),
  })

  return persistRevisionWithAudit({
    actorUserId,
    auditRequest,
    sourceRuntimeInstance,
    revisionRuntimeInstance,
  })
}

export default {
  createRuntimeRevision,
}
