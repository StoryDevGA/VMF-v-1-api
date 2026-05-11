import { RUNTIME_VALIDATION_CODES, buildRuntimeValidationIssue } from './runtimeValidationCodes.js'

const normalizeList = (values) => {
  if (!Array.isArray(values)) return []
  return [
    ...new Set(values
      .map((value) => String(value || '').trim())
      .filter(Boolean)),
  ]
}

const scopeSegmentMatches = (patternSegment, pathSegment) => (
  patternSegment === '*' || patternSegment === pathSegment
)

export const scopeMatchesRuntimePath = (scopePattern, runtimePath) => {
  const pattern = String(scopePattern || '').trim()
  const path = String(runtimePath || '').trim()
  if (!pattern || !path) return false
  if (pattern === path) return true

  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return path === prefix || path.startsWith(`${prefix}.`)
  }

  const patternSegments = pattern.split('.')
  const pathSegments = path.split('.')
  if (patternSegments.length !== pathSegments.length) return false

  return patternSegments.every((segment, index) => scopeSegmentMatches(segment, pathSegments[index]))
}

const findMatchingScope = (scopePatterns, runtimePath) => (
  normalizeList(scopePatterns).find((scopePattern) => scopeMatchesRuntimePath(scopePattern, runtimePath))
)

export const validateRuntimePathScopes = ({
  runtimePath,
  operation,
  allowedReadScopes = [],
  allowedWriteScopes = [],
  forbiddenReadScopes = [],
  forbiddenWriteScopes = [],
}) => {
  const normalizedOperation = String(operation || '').trim().toUpperCase()
  const allowedScopes = normalizedOperation === 'WRITE'
    ? normalizeList(allowedWriteScopes)
    : normalizeList(allowedReadScopes)
  const forbiddenScopes = normalizedOperation === 'WRITE'
    ? normalizeList(forbiddenWriteScopes)
    : normalizeList(forbiddenReadScopes)

  const issues = []
  const forbiddenScope = findMatchingScope(forbiddenScopes, runtimePath)
  if (forbiddenScope) {
    issues.push(buildRuntimeValidationIssue({
      code: RUNTIME_VALIDATION_CODES.SCOPE_OUTSIDE_ALLOWED,
      severity: 'BLOCKING',
      message: `Runtime path "${runtimePath}" is explicitly forbidden by scope "${forbiddenScope}".`,
      path: 'runtimePath',
      source: 'runtime-scope-validator',
    }))
    return issues
  }

  if (allowedScopes.length === 0) return issues

  const allowedScope = findMatchingScope(allowedScopes, runtimePath)
  if (!allowedScope) {
    issues.push(buildRuntimeValidationIssue({
      code: RUNTIME_VALIDATION_CODES.SCOPE_OUTSIDE_ALLOWED,
      severity: 'BLOCKING',
      message: `Runtime path "${runtimePath}" is not covered by the configured ${normalizedOperation || 'runtime'} scopes.`,
      path: 'runtimePath',
      source: 'runtime-scope-validator',
    }))
  }

  return issues
}

export const mergeRuntimeScopeLists = (...scopeLists) => (
  normalizeList(scopeLists.flatMap((scopeList) => normalizeList(scopeList)))
)
