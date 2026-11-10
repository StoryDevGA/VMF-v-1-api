import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import { assertRuntimePermission } from './runtimeInstanceService.js'
import { assertNoControlledReplayIsolation } from './controlledReplayIsolationService.js'
import { discoveryPolicySchema } from './discoveryPolicyContract.js'
import { assertPostLockRecordingBinding } from './postLockEvidenceIntakeContract.js'
import { readPostLockScopedRuntime, readPostLockLockedBasis, buildPostLockRecordingBinding,
  postLockStorageIndexMatches, withPostLockEvidenceTransaction } from './postLockEvidenceIntakeService.js'
import { createPostLockReadBudget, normalizePostLockReadStateError } from './postLockEvidenceReadStateService.js'
import { POST_LOCK_OPERATIONAL_CAPABILITY_VERSION, OPERATIONAL_CAPABILITY_BLOCKERS,
  OPERATIONAL_CAPABILITY_INDEX_COUNT, OPERATIONAL_CAPABILITY_INDEX_BYTES, OPERATIONAL_CAPABILITY_POLICY_BYTES,
  assertPostLockOperationalMaterial, parsePostLockOperationalCapability, postLockOperationalCapabilityError,
  isPostLockOperationalCapabilityError } from './postLockEvidenceOperationalCapabilityContract.js'

export const normalizePostLockOperationalCapabilityError = (error, readBudget) => {
  if (isPostLockOperationalCapabilityError(error)) return readBudget?.isExpired()
    ? postLockOperationalCapabilityError('DEADLINE_EXCEEDED') : error
  const normalized = normalizePostLockReadStateError(error, readBudget)
  if (normalized.details?.reason === 'POST_LOCK_READ_STATE_DEADLINE_EXCEEDED') return postLockOperationalCapabilityError('DEADLINE_EXCEEDED')
  if (normalized.details?.reason === 'POST_LOCK_READ_STATE_DEPENDENCY_UNAVAILABLE') return postLockOperationalCapabilityError('DEPENDENCY_UNAVAILABLE')
  return normalized
}
export const postLockOperationalBasisStatus = runtime => {
  const internal = runtime.__evidenceSnapshotControl
  if (typeof internal?.pointerRecorded !== 'boolean') throw postLockOperationalCapabilityError('DEPENDENCY_UNAVAILABLE')
  if (runtime.status !== 'LOCKED' || internal.runtime?.framework_state?.lock?.locked !== true) return 'LOCK_BASIS_UNAVAILABLE'
  return internal.pointerRecorded ? 'VERIFY_RECORDED' : 'NOT_RECORDED'
}

// This is the writer's existing predicate, not ordered-query or collation proof.
// Metadata is deliberately inspected outside the snapshot transaction.
export const readPostLockOperationalIndexes = async readBudget => {
  const material = []
  let matches = true
  for (const model of [RuntimeEvidenceSource, RuntimeEvidenceObject]) {
    readBudget.check()
    const cursor = model.collection.listIndexes({ ...readBudget(), batchSize: OPERATIONAL_CAPABILITY_INDEX_COUNT + 1 })
    const indexes = []
    let failure, failed = false
    try {
      while (true) {
        readBudget.check()
        const row = await cursor.next()
        readBudget.check()
        if (row === null) break
        indexes.push(row); material.push(row)
        if (indexes.length > OPERATIONAL_CAPABILITY_INDEX_COUNT) throw postLockOperationalCapabilityError('INDEX_CAPACITY_EXCEEDED')
        assertPostLockOperationalMaterial(material, OPERATIONAL_CAPABILITY_INDEX_BYTES, 'INDEX_CAPACITY_EXCEEDED')
      }
      matches = model.schema.indexes().every(([key, expected]) => postLockStorageIndexMatches(
        indexes.find(index => index.name === expected.name), key, expected)) && matches
    } catch (error) { failure = error; failed = true }
    finally {
      try { await cursor.close(); readBudget.check() }
      catch (error) { if (!failed) { failure = error; failed = true } }
    }
    if (failed) throw failure
  }
  return matches
}

export const readPostLockOperationalCapability = async (args, { readBudget = createPostLockReadBudget() } = {}) => {
  try {
    readBudget.check()
    const recording = await withPostLockEvidenceTransaction(async session => {
      readBudget.check()
      const runtime = await readPostLockScopedRuntime(args, session, readBudget)
      const checks = { authority: 'VMF_UPDATE_VERIFIED', isolation: 'CLEAR', frozenBasis: 'NOT_CHECKED',
        policy: 'NOT_CHECKED', storageIndexes: 'NOT_CHECKED' }
      try { await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes, customerId: runtime.customerId,
        tenantId: runtime.tenantId, permission: 'VMF_UPDATE', session, maxTimeMS: 2000, readBudget }) }
      catch (error) {
        if (error.status !== 403 || error.code !== 'FORBIDDEN' || error.details?.permission !== 'VMF_UPDATE'
          || error.details?.reason !== 'FORBIDDEN') throw error
        checks.authority = 'VMF_UPDATE_REQUIRED'
      }
      try { assertNoControlledReplayIsolation(runtime) }
      catch (error) {
        if (error.status !== 409 || error.code !== 'CONFLICT' || error.details?.reason !== 'CONTROLLED_REPLAY_ISOLATED') throw error
        checks.isolation = 'BLOCKED'
      }
      let binding = null
      if (checks.isolation === 'CLEAR') {
        const basisStatus = postLockOperationalBasisStatus(runtime)
        if (basisStatus !== 'VERIFY_RECORDED') checks.frozenBasis = basisStatus
        else {
          const { pointer } = await readPostLockLockedBasis(runtime, session, readBudget)
          checks.frozenBasis = 'VERIFIED'
          const pack = await FrameworkPackage.findOne({ _id: runtime.packageId }).select('_id frameworkKey packageKey version discoveryPolicy dependencyLock.snapshotId dependencyLock.snapshotHash dependencyLock.discoveryPolicy dependencyLock.discoveryPolicyHash')
            .setOptions({ session, ...readBudget() }).lean()
          assertPostLockOperationalMaterial(pack, OPERATIONAL_CAPABILITY_POLICY_BYTES, 'POLICY_CAPACITY_EXCEEDED')
          const parsed = discoveryPolicySchema.safeParse(pack?.discoveryPolicy)
          const absent = pack && (pack.discoveryPolicy === undefined || parsed.success && !parsed.data.postLockDiscoveryPolicy)
          checks.policy = absent ? 'NOT_RECORDED' : 'UNAVAILABLE'
          try {
            const hash = assertPostLockRecordingBinding({ frameworkPackage: pack, runtime })
            binding = buildPostLockRecordingBinding(runtime, pointer, hash)
            checks.policy = 'VERIFIED'
          } catch (error) {
            if (error.status !== 409 || error.code !== 'CONFLICT' || error.details?.reason !== 'POST_LOCK_POLICY_UNAVAILABLE') throw error
          }
        }
      }
      readBudget.check()
      return { checks, binding }
    }, { timeoutMS: readBudget.remainingMS() })
    if (recording.checks.policy === 'VERIFIED') recording.checks.storageIndexes = await readPostLockOperationalIndexes(readBudget)
      ? 'VERIFIED_AS_WRITER' : 'MISMATCH'
    const { checks } = recording
    const reasons = { VMF_UPDATE_REQUIRED: checks.authority === 'VMF_UPDATE_REQUIRED', CONTROLLED_REPLAY_ISOLATED: checks.isolation === 'BLOCKED',
      LOCK_BASIS_UNAVAILABLE: checks.frozenBasis === 'LOCK_BASIS_UNAVAILABLE', FROZEN_MEMBERSHIP_NOT_RECORDED: checks.frozenBasis === 'NOT_RECORDED',
      POST_LOCK_POLICY_NOT_RECORDED: checks.policy === 'NOT_RECORDED', POST_LOCK_POLICY_UNAVAILABLE: checks.policy === 'UNAVAILABLE',
      POST_LOCK_INDEX_REQUIRED: checks.storageIndexes === 'MISMATCH' }
    const blockedBy = OPERATIONAL_CAPABILITY_BLOCKERS.filter(reason => reasons[reason])
    const result = parsePostLockOperationalCapability({ contractVersion: POST_LOCK_OPERATIONAL_CAPABILITY_VERSION,
      readAt: new Date().toISOString(), currency: 'AS_READ', recording: { ...recording,
        eligibility: blockedBy.length ? 'BLOCKED' : 'ELIGIBLE_AS_READ', blockedBy },
      impact: { eligibility: 'ITEM_REQUIRED' }, admission: { eligibility: 'ITEM_REQUIRED' },
      execution: { mode: 'EXPLICIT_SUBMIT_REQUIRED', recheck: 'SERVER_RECHECKS_ON_SUBMIT',
        indexRead: 'OUTSIDE_TRANSACTION_NOT_ATOMIC', submissionMaterial: 'NOT_CHECKED' } })
    readBudget.check()
    return result
  } catch (error) { throw normalizePostLockOperationalCapabilityError(error, readBudget) }
}
