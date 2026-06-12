import { FrameworkPackage } from '../models/index.js'
import { RUNTIME_TYPES } from '../models/RuntimeInstance.js'
import {
  TRUTH_CERTIFICATION_LEVELS,
  TRUTH_QUALITY_BANDS,
  TRUTH_QUALITY_CONTRACT_VERSION,
  TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS,
  TRUTH_QUALITY_DIMENSION_SOURCES,
  TRUTH_QUALITY_ERROR_REASONS,
} from '../constants/runtimeTruthQuality.js'
import {
  buildRuntimeIntelligenceGraphProjection,
  buildRuntimeIntelligenceGraphQueryProjection,
} from './runtimeIntelligenceGraphService.js'
import {
  getRuntimeInstance,
  toIdString,
} from './runtimeInstanceService.js'
import auditService from './auditService.js'

const ACCEPTED_REVIEW_STATUS = 'ACCEPTED'
const REJECTED_REVIEW_STATUS = 'REJECTED'
const PENDING_REVIEW_STATUS = 'PENDING'

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeKey = (value) => normalizeText(value).toLowerCase()

const isPlainObject = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const cloneValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const clampNumber = (value, min = 0, max = 100) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return min
  return Math.min(max, Math.max(min, Math.round(numeric)))
}

const getObjectValue = (source, key) => {
  if (!source || !key || typeof source !== 'object') return undefined
  if (source instanceof Map) return source.get(key)
  if (typeof source.get === 'function') {
    const value = source.get(key)
    if (value !== undefined) return value
  }
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined
}

const getValueAtPath = (source, path) => {
  const parts = normalizeText(path).split('.').filter(Boolean)
  if (parts.length === 0) return undefined

  let cursor = source
  for (const part of parts) {
    cursor = getObjectValue(cursor, part)
    if (cursor === undefined || cursor === null) return cursor
  }
  return cursor
}

const getFrameworkState = (runtimeInstance = {}) =>
  runtimeInstance.framework_state || runtimeInstance.frameworkState || {}

const getEvidencePack = (frameworkState = {}) =>
  frameworkState.evidence_pack || frameworkState.evidencePack || {}

const createTruthQualityError = ({
  status,
  code,
  message,
  reason,
  details = {},
}) => {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.details = {
    reason,
    ...details,
  }
  return err
}

const failAuditClosed = (err, details = {}) =>
  createTruthQualityError({
    status: 500,
    code: 'TRUTH_QUALITY_AUDIT_FAILED',
    message: 'Truth Quality evaluation audit could not be persisted.',
    reason: TRUTH_QUALITY_ERROR_REASONS.TRUTH_QUALITY_AUDIT_PERSISTENCE_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

const resolveMaybeLean = async (query) => {
  if (!query) return null
  return typeof query.lean === 'function' ? await query.lean() : await query
}

const resolveFrameworkPackage = async (runtimeInstance) => {
  const packageId = runtimeInstance?.packageId || runtimeInstance?.frameworkPackageId
  if (!packageId) return null
  return await resolveMaybeLean(FrameworkPackage.findById(packageId))
}

const getAcceptedContent = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return normalizeText(value)
  const content = getObjectValue(value, 'content')
  const summary = getObjectValue(value, 'summary')
  const acceptedValue = getObjectValue(value, 'value')
  if (typeof content === 'string') return normalizeText(content)
  if (typeof summary === 'string') return normalizeText(summary)
  if (typeof acceptedValue === 'string') return normalizeText(acceptedValue)
  return ''
}

const getSectionLabel = (section = {}, fallback = '') =>
  normalizeText(getObjectValue(section, 'label'))
  || normalizeText(getObjectValue(section, 'title'))
  || normalizeText(getObjectValue(section, 'name'))
  || normalizeText(getObjectValue(section, 'sectionLabel'))
  || normalizeText(getObjectValue(section, 'sectionKey'))
  || fallback

const getAcceptedTruthRecords = ({ frameworkPackage, frameworkState }) => {
  const packageSections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  const runtimeSections = isPlainObject(frameworkState.sections) ? frameworkState.sections : {}
  const sectionDefinitions = packageSections.length > 0
    ? packageSections
    : Object.keys(runtimeSections).map((sectionKey) => ({
        sectionKey,
        runtimePath: `framework_state.sections.${sectionKey}`,
        label: sectionKey.replace(/[_-]+/g, ' '),
      }))

  return sectionDefinitions.map((packageSection, index) => {
    const sectionKey = normalizeKey(
      getObjectValue(packageSection, 'sectionKey')
      || getObjectValue(packageSection, 'key'),
    )
    const runtimePath = normalizeText(getObjectValue(packageSection, 'runtimePath'))
    const runtimePathSection = runtimePath
      ? getValueAtPath({ framework_state: frameworkState }, runtimePath)
      : null
    const runtimeSection = runtimePathSection || getObjectValue(runtimeSections, sectionKey) || {}
    const accepted = getObjectValue(runtimeSection, 'accepted') || {}
    const content = getAcceptedContent(accepted)

    return {
      sectionKey,
      runtimePath,
      label: getSectionLabel(packageSection, `Section ${index + 1}`),
      required: getObjectValue(packageSection, 'required') === true,
      content,
      acceptedAt: getObjectValue(accepted, 'acceptedAt') || null,
      truthHash: getObjectValue(accepted, 'truthHash') || '',
    }
  }).filter((record) => record.sectionKey || record.runtimePath || record.content)
}

const normalizeReviewStatus = (value, fallback = PENDING_REVIEW_STATUS) => {
  const normalized = normalizeToken(value)
  if (normalized === ACCEPTED_REVIEW_STATUS) return ACCEPTED_REVIEW_STATUS
  if (normalized === REJECTED_REVIEW_STATUS) return REJECTED_REVIEW_STATUS
  return fallback
}

const pushArrayValues = (target, source) => {
  if (!Array.isArray(source)) return
  source.forEach((item) => target.push(item))
}

const collectSourceRegistry = (frameworkState = {}) => {
  const evidencePack = getEvidencePack(frameworkState)
  const registry = []
  pushArrayValues(registry, evidencePack.sourceRegistry)
  pushArrayValues(registry, evidencePack.acquisition?.sourceRegistry)
  pushArrayValues(registry, evidencePack.lineage?.sources)
  const seen = new Set()

  return registry
    .filter((source) => isPlainObject(source))
    .map((source) => ({
      sourceId: normalizeText(source.sourceId || source.sectionDocumentId || source.lineageRef || source.id),
      sourceType: normalizeToken(source.sourceType || source.type || source.sourceKind || 'UNKNOWN'),
    }))
    .filter((source) => source.sourceId || source.sourceType)
    .filter((source) => {
      const dedupeKey = source.sourceId || source.sourceType
      if (!dedupeKey || seen.has(dedupeKey)) return false
      seen.add(dedupeKey)
      return true
    })
}

const collectEvidenceObjects = (frameworkState = {}) => {
  const evidencePack = getEvidencePack(frameworkState)
  const packAccepted = evidencePack?.needsRefresh !== true
    && evidencePack?.state?.needsRefresh !== true
    && (evidencePack.accepted === true || evidencePack?.state?.accepted === true)
  const evidenceObjects = []
  pushArrayValues(evidenceObjects, evidencePack.evidenceObjects)
  pushArrayValues(evidenceObjects, evidencePack.objects)
  pushArrayValues(evidenceObjects, evidencePack.acquisition?.evidenceObjects)

  const sections = isPlainObject(frameworkState.sections) ? frameworkState.sections : {}
  Object.values(sections).forEach((sectionValue) => {
    if (!isPlainObject(sectionValue)) return
    pushArrayValues(evidenceObjects, sectionValue.evidenceObjects)
    pushArrayValues(evidenceObjects, sectionValue.additionalEvidence?.evidenceObjects)
  })

  const seen = new Set()
  return evidenceObjects
    .filter((evidenceObject) => isPlainObject(evidenceObject))
    .map((evidenceObject, index) => {
      const explicitStatus = evidenceObject.reviewStatus || evidenceObject.status
      const reviewStatus = normalizeReviewStatus(
        explicitStatus,
        packAccepted ? ACCEPTED_REVIEW_STATUS : PENDING_REVIEW_STATUS,
      )
      const evidenceObjectId = normalizeText(
        evidenceObject.evidenceObjectId
        || evidenceObject.id
        || evidenceObject.lineageRef
        || `evidence-${index}`,
      )
      const sourceId = normalizeText(evidenceObject.sourceId || evidenceObject.sourceRef || evidenceObject.sectionDocumentId)
      const sourceType = normalizeToken(evidenceObject.sourceType || evidenceObject.acquisitionMethod || evidenceObject.type)
      const dedupeKey = evidenceObjectId || [
        sourceId,
        sourceType,
        normalizeText(evidenceObject.category || evidenceObject.coverageArea),
        normalizeText(evidenceObject.extractedFact || evidenceObject.summary),
      ].join('|')

      return {
        evidenceObjectId,
        sourceId,
        sourceType,
        reviewStatus,
        dedupeKey,
      }
    })
    .filter((record) => {
      if (!record.dedupeKey || seen.has(record.dedupeKey)) return false
      seen.add(record.dedupeKey)
      return true
    })
}

const getCoverageBand = (score) => {
  const normalizedScore = clampNumber(score)
  if (normalizedScore >= 90) return TRUTH_QUALITY_BANDS.VERY_HIGH
  if (normalizedScore >= 70) return TRUTH_QUALITY_BANDS.HIGH
  if (normalizedScore >= 40) return TRUTH_QUALITY_BANDS.MEDIUM
  return TRUTH_QUALITY_BANDS.LOW
}

const getConfidenceBand = (score, { acceptedEvidenceCount, acceptedTruthCount, supportingSourceCount, contradictionRisk }) => {
  if (acceptedEvidenceCount === 0 || acceptedTruthCount === 0) return TRUTH_QUALITY_BANDS.NONE
  if (acceptedEvidenceCount < 2 || supportingSourceCount < 2 || score < 40) return TRUTH_QUALITY_BANDS.LOW
  if (score >= 70 && ![
    TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.HIGH,
    TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.BLOCKING,
  ].includes(contradictionRisk)) {
    return TRUTH_QUALITY_BANDS.HIGH
  }
  return TRUTH_QUALITY_BANDS.MEDIUM
}

const getSourceDiversityBand = ({ sourceTypeCount, sourceRecordCount }) => {
  if (sourceTypeCount >= 3 || sourceRecordCount >= 5) return TRUTH_QUALITY_BANDS.HIGH
  if (sourceTypeCount >= 2 || sourceRecordCount >= 3) return TRUTH_QUALITY_BANDS.MEDIUM
  return TRUTH_QUALITY_BANDS.LOW
}

const getBandRank = (band) => ({
  [TRUTH_QUALITY_BANDS.NONE]: 0,
  [TRUTH_QUALITY_BANDS.LOW]: 1,
  [TRUTH_QUALITY_BANDS.MEDIUM]: 2,
  [TRUTH_QUALITY_BANDS.HIGH]: 3,
  [TRUTH_QUALITY_BANDS.VERY_HIGH]: 4,
}[band] ?? 0)

const evaluateCoverage = ({ coverageQuery }) => {
  const coverage = coverageQuery?.coverage || {}
  const score = clampNumber(coverage.coveragePercent)
  return {
    score,
    band: getCoverageBand(score),
    source: TRUTH_QUALITY_DIMENSION_SOURCES.DIG_COVERAGE,
    missingDomains: Array.isArray(coverage.missingDomains) ? coverage.missingDomains.slice(0, 10) : [],
  }
}

const evaluateContradictionRisk = ({ contradictionQuery }) => {
  if (contradictionQuery?.available !== true) {
    return {
      level: TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.BLOCKING,
      count: 0,
      unresolvedCount: 0,
      blocking: true,
      source: TRUTH_QUALITY_DIMENSION_SOURCES.DIG_CONTRADICTIONS,
      reason: contradictionQuery?.error?.code || 'CONTRADICTION_QUERY_UNAVAILABLE',
    }
  }

  const count = Number.isFinite(Number(contradictionQuery.contradictionCount))
    ? Number(contradictionQuery.contradictionCount)
    : Number(contradictionQuery.relationshipCount || 0)
  const acceptedTruthNodeContradictions = Array.isArray(contradictionQuery.nodes)
    ? contradictionQuery.nodes.filter((node) =>
        ['SECTION_TRUTH', 'PUBLISHED_TRUTH', 'CANONICAL_TRUTH'].includes(normalizeToken(node?.nodeType))).length
    : 0
  const unresolvedCount = count
  let level = TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.LOW
  if (acceptedTruthNodeContradictions > 0 || unresolvedCount >= 3) {
    level = TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.HIGH
  } else if (unresolvedCount > 0) {
    level = TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.MEDIUM
  }

  return {
    level,
    count,
    unresolvedCount,
    blocking: false,
    source: TRUTH_QUALITY_DIMENSION_SOURCES.DIG_CONTRADICTIONS,
  }
}

const evaluateSourceDiversity = ({ acceptedEvidenceObjects, sourceRegistry }) => {
  const sourceIds = new Set()
  const sourceTypes = new Set()

  sourceRegistry.forEach((source) => {
    if (source.sourceId) sourceIds.add(source.sourceId)
    if (source.sourceType && source.sourceType !== 'UNKNOWN') sourceTypes.add(source.sourceType)
  })

  acceptedEvidenceObjects.forEach((evidenceObject) => {
    if (evidenceObject.sourceId) sourceIds.add(evidenceObject.sourceId)
    if (evidenceObject.sourceType) sourceTypes.add(evidenceObject.sourceType)
  })

  const sourceRecordCount = sourceIds.size
  const sourceTypeCount = sourceTypes.size
  const band = getSourceDiversityBand({ sourceTypeCount, sourceRecordCount })
  const score = band === TRUTH_QUALITY_BANDS.HIGH
    ? Math.min(100, 70 + Math.min(sourceRecordCount, 10) * 3)
    : band === TRUTH_QUALITY_BANDS.MEDIUM
      ? 55
      : sourceRecordCount > 0
        ? 25
        : 0

  return {
    score,
    band,
    source: TRUTH_QUALITY_DIMENSION_SOURCES.SOURCE_REGISTRY,
    sourceTypeCount,
    sourceRecordCount,
    sourceTypes: Array.from(sourceTypes).sort(),
  }
}

const evaluateConfidence = ({
  acceptedEvidenceCount,
  acceptedTruthCount,
  contradictionRisk,
  sourceDiversity,
}) => {
  if (acceptedEvidenceCount === 0 || acceptedTruthCount === 0) {
    return {
      score: 0,
      band: TRUTH_QUALITY_BANDS.NONE,
      acceptedEvidenceCount,
      acceptedTruthCount,
      supportingSourceCount: sourceDiversity.sourceRecordCount,
      warnings: [
        acceptedEvidenceCount === 0 ? 'Accepted evidence is missing.' : '',
        acceptedTruthCount === 0 ? 'Accepted truth is missing.' : '',
      ].filter(Boolean),
    }
  }

  const evidenceScore = Math.min(36, acceptedEvidenceCount * 6)
  const truthScore = Math.min(24, acceptedTruthCount * 8)
  const sourceScore = Math.min(24, sourceDiversity.sourceRecordCount * 8)
  const diversityScore = Math.min(16, sourceDiversity.sourceTypeCount * 5)
  const contradictionPenalty = contradictionRisk.level === TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.HIGH
    ? 25
    : contradictionRisk.level === TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.MEDIUM
      ? 10
      : contradictionRisk.level === TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.BLOCKING
        ? 45
        : 0
  const score = clampNumber(evidenceScore + truthScore + sourceScore + diversityScore - contradictionPenalty)
  const band = getConfidenceBand(score, {
    acceptedEvidenceCount,
    acceptedTruthCount,
    supportingSourceCount: sourceDiversity.sourceRecordCount,
    contradictionRisk: contradictionRisk.level,
  })
  const warnings = []
  if (acceptedEvidenceCount < 2) warnings.push('Only one accepted evidence object supports this runtime truth.')
  if (sourceDiversity.sourceRecordCount < 2) warnings.push('Supporting sources are limited.')
  if (contradictionRisk.unresolvedCount > 0) warnings.push('Unresolved contradiction candidates reduce confidence.')

  return {
    score,
    band,
    acceptedEvidenceCount,
    acceptedTruthCount,
    supportingSourceCount: sourceDiversity.sourceRecordCount,
    warnings,
  }
}

const buildKnownGaps = ({
  coverage,
  confidence,
  sourceDiversity,
  contradictionRisk,
  graphAvailable,
}) => {
  const gaps = []
  if (!graphAvailable) {
    gaps.push({
      code: 'GRAPH_UNAVAILABLE',
      severity: 'HIGH',
      message: 'DIG graph evidence is unavailable for Truth Quality evaluation.',
    })
  }
  if (coverage.missingDomains.length > 0) {
    gaps.push({
      code: 'COVERAGE_GAPS',
      severity: coverage.score < 40 ? 'HIGH' : 'MEDIUM',
      message: 'DIG coverage reports missing evidence domains.',
      missingDomains: coverage.missingDomains,
    })
  }
  if (confidence.acceptedEvidenceCount === 0) {
    gaps.push({
      code: 'ACCEPTED_EVIDENCE_MISSING',
      severity: 'HIGH',
      message: 'No accepted evidence objects support this runtime truth.',
    })
  }
  if (confidence.acceptedTruthCount === 0) {
    gaps.push({
      code: 'ACCEPTED_TRUTH_MISSING',
      severity: 'HIGH',
      message: 'Accepted section truth is missing.',
    })
  }
  if (sourceDiversity.sourceRecordCount < 2) {
    gaps.push({
      code: 'SOURCE_DIVERSITY_LIMITED',
      severity: 'MEDIUM',
      message: 'Truth is supported by limited independent source records.',
    })
  }
  if (contradictionRisk.unresolvedCount > 0 || contradictionRisk.blocking) {
    gaps.push({
      code: contradictionRisk.blocking ? 'CONTRADICTION_QUERY_UNAVAILABLE' : 'CONTRADICTIONS_UNRESOLVED',
      severity: contradictionRisk.level === TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.HIGH ? 'HIGH' : 'MEDIUM',
      message: contradictionRisk.blocking
        ? 'Contradiction risk could not be evaluated from DIG.'
        : 'DIG reports unresolved contradiction candidates.',
    })
  }
  return gaps
}

const deriveCertification = ({
  coverage,
  confidence,
  sourceDiversity,
  contradictionRisk,
  graphAvailable,
}) => {
  let level = TRUTH_CERTIFICATION_LEVELS.UNCERTIFIED

  if (
    graphAvailable
    && confidence.acceptedEvidenceCount > 0
    && confidence.acceptedTruthCount > 0
  ) {
    if (
      coverage.score >= 85
      && confidence.band === TRUTH_QUALITY_BANDS.HIGH
      && sourceDiversity.band === TRUTH_QUALITY_BANDS.HIGH
      && contradictionRisk.level === TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.LOW
    ) {
      level = TRUTH_CERTIFICATION_LEVELS.STRATEGIC_TRUTH
    } else if (
      coverage.score >= 70
      && confidence.band === TRUTH_QUALITY_BANDS.HIGH
      && ![
        TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.HIGH,
        TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.BLOCKING,
      ].includes(contradictionRisk.level)
    ) {
      level = TRUTH_CERTIFICATION_LEVELS.CERTIFIED_TRUTH
    } else if (
      coverage.score >= 40
      && getBandRank(confidence.band) >= getBandRank(TRUTH_QUALITY_BANDS.MEDIUM)
    ) {
      level = TRUTH_CERTIFICATION_LEVELS.EVIDENCE_SUPPORTED
    } else if (coverage.score >= 20) {
      level = TRUTH_CERTIFICATION_LEVELS.EVIDENCE_PRESENT
    }
  }

  const summaryByLevel = {
    [TRUTH_CERTIFICATION_LEVELS.STRATEGIC_TRUTH.key]:
      'High coverage, high confidence, diverse source support, and low contradiction risk.',
    [TRUTH_CERTIFICATION_LEVELS.CERTIFIED_TRUTH.key]:
      'Strong accepted evidence coverage with high confidence and controlled contradiction risk.',
    [TRUTH_CERTIFICATION_LEVELS.EVIDENCE_SUPPORTED.key]:
      'Accepted truth is supported by multiple evidence signals, with quality gaps still visible.',
    [TRUTH_CERTIFICATION_LEVELS.EVIDENCE_PRESENT.key]:
      'Accepted evidence is present, but support is limited.',
    [TRUTH_CERTIFICATION_LEVELS.UNCERTIFIED.key]:
      'Truth Quality cannot certify this runtime from the available evidence.',
  }

  return {
    level: level.key,
    levelNumber: level.levelNumber,
    label: level.label,
    summary: summaryByLevel[level.key],
  }
}

const getQualityBand = ({ coverage, confidence, sourceDiversity, contradictionRisk }) => {
  if (confidence.band === TRUTH_QUALITY_BANDS.NONE) return TRUTH_QUALITY_BANDS.LOW
  const penalty = contradictionRisk.level === TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.HIGH
    ? 20
    : contradictionRisk.level === TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.MEDIUM
      ? 10
      : contradictionRisk.level === TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS.BLOCKING
        ? 35
        : 0
  const aggregateScore = clampNumber(
    ((coverage.score || 0) + (confidence.score || 0) + (sourceDiversity.score || 0)) / 3 - penalty,
  )
  return getCoverageBand(aggregateScore)
}

const buildTruthQualityProjection = ({
  frameworkPackage,
  runtimeInstance,
}) => {
  const frameworkState = getFrameworkState(runtimeInstance)
  const graph = frameworkState.intelligence_graph || frameworkState.intelligenceGraph || {}
  const graphProjection = buildRuntimeIntelligenceGraphProjection(graph, { includeGraphElements: true })
  const coverageQuery = buildRuntimeIntelligenceGraphQueryProjection(graphProjection, 'coverage')
  const contradictionQuery = buildRuntimeIntelligenceGraphQueryProjection(graphProjection, 'contradictions')
  const graphAvailable = graphProjection.available === true
    && coverageQuery.available === true
    && contradictionQuery.available === true
  const acceptedTruthRecords = getAcceptedTruthRecords({ frameworkPackage, frameworkState })
  const acceptedTruthCount = acceptedTruthRecords.filter((record) => record.content).length
  const evidenceObjects = collectEvidenceObjects(frameworkState)
  const acceptedEvidenceObjects = evidenceObjects
    .filter((record) => record.reviewStatus === ACCEPTED_REVIEW_STATUS)
  const sourceRegistry = collectSourceRegistry(frameworkState)
  const coverage = evaluateCoverage({ coverageQuery })
  const contradictionRisk = evaluateContradictionRisk({ contradictionQuery })
  const sourceDiversity = evaluateSourceDiversity({ acceptedEvidenceObjects, sourceRegistry })
  const confidence = evaluateConfidence({
    acceptedEvidenceCount: acceptedEvidenceObjects.length,
    acceptedTruthCount,
    contradictionRisk,
    sourceDiversity,
  })
  const knownGaps = buildKnownGaps({
    coverage,
    confidence,
    sourceDiversity,
    contradictionRisk,
    graphAvailable,
  })
  const certification = deriveCertification({
    coverage,
    confidence,
    sourceDiversity,
    contradictionRisk,
    graphAvailable,
  })

  return {
    contractVersion: TRUTH_QUALITY_CONTRACT_VERSION,
    runtimeInstanceId: toIdString(runtimeInstance.id || runtimeInstance._id),
    runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
    quality: {
      coverage,
      confidence,
      sourceDiversity,
      contradictionRisk,
      qualityBand: getQualityBand({ coverage, confidence, sourceDiversity, contradictionRisk }),
      knownGaps,
    },
    certification,
    graph: {
      graphVersion: graphProjection.graphVersion || '',
      graphHash: graphProjection.graphHash || '',
      evaluatedAt: new Date().toISOString(),
    },
  }
}

const buildAuditDiff = ({ actorUserId, projection }) => ({
  actorUserId,
  certificationLevel: projection.certification.level,
  certificationLevelNumber: projection.certification.levelNumber,
  coverageScore: projection.quality.coverage.score,
  coverageBand: projection.quality.coverage.band,
  confidenceScore: projection.quality.confidence.score,
  confidenceBand: projection.quality.confidence.band,
  sourceDiversityBand: projection.quality.sourceDiversity.band,
  contradictionRisk: projection.quality.contradictionRisk.level,
  graphHash: projection.graph.graphHash || '',
  knownGapCount: projection.quality.knownGaps.length,
})

// Direct reads do not mutate runtime state, so their audit write sits outside a runtime transaction and fails closed.
const logTruthQualityAudit = async ({
  actorUserId,
  auditRequest,
  projection,
  runtimeInstance,
}) => {
  const auditPayload = {
    action: auditService.AUDIT_ACTIONS.TRUTH_QUALITY_EVALUATED,
    actorUserId,
    resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
    resourceId: runtimeInstance.id || runtimeInstance._id,
    scope: {
      customerId: runtimeInstance.customerId,
      tenantId: runtimeInstance.tenantId,
      runtimeInstanceId: runtimeInstance.id || runtimeInstance._id,
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
    },
    summary: `Truth Quality evaluated for ${runtimeInstance.runtimeInstanceKey || runtimeInstance.name || 'runtime instance'}.`,
    diff: buildAuditDiff({ actorUserId, projection }),
  }

  const options = { throwOnError: true }
  if (auditRequest) {
    await auditService.logFromRequest(auditRequest, auditPayload, options)
    return
  }
  await auditService.log(auditPayload, options)
}

export const evaluateRuntimeTruthQuality = async ({
  actorUserId,
  auditMode = 'none',
  auditRequest,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await getRuntimeInstance({ runtimeInstanceId, scopes })
  if (normalizeToken(runtimeInstance.runtimeType) !== RUNTIME_TYPES.VALUE_NARRATIVE) {
    throw createTruthQualityError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Truth Quality V1 supports VMF Value Narrative runtimes only.',
      reason: TRUTH_QUALITY_ERROR_REASONS.TRUTH_QUALITY_UNSUPPORTED_RUNTIME_TYPE,
      details: { runtimeType: runtimeInstance.runtimeType },
    })
  }

  const frameworkPackage = await resolveFrameworkPackage(runtimeInstance)
  const projection = buildTruthQualityProjection({
    frameworkPackage,
    runtimeInstance,
  })

  if (auditMode === 'direct') {
    try {
      await logTruthQualityAudit({
        actorUserId,
        auditRequest,
        projection,
        runtimeInstance,
      })
    } catch (err) {
      throw failAuditClosed(err, {
        runtimeInstanceId: projection.runtimeInstanceId,
        runtimeInstanceKey: projection.runtimeInstanceKey,
      })
    }
  }

  return cloneValue(projection)
}

export const getRuntimeTruthQuality = ({
  actorUserId,
  auditRequest,
  runtimeInstanceId,
  scopes,
} = {}) => evaluateRuntimeTruthQuality({
  actorUserId,
  auditMode: 'direct',
  auditRequest,
  runtimeInstanceId,
  scopes,
})
