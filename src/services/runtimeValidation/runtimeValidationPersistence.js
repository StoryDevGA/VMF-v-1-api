import RuntimeValidationAudit from '../../models/RuntimeValidationAudit.js'
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

export const persistRuntimeValidationAudit = async (validationResult) => {
  const firstIssueCode = validationResult.issues?.[0]?.code || validationResult.validationCode
  const severity = getHighestRuntimeValidationSeverity(validationResult.issues)

  return RuntimeValidationAudit.create({
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
}
