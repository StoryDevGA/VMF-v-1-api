import { hashEvidenceToMeaningValue } from './outcomeEvidenceToMeaningContractService.js'
import { getDiscoveryContradictionReview } from './discoveryContradictionReviewService.js'
import { OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES } from './outcomeWorkingDraftMeaningBoundaryService.js'

export const EVIDENCE_TO_DRAFT_INPUT_VERSION = 'outcome-studio.evidence-to-draft-input.v2'
export const EVIDENCE_TO_DRAFT_PLACEMENT_VERSION = 'evidence-to-draft-placement.v1'
export const isEvidenceToDraftV2 = (input) => input?.composition?.contractVersion === EVIDENCE_TO_DRAFT_INPUT_VERSION
const text = (value) => typeof value === 'string' ? value.trim() : ''
const token = (value) => text(value).toUpperCase()
const same = (a, b) => hashEvidenceToMeaningValue(a) === hashEvidenceToMeaningValue(b)
const strings = (value) => Array.isArray(value) && value.every((item) => text(item))
// Accept only explicit nonempty strings, finite numbers, or nonempty plain
// records whose leaves are all known. Unknown markers anywhere in a metadata
// record cannot become located provenance or a comparison constraint.
const known = (value) => typeof value === 'string' ? Boolean(text(value)) && !['UNRESOLVED', 'UNKNOWN'].includes(token(value))
  : typeof value === 'number' ? Number.isFinite(value)
    : Boolean(value && Object.getPrototypeOf(value) === Object.prototype
      && Object.keys(value).length > 0 && Object.values(value).every(known))
const sort = (values) => [...new Set(values)].sort()
const missingInputLabel = (reason) => ({
  CLAIM_STATUS_UNRESOLVED: 'stored claimStatus (source-presented or independently established)',
  INDEPENDENT_VALIDATION_UNRESOLVED: 'independentValidation reference and validator for an established claim',
  VALIDATION_UNRESOLVED: 'stored validationStatus', CURRENTNESS_UNRESOLVED: 'stored currentness',
  REVIEW_NOT_ACCEPTED: 'accepted source review', PROVENANCE_UNRESOLVED: 'lineageRef and sourceLocation',
  CLAIM_CONSTRAINTS_UNRESOLVED: 'stored scope, time and materiality', CLASSIFICATION_UNRESOLVED: 'customer evidence classification',
  ATTRIBUTION_UNRESOLVED: 'source attribution and source label', INTERPRETATION_UNRESOLVED: 'permitted interpretation, qualification and blocked stronger claim',
  PERMITTED_STATEMENT_REPRESENTATION_UNRESOLVED: 'an exact-statement representation consistent with the stored permittedStatement',
  SUBSTANTIATION_UNRESOLVED: 'claim-specific evidenceRequiredToSubstantiate', PROOF_REQUIREMENT_CODES_UNRESOLVED: 'stored proofRequirementCodes',
  PROOF_ORDER_UNRESOLVED: 'stored proofOrderDisposition and its explicit basis', PROOF_ORDER_CONFLICTING: 'consistent proof order disposition',
  PROOF_DEPENDENCY_UNRESOLVED: 'located admissible proofDependency evidence references', PROOF_DEPENDENCY_CYCLE: 'acyclic proof dependency references',
  REFERENCE_UNRESOLVED: 'a located source mapping for this exact reference', SECTION_REFERENCE_UNMAPPED: 'an explicit claim or metadata disposition for this section reference',
  CUSTOMER_EVIDENCE_MISSING: 'admissible customer evidence for this section', CONTRADICTION_CANDIDATE_UNRESOLVED: 'candidate provenance, scope, time and materiality review',
  SOURCE_ONLY_REFERENCE_NOT_A_FACT: 'customer evidence supporting the section beyond source metadata',
  DRAFT_PLACEMENT_REQUIRED: 'a stored draftPlacement declaration binding source sections to this output schema',
  DRAFT_PLACEMENT_INVALID: 'an exact versioned draftPlacement declaration',
  DRAFT_PLACEMENT_TARGET_CHANGED: 'draftPlacement bound to the current selected target receipt',
  DRAFT_PLACEMENT_SOURCE_MISMATCH: 'draftPlacement source sections matching the complete evidence inventory',
})[reason] || reason.toLowerCase().replaceAll('_', ' ')

const applyStoredDraftPlacement = (claim, stored, input) => {
  if (!input) return claim
  const sourceKeys = sort((input.sourceSnapshot.inventoryReceipt.sectionCoverage || [])
    .filter((section) => (section.evidenceIds || []).includes(claim.evidenceReference)).map((section) => section.sectionKey))
  const targets = [...input.selectedTarget.receipt.targetSections.required, ...input.selectedTarget.receipt.targetSections.optional]
    .map((section) => section.targetSectionKey)
  const declared = Object.hasOwn(stored, 'draftPlacement')
  const reasons = []
  if (!sourceKeys.length || !same(sourceKeys, sort(claim.sectionKeys))) reasons.push('DRAFT_PLACEMENT_SOURCE_MISMATCH')
  if (!declared && !reasons.length && sourceKeys.every((key) => targets.includes(key))) {
    return { ...claim, sourceSectionKeys: sourceKeys }
  }
  const placement = stored.draftPlacement
  if (!declared) reasons.push('DRAFT_PLACEMENT_REQUIRED')
  else if (!placement || Object.getPrototypeOf(placement) !== Object.prototype
    || Object.keys(placement).sort().join(',') !== 'sourceSectionKeys,targetReceiptFingerprint,targetSectionKeys,version'
    || placement.version !== EVIDENCE_TO_DRAFT_PLACEMENT_VERSION
    || typeof placement.targetReceiptFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(placement.targetReceiptFingerprint)
    || !strings(placement.sourceSectionKeys) || !placement.sourceSectionKeys.length
    || !strings(placement.targetSectionKeys) || !placement.targetSectionKeys.length
    || sort(placement.sourceSectionKeys).length !== placement.sourceSectionKeys.length
    || sort(placement.targetSectionKeys).length !== placement.targetSectionKeys.length
    || placement.targetSectionKeys.some((key) => !targets.includes(key))) reasons.push('DRAFT_PLACEMENT_INVALID')
  else {
    if (placement.targetReceiptFingerprint !== input.selectedTarget.receiptFingerprint) reasons.push('DRAFT_PLACEMENT_TARGET_CHANGED')
    if (!same(sort(placement.sourceSectionKeys), sourceKeys)) reasons.push('DRAFT_PLACEMENT_SOURCE_MISMATCH')
  }
  return { ...claim, sourceSectionKeys: sourceKeys,
    sectionKeys: reasons.length ? [] : sort(placement.targetSectionKeys),
    draftPlacementStatus: reasons.length ? 'UNRESOLVED' : 'VALIDATED',
    draftPlacementReasons: sort(reasons),
    ...(!reasons.length ? { draftPlacement: JSON.parse(JSON.stringify(placement)) } : {}),
  }
}

// These values come exclusively from the stored evidence, never legacy ACCEPTED.
export const enrichDraftClaim = (claim, stored, source, input) => applyStoredDraftPlacement({ ...claim,
  evidenceClass: claim.classification,
  claimStatus: token(stored.claimStatus) || 'UNRESOLVED',
  independentValidation: stored.independentValidation ?? 'UNRESOLVED',
  sourceLocation: stored.sourceLocation ?? source.sourceLocation ?? 'UNRESOLVED',
  scope: stored.scope ?? 'UNRESOLVED', time: stored.time ?? 'UNRESOLVED',
  materiality: stored.materiality ?? 'UNRESOLVED',
  proofRequirementCodes: stored.proofRequirementCodes ?? 'UNRESOLVED',
  proofOrder: stored.proofOrder ?? 'UNRESOLVED',
  evidenceRequiredToSubstantiate: stored.evidenceRequiredToSubstantiate ?? 'UNRESOLVED',
  permittedStatement: Object.prototype.hasOwnProperty.call(stored, 'permittedStatement') ? stored.permittedStatement : claim.statement,
}, stored, input)

export const draftClaimDeficits = (claim, byEvidence, cache, visiting) => {
  if (cache.has(claim.evidenceReference)) return cache.get(claim.evidenceReference)
  if (visiting.has(claim.evidenceReference)) return ['PROOF_DEPENDENCY_CYCLE']
  visiting.add(claim.evidenceReference)
  const reasons = [...(claim.draftPlacementReasons || [])]
  if (!['COMPOSED_FACT', 'SOURCE_PRESENTED_UNVERIFIED'].includes(claim.admission)) reasons.push('CLAIM_ADMISSION_UNRESOLVED')
  if (claim.reviewStatus !== 'ACCEPTED') reasons.push('REVIEW_NOT_ACCEPTED')
  if (!['SOURCE_PRESENTED', 'ESTABLISHED'].includes(claim.claimStatus)) reasons.push('CLAIM_STATUS_UNRESOLVED')
  if (!['VALIDATED', 'UNVALIDATED', 'REQUIRES_VALIDATION'].includes(claim.validationStatus)) reasons.push('VALIDATION_UNRESOLVED')
  if (claim.claimStatus === 'ESTABLISHED' && (claim.validationStatus !== 'VALIDATED'
    || !claim.independentValidation || typeof claim.independentValidation !== 'object'
    || !text(claim.independentValidation.reference) || !text(claim.independentValidation.validatedBy))) reasons.push('INDEPENDENT_VALIDATION_UNRESOLVED')
  if (claim.currentness !== 'CURRENT') reasons.push('CURRENTNESS_UNRESOLVED')
  if (!claim.lineageRef || !known(claim.sourceLocation)) reasons.push('PROVENANCE_UNRESOLVED')
  if (!known(claim.scope) || !known(claim.time) || !known(claim.materiality)) reasons.push('CLAIM_CONSTRAINTS_UNRESOLVED')
  if (!['CUSTOMER_EVIDENCE', 'FACT', 'SUPPORTED_FACT'].includes(claim.evidenceClass)) reasons.push('CLASSIFICATION_UNRESOLVED')
  if (!text(claim.attribution.stored) || !text(claim.attribution.sourceLabel)) reasons.push('ATTRIBUTION_UNRESOLVED')
  if (claim.permittedInterpretation !== 'EXACT_STATEMENT_ONLY' || !strings(claim.blockedStrongerClaim)
    || !claim.blockedStrongerClaim.length || !strings(claim.qualification)) reasons.push('INTERPRETATION_UNRESOLVED')
  if (claim.permittedStatement !== claim.statement) reasons.push('PERMITTED_STATEMENT_REPRESENTATION_UNRESOLVED')
  if (!strings(claim.evidenceRequiredToSubstantiate) || !claim.evidenceRequiredToSubstantiate.length) reasons.push('SUBSTANTIATION_UNRESOLVED')
  if (!strings(claim.proofRequirementCodes) || claim.proofRequirementCodes.some((code) => !OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES.includes(code))) reasons.push('PROOF_REQUIREMENT_CODES_UNRESOLVED')
  if (!['ESTABLISHED', 'NOT_ESTABLISHED'].includes(claim.proofOrderDisposition)) reasons.push('PROOF_ORDER_UNRESOLVED')
  if (claim.proofOrderDisposition === 'ESTABLISHED' && (!strings(claim.proofOrder)
    || !claim.proofOrder.length || !claim.proofRequirementCodes.length
    || claim.proofOrder.some((code) => !claim.proofRequirementCodes.includes(code)))) reasons.push('PROOF_ORDER_UNRESOLVED')
  if (claim.proofOrderDisposition === 'NOT_ESTABLISHED' && Array.isArray(claim.proofOrder) && claim.proofOrder.length) reasons.push('PROOF_ORDER_CONFLICTING')
  if (!strings(claim.proofDependency) || new Set(claim.proofDependency).size !== claim.proofDependency.length) reasons.push('PROOF_DEPENDENCY_UNRESOLVED')
  else if (claim.proofDependency.some((id) => !byEvidence.has(id)
    || draftClaimDeficits(byEvidence.get(id), byEvidence, cache, visiting).length)) reasons.push('PROOF_DEPENDENCY_UNRESOLVED')
  visiting.delete(claim.evidenceReference)
  cache.set(claim.evidenceReference, sort(reasons))
  return cache.get(claim.evidenceReference)
}

const contradictionLedger = (input, claims, all) => {
  const snapshot = input.sourceSnapshot || {}
  const evidence = snapshot.evidenceObjects || []
  const sources = snapshot.sourceRegistry || []
  const candidates = snapshot.discoveryHealth?.contradictionCandidates || input.composition?.businessFactLedger?.contradictions || []
  return candidates.map((candidate) => {
    const refs = candidate.evidenceObjectIds || []
    const pair = refs.length === 2 && new Set(refs).size === 2 ? refs.map((id) => evidence.find((row) => row.evidenceObjectId === id)) : []
    const located = pair.length === 2 && pair.every((row) => row && text(row.lineageRef)
      && known(row.sourceLocation) && sources.some((source) => source.sourceId === row.sourceId))
    const dimensions = { provenance: located ? 'KNOWN' : 'UNRESOLVED',
      scope: pair.length === 2 && pair.every((row) => known(row?.scope)) ? 'KNOWN' : 'UNRESOLVED',
      time: pair.length === 2 && pair.every((row) => known(row?.time)) ? 'KNOWN' : 'UNRESOLVED',
      materiality: pair.length === 2 && pair.every((row) => known(row?.materiality)) ? 'KNOWN' : 'UNRESOLVED' }
    let disposition = 'UNRESOLVED'
    if (Object.values(dimensions).every((value) => value === 'KNOWN')) {
      const qualified = pair.some((row, index) => row.qualificationOf === pair[1 - index].evidenceObjectId)
      if (qualified && same(pair[0].scope, pair[1].scope) && same(pair[0].time, pair[1].time)) disposition = 'COMPATIBLE_QUALIFICATION'
      else if (same(pair[0].scope, pair[1].scope)) {
        const dates = pair.map((row) => [Date.parse(row.time?.from), Date.parse(row.time?.to)])
        if (dates.every(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && from <= to)
          && (dates[0][1] < dates[1][0] || dates[1][1] < dates[0][0])) disposition = 'NOT_COMPARABLE'
      }
    }
    const review = getDiscoveryContradictionReview(candidate, evidence, snapshot.contradictionReviews,
      snapshot.inventoryReceipt?.scope?.runtimeInstanceId || '', snapshot.contradictionReviewEpoch)
    // Legacy review hashes omit SS-041 dimensions. Retain their receipt as
    // information; they cannot certify the v2 comparison or override reopening.
    if (['CONFIRMED', 'REOPENED', 'STALE'].includes(review.reviewStatus)) disposition = 'UNRESOLVED'
    const mapped = sort(claims.filter((claim) => refs.includes(claim.evidenceReference)).flatMap((claim) => claim.sectionKeys))
    const exactMapping = refs.length === 2 && refs.every((id) => claims.some((claim) => claim.evidenceReference === id && claim.sectionKeys.length))
    return { candidateId: candidate.contradictionId || 'UNRESOLVED', candidate,
      evidenceReferences: refs, disposition, dimensions, sourceReview: review,
      affectedSectionKeys: exactMapping ? mapped : all.filter((section) => section.required).map((section) => section.targetSectionKey),
      provenance: pair.filter(Boolean).map((row) => ({ evidenceReference: row.evidenceObjectId,
        sourceReference: row.sourceId, evidenceHash: hashEvidenceToMeaningValue(row),
        scope: row.scope ?? 'UNRESOLVED', time: row.time ?? 'UNRESOLVED', materiality: row.materiality ?? 'UNRESOLVED' })) }
  }).sort((a, b) => a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0)
}

export const buildDraftSectionLedger = ({ input, claims, all, deficitsFor }) => {
  const contradictions = contradictionLedger(input, claims, all)
  const snapshot = input.sourceSnapshot
  const ledger = input.composition.businessFactLedger
  const storedPlacementActive = snapshot.evidenceObjects.some((row) => Object.hasOwn(row, 'draftPlacement'))
  const coverageRows = snapshot.inventoryReceipt.sectionCoverage
  const sourceKeysFor = (claim) => claim.sourceSectionKeys || claim.sectionKeys
  const targetsForSource = (sourceKey) => sort([
    ...claims.filter((claim) => sourceKeysFor(claim).includes(sourceKey)).flatMap((claim) => claim.sectionKeys),
    ...(all.some((section) => section.targetSectionKey === sourceKey) ? [sourceKey] : []),
  ])
  const resolvesReference = (claim, reference) => claim.evidenceReference === reference || claim.sourceReference === reference
  return all.map((section) => {
    const key = section.targetSectionKey
    const candidates = claims.filter((claim) => claim.sectionKeys.includes(key))
    const supported = candidates.filter((claim) => !deficitsFor(claim).length)
    const relevantSource = (sourceKey) => storedPlacementActive
      ? targetsForSource(sourceKey).includes(key) || (section.required && !targetsForSource(sourceKey).length)
      : sourceKey === key
    const omissions = ledger.omitted.filter((entry) => (entry.sectionKeys || []).some(relevantSource))
    const coverage = coverageRows.filter((entry) => relevantSource(entry.sectionKey))
    const sourceKeys = sort(coverage.map((entry) => entry.sectionKey))
    const bindings = sort(coverage.flatMap((entry) => entry.references || []))
    const missing = sort(coverage.flatMap((entry) => entry.missingReferences || []))
    const sourceClaims = claims.filter((claim) => sourceKeysFor(claim).some(relevantSource))
    const invalidPlacements = sourceClaims.filter((claim) => claim.draftPlacementStatus === 'UNRESOLVED')
    const unmapped = bindings.filter((reference) => !(storedPlacementActive ? sourceClaims : candidates)
      .some((claim) => claim.sectionKeys.length && (storedPlacementActive ? resolvesReference(claim, reference) : claim.evidenceReference === reference))
      && !omissions.some((entry) => entry.reference === reference) && !missing.includes(reference))
    const unresolvedOmissions = omissions.filter((entry) => entry.reason !== 'EVIDENCE_NOT_VALIDATED'
      || !(storedPlacementActive ? claims.filter((claim) => claim.sectionKeys.length && !deficitsFor(claim).length) : supported)
        .some((claim) => claim.evidenceReference === entry.reference))
    const blockers = contradictions.filter((entry) => entry.disposition === 'UNRESOLVED' && entry.affectedSectionKeys.includes(key))
    const unlocatedCount = Number(snapshot.discoveryHealth?.unresolvedContradictionCount || snapshot.discoveryHealth?.contradictionCount || 0)
    const reasons = sort([...candidates.flatMap(deficitsFor), ...invalidPlacements.flatMap(deficitsFor), ...unresolvedOmissions.map((entry) => entry.reason),
      ...(missing.length ? ['REFERENCE_UNRESOLVED'] : []),
      ...(unmapped.length ? ['SECTION_REFERENCE_UNMAPPED'] : []),
      ...(blockers.length || unlocatedCount > contradictions.length ? ['CONTRADICTION_CANDIDATE_UNRESOLVED'] : []),
      ...(!candidates.length ? ['CUSTOMER_EVIDENCE_MISSING'] : [])])
    const status = !reasons.length && supported.length ? 'SUPPORTED' : !section.required ? 'OPTIONAL'
      : supported.length ? 'PARTIAL' : omissions.length && omissions.every((entry) => entry.reason === 'SOURCE_ONLY_REFERENCE_NOT_A_FACT')
        ? 'METADATA_ONLY' : 'UNRESOLVED'
    const refs = sort([...candidates.map((claim) => claim.evidenceReference), ...invalidPlacements.map((claim) => claim.evidenceReference), ...omissions.map((entry) => entry.reference), ...missing, ...unmapped])
    const referenceDeficits = (reference) => sort([
      ...candidates.filter((claim) => claim.evidenceReference === reference).flatMap(deficitsFor),
      ...invalidPlacements.filter((claim) => claim.evidenceReference === reference).flatMap(deficitsFor),
      ...unresolvedOmissions.filter((entry) => entry.reference === reference).map((entry) => entry.reason),
      ...(missing.includes(reference) ? ['REFERENCE_UNRESOLVED'] : []),
      ...(unmapped.includes(reference) ? ['SECTION_REFERENCE_UNMAPPED'] : []),
      ...(blockers.some((candidate) => candidate.evidenceReferences.includes(reference)) ? ['CONTRADICTION_CANDIDATE_UNRESOLVED'] : []),
    ])
    const questionRefs = refs.filter((reference) => referenceDeficits(reference).length)
    if (!questionRefs.length && reasons.length) questionRefs.push('')
    const questions = status === 'SUPPORTED' || status === 'OPTIONAL' ? []
      : questionRefs.map((reference) => {
        const exactReasons = reference ? referenceDeficits(reference) : reasons
        const missingInput = exactReasons.map(missingInputLabel).join('; ')
        const locatedSource = coverage.find((row) => (row.references || []).includes(reference)
          || (row.evidenceIds || []).includes(reference))?.sectionKey
        return { sectionKey: key, sourceSectionKey: storedPlacementActive ? locatedSource || key : key,
        missingReference: reference, missingInput, reasons: exactReasons,
        field: `sectionLedger.${key}${reference ? `.${reference}` : ''}`,
        question: `Provide or reconcile ${reference ? `the governed reference "${reference}" and its stored claim metadata` : 'admissible customer evidence'} for "${section.heading}". Missing: ${missingInput}.`,
        nextAction: 'CLARIFY_GOVERNED_SOURCE_AND_RE_RESOLVE' } })
    return { ...section, sourceSectionKeys: sourceKeys.length ? sourceKeys : [key], purpose: section.purpose ?? 'UNRESOLVED',
      status, claimKeys: status === 'SUPPORTED' ? supported.map((claim) => claim.claimKey) : [],
      evidenceReferences: refs, sourceBindings: storedPlacementActive ? bindings : coverageRows.find((row) => row.sectionKey === key)?.references || [], omissions,
      reasons, omissionPermitted: !section.required, clarificationQuestions: questions }
  })
}

export const buildDraftInventoryDisposition = (input, claims, sections) => {
  const receipt = input.sourceSnapshot?.inventoryReceipt
  const selected = new Set(receipt?.selectedEvidenceIds || [])
  const byEvidence = new Map(claims.map((claim) => [claim.evidenceReference, claim]))
  const admitted = new Set(sections.flatMap((section) => section.claimKeys))
  return { completenessReceipt: receipt || null,
    omissions: input.composition?.businessFactLedger?.omitted || [],
    identityDispositionLedger: (receipt?.collections?.evidence?.records || []).map((record) => ({
      evidenceReference: record.id, evidenceHash: record.hash, sourceReference: record.sourceReference,
      disposition: !selected.has(record.id) ? 'INVENTORY_ONLY' : admitted.has(byEvidence.get(record.id)?.claimKey)
        ? 'SELECTED_ADMISSIBLE' : 'SELECTED_UNRESOLVED_OR_METADATA', claimKey: byEvidence.get(record.id)?.claimKey || '' })).sort((a, b) => a.evidenceReference < b.evidenceReference ? -1 : 1),
    contradictionLedger: contradictionLedger(input, claims, sections) }
}
