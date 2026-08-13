const SECTION_EVIDENCE_PROFILES = Object.freeze({
  customer_context: Object.freeze({
    coverageAreaWeights: Object.freeze({ Company: 100, Products: 95, Markets: 90, Industries: 85, 'Decision Context': 45 }),
    categoryWeights: Object.freeze({ Company: 100, Products: 95, Industries: 90, 'Value Drivers': 45 }),
    keywords: Object.freeze(['company', 'customer', 'offer', 'product', 'platform', 'market', 'region', 'industry', 'sector', 'business', 'operating']),
  }),
  strategic_objectives: Object.freeze({
    coverageAreaWeights: Object.freeze({ 'Decision Context': 100, Economics: 95, Products: 85, Differentiation: 80, Markets: 75, Industries: 55 }),
    categoryWeights: Object.freeze({ 'Value Drivers': 100, Economics: 95, Products: 85, Differentiators: 80, Industries: 65 }),
    keywords: Object.freeze(['goal', 'objective', 'priority', 'outcome', 'success', 'target', 'growth', 'increase', 'reduce', 'replace', 'adopt', 'expand', 'strategic', 'revenue', 'plan', 'future', 'decision']),
  }),
  current_state_assessment: Object.freeze({
    coverageAreaWeights: Object.freeze({ Technology: 100, Services: 95, 'Decision Context': 85, Industries: 75, Economics: 60, Products: 50 }),
    categoryWeights: Object.freeze({ Technology: 100, Services: 95, 'Value Drivers': 85, Industries: 75, Economics: 60, Products: 50 }),
    keywords: Object.freeze(['current', 'today', 'existing', 'baseline', 'legacy', 'manual', 'friction', 'slow', 'delay', 'bottleneck', 'constraint', 'risk', 'limitation', 'architecture', 'built', 'deploy', 'deployment', 'integration', 'telemetry', 'monitor', 'detect', 'service', 'capability', 'support']),
  }),
  stakeholder_register: Object.freeze({
    coverageAreaWeights: Object.freeze({ Proof: 100, Industries: 95, Economics: 85, 'Decision Context': 80, Products: 50 }),
    categoryWeights: Object.freeze({ Proof: 100, Industries: 95, Economics: 85, 'Value Drivers': 80, Products: 50 }),
    keywords: Object.freeze(['customer', 'buyer', 'account', 'team', 'enterprise', 'healthcare', 'defense', 'finance', 'partner', 'decision', 'stakeholder', 'owner', 'sponsor', 'user', 'operator', 'organization', 'accountable', 'approver']),
  }),
  evidence_register: Object.freeze({
    coverageAreaWeights: Object.freeze({ Proof: 100, Economics: 95, Differentiation: 90, Industries: 85, Technology: 80, Services: 75, Products: 65, Markets: 55, 'Decision Context': 45 }),
    categoryWeights: Object.freeze({ Proof: 100, Economics: 95, Differentiators: 90, Industries: 85, Technology: 80, Services: 75, Products: 65, 'Value Drivers': 45 }),
    keywords: Object.freeze(['evidence', 'proof', 'source', 'customer', 'production', 'revenue', 'percent', 'claim', 'represent', 'state', 'plan', 'deployment', 'version', 'direct', 'corroboration', 'citation', 'document']),
  }),
  output_requirements: Object.freeze({
    coverageAreaWeights: Object.freeze({ 'Decision Context': 100, Products: 90, Services: 85, Technology: 80, Industries: 70, Markets: 65 }),
    categoryWeights: Object.freeze({ 'Value Drivers': 100, Products: 90, Services: 85, Technology: 80, Industries: 70 }),
    keywords: Object.freeze(['output', 'deliverable', 'presentation', 'report', 'brief', 'audience', 'format', 'channel', 'tone', 'approval', 'publish', 'message', 'narrative', 'content', 'document', 'proposal', 'material', 'send', 'email']),
  }),
})

const PROJECTION_VERSION = 'vmf-section-evidence-projection-v1'
const MAX_RECEIPT_ITEMS = 12

const normalizeText = (value) => String(value || '').trim()

const normalizeSectionKey = (value) => normalizeText(value)
  .replace(/^framework_state\.sections\./i, '')
  .replace(/-/g, '_')
  .toLowerCase()

const normalizeEvidenceText = (value) => normalizeText(value)
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const hasKeyword = (text, keyword) => {
  const normalizedText = normalizeEvidenceText(text)
  const normalizedKeyword = normalizeEvidenceText(keyword)
  if (!normalizedText || !normalizedKeyword) return false
  return normalizedText.split(' ').includes(normalizedKeyword)
    || normalizedText.includes(` ${normalizedKeyword} `)
}

const getEvidenceSignals = (evidenceObject = {}) => {
  const coverageArea = normalizeText(evidenceObject.coverageArea || evidenceObject.category)
  const category = normalizeText(evidenceObject.category || evidenceObject.coverageArea)
  const extractedFact = normalizeText(evidenceObject.extractedFact)
  const text = [coverageArea, category, extractedFact, evidenceObject.sourceId].map(normalizeText).filter(Boolean).join(' ')
  return { coverageArea, category, extractedFact, text }
}

const buildKnownProjection = ({
  evidenceObjects,
  maxItems,
  profile,
  sectionKey,
} = {}) => {
  const eligible = []
  let ineligibleReviewStatusCount = 0

  evidenceObjects.forEach((evidenceObject, index) => {
    if (normalizeText(evidenceObject?.reviewStatus).toUpperCase() !== 'ACCEPTED') {
      ineligibleReviewStatusCount += 1
      return
    }
    const signals = getEvidenceSignals(evidenceObject)
    if (!signals.extractedFact || !normalizeText(evidenceObject.evidenceObjectId)) return
    const coverageScore = Number(profile.coverageAreaWeights[signals.coverageArea] || 0)
    const categoryScore = Number(profile.categoryWeights[signals.category] || 0)
    const keywordMatches = profile.keywords.filter((keyword) => hasKeyword(signals.text, keyword))
    const relevanceScore = coverageScore + categoryScore + Math.min(keywordMatches.length, 6) * 8
    eligible.push({
      evidenceObject,
      index,
      relevanceScore,
      reasonCodes: [
        coverageScore > 0 ? 'SECTION_COVERAGE_MATCH' : '',
        categoryScore > 0 ? 'SECTION_CATEGORY_MATCH' : '',
        keywordMatches.length > 0 ? 'SECTION_KEYWORD_MATCH' : '',
      ].filter(Boolean),
      keywordMatches: keywordMatches.slice(0, 6),
    })
  })

  const relevant = eligible
    .filter((candidate) => candidate.relevanceScore > 0)
    .sort((left, right) => right.relevanceScore - left.relevanceScore || left.index - right.index)
  const selected = Number.isInteger(maxItems) && maxItems >= 0
    ? relevant.slice(0, maxItems)
    : relevant
  const selectedIds = new Set(selected.map((candidate) => candidate.evidenceObject.evidenceObjectId))
  const selectedEvidenceObjects = selected.map((candidate) => candidate.evidenceObject)
  const exclusionReasonCounts = {
    ...(ineligibleReviewStatusCount > 0 ? { INELIGIBLE_REVIEW_STATUS: ineligibleReviewStatusCount } : {}),
    ...(eligible.filter((candidate) => candidate.relevanceScore === 0).length > 0
      ? { LOWER_SECTION_RELEVANCE: eligible.filter((candidate) => candidate.relevanceScore === 0).length }
      : {}),
    ...(relevant.length > selected.length ? { SELECTION_CAP: relevant.length - selected.length } : {}),
  }
  const included = selected.map((candidate) => ({
    evidenceObjectId: candidate.evidenceObject.evidenceObjectId,
    coverageArea: getEvidenceSignals(candidate.evidenceObject).coverageArea,
    category: getEvidenceSignals(candidate.evidenceObject).category,
    relevanceScore: candidate.relevanceScore,
    reasonCodes: candidate.reasonCodes,
    keywordMatches: candidate.keywordMatches,
  }))
  const gaps = selected.length === 0
    ? ['NO_SECTION_RELEVANT_ACCEPTED_EVIDENCE']
    : []

  return {
    algorithm: 'SECTION_DOMAIN_KEYWORD_RANKING',
    version: PROJECTION_VERSION,
    sectionKey,
    knownSection: true,
    candidateCount: evidenceObjects.length,
    eligibleAcceptedCount: eligible.length,
    includedCount: selected.length,
    included: included.slice(0, MAX_RECEIPT_ITEMS),
    excludedCount: evidenceObjects.length - selected.length,
    excludedReasonCounts: exclusionReasonCounts,
    excludedEvidenceObjectIds: relevant
      .filter((candidate) => !selectedIds.has(candidate.evidenceObject.evidenceObjectId))
      .map((candidate) => candidate.evidenceObject.evidenceObjectId)
      .slice(0, MAX_RECEIPT_ITEMS),
    selectedCoverageAreas: Array.from(new Set(selected.map((candidate) =>
      getEvidenceSignals(candidate.evidenceObject).coverageArea).filter(Boolean))),
    gaps,
    selectedEvidenceObjects,
  }
}

export const buildSectionEvidenceProjection = ({
  evidenceObjects = [],
  maxItems = 10,
  sectionKey,
} = {}) => {
  const normalizedSectionKey = normalizeSectionKey(sectionKey)
  const acceptedEvidenceObjects = Array.isArray(evidenceObjects) ? evidenceObjects : []
  const profile = SECTION_EVIDENCE_PROFILES[normalizedSectionKey]

  if (!profile) {
    const selectedEvidenceObjects = acceptedEvidenceObjects
      .filter((evidenceObject) => normalizeText(evidenceObject?.reviewStatus).toUpperCase() === 'ACCEPTED')
      .filter((evidenceObject) => normalizeText(evidenceObject?.evidenceObjectId) && normalizeText(evidenceObject?.extractedFact))
    const cappedEvidenceObjects = Number.isInteger(maxItems) && maxItems >= 0
      ? selectedEvidenceObjects.slice(0, maxItems)
      : selectedEvidenceObjects
    return {
      algorithm: 'LEGACY_ACCEPTED_ORDER',
      version: PROJECTION_VERSION,
      sectionKey: normalizedSectionKey,
      knownSection: false,
      candidateCount: acceptedEvidenceObjects.length,
      eligibleAcceptedCount: selectedEvidenceObjects.length,
      includedCount: cappedEvidenceObjects.length,
      included: cappedEvidenceObjects.slice(0, MAX_RECEIPT_ITEMS).map((evidenceObject) => ({
        evidenceObjectId: evidenceObject.evidenceObjectId,
        reasonCodes: ['LEGACY_UNKNOWN_SECTION_COMPATIBILITY'],
      })),
      excludedCount: acceptedEvidenceObjects.length - cappedEvidenceObjects.length,
      excludedReasonCounts: selectedEvidenceObjects.length > cappedEvidenceObjects.length
        ? { SELECTION_CAP: selectedEvidenceObjects.length - cappedEvidenceObjects.length }
        : {},
      excludedEvidenceObjectIds: selectedEvidenceObjects
        .slice(cappedEvidenceObjects.length, cappedEvidenceObjects.length + MAX_RECEIPT_ITEMS)
        .map((evidenceObject) => evidenceObject.evidenceObjectId),
      selectedCoverageAreas: Array.from(new Set(cappedEvidenceObjects
        .map((evidenceObject) => getEvidenceSignals(evidenceObject).coverageArea).filter(Boolean))),
      gaps: [],
      selectedEvidenceObjects: cappedEvidenceObjects,
    }
  }

  return buildKnownProjection({
    evidenceObjects: acceptedEvidenceObjects,
    maxItems,
    profile,
    sectionKey: normalizedSectionKey,
  })
}

export const getKnownSectionEvidenceProjectionKeys = () => Object.keys(SECTION_EVIDENCE_PROFILES)
