import crypto from 'node:crypto'
import {
  acceptPendingDiscoveryEvidenceObjects,
  buildDiscoverySourceRegistry,
  DISCOVERY_EVIDENCE_REVIEW_STATUSES,
  normalizeDiscoveryEvidenceObjects,
} from './discoveryIntelligenceService.js'
import { getRuntimeInstance } from './runtimeInstanceService.js'

export const RUNTIME_INTELLIGENCE_GRAPH_ARTIFACT_TYPE = 'runtime_intelligence_graph'
export const RUNTIME_INTELLIGENCE_GRAPH_VERSION = '2.2'

export const RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES = Object.freeze({
  SOURCE: 'SOURCE',
  EVIDENCE: 'EVIDENCE',
  INTELLIGENCE: 'INTELLIGENCE',
  SECTION_TRUTH: 'SECTION_TRUTH',
  PUBLISHED_TRUTH: 'PUBLISHED_TRUTH',
  CANONICAL_TRUTH: 'CANONICAL_TRUTH',
  OUTPUT_REFERENCE: 'OUTPUT_REFERENCE',
  REASONING_CONSUMER: 'REASONING_CONSUMER',
  SIGNAL: 'SIGNAL',
})

export const RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES = Object.freeze({
  SOURCE_PRODUCES_EVIDENCE: 'SOURCE_PRODUCES_EVIDENCE',
  EVIDENCE_DERIVES_INTELLIGENCE: 'EVIDENCE_DERIVES_INTELLIGENCE',
  INTELLIGENCE_SUPPORTS_SECTION_TRUTH: 'INTELLIGENCE_SUPPORTS_SECTION_TRUTH',
  SECTION_TRUTH_PUBLISHED_AS: 'SECTION_TRUTH_PUBLISHED_AS',
  PUBLISHED_TRUTH_LOCKED_AS_CANONICAL: 'PUBLISHED_TRUTH_LOCKED_AS_CANONICAL',
  CANONICAL_TRUTH_REFERENCED_BY_OUTPUT: 'CANONICAL_TRUTH_REFERENCED_BY_OUTPUT',
  INTELLIGENCE_SUPPORTS_CONSUMER: 'INTELLIGENCE_SUPPORTS_CONSUMER',
  SECTION_TRUTH_DEPENDS_ON_SECTION_TRUTH: 'SECTION_TRUTH_DEPENDS_ON_SECTION_TRUTH',
  NODE_HAS_SIGNAL: 'NODE_HAS_SIGNAL',
  EVIDENCE_CONTRADICTS_EVIDENCE: 'EVIDENCE_CONTRADICTS_EVIDENCE',
  INTELLIGENCE_CONTRADICTS_INTELLIGENCE: 'INTELLIGENCE_CONTRADICTS_INTELLIGENCE',
  EVIDENCE_VALIDATES_INTELLIGENCE: 'EVIDENCE_VALIDATES_INTELLIGENCE',
  VALIDATION_FLAGS_NODE: 'VALIDATION_FLAGS_NODE',
})

export const RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES = Object.freeze({
  SUPPORT: 'support',
  CONTRADICTIONS: 'contradictions',
  COVERAGE: 'coverage',
  DEPENDENCIES: 'dependencies',
  READINESS: 'readiness',
  DECISIONS: 'decisions',
})

export const RUNTIME_INTELLIGENCE_GRAPH_ENTITY_REGISTRY = Object.freeze({
  [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SOURCE]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SOURCE,
    displayName: 'Source',
    description: 'Source registry entry or section source metadata that produced governed evidence.',
    customerVisible: true,
    sensitivity: 'SOURCE_METADATA',
    allowedMetadataFields: ['validationStatus', 'reasoningStatus', 'lineageRefs', 'governance'],
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.EVIDENCE]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.EVIDENCE,
    displayName: 'Evidence',
    description: 'Governed reviewable evidence object derived from a source.',
    customerVisible: true,
    sensitivity: 'BOUNDED_EVIDENCE_METADATA',
    allowedMetadataFields: [
      'confidence',
      'confidenceScore',
      'confidenceFactors',
      'confidenceWarnings',
      'confidenceReason',
      'validationStatus',
      'reasoningStatus',
      'truthDomain',
      'truthCoverage',
      'materiality',
      'materialityScore',
      'materialityReason',
      'decisionImpact',
      'decisionImpactScore',
      'decisionImpactReason',
      'readinessContribution',
      'readinessWeight',
      'readinessDomain',
      'contradictionRefs',
      'lineageRefs',
      'governance',
    ],
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.INTELLIGENCE]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.INTELLIGENCE,
    displayName: 'Intelligence',
    description: 'Intermediate intelligence signal derived from accepted or reviewable evidence.',
    customerVisible: true,
    sensitivity: 'INTELLIGENCE_METADATA',
    allowedMetadataFields: [
      'confidence',
      'confidenceScore',
      'confidenceFactors',
      'confidenceWarnings',
      'confidenceReason',
      'validationStatus',
      'reasoningStatus',
      'truthDomain',
      'truthCoverage',
      'materiality',
      'materialityScore',
      'materialityReason',
      'decisionImpact',
      'decisionImpactScore',
      'decisionImpactReason',
      'readinessContribution',
      'readinessWeight',
      'readinessDomain',
      'contradictionRefs',
      'lineageRefs',
      'governance',
    ],
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SECTION_TRUTH]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SECTION_TRUTH,
    displayName: 'Section Truth',
    description: 'Accepted section truth persisted in runtime section state.',
    customerVisible: true,
    sensitivity: 'TRUTH_METADATA',
    allowedMetadataFields: [
      'confidence',
      'confidenceScore',
      'confidenceFactors',
      'confidenceWarnings',
      'confidenceReason',
      'validationStatus',
      'reasoningStatus',
      'truthDomain',
      'truthCoverage',
      'materiality',
      'materialityScore',
      'materialityReason',
      'decisionImpact',
      'decisionImpactScore',
      'decisionImpactReason',
      'readinessContribution',
      'readinessWeight',
      'readinessDomain',
      'lineageRefs',
      'governance',
    ],
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.PUBLISHED_TRUTH]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.PUBLISHED_TRUTH,
    displayName: 'Published Truth',
    description: 'Published runtime truth snapshot metadata.',
    customerVisible: true,
    sensitivity: 'TRUTH_METADATA',
    allowedMetadataFields: ['validationStatus', 'reasoningStatus', 'materiality', 'decisionImpact', 'lineageRefs', 'governance'],
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.CANONICAL_TRUTH]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.CANONICAL_TRUTH,
    displayName: 'Canonical Truth',
    description: 'Locked canonical truth snapshot metadata.',
    customerVisible: true,
    sensitivity: 'TRUTH_METADATA',
    allowedMetadataFields: ['validationStatus', 'reasoningStatus', 'materiality', 'decisionImpact', 'lineageRefs', 'governance'],
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.OUTPUT_REFERENCE]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.OUTPUT_REFERENCE,
    displayName: 'Output Reference',
    description: 'Future output reference capability without full output lineage.',
    customerVisible: true,
    sensitivity: 'OUTPUT_REFERENCE_METADATA',
    allowedMetadataFields: ['validationStatus', 'reasoningStatus', 'lineageRefs', 'governance'],
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.REASONING_CONSUMER]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.REASONING_CONSUMER,
    displayName: 'Reasoning Consumer',
    description: 'Framework, section, package, or future consumer of graph intelligence.',
    customerVisible: true,
    sensitivity: 'CONSUMER_METADATA',
    allowedMetadataFields: ['validationStatus', 'reasoningStatus', 'lineageRefs', 'governance'],
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SIGNAL]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SIGNAL,
    displayName: 'Signal',
    description: 'Deterministic graph signal for coverage, dependencies, or future readiness consumers.',
    customerVisible: true,
    sensitivity: 'SIGNAL_METADATA',
    allowedMetadataFields: [
      'validationStatus',
      'reasoningStatus',
      'truthCoverage',
      'materiality',
      'decisionImpact',
      'readinessContribution',
      'readinessWeight',
      'readinessDomain',
      'lineageRefs',
      'governance',
    ],
  }),
})

export const RUNTIME_INTELLIGENCE_GRAPH_RELATIONSHIP_REGISTRY = Object.freeze({
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.SOURCE_PRODUCES_EVIDENCE]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.SOURCE_PRODUCES_EVIDENCE,
    displayName: 'Source Produces Evidence',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SOURCE],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.EVIDENCE],
    contributesTo: ['coverage', 'lineage', 'confidence'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.EVIDENCE_DERIVES_INTELLIGENCE]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.EVIDENCE_DERIVES_INTELLIGENCE,
    displayName: 'Evidence Derives Intelligence',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.EVIDENCE],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.INTELLIGENCE],
    contributesTo: ['support', 'confidence', 'readiness'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.INTELLIGENCE_SUPPORTS_SECTION_TRUTH]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.INTELLIGENCE_SUPPORTS_SECTION_TRUTH,
    displayName: 'Intelligence Supports Section Truth',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.INTELLIGENCE],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SECTION_TRUTH],
    contributesTo: ['support', 'readiness', 'lineage'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.SECTION_TRUTH_PUBLISHED_AS]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.SECTION_TRUTH_PUBLISHED_AS,
    displayName: 'Section Truth Published As',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SECTION_TRUTH],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.PUBLISHED_TRUTH],
    contributesTo: ['lineage', 'readiness'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.PUBLISHED_TRUTH_LOCKED_AS_CANONICAL]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.PUBLISHED_TRUTH_LOCKED_AS_CANONICAL,
    displayName: 'Published Truth Locked As Canonical',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.PUBLISHED_TRUTH],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.CANONICAL_TRUTH],
    contributesTo: ['lineage', 'readiness'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.CANONICAL_TRUTH_REFERENCED_BY_OUTPUT]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.CANONICAL_TRUTH_REFERENCED_BY_OUTPUT,
    displayName: 'Canonical Truth Referenced By Output',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.CANONICAL_TRUTH],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.OUTPUT_REFERENCE],
    contributesTo: ['lineage'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.INTELLIGENCE_SUPPORTS_CONSUMER]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.INTELLIGENCE_SUPPORTS_CONSUMER,
    displayName: 'Intelligence Supports Consumer',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.INTELLIGENCE],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.REASONING_CONSUMER],
    contributesTo: ['support', 'readiness'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.SECTION_TRUTH_DEPENDS_ON_SECTION_TRUTH]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.SECTION_TRUTH_DEPENDS_ON_SECTION_TRUTH,
    displayName: 'Section Truth Depends On Section Truth',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SECTION_TRUTH],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SECTION_TRUTH],
    contributesTo: ['dependencies', 'readiness'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.NODE_HAS_SIGNAL]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.NODE_HAS_SIGNAL,
    displayName: 'Node Has Signal',
    fromNodeTypes: [
      RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.REASONING_CONSUMER,
      RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.EVIDENCE,
      RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.INTELLIGENCE,
      RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SECTION_TRUTH,
    ],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SIGNAL],
    contributesTo: ['coverage', 'readiness'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.EVIDENCE_CONTRADICTS_EVIDENCE]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.EVIDENCE_CONTRADICTS_EVIDENCE,
    displayName: 'Evidence Contradicts Evidence',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.EVIDENCE],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.EVIDENCE],
    contributesTo: ['contradictions', 'confidence'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.INTELLIGENCE_CONTRADICTS_INTELLIGENCE]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.INTELLIGENCE_CONTRADICTS_INTELLIGENCE,
    displayName: 'Intelligence Contradicts Intelligence',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.INTELLIGENCE],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.INTELLIGENCE],
    contributesTo: ['contradictions', 'confidence'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.EVIDENCE_VALIDATES_INTELLIGENCE]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.EVIDENCE_VALIDATES_INTELLIGENCE,
    displayName: 'Evidence Validates Intelligence',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.EVIDENCE],
    toNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.INTELLIGENCE],
    contributesTo: ['validation', 'confidence'],
    customerVisible: true,
  }),
  [RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.VALIDATION_FLAGS_NODE]: Object.freeze({
    key: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.VALIDATION_FLAGS_NODE,
    displayName: 'Validation Flags Node',
    fromNodeTypes: [RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SIGNAL],
    toNodeTypes: Object.values(RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES),
    contributesTo: ['validation', 'readiness'],
    customerVisible: true,
  }),
})

export const RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS = Object.freeze({
  EXPLICIT_REBUILD: 'EXPLICIT_REBUILD',
  EVIDENCE_UPDATED: 'EVIDENCE_UPDATED',
  EVIDENCE_ACCEPTED: 'EVIDENCE_ACCEPTED',
  EVIDENCE_REVIEWED: 'EVIDENCE_REVIEWED',
  DISCOVERY_RESET: 'DISCOVERY_RESET',
  SECTION_EVIDENCE_UPDATED: 'SECTION_EVIDENCE_UPDATED',
  SECTION_EVIDENCE_ACCEPTED: 'SECTION_EVIDENCE_ACCEPTED',
  SECTION_EVIDENCE_REVIEWED: 'SECTION_EVIDENCE_REVIEWED',
  SECTION_GENERATED: 'SECTION_GENERATED',
  SECTION_TRUTH_ACCEPTED: 'SECTION_TRUTH_ACCEPTED',
  PUBLISH_COMPLETED: 'PUBLISH_COMPLETED',
  LOCK_COMPLETED: 'LOCK_COMPLETED',
  OUTPUT_REFERENCE_REGISTERED: 'OUTPUT_REFERENCE_REGISTERED',
})

export const RUNTIME_INTELLIGENCE_GRAPH_DOMAINS = Object.freeze([
  'Company',
  'Products',
  'Services',
  'Market',
  'Problems',
  'Consequences',
  'Proof',
  'Economics',
  'Differentiation',
  'Stakeholders',
])

const GRAPH_QUALITY_STATES = Object.freeze({
  CONNECTED: 'CONNECTED',
  ORPHAN: 'ORPHAN',
  LOW_QUALITY: 'LOW_QUALITY',
  UNCLASSIFIED: 'UNCLASSIFIED',
  INVALID: 'INVALID',
})

const VALIDATION_STATUSES = Object.freeze({
  UNVALIDATED: 'UNVALIDATED',
  PARTIALLY_VALIDATED: 'PARTIALLY_VALIDATED',
  VALIDATED: 'VALIDATED',
  CONTRADICTED: 'CONTRADICTED',
  REJECTED: 'REJECTED',
  UNKNOWN: 'UNKNOWN',
})

const REASONING_STATUSES = Object.freeze({
  READY_FOR_REASONING: 'READY_FOR_REASONING',
  NEEDS_EVIDENCE: 'NEEDS_EVIDENCE',
  CONTRADICTION_UNRESOLVED: 'CONTRADICTION_UNRESOLVED',
  CONFIDENCE_INSUFFICIENT: 'CONFIDENCE_INSUFFICIENT',
  VALIDATION_REQUIRED: 'VALIDATION_REQUIRED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
})

const DOMAIN_MAPPING = Object.freeze({
  COMPANY: 'Company',
  PRODUCTS: 'Products',
  PRODUCT: 'Products',
  OFFER: 'Products',
  OFFERS: 'Products',
  SERVICES: 'Services',
  SERVICE: 'Services',
  MARKET: 'Market',
  MARKETS: 'Market',
  INDUSTRY: 'Market',
  INDUSTRIES: 'Market',
  PROBLEMS: 'Problems',
  PROBLEM: 'Problems',
  PAIN: 'Problems',
  PAINS: 'Problems',
  CONSEQUENCES: 'Consequences',
  CONSEQUENCE: 'Consequences',
  RISKS: 'Consequences',
  RISK: 'Consequences',
  PROOF: 'Proof',
  EVIDENCE: 'Proof',
  ECONOMICS: 'Economics',
  ECONOMIC: 'Economics',
  FINANCIAL: 'Economics',
  DIFFERENTIATION: 'Differentiation',
  DIFFERENTIATOR: 'Differentiation',
  DIFFERENTIATORS: 'Differentiation',
  STAKEHOLDERS: 'Stakeholders',
  STAKEHOLDER: 'Stakeholders',
})

const TRUTH_DOMAIN_BY_COVERAGE_DOMAIN = Object.freeze({
  Company: 'commercial',
  Products: 'commercial',
  Services: 'commercial',
  Market: 'commercial',
  Problems: 'operational',
  Consequences: 'operational',
  Proof: 'commercial',
  Economics: 'financial',
  Differentiation: 'commercial',
  Stakeholders: 'stakeholder',
})

const isPlainObject = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const cloneValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const stableStringify = (value) => {
  if (value === null || value === undefined) return ''
  if (!isPlainObject(value) && !Array.isArray(value)) return String(value)
  const normalize = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (!isPlainObject(candidate)) return candidate
    return Object.keys(candidate)
      .sort()
      .reduce((acc, key) => ({
        ...acc,
        [key]: normalize(candidate[key]),
      }), {})
  }
  return JSON.stringify(normalize(value))
}

export const hashRuntimeIntelligenceGraphValue = (value) =>
  `sha256:${crypto.createHash('sha256').update(stableStringify(value)).digest('hex')}`

const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (value._id && value._id !== value) return toIdString(value._id)
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const normalizeToken = (value) => String(value || '').trim().toUpperCase()
const normalizeKey = (value) => String(value || '').trim().toLowerCase()

const safeToken = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'unknown'
}

const titleFromKey = (value) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())

const safeLabel = (value, fallback = 'Untitled') => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return fallback
  return normalized.length > 120 ? `${normalized.slice(0, 117).trim()}...` : normalized
}

const safeSnippet = (value) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > 220 ? `${normalized.slice(0, 217).trim()}...` : normalized
}

const buildNodeId = (type, ...parts) =>
  `${safeToken(type)}:${parts.map(safeToken).filter(Boolean).join(':') || 'unknown'}`

const buildEdgeId = ({ edgeType, fromNodeId, toNodeId, basis }) =>
  `edge:${safeToken(edgeType)}:${hashRuntimeIntelligenceGraphValue({
    edgeType,
    fromNodeId,
    toNodeId,
    basis,
  }).slice(7, 23)}`

const getFrameworkState = (runtimeInstance = {}) =>
  runtimeInstance.framework_state || runtimeInstance.frameworkState || {}

const getGraphSourceFrameworkState = (frameworkState = {}) => {
  const sourceFrameworkState = cloneValue(frameworkState || {})
  if (!isPlainObject(sourceFrameworkState)) return {}

  delete sourceFrameworkState.intelligence_graph
  delete sourceFrameworkState.intelligenceGraph
  return sourceFrameworkState
}

const getEvidencePack = (frameworkState = {}) =>
  frameworkState.evidence_pack || frameworkState.evidencePack || {}

const getCanonicalScopedViews = (evidencePack = {}) =>
  isPlainObject(evidencePack.scoped_views)
    ? evidencePack.scoped_views
    : isPlainObject(evidencePack.scopedViews)
      ? evidencePack.scopedViews
      : {}

const normalizeReviewStatus = (value) => {
  const normalized = normalizeToken(value)
  if (Object.values(DISCOVERY_EVIDENCE_REVIEW_STATUSES).includes(normalized)) return normalized
  return DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING
}

const isEvidencePackAccepted = (evidencePack = {}) =>
  evidencePack?.needsRefresh !== true
  && evidencePack?.state?.needsRefresh !== true
  && (evidencePack.accepted === true || evidencePack?.state?.accepted === true)

const normalizeCoverageDomain = (...values) => {
  for (const value of values) {
    const normalized = normalizeToken(value)
    if (DOMAIN_MAPPING[normalized]) return DOMAIN_MAPPING[normalized]
  }
  return ''
}

const getTruthDomain = ({ domain, explicitTruthDomain }) => {
  const explicit = String(explicitTruthDomain || '').trim().toLowerCase()
  if (explicit) return explicit
  return TRUTH_DOMAIN_BY_COVERAGE_DOMAIN[domain] || 'unknown'
}

const normalizeMateriality = (value) => {
  const normalized = normalizeToken(value)
  return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalized) ? normalized : 'UNKNOWN'
}

const MATERIALITY_SCORES = Object.freeze({
  UNKNOWN: null,
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
  CRITICAL: 1,
})

const DECISION_IMPACTS = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  INFORMATIONAL: 'INFORMATIONAL',
  OPERATIONAL: 'OPERATIONAL',
  TACTICAL: 'TACTICAL',
  STRATEGIC: 'STRATEGIC',
  CRITICAL: 'CRITICAL',
})

const DECISION_IMPACT_SCORES = Object.freeze({
  UNKNOWN: null,
  INFORMATIONAL: 0.2,
  OPERATIONAL: 0.4,
  TACTICAL: 0.6,
  STRATEGIC: 0.8,
  CRITICAL: 1,
})

const READINESS_CONTRIBUTIONS = Object.freeze({
  NONE: 'NONE',
  BLOCKER: 'BLOCKER',
  SUPPORTING: 'SUPPORTING',
  STRONG: 'STRONG',
})

const normalizeDecisionImpact = (value) => {
  const normalized = normalizeToken(value)
  return Object.values(DECISION_IMPACTS).includes(normalized) ? normalized : DECISION_IMPACTS.UNKNOWN
}

const normalizeNumberOrNull = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const normalizeScoreOrFallback = (value, fallback = null) => {
  const score = normalizeNumberOrNull(value)
  if (score !== null && score >= 0 && score <= 1) return score
  return fallback
}

const READINESS_WEIGHTS = Object.freeze({
  [READINESS_CONTRIBUTIONS.NONE]: 0,
  [READINESS_CONTRIBUTIONS.BLOCKER]: 0,
  [READINESS_CONTRIBUTIONS.SUPPORTING]: 0.5,
  [READINESS_CONTRIBUTIONS.STRONG]: 0.75,
})

const normalizeReadinessContribution = (value) => {
  const normalized = normalizeToken(value)
  return Object.values(READINESS_CONTRIBUTIONS).includes(normalized)
    ? normalized
    : READINESS_CONTRIBUTIONS.NONE
}

const buildGovernanceMetadata = ({ auditScope = 'RUNTIME_INTELLIGENCE_GRAPH', classification = 'INTERNAL', owner = 'SYSTEM', retentionPolicy = 'RUNTIME_LIFECYCLE', sensitivity = 'METADATA' } = {}) => ({
  classification,
  sensitivity,
  retentionPolicy,
  auditScope,
  owner,
})

const deriveMateriality = ({
  domain = '',
  explicitMateriality,
  lowQuality = false,
  reviewStatus = '',
  validationStatus = VALIDATION_STATUSES.UNKNOWN,
} = {}) => {
  const explicit = normalizeMateriality(explicitMateriality)
  if (explicit !== 'UNKNOWN') {
    return {
      materiality: explicit,
      materialityScore: MATERIALITY_SCORES[explicit],
      materialityReason: 'Explicit persisted materiality metadata.',
    }
  }

  if (
    reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
    || validationStatus === VALIDATION_STATUSES.REJECTED
    || lowQuality
  ) {
    return {
      materiality: 'LOW',
      materialityScore: MATERIALITY_SCORES.LOW,
      materialityReason: lowQuality
        ? 'Low quality evidence cannot carry high materiality.'
        : 'Rejected or invalid evidence cannot carry high materiality.',
    }
  }

  if (validationStatus === VALIDATION_STATUSES.VALIDATED) {
    return {
      materiality: 'HIGH',
      materialityScore: MATERIALITY_SCORES.HIGH,
      materialityReason: 'Validated truth node has deterministic high materiality.',
    }
  }

  if (reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED && ['Economics', 'Consequences', 'Differentiation'].includes(domain)) {
    return {
      materiality: 'HIGH',
      materialityScore: MATERIALITY_SCORES.HIGH,
      materialityReason: 'Accepted evidence in a high-impact coverage domain.',
    }
  }

  if (reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED || validationStatus === VALIDATION_STATUSES.PARTIALLY_VALIDATED) {
    return {
      materiality: 'MEDIUM',
      materialityScore: MATERIALITY_SCORES.MEDIUM,
      materialityReason: 'Accepted or partially validated persisted graph evidence.',
    }
  }

  return {
    materiality: 'UNKNOWN',
    materialityScore: null,
    materialityReason: 'No persisted materiality signal is available.',
  }
}

const deriveDecisionImpact = ({
  domain = '',
  explicitDecisionImpact,
  materiality = 'UNKNOWN',
  validationStatus = VALIDATION_STATUSES.UNKNOWN,
} = {}) => {
  const explicit = normalizeDecisionImpact(explicitDecisionImpact)
  if (explicit !== DECISION_IMPACTS.UNKNOWN) {
    return {
      decisionImpact: explicit,
      decisionImpactScore: DECISION_IMPACT_SCORES[explicit],
      decisionImpactReason: 'Explicit persisted decision-impact metadata.',
    }
  }

  if (validationStatus === VALIDATION_STATUSES.REJECTED) {
    return {
      decisionImpact: DECISION_IMPACTS.INFORMATIONAL,
      decisionImpactScore: DECISION_IMPACT_SCORES.INFORMATIONAL,
      decisionImpactReason: 'Rejected evidence is retained only as informational graph context.',
    }
  }

  if (validationStatus === VALIDATION_STATUSES.VALIDATED && ['HIGH', 'CRITICAL'].includes(materiality)) {
    return {
      decisionImpact: DECISION_IMPACTS.STRATEGIC,
      decisionImpactScore: DECISION_IMPACT_SCORES.STRATEGIC,
      decisionImpactReason: 'Validated high-materiality truth can affect strategic decisions.',
    }
  }

  if (materiality === 'HIGH' && ['Economics', 'Consequences'].includes(domain)) {
    return {
      decisionImpact: DECISION_IMPACTS.TACTICAL,
      decisionImpactScore: DECISION_IMPACT_SCORES.TACTICAL,
      decisionImpactReason: 'High-materiality evidence in economics or consequence domains affects tactical decisions.',
    }
  }

  if (['MEDIUM', 'HIGH'].includes(materiality)) {
    return {
      decisionImpact: DECISION_IMPACTS.OPERATIONAL,
      decisionImpactScore: DECISION_IMPACT_SCORES.OPERATIONAL,
      decisionImpactReason: 'Accepted graph evidence can affect operational decisions.',
    }
  }

  if (materiality === 'LOW') {
    return {
      decisionImpact: DECISION_IMPACTS.INFORMATIONAL,
      decisionImpactScore: DECISION_IMPACT_SCORES.INFORMATIONAL,
      decisionImpactReason: 'Low-materiality graph evidence is informational.',
    }
  }

  return {
    decisionImpact: DECISION_IMPACTS.UNKNOWN,
    decisionImpactScore: null,
    decisionImpactReason: 'No persisted decision-impact signal is available.',
  }
}

const deriveReadinessContribution = ({
  domain = '',
  materiality = 'UNKNOWN',
  reasoningStatus = REASONING_STATUSES.NOT_APPLICABLE,
  validationStatus = VALIDATION_STATUSES.UNKNOWN,
} = {}) => {
  if ([VALIDATION_STATUSES.REJECTED, VALIDATION_STATUSES.CONTRADICTED].includes(validationStatus)) {
    return {
      readinessContribution: READINESS_CONTRIBUTIONS.BLOCKER,
      readinessWeight: 0,
      readinessDomain: domain || 'unknown',
    }
  }

  if (reasoningStatus === REASONING_STATUSES.READY_FOR_REASONING) {
    return {
      readinessContribution: ['HIGH', 'CRITICAL'].includes(materiality)
        ? READINESS_CONTRIBUTIONS.STRONG
        : READINESS_CONTRIBUTIONS.SUPPORTING,
      readinessWeight: ['HIGH', 'CRITICAL'].includes(materiality) ? 0.75 : 0.5,
      readinessDomain: domain || 'unknown',
    }
  }

  if ([REASONING_STATUSES.NEEDS_EVIDENCE, REASONING_STATUSES.CONFIDENCE_INSUFFICIENT, REASONING_STATUSES.VALIDATION_REQUIRED].includes(reasoningStatus)) {
    return {
      readinessContribution: READINESS_CONTRIBUTIONS.BLOCKER,
      readinessWeight: 0,
      readinessDomain: domain || 'unknown',
    }
  }

  return {
    readinessContribution: READINESS_CONTRIBUTIONS.NONE,
    readinessWeight: 0,
    readinessDomain: domain || 'unknown',
  }
}

const extractConfidence = (evidenceObject = {}) => {
  const confidence = isPlainObject(evidenceObject.confidence) ? evidenceObject.confidence : {}
  const score = Number(confidence.score ?? evidenceObject.confidenceScore)
  const basis = Array.isArray(confidence.basis)
    ? confidence.basis
    : Array.isArray(evidenceObject.confidenceFactors)
      ? evidenceObject.confidenceFactors
      : []
  const warnings = Array.isArray(confidence.warnings)
    ? confidence.warnings
    : Array.isArray(evidenceObject.confidenceWarnings)
      ? evidenceObject.confidenceWarnings
      : []
  return {
    confidence: Number.isFinite(score) ? score : null,
    confidenceScore: Number.isFinite(score) ? score : null,
    confidenceBasis: basis.map((item) => String(item || '').trim()).filter(Boolean),
    confidenceFactors: basis.map((item) => String(item || '').trim()).filter(Boolean),
    confidenceWarnings: warnings.map((item) => String(item || '').trim()).filter(Boolean),
    confidenceReason: String(confidence.reason || evidenceObject.confidenceReason || '').trim(),
  }
}

const getExplicitLowQuality = (evidenceObject = {}) => {
  const candidates = [
    evidenceObject.graphQualityState,
    evidenceObject.qualityState,
    evidenceObject.qualityStatus,
    evidenceObject.extractionQuality?.state,
    evidenceObject.extractionQuality?.status,
    evidenceObject.quality?.state,
    evidenceObject.quality?.status,
  ].map(normalizeToken)

  return candidates.includes(GRAPH_QUALITY_STATES.LOW_QUALITY)
}

const createDefaultMetadata = ({
  confidence = null,
  confidenceBasis = [],
  confidenceFactors = [],
  confidenceReason = '',
  confidenceScore = null,
  confidenceWarnings = [],
  contradictionRefs = [],
  decisionImpact = DECISION_IMPACTS.UNKNOWN,
  decisionImpactReason = '',
  decisionImpactScore = null,
  governance = {},
  lineageRefs = [],
  materiality = 'UNKNOWN',
  materialityReason = '',
  materialityScore = null,
  readinessContribution = READINESS_CONTRIBUTIONS.NONE,
  readinessDomain = 'unknown',
  readinessWeight = 0,
  reasoningStatus = REASONING_STATUSES.NOT_APPLICABLE,
  truthCoverage = [],
  truthDomain = 'unknown',
  validationStatus = VALIDATION_STATUSES.UNKNOWN,
} = {}) => {
  const normalizedMateriality = normalizeMateriality(materiality)
  const normalizedDecisionImpact = normalizeDecisionImpact(decisionImpact)
  const normalizedReadinessContribution = normalizeReadinessContribution(readinessContribution)
  return {
    confidence,
    confidenceScore: normalizeNumberOrNull(confidenceScore ?? confidence),
    confidenceBasis,
    confidenceFactors: confidenceFactors.length > 0 ? confidenceFactors : confidenceBasis,
    confidenceWarnings,
    confidenceReason,
    validationStatus,
    reasoningStatus,
    truthDomain,
    truthCoverage,
    materiality: normalizedMateriality,
    materialityScore: normalizeScoreOrFallback(materialityScore, MATERIALITY_SCORES[normalizedMateriality]),
    materialityReason,
    decisionImpact: normalizedDecisionImpact,
    decisionImpactScore: normalizeScoreOrFallback(decisionImpactScore, DECISION_IMPACT_SCORES[normalizedDecisionImpact]),
    decisionImpactReason,
    readinessContribution: normalizedReadinessContribution,
    readinessWeight: normalizeScoreOrFallback(readinessWeight, READINESS_WEIGHTS[normalizedReadinessContribution]),
    readinessDomain,
    contradictionRefs,
    lineageRefs,
    governance: buildGovernanceMetadata(governance),
  }
}

const createGraphContext = ({ builtAt }) => ({
  builtAt,
  entityRegistry: RUNTIME_INTELLIGENCE_GRAPH_ENTITY_REGISTRY,
  relationshipRegistry: RUNTIME_INTELLIGENCE_GRAPH_RELATIONSHIP_REGISTRY,
  nodes: new Map(),
  edges: new Map(),
  evidenceRecords: new Map(),
  intelligenceByEvidenceId: new Map(),
  sectionTruthBySectionKey: new Map(),
  sourceNodeBySourceId: new Map(),
  consumerNodeBySectionKey: new Map(),
  warnings: [],
})

const addNode = (context, node) => {
  if (!node?.nodeId || !node?.nodeType) return null
  const entityDefinition = context.entityRegistry[node.nodeType]
  if (!entityDefinition) {
    context.warnings.push({
      code: 'UNKNOWN_GRAPH_ENTITY_TYPE',
      severity: 'ERROR',
      nodeType: node.nodeType,
      message: 'Graph node uses an unknown entity type.',
    })
    return null
  }
  const previous = context.nodes.get(node.nodeId)
  const nextNode = {
    entityDefinitionKey: entityDefinition.key,
    entityDisplayName: entityDefinition.displayName,
    customerVisible: entityDefinition.customerVisible === true,
    ...node,
    metadata: createDefaultMetadata({
      ...(node.metadata || {}),
      governance: {
        sensitivity: entityDefinition.sensitivity,
        ...(node.metadata?.governance || {}),
      },
    }),
  }
  context.nodes.set(node.nodeId, previous ? { ...previous, ...nextNode } : nextNode)
  return context.nodes.get(node.nodeId)
}

const addEdge = (context, edge) => {
  if (!edge?.edgeType || !edge?.fromNodeId || !edge?.toNodeId || !edge?.basis) return null
  const relationshipDefinition = context.relationshipRegistry[edge.edgeType]
  if (!relationshipDefinition) {
    context.warnings.push({
      code: 'UNKNOWN_GRAPH_RELATIONSHIP_TYPE',
      severity: 'ERROR',
      edgeType: edge.edgeType,
      message: 'Graph edge uses an unknown relationship type.',
    })
    return null
  }
  const nextEdge = {
    edgeId: buildEdgeId(edge),
    relationshipDefinitionKey: relationshipDefinition.key,
    relationshipDisplayName: relationshipDefinition.displayName,
    contributesTo: relationshipDefinition.contributesTo,
    customerVisible: relationshipDefinition.customerVisible === true,
    builtAt: context.builtAt,
    validationState: 'VALID',
    sourceRefs: [],
    confidenceDriverRefs: [],
    ...edge,
  }
  context.edges.set(nextEdge.edgeId, nextEdge)
  return nextEdge
}

const buildRuntimeGraphSourceHash = ({ frameworkPackage, frameworkState, runtimeInstance }) =>
  hashRuntimeIntelligenceGraphValue({
    runtimeInstanceId: toIdString(runtimeInstance?._id || runtimeInstance?.id),
    runtimeId: toIdString(runtimeInstance?._id || runtimeInstance?.id),
    customerId: toIdString(runtimeInstance?.customerId),
    tenantId: toIdString(runtimeInstance?.tenantId),
    projectId: toIdString(runtimeInstance?.projectId),
    outcomeId: toIdString(runtimeInstance?.outcomeId),
    frameworkId: toIdString(runtimeInstance?.frameworkId || runtimeInstance?.packageId),
    runtimeInstanceKey: runtimeInstance?.runtimeInstanceKey || '',
    runtimeType: runtimeInstance?.runtimeType || '',
    frameworkKey: runtimeInstance?.frameworkKey || '',
    packageKey: runtimeInstance?.packageKey || '',
    packageVersion: runtimeInstance?.packageVersion || '',
    packageSections: Array.isArray(frameworkPackage?.sections)
      ? frameworkPackage.sections.map((section) => ({
          sectionKey: section?.sectionKey || '',
          runtimePath: section?.runtimePath || '',
          required: section?.required === true,
          dependsOnSectionKeys: section?.dependsOnSectionKeys || section?.dependencySectionKeys || section?.dependsOn || [],
        }))
      : [],
    evidencePack: (() => {
      const evidencePack = getEvidencePack(frameworkState)
      return {
        accepted: evidencePack.accepted === true,
        acceptedAt: evidencePack.acceptedAt || '',
        refreshedAt: evidencePack.refreshedAt || '',
        sourceRegistry: evidencePack.sourceRegistry || [],
        evidenceObjects: evidencePack.evidenceObjects || [],
        scopedViews: getCanonicalScopedViews(evidencePack),
      }
    })(),
    sections: Object.entries(frameworkState?.sections || {}).reduce((acc, [sectionKey, sectionValue]) => ({
      ...acc,
      [sectionKey]: {
        accepted: sectionValue?.accepted || {},
        state: sectionValue?.state || {},
        evidenceObjects: sectionValue?.evidenceObjects || [],
        documents: sectionValue?.additionalEvidence?.documents || [],
      },
    }), {}),
    publish: frameworkState?.publish || {},
    lock: frameworkState?.lock || {},
  })

const getRuntimeSections = (frameworkState = {}) =>
  isPlainObject(frameworkState.sections) ? frameworkState.sections : {}

const getPackageSections = ({ frameworkPackage, frameworkState }) => {
  const packageSections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  if (packageSections.length > 0) return packageSections

  return Object.keys(getRuntimeSections(frameworkState)).map((sectionKey) => ({
    sectionKey,
    runtimePath: `framework_state.sections.${sectionKey}`,
    required: false,
  }))
}

const getDependencySectionKeys = (packageSection = {}) => [
  packageSection.dependsOnSectionKeys,
  packageSection.dependencySectionKeys,
  packageSection.dependsOn,
]
  .flatMap((candidate) => (Array.isArray(candidate) ? candidate : [candidate]))
  .map((candidate) => {
    if (isPlainObject(candidate)) return normalizeKey(candidate.sectionKey || candidate.key)
    return normalizeKey(candidate)
  })
  .filter(Boolean)

const addReasoningConsumers = ({ context, frameworkPackage, frameworkState, runtimeInstance }) => {
  const frameworkKey = normalizeToken(runtimeInstance.frameworkKey || frameworkPackage?.frameworkKey)
  const packageKey = String(runtimeInstance.packageKey || frameworkPackage?.packageKey || '').trim()
  const packageVersion = String(runtimeInstance.packageVersion || frameworkPackage?.version || '').trim()
  const frameworkConsumerId = buildNodeId(
    RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.REASONING_CONSUMER,
    'framework',
    frameworkKey,
    packageKey,
  )

  addNode(context, {
    nodeId: frameworkConsumerId,
    nodeType: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.REASONING_CONSUMER,
    label: safeLabel(`${frameworkKey || 'Framework'} Consumer`),
    consumerType: 'FRAMEWORK',
    frameworkKey,
    packageKey,
    packageVersion,
    metadata: createDefaultMetadata({
      reasoningStatus: REASONING_STATUSES.NOT_APPLICABLE,
      validationStatus: VALIDATION_STATUSES.UNKNOWN,
      lineageRefs: [packageKey].filter(Boolean),
    }),
  })
  context.consumerNodeBySectionKey.set('__framework__', frameworkConsumerId)

  getPackageSections({ frameworkPackage, frameworkState }).forEach((section) => {
    const sectionKey = normalizeKey(section?.sectionKey || section?.key)
    if (!sectionKey) return

    const consumerNodeId = buildNodeId(
      RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.REASONING_CONSUMER,
      'section',
      frameworkKey,
      packageKey,
      sectionKey,
    )
    addNode(context, {
      nodeId: consumerNodeId,
      nodeType: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.REASONING_CONSUMER,
      label: safeLabel(section.label || titleFromKey(sectionKey)),
      consumerType: 'FRAMEWORK_SECTION',
      frameworkKey,
      packageKey,
      packageVersion,
      sectionKey,
      runtimePath: String(section.runtimePath || `framework_state.sections.${sectionKey}`).trim(),
      required: section.required === true,
      metadata: createDefaultMetadata({
        reasoningStatus: REASONING_STATUSES.NOT_APPLICABLE,
        validationStatus: VALIDATION_STATUSES.UNKNOWN,
        lineageRefs: [section.runtimePath, packageKey].filter(Boolean),
      }),
    })
    context.consumerNodeBySectionKey.set(sectionKey, consumerNodeId)
  })
}

const addSourceNode = ({ context, source, sourceIdFallback, sourceTypeFallback = 'UNKNOWN' }) => {
  const sourceId = String(source?.sourceId || source?.sectionDocumentId || source?.lineageRef || sourceIdFallback || '').trim()
  if (!sourceId) return null
  const sourceType = normalizeToken(source?.sourceType || source?.type || sourceTypeFallback)
  const nodeId = buildNodeId(RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SOURCE, sourceId)
  const label = safeLabel(source?.label || source?.fileName || source?.url || source?.fieldKey || sourceId, 'Source')

  const node = addNode(context, {
    nodeId,
    nodeType: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SOURCE,
    label,
    sourceId,
    sourceType,
    sourceKind: sourceType,
    metadata: createDefaultMetadata({
      validationStatus: source?.status ? VALIDATION_STATUSES.PARTIALLY_VALIDATED : VALIDATION_STATUSES.UNKNOWN,
      reasoningStatus: REASONING_STATUSES.NOT_APPLICABLE,
      lineageRefs: [source.lineageRef, source.sourceId, source.sectionDocumentId].filter(Boolean),
    }),
  })
  context.sourceNodeBySourceId.set(sourceId, node.nodeId)
  return node
}

const buildEvidenceMetadata = ({ domain, evidenceObject, lowQuality, reviewStatus }) => {
  const {
    confidence,
    confidenceBasis,
    confidenceFactors,
    confidenceReason,
    confidenceScore,
    confidenceWarnings,
  } = extractConfidence(evidenceObject)
  const rejected = reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
  const accepted = reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
  const validationStatus = rejected
    ? VALIDATION_STATUSES.REJECTED
    : accepted
      ? VALIDATION_STATUSES.PARTIALLY_VALIDATED
      : VALIDATION_STATUSES.UNVALIDATED
  const reasoningStatus = rejected
    ? REASONING_STATUSES.NOT_APPLICABLE
    : lowQuality
      ? REASONING_STATUSES.VALIDATION_REQUIRED
      : accepted
      ? REASONING_STATUSES.READY_FOR_REASONING
      : REASONING_STATUSES.VALIDATION_REQUIRED
  const materialityResult = deriveMateriality({
    domain,
    explicitMateriality: evidenceObject.materiality,
    lowQuality,
    reviewStatus,
    validationStatus,
  })
  const decisionImpactResult = deriveDecisionImpact({
    domain,
    explicitDecisionImpact: evidenceObject.decisionImpact,
    materiality: materialityResult.materiality,
    validationStatus,
  })
  const readinessResult = deriveReadinessContribution({
    domain,
    materiality: materialityResult.materiality,
    reasoningStatus,
    validationStatus,
  })
  const nextConfidenceFactors = [
    ...confidenceFactors,
    accepted ? 'accepted evidence' : '',
    domain ? `coverage domain: ${domain}` : '',
  ].filter(Boolean)
  const nextConfidenceWarnings = [
    ...confidenceWarnings,
    rejected ? 'rejected evidence' : '',
    lowQuality ? 'low quality evidence' : '',
    !domain ? 'unclassified evidence domain' : '',
    !evidenceObject.sourceId && !evidenceObject.sourceRef ? 'missing source link' : '',
  ].filter(Boolean)

  return createDefaultMetadata({
    confidence,
    confidenceScore,
    confidenceBasis,
    confidenceFactors: nextConfidenceFactors,
    confidenceWarnings: nextConfidenceWarnings,
    confidenceReason: confidenceReason || (confidence === null
      ? 'No persisted confidence score is available.'
      : 'Persisted confidence score from evidence metadata.'),
    validationStatus,
    reasoningStatus,
    truthDomain: getTruthDomain({ domain, explicitTruthDomain: evidenceObject.truthDomain }),
    truthCoverage: domain ? [domain] : [],
    ...materialityResult,
    ...decisionImpactResult,
    ...readinessResult,
    contradictionRefs: Array.isArray(evidenceObject.contradictionRefs) ? evidenceObject.contradictionRefs : [],
    lineageRefs: [
      evidenceObject.lineageRef,
      evidenceObject.sourceId,
      evidenceObject.evidenceObjectId,
    ].filter(Boolean),
  })
}

const addEvidenceNode = ({
  context,
  evidenceObject,
  scope = 'GLOBAL',
  sectionKey = '',
}) => {
  const evidenceObjectId = String(evidenceObject?.evidenceObjectId || evidenceObject?.id || '').trim()
  if (!evidenceObjectId) return null

  const reviewStatus = normalizeReviewStatus(evidenceObject.reviewStatus)
  const domain = normalizeCoverageDomain(evidenceObject.coverageArea, evidenceObject.category, evidenceObject.truthCoverage?.[0])
  const lowQuality = getExplicitLowQuality(evidenceObject)
  const rejected = reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED
  const graphQualityState = rejected
    ? GRAPH_QUALITY_STATES.INVALID
    : lowQuality
      ? GRAPH_QUALITY_STATES.LOW_QUALITY
      : domain
        ? GRAPH_QUALITY_STATES.ORPHAN
        : GRAPH_QUALITY_STATES.UNCLASSIFIED
  const nodeId = buildNodeId(RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.EVIDENCE, scope, evidenceObjectId)
  const sourceId = String(evidenceObject.sourceId || evidenceObject.sourceRef || '').trim()
  const sourceNodeId = sourceId ? context.sourceNodeBySourceId.get(sourceId) : ''

  addNode(context, {
    nodeId,
    nodeType: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.EVIDENCE,
    label: safeLabel(evidenceObject.category || evidenceObject.coverageArea || evidenceObjectId, 'Evidence'),
    evidenceObjectId,
    sourceId,
    sectionKey: normalizeKey(sectionKey || evidenceObject.sectionKey),
    scope,
    reviewStatus,
    graphQualityState,
    coverageDomain: domain || '',
    snippet: safeSnippet(evidenceObject.extractedFact || evidenceObject.snippet || evidenceObject.summary),
    metadata: buildEvidenceMetadata({
      domain,
      evidenceObject,
      lowQuality,
      reviewStatus,
    }),
  })

  if (sourceNodeId) {
    addEdge(context, {
      edgeType: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.SOURCE_PRODUCES_EVIDENCE,
      fromNodeId: sourceNodeId,
      toNodeId: nodeId,
      basis: 'Persisted source registry entry produced this governed evidence object.',
      sourceRefs: [sourceId, evidenceObject.lineageRef].filter(Boolean),
      confidenceDriverRefs: extractConfidence(evidenceObject).confidenceBasis,
    })
  }

  context.evidenceRecords.set(nodeId, {
    nodeId,
    domain,
    evidenceObject,
    graphQualityState,
    lowQuality,
    reviewStatus,
    scope,
    sectionKey: normalizeKey(sectionKey || evidenceObject.sectionKey),
  })

  return context.nodes.get(nodeId)
}

const buildIntelligenceLabel = ({ domain, evidenceObject }) => {
  if (domain) return `${domain} Signal`
  return safeLabel(evidenceObject.category || evidenceObject.coverageArea || 'Unclassified Evidence Signal')
}

const addIntelligenceForEvidence = ({ context, evidenceNode, record }) => {
  if (!evidenceNode || !record) return null
  if (record.reviewStatus !== DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED) return null
  if (record.lowQuality) return null

  const intelligenceNodeId = buildNodeId(
    RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.INTELLIGENCE,
    record.scope,
    record.domain || 'unclassified',
    record.evidenceObject.evidenceObjectId,
  )
  const metadata = createDefaultMetadata({
    ...evidenceNode.metadata,
    reasoningStatus: REASONING_STATUSES.READY_FOR_REASONING,
    validationStatus: VALIDATION_STATUSES.PARTIALLY_VALIDATED,
    truthCoverage: record.domain ? [record.domain] : [],
    truthDomain: getTruthDomain({
      domain: record.domain,
      explicitTruthDomain: record.evidenceObject.truthDomain,
    }),
  })

  addNode(context, {
    nodeId: intelligenceNodeId,
    nodeType: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.INTELLIGENCE,
    label: buildIntelligenceLabel({
      domain: record.domain,
      evidenceObject: record.evidenceObject,
    }),
    sourceEvidenceNodeIds: [evidenceNode.nodeId],
    sectionKey: record.sectionKey,
    coverageDomain: record.domain || '',
    metadata,
  })
  addEdge(context, {
    edgeType: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.EVIDENCE_DERIVES_INTELLIGENCE,
    fromNodeId: evidenceNode.nodeId,
    toNodeId: intelligenceNodeId,
    basis: 'Accepted governed evidence deterministically derives this intelligence signal.',
    sourceRefs: [
      record.evidenceObject.sourceId,
      record.evidenceObject.evidenceObjectId,
      record.evidenceObject.lineageRef,
    ].filter(Boolean),
    confidenceDriverRefs: metadata.confidenceBasis,
  })

  const consumerNodeId = record.sectionKey
    ? context.consumerNodeBySectionKey.get(record.sectionKey)
    : context.consumerNodeBySectionKey.get('__framework__')
  if (consumerNodeId) {
    addEdge(context, {
      edgeType: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.INTELLIGENCE_SUPPORTS_CONSUMER,
      fromNodeId: intelligenceNodeId,
      toNodeId: consumerNodeId,
      basis: record.sectionKey
        ? 'Accepted section-scoped evidence supports this package section consumer.'
        : 'Accepted runtime-wide evidence supports this framework reasoning consumer.',
      sourceRefs: [
        record.evidenceObject.evidenceObjectId,
        record.evidenceObject.lineageRef,
      ].filter(Boolean),
      confidenceDriverRefs: metadata.confidenceBasis,
    })
  }

  context.intelligenceByEvidenceId.set(evidenceNode.nodeId, intelligenceNodeId)
  const nextEvidenceNode = {
    ...evidenceNode,
    graphQualityState: record.domain ? GRAPH_QUALITY_STATES.CONNECTED : GRAPH_QUALITY_STATES.UNCLASSIFIED,
  }
  addNode(context, nextEvidenceNode)
  context.evidenceRecords.set(evidenceNode.nodeId, {
    ...record,
    graphQualityState: nextEvidenceNode.graphQualityState,
  })

  return context.nodes.get(intelligenceNodeId)
}

const addDiscoveryEvidence = ({ context, evidencePack }) => {
  if (!isPlainObject(evidencePack)) return

  const acquisitionProfile = evidencePack.acquisition?.profile || evidencePack.acquisitionProfile || 'STANDARD'
  const refreshedAt = evidencePack.refreshedAt || evidencePack.acceptedAt || context.builtAt
  const lineageSources = Array.isArray(evidencePack.lineage?.sources) ? evidencePack.lineage.sources : []
  const normalizedEvidenceObjects = normalizeDiscoveryEvidenceObjects({
    acquisitionProfile,
    createdAt: refreshedAt,
    evidenceObjects: evidencePack.evidenceObjects,
    inputs: evidencePack.inputs,
    sources: lineageSources,
  })
  const evidenceObjects = isEvidencePackAccepted(evidencePack)
    ? acceptPendingDiscoveryEvidenceObjects({
        acceptedAt: evidencePack.acceptedAt || refreshedAt,
        actorUserId: evidencePack.acceptedBy || '',
        evidenceObjects: normalizedEvidenceObjects,
      })
    : normalizedEvidenceObjects
  const sourceRegistry = buildDiscoverySourceRegistry({
    capturedAt: refreshedAt,
    evidenceObjects,
    sourceRegistry: evidencePack.sourceRegistry || evidencePack.acquisition?.sourceRegistry,
    sources: lineageSources,
  })

  sourceRegistry.forEach((source) => addSourceNode({ context, source }))
  evidenceObjects.forEach((evidenceObject) => {
    const sourceId = String(evidenceObject.sourceId || '').trim()
    if (sourceId && !context.sourceNodeBySourceId.has(sourceId)) {
      addSourceNode({
        context,
        source: {
          sourceId,
          sourceType: evidenceObject.sourceType || evidenceObject.acquisitionMethod || 'DISCOVERY_EVIDENCE',
          label: evidenceObject.sourceLabel || sourceId,
          lineageRef: evidenceObject.lineageRef,
        },
      })
    }
    const evidenceNode = addEvidenceNode({ context, evidenceObject, scope: 'GLOBAL' })
    addIntelligenceForEvidence({
      context,
      evidenceNode,
      record: evidenceNode ? context.evidenceRecords.get(evidenceNode.nodeId) : null,
    })
  })
}

const addSectionEvidence = ({ context, frameworkState }) => {
  Object.entries(getRuntimeSections(frameworkState)).forEach(([rawSectionKey, sectionValue]) => {
    const sectionKey = normalizeKey(rawSectionKey)
    const documents = Array.isArray(sectionValue?.additionalEvidence?.documents)
      ? sectionValue.additionalEvidence.documents
      : []
    documents.forEach((document) => addSourceNode({
      context,
      source: {
        ...document,
        sourceId: document.sourceId || document.sectionDocumentId,
        sourceType: 'SECTION_UPLOADED_DOCUMENT',
        label: document.fileName,
      },
      sourceTypeFallback: 'SECTION_UPLOADED_DOCUMENT',
    }))

    const evidenceObjects = [
      ...(Array.isArray(sectionValue?.evidenceObjects) ? sectionValue.evidenceObjects : []),
      ...(Array.isArray(sectionValue?.additionalEvidence?.evidenceObjects)
        ? sectionValue.additionalEvidence.evidenceObjects
        : []),
    ]
    const seenEvidenceObjectIds = new Set()
    evidenceObjects.forEach((evidenceObject) => {
      const evidenceObjectId = String(evidenceObject?.evidenceObjectId || '').trim()
      if (!evidenceObjectId || seenEvidenceObjectIds.has(evidenceObjectId)) return
      seenEvidenceObjectIds.add(evidenceObjectId)

      const sourceId = String(evidenceObject.sourceId || '').trim()
      if (sourceId && !context.sourceNodeBySourceId.has(sourceId)) {
        addSourceNode({
          context,
          source: {
            sourceId,
            sourceType: evidenceObject.sourceType || 'SECTION_UPLOADED_DOCUMENT',
            label: evidenceObject.sourceFileName || sourceId,
            lineageRef: evidenceObject.lineageRef,
          },
          sourceTypeFallback: 'SECTION_UPLOADED_DOCUMENT',
        })
      }

      const evidenceNode = addEvidenceNode({
        context,
        evidenceObject: {
          ...evidenceObject,
          sectionKey,
        },
        scope: 'SECTION',
        sectionKey,
      })
      addIntelligenceForEvidence({
        context,
        evidenceNode,
        record: evidenceNode ? context.evidenceRecords.get(evidenceNode.nodeId) : null,
      })
    })
  })
}

const getSectionAcceptedTruth = (sectionValue = {}) =>
  isPlainObject(sectionValue.accepted) ? sectionValue.accepted : {}

const getAcceptedTruthHash = (accepted = {}) =>
  String(accepted.truthHash || accepted.acceptedTruthHash || accepted.contentHash || '').trim()
  || (accepted.content ? hashRuntimeIntelligenceGraphValue({ content: accepted.content }) : '')

const addSectionTruthNodes = ({ context, frameworkPackage, frameworkState, runtimeInstance }) => {
  const scopedViews = getCanonicalScopedViews(getEvidencePack(frameworkState))
  const sections = getRuntimeSections(frameworkState)

  getPackageSections({ frameworkPackage, frameworkState }).forEach((packageSection) => {
    const sectionKey = normalizeKey(packageSection.sectionKey || packageSection.key)
    const sectionValue = sections[sectionKey]
    const accepted = getSectionAcceptedTruth(sectionValue)
    const acceptedAt = accepted.acceptedAt || accepted.acceptanceTimestamp || ''
    const truthHash = getAcceptedTruthHash(accepted)

    if (!sectionKey || (!acceptedAt && !truthHash)) return
    const sectionTruthMateriality = deriveMateriality({
      explicitMateriality: accepted.materiality,
      validationStatus: VALIDATION_STATUSES.PARTIALLY_VALIDATED,
    })
    const sectionTruthDecisionImpact = deriveDecisionImpact({
      explicitDecisionImpact: accepted.decisionImpact,
      materiality: sectionTruthMateriality.materiality,
      validationStatus: VALIDATION_STATUSES.PARTIALLY_VALIDATED,
    })
    const sectionTruthReadiness = deriveReadinessContribution({
      materiality: sectionTruthMateriality.materiality,
      reasoningStatus: REASONING_STATUSES.READY_FOR_REASONING,
      validationStatus: VALIDATION_STATUSES.PARTIALLY_VALIDATED,
    })

    const sectionTruthNodeId = buildNodeId(
      RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SECTION_TRUTH,
      runtimeInstance.runtimeInstanceKey || runtimeInstance._id || runtimeInstance.id,
      sectionKey,
      truthHash || acceptedAt,
    )
    addNode(context, {
      nodeId: sectionTruthNodeId,
      nodeType: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SECTION_TRUTH,
      label: safeLabel(`${packageSection.label || titleFromKey(sectionKey)} Accepted Truth`),
      sectionKey,
      runtimePath: packageSection.runtimePath || `framework_state.sections.${sectionKey}`,
      truthHash,
      acceptedAt: acceptedAt || null,
      acceptedBy: toIdString(accepted.acceptedBy),
      metadata: createDefaultMetadata({
        validationStatus: VALIDATION_STATUSES.PARTIALLY_VALIDATED,
        reasoningStatus: REASONING_STATUSES.READY_FOR_REASONING,
        truthDomain: 'unknown',
        truthCoverage: [],
        ...sectionTruthMateriality,
        ...sectionTruthDecisionImpact,
        ...sectionTruthReadiness,
        lineageRefs: [
          accepted.sourceGeneratedAt,
          accepted.inputHash,
          accepted.dependencyHash,
          truthHash,
        ].filter(Boolean),
      }),
    })
    context.sectionTruthBySectionKey.set(sectionKey, sectionTruthNodeId)

    const scopedEvidenceObjectIds = new Set(
      (Array.isArray(scopedViews?.[sectionKey]?.evidenceObjectIds)
        ? scopedViews[sectionKey].evidenceObjectIds
        : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    )

    for (const [evidenceNodeId, intelligenceNodeId] of context.intelligenceByEvidenceId.entries()) {
      const record = context.evidenceRecords.get(evidenceNodeId)
      const supportsSection = record?.sectionKey === sectionKey
        || scopedEvidenceObjectIds.has(String(record?.evidenceObject?.evidenceObjectId || '').trim())

      if (!supportsSection) continue

      addEdge(context, {
        edgeType: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.INTELLIGENCE_SUPPORTS_SECTION_TRUTH,
        fromNodeId: intelligenceNodeId,
        toNodeId: sectionTruthNodeId,
        basis: 'Accepted intelligence evidence supports accepted section truth.',
        sourceRefs: [
          record.evidenceObject.evidenceObjectId,
          record.evidenceObject.lineageRef,
          truthHash,
        ].filter(Boolean),
        confidenceDriverRefs: extractConfidence(record.evidenceObject).confidenceBasis,
      })
    }
  })
}

const addSectionDependencyEdges = ({ context, frameworkPackage, frameworkState }) => {
  getPackageSections({ frameworkPackage, frameworkState }).forEach((section) => {
    const sectionKey = normalizeKey(section.sectionKey || section.key)
    const sectionTruthNodeId = context.sectionTruthBySectionKey.get(sectionKey)
    if (!sectionTruthNodeId) return

    getDependencySectionKeys(section).forEach((dependencySectionKey) => {
      const dependencyTruthNodeId = context.sectionTruthBySectionKey.get(dependencySectionKey)
      if (!dependencyTruthNodeId) {
        context.warnings.push({
          code: 'MISSING_DEPENDENCY_TRUTH',
          severity: 'WARNING',
          sectionKey,
          dependencySectionKey,
          message: 'Section declares a dependency that does not have accepted section truth.',
        })
        return
      }

      addEdge(context, {
        edgeType: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.SECTION_TRUTH_DEPENDS_ON_SECTION_TRUTH,
        fromNodeId: sectionTruthNodeId,
        toNodeId: dependencyTruthNodeId,
        basis: 'Package section dependency is backed by accepted section truth nodes.',
        sourceRefs: [section.runtimePath, dependencySectionKey].filter(Boolean),
      })
    })
  })
}

const addPublishedAndCanonicalTruth = ({ context, frameworkState, runtimeInstance }) => {
  const publish = isPlainObject(frameworkState.publish) ? frameworkState.publish : {}
  const lock = isPlainObject(frameworkState.lock) ? frameworkState.lock : {}
  let publishedNodeId = ''

  if (publish.published === true || publish.state === 'PUBLISHED' || publish.snapshot?.snapshotId) {
    const publishedMateriality = deriveMateriality({
      explicitMateriality: publish.materiality,
      validationStatus: VALIDATION_STATUSES.VALIDATED,
    })
    const publishedDecisionImpact = deriveDecisionImpact({
      explicitDecisionImpact: publish.decisionImpact,
      materiality: publishedMateriality.materiality,
      validationStatus: VALIDATION_STATUSES.VALIDATED,
    })
    const publishedReadiness = deriveReadinessContribution({
      materiality: publishedMateriality.materiality,
      reasoningStatus: REASONING_STATUSES.READY_FOR_REASONING,
      validationStatus: VALIDATION_STATUSES.VALIDATED,
    })
    publishedNodeId = buildNodeId(
      RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.PUBLISHED_TRUTH,
      runtimeInstance.runtimeInstanceKey || runtimeInstance._id || runtimeInstance.id,
      publish.publishVersion || publish.snapshot?.snapshotId || publish.publishedAt || 'published',
    )
    addNode(context, {
      nodeId: publishedNodeId,
      nodeType: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.PUBLISHED_TRUTH,
      label: 'Published Truth',
      publishedAt: publish.publishedAt || null,
      publishedBy: toIdString(publish.publishedBy),
      publishVersion: publish.publishVersion || null,
      snapshotId: publish.snapshot?.snapshotId || '',
      snapshotHash: publish.snapshot?.snapshotHash || '',
      metadata: createDefaultMetadata({
        validationStatus: VALIDATION_STATUSES.VALIDATED,
        reasoningStatus: REASONING_STATUSES.READY_FOR_REASONING,
        ...publishedMateriality,
        ...publishedDecisionImpact,
        ...publishedReadiness,
        lineageRefs: [
          publish.snapshot?.snapshotId,
          publish.snapshot?.snapshotHash,
          publish.evidence?.activationId,
          publish.evidence?.deploymentId,
          publish.evidence?.dependencySnapshotId,
        ].filter(Boolean),
      }),
    })

    for (const sectionTruthNodeId of context.sectionTruthBySectionKey.values()) {
      addEdge(context, {
        edgeType: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.SECTION_TRUTH_PUBLISHED_AS,
        fromNodeId: sectionTruthNodeId,
        toNodeId: publishedNodeId,
        basis: 'Accepted section truth was included in the runtime publish evidence.',
        sourceRefs: [
          publish.snapshot?.snapshotId,
          publish.snapshot?.snapshotHash,
        ].filter(Boolean),
      })
    }
  }

  if (lock.locked === true || lock.state === 'LOCKED' || lock.snapshot?.snapshotId) {
    const canonicalMateriality = deriveMateriality({
      explicitMateriality: lock.materiality,
      validationStatus: VALIDATION_STATUSES.VALIDATED,
    })
    const canonicalDecisionImpact = deriveDecisionImpact({
      explicitDecisionImpact: lock.decisionImpact,
      materiality: canonicalMateriality.materiality,
      validationStatus: VALIDATION_STATUSES.VALIDATED,
    })
    const canonicalReadiness = deriveReadinessContribution({
      materiality: canonicalMateriality.materiality,
      reasoningStatus: REASONING_STATUSES.READY_FOR_REASONING,
      validationStatus: VALIDATION_STATUSES.VALIDATED,
    })
    const canonicalNodeId = buildNodeId(
      RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.CANONICAL_TRUTH,
      runtimeInstance.runtimeInstanceKey || runtimeInstance._id || runtimeInstance.id,
      lock.lockVersion || lock.snapshot?.snapshotId || lock.lockedAt || 'canonical',
    )
    addNode(context, {
      nodeId: canonicalNodeId,
      nodeType: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.CANONICAL_TRUTH,
      label: 'Canonical Truth',
      lockedAt: lock.lockedAt || null,
      lockedBy: toIdString(lock.lockedBy),
      lockVersion: lock.lockVersion || null,
      snapshotId: lock.snapshot?.snapshotId || '',
      snapshotHash: lock.snapshot?.snapshotHash || '',
      replayAnchorId: lock.replayAnchor?.anchorId || lock.anchor?.anchorId || '',
      metadata: createDefaultMetadata({
        validationStatus: VALIDATION_STATUSES.VALIDATED,
        reasoningStatus: REASONING_STATUSES.READY_FOR_REASONING,
        ...canonicalMateriality,
        ...canonicalDecisionImpact,
        ...canonicalReadiness,
        lineageRefs: [
          lock.snapshot?.snapshotId,
          lock.snapshot?.snapshotHash,
          lock.replayAnchor?.anchorId,
          lock.anchor?.anchorId,
          lock.evidence?.activationId,
          lock.evidence?.deploymentId,
          lock.evidence?.dependencySnapshotId,
        ].filter(Boolean),
      }),
    })

    if (publishedNodeId) {
      addEdge(context, {
        edgeType: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.PUBLISHED_TRUTH_LOCKED_AS_CANONICAL,
        fromNodeId: publishedNodeId,
        toNodeId: canonicalNodeId,
        basis: 'Published truth was locked as canonical truth.',
        sourceRefs: [
          lock.snapshot?.snapshotId,
          lock.snapshot?.snapshotHash,
          lock.publish?.snapshotId,
          lock.publish?.snapshotHash,
        ].filter(Boolean),
      })
    }
  }
}

const calculateCoverage = (context) => {
  const domainCounts = RUNTIME_INTELLIGENCE_GRAPH_DOMAINS.reduce((acc, domain) => ({
    ...acc,
    [domain]: {
      domain,
      acceptedEvidenceCount: 0,
      connectedEvidenceCount: 0,
      pendingEvidenceCount: 0,
      rejectedEvidenceCount: 0,
      lowQualityEvidenceCount: 0,
      state: 'MISSING',
    },
  }), {})
  let unclassifiedEvidenceCount = 0

  for (const record of context.evidenceRecords.values()) {
    if (!record.domain) {
      if (record.reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED) unclassifiedEvidenceCount += 1
      continue
    }
    const row = domainCounts[record.domain]
    if (!row) continue

    if (record.reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED) {
      row.rejectedEvidenceCount += 1
      continue
    }
    if (record.lowQuality) {
      row.lowQualityEvidenceCount += 1
      continue
    }
    if (record.reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING) {
      row.pendingEvidenceCount += 1
      continue
    }
    if (record.reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED) {
      row.acceptedEvidenceCount += 1
      if (record.graphQualityState === GRAPH_QUALITY_STATES.CONNECTED) {
        row.connectedEvidenceCount += 1
      }
    }
  }

  const domains = Object.values(domainCounts).map((row) => {
    let state = 'MISSING'
    if (row.connectedEvidenceCount >= 2) state = 'STRONG'
    else if (row.connectedEvidenceCount === 1) state = 'ADEQUATE'
    else if (row.acceptedEvidenceCount > 0 || row.pendingEvidenceCount > 0 || row.lowQualityEvidenceCount > 0) state = 'WEAK'

    return {
      ...row,
      state,
    }
  })
  const coveredDomainCount = domains.filter((row) => row.connectedEvidenceCount > 0).length
  const missingDomains = domains.filter((row) => row.connectedEvidenceCount === 0).map((row) => row.domain)

  return {
    coverageModel: 'EVIDENCE_DOMAIN_COVERAGE',
    coveragePercent: Math.round((coveredDomainCount / RUNTIME_INTELLIGENCE_GRAPH_DOMAINS.length) * 100),
    coveredDomainCount,
    totalDomainCount: RUNTIME_INTELLIGENCE_GRAPH_DOMAINS.length,
    missingDomains,
    unclassifiedEvidenceCount,
    domains,
  }
}

const calculateDependencies = ({ context, frameworkPackage, frameworkState }) => {
  const sectionDependencies = getPackageSections({ frameworkPackage, frameworkState })
    .map((section) => {
      const sectionKey = normalizeKey(section.sectionKey || section.key)
      const dependencySectionKeys = getDependencySectionKeys(section)
      const missingDependencyTruthKeys = dependencySectionKeys.filter((dependencySectionKey) =>
        !context.sectionTruthBySectionKey.has(dependencySectionKey))
      return {
        sectionKey,
        sectionLabel: safeLabel(section.label || titleFromKey(sectionKey)),
        dependencySectionKeys,
        missingDependencyTruthKeys,
      }
    })
    .filter((section) => section.sectionKey && section.dependencySectionKeys.length > 0)

  return {
    sectionDependencyCount: sectionDependencies.reduce((count, section) =>
      count + section.dependencySectionKeys.length, 0),
    missingDependencyTruthCount: sectionDependencies.reduce((count, section) =>
      count + section.missingDependencyTruthKeys.length, 0),
    sections: sectionDependencies,
  }
}

const addSignalNodes = ({ context, coverage, dependencies }) => {
  const frameworkConsumerId = context.consumerNodeBySectionKey.get('__framework__')
  if (!frameworkConsumerId) return

  const coverageSignalNodeId = buildNodeId(RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SIGNAL, 'coverage', coverage.coveragePercent)
  const coverageReasoningStatus = coverage.missingDomains.length > 0
    ? REASONING_STATUSES.NEEDS_EVIDENCE
    : REASONING_STATUSES.READY_FOR_REASONING
  const coverageSignalMateriality = deriveMateriality({
    validationStatus: VALIDATION_STATUSES.PARTIALLY_VALIDATED,
  })
  const coverageSignalDecisionImpact = deriveDecisionImpact({
    materiality: coverageSignalMateriality.materiality,
    validationStatus: VALIDATION_STATUSES.PARTIALLY_VALIDATED,
  })
  const coverageSignalReadiness = deriveReadinessContribution({
    materiality: coverageSignalMateriality.materiality,
    reasoningStatus: coverageReasoningStatus,
    validationStatus: VALIDATION_STATUSES.PARTIALLY_VALIDATED,
  })
  addNode(context, {
    nodeId: coverageSignalNodeId,
    nodeType: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SIGNAL,
    label: 'Evidence Domain Coverage Signal',
    signalType: 'COVERAGE',
    metadata: createDefaultMetadata({
      validationStatus: VALIDATION_STATUSES.PARTIALLY_VALIDATED,
      reasoningStatus: coverageReasoningStatus,
      truthCoverage: coverage.domains
        .filter((domain) => domain.connectedEvidenceCount > 0)
        .map((domain) => domain.domain),
      ...coverageSignalMateriality,
      ...coverageSignalDecisionImpact,
      ...coverageSignalReadiness,
      lineageRefs: ['framework_state.evidence_pack'],
    }),
  })
  addEdge(context, {
    edgeType: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.NODE_HAS_SIGNAL,
    fromNodeId: frameworkConsumerId,
    toNodeId: coverageSignalNodeId,
    basis: 'Evidence Domain Coverage is calculated from accepted connected evidence.',
    sourceRefs: ['framework_state.evidence_pack'],
  })

  if (dependencies.sectionDependencyCount > 0) {
    const dependencyValidationStatus = dependencies.missingDependencyTruthCount > 0
      ? VALIDATION_STATUSES.PARTIALLY_VALIDATED
      : VALIDATION_STATUSES.VALIDATED
    const dependencyReasoningStatus = dependencies.missingDependencyTruthCount > 0
      ? REASONING_STATUSES.NEEDS_EVIDENCE
      : REASONING_STATUSES.READY_FOR_REASONING
    const dependencySignalMateriality = deriveMateriality({
      validationStatus: dependencyValidationStatus,
    })
    const dependencySignalDecisionImpact = deriveDecisionImpact({
      materiality: dependencySignalMateriality.materiality,
      validationStatus: dependencyValidationStatus,
    })
    const dependencySignalReadiness = deriveReadinessContribution({
      materiality: dependencySignalMateriality.materiality,
      reasoningStatus: dependencyReasoningStatus,
      validationStatus: dependencyValidationStatus,
    })
    const dependencySignalNodeId = buildNodeId(
      RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SIGNAL,
      'dependencies',
      dependencies.sectionDependencyCount,
    )
    addNode(context, {
      nodeId: dependencySignalNodeId,
      nodeType: RUNTIME_INTELLIGENCE_GRAPH_NODE_TYPES.SIGNAL,
      label: 'Section Dependency Signal',
      signalType: 'DEPENDENCY',
      metadata: createDefaultMetadata({
        validationStatus: dependencyValidationStatus,
        reasoningStatus: dependencyReasoningStatus,
        ...dependencySignalMateriality,
        ...dependencySignalDecisionImpact,
        ...dependencySignalReadiness,
        lineageRefs: dependencies.sections.map((section) => section.sectionKey),
      }),
    })
    addEdge(context, {
      edgeType: RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.NODE_HAS_SIGNAL,
      fromNodeId: frameworkConsumerId,
      toNodeId: dependencySignalNodeId,
      basis: 'Package section dependencies are represented in the graph summary.',
      sourceRefs: dependencies.sections.map((section) => section.sectionKey),
    })
  }
}

const calculateHealth = ({ context, coverage, dependencies, validationIssues }) => {
  const evidenceRecords = Array.from(context.evidenceRecords.values())
  const orphanEvidenceCount = evidenceRecords.filter((record) =>
    record.reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED
    && record.graphQualityState === GRAPH_QUALITY_STATES.ORPHAN).length
  const lowQualityEvidenceCount = evidenceRecords.filter((record) =>
    record.graphQualityState === GRAPH_QUALITY_STATES.LOW_QUALITY).length
  const rejectedEvidenceCount = evidenceRecords.filter((record) =>
    record.reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED).length
  const warningCount = context.warnings.length
    + coverage.missingDomains.length
    + orphanEvidenceCount
    + lowQualityEvidenceCount
    + coverage.unclassifiedEvidenceCount
    + dependencies.missingDependencyTruthCount
  const state = validationIssues.length > 0
    ? 'INVALID'
    : warningCount > 0
      ? 'WARNING'
      : 'HEALTHY'

  return {
    state,
    validationIssueCount: validationIssues.length,
    warningCount,
    nodeCount: context.nodes.size,
    edgeCount: context.edges.size,
    acceptedEvidenceCount: evidenceRecords.filter((record) =>
      record.reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED).length,
    rejectedEvidenceCount,
    orphanEvidenceCount,
    lowQualityEvidenceCount,
    unclassifiedEvidenceCount: coverage.unclassifiedEvidenceCount,
    missingDomainCount: coverage.missingDomains.length,
    dependencyCount: dependencies.sectionDependencyCount,
    missingDependencyTruthCount: dependencies.missingDependencyTruthCount,
    contradictionCount: 0,
  }
}

export const validateRuntimeIntelligenceGraph = (graph = {}) => {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const edges = Array.isArray(graph.edges) ? graph.edges : []
  const nodeIds = new Set(nodes.map((node) => node.nodeId).filter(Boolean))
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]).filter(([nodeId]) => Boolean(nodeId)))
  const issues = []

  nodes.forEach((node) => {
    if (!node.nodeId) {
      issues.push({
        code: 'NODE_ID_MISSING',
        nodeType: node.nodeType || '',
        message: 'Graph node is missing a deterministic nodeId.',
      })
    }

    if (!RUNTIME_INTELLIGENCE_GRAPH_ENTITY_REGISTRY[node.nodeType]) {
      issues.push({
        code: 'UNKNOWN_GRAPH_ENTITY_TYPE',
        nodeId: node.nodeId || '',
        nodeType: node.nodeType || '',
        message: 'Graph node uses an unknown entity type.',
      })
    }
  })

  edges.forEach((edge) => {
    const relationshipDefinition = RUNTIME_INTELLIGENCE_GRAPH_RELATIONSHIP_REGISTRY[edge.edgeType]
    if (!edge.edgeId) {
      issues.push({
        code: 'EDGE_ID_MISSING',
        edgeType: edge.edgeType || '',
        message: 'Graph edge is missing a deterministic edgeId.',
      })
    }
    if (!edge.basis) {
      issues.push({
        code: 'EDGE_BASIS_MISSING',
        edgeId: edge.edgeId || '',
        message: 'Graph edge is missing a relationship basis.',
      })
    }
    if (!relationshipDefinition) {
      issues.push({
        code: 'UNKNOWN_GRAPH_RELATIONSHIP_TYPE',
        edgeId: edge.edgeId || '',
        edgeType: edge.edgeType || '',
        message: 'Graph edge uses an unknown relationship type.',
      })
    }
    if (!nodeIds.has(edge.fromNodeId)) {
      issues.push({
        code: 'EDGE_FROM_NODE_MISSING',
        edgeId: edge.edgeId || '',
        fromNodeId: edge.fromNodeId || '',
        message: 'Graph edge source node is missing.',
      })
    }
    if (!nodeIds.has(edge.toNodeId)) {
      issues.push({
        code: 'EDGE_TO_NODE_MISSING',
        edgeId: edge.edgeId || '',
        toNodeId: edge.toNodeId || '',
        message: 'Graph edge target node is missing.',
      })
    }
    if (relationshipDefinition && nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId)) {
      const fromNodeType = nodeById.get(edge.fromNodeId)?.nodeType || ''
      const toNodeType = nodeById.get(edge.toNodeId)?.nodeType || ''
      if (!relationshipDefinition.fromNodeTypes.includes(fromNodeType)) {
        issues.push({
          code: 'EDGE_FROM_NODE_TYPE_MISMATCH',
          edgeId: edge.edgeId || '',
          edgeType: edge.edgeType || '',
          fromNodeId: edge.fromNodeId || '',
          fromNodeType,
          message: 'Graph edge source node type is not allowed by the relationship registry.',
        })
      }
      if (!relationshipDefinition.toNodeTypes.includes(toNodeType)) {
        issues.push({
          code: 'EDGE_TO_NODE_TYPE_MISMATCH',
          edgeId: edge.edgeId || '',
          edgeType: edge.edgeType || '',
          toNodeId: edge.toNodeId || '',
          toNodeType,
          message: 'Graph edge target node type is not allowed by the relationship registry.',
        })
      }
    }
  })

  edges
    .filter((edge) => edge.edgeType === RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.EVIDENCE_DERIVES_INTELLIGENCE)
    .forEach((edge) => {
      const evidenceNode = nodes.find((node) => node.nodeId === edge.fromNodeId)
      if (evidenceNode?.reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED) {
        issues.push({
          code: 'REJECTED_EVIDENCE_SUPPORTS_INTELLIGENCE',
          edgeId: edge.edgeId,
          message: 'Rejected evidence cannot derive Intelligence nodes.',
        })
      }
    })

  return issues
}

export const buildRuntimeIntelligenceGraph = ({
  actorUserId = '',
  buildTrigger = RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EXPLICIT_REBUILD,
  builtAt = new Date().toISOString(),
  frameworkPackage = null,
  runtimeInstance,
} = {}) => {
  const frameworkState = getGraphSourceFrameworkState(getFrameworkState(runtimeInstance))
  const context = createGraphContext({ builtAt })

  addReasoningConsumers({
    context,
    frameworkPackage,
    frameworkState,
    runtimeInstance,
  })
  addDiscoveryEvidence({
    context,
    evidencePack: getEvidencePack(frameworkState),
  })
  addSectionEvidence({ context, frameworkState })
  addSectionTruthNodes({
    context,
    frameworkPackage,
    frameworkState,
    runtimeInstance,
  })
  addSectionDependencyEdges({
    context,
    frameworkPackage,
    frameworkState,
  })
  addPublishedAndCanonicalTruth({
    context,
    frameworkState,
    runtimeInstance,
  })

  const coverage = calculateCoverage(context)
  const dependencies = calculateDependencies({ context, frameworkPackage, frameworkState })
  addSignalNodes({ context, coverage, dependencies })

  const sourceHash = buildRuntimeGraphSourceHash({ frameworkPackage, frameworkState, runtimeInstance })
  const scope = {
    customerId: toIdString(runtimeInstance?.customerId),
    tenantId: toIdString(runtimeInstance?.tenantId),
    projectId: toIdString(runtimeInstance?.projectId) || null,
    outcomeId: toIdString(runtimeInstance?.outcomeId) || null,
    frameworkId: toIdString(runtimeInstance?.frameworkId || runtimeInstance?.packageId) || null,
    runtimeId: toIdString(runtimeInstance?._id || runtimeInstance?.id),
  }
  const preliminaryGraph = {
    artifactType: RUNTIME_INTELLIGENCE_GRAPH_ARTIFACT_TYPE,
    graphVersion: RUNTIME_INTELLIGENCE_GRAPH_VERSION,
    runtimeInstanceId: toIdString(runtimeInstance?._id || runtimeInstance?.id),
    runtimeId: scope.runtimeId,
    customerId: scope.customerId,
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    outcomeId: scope.outcomeId,
    frameworkId: scope.frameworkId,
    scope,
    runtimeInstanceKey: runtimeInstance?.runtimeInstanceKey || '',
    runtimeType: normalizeToken(runtimeInstance?.runtimeType),
    frameworkKey: normalizeToken(runtimeInstance?.frameworkKey || frameworkPackage?.frameworkKey),
    packageKey: runtimeInstance?.packageKey || frameworkPackage?.packageKey || '',
    packageVersion: runtimeInstance?.packageVersion || frameworkPackage?.version || '',
    build: {
      status: 'VALID',
      trigger: normalizeToken(buildTrigger) || RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EXPLICIT_REBUILD,
      builtAt,
      builtBy: toIdString(actorUserId),
      sourceHash,
      nodeCount: context.nodes.size,
      edgeCount: context.edges.size,
    },
    nodes: Array.from(context.nodes.values()).sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    edges: Array.from(context.edges.values()).sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
    registries: {
      entityTypes: RUNTIME_INTELLIGENCE_GRAPH_ENTITY_REGISTRY,
      relationshipTypes: RUNTIME_INTELLIGENCE_GRAPH_RELATIONSHIP_REGISTRY,
    },
    coverage,
    dependencies,
    health: {},
    warnings: context.warnings,
  }
  const validationIssues = validateRuntimeIntelligenceGraph(preliminaryGraph)
  const health = calculateHealth({ context, coverage, dependencies, validationIssues })
  const graph = {
    ...preliminaryGraph,
    build: {
      ...preliminaryGraph.build,
      status: validationIssues.length > 0 ? 'INVALID' : 'VALID',
      nodeCount: preliminaryGraph.nodes.length,
      edgeCount: preliminaryGraph.edges.length,
    },
    health,
    validation: {
      status: validationIssues.length > 0 ? 'INVALID' : 'VALID',
      issues: validationIssues,
    },
  }

  return {
    ...graph,
    graphHash: hashRuntimeIntelligenceGraphValue({
      artifactType: graph.artifactType,
      graphVersion: graph.graphVersion,
      runtimeInstanceId: graph.runtimeInstanceId,
      scope: graph.scope,
      sourceHash,
      nodes: graph.nodes,
      edges: graph.edges,
      registries: graph.registries,
      coverage: graph.coverage,
      dependencies: graph.dependencies,
      health: graph.health,
      validation: graph.validation,
    }),
  }
}

const buildRuntimeInstanceGraphSnapshot = ({ frameworkState, runtimeInstance } = {}) => ({
  _id: runtimeInstance?._id || runtimeInstance?.id,
  id: runtimeInstance?.id || runtimeInstance?._id,
  runtimeInstanceKey: runtimeInstance?.runtimeInstanceKey || '',
  runtimeType: runtimeInstance?.runtimeType || '',
  frameworkKey: runtimeInstance?.frameworkKey || '',
  packageKey: runtimeInstance?.packageKey || '',
  packageVersion: runtimeInstance?.packageVersion || '',
  packageId: runtimeInstance?.packageId || null,
  frameworkId: runtimeInstance?.frameworkId || runtimeInstance?.packageId || null,
  customerId: runtimeInstance?.customerId || null,
  tenantId: runtimeInstance?.tenantId || null,
  projectId: runtimeInstance?.projectId || null,
  outcomeId: runtimeInstance?.outcomeId || null,
  framework_state: frameworkState || {},
})

export const buildRuntimeIntelligenceGraphForFrameworkState = ({
  actorUserId = '',
  buildTrigger = RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EXPLICIT_REBUILD,
  builtAt,
  frameworkPackage = null,
  frameworkState = {},
  runtimeInstance,
} = {}) => buildRuntimeIntelligenceGraph({
  actorUserId,
  buildTrigger,
  ...(builtAt ? { builtAt } : {}),
  frameworkPackage,
  runtimeInstance: buildRuntimeInstanceGraphSnapshot({ frameworkState, runtimeInstance }),
})

export const buildRuntimeIntelligenceGraphAuditSummary = ({
  autoRebuilt = false,
  buildTrigger = RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EXPLICIT_REBUILD,
  nextGraph = {},
  previousGraph = {},
} = {}) => {
  const hasPreviousGraph = isPlainObject(previousGraph) && Object.keys(previousGraph).length > 0
  const previousGraphHash = previousGraph?.graphHash || (
    hasPreviousGraph ? hashRuntimeIntelligenceGraphValue(previousGraph) : ''
  )

  return {
    autoRebuilt: autoRebuilt === true,
    graphVersion: nextGraph.graphVersion || RUNTIME_INTELLIGENCE_GRAPH_VERSION,
    buildTrigger: normalizeToken(buildTrigger) || nextGraph.build?.trigger || RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EXPLICIT_REBUILD,
    sourceHash: nextGraph.build?.sourceHash || '',
    previousGraphHash,
    nextGraphHash: nextGraph.graphHash || '',
    nodeCount: nextGraph.build?.nodeCount || 0,
    edgeCount: nextGraph.build?.edgeCount || 0,
    healthState: nextGraph.health?.state || 'UNKNOWN',
    validationResult: nextGraph.validation?.status || 'UNKNOWN',
  }
}

const buildUnavailableProjection = ({ includeGraphContract = true } = {}) => {
  const projection = {
    available: false,
    artifactType: RUNTIME_INTELLIGENCE_GRAPH_ARTIFACT_TYPE,
    graphVersion: RUNTIME_INTELLIGENCE_GRAPH_VERSION,
    build: {
      status: 'UNAVAILABLE',
      trigger: '',
      builtAt: '',
      nodeCount: 0,
      edgeCount: 0,
    },
    validation: {
      status: 'UNAVAILABLE',
      issues: [],
    },
    health: {
      state: 'UNAVAILABLE',
      nodeCount: 0,
      edgeCount: 0,
      acceptedEvidenceCount: 0,
      orphanEvidenceCount: 0,
      lowQualityEvidenceCount: 0,
      unclassifiedEvidenceCount: 0,
      missingDomainCount: RUNTIME_INTELLIGENCE_GRAPH_DOMAINS.length,
      dependencyCount: 0,
      contradictionCount: 0,
    },
    coverage: {
      coverageModel: 'EVIDENCE_DOMAIN_COVERAGE',
      coveragePercent: 0,
      coveredDomainCount: 0,
      totalDomainCount: RUNTIME_INTELLIGENCE_GRAPH_DOMAINS.length,
      missingDomains: [...RUNTIME_INTELLIGENCE_GRAPH_DOMAINS],
      domains: RUNTIME_INTELLIGENCE_GRAPH_DOMAINS.map((domain) => ({
        domain,
        acceptedEvidenceCount: 0,
        connectedEvidenceCount: 0,
        pendingEvidenceCount: 0,
        rejectedEvidenceCount: 0,
        lowQualityEvidenceCount: 0,
        state: 'MISSING',
      })),
    },
    dependencies: {
      sectionDependencyCount: 0,
      missingDependencyTruthCount: 0,
      sections: [],
    },
    missingAreas: [...RUNTIME_INTELLIGENCE_GRAPH_DOMAINS],
    quality: {
      orphanEvidenceCount: 0,
      lowQualityEvidenceCount: 0,
      unclassifiedEvidenceCount: 0,
    },
  }

  if (includeGraphContract) {
    projection.scope = {
      customerId: '',
      tenantId: '',
      projectId: null,
      outcomeId: null,
      frameworkId: null,
      runtimeId: '',
    }
    projection.registries = {
      entityTypes: RUNTIME_INTELLIGENCE_GRAPH_ENTITY_REGISTRY,
      relationshipTypes: RUNTIME_INTELLIGENCE_GRAPH_RELATIONSHIP_REGISTRY,
    }
  }

  return projection
}

const buildNodeSummary = (nodes = []) => nodes.reduce((acc, node) => {
  const nodeType = node.nodeType || 'UNKNOWN'
  acc[nodeType] = (acc[nodeType] || 0) + 1
  return acc
}, {})

const buildEdgeSummary = (edges = []) => edges.reduce((acc, edge) => {
  const edgeType = edge.edgeType || 'UNKNOWN'
  acc[edgeType] = (acc[edgeType] || 0) + 1
  return acc
}, {})

const projectNode = (node = {}) => ({
  nodeId: node.nodeId,
  nodeType: node.nodeType,
  entityDefinitionKey: node.entityDefinitionKey || node.nodeType,
  entityDisplayName: node.entityDisplayName || RUNTIME_INTELLIGENCE_GRAPH_ENTITY_REGISTRY[node.nodeType]?.displayName || titleFromKey(node.nodeType),
  label: node.label,
  customerVisible: node.customerVisible !== false,
  ...(node.sectionKey ? { sectionKey: node.sectionKey } : {}),
  ...(node.consumerType ? { consumerType: node.consumerType } : {}),
  ...(node.frameworkKey ? { frameworkKey: node.frameworkKey } : {}),
  ...(node.packageKey ? { packageKey: node.packageKey } : {}),
  ...(node.coverageDomain ? { coverageDomain: node.coverageDomain } : {}),
  ...(node.reviewStatus ? { reviewStatus: node.reviewStatus } : {}),
  ...(node.graphQualityState ? { graphQualityState: node.graphQualityState } : {}),
  metadata: createDefaultMetadata(node.metadata || {}),
})

const projectEdge = (edge = {}) => ({
  edgeId: edge.edgeId,
  edgeType: edge.edgeType,
  relationshipDefinitionKey: edge.relationshipDefinitionKey || edge.edgeType,
  relationshipDisplayName: edge.relationshipDisplayName || RUNTIME_INTELLIGENCE_GRAPH_RELATIONSHIP_REGISTRY[edge.edgeType]?.displayName || titleFromKey(edge.edgeType),
  fromNodeId: edge.fromNodeId,
  toNodeId: edge.toNodeId,
  basis: edge.basis,
  contributesTo: Array.isArray(edge.contributesTo)
    ? edge.contributesTo
    : RUNTIME_INTELLIGENCE_GRAPH_RELATIONSHIP_REGISTRY[edge.edgeType]?.contributesTo || [],
  customerVisible: edge.customerVisible !== false,
  validationState: edge.validationState || 'UNKNOWN',
})

export const buildRuntimeIntelligenceGraphProjection = (graph = {}, { includeGraphElements = false } = {}) => {
  if (!isPlainObject(graph) || graph.artifactType !== RUNTIME_INTELLIGENCE_GRAPH_ARTIFACT_TYPE) {
    return buildUnavailableProjection({ includeGraphContract: includeGraphElements })
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const edges = Array.isArray(graph.edges) ? graph.edges : []
  const coverage = isPlainObject(graph.coverage) ? graph.coverage : buildUnavailableProjection().coverage
  const health = isPlainObject(graph.health) ? graph.health : buildUnavailableProjection().health
  const dependencies = isPlainObject(graph.dependencies) ? graph.dependencies : buildUnavailableProjection().dependencies
  const scope = isPlainObject(graph.scope)
    ? cloneValue(graph.scope)
    : {
        customerId: toIdString(graph.customerId),
        tenantId: toIdString(graph.tenantId),
        projectId: toIdString(graph.projectId) || null,
        outcomeId: toIdString(graph.outcomeId) || null,
        frameworkId: toIdString(graph.frameworkId) || null,
        runtimeId: toIdString(graph.runtimeId || graph.runtimeInstanceId),
      }
  const projection = {
    available: true,
    artifactType: RUNTIME_INTELLIGENCE_GRAPH_ARTIFACT_TYPE,
    graphVersion: graph.graphVersion || RUNTIME_INTELLIGENCE_GRAPH_VERSION,
    graphHash: graph.graphHash || '',
    build: {
      status: graph.build?.status || 'UNKNOWN',
      trigger: graph.build?.trigger || '',
      builtAt: graph.build?.builtAt || '',
      nodeCount: Number(graph.build?.nodeCount || nodes.length),
      edgeCount: Number(graph.build?.edgeCount || edges.length),
      sourceHash: graph.build?.sourceHash || '',
    },
    validation: isPlainObject(graph.validation)
      ? cloneValue(graph.validation)
      : {
          status: 'UNKNOWN',
          issues: [],
        },
    health: cloneValue(health),
    coverage: cloneValue(coverage),
    dependencies: cloneValue(dependencies),
    missingAreas: Array.isArray(coverage.missingDomains) ? [...coverage.missingDomains] : [],
    quality: {
      orphanEvidenceCount: Number(health.orphanEvidenceCount || 0),
      lowQualityEvidenceCount: Number(health.lowQualityEvidenceCount || 0),
      unclassifiedEvidenceCount: Number(health.unclassifiedEvidenceCount || 0),
    },
    nodeSummary: buildNodeSummary(nodes),
    edgeSummary: buildEdgeSummary(edges),
  }

  if (includeGraphElements) {
    projection.scope = scope
    projection.registries = {
      entityTypes: cloneValue(graph.registries?.entityTypes || RUNTIME_INTELLIGENCE_GRAPH_ENTITY_REGISTRY),
      relationshipTypes: cloneValue(graph.registries?.relationshipTypes || RUNTIME_INTELLIGENCE_GRAPH_RELATIONSHIP_REGISTRY),
    }
    projection.nodes = nodes.map(projectNode)
    projection.edges = edges.map(projectEdge)
  }

  return projection
}

const SUPPORT_EDGE_TYPES = new Set([
  RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.SOURCE_PRODUCES_EVIDENCE,
  RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.EVIDENCE_DERIVES_INTELLIGENCE,
  RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.INTELLIGENCE_SUPPORTS_SECTION_TRUTH,
  RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.SECTION_TRUTH_PUBLISHED_AS,
  RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.PUBLISHED_TRUTH_LOCKED_AS_CANONICAL,
  RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.CANONICAL_TRUTH_REFERENCED_BY_OUTPUT,
  RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.INTELLIGENCE_SUPPORTS_CONSUMER,
])

const CONTRADICTION_EDGE_TYPES = new Set([
  RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.EVIDENCE_CONTRADICTS_EVIDENCE,
  RUNTIME_INTELLIGENCE_GRAPH_EDGE_TYPES.INTELLIGENCE_CONTRADICTS_INTELLIGENCE,
])

const getQueryNodeById = (projection = {}) =>
  new Map((projection.nodes || []).map((node) => [node.nodeId, node]))

const buildNodePair = ({ edge, nodeById }) => ({
  edge,
  fromNode: nodeById.get(edge.fromNodeId) || null,
  toNode: nodeById.get(edge.toNodeId) || null,
})

const buildSupportQueryProjection = (projection = {}) => {
  const nodeById = getQueryNodeById(projection)
  const relationships = (projection.edges || [])
    .filter((edge) => SUPPORT_EDGE_TYPES.has(edge.edgeType))
    .map((edge) => buildNodePair({ edge, nodeById }))

  return {
    available: projection.available,
    graphVersion: projection.graphVersion,
    graphHash: projection.graphHash,
    scope: projection.scope,
    queryType: RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.SUPPORT,
    relationshipCount: relationships.length,
    relationships,
  }
}

const buildContradictionsQueryProjection = (projection = {}) => {
  const nodeById = getQueryNodeById(projection)
  const relationships = (projection.edges || [])
    .filter((edge) => CONTRADICTION_EDGE_TYPES.has(edge.edgeType))
    .map((edge) => buildNodePair({ edge, nodeById }))
  const nodes = (projection.nodes || [])
    .filter((node) =>
      node.metadata?.validationStatus === VALIDATION_STATUSES.CONTRADICTED
      || (Array.isArray(node.metadata?.contradictionRefs) && node.metadata.contradictionRefs.length > 0))

  return {
    available: projection.available,
    graphVersion: projection.graphVersion,
    graphHash: projection.graphHash,
    scope: projection.scope,
    queryType: RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.CONTRADICTIONS,
    contradictionCount: relationships.length + nodes.length,
    relationships,
    nodes,
  }
}

const buildReadinessQueryProjection = (projection = {}) => {
  const nodes = (projection.nodes || [])
    .filter((node) => node.metadata?.readinessContribution && node.metadata.readinessContribution !== READINESS_CONTRIBUTIONS.NONE)
    .map((node) => ({
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      label: node.label,
      sectionKey: node.sectionKey,
      readinessContribution: node.metadata.readinessContribution,
      readinessWeight: node.metadata.readinessWeight,
      readinessDomain: node.metadata.readinessDomain,
      reasoningStatus: node.metadata.reasoningStatus,
      validationStatus: node.metadata.validationStatus,
    }))
  const blockers = nodes.filter((node) => node.readinessContribution === READINESS_CONTRIBUTIONS.BLOCKER)

  return {
    available: projection.available,
    graphVersion: projection.graphVersion,
    graphHash: projection.graphHash,
    scope: projection.scope,
    queryType: RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.READINESS,
    state: blockers.length > 0 || projection.coverage?.missingDomains?.length > 0 ? 'PARTIALLY_READY' : 'READY',
    blockerCount: blockers.length,
    contributionCount: nodes.length,
    missingDomains: projection.coverage?.missingDomains || [],
    nodes,
  }
}

const buildDecisionsQueryProjection = (projection = {}) => {
  const nodes = (projection.nodes || [])
    .filter((node) =>
      node.metadata?.decisionImpact
      && node.metadata.decisionImpact !== DECISION_IMPACTS.UNKNOWN)
    .map((node) => ({
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      label: node.label,
      sectionKey: node.sectionKey,
      coverageDomain: node.coverageDomain,
      materiality: node.metadata.materiality,
      materialityScore: node.metadata.materialityScore,
      materialityReason: node.metadata.materialityReason,
      decisionImpact: node.metadata.decisionImpact,
      decisionImpactScore: node.metadata.decisionImpactScore,
      decisionImpactReason: node.metadata.decisionImpactReason,
      validationStatus: node.metadata.validationStatus,
    }))

  return {
    available: projection.available,
    graphVersion: projection.graphVersion,
    graphHash: projection.graphHash,
    scope: projection.scope,
    queryType: RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.DECISIONS,
    nodeCount: nodes.length,
    nodes,
  }
}

const buildDependenciesQueryProjection = (projection = {}) => ({
  available: projection.available,
  graphVersion: projection.graphVersion,
  graphHash: projection.graphHash,
  scope: projection.scope,
  queryType: RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.DEPENDENCIES,
  dependencies: projection.dependencies,
})

const buildCoverageQueryProjection = (projection = {}) => ({
  available: projection.available,
  graphVersion: projection.graphVersion,
  graphHash: projection.graphHash,
  scope: projection.scope,
  queryType: RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.COVERAGE,
  coverage: projection.coverage,
  missingAreas: projection.missingAreas,
  quality: projection.quality,
})

const getClosedGraphQueryReason = (projection = {}) => {
  const buildStatus = normalizeToken(projection.build?.status)
  const validationStatus = normalizeToken(projection.validation?.status)
  const healthState = normalizeToken(projection.health?.state)

  if ([buildStatus, validationStatus, healthState].includes('INVALID')) {
    return {
      code: 'GRAPH_QUERY_UNAVAILABLE_INVALID_GRAPH',
      message: 'The intelligence graph is invalid and cannot be used for query responses.',
      buildStatus,
      validationStatus,
      healthState,
    }
  }

  if ([buildStatus, validationStatus, healthState].includes('STALE') || projection.build?.stale === true) {
    return {
      code: 'GRAPH_QUERY_UNAVAILABLE_STALE_GRAPH',
      message: 'The intelligence graph is stale and must be rebuilt before query responses are available.',
      buildStatus,
      validationStatus,
      healthState,
    }
  }

  return null
}

const buildClosedGraphQueryProjection = ({ projection = {}, queryType = '', reason = {} } = {}) => ({
  available: false,
  graphVersion: projection.graphVersion || RUNTIME_INTELLIGENCE_GRAPH_VERSION,
  graphHash: projection.graphHash || '',
  scope: projection.scope,
  queryType,
  build: projection.build,
  validation: projection.validation,
  health: projection.health,
  error: reason,
})

export const buildRuntimeIntelligenceGraphQueryProjection = (projection = {}, queryType = '') => {
  const normalizedQueryType = String(queryType || '').trim().toLowerCase()
  if (!Object.values(RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES).includes(normalizedQueryType)) {
    return {
      available: false,
      queryType: normalizedQueryType,
      error: {
        code: 'GRAPH_QUERY_TYPE_UNSUPPORTED',
        message: 'Unsupported intelligence graph query type.',
      },
    }
  }

  if (!projection.available) {
    return {
      ...buildUnavailableProjection(),
      queryType: normalizedQueryType,
    }
  }

  const closedReason = getClosedGraphQueryReason(projection)
  if (closedReason) {
    return buildClosedGraphQueryProjection({
      projection,
      queryType: normalizedQueryType,
      reason: closedReason,
    })
  }

  switch (normalizedQueryType) {
    case RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.SUPPORT:
      return buildSupportQueryProjection(projection)
    case RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.CONTRADICTIONS:
      return buildContradictionsQueryProjection(projection)
    case RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.COVERAGE:
      return buildCoverageQueryProjection(projection)
    case RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.DEPENDENCIES:
      return buildDependenciesQueryProjection(projection)
    case RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.READINESS:
      return buildReadinessQueryProjection(projection)
    case RUNTIME_INTELLIGENCE_GRAPH_QUERY_TYPES.DECISIONS:
      return buildDecisionsQueryProjection(projection)
    default:
      return {
        available: false,
        queryType: normalizedQueryType,
        error: {
          code: 'GRAPH_QUERY_TYPE_UNSUPPORTED',
          message: 'Unsupported intelligence graph query type.',
        },
      }
  }
}

export const getRuntimeIntelligenceGraph = async ({
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await getRuntimeInstance({ scopes, runtimeInstanceId })
  const graph = getFrameworkState(runtimeInstance).intelligence_graph
  return buildRuntimeIntelligenceGraphProjection(graph, { includeGraphElements: true })
}

export const getRuntimeIntelligenceGraphQuery = async ({
  queryType,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const projection = await getRuntimeIntelligenceGraph({ runtimeInstanceId, scopes })
  return buildRuntimeIntelligenceGraphQueryProjection(projection, queryType)
}

export const getRuntimeIntelligenceGraphHealth = async ({
  runtimeInstanceId,
  scopes,
} = {}) => {
  const projection = await getRuntimeIntelligenceGraph({ runtimeInstanceId, scopes })
  return {
    available: projection.available,
    graphVersion: projection.graphVersion,
    graphHash: projection.graphHash,
    build: projection.build,
    health: projection.health,
  }
}

export const getRuntimeIntelligenceGraphCoverage = async ({
  runtimeInstanceId,
  scopes,
} = {}) => {
  const projection = await getRuntimeIntelligenceGraph({ runtimeInstanceId, scopes })
  return {
    available: projection.available,
    graphVersion: projection.graphVersion,
    graphHash: projection.graphHash,
    build: projection.build,
    coverage: projection.coverage,
    missingAreas: projection.missingAreas,
    quality: projection.quality,
  }
}

export const getRuntimeIntelligenceGraphNodeLineage = async ({
  nodeId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const projection = await getRuntimeIntelligenceGraph({ runtimeInstanceId, scopes })
  if (!projection.available) {
    return {
      available: false,
      nodeId,
      node: null,
      incomingEdges: [],
      outgoingEdges: [],
      lineageRefs: [],
    }
  }

  const node = projection.nodes.find((candidate) => candidate.nodeId === nodeId) || null
  const incomingEdges = projection.edges.filter((edge) => edge.toNodeId === nodeId)
  const outgoingEdges = projection.edges.filter((edge) => edge.fromNodeId === nodeId)

  return {
    available: Boolean(node),
    nodeId,
    node,
    incomingEdges,
    outgoingEdges,
    lineageRefs: Array.isArray(node?.metadata?.lineageRefs) ? node.metadata.lineageRefs : [],
  }
}

export const getRuntimeIntelligenceGraphSectionDependencies = async ({
  runtimeInstanceId,
  scopes,
  sectionKey,
} = {}) => {
  const projection = await getRuntimeIntelligenceGraph({ runtimeInstanceId, scopes })
  const normalizedSectionKey = normalizeKey(sectionKey)
  const dependencies = projection.dependencies?.sections?.find((section) =>
    normalizeKey(section.sectionKey) === normalizedSectionKey) || null

  return {
    available: projection.available,
    graphVersion: projection.graphVersion,
    graphHash: projection.graphHash,
    sectionKey: normalizedSectionKey,
    dependencies: dependencies || {
      sectionKey: normalizedSectionKey,
      dependencySectionKeys: [],
      missingDependencyTruthKeys: [],
    },
  }
}

const runtimeIntelligenceGraphService = {
  buildRuntimeIntelligenceGraph,
  buildRuntimeIntelligenceGraphAuditSummary,
  buildRuntimeIntelligenceGraphForFrameworkState,
  buildRuntimeIntelligenceGraphProjection,
  buildRuntimeIntelligenceGraphQueryProjection,
  getRuntimeIntelligenceGraph,
  getRuntimeIntelligenceGraphCoverage,
  getRuntimeIntelligenceGraphHealth,
  getRuntimeIntelligenceGraphNodeLineage,
  getRuntimeIntelligenceGraphQuery,
  getRuntimeIntelligenceGraphSectionDependencies,
  hashRuntimeIntelligenceGraphValue,
  validateRuntimeIntelligenceGraph,
}

export default runtimeIntelligenceGraphService
