---
knowledgeAssetId: OT-023
capabilityKey: commercial-strategy-and-decision-paper
name: Commercial Strategy and Decision Paper
version: 1.0.1
status: DRAFT
familyId: KPF-001
family: Output Types
packType: OUTPUT_TYPE_DEFINITION
purposeCategory: OUTPUT
knowledgeLayer: OUTPUT_TYPE
executionMode: PROVIDER_CONTEXT
boundary: OUTPUT_TYPE_SEMANTIC_INTENT
visibility: PLATFORM
owner: StorylineOS
classification: Internal Controlled
targetVersion: Shared
workspaceModule: Knowledge Library
sprintRelease: Unscheduled
workspaceCompatibility:
  - OUTCOME
runtimeConsumers:
  - Outcome Studio
runtimeRole: OUTPUT_INTENT
relationshipContractVersion: SS002_RELATIONSHIP_V1
relationships:
  - relationshipType: REQUIRES_COMPATIBLE_PACK
    targetPackType: OUTPUT_SCHEMA
    requiredAt: RUNTIME
    cardinality: ONE_OR_MORE
  - relationshipType: COMPOSES_WITH
    targetPackType: AUDIENCE
    requiredAt: RUNTIME
    cardinality: ZERO_OR_MORE
  - relationshipType: COMPOSES_WITH
    targetPackType: STYLE
    requiredAt: RUNTIME
    cardinality: ZERO_OR_MORE
  - relationshipType: COMPOSES_WITH
    targetPackType: LANGUAGE
    requiredAt: RUNTIME
    cardinality: ZERO_OR_MORE
  - relationshipType: COMPOSES_WITH
    targetPackType: VISUAL_SYSTEM
    requiredAt: RUNTIME
    cardinality: ZERO_OR_MORE
dependencyReferences:
  - relationshipType: REQUIRES_COMPATIBLE_PACK
    targetPackType: OUTPUT_SCHEMA
    requiredAt: RUNTIME
    cardinality: ONE_OR_MORE
sourceFormat: MARKDOWN
sourceReferences:
  - Parlon Commercial Strategy and Decision Paper v2.0 FINAL.docx
  - KPS-001
  - OST-001
  - KPF-001
lineage: general_reusable_method_derived_from_customer_example
knowledgeScope: GENERAL_REUSABLE
repositoryReference: https://drive.google.com/file/d/1arrkDId1WHhDE4g49bRZfB0QPzKVJcT3/view
clickUpReference: https://app.clickup.com/t/12493t4gvwc
created: 2026-09-14
updated: 2026-09-14
verified: 2026-09-14
tags:
  - output-type
  - commercial-strategy
  - decision-paper
---

# Commercial Strategy and Decision Paper

## Purpose

This Output Type defines a governed commercial strategy and decision paper that
converts a commercial diagnosis into an evidence-bounded decision, with clear
approval boundaries, economic logic, risks, confidence and next gating actions.
It is intended for leadership and decision owners who must determine whether to
approve, restrict, re-observe or stop a commercial course.

## Owned scope

This pack owns the semantic intent of a decision-oriented commercial strategy
paper: the decision requested, the commercial context, evidence and confidence
boundaries, value and economic pathways, decision criteria, risks, guardrails,
recommended course and explicit next gates.

It does not own customer facts, product claims, market evidence, financial
figures, industry context, detailed section structure, writing style, audience
behaviour, visual treatment, language or delivery-channel rules.

## Required outcome

The resulting asset must help an authorised decision-maker understand the
commercial situation, distinguish supported evidence from assumptions, evaluate
the implications and take an explicit governed decision or next action.

## Runtime behaviour

1. Resolve this Output Type when the requested outcome is a commercial strategy
   and decision paper rather than a general assessment, plan or board paper.
2. Resolve one or more compatible active Output Schemas at runtime.
3. Compose the semantic intent with applicable Audience, Style, Language and
   Visual System packs.
4. Separate represented position, observed evidence, inference, recommendation,
   uncertainty and withheld conclusions.
5. Present the decision requested, decision boundaries, value pathways,
   economic implications, risks, confidence and next gating events.
6. Preserve customer and source authority boundaries; do not strengthen claims
   beyond their evidence or convert design approval into operational permission.
7. Emit a governed decision-support asset that can be reviewed and approved
   independently of its source document.

## Compatibility and relationships

This Output Type requires a compatible Output Schema at runtime. Audience,
Style, Language and Visual System packs may be composed when applicable. VMF,
Standards and Communication Pattern packs may provide supporting reasoning or
expression guidance. These are runtime composition relationships, not activation
dependencies.

## Governance and prohibited behaviour

- Do not invent market, customer, product, financial or performance claims.
- Do not present a coherent proposition as validated demand or repeatability.
- Do not use generic ROI, TCO, savings, payback or timing claims as evidence.
- Do not hide contradictions, null cases, unresolved evidence or withheld
  decisions.
- Do not imply that a design recommendation authorises operational execution,
  publication or commercial activation.
- Do not infer an audience, decision owner, approval status or source authority.
- Do not expose internal prompts, reasoning or restricted source material.

## Validation and acceptance criteria

- The requested decision and intended decision-maker are explicit.
- The asset distinguishes evidence, inference, recommendation and uncertainty.
- Commercial and economic statements retain source, method, scope and confidence
  boundaries.
- Risks, guardrails, decision gates and withheld actions are visible.
- A compatible active Output Schema is resolved at runtime.
- No customer-specific facts from the derivation source are embedded unless
  separately supplied as governed evidence.
- The asset remains suitable for review, approval and later evidence updates.

## Future evolution

Create a new version only when the semantic purpose or decision responsibility
changes materially. Add specialised Output Types only when their decision
intent cannot be represented by this contract or an existing governed type.
