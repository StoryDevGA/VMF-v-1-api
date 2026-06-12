export const TRUTH_QUALITY_CONTRACT_VERSION = 'truth-quality.v1'

export const TRUTH_QUALITY_AUDIT_ACTION = 'TRUTH_QUALITY_EVALUATED'

export const TRUTH_QUALITY_BANDS = Object.freeze({
  NONE: 'NONE',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  VERY_HIGH: 'VERY_HIGH',
})

export const TRUTH_QUALITY_DIMENSION_SOURCES = Object.freeze({
  DIG_COVERAGE: 'DIG_COVERAGE',
  ACCEPTED_EVIDENCE: 'ACCEPTED_EVIDENCE',
  SOURCE_REGISTRY: 'SOURCE_REGISTRY',
  DIG_CONTRADICTIONS: 'DIG_CONTRADICTIONS',
})

export const TRUTH_QUALITY_CONTRADICTION_RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  BLOCKING: 'BLOCKING',
})

export const TRUTH_CERTIFICATION_LEVELS = Object.freeze({
  UNCERTIFIED: Object.freeze({
    key: 'UNCERTIFIED',
    levelNumber: 0,
    label: 'Uncertified',
  }),
  EVIDENCE_PRESENT: Object.freeze({
    key: 'EVIDENCE_PRESENT',
    levelNumber: 1,
    label: 'Evidence Present',
  }),
  EVIDENCE_SUPPORTED: Object.freeze({
    key: 'EVIDENCE_SUPPORTED',
    levelNumber: 2,
    label: 'Evidence Supported',
  }),
  CERTIFIED_TRUTH: Object.freeze({
    key: 'CERTIFIED_TRUTH',
    levelNumber: 3,
    label: 'Certified Truth',
  }),
  STRATEGIC_TRUTH: Object.freeze({
    key: 'STRATEGIC_TRUTH',
    levelNumber: 4,
    label: 'Strategic Truth',
  }),
})

export const TRUTH_QUALITY_ERROR_REASONS = Object.freeze({
  TRUTH_QUALITY_AUDIT_PERSISTENCE_FAILED: 'TRUTH_QUALITY_AUDIT_PERSISTENCE_FAILED',
  TRUTH_QUALITY_UNSUPPORTED_RUNTIME_TYPE: 'TRUTH_QUALITY_UNSUPPORTED_RUNTIME_TYPE',
})

