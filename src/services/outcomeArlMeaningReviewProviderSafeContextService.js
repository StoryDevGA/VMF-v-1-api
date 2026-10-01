import {
  OUTCOME_ARL_MEANING_REVIEW_PROVIDER_SAFE_CONTEXT_VERSION,
  OUTCOME_WORKING_DRAFT_PROOF_DISPOSITIONS,
  OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
  OUTCOME_WORKING_DRAFT_VALIDATION_STATUSES,
} from '../constants/outcomeGovernedQuality.js'
import { assertEvidenceToMeaningProviderProjection, assertEvidenceToMeaningBoundedProviderOutput } from './outcomeEvidenceToMeaningProviderService.js'
import { OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY } from '../constants/outcomeStudioReadiness.js'
import {
  assertOutcomeMethodDocumentPrivacy,
  assertOutcomeStudioProviderSafeContext,
  assertOutcomeStudioProviderSafeRequest,
  assertOutcomeStudioProviderSafeValue,
  OUTCOME_STUDIO_EXECUTION_EVIDENCE_CONTRACT,
  OUTCOME_STUDIO_PROVIDER_SAFEGUARDS,
} from './outcomeStudioProviderSafeContextService.js'
import { assertOutcomeMethodDocument, projectOutcomeMethodDocumentReceipt } from './outcomeMethodDocumentService.js'
import { hashOutcomeQualityStageValue } from './outcomeQualityStageExecutionService.js'
import {
  OUTCOME_WORKING_DRAFT_MEANING_CLASSES,
  OUTCOME_WORKING_DRAFT_PRIORITY_BASES,
  OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES,
} from './outcomeWorkingDraftMeaningBoundaryService.js'

const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const fail = () => { throw new TypeError('ARL meaning review provider context is invalid.') }
const string = (value, max) => typeof value === 'string' && value.trim() && value.length <= max
const strings = (value, max = 50) => Array.isArray(value) && value.length <= max
  && value.every((item) => string(item, 2000))
const array = (value, max) => Array.isArray(value) && value.length > 0 && value.length <= max
const meaningClaimKeys = [
  'claimKey', 'statement', 'truthReferences', 'evidence', 'meaningClass', 'proofDependencies',
  'validationStatus', 'proofDisposition', 'whatCanBeSaidNow', 'blockedStrongerClaim', 'evidenceRequiredToSubstantiate',
]
const legacyClaimKeys = ['claimKey', 'statement', 'truthReferences', 'evidence']
const meaningDecisionKeys = ['decisionKey', 'rationale', 'priority', 'priorityBasis', 'closureState', 'actionAuthorization', 'truthReferences']
const legacyDecisionKeys = ['decisionKey', 'rationale', 'priority', 'truthReferences']

export const projectArlTruthSummaries = (truthSource = {}) => {
  if (!array(truthSource.acceptedTruth, 20)) fail()
  const labels = new Set()
  const result = []
  let bytes = 0
  for (const entry of truthSource.acceptedTruth) {
    const label = entry?.label
    if (typeof label !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,179}$/.test(label) || labels.has(label)) fail()
    labels.add(label)
    if (typeof entry.content !== 'string') fail()
    const content = entry.content.replace(/https?:\/\/\S+/gi, '[source link omitted]').replace(/\s+/g, ' ').trim()
    const size = Buffer.byteLength(content, 'utf8')
    bytes += size
    if (!content || size > 9000 || bytes > 12000) fail()
    assertOutcomeStudioProviderSafeValue(content)
    let summary = ''
    for (const character of content) {
      if (summary.length + character.length > 900) {
        result.push({ label, summary })
        summary = ''
      }
      summary += character
    }
    if (summary) result.push({ label, summary })
    if (result.length > 20) fail()
  }
  return result
}

const guidance = {
  businessInstructions: ['Review the immutable Working Draft meaning against the complete accepted truth. Repeated labels are contiguous ordered parts of one source; concatenate them without adding separators. Do not rewrite it.'],
  reasoningGuidance: ['Apply every chunk of the selected ARL method in order. Review analytical strength, coherence, prioritisation, evidence use and decision usefulness.'],
  outputSchema: ['Return exactly five findings and PASS only if no change is required.'],
  styleGuidance: ['Use concise findings without internal identifiers or hidden reasoning.'],
  validationCriteria: ['Preserve evidence restrictions, assumptions and gaps. Identify unsupported claims and decision logic.'],
  prohibitedOutputBoundaries: ['Do not rewrite meaning, apply changes, approve a draft, publish, or claim final disposition.'],
}

const assertCandidate = (candidate) => {
  if (!exact(candidate, ['title', 'sections', 'decisionLogic', 'assumptions', 'visibleGaps'])
    || !string(candidate.title, 255) || !array(candidate.sections, 20)
    || !array(candidate.decisionLogic, 30) || !strings(candidate.assumptions, 20)
    || !strings(candidate.visibleGaps)) fail()
  candidate.sections.forEach((section, index) => {
    if (!exact(section, ['order', 'sectionKey', 'title', 'content', 'claims', 'truthReferences', 'assumptions', 'gaps'])
      || section.order !== index + 1 || !string(section.sectionKey, 140) || !string(section.title, 255)
      || !string(section.content, 16000) || !array(section.claims, 50)
      || !strings(section.truthReferences) || !section.truthReferences.length
      || !strings(section.assumptions, 20) || !strings(section.gaps, 20)) fail()
    section.claims.forEach((claim) => {
      const meaningBoundaryClaim = exact(claim, meaningClaimKeys)
      if ((!meaningBoundaryClaim && !exact(claim, legacyClaimKeys))
        || !string(claim.claimKey, 140) || !string(claim.statement, 4000)
        || !strings(claim.truthReferences, 20) || !claim.truthReferences.length
        || !strings(claim.evidence, 20) || !claim.evidence.length) fail()
      if (meaningBoundaryClaim
        && (!OUTCOME_WORKING_DRAFT_MEANING_CLASSES.includes(claim.meaningClass)
          || !Array.isArray(claim.proofDependencies)
          || claim.proofDependencies.length > OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES.length
          || claim.proofDependencies.some((dependency) => !OUTCOME_WORKING_DRAFT_PROOF_DEPENDENCIES.includes(dependency))
          || !OUTCOME_WORKING_DRAFT_VALIDATION_STATUSES.includes(claim.validationStatus)
          || !OUTCOME_WORKING_DRAFT_PROOF_DISPOSITIONS.includes(claim.proofDisposition)
          || !string(claim.whatCanBeSaidNow, 2000)
          || !string(claim.blockedStrongerClaim, 2000)
          || !array(claim.evidenceRequiredToSubstantiate, 10)
          || !strings(claim.evidenceRequiredToSubstantiate, 10))) fail()
    })
  })
  candidate.decisionLogic.forEach((item) => {
    const meaningBoundaryDecision = exact(item, meaningDecisionKeys)
    if ((!meaningBoundaryDecision && !exact(item, legacyDecisionKeys))
        || !string(item.decisionKey, 140) || !string(item.rationale, 4000)
        || !string(item.priority, 100)
        || !strings(item.truthReferences, 20) || !item.truthReferences.length) fail()
    if (meaningBoundaryDecision
      && (!OUTCOME_WORKING_DRAFT_PRIORITY_BASES.includes(item.priorityBasis)
        || item.closureState !== 'INCOMPLETE'
        || item.actionAuthorization !== 'NONE')) fail()
  })
  if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > 140000) fail()
  assertOutcomeStudioProviderSafeValue(candidate)
}

export const assertOutcomeArlMeaningReviewProviderSafeContext = (value) => {
  if (!exact(value, ['contractVersion', 'businessRequest', 'draftContext', 'truthSummaries',
    'guidance', 'safeguards', 'targetStage', 'candidate', 'methodDocument', ...(value?.evidenceToMeaning ? ['evidenceToMeaning'] : [])])
    || value.contractVersion !== OUTCOME_ARL_MEANING_REVIEW_PROVIDER_SAFE_CONTEXT_VERSION
    || value.targetStage !== 'ARL_MEANING_REVIEW' || !array(value.truthSummaries, 20)) fail()
  assertOutcomeMethodDocument(value.methodDocument, { role: 'ARL', boundary: 'GENERATION_CONTEXT' })
  assertOutcomeMethodDocumentPrivacy(value.methodDocument)
  assertOutcomeStudioProviderSafeContext({
    contractVersion: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
    businessRequest: value.businessRequest,
    draftContext: value.draftContext,
    truthSummaries: value.truthSummaries,
    guidance: value.guidance,
    safeguards: value.safeguards,
  })
  assertCandidate(value.candidate)
  if (value.evidenceToMeaning) {
    assertEvidenceToMeaningProviderProjection(value.evidenceToMeaning)
    assertEvidenceToMeaningBoundedProviderOutput({ projection: value.evidenceToMeaning, output: value.candidate })
  }
  return value
}

export const buildOutcomeArlMeaningReviewProviderSafeContext = ({
  methodDocument,
  methodSelection,
  captureExecutionEvidence,
  knowledgeSelection,
  providerDescriptor,
  safeRequest,
  sourceStageExecution,
  truthSource,
  targetStageKey,
  evidenceToMeaning = null,
} = {}) => {
  if (providerDescriptor?.safeContextPolicyKey !== OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY
    || targetStageKey !== 'ARL_MEANING_REVIEW' || !Array.isArray(knowledgeSelection)
    || knowledgeSelection.length !== 1) fail()
  assertOutcomeStudioProviderSafeRequest(safeRequest)
  assertOutcomeMethodDocument(methodDocument, { role: 'ARL', boundary: 'GENERATION_CONTEXT' })
  const selection = knowledgeSelection[0]
  if (selection.packType !== 'ARL' || methodSelection?.boundary !== 'GENERATION_CONTEXT'
    || ['versionId', 'packType', 'knowledgeLayer', 'executionMode'].some((key) => selection[key] !== methodSelection[key])
    || ['packId', 'packKey', 'versionId', 'semanticVersion', 'contentHash']
      .some((key) => methodSelection[key] !== methodDocument.source[key])) fail()
  const source = sourceStageExecution?.toObject ? sourceStageExecution.toObject() : sourceStageExecution
  const output = source?.outputSnapshot
  if (source?.stageKey !== 'WORKING_DRAFT' || source.status !== 'SUCCEEDED' || source.stageOrder !== 2
    || output?.outputType !== 'WORKING_DRAFT' || output.schemaVersion !== OUTCOME_WORKING_DRAFT_SCHEMA_VERSION
    || source.outputFingerprint !== hashOutcomeQualityStageValue(output)) fail()
  const candidate = {
    title: output.title,
    sections: output.sections.map(({ order, sectionKey, title, content, claims, truthReferences, assumptions, gaps }) => ({
      order,
      sectionKey,
      title,
      content,
      claims: claims.map((claim) => ({
        claimKey: claim.claimKey,
        statement: claim.statement,
        truthReferences: claim.truthReferences,
        evidence: claim.evidence,
        ...(Object.prototype.hasOwnProperty.call(claim, 'meaningClass')
          ? {
              meaningClass: claim.meaningClass,
              proofDependencies: claim.proofDependencies,
              validationStatus: claim.validationStatus,
              proofDisposition: claim.proofDisposition,
              whatCanBeSaidNow: claim.whatCanBeSaidNow,
              blockedStrongerClaim: claim.blockedStrongerClaim,
              evidenceRequiredToSubstantiate: claim.evidenceRequiredToSubstantiate,
            }
          : {}),
      })),
      truthReferences,
      assumptions,
      gaps,
    })),
    decisionLogic: output.decisionLogic.map((decision) => ({
      decisionKey: decision.decisionKey,
      rationale: decision.rationale,
      priority: decision.priority,
      truthReferences: decision.truthReferences,
      ...(Object.prototype.hasOwnProperty.call(decision, 'priorityBasis')
        ? {
          priorityBasis: decision.priorityBasis,
          closureState: decision.closureState,
          actionAuthorization: decision.actionAuthorization,
        }
        : {}),
    })),
    assumptions: output.assumptions,
    visibleGaps: output.visibleGaps,
  }
  const context = assertOutcomeArlMeaningReviewProviderSafeContext({
    contractVersion: OUTCOME_ARL_MEANING_REVIEW_PROVIDER_SAFE_CONTEXT_VERSION,
    businessRequest: { ...safeRequest.businessRequest },
    draftContext: { ...safeRequest.draftContext },
    truthSummaries: projectArlTruthSummaries(truthSource),
    guidance: Object.fromEntries(Object.entries(guidance).map(([key, values]) => [key, [...values]])),
    safeguards: [...OUTCOME_STUDIO_PROVIDER_SAFEGUARDS],
    targetStage: 'ARL_MEANING_REVIEW',
    candidate,
    methodDocument,
    ...(evidenceToMeaning ? { evidenceToMeaning } : {}),
  })
  if (typeof captureExecutionEvidence === 'function') captureExecutionEvidence({
    contractVersion: OUTCOME_STUDIO_EXECUTION_EVIDENCE_CONTRACT,
    providerContextContractVersion: OUTCOME_ARL_MEANING_REVIEW_PROVIDER_SAFE_CONTEXT_VERSION,
    methodDocumentReceipts: [projectOutcomeMethodDocumentReceipt(methodDocument)],
    packs: [{
      ...projectOutcomeMethodDocumentReceipt(methodDocument),
      packType: 'ARL',
      knowledgeLayer: selection.knowledgeLayer,
      executionMode: selection.executionMode,
      suppliedEntryCount: methodDocument.chunks.length,
      status: 'NOT_RECORDED',
      checks: [{ key: 'PROVIDER_COMPLETED', status: 'NOT_RECORDED', message: 'Awaiting provider completion.' }],
    }],
  })
  return context
}
