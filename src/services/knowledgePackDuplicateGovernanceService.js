import crypto from 'node:crypto'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackVersion,
} from '../models/index.js'
import { OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES } from '../constants/outcomeKnowledgePacks.js'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()
const normalizeName = (value) => normalizeLowerKey(value)
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ')

export const KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS = Object.freeze({
  IDENTITY_DUPLICATE: 'IDENTITY_DUPLICATE',
  VERSION_DUPLICATE: 'VERSION_DUPLICATE',
  ACTIVE_IDENTITY_CONFLICT: 'ACTIVE_IDENTITY_CONFLICT',
  ACTIVE_CAPABILITY_CONFLICT: 'ACTIVE_CAPABILITY_CONFLICT',
  CONTENT_DUPLICATE: 'CONTENT_DUPLICATE',
  SOURCE_DUPLICATE: 'SOURCE_DUPLICATE',
  NORMALIZED_NAME_MATCH: 'NORMALIZED_NAME_MATCH',
})

export const KNOWLEDGE_PACK_DUPLICATE_SEVERITIES = Object.freeze({
  BLOCKING: 'BLOCKING',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
})

const BLOCKING_CLASSIFICATIONS = new Set([
  KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.IDENTITY_DUPLICATE,
  KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.VERSION_DUPLICATE,
  KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.ACTIVE_IDENTITY_CONFLICT,
  KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.ACTIVE_CAPABILITY_CONFLICT,
])

const toPlainObject = (value) => {
  if (!value) return null
  if (typeof value.toObject === 'function') return value.toObject({ transform: false })
  return { ...value }
}

const toSafeCandidate = (value = {}) => {
  const plain = toPlainObject(value) || {}
  return {
    ...(normalizeText(plain.packId || plain.id) ? { packId: normalizeText(plain.packId || plain.id) } : {}),
    ...(normalizeText(plain.versionId) ? { versionId: normalizeText(plain.versionId) } : {}),
    ...(normalizeText(plain.activationId) ? { activationId: normalizeText(plain.activationId) } : {}),
    ...(normalizeToken(plain.packType) ? { packType: normalizeToken(plain.packType) } : {}),
    ...(normalizeLowerKey(plain.packKey) ? { packKey: normalizeLowerKey(plain.packKey) } : {}),
    ...(normalizeText(plain.label) ? { label: normalizeText(plain.label) } : {}),
    ...(normalizeText(plain.semanticVersion) ? { semanticVersion: normalizeText(plain.semanticVersion) } : {}),
    ...(normalizeToken(plain.scopeKey) ? { scopeKey: normalizeToken(plain.scopeKey) } : {}),
    ...(normalizeToken(plain.status) ? { status: normalizeToken(plain.status) } : {}),
    ...(normalizeToken(plain.knowledgeLayer) ? { knowledgeLayer: normalizeToken(plain.knowledgeLayer) } : {}),
    ...(normalizeLowerKey(plain.capabilityKey) ? { capabilityKey: normalizeLowerKey(plain.capabilityKey) } : {}),
  }
}

const buildGroupId = ({ classification, key }) => {
  const digest = crypto
    .createHash('sha256')
    .update(`${classification}:${key}`)
    .digest('hex')
    .slice(0, 16)
  return `kpd-${classification.toLowerCase().replace(/_/g, '-')}-${digest}`
}

const buildGroups = ({ rows, classification, keyForRow, minimumSize = 2 }) => {
  const grouped = new Map()
  for (const row of rows) {
    const key = normalizeText(keyForRow(row))
    if (!key) continue
    const values = grouped.get(key) || []
    values.push(row)
    grouped.set(key, values)
  }

  return [...grouped.entries()]
    .filter(([, values]) => values.length >= minimumSize)
    .map(([key, values]) => ({
      groupId: buildGroupId({ classification, key }),
      classification,
      severity: BLOCKING_CLASSIFICATIONS.has(classification)
        ? KNOWLEDGE_PACK_DUPLICATE_SEVERITIES.BLOCKING
        : KNOWLEDGE_PACK_DUPLICATE_SEVERITIES.REVIEW_REQUIRED,
      packIds: [...new Set(values.map((row) => normalizeText(row.packId || row.id)).filter(Boolean))],
      versionIds: [...new Set(values.map((row) => normalizeText(row.versionId)).filter(Boolean))],
      activationIds: [...new Set(values.map((row) => normalizeText(row.activationId)).filter(Boolean))],
      candidates: values.map(toSafeCandidate),
    }))
}

export const buildKnowledgePackDuplicateDiagnostics = ({
  packs = [],
  versions = [],
  activations = [],
  generatedAt = new Date(),
} = {}) => {
  const activeActivations = activations.filter((activation) =>
    normalizeToken(activation.status) === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE)
  const normalizedNameRows = packs.filter((pack) => normalizeName(pack.label))
  const sourceRows = versions.flatMap((version) => {
    const sourceHashes = [
      ...(Array.isArray(version.sourceDocuments)
        ? version.sourceDocuments.map((sourceDocument) => normalizeText(sourceDocument?.sourceHash))
        : []),
      normalizeText(version.sourceMetadata?.sourceHash),
    ].filter(Boolean)

    return [...new Set(sourceHashes)].map((duplicateSourceHash) => ({
      ...version,
      duplicateSourceHash,
    }))
  })

  const groups = [
    ...buildGroups({
      rows: packs,
      classification: KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.IDENTITY_DUPLICATE,
      keyForRow: (row) => `${normalizeToken(row.packType)}:${normalizeLowerKey(row.packKey)}`,
    }),
    ...buildGroups({
      rows: versions,
      classification: KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.VERSION_DUPLICATE,
      keyForRow: (row) => `${normalizeToken(row.packType)}:${normalizeLowerKey(row.packKey)}:${normalizeText(row.semanticVersion)}:${normalizeToken(row.scopeKey)}`,
    }),
    ...buildGroups({
      rows: versions,
      classification: KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.CONTENT_DUPLICATE,
      keyForRow: (row) => normalizeText(row.contentHash),
    }),
    ...buildGroups({
      rows: sourceRows,
      classification: KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.SOURCE_DUPLICATE,
      keyForRow: (row) => row.duplicateSourceHash,
    }),
    ...buildGroups({
      rows: normalizedNameRows,
      classification: KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.NORMALIZED_NAME_MATCH,
      keyForRow: (row) => normalizeName(row.label),
    }).filter((group) => new Set(group.candidates.map((candidate) => candidate.packKey)).size > 1),
    ...buildGroups({
      rows: activeActivations,
      classification: KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.ACTIVE_IDENTITY_CONFLICT,
      keyForRow: (row) => `${normalizeToken(row.packType)}:${normalizeLowerKey(row.packKey)}:${normalizeToken(row.scopeKey)}`,
    }),
    ...buildGroups({
      rows: activeActivations.filter((row) => row.knowledgeLayer && row.capabilityKey),
      classification: KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.ACTIVE_CAPABILITY_CONFLICT,
      keyForRow: (row) => `${normalizeToken(row.knowledgeLayer)}:${normalizeLowerKey(row.capabilityKey)}:${normalizeToken(row.scopeKey)}`,
    }).filter((group) => new Set(group.packIds).size > 1),
  ]

  const diagnosticsByPackId = new Map()
  for (const group of groups) {
    for (const packId of group.packIds) {
      const current = diagnosticsByPackId.get(packId) || {
        packId,
        status: 'CLEAR',
        classifications: [],
        groupIds: [],
      }
      current.classifications.push(group.classification)
      current.groupIds.push(group.groupId)
      current.status = group.severity === KNOWLEDGE_PACK_DUPLICATE_SEVERITIES.BLOCKING
        ? 'BLOCKED'
        : current.status === 'BLOCKED' ? 'BLOCKED' : 'REVIEW_REQUIRED'
      diagnosticsByPackId.set(packId, current)
    }
  }

  const blockingGroups = groups.filter((group) =>
    group.severity === KNOWLEDGE_PACK_DUPLICATE_SEVERITIES.BLOCKING).length
  const reviewRequiredGroups = groups.length - blockingGroups

  return {
    status: blockingGroups > 0 ? 'BLOCKED' : reviewRequiredGroups > 0 ? 'REVIEW_REQUIRED' : 'CLEAR',
    generatedAt: new Date(generatedAt).toISOString(),
    summary: {
      totalGroups: groups.length,
      blockingGroups,
      reviewRequiredGroups,
      affectedPacks: diagnosticsByPackId.size,
    },
    packDiagnostics: [...diagnosticsByPackId.values()],
    groups,
  }
}

export const scanOutcomeKnowledgePackDuplicates = async () => {
  const [packs, versions, activations] = await Promise.all([
    KnowledgePack.find({}).lean(),
    KnowledgePackVersion.find({}).lean(),
    KnowledgePackActivation.find({ status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE }).lean(),
  ])
  return buildKnowledgePackDuplicateDiagnostics({ packs, versions, activations })
}

const appendWarning = ({ warnings, classification, candidate }) => {
  if (!candidate) return
  warnings.push({
    classification,
    candidate: toSafeCandidate(candidate),
  })
}

export const findSourceImportDuplicateWarnings = async ({
  canonicalPackId,
  contentHash,
  label,
  sourceHash,
  scopeKey,
} = {}) => {
  const warnings = []
  const normalizedScopeKey = normalizeToken(scopeKey)
  const [contentMatches, sourceMatches, nameCandidates] = await Promise.all([
    contentHash
      ? KnowledgePackVersion.find({ contentHash, scopeKey: normalizedScopeKey }).lean()
      : [],
    sourceHash
      ? KnowledgePackVersion.find({
        scopeKey: normalizedScopeKey,
        $or: [
          { 'sourceDocuments.sourceHash': sourceHash },
          { 'sourceMetadata.sourceHash': sourceHash },
        ],
      }).lean()
      : [],
    normalizeName(label)
      ? KnowledgePack.find({ packId: { $ne: canonicalPackId } }).lean()
      : [],
  ])

  contentMatches.forEach((candidate) => appendWarning({
    warnings,
    classification: KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.CONTENT_DUPLICATE,
    candidate,
  }))
  sourceMatches.forEach((candidate) => appendWarning({
    warnings,
    classification: KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.SOURCE_DUPLICATE,
    candidate,
  }))
  nameCandidates
    .filter((candidate) => normalizeName(candidate.label) === normalizeName(label))
    .forEach((candidate) => appendWarning({
      warnings,
      classification: KNOWLEDGE_PACK_DUPLICATE_CLASSIFICATIONS.NORMALIZED_NAME_MATCH,
      candidate,
    }))

  const uniqueWarnings = new Map()
  for (const warning of warnings) {
    const candidateIdentity = warning.candidate.versionId
      || warning.candidate.packId
      || `${warning.candidate.packType}:${warning.candidate.packKey}`
    uniqueWarnings.set(`${warning.classification}:${candidateIdentity}`, warning)
  }
  return [...uniqueWarnings.values()]
}

export const findActiveCapabilityConflict = async ({
  capabilityKey,
  knowledgeLayer,
  packId,
  scopeKey,
  session = null,
} = {}) => {
  const normalizedLayer = normalizeToken(knowledgeLayer)
  const normalizedCapability = normalizeLowerKey(capabilityKey)
  if (!normalizedLayer || !normalizedCapability) return null

  let query = KnowledgePackActivation.findOne({
    status: OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE,
    scopeKey: normalizeToken(scopeKey),
    knowledgeLayer: normalizedLayer,
    capabilityKey: normalizedCapability,
    packId: { $ne: normalizeText(packId) },
  })
  if (session && typeof query.session === 'function') query = query.session(session)
  const conflict = typeof query.lean === 'function' ? await query.lean() : await query
  return conflict ? toSafeCandidate(conflict) : null
}

export const isActiveCapabilityConflictRace = (err) => (
  Number(err?.code) === 11000
  && (
    normalizeText(err?.message).includes('uniq_active_knowledge_capability_scope')
    || (err?.keyPattern?.knowledgeLayer && err?.keyPattern?.capabilityKey)
  )
)

export const isKnowledgePackVersionDuplicateRace = (err) => (
  Number(err?.code) === 11000
  && (
    err?.keyPattern?.versionId
    || (
      err?.keyPattern?.packType
      && err?.keyPattern?.packKey
      && err?.keyPattern?.semanticVersion
      && err?.keyPattern?.scopeKey
    )
    || normalizeText(err?.message).includes('knowledgepackversions')
  )
)
