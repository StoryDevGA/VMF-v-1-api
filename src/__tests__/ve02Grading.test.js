import fs from 'node:fs'
import { gradeVE02PreclassifiedEvidence, VE02_DIMENSIONS, VE02_UNRESOLVED_RESTRICTIONS } from '../services/runtimeValidation/ve02Grading.js'
import { VE02_SOURCE_BINDING } from '../services/runtimeValidation/ve02ContractBindingRegistry.js'
import { validateVE02EvidenceAssessmentResult } from '../services/runtimeValidation/ve02EvidenceAssessmentResultContract.js'

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/ve02GradingAcceptance.json', import.meta.url)))
const candidate = (row) => ({ contract_id: 'VMF.VE02.EvidenceAssessmentResult', schema_version: '1.0',
  result_id: `fixture:${row.id}`, result_status: 'COMPLETE', evidence_id: row.evidence_id,
  evidence_revision_ref: row.revision, runtime_owner: 'VE02', runtime_version_ref: VE02_SOURCE_BINDING.governingRuntimeVersion,
  assessed_at: '2026-10-08T16:30:00Z', ...Object.fromEntries(VE02_DIMENSIONS.map((key) => [key, row[key]])),
  assessment_result: 'INSUFFICIENT', evidence_direction: row.direction, assessment_reasons: row.reasons,
  restrictions: ['SYNTHETIC_QMF_ONLY'], contradiction_refs: row.contradiction_refs || [], provenance_refs: row.provenance_refs,
})
const assess = (row) => gradeVE02PreclassifiedEvidence({ candidate: candidate(row), currentRevision: row.current_revision,
  conflictEstablished: row.incompatible_conflict, recomputeRequired: row.recompute_required })

test.each(cases.map((row) => [row.id, row]))('actual StorylineOS grading passes owner case %s', (_, row) => {
  const result = assess(row)
  expect(result.result_status).toBe(row.expected_result_status)
  if (row.expected_result_status === 'INVALID') {
    expect(result.diagnostic).toBeTruthy()
    expect(result.contract_id).toBeUndefined()
  } else {
    expect(result.assessment_result).toBe(row.expected_assessment_result)
    expect(result.evidence_direction).toBe(row.expected_evidence_direction)
    if (result.result_status === 'UNRESOLVED') {
      expect(result.restrictions).toEqual(expect.arrayContaining(VE02_UNRESOLVED_RESTRICTIONS))
      expect(validateVE02EvidenceAssessmentResult({ payload: result })).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'payload.result_status' }),
      ]))
    }
  }
})
test('mixed caps strong, never upgrades weak or implies incompatible conflict', () => {
  expect(assess({ ...cases[0], direction: 'MIXED' }).assessment_result).toBe('MODERATE')
  expect(assess({ ...cases[2], direction: 'MIXED' }).assessment_result).toBe('WEAK')
})
test('unresolved precedes conflict, conflict precedes insufficiency', () => {
  expect(assess({ ...cases[5], independence: 'UNRESOLVED' }).result_status).toBe('UNRESOLVED')
  expect(assess({ ...cases[5], independence: 'INSUFFICIENT' }).assessment_result).toBe('CONTRADICTORY')
})
test.each(['contract_id', 'schema_version', 'evidence_id', 'runtime_owner', 'assessment_reasons', 'provenance_refs'])('invalid %s emits diagnostic only', (key) => {
  const input = candidate(cases[0]); delete input[key]
  expect(gradeVE02PreclassifiedEvidence({ candidate: input, currentRevision: cases[0].current_revision }).result_status).toBe('INVALID')
})
test('forbidden numeric and cross-owner fields fail, source input remains unchanged', () => {
  const input = candidate(cases[0]); const before = structuredClone(input)
  gradeVE02PreclassifiedEvidence({ candidate: input, currentRevision: cases[0].current_revision })
  expect(input).toEqual(before)
  for (const field of ['evidence_score', 'authorization', 'hypothesis_status']) {
    expect(gradeVE02PreclassifiedEvidence({ candidate: { ...input, [field]: 5 }, currentRevision: cases[0].current_revision }).result_status).toBe('INVALID')
  }
})
test('appended mandatory entries cannot emit an oversized contract', () => {
  const input = candidate(cases[7]); input.restrictions = Array.from({ length: 100 }, (_, i) => `Existing restriction ${i}`)
  expect(gradeVE02PreclassifiedEvidence({ candidate: input, currentRevision: cases[7].current_revision }).result_status).toBe('INVALID')
  const oversizedReasons = candidate(cases[6]); oversizedReasons.assessment_reasons = Array(100).fill('Existing reason')
  expect(gradeVE02PreclassifiedEvidence({ candidate: oversizedReasons, currentRevision: cases[6].current_revision }).result_status).toBe('INVALID')
})
