import { randomUUID, createHash } from 'node:crypto'
import mongoose from 'mongoose'
import {
  FrameworkPackage,
  RuntimeInstance,
  RuntimeOutputAsset,
  RuntimeOutputRequest,
} from '../models/index.js'
import { RUNTIME_TYPES } from '../models/RuntimeInstance.js'
import {
  OUTPUT_LAB_ASSET_STATUSES,
  OUTPUT_LAB_CONTRACT_VERSION,
  OUTPUT_LAB_EXPORT_FORMATS,
  OUTPUT_LAB_EXPORT_SCHEMA_VERSION,
  OUTPUT_LAB_OUTPUT_DEFINITIONS,
  OUTPUT_LAB_READINESS_STATES,
  OUTPUT_LAB_REQUEST_STATUSES,
  getOutputLabDefinition,
} from '../constants/runtimeOutputLab.js'
import {
  assertCustomerTenantContext,
  assertFeatureEntitlement,
  assertRuntimePermission,
  getFeatureForRuntimeType,
  toIdString,
} from './runtimeInstanceService.js'
import {
  buildRuntimeIntelligenceGraphProjection,
  buildRuntimeIntelligenceGraphQueryProjection,
} from './runtimeIntelligenceGraphService.js'
import auditService from './auditService.js'

export const OUTPUT_LAB_ERROR_REASONS = Object.freeze({
  OUTPUT_TYPE_NOT_SUPPORTED: 'OUTPUT_TYPE_NOT_SUPPORTED',
  OUTPUT_RUNTIME_NOT_READY: 'OUTPUT_RUNTIME_NOT_READY',
  OUTPUT_RUNTIME_NOT_FOUND: 'OUTPUT_RUNTIME_NOT_FOUND',
  OUTPUT_REQUEST_NOT_FOUND: 'OUTPUT_REQUEST_NOT_FOUND',
  OUTPUT_REQUEST_DUPLICATE: 'OUTPUT_REQUEST_DUPLICATE',
  OUTPUT_REQUEST_ALREADY_GENERATED: 'OUTPUT_REQUEST_ALREADY_GENERATED',
  OUTPUT_ASSET_NOT_FOUND: 'OUTPUT_ASSET_NOT_FOUND',
  OUTPUT_ASSET_STALE: 'OUTPUT_ASSET_STALE',
  OUTPUT_EXPORT_FORMAT_UNSUPPORTED: 'OUTPUT_EXPORT_FORMAT_UNSUPPORTED',
  OUTPUT_AUDIT_PERSISTENCE_FAILED: 'OUTPUT_AUDIT_PERSISTENCE_FAILED',
})

const OUTPUT_LAB_ASSET_LIST_LIMIT = 20
const OUTPUT_LAB_REQUEST_LIST_LIMIT = 20

const normalizeToken = (value) => String(value || '').trim().toUpperCase()
const normalizeKey = (value) => String(value || '').trim().toLowerCase()
const normalizeText = (value) => String(value ?? '').trim()
const normalizeDateValue = (value) => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

const cloneValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const toPlainObject = (value) => {
  if (!value) return null
  if (typeof value.toJSON === 'function') return value.toJSON()
  if (typeof value.toObject === 'function') return value.toObject()
  return { ...value }
}

const createOutputLabError = ({
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

const buildOutputLabId = (prefix) => `${prefix}_${randomUUID()}`

const hashSafeValue = (value) =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`

const getRuntimeLookup = (runtimeInstanceId) => ({
  $or: [
    ...(mongoose.isValidObjectId(runtimeInstanceId) ? [{ _id: runtimeInstanceId }] : []),
    { runtimeInstanceKey: String(runtimeInstanceId || '').trim().toLowerCase() },
  ],
})

const resolveRuntimeInstance = async ({
  runtimeInstanceId,
  scopes,
  permission = 'VMF_VIEW',
  asDocument = false,
} = {}) => {
  const query = RuntimeInstance.findOne(getRuntimeLookup(runtimeInstanceId))
  const runtimeInstance = asDocument ? await query : await query.lean()

  if (!runtimeInstance) {
    throw createOutputLabError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Runtime instance not found.',
      reason: OUTPUT_LAB_ERROR_REASONS.OUTPUT_RUNTIME_NOT_FOUND,
      details: { runtimeInstanceId },
    })
  }

  const customerId = toIdString(runtimeInstance.customerId)
  const tenantId = toIdString(runtimeInstance.tenantId)

  await assertRuntimePermission({
    scopes,
    customerId,
    tenantId,
    permission,
  })

  const { customer } = await assertCustomerTenantContext({ customerId, tenantId })
  await assertFeatureEntitlement({
    customerId,
    customer,
    feature: getFeatureForRuntimeType(runtimeInstance.runtimeType),
  })

  return runtimeInstance
}

const resolveFrameworkPackage = async (runtimeInstance) => {
  const packageId = runtimeInstance?.packageId || runtimeInstance?.frameworkPackageId
  if (!packageId) return null
  const query = FrameworkPackage.findById(packageId)
  return typeof query?.lean === 'function' ? query.lean() : query
}

const getFrameworkState = (runtimeInstance = {}) => runtimeInstance.framework_state || {}

const getCanonicalOutputEligibility = (frameworkState = {}) => {
  const lock = frameworkState.lock || {}
  const outputEligibility = lock.outputEligibility || {}
  const replayAnchor = lock.replayAnchor || lock.anchor || {}
  const publish = frameworkState.publish || {}

  return {
    locked: Boolean(lock.locked === true || normalizeToken(lock.state) === 'LOCKED'),
    published: Boolean(publish.published === true || normalizeToken(publish.state) === 'PUBLISHED'),
    outputEligible: outputEligibility.outputEligible === true,
    canonicalOutputEligible: outputEligibility.canonicalOutputEligible === true,
    anchorEligible: outputEligibility.anchorEligible === true,
    intelligenceEligible: outputEligibility.intelligenceEligible === true,
    publishSnapshotId: publish.snapshot?.snapshotId || lock.publish?.snapshotId || '',
    publishSnapshotHash: publish.snapshot?.snapshotHash || lock.publish?.snapshotHash || '',
    lockSnapshotId: lock.snapshot?.snapshotId || '',
    lockSnapshotHash: lock.snapshot?.snapshotHash || '',
    replayAnchorId: replayAnchor.replayAnchorId || replayAnchor.anchorId || '',
    replayAnchorHash: replayAnchor.replayAnchorHash || replayAnchor.anchorHash || '',
  }
}

const getAcceptedContent = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return normalizeText(value)
  if (typeof value.content === 'string') return normalizeText(value.content)
  if (typeof value.summary === 'string') return normalizeText(value.summary)
  if (typeof value.value === 'string') return normalizeText(value.value)
  return ''
}

const getSectionLabel = (section = {}, fallback = '') =>
  normalizeText(section.label)
  || normalizeText(section.title)
  || normalizeText(section.name)
  || normalizeText(section.sectionLabel)
  || normalizeText(section.sectionKey)
  || fallback

const getAcceptedTruthRecords = ({ frameworkPackage, frameworkState }) => {
  const packageSections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  const runtimeSections = frameworkState.sections || {}
  return packageSections.map((packageSection, index) => {
    const sectionKey = normalizeKey(packageSection?.sectionKey || packageSection?.key)
    const runtimePath = normalizeText(packageSection?.runtimePath)
    const runtimeSection = runtimeSections[sectionKey] || {}
    const accepted = runtimeSection.accepted || {}
    const content = getAcceptedContent(accepted)
    return {
      sectionKey,
      runtimePath,
      label: getSectionLabel(packageSection, `Section ${index + 1}`),
      required: packageSection?.required === true,
      content,
      acceptedAt: accepted.acceptedAt || null,
      acceptedBy: toIdString(accepted.acceptedBy),
      truthHash: accepted.truthHash || (content ? hashSafeValue({ sectionKey, content }) : ''),
    }
  }).filter((record) => record.sectionKey || record.runtimePath || record.content)
}

const clampText = (value, maxLength = 1200) => {
  const text = normalizeText(value).replace(/\s+/g, ' ')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trim()}...`
}

const summarizeTruthRecord = (record) => ({
  sectionKey: record.sectionKey,
  label: record.label,
  summary: clampText(record.content, 700),
  acceptedAt: record.acceptedAt || null,
  truthHash: record.truthHash || '',
})

const getGraphReadiness = (frameworkState = {}) => {
  const graph = frameworkState.intelligence_graph || {}
  const projection = buildRuntimeIntelligenceGraphProjection(graph)
  const readinessQuery = buildRuntimeIntelligenceGraphQueryProjection(projection, 'readiness')
  return {
    available: readinessQuery.available === true,
    graphVersion: readinessQuery.graphVersion || projection.graphVersion || '',
    graphHash: readinessQuery.graphHash || projection.graphHash || '',
    state: readinessQuery.readiness?.state || readinessQuery.health?.state || projection.health?.state || '',
    error: readinessQuery.error || null,
    missingDomains: Array.isArray(readinessQuery.coverage?.missingDomains)
      ? readinessQuery.coverage.missingDomains
      : Array.isArray(projection.coverage?.missingDomains)
        ? projection.coverage.missingDomains
        : [],
  }
}

const buildReadiness = ({ frameworkPackage, runtimeInstance }) => {
  const frameworkState = getFrameworkState(runtimeInstance)
  const canonicalEligibility = getCanonicalOutputEligibility(frameworkState)
  const graph = getGraphReadiness(frameworkState)
  const acceptedTruth = getAcceptedTruthRecords({ frameworkPackage, frameworkState })
  const acceptedRequiredTruth = acceptedTruth.filter((record) => record.required && record.content)
  const requiredTruth = acceptedTruth.filter((record) => record.required)
  const blockers = []
  const warnings = []

  if (normalizeToken(runtimeInstance?.runtimeType) !== RUNTIME_TYPES.VALUE_NARRATIVE) {
    blockers.push({
      code: 'UNSUPPORTED_RUNTIME_TYPE',
      message: 'Output Lab MVP supports VMF Value Narrative runtimes only.',
    })
  }

  if (!canonicalEligibility.published) {
    blockers.push({
      code: 'RUNTIME_NOT_PUBLISHED',
      message: 'Publish evidence is required before Output Lab can generate governed outputs.',
    })
  }

  if (!canonicalEligibility.locked) {
    blockers.push({
      code: 'RUNTIME_NOT_LOCKED',
      message: 'Locked canonical runtime truth is required before Output Lab generation.',
    })
  }

  if (
    !canonicalEligibility.outputEligible
    || !canonicalEligibility.canonicalOutputEligible
    || !canonicalEligibility.anchorEligible
    || !canonicalEligibility.intelligenceEligible
  ) {
    blockers.push({
      code: 'OUTPUT_ELIGIBILITY_MISSING',
      message: 'Canonical output eligibility is missing or incomplete.',
    })
  }

  if (!canonicalEligibility.lockSnapshotId || !canonicalEligibility.lockSnapshotHash) {
    blockers.push({
      code: 'LOCK_SNAPSHOT_MISSING',
      message: 'Lock snapshot proof is required before Output Lab generation.',
    })
  }

  if (!canonicalEligibility.replayAnchorId) {
    blockers.push({
      code: 'REPLAY_ANCHOR_MISSING',
      message: 'Replay anchor proof is required before Output Lab generation.',
    })
  }

  if (!graph.available) {
    blockers.push({
      code: graph.error?.code || 'GRAPH_QUERY_UNAVAILABLE',
      message: graph.error?.message || 'A valid intelligence graph readiness projection is required.',
    })
  }

  if (!frameworkPackage) {
    blockers.push({
      code: 'FRAMEWORK_PACKAGE_MISSING',
      message: 'Framework package metadata is required to compose governed outputs.',
    })
  }

  if (acceptedTruth.filter((record) => record.content).length === 0) {
    blockers.push({
      code: 'ACCEPTED_TRUTH_MISSING',
      message: 'Accepted or canonical section truth is required before Output Lab generation.',
    })
  }

  const missingRequiredTruth = requiredTruth.filter((record) => !record.content)
  if (missingRequiredTruth.length > 0) {
    blockers.push({
      code: 'REQUIRED_TRUTH_MISSING',
      message: 'One or more required runtime sections do not have accepted truth.',
      sectionKeys: missingRequiredTruth.map((record) => record.sectionKey).filter(Boolean),
    })
  }

  if (acceptedRequiredTruth.length > 0 && acceptedRequiredTruth.length < 3) {
    warnings.push({
      code: 'LIMITED_REQUIRED_TRUTH',
      message: 'Output can be composed, but the amount of accepted required truth is limited.',
    })
  }

  if (graph.missingDomains.length > 0) {
    warnings.push({
      code: 'GRAPH_COVERAGE_GAPS',
      message: 'The intelligence graph reports coverage gaps that should remain visible in output limitations.',
      missingDomains: graph.missingDomains.slice(0, 8),
    })
  }

  const state = blockers.length > 0
    ? OUTPUT_LAB_READINESS_STATES.BLOCKED
    : warnings.length > 0
      ? OUTPUT_LAB_READINESS_STATES.READY_WITH_GAPS
      : OUTPUT_LAB_READINESS_STATES.READY

  return {
    state,
    canGenerate: blockers.length === 0,
    summary: blockers.length > 0
      ? blockers[0].message
      : warnings.length > 0
        ? 'Output Lab can generate governed output with visible limitations.'
        : 'Output Lab can generate governed output from locked canonical runtime truth.',
    blockers,
    warnings,
    acceptedTruthCount: acceptedTruth.filter((record) => record.content).length,
    requiredTruthCount: requiredTruth.length,
    acceptedRequiredTruthCount: acceptedRequiredTruth.length,
    outputEligibility: canonicalEligibility,
    graph: {
      available: graph.available,
      graphVersion: graph.graphVersion,
      graphHash: graph.graphHash,
      state: graph.state,
      missingDomains: graph.missingDomains,
    },
  }
}

const assertOutputTypeSupported = (outputTypeKey) => {
  const definition = getOutputLabDefinition(outputTypeKey)
  if (!definition) {
    throw createOutputLabError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Output type is not supported by Output Lab MVP.',
      reason: OUTPUT_LAB_ERROR_REASONS.OUTPUT_TYPE_NOT_SUPPORTED,
      details: { outputTypeKey },
    })
  }
  return definition
}

const assertRuntimeReady = (readiness) => {
  if (readiness.canGenerate) return
  throw createOutputLabError({
    status: 409,
    code: 'CONFLICT',
    message: 'Output Lab generation is blocked because the runtime is not output-ready.',
    reason: OUTPUT_LAB_ERROR_REASONS.OUTPUT_RUNTIME_NOT_READY,
    details: {
      readinessState: readiness.state,
      blockers: readiness.blockers,
    },
  })
}

const getRuntimeScope = (runtimeInstance = {}) => ({
  tenantId: runtimeInstance.tenantId,
  customerId: runtimeInstance.customerId,
  runtimeInstanceId: runtimeInstance._id || runtimeInstance.id,
  runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
  frameworkKey: runtimeInstance.frameworkKey || '',
  packageKey: runtimeInstance.packageKey || '',
  packageVersion: runtimeInstance.packageVersion || '',
  projectId: runtimeInstance.projectId || null,
  outcomeId: runtimeInstance.outcomeId || null,
})

const buildSourceSnapshot = ({ runtimeInstance, readiness }) => ({
  runtimeInstanceId: toIdString(runtimeInstance?._id || runtimeInstance?.id),
  runtimeInstanceKey: runtimeInstance?.runtimeInstanceKey || '',
  runtimeUpdatedAt: normalizeDateValue(runtimeInstance?.updatedAt),
  publishSnapshotId: readiness.outputEligibility.publishSnapshotId || '',
  publishSnapshotHash: readiness.outputEligibility.publishSnapshotHash || '',
  lockSnapshotId: readiness.outputEligibility.lockSnapshotId || '',
  lockSnapshotHash: readiness.outputEligibility.lockSnapshotHash || '',
  replayAnchorId: readiness.outputEligibility.replayAnchorId || '',
  replayAnchorHash: readiness.outputEligibility.replayAnchorHash || '',
  graphVersion: readiness.graph.graphVersion || '',
  graphHash: readiness.graph.graphHash || '',
})

const sectionMatchesAny = (record, tokens = []) => {
  const haystack = [
    record.sectionKey,
    record.label,
  ].map(normalizeKey).join(' ')
  return tokens.some((token) => haystack.includes(normalizeKey(token)))
}

const pickTruthRecord = ({ acceptedTruth, usedSectionKeys, tokens }) => {
  const directMatch = acceptedTruth.find((record) =>
    record.content
    && !usedSectionKeys.has(record.sectionKey)
    && sectionMatchesAny(record, tokens))
  if (directMatch) {
    usedSectionKeys.add(directMatch.sectionKey)
    return { record: directMatch, direct: true }
  }

  const fallback = acceptedTruth.find((record) => record.content && !usedSectionKeys.has(record.sectionKey))
    || acceptedTruth.find((record) => record.content)
    || null
  if (fallback) usedSectionKeys.add(fallback.sectionKey)
  return { record: fallback, direct: false }
}

const OUTPUT_COMPOSITION_TEMPLATES = Object.freeze({
  EXECUTIVE_BRIEF: Object.freeze([
    Object.freeze({ heading: 'Situation', tokens: ['situation', 'context', 'company', 'customer', 'market'] }),
    Object.freeze({ heading: 'Commercial Problem', tokens: ['problem', 'pain', 'challenge', 'consequence'] }),
    Object.freeze({ heading: 'Value Drivers', tokens: ['value', 'driver', 'benefit', 'outcome'] }),
    Object.freeze({ heading: 'Recommended Focus', tokens: ['recommend', 'focus', 'priority', 'next'] }),
  ]),
  SALES_NARRATIVE: Object.freeze([
    Object.freeze({ heading: 'Opening Position', tokens: ['position', 'context', 'situation', 'customer'] }),
    Object.freeze({ heading: 'Customer Pain', tokens: ['problem', 'pain', 'challenge'] }),
    Object.freeze({ heading: 'Value Story', tokens: ['value', 'driver', 'outcome', 'benefit'] }),
    Object.freeze({ heading: 'Proof Points', tokens: ['proof', 'evidence', 'metric', 'validation'] }),
    Object.freeze({ heading: 'Conversation Guide', tokens: ['conversation', 'recommend', 'focus', 'next'] }),
  ]),
  COMMERCIAL_ASSESSMENT: Object.freeze([
    Object.freeze({ heading: 'Strengths', tokens: ['strength', 'advantage', 'value', 'differentiation'] }),
    Object.freeze({ heading: 'Gaps', tokens: ['gap', 'missing', 'weak', 'risk'] }),
    Object.freeze({ heading: 'Risks', tokens: ['risk', 'concern', 'constraint', 'blocker'] }),
    Object.freeze({ heading: 'Decision Considerations', tokens: ['decision', 'commercial', 'recommend', 'priority'] }),
  ]),
  BOARD_SUMMARY: Object.freeze([
    Object.freeze({ heading: 'Strategic Context', tokens: ['strategic', 'context', 'market', 'situation'] }),
    Object.freeze({ heading: 'Value Case', tokens: ['value', 'case', 'benefit', 'outcome'] }),
    Object.freeze({ heading: 'Exposure', tokens: ['risk', 'gap', 'exposure', 'constraint'] }),
    Object.freeze({ heading: 'Decision Required', tokens: ['decision', 'recommend', 'focus', 'next'] }),
  ]),
})

const composeGovernedOutput = ({ acceptedTruth, definition }) => {
  const usedSectionKeys = new Set()
  const limitations = []
  const template = OUTPUT_COMPOSITION_TEMPLATES[definition.outputTypeKey] || OUTPUT_COMPOSITION_TEMPLATES.EXECUTIVE_BRIEF
  const sections = template.map((templateSection) => {
    const { record, direct } = pickTruthRecord({
      acceptedTruth,
      usedSectionKeys,
      tokens: templateSection.tokens,
    })

    if (!record) {
      limitations.push(`No accepted truth was available for ${templateSection.heading}.`)
      return {
        heading: templateSection.heading,
        body: 'No governed truth available for this section.',
        sourceSectionKeys: [],
        directMatch: false,
      }
    }

    if (!direct) {
      limitations.push(`No direct accepted truth matched ${templateSection.heading}; nearest accepted VMF truth was used.`)
    }

    return {
      heading: templateSection.heading,
      body: clampText(record.content),
      sourceSectionKeys: [record.sectionKey].filter(Boolean),
      sourceLabel: record.label,
      directMatch: direct,
    }
  })

  return {
    sections,
    limitations,
  }
}

const buildLineageSummary = ({ assetId, definition, readiness, runtimeInstance, sourceSnapshot }) => ({
  contractVersion: OUTPUT_LAB_CONTRACT_VERSION,
  outputAssetId: assetId,
  runtimeInstanceId: toIdString(runtimeInstance?._id || runtimeInstance?.id),
  runtimeInstanceKey: runtimeInstance?.runtimeInstanceKey || '',
  frameworkKey: runtimeInstance?.frameworkKey || '',
  packageKey: runtimeInstance?.packageKey || '',
  packageVersion: runtimeInstance?.packageVersion || '',
  outputTypeKey: definition.outputTypeKey,
  outputTypeLabel: definition.label,
  publishSnapshotId: sourceSnapshot.publishSnapshotId,
  publishSnapshotHash: sourceSnapshot.publishSnapshotHash,
  lockSnapshotId: sourceSnapshot.lockSnapshotId,
  lockSnapshotHash: sourceSnapshot.lockSnapshotHash,
  replayAnchorId: sourceSnapshot.replayAnchorId,
  graphVersion: readiness.graph.graphVersion || '',
  graphHash: readiness.graph.graphHash || '',
  acceptedTruthCount: readiness.acceptedTruthCount,
})

const EXPANSION_GUARDRAILS = Object.freeze({
  llmMayExpandPresentation: true,
  llmMayCreateTruth: false,
  llmMayInventEvidence: false,
  llmMayInventFinancialValues: false,
  llmMustPreserveLimitations: true,
})

const buildSafeJsonExport = ({
  assetId,
  definition,
  generatedAt,
  governedOutput,
  lineageSummary,
  limitations,
  runtimeInstance,
  sourceTruthSummary,
  warnings,
}) => ({
  schemaVersion: OUTPUT_LAB_EXPORT_SCHEMA_VERSION,
  outputAssetId: assetId,
  runtimeInstanceId: toIdString(runtimeInstance?._id || runtimeInstance?.id),
  frameworkKey: runtimeInstance?.frameworkKey || '',
  outputTypeKey: definition.outputTypeKey,
  format: OUTPUT_LAB_EXPORT_FORMATS.JSON,
  generatedAt,
  governedOutput,
  sourceTruthSummary,
  lineageSummary,
  limitations,
  warnings,
  expansionGuardrails: { ...EXPANSION_GUARDRAILS },
})

const renderMarkdownList = (items = [], fallback = 'None recorded.') => {
  const lines = items.map((item) => normalizeText(item)).filter(Boolean)
  if (lines.length === 0) return `- ${fallback}`
  return lines.map((line) => `- ${line}`).join('\n')
}

const renderMarkdownExport = ({
  definition,
  governedOutput,
  lineageSummary,
  limitations,
  sourceTruthSummary,
  warnings,
}) => [
  `# ${definition.label}`,
  '',
  '## Expansion Instruction',
  '',
  'Expand the governed StorylineOS output below into polished customer-facing prose.',
  'Do not introduce new facts, claims, financial values, evidence, customers, products, or recommendations.',
  'Preserve all limitations.',
  '',
  '## Governed Output',
  '',
  ...governedOutput.sections.flatMap((section) => [
    `### ${section.heading}`,
    '',
    section.body || 'No governed truth available for this section.',
    '',
  ]),
  '## Source Truth Summary',
  '',
  ...sourceTruthSummary.flatMap((truth) => [
    `- ${truth.label}: ${truth.summary}`,
  ]),
  sourceTruthSummary.length === 0 ? '- No accepted truth summary available.' : '',
  '',
  '## Lineage Summary',
  '',
  `- Runtime: ${lineageSummary.runtimeInstanceKey || lineageSummary.runtimeInstanceId}`,
  `- Framework: ${lineageSummary.frameworkKey}`,
  `- Package: ${[lineageSummary.packageKey, lineageSummary.packageVersion].filter(Boolean).join(' / ') || 'Not projected'}`,
  `- Publish Snapshot: ${lineageSummary.publishSnapshotId || 'Not projected'}`,
  `- Lock Snapshot: ${lineageSummary.lockSnapshotId || 'Not projected'}`,
  `- Replay Anchor: ${lineageSummary.replayAnchorId || 'Not projected'}`,
  `- Graph: ${[lineageSummary.graphVersion, lineageSummary.graphHash].filter(Boolean).join(' / ') || 'Not projected'}`,
  '',
  '## Limitations And Gaps',
  '',
  renderMarkdownList(limitations, 'No limitations recorded.'),
  '',
  '## Warnings',
  '',
  renderMarkdownList(warnings, 'No warnings recorded.'),
  '',
].filter((line, index, lines) => !(line === '' && lines[index - 1] === '' && lines[index + 1] === '')).join('\n')

const getOutputWarnings = (readiness) =>
  (Array.isArray(readiness.warnings) ? readiness.warnings : [])
    .map((warning) => warning.message)
    .filter(Boolean)

const buildOutputAssetPayload = ({
  definition,
  readiness,
  runtimeInstance,
  sourceTruthSummary,
}) => {
  const sourceSnapshot = buildSourceSnapshot({ runtimeInstance, readiness })
  const assetId = buildOutputLabId('out_asset')
  const generatedAt = new Date().toISOString()
  const acceptedTruth = sourceTruthSummary.map((record) => ({
    ...record,
    content: record.content || record.summary || '',
  }))
  const composition = composeGovernedOutput({ acceptedTruth, definition })
  const limitations = [
    ...composition.limitations,
    'Output Lab MVP validates truth quality and structure; polished writing remains an external expansion step.',
  ]
  const warnings = getOutputWarnings(readiness)
  const governedOutput = {
    outputTypeKey: definition.outputTypeKey,
    outputTypeLabel: definition.label,
    sections: composition.sections,
  }
  const lineageSummary = buildLineageSummary({
    assetId,
    definition,
    readiness,
    runtimeInstance,
    sourceSnapshot,
  })
  const safeJson = buildSafeJsonExport({
    assetId,
    definition,
    generatedAt,
    governedOutput,
    lineageSummary,
    limitations,
    runtimeInstance,
    sourceTruthSummary: sourceTruthSummary.map(summarizeTruthRecord),
    warnings,
  })
  const markdown = renderMarkdownExport({
    definition,
    governedOutput,
    lineageSummary,
    limitations,
    sourceTruthSummary: sourceTruthSummary.map(summarizeTruthRecord),
    warnings,
  })

  return {
    assetId,
    generatedAt,
    governedOutput,
    sourceSnapshot,
    sourceTruthSummary: sourceTruthSummary.map(summarizeTruthRecord),
    lineageSummary,
    limitations,
    warnings,
    markdown,
    safeJson,
  }
}

const isAssetStaleAgainstReadiness = ({ asset, readiness }) => {
  const sourceSnapshot = asset?.sourceSnapshot || {}
  if (!readiness?.canGenerate) return true
  if (sourceSnapshot.lockSnapshotHash !== readiness.outputEligibility.lockSnapshotHash) return true
  if (sourceSnapshot.publishSnapshotHash !== readiness.outputEligibility.publishSnapshotHash) return true
  if (sourceSnapshot.replayAnchorId !== readiness.outputEligibility.replayAnchorId) return true
  if (sourceSnapshot.graphHash !== readiness.graph.graphHash) return true
  return false
}

const serializeRequest = (request) => {
  const plain = toPlainObject(request)
  if (!plain) return null
  return {
    ...plain,
    id: toIdString(plain.id || plain._id),
    tenantId: toIdString(plain.tenantId),
    customerId: toIdString(plain.customerId),
    runtimeInstanceId: toIdString(plain.runtimeInstanceId),
    requestedBy: toIdString(plain.requestedBy),
    requestedAt: normalizeDateValue(plain.requestedAt),
    generatedAt: normalizeDateValue(plain.generatedAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
  }
}

const serializeAsset = ({ asset, readiness = null, includeContent = true } = {}) => {
  const plain = toPlainObject(asset)
  if (!plain) return null
  const stale = readiness ? isAssetStaleAgainstReadiness({ asset: plain, readiness }) : false
  const status = stale && plain.status !== OUTPUT_LAB_ASSET_STATUSES.PUBLISHED
    ? OUTPUT_LAB_ASSET_STATUSES.STALE
    : plain.status
  return {
    ...plain,
    id: toIdString(plain.id || plain._id),
    tenantId: toIdString(plain.tenantId),
    customerId: toIdString(plain.customerId),
    runtimeInstanceId: toIdString(plain.runtimeInstanceId),
    generatedBy: toIdString(plain.generatedBy),
    publishedBy: plain.publishedBy ? toIdString(plain.publishedBy) : null,
    generatedAt: normalizeDateValue(plain.generatedAt),
    publishedAt: normalizeDateValue(plain.publishedAt),
    createdAt: normalizeDateValue(plain.createdAt),
    updatedAt: normalizeDateValue(plain.updatedAt),
    status,
    stale,
    exportable: !stale && [
      OUTPUT_LAB_ASSET_STATUSES.GENERATED,
      OUTPUT_LAB_ASSET_STATUSES.PUBLISHED,
    ].includes(normalizeToken(plain.status)),
    supportedFormats: Object.values(OUTPUT_LAB_EXPORT_FORMATS),
    ...(includeContent ? {
      markdown: plain.markdown || '',
      safeJson: plain.safeJson || {},
      governedOutput: plain.governedOutput || {},
      sourceTruthSummary: plain.sourceTruthSummary || [],
      lineageSummary: plain.lineageSummary || {},
      limitations: plain.limitations || [],
      warnings: plain.warnings || [],
      expansionGuardrails: plain.expansionGuardrails || { ...EXPANSION_GUARDRAILS },
    } : {
      markdown: undefined,
      safeJson: undefined,
    }),
  }
}

const logOutputLabAudit = async ({
  action,
  auditRequest,
  diff,
  runtimeInstance,
  summary,
}) => {
  const auditPayload = {
    action,
    resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
    resourceId: runtimeInstance._id || runtimeInstance.id,
    scope: {
      customerId: runtimeInstance.customerId,
      tenantId: runtimeInstance.tenantId,
      runtimeInstanceId: runtimeInstance._id || runtimeInstance.id,
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
    },
    summary,
    diff,
  }
  const options = { throwOnError: true }
  if (auditRequest) {
    await auditService.logFromRequest(auditRequest, auditPayload, options)
    return
  }
  await auditService.log({
    ...auditPayload,
    actorUserId: diff?.actorUserId,
  }, options)
}

const failAuditClosed = (err, details = {}) =>
  createOutputLabError({
    status: 500,
    code: 'OUTPUT_AUDIT_FAILED',
    message: 'Output Lab audit could not be persisted.',
    reason: OUTPUT_LAB_ERROR_REASONS.OUTPUT_AUDIT_PERSISTENCE_FAILED,
    details: {
      auditError: {
        message: err?.message || 'Audit persistence failed.',
      },
      ...details,
    },
  })

export const getOutputLabDefinitions = () => cloneValue(OUTPUT_LAB_OUTPUT_DEFINITIONS)

export const getRuntimeOutputLabReadiness = async ({
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await resolveRuntimeInstance({ runtimeInstanceId, scopes, permission: 'VMF_VIEW' })
  const frameworkPackage = await resolveFrameworkPackage(runtimeInstance)
  return buildReadiness({ frameworkPackage, runtimeInstance })
}

export const getRuntimeOutputLab = async ({
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await resolveRuntimeInstance({ runtimeInstanceId, scopes, permission: 'VMF_VIEW' })
  const frameworkPackage = await resolveFrameworkPackage(runtimeInstance)
  const readiness = buildReadiness({ frameworkPackage, runtimeInstance })
  const runtimeObjectId = runtimeInstance._id || runtimeInstance.id
  const [requests, assets] = await Promise.all([
    RuntimeOutputRequest.find({ runtimeInstanceId: runtimeObjectId })
      .sort({ createdAt: -1 })
      .limit(OUTPUT_LAB_REQUEST_LIST_LIMIT)
      .lean(),
    RuntimeOutputAsset.find({ runtimeInstanceId: runtimeObjectId })
      .sort({ createdAt: -1 })
      .limit(OUTPUT_LAB_ASSET_LIST_LIMIT)
      .lean(),
  ])

  return {
    contractVersion: OUTPUT_LAB_CONTRACT_VERSION,
    definitions: getOutputLabDefinitions(),
    readiness,
    requests: requests.map(serializeRequest),
    assets: assets.map((asset) => serializeAsset({ asset, readiness, includeContent: false })),
  }
}

export const createRuntimeOutputRequest = async ({
  actorUserId,
  auditRequest,
  payload,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const definition = assertOutputTypeSupported(payload?.outputTypeKey)
  const runtimeInstance = await resolveRuntimeInstance({
    runtimeInstanceId,
    scopes,
    permission: 'VMF_UPDATE',
  })
  const frameworkPackage = await resolveFrameworkPackage(runtimeInstance)
  const readiness = buildReadiness({ frameworkPackage, runtimeInstance })
  const existingRequest = await RuntimeOutputRequest.findOne({
    runtimeInstanceId: runtimeInstance._id || runtimeInstance.id,
    outputTypeKey: definition.outputTypeKey,
    status: {
      $in: [
        OUTPUT_LAB_REQUEST_STATUSES.REQUESTED,
        OUTPUT_LAB_REQUEST_STATUSES.GENERATING,
      ],
    },
  })

  if (existingRequest) {
    throw createOutputLabError({
      status: 409,
      code: 'CONFLICT',
      message: 'An active Output Lab request already exists for this output type.',
      reason: OUTPUT_LAB_ERROR_REASONS.OUTPUT_REQUEST_DUPLICATE,
      details: {
        outputRequestId: existingRequest.outputRequestId,
        outputTypeKey: definition.outputTypeKey,
        status: existingRequest.status,
      },
    })
  }

  const request = new RuntimeOutputRequest({
    outputRequestId: buildOutputLabId('out_req'),
    ...getRuntimeScope(runtimeInstance),
    outputTypeKey: definition.outputTypeKey,
    outputTypeLabel: definition.label,
    status: OUTPUT_LAB_REQUEST_STATUSES.REQUESTED,
    readinessState: readiness.state,
    readinessSummary: readiness,
    requestedBy: actorUserId,
    requestedAt: new Date(),
  })

  await request.save()

  try {
    await logOutputLabAudit({
      action: auditService.AUDIT_ACTIONS.OUTPUT_REQUEST_CREATED,
      auditRequest,
      runtimeInstance,
      summary: `Output Lab request created for ${definition.label}.`,
      diff: {
        actorUserId,
        outputRequestId: request.outputRequestId,
        outputTypeKey: definition.outputTypeKey,
        readinessState: readiness.state,
      },
    })
  } catch (err) {
    await RuntimeOutputRequest.deleteOne({ _id: request._id })
    throw failAuditClosed(err, { outputRequestId: request.outputRequestId })
  }

  return serializeRequest(request)
}

const resolveOutputRequest = async ({ outputRequestId, runtimeInstance }) => {
  const request = await RuntimeOutputRequest.findOne({
    outputRequestId,
    runtimeInstanceId: runtimeInstance._id || runtimeInstance.id,
  })

  if (!request) {
    throw createOutputLabError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Output request not found.',
      reason: OUTPUT_LAB_ERROR_REASONS.OUTPUT_REQUEST_NOT_FOUND,
      details: { outputRequestId },
    })
  }

  return request
}

export const getRuntimeOutputRequest = async ({
  outputRequestId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await resolveRuntimeInstance({ runtimeInstanceId, scopes, permission: 'VMF_VIEW' })
  const request = await resolveOutputRequest({ outputRequestId, runtimeInstance })
  return serializeRequest(request)
}

export const generateRuntimeOutputAsset = async ({
  actorUserId,
  auditRequest,
  outputRequestId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await resolveRuntimeInstance({
    runtimeInstanceId,
    scopes,
    permission: 'VMF_UPDATE',
    asDocument: true,
  })
  const request = await resolveOutputRequest({ outputRequestId, runtimeInstance })
  const definition = assertOutputTypeSupported(request.outputTypeKey)
  if (request.outputAssetId || request.status === OUTPUT_LAB_REQUEST_STATUSES.COMPLETED) {
    throw createOutputLabError({
      status: 409,
      code: 'CONFLICT',
      message: 'Output request has already generated an asset.',
      reason: OUTPUT_LAB_ERROR_REASONS.OUTPUT_REQUEST_ALREADY_GENERATED,
      details: {
        outputRequestId: request.outputRequestId,
        outputAssetId: request.outputAssetId,
        status: request.status,
      },
    })
  }

  const frameworkPackage = await resolveFrameworkPackage(runtimeInstance)
  const readiness = buildReadiness({ frameworkPackage, runtimeInstance })
  assertRuntimeReady(readiness)

  const sourceTruthSummary = getAcceptedTruthRecords({
    frameworkPackage,
    frameworkState: getFrameworkState(runtimeInstance),
  }).filter((record) => record.content)
  const assetPayload = buildOutputAssetPayload({
    definition,
    readiness,
    runtimeInstance,
    sourceTruthSummary,
  })
  const asset = new RuntimeOutputAsset({
    outputAssetId: assetPayload.assetId,
    outputRequestId: request.outputRequestId,
    ...getRuntimeScope(runtimeInstance),
    outputTypeKey: definition.outputTypeKey,
    outputTypeLabel: definition.label,
    status: OUTPUT_LAB_ASSET_STATUSES.GENERATED,
    governedOutput: assetPayload.governedOutput,
    sourceTruthSummary: assetPayload.sourceTruthSummary,
    lineageSummary: assetPayload.lineageSummary,
    warnings: assetPayload.warnings,
    limitations: assetPayload.limitations,
    expansionGuardrails: { ...EXPANSION_GUARDRAILS },
    markdown: assetPayload.markdown,
    safeJson: assetPayload.safeJson,
    sourceSnapshot: assetPayload.sourceSnapshot,
    generatedBy: actorUserId,
    generatedAt: assetPayload.generatedAt,
  })

  request.status = OUTPUT_LAB_REQUEST_STATUSES.COMPLETED
  request.generatedAt = assetPayload.generatedAt
  request.outputAssetId = asset.outputAssetId
  request.failureReason = ''
  request.readinessState = readiness.state
  request.readinessSummary = readiness

  await asset.save()
  await request.save()

  try {
    await logOutputLabAudit({
      action: auditService.AUDIT_ACTIONS.OUTPUT_GENERATION_COMPLETED,
      auditRequest,
      runtimeInstance,
      summary: `Output Lab generated ${definition.label}.`,
      diff: {
        actorUserId,
        outputRequestId: request.outputRequestId,
        outputAssetId: asset.outputAssetId,
        outputTypeKey: definition.outputTypeKey,
        readinessState: readiness.state,
        lockSnapshotId: assetPayload.sourceSnapshot.lockSnapshotId,
        graphHash: assetPayload.sourceSnapshot.graphHash,
      },
    })
  } catch (err) {
    const rollbackDetails = {}
    try {
      await RuntimeOutputAsset.deleteOne({ _id: asset._id })
      request.status = OUTPUT_LAB_REQUEST_STATUSES.REQUESTED
      request.generatedAt = null
      request.outputAssetId = ''
      request.failureReason = 'Audit persistence failed.'
      await request.save()
    } catch (rollbackErr) {
      rollbackDetails.rollbackFailed = true
      rollbackDetails.rollbackError = rollbackErr?.message || 'Output asset rollback failed.'
    }
    throw failAuditClosed(err, {
      outputRequestId: request.outputRequestId,
      outputAssetId: asset.outputAssetId,
      ...rollbackDetails,
    })
  }

  return serializeAsset({ asset, readiness })
}

const resolveOutputAsset = async ({ outputAssetId, runtimeInstance }) => {
  const asset = await RuntimeOutputAsset.findOne({
    outputAssetId,
    runtimeInstanceId: runtimeInstance._id || runtimeInstance.id,
  })

  if (!asset) {
    throw createOutputLabError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Output asset not found.',
      reason: OUTPUT_LAB_ERROR_REASONS.OUTPUT_ASSET_NOT_FOUND,
      details: { outputAssetId },
    })
  }

  return asset
}

export const listRuntimeOutputAssets = async ({
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await resolveRuntimeInstance({ runtimeInstanceId, scopes, permission: 'VMF_VIEW' })
  const frameworkPackage = await resolveFrameworkPackage(runtimeInstance)
  const readiness = buildReadiness({ frameworkPackage, runtimeInstance })
  const rows = await RuntimeOutputAsset.find({ runtimeInstanceId: runtimeInstance._id || runtimeInstance.id })
    .sort({ createdAt: -1 })
    .limit(OUTPUT_LAB_ASSET_LIST_LIMIT)
    .lean()
  return rows.map((asset) => serializeAsset({ asset, readiness, includeContent: false }))
}

export const getRuntimeOutputAsset = async ({
  outputAssetId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await resolveRuntimeInstance({ runtimeInstanceId, scopes, permission: 'VMF_VIEW' })
  const frameworkPackage = await resolveFrameworkPackage(runtimeInstance)
  const readiness = buildReadiness({ frameworkPackage, runtimeInstance })
  const asset = await resolveOutputAsset({ outputAssetId, runtimeInstance })
  return serializeAsset({ asset, readiness })
}

export const publishRuntimeOutputAsset = async ({
  actorUserId,
  auditRequest,
  outputAssetId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await resolveRuntimeInstance({
    runtimeInstanceId,
    scopes,
    permission: 'VMF_UPDATE',
  })
  const frameworkPackage = await resolveFrameworkPackage(runtimeInstance)
  const readiness = buildReadiness({ frameworkPackage, runtimeInstance })
  const asset = await resolveOutputAsset({ outputAssetId, runtimeInstance })
  const stale = isAssetStaleAgainstReadiness({ asset, readiness })

  if (stale) {
    throw createOutputLabError({
      status: 409,
      code: 'CONFLICT',
      message: 'Output asset is stale against current runtime truth and cannot be published.',
      reason: OUTPUT_LAB_ERROR_REASONS.OUTPUT_ASSET_STALE,
      details: { outputAssetId },
    })
  }

  const previousStatus = asset.status
  asset.status = OUTPUT_LAB_ASSET_STATUSES.PUBLISHED
  asset.publishedBy = actorUserId
  asset.publishedAt = new Date()
  await asset.save()

  try {
    await logOutputLabAudit({
      action: auditService.AUDIT_ACTIONS.OUTPUT_ASSET_PUBLISHED,
      auditRequest,
      runtimeInstance,
      summary: `Output Lab asset published for ${asset.outputTypeLabel}.`,
      diff: {
        actorUserId,
        outputAssetId: asset.outputAssetId,
        outputTypeKey: asset.outputTypeKey,
        previousStatus,
        nextStatus: asset.status,
      },
    })
  } catch (err) {
    asset.status = previousStatus
    asset.publishedBy = null
    asset.publishedAt = null
    await asset.save()
    throw failAuditClosed(err, { outputAssetId: asset.outputAssetId })
  }

  return serializeAsset({ asset, readiness })
}

const getExportFilename = ({ asset, format }) => {
  const label = normalizeKey(asset.outputTypeLabel || asset.outputTypeKey).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const runtimeKey = normalizeKey(asset.runtimeInstanceKey || 'runtime').replace(/[^a-z0-9-]+/g, '-')
  const extension = format === OUTPUT_LAB_EXPORT_FORMATS.JSON ? 'json' : 'md'
  return `${runtimeKey}-${label || 'output-lab'}.${extension}`
}

export const exportRuntimeOutputAsset = async ({
  format,
  outputAssetId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const normalizedFormat = normalizeToken(format)
  if (!Object.values(OUTPUT_LAB_EXPORT_FORMATS).includes(normalizedFormat)) {
    throw createOutputLabError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Output export format is not supported.',
      reason: OUTPUT_LAB_ERROR_REASONS.OUTPUT_EXPORT_FORMAT_UNSUPPORTED,
      details: { format },
    })
  }

  const runtimeInstance = await resolveRuntimeInstance({ runtimeInstanceId, scopes, permission: 'VMF_VIEW' })
  const frameworkPackage = await resolveFrameworkPackage(runtimeInstance)
  const readiness = buildReadiness({ frameworkPackage, runtimeInstance })
  const asset = await resolveOutputAsset({ outputAssetId, runtimeInstance })
  const serializedAsset = serializeAsset({ asset, readiness })

  if (!serializedAsset.exportable) {
    throw createOutputLabError({
      status: 409,
      code: 'CONFLICT',
      message: 'Output asset is stale against current runtime truth and cannot be exported.',
      reason: OUTPUT_LAB_ERROR_REASONS.OUTPUT_ASSET_STALE,
      details: { outputAssetId },
    })
  }

  const filename = getExportFilename({ asset: serializedAsset, format: normalizedFormat })
  if (normalizedFormat === OUTPUT_LAB_EXPORT_FORMATS.JSON) {
    return {
      format: normalizedFormat,
      filename,
      mimeType: 'application/json',
      content: serializedAsset.safeJson,
    }
  }

  return {
    format: normalizedFormat,
    filename,
    mimeType: 'text/markdown',
    content: serializedAsset.markdown,
  }
}
