import { createHash, randomUUID } from 'node:crypto'

import {
  KNOWLEDGE_PACK_BOUNDARIES,
  KNOWLEDGE_PACK_RECEIPT_TYPES,
  resolveKnowledgePackBoundary,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
  validateOutcomeBoundaryReceipt,
} from './outcomeBoundaryReceiptService.js'

export const EXPORT_METADATA_RULES_EXECUTOR_CONTRACT_VERSION =
  'outcome-studio.export-metadata-rules-executor.v1'
export const EXPORT_METADATA_RULES_EXECUTOR_KEY = 'export-metadata-rules'
export const EXPORT_METADATA_RULES_RECEIPT_KEY = 'export-metadata-rules.post-validation.v1'
export const EXPORT_METADATA_SNAPSHOT_CONTRACT_VERSION =
  'outcome-studio.export-metadata-snapshot.v1'
export const EXPORT_METADATA_VALIDATION_MEANING =
  'METADATA_RULES_VALIDATED_FOR_DRAFT_SNAPSHOT'

const EXECUTOR_STATUSES = Object.freeze({
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  NOT_RECORDED: 'NOT_RECORDED',
})
const EXECUTOR_RESULTS = Object.freeze({ ALLOW: 'ALLOW', BLOCK: 'BLOCK' })
const CERTIFICATION_LEVELS = new Set([
  'EVIDENCE_PRESENT',
  'EVIDENCE_SUPPORTED',
  'CERTIFIED_TRUTH',
  'STRATEGIC_TRUTH',
])
const CONTRADICTION_RISKS = new Set(['LOW', 'MEDIUM', 'HIGH', 'BLOCKING'])
const REQUIRED_HEADINGS = Object.freeze([
  'Required Export Metadata',
  'Preservation Rules',
  'Customer-Safe Boundary',
  'Format Behaviour',
  'Validation Requirements',
])
const REQUIRED_METADATA_TERMS = Object.freeze([
  'certification level',
  'coverage score',
  'confidence score',
  'source-diversity score',
  'contradiction risk',
  'truth-signature identifier',
  'runtime revision',
  'graph version',
  'known gaps',
  'active warnings',
  'limitations count',
  'warning count',
  'generated timestamp',
  'content hash',
  'source output identity',
  'lineage summary',
])
const REQUIRED_PRESERVATION_TERMS = Object.freeze([
  'exact truth state used to generate the exported content',
  'must not be replaced with newer values after generation',
  'warning severity and certification level must be preserved unchanged',
  'known gaps and limitations must not be omitted',
  'linked to the corresponding content version',
])
const REQUIRED_PROHIBITED_TERMS = Object.freeze([
  'chain of reasoning',
  'prompt assembly',
  'raw graph internals',
  'raw uploaded files',
  'hidden pack content',
  'storage references',
  'internal safety-gate notes',
])
const REQUIRED_VALIDATION_TERMS = Object.freeze([
  'truth signature is current for the generated asset version',
  'runtime revision matches the generation event',
  'required metadata fields are present',
  'warnings and known gaps are preserved',
  'no hidden runtime information is included',
  'content hash can be associated with the exported version',
])
const PROHIBITED_CUSTOMER_KEYS = new Set([
  'certification',
  'certificationlevel',
  'coveragescore',
  'confidencescore',
  'sourcediversityscore',
  'contradictionrisk',
  'truthsignatureid',
  'truthsignature',
  'runtimerevision',
  'graphversion',
  'governedlineage',
  'lineagesummary',
  'customercontenthash',
  'packid',
  'packhash',
  'packcontenthash',
  'packversion',
  'packversionid',
  'validationmeaning',
  'grrexecutionid',
  'grrruntimeartifactid',
])
const PROHIBITED_CUSTOMER_VALUE_PATTERN =
  /\b(?:truth_sig_|grr_exec_|grr_art_|kpv-|sha256:)[a-z0-9_-]+/i
const FORBIDDEN_EXPORT_STATE_KEYS = new Set([
  'format',
  'exportable',
  'exported',
  'download',
  'rendition',
  'publication',
  'delivery',
])
const SNAPSHOT_KEYS = Object.freeze([
  'contractVersion',
  'packId',
  'packVersionId',
  'packContentHash',
  'draftId',
  'draftIterationId',
  'draftIterationNumber',
  'customerContentHash',
  'certificationLevel',
  'coverageScore',
  'confidenceScore',
  'sourceDiversityScore',
  'contradictionRisk',
  'truthSignatureId',
  'runtimeRevision',
  'graphVersion',
  'knownGaps',
  'activeWarnings',
  'limitationsCount',
  'warningCount',
  'generatedAt',
  'sourceOutputAssetId',
  'lineage',
  'validationMeaning',
])
const LINEAGE_KEYS = Object.freeze(['grrExecutionId', 'grrRuntimeArtifactId'])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeKey = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, '')
const normalizeSearchText = (value) => normalizeText(value)
  .toLowerCase()
  .replace(/[`*_]/g, '')
  .replace(/\s+/g, ' ')
const sha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const isPlainObject = (value) => {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}
const cloneValue = (value) => JSON.parse(JSON.stringify(value))
const normalizedStringArray = (value) => Array.isArray(value)
  ? value.map(normalizeText).filter(Boolean)
  : null
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const score = (value) => {
  if (typeof value !== 'number') return null
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}
const isPositiveRevision = (value) => {
  const revision = normalizeText(value)
  if (!revision) return false
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+|Infinity|NaN)$/i.test(revision)) return true
  return /^\d+$/.test(revision) && Number.isSafeInteger(Number(revision)) && Number(revision) > 0
}

export const hashOutcomeCustomerContent = (customerContent) => {
  if (!isPlainObject(customerContent)) return ''
  return sha256(JSON.stringify(stableValue(customerContent)))
}

const sectionBody = (content, heading) => {
  const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im')
  const match = pattern.exec(content)
  if (!match) return ''
  const rest = content.slice(match.index + match[0].length)
  const nextHeading = /^##\s+/im.exec(rest)
  return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim()
}

const includesEvery = (value, required) => required.every((term) => value.includes(term))

export const parseExportMetadataRulesMarkdown = (packContent) => {
  if (typeof packContent !== 'string' || !normalizeText(packContent)) {
    return { valid: false, sections: {}, failures: ['PACK_CONTENT_NOT_AVAILABLE'] }
  }
  const sections = Object.fromEntries(REQUIRED_HEADINGS.map((heading) => [heading, sectionBody(packContent, heading)]))
  const normalizedSections = Object.fromEntries(
    Object.entries(sections).map(([heading, body]) => [heading, normalizeSearchText(body)]),
  )
  const failures = REQUIRED_HEADINGS
    .filter((heading) => !normalizedSections[heading])
    .map((heading) => `SECTION_${normalizeToken(heading).replace(/[^A-Z0-9]+/g, '_')}_INVALID`)
  if (!includesEvery(normalizedSections['Required Export Metadata'], REQUIRED_METADATA_TERMS)) {
    failures.push('REQUIRED_EXPORT_METADATA_INVALID')
  }
  if (!includesEvery(normalizedSections['Preservation Rules'], REQUIRED_PRESERVATION_TERMS)) {
    failures.push('PRESERVATION_RULES_INVALID')
  }
  if (!includesEvery(normalizedSections['Customer-Safe Boundary'], REQUIRED_PROHIBITED_TERMS)) {
    failures.push('CUSTOMER_SAFE_BOUNDARY_INVALID')
  }
  if (!includesEvery(normalizedSections['Validation Requirements'], REQUIRED_VALIDATION_TERMS)) {
    failures.push('VALIDATION_REQUIREMENTS_INVALID')
  }
  const format = normalizedSections['Format Behaviour']
  if (!format.includes('structured formats should include metadata in dedicated fields')
    || !format.includes('formats incapable of preserving required governance information must not be treated as safely exportable')) {
    failures.push('FORMAT_BEHAVIOUR_INVALID')
  }
  return { valid: failures.length === 0, sections, failures: [...new Set(failures)] }
}

const findCustomerGovernanceLeak = (value, path = 'customerContent') => {
  if (typeof value === 'string') return PROHIBITED_CUSTOMER_VALUE_PATTERN.test(value) ? path : ''
  if (!value || typeof value !== 'object') return ''
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findCustomerGovernanceLeak(value[index], `${path}[${index}]`)
      if (found) return found
    }
    return ''
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    if (PROHIBITED_CUSTOMER_KEYS.has(normalizeKey(key))) return childPath
    const found = findCustomerGovernanceLeak(child, childPath)
    if (found) return found
  }
  return ''
}

const hasForbiddenExportState = (value) => {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasForbiddenExportState)
  return Object.entries(value).some(([key, child]) => (
    FORBIDDEN_EXPORT_STATE_KEYS.has(normalizeKey(key))
    || hasForbiddenExportState(child)
  ))
}

const hasExactKeys = (value, expectedKeys) => isPlainObject(value)
  && sameValue(Object.keys(value).sort(), [...expectedKeys].sort())

const isCanonicalIsoTimestamp = (value) => {
  const normalized = normalizeText(value)
  if (!normalized) return false
  const parsed = new Date(normalized)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === normalized
}

export const buildExportMetadataSnapshot = ({
  pack = {},
  draft = {},
  customerContent = {},
  certificationLevel = '',
  truthQuality = {},
  truthSignatureId = '',
  runtimeRevision = '',
  graphVersion = '',
  knownGaps = [],
  activeWarnings = [],
  limitations = [],
  generatedAt = '',
  sourceOutputAssetId = '',
  lineage = {},
} = {}) => ({
  contractVersion: EXPORT_METADATA_SNAPSHOT_CONTRACT_VERSION,
  packId: normalizeText(pack.packId),
  packVersionId: normalizeText(pack.versionId),
  packContentHash: normalizeText(pack.contentHash),
  draftId: normalizeText(draft.draftId || draft.outcomeAssetId),
  draftIterationId: normalizeText(draft.draftIterationId || draft.outcomeAssetVersionId),
  draftIterationNumber: Number(draft.draftIterationNumber || draft.iterationNumber || 0),
  customerContentHash: hashOutcomeCustomerContent(customerContent),
  certificationLevel: normalizeToken(certificationLevel),
  coverageScore: Number(truthQuality.coverageScore),
  confidenceScore: Number(truthQuality.confidenceScore),
  sourceDiversityScore: Number(truthQuality.sourceDiversityScore),
  contradictionRisk: normalizeToken(truthQuality.contradictionRisk),
  truthSignatureId: normalizeText(truthSignatureId),
  runtimeRevision: normalizeText(runtimeRevision),
  graphVersion: normalizeText(graphVersion),
  knownGaps: normalizedStringArray(knownGaps) || [],
  activeWarnings: normalizedStringArray(activeWarnings) || [],
  limitationsCount: (normalizedStringArray(limitations) || []).length,
  warningCount: (normalizedStringArray(activeWarnings) || []).length,
  generatedAt: normalizeText(generatedAt),
  sourceOutputAssetId: normalizeText(sourceOutputAssetId),
  lineage: {
    grrExecutionId: normalizeText(lineage.grrExecutionId),
    grrRuntimeArtifactId: normalizeText(lineage.grrRuntimeArtifactId),
  },
  validationMeaning: EXPORT_METADATA_VALIDATION_MEANING,
})

const buildCheck = ({ key, pass, message } = {}) => ({
  key: normalizeToken(key),
  status: pass ? EXECUTOR_STATUSES.PASSED : EXECUTOR_STATUSES.FAILED,
  message: normalizeText(message),
  source: EXPORT_METADATA_RULES_EXECUTOR_KEY,
})

const buildBlockedResult = ({ status, checks, failures, executionId } = {}) => ({
  contractVersion: EXPORT_METADATA_RULES_EXECUTOR_CONTRACT_VERSION,
  executorKey: EXPORT_METADATA_RULES_EXECUTOR_KEY,
  executionId,
  status,
  result: EXECUTOR_RESULTS.BLOCK,
  receipt: null,
  metadataSnapshot: null,
  checks,
  failures: [...new Set(failures.map(normalizeToken).filter(Boolean))],
})

export const executeExportMetadataRulesPack = ({
  pack = {},
  packContent = '',
  metadataSnapshot = {},
  customerContent = {},
  expected = {},
  asset = {},
  version = {},
  executionId = `export_metadata_rules_exec_${randomUUID()}`,
} = {}) => {
  const checks = []
  const failures = []
  const packKey = normalizeText(pack.packKey || pack.key).toLowerCase()
  const versionId = normalizeText(pack.versionId)
  const contentHash = normalizeText(pack.contentHash)
  const assetId = normalizeText(asset.outcomeAssetId || asset.assetId)
  const assetVersionId = normalizeText(version.outcomeAssetVersionId || version.versionId)
  const boundary = resolveKnowledgePackBoundary(pack)
  const identityPass = packKey === EXPORT_METADATA_RULES_EXECUTOR_KEY
    && Boolean(normalizeText(pack.packId) && versionId && contentHash && assetId && assetVersionId)
    && boundary === KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION
  checks.push(buildCheck({ key: 'PACK_IDENTITY_BOUND', pass: identityPass, message: identityPass ? 'Exact export-metadata-rules pack, asset, version, and post-validation boundary are bound.' : 'Exact export-metadata-rules pack, asset, version, and post-validation boundary are required.' }))
  if (!identityPass) failures.push('PACK_IDENTITY_INVALID')

  const contentLoaded = typeof packContent === 'string' && Boolean(normalizeText(packContent))
  checks.push(buildCheck({ key: 'VERSION_CONTENT_LOADED', pass: contentLoaded, message: contentLoaded ? 'Raw server-side Knowledge Pack version content was loaded.' : 'Raw Knowledge Pack version content was not available.' }))
  if (!contentLoaded) failures.push('PACK_CONTENT_NOT_AVAILABLE')

  const hashPass = contentLoaded && /^sha256:[a-f0-9]{64}$/.test(contentHash) && sha256(packContent) === contentHash
  checks.push(buildCheck({ key: 'PACK_CONTENT_HASH_VERIFIED', pass: hashPass, message: hashPass ? 'Loaded pack content matches the bound content hash.' : 'Loaded pack content does not match the bound content hash.' }))
  if (!hashPass) failures.push('PACK_CONTENT_HASH_MISMATCH')

  const parsed = parseExportMetadataRulesMarkdown(packContent)
  checks.push(buildCheck({ key: 'EXPORT_METADATA_RULES_LOADED', pass: parsed.valid, message: parsed.valid ? 'All source-defined export metadata, preservation, safety, format, and validation rules were loaded.' : 'The persisted Markdown does not contain the complete Export Metadata Rules contract.' }))
  failures.push(...parsed.failures)
  if (failures.length > 0) return buildBlockedResult({ status: !contentLoaded || !parsed.valid ? EXECUTOR_STATUSES.NOT_RECORDED : EXECUTOR_STATUSES.FAILED, checks, failures, executionId })

  const expectedKnownGaps = normalizedStringArray(expected.knownGaps)
  const expectedWarnings = normalizedStringArray(expected.activeWarnings)
  const expectedLimitations = normalizedStringArray(expected.limitations)
  const expectedGeneratedAt = normalizeText(expected.generatedAt)
  const expectedContentHash = hashOutcomeCustomerContent(customerContent)
  const snapshotShapePass = isPlainObject(metadataSnapshot)
    && metadataSnapshot.contractVersion === EXPORT_METADATA_SNAPSHOT_CONTRACT_VERSION
    && !hasForbiddenExportState(metadataSnapshot)
    && hasExactKeys(metadataSnapshot, SNAPSHOT_KEYS)
    && hasExactKeys(metadataSnapshot.lineage, LINEAGE_KEYS)
  checks.push(buildCheck({ key: 'METADATA_SNAPSHOT_SHAPE_VALID', pass: snapshotShapePass, message: snapshotShapePass ? 'The bounded draft metadata snapshot has the exact supported shape and no export-state claims.' : 'The draft metadata snapshot shape is invalid or contains an export-state claim.' }))
  if (!snapshotShapePass) failures.push('METADATA_SNAPSHOT_SHAPE_INVALID')

  const snapshotBindingPass = snapshotShapePass
    && metadataSnapshot.packId === normalizeText(pack.packId)
    && metadataSnapshot.packVersionId === versionId
    && metadataSnapshot.packContentHash === contentHash
    && metadataSnapshot.draftId === assetId
    && metadataSnapshot.draftIterationId === assetVersionId
    && Number.isSafeInteger(metadataSnapshot.draftIterationNumber)
    && metadataSnapshot.draftIterationNumber > 0
    && metadataSnapshot.customerContentHash === expectedContentHash
  checks.push(buildCheck({ key: 'DRAFT_VERSION_METADATA_BOUND', pass: snapshotBindingPass, message: snapshotBindingPass ? 'Pack identity and recomputed customer-content hash are bound to the exact draft iteration.' : 'Pack identity, draft identity, iteration, or recomputed customer-content hash does not match.' }))
  if (!snapshotBindingPass) failures.push('DRAFT_VERSION_METADATA_BINDING_INVALID')

  const snapshotCoverageScore = score(metadataSnapshot.coverageScore)
  const snapshotConfidenceScore = score(metadataSnapshot.confidenceScore)
  const snapshotSourceDiversityScore = score(metadataSnapshot.sourceDiversityScore)
  const expectedCoverageScore = score(expected.truthQuality?.coverageScore)
  const expectedConfidenceScore = score(expected.truthQuality?.confidenceScore)
  const expectedSourceDiversityScore = score(expected.truthQuality?.sourceDiversityScore)
  const truthQualityPass = CERTIFICATION_LEVELS.has(metadataSnapshot.certificationLevel)
    && metadataSnapshot.certificationLevel === normalizeToken(expected.certificationLevel)
    && snapshotCoverageScore !== null
    && snapshotConfidenceScore !== null
    && snapshotSourceDiversityScore !== null
    && expectedCoverageScore !== null
    && expectedConfidenceScore !== null
    && expectedSourceDiversityScore !== null
    && snapshotCoverageScore === expectedCoverageScore
    && snapshotConfidenceScore === expectedConfidenceScore
    && snapshotSourceDiversityScore === expectedSourceDiversityScore
    && CONTRADICTION_RISKS.has(metadataSnapshot.contradictionRisk)
    && metadataSnapshot.contradictionRisk === normalizeToken(expected.truthQuality?.contradictionRisk)
  checks.push(buildCheck({ key: 'TRUTH_QUALITY_METADATA_PRESERVED', pass: truthQualityPass, message: truthQualityPass ? 'Certification level and truth-quality measures match the independently evaluated evidence.' : 'Certification level or truth-quality measures are missing, invalid, or changed.' }))
  if (!truthQualityPass) failures.push('TRUTH_QUALITY_METADATA_INVALID')

  const truthLineagePass = Boolean(normalizeText(expected.truthSignatureId))
    && metadataSnapshot.truthSignatureId === normalizeText(expected.truthSignatureId)
    && normalizeToken(expected.truthSignature?.status) === 'PROJECTED'
    && normalizeToken(expected.truthSignature?.currentness) === 'CURRENT'
    && isPositiveRevision(metadataSnapshot.runtimeRevision)
    && metadataSnapshot.runtimeRevision === normalizeText(expected.runtimeRevision)
    && Boolean(metadataSnapshot.graphVersion)
    && metadataSnapshot.graphVersion === normalizeText(expected.graphVersion)
  checks.push(buildCheck({ key: 'TRUTH_AND_RUNTIME_REFERENCES_CURRENT', pass: truthLineagePass, message: truthLineagePass ? 'Current truth signature, generation-time runtime revision, and graph version are preserved.' : 'Truth signature, runtime revision, or graph version is missing, stale, or changed.' }))
  if (!truthLineagePass) failures.push('TRUTH_OR_RUNTIME_REFERENCE_INVALID')

  const arraysAvailable = expectedKnownGaps !== null && expectedWarnings !== null && expectedLimitations !== null
  const constraintsPass = arraysAvailable
    && sameValue(metadataSnapshot.knownGaps, expectedKnownGaps)
    && sameValue(metadataSnapshot.activeWarnings, expectedWarnings)
    && metadataSnapshot.limitationsCount === expectedLimitations.length
    && metadataSnapshot.warningCount === expectedWarnings.length
  checks.push(buildCheck({ key: 'GAPS_WARNINGS_AND_LIMITATIONS_PRESERVED', pass: constraintsPass, message: constraintsPass ? 'Known gaps, active warning keys, and separate counts are preserved unchanged.' : 'Known gaps, warning keys, or limitation/warning counts are missing or changed.' }))
  if (!constraintsPass) failures.push('CONSTRAINT_METADATA_NOT_PRESERVED')

  const lineagePass = isCanonicalIsoTimestamp(expectedGeneratedAt)
    && isCanonicalIsoTimestamp(metadataSnapshot.generatedAt)
    && metadataSnapshot.generatedAt === expectedGeneratedAt
    && Boolean(normalizeText(expected.sourceOutputAssetId))
    && metadataSnapshot.sourceOutputAssetId === normalizeText(expected.sourceOutputAssetId)
    && metadataSnapshot.lineage?.grrExecutionId === normalizeText(expected.lineage?.grrExecutionId)
    && Boolean(metadataSnapshot.lineage?.grrExecutionId)
    && metadataSnapshot.lineage?.grrRuntimeArtifactId === normalizeText(expected.lineage?.grrRuntimeArtifactId)
    && Boolean(metadataSnapshot.lineage?.grrRuntimeArtifactId)
    && metadataSnapshot.validationMeaning === EXPORT_METADATA_VALIDATION_MEANING
  checks.push(buildCheck({ key: 'GENERATION_LINEAGE_PRESERVED', pass: lineagePass, message: lineagePass ? 'Generation timestamp, source output, governed execution lineage, and bounded validation meaning are preserved.' : 'Generation or governed lineage metadata is missing or changed.' }))
  if (!lineagePass) failures.push('GENERATION_LINEAGE_INVALID')

  const leakPath = findCustomerGovernanceLeak(customerContent)
  const customerSafePass = !leakPath
  checks.push(buildCheck({ key: 'CUSTOMER_CONTENT_METADATA_SEPARATED', pass: customerSafePass, message: customerSafePass ? 'Governance metadata remains outside customer content.' : 'Customer content contains structured governance metadata or an internal identifier.' }))
  if (!customerSafePass) failures.push('CUSTOMER_CONTENT_METADATA_LEAK')

  if (failures.length > 0) return buildBlockedResult({ status: EXECUTOR_STATUSES.FAILED, checks, failures, executionId })

  const receiptChecks = [
    ...checks,
    buildCheck({ key: 'POST_VALIDATION_PASSED', pass: true, message: 'Export metadata rules validated the exact draft metadata snapshot; no export or rendition was created.' }),
    buildCheck({ key: 'BOUNDARY_RECEIPT_RECORDED', pass: true, message: 'Exact export-metadata-rules boundary receipt was recorded.' }),
  ]
  const receipt = {
    contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
    versionId,
    contentHash,
    boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
    receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    receiptKey: EXPORT_METADATA_RULES_RECEIPT_KEY,
    validatorKey: EXPORT_METADATA_RULES_EXECUTOR_KEY,
    result: EXECUTOR_RESULTS.ALLOW,
    evidenceReference: `outcome:${assetId}:${assetVersionId}:${EXPORT_METADATA_RULES_EXECUTOR_KEY}:${executionId}`,
    status: EXECUTOR_STATUSES.PASSED,
    checks: receiptChecks,
  }
  const validation = validateOutcomeBoundaryReceipt({
    expectedPack: { ...pack, versionId, contentHash, boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION, receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION },
    receipt,
  })
  if (!validation.valid) return buildBlockedResult({ status: EXECUTOR_STATUSES.FAILED, checks: [...receiptChecks, buildCheck({ key: 'BOUNDARY_RECEIPT_CONTRACT_VALID', pass: false, message: `Generated receipt failed strict contract validation: ${validation.failures.join(', ')}.` })], failures: ['BOUNDARY_RECEIPT_CONTRACT_INVALID'], executionId })

  return {
    contractVersion: EXPORT_METADATA_RULES_EXECUTOR_CONTRACT_VERSION,
    executorKey: EXPORT_METADATA_RULES_EXECUTOR_KEY,
    executionId,
    status: EXECUTOR_STATUSES.PASSED,
    result: EXECUTOR_RESULTS.ALLOW,
    receipt,
    metadataSnapshot: cloneValue(metadataSnapshot),
    checks: receiptChecks,
    failures: [],
  }
}

export default executeExportMetadataRulesPack
