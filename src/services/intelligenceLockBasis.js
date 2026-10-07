const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, limit = 240) => typeof value === 'string' && value === value.trim()
  && value.length > 0 && value.length <= limit
  && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const time = value => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
  if (typeof value !== 'string' || value.length > 40) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match || !Number.isFinite(Date.parse(value))) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59) return null
  return new Date(value).toISOString()
}

// These are recorded lock metadata only. The lock producer does not persist the
// hashed snapshot body or an evidence/source membership-and-version receipt.
export function projectRecordedLockBasis(lock, control) {
  const frozenInventory = { available: false, completeness: 'UNAVAILABLE', reason: 'FROZEN_MEMBERSHIP_NOT_RECORDED' }
  const unavailable = (reason, locked = null) => ({ available: false, reason, locked,
    snapshot: null, replay: { available: false, reason: 'LOCK_BASIS_UNAVAILABLE', anchor: null }, frozenInventory })
  const rootLockedAt = time(control?.lockedAt)
  if (control?.lockedAt !== undefined && control.lockedAt !== null && !rootLockedAt) return unavailable('LOCK_STATE_INVALID')
  if (control?.status === 'LOCKED' && !rootLockedAt) return unavailable('LOCK_STATE_CONFLICT')
  if (!object(lock)) return unavailable(rootLockedAt ? 'LOCK_METADATA_MISSING' : 'LOCK_NOT_RECORDED', rootLockedAt ? null : false)
  if (!Object.keys(lock).length && rootLockedAt) return unavailable('LOCK_METADATA_MISSING')
  if (lock.locked !== undefined && typeof lock.locked !== 'boolean') return unavailable('LOCK_STATE_INVALID')
  if (lock.state !== undefined && !['LOCKED', 'UNLOCKED'].includes(lock.state)) return unavailable('LOCK_STATE_INVALID')
  const lockClaim = lock.locked === true || lock.state === 'LOCKED'
  if (lockClaim && (lock.locked === false || lock.state === 'UNLOCKED')) return unavailable('LOCK_STATE_CONFLICT')
  if (!lockClaim && !rootLockedAt) return unavailable('LOCK_NOT_RECORDED', false)
  if (!lockClaim || !rootLockedAt) return unavailable('LOCK_STATE_CONFLICT')
  const lockedAt = time(lock.lockedAt), record = lock.snapshot
  if (!lockedAt || lockedAt !== rootLockedAt) return unavailable('LOCK_TIME_CONFLICT')
  if (!object(record)) return unavailable('LOCK_SNAPSHOT_MISSING', true)
  const snapshotAt = time(record.snapshotAt)
  if (!text(record.snapshotId) || !hash(record.snapshotHash) || snapshotAt !== lockedAt
    || record.contractVersion !== 'runtime-truth-snapshot-v1' || record.actionKey !== 'LOCK_RECORD')
    return unavailable('LOCK_SNAPSHOT_INVALID', true)
  if ((lock.lockedBy !== undefined && lock.lockedBy !== '' && !text(lock.lockedBy, 220))
    || (lock.lockVersion !== undefined && (!Number.isSafeInteger(lock.lockVersion) || lock.lockVersion < 1)))
    return unavailable('LOCK_METADATA_INVALID', true)
  const snapshot = { snapshotId: record.snapshotId, snapshotHash: record.snapshotHash, snapshotAt,
    contractVersion: record.contractVersion, actionKey: record.actionKey }
  const stored = lock.replayAnchor
  const replay = !object(stored) ? { available: false, reason: 'REPLAY_ANCHOR_MISSING', anchor: null }
    : !text(stored.replayAnchorId) || !hash(stored.replayAnchorHash)
      || stored.relationship !== 'LOCKED_VALUE_NARRATIVE' || stored.runtimeInstanceId !== control.id
      || stored.runtimeInstanceKey !== control.runtimeInstanceKey || stored.lockSnapshotId !== snapshot.snapshotId
      || stored.lockSnapshotHash !== snapshot.snapshotHash
      ? { available: false, reason: 'REPLAY_ANCHOR_INVALID', anchor: null }
      : { available: true, reason: null, anchor: { replayAnchorId: stored.replayAnchorId,
        replayAnchorHash: stored.replayAnchorHash, relationship: stored.relationship,
        runtimeInstanceId: stored.runtimeInstanceId, runtimeInstanceKey: stored.runtimeInstanceKey,
        lockSnapshotId: stored.lockSnapshotId, lockSnapshotHash: stored.lockSnapshotHash } }
  return { available: true, reason: null, locked: true, lockedAt, lockedBy: lock.lockedBy || null,
    lockVersion: lock.lockVersion ?? null, snapshot, replay, frozenInventory }
}
