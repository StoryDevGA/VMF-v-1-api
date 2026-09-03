# Executive Brief Schema

## Purpose

Define the required structure for a concise executive summary of governed runtime truth, suitable for senior stakeholders who need a decision-relevant view of the situation, opportunity, evidence, risk, and next focus.

## Description

Defines the governed structure, section requirements, validation rules, and allowed transformations for a concise executive briefing derived from certified runtime truth.

## Governing Principles

This schema governs structure and presentation only. It does not create truth and must not permit an output to exceed accepted runtime truth.

Every output produced with this schema must preserve:

- Evidence boundaries
- Known limitations
- Active warnings
- Lineage summary
- Current truth signature reference
- Current runtime revision reference
- Known gaps

The output must not introduce:

- New facts, proof, customers, products, or financial values
- Category leadership or proprietary advantage claims unless supported by accepted truth
- Quantified ROI or financial impact unless supported by accepted truth
- Unsupported recommendations

The output must not expose internal reasoning, prompt assembly, review notes, raw graph internals, raw uploaded files, or storage references.

## Intended Audience

- Executive stakeholders
- Senior decision owners

## Presentation Character

- Clear
- Concise
- Decision-oriented
- Commercially grounded

## Required Sections

### Executive Summary

State the central conclusion or decision-relevant message supported by accepted truth. Keep the summary brief and do not introduce claims that are not substantiated elsewhere in the output.

### Current Situation

Summarise the relevant present-state context established by accepted truth, including material conditions that frame the decision.

### Strategic Problem

Describe the principal problem, constraint, or unresolved issue supported by the evidence. Preserve uncertainty where the problem definition is incomplete.

### Value Opportunity

Explain the opportunity indicated by accepted truth. Do not quantify value unless the underlying economic evidence is certified.

### Supporting Evidence

Present the strongest accepted evidence supporting the brief. Distinguish evidence from inference and preserve source limitations.

### Key Risks and Gaps

Identify material risks, missing evidence, unresolved contradictions, and known gaps that affect confidence or actionability.

### Recommended Focus

State the areas that deserve attention based on the accepted truth. This section may prioritise focus but must not prescribe unsupported action.

### Limitations

State the boundaries of the available truth and any constraints on interpretation or use.

### Lineage Summary

Provide a customer-safe summary of the governed source lineage and runtime context used to generate the brief.

## Optional Sections

### Truth Certification

Include the applicable certification level and its meaning when certification context is required.

### Output Warnings

Include active warnings that materially affect interpretation or use of the brief.

## Validation Requirements

A valid output must:

- Include every required section, unless a governed runtime rule explicitly permits omission.
- Keep required sections substantively distinct rather than using one section to substitute for another.
- Preserve warnings, limitations, known gaps, and evidence boundaries that materially affect interpretation.
- Remain traceable to the current truth signature, runtime revision, and governed source lineage.
- Use only claims supported by accepted truth and the applicable certification level.
- Avoid exposing internal reasoning or restricted runtime content.

## Allowed Transformations

- Summarise certified truth
- Explain commercial relevance
- Surface known gaps
- Preserve uncertainty
- Reorder supporting detail within sections when meaning and governance are preserved

## Prohibited Behaviour

- Invent ROI or financial impact
- Invent customer proof
- Overstate market validation
- Remove warnings, limitations, or known gaps
- Convert tentative evidence into definitive executive claims
- Use promotional language that exceeds the evidence

## Dependencies

- Truth Certification Framework
- Evidence Boundary Rules
- Lineage Preservation Rules
- Prohibited Output Claims

## Runtime Consumers

- Outcome Studio
- Output Lab
- Governed Reasoning Runtime

## Source Relationships

This schema was normalised from the legacy StorylineOS Output Schemas catalogue. Shared truth, evidence, warning, lineage, redaction, and prohibited-claim rules are referenced as dependencies rather than duplicated in full.
