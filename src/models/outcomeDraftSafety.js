const UNSAFE_DRAFT_PAYLOAD_KEYS = new Set([
  'hiddenpromptassembly',
  'hiddenreasoning',
  'packcontent',
  'prompt',
  'promptassembly',
  'providerprompt',
  'rawcontent',
  'rawdata',
  'rawevidence',
  'rawpackcontent',
  'rawprompt',
  'rawproviderprompt',
  'rawsource',
  'rawsourcetext',
  'sourcebundle',
  'sourcetext',
  'textcontent',
])

const normalizeKey = (key) => String(key || '').trim().toLowerCase()

export const findUnsafeOutcomeDraftPayloadKey = (value, options = {}) => {
  const visited = new WeakSet()
  const rootPath = String(options.path || '').trim()

  const scan = (entry, path) => {
    if (!entry || typeof entry !== 'object') return ''

    if (visited.has(entry)) return ''
    visited.add(entry)

    if (Array.isArray(entry)) {
      for (let index = 0; index < entry.length; index += 1) {
        const result = scan(entry[index], `${path}[${index}]`)
        if (result) return result
      }
      return ''
    }

    for (const [key, childValue] of Object.entries(entry)) {
      const keyPath = path ? `${path}.${key}` : key
      if (UNSAFE_DRAFT_PAYLOAD_KEYS.has(normalizeKey(key))) return keyPath

      const result = scan(childValue, keyPath)
      if (result) return result
    }

    return ''
  }

  return scan(value, rootPath)
}

export const assertOutcomeDraftPayloadSafe = (value, { fieldName } = {}) => {
  const unsafeKey = findUnsafeOutcomeDraftPayloadKey(value, { path: fieldName })
  if (!unsafeKey) return

  throw new Error(
    `${fieldName || 'Outcome draft payload'} cannot contain unsafe internal key "${unsafeKey}".`,
  )
}

