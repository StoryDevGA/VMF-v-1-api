import { describe, test, expect } from '@jest/globals'
import express from 'express'
import supertest from 'supertest'
import { assertNormalOutcomeRuntime, buildDirectSyntheticRevisionLineage, buildSuccessorSyntheticRevisionLineage,
  assertSuccessorSyntheticRevisionLineage, SYNTHETIC_SUCCESSOR_IDENTITY as successor } from '../services/syntheticOutcomeIsolationService.js'

const root = '6ace5ee09bd4472c6be0cb07'
const key = 'ss044-disposable-synthetic-20261013-r1'
describe('server-owned normal-output isolation', () => {
  test.each([{ _id: root }, { id: root }, { runtimeInstanceId: root }, { runtimeInstanceKey: key },
    { _id: root.toUpperCase() }, { id: key }, { revision: { rootRuntimeId: root } },
    { revision: { parentRuntimeId: root } }, { _id: 'ordinary', runtimeInstanceKey: key },
    { _id: root, synthetic: false, allowSynthetic: true, approved: true }])('denies native synthetic origin without depending on labels %j', runtime => {
    const before = JSON.stringify(runtime)
    expect(() => assertNormalOutcomeRuntime(runtime)).toThrow(expect.objectContaining({
      code: 'SYNTHETIC_OUTCOME_ISOLATED', status: 409, details: { reason: 'SYNTHETIC_OUTCOME_ISOLATED' },
    }))
    expect(JSON.stringify(runtime)).toBe(before)
  })
  test.each([{ _id: 'ordinary' }, { _id: '6aaac9cee9e075fb1e8e498b', runtimeInstanceKey: 'Parlon' },
    { _id: 'ordinary', synthetic: true }, { revision: { rootRuntimeId: 'another-family' } }])('leaves ordinary runtime eligibility to its native owners %j', runtime => {
    expect(assertNormalOutcomeRuntime(runtime)).toBe(runtime)
  })
  test('mounted transport rejects access without returning content or running the delivery owner', async () => {
    let delivered = false
    const app = express()
    app.get('/output', (_req, res, next) => {
      try { assertNormalOutcomeRuntime({ _id: root }); delivered = true; res.json({ content: 'secret' }) }
      catch (error) { next(error) }
    })
    app.use((error, _req, res, _next) => res.status(error.status).json({ error: { code: error.code, details: error.details } }))
    const response = await supertest(app).get('/output')
    expect(response.status).toBe(409)
    expect(response.body).not.toHaveProperty('data')
    expect(response.body).not.toHaveProperty('content')
    expect(delivered).toBe(false)
  })
})


const successorNativeChain = () => {
  const common = { customerId: '6a6c75f2cace7a21bd41ef98', tenantId: '6a6c76e3cace7a21bd41eff9', workspaceId: '',
    runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'value-narrative', packageId: '6aa923ac50c4a5b07e60b716',
    packageKey: 'native-component-package', packageVersion: '1.0.0', dependencyLockId: 'dependency-1', activationId: 'activation-1', deploymentId: 'deployment-1' }
  return { common }
}
describe('strict exact successor lineage contract', () => {
  test('normal output still denies exact successor native ancestry without caller flags', () => {
    expect(() => assertNormalOutcomeRuntime({ _id: successor.runtimeInstanceId, revision: { rootRuntimeId: root } }))
      .toThrow(expect.objectContaining({ code: 'SYNTHETIC_OUTCOME_ISOLATED' }))
  })
  test('native builder validates immediate parent anchors, nested recovered basis and exact successor only', async () => {
    const { SNAPSHOT_RECOVERY_POLICY: p } = await import('../models/RuntimeEvidenceSnapshotRecovery.js')
    const { common } = successorNativeChain()
    const originalBasis = { snapshotId: p.snapshotId, membershipHash: p.membershipHash, basisStateVersion: p.stateVersion,
      lockSnapshotId: 'original-lock', lockSnapshotHash: '1'.repeat(64), counts: { sources: 8, evidence: 47, sections: 6 },
      correctionReceiptId: '11111111-1111-4111-8111-111111111111', correctionBodyHash: '2'.repeat(64) }
    const original = { ...common, _id: p.runtimeInstanceId, runtimeInstanceKey: p.runtimeInstanceKey, stateVersion: p.stateVersion,
      revision: { revisionNumber: 1 }, framework_state: { publish: { snapshot: { snapshotId: 'r1-publish', snapshotHash: '3'.repeat(64) } },
        lock: { snapshot: { snapshotId: originalBasis.lockSnapshotId, snapshotHash: originalBasis.lockSnapshotHash },
          replayAnchor: { replayAnchorId: 'r1-replay', replayAnchorHash: '4'.repeat(64) } } } }
    const direct = { ...common, _id: successor.parentRuntimeInstanceId, runtimeInstanceKey: successor.parentRuntimeInstanceKey,
      stateVersion: successor.parentStateVersion, revision: { revisionNumber: 2, createdFromRevision: 1,
        parentRuntimeId: p.runtimeInstanceId, parentRuntimeInstanceKey: p.runtimeInstanceKey,
        rootRuntimeId: p.runtimeInstanceId, rootRuntimeInstanceKey: p.runtimeInstanceKey,
        derivedFromPublishSnapshotId: 'r1-publish', derivedFromPublishSnapshotHash: '3'.repeat(64),
        derivedFromLockSnapshotId: originalBasis.lockSnapshotId, derivedFromLockSnapshotHash: originalBasis.lockSnapshotHash,
        derivedFromReplayAnchorId: 'r1-replay', derivedFromReplayAnchorHash: '4'.repeat(64) },
      framework_state: { publish: { snapshot: { snapshotId: 'r2-publish', snapshotHash: '5'.repeat(64) } },
        lock: { snapshot: { snapshotId: successor.parentLockSnapshotId, snapshotHash: successor.parentLockSnapshotHash },
          replayAnchor: { replayAnchorId: 'r2-replay', replayAnchorHash: '6'.repeat(64) } } } }
    const parentBasis = { snapshotId: successor.parentSnapshotId, membershipHash: successor.parentMembershipHash,
      basisStateVersion: successor.parentStateVersion, lockSnapshotId: successor.parentLockSnapshotId, lockSnapshotHash: successor.parentLockSnapshotHash,
      counts: { sources: 8, evidence: 47, sections: 6 }, lineage: buildDirectSyntheticRevisionLineage({ runtime: direct, parentRuntime: original, parentBasis: originalBasis }) }
    const runtime = { ...common, _id: successor.runtimeInstanceId, runtimeInstanceKey: successor.runtimeInstanceKey,
      revision: { revisionNumber: 3, createdFromRevision: 2, parentRuntimeId: direct._id, parentRuntimeInstanceKey: direct.runtimeInstanceKey,
        rootRuntimeId: p.runtimeInstanceId, rootRuntimeInstanceKey: p.runtimeInstanceKey,
        derivedFromPublishSnapshotId: 'r2-publish', derivedFromPublishSnapshotHash: '5'.repeat(64),
        derivedFromLockSnapshotId: parentBasis.lockSnapshotId, derivedFromLockSnapshotHash: parentBasis.lockSnapshotHash,
        derivedFromReplayAnchorId: 'r2-replay', derivedFromReplayAnchorHash: '6'.repeat(64) } }
    const build = () => buildSuccessorSyntheticRevisionLineage({ runtime, parentRuntime: direct, parentBasis })
    const lineage = build(); expect(assertSuccessorSyntheticRevisionLineage(lineage)).toEqual(lineage)
    for (const change of [f => { f._id += '0' }, f => { f.runtimeInstanceKey += '-wrong' },
      f => { f.revision.parentRuntimeId = p.runtimeInstanceId }, f => { f.revision.rootRuntimeId = direct._id },
      f => { f.revision.createdFromRevision = 1 }, f => { f.revision.derivedFromPublishSnapshotId = 'r1-publish' },
      f => { f.packageVersion = 'changed' }, f => { f.workspaceId = 'another' }, f => { f.customerId = '0'.repeat(24) }]) {
      const altered = JSON.parse(JSON.stringify(runtime)); change(altered)
      expect(() => buildSuccessorSyntheticRevisionLineage({ runtime: altered, parentRuntime: direct, parentBasis })).toThrow()
    }
    const malformed = JSON.parse(JSON.stringify(lineage)); malformed.parentBasis.lineage.parentBasis.correctionReceiptId = 'bad'
    expect(() => assertSuccessorSyntheticRevisionLineage(malformed)).toThrow()
    const stale = JSON.parse(JSON.stringify(parentBasis)); stale.basisStateVersion = 'rsv2:11111111-1111-4111-8111-111111111111'
    expect(() => buildSuccessorSyntheticRevisionLineage({ runtime, parentRuntime: direct, parentBasis: stale })).toThrow()
  })
})
