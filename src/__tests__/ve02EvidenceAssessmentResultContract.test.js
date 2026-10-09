import { validateRuntimeOutputContract } from '../services/runtimeValidation/runtimeOutputValidator.js'
import { VE02_RESULT_CONTRACT_ID } from '../services/runtimeValidation/ve02EvidenceAssessmentResultContract.js'

const result = () => ({
  contract_id: VE02_RESULT_CONTRACT_ID, schema_version: '1.0',
  result_id: 'assessment-revision-1', result_status: 'COMPLETE',
  evidence_id: 'evidence-1', evidence_revision_ref: 'sha256:fixture-source-1',
  runtime_owner: 'VE02', runtime_version_ref: 'fixture-bundle-02-version',
  assessed_at: '2026-10-07T16:00:00Z', source_reliability: 'MODERATE',
  relevance: 'STRONG', specificity: 'MODERATE', independence: 'MODERATE',
  assessment_result: 'MODERATE', evidence_direction: 'SUPPORTS',
  assessment_reasons: ['Evidence supports the assessed condition.'],
  restrictions: ['Does not promote truth.'], contradiction_refs: [],
  provenance_refs: ['fixture-source-record'],
})
const context = () => ({
  runtimeId: 'fixture-runtime', customerId: 'fixture-customer', tenantId: 'fixture-tenant',
  evidence: { evidenceObjectId: 'evidence-1', sourceId: 'source-1', currentnessState: 'CURRENT' },
  source: { sourceId: 'source-1', currentnessState: 'CURRENT' },
  evidenceRevisionRef: 'sha256:fixture-source-1', governingRuntimeVersion: 'fixture-bundle-02-version',
  activation: { versionId: 'fixture-version', contentHash: 'fixture-hash', activationId: 'fixture-activation' },
  provenanceRefs: ['fixture-source-record'], requiredProvenanceRefs: ['fixture-source-record'], resultRecords: [],
})
const consume = (payload, ve02Context = context(), outputContract = { $id: VE02_RESULT_CONTRACT_ID }) =>
  validateRuntimeOutputContract({ outputContract, payload }, { ve02Context })

describe('VE02 typed-result consumption (controlled internal context)', () => {
  test.each(['NON_COMPLETE_DO_NOT_CONSUME', 'TRANSPORT_PLACEHOLDER_NOT_AN_INSUFFICIENCY_FINDING',
    'SYNTHETIC_QMF_ONLY'])('blocks otherwise COMPLETE result carrying %s', restriction => {
    expect(consume({ ...result(), restrictions: [restriction] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'payload.restrictions', severity: 'BLOCKING' }),
    ]))
  })
  test('validates a bounded complete result without mutating evidence or restrictions', () => {
    const payload = result()
    const binding = context()
    const before = JSON.stringify({ payload, binding })
    expect(consume(payload, binding)).toEqual([])
    expect(JSON.stringify({ payload, binding })).toBe(before)
  })
  test('ignores a permissive caller-authored schema using the canonical ID', () => {
    expect(consume({}, context(), { $id: VE02_RESULT_CONTRACT_ID, type: 'object' }).length).toBeGreaterThan(0)
  })
  test.each([
    ['contract_id', 'other'], ['schema_version', '2.0'], ['runtime_owner', 'VE'],
    ['result_status', 'UNRESOLVED'], ['relevance', 'UNRESOLVED'],
    ['evidence_direction', 'UNRESOLVED'], ['assessment_result', 'strong'],
    ['assessed_at', 'tomorrow'], ['evidence_revision_ref', 'different'],
    ['assessed_at', '2026-02-30T16:00:00Z'], ['assessed_at', '2026-13-01T16:00:00Z'],
    ['runtime_version_ref', 'wrong-runtime'], ['provenance_refs', ['unknown']],
  ])('blocks invalid or unresolved %s', (key, value) => {
    expect(consume({ ...result(), [key]: value }).length).toBeGreaterThan(0)
  })
  test('request-body context does not substitute for the internal dependency', () => {
    expect(validateRuntimeOutputContract({ payload: result(), verifiedContext: context(), outputContract: {} }).length).toBeGreaterThan(0)
  })
  test.each(['evidence', 'source'])('requires explicit currentness on %s', (key) => {
    const binding = context()
    binding[key].currentnessState = 'SUPERSEDED'
    expect(consume(result(), binding).length).toBeGreaterThan(0)
  })
  test('requires recorded activation and uniqueness context', () => {
    expect(consume(result(), { ...context(), activation: null, resultRecords: undefined }).length).toBeGreaterThan(0)
  })
  test('requires lineage-covering references rather than an arbitrary allowed subset', () => {
    expect(consume(result(), { ...context(), requiredProvenanceRefs: ['missing-link'] }).length).toBeGreaterThan(0)
    expect(consume(result(), { ...context(), requiredProvenanceRefs: [] }).length).toBeGreaterThan(0)
  })
  test('accepts exact replay independent of property ordering and rejects ID reuse', () => {
    const payload = result()
    const reordered = Object.fromEntries(Object.entries(payload).reverse())
    expect(consume(payload, { ...context(), resultRecords: [reordered] })).toEqual([])
    expect(consume(payload, { ...context(), resultRecords: [{ ...payload, evidence_id: 'other' }] }).length).toBeGreaterThan(0)
  })
  test('contradiction reason alternative requires governed relationship context', () => {
    const payload = { ...result(), assessment_result: 'CONTRADICTORY' }
    expect(consume(payload).length).toBeGreaterThan(0)
    expect(consume(payload, { ...context(), conflictReasons: payload.assessment_reasons })).toEqual([])
  })
  test('insufficiency cannot be established by a reason string alone', () => {
    expect(consume({ ...result(), assessment_result: 'INSUFFICIENT' }).length).toBeGreaterThan(0)
  })
  test('rejects ungoverned numeric scoring and state writes', () => {
    expect(consume({ ...result(), evidence_score: 90 }).length).toBeGreaterThan(0)
    expect(consume({ ...result(), hypothesis_state: 'VALIDATED' }).length).toBeGreaterThan(0)
  })
  test('leaves unrelated generic contracts unchanged', () => {
    expect(validateRuntimeOutputContract({ outputContract: { type: 'object' }, payload: {} })).toEqual([])
  })
})
