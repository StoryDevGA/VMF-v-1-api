import { createHash } from 'node:crypto'
import { z } from 'zod'
import { sourceMaterialFingerprint } from './sourceVerificationContext.js'
import { hashOutcomeShapingValue, projectOutcomeShapingContractIdentity } from '../utils/outcomeSelectedTargetIdentity.js'
import { OUTCOME_SELECTED_TARGET_CONTRACT_VERSION } from '../constants/outcomeSelectedTarget.js'
import { OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES } from './outcomeWorkingDraftMeaningBoundaryService.js'

const text = max => z.string().min(1).max(max).refine(value => value === value.trim() && !['UNKNOWN', 'UNRESOLVED'].includes(value.toUpperCase()))
const key = text(140)
const unique = schema => z.array(schema).max(30).refine(values => new Set(values).size === values.length)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const same = (a, b) => digest(a) === digest(b)
const fail = () => { throw Object.assign(new Error('The authored evidence qualification is invalid or stale.'), {
  status: 409, code: 'EVIDENCE_DRAFT_QUALIFICATION_INVALID',
}) }
const need = value => { if (!value) fail() }
// Keep model/normalizer validation independent of provider/model initialization.
// The author owner separately resolves content through the native target reader.
const assertSelectedTarget = target => {
  const exact = (value, keys) => value && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
  need(exact(target, ['contractVersion', 'receipt', 'receiptFingerprint']) && target.contractVersion === OUTCOME_SELECTED_TARGET_CONTRACT_VERSION)
  const receipt = target.receipt
  need(exact(receipt, ['contractVersion', 'contractIdentity', 'targetSections', 'providerTargetFingerprint'])
    && receipt.contractVersion === OUTCOME_SELECTED_TARGET_CONTRACT_VERSION && /^[a-f0-9]{64}$/.test(receipt.providerTargetFingerprint)
    && target.receiptFingerprint === hashOutcomeShapingValue(receipt)
    && exact(receipt.contractIdentity, ['outputType', 'schema'])
    && hashOutcomeShapingValue(projectOutcomeShapingContractIdentity(receipt.contractIdentity)) === hashOutcomeShapingValue(receipt.contractIdentity))
  need(exact(receipt.targetSections, ['required', 'optional']) && Array.isArray(receipt.targetSections.required)
    && receipt.targetSections.required.length && Array.isArray(receipt.targetSections.optional))
  const sections = [...receipt.targetSections.required, ...receipt.targetSections.optional]
  need(sections.length <= 20 && new Set(sections.map(row => row.targetSectionKey)).size === sections.length
    && sections.every(row => exact(row, ['targetSectionKey', 'heading', 'purpose']) && typeof row.heading === 'string'
      && row.heading.trim() && row.heading.length <= 255 && typeof row.purpose === 'string' && row.purpose.trim() && row.purpose.length <= 2000
      && row.targetSectionKey && row.targetSectionKey.length <= 140
      && row.targetSectionKey === row.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')))
}
const plainJson = value => {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return Object.keys(value).length === value.length && value.every(plainJson)
  return Boolean(value && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.keys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return !['__proto__', 'constructor', 'prototype'].includes(key) && descriptor?.get === undefined
      && descriptor?.set === undefined && Object.hasOwn(descriptor, 'value') && plainJson(descriptor.value)
  }))
}
export const draftQualificationFactsSchema = z.object({
  claimStatus: z.literal('SOURCE_PRESENTED'), classification: z.literal('CUSTOMER_EVIDENCE'), currentness: z.literal('CURRENT'),
  sourceLocation: text(2000), scope: text(2000), time: text(2000), attribution: text(1000), permittedStatement: text(8000),
  permittedInterpretation: z.literal('EXACT_STATEMENT_ONLY'), confidenceWarnings: z.array(text(1000)).max(30),
  blockedStrongerClaim: unique(text(1000)).min(1), proofDependency: unique(text(240)),
  proofOrderDisposition: z.literal('NOT_ESTABLISHED'), proofOrder: z.array(z.never()).length(0),
  proofRequirementCodes: unique(z.enum(OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES)),
  evidenceRequiredToSubstantiate: unique(text(1000)).min(1),
}).strict()
export const draftQualificationEnvelopeSchema = z.object({
  contractVersion: z.literal('evidence-draft-qualification.v1'), authoredBy: z.string().regex(/^[a-f0-9]{24}$/),
  authoredAt: z.string().datetime(),
  binding: z.object({ evidenceObjectId: text(240), sourceId: text(240), sourceFingerprint: fingerprint,
    evidenceFingerprint: fingerprint, sourceSectionKeys: unique(key).min(1).max(20),
    targetReceiptFingerprint: hash, targetSectionKeys: unique(key).min(1).max(20),
  }).strict(), facts: draftQualificationFactsSchema,
}).strict()
export const evidenceDraftQualificationRequestSchema = z.object({
  expectedUpdatedAt: z.string().datetime(), expectedEvidenceFingerprint: fingerprint,
  expectedSourceFingerprint: fingerprint, expectedTargetFingerprint: hash,
  requestedOutputTypeKey: text(140), requestedFormat: z.literal('MARKDOWN'),
  targetSectionKeys: unique(key).min(1).max(20), facts: draftQualificationFactsSchema, rationale: text(2000),
  mode: z.literal('REVALIDATE_BINDING').optional(), expectedQualificationFingerprint: hash.optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.mode) !== Boolean(value.expectedQualificationFingerprint)) context.addIssue({
    code: z.ZodIssueCode.custom, path: ['expectedQualificationFingerprint'],
    message: 'Binding revalidation requires the exact previous qualification fingerprint.',
  })
})
export const evidenceDraftQualificationFingerprint = value => digest(value)
export const evidenceDraftMaterialFingerprint = evidence => `sha256:${digest(Object.fromEntries([
  'evidenceObjectId', 'sourceId', 'extractedFact', 'lineageRef', 'sourceLocation', 'evidenceSupport', 'reviewStatus', 'validationStatus',
].filter(key => Object.hasOwn(evidence, key) && evidence[key] !== undefined).map(key => [key, evidence[key]])))}`

export const assertEvidenceDraftQualification = ({ evidence, source, sourceSectionKeys, selectedTarget }) => {
  if (!Object.hasOwn(evidence, 'draftQualification')) return null
  const raw = evidence.draftQualification
  need(plainJson(raw) && Buffer.byteLength(JSON.stringify(raw)) <= 16384)
  const parsed = draftQualificationEnvelopeSchema.safeParse(raw)
  need(parsed.success)
  const envelope = parsed.data, binding = envelope.binding
  need(binding.evidenceObjectId === evidence.evidenceObjectId && binding.sourceId === evidence.sourceId
    && binding.evidenceFingerprint === evidenceDraftMaterialFingerprint(evidence)
    && envelope.facts.permittedStatement === evidence.extractedFact
    && !envelope.facts.proofDependency.includes(evidence.evidenceObjectId))
  if (source !== undefined) need(source && source.sourceId === evidence.sourceId && binding.sourceFingerprint === sourceMaterialFingerprint(source))
  if (sourceSectionKeys !== undefined) need(same([...sourceSectionKeys].sort(), [...binding.sourceSectionKeys].sort()))
  if (selectedTarget !== undefined) {
    assertSelectedTarget(selectedTarget)
    const targets = [...selectedTarget.receipt.targetSections.required, ...selectedTarget.receipt.targetSections.optional].map(row => row.targetSectionKey)
    need(binding.targetReceiptFingerprint === selectedTarget.receiptFingerprint && binding.targetSectionKeys.every(key => targets.includes(key)))
  }
  return envelope
}
export const recordEvidenceDraftQualification = ({ evidence, source, sourceSectionKeys, selectedTarget,
  targetSectionKeys, facts, actorUserId, authoredAt = new Date().toISOString() }) => {
  assertSelectedTarget(selectedTarget)
  const envelope = { contractVersion: 'evidence-draft-qualification.v1', authoredBy: String(actorUserId), authoredAt,
    binding: { evidenceObjectId: evidence.evidenceObjectId, sourceId: evidence.sourceId,
      sourceFingerprint: sourceMaterialFingerprint(source), evidenceFingerprint: evidenceDraftMaterialFingerprint(evidence),
      sourceSectionKeys: [...sourceSectionKeys].sort(), targetReceiptFingerprint: selectedTarget.receiptFingerprint,
      targetSectionKeys: [...targetSectionKeys].sort() }, facts }
  return assertEvidenceDraftQualification({ evidence: { ...evidence, draftQualification: envelope }, source, sourceSectionKeys, selectedTarget })
}
// An explicit editable-state operation, never a read-time repair. Changed claims,
// source material or output placement must use ordinary authoring/invalidation.
export const revalidateEvidenceDraftQualification = ({ evidence, source, sourceSectionKeys, selectedTarget,
  targetSectionKeys, facts, expectedQualificationFingerprint, actorUserId, authoredAt }) => {
  const previous = assertEvidenceDraftQualification({ evidence, source, selectedTarget })
  need(previous && digest(previous) === expectedQualificationFingerprint
    && same(previous.facts, facts)
    && same([...previous.binding.targetSectionKeys].sort(), [...targetSectionKeys].sort())
    && !same([...previous.binding.sourceSectionKeys].sort(), [...sourceSectionKeys].sort()))
  return recordEvidenceDraftQualification({ evidence, source, sourceSectionKeys, selectedTarget,
    targetSectionKeys, facts: previous.facts, actorUserId, authoredAt })
}
export const projectEvidenceDraftQualification = args => {
  const envelope = assertEvidenceDraftQualification(args)
  if (!envelope) return null
  return { ...envelope.facts, draftPlacement: { version: 'evidence-to-draft-placement.v1',
    sourceSectionKeys: [...envelope.binding.sourceSectionKeys], targetReceiptFingerprint: envelope.binding.targetReceiptFingerprint,
    targetSectionKeys: [...envelope.binding.targetSectionKeys] } }
}
export const preserveEvidenceDraftQualification = (raw, normalized) => {
  if (!Object.hasOwn(raw, 'draftQualification')) return normalized
  const envelope = assertEvidenceDraftQualification({ evidence: raw })
  // Review/validation and original location are material, never regenerated from graph defaults.
  const result = { ...normalized, ...Object.fromEntries(['sourceLocation', 'reviewStatus', 'validationStatus']
    .filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]])), draftQualification: envelope }
  assertEvidenceDraftQualification({ evidence: result })
  return result
}
