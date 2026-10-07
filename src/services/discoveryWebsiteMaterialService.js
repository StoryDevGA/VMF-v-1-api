import { normalizeDiscoveryWebsiteUrl } from './discoveryIntelligenceService.js'
import { isDeepStrictEqual } from 'node:util'

const website = row => row?.type === 'WEBSITE_ACQUISITION'
  || row?.sourceType === 'WEBSITE' && !row.fieldKey
const conflict = () => { throw Object.assign(new Error('Website source continuity could not be verified. Refresh and inspect its recorded provenance.'), {
  status: 409, code: 'CONFLICT', details: { reason: 'ACQUISITION_CONTINUITY_BLOCKED' },
}) }
const requestedUrl = row => {
  try { return normalizeDiscoveryWebsiteUrl(row.url) } catch { return conflict() }
}
const rows = value => value === undefined ? [] : Array.isArray(value) ? value : conflict()
const cardinalities = (items, field) => {
  const counts = new Map()
  for (const row of items) counts.set(row?.[field], (counts.get(row?.[field]) || 0) + 1)
  return counts
}
const indexed = rows => {
  const urls = new Map(), ids = new Set()
  for (const row of rows) {
    if (typeof row?.sourceId !== 'string' || !row.sourceId || row.sourceId.length > 160) conflict()
    const url = requestedUrl(row)
    if (urls.has(url) || ids.has(row.sourceId)) conflict()
    urls.set(url, row); ids.add(row.sourceId)
  }
  return urls
}

// Reuse canonical website records, retaining their original version and decisions.
// An acquisition input list controls attempts; it is not a source deletion command.
export const reconcileWebsiteMaterial = ({ previousEvidencePack = {}, fresh } = {}) => {
  const previousSources = rows(previousEvidencePack.lineage?.sources)
  const previousRegistry = rows(previousEvidencePack.sourceRegistry)
  const oldSources = previousSources.filter(website)
  const oldRegistry = previousRegistry.filter(website)
  const previousEvidence = rows(previousEvidencePack.evidenceObjects)
  const oldEvidence = previousEvidence.filter(row => row?.acquisitionMethod === 'WEBSITE_ACQUISITION')
  const before = indexed(oldSources), registry = indexed(oldRegistry)
  const current = indexed(fresh.sources), currentRegistry = indexed(fresh.sourceRegistry)
  if (before.size !== registry.size || current.size !== currentRegistry.size) conflict()
  for (const [url, source] of before) if (registry.get(url)?.sourceId !== source.sourceId) conflict()
  for (const [url, source] of current) if (currentRegistry.get(url)?.sourceId !== source.sourceId) conflict()
  const oldIds = new Set(oldSources.map(row => row.sourceId)), evidenceIds = new Set()
  const sourceCounts = cardinalities(previousSources, 'sourceId'), registryCounts = cardinalities(previousRegistry, 'sourceId')
  for (const id of oldIds) if (sourceCounts.get(id) !== 1 || registryCounts.get(id) !== 1) conflict()
  const previousEvidenceCounts = cardinalities(previousEvidence, 'evidenceObjectId')
  if (previousEvidence.some(row => oldIds.has(row?.sourceId) && row.acquisitionMethod !== 'WEBSITE_ACQUISITION')) conflict()
  for (const row of oldEvidence) {
    if (!oldIds.has(row.sourceId) || !row.evidenceObjectId || evidenceIds.has(row.evidenceObjectId)
      || previousEvidenceCounts.get(row.evidenceObjectId) !== 1) conflict()
    evidenceIds.add(row.evidenceObjectId)
  }
  for (const [url, source] of before) {
    const entry = registry.get(url)
    if (!['ACQUIRED', 'FAILED'].includes(source.status) || entry.acquisitionStatus !== source.status) conflict()
    if (source.status === 'FAILED' && (oldEvidence.some(row => row.sourceId === source.sourceId)
      || Number(source.evidenceProduced) !== 0 || entry.acceptedEvidenceObjects || entry.rejectedEvidenceObjects)) conflict()
  }
  const freshIds = new Set(fresh.sources.map(row => row.sourceId)), freshEvidenceIds = new Set()
  for (const row of fresh.evidenceObjects) {
    if (!freshIds.has(row?.sourceId) || !row.evidenceObjectId || freshEvidenceIds.has(row.evidenceObjectId)
      || row.acquisitionMethod !== 'WEBSITE_ACQUISITION') conflict()
    freshEvidenceIds.add(row.evidenceObjectId)
  }
  const sources = new Map(before), sourceRegistry = new Map(registry), replaced = new Set()
  const items = []
  for (const [url, source] of current) {
    const prior = before.get(url)
    const succeeded = source.status === 'ACQUIRED'
    if (!succeeded && source.status !== 'FAILED') conflict()
    const priorEvidence = prior ? oldEvidence.filter(row => row.sourceId === prior.sourceId) : []
    if (succeeded && prior && prior.sourceId !== source.sourceId
      && !(prior.status === 'FAILED' && registry.get(url)?.acquisitionStatus === 'FAILED'
        && priorEvidence.length === 0 && Number(prior.evidenceProduced) === 0
        && !registry.get(url)?.acceptedEvidenceObjects && !registry.get(url)?.rejectedEvidenceObjects)) conflict()
    const retainedPrior = !succeeded && Boolean(prior)
    if (succeeded || !prior) {
      sources.set(url, source); sourceRegistry.set(url, currentRegistry.get(url))
      if (prior) replaced.add(prior.sourceId)
    }
    items.push({ inputIndex: items.length, status: succeeded ? 'SUCCEEDED' : 'FAILED',
      sourceId: retainedPrior ? prior.sourceId : source.sourceId,
      evidenceObjectCount: succeeded ? fresh.evidenceObjects.filter(row => row.sourceId === source.sourceId).length : 0,
      retainedPrior,
      ...(retainedPrior ? { retainedEvidenceObjectCount: priorEvidence.length } : {}),
      ...(!succeeded ? { reason: 'WEBSITE_ACQUISITION_FAILED' } : {}),
    })
  }
  const retainedEvidence = oldEvidence.filter(row => !replaced.has(row.sourceId))
  const nextSources = [...sources.values()]
  if (new Set(nextSources.map(row => row.sourceId)).size !== nextSources.length) conflict()
  const nextEvidence = [...retainedEvidence, ...fresh.evidenceObjects]
  if (new Set(nextEvidence.map(row => row.evidenceObjectId)).size !== nextEvidence.length) conflict()
  return { sources: nextSources, sourceRegistry: [...sourceRegistry.values()],
    evidenceObjects: nextEvidence, retainedEvidence, items }
}

export const assertRetainedWebsiteMaterial = ({ retainedEvidence, evidenceObjects }) => {
  const fields = ['sourceId', 'extractedFact', 'acquisitionMethod', 'acquisitionProfile', 'lineageRef',
    'sourceUrl', 'reviewStatus', 'acceptedBy', 'acceptanceTimestamp', 'rejectedBy', 'rejectionTimestamp', 'auditRef',
    'category', 'coverageArea', 'confidence', 'createdAt', 'extractionTimestamp', 'auditRefs']
  const current = new Map(evidenceObjects.map(row => [row.evidenceObjectId, row]))
  const counts = cardinalities(evidenceObjects, 'evidenceObjectId')
  for (const prior of retainedEvidence) {
    const row = current.get(prior.evidenceObjectId)
    if (!row || counts.get(prior.evidenceObjectId) !== 1
      || fields.some(field => !isDeepStrictEqual(prior[field], row[field]))) conflict()
  }
}
