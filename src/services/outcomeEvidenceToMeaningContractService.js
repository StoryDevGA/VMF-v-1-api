import { createHash } from 'node:crypto'
import { assertOutcomeEvidenceInventory } from '../utils/outcomeEvidenceSnapshot.js'
import { assertOutcomeSelectedTargetSelection } from './outcomeSelectedTargetService.js'
import { isEvidenceToDraftV2, enrichDraftClaim, draftClaimDeficits, buildDraftSectionLedger,
  buildDraftInventoryDisposition } from './outcomeEvidenceToDraftContractService.js'

export const EVIDENCE_TO_MEANING_CONTRACT_VERSION = 'evidence-to-meaning.v1'
const text = (value) => typeof value === 'string' ? value.trim() : ''
const token = (value) => text(value).toUpperCase()
const plain = (value) => value !== null && typeof value === 'object'
  && Object.prototype.toString.call(value) === '[object Object]'
  && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value)?.constructor?.name === 'Object')
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0
const invalid = (field) => { throw Object.assign(new Error('Evidence-to-Meaning integrity failed.'), {
  code: 'EVIDENCE_TO_MEANING_INTEGRITY_INVALID', status: 409, details: { field },
}) }
// Unlike the legacy selected-target receipt hash, preserve every source identity field.
const canonical = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (value?._bsontype === 'ObjectId') return value.toHexString()
  if (Array.isArray(value)) return value.map(canonical)
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  if (value === null || ['string', 'boolean'].includes(typeof value)
    || (typeof value === 'number' && Number.isFinite(value))) return value
  invalid('nonJsonValue')
}
export const hashEvidenceToMeaningValue = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex')
const equal = (left, right) => hashEvidenceToMeaningValue(left) === hashEvidenceToMeaningValue(right)
const clone = (value) => JSON.parse(JSON.stringify(canonical(value)))
const sorted = (values) => [...values].sort(compare)
const sectionKey = (heading) => text(heading).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const exactKeys = (value, keys) => plain(value) && equal(sorted(Object.keys(value)), sorted(keys))
const uniqueRecords = (records, identity, field, v2 = false) => {
  if (!Array.isArray(records) || (!v2 && records.length > 500)) invalid(field)
  const map = new Map()
  for (const record of records) {
    const id = identity(record)
    if (!plain(record) || !id || map.has(id)) invalid(`${field}.identity`)
    map.set(id, record)
  }
  return map
}
const statementOf = (evidence) => {
  if (typeof evidence.extractedFact === 'string') return text(evidence.extractedFact)
  if (plain(evidence.extractedFact)) {
    for (const key of ['statement', 'content', 'text', 'value', 'summary']) {
      if (text(evidence.extractedFact[key])) return text(evidence.extractedFact[key])
    }
  }
  for (const key of ['statement', 'content', 'text', 'summary']) if (text(evidence[key])) return text(evidence[key])
  return ''
}
const sourceIdentity = (source) => text(source.sourceId || source.id || source.sourceRef || source.sourceKey)
const normalizeInput = (input) => {
  if (plain(input?.rejectedInput)) invalid(input.rejectedInput.field)
  const result = clone(input)
  const snapshot = result.sourceSnapshot
  if (Buffer.byteLength(JSON.stringify(result)) > 1000000 || !plain(snapshot)) invalid('input.bounds')
  const evidence = uniqueRecords(snapshot.evidenceObjects, (item) => text(item.evidenceObjectId), 'evidenceObjects', isEvidenceToDraftV2(input))
  const sources = uniqueRecords(snapshot.sourceRegistry, sourceIdentity, 'sourceRegistry', isEvidenceToDraftV2(input))
  snapshot.evidenceObjects = [...evidence.values()].sort((a, b) => compare(a.evidenceObjectId, b.evidenceObjectId))
  snapshot.sourceRegistry = [...sources.values()].sort((a, b) => compare(sourceIdentity(a), sourceIdentity(b)))
  const ledger = result.composition?.businessFactLedger
  if (!plain(ledger) || !Array.isArray(ledger.facts) || !Array.isArray(ledger.omitted)
    || !Array.isArray(ledger.contradictions)) invalid('businessFactLedger')
  ledger.facts.sort((a, b) => compare(text(a.evidenceObjectId), text(b.evidenceObjectId)))
  ledger.omitted.sort((a, b) => compare(`${a.reference}:${a.reason}`, `${b.reference}:${b.reason}`))
  return result
}
const buildClaim = ({ evidence, source, fact = null }) => {
  const evidenceId = text(evidence.evidenceObjectId)
  const sourceId = sourceIdentity(source)
  const statement = statementOf(evidence)
  if (!statement || statement.length > 16000 || text(evidence.sourceId) !== sourceId) invalid(`${evidenceId}.source`)
  const warnings = Array.isArray(evidence.confidenceWarnings) ? sorted(evidence.confidenceWarnings.map(text).filter(Boolean)) : []
  if (fact && (text(fact.statement) !== statement || text(fact.sourceId) !== sourceId
    || token(fact.validationStatus) !== token(evidence.validationStatus)
    || token(fact.reviewStatus) !== token(evidence.reviewStatus)
    || text(fact.provenance?.lineageRef) !== text(evidence.lineageRef)
    || !equal(fact.qualification, warnings)
    || (text(evidence.currentness) && token(fact.currentness) !== token(evidence.currentness)))) invalid(`${evidenceId}.ledgerMapping`)
  const evidenceHash = hashEvidenceToMeaningValue(evidence)
  const sourceHash = hashEvidenceToMeaningValue(source)
  const claimKey = `claim_${hashEvidenceToMeaningValue({ evidenceId, sourceId, statement, evidenceHash, sourceHash }).slice(0, 32)}`
  return {
    claimKey, statement, evidenceReference: evidenceId, sourceReference: sourceId, evidenceHash, sourceHash,
    classification: token(evidence.classification) || 'UNKNOWN',
    validationStatus: token(evidence.validationStatus) || 'UNKNOWN',
    reviewStatus: token(evidence.reviewStatus) || 'UNKNOWN',
    attribution: { stored: evidence.attribution ?? null, sourceType: source.sourceType || source.type || '',
      sourceLabel: source.label || source.filename || source.name || '', storedSourceHash: source.sourceHash || source.hash || '' },
    currentness: token(evidence.currentness) || 'UNKNOWN',
    permittedInterpretation: evidence.permittedInterpretation ?? 'UNRESOLVED',
    qualification: warnings, blockedStrongerClaim: evidence.blockedStrongerClaim ?? 'UNRESOLVED',
    proofDependency: evidence.proofDependency ?? 'UNRESOLVED',
    proofOrderDisposition: evidence.proofOrderDisposition ?? 'UNRESOLVED',
    lineageRef: text(evidence.lineageRef),
    sectionKeys: sorted(fact?.sectionKeys || []),
    compositionProvenance: fact ? { factId: fact.factId, claimPermission: fact.claimPermission,
      ledgerCurrentness: fact.currentness } : null,
    restriction: 'EXACT_STATEMENT_ONLY', admission: fact ? 'COMPOSED_FACT' : 'SOURCE_PRESENTED_UNVERIFIED',
  }
}
const supportDeficits = (claim, claimsByEvidence, cache, visiting) => {
  if (cache.has(claim.evidenceReference)) return cache.get(claim.evidenceReference)
  if (visiting.has(claim.evidenceReference)) return ['PROOF_DEPENDENCY_CYCLE']
  visiting.add(claim.evidenceReference)
  const reasons = []
  if (claim.admission !== 'COMPOSED_FACT') reasons.push('SOURCE_PRESENTED_UNVERIFIED')
  if (claim.reviewStatus !== 'ACCEPTED') reasons.push('REVIEW_NOT_ACCEPTED')
  if (claim.validationStatus !== 'VALIDATED') reasons.push('VALIDATION_UNRESOLVED')
  if (claim.currentness !== 'CURRENT') reasons.push('CURRENTNESS_UNRESOLVED')
  if (!claim.lineageRef) reasons.push('LINEAGE_UNRESOLVED')
  if (!['CUSTOMER_EVIDENCE', 'FACT', 'SUPPORTED_FACT'].includes(claim.classification)) reasons.push('CLASSIFICATION_UNRESOLVED')
  if (claim.permittedInterpretation !== 'EXACT_STATEMENT_ONLY'
    || !Array.isArray(claim.blockedStrongerClaim) || !claim.blockedStrongerClaim.length
    || claim.blockedStrongerClaim.some((entry) => !text(entry))) reasons.push('INTERPRETATION_UNRESOLVED')
  if (!Array.isArray(claim.proofDependency) || claim.proofOrderDisposition !== 'PROOF_BEFORE_INTERPRETATION') {
    reasons.push('PROOF_UNRESOLVED')
  } else if (new Set(claim.proofDependency).size !== claim.proofDependency.length
    || claim.proofDependency.some((id) => !claimsByEvidence.has(id)
      || supportDeficits(claimsByEvidence.get(id), claimsByEvidence, cache, visiting).length > 0)) reasons.push('PROOF_DEPENDENCY_UNRESOLVED')
  visiting.delete(claim.evidenceReference)
  cache.set(claim.evidenceReference, reasons)
  return reasons
}

export const compileEvidenceToMeaningContract = (rawInput) => {
  const v2 = isEvidenceToDraftV2(rawInput)
  let input
  const errors = []
  let claims = []
  let sections = []
  try {
    input = normalizeInput(rawInput)
    if (v2 && !input.sourceSnapshot.inventoryReceipt) invalid('sourceSnapshot.INVENTORY_RECEIPT_REQUIRED')
    try { assertOutcomeEvidenceInventory(input.sourceSnapshot) } catch (error) { invalid('sourceSnapshot.' + (error.code || 'INVENTORY_INVALID')) }
    if (input.sourceSnapshot.readError) invalid(`sourceSnapshot.${input.sourceSnapshot.readError.code}`)
    if (!v2 && input.sourceSnapshot.inventoryReceipt?.sectionReadiness === 'UNRESOLVED') invalid('sourceSnapshot.SECTION_REFERENCE_UNRESOLVED')
    if (input.composition.targetReadError) invalid(`selectedTarget.${input.composition.targetReadError.code}`)
    if (input.composition.businessFactLedger.projectionError) invalid(`businessFactLedger.${input.composition.businessFactLedger.projectionError.code}`)
    if (input.composition.providerCompatibility?.status === 'CLARIFICATION_REQUIRED') {
      invalid(`providerCompatibility.${(input.composition.providerCompatibility.missingFields || []).join(',')}`)
    }
    assertOutcomeSelectedTargetSelection(input.selectedTarget)
    const { composition, selectedTarget, sourceSnapshot } = input
    if (!plain(composition.runtimeBinding) || !plain(composition.requestBinding)
      || !plain(composition.truthBinding) || !plain(composition.outputBinding)
      || !Array.isArray(composition.outputBinding.lineage?.versionIds)
      || !Array.isArray(composition.outputBinding.lineage?.contentHashes)) invalid('composition.lineage')
    if (v2 && sourceSnapshot.inventoryReceipt.scope.runtimeInstanceId !== composition.runtimeBinding.runtimeInstanceId) invalid('sourceSnapshot.RUNTIME_SCOPE_MISMATCH')
    const target = selectedTarget.receipt
    for (const identity of Object.values(target.contractIdentity)) {
      if (!composition.outputBinding.lineage.versionIds.includes(identity.selection.versionId)
        || !composition.outputBinding.lineage.contentHashes.includes(identity.actualContentHash)) invalid('selectedTarget.packLineage')
    }
    if (!Array.isArray(input.request?.audience) || !input.request.audience.length
      || input.request.audience.some((entry) => !text(entry)) || !text(input.request.format)) invalid('request.audienceOrFormat')
    if (text(composition.outputBinding.outputTypeKey) !== text(target.contractIdentity.outputType.selection.capabilityKey)
      || text(composition.outputBinding.outputSchemaKey) !== text(target.contractIdentity.schema.selection.capabilityKey)
      || text(composition.requestBinding.requestedOutputTypeKey) !== text(composition.outputBinding.outputTypeKey)
      || !equal(composition.outputBinding.requiredSections.map(sectionKey), target.targetSections.required.map((item) => item.targetSectionKey))
      || !equal((composition.outputBinding.optionalSections || []).map(sectionKey), target.targetSections.optional.map((item) => item.targetSectionKey))) invalid('selectedTarget.outputBinding')
    const evidence = uniqueRecords(sourceSnapshot.evidenceObjects, (item) => text(item.evidenceObjectId), 'evidenceObjects', v2)
    const sources = uniqueRecords(sourceSnapshot.sourceRegistry, sourceIdentity, 'sourceRegistry', v2)
    const facts = uniqueRecords(composition.businessFactLedger.facts, (item) => text(item.evidenceObjectId), 'facts', v2)
    for (const [id, fact] of facts) {
      const stored = evidence.get(id)
      const source = sources.get(text(stored?.sourceId))
      if (!stored || !source) invalid(`${id}.mapping`)
      claims.push(buildClaim({ evidence: stored, source, fact }))
    }
    for (const omitted of composition.businessFactLedger.omitted) {
      if (omitted.reason !== 'EVIDENCE_NOT_VALIDATED') continue
      const stored = evidence.get(text(omitted.reference))
      const source = sources.get(text(stored?.sourceId))
      if (!stored || !source || facts.has(omitted.reference)) invalid(`${omitted.reference}.mapping`)
      const claim = buildClaim({ evidence: stored, source })
      claim.sectionKeys = sorted(omitted.sectionKeys || [])
      claims.push(claim)
    }
    if (new Set(claims.map((claim) => claim.claimKey)).size !== claims.length) invalid('claimKeys')
    claims.sort((a, b) => compare(a.claimKey, b.claimKey))
    const storedPlacementActive = v2 && sourceSnapshot.evidenceObjects.some((row) => Object.hasOwn(row, 'draftPlacement'))
    if (v2) claims = claims.map((claim) => enrichDraftClaim(claim, evidence.get(claim.evidenceReference), sources.get(claim.sourceReference), input))
    const claimsByEvidence = new Map(claims.map((claim) => [claim.evidenceReference, claim]))
    // Shared proof paths are evaluated once per compilation; visiting rejects cycles.
    const deficitsByEvidence = new Map()
    const visitingEvidence = new Set()
    const deficitsFor = (claim) => v2
      ? draftClaimDeficits(claim, claimsByEvidence, deficitsByEvidence, visitingEvidence)
      : supportDeficits(claim, claimsByEvidence, deficitsByEvidence, visitingEvidence)
    const all = [...target.targetSections.required.map((item) => ({ ...item, required: true })),
      ...target.targetSections.optional.map((item) => ({ ...item, required: false }))]
    for (const claim of storedPlacementActive ? [] : claims) {
      if (!claim.sectionKeys.length || new Set(claim.sectionKeys).size !== claim.sectionKeys.length
        || claim.sectionKeys.some((key) => !text(key) || !all.some((item) => item.targetSectionKey === key))) {
        invalid(`${claim.evidenceReference}.sectionMapping`)
      }
    }
    const bindings = input.sectionBindings || {}
    // Current selected-target receipts do not carry authenticated schema mappings.
    // Until that owner supplies them, allow exact source keys only, never caller mappings.
    if (!plain(bindings) || Object.keys(bindings).length) invalid('sectionBindings.authority')
    const contradictions = composition.businessFactLedger.contradictions.length > 0
      || Number(sourceSnapshot.discoveryHealth?.unresolvedContradictionCount || sourceSnapshot.discoveryHealth?.contradictionCount || 0) > 0
    sections = all.map((section) => {
      const keys = bindings[section.targetSectionKey] || [section.targetSectionKey]
      if (!Array.isArray(keys) || !keys.length || keys.some((key) => !text(key))
        || new Set(keys).size !== keys.length) invalid(`${section.targetSectionKey}.mapping`)
      const candidates = claims.filter((claim) => claim.sectionKeys.some((key) => keys.includes(key)))
      const admitted = candidates.filter((claim) => deficitsFor(claim).length === 0)
      const reasons = contradictions ? ['CONTRADICTION_UNRESOLVED'] : admitted.length ? []
        : candidates.length ? sorted([...new Set(candidates.flatMap(deficitsFor))]) : ['CUSTOMER_EVIDENCE_MISSING']
      return { ...section, sourceSectionKeys: keys, claimKeys: contradictions ? [] : admitted.map((claim) => claim.claimKey),
        evidenceReferences: candidates.map((claim) => claim.evidenceReference), reasons,
        status: reasons.length ? section.required ? 'UNRESOLVED' : 'OMITTED' : 'SUPPORTED',
        omissionPermitted: !section.required }
    })
    if (v2) sections = buildDraftSectionLedger({ input, claims, all, deficitsFor })
    const ordered = []
    const visited = new Set()
    const visit = (claim) => {
      if (visited.has(claim.claimKey)) return
      visited.add(claim.claimKey)
      if (Array.isArray(claim.proofDependency)) {
        for (const id of claim.proofDependency) if (claimsByEvidence.has(id)) visit(claimsByEvidence.get(id))
      }
      ordered.push(claim)
    }
    claims.forEach(visit)
    claims = ordered
  } catch (error) {
    // Integrity failure is a machine-readable clarification, never a provider retry.
    const field = error.details?.field || 'selectedTarget'
    const source = rawInput?.sourceSnapshot?.evidenceObjects?.find((item) => field.startsWith(`${item.evidenceObjectId}.`))
    errors.push({ code: 'INTEGRITY_INVALID', field, message: error.message,
      evidenceReference: source?.evidenceObjectId || '', sourceReference: source?.sourceId || '' })
    if (!input) {
      let rejectedInputFingerprint = null
      try { rejectedInputFingerprint = hashEvidenceToMeaningValue(rawInput) } catch { /* Non-JSON input has no admissible hash. */ }
      input = { rejectedInput: { field: error.details?.field || 'selectedTarget' }, rejectedInputFingerprint }
      if (rawInput?.rejectedInput) input = clone(rawInput)
    }
    const targetSections = input.selectedTarget?.receipt?.targetSections
    if (targetSections && Array.isArray(targetSections.required) && Array.isArray(targetSections.optional)) {
      sections = [...targetSections.required.map((section) => ({ ...section, required: true })),
        ...targetSections.optional.map((section) => ({ ...section, required: false }))].map((section) => ({
        ...section, status: 'UNRESOLVED', omissionPermitted: false, sourceSectionKeys: [], claimKeys: [],
        evidenceReferences: sorted([...new Set([...claims.map((claim) => claim.evidenceReference),
          ...errors.map((entry) => entry.evidenceReference).filter(Boolean)])]), reasons: ['INTEGRITY_INVALID'],
      }))
    }
  }
  const deficits = sections.filter((section) => section.required && section.status !== 'SUPPORTED')
  const readyStatus = v2 ? 'READY_TO_DRAFT' : 'READY'
  const status = errors.length || deficits.length ? 'CLARIFICATION_REQUIRED' : readyStatus
  const payload = {
    contractVersion: v2 ? 'evidence-to-draft.v2' : EVIDENCE_TO_MEANING_CONTRACT_VERSION, status, inputs: input,
    fingerprints: {
      request: hashEvidenceToMeaningValue(input.composition?.requestBinding || {}),
      runtime: hashEvidenceToMeaningValue({ runtime: input.composition?.runtimeBinding || {}, truth: input.composition?.truthBinding || {} }),
      output: hashEvidenceToMeaningValue({ selectedTarget: input.selectedTarget || {}, request: input.request || {} }),
      source: hashEvidenceToMeaningValue(input.sourceSnapshot || {}),
      composition: hashEvidenceToMeaningValue(input.composition || {}),
    },
    customerClaims: claims, sectionLedger: sections,
    ...(v2 ? buildDraftInventoryDisposition(input, claims, sections) : {}),
    frameworkGuidance: { label: 'FRAMEWORK_GUIDANCE_ONLY', content: input.composition?.frameworkIntelligence || null },
    lineage: { packs: input.composition?.outputBinding?.lineage || {}, truth: input.composition?.truthBinding || {} },
    restrictions: ['EXACT_STATEMENT_ONLY', 'NO_INVENTED_VALIDATION', 'NO_STRONGER_CLAIM', 'PRESERVE_ATTRIBUTION_QUALIFICATION_PROOF_ORDER'],
    clarification: { version: v2 ? 'evidence-to-draft-clarification.v2' : 'evidence-to-meaning-clarification.v1', required: status !== readyStatus,
      code: status === readyStatus ? '' : 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED',
      firstBoundary: errors[0]?.field || deficits[0]?.targetSectionKey || '', errors, affectedSections: deficits,
      missingFields: errors.map((error) => error.field),
      questions: [...errors.map((error) => ({ field: error.field,
        question: `Correct the governed source mapping or metadata at ${error.field}; re-read the source and recompile.`, reasons: [error.code] })),
      ...deficits.flatMap((section) => v2 ? section.clarificationQuestions || [] : [{ sectionKey: section.targetSectionKey,
        question: `Provide admissible customer evidence and stored proof metadata for ${section.heading}.`, reasons: section.reasons }])] },
  }
  const contractHash = hashEvidenceToMeaningValue(payload)
  return { ...payload, contractId: `etm_${contractHash}`, contractHash }
}

export const assertEvidenceToMeaningContract = (contract) => {
  if (!plain(contract)) invalid('contract')
  const { contractId, contractHash, ...payload } = contract
  if (contractId !== `etm_${contractHash}` || hashEvidenceToMeaningValue(payload) !== contractHash
    || compileEvidenceToMeaningContract(payload.inputs).contractHash !== contractHash) invalid('contract.hash')
  return contract
}

export const validateEvidenceToMeaningGeneratedClaims = ({ contract, claims }) => {
  assertEvidenceToMeaningContract(contract)
  if (!['READY', 'READY_TO_DRAFT'].includes(contract.status) || !Array.isArray(claims)) invalid('generatedClaims.readiness')
  const keys = new Set(contract.sectionLedger.filter((section) => section.status === 'SUPPORTED').flatMap((section) => section.claimKeys))
  const expected = contract.customerClaims.filter((claim) => keys.has(claim.claimKey))
  if (claims.length !== expected.length || claims.some((claim, index) => !exactKeys(claim, Object.keys(expected[index]))
    || !equal(claim, expected[index]))) invalid('generatedClaims.mappingOrMeaning')
  return claims
}
