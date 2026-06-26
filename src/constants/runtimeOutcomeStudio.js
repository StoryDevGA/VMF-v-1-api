import {
  KNOWLEDGE_PACK_CATEGORIES,
} from './workspaceGovernance.js'

export const OUTCOME_STUDIO_CONTRACT_VERSION = 'outcome-studio.v1'

export const OUTCOME_STUDIO_PHASE = 'FOUNDATION_READINESS_ONLY'

export const OUTCOME_STUDIO_SESSION_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
  FAILED: 'FAILED',
})

export const OUTCOME_STUDIO_MESSAGE_ROLES = Object.freeze({
  ASSISTANT: 'ASSISTANT',
  USER: 'USER',
})

export const OUTCOME_STUDIO_MESSAGE_STATUSES = Object.freeze({
  GENERATED: 'GENERATED',
  SUBMITTED: 'SUBMITTED',
})

export const OUTCOME_STUDIO_RESPONSE_STATUSES = Object.freeze({
  PENDING_RESPONSE: 'PENDING_RESPONSE',
  RESPONSE_GENERATED: 'RESPONSE_GENERATED',
})

export const OUTCOME_STUDIO_EXPORT_FORMATS = Object.freeze({
  MARKDOWN: 'MARKDOWN',
  JSON: 'JSON',
  DOCX: 'DOCX',
  PDF: 'PDF',
})

export const OUTCOME_STUDIO_ASSET_STATUSES = Object.freeze({
  GENERATED: 'GENERATED',
  PUBLISHED: 'PUBLISHED',
  SUPERSEDED: 'SUPERSEDED',
  ARCHIVED: 'ARCHIVED',
})

export const OUTCOME_STUDIO_ASSET_VERSION_STATUSES = Object.freeze({
  CURRENT: 'CURRENT',
  SUPERSEDED: 'SUPERSEDED',
  ARCHIVED: 'ARCHIVED',
  FAILED: 'FAILED',
})

export const OUTCOME_STUDIO_SAFETY_GATE_STATUSES = Object.freeze({
  PASSED: 'PASSED',
  BLOCKED: 'BLOCKED',
})

export const OUTCOME_STUDIO_SAFETY_GATE_CODES = Object.freeze({
  SOURCE_OUTPUT_BOUND: 'SOURCE_OUTPUT_BOUND',
  TRUTH_SIGNATURE_BOUND: 'TRUTH_SIGNATURE_BOUND',
  KNOWLEDGE_PACKS_BOUND: 'KNOWLEDGE_PACKS_BOUND',
  PROMPT_PERSISTENCE_READY: 'PROMPT_PERSISTENCE_READY',
  RESPONSE_GENERATION_ENGINE: 'RESPONSE_GENERATION_ENGINE',
  ASSET_PUBLISH: 'ASSET_PUBLISH',
  EXPORT_RENDERER: 'EXPORT_RENDERER',
  TRUTH_UPDATE_WORKFLOW: 'TRUTH_UPDATE_WORKFLOW',
})

export const OUTCOME_STUDIO_READINESS_STATES = Object.freeze({
  READY: 'READY',
  READY_WITH_GAPS: 'READY_WITH_GAPS',
  BLOCKED: 'BLOCKED',
})

export const OUTCOME_STUDIO_BINDING_STATUSES = Object.freeze({
  PROJECTED: 'PROJECTED',
  BLOCKED: 'BLOCKED',
})

export const OUTCOME_STUDIO_BLOCKER_CODES = Object.freeze({
  SOURCE_OUTPUT_MISSING: 'SOURCE_OUTPUT_MISSING',
  KNOWLEDGE_PACK_BINDING_MISSING: 'KNOWLEDGE_PACK_BINDING_MISSING',
  ARL_PACK_MISSING: 'ARL_PACK_MISSING',
  RL_PACK_MISSING: 'RL_PACK_MISSING',
  OUTPUT_SCHEMA_PACK_MISSING: 'OUTPUT_SCHEMA_PACK_MISSING',
  TRUTH_CERTIFICATION_PACK_MISSING: 'TRUTH_CERTIFICATION_PACK_MISSING',
  OUTPUT_TYPE_PACK_MISSING: 'OUTPUT_TYPE_PACK_MISSING',
})

export const OUTCOME_STUDIO_REQUIRED_PACKS = Object.freeze([
  Object.freeze({
    packCategory: KNOWLEDGE_PACK_CATEGORIES.OUTCOME,
    packType: 'ARL',
    packKey: 'adaptive-reasoning-layer',
    label: 'Adaptive Reasoning Layer',
    sourceStatus: 'SOURCE_ONLY',
    sourceFilename: 'adaptive-reasoning-layer-v1.yaml',
  }),
  Object.freeze({
    packCategory: KNOWLEDGE_PACK_CATEGORIES.OUTCOME,
    packType: 'RL',
    packKey: 'rendering-layer',
    label: 'Rendering Layer',
    sourceStatus: 'SOURCE_ONLY',
    sourceFilename: 'rendering-layer-v1.yaml',
  }),
  Object.freeze({
    packCategory: KNOWLEDGE_PACK_CATEGORIES.OUTCOME,
    packType: 'OUTPUT_SCHEMA',
    packKey: 'output-schemas-pack',
    label: 'Output Schemas',
    sourceStatus: 'SOURCE_ONLY',
    sourceFilename: 'output-schemas-pack-v1.yaml',
  }),
  Object.freeze({
    packCategory: KNOWLEDGE_PACK_CATEGORIES.PLATFORM,
    packType: 'TRUTH_CERTIFICATION',
    packKey: 'truth-certification-pack',
    label: 'Truth Certification',
    sourceStatus: 'SOURCE_ONLY',
    sourceFilename: 'truth-certification-pack-v1.yaml',
  }),
  Object.freeze({
    packCategory: KNOWLEDGE_PACK_CATEGORIES.OUTCOME,
    packType: 'OUTPUT_TYPE_DEFINITION',
    packKey: 'outcome-output-types',
    label: 'Outcome Output Types',
    sourceStatus: 'SOURCE_ONLY',
    sourceFilename: 'outcome-output-types-v1.yaml',
  }),
])
