import { z } from 'zod'
import { createHash } from 'node:crypto'
import { generateChecksum } from './governanceAudit/checksumService.js'
import { PUBLIC_RESEARCH_RUN_VERSION, publicResearchSelectorSchema } from './publicResearchContract.js'

const text = limit => z.string().trim().max(limit)
const id = z.string().regex(/^[a-f0-9]{24}$/)
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
const version = z.string().min(1).max(100)
const coverage = z.enum(['STANDARD', 'ENHANCED'])
const context = z.object({ companyName: text(255).min(1), marketRegion: text(255), targetOffer: text(500), notes: text(5000) }).strict()
const source = z.enum(['WEBSITE', 'SEARCH', 'REGISTRY', 'GITHUB', 'LINKEDIN', 'SOCIAL', 'NEWS', 'REVIEWS', 'INDUSTRY'])
const publicUrl = text(500).url().refine(value => {
  const url = new URL(value)
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
}, 'Use HTTP or HTTPS starting URLs without credentials.')
export const researchSettingsSchema = z.object({
  startingUrls: z.array(publicUrl).min(1).max(10).refine(values => new Set(values).size === values.length, 'Starting URLs must be distinct.'),
  legalEntity: text(255), countryCode: z.union([z.literal(''), z.string().regex(/^[A-Z]{2}$/)]),
  entityIdentifier: text(160), entityConfirmed: z.boolean(), ukSubsidiary: z.boolean(),
  sources: z.array(source).min(1).max(9).refine(values => new Set(values).size === values.length, 'Source categories must be distinct.'),
  instructions: text(2000),
}).strict().refine(value => !value.entityConfirmed || Boolean(value.legalEntity && (value.countryCode || value.ukSubsidiary)),
  'Entity confirmation requires a named entity and jurisdiction or explicit UK subsidiary.')

export const saveResearchConfigurationSchema = z.object({
  expectedUpdatedAt: z.string().datetime(), expectedStateVersion: version,
  expectedConfigurationVersion: uuid.nullable(), context, coverage, settings: researchSettingsSchema,
}).strict()

export const configurationPurpose = value => [
  `Company: ${value.companyName}`, value.marketRegion && `Market / region: ${value.marketRegion}`,
  value.targetOffer && `Product or service: ${value.targetOffer}`, value.notes && `Evidence gathering context: ${value.notes}`,
].filter(Boolean).join('\n')

const storedSchema = z.object({
  contractVersion: z.literal('public-research-configuration.v1'), configurationVersion: uuid,
  scope: z.object({ customerId: id, tenantId: id, runtimeInstanceId: id, runtimeInstanceKey: text(160).min(1) }).strict(),
  basisStateVersion: version, basisUpdatedAt: z.string().datetime(),
  contextSource: z.literal('USER_PREPARED_CONTEXT_BRIEF'), context, coverage, purpose: z.string().max(9000),
  settings: researchSettingsSchema, savedAt: z.string().datetime(), savedBy: id,
  configurationHash: z.string().regex(/^sha256:[a-f0-9]{64}$/), saveAuditId: id,
}).strict()

export const researchConfigurationHash = record => {
  const { configurationHash: _hash, saveAuditId: _audit, ...body } = record
  return `sha256:${generateChecksum(body)}`
}

export const validateStoredResearchConfiguration = (value, runtime) => {
  const parsed = storedSchema.safeParse(value)
  if (!parsed.success || Buffer.byteLength(JSON.stringify(value)) > 32768
    || value.configurationHash !== researchConfigurationHash(value)
    || value.purpose !== configurationPurpose(parsed.data.context)
    || runtime && ['customerId', 'tenantId', 'runtimeInstanceKey'].some(key => String(runtime[key]) !== value.scope[key])
    || runtime && String(runtime._id || runtime.id) !== value.scope.runtimeInstanceId) {
    throw Object.assign(new Error('Saved research configuration could not be verified.'), {
      status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'RESEARCH_CONFIGURATION_UNVERIFIED' },
    })
  }
  return parsed.data
}

// Read-only intent mapping. It is never an acquisition action or dispatch permit.
export const researchAvailability = ({ configuration, basis, editable, currency }) => {
  const reason = !editable ? 'REVISION_NOT_EDITABLE' : !configuration ? 'CONFIGURATION_NOT_RECORDED'
    : currency !== 'CURRENT_BASIS' ? 'CONFIGURATION_STALE' : 'OPERATING_APPROVAL_NOT_RECORDED'
  const categories = source.options.map(key => {
    const selected = configuration?.settings.sources.includes(key) || false
    let status = 'NOT_SELECTED', reason = 'SOURCE_NOT_SELECTED'
    if (selected) {
      status = 'GATED'; reason = 'OPERATING_APPROVAL_NOT_RECORDED'
      if (!['WEBSITE', 'SEARCH', 'REGISTRY'].includes(key)) { status = 'UNAVAILABLE'; reason = 'SOURCE_UNSUPPORTED' }
      else if (key === 'REGISTRY') {
        const entity = configuration.settings
        if (entity.countryCode && entity.countryCode !== 'GB' && !entity.ukSubsidiary) {
          status = 'NOT_APPLICABLE'; reason = 'UK_REGISTRY_NOT_APPLICABLE'
        } else if (!entity.entityConfirmed || !entity.legalEntity || !(entity.countryCode === 'GB' || entity.ukSubsidiary)) {
          reason = 'ENTITY_UNCONFIRMED'
        }
      }
    }
    return { key, selected, status, reason }
  })
  const requestMapping = configuration && editable && currency === 'CURRENT_BASIS' ? {
    contractVersion: 'public-research-request-mapping.v1',
    configurationVersion: configuration.configurationVersion, configurationHash: configuration.configurationHash,
    saveAuditId: configuration.saveAuditId, scope: configuration.scope, basis,
    contextSource: configuration.contextSource, inputs: configuration.context, purpose: configuration.purpose,
    acquisitionProfile: configuration.coverage, settings: configuration.settings,
  } : null
  return { contractVersion: 'public-research-availability.v1', canStart: false, executionEnabled: false, reason,
    configurationVersion: configuration?.configurationVersion || null, configurationHash: configuration?.configurationHash || null,
    categories, requestMapping }
}

export const researchConfigurationSelectorSchema = z.object({ configurationVersion: uuid,
  configurationHash: z.string().regex(/^sha256:[a-f0-9]{64}$/), basisStateVersion: version }).strict()
export const providerFreeSearchSelectorSchema = z.object({ fixtureId: z.literal('trilogy-clients-search.v1'),
  fixtureVersion: z.literal(1), fixtureFileSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const assertResearchDispatchPayload = (payload, actionKey) => {
  if (Object.hasOwn(payload || {}, 'publicResearch')) {
    const keys = ['publicResearch', 'researchConfiguration', 'controlledReplay', 'requestKey', 'expectedUpdatedAt',
      'acquisitionProfile', 'predecessorRunId', 'predecessorExecutionAttemptId']
    const selector = publicResearchSelectorSchema.safeParse(payload.publicResearch)
    if (!selector.success || !researchConfigurationSelectorSchema.safeParse(payload.researchConfiguration).success
      || actionKey !== 'BUILD_EVIDENCE_PACK' || !uuid.safeParse(payload.requestKey).success
      || !z.string().datetime().safeParse(payload.expectedUpdatedAt).success || Object.keys(payload).some(key => !keys.includes(key))
      || (selector.data.mode === 'OFFLINE') !== Boolean(payload.controlledReplay)
      || selector.data.mode === 'LIVE' && selector.data.releaseId !== payload.requestKey
      || Boolean(payload.predecessorRunId) !== Boolean(payload.predecessorExecutionAttemptId)
      || payload.predecessorRunId !== undefined && (!uuid.safeParse(payload.predecessorRunId).success || !uuid.safeParse(payload.predecessorExecutionAttemptId).success))
      throw Object.assign(new Error('Public research requires an explicit unmixed saved request.'), {
        status: 422, code: 'VALIDATION_ERROR', details: { reason: 'RESEARCH_DISPATCH_INVALID' } })
    return
  }
  if (!Object.hasOwn(payload || {}, 'researchConfiguration') && !Object.hasOwn(payload || {}, 'providerFreeSearch')) return
  const search = Object.hasOwn(payload || {}, 'providerFreeSearch')
  const searchKeys = ['researchConfiguration', 'providerFreeSearch', 'requestKey', 'expectedUpdatedAt', 'acquisitionProfile',
    'predecessorRunId', 'predecessorExecutionAttemptId']
  if (!researchConfigurationSelectorSchema.safeParse(payload.researchConfiguration).success
    || actionKey !== 'BUILD_EVIDENCE_PACK' || (search
      ? !providerFreeSearchSelectorSchema.safeParse(payload.providerFreeSearch).success || payload.controlledReplay !== undefined
        || Object.keys(payload).some(key => !searchKeys.includes(key))
      : !payload.controlledReplay) || !uuid.safeParse(payload.requestKey).success
    || payload.inputs !== undefined || payload.documentSources !== undefined
    || Boolean(payload.predecessorRunId) !== Boolean(payload.predecessorExecutionAttemptId)
    || payload.predecessorRunId !== undefined && (!uuid.safeParse(payload.predecessorRunId).success || !uuid.safeParse(payload.predecessorExecutionAttemptId).success)) {
    throw Object.assign(new Error('Research dispatch requires an explicit unmixed controlled fixture request.'), {
      status: 422, code: 'VALIDATION_ERROR', details: { reason: 'RESEARCH_DISPATCH_INVALID' },
    })
  }
}
export const researchConfigurationReference = record => record ? { configurationVersion: record.configurationVersion,
  configurationHash: record.configurationHash, saveAuditId: record.saveAuditId } : undefined
export const validateResearchRunConfiguration = row => {
  if (row.researchConfiguration === undefined) return undefined
  const record = validateStoredResearchConfiguration(row.researchConfiguration, { _id: row.runtimeInstanceId,
    customerId: row.customerId, tenantId: row.tenantId, runtimeInstanceKey: row.runtimeInstanceKey })
  const search = row.contractVersion === PROVIDER_FREE_SEARCH_RUN_VERSION
  const combined = row.contractVersion === PUBLIC_RESEARCH_RUN_VERSION
  const plan = combined && row.publicResearch?.plan
  if ((!search && !combined && row.contractVersion !== 'controlled-acquisition-run.v1') || row.actionKey !== 'BUILD_EVIDENCE_PACK'
    || record.coverage !== row.acquisitionProfile || record.basisStateVersion !== row.basisStateVersion
    || record.basisUpdatedAt !== new Date(row.basisUpdatedAt).toISOString()
    || !combined && (record.settings.sources.length !== 1 || record.settings.sources[0] !== (search ? 'SEARCH' : 'WEBSITE')
      || record.settings.startingUrls.length !== 1
      || !search && record.settings.startingUrls[0] !== row.controlledReplayProvenance?.binding?.fixture?.sourceUrl)
    || combined && (!plan || JSON.stringify(record.settings.sources) !== JSON.stringify(plan.selectedCategories)
      || JSON.stringify(record.settings.startingUrls) !== JSON.stringify(plan.startingUrls))) {
    throw Object.assign(new Error('Research Run configuration binding could not be verified.'), {
      status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'ACQUISITION_RECEIPT_UNVERIFIED' },
    })
  }
  return record
}

// Stored receipt validation is pure. Do not import the adapter or native owners here.
export const PROVIDER_FREE_SEARCH_RUN_VERSION = 'provider-free-search-run.v1'
export const PROVIDER_FREE_SEARCH_PLANNER_VERSION = 'provider-free-search-planner.v1'
const receiptHash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const receiptAuthoritySchema = z.object({ classification: z.literal('LOCAL_SYNTHETIC_RECEIPT_ONLY'),
  purpose: z.literal('TAVILY_DISCOVERY_RECEIPT'), authorityRef: z.literal('ss049-provider-free-search-receipt.2026-11-13.v1'),
  scope: storedSchema.shape.scope, actorUserId: id }).strict()
const storedFixtureInput = z.object({ selector: researchConfigurationSelectorSchema, settings: researchSettingsSchema,
  provider: z.literal('TAVILY_SEARCH'), approvedHostname: text(253).min(1), approvedTerms: z.array(text(80).min(1)).max(4),
  transportOutcome: z.enum(['COMPLETE', 'PARTIAL', 'TIMEOUT']), httpStatus: z.number().int().min(100).max(599).nullable(),
  responseText: z.string(), responseId: z.string().min(1).max(120), capturedAt: z.string().datetime(),
  simulatedElapsedMs: z.number().int().min(0).max(1000) }).strict()
const storedSearchReceiptSchema = z.object({ contractVersion: z.literal('provider-free-search-receipt.v1'),
  authority: receiptAuthoritySchema, input: storedFixtureInput,
  descriptor: z.unknown(), mapped: z.unknown(), adaptationStatus: z.enum(['VALID', 'INVALID_RESPONSE']),
  rawResponseHash: receiptHash, descriptorHash: receiptHash, mappedResponseHash: receiptHash, recordHash: receiptHash }).strict()
export const hashProviderFreeSearchValue = value => `sha256:${generateChecksum(value)}`
// Match the existing mapper's exact serialized-descriptor hash domain.
export const hashProviderFreeSearchDescriptor = value => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
export const providerFreeSearchRecordHash = value => {
  const { recordHash: _hash, ...body } = value
  return hashProviderFreeSearchValue(body)
}
const invalidSearchReceipt = () => { throw Object.assign(new Error('Provider-free search receipt could not be verified.'), {
  status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'PROVIDER_FREE_SEARCH_RECEIPT_UNVERIFIED' },
}) }
export const validateProviderFreeSearchReceipt = value => {
  try {
    const parsed = storedSearchReceiptSchema.parse(value), input = parsed.input
    if (Buffer.byteLength(JSON.stringify(parsed)) > 65536 || Buffer.byteLength(input.responseText, 'utf8') > 16384
      || parsed.rawResponseHash !== `sha256:${createHash('sha256').update(input.responseText).digest('hex')}`
      || parsed.recordHash !== providerFreeSearchRecordHash(parsed)
      || parsed.descriptorHash !== hashProviderFreeSearchDescriptor(parsed.descriptor)
      || parsed.mappedResponseHash !== hashProviderFreeSearchValue(parsed.mapped)
      || parsed.descriptor?.method !== 'POST' || parsed.descriptor?.url !== 'https://api.tavily.com/search'
      || parsed.descriptor?.executionEnabled !== false || parsed.descriptor?.credentialMaterial !== 'NOT_INCLUDED'
      || (input.transportOutcome === 'TIMEOUT') !== (input.httpStatus === null)
      || new URL(input.settings.startingUrls[0]).hostname !== input.approvedHostname) invalidSearchReceipt()
    if (parsed.adaptationStatus === 'INVALID_RESPONSE') {
      if (parsed.mapped !== null) invalidSearchReceipt()
    } else {
      const mapped = parsed.mapped, response = mapped?.normalized?.response, binding = mapped?.normalized?.binding
      if (!mapped?.fixtureOnly || mapped.liveExecutionEnabled !== false || !Array.isArray(mapped.normalized?.evidenceObjects)
        || mapped.normalized.evidenceObjects.length || mapped.normalized.classification !== 'DISCOVERY_ONLY'
        || mapped.fixtureReceipt?.classification !== 'SYNTHETIC_BINDING_NOT_SAVED_RUN_RECEIPT'
        || !(mapped.fixtureReceipt?.providerRequestId === null || typeof mapped.fixtureReceipt?.providerRequestId === 'string'
          && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(mapped.fixtureReceipt.providerRequestId))
        || mapped.fixtureReceipt?.runId !== null || mapped.fixtureReceipt?.executionAttemptId !== null
        || mapped.providerResponse?.bodyHash !== parsed.rawResponseHash
        || hashProviderFreeSearchDescriptor(mapped.requestDescriptor) !== parsed.descriptorHash
        || mapped.fixtureReceipt.descriptorHash !== parsed.descriptorHash || mapped.fixtureReceipt.responseBodyHash !== parsed.rawResponseHash
        || hashProviderFreeSearchValue(binding?.selector) !== hashProviderFreeSearchValue(input.selector)
        || binding?.settingsHash !== `sha256:${createHash('sha256').update(JSON.stringify(input.settings)).digest('hex')}`
        || response?.responseId !== input.responseId || response?.capturedAt !== input.capturedAt
        || response?.simulatedElapsedMs !== input.simulatedElapsedMs
        || !['SUCCESS', 'EMPTY', 'PARTIAL', 'UNAVAILABLE', 'RATE_LIMITED'].includes(response.status)
        || !Array.isArray(mapped.normalized.discoveryItems) || mapped.normalized.discoveryItems.length > 4) invalidSearchReceipt()
    }
    return parsed
  } catch { invalidSearchReceipt() }
}
export const providerFreeSearchStatus = record => record.adaptationStatus === 'INVALID_RESPONSE' ? 'FAILED'
  : record.mapped.normalized.response.status === 'PARTIAL' ? 'PARTIALLY_SUCCEEDED'
    : ['SUCCESS', 'EMPTY'].includes(record.mapped.normalized.response.status) ? 'SUCCEEDED' : 'FAILED'
export const validateProviderFreeSearchRun = row => {
  const record = validateProviderFreeSearchReceipt(row.providerFreeSearch)
  const configuration = validateResearchRunConfiguration(row), input = record.input
  if (row.contractVersion !== PROVIDER_FREE_SEARCH_RUN_VERSION || row.plannerVersion !== PROVIDER_FREE_SEARCH_PLANNER_VERSION
    || !configuration || record.authority.actorUserId !== String(row.actorUserId)
    || Object.entries(record.authority.scope).some(([key, value]) => value !== String(key === 'runtimeInstanceId' ? row.runtimeInstanceId : row[key]))
    || hashProviderFreeSearchValue(input.settings) !== hashProviderFreeSearchValue(configuration.settings)
    || input.selector.configurationVersion !== configuration.configurationVersion || input.selector.configurationHash !== configuration.configurationHash
    || input.selector.basisStateVersion !== row.basisStateVersion || row.controlledReplayProvenance !== undefined
    || row.inputs?.length !== 1 || row.inputs[0].kind !== 'SEARCH' || row.inputs[0].inputIndex !== 0
    || row.inputs[0].contentHash !== record.descriptorHash.slice(7)
    || Boolean(row.predecessorRunId) !== Boolean(row.predecessorExecutionAttemptId)) invalidSearchReceipt()
  if (!['QUEUED', 'RUNNING'].includes(row.status) && (row.status !== providerFreeSearchStatus(record)
    || row.receiptRecorded !== true || row.canonicalSaved !== false || row.outputStateVersion || row.saveAuditId
    || row.outcomes?.length !== 1 || row.outcomes[0].kind !== 'SEARCH' || row.outcomes[0].inputIndex !== 0
    || row.outcomes[0].sourceId || row.outcomes[0].contentHash || row.outcomes[0].evidenceObjectCount !== 0
    || row.outcomes[0].status !== (row.status === 'FAILED' ? 'FAILED' : 'SUCCEEDED'))) invalidSearchReceipt()
  return record
}
export const publicProviderFreeSearchReceipt = record => ({ classification: record.authority.classification,
  purpose: record.authority.purpose, authorityRef: record.authority.authorityRef, provider: 'TAVILY_SEARCH',
  recordHash: record.recordHash, rawResponseHash: record.rawResponseHash, descriptorHash: record.descriptorHash,
  mappedResponseHash: record.mappedResponseHash, adaptationStatus: record.adaptationStatus,
  providerRequestId: record.mapped?.fixtureReceipt?.providerRequestId || null,
  transportOutcome: record.input.transportOutcome, httpStatus: record.input.httpStatus,
  configuration: { ...record.input.selector }, discoveryItemCount: record.mapped?.normalized?.discoveryItems?.length || 0,
  liveExecutionEnabled: false, evidenceObjectCount: 0 })
export const providerFreeSearchAuditBinding = record => ({ contractVersion: record.contractVersion,
  recordHash: record.recordHash, rawResponseHash: record.rawResponseHash, descriptorHash: record.descriptorHash,
  mappedResponseHash: record.mappedResponseHash, authorityRef: record.authority.authorityRef })
