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

export const PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_CONTRACT_VERSION =
  'outcome-studio.prohibited-output-claims-executor.v1'
export const PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_KEY = 'prohibited-output-claims'
export const PROHIBITED_OUTPUT_CLAIMS_RECEIPT_KEY =
  'prohibited-output-claims.post-validation.v1'

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
const normalizeSearchText = (value) => normalizeText(value)
  .toLowerCase()
  .replace(/[`*_]/g, '')
  .replace(/\s+/g, ' ')
const isPlainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const sha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`

const collectCustomerText = (customerContent = {}) => {
  if (typeof customerContent === 'string') return customerContent
  if (!isPlainObject(customerContent)) return ''
  const sections = Array.isArray(customerContent.sections)
    ? customerContent.sections
      .flatMap((section) => [section?.label, section?.heading, section?.body, section?.markdown])
      .filter(Boolean)
    : []
  return [customerContent.title, customerContent.markdown, ...sections]
    .filter(Boolean)
    .join('\n')
}

const buildCheck = ({ key, pass, message, source = PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_KEY } = {}) => ({
  key: normalizeToken(key),
  status: pass ? EXECUTOR_STATUSES.PASSED : EXECUTOR_STATUSES.FAILED,
  message: normalizeText(message),
  source: normalizeText(source),
})

const buildBlockedResult = ({ status = EXECUTOR_STATUSES.FAILED, checks = [], failures = [], executionId } = {}) => ({
  contractVersion: PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_CONTRACT_VERSION,
  executorKey: PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_KEY,
  executionId,
  status,
  result: EXECUTOR_RESULTS.BLOCK,
  receipt: null,
  checks,
  failures: [...new Set(failures.map(normalizeToken).filter(Boolean))],
})

const extractSection = (content, heading) => {
  const pattern = new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i')
  return content.match(pattern)?.[1] || ''
}

const extractBulletRules = (section) => section
  .split(/\r?\n/)
  .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1] || '')
  .map((rule) => rule.replace(/[.;:]$/, '').trim())
  .filter(Boolean)

const simplifyRule = (rule) => normalizeText(rule)
  .replace(/\s+unless\s+.*$/i, '')
  .replace(/\s+absent\s+from\s+accepted truth$/i, '')
  .replace(/\s+required by evidence boundaries$/i, '')
  .trim()

const findClaimViolations = (customerText, rules) => {
  const normalizedCustomerText = normalizeSearchText(customerText)
  return rules.filter((rule) => {
    const normalizedRule = normalizeSearchText(rule)
    let searchFrom = 0
    while (searchFrom < normalizedCustomerText.length) {
      const matchIndex = normalizedCustomerText.indexOf(normalizedRule, searchFrom)
      if (matchIndex < 0) return false
      const sentenceStart = Math.max(
        normalizedCustomerText.lastIndexOf('.', matchIndex),
        normalizedCustomerText.lastIndexOf(';', matchIndex),
        normalizedCustomerText.lastIndexOf('\\n', matchIndex),
      ) + 1
      const prefix = normalizedCustomerText.slice(sentenceStart, matchIndex)
      if (!/\b(do not|don't|must not|never|without|no|not)\b/.test(prefix)) return true
      searchFrom = matchIndex + normalizedRule.length
    }
    return false
  })
}

export const parseProhibitedOutputClaimsMarkdown = (packContent) => {
  if (typeof packContent !== 'string' || !normalizeText(packContent)) {
    return { valid: false, failures: ['PACK_CONTENT_NOT_AVAILABLE'], rules: [] }
  }
  const prohibitedClaimsSection = extractSection(packContent, 'Prohibited Claims')
  const additionalProhibitionsSection = extractSection(packContent, 'Additional Prohibitions')
  const primaryRules = extractBulletRules(prohibitedClaimsSection)
  const additionalRules = extractBulletRules(additionalProhibitionsSection)
  const rules = [...primaryRules, ...additionalRules]
    .map(simplifyRule)
    .filter((rule) => rule.length >= 4)
  const valid = primaryRules.length > 0 && additionalRules.length > 0 && rules.length > 0
  return {
    valid,
    failures: valid ? [] : ['PROHIBITED_CLAIMS_RULES_INVALID'],
    rules: [...new Set(rules)],
  }
}

export const executeProhibitedOutputClaimsPack = ({
  pack = {},
  packContent = '',
  customerContent = {},
  asset = {},
  version = {},
  executionId = `prohibited_output_claims_exec_${randomUUID()}`,
} = {}) => {
  const checks = []
  const failures = []
  const packKey = normalizeText(pack.packKey || pack.key).toLowerCase()
  const versionId = normalizeText(pack.versionId)
  const contentHash = normalizeText(pack.contentHash)
  const boundary = resolveKnowledgePackBoundary(pack)
  const assetId = normalizeText(asset.outcomeAssetId || asset.assetId)
  const assetVersionId = normalizeText(version.outcomeAssetVersionId || version.versionId)
  const customerText = collectCustomerText(customerContent)
  const identityPass = packKey === PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_KEY
    && Boolean(versionId)
    && Boolean(contentHash)
    && boundary === KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION
    && Boolean(assetId)
    && Boolean(assetVersionId)
  checks.push(buildCheck({
    key: 'PACK_IDENTITY_BOUND',
    pass: identityPass,
    message: identityPass
      ? 'Exact prohibited-output-claims pack, asset, version, and post-validation boundary are bound.'
      : 'Exact prohibited-output-claims pack, asset, version, and post-validation boundary are required.',
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

  const parsed = parseProhibitedOutputClaimsMarkdown(packContent)
  checks.push(buildCheck({
    key: 'PROHIBITED_CLAIMS_RULES_LOADED',
    pass: parsed.valid,
    message: parsed.valid
      ? `${parsed.rules.length} prohibited-output-claims rules were loaded from the persisted Markdown version.`
      : 'The persisted Markdown version does not contain the required prohibited-claim sections.',
  }))
  failures.push(...parsed.failures)

  const customerContentPass = Boolean(normalizeText(customerText))
  checks.push(buildCheck({
    key: 'CUSTOMER_CONTENT_AVAILABLE',
    pass: customerContentPass,
    message: customerContentPass
      ? 'Customer content is available for prohibited-claim validation.'
      : 'Customer content is required for prohibited-claim validation.',
  }))
  if (!customerContentPass) failures.push('CUSTOMER_CONTENT_NOT_AVAILABLE')

  if (failures.length > 0) {
    return buildBlockedResult({
      status: !contentLoaded || !parsed.valid ? EXECUTOR_STATUSES.NOT_RECORDED : EXECUTOR_STATUSES.FAILED,
      checks,
      failures,
      executionId,
    })
  }

  const violations = findClaimViolations(customerText, parsed.rules)
  const claimsClear = violations.length === 0
  checks.push(buildCheck({
    key: 'PROHIBITED_OUTPUT_CLAIMS_CLEAR',
    pass: claimsClear,
    message: claimsClear
      ? 'No prohibited output claim was found in the customer content.'
      : `Customer content contains prohibited claim text: ${violations.join(', ')}.`,
  }))
  if (!claimsClear) {
    return buildBlockedResult({
      status: EXECUTOR_STATUSES.FAILED,
      checks,
      failures: ['PROHIBITED_OUTPUT_CLAIM'],
      executionId,
    })
  }

  const receiptChecks = [
    ...checks,
    buildCheck({
      key: 'POST_VALIDATION_PASSED',
      pass: true,
      message: 'Prohibited-output-claims post-validation passed for the exact asset version.',
    }),
    buildCheck({
      key: 'BOUNDARY_RECEIPT_RECORDED',
      pass: true,
      message: 'Exact prohibited-output-claims boundary receipt was recorded.',
    }),
  ]
  const receipt = {
    contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
    versionId,
    contentHash,
    boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
    receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    receiptKey: PROHIBITED_OUTPUT_CLAIMS_RECEIPT_KEY,
    validatorKey: PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_KEY,
    result: EXECUTOR_RESULTS.ALLOW,
    evidenceReference: `outcome:${assetId}:${assetVersionId}:${PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_KEY}:${executionId}`,
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
    contractVersion: PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_CONTRACT_VERSION,
    executorKey: PROHIBITED_OUTPUT_CLAIMS_EXECUTOR_KEY,
    executionId,
    status: EXECUTOR_STATUSES.PASSED,
    result: EXECUTOR_RESULTS.ALLOW,
    receipt,
    checks: receiptChecks,
    failures: [],
  }
}
