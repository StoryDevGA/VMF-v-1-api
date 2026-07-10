import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackManifest,
  KnowledgePackVersion,
} from '../models/index.js'
import { OUTCOME_STUDIO_REQUIRED_PACKS } from '../constants/runtimeOutcomeStudio.js'
import auditService from '../services/auditService.js'

const STARTER_SOURCE_STATUS = 'SOURCE_ONLY'
const STARTER_IMPORT_MODE = 'BUNDLED_STARTER_SOURCE'
const CONFIRM_FLAG = '--confirm-retire-starter-packs'
const SYSTEM_ACTOR_ID = '000000000000000000000001'
const RETIREMENT_AUDIT_RESOURCE_ID = '000000000000000000000002'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

export const parseArgs = (argv = process.argv.slice(2)) => {
  const args = new Set(argv)
  return {
    apply: args.has('--apply'),
    confirm: args.has(CONFIRM_FLAG),
    json: args.has('--json'),
  }
}

const retiredKeyFilters = OUTCOME_STUDIO_REQUIRED_PACKS.map((pack) => ({
  packType: normalizeToken(pack.packType),
  packKey: normalizeLowerKey(pack.packKey),
}))

const starterMetadataFilter = {
  $or: [
    { 'sourceMetadata.sourceStatus': STARTER_SOURCE_STATUS },
    { 'sourceMetadata.importMode': STARTER_IMPORT_MODE },
    { 'sourceMetadata.importedFrom': /starter/i },
  ],
}

export const retiredStarterPackFilter = {
  $and: [
    { $or: retiredKeyFilters },
    starterMetadataFilter,
  ],
}

export const retiredStarterVersionFilter = {
  $and: [
    { $or: retiredKeyFilters },
    starterMetadataFilter,
  ],
}

const buildManifestReferenceFilter = () => ({
  $or: ['mandatoryPacks', 'optionalPacks', 'validationPacks', 'blockedPacks'].flatMap((section) =>
    retiredKeyFilters.map((filter) => ({
      [section]: {
        $elemMatch: filter,
      },
    })),
  ),
})

const toPlainId = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  return String(value)
}

const createDefaultDependencies = () => ({
  connect: connectDb,
  disconnect: disconnectDb,
  models: {
    KnowledgePack,
    KnowledgePackActivation,
    KnowledgePackManifest,
    KnowledgePackVersion,
  },
  auditService,
  startSession: () => mongoose.startSession(),
})

const resolveDependencies = (dependencies = {}) => ({
  ...createDefaultDependencies(),
  ...dependencies,
  models: {
    ...createDefaultDependencies().models,
    ...(dependencies.models || {}),
  },
})

export const buildRetirementPlan = async ({ dependencies = {} } = {}) => {
  const {
    models: {
      KnowledgePack: KnowledgePackModel,
      KnowledgePackActivation: KnowledgePackActivationModel,
      KnowledgePackManifest: KnowledgePackManifestModel,
      KnowledgePackVersion: KnowledgePackVersionModel,
    },
  } = resolveDependencies(dependencies)
  const [packs, versions, manifestReferences] = await Promise.all([
    KnowledgePackModel.find(retiredStarterPackFilter).lean(),
    KnowledgePackVersionModel.find(retiredStarterVersionFilter).lean(),
    KnowledgePackManifestModel.find(buildManifestReferenceFilter())
      .select('manifestId manifestKey manifestName status mandatoryPacks optionalPacks validationPacks blockedPacks')
      .lean(),
  ])

  const packIds = new Set(packs.map((pack) => normalizeText(pack.packId)).filter(Boolean))
  const activationPackIds = new Set(packIds)
  for (const version of versions) {
    const packId = normalizeText(version.packId)
    if (packId) activationPackIds.add(packId)
  }

  const versionIds = new Set(versions.map((version) => normalizeText(version.versionId)).filter(Boolean))
  const activationFilter = {
    $or: [
      ...(activationPackIds.size > 0 ? [{ packId: { $in: [...activationPackIds] } }] : []),
      ...(versionIds.size > 0 ? [{ versionId: { $in: [...versionIds] } }] : []),
    ],
  }
  const activations = activationFilter.$or.length > 0
    ? await KnowledgePackActivationModel.find(activationFilter).lean()
    : []

  return {
    filters: {
      packIds: [...packIds],
      versionIds: [...versionIds],
      activationIds: activations.map((activation) => normalizeText(activation.activationId)).filter(Boolean),
    },
    summary: {
      retiredKeys: retiredKeyFilters.length,
      packs: packs.length,
      versions: versions.length,
      activations: activations.length,
      manifestReferences: manifestReferences.length,
    },
    packs: packs.map((pack) => ({
      packId: normalizeText(pack.packId),
      packType: normalizeToken(pack.packType),
      packKey: normalizeLowerKey(pack.packKey),
      label: normalizeText(pack.label),
      status: normalizeToken(pack.status),
      isSystem: pack.isSystem === true,
    })),
    versions: versions.map((version) => ({
      versionId: normalizeText(version.versionId),
      packId: normalizeText(version.packId),
      semanticVersion: normalizeText(version.semanticVersion),
      status: normalizeToken(version.status),
    })),
    activations: activations.map((activation) => ({
      activationId: normalizeText(activation.activationId),
      packId: normalizeText(activation.packId),
      versionId: normalizeText(activation.versionId),
      status: normalizeToken(activation.status),
      scopeKey: normalizeToken(activation.scopeKey),
    })),
    manifestReferences: manifestReferences.map((manifest) => ({
      id: toPlainId(manifest._id),
      manifestId: normalizeText(manifest.manifestId),
      manifestKey: normalizeText(manifest.manifestKey),
      manifestName: normalizeText(manifest.manifestName),
      status: normalizeToken(manifest.status),
    })),
  }
}

const buildRetirementAuditPayload = ({ plan, result } = {}) => ({
  actorUserId: SYSTEM_ACTOR_ID,
  actorType: 'SYSTEM',
  systemActor: 'knowledge-pack-starter-retirement-script',
  action: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_DELETED,
  resourceType: auditService.RESOURCE_TYPES.KnowledgePack,
  resourceId: RETIREMENT_AUDIT_RESOURCE_ID,
  isSystemEvent: true,
  systemEventType: 'OUTCOME_STARTER_KNOWLEDGE_PACKS_RETIRED',
  eventCategory: 'KNOWLEDGE_PACK',
  eventSeverity: 'HIGH',
  summary: `Retired ${result?.packsDeleted || 0} starter Knowledge Pack record(s).`,
  display: {
    actorLabel: 'System',
    targetLabel: 'Outcome starter Knowledge Packs',
  },
  diff: {
    operation: 'RETIRE_OUTCOME_STARTER_KNOWLEDGE_PACKS',
    retiredKeys: retiredKeyFilters,
    filters: plan.filters,
    matched: plan.summary,
    deletedCounts: {
      packs: result?.packsDeleted || 0,
      versions: result?.versionsDeleted || 0,
      activations: result?.activationsDeleted || 0,
    },
  },
})

export const applyRetirementPlan = async ({ plan, dependencies = {} } = {}) => {
  if (plan.filters.packIds.length === 0 && plan.filters.versionIds.length === 0) {
    return {
      packsDeleted: 0,
      versionsDeleted: 0,
      activationsDeleted: 0,
      auditPersisted: false,
    }
  }

  const {
    auditService: audit,
    models: {
      KnowledgePack: KnowledgePackModel,
      KnowledgePackActivation: KnowledgePackActivationModel,
      KnowledgePackVersion: KnowledgePackVersionModel,
    },
    startSession,
  } = resolveDependencies(dependencies)
  const session = await startSession()
  try {
    let result = null
    await session.withTransaction(async () => {
      const activationDelete = plan.filters.activationIds.length > 0
        ? await KnowledgePackActivationModel.deleteMany(
          { activationId: { $in: plan.filters.activationIds } },
          { session },
        )
        : { deletedCount: 0 }

      const versionDelete = plan.filters.versionIds.length > 0
        ? await KnowledgePackVersionModel.deleteMany(
          { versionId: { $in: plan.filters.versionIds } },
          { session },
        )
        : { deletedCount: 0 }

      const packDelete = plan.filters.packIds.length > 0
        ? await KnowledgePackModel.deleteMany(
          { packId: { $in: plan.filters.packIds } },
          { session },
        )
        : { deletedCount: 0 }

      result = {
        packsDeleted: Number(packDelete.deletedCount) || 0,
        versionsDeleted: Number(versionDelete.deletedCount) || 0,
        activationsDeleted: Number(activationDelete.deletedCount) || 0,
        auditPersisted: false,
      }

      await audit.log(buildRetirementAuditPayload({ plan, result }), {
        session,
        throwOnError: true,
      })
      result.auditPersisted = true
    })
    return result
  } finally {
    await session.endSession()
  }
}

const printTextReport = ({ args, plan, applyResult = null }) => {
  const mode = args.apply ? 'APPLY' : 'DRY RUN'
  console.log(`Outcome starter Knowledge Pack retirement - ${mode}`)
  console.log(`Retired key definitions: ${plan.summary.retiredKeys}`)
  console.log(`Packs matched: ${plan.summary.packs}`)
  console.log(`Versions matched: ${plan.summary.versions}`)
  console.log(`Activations matched: ${plan.summary.activations}`)
  console.log(`Manifest references retained: ${plan.summary.manifestReferences}`)

  if (plan.packs.length > 0) {
    console.log('Matched packs:')
    for (const pack of plan.packs) {
      console.log(`- ${pack.packId} (${pack.packType}:${pack.packKey}) ${pack.status}`)
    }
  }

  if (plan.manifestReferences.length > 0) {
    console.log('Manifest references were not removed. They now represent authored Knowledge Pack requirements:')
    for (const manifest of plan.manifestReferences) {
      console.log(`- ${manifest.manifestId || manifest.manifestKey || manifest.id} ${manifest.status}`)
    }
  }

  if (applyResult) {
    console.log('Deleted:')
    console.log(`- packs: ${applyResult.packsDeleted}`)
    console.log(`- versions: ${applyResult.versionsDeleted}`)
    console.log(`- activations: ${applyResult.activationsDeleted}`)
  } else {
    console.log(`Run with --apply ${CONFIRM_FLAG} to delete matched starter pack records.`)
  }
}

export const runRetireOutcomeStarterKnowledgePacks = async (
  argv = process.argv.slice(2),
  { dependencies = {} } = {},
) => {
  const args = parseArgs(argv)
  if (args.apply && !args.confirm) {
    throw new Error(`Refusing to apply without ${CONFIRM_FLAG}`)
  }

  const resolvedDependencies = resolveDependencies(dependencies)
  await resolvedDependencies.connect()
  try {
    const plan = await buildRetirementPlan({ dependencies: resolvedDependencies })
    const applyResult = args.apply
      ? await applyRetirementPlan({ plan, dependencies: resolvedDependencies })
      : null
    if (args.json) {
      console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', plan, applyResult }, null, 2))
    } else {
      printTextReport({ args, plan, applyResult })
    }
    return { plan, applyResult }
  } finally {
    await resolvedDependencies.disconnect()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRetireOutcomeStarterKnowledgePacks().catch((err) => {
    console.error(err.message)
    process.exitCode = 1
  })
}
