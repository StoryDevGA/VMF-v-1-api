import crypto from 'node:crypto'
import {
  DISCOVERY_EVIDENCE_REVIEW_STATUSES,
  isGovernedDiscoveryEvidenceFact,
  normalizeDiscoveryEvidenceObjects,
} from './discoveryIntelligenceService.js'
import {
  SECTION_COMPLETENESS_BINDING,
} from './sectionValidationExecutorService.js'

export const RUNTIME_SECTION_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  GENERATED: 'GENERATED',
  REGENERATED: 'REGENERATED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  ACCEPTED: 'ACCEPTED',
  REVIEW_PENDING: 'REVIEW_PENDING',
})

export const SECTION_INTERPRETATION_SIMILARITY_POLICY = Object.freeze({
  algorithm: 'TOKEN_JACCARD',
  version: 'business-interpretation-token-jaccard-v1',
  threshold: 0.85,
  maxPeerCount: 50,
  excludedFields: Object.freeze([
    'sourceRefs',
    'supportingEvidenceRefs',
    'supportingEvidence',
    'generationBoundaries',
    'hashes',
    'timestamps',
    'sectionIdentity',
  ]),
})

export const CURRENT_SECTION_INTERPRETATION_SIMILARITY_POLICY = Object.freeze({
  ...SECTION_INTERPRETATION_SIMILARITY_POLICY,
  version: 'business-interpretation-token-jaccard-v2',
  threshold: 0.75,
})

const SECTION_SIMILARITY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can',
  'for', 'from', 'has', 'have', 'in', 'into', 'is', 'it', 'of', 'on', 'or',
  'that', 'the', 'their', 'these', 'this', 'those', 'to', 'was', 'were',
  'will', 'with',
])

const SECTION_SIMILARITY_EXCLUDED_HEADINGS = new Set([
  'customer provided section context',
  'customer provided section evidence',
  'supporting evidence',
  'evidence boundaries',
  'boundaries not assumed',
])

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
const GSIL_PROFILE_ENRICHMENT_VERSION = 'gsil-section-enrichment-v2'

const CURRENT_SECTION_INTERPRETATION_PROFILES = Object.freeze({
  'skill-customer-context-interpreter@1': Object.freeze({
    key: 'customer-context',
    semanticType: 'CUSTOMER_CONTEXT',
    sectionKey: 'customer_context',
    runtimePath: 'framework_state.sections.customer_context',
  }),
  'skill-strategic-objective-modeller@1': Object.freeze({
    key: 'strategic-objectives',
    semanticType: 'STRATEGIC_OBJECTIVES',
    sectionKey: 'strategic_objectives',
    runtimePath: 'framework_state.sections.strategic_objectives',
  }),
  'skill-current-state-diagnoser@1': Object.freeze({
    key: 'current-state-assessment',
    semanticType: 'CURRENT_STATE_ASSESSMENT',
    sectionKey: 'current_state_assessment',
    runtimePath: 'framework_state.sections.current_state_assessment',
  }),
  'skill-stakeholder-register-builder@1': Object.freeze({
    key: 'stakeholder-register',
    semanticType: 'STAKEHOLDER_REGISTER',
    sectionKey: 'stakeholder_register',
    runtimePath: 'framework_state.sections.stakeholder_register',
  }),
  'skill-evidence-register-curator@1': Object.freeze({
    key: 'evidence-register',
    semanticType: 'EVIDENCE_REGISTER',
    sectionKey: 'evidence_register',
    runtimePath: 'framework_state.sections.evidence_register',
  }),
  'skill-output-requirements-capturer@1': Object.freeze({
    key: 'output-requirements',
    semanticType: 'OUTPUT_REQUIREMENTS',
    sectionKey: 'output_requirements',
    runtimePath: 'framework_state.sections.output_requirements',
  }),
})

const CURRENT_SECTION_INTERPRETATION_STABLE_IDS = new Set(
  Object.keys(CURRENT_SECTION_INTERPRETATION_PROFILES)
    .map((selectionKey) => selectionKey.split('@')[0]),
)

const CURRENT_PROFILE_VERIFICATION_BOUNDARIES = Object.freeze([
  'Verify direct support before using quantified commercial claims.',
  'Confirm source permission before using named customer examples.',
  'Verify sources before relying on external market validation.',
])

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

const normalizeSectionIdentityKey = (value) =>
  normalizeSectionText(value).toLowerCase().replace(/-/g, '_')

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

const isCompleteObjectContract = (value) =>
  isPlainObject(value)
  && normalizeSectionText(value.type).toLowerCase() === 'object'
  && Array.isArray(value.required)
  && value.required.some((field) => normalizeSectionText(field))
  && isPlainObject(value.properties)
  && Object.keys(value.properties).length > 0

const buildSectionInterpretationContractMismatch = (mismatchFields = []) => {
  const err = new Error(
    'Runtime section generation is blocked because the section interpretation contract is incomplete or incompatible.',
  )
  err.status = 409
  err.code = 'CONFLICT'
  err.details = {
    reason: 'RUNTIME_ACTION_NOT_AVAILABLE',
    contractIssue: 'SECTION_INTERPRETATION_CONTRACT_MISMATCH',
    mismatchFields: [...new Set(mismatchFields)].sort(),
  }
  return err
}

const validateCurrentSectionInterpretationContract = ({
  profile,
  section = {},
  sectionExecutionContract = {},
}) => {
  const mismatchFields = []
  const sectionIdentity = isPlainObject(sectionExecutionContract.sectionIdentity)
    ? sectionExecutionContract.sectionIdentity
    : {}
  const runtimeInstructions = isPlainObject(sectionExecutionContract.runtimeInstructions)
    ? sectionExecutionContract.runtimeInstructions
    : {}
  const constraints = isPlainObject(runtimeInstructions.constraints)
    ? runtimeInstructions.constraints
    : {}
  const profileSectionKey = normalizeSectionIdentityKey(profile.sectionKey)
  const contractSectionKey = normalizeSectionIdentityKey(sectionIdentity.sectionKey)
  const contractRuntimePath = normalizeSectionText(sectionIdentity.runtimePath).toLowerCase()
  const actualSectionKey = normalizeSectionIdentityKey(section?.sectionKey || section?.key)
  const actualRuntimePath = normalizeSectionText(section?.runtimePath).toLowerCase()

  if (!normalizeSectionText(sectionExecutionContract.contractVersion)) {
    mismatchFields.push('CONTRACT_VERSION_REQUIRED')
  }
  if (!normalizeSectionText(sectionExecutionContract.sectionContractHash)) {
    mismatchFields.push('CONTRACT_HASH_REQUIRED')
  }
  if (!contractSectionKey) mismatchFields.push('CONTRACT_SECTION_KEY_REQUIRED')
  if (!contractRuntimePath) mismatchFields.push('CONTRACT_RUNTIME_PATH_REQUIRED')
  if (!actualSectionKey) mismatchFields.push('ACTUAL_SECTION_KEY_REQUIRED')
  if (!actualRuntimePath) mismatchFields.push('ACTUAL_RUNTIME_PATH_REQUIRED')
  if (contractSectionKey && contractSectionKey !== profileSectionKey) {
    mismatchFields.push('PROFILE_CONTRACT_SECTION_KEY_MISMATCH')
  }
  if (contractRuntimePath && contractRuntimePath !== profile.runtimePath) {
    mismatchFields.push('PROFILE_CONTRACT_RUNTIME_PATH_MISMATCH')
  }
  if (actualSectionKey && actualSectionKey !== profileSectionKey) {
    mismatchFields.push('PROFILE_ACTUAL_SECTION_KEY_MISMATCH')
  }
  if (actualRuntimePath && actualRuntimePath !== profile.runtimePath) {
    mismatchFields.push('PROFILE_ACTUAL_RUNTIME_PATH_MISMATCH')
  }
  if (contractSectionKey && actualSectionKey && contractSectionKey !== actualSectionKey) {
    mismatchFields.push('CONTRACT_ACTUAL_SECTION_KEY_MISMATCH')
  }
  if (contractRuntimePath && actualRuntimePath && contractRuntimePath !== actualRuntimePath) {
    mismatchFields.push('CONTRACT_ACTUAL_RUNTIME_PATH_MISMATCH')
  }
  if (!normalizeSectionText(sectionIdentity.purpose)) {
    mismatchFields.push('SECTION_PURPOSE_REQUIRED')
  }
  if (!normalizeSectionText(runtimeInstructions.description)) {
    mismatchFields.push('RUNTIME_DESCRIPTION_REQUIRED')
  }
  if (!normalizeSectionText(runtimeInstructions.skillRoleKey)) {
    mismatchFields.push('RUNTIME_SKILL_ROLE_REQUIRED')
  }
  if (!normalizeSectionText(runtimeInstructions.category)) {
    mismatchFields.push('RUNTIME_CATEGORY_REQUIRED')
  }
  if (!isCompleteObjectContract(runtimeInstructions.inputContract)) {
    mismatchFields.push('INPUT_CONTRACT_INCOMPLETE')
  }
  if (!isCompleteObjectContract(runtimeInstructions.outputContract)) {
    mismatchFields.push('OUTPUT_CONTRACT_INCOMPLETE')
  }
  if (
    !Array.isArray(constraints.allowedReadPaths)
    || !constraints.allowedReadPaths.some((path) => normalizeSectionText(path))
  ) {
    mismatchFields.push('ALLOWED_READ_PATHS_REQUIRED')
  }
  if (!Array.isArray(constraints.allowedWritePaths)) {
    mismatchFields.push('ALLOWED_WRITE_PATHS_REQUIRED')
  } else if (!constraints.allowedWritePaths.some((path) =>
    normalizeSectionText(path).toLowerCase() === profile.runtimePath)) {
    mismatchFields.push('TARGET_WRITE_PATH_REQUIRED')
  }
  if (!Array.isArray(constraints.forbiddenWritePaths)) {
    mismatchFields.push('FORBIDDEN_WRITE_PATHS_REQUIRED')
  }

  const validationRules = Array.isArray(sectionExecutionContract.validationRules)
    ? sectionExecutionContract.validationRules
    : []
  if (validationRules.length === 0) {
    mismatchFields.push('VALIDATION_RULE_REQUIRED')
  } else if (validationRules.some((rule) =>
    !normalizeSectionText(rule?.stableId)
    || !normalizeSectionText(rule?.key)
    || !Number.isInteger(Number(rule?.componentVersion))
    || Number(rule?.componentVersion) <= 0
    || !normalizeSectionText(rule?.category)
    || !normalizeSectionText(rule?.severity)
    || !normalizeSectionText(rule?.executionMode)
    || rule?.packageUsable !== true)) {
    mismatchFields.push('VALIDATION_RULE_INCOMPLETE')
  }

  const executableCompletenessRules = validationRules.filter((rule) =>
    normalizeSectionText(rule?.stableId).toLowerCase()
      === SECTION_COMPLETENESS_BINDING.validationStableId
    && normalizeSectionText(rule?.key).toLowerCase()
      === SECTION_COMPLETENESS_BINDING.validationKey
    && Number(rule?.componentVersion)
      === SECTION_COMPLETENESS_BINDING.validationComponentVersion
    && rule?.metadataOnlyDuringGeneration === false)
  if (executableCompletenessRules.length !== 1) {
    mismatchFields.push('EXECUTABLE_VALIDATION_RULE_REQUIRED')
  } else {
    const executableRule = executableCompletenessRules[0]
    const executionBinding = isPlainObject(executableRule.executionBinding)
      ? executableRule.executionBinding
      : {}
    const producerSkill = isPlainObject(executableRule.producerSkill)
      ? executableRule.producerSkill
      : {}
    if (
      normalizeSectionText(executionBinding.selectionKey)
        !== SECTION_COMPLETENESS_BINDING.selectionKey
      || normalizeSectionText(executionBinding.executorVersion)
        !== SECTION_COMPLETENESS_BINDING.executorVersion
      || normalizeSectionText(executionBinding.mode)
        !== 'SERVER_SYSTEM_DETERMINISTIC'
      || normalizeSectionText(producerSkill.stableId).toLowerCase()
        !== SECTION_COMPLETENESS_BINDING.producerSkillStableId
      || normalizeSectionText(producerSkill.key).toLowerCase()
        !== SECTION_COMPLETENESS_BINDING.producerSkillKey
      || Number(producerSkill.componentVersion)
        !== SECTION_COMPLETENESS_BINDING.producerSkillComponentVersion
    ) {
      mismatchFields.push('VALIDATION_EXECUTION_BINDING_INCOMPLETE')
    }
  }

  if (mismatchFields.length > 0) {
    throw buildSectionInterpretationContractMismatch(mismatchFields)
  }
}

const resolveSectionInterpretationProfile = (
  sectionExecutionContract = {},
  section = {},
) => {
  const stableId = normalizeSectionText(
    sectionExecutionContract?.runtimeInstructions?.stableId,
  ).toLowerCase()
  const rawComponentVersion =
    sectionExecutionContract?.runtimeInstructions?.componentVersion
  const componentVersion = Number(rawComponentVersion)

  if (!CURRENT_SECTION_INTERPRETATION_STABLE_IDS.has(stableId)) return null

  const selectionKey = `${stableId}@${componentVersion}`
  const registeredProfile = CURRENT_SECTION_INTERPRETATION_PROFILES[selectionKey]
  if (!registeredProfile) {
    const err = new Error(
      'Runtime section generation is blocked because the resolved skill version has no compatible interpretation profile.',
    )
    err.status = 409
    err.code = 'CONFLICT'
    err.details = {
      reason: 'RUNTIME_ACTION_NOT_AVAILABLE',
      contractIssue: 'SECTION_INTERPRETATION_PROFILE_UNSUPPORTED',
      skillStableId: stableId,
      skillComponentVersion:
        Number.isInteger(componentVersion) && componentVersion > 0
          ? componentVersion
          : rawComponentVersion || null,
      supportedSelectionKeys: Object.keys(CURRENT_SECTION_INTERPRETATION_PROFILES)
        .filter((key) => key.startsWith(`${stableId}@`)),
    }
    throw err
  }

  const profile = {
    ...registeredProfile,
    selectionKey,
    skillStableId: stableId,
    skillComponentVersion: componentVersion,
  }
  validateCurrentSectionInterpretationContract({
    profile,
    section,
    sectionExecutionContract,
  })
  return profile
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
  const companyName = normalizeEvidenceString(seedProfile.companyName)
  const marketRegion = normalizeEvidenceString(seedProfile.marketRegion)
  const targetOffer = normalizeEvidenceString(seedProfile.targetOffer)
  const notes = normalizeEvidenceString(seedProfile.notes)
  const sourceGroups = [
    {
      sourceClass: 'ACCEPTED_SECTION_EVIDENCE',
      items: acceptedSectionEvidenceObjects.map((evidenceObject) => ({
        label: evidenceObject.category || 'Accepted section evidence',
        summary: normalizeEvidenceString(evidenceObject.extractedFact),
        sourceType: 'SECTION_EVIDENCE_OBJECT',
        refKey: evidenceObject.evidenceObjectId || evidenceObject.lineageRef || evidenceObject.sourceId,
      })),
    },
    {
      sourceClass: 'ACCEPTED_DISCOVERY_EVIDENCE',
      items: acceptedEvidenceObjects.map((evidenceObject) => ({
        label: evidenceObject.category || 'Accepted evidence',
        summary: normalizeEvidenceString(evidenceObject.extractedFact),
        sourceType: 'DISCOVERY_EVIDENCE_OBJECT',
        refKey: evidenceObject.evidenceObjectId || evidenceObject.lineageRef || evidenceObject.sourceId,
      })),
    },
    {
      sourceClass: 'ACCEPTED_DEPENDENCY_TRUTH',
      items: dependencyTruths.map((dependency) => ({
        label: `Accepted truth: ${dependency.label}`,
        summary: dependency.content,
        sourceType: 'DEPENDENCY',
        refKey: `accepted_${dependency.sectionKey}`,
      })),
    },
    {
      sourceClass: 'EXPLICIT_SECTION_INPUT',
      items: inputSummary ? [{
        label: 'Customer section context',
        summary: inputSummary,
        sourceType: 'USER_CONTEXT',
        refKey: 'section_input',
      }] : [],
    },
    {
      sourceClass: 'SCOPED_EVIDENCE_VIEW',
      items: scopedEvidenceSummary ? [{
        label: 'Section-scoped evidence view',
        summary: scopedEvidenceSummary,
        sourceType: 'DISCOVERY',
        refKey: 'scoped_view',
      }] : [],
    },
    {
      sourceClass: 'COMPANY_NAME',
      items: companyName ? [{
      label: 'Company context',
      summary: companyName,
      sourceType: 'DISCOVERY',
      refKey: 'input_companyName',
      }] : [],
    },
    {
      sourceClass: 'TARGET_OFFER',
      items: targetOffer ? [{
      label: 'Target offer',
      summary: targetOffer,
      sourceType: 'DISCOVERY',
      refKey: 'input_targetOffer',
      }] : [],
    },
    {
      sourceClass: 'MARKET_REGION',
      items: marketRegion ? [{
      label: 'Market / region',
      summary: marketRegion,
      sourceType: 'DISCOVERY',
      refKey: 'input_marketRegion',
      }] : [],
    },
    {
      sourceClass: 'INTELLIGENCE_NOTES',
      items: notes ? [{
      label: 'Intelligence Hub notes',
      summary: notes,
      sourceType: 'DISCOVERY',
      refKey: 'input_notes',
      }] : [],
    },
  ]
  const seen = new Set()
  const selected = []
  const addItem = (sourceClass, item) => {
    const summary = normalizeEvidenceString(item?.summary)
    const refKey = normalizeSectionText(item?.refKey)
    if (!summary || !refKey || selected.length >= 10) return
    const dedupeKey = [
      sourceClass,
      refKey.toLowerCase(),
      normalizeSimilarityText(summary),
    ].join('|')
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    selected.push({ ...item, summary, refKey })
  }

  sourceGroups.forEach(({ sourceClass, items }) => {
    const first = items.find((item) =>
      normalizeEvidenceString(item?.summary) && normalizeSectionText(item?.refKey))
    if (first) addItem(sourceClass, first)
  })
  sourceGroups.forEach(({ sourceClass, items }) => {
    items.slice(1).forEach((item) => addItem(sourceClass, item))
  })

  return selected
}

const buildGenerationBoundaries = ({
  category,
  dependencySectionKeys,
  dependencyTruths,
  inputSummary,
  useVerificationLanguage = false,
  truthEligible,
}) => {
  const rule = SECTION_CATEGORY_RULES[category] || SECTION_CATEGORY_RULES.GENERIC
  const boundaryMessages = useVerificationLanguage
    ? CURRENT_PROFILE_VERIFICATION_BOUNDARIES
    : rule.boundaries
  const boundaries = boundaryMessages.map((message, index) => ({
    boundaryKey: `${category.toLowerCase()}_boundary_${index + 1}`,
    message,
    reason: 'UNSUPPORTED_CLAIM',
  }))

  if (!inputSummary) {
    boundaries.push({
      boundaryKey: 'no_customer_section_context',
      message: useVerificationLanguage
        ? 'Add section-specific customer context if it is needed to complete this interpretation.'
        : 'No customer-added section context has been provided.',
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

const buildSourceRefs = ({ supportingEvidence = [] }) =>
  supportingEvidence.map((item) => ({
    refKey: item.refKey,
    label: item.label,
    type: item.sourceType === 'DISCOVERY'
      ? 'DISCOVERY_FIELD'
      : item.sourceType,
    safeDisplay: item.summary,
  }))

const PROFILE_EVIDENCE_SOURCE_LIMITS = Object.freeze({
  ACCEPTED_SECTION_EVIDENCE: 8,
  ACCEPTED_DISCOVERY_EVIDENCE: 10,
  ACCEPTED_DEPENDENCY_TRUTH: 8,
  EXPLICIT_SECTION_INPUT: 6,
  SCOPED_EVIDENCE_VIEW: 4,
  COMPANY_NAME: 1,
  TARGET_OFFER: 1,
  MARKET_REGION: 1,
  INTELLIGENCE_NOTES: 1,
})

const PROFILE_FACT_CATEGORY_ORDER = Object.freeze([
  'CUSTOMER_CONTEXT',
  'OBJECTIVE_OWNER',
  'OBJECTIVE_OUTCOME',
  'OBJECTIVE_HORIZON',
  'CURRENT_BASELINE',
  'CURRENT_FRICTION',
  'STAKEHOLDER_ROLE',
  'OUTPUT_AUDIENCE',
  'OUTPUT_FORMAT',
  'OUTPUT_CHANNEL',
  'OUTPUT_TIMING_APPROVAL',
])

const getProfileEvidenceSignals = (text = '') => {
  const hasCustomerContext =
    /\b(customer|company|account|business model|operating context|offer|product|market|region|segment|industry)\b/i.test(text)
  const hasObjectiveOwner = /\b(owner|owns|sponsor|accountable|responsible)\b/i.test(text)
  const hasObjectiveOutcome =
    /\b(success|outcome|goal|objective|priority|metric|percent|reduction|increase)\b|%/i.test(text)
    || (/\btarget\b/i.test(text) && !/\btarget offer\b/i.test(text))
  const hasObjectiveHorizon =
    /\b(q[1-4]|quarter|deadline|horizon|within\s+\d+|by\s+(?:\d{4}|[a-z]+\s+\d{1,2}))\b/i.test(text)
  const hasCurrentBaseline =
    /\b(current|currently|today|existing|baseline|capability|maturity|status quo)\b/i.test(text)
  const hasCurrentFriction =
    /\b(manual|rework|slow|friction|delay|bottleneck|constraint|risk|weakness|limitation|cost|effort)\b/i.test(text)
  const hasExecutiveRole = /\b(cfo|ceo|coo|cto|cio)\b/i.test(text)
  const hasNamedPerson =
    /\b[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?\s+[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?\b/.test(text)
  const hasStakeholderRole =
    /\b(owner|owns|sponsor|stakeholder|buyer|approver|decision maker|user)\b/i.test(text)
    || (hasExecutiveRole && /\b(audience|recipient|reader|decision|approve|buyer)\b/i.test(text))
  const hasExplicitOutputContext =
    /\b(output|deliverable|delivery|brief|presentation|format|audience|recipient|reader)\b/i.test(text)
  const hasOutputAudience =
    /\b(audience|reader|recipient)\b/i.test(text)
    || (hasExecutiveRole && /\b(output|deliverable|delivery|brief|report|presentation)\b/i.test(text))
  const hasOutputFormat =
    /\b(pdf|docx|ppt|presentation|brief|page|two-page|format|length)\b/i.test(text)
    || (/\breport\b/i.test(text) && hasExplicitOutputContext)
  const hasOutputChannel = /\b(email|portal|download|channel|send|sent|deliver|delivery)\b/i.test(text)
  const hasOutputTimingApproval = /\b(tone|deadline|due|approval|approved|sign-off)\b/i.test(text)

  return {
    hasCustomerContext,
    hasExecutiveRole,
    hasExplicitOutputContext,
    hasNamedPerson,
    hasObjectiveHorizon,
    hasObjectiveOutcome,
    hasObjectiveOwner,
    hasCurrentBaseline,
    hasCurrentFriction,
    hasOutputAudience,
    hasOutputChannel,
    hasOutputFormat,
    hasOutputTimingApproval,
    hasStakeholderRole,
  }
}

const getProfileEvidenceSemanticFamilies = (text = '') => {
  const signals = getProfileEvidenceSignals(text)
  return new Set([
    signals.hasCustomerContext ? 'CUSTOMER' : '',
    signals.hasObjectiveOwner || signals.hasObjectiveOutcome ? 'OBJECTIVE' : '',
    signals.hasCurrentBaseline || signals.hasCurrentFriction ? 'CURRENT_STATE' : '',
    signals.hasStakeholderRole
      && (signals.hasNamedPerson || signals.hasExecutiveRole)
      ? 'STAKEHOLDER'
      : '',
    signals.hasOutputAudience
      || signals.hasOutputFormat
      || (signals.hasOutputChannel && signals.hasExplicitOutputContext)
      || (signals.hasOutputTimingApproval && signals.hasExplicitOutputContext)
      ? 'OUTPUT'
      : '',
  ].filter(Boolean))
}

const splitIndependentProfileClauses = (candidate = '') => {
  const clauses = candidate
    .split(/\s*(?:,|\band\b|\bbut\b|\bwhile\b|\bwhereas\b)\s*/i)
    .map((clause) => clause.trim())
    .filter(Boolean)
  if (clauses.length < 2) return [candidate]

  const familySets = clauses.map(getProfileEvidenceSemanticFamilies)
  const signalledClauseCount = familySets.filter((families) => families.size > 0).length

  return signalledClauseCount >= 2 ? clauses : [candidate]
}

const splitProfileEvidenceSentences = (value) => {
  const normalized = normalizeEvidenceString(value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return []
  return normalized
    .split(/(?:\r?\n|[.?!;])+/)
    .map((candidate) => candidate.trim())
    .filter(Boolean)
}

const buildProfileEvidenceCandidates = ({
  acceptedEvidenceObjects = [],
  acceptedSectionEvidenceObjects = [],
  dependencyTruths = [],
  inputSummary,
  scopedEvidenceSummary,
  seedProfile = {},
}) => {
  const groups = [
    {
      sourceClass: 'ACCEPTED_SECTION_EVIDENCE',
      values: acceptedSectionEvidenceObjects.flatMap((evidenceObject) =>
        splitProfileEvidenceSentences(evidenceObject?.extractedFact)),
      fragment: true,
    },
    {
      sourceClass: 'ACCEPTED_DISCOVERY_EVIDENCE',
      values: acceptedEvidenceObjects.flatMap((evidenceObject) =>
        splitProfileEvidenceSentences(evidenceObject?.extractedFact)),
      fragment: true,
    },
    {
      sourceClass: 'ACCEPTED_DEPENDENCY_TRUTH',
      values: dependencyTruths.flatMap((dependency) =>
        splitProfileEvidenceSentences(dependency?.content)),
      fragment: true,
    },
    {
      sourceClass: 'EXPLICIT_SECTION_INPUT',
      values: splitProfileEvidenceSentences(inputSummary),
      fragment: true,
    },
    {
      sourceClass: 'SCOPED_EVIDENCE_VIEW',
      values: splitProfileEvidenceSentences(scopedEvidenceSummary),
      fragment: true,
    },
    {
      sourceClass: 'COMPANY_NAME',
      values: [normalizeEvidenceString(seedProfile.companyName)].filter(Boolean),
      fragment: false,
    },
    {
      sourceClass: 'TARGET_OFFER',
      values: [normalizeEvidenceString(seedProfile.targetOffer)].filter(Boolean),
      fragment: false,
    },
    {
      sourceClass: 'MARKET_REGION',
      values: [normalizeEvidenceString(seedProfile.marketRegion)].filter(Boolean),
      fragment: false,
    },
    {
      sourceClass: 'INTELLIGENCE_NOTES',
      values: splitProfileEvidenceSentences(seedProfile.notes),
      fragment: true,
    },
  ]
  const seen = new Set()
  const candidates = []

  groups.forEach(({ fragment, sourceClass, values }) => {
    const limit = PROFILE_EVIDENCE_SOURCE_LIMITS[sourceClass] || 0
    values.slice(0, limit).forEach((value, sourceIndex) => {
      const fragments = fragment ? splitIndependentProfileClauses(value) : [value]
      fragments.forEach((text) => {
        const boundedText = text.slice(0, 400)
        const normalizedText = normalizeSimilarityText(boundedText)
        if (!normalizedText || seen.has(normalizedText) || candidates.length >= 40) return
        seen.add(normalizedText)
        candidates.push({
          sourceClass,
          sourceIndex,
          text: boundedText,
        })
      })
    })
  })

  return candidates
}

const isNegatedOrUnconfirmedProfileFact = (text) =>
  /\b(no|not|without|never|unknown|unconfirmed|pending|tbc)\b|not yet/i.test(text)

const PROFILE_PRIMARY_SEMANTIC_FAMILIES = Object.freeze([
  'OBJECTIVE',
  'CURRENT_STATE',
  'OUTPUT',
])

const profileFamiliesAreAllowed = (families, allowedFamilies = []) =>
  [...families].every((family) => allowedFamilies.includes(family))

const hasAmbiguousPrimaryProfileFamilies = (families) =>
  PROFILE_PRIMARY_SEMANTIC_FAMILIES
    .filter((family) => families.has(family))
    .length >= 2

const buildProfileIdentityRoleProjection = (candidate) => {
  const text = candidate?.text || ''
  const collectMatches = (pattern, normalize = (value) => value) =>
    [...text.matchAll(pattern)].map((match) => ({
      index: match.index || 0,
      value: normalize(match[0]),
    }))
  const dedupeInSourceOrder = (values = [], limit = 3) => {
    const seen = new Set()
    return values
      .sort((left, right) => left.index - right.index)
      .filter(({ value }) => {
        const normalized = normalizeSimilarityText(value)
        if (!normalized || seen.has(normalized)) return false
        seen.add(normalized)
        return true
      })
      .slice(0, limit)
  }
  const identities = dedupeInSourceOrder([
    ...collectMatches(
      /\b[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?\s+[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?\b/g,
    ),
    ...collectMatches(/\b(?:CFO|CEO|COO|CTO|CIO)\b/g),
  ])
  const roles = dedupeInSourceOrder(
    collectMatches(
      /\b(?:decision maker|owner|owns|sponsor|stakeholder|buyer|approver|user|audience|reader|recipient)\b/gi,
      (value) => value.toLowerCase() === 'owns' ? 'owner' : value.toLowerCase(),
    ),
  )
  if (identities.length === 0 || roles.length === 0) return null

  const seenAssociations = new Set()
  const associations = identities.flatMap((identity) => {
    const nearestRole = roles
      .map((role) => ({
        ...role,
        distance: Math.abs(identity.index - role.index),
      }))
      .sort((left, right) =>
        left.distance - right.distance || left.index - right.index)[0]
    if (!nearestRole) return []
    const textProjection = `${identity.value} \u2014 ${nearestRole.value}`
    const normalizedProjection = normalizeSimilarityText(textProjection)
    if (!normalizedProjection || seenAssociations.has(normalizedProjection)) return []
    seenAssociations.add(normalizedProjection)
    return [{
      ...candidate,
      text: textProjection,
    }]
  })

  return associations.length > 0 ? associations : null
}

const classifyProfileEvidenceCandidates = (candidates = []) => {
  const categories = Object.fromEntries(
    PROFILE_FACT_CATEGORY_ORDER.map((category) => [category, []]),
  )
  const add = (category, candidate) => {
    if (!categories[category] || categories[category].length >= 3) return
    const normalizedText = normalizeSimilarityText(candidate.text)
    if (categories[category].some((row) =>
      normalizeSimilarityText(row.text) === normalizedText)) return
    categories[category].push(candidate)
  }

  candidates.forEach((candidate) => {
    const text = candidate.text
    if (isNegatedOrUnconfirmedProfileFact(text)) return
    const sourceClass = candidate.sourceClass
    const signals = getProfileEvidenceSignals(text)
    const families = getProfileEvidenceSemanticFamilies(text)
    if (['COMPANY_NAME', 'TARGET_OFFER', 'MARKET_REGION'].includes(sourceClass)) {
      families.add('CUSTOMER')
    }
    const ambiguousPrimaryFamilies = hasAmbiguousPrimaryProfileFamilies(families)
    const objectiveEligible =
      !ambiguousPrimaryFamilies
      && profileFamiliesAreAllowed(
        families,
        ['CUSTOMER', 'OBJECTIVE', 'STAKEHOLDER'],
      )
    const currentStateEligible =
      !ambiguousPrimaryFamilies
      && profileFamiliesAreAllowed(families, ['CUSTOMER', 'CURRENT_STATE'])
    const stakeholderEligible =
      profileFamiliesAreAllowed(
        families,
        ['CUSTOMER', 'OBJECTIVE', 'STAKEHOLDER', 'OUTPUT'],
      )
    const outputEligible =
      !ambiguousPrimaryFamilies
      && profileFamiliesAreAllowed(families, ['CUSTOMER', 'STAKEHOLDER', 'OUTPUT'])
    const hasCustomerContext =
      ['COMPANY_NAME', 'TARGET_OFFER', 'MARKET_REGION'].includes(sourceClass)
      || signals.hasCustomerContext
    const identityRoleProjection =
      signals.hasStakeholderRole || signals.hasOutputAudience
        ? buildProfileIdentityRoleProjection(candidate)
        : null

    if (
      hasCustomerContext
      && families.size === 1
      && families.has('CUSTOMER')
    ) {
      add('CUSTOMER_CONTEXT', candidate)
    }
    if (signals.hasObjectiveOwner && objectiveEligible) {
      add('OBJECTIVE_OWNER', candidate)
    }
    if (signals.hasObjectiveOutcome && objectiveEligible) {
      add('OBJECTIVE_OUTCOME', candidate)
    }
    if (
      signals.hasObjectiveHorizon
      && signals.hasObjectiveOutcome
      && objectiveEligible
    ) {
      add('OBJECTIVE_HORIZON', candidate)
    }
    if (signals.hasCurrentBaseline && currentStateEligible) {
      add('CURRENT_BASELINE', candidate)
    }
    if (signals.hasCurrentFriction && currentStateEligible) {
      add('CURRENT_FRICTION', candidate)
    }
    if (
      signals.hasStakeholderRole
      && stakeholderEligible
      && identityRoleProjection
    ) {
      identityRoleProjection.forEach((projection) =>
        add('STAKEHOLDER_ROLE', projection))
    }
    if (
      signals.hasOutputAudience
      && outputEligible
      && identityRoleProjection
    ) {
      identityRoleProjection.forEach((projection) =>
        add('OUTPUT_AUDIENCE', projection))
    }
    if (signals.hasOutputFormat && outputEligible) {
      add('OUTPUT_FORMAT', candidate)
    }
    if (
      signals.hasOutputChannel
      && signals.hasExplicitOutputContext
      && outputEligible
    ) {
      add('OUTPUT_CHANNEL', candidate)
    }
    if (
      signals.hasOutputTimingApproval
      && signals.hasExplicitOutputContext
      && outputEligible
    ) {
      add('OUTPUT_TIMING_APPROVAL', candidate)
    }
  })

  return categories
}

const SECTION_PROFILE_THEME_SUBJECTS = Object.freeze({
  workflow_automation: 'assisted or automated ways of working',
  governed_execution: 'controlled and repeatable business activity',
  structured_output: 'consistent creation of customer-facing material',
  speed_efficiency: 'reduced friction and faster delivery',
  consistency_reuse: 'reusable and consistent outputs',
  offer_context: 'the accepted offer context',
  market_region: 'the stated market and regional setting',
  accepted_upstream_truth: 'conclusions already accepted in preceding sections',
})

const getProfileThemeSubject = (theme = {}) => {
  const mappedSubject = SECTION_PROFILE_THEME_SUBJECTS[theme.key]
  if (mappedSubject) return mappedSubject

  const fallback = normalizeEvidenceString(theme.label)
  return fallback
    ? fallback.charAt(0).toLowerCase() + fallback.slice(1)
    : 'the available business context'
}

const buildProfileFactBullets = (groups = []) => {
  const seen = new Set()
  return groups.flatMap(({ category, prefix }) =>
    (category || []).flatMap((candidate) => {
      const normalizedText = normalizeSimilarityText(candidate.text)
      if (!normalizedText || seen.has(normalizedText)) return []
      seen.add(normalizedText)
      return [`${prefix}: ${candidate.text}.`]
    }))
}

const buildProfileGeneratedSections = ({
  acceptedEvidenceObjects = [],
  acceptedSectionEvidenceObjects = [],
  boundaries = [],
  dependencyTruths = [],
  facts = {},
  profile,
  purpose,
  supportingEvidence = [],
  themes = [],
}) => {
  const themeSubjects = themes.slice(0, 5).map(getProfileThemeSubject)
  const purposeText = normalizeEvidenceString(purpose)
  const purposeLead = purposeText ? `${purposeText} ` : ''
  const evidenceBoundariesSection = {
    heading: 'Evidence Boundaries',
    body: 'The interpretation does not promote unsupported or unconfirmed details as facts.',
    bullets: boundaries.slice(0, 5).map((boundary) => boundary.message),
  }
  const customerBullets = buildProfileFactBullets([
    { category: facts.CUSTOMER_CONTEXT, prefix: 'Business context' },
  ])
  const strategicBullets = buildProfileFactBullets([
    { category: facts.OBJECTIVE_OWNER, prefix: 'Objective ownership' },
    { category: facts.OBJECTIVE_OUTCOME, prefix: 'Desired outcome or measure' },
    { category: facts.OBJECTIVE_HORIZON, prefix: 'Delivery horizon' },
  ])
  const currentStateBullets = buildProfileFactBullets([
    { category: facts.CURRENT_BASELINE, prefix: 'Current baseline or capability' },
    { category: facts.CURRENT_FRICTION, prefix: 'Observed friction, constraint, or risk' },
  ])
  const stakeholderBullets = buildProfileFactBullets([
    { category: facts.STAKEHOLDER_ROLE, prefix: 'Named participant and role' },
  ])
  const outputBullets = buildProfileFactBullets([
    { category: facts.OUTPUT_AUDIENCE, prefix: 'Audience' },
    { category: facts.OUTPUT_FORMAT, prefix: 'Format or length' },
    { category: facts.OUTPUT_CHANNEL, prefix: 'Delivery channel' },
    { category: facts.OUTPUT_TIMING_APPROVAL, prefix: 'Timing or approval' },
  ])
  const sourceClassCount = new Set(
    supportingEvidence.map((item) => item.sourceType).filter(Boolean),
  ).size
  const evidenceCoverageBullets = [
    acceptedSectionEvidenceObjects.length > 0
      ? `Accepted section evidence coverage: ${acceptedSectionEvidenceObjects.length} reviewed item(s).`
      : '',
    acceptedEvidenceObjects.length > 0
      ? `Accepted discovery evidence coverage: ${acceptedEvidenceObjects.length} reviewed item(s).`
      : '',
    dependencyTruths.length > 0
      ? `Accepted dependency truth coverage: ${dependencyTruths.length} upstream section(s).`
      : '',
    `Supporting source coverage: ${supportingEvidence.length} item(s) across ${sourceClassCount} source type(s).`,
  ].filter(Boolean)

  const sectionsBySemanticType = {
    CUSTOMER_CONTEXT: [
      {
        heading: 'Customer and Offer Context',
        body: `${purposeLead}The reviewed material is interpreted only for the customer, offer, market, and operating setting.`,
        bullets: customerBullets.length > 0
          ? customerBullets
          : themeSubjects.map((subject) =>
            `Context direction: confirm how ${subject} describes the customer situation or offer setting.`),
      },
      {
        heading: 'Operating Context Checks',
        body: 'Use these questions to confirm the conditions that should be explicit before tailoring the narrative.',
        bullets: [
          'Confirm the decision audience and buying situation.',
          'Check whether regional or segment differences require tailored treatment.',
          'Record the source for each customer-specific constraint used in the narrative.',
        ],
      },
      evidenceBoundariesSection,
    ],
    STRATEGIC_OBJECTIVES: [
      {
        heading: 'Strategic Priorities',
        body: `${purposeLead}Only evidenced priorities, desired outcomes, ownership, measures, and horizons are promoted into this section.`,
        bullets: strategicBullets.length > 0
          ? strategicBullets
          : themeSubjects.map((subject) =>
            `Priority direction: assess how ${subject} could advance the desired business outcome.`),
      },
      {
        heading: 'Objective Definition Checks',
        body: 'Use these questions to make each candidate priority decision-ready without contradicting details already present in the evidence.',
        bullets: [
          'Confirm the intended result and how success will be measured.',
          'Confirm the accountable owner for each objective.',
          'Confirm the delivery horizon or target date.',
        ],
      },
      evidenceBoundariesSection,
    ],
    CURRENT_STATE_ASSESSMENT: [
      {
        heading: 'Observed Current State',
        body: `${purposeLead}Only evidenced present capability, baselines, friction, constraints, risks, and observations are promoted into this section.`,
        bullets: currentStateBullets.length > 0
          ? currentStateBullets
          : themeSubjects.map((subject) =>
            `Present-state direction: verify the current scale and impact of ${subject}.`),
      },
      {
        heading: 'Assessment Checks',
        body: 'Use these questions to test whether the available description is sufficient for a defensible current-state diagnosis.',
        bullets: [
          'Confirm the performance baseline used for comparison.',
          'Confirm the frequency, scale and cost of the observed friction.',
          'Confirm the operational, technical and organisational constraints.',
        ],
      },
      evidenceBoundariesSection,
    ],
    STAKEHOLDER_REGISTER: [
      {
        heading: 'Known Stakeholder Groups',
        body: `${purposeLead}Only evidenced people, roles, decision rights, influence, and ownership are promoted into this section.`,
        bullets: stakeholderBullets.length > 0
          ? stakeholderBullets
          : themeSubjects.map((subject) =>
            `Participation question: identify who sponsors, decides on, or operates work connected with ${subject}.`),
      },
      {
        heading: 'Roles to Confirm',
        body: 'Use these questions to turn topic-level participation cues into explicit decision ownership.',
        bullets: [
          'Name the executive sponsor where one is evidenced.',
          'Confirm the final decision maker and approval authority.',
          'Identify the operational users and subject-matter contributors.',
        ],
      },
      evidenceBoundariesSection,
    ],
    EVIDENCE_REGISTER: [
      {
        heading: 'Accepted Evidence Record',
        body: `${purposeLead}This section records support coverage and proof gaps without copying the evidence corpus into accepted truth.`,
        bullets: evidenceCoverageBullets,
      },
      {
        heading: 'Proof Checks',
        body: 'Use these checks before treating topical coverage as proof of an outcome, comparison or quantified commercial result.',
        bullets: [
          'Verify the source and method for each outcome measure.',
          'Confirm whether named customer examples can be used.',
          'Attach direct support for every comparative or financial claim.',
        ],
      },
      evidenceBoundariesSection,
    ],
    OUTPUT_REQUIREMENTS: [
      {
        heading: 'Known Output Requirements',
        body: `${purposeLead}Only evidenced audience, format, length, channel, tone, deadline, and approval requirements are promoted into this section.`,
        bullets: outputBullets.length > 0
          ? outputBullets
          : themeSubjects.map((subject) =>
            `Delivery question: confirm how ${subject} applies to the intended audience, format, and channel.`),
      },
      {
        heading: 'Delivery Brief Checks',
        body: 'Use these questions to confirm that the delivery brief is complete without assuming what the evidence already specifies.',
        bullets: [
          'Confirm the primary audience and decision moment.',
          'Confirm the required format, channel and length.',
          'Confirm the tone, deadline and approval expectations.',
        ],
      },
      evidenceBoundariesSection,
    ],
  }

  return sectionsBySemanticType[profile.semanticType] || []
}

const buildGeneratedSections = ({
  acceptedSectionEvidenceObjects = [],
  category,
  inputSummary,
  label,
  sectionExecutionContract,
  themes,
  boundaries,
}) => {
  const rule = SECTION_CATEGORY_RULES[category] || SECTION_CATEGORY_RULES.GENERIC
  const purpose = normalizeEvidenceString(sectionExecutionContract?.sectionIdentity?.purpose)
  const hasRuntimeInstruction = Boolean(normalizeEvidenceString(
    sectionExecutionContract?.runtimeInstructions?.description,
  ))
  const themeBullets = themes.slice(0, 5).map((theme) => purpose
    ? `${theme.label}: ${theme.description} For this section, interpret the evidence only where it supports ${purpose}`
    : `${theme.label}: ${theme.description}`)
  const boundaryBullets = boundaries.slice(0, 5).map((boundary) => boundary.message)
  const sectionEvidenceBullets = acceptedSectionEvidenceObjects
    .map((evidenceObject) => normalizeEvidenceString(evidenceObject?.extractedFact))
    .filter(Boolean)
    .slice(0, 6)
  const contextSources = [
    'accepted Intelligence Hub evidence',
    inputSummary ? 'customer-added section context' : '',
    sectionEvidenceBullets.length > 0 ? 'accepted section evidence' : '',
  ].filter(Boolean)
  const evidenceLead = `Based on ${contextSources.join(', ').replace(/, ([^,]*)$/, ' and $1')}, ${label} can safely focus on the themes below.`
  const customerContextSection = inputSummary
    ? {
        heading: 'Customer-Provided Section Context',
        body: 'The customer-added context below was included in generation as section input, not treated as external proof.',
        bullets: [inputSummary],
      }
    : null
  const customerSectionEvidenceSection = sectionEvidenceBullets.length > 0
    ? {
        heading: 'Customer-Provided Section Evidence',
        body: 'The accepted supporting-file evidence below was included in generation as section evidence.',
        bullets: sectionEvidenceBullets,
      }
    : null

  return [
    {
      heading: purpose ? `${label} Interpretation` : rule.heading,
      body: purpose
        ? `${evidenceLead} The locked section purpose is: ${purpose}`
        : evidenceLead,
      bullets: themeBullets,
    },
    customerContextSection,
    customerSectionEvidenceSection,
    {
      heading: purpose ? `${label} Decision Use` : rule.summaryHeading,
      body: themes.length > 0
        ? hasRuntimeInstruction
          ? 'Use this section-specific interpretation to assess only the business implications supported by accepted evidence.'
          : 'These themes are deterministic derivations from accepted evidence and current section context. They are not quantified proof or final output assets.'
        : 'The current evidence does not yet support a safe generated section draft.',
      bullets: purpose
        ? [`Review whether the accepted evidence supports this section purpose: ${purpose}`]
        : [],
    },
    {
      heading: 'Evidence Boundaries',
      body: 'The system did not assume proof that has not been accepted into Intelligence Hub or section truth.',
      bullets: boundaryBullets,
    },
  ].filter(Boolean)
}

const sectionsToContent = (sections = []) => sections
  .map((section) => [
    section.heading,
    section.body,
    ...(Array.isArray(section.bullets) ? section.bullets.map((bullet) => `- ${bullet}`) : []),
  ].filter(Boolean).join('\n\n'))
  .filter(Boolean)
  .join('\n\n')

const normalizeSimilarityText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')

const getSectionIdentityTokens = (...values) => new Set(
  values
    .flatMap((value) => normalizeSimilarityText(value).split(' '))
    .filter(Boolean),
)

const extractInterpretationText = ({ value, sourceKind }) => {
  const sections = Array.isArray(value?.sections) ? value.sections : []
  if (sections.length > 0) {
    return sections
      .filter((section) =>
        !SECTION_SIMILARITY_EXCLUDED_HEADINGS.has(
          normalizeSimilarityText(section?.heading),
        ))
      .flatMap((section) => [
        normalizeEvidenceString(section?.body),
        ...(Array.isArray(section?.bullets) ? section.bullets.map(normalizeEvidenceString) : []),
      ])
      .filter(Boolean)
      .join('\n')
  }

  return String(value?.content ?? value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean)
    .filter((line) => {
      const normalized = normalizeSimilarityText(line)
      if (!normalized) return false
      if (SECTION_SIMILARITY_EXCLUDED_HEADINGS.has(normalized)) return false
      if (/^(source|citation|reference|supporting evidence)\s*:/i.test(line)) return false
      return sourceKind === 'ACCEPTED' || !/^(generated at|generated by)\s*:/i.test(line)
    })
    .join('\n')
}

const tokenizeInterpretation = ({ text, identityTokens }) =>
  normalizeSimilarityText(text)
    .split(' ')
    .filter(Boolean)
    .filter((token) => !SECTION_SIMILARITY_STOP_WORDS.has(token))
    .filter((token) => !identityTokens.has(token))

const getSimilarityPeerSource = (sectionObject) => {
  const generated = getRuntimeSectionGenerated(sectionObject)
  if (generated && normalizeEvidenceString(generated.content ?? generated)) {
    return { sourceKind: 'GENERATED', value: generated }
  }
  const accepted = getRuntimeSectionAccepted(sectionObject)
  if (accepted && normalizeEvidenceString(accepted.content ?? accepted)) {
    return { sourceKind: 'ACCEPTED', value: accepted }
  }
  return null
}

const getSimilarityPolicyForCandidate = (candidate = {}) => {
  const usesCurrentProfileAdapter =
    normalizeSectionText(candidate?.generator?.adapter)
      === GSIL_PROFILE_ENRICHMENT_VERSION

  return usesCurrentProfileAdapter
    ? CURRENT_SECTION_INTERPRETATION_SIMILARITY_POLICY
    : SECTION_INTERPRETATION_SIMILARITY_POLICY
}

export const evaluateSectionInterpretationSimilarity = ({
  candidate,
  frameworkPackage,
  frameworkState = {},
  section,
  sectionLabel,
} = {}) => {
  const similarityPolicy = getSimilarityPolicyForCandidate(candidate)
  const targetSectionKey = normalizeSectionText(section?.sectionKey || section?.key)
  const targetRuntimePath = normalizeSectionText(section?.runtimePath)
  const sectionRootPrefix = 'framework_state.sections.'
  const targetStateKey = targetRuntimePath.startsWith(sectionRootPrefix)
    ? targetRuntimePath.slice(sectionRootPrefix.length)
    : targetSectionKey.replace(/-/g, '_')
  const targetLabel = normalizeSectionText(
    sectionLabel || section?.label || titleFromSectionKey(targetSectionKey),
  )
  const packageSections = Array.isArray(frameworkPackage?.sections)
    ? frameworkPackage.sections
    : []
  const labelByStateKey = new Map(packageSections.map((packageSection) => {
    const key = normalizeSectionText(packageSection?.sectionKey || packageSection?.key)
    const runtimePath = normalizeSectionText(packageSection?.runtimePath)
    const stateKey = runtimePath.startsWith(sectionRootPrefix)
      ? runtimePath.slice(sectionRootPrefix.length)
      : key.replace(/-/g, '_')
    return [
      stateKey,
      titleFromSectionKey(packageSection?.label || key),
    ]
  }))
  const targetText = extractInterpretationText({ value: candidate, sourceKind: 'GENERATED' })
  const frameworkSections = frameworkState?.sections && typeof frameworkState.sections === 'object'
    ? frameworkState.sections
    : {}
  const peerRows = Object.keys(frameworkSections)
    .map((stateKey) => normalizeSectionText(stateKey))
    .filter(Boolean)
    .filter((stateKey) => stateKey !== targetStateKey)
    .map((stateKey) => ({
      stateKey,
      peerSource: getSimilarityPeerSource(frameworkSections[stateKey]),
    }))
    .filter((row) => row.peerSource)
    .sort((left, right) => left.stateKey.localeCompare(right.stateKey))
    .slice(0, similarityPolicy.maxPeerCount)
    .map(({ stateKey, peerSource }) => {
      const peerLabel = labelByStateKey.get(stateKey) || titleFromSectionKey(stateKey)
      const identityTokens = getSectionIdentityTokens(
        targetSectionKey,
        targetLabel,
        stateKey,
        peerLabel,
      )
      const targetTokens = tokenizeInterpretation({ text: targetText, identityTokens })
      const peerText = extractInterpretationText(peerSource)
      const peerTokens = tokenizeInterpretation({ text: peerText, identityTokens })
      const targetSet = new Set(targetTokens)
      const peerSet = new Set(peerTokens)
      const intersectionCount = [...targetSet].filter((token) => peerSet.has(token)).length
      const unionCount = new Set([...targetSet, ...peerSet]).size
      const score = unionCount === 0 ? 0 : intersectionCount / unionCount
      const exactMatch =
        targetTokens.length > 0
        && targetTokens.join(' ') === peerTokens.join(' ')
      const normalizedScore = Number(score.toFixed(6))
      const passed =
        !exactMatch
        && score < similarityPolicy.threshold

      return {
        sectionKey: stateKey,
        sourceKind: peerSource.sourceKind,
        score: normalizedScore,
        exactMatch,
        targetTokenCount: targetSet.size,
        peerTokenCount: peerSet.size,
        intersectionCount,
        passed,
      }
    })

  const ranked = [...peerRows].sort((left, right) =>
    right.score - left.score || left.sectionKey.localeCompare(right.sectionKey))
  const topMatch = ranked[0] || null
  const passed = peerRows.every((row) => row.passed)

  return {
    algorithm: similarityPolicy.algorithm,
    version: similarityPolicy.version,
    threshold: similarityPolicy.threshold,
    excludedFields: [...similarityPolicy.excludedFields],
    comparisonCount: peerRows.length,
    maximumScore: topMatch?.score || 0,
    topMatchSectionKey: topMatch?.sectionKey || '',
    passed,
    comparisons: peerRows,
  }
}

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
  enrichmentVersion = GSIL_ENRICHMENT_VERSION,
  frameworkPackage,
  frameworkState = {},
  generatedAt = new Date().toISOString(),
  input,
  runtimeInstance,
  section,
  sectionExecutionContract,
  interpretationProfile = null,
} = {}) => {
  const evidencePack = getEvidencePackFromFrameworkState(frameworkState)
  const sectionKey = normalizeSectionText(section?.sectionKey || section?.key)
  const runtimePath = normalizeSectionText(section?.runtimePath)
  const label = normalizeEvidenceString(sectionExecutionContract?.sectionIdentity?.label)
    || titleFromSectionKey(section?.label || sectionKey || runtimePath)
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
    sectionExecutionContract,
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
  const profileEvidenceCandidates = interpretationProfile
    ? buildProfileEvidenceCandidates({
        acceptedEvidenceObjects,
        acceptedSectionEvidenceObjects,
        dependencyTruths,
        inputSummary,
        scopedEvidenceSummary,
        seedProfile,
      })
    : []
  const profileFacts = interpretationProfile
    ? classifyProfileEvidenceCandidates(profileEvidenceCandidates)
    : {}
  const generationBoundaries = buildGenerationBoundaries({
    category,
    dependencySectionKeys,
    dependencyTruths,
    inputSummary,
    useVerificationLanguage: Boolean(interpretationProfile),
    truthEligible: truthEligibility.eligible,
  })
  const inputHash = hashSectionInput(input)
  const sourceRefs = buildSourceRefs({ supportingEvidence })
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
    version: enrichmentVersion,
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
    enrichmentVersion,
    generatedAt,
    generationBoundaries,
    inputHash,
    inputSummary,
    label,
    profileEvidenceCandidates,
    profileFacts,
    runtimePath,
    scopedEvidenceSummary,
    scopedView,
    sectionEvidenceHash,
    sectionEvidenceSummary,
    sectionExecutionContract,
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
    enrichmentVersion: parts.enrichmentVersion,
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
  sectionExecutionContract,
  generatedAt = new Date().toISOString(),
} = {}) => {
  const interpretationProfile =
    resolveSectionInterpretationProfile(sectionExecutionContract, section)
  const enrichmentVersion = interpretationProfile
    ? GSIL_PROFILE_ENRICHMENT_VERSION
    : GSIL_ENRICHMENT_VERSION
  const parts = buildSectionIntelligenceParts({
    dependencySectionKeys,
    enrichmentVersion,
    frameworkPackage,
    frameworkState,
    generatedAt,
    input,
    runtimeInstance,
    section,
    sectionExecutionContract,
    interpretationProfile,
  })
  const sections = parts.truthEligibility.eligible
    ? interpretationProfile
      ? buildProfileGeneratedSections({
          acceptedEvidenceObjects: parts.acceptedEvidenceObjects,
          acceptedSectionEvidenceObjects: parts.acceptedSectionEvidenceObjects,
          boundaries: parts.generationBoundaries,
          dependencyTruths: parts.dependencyTruths,
          facts: parts.profileFacts,
          profile: interpretationProfile,
          purpose: parts.sectionExecutionContract?.sectionIdentity?.purpose,
          supportingEvidence: parts.supportingEvidence,
          themes: parts.themes,
        })
      : buildGeneratedSections({
          acceptedSectionEvidenceObjects: parts.acceptedSectionEvidenceObjects,
          category: parts.category,
          inputSummary: parts.inputSummary,
          label: parts.label,
          sectionExecutionContract: parts.sectionExecutionContract,
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
      adapter: enrichmentVersion,
      packageKey: runtimeInstance?.packageKey || frameworkPackage?.packageKey || '',
      packageVersion: runtimeInstance?.packageVersion || frameworkPackage?.version || '',
      contractVersion: sectionExecutionContract?.contractVersion || '',
      sectionContractHash: sectionExecutionContract?.sectionContractHash || '',
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
