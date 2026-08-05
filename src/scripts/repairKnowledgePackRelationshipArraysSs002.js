import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

import { connectDb, disconnectDb } from '../config/db.js'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackManifest,
  KnowledgePackVersion,
} from '../models/index.js'
import auditService from '../services/auditService.js'
import governanceAuditService from '../services/governanceAudit/governanceAuditService.js'
import {
  DEFAULT_SS002_MAPPING_PATH,
  loadSs002Mapping,
} from './migrateKnowledgePackRelationshipsSs002.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, '../../..')

export const DEFAULT_SS002_ARRAY_REPAIR_REPORT_DIR = path.resolve(
  workspaceRoot,
  'docs/generated/knowledge-pack-relationship-migration/ss-002-missing-arrays',
)
export const SS002_ARRAY_REPAIR_CONFIRM_FLAG = '--confirm-development-ss002-missing-array-remediation'

const REPAIR_SCHEMA_VERSION = '1.0.0'
const SYSTEM_ACTOR_ID = '000000000000000000000001'
const GOVERNANCE_RESOURCE_ID = '000000000000000000000003'

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

const createScriptError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

const stableSortExact = (value) => {
  if (Array.isArray(value)) return value.map(stableSortExact)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableSortExact(value[key])
    return result
  }, {})
}

const jsonSafe = (value) => JSON.parse(JSON.stringify(value))

export const sha256ExactJson = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(stableSortExact(jsonSafe(value))) ?? 'undefined')
  .digest('hex')
  .toUpperCase()

const sha256Text = (value) => crypto
  .createHash('sha256')
  .update(value)
  .digest('hex')
  .toUpperCase()

const isRawAbsent = (row, field) => !Object.hasOwn(row, field)
const isLegacyEmptyString = (row, field) => (
  isRawAbsent(row, field)
  || (typeof row[field] === 'string' && row[field].trim() === '')
)

const classifyDependencyPair = (version, activation) => {
  const versionPresent = Object.hasOwn(version, 'dependencyReferences')
  const activationPresent = Object.hasOwn(activation, 'dependencyReferences')
  if (!versionPresent && !activationPresent) return 'MISSING_BOTH'
  if (
    versionPresent
    && activationPresent
    && Array.isArray(version.dependencyReferences)
    && version.dependencyReferences.length === 0
    && Array.isArray(activation.dependencyReferences)
    && activation.dependencyReferences.length === 0
  ) return 'EMPTY_ARRAY_BOTH'
  return 'BLOCKED_PAIR_STATE'
}

const describeStoredValue = (row) => {
  if (!Object.hasOwn(row, 'dependencyReferences')) return 'ABSENT'
  const value = row.dependencyReferences
  if (value === undefined) return 'PRESENT_UNDEFINED'
  if (value === null) return 'NULL'
  if (Array.isArray(value)) return `ARRAY_${value.length}`
  return typeof value === 'object' ? 'OBJECT' : (typeof value).toUpperCase()
}

const withoutDependencyReferences = (row) => {
  const copy = jsonSafe(row)
  delete copy.dependencyReferences
  return copy
}

const resolveRawCollections = (dependencies = {}) => dependencies.collections || {
  KnowledgePack: KnowledgePack.collection,
  KnowledgePackVersion: KnowledgePackVersion.collection,
  KnowledgePackActivation: KnowledgePackActivation.collection,
  KnowledgePackManifest: KnowledgePackManifest.collection,
}

const resolveModels = (dependencies = {}) => dependencies.models || {
  KnowledgePackVersion,
  KnowledgePackActivation,
}

const findRaw = async (collection, query, session) => {
  const options = session ? { session } : {}
  return collection.find(query, options).toArray()
}

export const readSs002ArrayRepairState = async ({ records, dependencies = {}, session = null }) => {
  if (dependencies.readState) return dependencies.readState({ records, session })
  const collections = resolveRawCollections(dependencies)
  const packIds = records.map((record) => record.packId)
  const options = session ? { session } : {}
  const [packs, versions, activations, manifestCount] = await Promise.all([
    findRaw(collections.KnowledgePack, { packId: { $in: packIds } }, session),
    findRaw(collections.KnowledgePackVersion, { packId: { $in: packIds } }, session),
    findRaw(collections.KnowledgePackActivation, { packId: { $in: packIds } }, session),
    collections.KnowledgePackManifest.countDocuments({}, options),
  ])
  return { packs, versions, activations, manifestCount }
}

const matchesLegacyIdentityState = ({ pack, version, activation }) => (
  isLegacyEmptyString(pack, 'knowledgeAssetId')
  && isLegacyEmptyString(version, 'knowledgeAssetId')
  && isLegacyEmptyString(activation, 'knowledgeAssetId')
  && isLegacyEmptyString(version, 'relationshipContractVersion')
  && isLegacyEmptyString(activation, 'relationshipContractVersion')
  && isLegacyEmptyString(version, 'relationshipChecksum')
  && isLegacyEmptyString(activation, 'relationshipChecksum')
)

const matchesExactLineage = ({ record, pack, version, activation }) => {
  const versionHash = normalizeText(version.contentHash)
  const activationHash = normalizeText(activation.contentHash)
  return (
    normalizeText(pack.packId) === record.packId
    && normalizeToken(pack.packType) === record.packType
    && normalizeLowerKey(pack.packKey) === record.packKey
    && normalizeToken(pack.status) === 'ACTIVE'
    && normalizeText(pack.latestVersionId) === record.versionId
    && normalizeText(version.versionId) === record.versionId
    && normalizeText(version.packId) === record.packId
    && normalizeToken(version.packType) === record.packType
    && normalizeLowerKey(version.packKey) === record.packKey
    && normalizeText(version.semanticVersion) === record.semanticVersion
    && normalizeToken(version.status) === 'ACTIVE'
    && normalizeToken(version.scopeType) === record.scopeKey
    && normalizeToken(version.scopeKey) === record.scopeKey
    && normalizeText(activation.activationId) === record.activationId
    && normalizeText(activation.versionId) === record.versionId
    && normalizeText(activation.packId) === record.packId
    && normalizeToken(activation.packType) === record.packType
    && normalizeLowerKey(activation.packKey) === record.packKey
    && normalizeText(activation.semanticVersion) === record.semanticVersion
    && normalizeToken(activation.status) === 'ACTIVE'
    && normalizeToken(activation.scopeType) === record.scopeKey
    && normalizeToken(activation.scopeKey) === record.scopeKey
    && Boolean(versionHash)
    && versionHash === activationHash
  )
}

const preservationDigest = (rows) => sha256ExactJson(rows.map((row) => ({
  pack: withoutDependencyReferences(row.pack),
  version: withoutDependencyReferences(row.version),
  activation: withoutDependencyReferences(row.activation),
})))

export const buildSs002ArrayRepairPlan = ({ records, state }) => {
  const eligibleRecords = records.filter((record) => (
    Array.isArray(record.legacyRelationships) && record.legacyRelationships.length === 0
  ))
  const blockers = []
  const updates = []
  const recordEvidence = []
  const preservationRows = []

  if (eligibleRecords.length !== 28) {
    blockers.push({
      code: 'SS002_ARRAY_REPAIR_MAPPING_SET_MISMATCH',
      expected: 28,
      observed: eligibleRecords.length,
    })
  }
  if (Number(state.manifestCount || 0) !== 0) {
    blockers.push({ code: 'SS002_ARRAY_REPAIR_MANIFESTS_PRESENT', observed: Number(state.manifestCount || 0) })
  }

  for (const record of eligibleRecords) {
    const packs = state.packs.filter((row) => normalizeText(row.packId) === record.packId)
    const versions = state.versions.filter((row) => normalizeText(row.packId) === record.packId)
    const activations = state.activations.filter((row) => normalizeText(row.packId) === record.packId)
    const matchingVersions = versions.filter((row) => normalizeText(row.versionId) === record.versionId)
    const matchingActivations = activations.filter((row) => normalizeText(row.activationId) === record.activationId)
    if (
      packs.length !== 1
      || versions.length !== 1
      || activations.length !== 1
      || matchingVersions.length !== 1
      || matchingActivations.length !== 1
    ) {
      blockers.push({
        code: 'SS002_ARRAY_REPAIR_RECORD_SET_MISMATCH',
        key: record.key,
        observed: {
          packs: packs.length,
          versionsForPack: versions.length,
          activationsForPack: activations.length,
          matchingVersions: matchingVersions.length,
          matchingActivations: matchingActivations.length,
        },
      })
      continue
    }

    const [pack] = packs
    const [version] = versions
    const [activation] = activations
    if (!matchesExactLineage({ record, pack, version, activation })) {
      blockers.push({ code: 'SS002_ARRAY_REPAIR_LINEAGE_MISMATCH', key: record.key })
      continue
    }
    if (!matchesLegacyIdentityState({ pack, version, activation })) {
      blockers.push({ code: 'SS002_ARRAY_REPAIR_PARTIAL_GOVERNANCE_STATE', key: record.key })
      continue
    }

    const pairState = classifyDependencyPair(version, activation)
    if (pairState === 'BLOCKED_PAIR_STATE') {
      blockers.push({
        code: 'SS002_ARRAY_REPAIR_UNEXPECTED_PAIR_STATE',
        key: record.key,
        versionState: describeStoredValue(version),
        activationState: describeStoredValue(activation),
      })
      continue
    }

    preservationRows.push({ pack, version, activation })
    recordEvidence.push({
      key: record.key,
      packId: record.packId,
      versionId: record.versionId,
      activationId: record.activationId,
      contentHash: normalizeText(version.contentHash),
      pairState,
    })
    if (pairState === 'MISSING_BOTH') {
      updates.push(
        {
          collectionKey: 'KnowledgePackVersion',
          filter: {
            versionId: record.versionId,
            packId: record.packId,
            packType: record.packType,
            packKey: record.packKey,
            dependencyReferences: { $exists: false },
          },
        },
        {
          collectionKey: 'KnowledgePackActivation',
          filter: {
            activationId: record.activationId,
            versionId: record.versionId,
            packId: record.packId,
            packType: record.packType,
            packKey: record.packKey,
            dependencyReferences: { $exists: false },
          },
        },
      )
    }
  }

  recordEvidence.sort((left, right) => left.key.localeCompare(right.key))
  updates.sort((left, right) => (
    `${left.collectionKey}:${JSON.stringify(left.filter)}`
      .localeCompare(`${right.collectionKey}:${JSON.stringify(right.filter)}`)
  ))
  preservationRows.sort((left, right) => normalizeText(left.pack.packId).localeCompare(normalizeText(right.pack.packId)))
  return {
    ok: blockers.length === 0,
    mappedCandidates: eligibleRecords.length,
    recordsScanned: recordEvidence.length * 3,
    missingBoth: recordEvidence.filter((row) => row.pairState === 'MISSING_BOTH').length,
    converged: recordEvidence.filter((row) => row.pairState === 'EMPTY_ARRAY_BOTH').length,
    recordsToUpdate: updates.length,
    preStateDigest: preservationDigest(preservationRows),
    blockers,
    updates,
    recordEvidence,
  }
}

const rawTargetsForBackup = ({ records, state }) => records
  .filter((record) => record.legacyRelationships.length === 0)
  .map((record) => ({
    key: record.key,
    pack: state.packs.find((row) => normalizeText(row.packId) === record.packId),
    version: state.versions.find((row) => normalizeText(row.versionId) === record.versionId),
    activation: state.activations.find((row) => normalizeText(row.activationId) === record.activationId),
  }))
  .sort((left, right) => left.key.localeCompare(right.key))

export const buildSs002ArrayRepairBackup = ({
  databaseName,
  expanded,
  plan,
  state,
  now = new Date(),
}) => {
  if (!plan?.ok) {
    throw createScriptError('SS002_ARRAY_REPAIR_PLAN_BLOCKED', 'Cannot back up a blocked repair plan.')
  }
  return {
    schemaVersion: REPAIR_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    databaseName,
    policyVersion: expanded.mapping.policyVersion,
    mappingSha256: expanded.rawSha256,
    planSha256: sha256ExactJson(plan),
    preStateDigest: plan.preStateDigest,
    plan,
    rawTargets: rawTargetsForBackup({ records: expanded.records, state }),
  }
}

const buildTimestamp = (date) => date.toISOString().replace(/[:.]/g, '-')

export const writeSs002ArrayRepairBackup = async ({ backup, reportDir, now }) => {
  const directory = path.resolve(reportDir, 'backups')
  await fs.mkdir(directory, { recursive: true })
  const artifactPath = path.resolve(directory, `ss002-array-repair-backup-${buildTimestamp(now)}.json`)
  const payload = `${JSON.stringify(backup, null, 2)}\n`
  await fs.writeFile(artifactPath, payload, 'utf8')
  return { path: artifactPath, sha256: sha256Text(payload) }
}

export const assertSs002ArrayRepairEnvironment = ({ databaseName, nodeEnv, mapping }) => {
  const allowedEnvs = mapping?.environmentGuard?.allowedNodeEnvs || []
  const allowedDatabases = mapping?.environmentGuard?.allowedDatabaseNames || []
  if (!allowedEnvs.includes(normalizeLowerKey(nodeEnv)) || !allowedDatabases.includes(normalizeLowerKey(databaseName))) {
    throw createScriptError(
      'SS002_ARRAY_REPAIR_ENVIRONMENT_BLOCKED',
      'SS-002 array repair is restricted to the explicit Development QA environment.',
      { databaseName, nodeEnv },
    )
  }
}

const assertMutationResult = ({ result, operation }) => {
  const matchedCount = Number(result?.matchedCount ?? 0)
  const modifiedCount = Number(result?.modifiedCount ?? 0)
  if (matchedCount !== 1 || modifiedCount !== 1) {
    throw createScriptError(
      'SS002_ARRAY_REPAIR_WRITE_COUNT_MISMATCH',
      `${operation} expected one matched and one modified document.`,
      { operation, matchedCount, modifiedCount },
    )
  }
}

const buildAuditPayload = ({ backupArtifact, expanded, plan, result }) => ({
  actorUserId: SYSTEM_ACTOR_ID,
  actorType: 'SYSTEM',
  resourceType: auditService.RESOURCE_TYPES.KnowledgePack,
  resourceId: GOVERNANCE_RESOURCE_ID,
  frameworkKey: 'SS-002',
  summary: `Restored explicit empty relationship arrays on ${result.pairsRepaired} governed QA pack pair(s).`,
  display: {
    actorLabel: 'System',
    targetLabel: 'SS-002 missing relationship array remediation',
  },
  snapshot: {
    operation: 'SS002_MISSING_RELATIONSHIP_ARRAY_REMEDIATION',
    policyVersion: expanded.mapping.policyVersion,
    mappingSha256: expanded.rawSha256,
    planSha256: sha256ExactJson(plan),
    backupFilename: path.basename(backupArtifact.path),
    backupSha256: backupArtifact.sha256,
    result,
  },
  diff: {
    operation: 'SS002_MISSING_RELATIONSHIP_ARRAY_REMEDIATION',
    changedField: 'dependencyReferences',
    from: 'ABSENT',
    to: [],
    result,
  },
})

export const applySs002ArrayRepairPlan = async ({
  backup,
  backupArtifact,
  expanded,
  plan,
  dependencies = {},
}) => {
  if (!plan?.ok) {
    throw createScriptError('SS002_ARRAY_REPAIR_PLAN_BLOCKED', 'Cannot apply a blocked repair plan.')
  }
  const planSha256 = sha256ExactJson(plan)
  const serializedBackup = `${JSON.stringify(backup, null, 2)}\n`
  if (
    normalizeToken(backup?.mappingSha256) !== normalizeToken(expanded.rawSha256)
    || normalizeToken(backup?.planSha256) !== planSha256
    || normalizeToken(backupArtifact?.sha256) !== sha256Text(serializedBackup)
  ) {
    throw createScriptError('SS002_ARRAY_REPAIR_BACKUP_INVALID', 'Apply requires the exact written backup artifact.')
  }

  const getDatabaseName = dependencies.getDatabaseName || (() => mongoose.connection.name)
  assertSs002ArrayRepairEnvironment({
    databaseName: getDatabaseName(),
    nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
    mapping: expanded.mapping,
  })
  const models = resolveModels(dependencies)
  const startSession = dependencies.startSession || (() => mongoose.startSession())
  const governanceAudit = dependencies.governanceAuditService || governanceAuditService
  const session = await startSession()
  try {
    let result = null
    await session.withTransaction(async () => {
      const transactionState = await readSs002ArrayRepairState({
        records: expanded.records,
        dependencies,
        session,
      })
      const transactionPlan = buildSs002ArrayRepairPlan({ records: expanded.records, state: transactionState })
      if (!transactionPlan.ok || sha256ExactJson(transactionPlan) !== planSha256) {
        throw createScriptError(
          'SS002_ARRAY_REPAIR_PLAN_CHANGED',
          'SS-002 repair state changed after the approved dry run.',
          { blockers: transactionPlan.blockers },
        )
      }

      for (const update of transactionPlan.updates) {
        const updateResult = await models[update.collectionKey].updateOne(
          update.filter,
          { $set: { dependencyReferences: [] } },
          { runValidators: true, session, timestamps: false },
        )
        assertMutationResult({
          result: updateResult,
          operation: `${update.collectionKey}:${JSON.stringify(update.filter)}`,
        })
      }

      const stateAfter = await readSs002ArrayRepairState({
        records: expanded.records,
        dependencies,
        session,
      })
      const readbackPlan = buildSs002ArrayRepairPlan({ records: expanded.records, state: stateAfter })
      if (
        !readbackPlan.ok
        || readbackPlan.recordsToUpdate !== 0
        || readbackPlan.converged !== 28
        || readbackPlan.preStateDigest !== plan.preStateDigest
      ) {
        throw createScriptError(
          'SS002_ARRAY_REPAIR_READBACK_MISMATCH',
          'Transactional readback did not converge with only dependencyReferences changed.',
          {
            blockers: readbackPlan.blockers,
            recordsToUpdate: readbackPlan.recordsToUpdate,
            converged: readbackPlan.converged,
            expectedPreStateDigest: plan.preStateDigest,
            actualPreStateDigest: readbackPlan.preStateDigest,
          },
        )
      }

      result = {
        pairsRepaired: transactionPlan.missingBoth,
        recordsUpdated: transactionPlan.recordsToUpdate,
        preservationDigest: readbackPlan.preStateDigest,
        secondDryRunMutations: readbackPlan.recordsToUpdate,
      }
      await governanceAudit.logSystemEvent(
        'KNOWLEDGE_PACK_GOVERNANCE_MAPPING_APPLIED',
        buildAuditPayload({ backupArtifact, expanded, plan: transactionPlan, result }),
        { session, throwOnError: true },
      )
    })
    return result
  } finally {
    await session.endSession()
  }
}

export const parseSs002ArrayRepairArgs = (argv = process.argv.slice(2)) => {
  const mappingIndex = argv.indexOf('--mapping-sha256')
  const planIndex = argv.indexOf('--plan-sha256')
  return {
    apply: argv.includes('--apply'),
    confirm: argv.includes(SS002_ARRAY_REPAIR_CONFIRM_FLAG),
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h'),
    mappingSha256: mappingIndex >= 0 ? normalizeToken(argv[mappingIndex + 1]) : '',
    planSha256: planIndex >= 0 ? normalizeToken(argv[planIndex + 1]) : '',
  }
}

export const runSs002ArrayRepair = async ({
  args = parseSs002ArrayRepairArgs(),
  dependencies = {},
  logger = console.log,
  mappingPath = DEFAULT_SS002_MAPPING_PATH,
  reportDir = DEFAULT_SS002_ARRAY_REPAIR_REPORT_DIR,
  now = new Date(),
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const getDatabaseName = dependencies.getDatabaseName || (() => mongoose.connection.name)
  const writeBackup = dependencies.writeBackup || writeSs002ArrayRepairBackup
  await connect({ autoIndex: false })
  try {
    const expanded = await loadSs002Mapping(mappingPath)
    const state = await readSs002ArrayRepairState({ records: expanded.records, dependencies })
    const plan = buildSs002ArrayRepairPlan({ records: expanded.records, state })
    const planSha256 = sha256ExactJson(plan)
    const databaseName = getDatabaseName()
    let backupArtifact = null
    let result = null
    if (args.apply) {
      if (!args.confirm) {
        throw createScriptError('SS002_ARRAY_REPAIR_CONFIRMATION_REQUIRED', `Apply requires ${SS002_ARRAY_REPAIR_CONFIRM_FLAG}.`)
      }
      if (normalizeToken(args.mappingSha256) !== normalizeToken(expanded.rawSha256) || args.planSha256 !== planSha256) {
        throw createScriptError('SS002_ARRAY_REPAIR_DIGEST_REQUIRED', 'Apply requires the exact mapping and plan digests emitted by dry run.', {
          expectedMappingSha256: expanded.rawSha256,
          expectedPlanSha256: planSha256,
        })
      }
      if (!plan.ok) {
        throw createScriptError('SS002_ARRAY_REPAIR_PLAN_BLOCKED', 'Repair dry run contains blockers.', { blockers: plan.blockers })
      }
      assertSs002ArrayRepairEnvironment({
        databaseName,
        nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
        mapping: expanded.mapping,
      })
      const backup = buildSs002ArrayRepairBackup({ databaseName, expanded, plan, state, now })
      backupArtifact = await writeBackup({ backup, reportDir, now })
      result = await applySs002ArrayRepairPlan({
        backup,
        backupArtifact,
        expanded,
        plan,
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
      ...(backupArtifact ? { backup: backupArtifact } : {}),
      ...(result ? { result } : {}),
    }
    logger(args.json ? JSON.stringify(report, null, 2) : [
      `SS-002 missing-array remediation ${report.mode} on ${databaseName}.`,
      `Mapping ${report.mappingSha256}; plan ${report.planSha256}.`,
      `Candidates=${plan.mappedCandidates}; missing=${plan.missingBoth}; converged=${plan.converged}; updates=${plan.recordsToUpdate}; blockers=${plan.blockers.length}.`,
    ].join('\n'))
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
  const args = parseSs002ArrayRepairArgs()
  if (args.help) {
    console.log(`
repairKnowledgePackRelationshipArraysSs002.js

Usage:
  npm run knowledge-packs:repair-ss002-missing-arrays -- --json
  npm run knowledge-packs:repair-ss002-missing-arrays -- --apply ${SS002_ARRAY_REPAIR_CONFIRM_FLAG} --mapping-sha256 <sha256> --plan-sha256 <sha256> --json

Dry run is the default. Apply is restricted to the exact Development QA mapping and database allowlist.
`.trim())
    process.exit(0)
  }
  runSs002ArrayRepair({ args })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        code: error.code || 'SS002_ARRAY_REPAIR_FAILED',
        message: error.message,
        details: error.details || {},
      }, null, 2))
      process.exit(1)
    })
}
