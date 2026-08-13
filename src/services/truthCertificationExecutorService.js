import { createHash, randomUUID } from 'node:crypto'

import { parse as parseYaml } from 'yaml'

import {
  KNOWLEDGE_PACK_BOUNDARIES,
  KNOWLEDGE_PACK_RECEIPT_TYPES,
  resolveKnowledgePackBoundary,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
  validateOutcomeBoundaryReceipt,
} from './outcomeBoundaryReceiptService.js'

export const TRUTH_CERTIFICATION_EXECUTOR_CONTRACT_VERSION =
  'outcome-studio.truth-certification-executor.v1'
export const TRUTH_CERTIFICATION_EXECUTOR_KEY = 'truth-certification-pack'
export const TRUTH_CERTIFICATION_RECEIPT_KEY = 'truth-certification-pack.post-validation.v1'

const EXECUTOR_STATUSES = Object.freeze({
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  NOT_RECORDED: 'NOT_RECORDED',
})

const EXECUTOR_RESULTS = Object.freeze({
  ALLOW: 'ALLOW',
  BLOCK: 'BLOCK',
})

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeKey = (value) => normalizeText(value).toLowerCase()
const normalizeSearchText = (value) => normalizeText(value)
  .toLowerCase()
  .replace(/[`*_]/g, '')
  .replace(/\s+/g, ' ')
const isPlainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const hasOwn = (value, key) => isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key)
const sha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`

const readCandidateValue = (candidate, snakeKey, camelKey = '') => {
  if (hasOwn(candidate, snakeKey)) return candidate[snakeKey]
  if (camelKey && hasOwn(candidate, camelKey)) return candidate[camelKey]
  return undefined
}

const hasValue = (value) => value !== undefined && value !== null && normalizeText(value) !== ''

const toNonNegativeNumber = (value) => {
  if (value === undefined || value === null || normalizeText(value) === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

const deriveBand = (score) => {
  const number = toNonNegativeNumber(score)
  if (number === null) return ''
  if (number < 40) return 'LOW'
  if (number < 70) return 'MEDIUM'
  if (number < 90) return 'HIGH'
  return 'VERY_HIGH'
}

const collectCustomerText = (customerContent = {}) => {
  if (typeof customerContent === 'string') return customerContent
  if (!isPlainObject(customerContent)) return ''
  const sections = Array.isArray(customerContent.sections)
    ? customerContent.sections
      .flatMap((section) => [section?.label, section?.heading, section?.body, section?.markdown])
      .filter(hasValue)
    : []
  return [customerContent.title, customerContent.markdown, ...sections]
    .filter(hasValue)
    .join('\n')
}

const findProhibitedClaimViolations = (customerText, prohibitedClaims) => {
  const normalizedCustomerText = normalizeSearchText(customerText)
  return prohibitedClaims.filter((claim) => {
    const normalizedClaim = normalizeSearchText(claim)
    let searchFrom = 0
    while (searchFrom < normalizedCustomerText.length) {
      const matchIndex = normalizedCustomerText.indexOf(normalizedClaim, searchFrom)
      if (matchIndex < 0) return false
      const sentenceStart = Math.max(
        normalizedCustomerText.lastIndexOf('.', matchIndex),
        normalizedCustomerText.lastIndexOf(';', matchIndex),
        normalizedCustomerText.lastIndexOf('\\n', matchIndex),
      ) + 1
      const prefix = normalizedCustomerText.slice(sentenceStart, matchIndex)
      if (!/\b(do not|don't|must not|never|without|no|not)\b/.test(prefix)) return true
      searchFrom = matchIndex + normalizedClaim.length
    }
    return false
  })
}

const buildCheck = ({ key, pass, message, source = TRUTH_CERTIFICATION_EXECUTOR_KEY } = {}) => ({
  key: normalizeToken(key),
  status: pass ? EXECUTOR_STATUSES.PASSED : EXECUTOR_STATUSES.FAILED,
  message: normalizeText(message),
  source: normalizeText(source),
})

const buildBlockedResult = ({
  status = EXECUTOR_STATUSES.FAILED,
  checks = [],
  failures = [],
  warnings = [],
  executionId,
} = {}) => ({
  contractVersion: TRUTH_CERTIFICATION_EXECUTOR_CONTRACT_VERSION,
  executorKey: TRUTH_CERTIFICATION_EXECUTOR_KEY,
  executionId,
  status,
  result: EXECUTOR_RESULTS.BLOCK,
  receipt: null,
  checks,
  failures: [...new Set(failures.map(normalizeToken).filter(Boolean))],
  warnings: [...new Set(warnings.map(normalizeText).filter(Boolean))],
})

const parseExecutablePack = (packContent) => {
  if (typeof packContent !== 'string' || !normalizeText(packContent)) {
    return { document: null, failure: 'PACK_CONTENT_NOT_AVAILABLE' }
  }
  try {
    const document = parseYaml(packContent)
    if (!isPlainObject(document)) return { document: null, failure: 'PACK_CONTENT_NOT_OBJECT' }
    return { document, failure: '' }
  } catch (_error) {
    return { document: null, failure: 'PACK_CONTENT_PARSE_FAILED' }
  }
}

const normalizeRequiredInputKey = (value) => normalizeKey(value).replace(/-/g, '_')

const buildCandidateEvidence = (candidate = {}) => {
  const coverageScore = readCandidateValue(candidate, 'coverage_score', 'coverageScore')
  const confidenceScore = readCandidateValue(candidate, 'confidence_score', 'confidenceScore')
  const sourceDiversityScore = readCandidateValue(
    candidate,
    'source_diversity_score',
    'sourceDiversityScore',
  )
  return {
    acceptedTruthCount: readCandidateValue(candidate, 'accepted_truth_count', 'acceptedTruthCount'),
    requiredTruthCount: readCandidateValue(candidate, 'required_truth_count', 'requiredTruthCount'),
    evidenceCount: readCandidateValue(candidate, 'evidence_count', 'evidenceCount'),
    sourceCount: readCandidateValue(candidate, 'source_count', 'sourceCount'),
    coverageScore,
    confidenceScore,
    sourceDiversityScore,
    contradictionCount: readCandidateValue(candidate, 'contradiction_count', 'contradictionCount'),
    unresolvedContradictionCount: readCandidateValue(
      candidate,
      'unresolved_contradiction_count',
      'unresolvedContradictionCount',
    ),
    graphVersion: readCandidateValue(candidate, 'graph_version', 'graphVersion'),
    runtimeRevision: readCandidateValue(candidate, 'runtime_revision', 'runtimeRevision'),
    publishSnapshotId: readCandidateValue(candidate, 'publish_snapshot_id', 'publishSnapshotId'),
    lockSnapshotId: readCandidateValue(candidate, 'lock_snapshot_id', 'lockSnapshotId'),
    replayAnchorId: readCandidateValue(candidate, 'replay_anchor_id', 'replayAnchorId'),
    confidenceBand: normalizeToken(
      readCandidateValue(candidate, 'confidence_band', 'confidenceBand')
      || deriveBand(confidenceScore),
    ),
    sourceDiversityBand: normalizeToken(
      readCandidateValue(candidate, 'source_diversity_band', 'sourceDiversityBand')
      || deriveBand(sourceDiversityScore),
    ),
    contradictionRisk: normalizeToken(
      readCandidateValue(candidate, 'contradiction_risk', 'contradictionRisk'),
    ),
    rawGraphLeakageDetected: readCandidateValue(
      candidate,
      'raw_graph_leakage_detected',
      'rawGraphLeakageDetected',
    ),
  }
}

const evaluateBlockingRule = ({ rule, evidence } = {}) => {
  const key = normalizeToken(rule?.key)
  switch (key) {
    case 'MISSING_ACCEPTED_TRUTH':
      return {
        pass: toNonNegativeNumber(evidence.acceptedTruthCount) !== null
          && toNonNegativeNumber(evidence.requiredTruthCount) !== null
          && Number(evidence.acceptedTruthCount) >= Number(evidence.requiredTruthCount),
        message: 'Accepted truth count satisfies the required truth count.',
        failure: 'MISSING_ACCEPTED_TRUTH',
      }
    case 'MISSING_LOCK_PROOF':
      return {
        pass: hasValue(evidence.lockSnapshotId) && hasValue(evidence.replayAnchorId),
        message: 'Lock snapshot and replay anchor are present.',
        failure: 'MISSING_LOCK_PROOF',
      }
    case 'UNRESOLVED_BLOCKING_CONTRADICTIONS':
      return {
        pass: evidence.contradictionRisk && evidence.contradictionRisk !== 'BLOCKING',
        message: 'Contradiction risk is not blocking.',
        failure: 'UNRESOLVED_BLOCKING_CONTRADICTIONS',
      }
    case 'RAW_GRAPH_UNSAFE':
      return {
        pass: evidence.rawGraphLeakageDetected === false,
        message: 'Raw graph leakage risk is explicitly absent.',
        failure: 'RAW_GRAPH_UNSAFE',
      }
    default:
      return {
        pass: false,
        message: 'The pack contains a blocking rule without a registered executor implementation.',
        failure: `UNSUPPORTED_BLOCKING_RULE_${key || 'MISSING_KEY'}`,
      }
  }
}

const buildWarnings = ({ document, evidence, customerText } = {}) => {
  const warningKeys = isPlainObject(document?.warnings) ? Object.keys(document.warnings) : []
  const warnings = []
  if (warningKeys.includes('LOW_COVERAGE') && Number(evidence.coverageScore) < 70) {
    warnings.push('Coverage is below the certified-truth threshold.')
  }
  if (warningKeys.includes('LOW_CONFIDENCE') && ['LOW', 'MEDIUM'].includes(evidence.confidenceBand)) {
    warnings.push('Confidence is below the certified-truth threshold.')
  }
  if (warningKeys.includes('LOW_SOURCE_DIVERSITY') && evidence.sourceDiversityBand === 'LOW') {
    warnings.push('Source diversity is limited.')
  }
  if (warningKeys.includes('CONTRADICTIONS_PRESENT') && Number(evidence.contradictionCount) > 0) {
    warnings.push('Contradictions are present and must remain visible.')
  }
  if (warningKeys.includes('NO_CUSTOMER_PROOF') && evidence.customerProofPresent === false) {
    warnings.push('Customer proof is not present in the accepted truth.')
  }
  if (warningKeys.includes('NO_QUANTIFIED_ECONOMICS') && evidence.economicProofPresent === false) {
    warnings.push('Quantified economic proof is not present in the accepted truth.')
  }
  if (!customerText) warnings.push('Customer content was not available for claim validation.')
  return warnings
}

export const executeTruthCertificationPack = ({
  pack = {},
  packContent = '',
  candidate = {},
  customerContent = {},
  asset = {},
  version = {},
  executionId = `truth_certification_exec_${randomUUID()}`,
} = {}) => {
  const checks = []
  const failures = []
  const packKey = normalizeKey(pack.packKey || pack.key)
  const versionId = normalizeText(pack.versionId)
  const contentHash = normalizeText(pack.contentHash)
  const boundary = resolveKnowledgePackBoundary(pack)
  const assetId = normalizeText(asset.outcomeAssetId || asset.assetId)
  const assetVersionId = normalizeText(version.outcomeAssetVersionId || version.versionId)
  const customerText = collectCustomerText(customerContent)

  const exactIdentityPass = packKey === TRUTH_CERTIFICATION_EXECUTOR_KEY
    && Boolean(versionId)
    && Boolean(contentHash)
    && boundary === KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION
    && Boolean(assetId)
    && Boolean(assetVersionId)
  checks.push(buildCheck({
    key: 'PACK_IDENTITY_BOUND',
    pass: exactIdentityPass,
    message: exactIdentityPass
      ? 'Exact truth-certification pack, asset, version, and post-validation boundary are bound.'
      : 'Exact truth-certification pack, asset, version, and post-validation boundary are required.',
  }))
  if (!exactIdentityPass) failures.push('PACK_IDENTITY_INVALID')

  const parsed = parseExecutablePack(packContent)
  const contentLoaded = !parsed.failure
  checks.push(buildCheck({
    key: 'VERSION_CONTENT_LOADED',
    pass: contentLoaded,
    message: contentLoaded
      ? 'Raw server-side Knowledge Pack version content was loaded.'
      : 'Raw executable Knowledge Pack version content was not available.',
  }))
  if (parsed.failure) failures.push(parsed.failure)

  const computedHash = contentLoaded ? sha256(packContent) : ''
  const hashPass = contentLoaded && /^sha256:[a-f0-9]{64}$/.test(contentHash)
    && computedHash === contentHash
  checks.push(buildCheck({
    key: 'PACK_CONTENT_HASH_VERIFIED',
    pass: hashPass,
    message: hashPass
      ? 'Loaded pack content matches the bound content hash.'
      : 'Loaded pack content does not match the bound content hash.',
  }))
  if (!hashPass) failures.push('PACK_CONTENT_HASH_MISMATCH')

  const document = parsed.document
  const executableRulesPass = isPlainObject(document?.pack)
    && normalizeKey(document.pack.key) === TRUTH_CERTIFICATION_EXECUTOR_KEY
    && Array.isArray(document?.inputs?.required)
    && document.inputs.required.length > 0
    && Array.isArray(document?.blocking_rules)
    && document.blocking_rules.length > 0
    && isPlainObject(document?.quality_dimensions)
    && Array.isArray(document?.prohibited_output_claims)
  checks.push(buildCheck({
    key: 'EXECUTABLE_RULES_LOADED',
    pass: executableRulesPass,
    message: executableRulesPass
      ? 'Executable truth-certification rule sections were loaded.'
      : 'The loaded content is not an executable truth-certification rule contract.',
  }))
  if (!executableRulesPass) failures.push('EXECUTABLE_RULES_INVALID')

  if (failures.length > 0) {
    return buildBlockedResult({
      status: parsed.failure || !executableRulesPass ? EXECUTOR_STATUSES.NOT_RECORDED : EXECUTOR_STATUSES.FAILED,
      checks,
      failures,
      executionId,
    })
  }

  const evidence = buildCandidateEvidence(candidate)
  const requiredInputKeys = document.inputs.required.map(normalizeRequiredInputKey)
  const missingInputs = requiredInputKeys.filter((key) => {
    const camelKey = key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase())
    return !hasValue(evidence[camelKey])
  })
  const evidenceComplete = missingInputs.length === 0
    && ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'].includes(evidence.confidenceBand)
    && ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'].includes(evidence.sourceDiversityBand)
    && ['LOW', 'MEDIUM', 'HIGH', 'BLOCKING'].includes(evidence.contradictionRisk)
    && typeof evidence.rawGraphLeakageDetected === 'boolean'
    && Boolean(customerText)
  checks.push(buildCheck({
    key: 'TRUTH_EVIDENCE_COMPLETE',
    pass: evidenceComplete,
    message: evidenceComplete
      ? 'Required truth-quality, proof, contradiction, leakage, and customer-content inputs are present.'
      : `Required truth evidence is incomplete${missingInputs.length ? `: ${missingInputs.join(', ')}` : '.'}`,
  }))
  if (!evidenceComplete) failures.push('TRUTH_EVIDENCE_INCOMPLETE')

  const ruleResults = []
  for (const rule of document.blocking_rules) {
    const ruleResult = evaluateBlockingRule({ rule, evidence })
    ruleResults.push({ key: normalizeToken(rule?.key), pass: ruleResult.pass })
    checks.push(buildCheck({
      key: `RULE_${normalizeToken(rule?.key)}`,
      pass: ruleResult.pass,
      message: ruleResult.message,
    }))
    if (!ruleResult.pass) failures.push(ruleResult.failure)
  }

  const prohibitedClaims = findProhibitedClaimViolations(
    customerText,
    document.prohibited_output_claims.map(normalizeText).filter(Boolean),
  )
  const claimsPass = prohibitedClaims.length === 0
  checks.push(buildCheck({
    key: 'PROHIBITED_OUTPUT_CLAIMS_CLEAR',
    pass: claimsPass,
    message: claimsPass
      ? 'No prohibited output claim was found in the candidate customer content.'
      : 'Candidate customer content contains a prohibited output claim.',
  }))
  if (!claimsPass) failures.push('PROHIBITED_OUTPUT_CLAIM')

  const warnings = buildWarnings({ document, evidence, customerText })
  const allRulesPass = failures.length === 0 && ruleResults.length > 0
  checks.push(buildCheck({
    key: 'TRUTH_CERTIFICATION_RULES_PASSED',
    pass: allRulesPass,
    message: allRulesPass
      ? 'Truth-certification rules passed for this exact candidate version.'
      : 'Truth-certification rules did not pass for this exact candidate version.',
  }))
  if (!allRulesPass) {
    return buildBlockedResult({
      status: EXECUTOR_STATUSES.FAILED,
      checks,
      failures,
      warnings,
      executionId,
    })
  }

  const evidenceReference = `outcome:${assetId}:${assetVersionId}:${TRUTH_CERTIFICATION_EXECUTOR_KEY}:${executionId}`
  const receiptChecks = [
    ...checks,
    buildCheck({
      key: 'POST_VALIDATION_PASSED',
      pass: true,
      message: 'Truth-certification post-validation passed for the exact asset version.',
    }),
    buildCheck({
      key: 'BOUNDARY_RECEIPT_RECORDED',
      pass: true,
      message: 'Exact truth-certification boundary receipt was recorded.',
    }),
  ]
  const receipt = {
    contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
    versionId,
    contentHash,
    boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
    receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    receiptKey: TRUTH_CERTIFICATION_RECEIPT_KEY,
    validatorKey: TRUTH_CERTIFICATION_EXECUTOR_KEY,
    result: EXECUTOR_RESULTS.ALLOW,
    evidenceReference,
    status: EXECUTOR_STATUSES.PASSED,
    checks: receiptChecks,
  }
  const receiptValidation = validateOutcomeBoundaryReceipt({
    expectedPack: {
      ...pack,
      versionId,
      contentHash,
      boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
      receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    },
    receipt,
  })
  if (!receiptValidation.valid) {
    return buildBlockedResult({
      status: EXECUTOR_STATUSES.FAILED,
      checks: [
        ...receiptChecks,
        buildCheck({
          key: 'BOUNDARY_RECEIPT_CONTRACT_VALID',
          pass: false,
          message: `Generated receipt failed strict contract validation: ${receiptValidation.failures.join(', ')}.`,
        }),
      ],
      failures: [...failures, 'BOUNDARY_RECEIPT_CONTRACT_INVALID'],
      warnings,
      executionId,
    })
  }

  return {
    contractVersion: TRUTH_CERTIFICATION_EXECUTOR_CONTRACT_VERSION,
    executorKey: TRUTH_CERTIFICATION_EXECUTOR_KEY,
    executionId,
    status: EXECUTOR_STATUSES.PASSED,
    result: EXECUTOR_RESULTS.ALLOW,
    receipt,
    checks: receiptChecks,
    failures: [],
    warnings,
  }
}
