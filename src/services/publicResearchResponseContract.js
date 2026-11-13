import { z } from 'zod'
import { researchConfigurationSelectorSchema, researchSettingsSchema } from './researchConfigurationContract.js'
import { normalizeDiscoveryWebsiteUrl } from './discoveryIntelligenceService.js'
import { sourceEvidenceHash } from './sourceEvidenceContract.js'

// These are synthetic response-validation caps, not approved live operating budgets.
const fixtureLimits = Object.freeze({ maxResponseBytes: 16384, maxResults: 4, maxSuppliedResponses: 1,
  maxSimulatedElapsedMs: 1000, nativePages: 0, nativeQueries: 0, modelTokens: 0,
  externalCost: 0, nativeConcurrency: 0, nativeRetries: 0, nativeRedirects: 0 })
const wrapper = z.object({ selector: researchConfigurationSelectorSchema, settings: researchSettingsSchema,
  responseText: z.string().min(1) }).strict()
const identifier = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const text = max => z.string().trim().min(1).max(max)
const base = z.object({ responseId: identifier, capturedAt: z.string().datetime({ precision: 3 }),
  status: z.enum(['SUCCESS', 'EMPTY', 'UNAVAILABLE', 'RATE_LIMITED', 'PARTIAL']),
  failedCount: z.number().int().min(0).max(4), unknownCount: z.number().int().min(0).max(4),
  simulatedElapsedMs: z.number().int().min(0).max(fixtureLimits.maxSimulatedElapsedMs) })
const searchResponse = base.extend({ items: z.array(z.object({ resultId: identifier, url: text(500),
  title: text(255), snippet: z.string().max(2000) }).strict()).max(fixtureLimits.maxResults) }).strict()
const registryResponse = base.extend({ items: z.array(z.object({ resultId: identifier, entityIdentifier: text(160),
  legalName: text(255), countryCode: z.string().regex(/^[A-Z]{2}$/), profileLocator: text(500) }).strict())
  .max(fixtureLimits.maxResults) }).strict()
const sensitiveQueryKeys = new Set(['api_key', 'apikey', 'access_token', 'token', 'password', 'secret', 'authorization', 'credential',
  'client_secret', 'refresh_token', 'api-key'])
const fail = () => { throw Object.assign(new Error('Public research fixture response is invalid.'), {
  code: 'PUBLIC_RESEARCH_RESPONSE_INVALID', status: 422,
}) }
const publicUrl = value => {
  const normalized = normalizeDiscoveryWebsiteUrl(value)
  if ([...new URL(normalized).searchParams.keys()].some(key => sensitiveQueryKeys.has(key.toLowerCase()))) fail()
  return normalized
}
const parse = (args, category, schema) => {
  const input = wrapper.parse(args)
  if (!input.settings.sources.includes(category)
    || Buffer.byteLength(input.responseText, 'utf8') > fixtureLimits.maxResponseBytes) fail()
  const response = schema.parse(JSON.parse(input.responseText))
  if (new Date(response.capturedAt).toISOString() !== response.capturedAt
    || new Set(response.items.map(item => item.resultId)).size !== response.items.length) fail()
  const { status, items, failedCount, unknownCount } = response
  if (status === 'SUCCESS' && (!items.length || failedCount || unknownCount)
    || status === 'EMPTY' && (items.length || failedCount || unknownCount)
    || status === 'UNAVAILABLE' && (items.length || !failedCount)
    || status === 'RATE_LIMITED' && (items.length || !unknownCount)
    || status === 'PARTIAL' && (!items.length || !(failedCount || unknownCount))) fail()
  return { input, response }
}
const result = (input, response, classification) => {
  const { items: _items, ...receipt } = response
  return { contractVersion: 'provider-free-public-research-response.v1', fixtureOnly: true, liveExecutionEnabled: false,
    classification, binding: { authority: 'CALLER_SUPPLIED_NOT_AUDIT_VERIFIED', selector: input.selector,
      settingsHash: sourceEvidenceHash(JSON.stringify(input.settings)) }, response: receipt,
    limits: { ...fixtureLimits }, currentness: 'CAPTURE_TIMESTAMP_SUPPLIED_PRESENT_ACCURACY_NOT_ESTABLISHED',
    sourceAuthority: 'NOT_INDEPENDENTLY_VERIFIED', contentTrust: 'UNTRUSTED_SOURCE_TEXT',
    continuation: 'NONE', evidenceObjects: [] }
}

/** Pure internal fixture grammar, not a selected provider's wire format or dispatch permit. */
export const normalizeSearchResearchResponse = args => {
  try {
    const { input, response } = parse(args, 'SEARCH', searchResponse)
    const discoveryItems = response.items.map(item => ({ ...item, url: publicUrl(item.url) }))
    if (new Set(discoveryItems.map(item => item.url)).size !== discoveryItems.length) fail()
    return { ...result(input, response, 'DISCOVERY_ONLY'), discoveryItems }
  } catch { fail() }
}

/** A supplied locator is not Companies House authority, and a match is not accepted evidence. */
export const normalizeUkRegistryResearchResponse = args => {
  try {
    const { input, response } = parse(args, 'REGISTRY', registryResponse)
    if (new Set(response.items.map(item => item.entityIdentifier)).size !== response.items.length) fail()
    const items = response.items.map(item => ({ ...item, profileLocator: publicUrl(item.profileLocator) }))
    const settings = input.settings
    const target = settings.countryCode && settings.countryCode !== 'GB' && !settings.ukSubsidiary
      ? { status: 'NOT_APPLICABLE', reason: 'UK_REGISTRY_NOT_APPLICABLE' }
      : !settings.entityConfirmed || !settings.legalEntity || !(settings.countryCode === 'GB' || settings.ukSubsidiary)
        ? { status: 'BLOCKED', reason: 'ENTITY_UNCONFIRMED' }
        : !settings.entityIdentifier ? { status: 'BLOCKED', reason: 'ENTITY_IDENTIFIER_NOT_RECORDED' }
          : { status: 'APPLICABLE', reason: null }
    const matches = [], rejected = [], unknown = []
    for (const item of items) {
      if (target.status !== 'APPLICABLE') unknown.push({ ...item, reason: target.reason })
      else if (item.countryCode !== 'GB') rejected.push({ ...item, reason: 'JURISDICTION_MISMATCH' })
      else if (item.entityIdentifier !== settings.entityIdentifier) rejected.push({ ...item, reason: 'ENTITY_IDENTIFIER_MISMATCH' })
      else if (item.legalName !== settings.legalEntity) rejected.push({ ...item, reason: 'LEGAL_NAME_MISMATCH' })
      else matches.push(item)
    }
    return { ...result(input, response, 'ENTITY_MATCH_ONLY'), target, matches, rejected, unknown }
  } catch { fail() }
}
