import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { assertSourceEvidenceMetadataPairs, validateSourceCapture } from './sourceEvidenceContract.js'
import { assertControlledReplayProvenancePairs } from './controlledReplayContract.js'
import { getDiscoveryContradictionReview, isBoundedContradictionReviewHistory } from './discoveryContradictionReviewService.js'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const actorId = /^[a-f0-9]{24}$/i
const hash = /^sha256:[a-f0-9]{64}$/
const sourceFields = ['type', 'sourceType', 'acquisitionProfile', 'adapter', 'extractionMethod',
  'ingestionMode', 'url', 'finalUrl', 'fieldKey', 'fileName', 'documentType', 'assetType',
  'contentTruncated', 'contentCharactersRead', 'contentCharacterLimit', 'contentHash', 'controlledReplayProvenance']
const evidenceFields = ['sourceId', 'extractedFact', 'acquisitionMethod', 'lineageRef',
  'acquisitionProfile', 'category', 'coverageArea', 'confidence', 'sourceUrl',
  'sourceFileName', 'documentAssetType', 'extractionMethod', 'ingestionMode', 'evidenceSupport', 'controlledReplayProvenance']

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
const captureMaterial = (source, evidence) => {
  assertSourceEvidenceMetadataPairs({ sources: [source], evidenceObjects: [evidence] })
  assertControlledReplayProvenancePairs({ sources: [source], evidenceObjects: [evidence] })
  if (source.sourceCapture === undefined) return undefined
  const capture = validateSourceCapture(source.sourceCapture, { sourceId: source.sourceId, contentHash: source.contentHash })
  delete capture.capturedAt
  delete capture.captureReceipt.inputIndex
  return capture
}

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
    try {
      if (!isDeepStrictEqual(captureMaterial(before, previous), captureMaterial(after, item))) return item
    } catch (error) {
      if (error?.code === 'SOURCE_EVIDENCE_CONTRACT_INVALID' || error?.details?.reason === 'CONTROLLED_REPLAY_CONTRACT_INVALID') return item
      throw error
    }
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

// Acceptance of an already disposed, identical population is metadata only.
// Any changed or unverifiable review basis retains the existing epoch reset.
export const acceptanceContradictionReviewEpoch = ({ previousEvidencePack = {}, evidenceObjects,
  sourceRegistry, candidates, runtimeInstanceId } = {}) => {
  const epoch = previousEvidencePack.contradictionReviewEpoch
  const reviews = previousEvidencePack.contradictionReviews
  const beforeCandidates = previousEvidencePack.discoveryHealth?.contradictionCandidates
  const unique = (rows, field) => Array.isArray(rows) && rows.length > 0
    && rows.every(row => row && typeof row[field] === 'string' && row[field].trim())
    && new Set(rows.map(row => row[field])).size === rows.length
  if (typeof epoch !== 'string' || (epoch !== '' && !uuid.test(epoch))
    || typeof runtimeInstanceId !== 'string' || !actorId.test(runtimeInstanceId)
    || !isBoundedContradictionReviewHistory(reviews)
    || reviews.some(review => !review || typeof review !== 'object' || !review.contradictionId)
    || !unique(previousEvidencePack.evidenceObjects, 'evidenceObjectId')
    || !unique(previousEvidencePack.sourceRegistry, 'sourceId')
    || !unique(beforeCandidates, 'contradictionId')
    || previousEvidencePack.evidenceObjects.some(item => !['ACCEPTED', 'REJECTED'].includes(item.reviewStatus))
    || !isDeepStrictEqual(previousEvidencePack.evidenceObjects, evidenceObjects)
    || !isDeepStrictEqual(previousEvidencePack.sourceRegistry, sourceRegistry)
    || !isDeepStrictEqual(beforeCandidates, candidates)) return randomUUID()
  for (const [index, candidate] of beforeCandidates.entries()) {
    const before = getDiscoveryContradictionReview(candidate, previousEvidencePack.evidenceObjects,
      reviews, runtimeInstanceId, epoch)
    const after = getDiscoveryContradictionReview(candidates[index], evidenceObjects, reviews, runtimeInstanceId, epoch)
    if (!before.evidencePairHash || !isDeepStrictEqual(before, after)) return randomUUID()
  }
  return epoch
}
