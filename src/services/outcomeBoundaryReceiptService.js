import {
  KNOWLEDGE_PACK_BOUNDARIES,
  KNOWLEDGE_PACK_RECEIPT_TYPES,
  resolveKnowledgePackBoundary,
  resolveKnowledgePackReceiptType,
} from '../constants/knowledgeRuntime.js'

export const OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION = 'outcome-studio.boundary-receipt.v1'

const PASSED_STATUS = 'PASSED'
const VALID_RESULTS_BY_BOUNDARY = Object.freeze({
  [KNOWLEDGE_PACK_BOUNDARIES.PRE_GENERATION_VALIDATION]: new Set(['PASS', 'PASSED', 'ALLOW']),
  [KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION]: new Set(['PASS', 'PASSED', 'ALLOW']),
  [KNOWLEDGE_PACK_BOUNDARIES.LINEAGE_CERTIFICATION]: new Set(['PASS', 'PASSED', 'RETAINED']),
})
const REQUIRED_CHECK_BY_BOUNDARY = Object.freeze({
  [KNOWLEDGE_PACK_BOUNDARIES.PRE_GENERATION_VALIDATION]: 'PRE_VALIDATION_PASSED',
  [KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION]: 'POST_VALIDATION_PASSED',
  [KNOWLEDGE_PACK_BOUNDARIES.LINEAGE_CERTIFICATION]: 'LINEAGE_RETAINED',
})

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()

export const sanitizeOutcomeBoundaryReceipt = (receipt = {}) => ({
  contractVersion: normalizeText(
    receipt.contractVersion || OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
  ),
  versionId: normalizeText(receipt.versionId),
  contentHash: normalizeText(receipt.contentHash),
  boundary: normalizeToken(receipt.boundary),
  receiptType: normalizeToken(receipt.receiptType),
  receiptKey: normalizeText(receipt.receiptKey),
  validatorKey: normalizeText(receipt.validatorKey).toLowerCase(),
  result: normalizeToken(receipt.result),
  evidenceReference: normalizeText(receipt.evidenceReference),
  status: normalizeToken(receipt.status),
})

export const validateOutcomeBoundaryReceipt = ({
  expectedPack = {},
  receipt = {},
} = {}) => {
  const safeReceipt = sanitizeOutcomeBoundaryReceipt(receipt)
  const expectedVersionId = normalizeText(expectedPack.versionId)
  const expectedContentHash = normalizeText(expectedPack.contentHash)
  const expectedBoundary = resolveKnowledgePackBoundary(expectedPack)
  const expectedReceiptType = resolveKnowledgePackReceiptType(expectedPack)
  const failures = []

  if (safeReceipt.contractVersion !== OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION) {
    failures.push('CONTRACT_VERSION_UNSUPPORTED')
  }
  if (!expectedVersionId || safeReceipt.versionId !== expectedVersionId) {
    failures.push('VERSION_ID_MISMATCH')
  }
  if (!expectedContentHash || safeReceipt.contentHash !== expectedContentHash) {
    failures.push('CONTENT_HASH_MISMATCH')
  }
  if (!Object.values(KNOWLEDGE_PACK_BOUNDARIES).includes(expectedBoundary)) {
    failures.push('BOUNDARY_NOT_DECLARED')
  }
  if (safeReceipt.boundary !== expectedBoundary) failures.push('BOUNDARY_MISMATCH')
  if (safeReceipt.receiptType !== expectedReceiptType) failures.push('RECEIPT_TYPE_MISMATCH')
  if (!Object.values(KNOWLEDGE_PACK_RECEIPT_TYPES).includes(safeReceipt.receiptType)) {
    failures.push('RECEIPT_TYPE_NOT_DECLARED')
  }
  if (!safeReceipt.receiptKey) failures.push('RECEIPT_KEY_MISSING')
  if (!safeReceipt.validatorKey) failures.push('VALIDATOR_KEY_MISSING')
  if (!safeReceipt.evidenceReference) failures.push('EVIDENCE_REFERENCE_MISSING')
  if (safeReceipt.status !== PASSED_STATUS) failures.push('STATUS_NOT_PASSED')

  const validResults = VALID_RESULTS_BY_BOUNDARY[expectedBoundary] || new Set()
  if (!validResults.has(safeReceipt.result)) failures.push('RESULT_NOT_ACCEPTED')

  const requiredCheck = REQUIRED_CHECK_BY_BOUNDARY[expectedBoundary]
  if (requiredCheck && !Array.isArray(receipt.checks)) {
    failures.push('BOUNDARY_CHECKS_MISSING')
  } else if (requiredCheck) {
    const matchingChecks = receipt.checks.filter((check) => (
      normalizeToken(check?.key) === requiredCheck
      && normalizeToken(check?.status) === PASSED_STATUS
    ))
    if (matchingChecks.length === 0) failures.push('BOUNDARY_CHECK_NOT_PASSED')
  }

  return {
    valid: failures.length === 0,
    failures: [...new Set(failures)],
    receipt: safeReceipt,
    expected: {
      versionId: expectedVersionId,
      contentHash: expectedContentHash,
      boundary: expectedBoundary,
      receiptType: expectedReceiptType,
      requiredCheck,
    },
  }
}
