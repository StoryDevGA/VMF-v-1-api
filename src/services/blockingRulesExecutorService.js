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

export const BLOCKING_RULES_EXECUTOR_CONTRACT_VERSION =
  'outcome-studio.blocking-rules-executor.v1'
export const BLOCKING_RULES_EXECUTOR_KEY = 'blocking-rules'
export const BLOCKING_RULES_RECEIPT_KEY = 'blocking-rules.post-validation.v1'

const EXECUTOR_STATUSES = Object.freeze({
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  NOT_RECORDED: 'NOT_RECORDED',
})

const EXECUTOR_RESULTS = Object.freeze({
  ALLOW: 'ALLOW',
  BLOCK: 'BLOCK',
})

const REQUIRED_RULES = Object.freeze([
  { heading: 'Missing Accepted Truth', key: 'MISSING_ACCEPTED_TRUTH' },
  { heading: 'Missing Lock Proof', key: 'MISSING_LOCK_PROOF' },
  { heading: 'Unresolved Blocking Contradictions', key: 'UNRESOLVED_BLOCKING_CONTRADICTIONS' },
  { heading: 'Raw Graph Unsafe', key: 'RAW_GRAPH_UNSAFE' },
])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const sha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
export const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const hasValue = (value) => value !== undefined && value !== null && normalizeText(value) !== ''

const readCandidateValue = (candidate, snakeKey, camelKey) => {
  if (Object.prototype.hasOwnProperty.call(candidate, snakeKey)) return candidate[snakeKey]
  if (camelKey && Object.prototype.hasOwnProperty.call(candidate, camelKey)) return candidate[camelKey]
  return undefined
}

const toNonNegativeNumber = (value) => {
  if (!hasValue(value)) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

const buildCheck = ({ key, pass, message } = {}) => ({
  key: normalizeToken(key),
  status: pass ? EXECUTOR_STATUSES.PASSED : EXECUTOR_STATUSES.FAILED,
  message: normalizeText(message),
  source: BLOCKING_RULES_EXECUTOR_KEY,
})

const buildBlockedResult = ({
  status = EXECUTOR_STATUSES.FAILED,
  checks = [],
  failures = [],
  executionId,
} = {}) => ({
  contractVersion: BLOCKING_RULES_EXECUTOR_CONTRACT_VERSION,
  executorKey: BLOCKING_RULES_EXECUTOR_KEY,
  executionId,
  status,
  result: EXECUTOR_RESULTS.BLOCK,
  receipt: null,
  checks,
  failures: [...new Set(failures.map(normalizeToken).filter(Boolean))],
})

export const extractSection = (content, heading) => {
  const pattern = new RegExp(`(?:^|\\n)## ${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i')
  return content.match(pattern)?.[1] || ''
}

export const extractSubsection = (section, heading) => {
  const pattern = new RegExp(`(?:^|\\n)### ${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=\\n### |$)`, 'i')
  return normalizeText(section.match(pattern)?.[1])
}

export const parseBlockingRulesMarkdown = (packContent) => {
  if (typeof packContent !== 'string' || !normalizeText(packContent)) {
    return { valid: false, failures: ['PACK_CONTENT_NOT_AVAILABLE'], rules: [] }
  }

  const rules = REQUIRED_RULES.map(({ heading, key }) => {
    const section = extractSection(packContent, heading)
    return {
      key,
      heading,
      section,
      condition: extractSubsection(section, 'Condition'),
      outcome: extractSubsection(section, 'Outcome'),
      customerSafeMessage: extractSubsection(section, 'Customer-Safe Message'),
    }
  })
  const missingSections = rules
    .filter((rule) => !rule.section || !rule.condition || !rule.outcome || !rule.customerSafeMessage)
    .map((rule) => rule.key)

  return {
    valid: missingSections.length === 0,
    failures: missingSections.length > 0
      ? ['BLOCKING_RULES_INVALID', ...missingSections.map((key) => `MISSING_RULE_${key}`)]
      : [],
    rules: rules.map(({ section, ...rule }) => rule),
  }
}

const buildCandidateEvidence = (candidate = {}) => ({
  acceptedTruthCount: readCandidateValue(candidate, 'accepted_truth_count', 'acceptedTruthCount'),
  requiredTruthCount: readCandidateValue(candidate, 'required_truth_count', 'requiredTruthCount'),
  lockSnapshotId: readCandidateValue(candidate, 'lock_snapshot_id', 'lockSnapshotId'),
  replayAnchorId: readCandidateValue(candidate, 'replay_anchor_id', 'replayAnchorId'),
  contradictionRisk: normalizeToken(
    readCandidateValue(candidate, 'contradiction_risk', 'contradictionRisk'),
  ),
  rawGraphLeakageDetected: readCandidateValue(
    candidate,
    'raw_graph_leakage_detected',
    'rawGraphLeakageDetected',
  ),
})

const evaluateRule = (rule, evidence) => {
  switch (rule.key) {
    case 'MISSING_ACCEPTED_TRUTH': {
      const accepted = toNonNegativeNumber(evidence.acceptedTruthCount)
      const required = toNonNegativeNumber(evidence.requiredTruthCount)
      return {
        pass: accepted !== null && required !== null && accepted >= required,
        message: accepted !== null && required !== null && accepted >= required
          ? 'Accepted truth count satisfies the required truth count.'
          : 'Accepted truth count is incomplete for this assessed use.',
      }
    }
    case 'MISSING_LOCK_PROOF': {
      const pass = hasValue(evidence.lockSnapshotId) && hasValue(evidence.replayAnchorId)
      return {
        pass,
        message: pass
          ? 'Lock snapshot and replay anchor are present.'
          : 'Lock snapshot and replay anchor are both required.',
      }
    }
    case 'UNRESOLVED_BLOCKING_CONTRADICTIONS': {
      const pass = Boolean(evidence.contradictionRisk) && evidence.contradictionRisk !== 'BLOCKING'
      return {
        pass,
        message: pass
          ? 'Contradiction risk is present and is not blocking.'
          : 'Contradiction risk is missing or remains BLOCKING.',
      }
    }
    case 'RAW_GRAPH_UNSAFE': {
      const pass = evidence.rawGraphLeakageDetected === false
      return {
        pass,
        message: pass
          ? 'Raw graph leakage risk is explicitly absent.'
          : 'Raw graph leakage must be explicitly absent.',
      }
    }
    default:
      return {
        pass: false,
        message: 'The pack contains a blocking rule without a registered executor implementation.',
      }
  }
}

export const executeBlockingRulesPack = ({
  pack = {},
  packContent = '',
  candidate = {},
  asset = {},
  version = {},
  executionId = `blocking_rules_exec_${randomUUID()}`,
} = {}) => {
  const checks = []
  const failures = []
  const packKey = normalizeText(pack.packKey || pack.key).toLowerCase()
  const versionId = normalizeText(pack.versionId)
  const contentHash = normalizeText(pack.contentHash)
  const boundary = resolveKnowledgePackBoundary(pack)
  const assetId = normalizeText(asset.outcomeAssetId || asset.assetId)
  const assetVersionId = normalizeText(version.outcomeAssetVersionId || version.versionId)

  const identityPass = packKey === BLOCKING_RULES_EXECUTOR_KEY
    && Boolean(versionId)
    && Boolean(contentHash)
    && boundary === KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION
    && Boolean(assetId)
    && Boolean(assetVersionId)
  checks.push(buildCheck({
    key: 'PACK_IDENTITY_BOUND',
    pass: identityPass,
    message: identityPass
      ? 'Exact blocking-rules pack, asset, version, and post-validation boundary are bound.'
      : 'Exact blocking-rules pack, asset, version, and post-validation boundary are required.',
  }))
  if (!identityPass) failures.push('PACK_IDENTITY_INVALID')

  const contentLoaded = typeof packContent === 'string' && Boolean(normalizeText(packContent))
  checks.push(buildCheck({
    key: 'VERSION_CONTENT_LOADED',
    pass: contentLoaded,
    message: contentLoaded
      ? 'Raw server-side Knowledge Pack version content was loaded.'
      : 'Raw Knowledge Pack version content was not available.',
  }))
  if (!contentLoaded) failures.push('PACK_CONTENT_NOT_AVAILABLE')

  const hashPass = contentLoaded
    && /^sha256:[a-f0-9]{64}$/.test(contentHash)
    && sha256(packContent) === contentHash
  checks.push(buildCheck({
    key: 'PACK_CONTENT_HASH_VERIFIED',
    pass: hashPass,
    message: hashPass
      ? 'Loaded pack content matches the bound content hash.'
      : 'Loaded pack content does not match the bound content hash.',
  }))
  if (!hashPass) failures.push('PACK_CONTENT_HASH_MISMATCH')

  const parsed = parseBlockingRulesMarkdown(packContent)
  checks.push(buildCheck({
    key: 'BLOCKING_RULES_LOADED',
    pass: parsed.valid,
    message: parsed.valid
      ? `${parsed.rules.length} source-backed blocking rules were loaded from the persisted Markdown version.`
      : 'The persisted Markdown version does not contain all required blocking-rule sections.',
  }))
  failures.push(...parsed.failures)

  if (failures.length > 0) {
    return buildBlockedResult({
      status: !contentLoaded || !parsed.valid ? EXECUTOR_STATUSES.NOT_RECORDED : EXECUTOR_STATUSES.FAILED,
      checks,
      failures,
      executionId,
    })
  }

  const evidence = buildCandidateEvidence(candidate)
  const evidenceAvailable = toNonNegativeNumber(evidence.acceptedTruthCount) !== null
    && toNonNegativeNumber(evidence.requiredTruthCount) !== null
    && hasValue(evidence.lockSnapshotId)
    && hasValue(evidence.replayAnchorId)
    && Boolean(evidence.contradictionRisk)
    && typeof evidence.rawGraphLeakageDetected === 'boolean'
  checks.push(buildCheck({
    key: 'BLOCKING_EVIDENCE_COMPLETE',
    pass: evidenceAvailable,
    message: evidenceAvailable
      ? 'Accepted truth, lock proof, contradiction risk, and raw-graph safety evidence are present.'
      : 'Blocking-rule evidence is incomplete; missing values cannot be treated as safe.',
  }))
  if (!evidenceAvailable) failures.push('BLOCKING_EVIDENCE_INCOMPLETE')

  for (const rule of parsed.rules) {
    const result = evaluateRule(rule, evidence)
    checks.push(buildCheck({
      key: `RULE_${rule.key}`,
      pass: result.pass,
      message: result.message,
    }))
    if (!result.pass) failures.push(rule.key)
  }

  const rulesPass = failures.length === 0
  checks.push(buildCheck({
    key: 'BLOCKING_RULES_PASSED',
    pass: rulesPass,
    message: rulesPass
      ? 'All source-backed blocking rules passed for this exact candidate version.'
      : 'One or more source-backed blocking rules did not pass for this exact candidate version.',
  }))
  if (!rulesPass) {
    return buildBlockedResult({
      status: EXECUTOR_STATUSES.FAILED,
      checks,
      failures,
      executionId,
    })
  }

  const receiptChecks = [
    ...checks,
    buildCheck({
      key: 'POST_VALIDATION_PASSED',
      pass: true,
      message: 'Blocking-rules post-validation passed for the exact asset version.',
    }),
    buildCheck({
      key: 'BOUNDARY_RECEIPT_RECORDED',
      pass: true,
      message: 'Exact blocking-rules boundary receipt was recorded.',
    }),
  ]
  const receipt = {
    contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
    versionId,
    contentHash,
    boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
    receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    receiptKey: BLOCKING_RULES_RECEIPT_KEY,
    validatorKey: BLOCKING_RULES_EXECUTOR_KEY,
    result: EXECUTOR_RESULTS.ALLOW,
    evidenceReference: `outcome:${assetId}:${assetVersionId}:${BLOCKING_RULES_EXECUTOR_KEY}:${executionId}`,
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
      failures: ['BOUNDARY_RECEIPT_CONTRACT_INVALID'],
      executionId,
    })
  }

  return {
    contractVersion: BLOCKING_RULES_EXECUTOR_CONTRACT_VERSION,
    executorKey: BLOCKING_RULES_EXECUTOR_KEY,
    executionId,
    status: EXECUTOR_STATUSES.PASSED,
    result: EXECUTOR_RESULTS.ALLOW,
    receipt,
    checks: receiptChecks,
    failures: [],
  }
}
