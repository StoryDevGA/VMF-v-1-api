import { performance } from 'node:perf_hooks'
import { sourceEvidenceHash } from './sourceEvidenceContract.js'
import { buildPublicResearchPlan, publicResearchFailure, publicResearchHash, selectPublicResearchWebsites } from './publicResearchContract.js'
import { readPublicResearchOperatingPolicy, resolvePublicResearchCredential } from '../config/publicResearchProvider.js'
import { prepareTavilySearchRequest, prepareCompaniesHouseProfileRequest, validatePublicResearchSourceUrl,
  adaptTavilySearchTransportResponse, adaptCompaniesHouseProfileTransportResponse } from './publicResearchResponseContract.js'
import { executeTavilySearchTransport, executeCompaniesHouseProfileTransport } from './publicResearchTransportService.js'
import { acquireWebsiteDiscoveryEvidence } from './discoveryIntelligenceService.js'
import { assertPublicResearchFixtureExecution, buildPublicResearchFixturePolicy, buildResolvedControlledReplay,
  PUBLIC_RESEARCH_FIXTURE, loadPublicResearchFixture, verifyPublicResearchFixtureReadScope,
  assertControlledReplayCurrent, verifyControlledReplayCurrentAuthority } from './controlledReplayAcquisitionService.js'

const selectorFor = configuration => ({ configurationVersion: configuration.configurationVersion,
  configurationHash: configuration.configurationHash, basisStateVersion: configuration.basisStateVersion })
export const resolvePublicResearchExecution = async (args, dependencies = {}) => {
  const { payload, configuration, runtimeInstance, actorUserId, controlledContext, session } = args
  if (!configuration || publicResearchHash(payload.researchConfiguration) !== publicResearchHash(selectorFor(configuration))
    || payload.expectedUpdatedAt !== configuration.basisUpdatedAt
    || payload.acquisitionProfile !== undefined && payload.acquisitionProfile !== configuration.coverage)
    publicResearchFailure('RESEARCH_CONFIGURATION_STALE')
  const mode = payload.publicResearch.mode
  if (mode === 'LIVE' && configuration.settings.sources.includes('WEBSITE')
    && ['companyName', 'marketRegion', 'targetOffer'].some(key => !configuration.context?.[key]?.trim()))
    publicResearchFailure('RESEARCH_CONTEXT_INCOMPLETE')
  let policy, asset
  if (mode === 'OFFLINE') {
    const { controlledBindingId: _binding, ...identity } = PUBLIC_RESEARCH_FIXTURE
    if (publicResearchHash(payload.publicResearch.fixture) !== publicResearchHash(identity)) publicResearchFailure('PUBLIC_RESEARCH_FIXTURE_UNVERIFIED')
    asset = await assertPublicResearchFixtureExecution(args)
    policy = buildPublicResearchFixturePolicy({ asset, configuration, runtimeInstance, actorUserId, requestKey: payload.requestKey })
  } else {
    policy = (dependencies.readPolicy || readPublicResearchOperatingPolicy)()
    if (!policy || payload.publicResearch.releaseId !== payload.requestKey) publicResearchFailure('OPERATING_APPROVAL_NOT_RECORDED')
  }
  const plan = buildPublicResearchPlan({ policy, configuration, runtime: runtimeInstance, actorUserId,
    requestKey: payload.requestKey, mode, ...(mode === 'OFFLINE' ? { fixture: payload.publicResearch.fixture } : {}) })
  for (const url of [...plan.startingUrls, ...plan.approvedDiscoveryUrls]) validatePublicResearchSourceUrl(url)
  if (!plan.selectedCategories.includes('SEARCH') && !plan.selectedCategories.includes('WEBSITE') && !plan.registry.applicable)
    publicResearchFailure('UK_REGISTRY_NOT_APPLICABLE')
  return { plan, asset, controlledContext, configuration,
    resolveCredential: dependencies.resolveCredential || resolvePublicResearchCredential,
    send: dependencies.send || ((url, options) => globalThis.fetch(url, options)),
    acquireWebsite: dependencies.acquireWebsite || acquireWebsiteDiscoveryEvidence,
    assertCurrent: async (runtime, currentSession) => {
      if (Date.parse(plan.expiresAt) <= Date.now()) publicResearchFailure('PUBLIC_RESEARCH_POLICY_EXPIRED')
      if (mode === 'OFFLINE') {
        await loadPublicResearchFixture()
        await verifyPublicResearchFixtureReadScope({ runtimeInstance: runtime, actorUserId, session: currentSession })
        assertControlledReplayCurrent(controlledContext, runtime, payload)
        await verifyControlledReplayCurrentAuthority(controlledContext, runtime, currentSession)
      } else {
        const current = (dependencies.readPolicy || readPublicResearchOperatingPolicy)()
        if (!current || publicResearchHash(current) !== plan.policyHash) publicResearchFailure('PUBLIC_RESEARCH_POLICY_CHANGED')
      }
    }, session }
}

const responseReceipt = (response, elapsedMs) => ({ httpStatus: response.observedHttpStatus ?? response.httpStatus ?? null,
  responseText: response.responseText ?? null,
  responseTextHash: response.responseText === null || response.responseText === undefined ? null
    : response.responseTextHash || sourceEvidenceHash(response.responseText),
  bytesRead: response.bytesRead || 0, elapsedMs,
  transportOutcome: response.transportOutcome || 'COMPLETE',
  bodyComplete: response.bodyComplete ?? response.transportOutcome === 'COMPLETE' })
const safeReasons = new Set(['PUBLIC_RESEARCH_TRANSPORT_INVALID', 'PUBLIC_RESEARCH_CREDENTIAL_ECHO', 'PUBLIC_RESEARCH_RESPONSE_TOO_LARGE',
  'PUBLIC_RESEARCH_LIMIT_EXCEEDED', 'PUBLIC_RESEARCH_CREDENTIAL_UNAVAILABLE', 'PUBLIC_RESEARCH_AUTHORIZATION_REQUIRED'])
const safeReason = value => safeReasons.has(value) ? value : 'PUBLIC_RESEARCH_OPERATION_FAILED'

// The existing Run owner supplies committed reserve/complete callbacks. This
// worker owns serial IO and limits; it never opens a database transaction.
export const executePublicResearchOperations = async ({ context, execution, reserve, complete, assertActive }) => {
  const plan = execution.plan, started = performance.now(), captures = new Map()
  const request = { selector: selectorFor(execution.configuration), settings: execution.configuration.settings }
  let discovery = [], stopped = false
  const remaining = () => Math.floor(Math.min(plan.limits.maxElapsedMs - (performance.now() - started),
    Date.parse(plan.expiresAt) - Date.now()))
  context.assertPublicResearchDeadline = () => {
    if (remaining() <= 0) publicResearchFailure('PUBLIC_RESEARCH_LIMIT_EXCEEDED')
  }
  const recordedBytes = () => context.row.publicResearch.operations.reduce((sum, operation) => sum + (operation.receipt?.bytesRead || 0), 0)
  const perform = async ({ category, inputIndex = 0, descriptor, run }) => {
    if (stopped) return null
    await assertActive()
    const time = remaining(), bytes = plan.limits.maxTotalBytes - recordedBytes()
    if (time <= 0 || bytes <= 0) { stopped = true; publicResearchFailure('PUBLIC_RESEARCH_LIMIT_EXCEEDED') }
    const operationName = category === 'SEARCH' ? 'TAVILY_SEARCH' : 'COMPANIES_HOUSE_PROFILE'
    const options = { mode: plan.mode, send: execution.send }
    if (plan.mode === 'LIVE' && category !== 'WEBSITE') Object.assign(options, {
      credential: execution.resolveCredential(operationName), authorization: { operation: operationName,
        approvalRef: plan.approvalRef, releaseRef: plan.releaseId, credentialOwner: plan.credentialOwner,
        spendOwner: plan.spendOwner, expiresAt: plan.expiresAt } })
    const operation = await reserve({ category, inputIndex, requestDescriptor: descriptor })
    const dispatchTime = remaining(), dispatchBytes = plan.limits.maxTotalBytes - recordedBytes()
    if (dispatchTime <= 0 || dispatchBytes <= 0) {
      stopped = true
      const reason = Date.parse(plan.expiresAt) <= Date.now() ? 'PUBLIC_RESEARCH_POLICY_EXPIRED' : 'PUBLIC_RESEARCH_LIMIT_EXCEEDED'
      await complete(operation.ordinal, { outcome: 'FAILED', failureReason: reason, receipt: null })
      publicResearchFailure(reason)
    }
    options.limits = { maxResponseBytes: Math.min(plan.limits.maxJsonBytes, dispatchBytes),
      timeoutMs: Math.min(plan.mode === 'OFFLINE' ? 1000 : 60000, plan.limits.maxRequestMs, dispatchTime) }
    const begin = performance.now()
    let result, receipt, mapping, capture, outcome, failureReason
    try {
      result = await run(options, { maxResponseBytes: Math.min(plan.limits.maxPageBytes, dispatchBytes),
        timeoutMs: Math.min(6000, plan.limits.maxRequestMs, dispatchTime) })
      const elapsed = Math.max(0, Math.ceil(performance.now() - begin))
      receipt = responseReceipt(result.transport || result, elapsed)
      mapping = result.mapping
      capture = result.capture
      outcome = result.outcome
      failureReason = result.failureReason
      if (recordedBytes() + receipt.bytesRead > plan.limits.maxTotalBytes || remaining() <= 0) {
        outcome = 'PARTIAL'; failureReason = 'PUBLIC_RESEARCH_LIMIT_EXCEEDED'
      }
    } catch (error) {
      receipt = error?.transportReceipt ? responseReceipt(error.transportReceipt, Math.max(0, Math.ceil(performance.now() - begin))) : null
      failureReason = safeReason(error?.details?.reason)
      outcome = receipt?.transportOutcome === 'LIMIT_EXCEEDED' ? 'FAILED' : 'UNKNOWN'
    }
    await complete(operation.ordinal, { outcome, ...(failureReason ? { failureReason } : {}), receipt,
      ...(mapping ? { mapping } : {}), ...(capture ? { capture } : {}) })
    if (!['SUCCEEDED', 'EMPTY'].includes(outcome)) stopped = true
    return result
  }
  if (plan.selectedCategories.includes('SEARCH')) {
    const searchRequest = { ...request, approvedHostname: plan.hostname, approvedTerms: plan.approvedTerms }
    const prepared = prepareTavilySearchRequest(searchRequest)
    await perform({ category: 'SEARCH', descriptor: { method: 'POST', url: prepared.descriptor.url, body: prepared.body }, run: async options => {
      const transport = await executeTavilySearchTransport(searchRequest, { ...options,
        ...(plan.mode === 'OFFLINE' ? { send: async () => new Response(JSON.stringify(execution.asset.search)) } : {}) })
      let mapping
      try { mapping = adaptTavilySearchTransportResponse({ request: searchRequest, transport }) }
      catch { return { transport, outcome: 'FAILED', failureReason: 'PUBLIC_RESEARCH_RESPONSE_INVALID' } }
      discovery = mapping.items
      return { transport, mapping, outcome: mapping.status === 'SUCCESS' ? 'SUCCEEDED' : mapping.status === 'EMPTY' ? 'EMPTY'
        : transport.transportOutcome === 'TIMEOUT' ? 'UNKNOWN' : mapping.status === 'PARTIAL' ? 'PARTIAL' : 'FAILED',
      ...(!['SUCCESS', 'EMPTY'].includes(mapping.status) ? { failureReason: mapping.status === 'RATE_LIMITED' ? 'PUBLIC_RESEARCH_RATE_LIMITED' : 'PUBLIC_RESEARCH_SEARCH_UNAVAILABLE' } : {}) }
    } })
  }
  const selected = selectPublicResearchWebsites(plan, discovery)
  if (!stopped) for (let index = 0; index < selected.urls.length; index++) {
    const url = selected.urls[index]
    validatePublicResearchSourceUrl(url)
    await perform({ category: 'WEBSITE', inputIndex: index, descriptor: { method: 'GET', url }, run: async (_options, limits) => {
      const at = new Date().toISOString()
      let material, transport
      if (plan.mode === 'OFFLINE') {
        material = buildResolvedControlledReplay({ context: execution.controlledContext, acquisitionProfile: execution.configuration.coverage,
          runId: context.runId, attemptId: context.executionAttemptId, capturedAt: at })
        const html = execution.controlledContext.html
        transport = { httpStatus: null, transportOutcome: 'COMPLETE', bodyComplete: true, responseText: html,
          responseTextHash: sourceEvidenceHash(html), bytesRead: Buffer.byteLength(html) }
        if (transport.bytesRead > limits.maxResponseBytes) publicResearchFailure('PUBLIC_RESEARCH_LIMIT_EXCEEDED')
      } else {
        const acquired = await execution.acquireWebsite({ websiteUrl: url, acquiredAt: at, acquisitionProfile: execution.configuration.coverage,
          recordSourceCapture: true, researchTransport: limits })
        transport = acquired.transportReceipt
        const { transportReceipt: _receipt, ...original } = acquired
        material = original
      }
      captures.set(url, material)
      return { transport, outcome: selected.limitReached && index === selected.urls.length - 1 ? 'PARTIAL' : 'SUCCEEDED',
        ...(selected.limitReached && index === selected.urls.length - 1 ? { failureReason: 'PUBLIC_RESEARCH_PAGE_LIMIT_REACHED' } : {}),
        capture: { sourceId: material.source.sourceId, contentHash: material.source.sourceCapture.originalContentHash,
          evidenceObjectCount: material.evidenceObjects.length } }
    } })
    if (stopped) break
  }
  if (!stopped && plan.registry.applicable) {
    const { descriptor } = prepareCompaniesHouseProfileRequest(request)
    await perform({ category: 'REGISTRY', descriptor: { method: 'GET', url: descriptor.url }, run: async options => {
      const transport = await executeCompaniesHouseProfileTransport(request, { ...options,
        ...(plan.mode === 'OFFLINE' ? { send: async () => new Response(JSON.stringify(execution.asset.registry)) } : {}) })
      let mapping
      try { mapping = adaptCompaniesHouseProfileTransportResponse({ request, transport }) }
      catch { return { transport, outcome: 'FAILED', failureReason: 'PUBLIC_RESEARCH_RESPONSE_INVALID' } }
      return { transport, mapping, outcome: mapping.status === 'SUCCESS' ? 'SUCCEEDED' : mapping.status === 'EMPTY' ? 'EMPTY'
        : transport.transportOutcome === 'TIMEOUT' ? 'UNKNOWN' : mapping.status === 'PARTIAL' ? 'PARTIAL' : 'FAILED',
      ...(!['SUCCESS', 'EMPTY'].includes(mapping.status) ? { failureReason: 'PUBLIC_RESEARCH_REGISTRY_UNAVAILABLE' } : {}) }
    } })
  }
  await assertActive()
  if (remaining() <= 0) publicResearchFailure('PUBLIC_RESEARCH_LIMIT_EXCEEDED')
  context.publicResearchCaptures = captures
  context.publicResearchExecutionElapsedMs = Math.max(0, Math.ceil(performance.now() - started))
  context.publicResearchMaySave = captures.size > 0 && (!stopped || plan.partialSave === 'PRESERVE_PENDING')
  return { captures, stopped }
}
