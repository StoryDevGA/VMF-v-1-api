import { createHash } from 'node:crypto'
import { getUnresolvedDiscoveryContradictions } from './discoveryContradictionReviewService.js'

export const OUTCOME_STUDIO_EVIDENCE_COMPOSITION_CONTRACT =
  'outcome-studio.evidence-to-composition.v1'

export const OUTCOME_STUDIO_COMPOSITION_BLOCKERS = Object.freeze({
  INPUT_INVALID: 'COMPOSITION_INPUT_INVALID',
  RUNTIME_NOT_LOCKED: 'COMPOSITION_RUNTIME_NOT_LOCKED',
  TRUTH_NOT_CURRENT: 'COMPOSITION_TRUTH_NOT_CURRENT',
  CONTRADICTION_UNRESOLVED: 'COMPOSITION_CONTRADICTION_UNRESOLVED',
  OUTPUT_BINDING_INCOMPLETE: 'COMPOSITION_OUTPUT_BINDING_INCOMPLETE',
  EVIDENCE_UNAVAILABLE: 'COMPOSITION_EVIDENCE_UNAVAILABLE',
  FACTS_UNAVAILABLE: 'COMPOSITION_FACTS_UNAVAILABLE',
})

const normalizeText = (value) => String(value ?? '').trim()
const normalizeIdentity = (value) => typeof value === 'string'
  ? normalizeText(value).normalize('NFKC').replace(/\s+/g, ' ')
  : ''
const normalizeKey = (value) => normalizeText(value).toLowerCase()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const isPlainObject = (value) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype,
)

const hashValue = (value) => createHash('sha256')
  .update(JSON.stringify(value), 'utf8')
  .digest('hex')

const block = (reason, details = {}) => {
  const error = new Error('Outcome Studio evidence composition is blocked.')
  error.status = 409
  error.code = 'OUTCOME_STUDIO_COMPOSITION_BLOCKED'
  error.reason = reason
  error.details = details
  throw error
}

const getEvidencePack = (frameworkState = {}) => frameworkState.evidence_pack || {}

const getCanonicalEligibility = (frameworkState = {}) => (
  frameworkState.lock?.outputEligibility
  || frameworkState.lock?.output_eligibility
  || {}
)

const getRuntimeBinding = (runtimeInstance = {}) => ({
  runtimeInstanceId: normalizeText(runtimeInstance._id || runtimeInstance.id),
  runtimeInstanceKey: normalizeText(runtimeInstance.runtimeInstanceKey),
  runtimeType: normalizeToken(runtimeInstance.runtimeType),
  frameworkKey: normalizeToken(runtimeInstance.frameworkKey),
  packageKey: normalizeText(runtimeInstance.packageKey),
  packageVersion: normalizeText(runtimeInstance.packageVersion),
  revisionNumber: Number(
    runtimeInstance.revision?.revisionNumber
      || runtimeInstance.currentRevisionNumber
      || 0,
  ),
  runtimeRevision: normalizeText(
    runtimeInstance.runtimeRevision
      || runtimeInstance.revisionNumber
      || runtimeInstance.updatedAt,
  ),
})

const assertRuntimeBinding = ({ runtimeInstance, frameworkState }) => {
  const runtimeBinding = getRuntimeBinding(runtimeInstance)
  const eligibility = getCanonicalEligibility(frameworkState)
  if (!runtimeBinding.runtimeInstanceId
    || !runtimeBinding.runtimeInstanceKey
    || !runtimeBinding.runtimeType
    || !runtimeBinding.frameworkKey
    || !runtimeBinding.packageKey
    || !runtimeBinding.packageVersion
    || !Number.isInteger(runtimeBinding.revisionNumber)
    || runtimeBinding.revisionNumber < 1) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.INPUT_INVALID, {
      field: 'runtimeBinding',
    })
  }
  if (normalizeToken(runtimeInstance.status) !== 'LOCKED'
    || eligibility.locked === false
    || eligibility.outputEligible !== true
    || eligibility.canonicalOutputEligible !== true) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.RUNTIME_NOT_LOCKED, {
      runtimeInstanceKey: runtimeBinding.runtimeInstanceKey,
      eligibilityState: normalizeToken(eligibility.state),
    })
  }
  return runtimeBinding
}

const getTruthIdentity = (truthBinding = {}) => {
  const evidence = isPlainObject(truthBinding.evidence) ? truthBinding.evidence : {}
  return {
    truthSignatureId: normalizeText(truthBinding.truthSignatureId),
    truthStatus: normalizeToken(truthBinding.status || truthBinding.truthStatus),
    currentness: normalizeToken(truthBinding.currentness || evidence.currentness),
    runtimeInstanceId: normalizeText(truthBinding.runtimeInstanceId || evidence.runtimeInstanceId),
    runtimeInstanceKey: normalizeText(truthBinding.runtimeInstanceKey || evidence.runtimeInstanceKey),
    handoffHash: normalizeText(truthBinding.handoffHash || evidence.handoffHash),
    handoffStatus: normalizeToken(truthBinding.handoffStatus || evidence.frameworkHandoff?.status),
    sourceOutputAssetId: normalizeText(truthBinding.sourceOutputAssetId || evidence.sourceOutputAssetId),
    sourceOutputTypeKey: normalizeToken(truthBinding.sourceOutputTypeKey || evidence.sourceOutputTypeKey),
    evidenceVersion: normalizeText(truthBinding.evidenceVersion || evidence.evidenceVersion),
    sectionTruthVersion: normalizeText(truthBinding.sectionTruthVersion || evidence.sectionTruthVersion),
    lockSnapshotId: normalizeText(truthBinding.lockSnapshotId || evidence.lockSnapshotId),
    lockSnapshotHash: normalizeText(truthBinding.lockSnapshotHash || evidence.lockSnapshotHash),
    replayAnchorId: normalizeText(truthBinding.replayAnchorId || evidence.replayAnchorId),
    replayAnchorHash: normalizeText(truthBinding.replayAnchorHash || evidence.replayAnchorHash),
    graphVersion: normalizeText(truthBinding.graphVersion || evidence.graphVersion),
    graphHash: normalizeText(truthBinding.graphHash || evidence.graphHash),
  }
}

const assertLineageBinding = ({ runtimeInstance, frameworkState, truthBinding }) => {
  const runtimeBinding = getRuntimeBinding(runtimeInstance)
  const eligibility = getCanonicalEligibility(frameworkState)
  const evidencePack = getEvidencePack(frameworkState)
  const lock = isPlainObject(frameworkState.lock) ? frameworkState.lock : {}
  const lockSnapshot = isPlainObject(lock.snapshot) ? lock.snapshot : {}
  const replayAnchor = isPlainObject(lock.replayAnchor)
    ? lock.replayAnchor
    : (isPlainObject(lock.anchor) ? lock.anchor : {})
  const graph = isPlainObject(frameworkState.intelligence_graph)
    ? frameworkState.intelligence_graph
    : (isPlainObject(frameworkState.graph) ? frameworkState.graph : {})
  const evidenceLineage = isPlainObject(evidencePack.lineage) ? evidencePack.lineage : {}
  const sections = isPlainObject(frameworkState.sections) ? frameworkState.sections : {}
  const truthIdentity = getTruthIdentity(truthBinding)
  const runtimeIdentity = {
    lockSnapshotId: normalizeText(
      eligibility.snapshotId
        || eligibility.lockSnapshotId
        || lockSnapshot.snapshotId,
    ),
    lockSnapshotHash: normalizeText(
      eligibility.snapshotHash
        || eligibility.lockSnapshotHash
        || lockSnapshot.snapshotHash,
    ),
    replayAnchorId: normalizeText(
      eligibility.replayAnchorId
        || replayAnchor.replayAnchorId
        || replayAnchor.anchorId,
    ),
    replayAnchorHash: normalizeText(
      eligibility.replayAnchorHash
        || replayAnchor.replayAnchorHash
        || replayAnchor.anchorHash,
    ),
    graphVersion: normalizeText(
      graph.graphVersion
        || graph.version
        || frameworkState.graphVersion,
    ),
    graphHash: normalizeText(
      graph.graphHash
        || graph.hash
        || frameworkState.graphHash,
    ),
    evidenceVersion: normalizeText(
      evidencePack.evidenceVersion
        || evidenceLineage.evidenceVersion
        || evidenceLineage.builder?.version,
    ),
    sectionTruthVersion: normalizeText(
      frameworkState.sectionTruthVersion
        || frameworkState.section_truth_version
        || sections.sectionTruthVersion
        || sections.truthVersion,
    ),
  }
  const missingFields = [
    ['truthSignatureId', truthIdentity.truthSignatureId],
    ['truthStatus', truthIdentity.truthStatus],
    ['truthRuntimeInstanceId', truthIdentity.runtimeInstanceId],
    ['truthRuntimeInstanceKey', truthIdentity.runtimeInstanceKey],
    ['handoffHash', truthIdentity.handoffHash],
    ['handoffStatus', truthIdentity.handoffStatus],
    ['sourceOutputAssetId', truthIdentity.sourceOutputAssetId],
    ['sourceOutputTypeKey', truthIdentity.sourceOutputTypeKey],
    ['evidenceVersion', truthIdentity.evidenceVersion],
    ['sectionTruthVersion', truthIdentity.sectionTruthVersion],
    ['truthLockSnapshotId', truthIdentity.lockSnapshotId],
    ['truthLockSnapshotHash', truthIdentity.lockSnapshotHash],
    ['truthReplayAnchorId', truthIdentity.replayAnchorId],
    ['truthReplayAnchorHash', truthIdentity.replayAnchorHash],
    ['lockSnapshotId', runtimeIdentity.lockSnapshotId],
    ['lockSnapshotHash', runtimeIdentity.lockSnapshotHash],
    ['replayAnchorId', runtimeIdentity.replayAnchorId],
    ['replayAnchorHash', runtimeIdentity.replayAnchorHash],
    ['graphVersion', truthIdentity.graphVersion],
    ['graphHash', truthIdentity.graphHash],
    ['frameworkGraphVersion', runtimeIdentity.graphVersion],
    ['frameworkGraphHash', runtimeIdentity.graphHash],
    ['frameworkEvidenceVersion', runtimeIdentity.evidenceVersion],
    ['frameworkSectionTruthVersion', runtimeIdentity.sectionTruthVersion],
  ].filter(([, value]) => !value).map(([field]) => field)
  if (missingFields.length > 0) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.INPUT_INVALID, { missingFields })
  }
  if (!['PROJECTED', 'READY', 'READY_WITH_GAPS'].includes(truthIdentity.truthStatus)
    || !['READY', 'READY_WITH_GAPS'].includes(truthIdentity.handoffStatus)
    || truthIdentity.currentness !== 'CURRENT'
    || truthIdentity.runtimeInstanceId !== runtimeBinding.runtimeInstanceId
    || truthIdentity.runtimeInstanceKey !== runtimeBinding.runtimeInstanceKey) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.TRUTH_NOT_CURRENT, {
      truthStatus: truthIdentity.truthStatus,
      handoffStatus: truthIdentity.handoffStatus,
      currentness: truthIdentity.currentness,
      runtimeInstanceId: truthIdentity.runtimeInstanceId,
      runtimeInstanceKey: truthIdentity.runtimeInstanceKey,
    })
  }
  const identityMismatches = [
    ['lockSnapshotId', truthIdentity.lockSnapshotId, runtimeIdentity.lockSnapshotId],
    ['lockSnapshotHash', truthIdentity.lockSnapshotHash, runtimeIdentity.lockSnapshotHash],
    ['replayAnchorId', truthIdentity.replayAnchorId, runtimeIdentity.replayAnchorId],
    ['replayAnchorHash', truthIdentity.replayAnchorHash, runtimeIdentity.replayAnchorHash],
    ['graphVersion', truthIdentity.graphVersion, runtimeIdentity.graphVersion],
    ['graphHash', truthIdentity.graphHash, runtimeIdentity.graphHash],
    ['evidenceVersion', truthIdentity.evidenceVersion, runtimeIdentity.evidenceVersion],
    ['sectionTruthVersion', truthIdentity.sectionTruthVersion, runtimeIdentity.sectionTruthVersion],
  ].filter(([, truthValue, runtimeValue]) => truthValue !== runtimeValue)
  if (identityMismatches.length > 0) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.TRUTH_NOT_CURRENT, {
      identityMismatches: identityMismatches.map(([field]) => field),
    })
  }
  return {
    ...truthIdentity,
    lockSnapshotId: runtimeIdentity.lockSnapshotId,
    lockSnapshotHash: runtimeIdentity.lockSnapshotHash,
    replayAnchorId: runtimeIdentity.replayAnchorId,
    replayAnchorHash: runtimeIdentity.replayAnchorHash,
    graphVersion: runtimeIdentity.graphVersion,
    graphHash: runtimeIdentity.graphHash,
    evidenceVersion: runtimeIdentity.evidenceVersion,
    sectionTruthVersion: runtimeIdentity.sectionTruthVersion,
  }
}

const assertTruthBinding = ({ runtimeInstance, frameworkState, truthBinding = {} }) => {
  const lineageBinding = assertLineageBinding({ runtimeInstance, frameworkState, truthBinding })
  const evidencePack = getEvidencePack(frameworkState)
  const currentness = normalizeToken(lineageBinding.currentness)
  const unresolvedContradictionCount = Number(
    truthBinding.unresolvedContradictionCount
      ?? truthBinding.evidence?.unresolvedContradictionCount,
  )
  const contradictionCandidates = getUnresolvedDiscoveryContradictions(evidencePack, String(runtimeInstance?._id || runtimeInstance?.id || ''))
  if (currentness !== 'CURRENT' || evidencePack.needsRefresh === true) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.TRUTH_NOT_CURRENT, {
      currentness: currentness || 'UNSPECIFIED',
      needsRefresh: evidencePack.needsRefresh === true,
    })
  }
  if (!Number.isInteger(unresolvedContradictionCount) || unresolvedContradictionCount < 0) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.TRUTH_NOT_CURRENT, {
      field: 'truthBinding.unresolvedContradictionCount',
    })
  }
  if (unresolvedContradictionCount > 0) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.CONTRADICTION_UNRESOLVED, {
      unresolvedContradictionCount,
    })
  }
  if (Array.isArray(contradictionCandidates) && contradictionCandidates.length > 0) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.CONTRADICTION_UNRESOLVED, {
      contradictionCandidateCount: contradictionCandidates.length,
    })
  }
  return {
    ...lineageBinding,
    currentness: 'CURRENT',
    unresolvedContradictionCount,
    handoffVersion: normalizeText(truthBinding.handoffVersion),
    lockSnapshotHash: normalizeText(truthBinding.lockSnapshotHash),
    evidenceVersion: lineageBinding.evidenceVersion,
    sectionTruthVersion: lineageBinding.sectionTruthVersion,
  }
}

const getRequiredSections = (knowledgeContext = {}) => {
  const outputSchema = knowledgeContext.outputSchema || {}
  const contextRequiredSections = Array.isArray(knowledgeContext.requiredSections)
    ? knowledgeContext.requiredSections
    : null
  const schemaRequiredSections = Array.isArray(outputSchema.requiredSections)
    ? outputSchema.requiredSections
    : null
  const contextSections = contextRequiredSections?.map(normalizeKey).filter(Boolean) || []
  const schemaSections = schemaRequiredSections?.map(normalizeKey).filter(Boolean) || []
  if (contextRequiredSections && schemaRequiredSections
    && JSON.stringify(contextSections) !== JSON.stringify(schemaSections)) {
    return { requiredSections: [], conflict: true }
  }
  const requiredSections = contextRequiredSections || schemaRequiredSections || []
  return {
    requiredSections: requiredSections.map(normalizeKey).filter(Boolean),
    conflict: false,
  }
}

const assertOutputBinding = ({ knowledgeContext = {}, requestedOutputTypeKey }) => {
  const outputType = knowledgeContext.outputType || {}
  const outputSchema = knowledgeContext.outputSchema || {}
  const style = knowledgeContext.style || {}
  const outputTypeKey = normalizeKey(outputType.key || requestedOutputTypeKey)
  const requestedKey = normalizeKey(requestedOutputTypeKey)
  const sectionResolution = getRequiredSections(knowledgeContext)
  const requiredSections = sectionResolution.requiredSections
  const rawOptionalSections = outputSchema.optionalSections === undefined ? [] : outputSchema.optionalSections
  const optionalSectionsValid = Array.isArray(rawOptionalSections)
    && rawOptionalSections.length <= 12
    && rawOptionalSections.every((heading) => typeof heading === 'string' && heading.trim() && heading.length <= 160)
  const optionalSections = optionalSectionsValid ? rawOptionalSections.map(normalizeKey) : []
  const normalizedSections = [...requiredSections, ...optionalSections].map((heading) => heading.replace(/\s+/g, ' '))
  const outputTypeStructure = Array.isArray(knowledgeContext.outputTypeStructure)
    ? knowledgeContext.outputTypeStructure.map(normalizeText).filter(Boolean)
    : []
  const lineage = knowledgeContext.lineage || {}
  const lineageTokens = [
    ...(Array.isArray(lineage.versionIds) ? lineage.versionIds : []),
    ...(Array.isArray(lineage.contentHashes) ? lineage.contentHashes : []),
  ].map(normalizeText).filter(Boolean)
  if (!knowledgeContext.available
    || normalizeToken(knowledgeContext.status) !== 'READY'
    || !requestedKey
    || outputTypeKey !== requestedKey
    || !normalizeText(outputSchema.key)
    || !normalizeText(outputSchema.version)
    || !normalizeText(style.key)
    || !normalizeText(style.version)
    || !normalizeText(outputType.version)
    || sectionResolution.conflict
    || !optionalSectionsValid
    || new Set(normalizedSections).size !== normalizedSections.length
    || outputTypeStructure.length !== 5
    || requiredSections.length === 0
    || new Set(requiredSections).size !== requiredSections.length
    || lineageTokens.length === 0) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.OUTPUT_BINDING_INCOMPLETE, {
      requestedOutputTypeKey: requestedKey,
      outputTypeKey,
      requiredSectionCount: requiredSections.length,
    })
  }
  return {
    outputTypeKey,
    outputTypeLabel: normalizeText(outputType.label),
    outputTypeVersion: normalizeText(outputType.version),
    outputTypeStructure,
    outputSchemaKey: normalizeKey(outputSchema.key),
    outputSchemaVersion: normalizeText(outputSchema.version),
    styleKey: normalizeKey(style.key),
    styleVersion: normalizeText(style.version),
    requiredSections,
    optionalSections,
    lineage,
  }
}

const getStatement = (evidence = {}) => {
  const extractedFact = evidence.extractedFact
  if (typeof extractedFact === 'string') return normalizeText(extractedFact)
  if (isPlainObject(extractedFact)) {
    for (const key of ['statement', 'content', 'text', 'value', 'summary']) {
      if (typeof extractedFact[key] === 'string' && extractedFact[key].trim()) {
        return normalizeText(extractedFact[key])
      }
    }
  }
  for (const key of ['statement', 'content', 'text', 'summary']) {
    if (typeof evidence[key] === 'string' && evidence[key].trim()) return normalizeText(evidence[key])
  }
  return ''
}

const getSourceRegistryId = (source = {}) => normalizeText(
  source.sourceId || source.id || source.sourceRef || source.sourceKey,
)

const buildSourceAttribution = ({ evidence, sourceRegistryById }) => {
  const sourceId = normalizeIdentity(evidence.sourceId)
  const source = sourceRegistryById.get(sourceId) || {}
  return {
    sourceId,
    sourceType: normalizeText(source.sourceType || source.type),
    sourceLabel: normalizeText(source.label || source.filename || source.name),
    sourceHash: normalizeText(source.sourceHash || source.hash),
  }
}

const claimBoundary = /\b(?:roi|return on investment|financial impact|financial result|named customer|customer proof|case study|market leader|category leader|proprietary advantage|revenue|profit)\b/i
const quantifiedClaimBoundary = /(?:\b\d+(?:\.\d+)?\s*%|\b(?:growth|grew|increased|decreased|improved|conversion rate|win rate|uplift|doubled|tripled)\b)/i
const administrativeContent = /\b(?:ignore previous|system prompt|developer message|administrative instruction|api key|password|secret|bearer token|upload this|database instruction)\b/i
const fragmentClassification = new Set(['FRAGMENT', 'RAW_EXTRACTION', 'ADMINISTRATIVE'])

const isWebsiteSourcePointer = (statement) => {
  const match = /^(?:company website:\s*)?(https?:\/\/\S+)$/i.exec(statement)
  if (!match) return false
  try {
    const url = new URL(match[1])
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname)
  } catch {
    return false
  }
}

const classifyEvidence = (evidence, statement) => {
  const classification = normalizeToken(evidence.classification || evidence.category)
  if (fragmentClassification.has(classification)) return 'FRAGMENT_OR_ADMINISTRATIVE'
  if (isWebsiteSourcePointer(statement)) return 'SOURCE_POINTER_NOT_A_BUSINESS_FACT'
  if (statement.length < 12 || !/\s/.test(statement)) return 'FRAGMENT_OR_ADMINISTRATIVE'
  if (administrativeContent.test(statement)) return 'ADMINISTRATIVE_CONTENT'
  if (claimBoundary.test(statement) || quantifiedClaimBoundary.test(statement)) return 'UNSUPPORTED_CLAIM_CATEGORY'
  return ''
}

const resolveReference = ({ reference, byEvidenceId, bySourceId }) => {
  const evidenceMatch = byEvidenceId.get(reference)
  if (evidenceMatch) return { status: 'RESOLVED_EVIDENCE_OBJECT', evidence: evidenceMatch }
  const sourceMatches = bySourceId.get(reference) || []
  if (sourceMatches.length === 1) {
    return { status: 'SOURCE_ONLY_REFERENCE', sourceId: reference }
  }
  if (sourceMatches.length > 1) return { status: 'AMBIGUOUS_SOURCE_ID' }
  return { status: 'UNRESOLVED_REFERENCE' }
}

const addOmission = ({ omissions, omissionReasonCounts, reference, sectionKeys, reason }) => {
  omissions.push({ reference, sectionKeys: [...new Set(sectionKeys)].sort(), reason })
  omissionReasonCounts[reason] = (omissionReasonCounts[reason] || 0) + 1
}

const composeFacts = ({ frameworkState, truthBinding }) => {
  const evidencePack = getEvidencePack(frameworkState)
  const evidenceObjects = Array.isArray(evidencePack.evidenceObjects) ? evidencePack.evidenceObjects : []
  const sections = frameworkState.sections || {}
  if (evidenceObjects.length === 0 || Object.keys(sections).length === 0) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.EVIDENCE_UNAVAILABLE, {
      evidenceObjectCount: evidenceObjects.length,
      sectionCount: Object.keys(sections).length,
    })
  }

  const byEvidenceId = new Map()
  const bySourceId = new Map()
  for (const evidence of evidenceObjects) {
    const evidenceObjectId = normalizeIdentity(evidence.evidenceObjectId)
    const sourceId = normalizeIdentity(evidence.sourceId)
    if (evidenceObjectId) {
      if (byEvidenceId.has(evidenceObjectId)) {
        block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.INPUT_INVALID, {
          field: 'evidence_pack.evidenceObjects.evidenceObjectId',
          value: evidenceObjectId,
        })
      }
      byEvidenceId.set(evidenceObjectId, evidence)
    }
    if (sourceId) bySourceId.set(sourceId, [...(bySourceId.get(sourceId) || []), evidence])
  }
  const sourceRegistryById = new Map()
  for (const source of (Array.isArray(evidencePack.sourceRegistry) ? evidencePack.sourceRegistry : [])) {
    const sourceId = normalizeIdentity(getSourceRegistryId(source))
    if (!sourceId) continue
    if (sourceRegistryById.has(sourceId)) {
      block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.INPUT_INVALID, {
        field: 'evidence_pack.sourceRegistry.sourceId',
        value: sourceId,
      })
    }
    sourceRegistryById.set(sourceId, source)
  }
  const sectionKeysByEvidenceId = new Map()
  const references = []
  const omissions = []
  const omissionReasonCounts = {}

  for (const [sectionKey, section] of Object.entries(sections)) {
    const normalizedSectionKey = normalizeKey(sectionKey)
    const accepted = section?.accepted
    const refs = Array.isArray(accepted?.supportingEvidenceRefs)
      ? accepted.supportingEvidenceRefs
      : []
    for (const rawReference of refs) {
      const reference = typeof rawReference === 'string'
        ? normalizeIdentity(rawReference)
        : ''
      if (!reference) {
        addOmission({
          omissions,
          omissionReasonCounts,
          reference: '[INVALID_REFERENCE]',
          sectionKeys: [normalizedSectionKey],
          reason: 'INVALID_REFERENCE',
        })
        continue
      }
      const resolution = resolveReference({ reference, byEvidenceId, bySourceId })
      if (resolution.status === 'UNRESOLVED_REFERENCE') {
        addOmission({ omissions, omissionReasonCounts, reference, sectionKeys: [normalizedSectionKey], reason: 'REFERENCE_UNRESOLVED' })
        continue
      }
      if (resolution.status === 'AMBIGUOUS_SOURCE_ID') {
        addOmission({ omissions, omissionReasonCounts, reference, sectionKeys: [normalizedSectionKey], reason: 'SOURCE_REFERENCE_AMBIGUOUS' })
        continue
      }
      if (resolution.status === 'SOURCE_ONLY_REFERENCE') {
        addOmission({
          omissions,
          omissionReasonCounts,
          reference,
          sectionKeys: [normalizedSectionKey],
          reason: 'SOURCE_ONLY_REFERENCE_NOT_A_FACT',
        })
        continue
      }
      const evidence = resolution.evidence
      const evidenceObjectId = normalizeText(evidence.evidenceObjectId)
      if (!evidenceObjectId) {
        addOmission({ omissions, omissionReasonCounts, reference, sectionKeys: [normalizedSectionKey], reason: 'EVIDENCE_ID_MISSING' })
        continue
      }
      const currentSections = sectionKeysByEvidenceId.get(evidenceObjectId) || new Set()
      currentSections.add(normalizedSectionKey)
      sectionKeysByEvidenceId.set(evidenceObjectId, currentSections)
      references.push({ reference, resolution, evidenceObjectId, sectionKey: normalizedSectionKey })
    }
  }

  const factsByEvidenceId = new Map()
  for (const reference of references) {
    const evidence = reference.resolution.evidence
    const evidenceObjectId = reference.evidenceObjectId
    if (factsByEvidenceId.has(evidenceObjectId)) continue
    const reviewStatus = normalizeToken(evidence.reviewStatus)
    const validationStatus = normalizeToken(evidence.validationStatus)
    const sectionKeys = [...(sectionKeysByEvidenceId.get(evidenceObjectId) || [])].sort()
    if (reviewStatus !== 'ACCEPTED') {
      addOmission({ omissions, omissionReasonCounts, reference: evidenceObjectId, sectionKeys, reason: 'EVIDENCE_NOT_ACCEPTED' })
      factsByEvidenceId.set(evidenceObjectId, { omitted: true })
      continue
    }
    if (validationStatus !== 'VALIDATED') {
      addOmission({ omissions, omissionReasonCounts, reference: evidenceObjectId, sectionKeys, reason: 'EVIDENCE_NOT_VALIDATED' })
      factsByEvidenceId.set(evidenceObjectId, { omitted: true })
      continue
    }
    const statement = getStatement(evidence)
    if (!statement) {
      addOmission({ omissions, omissionReasonCounts, reference: evidenceObjectId, sectionKeys, reason: 'FACT_STATEMENT_MISSING' })
      factsByEvidenceId.set(evidenceObjectId, { omitted: true })
      continue
    }
    const classificationReason = classifyEvidence(evidence, statement)
    if (classificationReason) {
      addOmission({ omissions, omissionReasonCounts, reference: evidenceObjectId, sectionKeys, reason: classificationReason })
      factsByEvidenceId.set(evidenceObjectId, { omitted: true })
      continue
    }
    const evidenceCurrentness = normalizeToken(evidence.currentness)
    if (evidenceCurrentness && evidenceCurrentness !== 'CURRENT') {
      addOmission({ omissions, omissionReasonCounts, reference: evidenceObjectId, sectionKeys, reason: 'EVIDENCE_NOT_CURRENT' })
      factsByEvidenceId.set(evidenceObjectId, { omitted: true })
      continue
    }
    if (evidence.needsRefresh === true || evidence.isStale === true || evidence.stale === true) {
      addOmission({ omissions, omissionReasonCounts, reference: evidenceObjectId, sectionKeys, reason: 'EVIDENCE_NOT_CURRENT' })
      factsByEvidenceId.set(evidenceObjectId, { omitted: true })
      continue
    }
    const sourceAttribution = buildSourceAttribution({ evidence, sourceRegistryById })
    if (!sourceAttribution.sourceId || !normalizeText(evidence.lineageRef)) {
      addOmission({ omissions, omissionReasonCounts, reference: evidenceObjectId, sectionKeys, reason: 'PROVENANCE_INCOMPLETE' })
      factsByEvidenceId.set(evidenceObjectId, { omitted: true })
      continue
    }
    if (!sourceRegistryById.has(sourceAttribution.sourceId)) {
      addOmission({ omissions, omissionReasonCounts, reference: evidenceObjectId, sectionKeys, reason: 'PROVENANCE_SOURCE_UNREGISTERED' })
      factsByEvidenceId.set(evidenceObjectId, { omitted: true })
      continue
    }
    const fact = {
      evidenceObjectId,
      sourceId: sourceAttribution.sourceId,
      sectionKeys,
      statement,
      extractedFact: statement,
      reviewStatus,
      validationStatus,
      confidence: evidence.confidence ?? evidence.confidenceScore ?? null,
      materiality: evidence.materiality ?? evidence.materialityScore ?? null,
      currentness: evidenceCurrentness || truthBinding.currentness,
      provenance: {
        lineageRef: normalizeText(evidence.lineageRef),
        sourceRegistryRef: sourceAttribution.sourceId,
      },
      claimPermission: 'SUPPORTED_FACT_ONLY',
      qualification: Array.isArray(evidence.confidenceWarnings)
        ? evidence.confidenceWarnings.map(normalizeText).filter(Boolean).sort()
        : [],
      selectionReason: 'ACCEPTED_VALIDATED_TYPED_REFERENCE',
    }
    fact.factId = `fact_${hashValue({ evidenceObjectId, sourceId: fact.sourceId, sectionKeys, statement }).slice(0, 24)}`
    factsByEvidenceId.set(evidenceObjectId, fact)
  }

  const candidateFacts = [...factsByEvidenceId.values()].filter((fact) => !fact.omitted)
  const byStatement = new Map()
  for (const fact of candidateFacts) {
    const identity = normalizeText(fact.statement).toLowerCase().replace(/\s+/g, ' ')
    byStatement.set(identity, [...(byStatement.get(identity) || []), fact])
  }
  const facts = []
  for (const group of byStatement.values()) {
    if (group.length > 1) {
      for (const fact of group) {
        addOmission({
          omissions,
          omissionReasonCounts,
          reference: fact.evidenceObjectId,
          sectionKeys: fact.sectionKeys,
          reason: 'DUPLICATE_UNRECONCILED',
        })
      }
      continue
    }
    facts.push(group[0])
  }
  facts.sort((left, right) => left.factId.localeCompare(right.factId))
  omissions.sort((left, right) => `${left.reference}:${left.reason}`.localeCompare(`${right.reference}:${right.reason}`))
  return {
    facts,
    omissions,
    contradictions: [],
    diagnostics: {
      evidenceObjectCount: evidenceObjects.length,
      referencedEvidenceObjectCount: references.length,
      admittedFactCount: facts.length,
      omittedReferenceCount: omissions.length,
      omissionReasonCounts,
      contradictionCandidateCount: Array.isArray(evidencePack.discoveryHealth?.contradictionCandidates)
        ? evidencePack.discoveryHealth.contradictionCandidates.length
        : 0,
    },
  }
}

export const buildOutcomeStudioEvidenceComposition = ({
  runtimeInstance = {},
  frameworkState = runtimeInstance.framework_state || {},
  truthBinding = {},
  knowledgeContext = {},
  requestedOutputTypeKey = '',
  userPrompt = '',
} = {}) => {
  const prompt = normalizeText(userPrompt)
  if (!prompt || !normalizeText(requestedOutputTypeKey)) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.INPUT_INVALID, {
      fields: ['userPrompt', 'requestedOutputTypeKey'],
    })
  }
  const runtimeBinding = assertRuntimeBinding({ runtimeInstance, frameworkState })
  const resolvedTruthBinding = assertTruthBinding({ runtimeInstance, frameworkState, truthBinding })
  const outputBinding = assertOutputBinding({ knowledgeContext, requestedOutputTypeKey })
  const ledger = composeFacts({ frameworkState, truthBinding: resolvedTruthBinding })
  if (ledger.facts.length === 0) {
    block(OUTCOME_STUDIO_COMPOSITION_BLOCKERS.FACTS_UNAVAILABLE, {
      omissionReasonCounts: ledger.diagnostics.omissionReasonCounts,
    })
  }
  return {
    contractVersion: OUTCOME_STUDIO_EVIDENCE_COMPOSITION_CONTRACT,
    status: 'READY',
    runtimeBinding,
    requestBinding: {
      requestedOutputTypeKey: normalizeKey(requestedOutputTypeKey),
      userIntent: prompt,
      requestFingerprint: hashValue({
        runtimeInstanceKey: runtimeBinding.runtimeInstanceKey,
        requestedOutputTypeKey: normalizeKey(requestedOutputTypeKey),
        userIntent: prompt,
      }),
    },
    truthBinding: resolvedTruthBinding,
    outputBinding,
    businessFactLedger: {
      facts: ledger.facts,
      omitted: ledger.omissions,
      contradictions: ledger.contradictions,
    },
    diagnostics: ledger.diagnostics,
    nextBoundary: 'PROVIDER_SAFE_REQUEST_ASSEMBLY_PENDING',
  }
}
