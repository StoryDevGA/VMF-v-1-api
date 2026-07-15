import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { connectDb, disconnectDb } from '../config/db.js'
import {
  KnowledgePack,
  KnowledgePackActivation,
  KnowledgePackVersion,
} from '../models/index.js'
import { KNOWLEDGE_PACK_LAYERS } from '../constants/knowledgeRuntime.js'

const migrationPolicy = JSON.parse(fs.readFileSync(
  new URL('./data/knowledgePackLayerMigrationPolicy.v1.json', import.meta.url),
  'utf8',
))

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()
const validLayers = new Set(Object.values(KNOWLEDGE_PACK_LAYERS))

const modelConfigs = Object.freeze([
  Object.freeze({
    collectionKey: 'KnowledgePack',
    model: KnowledgePack,
    idField: 'packId',
    includesDependencies: false,
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackVersion',
    model: KnowledgePackVersion,
    idField: 'versionId',
    includesDependencies: true,
  }),
  Object.freeze({
    collectionKey: 'KnowledgePackActivation',
    model: KnowledgePackActivation,
    idField: 'activationId',
    includesDependencies: true,
  }),
])

const getDatabaseName = (collection) =>
  collection?.db?.databaseName
  || collection?.db?.s?.databaseName
  || collection?.conn?.name
  || 'unknown'

export const proposeKnowledgeLayer = (row = {}, policy = migrationPolicy) => {
  const currentLayer = normalizeToken(row.knowledgeLayer)
  if (validLayers.has(currentLayer)) {
    return {
      status: 'CLASSIFIED',
      currentLayer,
      suggestedLayer: currentLayer,
      reason: 'PERSISTED_LAYER',
    }
  }

  const packType = normalizeToken(row.packType)
  const suggestedLayer = normalizeToken(policy?.packTypeLayerMap?.[packType])
  if (validLayers.has(suggestedLayer)) {
    return {
      status: 'SUGGESTED',
      currentLayer: '',
      suggestedLayer,
      reason: 'PACK_TYPE_POLICY',
    }
  }

  return {
    status: 'BLOCKED',
    currentLayer: '',
    suggestedLayer: '',
    reason: 'UNMAPPED_PACK_TYPE',
  }
}

export const buildKnowledgePackLayerAuditRow = ({
  collectionKey,
  idField,
  includesDependencies,
  policy = migrationPolicy,
  row = {},
} = {}) => {
  const layerProposal = proposeKnowledgeLayer(row, policy)
  const effectiveLayer = layerProposal.currentLayer || layerProposal.suggestedLayer
  const issues = []

  if (layerProposal.status === 'BLOCKED') issues.push('KNOWLEDGE_LAYER_UNMAPPED')
  if (
    policy.capabilityRequiredLayers?.includes(effectiveLayer)
    && !normalizeLowerKey(row.capabilityKey)
  ) {
    issues.push('CAPABILITY_KEY_MISSING')
  }
  if (!Array.isArray(row.workspaceCompatibility) || row.workspaceCompatibility.length === 0) {
    issues.push('WORKSPACE_COMPATIBILITY_MISSING')
  }
  if (includesDependencies && !Array.isArray(row.dependencyReferences)) {
    issues.push('DEPENDENCY_METADATA_UNSET')
  }

  return {
    collectionKey,
    recordKey: normalizeText(row[idField]),
    packType: normalizeToken(row.packType),
    packKey: normalizeLowerKey(row.packKey),
    currentLayer: layerProposal.currentLayer,
    suggestedLayer: layerProposal.suggestedLayer,
    proposalStatus: layerProposal.status,
    proposalReason: layerProposal.reason,
    issues,
    writeAuthorized: false,
  }
}

const resolveRows = async (model, idField) => {
  const query = model.find({})
  if (typeof query.select === 'function') {
    return query
      .select(`${idField} packType packKey knowledgeLayer capabilityKey workspaceCompatibility dependencyReferences`)
      .lean()
  }
  return query.lean()
}

const formatSummary = (summary) => {
  const lines = [
    `Knowledge Pack layer readiness dry run on database ${summary.database}.`,
    `Policy: ${summary.policyVersion}. Scanned=${summary.totalScanned}; classified=${summary.totalClassified}; suggested=${summary.totalSuggested}; blocked=${summary.totalBlocked}.`,
    'Write posture: READ_ONLY_NO_APPLY_MODE.',
  ]

  summary.collections.forEach((collection) => {
    lines.push(
      `${collection.collectionKey}: scanned=${collection.scanned}; classified=${collection.classified}; suggested=${collection.suggested}; blocked=${collection.blocked}.`,
    )
    collection.rows
      .filter((row) => row.proposalStatus !== 'CLASSIFIED' || row.issues.length > 0)
      .forEach((row) => {
        lines.push(
          `- ${row.recordKey}: ${row.packType}:${row.packKey} ${row.proposalStatus} ${row.suggestedLayer || '(no layer)'} issues=${row.issues.join(',') || 'none'}`,
        )
      })
  })

  return lines.join('\n')
}

export const auditKnowledgePackLayerReadiness = async ({
  json = false,
  logger = console.log,
  dependencies = {},
} = {}) => {
  const connect = dependencies.connect || connectDb
  const disconnect = dependencies.disconnect || disconnectDb
  const configs = dependencies.modelConfigs || modelConfigs
  const policy = dependencies.policy || migrationPolicy

  await connect()
  try {
    const firstCollection = configs.find((config) => config.model?.collection)?.model.collection
    const collections = []

    for (const config of configs) {
      const rows = await resolveRows(config.model, config.idField)
      const auditRows = (Array.isArray(rows) ? rows : []).map((row) =>
        buildKnowledgePackLayerAuditRow({
          collectionKey: config.collectionKey,
          idField: config.idField,
          includesDependencies: config.includesDependencies,
          policy,
          row,
        }))
      collections.push({
        collectionKey: config.collectionKey,
        scanned: auditRows.length,
        classified: auditRows.filter((row) => row.proposalStatus === 'CLASSIFIED').length,
        suggested: auditRows.filter((row) => row.proposalStatus === 'SUGGESTED').length,
        blocked: auditRows.filter((row) => row.proposalStatus === 'BLOCKED').length,
        rows: auditRows,
      })
    }

    const summary = {
      ok: true,
      mode: 'dry-run',
      database: getDatabaseName(firstCollection),
      policyVersion: normalizeText(policy.policyVersion),
      writePosture: 'READ_ONLY_NO_APPLY_MODE',
      totalScanned: collections.reduce((sum, collection) => sum + collection.scanned, 0),
      totalClassified: collections.reduce((sum, collection) => sum + collection.classified, 0),
      totalSuggested: collections.reduce((sum, collection) => sum + collection.suggested, 0),
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
auditKnowledgePackLayerReadiness.js

Usage:
  node src/scripts/auditKnowledgePackLayerReadiness.js [--json]

Read-only KP-004 migration readiness audit. No apply mode exists.
`.trim())
    process.exit(0)
  }

  auditKnowledgePackLayerReadiness({ json: args.includes('--json') })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
