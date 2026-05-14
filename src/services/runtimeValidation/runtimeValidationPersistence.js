import mongoose from 'mongoose'
import RuntimeValidationAudit from '../../models/RuntimeValidationAudit.js'
import FrameworkPackage from '../../models/FrameworkPackage.js'
import logger from '../../config/logger.js'
import { getHighestRuntimeValidationSeverity } from './runtimeValidationSeverity.js'

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

export const persistRuntimeValidationAudit = async (validationResult) => {
  const firstIssueCode = validationResult.issues?.[0]?.code || validationResult.validationCode
  const severity = getHighestRuntimeValidationSeverity(validationResult.issues)

  const audit = await RuntimeValidationAudit.create({
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
  })

  const packageLookup = validationResult.isPackageLevelValidation
    ? buildPackageLookup(validationResult.packageId)
    : null

  if (packageLookup && validationResult.packageResolved !== false) {
    try {
      const packageUpdate = await FrameworkPackage.updateOne(
        packageLookup,
        {
          $set: {
            runtimeVerdict: {
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
            },
          },
        },
        // The verdict write is evidence for the current authoring state, not an
        // authoring change itself. Bumping updatedAt here makes readiness treat
        // the freshly persisted verdict as stale immediately.
        { timestamps: false },
      )

      if (packageUpdate?.matchedCount === 0) {
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
