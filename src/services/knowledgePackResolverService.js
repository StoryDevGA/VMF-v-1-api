import {
  KnowledgePackActivation,
  KnowledgePackVersion,
} from '../models/index.js'
import {
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_MANIFEST_STATUSES,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES,
  OUTCOME_KNOWLEDGE_PACK_RESOLUTION_MODE,
  OUTCOME_KNOWLEDGE_PACK_STATUSES,
} from '../constants/outcomeKnowledgePacks.js'
import {
  buildOutcomeKnowledgePackScopeCandidates,
} from './outcomeKnowledgePackRegistryService.js'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

const BINDABLE_MANIFEST_STATUSES = new Set([
  KNOWLEDGE_PACK_MANIFEST_STATUSES.ACTIVE,
  KNOWLEDGE_PACK_MANIFEST_STATUSES.VALIDATED,
])

const BINDABLE_VERSION_STATUSES = new Set([
  OUTCOME_KNOWLEDGE_PACK_STATUSES.ACTIVE,
  OUTCOME_KNOWLEDGE_PACK_STATUSES.VALIDATED,
])

export const KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS = Object.freeze({
  MANIFEST_NOT_RUNTIME_BINDABLE: 'MANIFEST_NOT_RUNTIME_BINDABLE',
  MANIFEST_DUPLICATE_PACK_REFERENCE: 'MANIFEST_DUPLICATE_PACK_REFERENCE',
  MANIFEST_DEPENDENCY_MISSING: 'MANIFEST_DEPENDENCY_MISSING',
  MANIFEST_DEPENDENCY_AMBIGUOUS: 'MANIFEST_DEPENDENCY_AMBIGUOUS',
  MANIFEST_DEPENDENCY_CYCLE: 'MANIFEST_DEPENDENCY_CYCLE',
  MANDATORY_PACK_MISSING: 'MANDATORY_PACK_MISSING',
  MANDATORY_PACK_INACTIVE: 'MANDATORY_PACK_INACTIVE',
  MANDATORY_PACK_AMBIGUOUS: 'MANDATORY_PACK_AMBIGUOUS',
  MANDATORY_PACK_CONTENT_HASH_MISSING: 'MANDATORY_PACK_CONTENT_HASH_MISSING',
  KNOWLEDGE_PACK_VERSION_NOT_FOUND: 'KNOWLEDGE_PACK_VERSION_NOT_FOUND',
  KNOWLEDGE_PACK_VERSION_NOT_RUNTIME_BINDABLE: 'KNOWLEDGE_PACK_VERSION_NOT_RUNTIME_BINDABLE',
  KNOWLEDGE_PACK_VERSION_HASH_MISMATCH: 'KNOWLEDGE_PACK_VERSION_HASH_MISMATCH',
  MANIFEST_DEPENDENCY_UNRESOLVED: 'MANIFEST_DEPENDENCY_UNRESOLVED',
  BLOCKED_PACK_ACTIVE: 'BLOCKED_PACK_ACTIVE',
})

const createResolverError = ({
  status = 409,
  code = 'CONFLICT',
  message,
  reason,
  details = {},
}) => {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.details = {
    reason,
    ...details,
  }
  return err
}

const packRefId = ({ packType, packKey } = {}) =>
  `${normalizeToken(packType)}:${normalizeLowerKey(packKey)}`

const dependencyRefId = (value) => {
  const rawValue = normalizeText(value)
  if (!rawValue) return ''
  if (!rawValue.includes(':')) return normalizeLowerKey(rawValue)

  const [packType, ...packKeySegments] = rawValue.split(':')
  return `${normalizeToken(packType)}:${normalizeLowerKey(packKeySegments.join(':'))}`
}

const serializeActivation = (activation) => {
  if (!activation) return null
  const plain = typeof activation.toObject === 'function' ? activation.toObject() : activation
  return {
    activationId: normalizeText(plain.activationId),
    packId: normalizeText(plain.packId),
    versionId: normalizeText(plain.versionId),
    packCategory: normalizeToken(plain.packCategory),
    packType: normalizeToken(plain.packType),
    packKey: normalizeLowerKey(plain.packKey),
    label: normalizeText(plain.label),
    semanticVersion: normalizeText(plain.semanticVersion),
    schemaVersion: normalizeText(plain.schemaVersion),
    status: normalizeToken(plain.status),
    scopeType: normalizeToken(plain.scopeType),
    scopeKey: normalizeToken(plain.scopeKey),
    frameworkKey: normalizeToken(plain.frameworkKey),
    runtimeType: normalizeToken(plain.runtimeType),
    packageKey: normalizeLowerKey(plain.packageKey),
    packageVersion: normalizeText(plain.packageVersion),
    environmentKey: normalizeToken(plain.environmentKey),
    visibility: normalizeToken(plain.visibility || 'PLATFORM'),
    customerId: normalizeText(plain.customerId),
    tenantId: normalizeText(plain.tenantId),
    contentHash: normalizeText(plain.contentHash),
    activatedAt: plain.activatedAt,
  }
}

const serializeVersion = (version) => {
  if (!version) return null
  const plain = typeof version.toObject === 'function' ? version.toObject() : version
  return {
    versionId: normalizeText(plain.versionId),
    packId: normalizeText(plain.packId),
    packCategory: normalizeToken(plain.packCategory),
    packType: normalizeToken(plain.packType),
    packKey: normalizeLowerKey(plain.packKey),
    semanticVersion: normalizeText(plain.semanticVersion),
    schemaVersion: normalizeText(plain.schemaVersion),
    status: normalizeToken(plain.status),
    scopeType: normalizeToken(plain.scopeType),
    scopeKey: normalizeToken(plain.scopeKey),
    contentHash: normalizeText(plain.contentHash),
    validatedAt: plain.validatedAt,
  }
}

const normalizeManifestPack = (pack = {}, group) => ({
  group,
  refId: packRefId(pack),
  packCategory: normalizeToken(pack.packCategory),
  purposeCategory: normalizeToken(pack.purposeCategory || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM),
  packType: normalizeToken(pack.packType),
  packKey: normalizeLowerKey(pack.packKey),
  label: normalizeText(pack.label),
  executionMode: normalizeToken(pack.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT),
  dependencyKeys: Array.isArray(pack.dependencyKeys)
    ? [...new Set(pack.dependencyKeys.map(dependencyRefId).filter(Boolean))]
    : [],
  required: group === 'mandatory' || group === 'validation',
  sourceAuthority: normalizeText(pack.sourceAuthority),
  metadata: pack.metadata || {},
})

const buildManifestEntries = (manifest = {}) => {
  const entries = [
    ...(Array.isArray(manifest.mandatoryPacks) ? manifest.mandatoryPacks : [])
      .map((pack) => normalizeManifestPack(pack, 'mandatory')),
    ...(Array.isArray(manifest.optionalPacks) ? manifest.optionalPacks : [])
      .map((pack) => normalizeManifestPack(pack, 'optional')),
    ...(Array.isArray(manifest.validationPacks) ? manifest.validationPacks : [])
      .map((pack) => normalizeManifestPack(pack, 'validation')),
  ]
  const blockedEntries = (Array.isArray(manifest.blockedPacks) ? manifest.blockedPacks : [])
    .map((pack) => normalizeManifestPack(pack, 'blocked'))

  const byRefId = new Map()
  for (const entry of entries) {
    if (!entry.packType || !entry.packKey) continue
    if (byRefId.has(entry.refId)) {
      throw createResolverError({
        message: 'Knowledge Pack manifest contains duplicate pack references.',
        reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.MANIFEST_DUPLICATE_PACK_REFERENCE,
        details: {
          packType: entry.packType,
          packKey: entry.packKey,
        },
      })
    }
    byRefId.set(entry.refId, entry)
  }

  return { entries, blockedEntries, byRefId }
}

const resolveDependencyRef = ({ dependencyKey, entry, byRefId }) => {
  if (dependencyKey.includes(':')) {
    const dependency = byRefId.get(dependencyKey)
    if (!dependency) {
      throw createResolverError({
        message: 'Knowledge Pack manifest dependency is not declared in the manifest pack set.',
        reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.MANIFEST_DEPENDENCY_MISSING,
        details: {
          packType: entry.packType,
          packKey: entry.packKey,
          dependencyKey,
        },
      })
    }
    return dependency
  }

  const matches = [...byRefId.values()].filter((candidate) => candidate.packKey === dependencyKey)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw createResolverError({
      message: 'Knowledge Pack manifest dependency key is ambiguous.',
      reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.MANIFEST_DEPENDENCY_AMBIGUOUS,
      details: {
        packType: entry.packType,
        packKey: entry.packKey,
        dependencyKey,
      },
    })
  }

  throw createResolverError({
    message: 'Knowledge Pack manifest dependency is not declared in the manifest pack set.',
    reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.MANIFEST_DEPENDENCY_MISSING,
    details: {
      packType: entry.packType,
      packKey: entry.packKey,
      dependencyKey,
    },
  })
}

const buildDependencyGraph = ({ entries, byRefId }) => {
  const edges = []
  const adjacency = new Map(entries.map((entry) => [entry.refId, []]))

  for (const entry of entries) {
    for (const dependencyKey of entry.dependencyKeys) {
      const dependency = resolveDependencyRef({ dependencyKey, entry, byRefId })
      edges.push({
        from: entry.refId,
        to: dependency.refId,
        fromPackKey: entry.packKey,
        toPackKey: dependency.packKey,
      })
      adjacency.get(entry.refId).push(dependency.refId)
    }
  }

  const visiting = new Set()
  const visited = new Set()

  const visit = (refId, path = []) => {
    if (visiting.has(refId)) {
      const cycleStart = path.indexOf(refId)
      const cycle = [...path.slice(cycleStart), refId].filter(Boolean)
      throw createResolverError({
        message: 'Knowledge Pack manifest dependency cycle detected.',
        reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.MANIFEST_DEPENDENCY_CYCLE,
        details: {
          cycle,
        },
      })
    }
    if (visited.has(refId)) return

    visiting.add(refId)
    for (const nextRefId of adjacency.get(refId) || []) {
      visit(nextRefId, [...path, refId])
    }
    visiting.delete(refId)
    visited.add(refId)
  }

  for (const entry of entries) {
    visit(entry.refId)
  }

  return {
    status: 'RESOLVED',
    edges,
    edgeCount: edges.length,
  }
}

const buildActivationCandidatesByRef = ({ activations = [] }) => {
  const candidatesByRef = new Map()
  for (const activation of activations.map(serializeActivation).filter(Boolean)) {
    const refId = packRefId(activation)
    if (!candidatesByRef.has(refId)) candidatesByRef.set(refId, [])
    candidatesByRef.get(refId).push(activation)
  }
  return candidatesByRef
}

const compareActivationSpecificity = (left, right, scopePrecedenceByKey) => {
  const leftScopeScore = scopePrecedenceByKey.get(normalizeToken(left?.scopeKey)) ?? -1
  const rightScopeScore = scopePrecedenceByKey.get(normalizeToken(right?.scopeKey)) ?? -1
  if (leftScopeScore !== rightScopeScore) return leftScopeScore - rightScopeScore

  const leftActivatedAt = new Date(left?.activatedAt || 0).getTime() || 0
  const rightActivatedAt = new Date(right?.activatedAt || 0).getTime() || 0
  return leftActivatedAt - rightActivatedAt
}

const selectActivationForEntry = ({ entry, candidates = [], scopePrecedenceByKey }) => {
  const activeCandidates = candidates
    .filter((activation) => activation.status === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE)

  if (activeCandidates.length === 0) {
    if (entry.required && candidates.length > 0) {
      throw createResolverError({
        message: 'Mandatory Knowledge Pack has no active runtime-bindable activation.',
        reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.MANDATORY_PACK_INACTIVE,
        details: {
          packType: entry.packType,
          packKey: entry.packKey,
          observedStatuses: [...new Set(candidates.map((activation) => activation.status).filter(Boolean))],
        },
      })
    }
    if (entry.required) {
      throw createResolverError({
        message: 'Mandatory Knowledge Pack is not active for the manifest resolution scope.',
        reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.MANDATORY_PACK_MISSING,
        details: {
          packType: entry.packType,
          packKey: entry.packKey,
        },
      })
    }
    return null
  }

  const activeByScope = new Map()
  for (const activation of activeCandidates) {
    const scopeKey = normalizeToken(activation.scopeKey)
    if (!activeByScope.has(scopeKey)) activeByScope.set(scopeKey, [])
    activeByScope.get(scopeKey).push(activation)
  }

  for (const [scopeKey, scopeActivations] of activeByScope.entries()) {
    if (scopeActivations.length > 1) {
      throw createResolverError({
        message: 'Knowledge Pack manifest resolution found ambiguous active activations.',
        reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.MANDATORY_PACK_AMBIGUOUS,
        details: {
          packType: entry.packType,
          packKey: entry.packKey,
          scopeKey,
          activationIds: scopeActivations.map((activation) => activation.activationId),
        },
      })
    }
  }

  return activeCandidates
    .sort((left, right) => compareActivationSpecificity(right, left, scopePrecedenceByKey))[0]
}

const buildPackProjection = ({
  entry,
  activation,
  version,
  runtimeBindable,
  reason = '',
}) => ({
  packCategory: entry.packCategory || activation?.packCategory || version?.packCategory || '',
  purposeCategory: entry.purposeCategory,
  packType: entry.packType,
  packKey: entry.packKey,
  manifestSection: entry.group,
  label: entry.label || activation?.label || '',
  executionMode: entry.executionMode,
  required: entry.required,
  dependencyKeys: entry.dependencyKeys,
  runtimeBindable,
  ...(reason ? { reason } : {}),
  ...(activation ? {
    activationId: activation.activationId,
    packId: activation.packId,
    versionId: activation.versionId,
    semanticVersion: activation.semanticVersion,
    schemaVersion: activation.schemaVersion,
    activationStatus: activation.status,
    scopeType: activation.scopeType,
    scopeKey: activation.scopeKey,
    visibility: activation.visibility,
    customerId: activation.customerId,
    tenantId: activation.tenantId,
    contentHash: activation.contentHash,
    activatedAt: activation.activatedAt,
  } : {}),
  ...(version ? {
    versionStatus: version.status,
    validatedAt: version.validatedAt,
  } : {}),
})

const assertSelectedVersionBindable = ({ entry, activation, version }) => {
  if (!version) {
    throw createResolverError({
      message: 'Knowledge Pack activation version was not found.',
      reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.KNOWLEDGE_PACK_VERSION_NOT_FOUND,
      details: {
        packType: entry.packType,
        packKey: entry.packKey,
        versionId: activation.versionId,
      },
    })
  }

  if (!BINDABLE_VERSION_STATUSES.has(version.status)) {
    throw createResolverError({
      message: 'Knowledge Pack version is not runtime-bindable.',
      reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.KNOWLEDGE_PACK_VERSION_NOT_RUNTIME_BINDABLE,
      details: {
        packType: entry.packType,
        packKey: entry.packKey,
        versionId: activation.versionId,
        versionStatus: version.status,
      },
    })
  }

  if (!activation.contentHash || !version.contentHash) {
    throw createResolverError({
      message: 'Knowledge Pack runtime binding requires stable content hashes.',
      reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.MANDATORY_PACK_CONTENT_HASH_MISSING,
      details: {
        packType: entry.packType,
        packKey: entry.packKey,
        versionId: activation.versionId,
      },
    })
  }

  if (activation.contentHash !== version.contentHash) {
    throw createResolverError({
      message: 'Knowledge Pack activation hash no longer matches the activated version hash.',
      reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.KNOWLEDGE_PACK_VERSION_HASH_MISMATCH,
      details: {
        packType: entry.packType,
        packKey: entry.packKey,
        versionId: activation.versionId,
      },
    })
  }
}

const assertDependenciesResolved = ({ entries, resolvedByRefId }) => {
  for (const entry of entries) {
    const resolvedEntry = resolvedByRefId.get(entry.refId)
    if (!entry.required && !resolvedEntry?.runtimeBindable) continue

    for (const dependencyRef of entry.dependencyKeys) {
      const dependency = [...resolvedByRefId.keys()]
        .find((candidateRef) => candidateRef === dependencyRef || candidateRef.endsWith(`:${dependencyRef}`))
      const dependencyProjection = resolvedByRefId.get(dependency)
      if (!dependencyProjection?.runtimeBindable) {
        throw createResolverError({
          message: 'Knowledge Pack manifest dependency did not resolve to a runtime-bindable pack.',
          reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.MANIFEST_DEPENDENCY_UNRESOLVED,
          details: {
            packType: entry.packType,
            packKey: entry.packKey,
            dependencyKey: dependencyRef,
          },
        })
      }
    }
  }
}

const assertNoBlockedPacksActive = ({ blockedEntries, candidatesByRef }) => {
  for (const entry of blockedEntries) {
    const activeBlocked = (candidatesByRef.get(entry.refId) || [])
      .filter((activation) => activation.status === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE)
    if (activeBlocked.length > 0) {
      throw createResolverError({
        message: 'Knowledge Pack manifest blocked pack is active in the resolution scope.',
        reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.BLOCKED_PACK_ACTIVE,
        details: {
          packType: entry.packType,
          packKey: entry.packKey,
          activationIds: activeBlocked.map((activation) => activation.activationId),
        },
      })
    }
  }
}

export const resolveKnowledgePackManifest = async ({
  manifest,
  query = {},
} = {}) => {
  const manifestStatus = normalizeToken(manifest?.status)
  if (!BINDABLE_MANIFEST_STATUSES.has(manifestStatus)) {
    throw createResolverError({
      message: 'Knowledge Pack manifest is not runtime-bindable.',
      reason: KNOWLEDGE_PACK_RESOLVER_ERROR_REASONS.MANIFEST_NOT_RUNTIME_BINDABLE,
      details: {
        manifestId: manifest?.manifestId,
        manifestStatus,
      },
    })
  }

  const { entries, blockedEntries, byRefId } = buildManifestEntries(manifest)
  const dependencyGraph = buildDependencyGraph({ entries, byRefId })
  const scopeCandidates = buildOutcomeKnowledgePackScopeCandidates({
    frameworkKey: query.frameworkKey || manifest.frameworkKey,
    runtimeType: query.runtimeType || manifest.runtimeType,
    packageKey: query.packageKey || manifest.packageKey,
    packageVersion: query.packageVersion,
    environmentKey: query.environmentKey,
  })
  const scopePrecedenceByKey = new Map(
    scopeCandidates.map((candidate) => [normalizeToken(candidate.scopeKey), candidate.precedence]),
  )
  const scopeKeys = scopeCandidates.map((candidate) => normalizeToken(candidate.scopeKey))
  const packTypes = [...new Set([...entries, ...blockedEntries].map((entry) => entry.packType).filter(Boolean))]
  const packKeys = [...new Set([...entries, ...blockedEntries].map((entry) => entry.packKey).filter(Boolean))]

  const activations = packTypes.length && packKeys.length
    ? await KnowledgePackActivation.find({
      packType: { $in: packTypes },
      packKey: { $in: packKeys },
      scopeKey: { $in: scopeKeys },
    })
      .sort({ activatedAt: -1 })
      .lean()
    : []
  const candidatesByRef = buildActivationCandidatesByRef({ activations })
  assertNoBlockedPacksActive({ blockedEntries, candidatesByRef })

  const selectedActivationsByRef = new Map()
  for (const entry of entries) {
    const activation = selectActivationForEntry({
      entry,
      candidates: candidatesByRef.get(entry.refId) || [],
      scopePrecedenceByKey,
    })
    if (activation) selectedActivationsByRef.set(entry.refId, activation)
  }

  const selectedVersionIds = [...new Set(
    [...selectedActivationsByRef.values()].map((activation) => activation.versionId).filter(Boolean),
  )]
  const versions = selectedVersionIds.length
    ? await KnowledgePackVersion.find({ versionId: { $in: selectedVersionIds } }).lean()
    : []
  const versionsById = new Map(
    versions.map(serializeVersion).filter(Boolean).map((version) => [version.versionId, version]),
  )

  const resolvedByRefId = new Map()
  for (const entry of entries) {
    const activation = selectedActivationsByRef.get(entry.refId)
    if (!activation) {
      const projection = buildPackProjection({
        entry,
        runtimeBindable: false,
        reason: 'NOT_ACTIVE_FOR_SCOPE',
      })
      resolvedByRefId.set(entry.refId, projection)
      continue
    }

    const version = versionsById.get(activation.versionId)
    assertSelectedVersionBindable({ entry, activation, version })
    resolvedByRefId.set(entry.refId, buildPackProjection({
      entry,
      activation,
      version,
      runtimeBindable: true,
    }))
  }

  assertDependenciesResolved({ entries, resolvedByRefId })

  const resolvedPacks = [...resolvedByRefId.values()]
  const activePacks = resolvedPacks.filter((pack) => pack.runtimeBindable)
  const requiredPacks = resolvedPacks.filter((pack) => pack.required)
  const optionalPacks = resolvedPacks.filter((pack) => !pack.required)
  const validationPacks = resolvedPacks.filter((pack) => pack.manifestSection === 'validation')

  return {
    status: 'PROJECTED',
    mode: OUTCOME_KNOWLEDGE_PACK_RESOLUTION_MODE,
    summary: 'Knowledge Pack manifest resolved all mandatory runtime-bindable packs.',
    manifestId: manifest.manifestId,
    manifestKey: manifest.manifestKey,
    manifestVersion: manifest.semanticVersion,
    previewOnly: true,
    contentVisible: false,
    activePacks,
    requiredPacks,
    optionalPacks,
    validationPacks,
    dependencyGraph,
    resolution: {
      status: 'PROJECTED',
      scopeCandidates,
      activeCount: activePacks.length,
      requiredCount: requiredPacks.length,
      optionalCount: optionalPacks.length,
      validationCount: validationPacks.length,
      dependencyCount: dependencyGraph.edgeCount,
      unboundRequiredPacks: [],
    },
  }
}
