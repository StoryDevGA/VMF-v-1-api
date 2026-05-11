import { RUNTIME_VALIDATION_MODES } from './runtimeValidationModes.js'

export const RUNTIME_VALIDATION_SEVERITIES = Object.freeze({
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  BLOCKING: 'BLOCKING',
  CRITICAL: 'CRITICAL',
})

const severityRank = Object.freeze({
  [RUNTIME_VALIDATION_SEVERITIES.INFO]: 0,
  [RUNTIME_VALIDATION_SEVERITIES.WARN]: 1,
  [RUNTIME_VALIDATION_SEVERITIES.ERROR]: 2,
  [RUNTIME_VALIDATION_SEVERITIES.BLOCKING]: 3,
  [RUNTIME_VALIDATION_SEVERITIES.CRITICAL]: 4,
})

export const normalizeRuntimeValidationSeverity = (value) => {
  const normalized = String(value || RUNTIME_VALIDATION_SEVERITIES.INFO).trim().toUpperCase()
  return Object.values(RUNTIME_VALIDATION_SEVERITIES).includes(normalized)
    ? normalized
    : RUNTIME_VALIDATION_SEVERITIES.INFO
}

export const getHighestRuntimeValidationSeverity = (issues = []) => (
  issues.reduce((highest, issue) => {
    const current = normalizeRuntimeValidationSeverity(issue?.severity)
    return severityRank[current] > severityRank[highest] ? current : highest
  }, RUNTIME_VALIDATION_SEVERITIES.INFO)
)

export const isRuntimeValidationIssueBlocking = (issue, mode) => {
  const severity = normalizeRuntimeValidationSeverity(issue?.severity)

  if (mode === RUNTIME_VALIDATION_MODES.DISABLED || mode === RUNTIME_VALIDATION_MODES.AUDIT_ONLY) {
    return false
  }

  if (mode === RUNTIME_VALIDATION_MODES.WARN_ONLY) {
    return severity === RUNTIME_VALIDATION_SEVERITIES.CRITICAL
  }

  return severityRank[severity] >= severityRank[RUNTIME_VALIDATION_SEVERITIES.ERROR]
}

export const summarizeRuntimeValidationIssues = (issues = []) => {
  const totalChecks = issues.length
  const warnings = issues.filter((issue) => normalizeRuntimeValidationSeverity(issue?.severity) === RUNTIME_VALIDATION_SEVERITIES.WARN).length
  const failed = issues.filter((issue) => {
    const severity = normalizeRuntimeValidationSeverity(issue?.severity)
    return severityRank[severity] >= severityRank[RUNTIME_VALIDATION_SEVERITIES.ERROR]
  }).length

  return {
    totalChecks,
    passed: Math.max(totalChecks - warnings - failed, 0),
    warnings,
    failed,
  }
}
