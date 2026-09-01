import { randomUUID } from 'node:crypto'

export const RUNTIME_STATE_VERSION_ERROR_CODES = Object.freeze({
  CANONICAL_REQUIRED: 'RUNTIME_STATE_VERSION_CANONICAL_REQUIRED',
  MIXED: 'RUNTIME_STATE_VERSION_MIXED',
})

const normalizeStateVersion = (value) => String(value ?? '').trim()

export const createRuntimeStateVersion = () => `rsv2:${randomUUID()}`

export const resolveRuntimeStateVersion = ({ stateVersion, runtimeStateVersion } = {}) => {
  const canonicalStateVersion = normalizeStateVersion(stateVersion)
  const compatibilityStateVersion = normalizeStateVersion(runtimeStateVersion)

  if (
    canonicalStateVersion
    && compatibilityStateVersion
    && canonicalStateVersion !== compatibilityStateVersion
  ) {
    return {
      stateVersion: '',
      source: 'mixed',
      canonicalStateVersion,
      compatibilityStateVersion,
      errorCode: RUNTIME_STATE_VERSION_ERROR_CODES.MIXED,
    }
  }

  if (canonicalStateVersion) {
    return {
      stateVersion: canonicalStateVersion,
      source: 'canonical',
      canonicalStateVersion,
      compatibilityStateVersion,
    }
  }

  if (compatibilityStateVersion) {
    return {
      stateVersion: compatibilityStateVersion,
      source: 'compatibility_alias',
      canonicalStateVersion,
      compatibilityStateVersion,
    }
  }

  return {
    stateVersion: '',
    source: 'missing',
    canonicalStateVersion,
    compatibilityStateVersion,
  }
}

export const requireCanonicalRuntimeStateVersion = (runtime = {}) => {
  const resolved = resolveRuntimeStateVersion(runtime)
  if (resolved.errorCode === RUNTIME_STATE_VERSION_ERROR_CODES.MIXED) {
    const error = new Error('Runtime state-version receipts disagree.')
    error.code = RUNTIME_STATE_VERSION_ERROR_CODES.MIXED
    error.status = 409
    error.details = {
      stateVersion: resolved.canonicalStateVersion,
      runtimeStateVersion: resolved.compatibilityStateVersion,
    }
    throw error
  }

  if (!resolved.canonicalStateVersion) {
    const error = new Error('A canonical RuntimeInstance stateVersion is required for governed writes.')
    error.code = RUNTIME_STATE_VERSION_ERROR_CODES.CANONICAL_REQUIRED
    error.status = 409
    error.details = {
      stateVersion: resolved.canonicalStateVersion || null,
      runtimeStateVersion: resolved.compatibilityStateVersion || null,
    }
    throw error
  }

  return resolved.canonicalStateVersion
}

export const createNextRuntimeStateVersion = (currentStateVersion) => {
  requireCanonicalRuntimeStateVersion({ stateVersion: currentStateVersion })
  return createRuntimeStateVersion()
}

export const __testables = Object.freeze({ normalizeStateVersion })
