import FrameworkRegistry from '../models/FrameworkRegistry.js'

export const normalizeFrameworkKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()

export const normalizeFrameworkKeyList = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => normalizeFrameworkKey(value))
    .filter(Boolean)

  return [...new Set(normalized)]
}

export const buildUnknownFrameworkKeyMessage = (missingKeys = []) => {
  if (!Array.isArray(missingKeys) || missingKeys.length === 0) {
    return 'Unknown framework key.'
  }

  if (missingKeys.length === 1) {
    return `Unknown framework key "${missingKeys[0]}".`
  }

  return `Unknown framework keys: ${missingKeys.join(', ')}.`
}

export const buildInactiveFrameworkKeyMessage = (inactiveKeys = []) => {
  if (!Array.isArray(inactiveKeys) || inactiveKeys.length === 0) {
    return 'Inactive framework key.'
  }

  if (inactiveKeys.length === 1) {
    return `Inactive framework key "${inactiveKeys[0]}".`
  }

  return `Inactive framework keys: ${inactiveKeys.join(', ')}.`
}

export const resolveKnownFrameworkKeys = async (
  frameworkKeys = [],
  projection = 'frameworkKey name supportedWorkflowKeys status',
  options = {},
) => {
  const normalizedKeys = normalizeFrameworkKeyList(frameworkKeys)
  const requireActive = options?.requireActive === true

  if (normalizedKeys.length === 0) {
    return {
      normalizedKeys,
      registryEntries: [],
      registryByKey: new Map(),
      missingKeys: [],
      inactiveKeys: [],
    }
  }

  const registryEntries = await FrameworkRegistry.find({
    frameworkKey: { $in: normalizedKeys },
  })
    .select(projection)
    .lean()

  const registryByKey = new Map(
    registryEntries.map((entry) => [normalizeFrameworkKey(entry.frameworkKey), entry]),
  )

  const missingKeys = normalizedKeys.filter((frameworkKey) => !registryByKey.has(frameworkKey))
  const inactiveKeys = requireActive
    ? normalizedKeys.filter((frameworkKey) => {
        const entry = registryByKey.get(frameworkKey)
        return entry && normalizeFrameworkKey(entry.status) !== 'ACTIVE'
      })
    : []

  return {
    normalizedKeys,
    registryEntries,
    registryByKey,
    missingKeys,
    inactiveKeys,
  }
}

export const buildFrameworkReferenceValidationDetails = (field, frameworkKeys = []) => {
  const normalizedField = String(field || '').trim() || 'frameworkKey'
  const uniqueKeys = normalizeFrameworkKeyList(frameworkKeys)

  if (uniqueKeys.length === 0) {
    return {}
  }

  return resolveKnownFrameworkKeys(uniqueKeys).then(({ missingKeys }) =>
    missingKeys.length > 0
      ? { [normalizedField]: buildUnknownFrameworkKeyMessage(missingKeys) }
      : {},
  )
}
