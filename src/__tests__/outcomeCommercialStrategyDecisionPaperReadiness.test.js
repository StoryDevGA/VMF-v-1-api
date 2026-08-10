import { jest } from '@jest/globals'
import {
  OUTCOME_KCP_STATUSES,
} from '../constants/outcomeGovernedQuality.js'
import {
  ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS,
  COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE,
  COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES,
  COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
  COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'
import { OUTCOME_STUDIO_REQUIRED_PACKS } from '../constants/runtimeOutcomeStudio.js'
import { OUTCOME_KNOWLEDGE_PACK_TYPES } from '../constants/outcomeKnowledgePacks.js'
import { buildCommercialStrategyDecisionPaperExercisePlan } from '../services/outcomeCommercialStrategyDecisionPaperExerciseService.js'
import { buildCommercialStrategyDecisionPaperAcceptanceResult } from '../services/outcomeCommercialStrategyDecisionPaperAcceptanceService.js'
import { buildCommercialStrategyDecisionPaperBenchmarkReadiness } from '../services/outcomeCommercialStrategyDecisionPaperBenchmarkReadinessService.js'
import { buildCommercialStrategyDecisionPaperCandidateReadiness } from '../services/outcomeCommercialStrategyDecisionPaperCandidateReadinessService.js'
import {
  assertCommercialStrategyDecisionPaperChainFixturePackage,
  buildCommercialStrategyDecisionPaperChainFixturePackage,
  hashCommercialStrategyDecisionPaperChainFixture,
} from '../services/outcomeCommercialStrategyDecisionPaperChainFixtureService.js'
import { buildCommercialStrategyDecisionPaperComparisonReadiness } from '../services/outcomeCommercialStrategyDecisionPaperComparisonReadinessService.js'
import {
  buildCommercialStrategyDecisionPaperEvidenceManifest,
  hashCommercialStrategyDecisionPaperEvidenceValue,
} from '../services/outcomeCommercialStrategyDecisionPaperEvidenceManifestService.js'
import { buildCommercialStrategyDecisionPaperHelpReadiness } from '../services/outcomeCommercialStrategyDecisionPaperHelpReadinessService.js'
import { buildCommercialStrategyDecisionPaperReadinessPackage } from '../services/outcomeCommercialStrategyDecisionPaperPackageService.js'
import {
  assertCommercialStrategyDecisionPaperPackageIntegrity,
  buildCommercialStrategyDecisionPaperPackageIntegrityReport,
} from '../services/outcomeCommercialStrategyDecisionPaperPackageIntegrityService.js'
import { buildCommercialStrategyDecisionPaperProgressSummary } from '../services/outcomeCommercialStrategyDecisionPaperProgressSummaryService.js'
import { buildCommercialStrategyDecisionPaperReadinessProjection } from '../services/outcomeCommercialStrategyDecisionPaperProjectionService.js'
import { buildCommercialStrategyDecisionPaperReadinessReport } from '../services/outcomeCommercialStrategyDecisionPaperReadinessService.js'
import { buildCommercialStrategyDecisionPaperRuntimeReadinessPackage } from '../services/outcomeCommercialStrategyDecisionPaperRuntimeReadinessService.js'
import { buildCommercialStrategyDecisionPaperRunGate } from '../services/outcomeCommercialStrategyDecisionPaperRunGateService.js'
import { buildCommercialStrategyDecisionPaperSourceAuthorityReport } from '../services/outcomeCommercialStrategyDecisionPaperSourceAuthorityReportService.js'
import { buildCommercialStrategyDecisionPaperSourceIntakePlan } from '../services/outcomeCommercialStrategyDecisionPaperSourceIntakeService.js'
import { buildCommercialStrategyDecisionPaperSprintEvidenceSnapshot } from '../services/outcomeCommercialStrategyDecisionPaperSprintEvidenceService.js'

const makePack = (packKey, overrides = {}) => ({
  activationId: `activation-${packKey}`,
  packId: `pack-${packKey}`,
  versionId: `version-${packKey}`,
  packKey,
  lifecycleStatus: 'ACTIVE',
  status: 'ACTIVE',
  selectionSources: ['SELECTED_BY_LAYER:FRAMEWORK'],
  ...overrides,
})

const allSelectedPacks = () => [
  ...ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS.map((pack) => makePack(pack.packKey)),
  ...OUTCOME_STUDIO_REQUIRED_PACKS.map((pack) => makePack(pack.packKey, { packType: pack.packType })),
]

const approvedBenchmarkReference = (overrides = {}) => ({
  benchmarkKey: 'parlon-commercial-strategy-decision-paper-v2-final',
  title: 'Parlon Commercial Strategy and Decision Paper v2.0 FINAL',
  sprintKey: 'SS-007',
  family: 'PROFESSIONAL_DOCUMENT',
  status: 'APPROVED',
  sha256: 'c'.repeat(64),
  provenanceUri: 'https://evidence.example.test/parlon-commercial-strategy-decision-paper-v2-final',
  ...overrides,
})

const helpMetadata = () => [
  { path: 'docs/help/outcome-studio/governed-reasoning-readiness.md' },
  { path: 'docs/help/outcome-studio/knowledge-composition-plan.md' },
  { path: 'docs/help/outcome-studio/commercial-strategy-decision-paper.md' },
]

const makeCandidate = (packs = allSelectedPacks(), overrides = {}) => ({
  status: OUTCOME_KCP_STATUSES.READY,
  planFingerprint: 'a'.repeat(64),
  resolutionFingerprint: 'b'.repeat(64),
  selectedPackCount: packs.length,
  consideredPackCount: packs.length,
  payload: {
    resolution: {
      selectedPacks: packs,
      consideredPacks: packs.map((pack) => ({ decision: 'SELECTED', pack })),
      missingDependencies: [],
      relationshipFailures: [],
      ambiguousCandidates: [],
      blockedPacks: [],
      warnings: [],
      ...overrides.resolution,
    },
    stagePlan: packs.map((pack, index) => ({
      order: index + 1,
      stageKey: index % 2 === 0 ? 'FRAMEWORK_GUIDANCE' : 'ARL_MEANING_REVIEW',
      assignedActivationIds: [pack.activationId],
    })),
  },
  ...overrides.candidate,
})

const forbiddenReusableIdentifierPattern = () => new RegExp([
  'outcome' + 'Par' + 'lon',
  'build' + 'Par' + 'lon',
  'PARLON' + '_GOLDEN',
  'One' + ' Par' + 'lon',
  'Par' + 'lon customer' + ' evidence',
  'approved' + ' Par' + 'lon',
].join('|'), 'i')

const rawContentPattern = () => new RegExp([
  'documentText',
  'benchmarkText',
  'candidateText',
  'contentBase64',
  'rawText',
  'markdown',
  'bytes',
  'customer-visible content',
  'benchmark content',
].join('|'), 'i')

const comparisonResultFor = (status = 'PASS', overrides = {}) => ({
  invoked: true,
  resultId: 'comparison-commercial-strategy-decision-paper-a',
  requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
  sha256: 'e'.repeat(64),
  provenanceUri: 'https://evidence.example.test/commercial-strategy-decision-paper-comparison-a',
  dimensionResults: COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE.acceptanceDimensions.map((dimensionKey) => ({
    dimensionKey,
    status,
    evidenceReference: `comparison-evidence-${dimensionKey}`,
  })),
  ...overrides,
})

const candidateReference = (overrides = {}) => ({
  assetId: 'candidate-commercial-strategy-decision-paper-a',
  requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
  status: 'GENERATED',
  sha256: 'd'.repeat(64),
  provenanceUri: 'https://evidence.example.test/commercial-strategy-decision-paper-candidate-a',
  ...overrides,
})

describe('Commercial strategy decision paper readiness projection', () => {
  it('reports ready when every Andrew-derived and generic Outcome Studio pack is selected and eligible', () => {
    const report = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })

    expect(report.status).toBe(COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES.READY)
    expect(report.stopBeforeGeneration).toBe(false)
    expect(report.requiredPacks).toHaveLength(ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS.length)
    expect(report.requiredPacks.every((pack) => pack.selected && pack.eligible)).toBe(true)
    expect(report.genericOutcomeStudioSafeguards.every((pack) => pack.selected)).toBe(true)
    expect(report.blocked).toEqual([])
  })

  it('keeps every Andrew-derived required pack type inside the persisted Knowledge Pack enum', () => {
    const persistedTypes = new Set(Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES))

    expect(ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS.map((pack) => pack.packType))
      .toEqual(expect.arrayContaining([...new Set(
        ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS.map((pack) => pack.packType),
      )]))
    expect(
      ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS.filter((pack) => !persistedTypes.has(pack.packType)),
    ).toEqual([])
  })

  it('does not treat retired packs as eligible because review metadata is approved', () => {
    const packs = allSelectedPacks().map((pack) =>
      pack.packKey === 'fx-runtime-pack'
        ? makePack(pack.packKey, { lifecycleStatus: 'RETIRED', status: 'RETIRED', reviewStatus: 'APPROVED' })
        : pack)
    const report = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate(packs) })

    expect(report.status).toBe(COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES.BLOCKED)
    expect(report.requiredPacks.find((pack) => pack.packKey === 'fx-runtime-pack')).toMatchObject({
      selected: true,
      eligible: false,
    })
    expect(report.blocked).toContainEqual({
      code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_NOT_ELIGIBLE,
      packKey: 'fx-runtime-pack',
    })
  })

  it('stops before generation and names the exact missing Andrew-derived pack', () => {
    const packs = allSelectedPacks().filter((pack) => pack.packKey !== 'gx-runtime-pack')
    const report = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate(packs) })

    expect(report.status).toBe(COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES.BLOCKED)
    expect(report.stopBeforeGeneration).toBe(true)
    expect(report.missing.map((pack) => pack.packKey)).toEqual(['gx-runtime-pack'])
    expect(report.blocked).toContainEqual({
      code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_MISSING,
      packKey: 'gx-runtime-pack',
    })
  })

  it('keeps generic Outcome Studio safeguard gaps separate from Andrew method gaps', () => {
    const packs = allSelectedPacks().filter((pack) => pack.packKey !== 'truth-certification-pack')
    const report = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate(packs) })

    expect(report.missing).toEqual([])
    expect(report.genericOutcomeStudioSafeguards.find((pack) => pack.packKey === 'truth-certification-pack').selected).toBe(false)
    expect(report.blocked).toContainEqual({
      code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.GENERIC_OUTCOME_STUDIO_PACK_MISSING,
      packKey: 'truth-certification-pack',
      packType: 'TRUTH_CERTIFICATION',
    })
  })

  it('does not treat missing mandatory safeguard placeholders from a binding as selected', () => {
    const report = buildCommercialStrategyDecisionPaperReadinessReport({
      binding: {
        mandatorySafeguards: [
          {
            packType: 'ARL',
            packKey: 'adaptive-reasoning-layer',
            status: 'MISSING',
            runtimeBindable: false,
          },
        ],
        selectedByLayer: {},
      },
    })

    expect(report.genericOutcomeStudioSafeguards.find(
      (pack) => pack.packKey === 'adaptive-reasoning-layer',
    )).toMatchObject({
      selected: false,
      blocker: {
        code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.GENERIC_OUTCOME_STUDIO_PACK_MISSING,
        packKey: 'adaptive-reasoning-layer',
        packType: 'ARL',
      },
    })
    expect(report.blocked).toContainEqual({
      code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.GENERIC_OUTCOME_STUDIO_PACK_MISSING,
      packKey: 'adaptive-reasoning-layer',
      packType: 'ARL',
    })
  })

  it('propagates ambiguous, blocked and relationship-failure resolver evidence', () => {
    const candidate = makeCandidate(allSelectedPacks(), {
      resolution: {
        ambiguousCandidates: [{ candidate: makePack('fx-runtime-pack') }],
        blockedPacks: [{ candidate: makePack('contradiction-register') }],
        relationshipFailures: [{ sourcePackKey: 'validation-evidence', reason: 'RELATIONSHIP_CHECKSUM_MISMATCH' }],
      },
    })
    const report = buildCommercialStrategyDecisionPaperReadinessReport({ candidate })

    expect(report.status).toBe(COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES.BLOCKED)
    expect(report.blocked).toEqual(expect.arrayContaining([
      { code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_AMBIGUOUS, packKey: 'fx-runtime-pack' },
      { code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_BLOCKED, packKey: 'contradiction-register' },
      { code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_RELATIONSHIP_FAILED, packKey: 'validation-evidence' },
    ]))
  })

  it('shows blocked KCP candidates without claiming blocked-plan persistence', () => {
    const report = buildCommercialStrategyDecisionPaperReadinessReport({
      candidate: makeCandidate(allSelectedPacks(), {
        candidate: {
          status: OUTCOME_KCP_STATUSES.BLOCKED,
        },
      }),
    })

    expect(report.status).toBe(COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES.BLOCKED)
    expect(report.knowledgeCompositionPlan.persistedWhenBlocked).toBe(false)
    expect(report.blocked).toContainEqual({
      code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.KCP_BLOCKED_SHOWN_NOT_PERSISTED,
      planFingerprint: 'a'.repeat(64),
    })
  })
})

describe('Commercial strategy decision paper exercise plan', () => {
  it('blocks generation and comparison when readiness is blocked by a missing pack', () => {
    const packs = allSelectedPacks().filter((pack) => pack.packKey !== 'fx-runtime-pack')
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate(packs) })
    const plan = buildCommercialStrategyDecisionPaperExercisePlan({ readinessReport })

    expect(plan.status).toBe(COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES.BLOCKED)
    expect(plan.stopBeforeGeneration).toBe(true)
    expect(plan.candidateGeneration).toMatchObject({
      planned: false,
      invoked: false,
      candidateAvailable: false,
      blockedReason: 'KNOWLEDGE_READINESS_BLOCKED',
    })
    expect(plan.comparison).toMatchObject({
      planned: false,
      invoked: false,
      result: null,
      resultStatus: 'NOT_RUN',
      blockedReason: 'KNOWLEDGE_READINESS_BLOCKED',
      benchmarkAvailable: false,
    })
    expect(plan.blocked.missingPacks.map((pack) => pack.packKey)).toEqual(['fx-runtime-pack'])
    expect(plan.blocked.blockerCodes).toContain(COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_MISSING)
  })

  it('returns ready-for-generation scaffolding without generating or comparing content', () => {
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })
    const plan = buildCommercialStrategyDecisionPaperExercisePlan({ readinessReport })

    expect(plan.status).toBe(COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES.READY_FOR_GENERATION)
    expect(plan.stopBeforeGeneration).toBe(false)
    expect(plan.candidateGeneration).toMatchObject({
      planned: true,
      invoked: false,
      candidateAvailable: false,
    })
    expect(plan.comparison).toMatchObject({
      planned: true,
      invoked: false,
      result: null,
      resultStatus: 'NOT_RUN',
      benchmarkAvailable: false,
    })
    expect(plan.plannedStages.length).toBeGreaterThan(0)
    expect(plan.plannedStages.flatMap((stage) => stage.requiredPackKeys)).toContain('gx-runtime-pack')
  })

  it('keeps QA evidence bounded to the readiness chain', () => {
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })
    const plan = buildCommercialStrategyDecisionPaperExercisePlan({ readinessReport })

    expect(plan.qaEvidence).toEqual({
      scope: 'READINESS_CHAIN_ONLY',
      extendedQaRequired: false,
      browserQaRequired: false,
    })
  })

  it('exposes a structural golden reasoning-chain fixture without customer or benchmark content', () => {
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })
    const plan = buildCommercialStrategyDecisionPaperExercisePlan({ readinessReport })

    expect(plan.goldenReasoningChainFixture).toMatchObject({
      fixtureKey: COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE.fixtureKey,
      status: 'STRUCTURAL_SCAFFOLD_ONLY',
      customerEvidenceIncluded: false,
      benchmarkPaperTextIncluded: false,
    })
    expect(plan.goldenReasoningChainFixturePackage).toMatchObject({
      contractVersion: expect.any(String),
      requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
      fixtureFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      fixtureIntegrity: {
        status: 'FINGERPRINTED',
        algorithm: 'sha256',
        customerEvidenceIncluded: false,
        benchmarkPaperTextIncluded: false,
        generatedContentIncluded: false,
      },
    })
    expect(assertCommercialStrategyDecisionPaperChainFixturePackage(plan.goldenReasoningChainFixturePackage))
      .toBe(plan.goldenReasoningChainFixturePackage)
    expect(plan.goldenReasoningChainFixture.stages.map((stage) => stage.stageKey)).toEqual([
      'EVIDENCE_BASELINE',
      'SOURCE_EVIDENCE_OBJECT_MATRIX',
      'CLAIM_HYPOTHESIS_MATRIX',
      'CONTRADICTION_ALTERNATIVE_EXPLANATION_REVIEW',
      'OBSERVATION_DELTA_INTAKE_RECONCILIATION',
      'EVIDENCE_TO_KNOWLEDGE_HANDOFF',
      'VMF_COMMERCIAL_SYSTEM_ANALYSIS',
      'FX_VALUE_ASSESSMENT',
      'GX_COMMERCIAL_READINESS',
      'ARL_RL_REVIEW_GATES',
      'FINAL_ASSET_GOVERNANCE',
    ])
    expect(plan.comparison.acceptanceDimensions).toEqual([
      'stage_coverage',
      'evidence_lineage',
      'contradiction_handling',
      'decision_usefulness',
      'confidence_boundaries',
      'executive_readability',
      'benchmark_asset_availability',
      'comparison_readiness',
    ])
    expect(JSON.stringify(plan.goldenReasoningChainFixture)).not.toMatch(/client customer evidence|benchmark paper text|commercial conclusion/i)
  })

  it('fingerprints the structural chain fixture deterministically and fails closed on tampering', () => {
    const fixturePackage = buildCommercialStrategyDecisionPaperChainFixturePackage()
    const reorderedFixture = {
      acceptanceDimensions: COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE.acceptanceDimensions,
      benchmarkPaperTextIncluded: false,
      benchmarkRequired: true,
      customerEvidenceIncluded: false,
      fixtureKey: COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE.fixtureKey,
      stages: COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE.stages,
      status: 'STRUCTURAL_SCAFFOLD_ONLY',
    }

    expect(fixturePackage.fixtureFingerprint).toBe(hashCommercialStrategyDecisionPaperChainFixture(reorderedFixture))

    const tampered = {
      ...fixturePackage,
      fixture: {
        ...fixturePackage.fixture,
        customerEvidenceIncluded: true,
      },
    }
    expect(() => assertCommercialStrategyDecisionPaperChainFixturePackage(tampered)).toThrow(expect.objectContaining({
      code: 'COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE_INVALID',
    }))
  })

  it('reports exact source-authority intake requirements for missing packs', () => {
    const packs = allSelectedPacks().filter((pack) => !['ec-runtime-pack', 'st-runtime-pack'].includes(pack.packKey))
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate(packs) })
    const intakePlan = buildCommercialStrategyDecisionPaperSourceIntakePlan({ readinessReport })

    expect(intakePlan.status).toBe('INTAKE_REQUIRED')
    expect(intakePlan.activationReady).toBe(false)
    expect(intakePlan.intakeRequirements.map((item) => item.packKey)).toEqual(['ec-runtime-pack', 'st-runtime-pack'])
    expect(intakePlan.intakeRequirements.find((item) => item.packKey === 'ec-runtime-pack').sourceDocuments.map((item) => item.documentName)).toEqual([
      'EC_v1.9_Source-Authority_Runtime_Artifact.docx',
      'ET v2.8 Canonical Execution Translation System.docx',
      'GX v2.7 Canonical Specification_.docx',
      'FX v2.6 Canonical Specification_.docx',
    ])
    expect(intakePlan.intakeRequirements.find((item) => item.packKey === 'st-runtime-pack').sourceDocuments).toHaveLength(8)
  })

  it('builds a PO-facing source authority report without activating packs', () => {
    const packs = allSelectedPacks().filter((pack) => !['fx-runtime-pack', 'gx-runtime-pack'].includes(pack.packKey))
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate(packs) })
    const sourceIntake = buildCommercialStrategyDecisionPaperSourceIntakePlan({
      readinessReport,
      sourceInventory: [{
        sourceDocument: 'FX v2.6 Canonical Specification_.docx',
      }],
    })
    const report = buildCommercialStrategyDecisionPaperSourceAuthorityReport({ sourceIntake })

    expect(report).toMatchObject({
      status: 'SOURCE_AUTHORITY_REQUIRED',
      activationReady: false,
      activationReadyReason: 'SOURCE_AUTHORITY_REPORT_DOES_NOT_ACTIVATE_KNOWLEDGE_PACKS',
      requiredPackKeys: ['fx-runtime-pack', 'gx-runtime-pack'],
      presentSourceDocuments: ['FX v2.6 Canonical Specification_.docx'],
      missingSourceDocuments: ['GX v2.7 Canonical Specification_.docx'],
    })
    expect(report.requirements.find((item) => item.packKey === 'fx-runtime-pack')).toMatchObject({
      sourceMaterialPresent: true,
      activationReady: false,
      activationReadyReason: 'SOURCE_MATERIAL_PRESENT_REQUIRES_GOVERNED_IMPORT_ACTIVATION',
    })
    expect(report.requirements.find((item) => item.packKey === 'gx-runtime-pack')).toMatchObject({
      sourceMaterialPresent: false,
      activationReady: false,
      activationReadyReason: 'SOURCE_MATERIAL_MISSING',
    })
  })

  it('treats present source material as intake evidence only, not activation readiness', () => {
    const packs = allSelectedPacks().filter((pack) => pack.packKey !== 'fx-runtime-pack')
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate(packs) })
    const plan = buildCommercialStrategyDecisionPaperExercisePlan({
      readinessReport,
      sourceInventory: [{
        supportAssetPath: 'docs/seed-data/support_assets/system-reference-fx-v2-6-canonical-specification.md',
      }],
    })

    expect(plan.sourceIntake.intakeRequirements).toHaveLength(1)
    expect(plan.sourceIntake.intakeRequirements[0]).toMatchObject({
      packKey: 'fx-runtime-pack',
      sourceMaterialPresent: true,
      activationReady: false,
      activationReadyReason: 'SOURCE_MATERIAL_PRESENT_REQUIRES_GOVERNED_IMPORT_ACTIVATION',
    })
    expect(plan.sourceAuthorityReport).toMatchObject({
      status: 'SOURCE_AUTHORITY_REQUIRED',
      activationReady: false,
      presentSupportAssets: ['docs/seed-data/support_assets/system-reference-fx-v2-6-canonical-specification.md'],
      missingSourceDocuments: ['FX v2.6 Canonical Specification_.docx'],
    })
    expect(plan.status).toBe(COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES.BLOCKED)
    expect(plan.candidateGeneration.invoked).toBe(false)
    expect(plan.comparison.invoked).toBe(false)
  })

  it('does not introduce prompt or workaround language into source intake projections', () => {
    const packs = allSelectedPacks().filter((pack) => pack.packKey !== 'gx-runtime-pack')
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate(packs) })
    const intakePlan = buildCommercialStrategyDecisionPaperSourceIntakePlan({ readinessReport })

    expect(JSON.stringify(intakePlan)).not.toMatch(/prompt|workaround|Output Lab|generate anyway|bypass/i)
  })

  it('blocks benchmark availability when the approved example benchmark reference is missing', () => {
    const benchmarkReadiness = buildCommercialStrategyDecisionPaperBenchmarkReadiness()

    expect(benchmarkReadiness.status).toBe('BENCHMARK_REFERENCE_BLOCKED')
    expect(benchmarkReadiness.benchmarkAvailable).toBe(false)
    expect(benchmarkReadiness.blockers).toEqual([{ code: 'BENCHMARK_REFERENCE_MISSING' }])
  })

  it('reports exact benchmark metadata blockers without reading document bytes', () => {
    const benchmarkReadiness = buildCommercialStrategyDecisionPaperBenchmarkReadiness({
      benchmarkReference: approvedBenchmarkReference({
        benchmarkKey: 'wrong',
        title: 'Wrong paper',
        sprintKey: 'SS-006',
        status: 'DRAFT',
        family: 'PRESENTATION',
        sha256: 'not-a-hash',
        provenanceUri: 'http://example.test/reference',
      }),
    })

    expect(benchmarkReadiness.status).toBe('BENCHMARK_REFERENCE_BLOCKED')
    expect(benchmarkReadiness.benchmarkAvailable).toBe(false)
    expect(benchmarkReadiness.blockers.map((blocker) => blocker.code)).toEqual([
      'BENCHMARK_KEY_MISMATCH',
      'BENCHMARK_TITLE_MISMATCH',
      'BENCHMARK_SPRINT_MISMATCH',
      'BENCHMARK_REFERENCE_NOT_APPROVED',
      'BENCHMARK_REFERENCE_FAMILY_INVALID',
      'BENCHMARK_REFERENCE_SHA256_INVALID',
      'BENCHMARK_REFERENCE_PROVENANCE_INVALID',
    ])
    expect(JSON.stringify(benchmarkReadiness)).not.toMatch(/bytes|contentBase64|documentText/i)
  })

  it('marks a valid approved benchmark reference available without running comparison', () => {
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })
    const plan = buildCommercialStrategyDecisionPaperExercisePlan({
      readinessReport,
      benchmarkReference: approvedBenchmarkReference(),
    })

    expect(plan.benchmarkReadiness.status).toBe('BENCHMARK_REFERENCE_READY')
    expect(plan.comparison).toMatchObject({
      planned: true,
      invoked: false,
      result: null,
      resultStatus: 'NOT_RUN',
      benchmarkAvailable: true,
    })
  })

  it('keeps missing-pack readiness blocked even when benchmark metadata is valid', () => {
    const packs = allSelectedPacks().filter((pack) => pack.packKey !== 'gx-runtime-pack')
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate(packs) })
    const plan = buildCommercialStrategyDecisionPaperExercisePlan({
      readinessReport,
      benchmarkReference: approvedBenchmarkReference(),
    })

    expect(plan.benchmarkReadiness.benchmarkAvailable).toBe(true)
    expect(plan.status).toBe(COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES.BLOCKED)
    expect(plan.stopBeforeGeneration).toBe(true)
    expect(plan.candidateGeneration.invoked).toBe(false)
    expect(plan.comparison).toMatchObject({
      planned: false,
      invoked: false,
      resultStatus: 'NOT_RUN',
      blockedReason: 'KNOWLEDGE_READINESS_BLOCKED',
      benchmarkAvailable: true,
    })
  })

  it('blocks generated candidate readiness when metadata is missing or unsafe', () => {
    const readiness = buildCommercialStrategyDecisionPaperCandidateReadiness({
      candidateReference: candidateReference({
        assetId: '',
        requestedOutputTypeKey: 'executive-brief',
        status: 'DRAFT',
        sha256: 'not-a-hash',
        provenanceUri: 'http://example.test/candidate',
        documentText: 'customer-visible content should not be carried in readiness metadata',
      }),
    })

    expect(readiness.status).toBe('CANDIDATE_REFERENCE_BLOCKED')
    expect(readiness.candidateAvailable).toBe(false)
    expect(readiness.blockers.map((blocker) => blocker.code)).toEqual([
      'CANDIDATE_REFERENCE_ID_MISSING',
      'CANDIDATE_OUTPUT_TYPE_MISMATCH',
      'CANDIDATE_REFERENCE_NOT_READY',
      'CANDIDATE_REFERENCE_SHA256_INVALID',
      'CANDIDATE_REFERENCE_PROVENANCE_INVALID',
      'CANDIDATE_REFERENCE_CONTAINS_CONTENT_FIELD',
    ])
  })

  it('marks generated candidate readiness from metadata without document content', () => {
    const readiness = buildCommercialStrategyDecisionPaperCandidateReadiness({
      candidateReference: candidateReference(),
    })

    expect(readiness).toEqual({
      contractVersion: expect.any(String),
      requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
      status: 'CANDIDATE_REFERENCE_READY',
      candidateAvailable: true,
      blockers: [],
    })
  })

  it('blocks comparison readiness when metadata is missing or unsafe', () => {
    const readiness = buildCommercialStrategyDecisionPaperComparisonReadiness({
      comparisonResult: comparisonResultFor('PASS', {
        invoked: false,
        resultId: '',
        requestedOutputTypeKey: 'executive-brief',
        sha256: 'not-a-hash',
        provenanceUri: 'http://example.test/comparison',
        benchmarkText: 'benchmark content should not be carried in readiness metadata',
        dimensionResults: [
          { dimensionKey: '', status: 'PASS' },
          { dimensionKey: 'unknown_dimension', status: 'PASS' },
          { dimensionKey: 'stage_coverage', status: 'UNKNOWN' },
          { dimensionKey: 'stage_coverage', status: 'PASS' },
        ],
      }),
    })

    expect(readiness.status).toBe('COMPARISON_RESULT_BLOCKED')
    expect(readiness.comparisonAvailable).toBe(false)
    expect(readiness.blockers.map((blocker) => blocker.code)).toEqual([
      'COMPARISON_NOT_INVOKED',
      'COMPARISON_RESULT_ID_MISSING',
      'COMPARISON_OUTPUT_TYPE_MISMATCH',
      'COMPARISON_RESULT_SHA256_INVALID',
      'COMPARISON_RESULT_PROVENANCE_INVALID',
      'COMPARISON_RESULT_CONTAINS_CONTENT_FIELD',
      'COMPARISON_DIMENSION_KEY_MISSING',
      'COMPARISON_DIMENSION_UNKNOWN',
      'COMPARISON_DIMENSION_STATUS_INVALID',
      'COMPARISON_DIMENSION_DUPLICATE',
    ])
  })

  it('marks comparison readiness from metadata without document content', () => {
    const readiness = buildCommercialStrategyDecisionPaperComparisonReadiness({
      comparisonResult: comparisonResultFor('PASS'),
    })

    expect(readiness).toEqual({
      contractVersion: expect.any(String),
      requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
      status: 'COMPARISON_RESULT_READY',
      comparisonAvailable: true,
      requiredDimensions: COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE.acceptanceDimensions,
      blockers: [],
    })
  })

  it('summarizes blocked sprint acceptance evidence without claiming completion', () => {
    const packs = allSelectedPacks().filter((pack) => pack.packKey !== 'gx-runtime-pack')
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate(packs) })
    const exercisePlan = buildCommercialStrategyDecisionPaperExercisePlan({
      readinessReport,
      benchmarkReference: approvedBenchmarkReference(),
    })
    const snapshot = buildCommercialStrategyDecisionPaperSprintEvidenceSnapshot({ exercisePlan })

    expect(snapshot.status).toBe('BLOCKED')
    expect(snapshot.ss007Complete).toBe(false)
    expect(snapshot.completionClaim).toBe('NOT_COMPLETE')
    expect(snapshot.acceptanceChecklist.map((item) => item.itemKey)).toEqual([
      'golden_reasoning_chain_fixture',
      'generated_commercial_strategy_decision_paper_candidate',
      'approved_benchmark_comparison',
      'pass_partial_fail_result',
      'qa_chain_evidence',
      'help_impact_publication_readiness',
    ])
    expect(snapshot.acceptanceChecklist.find((item) => item.itemKey === 'golden_reasoning_chain_fixture').status).toBe('PRESENT')
    expect(snapshot.acceptanceChecklist.find((item) => item.itemKey === 'generated_commercial_strategy_decision_paper_candidate')).toMatchObject({
      status: 'BLOCKED',
      invoked: false,
    })
    expect(snapshot.acceptanceChecklist.find((item) => item.itemKey === 'approved_benchmark_comparison')).toMatchObject({
      status: 'BLOCKED',
      invoked: false,
      benchmarkAvailable: true,
    })
    expect(snapshot.acceptanceChecklist.find((item) => item.itemKey === 'pass_partial_fail_result')).toMatchObject({
      status: 'BLOCKED',
      result: null,
    })
    expect(snapshot.blockers.missingPacks).toEqual(['gx-runtime-pack'])
  })

  it('summarizes ready scaffolding as ready to run but still not generated or compared', () => {
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })
    const exercisePlan = buildCommercialStrategyDecisionPaperExercisePlan({
      readinessReport,
      benchmarkReference: approvedBenchmarkReference(),
    })
    const snapshot = buildCommercialStrategyDecisionPaperSprintEvidenceSnapshot({ exercisePlan })

    expect(snapshot.status).toBe('SCAFFOLD_READY')
    expect(snapshot.ss007Complete).toBe(false)
    expect(snapshot.acceptanceChecklist.find((item) => item.itemKey === 'generated_commercial_strategy_decision_paper_candidate')).toMatchObject({
      status: 'READY_TO_RUN',
      invoked: false,
      evidenceScope: 'NOT_GENERATED_IN_THIS_SLICE',
    })
    expect(snapshot.acceptanceChecklist.find((item) => item.itemKey === 'approved_benchmark_comparison')).toMatchObject({
      status: 'READY_TO_RUN',
      invoked: false,
      benchmarkAvailable: true,
      evidenceScope: 'NOT_COMPARED_IN_THIS_SLICE',
    })
    expect(snapshot.acceptanceChecklist.find((item) => item.itemKey === 'pass_partial_fail_result')).toMatchObject({
      status: 'NOT_RUN',
      result: null,
    })
    expect(snapshot.acceptanceResult).toMatchObject({
      status: 'NOT_RUN',
      result: null,
      blockers: [{ code: 'CANDIDATE_NOT_GENERATED' }],
    })
  })

  it('keeps acceptance blocked when readiness is blocked', () => {
    const packs = allSelectedPacks().filter((pack) => pack.packKey !== 'gx-runtime-pack')
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate(packs) })
    const exercisePlan = buildCommercialStrategyDecisionPaperExercisePlan({
      readinessReport,
      benchmarkReference: approvedBenchmarkReference(),
    })
    const acceptance = buildCommercialStrategyDecisionPaperAcceptanceResult({
      exercisePlan,
      candidateReference: candidateReference(),
      comparisonResult: comparisonResultFor('PASS'),
    })

    expect(acceptance).toMatchObject({
      status: 'BLOCKED',
      result: null,
      generated: true,
      compared: true,
      benchmarkAvailable: true,
    })
    expect(acceptance.blockers.map((blocker) => blocker.code)).toContain('READINESS_BLOCKED')
  })

  it('reports a pass acceptance result only when every comparison dimension passes', () => {
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })
    const exercisePlan = buildCommercialStrategyDecisionPaperExercisePlan({
      readinessReport,
      benchmarkReference: approvedBenchmarkReference(),
    })
    const acceptance = buildCommercialStrategyDecisionPaperAcceptanceResult({
      exercisePlan,
      candidateReference: candidateReference(),
      comparisonResult: comparisonResultFor('PASS'),
    })

    expect(acceptance.status).toBe('COMPARED')
    expect(acceptance.result).toBe('PASS')
    expect(acceptance.blockers).toEqual([])
    expect(acceptance.dimensionResults.every((item) => item.status === 'PASS')).toBe(true)
  })

  it('summarizes supplied candidate and comparison evidence without claiming sprint completion', () => {
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })
    const exercisePlan = buildCommercialStrategyDecisionPaperExercisePlan({
      readinessReport,
      benchmarkReference: approvedBenchmarkReference(),
    })
    const snapshot = buildCommercialStrategyDecisionPaperSprintEvidenceSnapshot({
      exercisePlan,
      candidateReference: candidateReference(),
      comparisonResult: comparisonResultFor('PASS'),
    })

    expect(snapshot.acceptanceChecklist.find((item) => item.itemKey === 'generated_commercial_strategy_decision_paper_candidate')).toMatchObject({
      status: 'PRESENT',
      invoked: false,
    })
    expect(snapshot.acceptanceChecklist.find((item) => item.itemKey === 'approved_benchmark_comparison')).toMatchObject({
      status: 'PRESENT',
      invoked: false,
      benchmarkAvailable: true,
    })
    expect(snapshot.acceptanceChecklist.find((item) => item.itemKey === 'pass_partial_fail_result')).toMatchObject({
      status: 'COMPARED',
      result: 'PASS',
      evidenceScope: 'COMPARISON_RESULT_EVIDENCE',
    })
    expect(snapshot.acceptanceResult.result).toBe('PASS')
    expect(snapshot.ss007Complete).toBe(false)
    expect(snapshot.completionClaim).toBe('NOT_COMPLETE')
  })

  it('reports partial pass when comparison evidence is incomplete or partial', () => {
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })
    const exercisePlan = buildCommercialStrategyDecisionPaperExercisePlan({
      readinessReport,
      benchmarkReference: approvedBenchmarkReference(),
    })
    const [firstDimension] = COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE.acceptanceDimensions
    const acceptance = buildCommercialStrategyDecisionPaperAcceptanceResult({
      exercisePlan,
      candidateReference: candidateReference(),
      comparisonResult: comparisonResultFor('PASS', {
        dimensionResults: [{ dimensionKey: firstDimension, status: 'PARTIAL' }],
      }),
    })

    expect(acceptance.status).toBe('COMPARED')
    expect(acceptance.result).toBe('PARTIAL_PASS')
    expect(acceptance.dimensionResults).toHaveLength(COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE.acceptanceDimensions.length)
    expect(acceptance.blockers.map((blocker) => blocker.code)).toContain('DIMENSION_PARTIAL')
  })

  it('reports fail when any supplied comparison dimension fails', () => {
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })
    const exercisePlan = buildCommercialStrategyDecisionPaperExercisePlan({
      readinessReport,
      benchmarkReference: approvedBenchmarkReference(),
    })
    const comparisonResult = comparisonResultFor('PASS')
    comparisonResult.dimensionResults[0] = {
      ...comparisonResult.dimensionResults[0],
      status: 'FAIL',
    }

    const acceptance = buildCommercialStrategyDecisionPaperAcceptanceResult({
      exercisePlan,
      candidateReference: candidateReference(),
      comparisonResult,
    })

    expect(acceptance.status).toBe('COMPARED')
    expect(acceptance.result).toBe('FAIL')
    expect(acceptance.blockers).toContainEqual({
      code: 'DIMENSION_FAIL',
      dimensionKey: COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE.acceptanceDimensions[0],
    })
  })

  it('does not introduce prompt workaround or embedded client content into the sprint evidence snapshot', () => {
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })
    const exercisePlan = buildCommercialStrategyDecisionPaperExercisePlan({ readinessReport })
    const snapshot = buildCommercialStrategyDecisionPaperSprintEvidenceSnapshot({ exercisePlan })

    expect(JSON.stringify(snapshot)).not.toMatch(/prompt|workaround|Output Lab|generate anyway|benchmark paper text|client customer evidence|commercial conclusion/i)
  })

  it('reports exact missing help paths and blocks help publication readiness', () => {
    const readiness = buildCommercialStrategyDecisionPaperHelpReadiness({
      helpMetadata: [{ path: 'docs/help/outcome-studio/governed-reasoning-readiness.md' }],
      selectedHelpRepositoryBinding: { verified: true },
    })

    expect(readiness.status).toBe('HELP_PUBLICATION_BLOCKED')
    expect(readiness.publicationReady).toBe(false)
    expect(readiness.published).toBe(false)
    expect(readiness.missingPaths).toEqual([
      'docs/help/outcome-studio/knowledge-composition-plan.md',
      'docs/help/outcome-studio/commercial-strategy-decision-paper.md',
    ])
  })

  it('blocks help publication when paths are present but repository binding is unverified', () => {
    const readiness = buildCommercialStrategyDecisionPaperHelpReadiness({
      helpMetadata: helpMetadata(),
      selectedHelpRepositoryBinding: { verified: false },
    })

    expect(readiness.pathsReady).toBe(true)
    expect(readiness.repositoryBindingVerified).toBe(false)
    expect(readiness.publicationReady).toBe(false)
    expect(readiness.blockers).toEqual([{ code: 'HELP_REPOSITORY_BINDING_NOT_VERIFIED' }])
  })

  it('marks help publication ready without publishing or completing SS-007', () => {
    const readinessReport = buildCommercialStrategyDecisionPaperReadinessReport({ candidate: makeCandidate() })
    const exercisePlan = buildCommercialStrategyDecisionPaperExercisePlan({
      readinessReport,
      benchmarkReference: approvedBenchmarkReference(),
    })
    const snapshot = buildCommercialStrategyDecisionPaperSprintEvidenceSnapshot({
      exercisePlan,
      helpMetadata: helpMetadata(),
      selectedHelpRepositoryBinding: { verified: true },
    })

    expect(snapshot.helpReadiness).toMatchObject({
      status: 'HELP_PUBLICATION_READY',
      publicationReady: true,
      published: false,
    })
    expect(snapshot.acceptanceChecklist.find((item) => item.itemKey === 'help_impact_publication_readiness')).toMatchObject({
      status: 'READY_NOT_PUBLISHED',
      published: false,
    })
    expect(snapshot.ss007Complete).toBe(false)
  })

  it('builds a blocked generic readiness package without generating or comparing', () => {
    const packs = allSelectedPacks().filter((pack) => pack.packKey !== 'gx-runtime-pack')
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(packs),
      benchmarkReference: approvedBenchmarkReference(),
      helpMetadata: helpMetadata(),
      selectedHelpRepositoryBinding: { verified: true },
    })

    expect(readinessPackage.status).toBe('BLOCKED')
    expect(readinessPackage.readinessReport.missing.map((pack) => pack.packKey)).toEqual(['gx-runtime-pack'])
    expect(readinessPackage.exercisePlan.candidateGeneration.invoked).toBe(false)
    expect(readinessPackage.exercisePlan.comparison).toMatchObject({
      planned: false,
      invoked: false,
      resultStatus: 'NOT_RUN',
      benchmarkAvailable: true,
    })
    expect(readinessPackage.sprintEvidenceSnapshot.ss007Complete).toBe(false)
    expect(readinessPackage.runGate).toMatchObject({
      status: 'STOP',
      nextAction: 'REPORT_MISSING_KNOWLEDGE_PACKS',
      mayGenerate: false,
      mayCompare: false,
      mayReportVerdict: false,
      missingPacks: ['gx-runtime-pack'],
    })
    expect(readinessPackage.progressSummary).toMatchObject({
      status: 'BLOCKED',
      runGateStatus: 'STOP',
      nextAction: 'REPORT_MISSING_KNOWLEDGE_PACKS',
      completionClaim: 'NOT_COMPLETE',
      ss007Complete: false,
    })
    expect(readinessPackage.progressSummary.remaining.map((item) => item.itemKey)).toEqual(expect.arrayContaining([
      'resolve_knowledge_packs',
      'supply_source_authority',
      'complete_sprint_evidence',
    ]))
    expect(readinessPackage.progressSummary.leftToDo).toEqual({
      primaryBlockers: [
        'Missing or unresolved governed Knowledge Packs.',
        'Required source-authority documents or support assets are not fully supplied/mapped.',
      ],
      nextSequence: [
        'Complete sprint evidence only after generation, comparison and verdict evidence exist.',
      ],
      separatePublicationBlockers: [],
      currentGate: 'STOP',
      currentGateAction: 'REPORT_MISSING_KNOWLEDGE_PACKS',
      missingPackKeys: ['gx-runtime-pack'],
    })
    expect(readinessPackage.progressSummary.recommendedNext).toEqual({
      action: 'RESOLVE_KNOWLEDGE_READINESS',
      label: 'Upload/import/activate/certify missing Knowledge Packs, then rerun the governed readiness gate.',
      blocked: true,
      reason: 'KNOWLEDGE_READINESS_BLOCKED',
      missingPackKeys: ['gx-runtime-pack'],
    })
  })

  it('builds a scaffold-ready generic package without completion or execution claims', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      benchmarkReference: approvedBenchmarkReference(),
      helpMetadata: helpMetadata(),
      selectedHelpRepositoryBinding: { verified: true },
    })

    expect(readinessPackage.status).toBe('SCAFFOLD_READY')
    expect(readinessPackage.readinessReport.stopBeforeGeneration).toBe(false)
    expect(readinessPackage.exercisePlan.candidateGeneration).toMatchObject({
      planned: true,
      invoked: false,
      candidateAvailable: false,
    })
    expect(readinessPackage.exercisePlan.comparison).toMatchObject({
      planned: true,
      invoked: false,
      result: null,
      resultStatus: 'NOT_RUN',
      benchmarkAvailable: true,
    })
    expect(readinessPackage.sprintEvidenceSnapshot).toMatchObject({
      ss007Complete: false,
      completionClaim: 'NOT_COMPLETE',
    })
    expect(readinessPackage.runGate).toMatchObject({
      status: 'READY_FOR_GENERATION',
      nextAction: 'GENERATE_CANDIDATE',
      mayGenerate: true,
      mayCompare: false,
      mayReportVerdict: false,
    })
    expect(readinessPackage.progressSummary).toMatchObject({
      status: 'IN_PROGRESS',
      runGateStatus: 'READY_FOR_GENERATION',
      nextAction: 'GENERATE_CANDIDATE',
      ss007Complete: false,
    })
    expect(readinessPackage.progressSummary.remaining.map((item) => item.itemKey)).toEqual(expect.arrayContaining([
      'generate_candidate',
      'complete_sprint_evidence',
    ]))
    expect(readinessPackage.progressSummary.leftToDo).toMatchObject({
      primaryBlockers: [],
      nextSequence: [
        'Generate one governed commercial strategy decision-paper candidate.',
        'Complete sprint evidence only after generation, comparison and verdict evidence exist.',
      ],
      separatePublicationBlockers: [],
      currentGate: 'READY_FOR_GENERATION',
      currentGateAction: 'GENERATE_CANDIDATE',
      missingPackKeys: [],
    })
    expect(readinessPackage.progressSummary.recommendedNext).toEqual({
      action: 'GENERATE_CANDIDATE',
      label: 'Generate one governed commercial strategy decision-paper candidate.',
      blocked: false,
      reason: '',
    })
    expect(readinessPackage.readinessProjection).toMatchObject({
      status: 'SCAFFOLD_READY',
      completionClaim: 'NOT_COMPLETE',
      ss007Complete: false,
      runGate: {
        status: 'READY_FOR_GENERATION',
        nextAction: 'GENERATE_CANDIDATE',
      },
      benchmark: {
        status: 'BENCHMARK_REFERENCE_READY',
        benchmarkAvailable: true,
      },
      qaEvidence: {
        scope: 'READINESS_CHAIN_ONLY',
        extendedQaRequired: false,
        browserQaRequired: false,
      },
    })
  })

  it('gates the package to comparison after a valid generated candidate reference is supplied', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      benchmarkReference: approvedBenchmarkReference(),
      candidateReference: candidateReference(),
    })

    expect(readinessPackage.runGate).toMatchObject({
      status: 'READY_FOR_COMPARISON',
      nextAction: 'RUN_BENCHMARK_COMPARISON',
      mayGenerate: false,
      mayCompare: true,
      mayReportVerdict: false,
    })
    expect(readinessPackage.progressSummary.recommendedNext).toEqual({
      action: 'RUN_BENCHMARK_COMPARISON',
      label: 'Run governed benchmark comparison against the approved example benchmark reference.',
      blocked: false,
      reason: '',
    })
  })

  it('gates the package to verdict reporting after valid candidate and comparison evidence', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      benchmarkReference: approvedBenchmarkReference(),
      candidateReference: candidateReference(),
      comparisonResult: comparisonResultFor('PASS'),
      helpMetadata: helpMetadata(),
      selectedHelpRepositoryBinding: { verified: true },
    })

    expect(readinessPackage.runGate).toMatchObject({
      status: 'READY_FOR_VERDICT',
      nextAction: 'REPORT_PASS_PARTIAL_OR_FAIL',
      mayGenerate: false,
      mayCompare: false,
      mayReportVerdict: true,
      qaOutcomeOnly: true,
      extendedQaRequired: false,
    })
    expect(readinessPackage.progressSummary).toMatchObject({
      status: 'IN_PROGRESS',
      runGateStatus: 'READY_FOR_VERDICT',
      nextAction: 'REPORT_PASS_PARTIAL_OR_FAIL',
      ss007Complete: false,
    })
    expect(readinessPackage.progressSummary.completed.map((item) => item.itemKey)).toEqual(expect.arrayContaining([
      'candidate_reference_ready',
      'comparison_result_ready',
      'acceptance_result_available',
      'help_publication_ready',
    ]))
    expect(readinessPackage.progressSummary.remaining.map((item) => item.itemKey)).toEqual(['complete_sprint_evidence'])
    expect(readinessPackage.progressSummary.leftToDo).toMatchObject({
      primaryBlockers: [],
      nextSequence: ['Complete sprint evidence only after generation, comparison and verdict evidence exist.'],
      separatePublicationBlockers: [],
      currentGate: 'READY_FOR_VERDICT',
      currentGateAction: 'REPORT_PASS_PARTIAL_OR_FAIL',
    })
    expect(readinessPackage.progressSummary.recommendedNext).toEqual({
      action: 'REPORT_PASS_PARTIAL_OR_FAIL',
      label: 'Report pass, partial pass or fail from governed comparison evidence.',
      blocked: false,
      reason: '',
    })
    expect(readinessPackage.sprintEvidenceSnapshot.ss007Complete).toBe(false)
  })

  it('reports verdict readiness with help blocked without blocking the technical verdict gate', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      benchmarkReference: approvedBenchmarkReference(),
      candidateReference: candidateReference(),
      comparisonResult: comparisonResultFor('PARTIAL'),
    })

    expect(readinessPackage.runGate).toMatchObject({
      status: 'READY_FOR_VERDICT',
      nextAction: 'REPORT_PASS_PARTIAL_OR_FAIL_WITH_HELP_BLOCKED',
      mayReportVerdict: true,
    })
    expect(readinessPackage.runGate.blockers).toContain('HELP_REPOSITORY_BINDING_NOT_VERIFIED')
  })

  it('preserves benchmark and help blockers inside the generic readiness package', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      helpMetadata: [{ path: 'docs/help/outcome-studio/governed-reasoning-readiness.md' }],
      selectedHelpRepositoryBinding: { verified: false },
    })

    expect(readinessPackage.status).toBe('SCAFFOLD_READY')
    expect(readinessPackage.exercisePlan.benchmarkReadiness.blockers).toEqual([{ code: 'BENCHMARK_REFERENCE_MISSING' }])
    expect(readinessPackage.sprintEvidenceSnapshot.helpReadiness).toMatchObject({
      status: 'HELP_PUBLICATION_BLOCKED',
      publicationReady: false,
      published: false,
    })
    expect(readinessPackage.sprintEvidenceSnapshot.helpReadiness.missingPaths).toEqual([
      'docs/help/outcome-studio/knowledge-composition-plan.md',
      'docs/help/outcome-studio/commercial-strategy-decision-paper.md',
    ])
  })

  it('projects a compact readiness summary without raw candidate or comparison content', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      benchmarkReference: approvedBenchmarkReference(),
      candidateReference: candidateReference({
        documentText: 'customer-visible content should stay out of readiness projection',
      }),
      comparisonResult: comparisonResultFor('PASS', {
        benchmarkText: 'benchmark content should stay out of readiness projection',
      }),
    })

    expect(readinessPackage.readinessProjection).toEqual(buildCommercialStrategyDecisionPaperReadinessProjection({
      readinessPackage,
    }))
    expect(readinessPackage.readinessProjection).toMatchObject({
      candidate: {
        status: 'CANDIDATE_REFERENCE_BLOCKED',
        candidateAvailable: false,
      },
      comparison: {
        status: 'COMPARISON_RESULT_BLOCKED',
        comparisonAvailable: false,
      },
      runGate: {
        status: 'READY_FOR_GENERATION',
        mayGenerate: true,
        extendedQaRequired: false,
      },
    })
    expect(JSON.stringify(readinessPackage.readinessProjection)).not.toMatch(rawContentPattern())
  })

  it('builds a deterministic evidence manifest from the safe readiness projection', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      benchmarkReference: approvedBenchmarkReference(),
      candidateReference: candidateReference(),
      comparisonResult: comparisonResultFor('PASS'),
      helpMetadata: helpMetadata(),
      selectedHelpRepositoryBinding: { verified: true },
    })

    const rebuiltManifest = buildCommercialStrategyDecisionPaperEvidenceManifest({
      readinessProjection: readinessPackage.readinessProjection,
    })

    expect(readinessPackage.evidenceManifest).toEqual(rebuiltManifest)
    expect(readinessPackage.evidenceManifest).toMatchObject({
      contractVersion: expect.any(String),
      requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
      status: 'SCAFFOLD_READY',
      completionClaim: 'NOT_COMPLETE',
      ss007Complete: false,
      manifestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(readinessPackage.evidenceManifest.components.map((component) => component.componentKey)).toEqual([
      'knowledge_readiness',
      'source_authority',
      'benchmark',
      'candidate',
      'comparison',
      'run_gate',
      'help',
      'qa_evidence',
    ])
    expect(readinessPackage.evidenceManifest.components.every((component) => /^[a-f0-9]{64}$/.test(component.fingerprint))).toBe(true)
    expect(readinessPackage.evidenceManifest.manifestFingerprint).toBe(hashCommercialStrategyDecisionPaperEvidenceValue({
      contractVersion: readinessPackage.evidenceManifest.contractVersion,
      requestedOutputTypeKey: readinessPackage.evidenceManifest.requestedOutputTypeKey,
      projectionFingerprint: hashCommercialStrategyDecisionPaperEvidenceValue(readinessPackage.readinessProjection),
      components: readinessPackage.evidenceManifest.components,
    }))
  })

  it('keeps evidence manifest free of raw content and example-customer workflow naming', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      benchmarkReference: approvedBenchmarkReference(),
      candidateReference: candidateReference({
        documentText: 'customer-visible content should stay out of evidence manifest',
      }),
      comparisonResult: comparisonResultFor('FAIL', {
        candidateText: 'candidate content should stay out of evidence manifest',
      }),
    })

    expect(JSON.stringify(readinessPackage.evidenceManifest)).not.toMatch(rawContentPattern())
    expect(JSON.stringify(readinessPackage.evidenceManifest)).not.toMatch(forbiddenReusableIdentifierPattern())
  })

  it('reports readiness package integrity when derived views agree', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      benchmarkReference: approvedBenchmarkReference(),
      candidateReference: candidateReference(),
      comparisonResult: comparisonResultFor('PASS'),
      helpMetadata: helpMetadata(),
      selectedHelpRepositoryBinding: { verified: true },
    })

    expect(readinessPackage.packageIntegrity).toEqual({
      contractVersion: expect.any(String),
      requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
      status: 'PACKAGE_INTEGRITY_READY',
      blockers: [],
    })
    expect(buildCommercialStrategyDecisionPaperPackageIntegrityReport({ readinessPackage }))
      .toEqual(readinessPackage.packageIntegrity)
    expect(assertCommercialStrategyDecisionPaperPackageIntegrity(readinessPackage)).toBe(readinessPackage)
  })

  it('blocks readiness package integrity when a derived view is stale or tampered', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      benchmarkReference: approvedBenchmarkReference(),
    })
    const tampered = {
      ...readinessPackage,
      runGate: {
        ...readinessPackage.runGate,
        status: 'READY_FOR_VERDICT',
      },
    }

    const report = buildCommercialStrategyDecisionPaperPackageIntegrityReport({ readinessPackage: tampered })
    expect(report.status).toBe('PACKAGE_INTEGRITY_BLOCKED')
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining([
      'RUN_GATE_DERIVATION_MISMATCH',
      'READINESS_PROJECTION_DERIVATION_MISMATCH',
    ]))
    expect(() => assertCommercialStrategyDecisionPaperPackageIntegrity(tampered)).toThrow(expect.objectContaining({
      code: 'COMMERCIAL_STRATEGY_DECISION_PAPER_PACKAGE_INTEGRITY_INVALID',
    }))
  })

  it('keeps reusable package output free of stale client-specific identifiers', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
    })

    expect(JSON.stringify(readinessPackage)).not.toMatch(forbiddenReusableIdentifierPattern())
  })

  it('builds runtime readiness through the governed KCP dry-run output type without executing generation', async () => {
    const buildKcpCandidate = jest.fn(async ({ actorUserId, auditRequest, consumerIntent, scopes }) => {
      expect(actorUserId).toBe('user-1')
      expect(auditRequest).toEqual({ requestId: 'req-1' })
      expect(scopes).toEqual({ tenant: { _id: 'tenant-1' } })
      expect(consumerIntent).toMatchObject({
        requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
        audience: 'board',
      })
      return makeCandidate()
    })

    const readinessPackage = await buildCommercialStrategyDecisionPaperRuntimeReadinessPackage({
      actorUserId: 'user-1',
      auditRequest: { requestId: 'req-1' },
      scopes: { tenant: { _id: 'tenant-1' } },
      runtimeInstanceId: 'runtime-1',
      expectedRuntimeUpdatedAt: '2026-08-06T10:00:00.000Z',
      consumerIntent: {
        requestedOutputTypeKey: 'ignored-output-type',
        audience: 'board',
      },
      benchmarkReference: approvedBenchmarkReference(),
      deps: { buildKcpCandidate },
    })

    expect(buildKcpCandidate).toHaveBeenCalledTimes(1)
    expect(buildKcpCandidate).toHaveBeenCalledWith(expect.objectContaining({
      runtimeInstanceId: 'runtime-1',
      expectedRuntimeUpdatedAt: '2026-08-06T10:00:00.000Z',
    }))
    expect(readinessPackage.status).toBe('SCAFFOLD_READY')
    expect(readinessPackage.exercisePlan.candidateGeneration.invoked).toBe(false)
    expect(readinessPackage.exercisePlan.comparison.invoked).toBe(false)
    expect(readinessPackage.sprintEvidenceSnapshot.ss007Complete).toBe(false)
  })

  it('can rebuild a run gate from an existing readiness package projection', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      benchmarkReference: approvedBenchmarkReference(),
    })

    expect(buildCommercialStrategyDecisionPaperRunGate({ readinessPackage })).toEqual(readinessPackage.runGate)
  })

  it('can rebuild a progress summary from an existing readiness package projection', () => {
    const readinessPackage = buildCommercialStrategyDecisionPaperReadinessPackage({
      candidate: makeCandidate(),
      benchmarkReference: approvedBenchmarkReference(),
    })

    expect(buildCommercialStrategyDecisionPaperProgressSummary({ readinessPackage })).toEqual(readinessPackage.progressSummary)
  })
})
