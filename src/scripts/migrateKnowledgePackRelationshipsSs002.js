import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

import { connectDb, disconnectDb } from '../config/db.js'
import {
  KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
} from '../constants/knowledgeRuntime.js'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackManifest,
  KnowledgePackVersion,
} from '../models/index.js'
import { buildKnowledgePackId } from '../models/KnowledgePack.js'
import {
  buildKnowledgePackActivationId,
} from '../models/KnowledgePackActivation.js'
import { buildKnowledgePackVersionId } from '../models/KnowledgePackVersion.js'
import {
  buildKnowledgePackRelationshipChecksum,
  normalizeKnowledgeAssetId,
  normalizeKnowledgePackRelationships,
} from '../services/knowledgePackRelationshipContract.js'
import auditService from '../services/auditService.js'
import governanceAuditService from '../services/governanceAudit/governanceAuditService.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, '../../..')

export const DEFAULT_SS002_MAPPING_PATH = path.resolve(
  scriptDir,
  'data/knowledgePackRelationshipSs002QaMapping.v1.json',
)
export const DEFAULT_SS002_REPORT_DIR = path.resolve(
  workspaceRoot,
  'docs/generated/knowledge-pack-relationship-migration/ss-002',
)
export const SS002_APPLY_CONFIRM_FLAG = '--confirm-development-ss002-relationship-migration'
export const SS002_RELATIONSHIP_MIGRATION_AUDIT_EVENT_KEY =
  'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED'

const POLICY_SCHEMA_VERSION = '1.0.0'
const SYSTEM_ACTOR_ID = '000000000000000000000001'
const SS002_RESOURCE_ID = '000000000000000000000004'

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

const createScriptError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

const stableSortObject = (value) => {
  if (Array.isArray(value)) return value.map(stableSortObject)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    if (!['__v', 'createdAt', 'updatedAt'].includes(key)) {
      result[key] = stableSortObject(value[key])
    }
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

const comparable = (value) => JSON.stringify(stableSortObject(value))
const valuesEqual = (left, right) => comparable(left) === comparable(right)

const normalizeLegacyReference = (reference = {}) => {
  const plain = typeof reference?.toObject === 'function'
    ? reference.toObject({ depopulate: true })
    : reference
  const keys = Object.keys(plain || {}).filter((key) => key !== '_id').sort()
  const exactPackKeys = ['knowledgeLayer', 'packKey', 'packType', 'requirement']
  const exactCapabilityKeys = ['capabilityKey', 'knowledgeLayer', 'requirement']
  const isExactPackShape = valuesEqual(keys, exactPackKeys)
  const isExactCapabilityShape = valuesEqual(keys, exactCapabilityKeys)
  if (!isExactPackShape && !isExactCapabilityShape) {
    throw createScriptError(
      'SS002_MIGRATION_UNEXPECTED_LEGACY_SHAPE',
      'Legacy relationship contains missing, mixed or unknown fields.',
      { keys },
    )
  }
  const normalized = {
    knowledgeLayer: normalizeToken(plain.knowledgeLayer),
    requirement: normalizeToken(plain.requirement),
    ...(isExactPackShape
      ? {
        packType: normalizeToken(plain.packType),
        packKey: normalizeLowerKey(plain.packKey),
      }
      : { capabilityKey: normalizeLowerKey(plain.capabilityKey) }),
  }
  if (
    !normalized.knowledgeLayer
    || normalized.requirement !== 'REQUIRED'
    || (isExactPackShape && (!normalized.packType || !normalized.packKey))
    || (isExactCapabilityShape && !normalized.capabilityKey)
  ) {
    throw createScriptError(
      'SS002_MIGRATION_UNEXPECTED_LEGACY_SHAPE',
      'Legacy relationship fields are not complete governed predecessor data.',
      { reference: plain },
    )
  }
  return normalized
}

const assertRelationshipReferenceArray = (references, snapshot) => {
  if (!Array.isArray(references)) {
    throw createScriptError(
      'SS002_MIGRATION_UNEXPECTED_LEGACY_SHAPE',
      'Stored dependencyReferences must be an array for every mapped snapshot.',
      {
        snapshot,
        observedType: references === null ? 'null' : typeof references,
      },
    )
  }
  return references
}

const normalizeLegacyReferences = (references, snapshot) => assertRelationshipReferenceArray(references, snapshot)
  .map(normalizeLegacyReference)
  .sort((left, right) => comparable(left).localeCompare(comparable(right)))

const normalizeCurrentCanonicalReferences = (references, snapshot) => normalizeKnowledgePackRelationships(
  assertRelationshipReferenceArray(references, snapshot).map((reference) => {
    const value = typeof reference?.toObject === 'function'
      ? reference.toObject({ depopulate: true })
      : reference
    const { _id, ...withoutId } = value || {}
    return withoutId
  }),
)

const requiredRuntimeStyle = (capabilityKey) => ({
  relationshipType: 'REQUIRED_AT_RUNTIME',
  targetKnowledgeLayer: 'STYLE',
  targetCapabilityKey: normalizeLowerKey(capabilityKey),
  requiredAt: 'RUNTIME',
  cardinality: 'ONE',
})

const requiresCompatibleSchema = () => ({
  relationshipType: 'REQUIRES_COMPATIBLE_PACK',
  targetPackType: 'OUTPUT_SCHEMA',
  requiredAt: 'RUNTIME',
  cardinality: 'ONE_OR_MORE',
})

const compatibleWithOutputType = (knowledgeAssetId) => ({
  relationshipType: 'COMPATIBLE_WITH',
  targetKnowledgeAssetId: knowledgeAssetId,
  requiredAt: 'NONE',
  cardinality: 'ZERO_OR_MORE',
})

const requiredRuntimeTruthPack = ({ packKey, semanticVersion }) => ({
  relationshipType: 'REQUIRED_AT_RUNTIME',
  targetPackType: 'TRUTH_CERTIFICATION',
  targetPackKey: normalizeLowerKey(packKey),
  requiredAt: 'RUNTIME',
  cardinality: 'ONE',
  versionConstraint: { exactVersion: semanticVersion },
})

const legacyExactPack = ({ knowledgeLayer, packType, packKey }) => ({
  knowledgeLayer,
  requirement: 'REQUIRED',
  packType,
  packKey: normalizeLowerKey(packKey),
})

const legacyCapability = ({ knowledgeLayer, capabilityKey }) => ({
  knowledgeLayer,
  requirement: 'REQUIRED',
  capabilityKey: normalizeLowerKey(capabilityKey),
})

export const validateSs002Mapping = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createScriptError('SS002_MAPPING_INVALID', 'SS-002 mapping fixture must be an object.')
  }
  if (normalizeText(input.schemaVersion) !== POLICY_SCHEMA_VERSION) {
    throw createScriptError('SS002_MAPPING_SCHEMA_UNSUPPORTED', `Mapping schema must be ${POLICY_SCHEMA_VERSION}.`)
  }
  if (normalizeToken(input.relationshipContractVersion) !== KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION) {
    throw createScriptError(
      'SS002_MAPPING_CONTRACT_UNSUPPORTED',
      `Mapping relationship contract must be ${KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION}.`,
    )
  }
  if (normalizeToken(input.authority) !== 'USER_AUTHORIZED_QA_FIXTURE') {
    throw createScriptError('SS002_MAPPING_AUTHORITY_INVALID', 'Only the explicit user-authorized QA fixture may be applied.')
  }
  const allowedNodeEnvs = [...new Set((input.environmentGuard?.allowedNodeEnvs || [])
    .map((value) => normalizeText(value).toLowerCase()).filter(Boolean))]
  const allowedDatabaseNames = [...new Set((input.environmentGuard?.allowedDatabaseNames || [])
    .map(normalizeText).filter(Boolean))]
  if (!allowedNodeEnvs.length || !allowedDatabaseNames.length) {
    throw createScriptError('SS002_MAPPING_ENVIRONMENT_GUARD_MISSING', 'Mapping fixture requires environment and database allowlists.')
  }
  if (!Array.isArray(input.outputTypes) || input.outputTypes.length !== 12) {
    throw createScriptError('SS002_MAPPING_OUTPUT_TYPES_INVALID', 'QA fixture must map the exact 12 legacy Output Type owners.')
  }
  if (!Array.isArray(input.truthCertification?.dependencies) || input.truthCertification.dependencies.length !== 7) {
    throw createScriptError('SS002_MAPPING_TRUTH_INVALID', 'QA fixture must map the exact seven Truth Certification dependencies.')
  }
  return {
    schemaVersion: POLICY_SCHEMA_VERSION,
    policyVersion: normalizeText(input.policyVersion),
    relationshipContractVersion: KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
    authority: 'USER_AUTHORIZED_QA_FIXTURE',
    environmentGuard: { allowedNodeEnvs, allowedDatabaseNames },
    expectedSemanticVersion: normalizeText(input.expectedSemanticVersion),
    expectedScopeKey: normalizeToken(input.expectedScopeKey),
    outputTypes: input.outputTypes.map((row) => ({
      packKey: normalizeLowerKey(row.packKey),
      knowledgeAssetId: normalizeKnowledgeAssetId(row.knowledgeAssetId, { required: true }),
      schemaPackKey: normalizeLowerKey(row.schemaPackKey),
      schemaKnowledgeAssetId: normalizeKnowledgeAssetId(row.schemaKnowledgeAssetId, { required: true }),
      styleCapabilityKey: normalizeLowerKey(row.styleCapabilityKey),
      stylePackKey: normalizeLowerKey(row.stylePackKey),
      styleKnowledgeAssetId: normalizeKnowledgeAssetId(row.styleKnowledgeAssetId, { required: true }),
    })),
    truthCertification: {
      packKey: normalizeLowerKey(input.truthCertification.packKey),
      knowledgeAssetId: normalizeKnowledgeAssetId(input.truthCertification.knowledgeAssetId, { required: true }),
      dependencies: input.truthCertification.dependencies.map((row) => ({
        packKey: normalizeLowerKey(row.packKey),
        knowledgeAssetId: normalizeKnowledgeAssetId(row.knowledgeAssetId, { required: true }),
      })),
    },
  }
}

const buildRecordIds = ({ packType, packKey, semanticVersion, scopeKey }) => {
  const packId = buildKnowledgePackId({ packType, packKey })
  const versionId = buildKnowledgePackVersionId({
    packType,
    packKey,
    semanticVersion,
    scopeKey,
  })
  return {
    packId,
    versionId,
    activationId: buildKnowledgePackActivationId({
      packType,
      packKey,
      versionId,
      scopeKey,
    }),
  }
}

export const expandSs002Mapping = (input) => {
  const mapping = validateSs002Mapping(input)
  const records = new Map()
  const addRecord = ({
    packType,
    packKey,
    knowledgeAssetId,
    legacyRelationships = [],
    relationships = [],
  }) => {
    const key = `${packType}:${packKey}`
    const normalizedRelationships = normalizeKnowledgePackRelationships(relationships)
    const normalizedLegacyRelationships = normalizeLegacyReferences(legacyRelationships)
    const candidate = {
      key,
      packType,
      packKey,
      knowledgeAssetId,
      semanticVersion: mapping.expectedSemanticVersion,
      scopeKey: mapping.expectedScopeKey,
      ...buildRecordIds({
        packType,
        packKey,
        semanticVersion: mapping.expectedSemanticVersion,
        scopeKey: mapping.expectedScopeKey,
      }),
      legacyRelationships: normalizedLegacyRelationships,
      legacyRelationshipChecksum: sha256Json(normalizedLegacyRelationships),
      relationships: normalizedRelationships,
      relationshipChecksum: buildKnowledgePackRelationshipChecksum(normalizedRelationships),
    }
    const existing = records.get(key)
    if (existing && !valuesEqual(existing, candidate)) {
      throw createScriptError('SS002_MAPPING_CONFLICT', `Mapping fixture conflicts for ${key}.`)
    }
    records.set(key, candidate)
  }

  mapping.outputTypes.forEach((row) => {
    addRecord({
      packType: 'OUTPUT_TYPE_DEFINITION',
      packKey: row.packKey,
      knowledgeAssetId: row.knowledgeAssetId,
      legacyRelationships: [
        legacyExactPack({
          knowledgeLayer: 'OUTPUT_SCHEMA',
          packType: 'OUTPUT_SCHEMA',
          packKey: row.schemaPackKey,
        }),
        legacyCapability({ knowledgeLayer: 'STYLE', capabilityKey: row.styleCapabilityKey }),
      ],
      relationships: [
        requiresCompatibleSchema(),
        requiredRuntimeStyle(row.styleCapabilityKey),
      ],
    })
    addRecord({
      packType: 'OUTPUT_SCHEMA',
      packKey: row.schemaPackKey,
      knowledgeAssetId: row.schemaKnowledgeAssetId,
      relationships: [compatibleWithOutputType(row.knowledgeAssetId)],
    })
    addRecord({
      packType: 'STYLE',
      packKey: row.stylePackKey,
      knowledgeAssetId: row.styleKnowledgeAssetId,
    })
  })

  const truth = mapping.truthCertification
  addRecord({
    packType: 'TRUTH_CERTIFICATION',
    packKey: truth.packKey,
    knowledgeAssetId: truth.knowledgeAssetId,
    legacyRelationships: truth.dependencies.map((dependency) => legacyExactPack({
      knowledgeLayer: 'VALIDATION',
      packType: 'TRUTH_CERTIFICATION',
      packKey: dependency.packKey,
    })),
    relationships: truth.dependencies.map((dependency) => requiredRuntimeTruthPack({
      packKey: dependency.packKey,
      semanticVersion: mapping.expectedSemanticVersion,
    })),
  })
  truth.dependencies.forEach((dependency) => addRecord({
    packType: 'TRUTH_CERTIFICATION',
    packKey: dependency.packKey,
    knowledgeAssetId: dependency.knowledgeAssetId,
  }))

  const expanded = [...records.values()].sort((left, right) => left.key.localeCompare(right.key))
  const uniqueAssetIds = new Set(expanded.map((record) => record.knowledgeAssetId))
  if (uniqueAssetIds.size !== expanded.length) {
    throw createScriptError('SS002_MAPPING_IDENTITY_DUPLICATE', 'Each mapped pack requires a distinct QA knowledge asset identity.')
  }
  return { mapping, records: expanded }
}

export const loadSs002Mapping = async (mappingPath = DEFAULT_SS002_MAPPING_PATH) => {
  const payload = await fs.readFile(path.resolve(mappingPath), 'utf8')
  let input
  try {
    input = JSON.parse(payload)
  } catch {
    throw createScriptError('SS002_MAPPING_INVALID_JSON', 'SS-002 mapping fixture is not valid JSON.')
  }
  return { ...expandSs002Mapping(input), rawSha256: sha256Text(payload) }
}

export const assertSs002WriteEnvironment = ({ databaseName, nodeEnv, mapping }) => {
  const normalizedEnv = normalizeText(nodeEnv).toLowerCase()
  const normalizedDatabase = normalizeText(databaseName)
  if (
    !mapping.environmentGuard.allowedNodeEnvs.includes(normalizedEnv)
    || !mapping.environmentGuard.allowedDatabaseNames.includes(normalizedDatabase)
  ) {
    throw createScriptError(
      'SS002_MIGRATION_ENVIRONMENT_BLOCKED',
      'SS-002 relationship migration is restricted to the explicit Development QA environment.',
      { databaseName: normalizedDatabase, nodeEnv: normalizedEnv },
    )
  }
}

export const readSs002MigrationState = async ({ records, dependencies = {}, session = null }) => {
  const models = dependencies.models || {
    KnowledgePack,
    KnowledgePackVersion,
    KnowledgePackActivation,
    KnowledgePackManifest,
  }
  const options = session ? { session } : {}
  const assetIds = records.map((row) => row.knowledgeAssetId)
  const [packs, versions, activations, manifestCount] = await Promise.all([
    models.KnowledgePack.find({
      $or: [
        { packId: { $in: records.map((row) => row.packId) } },
        { knowledgeAssetId: { $in: assetIds } },
      ],
    }, null, options).lean(),
    models.KnowledgePackVersion.find({ packId: { $in: records.map((row) => row.packId) } }, null, options).lean(),
    models.KnowledgePackActivation.find({ packId: { $in: records.map((row) => row.packId) } }, null, options).lean(),
    models.KnowledgePackManifest.countDocuments({}, options),
  ])
  return { packs, versions, activations, manifestCount }
}

const currentFields = ({ pack, version, activation }) => ({
  pack: { knowledgeAssetId: normalizeToken(pack?.knowledgeAssetId) },
  version: {
    knowledgeAssetId: normalizeToken(version?.knowledgeAssetId),
    relationshipContractVersion: normalizeToken(version?.relationshipContractVersion),
    relationshipChecksum: normalizeText(version?.relationshipChecksum).toLowerCase(),
    dependencyReferences: version?.dependencyReferences,
  },
  activation: {
    knowledgeAssetId: normalizeToken(activation?.knowledgeAssetId),
    relationshipContractVersion: normalizeToken(activation?.relationshipContractVersion),
    relationshipChecksum: normalizeText(activation?.relationshipChecksum).toLowerCase(),
    dependencyReferences: activation?.dependencyReferences,
  },
})

const desiredFields = (record) => ({
  pack: { knowledgeAssetId: record.knowledgeAssetId },
  version: {
    knowledgeAssetId: record.knowledgeAssetId,
    relationshipContractVersion: KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
    relationshipChecksum: record.relationshipChecksum,
    dependencyReferences: record.relationships,
  },
  activation: {
    knowledgeAssetId: record.knowledgeAssetId,
    relationshipContractVersion: KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
    relationshipChecksum: record.relationshipChecksum,
    dependencyReferences: record.relationships,
  },
})

const canonicalCurrentFields = (fields) => ({
  pack: fields.pack,
  version: {
    ...fields.version,
    dependencyReferences: normalizeCurrentCanonicalReferences(
      fields.version.dependencyReferences,
      'KnowledgePackVersion',
    ),
  },
  activation: {
    ...fields.activation,
    dependencyReferences: normalizeCurrentCanonicalReferences(
      fields.activation.dependencyReferences,
      'KnowledgePackActivation',
    ),
  },
})

const isLegacyState = ({ fields, record }) => (
  !fields.pack.knowledgeAssetId
  && !fields.version.knowledgeAssetId
  && !fields.activation.knowledgeAssetId
  && !fields.version.relationshipChecksum
  && !fields.activation.relationshipChecksum
  && valuesEqual(
    normalizeLegacyReferences(fields.version.dependencyReferences, 'KnowledgePackVersion'),
    record.legacyRelationships,
  )
  && valuesEqual(
    normalizeLegacyReferences(fields.activation.dependencyReferences, 'KnowledgePackActivation'),
    record.legacyRelationships,
  )
)

const buildContentHashDigest = (records) => sha256Json(records.map((row) => ({
  versionId: row.versionId,
  versionContentHash: row.versionContentHash,
  activationId: row.activationId,
  activationContentHash: row.activationContentHash,
})))

export const buildSs002MigrationPlan = ({ records, state }) => {
  const blockers = []
  const updates = []
  const recordEvidence = []
  if (Number(state.manifestCount || 0) !== 0) {
    blockers.push({ code: 'SS002_MIGRATION_MANIFESTS_PRESENT', observed: Number(state.manifestCount || 0) })
  }
  for (const record of records) {
    const matchingPacks = state.packs.filter((row) => row.packId === record.packId)
    const identityOwners = state.packs.filter((row) => (
      normalizeToken(row.knowledgeAssetId) === record.knowledgeAssetId && row.packId !== record.packId
    ))
    const packVersions = state.versions.filter((row) => row.packId === record.packId)
    const packActivations = state.activations.filter((row) => row.packId === record.packId)
    const matchingVersions = packVersions.filter((row) => row.versionId === record.versionId)
    const matchingActivations = packActivations.filter((row) => row.activationId === record.activationId)
    if (
      matchingPacks.length !== 1
      || matchingVersions.length !== 1
      || matchingActivations.length !== 1
      || packVersions.length !== 1
      || packActivations.length !== 1
    ) {
      blockers.push({
        code: 'SS002_MIGRATION_RECORD_SET_MISMATCH',
        key: record.key,
        observed: {
          packs: matchingPacks.length,
          versions: matchingVersions.length,
          activations: matchingActivations.length,
          versionsForPack: packVersions.length,
          activationsForPack: packActivations.length,
        },
      })
      continue
    }
    if (identityOwners.length) {
      blockers.push({
        code: 'SS002_MIGRATION_IDENTITY_COLLISION',
        key: record.key,
        identityOwnerPackIds: identityOwners.map((row) => row.packId),
      })
      continue
    }
    const [pack] = matchingPacks
    const [version] = matchingVersions
    const [activation] = matchingActivations
    const identityMatches = (
      normalizeToken(pack.packType) === record.packType
      && normalizeLowerKey(pack.packKey) === record.packKey
      && normalizeToken(pack.status) === 'ACTIVE'
      && normalizeText(pack.latestVersionId) === record.versionId
      && version.packId === record.packId
      && activation.packId === record.packId
      && normalizeToken(version.packType) === record.packType
      && normalizeToken(activation.packType) === record.packType
      && normalizeLowerKey(version.packKey) === record.packKey
      && normalizeLowerKey(activation.packKey) === record.packKey
      && normalizeText(version.semanticVersion) === record.semanticVersion
      && normalizeText(activation.semanticVersion) === record.semanticVersion
      && normalizeToken(version.status) === 'ACTIVE'
      && normalizeToken(activation.status) === 'ACTIVE'
      && normalizeToken(version.scopeType) === record.scopeKey
      && normalizeToken(activation.scopeType) === record.scopeKey
      && normalizeToken(version.scopeKey) === record.scopeKey
      && normalizeToken(activation.scopeKey) === record.scopeKey
      && activation.versionId === record.versionId
    )
    const contentHashMatches = (
      normalizeText(version.contentHash)
      && normalizeText(version.contentHash) === normalizeText(activation.contentHash)
    )
    if (!identityMatches || !contentHashMatches) {
      blockers.push({
        code: 'SS002_MIGRATION_LINEAGE_MISMATCH',
        key: record.key,
        identityMatches,
        contentHashMatches: Boolean(contentHashMatches),
      })
      continue
    }

    const fields = currentFields({ pack, version, activation })
    const desired = desiredFields(record)
    let relationshipShapeError = null
    try {
      assertRelationshipReferenceArray(fields.version.dependencyReferences, 'KnowledgePackVersion')
      assertRelationshipReferenceArray(fields.activation.dependencyReferences, 'KnowledgePackActivation')
    } catch (error) {
      relationshipShapeError = error
    }
    if (relationshipShapeError) {
      blockers.push({
        code: 'SS002_MIGRATION_UNEXPECTED_LEGACY_SHAPE',
        key: record.key,
        details: relationshipShapeError.details || {},
      })
      continue
    }
    let desiredMatch = false
    try {
      desiredMatch = valuesEqual(canonicalCurrentFields(fields), desired)
    } catch {
      desiredMatch = false
    }
    let legacyMatch = false
    let legacyShapeError = null
    if (!desiredMatch) {
      try {
        legacyMatch = isLegacyState({ fields, record })
      } catch (error) {
        legacyShapeError = error
      }
    }
    if (legacyShapeError) {
      blockers.push({
        code: 'SS002_MIGRATION_UNEXPECTED_LEGACY_SHAPE',
        key: record.key,
        details: legacyShapeError.details || {},
      })
      continue
    }
    if (!desiredMatch && !legacyMatch) {
      blockers.push({
        code: 'SS002_MIGRATION_PARTIAL_OR_UNEXPECTED_STATE',
        key: record.key,
        current: fields,
        desired,
      })
      continue
    }

    const evidence = {
      key: record.key,
      packId: record.packId,
      versionId: record.versionId,
      activationId: record.activationId,
      knowledgeAssetId: record.knowledgeAssetId,
      semanticVersion: record.semanticVersion,
      scopeKey: record.scopeKey,
      versionContentHash: normalizeText(version.contentHash),
      activationContentHash: normalizeText(activation.contentHash),
      legacyRelationships: record.legacyRelationships,
      legacyRelationshipChecksum: record.legacyRelationshipChecksum,
      desiredRelationships: record.relationships,
      relationshipChecksum: record.relationshipChecksum,
      state: desiredMatch ? 'CONVERGED' : 'LEGACY',
    }
    recordEvidence.push(evidence)
    if (!desiredMatch) {
      updates.push(
        { collectionKey: 'KnowledgePack', idField: 'packId', recordId: record.packId, set: desired.pack },
        { collectionKey: 'KnowledgePackVersion', idField: 'versionId', recordId: record.versionId, set: desired.version },
        { collectionKey: 'KnowledgePackActivation', idField: 'activationId', recordId: record.activationId, set: desired.activation },
      )
    }
  }
  recordEvidence.sort((left, right) => left.key.localeCompare(right.key))
  return {
    ok: blockers.length === 0,
    mappedPacks: records.length,
    recordsScanned: recordEvidence.length * 3,
    recordsToUpdate: updates.length,
    convergedPacks: recordEvidence.filter((row) => row.state === 'CONVERGED').length,
    legacyPacks: recordEvidence.filter((row) => row.state === 'LEGACY').length,
    contentHashDigest: buildContentHashDigest(recordEvidence),
    blockers,
    updates,
    recordEvidence,
  }
}

const assertMutationResult = ({ result, operation }) => {
  if (Number(result?.modifiedCount || 0) !== 1) {
    throw createScriptError('SS002_MIGRATION_WRITE_COUNT_MISMATCH', `${operation} expected one modified record.`)
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

export const buildSs002MigrationAuditPayload = ({
  mapping,
  mappingSha256,
  plan,
  planSha256,
  backupArtifact,
  result,
}) => ({
  actorUserId: SYSTEM_ACTOR_ID,
  actorType: 'SYSTEM',
  resourceType: auditService.RESOURCE_TYPES.KnowledgePack,
  resourceId: SS002_RESOURCE_ID,
  frameworkKey: 'PLATFORM',
  summary: `Applied SS-002 governed QA relationships to ${result.recordsUpdated} development record(s).`,
  display: { actorLabel: 'System', targetLabel: 'SS-002 QA relationship migration' },
  snapshot: {
    operation: 'KNOWLEDGE_PACK_RELATIONSHIP_SS002_MIGRATION',
    policyVersion: mapping.policyVersion,
    migrationVersion: mapping.policyVersion,
    authority: mapping.authority,
    relationshipContractVersion: mapping.relationshipContractVersion,
    mappingSha256,
    planSha256,
    backupFilename: path.basename(backupArtifact.path),
    backupSha256: backupArtifact.sha256,
    result,
  },
  diff: {
    operation: 'KNOWLEDGE_PACK_RELATIONSHIP_SS002_MIGRATION',
    mappingSha256,
    planSha256,
    legacyToCanonical: plan.recordEvidence.map((row) => ({
      key: row.key,
      packId: row.packId,
      versionId: row.versionId,
      activationId: row.activationId,
      knowledgeAssetId: row.knowledgeAssetId,
      legacyRelationships: row.legacyRelationships,
      beforeRelationshipChecksum: row.legacyRelationshipChecksum,
      desiredRelationships: row.desiredRelationships,
      afterRelationshipChecksum: row.relationshipChecksum,
    })),
  },
})

export const applySs002MigrationPlan = async ({
  expanded,
  mappingSha256,
  plan,
  planSha256,
  backupArtifact,
  dependencies = {},
}) => {
  if (!plan?.ok || sha256Json(plan) !== planSha256) {
    throw createScriptError('SS002_MIGRATION_PLAN_BLOCKED', 'Apply requires the exact unblocked dry-run plan.')
  }
  const models = dependencies.models || {
    KnowledgePack,
    KnowledgePackVersion,
    KnowledgePackActivation,
    KnowledgePackManifest,
  }
  const getDatabaseName = dependencies.getDatabaseName || (() => mongoose.connection.name)
  assertSs002WriteEnvironment({
    databaseName: getDatabaseName(),
    nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
    mapping: expanded.mapping,
  })
  const startSession = dependencies.startSession || (() => mongoose.startSession())
  const governanceAudit = dependencies.governanceAuditService || governanceAuditService
  const session = await startSession()
  try {
    let result = null
    await session.withTransaction(async () => {
      const transactionState = await readSs002MigrationState({
        records: expanded.records,
        dependencies: { models },
        session,
      })
      const transactionPlan = buildSs002MigrationPlan({ records: expanded.records, state: transactionState })
      if (!transactionPlan.ok || sha256Json(transactionPlan) !== planSha256) {
        throw createScriptError('SS002_MIGRATION_PLAN_CHANGED', 'Relationship migration state changed after dry run.', {
          blockers: transactionPlan.blockers,
        })
      }
      for (const update of transactionPlan.updates) {
        const updateResult = await models[update.collectionKey].updateOne(
          { [update.idField]: update.recordId },
          { $set: update.set },
          { runValidators: true, session },
        )
        assertMutationResult({
          result: updateResult,
          operation: `${update.collectionKey}:${update.recordId}`,
        })
      }
      const readbackState = await readSs002MigrationState({
        records: expanded.records,
        dependencies: { models },
        session,
      })
      const readbackPlan = buildSs002MigrationPlan({ records: expanded.records, state: readbackState })
      if (
        !readbackPlan.ok
        || readbackPlan.recordsToUpdate !== 0
        || readbackPlan.contentHashDigest !== transactionPlan.contentHashDigest
      ) {
        throw createScriptError('SS002_MIGRATION_READBACK_MISMATCH', 'Transactional readback did not converge without content changes.', {
          blockers: readbackPlan.blockers,
          recordsToUpdate: readbackPlan.recordsToUpdate,
          expectedContentHashDigest: transactionPlan.contentHashDigest,
          actualContentHashDigest: readbackPlan.contentHashDigest,
        })
      }
      result = {
        recordsUpdated: transactionPlan.recordsToUpdate,
        packsMigrated: transactionPlan.legacyPacks,
        contentHashDigest: readbackPlan.contentHashDigest,
        secondDryRunMutations: readbackPlan.recordsToUpdate,
      }
      await governanceAudit.logSystemEvent(
        SS002_RELATIONSHIP_MIGRATION_AUDIT_EVENT_KEY,
        buildSs002MigrationAuditPayload({
          mapping: expanded.mapping,
          mappingSha256,
          plan: transactionPlan,
          planSha256,
          backupArtifact,
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

export const parseSs002MigrationArgs = (argv = process.argv.slice(2)) => {
  const mappingShaIndex = argv.indexOf('--mapping-sha256')
  const planShaIndex = argv.indexOf('--plan-sha256')
  return {
    apply: argv.includes('--apply'),
    confirm: argv.includes(SS002_APPLY_CONFIRM_FLAG),
    help: argv.includes('--help') || argv.includes('-h'),
    json: argv.includes('--json'),
    mappingSha256: mappingShaIndex >= 0 ? normalizeToken(argv[mappingShaIndex + 1]) : '',
    planSha256: planShaIndex >= 0 ? normalizeToken(argv[planShaIndex + 1]) : '',
  }
}

const formatReport = (report) => [
  `SS-002 relationship migration ${report.mode} on database ${report.databaseName}.`,
  `Mapping ${report.policyVersion} (${report.mappingSha256}); plan ${report.planSha256}.`,
  `Packs=${report.plan.mappedPacks}; legacy=${report.plan.legacyPacks}; converged=${report.plan.convergedPacks}; record updates=${report.plan.recordsToUpdate}; blockers=${report.plan.blockers.length}.`,
  ...(report.backup ? [`Backup ${report.backup.path} (${report.backup.sha256}).`] : []),
].join('\n')

export const runSs002Migration = async ({
  args = parseSs002MigrationArgs(),
  dependencies = {},
  logger = console.log,
  mappingPath = DEFAULT_SS002_MAPPING_PATH,
  reportDir = DEFAULT_SS002_REPORT_DIR,
  now = new Date(),
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const getDatabaseName = dependencies.getDatabaseName || (() => mongoose.connection.name)
  await connect({ autoIndex: false })
  try {
    const expanded = await loadSs002Mapping(mappingPath)
    const state = await readSs002MigrationState({ records: expanded.records, dependencies })
    const plan = buildSs002MigrationPlan({ records: expanded.records, state })
    const planSha256 = sha256Json(plan)
    const databaseName = getDatabaseName()
    let result = null
    let backupArtifact = null
    if (args.apply) {
      if (!args.confirm) {
        throw createScriptError('SS002_MIGRATION_CONFIRMATION_REQUIRED', `Apply requires ${SS002_APPLY_CONFIRM_FLAG}.`)
      }
      if (args.mappingSha256 !== expanded.rawSha256 || args.planSha256 !== planSha256) {
        throw createScriptError('SS002_MIGRATION_DIGEST_REQUIRED', 'Apply requires the exact mapping and plan digests emitted by dry run.', {
          expectedMappingSha256: expanded.rawSha256,
          expectedPlanSha256: planSha256,
        })
      }
      if (!plan.ok) {
        throw createScriptError('SS002_MIGRATION_PLAN_BLOCKED', 'Relationship migration dry run contains blockers.', {
          blockers: plan.blockers,
        })
      }
      assertSs002WriteEnvironment({
        databaseName,
        nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
        mapping: expanded.mapping,
      })
      const backup = {
        schemaVersion: POLICY_SCHEMA_VERSION,
        createdAt: now.toISOString(),
        databaseName,
        mappingSha256: expanded.rawSha256,
        planSha256,
        plan,
      }
      backupArtifact = await writeJsonArtifact({
        directory: path.resolve(reportDir, 'backups'),
        filename: `ss002-relationship-backup-${buildTimestamp(now)}.json`,
        value: backup,
      })
      result = await applySs002MigrationPlan({
        expanded,
        mappingSha256: expanded.rawSha256,
        plan,
        planSha256,
        backupArtifact,
        dependencies: { ...dependencies, getDatabaseName },
      })
    }
    const report = {
      ok: plan.ok,
      mode: args.apply ? 'apply' : 'dry-run',
      databaseName,
      policyVersion: expanded.mapping.policyVersion,
      mappingSha256: expanded.rawSha256,
      planSha256,
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
  const args = parseSs002MigrationArgs()
  if (args.help) {
    console.log(`
migrateKnowledgePackRelationshipsSs002.js

Usage:
  node src/scripts/migrateKnowledgePackRelationshipsSs002.js [--json]
  node src/scripts/migrateKnowledgePackRelationshipsSs002.js --apply ${SS002_APPLY_CONFIRM_FLAG} --mapping-sha256 <sha256> --plan-sha256 <sha256> [--json]

Dry run is the default. Apply is restricted to the checked-in QA fixture and Development database allowlist.
`.trim())
    process.exit(0)
  }
  runSs002Migration({ args })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        code: error.code || 'SS002_MIGRATION_FAILED',
        message: error.message,
        details: error.details || {},
      }, null, 2))
      process.exit(1)
    })
}
