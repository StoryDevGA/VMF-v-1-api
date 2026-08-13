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

export const TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_CONTRACT_VERSION =
  'outcome-studio.truth-certification-framework-executor.v1'
export const TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_KEY = 'truth-certification-framework'
export const TRUTH_CERTIFICATION_FRAMEWORK_RECEIPT_KEY =
  'truth-certification-framework.post-validation.v1'

export const OUTCOME_EVIDENCE_KINDS = Object.freeze({
  PACK_EXECUTION: 'PACK_EXECUTION',
  PACK_RECEIPT: 'PACK_RECEIPT',
  FRAMEWORK_CONTROL: 'FRAMEWORK_CONTROL',
  NOT_RECORDED: 'NOT_RECORDED',
})

export const TRUTH_CERTIFICATION_FRAMEWORK_REQUIRED_VALIDATORS = Object.freeze([
  'truth-quality-dimensions',
  'certification-levels',
  'blocking-rules',
  'runtime-warning-rules',
  'prohibited-output-claims',
  'truth-certification-pack',
])
export const TRUTH_CERTIFICATION_FRAMEWORK_PACK_EXECUTION_CHECK_KEYS = Object.freeze([
  'PACK_IDENTITY_BOUND',
  'VERSION_CONTENT_LOADED',
  'PACK_CONTENT_HASH_VERIFIED',
  'FRAMEWORK_PROCESS_LOADED',
  'POST_VALIDATION_PASSED',
  'BOUNDARY_RECEIPT_RECORDED',
  'BOUNDARY_RECEIPT_CONTRACT_VALID',
])
export const TRUTH_CERTIFICATION_FRAMEWORK_PACK_RECEIPT_CHECK_KEYS = Object.freeze([
  'DEPENDENCY_RECEIPT_SET_BOUND',
  ...TRUTH_CERTIFICATION_FRAMEWORK_REQUIRED_VALIDATORS.map(
    (validatorKey) => `DEPENDENCY_${validatorKey.replace(/-/g, '_').toUpperCase()}_RECEIPT`,
  ),
  'CERTIFICATION_OUTCOME_BOUND',
  'WARNING_RESULT_BOUND',
])
export const TRUTH_CERTIFICATION_FRAMEWORK_CONTROL_CHECK_KEYS = Object.freeze([
  'TRUTH_PRESERVATION_CONTROL',
  'LINEAGE_PRESERVATION_CONTROL',
])
export const TRUTH_CERTIFICATION_FRAMEWORK_EVIDENCE_KIND_BY_CHECK_KEY = Object.freeze(
  Object.fromEntries([
    ...TRUTH_CERTIFICATION_FRAMEWORK_PACK_EXECUTION_CHECK_KEYS.map((key) => (
      [key, OUTCOME_EVIDENCE_KINDS.PACK_EXECUTION]
    )),
    ...TRUTH_CERTIFICATION_FRAMEWORK_PACK_RECEIPT_CHECK_KEYS.map((key) => (
      [key, OUTCOME_EVIDENCE_KINDS.PACK_RECEIPT]
    )),
    ...TRUTH_CERTIFICATION_FRAMEWORK_CONTROL_CHECK_KEYS.map((key) => (
      [key, OUTCOME_EVIDENCE_KINDS.FRAMEWORK_CONTROL]
    )),
  ]),
)

const REQUIRED_SECTIONS = Object.freeze([
  'Governing Principle',
  'Required Inputs',
  'Certification Process',
  'Certification Outcome',
  'Decision Rules',
  'Dependencies',
])
const REQUIRED_DEPENDENCIES = Object.freeze([
  'truth quality dimensions',
  'certification levels',
  'blocking rules',
  'runtime warning rules',
  'prohibited output claims',
  'truth preservation rules',
  'lineage preservation rules',
])
const STATUSES = Object.freeze({ PASSED: 'PASSED', FAILED: 'FAILED', NOT_RECORDED: 'NOT_RECORDED' })
const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeKey = (value) => normalizeText(value).toLowerCase()
const sha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const sectionBody = (content, heading) => {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^##\\s+${escaped}\\s*$`, 'im').exec(content)
  if (!match) return ''
  const rest = content.slice(match.index + match[0].length)
  const next = /^##\s+/im.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

const check = ({ key, pass, message, evidenceKind }) => ({
  key: normalizeToken(key),
  status: pass ? STATUSES.PASSED : STATUSES.FAILED,
  message: normalizeText(message),
  source: TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_KEY,
  evidenceKind,
})

export const validateTruthCertificationFrameworkReceiptChecks = (checks = []) => {
  const failures = []
  if (!Array.isArray(checks) || checks.length === 0) {
    return { valid: false, failures: ['FRAMEWORK_RECEIPT_CHECKS_MISSING'] }
  }
  for (const candidate of checks) {
    const key = normalizeToken(candidate?.key)
    const expectedKind = TRUTH_CERTIFICATION_FRAMEWORK_EVIDENCE_KIND_BY_CHECK_KEY[key]
    const actualKind = normalizeToken(candidate?.evidenceKind)
    if (!expectedKind) {
      failures.push(`UNKNOWN_FRAMEWORK_CHECK_KEY:${key || 'MISSING'}`)
      continue
    }
    if (actualKind !== expectedKind) {
      failures.push(`FRAMEWORK_CHECK_KIND_MISMATCH:${key}`)
    }
  }
  return { valid: failures.length === 0, failures: [...new Set(failures)] }
}

export const parseTruthCertificationFrameworkMarkdown = (packContent) => {
  if (typeof packContent !== 'string' || !normalizeText(packContent)) {
    return { valid: false, failures: ['PACK_CONTENT_NOT_AVAILABLE'], sections: {} }
  }
  const sections = Object.fromEntries(REQUIRED_SECTIONS.map((heading) => [heading, sectionBody(packContent, heading)]))
  const failures = REQUIRED_SECTIONS.filter((heading) => !sections[heading]).map((heading) => (
    `SECTION_${normalizeToken(heading).replace(/\s+/g, '_')}_MISSING`
  ))
  const process = normalizeKey(sections['Certification Process'])
  if (!process.includes('apply all blocking rules before assigning a certification level')) failures.push('PROCESS_BLOCKING_ORDER_MISSING')
  if (!process.includes('highest certification level') || !process.includes('minimum requirements')) failures.push('PROCESS_HIGHEST_LEVEL_RULE_MISSING')
  if (!process.includes('warnings and known gaps')) failures.push('PROCESS_WARNING_GAP_RULE_MISSING')
  if (!process.includes('downstream lineage')) failures.push('PROCESS_LINEAGE_RULE_MISSING')
  const dependencies = normalizeKey(sections.Dependencies)
  REQUIRED_DEPENDENCIES.forEach((dependency) => {
    if (!dependencies.includes(dependency)) failures.push(`DEPENDENCY_${normalizeToken(dependency).replace(/\s+/g, '_')}_MISSING`)
  })
  return { valid: failures.length === 0, failures, sections }
}

const buildDiagnosticEvidence = ({ pack, checks, status, executionId, assetId, assetVersionId }) => ({
  contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
  versionId: normalizeText(pack.versionId),
  contentHash: normalizeText(pack.contentHash),
  boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
  receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
  receiptKey: TRUTH_CERTIFICATION_FRAMEWORK_RECEIPT_KEY,
  validatorKey: TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_KEY,
  result: 'BLOCK',
  evidenceReference: `outcome:${assetId}:${assetVersionId}:${TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_KEY}:${executionId}`,
  status,
  checks,
  diagnosticOnly: true,
})

const blocked = ({ pack, checks, failures, status, executionId, assetId, assetVersionId }) => ({
  contractVersion: TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_CONTRACT_VERSION,
  executorKey: TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_KEY,
  executionId,
  status,
  result: 'BLOCK',
  receipt: null,
  diagnosticEvidence: buildDiagnosticEvidence({ pack, checks, status, executionId, assetId, assetVersionId }),
  checks,
  failures: [...new Set(failures.map(normalizeToken).filter(Boolean))],
})

const receiptReferencePrefix = (assetId, assetVersionId, validatorKey) => (
  `outcome:${assetId}:${assetVersionId}:${validatorKey}:`
)

export const finalizeTruthCertificationFrameworkReceipt = ({
  pack = {},
  receipt = {},
  checks = [],
  executionId = '',
  assetId = '',
  assetVersionId = '',
  assignedLevel = '',
  warnings = [],
} = {}) => {
  const checkValidation = validateTruthCertificationFrameworkReceiptChecks(receipt?.checks)
  if (!checkValidation.valid) {
    return blocked({
      pack,
      checks: [
        ...checks,
        check({
          key: 'BOUNDARY_RECEIPT_CONTRACT_VALID',
          pass: false,
          evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_EXECUTION,
          message: `Generated receipt contains invalid framework check evidence: ${checkValidation.failures.join(', ')}.`,
        }),
      ],
      failures: ['BOUNDARY_RECEIPT_CHECK_KIND_INVALID'],
      status: STATUSES.FAILED,
      executionId,
      assetId,
      assetVersionId,
    })
  }
  const validation = validateOutcomeBoundaryReceipt({ expectedPack: pack, receipt })
  if (!validation.valid) {
    return blocked({
      pack,
      checks: [
        ...checks,
        check({
          key: 'BOUNDARY_RECEIPT_CONTRACT_VALID',
          pass: false,
          evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_EXECUTION,
          message: `Generated receipt failed strict validation: ${validation.failures.join(', ')}.`,
        }),
      ],
      failures: ['BOUNDARY_RECEIPT_CONTRACT_INVALID'],
      status: STATUSES.FAILED,
      executionId,
      assetId,
      assetVersionId,
    })
  }
  return {
    contractVersion: TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_CONTRACT_VERSION,
    executorKey: TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_KEY,
    executionId,
    status: STATUSES.PASSED,
    result: 'ALLOW',
    receipt,
    diagnosticEvidence: null,
    checks,
    failures: [],
    assignedLevel,
    warnings: [...warnings],
  }
}

export const executeTruthCertificationFramework = ({
  pack = {},
  packContent = '',
  expectedPacksByValidatorKey = {},
  dependencyReceipts = [],
  certificationLevelsExecution = null,
  runtimeWarningExecution = null,
  lineageEvidence = {},
  postValidation = {},
  asset = {},
  version = {},
  executionId = `truth_certification_framework_exec_${randomUUID()}`,
} = {}) => {
  const checks = []
  const failures = []
  const assetId = normalizeText(asset.outcomeAssetId || asset.assetId)
  const assetVersionId = normalizeText(version.outcomeAssetVersionId || version.versionId)
  const identityPass = normalizeKey(pack.packKey || pack.key) === TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_KEY
    && Boolean(pack.versionId && pack.contentHash && assetId && assetVersionId)
    && resolveKnowledgePackBoundary(pack) === KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION
  checks.push(check({ key: 'PACK_IDENTITY_BOUND', pass: identityPass, evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_EXECUTION, message: identityPass ? 'Exact framework pack, version, hash, boundary, asset, and iteration are bound.' : 'Exact framework pack identity and draft iteration are required.' }))
  if (!identityPass) failures.push('PACK_IDENTITY_INVALID')

  const contentLoaded = typeof packContent === 'string' && Boolean(normalizeText(packContent))
  checks.push(check({ key: 'VERSION_CONTENT_LOADED', pass: contentLoaded, evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_EXECUTION, message: contentLoaded ? 'Raw server-side framework version content was loaded.' : 'Framework version content is unavailable.' }))
  if (!contentLoaded) failures.push('PACK_CONTENT_NOT_AVAILABLE')
  const hashPass = contentLoaded && /^sha256:[a-f0-9]{64}$/.test(normalizeText(pack.contentHash)) && sha256(packContent) === normalizeText(pack.contentHash)
  checks.push(check({ key: 'PACK_CONTENT_HASH_VERIFIED', pass: hashPass, evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_EXECUTION, message: hashPass ? 'Loaded framework content matches the selected content hash.' : 'Loaded framework content does not match the selected content hash.' }))
  if (!hashPass) failures.push('PACK_CONTENT_HASH_MISMATCH')
  const parsed = parseTruthCertificationFrameworkMarkdown(packContent)
  checks.push(check({ key: 'FRAMEWORK_PROCESS_LOADED', pass: parsed.valid, evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_EXECUTION, message: parsed.valid ? 'Source-defined certification process and all seven dependency names were loaded.' : 'The active framework source is incomplete or not executable.' }))
  failures.push(...parsed.failures)
  if (failures.length) return blocked({ pack, checks, failures, status: !contentLoaded || !parsed.valid ? STATUSES.NOT_RECORDED : STATUSES.FAILED, executionId, assetId, assetVersionId })

  const receipts = Array.isArray(dependencyReceipts) ? dependencyReceipts.filter(Boolean) : []
  const permitted = new Set(TRUTH_CERTIFICATION_FRAMEWORK_REQUIRED_VALIDATORS)
  const receiptKeys = receipts.map((receipt) => normalizeKey(receipt.validatorKey))
  const setPass = receipts.length === TRUTH_CERTIFICATION_FRAMEWORK_REQUIRED_VALIDATORS.length
    && receiptKeys.every((key) => permitted.has(key))
    && new Set(receiptKeys).size === receiptKeys.length
  checks.push(check({ key: 'DEPENDENCY_RECEIPT_SET_BOUND', pass: setPass, evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_RECEIPT, message: setPass ? 'Exactly six unique selected sibling receipt validators were supplied.' : 'Sibling receipt set is missing, duplicated, or contains an unselected validator.' }))
  if (!setPass) failures.push('DEPENDENCY_RECEIPT_SET_INVALID')

  const validatedReceipts = new Map()
  for (const validatorKey of TRUTH_CERTIFICATION_FRAMEWORK_REQUIRED_VALIDATORS) {
    const expectedPack = expectedPacksByValidatorKey?.[validatorKey]
    const matches = receipts.filter((receipt) => normalizeKey(receipt.validatorKey) === validatorKey)
    const receipt = matches[0]
    const validation = validateOutcomeBoundaryReceipt({ expectedPack: expectedPack || {}, receipt: receipt || {} })
    const pass = Boolean(expectedPack) && matches.length === 1 && validation.valid
      && normalizeKey(receipt?.validatorKey) === validatorKey
      && normalizeText(receipt?.evidenceReference).startsWith(receiptReferencePrefix(assetId, assetVersionId, validatorKey))
    checks.push(check({ key: `DEPENDENCY_${validatorKey.replace(/-/g, '_')}_RECEIPT`, pass, evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_RECEIPT, message: pass ? `Exact ${validatorKey} receipt is valid for this draft iteration.` : `Exact ${validatorKey} receipt is missing, invalid, or bound to another draft iteration.` }))
    if (pass) validatedReceipts.set(validatorKey, receipt)
    else failures.push(`DEPENDENCY_${validatorKey.replace(/-/g, '_')}_INVALID`)
  }

  const certificationReceipt = validatedReceipts.get('certification-levels')
  const certificationBound = normalizeToken(certificationLevelsExecution?.status) === STATUSES.PASSED
    && normalizeText(certificationLevelsExecution?.assignedLevel)
    && certificationLevelsExecution?.receipt === certificationReceipt
    && certificationLevelsExecution?.receipt?.evidenceReference === certificationReceipt?.evidenceReference
  checks.push(check({ key: 'CERTIFICATION_OUTCOME_BOUND', pass: Boolean(certificationBound), evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_RECEIPT, message: certificationBound ? `Assigned level ${certificationLevelsExecution.assignedLevel} is bound to its passed receipt.` : 'Assigned certification level is not bound to the supplied passed execution.' }))
  if (!certificationBound) failures.push('CERTIFICATION_OUTCOME_NOT_BOUND')

  const warningReceipt = validatedReceipts.get('runtime-warning-rules')
  const warningBound = normalizeToken(runtimeWarningExecution?.status) === STATUSES.PASSED
    && Array.isArray(runtimeWarningExecution?.warnings)
    && runtimeWarningExecution?.receipt === warningReceipt
    && runtimeWarningExecution?.receipt?.evidenceReference === warningReceipt?.evidenceReference
  checks.push(check({ key: 'WARNING_RESULT_BOUND', pass: warningBound, evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_RECEIPT, message: warningBound ? `${runtimeWarningExecution.warnings.length} warning results are bound to their passed receipt.` : 'Warning results are not bound to the supplied passed execution.' }))
  if (!warningBound) failures.push('WARNING_RESULT_NOT_BOUND')

  const postValidationPass = ['PASS', 'PASSED'].includes(normalizeToken(postValidation.status))
    && normalizeToken(postValidation.result) === 'ALLOW'
    && normalizeText(postValidation.outcomeAssetId) === assetId
    && normalizeText(postValidation.outcomeAssetVersionId) === assetVersionId
  const truthControlPass = validatedReceipts.has('truth-certification-pack') && postValidationPass
  checks.push(check({ key: 'TRUTH_PRESERVATION_CONTROL', pass: truthControlPass, evidenceKind: OUTCOME_EVIDENCE_KINDS.FRAMEWORK_CONTROL, message: truthControlPass ? 'Equivalent truth-preservation framework control passed; this is not a separate pack execution.' : 'Equivalent truth-preservation control lacks an exact truth receipt or asset-level ALLOW result.' }))
  if (!truthControlPass) failures.push('TRUTH_PRESERVATION_CONTROL_FAILED')

  const lineage = {
    truthSignatureId: normalizeText(lineageEvidence.truthSignatureId),
    truthSignatureStatus: normalizeToken(lineageEvidence.truthSignatureStatus),
    truthSignatureCurrentness: normalizeToken(lineageEvidence.truthSignatureCurrentness),
    runtimeRevision: normalizeText(lineageEvidence.runtimeRevision),
    graphVersion: normalizeText(lineageEvidence.graphVersion),
    publishSnapshotId: normalizeText(lineageEvidence.publishSnapshotId),
    lockSnapshotId: normalizeText(lineageEvidence.lockSnapshotId),
    replayAnchorId: normalizeText(lineageEvidence.replayAnchorId),
    sourceOutputAssetId: normalizeText(lineageEvidence.sourceOutputAssetId),
    grrExecutionId: normalizeText(lineageEvidence.grrExecutionId),
    grrRuntimeArtifactId: normalizeText(lineageEvidence.grrRuntimeArtifactId),
  }
  const lineagePass = lineage.truthSignatureStatus === 'PROJECTED'
    && lineage.truthSignatureCurrentness === 'CURRENT'
    && Object.entries(lineage).every(([, value]) => Boolean(value))
  checks.push(check({ key: 'LINEAGE_PRESERVATION_CONTROL', pass: lineagePass, evidenceKind: OUTCOME_EVIDENCE_KINDS.FRAMEWORK_CONTROL, message: lineagePass ? 'Equivalent lineage-preservation framework control passed from field-owned generation-time evidence; this is not a separate pack execution.' : 'Equivalent lineage-preservation control is missing current truth or generation-time lineage fields.' }))
  if (!lineagePass) failures.push('LINEAGE_PRESERVATION_CONTROL_FAILED')

  if (failures.length) return blocked({ pack, checks, failures, status: STATUSES.FAILED, executionId, assetId, assetVersionId })

  const receiptChecks = [
    ...checks,
    check({ key: 'POST_VALIDATION_PASSED', pass: true, evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_EXECUTION, message: 'Truth Certification Framework passed for the exact draft iteration.' }),
    check({ key: 'BOUNDARY_RECEIPT_RECORDED', pass: true, evidenceKind: OUTCOME_EVIDENCE_KINDS.PACK_EXECUTION, message: 'Exact framework boundary receipt was recorded.' }),
  ]
  const receipt = {
    contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
    versionId: normalizeText(pack.versionId),
    contentHash: normalizeText(pack.contentHash),
    boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
    receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    receiptKey: TRUTH_CERTIFICATION_FRAMEWORK_RECEIPT_KEY,
    validatorKey: TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_KEY,
    result: 'ALLOW',
    evidenceReference: `outcome:${assetId}:${assetVersionId}:${TRUTH_CERTIFICATION_FRAMEWORK_EXECUTOR_KEY}:${executionId}`,
    status: STATUSES.PASSED,
    checks: receiptChecks,
  }
  return finalizeTruthCertificationFrameworkReceipt({
    pack,
    receipt,
    checks: receiptChecks,
    assignedLevel: certificationLevelsExecution.assignedLevel,
    warnings: [...runtimeWarningExecution.warnings],
    executionId,
    assetId,
    assetVersionId,
  })
}

export default executeTruthCertificationFramework
