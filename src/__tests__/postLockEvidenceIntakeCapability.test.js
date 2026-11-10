import { describe, expect, jest, test } from '@jest/globals'
import { discoveryPolicySnapshot } from '../services/discoveryPolicyContract.js'
import { readPostLockEvidenceIntakeCapability } from '../services/postLockEvidenceIntakeCapabilityService.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import { membershipError } from '../services/runtimeEvidenceSnapshotContract.js'
import { postLockStorageIndexMatches } from '../services/postLockEvidenceIntakeService.js'
import { createPostLockReadBudget } from '../services/postLockEvidenceReadStateService.js'
import { readPostLockOperationalIndexes, normalizePostLockOperationalCapabilityError,
  postLockOperationalBasisStatus } from '../services/postLockEvidenceOperationalCapabilityService.js'
import { POST_LOCK_OPERATIONAL_CAPABILITY_VERSION, parsePostLockOperationalCapability,
  assertPostLockOperationalCapabilityEnvelope, assertPostLockOperationalMaterial, OPERATIONAL_CAPABILITY_POLICY_BYTES } from '../services/postLockEvidenceOperationalCapabilityContract.js'

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

const operationalFixture = () => ({ contractVersion: POST_LOCK_OPERATIONAL_CAPABILITY_VERSION,
  readAt: '2026-11-06T12:00:00.000Z', currency: 'AS_READ',
  recording: { eligibility: 'ELIGIBLE_AS_READ', blockedBy: [], binding: {
    customerId: '1'.repeat(24), tenantId: '2'.repeat(24), runtimeInstanceId: '3'.repeat(24), runtimeInstanceKey: 'owned-runtime',
    revisionNumber: 1, basisStateVersion: 'rsv2:123e4567-e89b-42d3-a456-426614174000',
    evidenceSnapshotId: 'evidence_snapshot_123e4567-e89b-42d3-a456-426614174001', membershipHash: 'a'.repeat(64),
    lockSnapshotId: 'owned-lock', lockSnapshotHash: 'b'.repeat(64), packageId: '4'.repeat(24), packageVersion: '1.0',
    dependencySnapshotId: 'owned-dependency', dependencySnapshotHash: 'c'.repeat(64), policyHash: 'd'.repeat(64),
  }, checks: { authority: 'VMF_UPDATE_VERIFIED', isolation: 'CLEAR', frozenBasis: 'VERIFIED', policy: 'VERIFIED', storageIndexes: 'VERIFIED_AS_WRITER' } },
  impact: { eligibility: 'ITEM_REQUIRED' }, admission: { eligibility: 'ITEM_REQUIRED' },
  execution: { mode: 'EXPLICIT_SUBMIT_REQUIRED', recheck: 'SERVER_RECHECKS_ON_SUBMIT', indexRead: 'OUTSIDE_TRANSACTION_NOT_ATOMIC', submissionMaterial: 'NOT_CHECKED' },
})
const indexRows = model => model.schema.indexes().map(([key, options]) => ({ key, ...options }))
const withIndexCursors = async (rows, work, alter = () => {}) => {
  const cursors = [], spies = [RuntimeEvidenceSource, RuntimeEvidenceObject].map((model, index) => {
    let position = 0
    const cursor = { next: jest.fn(async () => rows[index][position++] ?? null), close: jest.fn(async () => {}) }
    cursors.push(cursor); alter(cursor, index)
    return jest.spyOn(model.collection, 'listIndexes').mockReturnValue(cursor)
  })
  try { await work({ cursors, spies }) } finally { spies.forEach(spy => spy.mockRestore()) }
}
describe('operational post-lock capability grammar and bounded metadata', () => {
  test.each([undefined, {}, { pointerRecorded: null }, { pointerRecorded: 0 }])('missing or malformed private presence witness%j fails rather than inventing absence', control => {
    expect(() => postLockOperationalBasisStatus({ status: 'LOCKED', __evidenceSnapshotControl: control }))
      .toThrow(expect.objectContaining({ details: { reason: 'POST_LOCK_OPERATIONAL_CAPABILITY_DEPENDENCY_UNAVAILABLE' } }))
  })
  test.each([null, false, 0, ''])('present falsey pointer%j must reach the retained verifier', pointer => {
    expect(postLockOperationalBasisStatus({ status: 'LOCKED', __evidenceSnapshotControl: { pointerRecorded: true,
      pointer, runtime: { framework_state: { lock: { locked: true } } } } })).toBe('VERIFY_RECORDED')
  })
  test('records AS_READ prerequisites without global item authority or v1 replacement', () => {
    const value = operationalFixture()
    expect(parsePostLockOperationalCapability(value)).toEqual(value)
    expect(value.impact.eligibility).toBe('ITEM_REQUIRED'); expect(value.admission.eligibility).toBe('ITEM_REQUIRED')
    expect(value).not.toHaveProperty('available')
  })
  test('maximum valid escaped and Unicode binding fits the total16KiB envelope', () => {
    const value = operationalFixture(), binding = value.recording.binding
    binding.runtimeInstanceKey = '\u0000'.repeat(160); binding.lockSnapshotId = '\u0000'.repeat(240)
    binding.packageVersion = '\u0000'.repeat(180); binding.dependencySnapshotId = '漢'.repeat(240)
    binding.revisionNumber = Number.MAX_SAFE_INTEGER
    expect(parsePostLockOperationalCapability(value)).toEqual(value)
    const envelope = { data: value, meta: { requestId: 'a'.repeat(240), version: 'v1' } }
    expect(Buffer.byteLength(JSON.stringify(envelope))).toBeGreaterThan(5000)
    expect(assertPostLockOperationalCapabilityEnvelope(envelope)).toBe(envelope)
  })
  test.each(['extra', 'duplicate', 'grant', 'binding', 'unexplained', 'skipped', 'item', 'hidden', 'accessor'])('rejects %s contradictory or unsafe capability', fault => {
    const value = operationalFixture()
    if (fault === 'extra') value.available = true
    if (fault === 'duplicate') { value.recording.blockedBy = ['VMF_UPDATE_REQUIRED', 'VMF_UPDATE_REQUIRED']; value.recording.eligibility = 'BLOCKED'; value.recording.checks.authority = 'VMF_UPDATE_REQUIRED' }
    if (fault === 'grant') { value.recording.blockedBy = ['VMF_UPDATE_REQUIRED']; value.recording.checks.authority = 'VMF_UPDATE_REQUIRED' }
    if (fault === 'binding') value.recording.binding = null
    if (fault === 'unexplained') { value.recording.eligibility = 'BLOCKED'; value.recording.checks.storageIndexes = 'MISMATCH' }
    if (fault === 'skipped') value.recording.checks.policy = 'NOT_CHECKED'
    if (fault === 'item') value.admission.eligibility = 'ELIGIBLE_AS_READ'
    if (fault === 'hidden') Object.defineProperty(value, 'private', { value: true })
    if (fault === 'accessor') Object.defineProperty(value, 'private', { enumerable: true, get: () => true })
    expect(() => parsePostLockOperationalCapability(value)).toThrow(expect.objectContaining({ details: { reason: 'POST_LOCK_OPERATIONAL_CAPABILITY_RESPONSE_INVALID' } }))
  })
  test('total response capacity rejects rather than truncating valid data', () => {
    expect(() => assertPostLockOperationalCapabilityEnvelope({ data: operationalFixture(), meta: { requestId: 'x'.repeat(16384), version: 'v1' } }))
      .toThrow(expect.objectContaining({ details: { reason: 'POST_LOCK_OPERATIONAL_CAPABILITY_RESPONSE_CAPACITY_EXCEEDED' } }))
  })
  test('selected package cap includes the exact boundary and rejects the next byte', () => {
    const material = 'x'.repeat(OPERATIONAL_CAPABILITY_POLICY_BYTES - 2)
    expect(assertPostLockOperationalMaterial(material, OPERATIONAL_CAPABILITY_POLICY_BYTES, 'POLICY_CAPACITY_EXCEEDED')).toBe(material)
    expect(() => assertPostLockOperationalMaterial(material + 'x', OPERATIONAL_CAPABILITY_POLICY_BYTES, 'POLICY_CAPACITY_EXCEEDED'))
      .toThrow(expect.objectContaining({ details: { reason: 'POST_LOCK_OPERATIONAL_CAPABILITY_POLICY_CAPACITY_EXCEEDED' } }))
  })
  test.each(['missing', 'key', 'unique', 'partial'])('AS_WRITER predicate rejects %s but preserves key-order-insensitive comparison', fault => {
    const [key, expected] = RuntimeEvidenceSource.schema.indexes()[1]
    let actual = { key: Object.fromEntries(Object.entries(key).reverse()), ...expected }
    expect(postLockStorageIndexMatches(actual, key, expected)).toBe(true)
    if (fault === 'missing') actual = undefined
    if (fault === 'key') actual.key = { ...key, current: -1 }
    if (fault === 'unique') actual.unique = false
    if (fault === 'partial') actual.partialFilterExpression = { current: false }
    expect(postLockStorageIndexMatches(actual, key, expected)).toBe(false)
  })
  test('checks both actual model requirements outside a session and closes both cursors', async () => {
    await withIndexCursors([indexRows(RuntimeEvidenceSource), indexRows(RuntimeEvidenceObject)], async ({ spies, cursors }) => {
      expect(await readPostLockOperationalIndexes(createPostLockReadBudget())).toBe(true)
      for (const spy of spies) expect(spy).toHaveBeenCalledWith({ maxTimeMS: 2000, batchSize: 33 })
      for (const cursor of cursors) expect(cursor.close).toHaveBeenCalledTimes(1)
    })
  })
  test('known missing metadata returns false rather than rejecting a fulfilled inspection', async () => {
    await withIndexCursors([[], indexRows(RuntimeEvidenceObject)], async () => {
      expect(await readPostLockOperationalIndexes(createPostLockReadBudget())).toBe(false)
    })
  })
  test.each([32, 33])('metadata count%d has an exact per-family bound', async count => {
    const sourceRows = [...indexRows(RuntimeEvidenceSource), ...Array.from({ length: count - 2 }, (_, n) => ({ name: `extra-${n}`, key: { extra: 1 } }))]
    await withIndexCursors([sourceRows, indexRows(RuntimeEvidenceObject)], async ({ cursors }) => {
      if (count === 32) expect(await readPostLockOperationalIndexes(createPostLockReadBudget())).toBe(true)
      else await expect(readPostLockOperationalIndexes(createPostLockReadBudget())).rejects.toMatchObject({ details: { reason: 'POST_LOCK_OPERATIONAL_CAPABILITY_INDEX_CAPACITY_EXCEEDED' } })
      expect(cursors[0].close).toHaveBeenCalledTimes(1)
    })
  })
  test.each([0, 1])('cumulative metadata byte boundary plus%d is exact', async extra => {
    const rows = [indexRows(RuntimeEvidenceSource), indexRows(RuntimeEvidenceObject)]
    rows[1].push({ name: 'extra', key: { extra: 1 }, notes: '' })
    rows[1][2].notes = 'x'.repeat(65536 - Buffer.byteLength(JSON.stringify(rows.flat())) + extra)
    await withIndexCursors(rows, async () => {
      if (!extra) expect(await readPostLockOperationalIndexes(createPostLockReadBudget())).toBe(true)
      else await expect(readPostLockOperationalIndexes(createPostLockReadBudget())).rejects.toMatchObject({ details: { reason: 'POST_LOCK_OPERATIONAL_CAPABILITY_INDEX_CAPACITY_EXCEEDED' } })
    })
  })
  test.each(['next', 'close'])('rejected cursor%s is not a missing-index success', async stage => {
    const error = new Error('Private metadata dependency.')
    await withIndexCursors([indexRows(RuntimeEvidenceSource), indexRows(RuntimeEvidenceObject)], async () => {
      await expect(readPostLockOperationalIndexes(createPostLockReadBudget())).rejects.toBe(error)
    }, (cursor, index) => { if (!index) cursor[stage].mockRejectedValue(error) })
  })
  test.each(['next', 'close'])('falsy rejection from cursor%s cannot become eligible metadata', async stage => {
    await withIndexCursors([indexRows(RuntimeEvidenceSource), indexRows(RuntimeEvidenceObject)], async () => {
      await expect(readPostLockOperationalIndexes(createPostLockReadBudget())).rejects.toBeUndefined()
    }, (cursor, index) => { if (!index) cursor[stage].mockRejectedValue(undefined) })
  })
  test('one deadline survives metadata await and does not reset for the second family', async () => {
    let now = 0
    const budget = createPostLockReadBudget({ now: () => now })
    await withIndexCursors([indexRows(RuntimeEvidenceSource), indexRows(RuntimeEvidenceObject)], async ({ spies }) => {
      expect(await readPostLockOperationalIndexes(budget)).toBe(true)
      expect(spies[1]).toHaveBeenCalledWith({ maxTimeMS: 100, batchSize: 33 })
    }, (cursor, index) => { if (!index) cursor.close.mockImplementation(async () => { now = 5900 }) })
  })
  test.each([
    [Object.assign(new Error('Private typed detail.'), { status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'UNKNOWN' } }), 'POST_LOCK_OPERATIONAL_CAPABILITY_DEPENDENCY_UNAVAILABLE'],
    [Object.assign(new Error('Private timeout detail.'), { code: 50 }), 'POST_LOCK_OPERATIONAL_CAPABILITY_DEADLINE_EXCEEDED'],
  ])('normalizes dependency safely%j', (error, reason) => {
    expect(normalizePostLockOperationalCapabilityError(error, createPostLockReadBudget())).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason } })
  })
  test('preserves actual protected frozen errors rather than masking them', () => {
    const error = membershipError('MEMBER_MISSING')
    expect(normalizePostLockOperationalCapabilityError(error, createPostLockReadBudget())).toBe(error)
  })
})
