# VE02 Evidence Assessment Result Contract v1.0

Lifecycle State: STORYLINEOS LOGICAL DERIVATIVE — REPOSITORY VERIFIED — CURRENT SELECTION
Upstream semantic owner: VE02 / Bundle 02
Canonical interface: `VMF.VE02.EvidenceAssessmentResult`
Schema version: `1.0`
Source runtime: VMF Bundle 02 v1.4 / STATE v1.6 / DDS v1.8 — VE02RC001
Authority boundary: downstream StorylineOS consumption derivative only. This file does not create or alter VMF source authority, customer truth, STATE, DDS, ET-RT, EC, Deal Mode, proposal, forecast or commitment authority.

## Exact governing VE02 contract content

VE02 MACHINE-CONSUMABLE EVIDENCE ASSESSMENT RESULT CONTRACT v1.0 ADDENDUM**

Canonical identifier: VMF.VE02.EvidenceAssessmentResult

Schema version: 1.0

Serialization: JSON object.

Owner: VE02 - Evidence Assessment Module.

Required fields: contract_id; schema_version; result_id; result_status; evidence_id; evidence_revision_ref; runtime_owner; runtime_version_ref; assessed_at; source_reliability; relevance; specificity; independence; assessment_result; evidence_direction; assessment_reasons; restrictions; contradiction_refs; provenance_refs.

Permitted result_status values: COMPLETE; UNRESOLVED; INVALID.

Permitted source_reliability / relevance / specificity / independence values: STRONG; MODERATE; WEAK; INSUFFICIENT; UNRESOLVED.

Permitted assessment_result values: STRONG; MODERATE; WEAK; CONTRADICTORY; INSUFFICIENT.

Permitted evidence_direction values: SUPPORTS; CONTRADICTS; MIXED; NEUTRAL; UNRESOLVED.

Field Rule - result_id uniquely identifies the evidence-assessment revision.

Field Rule - evidence_id resolves to a governed Evidence Object.

Field Rule - evidence_revision_ref binds the result to the exact assessed evidence revision or immutable source fingerprint.

Field Rule - runtime_owner must be VE02 and runtime_version_ref identifies the exact governing VE02-containing Bundle 02 source.

Field Rule - assessed_at is an RFC 3339 timestamp.

Field Rule - assessment_reasons is a non-empty array of concise evidence-linked reasons.

Field Rule - restrictions, contradiction_refs and provenance_refs always serialize as arrays, including when empty.

Field Rule - provenance_refs contains enough lineage to resolve the Evidence Object and its source record.

Numeric Evidence Score Rule: schema v1.0 defines no canonical numeric evidence-score scale. A numeric evidence_score may appear only as a namespaced extension when a separately governed score_scale_ref is explicitly bound. Missing scale must not become an inferred number.

Validation V1 - contract_id must equal VMF.VE02.EvidenceAssessmentResult and schema_version must equal 1.0.

Validation V2 - evidence_id, evidence_revision_ref and provenance_refs must resolve. Missing required lineage returns INVALID or UNRESOLVED and cannot produce COMPLETE.

Validation V3 - runtime_owner must be VE02 and runtime_version_ref must identify the exact governing VE02-containing runtime source.

Validation V4 - COMPLETE requires source_reliability, relevance, specificity, independence and evidence_direction to be resolved rather than UNRESOLVED.

Validation V5 - CONTRADICTORY requires contradiction_refs or an assessment_reason that identifies the conflicting evidence relationship and provenance.

Validation V6 - INSUFFICIENT requires assessment_reasons to identify the missing or unusable evidence condition.

Validation V7 - numeric evidence_score is invalid without a governed score_scale_ref.

Validation V8 - VE02 output may not directly change hypothesis state, confidence, promotion, validation, decision availability, route permission, execution authorization or commitment state.

Validation V9 - a result bound to superseded or materially changed evidence is stale and must be recomputed before dependent execution.

**Validation V10 - schema mismatch, missing required fields, illegal enum values or unresolved required lineage fails closed and prevents VE02-dependent machine execution.**

EXAMPLE VALID RESULT

**{\"contract_id\":\"VMF.VE02.EvidenceAssessmentResult\",\"schema_version\":\"1.0\",\"result_id\":\"VE02-RES-0001\",\"result_status\":\"COMPLETE\",\"evidence_id\":\"EVID-0042\",\"evidence_revision_ref\":\"sha256:example-source-revision\",\"runtime_owner\":\"VE02\",\"runtime_version_ref\":\"VMF Bundle 02 v1.4 / VE02\",\"assessed_at\":\"2026-10-07T16:00:00Z\",\"source_reliability\":\"MODERATE\",\"relevance\":\"STRONG\",\"specificity\":\"MODERATE\",\"independence\":\"MODERATE\",\"assessment_result\":\"MODERATE\",\"evidence_direction\":\"SUPPORTS\",\"assessment_reasons\":\[\"The evidence is directly relevant to the assessed condition.\",\"Independent corroboration is not yet sufficient for a STRONG assessment.\"\],\"restrictions\":\[\"Do not treat this VE02 result as a validated finding.\",\"Do not promote it directly into commercial or economic authority.\"\],\"contradiction_refs\":\[\],\"provenance_refs\":\[\"source-record:SRC-0042\"\]}**

## StorylineOS binding

StorylineOS internal reference `validation-evidence-quality-check` may bind to VE02 only when the implementation conforms to this contract and preserves the stated authority boundaries. VE02-dependent machine execution remains disabled until this successor derivative set is installed, verified and activated through the StorylineOS lifecycle.
