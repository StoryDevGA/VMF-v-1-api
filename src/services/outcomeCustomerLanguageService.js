export const OUTCOME_CUSTOMER_LANGUAGE_CONTRACT_VERSION = 'outcome-customer-language.v1'

export const OUTCOME_CUSTOMER_LANGUAGE_LIMITS = Object.freeze({
  maxDepth: 12,
  maxEntries: 5000,
  maxStringLength: 64000,
  maxTotalCharacters: 384000,
})

const PROHIBITED_PATTERNS = Object.freeze([
  ['CERTIFIED_TRUTH', /\bcertified\s+truth\b/],
  ['TRUTH_SIGNATURE', /\btruth\s+signature\b/],
  ['KNOWLEDGE_PACK', /\bknowledge\s+packs?\b/],
  ['PACK_GOVERNANCE', /\bpacks?\s+(?:activation|binding|identity|manifest|metadata|required|resolved|selected|version)\b/],
  ['PROVIDER_CONTEXT', /\bprovider\s+context\b/],
  ['PROVIDER_IMPLEMENTATION', /\b(?:deterministic\s+provider|provider\s+adapter|non\s+production\s+scaffolding)\b/],
  ['RESOLVED_KNOWLEDGE_CONTEXT', /\bresolved\s+knowledge\s+context\b/],
  ['RUNTIME', /\bruntime\b/],
  ['GRR', /\bgrr\b/],
  ['RESOLVER', /\bresolver\b/],
  ['RESOLUTION_POLICY', /\bresolution\s+policy\b/],
  ['SELECTED_BY_LAYER', /\bselected\s+by\s+layer\b/],
  ['ACTIVATION_METADATA', /\bactivation\s+metadata\b/],
  ['PACK_IDENTITY', /\bpack\s+identity\b/],
  ['MANIFEST', /\bmanifest(?:\s+(?:id|key|version))?\b/],
  ['SECTION_KEY', /\bsection\s+key\b/],
  ['GRAPH_HASH', /\bgraph\s+hash\b/],
  ['CONTENT_HASH', /\bcontent\s+hash\b/],
  ['DATABASE_ID', /\bdatabase\s+id\b/],
  ['STORAGE_KEY', /\bstorage\s+key\b/],
  ['PROVIDER_TOKEN', /\bprovider\s+tokens?\b/],
  ['MODEL_TOKEN', /\bmodel\s+tokens?\b/],
  ['SYSTEM_MESSAGE', /\bsystem\s+message\b/],
  ['PROMPT', /\bprompts?\b/],
  ['INTERNAL_IDENTIFIER', /\b(?:grr|truth\s+sig|out\s+sess|out\s+msg|outcome\s+asset|outcome\s+draft|runtime)\s+[a-z0-9]+(?:\s+[a-z0-9]+)+\b/],
])

const normalizeText = (value) => String(value ?? '')
  .normalize('NFKC')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .toLowerCase()
  .replace(/[_\-./\\:[\]{}()]+/g, ' ')
  .replace(/[^a-z0-9\s]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const normalizeLimit = (value, fallback) => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

const buildScanLimits = (options = {}) => ({
  maxDepth: normalizeLimit(options.maxDepth, OUTCOME_CUSTOMER_LANGUAGE_LIMITS.maxDepth),
  maxEntries: normalizeLimit(options.maxEntries, OUTCOME_CUSTOMER_LANGUAGE_LIMITS.maxEntries),
  maxStringLength: normalizeLimit(options.maxStringLength, OUTCOME_CUSTOMER_LANGUAGE_LIMITS.maxStringLength),
  maxTotalCharacters: normalizeLimit(
    options.maxTotalCharacters,
    OUTCOME_CUSTOMER_LANGUAGE_LIMITS.maxTotalCharacters,
  ),
})

const buildViolation = ({ code, path = '', termKey = '' }) => ({
  code,
  path,
  termKey,
})

const findStringViolation = (value, path, limits, state) => {
  const text = String(value ?? '')
  if (text.length > limits.maxStringLength) {
    return buildViolation({ code: 'CUSTOMER_LANGUAGE_SCAN_LIMIT_EXCEEDED', path })
  }

  state.totalCharacters += text.length
  if (state.totalCharacters > limits.maxTotalCharacters) {
    return buildViolation({ code: 'CUSTOMER_LANGUAGE_SCAN_LIMIT_EXCEEDED', path })
  }

  const normalized = normalizeText(text)
  for (const [termKey, pattern] of PROHIBITED_PATTERNS) {
    if (pattern.test(normalized)) {
      return buildViolation({
        code: 'CUSTOMER_LANGUAGE_PROHIBITED_TERM',
        path,
        termKey,
      })
    }
  }
  return null
}

export const findOutcomeCustomerLanguageViolation = (value, options = {}) => {
  const limits = buildScanLimits(options)
  const state = {
    entries: 0,
    totalCharacters: 0,
    visited: new WeakSet(),
  }
  const rootPath = String(options.path || 'customerContent').trim() || 'customerContent'

  const visit = (current, path, depth) => {
    state.entries += 1
    if (state.entries > limits.maxEntries || depth > limits.maxDepth) {
      return buildViolation({ code: 'CUSTOMER_LANGUAGE_SCAN_LIMIT_EXCEEDED', path })
    }

    if (typeof current === 'string') {
      return findStringViolation(current, path, limits, state)
    }
    if (current === null || current === undefined || typeof current !== 'object') return null
    if (state.visited.has(current)) return null
    state.visited.add(current)

    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        const violation = visit(current[index], `${path}[${index}]`, depth + 1)
        if (violation) return violation
      }
      return null
    }

    for (const [key, nestedValue] of Object.entries(current)) {
      const violation = visit(nestedValue, `${path}.${key}`, depth + 1)
      if (violation) return violation
    }
    return null
  }

  return visit(value, rootPath, 0)
}

export const validateOutcomeCustomerLanguage = (value, options = {}) => {
  const violation = findOutcomeCustomerLanguageViolation(value, options)
  return {
    contractVersion: OUTCOME_CUSTOMER_LANGUAGE_CONTRACT_VERSION,
    safe: !violation,
    violation,
  }
}

export const isOutcomeCustomerLanguageSafe = (value, options = {}) =>
  validateOutcomeCustomerLanguage(value, options).safe
