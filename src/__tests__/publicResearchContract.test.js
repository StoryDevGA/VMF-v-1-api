import { expect, test } from '@jest/globals'
import { buildPublicResearchPlan, selectPublicResearchWebsites, validatePublicResearchPlan,
  publicResearchHash } from '../services/publicResearchContract.js'

const at = '2026-11-16T00:00:00.000Z', requestKey = '11111111-1111-4111-8111-111111111111'
const scope = { customerId: '1'.repeat(24), tenantId: '2'.repeat(24), runtimeInstanceId: '3'.repeat(24), runtimeInstanceKey: 'research-r1' }
const input = () => {
  const actorUserId = '4'.repeat(24), configuration = { configurationVersion: requestKey,
    configurationHash: 'sha256:' + 'a'.repeat(64), basisStateVersion: 'rsv2:22222222-2222-4222-8222-222222222222', basisUpdatedAt: at,
    settings: { startingUrls: ['https://research.example/'], sources: ['SEARCH', 'WEBSITE', 'REGISTRY'],
      entityConfirmed: true, legalEntity: 'Synthetic Child Limited', entityIdentifier: '00123456', countryCode: 'GB', ukSubsidiary: false } }
  return { actorUserId, requestKey, mode: 'OFFLINE', now: Date.parse(at), configuration,
    runtime: { ...scope, _id: scope.runtimeInstanceId, stateVersion: configuration.basisStateVersion, updatedAt: at },
    policy: { contractVersion: 'public-research-operating-policy.v1', environment: 'DEVELOPMENT_TEST', releaseId: requestKey,
      expiresAt: '2026-11-17T00:00:00.000Z', binding: { ...scope, actorUserId, configurationVersion: configuration.configurationVersion,
        configurationHash: configuration.configurationHash, basisStateVersion: configuration.basisStateVersion, basisUpdatedAt: at },
      approvalRef: 'SYNTHETIC_ONLY', licensingRef: 'SYNTHETIC_ONLY', retentionRef: 'SYNTHETIC_ONLY', disclosureRef: 'SYNTHETIC_ONLY',
      processingRegion: 'SYNTHETIC_ONLY', credentialOwner: 'SYNTHETIC_ONLY', spendOwner: 'SYNTHETIC_ONLY',
      references: [{ url: 'https://reference.example/', version: 'synthetic-v1', sha256: 'sha256:' + 'b'.repeat(64) }],
      approvedStartingUrls: configuration.settings.startingUrls, approvedDiscoveryUrls: ['https://research.example/approved'],
      approvedTerms: ['workflow'], company: { companyNumber: '00123456', legalName: 'Synthetic Child Limited', jurisdiction: 'GB' },
      partialSave: 'PRESERVE_PENDING', limits: { maxSearchRequests: 1, maxRegistryRequests: 1, maxPages: 3,
        maxPageBytes: 320000, maxJsonBytes: 16384, maxTotalBytes: 1048576, maxElapsedMs: 600000, maxRequestMs: 6000,
        maxCostMicros: 50000, searchRequestCostMicros: 8000, registryRequestCostMicros: 0,
        concurrency: 1, retries: 0, redirects: 0, modelTokens: 0 } } }
}
const invalid = args => expect(() => buildPublicResearchPlan(args)).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
test('binds a bounded plan to exact scope/configuration/release without private context', () => {
  const args = input(); args.configuration.settings.instructions = 'PRIVATE_CONTEXT_SENTINEL'
  const plan = buildPublicResearchPlan(args)
  expect(validatePublicResearchPlan(plan)).toBe(plan)
  expect(plan).toMatchObject({ mode: 'OFFLINE', releaseId: requestKey, registry: { applicable: true, company: { companyNumber: '00123456' } } })
  expect(JSON.stringify(plan)).not.toContain('PRIVATE_CONTEXT_SENTINEL')
})
test.each(['actorUserId', 'requestKey', 'mode'])('refuses mismatched %s', key => {
  const args = input(); args[key] = 'wrong'; invalid(args)
})
test.each(['customerId', 'tenantId', 'runtimeInstanceKey', 'stateVersion', 'updatedAt'])('refuses changed runtime %s', key => {
  const args = input(); args.runtime[key] = key === 'updatedAt' ? '2026-11-16T00:00:01.000Z' : 'changed'; invalid(args)
})
test.each(['configurationVersion', 'configurationHash', 'basisStateVersion', 'basisUpdatedAt'])('refuses stale configuration %s', key => {
  const args = input(); args.configuration[key] = 'changed'; invalid(args)
})
test('rejects a consistently supplied but noncanonical state version', () => {
  const args = input()
  args.configuration.basisStateVersion = args.runtime.stateVersion = args.policy.binding.basisStateVersion = 'rsv2:bounded'
  invalid(args)
})
test.each(['missing', 'expired', 'unknown field', 'production', 'unsafe target', 'missing reference', 'private policy data'])('fails closed for %s policy', kind => {
  const args = input()
  if (kind === 'missing') args.policy = null
  if (kind === 'expired') args.now = Date.parse(args.policy.expiresAt)
  if (kind === 'unknown field') args.policy.enabled = true
  if (kind === 'production') args.policy.environment = 'PRODUCTION'
  if (kind === 'unsafe target') args.policy.approvedStartingUrls = ['https://user:secret@research.example/']
  if (kind === 'missing reference') args.policy.references = []
  if (kind === 'private policy data') args.policy.credential = 'SYNTHETIC_SECRET_SENTINEL'
  invalid(args)
})
test.each(['maxPages', 'maxSearchRequests', 'maxRegistryRequests', 'maxCostMicros'])('refuses insufficient %s instead of clipping work', key => {
  const args = input(); args.policy.limits[key] = 0; invalid(args)
})
test('accounts for every starting URL and refuses an unapproved or over-budget list', () => {
  const args = input(); args.configuration.settings.startingUrls = ['https://research.example/', 'https://other.example/']; invalid(args)
  args.policy.approvedStartingUrls = [...args.configuration.settings.startingUrls]; args.policy.limits.maxPages = 1; invalid(args)
})
test('only exact approved discovered URLs can be selected; page limit remains visible', () => {
  const args = input(), plan = buildPublicResearchPlan(args)
  expect(selectPublicResearchWebsites(plan, [{ url: 'https://research.example/approved' }, { url: 'https://research.example/arbitrary' },
    { url: 'https://private.example/approved' }])).toEqual({ urls: ['https://research.example/', 'https://research.example/approved'],
    excludedDiscoveryCount: 2, limitReached: false })
  plan.limits.maxPages = 1
  expect(selectPublicResearchWebsites(plan, [{ url: 'https://research.example/approved' }])).toMatchObject({ urls: ['https://research.example/'], limitReached: true })
})
test('non-UK registry selection is explicitly not applicable, not an invented company match', () => {
  const args = input(); args.configuration.settings.countryCode = 'IE'; args.policy.company = undefined
  expect(buildPublicResearchPlan(args).registry).toEqual({ selected: true, applicable: false, reason: 'UK_REGISTRY_NOT_APPLICABLE' })
})
test.each(['entityConfirmed', 'entityIdentifier', 'legalEntity'])('refuses missing or mismatched registry %s', key => {
  const args = input(); args.configuration.settings[key] = key === 'entityConfirmed' ? false : 'wrong'; invalid(args)
})
test('saved-plan hash and strict shape reject tampering, while expired historical plans remain readable', () => {
  const plan = buildPublicResearchPlan(input()), changed = structuredClone(plan)
  changed.limits.maxPages = 2
  expect(() => validatePublicResearchPlan(changed)).toThrow()
  const { planHash: _hash, ...body } = plan, extra = { ...body, extra: 'unrecognised' }
  expect(() => validatePublicResearchPlan({ ...extra, planHash: publicResearchHash(extra) })).toThrow()
  expect(validatePublicResearchPlan(plan)).toBe(plan)
})
