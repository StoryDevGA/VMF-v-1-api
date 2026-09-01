import mongoose from 'mongoose'

import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeStateMigrationReceipt, {
  RUNTIME_STATE_MIGRATION_OPERATION_TYPES,
  RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES,
} from '../models/RuntimeStateMigrationReceipt.js'
import {
  assertCanonicalRuntimeStateVersionAssignment,
  createRuntimeStateMigrationAuthorityBindingDigest,
  createRuntimeStateMigrationPlanIdentity,
  createRuntimeStateMigrationReceiptIdentity,
  isServerAuthorizedRuntimeStateMigrationPlan,
  assertRuntimeStateMigrationReceiptIdempotency,
  reconcileRuntimeStateMigrationBaseline,
  RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES,
  stableJson,
  verifyAuthorityToken,
} from './runtimeStateMigrationReceiptService.js'
import { createRuntimeStateVersion } from './runtimeStateVersionService.js'

const createApplyError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.status = code === RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.COMMIT_AMBIGUOUS ? 409 : 422
  error.details = details
  return error
}

const readOne = async (model, filter, session) => {
  let query = model.findOne(filter)
  if (session && query && typeof query.session === 'function') query = query.session(session)
  if (query && typeof query.lean === 'function') query = query.lean()
  if (query && typeof query.exec === 'function') return query.exec()
  return query
}

const assertOneMutation = (result, code, message) => {
  const matched = Number(result?.matchedCount ?? result?.n ?? 0)
  const modified = Number(result?.modifiedCount ?? result?.nModified ?? 0)
  if (matched !== 1 || modified !== 1) {
    throw createApplyError(code, message, { matchedCount: matched, modifiedCount: modified })
  }
}

const isUnknownCommitResult = (error) => (
  error?.errorLabels?.includes('UnknownTransactionCommitResult')
  || error?.codeName === 'UnknownTransactionCommitResult'
)

export const executeTransactionOnce = async ({ session, callback, options }) => {
  if (
    !session
    || typeof session.startTransaction !== 'function'
    || typeof session.commitTransaction !== 'function'
    || typeof session.abortTransaction !== 'function'
  ) throw createApplyError(
    RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.RECEIPT_UPDATE_FAILED,
    'The SS-014 baseline requires an explicit transaction session.',
  )

  session.startTransaction(options)
  try {
    const result = await callback()
    await session.commitTransaction()
    return result
  } catch (error) {
    if (!isUnknownCommitResult(error)) {
      try {
        if (typeof session.inTransaction !== 'function' || session.inTransaction()) {
          await session.abortTransaction()
        }
      } catch {
        // Preserve the primary transaction error; reconciliation remains fail closed.
      }
    }
    throw error
  }
}

const assertApplyPlanMatchesReceipt = ({
  plan,
  receipt,
  scopeDigest,
  now = new Date(),
  requireUnexpiredAuthority = true,
}) => {
  if (!isServerAuthorizedRuntimeStateMigrationPlan(plan)) {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_TRUSTED,
      'The baseline apply requires a server-branded SS-014 plan.',
    )
  }
  if (
    plan.applyAuthority !== true
    || plan.approvalStatus !== 'APPLY_AUTHORIZED'
    || receipt.planHashRef?.status !== 'APPLY_AUTHORIZED'
    || receipt.planHashRef?.value !== plan.planHash
  ) {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED,
      'The baseline receipt is not bound to an apply-authoritative server plan.',
    )
  }
  if (
    !scopeDigest
    || scopeDigest !== plan.scopeDigest
    || scopeDigest !== receipt.scopeDigest
  ) {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH,
      'The supplied SS-014 scope digest does not match the approved receipt and plan.',
    )
  }
  if (
    requireUnexpiredAuthority
    && !(new Date(now) < new Date(plan.approvedScopeBinding?.authorization?.expiresAt))
  ) {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED,
      'The one-use SS-014 apply authorization is expired.',
    )
  }
  if (stableJson(createRuntimeStateMigrationPlanIdentity(plan)) !== stableJson(createRuntimeStateMigrationReceiptIdentity(receipt))) {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH,
      'The baseline receipt is not bound to the complete server plan identity.',
    )
  }
  if (
    receipt.operationType !== RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE
    || plan.operationType !== RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE
    || receipt.scopeDigest !== plan.scopeDigest
    || receipt.runtimeInstanceId?.toString() !== plan.runtimeInstanceId?.toString()
    || receipt.runtimeInstanceKey !== plan.runtimeInstanceKey
    || receipt.backupManifestRef !== plan.backupManifestRef
  ) {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH,
      'The baseline receipt and server plan target different immutable scope.',
    )
  }
  const expectedBindingDigest = createRuntimeStateMigrationAuthorityBindingDigest(plan)
  if (receipt.authority?.bindingDigest !== expectedBindingDigest) {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH,
      'The baseline receipt authority binding does not match the server plan.',
    )
  }
}

const assertRootReadyForBaseline = ({ runtime, receipt, assignedStateVersion }) => {
  const hasCanonicalField = Object.prototype.hasOwnProperty.call(runtime || {}, 'stateVersion')
  const hasCompatibilityField = Object.prototype.hasOwnProperty.call(runtime || {}, 'runtimeStateVersion')
  if (hasCanonicalField || hasCompatibilityField) {
    assertCanonicalRuntimeStateVersionAssignment({
      runtime,
      receipt: {
        status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ASSIGNED,
        assignedStateVersion,
      },
      assignedStateVersion,
    })
  }
}

const assertBackupVerification = async ({ verifyBackupManifest, receipt, plan }) => {
  if (typeof verifyBackupManifest !== 'function') {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.BACKUP_VERIFICATION_REQUIRED,
      'A verified SS-014 backup manifest is required before any baseline write.',
    )
  }
  const evidence = await verifyBackupManifest({
    backupManifestRef: receipt.backupManifestRef,
    plan,
    contract: 'ss014-backup-restore-manifest-v1',
  })
  if (
    evidence?.verified !== true
    || evidence.manifestDigest !== receipt.backupManifestRef
    || evidence.isolatedRestore?.performed !== true
    || evidence.isolatedRestore?.hashMatches !== true
    || evidence.isolatedRestore?.rootMatches !== true
  ) {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.BACKUP_VERIFICATION_FAILED,
      'The SS-014 backup manifest or isolated restore evidence is not verified.',
    )
  }
  return evidence
}

export const applyRuntimeStateMigrationBaseline = async ({
  receiptId,
  token,
  scopeDigest,
  plan,
  verifyBackupManifest,
  now = new Date(),
  startSession = () => mongoose.startSession(),
  receiptModel = RuntimeStateMigrationReceipt,
  runtimeModel = RuntimeInstance,
} = {}) => {
  if (!receiptId || !plan) {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.RECEIPT_NOT_FOUND,
      'A receipt identifier and server-authorized plan are required.',
    )
  }
  if (!isServerAuthorizedRuntimeStateMigrationPlan(plan)) {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_TRUSTED,
      'The baseline apply requires a server-branded SS-014 plan.',
    )
  }

  const preflightReceipt = await readOne(receiptModel, { receiptId }, null)
  if (!preflightReceipt) {
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.RECEIPT_NOT_FOUND,
      'The SS-014 baseline receipt was not found.',
    )
  }
  const committedReplay = preflightReceipt.status !== RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.PLANNED
  assertApplyPlanMatchesReceipt({
    plan,
    receipt: preflightReceipt,
    scopeDigest,
    now,
    requireUnexpiredAuthority: !committedReplay,
  })
  assertRuntimeStateMigrationReceiptIdempotency({
    existing: preflightReceipt,
    candidate: preflightReceipt,
  })
  if (committedReplay) {
    const reconciliation = await reconcileRuntimeStateMigrationBaseline({
      receiptId,
      receiptModel,
      runtimeModel,
    })
    if (reconciliation.status === 'COMMITTED') {
      return {
        status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED,
        assignedStateVersion: preflightReceipt.assignedStateVersion,
        receiptId,
        idempotentReplay: true,
      }
    }
    throw createApplyError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.RECONCILIATION_AMBIGUOUS,
      'The existing SS-014 receipt requires read-only reconciliation before retry.',
      reconciliation,
    )
  }
  await assertBackupVerification({ verifyBackupManifest, receipt: preflightReceipt, plan })

  const assignedStateVersion = createRuntimeStateVersion()
  const session = await startSession()
  try {
    let result = null
    try {
      await executeTransactionOnce({ session, callback: async () => {
        const receipt = await readOne(receiptModel, { receiptId }, session)
        if (!receipt) {
          throw createApplyError(
            RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.RECEIPT_NOT_FOUND,
            'The SS-014 baseline receipt disappeared before the transaction read.',
          )
        }
        assertApplyPlanMatchesReceipt({ plan, receipt, scopeDigest, now })
        assertRuntimeStateMigrationReceiptIdempotency({ existing: receipt, candidate: receipt })
        if (receipt.authority?.consumedAt) {
          verifyAuthorityToken({ receipt, token, scopeDigest, now })
        }
        if (receipt.status !== RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.PLANNED) {
          throw createApplyError(
            RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.INVALID_TRANSITION,
            'Only a planned SS-014 baseline receipt may be applied.',
          )
        }
        verifyAuthorityToken({ receipt, token, scopeDigest, now })

        const runtime = await readOne(runtimeModel, {
          _id: receipt.runtimeInstanceId,
          customerId: receipt.customerId,
          tenantId: receipt.tenantId,
          runtimeInstanceKey: receipt.runtimeInstanceKey,
        }, session)
        if (!runtime) {
          throw createApplyError(
            RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.RUNTIME_NOT_FOUND,
            'The selected RuntimeInstance was not found inside the transaction.',
          )
        }
        assertRootReadyForBaseline({ runtime, receipt, assignedStateVersion })

        const applying = await receiptModel.updateOne(
          { receiptId, status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.PLANNED, 'authority.consumedAt': null },
          { $set: { status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.APPLYING } },
          { session, runValidators: true },
        )
        assertOneMutation(
          applying,
          RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.RECEIPT_UPDATE_FAILED,
          'The planned SS-014 receipt could not advance to APPLYING.',
        )

        const runtimeUpdate = await runtimeModel.updateOne(
          {
            _id: receipt.runtimeInstanceId,
            customerId: receipt.customerId,
            tenantId: receipt.tenantId,
            runtimeInstanceKey: receipt.runtimeInstanceKey,
            stateVersion: { $exists: false },
            runtimeStateVersion: { $exists: false },
          },
          { $set: { stateVersion: assignedStateVersion } },
          { session, runValidators: true, timestamps: false },
        )
        assertOneMutation(
          runtimeUpdate,
          RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.RUNTIME_CONDITIONAL_UPDATE_FAILED,
          'The RuntimeInstance version-absent predicate did not match exactly one target.',
        )

        const assigned = await receiptModel.updateOne(
          {
            receiptId,
            status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.APPLYING,
            assignedStateVersion: null,
          },
          {
            $set: {
              status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ASSIGNED,
              assignedStateVersion,
              assignedAt: now,
              'authority.consumedAt': now,
            },
          },
          { session, runValidators: true },
        )
        assertOneMutation(
          assigned,
          RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.RECEIPT_UPDATE_FAILED,
          'The SS-014 receipt could not record the assigned state version.',
        )

        const verified = await receiptModel.updateOne(
          { receiptId, status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ASSIGNED },
          { $set: { status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED, verifiedAt: now } },
          { session, runValidators: true },
        )
        assertOneMutation(
          verified,
          RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.RECEIPT_UPDATE_FAILED,
          'The SS-014 receipt could not advance to VERIFIED.',
        )

        const readbackReceipt = await readOne(receiptModel, { receiptId }, session)
        const readbackRuntime = await readOne(runtimeModel, {
          _id: receipt.runtimeInstanceId,
          customerId: receipt.customerId,
          tenantId: receipt.tenantId,
          runtimeInstanceKey: receipt.runtimeInstanceKey,
        }, session)
        if (
          readbackReceipt?.status !== RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED
          || readbackReceipt.assignedStateVersion !== assignedStateVersion
          || !readbackReceipt.authority?.consumedAt
          || readbackRuntime?.stateVersion !== assignedStateVersion
          || Object.prototype.hasOwnProperty.call(readbackRuntime || {}, 'runtimeStateVersion')
        ) {
          throw createApplyError(
            RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.TRANSACTION_READBACK_MISMATCH,
            'The in-transaction SS-014 receipt/runtime readback did not converge.',
          )
        }
        result = {
          status: 'VERIFIED',
          assignedStateVersion,
          receiptId,
          backupManifestRef: preflightReceipt.backupManifestRef,
        }
      }, options: {
        readConcern: { level: 'majority' },
        writeConcern: { w: 'majority', j: true },
      } })
    } catch (error) {
      if (isUnknownCommitResult(error)) {
        throw createApplyError(
          RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.COMMIT_AMBIGUOUS,
          'The SS-014 transaction commit result is ambiguous; reconcile before retrying.',
        )
      }
      throw error
    }
    return result
  } finally {
    await session.endSession()
  }
}
