import {
  getOutputLabDefinition,
  OUTPUT_LAB_EXPORT_SCHEMA_VERSION,
  OUTPUT_LAB_OUTPUT_TYPE_KEYS,
} from '../constants/runtimeOutputLab.js'
import {
  OUTCOME_STUDIO_REQUEST_INTENT_TYPES,
  OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES,
  OUTCOME_STUDIO_REQUEST_RESOLUTION_STATUSES,
} from '../constants/runtimeOutcomeStudio.js'

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeKey = (value) => normalizeText(value).toLowerCase()

const toKebabCase = (value) =>
  normalizeKey(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const unique = (values = []) =>
  [...new Set(values.map(normalizeToken).filter(Boolean))]

const hasPattern = (text, patterns = []) =>
  patterns.some((pattern) => pattern.test(text))

const clampText = (value, maxLength = 120) => {
  const text = normalizeText(value).replace(/\s+/g, ' ')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trim()}...`
}

const OUTPUT_TYPE_HINTS = Object.freeze([
  Object.freeze({
    key: OUTPUT_LAB_OUTPUT_TYPE_KEYS.BOARD_SUMMARY,
    label: 'Board Summary',
    patterns: Object.freeze([
      /\bexecutive\s+board\s+review\b/i,
      /\bboard\s+(review|summary|presentation|pack|paper)\b/i,
    ]),
  }),
  Object.freeze({
    key: OUTPUT_LAB_OUTPUT_TYPE_KEYS.EXECUTIVE_BRIEF,
    label: 'Executive Brief',
    patterns: Object.freeze([
      /\bexecutive\s+(brief|summary|overview)\b/i,
      /\bexec\s+brief\b/i,
    ]),
  }),
  Object.freeze({
    key: OUTPUT_LAB_OUTPUT_TYPE_KEYS.COMMERCIAL_ASSESSMENT,
    label: 'Commercial Assessment',
    patterns: Object.freeze([
      /\bcommercial\s+(assessment|review|analysis)\b/i,
      /\bstrategic\s+risk\s+assessment\b/i,
    ]),
  }),
  Object.freeze({
    key: OUTPUT_LAB_OUTPUT_TYPE_KEYS.SALES_NARRATIVE,
    label: 'Sales Narrative',
    patterns: Object.freeze([
      /\bsales\s+narrative\b/i,
      /\bcustomer\s+value\s+narrative\b/i,
      /\bvalue\s+narrative\b/i,
    ]),
  }),
])

const UNSUPPORTED_OUTPUT_HINTS = Object.freeze([
  Object.freeze({ code: 'ACTION_PLAN', pattern: /\baction\s+plan\b/i }),
  Object.freeze({ code: 'PITCH_DECK', pattern: /\bpitch\s+deck\b/i }),
  Object.freeze({ code: 'CONTRACT', pattern: /\bcontract\b/i }),
  Object.freeze({ code: 'EMAIL', pattern: /\bemail\b/i }),
  Object.freeze({ code: 'CUSTOMER_PROPOSAL', pattern: /\bcustomer\s+proposal\b/i }),
])

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

const DEFAULT_STYLES_BY_OUTPUT_TYPE = Object.freeze({
  [OUTPUT_LAB_OUTPUT_TYPE_KEYS.EXECUTIVE_BRIEF]: Object.freeze({
    styleKey: 'executive-brief-style',
    label: 'Executive Brief Style',
    audience: 'Executive',
    tone: 'Concise, commercial, evidence-led',
  }),
  [OUTPUT_LAB_OUTPUT_TYPE_KEYS.BOARD_SUMMARY]: Object.freeze({
    styleKey: 'board-executive-style',
    label: 'Board Executive Style',
    audience: 'Board',
    tone: 'Strategic, decision-oriented, risk-aware',
  }),
  [OUTPUT_LAB_OUTPUT_TYPE_KEYS.SALES_NARRATIVE]: Object.freeze({
    styleKey: 'customer-value-narrative-style',
    label: 'Customer Value Narrative Style',
    audience: 'Customer-facing commercial team',
    tone: 'Outcome-led, persuasive, grounded',
  }),
  [OUTPUT_LAB_OUTPUT_TYPE_KEYS.COMMERCIAL_ASSESSMENT]: Object.freeze({
    styleKey: 'commercial-assessment-style',
    label: 'Commercial Assessment Style',
    audience: 'Commercial leadership',
    tone: 'Analytical, balanced, evidence-led',
  }),
})

const getSourceOutput = (session = {}) =>
  session.sourceOutput
  || session.sourceOutputSnapshot
  || {}

const getSessionOutputType = (session = {}) => {
  const sourceOutput = getSourceOutput(session)
  const key = normalizeToken(
    session.sourceOutputTypeKey
    || sourceOutput.outputTypeKey,
  )
  const definition = getOutputLabDefinition(key)
  return {
    key,
    label: normalizeText(
      session.sourceOutputTypeLabel
      || sourceOutput.outputTypeLabel
      || definition?.label,
    ),
    source: key ? 'SESSION_SOURCE_OUTPUT' : '',
  }
}

const getDraftOutputType = (activeDraft = {}) => {
  const key = normalizeToken(activeDraft?.outputTypeKey)
  const definition = getOutputLabDefinition(key)
  return {
    key,
    label: normalizeText(activeDraft?.outputTypeLabel || definition?.label),
    source: key ? 'ACTIVE_DRAFT' : '',
  }
}

const detectExplicitOutputTypeHints = (prompt) => {
  const matches = OUTPUT_TYPE_HINTS
    .filter((entry) => hasPattern(prompt, entry.patterns))
    .map((entry) => entry.key)
  return unique(matches)
}

const detectUnsupportedOutputHints = (prompt) =>
  UNSUPPORTED_OUTPUT_HINTS
    .filter((entry) => entry.pattern.test(prompt))
    .map((entry) => entry.code)

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
  explicitOutputTypeHints,
  intent,
  prompt,
  session,
} = {}) => {
  if (explicitOutputTypeHints.length > 1) {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_AMBIGUOUS,
      message: 'Multiple output types were requested in one Outcome Studio prompt.',
      details: {
        outputTypeKeys: explicitOutputTypeHints,
      },
    })
    return {
      key: '',
      label: '',
      source: 'PROMPT_HINT',
    }
  }

  const unsupportedOutputHints = detectUnsupportedOutputHints(prompt)
  if (unsupportedOutputHints.length > 0 && explicitOutputTypeHints.length === 0) {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_UNSUPPORTED,
      message: 'The requested output type is not supported by the current Outcome Studio resolver.',
      details: {
        requestedOutputKinds: unsupportedOutputHints,
      },
    })
    return {
      key: '',
      label: '',
      source: 'UNSUPPORTED_PROMPT_HINT',
    }
  }

  if (explicitOutputTypeHints.length === 1) {
    const key = explicitOutputTypeHints[0]
    const definition = getOutputLabDefinition(key)
    return {
      key,
      label: definition?.label || key,
      source: 'PROMPT_HINT',
    }
  }

  const draftOutputType = getDraftOutputType(activeDraft)
  if (intent?.requiresActiveDraft && draftOutputType.key) return draftOutputType

  const sessionOutputType = getSessionOutputType(session)
  if (sessionOutputType.key) return sessionOutputType

  if (draftOutputType.key) return draftOutputType

  blockers.push({
    code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_UNRESOLVED,
    message: 'Outcome Studio could not resolve an output type from the prompt or current session.',
    details: {},
  })
  return {
    key: '',
    label: '',
    source: '',
  }
}

const resolveOutputSchema = ({ outputType = {}, blockers } = {}) => {
  const definition = getOutputLabDefinition(outputType.key)
  if (!definition) {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_SCHEMA_UNRESOLVED,
      message: 'Outcome Studio could not resolve an output schema for the requested output type.',
      details: {
        outputTypeKey: outputType.key || '',
      },
    })
    return {
      schemaKey: '',
      schemaVersion: '',
      source: '',
      requiredSections: [],
    }
  }

  return {
    schemaKey: `${toKebabCase(definition.outputTypeKey)}-schema`,
    schemaVersion: OUTPUT_LAB_EXPORT_SCHEMA_VERSION,
    source: 'OUTPUT_LAB_DEFINITION',
    requiredSections: [...definition.requiredSections],
    supportedFormats: [...definition.supportedFormats],
  }
}

const resolveDefaultStyle = ({ outputType = {}, blockers } = {}) => {
  const style = DEFAULT_STYLES_BY_OUTPUT_TYPE[outputType.key]
  if (!style) {
    blockers.push({
      code: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.STYLE_UNRESOLVED,
      message: 'Outcome Studio could not resolve a default style for the requested output type.',
      details: {
        outputTypeKey: outputType.key || '',
      },
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
    ...style,
    source: 'OUTPUT_TYPE_DEFAULT',
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

  const explicitOutputTypeHints = detectExplicitOutputTypeHints(normalizedPrompt)
  const outputType = resolveOutputType({
    activeDraft,
    blockers,
    explicitOutputTypeHints,
    intent,
    prompt: normalizedPrompt,
    session,
  })
  const outputSchema = outputType.key
    ? resolveOutputSchema({ outputType, blockers })
    : {
        schemaKey: '',
        schemaVersion: '',
        source: '',
        requiredSections: [],
      }
  const style = outputType.key
    ? resolveDefaultStyle({ outputType, blockers })
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
  session = {},
} = {}) => {
  const resolution = resolveOutcomeStudioRequestContext({
    activeDraft,
    prompt: prompt || message?.prompt,
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
