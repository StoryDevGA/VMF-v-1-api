import Stage from '../models/OutcomeQualityStageExecution.js'
import { renditionQualityStageFixture } from './fixtures/renditionQualityStageFixture.js'
import { assertRenditionQualityStage, assertRenditionQualityStageInput, buildRenditionQualityStage, serializeRenditionQualityStage } from '../services/outcomeRenditionQualityStageContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { makeGovernedFinalisationFixture } from './fixtures/outcomeGovernedFinalisationFixtures.js'

describe('distinct rendition-stage shape admission; simulated provenance only', () => {
  test.each([false, true])('retains full seven-dimension findings for completed failed=%s', async failed => {
    const f = await renditionQualityStageFixture(failed), document = new Stage(f.row)
    await document.validate()
    const serialized = serializeRenditionQualityStage(document)
    expect(serialized.outputSnapshot.findings).toHaveLength(7)
    expect(serialized.outputSnapshot.overallStatus).toBe(failed ? 'FAIL' : 'PASS')
    expect(serialized.status).toBe(failed ? 'FAILED' : 'SUCCEEDED')
    expect(serialized.stageOrder).toBe(0)
    expect(serialized).not.toHaveProperty('inputSnapshot')
    expect(serialized.renditionInputSnapshot.subject.authorisesApproval).toBe(false)
    if (failed) expect(serialized.failure.retryable).toBe(false)
    else expect(serialized).not.toHaveProperty('failure')
  })
  test.each([
    ['legacy version', row => { row.contractVersion = 'outcome-governed-quality.v1' }],
    ['old key', row => { row.stageKey = 'RENDERED_EXPRESSION_RL' }],
    ['seventh stage', row => { row.stageOrder = 7 }], ['retry', row => { row.attemptNumber = 2 }],
    ['predecessor', row => { row.predecessorStageExecutionId = 'invented-predecessor' }],
    ['ordinary input', row => { row.inputSnapshot = {} }], ['foreign scope', row => { row.customerId = '507f1f77bcf86cd799439099' }],
    ['foreign actor', row => { row.createdBy = '507f1f77bcf86cd799439099' }],
    ['plan version', row => { row.planVersion++ }], ['runtime key', row => { row.runtimeInstanceKey = 'wrong-runtime' }],
    ['count', row => { row.assignedActivationCount++ }], ['duration', row => { row.durationMs++ }],
    ['fingerprint', row => { row.attemptFingerprint = 'f'.repeat(64) }],
    ['provider', row => { row.executionIdentity.model = 'other-model' }],
    ['approval', row => { row.renditionInputSnapshot.subject.authorisesApproval = true }],
    ['output loss', row => { delete row.outputSnapshot }], ['output status', row => { row.status = 'FAILED' }],
  ])('rejects inconsistent %s in the pure contract and model', async (_name, mutate) => {
    const f = await renditionQualityStageFixture(); mutate(f.row)
    expect(() => assertRenditionQualityStage(f.row)).toThrow()
    await expect(new Stage(f.row).validate()).rejects.toThrow()
  })
  test.each([
    ['uncertainty', input => { input.receipt.terminalStatus = 'unknown' }],
    ['wrong response shape', input => { input.receipt.responseId = 'unconfirmed' }],
    ['wrong page', input => { input.receipt.pages = input.receipt.pages.map(page => ({ ...page, sha256: 'f'.repeat(64) })) }],
    ['wrong file', input => { input.receipt.docxChecksum = `sha256:${'f'.repeat(64)}` }],
    ['wrong request', input => { input.receipt.requestIdentity = 'f'.repeat(64) }],
    ['extra receipt key', input => { input.receipt.approvalAvailable = true }],
    ['extra input key', input => { input.finalAsset = 'invented' }],
    ['unsafe accounting', input => { input.receipt.tokenUsage.inputTokens = -1 }],
  ])('rejects resealed %s before admission', async (_name, mutate) => {
    const f = await renditionQualityStageFixture(); mutate(f.input)
    expect(() => buildRenditionQualityStage(f.stageArgs)).toThrow()
    f.row.renditionInputSnapshot = f.input; f.row.inputFingerprint = membershipHash(f.input)
    await expect(new Stage(f.row).validate()).rejects.toThrow()
  })
  test('does not admit foreign plan bindings or leak a rendition input onto legacy stages', async () => {
    const f = await renditionQualityStageFixture()
    expect(() => buildRenditionQualityStage({ ...f.stageArgs, plan: { ...f.stageArgs.plan, planId: 'foreign' } })).toThrow()
    const legacy = makeGovernedFinalisationFixture()
    for (const row of legacy.stages) {
      await new Stage({ ...row, createdBy: legacy.plan.createdBy }).validate()
      await expect(new Stage({ ...row, createdBy: legacy.plan.createdBy, renditionInputSnapshot: f.input }).validate()).rejects.toThrow()
    }
  })
  test.each([
    ['claim', input => { input.claim.executionId = [input.claim.executionId] }],
    ['reservation', input => { input.reservation.executionId = [input.reservation.executionId] }],
    ['result', input => { input.result.executionId = [input.result.executionId] }],
    ['artifact', input => { input.result.runtimeArtifactId = [input.result.runtimeArtifactId] }],
    ['response', input => { input.receipt.responseId = [input.receipt.responseId] }],
    ['candidate', input => { input.subject.candidate.candidateId = [input.subject.candidate.candidateId] }],
    ['preview', input => { input.subject.preview.previewId = [input.subject.preview.previewId] }],
  ])('rejects an array-valued %s identity without string coercion', async (_name, mutate) => {
    const f = await renditionQualityStageFixture(); mutate(f.input)
    expect(() => assertRenditionQualityStageInput(f.input)).toThrow()
    expect(() => buildRenditionQualityStage(f.stageArgs)).toThrow()
  })
  test.each([null, 1793212800000, '2026-10-28 18:40:00.000Z', new Date(NaN)])('rejects a noncanonical time %p', async startedAt => {
    const f = await renditionQualityStageFixture()
    expect(() => buildRenditionQualityStage({ ...f.stageArgs, startedAt })).toThrow()
  })
  test('accepts valid Date values and rejects an array stage ID', async () => {
    const f = await renditionQualityStageFixture()
    await new Stage(buildRenditionQualityStage({ ...f.stageArgs,
      startedAt: new Date(f.stageArgs.startedAt), completedAt: new Date(f.stageArgs.completedAt) })).validate()
    expect(() => assertRenditionQualityStage({ ...f.row, stageExecutionId: [f.row.stageExecutionId] })).toThrow()
  })
})
