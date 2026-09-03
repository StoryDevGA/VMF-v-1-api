import { buildRuntimeSectionReasoningProviderRuntime } from '../config/runtimeSectionReasoningProvider.js'
import {
  buildEnrichedGeneratedSection,
  getAcceptedDiscoveryEvidenceObjects,
  hashSectionInput,
} from './runtimeSectionModelService.js'
import { requiresVmfSectionReasoning } from './sectionExecutionContractService.js'

export const VMF_SECTION_REASONING_CONTRACT_VERSION = 'ss-016-vmf-section-reasoning-v1'
const VMF_SECTION_REASONING_COVERAGE_VERSION = 'ss-016-vmf-full-evidence-v2'
const MAX_ADDITIONAL_CONTEXT_CHARS = 4000
const MAX_SECTION_INTELLIGENCE_BYTES = 56 * 1024

const text = (value) => String(value || '').trim()
const normalized = (value) => text(value).normalize('NFKC').toLowerCase()
const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')

const COMMON_DIMENSIONS = Object.freeze([
  Object.freeze({ key: 'commercial_context', keywords: ['commercial', 'market', 'position', 'proposition', 'revenue', 'growth', 'value'] }),
  Object.freeze({ key: 'strategic_tension', keywords: ['tension', 'investor', 'board', 'strategy', 'strategic', 'narrative', 'pressure', 'risk'] }),
  Object.freeze({ key: 'proof_claim_boundaries', keywords: ['proof', 'claim', 'represented', 'validated', 'evidence', 'roi', 'tco', 'financial', 'unsupported'] }),
  Object.freeze({ key: 'decision_handoff', keywords: ['decision', 'outcome', 'priority', 'implication', 'readiness', 'recommend', 'requirement'] }),
])

const SECTION_DIMENSIONS = Object.freeze({
  customer_context: Object.freeze([
    Object.freeze({ key: 'customer_offer_identity', keywords: ['company', 'customer', 'offer', 'product', 'platform', 'business', 'website'] }),
    Object.freeze({ key: 'buyer_operating_context', keywords: ['buyer', 'stakeholder', 'audience', 'infrastructure', 'operation', 'hybrid', 'container', 'complexity'] }),
  ]),
  strategic_objectives: Object.freeze([
    Object.freeze({ key: 'objective_intent', keywords: ['objective', 'goal', 'priority', 'strategy', 'target', 'ambition', 'outcome'] }),
    Object.freeze({ key: 'objective_measurement', keywords: ['measure', 'metric', 'success', 'kpi', 'financial', 'growth', 'revenue', 'impact'] }),
  ]),
  current_state_assessment: Object.freeze([
    Object.freeze({ key: 'current_operating_state', keywords: ['current', 'today', 'existing', 'process', 'system', 'operation', 'capability', 'environment'] }),
    Object.freeze({ key: 'constraint_and_gap', keywords: ['constraint', 'gap', 'issue', 'problem', 'challenge', 'friction', 'risk', 'complexity'] }),
  ]),
  stakeholder_register: Object.freeze([
    Object.freeze({ key: 'stakeholder_identity', keywords: ['stakeholder', 'buyer', 'user', 'customer', 'leader', 'executive', 'team', 'role'] }),
    Object.freeze({ key: 'influence_and_need', keywords: ['influence', 'decision', 'need', 'priority', 'concern', 'objection', 'sponsor', 'owner'] }),
  ]),
  evidence_register: Object.freeze([
    Object.freeze({ key: 'evidence_and_source', keywords: ['evidence', 'source', 'document', 'website', 'fact', 'proof', 'reference', 'claim'] }),
    Object.freeze({ key: 'evidence_quality', keywords: ['validated', 'represented', 'restricted', 'unsupported', 'quality', 'confidence', 'diligence', 'traceability'] }),
  ]),
  output_requirements: Object.freeze([
    Object.freeze({ key: 'output_definition', keywords: ['output', 'deliverable', 'document', 'brief', 'paper', 'format', 'style', 'requirement'] }),
    Object.freeze({ key: 'audience_and_use', keywords: ['audience', 'reader', 'executive', 'decision', 'purpose', 'use', 'tone', 'action'] }),
  ]),
})

const reasoningDimensionsFor = (sectionKey) => [
  ...(SECTION_DIMENSIONS[normalized(sectionKey).replace(/-/g, '_')] || []),
  ...COMMON_DIMENSIONS,
]

const scoreDimension = (evidenceObject, dimension) => {
  const haystack = normalized([
    evidenceObject.coverageArea,
    evidenceObject.category,
    evidenceObject.extractedFact,
    evidenceObject.sourceId,
  ].filter(Boolean).join(' '))
  return dimension.keywords.reduce((score, keyword) => (
    haystack.includes(keyword) ? score + 1 : score
  ), 0)
}

export const buildVmfSectionReasoningCoverage = ({ evidenceObjects = [], sectionKey } = {}) => {
  const accepted = []
  const seen = new Map()
  evidenceObjects.forEach((evidenceObject) => {
    const evidenceObjectId = text(evidenceObject?.evidenceObjectId)
    const extractedFact = text(evidenceObject?.extractedFact)
    if (!evidenceObjectId || !extractedFact) return
    const projected = {
      evidenceObjectId,
      sourceId: text(evidenceObject.sourceId),
      excerpt: extractedFact,
      validationStatus: text(evidenceObject.validationStatus),
    }
    if (seen.has(evidenceObjectId)) {
      if (JSON.stringify(seen.get(evidenceObjectId)) !== JSON.stringify(projected)) {
        const error = new Error('Accepted evidence contains conflicting records for the same evidence identifier.')
        error.status = 409
        error.code = 'VMF_SECTION_REASONING_EVIDENCE_CONFLICT'
        throw error
      }
      return
    }
    seen.set(evidenceObjectId, projected)
    accepted.push({ evidenceObject, evidenceObjectId, extractedFact })
  })

  // Dimensions describe the input; they do not rank or remove evidence.
  // The provider's byte guards reject oversized contexts without sampling them.
  const dimensions = reasoningDimensionsFor(sectionKey)
  const dimensionCoverage = dimensions.map((dimension) => {
    const matchingCount = accepted.filter(({ evidenceObject }) => scoreDimension(evidenceObject, dimension) > 0).length
    return {
      dimensionKey: dimension.key,
      matchingCount,
      selectedCount: matchingCount,
    }
  })
  // The status at index i belongs to evidence[i]. This preserves stored labels
  // without repeating the metadata key hundreds of times in provider context.
  const validationStatusByEvidenceIndex = [...seen.values()].map((item) => item.validationStatus)
  const evidence = [...seen.values()].map(({ validationStatus, ...item }) => item)
  if (evidence.length === 0) {
    const error = new Error('No accepted evidence is available for VMF section reasoning.')
    error.status = 409
    error.code = 'VMF_SECTION_REASONING_EVIDENCE_MISSING'
    throw error
  }

  const allEvidenceHash = hashSectionInput(accepted.map(({ evidenceObjectId, extractedFact }) => ({
    evidenceObjectId,
    extractedFact,
  })))
  const selectedEvidenceHash = hashSectionInput({ evidence, validationStatusByEvidenceIndex })

  return {
    algorithm: 'SECTION_REASONING_COVERAGE',
    version: VMF_SECTION_REASONING_COVERAGE_VERSION,
    eligibleAcceptedCount: accepted.length,
    includedCount: evidence.length,
    excludedCount: accepted.length - evidence.length,
    dimensionCoverage,
    allEvidenceHash,
    selectedEvidenceHash,
    evidence,
    validationStatusByEvidenceIndex,
  }
}

export const buildCustomerContextReasoningCoverage = (input = {}) => buildVmfSectionReasoningCoverage({
  ...input,
  sectionKey: 'customer-context',
})

const buildRendererSections = (sectionIntelligence, sectionLabel) => [{
  heading: sectionLabel || 'Section Intelligence',
  body: sectionIntelligence.sectionNarrative,
  bullets: [],
}, {
  heading: 'Commercial Interpretation',
  body: sectionIntelligence.commercialInterpretation,
  bullets: sectionIntelligence.strategicTensions.map((item) => item.signal),
}, {
  heading: 'Claim and Evidence Boundaries',
  body: sectionIntelligence.decisionRelevance,
  bullets: [
    ...sectionIntelligence.representedClaims.map((item) => `Represented: ${item.claim}`),
    ...sectionIntelligence.restrictedClaims.map((item) => `Restricted: ${item.claim}`),
    ...sectionIntelligence.evidenceBoundaries.map((item) => item.boundary),
  ].slice(0, 16),
}, {
  heading: 'Downstream Handoff',
  body: sectionIntelligence.downstreamHandoffSignals[0].relevance,
  bullets: sectionIntelligence.downstreamHandoffSignals.map((item) => `${item.signal}: ${item.relevance}`),
}]

const providerConfigurationError = (status) => {
  const error = new Error('VMF section generation requires a configured governed reasoning provider.')
  error.status = 409
  error.code = 'VMF_SECTION_REASONING_PROVIDER_UNAVAILABLE'
  error.details = { reason: status?.reason || 'PROVIDER_CONFIGURATION_INCOMPLETE' }
  return error
}

export const buildReasonedGeneratedSection = async ({
  actionKey,
  actorUserId,
  dependencySectionKeys = [],
  frameworkPackage,
  frameworkState = {},
  generatedAt,
  input,
  providerRuntime,
  runtimeInstance,
  section,
  sectionExecutionContract,
} = {}) => {
  const sectionKey = text(section?.sectionKey || section?.key).toLowerCase()
  const runtimePath = text(section?.runtimePath).toLowerCase()
  if (!requiresVmfSectionReasoning({ frameworkPackage, sectionKey, runtimePath })) {
    return buildEnrichedGeneratedSection({
      actionKey,
      actorUserId,
      dependencySectionKeys,
      frameworkPackage,
      frameworkState,
      generatedAt,
      input,
      runtimeInstance,
      section,
      sectionExecutionContract,
    })
  }

  const supportAssets = Array.isArray(sectionExecutionContract?.runtimeSupportAssets)
    ? sectionExecutionContract.runtimeSupportAssets
    : []
  if (supportAssets.length === 0) throw providerConfigurationError({ reason: 'RUNTIME_SUPPORT_ASSETS_MISSING' })
  const evidencePack = frameworkState.evidence_pack || frameworkState.evidencePack || {}
  const acceptedEvidenceIds = new Set(getAcceptedDiscoveryEvidenceObjects(evidencePack)
    .map((item) => text(item.evidenceObjectId)))
  // Use the shared acceptance gate, but not its derived validation labels.
  // Reasoning must see the original stored facts and validation status.
  const acceptedEvidenceObjects = (Array.isArray(evidencePack.evidenceObjects) ? evidencePack.evidenceObjects : [])
    .filter((item) => acceptedEvidenceIds.has(text(item?.evidenceObjectId)))
  const coverage = buildVmfSectionReasoningCoverage({
    evidenceObjects: acceptedEvidenceObjects,
    sectionKey,
  })
  if (coverage.includedCount !== acceptedEvidenceIds.size) {
    const error = new Error('Accepted evidence could not be resolved completely to its stored records.')
    error.status = 409
    error.code = 'VMF_SECTION_REASONING_EVIDENCE_MISSING'
    throw error
  }
  const runtime = providerRuntime || buildRuntimeSectionReasoningProviderRuntime()
  if (runtime?.status?.configured !== true || typeof runtime.providerAdapter !== 'function') {
    throw providerConfigurationError(runtime?.status)
  }

  const providerContext = {
    contractVersion: VMF_SECTION_REASONING_CONTRACT_VERSION,
    framework: {
      frameworkKey: text(frameworkPackage?.frameworkKey),
      packageKey: text(frameworkPackage?.packageKey),
      packageVersion: text(frameworkPackage?.version),
    },
    section: {
      sectionKey,
      runtimePath,
      label: text(sectionExecutionContract?.sectionIdentity?.label),
      purpose: text(sectionExecutionContract?.sectionIdentity?.purpose),
    },
    additionalContext: text(input).slice(0, MAX_ADDITIONAL_CONTEXT_CHARS),
    supportAssets: supportAssets.map((asset) => ({
      assetKey: asset.assetKey,
      assetType: asset.assetType,
      contentHash: asset.contentHash,
      content: asset.content,
    })),
    reasoningCoverage: coverage,
  }
  const providerResult = await runtime.providerAdapter({
    providerContext,
    allowedEvidenceIds: coverage.evidence.map((item) => item.evidenceObjectId),
  })
  const sectionIntelligence = providerResult.output
  if (byteLength(sectionIntelligence) > MAX_SECTION_INTELLIGENCE_BYTES) {
    const error = new Error('VMF section intelligence exceeds the persistence bound.')
    error.status = 409
    error.code = 'VMF_SECTION_REASONING_OUTPUT_TOO_LARGE'
    throw error
  }

  const base = buildEnrichedGeneratedSection({
    actionKey,
    actorUserId,
    dependencySectionKeys,
    evidenceProjectionMaxItems: 10,
    frameworkPackage,
    frameworkState,
    generatedAt,
    input,
    runtimeInstance,
    section,
    sectionExecutionContract,
  })
  const sections = buildRendererSections(sectionIntelligence, providerContext.section.label)
  const assetHashes = supportAssets.map((asset) => asset.contentHash).sort()
  const evidenceHash = coverage.allEvidenceHash
  const boundedContextHash = hashSectionInput({
    contractVersion: VMF_SECTION_REASONING_CONTRACT_VERSION,
    evidenceHash,
    selectedEvidenceHash: coverage.selectedEvidenceHash,
    assetHashes,
    inputHash: base.generated.inputHash,
    dependencyHash: base.generated.dependencyHash,
    sectionContractHash: sectionExecutionContract.sectionContractHash,
  })
  const generated = {
    ...base.generated,
    // Keep the complete narrative within the existing per-string storage bound.
    // Claims, commercial interpretation and handoff remain in the structured fields.
    content: sectionIntelligence.sectionNarrative,
    summary: sectionIntelligence.sectionSummary,
    sections,
    sectionIntelligence,
    supportingEvidenceRefs: sectionIntelligence.sourceTraceability,
    evidenceProjection: {
      algorithm: coverage.algorithm,
      version: coverage.version,
      eligibleAcceptedCount: coverage.eligibleAcceptedCount,
      includedCount: coverage.includedCount,
      included: coverage.evidence.map((item) => ({
        evidenceObjectId: item.evidenceObjectId,
      })),
      excludedCount: coverage.excludedCount,
      excludedReasonCounts: coverage.excludedCount > 0
        ? { COVERAGE_SYNTHESIS_BOUND: coverage.excludedCount }
        : {},
      selectedCoverageAreas: coverage.dimensionCoverage
        .filter((item) => item.selectedCount > 0)
        .map((item) => item.dimensionKey),
      gaps: coverage.dimensionCoverage
        .filter((item) => item.selectedCount === 0)
        .map((item) => `NO_${item.dimensionKey.toUpperCase()}_EVIDENCE`),
      dimensionCoverage: coverage.dimensionCoverage,
      allEvidenceHash: coverage.allEvidenceHash,
      selectedEvidenceHash: coverage.selectedEvidenceHash,
    },
    generationBoundaries: sectionIntelligence.evidenceBoundaries.map((item) => item.boundary),
    evidenceHash,
    boundedContextHash,
    generator: {
      ...base.generated.generator,
      mode: 'GOVERNED_PROVIDER_SECTION_REASONING',
      adapter: VMF_SECTION_REASONING_CONTRACT_VERSION,
      provider: runtime.providerDescriptor || providerResult.provider,
      supportAssetHashes: assetHashes,
      providerMetadata: providerResult.metadata,
    },
  }
  const citedEvidenceIds = new Set(sectionIntelligence.sourceTraceability)
  const referencedEvidence = coverage.evidence.filter((item) => citedEvidenceIds.has(item.evidenceObjectId))
  // Keep the full admission manifest once, on generated.evidenceProjection.
  // Display and handoff receipts need its counts/hashes, not repeated copies.
  const coverageReceipt = { ...generated.evidenceProjection }
  delete coverageReceipt.included
  const intelligence = {
    ...base.intelligence,
    displayProjection: {
      ...base.intelligence.displayProjection,
      generatedInsight: {
        title: 'Generated Insight',
        summary: generated.summary,
        sections: generated.sections,
      },
      supportingEvidence: {
        title: 'Referenced Evidence',
        items: referencedEvidence.map((item) => `${item.evidenceObjectId}: ${item.excerpt}`),
      },
      boundaries: {
        title: 'Boundaries / Not Assumed',
        items: generated.generationBoundaries,
      },
    },
    scopedEvidence: {
      ...base.intelligence.scopedEvidence,
      sourceRefs: referencedEvidence.map((item) => ({
        refKey: item.evidenceObjectId,
        label: item.category || item.coverageArea || 'Accepted evidence',
        type: 'DISCOVERY_EVIDENCE_OBJECT',
        safeDisplay: item.excerpt,
      })),
      evidenceHash,
      projection: coverageReceipt,
    },
    reasoningCoverage: coverageReceipt,
  }
  return { generated, intelligence }
}

export default {
  VMF_SECTION_REASONING_CONTRACT_VERSION,
  buildCustomerContextReasoningCoverage,
  buildVmfSectionReasoningCoverage,
  buildReasonedGeneratedSection,
}
