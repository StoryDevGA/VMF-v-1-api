import { PUBLISHED_DISPOSITION_POLICY as policy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { SUPPLEMENTAL_FINDING_POLICY as findingPolicy } from '../constants/supplementalFindingReviewPolicy.js'
import { RUNTIME_PRODUCT_AUTHORITY_POLICY as authorityPolicy } from '../constants/runtimeProductAuthorityPolicy.js'
import { membershipHash, membershipJson, evidenceMaterialHash } from './runtimeEvidenceSnapshotContract.js'

export const PUBLISHED_DISPOSITION_POPULATION_VERSION = 'supplemental-published-disposition-population.v1'
const invalid = () => { throw Object.assign(new Error('The supplemental disposition population cannot be verified.'), {
  status: 409, code: 'PUBLISHED_RECOVERY_POPULATION_INVALID',
}) }
const requireValue = value => { if (!value) invalid() }
const exact = (value, keys) => value && Object.keys(value).sort().join() === [...keys].sort().join()
const hash = value => /^[a-f0-9]{64}$/.test(value || '')
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value || '')
const oid = value => /^[a-f0-9]{24}$/.test(String(value || ''))
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const sort = rows => [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export const assertPublishedFindingLink = raw => {
  const link = membershipJson(raw)
  requireValue(exact(link, ['receiptId', 'bodyHash', 'auditId', 'auditSignatureVersion', 'createdAt',
    'reviewerUserId', 'disposition', 'evidencePairHash', 'authority']) && uuid(link.receiptId)
    && hash(link.bodyHash) && oid(link.auditId) && Number.isSafeInteger(link.auditSignatureVersion)
    && link.auditSignatureVersion > 0 && time(link.createdAt) && link.reviewerUserId === authorityPolicy.reviewerUserId
    && link.disposition === 'NOT_CONTRADICTORY' && link.evidencePairHash === findingPolicy.evidencePairHash
    && exact(link.authority, ['receiptId', 'bodyHash', 'approvalReference', 'version', 'documentHash'])
    && uuid(link.authority.receiptId) && hash(link.authority.bodyHash)
    && link.authority.approvalReference === authorityPolicy.approvalReference
    && link.authority.version === authorityPolicy.version && link.authority.documentHash === authorityPolicy.documentHash)
  return link
}
export const publishedFindingLink = record => assertPublishedFindingLink({ receiptId: record.receiptId,
  bodyHash: record.bodyHash, auditId: String(record.auditId), auditSignatureVersion: record.auditSignatureVersion,
  createdAt: record.body.committedUpdatedAt, reviewerUserId: record.body.reviewer.userId,
  disposition: record.body.disposition, evidencePairHash: record.body.evidencePairHash, authority: record.body.authority })

export const assertPublishedDispositionPopulation = raw => {
  const population = membershipJson(raw), manifest = population?.manifest
  requireValue(exact(population, ['manifest', 'populationHash', 'summary'])
    && exact(manifest, ['policy', 'scope', 'basisStateVersion', 'evidence', 'sources', 'sections', 'findingReview'])
    && manifest.policy === PUBLISHED_DISPOSITION_POPULATION_VERSION && manifest.basisStateVersion === policy.stateVersion
    && membershipHash(manifest.scope) === membershipHash(policy.scope)
    && population.populationHash === membershipHash(manifest))
  assertPublishedFindingLink(manifest.findingReview)
  for (const [kind, count] of [['evidence', 47], ['sources', 8], ['sections', 6]]) {
    const rows = manifest[kind]
    requireValue(Array.isArray(rows) && rows.length === count && new Set(rows.map(row => row.id)).size === count
      && membershipHash(rows) === membershipHash(sort(rows)))
    for (const row of rows) {
      requireValue(exact(row, kind === 'evidence' ? ['id', 'sourceId', 'materialHash', 'decision'] : ['id', 'materialHash'])
        && typeof row.id === 'string' && row.id.length > 0 && hash(row.materialHash))
      if (kind === 'evidence') requireValue(manifest.sources.some(source => source.id === row.sourceId)
        && exact(row.decision, ['status', 'actorUserId', 'acceptedAt', 'auditId', 'auditSignatureVersion'])
        && row.decision.status === 'ACCEPTED' && oid(row.decision.actorUserId) && time(row.decision.acceptedAt)
        && policy.auditIds.includes(row.decision.auditId) && Number.isSafeInteger(row.decision.auditSignatureVersion)
        && row.decision.auditSignatureVersion > 0)
    }
  }
  requireValue(membershipHash(population.summary) === membershipHash({ policy: PUBLISHED_DISPOSITION_POPULATION_VERSION,
    evidenceCount: 47, sourceCount: 8, sectionCount: 6, pendingEvidence: 0, pendingFindings: 0, complete: true }))
  return population
}

// Audits must already have their native signatures verified by the session owner.
// The pure compiler independently reconciles the actual admission transitions.
export const buildPublishedDispositionPopulation = ({ runtime, sources, evidence, sections, admissionAudits, finding }) => {
  const pack = runtime.framework_state?.evidence_pack
  requireValue(String(runtime._id || runtime.id) === policy.scope.runtimeInstanceId
    && String(runtime.customerId) === policy.scope.customerId && String(runtime.tenantId) === policy.scope.tenantId
    && runtime.runtimeInstanceKey === policy.scope.runtimeInstanceKey && runtime.revision?.revisionNumber === 1
    && runtime.stateVersion === policy.stateVersion && !Object.hasOwn(pack || {}, 'contradictionReviews')
    && pack?.discoveryHealth?.contradictionCandidates?.length === 1
    && pack.discoveryHealth.contradictionCandidates[0].contradictionId === findingPolicy.contradictionId
    && pack.contradictionReviewEpoch === findingPolicy.reviewEpoch && pack.evidenceObjects?.length === 47
    && pack.sourceRegistry?.length === 8 && (pack.evidenceReady === true || pack.state?.evidenceReady === true)
    && !pack.needsRefresh && !pack.needs_refresh && !pack.state?.needsRefresh && !pack.state?.needs_refresh
    && Array.isArray(admissionAudits) && admissionAudits.length === policy.auditIds.length)
  const rows = {}
  for (const [kind, key, input] of [['sources', 'sourceId', sources], ['evidence', 'evidenceObjectId', evidence], ['sections', 'sectionKey', sections]]) {
    requireValue(Array.isArray(input))
    rows[kind] = sort(input.map(row => {
      requireValue(['customerId', 'tenantId', 'runtimeInstanceId'].every(name => String(row[name]) === policy.scope[name])
        && row.runtimeInstanceKey === policy.scope.runtimeInstanceKey && row.current === true
        && row.stateVersion === policy.stateVersion && row.sourceStateVersion === policy.stateVersion)
      const result = { id: row[key], materialHash: evidenceMaterialHash(row) }
      if (kind !== 'evidence') return result
      const matches = pack.evidenceObjects.filter(item => item.evidenceObjectId === row.evidenceObjectId)
      requireValue(matches.length === 1)
      const decision = matches[0]
      requireValue(row.reviewStatus === 'ACCEPTED' && decision.reviewStatus === 'ACCEPTED'
        && decision.sourceId === row.sourceId && decision.extractedFact === row.extractedFact
        && oid(decision.acceptedBy) && time(decision.acceptanceTimestamp))
      const admissions = admissionAudits.filter(audit => audit.diff?.runtimePath === 'framework_state.evidence_pack'
        && audit.action === 'RUNTIME_STATE_MUTATED' && audit.resourceType === 'RuntimeInstance'
        && String(audit.resourceId) === policy.scope.runtimeInstanceId && String(audit.actorUserId) === decision.acceptedBy
        && ['customerId', 'tenantId', 'runtimeInstanceId'].every(name => String(audit.scope?.[name]) === policy.scope[name])
        && (audit.diff.previousValue?.evidenceObjects || []).filter(item => item.evidenceObjectId === row.evidenceObjectId && item.reviewStatus !== 'ACCEPTED').length === 1
        && (audit.diff.nextValue?.evidenceObjects || []).filter(item => item.evidenceObjectId === row.evidenceObjectId
          && item.reviewStatus === 'ACCEPTED' && item.acceptedBy === decision.acceptedBy
          && item.acceptanceTimestamp === decision.acceptanceTimestamp && item.sourceId === row.sourceId
          && item.extractedFact === row.extractedFact).length === 1)
      requireValue(admissions.length === 1)
      const audit = admissions[0]
      return { ...result, sourceId: row.sourceId, decision: { status: 'ACCEPTED', actorUserId: decision.acceptedBy,
        acceptedAt: decision.acceptanceTimestamp, auditId: String(audit._id), auditSignatureVersion: audit.signatureVersion } }
    }))
  }
  const manifest = { policy: PUBLISHED_DISPOSITION_POPULATION_VERSION, scope: { ...policy.scope },
    basisStateVersion: policy.stateVersion, ...rows, findingReview: publishedFindingLink(finding) }
  return assertPublishedDispositionPopulation({ manifest, populationHash: membershipHash(manifest), summary: {
    policy: PUBLISHED_DISPOSITION_POPULATION_VERSION, evidenceCount: 47, sourceCount: 8, sectionCount: 6,
    pendingEvidence: 0, pendingFindings: 0, complete: true } })
}
export const publishedDispositionExpectedBasisHash = ({ freezeHash, runtimeWitnessHash, population, findingReview, predecessorControl }) =>
  membershipHash({ freezeHash, runtimeWitnessHash, populationHash: population.populationHash,
    originalAuditHash: policy.originalAuditHash, originalUpdatedAt: policy.updatedAt, findingReview, predecessorControl })
