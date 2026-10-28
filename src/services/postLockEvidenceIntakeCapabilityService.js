import { inspectPostLockImplementationCapability } from './discoveryPolicyContract.js'
import { membershipJson, EVIDENCE_MEMBERSHIP_VERSION, EVIDENCE_MATERIAL_HASH_ALGORITHM,
  EVIDENCE_MEMBER_LIMITS } from './runtimeEvidenceSnapshotContract.js'

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
const snapshotPattern = new RegExp(`^evidence_snapshot_${UUID}$`)
const statePattern = new RegExp(`^rsv2:${UUID}$`)
const hashPattern = /^[a-f0-9]{64}$/
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const descriptor = ({ reason, blockedBy = [reason], policy = { status: 'NOT_CHECKED' }, frozenBasis = { available: false } }) => ({
  contractVersion: 'post-lock-evidence-intake-capability.v1', available: false, reason, blockedBy: [...new Set(blockedBy)],
  policy, frozenBasis, registrationAvailable: false, dispositionAvailable: false, impactApplicationAvailable: false,
})
const verifiedPredecessor = (lockBasis, runtime) => {
  try {
    const frozen = membershipJson(lockBasis?.frozenInventory)
    return exact(frozen, ['available', 'completeness', 'reason', 'contractVersion', 'snapshotId', 'membershipHash',
      'basisStateVersion', 'lockSnapshotId', 'lockSnapshotHash', 'revisionNumber', 'counts', 'verification'])
      && frozen.available === true && frozen.completeness === 'VERIFIED' && frozen.reason === null
      && frozen.contractVersion === EVIDENCE_MEMBERSHIP_VERSION && snapshotPattern.test(frozen.snapshotId)
      && hashPattern.test(frozen.membershipHash) && statePattern.test(frozen.basisStateVersion)
      && runtime?.status === 'LOCKED' && lockBasis.locked === true && frozen.basisStateVersion === runtime.stateVersion
      && Number.isSafeInteger(frozen.revisionNumber) && frozen.revisionNumber > 0 && frozen.revisionNumber === runtime.revision?.revisionNumber
      && frozen.lockSnapshotId === lockBasis.snapshot?.snapshotId && frozen.lockSnapshotHash === lockBasis.snapshot?.snapshotHash
      && hashPattern.test(frozen.lockSnapshotHash) && typeof frozen.lockSnapshotId === 'string' && frozen.lockSnapshotId.length > 0
      && exact(frozen.counts, ['sources', 'evidence', 'sections'])
      && Object.entries(EVIDENCE_MEMBER_LIMITS).every(([key, limit]) => Number.isSafeInteger(frozen.counts[key]) && frozen.counts[key] >= 0 && frozen.counts[key] <= limit)
      && exact(frozen.verification, ['basis', 'materialHashAlgorithm', 'auditLinkVerified'])
      && frozen.verification.basis === 'EXACT_PERSISTED_MEMBERSHIP'
      && frozen.verification.materialHashAlgorithm === EVIDENCE_MATERIAL_HASH_ALGORITHM && frozen.verification.auditLinkVerified === true
  } catch { return false }
}
const bindingFailure = () => Object.assign(new Error('The selected Runtime package policy could not be read exactly.'), {
  status: 409, code: 'CONFLICT', details: { reason: 'POST_LOCK_POLICY_BINDING_UNVERIFIED' },
})

// The readPackage callback is supplied only by the scoped repository. This owner
// has no capture/write/provider imports and cannot enable an intake operation.
export const readPostLockEvidenceIntakeCapability = async ({ lockBasis, runtime, session, readBudget, readPackage } = {}) => {
  if (lockBasis?.available !== true) return descriptor({ reason: 'LOCK_BASIS_UNAVAILABLE' })
  if (!verifiedPredecessor(lockBasis, runtime)) return descriptor({ reason: lockBasis.frozenInventory?.reason === 'FROZEN_MEMBERSHIP_NOT_RECORDED'
    ? 'FROZEN_MEMBERSHIP_NOT_RECORDED' : 'FROZEN_MEMBERSHIP_UNAVAILABLE' })
  if (!/^[a-f0-9]{24}$/.test(String(runtime.packageId || ''))
    || ['frameworkKey', 'packageKey', 'packageVersion'].some(key => typeof runtime[key] !== 'string' || !runtime[key].trim())) throw bindingFailure()
  const packages = await readPackage({ runtime, session, readBudget })
  if (!Array.isArray(packages) || packages.length !== 1) throw bindingFailure()
  const frameworkPackage = packages[0]
  if (String(frameworkPackage?._id) !== String(runtime.packageId) || frameworkPackage.frameworkKey !== runtime.frameworkKey
    || frameworkPackage.packageKey !== runtime.packageKey || frameworkPackage.version !== runtime.packageVersion) throw bindingFailure()
  const report = inspectPostLockImplementationCapability({ frameworkPackage, runtimeInstance: runtime })
  const frozen = lockBasis.frozenInventory
  return descriptor({ reason: report.reason, blockedBy: report.blockedBy, policy: report.policy,
    frozenBasis: { available: true, snapshotId: frozen.snapshotId, membershipHash: frozen.membershipHash, basisStateVersion: frozen.basisStateVersion } })
}
