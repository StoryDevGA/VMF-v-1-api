import Ajv from 'ajv'
import { VE02_RESULT_SCHEMA, isVE02CalendarTimestamp } from './ve02EvidenceAssessmentResultContract.js'

export const VE02_DIMENSIONS = ['source_reliability', 'relevance', 'specificity', 'independence']
export const VE02_UNRESOLVED_RESTRICTIONS = ['NON_COMPLETE_DO_NOT_CONSUME',
  'TRANSPORT_PLACEHOLDER_NOT_AN_INSUFFICIENCY_FINDING']
const validate = new Ajv({ strict: false }).compile(VE02_RESULT_SCHEMA)
const rank = { WEAK: 0, MODERATE: 1, STRONG: 2 }
const checked = (result) => validate(result) ? result : {
  result_status: 'INVALID', diagnostic: 'VE02 derived result exceeds its bounded contract.' }

// VE02-GRADE-001 v1.0: aggregate preclassified features, never classify raw
// customer evidence or establish a hypothesis/conflict by inference.
export const gradeVE02PreclassifiedEvidence = ({ candidate, currentRevision, conflictEstablished = false,
  recomputeRequired = false }) => {
  if (!validate(candidate) || !candidate.provenance_refs.length
    || !isVE02CalendarTimestamp(candidate.assessed_at) || candidate.result_status !== 'COMPLETE'
    || (conflictEstablished && new Set(candidate.contradiction_refs).size < 2)) {
    return { result_status: 'INVALID', diagnostic: 'VE02 required identity, lineage, timestamp or classifications are invalid.' }
  }
  const result = structuredClone(candidate)
  const unresolved = recomputeRequired || !currentRevision || currentRevision !== result.evidence_revision_ref
    || result.evidence_direction === 'UNRESOLVED' || VE02_DIMENSIONS.some((key) => result[key] === 'UNRESOLVED')
  if (unresolved) {
    result.result_status = 'UNRESOLVED'
    result.assessment_result = 'INSUFFICIENT'
    result.evidence_direction = 'UNRESOLVED'
    result.restrictions = [...new Set([...result.restrictions, ...VE02_UNRESOLVED_RESTRICTIONS])]
    if (recomputeRequired || currentRevision !== result.evidence_revision_ref) result.restrictions.push('RECOMPUTE_REQUIRED')
    result.assessment_reasons.push('Unresolved grading, direction or evidence revision; transport placeholder is not a quality finding.')
    return checked(result)
  }
  result.result_status = 'COMPLETE'
  if (conflictEstablished) {
    result.assessment_result = 'CONTRADICTORY'
    result.assessment_reasons.push('Established material incompatible conflict at the same condition, scope and time; retain both lineages.')
  } else if (VE02_DIMENSIONS.some((key) => result[key] === 'INSUFFICIENT')) {
    result.assessment_result = 'INSUFFICIENT'
    result.assessment_reasons.push('Insufficient required dimension: ' + VE02_DIMENSIONS.filter((key) => result[key] === 'INSUFFICIENT').join(', '))
  } else {
    const lowest = VE02_DIMENSIONS.map((key) => result[key]).reduce((a, b) => rank[a] < rank[b] ? a : b)
    result.assessment_result = result.evidence_direction === 'MIXED' && lowest === 'STRONG' ? 'MODERATE' : lowest
  }
  return checked(result)
}
