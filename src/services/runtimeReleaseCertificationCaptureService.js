import mongoose from 'mongoose'
import { isDeepStrictEqual } from 'node:util'
import RuntimeValidationAudit from '../models/RuntimeValidationAudit.js'
import { buildRuntimeReleaseCertificationBinding } from './runtimeReleaseCertificationService.js'
import { generateChecksum } from './governanceAudit/checksumService.js'
import { FrameworkPackage, RuntimePathRegistry, ValidationRegistry, WorkflowPolicy,
  RuntimeAgent, RuntimeSkill, SkillRoleRegistry, UIContract } from '../models/index.js'

const models = { RuntimePathRegistry, ValidationRegistry, WorkflowPolicy,
  RuntimeAgent, RuntimeSkill, SkillRoleRegistry, UIContract }
export const CERTIFICATION_PACKAGE_SELECTION = '+validationConfig +workflowPolicyConfig +compatibleWorkflowKeys +defaultAgentIds +requiredSkillIds +validationRules'

export const assertRuntimeCertificationTransaction = (session) => {
  if (typeof session?.inTransaction !== 'function' || session.inTransaction() !== true) {
    throw Object.assign(new Error('Package certification requires an active transaction.'), {
      code: 'RUNTIME_VALIDATION_EVIDENCE_PERSISTENCE_FAILED', status: 500,
    })
  }
}

export const loadRuntimeCertificationPackage = async ({ packageId, session }) => {
  assertRuntimeCertificationTransaction(session)
  const identifier = String(packageId || '').trim()
  if (!identifier) return null
  const query = mongoose.isValidObjectId(identifier)
    ? FrameworkPackage.findById(identifier)
    : FrameworkPackage.findOne({ packageKey: identifier })
  return query.select(CERTIFICATION_PACKAGE_SELECTION).session(session).lean()
}

const observed = (value) => value === undefined ? { $exists: false }
  : value === null ? { $eq: null, $exists: true } : value
const literalEquality = (path, value) => ({ $eq: [{ $literal: value }, `$${path}`] })
export const buildRuntimeCertificationPackageCas = (pkg) => {
  const filter = {
    _id: pkg._id,
    updatedAt: observed(pkg.updatedAt),
    __v: observed(pkg.__v),
    lastCheckpointStatus: observed(pkg.lastCheckpointStatus),
    lastCheckpointAt: observed(pkg.lastCheckpointAt),
    'dependencyLock.snapshotId': observed(pkg.dependencyLock?.snapshotId),
    'dependencyLock.snapshotHash': observed(pkg.dependencyLock?.snapshotHash),
  }
  const expressions = []
  for (const [path, value] of [
    ['runtimeVerdict', pkg.runtimeVerdict],
    ['lastCheckpointResult', pkg.lastCheckpointResult],
  ]) {
    if (value === undefined || value === null) filter[path] = observed(value)
    else expressions.push(literalEquality(path, value))
  }
  // Subdocument equality queries are cast through schema defaults by Mongoose.
  // Literal first is intentional: field-first $eq also triggers schema casting.
  if (expressions.length === 1) filter.$expr = expressions[0]
  if (expressions.length > 1) filter.$expr = { $and: expressions }
  return filter
}

const certificationInputError = (reason) => Object.assign(
  new Error(`Release binding input rejected: ${reason}`),
  { code: 'RUNTIME_RELEASE_CERTIFICATION_INPUT_INVALID', reason },
)
const snapshotPayload = (snapshot = {}) => {
  const { snapshotId: _snapshotId, snapshotHash: _snapshotHash, ...payload } = snapshot
  return payload
}
const canonicalSnapshotPayload = (snapshot) => JSON.parse(JSON.stringify(snapshotPayload(snapshot)))
const validInstant = (value) => Number.isFinite(new Date(value).getTime())
const sameInstant = (left, right) => validInstant(left) && validInstant(right)
  && new Date(left).getTime() === new Date(right).getTime()
const referenceIdentity = (reference = {}) => [
  reference.collectionKey,
  reference.id,
  reference.key,
  reference.componentVersion,
  reference.status,
  reference.versionStatus,
]
const validateReferenceMembership = (references) => {
  if (!Array.isArray(references) || references.length === 0) return false
  const identities = references.map((reference) => `${reference?.collectionKey || ''}:${reference?.id || ''}`)
  return identities.every((identity) => !identity.endsWith(':'))
    && new Set(identities).size === identities.length
    && references.every((reference) => referenceIdentity(reference).every((value) => value !== undefined && value !== null && value !== ''))
}
const snapshotHeaderValid = (snapshot, frameworkPackage) => snapshot
  && typeof snapshot === 'object'
  && typeof snapshot.snapshotId === 'string' && snapshot.snapshotId.trim()
  && /^[a-f0-9]{64}$/.test(snapshot.snapshotHash || '')
  && snapshot.packageKey === frameworkPackage.packageKey
  && snapshot.packageVersion === frameworkPackage.version
  && ['PASS', 'PASS_WITH_WARNINGS'].includes(snapshot.status)
  && validInstant(snapshot.resolvedAt)
  && validateReferenceMembership(snapshot.references)
const completeSnapshotValid = (snapshot, frameworkPackage) => snapshotHeaderValid(snapshot, frameworkPackage)
  && snapshot.uiContractSnapshot && typeof snapshot.uiContractSnapshot === 'object'
  && generateChecksum(canonicalSnapshotPayload(snapshot)) === snapshot.snapshotHash
const recognizedLegacySnapshot = (snapshot, frameworkPackage) => snapshotHeaderValid(snapshot, frameworkPackage)
  && snapshot.uiContractSnapshot === undefined
const referencesEquivalent = (canonical, candidate) => canonical.references.length === candidate.references.length
  && canonical.references.every((reference, index) => isDeepStrictEqual(
    referenceIdentity(reference), referenceIdentity(candidate.references[index]),
  ))
const dependencyLockObservation = (snapshot = {}) => ({
  snapshotId: snapshot.snapshotId,
  snapshotHash: snapshot.snapshotHash,
  resolvedAt: validInstant(snapshot.resolvedAt) ? new Date(snapshot.resolvedAt).toISOString() : null,
})

export const resolveRuntimeCertificationDependencySnapshot = ({
  frameworkPackage,
  auditCertificationDependencySnapshot,
} = {}) => {
  const canonical = frameworkPackage?.dependencyLock
  if (completeSnapshotValid(canonical, frameworkPackage)) {
    return { snapshot: canonical, source: 'CANONICAL_DEPENDENCY_LOCK' }
  }
  if (!recognizedLegacySnapshot(canonical, frameworkPackage)) {
    throw certificationInputError('SNAPSHOT_INVALID')
  }

  const fromAudit = auditCertificationDependencySnapshot !== undefined
  const candidate = fromAudit
    ? auditCertificationDependencySnapshot
    : frameworkPackage?.lastCheckpointResult?.dependencyLockPreview
  if (!completeSnapshotValid(candidate, frameworkPackage)
    || !referencesEquivalent(canonical, candidate)) {
    throw certificationInputError('LEGACY_SNAPSHOT_RECOVERY_INVALID')
  }

  if (!fromAudit) {
    const checkpoint = frameworkPackage?.lastCheckpointResult
    if (frameworkPackage?.lastCheckpointStatus !== 'PASS' || checkpoint?.status !== 'PASS'
      || !sameInstant(checkpoint?.timestamp, frameworkPackage?.lastCheckpointAt)
      || !validInstant(candidate.resolvedAt)
      || new Date(candidate.resolvedAt).getTime() > new Date(checkpoint.timestamp).getTime()
      || !validInstant(canonical.resolvedAt)
      || new Date(candidate.resolvedAt).getTime() <= new Date(canonical.resolvedAt).getTime()) {
      throw certificationInputError('LEGACY_SNAPSHOT_RECOVERY_STALE')
    }
  }
  return {
    snapshot: candidate,
    source: fromAudit ? 'AUDIT_CERTIFICATION_SNAPSHOT' : 'RETAINED_CHECKPOINT_SNAPSHOT',
  }
}

// Read-only capture of the exact lock membership, within the caller's snapshot.
export const captureRuntimeReleaseCertification = async ({
  frameworkPackage,
  session,
  auditCertificationDependencySnapshot,
}) => {
  assertRuntimeCertificationTransaction(session)
  const selected = resolveRuntimeCertificationDependencySnapshot({
    frameworkPackage,
    auditCertificationDependencySnapshot,
  })
  const effectiveFrameworkPackage = {
    ...frameworkPackage,
    dependencyLock: selected.snapshot,
  }
  const dependencies = Object.fromEntries(Object.keys(models).map((key) => [key, []]))
  for (const reference of effectiveFrameworkPackage.dependencyLock.references) {
    const Model = Object.hasOwn(models, reference.collectionKey) && models[reference.collectionKey]
    if (!Model) throw new Error('Certification dependency type is invalid.')
    dependencies[reference.collectionKey].push(await Model.findOne({ stableId: reference.id }).session(session).lean())
  }
  return {
    frameworkPackage: effectiveFrameworkPackage,
    dependencies,
    certificationDependencySnapshot: selected.snapshot,
    certificationDependencySnapshotSource: selected.source,
    certificationDependencyLockObservation: dependencyLockObservation(frameworkPackage.dependencyLock),
  }
}

const certificationError = (reason) => Object.assign(new Error('Runtime release certification is not valid.'), {
  code: 'RUNTIME_RELEASE_CERTIFICATION_INVALID', status: 409, details: { reason }, reason,
})

export const verifyRuntimeReleaseCertification = async ({ frameworkPackage, session, activation } = {}) => {
  assertRuntimeCertificationTransaction(session)
  const pkg = frameworkPackage
  const verdict = pkg?.runtimeVerdict
  const eligible = (value) => value?.result === 'ALLOW' && ['PASS', 'WARN'].includes(value.status)
    && ['STRICT', 'WARN_ONLY'].includes(value.mode) && value.dependencyLockState === 'LOCKED'
  if (!eligible(verdict) || verdict.auditPersisted !== true
    || !['PASS', 'PASS_WITH_WARNINGS'].includes(pkg?.dependencyLock?.status)) {
    throw certificationError('RUNTIME_RELEASE_CERTIFICATION_NOT_ELIGIBLE')
  }
  if (!mongoose.isValidObjectId(verdict.auditId) || verdict.auditId !== verdict.validationId) {
    throw certificationError('RUNTIME_RELEASE_CERTIFICATION_AUDIT_ID_MISMATCH')
  }
  const audit = await RuntimeValidationAudit.findById(verdict.auditId).session(session).lean()
  if (!audit || String(audit._id) !== verdict.auditId || !eligible(audit)
    || audit.isPackageLevelValidation !== true || audit.packageResolved !== true
    || ![String(pkg._id), pkg.packageKey].includes(audit.packageId)
    || audit.frameworkKey !== pkg.frameworkKey || audit.mode !== verdict.mode || audit.status !== verdict.status
    || !audit.createdAt || !verdict.lastValidatedAt
    || new Date(audit.createdAt).getTime() !== new Date(verdict.lastValidatedAt).getTime()
    || !isDeepStrictEqual(audit.certificationBinding, verdict.certificationBinding)
    || !audit.certificationDependencySnapshot || !isDeepStrictEqual(
      audit.certificationDependencyLockObservation,
      dependencyLockObservation(pkg.dependencyLock),
    )) {
    throw certificationError('RUNTIME_RELEASE_CERTIFICATION_AUDIT_MISMATCH')
  }
  if (completeSnapshotValid(pkg.dependencyLock, pkg)
    && (!completeSnapshotValid(audit.certificationDependencySnapshot, pkg)
      || audit.certificationDependencySnapshot.snapshotId !== pkg.dependencyLock.snapshotId
      || audit.certificationDependencySnapshot.snapshotHash !== pkg.dependencyLock.snapshotHash)) {
    throw certificationError('RUNTIME_RELEASE_CERTIFICATION_AUDIT_MISMATCH')
  }
  let binding
  try {
    const certificationInput = await captureRuntimeReleaseCertification({
      frameworkPackage: pkg,
      session,
      auditCertificationDependencySnapshot: audit.certificationDependencySnapshot,
    })
    binding = buildRuntimeReleaseCertificationBinding({
      frameworkPackage: certificationInput.frameworkPackage,
      dependencies: certificationInput.dependencies,
    })
  } catch (err) {
    if (err.code === 'RUNTIME_RELEASE_CERTIFICATION_INPUT_INVALID') {
      const invalid = certificationError('RUNTIME_RELEASE_CERTIFICATION_INPUT_INVALID')
      invalid.details.inputReason = err.reason
      throw invalid
    }
    throw err
  }
  if (!isDeepStrictEqual(binding, verdict.certificationBinding)) {
    throw certificationError('RUNTIME_RELEASE_CERTIFICATION_BINDING_MISMATCH')
  }
  if (activation && (String(activation.packageId) !== String(pkg._id)
    || activation.packageKey !== pkg.packageKey || activation.frameworkKey !== pkg.frameworkKey
    || activation.frameworkVersion !== pkg.version || activation.runtimeVerdictId !== verdict.auditId
    || activation.runtimeVerdictResult !== 'ALLOW'
    || activation.dependencySnapshotId !== pkg.dependencyLock.snapshotId
    || activation.dependencySnapshotHash !== pkg.dependencyLock.snapshotHash
    || !isDeepStrictEqual(activation.certificationBinding, binding))) {
    throw certificationError('RUNTIME_RELEASE_CERTIFICATION_ACTIVATION_MISMATCH')
  }
  return binding
}
