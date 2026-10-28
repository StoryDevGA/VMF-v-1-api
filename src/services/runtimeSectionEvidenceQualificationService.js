import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { resolveSourceRecordedReview } from './sourceVerificationContext.js'
import { projectControlledReplayProvenance, assertControlledReplayProvenancePairs } from './controlledReplayContract.js'
import { assertSourceEvidenceMetadataPairs, validateEvidenceSupport, validateSourceCapture } from './sourceEvidenceContract.js'

export const SECTION_EVIDENCE_QUALIFICATION_VERSION = 'section-evidence-qualification.v1'
export const SECTION_CLAIM_BOUNDARY_POLICY_VERSION = 'section-claim-boundary-policy.v2'
export const SECTION_CLAIM_BOUNDARY_INSTRUCTION = 'Preserve modal, temporal, actor, evidential and domain scope in every standalone claim, interpretation, assessment, rationale, boundary and handoff signal, as well as the narrative. Compression must retain material qualifiers. A source that does not authorize an action does not thereby establish an explicit prohibition or future permission; distinguish absence of authority, denial and granted authority. Keep pending review distinct from approval or refusal, and keep each stated position attached to its actual actor. Preserve the exact scope of exclusions and conditions: a restricted deployment setting or data category must not become a restriction on all implementation or all data. Do not turn a limited observation into a universal state, or absence of evidence into evidence of absence. When a stronger or broader interpretation is unsupported, state that uncertainty instead of asserting it as fact. Each independently consumed structured field must remain truthful when read without the surrounding narrative and may not rely on another field to restore omitted qualification. A represented claim is an assertion actually expressed by an identified source, retained with that attribution and its material qualifiers; it is not a plausible claim inferred from identity, a website address, an activity label or missing evidence. Where representedClaims is part of the declared output, leave it empty when the evidence contains no such assertion. Keep supported claims to what the cited passages establish. Keep unsupported interpretations explicitly qualified within the declared schema, never assert them as organizational facts. Assess each actor separately: one actor\'s recorded position does not establish another actor\'s position. An unknown operational state is unknown, not a finding that activity has or has not occurred. A pending review does not establish a clearance requirement, legal prerequisite or mandatory forwarding procedure unless the cited evidence explicitly says so. Any proposed interpretation or next step must be labelled conditional reasoning, remain within the source-defined decision boundary, and must not be presented as an existing fact, authority or obligation.'
export const SECTION_CLAIM_BOUNDARY_POLICY = Object.freeze({ version: SECTION_CLAIM_BOUNDARY_POLICY_VERSION,
  instructionHash: createHash('sha256').update(SECTION_CLAIM_BOUNDARY_INSTRUCTION, 'utf8').digest('hex') })

const fail = () => {
  const error = new Error('Section evidence qualification could not be projected safely.')
  error.code = 'SECTION_EVIDENCE_QUALIFICATION_INVALID'
  error.status = 409
  throw error
}
const optionalText = (value, max = 240) => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value !== value.trim() || Array.from(value).length > max) fail()
  return value
}
const identity = value => optionalText(typeof value === 'string' ? value.trim() : value)
const confidence = value => {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Number.isFinite(value.score) || value.score < 0 || value.score > 100
    || !Array.isArray(value.basis) || value.basis.length > 100) fail()
  return { level: optionalText(value.level, 100), score: value.score,
    basis: value.basis.map(item => optionalText(item, 1000)) }
}
const indexSources = (rows, admittedSources) => {
  if (!Array.isArray(rows) || rows.length > 1000) fail()
  const index = new Map()
  for (const row of rows) {
    if (!row || !admittedSources.has(identity(row.sourceId))) continue
    const id = identity(row.sourceId)
    if (!id) fail()
    // Duplicated source owners are ambiguous even when their display labels agree.
    if (index.has(id)) fail()
    index.set(id, row)
  }
  return index
}
const sourceReview = source => {
  if (!source || source.verificationContext === undefined) return { status: 'NOT_RECORDED', authenticity: null }
  const recorded = resolveSourceRecordedReview(source)
  if (!recorded) return { status: 'UNASSESSED', authenticity: null }
  return Object.fromEntries(['status', 'authenticity', 'sourceOrigin', 'organizationRelationship',
    'independenceGroup', 'supportingReference', 'rationale', 'sourceFingerprint'].map(key =>
    [key, optionalText(recorded[key], ['supportingReference', 'rationale'].includes(key) ? 2000 : 1000)]))
}

/** Preserve recorded qualification without treating evidence admission as source verification. */
export const buildRuntimeSectionEvidenceQualifications = ({ evidenceObjects = [], sourceRegistry = [],
  lineageSources = [], admittedEvidenceIds = [] } = {}) => {
  if (!Array.isArray(evidenceObjects) || !Array.isArray(admittedEvidenceIds)
    || admittedEvidenceIds.length > 1000 || new Set(admittedEvidenceIds).size !== admittedEvidenceIds.length) fail()
  const admitted = new Set(admittedEvidenceIds.map(id => { const value = optionalText(id); if (!value) fail(); return value }))
  const evidence = new Map()
  for (const row of evidenceObjects) {
    if (!row || !admitted.has(identity(row.evidenceObjectId))) continue
    const evidenceObjectId = identity(row.evidenceObjectId)
    if (evidence.has(evidenceObjectId)) fail()
    const sourceId = identity(row.sourceId)
    if (!sourceId) fail()
    evidence.set(evidenceObjectId, { evidenceObjectId, sourceId,
      ...projectControlledReplayProvenance(row),
      reviewStatus: optionalText(row.reviewStatus, 80), validationStatus: optionalText(row.validationStatus, 80),
      acquisitionMethod: optionalText(row.acquisitionMethod, 120), confidence: confidence(row.confidence),
      ...(row.evidenceSupport !== undefined ? { evidenceSupport: validateEvidenceSupport(row.evidenceSupport,
        { sourceId }) } : {}),
      lineageRef: optionalText(row.lineageRef, 1000) })
  }
  if (evidence.size !== admitted.size) fail()
  const sourceIds = new Set([...evidence.values()].map(row => row.sourceId))
  const registry = indexSources(sourceRegistry, sourceIds)
  const lineage = indexSources(lineageSources, sourceIds)
  assertControlledReplayProvenancePairs({ sources: [...registry.values()],
    evidenceObjects: evidenceObjects.filter(row => admitted.has(identity(row?.evidenceObjectId))) })
  for (const sourceId of sourceIds) {
    const source = registry.get(sourceId), origin = lineage.get(sourceId)
    if (source && origin && !isDeepStrictEqual(projectControlledReplayProvenance(source), projectControlledReplayProvenance(origin))) fail()
  }
  assertSourceEvidenceMetadataPairs({ sources: [...registry.values()],
    evidenceObjects: evidenceObjects.filter(row => admitted.has(identity(row?.evidenceObjectId))) })
  const sources = [...sourceIds].sort().map(sourceId => {
    const source = registry.get(sourceId)
    const origin = lineage.get(sourceId)
    return { sourceId, sourceRecordStatus: source ? 'AVAILABLE' : 'UNAVAILABLE',
      ...(source ? projectControlledReplayProvenance(source) : {}),
      ...(source?.sourceCapture !== undefined ? { sourceCapture: validateSourceCapture(source.sourceCapture,
        { sourceId, contentHash: source.contentHash }) } : {}),
      recordedSourceType: optionalText(source?.sourceType, 100),
      recordedAcquisitionStatus: optionalText(source?.acquisitionStatus, 80),
      recordedAcquisitionProfile: optionalText(source?.acquisitionProfile, 120),
      recordedContentHash: optionalText(source?.contentHash, 71),
      recordedLineageRef: optionalText(source?.lineageRef, 1000),
      recordedLineageSourceType: optionalText(origin?.type, 100),
      recordedLineageStatus: optionalText(origin?.status, 80),
      recordedLineageAcquisitionMethod: optionalText(origin?.acquisitionMethod, 120),
      recordedExtractionMethod: optionalText(origin?.extractionMethod, 120),
      recordedIngestionMode: optionalText(origin?.ingestionMode, 120), sourceReview: sourceReview(source) }
  })
  return { contractVersion: SECTION_EVIDENCE_QUALIFICATION_VERSION,
    claimBoundaryPolicy: { ...SECTION_CLAIM_BOUNDARY_POLICY },
    evidence: [...evidence.values()].sort((a, b) => a.evidenceObjectId.localeCompare(b.evidenceObjectId)), sources }
}
