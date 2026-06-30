import {
  KnowledgePackManifest,
} from '../models/index.js'
import { buildKnowledgePackManifestId } from '../models/KnowledgePackManifest.js'
import {
  DEFAULT_OUTCOME_STUDIO_MANIFEST,
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_MANIFEST_STATUSES,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_KNOWLEDGE_PACK_RESOLUTION_MODE,
  OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES,
} from '../constants/outcomeKnowledgePacks.js'
import {
  OUTCOME_STUDIO_REQUIRED_PACKS,
} from '../constants/runtimeOutcomeStudio.js'
import {
  WORKSPACE_TYPES,
  resolveKnowledgePackCategory,
} from '../constants/workspaceGovernance.js'
import { escapeRegex } from '../utils/controllerUtils.js'
import { resolveOutcomeStudioKnowledgePacks } from './outcomeKnowledgePackRegistryService.js'
import { resolveKnowledgePackManifest } from './knowledgePackResolverService.js'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

export const KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS = Object.freeze({
  MANIFEST_NOT_FOUND: 'MANIFEST_NOT_FOUND',
})

const createManifestError = ({
  status,
  code,
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

const PURPOSE_CATEGORY_BY_PACK_TYPE = Object.freeze({
  ARL: KNOWLEDGE_PACK_PURPOSE_CATEGORIES.GOVERNANCE,
  RL: KNOWLEDGE_PACK_PURPOSE_CATEGORIES.GOVERNANCE,
  OUTPUT_SCHEMA: KNOWLEDGE_PACK_PURPOSE_CATEGORIES.OUTPUT,
  TRUTH_CERTIFICATION: KNOWLEDGE_PACK_PURPOSE_CATEGORIES.GOVERNANCE,
  OUTPUT_TYPE_DEFINITION: KNOWLEDGE_PACK_PURPOSE_CATEGORIES.OUTPUT,
})

const buildDefaultManifestPack = (pack = {}) => ({
  packCategory: resolveKnowledgePackCategory({
    packCategory: pack.packCategory,
    packType: pack.packType,
  }),
  purposeCategory: PURPOSE_CATEGORY_BY_PACK_TYPE[pack.packType]
    || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM,
  packType: pack.packType,
  packKey: pack.packKey,
  label: pack.label,
  executionMode: KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
  required: true,
  dependencyKeys: [],
  sourceAuthority: pack.sourceStatus || '',
  metadata: {
    sourceFilename: pack.sourceFilename || '',
  },
})

export const buildDefaultOutcomeStudioManifest = () => {
  const scopeKey = OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL
  const manifest = {
    manifestId: buildKnowledgePackManifestId({
      manifestKey: DEFAULT_OUTCOME_STUDIO_MANIFEST.manifestKey,
      semanticVersion: DEFAULT_OUTCOME_STUDIO_MANIFEST.semanticVersion,
      scopeKey,
    }),
    manifestKey: DEFAULT_OUTCOME_STUDIO_MANIFEST.manifestKey,
    manifestName: DEFAULT_OUTCOME_STUDIO_MANIFEST.manifestName,
    manifestType: DEFAULT_OUTCOME_STUDIO_MANIFEST.manifestType,
    description: 'Compatibility manifest for the current OES-002 five-pack Outcome Studio runtime.',
    semanticVersion: DEFAULT_OUTCOME_STUDIO_MANIFEST.semanticVersion,
    status: KNOWLEDGE_PACK_MANIFEST_STATUSES.ACTIVE,
    workspaceType: WORKSPACE_TYPES.OUTCOME,
    frameworkKey: '',
    runtimeType: '',
    packageKey: '',
    outputKey: '',
    scopeType: OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL,
    scopeKey,
    mandatoryPacks: OUTCOME_STUDIO_REQUIRED_PACKS.map(buildDefaultManifestPack),
    optionalPacks: [],
    blockedPacks: [],
    resolutionPolicy: {
      mode: OUTCOME_KNOWLEDGE_PACK_RESOLUTION_MODE,
      compatibilityResolver: 'OUTCOME_STUDIO_REQUIRED_PACKS',
      requireActiveMandatoryPacks: true,
    },
    validationPolicy: {
      failClosedOnMissingMandatoryPacks: true,
    },
    sourceMetadata: {
      source: 'OES-002 compatibility manifest',
    },
    isSystem: true,
  }

  return manifest
}

const serializeManifest = (manifest = {}) => ({
  manifestId: manifest.manifestId,
  id: manifest.manifestId,
  manifestKey: manifest.manifestKey,
  manifestName: manifest.manifestName,
  manifestType: manifest.manifestType,
  description: manifest.description || '',
  semanticVersion: manifest.semanticVersion,
  status: manifest.status,
  workspaceType: manifest.workspaceType,
  frameworkKey: manifest.frameworkKey || '',
  runtimeType: manifest.runtimeType || '',
  packageKey: manifest.packageKey || '',
  outputKey: manifest.outputKey || '',
  scopeType: manifest.scopeType,
  scopeKey: manifest.scopeKey,
  mandatoryPacks: Array.isArray(manifest.mandatoryPacks) ? manifest.mandatoryPacks : [],
  optionalPacks: Array.isArray(manifest.optionalPacks) ? manifest.optionalPacks : [],
  blockedPacks: Array.isArray(manifest.blockedPacks) ? manifest.blockedPacks : [],
  resolutionPolicy: manifest.resolutionPolicy || {},
  validationPolicy: manifest.validationPolicy || {},
  sourceMetadata: manifest.sourceMetadata || {},
  isSystem: Boolean(manifest.isSystem),
  createdAt: manifest.createdAt,
  updatedAt: manifest.updatedAt,
})

const isDefaultOutcomeStudioManifestIdentifier = (value) => {
  const normalized = normalizeLowerKey(value)
  const defaultManifest = buildDefaultOutcomeStudioManifest()
  return normalized === defaultManifest.manifestKey
    || normalized === normalizeLowerKey(defaultManifest.manifestId)
}

const buildManifestListFilter = ({
  q,
  manifestKey,
  status,
  workspaceType,
  frameworkKey,
  runtimeType,
  packageKey,
  outputKey,
} = {}) => {
  const filter = {}
  const normalizedManifestKey = normalizeLowerKey(manifestKey)
  const normalizedStatus = normalizeToken(status)
  const normalizedWorkspaceType = normalizeToken(workspaceType)
  const normalizedFrameworkKey = normalizeToken(frameworkKey)
  const normalizedRuntimeType = normalizeToken(runtimeType)
  const normalizedPackageKey = normalizeLowerKey(packageKey)
  const normalizedOutputKey = normalizeLowerKey(outputKey)

  if (normalizedManifestKey) filter.manifestKey = normalizedManifestKey
  if (normalizedStatus) filter.status = normalizedStatus
  if (normalizedWorkspaceType) filter.workspaceType = normalizedWorkspaceType
  if (normalizedFrameworkKey) filter.frameworkKey = normalizedFrameworkKey
  if (normalizedRuntimeType) filter.runtimeType = normalizedRuntimeType
  if (normalizedPackageKey) filter.packageKey = normalizedPackageKey
  if (normalizedOutputKey) filter.outputKey = normalizedOutputKey

  const normalizedQuery = normalizeText(q)
  if (normalizedQuery) {
    const regex = new RegExp(escapeRegex(normalizedQuery), 'i')
    filter.$or = [
      { manifestId: regex },
      { manifestKey: regex },
      { manifestName: regex },
      { description: regex },
    ]
  }

  return filter
}

const buildManifestSort = ({ sortBy, sortOrder } = {}) => {
  const direction = String(sortOrder || '').trim().toLowerCase() === 'asc' ? 1 : -1
  if (sortBy === 'manifestName') return { manifestName: direction, manifestKey: 1 }
  if (sortBy === 'manifestKey') return { manifestKey: direction }
  if (sortBy === 'status') return { status: direction, manifestKey: 1 }
  if (sortBy === 'updatedAt') return { updatedAt: direction, manifestKey: 1 }
  return { manifestKey: 1, semanticVersion: 1 }
}

export const listKnowledgePackManifests = async ({ query = {} } = {}) => {
  const page = Number(query.page) || 1
  const pageSize = Number(query.pageSize) || 20
  const filter = buildManifestListFilter(query)
  const [total, rows] = await Promise.all([
    KnowledgePackManifest.countDocuments(filter),
    KnowledgePackManifest.find(filter)
      .sort(buildManifestSort(query))
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ])
  const defaultManifest = buildDefaultOutcomeStudioManifest()
  const persistedRows = rows.filter(
    (row) => normalizeLowerKey(row.manifestId) !== normalizeLowerKey(defaultManifest.manifestId),
  )
  const includeDefault = !filter.manifestKey
    || filter.manifestKey === defaultManifest.manifestKey

  return {
    data: [
      ...(includeDefault ? [serializeManifest(defaultManifest)] : []),
      ...persistedRows.map(serializeManifest),
    ],
    meta: {
      page,
      pageSize,
      total: total + (includeDefault ? 1 : 0),
      defaultManifestIncluded: includeDefault,
    },
  }
}

export const getKnowledgePackManifest = async ({ manifestId } = {}) => {
  if (isDefaultOutcomeStudioManifestIdentifier(manifestId)) {
    return serializeManifest(buildDefaultOutcomeStudioManifest())
  }

  const normalizedManifestId = normalizeText(manifestId)
  const normalizedManifestKey = normalizeLowerKey(manifestId)
  const manifest = await KnowledgePackManifest.findOne({
    $or: [
      { manifestId: normalizedManifestId },
      { manifestKey: normalizedManifestKey },
    ],
  }).lean()

  if (!manifest) {
    throw createManifestError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Knowledge Pack manifest was not found.',
      reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.MANIFEST_NOT_FOUND,
      details: { manifestId },
    })
  }

  return serializeManifest(manifest)
}

export const previewKnowledgePackManifestResolution = async ({
  manifestId,
  query = {},
} = {}) => {
  const manifest = await getKnowledgePackManifest({ manifestId })

  const binding = isDefaultOutcomeStudioManifestIdentifier(manifest.manifestId)
    ? await resolveOutcomeStudioKnowledgePacks(query)
    : await resolveKnowledgePackManifest({ manifest, query })

  return {
    manifest,
    binding: {
      ...binding,
      manifestId: manifest.manifestId,
      manifestKey: manifest.manifestKey,
      manifestVersion: manifest.semanticVersion,
      previewOnly: true,
      contentVisible: false,
    },
  }
}

export const resolveDefaultOutcomeStudioKnowledgePackBinding = async ({
  query = {},
} = {}) => {
  const manifest = serializeManifest(buildDefaultOutcomeStudioManifest())
  const binding = await resolveOutcomeStudioKnowledgePacks(query)

  return {
    manifest,
    binding: {
      ...binding,
      manifestId: manifest.manifestId,
      manifestKey: manifest.manifestKey,
      manifestVersion: manifest.semanticVersion,
      previewOnly: false,
      contentVisible: false,
    },
  }
}
