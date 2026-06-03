import crypto from 'node:crypto'
import {
  DISCOVERY_EVIDENCE_REVIEW_STATUSES,
  isGovernedDiscoveryEvidenceFact,
  normalizeDiscoveryEvidenceObjects,
} from './discoveryIntelligenceService.js'

export const RUNTIME_SECTION_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  GENERATED: 'GENERATED',
  REGENERATED: 'REGENERATED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
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
  'additionalEvidence',
  'evidenceObjects',
  'gsilContext',
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
      additionalEvidence: isPlainObject(value.additionalEvidence) ? value.additionalEvidence : {},
      evidenceObjects: Array.isArray(value.evidenceObjects) ? value.evidenceObjects : [],
      gsilContext: isPlainObject(value.gsilContext) ? value.gsilContext : {},
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
    additionalEvidence: {},
    evidenceObjects: [],
    gsilContext: {},
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

const GSIL_ENRICHMENT_VERSION = 'gsil-section-enrichment-v1'

const SECTION_CATEGORY_RULES = Object.freeze({
  EXECUTIVE_SUMMARY: {
    heading: 'Strategic Overview',
    summaryHeading: 'Value Thesis',
    boundaries: [
      'No customer proof has been provided.',
      'No quantified outcomes have been provided.',
      'No independently validated market position has been provided.',
    ],
  },
  VALUE_DRIVERS: {
    heading: 'Primary Value Drivers',
    summaryHeading: 'Why These Matter',
    boundaries: [
      'No quantified ROI has been provided.',
      'No named customer proof has been provided.',
      'No implementation timeline has been provided.',
    ],
  },
  BUSINESS_CASE_ECONOMICS: {
    heading: 'Economic Value Levers',
    summaryHeading: 'Measurement Focus',
    boundaries: [
      'No ROI percentage has been provided.',
      'No payback period has been provided.',
      'No cost saving figure has been provided.',
    ],
  },
  COMPETITIVE_TRAP_MAP: {
    heading: 'Safe Competitive Framing',
    summaryHeading: 'Positioning Boundaries',
    boundaries: [
      'No named competitors have been provided.',
      'No competitor weakness claims have been evidenced.',
      'No win/loss proof has been provided.',
    ],
  },
  POSITIONING_DIFFERENTIATION: {
    heading: 'Differentiation Themes',
    summaryHeading: 'Evidence-Bound Positioning',
    boundaries: [
      'No category leadership claim has been evidenced.',
      'No proprietary advantage has been independently validated.',
      'No competitor comparison has been provided.',
    ],
  },
  GENERIC: {
    heading: 'Generated Insight',
    summaryHeading: 'What This Supports',
    boundaries: [
      'No quantified commercial proof has been provided.',
      'No named customer proof has been provided.',
      'No external market validation has been provided.',
    ],
  },
})

const normalizeSectionText = (value) => String(value || '').trim()

const normalizeSectionToken = (value) =>
  normalizeSectionText(value).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()

const titleFromSectionKey = (value, fallback = 'Section') => {
  const normalized = normalizeSectionText(value)
  if (!normalized) return fallback
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

const normalizeEvidenceString = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(normalizeEvidenceString).filter(Boolean).join('; ')
  if (isPlainObject(value)) {
    if (typeof value.summary === 'string') return value.summary.trim()
    if (typeof value.content === 'string') return value.content.trim()
    return Object.values(value).map(normalizeEvidenceString).filter(Boolean).join('; ')
  }
  return ''
}

const getEvidencePackFromFrameworkState = (frameworkState = {}) =>
  isPlainObject(frameworkState.evidence_pack)
    ? frameworkState.evidence_pack
    : isPlainObject(frameworkState.evidencePack)
      ? frameworkState.evidencePack
      : {}

const isDiscoveryEvidenceAccepted = (evidencePack = {}) => {
  const needsRefresh = evidencePack.needsRefresh === true || evidencePack.state?.needsRefresh === true
  return !needsRefresh && (evidencePack.accepted === true || evidencePack.state?.accepted === true)
}

const getAcceptedDiscoveryEvidenceObjects = (evidencePack = {}) => {
  if (!isDiscoveryEvidenceAccepted(evidencePack)) return []

  const evidenceObjects = normalizeDiscoveryEvidenceObjects({
    acquisitionProfile: evidencePack.acquisition?.profile || evidencePack.acquisitionProfile,
    createdAt: evidencePack.refreshedAt,
    evidenceObjects: evidencePack.evidenceObjects,
    inputs: evidencePack.inputs,
    sources: evidencePack.lineage?.sources || [],
  })

  return evidenceObjects.filter((evidenceObject) =>
    evidenceObject.reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED,
  )
}

const getRuntimeSectionStateKey = ({ runtimePath, sectionKey }) => {
  const normalizedRuntimePath = normalizeSectionText(runtimePath)
  const sectionRootPrefix = 'framework_state.sections.'

  if (normalizedRuntimePath.startsWith(sectionRootPrefix)) {
    const statePath = normalizedRuntimePath.slice(sectionRootPrefix.length).trim()
    if (statePath && !statePath.includes('.')) return statePath
  }

  return normalizeSectionText(sectionKey)
}

const getSectionStateValue = ({ frameworkState = {}, runtimePath, sectionKey }) => {
  const sections = isPlainObject(frameworkState.sections) ? frameworkState.sections : {}
  const stateSectionKey = getRuntimeSectionStateKey({ runtimePath, sectionKey })
  if (stateSectionKey && Object.prototype.hasOwnProperty.call(sections, stateSectionKey)) {
    return sections[stateSectionKey]
  }
  if (sectionKey && Object.prototype.hasOwnProperty.call(sections, sectionKey)) {
    return sections[sectionKey]
  }
  return undefined
}

const normalizeSectionEvidenceObjects = ({
  evidenceObjects = [],
  runtimePath,
  sectionKey,
} = {}) => (Array.isArray(evidenceObjects) ? evidenceObjects : [])
  .map((evidenceObject) => {
    const evidenceObjectId = normalizeEvidenceString(evidenceObject?.evidenceObjectId)
    const sourceId = normalizeEvidenceString(evidenceObject?.sourceId)
    const extractedFact = normalizeEvidenceString(evidenceObject?.extractedFact)
    if (!evidenceObjectId || !sourceId || !extractedFact) return null

    return {
      evidenceObjectId,
      sectionKey: normalizeEvidenceString(evidenceObject.sectionKey || sectionKey),
      runtimePath: normalizeEvidenceString(evidenceObject.runtimePath || runtimePath),
      sourceId,
      sourceType: 'SECTION_UPLOADED_DOCUMENT',
      category: evidenceObject.category || 'Section Evidence',
      coverageArea: evidenceObject.coverageArea || evidenceObject.category || 'Section Evidence',
      extractedFact,
      confidence: isPlainObject(evidenceObject.confidence)
        ? evidenceObject.confidence
        : {
            level: 'SOURCE_BACKED',
            score: 74,
            basis: ['SECTION_UPLOADED_DOCUMENT', 'DETERMINISTIC_TEXT_EXTRACTION'],
          },
      createdAt: evidenceObject.createdAt || '',
      reviewStatus: String(evidenceObject.reviewStatus || DISCOVERY_EVIDENCE_REVIEW_STATUSES.PENDING).trim().toUpperCase(),
      acquisitionMethod: 'SECTION_DOCUMENT_INGESTION',
      extractionTimestamp: evidenceObject.extractionTimestamp || evidenceObject.createdAt || '',
      acceptedBy: evidenceObject.acceptedBy || '',
      acceptanceTimestamp: evidenceObject.acceptanceTimestamp || '',
      rejectedBy: evidenceObject.rejectedBy || '',
      rejectionTimestamp: evidenceObject.rejectionTimestamp || '',
      auditRef: evidenceObject.auditRef || '',
      lineageRef: evidenceObject.lineageRef || `lineage:${sourceId}`,
      sourceFileName: evidenceObject.sourceFileName || '',
      documentAssetType: evidenceObject.documentAssetType || 'SECTION_SUPPORTING_FILE',
    }
  })
  .filter(Boolean)

const getAcceptedSectionEvidenceObjects = ({ frameworkState = {}, runtimePath, sectionKey } = {}) => {
  const rawSectionValue = getSectionStateValue({ frameworkState, runtimePath, sectionKey })
  const sectionObject = normalizeRuntimeSectionObject({
    value: rawSectionValue,
    sectionKey,
    runtimePath,
  })

  return normalizeSectionEvidenceObjects({
    evidenceObjects: sectionObject.evidenceObjects,
    runtimePath,
    sectionKey,
  }).filter((evidenceObject) =>
    evidenceObject.reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED,
  )
}

const extractAcceptedFactValue = (evidenceObjects = [], prefix) => {
  const normalizedPrefix = String(prefix || '').trim().toLowerCase()
  const evidenceObject = evidenceObjects.find((candidate) =>
    normalizeEvidenceString(candidate.extractedFact).toLowerCase().startsWith(normalizedPrefix),
  )
  if (!evidenceObject) return ''
  return normalizeEvidenceString(evidenceObject.extractedFact).slice(prefix.length).replace(/^:\s*/, '').trim()
}

const extractAcceptedFactValueByPrefix = (evidenceObjects = [], prefixes = []) => {
  for (const prefix of prefixes) {
    const value = extractAcceptedFactValue(evidenceObjects, prefix)
    if (value) return value
  }
  return ''
}

const getDiscoverySeedProfile = (evidencePack = {}) => {
  const acceptedEvidenceObjects = getAcceptedDiscoveryEvidenceObjects(evidencePack)
  if (acceptedEvidenceObjects.length > 0) {
    return {
      companyWebsite: extractAcceptedFactValue(acceptedEvidenceObjects, 'Company website'),
      companyName: extractAcceptedFactValue(acceptedEvidenceObjects, 'Company name'),
      marketRegion: extractAcceptedFactValue(acceptedEvidenceObjects, 'Market or region'),
      targetOffer: extractAcceptedFactValue(acceptedEvidenceObjects, 'Target offer'),
      notes: extractAcceptedFactValueByPrefix(acceptedEvidenceObjects, [
        'Intelligence Hub note',
        'Discovery note',
      ]),
      acceptedEvidenceText: acceptedEvidenceObjects
        .map((evidenceObject) => normalizeEvidenceString(evidenceObject.extractedFact))
        .filter(Boolean)
        .join(' '),
    }
  }

  if (Array.isArray(evidencePack.evidenceObjects) && evidencePack.evidenceObjects.length > 0) {
    return {}
  }

  return {
    ...(isPlainObject(evidencePack.discovery?.seedProfile) ? evidencePack.discovery.seedProfile : {}),
    ...(isPlainObject(evidencePack.inputs) ? evidencePack.inputs : {}),
  }
}

const getScopedEvidenceView = ({ evidencePack, runtimePath, sectionKey }) => {
  const scopedViews = isPlainObject(evidencePack.scoped_views)
    ? evidencePack.scoped_views
    : isPlainObject(evidencePack.scopedViews)
      ? evidencePack.scopedViews
      : {}
  const runtimePathTail = normalizeSectionText(runtimePath).split('.').filter(Boolean).pop()
  const candidates = [
    sectionKey,
    runtimePath,
    runtimePathTail,
    runtimePathTail?.replace(/_/g, '-'),
  ].map((candidate) => normalizeSectionText(candidate)).filter(Boolean)

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(scopedViews, candidate)) return scopedViews[candidate]
  }

  return null
}

const normalizeScopedEvidenceSummary = (value) => {
  const summary = normalizeEvidenceString(value)
  if (!summary) return ''
  return isGovernedDiscoveryEvidenceFact(summary) ? summary : ''
}

const getAcceptedDependencyTruths = ({ dependencySectionKeys = [], frameworkPackage, frameworkState }) => {
  const sections = isPlainObject(frameworkState?.sections) ? frameworkState.sections : {}
  const packageSections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []

  return dependencySectionKeys.flatMap((dependencySectionKey) => {
    const normalizedKey = normalizeSectionText(dependencySectionKey)
    if (!normalizedKey) return []
    const packageSection = packageSections.find((candidate) =>
      normalizeSectionText(candidate?.sectionKey || candidate?.key) === normalizedKey,
    )
    const runtimePath = normalizeSectionText(packageSection?.runtimePath)
    const stateSectionKey = runtimePath.startsWith('framework_state.sections.')
      ? runtimePath.slice('framework_state.sections.'.length)
      : normalizedKey
    const sectionValue = sections[stateSectionKey] ?? sections[normalizedKey]
    const normalizedSection = normalizeRuntimeSectionObject({
      value: sectionValue,
      sectionKey: normalizedKey,
      runtimePath,
    })
    const accepted = normalizedSection.accepted
    const content = normalizeEvidenceString(accepted?.content ?? accepted)
    if (!content) return []
    return [{
      sectionKey: normalizedKey,
      label: titleFromSectionKey(packageSection?.label || normalizedKey),
      content,
      acceptedAt: accepted?.acceptedAt || '',
      truthHash: accepted?.truthHash || '',
    }]
  })
}

const getSectionCategory = ({ label, sectionKey }) => {
  const token = `${normalizeSectionToken(sectionKey)} ${normalizeSectionToken(label)}`
  if (token.includes('VALUE') && token.includes('DRIVER')) return 'VALUE_DRIVERS'
  if (token.includes('EXECUTIVE') && token.includes('SUMMARY')) return 'EXECUTIVE_SUMMARY'
  if (token.includes('BUSINESS') && (token.includes('ECONOMICS') || token.includes('CASE'))) return 'BUSINESS_CASE_ECONOMICS'
  if (token.includes('COMPETITIVE') || token.includes('TRAP')) return 'COMPETITIVE_TRAP_MAP'
  if (token.includes('POSITIONING') || token.includes('DIFFERENTIATION')) return 'POSITIONING_DIFFERENTIATION'
  return 'GENERIC'
}

const pushUniqueTheme = (themes, candidate) => {
  if (!candidate?.label) return
  if (themes.some((theme) => theme.key === candidate.key || theme.label === candidate.label)) return
  themes.push(candidate)
}

const buildTheme = ({
  key,
  label,
  description,
  source = 'DETERMINISTIC_DERIVATION',
  supportLevel = 'DERIVED',
  confidence = 'MEDIUM',
}) => ({
  key,
  label,
  description,
  source,
  supportLevel,
  confidence,
  claimClassification: supportLevel === 'DIRECT' ? 'DIRECTLY_SUPPORTED' : 'DERIVED_FROM_SUPPORTED_CONTEXT',
})

const extractEvidenceThemes = ({
  acceptedEvidenceObjects = [],
  category,
  dependencyTruths,
  inputSummary,
  sectionEvidenceSummary,
  scopedEvidenceSummary,
  seedProfile,
}) => {
  const themes = []
  const targetOffer = normalizeEvidenceString(seedProfile.targetOffer)
  const notes = normalizeEvidenceString(seedProfile.notes)
  const marketRegion = normalizeEvidenceString(seedProfile.marketRegion)
  const evidenceText = [
    normalizeEvidenceString(seedProfile.acceptedEvidenceText),
    ...acceptedEvidenceObjects.map((evidenceObject) => normalizeEvidenceString(evidenceObject.extractedFact)),
    normalizeEvidenceString(seedProfile.companyName),
    normalizeEvidenceString(seedProfile.companyWebsite),
    marketRegion,
    targetOffer,
    notes,
    sectionEvidenceSummary,
    scopedEvidenceSummary,
    inputSummary,
    ...dependencyTruths.map((dependency) => dependency.content),
  ].join(' ').toLowerCase()

  if (/\b(ai|automation|automated|assist|assisted|native)\b/.test(evidenceText)) {
    pushUniqueTheme(themes, buildTheme({
      key: 'workflow_automation',
      label: category === 'VALUE_DRIVERS' ? 'Reduced manual workflow overhead' : 'Workflow automation and assistance',
      description: 'The accepted context supports a theme around reducing manual effort through assisted or automated workflow execution.',
    }))
  }

  if (/\b(govern|governed|governance|framework|runtime|accepted truth|validation|controlled)\b/.test(evidenceText)) {
    pushUniqueTheme(themes, buildTheme({
      key: 'governed_execution',
      label: category === 'VALUE_DRIVERS' ? 'Governed execution and risk control' : 'Governed framework execution',
      description: 'The accepted context supports a theme around controlled, framework-bound execution.',
    }))
  }

  if (/\b(narrative|story|message|messaging|proposal|output|content|commercial)\b/.test(evidenceText)) {
    pushUniqueTheme(themes, buildTheme({
      key: 'structured_output',
      label: category === 'VALUE_DRIVERS' ? 'Faster structured narrative creation' : 'Structured commercial output creation',
      description: 'The accepted context supports a theme around creating structured customer-facing material.',
    }))
  }

  if (/\b(slow|speed|faster|time|manual|effort|efficiency|reduce|reduced|cycle)\b/.test(evidenceText)) {
    pushUniqueTheme(themes, buildTheme({
      key: 'speed_efficiency',
      label: category === 'VALUE_DRIVERS' ? 'Improved speed-to-output' : 'Efficiency and speed-to-output',
      description: 'The accepted context supports a theme around reducing friction in the section workflow.',
      source: inputSummary ? 'CUSTOMER_CONTEXT' : 'DETERMINISTIC_DERIVATION',
    }))
  }

  if (/\b(consistent|consistency|reuse|reusable|standard|shared|repeatable)\b/.test(evidenceText)) {
    pushUniqueTheme(themes, buildTheme({
      key: 'consistency_reuse',
      label: category === 'VALUE_DRIVERS' ? 'More consistent reusable commercial outputs' : 'Consistency and reuse',
      description: 'The accepted context supports a theme around reuse and consistency of governed section truth.',
    }))
  }

  if (/\b(platform|enterprise|software|system|workspace|product)\b/.test(evidenceText) || targetOffer) {
    pushUniqueTheme(themes, buildTheme({
      key: 'offer_context',
      label: category === 'VALUE_DRIVERS' ? 'Offer-led customer value' : 'Offer-led business context',
      description: targetOffer
        ? `The accepted target offer gives this section a bounded offer context: ${targetOffer}.`
        : 'The accepted context identifies an offer or platform context for this section.',
      source: targetOffer ? 'DISCOVERY_EVIDENCE' : 'DETERMINISTIC_DERIVATION',
      supportLevel: targetOffer ? 'DIRECT' : 'DERIVED',
      confidence: targetOffer ? 'HIGH' : 'MEDIUM',
    }))
  }

  if (marketRegion) {
    pushUniqueTheme(themes, buildTheme({
      key: 'market_region',
      label: 'Market and regional context',
      description: `The accepted Intelligence Hub context identifies ${marketRegion} as the current market or regional frame.`,
      source: 'DISCOVERY_EVIDENCE',
      supportLevel: 'DIRECT',
      confidence: 'HIGH',
    }))
  }

  if (dependencyTruths.length > 0) {
    pushUniqueTheme(themes, buildTheme({
      key: 'accepted_upstream_truth',
      label: 'Accepted upstream truth continuity',
      description: 'Accepted dependency truth is available to shape this section without using unrelated sections.',
      source: 'ACCEPTED_UPSTREAM_TRUTH',
      supportLevel: 'DIRECT',
      confidence: 'HIGH',
    }))
  }

  return themes.slice(0, 7)
}

const buildSupportingEvidence = ({
  acceptedEvidenceObjects = [],
  acceptedSectionEvidenceObjects = [],
  dependencyTruths,
  inputSummary,
  scopedEvidenceSummary,
  seedProfile,
}) => {
  const items = []
  const companyName = normalizeEvidenceString(seedProfile.companyName)
  const marketRegion = normalizeEvidenceString(seedProfile.marketRegion)
  const targetOffer = normalizeEvidenceString(seedProfile.targetOffer)
  const notes = normalizeEvidenceString(seedProfile.notes)

  acceptedEvidenceObjects.slice(0, 6).forEach((evidenceObject) => {
    const summary = normalizeEvidenceString(evidenceObject.extractedFact)
    if (!summary) return
    items.push({
      label: evidenceObject.category || 'Accepted evidence',
      summary,
      sourceType: 'DISCOVERY_EVIDENCE_OBJECT',
      refKey: evidenceObject.evidenceObjectId || evidenceObject.lineageRef || evidenceObject.sourceId,
    })
  })

  acceptedSectionEvidenceObjects.slice(0, 6).forEach((evidenceObject) => {
    const summary = normalizeEvidenceString(evidenceObject.extractedFact)
    if (!summary) return
    items.push({
      label: evidenceObject.category || 'Accepted section evidence',
      summary,
      sourceType: 'SECTION_EVIDENCE_OBJECT',
      refKey: evidenceObject.evidenceObjectId || evidenceObject.lineageRef || evidenceObject.sourceId,
    })
  })

  if (companyName) {
    items.push({
      label: 'Company context',
      summary: companyName,
      sourceType: 'DISCOVERY',
      refKey: 'input_companyName',
    })
  }
  if (targetOffer) {
    items.push({
      label: 'Target offer',
      summary: targetOffer,
      sourceType: 'DISCOVERY',
      refKey: 'input_targetOffer',
    })
  }
  if (marketRegion) {
    items.push({
      label: 'Market / region',
      summary: marketRegion,
      sourceType: 'DISCOVERY',
      refKey: 'input_marketRegion',
    })
  }
  if (notes) {
    items.push({
      label: 'Intelligence Hub notes',
      summary: notes,
      sourceType: 'DISCOVERY',
      refKey: 'input_notes',
    })
  }
  if (inputSummary) {
    items.push({
      label: 'Customer section context',
      summary: inputSummary,
      sourceType: 'USER_CONTEXT',
      refKey: 'section_input',
    })
  }
  if (scopedEvidenceSummary) {
    items.push({
      label: 'Section-scoped evidence view',
      summary: scopedEvidenceSummary,
      sourceType: 'DISCOVERY',
      refKey: 'scoped_view',
    })
  }

  dependencyTruths.forEach((dependency) => {
    items.push({
      label: `Accepted truth: ${dependency.label}`,
      summary: dependency.content,
      sourceType: 'DEPENDENCY',
      refKey: `accepted_${dependency.sectionKey}`,
    })
  })

  return items.slice(0, 10)
}

const buildGenerationBoundaries = ({
  category,
  dependencySectionKeys,
  dependencyTruths,
  inputSummary,
  truthEligible,
}) => {
  const rule = SECTION_CATEGORY_RULES[category] || SECTION_CATEGORY_RULES.GENERIC
  const boundaries = rule.boundaries.map((message, index) => ({
    boundaryKey: `${category.toLowerCase()}_boundary_${index + 1}`,
    message,
    reason: 'UNSUPPORTED_CLAIM',
  }))

  if (!inputSummary) {
    boundaries.push({
      boundaryKey: 'no_customer_section_context',
      message: 'No customer-added section context has been provided.',
      reason: 'NO_USER_CONTEXT',
    })
  }

  const missingDependencies = dependencySectionKeys.filter((sectionKey) =>
    !dependencyTruths.some((dependency) => dependency.sectionKey === sectionKey),
  )
  if (missingDependencies.length > 0) {
    boundaries.push({
      boundaryKey: 'missing_dependency_truth',
      message: 'One or more upstream sections do not yet have accepted truth.',
      reason: 'MISSING_DEPENDENCY',
    })
  }

  if (!truthEligible) {
    boundaries.push({
      boundaryKey: 'insufficient_evidence_for_truth',
      message: 'Evidence is not sufficient to derive this section safely.',
      reason: 'INSUFFICIENT_EVIDENCE',
    })
  }

  return boundaries
}

const buildSourceRefs = ({ acceptedEvidenceObjects = [], acceptedSectionEvidenceObjects = [], scopedView, seedProfile }) => {
  const refs = []
  const addRef = ({ refKey, label, type, safeDisplay }) => {
    if (!safeDisplay) return
    if (refs.some((ref) => ref.refKey === refKey)) return
    refs.push({ refKey, label, type, safeDisplay })
  }

  acceptedEvidenceObjects.forEach((evidenceObject) => {
    addRef({
      refKey: evidenceObject.evidenceObjectId || evidenceObject.lineageRef || evidenceObject.sourceId,
      label: evidenceObject.category || 'Accepted evidence',
      type: 'DISCOVERY_EVIDENCE_OBJECT',
      safeDisplay: normalizeEvidenceString(evidenceObject.extractedFact),
    })
  })

  acceptedSectionEvidenceObjects.forEach((evidenceObject) => {
    addRef({
      refKey: evidenceObject.evidenceObjectId || evidenceObject.lineageRef || evidenceObject.sourceId,
      label: evidenceObject.category || 'Accepted section evidence',
      type: 'SECTION_EVIDENCE_OBJECT',
      safeDisplay: normalizeEvidenceString(evidenceObject.extractedFact),
    })
  })

  addRef({
    refKey: 'input_companyName',
    label: 'Company context',
    type: 'DISCOVERY_FIELD',
    safeDisplay: normalizeEvidenceString(seedProfile.companyName),
  })
  addRef({
    refKey: 'input_marketRegion',
    label: 'Market / region',
    type: 'DISCOVERY_FIELD',
    safeDisplay: normalizeEvidenceString(seedProfile.marketRegion),
  })
  addRef({
    refKey: 'input_targetOffer',
    label: 'Target offer',
    type: 'DISCOVERY_FIELD',
    safeDisplay: normalizeEvidenceString(seedProfile.targetOffer),
  })
  addRef({
    refKey: 'input_notes',
    label: 'Intelligence Hub notes',
    type: 'DISCOVERY_FIELD',
    safeDisplay: normalizeEvidenceString(seedProfile.notes),
  })

  if (Array.isArray(scopedView?.sourceRefs)) {
    scopedView.sourceRefs.forEach((refKey) => {
      if (!refs.some((ref) => ref.refKey === refKey)) {
        refs.push({
          refKey,
          label: 'Scoped Intelligence Hub source',
          type: 'DISCOVERY_FIELD',
          safeDisplay: 'Accepted Intelligence Hub evidence',
        })
      }
    })
  }

  return refs.slice(0, 10)
}

const buildGeneratedSections = ({ category, inputSummary, label, themes, boundaries }) => {
  const rule = SECTION_CATEGORY_RULES[category] || SECTION_CATEGORY_RULES.GENERIC
  const themeBullets = themes.slice(0, 5).map((theme) => `${theme.label}: ${theme.description}`)
  const boundaryBullets = boundaries.slice(0, 5).map((boundary) => boundary.message)
  const evidenceLead = `Based on accepted Intelligence Hub evidence${inputSummary ? ' and customer-added section context' : ''}, ${label} can safely focus on the themes below.`

  return [
    {
      heading: rule.heading,
      body: evidenceLead,
      bullets: themeBullets,
    },
    {
      heading: rule.summaryHeading,
      body: themes.length > 0
        ? 'These themes are deterministic derivations from accepted evidence and current section context. They are not quantified proof or final output assets.'
        : 'The current evidence does not yet support a safe generated section draft.',
      bullets: [],
    },
    {
      heading: 'Evidence Boundaries',
      body: 'The system did not assume proof that has not been accepted into Intelligence Hub or section truth.',
      bullets: boundaryBullets,
    },
  ]
}

const sectionsToContent = (sections = []) => sections
  .map((section) => [
    section.heading,
    section.body,
    ...(Array.isArray(section.bullets) ? section.bullets.map((bullet) => `- ${bullet}`) : []),
  ].filter(Boolean).join('\n\n'))
  .filter(Boolean)
  .join('\n\n')

const getTruthEligibility = ({ businessContextAvailable, discoveryAccepted, themes }) => {
  if (!discoveryAccepted) {
    return {
      eligible: false,
      status: 'INSUFFICIENT_EVIDENCE',
      messages: [{
        severity: 'ERROR',
        message: 'Accepted Intelligence Hub evidence is required before this section can be generated safely.',
      }],
    }
  }

  if (!businessContextAvailable || themes.length === 0) {
    return {
      eligible: false,
      status: 'INSUFFICIENT_EVIDENCE',
      messages: [{
        severity: 'WARNING',
        message: 'This section needs more accepted Intelligence Hub evidence, accepted upstream truth, or customer context before it can be accepted as truth.',
      }],
    }
  }

  return {
    eligible: true,
    status: 'ELIGIBLE',
    messages: [{
      severity: 'INFO',
      message: 'Generated section intelligence is evidence-bound and eligible for user review.',
    }],
  }
}

const buildSectionIntelligenceParts = ({
  dependencySectionKeys = [],
  frameworkPackage,
  frameworkState = {},
  generatedAt = new Date().toISOString(),
  input,
  runtimeInstance,
  section,
} = {}) => {
  const evidencePack = getEvidencePackFromFrameworkState(frameworkState)
  const sectionKey = normalizeSectionText(section?.sectionKey || section?.key)
  const runtimePath = normalizeSectionText(section?.runtimePath)
  const label = titleFromSectionKey(section?.label || sectionKey || runtimePath)
  const category = getSectionCategory({ label, sectionKey })
  const acceptedEvidenceObjects = getAcceptedDiscoveryEvidenceObjects(evidencePack)
  const acceptedSectionEvidenceObjects = getAcceptedSectionEvidenceObjects({
    frameworkState,
    runtimePath,
    sectionKey,
  })
  const seedProfile = getDiscoverySeedProfile(evidencePack)
  const scopedView = getScopedEvidenceView({ evidencePack, runtimePath, sectionKey })
  const scopedEvidenceSummary = normalizeScopedEvidenceSummary(scopedView?.summary)
  const sectionEvidenceSummary = acceptedSectionEvidenceObjects
    .map((evidenceObject) => normalizeEvidenceString(evidenceObject.extractedFact))
    .filter(Boolean)
    .join(' ')
  const inputSummary = normalizeEvidenceString(input)
  const dependencyTruths = getAcceptedDependencyTruths({
    dependencySectionKeys,
    frameworkPackage,
    frameworkState,
  })
  const themes = extractEvidenceThemes({
    acceptedEvidenceObjects,
    category,
    dependencyTruths,
    inputSummary,
    sectionEvidenceSummary,
    scopedEvidenceSummary,
    seedProfile,
  })
  const discoveryAccepted = isDiscoveryEvidenceAccepted(evidencePack)
  const businessContextAvailable = Boolean(
    acceptedEvidenceObjects.length > 0
    || acceptedSectionEvidenceObjects.length > 0
    || normalizeEvidenceString(seedProfile.targetOffer)
    || normalizeEvidenceString(seedProfile.notes)
    || scopedEvidenceSummary
    || inputSummary
    || dependencyTruths.length > 0,
  )
  const truthEligibility = getTruthEligibility({
    businessContextAvailable,
    discoveryAccepted,
    themes,
  })
  const supportingEvidence = buildSupportingEvidence({
    acceptedEvidenceObjects,
    acceptedSectionEvidenceObjects,
    dependencyTruths,
    inputSummary,
    scopedEvidenceSummary,
    seedProfile,
  })
  const generationBoundaries = buildGenerationBoundaries({
    category,
    dependencySectionKeys,
    dependencyTruths,
    inputSummary,
    truthEligible: truthEligibility.eligible,
  })
  const inputHash = hashSectionInput(input)
  const sourceRefs = buildSourceRefs({ acceptedEvidenceObjects, acceptedSectionEvidenceObjects, scopedView, seedProfile })
  const sectionEvidenceHash = hashSectionInput({
    acceptedSectionEvidenceObjectIds: acceptedSectionEvidenceObjects.map((evidenceObject) => evidenceObject.evidenceObjectId),
    acceptedSectionEvidenceSummaries: acceptedSectionEvidenceObjects.map((evidenceObject) => normalizeEvidenceString(evidenceObject.extractedFact)),
    runtimePath,
    sectionKey,
  })
  const evidenceHash = hashSectionInput({
    accepted: discoveryAccepted,
    acceptedEvidenceObjectIds: acceptedEvidenceObjects.map((evidenceObject) => evidenceObject.evidenceObjectId),
    acceptedSectionEvidenceObjectIds: acceptedSectionEvidenceObjects.map((evidenceObject) => evidenceObject.evidenceObjectId),
    scopedEvidenceSummary,
    sectionEvidenceHash,
    sourceRefs: sourceRefs.map((ref) => ref.refKey),
    supportingEvidence,
    themes: themes.map((theme) => theme.key),
  })
  const dependencyHash = hashSectionInput(dependencyTruths.map((dependency) => ({
    sectionKey: dependency.sectionKey,
    truthHash: dependency.truthHash,
    acceptedAt: dependency.acceptedAt,
    content: dependency.content,
  })))
  const boundedContextHash = hashSectionInput({
    dependencyHash,
    evidenceHash,
    inputHash,
    packageKey: runtimeInstance?.packageKey || frameworkPackage?.packageKey || '',
    packageVersion: runtimeInstance?.packageVersion || frameworkPackage?.version || '',
    sectionKey,
    version: GSIL_ENRICHMENT_VERSION,
  })

  return {
    acceptedEvidenceObjects,
    acceptedSectionEvidenceObjects,
    boundedContextHash,
    category,
    dependencyHash,
    dependencySectionKeys,
    dependencyTruths,
    discoveryAccepted,
    evidenceHash,
    evidencePack,
    generatedAt,
    generationBoundaries,
    inputHash,
    inputSummary,
    label,
    runtimePath,
    scopedEvidenceSummary,
    scopedView,
    sectionEvidenceHash,
    sectionEvidenceSummary,
    sectionKey,
    seedProfile,
    sourceRefs,
    supportingEvidence,
    themes,
    truthEligibility,
  }
}

const buildIntelligenceFromParts = ({
  actorUserId,
  generated = null,
  parts,
} = {}) => {
  const generatedSections = Array.isArray(generated?.sections) ? generated.sections : []
  const generatedSummary = normalizeEvidenceString(generated?.summary)
  const evidenceThemeBullets = parts.themes.map((theme) => theme.label)
  const confidenceSignals = [
    parts.discoveryAccepted ? 'Intelligence Hub evidence is accepted.' : 'Intelligence Hub evidence has not been accepted.',
    parts.acceptedSectionEvidenceObjects.length > 0 ? 'Accepted section evidence is available.' : 'No accepted section evidence was used for this section.',
    parts.inputSummary ? 'Customer-added section context is available.' : 'No customer-added section context has been provided.',
    parts.dependencyTruths.length > 0
      ? 'Accepted upstream truth is available.'
      : 'No accepted upstream truth was used for this section.',
    parts.generationBoundaries.length > 0
      ? 'Evidence boundaries are recorded.'
      : 'No evidence boundaries were recorded.',
  ]

  return {
    sourceProjection: {
      summary: parts.themes.length > 0
        ? 'Accepted Intelligence Hub evidence has been interpreted into section-relevant evidence themes.'
        : 'Accepted Intelligence Hub evidence is not yet sufficient to project section themes.',
      themes: parts.themes,
      generatedAt: parts.generatedAt,
      projectionHash: parts.evidenceHash,
    },
    scopedEvidence: {
      evidencePackVersion: parts.evidencePack?.lineage?.builder?.version || '',
      scopedViewKey: parts.sectionKey,
      sourceRefs: parts.sourceRefs,
      evidenceHash: parts.evidenceHash,
      sectionEvidenceHash: parts.sectionEvidenceHash,
    },
    derivedSignals: confidenceSignals.map((description, index) => ({
      signalKey: `signal_${index + 1}`,
      label: description.replace(/\.$/, ''),
      description,
      derivationType: 'DETERMINISTIC',
      supportLevel: description.startsWith('No ') ? 'WEAK' : 'DIRECT',
    })),
    generationBoundaries: parts.generationBoundaries,
    supportingEvidence: parts.supportingEvidence,
    truthEligibility: parts.truthEligibility,
    boundedContext: {
      sectionKey: parts.sectionKey,
      runtimePath: parts.runtimePath,
      inputHash: parts.inputHash,
      evidenceHash: parts.evidenceHash,
      sectionEvidenceHash: parts.sectionEvidenceHash,
      dependencyHash: parts.dependencyHash,
      boundedContextHash: parts.boundedContextHash,
    },
    displayProjection: {
      suggestedFromDiscovery: {
        title: 'Evidence Themes',
        summary: parts.discoveryAccepted && parts.themes.length > 0
          ? 'The available accepted evidence supports these section-relevant themes.'
          : 'This section needs more accepted evidence before themes can be projected safely.',
        bullets: evidenceThemeBullets,
        evidenceScope: parts.discoveryAccepted
          ? 'Derived from accepted Intelligence Hub evidence and current section dependencies.'
          : 'Intelligence Hub evidence is not yet accepted.',
      },
      generatedInsight: generated
        ? {
            title: parts.truthEligibility.eligible ? 'Generated Insight' : 'Insufficient Evidence',
            summary: generatedSummary || generated.content || '',
            sections: generatedSections,
          }
        : {
            title: 'Generated Insight',
            summary: 'Generate this section to create evidence-bound section intelligence.',
            sections: [],
          },
      supportingEvidence: {
        title: 'Supporting Evidence',
        items: parts.supportingEvidence.map((item) => `${item.label}: ${item.summary}`),
      },
      boundaries: {
        title: 'Boundaries / Not Assumed',
        items: parts.generationBoundaries.map((boundary) => boundary.message),
      },
      confidence: {
        label: parts.truthEligibility.eligible
          ? parts.themes.length >= 4 ? 'Medium' : 'Low'
          : 'Low',
        signals: confidenceSignals,
      },
    },
    tokenSafety: {
      tokenClass: parts.truthEligibility.eligible ? 'B_LIGHT_SYNTHESIS' : 'A_DETERMINISTIC',
      boundedContextHash: parts.boundedContextHash,
      usedFullRuntime: false,
      usedFullEvidenceCorpus: false,
      sectionOnly: true,
    },
    enrichmentVersion: GSIL_ENRICHMENT_VERSION,
    updatedAt: parts.generatedAt,
    updatedBy: actorUserId ? String(actorUserId) : '',
  }
}

export const buildSectionIntelligenceDisplayProjection = ({
  actorUserId,
  dependencySectionKeys = [],
  frameworkPackage,
  frameworkState = {},
  generated = null,
  generatedAt = new Date().toISOString(),
  input,
  runtimeInstance,
  section,
} = {}) => {
  const parts = buildSectionIntelligenceParts({
    dependencySectionKeys,
    frameworkPackage,
    frameworkState,
    generatedAt,
    input,
    runtimeInstance,
    section,
  })

  return buildIntelligenceFromParts({ actorUserId, generated, parts })
}

export const buildEnrichedGeneratedSection = ({
  actionKey,
  actorUserId,
  dependencySectionKeys = [],
  frameworkPackage,
  frameworkState = {},
  input,
  runtimeInstance,
  section,
  generatedAt = new Date().toISOString(),
} = {}) => {
  const parts = buildSectionIntelligenceParts({
    dependencySectionKeys,
    frameworkPackage,
    frameworkState,
    generatedAt,
    input,
    runtimeInstance,
    section,
  })
  const sections = parts.truthEligibility.eligible
    ? buildGeneratedSections({
        category: parts.category,
        inputSummary: parts.inputSummary,
        label: parts.label,
        themes: parts.themes,
        boundaries: parts.generationBoundaries,
      })
    : [{
        heading: 'Insufficient Evidence',
        body: 'Evidence not sufficient to derive this section safely.',
        bullets: [
          'Add more accepted Intelligence Hub evidence, accepted upstream truth, or customer context.',
          ...parts.generationBoundaries.slice(0, 4).map((boundary) => boundary.message),
        ],
      }]
  const content = sectionsToContent(sections)
  const generated = {
    format: 'STRUCTURED_TEXT',
    content,
    summary: parts.truthEligibility.eligible
      ? `Generated ${parts.label} from accepted evidence-bound section context.`
      : 'Evidence not sufficient to derive this section safely.',
    sections,
    supportingEvidenceRefs: parts.supportingEvidence.map((item) => item.refKey),
    generationBoundaries: parts.generationBoundaries.map((boundary) => boundary.message),
    generatedAt,
    generatedBy: actorUserId ? String(actorUserId) : '',
    actionKey,
    inputHash: parts.inputHash,
    evidenceHash: parts.evidenceHash,
    sectionEvidenceHash: parts.sectionEvidenceHash,
    dependencyHash: parts.dependencyHash,
    boundedContextHash: parts.boundedContextHash,
    truthEligibility: parts.truthEligibility,
    generator: {
      mode: 'DETERMINISTIC_PLUS_BOUNDED_SYNTHESIS',
      adapter: GSIL_ENRICHMENT_VERSION,
      packageKey: runtimeInstance?.packageKey || frameworkPackage?.packageKey || '',
      packageVersion: runtimeInstance?.packageVersion || frameworkPackage?.version || '',
    },
  }
  const intelligence = buildIntelligenceFromParts({ actorUserId, generated, parts })

  return { generated, intelligence }
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
  accepted,
  generated,
  reason = '',
  revisionNumber,
  replacedAt = new Date().toISOString(),
} = {}) => {
  const revision = {
    revisionNumber,
    replacedAt,
  }

  if (generated !== undefined) revision.generated = cloneSectionValue(generated)
  if (accepted !== undefined) revision.accepted = cloneSectionValue(accepted)
  if (reason) revision.reason = reason

  return revision
}

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
