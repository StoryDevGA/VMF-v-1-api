import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const actorId = /^[a-f0-9]{24}$/i
const hash = /^sha256:[a-f0-9]{64}$/
const sourceFields = ['type', 'sourceType', 'acquisitionProfile', 'adapter', 'extractionMethod',
  'ingestionMode', 'url', 'finalUrl', 'fieldKey', 'fileName', 'documentType', 'assetType',
  'contentTruncated', 'contentCharactersRead', 'contentCharacterLimit']
const evidenceFields = ['sourceId', 'extractedFact', 'acquisitionMethod', 'lineageRef',
  'acquisitionProfile', 'category', 'coverageArea', 'confidence', 'sourceUrl',
  'sourceFileName', 'documentAssetType', 'extractionMethod', 'ingestionMode']

const uniqueIndex = (rows, key) => {
  const index = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.[key]
    if (typeof id !== 'string' || !id) continue
    index.set(id, index.has(id) ? null : row)
  }
  return index
}
const contentHash = source => {
  const values = [source?.valueHash, source?.documentHash].filter(value => value !== undefined)
  return values.length && values.every(value => typeof value === 'string' && hash.test(value)
    && value === values[0]) ? values[0] : ''
}
const sameFields = (first, second, fields) => fields.every(field =>
  isDeepStrictEqual(first?.[field], second?.[field]))

// Carry only a recorded human decision, using exact producer identity and provenance.
// Final graph metadata is derived by the existing normalizer after reconciliation.
export const preserveDiscoveryEvidenceDecisions = ({ evidenceObjects = [], sources = [], previousEvidencePack = {} } = {}) => {
  const oldEvidence = uniqueIndex(previousEvidencePack.evidenceObjects, 'evidenceObjectId')
  const newEvidence = uniqueIndex(evidenceObjects, 'evidenceObjectId')
  const oldSources = uniqueIndex(previousEvidencePack.lineage?.sources, 'sourceId')
  const newSources = uniqueIndex(sources, 'sourceId')
  return evidenceObjects.map(item => {
    const previous = oldEvidence.get(item.evidenceObjectId)
    const before = oldSources.get(item.sourceId)
    const after = newSources.get(item.sourceId)
    const previousHash = contentHash(before)
    if (!previous || !newEvidence.get(item.evidenceObjectId) || !before || !after
      || !previousHash || previousHash !== contentHash(after)
      || !sameFields(before, after, sourceFields)
      || !item.extractedFact || !item.lineageRef
      || !sameFields(previous, item, evidenceFields)) return item
    const accepted = previous.reviewStatus === 'ACCEPTED'
    if (!accepted && previous.reviewStatus !== 'REJECTED') return item
    const actor = accepted ? previous.acceptedBy : previous.rejectedBy
    const time = accepted ? previous.acceptanceTimestamp : previous.rejectionTimestamp
    if (typeof actor !== 'string' || !actorId.test(actor)
      || typeof time !== 'string' || !Number.isFinite(Date.parse(time))
      || typeof previous.auditRef !== 'string' || !previous.auditRef.trim()) return item
    return { ...item, reviewStatus: previous.reviewStatus,
      acceptedBy: accepted ? actor : '', acceptanceTimestamp: accepted ? time : '',
      rejectedBy: accepted ? '' : actor, rejectionTimestamp: accepted ? '' : time,
      auditRef: previous.auditRef,
      auditRefs: [...new Set([...(Array.isArray(previous.auditRefs) ? previous.auditRefs : [])
        .filter(value => typeof value === 'string' && value.trim()), previous.auditRef])] }
  })
}

// Pair hashes already include the detector basis and exact evidence projection.
// Ordinary acquisition must not invalidate an unchanged pair by resetting its epoch.
export const acquisitionContradictionReviewEpoch = previous =>
  previous === undefined || previous === '' ? '' : typeof previous === 'string' && uuid.test(previous)
    ? previous : randomUUID()
