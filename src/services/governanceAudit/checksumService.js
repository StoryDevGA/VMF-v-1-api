import crypto from 'crypto'

const canonicalize = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (!value || typeof value !== 'object') return value

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      const normalized = canonicalize(value[key])
      if (normalized !== undefined) {
        result[key] = normalized
      }
      return result
    }, {})
}

export const buildCanonicalJson = (value) =>
  JSON.stringify(canonicalize(value ?? null))

export const generateChecksum = (value) =>
  crypto
    .createHash('sha256')
    .update(buildCanonicalJson(value))
    .digest('hex')

export default {
  buildCanonicalJson,
  generateChecksum,
}
