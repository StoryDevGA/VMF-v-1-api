import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

import { connectDb, disconnectDb } from '../config/db.js'
import { KNOWLEDGE_PACK_BOUNDARIES } from '../constants/knowledgeRuntime.js'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackVersion,
} from '../models/index.js'
import governanceAuditService from '../services/governanceAudit/governanceAuditService.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, '../../..')
const policyPath = path.resolve(scriptDir, 'data/knowledgePackBoundaryPolicy.v1.json')
const policy = JSON.parse(await fs.readFile(policyPath, 'utf8'))

export const SS005_BOUNDARY_APPLY_CONFIRM_FLAG = '--confirm-ss005-boundary-policy'
export const DEFAULT_SS005_BOUNDARY_REPORT_DIR = path.resolve(
  workspaceRoot,
  'docs/generated/harness-runs/ss-005/2026-08-13-boundary-policy-apply',
)

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
  .update(JSON.stringify(stableSortObject(value)))
  .digest('hex')
  .toUpperCase()

const sha256Text = (value) => crypto
  .createHash('sha256')
  .update(value)
  .digest('hex')
  .toUpperCase()

const buildBoundaryLookup = (policyInput = policy) => {
  const entries = Object.entries(policyInput?.boundaries || {}).flatMap(([boundary, packKeys]) => (
    (Array.isArray(packKeys) ? packKeys : []).map((packKey) => [normalizeLowerKey(packKey), boundary])
  ))
  const duplicateKeys = unique(entries.map(([packKey]) => packKey))
  if (duplicateKeys.length !== entries.length) {
    throw createScriptError('SS005_BOUNDARY_POLICY_DUPLICATE_KEY', 'Boundary policy contains a duplicate pack key.')
  }
  return Object.fromEntries(entries)
}

export const validateSs005BoundaryPolicy = (policyInput = policy) => {
  const allowedBoundaries = new Set(Object.values(KNOWLEDGE_PACK_BOUNDARIES))
  const lookup = buildBoundaryLookup(policyInput)
  const requiredPackCount = Number(policyInput?.requiredPackCount || 0)
  const expectedMatches = policyInput?.expectedMatches || {}
  const boundariesValid = Object.keys(policyInput?.boundaries || {}).every((boundary) => allowedBoundaries.has(boundary))
  const blockers = []
  if (policyInput?.schemaVersion !== '1.0.0') blockers.push('POLICY_SCHEMA_VERSION_INVALID')
  if (policyInput?.status !== 'APPROVED_FOR_DEVELOPMENT_TEST_APPLY') blockers.push('POLICY_NOT_APPROVED')
  if (policyInput?.applyPosture !== 'DEVELOPMENT_TEST_ONLY_WITH_EXPLICIT_CONFIRMATION') {
    blockers.push('POLICY_APPLY_POSTURE_INVALID')
  }
  if (!boundariesValid) blockers.push('POLICY_BOUNDARY_INVALID')
  if (Object.keys(lookup).length !== requiredPackCount) blockers.push('POLICY_PACK_COUNT_INVALID')
  for (const collectionKey of ['KnowledgePack', 'KnowledgePackVersion', 'KnowledgePackActivation']) {
    if (!Number.isInteger(Number(expectedMatches[collectionKey]))) blockers.push(`EXPECTED_MATCH_COUNT_MISSING:${collectionKey}`)
  }
  if (blockers.length > 0) {
    throw createScriptError('SS005_BOUNDARY_POLICY_INVALID', 'SS-005 boundary policy is not authorized for apply.', { blockers })
  }
  return Object.freeze({ policy: policyInput, lookup })
}

const modelConfigs = Object.freeze([
  Object.freeze({
    collectionKey: 'KnowledgePack',
    model: KnowledgePack,
    idField: 'packId',
    filter: {},
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackVersion',
    model: KnowledgePackVersion,
    idField: 'versionId',
    filter: {},
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackActivation',
    model: KnowledgePackActivation,
    idField: 'activationId',
    filter: { status: 'ACTIVE' },
  }),
])

const selectFields = 'packId versionId activationId packKey boundary executionMode status semanticVersion'

export const readSs005BoundaryState = async ({
  dependencies = {},
  session = null,
  policy: policyInput = policy,
} = {}) => {
  const { lookup } = validateSs005BoundaryPolicy(policyInput)
  const configs = dependencies.modelConfigs || modelConfigs
  const rowsByCollection = {}
  for (const config of configs) {
    const query = config.model.find({
      ...config.filter,
      packKey: { $in: Object.keys(lookup) },
    }).select(selectFields)
    if (session) query.session(session)
    const rows = await query.lean()
    rowsByCollection[config.collectionKey] = (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        collectionKey: config.collectionKey,
        idField: config.idField,
        recordKey: normalizeText(row[config.idField]),
        packKey: normalizeLowerKey(row.packKey),
        boundary: normalizeToken(row.boundary),
        executionMode: normalizeToken(row.executionMode),
        status: normalizeToken(row.status),
        semanticVersion: normalizeText(row.semanticVersion),
      }))
      .sort((left, right) => `${left.packKey}:${left.recordKey}`.localeCompare(`${right.packKey}:${right.recordKey}`))
  }
  return rowsByCollection
}

const buildStateDigest = (state) => sha256Json(state)

export const buildSs005BoundaryPlan = ({
  state,
  policy: policyInput = policy,
} = {}) => {
  const { lookup } = validateSs005BoundaryPolicy(policyInput)
  const expectedMatches = policyInput.expectedMatches
  const updates = []
  const blockers = []
  const projectedState = {}
  for (const config of modelConfigs) {
    const rows = Array.isArray(state?.[config.collectionKey]) ? state[config.collectionKey] : []
    projectedState[config.collectionKey] = rows.map((row) => ({ ...row }))
    const expectedCount = Number(expectedMatches[config.collectionKey])
    if (rows.length !== expectedCount) {
      blockers.push(`${config.collectionKey}_TARGET_COUNT:${rows.length}:${expectedCount}`)
    }
    for (const row of rows) {
      const proposedBoundary = lookup[row.packKey]
      if (!proposedBoundary) {
        blockers.push(`${config.collectionKey}_PACK_KEY_NOT_IN_POLICY:${row.packKey}`)
        continue
      }
      if (row.boundary !== proposedBoundary) {
        updates.push({
          collectionKey: config.collectionKey,
          idField: config.idField,
          recordKey: row.recordKey,
          packKey: row.packKey,
          from: row.boundary || null,
          to: proposedBoundary,
          set: { boundary: proposedBoundary },
        })
        const projectedRow = projectedState[config.collectionKey]
          .find((candidate) => candidate.recordKey === row.recordKey)
        projectedRow.boundary = proposedBoundary
      }
    }
  }
  return {
    ok: blockers.length === 0,
    policyVersion: normalizeText(policyInput.policyVersion),
    recordsToUpdate: updates.length,
    updates,
    blockers: unique(blockers),
    preStateDigest: buildStateDigest(state),
    expectedAppliedStateDigest: buildStateDigest(projectedState),
  }
}

const getDatabaseName = (collection) => (
  collection?.db?.databaseName
  || collection?.db?.s?.databaseName
  || collection?.conn?.name
  || mongoose.connection.name
  || 'unknown'
)

export const assertSs005WriteEnvironment = ({
  databaseName,
  nodeEnv = process.env.NODE_ENV,
  policy: policyInput = policy,
} = {}) => {
  const allowedNodeEnvs = policyInput?.environmentGuard?.allowedNodeEnvs || []
  const allowedDatabaseNames = policyInput?.environmentGuard?.allowedDatabaseNames || []
  if (!allowedNodeEnvs.includes(nodeEnv) || !allowedDatabaseNames.includes(databaseName)) {
    throw createScriptError(
      'SS005_BOUNDARY_WRITE_ENVIRONMENT_BLOCKED',
      'SS-005 boundary apply is limited to the guarded development/test database.',
      { nodeEnv, databaseName, allowedNodeEnvs, allowedDatabaseNames },
    )
  }
}

const writeJsonArtifact = async ({ directory, filename, value }) => {
  await fs.mkdir(directory, { recursive: true })
  const artifactPath = path.resolve(directory, filename)
  const payload = `${JSON.stringify(value, null, 2)}\n`
  await fs.writeFile(artifactPath, payload, 'utf8')
  return { path: artifactPath, sha256: sha256Text(payload) }
}

export const writeSs005BoundaryBackup = ({
  backup,
  reportDir = DEFAULT_SS005_BOUNDARY_REPORT_DIR,
  now = new Date(),
} = {}) => writeJsonArtifact({
  directory: path.resolve(reportDir, 'backups'),
  filename: `ss005-boundary-backup-${now.toISOString().replace(/[:.]/g, '-')}.json`,
  value: backup,
})

const assertMutationResult = ({ result, operation }) => {
  if (Number(result?.modifiedCount ?? 0) !== 1) {
    throw createScriptError('SS005_BOUNDARY_WRITE_COUNT_MISMATCH', `${operation} did not modify exactly one record.`)
  }
}

const buildAuditPayload = ({ backupArtifact, plan, policy: policyInput, result }) => ({
  actorUserId: '000000000000000000000001',
  actorType: 'SYSTEM',
  resourceType: 'KnowledgePack',
  resourceId: '000000000000000000000003',
  frameworkKey: 'PLATFORM',
  summary: `Applied SS-005 boundary classification to ${result.recordsUpdated} Development/Test record(s).`,
  display: {
    actorLabel: 'System',
    targetLabel: 'SS-005 boundary classification',
  },
  snapshot: {
    operation: 'SS005_BOUNDARY_POLICY_APPLY',
    policyVersion: policyInput.policyVersion,
    policySha256: sha256Json(policyInput),
    planSha256: sha256Json(plan),
    backupFilename: path.basename(backupArtifact.path),
    backupSha256: backupArtifact.sha256,
    result,
  },
  diff: {
    operation: 'SS005_BOUNDARY_POLICY_APPLY',
    policyVersion: policyInput.policyVersion,
    policySha256: sha256Json(policyInput),
    planSha256: sha256Json(plan),
    result,
  },
})

export const applySs005BoundaryPlan = async ({
  backup,
  backupArtifact,
  plan,
  policy: policyInput = policy,
  dependencies = {},
} = {}) => {
  validateSs005BoundaryPolicy(policyInput)
  const databaseName = dependencies.databaseName || mongoose.connection.name
  const expectedPolicySha256 = sha256Json(policyInput)
  const expectedPlanSha256 = sha256Json(plan)
  if (backup?.schemaVersion !== '1.0.0') {
    throw createScriptError('SS005_BOUNDARY_BACKUP_SCHEMA_INVALID', 'Backup schema version does not match the active SS-005 apply contract.')
  }
  if (normalizeText(backup?.databaseName) !== normalizeText(databaseName)) {
    throw createScriptError('SS005_BOUNDARY_BACKUP_DATABASE_INVALID', 'Backup database does not match the guarded apply database.')
  }
  if (normalizeText(backup?.policyVersion) !== normalizeText(policyInput.policyVersion)) {
    throw createScriptError('SS005_BOUNDARY_BACKUP_POLICY_VERSION_INVALID', 'Backup policy version does not match the active SS-005 policy.')
  }
  if (normalizeToken(backup?.preStateDigest) !== normalizeToken(plan.preStateDigest)
    || normalizeToken(backup?.expectedAppliedStateDigest) !== normalizeToken(plan.expectedAppliedStateDigest)
    || normalizeToken(backup?.preStateDigest) !== buildStateDigest(backup?.state)) {
    throw createScriptError('SS005_BOUNDARY_BACKUP_STATE_DIGEST_INVALID', 'Backup state digests do not match the exact SS-005 plan.')
  }
  if (!plan?.ok || sha256Json(plan) !== normalizeToken(backup?.planSha256)) {
    throw createScriptError('SS005_BOUNDARY_PLAN_INVALID', 'Apply requires the exact unblocked SS-005 plan.')
  }
  if (normalizeToken(backup?.policySha256) !== expectedPolicySha256) {
    throw createScriptError('SS005_BOUNDARY_BACKUP_POLICY_INVALID', 'Backup does not match the active SS-005 policy.')
  }
  if (normalizeToken(backupArtifact?.sha256) !== sha256Text(`${JSON.stringify(backup, null, 2)}\n`)) {
    throw createScriptError('SS005_BOUNDARY_BACKUP_HASH_INVALID', 'Backup artifact hash does not match its contents.')
  }
  const models = dependencies.models || Object.fromEntries(modelConfigs.map((config) => [config.collectionKey, config.model]))
  const startSession = dependencies.startSession || (() => mongoose.startSession())
  assertSs005WriteEnvironment({
    databaseName,
    nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
    policy: policyInput,
  })
  const session = await startSession()
  try {
    let result = null
    await session.withTransaction(async () => {
      const stateBefore = await readSs005BoundaryState({
        dependencies: { modelConfigs: modelConfigs.map((config) => ({ ...config, model: models[config.collectionKey] })) },
        session,
        policy: policyInput,
      })
      const transactionPlan = buildSs005BoundaryPlan({ state: stateBefore, policy: policyInput })
      if (!transactionPlan.ok || sha256Json(transactionPlan) !== sha256Json(plan)) {
        throw createScriptError('SS005_BOUNDARY_PLAN_CHANGED', 'SS-005 boundary state changed after preflight.')
      }
      for (const update of transactionPlan.updates) {
        const updateResult = await models[update.collectionKey].updateOne(
          { [update.idField]: update.recordKey },
          { $set: update.set },
          { runValidators: true, session },
        )
        assertMutationResult({ result: updateResult, operation: `${update.collectionKey}:${update.recordKey}` })
      }
      const stateAfter = await readSs005BoundaryState({
        dependencies: { modelConfigs: modelConfigs.map((config) => ({ ...config, model: models[config.collectionKey] })) },
        session,
        policy: policyInput,
      })
      const readbackPlan = buildSs005BoundaryPlan({ state: stateAfter, policy: policyInput })
      if (!readbackPlan.ok || readbackPlan.recordsToUpdate !== 0 || buildStateDigest(stateAfter) !== backup.expectedAppliedStateDigest) {
        throw createScriptError('SS005_BOUNDARY_READBACK_MISMATCH', 'SS-005 boundary readback did not converge.')
      }
      result = {
        recordsUpdated: transactionPlan.recordsToUpdate,
        readbackDigest: buildStateDigest(stateAfter),
        secondDryRunMutations: readbackPlan.recordsToUpdate,
      }
      const audit = dependencies.governanceAuditService || governanceAuditService
      await audit.logSystemEvent(
        'SS005_BOUNDARY_POLICY_APPLIED',
        buildAuditPayload({ backupArtifact, plan: transactionPlan, policy: policyInput, result }),
        { session, throwOnError: true },
      )
    })
    return result
  } finally {
    await session.endSession()
  }
}

const parseArgs = (argv = process.argv.slice(2)) => ({
  apply: argv.includes('--apply'),
  json: argv.includes('--json'),
  confirm: argv.includes(SS005_BOUNDARY_APPLY_CONFIRM_FLAG),
  policySha256: normalizeToken(argv[argv.indexOf('--policy-sha256') + 1]),
  planSha256: normalizeToken(argv[argv.indexOf('--plan-sha256') + 1]),
})

export const runSs005BoundaryPolicy = async ({
  args = parseArgs(),
  dependencies = {},
  logger = console.log,
  reportDir = DEFAULT_SS005_BOUNDARY_REPORT_DIR,
  now = new Date(),
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const activePolicy = dependencies.policy || policy
  validateSs005BoundaryPolicy(activePolicy)
  await connect({ autoIndex: false })
  try {
    const configs = dependencies.modelConfigs || modelConfigs
    const state = await readSs005BoundaryState({ dependencies: { modelConfigs: configs }, policy: activePolicy })
    const plan = buildSs005BoundaryPlan({ state, policy: activePolicy })
    const policySha256 = sha256Json(activePolicy)
    const planSha256 = sha256Json(plan)
    const databaseName = getDatabaseName(configs[0]?.model?.collection)
    let backupArtifact = null
    let result = null
    if (args.apply) {
      if (!args.confirm) throw createScriptError('SS005_BOUNDARY_CONFIRMATION_REQUIRED', `Mutation requires ${SS005_BOUNDARY_APPLY_CONFIRM_FLAG}.`)
      if (args.policySha256 !== policySha256 || args.planSha256 !== planSha256) {
        throw createScriptError('SS005_BOUNDARY_DIGEST_REQUIRED', 'Mutation requires the exact policy and plan digests from dry run.', { policySha256, planSha256 })
      }
      assertSs005WriteEnvironment({ databaseName, nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV, policy: activePolicy })
      if (!plan.ok) throw createScriptError('SS005_BOUNDARY_PLAN_BLOCKED', 'Cannot apply a blocked SS-005 boundary plan.', { blockers: plan.blockers })
      const backup = {
        schemaVersion: '1.0.0',
        databaseName,
        policyVersion: activePolicy.policyVersion,
        policySha256,
        planSha256,
        capturedAt: now.toISOString(),
        preStateDigest: plan.preStateDigest,
        expectedAppliedStateDigest: plan.expectedAppliedStateDigest,
        state,
      }
      backupArtifact = await writeSs005BoundaryBackup({ backup, reportDir, now })
      result = await applySs005BoundaryPlan({
        backup,
        backupArtifact,
        plan,
        policy: activePolicy,
        dependencies: { ...dependencies, databaseName },
      })
    }
    const report = {
      ok: plan.ok,
      mode: args.apply ? 'APPLY' : 'DRY_RUN',
      databaseName,
      policyVersion: activePolicy.policyVersion,
      policySha256,
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
  runSs005BoundaryPolicy().catch((error) => {
    console.error(JSON.stringify({ ok: false, code: error.code, message: error.message, details: error.details }, null, 2))
    process.exit(1)
  })
}
