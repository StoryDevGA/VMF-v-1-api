import {
  KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS,
  KNOWLEDGE_PACK_BOUNDARIES,
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES,
  KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
  KNOWLEDGE_PACK_RELATIONSHIP_FAILURES,
  KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS,
  KNOWLEDGE_PACK_RELATIONSHIP_TYPES,
  resolveKnowledgePackBoundary,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES,
} from '../constants/outcomeKnowledgePacks.js'
import { OUTCOME_STUDIO_REQUIRED_PACKS } from '../constants/runtimeOutcomeStudio.js'
import {
  buildKnowledgePackRelationshipChecksum,
  evaluateRelationshipCardinality,
  normalizeKnowledgeAssetId,
  normalizeKnowledgePackRelationships,
  semanticVersionSatisfies,
} from './knowledgePackRelationshipContract.js'

const POLICY_VERSION = 'ss-002-v1'
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

const toSafePack = (value = {}) => {
  let dependencyReferences = []
  let relationshipGovernanceError = normalizeText(value.relationshipGovernanceError)
  let knowledgeAssetId = ''
  try {
    knowledgeAssetId = normalizeKnowledgeAssetId(value.knowledgeAssetId, { required: true })
    dependencyReferences = normalizeKnowledgePackRelationships(value.dependencyReferences)
    if (
      !relationshipGovernanceError
      && (
      normalizeToken(value.relationshipContractVersion)
        !== KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION
      )
    ) {
      relationshipGovernanceError = 'RELATIONSHIP_CONTRACT_VERSION_MISSING'
    } else if (
      !relationshipGovernanceError
      && (
      normalizeText(value.relationshipChecksum)
        !== buildKnowledgePackRelationshipChecksum(dependencyReferences)
      )
    ) {
      relationshipGovernanceError = 'RELATIONSHIP_CHECKSUM_MISMATCH'
    }
  } catch (error) {
    relationshipGovernanceError = error.message || 'RELATIONSHIP_METADATA_INVALID'
  }
  const pack = {
    activationId: normalizeText(value.activationId),
    packId: normalizeText(value.packId || value.id),
    versionId: normalizeText(value.versionId),
    packCategory: normalizeToken(value.packCategory),
    purposeCategory: normalizeToken(value.purposeCategory),
    knowledgeLayer: normalizeToken(value.knowledgeLayer),
    capabilityKey: normalizeLowerKey(value.capabilityKey),
    knowledgeAssetId,
    workspaceCompatibility: normalizeTokenList(value.workspaceCompatibility),
    relationshipContractVersion: normalizeToken(value.relationshipContractVersion),
    relationshipChecksum: normalizeText(value.relationshipChecksum),
    relationshipGovernanceError,
    dependencyReferences,
    packType: normalizeToken(value.packType),
    packKey: normalizeLowerKey(value.packKey),
    label: normalizeText(value.label || value.packKey),
    semanticVersion: normalizeText(value.semanticVersion),
    schemaVersion: normalizeText(value.schemaVersion),
    status: normalizeToken(value.status),
    scopeType: normalizeToken(value.scopeType),
    scopeKey: normalizeToken(value.scopeKey),
    executionMode: normalizeToken(value.executionMode),
    boundary: normalizeToken(value.boundary),
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
  ...(normalizeToken(selector.knowledgeAssetId || selector.targetKnowledgeAssetId)
    ? { knowledgeAssetId: normalizeToken(selector.knowledgeAssetId || selector.targetKnowledgeAssetId) }
    : {}),
})

const candidateNodeId = (pack) => pack.activationId
  || pack.versionId
  || `${pack.packType}:${pack.packKey}:${pack.scopeKey}:${pack.semanticVersion}`

const candidateDiagnosticId = (pack) => candidateNodeId(pack)
  || `${pack.knowledgeLayer}:${pack.capabilityKey}`

const candidateTraversalIdentity = (pack) => pack.knowledgeAssetId || candidateNodeId(pack)

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
  && (!selector.knowledgeAssetId || pack.knowledgeAssetId === selector.knowledgeAssetId)
)

const toGraphNode = (pack) => ({
  nodeId: candidateNodeId(pack),
  activationId: pack.activationId,
  versionId: pack.versionId,
  knowledgeLayer: pack.knowledgeLayer,
  capabilityKey: pack.capabilityKey,
  knowledgeAssetId: pack.knowledgeAssetId,
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

const uniqueCandidatesByNodeId = (values = []) => {
  const byNodeId = new Map()
  values.forEach((pack) => {
    if (!pack) return
    const nodeId = candidateNodeId(pack)
    if (!byNodeId.has(nodeId)) byNodeId.set(nodeId, pack)
  })
  return [...byNodeId.values()]
}

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
  const relationshipFailures = []
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
  const allDynamicCandidates = candidates.map(toSafePack)
  const relationshipCandidatePool = uniqueCandidatesByNodeId([...mandatoryPool, ...dynamicPool])
  const allRelationshipCandidates = uniqueCandidatesByNodeId([...mandatoryPool, ...allDynamicCandidates])

  const addRelationshipFailure = ({
    code,
    pack,
    relationship,
    observedState,
    requiredState,
    resolutionResult,
  }) => {
    relationshipFailures.push({
      code,
      pack: {
        activationId: pack?.activationId || '',
        packId: pack?.packId || '',
        versionId: pack?.versionId || '',
        knowledgeAssetId: pack?.knowledgeAssetId || '',
        packType: pack?.packType || '',
        packKey: pack?.packKey || '',
      },
      failedRule: relationship?.relationshipType || 'RELATIONSHIP_GOVERNANCE',
      relationship: relationship || null,
      observedState,
      requiredState,
      resolutionResult,
    })
  }

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

  const selectCompatibleSet = ({ requester, relationship }) => {
    if (!requester.knowledgeAssetId) {
      addRelationshipFailure({
        code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.MISSING_GOVERNANCE_METADATA,
        pack: requester,
        relationship,
        observedState: 'REQUESTER_IDENTITY_MISSING',
        requiredState: 'GOVERNED_KNOWLEDGE_ASSET_ID',
        resolutionResult: 'BLOCKED',
      })
      return []
    }

    const typeMatches = allDynamicCandidates.filter((candidate) => (
      candidate.packType === relationship.targetPackType
      && (
        !relationship.targetKnowledgeLayer
        || candidate.knowledgeLayer === relationship.targetKnowledgeLayer
      )
    ))
    if (typeMatches.length === 0) {
      addRelationshipFailure({
        code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.MISSING_RELATIONSHIP,
        pack: requester,
        relationship,
        observedState: 'NO_TARGET_IDENTITY',
        requiredState: relationship.targetPackType,
        resolutionResult: 'BLOCKED',
      })
      return []
    }

    const eligible = dynamicPool.filter((candidate) => typeMatches.some((match) => (
      candidateNodeId(match) === candidateNodeId(candidate)
    )))
    if (eligible.length === 0) {
      addRelationshipFailure({
        code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.INACTIVE_DEPENDENCY,
        pack: requester,
        relationship,
        observedState: 'NO_ACTIVE_VISIBLE_WORKSPACE_CANDIDATE',
        requiredState: 'ACTIVE_VISIBLE_WORKSPACE_COMPATIBLE',
        resolutionResult: 'BLOCKED',
      })
      return []
    }

    const versionCompatible = eligible.filter((candidate) => (
      semanticVersionSatisfies(candidate.semanticVersion, relationship.versionConstraint)
    ))
    if (versionCompatible.length === 0) {
      addRelationshipFailure({
        code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.INCOMPATIBLE_VERSION,
        pack: requester,
        relationship,
        observedState: eligible.map((candidate) => candidate.semanticVersion),
        requiredState: relationship.versionConstraint || 'ANY_VALID_SEMVER',
        resolutionResult: 'BLOCKED',
      })
      return []
    }

    const governanceInvalid = versionCompatible.filter((candidate) => (
      !candidate.knowledgeAssetId || candidate.relationshipGovernanceError
    ))
    if (governanceInvalid.length > 0) {
      governanceInvalid.forEach((candidate) => addRelationshipFailure({
        code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.MISSING_GOVERNANCE_METADATA,
        pack: candidate,
        relationship,
        observedState: candidate.relationshipGovernanceError || 'TARGET_IDENTITY_MISSING',
        requiredState: 'CANONICAL_RELATIONSHIP_AND_IDENTITY',
        resolutionResult: 'REJECTED',
      }))
      return []
    }

    const reciprocal = versionCompatible.filter((candidate) => candidate.dependencyReferences.some(
      (candidateRelationship) => (
        candidateRelationship.relationshipType
          === KNOWLEDGE_PACK_RELATIONSHIP_TYPES.COMPATIBLE_WITH
        && candidateRelationship.targetKnowledgeAssetId === requester.knowledgeAssetId
        && (
          !candidateRelationship.targetPackType
          || candidateRelationship.targetPackType === requester.packType
        )
        && (
          !candidateRelationship.targetKnowledgeLayer
          || candidateRelationship.targetKnowledgeLayer === requester.knowledgeLayer
        )
        && semanticVersionSatisfies(
          requester.semanticVersion,
          candidateRelationship.versionConstraint,
        )
      )
    ))
    if (reciprocal.length === 0) {
      addRelationshipFailure({
        code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.MISSING_RELATIONSHIP,
        pack: requester,
        relationship,
        observedState: 'RECIPROCAL_COMPATIBLE_WITH_MISSING',
        requiredState: requester.knowledgeAssetId,
        resolutionResult: 'BLOCKED',
      })
      return []
    }

    const byIdentity = new Map()
    for (const candidate of reciprocal) {
      if (!candidate.knowledgeAssetId || candidate.relationshipGovernanceError) {
        addRelationshipFailure({
          code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.MISSING_GOVERNANCE_METADATA,
          pack: candidate,
          relationship,
          observedState: candidate.relationshipGovernanceError || 'TARGET_IDENTITY_MISSING',
          requiredState: 'CANONICAL_RELATIONSHIP_AND_IDENTITY',
          resolutionResult: 'REJECTED',
        })
        continue
      }
      const current = byIdentity.get(candidate.knowledgeAssetId)
      if (!current) {
        byIdentity.set(candidate.knowledgeAssetId, candidate)
        continue
      }
      const comparison = compareCandidateRank(candidate, current, scopePrecedence)
      if (comparison > 0) byIdentity.set(candidate.knowledgeAssetId, candidate)
      if (comparison === 0) {
        addRelationshipFailure({
          code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.AMBIGUOUS_DEPENDENCY,
          pack: requester,
          relationship,
          observedState: [candidateDiagnosticId(current), candidateDiagnosticId(candidate)],
          requiredState: `ONE_VERSION_PER_IDENTITY:${candidate.knowledgeAssetId}`,
          resolutionResult: 'BLOCKED',
        })
      }
    }

    const selected = [...byIdentity.values()].sort((left, right) => (
      left.knowledgeAssetId.localeCompare(right.knowledgeAssetId)
      || compareCandidateRank(right, left, scopePrecedence)
      || candidateNodeId(left).localeCompare(candidateNodeId(right))
    ))
    const cardinality = evaluateRelationshipCardinality(
      relationship.cardinality,
      selected.length,
    )
    if (!cardinality.success) {
      addRelationshipFailure({
        code: selected.length === 0
          ? KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.MISSING_RELATIONSHIP
          : KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.AMBIGUOUS_DEPENDENCY,
        pack: requester,
        relationship,
        observedState: cardinality,
        requiredState: relationship.cardinality,
        resolutionResult: 'BLOCKED',
      })
      return []
    }
    return selected
  }

  const selectRelationshipSet = ({ requester, relationship, selector, requiredBy }) => {
    const optional = relationship.relationshipType === KNOWLEDGE_PACK_RELATIONSHIP_TYPES.OPTIONAL
    const rawMatches = allRelationshipCandidates.filter((candidate) => selectorMatches(candidate, selector))
    const activeMatches = relationshipCandidatePool.filter((candidate) => selectorMatches(candidate, selector))
    const versionMatches = activeMatches.filter((candidate) => (
      semanticVersionSatisfies(candidate.semanticVersion, relationship.versionConstraint)
    ))

    const addZeroResult = (code, observedState, requiredState) => {
      if (optional) {
        addMissing({
          reason: code,
          requirement: KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.OPTIONAL,
          selector,
          requiredBy,
        })
      } else {
        addRelationshipFailure({
          code,
          pack: requester,
          relationship,
          observedState,
          requiredState,
          resolutionResult: 'BLOCKED',
        })
      }
    }

    if (rawMatches.length === 0) {
      addZeroResult(
        KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.MISSING_RELATIONSHIP,
        'NO_TARGET_IDENTITY',
        selector,
      )
      return []
    }
    if (activeMatches.length === 0) {
      addZeroResult(
        KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.INACTIVE_DEPENDENCY,
        'NO_ACTIVE_VISIBLE_WORKSPACE_CANDIDATE',
        'ACTIVE_VISIBLE_WORKSPACE_COMPATIBLE',
      )
      return []
    }
    if (versionMatches.length === 0) {
      addZeroResult(
        KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.INCOMPATIBLE_VERSION,
        activeMatches.map((candidate) => candidate.semanticVersion),
        relationship.versionConstraint || 'ANY_VALID_SEMVER',
      )
      return []
    }

    const byIdentity = new Map()
    for (const candidate of versionMatches) {
      if (!candidate.knowledgeAssetId || candidate.relationshipGovernanceError) {
        addRelationshipFailure({
          code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.MISSING_GOVERNANCE_METADATA,
          pack: candidate,
          relationship,
          observedState: candidate.relationshipGovernanceError || 'TARGET_IDENTITY_MISSING',
          requiredState: 'CANONICAL_RELATIONSHIP_AND_IDENTITY',
          resolutionResult: 'REJECTED',
        })
        continue
      }
      const current = byIdentity.get(candidate.knowledgeAssetId)
      if (!current || compareCandidateRank(candidate, current, scopePrecedence) > 0) {
        byIdentity.set(candidate.knowledgeAssetId, candidate)
      } else if (compareCandidateRank(candidate, current, scopePrecedence) === 0) {
        addRelationshipFailure({
          code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.AMBIGUOUS_DEPENDENCY,
          pack: requester,
          relationship,
          observedState: [candidateDiagnosticId(current), candidateDiagnosticId(candidate)],
          requiredState: `ONE_VERSION_PER_IDENTITY:${candidate.knowledgeAssetId}`,
          resolutionResult: 'BLOCKED',
        })
      }
    }
    const selected = [...byIdentity.values()].sort((left, right) => (
      left.knowledgeAssetId.localeCompare(right.knowledgeAssetId)
      || compareCandidateRank(right, left, scopePrecedence)
      || candidateNodeId(left).localeCompare(candidateNodeId(right))
    ))
    const cardinality = evaluateRelationshipCardinality(
      relationship.cardinality,
      selected.length,
    )
    if (!cardinality.success) {
      addRelationshipFailure({
        code: selected.length === 0
          ? KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.MISSING_RELATIONSHIP
          : KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.AMBIGUOUS_DEPENDENCY,
        pack: requester,
        relationship,
        observedState: cardinality,
        requiredState: relationship.cardinality,
        resolutionResult: 'BLOCKED',
      })
      return []
    }
    return selected
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
  const processedIdentities = new Set()

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
    preselectedPack = null,
    requirement = KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.REQUIRED,
    requiredBy,
    parentNodeId = '',
    path = [],
    depth = 0,
    missingReason = 'DEPENDENCY_MISSING',
    relationship = null,
    recordDynamicSelection = true,
  }) => {
    const result = preselectedPack
      ? { type: 'SELECTED', selector: toSafeSelector(selector), pack: preselectedPack }
      : selectBest({ pool: dynamicPool, selector, requiredBy })
    if (result.type === 'MISSING') {
      addMissing({ reason: missingReason, requirement, selector, requiredBy })
      return null
    }
    if (result.type === 'AMBIGUOUS') return null

    const pack = result.pack
    const nodeId = candidateNodeId(pack)
    const traversalIdentity = candidateTraversalIdentity(pack)
    graphNodes.set(nodeId, toGraphNode(pack))
    if (parentNodeId) {
      graphEdges.push({
        from: parentNodeId,
        to: nodeId,
        requirement,
        selector: toSafeSelector(selector),
        ...(relationship
          ? {
            relationshipType: relationship.relationshipType,
            requiredAt: relationship.requiredAt,
            cardinality: relationship.cardinality,
            versionConstraint: relationship.versionConstraint,
          }
          : {}),
      })
    }

    const cycleStartIndex = path.findIndex((entry) => entry.identity === traversalIdentity)
    if (cycleStartIndex >= 0) {
      const cycleEntries = [...path.slice(cycleStartIndex), {
        identity: traversalIdentity,
        nodeId,
      }]
      const cycle = {
        identities: cycleEntries.map((entry) => entry.identity),
        path: cycleEntries.map((entry) => entry.nodeId),
      }
      graphCycles.push(cycle)
      addRelationshipFailure({
        code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.CIRCULAR_DEPENDENCY,
        pack,
        relationship,
        observedState: cycle,
        requiredState: 'ACYCLIC_RELATIONSHIP_GRAPH',
        resolutionResult: 'BLOCKED',
      })
      return null
    }

    if (depth > depthLimit) {
      const overflow = {
        identities: [...path.map((entry) => entry.identity), traversalIdentity],
        path: [...path.map((entry) => entry.nodeId), nodeId],
        maxDepth: depthLimit,
      }
      graphDepthOverflows.push(overflow)
      addRelationshipFailure({
        code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.DEPENDENCY_DEPTH_EXCEEDED,
        pack,
        relationship,
        observedState: overflow,
        requiredState: { maxDepth: depthLimit },
        resolutionResult: 'BLOCKED',
      })
      return null
    }

    if (recordDynamicSelection && !selectedDynamic.has(traversalIdentity)) {
      selectedDynamic.set(traversalIdentity, pack)
    }
    if (processedIdentities.has(traversalIdentity)) return pack
    processedIdentities.add(traversalIdentity)

    const nextPath = [...path, { identity: traversalIdentity, nodeId }]
    if (pack.relationshipGovernanceError) {
      addRelationshipFailure({
        code: KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.MISSING_GOVERNANCE_METADATA,
        pack,
        observedState: pack.relationshipGovernanceError,
        requiredState: KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
        resolutionResult: 'BLOCKED',
      })
      return pack
    }

    for (const reference of pack.dependencyReferences) {
      if (
        reference.requiredAt === KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS.NONE
        || reference.relationshipType === KNOWLEDGE_PACK_RELATIONSHIP_TYPES.COMPATIBLE_WITH
        || reference.relationshipType === KNOWLEDGE_PACK_RELATIONSHIP_TYPES.SUPERSEDES
        || reference.relationshipType === KNOWLEDGE_PACK_RELATIONSHIP_TYPES.REFERENCES
      ) continue

      const dependencyRequirement = reference.relationshipType
        === KNOWLEDGE_PACK_RELATIONSHIP_TYPES.OPTIONAL
        ? KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.OPTIONAL
        : KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.REQUIRED

      if (reference.relationshipType === KNOWLEDGE_PACK_RELATIONSHIP_TYPES.REQUIRES_COMPATIBLE_PACK) {
        const compatiblePacks = selectCompatibleSet({ requester: pack, relationship: reference })
        for (const compatiblePack of compatiblePacks) {
          resolveSelector({
            selector: { knowledgeAssetId: compatiblePack.knowledgeAssetId },
            preselectedPack: compatiblePack,
            requirement: dependencyRequirement,
            requiredBy: nodeId,
            parentNodeId: nodeId,
            path: nextPath,
            depth: depth + 1,
            relationship: reference,
          })
        }
        continue
      }

      const dependencySelector = {
        knowledgeLayer: reference.targetKnowledgeLayer,
        packType: reference.targetPackType,
        packKey: reference.targetPackKey,
        capabilityKey: reference.targetCapabilityKey,
        knowledgeAssetId: reference.targetKnowledgeAssetId,
      }
      const relatedPacks = selectRelationshipSet({
        requester: pack,
        relationship: reference,
        selector: dependencySelector,
        requiredBy: nodeId,
      })
      for (const relatedPack of relatedPacks) {
        resolveSelector({
          selector: { knowledgeAssetId: relatedPack.knowledgeAssetId },
          preselectedPack: relatedPack,
          requirement: dependencyRequirement,
          requiredBy: nodeId,
          parentNodeId: nodeId,
          path: nextPath,
          depth: depth + 1,
          relationship: reference,
        })
      }
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

  resolvedMandatorySafeguards
    .filter((pack) => pack.status === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE)
    .forEach((pack) => {
      resolveSelector({
        selector: { packType: pack.packType, packKey: pack.packKey },
        preselectedPack: pack,
        requiredBy: 'MANDATORY_SAFEGUARD_POLICY',
        recordDynamicSelection: false,
      })
    })

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
  const lineageCertificationPacks = []
  const systemOnlyPacks = []
  for (const pack of boundPacks) {
    if (!pack.boundary && pack.executionMode === KNOWLEDGE_PACK_EXECUTION_MODES.SYSTEM_ONLY) {
      systemOnlyPacks.push(pack)
      continue
    }
    switch (resolveKnowledgePackBoundary(pack)) {
      case KNOWLEDGE_PACK_BOUNDARIES.GENERATION_CONTEXT:
        providerContextPacks.push(pack)
        break
      case KNOWLEDGE_PACK_BOUNDARIES.PRE_GENERATION_VALIDATION:
        preValidationPacks.push(pack)
        break
      case KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION:
        postValidationPacks.push(pack)
        break
      case KNOWLEDGE_PACK_BOUNDARIES.LINEAGE_CERTIFICATION:
        lineageCertificationPacks.push(pack)
        break
      default:
        break
    }
  }

  const selectedDynamicIds = new Set(
    [...selectedDynamic.values()].map((pack) => candidateNodeId(pack)),
  )
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
  const hasRelationshipBlocker = relationshipFailures.length > 0
  const status = ambiguousCandidates.length > 0
    ? 'AMBIGUOUS'
    : hasRequiredMissing || hasGraphBlocker || hasRelationshipBlocker
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
    lineageCertificationPacks,
    systemOnlyPacks,
    missingDependencies,
    relationshipFailures,
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

export const discoverRequestSpecificOutputTypes = ({
  mandatorySafeguards = [],
  candidates = [],
  request = {},
  scopeCandidates = [],
  maxDepth = DEFAULT_MAX_DEPTH,
} = {}) => {
  const requestedWorkspaceType = normalizeWorkspaceType(request.workspaceType)
  const capabilityKeys = uniqueValues(
    candidates
      .map(toSafePack)
      .filter(isActivePack)
      .filter((pack) => hasWorkspaceCompatibility(pack, requestedWorkspaceType))
      .filter((pack) => pack.knowledgeLayer === 'OUTPUT_TYPE')
      .map((pack) => pack.capabilityKey),
  ).sort()

  return capabilityKeys.map((capabilityKey) => {
    const resolution = resolveRequestSpecificKnowledgePacks({
      mandatorySafeguards,
      candidates,
      request: {
        ...request,
        requestedOutputTypeKey: capabilityKey,
      },
      scopeCandidates,
      maxDepth,
    })
    const outputTypes = resolution.selectedByLayer.OUTPUT_TYPE || []
    const outputSchemas = resolution.selectedByLayer.OUTPUT_SCHEMA || []
    const styles = resolution.selectedByLayer.STYLE || []

    return {
      capabilityKey,
      status: resolution.status,
      outputType: outputTypes.length === 1 ? outputTypes[0] : null,
      outputSchema: outputSchemas.length === 1 ? outputSchemas[0] : null,
      style: styles.length === 1 ? styles[0] : null,
      warnings: resolution.warnings,
      missingDependencies: resolution.missingDependencies,
      ambiguousCandidates: resolution.ambiguousCandidates,
      lineage: resolution.lineage,
    }
  })
}
