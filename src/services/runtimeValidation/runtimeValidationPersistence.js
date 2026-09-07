import mongoose from 'mongoose'
import { isDeepStrictEqual } from 'node:util'
import RuntimeValidationAudit from '../../models/RuntimeValidationAudit.js'
import FrameworkPackage from '../../models/FrameworkPackage.js'
import logger from '../../config/logger.js'
import auditService from '../auditService.js'
import governanceAuditService from '../governanceAudit/governanceAuditService.js'
import { getHighestRuntimeValidationSeverity } from './runtimeValidationSeverity.js'
import { buildRuntimeCertificationPackageCas, assertRuntimeCertificationTransaction,
  resolveRuntimeCertificationDependencySnapshot } from '../runtimeReleaseCertificationCaptureService.js'

const MAX_STATE_BYTES = 8192

const truncateStateForAudit = (value) => {
  if (value === undefined) return null
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length <= MAX_STATE_BYTES) return value
    return {
      truncated: true,
      byteLength: serialized.length,
      preview: serialized.slice(0, MAX_STATE_BYTES),
    }
  } catch {
    return null
  }
}

const buildPackageLookup = (packageId) => {
  const identifier = String(packageId || '').trim()
  if (!identifier) return null
  return mongoose.isValidObjectId(identifier)
    ? { _id: identifier }
    : { packageKey: identifier }
}

const buildRuntimeVerdictPersistenceError = (message, cause) => {
  const err = new Error(message)
  err.code = 'RUNTIME_VALIDATION_EVIDENCE_PERSISTENCE_FAILED'
  err.status = 500
  err.cause = cause
  return err
}

const buildRuntimeVerdict = ({ validationResult, audit, certificationBinding }) => ({
  validationId: String(audit?._id || audit?.id || ''),
  auditId: String(audit?._id || audit?.id || ''),
  status: validationResult.status,
  result: validationResult.result,
  mode: validationResult.mode,
  lastValidatedAt: audit?.createdAt || new Date(),
  auditPersisted: true,
  dependencyLockState: validationResult.dependencyLockState || 'NOT_LOCKED',
  blockingIssues: Number(validationResult.summary?.failed) || 0,
  warnings: Number(validationResult.summary?.warnings) || 0,
  ...(validationResult.isPackageLevelValidation ? { certificationBinding: certificationBinding || null } : {}),
})

const buildFrameworkPackageLabel = (frameworkPackage = {}) => {
  const frameworkKey = String(frameworkPackage.frameworkKey || '').trim()
  const version = String(frameworkPackage.version || '').trim()
  if (frameworkKey && version) return `${frameworkKey} ${version}`
  return frameworkPackage.packageKey || 'Framework Package'
}

const buildRuntimeValidationSnapshot = ({
  validationResult,
  audit,
  frameworkPackage,
  runtimeVerdict,
  certificationDependencySnapshot,
  certificationDependencyLockObservation,
}) => ({
  package: {
    id: String(frameworkPackage?._id || frameworkPackage?.id || ''),
    frameworkKey: frameworkPackage?.frameworkKey || validationResult.frameworkKey || '',
    frameworkVersion: frameworkPackage?.version || '',
    packageKey: frameworkPackage?.packageKey || validationResult.packageId || '',
    status: frameworkPackage?.status || '',
  },
  runtimeValidation: {
    validationId: validationResult.validationId || '',
    auditId: String(audit?._id || audit?.id || ''),
    status: validationResult.status,
    result: validationResult.result,
    mode: validationResult.mode,
    operationType: validationResult.operationType,
    runtimePath: validationResult.runtimePath || '',
    validationCode: validationResult.validationCode || '',
    dependencyLockState: validationResult.dependencyLockState || 'NOT_LOCKED',
    packageResolved: validationResult.packageResolved !== false,
    summary: validationResult.summary || {},
    ...(certificationDependencySnapshot ? {
      certificationDependencySnapshot: {
        snapshotId: certificationDependencySnapshot.snapshotId,
        snapshotHash: certificationDependencySnapshot.snapshotHash,
      },
      certificationDependencyLockObservation,
    } : {}),
  },
  runtimeVerdict,
})

const logPackageLevelRuntimeValidationGovernanceEvent = async ({
  validationResult,
  audit,
  frameworkPackage,
  runtimeVerdict,
  certificationDependencySnapshot,
  certificationDependencyLockObservation,
  session,
}) => {
  const eventKey = validationResult.result === 'ALLOW'
    ? 'RUNTIME_VALIDATION_ALLOWED'
    : 'RUNTIME_VALIDATION_BLOCKED'

  // Persistence runs below the HTTP layer, so req.ip/userAgent are not
  // available here. requestId and actorUserId are carried through the validation
  // result to preserve the governance correlation without coupling this service
  // back to Express.
  await governanceAuditService.logSystemEvent(eventKey, {
    actorUserId: validationResult.actorId,
    resourceType: auditService.RESOURCE_TYPES.FrameworkPackage,
    resourceId: frameworkPackage._id,
    scope: {
      frameworkKey: frameworkPackage.frameworkKey || validationResult.frameworkKey || '',
    },
    frameworkKey: frameworkPackage.frameworkKey || validationResult.frameworkKey || '',
    frameworkVersion: frameworkPackage.version || '',
    packageKey: frameworkPackage.packageKey || validationResult.packageId || '',
    requestId: validationResult.requestId || validationResult.validationId,
    display: { resourceLabel: buildFrameworkPackageLabel(frameworkPackage) },
    snapshot: buildRuntimeValidationSnapshot({
      validationResult,
      audit,
      frameworkPackage,
      runtimeVerdict,
      certificationDependencySnapshot,
      certificationDependencyLockObservation,
    }),
    diff: {
      runtimeVerdict: {
        to: runtimeVerdict,
      },
    },
  }, { throwOnError: true, ...(session ? { session } : {}) })
}

export const persistRuntimeValidationAudit = async (validationResult, {
  session,
  capturedPackage,
  certificationBinding,
  certificationDependencySnapshot,
  certificationDependencyLockObservation,
} = {}) => {
  if (validationResult.isPackageLevelValidation) assertRuntimeCertificationTransaction(session)
  if (validationResult.isPackageLevelValidation && (!session || capturedPackage === undefined)) {
    throw buildRuntimeVerdictPersistenceError('Package certification requires captured transaction inputs.')
  }
  const certificationEligible = validationResult.isPackageLevelValidation && validationResult.result === 'ALLOW'
    && ['STRICT', 'WARN_ONLY'].includes(validationResult.mode)
    && validationResult.packageResolved === true && validationResult.dependencyLockState === 'LOCKED'
  const bound = certificationEligible ? certificationBinding : null
  if (certificationEligible) {
    try {
      const expectedSnapshot = resolveRuntimeCertificationDependencySnapshot({
        frameworkPackage: capturedPackage,
      }).snapshot
      const expectedObservation = {
        snapshotId: capturedPackage?.dependencyLock?.snapshotId,
        snapshotHash: capturedPackage?.dependencyLock?.snapshotHash,
        resolvedAt: new Date(capturedPackage?.dependencyLock?.resolvedAt).toISOString(),
      }
      if (certificationBinding?.version !== 'runtime-release-certification.v1'
        || !/^[a-f0-9]{64}$/.test(certificationBinding?.digest || '')
        || !isDeepStrictEqual(certificationDependencySnapshot, expectedSnapshot)
        || !isDeepStrictEqual(certificationDependencyLockObservation, expectedObservation)) {
        throw new Error('Certification persistence inputs do not match the captured package.')
      }
    } catch (err) {
      throw buildRuntimeVerdictPersistenceError('Package certification inputs are invalid.', err)
    }
  }
  const firstIssueCode = validationResult.issues?.[0]?.code || validationResult.validationCode
  const severity = getHighestRuntimeValidationSeverity(validationResult.issues)

  const auditPayload = {
    validationCode: firstIssueCode,
    severity,
    operationType: validationResult.operationType,
    runtimePath: validationResult.runtimePath || '',
    actorId: validationResult.actorId || '',
    actorType: validationResult.actorType || 'USER',
    packageId: validationResult.packageId || '',
    frameworkKey: validationResult.frameworkKey || '',
    workspaceId: validationResult.workspaceId || '',
    status: validationResult.status,
    result: validationResult.result,
    mode: validationResult.mode,
    message: validationResult.message || '',
    issues: validationResult.issues || [],
    summary: validationResult.summary || {},
    beforeState: truncateStateForAudit(validationResult.beforeState),
    afterState: truncateStateForAudit(validationResult.afterState),
    packageResolved: validationResult.packageResolved !== false,
    ...(validationResult.isPackageLevelValidation ? {
      isPackageLevelValidation: true,
      dependencyLockState: validationResult.dependencyLockState,
      certificationBinding: bound || null,
      ...(bound ? { certificationDependencySnapshot, certificationDependencyLockObservation } : {}),
    } : {}),
  }
  const audit = session
    ? (await RuntimeValidationAudit.create([auditPayload], { session }))[0]
    : await RuntimeValidationAudit.create(auditPayload)

  if (validationResult.isPackageLevelValidation && !audit?._id) {
    throw buildRuntimeVerdictPersistenceError('Original validation audit identity is missing.')
  }

  const packageLookup = validationResult.isPackageLevelValidation
    ? buildPackageLookup(validationResult.packageId)
    : null

  if (packageLookup && validationResult.packageResolved !== false) {
    try {
      const frameworkPackage = capturedPackage
      if (!frameworkPackage) {
        const err = buildRuntimeVerdictPersistenceError(
          'Package-level runtime validation evidence could not be attached to a framework package.',
        )
        logger.warn(
          { packageLookup, validationId: validationResult.validationId },
          'runtime validation package verdict lookup matched no framework package',
        )
        throw err
      }

      const runtimeVerdict = buildRuntimeVerdict({ validationResult, audit, certificationBinding: bound })
      await logPackageLevelRuntimeValidationGovernanceEvent({
        validationResult,
        audit,
        frameworkPackage,
        runtimeVerdict,
        certificationDependencySnapshot: bound ? certificationDependencySnapshot : undefined,
        certificationDependencyLockObservation: bound ? certificationDependencyLockObservation : undefined,
        session,
      })

      const packageUpdate = await FrameworkPackage.updateOne(
        buildRuntimeCertificationPackageCas(frameworkPackage),
        {
          $set: {
            runtimeVerdict,
          },
        },
        // The verdict write is evidence for the current authoring state, not an
        // authoring change itself. Bumping updatedAt here makes readiness treat
        // the freshly persisted verdict as stale immediately.
        { session, timestamps: false, runValidators: true },
      )

      if (packageUpdate?.matchedCount !== 1) {
        const err = buildRuntimeVerdictPersistenceError(
          'Package-level runtime validation evidence could not be attached to a framework package.',
        )
        logger.warn(
          { packageLookup, validationId: validationResult.validationId },
          'runtime validation package verdict update matched no framework package',
        )
        throw err
      }
    } catch (err) {
      logger.error(
        { err, packageLookup, validationId: validationResult.validationId },
        'runtime validation package verdict update failed',
      )
      if (err?.code === 'RUNTIME_VALIDATION_EVIDENCE_PERSISTENCE_FAILED') {
        throw err
      }
      throw buildRuntimeVerdictPersistenceError(
        'Package-level runtime validation evidence could not be persisted.',
        err,
      )
    }
  }

  return audit
}
