import Ajv from 'ajv'
import { generateChecksum } from '../governanceAudit/checksumService.js'
import { RUNTIME_VALIDATION_CODES, buildRuntimeValidationIssue } from './runtimeValidationCodes.js'
import { ve02ProducerBindingSchema, VE02_LOCAL_RESULT_RESTRICTION, VE02_LOCAL_ASSESSOR } from './ve02LocalAssessorRegistration.js'

export const VE02_RESULT_CONTRACT_ID = 'VMF.VE02.EvidenceAssessmentResult'
export const VE02_RESULT_SCHEMA_VERSION = '1.0'
export const VE02_CONSUMER_VERSION = 've02-result-consumer-v2'
const dimensions = ['source_reliability', 'relevance', 'specificity', 'independence']
const token = { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' }
const refs = { type: 'array', maxItems: 100, items: token }
const properties = {
  contract_id: { const: VE02_RESULT_CONTRACT_ID },
  schema_version: { const: VE02_RESULT_SCHEMA_VERSION },
  result_id: { ...token, maxLength: 240 }, evidence_id: token, evidence_revision_ref: token,
  runtime_owner: { const: 'VE02' }, runtime_version_ref: token,
  assessed_at: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$' },
  result_status: { enum: ['COMPLETE', 'UNRESOLVED', 'INVALID'] },
  assessment_result: { enum: ['STRONG', 'MODERATE', 'WEAK', 'CONTRADICTORY', 'INSUFFICIENT'] },
  evidence_direction: { enum: ['SUPPORTS', 'CONTRADICTS', 'MIXED', 'NEUTRAL', 'UNRESOLVED'] },
  assessment_reasons: { ...refs, minItems: 1 },
  restrictions: refs, contradiction_refs: refs, provenance_refs: refs,
  ...Object.fromEntries(dimensions.map((key) => [key, { enum: ['STRONG', 'MODERATE', 'WEAK', 'INSUFFICIENT', 'UNRESOLVED'] }])),
}

// Server-owned projection of the checksum-verified VE02RC001 derivative.
// Unknown fields cannot mutate state or introduce an ungoverned score scale.
export const VE02_RESULT_SCHEMA = {
  $id: VE02_RESULT_CONTRACT_ID, type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties,
}
const validateShape = new Ajv({ allErrors: true, strict: false }).compile(VE02_RESULT_SCHEMA)
export const isVE02CalendarTimestamp = (value) => {
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const offset = value.match(/[+-](\d{2}):(\d{2})$/)
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && hour <= 23 && minute <= 59 && second <= 59
    && (!offset || Number(offset[1]) <= 23 && Number(offset[2]) <= 59)
    && Number.isFinite(Date.parse(value))
}
export const isVE02ResultContract = ({ outputContract, payload }) =>
  outputContract?.$id === VE02_RESULT_CONTRACT_ID || payload?.contract_id === VE02_RESULT_CONTRACT_ID

const issue = (message, path = 'payload') => buildRuntimeValidationIssue({
  code: RUNTIME_VALIDATION_CODES.OUTPUT_CONTRACT_INVALID, severity: 'BLOCKING',
  message, path, source: VE02_CONSUMER_VERSION,
})

// This consumer grants no admission, truth, readiness or execution authority.
// The internal resolver must supply exact scoped records; request-body proofs
// are deliberately excluded from the runtime engine's dependency interface.
export const validateVE02EvidenceAssessmentResult = ({ payload, context }) => {
  if (Buffer.byteLength(JSON.stringify(payload ?? null)) > 64000) return [issue('VE02 result exceeds the bounded consumption payload limit.')]
  if (!validateShape(payload)) return validateShape.errors.map((error) =>
    issue(`VE02 result ${error.instancePath || '/'} ${error.message}.`))
  const issues = []
  if (!isVE02CalendarTimestamp(payload.assessed_at)) issues.push(issue('VE02 assessed_at must be an RFC 3339 timestamp.', 'payload.assessed_at'))
  if (payload.result_status !== 'COMPLETE') issues.push(issue('VE02 dependent execution requires a COMPLETE result.', 'payload.result_status'))
  if (payload.restrictions.some(restriction => ['NON_COMPLETE_DO_NOT_CONSUME',
    'TRANSPORT_PLACEHOLDER_NOT_AN_INSUFFICIENCY_FINDING', 'SYNTHETIC_QMF_ONLY'].includes(restriction))) {
    issues.push(issue('VE02 synthetic proposals and non-consumable transport placeholders cannot grant result eligibility.', 'payload.restrictions'))
  }
  if ([...dimensions, 'evidence_direction'].some((key) => payload[key] === 'UNRESOLVED')) issues.push(issue('VE02 COMPLETE results require resolved dimensions and direction.'))
  if (!context) return [...issues, issue('VE02 governed evidence, source, revision and activation context is unresolved.')]
  const controlledLocalScope = ['frameworkKey', 'packageKey', 'packageVersion'].every(key => context[key] === VE02_LOCAL_ASSESSOR[key])
  if (controlledLocalScope || payload.restrictions.includes(VE02_LOCAL_RESULT_RESTRICTION)) {
    const parsed = ve02ProducerBindingSchema.safeParse(context.producerBinding)
    const activation = context.localActivation
    if (!parsed.success || !activation || parsed.data.activationBindingHash !== activation.bindingHash
      || parsed.data.gradingContentHash !== activation.gradingContentHash
      || parsed.data.evidenceRevisionRef !== payload.evidence_revision_ref
      || parsed.data.classifierVersion !== activation.classifierVersion
      || payload.assessment_result === 'CONTRADICTORY' || payload.assessment_result === 'INSUFFICIENT') {
      issues.push(issue('VE02 provisional local producer binding is unresolved or requires review.'))
    }
  }
  const evidence = context.evidence
  const source = context.source
  if (!context.runtimeId || !context.customerId || !context.tenantId
    || evidence?.evidenceObjectId !== payload.evidence_id || !source?.sourceId
    || evidence?.sourceId !== source.sourceId
    || context.evidenceRevisionRef !== payload.evidence_revision_ref
    || !context.evidenceRevisionRef) issues.push(issue('VE02 exact scoped evidence/source revision binding does not resolve.'))
  if (evidence?.currentnessState !== 'CURRENT' || source?.currentnessState !== 'CURRENT') issues.push(issue('VE02 evidence/source is stale or currentness is unresolved; recomputation is required.'))
  if (!context.governingRuntimeVersion || payload.runtime_version_ref !== context.governingRuntimeVersion) issues.push(issue('VE02 governing runtime source/version differs.'))
  if (!context.activation?.versionId || !context.activation?.contentHash || !context.activation?.activationId) issues.push(issue('VE02 installed and active Knowledge Pack binding is unresolved.'))
  if (!payload.provenance_refs.length || !Array.isArray(context.provenanceRefs)
    || payload.provenance_refs.some((ref) => !context.provenanceRefs.includes(ref))
    || !context.requiredProvenanceRefs?.length
    || context.requiredProvenanceRefs.some((ref) => !payload.provenance_refs.includes(ref))) issues.push(issue('VE02 provenance references do not resolve to the governed evidence and source.'))
  if (context.existingResult && generateChecksum(context.existingResult) !== generateChecksum(payload)) issues.push(issue('VE02 result_id conflicts with its recorded assessment revision.'))
  if (!Array.isArray(context.resultRecords)) issues.push(issue('VE02 result-ID uniqueness records are unresolved.'))
  else if (context.resultRecords.some((record) => record.result_id === payload.result_id && generateChecksum(record) !== generateChecksum(payload))) issues.push(issue('VE02 result_id is already bound to a different assessment revision.'))
  if (payload.assessment_result === 'CONTRADICTORY') {
    const refsResolve = payload.contradiction_refs.length > 0 && payload.contradiction_refs.every((ref) => context.contradictionRefs?.includes(ref))
    const reasonResolves = context.conflictReasons?.some((reason) => payload.assessment_reasons.includes(reason))
    if (!refsResolve && !reasonResolves) issues.push(issue('VE02 conflicting evidence relationship and provenance are unresolved.'))
  }
  if (payload.assessment_result === 'INSUFFICIENT' && !context.insufficiencyReasons?.some((reason) => payload.assessment_reasons.includes(reason))) issues.push(issue('VE02 missing or unusable evidence condition is unresolved.'))
  return issues
}
