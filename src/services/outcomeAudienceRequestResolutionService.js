// Controlled Audience aliases; changes require review and exact resolver tests.
// Capability keys always take precedence over phrase aliases. No label matching.
export const OUTCOME_AUDIENCE_REQUEST_VERSION = 'outcome-audience-request.v1'
const aliases = Object.freeze({
  'executive team': 'executive-leadership-team',
  'executive leadership team': 'executive-leadership-team',
})
const capabilityKey = /^[a-z0-9](?:[a-z0-9._-]{0,138}[a-z0-9])?$/
export const resolveOutcomeAudienceRequest = (audience = []) => {
  const mappings = audience.map((phrase) => {
    const key = String(phrase).trim().toLowerCase()
    const exact = capabilityKey.test(key)
    const alias = Object.hasOwn(aliases, key) ? aliases[key] : ''
    return { phrase, capabilityKey: exact ? key : alias || key,
      basis: exact ? 'EXACT_CAPABILITY_KEY' : alias ? 'CONTROLLED_ALIAS' : 'UNRESOLVED' }
  })
  return { contractVersion: OUTCOME_AUDIENCE_REQUEST_VERSION, mappings,
    audienceKeys: [...new Set(mappings.map((entry) => entry.capabilityKey))] }
}
export const hasOutcomeAudienceRequest = (intent) =>
  intent?.audienceResolution?.contractVersion === OUTCOME_AUDIENCE_REQUEST_VERSION

export const projectOutcomeRequestSelectedPack = (pack) => Object.fromEntries(
  ['packId', 'packKey', 'capabilityKey', 'label', 'knowledgeLayer', 'versionId', 'semanticVersion',
    'activationId', 'scopeType', 'scopeKey', 'contentHash'].map((key) => [key, pack[key] || '']))

export const projectOutcomeRequestSelectedLayers = (packs = []) => {
  const layers = {}
  for (const pack of packs) {
    const projected = projectOutcomeRequestSelectedPack(pack)
    if (!layers[projected.knowledgeLayer]) layers[projected.knowledgeLayer] = []
    layers[projected.knowledgeLayer].push(projected)
  }
  return layers
}

export const projectOutcomeAudienceResolution = (intent, resolution = {}) => {
  if (!hasOutcomeAudienceRequest(intent)) return null
  const request = resolveOutcomeAudienceRequest(intent.audience)
  const selectedPacks = (resolution.selectedPacks || []).filter((pack) => pack.knowledgeLayer === 'AUDIENCE')
    .map(projectOutcomeRequestSelectedPack)
  const blockers = request.audienceKeys.flatMap((key) => {
    const matches = selectedPacks.filter((pack) => pack.capabilityKey === key)
    if (matches.length === 1) return []
    const ambiguous = matches.length > 1 || (resolution.ambiguousCandidates || [])
      .some((entry) => entry.selector?.knowledgeLayer === 'AUDIENCE' && entry.selector?.capabilityKey === key)
    return [{ code: ambiguous ? 'REQUESTED_AUDIENCE_AMBIGUOUS' : 'REQUESTED_AUDIENCE_UNAVAILABLE',
      knowledgeLayer: 'AUDIENCE', capabilityKey: key,
      reason: ambiguous ? 'AMBIGUOUS_COMPATIBLE_CANDIDATES' : 'NO_ACTIVE_COMPATIBLE_UNIQUE_PACK' }]
  })
  return { ...request, selectedPacks, blockers }
}
