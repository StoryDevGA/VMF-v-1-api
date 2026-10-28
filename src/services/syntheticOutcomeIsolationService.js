import { PUBLISHED_DISPOSITION_POLICY as policy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { SNAPSHOT_RECOVERY_POLICY as parent } from '../models/RuntimeEvidenceSnapshotRecovery.js'
import { membershipHash, membershipJson } from './runtimeEvidenceSnapshotContract.js'

export const SYNTHETIC_DIRECT_REVISION_VERSION = 'isolated-synthetic-direct-revision.v1'
const exact = (value, keys) => value && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 240
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const oid = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
const need = condition => { if (!condition) throw new Error('The controlled direct revision admission is invalid.') }
const packageKeys = ['packageId', 'packageKey', 'packageVersion', 'dependencyLockId', 'activationId', 'deploymentId']
const derivedKeys = ['derivedFromPublishSnapshotId', 'derivedFromPublishSnapshotHash', 'derivedFromLockSnapshotId',
  'derivedFromLockSnapshotHash', 'derivedFromReplayAnchorId', 'derivedFromReplayAnchorHash']
const workspace = value => {
  need(value == null || (typeof value === 'string' && value.length <= 160 && value === value.trim()))
  return value || ''
}
export const assertSyntheticParentBasis = basis => {
  need(exact(basis, ['snapshotId', 'membershipHash', 'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash', 'counts', 'correctionReceiptId', 'correctionBodyHash'])
    && basis.snapshotId === parent.snapshotId && basis.membershipHash === parent.membershipHash && basis.basisStateVersion === parent.stateVersion
    && text(basis.lockSnapshotId) && hash(basis.lockSnapshotHash) && uuid(basis.correctionReceiptId) && hash(basis.correctionBodyHash)
    && exact(basis.counts, ['sources', 'evidence', 'sections']) && basis.counts.sources === 8 && basis.counts.evidence === 47 && basis.counts.sections === 6)
  return basis
}
export const assertDirectSyntheticRevisionLineage = lineage => {
  need(exact(lineage, ['contractVersion', 'runtimeInstanceKey', 'revisionNumber', 'parentRuntimeInstanceId', 'parentRuntimeInstanceKey',
    'rootRuntimeInstanceId', 'rootRuntimeInstanceKey', 'workspaceId', 'runtimeType', 'frameworkKey', 'package', 'parentBasis', ...derivedKeys])
    && lineage.contractVersion === SYNTHETIC_DIRECT_REVISION_VERSION && text(lineage.runtimeInstanceKey)
    && lineage.runtimeInstanceKey !== parent.runtimeInstanceKey && lineage.revisionNumber === 2
    && lineage.parentRuntimeInstanceId === parent.runtimeInstanceId && lineage.rootRuntimeInstanceId === parent.runtimeInstanceId
    && lineage.parentRuntimeInstanceKey === parent.runtimeInstanceKey && lineage.rootRuntimeInstanceKey === parent.runtimeInstanceKey
    && lineage.runtimeType === 'VALUE_NARRATIVE' && text(lineage.frameworkKey)
    && typeof lineage.workspaceId === 'string' && workspace(lineage.workspaceId) === lineage.workspaceId
    && exact(lineage.package, packageKeys) && oid(lineage.package.packageId) && packageKeys.every(key => text(lineage.package[key]))
    && derivedKeys.every(key => text(lineage[key])))
  assertSyntheticParentBasis(lineage.parentBasis)
  need(lineage.derivedFromLockSnapshotId === lineage.parentBasis.lockSnapshotId
    && lineage.derivedFromLockSnapshotHash === lineage.parentBasis.lockSnapshotHash)
  return lineage
}
// Inputs are native runtime/control and verified proof, never a caller DTO.
export const buildDirectSyntheticRevisionLineage = ({ runtime, parentRuntime, parentBasis }) => {
  need(String(parentRuntime._id || parentRuntime.id) === parent.runtimeInstanceId
    && parentRuntime.runtimeInstanceKey === parent.runtimeInstanceKey && parentRuntime.revision?.revisionNumber === 1
    && parentRuntime.stateVersion === parent.stateVersion && runtime.revision?.revisionNumber === 2
    && runtime.revision.createdFromRevision === 1 && String(runtime.revision.parentRuntimeId) === parent.runtimeInstanceId
    && String(runtime.revision.rootRuntimeId) === parent.runtimeInstanceId
    && runtime.revision.parentRuntimeInstanceKey === parent.runtimeInstanceKey && runtime.revision.rootRuntimeInstanceKey === parent.runtimeInstanceKey
    && runtime.runtimeType === 'VALUE_NARRATIVE' && runtime.runtimeType === parentRuntime.runtimeType
    && runtime.frameworkKey === parentRuntime.frameworkKey && workspace(runtime.workspaceId) === workspace(parentRuntime.workspaceId)
    && ['customerId', 'tenantId'].every(key => String(runtime[key]) === parent[key] && String(parentRuntime[key]) === parent[key])
    && packageKeys.every(key => String(runtime[key] || '') === String(parentRuntime[key] || '')))
  const publish = parentRuntime.framework_state?.publish?.snapshot || {}, lock = parentRuntime.framework_state?.lock || {}
  const snapshot = lock.snapshot || {}, replay = lock.replayAnchor || lock.anchor || {}
  const expected = { derivedFromPublishSnapshotId: publish.snapshotId || publish.id, derivedFromPublishSnapshotHash: publish.snapshotHash || publish.hash,
    derivedFromLockSnapshotId: snapshot.snapshotId || snapshot.id, derivedFromLockSnapshotHash: snapshot.snapshotHash || snapshot.hash,
    derivedFromReplayAnchorId: replay.replayAnchorId || replay.anchorId || replay.id, derivedFromReplayAnchorHash: replay.replayAnchorHash || replay.anchorHash || replay.hash }
  need(derivedKeys.every(key => runtime.revision[key] === expected[key]))
  const lineage = { contractVersion: SYNTHETIC_DIRECT_REVISION_VERSION, runtimeInstanceKey: runtime.runtimeInstanceKey, revisionNumber: 2,
    parentRuntimeInstanceId: parent.runtimeInstanceId, parentRuntimeInstanceKey: parent.runtimeInstanceKey,
    rootRuntimeInstanceId: parent.runtimeInstanceId, rootRuntimeInstanceKey: parent.runtimeInstanceKey,
    workspaceId: workspace(runtime.workspaceId), runtimeType: runtime.runtimeType, frameworkKey: runtime.frameworkKey,
    package: Object.fromEntries(packageKeys.map(key => [key, String(runtime[key] || '')])), parentBasis: membershipJson(parentBasis), ...expected }
  assertDirectSyntheticRevisionLineage(lineage)
  need(membershipHash(lineage.parentBasis) === membershipHash(parentBasis))
  return lineage
}

export const SYNTHETIC_SUCCESSOR_REVISION_VERSION = 'isolated-synthetic-successor-revision.v1'
export const SYNTHETIC_SUCCESSOR_IDENTITY = Object.freeze({
  runtimeInstanceId: '6ad715c91f39fea112115875',
  runtimeInstanceKey: 'ss044-disposable-synthetic-20261013-r1-rev-2-0f316453-rev-3-12115875',
  parentRuntimeInstanceId: '6ad4b3cab439648c0f316453',
  parentRuntimeInstanceKey: 'ss044-disposable-synthetic-20261013-r1-rev-2-0f316453',
  parentStateVersion: 'rsv2:98b09889-c96a-4a5a-81c8-1495cafc9047',
  parentSnapshotId: 'evidence_snapshot_06520bf7-0c8f-4c8e-bb25-8693fe1d0e36',
  parentMembershipHash: 'b18750af94f337870cba83b34fe67175091806877dbeae1a25db2734423e869d',
  parentLockSnapshotId: 'runtime-truth-lock-record-ss044-disposable-synthetic-20261013-r1-rev-2-0f316453-adc4fa6d05b5258a',
  parentLockSnapshotHash: 'adc4fa6d05b5258a34bef5cd46d37ca8769d828e48d2e144197733ef402a562c',
})
export const assertSuccessorSyntheticRevisionLineage = lineage => {
  const target = SYNTHETIC_SUCCESSOR_IDENTITY
  need(exact(lineage, ['contractVersion', 'runtimeInstanceId', 'runtimeInstanceKey', 'revisionNumber',
    'parentRuntimeInstanceId', 'parentRuntimeInstanceKey', 'rootRuntimeInstanceId', 'rootRuntimeInstanceKey',
    'workspaceId', 'runtimeType', 'frameworkKey', 'package', 'parentBasis', ...derivedKeys])
    && lineage.contractVersion === SYNTHETIC_SUCCESSOR_REVISION_VERSION
    && lineage.runtimeInstanceId === target.runtimeInstanceId && lineage.runtimeInstanceKey === target.runtimeInstanceKey
    && lineage.revisionNumber === 3 && lineage.parentRuntimeInstanceId === target.parentRuntimeInstanceId
    && lineage.parentRuntimeInstanceKey === target.parentRuntimeInstanceKey
    && lineage.rootRuntimeInstanceId === parent.runtimeInstanceId && lineage.rootRuntimeInstanceKey === parent.runtimeInstanceKey
    && lineage.runtimeType === 'VALUE_NARRATIVE' && text(lineage.frameworkKey)
    && typeof lineage.workspaceId === 'string' && workspace(lineage.workspaceId) === lineage.workspaceId
    && exact(lineage.package, packageKeys) && oid(lineage.package.packageId) && packageKeys.every(key => text(lineage.package[key]))
    && derivedKeys.every(key => text(lineage[key])))
  const basis = lineage.parentBasis
  need(exact(basis, ['snapshotId', 'membershipHash', 'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash', 'counts', 'lineage'])
    && basis.snapshotId === target.parentSnapshotId && basis.membershipHash === target.parentMembershipHash
    && basis.basisStateVersion === target.parentStateVersion && basis.lockSnapshotId === target.parentLockSnapshotId
    && basis.lockSnapshotHash === target.parentLockSnapshotHash && exact(basis.counts, ['sources', 'evidence', 'sections'])
    && Object.entries({ sources: 1000, evidence: 5000, sections: 100 }).every(([key, cap]) => Number.isSafeInteger(basis.counts[key])
      && basis.counts[key] >= 0 && basis.counts[key] <= cap))
  assertDirectSyntheticRevisionLineage(basis.lineage)
  need(basis.lineage.runtimeInstanceKey === target.parentRuntimeInstanceKey
    && membershipHash(basis.lineage.package) === membershipHash(lineage.package)
    && basis.lineage.workspaceId === lineage.workspaceId && basis.lineage.frameworkKey === lineage.frameworkKey
    && lineage.derivedFromLockSnapshotId === basis.lockSnapshotId && lineage.derivedFromLockSnapshotHash === basis.lockSnapshotHash)
  return lineage
}
export const buildSuccessorSyntheticRevisionLineage = ({ runtime, parentRuntime, parentBasis }) => {
  const target = SYNTHETIC_SUCCESSOR_IDENTITY, revision = runtime.revision || {}
  need(String(runtime._id || runtime.id) === target.runtimeInstanceId && runtime.runtimeInstanceKey === target.runtimeInstanceKey
    && String(parentRuntime._id || parentRuntime.id) === target.parentRuntimeInstanceId
    && parentRuntime.runtimeInstanceKey === target.parentRuntimeInstanceKey && parentRuntime.stateVersion === target.parentStateVersion
    && parentRuntime.revision?.revisionNumber === 2 && parentRuntime.revision.createdFromRevision === 1
    && String(parentRuntime.revision.parentRuntimeId) === parent.runtimeInstanceId && String(parentRuntime.revision.rootRuntimeId) === parent.runtimeInstanceId
    && parentRuntime.revision.parentRuntimeInstanceKey === parent.runtimeInstanceKey
    && parentRuntime.revision.rootRuntimeInstanceKey === parent.runtimeInstanceKey
    && revision.revisionNumber === 3 && revision.createdFromRevision === 2
    && String(revision.parentRuntimeId) === target.parentRuntimeInstanceId && revision.parentRuntimeInstanceKey === target.parentRuntimeInstanceKey
    && String(revision.rootRuntimeId) === parent.runtimeInstanceId && revision.rootRuntimeInstanceKey === parent.runtimeInstanceKey
    && runtime.runtimeType === parentRuntime.runtimeType && runtime.frameworkKey === parentRuntime.frameworkKey
    && workspace(runtime.workspaceId) === workspace(parentRuntime.workspaceId)
    && ['customerId', 'tenantId'].every(key => String(runtime[key]) === parent[key] && String(parentRuntime[key]) === parent[key])
    && packageKeys.every(key => String(runtime[key] || '') === String(parentRuntime[key] || '')))
  const publish = parentRuntime.framework_state?.publish?.snapshot || {}, lock = parentRuntime.framework_state?.lock || {}
  const snapshot = lock.snapshot || {}, replay = lock.replayAnchor || lock.anchor || {}
  const anchors = { derivedFromPublishSnapshotId: publish.snapshotId || publish.id, derivedFromPublishSnapshotHash: publish.snapshotHash || publish.hash,
    derivedFromLockSnapshotId: snapshot.snapshotId || snapshot.id, derivedFromLockSnapshotHash: snapshot.snapshotHash || snapshot.hash,
    derivedFromReplayAnchorId: replay.replayAnchorId || replay.anchorId || replay.id, derivedFromReplayAnchorHash: replay.replayAnchorHash || replay.anchorHash || replay.hash }
  need(derivedKeys.every(key => revision[key] === anchors[key]))
  return assertSuccessorSyntheticRevisionLineage({ contractVersion: SYNTHETIC_SUCCESSOR_REVISION_VERSION,
    runtimeInstanceId: target.runtimeInstanceId, runtimeInstanceKey: runtime.runtimeInstanceKey, revisionNumber: 3,
    parentRuntimeInstanceId: target.parentRuntimeInstanceId, parentRuntimeInstanceKey: target.parentRuntimeInstanceKey,
    rootRuntimeInstanceId: parent.runtimeInstanceId, rootRuntimeInstanceKey: parent.runtimeInstanceKey,
    workspaceId: workspace(runtime.workspaceId), runtimeType: runtime.runtimeType, frameworkKey: runtime.frameworkKey,
    package: Object.fromEntries(packageKeys.map(key => [key, String(runtime[key] || '')])), parentBasis: membershipJson(parentBasis), ...anchors })
}

// Native runtime identity is the authority. Caller flags and receipt presence never grant access.
export const isControlledSyntheticOutcomeRuntime = runtime => {
  const identities = [runtime?._id, runtime?.id, runtime?.runtimeInstanceId,
    runtime?.revision?.rootRuntimeId, runtime?.revision?.parentRuntimeId].map(value => String(value || '').trim().toLowerCase())
  return identities.includes(policy.scope.runtimeInstanceId)
    || identities.includes(policy.scope.runtimeInstanceKey)
    || String(runtime?.runtimeInstanceKey || '').trim().toLowerCase() === policy.scope.runtimeInstanceKey
}
export const assertNormalOutcomeRuntime = runtime => {
  assertNoControlledReplayIsolation(runtime)
  if (isControlledSyntheticOutcomeRuntime(runtime)) {
    throw Object.assign(new Error('This controlled synthetic runtime is isolated from normal output access.'), {
      status: 409, code: 'SYNTHETIC_OUTCOME_ISOLATED',
      details: { reason: 'SYNTHETIC_OUTCOME_ISOLATED' },
    })
  }
  return runtime
}
import { assertNoControlledReplayIsolation } from './controlledReplayIsolationService.js'
