import crypto from 'node:crypto'

export const RUNTIME_SECTION_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  GENERATED: 'GENERATED',
  REGENERATED: 'REGENERATED',
  ACCEPTED: 'ACCEPTED',
  REVIEW_PENDING: 'REVIEW_PENDING',
})

const SECTION_MODEL_KEYS = new Set([
  'input',
  'generated',
  'accepted',
  'review',
  'state',
  'lineage',
  'revisions',
  'dependencies',
  'validation',
  'confidence',
  'intelligence',
  'metrics',
])

export const cloneSectionValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const isPlainObject = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

export const isRuntimeSectionObject = (value) =>
  isPlainObject(value) && Object.keys(value).some((key) => SECTION_MODEL_KEYS.has(key))

export const normalizeRuntimeSectionObject = ({
  value,
  sectionKey,
  runtimePath,
  initializedAt = new Date().toISOString(),
} = {}) => {
  if (isRuntimeSectionObject(value)) {
    return {
      input: value.input ?? null,
      generated: value.generated ?? null,
      accepted: value.accepted ?? null,
      review: isPlainObject(value.review) ? value.review : {},
      state: {
        status: RUNTIME_SECTION_STATES.DRAFT,
        ...(isPlainObject(value.state) ? value.state : {}),
      },
      lineage: {
        sectionKey,
        runtimePath,
        ...(isPlainObject(value.lineage) ? value.lineage : {}),
      },
      revisions: Array.isArray(value.revisions) ? value.revisions : [],
      dependencies: isPlainObject(value.dependencies) ? value.dependencies : {},
      validation: isPlainObject(value.validation) ? value.validation : {},
      confidence: isPlainObject(value.confidence) ? value.confidence : {},
      intelligence: isPlainObject(value.intelligence) ? value.intelligence : {},
      metrics: isPlainObject(value.metrics) ? value.metrics : {},
    }
  }

  return {
    input: value ?? null,
    generated: null,
    accepted: null,
    review: {},
    state: {
      status: RUNTIME_SECTION_STATES.DRAFT,
      initializedAt,
    },
    lineage: {
      sectionKey,
      runtimePath,
    },
    revisions: [],
    dependencies: {},
    validation: {},
    confidence: {},
    intelligence: {},
    metrics: {},
  }
}

export const getRuntimeSectionInput = (value) =>
  isRuntimeSectionObject(value) ? value.input : value

export const getRuntimeSectionGenerated = (value) =>
  isRuntimeSectionObject(value) ? value.generated ?? null : null

export const getRuntimeSectionAccepted = (value) =>
  isRuntimeSectionObject(value) ? value.accepted ?? null : null

export const getRuntimeSectionRevisions = (value) =>
  isRuntimeSectionObject(value) && Array.isArray(value.revisions) ? value.revisions : []

export const getRuntimeSectionState = (value) =>
  isRuntimeSectionObject(value) && isPlainObject(value.state) ? value.state : {}

export const getRuntimeSectionDependencies = (value) =>
  isRuntimeSectionObject(value) && isPlainObject(value.dependencies) ? value.dependencies : {}

const stableStringify = (value) => {
  if (value === null || value === undefined) return ''
  if (!isPlainObject(value) && !Array.isArray(value)) return String(value)
  const normalize = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (!isPlainObject(candidate)) return candidate
    return Object.keys(candidate)
      .sort()
      .reduce((acc, key) => ({
        ...acc,
        [key]: normalize(candidate[key]),
      }), {})
  }
  return JSON.stringify(normalize(value))
}

export const hashSectionInput = (input) =>
  crypto.createHash('sha256').update(stableStringify(input)).digest('hex')

const summarizeInput = (input) => {
  if (input === null || input === undefined || input === '') return 'No customer input supplied.'
  if (typeof input === 'string') return input.trim()
  if (isPlainObject(input) && typeof input.summary === 'string') return input.summary.trim()
  return JSON.stringify(input)
}

export const buildDeterministicGeneratedSection = ({
  actionKey,
  actorUserId,
  frameworkPackage,
  input,
  runtimeInstance,
  section,
  generatedAt = new Date().toISOString(),
} = {}) => {
  const sectionKey = String(section?.sectionKey || '').trim()
  const label = String(section?.label || section?.sectionKey || sectionKey || 'section')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
  const inputSummary = summarizeInput(input)
  const inputHash = hashSectionInput(input)

  return {
    format: 'TEXT',
    content: `${label}: ${inputSummary}`,
    summary: `Generated ${label} from current runtime input.`,
    generatedAt,
    generatedBy: actorUserId ? String(actorUserId) : '',
    actionKey,
    inputHash,
    generator: {
      mode: 'DETERMINISTIC_TEMPLATE',
      adapter: 'runtime-section-template-v1',
      packageKey: runtimeInstance?.packageKey || frameworkPackage?.packageKey || '',
      packageVersion: runtimeInstance?.packageVersion || frameworkPackage?.version || '',
    },
  }
}

export const buildRuntimeSectionRevision = ({
  generated,
  revisionNumber,
  replacedAt = new Date().toISOString(),
} = {}) => ({
  revisionNumber,
  generated: cloneSectionValue(generated),
  replacedAt,
})

export const invalidateRuntimeSectionEvidence = ({
  frameworkState,
  invalidatedAt = new Date().toISOString(),
  runtimePath,
} = {}) => {
  if (!String(runtimePath || '').startsWith('framework_state.sections.')) return frameworkState

  frameworkState.validation = {}
  frameworkState.readiness = {
    ...(frameworkState.readiness || {}),
    state: 'DRAFT',
    ready: false,
    submittedForReview: false,
    validationState: 'UNKNOWN',
    invalidatedByRuntimePath: runtimePath,
    invalidatedAt,
  }

  return frameworkState
}
