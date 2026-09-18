---
knowledgeAssetId: OSC-025
capabilityKey: commercial-strategy-and-decision-paper-schema
name: Commercial Strategy and Decision Paper Schema
version: 1.0.1
status: DRAFT
familyId: KPF-002
family: Output Schemas
packType: OUTPUT_SCHEMA
purposeCategory: OUTPUT
knowledgeLayer: OUTPUT_SCHEMA
executionMode: PROVIDER_CONTEXT
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
runtimeRole: OUTPUT_SCHEMA
relationshipContractVersion: SS002_RELATIONSHIP_V1
compatibleOutputTypes:
  - OT-023
relationships:
  - relationshipType: COMPATIBLE_WITH
    targetPackType: OUTPUT_TYPE_DEFINITION
    targetKnowledgeAssetId: OT-023
    requiredAt: NONE
    cardinality: ZERO_OR_MORE
dependencyReferences:
  - relationshipType: COMPATIBLE_WITH
    targetKnowledgeAssetId: OT-023
    requiredAt: NONE
    cardinality: ZERO_OR_MORE
sourceFormat: MARKDOWN
sourceReferences:
  - KPS-001
  - OST-001
  - KPF-002
  - OT-023
lineage: governed_output_schema_pack
knowledgeScope: GENERAL_REUSABLE
repositoryReference: https://drive.google.com/file/d/1QzLcc3lLUrtkeUHZISYxy20GmL8-2YE_/view
clickUpReference: https://app.clickup.com/t/12493t4gvye
created: 2026-09-14
updated: 2026-09-14
verified: 2026-09-14
importDescription: >-
  Defines the governed structure, ordering and validation rules for Commercial
  Strategy and Decision Paper outputs, including the decision requested,
  commercial diagnosis, evidence boundaries, value and economic pathways,
  risks, guardrails, confidence and next gating actions.
tags:
  - output-schema
  - commercial-strategy
  - decision-paper
---

# Commercial Strategy and Decision Paper Schema

## Purpose

Defines the structural contract for a Commercial Strategy and Decision Paper
that enables an authorised decision-maker to evaluate a commercial course and
take an explicit governed decision.

## Scope

This pack owns section order, required and optional content, conditional logic
and validation rules. It does not own commercial facts, customer evidence,
business intent, audience behaviour, writing style, language, visuals, brand or
delivery-channel rules.

## Required structure

1. **Title and decision context** — identify the subject, decision horizon and
   intended decision authority.
2. **Executive conclusion** — state the central conclusion, confidence and
   immediate implication.
3. **Decision requested** — state the decision, authority and permitted
   alternatives.
4. **Current reality and evidence state** — separate represented position,
   observed evidence, inference, uncertainty and withheld conclusions.
5. **Commercial diagnosis** — describe the relevant condition, consequence,
   value logic and material constraints.
6. **Decision boundaries** — state what the evidence does and does not support.
7. **Value and economic pathways** — describe measurable hypotheses, required
   inputs, assumptions, ranges and attribution boundaries.
8. **Target context and stakeholders** — identify applicable account or
   organisational conditions and decision participants when supplied.
9. **Recommended course and progression** — specify actions, sequencing,
   ownership and decision gates.
10. **Risks and guardrails** — show strategic, evidence, delivery and governance
    risks with their mitigations or restrictions.
11. **Decisions to approve and withhold** — distinguish authorised design or
    preparation from actions that remain restricted.
12. **Confidence and evidence requirements** — state confidence by material
    conclusion and the evidence needed to raise or reduce it.
13. **Next legal downstream action** — identify the next permitted step and its
    owner or approval boundary.
14. **Source and lineage record** — preserve sources, dates, versions and
    relevant evidence restrictions.

## Conditional logic

- Include economic analysis only when financial or operational inputs are
  available; otherwise identify the missing inputs and do not invent values.
- Include account-specific stakeholders, systems or timelines only when supplied
  as governed evidence.
- Include an approval or activation decision only when the authorised decision
  boundary is explicit.
- Include expansion or future capability content only with clear state labels,
  dates and evidence restrictions.
- Include confidence statements for every material recommendation or claim.

## Validation rules

- The requested decision and decision authority are explicit.
- The executive conclusion is consistent with the detailed evidence state.
- Facts, inferences, recommendations, assumptions and open questions are
  distinguishable.
- Every material claim has an identified source, method, scope or restriction.
- Economic pathways show assumptions, counterfactuals and transition boundaries.
- Risks, guardrails, withheld conclusions and next gates are visible.
- No section implies that design approval authorises operational execution,
  publication or commercial activation.
- The output uses this schema only with compatible Output Type OT-023.

## Prohibited structure

Do not use this schema to create a generic marketing narrative, unsupported
business case, unqualified ROI claim, product brochure, customer proof record
or operational authorisation. Those responsibilities require separate governed
packs and evidence.
