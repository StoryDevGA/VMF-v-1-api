import { OUTCOME_QUALITY_STAGES } from './outcomeGovernedQuality.js'

export const COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION = 'ss-007-commercial-strategy-decision-paper-readiness.v0.1'

export const COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY = 'commercial-strategy-decision-paper'

export const COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK = Object.freeze({
  benchmarkKey: 'parlon-commercial-strategy-decision-paper-v2-final',
  title: 'Parlon Commercial Strategy and Decision Paper v2.0 FINAL',
  sprintKey: 'SS-007',
  benchmarkRole: 'EXAMPLE_CUSTOMER_BENCHMARK',
})

export const COMMERCIAL_STRATEGY_DECISION_PAPER_HELP_PATHS = Object.freeze([
  'docs/help/outcome-studio/governed-reasoning-readiness.md',
  'docs/help/outcome-studio/knowledge-composition-plan.md',
  'docs/help/outcome-studio/commercial-strategy-decision-paper.md',
])

export const COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES = Object.freeze({
  READY: 'READY',
  READY_WITH_GAPS: 'READY_WITH_GAPS',
  BLOCKED: 'BLOCKED',
})

export const COMMERCIAL_STRATEGY_DECISION_PAPER_EXERCISE_STATUSES = Object.freeze({
  BLOCKED: 'BLOCKED',
  READY_FOR_GENERATION: 'READY_FOR_GENERATION',
})

export const COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS = Object.freeze({
  REQUIRED_PACK_MISSING: 'REQUIRED_PACK_MISSING',
  REQUIRED_PACK_NOT_SELECTED: 'REQUIRED_PACK_NOT_SELECTED',
  REQUIRED_PACK_NOT_ELIGIBLE: 'REQUIRED_PACK_NOT_ELIGIBLE',
  REQUIRED_PACK_AMBIGUOUS: 'REQUIRED_PACK_AMBIGUOUS',
  REQUIRED_PACK_BLOCKED: 'REQUIRED_PACK_BLOCKED',
  REQUIRED_PACK_RELATIONSHIP_FAILED: 'REQUIRED_PACK_RELATIONSHIP_FAILED',
  GENERIC_OUTCOME_STUDIO_PACK_MISSING: 'GENERIC_OUTCOME_STUDIO_PACK_MISSING',
  KCP_BLOCKED_SHOWN_NOT_PERSISTED: 'KCP_BLOCKED_SHOWN_NOT_PERSISTED',
})

export const COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE = Object.freeze({
  fixtureKey: 'commercial-strategy-decision-paper-golden-chain-v0',
  status: 'STRUCTURAL_SCAFFOLD_ONLY',
  benchmarkRequired: true,
  customerEvidenceIncluded: false,
  benchmarkPaperTextIncluded: false,
  stages: [
    {
      stageKey: 'EVIDENCE_BASELINE',
      label: 'Evidence baseline',
      expectedEvidenceClasses: ['runtime_source_evidence', 'accepted_truth', 'lineage_snapshot'],
    },
    {
      stageKey: 'SOURCE_EVIDENCE_OBJECT_MATRIX',
      label: 'Source and evidence object matrix',
      expectedEvidenceClasses: ['source_object', 'evidence_object', 'evidence_to_source_mapping'],
    },
    {
      stageKey: 'CLAIM_HYPOTHESIS_MATRIX',
      label: 'Claim and hypothesis matrix',
      expectedEvidenceClasses: ['claim', 'hypothesis', 'claim_to_evidence_mapping'],
    },
    {
      stageKey: 'CONTRADICTION_ALTERNATIVE_EXPLANATION_REVIEW',
      label: 'Contradiction and alternative explanation review',
      expectedEvidenceClasses: ['contradiction', 'alternative_explanation', 'unresolved_gap'],
    },
    {
      stageKey: 'OBSERVATION_DELTA_INTAKE_RECONCILIATION',
      label: 'Observation delta and intake reconciliation',
      expectedEvidenceClasses: ['observation_delta', 'intake_reconciliation', 'change_register'],
    },
    {
      stageKey: 'EVIDENCE_TO_KNOWLEDGE_HANDOFF',
      label: 'Evidence to knowledge handoff',
      expectedEvidenceClasses: ['knowledge_handoff', 'translation_lineage', 'resolution_boundary'],
    },
    {
      stageKey: 'VMF_COMMERCIAL_SYSTEM_ANALYSIS',
      label: 'VMF commercial system analysis',
      expectedEvidenceClasses: ['commercial_system_model', 'constraint_diagnostic', 'decision_context'],
    },
    {
      stageKey: 'FX_VALUE_ASSESSMENT',
      label: 'FX economic and value assessment',
      expectedEvidenceClasses: ['value_assessment', 'economic_proof_boundary', 'confidence_boundary'],
    },
    {
      stageKey: 'GX_COMMERCIAL_READINESS',
      label: 'GX commercial readiness and go-to-market assessment',
      expectedEvidenceClasses: ['commercial_readiness', 'go_to_market_constraint', 'execution_dependency'],
    },
    {
      stageKey: 'ARL_RL_REVIEW_GATES',
      label: 'ARL and RL review gates',
      expectedEvidenceClasses: ['meaning_review', 'rendering_review', 'customer_language_check'],
    },
    {
      stageKey: 'FINAL_ASSET_GOVERNANCE',
      label: 'Change register and final asset governance',
      expectedEvidenceClasses: ['change_register', 'approval_boundary', 'benchmark_comparison_record'],
    },
  ],
  acceptanceDimensions: [
    'stage_coverage',
    'evidence_lineage',
    'contradiction_handling',
    'decision_usefulness',
    'confidence_boundaries',
    'executive_readability',
    'benchmark_asset_availability',
    'comparison_readiness',
  ],
})

export const COMMERCIAL_STRATEGY_DECISION_PAPER_SOURCE_AUTHORITY_REQUIREMENTS = Object.freeze([
  {
    packKey: 'cacr-runtime-pack',
    sourceDocuments: ['CACR_v2.0_Source-Authority_Runtime_Artifact.docx'],
    supportAssetPaths: ['docs/seed-data/support_assets/system-reference-cacr-v2-0-source-authority-runtime-artifact.md'],
  },
  {
    packKey: 'scr-runtime-pack',
    sourceDocuments: ['SCR_v3.0_Source-Authority_Runtime_Artifact.docx'],
    supportAssetPaths: ['docs/seed-data/support_assets/system-reference-scr-v3-0-source-authority-runtime-artifact.md'],
  },
  {
    packKey: 'etl-runtime-pack',
    sourceDocuments: ['ETL_v1.3_RID-01B_Regenerated_Runtime_Candidate.docx'],
    supportAssetPaths: ['docs/seed-data/support_assets/system-reference-etl-v1-3-rid-01b-regenerated-runtime-candidate.md'],
  },
  {
    packKey: 'fx-runtime-pack',
    sourceDocuments: ['FX v2.6 Canonical Specification_.docx'],
    supportAssetPaths: ['docs/seed-data/support_assets/system-reference-fx-v2-6-canonical-specification.md'],
  },
  {
    packKey: 'gx-runtime-pack',
    sourceDocuments: ['GX v2.7 Canonical Specification_.docx'],
    supportAssetPaths: ['docs/seed-data/support_assets/system-reference-gx-v2-7-canonical-specification.md'],
  },
  {
    packKey: 'ec-runtime-pack',
    sourceDocuments: [
      'EC_v1.9_Source-Authority_Runtime_Artifact.docx',
      'ET v2.8 Canonical Execution Translation System.docx',
      'GX v2.7 Canonical Specification_.docx',
      'FX v2.6 Canonical Specification_.docx',
    ],
    supportAssetPaths: [
      'docs/seed-data/support_assets/system-reference-ec-v1-9-source-authority-runtime-artifact.md',
      'docs/seed-data/support_assets/system-reference-et-v2-8-canonical-execution-translation-system.md',
      'docs/seed-data/support_assets/system-reference-gx-v2-7-canonical-specification.md',
      'docs/seed-data/support_assets/system-reference-fx-v2-6-canonical-specification.md',
    ],
  },
  {
    packKey: 'state-runtime-pack',
    sourceDocuments: [
      'RGS v1.0 RENDER GOVERNANCE STATE.docx',
      'STATE_v1.4_Source-Authority_Runtime_Artifact.docx',
    ],
    supportAssetPaths: [
      'docs/seed-data/support_assets/system-reference-rgs-v1-0-render-governance-state.md',
      'docs/seed-data/support_assets/system-reference-state-v1-4-source-authority-runtime-artifact.md',
    ],
  },
  {
    packKey: 'st-runtime-pack',
    sourceDocuments: [
      'CR v1.0 CONTRADICTION REGISTER_.docx',
      'DX v1.6 Commercial Constraint Diagnostic Extension.docx',
      'ET v2.8 Canonical Execution Translation System.docx',
      'OR v1.0 OBSERVATION REGISTER SYSTEM.docx',
      'RGS v1.0 RENDER GOVERNANCE STATE.docx',
      'VE v1.0 - Validation Evidence System.docx',
      'STATE_v1.4_Source-Authority_Runtime_Artifact.docx',
      'ST_v1.8_Master_Source_Derived_Canonical_Runtime.docx',
    ],
    supportAssetPaths: [
      'docs/seed-data/support_assets/system-reference-cr-v1-0-contradiction-register.md',
      'docs/seed-data/support_assets/system-reference-dx-v1-6-commercial-constraint-diagnostic-extension.md',
      'docs/seed-data/support_assets/system-reference-et-v2-8-canonical-execution-translation-system.md',
      'docs/seed-data/support_assets/system-reference-or-v1-0-observation-register-system.md',
      'docs/seed-data/support_assets/system-reference-rgs-v1-0-render-governance-state.md',
      'docs/seed-data/support_assets/system-reference-ve-v1-0-validation-evidence-system.md',
      'docs/seed-data/support_assets/system-reference-state-v1-4-source-authority-runtime-artifact.md',
      'docs/seed-data/support_assets/system-reference-st-v1-8-master-source-derived-canonical-runtime.md',
    ],
  },
])

export const ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS = Object.freeze([
  {
    packKey: 'observation-register',
    sourceSeedPackKey: 'or-runtime-pack',
    packType: 'OR',
    name: 'OR Runtime Knowledge Pack',
    stageKey: 'EVIDENCE_BASELINE',
    kcpStage: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    requiredFor: 'Observation and governed source evidence baseline.',
  },
  {
    packKey: 'validation-evidence',
    sourceSeedPackKey: 've-runtime-pack',
    packType: 'VE',
    name: 'VE Runtime Knowledge Pack',
    stageKey: 'VALIDATION_EVIDENCE_GATES',
    kcpStage: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    requiredFor: 'Validation evidence, proof gates and evidence admissibility.',
  },
  {
    packKey: 'contradiction-register',
    sourceSeedPackKey: 'cr-runtime-pack',
    packType: 'CR',
    name: 'CR Runtime Knowledge Pack',
    stageKey: 'CLAIM_CONTRADICTION_CONTROLS',
    kcpStage: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    requiredFor: 'Claim, contradiction and alternative-explanation controls.',
  },
  {
    packKey: 'cacr-runtime-pack',
    sourceSeedPackKey: 'cacr-runtime-pack',
    packType: 'SYSTEM_REFERENCE',
    name: 'CACR Runtime Knowledge Pack',
    stageKey: 'CLAIM_AUTHORITY_CONTROLS',
    kcpStage: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    requiredFor: 'Claim authority and capability-state controls.',
  },
  {
    packKey: 'scr-runtime-pack',
    sourceSeedPackKey: 'scr-runtime-pack',
    packType: 'SYSTEM_REFERENCE',
    name: 'SCR Runtime Knowledge Pack',
    stageKey: 'SOURCE_CLAIM_RECONCILIATION',
    kcpStage: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    requiredFor: 'Source claim reconciliation and evidence-to-claim alignment.',
  },
  {
    packKey: 'execution-translation',
    sourceSeedPackKey: 'et-runtime-pack',
    packType: 'SYSTEM',
    name: 'ET Runtime Knowledge Pack',
    stageKey: 'EVIDENCE_TO_KNOWLEDGE_HANDOFF',
    kcpStage: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    requiredFor: 'Evidence-to-knowledge translation and handoff.',
  },
  {
    packKey: 'execution-translation-runtime',
    sourceSeedPackKey: 'et-rt-runtime-pack',
    packType: 'SYSTEM',
    name: 'ET-RT Runtime Knowledge Pack',
    stageKey: 'EVIDENCE_TO_KNOWLEDGE_HANDOFF',
    kcpStage: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    requiredFor: 'Runtime evidence-to-knowledge translation.',
  },
  {
    packKey: 'etl-runtime-pack',
    sourceSeedPackKey: 'etl-runtime-pack',
    packType: 'SYSTEM',
    name: 'ETL Runtime Knowledge Pack',
    stageKey: 'EVIDENCE_TO_KNOWLEDGE_HANDOFF',
    kcpStage: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    requiredFor: 'Evidence translation lineage.',
  },
  {
    packKey: 'commercial-clarity-review',
    sourceSeedPackKey: 'ccr-runtime-pack',
    packType: 'CCR',
    name: 'CCR Runtime Knowledge Pack',
    stageKey: 'COMMERCIAL_CLARITY_REVIEW',
    kcpStage: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
    requiredFor: 'Commercial clarity review for decision-paper meaning.',
  },
  {
    packKey: 'commercial-constraint-diagnostics',
    sourceSeedPackKey: 'dx-runtime-pack',
    packType: 'DX',
    name: 'DX Runtime Knowledge Pack',
    stageKey: 'COMMERCIAL_CONSTRAINT_DIAGNOSTIC',
    kcpStage: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
    requiredFor: 'Commercial constraint and diagnostic reasoning.',
  },
  {
    packKey: 'canonical-runtime-model',
    sourceSeedPackKey: 'cdrm-runtime-pack',
    packType: 'CDRM',
    name: 'CDRM Runtime Knowledge Pack',
    stageKey: 'COMMERCIAL_DECISION_REASONING',
    kcpStage: OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
    requiredFor: 'Commercial decision model and recommendation structure.',
  },
  {
    packKey: 'commercial-clarity-dashboard',
    sourceSeedPackKey: 'ccd-runtime-pack',
    packType: 'CCD',
    name: 'CCD Runtime Knowledge Pack',
    stageKey: 'COMMERCIAL_SYSTEM_ANALYSIS',
    kcpStage: OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
    requiredFor: 'Commercial clarity dashboard and system analysis.',
  },
  {
    packKey: 'fx-runtime-pack',
    sourceSeedPackKey: 'fx-runtime-pack',
    packType: 'SYSTEM',
    name: 'FX Runtime Knowledge Pack',
    stageKey: 'FX_VALUE_ASSESSMENT',
    kcpStage: OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
    requiredFor: 'FX economic proof and value assessment.',
  },
  {
    packKey: 'gx-runtime-pack',
    sourceSeedPackKey: 'gx-runtime-pack',
    packType: 'SYSTEM',
    name: 'GX Runtime Knowledge Pack',
    stageKey: 'GX_COMMERCIAL_READINESS',
    kcpStage: OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
    requiredFor: 'GX commercial readiness and go-to-market assessment.',
  },
  {
    packKey: 'ec-runtime-pack',
    sourceSeedPackKey: 'ec-runtime-pack',
    packType: 'SYSTEM',
    name: 'EC Runtime Knowledge Pack',
    stageKey: 'EXECUTION_COMMERCIAL_SYNTHESIS',
    kcpStage: OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
    requiredFor: 'Execution and commercial synthesis across FX/GX methods.',
  },
  {
    packKey: 'state-runtime-pack',
    sourceSeedPackKey: 'state-runtime-pack',
    packType: 'SYSTEM_REFERENCE',
    name: 'STATE Runtime Knowledge Pack',
    stageKey: 'GOVERNED_RUNTIME_STATE',
    kcpStage: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    requiredFor: 'Governed runtime state and stage state.',
  },
  {
    packKey: 'st-runtime-pack',
    sourceSeedPackKey: 'st-runtime-pack',
    packType: 'SYSTEM_REFERENCE',
    name: 'ST Runtime Knowledge Pack',
    stageKey: 'STAGE_STATE_AND_REGISTERS',
    kcpStage: OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    requiredFor: 'Stage state, contradiction, observation and evidence registers.',
  },
  {
    packKey: 'render-governance-state',
    sourceSeedPackKey: 'rgs-runtime-pack',
    packType: 'RGS',
    name: 'RGS Runtime Knowledge Pack',
    stageKey: 'RENDER_GOVERNANCE_STATE',
    kcpStage: OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
    requiredFor: 'Render governance state before final expression.',
  },
  {
    packKey: 'adaptive-reasoning-layer',
    sourceSeedPackKey: 'arl-runtime-pack',
    packType: 'ARL',
    name: 'ARL Runtime Knowledge Pack',
    stageKey: 'ARL_REVIEW',
    kcpStage: OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
    requiredFor: 'Adaptive reasoning layer review.',
  },
  {
    packKey: 'rendering-layer',
    sourceSeedPackKey: 'rl-runtime-pack',
    packType: 'RL',
    name: 'RL Runtime Knowledge Pack',
    stageKey: 'RL_REVIEW',
    kcpStage: OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    requiredFor: 'Rendering layer review of final expression.',
  },
])
