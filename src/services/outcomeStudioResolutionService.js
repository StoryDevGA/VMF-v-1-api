import {
  OUTCOME_STUDIO_REQUEST_INTENT_TYPES,
  OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES,
  OUTCOME_STUDIO_REQUEST_RESOLUTION_STATUSES,
} from '../constants/runtimeOutcomeStudio.js'

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeCapabilityKey = (value) => normalizeText(value).toLowerCase()

const hasPattern = (text, patterns = []) =>
  patterns.some((pattern) => pattern.test(text))

const clampText = (value, maxLength = 120) => {
  const text = normalizeText(value).replace(/\s+/g, ' ')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trim()}...`
}

const UNSAFE_REQUEST_PATTERNS = Object.freeze([
  /\b(raw|hidden|internal|system)\s+(prompt|instruction|instructions|reasoning)\b/i,
  /\bchain[-\s]?of[-\s]?thought\b/i,
  /\bhidden\s+reasoning\b/i,
  /\bknowledge\s+pack\s+(content|source|yaml|json|internals?)\b/i,
  /\braw\s+(source|evidence|runtime|graph|json|database)\b/i,
  /\bprovider\s+(prompt|payload|request|internals?)\b/i,
])

const INTENT_PATTERNS = Object.freeze({
  approve: Object.freeze([
    /\bapprove\b/i,
    /\bfinali[sz]e\b/i,
    /\bi(?:'| a)?m\s+happy\s+with\s+(this|the\s+draft|the\s+output)\b/i,
  ]),
  publish: Object.freeze([
    /\bpublish\b/i,
    /\brelease\s+(this|the\s+asset|the\s+version)\b/i,
  ]),
  regenerate: Object.freeze([
    /\bregenerate\b/i,
    /\btry\s+again\b/i,
    /\bredo\s+(this|the\s+section|the\s+draft)\b/i,
  ]),
  expand: Object.freeze([
    /\bexpand\b/i,
    /\bmore\s+detail\b/i,
    /\badd\s+(more|detail|context)\b/i,
  ]),
  reduce: Object.freeze([
    /\bshorten\b/i,
    /\bshorter\b/i,
    /\bmake\s+(it|this|the\s+draft)\s+shorter\b/i,
    /\bmore\s+concise\b/i,
    /\breduce\b/i,
  ]),
  tone: Object.freeze([
    /\btone\b/i,
    /\bstyle\b/i,
    /\bmore\s+(formal|direct|commercial|executive)\b/i,
    /\bless\s+(formal|technical|wordy)\b/i,
  ]),
  audience: Object.freeze([
    /\baudience\b/i,
    /\bfor\s+(the\s+)?(board|executives|sales|commercial\s+team)\b/i,
  ]),
  structure: Object.freeze([
    /\breorder\b/i,
    /\brestructure\b/i,
    /\bstructure\b/i,
    /\bsections?\b/i,
  ]),
  evidence: Object.freeze([
    /\bevidence\b/i,
    /\bsource-backed\b/i,
    /\bunsupported\b/i,
    /\bjustify\b/i,
    /\bclarify\b/i,
    /\bwhy\b/i,
  ]),
  refinement: Object.freeze([
    /\bmake\s+(it|this|the\s+draft)\b/i,
    /\bimprove\b/i,
    /\bpolish\b/i,
    /\brefine\b/i,
    /\brevise\b/i,
    /\brewrite\b/i,
    /\bchange\b/i,
    /\bupdate\b/i,
    /\btighten\b/i,
  ]),
  create: Object.freeze([
    /\bcreate\b/i,
    /\bgenerate\b/i,
    /\bproduce\b/i,
    /\bwrite\b/i,
    /\bdraft\s+(a|an|the)\b/i,
    /\bprepare\b/i,
    /\bbuild\b/i,
  ]),
})

const getSourceOutput = (session = {}) =>
  session.sourceOutput
  || session.sourceOutputSnapshot
  || {}

const getSessionOutputType = (session = {}) => {
  const sourceOutput = getSourceOutput(session)
  const key = normalizeCapabilityKey(
    session.requestedOutputTypeKey
    || session.sourceOutputTypeKey
    || sourceOutput.outputTypeKey,
  )
  return {
    key,
    label: normalizeText(
      session.requestedOutputTypeLabel
      || session.sourceOutputTypeLabel
      || sourceOutput.outputTypeLabel
    ),
    source: key ? (session.requestedOutputTypeKey ? 'SESSION_REQUEST' : 'SESSION_SOURCE_OUTPUT') : '',
  }
}

const getDraftOutputType = (activeDraft = {}) => {
  const capabilityKey = normalizeCapabilityKey(activeDraft?.outputTypeCapabilityKey)
  const key = normalizeToken(activeDraft?.outputTypeKey)
  return {
    key,
    capabilityKey,
    label: normalizeText(activeDraft?.outputTypeLabel),
    source: key ? 'ACTIVE_DRAFT' : '',
  }
}

const detectUnsafeRequest = (prompt) =>
  UNSAFE_REQUEST_PATTERNS.some((pattern) => pattern.test(prompt))

const classifyIntent = ({ prompt, hasActiveDraft = false } = {}) => {
  if (!prompt) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.AMBIGUOUS,
      refinement: false,
      requiresActiveDraft: false,
      confidence: 0,
      reason: 'Prompt is missing.',
    }
  }

  if (hasPattern(prompt, INTENT_PATTERNS.approve)) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.APPROVE_FINALISE,
      refinement: false,
      requiresActiveDraft: true,
      confidence: 0.9,
      reason: 'Approval/finalise language detected.',
    }
  }

  if (hasPattern(prompt, INTENT_PATTERNS.publish)) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.PUBLISH_REQUEST,
      refinement: false,
      requiresActiveDraft: true,
      confidence: 0.9,
      reason: 'Publish language detected.',
    }
  }

  if (hasPattern(prompt, INTENT_PATTERNS.regenerate)) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.REGENERATE_SECTION,
      refinement: true,
      requiresActiveDraft: true,
      confidence: 0.85,
      reason: 'Regeneration language detected.',
    }
  }

  if (hasPattern(prompt, INTENT_PATTERNS.create)) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.NEW_OUTCOME_REQUEST,
      refinement: false,
      requiresActiveDraft: false,
      confidence: 0.8,
      reason: 'New outcome creation language detected.',
    }
  }

  if (hasPattern(prompt, INTENT_PATTERNS.expand)) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.CONTENT_EXPANSION,
      refinement: true,
      requiresActiveDraft: true,
      confidence: 0.8,
      reason: 'Expansion language detected.',
    }
  }

  if (hasPattern(prompt, INTENT_PATTERNS.reduce)) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.CONTENT_REDUCTION,
      refinement: true,
      requiresActiveDraft: true,
      confidence: 0.8,
      reason: 'Reduction language detected.',
    }
  }

  if (hasPattern(prompt, INTENT_PATTERNS.tone)) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.TONE_STYLE_CHANGE,
      refinement: true,
      requiresActiveDraft: true,
      confidence: 0.75,
      reason: 'Tone or style language detected.',
    }
  }

  if (hasActiveDraft && hasPattern(prompt, INTENT_PATTERNS.audience)) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.AUDIENCE_CHANGE,
      refinement: true,
      requiresActiveDraft: true,
      confidence: 0.7,
      reason: 'Audience change language detected.',
    }
  }

  if (hasActiveDraft && hasPattern(prompt, INTENT_PATTERNS.structure)) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.STRUCTURAL_CHANGE,
      refinement: true,
      requiresActiveDraft: true,
      confidence: 0.7,
      reason: 'Structural change language detected.',
    }
  }

  if (hasPattern(prompt, INTENT_PATTERNS.refinement)) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.REFINEMENT_REQUEST,
      refinement: true,
      requiresActiveDraft: true,
      confidence: 0.65,
      reason: 'Generic refinement language detected.',
    }
  }

  if (hasPattern(prompt, INTENT_PATTERNS.evidence)) {
    return {
      type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.EVIDENCE_CHALLENGE,
      refinement: false,
      requiresActiveDraft: false,
      confidence: 0.7,
      reason: 'Evidence or clarification language detected.',
    }
  }

  return {
    type: OUTCOME_STUDIO_REQUEST_INTENT_TYPES.NEW_OUTCOME_REQUEST,
    refinement: false,
    requiresActiveDraft: false,
    confidence: 0.55,
    reason: 'No draft-only intent detected; defaulting to a new governed outcome request.',
  }
}

const resolveOutputType = ({
  activeDraft,
  blockers,
  intent,
  requestedOutputTypeKey,
  resolvedKnowledgeContext,
  session,
} = {}) => {
  const contextStatus = normalizeToken(resolvedKnowledgeContext?.status)
  const contextOutputType = resolvedKnowledgeContext?.outputType || {}
  const contextCapabilityKey = normalizeCapabilityKey(contextOutputType.key)
  const requestedCapabilityKey = normalizeCapabilityKey(requestedOutputTypeKey)

  if (contextStatus === 'AMBIGUOUS') {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_AMBIGUOUS,
      message: 'Outcome Studio found more than one eligible deliverable for this request.',
      details: {},
    })
    return {
      key: '',
      capabilityKey: requestedCapabilityKey,
      label: '',
      source: 'KNOWLEDGE_RESOLUTION',
    }
  }

  if (resolvedKnowledgeContext && (
    resolvedKnowledgeContext.available !== true
    || !['READY', 'READY_WITH_GAPS'].includes(contextStatus)
  )) {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_UNSUPPORTED,
      message: 'The requested deliverable is not currently available.',
      details: {
        requestedOutputTypeKey: requestedCapabilityKey,
      },
    })
    return {
      key: '',
      capabilityKey: requestedCapabilityKey,
      label: '',
      source: 'KNOWLEDGE_RESOLUTION',
    }
  }

  if (contextCapabilityKey) {
    if (requestedCapabilityKey && contextCapabilityKey !== requestedCapabilityKey) {
      blockers.push({
        code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_UNSUPPORTED,
        message: 'The requested deliverable does not match the available governed result.',
        details: {
          requestedOutputTypeKey: requestedCapabilityKey,
        },
      })
    }
    return {
      key: normalizeToken(contextCapabilityKey.replace(/-/g, '_')),
      capabilityKey: contextCapabilityKey,
      label: normalizeText(contextOutputType.label),
      source: 'KNOWLEDGE_RESOLUTION',
    }
  }

  const draftOutputType = getDraftOutputType(activeDraft)
  if (intent?.requiresActiveDraft && draftOutputType.key) return draftOutputType

  const sessionOutputType = getSessionOutputType(session)
  if (sessionOutputType.key) return sessionOutputType

  if (draftOutputType.key) return draftOutputType

  blockers.push({
    code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_UNRESOLVED,
    message: 'Outcome Studio could not resolve a deliverable from the current request or session.',
    details: {},
  })
  return {
    key: '',
    capabilityKey: requestedCapabilityKey,
    label: '',
    source: '',
  }
}

const resolveOutputSchema = ({ resolvedKnowledgeContext = {}, blockers } = {}) => {
  const context = resolvedKnowledgeContext || {}
  const schema = context.outputSchema || {}
  const schemaKey = normalizeCapabilityKey(schema.key)
  if (!schemaKey) {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_SCHEMA_UNRESOLVED,
      message: 'Outcome Studio could not resolve the required structure for this deliverable.',
      details: {},
    })
    return {
      schemaKey: '',
      schemaVersion: '',
      source: '',
      requiredSections: [],
    }
  }

  return {
    schemaKey,
    schemaVersion: normalizeText(schema.version),
    label: normalizeText(schema.label),
    source: 'KNOWLEDGE_RESOLUTION',
    requiredSections: [],
    supportedFormats: Array.isArray(context.renderer?.formats)
      ? context.renderer.formats.map((format) => normalizeToken(format.format)).filter(Boolean)
      : [],
  }
}

const resolveStyle = ({ resolvedKnowledgeContext = {}, blockers } = {}) => {
  const style = (resolvedKnowledgeContext || {}).style || {}
  const styleKey = normalizeCapabilityKey(style.key)
  if (!styleKey) {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.STYLE_UNRESOLVED,
      message: 'Outcome Studio could not resolve the required presentation guidance.',
      details: {},
    })
    return {
      styleKey: '',
      label: '',
      audience: '',
      tone: '',
      source: '',
    }
  }

  return {
    styleKey,
    label: normalizeText(style.label),
    styleVersion: normalizeText(style.version),
    audience: '',
    tone: '',
    source: 'KNOWLEDGE_RESOLUTION',
  }
}

const getDraftReference = (activeDraft = {}) => {
  const draftId = normalizeText(activeDraft?.draftId)
  const currentIterationId = normalizeText(activeDraft?.currentIterationId)
  return {
    draftId,
    currentIterationId,
    currentIterationNumber: Number(activeDraft?.currentIterationNumber || 0),
    status: normalizeToken(activeDraft?.status),
  }
}

const buildBlockedResolution = ({
  blockers,
  draft,
  intent,
  outputSchema,
  outputType,
  prompt,
  style,
} = {}) => ({
  status: OUTCOME_STUDIO_REQUEST_RESOLUTION_STATUSES.BLOCKED,
  canProceed: false,
  prompt: {
    present: Boolean(prompt),
    length: prompt.length,
  },
  intent,
  outputType,
  outputSchema,
  style,
  draft,
  blockers,
})

export const resolveOutcomeStudioRequestContext = ({
  activeDraft = null,
  prompt = '',
  requestedOutputTypeKey = '',
  resolvedKnowledgeContext = null,
  session = {},
} = {}) => {
  const normalizedPrompt = normalizeText(prompt).replace(/\s+/g, ' ')
  const blockers = []
  const draft = getDraftReference(activeDraft)
  const hasActiveDraft = Boolean(draft.draftId && normalizeToken(draft.status || 'ACTIVE') !== 'DISCARDED')
  const intent = classifyIntent({
    prompt: normalizedPrompt,
    hasActiveDraft,
  })

  if (!normalizedPrompt) {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.PROMPT_MISSING,
      message: 'Outcome Studio request resolution requires a non-empty prompt.',
      details: {},
    })
  }

  if (detectUnsafeRequest(normalizedPrompt)) {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.UNSAFE_INTERNAL_REQUEST,
      message: 'Outcome Studio cannot expose raw source, prompt, evidence, provider, or Knowledge Pack internals.',
      details: {},
    })
  }

  if (
    intent.type === OUTCOME_STUDIO_REQUEST_INTENT_TYPES.APPROVE_FINALISE
    || intent.type === OUTCOME_STUDIO_REQUEST_INTENT_TYPES.PUBLISH_REQUEST
  ) {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.REQUEST_INTENT_NOT_GENERATIVE,
      message: 'This request requires a dedicated approval or publish path, not response generation.',
      details: {
        intentType: intent.type,
      },
    })
  }

  if (intent.requiresActiveDraft && !hasActiveDraft) {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.DRAFT_REQUIRED,
      message: 'This request requires an active Conversation Draft before it can be applied.',
      details: {
        intentType: intent.type,
      },
    })
  }

  const outputType = resolveOutputType({
    activeDraft,
    blockers,
    intent,
    requestedOutputTypeKey,
    resolvedKnowledgeContext,
    session,
  })
  const outputSchema = outputType.key
    ? resolveOutputSchema({ resolvedKnowledgeContext, blockers })
    : {
        schemaKey: '',
        schemaVersion: '',
        source: '',
        requiredSections: [],
      }
  const style = outputType.key
    ? resolveStyle({ resolvedKnowledgeContext, blockers })
    : {
        styleKey: '',
        label: '',
        audience: '',
        tone: '',
        source: '',
      }

  if (blockers.length > 0) {
    return buildBlockedResolution({
      blockers,
      draft,
      intent,
      outputSchema,
      outputType,
      prompt: normalizedPrompt,
      style,
    })
  }

  return {
    status: OUTCOME_STUDIO_REQUEST_RESOLUTION_STATUSES.RESOLVED,
    canProceed: true,
    prompt: {
      present: true,
      length: normalizedPrompt.length,
    },
    intent,
    outputType,
    outputSchema,
    style,
    draft,
    blockers: [],
  }
}

export const buildOutcomeStudioResolutionError = ({
  messageId = '',
  resolution = {},
  sessionId = '',
} = {}) => {
  const err = new Error('Outcome Studio request resolution failed.')
  err.status = 409
  err.code = 'CONFLICT'
  err.details = {
    reason: 'OUTCOME_REQUEST_RESOLUTION_BLOCKED',
    sessionId: normalizeText(sessionId),
    messageId: normalizeText(messageId),
    intentType: resolution?.intent?.type || '',
    blockers: Array.isArray(resolution?.blockers)
      ? resolution.blockers.map((blocker) => ({
          code: blocker.code,
          message: blocker.message,
          details: blocker.details || {},
        }))
      : [],
  }
  return err
}

export const assertOutcomeStudioRequestResolution = ({
  activeDraft = null,
  message = {},
  prompt = '',
  requestedOutputTypeKey = '',
  resolvedKnowledgeContext = null,
  session = {},
} = {}) => {
  const resolution = resolveOutcomeStudioRequestContext({
    activeDraft,
    prompt: prompt || message?.prompt,
    requestedOutputTypeKey: requestedOutputTypeKey || message?.requestedOutputTypeKey,
    resolvedKnowledgeContext,
    session,
  })
  if (!resolution.canProceed) {
    throw buildOutcomeStudioResolutionError({
      messageId: message?.messageId,
      resolution,
      sessionId: session?.sessionId,
    })
  }
  return resolution
}

export const buildResolvedOutcomeStudioExecutionIntent = ({
  prompt = '',
  resolution = {},
} = {}) => {
  const sections = Array.isArray(resolution?.outputSchema?.requiredSections)
    ? resolution.outputSchema.requiredSections.join(', ')
    : ''
  return [
    `Outcome Studio request intent: ${resolution?.intent?.type || 'UNRESOLVED'}.`,
    `Resolved output type: ${resolution?.outputType?.key || 'UNRESOLVED'} (${resolution?.outputType?.label || 'unlabelled'}).`,
    `Resolved output schema: ${resolution?.outputSchema?.schemaKey || 'UNRESOLVED'}${sections ? `; required sections: ${sections}.` : '.'}`,
    `Resolved style: ${resolution?.style?.styleKey || 'UNRESOLVED'} (${resolution?.style?.label || 'unlabelled'}).`,
    resolution?.intent?.refinement
      ? `Draft operation: refinement${resolution?.draft?.draftId ? ` on draft ${resolution.draft.draftId}.` : ' with no active draft.'}`
      : 'Draft operation: initial governed response request.',
    `User request: ${clampText(prompt, 1000)}`,
  ].filter(Boolean).join('\n').slice(0, 2000)
}
