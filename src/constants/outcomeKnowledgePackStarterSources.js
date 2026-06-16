export const OUTCOME_KNOWLEDGE_PACK_STARTER_SOURCES = Object.freeze({
  'ARL:adaptive-reasoning-layer': Object.freeze({
    packType: 'ARL',
    packKey: 'adaptive-reasoning-layer',
    semanticVersion: '1.0.0',
    schemaVersion: '1.0.0',
    sourceFilename: 'adaptive-reasoning-layer-v1.yaml',
    content: `# StorylineOS Knowledge Pack
# Adaptive Reasoning Layer v1.0
# Status: Draft starter pack
# Owner: StorylineOS Architecture
# Purpose: Govern reasoning over Certified Runtime Truth without exposing internal reasoning.

pack:
  key: adaptive-reasoning-layer
  name: Adaptive Reasoning Layer
  version: "1.0"
  status: ACTIVE
  principle: >
    The Adaptive Reasoning Layer interprets certified runtime truth, user intent,
    source output lineage, and knowledge-pack constraints. It must not create new
    truth, override unresolved limitations, or expose internal reasoning.

inputs:
  required:
    - certified_runtime_truth
    - truth_signature
    - runtime_revision
    - source_output
    - output_schema
    - truth_certification
    - user_prompt
  optional:
    - prior_session_messages
    - known_gaps
    - warnings
    - limitations

truth_binding_rules:
  must_preserve:
    - truth_signature_id
    - runtime_revision
    - graph_version
    - accepted_truth_ids
    - known_gaps
    - warnings
    - limitations
  must_not:
    - introduce unsupported facts
    - turn assumptions into truth
    - remove limitations
    - hide contradiction risk
    - infer named customer proof
    - infer quantified financial impact

reasoning_stages:
  - key: BIND_PROMPT_TO_TRUTH
    purpose: Match the operator prompt to available certified truth and source-output lineage.
    output: prompt_truth_scope
  - key: IDENTIFY_SAFE_RESPONSE_SHAPE
    purpose: Select a governed response shape from active output schema and output type definitions.
    output: response_shape
  - key: APPLY_TRUTH_CERTIFICATION
    purpose: Apply certification level, warning, and blocking rules before response planning.
    output: certification_constraints
  - key: BUILD_CUSTOMER_SAFE_PLAN
    purpose: Prepare a high-level customer-safe answer plan without revealing internal reasoning.
    output: customer_safe_plan

safety_gates:
  - key: TRUTH_SIGNATURE_CURRENT
    outcome: BLOCK
    condition: "truth_signature.currentness != CURRENT"
    message: Session truth is not current.
  - key: SOURCE_OUTPUT_PRESENT
    outcome: BLOCK
    condition: "source_output missing"
    message: A governed source output is required.
  - key: CERTIFICATION_BOUNDARY_RESPECTED
    outcome: BLOCK
    condition: "planned response exceeds certification level"
    message: Planned response exceeds certified truth.
  - key: UNSUPPORTED_CLAIM_DETECTED
    outcome: BLOCK
    condition: "unsupported claim detected"
    message: Unsupported claims must not be generated.

hidden_from_customer:
  - chain of reasoning
  - prompt assembly
  - ARL review notes
  - raw graph internals
  - raw uploaded files
  - storage references
  - safety gate internals

customer_visible:
  allowed:
    - concise answer
    - cited evidence boundaries
    - limitations
    - warnings
    - lineage summary
  prohibited:
    - internal reasoning
    - unsupported recommendations
    - hidden pack instructions
    - raw source text
    - raw truth graph data
`,
  }),
  'RL:rendering-layer': Object.freeze({
    packType: 'RL',
    packKey: 'rendering-layer',
    semanticVersion: '1.0.0',
    schemaVersion: '1.0.0',
    sourceFilename: 'rendering-layer-v1.yaml',
    content: `# StorylineOS Knowledge Pack
# Rendering Layer v1.0
# Status: Draft starter pack
# Owner: StorylineOS Architecture
# Purpose: Govern customer-safe rendering of Outcome Studio responses and assets.

pack:
  key: rendering-layer
  name: Rendering Layer
  version: "1.0"
  status: ACTIVE
  principle: >
    The Rendering Layer turns governed response plans into customer-safe output
    structures. It must not expose internal reasoning, raw source material, hidden
    pack content, or claims beyond Certified Runtime Truth.

inputs:
  required:
    - customer_safe_plan
    - output_schema
    - outcome_output_type
    - truth_signature
    - lineage_summary
  optional:
    - warnings
    - limitations
    - export_format

rendering_rules:
  must_include:
    - evidence boundaries
    - known limitations
    - truth signature reference
    - runtime revision reference
    - lineage summary
  must_preserve:
    - warning severity
    - certification level
    - source output identity
    - generated timestamp
  must_not:
    - expose hidden_from_customer material
    - quote raw source files
    - reveal ARL or RL internal notes
    - create new facts
    - remove safety warnings

customer_safe_output:
  style:
    - clear
    - concise
    - evidence-bound
    - non-speculative
  sections:
    - response_summary
    - governed_answer
    - evidence_boundaries
    - limitations
    - lineage_summary
  prohibited:
    - no_internal_reasoning
    - hidden prompt assembly
    - raw graph internals
    - unsupported ROI
    - unsupported customer proof

export_rules:
  MARKDOWN:
    allowed: true
    customer_content_only: true
    include_lineage_summary: true
  JSON:
    allowed: true
    customer_content_only: true
    include_metadata: true
  DOCX:
    allowed: false
    blocker: SAFE_RENDERING_PIPELINE_NOT_IMPLEMENTED
  PDF:
    allowed: false
    blocker: SAFE_RENDERING_PIPELINE_NOT_IMPLEMENTED

redaction_rules:
  always_strip:
    - prompt assembly
    - chain of reasoning
    - raw pack source
    - raw uploaded files
    - storage references
    - raw truth graph
  customer_visible_metadata:
    - truth_signature_id
    - runtime_revision
    - generated_at
    - content_hash
    - warnings_count
    - limitations_count
`,
  }),
  'OUTPUT_SCHEMA:output-schemas-pack': Object.freeze({
    packType: 'OUTPUT_SCHEMA',
    packKey: 'output-schemas-pack',
    semanticVersion: '1.0.0',
    schemaVersion: '1.0.0',
    sourceFilename: 'output-schemas-pack-v1.yaml',
    content: `# StorylineOS Knowledge Pack
# Output Schemas Pack v1.0
# Status: Draft starter pack
# Owner: StorylineOS Architecture
# Purpose: Provide Output Lab and Outcome Studio with governed output structures.

pack:
  key: output-schemas-pack
  name: Output Schemas Pack
  version: "1.0"
  status: ACTIVE
  principle: >
    Output schemas define structure, required sections, evidence boundaries and
    allowed rendering behaviour. Schemas do not create truth and must not allow
    outputs to exceed accepted runtime truth.

global_rules:
  must_preserve:
    - evidence_boundaries
    - limitations
    - warnings
    - lineage_summary
    - truth_signature
    - runtime_revision
    - known_gaps
  must_not_introduce:
    - new facts
    - new proof
    - new customers
    - new products
    - new financial values
    - category leadership claims
    - proprietary advantage claims
    - quantified ROI
    - unsupported recommendations
  hidden_from_customer:
    - ARL review notes
    - RL internal gates
    - prompt assembly
    - chain of reasoning
    - raw graph internals
    - raw uploaded files
    - storage references

schemas:
  EXECUTIVE_BRIEF:
    label: Executive Brief
    purpose: Concise executive summary of governed runtime truth.
    audience:
      - Executive stakeholders
      - Senior decision owners
    tone:
      - clear
      - concise
      - decision-oriented
      - commercially grounded
    required_sections:
      - Executive Summary
      - Current Situation
      - Strategic Problem
      - Value Opportunity
      - Supporting Evidence
      - Key Risks And Gaps
      - Recommended Focus
      - Limitations
      - Lineage Summary
    optional_sections:
      - Truth Certification
      - Output Warnings
    allowed:
      - summarise certified truth
      - explain commercial relevance
      - surface known gaps
      - preserve uncertainty
    prohibited:
      - invent ROI
      - invent customer proof
      - overstate market validation
      - remove warnings

  SALES_NARRATIVE:
    label: Sales Narrative
    purpose: Customer-facing commercial narrative derived from accepted truth.
    audience:
      - Sales teams
      - Customer-facing stakeholders
      - Commercial leaders
    tone:
      - polished
      - customer-facing
      - evidence-bound
      - practical
    required_sections:
      - Opening Position
      - Customer Pain
      - Value Story
      - Proof Points
      - Conversation Guide
      - Evidence Boundaries
      - Limitations And Gaps
      - Warnings
      - Lineage Summary
    optional_sections:
      - Recommended Discovery Questions
      - Messaging Notes
    allowed:
      - improve readability
      - create customer-safe sequencing
      - make evidence-supported themes easier to communicate
    prohibited:
      - turn nearest accepted truth into direct customer evidence
      - create unsupported proof points
      - convert conversation guide into validated sales playbook
      - introduce named customers or metrics

  COMMERCIAL_ASSESSMENT:
    label: Commercial Assessment
    purpose: Assess commercial strength, risks, gaps and readiness from governed truth.
    audience:
      - Revenue leaders
      - Strategy stakeholders
      - Product or GTM owners
    tone:
      - analytical
      - balanced
      - explicit about uncertainty
      - decision-safe
    required_sections:
      - Assessment Summary
      - Commercial Strengths
      - Evidence Support
      - Key Gaps
      - Contradictions Or Risks
      - Readiness View
      - Implications
      - Limitations
      - Lineage Summary
    optional_sections:
      - Truth Certification
      - Suggested Next Evidence
    allowed:
      - identify gaps
      - explain readiness constraints
      - describe implications without prescribing unsupported action
    prohibited:
      - claim investment readiness without support
      - create strategic recommendations beyond truth
      - hide contradictions
      - treat low coverage as high certainty

  BOARD_SUMMARY:
    label: Board Summary
    purpose: Executive-level board briefing derived from certified truth.
    audience:
      - Board
      - Founder
      - Executive committee
      - Investors
    tone:
      - executive
      - concise
      - risk-aware
      - non-marketing
    required_sections:
      - Board-Level Summary
      - Strategic Context
      - Decision Relevance
      - Evidence Base
      - Material Risks
      - Open Questions
      - Limitations
      - Lineage Summary
    optional_sections:
      - Certification Level
      - Decision Confidence
    allowed:
      - elevate material issues
      - explain decision relevance
      - preserve uncertainty
    prohibited:
      - marketing language
      - unsupported recommendations
      - unsupported market leadership claims
      - financial projections unless certified truth contains them

derived_asset_starter_schemas:
  CUSTOMER_PROPOSAL:
    label: Customer Proposal
    source_required:
      - SALES_NARRATIVE
      - EXECUTIVE_BRIEF
    required_sections:
      - Introduction
      - Customer Context
      - Problem And Opportunity
      - Proposed Value Narrative
      - Evidence Boundaries
      - Next Discussion Areas
      - Limitations
    prohibited:
      - contractual commitments
      - pricing or ROI unless provided in certified truth
      - new implementation promises
  ONE_PAGER:
    label: One Pager
    source_required:
      - EXECUTIVE_BRIEF
      - SALES_NARRATIVE
    required_sections:
      - Headline
      - Situation
      - Value Themes
      - Evidence Boundaries
      - Why It Matters
      - Limitations
    prohibited:
      - slogan-only language
      - unsupported differentiation
  WEBSITE_COPY:
    label: Website Copy
    source_required:
      - SALES_NARRATIVE
    required_sections:
      - Hero Message
      - Problem Statement
      - Value Themes
      - Proof Boundary
      - Safe Call To Action
    prohibited:
      - superlatives without evidence
      - category leadership claims
      - invented customer outcomes
  SALES_EMAIL:
    label: Sales Email
    source_required:
      - SALES_NARRATIVE
    required_sections:
      - Subject Line
      - Opening
      - Relevance Statement
      - Value Theme
      - Soft Call To Action
      - Limitation Note
    prohibited:
      - aggressive claims
      - quantified benefits unless certified
      - false familiarity
`,
  }),
  'TRUTH_CERTIFICATION:truth-certification-pack': Object.freeze({
    packType: 'TRUTH_CERTIFICATION',
    packKey: 'truth-certification-pack',
    semanticVersion: '1.0.0',
    schemaVersion: '1.0.0',
    sourceFilename: 'truth-certification-pack-v1.yaml',
    content: `# StorylineOS Knowledge Pack
# Truth Certification Pack v1.0
# Status: Draft starter pack
# Owner: StorylineOS Architecture
# Purpose: Provide Outcome Studio with governed truth-quality and certification rules.

pack:
  key: truth-certification-pack
  name: Truth Certification Pack
  version: "1.0"
  status: ACTIVE
  applies_to:
    - Output Lab
    - Outcome Studio
    - Runtime Workspace
    - Truth Signature
  principle: >
    Truth certification describes how much confidence StorylineOS can place in
    governed runtime truth. It must not create new truth, override accepted truth,
    or convert limitations into proof.

inputs:
  required:
    - accepted_truth_count
    - required_truth_count
    - evidence_count
    - source_count
    - coverage_score
    - confidence_score
    - source_diversity_score
    - contradiction_count
    - unresolved_contradiction_count
    - graph_version
    - runtime_revision
    - publish_snapshot_id
    - lock_snapshot_id
    - replay_anchor_id
  optional:
    - materiality_score
    - decision_impact_score
    - known_gaps
    - readiness_state
    - acquisition_profile

quality_dimensions:
  coverage:
    description: Breadth of discovered and accepted intelligence.
    bands:
      LOW: "0-39"
      MEDIUM: "40-69"
      HIGH: "70-89"
      VERY_HIGH: "90-100"
  confidence:
    description: Strength of support behind accepted truth.
    bands:
      LOW: "0-39"
      MEDIUM: "40-69"
      HIGH: "70-89"
      VERY_HIGH: "90-100"
  source_diversity:
    description: Diversity of evidence sources supporting accepted truth.
    bands:
      LOW: "single source or narrow source type"
      MEDIUM: "multiple sources but limited source-type diversity"
      HIGH: "multiple sources across different source types"
      VERY_HIGH: "broad independent source-type diversity"
  contradiction_risk:
    description: Risk created by unresolved contradiction candidates.
    values:
      LOW: "No unresolved contradiction candidates"
      MEDIUM: "Minor unresolved contradiction candidates"
      HIGH: "Material contradiction candidates require review"
      BLOCKING: "Contradictions prevent safe certification"

certification_levels:
  EVIDENCE_PRESENT:
    label: Evidence Present
    minimum_requirements:
      coverage_score: ">=20"
      accepted_truth_count: ">0"
      evidence_count: ">0"
    meaning: Basic evidence exists, but truth should be treated as early-stage.
    output_instruction: Preserve uncertainty. Avoid strong claims.
  EVIDENCE_SUPPORTED:
    label: Evidence Supported
    minimum_requirements:
      coverage_score: ">=40"
      confidence_band: "MEDIUM or higher"
      unresolved_contradiction_risk: "not HIGH or BLOCKING"
    meaning: Accepted truth has useful support but may still contain important gaps.
    output_instruction: Render cautiously. Keep known gaps visible.
  CERTIFIED_TRUTH:
    label: Certified Truth
    minimum_requirements:
      coverage_score: ">=70"
      confidence_band: "HIGH or higher"
      source_diversity_band: "MEDIUM or higher"
      contradiction_risk: "LOW or MEDIUM"
      publish_snapshot_id: "present"
      lock_snapshot_id: "present"
      replay_anchor_id: "present"
    meaning: Truth is suitable for governed downstream outputs.
    output_instruction: Render confidently but do not exceed evidence boundaries.
  STRATEGIC_TRUTH:
    label: Strategic Truth
    minimum_requirements:
      coverage_score: ">=85"
      confidence_band: "HIGH or VERY_HIGH"
      source_diversity_band: "HIGH or VERY_HIGH"
      contradiction_risk: "LOW"
      publish_snapshot_id: "present"
      lock_snapshot_id: "present"
      replay_anchor_id: "present"
    meaning: Truth is strong enough for strategic outputs, subject to preserved limitations.
    output_instruction: Suitable for executive-level narrative, but no unsupported claims.

blocking_rules:
  - key: MISSING_ACCEPTED_TRUTH
    condition: "accepted_truth_count < required_truth_count"
    outcome: BLOCK
    message: Accepted truth is incomplete.
  - key: MISSING_LOCK_PROOF
    condition: "lock_snapshot_id missing OR replay_anchor_id missing"
    outcome: BLOCK
    message: Locked truth proof is missing.
  - key: UNRESOLVED_BLOCKING_CONTRADICTIONS
    condition: "contradiction_risk == BLOCKING"
    outcome: BLOCK
    message: Contradictions require review before certification.
  - key: RAW_GRAPH_UNSAFE
    condition: "raw graph leakage risk detected"
    outcome: BLOCK
    message: Raw graph internals must not be exposed.

warnings:
  LOW_COVERAGE:
    condition: "coverage_score < 70"
    instruction: State that coverage gaps remain.
  LOW_CONFIDENCE:
    condition: "confidence_band in [LOW, MEDIUM]"
    instruction: Preserve uncertainty and avoid definitive claims.
  LOW_SOURCE_DIVERSITY:
    condition: "source_diversity_band == LOW"
    instruction: Avoid claiming independent validation.
  CONTRADICTIONS_PRESENT:
    condition: "contradiction_count > 0"
    instruction: Do not remove or smooth over unresolved contradictions.
  NO_CUSTOMER_PROOF:
    condition: "customer proof missing"
    instruction: Do not claim customer outcomes, named proof, or validated impact.
  NO_QUANTIFIED_ECONOMICS:
    condition: "economic proof missing"
    instruction: Do not introduce ROI, financial values, or quantified outcomes.

prohibited_output_claims:
  - Proven ROI
  - Guaranteed outcomes
  - Market-leading
  - Category-defining
  - Independently validated proprietary advantage
  - Named customer proof unless present in accepted truth
  - Quantified financial impact unless present in accepted truth
  - External market validation unless present in accepted truth

export_metadata:
  include:
    - certification_level
    - coverage_score
    - confidence_score
    - source_diversity_score
    - contradiction_risk
    - truth_signature_id
    - runtime_revision
    - graph_version
    - known_gaps
`,
  }),
  'OUTPUT_TYPE_DEFINITION:outcome-output-types': Object.freeze({
    packType: 'OUTPUT_TYPE_DEFINITION',
    packKey: 'outcome-output-types',
    semanticVersion: '1.0.0',
    schemaVersion: '1.0.0',
    sourceFilename: 'outcome-output-types-v1.yaml',
    content: `# StorylineOS Knowledge Pack
# Outcome Output Types v1.0
# Status: Draft starter pack
# Owner: StorylineOS Architecture
# Purpose: Define governed Outcome Studio output and asset types.

pack:
  key: outcome-output-types
  name: Outcome Output Types
  version: "1.0"
  status: ACTIVE
  principle: >
    Output type definitions describe the allowed generated response and asset
    categories for Outcome Studio. They must not create truth, bypass safety
    gates, or make publish/export behavior available before governance is ready.

output_types:
  GOVERNED_RESPONSE:
    label: Governed Response
    purpose: Session-bound assistant response over Certified Runtime Truth.
    requires:
      - active_outcome_session
      - current_truth_signature
      - active_arl_pack
      - active_rl_pack
      - output_schema
      - truth_certification
    supported_formats:
      - INLINE_TEXT
    publishable: false
    prohibited:
      - hidden reasoning
      - unsupported claims
      - raw source text
  OUTCOME_ASSET:
    label: Outcome Asset
    purpose: Versioned governed asset generated from an approved response.
    requires:
      - governed_response
      - lineage_summary
      - current_truth_signature
      - current_version
    supported_formats:
      - MARKDOWN
      - JSON
    publishable: true
    prohibited:
      - draft response body without governance
      - internal reasoning
      - unbound source output

asset_types:
  CUSTOMER_PROPOSAL:
    source_output_types:
      - SALES_NARRATIVE
      - EXECUTIVE_BRIEF
    supported_formats:
      - MARKDOWN
      - JSON
    publish_requirements:
      - current_truth_signature
      - generated_asset_version
      - safety_gates_passed
      - publish_audit_persisted
  ONE_PAGER:
    source_output_types:
      - EXECUTIVE_BRIEF
      - SALES_NARRATIVE
    supported_formats:
      - MARKDOWN
      - JSON
    publish_requirements:
      - current_truth_signature
      - generated_asset_version
      - safety_gates_passed
  WEBSITE_COPY:
    source_output_types:
      - SALES_NARRATIVE
    supported_formats:
      - MARKDOWN
      - JSON
    publish_requirements:
      - current_truth_signature
      - generated_asset_version
      - no_unsupported_claims
  SALES_EMAIL:
    source_output_types:
      - SALES_NARRATIVE
    supported_formats:
      - MARKDOWN
      - JSON
    publish_requirements:
      - current_truth_signature
      - generated_asset_version
      - no_false_familiarity

supported_formats:
  INLINE_TEXT:
    customer_content_only: true
    exportable: false
  MARKDOWN:
    customer_content_only: true
    exportable: true
  JSON:
    customer_content_only: true
    exportable: true
  DOCX:
    customer_content_only: true
    exportable: false
    blocker: SAFE_RENDERING_PIPELINE_NOT_IMPLEMENTED
  PDF:
    customer_content_only: true
    exportable: false
    blocker: SAFE_RENDERING_PIPELINE_NOT_IMPLEMENTED

publish_requirements:
  must_have:
    - current_truth_signature
    - generated_asset_version
    - lineage_summary
    - safety_gates_passed
    - audit_persisted
  must_not:
    - publish stale truth
    - publish missing customer content
    - publish internal reasoning
    - publish raw pack source
    - publish unreviewed unsupported claims
`,
  }),
})
