# VMF VE02 — Grading, Aggregation and Evidence Direction Clarification v1.0

**Lifecycle:** VE02-owner **APPROVED / LOCKED engineering clarification** on 8 October 2026. **Not a Bundle 02 runtime amendment, installation, activation or production enablement.**

**Semantic owner:** VE02 / Bundle 02. **Governing activated runtime:** Bundle 02 v1.4 / STATE v1.6 / DDS v1.8 — VE02RC001. **Machine contract:** `VMF.VE02.EvidenceAssessmentResult` schema `1.0`, unchanged. **Downstream purpose:** StorylineOS SS-038 reference implementation and synthetic QMF assessment tests.

**Approved scope:** The project owner approved `VE02-GRADE-001 v0.1` together with the fail-closed correction in `VE02-GRADE-001-RVW-01 v0.1`, 2026-10-08. Preserve the existing result schema, ownership, lineage/currentness requirements, non-numeric assessment, and all adjacent owners. This document is the bounded normative clarification for grading and aggregation, not a new hypothesis-confidence method.

## 1. Contract and allowed values

Four dimension fields: `source_reliability`, `relevance`, `specificity`, `independence`, each `STRONG | MODERATE | WEAK | INSUFFICIENT | UNRESOLVED`.

`assessment_result`: `STRONG | MODERATE | WEAK | CONTRADICTORY | INSUFFICIENT`.

`evidence_direction`: `SUPPORTS | CONTRADICTS | MIXED | NEUTRAL | UNRESOLVED`.

`result_status`: `COMPLETE | UNRESOLVED | INVALID`.

All **19** required schema v1.0 fields remain: `contract_id`, `schema_version`, `result_id`, `result_status`, `evidence_id`, `evidence_revision_ref`, `runtime_owner`, `runtime_version_ref`, `assessed_at`, the four dimension fields, `assessment_result`, `evidence_direction`, `assessment_reasons`, `restrictions`, `contradiction_refs`, `provenance_refs`.

`assessment_reasons` is non-empty; `restrictions`, `contradiction_refs`, and `provenance_refs` are arrays even if empty. Valid `COMPLETE` results bind an exact evidence object/revision, owning VE02 runtime, claim/condition context, and verifiable provenance. Timestamp uses RFC 3339. No invented numeric `evidence_score` or hidden 1–5 scale. Prior VE 1–5 and 16–20 bands are *historical* and do not govern the v1.0 machine result.

## 2. Grading each dimension — decision rubric

General rule: make an evidence-linked categorical assessment; provide cited reasons. **UNRESOLVED** means the dimension cannot be determined due to missing, stale, ambiguous or conflicting required lineage/context; do not substitute WEAK. **INSUFFICIENT** means a known unusable source or failure to meet that dimension's minimum criterion. Neither condition is a guessed numeric score.

| Dimension | STRONG | MODERATE | WEAK | INSUFFICIENT | UNRESOLVED |
|---|---|---|---|---|---|
| `source_reliability` | Direct, authentic, independently verifiable provenance | Attributable and credible, partially independently verifiable | Attributable, with material bias/method uncertainty | Anonymous, untraceable or unusable source | Authenticity or currentness cannot be established |
| `relevance` | Directly tests exact bounded hypothesis/condition | Materially informs claim with explicit inference | Indirect bearing only | Unrelated or incapable of informing claim | Claim reference or mapping missing |
| `specificity` | Precise observation, measurable result or explicit condition with context | Bounded qualitative detail but incomplete method | Generic/descriptive without useful detail | No discernible testable content | Source passage/meaning cannot be interpreted reliably |
| `independence` | Demonstrably independent origin and distinct lineage | Partial independence with relationship disclosed | Interested/dependent origin or non-independent repetition | Duplicate when independent corroboration is required, or unusable relationship | Origin/independence group undetermined |

Repeated reports sharing one underlying source count as **one lineage**; they never independently corroborate. A dependent vendor report may remain SUPPORTS or CONTRADICTS while being WEAK on independence. Assess against one evidence object and its bounded claim, not by combining unrelated evidence into a hypothesis score.

## 3. Direction — logically separate from quality

1. **SUPPORTS:** Interpretable material signal in favor of exact bounded claim, no material opposing signal in assessed context.
2. **CONTRADICTS:** Interpretable material signal against exact claim, no material supporting signal in assessed context.
3. **MIXED:** Material positive and negative signals coexist. Mixed does **not** itself prove incompatible assertions.
4. **NEUTRAL:** Interpretable evidence does not materially affect the bounded claim. NEUTRAL does not itself downgrade evidence quality or create a supporting finding.
5. **UNRESOLVED:** Direction cannot be defensibly established; fail closed.

Quality and direction are orthogonal: high-quality evidence may strongly CONTRADICTS. A logical **material incompatible conflict** exists only when provenance-linked assertions about the **same condition, scope and time** cannot both be true. Incompatible assertions take the overall `CONTRADICTORY` path, with `contradiction_refs` or explicit reasons identifying both lineages. Ambiguous source meaning is UNRESOLVED, not a manufactured contradiction.

## 4. Overall assessment and priority order

**Apply in order** for each assessed evidence object:

0. Check schema, identity, owner, exact revision, lineage and timestamp. Invalid schema/fields/enum/required identity => `INVALID` diagnostic; no executable machine result. Superseded revision/undetermined provenance => `UNRESOLVED` pending recomputation.
1. Resolve all four dimensions and material direction. Any required `UNRESOLVED` dimension or direction => `result_status=UNRESOLVED`; **no authoritative overall grade**; no dependent execution.
2. When `COMPLETE`, established material incompatible conflict at same condition/scope/time => `assessment_result=CONTRADICTORY`; cite both sources and escalate appropriate contradiction review.
3. Else if **any** dimension = `INSUFFICIENT` => overall `INSUFFICIENT`, with a reason identifying the missing/unusable criterion.
4. Else take the **lowest** resolved dimension in `STRONG > MODERATE > WEAK` ordering; do not average or weight. `MIXED` direction without incompatible claims caps overall grade at `MODERATE` (i.e., STRONG becomes MODERATE; WEAK stays WEAK).
5. `NEUTRAL` does not independently change the quality grade; `CONTRADICTS` does not independently weaken source reliability.

**Schema v1.0 unresolved-result transport rule:** `assessment_result` has no `UNRESOLVED` enum. If emitting a v1.0 envelope with `result_status=UNRESOLVED`, serialize `assessment_result=INSUFFICIENT` **solely as a non-authoritative transport placeholder**, and force `evidence_direction=UNRESOLVED`. Include the literal restrictions `NON_COMPLETE_DO_NOT_CONSUME` and `TRANSPORT_PLACEHOLDER_NOT_AN_INSUFFICIENCY_FINDING`; an assessment reason must identify the unresolved cause. Consumers **MUST evaluate `result_status` before `assessment_result`**, additionally check exact currentness, all required dimension/direction fields and provenance. They must never interpret this filler as an insufficiency assessment or advance dependent execution. If the consuming system cannot enforce that, reject the entire result and require a separately versioned VE02 schema evolution rather than silently changing v1.0 enums.

For `INVALID` source input, return a validator **diagnostic**, not a contract-valid EvidenceAssessmentResult. An invalid envelope must not be presented as COMPLETE. Contract fields must not be silently omitted from transmitted authoritative results.

## 5. Mandatory validation and runtime boundaries

Preserve the approved v1.0 validations: V1 exact contract/version; V2 evidence/revision/provenance binding; V3 VE02/exact runtime owner; V4 only fully resolved COMPLETE; V5 contradiction cited; V6 insufficient condition explained; V7 no ungoverned numeric score; V8 no automatic promotion of hypothesis/decision/authority; V9 revised evidence = stale, recompute; V10 invalid/unresolved fails closed. `result_status=COMPLETE` and revision-currentness are *necessary*, not by themselves sufficient, for downstream eligibility.

VE02 quality and direction are not VE03/VE04 hypothesis validation. STATE, DDS, ET-RT, EC, Deal Mode/DM-STATE, commercial readiness and customer facts remain with their respective owners; no new state/persistence/authorization authority is created.

## 6. Twelve synthetic acceptance cases

`S`, `M`, `W`, `I`, `U` below abbreviate STRONG, MODERATE, WEAK, INSUFFICIENT, UNRESOLVED **for display only**, never serialized values. Dimension order: reliability / relevance / specificity / independence.

| ID | Situation | Dimensions | Direction | Overall | Status / gate |
|---|---|---|---|---|---|
| T01 | Authentic independent direct audit | S/S/S/S | SUPPORTS | STRONG | COMPLETE |
| T02 | Attributable bounded customer interview | M/S/M/M | SUPPORTS | MODERATE | COMPLETE |
| T03 | Interested vendor generic narrative | W/W/W/W | SUPPORTS | WEAK | COMPLETE |
| T04 | Strong independent incident disproves claim | S/S/S/S | CONTRADICTS | STRONG | COMPLETE; no hypothesis promotion |
| T05 | Coexisting supportive and adverse observations, compatible | M/S/M/M | MIXED | MODERATE | COMPLETE |
| T06 | Material incompatible assertions, same time/scope | S/S/S/S | MIXED | CONTRADICTORY | COMPLETE; cite conflicts |
| T07 | Authentic but wholly irrelevant report | S/I/M/S | NEUTRAL | INSUFFICIENT | COMPLETE; irrelevance reason |
| T08 | Independence provenance unresolvable | S/S/M/U | UNRESOLVED | Placeholder I (NON-AUTHORITATIVE) | UNRESOLVED; block |
| T09 | Materially revised evidence | Previously graded | UNRESOLVED | Placeholder I (NON-AUTHORITATIVE) | UNRESOLVED, RECOMPUTE_REQUIRED |
| T10 | Invalid enum or missing required evidence identity | N/A | N/A | N/A | INVALID diagnostic, no result |
| T11 | Duplicate interview offered as independent corroboration | S/M/M/I | SUPPORTS | INSUFFICIENT | COMPLETE; do not double count |
| T12 | Robust neutral observation, indirectly related | S/W/S/S | NEUTRAL | WEAK | COMPLETE; neutral is not automatic failure |

All fixtures are **synthetic**, with local example provenance/revisions. These are not customer evidence or proof that an external StorylineOS service has passed integration testing.

## 7. StorylineOS installation and activation boundary

Implement the rules in a feature-flagged **synthetic QMF** route. Keep Knowledge Pack `ve02-evidence-assessment-result` v1.0.0 and existing contract unchanged. Test the 12 cases, V1–V10, invalid required fields, contradictions, duplicate sources, revised evidence and consumer's fail-closed placeholder handling. Do not enable automatic production assessment merely because this Markdown is published or added to a knowledge pack. Separate StorylineOS installed-content readback, integration regression and explicit activation decision are required; customer evidence/decision state must not change through installation.

## 8. Lineage

- Bundle 02 published v1.4 VE02RC001: Drive `1BQCGKpyEz8JwhLUyVc0PulxUEX2FKucD`, SHA-256 `8dd68c2ac86ca67c28061e37bc8eb6b78758f9d6ffbd951dc1cf0e24d843c27c`.
- Approved contract v1.0: Drive `1FVBqm7GKiRGcKKOrCcXtD9N7d_hwbWbMldHn7NI3iKw`.
- Grading proposal v0.1: Drive `1whSXSX-MV3Iy-RrtiN16nURtE_CcidPuYJFIpv6cAKs`.
- Review and fail-closed correction: Drive `1pBupeeJuybWKlZbBCtS0bdg1_qNoFUgEDD6hlLns5R0`.
- Owner approval in VMF Engineering conversation, 2026-10-08: explicit **"approved"** in response to the review/approval gate. This grants bounded clarification approval only; not a runtime installation or production release.
