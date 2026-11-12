import { z } from 'zod'
import { generateChecksum } from './governanceAudit/checksumService.js'

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
export const assertResearchDispatchPayload = (payload, actionKey) => {
  if (!Object.hasOwn(payload || {}, 'researchConfiguration')) return
  if (!researchConfigurationSelectorSchema.safeParse(payload.researchConfiguration).success
    || actionKey !== 'BUILD_EVIDENCE_PACK' || !payload.controlledReplay || !uuid.safeParse(payload.requestKey).success
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
  if (row.contractVersion !== 'controlled-acquisition-run.v1' || row.actionKey !== 'BUILD_EVIDENCE_PACK'
    || record.coverage !== row.acquisitionProfile || record.basisStateVersion !== row.basisStateVersion
    || record.basisUpdatedAt !== new Date(row.basisUpdatedAt).toISOString()
    || record.settings.sources.length !== 1 || record.settings.sources[0] !== 'WEBSITE'
    || record.settings.startingUrls.length !== 1 || record.settings.startingUrls[0] !== row.controlledReplayProvenance?.binding?.fixture?.sourceUrl) {
    throw Object.assign(new Error('Research Run configuration binding could not be verified.'), {
      status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'ACQUISITION_RECEIPT_UNVERIFIED' },
    })
  }
  return record
}
