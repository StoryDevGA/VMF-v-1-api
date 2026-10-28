import { describe, expect, jest, test } from '@jest/globals'
import { discoveryPolicySnapshot } from '../services/discoveryPolicyContract.js'
import { readPostLockEvidenceIntakeCapability } from '../services/postLockEvidenceIntakeCapabilityService.js'

// Synthetic metadata contract fixtures; neither frozen membership persistence nor
// implemented post-lock methods are inferred from these controlled DTOs.
const fixture = (enabled = true) => {
  const state = 'rsv2:123e4567-e89b-42d3-a456-426614174000'
  const runtime = { packageId: '507f1f77bcf86cd799439011', frameworkKey: 'FIXTURE', packageKey: 'fixture-package', packageVersion: '1.0',
    status: 'LOCKED', stateVersion: state, revision: { revisionNumber: 2 }, dependencyLockId: 'dependency-1',
    evidence: { dependencySnapshotId: 'dependency-1', dependencySnapshotHash: 'a'.repeat(64) } }
  const policy = { contractVersion: 'framework-package-discovery-policy-v1', policyKey: 'fixture-policy', policyVersion: '1.0',
    postLockDiscoveryPolicy: { enabled, mutateLockedRevision: false, references: [{ mappingKey: 'unverified-outside-method', ownerRuntime: 'VE02' }] } }
  const pack = { _id: runtime.packageId, frameworkKey: runtime.frameworkKey, packageKey: runtime.packageKey, version: runtime.packageVersion,
    discoveryPolicy: policy, dependencyLock: { snapshotId: runtime.dependencyLockId, snapshotHash: runtime.evidence.dependencySnapshotHash,
      ...discoveryPolicySnapshot(policy) } }
  const lockBasis = { available: true, locked: true, snapshot: { snapshotId: 'truth-lock-1', snapshotHash: 'b'.repeat(64) },
    frozenInventory: { available: true, completeness: 'VERIFIED', reason: null, contractVersion: 'runtime-evidence-membership.v1',
      snapshotId: 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174000', membershipHash: 'c'.repeat(64), basisStateVersion: state,
      lockSnapshotId: 'truth-lock-1', lockSnapshotHash: 'b'.repeat(64), revisionNumber: 2, counts: { sources: 0, evidence: 0, sections: 0 },
      verification: { basis: 'EXACT_PERSISTED_MEMBERSHIP', materialHashAlgorithm: 'sha256-canonical-json-housekeeping-excluded.v1', auditLinkVerified: true } } }
  return { runtime, pack, lockBasis, session: { id: 'existing-read-session' }, readBudget: jest.fn(() => ({ maxTimeMS: 2000 })) }
}
const run = f => readPostLockEvidenceIntakeCapability({ ...f, readPackage: f.readPackage || jest.fn(async () => [f.pack]) })
describe('source-neutral outside snapshot intake unavailable capability', () => {
  test('actual parsed capture and genuine zero counts still confer no implementation authority or mutation', async () => {
    const f = fixture(), before = JSON.stringify(f)
    const readPackage = jest.fn(async () => [f.pack])
    const result = await run({ ...f, readPackage, implementationVerified: true, canExecute: true })
    expect(result).toEqual({ contractVersion: 'post-lock-evidence-intake-capability.v1', available: false,
      reason: 'POST_LOCK_IMPLEMENTATION_MAPPING_UNVERIFIED', blockedBy: ['POST_LOCK_IMPLEMENTATION_MAPPING_UNVERIFIED'],
      policy: { status: 'DECLARED_UNVERIFIED', policyKey: 'fixture-policy', policyVersion: '1.0', policyHash: f.pack.dependencyLock.discoveryPolicyHash },
      frozenBasis: { available: true, snapshotId: f.lockBasis.frozenInventory.snapshotId, membershipHash: 'c'.repeat(64), basisStateVersion: f.runtime.stateVersion },
      registrationAvailable: false, dispositionAvailable: false, impactApplicationAvailable: false })
    expect(readPackage).toHaveBeenCalledWith({ runtime: f.runtime, session: f.session, readBudget: f.readBudget })
    expect(JSON.stringify(f)).toBe(before)
    expect(JSON.stringify(result)).not.toMatch(/ownerRuntime|references|dependencyLock|evidenceObjects|implementationVerified|canExecute/)
  })
  test.each(['lock', 'legacy', 'contract', 'snapshot', 'state', 'revision', 'count', 'verification', 'extra'])('invalid %s predecessor cannot execute package read', async kind => {
    const f = fixture(), readPackage = jest.fn()
    if (kind === 'lock') f.lockBasis.available = false
    if (kind === 'legacy') f.lockBasis.frozenInventory = { available: false, reason: 'FROZEN_MEMBERSHIP_NOT_RECORDED' }
    if (kind === 'contract') f.lockBasis.frozenInventory.contractVersion = 'unknown'
    if (kind === 'snapshot') f.lockBasis.frozenInventory.lockSnapshotId = 'different'
    if (kind === 'state') f.runtime.stateVersion = 'different'
    if (kind === 'revision') f.runtime.revision.revisionNumber = 3
    if (kind === 'count') f.lockBasis.frozenInventory.counts.sources = 1001
    if (kind === 'verification') f.lockBasis.frozenInventory.verification.auditLinkVerified = false
    if (kind === 'extra') f.lockBasis.frozenInventory.providerSecret = 'must not be displayed'
    const result = await run({ ...f, readPackage })
    expect(result).toMatchObject({ available: false, policy: { status: 'NOT_CHECKED' }, frozenBasis: { available: false } })
    expect(readPackage).not.toHaveBeenCalled()
  })
  test.each(['absent', 'invalid', 'disabled', 'uncaptured', 'runtime-id', 'runtime-hash', 'captured-hash'])('%s policy remains fail closed without invented identities', async kind => {
    const f = fixture()
    if (kind === 'absent') delete f.pack.discoveryPolicy
    if (kind === 'invalid') f.pack.discoveryPolicy.postLockDiscoveryPolicy.enabled = 'true'
    if (kind === 'disabled') f.pack.discoveryPolicy.postLockDiscoveryPolicy.enabled = false
    if (kind === 'uncaptured') delete f.pack.dependencyLock.discoveryPolicy
    if (kind === 'runtime-id') f.runtime.dependencyLockId = 'different'
    if (kind === 'runtime-hash') delete f.runtime.evidence.dependencySnapshotHash
    if (kind === 'captured-hash') f.pack.dependencyLock.discoveryPolicyHash = 'd'.repeat(64)
    const result = await run(f)
    expect(result.available).toBe(false)
    expect(result.registrationAvailable).toBe(false)
    expect(result.policy).not.toHaveProperty('policyKey')
    expect(result.policy).not.toHaveProperty('policyHash')
  })
  test.each(['missing', 'ambiguous', '_id', 'frameworkKey', 'packageKey', 'version'])('wrong %s package lookup is an error, not missing-policy success', async kind => {
    const f = fixture()
    const rows = kind === 'missing' ? [] : kind === 'ambiguous' ? [f.pack, f.pack] : [{ ...f.pack, [kind]: 'different' }]
    await expect(run({ ...f, readPackage: jest.fn(async () => rows) })).rejects.toMatchObject({ status: 409, code: 'CONFLICT' })
  })
  test('actual storage rejection propagates; unavailable is not fabricated from a failed lookup', async () => {
    const f = fixture(), error = Object.assign(new Error('bounded storage unavailable'), { status: 503, code: 'RUNTIME_STATE_V2_STORAGE_UNAVAILABLE' })
    await expect(run({ ...f, readPackage: jest.fn(async () => { throw error }) })).rejects.toBe(error)
  })
})
