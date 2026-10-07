import { test, expect } from '@jest/globals'
import { projectRecordedLockBasis } from '../services/intelligenceLockBasis.js'

const at = '2026-10-06T12:00:00.000Z', snapshotHash = 'a'.repeat(64)
const control = { id: '6a6c763dcace7a21bd41efa9', runtimeInstanceKey: 'fixture-revision', lockedAt: at }
const fixture = () => ({ state: 'LOCKED', locked: true, lockedAt: at, lockedBy: control.id, lockVersion: 1,
  snapshot: { snapshotId: 'runtime-truth-lock-record-fixture-' + snapshotHash.slice(0, 16), snapshotHash,
    snapshotAt: at, contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' },
  replayAnchor: { replayAnchorId: 'runtime-replay-anchor-' + 'b'.repeat(16), replayAnchorHash: 'b'.repeat(64),
    relationship: 'LOCKED_VALUE_NARRATIVE', runtimeInstanceId: control.id, runtimeInstanceKey: control.runtimeInstanceKey,
    lockSnapshotId: 'runtime-truth-lock-record-fixture-' + snapshotHash.slice(0, 16), lockSnapshotHash: snapshotHash } })

test('projects recorded snapshot and matching anchor without original-body or membership proof', () => {
  const lock = fixture(), before = JSON.stringify(lock)
  lock.privateBody = 'Private truth'; lock.replayAnchor.privateBody = 'Private replay'
  const value = projectRecordedLockBasis(lock, control)
  expect(value).toMatchObject({ available: true, locked: true, lockedAt: at, lockedBy: control.id, lockVersion: 1,
    snapshot: fixture().snapshot, replay: { available: true, anchor: fixture().replayAnchor },
    frozenInventory: { available: false, completeness: 'UNAVAILABLE', reason: 'FROZEN_MEMBERSHIP_NOT_RECORDED' } })
  expect(JSON.stringify(value)).not.toMatch(/Private|integrityVerified|membershipCount/)
  delete lock.privateBody; delete lock.replayAnchor.privateBody
  expect(JSON.stringify(lock)).toBe(before)
})
test.each([undefined, null, {}, { locked: false }, { state: 'UNLOCKED' }])('no recorded lock is not a fabricated snapshot %#', lock => {
  expect(projectRecordedLockBasis(lock, { ...control, lockedAt: null })).toMatchObject({ available: false, reason: 'LOCK_NOT_RECORDED', locked: false, snapshot: null })
})
test.each([
  [{ locked: 'true' }, 'LOCK_STATE_INVALID'], [{ state: 'UNKNOWN' }, 'LOCK_STATE_INVALID'],
  [{ state: 'UNLOCKED' }, 'LOCK_STATE_CONFLICT'], [{ locked: false }, 'LOCK_STATE_CONFLICT'],
  [{ lockedAt: '2026-10-06T11:59:00.000Z' }, 'LOCK_TIME_CONFLICT'], [{ lockedAt: 'invalid' }, 'LOCK_TIME_CONFLICT'],
  [{ lockedBy: ' private actor ' }, 'LOCK_METADATA_INVALID'], [{ lockedBy: 'actor\u0001' }, 'LOCK_METADATA_INVALID'],
  [{ lockVersion: 0 }, 'LOCK_METADATA_INVALID'], [{ lockVersion: '1' }, 'LOCK_METADATA_INVALID'],
  [{ lockVersion: Number.MAX_SAFE_INTEGER + 1 }, 'LOCK_METADATA_INVALID'], [{ snapshot: null }, 'LOCK_SNAPSHOT_MISSING'],
])('invalid locked metadata stays unavailable with precise reason %#', (changes, reason) => {
  expect(projectRecordedLockBasis({ ...fixture(), ...changes }, control)).toMatchObject({ available: false, reason, snapshot: null })
})
test.each([
  { snapshotId: '' }, { snapshotId: 'x'.repeat(241) }, { snapshotId: 'id\n' }, { snapshotHash: 'sha256:' + snapshotHash },
  { snapshotHash: 'A'.repeat(64) }, { snapshotHash: 'short' }, { snapshotAt: '2026-02-30T12:00:00.000Z' },
  { snapshotAt: '2026-10-06T12:00:00.000Z\n' }, { snapshotAt: '2026-10-06T12:00:01.000Z' },
  { contractVersion: 'runtime-truth-snapshot-v2' }, { actionKey: 'PUBLISH' },
])('unsupported or incoherent snapshot is not promoted to frozen truth %#', changes => {
  const lock = fixture(); Object.assign(lock.snapshot, changes)
  expect(projectRecordedLockBasis(lock, control)).toMatchObject({ available: false, reason: 'LOCK_SNAPSHOT_INVALID', snapshot: null })
})
test.each([
  { replayAnchorId: '' }, { replayAnchorHash: 'short' }, { relationship: 'OTHER' },
  { runtimeInstanceId: 'different' }, { runtimeInstanceKey: 'other-revision' },
  { lockSnapshotId: 'other-snapshot' }, { lockSnapshotHash: 'c'.repeat(64) },
])('mismatched replay does not grant replay proof or hide valid metadata %#', changes => {
  const lock = fixture(); Object.assign(lock.replayAnchor, changes)
  const value = projectRecordedLockBasis(lock, control)
  expect(value).toMatchObject({ available: true, snapshot: fixture().snapshot,
    replay: { available: false, reason: 'REPLAY_ANCHOR_INVALID', anchor: null } })
})
test('missing actor/version/replay remain unknown rather than inferred', () => {
  const lock = fixture(); delete lock.lockedBy; delete lock.lockVersion; delete lock.replayAnchor
  expect(projectRecordedLockBasis(lock, control)).toMatchObject({ available: true, lockedBy: null, lockVersion: null,
    replay: { available: false, reason: 'REPLAY_ANCHOR_MISSING', anchor: null } })
})
test('root-lock conflicts and invalid root times do not return snapshot metadata', () => {
  expect(projectRecordedLockBasis(fixture(), { ...control, lockedAt: null }).reason).toBe('LOCK_STATE_CONFLICT')
  expect(projectRecordedLockBasis({}, control).reason).toBe('LOCK_METADATA_MISSING')
  expect(projectRecordedLockBasis(undefined, control).reason).toBe('LOCK_METADATA_MISSING')
  expect(projectRecordedLockBasis(fixture(), { ...control, lockedAt: 'invalid' }).reason).toBe('LOCK_STATE_INVALID')
})
test.each([undefined, null])('root LOCKED status with missing time cannot report unlocked %#', lockedAt => {
  expect(projectRecordedLockBasis({ locked: false, state: 'UNLOCKED' }, { ...control, status: 'LOCKED', lockedAt }))
    .toMatchObject({ available: false, reason: 'LOCK_STATE_CONFLICT', locked: null, snapshot: null })
})
test.each([0, false, ''])('present malformed falsy root lock time remains invalid %#', lockedAt => {
  expect(projectRecordedLockBasis(undefined, { ...control, lockedAt }))
    .toMatchObject({ available: false, reason: 'LOCK_STATE_INVALID', locked: null, snapshot: null })
})
test('equivalent recorded ISO offsets and BSON dates retain the producer time', () => {
  const lock = fixture(); lock.lockedAt = new Date(at); lock.snapshot.snapshotAt = '2026-10-06T13:00:00+01:00'
  expect(projectRecordedLockBasis(lock, control)).toMatchObject({ available: true, lockedAt: at, snapshot: { snapshotAt: at } })
})
