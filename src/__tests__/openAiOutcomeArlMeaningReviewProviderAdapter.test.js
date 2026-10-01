import { makeSs040Fixture } from './fixtures/ss040EvidenceToMeaningFixtures.js'
import { compileEvidenceToMeaningContract, hashEvidenceToMeaningValue } from '../services/outcomeEvidenceToMeaningContractService.js'
import { projectEvidenceToMeaningProviderContract } from '../services/outcomeEvidenceToMeaningProviderService.js'
import { createHash } from 'node:crypto'

import { expect, jest, test } from '@jest/globals'

import {
  OUTCOME_ARL_MEANING_REVIEW_PROVIDER_CONFIG_VERSION,
  OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY } from '../constants/outcomeStudioReadiness.js'
import { createOpenAiOutcomeArlMeaningReviewProviderAdapter } from '../services/openAiOutcomeArlMeaningReviewProviderAdapter.js'
import { buildOutcomeArlMeaningReviewProviderSafeContext } from '../services/outcomeArlMeaningReviewProviderSafeContextService.js'
import { buildOutcomeMethodDocument } from '../services/outcomeMethodDocumentService.js'
import { buildOutcomeStudioProviderSafeRequest } from '../services/outcomeStudioProviderSafeContextService.js'
import { hashOutcomeQualityStageValue } from '../services/outcomeQualityStageExecutionService.js'

const descriptor = {
  providerKey: 'openai',
  model: 'gpt-5.2',
  providerMode: 'LIVE_TEST',
  environment: 'TEST',
  safeContextPolicyKey: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
  failurePosture: 'FAIL_CLOSED',
}

const methodDocument = () => {
  const content = '# ARL\n\nPreserve meaning, evidence boundaries and qualification visibility.'
  const selection = {
    packId: 'arl-pack',
    packKey: 'library-arl',
    versionId: 'arl-version-1',
    semanticVersion: '1.0.0',
    contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    contentFormat: 'MARKDOWN',
    status: 'ACTIVE',
    packType: 'ARL',
    activationId: 'arl-activation',
    capabilityKey: 'meaning-review',
    executionMode: 'PROVIDER_CONTEXT',
    boundary: 'GENERATION_CONTEXT',
  }
  return buildOutcomeMethodDocument({
    role: 'ARL',
    selection,
    loaded: { ...selection, available: true, content },
  })
}

const workingDraftSource = () => {
  const outputSnapshot = {
    outputType: 'WORKING_DRAFT',
    schemaVersion: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
    title: 'Bounded Parlon Working Draft',
    sections: [{
      order: 1,
      sectionKey: 'customer-context',
      title: 'Customer context',
      content: 'The supplied summary presents a qualified outcome claim.',
      claims: [{
        claimKey: 'qualified-outcome',
        statement: 'The outcome is source-presented and not independently validated.',
        truthReferences: ['customer-context'],
        evidence: ['The supplied summary presents the outcome as a company claim.'],
        meaningClass: 'QUALIFIED',
        proofDependencies: ['METRIC_DEFINITION'],
        validationStatus: 'NOT_STATED',
        proofDisposition: 'AUTHOR_PROPOSED',
        whatCanBeSaidNow: 'The supplied summary presents the outcome as a company claim.',
        blockedStrongerClaim: 'An achieved outcome is not established in the supplied summaries.',
        evidenceRequiredToSubstantiate: ['Evidence identifying the measure, scope, baseline and method.'],
      }],
      truthReferences: ['customer-context'],
      assumptions: [],
      gaps: ['The measurement meaning is not established in the supplied summaries.'],
    }],
    decisionLogic: [{
      decisionKey: 'framework-proof-work',
      rationale: 'Interpretive placeholder: Expressed Reality: the claim is source-presented. Recognition gap: recognition is not established in the supplied summaries. Understanding gap: measurement meaning is not established in the supplied summaries. Bounded interpretation now: retain the claim only as qualified positioning. Qualified Reality: the outcome is not independently validated. Hypothetical next proof step: apply the Framework metric-definition check.',
      priority: 'PROVISIONAL_SEQUENCE_1',
      priorityBasis: 'FRAMEWORK_GUIDANCE',
      closureState: 'INCOMPLETE',
      actionAuthorization: 'NONE',
      truthReferences: ['customer-context'],
    }],
    assumptions: [],
    visibleGaps: ['The measurement meaning is not established in the supplied summaries.'],
  }
  return {
    stageExecutionId: 'outcome_quality_stage_working_draft_qa',
    stageKey: OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
    stageOrder: 2,
    status: OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED,
    outputFingerprint: hashOutcomeQualityStageValue(outputSnapshot),
    outputSnapshot,
  }
}

const context = () => {
  const document = methodDocument()
  const providerInput = {
    customerPrompt: 'Prepare a bounded Commercial Strategy and Decision Paper for Parlon.',
    currentDraftMarkdown: '',
    request: {
      intentType: 'ARL_MEANING_REVIEW',
      refinement: false,
      outputTypeKey: 'ARL_MEANING_REVIEW',
      outputTypeLabel: 'ARL Meaning Review',
      outputSchemaKey: 'fs-003-arl-meaning-review-v0-2',
      requiredSections: ['findings'],
      styleKey: 'meaning-review',
      styleLabel: 'Meaning review',
      requestedOutputTypeKey: 'commercial-strategy-and-decision-paper',
      requestedStyleKey: 'commercial-strategy',
      workspaceType: 'PLATFORM',
    },
  }
  return buildOutcomeArlMeaningReviewProviderSafeContext({
    knowledgeSelection: [{
      versionId: document.source.versionId,
      packType: 'ARL',
      knowledgeLayer: 'INTERPRETATION',
      executionMode: 'PROVIDER_CONTEXT',
    }],
    methodDocument: document,
    methodSelection: {
      ...document.source,
      packType: 'ARL',
      knowledgeLayer: 'INTERPRETATION',
      executionMode: 'PROVIDER_CONTEXT',
      boundary: 'GENERATION_CONTEXT',
    },
    providerDescriptor: descriptor,
    safeRequest: buildOutcomeStudioProviderSafeRequest({ providerDescriptor: descriptor, providerInput }),
    sourceStageExecution: workingDraftSource(),
    targetStageKey: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
    truthSource: {
      acceptedTruth: [{
        label: 'customer-context',
        content: 'The supplied summary presents the outcome as a company claim requiring further validation.',
      }],
    },
  })
}

const review = {
  outputType: 'ARL_MEANING_REVIEW',
  schemaVersion: OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
  overallStatus: 'PASS',
  findings: ['ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS']
    .map((dimension) => ({
      dimension,
      status: 'PASS',
      finding: `${dimension} preserves the bounded meaning contract.`,
      requiredChange: false,
    })),
}

test('defines Framework-derived proof sequencing without granting automatic ARL approval', async () => {
  const fetchImpl = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: jest.fn(() => 'req_arl_contract') },
    json: jest.fn(async () => ({
      id: 'resp_arl_contract',
      status: 'completed',
      created_at: 1784707200,
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(review) }] }],
      usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
    })),
  }))
  const adapter = createOpenAiOutcomeArlMeaningReviewProviderAdapter({
    apiKey: 'test-key-not-real',
    completionTimeoutMs: 300000,
    fetchImpl,
    maxOutputTokens: 4000,
    maxRetries: 0,
    model: 'gpt-5.2',
    now: () => 1000,
    pollIntervalMs: 1000,
    providerKey: 'openai',
    sleep: jest.fn(async () => {}),
    timeoutMs: 60000,
  })

  await expect(adapter({ providerContext: context() })).resolves.toMatchObject({
    metadata: { configurationVersion: OUTCOME_ARL_MEANING_REVIEW_PROVIDER_CONFIG_VERSION },
  })
  const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
  expect(body.instructions).toContain('FRAMEWORK_GUIDANCE and PROVISIONAL_SEQUENCE_n identify non-authorising proof-work order')
  expect(body.instructions).toContain('must not fail PRIORITISATION solely because')
  expect(body.instructions).toContain('proofDependencies are unresolved qualification metadata')
  expect(body.instructions).toContain('do not treat them as evidence-backed customer facts or governance requirements')
  expect(body.instructions).toContain('meaningClass SOURCE_PRESENTED is an explicit reality boundary')
  expect(body.instructions).toContain('active verb from the attributed source does not convert it into observed operational practice')
  expect(body.instructions).toContain('structured meaningClass and proofDependencies fields govern their classification')
  expect(body.instructions).toContain('A bounded conclusion may still be decision-useful')
  expect(body.instructions).toContain('Do not automatically pass')
  expect(JSON.parse(body.input).candidate.decisionLogic[0]).toMatchObject({
    priority: 'PROVISIONAL_SEQUENCE_1',
    priorityBasis: 'FRAMEWORK_GUIDANCE',
    closureState: 'INCOMPLETE',
    actionAuthorization: 'NONE',
  })
  expect(JSON.parse(body.input).candidate.sections[0].claims[0]).toMatchObject({
    validationStatus: 'NOT_STATED',
    proofDisposition: 'AUTHOR_PROPOSED',
    whatCanBeSaidNow: 'The supplied summary presents the outcome as a company claim.',
    blockedStrongerClaim: 'An achieved outcome is not established in the supplied summaries.',
    evidenceRequiredToSubstantiate: ['Evidence identifying the measure, scope, baseline and method.'],
  })
  expect(OUTCOME_ARL_MEANING_REVIEW_PROVIDER_CONFIG_VERSION)
    .toBe('OUTCOME_ARL_MEANING_REVIEW_OPENAI_RESPONSES_V4_STRUCTURED_REALITY_BOUNDARIES')
})

test.each(['framework', 'lineage', 'source metadata'])('SS-040 rejects private %s even in a rehashed projection before fetch', async (field) => {
  const projection = projectEvidenceToMeaningProviderContract(compileEvidenceToMeaningContract(makeSs040Fixture()))
  if (field === 'framework') projection.frameworkGuidance.content = { guidance: [{ instructions: 'person@example.test' }] }
  if (field === 'lineage') projection.customerClaims[0].lineageRef = 'api_key=synthetic-review-secret'
  if (field === 'source metadata') projection.customerClaims[0].attribution.storedSourceHash = 'api_key=synthetic-review-secret'
  const { projectionHash, ...payload } = projection
  projection.projectionHash = hashEvidenceToMeaningValue(payload)
  const fetchImpl = jest.fn(), providerContext = context()
  providerContext.evidenceToMeaning = projection
  await expect(createOpenAiOutcomeArlMeaningReviewProviderAdapter({ apiKey: 'test-secret-not-real', fetchImpl, model: 'gpt-5.2', maxOutputTokens: 4000, maxRetries: 0, providerKey: 'openai', timeoutMs: 60000, completionTimeoutMs: 300000, pollIntervalMs: 1000 })({ providerContext })).rejects.toThrow()
  expect(fetchImpl).not.toHaveBeenCalled()
})
