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
  OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES,
  OUTCOME_STUDIO_DRAFT_ITERATION_TYPES,
  OUTCOME_STUDIO_DRAFT_DISCARD_BLOCKER_REASONS,
  OUTCOME_STUDIO_DRAFT_STATUSES,
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
  OutcomeDraft,
  OutcomeDraftIteration,
  OutcomeMessage,
  OutcomeSession,
  TruthSignature,
} from '../models/index.js'
import { resolveOutcomeStudioKnowledgePackBinding } from './outcomeKnowledgePackRegistryService.js'
import {
  projectOutcomeStudioDeliverableDiscovery,
  resolveOutcomeStudioKnowledgeContext,
} from './outcomeStudioKnowledgeContextService.js'
import {
  describeOutputDerivative,
  isOutputServiceError,
  OUTPUT_SERVICE_ERROR_CODES,
  renderOutputDerivative,
} from './outputService.js'
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
import {
  buildOutcomeAssetPostValidationSnapshot,
  buildOutcomePostValidationAuditSummary,
  isOutcomePostValidationAllowed,
  sanitizeOutcomePostValidationSnapshot,
} from './outcomePostValidationService.js'
import { validateOutcomeCustomerLanguage } from './outcomeCustomerLanguageService.js'
import auditService from './auditService.js'
import {
  createGovernedReasoningExecution,
  resolveLiveTestConfiguration,
} from './governedReasoningRuntimeService.js'
import { authorizeOutcomeStudioLiveTestExecution } from './outcomeStudioReadinessService.js'
import {
  assertOutcomeStudioRequestResolution,
  buildResolvedOutcomeStudioExecutionIntent,
} from './outcomeStudioResolutionService.js'

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeCapabilityKey = (value) => normalizeText(value).toLowerCase()
const projectApprovedOutcomeTitle = ({ outputTypeLabel = '', title = '' } = {}) => {
  const normalizedLabel = normalizeText(outputTypeLabel)
  const normalizedTitle = normalizeText(title)
  if (normalizedLabel && normalizedTitle === `${normalizedLabel} Draft`) return normalizedLabel
  return normalizedTitle
}
const clampText = (value, maxLength = 120) => {
  const normalized = normalizeText(value)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`
}
const normalizePackCategory = (value, packType) =>
  resolveKnowledgePackCategory({ packCategory: value, packType })
const canUseMongoTransaction = () => mongoose.connection.readyState === 1

export const OUTCOME_STUDIO_ERROR_REASONS = Object.freeze({
  OUTCOME_ASSET_EXPORT_BLOCKED: 'OUTCOME_ASSET_EXPORT_BLOCKED',
  OUTCOME_ASSET_EXPORT_AUDIT_FAILED: 'OUTCOME_ASSET_EXPORT_AUDIT_FAILED',
  OUTCOME_ASSET_EXPORT_CONTENT_UNAVAILABLE: 'OUTCOME_ASSET_EXPORT_CONTENT_UNAVAILABLE',
  OUTCOME_ASSET_EXPORT_FORMAT_UNSUPPORTED: 'OUTCOME_ASSET_EXPORT_FORMAT_UNSUPPORTED',
  OUTCOME_ASSET_EXPORT_RENDER_FAILED: 'OUTCOME_ASSET_EXPORT_RENDER_FAILED',
  OUTCOME_ASSET_GENERATION_AUDIT_FAILED: 'OUTCOME_ASSET_GENERATION_AUDIT_FAILED',
  OUTCOME_ASSET_NOT_FOUND: 'OUTCOME_ASSET_NOT_FOUND',
  OUTCOME_ASSET_POST_VALIDATION_BLOCKED: 'OUTCOME_ASSET_POST_VALIDATION_BLOCKED',
  OUTCOME_ASSET_PREVIEW_BLOCKED: 'OUTCOME_ASSET_PREVIEW_BLOCKED',
  OUTCOME_ASSET_PREVIEW_CONTENT_UNAVAILABLE: 'OUTCOME_ASSET_PREVIEW_CONTENT_UNAVAILABLE',
  OUTCOME_ASSET_PUBLISH_AUDIT_FAILED: 'OUTCOME_ASSET_PUBLISH_AUDIT_FAILED',
  OUTCOME_ASSET_PUBLISH_BLOCKED: 'OUTCOME_ASSET_PUBLISH_BLOCKED',
  OUTCOME_ASSET_VERSION_NOT_FOUND: 'OUTCOME_ASSET_VERSION_NOT_FOUND',
  OUTCOME_DRAFT_APPROVAL_AUDIT_FAILED: 'OUTCOME_DRAFT_APPROVAL_AUDIT_FAILED',
  OUTCOME_DRAFT_APPROVAL_BLOCKED: 'OUTCOME_DRAFT_APPROVAL_BLOCKED',
  OUTCOME_DRAFT_DISCARD_AUDIT_FAILED: 'OUTCOME_DRAFT_DISCARD_AUDIT_FAILED',
  OUTCOME_DRAFT_DISCARD_BLOCKED: 'OUTCOME_DRAFT_DISCARD_BLOCKED',
  OUTCOME_DRAFT_GENERATION_AUDIT_FAILED: 'OUTCOME_DRAFT_GENERATION_AUDIT_FAILED',
  OUTCOME_DRAFT_NOT_FOUND: 'OUTCOME_DRAFT_NOT_FOUND',
  OUTCOME_DRAFT_PREVIEW_BLOCKED: 'OUTCOME_DRAFT_PREVIEW_BLOCKED',
  OUTCOME_DRAFT_PREVIEW_CONTENT_UNAVAILABLE: 'OUTCOME_DRAFT_PREVIEW_CONTENT_UNAVAILABLE',
  OUTCOME_DRAFT_REFINEMENT_AUDIT_FAILED: 'OUTCOME_DRAFT_REFINEMENT_AUDIT_FAILED',
  OUTCOME_DRAFT_REFINEMENT_BLOCKED: 'OUTCOME_DRAFT_REFINEMENT_BLOCKED',
  OUTCOME_CUSTOMER_CONTENT_BLOCKED: 'OUTCOME_CUSTOMER_CONTENT_BLOCKED',
  OUTCOME_DRAFTING_SERVICE_UNAVAILABLE: 'OUTCOME_DRAFTING_SERVICE_UNAVAILABLE',
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
const OUTCOME_STUDIO_DRAFT_LIST_LIMIT = 20
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

const assertPersistedOutputTypeCapabilityKey = ({
  actionLabel,
  availabilityKey,
  customerMessage,
  reason,
  records = [],
} = {}) => {
  const capabilityKey = records
    .map((record) => normalizeCapabilityKey(record?.outputTypeCapabilityKey))
    .find(Boolean) || ''
  if (capabilityKey) return capabilityKey

  throw createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: customerMessage || `Outcome Studio cannot ${actionLabel} until its output type is confirmed.`,
    reason,
    details: {
      [availabilityKey]: false,
      blockerReason: 'OUTPUT_TYPE_CAPABILITY_IDENTITY_MISSING',
    },
  })
}

const buildCustomerContentReviewError = ({ action = 'continue' } = {}) =>
  createOutcomeStudioError({
    status: 409,
    code: 'CUSTOMER_CONTENT_REQUIRES_REVIEW',
    message: `This content requires review before Outcome Studio can ${action}.`,
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_CUSTOMER_CONTENT_BLOCKED,
    details: {
      actionAvailable: false,
    },
  })

const buildDraftingServiceUnavailableError = () =>
  createOutcomeStudioError({
    status: 409,
    code: 'DRAFTING_SERVICE_UNAVAILABLE',
    message: 'Draft generation is temporarily unavailable. No response or draft was created.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFTING_SERVICE_UNAVAILABLE,
    details: {
      responseCreated: false,
      draftCreated: false,
    },
  })

const projectOutcomeCustomerContent = (value = {}) => {
  const source = value && typeof value === 'object' ? value : {}
  const markdown = normalizeText(source.markdown)
  const sections = Array.isArray(source.sections)
    ? source.sections
        .map((section, index) => ({
          key: normalizeText(section?.key) || `section-${index + 1}`,
          label: normalizeText(section?.label || section?.heading) || `Section ${index + 1}`,
          body: normalizeText(section?.body || section?.markdown),
        }))
        .filter((section) => section.label || section.body)
    : []
  return {
    ...(markdown ? { markdown } : {}),
    ...(sections.length > 0 ? { sections } : {}),
  }
}

const getOutcomeGenerationMode = (record = {}) => normalizeToken(
  record?.lineageSummary?.grrProviderMode
  || record?.customerContent?.metadata?.grrProviderMode
  || record?.customerContent?.metadata?.generationMode,
)

const isNonCustomerReadyGeneration = (record = {}) => {
  const mode = getOutcomeGenerationMode(record)
  return mode === 'DETERMINISTIC_TEST'
    || mode === 'DETERMINISTIC'
    || mode === 'DETERMINISTIC_SCAFFOLD'
}

const assertCustomerReadyGeneration = (record = {}) => {
  if (isNonCustomerReadyGeneration(record)) throw buildDraftingServiceUnavailableError()
}

const assertOutcomeCustomerLanguage = ({
  action = 'continue',
  customerContent = {},
  filename = '',
  limitations = [],
  title = '',
  warnings = [],
} = {}) => {
  const validation = validateOutcomeCustomerLanguage({
    customerContent: projectOutcomeCustomerContent(customerContent),
    filename,
    limitations,
    title,
    warnings,
  })
  if (!validation.safe) throw buildCustomerContentReviewError({ action })
  return validation
}

const cloneValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
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
const buildOutcomeDraftId = () => `outcome_draft_${randomUUID()}`
const buildOutcomeDraftIterationId = () => `outcome_draft_iteration_${randomUUID()}`
const buildOutcomeSessionId = () => `out_sess_${randomUUID()}`
const buildTruthSignatureId = () => `truth_sig_${randomUUID()}`

const isEnvEnabled = (value) => ['1', 'TRUE', 'YES', 'ENABLED', 'ON'].includes(normalizeToken(value))
const isEnvDisabled = (value) => ['0', 'FALSE', 'NO', 'DISABLED', 'OFF'].includes(normalizeToken(value))

const isOutcomeStudioGrrEnabled = () => {
  const explicitFlag = process.env.STORYLINEOS_OUTCOME_STUDIO_GRR_ENABLED
  if (isEnvEnabled(explicitFlag)) return true
  if (isEnvDisabled(explicitFlag)) return false

  if (process.env.NODE_ENV === 'production') return false
  return true
}

const buildOutcomeAssetTitle = ({ session = {} } = {}) => {
  const outputTypeLabel = normalizeText(
    session.requestedOutputTypeLabel
    || session.sourceOutputTypeLabel
    || session.sourceOutput?.outputTypeLabel,
  )
  return outputTypeLabel ? `Governed ${outputTypeLabel}` : 'Governed Outcome Asset'
}

const buildOutcomeDraftTitle = ({ outputTypeLabel = '', session = {} } = {}) => {
  const resolvedOutputTypeLabel = normalizeText(
    outputTypeLabel
    || session.requestedOutputTypeLabel
    || session.sourceOutputTypeLabel
    || session.sourceOutput?.outputTypeLabel,
  )
  return resolvedOutputTypeLabel ? `${resolvedOutputTypeLabel} Draft` : 'Outcome Draft'
}

const buildGeneratedOutcomeDraftCustomerContent = ({
  responseText = '',
  session = {},
  title = '',
} = {}) => {
  const resolvedTitle = normalizeText(title) || buildOutcomeDraftTitle({ session })

  return {
    markdown: responseText,
    sections: [
      {
        key: 'draft-body',
        label: resolvedTitle,
        body: responseText,
      },
    ],
  }
}

const buildGeneratedOutcomeAssetLineageSummary = ({
  generatedAt = '',
  grrExecution = null,
  parentVersionId = '',
  runtimeInstance = {},
  session = {},
} = {}) => {
  const frameworkState = getFrameworkState(runtimeInstance)
  const revision = getObjectValue(frameworkState, 'revision') || {}
  const grrArtifact = grrExecution?.artifact && typeof grrExecution.artifact === 'object'
    ? grrExecution.artifact
    : null
  const grrCertification = grrArtifact?.certification && typeof grrArtifact.certification === 'object'
    ? grrArtifact.certification
    : {}
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
    grrExecutionId: normalizeText(grrExecution?.executionId),
    grrRuntimeArtifactId: normalizeText(grrArtifact?.runtimeArtifactId),
    grrProviderMode: normalizeToken(grrExecution?.providerMode),
    grrRuntimeStateWrites: {
      status: normalizeToken(grrExecution?.runtimeStateWrites?.status),
      reason: normalizeText(grrExecution?.runtimeStateWrites?.reason),
    },
    grrKnowledgeBinding: {
      manifestId: normalizeText(grrExecution?.knowledgeManifest?.manifestId),
      manifestKey: normalizeText(grrExecution?.knowledgeManifest?.manifestKey),
      manifestVersion: normalizeText(grrExecution?.knowledgeManifest?.semanticVersion),
      status: normalizeToken(grrExecution?.knowledgeBinding?.status),
      contentVisible: grrExecution?.knowledgeBinding?.contentVisible === true,
      packContentLoaded: grrExecution?.knowledgeBinding?.packContentLoaded === true,
    },
    grrCertification: {
      certifiedTruthOnly: grrCertification.certifiedTruthOnly === true,
      runtimeArtifactIsCertifiedTruth: grrCertification.runtimeArtifactIsCertifiedTruth === true,
      requiresSeparateCertificationBeforeTruthReuse:
        grrCertification.requiresSeparateCertificationBeforeTruthReuse === true,
    },
  }
}

const buildGrrOutcomeResponseText = ({
  grrExecution = null,
  outputTypeLabel = '',
  session = {},
} = {}) => {
  const artifact = grrExecution?.artifact && typeof grrExecution.artifact === 'object'
    ? grrExecution.artifact
    : {}
  const generatedOutput = artifact.generatedOutput && typeof artifact.generatedOutput === 'object'
    ? artifact.generatedOutput
    : {}
  const markdown = normalizeText(artifact.markdown)
  if (markdown && normalizeToken(grrExecution?.providerMode) !== 'DETERMINISTIC_TEST') return markdown

  const title = buildOutcomeDraftTitle({ outputTypeLabel, session })
  const summary = normalizeText(generatedOutput.summary)
  const sections = Array.isArray(generatedOutput.sections) ? generatedOutput.sections : []
  const sectionMarkdown = sections
    .map((section, index) => {
      const heading = normalizeText(section?.heading) || `Section ${index + 1}`
      const narrative = normalizeText(section?.narrative || section?.body || section?.summary)
      return [`## ${heading}`, narrative].filter(Boolean).join('\n\n')
    })
    .filter(Boolean)

  return [
    `# ${title}`,
    summary,
    ...sectionMarkdown,
  ].filter(Boolean).join('\n\n')
}

const getDraftIterationMarkdown = (iteration = {}) => {
  const customerContent = iteration?.customerContent && typeof iteration.customerContent === 'object'
    ? iteration.customerContent
    : {}
  const markdown = normalizeText(customerContent.markdown)
  if (markdown) return markdown

  const sectionBody = Array.isArray(customerContent.sections)
    ? customerContent.sections
      .map((section) => normalizeText(section?.body || section?.summary || section?.narrative))
      .filter(Boolean)
      .join('\n\n')
    : ''
  return sectionBody || ''
}

const getDraftRefinementOperationMode = () => 'FULL_DRAFT'

const buildDraftRefinementMetadata = ({
  currentIteration = {},
  requestResolution = {},
} = {}) => ({
  operation: 'DRAFT_REFINEMENT',
  mode: getDraftRefinementOperationMode({ requestResolution }),
  intentType: normalizeToken(requestResolution?.intent?.type),
  sourceIterationId: normalizeText(currentIteration.draftIterationId),
  sourceIterationNumber: Number(currentIteration.iterationNumber || 0),
  compare: {
    available: true,
    fromIterationId: normalizeText(currentIteration.draftIterationId),
    toIterationId: '',
  },
  revert: {
    available: true,
    targetIterationId: normalizeText(currentIteration.draftIterationId),
  },
  preservedPreviousContent: true,
})

const buildRefinedOutcomeDraftResponseText = ({
  currentIteration = {},
  generatedResponseText = '',
  grrExecution = null,
  message = {},
  outputTypeLabel = '',
  requestResolution = {},
  session = {},
} = {}) => {
  const providerMode = normalizeToken(grrExecution?.providerMode)
  const generatedText = normalizeText(generatedResponseText)
  if (generatedText && providerMode && providerMode !== 'DETERMINISTIC_TEST') return generatedText

  const title = buildOutcomeDraftTitle({ outputTypeLabel, session })
  const previousMarkdown = getDraftIterationMarkdown(currentIteration) || `# ${title}`
  const refinementRequest = clampText(normalizeText(message.prompt), 500)
  const intentType = normalizeToken(requestResolution?.intent?.type) || 'REFINEMENT_REQUEST'
  return [
    previousMarkdown,
    '',
    '## Draft Refinement Update',
    '',
    `Intent: ${intentType}.`,
    refinementRequest ? `Requested change: ${refinementRequest}` : '',
    'Unchanged draft sections are preserved from the previous iteration unless the requested refinement explicitly changes them.',
  ].filter(Boolean).join('\n\n')
}

const buildGrrExecutionIntent = ({
  currentDraftIteration = null,
  message = {},
  requestResolution = null,
  session = {},
} = {}) => {
  const prompt = normalizeText(message.prompt)
  const currentDraftContext = requestResolution?.intent?.refinement
    ? clampText(getDraftIterationMarkdown(currentDraftIteration), 2500)
    : ''
  if (requestResolution?.canProceed) {
    return [
      buildResolvedOutcomeStudioExecutionIntent({
        prompt,
        resolution: requestResolution,
      }),
      currentDraftContext
        ? `Current conversation draft content for refinement:\n${currentDraftContext}`
        : '',
    ].filter(Boolean).join('\n\n').slice(0, 5000)
  }

  const outputTypeLabel = normalizeText(session.sourceOutputTypeLabel || session.sourceOutput?.outputTypeLabel)
  return [
    outputTypeLabel ? `Outcome Studio ${outputTypeLabel} request.` : 'Outcome Studio governed response request.',
    prompt,
  ].filter(Boolean).join('\n\n').slice(0, 2000)
}

const buildOutcomeWarningsFromGrr = ({ grrExecution = null } = {}) => {
  const warnings = Array.isArray(grrExecution?.artifact?.warnings)
    ? grrExecution.artifact.warnings
    : Array.isArray(grrExecution?.warnings)
      ? grrExecution.warnings
      : []
  return warnings
    .map(normalizeText)
    .filter((warning) => warning && validateOutcomeCustomerLanguage(warning, {
      path: 'warnings',
    }).safe)
}

const buildOutcomeLimitationsFromGrr = ({ grrExecution = null } = {}) => {
  if (!grrExecution) return []

  const limitations = Array.isArray(grrExecution?.artifact?.limitations)
    ? grrExecution.artifact.limitations
    : Array.isArray(grrExecution?.limitations)
      ? grrExecution.limitations
      : []
  return [
    ...limitations.map(normalizeText).filter(Boolean),
    'Generated drafts must be reviewed before their information is reused as an approved business source.',
  ]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .filter((limitation) => validateOutcomeCustomerLanguage(limitation, {
      path: 'limitations',
    }).safe)
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
  purposeCategory: normalizeToken(pack.purposeCategory),
  knowledgeLayer: normalizeToken(pack.knowledgeLayer),
  capabilityKey: normalizeText(pack.capabilityKey).toLowerCase(),
  workspaceCompatibility: Array.isArray(pack.workspaceCompatibility)
    ? pack.workspaceCompatibility.map(normalizeToken).filter(Boolean)
    : [],
  dependencyReferences: Array.isArray(pack.dependencyReferences)
    ? pack.dependencyReferences.map((reference) => ({
        knowledgeLayer: normalizeToken(reference?.knowledgeLayer),
        requirement: normalizeToken(reference?.requirement),
        packType: normalizeToken(reference?.packType),
        packKey: normalizeText(reference?.packKey).toLowerCase(),
        capabilityKey: normalizeText(reference?.capabilityKey).toLowerCase(),
      }))
    : [],
  packType: normalizeToken(pack.packType),
  packKey: normalizeText(pack.packKey),
  label: normalizeText(pack.label),
  executionMode: normalizeToken(pack.executionMode),
  visibility: normalizeToken(pack.visibility),
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
  const sanitizePackList = (packs) => Array.isArray(packs)
    ? packs.map(sanitizeKnowledgePackActivation)
    : []
  const sanitizeLineage = (lineage = {}) => ({
    resolvedAt: normalizeText(lineage.resolvedAt),
    activationIds: Array.isArray(lineage.activationIds)
      ? lineage.activationIds.map(normalizeText).filter(Boolean)
      : [],
    versionIds: Array.isArray(lineage.versionIds)
      ? lineage.versionIds.map(normalizeText).filter(Boolean)
      : [],
    contentHashes: Array.isArray(lineage.contentHashes)
      ? lineage.contentHashes.map(normalizeText).filter(Boolean)
      : [],
  })

  return {
    status: normalizeToken(packBinding.status),
    mode: normalizeText(packBinding.mode),
    summary: normalizeText(packBinding.summary),
    resolutionSource: normalizeToken(packBinding.resolutionSource),
    policyKey: normalizeText(packBinding.policyKey),
    policyVersion: normalizeText(packBinding.policyVersion),
    manifestId: normalizeText(packBinding.manifestId),
    manifestKey: normalizeText(packBinding.manifestKey),
    manifestVersion: normalizeText(packBinding.manifestVersion),
    boundAt,
    activeCount: Number(packBinding.resolution?.activeCount ?? activePacks.length),
    resolvedCount: Number(packBinding.resolution?.resolvedCount ?? activePacks.length),
    requiredCount: requiredPacks.length,
    activePacks,
    requiredPacks,
    optionalPacks: sanitizePackList(packBinding.optionalPacks),
    validationPacks: sanitizePackList(packBinding.validationPacks),
    providerContextPacks: sanitizePackList(packBinding.providerContextPacks),
    preValidationPacks: sanitizePackList(packBinding.preValidationPacks),
    postValidationPacks: sanitizePackList(packBinding.postValidationPacks),
    systemOnlyPacks: sanitizePackList(packBinding.systemOnlyPacks),
    lineage: sanitizeLineage(packBinding.lineage || packBinding.resolution?.lineage),
    resolution: {
      status: normalizeToken(packBinding.resolution?.status || packBinding.status),
      activeCount: Number(packBinding.resolution?.activeCount ?? activePacks.length),
      resolvedCount: Number(packBinding.resolution?.resolvedCount ?? activePacks.length),
      requiredCount: Number(packBinding.resolution?.requiredCount ?? requiredPacks.length),
      optionalCount: Number(packBinding.resolution?.optionalCount ?? 0),
      validationCount: Number(packBinding.resolution?.validationCount ?? 0),
      blockedCount: Number(packBinding.resolution?.blockedCount ?? 0),
      policyVersion: normalizeText(packBinding.resolution?.policyVersion),
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

const assertRequestKnowledgePackBindingReady = ({ binding, requestResolution } = {}) => {
  const status = normalizeToken(binding?.status)
  if (status === 'READY' || status === 'READY_WITH_GAPS') return

  throw createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: status === 'AMBIGUOUS'
      ? 'Outcome Studio found conflicting business guidance for this request.'
      : 'Outcome Studio could not obtain all required business guidance for this request.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_RESPONSE_GENERATION_BLOCKED,
    details: {
      responseGenerationAvailable: false,
      blockerReason: status === 'AMBIGUOUS'
        ? 'KNOWLEDGE_PACK_RESOLUTION_AMBIGUOUS'
        : 'KNOWLEDGE_PACK_RESOLUTION_BLOCKED',
      resolutionStatus: status || 'BLOCKED',
      requestedOutputTypeKey: normalizeText(requestResolution?.outputType?.key),
      requestedStyleKey: normalizeText(requestResolution?.style?.styleKey),
      missingDependencies: Array.isArray(binding?.missingDependencies)
        ? binding.missingDependencies.map((missing) => ({
            reason: normalizeToken(missing?.reason),
            requirement: normalizeToken(missing?.requirement),
            knowledgeLayer: normalizeToken(missing?.selector?.knowledgeLayer),
            packType: normalizeToken(missing?.selector?.packType),
            packKey: normalizeText(missing?.selector?.packKey),
            capabilityKey: normalizeText(missing?.selector?.capabilityKey),
          }))
        : [],
      ambiguousSelectors: Array.isArray(binding?.ambiguousCandidates)
        ? binding.ambiguousCandidates.map((entry) => ({
            knowledgeLayer: normalizeToken(entry?.selector?.knowledgeLayer),
            packType: normalizeToken(entry?.selector?.packType),
            packKey: normalizeText(entry?.selector?.packKey),
            capabilityKey: normalizeText(entry?.selector?.capabilityKey),
          }))
        : [],
      safetyGate: {
        code: OUTCOME_STUDIO_SAFETY_GATE_CODES.RESPONSE_GENERATION_ENGINE,
        status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
      },
    },
  })
}

const assertOutcomeStudioKnowledgeContextReady = ({
  availabilityKey = 'responseGenerationAvailable',
  result,
  reason = OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_RESPONSE_GENERATION_BLOCKED,
} = {}) => {
  const context = result?.context || {}
  const status = normalizeToken(context.status)
  if (
    context.available === true
    && ['READY', 'READY_WITH_GAPS'].includes(status)
    && result?.reasoningBinding
  ) {
    return context
  }

  throw createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: status === 'AMBIGUOUS'
      ? 'Outcome Studio found conflicting business guidance for the selected deliverable.'
      : 'The selected deliverable is not currently available.',
    reason,
    details: {
      [availabilityKey]: false,
      blockerReason: normalizeToken(context.blockerReason || 'DELIVERABLE_UNAVAILABLE'),
      resolutionStatus: status || 'BLOCKED',
      requestedOutputTypeKey: normalizeCapabilityKey(context.requestedOutputTypeKey),
    },
  })
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
  const sanitizePackList = (packs) => Array.isArray(packs)
    ? packs.slice(0, OUTCOME_CONTEXT_BINDING_LIST_LIMIT).map(sanitizeKnowledgePackActivation)
    : []
  return {
    status: normalizeToken(binding.status),
    mode: normalizeText(binding.mode),
    summary: normalizeText(binding.summary),
    resolutionSource: normalizeToken(binding.resolutionSource),
    policyKey: normalizeText(binding.policyKey),
    policyVersion: normalizeText(binding.policyVersion),
    manifestId: normalizeText(binding.manifestId),
    manifestKey: normalizeText(binding.manifestKey),
    manifestVersion: normalizeText(binding.manifestVersion),
    boundAt: normalizeText(binding.boundAt),
    activeCount: Number(binding.activeCount ?? activePacks.length),
    resolvedCount: Number(binding.resolvedCount ?? activePacks.length),
    requiredCount: Number(binding.requiredCount ?? requiredPacks.length),
    activePacks,
    requiredPacks,
    optionalPacks: sanitizePackList(binding.optionalPacks),
    validationPacks: sanitizePackList(binding.validationPacks),
    providerContextPacks: sanitizePackList(binding.providerContextPacks),
    preValidationPacks: sanitizePackList(binding.preValidationPacks),
    postValidationPacks: sanitizePackList(binding.postValidationPacks),
    systemOnlyPacks: sanitizePackList(binding.systemOnlyPacks),
    lineage: {
      resolvedAt: normalizeText(binding.lineage?.resolvedAt),
      activationIds: Array.isArray(binding.lineage?.activationIds)
        ? binding.lineage.activationIds.map(normalizeText).filter(Boolean)
        : [],
      versionIds: Array.isArray(binding.lineage?.versionIds)
        ? binding.lineage.versionIds.map(normalizeText).filter(Boolean)
        : [],
      contentHashes: Array.isArray(binding.lineage?.contentHashes)
        ? binding.lineage.contentHashes.map(normalizeText).filter(Boolean)
        : [],
    },
    resolution: {
      status: normalizeToken(binding.resolution?.status || binding.status),
      activeCount: Number(binding.resolution?.activeCount ?? activePacks.length),
      resolvedCount: Number(binding.resolution?.resolvedCount ?? activePacks.length),
      requiredCount: Number(binding.resolution?.requiredCount ?? requiredPacks.length),
      optionalCount: Number(binding.resolution?.optionalCount ?? 0),
      validationCount: Number(binding.resolution?.validationCount ?? 0),
      blockedCount: Number(binding.resolution?.blockedCount ?? 0),
      policyVersion: normalizeText(binding.resolution?.policyVersion),
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
  grrExecution = null,
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
  const grrArtifact = grrExecution?.artifact && typeof grrExecution.artifact === 'object'
    ? grrExecution.artifact
    : null

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
      resolutionSource: safeKnowledgeBinding.resolutionSource,
      policyKey: safeKnowledgeBinding.policyKey,
      policyVersion: safeKnowledgeBinding.policyVersion,
      manifestId: safeKnowledgeBinding.manifestId,
      manifestKey: safeKnowledgeBinding.manifestKey,
      manifestVersion: safeKnowledgeBinding.manifestVersion,
      boundAt: safeKnowledgeBinding.boundAt,
      activeCount: safeKnowledgeBinding.activeCount,
      resolvedCount: safeKnowledgeBinding.resolvedCount,
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
    governedReasoning: {
      executionId: normalizeText(grrExecution?.executionId),
      runtimeArtifactId: normalizeText(grrArtifact?.runtimeArtifactId),
      status: normalizeToken(grrExecution?.status),
      providerMode: normalizeToken(grrExecution?.providerMode),
      runtimeStateWriteStatus: normalizeToken(grrExecution?.runtimeStateWrites?.status),
      runtimeStateWriteReason: normalizeText(grrExecution?.runtimeStateWrites?.reason),
      runtimeArtifactIsCertifiedTruth: grrArtifact?.certification?.runtimeArtifactIsCertifiedTruth === true,
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
    requestedOutputTypeKey: normalizeCapabilityKey(plain.requestedOutputTypeKey),
    requestedOutputTypeLabel: normalizeText(plain.requestedOutputTypeLabel),
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

const buildCustomerInformationStatus = (value = {}) => ({
  status: normalizeToken(value.status || 'UNKNOWN'),
  currentness: normalizeToken(value.currentness || value.status || 'UNKNOWN'),
  updatedAt: normalizeDateValue(value.boundAt || value.updatedAt),
})

const buildCustomerBusinessGuidance = (value = {}) => {
  const status = normalizeToken(value.resolution?.status || value.status || 'UNKNOWN')
  return {
    status,
    ready: ['BOUND', 'PROJECTED', 'READY', 'READY_WITH_GAPS'].includes(status),
    optionalGaps: status === 'READY_WITH_GAPS',
  }
}

const buildCustomerContentReview = (value = {}) => {
  const snapshot = sanitizeOutcomePostValidationSnapshot(value)
  return {
    status: snapshot?.status || 'NOT_RUN',
    result: snapshot?.result || 'BLOCK',
    checkedAt: snapshot?.validatedAt || '',
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
    requestedOutputTypeKey: serialized.requestedOutputTypeKey,
    requestedOutputTypeLabel: serialized.requestedOutputTypeLabel,
    informationStatus: buildCustomerInformationStatus(serialized.truthSignature),
    businessGuidance: buildCustomerBusinessGuidance(serialized.knowledgePackBinding),
    requestText: serialized.prompt,
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
    requestedOutputTypeKey: normalizeCapabilityKey(plain.requestedOutputTypeKey),
    requestedOutputTypeLabel: normalizeText(plain.requestedOutputTypeLabel),
    sourceOutput: sanitizePersistedSourceOutput(plain.sourceOutputSnapshot || {}),
    truthSignature: sanitizePersistedTruthSignature(plain.truthSignature || {}, options),
    knowledgePackBinding: sanitizePersistedKnowledgePackBinding(plain.knowledgePackBinding || {}),
    submittedBy: toIdString(plain.submittedBy),
    submittedAt: normalizeDateValue(plain.submittedAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
  }
}

const sanitizeDraftRefinementLineage = (lineage = {}) => {
  const refinement = lineage.draftRefinement && typeof lineage.draftRefinement === 'object'
    ? lineage.draftRefinement
    : null
  if (!refinement) return null

  return {
    operation: normalizeToken(refinement.operation),
    mode: normalizeToken(refinement.mode),
    intentType: normalizeToken(refinement.intentType),
    sourceIterationId: normalizeText(refinement.sourceIterationId),
    sourceIterationNumber: Number(refinement.sourceIterationNumber || 0),
    compare: {
      available: refinement.compare?.available === true,
      fromIterationId: normalizeText(refinement.compare?.fromIterationId),
      toIterationId: normalizeText(refinement.compare?.toIterationId),
    },
    revert: {
      available: refinement.revert?.available === true,
      targetIterationId: normalizeText(refinement.revert?.targetIterationId),
    },
    preservedPreviousContent: refinement.preservedPreviousContent === true,
  }
}

const sanitizeDraftApprovalLineage = (lineage = {}) => {
  const approval = lineage.draftApproval && typeof lineage.draftApproval === 'object'
    ? lineage.draftApproval
    : null
  if (!approval) return null

  return {
    operation: normalizeToken(approval.operation),
    draftId: normalizeText(approval.draftId),
    draftIterationId: normalizeText(approval.draftIterationId),
    approvedAt: normalizeDateValue(approval.approvedAt),
    approvedBy: normalizeText(approval.approvedBy),
    outcomeAssetId: normalizeText(approval.outcomeAssetId),
    outcomeAssetVersionId: normalizeText(approval.outcomeAssetVersionId),
    versionNumber: Number(approval.versionNumber || 0),
  }
}

const buildOutcomeAssetLineageSummary = (lineage = {}) => {
  const summary = {
    sourceOutputAssetId: normalizeText(lineage.sourceOutputAssetId),
    sourceOutputTypeKey: normalizeToken(lineage.sourceOutputTypeKey),
    sourceOutputTypeLabel: normalizeText(lineage.sourceOutputTypeLabel),
    truthSignatureStatus: normalizeToken(lineage.truthSignatureStatus),
    truthSignatureCurrentness: normalizeToken(lineage.truthSignatureCurrentness),
    runtimeRevisionId: normalizeText(lineage.runtimeRevisionId),
    runtimeRevisionNumber: Number(lineage.runtimeRevisionNumber || 0),
    parentVersionId: normalizeText(lineage.parentVersionId),
    generatedAt: normalizeDateValue(lineage.generatedAt),
    grrExecutionId: normalizeText(lineage.grrExecutionId),
    grrRuntimeArtifactId: normalizeText(lineage.grrRuntimeArtifactId),
    grrProviderMode: normalizeToken(lineage.grrProviderMode),
    grrRuntimeStateWrites: {
      status: normalizeToken(lineage.grrRuntimeStateWrites?.status),
      reason: normalizeText(lineage.grrRuntimeStateWrites?.reason),
    },
    grrKnowledgeBinding: {
      manifestId: normalizeText(lineage.grrKnowledgeBinding?.manifestId),
      manifestKey: normalizeText(lineage.grrKnowledgeBinding?.manifestKey),
      manifestVersion: normalizeText(lineage.grrKnowledgeBinding?.manifestVersion),
      status: normalizeToken(lineage.grrKnowledgeBinding?.status),
      contentVisible: lineage.grrKnowledgeBinding?.contentVisible === true,
      packContentLoaded: lineage.grrKnowledgeBinding?.packContentLoaded === true,
    },
    grrCertification: {
      certifiedTruthOnly: lineage.grrCertification?.certifiedTruthOnly === true,
      runtimeArtifactIsCertifiedTruth: lineage.grrCertification?.runtimeArtifactIsCertifiedTruth === true,
      requiresSeparateCertificationBeforeTruthReuse:
        lineage.grrCertification?.requiresSeparateCertificationBeforeTruthReuse === true,
    },
  }
  const draftRefinement = sanitizeDraftRefinementLineage(lineage)
  if (draftRefinement) summary.draftRefinement = draftRefinement
  const draftApproval = sanitizeDraftApprovalLineage(lineage)
  if (draftApproval) summary.draftApproval = draftApproval
  return summary
}

const serializeOutcomeAssetVersion = (version, options = {}) => {
  const plain = toPlainObject(version)
  const customerContent = plain.customerContent && typeof plain.customerContent === 'object'
    ? plain.customerContent
    : {}
  const truthSignature = sanitizePersistedTruthSignature(plain.truthSignature || {}, options)
  const postValidation = sanitizeOutcomePostValidationSnapshot(plain.postValidation)
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
    outputTypeCapabilityKey: normalizeCapabilityKey(plain.outputTypeCapabilityKey),
    outputTypeLabel: normalizeText(plain.outputTypeLabel),
    title: projectApprovedOutcomeTitle({
      outputTypeLabel: plain.outputTypeLabel,
      title: plain.title,
    }),
    sourceOutputAssetId: normalizeText(plain.sourceOutputAssetId),
    sourceOutput: sanitizePersistedSourceOutput(plain.sourceOutputSnapshot || {}),
    truthSignature,
    knowledgePackBinding: sanitizePersistedKnowledgePackBinding(plain.knowledgePackBinding || {}),
    postValidation,
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

const serializeOutcomeDraft = (draft, options = {}) => {
  const plain = toPlainObject(draft)
  const truthSignature = sanitizePersistedTruthSignature(plain.truthSignature || {}, options)
  const validationSummary = sanitizeOutcomePostValidationSnapshot(plain.validationSummary)
  const lineageSummary = {
    ...buildOutcomeAssetLineageSummary(plain.lineageSummary || {}),
    truthSignatureCurrentness: truthSignature.currentness,
  }
  return {
    draftId: normalizeText(plain.draftId),
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
    workspaceType: normalizeToken(plain.workspaceType || DEFAULT_OUTCOME_WORKSPACE_TYPE),
    assetType: normalizeToken(plain.assetType || DEFAULT_OUTCOME_ASSET_TYPE),
    outputTypeKey: normalizeToken(plain.outputTypeKey),
    outputTypeCapabilityKey: normalizeCapabilityKey(plain.outputTypeCapabilityKey),
    outputTypeLabel: normalizeText(plain.outputTypeLabel),
    title: normalizeText(plain.title),
    sourceOutputAssetId: normalizeText(plain.sourceOutputAssetId),
    truthSignature,
    knowledgePackBinding: sanitizePersistedKnowledgePackBinding(plain.knowledgePackBinding || {}),
    currentIterationId: normalizeText(plain.currentIterationId),
    currentIterationNumber: Number(plain.currentIterationNumber || 0),
    approvedIterationId: normalizeText(plain.approvedIterationId),
    approvedAssetVersionId: normalizeText(plain.approvedAssetVersionId),
    validationSummary,
    lineageSummary,
    warnings: Array.isArray(plain.warnings) ? plain.warnings.map(normalizeText).filter(Boolean) : [],
    limitations: Array.isArray(plain.limitations) ? plain.limitations.map(normalizeText).filter(Boolean) : [],
    createdBy: toIdString(plain.createdBy),
    approvedBy: toIdString(plain.approvedBy),
    approvedAt: normalizeDateValue(plain.approvedAt),
    discardedBy: toIdString(plain.discardedBy),
    discardedAt: normalizeDateValue(plain.discardedAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
  }
}

const serializeOutcomeDraftIteration = (iteration) => {
  const plain = toPlainObject(iteration)
  const customerContent = plain.customerContent && typeof plain.customerContent === 'object'
    ? plain.customerContent
    : {}
  const validationSummary = sanitizeOutcomePostValidationSnapshot(plain.validationSummary)
  return {
    draftIterationId: normalizeText(plain.draftIterationId),
    draftId: normalizeText(plain.draftId),
    previousIterationId: normalizeText(plain.previousIterationId),
    iterationNumber: Number(plain.iterationNumber || 0),
    sessionId: normalizeText(plain.sessionId),
    contractVersion: normalizeText(plain.contractVersion || OUTCOME_STUDIO_CONTRACT_VERSION),
    phase: normalizeText(plain.phase || OUTCOME_STUDIO_PHASE),
    iterationType: normalizeToken(plain.iterationType || 'UNKNOWN'),
    status: normalizeToken(plain.status || 'UNKNOWN'),
    runtimeInstanceId: toIdString(plain.runtimeInstanceId),
    runtimeInstanceKey: normalizeText(plain.runtimeInstanceKey),
    runtimeType: normalizeToken(plain.runtimeType),
    frameworkKey: normalizeToken(plain.frameworkKey),
    packageKey: normalizeText(plain.packageKey),
    packageVersion: normalizeText(plain.packageVersion),
    projectId: normalizeText(plain.projectId),
    outcomeId: normalizeText(plain.outcomeId),
    workspaceType: normalizeToken(plain.workspaceType || DEFAULT_OUTCOME_WORKSPACE_TYPE),
    assetType: normalizeToken(plain.assetType || DEFAULT_OUTCOME_ASSET_TYPE),
    outputTypeKey: normalizeToken(plain.outputTypeKey),
    outputTypeCapabilityKey: normalizeCapabilityKey(plain.outputTypeCapabilityKey),
    outputTypeLabel: normalizeText(plain.outputTypeLabel),
    title: normalizeText(plain.title),
    sourceMessageId: normalizeText(plain.sourceMessageId),
    responseMessageId: normalizeText(plain.responseMessageId),
    truthSignatureId: normalizeText(plain.truthSignatureId),
    grrExecutionId: normalizeText(plain.grrExecutionId),
    grrRuntimeArtifactId: normalizeText(plain.grrRuntimeArtifactId),
    customerContent,
    contentAvailable: Object.keys(customerContent).length > 0,
    validationSummary,
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
  const postValidation = sanitizeOutcomePostValidationSnapshot(plain.postValidation)
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
    outputTypeCapabilityKey: normalizeCapabilityKey(plain.outputTypeCapabilityKey),
    outputTypeLabel: normalizeText(plain.outputTypeLabel),
    title: projectApprovedOutcomeTitle({
      outputTypeLabel: plain.outputTypeLabel,
      title: plain.title,
    }),
    sourceOutputAssetId: normalizeText(plain.sourceOutputAssetId),
    currentVersionId: normalizeText(plain.currentVersionId),
    currentVersionNumber: Number(plain.currentVersionNumber || 0),
    sourceOutput: sanitizePersistedSourceOutput(plain.sourceOutputSnapshot || {}),
    truthSignature,
    knowledgePackBinding: sanitizePersistedKnowledgePackBinding(plain.knowledgePackBinding || {}),
    postValidation,
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
  const contentReview = buildCustomerContentReview(serialized.postValidation)
  const customerReady = !isNonCustomerReadyGeneration(toPlainObject(asset))
  return {
    outcomeAssetId: serialized.outcomeAssetId,
    sessionId: serialized.sessionId,
    status: serialized.status,
    outputTypeKey: serialized.outputTypeKey,
    outputTypeCapabilityKey: serialized.outputTypeCapabilityKey,
    outputTypeLabel: serialized.outputTypeLabel,
    title: serialized.title,
    sourceOutputAssetId: serialized.sourceOutputAssetId,
    currentVersionId: serialized.currentVersionId,
    currentVersionNumber: serialized.currentVersionNumber,
    informationStatus: buildCustomerInformationStatus(serialized.truthSignature),
    businessGuidance: buildCustomerBusinessGuidance(serialized.knowledgePackBinding),
    contentReview,
    previewAvailable: customerReady && contentReview.result === 'ALLOW',
    distributionAvailable: customerReady && contentReview.result === 'ALLOW',
    warnings: serialized.warnings,
    limitations: serialized.limitations,
    generatedAt: serialized.generatedAt,
    publishedAt: serialized.publishedAt,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
  }
}

const UNSAFE_HISTORICAL_ASSISTANT_MESSAGE =
  'This earlier response is unavailable because it does not meet the current customer content standard.'

const projectCustomerOutcomeMessageContent = (message) => {
  const content = normalizeText(message.prompt)
  if (message.role !== OUTCOME_STUDIO_MESSAGE_ROLES.ASSISTANT) return content

  const languageReview = validateOutcomeCustomerLanguage(content, { path: 'message.content' })
  return languageReview.safe ? content : UNSAFE_HISTORICAL_ASSISTANT_MESSAGE
}

const serializeCustomerOutcomeMessage = (message, options = {}) => {
  const serialized = serializeOutcomeMessage(message, options)
  return {
    messageId: serialized.messageId,
    sessionId: serialized.sessionId,
    role: serialized.role,
    status: serialized.status,
    responseStatus: serialized.responseStatus,
    requestedOutputTypeKey: serialized.requestedOutputTypeKey,
    requestedOutputTypeLabel: serialized.requestedOutputTypeLabel,
    content: projectCustomerOutcomeMessageContent(serialized),
    submittedAt: serialized.submittedAt,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
  }
}

const serializeCustomerOutcomeDraft = (draft, options = {}) => {
  const serialized = serializeOutcomeDraft(draft, options)
  const contentReview = buildCustomerContentReview(serialized.validationSummary)
  const customerReady = !isNonCustomerReadyGeneration(toPlainObject(draft))
  return {
    draftId: serialized.draftId,
    sessionId: serialized.sessionId,
    status: serialized.status,
    outputTypeKey: serialized.outputTypeKey,
    outputTypeCapabilityKey: serialized.outputTypeCapabilityKey,
    outputTypeLabel: serialized.outputTypeLabel,
    title: serialized.title,
    currentIterationId: serialized.currentIterationId,
    currentIterationNumber: serialized.currentIterationNumber,
    approvedIterationId: serialized.approvedIterationId,
    approvedAssetVersionId: serialized.approvedAssetVersionId,
    informationStatus: buildCustomerInformationStatus(serialized.truthSignature),
    businessGuidance: buildCustomerBusinessGuidance(serialized.knowledgePackBinding),
    contentReview,
    approvalAvailable: serialized.status === OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE
      && customerReady
      && contentReview.result === 'ALLOW',
    warnings: serialized.warnings,
    limitations: serialized.limitations,
    approvedAt: serialized.approvedAt,
    discardedAt: serialized.discardedAt,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
  }
}

const serializeCustomerOutcomeDraftIteration = (iteration) => {
  const serialized = serializeOutcomeDraftIteration(iteration)
  const contentReview = buildCustomerContentReview(serialized.validationSummary)
  const customerReady = !isNonCustomerReadyGeneration(toPlainObject(iteration))
  return {
    draftIterationId: serialized.draftIterationId,
    draftId: serialized.draftId,
    previousIterationId: serialized.previousIterationId,
    iterationNumber: serialized.iterationNumber,
    sessionId: serialized.sessionId,
    iterationType: serialized.iterationType,
    status: serialized.status,
    outputTypeKey: serialized.outputTypeKey,
    outputTypeCapabilityKey: serialized.outputTypeCapabilityKey,
    outputTypeLabel: serialized.outputTypeLabel,
    title: serialized.title,
    customerContent: projectOutcomeCustomerContent(serialized.customerContent),
    contentAvailable: serialized.contentAvailable,
    contentReview,
    approvalAvailable: serialized.status === OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT
      && customerReady
      && contentReview.result === 'ALLOW',
    warnings: serialized.warnings,
    limitations: serialized.limitations,
    generatedAt: serialized.generatedAt,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
  }
}

const serializeCustomerOutcomeAssetVersion = (version, options = {}) => {
  const serialized = serializeOutcomeAssetVersion(version, options)
  const contentReview = buildCustomerContentReview(serialized.postValidation)
  const customerReady = !isNonCustomerReadyGeneration(toPlainObject(version))
  return {
    outcomeAssetVersionId: serialized.outcomeAssetVersionId,
    outcomeAssetId: serialized.outcomeAssetId,
    sessionId: serialized.sessionId,
    versionNumber: serialized.versionNumber,
    status: serialized.status,
    outputTypeKey: serialized.outputTypeKey,
    outputTypeCapabilityKey: serialized.outputTypeCapabilityKey,
    outputTypeLabel: serialized.outputTypeLabel,
    title: serialized.title,
    informationStatus: buildCustomerInformationStatus(serialized.truthSignature),
    businessGuidance: buildCustomerBusinessGuidance(serialized.knowledgePackBinding),
    contentReview,
    distributionAvailable: customerReady && contentReview.result === 'ALLOW',
    contentAvailable: serialized.contentAvailable,
    warnings: serialized.warnings,
    limitations: serialized.limitations,
    generatedAt: serialized.generatedAt,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
  }
}

const serializeCustomerOutcomeSession = (session, options = {}) => {
  const serialized = serializeOutcomeSession(session, options)
  return {
    ...serializeOutcomeSessionSummary(session, options),
    sourceOutput: {
      outputAssetId: serialized.sourceOutput.outputAssetId,
      outputTypeKey: serialized.sourceOutput.outputTypeKey,
      outputTypeLabel: serialized.sourceOutput.outputTypeLabel,
      formats: serialized.sourceOutput.supportedFormats,
      status: serialized.sourceOutput.status,
    },
  }
}

const listOutcomeMessagesForSession = async ({
  currentEvidence = null,
  runtimeInstanceId,
  sessionId,
}) => {
  const messages = await OutcomeMessage.find({
    runtimeInstanceId,
    sessionId: normalizeText(sessionId),
  })
    .sort({ createdAt: -1 })
    .limit(OUTCOME_STUDIO_MESSAGE_LIST_LIMIT)
    .lean()
  return messages
    .reverse()
    .map((message) => serializeCustomerOutcomeMessage(message, { currentEvidence }))
}

const listOutcomeDraftsForSession = async ({
  currentEvidence = null,
  runtimeInstanceId,
  sessionId,
}) => {
  const drafts = await OutcomeDraft.find({
    runtimeInstanceId,
    sessionId: normalizeText(sessionId),
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(OUTCOME_STUDIO_DRAFT_LIST_LIMIT)
    .lean()
  return drafts.map((draft) => serializeCustomerOutcomeDraft(draft, { currentEvidence }))
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

const findActiveOutcomeDraftForSession = async ({
  runtimeInstanceId,
  sessionId,
} = {}) => {
  const query = OutcomeDraft.findOne({
    runtimeInstanceId,
    sessionId: normalizeText(sessionId),
    status: OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE,
  })
  const draft = typeof query?.lean === 'function' ? await query.lean() : await query
  return draft || null
}

const buildOutcomeDraftRefinementBlockedError = ({
  blockerReason = 'OUTCOME_DRAFT_REFINEMENT_BLOCKED',
  currentIterationId = '',
  draftId = '',
  messageId = '',
  sessionId = '',
} = {}) =>
  createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: 'Outcome Studio draft refinement requires an active current draft iteration.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_REFINEMENT_BLOCKED,
    details: {
      sessionId: normalizeText(sessionId),
      messageId: normalizeText(messageId),
      draftId: normalizeText(draftId),
      currentIterationId: normalizeText(currentIterationId),
      responseGenerationAvailable: false,
      blockerReason,
      safetyGate: {
        code: OUTCOME_STUDIO_SAFETY_GATE_CODES.RESPONSE_GENERATION_ENGINE,
        status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
      },
    },
  })

const findCurrentOutcomeDraftIterationForRefinement = async ({
  activeDraft = {},
  messageId = '',
  runtimeInstanceId,
  sessionId = '',
} = {}) => {
  const draftId = normalizeText(activeDraft.draftId)
  const currentIterationId = normalizeText(activeDraft.currentIterationId)
  if (!draftId || !currentIterationId) {
    throw buildOutcomeDraftRefinementBlockedError({
      blockerReason: 'OUTCOME_DRAFT_CURRENT_POINTER_MISSING',
      currentIterationId,
      draftId,
      messageId,
      sessionId,
    })
  }

  const query = OutcomeDraftIteration.findOne({
    runtimeInstanceId,
    sessionId: normalizeText(sessionId),
    draftId,
    draftIterationId: currentIterationId,
    status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT,
  })
  const iteration = typeof query?.lean === 'function' ? await query.lean() : await query
  if (iteration) return iteration

  throw buildOutcomeDraftRefinementBlockedError({
    blockerReason: 'OUTCOME_DRAFT_CURRENT_ITERATION_NOT_FOUND',
    currentIterationId,
    draftId,
    messageId,
    sessionId,
  })
}

const buildOutcomeDraftApprovalBlockedError = ({
  blockerReason = 'OUTCOME_DRAFT_APPROVAL_BLOCKED',
  currentIterationId = '',
  draftId = '',
  sessionId = '',
} = {}) =>
  createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: 'Outcome Studio draft approval requires an active draft with a current iteration.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_APPROVAL_BLOCKED,
    details: {
      sessionId: normalizeText(sessionId),
      draftId: normalizeText(draftId),
      currentIterationId: normalizeText(currentIterationId),
      approvalAvailable: false,
      blockerReason,
      safetyGate: {
        code: OUTCOME_STUDIO_SAFETY_GATE_CODES.ASSET_APPROVAL,
        status: OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
      },
    },
  })

const buildOutcomeDraftPreviewBlockedError = ({
  blockerReason = 'OUTCOME_DRAFT_PREVIEW_BLOCKED',
  currentIterationId = '',
  draftId = '',
  message = 'Outcome Studio draft preview requires an active draft with a current validated iteration.',
  sessionId = '',
} = {}) =>
  createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message,
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_PREVIEW_BLOCKED,
    details: {
      sessionId: normalizeText(sessionId),
      draftId: normalizeText(draftId),
      currentIterationId: normalizeText(currentIterationId),
      previewAvailable: false,
      blockerReason,
    },
  })

const buildOutcomeDraftDiscardBlockedError = ({
  blockerReason = 'OUTCOME_DRAFT_DISCARD_BLOCKED',
  currentIterationId = '',
  draftId = '',
  sessionId = '',
  status = '',
} = {}) =>
  createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: 'Outcome Studio can only discard an unchanged active draft.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_DISCARD_BLOCKED,
    details: {
      sessionId: normalizeText(sessionId),
      draftId: normalizeText(draftId),
      currentIterationId: normalizeText(currentIterationId),
      status: normalizeToken(status),
      discardAvailable: false,
      blockerReason,
    },
  })

const findActiveOutcomeDraftForApproval = async ({
  draftId = '',
  runtimeInstanceId,
  sessionId = '',
} = {}) => {
  const query = OutcomeDraft.findOne({
    runtimeInstanceId,
    sessionId: normalizeText(sessionId),
    draftId: normalizeText(draftId),
  })
  const draft = typeof query?.lean === 'function' ? await query.lean() : await query

  if (!draft) {
    throw createOutcomeStudioError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio draft not found.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_NOT_FOUND,
      details: {
        runtimeInstanceId,
        sessionId: normalizeText(sessionId),
        draftId: normalizeText(draftId),
      },
    })
  }

  const draftStatus = normalizeToken(draft.status)
  if (draftStatus !== OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE) {
    throw buildOutcomeDraftApprovalBlockedError({
      blockerReason: draftStatus === OUTCOME_STUDIO_DRAFT_STATUSES.APPROVED
        ? 'OUTCOME_DRAFT_ALREADY_APPROVED'
        : 'OUTCOME_DRAFT_NOT_ACTIVE',
      currentIterationId: draft.currentIterationId,
      draftId: draft.draftId,
      sessionId,
    })
  }

  return draft
}

const findCurrentOutcomeDraftIterationForApproval = async ({
  activeDraft = {},
  runtimeInstanceId,
  sessionId = '',
} = {}) => {
  const draftId = normalizeText(activeDraft.draftId)
  const currentIterationId = normalizeText(activeDraft.currentIterationId)
  if (!draftId || !currentIterationId) {
    throw buildOutcomeDraftApprovalBlockedError({
      blockerReason: 'OUTCOME_DRAFT_CURRENT_POINTER_MISSING',
      currentIterationId,
      draftId,
      sessionId,
    })
  }

  const query = OutcomeDraftIteration.findOne({
    runtimeInstanceId,
    sessionId: normalizeText(sessionId),
    draftId,
    draftIterationId: currentIterationId,
    status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT,
  })
  const iteration = typeof query?.lean === 'function' ? await query.lean() : await query
  if (iteration) return iteration

  throw buildOutcomeDraftApprovalBlockedError({
    blockerReason: 'OUTCOME_DRAFT_CURRENT_ITERATION_NOT_FOUND',
    currentIterationId,
    draftId,
    sessionId,
  })
}

const findActiveOutcomeDraftForPreview = async ({
  draftId = '',
  runtimeInstanceId,
  sessionId = '',
} = {}) => {
  const query = OutcomeDraft.findOne({
    runtimeInstanceId,
    sessionId: normalizeText(sessionId),
    draftId: normalizeText(draftId),
  })
  const draft = typeof query?.lean === 'function' ? await query.lean() : await query

  if (!draft) {
    throw createOutcomeStudioError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio draft not found.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_NOT_FOUND,
      details: {
        sessionId: normalizeText(sessionId),
        draftId: normalizeText(draftId),
      },
    })
  }

  if (normalizeToken(draft.status) !== OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE) {
    throw buildOutcomeDraftPreviewBlockedError({
      blockerReason: 'OUTCOME_DRAFT_NOT_ACTIVE',
      currentIterationId: draft.currentIterationId,
      draftId: draft.draftId,
      sessionId,
    })
  }

  return draft
}

const findCurrentOutcomeDraftIterationForPreview = async ({
  activeDraft = {},
  runtimeInstanceId,
  sessionId = '',
} = {}) => {
  const draftId = normalizeText(activeDraft.draftId)
  const currentIterationId = normalizeText(activeDraft.currentIterationId)
  if (!draftId || !currentIterationId) {
    throw buildOutcomeDraftPreviewBlockedError({
      blockerReason: 'OUTCOME_DRAFT_CURRENT_POINTER_MISSING',
      currentIterationId,
      draftId,
      sessionId,
    })
  }

  const query = OutcomeDraftIteration.findOne({
    runtimeInstanceId,
    sessionId: normalizeText(sessionId),
    draftId,
    draftIterationId: currentIterationId,
    status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT,
  })
  const iteration = typeof query?.lean === 'function' ? await query.lean() : await query
  if (iteration) return iteration

  throw buildOutcomeDraftPreviewBlockedError({
    blockerReason: 'OUTCOME_DRAFT_CURRENT_ITERATION_NOT_FOUND',
    currentIterationId,
    draftId,
    sessionId,
  })
}

const assertOutcomeDraftPreviewCurrentTruth = ({
  draft = {},
  iteration = {},
  session = {},
} = {}) => {
  const sessionCurrentness = normalizeToken(session.truthSignature?.currentness)
  const draftCurrentness = normalizeToken(draft.truthSignature?.currentness)
  const sessionTruthSignatureId = normalizeText(
    session.truthSignatureId || session.truthSignature?.truthSignatureId,
  )
  const draftTruthSignatureId = normalizeText(
    draft.truthSignatureId || draft.truthSignature?.truthSignatureId,
  )
  const iterationTruthSignatureId = normalizeText(iteration.truthSignatureId)

  if (
    sessionCurrentness === 'CURRENT'
    && draftCurrentness === 'CURRENT'
    && sessionTruthSignatureId
    && sessionTruthSignatureId === draftTruthSignatureId
    && sessionTruthSignatureId === iterationTruthSignatureId
  ) {
    return
  }

  throw buildOutcomeDraftPreviewBlockedError({
    blockerReason: 'OUTCOME_DRAFT_TRUTH_NOT_CURRENT',
    currentIterationId: iteration.draftIterationId,
    draftId: draft.draftId,
    message: 'Draft preview is blocked until the draft uses current verified business information.',
    sessionId: session.sessionId,
  })
}

const assertOutcomeDraftPreviewValidation = ({
  draft = {},
  iteration = {},
  sessionId = '',
} = {}) => {
  const validationSummary = iteration?.validationSummary
    && typeof iteration.validationSummary === 'object'
    ? toPlainObject(iteration.validationSummary)
    : null
  const validationMatchesDraft = normalizeText(validationSummary?.draftId) === normalizeText(draft.draftId)
  const validationMatchesIteration = normalizeText(validationSummary?.draftIterationId)
    === normalizeText(iteration.draftIterationId)

  if (
    isOutcomePostValidationAllowed(validationSummary)
    && validationMatchesDraft
    && validationMatchesIteration
  ) {
    return
  }

  throw buildOutcomeDraftPreviewBlockedError({
    blockerReason: !validationSummary
      ? 'OUTCOME_DRAFT_VALIDATION_MISSING'
      : (!validationMatchesDraft || !validationMatchesIteration)
          ? 'OUTCOME_DRAFT_VALIDATION_STALE'
          : 'OUTCOME_DRAFT_VALIDATION_FAILED',
    currentIterationId: iteration.draftIterationId,
    draftId: draft.draftId,
    message: 'Draft preview is unavailable until the current draft passes content review.',
    sessionId,
  })
}

const getOutcomeDraftIterationPreviewContent = ({
  draftId = '',
  iteration = {},
  sessionId = '',
} = {}) => {
  const customerContent = projectOutcomeCustomerContent(iteration.customerContent)
  const markdown = normalizeText(customerContent.markdown)
  const sections = Array.isArray(customerContent.sections) ? customerContent.sections : []

  if (markdown || sections.length > 0) {
    return { markdown, sections }
  }

  throw createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: 'Outcome Studio draft preview requires available customer content.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_PREVIEW_CONTENT_UNAVAILABLE,
    details: {
      sessionId: normalizeText(sessionId),
      draftId: normalizeText(draftId),
      currentIterationId: normalizeText(iteration.draftIterationId),
      previewAvailable: false,
      blockerReason: 'OUTCOME_DRAFT_CUSTOMER_CONTENT_NOT_AVAILABLE',
    },
  })
}

const buildApprovedOutcomeAssetVersionCustomerContent = ({
  customerContent = {},
} = {}) => {
  const sourceContent = projectOutcomeCustomerContent(customerContent)
  const markdown = getDraftIterationMarkdown({ customerContent: sourceContent })
  return {
    ...sourceContent,
    ...(markdown ? { markdown } : {}),
  }
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
  return versions.map((version) => serializeCustomerOutcomeAssetVersion(version, { currentEvidence }))
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
    message: `Outcome Studio can only ${actionLabel} when the asset uses current verified business information.`,
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

const assertOutcomeAssetPostValidation = ({
  actionLabel = 'asset action',
  asset = {},
  availabilityKey = 'actionAvailable',
  reason = OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_POST_VALIDATION_BLOCKED,
  safetyGateCode = OUTCOME_STUDIO_SAFETY_GATE_CODES.EXPORT_RENDERER,
  version = {},
} = {}) => {
  const postValidation = sanitizeOutcomePostValidationSnapshot(version.postValidation)
  const validationMatchesAsset = !postValidation?.outcomeAssetId
    || postValidation.outcomeAssetId === normalizeText(asset.outcomeAssetId)
  const validationMatchesVersion = !postValidation?.outcomeAssetVersionId
    || postValidation.outcomeAssetVersionId === normalizeText(version.outcomeAssetVersionId)

  if (
    isOutcomePostValidationAllowed(postValidation)
    && validationMatchesAsset
    && validationMatchesVersion
  ) {
    return postValidation
  }

  const blockerReason = !postValidation
    ? 'OUTCOME_ASSET_POST_VALIDATION_MISSING'
    : (!validationMatchesAsset || !validationMatchesVersion)
        ? 'OUTCOME_ASSET_POST_VALIDATION_STALE'
        : 'OUTCOME_ASSET_POST_VALIDATION_FAILED'

  throw createOutcomeStudioError({
    status: 409,
    code: 'CONFLICT',
    message: `Outcome Studio can only ${actionLabel} after the content review has passed.`,
    reason,
    details: {
      outcomeAssetId: normalizeText(asset.outcomeAssetId),
      outcomeAssetVersionId: normalizeText(version.outcomeAssetVersionId),
      [availabilityKey]: false,
      blockerReason,
      postValidation: buildOutcomePostValidationAuditSummary(postValidation),
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
    message: `Outcome Studio ${actionLabel} is blocked until the session uses current verified business information.`,
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

const logOutcomeDraftGeneratedAudit = async ({
  action = auditService.AUDIT_ACTIONS.OUTCOME_DRAFT_GENERATED,
  auditRequest,
  dbSession = null,
  diff,
  draft,
  runtimeInstance,
  summary,
}) => {
  const runtimeInstanceId = runtimeInstance._id || runtimeInstance.id
  const auditPayload = {
    action,
    actorUserId: diff?.actorUserId,
    resourceType: auditService.RESOURCE_TYPES.OutcomeDraft,
    resourceId: draft._id || draft.id,
    scope: {
      customerId: runtimeInstance.customerId,
      tenantId: runtimeInstance.tenantId,
      runtimeInstanceId,
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
      outcomeSessionId: draft.sessionId,
      outcomeDraftId: draft.draftId,
      outcomeDraftIterationId: diff?.draftIterationId,
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

const failDraftGenerationAuditClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_DRAFT_GENERATION_AUDIT_FAILED',
    message: 'Outcome Studio draft generation audit could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_GENERATION_AUDIT_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

const failDraftRefinementAuditClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_DRAFT_REFINEMENT_AUDIT_FAILED',
    message: 'Outcome Studio draft refinement audit could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_REFINEMENT_AUDIT_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

const failDraftApprovalAuditClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_DRAFT_APPROVAL_AUDIT_FAILED',
    message: 'Outcome Studio draft approval audit could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_APPROVAL_AUDIT_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

const failDraftDiscardAuditClosed = (err, details = {}) =>
  createOutcomeStudioError({
    status: 500,
    code: 'OUTCOME_DRAFT_DISCARD_AUDIT_FAILED',
    message: 'Outcome Studio draft discard audit could not be persisted.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_DISCARD_AUDIT_FAILED,
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
    message: 'Outcome Studio could not save the requested change.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_GRAPH_RELATIONSHIP_FAILED,
    details: {
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
      resolutionSource: normalizeToken(packBinding.resolutionSource),
      policyKey: normalizeText(packBinding.policyKey),
      policyVersion: normalizeText(packBinding.policyVersion),
      activeCount: Number(packBinding.resolution?.activeCount ?? 0),
      resolvedCount: Number(
        packBinding.resolution?.resolvedCount
          ?? (Array.isArray(packBinding.activePacks) ? packBinding.activePacks.length : 0),
      ),
      requiredCount: Number(
        packBinding.resolution?.requiredCount
          ?? (Array.isArray(packBinding.requiredPacks) ? packBinding.requiredPacks.length : 0),
      ),
      optionalCount: Number(packBinding.resolution?.optionalCount ?? 0),
      validationCount: Number(packBinding.resolution?.validationCount ?? 0),
      blockedCount: Number(packBinding.resolution?.blockedCount ?? 0),
      sourceOnlyCount: 0,
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
  const { binding: packBinding } = await resolveOutcomeStudioKnowledgePackBinding({
    query: outputLab?.runtimeScope || {},
  })
  const deliverables = projectOutcomeStudioDeliverableDiscovery(packBinding)
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
    canStartSession: readiness.canStartSession === true && deliverables.availableCount > 0,
    canReason: readiness.canStartSession === true
      && deliverables.availableCount > 0
      && safetyGates.responseGenerationAvailable === true,
    summary: deliverables.availableCount === 0
      ? 'Outcome Studio requires an available deliverable before a session can start.'
      : readiness.canStartSession === true && safetyGates.responseGenerationAvailable !== true
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
    deliverables,
    safetyGates,
    conversation: buildConversationState(readinessWithSafetyGates),
    sourceOutputs: sourceOutput ? [sourceOutput] : [],
    sessions,
    assets,
  }
}

const CUSTOMER_SAFETY_GATE_PRESENTATION = Object.freeze({
  [OUTCOME_STUDIO_SAFETY_GATE_CODES.SOURCE_OUTPUT_BOUND]: {
    label: 'Source information',
    passed: 'A source deliverable is available for this session.',
    blocked: 'A source deliverable is required before a session can start.',
  },
  [OUTCOME_STUDIO_SAFETY_GATE_CODES.TRUTH_SIGNATURE_BOUND]: {
    label: 'Verified information',
    passed: 'Current verified business information is available.',
    blocked: 'Current verified business information is required before drafting can start.',
  },
  [OUTCOME_STUDIO_SAFETY_GATE_CODES.KNOWLEDGE_PACKS_BOUND]: {
    label: 'Business guidance',
    passed: 'The relevant business guidance is available.',
    blocked: 'Required business guidance is not yet available.',
  },
  [OUTCOME_STUDIO_SAFETY_GATE_CODES.PROMPT_PERSISTENCE_READY]: {
    label: 'Request history',
    passed: 'Your requests can be retained in this session.',
    blocked: 'Request history is unavailable until the session is ready.',
  },
  [OUTCOME_STUDIO_SAFETY_GATE_CODES.RESPONSE_GENERATION_ENGINE]: {
    label: 'Drafting service',
    passed: 'Draft generation is available.',
    blocked: 'Draft generation is not currently available.',
  },
})

const buildCustomerSafetyGates = (safetyGates = {}) => ({
  status: normalizeToken(safetyGates.status || 'UNKNOWN'),
  responseGenerationAvailable: safetyGates.responseGenerationAvailable === true,
  passedCount: Number(safetyGates.passedCount || 0),
  blockedCount: Number(safetyGates.blockedCount || 0),
  totalCount: Number(safetyGates.totalCount || 0),
  gates: Array.isArray(safetyGates.gates)
    ? safetyGates.gates.map((gate, index) => {
        const presentation = CUSTOMER_SAFETY_GATE_PRESENTATION[normalizeToken(gate.code)] || {
          label: 'Readiness check',
          passed: 'This readiness check passed.',
          blocked: 'This readiness check requires attention.',
        }
        const passed = normalizeToken(gate.status) === OUTCOME_STUDIO_SAFETY_GATE_STATUSES.PASSED
        return {
          key: `check-${index + 1}`,
          label: presentation.label,
          status: passed ? OUTCOME_STUDIO_SAFETY_GATE_STATUSES.PASSED : OUTCOME_STUDIO_SAFETY_GATE_STATUSES.BLOCKED,
          message: passed ? presentation.passed : presentation.blocked,
        }
      })
    : [],
})

const buildOutcomeStudioCustomerProjection = (projection = {}) => {
  const readiness = projection.readiness || {}
  const safetyGates = buildCustomerSafetyGates(projection.safetyGates || readiness.safetyGates)
  const canStartSession = readiness.canStartSession === true
  const canReason = readiness.canReason === true && safetyGates.responseGenerationAvailable === true
  const truthSignature = projection.truthBinding?.truthSignature || {}
  const sourceOutputs = Array.isArray(projection.sourceOutputs)
    ? projection.sourceOutputs.map((source) => ({
        outputAssetId: normalizeText(source.outputAssetId),
        outputTypeKey: normalizeToken(source.outputTypeKey),
        outputTypeLabel: normalizeText(source.outputTypeLabel),
        formats: Array.isArray(source.supportedFormats)
          ? source.supportedFormats.map(normalizeToken).filter(Boolean)
          : [],
        status: normalizeToken(source.status || 'UNKNOWN'),
      }))
    : []

  return {
    readiness: {
      state: normalizeToken(readiness.state || 'UNKNOWN'),
      canStartSession,
      canReason,
      summary: canReason
        ? 'Outcome Studio is ready to prepare drafts.'
        : canStartSession
          ? 'A session can start, but draft generation is not currently available.'
          : 'Outcome Studio requires additional business information before a session can start.',
      blockerCount: Array.isArray(readiness.blockers) ? readiness.blockers.length : 0,
      safetyGates: {
        status: safetyGates.status,
        responseGenerationAvailable: safetyGates.responseGenerationAvailable,
        passedCount: safetyGates.passedCount,
        blockedCount: safetyGates.blockedCount,
        totalCount: safetyGates.totalCount,
      },
    },
    information: {
      ...buildCustomerInformationStatus(truthSignature),
      missingInformationCount: Array.isArray(truthSignature.missingEvidence)
        ? truthSignature.missingEvidence.length
        : 0,
      sourceOutput: sourceOutputs[0] || null,
    },
    businessGuidance: {
      ...buildCustomerBusinessGuidance(projection.packBinding),
      sourceDocumentCount: Array.isArray(projection.packBinding?.sourceDocumentPacks)
        ? projection.packBinding.sourceDocumentPacks.length
        : 0,
    },
    deliverables: {
      status: normalizeToken(projection.deliverables?.status || 'UNAVAILABLE'),
      availableCount: Number(projection.deliverables?.availableCount || 0),
      unavailableCount: Number(projection.deliverables?.unavailableCount || 0),
      supportedFormats: Array.isArray(projection.deliverables?.supportedFormats)
        ? projection.deliverables.supportedFormats.map(normalizeToken).filter(Boolean)
        : [],
      available: Array.isArray(projection.deliverables?.available)
        ? projection.deliverables.available.map((deliverable) => ({
            key: normalizeCapabilityKey(deliverable.key),
            label: normalizeText(deliverable.label),
            formats: Array.isArray(deliverable.formats)
              ? deliverable.formats.map((format) => ({
                  format: normalizeToken(format.format),
                  label: normalizeText(format.label),
                  mimeType: normalizeText(format.mimeType),
                  extension: normalizeText(format.extension),
                }))
              : [],
          }))
        : [],
    },
    safetyGates,
    conversation: {
      enabled: projection.conversation?.enabled === true,
      disabledReason: canStartSession
        ? ''
        : 'Additional business information is required before a session can start.',
      requestMaxLength: Number(projection.conversation?.promptMaxLength || 2000),
    },
    sourceOutputs,
    sessions: Array.isArray(projection.sessions) ? projection.sessions : [],
    assets: Array.isArray(projection.assets) ? projection.assets : [],
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
  const projection = await buildOutcomeStudioProjection({
    assets,
    outputLab,
    sessions,
    truthQuality,
  })
  return buildOutcomeStudioCustomerProjection(projection)
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
  const drafts = await listOutcomeDraftsForSession({
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
    ...serializeCustomerOutcomeSession(session, { currentEvidence }),
    messages,
    drafts,
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
    ...serializeOutcomeAssetSummary(asset, { currentEvidence }),
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

  return serializeCustomerOutcomeAssetVersion(version, { currentEvidence })
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
  assertCustomerReadyGeneration(currentVersion, { action: 'preview this content' })
  assertOutcomeCustomerLanguage({
    action: 'preview this content',
    customerContent: currentVersion.customerContent,
    limitations: currentVersion.limitations,
    warnings: currentVersion.warnings,
  })
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
    warnings: serializedVersion.warnings,
    limitations: serializedVersion.limitations,
    generatedAt: serializedVersion.generatedAt,
  }
}

export const getRuntimeOutcomeDraftPreview = async ({
  draftId,
  runtimeInstanceId,
  scopes,
  sessionId,
} = {}) => {
  const runtimeInstance = await getRuntimeInstance({ runtimeInstanceId, scopes })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const session = await findOutcomeSessionForRuntime({
    detailsRuntimeInstanceId: runtimeInstanceId,
    runtimeInstanceId: runtimeObjectId,
    sessionId,
  })
  const currentEvidence = buildRuntimeTruthEvidence(runtimeInstance)
  const serializedSession = serializeOutcomeSession(session, { currentEvidence })

  if (serializedSession.status !== OUTCOME_STUDIO_SESSION_STATUSES.ACTIVE) {
    throw buildOutcomeDraftPreviewBlockedError({
      blockerReason: 'OUTCOME_SESSION_NOT_ACTIVE',
      draftId,
      message: 'Outcome Studio draft preview cannot run for a non-active session.',
      sessionId: serializedSession.sessionId,
    })
  }

  assertOutcomeSessionTruthCurrent({
    actionLabel: 'draft preview',
    availabilityKey: 'previewAvailable',
    session: serializedSession,
  })

  const activeDraft = await findActiveOutcomeDraftForPreview({
    draftId,
    runtimeInstanceId: runtimeObjectId,
    sessionId: serializedSession.sessionId,
  })
  const currentIteration = await findCurrentOutcomeDraftIterationForPreview({
    activeDraft,
    runtimeInstanceId: runtimeObjectId,
    sessionId: serializedSession.sessionId,
  })
  const serializedDraft = serializeOutcomeDraft(activeDraft, { currentEvidence })
  const serializedIteration = serializeOutcomeDraftIteration(currentIteration)

  if (serializedIteration.iterationNumber !== serializedDraft.currentIterationNumber) {
    throw buildOutcomeDraftPreviewBlockedError({
      blockerReason: 'OUTCOME_DRAFT_ITERATION_NUMBER_MISMATCH',
      currentIterationId: serializedIteration.draftIterationId,
      draftId: serializedDraft.draftId,
      sessionId: serializedSession.sessionId,
    })
  }

  assertOutcomeDraftPreviewCurrentTruth({
    draft: serializedDraft,
    iteration: serializedIteration,
    session: serializedSession,
  })
  assertCustomerReadyGeneration(currentIteration)
  assertOutcomeDraftPreviewValidation({
    draft: activeDraft,
    iteration: currentIteration,
    sessionId: serializedSession.sessionId,
  })

  const title = normalizeText(serializedIteration.title || serializedDraft.title) || 'Working draft'
  const previewContent = getOutcomeDraftIterationPreviewContent({
    draftId: serializedDraft.draftId,
    iteration: currentIteration,
    sessionId: serializedSession.sessionId,
  })
  assertOutcomeCustomerLanguage({
    action: 'preview this draft',
    customerContent: previewContent,
    title,
  })

  return {
    draftId: serializedDraft.draftId,
    draftIterationId: serializedIteration.draftIterationId,
    iterationNumber: serializedIteration.iterationNumber,
    title,
    previewAvailable: true,
    contentFormat: previewContent.markdown ? 'MARKDOWN' : 'SECTIONS',
    markdown: previewContent.markdown,
    sections: previewContent.sections,
    generatedAt: serializedIteration.generatedAt,
  }
}

export const getRuntimeOutcomeStudioReadiness = async ({
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
  const outcomeStudio = await buildOutcomeStudioProjection({ outputLab, truthQuality })
  return buildOutcomeStudioCustomerProjection(outcomeStudio).readiness
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
      message: 'Outcome Studio session cannot start until current verified business information is available.',
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
  const requestedOutputTypeKey = normalizeCapabilityKey(
    payload?.requestedOutputTypeKey || sourceOutput?.outputTypeKey,
  )
  const knowledgeContextResult = await resolveOutcomeStudioKnowledgeContext({
    query: {
      ...runtimeScope,
      environmentKey: 'PRODUCTION',
      workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
      requestedOutputTypeKey,
      resolvedAt: boundAt,
    },
  })
  const resolvedKnowledgeContext = assertOutcomeStudioKnowledgeContextReady({
    availabilityKey: 'canStartSession',
    result: knowledgeContextResult,
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
  })
  const requestedOutputTypeLabel = normalizeText(resolvedKnowledgeContext.outputType?.label)
  const knowledgePackBinding = buildSessionKnowledgePackBinding(
    knowledgeContextResult.reasoningBinding,
    boundAt,
  )
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
    requestedOutputTypeKey,
    requestedOutputTypeLabel,
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
          requestedOutputTypeKey,
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
            resolutionSource: knowledgePackBinding.resolutionSource,
            policyKey: knowledgePackBinding.policyKey,
            policyVersion: knowledgePackBinding.policyVersion,
            manifestId: knowledgePackBinding.manifestId,
            manifestKey: knowledgePackBinding.manifestKey,
            manifestVersion: knowledgePackBinding.manifestVersion,
            boundAt,
            activeCount: knowledgePackBinding.activeCount,
            resolvedCount: knowledgePackBinding.resolvedCount,
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

  return serializeCustomerOutcomeSession(session)
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
      message: 'Outcome Studio request cannot be submitted to a non-active session.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
      details: {
        sessionId: serializedSession.sessionId,
        status: serializedSession.status,
      },
    })
  }

  assertOutcomeSessionTruthCurrent({
    actionLabel: 'request submission',
    availabilityKey: 'promptPersistenceAvailable',
    session: serializedSession,
  })

  const submittedAt = new Date().toISOString()
  const prompt = normalizeText(payload?.prompt)
  const runtimeScope = getRuntimeScope(runtimeInstance)
  const requestedOutputTypeKey = normalizeCapabilityKey(
    payload?.requestedOutputTypeKey
    || serializedSession.requestedOutputTypeKey
    || serializedSession.sourceOutputTypeKey,
  )
  const knowledgeContextResult = await resolveOutcomeStudioKnowledgeContext({
    query: {
      ...runtimeScope,
      environmentKey: 'PRODUCTION',
      workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
      requestedOutputTypeKey,
      resolvedAt: submittedAt,
    },
  })
  const resolvedKnowledgeContext = assertOutcomeStudioKnowledgeContextReady({
    availabilityKey: 'promptPersistenceAvailable',
    result: knowledgeContextResult,
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
  })
  const requestedOutputTypeLabel = normalizeText(resolvedKnowledgeContext.outputType?.label)
  const requestKnowledgePackBinding = buildSessionKnowledgePackBinding(
    knowledgeContextResult.reasoningBinding,
    submittedAt,
  )
  const messageId = buildOutcomeMessageId()
  const contextBindings = buildOutcomeContextBindings({
    contextType: 'MESSAGE',
    knowledgePackBinding: requestKnowledgePackBinding,
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
    requestedOutputTypeKey,
    requestedOutputTypeLabel,
    sourceOutputSnapshot: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
    knowledgePackBinding: requestKnowledgePackBinding,
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
          requestedOutputTypeKey,
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

  return serializeCustomerOutcomeMessage(message)
}

export const generateRuntimeOutcomeResponse = async ({
  actorUserId,
  auditRequest,
  executionMode,
  providerAdapter,
  providerDescriptor,
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
      message: 'Outcome Studio draft generation requires a customer request.',
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
      message: 'Outcome Studio draft generation has already completed for this request.',
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

  const activeDraft = await findActiveOutcomeDraftForSession({
    runtimeInstanceId: runtimeObjectId,
    sessionId: serializedSession.sessionId,
  })
  const runtimeScope = getRuntimeScope(runtimeInstance)
  const generatedAt = new Date().toISOString()
  const requestedOutputTypeKey = normalizeCapabilityKey(
    serializedMessage.requestedOutputTypeKey
    || activeDraft?.outputTypeCapabilityKey
    || serializedSession.requestedOutputTypeKey
    || serializedSession.sourceOutputTypeKey
    || serializedSession.sourceOutput?.outputTypeKey,
  )
  const knowledgeContextResult = await resolveOutcomeStudioKnowledgeContext({
    query: {
      ...runtimeScope,
      environmentKey: 'PRODUCTION',
      workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
      requestedOutputTypeKey,
      resolvedAt: generatedAt,
    },
  })
  const resolvedKnowledgeContext = assertOutcomeStudioKnowledgeContextReady({
    result: knowledgeContextResult,
  })
  const requestResolution = assertOutcomeStudioRequestResolution({
    activeDraft,
    message: serializedMessage,
    requestedOutputTypeKey,
    resolvedKnowledgeContext,
    session: serializedSession,
  })
  const isDraftRefinement = requestResolution?.intent?.refinement === true
  const currentDraftIteration = isDraftRefinement
    ? await findCurrentOutcomeDraftIterationForRefinement({
        activeDraft,
        messageId: serializedMessage.messageId,
        runtimeInstanceId: runtimeObjectId,
        sessionId: serializedSession.sessionId,
      })
    : null

  const resolvedOutputTypeKey = normalizeToken(
    requestResolution?.outputType?.key
    || serializedSession.sourceOutputTypeKey
    || serializedSession.sourceOutput?.outputTypeKey,
  )
  const resolvedOutputTypeLabel = normalizeText(
    requestResolution?.outputType?.label
    || serializedSession.sourceOutputTypeLabel
    || serializedSession.sourceOutput?.outputTypeLabel,
  )
  const resolvedOutputTypeCapabilityKey = normalizeCapabilityKey(
    requestResolution?.outputType?.capabilityKey || requestedOutputTypeKey,
  )
  const resolvedStyleKey = normalizeCapabilityKey(requestResolution?.style?.styleKey)
  assertRequestKnowledgePackBindingReady({
    binding: knowledgeContextResult.reasoningBinding,
    requestResolution,
  })
  const generationKnowledgePackBinding = buildSessionKnowledgePackBinding(
    knowledgeContextResult.reasoningBinding,
    generatedAt,
  )
  const grrEnabled = isOutcomeStudioGrrEnabled()
  if (!grrEnabled) throw buildDraftingServiceUnavailableError()
  const outcomeExecutionMode = executionMode === undefined ? 'LIVE_TEST' : executionMode
  if (outcomeExecutionMode === 'LEGACY' && typeof providerAdapter !== 'function') throw buildDraftingServiceUnavailableError()
  const liveTestConfiguration = resolveLiveTestConfiguration({
    executionMode: outcomeExecutionMode,
    providerAdapter,
    providerDescriptor,
  })
  if (liveTestConfiguration.executionMode === 'LIVE_TEST') {
    await authorizeOutcomeStudioLiveTestExecution({
      providerDescriptor: liveTestConfiguration.providerDescriptor,
      stage: 'PRE_IDEMPOTENCY',
    })
  }
  const providerInput = {
    customerPrompt: serializedMessage.prompt,
    currentDraftMarkdown: isDraftRefinement ? getDraftIterationMarkdown(currentDraftIteration) : '',
    request: {
      intentType: normalizeToken(requestResolution?.intent?.type),
      refinement: isDraftRefinement,
      outputTypeKey: resolvedOutputTypeKey,
      outputTypeLabel: resolvedOutputTypeLabel,
      outputSchemaKey: normalizeCapabilityKey(requestResolution?.outputSchema?.schemaKey),
      requiredSections: Array.isArray(requestResolution?.outputSchema?.requiredSections)
        ? requestResolution.outputSchema.requiredSections.map(normalizeText)
        : [],
      styleKey: resolvedStyleKey,
      styleLabel: normalizeText(requestResolution?.style?.label),
      requestedOutputTypeKey: resolvedOutputTypeCapabilityKey,
      requestedStyleKey: resolvedStyleKey,
      workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    },
  }
  const grrExecution = await createGovernedReasoningExecution({
    actorUserId,
    auditRequest,
    payload: {
      outputTypeKey: resolvedOutputTypeKey,
      requestedOutputTypeKey: resolvedOutputTypeCapabilityKey,
      requestedStyleKey: resolvedStyleKey,
      executionIntent: buildGrrExecutionIntent({
        currentDraftIteration,
        message: serializedMessage,
        requestResolution,
        session: serializedSession,
      }),
      idempotencyKey: [
        DEFAULT_OUTCOME_WORKSPACE_TYPE,
        serializedSession.sessionId,
        serializedMessage.messageId,
        'GENERATE_RESPONSE',
      ].join(':'),
      workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    },
    deps: {
      executionMode: outcomeExecutionMode,
      providerAdapter,
      providerDescriptor,
      providerInput,
      resolveKnowledgeBinding: async () => knowledgeContextResult.reasoningResolution,
    },
    runtimeInstanceId,
    scopes,
  })
  const generatedResponseText = buildGrrOutcomeResponseText({
    grrExecution,
    outputTypeLabel: resolvedOutputTypeLabel,
    session: serializedSession,
  })
  const responsePrompt = isDraftRefinement
    ? buildRefinedOutcomeDraftResponseText({
        currentIteration: currentDraftIteration,
        generatedResponseText,
        grrExecution,
        message: serializedMessage,
        outputTypeLabel: resolvedOutputTypeLabel,
        requestResolution,
        session: serializedSession,
      })
    : generatedResponseText
  const responseMessageId = buildOutcomeMessageId()
  const draftId = isDraftRefinement ? normalizeText(activeDraft.draftId) : buildOutcomeDraftId()
  const draftIterationId = buildOutcomeDraftIterationId()
  const previousDraftIterationId = normalizeText(currentDraftIteration?.draftIterationId)
  const previousDraftIterationNumber = Number(
    currentDraftIteration?.iterationNumber
    || activeDraft?.currentIterationNumber
    || 0,
  )
  const draftIterationNumber = isDraftRefinement ? previousDraftIterationNumber + 1 : 1
  const draftTitle = isDraftRefinement
    ? normalizeText(activeDraft.title) || buildOutcomeDraftTitle({ session: serializedSession })
    : buildOutcomeDraftTitle({
        outputTypeLabel: resolvedOutputTypeLabel,
        session: serializedSession,
      })
  const baseRefinementMetadata = isDraftRefinement
    ? buildDraftRefinementMetadata({
        currentIteration: currentDraftIteration,
        requestResolution,
      })
    : null
  const refinementMetadata = baseRefinementMetadata
    ? {
        ...baseRefinementMetadata,
        compare: {
          ...baseRefinementMetadata.compare,
          toIterationId: draftIterationId,
        },
      }
    : null
  const lineageSummary = buildGeneratedOutcomeAssetLineageSummary({
    generatedAt,
    grrExecution,
    runtimeInstance,
    session: serializedSession,
  })
  lineageSummary.knowledgeResolution = {
    status: generationKnowledgePackBinding.status,
    policyVersion: generationKnowledgePackBinding.resolution.policyVersion,
    resolvedAt: generationKnowledgePackBinding.lineage.resolvedAt,
    activationIds: generationKnowledgePackBinding.lineage.activationIds,
    versionIds: generationKnowledgePackBinding.lineage.versionIds,
    contentHashes: generationKnowledgePackBinding.lineage.contentHashes,
  }
  if (refinementMetadata) {
    lineageSummary.draftRefinement = refinementMetadata
  }
  const customerContent = buildGeneratedOutcomeDraftCustomerContent({
    responseText: responsePrompt,
    session: serializedSession,
    title: draftTitle,
  })
  const warnings = buildOutcomeWarningsFromGrr({ grrExecution })
  const limitations = buildOutcomeLimitationsFromGrr({ grrExecution })
  const postValidation = buildOutcomeAssetPostValidationSnapshot({
    asset: {
      outcomeAssetId: draftId,
      outputTypeKey: resolvedOutputTypeKey,
    },
    customerContent,
    knowledgePackBinding: generationKnowledgePackBinding,
    limitations,
    truthSignature: serializedSession.truthSignature,
    validatedAt: generatedAt,
    version: {
      outcomeAssetVersionId: draftIterationId,
      outputTypeKey: resolvedOutputTypeKey,
    },
    warnings,
  })
  if (!isOutcomePostValidationAllowed(postValidation)) {
    throw buildCustomerContentReviewError({ action: 'create this draft' })
  }
  const draftValidationSummary = {
    ...postValidation,
    validationScope: 'OUTCOME_DRAFT_ITERATION',
    outcomeAssetId: '',
    outcomeAssetVersionId: '',
    draftId,
    draftIterationId,
    validators: Array.isArray(postValidation.validators)
      ? postValidation.validators.map((validator) => ({
          ...validator,
          message: normalizeText(validator?.message).replace(/generated asset/gi, 'generated draft'),
        }))
      : [],
  }
  const responseContextBindings = buildOutcomeContextBindings({
    contextType: 'MESSAGE',
    grrExecution,
    knowledgePackBinding: generationKnowledgePackBinding,
    messageId: responseMessageId,
    runtimeScope,
    sessionId: serializedSession.sessionId,
    sourceOutput: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
  })
  const draftContextBindings = buildOutcomeContextBindings({
    assetType: DEFAULT_OUTCOME_ASSET_TYPE,
    contextType: 'DRAFT',
    grrExecution,
    knowledgePackBinding: generationKnowledgePackBinding,
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
    requestedOutputTypeKey: resolvedOutputTypeCapabilityKey,
    requestedOutputTypeLabel: resolvedOutputTypeLabel,
    sourceOutputSnapshot: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
    knowledgePackBinding: generationKnowledgePackBinding,
    contextBindings: responseContextBindings,
    submittedBy: actorUserId,
    submittedAt: generatedAt,
  })
  const outcomeDraft = isDraftRefinement
    ? {
        ...activeDraft,
        outputTypeKey: resolvedOutputTypeKey,
        outputTypeCapabilityKey: resolvedOutputTypeCapabilityKey,
        outputTypeLabel: resolvedOutputTypeLabel,
        knowledgePackBinding: generationKnowledgePackBinding,
        currentIterationId: draftIterationId,
        currentIterationNumber: draftIterationNumber,
        lineageSummary,
        validationSummary: draftValidationSummary,
        warnings,
        limitations,
        updatedAt: generatedAt,
      }
    : new OutcomeDraft({
        draftId,
        sessionId: serializedSession.sessionId,
        ...runtimeScope,
        workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
        assetType: DEFAULT_OUTCOME_ASSET_TYPE,
        contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
        phase: OUTCOME_STUDIO_PHASE,
        status: OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE,
        outputTypeKey: resolvedOutputTypeKey,
        outputTypeCapabilityKey: resolvedOutputTypeCapabilityKey,
        outputTypeLabel: resolvedOutputTypeLabel,
        title: draftTitle,
        sourceOutputAssetId: serializedSession.sourceOutputAssetId || serializedSession.sourceOutput?.outputAssetId,
        truthSignature: serializedSession.truthSignature,
        truthSignatureId: serializedSession.truthSignatureId || serializedSession.truthSignature?.truthSignatureId,
        knowledgePackBinding: generationKnowledgePackBinding,
        currentIterationId: draftIterationId,
        currentIterationNumber: 1,
        contextBindings: draftContextBindings,
        lineageSummary,
        validationSummary: draftValidationSummary,
        warnings,
        limitations,
        createdBy: actorUserId,
      })
  const outcomeDraftIteration = new OutcomeDraftIteration({
    draftIterationId,
    draftId,
    previousIterationId: previousDraftIterationId,
    iterationNumber: draftIterationNumber,
    sessionId: serializedSession.sessionId,
    ...runtimeScope,
    workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    assetType: DEFAULT_OUTCOME_ASSET_TYPE,
    contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
    phase: OUTCOME_STUDIO_PHASE,
    iterationType: isDraftRefinement
      ? OUTCOME_STUDIO_DRAFT_ITERATION_TYPES.REFINEMENT
      : OUTCOME_STUDIO_DRAFT_ITERATION_TYPES.INITIAL,
    status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT,
    outputTypeKey: outcomeDraft.outputTypeKey,
    outputTypeCapabilityKey: resolvedOutputTypeCapabilityKey,
    outputTypeLabel: outcomeDraft.outputTypeLabel,
    title: draftTitle,
    sourceMessageId: serializedMessage.messageId,
    responseMessageId,
    truthSignatureId: serializedSession.truthSignatureId || serializedSession.truthSignature?.truthSignatureId,
    grrExecutionId: grrExecution?.executionId || '',
    grrRuntimeArtifactId: grrExecution?.artifact?.runtimeArtifactId || '',
    customerContent,
    validationSummary: draftValidationSummary,
    lineageSummary,
    warnings,
    limitations,
    generatedBy: actorUserId,
    generatedAt,
  })

  let failureStage = 'write'
  let refinementClaimAcquired = false
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
    if (isDraftRefinement) {
      const previousIterationUpdate = {
        $set: {
          status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.SUPERSEDED,
        },
      }
      const draftUpdate = {
        $set: {
          outputTypeKey: resolvedOutputTypeKey,
          outputTypeCapabilityKey: resolvedOutputTypeCapabilityKey,
          outputTypeLabel: resolvedOutputTypeLabel,
          knowledgePackBinding: generationKnowledgePackBinding,
          currentIterationId: draftIterationId,
          currentIterationNumber: draftIterationNumber,
          lineageSummary,
          validationSummary: draftValidationSummary,
          warnings,
          limitations,
        },
      }
      const draftClaimFilter = {
        _id: activeDraft._id || activeDraft.id,
        status: OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE,
        currentIterationId: previousDraftIterationId,
      }
      const draftClaimResult = dbSession
        ? await OutcomeDraft.updateOne(draftClaimFilter, draftUpdate, { session: dbSession })
        : await OutcomeDraft.updateOne(draftClaimFilter, draftUpdate)
      if (Number(draftClaimResult?.modifiedCount || 0) !== 1) {
        throw buildOutcomeDraftRefinementBlockedError({
          blockerReason: 'OUTCOME_DRAFT_REFINEMENT_CONCURRENT_CHANGE',
          currentIterationId: previousDraftIterationId,
          draftId,
          messageId: serializedMessage.messageId,
          sessionId: serializedSession.sessionId,
        })
      }
      refinementClaimAcquired = true
      if (dbSession) {
        await OutcomeDraftIteration.updateMany(
          {
            runtimeInstanceId: runtimeObjectId,
            draftId,
            status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT,
          },
          previousIterationUpdate,
          { session: dbSession },
        )
        await outcomeDraftIteration.save(saveOptions)
      } else {
        await OutcomeDraftIteration.updateMany(
          {
            runtimeInstanceId: runtimeObjectId,
            draftId,
            status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT,
          },
          previousIterationUpdate,
        )
        await outcomeDraftIteration.save(saveOptions)
      }
    } else {
      await outcomeDraft.save(saveOptions)
      await outcomeDraftIteration.save(saveOptions)
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
          knowledgePackBindingStatus: generationKnowledgePackBinding.status,
          knowledgePackResolutionPolicyVersion:
            generationKnowledgePackBinding.resolution.policyVersion,
          knowledgePackActivationIds: generationKnowledgePackBinding.lineage.activationIds,
          knowledgePackVersionIds: generationKnowledgePackBinding.lineage.versionIds,
          knowledgePackContentHashes: generationKnowledgePackBinding.lineage.contentHashes,
          responseStatus: OUTCOME_STUDIO_RESPONSE_STATUSES.RESPONSE_GENERATED,
          assetCreated: false,
          draftCreated: !isDraftRefinement,
          draftRefined: isDraftRefinement,
          draftId,
          draftIterationId,
          previousDraftIterationId,
          iterationNumber: draftIterationNumber,
          grrExecutionId: grrExecution?.executionId || '',
          grrRuntimeArtifactId: grrExecution?.artifact?.runtimeArtifactId || '',
          grrProviderMode: grrExecution?.providerMode || '',
          runtimeGraphRelationshipCount: 0,
        },
      })
      failureStage = 'draftAudit'
      await logOutcomeDraftGeneratedAudit({
        action: isDraftRefinement
          ? auditService.AUDIT_ACTIONS.OUTCOME_DRAFT_REFINED
          : auditService.AUDIT_ACTIONS.OUTCOME_DRAFT_GENERATED,
        auditRequest,
        dbSession,
        runtimeInstance,
        draft: outcomeDraft,
        summary: isDraftRefinement
          ? 'Outcome Studio conversation draft refined from governed response.'
          : 'Outcome Studio conversation draft and first iteration generated from governed response.',
        diff: {
          actorUserId,
          sessionId: serializedSession.sessionId,
          messageId: serializedMessage.messageId,
          responseMessageId: responseMessage.messageId,
          runtimeInstanceId: toIdString(runtimeObjectId),
          draftId,
          draftIterationId,
          previousDraftIterationId,
          iterationNumber: draftIterationNumber,
          draftCreated: !isDraftRefinement,
          draftRefined: isDraftRefinement,
          refinementMode: refinementMetadata?.mode || '',
          compareAvailable: refinementMetadata?.compare?.available === true,
          revertAvailable: refinementMetadata?.revert?.available === true,
          sourceOutputAssetId: outcomeDraft.sourceOutputAssetId,
          sourceOutputTypeKey: outcomeDraft.outputTypeKey,
          truthSignatureStatus: serializedSession.truthSignature.status,
          truthSignatureCurrentness: serializedSession.truthSignature.currentness,
          knowledgePackBindingStatus: generationKnowledgePackBinding.status,
          knowledgePackResolutionPolicyVersion:
            generationKnowledgePackBinding.resolution.policyVersion,
          knowledgePackActivationIds: generationKnowledgePackBinding.lineage.activationIds,
          knowledgePackVersionIds: generationKnowledgePackBinding.lineage.versionIds,
          knowledgePackContentHashes: generationKnowledgePackBinding.lineage.contentHashes,
          grrExecutionId: grrExecution?.executionId || '',
          grrRuntimeArtifactId: grrExecution?.artifact?.runtimeArtifactId || '',
          grrProviderMode: grrExecution?.providerMode || '',
          runtimeArtifactIsCertifiedTruth:
            grrExecution?.artifact?.certification?.runtimeArtifactIsCertifiedTruth === true,
          postValidation: buildOutcomePostValidationAuditSummary(draftValidationSummary),
          generatedBodyAvailable: true,
          assetVersionCreated: false,
          runtimeGraphRelationshipCount: 0,
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
      if (err?.outcomeResponseAuditFailure === 'draftAudit') {
        const failClosed = isDraftRefinement
          ? failDraftRefinementAuditClosed
          : failDraftGenerationAuditClosed
        throw failClosed(err, {
          sessionId: serializedSession.sessionId,
          messageId: serializedMessage.messageId,
          responseMessageId: responseMessage.messageId,
          draftId,
          draftIterationId,
          previousDraftIterationId,
        })
      }
      if (err?.outcomeResponseAuditFailure !== 'responseAudit') throw err
      throw failMessageAuditClosed(err, {
        sessionId: serializedSession.sessionId,
        messageId: serializedMessage.messageId,
        responseMessageId: responseMessage.messageId,
        draftId,
        draftIterationId,
        previousDraftIterationId,
      })
    } finally {
      await dbSession.endSession()
    }
  } else {
    try {
      await persistGeneratedResponseAndAudit()
    } catch (err) {
      await OutcomeDraftIteration.deleteOne({ _id: outcomeDraftIteration._id })
      if (isDraftRefinement) {
        if (refinementClaimAcquired) {
          await OutcomeDraftIteration.updateMany(
            {
              runtimeInstanceId: runtimeObjectId,
              draftId,
              draftIterationId: previousDraftIterationId,
            },
            {
              $set: {
                status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT,
              },
            },
          )
          await OutcomeDraft.updateOne(
            {
              _id: activeDraft._id || activeDraft.id,
              status: OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE,
              currentIterationId: draftIterationId,
            },
            {
              $set: {
                currentIterationId: previousDraftIterationId,
                currentIterationNumber: previousDraftIterationNumber,
                lineageSummary: activeDraft.lineageSummary || {},
                validationSummary: activeDraft.validationSummary || {},
                warnings: Array.isArray(activeDraft.warnings) ? activeDraft.warnings : [],
                limitations: Array.isArray(activeDraft.limitations) ? activeDraft.limitations : [],
              },
            },
          )
        }
      } else {
        await OutcomeDraft.deleteOne({ _id: outcomeDraft._id })
      }
      await OutcomeMessage.deleteOne({ _id: responseMessage._id })
      await OutcomeMessage.updateOne(
        { _id: message._id },
        { $set: { responseStatus: OUTCOME_STUDIO_RESPONSE_STATUSES.PENDING_RESPONSE } },
      )
      if (err?.outcomeResponseAuditFailure === 'draftAudit') {
        const failClosed = isDraftRefinement
          ? failDraftRefinementAuditClosed
          : failDraftGenerationAuditClosed
        throw failClosed(err, {
          sessionId: serializedSession.sessionId,
          messageId: serializedMessage.messageId,
          responseMessageId: responseMessage.messageId,
          draftId,
          draftIterationId,
          previousDraftIterationId,
        })
      }
      if (err?.outcomeResponseAuditFailure !== 'responseAudit') throw err
      throw failMessageAuditClosed(err, {
        sessionId: serializedSession.sessionId,
        messageId: serializedMessage.messageId,
        responseMessageId: responseMessage.messageId,
        draftId,
        draftIterationId,
        previousDraftIterationId,
      })
    }
  }

  return {
    ...serializeCustomerOutcomeMessage(responseMessage),
    draft: serializeCustomerOutcomeDraft(outcomeDraft, { currentEvidence }),
    draftIteration: serializeCustomerOutcomeDraftIteration(outcomeDraftIteration),
  }
}

export const approveRuntimeOutcomeDraft = async ({
  actorUserId,
  auditRequest,
  draftId,
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
      message: 'Outcome Studio draft approval cannot run for a non-active session.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_SESSION_BLOCKED,
      details: {
        sessionId: serializedSession.sessionId,
        status: serializedSession.status,
        approvalAvailable: false,
      },
    })
  }

  assertOutcomeSessionTruthCurrent({
    actionLabel: 'draft approval',
    availabilityKey: 'approvalAvailable',
    session: serializedSession,
  })

  const activeDraft = await findActiveOutcomeDraftForApproval({
    draftId,
    runtimeInstanceId: runtimeObjectId,
    sessionId: serializedSession.sessionId,
  })
  const currentDraftIteration = await findCurrentOutcomeDraftIterationForApproval({
    activeDraft,
    runtimeInstanceId: runtimeObjectId,
    sessionId: serializedSession.sessionId,
  })
  assertCustomerReadyGeneration(currentDraftIteration, { action: 'approve this draft' })
  assertOutcomeCustomerLanguage({
    action: 'approve this draft',
    customerContent: currentDraftIteration.customerContent,
    limitations: currentDraftIteration.limitations || activeDraft.limitations,
    warnings: currentDraftIteration.warnings || activeDraft.warnings,
  })
  const approvedKnowledgePackBinding = sanitizePersistedKnowledgePackBinding(
    activeDraft.knowledgePackBinding || serializedSession.knowledgePackBinding,
  )

  const approvedAt = new Date()
  const approvedAtIso = approvedAt.toISOString()
  const runtimeScope = getRuntimeScope(runtimeInstance)
  const outcomeAssetId = buildOutcomeAssetId()
  const outcomeAssetVersionId = buildOutcomeAssetVersionId()
  const versionNumber = 1
  const parentVersionId = normalizeText(
    activeDraft.lineageSummary?.parentVersionId
    || currentDraftIteration.lineageSummary?.parentVersionId,
  )
  const outputTypeKey = normalizeToken(activeDraft.outputTypeKey || serializedSession.sourceOutputTypeKey)
  const outputTypeCapabilityKey = assertPersistedOutputTypeCapabilityKey({
    actionLabel: 'approve this draft',
    availabilityKey: 'approvalAvailable',
    customerMessage: 'This draft cannot be approved until its output type is confirmed.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_APPROVAL_BLOCKED,
    records: [currentDraftIteration, activeDraft],
  })
  const outputTypeLabel = normalizeText(activeDraft.outputTypeLabel || serializedSession.sourceOutputTypeLabel)
  const sourceOutputAssetId = normalizeText(
    activeDraft.sourceOutputAssetId
    || serializedSession.sourceOutputAssetId
    || serializedSession.sourceOutput?.outputAssetId,
  )
  const title = projectApprovedOutcomeTitle({
    outputTypeLabel,
    title: activeDraft.title,
  }) || buildOutcomeAssetTitle({ session: serializedSession })
  const customerContent = buildApprovedOutcomeAssetVersionCustomerContent({
    customerContent: currentDraftIteration.customerContent,
  })
  const lineageSummary = {
    ...buildOutcomeAssetLineageSummary(
      currentDraftIteration.lineageSummary
      || activeDraft.lineageSummary
      || {},
    ),
    sourceOutputAssetId,
    sourceOutputTypeKey: outputTypeKey,
    sourceOutputTypeLabel: outputTypeLabel,
    truthSignatureStatus: normalizeToken(serializedSession.truthSignature?.status),
    truthSignatureCurrentness: normalizeToken(serializedSession.truthSignature?.currentness),
    parentVersionId,
    generatedAt: approvedAtIso,
    draftApproval: {
      operation: 'DRAFT_APPROVAL',
      draftId: normalizeText(activeDraft.draftId),
      draftIterationId: normalizeText(currentDraftIteration.draftIterationId),
      approvedAt: approvedAtIso,
      approvedBy: actorUserId,
      outcomeAssetId,
      outcomeAssetVersionId,
      versionNumber,
    },
  }
  const postValidation = buildOutcomeAssetPostValidationSnapshot({
    asset: {
      outcomeAssetId,
      outputTypeKey,
    },
    customerContent,
    knowledgePackBinding: approvedKnowledgePackBinding,
    limitations: currentDraftIteration.limitations || activeDraft.limitations,
    truthSignature: serializedSession.truthSignature,
    validatedAt: approvedAtIso,
    version: {
      outcomeAssetVersionId,
      outputTypeKey,
    },
    warnings: currentDraftIteration.warnings || activeDraft.warnings,
  })
  if (!isOutcomePostValidationAllowed(postValidation)) {
    throw buildCustomerContentReviewError({ action: 'approve this draft' })
  }
  assertOutcomeAssetPostValidation({
    actionLabel: 'approval',
    asset: {
      outcomeAssetId,
    },
    availabilityKey: 'approvalAvailable',
    safetyGateCode: OUTCOME_STUDIO_SAFETY_GATE_CODES.ASSET_APPROVAL,
    version: {
      outcomeAssetVersionId,
      postValidation,
    },
  })

  const grrExecutionContext = normalizeText(currentDraftIteration.grrExecutionId)
    ? {
        executionId: currentDraftIteration.grrExecutionId,
        providerMode: lineageSummary.grrProviderMode,
        runtimeStateWrites: lineageSummary.grrRuntimeStateWrites,
        artifact: {
          runtimeArtifactId: currentDraftIteration.grrRuntimeArtifactId,
          certification: lineageSummary.grrCertification,
        },
      }
    : null
  const assetContextBindings = buildOutcomeContextBindings({
    assetType: DEFAULT_OUTCOME_ASSET_TYPE,
    contextType: 'ASSET',
    grrExecution: grrExecutionContext,
    knowledgePackBinding: approvedKnowledgePackBinding,
    outcomeAssetId,
    outcomeAssetVersionId,
    runtimeScope,
    sessionId: serializedSession.sessionId,
    sourceOutput: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
  })
  const versionContextBindings = buildOutcomeContextBindings({
    assetType: DEFAULT_OUTCOME_ASSET_TYPE,
    contextType: 'ASSET_VERSION',
    grrExecution: grrExecutionContext,
    knowledgePackBinding: approvedKnowledgePackBinding,
    outcomeAssetId,
    outcomeAssetVersionId,
    runtimeScope,
    sessionId: serializedSession.sessionId,
    sourceOutput: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
  })
  const warnings = Array.isArray(currentDraftIteration.warnings) && currentDraftIteration.warnings.length
    ? currentDraftIteration.warnings
    : Array.isArray(activeDraft.warnings) ? activeDraft.warnings : []
  const limitations = Array.isArray(currentDraftIteration.limitations) && currentDraftIteration.limitations.length
    ? currentDraftIteration.limitations
    : Array.isArray(activeDraft.limitations) ? activeDraft.limitations : []
  const outcomeAsset = new OutcomeAsset({
    outcomeAssetId,
    sessionId: serializedSession.sessionId,
    ...runtimeScope,
    workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    assetType: DEFAULT_OUTCOME_ASSET_TYPE,
    contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
    phase: OUTCOME_STUDIO_PHASE,
    status: OUTCOME_STUDIO_ASSET_STATUSES.GENERATED,
    outputTypeKey,
    outputTypeCapabilityKey,
    outputTypeLabel,
    title,
    sourceOutputAssetId,
    currentVersionId: outcomeAssetVersionId,
    currentVersionNumber: versionNumber,
    sourceOutputSnapshot: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
    knowledgePackBinding: approvedKnowledgePackBinding,
    postValidation,
    contextBindings: assetContextBindings,
    lineageSummary,
    warnings,
    limitations,
    generatedBy: actorUserId,
    generatedAt: approvedAt,
  })
  const outcomeAssetVersion = new OutcomeAssetVersion({
    outcomeAssetVersionId,
    outcomeAssetId,
    parentVersionId,
    sessionId: serializedSession.sessionId,
    ...runtimeScope,
    workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    assetType: DEFAULT_OUTCOME_ASSET_TYPE,
    contractVersion: OUTCOME_STUDIO_CONTRACT_VERSION,
    phase: OUTCOME_STUDIO_PHASE,
    versionNumber,
    status: OUTCOME_STUDIO_ASSET_VERSION_STATUSES.CURRENT,
    outputTypeKey,
    outputTypeCapabilityKey,
    outputTypeLabel,
    title,
    sourceOutputAssetId,
    sourceOutputSnapshot: serializedSession.sourceOutput,
    truthSignature: serializedSession.truthSignature,
    knowledgePackBinding: approvedKnowledgePackBinding,
    postValidation,
    contextBindings: versionContextBindings,
    lineageSummary,
    customerContent,
    warnings,
    limitations,
    generatedBy: actorUserId,
    generatedAt: approvedAt,
  })
  const approvedDraft = {
    ...activeDraft,
    status: OUTCOME_STUDIO_DRAFT_STATUSES.APPROVED,
    approvedIterationId: currentDraftIteration.draftIterationId,
    approvedAssetVersionId: outcomeAssetVersionId,
    approvedBy: actorUserId,
    approvedAt,
    updatedAt: approvedAt,
  }
  const approvedDraftIteration = {
    ...currentDraftIteration,
    status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.APPROVED,
    updatedAt: approvedAt,
  }
  const assetRelationshipDocuments = createRuntimeGraphRelationshipDocuments(
    buildGeneratedAssetRuntimeGraphRelationships({
      actorUserId,
      asset: outcomeAsset,
      runtimeScope,
      session,
      version: outcomeAssetVersion,
    }),
  )

  let failureStage = 'write'
  let approvalClaimAcquired = false
  const persistApprovalAndAudit = async (dbSession = null) => {
    const saveOptions = dbSession ? { session: dbSession } : undefined
    const updateOptions = dbSession ? { session: dbSession } : undefined
    const draftClaimFilter = {
      _id: activeDraft._id || activeDraft.id,
      status: OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE,
    }
    const draftApprovalUpdate = {
      $set: {
        status: OUTCOME_STUDIO_DRAFT_STATUSES.APPROVED,
        approvedIterationId: currentDraftIteration.draftIterationId,
        approvedAssetVersionId: outcomeAssetVersionId,
        approvedBy: actorUserId,
        approvedAt,
      },
    }
    const draftClaimResult = updateOptions
      ? await OutcomeDraft.updateOne(draftClaimFilter, draftApprovalUpdate, updateOptions)
      : await OutcomeDraft.updateOne(draftClaimFilter, draftApprovalUpdate)

    if (Number(draftClaimResult?.modifiedCount || 0) !== 1) {
      throw buildOutcomeDraftApprovalBlockedError({
        blockerReason: 'OUTCOME_DRAFT_ALREADY_APPROVED',
        currentIterationId: currentDraftIteration.draftIterationId,
        draftId: activeDraft.draftId,
        sessionId: serializedSession.sessionId,
      })
    }
    approvalClaimAcquired = true

    const iterationFilter = {
      runtimeInstanceId: runtimeObjectId,
      draftId: activeDraft.draftId,
      draftIterationId: currentDraftIteration.draftIterationId,
      status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT,
    }
    const iterationApprovalUpdate = {
      $set: {
        status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.APPROVED,
      },
    }
    if (updateOptions) {
      await OutcomeDraftIteration.updateMany(iterationFilter, iterationApprovalUpdate, updateOptions)
    } else {
      await OutcomeDraftIteration.updateMany(iterationFilter, iterationApprovalUpdate)
    }

    await outcomeAsset.save(saveOptions)
    await outcomeAssetVersion.save(saveOptions)
    try {
      await saveRuntimeGraphRelationshipDocuments(assetRelationshipDocuments, { dbSession })
    } catch (err) {
      err.outcomeGraphRelationshipFailure = 'approvedAsset'
      throw err
    }

    try {
      failureStage = 'draftApprovalAudit'
      await logOutcomeDraftGeneratedAudit({
        action: auditService.AUDIT_ACTIONS.OUTCOME_DRAFT_APPROVED,
        auditRequest,
        dbSession,
        draft: approvedDraft,
        runtimeInstance,
        summary: 'Outcome Studio conversation draft approved into a governed asset version.',
        diff: {
          actorUserId,
          sessionId: serializedSession.sessionId,
          runtimeInstanceId: toIdString(runtimeObjectId),
          draftId: activeDraft.draftId,
          draftIterationId: currentDraftIteration.draftIterationId,
          previousDraftStatus: normalizeToken(activeDraft.status),
          nextDraftStatus: OUTCOME_STUDIO_DRAFT_STATUSES.APPROVED,
          outcomeAssetId,
          outcomeAssetVersionId,
          versionNumber,
          approvalCreatedAssetVersion: true,
          truthSignatureStatus: serializedSession.truthSignature.status,
          truthSignatureCurrentness: serializedSession.truthSignature.currentness,
          postValidation: buildOutcomePostValidationAuditSummary(postValidation),
          runtimeGraphRelationshipCount: assetRelationshipDocuments.length,
        },
      })
      failureStage = 'assetAudit'
      await logOutcomeAssetGeneratedAudit({
        auditRequest,
        asset: outcomeAsset,
        dbSession,
        runtimeInstance,
        summary: 'Generated Outcome Studio governed asset version from approved conversation draft.',
        diff: {
          actorUserId,
          sessionId: serializedSession.sessionId,
          runtimeInstanceId: toIdString(runtimeObjectId),
          draftId: activeDraft.draftId,
          draftIterationId: currentDraftIteration.draftIterationId,
          outcomeAssetId,
          outcomeAssetVersionId,
          parentVersionId,
          versionNumber,
          sourceOutputAssetId,
          sourceOutputTypeKey: outputTypeKey,
          truthSignatureStatus: serializedSession.truthSignature.status,
          truthSignatureCurrentness: serializedSession.truthSignature.currentness,
          knowledgePackBindingStatus: approvedKnowledgePackBinding.status,
          knowledgePackResolutionPolicyVersion:
            approvedKnowledgePackBinding.resolution.policyVersion,
          knowledgePackActivationIds: approvedKnowledgePackBinding.lineage.activationIds,
          knowledgePackVersionIds: approvedKnowledgePackBinding.lineage.versionIds,
          knowledgePackContentHashes: approvedKnowledgePackBinding.lineage.contentHashes,
          postValidation: buildOutcomePostValidationAuditSummary(postValidation),
          generatedBodyAvailable: true,
          runtimeGraphRelationshipCount: assetRelationshipDocuments.length,
        },
      })
    } catch (err) {
      err.outcomeDraftApprovalAuditFailure = failureStage
      throw err
    }
  }

  if (canUseMongoTransaction()) {
    const dbSession = await mongoose.startSession()
    try {
      await dbSession.withTransaction(async () => {
        await persistApprovalAndAudit(dbSession)
      })
    } catch (err) {
      if (err?.outcomeGraphRelationshipFailure === 'approvedAsset') {
        throw failGraphRelationshipClosed(err, {
          draftId: activeDraft.draftId,
          draftIterationId: currentDraftIteration.draftIterationId,
          outcomeAssetId,
          outcomeAssetVersionId,
        })
      }
      if (err?.outcomeDraftApprovalAuditFailure === 'draftApprovalAudit') {
        throw failDraftApprovalAuditClosed(err, {
          draftId: activeDraft.draftId,
          draftIterationId: currentDraftIteration.draftIterationId,
          outcomeAssetId,
          outcomeAssetVersionId,
        })
      }
      if (err?.outcomeDraftApprovalAuditFailure !== 'assetAudit') throw err
      throw failAssetGenerationAuditClosed(err, {
        draftId: activeDraft.draftId,
        draftIterationId: currentDraftIteration.draftIterationId,
        outcomeAssetId,
        outcomeAssetVersionId,
      })
    } finally {
      await dbSession.endSession()
    }
  } else {
    try {
      await persistApprovalAndAudit()
    } catch (err) {
      if (approvalClaimAcquired) {
        await deleteRuntimeGraphRelationshipDocuments(assetRelationshipDocuments)
        await OutcomeAssetVersion.deleteOne({ _id: outcomeAssetVersion._id })
        await OutcomeAsset.deleteOne({ _id: outcomeAsset._id })
        await OutcomeDraftIteration.updateMany(
          {
            runtimeInstanceId: runtimeObjectId,
            draftId: activeDraft.draftId,
            draftIterationId: currentDraftIteration.draftIterationId,
          },
          {
            $set: {
              status: OUTCOME_STUDIO_DRAFT_ITERATION_STATUSES.CURRENT,
            },
          },
        )
        await OutcomeDraft.updateOne(
          {
            _id: activeDraft._id || activeDraft.id,
            status: OUTCOME_STUDIO_DRAFT_STATUSES.APPROVED,
            approvedAssetVersionId: outcomeAssetVersionId,
          },
          {
            $set: {
              status: activeDraft.status || OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE,
              approvedIterationId: activeDraft.approvedIterationId || '',
              approvedAssetVersionId: activeDraft.approvedAssetVersionId || '',
              approvedBy: activeDraft.approvedBy || null,
              approvedAt: activeDraft.approvedAt || null,
            },
          },
        )
      }
      if (err?.outcomeGraphRelationshipFailure === 'approvedAsset') {
        throw failGraphRelationshipClosed(err, {
          draftId: activeDraft.draftId,
          draftIterationId: currentDraftIteration.draftIterationId,
          outcomeAssetId,
          outcomeAssetVersionId,
        })
      }
      if (err?.outcomeDraftApprovalAuditFailure === 'draftApprovalAudit') {
        throw failDraftApprovalAuditClosed(err, {
          draftId: activeDraft.draftId,
          draftIterationId: currentDraftIteration.draftIterationId,
          outcomeAssetId,
          outcomeAssetVersionId,
        })
      }
      if (err?.outcomeDraftApprovalAuditFailure !== 'assetAudit') throw err
      throw failAssetGenerationAuditClosed(err, {
        draftId: activeDraft.draftId,
        draftIterationId: currentDraftIteration.draftIterationId,
        outcomeAssetId,
        outcomeAssetVersionId,
      })
    }
  }

  return {
    draft: serializeCustomerOutcomeDraft(approvedDraft, { currentEvidence }),
    draftIteration: serializeCustomerOutcomeDraftIteration(approvedDraftIteration),
    asset: serializeOutcomeAssetSummary(outcomeAsset, { currentEvidence }),
    assetVersion: serializeCustomerOutcomeAssetVersion(outcomeAssetVersion, { currentEvidence }),
  }
}

export const discardRuntimeOutcomeDraft = async ({
  actorUserId,
  auditRequest,
  draftId,
  expectedUpdatedAt,
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
    throw buildOutcomeDraftDiscardBlockedError({
      blockerReason: OUTCOME_STUDIO_DRAFT_DISCARD_BLOCKER_REASONS.SESSION_NOT_ACTIVE,
      draftId,
      sessionId: serializedSession.sessionId,
      status: serializedSession.status,
    })
  }

  const draftQuery = OutcomeDraft.findOne({
    runtimeInstanceId: runtimeObjectId,
    sessionId: serializedSession.sessionId,
    draftId: normalizeText(draftId),
  })
  const activeDraft = typeof draftQuery?.lean === 'function' ? await draftQuery.lean() : await draftQuery
  if (!activeDraft) {
    throw createOutcomeStudioError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Outcome Studio draft not found.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_DRAFT_NOT_FOUND,
      details: {
        runtimeInstanceId,
        sessionId: serializedSession.sessionId,
        draftId: normalizeText(draftId),
      },
    })
  }

  const currentStatus = normalizeToken(activeDraft.status)
  const currentIterationId = normalizeText(activeDraft.currentIterationId)
  if (currentStatus !== OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE) {
    throw buildOutcomeDraftDiscardBlockedError({
      blockerReason: OUTCOME_STUDIO_DRAFT_DISCARD_BLOCKER_REASONS.DRAFT_NOT_ACTIVE,
      currentIterationId,
      draftId: activeDraft.draftId,
      sessionId: serializedSession.sessionId,
      status: currentStatus,
    })
  }

  const expectedUpdatedAtIso = normalizeDateValue(expectedUpdatedAt)
  const loadedUpdatedAtIso = normalizeDateValue(activeDraft.updatedAt)
  if (!expectedUpdatedAtIso || loadedUpdatedAtIso !== expectedUpdatedAtIso) {
    throw buildOutcomeDraftDiscardBlockedError({
      blockerReason: OUTCOME_STUDIO_DRAFT_DISCARD_BLOCKER_REASONS.DRAFT_STALE,
      currentIterationId,
      draftId: activeDraft.draftId,
      sessionId: serializedSession.sessionId,
      status: currentStatus,
    })
  }

  const discardedAt = new Date()
  const discardedDraft = {
    ...activeDraft,
    status: OUTCOME_STUDIO_DRAFT_STATUSES.DISCARDED,
    discardedAt,
    discardedBy: actorUserId,
    updatedAt: discardedAt,
  }
  const claimFilter = {
    _id: activeDraft._id || activeDraft.id,
    status: OUTCOME_STUDIO_DRAFT_STATUSES.ACTIVE,
    updatedAt: new Date(expectedUpdatedAtIso),
    currentIterationId,
  }
  const discardUpdate = {
    $set: {
      status: OUTCOME_STUDIO_DRAFT_STATUSES.DISCARDED,
      discardedAt,
      discardedBy: actorUserId,
      updatedAt: discardedAt,
    },
  }
  let discardClaimAcquired = false

  const persistDiscardAndAudit = async (dbSession = null) => {
    const updateOptions = dbSession ? { session: dbSession } : undefined
    const claimResult = updateOptions
      ? await OutcomeDraft.updateOne(claimFilter, discardUpdate, updateOptions)
      : await OutcomeDraft.updateOne(claimFilter, discardUpdate)
    if (Number(claimResult?.modifiedCount || 0) !== 1) {
      throw buildOutcomeDraftDiscardBlockedError({
        blockerReason: OUTCOME_STUDIO_DRAFT_DISCARD_BLOCKER_REASONS.CONCURRENT_CHANGE,
        currentIterationId,
        draftId: activeDraft.draftId,
        sessionId: serializedSession.sessionId,
        status: currentStatus,
      })
    }
    discardClaimAcquired = true

    try {
      await logOutcomeDraftGeneratedAudit({
        action: auditService.AUDIT_ACTIONS.OUTCOME_DRAFT_DISCARDED,
        auditRequest,
        dbSession,
        draft: discardedDraft,
        runtimeInstance,
        summary: 'Outcome Studio working draft discarded and retained.',
        diff: {
          actorUserId,
          runtimeInstanceId: toIdString(runtimeObjectId),
          sessionId: serializedSession.sessionId,
          draftId: activeDraft.draftId,
          draftIterationId: currentIterationId,
          retainedIterationId: currentIterationId,
          previousDraftStatus: currentStatus,
          nextDraftStatus: OUTCOME_STUDIO_DRAFT_STATUSES.DISCARDED,
          discardedAt: discardedAt.toISOString(),
        },
      })
    } catch (err) {
      err.outcomeDraftDiscardAuditFailure = true
      throw err
    }
  }

  if (canUseMongoTransaction()) {
    const dbSession = await mongoose.startSession()
    try {
      await dbSession.withTransaction(async () => {
        await persistDiscardAndAudit(dbSession)
      })
    } catch (err) {
      if (!err?.outcomeDraftDiscardAuditFailure) throw err
      throw failDraftDiscardAuditClosed(err, {
        draftId: activeDraft.draftId,
        retainedIterationId: currentIterationId,
        sessionId: serializedSession.sessionId,
      })
    } finally {
      await dbSession.endSession()
    }
  } else {
    try {
      await persistDiscardAndAudit()
    } catch (err) {
      let rollbackError = null
      if (discardClaimAcquired) {
        try {
          const rollbackResult = await OutcomeDraft.updateOne(
            {
              _id: activeDraft._id || activeDraft.id,
              status: OUTCOME_STUDIO_DRAFT_STATUSES.DISCARDED,
              currentIterationId,
              discardedAt,
              discardedBy: actorUserId,
            },
            {
              $set: {
                status: activeDraft.status,
                discardedAt: activeDraft.discardedAt || null,
                discardedBy: activeDraft.discardedBy || null,
                updatedAt: activeDraft.updatedAt,
              },
            },
          )
          if (Number(rollbackResult?.modifiedCount || 0) !== 1) {
            rollbackError = new Error('Discard compensation did not restore the claimed draft.')
          }
        } catch (restoreError) {
          rollbackError = restoreError
        }
      }

      if (!err?.outcomeDraftDiscardAuditFailure) throw err
      throw failDraftDiscardAuditClosed(err, {
        draftId: activeDraft.draftId,
        retainedIterationId: currentIterationId,
        sessionId: serializedSession.sessionId,
        ...(rollbackError ? {
          rollbackFailure: {
            message: rollbackError.message || 'Discard compensation failed.',
          },
        } : {}),
      })
    }
  }

  return serializeCustomerOutcomeDraft(discardedDraft, { currentEvidence })
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
  assertCustomerReadyGeneration(currentVersion, { action: 'publish this content' })
  assertOutcomeCustomerLanguage({
    action: 'publish this content',
    customerContent: currentVersion.customerContent,
    limitations: currentVersion.limitations,
    warnings: currentVersion.warnings,
  })
  assertOutcomeAssetCurrentTruth({
    actionLabel: 'publish',
    asset: serializedAsset,
    availabilityKey: 'publishAvailable',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_PUBLISH_BLOCKED,
    safetyGateCode: OUTCOME_STUDIO_SAFETY_GATE_CODES.ASSET_PUBLISH,
    version: serializedVersion,
  })
  const postValidation = assertOutcomeAssetPostValidation({
    actionLabel: 'publish',
    asset: serializedAsset,
    availabilityKey: 'publishAvailable',
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
          postValidation: buildOutcomePostValidationAuditSummary(postValidation),
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
  assertCustomerReadyGeneration(currentVersion, { action: 'export this content' })
  assertOutcomeAssetCurrentTruth({
    actionLabel: 'export',
    asset: serializedAsset,
    availabilityKey: 'exportAvailable',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_BLOCKED,
    version: serializedVersion,
  })
  const postValidation = assertOutcomeAssetPostValidation({
    actionLabel: 'export',
    asset: serializedAsset,
    availabilityKey: 'exportAvailable',
    safetyGateCode: OUTCOME_STUDIO_SAFETY_GATE_CODES.EXPORT_RENDERER,
    version: serializedVersion,
  })
  const outputTypeCapabilityKey = assertPersistedOutputTypeCapabilityKey({
    actionLabel: 'export this content',
    availabilityKey: 'exportAvailable',
    customerMessage: 'This approved deliverable cannot be exported until its output type is confirmed.',
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_BLOCKED,
    records: [serializedVersion, serializedAsset],
  })
  const exportKnowledgeContextResult = await resolveOutcomeStudioKnowledgeContext({
    query: {
      ...getRuntimeScope(runtimeInstance),
      environmentKey: 'PRODUCTION',
      workspaceType: DEFAULT_OUTCOME_WORKSPACE_TYPE,
      requestedOutputTypeKey: outputTypeCapabilityKey,
      resolvedAt: new Date().toISOString(),
    },
  })
  const exportKnowledgeContext = assertOutcomeStudioKnowledgeContextReady({
    availabilityKey: 'exportAvailable',
    result: exportKnowledgeContextResult,
    reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_BLOCKED,
  })
  const capabilityBinding = {
    outputSchemaKey: exportKnowledgeContext.outputSchema?.key,
    outputTypeKey: exportKnowledgeContext.outputType?.key,
    styleKey: exportKnowledgeContext.style?.key,
  }
  const { customerContent, markdown } = getOutcomeAssetVersionCustomerContent({
    format: normalizedFormat,
    outcomeAssetId: serializedAsset.outcomeAssetId,
    version: currentVersion,
  })
  const documentMetadata = {
    title: serializedAsset.title,
    deliverableType: serializedAsset.outputTypeLabel,
    outputTypeDisplayKey: serializedAsset.outputTypeKey,
    versionNumber: serializedVersion.versionNumber,
    status: serializedAsset.status,
    warnings: serializedAsset.warnings,
    limitations: serializedAsset.limitations,
  }
  const sourceBinding = {
    assetId: serializedAsset.outcomeAssetId,
    assetVersionId: serializedVersion.outcomeAssetVersionId,
    versionNumber: serializedVersion.versionNumber,
  }
  const governedContent = {
    markdown,
    structuredContent: projectOutcomeCustomerContent(customerContent),
  }
  let descriptor
  try {
    descriptor = describeOutputDerivative({
      capabilityBinding,
      documentMetadata,
      format: normalizedFormat,
    })
  } catch (err) {
    if (isOutputServiceError(err) && err.code === OUTPUT_SERVICE_ERROR_CODES.CAPABILITY_UNSUPPORTED) {
      throw createOutcomeStudioError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Outcome Studio export format is not supported for this deliverable.',
        reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_FORMAT_UNSUPPORTED,
        details: {
          exportAvailable: false,
          format: normalizedFormat,
          blockerReason: err.reason,
          outputTypeKey: exportKnowledgeContext.outputType?.key,
        },
      })
    }
    if (isOutputServiceError(err) && err.code === OUTPUT_SERVICE_ERROR_CODES.INPUT_INVALID) {
      throw createOutcomeStudioError({
        status: 409,
        code: 'CONFLICT',
        message: 'Outcome Studio asset export requires persisted customer content for the requested format.',
        reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_CONTENT_UNAVAILABLE,
        details: { exportAvailable: false, format: normalizedFormat },
      })
    }
    throw createOutcomeStudioError({
      status: 500,
      code: 'OUTCOME_ACTION_FAILED',
      message: 'This deliverable could not be prepared for download.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_RENDER_FAILED,
      details: { exportAvailable: false, format: normalizedFormat },
    })
  }
  assertOutcomeCustomerLanguage({
    action: 'export this content',
    customerContent,
    filename: descriptor.filename,
    limitations: serializedVersion.limitations,
    warnings: serializedVersion.warnings,
  })
  let renderedDerivative
  try {
    renderedDerivative = await renderOutputDerivative({
      capabilityBinding,
      documentMetadata,
      format: normalizedFormat,
      governedContent,
      sourceBinding,
      persistReadyEvidence: async (outputServiceEvidence) => logOutcomeAssetExportAudit({
        auditRequest,
        asset,
        diff: {
          actorUserId,
          runtimeInstanceId: String(runtimeObjectId),
          runtimeInstanceKey: serializedAsset.runtimeInstanceKey,
          outcomeAssetId: serializedAsset.outcomeAssetId,
          outcomeAssetVersionId: serializedVersion.outcomeAssetVersionId,
          versionNumber: serializedVersion.versionNumber,
          format: normalizedFormat,
          filename: descriptor.filename,
          mimeType: descriptor.mimeType,
          contentIncludedInAudit: false,
          postValidation: buildOutcomePostValidationAuditSummary(postValidation),
          outputService: outputServiceEvidence,
        },
        runtimeInstance,
        summary: `Outcome Studio asset ${serializedAsset.outcomeAssetId} exported as ${normalizedFormat}.`,
      }),
    })
  } catch (err) {
    if (isOutputServiceError(err) && err.code === OUTPUT_SERVICE_ERROR_CODES.READY_EVIDENCE_FAILED) {
      throw failExportAuditClosed(err.cause || err, {
        outcomeAssetId: serializedAsset.outcomeAssetId,
        outcomeAssetVersionId: serializedVersion.outcomeAssetVersionId,
        format: normalizedFormat,
        exportAvailable: false,
      })
    }
    if (isOutputServiceError(err) && err.code === OUTPUT_SERVICE_ERROR_CODES.CAPABILITY_UNSUPPORTED) {
      throw createOutcomeStudioError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Outcome Studio export format is not supported for this deliverable.',
        reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_FORMAT_UNSUPPORTED,
        details: { exportAvailable: false, format: normalizedFormat },
      })
    }
    if (isOutputServiceError(err) && err.code === OUTPUT_SERVICE_ERROR_CODES.INPUT_INVALID) {
      throw createOutcomeStudioError({
        status: 409,
        code: 'CONFLICT',
        message: 'Outcome Studio asset export requires persisted customer content for the requested format.',
        reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_CONTENT_UNAVAILABLE,
        details: { exportAvailable: false, format: normalizedFormat },
      })
    }
    throw createOutcomeStudioError({
      status: 500,
      code: 'OUTCOME_ACTION_FAILED',
      message: 'This deliverable could not be prepared for download.',
      reason: OUTCOME_STUDIO_ERROR_REASONS.OUTCOME_ASSET_EXPORT_RENDER_FAILED,
      details: { exportAvailable: false, format: normalizedFormat },
    })
  }
  return renderedDerivative.delivery
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
      message: 'Outcome Studio can update a session only when newer verified business information is available.',
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
      message: 'Outcome Studio cannot update the session because the latest verified business information is incomplete.',
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
    sessionId: serializedSession.sessionId,
    status: serializedSession.status,
    informationStatus: buildCustomerInformationStatus(
      sanitizePersistedTruthSignature(nextTruthSignature, { currentEvidence: nextEvidence }),
    ),
    updatedAt: boundAt,
    lastActivityAt: boundAt,
    update: {
      status: 'UPDATED',
      informationCurrentness: 'CURRENT',
      updatedAssetCount: Number(assetRebindResult?.modifiedCount || 0),
      updatedVersionCount: Number(assetVersionRebindResult?.modifiedCount || 0),
    },
  }
}
