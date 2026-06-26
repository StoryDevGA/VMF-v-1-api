import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import {
  OUTPUT_LAB_ASSET_STATUSES,
} from '../constants/runtimeOutputLab.js'
import {
  OUTCOME_STUDIO_BINDING_STATUSES,
  OUTCOME_STUDIO_BLOCKER_CODES,
  OUTCOME_STUDIO_ASSET_STATUSES,
  OUTCOME_STUDIO_ASSET_VERSION_STATUSES,
  OUTCOME_STUDIO_CONTRACT_VERSION,
  OUTCOME_STUDIO_EXPORT_FORMATS,
  OUTCOME_STUDIO_MESSAGE_ROLES,
  OUTCOME_STUDIO_MESSAGE_STATUSES,
  OUTCOME_STUDIO_PHASE,
  OUTCOME_STUDIO_READINESS_STATES,
  OUTCOME_STUDIO_RESPONSE_STATUSES,
  OUTCOME_STUDIO_SAFETY_GATE_CODES,
  OUTCOME_STUDIO_SAFETY_GATE_STATUSES,
  OUTCOME_STUDIO_SESSION_STATUSES,
} from '../constants/runtimeOutcomeStudio.js'
import {
  DEFAULT_OUTCOME_ASSET_TYPE,
  DEFAULT_OUTCOME_WORKSPACE_TYPE,
  RUNTIME_GRAPH_NODE_TYPES,
  RUNTIME_GRAPH_RELATIONSHIP_TYPES,
  resolveKnowledgePackCategory,
} from '../constants/workspaceGovernance.js'
import {
  OutcomeAsset,
  OutcomeAssetVersion,
  OutcomeMessage,
  OutcomeSession,
  TruthSignature,
} from '../models/index.js'
import { resolveOutcomeStudioKnowledgePacks } from './outcomeKnowledgePackRegistryService.js'
import { getRuntimeOutputLab } from './runtimeOutputLabService.js'
import {
  assertRuntimePermission,
  getRuntimeInstance,
  toIdString,
} from './runtimeInstanceService.js'
import { getRuntimeTruthQuality } from './runtimeTruthQualityService.js'
import {
  createRuntimeGraphRelationshipDocuments,
  deleteRuntimeGraphRelationshipDocuments,
  saveRuntimeGraphRelationshipDocuments,
} from './runtimeGraphRelationshipService.js'
import auditService from './auditService.js'

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizePackCategory = (value, packType) =>
  resolveKnowledgePackCategory({ packCategory: value, packType })
const canUseMongoTransaction = () => mongoose.connection.readyState === 1

export const OUTCOME_STUDIO_ERROR_REASONS = Object.freeze({
  OUTCOME_ASSET_EXPORT_BLOCKED: 'OUTCOME_ASSET_EXPORT_BLOCKED',
  OUTCOME_ASSET_EXPORT_AUDIT_FAILED: 'OUTCOME_ASSET_EXPORT_AUDIT_FAILED',
  OUTCOME_ASSET_EXPORT_CONTENT_UNAVAILABLE: 'OUTCOME_ASSET_EXPORT_CONTENT_UNAVAILABLE',
  OUTCOME_ASSET_EXPORT_FORMAT_UNSUPPORTED: 'OUTCOME_ASSET_EXPORT_FORMAT_UNSUPPORTED',
  OUTCOME_ASSET_GENERATION_AUDIT_FAILED: 'OUTCOME_ASSET_GENERATION_AUDIT_FAILED',
  OUTCOME_ASSET_NOT_FOUND: 'OUTCOME_ASSET_NOT_FOUND',
  OUTCOME_ASSET_PREVIEW_BLOCKED: 'OUTCOME_ASSET_PREVIEW_BLOCKED',
  OUTCOME_ASSET_PREVIEW_CONTENT_UNAVAILABLE: 'OUTCOME_ASSET_PREVIEW_CONTENT_UNAVAILABLE',
  OUTCOME_ASSET_PUBLISH_AUDIT_FAILED: 'OUTCOME_ASSET_PUBLISH_AUDIT_FAILED',
  OUTCOME_ASSET_PUBLISH_BLOCKED: 'OUTCOME_ASSET_PUBLISH_BLOCKED',
  OUTCOME_ASSET_VERSION_NOT_FOUND: 'OUTCOME_ASSET_VERSION_NOT_FOUND',
  OUTCOME_GRAPH_RELATIONSHIP_FAILED: 'OUTCOME_GRAPH_RELATIONSHIP_FAILED',
  OUTCOME_MESSAGE_AUDIT_FAILED: 'OUTCOME_MESSAGE_AUDIT_FAILED',
  OUTCOME_MESSAGE_NOT_FOUND: 'OUTCOME_MESSAGE_NOT_FOUND',
  OUTCOME_RESPONSE_GENERATION_BLOCKED: 'OUTCOME_RESPONSE_GENERATION_BLOCKED',
  OUTCOME_SESSION_BLOCKED: 'OUTCOME_SESSION_BLOCKED',
  OUTCOME_SESSION_AUDIT_FAILED: 'OUTCOME_SESSION_AUDIT_FAILED',
  OUTCOME_SESSION_NOT_FOUND: 'OUTCOME_SESSION_NOT_FOUND',
  OUTCOME_TRUTH_DRIFT_AUDIT_FAILED: 'OUTCOME_TRUTH_DRIFT_AUDIT_FAILED',
  OUTCOME_TRUTH_UPDATE_AUDIT_FAILED: 'OUTCOME_TRUTH_UPDATE_AUDIT_FAILED',
  OUTCOME_TRUTH_UPDATE_BLOCKED: 'OUTCOME_TRUTH_UPDATE_BLOCKED',
})

const OUTCOME_STUDIO_ASSET_LIST_LIMIT = 20
const OUTCOME_STUDIO_ASSET_VERSION_LIST_LIMIT = 20
const OUTCOME_STUDIO_MESSAGE_LIST_LIMIT = 20
const OUTCOME_STUDIO_SESSION_LIST_LIMIT = 10
const OUTCOME_CONTEXT_BINDING_LIST_LIMIT = 50
const TRUTH_SIGNATURE_CURRENTNESS_FIELDS = Object.freeze([
  'sourceOutputAssetId',
  'publishSnapshotId',
  'publishSnapshotHash',
  'lockSnapshotId',
  'lockSnapshotHash',
  'replayAnchorId',
  'replayAnchorHash',
  'graphVersion',
  'graphHash',
])
const TRUTH_SIGNATURE_REQUIRED_CURRENT_PROOF = Object.freeze([
  'lockSnapshotId',
  'replayAnchorId',
  'graphHash',
])
const TRUTH_SIGNATURE_DRIFT_CURRENTNESS = Object.freeze(new Set([
  'OUT_OF_DATE',
  'OBSOLETE',
]))

const createOutcomeStudioError = ({
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

const cloneValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const normalizeFilenamePart = (value, fallback = 'outcome-studio') => {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || fallback
}

const toPlainObject = (value) => {
  if (!value) return {}
  if (typeof value.toJSON === 'function') return value.toJSON()
  if (typeof value.toObject === 'function') return value.toObject()
  return { ...value }
}

const hasOwnObjectValue = (source, key) =>
  Object.prototype.hasOwnProperty.call(source, key)

const isMongooseDocumentLike = (source) =>
  Boolean(source && typeof source.get === 'function' && typeof source.toObject === 'function')

const getObjectValue = (source, key) => {
  if (source === null || source === undefined || !key || typeof source !== 'object') return undefined
  if (source instanceof Map) return source.get(key)
  if (isMongooseDocumentLike(source)) {
    const value = source.get(key)
    if (value !== undefined) return value
  }
  if (hasOwnObjectValue(source, key)) return source[key]
  return undefined
}

const normalizeDateValue = (value) => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

const buildOutcomeMessageId = () => `out_msg_${randomUUID()}`
const buildOutcomeAssetId = () => `outcome_asset_${randomUUID()}`
const buildOutcomeAssetVersionId = () => `outcome_asset_version_${randomUUID()}`
const buildOutcomeSessionId = () => `out_sess_${randomUUID()}`
const buildTruthSignatureId = () => `truth_sig_${randomUUID()}`

const buildGovernedOutcomeResponseText = ({
  message = {},
  session = {},
} = {}) => {
  const outputTypeLabel = normalizeText(
    session.sourceOutputTypeLabel
    || session.sourceOutput?.outputTypeLabel
    || message.sourceOutput?.outputTypeLabel,
  ) || 'governed output'
  const sourceOutputAssetId = normalizeText(
    session.sourceOutputAssetId
    || session.sourceOutput?.outputAssetId
    || message.sourceOutput?.outputAssetId,
  )
  const truthSignatureId = normalizeText(
    session.truthSignatureId
    || session.truthSignature?.truthSignatureId
    || message.truthSignature?.truthSignatureId,
  )
  const activePackCount = Number(
    session.knowledgePackBinding?.activeCount
    ?? message.knowledgePackBinding?.activeCount
    ?? 0,
  )
  const requiredPackCount = Number(
    session.knowledgePackBinding?.requiredCount
    ?? message.knowledgePackBinding?.requiredCount
    ?? 0,
  )

  return [
    `Governed response prepared from the current ${outputTypeLabel}.`,
    'The answer is bound to certified Runtime Truth and the active Outcome Studio knowledge-pack set.',
    `Lineage: source output ${sourceOutputAssetId || 'unavailable'}, truth signature ${truthSignatureId || 'unavailable'}, knowledge packs ${activePackCount}/${requiredPackCount}.`,
    'This scaffold does not expose hidden reasoning, raw source content, prompt assembly, or ARL/RL internals.',
  ].join('\n\n')
}

const buildOutcomeAssetTitle = ({ session = {} } = {}) => {
  const outputTypeLabel = normalizeText(session.sourceOutputTypeLabel || session.sourceOutput?.outputTypeLabel)
  return outputTypeLabel ? `Governed ${outputTypeLabel}` : 'Governed Outcome Asset'
}

const buildGeneratedOutcomeAssetCustomerContent = ({
  assetId = '',
  message = {},
  responseText = '',
  session = {},
  versionId = '',
} = {}) => {
  const title = buildOutcomeAssetTitle({ session })
  const markdown = [
    `# ${title}`,
    '',
    responseText,
    '',
    '## Governance',
    '',
    `- Source Output Asset ID: ${normalizeText(session.sourceOutputAssetId || session.sourceOutput?.outputAssetId) || 'Not recorded'}`,
    `- Truth Signature ID: ${normalizeText(session.truthSignatureId || session.truthSignature?.truthSignatureId) || 'Not recorded'}`,
    `- Knowledge Packs: ${Number(session.knowledgePackBinding?.activeCount || 0)} active / ${Number(session.knowledgePackBinding?.requiredCount || 0)} required`,
    `- Source Prompt Message ID: ${normalizeText(message.messageId) || 'Not recorded'}`,
  ].join('\n')

  return {
    markdown,
    sections: [
      {
        key: 'governed-response',
        label: 'Governed Response',
        body: responseText,
      },
      {
        key: 'governance',
        label: 'Governance',
        body: 'Generated from the current session Truth Signature and active Outcome Studio knowledge-pack binding.',
      },
    ],
    metadata: {
      outcomeAssetId: normalizeText(assetId),
      outcomeAssetVersionId: normalizeText(versionId),
      sourceMessageId: normalizeText(message.messageId),
      generationMode: 'DETERMINISTIC_SCAFFOLD',
    },
  }
}

const buildGeneratedOutcomeAssetLineageSummary = ({
  generatedAt = '',
  parentVersionId = '',
  runtimeInstance = {},
  session = {},
} = {}) => {
  const frameworkState = getFrameworkState(runtimeInstance)
  const revision = getObjectValue(frameworkState, 'revision') || {}
  return {
    sourceOutputAssetId: normalizeText(session.sourceOutputAssetId || session.sourceOutput?.outputAssetId),
    sourceOutputTypeKey: normalizeToken(session.sourceOutputTypeKey || session.sourceOutput?.outputTypeKey),
    sourceOutputTypeLabel: normalizeText(session.sourceOutputTypeLabel || session.sourceOutput?.outputTypeLabel),
    truthSignatureStatus: normalizeToken(session.truthSignature?.status),
    truthSignatureCurrentness: normalizeToken(session.truthSignature?.currentness),
    runtimeRevisionId: normalizeText(
      getObjectValue(revision, 'revisionId')
      || getObjectValue(frameworkState, 'revisionId')
      || getObjectValue(runtimeInstance, 'currentRevisionId'),
    ),
    runtimeRevisionNumber: Number(
      getObjectValue(revision, 'revisionNumber')
      || getObjectValue(frameworkState, 'revisionNumber')
      || getObjectValue(runtimeInstance, 'currentRevisionNumber')
      || 0,
    ),
    parentVersionId: normalizeText(parentVersionId),
    generatedAt,
  }
}

const getRuntimeScope = (runtimeInstance = {}) => ({
  tenantId: runtimeInstance.tenantId,
  customerId: runtimeInstance.customerId,
  runtimeInstanceId: runtimeInstance._id || runtimeInstance.id,
  runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
  runtimeType: runtimeInstance.runtimeType || '',
  frameworkKey: runtimeInstance.frameworkKey || '',
  packageKey: runtimeInstance.packageKey || '',
  packageVersion: runtimeInstance.packageVersion || '',
  projectId: runtimeInstance.projectId || null,
  outcomeId: runtimeInstance.outcomeId || null,
})

const getFrameworkState = (runtimeInstance = {}) =>
  getObjectValue(runtimeInstance, 'framework_state')
  || getObjectValue(runtimeInstance, 'frameworkState')
  || {}

const buildRuntimeTruthEvidence = (runtimeInstance = {}) => {
  const frameworkState = getFrameworkState(runtimeInstance)
  const publish = getObjectValue(frameworkState, 'publish') || {}
  const lock = getObjectValue(frameworkState, 'lock') || {}
  const publishSnapshot = getObjectValue(publish, 'snapshot') || getObjectValue(lock, 'publish') || {}
  const lockSnapshot = getObjectValue(lock, 'snapshot') || {}
  const replayAnchor = getObjectValue(lock, 'replayAnchor') || getObjectValue(lock, 'anchor') || {}
  const graph = getObjectValue(frameworkState, 'intelligence_graph') || {}

  return {
    publishSnapshotId: normalizeText(getObjectValue(publishSnapshot, 'snapshotId')),
    publishSnapshotHash: normalizeText(getObjectValue(publishSnapshot, 'snapshotHash')),
    lockSnapshotId: normalizeText(getObjectValue(lockSnapshot, 'snapshotId')),
    lockSnapshotHash: normalizeText(getObjectValue(lockSnapshot, 'snapshotHash')),
    replayAnchorId: normalizeText(
      getObjectValue(replayAnchor, 'replayAnchorId')
      || getObjectValue(replayAnchor, 'anchorId'),
    ),
    replayAnchorHash: normalizeText(
      getObjectValue(replayAnchor, 'replayAnchorHash')
      || getObjectValue(replayAnchor, 'anchorHash'),
    ),
    graphVersion: normalizeText(getObjectValue(graph, 'graphVersion')),
    graphHash: normalizeText(getObjectValue(graph, 'graphHash')),
  }
}

const buildProjectionTruthEvidence = ({
  readiness = {},
  sourceOutput = null,
} = {}) => {
  const outputEligibility = readiness?.outputEligibility && typeof readiness.outputEligibility === 'object'
    ? readiness.outputEligibility
    : {}
  const graph = readiness?.graph && typeof readiness.graph === 'object'
    ? readiness.graph
    : {}
  const sourceSnapshot = sourceOutput?.sourceSnapshot && typeof sourceOutput.sourceSnapshot === 'object'
    ? sourceOutput.sourceSnapshot
    : {}

  return {
    sourceOutputAssetId: normalizeText(sourceOutput?.outputAssetId),
    publishSnapshotId: normalizeText(sourceSnapshot.publishSnapshotId || outputEligibility.publishSnapshotId),
    publishSnapshotHash: normalizeText(sourceSnapshot.publishSnapshotHash || outputEligibility.publishSnapshotHash),
    lockSnapshotId: normalizeText(sourceSnapshot.lockSnapshotId || outputEligibility.lockSnapshotId),
    lockSnapshotHash: normalizeText(sourceSnapshot.lockSnapshotHash || outputEligibility.lockSnapshotHash),
    replayAnchorId: normalizeText(sourceSnapshot.replayAnchorId || outputEligibility.replayAnchorId),
    replayAnchorHash: normalizeText(sourceSnapshot.replayAnchorHash || outputEligibility.replayAnchorHash),
    graphVersion: normalizeText(sourceSnapshot.graphVersion || graph.graphVersion),
    graphHash: normalizeText(sourceSnapshot.graphHash || graph.graphHash),
  }
}

const hasTruthEvidence = (evidence = {}) =>
  TRUTH_SIGNATURE_CURRENTNESS_FIELDS.some((key) => normalizeText(evidence?.[key]))

const resolveTruthSignatureCurrentness = ({
  currentEvidence = null,
  truthSignature = {},
} = {}) => {
  const persistedCurrentness = normalizeToken(truthSignature.currentness)
  const status = normalizeToken(truthSignature.status)
  const persistedEvidence = truthSignature.evidence && typeof truthSignature.evidence === 'object'
    ? truthSignature.evidence
    : {}

  if (status && status !== OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED) {
    return persistedCurrentness || 'BLOCKED'
  }

  if (!currentEvidence || !hasTruthEvidence(currentEvidence) || !hasTruthEvidence(persistedEvidence)) {
    return persistedCurrentness
  }

  const currentProofMissing = TRUTH_SIGNATURE_REQUIRED_CURRENT_PROOF
    .some((key) => !normalizeText(currentEvidence[key]))
  if (currentProofMissing) return 'OBSOLETE'

  const drifted = TRUTH_SIGNATURE_CURRENTNESS_FIELDS.some((key) => {
    const persistedValue = normalizeText(persistedEvidence[key])
    const currentValue = normalizeText(currentEvidence[key])
    return persistedValue && currentValue && persistedValue !== currentValue
  })

  return drifted ? 'OUT_OF_DATE' : 'CURRENT'
}

const sanitizeKnowledgePackActivation = (pack = {}) => ({
  packCategory: normalizePackCategory(pack.packCategory, pack.packType),
  packType: normalizeToken(pack.packType),
  packKey: normalizeText(pack.packKey),
  label: normalizeText(pack.label),
  status: normalizeToken(pack.status || 'ACTIVE'),
  activationId: normalizeText(pack.activationId),
  versionId: normalizeText(pack.versionId),
  semanticVersion: normalizeText(pack.semanticVersion),
  schemaVersion: normalizeText(pack.schemaVersion),
  scopeType: normalizeToken(pack.scopeType),
  scopeKey: normalizeToken(pack.scopeKey),
  contentHash: normalizeText(pack.contentHash),
  activatedAt: normalizeText(pack.activatedAt),
})

const buildSessionKnowledgePackBinding = (packBinding = {}, boundAt) => {
  const activePacks = Array.isArray(packBinding.activePacks)
    ? packBinding.activePacks.map(sanitizeKnowledgePackActivation)
    : []
  const requiredPacks = Array.isArray(packBinding.requiredPacks)
    ? packBinding.requiredPacks.map((pack) => ({
        packCategory: normalizePackCategory(pack.packCategory, pack.packType),
        packType: normalizeToken(pack.packType),
        packKey: normalizeText(pack.packKey),
        label: normalizeText(pack.label),
        status: normalizeToken(pack.status),
        runtimeBindable: pack.runtimeBindable === true,
      }))
    : []

  return {
    status: normalizeToken(packBinding.status),
    mode: normalizeText(packBinding.mode),
    summary: normalizeText(packBinding.summary),
    boundAt,
    activeCount: activePacks.length,
    requiredCount: requiredPacks.length,
    activePacks,
    requiredPacks,
    resolution: {
      status: normalizeToken(packBinding.resolution?.status || packBinding.status),
      activeCount: Number(packBinding.resolution?.activeCount ?? activePacks.length),
      requiredCount: Number(packBinding.resolution?.requiredCount ?? requiredPacks.length),
      scopeCandidates: Array.isArray(packBinding.resolution?.scopeCandidates)
        ? packBinding.resolution.scopeCandidates.map((candidate) => ({
            scopeType: normalizeToken(candidate.scopeType),
            scopeKey: normalizeToken(candidate.scopeKey),
            precedence: Number(candidate.precedence ?? 0),
          }))
        : [],
    },
  }
}

const buildSessionTruthSignature = (truthSignature = {}, boundAt, truthSignatureId = '') => ({
  ...cloneValue(truthSignature || {}),
  truthSignatureId: normalizeText(truthSignatureId),
  persistence: 'SESSION_BOUND',
  boundAt,
})

const sanitizePersistedSourceOutput = (sourceOutput = {}) => ({
  outputAssetId: normalizeText(sourceOutput.outputAssetId),
  outputTypeKey: normalizeToken(sourceOutput.outputTypeKey),
  outputTypeLabel: normalizeText(sourceOutput.outputTypeLabel),
  status: normalizeToken(sourceOutput.status || 'UNKNOWN'),
  stale: sourceOutput.stale === true,
  exportable: sourceOutput.exportable === true,
  generatedAt: normalizeText(sourceOutput.generatedAt),
  publishedAt: normalizeText(sourceOutput.publishedAt),
  supportedFormats: Array.isArray(sourceOutput.supportedFormats)
    ? sourceOutput.supportedFormats.map(normalizeToken).filter(Boolean)
    : [],
  sourceSnapshot: getSourceSnapshot(sourceOutput, {}),
})

const sanitizePersistedTruthSignature = (truthSignature = {}, {
  currentEvidence = null,
} = {}) => ({
  truthSignatureId: normalizeText(truthSignature.truthSignatureId),
  status: normalizeToken(truthSignature.status),
  mode: normalizeText(truthSignature.mode),
  persistence: normalizeText(truthSignature.persistence),
  currentness: resolveTruthSignatureCurrentness({ currentEvidence, truthSignature }),
  boundAt: normalizeText(truthSignature.boundAt),
  evidence: truthSignature.evidence && typeof truthSignature.evidence === 'object'
    ? cloneValue(truthSignature.evidence)
    : {},
  missingEvidence: Array.isArray(truthSignature.missingEvidence)
    ? truthSignature.missingEvidence.map((item) => ({
        key: normalizeText(item?.key),
        label: normalizeText(item?.label),
      })).filter((item) => item.key || item.label)
    : [],
})

const sanitizePersistedKnowledgePackBinding = (binding = {}) => {
  const activePacks = Array.isArray(binding.activePacks)
    ? binding.activePacks.slice(0, OUTCOME_CONTEXT_BINDING_LIST_LIMIT).map(sanitizeKnowledgePackActivation)
    : []
  const requiredPacks = Array.isArray(binding.requiredPacks)
    ? binding.requiredPacks.slice(0, OUTCOME_CONTEXT_BINDING_LIST_LIMIT).map((pack) => ({
        packCategory: normalizePackCategory(pack?.packCategory, pack?.packType),
        packType: normalizeToken(pack?.packType),
        packKey: normalizeText(pack?.packKey),
        label: normalizeText(pack?.label),
        status: normalizeToken(pack?.status),
        runtimeBindable: pack?.runtimeBindable === true,
      })).filter((pack) => pack.packType || pack.packKey)
    : []
  return {
    status: normalizeToken(binding.status),
    mode: normalizeText(binding.mode),
    summary: normalizeText(binding.summary),
    boundAt: normalizeText(binding.boundAt),
    activeCount: Number(binding.activeCount ?? activePacks.length),
    requiredCount: Number(binding.requiredCount ?? requiredPacks.length),
    activePacks,
    requiredPacks,
    resolution: {
      status: normalizeToken(binding.resolution?.status || binding.status),
      activeCount: Number(binding.resolution?.activeCount ?? activePacks.length),
      requiredCount: Number(binding.resolution?.requiredCount ?? requiredPacks.length),
      scopeCandidates: Array.isArray(binding.resolution?.scopeCandidates)
        ? binding.resolution.scopeCandidates.slice(0, OUTCOME_CONTEXT_BINDING_LIST_LIMIT).map((candidate) => ({
            scopeType: normalizeToken(candidate.scopeType),
            scopeKey: normalizeToken(candidate.scopeKey),
            precedence: Number(candidate.precedence ?? 0),
          }))
        : [],
    },
  }
}

const buildOutcomeContextBindings = ({
  assetType = '',
  contextType = '',
  knowledgePackBinding = {},
  messageId = '',
  outcomeAssetId = '',
  outcomeAssetVersionId = '',
  runtimeScope = {},
  sessionId = '',
  sourceOutput = {},
  truthSignature = {},
} = {}) => {
  const safeSourceOutput = sanitizePersistedSourceOutput(sourceOutput || {})
  const safeTruthBinding = sanitizePersistedTruthSignature(truthSignature || {})
  const safeKnowledgeBinding = sanitizePersistedKnowledgePackBinding(knowledgePackBinding || {})
  const normalizedAssetType = normalizeToken(assetType)
  const evidence = safeTruthBinding.evidence && typeof safeTruthBinding.evidence === 'object'
    ? safeTruthBinding.evidence
    : {}

  return {
    projectContext: {
      projectId: normalizeText(runtimeScope.projectId),
      outcomeId: normalizeText(runtimeScope.outcomeId),
    },
    workspaceContext: {
      workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
      workspaceSessionId: normalizeText(sessionId),
      workspaceMessageId: normalizeText(messageId),
      workspaceAssetId: normalizeText(outcomeAssetId),
      workspaceAssetVersionId: normalizeText(outcomeAssetVersionId),
      contextType: normalizeToken(contextType),
      ...(normalizedAssetType ? { assetType: normalizedAssetType } : {}),
    },
    runtimeContext: {
      runtimeInstanceId: toIdString(runtimeScope.runtimeInstanceId),
      runtimeInstanceKey: normalizeText(runtimeScope.runtimeInstanceKey),
      runtimeType: normalizeToken(runtimeScope.runtimeType),
      frameworkKey: normalizeToken(runtimeScope.frameworkKey),
      packageKey: normalizeText(runtimeScope.packageKey),
      packageVersion: normalizeText(runtimeScope.packageVersion),
    },
    sourceOutputBinding: {
      outputAssetId: safeSourceOutput.outputAssetId,
      outputTypeKey: safeSourceOutput.outputTypeKey,
      outputTypeLabel: safeSourceOutput.outputTypeLabel,
      status: safeSourceOutput.status,
      stale: safeSourceOutput.stale,
      exportable: safeSourceOutput.exportable,
      generatedAt: safeSourceOutput.generatedAt,
      publishedAt: safeSourceOutput.publishedAt,
      supportedFormats: safeSourceOutput.supportedFormats,
      sourceSnapshot: safeSourceOutput.sourceSnapshot,
    },
    truthBinding: {
      truthSignatureId: safeTruthBinding.truthSignatureId,
      status: safeTruthBinding.status,
      mode: safeTruthBinding.mode,
      persistence: safeTruthBinding.persistence,
      currentness: safeTruthBinding.currentness,
      boundAt: safeTruthBinding.boundAt,
      evidence: safeTruthBinding.evidence,
      missingEvidence: safeTruthBinding.missingEvidence,
    },
    knowledgeBindings: {
      status: safeKnowledgeBinding.status,
      mode: safeKnowledgeBinding.mode,
      boundAt: safeKnowledgeBinding.boundAt,
      activeCount: safeKnowledgeBinding.activeCount,
      requiredCount: safeKnowledgeBinding.requiredCount,
      activePacks: safeKnowledgeBinding.activePacks,
      requiredPacks: safeKnowledgeBinding.requiredPacks,
      resolution: safeKnowledgeBinding.resolution,
    },
    // Intentionally duplicated as a compact evidence access path for audit/support review.
    // The canonical full evidence snapshot remains under truthBinding.evidence.
    evidenceBindings: {
      sourceOutputAssetId: normalizeText(evidence.sourceOutputAssetId),
      publishSnapshotId: normalizeText(evidence.publishSnapshotId),
      publishSnapshotHash: normalizeText(evidence.publishSnapshotHash),
      lockSnapshotId: normalizeText(evidence.lockSnapshotId),
      lockSnapshotHash: normalizeText(evidence.lockSnapshotHash),
      replayAnchorId: normalizeText(evidence.replayAnchorId),
      replayAnchorHash: normalizeText(evidence.replayAnchorHash),
      graphVersion: normalizeText(evidence.graphVersion),
      graphHash: normalizeText(evidence.graphHash),
    },
    // Reserved for future ARL/RL interpretation and decision-pack bindings.
    interpretationBindings: [],
    decisionBindings: [],
  }
}

const buildRuntimeGraphScope = (runtimeScope = {}) => ({
  tenantId: runtimeScope.tenantId,
  customerId: runtimeScope.customerId,
  runtimeInstanceId: runtimeScope.runtimeInstanceId,
  workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
})

const buildRuntimeGraphNode = ({
  label = '',
  nodeId = '',
  nodeType = '',
  recordId = '',
  recordModel = '',
} = {}) => ({
  nodeType,
  nodeId: normalizeText(nodeId),
  recordId: normalizeText(recordId),
  recordModel: normalizeText(recordModel),
  label: normalizeText(label),
})

const buildWorkspaceSessionNode = (session = {}) => buildRuntimeGraphNode({
  nodeType: RUNTIME_GRAPH_NODE_TYPES.WORKSPACE_SESSION,
  nodeId: session.sessionId,
  recordId: toIdString(session._id || session.id),
  recordModel: 'OutcomeSession',
  label: 'Outcome Studio Session',
})

const buildTruthSignatureNode = (truthSignature = {}) => buildRuntimeGraphNode({
  nodeType: RUNTIME_GRAPH_NODE_TYPES.TRUTH_SIGNATURE,
  nodeId: truthSignature.truthSignatureId,
  recordId: truthSignature.truthSignatureId,
  recordModel: 'TruthSignature',
  label: 'Certified Runtime Truth Signature',
})

const buildKnowledgePackNode = (pack = {}) => buildRuntimeGraphNode({
  nodeType: RUNTIME_GRAPH_NODE_TYPES.KNOWLEDGE_PACK,
  nodeId: pack.packKey,
  recordId: pack.packKey,
  recordModel: 'KnowledgePack',
  label: pack.label || pack.packType || 'Knowledge Pack',
})

const buildWorkspaceAssetNode = (asset = {}) => buildRuntimeGraphNode({
  nodeType: RUNTIME_GRAPH_NODE_TYPES.WORKSPACE_ASSET,
  nodeId: asset.outcomeAssetId,
  recordId: toIdString(asset._id || asset.id),
  recordModel: 'OutcomeAsset',
  label: asset.title || asset.outputTypeLabel || 'Outcome Asset',
})

const buildWorkspaceAssetVersionNode = (version = {}) => buildRuntimeGraphNode({
  nodeType: RUNTIME_GRAPH_NODE_TYPES.WORKSPACE_ASSET_VERSION,
  nodeId: version.outcomeAssetVersionId,
  recordId: toIdString(version._id || version.id),
  recordModel: 'OutcomeAssetVersion',
  label: version.title || version.outputTypeLabel || 'Outcome Asset Version',
})

const buildSessionRuntimeGraphRelationships = ({
  actorUserId,
  knowledgePackBinding = {},
  runtimeScope = {},
  session = {},
  truthSignature = {},
} = {}) => {
  const graphScope = buildRuntimeGraphScope(runtimeScope)
  const sessionNode = buildWorkspaceSessionNode(session)
  const safeTruthSignature = sanitizePersistedTruthSignature(truthSignature)
  const activePacks = Array.isArray(knowledgePackBinding.activePacks)
    ? knowledgePackBinding.activePacks
    : []

  return [
    {
      ...graphScope,
      createdBy: actorUserId,
      relationshipType: RUNTIME_GRAPH_RELATIONSHIP_TYPES.SESSION_BOUND_TO_TRUTH,
      sourceNode: sessionNode,
      targetNode: buildTruthSignatureNode(safeTruthSignature),
      evidence: {
        sessionId: session.sessionId,
        truthSignatureId: safeTruthSignature.truthSignatureId,
        truthSignatureStatus: safeTruthSignature.status,
        truthSignatureCurrentness: safeTruthSignature.currentness,
        evidence: safeTruthSignature.evidence,
      },
    },
    ...activePacks.map((pack) => ({
      ...graphScope,
      createdBy: actorUserId,
      relationshipType: RUNTIME_GRAPH_RELATIONSHIP_TYPES.SESSION_BOUND_TO_PACK,
      sourceNode: sessionNode,
      targetNode: buildKnowledgePackNode(pack),
      evidence: {
        sessionId: session.sessionId,
        packCategory: pack.packCategory,
        packType: pack.packType,
        packKey: pack.packKey,
        semanticVersion: pack.semanticVersion,
        contentHash: pack.contentHash,
        bindingStatus: knowledgePackBinding.status,
        boundAt: knowledgePackBinding.boundAt,
      },
    })),
  ]
}

const buildGeneratedAssetRuntimeGraphRelationships = ({
  actorUserId,
  asset = {},
  runtimeScope = {},
  session = {},
  version = {},
} = {}) => {
  const graphScope = buildRuntimeGraphScope(runtimeScope)
  const assetNode = buildWorkspaceAssetNode(asset)
  const safeTruthSignature = sanitizePersistedTruthSignature(asset.truthSignature || {})

  return [
    {
      ...graphScope,
      createdBy: actorUserId,
      relationshipType: RUNTIME_GRAPH_RELATIONSHIP_TYPES.ASSET_DERIVED_FROM_TRUTH,
      sourceNode: buildTruthSignatureNode(safeTruthSignature),
      targetNode: assetNode,
      evidence: {
        sessionId: asset.sessionId,
        outcomeAssetId: asset.outcomeAssetId,
        outcomeAssetVersionId: version.outcomeAssetVersionId,
        truthSignatureId: safeTruthSignature.truthSignatureId,
        truthSignatureStatus: safeTruthSignature.status,
        truthSignatureCurrentness: safeTruthSignature.currentness,
        evidence: safeTruthSignature.evidence,
      },
    },
    {
      ...graphScope,
      createdBy: actorUserId,
      relationshipType: RUNTIME_GRAPH_RELATIONSHIP_TYPES.ASSET_DERIVED_FROM_SESSION,
      sourceNode: buildWorkspaceSessionNode(session),
      targetNode: assetNode,
      evidence: {
        sessionId: asset.sessionId,
        outcomeAssetId: asset.outcomeAssetId,
        outcomeAssetVersionId: version.outcomeAssetVersionId,
        sourceOutputAssetId: asset.sourceOutputAssetId,
        outputTypeKey: asset.outputTypeKey,
        versionNumber: version.versionNumber,
      },
    },
  ]
}

const buildPublishedAssetRuntimeGraphRelationships = ({
  actorUserId,
  asset = {},
  runtimeScope = {},
  version = {},
} = {}) => ([
  {
    ...buildRuntimeGraphScope(runtimeScope),
    createdBy: actorUserId,
    relationshipType: RUNTIME_GRAPH_RELATIONSHIP_TYPES.ASSET_PUBLISHED_FROM_VERSION,
    sourceNode: buildWorkspaceAssetVersionNode(version),
    targetNode: buildWorkspaceAssetNode(asset),
    evidence: {
      outcomeAssetId: asset.outcomeAssetId,
      outcomeAssetVersionId: version.outcomeAssetVersionId,
      previousStatus: asset.previousStatus || asset.status,
      publishedAt: asset.publishedAt,
      truthSignatureId: version.truthSignature?.truthSignatureId || asset.truthSignature?.truthSignatureId,
      truthSignatureCurrentness: version.truthSignature?.currentness || asset.truthSignature?.currentness,
    },
  },
])

const serializeOutcomeSession = (session, options = {}) => {
  const plain = toPlainObject(session)
  const sourceOutput = sanitizePersistedSourceOutput(plain.sourceOutputSnapshot || {})
  const truthSignature = sanitizePersistedTruthSignature(plain.truthSignature || {}, options)
  const knowledgePackBinding = sanitizePersistedKnowledgePackBinding(plain.knowledgePackBinding || {})
  return {
    sessionId: normalizeText(plain.sessionId),
    contractVersion: normalizeText(plain.contractVersion || OUTCOME_STUDIO_CONTRACT_VERSION),
    phase: normalizeText(plain.phase || OUTCOME_STUDIO_PHASE),
    status: normalizeToken(plain.status || OUTCOME_STUDIO_SESSION_STATUSES.ACTIVE),
    runtimeInstanceId: toIdString(plain.runtimeInstanceId),
    runtimeInstanceKey: normalizeText(plain.runtimeInstanceKey),
    runtimeType: normalizeToken(plain.runtimeType),
    frameworkKey: normalizeToken(plain.frameworkKey),
    packageKey: normalizeText(plain.packageKey),
    packageVersion: normalizeText(plain.packageVersion),
    projectId: normalizeText(plain.projectId),
    outcomeId: normalizeText(plain.outcomeId),
    sourceOutputAssetId: normalizeText(plain.sourceOutputAssetId),
    truthSignatureId: normalizeText(plain.truthSignatureId || truthSignature.truthSignatureId),
    sourceOutputTypeKey: normalizeToken(plain.sourceOutputTypeKey),
    sourceOutputTypeLabel: normalizeText(plain.sourceOutputTypeLabel),
    sourceOutput,
    truthSignature,
    knowledgePackBinding,
    prompt: normalizeText(plain.prompt),
    startedBy: toIdString(plain.startedBy),
    startedAt: normalizeDateValue(plain.startedAt),
    lastActivityAt: normalizeDateValue(plain.lastActivityAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
  }
}

const serializeOutcomeSessionSummary = (session, options = {}) => {
  const serialized = serializeOutcomeSession(session, options)
  return {
    sessionId: serialized.sessionId,
    status: serialized.status,
    sourceOutputAssetId: serialized.sourceOutputAssetId,
    sourceOutputTypeKey: serialized.sourceOutputTypeKey,
    sourceOutputTypeLabel: serialized.sourceOutputTypeLabel,
    truthSignatureId: serialized.truthSignatureId,
    truthSignature: {
      truthSignatureId: serialized.truthSignature.truthSignatureId,
      status: serialized.truthSignature.status,
      persistence: serialized.truthSignature.persistence,
      currentness: serialized.truthSignature.currentness,
      boundAt: serialized.truthSignature.boundAt,
    },
    knowledgePackBinding: {
      status: serialized.knowledgePackBinding.status,
      mode: serialized.knowledgePackBinding.mode,
      activeCount: serialized.knowledgePackBinding.activeCount,
      requiredCount: serialized.knowledgePackBinding.requiredCount,
      boundAt: serialized.knowledgePackBinding.boundAt,
    },
    prompt: serialized.prompt,
    startedBy: serialized.startedBy,
    startedAt: serialized.startedAt,
    lastActivityAt: serialized.lastActivityAt,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
  }
}

const serializeOutcomeMessage = (message, options = {}) => {
  const plain = toPlainObject(message)
  return {
    messageId: normalizeText(plain.messageId),
    sessionId: normalizeText(plain.sessionId),
    contractVersion: normalizeText(plain.contractVersion || OUTCOME_STUDIO_CONTRACT_VERSION),
    phase: normalizeText(plain.phase || OUTCOME_STUDIO_PHASE),
    role: normalizeToken(plain.role || OUTCOME_STUDIO_MESSAGE_ROLES.USER),
    status: normalizeToken(plain.status || OUTCOME_STUDIO_MESSAGE_STATUSES.SUBMITTED),
    responseStatus: normalizeToken(plain.responseStatus || OUTCOME_STUDIO_RESPONSE_STATUSES.PENDING_RESPONSE),
    runtimeInstanceId: toIdString(plain.runtimeInstanceId),
    runtimeInstanceKey: normalizeText(plain.runtimeInstanceKey),
    runtimeType: normalizeToken(plain.runtimeType),
    frameworkKey: normalizeToken(plain.frameworkKey),
    packageKey: normalizeText(plain.packageKey),
    packageVersion: normalizeText(plain.packageVersion),
    projectId: normalizeText(plain.projectId),
    outcomeId: normalizeText(plain.outcomeId),
    prompt: normalizeText(plain.prompt),
    sourceOutput: sanitizePersistedSourceOutput(plain.sourceOutputSnapshot || {}),
    truthSignature: sanitizePersistedTruthSignature(plain.truthSignature || {}, options),
    knowledgePackBinding: sanitizePersistedKnowledgePackBinding(plain.knowledgePackBinding || {}),
    submittedBy: toIdString(plain.submittedBy),
    submittedAt: normalizeDateValue(plain.submittedAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
  }
}

const buildOutcomeAssetLineageSummary = (lineage = {}) => ({
  sourceOutputAssetId: normalizeText(lineage.sourceOutputAssetId),
  sourceOutputTypeKey: normalizeToken(lineage.sourceOutputTypeKey),
  sourceOutputTypeLabel: normalizeText(lineage.sourceOutputTypeLabel),
  truthSignatureStatus: normalizeToken(lineage.truthSignatureStatus),
  truthSignatureCurrentness: normalizeToken(lineage.truthSignatureCurrentness),
  runtimeRevisionId: normalizeText(lineage.runtimeRevisionId),
  runtimeRevisionNumber: Number(lineage.runtimeRevisionNumber || 0),
  parentVersionId: normalizeText(lineage.parentVersionId),
  generatedAt: normalizeDateValue(lineage.generatedAt),
})

const serializeOutcomeAssetVersion = (version, options = {}) => {
  const plain = toPlainObject(version)
  const customerContent = plain.customerContent && typeof plain.customerContent === 'object'
    ? plain.customerContent
    : {}
  const truthSignature = sanitizePersistedTruthSignature(plain.truthSignature || {}, options)
  const lineageSummary = {
    ...buildOutcomeAssetLineageSummary(plain.lineageSummary || {}),
    truthSignatureCurrentness: truthSignature.currentness,
  }
  return {
    outcomeAssetVersionId: normalizeText(plain.outcomeAssetVersionId),
    outcomeAssetId: normalizeText(plain.outcomeAssetId),
    parentVersionId: normalizeText(plain.parentVersionId),
    sessionId: normalizeText(plain.sessionId),
    contractVersion: normalizeText(plain.contractVersion || OUTCOME_STUDIO_CONTRACT_VERSION),
    phase: normalizeText(plain.phase || OUTCOME_STUDIO_PHASE),
    versionNumber: Number(plain.versionNumber || 0),
    status: normalizeToken(plain.status || 'UNKNOWN'),
    runtimeInstanceId: toIdString(plain.runtimeInstanceId),
    runtimeInstanceKey: normalizeText(plain.runtimeInstanceKey),
    runtimeType: normalizeToken(plain.runtimeType),
    frameworkKey: normalizeToken(plain.frameworkKey),
    packageKey: normalizeText(plain.packageKey),
    packageVersion: normalizeText(plain.packageVersion),
    projectId: normalizeText(plain.projectId),
    outcomeId: normalizeText(plain.outcomeId),
    outputTypeKey: normalizeToken(plain.outputTypeKey),
    outputTypeLabel: normalizeText(plain.outputTypeLabel),
    title: normalizeText(plain.title),
    sourceOutputAssetId: normalizeText(plain.sourceOutputAssetId),
    sourceOutput: sanitizePersistedSourceOutput(plain.sourceOutputSnapshot || {}),
    truthSignature,
    knowledgePackBinding: sanitizePersistedKnowledgePackBinding(plain.knowledgePackBinding || {}),
    lineageSummary,
    contentAvailable: Object.keys(customerContent).length > 0,
    warnings: Array.isArray(plain.warnings) ? plain.warnings.map(normalizeText).filter(Boolean) : [],
    limitations: Array.isArray(plain.limitations) ? plain.limitations.map(normalizeText).filter(Boolean) : [],
    generatedBy: toIdString(plain.generatedBy),
    generatedAt: normalizeDateValue(plain.generatedAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
  }
}

const serializeOutcomeAsset = (asset, options = {}) => {
  const plain = toPlainObject(asset)
  const truthSignature = sanitizePersistedTruthSignature(plain.truthSignature || {}, options)
  const lineageSummary = {
    ...buildOutcomeAssetLineageSummary(plain.lineageSummary || {}),
    truthSignatureCurrentness: truthSignature.currentness,
  }
  return {
    outcomeAssetId: normalizeText(plain.outcomeAssetId),
    sessionId: normalizeText(plain.sessionId),
    contractVersion: normalizeText(plain.contractVersion || OUTCOME_STUDIO_CONTRACT_VERSION),
    phase: normalizeText(plain.phase || OUTCOME_STUDIO_PHASE),
    status: normalizeToken(plain.status || 'UNKNOWN'),
    runtimeInstanceId: toIdString(plain.runtimeInstanceId),
    runtimeInstanceKey: normalizeText(plain.runtimeInstanceKey),
    runtimeType: normalizeToken(plain.runtimeType),
    frameworkKey: normalizeToken(plain.frameworkKey),
    packageKey: normalizeText(plain.packageKey),
    packageVersion: normalizeText(plain.packageVersion),
    projectId: normalizeText(plain.projectId),
    outcomeId: normalizeText(plain.outcomeId),
    outputTypeKey: normalizeToken(plain.outputTypeKey),
    outputTypeLabel: normalizeText(plain.outputTypeLabel),
    title: normalizeText(plain.title),
    sourceOutputAssetId: normalizeText(plain.sourceOutputAssetId),
    currentVersionId: normalizeText(plain.currentVersionId),
    currentVersionNumber: Number(plain.currentVersionNumber || 0),
    sourceOutput: sanitizePersistedSourceOutput(plain.sourceOutputSnapshot || {}),
    truthSignature,
    knowledgePackBinding: sanitizePersistedKnowledgePackBinding(plain.knowledgePackBinding || {}),
    lineageSummary,
    warnings: Array.isArray(plain.warnings) ? plain.warnings.map(normalizeText).filter(Boolean) : [],
    limitations: Array.isArray(plain.limitations) ? plain.limitations.map(normalizeText).filter(Boolean) : [],
    generatedBy: toIdString(plain.generatedBy),
    generatedAt: normalizeDateValue(plain.generatedAt),
    publishedBy: toIdString(plain.publishedBy),
    publishedAt: normalizeDateValue(plain.publishedAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
  }
}

const serializeOutcomeAssetSummary = (asset, options = {}) => {
  const serialized = serializeOutcomeAsset(asset, options)
  return {
    outcomeAssetId: serialized.outcomeAssetId,
    sessionId: serialized.sessionId,
    status: serialized.status,
    outputTypeKey: serialized.outputTypeKey,
    outputTypeLabel: serialized.outputTypeLabel,
    title: serialized.title,
    sourceOutputAssetId: serialized.sourceOutputAssetId,
    currentVersionId: serialized.currentVersionId,
    currentVersionNumber: serialized.currentVersionNumber,
    truthSignature: {
      status: serialized.truthSignature.status,
      persistence: serialized.truthSignature.persistence,
      currentness: serialized.truthSignature.currentness,
      boundAt: serialized.truthSignature.boundAt,
    },
    knowledgePackBinding: {
      status: serialized.knowledgePackBinding.status,
      mode: serialized.knowledgePackBinding.mode,
      activeCount: serialized.knowledgePackBinding.activeCount,
      requiredCount: serialized.knowledgePackBinding.requiredCount,
      boundAt: serialized.knowledgePackBinding.boundAt,
    },
    lineageSummary: serialized.lineageSummary,
    warnings: serialized.warnings,
    limitations: serialized.limitations,
    generatedAt: serialized.generatedAt,
    publishedAt: serialized.publishedAt,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
  }
}

const getOutcomeAssetExportFilename = ({ asset = {}, format }) => {
  const runtimeKey = normalizeFilenamePart(asset.runtimeInstanceKey || asset.runtimeInstanceId, 'runtime')
  const label = normalizeFilenamePart(asset.title || asset.outputTypeLabel || asset.outputTypeKey, 'outcome-asset')
  const extensionByFormat = {
    [OUTCOME_STUDIO_EXPORT_FORMATS.JSON]: 'json',
    [OUTCOME_STUDIO_EXPORT_FORMATS.DOCX]: 'docx',
    [OUTCOME_STUDIO_EXPORT_FORMATS.PDF]: 'pdf',
  }
  const extension = extensionByFormat[format] || 'md'
  return `${runtimeKey}-${label}.${extension}`
}

const renderOutcomeStudioMarkdownExport = ({
  asset = {},
  content = '',
  version = {},
} = {}) => {
  const lines = [
    `# ${asset.title || asset.outputTypeLabel || 'Outcome Studio Asset'}`,
    '',
    content,
    '',
    '## Lineage Summary',
    '',
    `- Outcome Asset ID: ${asset.outcomeAssetId || 'Not recorded'}`,
    `- Outcome Asset Version ID: ${version.outcomeAssetVersionId || 'Not recorded'}`,
    `- Runtime Instance: ${asset.runtimeInstanceKey || asset.runtimeInstanceId || 'Not recorded'}`,
    `- Source Output Asset ID: ${asset.sourceOutputAssetId || 'Not recorded'}`,
    `- Truth Signature ID: ${asset.truthSignature?.truthSignatureId || 'Not recorded'}`,
    `- Truth Currentness: ${asset.truthSignature?.currentness || 'UNKNOWN'}`,
    '',
    '## Warnings',
    '',
    ...(asset.warnings?.length ? asset.warnings.map((warning) => `- ${warning}`) : ['- No warnings recorded.']),
    '',
    '## Limitations',
    '',
    ...(asset.limitations?.length ? asset.limitations.map((limitation) => `- ${limitation}`) : ['- No limitations recorded.']),
  ]

  return lines.join('\n')
}

const stripMarkdownSyntax = (value = '') =>
  normalizeText(value)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '- ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')

const escapeXmlText = (value = '') =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const escapePdfText = (value = '') =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')

const chunkExportTextLines = (value = '', maxLineLength = 92) => {
  const sourceLines = stripMarkdownSyntax(value)
    .split(/\r?\n/)
    .flatMap((line) => {
      const normalized = line.trim()
      if (!normalized) return ['']
      const words = normalized.split(/\s+/)
      const wrapped = []
      let current = ''
      words.forEach((word) => {
        const next = current ? `${current} ${word}` : word
        if (next.length > maxLineLength && current) {
          wrapped.push(current)
          current = word
          return
        }
        current = next
      })
      if (current) wrapped.push(current)
      return wrapped
    })
  return sourceLines.length ? sourceLines : ['']
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

const crc32 = (buffer) => {
  let value = 0xffffffff
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

const buildZipArchive = (files = []) => {
  const localParts = []
  const centralParts = []
  let offset = 0

  files.forEach(({ name, content }) => {
    const nameBuffer = Buffer.from(name)
    const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8')
    const checksum = crc32(contentBuffer)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(contentBuffer.length, 18)
    localHeader.writeUInt32LE(contentBuffer.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, nameBuffer, contentBuffer)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(contentBuffer.length, 20)
    centralHeader.writeUInt32LE(contentBuffer.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBuffer)

    offset += localHeader.length + nameBuffer.length + contentBuffer.length
  })

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, end])
}

const renderOutcomeStudioDocxExport = ({ markdown = '' } = {}) => {
  const paragraphXml = chunkExportTextLines(markdown)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r></w:p>`)
    .join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
  return buildZipArchive([
    {
      name: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: 'word/document.xml',
      content: documentXml,
    },
  ])
}

const renderOutcomeStudioPdfExport = ({ markdown = '' } = {}) => {
  const lines = chunkExportTextLines(markdown, 88)
  const pages = []
  for (let index = 0; index < lines.length; index += 44) {
    pages.push(lines.slice(index, index + 44))
  }
  const objects = []
  const addObject = (body) => {
    objects.push(body)
    return objects.length
  }
  const catalogRef = addObject('<< /Type /Catalog /Pages 2 0 R >>')
  const pagesRef = addObject('')
  const fontRef = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageRefs = []

  pages.forEach((pageLines) => {
    const streamText = [
      'BT',
      '/F1 10 Tf',
      '50 760 Td',
      '14 TL',
      ...pageLines.map((line, index) => `${index === 0 ? '' : 'T* '}(${escapePdfText(line)}) Tj`),
      'ET',
    ].join('\n')
    const streamRef = addObject(`<< /Length ${Buffer.byteLength(streamText)} >>\nstream\n${streamText}\nendstream`)
    const pageRef = addObject(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${streamRef} 0 R >>`)
    pageRefs.push(pageRef)
  })

  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`
  objects[catalogRef - 1] = '<< /Type /Catalog /Pages 2 0 R >>'

  const parts = ['%PDF-1.4\n']
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(parts.join('')))
    parts.push(`${index + 1} 0 obj\n${body}\nendobj\n`)
  })
  const xrefOffset = Buffer.byteLength(parts.join(''))
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  offsets.slice(1).forEach((offset) => {
    parts.push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  })
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)
  return Buffer.from(parts.join(''), 'utf8')
}

const buildOutcomeAssetJsonExport = ({
  asset = {},
  content = {},
  version = {},
} = {}) => ({
  outcomeAssetId: asset.outcomeAssetId,
  outcomeAssetVersionId: version.outcomeAssetVersionId,
  sessionId: asset.sessionId,
  status: asset.status,
  outputTypeKey: asset.outputTypeKey,
  outputTypeLabel: asset.outputTypeLabel,
  title: asset.title,
  runtimeInstanceId: asset.runtimeInstanceId,
  runtimeInstanceKey: asset.runtimeInstanceKey,
  sourceOutputAssetId: asset.sourceOutputAssetId,
  versionNumber: version.versionNumber,
  customerContent: content,
  warnings: asset.warnings,
  limitations: asset.limitations,
  lineageSummary: asset.lineageSummary,
  truthSignature: {
    truthSignatureId: asset.truthSignature?.truthSignatureId,
    status: asset.truthSignature?.status,
    persistence: asset.truthSignature?.persistence,
    currentness: asset.truthSignature?.currentness,
    boundAt: asset.truthSignature?.boundAt,
    missingEvidence: asset.truthSignature?.missingEvidence,
  },
  knowledgePackBinding: {
    status: asset.knowledgePackBinding?.status,
    mode: asset.knowledgePackBinding?.mode,
    activeCount: asset.knowledgePackBinding?.activeCount,
    requiredCount: asset.knowledgePackBinding?.requiredCount,
    boundAt: asset.knowledgePackBinding?.boundAt,
  },
  generatedAt: asset.generatedAt,
  exportedAt: new Date().toISOString(),
})

const listOutcomeMessagesForSession = async ({
  currentEvidence = null,
  runtimeInstanceId,
  sessionId,
}) => {
  const messages = await OutcomeMessage.find({
    runtimeInstanceId,
    sessionId: normalizeText(sessionId),
  })
    .sort({ createdAt: 1 })
    .limit(OUTCOME_STUDIO_MESSAGE_LIST_LIMIT)
    .lean()
  return messages.map((message) => serializeOutcomeMessage(message, { currentEvidence }))
}

const findOutcomeMessageForRuntime = async ({
  detailsRuntimeInstanceId,
  messageId,
  runtimeInstanceId,
  sessionId,
}) => {
  const query = OutcomeMessage.findOne({
    runtimeInstanceId,
    sessionId: normalizeText(sessionId),
    messageId: normalizeText(messageId),
  })
  const message = typeof query?.lean === 'function' ? await query.lean() : await query

  if (!message) {
    throw createOutcomeStudioError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio message not found.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_MESSAGE_NOT_FOUND,
      details: {
        runtimeInstanceId: detailsRuntimeInstanceId || runtimeInstanceId,
        sessionId: normalizeText(sessionId),
        messageId: normalizeText(messageId),
      },
    })
  }

  return message
}

const listOutcomeAssetsForRuntime = async ({
  currentEvidence = null,
  runtimeInstanceId,
  sessionId = '',
} = {}) => {
  const filter = { runtimeInstanceId }
  const normalizedSessionId = normalizeText(sessionId)
  if (normalizedSessionId) filter.sessionId = normalizedSessionId

  const assets = await OutcomeAsset.find(filter)
    .sort({ createdAt: -1 })
    .limit(OUTCOME_STUDIO_ASSET_LIST_LIMIT)
    .lean()
  return assets.map((asset) => serializeOutcomeAssetSummary(asset, { currentEvidence }))
}

const listOutcomeAssetVersionsForAsset = async ({
  currentEvidence = null,
  outcomeAssetId,
  runtimeInstanceId,
} = {}) => {
  const versions = await OutcomeAssetVersion.find({
    runtimeInstanceId,
    outcomeAssetId: normalizeText(outcomeAssetId),
  })
    .sort({ versionNumber: -1 })
    .limit(OUTCOME_STUDIO_ASSET_VERSION_LIST_LIMIT)
    .lean()
  return versions.map((version) => serializeOutcomeAssetVersion(version, { currentEvidence }))
}

const findCurrentOutcomeAssetVersion = async ({
  actionLabel = 'preview',
  asset = {},
  availabilityKey = 'previewAvailable',
  missingReason = OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_PREVIEW_CONTENT_UNAVAILABLE,
  runtimeInstanceId,
  safetyGateCode = OUTCOME_STUDIO_SAFETY_GATE_CODES.EXPORT_RENDERER,
} = {}) => {
  const filter = {
    runtimeInstanceId,
    outcomeAssetId: normalizeText(asset.outcomeAssetId),
  }
  const currentVersionId = normalizeText(asset.currentVersionId)
  if (currentVersionId) {
    filter.outcomeAssetVersionId = currentVersionId
  }

  const query = OutcomeAssetVersion.findOne(filter)
  const version = typeof query?.lean === 'function' ? await query.lean() : await query
  if (version) return version

  throw createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: `Outcome Studio asset ${actionLabel} requires a persisted current asset version.`,
    reason: missingReason,
    details: {
      outcomeAssetId: normalizeText(asset.outcomeAssetId),
      currentVersionId,
      [availabilityKey]: false,
      blockerReason: 'OUTCOME_ASSET_CURRENT_VERSION_NOT_FOUND',
      safetyGate: {
        code: safetyGateCode,
        status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
      },
    },
  })
}

const getOutcomeAssetVersionCustomerContent = ({
  format,
  outcomeAssetId,
  version = {},
} = {}) => {
  const customerContent = version.customerContent && typeof version.customerContent === 'object'
    ? cloneValue(version.customerContent)
    : {}

  if (format === OUTCOME_STUDIO_EXPORT_FORMATS.MARKDOWN) {
    const markdown = normalizeText(customerContent.markdown)
    if (markdown) return { customerContent, markdown }
  } else if (Object.keys(customerContent).length > 0) {
    return { customerContent, markdown: normalizeText(customerContent.markdown) }
  }

  throw createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: 'Outcome Studio asset export requires persisted customer content for the requested format.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_CONTENT_UNAVAILABLE,
    details: {
      outcomeAssetId: normalizeText(outcomeAssetId),
      outcomeAssetVersionId: normalizeText(version.outcomeAssetVersionId),
      format,
      exportAvailable: false,
      blockerReason: format === OUTCOME_STUDIO_EXPORT_FORMATS.MARKDOWN
        ? 'OUTCOME_ASSET_MARKDOWN_CONTENT_NOT_AVAILABLE'
        : 'OUTCOME_ASSET_CUSTOMER_CONTENT_NOT_AVAILABLE',
      safetyGate: {
        code: OUTCOME_STUDIO_SAFETY_GATE_CODES.EXPORT_RENDERER,
        status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
      },
    },
  })
}

const getOutcomeAssetVersionPreviewContent = ({
  outcomeAssetId,
  version = {},
} = {}) => {
  const customerContent = version.customerContent && typeof version.customerContent === 'object'
    ? cloneValue(version.customerContent)
    : {}
  const markdown = normalizeText(customerContent.markdown)
  const sections = Array.isArray(customerContent.sections)
    ? customerContent.sections
        .map((section, index) => ({
          key: normalizeText(section?.key) || `section-${index + 1}`,
          label: normalizeText(section?.label || section?.heading) || `Section ${index + 1}`,
          body: normalizeText(section?.body),
        }))
        .filter((section) => section.label || section.body)
    : []

  if (markdown || sections.length > 0) {
    return {
      markdown,
      sections,
    }
  }

  throw createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: 'Outcome Studio asset preview requires persisted customer content.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_PREVIEW_CONTENT_UNAVAILABLE,
    details: {
      outcomeAssetId: normalizeText(outcomeAssetId),
      outcomeAssetVersionId: normalizeText(version.outcomeAssetVersionId),
      previewAvailable: false,
      blockerReason: 'OUTCOME_ASSET_CUSTOMER_CONTENT_NOT_AVAILABLE',
      safetyGate: {
        code: OUTCOME_STUDIO_SAFETY_GATE_CODES.EXPORT_RENDERER,
        status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
      },
    },
  })
}

const assertOutcomeAssetCurrentTruth = ({
  actionLabel = 'preview',
  asset = {},
  availabilityKey = 'previewAvailable',
  reason = OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_PREVIEW_BLOCKED,
  safetyGateCode = OUTCOME_STUDIO_SAFETY_GATE_CODES.EXPORT_RENDERER,
  version = {},
} = {}) => {
  const assetCurrentness = normalizeToken(asset.truthSignature?.currentness)
  const versionCurrentness = normalizeToken(version.truthSignature?.currentness)
  if (assetCurrentness === 'CURRENT' && versionCurrentness === 'CURRENT') return

  throw createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: `Outcome Studio asset ${actionLabel} requires current certified runtime truth.`,
    reason,
    details: {
      outcomeAssetId: normalizeText(asset.outcomeAssetId),
      outcomeAssetVersionId: normalizeText(version.outcomeAssetVersionId),
      [availabilityKey]: false,
      blockerReason: 'OUTCOME_ASSET_TRUTH_NOT_CURRENT',
      truthSignatureCurrentness: assetCurrentness || 'UNKNOWN',
      versionTruthSignatureCurrentness: versionCurrentness || 'UNKNOWN',
      safetyGate: {
        code: safetyGateCode,
        status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
      },
    },
  })
}

const assertOutcomeSessionTruthCurrent = ({
  actionLabel = 'session action',
  availabilityKey = 'sessionActionAvailable',
  session = {},
} = {}) => {
  const truthCurrentness = normalizeToken(session.truthSignature?.currentness)
  if (truthCurrentness === 'CURRENT') return

  throw createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: `Outcome Studio ${actionLabel} is blocked until the session Truth Signature is current.`,
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
    details: {
      sessionId: normalizeText(session.sessionId),
      truthSignatureId: normalizeText(session.truthSignatureId || session.truthSignature?.truthSignatureId),
      truthSignatureCurrentness: truthCurrentness || 'UNKNOWN',
      [availabilityKey]: false,
      blockerReason: 'OUTCOME_SESSION_TRUTH_NOT_CURRENT',
      safetyGate: {
        code: OUTCOME_STUDIO_SAFETY_GATE_CODES.TRUTH_SIGNATURE_BOUND,
        status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
      },
    },
  })
}

const findOutcomeAssetForRuntime = async ({
  detailsRuntimeInstanceId,
  outcomeAssetId,
  runtimeInstanceId,
}) => {
  const query = OutcomeAsset.findOne({
    runtimeInstanceId,
    outcomeAssetId: normalizeText(outcomeAssetId),
  })
  const asset = typeof query?.lean === 'function' ? await query.lean() : await query

  if (!asset) {
    throw createOutcomeStudioError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio asset not found.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_NOT_FOUND,
      details: {
        runtimeInstanceId: detailsRuntimeInstanceId || runtimeInstanceId,
        outcomeAssetId: normalizeText(outcomeAssetId),
      },
    })
  }

  return asset
}

const findOutcomeAssetVersionForRuntime = async ({
  detailsRuntimeInstanceId,
  outcomeAssetId,
  outcomeAssetVersionId,
  runtimeInstanceId,
}) => {
  const query = OutcomeAssetVersion.findOne({
    runtimeInstanceId,
    outcomeAssetId: normalizeText(outcomeAssetId),
    outcomeAssetVersionId: normalizeText(outcomeAssetVersionId),
  })
  const version = typeof query?.lean === 'function' ? await query.lean() : await query

  if (!version) {
    throw createOutcomeStudioError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio asset version not found.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_VERSION_NOT_FOUND,
      details: {
        runtimeInstanceId: detailsRuntimeInstanceId || runtimeInstanceId,
        outcomeAssetId: normalizeText(outcomeAssetId),
        outcomeAssetVersionId: normalizeText(outcomeAssetVersionId),
      },
    })
  }

  return version
}

const logOutcomeSessionAudit = async ({
  action,
  auditRequest,
  dbSession = null,
  diff,
  runtimeInstance,
  session,
  summary,
}) => {
  const runtimeInstanceId = runtimeInstance._id || runtimeInstance.id
  const auditPayload = {
    action,
    actorUserId: diff?.actorUserId,
    resourceType: auditService.RESOURCE_TYPES.OutcomeSession,
    resourceId: session._id || session.id,
    scope: {
      customerId: runtimeInstance.customerId,
      tenantId: runtimeInstance.tenantId,
      runtimeInstanceId,
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
      outcomeSessionId: session.sessionId,
    },
    summary,
    diff,
  }
  const options = {
    throwOnError: true,
    ...(dbSession ? { session: dbSession } : {}),
  }
  if (auditRequest) {
    await auditService.logFromRequest(auditRequest, auditPayload, options)
    return
  }
  await auditService.log(auditPayload, options)
}

const logOutcomeMessageAudit = async ({
  action = auditService.AUDIT_ACTIONS.PROMPT_SUBMITTED,
  auditRequest,
  dbSession = null,
  diff,
  message,
  runtimeInstance,
  summary,
}) => {
  const runtimeInstanceId = runtimeInstance._id || runtimeInstance.id
  const auditPayload = {
    action,
    actorUserId: diff?.actorUserId,
    resourceType: auditService.RESOURCE_TYPES.OutcomeMessage,
    resourceId: message._id || message.id,
    scope: {
      customerId: runtimeInstance.customerId,
      tenantId: runtimeInstance.tenantId,
      runtimeInstanceId,
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
      outcomeSessionId: message.sessionId,
      outcomeMessageId: message.messageId,
    },
    summary,
    diff,
  }
  const options = {
    throwOnError: true,
    ...(dbSession ? { session: dbSession } : {}),
  }
  if (auditRequest) {
    await auditService.logFromRequest(auditRequest, auditPayload, options)
    return
  }
  await auditService.log(auditPayload, options)
}

const logOutcomeAssetExportAudit = async ({
  auditRequest,
  asset,
  dbSession = null,
  diff,
  runtimeInstance,
  summary,
}) => {
  const runtimeInstanceId = runtimeInstance._id || runtimeInstance.id
  const auditPayload = {
    action: auditService.AUDIT_ACTIONS.ASSET_EXPORTED,
    actorUserId: diff?.actorUserId,
    resourceType: auditService.RESOURCE_TYPES.OutcomeAsset,
    resourceId: asset._id || asset.id,
    scope: {
      customerId: runtimeInstance.customerId,
      tenantId: runtimeInstance.tenantId,
      runtimeInstanceId,
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
      outcomeAssetId: asset.outcomeAssetId,
      outcomeAssetVersionId: diff?.outcomeAssetVersionId,
    },
    summary,
    diff,
  }
  const options = {
    throwOnError: true,
    ...(dbSession ? { session: dbSession } : {}),
  }
  if (auditRequest) {
    await auditService.logFromRequest(auditRequest, auditPayload, options)
    return
  }
  await auditService.log(auditPayload, options)
}

const logOutcomeAssetPublishedAudit = async ({
  auditRequest,
  asset,
  dbSession = null,
  diff,
  runtimeInstance,
  summary,
}) => {
  const runtimeInstanceId = runtimeInstance._id || runtimeInstance.id
  const auditPayload = {
    action: auditService.AUDIT_ACTIONS.ASSET_PUBLISHED,
    actorUserId: diff?.actorUserId,
    resourceType: auditService.RESOURCE_TYPES.OutcomeAsset,
    resourceId: asset._id || asset.id,
    scope: {
      customerId: runtimeInstance.customerId,
      tenantId: runtimeInstance.tenantId,
      runtimeInstanceId,
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
      outcomeSessionId: asset.sessionId,
      outcomeAssetId: asset.outcomeAssetId,
      outcomeAssetVersionId: diff?.outcomeAssetVersionId,
    },
    summary,
    diff,
  }
  const options = {
    throwOnError: true,
    ...(dbSession ? { session: dbSession } : {}),
  }
  if (auditRequest) {
    await auditService.logFromRequest(auditRequest, auditPayload, options)
    return
  }
  await auditService.log(auditPayload, options)
}

const logOutcomeAssetGeneratedAudit = async ({
  auditRequest,
  asset,
  dbSession = null,
  diff,
  runtimeInstance,
  summary,
}) => {
  const runtimeInstanceId = runtimeInstance._id || runtimeInstance.id
  const auditPayload = {
    action: auditService.AUDIT_ACTIONS.ASSET_GENERATED,
    actorUserId: diff?.actorUserId,
    resourceType: auditService.RESOURCE_TYPES.OutcomeAsset,
    resourceId: asset._id || asset.id,
    scope: {
      customerId: runtimeInstance.customerId,
      tenantId: runtimeInstance.tenantId,
      runtimeInstanceId,
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
      outcomeSessionId: asset.sessionId,
      outcomeAssetId: asset.outcomeAssetId,
      outcomeAssetVersionId: diff?.outcomeAssetVersionId,
    },
    summary,
    diff,
  }
  const options = {
    throwOnError: true,
    ...(dbSession ? { session: dbSession } : {}),
  }
  if (auditRequest) {
    await auditService.logFromRequest(auditRequest, auditPayload, options)
    return
  }
  await auditService.log(auditPayload, options)
}

const failAuditClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_SESSION_AUDIT_FAILED',
    message: 'Outcome Studio session audit could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_AUDIT_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

const failMessageAuditClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_MESSAGE_AUDIT_FAILED',
    message: 'Outcome Studio message audit could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_MESSAGE_AUDIT_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

const failExportAuditClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_ASSET_EXPORT_AUDIT_FAILED',
    message: 'Outcome Studio asset export audit could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_AUDIT_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

const failAssetGenerationAuditClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_ASSET_GENERATION_AUDIT_FAILED',
    message: 'Outcome Studio asset generation audit could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_GENERATION_AUDIT_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

const failAssetPublishAuditClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_ASSET_PUBLISH_AUDIT_FAILED',
    message: 'Outcome Studio asset publish audit could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_PUBLISH_AUDIT_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

const failGraphRelationshipClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_GRAPH_RELATIONSHIP_FAILED',
    message: 'Outcome Studio runtime graph relationship could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_GRAPH_RELATIONSHIP_FAILED,
    details: {
      graphRelationshipError: {
        message: err?.message || 'Runtime graph relationship persistence failed.',
      },
      ...details,
    },
  })

const failTruthDriftAuditClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_TRUTH_DRIFT_AUDIT_FAILED',
    message: 'Outcome Studio truth drift audit could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_TRUTH_DRIFT_AUDIT_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

const failTruthUpdateAuditClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_TRUTH_UPDATE_AUDIT_FAILED',
    message: 'Outcome Studio truth update audit could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_TRUTH_UPDATE_AUDIT_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

const getSourceSnapshot = (asset = {}, readiness = {}) => {
  const sourceSnapshot = asset?.sourceSnapshot && typeof asset.sourceSnapshot === 'object'
    ? asset.sourceSnapshot
    : {}
  const outputEligibility = readiness?.outputEligibility && typeof readiness.outputEligibility === 'object'
    ? readiness.outputEligibility
    : {}
  const graph = readiness?.graph && typeof readiness.graph === 'object'
    ? readiness.graph
    : {}

  return {
    publishSnapshotId: normalizeText(sourceSnapshot.publishSnapshotId || outputEligibility.publishSnapshotId),
    publishSnapshotHash: normalizeText(sourceSnapshot.publishSnapshotHash || outputEligibility.publishSnapshotHash),
    lockSnapshotId: normalizeText(sourceSnapshot.lockSnapshotId || outputEligibility.lockSnapshotId),
    lockSnapshotHash: normalizeText(sourceSnapshot.lockSnapshotHash || outputEligibility.lockSnapshotHash),
    replayAnchorId: normalizeText(sourceSnapshot.replayAnchorId || outputEligibility.replayAnchorId),
    replayAnchorHash: normalizeText(sourceSnapshot.replayAnchorHash || outputEligibility.replayAnchorHash),
    graphVersion: normalizeText(sourceSnapshot.graphVersion || graph.graphVersion),
    graphHash: normalizeText(sourceSnapshot.graphHash || graph.graphHash),
  }
}

const sanitizeSourceOutputAsset = ({ asset, readiness }) => {
  if (!asset) return null
  return {
    outputAssetId: normalizeText(asset.outputAssetId || asset.id || asset._id),
    outputTypeKey: normalizeToken(asset.outputTypeKey),
    outputTypeLabel: normalizeText(asset.outputTypeLabel),
    status: normalizeToken(asset.status || 'UNKNOWN'),
    stale: asset.stale === true,
    exportable: asset.exportable === true,
    generatedAt: normalizeText(asset.generatedAt),
    publishedAt: normalizeText(asset.publishedAt),
    supportedFormats: Array.isArray(asset.supportedFormats)
      ? asset.supportedFormats.map(normalizeToken).filter(Boolean)
      : [],
    sourceSnapshot: getSourceSnapshot(asset, readiness),
  }
}

const selectSourceOutputAsset = (assets = []) => {
  const eligibleAssets = assets
    .filter((asset) => {
      const status = normalizeToken(asset?.status)
      return asset?.exportable === true
        && asset?.stale !== true
        && [
          OUTPUT_LAB_ASSET_STATUSES.PUBLISHED,
          OUTPUT_LAB_ASSET_STATUSES.GENERATED,
        ].includes(status)
    })
    .sort((left, right) => {
      const leftStatus = normalizeToken(left?.status)
      const rightStatus = normalizeToken(right?.status)
      if (leftStatus === rightStatus) return 0
      if (leftStatus === OUTPUT_LAB_ASSET_STATUSES.PUBLISHED) return -1
      if (rightStatus === OUTPUT_LAB_ASSET_STATUSES.PUBLISHED) return 1
      return 0
    })

  return eligibleAssets[0] || null
}

const buildPackBlockers = (packBinding) =>
  packBinding.requiredPacks
    .filter((pack) => pack.runtimeBindable !== true)
    .map((pack) => {
      const codeByPackType = {
        ARL: OUTCOME_STUDIO_BLOCKER_CODES.ARL_PACK_MISSING,
        RL: OUTCOME_STUDIO_BLOCKER_CODES.RL_PACK_MISSING,
        OUTPUT_SCHEMA: OUTCOME_STUDIO_BLOCKER_CODES.OUTPUT_SCHEMA_PACK_MISSING,
        TRUTH_CERTIFICATION: OUTCOME_STUDIO_BLOCKER_CODES.TRUTH_CERTIFICATION_PACK_MISSING,
        OUTPUT_TYPE_DEFINITION: OUTCOME_STUDIO_BLOCKER_CODES.OUTPUT_TYPE_PACK_MISSING,
      }
      return {
        code: codeByPackType[pack.packType] || OUTCOME_STUDIO_BLOCKER_CODES.KNOWLEDGE_PACK_BINDING_MISSING,
        source: 'KNOWLEDGE_PACK_REGISTRY',
        message: `${pack.label} must be active before Outcome Studio sessions can start.`,
      }
    })

const mapOutputLabBlocker = (blocker) => ({
  code: normalizeToken(blocker?.code || 'OUTPUT_LAB_BLOCKED'),
  source: 'OUTPUT_LAB',
  message: normalizeText(blocker?.message) || 'Output Lab readiness is blocking Outcome Studio.',
})

const buildReadiness = ({
  outputLab,
  packBinding,
  sourceOutput,
}) => {
  const outputLabReadiness = outputLab?.readiness || {}
  const outputLabBlockers = Array.isArray(outputLabReadiness.blockers)
    ? outputLabReadiness.blockers.map(mapOutputLabBlocker)
    : []
  const warnings = Array.isArray(outputLabReadiness.warnings)
    ? outputLabReadiness.warnings.map((warning) => ({
        code: normalizeToken(warning?.code || 'OUTPUT_LAB_WARNING'),
        source: 'OUTPUT_LAB',
        message: normalizeText(warning?.message) || 'Output Lab reported a warning.',
      }))
    : []
  const sourceOutputBlocker = sourceOutput
    ? null
    : {
        code: OUTCOME_STUDIO_BLOCKER_CODES.SOURCE_OUTPUT_MISSING,
        source: 'OUTPUT_LAB',
        message: 'A governed Output Lab source asset is required before Outcome Studio sessions can start.',
      }
  const packBlockers = buildPackBlockers(packBinding)
  const blockers = [
    ...outputLabBlockers,
    ...(sourceOutputBlocker ? [sourceOutputBlocker] : []),
    ...packBlockers,
  ]
  const outputLabCanGenerate = outputLabReadiness.canGenerate === true
  const hasPackBlockers = packBlockers.length > 0
  const summary = !outputLabCanGenerate && outputLabReadiness.summary
    ? normalizeText(outputLabReadiness.summary)
    : !sourceOutput
      ? 'Outcome Studio requires a governed Output Lab source asset before sessions can start.'
      : hasPackBlockers
        ? 'Outcome Studio requires active Outcome Studio knowledge pack bindings before sessions can start.'
        : 'Outcome Studio is ready to start a governed reasoning session.'

  return {
    state: blockers.length > 0
      ? OUTCOME_STUDIO_READINESS_STATES.BLOCKED
      : warnings.length > 0
        ? OUTCOME_STUDIO_READINESS_STATES.READY_WITH_GAPS
        : OUTCOME_STUDIO_READINESS_STATES.READY,
    canStartSession: blockers.length === 0,
    canReason: blockers.length === 0,
    summary,
    blockers,
    warnings,
    outputLab: {
      state: normalizeToken(outputLabReadiness.state || 'UNKNOWN'),
      canGenerate: outputLabCanGenerate,
      summary: normalizeText(outputLabReadiness.summary),
    },
    knowledgePacks: {
      status: packBinding.status,
      mode: packBinding.mode,
      activeCount: Array.isArray(packBinding.activePacks) ? packBinding.activePacks.length : 0,
      requiredCount: Array.isArray(packBinding.requiredPacks) ? packBinding.requiredPacks.length : 0,
      sourceOnlyCount: Array.isArray(packBinding.requiredPacks)
        ? packBinding.requiredPacks.filter((pack) => pack.status === 'SOURCE_ONLY').length
        : 0,
    },
  }
}

const buildTruthBinding = ({
  readiness,
  sourceOutput,
  truthQuality,
}) => {
  const sourceSnapshot = sourceOutput?.sourceSnapshot || {}
  const graph = truthQuality?.graph
    ? {
        graphVersion: normalizeText(truthQuality.graph.graphVersion),
        graphHash: normalizeText(truthQuality.graph.graphHash),
        evaluatedAt: normalizeText(truthQuality.graph.evaluatedAt),
      }
    : {
        graphVersion: normalizeText(readiness?.graph?.graphVersion),
        graphHash: normalizeText(readiness?.graph?.graphHash),
        evaluatedAt: '',
      }
  const certification = truthQuality?.certification ? cloneValue(truthQuality.certification) : null
  const evidence = {
    runtimeInstanceId: normalizeText(truthQuality?.runtimeInstanceId),
    runtimeInstanceKey: normalizeText(truthQuality?.runtimeInstanceKey),
    certificationLevel: normalizeToken(certification?.level),
    certificationLabel: normalizeText(certification?.label),
    qualityBand: normalizeToken(truthQuality?.quality?.qualityBand),
    sourceOutputAssetId: normalizeText(sourceOutput?.outputAssetId),
    sourceOutputTypeKey: normalizeToken(sourceOutput?.outputTypeKey),
    publishSnapshotId: normalizeText(sourceSnapshot.publishSnapshotId),
    publishSnapshotHash: normalizeText(sourceSnapshot.publishSnapshotHash),
    lockSnapshotId: normalizeText(sourceSnapshot.lockSnapshotId),
    lockSnapshotHash: normalizeText(sourceSnapshot.lockSnapshotHash),
    replayAnchorId: normalizeText(sourceSnapshot.replayAnchorId),
    replayAnchorHash: normalizeText(sourceSnapshot.replayAnchorHash),
    graphVersion: normalizeText(graph.graphVersion || sourceSnapshot.graphVersion),
    graphHash: normalizeText(graph.graphHash || sourceSnapshot.graphHash),
    evaluatedAt: normalizeText(graph.evaluatedAt),
  }
  const missingEvidence = [
    ['sourceOutputAssetId', 'Source output asset'],
    ['certificationLevel', 'Truth certification'],
    ['publishSnapshotId', 'Publish snapshot'],
    ['lockSnapshotId', 'Lock snapshot'],
    ['replayAnchorId', 'Replay anchor'],
    ['graphHash', 'Intelligence graph hash'],
  ]
    .filter(([key]) => !evidence[key])
    .map(([key, label]) => ({
      key,
      label,
    }))
  const status = missingEvidence.length === 0
    ? OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED
    : OUTCOME_STUDIO_BINDING_STATUSES.BLOCKED

  return {
    status,
    mode: 'CERTIFIED_RUNTIME_TRUTH',
    runtimeInstanceId: evidence.runtimeInstanceId,
    runtimeInstanceKey: evidence.runtimeInstanceKey,
    certification,
    qualityBand: evidence.qualityBand,
    graph,
    truthSignature: {
      status,
      mode: 'PROJECTED_FROM_RUNTIME_EVIDENCE',
      persistence: 'NOT_PERSISTED',
      currentness: sourceOutput?.stale === true ? 'OUT_OF_DATE' : status === OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED ? 'CURRENT' : 'BLOCKED',
      evidence,
      missingEvidence,
    },
    sourceOutput,
  }
}

const buildSafetyGate = ({
  code,
  label,
  passed,
  message,
  blockerReason = '',
}) => ({
  code,
  label,
  status: passed
    ? OUTCOME_STUDIO_SAFETY_GATE_STATUSES.PASSED
    : OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
  message,
  ...(passed || !blockerReason ? {} : { blockerReason }),
})

const buildSafetyGates = ({
  packBinding,
  readiness,
  sourceOutput,
  truthBinding,
}) => {
  const activeCount = Array.isArray(packBinding?.activePacks) ? packBinding.activePacks.length : 0
  const requiredCount = Array.isArray(packBinding?.requiredPacks) ? packBinding.requiredPacks.length : 0
  const sourceOutputBound = Boolean(sourceOutput?.outputAssetId)
  const truthSignatureBound =
    truthBinding?.truthSignature?.status === OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED
  const knowledgePacksBound =
    packBinding?.status === OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED
    && requiredCount > 0
    && activeCount >= requiredCount
  const promptPersistenceReady = readiness?.canStartSession === true
  const responseGenerationAvailable =
    sourceOutputBound
    && truthSignatureBound
    && knowledgePacksBound
    && promptPersistenceReady

  const gates = [
    buildSafetyGate({
      code: OUTCOME_STUDIO_SAFETY_GATE_CODES.SOURCE_OUTPUT_BOUND,
      label: 'Source Output Binding',
      passed: sourceOutputBound,
      message: sourceOutputBound
        ? 'A governed Output Lab source asset is bound for the session.'
        : 'A governed Output Lab source asset is required before Outcome Studio can start.',
      blockerReason: OUTCOME_STUDIO_BLOCKER_CODES.SOURCE_OUTPUT_MISSING,
    }),
    buildSafetyGate({
      code: OUTCOME_STUDIO_SAFETY_GATE_CODES.TRUTH_SIGNATURE_BOUND,
      label: 'Truth Signature Binding',
      passed: truthSignatureBound,
      message: truthSignatureBound
        ? 'Certified Runtime Truth can be bound to the session.'
        : 'Certified Runtime Truth evidence is incomplete and must be bound before generation.',
      blockerReason: 'TRUTH_SIGNATURE_BINDING_MISSING',
    }),
    buildSafetyGate({
      code: OUTCOME_STUDIO_SAFETY_GATE_CODES.KNOWLEDGE_PACKS_BOUND,
      label: 'Knowledge Pack Binding',
      passed: knowledgePacksBound,
      message: knowledgePacksBound
        ? 'All required Outcome Studio knowledge packs are active for runtime binding.'
        : 'All required Outcome Studio knowledge packs must be active before runtime reasoning.',
      blockerReason: OUTCOME_STUDIO_BLOCKER_CODES.KNOWLEDGE_PACK_BINDING_MISSING,
    }),
    buildSafetyGate({
      code: OUTCOME_STUDIO_SAFETY_GATE_CODES.PROMPT_PERSISTENCE_READY,
      label: 'Prompt Persistence',
      passed: promptPersistenceReady,
      message: promptPersistenceReady
        ? 'Customer prompts can be persisted against an active governed session.'
        : 'Prompt persistence remains blocked until the session readiness gate passes.',
      blockerReason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
    }),
    buildSafetyGate({
      code: OUTCOME_STUDIO_SAFETY_GATE_CODES.RESPONSE_GENERATION_ENGINE,
      label: 'Response Generation Engine',
      passed: responseGenerationAvailable,
      message: responseGenerationAvailable
        ? 'Governed response generation can run for active current sessions.'
        : 'Assistant response generation is blocked until source, truth, knowledge-pack, and session gates pass.',
      blockerReason: 'PRE_GENERATION_GATES_BLOCKED',
    }),
  ]
  const passedCount = gates.filter((gate) => gate.status === OUTCOME_STUDIO_SAFETY_GATE_STATUSES.PASSED).length

  return {
    status: passedCount === gates.length
      ? OUTCOME_STUDIO_SAFETY_GATE_STATUSES.PASSED
      : OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
    mode: 'PRE_GENERATION_READINESS',
    responseGenerationAvailable,
    passedCount,
    blockedCount: gates.length - passedCount,
    totalCount: gates.length,
    summary: responseGenerationAvailable
      ? 'All Outcome Studio safety gates are passed.'
      : 'Outcome Studio can preserve governed prompts when session readiness passes, but response generation remains blocked until all pre-generation gates pass.',
    gates,
  }
}

const buildConversationState = (readiness) => ({
  enabled: readiness.canStartSession === true,
  disabledReason: readiness.canStartSession
    ? ''
    : readiness.summary || 'Outcome Studio sessions are not available.',
  promptMaxLength: 2000,
  allowedActions: [],
})

const buildOutcomeStudioProjection = async ({
  assets = [],
  outputLab,
  sessions = [],
  truthQuality = null,
}) => {
  const sourceOutput = sanitizeSourceOutputAsset({
    asset: selectSourceOutputAsset(Array.isArray(outputLab?.assets) ? outputLab.assets : []),
    readiness: outputLab?.readiness || {},
  })
  const packBinding = await resolveOutcomeStudioKnowledgePacks(outputLab?.runtimeScope || {})
  const readiness = buildReadiness({
    outputLab,
    packBinding,
    sourceOutput,
  })
  const truthBinding = buildTruthBinding({
    readiness: outputLab?.readiness || {},
    sourceOutput,
    truthQuality,
  })
  const safetyGates = buildSafetyGates({
    packBinding,
    readiness,
    sourceOutput,
    truthBinding,
  })
  const readinessWithSafetyGates = {
    ...readiness,
    canReason: readiness.canStartSession === true && safetyGates.responseGenerationAvailable === true,
    summary: readiness.canStartSession === true && safetyGates.responseGenerationAvailable !== true
      ? 'Outcome Studio can start governed sessions; response generation remains blocked until all pre-generation gates pass.'
      : readiness.summary,
    safetyGates: {
      status: safetyGates.status,
      mode: safetyGates.mode,
      responseGenerationAvailable: safetyGates.responseGenerationAvailable,
      passedCount: safetyGates.passedCount,
      blockedCount: safetyGates.blockedCount,
      totalCount: safetyGates.totalCount,
    },
  }

  return {
    contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
    phase: OUTCOME_STUDIO_PHASE,
    readiness: readinessWithSafetyGates,
    truthBinding,
    packBinding,
    safetyGates,
    conversation: buildConversationState(readinessWithSafetyGates),
    sourceOutputs: sourceOutput ? [sourceOutput] : [],
    sessions,
    assets,
  }
}

const listOutcomeSessionsForRuntime = async (runtimeInstanceId, {
  currentEvidence = null,
} = {}) => {
  const sessions = await OutcomeSession.find({ runtimeInstanceId })
    .sort({ createdAt: -1 })
    .limit(OUTCOME_STUDIO_SESSION_LIST_LIMIT)
    .lean()
  return sessions.map((session) => serializeOutcomeSessionSummary(session, { currentEvidence }))
}

const assertOutcomeSessionMutationPermission = async ({
  actorUserId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await getRuntimeInstance({ runtimeInstanceId, scopes })
  const runtimeType = normalizeToken(runtimeInstance?.runtimeType)
  await assertRuntimePermission({
    actorUserId,
    scopes,
    customerId: runtimeInstance.customerId,
    tenantId: runtimeInstance.tenantId,
    permission: runtimeType === 'DEAL_ANALYSIS' ? 'DEAL_UPDATE' : 'VMF_UPDATE',
  })
  return runtimeInstance
}

const findOutcomeSessionForRuntime = async ({
  detailsRuntimeInstanceId,
  runtimeInstanceId,
  sessionId,
}) => {
  const query = OutcomeSession.findOne({
    runtimeInstanceId,
    sessionId: normalizeText(sessionId),
  })
  const session = typeof query?.lean === 'function' ? await query.lean() : await query

  if (!session) {
    throw createOutcomeStudioError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio session not found.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_NOT_FOUND,
      details: {
        runtimeInstanceId: detailsRuntimeInstanceId || runtimeInstanceId,
        sessionId: normalizeText(sessionId),
      },
    })
  }

  return session
}

export const getRuntimeOutcomeStudio = async ({
  actorUserId,
  auditRequest,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const outputLab = await getRuntimeOutputLab({ includeRuntimeScope: true, runtimeInstanceId, scopes })
  const truthQuality = await getRuntimeTruthQuality({
    actorUserId,
    auditRequest,
    runtimeInstanceId,
    scopes,
  })
  const sourceOutput = sanitizeSourceOutputAsset({
    asset: selectSourceOutputAsset(Array.isArray(outputLab?.assets) ? outputLab.assets : []),
    readiness: outputLab?.readiness || {},
  })
  const currentEvidence = buildProjectionTruthEvidence({
    readiness: outputLab?.readiness || {},
    sourceOutput,
  })
  const sessions = await listOutcomeSessionsForRuntime(
    outputLab?.runtimeScope?.runtimeInstanceId || runtimeInstanceId,
    { currentEvidence },
  )
  const assets = await listOutcomeAssetsForRuntime({
    currentEvidence,
    runtimeInstanceId: outputLab?.runtimeScope?.runtimeInstanceId || runtimeInstanceId,
  })
  return buildOutcomeStudioProjection({
    assets,
    outputLab,
    sessions,
    truthQuality,
  })
}

export const getRuntimeOutcomeSession = async ({
  runtimeInstanceId,
  scopes,
  sessionId,
} = {}) => {
  const runtimeInstance = await getRuntimeInstance({ runtimeInstanceId, scopes })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const currentEvidence = buildRuntimeTruthEvidence(runtimeInstance)
  const session = await findOutcomeSessionForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    runtimeInstanceId: runtimeObjectId,
    sessionId: normalizeText(sessionId),
  })
  const messages = await listOutcomeMessagesForSession({
    currentEvidence,
    runtimeInstanceId: runtimeObjectId,
    sessionId,
  })
  const assets = await listOutcomeAssetsForRuntime({
    currentEvidence,
    runtimeInstanceId: runtimeObjectId,
    sessionId,
  })

  return {
    ...serializeOutcomeSession(session, { currentEvidence }),
    messages,
    assets,
  }
}

export const listRuntimeOutcomeSessionAssets = async ({
  runtimeInstanceId,
  scopes,
  sessionId,
} = {}) => {
  const runtimeInstance = await getRuntimeInstance({ runtimeInstanceId, scopes })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const currentEvidence = buildRuntimeTruthEvidence(runtimeInstance)
  await findOutcomeSessionForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    runtimeInstanceId: runtimeObjectId,
    sessionId,
  })
  return listOutcomeAssetsForRuntime({
    currentEvidence,
    runtimeInstanceId: runtimeObjectId,
    sessionId,
  })
}

export const getRuntimeOutcomeAsset = async ({
  outcomeAssetId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await getRuntimeInstance({ runtimeInstanceId, scopes })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const currentEvidence = buildRuntimeTruthEvidence(runtimeInstance)
  const asset = await findOutcomeAssetForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    outcomeAssetId,
    runtimeInstanceId: runtimeObjectId,
  })
  const versions = await listOutcomeAssetVersionsForAsset({
    currentEvidence,
    outcomeAssetId,
    runtimeInstanceId: runtimeObjectId,
  })

  return {
    ...serializeOutcomeAsset(asset, { currentEvidence }),
    versions,
  }
}

export const getRuntimeOutcomeAssetVersion = async ({
  outcomeAssetId,
  outcomeAssetVersionId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await getRuntimeInstance({ runtimeInstanceId, scopes })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const currentEvidence = buildRuntimeTruthEvidence(runtimeInstance)
  await findOutcomeAssetForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    outcomeAssetId,
    runtimeInstanceId: runtimeObjectId,
  })
  const version = await findOutcomeAssetVersionForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    outcomeAssetId,
    outcomeAssetVersionId,
    runtimeInstanceId: runtimeObjectId,
  })

  return serializeOutcomeAssetVersion(version, { currentEvidence })
}

export const getRuntimeOutcomeAssetPreview = async ({
  outcomeAssetId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await getRuntimeInstance({ runtimeInstanceId, scopes })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const asset = await findOutcomeAssetForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    outcomeAssetId,
    runtimeInstanceId: runtimeObjectId,
  })
  const currentEvidence = buildRuntimeTruthEvidence(runtimeInstance)
  const currentVersion = await findCurrentOutcomeAssetVersion({
    actionLabel: 'preview',
    asset,
    availabilityKey: 'previewAvailable',
    missingReason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_PREVIEW_CONTENT_UNAVAILABLE,
    runtimeInstanceId: runtimeObjectId,
  })
  const serializedAsset = serializeOutcomeAsset(asset, { currentEvidence })
  const serializedVersion = serializeOutcomeAssetVersion(currentVersion, { currentEvidence })
  assertOutcomeAssetCurrentTruth({
    actionLabel: 'preview',
    asset: serializedAsset,
    availabilityKey: 'previewAvailable',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_PREVIEW_BLOCKED,
    version: serializedVersion,
  })
  const previewContent = getOutcomeAssetVersionPreviewContent({
    outcomeAssetId: serializedAsset.outcomeAssetId,
    version: currentVersion,
  })

  return {
    outcomeAssetId: serializedAsset.outcomeAssetId,
    outcomeAssetVersionId: serializedVersion.outcomeAssetVersionId,
    title: serializedVersion.title || serializedAsset.title,
    versionNumber: serializedVersion.versionNumber,
    status: serializedVersion.status,
    previewAvailable: true,
    contentFormat: 'MARKDOWN',
    markdown: previewContent.markdown,
    sections: previewContent.sections,
    truthSignature: serializedVersion.truthSignature,
    lineageSummary: serializedVersion.lineageSummary,
    warnings: serializedVersion.warnings,
    limitations: serializedVersion.limitations,
    generatedAt: serializedVersion.generatedAt,
  }
}

export const getRuntimeOutcomeStudioReadiness = async ({
  runtimeInstanceId,
  scopes,
} = {}) => {
  const outputLab = await getRuntimeOutputLab({ includeRuntimeScope: true, runtimeInstanceId, scopes })
  const outcomeStudio = await buildOutcomeStudioProjection({ outputLab })
  return outcomeStudio.readiness
}

export const createRuntimeOutcomeSession = async ({
  actorUserId,
  auditRequest,
  payload = {},
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await assertOutcomeSessionMutationPermission({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })

  const outputLab = await getRuntimeOutputLab({ includeRuntimeScope: true, runtimeInstanceId, scopes })
  let outcomeStudio = await buildOutcomeStudioProjection({ outputLab })

  if (outcomeStudio.readiness.canStartSession !== true) {
    throw createOutcomeStudioError({
      status: 409,
      code: 'CONFLICT',
      message: 'Outcome Studio session cannot start until readiness blockers are resolved.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
      details: {
        readiness: outcomeStudio.readiness,
        sourceOutputAssetId: normalizeText(payload?.sourceOutputAssetId),
      },
    })
  }

  const truthQuality = await getRuntimeTruthQuality({
    actorUserId,
    auditRequest,
    runtimeInstanceId,
    scopes,
  })
  outcomeStudio = await buildOutcomeStudioProjection({ outputLab, truthQuality })

  if (outcomeStudio.truthBinding?.truthSignature?.status !== OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED) {
    throw createOutcomeStudioError({
      status: 409,
      code: 'CONFLICT',
      message: 'Outcome Studio session cannot start until a Truth Signature can be bound.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
      details: {
        readiness: outcomeStudio.readiness,
        truthSignature: outcomeStudio.truthBinding?.truthSignature || {},
      },
    })
  }

  const sourceOutput = outcomeStudio.truthBinding?.sourceOutput || outcomeStudio.sourceOutputs[0]
  const requestedSourceOutputAssetId = normalizeText(payload?.sourceOutputAssetId)
  if (requestedSourceOutputAssetId && requestedSourceOutputAssetId !== sourceOutput?.outputAssetId) {
    throw createOutcomeStudioError({
      status: 409,
      code: 'CONFLICT',
      message: 'Outcome Studio session source output no longer matches the current governed source output.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
      details: {
        requestedSourceOutputAssetId,
        resolvedSourceOutputAssetId: sourceOutput?.outputAssetId || '',
      },
    })
  }

  const boundAt = new Date().toISOString()
  const sessionId = buildOutcomeSessionId()
  const truthSignatureId = buildTruthSignatureId()
  const runtimeScope = getRuntimeScope(runtimeInstance)
  const knowledgePackBinding = buildSessionKnowledgePackBinding(outcomeStudio.packBinding, boundAt)
  const truthSignature = buildSessionTruthSignature(
    outcomeStudio.truthBinding.truthSignature,
    boundAt,
    truthSignatureId,
  )
  const contextBindings = buildOutcomeContextBindings({
    contextType: 'SESSION',
    knowledgePackBinding,
    runtimeScope,
    sessionId,
    sourceOutput,
    truthSignature,
  })
  const truthSignatureRecord = new TruthSignature({
    truthSignatureId,
    sessionId,
    ...runtimeScope,
    contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
    phase: OUTCOME_STUDIO_PHASE,
    status: truthSignature.status,
    mode: truthSignature.mode,
    persistence: truthSignature.persistence,
    currentness: truthSignature.currentness,
    sourceOutputAssetId: sourceOutput.outputAssetId,
    sourceOutputTypeKey: sourceOutput.outputTypeKey,
    sourceOutputTypeLabel: sourceOutput.outputTypeLabel,
    sourceOutputSnapshot: sourceOutput,
    evidence: truthSignature.evidence,
    missingEvidence: truthSignature.missingEvidence,
    certification: outcomeStudio.truthBinding.certification || null,
    graph: outcomeStudio.truthBinding.graph || {},
    boundBy: actorUserId,
    boundAt,
  })
  const session = new OutcomeSession({
    sessionId,
    ...runtimeScope,
    workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
    phase: OUTCOME_STUDIO_PHASE,
    status: OUTCOME_STUDIO_SESSION_STATUSES.ACTIVE,
    sourceOutputAssetId: sourceOutput.outputAssetId,
    truthSignatureId,
    sourceOutputTypeKey: sourceOutput.outputTypeKey,
    sourceOutputTypeLabel: sourceOutput.outputTypeLabel,
    sourceOutputSnapshot: sourceOutput,
    truthSignature,
    knowledgePackBinding,
    contextBindings,
    prompt: normalizeText(payload?.prompt),
    startedBy: actorUserId,
    startedAt: boundAt,
    lastActivityAt: boundAt,
  })
  const sessionRelationshipDocuments = createRuntimeGraphRelationshipDocuments(
    buildSessionRuntimeGraphRelationships({
      actorUserId,
      knowledgePackBinding,
      runtimeScope,
      session,
      truthSignature,
    }),
  )

  const persistSessionAndAudit = async (dbSession = null) => {
    const saveOptions = dbSession ? { session: dbSession } : undefined
    await truthSignatureRecord.save(saveOptions)
    await session.save(saveOptions)
    try {
      await saveRuntimeGraphRelationshipDocuments(sessionRelationshipDocuments, { dbSession })
    } catch (err) {
      err.outcomeGraphRelationshipFailure = 'session'
      throw err
    }

    try {
      await logOutcomeSessionAudit({
        action: auditService.AUDIT_ACTIONS.OUTCOME_SESSION_CREATED,
        auditRequest,
        dbSession,
        runtimeInstance,
        session,
        summary: 'Outcome Studio session created from governed runtime truth.',
        diff: {
          actorUserId,
          sessionId: session.sessionId,
          runtimeInstanceId: toIdString(runtimeInstance._id || runtimeInstance.id),
          sourceOutputAssetId: sourceOutput.outputAssetId,
          sourceOutputTypeKey: sourceOutput.outputTypeKey,
          truthSignatureId,
          truthSignatureStatus: truthSignature.status,
          knowledgePackBindingStatus: knowledgePackBinding.status,
          activeKnowledgePackCount: knowledgePackBinding.activeCount,
          requiredKnowledgePackCount: knowledgePackBinding.requiredCount,
          runtimeGraphRelationshipCount: sessionRelationshipDocuments.length,
        },
      })
      await logOutcomeSessionAudit({
        action: auditService.AUDIT_ACTIONS.TRUTH_SIGNATURE_BOUND,
        auditRequest,
        dbSession,
        runtimeInstance,
        session,
        summary: 'Outcome Studio Truth Signature bound to session.',
        diff: {
          actorUserId,
          sessionId: session.sessionId,
          truthSignatureId,
          sourceOutputAssetId: sourceOutput.outputAssetId,
          truthSignature: {
            truthSignatureId,
            status: truthSignature.status,
            mode: truthSignature.mode,
            persistence: truthSignature.persistence,
            currentness: truthSignature.currentness,
            boundAt,
            evidence: truthSignature.evidence,
            missingEvidence: truthSignature.missingEvidence,
          },
          runtimeGraphRelationshipId: sessionRelationshipDocuments[0]?.relationshipId || '',
        },
      })
      await logOutcomeSessionAudit({
        action: auditService.AUDIT_ACTIONS.KNOWLEDGE_PACK_BOUND_TO_SESSION,
        auditRequest,
        dbSession,
        runtimeInstance,
        session,
        summary: 'Outcome Studio Knowledge Pack binding captured for session.',
        diff: {
          actorUserId,
          sessionId: session.sessionId,
          knowledgePackBinding: {
            status: knowledgePackBinding.status,
            mode: knowledgePackBinding.mode,
            boundAt,
            activeCount: knowledgePackBinding.activeCount,
            requiredCount: knowledgePackBinding.requiredCount,
            activePacks: knowledgePackBinding.activePacks,
          },
          runtimeGraphRelationshipCount: Math.max(sessionRelationshipDocuments.length - 1, 0),
        },
      })
    } catch (err) {
      err.outcomeSessionAuditFailure = true
      throw err
    }
  }

  if (canUseMongoTransaction()) {
    const dbSession = await mongoose.startSession()
    try {
      await dbSession.withTransaction(async () => {
        await persistSessionAndAudit(dbSession)
      })
    } catch (err) {
      if (err?.outcomeGraphRelationshipFailure === 'session') {
        throw failGraphRelationshipClosed(err, {
          sessionId: session.sessionId,
          truthSignatureId,
        })
      }
      if (!err?.outcomeSessionAuditFailure) throw err
      throw failAuditClosed(err, {
        sessionId: session.sessionId,
        truthSignatureId,
      })
    } finally {
      await dbSession.endSession()
    }
  } else {
    try {
      await persistSessionAndAudit()
    } catch (err) {
      await deleteRuntimeGraphRelationshipDocuments(sessionRelationshipDocuments)
      await OutcomeSession.deleteOne({ _id: session._id })
      await TruthSignature.deleteOne({ _id: truthSignatureRecord._id })
      if (err?.outcomeGraphRelationshipFailure === 'session') {
        throw failGraphRelationshipClosed(err, {
          sessionId: session.sessionId,
          truthSignatureId,
        })
      }
      if (!err?.outcomeSessionAuditFailure) throw err
      throw failAuditClosed(err, {
        sessionId: session.sessionId,
        truthSignatureId,
      })
    }
  }

  return serializeOutcomeSession(session)
}

export const createRuntimeOutcomeMessage = async ({
  actorUserId,
  auditRequest,
  payload = {},
  runtimeInstanceId,
  scopes,
  sessionId,
} = {}) => {
  const runtimeInstance = await assertOutcomeSessionMutationPermission({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const session = await findOutcomeSessionForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    runtimeInstanceId: runtimeObjectId,
    sessionId,
  })
  const currentEvidence = buildRuntimeTruthEvidence(runtimeInstance)
  const serializedSession = serializeOutcomeSession(session, { currentEvidence })

  if (serializedSession.status !== OUTCOME_STUDIO_SESSION_STATUSES.ACTIVE) {
    throw createOutcomeStudioError({
      status: 409,
      code: 'CONFLICT',
      message: 'Outcome Studio prompt cannot be submitted to a non-active session.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
      details: {
        sessionId: serializedSession.sessionId,
        status: serializedSession.status,
      },
    })
  }

  assertOutcomeSessionTruthCurrent({
    actionLabel: 'prompt submission',
    availabilityKey: 'promptPersistenceAvailable',
    session: serializedSession,
  })

  const submittedAt = new Date().toISOString()
  const prompt = normalizeText(payload?.prompt)
  const runtimeScope = getRuntimeScope(runtimeInstance)
  const messageId = buildOutcomeMessageId()
  const contextBindings = buildOutcomeContextBindings({
    contextType: 'MESSAGE',
    knowledgePackBinding: serializedSession.knowledgePackBinding,
    messageId,
    runtimeScope,
    sessionId: serializedSession.sessionId,
    sourceOutput: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
  })
  const message = new OutcomeMessage({
    messageId,
    sessionId: serializedSession.sessionId,
    ...runtimeScope,
    workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
    phase: OUTCOME_STUDIO_PHASE,
    role: OUTCOME_STUDIO_MESSAGE_ROLES.USER,
    status: OUTCOME_STUDIO_MESSAGE_STATUSES.SUBMITTED,
    responseStatus: OUTCOME_STUDIO_RESPONSE_STATUSES.PENDING_RESPONSE,
    prompt,
    sourceOutputSnapshot: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
    knowledgePackBinding: serializedSession.knowledgePackBinding,
    contextBindings,
    submittedBy: actorUserId,
    submittedAt,
  })

  const persistMessageAndAudit = async (dbSession = null) => {
    const saveOptions = dbSession ? { session: dbSession } : undefined
    await message.save(saveOptions)
    try {
      await logOutcomeMessageAudit({
        auditRequest,
        dbSession,
        runtimeInstance,
        message,
        summary: 'Outcome Studio prompt submitted to governed session.',
        diff: {
          actorUserId,
          sessionId: serializedSession.sessionId,
          messageId: message.messageId,
          runtimeInstanceId: toIdString(runtimeObjectId),
          sourceOutputAssetId: serializedSession.sourceOutputAssetId,
          sourceOutputTypeKey: serializedSession.sourceOutputTypeKey,
          truthSignatureStatus: serializedSession.truthSignature.status,
          knowledgePackBindingStatus: serializedSession.knowledgePackBinding.status,
          promptLength: prompt.length,
          responseStatus: OUTCOME_STUDIO_RESPONSE_STATUSES.PENDING_RESPONSE,
        },
      })
    } catch (err) {
      err.outcomeMessageAuditFailure = true
      throw err
    }
  }

  if (canUseMongoTransaction()) {
    const dbSession = await mongoose.startSession()
    try {
      await dbSession.withTransaction(async () => {
        await persistMessageAndAudit(dbSession)
      })
    } catch (err) {
      if (!err?.outcomeMessageAuditFailure) throw err
      throw failMessageAuditClosed(err, {
        sessionId: serializedSession.sessionId,
        messageId: message.messageId,
      })
    } finally {
      await dbSession.endSession()
    }
  } else {
    try {
      await persistMessageAndAudit()
    } catch (err) {
      await OutcomeMessage.deleteOne({ _id: message._id })
      if (!err?.outcomeMessageAuditFailure) throw err
      throw failMessageAuditClosed(err, {
        sessionId: serializedSession.sessionId,
        messageId: message.messageId,
      })
    }
  }

  return serializeOutcomeMessage(message)
}

export const generateRuntimeOutcomeResponse = async ({
  actorUserId,
  auditRequest,
  runtimeInstanceId,
  scopes,
  sessionId,
  messageId,
} = {}) => {
  const runtimeInstance = await assertOutcomeSessionMutationPermission({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const session = await findOutcomeSessionForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    runtimeInstanceId: runtimeObjectId,
    sessionId,
  })
  const currentEvidence = buildRuntimeTruthEvidence(runtimeInstance)
  const serializedSession = serializeOutcomeSession(session, { currentEvidence })

  if (serializedSession.status !== OUTCOME_STUDIO_SESSION_STATUSES.ACTIVE) {
    throw createOutcomeStudioError({
      status: 409,
      code: 'CONFLICT',
      message: 'Outcome Studio response generation cannot run for a non-active session.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
      details: {
        sessionId: serializedSession.sessionId,
        status: serializedSession.status,
      },
    })
  }

  assertOutcomeSessionTruthCurrent({
    actionLabel: 'response generation',
    availabilityKey: 'responseGenerationAvailable',
    session: serializedSession,
  })

  const message = await findOutcomeMessageForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    messageId,
    runtimeInstanceId: runtimeObjectId,
    sessionId: serializedSession.sessionId,
  })
  const serializedMessage = serializeOutcomeMessage(message)

  if (serializedMessage.role !== OUTCOME_STUDIO_MESSAGE_ROLES.USER) {
    throw createOutcomeStudioError({
      status: 409,
      code: 'CONFLICT',
      message: 'Outcome Studio response generation requires a customer prompt message.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_RESPONSE_GENERATION_BLOCKED,
      details: {
        sessionId: serializedSession.sessionId,
        messageId: serializedMessage.messageId,
        role: serializedMessage.role,
        responseGenerationAvailable: false,
        blockerReason: 'OUTCOME_MESSAGE_ROLE_NOT_GENERATABLE',
        safetyGate: {
          code: OUTCOME_STUDIO_SAFETY_GATE_CODES.RESPONSE_GENERATION_ENGINE,
          status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
        },
      },
    })
  }

  if (serializedMessage.responseStatus !== OUTCOME_STUDIO_RESPONSE_STATUSES.PENDING_RESPONSE) {
    throw createOutcomeStudioError({
      status: 409,
      code: 'CONFLICT',
      message: 'Outcome Studio response generation has already completed for this prompt.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_RESPONSE_GENERATION_BLOCKED,
      details: {
        sessionId: serializedSession.sessionId,
        messageId: serializedMessage.messageId,
        responseStatus: serializedMessage.responseStatus,
        responseGenerationAvailable: false,
        blockerReason: 'OUTCOME_RESPONSE_ALREADY_GENERATED',
        safetyGate: {
          code: OUTCOME_STUDIO_SAFETY_GATE_CODES.RESPONSE_GENERATION_ENGINE,
          status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
        },
      },
    })
  }

  const runtimeScope = getRuntimeScope(runtimeInstance)
  const generatedAt = new Date().toISOString()
  const responsePrompt = buildGovernedOutcomeResponseText({
    message: serializedMessage,
    session: serializedSession,
  })
  const responseMessageId = buildOutcomeMessageId()
  const outcomeAssetId = buildOutcomeAssetId()
  const outcomeAssetVersionId = buildOutcomeAssetVersionId()
  const outcomeAssetTitle = buildOutcomeAssetTitle({ session: serializedSession })
  const lineageSummary = buildGeneratedOutcomeAssetLineageSummary({
    generatedAt,
    runtimeInstance,
    session: serializedSession,
  })
  const customerContent = buildGeneratedOutcomeAssetCustomerContent({
    assetId: outcomeAssetId,
    message: serializedMessage,
    responseText: responsePrompt,
    session: serializedSession,
    versionId: outcomeAssetVersionId,
  })
  const warnings = [
    'Generated from the deterministic Outcome Studio scaffold; executable ARL/RL reasoning is not yet implemented.',
  ]
  const limitations = [
    'Do not treat this scaffold as provider-generated or ARL/RL-executed output.',
  ]
  const responseContextBindings = buildOutcomeContextBindings({
    contextType: 'MESSAGE',
    knowledgePackBinding: serializedSession.knowledgePackBinding,
    messageId: responseMessageId,
    runtimeScope,
    sessionId: serializedSession.sessionId,
    sourceOutput: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
  })
  const assetContextBindings = buildOutcomeContextBindings({
    assetType: DEFAULT_OUTCOME_ASSET_TYPE,
    contextType: 'ASSET',
    knowledgePackBinding: serializedSession.knowledgePackBinding,
    outcomeAssetId,
    outcomeAssetVersionId,
    runtimeScope,
    sessionId: serializedSession.sessionId,
    sourceOutput: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
  })
  const responseMessage = new OutcomeMessage({
    messageId: responseMessageId,
    sessionId: serializedSession.sessionId,
    ...runtimeScope,
    workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
    phase: OUTCOME_STUDIO_PHASE,
    role: OUTCOME_STUDIO_MESSAGE_ROLES.ASSISTANT,
    status: OUTCOME_STUDIO_MESSAGE_STATUSES.GENERATED,
    responseStatus: OUTCOME_STUDIO_RESPONSE_STATUSES.RESPONSE_GENERATED,
    prompt: responsePrompt,
    sourceOutputSnapshot: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
    knowledgePackBinding: serializedSession.knowledgePackBinding,
    contextBindings: responseContextBindings,
    submittedBy: actorUserId,
    submittedAt: generatedAt,
  })
  const outcomeAsset = new OutcomeAsset({
    outcomeAssetId,
    sessionId: serializedSession.sessionId,
    ...runtimeScope,
    workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    assetType: DEFAULT_OUTCOME_ASSET_TYPE,
    contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
    phase: OUTCOME_STUDIO_PHASE,
    status: OUTCOME_STUDIO_ASSET_STATUSES.GENERATED,
    outputTypeKey: serializedSession.sourceOutputTypeKey || serializedSession.sourceOutput?.outputTypeKey,
    outputTypeLabel: serializedSession.sourceOutputTypeLabel || serializedSession.sourceOutput?.outputTypeLabel,
    title: outcomeAssetTitle,
    sourceOutputAssetId: serializedSession.sourceOutputAssetId || serializedSession.sourceOutput?.outputAssetId,
    currentVersionId: outcomeAssetVersionId,
    currentVersionNumber: 1,
    sourceOutputSnapshot: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
    knowledgePackBinding: serializedSession.knowledgePackBinding,
    contextBindings: assetContextBindings,
    lineageSummary,
    warnings,
    limitations,
    generatedBy: actorUserId,
    generatedAt,
  })
  const outcomeAssetVersion = new OutcomeAssetVersion({
    outcomeAssetVersionId,
    outcomeAssetId,
    parentVersionId: '',
    sessionId: serializedSession.sessionId,
    ...runtimeScope,
    workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    assetType: DEFAULT_OUTCOME_ASSET_TYPE,
    contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
    phase: OUTCOME_STUDIO_PHASE,
    versionNumber: 1,
    status: OUTCOME_STUDIO_ASSET_VERSION_STATUSES.CURRENT,
    outputTypeKey: outcomeAsset.outputTypeKey,
    outputTypeLabel: outcomeAsset.outputTypeLabel,
    title: outcomeAssetTitle,
    sourceOutputAssetId: outcomeAsset.sourceOutputAssetId,
    sourceOutputSnapshot: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
    knowledgePackBinding: serializedSession.knowledgePackBinding,
    contextBindings: assetContextBindings,
    lineageSummary,
    customerContent,
    warnings,
    limitations,
    generatedBy: actorUserId,
    generatedAt,
  })
  const generatedAssetRelationshipDocuments = createRuntimeGraphRelationshipDocuments(
    buildGeneratedAssetRuntimeGraphRelationships({
      actorUserId,
      asset: outcomeAsset,
      runtimeScope,
      session,
      version: outcomeAssetVersion,
    }),
  )

  let failureStage = 'write'
  const persistGeneratedResponseAndAudit = async (dbSession = null) => {
    const saveOptions = dbSession ? { session: dbSession } : undefined
    await responseMessage.save(saveOptions)
    if (dbSession) {
      await OutcomeMessage.updateOne(
        { _id: message._id },
        { $set: { responseStatus: OUTCOME_STUDIO_RESPONSE_STATUSES.RESPONSE_GENERATED } },
        { session: dbSession },
      )
    } else {
      await OutcomeMessage.updateOne(
        { _id: message._id },
        { $set: { responseStatus: OUTCOME_STUDIO_RESPONSE_STATUSES.RESPONSE_GENERATED } },
      )
    }
    await outcomeAsset.save(saveOptions)
    await outcomeAssetVersion.save(saveOptions)
    try {
      await saveRuntimeGraphRelationshipDocuments(generatedAssetRelationshipDocuments, { dbSession })
    } catch (err) {
      err.outcomeGraphRelationshipFailure = 'generatedAsset'
      throw err
    }
    try {
      failureStage = 'responseAudit'
      await logOutcomeMessageAudit({
        action: auditService.AUDIT_ACTIONS.OUTCOME_RESPONSE_GENERATED,
        auditRequest,
        dbSession,
        runtimeInstance,
        message: responseMessage,
        summary: 'Outcome Studio governed response generated for prompt.',
        diff: {
          actorUserId,
          sessionId: serializedSession.sessionId,
          messageId: serializedMessage.messageId,
          responseMessageId: responseMessage.messageId,
          runtimeInstanceId: toIdString(runtimeObjectId),
          sourceOutputAssetId: serializedSession.sourceOutputAssetId,
          sourceOutputTypeKey: serializedSession.sourceOutputTypeKey,
          truthSignatureStatus: serializedSession.truthSignature.status,
          knowledgePackBindingStatus: serializedSession.knowledgePackBinding.status,
          responseStatus: OUTCOME_STUDIO_RESPONSE_STATUSES.RESPONSE_GENERATED,
          assetCreated: true,
          outcomeAssetId,
          outcomeAssetVersionId,
          runtimeGraphRelationshipCount: generatedAssetRelationshipDocuments.length,
        },
      })
      failureStage = 'assetAudit'
      await logOutcomeAssetGeneratedAudit({
        auditRequest,
        dbSession,
        runtimeInstance,
        asset: outcomeAsset,
        summary: 'Outcome Studio asset and first version generated from governed response.',
        diff: {
          actorUserId,
          sessionId: serializedSession.sessionId,
          messageId: serializedMessage.messageId,
          responseMessageId: responseMessage.messageId,
          runtimeInstanceId: toIdString(runtimeObjectId),
          outcomeAssetId,
          outcomeAssetVersionId,
          versionNumber: 1,
          sourceOutputAssetId: outcomeAsset.sourceOutputAssetId,
          sourceOutputTypeKey: outcomeAsset.outputTypeKey,
          truthSignatureStatus: serializedSession.truthSignature.status,
          truthSignatureCurrentness: serializedSession.truthSignature.currentness,
          knowledgePackBindingStatus: serializedSession.knowledgePackBinding.status,
          generatedBodyAvailable: true,
          runtimeGraphRelationshipCount: generatedAssetRelationshipDocuments.length,
        },
      })
    } catch (err) {
      err.outcomeResponseAuditFailure = failureStage
      throw err
    }
  }

  if (canUseMongoTransaction()) {
    const dbSession = await mongoose.startSession()
    try {
      await dbSession.withTransaction(async () => {
        await persistGeneratedResponseAndAudit(dbSession)
      })
    } catch (err) {
      if (err?.outcomeGraphRelationshipFailure === 'generatedAsset') {
        throw failGraphRelationshipClosed(err, {
          sessionId: serializedSession.sessionId,
          messageId: serializedMessage.messageId,
          responseMessageId: responseMessage.messageId,
          outcomeAssetId,
          outcomeAssetVersionId,
        })
      }
      if (err?.outcomeResponseAuditFailure === 'assetAudit') {
        throw failAssetGenerationAuditClosed(err, {
          sessionId: serializedSession.sessionId,
          messageId: serializedMessage.messageId,
          responseMessageId: responseMessage.messageId,
          outcomeAssetId,
          outcomeAssetVersionId,
        })
      }
      if (err?.outcomeResponseAuditFailure !== 'responseAudit') throw err
      throw failMessageAuditClosed(err, {
        sessionId: serializedSession.sessionId,
        messageId: serializedMessage.messageId,
        responseMessageId: responseMessage.messageId,
        outcomeAssetId,
        outcomeAssetVersionId,
      })
    } finally {
      await dbSession.endSession()
    }
  } else {
    try {
      await persistGeneratedResponseAndAudit()
    } catch (err) {
      await deleteRuntimeGraphRelationshipDocuments(generatedAssetRelationshipDocuments)
      await OutcomeAssetVersion.deleteOne({ _id: outcomeAssetVersion._id })
      await OutcomeAsset.deleteOne({ _id: outcomeAsset._id })
      await OutcomeMessage.deleteOne({ _id: responseMessage._id })
      await OutcomeMessage.updateOne(
        { _id: message._id },
        { $set: { responseStatus: OUTCOME_STUDIO_RESPONSE_STATUSES.PENDING_RESPONSE } },
      )
      if (err?.outcomeGraphRelationshipFailure === 'generatedAsset') {
        throw failGraphRelationshipClosed(err, {
          sessionId: serializedSession.sessionId,
          messageId: serializedMessage.messageId,
          responseMessageId: responseMessage.messageId,
          outcomeAssetId,
          outcomeAssetVersionId,
        })
      }
      if (err?.outcomeResponseAuditFailure === 'assetAudit') {
        throw failAssetGenerationAuditClosed(err, {
          sessionId: serializedSession.sessionId,
          messageId: serializedMessage.messageId,
          responseMessageId: responseMessage.messageId,
          outcomeAssetId,
          outcomeAssetVersionId,
        })
      }
      if (err?.outcomeResponseAuditFailure !== 'responseAudit') throw err
      throw failMessageAuditClosed(err, {
        sessionId: serializedSession.sessionId,
        messageId: serializedMessage.messageId,
        responseMessageId: responseMessage.messageId,
        outcomeAssetId,
        outcomeAssetVersionId,
      })
    }
  }

  return {
    ...serializeOutcomeMessage(responseMessage),
    asset: serializeOutcomeAssetSummary(outcomeAsset, { currentEvidence }),
    assetVersion: serializeOutcomeAssetVersion(outcomeAssetVersion, { currentEvidence }),
  }
}

export const publishRuntimeOutcomeAsset = async ({
  actorUserId,
  auditRequest,
  outcomeAssetId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await assertOutcomeSessionMutationPermission({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const asset = await findOutcomeAssetForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    outcomeAssetId,
    runtimeInstanceId: runtimeObjectId,
  })
  const assetStatus = normalizeToken(asset.status)
  if (assetStatus !== OUTCOME_STUDIO_ASSET_STATUSES.GENERATED) {
    throw createOutcomeStudioError({
      status: 409,
      code: 'CONFLICT',
      message: 'Outcome Studio asset publish requires a generated asset that has not already been published.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_PUBLISH_BLOCKED,
      details: {
        outcomeAssetId: normalizeText(asset.outcomeAssetId),
        status: assetStatus || 'UNKNOWN',
        publishAvailable: false,
        blockerReason: assetStatus === OUTCOME_STUDIO_ASSET_STATUSES.PUBLISHED
          ? 'OUTCOME_ASSET_ALREADY_PUBLISHED'
          : 'OUTCOME_ASSET_NOT_GENERATED',
        safetyGate: {
          code: OUTCOME_STUDIO_SAFETY_GATE_CODES.ASSET_PUBLISH,
          status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
        },
      },
    })
  }

  const currentEvidence = buildRuntimeTruthEvidence(runtimeInstance)
  const currentVersion = await findCurrentOutcomeAssetVersion({
    actionLabel: 'publish',
    asset,
    availabilityKey: 'publishAvailable',
    missingReason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_PUBLISH_BLOCKED,
    runtimeInstanceId: runtimeObjectId,
    safetyGateCode: OUTCOME_STUDIO_SAFETY_GATE_CODES.ASSET_PUBLISH,
  })
  const serializedAsset = serializeOutcomeAsset(asset, { currentEvidence })
  const serializedVersion = serializeOutcomeAssetVersion(currentVersion, { currentEvidence })
  assertOutcomeAssetCurrentTruth({
    actionLabel: 'publish',
    asset: serializedAsset,
    availabilityKey: 'publishAvailable',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_PUBLISH_BLOCKED,
    safetyGateCode: OUTCOME_STUDIO_SAFETY_GATE_CODES.ASSET_PUBLISH,
    version: serializedVersion,
  })

  const publishedAt = new Date()
  const publishedAsset = {
    ...asset,
    previousStatus: serializedAsset.status,
    status: OUTCOME_STUDIO_ASSET_STATUSES.PUBLISHED,
    publishedBy: actorUserId,
    publishedAt,
    updatedAt: publishedAt,
  }
  const publishedAssetRelationshipDocuments = createRuntimeGraphRelationshipDocuments(
    buildPublishedAssetRuntimeGraphRelationships({
      actorUserId,
      asset: publishedAsset,
      runtimeScope: getRuntimeScope(runtimeInstance),
      version: currentVersion,
    }),
  )

  const persistPublishedAssetAndAudit = async (dbSession = null) => {
    const updateOptions = dbSession ? { session: dbSession } : undefined
    const updateResult = updateOptions
      ? await OutcomeAsset.updateOne({
          _id: asset._id,
          runtimeInstanceId: runtimeObjectId,
          outcomeAssetId: serializedAsset.outcomeAssetId,
          status: OUTCOME_STUDIO_ASSET_STATUSES.GENERATED,
        }, {
          $set: {
            status: OUTCOME_STUDIO_ASSET_STATUSES.PUBLISHED,
            publishedBy: actorUserId,
            publishedAt,
            updatedAt: publishedAt,
          },
        }, updateOptions)
      : await OutcomeAsset.updateOne({
          _id: asset._id,
          runtimeInstanceId: runtimeObjectId,
          outcomeAssetId: serializedAsset.outcomeAssetId,
          status: OUTCOME_STUDIO_ASSET_STATUSES.GENERATED,
        }, {
          $set: {
            status: OUTCOME_STUDIO_ASSET_STATUSES.PUBLISHED,
            publishedBy: actorUserId,
            publishedAt,
            updatedAt: publishedAt,
          },
        })

    if (!updateResult?.matchedCount && !updateResult?.modifiedCount) {
      throw createOutcomeStudioError({
        status: 409,
        code: 'CONFLICT',
        message: 'Outcome Studio asset publish could not confirm a generated asset mutation.',
        reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_PUBLISH_BLOCKED,
        details: {
          outcomeAssetId: serializedAsset.outcomeAssetId,
          status: serializedAsset.status,
          publishAvailable: false,
          blockerReason: 'OUTCOME_ASSET_PUBLISH_MUTATION_NOT_CONFIRMED',
          safetyGate: {
            code: OUTCOME_STUDIO_SAFETY_GATE_CODES.ASSET_PUBLISH,
            status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
          },
        },
      })
    }

    try {
      await saveRuntimeGraphRelationshipDocuments(publishedAssetRelationshipDocuments, { dbSession })
    } catch (err) {
      err.outcomeGraphRelationshipFailure = 'publishedAsset'
      throw err
    }

    try {
      await logOutcomeAssetPublishedAudit({
        auditRequest,
        asset: publishedAsset,
        dbSession,
        runtimeInstance,
        diff: {
          actorUserId,
          outcomeAssetId: serializedAsset.outcomeAssetId,
          outcomeAssetVersionId: serializedVersion.outcomeAssetVersionId,
          previousStatus: serializedAsset.status,
          nextStatus: OUTCOME_STUDIO_ASSET_STATUSES.PUBLISHED,
          publishedAt: publishedAt.toISOString(),
          truthSignatureStatus: serializedAsset.truthSignature.status,
          truthSignatureCurrentness: serializedAsset.truthSignature.currentness,
          runtimeGraphRelationshipCount: publishedAssetRelationshipDocuments.length,
        },
        summary: 'Published Outcome Studio asset from current certified runtime truth.',
      })
    } catch (err) {
      err.outcomeAssetPublishAuditFailure = true
      throw err
    }
  }

  if (canUseMongoTransaction()) {
    const dbSession = await mongoose.startSession()
    try {
      await dbSession.withTransaction(async () => {
        await persistPublishedAssetAndAudit(dbSession)
      })
    } catch (err) {
      if (err?.outcomeGraphRelationshipFailure === 'publishedAsset') {
        throw failGraphRelationshipClosed(err, {
          outcomeAssetId: serializedAsset.outcomeAssetId,
          outcomeAssetVersionId: serializedVersion.outcomeAssetVersionId,
        })
      }
      if (!err?.outcomeAssetPublishAuditFailure) throw err
      throw failAssetPublishAuditClosed(err, {
        outcomeAssetId: serializedAsset.outcomeAssetId,
        outcomeAssetVersionId: serializedVersion.outcomeAssetVersionId,
      })
    } finally {
      await dbSession.endSession()
    }
  } else {
    try {
      await persistPublishedAssetAndAudit()
    } catch (err) {
      if (!err?.outcomeGraphRelationshipFailure && !err?.outcomeAssetPublishAuditFailure) {
        throw err
      }
      await deleteRuntimeGraphRelationshipDocuments(publishedAssetRelationshipDocuments)
      await OutcomeAsset.updateOne({ _id: asset._id }, {
        $set: {
          status: asset.status,
          publishedBy: asset.publishedBy || null,
          publishedAt: asset.publishedAt || null,
          updatedAt: asset.updatedAt || new Date(),
        },
      })
      if (err?.outcomeGraphRelationshipFailure === 'publishedAsset') {
        throw failGraphRelationshipClosed(err, {
          outcomeAssetId: serializedAsset.outcomeAssetId,
          outcomeAssetVersionId: serializedVersion.outcomeAssetVersionId,
        })
      }
      throw failAssetPublishAuditClosed(err, {
        outcomeAssetId: serializedAsset.outcomeAssetId,
        outcomeAssetVersionId: serializedVersion.outcomeAssetVersionId,
      })
    }
  }

  return {
    ...serializeOutcomeAssetSummary(publishedAsset, { currentEvidence }),
    publishAvailable: false,
    published: true,
  }
}

export const exportRuntimeOutcomeAsset = async ({
  actorUserId,
  auditRequest,
  format,
  outcomeAssetId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const normalizedFormat = normalizeToken(format)
  if (!Object.values(OUTCOME_STUDIO_EXPORT_FORMATS).includes(normalizedFormat)) {
    throw createOutcomeStudioError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Outcome Studio export format is not supported.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_FORMAT_UNSUPPORTED,
      details: { format },
    })
  }

  const runtimeInstance = await getRuntimeInstance({ runtimeInstanceId, scopes })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const asset = await findOutcomeAssetForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    outcomeAssetId,
    runtimeInstanceId: runtimeObjectId,
  })
  const currentEvidence = buildRuntimeTruthEvidence(runtimeInstance)
  const currentVersion = await findCurrentOutcomeAssetVersion({
    actionLabel: 'export',
    asset,
    availabilityKey: 'exportAvailable',
    missingReason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_CONTENT_UNAVAILABLE,
    runtimeInstanceId: runtimeObjectId,
  })
  const serializedAsset = serializeOutcomeAsset(asset, { currentEvidence })
  const serializedVersion = serializeOutcomeAssetVersion(currentVersion, { currentEvidence })
  assertOutcomeAssetCurrentTruth({
    actionLabel: 'export',
    asset: serializedAsset,
    availabilityKey: 'exportAvailable',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_BLOCKED,
    version: serializedVersion,
  })
  const { customerContent, markdown } = getOutcomeAssetVersionCustomerContent({
    format: normalizedFormat,
    outcomeAssetId: serializedAsset.outcomeAssetId,
    version: currentVersion,
  })
  const filename = getOutcomeAssetExportFilename({
    asset: serializedAsset,
    format: normalizedFormat,
  })
  const markdownExport = renderOutcomeStudioMarkdownExport({
    asset: serializedAsset,
    content: markdown,
    version: serializedVersion,
  })
  const mimeTypeByFormat = {
    [OUTCOME_STUDIO_EXPORT_FORMATS.JSON]: 'application/json',
    [OUTCOME_STUDIO_EXPORT_FORMATS.DOCX]: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    [OUTCOME_STUDIO_EXPORT_FORMATS.PDF]: 'application/pdf',
  }
  const mimeType = mimeTypeByFormat[normalizedFormat] || 'text/markdown'
  const auditDiff = {
    actorUserId,
    runtimeInstanceId: String(runtimeObjectId),
    runtimeInstanceKey: serializedAsset.runtimeInstanceKey,
    outcomeAssetId: serializedAsset.outcomeAssetId,
    outcomeAssetVersionId: serializedVersion.outcomeAssetVersionId,
    versionNumber: serializedVersion.versionNumber,
    format: normalizedFormat,
    filename,
    mimeType,
    contentIncludedInAudit: false,
  }

  try {
    await logOutcomeAssetExportAudit({
      auditRequest,
      asset,
      diff: auditDiff,
      runtimeInstance,
      summary: `Outcome Studio asset ${serializedAsset.outcomeAssetId} exported as ${normalizedFormat}.`,
    })
  } catch (err) {
    throw failExportAuditClosed(err, {
      outcomeAssetId: serializedAsset.outcomeAssetId,
      outcomeAssetVersionId: serializedVersion.outcomeAssetVersionId,
      format: normalizedFormat,
      exportAvailable: false,
    })
  }

  if (normalizedFormat === OUTCOME_STUDIO_EXPORT_FORMATS.JSON) {
    return {
      format: normalizedFormat,
      filename,
      mimeType,
      exportAvailable: true,
      content: buildOutcomeAssetJsonExport({
        asset: serializedAsset,
        content: customerContent,
        version: serializedVersion,
      }),
    }
  }

  if (normalizedFormat === OUTCOME_STUDIO_EXPORT_FORMATS.DOCX) {
    const contentBuffer = renderOutcomeStudioDocxExport({ markdown: markdownExport })
    return {
      format: normalizedFormat,
      filename,
      mimeType,
      exportAvailable: true,
      encoding: 'base64',
      contentBase64: contentBuffer.toString('base64'),
    }
  }

  if (normalizedFormat === OUTCOME_STUDIO_EXPORT_FORMATS.PDF) {
    const contentBuffer = renderOutcomeStudioPdfExport({ markdown: markdownExport })
    return {
      format: normalizedFormat,
      filename,
      mimeType,
      exportAvailable: true,
      encoding: 'base64',
      contentBase64: contentBuffer.toString('base64'),
    }
  }

  return {
    format: normalizedFormat,
    filename,
    mimeType,
    exportAvailable: true,
    content: markdownExport,
  }
}

export const updateRuntimeOutcomeSessionFromLatestTruth = async ({
  actorUserId,
  auditRequest,
  runtimeInstanceId,
  scopes,
  sessionId,
} = {}) => {
  const runtimeInstance = await assertOutcomeSessionMutationPermission({
    actorUserId,
    runtimeInstanceId,
    scopes,
  })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const session = await findOutcomeSessionForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    runtimeInstanceId: runtimeObjectId,
    sessionId,
  })
  const currentEvidence = buildRuntimeTruthEvidence(runtimeInstance)
  const serializedSession = serializeOutcomeSession(session, { currentEvidence })

  if (serializedSession.status !== OUTCOME_STUDIO_SESSION_STATUSES.ACTIVE) {
    throw createOutcomeStudioError({
      status: 409,
      code: 'CONFLICT',
      message: 'Outcome Studio session truth cannot be updated for a non-active session.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
      details: {
        sessionId: serializedSession.sessionId,
        status: serializedSession.status,
      },
    })
  }

  const truthSignatureCurrentness = normalizeToken(serializedSession.truthSignature?.currentness)
  if (!TRUTH_SIGNATURE_DRIFT_CURRENTNESS.has(truthSignatureCurrentness)) {
    throw createOutcomeStudioError({
      status: 409,
      code: 'CONFLICT',
      message: 'Outcome Studio update-from-latest-truth requires an out-of-date session Truth Signature.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_TRUTH_UPDATE_BLOCKED,
      details: {
        sessionId: serializedSession.sessionId,
        truthSignatureId: serializedSession.truthSignatureId,
        truthSignatureCurrentness: truthSignatureCurrentness || '',
        updateAvailable: false,
        blockerReason: 'TRUTH_SIGNATURE_ALREADY_CURRENT',
        safetyGate: {
          code: OUTCOME_STUDIO_SAFETY_GATE_CODES.TRUTH_UPDATE_WORKFLOW,
          status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
        },
      },
    })
  }

  try {
    await logOutcomeSessionAudit({
      action: auditService.AUDIT_ACTIONS.OUTCOME_DRIFT_DETECTED,
      auditRequest,
      runtimeInstance,
      session: {
        ...serializedSession,
        _id: session._id || session.id,
      },
      summary: 'Outcome Studio session truth drift detected before update-from-latest-truth.',
      diff: {
        actorUserId,
        sessionId: serializedSession.sessionId,
        truthSignatureId: serializedSession.truthSignatureId,
        truthSignatureCurrentness,
        previousEvidence: serializedSession.truthSignature?.evidence || {},
        currentEvidence,
        updateAvailable: true,
        blockerReason: '',
        contentIncludedInAudit: false,
      },
    })
  } catch (err) {
    throw failTruthDriftAuditClosed(err, {
      sessionId: serializedSession.sessionId,
      truthSignatureId: serializedSession.truthSignatureId,
      truthSignatureCurrentness,
    })
  }

  const updateProofMissing = TRUTH_SIGNATURE_REQUIRED_CURRENT_PROOF
    .some((key) => !normalizeText(currentEvidence[key]))
  if (updateProofMissing) {
    throw createOutcomeStudioError({
      status: 409,
      code: 'CONFLICT',
      message: 'Outcome Studio update-from-latest-truth requires complete current runtime proof.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_TRUTH_UPDATE_BLOCKED,
      details: {
        sessionId: serializedSession.sessionId,
        truthSignatureId: serializedSession.truthSignatureId,
        truthSignatureCurrentness: truthSignatureCurrentness || '',
        updateAvailable: false,
        blockerReason: 'CURRENT_RUNTIME_PROOF_INCOMPLETE',
        safetyGate: {
          code: OUTCOME_STUDIO_SAFETY_GATE_CODES.TRUTH_UPDATE_WORKFLOW,
          status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
        },
      },
    })
  }

  const boundAt = new Date().toISOString()
  const previousTruthSignature = serializedSession.truthSignature || {}
  const nextTruthSignatureId = buildTruthSignatureId()
  const nextEvidence = {
    ...currentEvidence,
    sourceOutputAssetId: serializedSession.sourceOutputAssetId,
  }
  const nextTruthSignature = {
    ...cloneValue(previousTruthSignature),
    truthSignatureId: nextTruthSignatureId,
    status: OUTCOME_STUDIO_BINDING_STATUSES.PROJECTED,
    mode: previousTruthSignature.mode || 'PROJECTED_FROM_RUNTIME_EVIDENCE',
    persistence: 'SESSION_BOUND',
    currentness: 'CURRENT',
    boundAt,
    evidence: nextEvidence,
    missingEvidence: [],
  }
  const runtimeScope = getRuntimeScope(runtimeInstance)
  const truthSignatureRecord = new TruthSignature({
    truthSignatureId: nextTruthSignatureId,
    sessionId: serializedSession.sessionId,
    ...runtimeScope,
    contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
    phase: OUTCOME_STUDIO_PHASE,
    status: nextTruthSignature.status,
    mode: nextTruthSignature.mode,
    persistence: nextTruthSignature.persistence,
    currentness: nextTruthSignature.currentness,
    sourceOutputAssetId: serializedSession.sourceOutputAssetId,
    sourceOutputTypeKey: serializedSession.sourceOutputTypeKey,
    sourceOutputTypeLabel: serializedSession.sourceOutputTypeLabel,
    sourceOutputSnapshot: serializedSession.sourceOutput,
    evidence: nextEvidence,
    missingEvidence: [],
    certification: previousTruthSignature.certification || null,
    graph: previousTruthSignature.graph || {},
    boundBy: actorUserId,
    boundAt,
  })
  const sessionUpdate = {
    truthSignatureId: nextTruthSignatureId,
    truthSignature: nextTruthSignature,
    lastActivityAt: boundAt,
  }
  const rollbackSessionUpdate = {
    truthSignatureId: serializedSession.truthSignatureId,
    truthSignature: previousTruthSignature,
    lastActivityAt: serializedSession.lastActivityAt || serializedSession.updatedAt || serializedSession.startedAt || boundAt,
  }
  const assetRebindFilter = {
    runtimeInstanceId: runtimeObjectId,
    sessionId: serializedSession.sessionId,
  }
  const assetVersionRebindFilter = {
    ...assetRebindFilter,
    status: OUTCOME_STUDIO_ASSET_VERSION_STATUSES.CURRENT,
  }
  const nextAssetTruthUpdate = {
    truthSignature: nextTruthSignature,
    'lineageSummary.truthSignatureStatus': nextTruthSignature.status,
    'lineageSummary.truthSignatureCurrentness': nextTruthSignature.currentness,
  }
  const previousAssetTruthUpdate = {
    truthSignature: previousTruthSignature,
    'lineageSummary.truthSignatureStatus': previousTruthSignature.status,
    'lineageSummary.truthSignatureCurrentness': truthSignatureCurrentness,
  }
  let assetRebindResult = { modifiedCount: 0, matchedCount: 0 }
  let assetVersionRebindResult = { modifiedCount: 0, matchedCount: 0 }

  try {
    await truthSignatureRecord.save()
    await OutcomeSession.updateOne(
      { runtimeInstanceId: runtimeObjectId, sessionId: serializedSession.sessionId },
      { $set: sessionUpdate },
    )
    assetRebindResult = await OutcomeAsset.updateMany(
      assetRebindFilter,
      { $set: nextAssetTruthUpdate },
    )
    assetVersionRebindResult = await OutcomeAssetVersion.updateMany(
      assetVersionRebindFilter,
      { $set: nextAssetTruthUpdate },
    )
  } catch (err) {
    await OutcomeAsset.updateMany(
      assetRebindFilter,
      { $set: previousAssetTruthUpdate },
    )
    await OutcomeAssetVersion.updateMany(
      assetVersionRebindFilter,
      { $set: previousAssetTruthUpdate },
    )
    await TruthSignature.deleteOne({ _id: truthSignatureRecord._id })
    await OutcomeSession.updateOne(
      { runtimeInstanceId: runtimeObjectId, sessionId: serializedSession.sessionId },
      { $set: rollbackSessionUpdate },
    )
    throw err
  }

  try {
    await logOutcomeSessionAudit({
      action: auditService.AUDIT_ACTIONS.OUTCOME_UPDATED_FROM_NEW_TRUTH,
      auditRequest,
      runtimeInstance,
      session: {
        ...serializedSession,
        _id: session._id || session.id,
        truthSignatureId: nextTruthSignatureId,
      },
      summary: 'Outcome Studio session Truth Signature updated from current runtime proof.',
      diff: {
        actorUserId,
        sessionId: serializedSession.sessionId,
        previousTruthSignatureId: serializedSession.truthSignatureId,
        nextTruthSignatureId,
        previousTruthSignatureCurrentness: truthSignatureCurrentness,
        nextTruthSignatureCurrentness: 'CURRENT',
        previousEvidence: previousTruthSignature.evidence || {},
        currentEvidence: nextEvidence,
        reboundOutcomeAssets: Number(assetRebindResult?.modifiedCount || 0),
        reboundOutcomeAssetVersions: Number(assetVersionRebindResult?.modifiedCount || 0),
        contentIncludedInAudit: false,
      },
    })
  } catch (err) {
    await OutcomeSession.updateOne(
      { runtimeInstanceId: runtimeObjectId, sessionId: serializedSession.sessionId },
      { $set: rollbackSessionUpdate },
    )
    await OutcomeAsset.updateMany(
      assetRebindFilter,
      { $set: previousAssetTruthUpdate },
    )
    await OutcomeAssetVersion.updateMany(
      assetVersionRebindFilter,
      { $set: previousAssetTruthUpdate },
    )
    await TruthSignature.deleteOne({ _id: truthSignatureRecord._id })
    throw failTruthUpdateAuditClosed(err, {
      sessionId: serializedSession.sessionId,
      previousTruthSignatureId: serializedSession.truthSignatureId,
      nextTruthSignatureId,
    })
  }

  return {
    ...serializedSession,
    truthSignatureId: nextTruthSignatureId,
    truthSignature: sanitizePersistedTruthSignature(nextTruthSignature, { currentEvidence: nextEvidence }),
    updatedAt: boundAt,
    lastActivityAt: boundAt,
    update: {
      status: 'UPDATED',
      previousTruthSignatureId: serializedSession.truthSignatureId,
      truthSignatureId: nextTruthSignatureId,
      truthSignatureCurrentness: 'CURRENT',
      reboundOutcomeAssets: Number(assetRebindResult?.modifiedCount || 0),
      reboundOutcomeAssetVersions: Number(assetVersionRebindResult?.modifiedCount || 0),
    },
  }
}
