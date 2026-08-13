import {
  OUTCOME_EVIDENCE_KINDS,
  TRUTH_CERTIFICATION_FRAMEWORK_EVIDENCE_KIND_BY_CHECK_KEY,
  TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_KEY,
} from './truthCertificationFrameworkExecutorService.js'

const normalizeToken = (value) => String(value ?? '').trim().toUpperCase()
const normalizeKey = (value) => String(value ?? '').trim().toLowerCase()
export const sanitizeOutcomeEvidenceKind = (value, checkKey = '', { validatorKey = '' } = {}) => {
  const normalized = normalizeToken(value)
  const normalizedCheckKey = normalizeToken(checkKey)
  if (!Object.values(OUTCOME_EVIDENCE_KINDS).includes(normalized)) {
    return OUTCOME_EVIDENCE_KINDS.NOT_RECORDED
  }
  const frameworkOwned = normalizeKey(validatorKey) === TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_KEY
  if (frameworkOwned) {
    const expectedKind = TRUTH_CERTIFICATION_FRAMEWORK_EVIDENCE_KIND_BY_CHECK_KEY[normalizedCheckKey]
    return expectedKind === normalized ? normalized : OUTCOME_EVIDENCE_KINDS.NOT_RECORDED
  }
  if (normalized === OUTCOME_EVIDENCE_KINDS.FRAMEWORK_CONTROL) {
    return OUTCOME_EVIDENCE_KINDS.NOT_RECORDED
  }
  return normalized
}

export default sanitizeOutcomeEvidenceKind
