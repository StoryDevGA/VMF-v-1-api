const FORBIDDEN_PROVIDER_CONTEXT_KEYS = new Set([
  'acceptedtruth',
  'certifiedtruth',
  'evidenceobjects',
  'projectsourceextracts',
  'rawevidence',
  'runtimetruth',
  'sourceextracts',
])

const normalizeKey = (value) =>
  String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()

export const containsForbiddenProviderContextKey = (value) => {
  if (!value || typeof value !== 'object') return false

  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenProviderContextKey(item))
  }

  return Object.entries(value).some(([key, nestedValue]) => (
    FORBIDDEN_PROVIDER_CONTEXT_KEYS.has(normalizeKey(key))
    || containsForbiddenProviderContextKey(nestedValue)
  ))
}

