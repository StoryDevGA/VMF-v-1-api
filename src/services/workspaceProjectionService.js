import {
  DEFAULT_OUTCOME_ASSET_TYPE,
  DEFAULT_OUTCOME_WORKSPACE_TYPE,
  WORKSPACE_MESSAGE_TYPES,
} from '../constants/workspaceGovernance.js'
import {
  OUTCOME_STUDIO_MESSAGE_ROLES,
} from '../constants/runtimeOutcomeStudio.js'
import { toIdString } from './runtimeInstanceService.js'

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeDateValue = (value) => {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString()
  return normalizeText(value)
}

const toPlainObject = (value) => {
  if (!value) return {}
  if (typeof value.toJSON === 'function') return value.toJSON()
  if (typeof value.toObject === 'function') return value.toObject()
  return value
}

const cloneSafeValue = (value) => {
  if (value === undefined) return undefined
  if (value === null) return null
  const visited = new WeakSet()

  try {
    const serialized = JSON.stringify(value, (_key, nestedValue) => {
      if (typeof nestedValue === 'bigint') return String(nestedValue)
      if (nestedValue && typeof nestedValue === 'object') {
        if (visited.has(nestedValue)) return undefined
        visited.add(nestedValue)
      }
      return nestedValue
    })
    if (serialized === undefined) {
      return Array.isArray(value) ? [] : {}
    }
    return JSON.parse(serialized)
  } catch {
    return Array.isArray(value) ? [] : {}
  }
}

const sanitizeTruthSignature = (truthSignature = {}) => ({
  truthSignatureId: normalizeText(truthSignature.truthSignatureId),
  status: normalizeToken(truthSignature.status),
  mode: normalizeText(truthSignature.mode),
  persistence: normalizeText(truthSignature.persistence),
  currentness: normalizeToken(truthSignature.currentness),
  boundAt: normalizeDateValue(truthSignature.boundAt),
  evidence: truthSignature.evidence && typeof truthSignature.evidence === 'object'
    ? cloneSafeValue(truthSignature.evidence)
    : {},
  missingEvidence: Array.isArray(truthSignature.missingEvidence)
    ? truthSignature.missingEvidence.map((item) => ({
        key: normalizeText(item?.key),
        label: normalizeText(item?.label),
      })).filter((item) => item.key || item.label)
    : [],
})

const sanitizeKnowledgeBinding = (binding = {}) => ({
  status: normalizeToken(binding.status),
  mode: normalizeText(binding.mode),
  boundAt: normalizeDateValue(binding.boundAt),
  activeCount: Number(binding.activeCount || 0),
  requiredCount: Number(binding.requiredCount || 0),
  activePacks: Array.isArray(binding.activePacks)
    ? binding.activePacks.map((pack) => ({
        packCategory: normalizeToken(pack?.packCategory),
        packType: normalizeToken(pack?.packType),
        packKey: normalizeText(pack?.packKey),
        label: normalizeText(pack?.label),
        semanticVersion: normalizeText(pack?.semanticVersion),
        status: normalizeToken(pack?.status),
        scopeType: normalizeToken(pack?.scopeType),
        scopeKey: normalizeText(pack?.scopeKey),
        contentHash: normalizeText(pack?.contentHash),
      })).filter((pack) => pack.packType || pack.packKey)
    : [],
  requiredPacks: Array.isArray(binding.requiredPacks)
    ? binding.requiredPacks.map((pack) => ({
        packCategory: normalizeToken(pack?.packCategory),
        packType: normalizeToken(pack?.packType),
        packKey: normalizeText(pack?.packKey),
        label: normalizeText(pack?.label),
        status: normalizeToken(pack?.status),
        runtimeBindable: pack?.runtimeBindable === true,
      })).filter((pack) => pack.packType || pack.packKey)
    : [],
  resolution: binding.resolution && typeof binding.resolution === 'object'
    ? {
        status: normalizeToken(binding.resolution.status),
        activeCount: Number(binding.resolution.activeCount || 0),
        requiredCount: Number(binding.resolution.requiredCount || 0),
        scopeCandidates: Array.isArray(binding.resolution.scopeCandidates)
          ? binding.resolution.scopeCandidates.map((candidate) => ({
              scopeType: normalizeToken(candidate?.scopeType),
              scopeKey: normalizeText(candidate?.scopeKey),
              precedence: Number(candidate?.precedence || 0),
            }))
          : [],
      }
    : {},
})

const sanitizeContextBindings = (bindings = {}) => {
  const plain = bindings && typeof bindings === 'object' ? cloneSafeValue(bindings) : {}
  return plain && typeof plain === 'object' ? plain : {}
}

const buildCommonRuntimeProjection = (plain = {}) => ({
  runtimeInstanceId: toIdString(plain.runtimeInstanceId),
  runtimeInstanceKey: normalizeText(plain.runtimeInstanceKey),
  runtimeType: normalizeToken(plain.runtimeType),
  frameworkKey: normalizeToken(plain.frameworkKey),
  packageKey: normalizeText(plain.packageKey),
  packageVersion: normalizeText(plain.packageVersion),
  projectId: normalizeText(plain.projectId),
  outcomeId: normalizeText(plain.outcomeId),
  customerId: toIdString(plain.customerId),
  tenantId: toIdString(plain.tenantId),
})

const resolveWorkspaceMessageType = (plain = {}) => {
  const explicitType = normalizeToken(plain.messageType)
  if (Object.values(WORKSPACE_MESSAGE_TYPES).includes(explicitType)) return explicitType

  const role = normalizeToken(plain.role)
  if (role === OUTCOME_STUDIO_MESSAGE_ROLES.ASSISTANT) {
    return WORKSPACE_MESSAGE_TYPES.GOVERNED_RESPONSE
  }
  if (role === OUTCOME_STUDIO_MESSAGE_ROLES.USER) {
    return WORKSPACE_MESSAGE_TYPES.CUSTOMER_PROMPT
  }
  return WORKSPACE_MESSAGE_TYPES.SYSTEM_EVENT
}

const getTruthSignature = (plain = {}) => sanitizeTruthSignature(plain.truthSignature || {})
const getKnowledgeBinding = (plain = {}) =>
  sanitizeKnowledgeBinding(plain.knowledgeBinding || plain.knowledgePackBinding || {})

export const projectOutcomeSessionToWorkspaceSession = (session = {}) => {
  const plain = toPlainObject(session)
  const truthSignature = getTruthSignature(plain)
  return {
    workspaceType: normalizeToken(plain.workspaceType) || DEFAULT_OUTCOME_WORKSPACE_TYPE,
    workspaceSessionId: normalizeText(plain.workspaceSessionId || plain.sessionId),
    status: normalizeToken(plain.status),
    ...buildCommonRuntimeProjection(plain),
    truthSignatureId: normalizeText(plain.truthSignatureId || truthSignature.truthSignatureId),
    truthSignature,
    knowledgeBinding: getKnowledgeBinding(plain),
    contextBindings: sanitizeContextBindings(plain.contextBindings),
    sourceOutputBinding: {
      sourceOutputAssetId: normalizeText(plain.sourceOutputAssetId),
      sourceOutputTypeKey: normalizeToken(plain.sourceOutputTypeKey),
      sourceOutputTypeLabel: normalizeText(plain.sourceOutputTypeLabel),
    },
    promptAvailable: Boolean(normalizeText(plain.prompt)),
    startedBy: toIdString(plain.startedBy),
    startedAt: normalizeDateValue(plain.startedAt),
    lastActivityAt: normalizeDateValue(plain.lastActivityAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
    sourceRecord: {
      model: 'OutcomeSession',
      id: toIdString(plain._id || plain.id),
      key: normalizeText(plain.sessionId),
    },
  }
}

export const projectOutcomeMessageToWorkspaceMessage = (message = {}) => {
  const plain = toPlainObject(message)
  return {
    workspaceType: normalizeToken(plain.workspaceType) || DEFAULT_OUTCOME_WORKSPACE_TYPE,
    workspaceSessionId: normalizeText(plain.workspaceSessionId || plain.sessionId),
    workspaceMessageId: normalizeText(plain.workspaceMessageId || plain.messageId),
    messageType: resolveWorkspaceMessageType(plain),
    role: normalizeToken(plain.role),
    status: normalizeToken(plain.status),
    responseStatus: normalizeToken(plain.responseStatus),
    ...buildCommonRuntimeProjection(plain),
    truthSignature: getTruthSignature(plain),
    knowledgeBinding: getKnowledgeBinding(plain),
    contextBindings: sanitizeContextBindings(plain.contextBindings),
    promptAvailable: Boolean(normalizeText(plain.prompt)),
    submittedBy: toIdString(plain.submittedBy),
    submittedAt: normalizeDateValue(plain.submittedAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
    sourceRecord: {
      model: 'OutcomeMessage',
      id: toIdString(plain._id || plain.id),
      key: normalizeText(plain.messageId),
    },
  }
}

export const projectOutcomeAssetToWorkspaceAsset = (asset = {}) => {
  const plain = toPlainObject(asset)
  return {
    workspaceType: normalizeToken(plain.workspaceType) || DEFAULT_OUTCOME_WORKSPACE_TYPE,
    workspaceAssetId: normalizeText(plain.workspaceAssetId || plain.outcomeAssetId),
    workspaceSessionId: normalizeText(plain.workspaceSessionId || plain.sessionId),
    assetType: normalizeToken(plain.assetType) || DEFAULT_OUTCOME_ASSET_TYPE,
    status: normalizeToken(plain.status),
    ...buildCommonRuntimeProjection(plain),
    currentVersionId: normalizeText(plain.currentVersionId),
    currentVersionNumber: Number(plain.currentVersionNumber || 0),
    outputTypeKey: normalizeToken(plain.outputTypeKey),
    outputTypeLabel: normalizeText(plain.outputTypeLabel),
    title: normalizeText(plain.title),
    sourceOutputAssetId: normalizeText(plain.sourceOutputAssetId),
    truthSignature: getTruthSignature(plain),
    knowledgeBinding: getKnowledgeBinding(plain),
    contextBindings: sanitizeContextBindings(plain.contextBindings),
    lineageSummary: plain.lineageSummary && typeof plain.lineageSummary === 'object'
      ? cloneSafeValue(plain.lineageSummary)
      : {},
    warnings: Array.isArray(plain.warnings) ? plain.warnings.map(normalizeText).filter(Boolean) : [],
    limitations: Array.isArray(plain.limitations) ? plain.limitations.map(normalizeText).filter(Boolean) : [],
    generatedBy: toIdString(plain.generatedBy),
    generatedAt: normalizeDateValue(plain.generatedAt),
    publishedBy: toIdString(plain.publishedBy),
    publishedAt: normalizeDateValue(plain.publishedAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
    sourceRecord: {
      model: 'OutcomeAsset',
      id: toIdString(plain._id || plain.id),
      key: normalizeText(plain.outcomeAssetId),
    },
  }
}

export const projectOutcomeAssetVersionToWorkspaceAssetVersion = (version = {}) => {
  const plain = toPlainObject(version)
  const customerContent = plain.customerContent && typeof plain.customerContent === 'object'
    ? plain.customerContent
    : {}
  return {
    workspaceType: normalizeToken(plain.workspaceType) || DEFAULT_OUTCOME_WORKSPACE_TYPE,
    workspaceAssetId: normalizeText(plain.workspaceAssetId || plain.outcomeAssetId),
    workspaceAssetVersionId: normalizeText(plain.workspaceAssetVersionId || plain.outcomeAssetVersionId),
    parentVersionId: normalizeText(plain.parentVersionId),
    workspaceSessionId: normalizeText(plain.workspaceSessionId || plain.sessionId),
    assetType: normalizeToken(plain.assetType) || DEFAULT_OUTCOME_ASSET_TYPE,
    versionNumber: Number(plain.versionNumber || 0),
    status: normalizeToken(plain.status),
    ...buildCommonRuntimeProjection(plain),
    outputTypeKey: normalizeToken(plain.outputTypeKey),
    outputTypeLabel: normalizeText(plain.outputTypeLabel),
    title: normalizeText(plain.title),
    sourceOutputAssetId: normalizeText(plain.sourceOutputAssetId),
    truthSignature: getTruthSignature(plain),
    knowledgeBinding: getKnowledgeBinding(plain),
    contextBindings: sanitizeContextBindings(plain.contextBindings),
    lineageSummary: plain.lineageSummary && typeof plain.lineageSummary === 'object'
      ? cloneSafeValue(plain.lineageSummary)
      : {},
    contentAvailable: Object.keys(customerContent).length > 0,
    warnings: Array.isArray(plain.warnings) ? plain.warnings.map(normalizeText).filter(Boolean) : [],
    limitations: Array.isArray(plain.limitations) ? plain.limitations.map(normalizeText).filter(Boolean) : [],
    generatedBy: toIdString(plain.generatedBy),
    generatedAt: normalizeDateValue(plain.generatedAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
    sourceRecord: {
      model: 'OutcomeAssetVersion',
      id: toIdString(plain._id || plain.id),
      key: normalizeText(plain.outcomeAssetVersionId),
    },
  }
}
