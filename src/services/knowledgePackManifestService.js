import mongoose from 'mongoose'
import auditService from './auditService.js'
import {
  KnowledgePackManifest,
} from '../models/index.js'
import { buildKnowledgePackManifestId } from '../models/KnowledgePackManifest.js'
import {
  DEFAULT_OUTCOME_STUDIO_MANIFEST,
  KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_MANIFEST_STATUSES,
  KNOWLEDGE_PACK_MANIFEST_TYPES,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES,
  KNOWLEDGE_PACK_VISIBILITY_SCOPES,
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
  MANIFEST_ALREADY_EXISTS: 'MANIFEST_ALREADY_EXISTS',
  MANIFEST_IMMUTABLE: 'MANIFEST_IMMUTABLE',
  MANIFEST_SYSTEM_IMMUTABLE: 'MANIFEST_SYSTEM_IMMUTABLE',
  MANIFEST_AUDIT_FAILED: 'MANIFEST_AUDIT_FAILED',
  REASONING_CONTEXT_PACK_MISSING: 'REASONING_CONTEXT_PACK_MISSING',
  REASONING_CONTEXT_PACK_SCOPE_FORBIDDEN: 'REASONING_CONTEXT_PACK_SCOPE_FORBIDDEN',
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

const MANIFEST_MUTABLE_STATUSES = new Set([
  KNOWLEDGE_PACK_MANIFEST_STATUSES.DRAFT,
  KNOWLEDGE_PACK_MANIFEST_STATUSES.FAILED_VALIDATION,
])

const MANIFEST_PACK_SECTIONS = Object.freeze([
  'mandatoryPacks',
  'optionalPacks',
  'validationPacks',
  'blockedPacks',
])

const REASONING_CONTEXT_PURPOSE_CATEGORIES = Object.freeze([
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.STYLE,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.AUDIENCE,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.INDUSTRY,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.LANGUAGE,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.BRAND,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.DECISION,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.COMPLIANCE,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.DOMAIN,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES.ADVISOR,
])

const getActorObjectId = (actorUserId) =>
  mongoose.Types.ObjectId.isValid(actorUserId)
    ? new mongoose.Types.ObjectId(actorUserId)
    : null

const clonePlain = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const isDuplicateKeyError = (err) => err?.code === 11000

const normalizeManifestPack = (pack = {}, { requiredDefault = true } = {}) => ({
  packCategory: pack.packCategory,
  purposeCategory: pack.purposeCategory || KNOWLEDGE_PACK_PURPOSE_CATEGORIES.SYSTEM,
  packType: pack.packType,
  packKey: pack.packKey,
  label: pack.label || '',
  executionMode: pack.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
  boundary: pack.boundary || undefined,
  required: pack.required ?? requiredDefault,
  dependencyKeys: Array.isArray(pack.dependencyKeys) ? pack.dependencyKeys : [],
  sourceAuthority: pack.sourceAuthority || '',
  metadata: pack.metadata || {},
})

const normalizeManifestPackSection = (packs = [], section) => {
  const requiredDefault = section === 'mandatoryPacks' || section === 'validationPacks'
  return Array.isArray(packs)
    ? packs.map((pack) => normalizeManifestPack(pack, { requiredDefault }))
    : []
}

const buildManifestCreatePayload = ({
  body = {},
  actorUserId,
  sourceMetadata = {},
  forceStatus,
} = {}) => {
  const scopeKey = body.scopeKey || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL
  const manifestKey = normalizeLowerKey(body.manifestKey)
  const semanticVersion = normalizeText(body.semanticVersion)

  return {
    manifestId: buildKnowledgePackManifestId({ manifestKey, semanticVersion, scopeKey }),
    manifestKey,
    manifestName: normalizeText(body.manifestName),
    manifestType: normalizeToken(body.manifestType || KNOWLEDGE_PACK_MANIFEST_TYPES.FRAMEWORK_RUNTIME),
    description: normalizeText(body.description),
    semanticVersion,
    status: forceStatus || KNOWLEDGE_PACK_MANIFEST_STATUSES.DRAFT,
    workspaceType: normalizeToken(body.workspaceType || WORKSPACE_TYPES.OUTCOME),
    frameworkKey: normalizeToken(body.frameworkKey),
    runtimeType: normalizeToken(body.runtimeType),
    packageKey: normalizeLowerKey(body.packageKey),
    outputKey: normalizeLowerKey(body.outputKey),
    scopeType: normalizeToken(body.scopeType || OUTCOME_KNOWLEDGE_PACK_SCOPE_TYPES.GLOBAL),
    scopeKey,
    mandatoryPacks: normalizeManifestPackSection(body.mandatoryPacks, 'mandatoryPacks'),
    optionalPacks: normalizeManifestPackSection(body.optionalPacks, 'optionalPacks'),
    validationPacks: normalizeManifestPackSection(body.validationPacks, 'validationPacks'),
    blockedPacks: normalizeManifestPackSection(body.blockedPacks, 'blockedPacks'),
    resolutionPolicy: body.resolutionPolicy || {},
    validationPolicy: body.validationPolicy || {},
    sourceMetadata: {
      ...(body.sourceMetadata || {}),
      ...sourceMetadata,
    },
    isSystem: false,
    createdBy: getActorObjectId(actorUserId),
    updatedBy: getActorObjectId(actorUserId),
  }
}

const buildManifestUpdateSet = ({ body = {}, actorUserId } = {}) => {
  const update = {
    updatedBy: getActorObjectId(actorUserId),
  }

  for (const field of [
    'manifestName',
    'description',
    'manifestType',
    'workspaceType',
    'frameworkKey',
    'runtimeType',
    'packageKey',
    'outputKey',
    'resolutionPolicy',
    'validationPolicy',
    'sourceMetadata',
  ]) {
    if (body[field] !== undefined) update[field] = body[field]
  }

  for (const section of MANIFEST_PACK_SECTIONS) {
    if (body[section] !== undefined) {
      update[section] = normalizeManifestPackSection(body[section], section)
    }
  }

  return update
}

const buildAuditDiffSummary = (manifest = {}) => ({
  manifestKey: manifest.manifestKey,
  semanticVersion: manifest.semanticVersion,
  status: manifest.status,
  mandatoryCount: manifest.mandatoryPacks?.length || 0,
  optionalCount: manifest.optionalPacks?.length || 0,
  validationCount: manifest.validationPacks?.length || 0,
  blockedCount: manifest.blockedPacks?.length || 0,
  contentVisible: false,
})

const logManifestMutation = async ({
  action,
  manifest,
  actorUserId,
  auditRequest,
  session,
  diff = {},
}) => {
  const auditPayload = {
    actorUserId,
    action,
    resourceType: auditService.RESOURCE_TYPES.KnowledgePackManifest,
    resourceId: manifest.manifestId,
    diff: {
      ...diff,
      manifest: buildAuditDiffSummary(manifest),
    },
    display: {
      targetLabel: manifest.manifestName || manifest.manifestKey,
    },
  }

  try {
    if (auditRequest) {
      await auditService.logFromRequest(auditRequest, auditPayload, { session, throwOnError: true })
      return
    }

    await auditService.log(auditPayload, { session, throwOnError: true })
  } catch (err) {
    throw createManifestError({
      status: 503,
      code: 'AUDIT_WRITE_FAILED',
      message: 'Knowledge Pack manifest audit could not be persisted.',
      reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.MANIFEST_AUDIT_FAILED,
      details: {
        manifestId: manifest.manifestId,
      },
    })
  }
}

const assertManifestMutable = (manifest = {}) => {
  if (manifest.isSystem || isDefaultOutcomeStudioManifestIdentifier(manifest.manifestId)) {
    throw createManifestError({
      status: 409,
      code: 'CONFLICT',
      message: 'System Knowledge Pack manifests are immutable.',
      reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.MANIFEST_SYSTEM_IMMUTABLE,
      details: {
        manifestId: manifest.manifestId,
      },
    })
  }

  if (!MANIFEST_MUTABLE_STATUSES.has(normalizeToken(manifest.status))) {
    throw createManifestError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge Pack manifest can only be edited while draft or failed validation.',
      reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.MANIFEST_IMMUTABLE,
      details: {
        manifestId: manifest.manifestId,
        status: manifest.status,
      },
    })
  }
}

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
  metadata: {},
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
    validationPacks: [],
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
  validationPacks: Array.isArray(manifest.validationPacks) ? manifest.validationPacks : [],
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

export const createKnowledgePackManifest = async ({
  body = {},
  actorUserId,
  auditRequest,
} = {}) => {
  const payload = buildManifestCreatePayload({ body, actorUserId })
  const existing = await KnowledgePackManifest.exists({
    $or: [
      { manifestId: payload.manifestId },
      {
        manifestKey: payload.manifestKey,
        semanticVersion: payload.semanticVersion,
        scopeKey: payload.scopeKey,
      },
    ],
  })

  if (existing) {
    throw createManifestError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge Pack manifest already exists for this key, version, and scope.',
      reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.MANIFEST_ALREADY_EXISTS,
      details: {
        manifestId: payload.manifestId,
        manifestKey: payload.manifestKey,
        semanticVersion: payload.semanticVersion,
        scopeKey: payload.scopeKey,
      },
    })
  }

  const session = await mongoose.startSession()
  try {
    let savedManifest
    await session.withTransaction(async () => {
      const manifest = new KnowledgePackManifest(payload)
      savedManifest = await manifest.save({ session })
      await logManifestMutation({
        action: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_MANIFEST_CREATED,
        manifest: savedManifest,
        actorUserId,
        auditRequest,
        session,
        diff: { operation: 'CREATE_MANIFEST' },
      })
    })
    return serializeManifest(savedManifest)
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw createManifestError({
        status: 409,
        code: 'CONFLICT',
        message: 'Knowledge Pack manifest already exists for this key, version, and scope.',
        reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.MANIFEST_ALREADY_EXISTS,
        details: {
          manifestId: payload.manifestId,
          manifestKey: payload.manifestKey,
          semanticVersion: payload.semanticVersion,
          scopeKey: payload.scopeKey,
        },
      })
    }
    throw err
  } finally {
    await session.endSession()
  }
}

export const updateKnowledgePackManifest = async ({
  manifestId,
  body = {},
  actorUserId,
  auditRequest,
} = {}) => {
  const normalizedManifestId = normalizeText(manifestId)
  const existingManifest = await getKnowledgePackManifest({ manifestId: normalizedManifestId })
  assertManifestMutable(existingManifest)

  const session = await mongoose.startSession()
  try {
    let updatedManifest
    await session.withTransaction(async () => {
      updatedManifest = await KnowledgePackManifest.findOneAndUpdate(
        { manifestId: existingManifest.manifestId },
        { $set: buildManifestUpdateSet({ body, actorUserId }) },
        { new: true, runValidators: true, session },
      ).lean()

      if (!updatedManifest) {
        throw createManifestError({
          status: 404,
          code: 'NOT_FOUND',
          message: 'Knowledge Pack manifest was not found.',
          reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.MANIFEST_NOT_FOUND,
          details: { manifestId },
        })
      }

      await logManifestMutation({
        action: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_MANIFEST_UPDATED,
        manifest: updatedManifest,
        actorUserId,
        auditRequest,
        session,
        diff: {
          operation: 'UPDATE_MANIFEST',
          before: buildAuditDiffSummary(existingManifest),
          after: buildAuditDiffSummary(updatedManifest),
        },
      })
    })
    return serializeManifest(updatedManifest)
  } finally {
    await session.endSession()
  }
}

export const cloneKnowledgePackManifest = async ({
  manifestId,
  body = {},
  actorUserId,
  auditRequest,
} = {}) => {
  const sourceManifest = await getKnowledgePackManifest({ manifestId })
  const payload = buildManifestCreatePayload({
    body: {
      ...sourceManifest,
      ...body,
      mandatoryPacks: body.mandatoryPacks ?? sourceManifest.mandatoryPacks,
      optionalPacks: body.optionalPacks ?? sourceManifest.optionalPacks,
      validationPacks: body.validationPacks ?? sourceManifest.validationPacks,
      blockedPacks: body.blockedPacks ?? sourceManifest.blockedPacks,
      resolutionPolicy: body.resolutionPolicy ?? sourceManifest.resolutionPolicy,
      validationPolicy: body.validationPolicy ?? sourceManifest.validationPolicy,
      sourceMetadata: body.sourceMetadata ?? sourceManifest.sourceMetadata,
    },
    actorUserId,
    sourceMetadata: {
      clonedFromManifestId: sourceManifest.manifestId,
      clonedFromManifestKey: sourceManifest.manifestKey,
      clonedFromSemanticVersion: sourceManifest.semanticVersion,
    },
  })

  const existing = await KnowledgePackManifest.exists({
    $or: [
      { manifestId: payload.manifestId },
      {
        manifestKey: payload.manifestKey,
        semanticVersion: payload.semanticVersion,
        scopeKey: payload.scopeKey,
      },
    ],
  })

  if (existing) {
    throw createManifestError({
      status: 409,
      code: 'CONFLICT',
      message: 'Knowledge Pack manifest already exists for this key, version, and scope.',
      reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.MANIFEST_ALREADY_EXISTS,
      details: {
        manifestId: payload.manifestId,
        manifestKey: payload.manifestKey,
        semanticVersion: payload.semanticVersion,
        scopeKey: payload.scopeKey,
      },
    })
  }

  const session = await mongoose.startSession()
  try {
    let savedManifest
    await session.withTransaction(async () => {
      const manifest = new KnowledgePackManifest(payload)
      savedManifest = await manifest.save({ session })
      await logManifestMutation({
        action: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_MANIFEST_CLONED,
        manifest: savedManifest,
        actorUserId,
        auditRequest,
        session,
        diff: {
          operation: 'CLONE_MANIFEST',
          clonedFromManifestId: sourceManifest.manifestId,
        },
      })
    })
    return serializeManifest(savedManifest)
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw createManifestError({
        status: 409,
        code: 'CONFLICT',
        message: 'Knowledge Pack manifest already exists for this key, version, and scope.',
        reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.MANIFEST_ALREADY_EXISTS,
        details: {
          manifestId: payload.manifestId,
          manifestKey: payload.manifestKey,
          semanticVersion: payload.semanticVersion,
          scopeKey: payload.scopeKey,
        },
      })
    }
    throw err
  } finally {
    await session.endSession()
  }
}

const packComparisonRef = (pack = {}) => `${normalizeToken(pack.packType)}:${normalizeLowerKey(pack.packKey)}`

const comparePackSection = (sourcePacks = [], targetPacks = []) => {
  const sourceByRef = new Map(sourcePacks.map((pack) => [packComparisonRef(pack), pack]))
  const targetByRef = new Map(targetPacks.map((pack) => [packComparisonRef(pack), pack]))
  const refs = [...new Set([...sourceByRef.keys(), ...targetByRef.keys()].filter(Boolean))]

  const added = []
  const removed = []
  const changed = []
  const unchanged = []

  for (const refId of refs) {
    const source = sourceByRef.get(refId)
    const target = targetByRef.get(refId)
    if (!source && target) {
      added.push(target)
      continue
    }
    if (source && !target) {
      removed.push(source)
      continue
    }
    if (JSON.stringify(source) !== JSON.stringify(target)) {
      changed.push({
        refId,
        source,
        target,
      })
      continue
    }
    unchanged.push(source)
  }

  return {
    added,
    removed,
    changed,
    unchanged,
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: changed.length,
    unchangedCount: unchanged.length,
  }
}

export const compareKnowledgePackManifests = async ({
  manifestId,
  targetManifestId,
} = {}) => {
  const source = await getKnowledgePackManifest({ manifestId })
  const target = await getKnowledgePackManifest({ manifestId: targetManifestId })
  const sections = MANIFEST_PACK_SECTIONS.reduce((acc, section) => {
    acc[section] = comparePackSection(source[section], target[section])
    return acc
  }, {})
  const totalAdded = Object.values(sections).reduce((sum, section) => sum + section.addedCount, 0)
  const totalRemoved = Object.values(sections).reduce((sum, section) => sum + section.removedCount, 0)
  const totalChanged = Object.values(sections).reduce((sum, section) => sum + section.changedCount, 0)

  return {
    status: 'COMPARED',
    contentVisible: false,
    source: {
      manifestId: source.manifestId,
      manifestKey: source.manifestKey,
      manifestName: source.manifestName,
      semanticVersion: source.semanticVersion,
      status: source.status,
    },
    target: {
      manifestId: target.manifestId,
      manifestKey: target.manifestKey,
      manifestName: target.manifestName,
      semanticVersion: target.semanticVersion,
      status: target.status,
    },
    sections,
    summary: {
      semanticVersionChanged: source.semanticVersion !== target.semanticVersion,
      statusChanged: source.status !== target.status,
      totalAdded,
      totalRemoved,
      totalChanged,
    },
  }
}

const normalizeContextCategories = (value) => {
  const values = Array.isArray(value) ? value : normalizeText(value).split(',')
  const categories = values
    .map(normalizeToken)
    .filter((category) => REASONING_CONTEXT_PURPOSE_CATEGORIES.includes(category))
  return [...new Set(categories)]
}

const sanitizeContextPack = (pack = {}) => ({
  packCategory: pack.packCategory || '',
  purposeCategory: pack.purposeCategory || '',
  packType: pack.packType || '',
  packKey: pack.packKey || '',
  manifestSection: pack.manifestSection || '',
  label: pack.label || '',
  executionMode: pack.executionMode || KNOWLEDGE_PACK_EXECUTION_MODES.PROVIDER_CONTEXT,
  boundary: pack.boundary || undefined,
  required: Boolean(pack.required),
  runtimeBindable: Boolean(pack.runtimeBindable),
  dependencyKeys: Array.isArray(pack.dependencyKeys) ? pack.dependencyKeys : [],
  activationId: pack.activationId || '',
  packId: pack.packId || '',
  versionId: pack.versionId || '',
  semanticVersion: pack.semanticVersion || '',
  schemaVersion: pack.schemaVersion || '',
  activationStatus: pack.activationStatus || '',
  scopeType: pack.scopeType || '',
  scopeKey: pack.scopeKey || '',
  visibility: pack.visibility || KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM,
  contentHash: pack.contentHash || '',
})

const assertContextPackScopeAllowed = ({
  pack,
  customerId = '',
  tenantId = '',
} = {}) => {
  const visibility = normalizeToken(pack.visibility || KNOWLEDGE_PACK_VISIBILITY_SCOPES.PLATFORM)
  const normalizedCustomerId = normalizeText(customerId)
  const normalizedTenantId = normalizeText(tenantId)

  if (visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.CUSTOMER
    && normalizeText(pack.customerId) !== normalizedCustomerId) {
    throw createManifestError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Requested Knowledge Pack context is not visible for this customer scope.',
      reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.REASONING_CONTEXT_PACK_SCOPE_FORBIDDEN,
      details: {
        purposeCategory: pack.purposeCategory,
        packType: pack.packType,
        packKey: pack.packKey,
        visibility,
      },
    })
  }

  if (visibility === KNOWLEDGE_PACK_VISIBILITY_SCOPES.TENANT
    && normalizeText(pack.tenantId) !== normalizedTenantId) {
    throw createManifestError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Requested Knowledge Pack context is not visible for this tenant scope.',
      reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.REASONING_CONTEXT_PACK_SCOPE_FORBIDDEN,
      details: {
        purposeCategory: pack.purposeCategory,
        packType: pack.packType,
        packKey: pack.packKey,
        visibility,
      },
    })
  }
}

const selectReasoningContextPacks = ({
  binding = {},
  contextCategories = [],
  customerId = '',
  tenantId = '',
} = {}) => {
  const activePacks = Array.isArray(binding.activePacks) ? binding.activePacks : []
  const requestedCategories = normalizeContextCategories(contextCategories)
  const contextCandidates = activePacks
    .filter((pack) => REASONING_CONTEXT_PURPOSE_CATEGORIES.includes(normalizeToken(pack.purposeCategory)))

  if (requestedCategories.length === 0) {
    return contextCandidates.map(sanitizeContextPack)
  }

  const selected = []
  for (const category of requestedCategories) {
    const matches = contextCandidates.filter(
      (pack) => normalizeToken(pack.purposeCategory) === category && pack.runtimeBindable,
    )
    if (matches.length === 0) {
      throw createManifestError({
        status: 409,
        code: 'CONFLICT',
        message: 'Requested Knowledge Pack context category is not runtime-bindable for this manifest.',
        reason: KNOWLEDGE_PACK_MANIFEST_ERROR_REASONS.REASONING_CONTEXT_PACK_MISSING,
        details: {
          purposeCategory: category,
        },
      })
    }

    matches.forEach((pack) => {
      assertContextPackScopeAllowed({ pack, customerId, tenantId })
      selected.push(pack)
    })
  }

  return selected.map(sanitizeContextPack)
}

const buildReasoningContextRequest = (query = {}) => ({
  outputKey: normalizeLowerKey(query.outputKey),
  contextCategories: normalizeContextCategories(query.contextCategories),
  frameworkKey: normalizeToken(query.frameworkKey),
  runtimeType: normalizeToken(query.runtimeType),
  packageKey: normalizeLowerKey(query.packageKey),
  packageVersion: normalizeText(query.packageVersion),
  environmentKey: normalizeToken(query.environmentKey),
  customerId: normalizeText(query.customerId),
  tenantId: normalizeText(query.tenantId),
})

export const previewKnowledgePackReasoningContext = async ({
  manifestId,
  query = {},
} = {}) => {
  const { manifest, binding } = await previewKnowledgePackManifestResolution({ manifestId, query })
  const request = buildReasoningContextRequest(query)
  const selectedContextPacks = selectReasoningContextPacks({
    binding,
    contextCategories: request.contextCategories,
    customerId: request.customerId,
    tenantId: request.tenantId,
  })
  const requestedRefs = new Set(
    selectedContextPacks.map((pack) => `${normalizeToken(pack.packType)}:${normalizeLowerKey(pack.packKey)}`),
  )
  const optionalPacks = (Array.isArray(binding.optionalPacks) ? binding.optionalPacks : [])
    .map(sanitizeContextPack)
  const omittedOptionalPacks = optionalPacks.filter((pack) =>
    !requestedRefs.has(`${normalizeToken(pack.packType)}:${normalizeLowerKey(pack.packKey)}`))

  return {
    status: 'PROJECTED',
    previewOnly: true,
    contentVisible: false,
    generatedOutput: false,
    providerExecution: false,
    manifest: {
      manifestId: manifest.manifestId,
      manifestKey: manifest.manifestKey,
      manifestName: manifest.manifestName,
      semanticVersion: manifest.semanticVersion,
      status: manifest.status,
    },
    request,
    context: {
      assemblyMode: 'PREVIEW_ONLY',
      basePacks: (Array.isArray(binding.requiredPacks) ? binding.requiredPacks : [])
        .map(sanitizeContextPack),
      validationPacks: (Array.isArray(binding.validationPacks) ? binding.validationPacks : [])
        .map(sanitizeContextPack),
      selectedContextPacks,
      omittedOptionalPacks,
      dependencyGraph: binding.dependencyGraph || { status: 'NOT_AVAILABLE', edges: [], edgeCount: 0 },
      resolution: {
        status: 'PROJECTED',
        basePackCount: Array.isArray(binding.requiredPacks) ? binding.requiredPacks.length : 0,
        validationPackCount: Array.isArray(binding.validationPacks) ? binding.validationPacks.length : 0,
        selectedContextPackCount: selectedContextPacks.length,
        omittedOptionalPackCount: omittedOptionalPacks.length,
        requestedContextCategories: request.contextCategories,
      },
    },
    safeguards: [
      'PREVIEW_ONLY_NO_PROVIDER_EXECUTION',
      'NO_GENERATED_OUTPUT',
      'NO_PACK_CONTENT_EXPOSED',
      'NO_RUNTIME_TRUTH_EXPOSED',
    ],
  }
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
