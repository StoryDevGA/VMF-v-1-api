import mongoose from 'mongoose'
import { jest } from '@jest/globals'
import Ajv from 'ajv'
import { ve02AssessmentDraftBodySchema } from '../validators/runtimeValidation.validator.js'
import { prepareVE02AssessmentDraft } from '../services/runtimeValidation/ve02AssessmentDraft.js'
import { VE02_RESULT_SCHEMA, validateVE02EvidenceAssessmentResult } from '../services/runtimeValidation/ve02EvidenceAssessmentResultContract.js'

const revision = `sha256:${'a'.repeat(64)}`
const input = () => ({
  frameworkKey: 'QMF', packageId: 'package', runtimeInstanceId: 'runtime', customerId: 'customer', tenantId: 'tenant',
  evidenceId: 'evidence', expectedEvidenceRevisionRef: revision,
  proposedHypothesis: { statement: 'The customer outcome improved.', reference: 'proposed-hypothesis-1' },
  judgments: { source_reliability: 'MODERATE', relevance: 'STRONG', specificity: 'MODERATE', independence: 'WEAK',
    assessment_result: 'WEAK', evidence_direction: 'SUPPORTS', assessment_reasons: ['Proposed evidence-linked observation.'],
    restrictions: ['No truth promotion.'], contradiction_refs: [] },
})
const context = () => ({ runtimeId: 'runtime', customerId: 'customer', tenantId: 'tenant', stateVersion: 'state-v2',
  evidence: { evidenceObjectId: 'evidence', sourceId: 'source', currentnessState: 'CURRENT' },
  source: { sourceId: 'source', currentnessState: 'CURRENT' }, evidenceRevisionRef: revision,
  governingRuntimeVersion: 'fixture-source-version', requiredProvenanceRefs: ['source-record', 'evidence-lineage'],
  provenanceRefs: ['source-record', 'evidence-lineage'], resultRecords: [],
  activation: { activationId: 'activation', versionId: 'version', contentHash: 'fixture-content-hash' },
})
const session = { inTransaction: () => true }
afterEach(() => jest.restoreAllMocks())

test('assembles source-bound categorical proposals without upgrading judgments or hypothesis authority', async () => {
  const proposal = input()
  const before = structuredClone(proposal)
  const basis = context()
  const result = await prepareVE02AssessmentDraft({ input: proposal, session, dependencies: { resolveContext: async () => basis } })
  expect(result).toMatchObject({ status: 'PROPOSED', executionEligible: false,
    assessmentProcedureVerified: false, hypothesisVerified: false,
    proposedHypothesis: { statement: proposal.proposedHypothesis.statement, status: 'PROPOSED' },
    proposedJudgments: proposal.judgments,
    contractCandidate: { result_status: 'UNRESOLVED', assessment_result: 'INSUFFICIENT', evidence_direction: 'UNRESOLVED', evidence_revision_ref: revision,
      provenance_refs: basis.requiredProvenanceRefs } })
  expect(proposal).toEqual(before)
  expect(result.contractCandidate.assessment_reasons).toEqual(expect.arrayContaining([expect.stringContaining('Unresolved:')]))
  expect(new Ajv({ strict: false }).compile(VE02_RESULT_SCHEMA)(result.contractCandidate)).toBe(true)
  expect(validateVE02EvidenceAssessmentResult({ payload: result.contractCandidate, context: basis }))
    .toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('COMPLETE') })]))
})

test.each(['STRONG', 'MODERATE', 'WEAK', 'CONTRADICTORY', 'INSUFFICIENT'])('preserves proposed %s without certifying it', async (grade) => {
  const proposal = input()
  proposal.judgments.assessment_result = grade
  const result = await prepareVE02AssessmentDraft({ input: proposal, session, dependencies: { resolveContext: async () => context() } })
  expect(result.proposedJudgments.assessment_result).toBe(grade)
  expect(result.contractCandidate.assessment_result).toBe('INSUFFICIENT')
  expect(result.contractCandidate.result_status).toBe('UNRESOLVED')
  expect(result.executionEligible).toBe(false)
})

test.each(['result_status', 'assessmentProcedureVerified', 'executionEligible', 'provenance_refs', 'actorId', 'persistAudit', 'mode'])(
  'rejects caller authority field %s at the strict request boundary', (field) => {
    expect(ve02AssessmentDraftBodySchema.safeParse({ ...input(), [field]: 'COMPLETE' }).success).toBe(false)
    const proposal = input()
    proposal.judgments[field] = true
    expect(ve02AssessmentDraftBodySchema.safeParse(proposal).success).toBe(false)
  })

test.each(['source_reliability', 'relevance', 'specificity', 'independence', 'assessment_result', 'evidence_direction'])(
  'rejects numeric/invented category for %s', (field) => {
    for (const value of [5, 'HIGH', 'strong']) {
      const proposal = input()
      proposal.judgments[field] = value
      expect(ve02AssessmentDraftBodySchema.safeParse(proposal).success).toBe(false)
    }
  })

test('rejects empty reasons, unknown hypothesis authority and aggregate oversized requests', () => {
  const proposal = input()
  proposal.judgments.assessment_reasons = []
  expect(ve02AssessmentDraftBodySchema.safeParse(proposal).success).toBe(false)
  const forged = input()
  forged.proposedHypothesis.verified = true
  expect(ve02AssessmentDraftBodySchema.safeParse(forged).success).toBe(false)
  const oversized = input()
  oversized.judgments.restrictions = Array(30).fill('x'.repeat(2000))
  expect(ve02AssessmentDraftBodySchema.safeParse(oversized).success).toBe(false)
  const boundary = input(); boundary.judgments.restrictions = Array(100).fill('Restriction')
  expect(ve02AssessmentDraftBodySchema.safeParse(boundary).success).toBe(false)
})

test('rejects absent basis, changed revisions and a nontransactional snapshot', async () => {
  await expect(prepareVE02AssessmentDraft({ input: input(), session,
    dependencies: { resolveContext: async () => undefined } })).rejects.toMatchObject({ code: 'VE02_DRAFT_BASIS_UNAVAILABLE' })
  await expect(prepareVE02AssessmentDraft({ input: input(), session,
    dependencies: { resolveContext: async () => ({ ...context(), evidenceRevisionRef: 'changed' }) } }))
    .rejects.toMatchObject({ status: 409, code: 'VE02_DRAFT_BASIS_CHANGED' })
  await expect(prepareVE02AssessmentDraft({ input: input(), session: { inTransaction: () => false } }))
    .rejects.toMatchObject({ code: 'VE02_DRAFT_SNAPSHOT_REQUIRED' })
})

test.each([false, true])('closes owned read session on resolver failure=%s', async (shouldFail) => {
  const ownedSession = { ...session, endSession: jest.fn(), withTransaction: jest.fn((run) => run()) }
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(ownedSession)
  const operation = prepareVE02AssessmentDraft({ input: input(), dependencies: {
    resolveContext: async () => { if (shouldFail) throw new Error('source unavailable'); return context() },
  } })
  if (shouldFail) await expect(operation).rejects.toThrow('source unavailable')
  else expect((await operation).executionEligible).toBe(false)
  expect(ownedSession.endSession).toHaveBeenCalledTimes(1)
  expect(ownedSession.withTransaction.mock.calls[0][1]).toEqual({ readConcern: { level: 'snapshot' } })
})
