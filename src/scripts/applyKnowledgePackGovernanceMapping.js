import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

import { connectDb, disconnectDb } from '../config/db.js'
import {
  KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS,
  KNOWLEDGE_PACK_LAYERS,
} from '../constants/knowledgeRuntime.js'
import { OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES } from '../constants/outcomeKnowledgePacks.js'
import { WORKSPACE_TYPES } from '../constants/workspaceGovernance.js'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackManifest,
  KnowledgePackVersion,
} from '../models/index.js'
import auditService from '../services/auditService.js'
import governanceAuditService from '../services/governanceAudit/governanceAuditService.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, '../../..')

export const DEFAULT_GOVERNANCE_POLICY_PATH = path.resolve(
  scriptDir,
  'data/knowledgePackGovernanceDevPolicy.v1.json',
)
export const DEFAULT_GOVERNANCE_REPORT_DIR = path.resolve(
  workspaceRoot,
  'docs/generated/knowledge-pack-governance-mapping/dev-apply',
)

export const GOVERNANCE_APPLY_CONFIRM_FLAG = '--confirm-dev-kp004-governance'
export const GOVERNANCE_AUDIT_REPAIR_FLAG = '--repair-audit-evidence'
const POLICY_SCHEMA_VERSION = '1.0.0'
const SYSTEM_ACTOR_ID = '000000000000000000000001'
const GOVERNANCE_RESOURCE_ID = '000000000000000000000003'
const GOVERNANCE_FIELDS = Object.freeze([
  'knowledgeLayer',
  'capabilityKey',
  'workspaceCompatibility',
  'dependencyReferences',
])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()
const unique = (values) => [...new Set(values)]

const createScriptError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

const stableSortObject = (value) => {
  if (Array.isArray(value)) return value.map(stableSortObject)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (['__v', 'createdAt', 'updatedAt'].includes(key)) return result
      result[key] = stableSortObject(value[key])
      return result
    }, {})
}

export const sha256Json = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(stableSortObject(value)) ?? 'undefined')
  .digest('hex')
  .toUpperCase()

const sha256Text = (value) => crypto
  .createHash('sha256')
  .update(value)
  .digest('hex')
  .toUpperCase()

const normalizeTokenList = (values) => Array.isArray(values)
  ? unique(values.map(normalizeToken).filter(Boolean)).sort()
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

const normalizeDependencyReferences = (references) => Array.isArray(references)
  ? references.map(normalizeDependencyReference).sort((left, right) => (
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    ))
  : []

const normalizeGovernanceValue = (field, value) => {
  if (field === 'knowledgeLayer') return normalizeToken(value)
  if (field === 'capabilityKey') return normalizeLowerKey(value)
  if (field === 'workspaceCompatibility') return normalizeTokenList(value)
  if (field === 'dependencyReferences') return normalizeDependencyReferences(value)
  return value
}

const valuesEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const validateDependencyReference = (reference, validLayers) => {
  const normalized = normalizeDependencyReference(reference)
  const hasIdentity = Boolean(normalized.packType && normalized.packKey)
  const hasCapability = Boolean(normalized.capabilityKey)
  if (
    !validLayers.has(normalized.knowledgeLayer)
    || !Object.values(KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS).includes(normalized.requirement)
    || hasIdentity === hasCapability
  ) {
    throw createScriptError(
      'GOVERNANCE_POLICY_DEPENDENCY_INVALID',
      'Each dependency must name a valid layer and exactly one identity or capability selector.',
      { reference },
    )
  }
  return normalized
}

export const validateGovernancePolicy = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createScriptError('GOVERNANCE_POLICY_INVALID', 'Governance mapping policy must be an object.')
  }
  if (normalizeText(input.schemaVersion) !== POLICY_SCHEMA_VERSION) {
    throw createScriptError(
      'GOVERNANCE_POLICY_SCHEMA_UNSUPPORTED',
      `Governance mapping policy schema must be ${POLICY_SCHEMA_VERSION}.`,
    )
  }

  const validLayers = new Set(Object.values(KNOWLEDGE_PACK_LAYERS))
  const validWorkspaces = new Set(Object.values(WORKSPACE_TYPES))
  const workspaceCompatibility = normalizeTokenList(input.workspaceCompatibility)
  if (
    workspaceCompatibility.length === 0
    || workspaceCompatibility.some((value) => !validWorkspaces.has(value))
  ) {
    throw createScriptError(
      'GOVERNANCE_POLICY_WORKSPACE_INVALID',
      'Governance mapping policy requires at least one valid workspace.',
    )
  }

  const normalizeLayerMap = (value, code) => Object.entries(value || {}).reduce(
    (result, [key, layer]) => {
      const normalizedKey = code === 'PACK_TYPE' ? normalizeToken(key) : normalizeLowerKey(key)
      const normalizedLayer = normalizeToken(layer)
      if (!normalizedKey || !validLayers.has(normalizedLayer)) {
        throw createScriptError(
          'GOVERNANCE_POLICY_LAYER_INVALID',
          `Invalid ${code.toLowerCase()} layer mapping for ${key || '<missing>'}.`,
        )
      }
      result[normalizedKey] = normalizedLayer
      return result
    },
    {},
  )

  const packTypeLayerMap = normalizeLayerMap(input.packTypeLayerMap, 'PACK_TYPE')
  const packKeyLayerOverrides = normalizeLayerMap(input.packKeyLayerOverrides, 'PACK_KEY')
  const capabilityRequiredLayers = normalizeTokenList(input.capabilityRequiredLayers)
  if (capabilityRequiredLayers.some((layer) => !validLayers.has(layer))) {
    throw createScriptError(
      'GOVERNANCE_POLICY_CAPABILITY_LAYER_INVALID',
      'Governance mapping policy contains an invalid capability-required layer.',
    )
  }

  const capabilityKeyOverrides = Object.entries(input.capabilityKeyOverrides || {}).reduce(
    (result, [packKey, capabilityKey]) => {
      const normalizedPackKey = normalizeLowerKey(packKey)
      const normalizedCapabilityKey = normalizeLowerKey(capabilityKey)
      if (!normalizedPackKey || !normalizedCapabilityKey) {
        throw createScriptError(
          'GOVERNANCE_POLICY_CAPABILITY_INVALID',
          `Invalid capability override for ${packKey || '<missing>'}.`,
        )
      }
      result[normalizedPackKey] = normalizedCapabilityKey
      return result
    },
    {},
  )

  const dependencyReferencesByPackKey = Object.entries(
    input.dependencyReferencesByPackKey || {},
  ).reduce((result, [packKey, references]) => {
    const normalizedPackKey = normalizeLowerKey(packKey)
    if (!normalizedPackKey || !Array.isArray(references)) {
      throw createScriptError(
        'GOVERNANCE_POLICY_DEPENDENCY_MAP_INVALID',
        `Invalid dependency mapping for ${packKey || '<missing>'}.`,
      )
    }
    result[normalizedPackKey] = references.map((reference) => (
      validateDependencyReference(reference, validLayers)
    ))
    return result
  }, {})

  const allowedNodeEnvs = unique(
    (input.environmentGuard?.allowedNodeEnvs || [])
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean),
  )
  const allowedDatabaseNames = unique(
    (input.environmentGuard?.allowedDatabaseNames || []).map(normalizeText).filter(Boolean),
  )
  if (allowedNodeEnvs.length === 0 || allowedDatabaseNames.length === 0) {
    throw createScriptError(
      'GOVERNANCE_POLICY_ENVIRONMENT_GUARD_MISSING',
      'Governance mapping policy requires environment and database allowlists.',
    )
  }
  if (normalizeToken(input.historicalPolicy) !== 'PRESERVE') {
    throw createScriptError(
      'GOVERNANCE_POLICY_HISTORICAL_INVALID',
      'Historical Knowledge Pack evidence must be preserved.',
    )
  }
  if (normalizeToken(input.manifestPolicy) !== 'BLOCK_IF_PRESENT') {
    throw createScriptError(
      'GOVERNANCE_POLICY_MANIFEST_INVALID',
      'Persisted Knowledge Pack Manifests must block governance mapping apply.',
    )
  }

  return {
    schemaVersion: POLICY_SCHEMA_VERSION,
    policyVersion: normalizeText(input.policyVersion),
    environmentGuard: { allowedNodeEnvs, allowedDatabaseNames },
    workspaceCompatibility,
    packTypeLayerMap,
    packKeyLayerOverrides,
    capabilityRequiredLayers,
    capabilityKeyOverrides,
    dependencyReferencesByPackKey,
    historicalPolicy: 'PRESERVE',
    manifestPolicy: 'BLOCK_IF_PRESENT',
  }
}

export const loadGovernancePolicy = async (
  policyPath = DEFAULT_GOVERNANCE_POLICY_PATH,
) => validateGovernancePolicy(JSON.parse(await fs.readFile(policyPath, 'utf8')))

export const assertGovernanceWriteEnvironment = ({ databaseName, nodeEnv, policy } = {}) => {
  const normalizedNodeEnv = normalizeText(nodeEnv).toLowerCase()
  const normalizedDatabaseName = normalizeText(databaseName)
  if (
    normalizedNodeEnv === 'production'
    || !policy.environmentGuard.allowedNodeEnvs.includes(normalizedNodeEnv)
    || !policy.environmentGuard.allowedDatabaseNames.includes(normalizedDatabaseName)
  ) {
    throw createScriptError(
      'GOVERNANCE_MAPPING_ENVIRONMENT_BLOCKED',
      `Refusing Knowledge Pack governance mapping write in NODE_ENV=${normalizedNodeEnv || '<missing>'}, database=${normalizedDatabaseName || '<missing>'}.`,
      { databaseName: normalizedDatabaseName, nodeEnv: normalizedNodeEnv },
    )
  }
}

export const resolveGovernanceTarget = (row, policyInput) => {
  const policy = validateGovernancePolicy(policyInput)
  const packType = normalizeToken(row?.packType)
  const packKey = normalizeLowerKey(row?.packKey)
  const knowledgeLayer = policy.packKeyLayerOverrides[packKey]
    || policy.packTypeLayerMap[packType]
  if (!packType || !packKey || !knowledgeLayer) {
    throw createScriptError(
      'GOVERNANCE_MAPPING_IDENTITY_UNMAPPED',
      `No approved Knowledge Layer mapping exists for ${packType || '<missing>'}:${packKey || '<missing>'}.`,
      { packType, packKey },
    )
  }

  const capabilityKey = policy.capabilityKeyOverrides[packKey]
    || (policy.capabilityRequiredLayers.includes(knowledgeLayer) ? packKey : '')

  return {
    knowledgeLayer,
    ...(capabilityKey ? { capabilityKey } : {}),
    workspaceCompatibility: [...policy.workspaceCompatibility],
    dependencyReferences: normalizeDependencyReferences(
      policy.dependencyReferencesByPackKey[packKey] || [],
    ),
  }
}

const buildRecordChanges = ({ row, target, includeDependencies }) => {
  const fields = includeDependencies
    ? GOVERNANCE_FIELDS
    : GOVERNANCE_FIELDS.filter((field) => field !== 'dependencyReferences')
  return fields.flatMap((field) => {
    if (field === 'capabilityKey' && !Object.hasOwn(target, field)) return []
    const from = normalizeGovernanceValue(field, row?.[field])
    const to = normalizeGovernanceValue(field, target?.[field])
    return valuesEqual(from, to) ? [] : [{ field, from, to }]
  })
}

const groupBy = (rows, keyBuilder) => rows.reduce((result, row) => {
  const key = keyBuilder(row)
  if (!result.has(key)) result.set(key, [])
  result.get(key).push(row)
  return result
}, new Map())

export const buildGovernanceMappingPlan = ({
  activations = [],
  manifests = [],
  packs = [],
  policy: policyInput,
  versions = [],
} = {}) => {
  const policy = validateGovernancePolicy(policyInput)
  const blockers = []
  const updates = []
  const targetsByPackId = new Map()

  if (manifests.length > 0) {
    blockers.push({
      code: 'PERSISTED_MANIFESTS_PRESENT',
      count: manifests.length,
    })
  }

  const versionsById = groupBy(versions, (row) => normalizeText(row.versionId))
  const activeActivationsByPackId = groupBy(
    activations.filter((row) => (
      normalizeToken(row.status) === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE
    )),
    (row) => normalizeText(row.packId),
  )

  for (const pack of packs) {
    const packId = normalizeText(pack.packId)
    let target
    try {
      target = resolveGovernanceTarget(pack, policy)
      targetsByPackId.set(packId, target)
    } catch (error) {
      blockers.push({
        code: error.code || 'GOVERNANCE_MAPPING_IDENTITY_UNMAPPED',
        packId,
        packType: normalizeToken(pack.packType),
        packKey: normalizeLowerKey(pack.packKey),
      })
      continue
    }

    const latestVersionId = normalizeText(pack.latestVersionId)
    const latestVersions = versionsById.get(latestVersionId) || []
    const activeActivations = activeActivationsByPackId.get(packId) || []
    if (latestVersions.length !== 1) {
      blockers.push({
        code: 'LATEST_VERSION_CARDINALITY_INVALID',
        packId,
        latestVersionId,
        count: latestVersions.length,
      })
      continue
    }
    if (activeActivations.length !== 1) {
      blockers.push({
        code: 'ACTIVE_ACTIVATION_CARDINALITY_INVALID',
        packId,
        count: activeActivations.length,
      })
      continue
    }

    const records = [
      {
        collectionKey: 'KnowledgePack',
        idField: 'packId',
        recordKey: packId,
        row: pack,
        includeDependencies: false,
      },
      {
        collectionKey: 'KnowledgePackVersion',
        idField: 'versionId',
        recordKey: latestVersionId,
        row: latestVersions[0],
        includeDependencies: true,
      },
      {
        collectionKey: 'KnowledgePackActivation',
        idField: 'activationId',
        recordKey: normalizeText(activeActivations[0].activationId),
        row: activeActivations[0],
        includeDependencies: true,
      },
    ]

    records.forEach((record) => {
      const changes = buildRecordChanges({
        row: record.row,
        target,
        includeDependencies: record.includeDependencies,
      })
      if (changes.length > 0) {
        updates.push({
          collectionKey: record.collectionKey,
          idField: record.idField,
          recordKey: record.recordKey,
          packId,
          packType: normalizeToken(pack.packType),
          packKey: normalizeLowerKey(pack.packKey),
          changes,
        })
      }
    })
  }

  const projectedActive = activations
    .filter((activation) => (
      normalizeToken(activation.status) === OUTCOME_KNOWLEDGE_PACK_ACTIVATION_STATUSES.ACTIVE
    ))
    .map((activation) => ({
      ...activation,
      ...(targetsByPackId.get(normalizeText(activation.packId)) || {}),
    }))

  const capabilityGroups = groupBy(
    projectedActive.filter((activation) => normalizeLowerKey(activation.capabilityKey)),
    (activation) => [
      normalizeText(activation.scopeKey),
      normalizeToken(activation.knowledgeLayer),
      normalizeLowerKey(activation.capabilityKey),
    ].join(':'),
  )
  for (const [selector, matches] of capabilityGroups) {
    const packIds = unique(matches.map((match) => normalizeText(match.packId)).filter(Boolean))
    if (packIds.length > 1) {
      blockers.push({
        code: 'PROJECTED_CAPABILITY_COLLISION',
        selector,
        packIds,
      })
    }
  }

  for (const activation of projectedActive) {
    const references = normalizeDependencyReferences(activation.dependencyReferences)
    for (const reference of references) {
      if (reference.requirement !== KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.REQUIRED) continue
      const matches = projectedActive.filter((candidate) => {
        if (normalizeToken(candidate.knowledgeLayer) !== reference.knowledgeLayer) return false
        if (reference.packType && reference.packKey) {
          return normalizeToken(candidate.packType) === reference.packType
            && normalizeLowerKey(candidate.packKey) === reference.packKey
        }
        return normalizeLowerKey(candidate.capabilityKey) === reference.capabilityKey
      })
      if (matches.length !== 1) {
        blockers.push({
          code: matches.length === 0
            ? 'PROJECTED_REQUIRED_DEPENDENCY_MISSING'
            : 'PROJECTED_REQUIRED_DEPENDENCY_AMBIGUOUS',
          activationId: normalizeText(activation.activationId),
          packId: normalizeText(activation.packId),
          dependency: reference,
          count: matches.length,
        })
      }
    }
  }

  const sortedUpdates = updates.sort((left, right) => (
    `${left.collectionKey}:${left.recordKey}`.localeCompare(`${right.collectionKey}:${right.recordKey}`)
  ))
  return {
    ok: blockers.length === 0,
    policyVersion: policy.policyVersion,
    recordsScanned: packs.length + versions.length + activations.length,
    packsScanned: packs.length,
    currentVersionsMapped: packs.length,
    activeActivationsMapped: packs.length,
    recordsToUpdate: sortedUpdates.length,
    fieldValuesToUpdate: sortedUpdates.reduce(
      (sum, update) => sum + update.changes.length,
      0,
    ),
    blockers,
    updates: sortedUpdates,
  }
}

const resolveQueryRows = async ({ model, select = '', session = null }) => {
  let query = model.find({})
  if (select && typeof query.select === 'function') query = query.select(select)
  if (session && typeof query.session === 'function') query = query.session(session)
  return typeof query.lean === 'function' ? query.lean() : query
}

export const readGovernanceMappingState = async ({ dependencies = {}, session = null } = {}) => {
  const models = dependencies.models || {
    KnowledgePack,
    KnowledgePackVersion,
    KnowledgePackActivation,
    KnowledgePackManifest,
  }
  if (session) {
    const packs = await resolveQueryRows({ model: models.KnowledgePack, session })
    const versions = await resolveQueryRows({ model: models.KnowledgePackVersion, session })
    const activations = await resolveQueryRows({ model: models.KnowledgePackActivation, session })
    const manifests = await resolveQueryRows({ model: models.KnowledgePackManifest, session })
    return { packs, versions, activations, manifests }
  }

  const [packs, versions, activations, manifests] = await Promise.all([
    resolveQueryRows({ model: models.KnowledgePack }),
    resolveQueryRows({ model: models.KnowledgePackVersion }),
    resolveQueryRows({ model: models.KnowledgePackActivation }),
    resolveQueryRows({ model: models.KnowledgePackManifest }),
  ])
  return { packs, versions, activations, manifests }
}

const captureGovernanceFields = (row, includeDependencies) => {
  const fields = includeDependencies
    ? GOVERNANCE_FIELDS
    : GOVERNANCE_FIELDS.filter((field) => field !== 'dependencyReferences')
  return fields.reduce((result, field) => {
    result[field] = {
      present: Object.hasOwn(row, field),
      value: row[field] ?? null,
    }
    return result
  }, {})
}

const findStateRow = (state, update) => {
  const collectionRows = update.collectionKey === 'KnowledgePack'
    ? state.packs
    : update.collectionKey === 'KnowledgePackVersion'
      ? state.versions
      : state.activations
  return collectionRows.find((row) => normalizeText(row[update.idField]) === update.recordKey)
}

const projectGovernanceState = ({ state, plan }) => plan.updates.map((update) => {
  const row = findStateRow(state, update)
  const projected = {
    collectionKey: update.collectionKey,
    idField: update.idField,
    recordKey: update.recordKey,
    fields: captureGovernanceFields(row, update.collectionKey !== 'KnowledgePack'),
  }
  update.changes.forEach((change) => {
    projected.fields[change.field] = { present: true, value: change.to }
  })
  return projected
})

export const captureCurrentGovernanceState = ({ state, plan }) => plan.updates.map((update) => {
  const row = findStateRow(state, update)
  return {
    collectionKey: update.collectionKey,
    idField: update.idField,
    recordKey: update.recordKey,
    fields: captureGovernanceFields(row, update.collectionKey !== 'KnowledgePack'),
  }
})

export const buildGovernanceBackup = ({ databaseName, plan, policy, state, now = new Date() }) => {
  const currentState = captureCurrentGovernanceState({ state, plan })
  const expectedAppliedState = projectGovernanceState({ state, plan })
  return {
    schemaVersion: POLICY_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    databaseName: normalizeText(databaseName),
    policyVersion: policy.policyVersion,
    policySha256: sha256Json(policy),
    planSha256: sha256Json(plan),
    preStateDigest: sha256Json(currentState),
    expectedAppliedStateDigest: sha256Json(expectedAppliedState),
    plan,
    records: currentState,
  }
}

const buildTimestamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-')

const writeJsonArtifact = async ({ directory, filename, value }) => {
  await fs.mkdir(directory, { recursive: true })
  const artifactPath = path.resolve(directory, filename)
  const payload = `${JSON.stringify(value, null, 2)}\n`
  await fs.writeFile(artifactPath, payload, 'utf8')
  return { path: artifactPath, sha256: sha256Text(payload) }
}

export const writeGovernanceBackup = ({
  backup,
  now = new Date(),
  reportDir = DEFAULT_GOVERNANCE_REPORT_DIR,
} = {}) => writeJsonArtifact({
  directory: path.resolve(reportDir, 'backups'),
  filename: `knowledge-pack-governance-backup-${buildTimestamp(now)}.json`,
  value: backup,
})

const assertMutationResult = ({ result, operation }) => {
  const actual = Number(result?.modifiedCount ?? 0)
  if (actual !== 1) {
    throw createScriptError(
      'GOVERNANCE_MAPPING_WRITE_COUNT_MISMATCH',
      `${operation} expected one modified record, received ${actual}.`,
      { operation, actual },
    )
  }
}

const buildMappingAuditPayload = ({ backupArtifact, evidenceMode, plan, policy, result }) => ({
  actorUserId: SYSTEM_ACTOR_ID,
  actorType: 'SYSTEM',
  resourceType: auditService.RESOURCE_TYPES.KnowledgePack,
  resourceId: GOVERNANCE_RESOURCE_ID,
  frameworkKey: 'PLATFORM',
  summary: evidenceMode === 'CORRECTIVE_AUDIT_ONLY'
    ? 'Recorded corrected governance evidence for the converged KP-004 development mapping.'
    : `Applied governed Knowledge Pack classification to ${result.recordsUpdated} development record(s).`,
  display: {
    actorLabel: 'System',
    targetLabel: 'KP-004 development governance mapping',
  },
  snapshot: {
    operation: 'KNOWLEDGE_PACK_GOVERNANCE_MAPPING',
    evidenceMode,
    policyVersion: policy.policyVersion,
    policySha256: sha256Json(policy),
    planSha256: sha256Json(plan),
    backupFilename: path.basename(backupArtifact.path),
    backupSha256: backupArtifact.sha256,
    result,
  },
  diff: {
    operation: 'KNOWLEDGE_PACK_GOVERNANCE_MAPPING',
    evidenceMode,
    policyVersion: policy.policyVersion,
    policySha256: sha256Json(policy),
    planSha256: sha256Json(plan),
    backupFilename: path.basename(backupArtifact.path),
    backupSha256: backupArtifact.sha256,
    result,
  },
})

export const applyGovernanceMappingPlan = async ({
  backup,
  backupArtifact,
  dependencies = {},
  plan,
  policy: policyInput,
} = {}) => {
  const policy = validateGovernancePolicy(policyInput)
  if (!plan?.ok) {
    throw createScriptError(
      'GOVERNANCE_MAPPING_PLAN_BLOCKED',
      'Cannot apply a blocked Knowledge Pack governance mapping plan.',
    )
  }
  if (
    normalizeToken(backup?.policySha256) !== sha256Json(policy)
    || normalizeToken(backup?.planSha256) !== sha256Json(plan)
    || normalizeToken(backupArtifact?.sha256) !== sha256Text(`${JSON.stringify(backup, null, 2)}\n`)
  ) {
    throw createScriptError(
      'GOVERNANCE_MAPPING_BACKUP_INVALID',
      'Apply requires the exact policy, plan, and written backup artifact.',
    )
  }

  const models = dependencies.models || {
    KnowledgePack,
    KnowledgePackVersion,
    KnowledgePackActivation,
    KnowledgePackManifest,
  }
  const getDatabaseName = dependencies.getDatabaseName || (() => mongoose.connection.name)
  const startSession = dependencies.startSession || (() => mongoose.startSession())
  const governanceAudit = dependencies.governanceAuditService || governanceAuditService
  const nodeEnv = dependencies.nodeEnv ?? process.env.NODE_ENV
  assertGovernanceWriteEnvironment({
    databaseName: getDatabaseName(),
    nodeEnv,
    policy,
  })

  const session = await startSession()
  try {
    let result = null
    await session.withTransaction(async () => {
      const state = await readGovernanceMappingState({ dependencies: { models }, session })
      const transactionPlan = buildGovernanceMappingPlan({ ...state, policy })
      if (!transactionPlan.ok || sha256Json(transactionPlan) !== sha256Json(plan)) {
        throw createScriptError(
          'GOVERNANCE_MAPPING_PLAN_CHANGED',
          'Knowledge Pack governance state changed after preflight.',
          { blockers: transactionPlan.blockers },
        )
      }

      for (const update of transactionPlan.updates) {
        const model = models[update.collectionKey]
        const set = Object.fromEntries(update.changes.map((change) => [change.field, change.to]))
        const updateResult = await model.updateOne(
          { [update.idField]: update.recordKey },
          { $set: set },
          { runValidators: true, session },
        )
        assertMutationResult({
          result: updateResult,
          operation: `update ${update.collectionKey}:${update.recordKey}`,
        })
      }

      const stateAfter = await readGovernanceMappingState({ dependencies: { models }, session })
      const readbackState = captureCurrentGovernanceState({ state: stateAfter, plan })
      const readbackDigest = sha256Json(readbackState)
      if (readbackDigest !== backup.expectedAppliedStateDigest) {
        throw createScriptError(
          'GOVERNANCE_MAPPING_READBACK_MISMATCH',
          'Transactional governance mapping readback did not match the projected state.',
          { expected: backup.expectedAppliedStateDigest, actual: readbackDigest },
        )
      }
      const idempotencyPlan = buildGovernanceMappingPlan({ ...stateAfter, policy })
      if (!idempotencyPlan.ok || idempotencyPlan.recordsToUpdate !== 0) {
        throw createScriptError(
          'GOVERNANCE_MAPPING_NOT_IDEMPOTENT',
          'Governance mapping still proposes mutations after transactional readback.',
          { blockers: idempotencyPlan.blockers, recordsToUpdate: idempotencyPlan.recordsToUpdate },
        )
      }

      result = {
        recordsUpdated: transactionPlan.recordsToUpdate,
        fieldValuesUpdated: transactionPlan.fieldValuesToUpdate,
        readbackDigest,
        secondDryRunMutations: idempotencyPlan.recordsToUpdate,
      }
      await governanceAudit.logSystemEvent('KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED', buildMappingAuditPayload({
        backupArtifact,
        evidenceMode: 'APPLY',
        plan: transactionPlan,
        policy,
        result,
      }), { session, throwOnError: true })
    })
    return result
  } finally {
    await session.endSession()
  }
}

export const loadGovernanceBackupArtifact = async ({ backupPath, expectedSha256 } = {}) => {
  const resolvedPath = path.resolve(normalizeText(backupPath))
  const payload = await fs.readFile(resolvedPath, 'utf8')
  const actualSha256 = sha256Text(payload)
  if (!/^[A-F0-9]{64}$/.test(normalizeToken(expectedSha256)) || actualSha256 !== normalizeToken(expectedSha256)) {
    throw createScriptError(
      'GOVERNANCE_MAPPING_BACKUP_DIGEST_MISMATCH',
      'Audit repair requires the exact original governance backup digest.',
      { actualSha256, expectedSha256: normalizeToken(expectedSha256) },
    )
  }
  let backup
  try {
    backup = JSON.parse(payload)
  } catch {
    throw createScriptError(
      'GOVERNANCE_MAPPING_BACKUP_INVALID',
      'Governance mapping backup is not valid JSON.',
    )
  }
  return {
    backup,
    backupArtifact: { path: resolvedPath, sha256: actualSha256 },
  }
}

export const repairGovernanceMappingAuditEvidence = async ({
  backup,
  backupArtifact,
  dependencies = {},
  policy: policyInput,
} = {}) => {
  const policy = validateGovernancePolicy(policyInput)
  const getDatabaseName = dependencies.getDatabaseName || (() => mongoose.connection.name)
  const startSession = dependencies.startSession || (() => mongoose.startSession())
  const governanceAudit = dependencies.governanceAuditService || governanceAuditService
  const databaseName = getDatabaseName()
  assertGovernanceWriteEnvironment({
    databaseName,
    nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
    policy,
  })
  if (
    normalizeText(backup?.schemaVersion) !== POLICY_SCHEMA_VERSION
    || normalizeText(backup?.databaseName) !== normalizeText(databaseName)
    || normalizeToken(backup?.policySha256) !== sha256Json(policy)
    || normalizeToken(backup?.planSha256) !== sha256Json(backup?.plan)
    || normalizeToken(backupArtifact?.sha256) !== sha256Text(`${JSON.stringify(backup, null, 2)}\n`)
  ) {
    throw createScriptError(
      'GOVERNANCE_MAPPING_BACKUP_INVALID',
      'Audit repair requires the exact original policy, plan, database, and backup artifact.',
    )
  }

  const models = dependencies.models || {
    KnowledgePack,
    KnowledgePackVersion,
    KnowledgePackActivation,
    KnowledgePackManifest,
  }
  const session = await startSession()
  try {
    let result = null
    await session.withTransaction(async () => {
      const state = await readGovernanceMappingState({ dependencies: { models }, session })
      const convergencePlan = buildGovernanceMappingPlan({ ...state, policy })
      if (!convergencePlan.ok || convergencePlan.recordsToUpdate !== 0) {
        throw createScriptError(
          'GOVERNANCE_MAPPING_AUDIT_REPAIR_NOT_CONVERGED',
          'Audit repair is allowed only after the approved mapping is fully converged.',
          { blockers: convergencePlan.blockers, recordsToUpdate: convergencePlan.recordsToUpdate },
        )
      }
      const readbackDigest = sha256Json(captureCurrentGovernanceState({
        state,
        plan: backup.plan,
      }))
      if (readbackDigest !== normalizeToken(backup.expectedAppliedStateDigest)) {
        throw createScriptError(
          'GOVERNANCE_MAPPING_READBACK_MISMATCH',
          'Current governance state does not match the original projected mapping state.',
          { expected: backup.expectedAppliedStateDigest, actual: readbackDigest },
        )
      }

      result = {
        recordsMutated: 0,
        originalRecordsUpdated: Number(backup.plan?.recordsToUpdate || 0),
        originalFieldValuesUpdated: Number(backup.plan?.fieldValuesToUpdate || 0),
        readbackDigest,
        secondDryRunMutations: convergencePlan.recordsToUpdate,
      }
      await governanceAudit.logSystemEvent(
        'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED',
        buildMappingAuditPayload({
          backupArtifact,
          evidenceMode: 'CORRECTIVE_AUDIT_ONLY',
          plan: backup.plan,
          policy,
          result,
        }),
        { session, throwOnError: true },
      )
    })
    return result
  } finally {
    await session.endSession()
  }
}

export const parseGovernanceMappingArgs = (argv = process.argv.slice(2)) => {
  const policyShaIndex = argv.indexOf('--policy-sha256')
  const backupFileIndex = argv.indexOf('--backup-file')
  const backupShaIndex = argv.indexOf('--backup-sha256')
  return {
    apply: argv.includes('--apply'),
    repairAuditEvidence: argv.includes(GOVERNANCE_AUDIT_REPAIR_FLAG),
    confirm: argv.includes(GOVERNANCE_APPLY_CONFIRM_FLAG),
    help: argv.includes('--help') || argv.includes('-h'),
    json: argv.includes('--json'),
    policySha256: policyShaIndex >= 0 ? normalizeToken(argv[policyShaIndex + 1]) : '',
    backupPath: backupFileIndex >= 0 ? normalizeText(argv[backupFileIndex + 1]) : '',
    backupSha256: backupShaIndex >= 0 ? normalizeToken(argv[backupShaIndex + 1]) : '',
  }
}

const formatReport = (report) => [
  `KP-004 governance mapping ${report.mode} on database ${report.databaseName}.`,
  `Policy ${report.policyVersion} (${report.policySha256}).`,
  `Packs=${report.plan.packsScanned}; records=${report.plan.recordsScanned}; updates=${report.plan.recordsToUpdate}; field values=${report.plan.fieldValuesToUpdate}; blockers=${report.plan.blockers.length}.`,
  ...(report.backup ? [`Backup ${report.backup.path} (${report.backup.sha256}).`] : []),
].join('\n')

export const runGovernanceMapping = async ({
  args = parseGovernanceMappingArgs(),
  dependencies = {},
  logger = console.log,
  now = new Date(),
  policyPath = DEFAULT_GOVERNANCE_POLICY_PATH,
  reportDir = DEFAULT_GOVERNANCE_REPORT_DIR,
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const getDatabaseName = dependencies.getDatabaseName || (() => mongoose.connection.name)
  await connect()
  try {
    const policy = await loadGovernancePolicy(policyPath)
    const policySha256 = sha256Json(policy)
    const state = await readGovernanceMappingState({ dependencies })
    const plan = buildGovernanceMappingPlan({ ...state, policy })
    const databaseName = getDatabaseName()
    let backupArtifact = null
    let result = null

    if (args.apply && args.repairAuditEvidence) {
      throw createScriptError(
        'GOVERNANCE_MAPPING_MODE_CONFLICT',
        'Choose either mapping apply or corrective audit evidence, not both.',
      )
    }

    if (args.apply || args.repairAuditEvidence) {
      if (!args.confirm) {
        throw createScriptError(
          'GOVERNANCE_MAPPING_CONFIRMATION_REQUIRED',
          `Apply requires ${GOVERNANCE_APPLY_CONFIRM_FLAG}.`,
        )
      }
      if (!/^[A-F0-9]{64}$/.test(args.policySha256) || args.policySha256 !== policySha256) {
        throw createScriptError(
          'GOVERNANCE_MAPPING_POLICY_DIGEST_REQUIRED',
          'Apply requires the exact --policy-sha256 emitted by dry run.',
          { expected: policySha256, supplied: args.policySha256 },
        )
      }
      if (!plan.ok) {
        throw createScriptError(
          'GOVERNANCE_MAPPING_PLAN_BLOCKED',
          'Knowledge Pack governance mapping dry run contains blockers.',
          { blockers: plan.blockers },
        )
      }
      assertGovernanceWriteEnvironment({
        databaseName,
        nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
        policy,
      })
    }

    if (args.apply) {
      const backup = buildGovernanceBackup({ databaseName, plan, policy, state, now })
      backupArtifact = await writeGovernanceBackup({ backup, now, reportDir })
      result = await applyGovernanceMappingPlan({
        backup,
        backupArtifact,
        dependencies: {
          ...dependencies,
          getDatabaseName,
        },
        plan,
        policy,
      })
    } else if (args.repairAuditEvidence) {
      if (!plan.ok || plan.recordsToUpdate !== 0) {
        throw createScriptError(
          'GOVERNANCE_MAPPING_AUDIT_REPAIR_NOT_CONVERGED',
          'Corrective audit evidence requires a clean zero-mutation dry run.',
          { blockers: plan.blockers, recordsToUpdate: plan.recordsToUpdate },
        )
      }
      const loadedBackup = await loadGovernanceBackupArtifact({
        backupPath: args.backupPath,
        expectedSha256: args.backupSha256,
      })
      backupArtifact = loadedBackup.backupArtifact
      result = await repairGovernanceMappingAuditEvidence({
        ...loadedBackup,
        dependencies: {
          ...dependencies,
          getDatabaseName,
        },
        policy,
      })
    }

    const report = {
      ok: plan.ok,
      mode: args.apply ? 'apply' : args.repairAuditEvidence ? 'audit-repair' : 'dry-run',
      databaseName,
      policyVersion: policy.policyVersion,
      policySha256,
      plan,
      ...(result ? { result } : {}),
      ...(backupArtifact ? { backup: backupArtifact } : {}),
    }
    logger(args.json ? JSON.stringify(report, null, 2) : formatReport(report))
    return report
  } finally {
    await disconnect()
  }
}

const isDirectExecution = () => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  const args = parseGovernanceMappingArgs()
  if (args.help) {
    console.log(`
applyKnowledgePackGovernanceMapping.js

Usage:
  node src/scripts/applyKnowledgePackGovernanceMapping.js [--json]
  node src/scripts/applyKnowledgePackGovernanceMapping.js --apply ${GOVERNANCE_APPLY_CONFIRM_FLAG} --policy-sha256 <sha256> [--json]
  node src/scripts/applyKnowledgePackGovernanceMapping.js ${GOVERNANCE_AUDIT_REPAIR_FLAG} ${GOVERNANCE_APPLY_CONFIRM_FLAG} --policy-sha256 <sha256> --backup-file <path> --backup-sha256 <sha256> [--json]

Dry run is the default. Apply is restricted to the checked-in development policy and database allowlist.
`.trim())
    process.exit(0)
  }

  runGovernanceMapping({ args })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        code: error.code || 'GOVERNANCE_MAPPING_FAILED',
        message: error.message,
        details: error.details || {},
      }, null, 2))
      process.exit(1)
    })
}
