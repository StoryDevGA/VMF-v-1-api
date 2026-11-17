import { z } from 'zod'
import { generateChecksum } from './governanceAudit/checksumService.js'
import { sourceEvidenceHash } from './sourceEvidenceContract.js'

export const PUBLIC_RESEARCH_RUN_VERSION = 'public-research-run.v1'
export const PUBLIC_RESEARCH_PLANNER_VERSION = 'public-research-planner.v1'
export const PUBLIC_RESEARCH_FIXTURE_ID = 'controlled-public-research.v1'
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
const id = z.string().regex(/^[a-f0-9]{24}$/)
const text = z.string().trim().min(1).max(180)
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const fixtureIdentitySchema = z.object({ fixtureId: z.literal(PUBLIC_RESEARCH_FIXTURE_ID), fixtureVersion: z.literal(1),
  fixtureFileSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const date = z.string().datetime()
const stateVersion = z.string().refine(value => value.startsWith('rsv2:') && uuid.safeParse(value.slice(5)).success)
const url = z.string().max(500).url().refine(value => {
  const parsed = new URL(value)
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash && (!parsed.port || parsed.port === '443')
})
const urls = max => z.array(url).max(max).refine(items => new Set(items).size === items.length)
const terms = z.array(z.string().min(1).max(80).regex(/^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u)).max(4)
const reference = z.object({ url, version: text, sha256: hash }).strict()
const binding = z.object({ customerId: id, tenantId: id, runtimeInstanceId: id, runtimeInstanceKey: text,
  actorUserId: id, configurationVersion: uuid, configurationHash: hash,
  basisStateVersion: stateVersion, basisUpdatedAt: date }).strict()
export const publicResearchLimitsSchema = z.object({ maxSearchRequests: z.number().int().min(0).max(1),
  maxRegistryRequests: z.number().int().min(0).max(1), maxPages: z.number().int().min(0).max(3),
  maxPageBytes: z.number().int().min(1).max(320000), maxJsonBytes: z.number().int().min(1).max(16384),
  maxTotalBytes: z.number().int().min(1).max(1048576), maxElapsedMs: z.number().int().min(1).max(600000),
  maxRequestMs: z.number().int().min(1).max(60000), maxCostMicros: z.number().int().min(0).max(50000),
  searchRequestCostMicros: z.number().int().min(0).max(50000), registryRequestCostMicros: z.number().int().min(0).max(50000),
  concurrency: z.literal(1), retries: z.literal(0), redirects: z.literal(0), modelTokens: z.literal(0) }).strict()
export const publicResearchOperatingPolicySchema = z.object({ contractVersion: z.literal('public-research-operating-policy.v1'),
  environment: z.literal('DEVELOPMENT_TEST'), releaseId: uuid, expiresAt: date, binding,
  approvalRef: text, licensingRef: text, retentionRef: text, disclosureRef: text, processingRegion: text,
  credentialOwner: text, spendOwner: text, references: z.array(reference).min(1).max(8),
  approvedStartingUrls: urls(3), approvedDiscoveryUrls: urls(3), approvedTerms: terms,
  company: z.object({ companyNumber: z.string().regex(/^[A-Za-z0-9]{1,160}$/), legalName: z.string().min(1).max(255),
    jurisdiction: z.literal('GB') }).strict().optional(),
  partialSave: z.enum(['NONE', 'PRESERVE_PENDING']), limits: publicResearchLimitsSchema }).strict()
export const publicResearchHash = value => `sha256:${generateChecksum(value)}`
const policyFields = publicResearchOperatingPolicySchema.shape
const planSchema = z.object({ contractVersion: z.literal(PUBLIC_RESEARCH_PLANNER_VERSION), mode: z.enum(['OFFLINE', 'LIVE']),
  binding, releaseId: uuid, expiresAt: date, policyHash: hash, approvalRef: policyFields.approvalRef,
  licensingRef: policyFields.licensingRef, retentionRef: policyFields.retentionRef, disclosureRef: policyFields.disclosureRef,
  processingRegion: policyFields.processingRegion, credentialOwner: policyFields.credentialOwner, spendOwner: policyFields.spendOwner,
  references: policyFields.references, selectedCategories: z.array(z.enum(['SEARCH', 'REGISTRY', 'WEBSITE'])).min(1).max(3)
    .refine(items => new Set(items).size === items.length), startingUrls: urls(3).min(1), approvedDiscoveryUrls: urls(3),
  approvedTerms: terms, hostname: z.string().min(1).max(253), registry: z.object({ selected: z.boolean(), applicable: z.boolean(),
    reason: z.union([z.literal('UK_REGISTRY_NOT_APPLICABLE'), z.null()]), company: policyFields.company }).strict(),
  partialSave: policyFields.partialSave, limits: publicResearchLimitsSchema, fixture: fixtureIdentitySchema.optional(), planHash: hash }).strict()
export const publicResearchFailure = reason => { throw Object.assign(new Error('Public research is unavailable for this request.'), {
  status: 409, code: 'CONFLICT', details: { reason },
}) }
const same = (left, right) => publicResearchHash(left) === publicResearchHash(right)
export const publicResearchSelectorSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('OFFLINE'), fixture: fixtureIdentitySchema }).strict(),
  z.object({ mode: z.literal('LIVE'), releaseId: uuid }).strict(),
])

// A policy is privileged server configuration, not a client assertion or proof
// that the referenced human decisions occurred. No configured default enables it.
export const buildPublicResearchPlan = ({ policy: value, configuration, runtime, actorUserId, requestKey, mode, fixture, now = Date.now() }) => {
  const parsed = publicResearchOperatingPolicySchema.safeParse(value)
  if (!parsed.success || !['OFFLINE', 'LIVE'].includes(mode)) publicResearchFailure('PUBLIC_RESEARCH_POLICY_UNAVAILABLE')
  const policy = parsed.data, bound = policy.binding
  if (Date.parse(policy.expiresAt) <= now || requestKey !== policy.releaseId
    || !configuration || String(actorUserId) !== bound.actorUserId
    || ['customerId', 'tenantId', 'runtimeInstanceKey'].some(key => String(runtime[key]) !== bound[key])
    || String(runtime._id || runtime.id) !== bound.runtimeInstanceId
    || configuration.configurationVersion !== bound.configurationVersion || configuration.configurationHash !== bound.configurationHash
    || configuration.basisStateVersion !== bound.basisStateVersion || configuration.basisUpdatedAt !== bound.basisUpdatedAt
    || runtime.stateVersion !== bound.basisStateVersion || new Date(runtime.updatedAt).toISOString() !== bound.basisUpdatedAt)
    publicResearchFailure('PUBLIC_RESEARCH_POLICY_BINDING_MISMATCH')
  const settings = configuration.settings
  if (!Array.isArray(settings?.sources) || settings.sources.some(key => !['WEBSITE', 'SEARCH', 'REGISTRY'].includes(key))
    || !settings.sources.length || !Array.isArray(settings.startingUrls) || !settings.startingUrls.length
    || !same(settings.startingUrls, policy.approvedStartingUrls)) publicResearchFailure('PUBLIC_RESEARCH_TARGET_UNAPPROVED')
  const requested = new Set(settings.sources), limits = policy.limits
  if (requested.has('WEBSITE') && settings.startingUrls.length > limits.maxPages
    || requested.has('SEARCH') && (limits.maxSearchRequests !== 1 || limits.searchRequestCostMicros > limits.maxCostMicros))
    publicResearchFailure('PUBLIC_RESEARCH_LIMIT_EXCEEDED')
  const host = new URL(settings.startingUrls[0]).hostname
  if (policy.approvedDiscoveryUrls.some(value => new URL(value).hostname !== host)) publicResearchFailure('PUBLIC_RESEARCH_TARGET_UNAPPROVED')
  const registryApplicable = requested.has('REGISTRY') && (settings.countryCode === 'GB' || settings.ukSubsidiary)
  if (registryApplicable && (!settings.entityConfirmed || !settings.legalEntity || !policy.company
    || settings.entityIdentifier !== policy.company.companyNumber || settings.legalEntity !== policy.company.legalName))
    publicResearchFailure('PUBLIC_RESEARCH_ENTITY_UNCONFIRMED')
  if (requested.has('REGISTRY') && !registryApplicable && !settings.countryCode) publicResearchFailure('PUBLIC_RESEARCH_ENTITY_UNCONFIRMED')
  if (registryApplicable && limits.maxRegistryRequests !== 1) publicResearchFailure('PUBLIC_RESEARCH_LIMIT_EXCEEDED')
  const reservedCostMicros = (requested.has('SEARCH') ? limits.searchRequestCostMicros : 0)
    + (registryApplicable ? limits.registryRequestCostMicros : 0)
  if (reservedCostMicros > limits.maxCostMicros) publicResearchFailure('PUBLIC_RESEARCH_LIMIT_EXCEEDED')
  const plan = { contractVersion: PUBLIC_RESEARCH_PLANNER_VERSION, mode, binding: bound, releaseId: policy.releaseId,
    expiresAt: policy.expiresAt, policyHash: publicResearchHash(policy), approvalRef: policy.approvalRef,
    licensingRef: policy.licensingRef, retentionRef: policy.retentionRef, disclosureRef: policy.disclosureRef,
    processingRegion: policy.processingRegion, credentialOwner: policy.credentialOwner, spendOwner: policy.spendOwner,
    references: policy.references, selectedCategories: [...settings.sources], startingUrls: [...settings.startingUrls],
    approvedDiscoveryUrls: policy.approvedDiscoveryUrls, approvedTerms: policy.approvedTerms, hostname: host,
    registry: { selected: requested.has('REGISTRY'), applicable: registryApplicable,
      reason: requested.has('REGISTRY') && !registryApplicable ? 'UK_REGISTRY_NOT_APPLICABLE' : null,
      ...(registryApplicable ? { company: policy.company } : {}) }, partialSave: policy.partialSave, limits }
  if (fixture !== undefined) {
    if (mode !== 'OFFLINE' || !fixtureIdentitySchema.safeParse(fixture).success) publicResearchFailure('PUBLIC_RESEARCH_TARGET_UNAPPROVED')
    plan.fixture = fixture
  }
  return { ...plan, planHash: publicResearchHash(plan) }
}

export const selectPublicResearchWebsites = (plan, discoveryItems = []) => {
  if (!plan.selectedCategories.includes('WEBSITE')) return { urls: [], excludedDiscoveryCount: discoveryItems.length, limitReached: false }
  const allowed = new Set(plan.approvedDiscoveryUrls), selected = [...plan.startingUrls]
  let limitReached = false
  for (const item of discoveryItems) {
    if (!allowed.has(item.url) || new URL(item.url).hostname !== plan.hostname || selected.includes(item.url)) continue
    if (selected.length >= plan.limits.maxPages) { limitReached = true; continue }
    selected.push(item.url)
  }
  return { urls: selected, excludedDiscoveryCount: discoveryItems.filter(item => !selected.includes(item.url)).length, limitReached }
}

export const validatePublicResearchPlan = plan => {
  if (!planSchema.safeParse(plan).success)
    publicResearchFailure('PUBLIC_RESEARCH_PLAN_UNVERIFIED')
  const { planHash, ...body } = plan
  if (!hash.safeParse(planHash).success || planHash !== publicResearchHash(body)
    || !binding.safeParse(plan.binding).success || !publicResearchLimitsSchema.safeParse(plan.limits).success
    || !uuid.safeParse(plan.releaseId).success || !date.safeParse(plan.expiresAt).success
    || !urls(3).safeParse(plan.startingUrls).success || !urls(3).safeParse(plan.approvedDiscoveryUrls).success
    || !terms.safeParse(plan.approvedTerms).success) publicResearchFailure('PUBLIC_RESEARCH_PLAN_UNVERIFIED')
  return plan
}

const descriptor = z.object({ method: z.enum(['GET', 'POST']), url,
  body: z.record(z.string(), z.unknown()).optional() }).strict()
const receipt = z.object({ httpStatus: z.number().int().min(100).max(599).nullable(),
  responseText: z.string().max(320000).nullable(), responseTextHash: hash.nullable(), bytesRead: z.number().int().nonnegative().safe(),
  elapsedMs: z.number().int().nonnegative().safe(), transportOutcome: z.enum(['COMPLETE', 'TIMEOUT', 'FAILED', 'LIMIT_EXCEEDED']),
  bodyComplete: z.boolean() }).strict()
const operationSchema = z.object({ ordinal: z.number().int().min(0).max(4), operationId: hash,
  category: z.enum(['SEARCH', 'WEBSITE', 'REGISTRY']), inputIndex: z.number().int().min(0).max(2),
  requestDescriptor: descriptor, requestHash: hash, reservedCostMicros: z.number().int().nonnegative().max(50000),
  phase: z.enum(['DISPATCHING', 'RECORDED']), startedAt: date, completedAt: date.optional(),
  outcome: z.enum(['SUCCEEDED', 'EMPTY', 'FAILED', 'PARTIAL', 'UNKNOWN']).optional(),
  failureReason: z.string().regex(/^[A-Z0-9_]{1,80}$/).optional(), receipt: receipt.nullable(),
  mapping: z.unknown().optional(), capture: z.object({ sourceId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
    contentHash: hash, evidenceObjectCount: z.number().int().positive().max(100) }).strict().optional(),
}).strict()
const stateSchema = z.object({ plan: planSchema, operations: z.array(operationSchema).max(5),
  ledgerSequence: z.number().int().min(0).max(10), previousLedgerHash: hash.nullable(), ledgerHash: hash,
  ledgerAuditId: id.nullable(), ledgerAuditSignatureVersion: z.number().int().min(1).max(3).nullable() }).strict()
export const publicResearchLedgerHash = state => publicResearchHash({ sequence: state.ledgerSequence,
  previousHash: state.previousLedgerHash, operations: state.operations })
export const initialPublicResearchState = plan => {
  validatePublicResearchPlan(plan)
  const state = { plan, operations: [], ledgerSequence: 0, previousLedgerHash: null,
    ledgerAuditId: null, ledgerAuditSignatureVersion: null }
  return { ...state, ledgerHash: publicResearchLedgerHash(state) }
}
export const publicResearchOperationId = ({ runId, executionAttemptId }, operation) => publicResearchHash({
  runId, executionAttemptId, ordinal: operation.ordinal, category: operation.category,
  inputIndex: operation.inputIndex, requestHash: operation.requestHash })
export const publicResearchInputDescriptors = (plan, controlledDescriptor) => {
  const inputs = []
  if (plan.selectedCategories.includes('SEARCH')) inputs.push({ kind: 'SEARCH', inputIndex: 0,
    contentHash: publicResearchHash({ hostname: plan.hostname, terms: plan.approvedTerms }).slice(7) })
  if (plan.selectedCategories.includes('WEBSITE')) {
    if (plan.mode === 'OFFLINE') inputs.push({ kind: 'CONTROLLED', inputIndex: 0,
      contentHash: controlledDescriptor?.binding?.fixture?.htmlSha256 })
    else for (let inputIndex = 0; inputIndex < plan.limits.maxPages; inputIndex++) inputs.push({ kind: 'WEBSITE', inputIndex,
      contentHash: publicResearchHash({ planHash: plan.planHash, inputIndex, target: plan.startingUrls[inputIndex] || 'APPROVED_DISCOVERY_SLOT' }).slice(7) })
  }
  if (plan.registry.applicable) inputs.push({ kind: 'REGISTRY', inputIndex: 0,
    contentHash: publicResearchHash(plan.registry.company).slice(7) })
  return inputs
}
export const validatePublicResearchState = (value, row) => {
  if (!stateSchema.safeParse(value).success) publicResearchFailure('PUBLIC_RESEARCH_RECEIPT_UNVERIFIED')
  const state = value, plan = validatePublicResearchPlan(state.plan), operations = state.operations
  if (state.ledgerHash !== publicResearchLedgerHash(state)
    || state.ledgerSequence !== operations.reduce((count, operation) => count + (operation.phase === 'RECORDED' ? 2 : 1), 0)
    || (state.ledgerSequence === 0) !== (state.previousLedgerHash === null && state.ledgerAuditId === null && state.ledgerAuditSignatureVersion === null)
    || state.ledgerSequence > 0 && (!state.previousLedgerHash || !state.ledgerAuditId || !state.ledgerAuditSignatureVersion)
    || operations.some((operation, index) => operation.ordinal !== index
      || operation.requestHash !== publicResearchHash(operation.requestDescriptor)
      || operation.phase === 'DISPATCHING' && (index !== operations.length - 1 || operation.completedAt || operation.outcome || operation.receipt !== null || operation.capture)
      || operation.phase === 'RECORDED' && (!operation.completedAt || !operation.outcome)
      || operation.receipt && ((operation.receipt.responseText === null ? operation.receipt.responseTextHash !== null
        : sourceEvidenceHash(operation.receipt.responseText) !== operation.receipt.responseTextHash)
        || operation.receipt.bodyComplete && operation.receipt.transportOutcome !== 'COMPLETE')
      || index < operations.length - 1 && operation.outcome && !['SUCCEEDED', 'EMPTY'].includes(operation.outcome)))
    publicResearchFailure('PUBLIC_RESEARCH_RECEIPT_UNVERIFIED')
  const count = category => operations.filter(operation => operation.category === category).length
  if (count('SEARCH') > plan.limits.maxSearchRequests || count('REGISTRY') > plan.limits.maxRegistryRequests
    || count('WEBSITE') > plan.limits.maxPages
    || operations.reduce((sum, operation) => sum + operation.reservedCostMicros, 0) > plan.limits.maxCostMicros)
    publicResearchFailure('PUBLIC_RESEARCH_RECEIPT_UNVERIFIED')
  for (const operation of operations) {
    const request = operation.requestDescriptor
    if (!plan.selectedCategories.includes(operation.category)
      || operation.category === 'SEARCH' && (operation.inputIndex !== 0 || request.url !== 'https://api.tavily.com/search' || request.method !== 'POST'
        || operation.reservedCostMicros !== plan.limits.searchRequestCostMicros)
      || operation.category === 'REGISTRY' && (!plan.registry.applicable || operation.inputIndex !== 0 || request.method !== 'GET'
        || request.url !== 'https://api.company-information.service.gov.uk/company/' + plan.registry.company.companyNumber
        || operation.reservedCostMicros !== plan.limits.registryRequestCostMicros)
      || operation.category === 'WEBSITE' && (request.method !== 'GET' || request.body !== undefined || operation.reservedCostMicros !== 0
        || ![...plan.startingUrls, ...plan.approvedDiscoveryUrls].includes(request.url))
      || row && operation.operationId !== publicResearchOperationId(row, operation)) publicResearchFailure('PUBLIC_RESEARCH_RECEIPT_UNVERIFIED')
  }
  if (row) {
    if (row.contractVersion !== PUBLIC_RESEARCH_RUN_VERSION || row.plannerVersion !== PUBLIC_RESEARCH_PLANNER_VERSION
      || row.requestKey !== plan.releaseId || row.actorUserId.toString() !== plan.binding.actorUserId
      || ['customerId', 'tenantId', 'runtimeInstanceKey'].some(key => String(row[key]) !== plan.binding[key])
      || String(row.runtimeInstanceId) !== plan.binding.runtimeInstanceId || row.basisStateVersion !== plan.binding.basisStateVersion
      || new Date(row.basisUpdatedAt).toISOString() !== plan.binding.basisUpdatedAt
      || row.researchConfiguration?.configurationVersion !== plan.binding.configurationVersion
      || row.researchConfiguration?.configurationHash !== plan.binding.configurationHash
      || !same(row.inputs, publicResearchInputDescriptors(plan, row.controlledReplayProvenance))
      || plan.mode === 'OFFLINE' && (!row.controlledReplayProvenance || !plan.fixture)
      || plan.mode === 'LIVE' && (row.controlledReplayProvenance !== undefined || plan.fixture !== undefined))
      publicResearchFailure('PUBLIC_RESEARCH_RECEIPT_UNVERIFIED')
  }
  return state
}

export const buildPublicResearchOutcomes = (row, canonicalSaved = false) => row.inputs.map(input => {
  const category = input.kind === 'CONTROLLED' ? 'WEBSITE' : input.kind
  const operation = row.publicResearch.operations.find(value => value.category === category && value.inputIndex === input.inputIndex)
  const savedCapture = canonicalSaved && operation?.capture
  const status = operation?.phase === 'RECORDED' && ['SUCCEEDED', 'EMPTY', 'PARTIAL'].includes(operation.outcome) ? 'SUCCEEDED'
    : operation ? 'FAILED' : 'UNATTEMPTED'
  return { kind: input.kind, inputIndex: input.inputIndex, status, evidenceObjectCount: savedCapture ? operation.capture.evidenceObjectCount : 0,
    ...(savedCapture ? { sourceId: operation.capture.sourceId, contentHash: operation.capture.contentHash.slice(7) } : {}),
    ...(status !== 'SUCCEEDED' ? { reason: operation?.failureReason || (operation ? 'PUBLIC_RESEARCH_OPERATION_UNCONFIRMED' : 'PUBLIC_RESEARCH_NOT_ATTEMPTED') } : {}) }
})
export const publicResearchTerminalStatus = state => {
  if (state.operations.some(operation => operation.phase !== 'RECORDED' || !['SUCCEEDED', 'EMPTY'].includes(operation.outcome)))
    return state.operations.some(operation => ['SUCCEEDED', 'EMPTY'].includes(operation.outcome)) ? 'PARTIALLY_SUCCEEDED' : 'FAILED'
  return state.operations.length ? 'SUCCEEDED' : 'FAILED'
}
export const validatePublicResearchRun = row => {
  const state = validatePublicResearchState(row.publicResearch, row), terminal = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'].includes(row.status)
  const invalid = () => publicResearchFailure('PUBLIC_RESEARCH_RECEIPT_UNVERIFIED')
  if (row.actionKey !== 'BUILD_EVIDENCE_PACK' || !['QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'].includes(row.status)
    || typeof row.active !== 'boolean' || row.active === terminal || terminal !== Boolean(row.completedAt)
    || row.providerFreeSearch !== undefined || row.receiptRecorded !== undefined
    || Buffer.byteLength(JSON.stringify(row)) > 8 * 1024 * 1024
    || row.status === 'QUEUED' && (row.startedAt || state.operations.length)
    || row.status !== 'QUEUED' && !(row.status === 'CANCELLED' && !row.startedAt)
      && (!row.startedAt || !row.startAuditId || !row.startAuditSignatureVersion)) invalid()
  if (terminal) {
    if (!row.terminalAuditId || !row.terminalAuditSignatureVersion || typeof row.canonicalSaved !== 'boolean'
      || row.canonicalSaved && (!row.outputStateVersion || !row.saveAuditId || !row.saveAuditSignature || !row.saveAuditSignatureVersion)
      || !row.canonicalSaved && (row.outputStateVersion || row.saveAuditId || row.saveAuditSignature || row.saveAuditSignatureVersion)) invalid()
    if (row.status === 'CANCELLED' || row.reason === 'STOPPED_WORKER_RECOVERY') {
      const cancelled = row.status === 'CANCELLED', reason = cancelled ? 'CANCELLED_BEFORE_SAVE' : 'ORIGINAL_EXTRACTION_OUTCOME_UNCONFIRMED'
      if (row.canonicalSaved || cancelled && row.reason !== reason || !same(row.outcomes,
        row.inputs.map(input => ({ kind: input.kind, inputIndex: input.inputIndex, status: cancelled ? 'CANCELLED' : 'FAILED',
          evidenceObjectCount: 0, reason })))) invalid()
    } else if (!same(row.outcomes, buildPublicResearchOutcomes(row, row.canonicalSaved))) invalid()
    if (row.canonicalSaved && !row.outcomes.some(outcome => outcome.evidenceObjectCount > 0)
      || row.status === 'SUCCEEDED' && (state.operations.some(operation => !['SUCCEEDED', 'EMPTY'].includes(operation.outcome))
        || state.plan.selectedCategories.includes('WEBSITE') && !row.canonicalSaved)) invalid()
  } else if (row.canonicalSaved !== undefined || row.outcomes?.length || row.outputStateVersion || row.saveAuditId || row.terminalAuditId) invalid()
  return state
}
export const publicPublicResearchSummary = row => {
  const state = validatePublicResearchState(row.publicResearch, row), plan = state.plan, saved = row.canonicalSaved === true
  const categories = ['SEARCH', 'WEBSITE', 'REGISTRY'].map(key => {
    const items = state.operations.filter(operation => operation.category === key), selected = plan.selectedCategories.includes(key)
    const counts = { completedCount: items.filter(operation => operation.phase === 'RECORDED').length,
      failedCount: items.filter(operation => operation.outcome === 'FAILED').length,
      unknownCount: items.filter(operation => operation.outcome === 'UNKNOWN' || operation.phase === 'DISPATCHING').length,
      evidenceObjectCount: saved ? items.reduce((sum, operation) => sum + (operation.capture?.evidenceObjectCount || 0), 0) : 0 }
    const unfinishedCategory = selected && !items.length && ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED'].includes(row.status)
      && !(key === 'REGISTRY' && !plan.registry.applicable)
    if (unfinishedCategory) counts.unknownCount = 1
    const status = !selected ? 'NOT_SELECTED' : key === 'REGISTRY' && !plan.registry.applicable ? 'NOT_APPLICABLE'
      : row.status === 'CANCELLED' ? 'CANCELLED' : items.some(operation => operation.phase === 'DISPATCHING') ? 'RUNNING'
        : counts.unknownCount ? 'UNKNOWN' : items.some(operation => operation.outcome === 'PARTIAL') ? 'PARTIAL'
          : counts.failedCount ? 'FAILED' : !items.length ? 'PENDING'
            : items.every(operation => operation.outcome === 'EMPTY') ? 'EMPTY' : 'SUCCEEDED'
    return { key, status, ...counts }
  })
  return { mode: plan.mode, classification: plan.mode === 'OFFLINE' ? 'CONTROLLED_PROVIDER_FREE_RESEARCH' : 'NATIVE_PUBLIC_RESEARCH',
    liveExecutionEnabled: plan.mode === 'LIVE', planHash: plan.planHash, policyHash: plan.policyHash, receiptHash: state.ledgerHash,
    releaseId: plan.releaseId, operationCount: state.operations.length,
    completedOperationCount: state.operations.filter(operation => operation.phase === 'RECORDED').length,
    bytesRead: state.operations.reduce((sum, operation) => sum + (operation.receipt?.bytesRead || 0), 0),
    reservedCostMicros: state.operations.reduce((sum, operation) => sum + operation.reservedCostMicros, 0),
    elapsedMsRecorded: state.operations.reduce((sum, operation) => sum + (operation.receipt?.elapsedMs || 0), 0), modelTokens: 0,
    limits: plan.limits, categories, receipts: state.operations.map(operation => ({ ordinal: operation.ordinal, category: operation.category,
      phase: operation.phase, inputIndex: operation.inputIndex, requestHash: operation.requestHash,
      responseTextHash: operation.receipt?.responseTextHash || null, httpStatus: operation.receipt?.httpStatus ?? null,
      bytesRead: operation.receipt?.bytesRead || 0, elapsedMs: operation.receipt?.elapsedMs || 0,
      providerRequestId: operation.mapping?.providerRequestId || null, sourceId: saved ? operation.capture?.sourceId || null : null,
      evidenceObjectCount: saved ? operation.capture?.evidenceObjectCount || 0 : 0 })),
    qualifications: [...(plan.mode === 'OFFLINE' ? ['OFFLINE_FIXTURE_NOT_NATIVE_RESEARCH'] : []),
      'SEARCH_METADATA_NOT_ORIGINAL_EVIDENCE', 'REGISTRY_IDENTITY_NOT_CANDIDATE_EVIDENCE', 'PENDING_HUMAN_REVIEW',
      'COVERAGE_NOT_ESTABLISHED', 'RESERVED_COST_NOT_INVOICE', 'NO_PROVIDER_ABORT_PROOF',
      ...(state.operations.some(operation => operation.receipt && !operation.receipt.bodyComplete) ? ['RESPONSE_PREFIX_OR_WITHHELD_BODY'] : [])] }
}
