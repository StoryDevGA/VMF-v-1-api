import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import User from '../models/User.js'
import Audit from '../models/AuditLog.js'
import Execution from '../models/GovernedReasoningExecution.js'
import auditService from '../services/auditService.js'
import { G1_FIXED, G1_QA_RELEASE, G1_VERSION, G1_MODES, g1Root, g1AuditDiff, assertG1Approval, assertG1QaRelease } from '../services/masterLinkedGenuineReviewContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'

// Pure module seams: no real operator, source admission, transaction or release.
const database = 'ss044_1619d7db635949898c9abb4592d10bcf', operator = {
  realm: 'native-application-test.v1', operatorUserId: '698b3800f83b3257365fd7a3', fingerprint: 'a'.repeat(64),
}
const auth = jest.fn(), prepare = jest.fn(), permissions = jest.fn(), nativeOperator = jest.fn()
const need = (ok, reason) => { if (!ok) throw Object.assign(Error('HELD'), { code: 'MASTER_DOCX_RELEASE_HELD', details: { reason } }) }
const scope = Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map(key => [key, G1_FIXED[key]]))
const subject = { actorUserId: G1_FIXED.actorUserId, binding: { candidateId: G1_FIXED.candidateId,
  masterReference: { scope, masterId: G1_FIXED.masterId } } }
const binding = { requestIdentity: 'c5a51616e1783e96a6ac7395d490ce83522de8c88b34a05fd92c91f9774bf8ff',
  subjectFingerprint: '03361f15efa60ebd630449449931a64d633d225df50b3f5d862b398bd8d60504',
  contextFingerprint: 'd9fba3835d2c9ddfd6195ab202543a305cb96f293e45309a99b310f85ca8015b',
  policyFingerprint: '1ac4b2f41724224645c15553c6123c7e47eb151905e902adbde9f3a02623eff4' }
jest.unstable_mockModule('../services/masterLinkedReviewOperatorAuthority.js', () => ({ authenticateMasterReviewNativeOperator: auth,
  readMasterReviewNativeOperator: nativeOperator, MASTER_REVIEW_DATABASE: database, releaseNeed: need }))
jest.unstable_mockModule('../services/outcomeMasterLinkedDocxReviewTransportService.js', () => ({ prepareMasterLinkedDocxReviewTransport: prepare,
  prepareApprovedMasterLinkedDocxReviewTransport: () => { throw Error('APPROVED_PROFILE_NOT_IN_LEGACY_TEST') } }))
jest.unstable_mockModule('../services/openAiMasterLinkedDocxReviewRequest.js', () => ({ buildOpenAiMasterLinkedDocxReviewRequest: () => ({ binding }) }))
jest.unstable_mockModule('../services/performanceCacheService.js', () => ({ buildUserPermissionsSnapshot: permissions }))
const { issueMasterLinkedReviewRelease, issueNetworkQaMasterLinkedReviewRelease } = await import('../services/masterLinkedReviewReleaseService.js')
const runtimePermission = jest.fn(), runtimeRead = jest.fn()
jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({
  assertRuntimePermission: runtimePermission, getRuntimeInstance: runtimeRead }))
const indexBarrier = jest.fn()
jest.unstable_mockModule('../services/governedRenditionReviewClaimService.js', () => ({ assertRenditionClaimIndex: indexBarrier }))
const actualContract = await import('../services/masterLinkedGenuineReviewContract.js')
// This read-only projection seam isolates the release-time join in owner.load.
// It does not validate a full source/record schema or prove database acceptance.
jest.unstable_mockModule('../services/masterLinkedGenuineReviewContract.js', () => ({ ...actualContract,
  assertG1Record: row => row?.unitProjectedGrant ? row.executionEvidence.masterDocxDispatch.body : actualContract.assertG1Record(row) }))
const { createGenuineMasterLinkedReviewAuthority, createNetworkQaMasterLinkedReviewAuthority } = await import('../services/masterLinkedGenuineReviewAuthorityService.js')
let saved, occupied, session, log, auditFind, userRead, findExecution, oldName, connect, fetch
const args = () => ({ authorization: 'Bearer UNIT_NEVER_REAL', approvalReference: 'Explicit unit fixture only', expected: { ...binding } })
const query = value => { const q = { maxTimeMS: () => q, session: () => q, lean: async () => value() }; return q }
beforeAll(() => {
  oldName = Audit.db.name; Audit.db.name = database
  connect = jest.spyOn(Audit.db, 'openUri').mockRejectedValue(Error('LIVE_DATABASE_FORBIDDEN'))
  fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(Error('PROVIDER_FORBIDDEN'))
  userRead = jest.spyOn(User, 'findById')
  auditFind = jest.spyOn(Audit, 'findById')
  findExecution = jest.spyOn(Execution, 'findOne')
  log = jest.spyOn(auditService, 'log')
  jest.spyOn(Audit.db, 'startSession').mockImplementation(async () => session)
})
beforeEach(() => {
  saved = null; occupied = null
  session = { withTransaction: jest.fn(async fn => fn()), endSession: jest.fn(async () => {}) }
  auth.mockReset().mockResolvedValue({ ...operator }); prepare.mockReset().mockResolvedValue({ subject,
    sourceEnvelope: { source: { plan: { planId: 'unit-controlled-plan' } } } }); permissions.mockReset().mockResolvedValue({})
  nativeOperator.mockReset().mockResolvedValue({ ...operator })
  runtimePermission.mockReset().mockResolvedValue(undefined)
  runtimeRead.mockReset().mockResolvedValue({ id: G1_FIXED.runtimeInstanceId, ...scope, status: 'LOCKED' })
  indexBarrier.mockReset().mockRejectedValue(Error('AFTER_AUTHORITY_TEST_BARRIER'))
  userRead.mockImplementation(() => query(() => ({ _id: G1_FIXED.actorUserId, isActive: true })))
  auditFind.mockImplementation(() => query(() => saved)); findExecution.mockImplementation(() => query(() => occupied))
  log.mockReset().mockImplementation(async (data, options) => {
    expect(options).toMatchObject({ session, throwOnError: true })
    const audit = new Audit(data); audit.generateSignature(); saved = audit.toObject(); return saved
  })
})
afterAll(() => { expect(connect).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); Audit.db.name = oldName; jest.restoreAllMocks() })
test('issuer creates exact signed v2 metadata, reads it back and returns no capability', async () => {
  const result = await issueMasterLinkedReviewRelease(args())
  expect(result).toEqual({ approvalAuditId: String(saved._id), issuedAt: saved.diff.issuedAt, expiresAt: saved.diff.expiresAt,
    operatorAuthority: operator, dispatchAvailable: false, approvalAvailable: false, finalisationAvailable: false })
  expect(auth).toHaveBeenCalledTimes(2); expect(session.endSession).toHaveBeenCalledTimes(1)
  expect(saved.signatureVersion).toBe(3)
  expect(assertG1Approval(saved, subject, binding, a => Audit.prototype.verifySignature.call(a), Date.now())).toEqual(saved.diff)
  expect(log).toHaveBeenCalledTimes(1)
})
test('same current release replays without another audit or expiry renewal', async () => {
  const first = await issueMasterLinkedReviewRelease(args()), expiry = saved.diff.expiresAt
  expect(await issueMasterLinkedReviewRelease(args())).toEqual(first)
  expect(saved.diff.expiresAt).toBe(expiry); expect(log).toHaveBeenCalledTimes(1)
})
test.each(['extra-input', 'empty-reference', 'wrong-database', 'wrong-hash', 'operator-changed', 'occupied-root', 'inactive-actor', 'auth-failure', 'source-failure'])(
  'issuer rejects %s before its audit write', async kind => {
    const input = args()
    if (kind === 'extra-input') input.deps = {}
    if (kind === 'empty-reference') input.approvalReference = ' '
    if (kind === 'wrong-database') Audit.db.name = 'test'
    if (kind === 'wrong-hash') input.expected.requestIdentity = 'f'.repeat(64)
    if (kind === 'operator-changed') auth.mockResolvedValueOnce(operator).mockResolvedValueOnce({ ...operator, fingerprint: 'b'.repeat(64) })
    if (kind === 'occupied-root') occupied = { executionId: 'occupied-fixture' }
    if (kind === 'inactive-actor') userRead.mockImplementation(() => query(() => ({ isActive: false })))
    if (kind === 'auth-failure') auth.mockRejectedValue(Error('AUTH_OFFLINE'))
    if (kind === 'source-failure') prepare.mockRejectedValue(Error('SOURCE_OFFLINE'))
    try { await expect(issueMasterLinkedReviewRelease(input)).rejects.toThrow(); expect(log).not.toHaveBeenCalled() }
    finally { Audit.db.name = database }
  })
test.each(['write-failed', 'duplicate-key', 'null-audit'])('issuer does not report success on %s', async kind => {
  if (kind === 'null-audit') log.mockResolvedValue(null)
  else log.mockRejectedValue(Object.assign(Error('WRITE_FAILED'), { code: kind === 'duplicate-key' ? 11000 : 112 }))
  await expect(issueMasterLinkedReviewRelease(args())).rejects.toThrow(); expect(session.endSession).toHaveBeenCalled()
})
test('expired immutable receipt is rejected rather than renewed', async () => {
  await issueMasterLinkedReviewRelease(args()); const prior = saved, id = String(saved._id)
  const audit = new Audit({ ...saved, diff: { ...saved.diff, issuedAt: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() - 1800000).toISOString() } })
  audit.generateSignature(); saved = audit.toObject()
  await expect(issueMasterLinkedReviewRelease(args())).rejects.toThrow(); expect(String(saved._id)).toBe(id)
  expect(log).toHaveBeenCalledTimes(1); expect(saved.diff.expiresAt).not.toBe(prior.diff.expiresAt)
})
test.each(['realm', 'identity', 'fingerprint', 'unsigned', 'unknown-version'])('v2 release rejects altered %s', async kind => {
  await issueMasterLinkedReviewRelease(args())
  const data = JSON.parse(JSON.stringify(saved)), d = data.diff
  if (kind === 'realm') d.operatorAuthority.realm = 'caller-database'
  if (kind === 'identity') d.operatorAuthority.operatorUserId = 'b'.repeat(24)
  if (kind === 'fingerprint') d.operatorAuthority.fingerprint = 'not-a-hash'
  if (kind === 'unknown-version') d.version = 'ss055-genuine-release-approval.v3'
  const audit = new Audit(data); if (kind !== 'unsigned') audit.generateSignature()
  if (kind === 'unsigned') audit.diff.approvalReference = 'tampered'
  expect(() => assertG1Approval(audit.toObject(), subject, binding, a => Audit.prototype.verifySignature.call(a), Date.now())).toThrow()
})
test('operator fingerprint in audit is covered by the model signature', async () => {
  await issueMasterLinkedReviewRelease(args()); const first = membershipHash(saved.diff)
  saved.diff.operatorAuthority.fingerprint = 'f'.repeat(64)
  expect(membershipHash(saved.diff)).not.toBe(first); expect(Audit.prototype.verifySignature.call(saved)).toBe(false)
})
test.each(['commit', 'readback'])('late %s never returns release success', async phase => {
  const now = Date.now(), clock = jest.spyOn(Date, 'now').mockReturnValue(now)
  if (phase === 'commit') session.withTransaction.mockImplementation(async fn => { await fn(); clock.mockReturnValue(now + 900001) })
  else {
    let reads = 0
    auditFind.mockImplementation(() => query(() => { if (++reads === 2) clock.mockReturnValue(now + 900001); return saved }))
  }
  try { await expect(issueMasterLinkedReviewRelease(args())).rejects.toMatchObject({ details: { reason: 'RELEASE_DEADLINE' } }); expect(session.endSession).toHaveBeenCalled() }
  finally { clock.mockRestore() }
})
test.each(['current', 'changed', 'rejected', 'legacy'])('G1 genuine owner uses the correct %s operator realm before writes', async kind => {
  await issueMasterLinkedReviewRelease(args())
  if (kind === 'legacy') {
    const data = { ...saved, diff: { ...saved.diff, version: 'ss055-genuine-release-approval.v1' } }; delete data.diff.operatorAuthority
    const audit = new Audit(data); audit.generateSignature(); saved = audit.toObject()
  }
  if (kind === 'changed') nativeOperator.mockResolvedValue({ ...operator, fingerprint: 'b'.repeat(64) })
  if (kind === 'rejected') nativeOperator.mockRejectedValue(Error('NATIVE_AUTHORITY_OFFLINE'))
  permissions.mockResolvedValue({ resolvedPermissions: { platform: { roleKeys: ['SUPER_ADMIN'] } } })
  const userFind = jest.spyOn(User, 'findOne').mockImplementation(() => {
    const q = { setOptions: () => q, lean: async () => ({ isActive: true }) }; return q
  })
  const auditOne = jest.spyOn(Audit, 'findOne').mockImplementation(() => {
    const q = { setOptions: () => q, lean: async () => saved }; return q
  })
  // Halt after authority validation, before reservation. The marker is an
  // intentional local test barrier, not a storage/index acceptance result.
  findExecution.mockImplementation(() => { const q = { setOptions: () => q, lean: async () => null }; return q })
  log.mockClear()
  try {
    const call = createGenuineMasterLinkedReviewAuthority().prepare({ actorUserId: G1_FIXED.actorUserId,
      runtimeInstanceId: G1_FIXED.runtimeInstanceId, candidateId: G1_FIXED.candidateId,
      scopes: {}, expected: binding, approvalAuditId: String(saved._id) })
    if (kind === 'changed') await expect(call).rejects.toMatchObject({ details: { reason: 'OPERATOR_CHANGED' } })
    else await expect(call).rejects.toThrow(kind === 'rejected' ? 'NATIVE_AUTHORITY_OFFLINE' : 'AFTER_AUTHORITY_TEST_BARRIER')
    expect(nativeOperator).toHaveBeenCalledTimes(kind === 'legacy' ? 0 : 1)
    expect(indexBarrier).toHaveBeenCalledTimes(['current', 'legacy'].includes(kind) ? 1 : 0)
    expect(log).not.toHaveBeenCalled()
  } finally { userFind.mockRestore(); auditOne.mockRestore() }
})
const qaCase = 'ss055-release-proof-unit-main'
const qaArgs = () => ({ ...args(), qaCase })

test.each(['genuine', 'qa'])('%s issuer selects fixed customer/tenant while preserving fresh permissions', async mode => {
  const snapshot = { user: { _id: G1_FIXED.actorUserId }, memberships: [{ customerId: G1_FIXED.customerId, roles: ['CUSTOMER_USER'] }],
    tenantMemberships: [{ tenantId: G1_FIXED.tenantId }], platformRoles: [], vmfGrants: [],
    resolvedPermissions: { platform: { roleKeys: [] } },
    customer: { _id: 'previous-customer', status: 'ACTIVE' }, tenant: { _id: 'previous-tenant', customerId: 'previous-customer', status: 'ACTIVE' } }
  const before = JSON.parse(JSON.stringify(snapshot))
  permissions.mockResolvedValue(snapshot)
  await (mode === 'qa' ? issueNetworkQaMasterLinkedReviewRelease(qaArgs()) : issueMasterLinkedReviewRelease(args()))
  const selected = prepare.mock.calls[0][0].scopes
  expect(selected).toEqual({ ...snapshot,
    customer: { ...snapshot.customer, _id: G1_FIXED.customerId },
    tenant: { ...snapshot.tenant, _id: G1_FIXED.tenantId, customerId: G1_FIXED.customerId } })
  expect(selected.resolvedPermissions).toBe(snapshot.resolvedPermissions)
  expect(selected.memberships).toBe(snapshot.memberships)
  expect(snapshot).toEqual(before)
  expect(permissions).toHaveBeenCalledWith(expect.objectContaining({ _id: G1_FIXED.actorUserId, isActive: true }))
})

test.each(['genuine', 'qa'].flatMap(mode => ['permissions', 'access', 'caller-scope'].map(failure => ({ mode, failure }))))(
  '$mode issuer refuses $failure before entering its write transaction', async ({ mode, failure }) => {
    const input = mode === 'qa' ? qaArgs() : args(), refusal = Error('CURRENT_ACCESS_REFUSED')
    if (failure === 'permissions') permissions.mockRejectedValue(refusal)
    if (failure === 'access') prepare.mockRejectedValue(refusal)
    if (failure === 'caller-scope') input.scopes = { customer: { _id: 'other-customer' }, tenant: { _id: 'other-tenant' } }
    const call = mode === 'qa' ? issueNetworkQaMasterLinkedReviewRelease(input) : issueMasterLinkedReviewRelease(input)
    if (failure === 'caller-scope') await expect(call).rejects.toMatchObject({ details: { reason: 'RELEASE_INPUT' } })
    else await expect(call).rejects.toBe(refusal)
    expect(session.withTransaction).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

test.each(['genuine', 'qa'].flatMap(mode => [false, true].map(denied => ({ mode, denied }))))(
  '$mode authority preserves selected context while fresh permissions control denial=$denied', async ({ mode, denied }) => {
    await (mode === 'qa' ? issueNetworkQaMasterLinkedReviewRelease(qaArgs()) : issueMasterLinkedReviewRelease(args()))
    const selected = { customer: { _id: G1_FIXED.customerId }, tenant: { _id: G1_FIXED.tenantId, customerId: G1_FIXED.customerId } }
    const fresh = { resolvedPermissions: { platform: { roleKeys: [] } }, memberships: [], platformRoles: [] }
    permissions.mockResolvedValue(fresh)
    if (denied) runtimePermission.mockRejectedValue(Error('CURRENT_PERMISSION_DENIED'))
    const userFind = jest.spyOn(User, 'findOne').mockImplementation(() => { const q = { setOptions: () => q, lean: async () => ({ isActive: true }) }; return q })
    const auditOne = jest.spyOn(Audit, 'findOne').mockImplementation(() => { const q = { setOptions: () => q, lean: async () => saved }; return q })
    findExecution.mockImplementation(() => { const q = { setOptions: () => q, lean: async () => null }; return q })
    log.mockClear()
    try {
      const owner = mode === 'qa' ? createNetworkQaMasterLinkedReviewAuthority() : createGenuineMasterLinkedReviewAuthority()
      const call = owner.prepare({ actorUserId: G1_FIXED.actorUserId, runtimeInstanceId: G1_FIXED.runtimeInstanceId,
        candidateId: G1_FIXED.candidateId, scopes: { ...selected, resolvedPermissions: { platform: { roleKeys: ['STALE_ROLE'] } } },
        expected: binding, ...(mode === 'qa' ? { qaCase, qaReleaseAuditId: String(saved._id) } : { approvalAuditId: String(saved._id) }) })
      await expect(call).rejects.toThrow(denied ? 'CURRENT_PERMISSION_DENIED' : 'AFTER_AUTHORITY_TEST_BARRIER')
      expect(runtimePermission).toHaveBeenCalledWith(expect.objectContaining({ scopes: { ...selected, ...fresh }, ...scope, permission: 'VMF_UPDATE' }))
      if (denied) expect(runtimeRead).not.toHaveBeenCalled()
      else expect(runtimeRead).toHaveBeenCalledWith(expect.objectContaining({ scopes: { ...selected, ...fresh }, ...scope }))
      expect(indexBarrier).toHaveBeenCalledTimes(denied ? 0 : 1)
      expect(log).not.toHaveBeenCalled()
    } finally { userFind.mockRestore(); auditOne.mockRestore() }
  })
test('QA issuer shares signed storage but cannot mint genuine release authority', async () => {
  const metadata = await issueNetworkQaMasterLinkedReviewRelease(qaArgs())
  expect(metadata).toMatchObject({ mode: 'NETWORK_SIMULATED', genuineReviewEligible: false, dispatchAvailable: false })
  expect(saved.action).toBe(G1_QA_RELEASE.action)
  expect(saved.diff).toMatchObject({ version: G1_QA_RELEASE.version, qaCase, genuineReviewEligible: false })
  expect(assertG1QaRelease(saved, subject, binding, a => Audit.prototype.verifySignature.call(a), Date.now(), qaCase)).toEqual(saved.diff)
  expect(() => assertG1Approval(saved, subject, binding, a => Audit.prototype.verifySignature.call(a), Date.now())).toThrow()
  expect(await issueNetworkQaMasterLinkedReviewRelease(qaArgs())).toEqual(metadata)
  expect(log).toHaveBeenCalledTimes(1)
})
test.each([undefined, null, {}, 42, ['ss055-release-proof-unit-main']].map(value => ({ value })))('QA validator rejects genuine audit with malformed case $value', async ({ value }) => {
  await issueMasterLinkedReviewRelease(args())
  expect(() => assertG1QaRelease(saved, subject, binding, a => Audit.prototype.verifySignature.call(a), Date.now(), value)).toThrow()
})
test.each([false, true])('bound QA owner read enforces issuer times, shifted=%s', async shifted => {
  await issueNetworkQaMasterLinkedReviewRelease(qaArgs())
  const release = saved, auditId = new mongoose.Types.ObjectId(), recordId = new mongoose.Types.ObjectId()
  const b = { version: G1_VERSION, phase: 'GRANT', decision: 'GRANT', mode: G1_MODES.QA, scope,
    actorUserId: G1_FIXED.actorUserId, subject, request: binding, runtime: {}, planId: 'unit-projected-read',
    executionId: 'master_docx_dispatch_11111111-1111-4111-8111-111111111111', qaCase,
    onceRoot: g1Root(scope, G1_MODES.QA, qaCase),
    approval: { kind: G1_QA_RELEASE.kind, auditId: String(release._id), diffFingerprint: membershipHash(release.diff) },
    grantCreatedAt: new Date(Date.parse(release.diff.issuedAt) + (shifted ? 1000 : 0)).toISOString(),
    expiresAt: new Date(Date.parse(release.diff.expiresAt) + (shifted ? 1000 : 0)).toISOString() }
  const row = { unitProjectedGrant: true, _id: recordId, executionId: b.executionId,
    executionEvidence: { masterDocxDispatch: { body: b, bodyFingerprint: membershipHash(b), auditId, auditSignatureVersion: 3 } } }
  const audit = new Audit({ _id: auditId, actorUserId: b.actorUserId, action: 'MASTER_DOCX_DISPATCH_GRANTED',
    resourceType: 'GovernedReasoningExecution', resourceId: recordId, scope, diff: g1AuditDiff(row), signatureVersion: 3 })
  audit.generateSignature(); const grantAudit = audit.toObject()
  const userFind = jest.spyOn(User, 'findOne').mockImplementation(() => { const q = { setOptions: () => q, lean: async () => ({ isActive: true }) }; return q })
  const auditOne = jest.spyOn(Audit, 'findOne').mockImplementation(filter => { const q = { setOptions: () => q,
    lean: async () => String(filter._id) === String(release._id) ? release : grantAudit }; return q })
  findExecution.mockImplementation(filter => { const q = { setOptions: () => q, lean: async () => filter.executionId === b.executionId ? row : null }; return q })
  log.mockClear()
  try {
    const call = createNetworkQaMasterLinkedReviewAuthority().read({ actorUserId: b.actorUserId, scopes: {}, grantExecutionId: b.executionId })
    if (shifted) await expect(call).rejects.toMatchObject({ details: { reason: 'QA_RELEASE_TIME_CHANGED' } })
    else await expect(call).resolves.toMatchObject({ mode: G1_MODES.QA, submissionState: 'NOT_STARTED', genuineReviewUsed: false })
    expect(log).not.toHaveBeenCalled()
  } finally { userFind.mockRestore(); auditOne.mockRestore() }
})
test.each(['mode', 'missing-case', 'wrong-prefix', 'object-case'])('QA issuer rejects %s without writes', async kind => {
  const input = qaArgs()
  if (kind === 'mode') input.mode = 'GENUINE_CONTROLLED_TEST'
  if (kind === 'missing-case') delete input.qaCase
  if (kind === 'wrong-prefix') input.qaCase = 'genuine'
  if (kind === 'object-case') input.qaCase = [qaCase]
  await expect(issueNetworkQaMasterLinkedReviewRelease(input)).rejects.toThrow(); expect(log).not.toHaveBeenCalled()
})
test.each(['case', 'genuine-eligible', 'root', 'action', ...Object.keys(binding)])('QA signed release rejects resealed wrong %s', async kind => {
  await issueNetworkQaMasterLinkedReviewRelease(qaArgs())
  const data = JSON.parse(JSON.stringify(saved))
  if (kind === 'case') data.diff.qaCase += '-other'
  if (kind === 'genuine-eligible') data.diff.genuineReviewEligible = true
  if (kind === 'root') data.diff.onceRoot = data.diff.onceRoot.replace('NETWORK_QA', 'SINGLE_GENUINE')
  if (kind === 'action') data.action = 'MASTER_GENUINE_REVIEW_RELEASE_APPROVED'
  if (Object.hasOwn(binding, kind)) data.diff.requestBinding[kind] = 'f'.repeat(64)
  const audit = new Audit(data); audit.generateSignature()
  expect(() => assertG1QaRelease(audit.toObject(), subject, binding, a => Audit.prototype.verifySignature.call(a), Date.now(), qaCase)).toThrow()
})
test.each(['current', 'changed', 'wrong-case', 'invalid-id', 'expired', 'genuine-audit', 'genuine-slot'])('bound QA consumer validates %s release before writing', async kind => {
  if (kind === 'genuine-audit') await issueMasterLinkedReviewRelease(args())
  else await issueNetworkQaMasterLinkedReviewRelease(qaArgs())
  if (kind === 'changed') nativeOperator.mockResolvedValue({ ...operator, fingerprint: 'b'.repeat(64) })
  if (kind === 'expired') {
    const audit = new Audit({ ...saved, diff: { ...saved.diff, issuedAt: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() - 1800000).toISOString() } })
    audit.generateSignature(); saved = audit.toObject()
  }
  const userFind = jest.spyOn(User, 'findOne').mockImplementation(() => { const q = { setOptions: () => q, lean: async () => ({ isActive: true }) }; return q })
  const auditOne = jest.spyOn(Audit, 'findOne').mockImplementation(() => { const q = { setOptions: () => q, lean: async () => saved }; return q })
  log.mockClear()
  try {
    const call = createNetworkQaMasterLinkedReviewAuthority().prepare({ actorUserId: G1_FIXED.actorUserId,
      runtimeInstanceId: G1_FIXED.runtimeInstanceId, candidateId: G1_FIXED.candidateId,
      qaCase: kind === 'wrong-case' ? qaCase + '-other' : qaCase,
      qaReleaseAuditId: kind === 'invalid-id' ? { auditId: String(saved._id) } : String(saved._id), scopes: {}, expected: binding,
      ...(kind === 'genuine-slot' ? { approvalAuditId: String(saved._id) } : {}) })
    if (kind === 'current') await expect(call).rejects.toThrow('AFTER_AUTHORITY_TEST_BARRIER')
    else await expect(call).rejects.toMatchObject({ code: 'MASTER_DOCX_REVIEW_HELD' })
    expect(indexBarrier).toHaveBeenCalledTimes(kind === 'current' ? 1 : 0); expect(log).not.toHaveBeenCalled()
  } finally { userFind.mockRestore(); auditOne.mockRestore() }
})
