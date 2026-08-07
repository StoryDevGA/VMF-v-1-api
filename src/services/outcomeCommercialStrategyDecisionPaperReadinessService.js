import {
  OUTCOME_KCP_STATUSES,
} from '../constants/outcomeGovernedQuality.js'
import { OUTCOME_STUDIO_REQUIRED_PACKS } from '../constants/runtimeOutcomeStudio.js'
import {
  ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS,
  COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK,
  COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS,
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
  COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const lower = (value) => String(value || '').trim().toLowerCase()
const upper = (value) => String(value || '').trim().toUpperCase()

const asArray = (value) => Array.isArray(value) ? value : []
const plain = (value) => value?.toObject ? value.toObject() : value
const unwrapCandidate = (value) => plain(value?.candidate || value?.pack || value)
const packKeyOf = (value) => lower(unwrapCandidate(value)?.packKey)

const activeOrEligible = (pack = {}) => {
  const lifecycle = upper(pack.lifecycleStatus || pack.status || pack.packStatus || pack.versionStatus)
  const activation = upper(pack.activationStatus || pack.currentStatus)
  const review = upper(pack.reviewStatus || pack.certificationStatus || pack.validationStatus)
  const terminalStates = new Set(['RETIRED', 'DEPRECATED', 'DISABLED', 'ROLLED_BACK', 'FAILED_VALIDATION'])
  if (terminalStates.has(lifecycle) || terminalStates.has(activation)) return false
  if (lifecycle === 'ACTIVE') return true
  return lifecycle === 'VALIDATED'
    && ['CERTIFIED', 'VALIDATED', 'APPROVED'].includes(review)
    && (!activation || activation === 'ELIGIBLE')
}

const selectedPacksFromBinding = (binding = {}) => [
  ...asArray(binding.mandatorySafeguards),
  ...Object.values(binding.selectedByLayer || {}).flatMap(asArray),
].map(plain)

const selectedPacksFromCandidate = (candidate = {}) => asArray(candidate?.payload?.resolution?.selectedPacks).map(plain)

const consideredPacksFromCandidate = (candidate = {}) => asArray(candidate?.payload?.resolution?.consideredPacks).map(plain)

const selectedPackIndex = ({ candidate, binding }) => {
  const selected = [
    ...selectedPacksFromCandidate(candidate),
    ...selectedPacksFromBinding(binding),
  ]
  return selected.reduce((index, pack) => {
    const key = lower(pack?.packKey)
    if (key && !index.has(key)) index.set(key, pack)
    return index
  }, new Map())
}

const consideredPackIndex = ({ candidate, binding }) => {
  const considered = [
    ...consideredPacksFromCandidate(candidate),
    ...asArray(binding?.excludedCandidates).map(unwrapCandidate),
    ...asArray(binding?.blockedPacks).map(unwrapCandidate),
  ]
  return considered.reduce((index, pack) => {
    const key = lower(pack?.packKey)
    if (key && !index.has(key)) index.set(key, pack)
    return index
  }, new Map())
}

const keySetFrom = (...sources) => new Set(sources.flatMap((source) => asArray(source).map(packKeyOf).filter(Boolean)))

const evidenceSourcesFor = (packKey, selected = {}, binding = {}) => {
  const sources = []
  for (const [layer, packs] of Object.entries(binding.selectedByLayer || {})) {
    if (asArray(packs).some((pack) => lower(pack?.packKey) === packKey)) sources.push(`SELECTED_BY_LAYER:${upper(layer)}`)
  }
  if (asArray(binding.mandatorySafeguards).some((pack) => lower(pack?.packKey) === packKey)) sources.push('MANDATORY_SAFEGUARD')
  if (asArray(selected.selectionSources).length) sources.push(...selected.selectionSources)
  return [...new Set(sources)].sort()
}

const stagePlanFor = (candidate = {}, pack = {}) => {
  const activationId = lower(pack.activationId)
  return asArray(candidate?.payload?.stagePlan)
    .filter((stage) => asArray(stage?.assignedActivationIds).map(lower).includes(activationId))
    .map((stage) => stage.stageKey)
}

const hasRelationshipFailure = (packKey, relationshipFailures = []) => asArray(relationshipFailures).some((failure) => {
  const keys = [
    packKeyOf(failure),
    packKeyOf(failure?.sourcePack),
    packKeyOf(failure?.targetPack),
    lower(failure?.packKey),
    lower(failure?.sourcePackKey),
    lower(failure?.targetPackKey),
  ]
  return keys.includes(packKey)
})

const requiredOutcomeStudioSafeguards = (selectedIndex) => OUTCOME_STUDIO_REQUIRED_PACKS.map((pack) => {
  const key = lower(pack.packKey)
  return {
    packType: pack.packType,
    packKey: key,
    selected: selectedIndex.has(key),
    blocker: selectedIndex.has(key) ? null : {
      code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.GENERIC_OUTCOME_STUDIO_PACK_MISSING,
      packKey: key,
      packType: pack.packType,
    },
  }
})

const classifyRequiredPack = ({
  requirement,
  candidate,
  binding,
  selectedIndex,
  consideredIndex,
  excludedKeys,
  blockedKeys,
  ambiguousKeys,
  relationshipFailures,
}) => {
  const packKey = lower(requirement.packKey)
  const selected = selectedIndex.get(packKey) || null
  const considered = consideredIndex.get(packKey) || null
  const blockers = []
  if (!selected && !considered) blockers.push({ code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_MISSING, packKey })
  if (!selected && considered) blockers.push({ code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_NOT_SELECTED, packKey })
  if (selected && !activeOrEligible(selected)) blockers.push({ code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_NOT_ELIGIBLE, packKey })
  if (ambiguousKeys.has(packKey)) blockers.push({ code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_AMBIGUOUS, packKey })
  if (blockedKeys.has(packKey)) blockers.push({ code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_BLOCKED, packKey })
  if (hasRelationshipFailure(packKey, relationshipFailures)) {
    blockers.push({ code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_RELATIONSHIP_FAILED, packKey })
  }
  return {
    ...requirement,
    packKey,
    loaded: Boolean(selected || considered),
    selected: Boolean(selected),
    excluded: excludedKeys.has(packKey),
    eligible: Boolean(selected && activeOrEligible(selected)),
    activationId: selected?.activationId || considered?.activationId || '',
    versionId: selected?.versionId || considered?.versionId || '',
    lifecycleStatus: selected?.lifecycleStatus || selected?.status || considered?.lifecycleStatus || considered?.status || '',
    selectionSources: selected ? evidenceSourcesFor(packKey, selected, binding) : [],
    assignedKcpStages: selected ? stagePlanFor(candidate, selected) : [],
    blockers,
  }
}

export const buildCommercialStrategyDecisionPaperReadinessReport = ({
  kcpCandidate,
  candidate = kcpCandidate,
  binding = {},
} = {}) => {
  const resolution = candidate?.payload?.resolution || binding || {}
  const selectedIndex = selectedPackIndex({ candidate, binding })
  const consideredIndex = consideredPackIndex({ candidate, binding })
  const excludedKeys = keySetFrom(resolution.excludedCandidates, binding.excludedCandidates)
  const blockedKeys = keySetFrom(resolution.blockedPacks, binding.blockedPacks)
  const ambiguousKeys = keySetFrom(resolution.ambiguousCandidates, binding.ambiguousCandidates)
  const relationshipFailures = [
    ...asArray(resolution.relationshipFailures),
    ...asArray(binding.relationshipFailures),
  ]
  const requiredPacks = ANDREW_DERIVED_COMMERCIAL_REASONING_PACKS.map((requirement) => classifyRequiredPack({
    requirement,
    candidate,
    binding,
    selectedIndex,
    consideredIndex,
    excludedKeys,
    blockedKeys,
    ambiguousKeys,
    relationshipFailures,
  }))
  const genericOutcomeStudioSafeguards = requiredOutcomeStudioSafeguards(selectedIndex)
  const blockers = [
    ...requiredPacks.flatMap((pack) => pack.blockers),
    ...genericOutcomeStudioSafeguards.map((pack) => pack.blocker).filter(Boolean),
  ]
  if (candidate?.status === OUTCOME_KCP_STATUSES.BLOCKED) {
    blockers.push({
      code: COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.KCP_BLOCKED_SHOWN_NOT_PERSISTED,
      planFingerprint: candidate.planFingerprint || '',
    })
  }
  const status = blockers.length
    ? COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES.BLOCKED
    : asArray(resolution.warnings).length
      ? COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES.READY_WITH_GAPS
      : COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES.READY
  return {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    benchmark: COMMERCIAL_STRATEGY_DECISION_PAPER_EXAMPLE_BENCHMARK,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    status,
    stopBeforeGeneration: status === COMMERCIAL_STRATEGY_DECISION_PAPER_READINESS_STATUSES.BLOCKED,
    requiredPacks,
    genericOutcomeStudioSafeguards,
    selected: requiredPacks.filter((pack) => pack.selected).map((pack) => ({ packKey: pack.packKey, stageKey: pack.stageKey, activationId: pack.activationId })),
    excluded: requiredPacks.filter((pack) => pack.excluded).map((pack) => ({ packKey: pack.packKey, stageKey: pack.stageKey })),
    missing: requiredPacks.filter((pack) => pack.blockers.some((blocker) => blocker.code === COMMERCIAL_STRATEGY_DECISION_PAPER_BLOCKERS.REQUIRED_PACK_MISSING)),
    blocked: blockers,
    knowledgeCompositionPlan: {
      status: candidate?.status || '',
      persistedWhenBlocked: false,
      planFingerprint: candidate?.planFingerprint || '',
      resolutionFingerprint: candidate?.resolutionFingerprint || '',
      selectedPackCount: candidate?.selectedPackCount || selectedIndex.size,
      consideredPackCount: candidate?.consideredPackCount || consideredIndex.size,
      selectedByLayer: binding.selectedByLayer || resolution.selectedByLayer || {},
      missingDependencies: asArray(resolution.missingDependencies),
      relationshipFailures,
      ambiguousCandidates: asArray(resolution.ambiguousCandidates),
      blockedPacks: asArray(resolution.blockedPacks),
      warnings: asArray(resolution.warnings),
      stagePlan: asArray(candidate?.payload?.stagePlan),
    },
  }
}

export default {
  buildCommercialStrategyDecisionPaperReadinessReport,
}
