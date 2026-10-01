import { assertEvidenceToMeaningContract, hashEvidenceToMeaningValue,
  validateEvidenceToMeaningGeneratedClaims } from './outcomeEvidenceToMeaningContractService.js'
import { assertOutcomeSelectedDocumentPrivacy } from './outcomeStudioProviderSafeContextService.js'
import { OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES } from './outcomeWorkingDraftMeaningBoundaryService.js'

export const EVIDENCE_TO_MEANING_PROVIDER_VERSION = 'evidence-to-meaning-provider.v1'
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

export const projectEvidenceToMeaningProviderContract = (contract) => {
  assertEvidenceToMeaningContract(contract)
  if (contract.status !== 'READY') fail(contract, 'contract.readiness')
  const claims = supportedClaims(contract)
  validateEvidenceToMeaningGeneratedClaims({ contract, claims })
  const sectionClaimOrder = contract.sectionLedger.filter((section) => section.status === 'SUPPORTED').flatMap((section) => section.claimKeys)
  if (!same(sectionClaimOrder, claims.map((claim) => claim.claimKey))) fail(contract, 'selectedSchema.proofOrder')
  const claimProjections = claims.map((claim) => {
    const stored = contract.inputs.sourceSnapshot.evidenceObjects.find((item) => item.evidenceObjectId === claim.evidenceReference)
    const field = `claims.${claim.claimKey}`
    if (!Array.isArray(stored?.evidenceRequiredToSubstantiate) || !stored.evidenceRequiredToSubstantiate.length
      || stored.evidenceRequiredToSubstantiate.length > 10) fail(contract, `${field}.evidenceRequiredToSubstantiate`)
    if (!Array.isArray(claim.blockedStrongerClaim) || claim.blockedStrongerClaim.length !== 1) fail(contract, `${field}.blockedStrongerClaim`)
    if (claim.attribution.stored !== null && typeof claim.attribution.stored !== 'string') fail(contract, `${field}.attribution`)
    if (claim.proofDependency.some((dependency) => !OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES.includes(dependency))) fail(contract, `${field}.proofDependency`)
    const evidence = [content(claim.statement, contract, `${field}.statement`),
      content(claim.attribution.sourceLabel, contract, `${field}.sourceLabel`),
      ...(claim.attribution.stored === null ? [] : [content(claim.attribution.stored, contract, `${field}.attribution`)]),
      ...claim.qualification.map((value) => content(value, contract, `${field}.qualification`))]
    if (evidence.length > 20) fail(contract, `${field}.evidence`)
    return { claimKey: claim.claimKey, statement: claim.statement, truthReferences: claim.sectionKeys,
      evidence, meaningClass: 'QUALIFIED', proofDependencies: claim.proofDependency,
      validationStatus: 'SOURCE_REPORTED_VALIDATED', proofDisposition: 'SOURCE_SPECIFIED',
      whatCanBeSaidNow: claim.statement,
      blockedStrongerClaim: content(claim.blockedStrongerClaim[0], contract, `${field}.blockedStrongerClaim`),
      evidenceRequiredToSubstantiate: stored.evidenceRequiredToSubstantiate.map((value) => content(value, contract, `${field}.evidenceRequiredToSubstantiate`)) }
  })
  const projection = { contractVersion: EVIDENCE_TO_MEANING_PROVIDER_VERSION,
    contractId: contract.contractId, contractHash: contract.contractHash, fingerprints: contract.fingerprints,
    sectionLedger: contract.sectionLedger, customerClaims: claims, claimProjections,
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
  if (payload.contractVersion !== EVIDENCE_TO_MEANING_PROVIDER_VERSION
    || payload.contractId !== `etm_${payload.contractHash}`
    || hashEvidenceToMeaningValue(payload) !== projectionHash
    || !Array.isArray(payload.customerClaims) || !Array.isArray(payload.claimProjections)
    || !Array.isArray(payload.sectionLedger) || !Array.isArray(payload.decisionProjections)
    || Buffer.byteLength(JSON.stringify(projection)) > 120000) fail(payload, 'providerProjection.integrity')
  assertProjectionPrivacy(payload, payload)
  return projection
}

export const assertEvidenceToMeaningProviderRequestSize = ({ projection, requestBody, maxBytes = 200000 }) => {
  if (Buffer.byteLength(JSON.stringify(requestBody)) > maxBytes) fail(projection, 'providerContext.requestSize')
}

export const assertEvidenceToMeaningBoundedProviderOutput = ({ projection, output }) => {
  assertEvidenceToMeaningProviderProjection(projection)
  const claims = output?.sections?.flatMap((section) => section.claims || [])
  if (!same(claims, projection.claimProjections)) fail(projection, 'generatedClaims.mappingOrMeaning')
  if (output.decisionLogic && !same(output.decisionLogic, projection.decisionProjections)) fail(projection, 'generatedDecisionLogic.mappingOrMeaning')
  if (output.assumptions?.length || output.sections.some((section) => section.assumptions?.length)) fail(projection, 'generatedAssumptions.unsupported')
  if (output.title !== undefined && output.title !== 'Working Draft') fail(projection, 'generatedTitle.unsupported')
  const sections = projection.sectionLedger.filter((section) => section.status === 'SUPPORTED')
  if (output.sections.length !== sections.length) fail(projection, 'generatedSections.coverage')
  for (let index = 0; index < sections.length; index += 1) {
    const expected = sections[index], actual = output.sections[index]
    if (actual.sectionKey !== expected.targetSectionKey || actual.title !== expected.heading
      || !same(actual.claims.map((claim) => claim.claimKey), expected.claimKeys)
      || (output.visibleGaps && !same(actual.gaps || [], output.visibleGaps))
      || actual.content !== actual.claims.map((claim) => claim.statement).join(' ')) fail(projection, 'generatedSections.mappingOrMeaning')
  }
  return projection
}
