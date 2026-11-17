import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import env from '../config/env.js'
import { CONTROLLED_REPLAY_BINDINGS, verifyControlledReplayAuthority,
  verifyControlledReplayExclusions, verifyProviderFreeSearchReceiptScope } from '../constants/controlledReplayBindings.js'
import { controlledReplaySelectorSchema, assertStoredControlledReplayBinding, storedControlledReplayBindingDigest,
  validateStoredControlledReplayProvenance, assertControlledReplayBinding } from './controlledReplayContract.js'
import { isControlledSyntheticOutcomeRuntime } from './syntheticOutcomeIsolationService.js'
import { isRuntimeLocked, isRuntimeLifecycleTruthImmutable } from './runtimeActionPolicyService.js'
import { validateControlledReplayIsolation, assertNoControlledReplayIsolation } from './controlledReplayIsolationService.js'
import { buildControlledReplayEvidenceFromDecodedHtml } from './discoveryIntelligenceService.js'
import { executeTavilySearchTransport } from './publicResearchTransportService.js'

const resolved = new WeakSet()
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
// Separate receipt fixture identity. This is not a WEBSITE replay binding or a
// provider grant. The maintained bytes have a production fixture-mode caller.
export const PROVIDER_FREE_SEARCH_FIXTURE = freeze({ fixtureId: 'trilogy-clients-search.v1', fixtureVersion: 1,
  fixtureFileSha256: '52f6c26a69f42f876a7d2f60880f80065e33d21df2bfc40aa1a061ec9c6fff77',
  targetUrl: 'https://www.trilogywebsolutions.co.uk/clients/', provider: 'TAVILY_SEARCH' })
export const PUBLIC_RESEARCH_FIXTURE = freeze({ fixtureId: 'controlled-public-research.v1', fixtureVersion: 1,
  fixtureFileSha256: 'ee89208adc61a1a03c5ca5bed10c93b0e703799991ac5dfd6c6c5700058d6c87',
  controlledBindingId: 'local-public-research.1' })
export const loadPublicResearchFixture = async () => {
  try {
    const bytes = await readFile(new URL('../runtime-contracts/controlled-replay/public-research-response.v1.json', import.meta.url))
    if (createHash('sha256').update(bytes).digest('hex') !== PUBLIC_RESEARCH_FIXTURE.fixtureFileSha256) throw new Error()
    return freeze(JSON.parse(bytes.toString('utf8')))
  } catch { fail('PUBLIC_RESEARCH_FIXTURE_UNVERIFIED') }
}
export const verifyPublicResearchFixtureReadScope = async args => {
  // Reuse exact native identity/topology facts. This grants no execution or live
  // provider access; new capture still requires its separate controlled grant.
  await verifyProviderFreeSearchReceiptScope({ ...args, allowRecordedControlledCapture: true })
}
export const assertPublicResearchFixtureExecution = async ({ configuration, runtimeInstance, actorUserId, controlledContext, payload, session }) => {
  const asset = await loadPublicResearchFixture(), context = assertResolvedControlledReplay(controlledContext)
  await verifyPublicResearchFixtureReadScope({ runtimeInstance, actorUserId, session })
  assertControlledReplayCurrent(context, runtimeInstance, payload)
  await verifyControlledReplayCurrentAuthority(context, runtimeInstance, session)
  const settings = configuration.settings, previous = runtimeInstance.framework_state?.evidence_pack
  if (context.descriptor.binding.bindingId !== asset.controlledBindingId
    || settings.startingUrls.length !== 1 || settings.startingUrls[0] !== asset.targetUrl
    || settings.sources.length !== 2 || !['SEARCH', 'WEBSITE'].every(key => settings.sources.includes(key))
    || !Array.isArray(previous?.sourceRegistry) || previous.sourceRegistry.length || !Array.isArray(previous?.evidenceObjects) || previous.evidenceObjects.length)
    fail('PUBLIC_RESEARCH_FIXTURE_SETTINGS_UNSUPPORTED')
  return asset
}
export const buildPublicResearchFixturePolicy = ({ asset, configuration, runtimeInstance, actorUserId, requestKey }) => ({
  contractVersion: 'public-research-operating-policy.v1', environment: 'DEVELOPMENT_TEST', releaseId: requestKey,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), binding: { customerId: String(runtimeInstance.customerId),
    tenantId: String(runtimeInstance.tenantId), runtimeInstanceId: String(runtimeInstance._id || runtimeInstance.id),
    runtimeInstanceKey: runtimeInstance.runtimeInstanceKey, actorUserId: String(actorUserId),
    configurationVersion: configuration.configurationVersion, configurationHash: configuration.configurationHash,
    basisStateVersion: configuration.basisStateVersion, basisUpdatedAt: configuration.basisUpdatedAt },
  approvalRef: 'SYNTHETIC_FIXTURE_ONLY_NOT_PRODUCT_APPROVAL', licensingRef: 'SYNTHETIC_LOCAL_MATERIAL_ONLY',
  retentionRef: 'RETAIN_ISOLATED_FIXTURE_EVIDENCE', disclosureRef: 'NO_EXTERNAL_DISCLOSURE', processingRegion: 'LOCAL_ONLY',
  credentialOwner: 'NONE_OFFLINE', spendOwner: 'NONE_OFFLINE', references: [{
    url: 'https://docs.tavily.com/documentation/api-reference/endpoint/search', version: 'documentation-snapshot-2026-11-13',
    sha256: 'sha256:f21c26009cd512a70e18ee6d4bedd9e7699e429fe850fc957a93705ccd24c888' }, {
    url: 'https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference/company-profile/company-profile',
    version: 'documentation-snapshot-2026-11-13', sha256: 'sha256:43648e1d61c6cec372d07a69979f1660f6778ec787636155a2cdf4526d64e745' }],
  approvedStartingUrls: [asset.targetUrl], approvedDiscoveryUrls: [], approvedTerms: asset.approvedTerms,
  partialSave: 'PRESERVE_PENDING', limits: { maxSearchRequests: 1, maxRegistryRequests: 0, maxPages: 1,
    maxPageBytes: 320000, maxJsonBytes: 16384, maxTotalBytes: 1048576, maxElapsedMs: 120000, maxRequestMs: 6000,
    maxCostMicros: 0, searchRequestCostMicros: 0, registryRequestCostMicros: 0,
    concurrency: 1, retries: 0, redirects: 0, modelTokens: 0 },
})
export const loadProviderFreeSearchFixture = async () => {
  try {
    const bytes = await readFile(new URL('../runtime-contracts/controlled-replay/search-response.v1.json', import.meta.url))
    if (createHash('sha256').update(bytes).digest('hex') !== PROVIDER_FREE_SEARCH_FIXTURE.fixtureFileSha256) throw new Error()
    return freeze(JSON.parse(bytes.toString('utf8')))
  } catch { fail('PROVIDER_FREE_SEARCH_ASSET_UNVERIFIED') }
}
export const buildProviderFreeSearchFixtureInput = async ({ selector, settings }) => {
  const asset = await loadProviderFreeSearchFixture()
  return { selector, settings, provider: asset.provider, approvedHostname: new URL(asset.targetUrl).hostname,
    approvedTerms: asset.approvedTerms, responseId: asset.responseId, capturedAt: asset.capturedAt,
    transportOutcome: asset.transportOutcome, httpStatus: asset.httpStatus, simulatedElapsedMs: asset.simulatedElapsedMs,
    responseText: JSON.stringify(asset.response) }
}
// Internal fixture transport only. Start supplies no transport dependency; its
// responder consumes the verified local asset, never fetch or credentials.
export const dispatchProviderFreeSearchFixture = async (args, { send } = {}) => {
  const fixture = await buildProviderFreeSearchFixtureInput(args)
  try {
    const response = await executeTavilySearchTransport(fixture, { mode: 'OFFLINE',
      send: send || (async () => new Response(fixture.responseText, { status: fixture.httpStatus })) })
    return { ...fixture, transportOutcome: response.transportOutcome, httpStatus: response.httpStatus, responseText: response.responseText }
  } catch (error) {
    if (error?.code === 'PUBLIC_RESEARCH_RESPONSE_INVALID') throw error
    fail(error?.details?.reason === 'PUBLIC_RESEARCH_RESPONSE_TOO_LARGE'
      ? 'PROVIDER_FREE_SEARCH_RESPONSE_TOO_LARGE' : 'PROVIDER_FREE_SEARCH_TRANSPORT_INVALID')
  }
}
const fail = reason => { throw Object.assign(new Error('Controlled replay is unavailable for this scope.'), {
  status: 409, code: 'CONFLICT', details: { reason },
}) }
const native = runtime => ({ customerId: String(runtime.customerId || ''), tenantId: String(runtime.tenantId || ''),
  runtimeInstanceId: String(runtime._id || runtime.id || ''), runtimeInstanceKey: runtime.runtimeInstanceKey })
export const assertResolvedControlledReplay = context => {
  if (!context || !resolved.has(context)) fail('CONTROLLED_REPLAY_NOT_ACTIVATED')
  return context
}
const verifyRegistration = async ({ registration, binding, runtimeInstance, actorUserId, session }) => {
  const authority = await verifyControlledReplayAuthority({ registration, binding, runtimeInstance, actorUserId, session })
  if (authority?.authorityRef !== binding.authorityRef) fail('CONTROLLED_REPLAY_AUTHORITY_UNVERIFIED')
  const exclusions = await verifyControlledReplayExclusions({ registration, binding, runtimeInstance, actorUserId, session })
  if (exclusions?.isolationRef !== binding.isolationRef || exclusions.parlon !== false || exclusions.heldSs044Family !== false)
    fail('CONTROLLED_REPLAY_PROTECTED_SCOPE_UNVERIFIED')
  return { authority, exclusions }
}
export const verifyControlledReplayCurrentAuthority = async (context, runtimeInstance, session = null) => {
  const resolvedContext = assertResolvedControlledReplay(context), binding = resolvedContext.descriptor.binding
  const registration = CONTROLLED_REPLAY_BINDINGS.find(entry => entry.binding?.bindingId === binding.bindingId)
  if (!registration || storedControlledReplayBindingDigest(registration.binding) !== storedControlledReplayBindingDigest(binding))
    fail('CONTROLLED_REPLAY_AUTHORITY_UNVERIFIED')
  await verifyRegistration({ registration, binding, runtimeInstance, actorUserId: resolvedContext.actorUserId, session })
}
export const resolveControlledReplayAcquisition = async ({ payload, runtimeInstance, actorUserId, actionKey, session = null }) => {
  if (!payload || !Object.hasOwn(payload, 'controlledReplay')) return undefined
  const selector = controlledReplaySelectorSchema.safeParse(payload.controlledReplay)
  const entry = selector.success && CONTROLLED_REPLAY_BINDINGS.find(row => row.binding?.bindingId === selector.data.bindingId)
  if (!entry || !['BUILD_EVIDENCE_PACK', 'REFRESH_EVIDENCE_PACK'].includes(actionKey)) fail('CONTROLLED_REPLAY_NOT_ACTIVATED')
  const binding = JSON.parse(JSON.stringify(assertStoredControlledReplayBinding(entry.binding)))
  const { authority, exclusions } = await verifyRegistration({ registration: entry, binding, runtimeInstance, actorUserId, session })
  const identity = native(runtimeInstance)
  if (Object.keys(binding.scope).some(key => binding.scope[key] !== identity[key])
    || binding.revisionId !== identity.runtimeInstanceKey || binding.actorUserId !== String(actorUserId)
    || !['development', 'test'].includes(env.nodeEnv) || env.appEnv !== 'development'
    || isControlledSyntheticOutcomeRuntime(runtimeInstance)) fail('CONTROLLED_REPLAY_CONTRACT_INVALID')
  if (payload.documentSources?.length || payload.inputs !== undefined
    || payload.predecessorRunId && (!payload.researchConfiguration || !payload.predecessorExecutionAttemptId))
    fail('CONTROLLED_REPLAY_MIXED_INPUTS')
  const provenance = { contractVersion: 'controlled-replay-provenance.v1', classification: binding.classification,
    operation: 'CONTROLLED_HTML_REPLAY_CAPTURE', adapter: 'controlled-html-replay-v1', bindingId: binding.bindingId,
    bindingVersion: binding.bindingVersion, bindingDigest: storedControlledReplayBindingDigest(binding), ...binding.fixture }
  const descriptor = validateStoredControlledReplayProvenance({ binding, provenance }, identity)
  let bytes, asset
  try {
    bytes = await readFile(new URL('../runtime-contracts/controlled-replay/long-page.v1.json', import.meta.url))
    if (createHash('sha256').update(bytes).digest('hex') !== binding.fixture.fixtureFileSha256) throw new Error('Asset bytes changed.')
    asset = JSON.parse(bytes.toString('utf8'))
    if (typeof asset.html !== 'string' || !asset.html.isWellFormed()
      || createHash('sha256').update(asset.html).digest('hex') !== binding.fixture.htmlSha256) throw new Error('HTML changed.')
  } catch { fail('CONTROLLED_REPLAY_ASSET_UNVERIFIED') }
  const context = freeze({ descriptor, native: identity, actorUserId: String(actorUserId), html: asset.html,
    // Local engineering qualification (or disclosed test witness), never provider/Product approval.
    authority, exclusions })
  resolved.add(context)
  return context
}
export const assertControlledReplayCurrent = (context, runtime, payload) => {
  const { descriptor, native: identity } = assertResolvedControlledReplay(context)
  validateStoredControlledReplayProvenance(descriptor, native(runtime))
  if (String(runtime._id || runtime.id) !== identity.runtimeInstanceId || runtime.stateVersion !== descriptor.binding.basisStateVersion
    || !payload.expectedUpdatedAt || new Date(runtime.updatedAt).getTime() !== new Date(payload.expectedUpdatedAt).getTime()
    || runtime.status !== 'ACTIVE' || isRuntimeLocked({ runtimeInstance: runtime })
    || isRuntimeLifecycleTruthImmutable(runtime.framework_state)) fail('CONTROLLED_REPLAY_CURRENT_BASIS_INVALID')
  if (runtime.controlledReplayIsolation !== undefined) {
    if (validateControlledReplayIsolation(runtime.controlledReplayIsolation, runtime).bindingDigest !== descriptor.provenance.bindingDigest)
      fail('CONTROLLED_REPLAY_ISOLATION_INVALID')
  } else assertNoControlledReplayIsolation(runtime)
  assertControlledReplayBinding(descriptor.binding, { environment: 'DEVELOPMENT_TEST', scope: descriptor.binding.scope,
    revisionId: runtime.runtimeInstanceKey, basisStateVersion: runtime.stateVersion, actorUserId: context.actorUserId,
    authorityRef: descriptor.binding.authorityRef, isolationRef: descriptor.binding.isolationRef, runtimeStatus: runtime.status,
    locked: isRuntimeLocked({ runtimeInstance: runtime }), published: isRuntimeLifecycleTruthImmutable(runtime.framework_state),
    heldSs044Family: context.exclusions.heldSs044Family || isControlledSyntheticOutcomeRuntime(runtime), parlon: context.exclusions.parlon })
}
export const buildResolvedControlledReplay = ({ context, acquisitionProfile, runId, attemptId, capturedAt }) => {
  const { descriptor, html } = assertResolvedControlledReplay(context)
  return buildControlledReplayEvidenceFromDecodedHtml({ html, descriptor, acquisitionProfile, runId, attemptId, capturedAt })
}
