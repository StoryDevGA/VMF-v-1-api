import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeStateMigrationReceipt, {
  RUNTIME_STATE_MIGRATION_OPERATION_TYPES,
  RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES,
} from '../models/RuntimeStateMigrationReceipt.js'
import logger from '../config/logger.js'
import { createRuntimeStateGraphCandidate } from './runtimeStateGraphCandidateService.js'
import { promoteRuntimeStateGraphCandidate } from './runtimeStateGraphPromotionService.js'

const ERROR_CODE = 'RUNTIME_STATE_V2_GRAPH_SOURCE_MUTATION_INVALID'

const fail = (message, details = {}) => {
  const error = new Error(message)
  error.code = ERROR_CODE
  error.status = 409
  error.details = details
  throw error
}

const normalizeIdentity = (value) => String(value?._id || value || '').trim()

const scopeFromRuntime = (runtimeInstance) => ({
  customerId: normalizeIdentity(runtimeInstance?.customerId),
  tenantId: normalizeIdentity(runtimeInstance?.tenantId),
  runtimeInstanceId: normalizeIdentity(runtimeInstance?._id),
  runtimeInstanceKey: String(runtimeInstance?.runtimeInstanceKey || '').trim().toLowerCase(),
})

const scopeFilter = (scope) => ({
  customerId: scope.customerId,
  tenantId: scope.tenantId,
  runtimeInstanceId: scope.runtimeInstanceId,
  runtimeInstanceKey: scope.runtimeInstanceKey,
})

const executeFind = async (model, filter, { session = null, limit = 0 } = {}) => {
  let query = model.find(filter)
  if (session && typeof query?.session === 'function') query = query.session(session)
  if (limit && typeof query?.limit === 'function') query = query.limit(limit)
  if (typeof query?.lean === 'function') query = query.lean()
  return query
}

const executeFindOne = async (model, filter, { session = null } = {}) => {
  let query = model.findOne(filter)
  if (session && typeof query?.session === 'function') query = query.session(session)
  if (typeof query?.lean === 'function') query = query.lean()
  return query
}

const executeCount = async (model, filter, { session = null } = {}) => {
  let query = model.countDocuments(filter)
  if (session && typeof query?.session === 'function') query = query.session(session)
  return query
}

const mutationCount = (result) => result?.modifiedCount ?? result?.nModified ?? result?.matchedCount ?? result?.n ?? 0

const assertScope = (scope) => {
  if (Object.values(scope).some((value) => !normalizeIdentity(value))) {
    fail('Runtime V2 graph source scope is incomplete.')
  }
}

const resolveVerifiedReceipt = async ({ models, runtimeInstance, scope, session }) => {
  const receipts = await executeFind(models.RuntimeStateMigrationReceipt, {
    customerId: scope.customerId,
    tenantId: scope.tenantId,
    runtimeInstanceId: runtimeInstance?.revision?.rootRuntimeId || runtimeInstance?._id,
    runtimeInstanceKey: runtimeInstance?.revision?.rootRuntimeInstanceKey || runtimeInstance?.runtimeInstanceKey,
    operationType: {
      $in: [
        RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE,
        RUNTIME_STATE_MIGRATION_OPERATION_TYPES.NATIVE_INITIALIZATION,
      ],
    },
    status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED,
  }, { session, limit: 2 })

  if (receipts.length > 1) {
    fail('Runtime V2 graph receipt lineage is ambiguous.', { receiptCount: receipts.length })
  }
  return receipts[0] || null
}

export const stageRuntimeStateGraphSourceMutation = async ({
  runtimeInstance,
  expectedStateVersion,
  graphWillRebuild = false,
  session,
  dependencies = {},
} = {}) => {
  if (!session) fail('Runtime V2 graph stale transition requires the source transaction session.')

  const models = {
    RuntimeGraphElement: dependencies.RuntimeGraphElement || RuntimeGraphElement,
    RuntimeGraphSnapshot: dependencies.RuntimeGraphSnapshot || RuntimeGraphSnapshot,
    RuntimeStateMigrationReceipt: dependencies.RuntimeStateMigrationReceipt || RuntimeStateMigrationReceipt,
  }
  const scope = scopeFromRuntime(runtimeInstance)
  assertScope(scope)

  const snapshots = await executeFind(models.RuntimeGraphSnapshot, {
    ...scopeFilter(scope),
    current: true,
  }, { session, limit: 2 })
  if (snapshots.length > 1) {
    fail('Runtime V2 graph has more than one current snapshot.', { currentSnapshotCount: snapshots.length })
  }

  const receipt = await resolveVerifiedReceipt({ models, runtimeInstance, scope, session })
  const snapshot = snapshots[0] || null
  if (!snapshot) {
    const strayElement = await executeFindOne(models.RuntimeGraphElement, {
      ...scopeFilter(scope),
      current: true,
    }, { session })
    if (strayElement) fail('Runtime V2 graph has current elements without a current snapshot.')
    if (graphWillRebuild && !receipt) {
      fail('Runtime V2 graph rebuild requires one verified baseline receipt.')
    }
    return {
      migrationReceiptId: receipt?.receiptId || null,
      previousSnapshotId: null,
      status: 'MISSING',
    }
  }

  if (normalizeIdentity(snapshot.stateVersion) !== normalizeIdentity(expectedStateVersion)) {
    fail('Runtime V2 graph current snapshot does not match the source state version.', {
      graphStateVersion: snapshot.stateVersion,
      expectedStateVersion,
    })
  }
  if (!receipt || normalizeIdentity(snapshot.migrationReceiptId) !== normalizeIdentity(receipt.receiptId)) {
    fail('Runtime V2 graph migration receipt lineage does not match the verified baseline receipt.')
  }

  const expectedElementCount = Number(snapshot.counts?.nodeCount || 0) + Number(snapshot.counts?.edgeCount || 0)
  const scopedCurrentElementCount = await executeCount(models.RuntimeGraphElement, {
    ...scopeFilter(scope),
    current: true,
  }, { session })
  if (scopedCurrentElementCount !== expectedElementCount) {
    fail('Runtime V2 graph current element set does not match the declared snapshot count.', {
      expectedElementCount,
      scopedCurrentElementCount,
    })
  }
  const elementResult = await models.RuntimeGraphElement.updateMany({
    ...scopeFilter(scope),
    current: true,
    snapshotId: snapshot.snapshotId,
    stateVersion: snapshot.stateVersion,
    migrationReceiptId: snapshot.migrationReceiptId,
  }, { $set: { current: false } }, { session })
  if (mutationCount(elementResult) !== expectedElementCount) {
    fail('Runtime V2 graph element stale transition did not match the declared snapshot count.', {
      expectedElementCount,
      changedElementCount: mutationCount(elementResult),
    })
  }

  const snapshotResult = await models.RuntimeGraphSnapshot.updateOne({
    ...scopeFilter(scope),
    current: true,
    snapshotId: snapshot.snapshotId,
    stateVersion: snapshot.stateVersion,
    migrationReceiptId: snapshot.migrationReceiptId,
  }, { $set: { current: false, stateStatus: 'STALE' } }, { session })
  if (mutationCount(snapshotResult) !== 1) {
    fail('Runtime V2 graph snapshot stale transition did not match the current snapshot.')
  }

  return {
    migrationReceiptId: receipt.receiptId,
    previousSnapshotId: snapshot.snapshotId,
    status: 'STALE',
  }
}

const refreshRuntimeInstance = async ({ models, runtimeInstance }) => executeFindOne(models.RuntimeInstance, {
  _id: runtimeInstance._id,
  customerId: runtimeInstance.customerId,
  tenantId: runtimeInstance.tenantId,
  runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
  stateVersion: runtimeInstance.stateVersion,
})

export const finalizeRuntimeStateGraphSourceMutation = async ({
  actorUserId,
  graph,
  migrationReceiptId,
  runtimeInstance,
  dependencies = {},
} = {}) => {
  if (!graph) return { runtimeInstance, status: 'STALE_ONLY' }
  const models = {
    RuntimeInstance: dependencies.RuntimeInstance || RuntimeInstance,
  }
  const createCandidate = dependencies.createRuntimeStateGraphCandidate || createRuntimeStateGraphCandidate
  const promoteCandidate = dependencies.promoteRuntimeStateGraphCandidate || promoteRuntimeStateGraphCandidate
  let promotion
  try {
    if (graph.validation?.status !== 'VALID') {
      fail('Only a rebuilt valid runtime graph can be promoted after a source mutation.')
    }
    if (!migrationReceiptId) fail('Runtime V2 graph promotion requires verified receipt lineage.')

    const candidate = createCandidate({
      graph,
      scope: scopeFromRuntime(runtimeInstance),
      stateVersion: runtimeInstance.stateVersion,
      migrationReceiptId: normalizeIdentity(migrationReceiptId),
    })
    promotion = await promoteCandidate({
      actorUserId,
      candidate,
      ...(dependencies.promotionDependencies ? { dependencies: dependencies.promotionDependencies } : {}),
    })
  } catch (error) {
    logger.error({
      err: error,
      runtimeInstanceId: normalizeIdentity(runtimeInstance?._id),
      stateVersion: runtimeInstance?.stateVersion,
    }, 'runtime V2 graph promotion failed after committed source mutation')
    const promotionOutcomeMayBeCommitted = error?.details?.committed === true
      || error?.code === 'RUNTIME_STATE_V2_GRAPH_COMMIT_AMBIGUOUS'
    if (promotionOutcomeMayBeCommitted) {
      try {
        const reconciledRuntimeInstance = await refreshRuntimeInstance({ models, runtimeInstance })
        if (!reconciledRuntimeInstance) throw new Error('Ambiguous promotion root could not be read back.')
        return {
          errorCode: error.code,
          runtimeInstance: reconciledRuntimeInstance,
          status: 'PROMOTION_RECONCILED',
        }
      } catch (reconciliationError) {
        const ambiguousError = new Error('Runtime V2 graph promotion outcome is ambiguous after the source mutation committed.')
        ambiguousError.code = error?.code || 'RUNTIME_STATE_V2_GRAPH_PROMOTION_AMBIGUOUS'
        ambiguousError.status = 503
        ambiguousError.details = {
          sourceMutationCommitted: true,
          reconciliationFailed: true,
          reconciliationError: reconciliationError.message,
        }
        throw ambiguousError
      }
    }
    return {
      errorCode: error?.code || 'RUNTIME_STATE_V2_GRAPH_PROMOTION_FAILED',
      runtimeInstance,
      status: 'PROMOTION_FAILED',
    }
  }

  try {
    const refreshedRuntimeInstance = await refreshRuntimeInstance({ models, runtimeInstance })
    if (!refreshedRuntimeInstance) throw new Error('Promoted runtime V2 graph root could not be read back.')
    return {
      promotion,
      runtimeInstance: refreshedRuntimeInstance,
      status: promotion.status,
    }
  } catch (error) {
    logger.error({
      err: error,
      runtimeInstanceId: normalizeIdentity(runtimeInstance?._id),
      stateVersion: runtimeInstance?.stateVersion,
    }, 'runtime V2 graph promotion committed but root readback failed')
    return {
      promotion,
      runtimeInstance: promotion?.updatedAt
        ? { ...(runtimeInstance?.toObject?.() || runtimeInstance), updatedAt: promotion.updatedAt }
        : runtimeInstance,
      status: promotion.status,
    }
  }
}

export { ERROR_CODE as RUNTIME_STATE_V2_GRAPH_SOURCE_MUTATION_ERROR_CODE }
