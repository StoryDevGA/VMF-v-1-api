import { projectOutcomeRequestSelectedPack } from './outcomeAudienceRequestResolutionService.js'

export const OUTCOME_COMPOSITION_REQUEST_VERSION = 'outcome-composition-request.v1'
const fields = Object.freeze({ CHANNEL: 'channelKey', STYLE: 'requestedStyleKey', LANGUAGE: 'languageKey',
  VISUAL_SYSTEM: 'visualSystemKey', INDUSTRY: 'industryKeys' })
// Controlled phrases only. Unknown phrases remain explicit, unresolved requests.
const aliases = Object.freeze({
  CHANNEL: Object.freeze({ 'linkedin': 'linkedin-post-channel', 'linkedin post': 'linkedin-post-channel', 'linkedin channel': 'linkedin-post-channel' }),
  STYLE: Object.freeze({ 'strategic advisory style': 'strategic-advisory-style' }),
  VISUAL_SYSTEM: Object.freeze({ 'visual truth preservation rules': 'visual-truth-preservation-rules' }),
})
const stableKey = /^[a-z0-9](?:[a-z0-9._-]{0,138}[a-z0-9])?$/
const resolveCue = (layer, phrase, source) => {
  const key = phrase.trim().toLowerCase()
  const naturalLinkedIn = layer === 'CHANNEL' && source === 'NATURAL_CONSTRUCTION' && key === 'linkedin'
  const exact = stableKey.test(key) && !naturalLinkedIn
  const alias = Object.hasOwn(aliases[layer] || {}, key) ? aliases[layer][key] : ''
  return { layer, phrase, capabilityKey: exact ? key : alias || key,
    basis: exact ? 'EXACT_CAPABILITY_KEY' : alias ? 'CONTROLLED_ALIAS' : 'UNRESOLVED',
    ...(source === 'NATURAL_CONSTRUCTION' ? { source } : {}) }
}
export const hasOutcomeCompositionRequest = (intent) =>
  intent?.compositionResolution?.contractVersion === OUTCOME_COMPOSITION_REQUEST_VERSION

export const resolveOutcomeCompositionRequest = (cues = []) => {
  const mappings = cues.map(({ layer, phrase, source }) => resolveCue(layer, phrase, source))
  const request = {}
  const blockers = []
  for (const [layer, field] of Object.entries(fields)) {
    const keys = [...new Set(mappings.filter((entry) => entry.layer === layer).map((entry) => entry.capabilityKey))]
    if (!keys.length) continue
    if (layer === 'INDUSTRY') request[field] = keys
    else if (keys.length === 1) request[field] = keys[0]
    else blockers.push({ code: `REQUESTED_${layer}_AMBIGUOUS`, knowledgeLayer: layer,
      capabilityKeys: keys, reason: 'CONFLICTING_REQUEST_CUES' })
  }
  return { contractVersion: OUTCOME_COMPOSITION_REQUEST_VERSION, mappings, request, blockers }
}

// Named clauses provide an exact path for every supported key. Only specific,
// affirmative natural-language constructions infer a layer outside those clauses.
export const inferOutcomeCompositionRequest = (prompt = '') => {
  const cues = []
  const addMatches = (layer, pattern, expand = (phrase) => phrase, source = '') => {
    for (const match of prompt.matchAll(pattern)) {
      const prefix = prompt.slice(0, match.index).split(/;|\.(?=\s|$)/).at(-1)
      if (/\b(?:no|not|never|without|instead of)\b.*$/i.test(prefix)) continue
      const expanded = expand(match[1])
      for (const value of Array.isArray(expanded) ? expanded : [expanded]) {
        const phrase = value.trim()
        if (phrase && !/^(?:none|skip|no|not|without)\b/i.test(phrase)) cues.push({ layer, phrase, ...(source ? { source } : {}) })
      }
    }
  }
  for (const [label, layer] of [['channel', 'CHANNEL'], ['style', 'STYLE'], ['language', 'LANGUAGE'],
    ['visual system', 'VISUAL_SYSTEM'], ['industry', 'INDUSTRY']]) {
    addMatches(layer, new RegExp(`\\b${label}\\s*:\\s*([^;]+?)(?=\\s*(?:,\\s*)?(?:(?:and|or)\\s+)?(?:channel|style|language|visual system|industry)\\s*:|;|\\.(?=\\s|$)|$)`, 'gi'),
      (phrase) => phrase.split(/\s*(?:,|\band\b|\bor\b)\s*/i))
  }
  addMatches('CHANNEL', /\b(?:on|via|through|for delivery on)\s+((?:LinkedIn(?:\s+post)?|email)(?:(?:\s+(?:and|or)\s+|\s*,\s*(?:(?:and|or)\s+)?)(?:LinkedIn(?:\s+post)?|email))*)(?=\s*(?:[.;,!?]|$)|\s+(?:for|using|with|in|to)\b)/gi,
    (phrase) => phrase.split(/\s*(?:,|\band\b|\bor\b)\s*/i), 'NATURAL_CONSTRUCTION')
  addMatches('CHANNEL', /\b(?:create|prepare|write)\s+(?:an?\s+)?(LinkedIn post|email)\b/gi, (phrase) => phrase, 'NATURAL_CONSTRUCTION')
  addMatches('STYLE', /\b(?:in|with|using)\s+(?:an?\s+)?([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}\s+style)\b/gi)
  addMatches('VISUAL_SYSTEM', /\b(?:with|using)\s+(?:the\s+)?visual system\s+([^.;,]+?)(?=\s+(?:with|using|in|on|for)\b|[.;,]|$)/gi)
  addMatches('VISUAL_SYSTEM', /\b(?:use|apply|using)\s+(visual truth preservation rules)(?=\s*(?:[.;,!?]|$)|\s+(?:with|using|in|on|for)\b)/gi)
  addMatches('INDUSTRY', /\b(?:in|for)\s+(?:the\s+)?([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})\s+industry\b/gi)
  const languages = 'English|French|Spanish|German|Italian|Portuguese|Chinese|Japanese|Dutch'
  addMatches('LANGUAGE', new RegExp(`\\bin\\s+((?:${languages})(?:(?:\\s+(?:and|or)\\s+|\\s*,\\s*(?:and\\s+)?)(?:${languages}))*)(?=\\s*(?:[.;,!?]|$)|\\s+(?:using|with|on|for|to)\\b)`, 'gi'),
    (phrase) => phrase.split(/\s*(?:,|\band\b|\bor\b)\s*/i))
  return resolveOutcomeCompositionRequest(cues)
}

export const projectOutcomeCompositionResolution = (intent, resolution = {}) => {
  if (!hasOutcomeCompositionRequest(intent)) return null
  const request = resolveOutcomeCompositionRequest(intent.compositionResolution.mappings)
  const selectedPacks = (resolution.selectedPacks || []).filter((pack) => request.mappings.some((entry) =>
    entry.layer === pack.knowledgeLayer && entry.capabilityKey === pack.capabilityKey))
    .map(projectOutcomeRequestSelectedPack)
  const blockers = [...request.blockers]
  for (const entry of request.mappings) {
    if (blockers.some((blocker) => blocker.knowledgeLayer === entry.layer && blocker.reason === 'CONFLICTING_REQUEST_CUES')) continue
    const matches = selectedPacks.filter((pack) => pack.knowledgeLayer === entry.layer && pack.capabilityKey === entry.capabilityKey)
    if (matches.length === 1) continue
    const ambiguous = matches.length > 1 || (resolution.ambiguousCandidates || []).some((candidate) =>
      candidate.selector?.knowledgeLayer === entry.layer && candidate.selector?.capabilityKey === entry.capabilityKey)
    const code = `REQUESTED_${entry.layer}_${ambiguous ? 'AMBIGUOUS' : 'UNAVAILABLE'}`
    if (!blockers.some((blocker) => blocker.code === code && blocker.capabilityKey === entry.capabilityKey)) {
      blockers.push({ code, knowledgeLayer: entry.layer, capabilityKey: entry.capabilityKey,
        reason: ambiguous ? 'AMBIGUOUS_COMPATIBLE_CANDIDATES' : 'NO_ACTIVE_COMPATIBLE_UNIQUE_PACK' })
    }
  }
  return { ...request, selectedPacks, blockers }
}
