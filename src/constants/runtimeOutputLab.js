export const OUTPUT_LAB_CONTRACT_VERSION = 'output-lab.v1'
export const OUTPUT_LAB_EXPORT_SCHEMA_VERSION = 'output-lab-export.v1'

export const OUTPUT_LAB_OUTPUT_TYPE_KEYS = Object.freeze({
  EXECUTIVE_BRIEF: 'EXECUTIVE_BRIEF',
  SALES_NARRATIVE: 'SALES_NARRATIVE',
  COMMERCIAL_ASSESSMENT: 'COMMERCIAL_ASSESSMENT',
  BOARD_SUMMARY: 'BOARD_SUMMARY',
})

export const OUTPUT_LAB_EXPORT_FORMATS = Object.freeze({
  MARKDOWN: 'MARKDOWN',
  JSON: 'JSON',
})

export const OUTPUT_LAB_READINESS_STATES = Object.freeze({
  READY: 'READY',
  READY_WITH_GAPS: 'READY_WITH_GAPS',
  NOT_READY: 'NOT_READY',
  BLOCKED: 'BLOCKED',
})

export const OUTPUT_LAB_REQUEST_STATUSES = Object.freeze({
  REQUESTED: 'REQUESTED',
  GENERATING: 'GENERATING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
})

export const OUTPUT_LAB_ASSET_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  GENERATED: 'GENERATED',
  PUBLISHED: 'PUBLISHED',
  SUPERSEDED: 'SUPERSEDED',
  STALE: 'STALE',
})

export const OUTPUT_LAB_OUTPUT_DEFINITIONS = Object.freeze([
  Object.freeze({
    outputTypeKey: OUTPUT_LAB_OUTPUT_TYPE_KEYS.EXECUTIVE_BRIEF,
    label: 'Executive Brief',
    description: 'A concise executive outcome summary built from locked VMF truth.',
    requiredSections: ['situation', 'commercial_problem', 'value_drivers', 'recommended_focus'],
    supportedFormats: [OUTPUT_LAB_EXPORT_FORMATS.MARKDOWN, OUTPUT_LAB_EXPORT_FORMATS.JSON],
    requiresLockedRuntime: true,
    requiresPublishedRuntime: true,
  }),
  Object.freeze({
    outputTypeKey: OUTPUT_LAB_OUTPUT_TYPE_KEYS.SALES_NARRATIVE,
    label: 'Sales Narrative',
    description: 'A governed sales-facing value narrative for downstream presentation expansion.',
    requiredSections: ['opening_position', 'customer_pain', 'value_story', 'proof_points', 'conversation_guide'],
    supportedFormats: [OUTPUT_LAB_EXPORT_FORMATS.MARKDOWN, OUTPUT_LAB_EXPORT_FORMATS.JSON],
    requiresLockedRuntime: true,
    requiresPublishedRuntime: true,
  }),
  Object.freeze({
    outputTypeKey: OUTPUT_LAB_OUTPUT_TYPE_KEYS.COMMERCIAL_ASSESSMENT,
    label: 'Commercial Assessment',
    description: 'A structured commercial strengths, gaps, risk, and decision-context assessment.',
    requiredSections: ['strengths', 'gaps', 'risks', 'decision_considerations'],
    supportedFormats: [OUTPUT_LAB_EXPORT_FORMATS.MARKDOWN, OUTPUT_LAB_EXPORT_FORMATS.JSON],
    requiresLockedRuntime: true,
    requiresPublishedRuntime: true,
  }),
  Object.freeze({
    outputTypeKey: OUTPUT_LAB_OUTPUT_TYPE_KEYS.BOARD_SUMMARY,
    label: 'Board Summary',
    description: 'A board-level summary of strategic context, value case, exposure, and decision need.',
    requiredSections: ['strategic_context', 'value_case', 'exposure', 'decision_required'],
    supportedFormats: [OUTPUT_LAB_EXPORT_FORMATS.MARKDOWN, OUTPUT_LAB_EXPORT_FORMATS.JSON],
    requiresLockedRuntime: true,
    requiresPublishedRuntime: true,
  }),
])

export const getOutputLabDefinition = (outputTypeKey) => {
  const normalizedKey = String(outputTypeKey || '').trim().toUpperCase()
  return OUTPUT_LAB_OUTPUT_DEFINITIONS.find((definition) => definition.outputTypeKey === normalizedKey) || null
}
