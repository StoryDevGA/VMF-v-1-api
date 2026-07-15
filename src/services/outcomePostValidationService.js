import { randomUUID } from 'node:crypto'

export const OUTCOME_POST_VALIDATION_CONTRACT_VERSION = 'outcome-post-validation.v1'

export const OUTCOME_POST_VALIDATION_MODES = Object.freeze({
  FOUNDATION_STATIC_CHECKS: 'FOUNDATION_STATIC_CHECKS',
})

export const OUTCOME_POST_VALIDATION_STATUSES = Object.freeze({
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
})

export const OUTCOME_POST_VALIDATION_RESULTS = Object.freeze({
  ALLOW: 'ALLOW',
  BLOCK: 'BLOCK',
})

const MAX_VALIDATOR_RESULTS = 10
const MAX_VALIDATION_ISSUES = 10

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()

const isPlainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const hasCustomerContent = (customerContent = {}) => {
  if (!isPlainObject(customerContent)) return false
  if (normalizeText(customerContent.markdown)) return true
  if (Array.isArray(customerContent.sections)) {
    return customerContent.sections.some((section) =>
      normalizeText(section?.body) || normalizeText(section?.markdown))
  }
  return false
}

const buildIssue = ({
  code,
  message,
  path,
  severity = 'BLOCKING',
  source = 'outcome-post-validation',
} = {}) => ({
  code: normalizeToken(code || 'OUTCOME_POST_VALIDATION_FAILED'),
  severity: normalizeToken(severity || 'BLOCKING'),
  message: normalizeText(message || 'Outcome Studio post-validation failed.'),
  path: normalizeText(path),
  source: normalizeText(source || 'outcome-post-validation'),
})

const buildValidatorResult = ({
  code,
  label,
  pass,
  message,
  path,
} = {}) => {
  const status = pass ? OUTCOME_POST_VALIDATION_STATUSES.PASS : OUTCOME_POST_VALIDATION_STATUSES.FAIL
  return {
    validatorKey: normalizeText(code).toLowerCase(),
    label: normalizeText(label),
    status,
    severity: pass ? 'INFO' : 'BLOCKING',
    message: normalizeText(message),
    path: normalizeText(path),
  }
}

const buildSummary = (validators = []) => {
  const failed = validators.filter((validator) => validator.status === OUTCOME_POST_VALIDATION_STATUSES.FAIL).length
  const warnings = validators.filter((validator) => validator.status === OUTCOME_POST_VALIDATION_STATUSES.WARN).length
  return {
    totalChecks: validators.length,
    passed: validators.length - failed - warnings,
    warnings,
    failed,
  }
}

export const buildOutcomeAssetPostValidationSnapshot = ({
  asset = {},
  customerContent = {},
  knowledgePackBinding = {},
  truthSignature = {},
  validatedAt = new Date().toISOString(),
  version = {},
} = {}) => {
  const truthCurrent = normalizeToken(truthSignature.currentness) === 'CURRENT'
  const activeCount = Number(knowledgePackBinding.activeCount || 0)
  const requiredCount = Number(knowledgePackBinding.requiredCount || 0)
  const bindingStatus = normalizeToken(knowledgePackBinding.status)
  // READY_WITH_GAPS means every required safeguard resolved; only optional context is absent.
  const bindingPass = ['PROJECTED', 'READY', 'READY_WITH_GAPS'].includes(bindingStatus)
    && requiredCount > 0
    && activeCount >= requiredCount
  const contentPass = hasCustomerContent(customerContent)

  const validators = [
    buildValidatorResult({
      code: 'truth-boundary-preservation',
      label: 'Truth boundary preservation',
      pass: truthCurrent,
      message: truthCurrent
        ? 'Truth Signature is current for the generated asset.'
        : 'Truth Signature is not current for the generated asset.',
      path: 'truthSignature.currentness',
    }),
    buildValidatorResult({
      code: 'knowledge-binding-preservation',
      label: 'Knowledge binding preservation',
      pass: bindingPass,
      message: bindingPass
        ? 'Knowledge Pack binding is complete for the generated asset.'
        : 'Knowledge Pack binding is missing or incomplete for the generated asset.',
      path: 'knowledgePackBinding',
    }),
    buildValidatorResult({
      code: 'customer-content-presence',
      label: 'Customer content presence',
      pass: contentPass,
      message: contentPass
        ? 'Customer-facing generated content is present.'
        : 'Customer-facing generated content is missing.',
      path: 'customerContent',
    }),
  ]
  const issues = validators
    .filter((validator) => validator.status === OUTCOME_POST_VALIDATION_STATUSES.FAIL)
    .map((validator) => buildIssue({
      code: validator.validatorKey,
      message: validator.message,
      path: validator.path,
      source: 'outcome-post-validation',
    }))
  const summary = buildSummary(validators)
  const blocked = summary.failed > 0

  return {
    contractVersion: OUTCOME_POST_VALIDATION_CONTRACT_VERSION,
    validationId: `outcome_post_val_${randomUUID()}`,
    mode: OUTCOME_POST_VALIDATION_MODES.FOUNDATION_STATIC_CHECKS,
    validationScope: 'OUTCOME_ASSET_VERSION',
    status: blocked ? OUTCOME_POST_VALIDATION_STATUSES.FAIL : OUTCOME_POST_VALIDATION_STATUSES.PASS,
    result: blocked ? OUTCOME_POST_VALIDATION_RESULTS.BLOCK : OUTCOME_POST_VALIDATION_RESULTS.ALLOW,
    validatedAt,
    outcomeAssetId: normalizeText(asset.outcomeAssetId),
    outcomeAssetVersionId: normalizeText(version.outcomeAssetVersionId),
    outputTypeKey: normalizeToken(asset.outputTypeKey || version.outputTypeKey),
    manifestId: normalizeText(knowledgePackBinding.manifestId),
    manifestKey: normalizeText(knowledgePackBinding.manifestKey),
    manifestVersion: normalizeText(knowledgePackBinding.manifestVersion),
    contentIncludedInValidation: false,
    rawPackContentIncluded: false,
    validators,
    issues,
    summary,
  }
}

const sanitizeValidator = (validator = {}) => ({
  validatorKey: normalizeText(validator.validatorKey).toLowerCase(),
  label: normalizeText(validator.label),
  status: normalizeToken(validator.status),
  severity: normalizeToken(validator.severity || 'INFO'),
  message: normalizeText(validator.message),
  path: normalizeText(validator.path),
})

const sanitizeIssue = (issue = {}) => ({
  code: normalizeToken(issue.code),
  severity: normalizeToken(issue.severity || 'BLOCKING'),
  message: normalizeText(issue.message),
  path: normalizeText(issue.path),
  source: normalizeText(issue.source || 'outcome-post-validation'),
})

export const sanitizeOutcomePostValidationSnapshot = (snapshot) => {
  if (!isPlainObject(snapshot)) return null

  const validators = Array.isArray(snapshot.validators)
    ? snapshot.validators.slice(0, MAX_VALIDATOR_RESULTS).map(sanitizeValidator).filter((validator) => validator.validatorKey)
    : []
  const issues = Array.isArray(snapshot.issues)
    ? snapshot.issues.slice(0, MAX_VALIDATION_ISSUES).map(sanitizeIssue).filter((issue) => issue.code)
    : []
  const summary = isPlainObject(snapshot.summary)
    ? {
        totalChecks: Number(snapshot.summary.totalChecks || 0),
        passed: Number(snapshot.summary.passed || 0),
        warnings: Number(snapshot.summary.warnings || 0),
        failed: Number(snapshot.summary.failed || 0),
      }
    : buildSummary(validators)

  return {
    contractVersion: normalizeText(snapshot.contractVersion || OUTCOME_POST_VALIDATION_CONTRACT_VERSION),
    validationId: normalizeText(snapshot.validationId),
    mode: normalizeToken(snapshot.mode || OUTCOME_POST_VALIDATION_MODES.FOUNDATION_STATIC_CHECKS),
    validationScope: normalizeToken(snapshot.validationScope || 'OUTCOME_ASSET_VERSION'),
    status: normalizeToken(snapshot.status),
    result: normalizeToken(snapshot.result),
    validatedAt: normalizeText(snapshot.validatedAt),
    outcomeAssetId: normalizeText(snapshot.outcomeAssetId),
    outcomeAssetVersionId: normalizeText(snapshot.outcomeAssetVersionId),
    outputTypeKey: normalizeToken(snapshot.outputTypeKey),
    manifestId: normalizeText(snapshot.manifestId),
    manifestKey: normalizeText(snapshot.manifestKey),
    manifestVersion: normalizeText(snapshot.manifestVersion),
    contentIncludedInValidation: snapshot.contentIncludedInValidation === true,
    rawPackContentIncluded: snapshot.rawPackContentIncluded === true,
    validators,
    issues,
    summary,
  }
}

export const isOutcomePostValidationAllowed = (snapshot) => {
  const safeSnapshot = sanitizeOutcomePostValidationSnapshot(snapshot)
  if (!safeSnapshot) return false
  if (safeSnapshot.result !== OUTCOME_POST_VALIDATION_RESULTS.ALLOW) return false
  return [
    OUTCOME_POST_VALIDATION_STATUSES.PASS,
    OUTCOME_POST_VALIDATION_STATUSES.WARN,
  ].includes(safeSnapshot.status)
}

export const buildOutcomePostValidationAuditSummary = (snapshot) => {
  const safeSnapshot = sanitizeOutcomePostValidationSnapshot(snapshot)
  if (!safeSnapshot) {
    return {
      status: 'MISSING',
      result: OUTCOME_POST_VALIDATION_RESULTS.BLOCK,
      validationId: '',
      summary: {
        totalChecks: 0,
        passed: 0,
        warnings: 0,
        failed: 0,
      },
    }
  }

  return {
    validationId: safeSnapshot.validationId,
    status: safeSnapshot.status,
    result: safeSnapshot.result,
    mode: safeSnapshot.mode,
    validatedAt: safeSnapshot.validatedAt,
    manifestId: safeSnapshot.manifestId,
    manifestKey: safeSnapshot.manifestKey,
    manifestVersion: safeSnapshot.manifestVersion,
    contentIncludedInValidation: safeSnapshot.contentIncludedInValidation,
    rawPackContentIncluded: safeSnapshot.rawPackContentIncluded,
    summary: safeSnapshot.summary,
  }
}
