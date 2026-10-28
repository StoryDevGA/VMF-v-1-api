import { WORKING_DRAFT_COMPOSITION_VERSIONS, composeEvidenceBoundWorkingDraftSections, workingDraftReaderHeading } from './outcomeWorkingDraftCompositionService.js'
import { assertEvidenceToMeaningContract, hashEvidenceToMeaningValue,
  validateEvidenceToMeaningGeneratedClaims } from './outcomeEvidenceToMeaningContractService.js'
import { assertOutcomeSelectedDocumentPrivacy } from './outcomeStudioProviderSafeContextService.js'
import { OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES } from './outcomeWorkingDraftMeaningBoundaryService.js'

export const EVIDENCE_TO_MEANING_PROVIDER_VERSION = 'evidence-to-meaning-provider.v1'
export const EVIDENCE_TO_DRAFT_PROVIDER_VERSION = 'evidence-to-draft-provider.v2'
const same = (left, right) => hashEvidenceToMeaningValue(left) === hashEvidenceToMeaningValue(right)
const fail = (contract, field) => { throw Object.assign(new Error('The selected draft schema needs clarification before generation.'), {
  status: 409, code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED', details: {
    reason: 'PROVIDER_SCHEMA_REPRESENTATION_UNRESOLVED', contractId: contract.contractId,
    contractHash: contract.contractHash, fingerprints: contract.fingerprints, sectionLedger: contract.sectionLedger,
    clarification: { version: 'evidence-to-meaning-clarification.v1', required: true,
      code: 'EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED', firstBoundary: 'PROVIDER_SCHEMA_REPRESENTATION_UNRESOLVED',
      missingFields: [field], affectedSections: contract.sectionLedger,
      questions: [{ field, question: 'Which stored evidence supports this required draft field, or which compatible output schema should be selected?' }] },
  },
}) }
const content = (value, contract, field, max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(contract, field)
  try { assertOutcomeSelectedDocumentPrivacy(value) } catch { fail(contract, field) }
  return value
}
const supportedClaims = (contract) => {
  const keys = new Set(contract.sectionLedger.filter((section) => section.status === 'SUPPORTED').flatMap((section) => section.claimKeys))
  return contract.customerClaims.filter((claim) => keys.has(claim.claimKey))
}
const assertProjectionPrivacy = (value, contract, field = '') => {
  if (typeof value === 'string' && value.trim()) {
    try { assertOutcomeSelectedDocumentPrivacy(value) } catch { fail(contract, field) }
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => assertProjectionPrivacy(entry, contract, `${field}[${index}]`))
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => assertProjectionPrivacy(entry, contract, field ? `${field}.${key}` : key))
  }
}

const expandProviderClaims = projection => {
  if (projection.contractVersion !== EVIDENCE_TO_DRAFT_PROVIDER_VERSION) return projection.customerClaims
  const dictionary = projection.claimMetadataDictionary
  if (projection.claimMetadataRepresentationVersion !== 'claim-metadata.dictionary.v1'
    || !dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) fail(projection, 'providerProjection.claimMetadataDictionary')
  const refs = [...new Set(projection.customerClaims.map(row => row.metadataRef))].sort()
  if (!same(refs, Object.keys(dictionary).sort()) || Object.entries(dictionary).some(([key, row]) => !row
    || Object.keys(row).sort().join(',') !== 'blockedStrongerClaim,qualification,scope,time'
    || hashEvidenceToMeaningValue(row) !== key)) fail(projection, 'providerProjection.claimMetadataDictionary')
  return projection.customerClaims.map(row => {
    if (['scope', 'time', 'qualification', 'blockedStrongerClaim'].some(key => Object.hasOwn(row, key))) fail(projection, 'providerProjection.claimMetadataAmbiguity')
    const { metadataRef, ...claim } = row
    return { ...claim, ...dictionary[metadataRef] }
  })
}

export const projectEvidenceToMeaningProviderContract = (contract) => {
  assertEvidenceToMeaningContract(contract)
  const v2 = contract.contractVersion === 'evidence-to-draft.v2'
  if (contract.status !== (v2 ? 'READY_TO_DRAFT' : 'READY')) fail(contract, 'contract.readiness')
  const claims = supportedClaims(contract)
  validateEvidenceToMeaningGeneratedClaims({ contract, claims })
  const sectionClaimOrder = contract.sectionLedger.filter((section) => section.status === 'SUPPORTED').flatMap((section) => section.claimKeys)
  if (!v2 && !same(sectionClaimOrder, claims.map((claim) => claim.claimKey))) fail(contract, 'selectedSchema.proofOrder')
  const claimProjections = claims.map((claim) => {
    const stored = contract.inputs.sourceSnapshot.evidenceObjects.find((item) => item.evidenceObjectId === claim.evidenceReference)
    const field = `claims.${claim.claimKey}`
    const requirements = v2 ? claim.evidenceRequiredToSubstantiate : stored?.evidenceRequiredToSubstantiate
    if (!Array.isArray(requirements) || !requirements.length
      || requirements.length > 10) fail(contract, `${field}.evidenceRequiredToSubstantiate`)
    if (!Array.isArray(claim.blockedStrongerClaim) || !claim.blockedStrongerClaim.length
      || claim.blockedStrongerClaim.length > (v2 ? 10 : 1)) fail(contract, `${field}.blockedStrongerClaim`)
    const blockedStrongerClaim = claim.blockedStrongerClaim.map(value => content(value, contract, `${field}.blockedStrongerClaim`)).join('\n')
    if (claim.attribution.stored !== null && typeof claim.attribution.stored !== 'string') fail(contract, `${field}.attribution`)
    const codes = v2 ? claim.proofRequirementCodes : claim.proofDependency
    if (!Array.isArray(codes) || codes.some((dependency) => !OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES.includes(dependency))) fail(contract, `${field}.proofRequirementCodes`)
    const evidence = [content(claim.statement, contract, `${field}.statement`),
      content(claim.attribution.sourceLabel, contract, `${field}.sourceLabel`),
      ...(claim.attribution.stored === null ? [] : [content(claim.attribution.stored, contract, `${field}.attribution`)]),
      ...claim.qualification.map((value) => content(value, contract, `${field}.qualification`))]
    if (evidence.length > 20) fail(contract, `${field}.evidence`)
    return { claimKey: claim.claimKey, statement: claim.statement, truthReferences: claim.sectionKeys,
      evidence, meaningClass: 'QUALIFIED', proofDependencies: codes,
      validationStatus: !v2 || claim.validationStatus === 'VALIDATED' ? 'SOURCE_REPORTED_VALIDATED' : 'SOURCE_REPORTED_REQUIRES_VALIDATION',
      proofDisposition: v2 && claim.proofOrderDisposition === 'NOT_ESTABLISHED' ? 'NOT_ESTABLISHED' : 'SOURCE_SPECIFIED',
      whatCanBeSaidNow: claim.statement,
      blockedStrongerClaim: content(blockedStrongerClaim, contract, `${field}.blockedStrongerClaim`),
      evidenceRequiredToSubstantiate: requirements.map((value) => content(value, contract, `${field}.evidenceRequiredToSubstantiate`)) }
  })
  // Share exact repeated omission arrays; preserve order and content in the
  // dictionary, while retaining every section's binding. No truncation.
  const omissionDictionary = {}
  const claimMetadataDictionary = {}
  const customerClaims = v2 ? claims.map(claim => {
    const { scope, time, qualification, blockedStrongerClaim, ...row } = claim
    const metadata = { scope, time, qualification, blockedStrongerClaim }
    const metadataRef = hashEvidenceToMeaningValue(metadata)
    claimMetadataDictionary[metadataRef] = metadata
    return { ...row, metadataRef }
  }) : claims
  const sectionLedger = v2 ? contract.sectionLedger.map(section => {
    const { omissions, ...row } = section
    const omissionsRef = hashEvidenceToMeaningValue(omissions)
    omissionDictionary[omissionsRef] = omissions
    return { ...row, omissionsRef, ...(section.status === 'OPTIONAL' ? { status: 'OMITTED', readinessStatus: 'OPTIONAL' } : {}) }
  }) : contract.sectionLedger
  const projection = { contractVersion: v2 ? EVIDENCE_TO_DRAFT_PROVIDER_VERSION : EVIDENCE_TO_MEANING_PROVIDER_VERSION,
    contractId: contract.contractId, contractHash: contract.contractHash, fingerprints: contract.fingerprints,
    sectionLedger, ...(v2 ? { omissionRepresentationVersion: 'section-omissions.dictionary.v1', omissionDictionary } : {}),
    customerClaims, claimProjections,
    ...(v2 ? { claimMetadataRepresentationVersion: 'claim-metadata.dictionary.v1', claimMetadataDictionary } : {}),
    frameworkGuidance: contract.frameworkGuidance,
    decisionProjections: claimProjections.map((claim) => ({ decisionKey: `decision_${claim.claimKey}`,
      rationale: claim.statement, priority: 'NOT_ESTABLISHED', priorityBasis: 'NOT_ESTABLISHED',
      closureState: 'INCOMPLETE', actionAuthorization: 'NONE', truthReferences: claim.truthReferences })) }
  assertProjectionPrivacy(projection, contract)
  if (Buffer.byteLength(JSON.stringify(projection)) > 120000) fail(contract, 'providerContext.size')
  return { ...projection, projectionHash: hashEvidenceToMeaningValue(projection) }
}

export const assertEvidenceToMeaningProviderClaims = ({ contract, output }) => {
  const projection = projectEvidenceToMeaningProviderContract(contract)
  assertEvidenceToMeaningBoundedProviderOutput({ projection, output })
  return projection
}

export const assertEvidenceToMeaningProviderProjection = (projection) => {
  const { projectionHash, ...payload } = projection || {}
  if (![EVIDENCE_TO_MEANING_PROVIDER_VERSION, EVIDENCE_TO_DRAFT_PROVIDER_VERSION].includes(payload.contractVersion)
    || payload.contractId !== `etm_${payload.contractHash}`
    || hashEvidenceToMeaningValue(payload) !== projectionHash
    || !Array.isArray(payload.customerClaims) || !Array.isArray(payload.claimProjections)
    || !Array.isArray(payload.sectionLedger) || !Array.isArray(payload.decisionProjections)
    || Buffer.byteLength(JSON.stringify(projection)) > 120000) fail(payload, 'providerProjection.integrity')
  assertProjectionPrivacy(payload, payload)
  if (payload.contractVersion === EVIDENCE_TO_DRAFT_PROVIDER_VERSION) {
    const normalized = ['omissionRepresentationVersion', 'omissionDictionary', 'claimMetadataRepresentationVersion', 'claimMetadataDictionary']
      .some(key => Object.hasOwn(payload, key))
    if (normalized) {
      expandProviderClaims(payload)
      const references = new Set(payload.sectionLedger.map(section => section.omissionsRef))
      if (payload.omissionRepresentationVersion !== 'section-omissions.dictionary.v1'
        || !payload.omissionDictionary || typeof payload.omissionDictionary !== 'object' || Array.isArray(payload.omissionDictionary)
        || !same([...references].sort(), Object.keys(payload.omissionDictionary).sort())
        || payload.sectionLedger.some(section => Object.hasOwn(section, 'omissions'))
        || Object.entries(payload.omissionDictionary).some(([key, rows]) => !Array.isArray(rows)
          || hashEvidenceToMeaningValue(rows) !== key)) fail(payload, 'providerProjection.omissionDictionary')
    } else if (payload.sectionLedger.some(section => !Array.isArray(section.omissions) || Object.hasOwn(section, 'omissionsRef'))
      || payload.customerClaims.some(claim => Object.hasOwn(claim, 'metadataRef'))) fail(payload, 'providerProjection.legacyMetadataShape')
    const keys = payload.customerClaims.map((claim) => claim.claimKey)
    const sections = payload.sectionLedger.filter((section) => section.status === 'SUPPORTED')
    if (new Set(keys).size !== keys.length || !same(keys, payload.claimProjections.map((claim) => claim.claimKey))
      || new Set(payload.sectionLedger.map((section) => section.targetSectionKey)).size !== payload.sectionLedger.length
      || payload.sectionLedger.some((section) => section.status !== 'SUPPORTED' && (section.status !== 'OMITTED' || section.readinessStatus !== 'OPTIONAL' || !section.omissionPermitted))
      || sections.some((section) => !section.claimKeys.length || new Set(section.claimKeys).size !== section.claimKeys.length
        || section.claimKeys.some((key) => !keys.includes(key)))
      || payload.customerClaims.some((claim) => !same(claim.sectionKeys,
        sections.filter((section) => section.claimKeys.includes(claim.claimKey)).map((section) => section.targetSectionKey).sort()))) {
      fail(payload, 'providerProjection.claimSectionIdentity')
    }
  }
  return projection
}

export const expandEvidenceToMeaningProviderClaims = projection => {
  assertEvidenceToMeaningProviderProjection(projection)
  return projection.claimMetadataRepresentationVersion ? expandProviderClaims(projection) : projection.customerClaims
}

export const assertEvidenceToMeaningProviderRequestSize = ({ projection, requestBody, maxBytes = 200000 }) => {
  if (Buffer.byteLength(JSON.stringify(requestBody)) > maxBytes) fail(projection, 'providerContext.requestSize')
}

export const assertEvidenceToMeaningBoundedProviderOutput = ({ projection, output }) => {
  assertEvidenceToMeaningProviderProjection(projection)
  const v2 = projection.contractVersion === EVIDENCE_TO_DRAFT_PROVIDER_VERSION
  if (v2) assertProjectionPrivacy(output, projection, 'generatedOutput')
  const claims = output?.sections?.flatMap((section) => section.claims || [])
  const expectedClaims = v2 ? projection.sectionLedger.filter((section) => section.status === 'SUPPORTED')
    .flatMap((section) => section.claimKeys.map((key) => projection.claimProjections.find((claim) => claim.claimKey === key))) : projection.claimProjections
  if (!same(claims, expectedClaims)) fail(projection, 'generatedClaims.mappingOrMeaning')
  const composed = Object.hasOwn(output, 'compositionVersion')
  if (composed && (!v2 || !WORKING_DRAFT_COMPOSITION_VERSIONS.includes(output.compositionVersion))) fail(projection, 'generatedComposition.version')
  const composedSections = composed ? composeEvidenceBoundWorkingDraftSections(projection, output.compositionVersion) : null
  if (output.decisionLogic && !same(output.decisionLogic, projection.decisionProjections)) fail(projection, 'generatedDecisionLogic.mappingOrMeaning')
  if (!Array.isArray(output?.sections) || output.assumptions?.length || output.sections.some((section) => section.assumptions?.length)) fail(projection, 'generatedAssumptions.unsupported')
  if (output.title !== undefined && output.title !== 'Working Draft') fail(projection, 'generatedTitle.unsupported')
  const sections = projection.sectionLedger.filter((section) => section.status === 'SUPPORTED')
  if (output.sections.length !== sections.length) fail(projection, 'generatedSections.coverage')
  for (let index = 0; index < sections.length; index += 1) {
    const expected = sections[index], actual = output.sections[index]
    if (actual.sectionKey !== expected.targetSectionKey || actual.title !== workingDraftReaderHeading(expected, output.compositionVersion)
      || !same(actual.claims.map((claim) => claim.claimKey), expected.claimKeys)
      || (output.visibleGaps && !same(actual.gaps || [], output.visibleGaps))
      || actual.content !== (composed ? composedSections[index].content : actual.claims.map((claim) => claim.statement).join(' '))) fail(projection, 'generatedSections.mappingOrMeaning')
  }
  return projection
}
