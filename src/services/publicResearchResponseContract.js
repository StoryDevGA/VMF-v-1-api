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
export const validatePublicResearchSourceUrl = value => publicUrl(value)
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

const providerFixtureInput = wrapper.extend({ responseText: z.string(), responseId: identifier,
  capturedAt: base.shape.capturedAt, httpStatus: z.number().int().min(100).max(599),
  simulatedElapsedMs: base.shape.simulatedElapsedMs }).strict()
const braveBody = z.object({ type: z.literal('search'), query: z.object({ original: z.string().min(1).max(2000),
  altered: z.string().nullable().optional(), more_results_available: z.boolean().nullable().optional() }), web: z.object({ type: z.literal('search'),
  results: z.array(z.object({ title: text(255), url: text(500), description: z.string().max(2000).nullable().optional() })).max(4) }).nullable() })
const companyBody = z.object({ company_number: z.string().min(1).max(160), company_name: text(255),
  links: z.object({ self: z.string().max(500) }), jurisdiction: z.string().optional(),
  foreign_company_details: z.unknown().optional(), branch_company_details: z.unknown().optional(),
  partial_data_available: text(255).optional() })
const ukJurisdictions = new Set(['england-wales', 'wales', 'scotland', 'northern-ireland', 'united-kingdom', 'england'])
const providerReferences = {
  brave: [{ url: 'https://api-dashboard.search.brave.com/api-reference/web/search/get',
    sha256: '7bd84236550d935877f35f0a5490b76ea35402d0cad26c646b8a0a6f2e849979' }],
  companiesHouse: [{ url: 'https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference/company-profile/company-profile',
    sha256: '43648e1d61c6cec372d07a69979f1660f6778ec787636155a2cdf4526d64e745' },
  { url: 'https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/resources/companyprofile?v=latest',
    sha256: '112e7e2d0d1250ada734001a1d111518542b23c0d0b15b943da888ab21cc8ba0' }],
  tavily: [{ url: 'https://docs.tavily.com/documentation/api-reference/endpoint/search',
    sha256: 'f21c26009cd512a70e18ee6d4bedd9e7699e429fe850fc957a93705ccd24c888' }],
}
const parseProviderInput = (args, category, schema = providerFixtureInput) => {
  const input = schema.parse(args)
  if (!input.settings.sources.includes(category) || Buffer.byteLength(input.responseText, 'utf8') > fixtureLimits.maxResponseBytes) fail()
  return input
}
const canonicalProviderResponse = (input, status, items = [], failedCount = 0, unknownCount = 0) => JSON.stringify({
  responseId: input.responseId, capturedAt: input.capturedAt, simulatedElapsedMs: input.simulatedElapsedMs,
  status, items, failedCount, unknownCount,
})
const providerFixtureDescriptor = (url, request = {}) => ({ method: request.method || 'GET', url,
  executionEnabled: false, credentialMaterial: 'NOT_INCLUDED', authority: 'NOT_EVALUATED',
  blockers: ['OPERATING_APPROVAL_NOT_RECORDED', 'CREDENTIAL_AUTHORITY_NOT_RECORDED', 'LIVE_BUDGET_NOT_APPROVED'],
  ...(request.body ? { body: request.body, authentication: 'SERVER_BEARER_REQUIRED_NOT_LOADED' } : {}) })
const providerFixtureResult = (input, provider, url, normalized, qualifications, request = {}) => ({
  fixtureOnly: true, liveExecutionEnabled: false, classification: 'DOCUMENTED_PROVIDER_SHAPE_SYNTHETIC_FIXTURE',
  requestDescriptor: providerFixtureDescriptor(url, request),
  providerResponse: { httpStatus: input.httpStatus, bodyHash: sourceEvidenceHash(input.responseText),
    providerProposal: provider === 'brave' ? 'BRAVE_WEB_SEARCH' : provider === 'tavily' ? 'TAVILY_BASIC_SEARCH' : 'COMPANIES_HOUSE_COMPANY_PROFILE',
    referenceSnapshotDate: '2026-11-13', referenceBoundary: 'DOC_SNAPSHOT_NOT_IMMUTABLE_VENDOR_RELEASE',
    versionBoundary: provider === 'brave' ? 'ENDPOINT_MAJOR_V1_NO_DATE_HEADER_PIN' : 'UNVERSIONED_CURRENT_DOCUMENTATION',
    references: providerReferences[provider].map(reference => ({ ...reference })), qualifications },
  countBasis: { failedCount: 'RESPONSE_ADAPTATION_OUTCOMES', unknownCount: 'UNRESOLVED_RESPONSE_CONDITIONS_NOT_RESULT_TOTAL' },
  normalized,
})
const httpFixtureStatus = (input, companyProfile = false) => input.httpStatus === 429
  ? ['RATE_LIMITED', 0, 1] : companyProfile && input.httpStatus === 404 ? ['EMPTY', 0, 0] : ['UNAVAILABLE', 1, 0]

/** Documented-shape fixtures only. This descriptor is never sent by this module. */
export const prepareBraveSearchFixture = args => {
  try {
    const input = parseProviderInput(args, 'SEARCH')
    const query = `site:${new URL(publicUrl(input.settings.startingUrls[0])).hostname}`
    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.search = new URLSearchParams({ q: query, count: '4', offset: '0', country: 'GB', search_lang: 'en',
      result_filter: 'web', summary: 'false', extra_snippets: 'false', spellcheck: 'false', operators_fallback: 'false' }).toString()
    let status, items = [], failedCount = 0, unknownCount = 0
    const qualifications = []
    if (input.httpStatus !== 200) {
      ;[status, failedCount, unknownCount] = httpFixtureStatus(input)
      qualifications.push('SYNTHETIC_HTTP_OUTCOME_BODY_NOT_INTERPRETED')
    } else {
      const body = braveBody.parse(JSON.parse(input.responseText))
      if (body.query.original !== query || body.query.altered?.trim()) fail()
      items = (body.web?.results || []).map((item, index) => ({ resultId: `brave-result-${index + 1}`,
        url: item.url, title: item.title, snippet: item.description ?? '' }))
      if (body.query.more_results_available === true) {
        if (!items.length) fail() // No invented failed population for itemless continuation.
        status = 'PARTIAL'; unknownCount = 1; qualifications.push('MORE_RESULTS_NOT_FETCHED')
      } else {
        status = items.length ? 'SUCCESS' : 'EMPTY'
        if (body.query.more_results_available == null) qualifications.push('PAGINATION_NOT_RECORDED')
      }
    }
    const normalized = normalizeSearchResearchResponse({ selector: input.selector, settings: input.settings,
      responseText: canonicalProviderResponse(input, status, items, failedCount, unknownCount) })
    return providerFixtureResult(input, 'brave', url.toString(), normalized, qualifications)
  } catch { fail() }
}

const companyIdentifier = value => {
  // Company numbers are one path segment. Reject escapes as well as delimiters,
  // rather than allowing encoded/double-encoded separators into a descriptor.
  if (!value || !/^[A-Za-z0-9]+$/.test(value)) fail()
  return value
}
export const prepareCompaniesHouseProfileRequest = args => {
  try {
    const input = z.object({ selector: researchConfigurationSelectorSchema, settings: researchSettingsSchema }).strict().parse(args)
    const settings = input.settings
    if (!settings.sources.includes('REGISTRY') || !settings.entityConfirmed || !settings.legalEntity
      || !(settings.countryCode === 'GB' || settings.ukSubsidiary)) fail()
    const companyNumber = companyIdentifier(settings.entityIdentifier)
    return { companyNumber, descriptor: providerFixtureDescriptor(
      'https://api.company-information.service.gov.uk/company/' + encodeURIComponent(companyNumber)) }
  } catch { fail() }
}
const mapCompanyProfileBody = input => {
    let status, items = [], failedCount = 0, unknownCount = 0
    const qualifications = []
    if (input.transportOutcome === 'TIMEOUT') { status = 'UNAVAILABLE'; failedCount = 1; unknownCount = 1 }
    else if (input.httpStatus !== 200) {
      ;[status, failedCount, unknownCount] = httpFixtureStatus(input, true)
    } else {
      const body = companyBody.parse(JSON.parse(input.responseText)), returnedId = companyIdentifier(body.company_number)
      if (body.links.self !== '/company/' + returnedId) fail()
      if (Object.hasOwn(body, 'foreign_company_details') || Object.hasOwn(body, 'branch_company_details')) {
        status = 'UNAVAILABLE'; failedCount = 1; qualifications.push('UNSUPPORTED_FOREIGN_OR_BRANCH_PROFILE')
      } else {
        if (!ukJurisdictions.has(body.jurisdiction)) fail()
        items = [{ resultId: 'company-profile-1', entityIdentifier: returnedId, legalName: body.company_name, countryCode: 'GB',
          profileLocator: 'https://find-and-update.company-information.service.gov.uk/company/' + encodeURIComponent(returnedId) }]
        if (body.partial_data_available !== undefined) {
          status = 'PARTIAL'; unknownCount = 1; qualifications.push('PROFILE_PARTIAL_DATA_RECORDED')
        } else status = 'SUCCESS'
      }
    }
  return { status, items, failedCount, unknownCount, qualifications }
}

export const prepareCompaniesHouseProfileFixture = args => {
  try {
    const input = parseProviderInput(args, 'REGISTRY'), settings = input.settings
    const { descriptor: { url } } = prepareCompaniesHouseProfileRequest({ selector: input.selector, settings })
    const { status, items, failedCount, unknownCount, qualifications } = mapCompanyProfileBody(input)
    if (input.httpStatus !== 200) qualifications.push('SYNTHETIC_HTTP_OUTCOME_BODY_NOT_INTERPRETED')
    const normalized = normalizeUkRegistryResearchResponse({ selector: input.selector, settings,
      responseText: canonicalProviderResponse(input, status, items, failedCount, unknownCount) })
    return providerFixtureResult(input, 'companiesHouse', url, normalized, qualifications)
  } catch { fail() }
}

const tavilyFixtureInput = providerFixtureInput.extend({ provider: z.literal('TAVILY_SEARCH'),
  approvedHostname: z.string().min(1).max(253),
  approvedTerms: z.array(z.string().min(1).max(80).regex(/^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u)).max(4),
  transportOutcome: z.enum(['COMPLETE', 'PARTIAL', 'TIMEOUT']), httpStatus: providerFixtureInput.shape.httpStatus.nullable(),
}).strict()
const vendorSeconds = z.union([z.number().finite().min(0), z.string()
  .regex(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/)
  .refine(value => Number.isFinite(Number(value)) && Number(value) >= 0)])
const tavilyBody = z.object({ query: z.string().min(1).max(2000), request_id: identifier,
  results: z.array(z.object({ title: text(255), url: text(500), content: z.string().max(2000),
    score: z.number().finite().min(0).max(1).optional(), raw_content: z.null().optional() })).max(4),
  answer: z.null().optional(), usage: z.object({ credits: z.literal(1) }), response_time: vendorSeconds,
  auto_parameters: z.object({ topic: z.literal('general').optional(), search_depth: z.literal('basic').optional() }).strict().nullable().optional(),
  search_depth: z.literal('basic').optional(),
})

export const prepareTavilySearchRequest = args => {
  try {
    const input = z.object({ selector: researchConfigurationSelectorSchema, settings: researchSettingsSchema,
      approvedHostname: tavilyFixtureInput.shape.approvedHostname, approvedTerms: tavilyFixtureInput.shape.approvedTerms }).strict().parse(args)
    if (!input.settings.sources.includes('SEARCH')) fail()
    const hostname = new URL(publicUrl(input.settings.startingUrls[0])).hostname
    if (input.approvedHostname !== hostname) fail()
    const query = [`site:${hostname}`, ...input.approvedTerms].join(' ')
    const body = { query, search_depth: 'basic', topic: 'general', max_results: 4,
      include_domains: [hostname], include_domains_mode: 'restrict', auto_parameters: false,
      include_answer: false, include_raw_content: false, include_images: false,
      include_image_descriptions: false, include_favicon: false, include_usage: true }
    return { hostname, query, body, descriptor: providerFixtureDescriptor('https://api.tavily.com/search', { method: 'POST', body }) }
  } catch { fail() }
}
export const prepareTavilyFixtureRequest = args => {
  try {
    const input = parseProviderInput(args, 'SEARCH', tavilyFixtureInput)
    if ((input.transportOutcome === 'TIMEOUT') !== (input.httpStatus === null)) fail()
    return { input, ...prepareTavilySearchRequest({ selector: input.selector, settings: input.settings,
      approvedHostname: input.approvedHostname, approvedTerms: input.approvedTerms }) }
  } catch { fail() }
}

// Legacy fixture receipts reconstruct the exact-query mapping. Only the native
// v2 adapter opts into the observed omission of the approved leading site filter.
const mapTavilyBody = (input, hostname, query, allowSiteOperatorOmission = false) => {
  let status, items = [], failedCount = 0, unknownCount = 0, providerRequestId = null, responseTime = null, credits = null, queryBinding
    if (input.transportOutcome === 'TIMEOUT') {
      status = 'UNAVAILABLE'; failedCount = 1; unknownCount = 1
    } else if (input.httpStatus !== 200) {
      ;[status, failedCount, unknownCount] = httpFixtureStatus(input)
    } else {
      const body = tavilyBody.parse(JSON.parse(input.responseText))
      const prefix = `site:${hostname} `
      const termsOnly = query.startsWith(prefix) ? query.slice(prefix.length) : ''
      if (body.query !== query && (!allowSiteOperatorOmission || !termsOnly || body.query !== termsOnly)) fail()
      if (allowSiteOperatorOmission) queryBinding = { contractVersion: 'tavily-query-binding.v2',
        submittedQuery: query, providerQuery: body.query,
        normalization: body.query === query ? 'EXACT' : 'LEADING_APPROVED_SITE_OPERATOR_REMOVED' }
      providerRequestId = body.request_id; responseTime = Number(body.response_time); credits = body.usage.credits
      items = body.results.map((item, index) => {
        const url = publicUrl(item.url)
        if (new URL(url).hostname !== hostname) fail()
        return { resultId: `tavily-result-${index + 1}`, url, title: item.title, snippet: item.content }
      })
      if (input.transportOutcome === 'PARTIAL') {
        if (!items.length) fail()
        status = 'PARTIAL'; unknownCount = 1
      } else status = items.length ? 'SUCCESS' : 'EMPTY'
    }
  if (new Set(items.map(item => item.url)).size !== items.length) fail()
  return { status, items, failedCount, unknownCount, providerRequestId, responseTime, credits,
    ...(queryBinding ? { queryBinding } : {}) }
}

/** Caller-supplied synthetic metadata only: no transport, saved Run or retry authority. */
export const prepareTavilySearchFixture = args => {
  try {
    const { input, hostname, query, body: requestBody } = prepareTavilyFixtureRequest(args)
    const { status, items, failedCount, unknownCount, providerRequestId, responseTime, credits } = mapTavilyBody(input, hostname, query)
    const qualifications = ['COVERAGE_NOT_ESTABLISHED', 'REQUEST_SCOPE_AND_TRANSPORT_ARE_CALLER_SUPPLIED_SYNTHETIC_ASSERTIONS']
    if (input.transportOutcome === 'TIMEOUT') qualifications.push('APPLICATION_SUPPLIED_SYNTHETIC_TIMEOUT_NOT_OBSERVED_TRANSPORT')
    else if (input.httpStatus !== 200) qualifications.push('SYNTHETIC_HTTP_OUTCOME_BODY_NOT_INTERPRETED')
    else if (input.transportOutcome === 'PARTIAL') qualifications.push('APPLICATION_SUPPLIED_SYNTHETIC_TRANSPORT_PARTIAL_NOT_VENDOR_FIELD')
    const normalized = normalizeSearchResearchResponse({ selector: input.selector, settings: input.settings,
      responseText: canonicalProviderResponse(input, status, items, failedCount, unknownCount) })
    const result = providerFixtureResult(input, 'tavily', 'https://api.tavily.com/search', normalized, qualifications,
      { method: 'POST', body: requestBody })
    return { ...result, fixtureReceipt: { classification: 'SYNTHETIC_BINDING_NOT_SAVED_RUN_RECEIPT',
      authority: 'CALLER_SUPPLIED_NOT_AUDIT_VERIFIED', transportOutcome: input.transportOutcome, httpStatus: input.httpStatus,
      responseId: input.responseId, capturedAt: input.capturedAt, providerRequestId,
      descriptorHash: sourceEvidenceHash(JSON.stringify(result.requestDescriptor)), responseBodyHash: result.providerResponse.bodyHash,
      selector: normalized.binding.selector, settingsHash: normalized.binding.settingsHash,
      approvedScopeHash: sourceEvidenceHash(JSON.stringify({ hostname, terms: input.approvedTerms })),
      vendorReportedResponseTimeSeconds: responseTime, vendorReportedCredits: credits,
      runId: null, executionAttemptId: null } }
  } catch { fail() }
}

// Actual transport adaptation shares body validation, without fixture authority,
// fake limits, or a synthetic binding being presented as native evidence.
export const adaptTavilySearchTransportResponse = ({ request, transport }) => {
  try {
    const { hostname, query } = prepareTavilySearchRequest(request)
    assertObservedTransport(transport)
    return { ...mapTavilyBody(transport, hostname, query, true), classification: 'DISCOVERY_ONLY',
      qualifications: ['SEARCH_METADATA_NOT_ORIGINAL_EVIDENCE', 'COVERAGE_NOT_ESTABLISHED'] }
  } catch { fail() }
}

export const adaptCompaniesHouseProfileTransportResponse = ({ request, transport }) => {
  try {
    prepareCompaniesHouseProfileRequest(request)
    assertObservedTransport(transport)
    const mapped = mapCompanyProfileBody(transport), matches = [], rejected = []
    for (const item of mapped.items) {
      const reason = item.entityIdentifier !== request.settings.entityIdentifier ? 'ENTITY_IDENTIFIER_MISMATCH'
        : item.legalName !== request.settings.legalEntity ? 'LEGAL_NAME_MISMATCH' : null
      if (reason) rejected.push({ ...item, reason })
      else matches.push(item)
    }
    return { ...mapped, ...(rejected.length ? { status: 'UNAVAILABLE', failedCount: 1 } : {}), matches, rejected,
      classification: 'ENTITY_MATCH_ONLY', qualifications: [...mapped.qualifications, 'REGISTRY_IDENTITY_NOT_WEBSITE_EVIDENCE'] }
  } catch { fail() }
}

const assertObservedTransport = transport => {
  if (!z.object({ responseText: z.string(), httpStatus: z.number().int().min(100).max(599).nullable(),
    transportOutcome: z.enum(['COMPLETE', 'TIMEOUT']) }).passthrough().safeParse(transport).success
    || Buffer.byteLength(transport.responseText) > 16384
    || (transport.transportOutcome === 'TIMEOUT') !== (transport.httpStatus === null)) fail()
}
