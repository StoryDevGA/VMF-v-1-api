import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { connectDb, disconnectDb } from '../config/db.js'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackVersion,
} from '../models/index.js'
import {
  KNOWLEDGE_PACK_BOUNDARIES,
  resolveKnowledgePackBoundary,
} from '../constants/knowledgeRuntime.js'

const boundaryPolicy = JSON.parse(fs.readFileSync(
  new URL('./data/knowledgePackBoundaryPolicy.v1.json', import.meta.url),
  'utf8',
))

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

const modelConfigs = Object.freeze([
  Object.freeze({
    collectionKey: 'KnowledgePack',
    model: KnowledgePack,
    idField: 'packId',
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackVersion',
    model: KnowledgePackVersion,
    idField: 'versionId',
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackActivation',
    model: KnowledgePackActivation,
    idField: 'activationId',
  }),
])

const getDatabaseName = (collection) => (
  collection?.db?.databaseName
  || collection?.db?.s?.databaseName
  || collection?.conn?.name
  || 'unknown'
)

const buildBoundaryLookup = (policy = boundaryPolicy) => Object.fromEntries(
  Object.entries(policy?.boundaries || {}).flatMap(([boundary, packKeys]) => (
    (Array.isArray(packKeys) ? packKeys : []).map((packKey) => [normalizeLowerKey(packKey), boundary])
  )),
)

export const buildKnowledgePackBoundaryAuditRow = ({
  collectionKey,
  idField,
  policy = boundaryPolicy,
  row = {},
} = {}) => {
  const boundaryLookup = buildBoundaryLookup(policy)
  const packKey = normalizeLowerKey(row.packKey)
  const proposedBoundary = boundaryLookup[packKey] || ''
  const persistedBoundary = normalizeToken(row.boundary)
  const resolvedBoundary = resolveKnowledgePackBoundary(row)
  const validBoundary = Object.values(KNOWLEDGE_PACK_BOUNDARIES).includes(persistedBoundary)
  let proposalStatus = 'BLOCKED'
  let reason = 'PACK_KEY_NOT_IN_POLICY'

  if (proposedBoundary && !persistedBoundary) {
    proposalStatus = 'PROPOSED'
    reason = 'BOUNDARY_POLICY_MATCH'
  } else if (proposedBoundary && persistedBoundary === proposedBoundary) {
    proposalStatus = 'APPLIED'
    reason = 'PERSISTED_BOUNDARY_MATCHES_POLICY'
  } else if (proposedBoundary && persistedBoundary) {
    proposalStatus = 'MISMATCHED'
    reason = 'PERSISTED_BOUNDARY_DIFFERS_FROM_POLICY'
  }

  const issues = []
  if (!validBoundary && persistedBoundary) issues.push('INVALID_PERSISTED_BOUNDARY')
  if (!proposedBoundary) issues.push('BOUNDARY_POLICY_MISSING')
  if (proposalStatus === 'MISMATCHED') issues.push('BOUNDARY_POLICY_MISMATCH')

  return {
    collectionKey,
    recordKey: normalizeText(row[idField]),
    packType: normalizeToken(row.packType),
    packKey,
    sourceAuthority: normalizeText(row.sourceAuthority),
    executionMode: normalizeToken(row.executionMode),
    persistedBoundary,
    resolvedBoundary,
    proposedBoundary,
    proposalStatus,
    reason,
    issues,
    writeAuthorized: false,
  }
}

const resolveRows = async (model, idField) => {
  const query = model.find({})
  return query
    .select(`${idField} packType packKey boundary executionMode sourceAuthority`)
    .lean()
}

const formatSummary = (summary) => {
  const lines = [
    `Knowledge Pack boundary readiness dry run on database ${summary.database}.`,
    `Policy: ${summary.policyVersion}; status=${summary.policyStatus}; scanned=${summary.totalScanned}; applied=${summary.totalApplied}; proposed=${summary.totalProposed}; mismatched=${summary.totalMismatched}; blocked=${summary.totalBlocked}.`,
    'Write posture: READ_ONLY_NO_APPLY_MODE.',
  ]
  summary.collections.forEach((collection) => {
    lines.push(
      `${collection.collectionKey}: scanned=${collection.scanned}; applied=${collection.applied}; proposed=${collection.proposed}; mismatched=${collection.mismatched}; blocked=${collection.blocked}.`,
    )
  })
  return lines.join('\n')
}

export const auditKnowledgePackBoundaryReadiness = async ({
  json = false,
  logger = console.log,
  dependencies = {},
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const configs = dependencies.modelConfigs || modelConfigs
  const policy = dependencies.policy || boundaryPolicy

  await connect()
  try {
    const firstCollection = configs.find((config) => config.model?.collection)?.model.collection
    const collections = []
    for (const config of configs) {
      const rows = await resolveRows(config.model, config.idField)
      const auditRows = (Array.isArray(rows) ? rows : []).map((row) =>
        buildKnowledgePackBoundaryAuditRow({
          collectionKey: config.collectionKey,
          idField: config.idField,
          policy,
          row,
        }))
      collections.push({
        collectionKey: config.collectionKey,
        scanned: auditRows.length,
        applied: auditRows.filter((row) => row.proposalStatus === 'APPLIED').length,
        proposed: auditRows.filter((row) => row.proposalStatus === 'PROPOSED').length,
        mismatched: auditRows.filter((row) => row.proposalStatus === 'MISMATCHED').length,
        blocked: auditRows.filter((row) => row.proposalStatus === 'BLOCKED').length,
        rows: auditRows,
      })
    }

    const summary = {
      ok: true,
      mode: 'dry-run',
      database: getDatabaseName(firstCollection),
      policyVersion: normalizeText(policy.policyVersion),
      policyStatus: normalizeToken(policy.status),
      writePosture: 'READ_ONLY_NO_APPLY_MODE',
      totalScanned: collections.reduce((sum, collection) => sum + collection.scanned, 0),
      totalApplied: collections.reduce((sum, collection) => sum + collection.applied, 0),
      totalProposed: collections.reduce((sum, collection) => sum + collection.proposed, 0),
      totalMismatched: collections.reduce((sum, collection) => sum + collection.mismatched, 0),
      totalBlocked: collections.reduce((sum, collection) => sum + collection.blocked, 0),
      collections,
    }
    logger(json ? JSON.stringify(summary, null, 2) : formatSummary(summary))
    return summary
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
  const args = process.argv.slice(2)
  if (args.includes('--apply')) {
    console.error('This command is read-only. --apply is not supported.')
    process.exit(1)
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
auditKnowledgePackBoundaryReadiness.js

Usage:
  node src/scripts/auditKnowledgePackBoundaryReadiness.js [--json]

Read-only SS-005 boundary policy audit. No apply mode exists.
`.trim())
    process.exit(0)
  }
  auditKnowledgePackBoundaryReadiness({ json: args.includes('--json') })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
