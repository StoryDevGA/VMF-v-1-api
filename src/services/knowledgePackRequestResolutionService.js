import {
  KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS,
  KNOWLEDGE_PACK_EXECUTION_MODES,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES,
} from '../constants/outcomeKnowledgePacks.js'
import { OUTCOME_STUDIO_REQUIRED_PACKS } from '../constants/runtimeOutcomeStudio.js'

const POLICY_VERSION = 'kp-004-v1'
const DEFAULT_MAX_DEPTH = 10
const MISSING_STATUS = 'MISSING'
const AMBIGUOUS_STATUS = 'AMBIGUOUS'
const OUTCOME_WORKSPACE_ALIASES = new Set(['OUTCOME', 'OUTCOME_STUDIO'])
const EXECUTION_MODES = new Set(Object.values(KNOWLEDGE_PACK_EXECUTION_MODES))

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

const normalizeWorkspaceType = (value) => {
  const normalized = normalizeToken(value)
  return OUTCOME_WORKSPACE_ALIASES.has(normalized) ? 'OUTCOME' : normalized
}

const normalizeTokenList = (values) => Array.isArray(values)
  ? [...new Set(values.map(normalizeToken).filter(Boolean))]
  : []

const normalizeLowerKeyList = (values) => Array.isArray(values)
  ? [...new Set(values.map(normalizeLowerKey).filter(Boolean))]
  : []

const normalizeDependencyReference = (reference = {}) => ({
  knowledgeLayer: normalizeToken(reference.knowledgeLayer),
  requirement: normalizeToken(
    reference.requirement || KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.REQUIRED,
  ),
  ...(normalizeToken(reference.packType)
    ? { packType: normalizeToken(reference.packType) }
    : {}),
  ...(normalizeLowerKey(reference.packKey)
    ? { packKey: normalizeLowerKey(reference.packKey) }
    : {}),
  ...(normalizeLowerKey(reference.capabilityKey)
    ? { capabilityKey: normalizeLowerKey(reference.capabilityKey) }
    : {}),
})

const toSafePack = (value = {}) => {
  const pack = {
    activationId: normalizeText(value.activationId),
    packId: normalizeText(value.packId || value.id),
    versionId: normalizeText(value.versionId),
    packCategory: normalizeToken(value.packCategory),
    purposeCategory: normalizeToken(value.purposeCategory),
    knowledgeLayer: normalizeToken(value.knowledgeLayer),
    capabilityKey: normalizeLowerKey(value.capabilityKey),
    workspaceCompatibility: normalizeTokenList(value.workspaceCompatibility),
    dependencyReferences: Array.isArray(value.dependencyReferences)
      ? value.dependencyReferences.map(normalizeDependencyReference)
      : [],
    packType: normalizeToken(value.packType),
    packKey: normalizeLowerKey(value.packKey),
    label: normalizeText(value.label || value.packKey),
    semanticVersion: normalizeText(value.semanticVersion),
    schemaVersion: normalizeText(value.schemaVersion),
    status: normalizeToken(value.status),
    scopeType: normalizeToken(value.scopeType),
    scopeKey: normalizeToken(value.scopeKey),
    executionMode: normalizeToken(value.executionMode),
    visibility: normalizeToken(value.visibility),
    contentHash: normalizeText(value.contentHash),
    activatedAt: normalizeText(value.activatedAt),
  }

  if (typeof value.runtimeBindable === 'boolean') {
    pack.runtimeBindable = value.runtimeBindable
  }

  return pack
}

const toSafeSelector = (selector = {}) => ({
  ...(normalizeToken(selector.knowledgeLayer)
    ? { knowledgeLayer: normalizeToken(selector.knowledgeLayer) }
    : {}),
  ...(normalizeToken(selector.packType)
    ? { packType: normalizeToken(selector.packType) }
    : {}),
  ...(normalizeLowerKey(selector.packKey)
    ? { packKey: normalizeLowerKey(selector.packKey) }
    : {}),
  ...(normalizeLowerKey(selector.capabilityKey)
    ? { capabilityKey: normalizeLowerKey(selector.capabilityKey) }
    : {}),
})

const candidateNodeId = (pack) => pack.activationId
  || pack.versionId
  || `${pack.packType}:${pack.packKey}:${pack.scopeKey}:${pack.semanticVersion}`

const candidateDiagnosticId = (pack) => candidateNodeId(pack)
  || `${pack.knowledgeLayer}:${pack.capabilityKey}`

const compareNumericIdentifier = (left, right) => {
  const normalizedLeft = left.replace(/^0+(?=\d)/, '')
  const normalizedRight = right.replace(/^0+(?=\d)/, '')
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length
  }
  return normalizedLeft.localeCompare(normalizedRight)
}

const parseSemanticVersion = (value) => {
  const match = normalizeText(value).match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  )
  if (!match) return null
  return {
    core: match.slice(1, 4),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

const compareSemanticVersions = (left, right) => {
  const leftVersion = parseSemanticVersion(left)
  const rightVersion = parseSemanticVersion(right)
  if (!leftVersion || !rightVersion) {
    if (leftVersion) return 1
    if (rightVersion) return -1
    return normalizeText(left).localeCompare(normalizeText(right))
  }

  for (let index = 0; index < leftVersion.core.length; index += 1) {
    const comparison = compareNumericIdentifier(
      leftVersion.core[index],
      rightVersion.core[index],
    )
    if (comparison !== 0) return comparison
  }

  const leftPrerelease = leftVersion.prerelease
  const rightPrerelease = rightVersion.prerelease
  if (leftPrerelease.length === 0 || rightPrerelease.length === 0) {
    if (leftPrerelease.length === rightPrerelease.length) return 0
    return leftPrerelease.length === 0 ? 1 : -1
  }

  const length = Math.max(leftPrerelease.length, rightPrerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftPrerelease[index]
    const rightIdentifier = rightPrerelease[index]
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1
    }
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) {
      return compareNumericIdentifier(leftIdentifier, rightIdentifier)
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier.localeCompare(rightIdentifier)
  }

  return 0
}

const toTimestamp = (value) => {
  const timestamp = new Date(value || 0).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

const toIsoDate = (value) => {
  const timestamp = toTimestamp(value)
  return timestamp > 0 ? new Date(timestamp).toISOString() : ''
}

const selectorMatches = (pack, selector) => (
  (!selector.knowledgeLayer || pack.knowledgeLayer === selector.knowledgeLayer)
  && (!selector.packType || pack.packType === selector.packType)
  && (!selector.packKey || pack.packKey === selector.packKey)
  && (!selector.capabilityKey || pack.capabilityKey === selector.capabilityKey)
)

const toGraphNode = (pack) => ({
  nodeId: candidateNodeId(pack),
  activationId: pack.activationId,
  versionId: pack.versionId,
  knowledgeLayer: pack.knowledgeLayer,
  capabilityKey: pack.capabilityKey,
  packType: pack.packType,
  packKey: pack.packKey,
})

const normalizeDepth = (value) => {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : DEFAULT_MAX_DEPTH
}

const buildScopePrecedence = (scopeCandidates) => {
  const precedence = new Map()
  for (const candidate of Array.isArray(scopeCandidates) ? scopeCandidates : []) {
    const scopeKey = normalizeToken(candidate?.scopeKey)
    const score = Number(candidate?.precedence)
    if (!scopeKey || !Number.isFinite(score)) continue
    precedence.set(scopeKey, Math.max(precedence.get(scopeKey) ?? -Infinity, score))
  }
  return precedence
}

const compareCandidateRank = (left, right, scopePrecedence) => {
  const leftScope = scopePrecedence.get(left.scopeKey) ?? -Infinity
  const rightScope = scopePrecedence.get(right.scopeKey) ?? -Infinity
  if (leftScope !== rightScope) return leftScope - rightScope

  const semanticVersionComparison = compareSemanticVersions(
    left.semanticVersion,
    right.semanticVersion,
  )
  if (semanticVersionComparison !== 0) return semanticVersionComparison

  return toTimestamp(left.activatedAt) - toTimestamp(right.activatedAt)
}

const isActivePack = (pack) => (
  pack.status === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE
  && pack.runtimeBindable !== false
)

const hasWorkspaceCompatibility = (pack, requestedWorkspaceType) => {
  if (!requestedWorkspaceType || pack.workspaceCompatibility.length === 0) return false
  return pack.workspaceCompatibility
    .map(normalizeWorkspaceType)
    .includes(requestedWorkspaceType)
}

const uniqueValues = (values) => [...new Set(values.filter(Boolean))]

export const resolveRequestSpecificKnowledgePacks = ({
  mandatorySafeguards = [],
  candidates = [],
  request = {},
  scopeCandidates = [],
  maxDepth = DEFAULT_MAX_DEPTH,
} = {}) => {
  const scopePrecedence = buildScopePrecedence(scopeCandidates)
  const requestedWorkspaceType = normalizeWorkspaceType(request.workspaceType)
  const depthLimit = normalizeDepth(maxDepth)
  const excludedCandidates = []
  const excludedCandidateKeys = new Set()
  const ambiguousCandidates = []
  const missingDependencies = []
  const warnings = []
  const graphNodes = new Map()
  const graphEdges = []
  const graphCycles = []
  const graphDepthOverflows = []

  const exclude = (pack, reason, selector) => {
    const key = `${candidateDiagnosticId(pack)}:${reason}:${JSON.stringify(selector || {})}`
    if (excludedCandidateKeys.has(key)) return
    excludedCandidateKeys.add(key)
    excludedCandidates.push({
      reason,
      ...(selector ? { selector: toSafeSelector(selector) } : {}),
      candidate: pack,
    })
  }

  const buildEligiblePool = (values, { requireWorkspace }) => values
    .map(toSafePack)
    .filter((pack) => {
      if (!isActivePack(pack)) {
        exclude(pack, 'NOT_ACTIVE')
        return false
      }
      if (!scopePrecedence.has(pack.scopeKey)) {
        exclude(pack, 'SCOPE_NOT_ELIGIBLE')
        return false
      }
      if (!EXECUTION_MODES.has(pack.executionMode)) {
        exclude(pack, 'EXECUTION_MODE_UNSUPPORTED')
        return false
      }
      if (requireWorkspace && !hasWorkspaceCompatibility(pack, requestedWorkspaceType)) {
        exclude(pack, 'WORKSPACE_INCOMPATIBLE')
        return false
      }
      return true
    })

  const mandatoryPool = buildEligiblePool(mandatorySafeguards, { requireWorkspace: false })
  const dynamicPool = buildEligiblePool(candidates, { requireWorkspace: true })

  const selectBest = ({ pool, selector, requiredBy }) => {
    const safeSelector = toSafeSelector(selector)
    const matches = pool.filter((pack) => selectorMatches(pack, safeSelector))
    if (matches.length === 0) return { type: 'MISSING', selector: safeSelector }

    const ranked = [...matches].sort((left, right) =>
      compareCandidateRank(right, left, scopePrecedence))
    const best = ranked[0]
    const tied = ranked.filter((candidate) =>
      compareCandidateRank(candidate, best, scopePrecedence) === 0)

    if (tied.length > 1) {
      ambiguousCandidates.push({
        selector: safeSelector,
        requiredBy,
        candidates: tied,
      })
      return { type: 'AMBIGUOUS', selector: safeSelector }
    }

    ranked.slice(1).forEach((candidate) =>
      exclude(candidate, 'LOWER_RANKED', safeSelector))
    return { type: 'SELECTED', selector: safeSelector, pack: best }
  }

  const resolvedMandatorySafeguards = OUTCOME_STUDIO_REQUIRED_PACKS.map((requiredPack) => {
    const selector = {
      packType: requiredPack.packType,
      packKey: requiredPack.packKey,
    }
    const result = selectBest({
      pool: mandatoryPool,
      selector,
      requiredBy: 'MANDATORY_SAFEGUARD_POLICY',
    })
    if (result.type === 'SELECTED') return result.pack

    const status = result.type === 'AMBIGUOUS' ? AMBIGUOUS_STATUS : MISSING_STATUS
    if (result.type === 'MISSING') {
      missingDependencies.push({
        reason: 'MANDATORY_SAFEGUARD_MISSING',
        requirement: KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.REQUIRED,
        selector: toSafeSelector(selector),
        requiredBy: 'MANDATORY_SAFEGUARD_POLICY',
      })
    }
    return {
      packCategory: normalizeToken(requiredPack.packCategory),
      packType: normalizeToken(requiredPack.packType),
      packKey: normalizeLowerKey(requiredPack.packKey),
      label: normalizeText(requiredPack.label),
      status,
      runtimeBindable: false,
    }
  })

  const selectedDynamic = new Map()
  const processedNodes = new Set()

  const addMissing = ({ reason, requirement, selector, requiredBy }) => {
    const missing = {
      reason,
      requirement,
      selector: toSafeSelector(selector),
      requiredBy,
    }
    missingDependencies.push(missing)
    if (requirement === KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.OPTIONAL) {
      warnings.push({ code: 'OPTIONAL_DEPENDENCY_MISSING', ...missing })
    }
  }

  const resolveSelector = ({
    selector,
    requirement = KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.REQUIRED,
    requiredBy,
    parentNodeId = '',
    path = [],
    depth = 0,
    missingReason = 'DEPENDENCY_MISSING',
  }) => {
    const result = selectBest({ pool: dynamicPool, selector, requiredBy })
    if (result.type === 'MISSING') {
      addMissing({ reason: missingReason, requirement, selector, requiredBy })
      return null
    }
    if (result.type === 'AMBIGUOUS') return null

    const pack = result.pack
    const nodeId = candidateNodeId(pack)
    graphNodes.set(nodeId, toGraphNode(pack))
    if (parentNodeId) {
      graphEdges.push({
        from: parentNodeId,
        to: nodeId,
        requirement,
        selector: toSafeSelector(selector),
      })
    }

    if (path.includes(nodeId)) {
      const cycle = { path: [...path.slice(path.indexOf(nodeId)), nodeId] }
      graphCycles.push(cycle)
      warnings.push({ code: 'DEPENDENCY_CYCLE', ...cycle })
      return null
    }

    if (depth > depthLimit) {
      const overflow = { path: [...path, nodeId], maxDepth: depthLimit }
      graphDepthOverflows.push(overflow)
      warnings.push({ code: 'DEPENDENCY_DEPTH_EXCEEDED', ...overflow })
      return null
    }

    selectedDynamic.set(nodeId, pack)
    if (processedNodes.has(nodeId)) return pack
    processedNodes.add(nodeId)

    const nextPath = [...path, nodeId]
    for (const reference of pack.dependencyReferences) {
      const dependencyRequirement = reference.requirement
        === KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.OPTIONAL
        ? KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.OPTIONAL
        : KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.REQUIRED
      const hasIdentity = Boolean(reference.packType && reference.packKey)
      const hasCapability = Boolean(reference.capabilityKey)
      if (!reference.knowledgeLayer || hasIdentity === hasCapability) {
        addMissing({
          reason: 'DEPENDENCY_REFERENCE_INVALID',
          requirement: dependencyRequirement,
          selector: reference,
          requiredBy: nodeId,
        })
        continue
      }

      const dependencySelector = hasIdentity
        ? {
          knowledgeLayer: reference.knowledgeLayer,
          packType: reference.packType,
          packKey: reference.packKey,
        }
        : {
          knowledgeLayer: reference.knowledgeLayer,
          capabilityKey: reference.capabilityKey,
        }
      resolveSelector({
        selector: dependencySelector,
        requirement: dependencyRequirement,
        requiredBy: nodeId,
        parentNodeId: nodeId,
        path: nextPath,
        depth: depth + 1,
      })
    }

    return pack
  }

  const requestSelectors = []
  const requestedOutputTypeKey = normalizeLowerKey(request.requestedOutputTypeKey)
  if (requestedOutputTypeKey) {
    requestSelectors.push({
      selector: { knowledgeLayer: 'OUTPUT_TYPE', capabilityKey: requestedOutputTypeKey },
      requiredBy: 'REQUESTED_OUTPUT_TYPE',
    })
  }

  const requestedStyleKey = normalizeLowerKey(request.requestedStyleKey)
  if (requestedStyleKey) {
    requestSelectors.push({
      selector: { knowledgeLayer: 'STYLE', capabilityKey: requestedStyleKey },
      requiredBy: 'REQUESTED_STYLE',
    })
  }

  normalizeLowerKeyList(request.audienceKeys).forEach((capabilityKey) => {
    requestSelectors.push({
      selector: { knowledgeLayer: 'AUDIENCE', capabilityKey },
      requiredBy: 'REQUESTED_AUDIENCE',
    })
  })
  normalizeLowerKeyList(request.industryKeys).forEach((capabilityKey) => {
    requestSelectors.push({
      selector: { knowledgeLayer: 'INDUSTRY', capabilityKey },
      requiredBy: 'REQUESTED_INDUSTRY',
    })
  })

  const languageKey = normalizeLowerKey(request.languageKey)
  if (languageKey) {
    requestSelectors.push({
      selector: { knowledgeLayer: 'LANGUAGE', capabilityKey: languageKey },
      requiredBy: 'REQUESTED_LANGUAGE',
    })
  }

  const channelKey = normalizeLowerKey(request.channelKey)
  if (channelKey) {
    requestSelectors.push({
      selector: { knowledgeLayer: 'CHANNEL', capabilityKey: channelKey },
      requiredBy: 'REQUESTED_CHANNEL',
    })
  }

  requestSelectors.forEach(({ selector, requiredBy }) => {
    resolveSelector({
      selector,
      requiredBy,
      missingReason: 'REQUESTED_CAPABILITY_MISSING',
    })
  })

  const selectedByLayer = {}
  for (const pack of selectedDynamic.values()) {
    const layer = pack.knowledgeLayer
    if (!selectedByLayer[layer]) selectedByLayer[layer] = []
    selectedByLayer[layer].push(pack)
  }

  if (requestedOutputTypeKey) {
    for (const requiredLayer of ['OUTPUT_SCHEMA', 'STYLE']) {
      if (!selectedByLayer[requiredLayer]?.length) {
        addMissing({
          reason: 'REQUIRED_LAYER_COVERAGE_MISSING',
          requirement: KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.REQUIRED,
          selector: { knowledgeLayer: requiredLayer },
          requiredBy: 'REQUESTED_OUTPUT_TYPE',
        })
      }
    }
  }

  const boundPacks = []
  const boundPackIds = new Set()
  for (const pack of [
    ...resolvedMandatorySafeguards.filter((entry) => entry.status === 'ACTIVE'),
    ...selectedDynamic.values(),
  ]) {
    const identity = candidateDiagnosticId(pack)
    if (boundPackIds.has(identity)) continue
    boundPackIds.add(identity)
    boundPacks.push(pack)
  }

  const providerContextPacks = []
  const preValidationPacks = []
  const postValidationPacks = []
  const systemOnlyPacks = []
  for (const pack of boundPacks) {
    switch (pack.executionMode) {
      case KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT:
        providerContextPacks.push(pack)
        break
      case KNOWLEDGE_PACK_EXECUTION_MODES.PRE_VALIDATION:
        preValidationPacks.push(pack)
        break
      case KNOWLEDGE_PACK_EXECUTION_MODES.POST_VALIDATION:
        postValidationPacks.push(pack)
        break
      case KNOWLEDGE_PACK_EXECUTION_MODES.SYSTEM_ONLY:
        systemOnlyPacks.push(pack)
        break
      default:
        break
    }
  }

  const selectedDynamicIds = new Set(selectedDynamic.keys())
  for (const candidate of dynamicPool) {
    if (!selectedDynamicIds.has(candidateNodeId(candidate))) {
      const wasDiagnosed = excludedCandidates.some((entry) =>
        candidateDiagnosticId(entry.candidate) === candidateDiagnosticId(candidate))
      const wasAmbiguous = ambiguousCandidates.some((entry) =>
        entry.candidates.some((ambiguous) =>
          candidateDiagnosticId(ambiguous) === candidateDiagnosticId(candidate)))
      if (!wasDiagnosed && !wasAmbiguous) exclude(candidate, 'NOT_SELECTED')
    }
  }

  const hasRequiredMissing = missingDependencies.some((missing) =>
    missing.requirement === KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.REQUIRED)
  const hasOptionalMissing = missingDependencies.some((missing) =>
    missing.requirement === KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.OPTIONAL)
  const hasGraphBlocker = graphCycles.length > 0 || graphDepthOverflows.length > 0
  const status = ambiguousCandidates.length > 0
    ? 'AMBIGUOUS'
    : hasRequiredMissing || hasGraphBlocker
      ? 'BLOCKED'
      : hasOptionalMissing
        ? 'READY_WITH_GAPS'
        : 'READY'

  const resolvedAt = toIsoDate(request.resolvedAt)
    || boundPacks.reduce((latest, pack) => (
      toTimestamp(pack.activatedAt) > toTimestamp(latest) ? pack.activatedAt : latest
    ), '')

  return {
    status,
    policyVersion: POLICY_VERSION,
    request: {
      workspaceType: requestedWorkspaceType,
      requestedOutputTypeKey,
      requestedStyleKey: normalizeLowerKey(request.requestedStyleKey),
      audienceKeys: normalizeLowerKeyList(request.audienceKeys),
      industryKeys: normalizeLowerKeyList(request.industryKeys),
      languageKey: normalizeLowerKey(request.languageKey),
      channelKey: normalizeLowerKey(request.channelKey),
    },
    mandatorySafeguards: resolvedMandatorySafeguards,
    selectedByLayer,
    providerContextPacks,
    preValidationPacks,
    postValidationPacks,
    systemOnlyPacks,
    missingDependencies,
    ambiguousCandidates,
    excludedCandidates,
    warnings,
    dependencyGraph: {
      nodes: [...graphNodes.values()],
      edges: graphEdges,
      cycles: graphCycles,
      depthOverflows: graphDepthOverflows,
    },
    lineage: {
      resolvedAt: toIsoDate(resolvedAt),
      activationIds: uniqueValues(boundPacks.map((pack) => pack.activationId)),
      versionIds: uniqueValues(boundPacks.map((pack) => pack.versionId)),
      contentHashes: uniqueValues(boundPacks.map((pack) => pack.contentHash)),
    },
  }
}
