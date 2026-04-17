import RuntimePathRegistry, {
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_STATUSES,
} from '../models/RuntimePathRegistry.js'

const normalizeList = (values) => {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

const hasFrameworkOverlap = (pathFrameworkKeys, selectedFrameworkKeys) => {
  if (!Array.isArray(pathFrameworkKeys) || pathFrameworkKeys.length === 0) return false
  if (!Array.isArray(selectedFrameworkKeys) || selectedFrameworkKeys.length === 0) return false
  const selected = new Set(selectedFrameworkKeys.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))
  return pathFrameworkKeys.some((value) => selected.has(String(value || '').trim().toUpperCase()))
}

/**
 * Resolves a list of runtime path keys against the Runtime Path Registry and returns
 * both the matched rows and categorized validation errors.
 *
 * Validation algorithm:
 * 1) Normalize + dedupe `pathKeys` and `frameworkKeys`
 * 2) Fetch all registry rows for the requested keys in one query
 * 3) Classify each requested key into one or more buckets:
 *    - `missing`: no registry row found for the key
 *    - `inactive`: row exists but status is not ACTIVE (when `requireActive`)
 *    - `invalidOperation`: row exists but does not allow the requested `operation`
 *    - `incompatibleFramework`: row exists but has no overlap with selected frameworks (when provided)
 *    - `protectedWrite`: row is protected and operation is WRITE (when `forbidProtectedWrites`)
 *
 * Return shape is stable and can be used to produce field-level error messages.
 */
export const resolveRuntimePathSelections = async ({
  pathKeys = [],
  frameworkKeys = [],
  operation = null,
  requireActive = true,
  forbidProtectedWrites = true,
  requireProtected = false,
} = {}) => {
  const normalizedPathKeys = normalizeList(pathKeys)
  const normalizedFrameworkKeys = normalizeList(frameworkKeys).map((value) => value.toUpperCase())
  const normalizedOperation = operation ? String(operation).trim().toUpperCase() : null

  if (normalizedPathKeys.length === 0) {
    return {
      pathKeys: normalizedPathKeys,
      rows: [],
      missing: [],
      inactive: [],
      invalidOperation: [],
      incompatibleFramework: [],
      protectedWrite: [],
      unprotected: [],
    }
  }

  const rows = await RuntimePathRegistry.find({
    pathKey: { $in: normalizedPathKeys },
  })
    .select('pathKey status frameworkKeys allowedOperations isProtected')
    .lean()

  const byPathKey = new Map(rows.map((row) => [row.pathKey, row]))
  const missing = normalizedPathKeys.filter((key) => !byPathKey.has(key))

  const inactive = requireActive
    ? normalizedPathKeys.filter((key) => {
        const row = byPathKey.get(key)
        return row && String(row.status || '').toUpperCase() !== RUNTIME_PATH_REGISTRY_STATUSES.ACTIVE
      })
    : []

  const invalidOperation = normalizedOperation
    ? normalizedPathKeys.filter((key) => {
        const row = byPathKey.get(key)
        if (!row) return false
        const ops = Array.isArray(row.allowedOperations)
          ? row.allowedOperations.map((value) => String(value || '').trim().toUpperCase())
          : []
        return !ops.includes(normalizedOperation)
      })
    : []

  const incompatibleFramework =
    normalizedFrameworkKeys.length > 0
      ? normalizedPathKeys.filter((key) => {
          const row = byPathKey.get(key)
          if (!row) return false
          return !hasFrameworkOverlap(row.frameworkKeys, normalizedFrameworkKeys)
        })
      : []

  const protectedWrite =
    forbidProtectedWrites && normalizedOperation === RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE
      ? normalizedPathKeys.filter((key) => {
          const row = byPathKey.get(key)
          return Boolean(row?.isProtected)
        })
      : []

  const unprotected =
    requireProtected
      ? normalizedPathKeys.filter((key) => {
          const row = byPathKey.get(key)
          if (!row) return false
          return !row.isProtected
        })
      : []

  return {
    pathKeys: normalizedPathKeys,
    rows,
    missing,
    inactive,
    invalidOperation,
    incompatibleFramework,
    protectedWrite,
    unprotected,
  }
}
