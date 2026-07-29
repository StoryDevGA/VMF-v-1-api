const normalizeRuntimePathCommaList = (value) =>
  [...new Set(
    String(value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )]

const normalizeRuntimePathConditionOperator = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')

const isNumericString = (value) => /^-?\d+(\.\d+)?$/.test(String(value ?? '').trim())

const RUNTIME_PATH_REGEX_CACHE_MAX = 100
const runtimePathRegexCache = new Map()
const RUNTIME_PATH_LITERAL_VALIDATION_MODES = Object.freeze({
  FULL: 'FULL',
  TYPE_AND_NULLABILITY: 'TYPE_AND_NULLABILITY',
})

const isWorkflowPolicyValueMissing = (value) => {
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'boolean' || typeof value === 'number') return false
  return String(value ?? '').trim() === ''
}

const getCachedRuntimePathRegex = (pattern) => {
  const normalizedPattern = String(pattern ?? '').trim()
  if (!normalizedPattern) return null

  if (runtimePathRegexCache.has(normalizedPattern)) {
    return runtimePathRegexCache.get(normalizedPattern)
  }

  try {
    // Cached regex instances are reused across requests, so keep them flagless and stateless.
    const regex = new RegExp(normalizedPattern)
    runtimePathRegexCache.set(normalizedPattern, regex)
    if (runtimePathRegexCache.size > RUNTIME_PATH_REGEX_CACHE_MAX) {
      const oldestKey = runtimePathRegexCache.keys().next().value
      runtimePathRegexCache.delete(oldestKey)
    }
    return regex
  } catch {
    return null
  }
}

const parseJsonLikeRuntimePathValue = (rawValue) => {
  if (rawValue === null || rawValue === undefined) {
    return { ok: true, value: rawValue }
  }

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim()
    if (!trimmed) {
      return { ok: false, message: 'Expected valid JSON.' }
    }

    try {
      return { ok: true, value: JSON.parse(trimmed) }
    } catch {
      return { ok: false, message: 'Expected valid JSON.' }
    }
  }

  if (typeof rawValue === 'object') {
    return { ok: true, value: rawValue }
  }

  return { ok: false, message: 'Expected valid JSON.' }
}

const validateRuntimePathLiteralValue = ({
  runtimePath,
  operator,
  value,
  validationMode = RUNTIME_PATH_LITERAL_VALIDATION_MODES.FULL,
  allowListValues = true,
} = {}) => {
  if (!runtimePath) return null

  const validateConstraints =
    validationMode !== RUNTIME_PATH_LITERAL_VALIDATION_MODES.TYPE_AND_NULLABILITY
  const dataType = String(runtimePath?.dataType ?? '').trim().toUpperCase()
  const allowedValues = Array.isArray(runtimePath?.allowedValues)
    ? runtimePath.allowedValues.map((item) => String(item ?? '').trim()).filter(Boolean)
    : []
  const hasAllowedValues = allowedValues.length > 0
  const allowedSet = hasAllowedValues ? new Set(allowedValues) : null
  const regexPattern = String(runtimePath?.regexPattern ?? '').trim()
  const minLength = Number.isFinite(runtimePath?.minLength) ? runtimePath.minLength : null
  const maxLength = Number.isFinite(runtimePath?.maxLength) ? runtimePath.maxLength : null
  const minValue = Number.isFinite(runtimePath?.minValue) ? runtimePath.minValue : null
  const maxValue = Number.isFinite(runtimePath?.maxValue) ? runtimePath.maxValue : null
  const isNullable = runtimePath?.isNullable
  const uiControl = String(runtimePath?.uiControl ?? '').trim().toUpperCase()
  const cachedRegex = validateConstraints && regexPattern ? getCachedRuntimePathRegex(regexPattern) : null
  const expectsWholeJsonLiteral =
    dataType === 'OBJECT'
    || dataType === 'ARRAY'
    || (dataType === 'MIXED' && uiControl === 'JSON')

  if (!allowListValues && !expectsWholeJsonLiteral && Array.isArray(value)) {
    if (dataType === 'BOOLEAN') return 'Expected a boolean value.'
    if (dataType === 'NUMBER') return 'Expected a numeric value.'
    return 'Expected a string value.'
  }

  const normalizedOperator = normalizeRuntimePathConditionOperator(operator)
  const valuesToValidate = expectsWholeJsonLiteral
    ? [value]
    : allowListValues && Array.isArray(value)
      ? value
      : normalizedOperator === 'in' || normalizedOperator === 'not in'
        ? normalizeRuntimePathCommaList(value)
        : [value]

  for (const raw of valuesToValidate) {
    if (raw === null) {
      if (isNullable === false) return 'Null is not allowed for this runtime path.'
      continue
    }

    if (raw === undefined) continue

    if (dataType === 'BOOLEAN') {
      if (typeof raw === 'boolean') continue
      const normalized = String(raw ?? '').trim().toLowerCase()
      if (normalized === 'true' || normalized === 'false') continue
      return 'Expected a boolean value.'
    }

    if (dataType === 'NUMBER') {
      const numeric = typeof raw === 'number' ? raw : (isNumericString(raw) ? Number(String(raw).trim()) : NaN)
      if (Number.isNaN(numeric)) return 'Expected a numeric value.'
      if (validateConstraints && minValue !== null && numeric < minValue) return `Value must be >= ${minValue}.`
      if (validateConstraints && maxValue !== null && numeric > maxValue) return `Value must be <= ${maxValue}.`
      continue
    }

    if (
      dataType === 'OBJECT'
      || dataType === 'ARRAY'
      || (dataType === 'MIXED' && uiControl === 'JSON')
    ) {
      const parsed = parseJsonLikeRuntimePathValue(raw)
      if (!parsed.ok) return parsed.message

      if (dataType === 'OBJECT') {
        if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
          return 'Expected a JSON object.'
        }
      }

      if (dataType === 'ARRAY' && !Array.isArray(parsed.value)) {
        return 'Expected a JSON array.'
      }

      continue
    }

    const stringValue = typeof raw === 'string' ? raw : null
    if (stringValue === null) {
      return 'Expected a string value.'
    }

    const normalizedStringValue = stringValue.trim()

    if (validateConstraints && hasAllowedValues && allowedSet && !allowedSet.has(normalizedStringValue)) {
      return 'Value must be one of the allowed values for this runtime path.'
    }

    if (validateConstraints && minLength !== null && normalizedStringValue.length < minLength) {
      return `Value must be at least ${minLength} characters.`
    }

    if (validateConstraints && maxLength !== null && normalizedStringValue.length > maxLength) {
      return `Value must be at most ${maxLength} characters.`
    }

    if (validateConstraints && regexPattern) {
      if (!cachedRegex) {
        return 'Runtime path validation pattern is invalid.'
      }
      if (!cachedRegex.test(normalizedStringValue)) return 'Value does not match the required pattern.'
    }
  }

  return null
}

export {
  RUNTIME_PATH_LITERAL_VALIDATION_MODES,
  isWorkflowPolicyValueMissing,
  normalizeRuntimePathCommaList,
  normalizeRuntimePathConditionOperator,
  validateRuntimePathLiteralValue,
}
