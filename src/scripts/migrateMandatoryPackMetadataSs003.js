import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

import { connectDb, disconnectDb } from '../config/db.js'
import { KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION } from '../constants/knowledgeRuntime.js'
import {
  AuditLog,
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackManifest,
  KnowledgePackVersion,
} from '../models/index.js'
import auditService from '../services/auditService.js'
import governanceAuditService from '../services/governanceAudit/governanceAuditService.js'
import {
  buildKnowledgePackRelationshipChecksum,
  normalizeKnowledgeAssetId,
} from '../services/knowledgePackRelationshipContract.js'
import {
  buildSs002MigrationPlan,
  readSs002MigrationState,
  sha256Json,
} from './migrateKnowledgePackRelationshipsSs002.js'

export { sha256Json }

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, '../../..')

export const DEFAULT_SS003_MAPPING_PATH = path.resolve(
  scriptDir,
  'data/mandatoryPackMetadataSs003QaMapping.v1.json',
)
export const DEFAULT_SS003_REPORT_DIR = path.resolve(
  workspaceRoot,
  'docs/generated/knowledge-pack-metadata-migration/ss-003',
)
export const SS003_APPLY_CONFIRM_FLAG = '--confirm-development-ss003-metadata-migration'
export const SS003_AUDIT_EVENT_KEY = 'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED'
export const SS003_AUDIT_OPERATION = 'KNOWLEDGE_PACK_METADATA_SS003_MIGRATION'

const SCHEMA_VERSION = '1.0.0'
const POLICY_VERSION = 'SS-003-PARLON-METADATA-QA-V1'
const SYSTEM_ACTOR_ID = '000000000000000000000001'
const SS003_RESOURCE_ID = '000000000000000000000005'
const EMPTY_RELATIONSHIPS = Object.freeze([])
const EMPTY_RELATIONSHIP_CHECKSUM = buildKnowledgePackRelationshipChecksum(EMPTY_RELATIONSHIPS)

const EXPECTED_ROWS = Object.freeze([
  Object.freeze({
    packType: 'ARL',
    packKey: 'adaptive-reasoning-layer',
    packId: 'kp-arl-adaptive-reasoning-layer',
    versionId: 'kpv-arl-adaptive-reasoning-layer-1-0-0-global',
    activationId: 'kpa-arl-adaptive-reasoning-layer-kpv-arl-adaptive-reasoning-layer-1-0-0-global-global',
    knowledgeAssetId: 'QA-SS003-ARL-ADAPTIVE-REASONING-LAYER',
    expectedContentHash: 'sha256:45e7863824e8abaa4530cfee27f91613d14415be537d463037e9cfe181016953',
  }),
  Object.freeze({
    packType: 'OUTPUT_SCHEMA',
    packKey: 'output-schemas-pack',
    packId: 'kp-output-schema-output-schemas-pack',
    versionId: 'kpv-output-schema-output-schemas-pack-1-0-0-global',
    activationId: 'kpa-output-schema-output-schemas-pack-kpv-output-schema-output-schemas-pack-1-0-0-global-global',
    knowledgeAssetId: 'QA-SS003-OUTPUT-SCHEMA-OUTPUT-SCHEMAS-PACK',
    expectedContentHash: 'sha256:6d1c422889a47f682f1b164ab9fa46c330c44b9b027cf523c1792bd8422a75a5',
  }),
  Object.freeze({
    packType: 'OUTPUT_TYPE_DEFINITION',
    packKey: 'outcome-output-types',
    packId: 'kp-output-type-definition-outcome-output-types',
    versionId: 'kpv-output-type-definition-outcome-output-types-1-0-0-global',
    activationId: 'kpa-output-type-definition-outcome-output-types-kpv-output-type-definition-outcome-output-types-1-0-0-global-global',
    knowledgeAssetId: 'QA-SS003-OUTPUT-TYPE-DEFINITION-OUTCOME-OUTPUT-TYPES',
    expectedContentHash: 'sha256:5d33a6c6034c8219b3a68197789a86f588e109b93c6a895d5c9b666f935fe10b',
  }),
  Object.freeze({
    packType: 'RL',
    packKey: 'rendering-layer',
    packId: 'kp-rl-rendering-layer',
    versionId: 'kpv-rl-rendering-layer-1-0-0-global',
    activationId: 'kpa-rl-rendering-layer-kpv-rl-rendering-layer-1-0-0-global-global',
    knowledgeAssetId: 'QA-SS003-RL-RENDERING-LAYER',
    expectedContentHash: 'sha256:cb7f3f55c9ef1e5d4013dec1add125adb3ef876518a257c4f16a3848a8812ceb',
  }),
])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

const createScriptError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

const sha256Text = (value) => crypto.createHash('sha256').update(value).digest('hex').toUpperCase()
const valuesEqual = (left, right) => sha256Json(left) === sha256Json(right)

const normalizedExpectedRows = () => EXPECTED_ROWS.map((row) => ({ ...row }))

export const validateSs003Mapping = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createScriptError('SS003_MAPPING_INVALID', 'SS-003 metadata mapping must be an object.')
  }
  if (normalizeText(input.schemaVersion) !== SCHEMA_VERSION) {
    throw createScriptError('SS003_MAPPING_SCHEMA_UNSUPPORTED', `Mapping schema must be ${SCHEMA_VERSION}.`)
  }
  if (normalizeText(input.policyVersion) !== POLICY_VERSION) {
    throw createScriptError('SS003_MAPPING_POLICY_UNSUPPORTED', `Mapping policy must be ${POLICY_VERSION}.`)
  }
  if (normalizeToken(input.relationshipContractVersion) !== KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION) {
    throw createScriptError('SS003_MAPPING_CONTRACT_INVALID', 'The SS-002 relationship contract is required.')
  }
  if (normalizeText(input.relationshipChecksum).toLowerCase() !== EMPTY_RELATIONSHIP_CHECKSUM) {
    throw createScriptError('SS003_MAPPING_CHECKSUM_INVALID', 'The canonical empty-relationship checksum is required.')
  }
  const allowedNodeEnvs = [...new Set((input.environmentGuard?.allowedNodeEnvs || [])
    .map((value) => normalizeText(value).toLowerCase()).filter(Boolean))].sort()
  const allowedDatabaseNames = [...new Set((input.environmentGuard?.allowedDatabaseNames || [])
    .map(normalizeText).filter(Boolean))].sort()
  if (!valuesEqual(allowedNodeEnvs, ['development', 'test']) || !valuesEqual(allowedDatabaseNames, ['test'])) {
    throw createScriptError('SS003_MAPPING_ENVIRONMENT_INVALID', 'Mapping must be restricted to Development/Test database test.')
  }
  if (normalizeText(input.expectedSemanticVersion) !== '1.0.0' || normalizeToken(input.expectedScopeKey) !== 'GLOBAL') {
    throw createScriptError('SS003_MAPPING_LINEAGE_INVALID', 'Mapping must target version 1.0.0 at GLOBAL scope.')
  }
  if (normalizeText(input.authority) !== 'USER_AUTHORIZED_QA_FIXTURE_AND_SOURCE_BACKED_PACK_IDENTITY') {
    throw createScriptError('SS003_MAPPING_AUTHORITY_INVALID', 'Mapping authority is not the approved QA authority.')
  }

  const rows = Array.isArray(input.packs) ? input.packs.map((row) => ({
    packType: normalizeToken(row.packType),
    packKey: normalizeLowerKey(row.packKey),
    packId: normalizeText(row.packId),
    versionId: normalizeText(row.versionId),
    activationId: normalizeText(row.activationId),
    knowledgeAssetId: normalizeKnowledgeAssetId(row.knowledgeAssetId, { required: true }),
    expectedContentHash: normalizeText(row.expectedContentHash).toLowerCase(),
  })).sort((left, right) => left.packKey.localeCompare(right.packKey)) : []
  const expected = normalizedExpectedRows().sort((left, right) => left.packKey.localeCompare(right.packKey))
  if (!valuesEqual(rows, expected)) {
    throw createScriptError('SS003_MAPPING_ALLOWLIST_MISMATCH', 'Mapping must contain only the exact four approved pack identities.')
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    relationshipContractVersion: KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
    relationshipChecksum: EMPTY_RELATIONSHIP_CHECKSUM,
    authority: normalizeText(input.authority),
    environmentGuard: { allowedNodeEnvs, allowedDatabaseNames },
    expectedSemanticVersion: '1.0.0',
    expectedScopeKey: 'GLOBAL',
    packs: rows,
  }
}

export const loadSs003Mapping = async (mappingPath = DEFAULT_SS003_MAPPING_PATH) => {
  const raw = await fs.readFile(mappingPath, 'utf8')
  const mapping = validateSs003Mapping(JSON.parse(raw))
  const records = mapping.packs.map((row) => ({
    key: `${row.packType}:${row.packKey}`,
    ...row,
    semanticVersion: mapping.expectedSemanticVersion,
    scopeKey: mapping.expectedScopeKey,
    relationships: [],
    legacyRelationships: [],
    legacyRelationshipChecksum: '',
    relationshipChecksum: mapping.relationshipChecksum,
  }))
  return { mapping, records, rawSha256: sha256Text(raw) }
}

export const assertSs003WriteEnvironment = ({ databaseName, nodeEnv, mapping }) => {
  const normalizedDatabase = normalizeText(databaseName)
  const normalizedEnv = normalizeText(nodeEnv).toLowerCase()
  if (
    !mapping.environmentGuard.allowedNodeEnvs.includes(normalizedEnv)
    || !mapping.environmentGuard.allowedDatabaseNames.includes(normalizedDatabase)
  ) {
    throw createScriptError(
      'SS003_MIGRATION_ENVIRONMENT_BLOCKED',
      'SS-003 metadata migration is restricted to the explicit Development QA environment.',
      { databaseName: normalizedDatabase, nodeEnv: normalizedEnv },
    )
  }
}

const withExplicitEmptyLegacyArrays = (state) => ({
  ...state,
  versions: state.versions.map((row) => ({
    ...row,
    ...(row.dependencyReferences == null ? { dependencyReferences: [] } : {}),
  })),
  activations: state.activations.map((row) => ({
    ...row,
    ...(row.dependencyReferences == null ? { dependencyReferences: [] } : {}),
  })),
})

export const readSs003MigrationState = async (args) => withExplicitEmptyLegacyArrays(
  await readSs002MigrationState(args),
)

const translateBlocker = (blocker) => ({
  ...blocker,
  code: normalizeText(blocker.code).replace(/^SS002_MIGRATION_/, 'SS003_METADATA_'),
})

export const buildSs003MigrationPlan = ({ records, state }) => {
  const base = buildSs002MigrationPlan({ records, state: withExplicitEmptyLegacyArrays(state) })
  const blockers = base.blockers.map(translateBlocker)
  const expectedByKey = new Map(records.map((row) => [row.key, row.expectedContentHash]))
  for (const evidence of base.recordEvidence) {
    const expectedContentHash = expectedByKey.get(evidence.key)
    if (
      normalizeText(evidence.versionContentHash).toLowerCase() !== expectedContentHash
      || normalizeText(evidence.activationContentHash).toLowerCase() !== expectedContentHash
    ) {
      blockers.push({
        code: 'SS003_METADATA_SOURCE_HASH_MISMATCH',
        key: evidence.key,
        expectedContentHash,
        versionContentHash: evidence.versionContentHash,
        activationContentHash: evidence.activationContentHash,
      })
    }
  }
  return {
    ...base,
    ok: blockers.length === 0,
    operation: SS003_AUDIT_OPERATION,
    blockers,
  }
}

export const assertInitialSs003Plan = (plan) => {
  const exact = plan?.ok
    && plan.mappedPacks === 4
    && plan.legacyPacks === 4
    && plan.convergedPacks === 0
    && plan.recordsScanned === 12
    && plan.recordsToUpdate === 12
    && Array.isArray(plan.updates)
    && plan.updates.length === 12
  if (!exact) {
    throw createScriptError('SS003_INITIAL_PLAN_NOT_EXACT', 'Initial apply requires exactly four legacy packs and twelve record updates.', {
      mappedPacks: plan?.mappedPacks,
      legacyPacks: plan?.legacyPacks,
      convergedPacks: plan?.convergedPacks,
      recordsScanned: plan?.recordsScanned,
      recordsToUpdate: plan?.recordsToUpdate,
      blockers: plan?.blockers || [],
    })
  }
}

export const assertConvergedSs003Plan = (plan) => {
  const exact = plan?.ok
    && plan.mappedPacks === 4
    && plan.legacyPacks === 0
    && plan.convergedPacks === 4
    && plan.recordsScanned === 12
    && plan.recordsToUpdate === 0
  if (!exact) {
    throw createScriptError('SS003_READBACK_NOT_CONVERGED', 'Post-apply readback must be the exact zero-mutation four-pack state.')
  }
}

const projectBoundState = ({ records, state }) => records.map((record) => {
  const pack = state.packs.find((row) => row.packId === record.packId)
  const version = state.versions.find((row) => row.versionId === record.versionId)
  const activation = state.activations.find((row) => row.activationId === record.activationId)
  const fields = (row) => ({
    knowledgeAssetId: row?.knowledgeAssetId || null,
    relationshipContractVersion: row?.relationshipContractVersion || null,
    relationshipChecksum: row?.relationshipChecksum || null,
    dependencyReferences: row?.dependencyReferences ?? null,
    contentHash: row?.contentHash || null,
    status: row?.status || null,
    scopeType: row?.scopeType || null,
    scopeKey: row?.scopeKey || null,
  })
  return {
    key: record.key,
    pack: { packId: pack?.packId || null, ...fields(pack) },
    version: { versionId: version?.versionId || null, ...fields(version) },
    activation: { activationId: activation?.activationId || null, ...fields(activation) },
  }
})

export const buildSs003Backup = ({ databaseName, mappingSha256, plan, state, now = new Date() }) => ({
  schemaVersion: SCHEMA_VERSION,
  createdAt: now.toISOString(),
  databaseName,
  operation: SS003_AUDIT_OPERATION,
  mappingSha256,
  planSha256: sha256Json(plan),
  contentHashDigest: plan.contentHashDigest,
  records: projectBoundState({ records: plan.recordEvidence, state }),
})

const buildTimestamp = (date) => date.toISOString().replace(/[:.]/g, '-')

export const writeSs003Backup = async ({ backup, reportDir = DEFAULT_SS003_REPORT_DIR, now = new Date() }) => {
  const directory = path.resolve(reportDir, 'backups')
  await fs.mkdir(directory, { recursive: true })
  const artifactPath = path.resolve(directory, `ss003-metadata-backup-${buildTimestamp(now)}.json`)
  const payload = `${JSON.stringify(backup, null, 2)}\n`
  await fs.writeFile(artifactPath, payload, 'utf8')
  return { path: artifactPath, sha256: sha256Text(payload) }
}

const assertMutationResult = ({ result, operation }) => {
  if (Number(result?.matchedCount ?? 1) !== 1 || Number(result?.modifiedCount) !== 1) {
    throw createScriptError('SS003_MUTATION_CARDINALITY_INVALID', `Expected one modified record for ${operation}.`, { result })
  }
}

export const buildSs003AuditPayload = ({ mapping, mappingSha256, plan, planSha256, backupArtifact, result }) => ({
  actorUserId: SYSTEM_ACTOR_ID,
  actorType: 'SYSTEM',
  resourceType: auditService.RESOURCE_TYPES.KnowledgePack,
  resourceId: SS003_RESOURCE_ID,
  frameworkKey: 'PLATFORM',
  summary: `Applied SS-003 QA governance metadata to ${result.recordsUpdated} development record(s).`,
  display: { actorLabel: 'System', targetLabel: 'SS-003 QA mandatory-pack metadata migration' },
  snapshot: {
    operation: SS003_AUDIT_OPERATION,
    policyVersion: mapping.policyVersion,
    authority: mapping.authority,
    relationshipContractVersion: mapping.relationshipContractVersion,
    mappingSha256,
    planSha256,
    backupFilename: path.basename(backupArtifact.path),
    backupSha256: backupArtifact.sha256,
    result,
  },
  diff: {
    operation: SS003_AUDIT_OPERATION,
    mappingSha256,
    planSha256,
    changes: plan.recordEvidence.map((row) => ({
      key: row.key,
      packId: row.packId,
      versionId: row.versionId,
      activationId: row.activationId,
      knowledgeAssetId: row.knowledgeAssetId,
      relationshipChecksum: row.relationshipChecksum,
      dependencyReferences: row.desiredRelationships,
    })),
  },
})

export const applySs003MigrationPlan = async ({
  expanded,
  mappingSha256,
  plan,
  planSha256,
  backupArtifact,
  forceAuditFailure = false,
  dependencies = {},
}) => {
  if (!plan?.ok || sha256Json(plan) !== planSha256) {
    throw createScriptError('SS003_PLAN_DIGEST_INVALID', 'Apply requires the exact unblocked dry-run plan.')
  }
  assertInitialSs003Plan(plan)
  const models = dependencies.models || {
    KnowledgePack,
    KnowledgePackVersion,
    KnowledgePackActivation,
    KnowledgePackManifest,
  }
  const getDatabaseName = dependencies.getDatabaseName || (() => mongoose.connection.name)
  assertSs003WriteEnvironment({
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
      const transactionState = await readSs003MigrationState({
        records: expanded.records,
        dependencies: { models },
        session,
      })
      const transactionPlan = buildSs003MigrationPlan({ records: expanded.records, state: transactionState })
      if (!transactionPlan.ok || sha256Json(transactionPlan) !== planSha256) {
        throw createScriptError('SS003_PLAN_CHANGED', 'Metadata migration state changed after dry run.', {
          blockers: transactionPlan.blockers,
        })
      }
      assertInitialSs003Plan(transactionPlan)
      for (const update of transactionPlan.updates) {
        const updateResult = await models[update.collectionKey].updateOne(
          { [update.idField]: update.recordId },
          { $set: update.set },
          { runValidators: true, session },
        )
        assertMutationResult({ result: updateResult, operation: `${update.collectionKey}:${update.recordId}` })
      }
      const readbackState = await readSs003MigrationState({
        records: expanded.records,
        dependencies: { models },
        session,
      })
      const readbackPlan = buildSs003MigrationPlan({ records: expanded.records, state: readbackState })
      assertConvergedSs003Plan(readbackPlan)
      if (readbackPlan.contentHashDigest !== transactionPlan.contentHashDigest) {
        throw createScriptError('SS003_CONTENT_HASH_CHANGED', 'Metadata migration changed the protected content-hash digest.')
      }
      result = {
        recordsUpdated: transactionPlan.recordsToUpdate,
        packsMigrated: transactionPlan.legacyPacks,
        contentHashDigest: readbackPlan.contentHashDigest,
        secondDryRunMutations: readbackPlan.recordsToUpdate,
      }
      if (forceAuditFailure) {
        throw createScriptError('SS003_FORCED_AUDIT_FAILURE', 'Deliberate audit failure for real transaction rollback proof.')
      }
      await governanceAudit.logSystemEvent(
        SS003_AUDIT_EVENT_KEY,
        buildSs003AuditPayload({
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

const countSs003Audits = async () => AuditLog.countDocuments({
  action: SS003_AUDIT_EVENT_KEY,
  'snapshot.operation': SS003_AUDIT_OPERATION,
})

export const runSs003RollbackProbe = async ({
  expanded,
  mappingSha256,
  plan,
  planSha256,
  backupArtifact,
  dependencies = {},
}) => {
  const models = dependencies.models || {
    KnowledgePack,
    KnowledgePackVersion,
    KnowledgePackActivation,
    KnowledgePackManifest,
  }
  const readState = () => readSs003MigrationState({ records: expanded.records, dependencies: { models } })
  const countAudits = dependencies.countAudits || countSs003Audits
  const beforeState = await readState()
  const beforeDigest = sha256Json(projectBoundState({ records: expanded.records, state: beforeState }))
  const beforeAuditCount = await countAudits()
  let failureCode = ''
  try {
    await applySs003MigrationPlan({
      expanded,
      mappingSha256,
      plan,
      planSha256,
      backupArtifact,
      forceAuditFailure: true,
      dependencies,
    })
  } catch (error) {
    failureCode = error.code || ''
  }
  if (failureCode !== 'SS003_FORCED_AUDIT_FAILURE') {
    throw createScriptError('SS003_ROLLBACK_PROBE_FAILURE_MISSING', 'Rollback probe did not reach the deliberate audit failure.', { failureCode })
  }
  const afterState = await readState()
  const afterDigest = sha256Json(projectBoundState({ records: expanded.records, state: afterState }))
  const afterAuditCount = await countAudits()
  if (afterDigest !== beforeDigest || afterAuditCount !== beforeAuditCount) {
    throw createScriptError('SS003_ROLLBACK_PROBE_FAILED', 'Real transaction rollback did not restore the exact pre-probe state.', {
      beforeDigest,
      afterDigest,
      beforeAuditCount,
      afterAuditCount,
    })
  }
  return { pass: true, failureCode, beforeDigest, afterDigest, beforeAuditCount, afterAuditCount }
}

export const parseSs003Args = (argv = process.argv.slice(2)) => {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? normalizeToken(argv[index + 1]) : ''
  }
  return {
    apply: argv.includes('--apply'),
    rollbackProbe: argv.includes('--rollback-probe'),
    confirm: argv.includes(SS003_APPLY_CONFIRM_FLAG),
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h'),
    mappingSha256: valueAfter('--mapping-sha256'),
    planSha256: valueAfter('--plan-sha256'),
  }
}

export const runSs003Migration = async ({
  args = parseSs003Args(),
  dependencies = {},
  logger = console.log,
  mappingPath = DEFAULT_SS003_MAPPING_PATH,
  reportDir = DEFAULT_SS003_REPORT_DIR,
  now = new Date(),
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const getDatabaseName = dependencies.getDatabaseName || (() => mongoose.connection.name)
  await connect({ autoIndex: false })
  try {
    const expanded = await loadSs003Mapping(mappingPath)
    const state = await readSs003MigrationState({ records: expanded.records, dependencies })
    const plan = buildSs003MigrationPlan({ records: expanded.records, state })
    const planSha256 = sha256Json(plan)
    const databaseName = getDatabaseName()
    let backupArtifact = null
    let result = null
    const mutationMode = args.apply || args.rollbackProbe
    if (mutationMode) {
      if (args.apply && args.rollbackProbe) {
        throw createScriptError('SS003_MODE_CONFLICT', 'Choose either apply or rollback probe.')
      }
      if (!args.confirm) {
        throw createScriptError('SS003_CONFIRMATION_REQUIRED', `Mutation requires ${SS003_APPLY_CONFIRM_FLAG}.`)
      }
      if (args.mappingSha256 !== expanded.rawSha256 || args.planSha256 !== planSha256) {
        throw createScriptError('SS003_DIGEST_REQUIRED', 'Mutation requires the exact mapping and plan digests emitted by dry run.', {
          expectedMappingSha256: expanded.rawSha256,
          expectedPlanSha256: planSha256,
        })
      }
      assertSs003WriteEnvironment({ databaseName, nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV, mapping: expanded.mapping })
      assertInitialSs003Plan(plan)
      const backup = buildSs003Backup({ databaseName, mappingSha256: expanded.rawSha256, plan, state, now })
      backupArtifact = await writeSs003Backup({ backup, reportDir, now })
      result = args.rollbackProbe
        ? await runSs003RollbackProbe({ expanded, mappingSha256: expanded.rawSha256, plan, planSha256, backupArtifact, dependencies })
        : await applySs003MigrationPlan({ expanded, mappingSha256: expanded.rawSha256, plan, planSha256, backupArtifact, dependencies })
    }
    const report = {
      ok: plan.ok,
      mode: args.rollbackProbe ? 'ROLLBACK_PROBE' : args.apply ? 'APPLY' : 'DRY_RUN',
      capturedAt: now.toISOString(),
      databaseName,
      policyVersion: expanded.mapping.policyVersion,
      mappingSha256: expanded.rawSha256,
      planSha256,
      plan,
      ...(backupArtifact ? { backup: backupArtifact } : {}),
      ...(result ? { result } : {}),
    }
    logger(args.json ? JSON.stringify(report, null, 2) : JSON.stringify(report, null, 2))
    return report
  } finally {
    await disconnect()
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  runSs003Migration().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error.code || 'SS003_MIGRATION_FAILED',
      message: error.message,
      details: error.details || {},
    }, null, 2))
    process.exitCode = 1
  })
}
