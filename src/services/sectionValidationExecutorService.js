import { generateChecksum } from './governanceAudit/checksumService.js'
import {
  RUNTIME_INSTANCE_ERROR_REASONS,
  createRuntimeInstanceError,
} from './runtimeInstanceService.js'

export const SECTION_COMPLETENESS_EXECUTOR_VERSION =
  'section-completeness-check-v1'

export const SECTION_COMPLETENESS_BINDING = Object.freeze({
  selectionKey:
    'validation-completeness-check@1::skill-truth-integrity-validator@1',
  validationStableId: 'validation-completeness-check',
  validationKey: 'completeness-check',
  validationComponentVersion: 1,
  validationCategory: 'VALIDATION',
  validationSeverity: 'ERROR',
  validationExecutionMode: 'SYNC',
  validationResultType: 'OBJECT',
  validationOutputPath: 'framework_state.validation.completeness',
  validationPassFieldPath:
    'framework_state.validation.completeness.is_valid',
  validationDetailsFieldPath:
    'framework_state.validation.completeness.details',
  validationMessageFieldPath:
    'framework_state.validation.completeness.message',
  producerSkillStableId: 'skill-truth-integrity-validator',
  producerSkillKey: 'truth-integrity-validator',
  producerSkillComponentVersion: 1,
  producerSkillRoleKey: 'VALIDATOR',
  producerSkillCategory: 'VALIDATION',
  producerSkillType: 'DETERMINISTIC',
  producerSkillExecutionMode: 'SYSTEM',
  executorVersion: SECTION_COMPLETENESS_EXECUTOR_VERSION,
})

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toLowerCase()
const normalizeUpper = (value) => normalizeText(value).toUpperCase()
const toComponentVersion = (value) => {
  const version = Number(value)
  return Number.isInteger(version) && version > 0 ? version : 0
}
const isPlainObject = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const hasCompleteObjectContract = (contract, requiredFields = []) => {
  if (
    !isPlainObject(contract)
    || normalizeToken(contract.type) !== 'object'
    || !Array.isArray(contract.required)
    || !isPlainObject(contract.properties)
  ) {
    return false
  }

  const required = new Set(contract.required.map(normalizeToken).filter(Boolean))
  return requiredFields.every((field) =>
    required.has(normalizeToken(field))
    && isPlainObject(contract.properties[field]))
}

export const targetsSectionCompletenessBinding = (rule = {}) =>
  normalizeToken(rule.stableId) ===
    SECTION_COMPLETENESS_BINDING.validationStableId
  || normalizeToken(rule.key) === SECTION_COMPLETENESS_BINDING.validationKey

export const evaluateSectionValidationBindingCompatibility = ({
  producerSkill = {},
  rule = {},
} = {}) => {
  if (!targetsSectionCompletenessBinding(rule)) {
    return {
      supported: false,
      mismatchFields: [],
      executionBinding: null,
    }
  }

  const mismatchFields = []
  const retryPolicy = isPlainObject(rule.retryPolicy) ? rule.retryPolicy : {}
  const retryableErrorCodes = Array.isArray(retryPolicy.retryableErrorCodes)
    ? retryPolicy.retryableErrorCodes.map(normalizeUpper).filter(Boolean)
    : []

  if (
    normalizeToken(rule.stableId)
    !== SECTION_COMPLETENESS_BINDING.validationStableId
  ) mismatchFields.push('VALIDATION_STABLE_ID_MISMATCH')
  if (
    normalizeToken(rule.key)
    !== SECTION_COMPLETENESS_BINDING.validationKey
  ) mismatchFields.push('VALIDATION_KEY_MISMATCH')
  if (
    toComponentVersion(rule.componentVersion)
    !== SECTION_COMPLETENESS_BINDING.validationComponentVersion
  ) mismatchFields.push('VALIDATION_COMPONENT_VERSION_UNSUPPORTED')
  if (
    normalizeUpper(rule.category)
    !== SECTION_COMPLETENESS_BINDING.validationCategory
  ) mismatchFields.push('VALIDATION_CATEGORY_MISMATCH')
  if (
    normalizeUpper(rule.severity)
    !== SECTION_COMPLETENESS_BINDING.validationSeverity
  ) mismatchFields.push('VALIDATION_SEVERITY_MISMATCH')
  if (
    normalizeUpper(rule.executionMode)
    !== SECTION_COMPLETENESS_BINDING.validationExecutionMode
  ) mismatchFields.push('VALIDATION_EXECUTION_MODE_MISMATCH')
  if (rule.packageUsable !== true) {
    mismatchFields.push('VALIDATION_PACKAGE_USABLE_REQUIRED')
  }
  if (rule.blockingDefault !== true) {
    mismatchFields.push('VALIDATION_BLOCKING_REQUIRED')
  }
  if (rule.warningOnlyDefault !== false) {
    mismatchFields.push('VALIDATION_WARNING_ONLY_NOT_ALLOWED')
  }
  if (
    normalizeUpper(rule.resultType)
    !== SECTION_COMPLETENESS_BINDING.validationResultType
  ) mismatchFields.push('VALIDATION_RESULT_TYPE_MISMATCH')
  if (
    normalizeText(rule.outputPath)
    !== SECTION_COMPLETENESS_BINDING.validationOutputPath
  ) mismatchFields.push('VALIDATION_OUTPUT_PATH_MISMATCH')
  if (
    normalizeText(rule.passFieldPath)
    !== SECTION_COMPLETENESS_BINDING.validationPassFieldPath
  ) mismatchFields.push('VALIDATION_PASS_PATH_MISMATCH')
  if (
    normalizeText(rule.detailsFieldPath)
    !== SECTION_COMPLETENESS_BINDING.validationDetailsFieldPath
  ) mismatchFields.push('VALIDATION_DETAILS_PATH_MISMATCH')
  if (
    normalizeText(rule.messageFieldPath)
    !== SECTION_COMPLETENESS_BINDING.validationMessageFieldPath
  ) mismatchFields.push('VALIDATION_MESSAGE_PATH_MISMATCH')
  if (Number(retryPolicy.maxAttempts) !== 1) {
    mismatchFields.push('VALIDATION_SINGLE_ATTEMPT_REQUIRED')
  }
  if (Number(retryPolicy.backoffSeconds || 0) !== 0) {
    mismatchFields.push('VALIDATION_BACKOFF_NOT_ALLOWED')
  }
  if (retryableErrorCodes.length > 0) {
    mismatchFields.push('VALIDATION_RETRY_CODES_NOT_ALLOWED')
  }
  if (
    normalizeToken(rule.producerSkillId)
    !== SECTION_COMPLETENESS_BINDING.producerSkillStableId
  ) mismatchFields.push('VALIDATION_PRODUCER_SKILL_MISMATCH')

  if (
    normalizeToken(producerSkill.stableId)
    !== SECTION_COMPLETENESS_BINDING.producerSkillStableId
  ) mismatchFields.push('PRODUCER_SKILL_STABLE_ID_MISMATCH')
  if (
    normalizeToken(producerSkill.key)
    !== SECTION_COMPLETENESS_BINDING.producerSkillKey
  ) mismatchFields.push('PRODUCER_SKILL_KEY_MISMATCH')
  if (
    toComponentVersion(producerSkill.componentVersion)
    !== SECTION_COMPLETENESS_BINDING.producerSkillComponentVersion
  ) mismatchFields.push('PRODUCER_SKILL_COMPONENT_VERSION_UNSUPPORTED')
  if (
    normalizeUpper(producerSkill.skillRoleKey)
    !== SECTION_COMPLETENESS_BINDING.producerSkillRoleKey
  ) mismatchFields.push('PRODUCER_SKILL_ROLE_MISMATCH')
  if (
    normalizeUpper(producerSkill.category)
    !== SECTION_COMPLETENESS_BINDING.producerSkillCategory
  ) mismatchFields.push('PRODUCER_SKILL_CATEGORY_MISMATCH')
  if (
    normalizeUpper(producerSkill.type)
    !== SECTION_COMPLETENESS_BINDING.producerSkillType
  ) mismatchFields.push('PRODUCER_SKILL_TYPE_MISMATCH')
  if (
    normalizeUpper(producerSkill.executionMode)
    !== SECTION_COMPLETENESS_BINDING.producerSkillExecutionMode
  ) mismatchFields.push('PRODUCER_SKILL_EXECUTION_MODE_MISMATCH')
  if (!hasCompleteObjectContract(producerSkill.inputContract, [
    'frameworkKey',
    'frameworkVersion',
    'frameworkState',
  ])) mismatchFields.push('PRODUCER_SKILL_INPUT_CONTRACT_INCOMPLETE')
  if (!hasCompleteObjectContract(producerSkill.outputContract, [
    'is_valid',
    'message',
    'result',
    'traceability',
  ])) mismatchFields.push('PRODUCER_SKILL_OUTPUT_CONTRACT_INCOMPLETE')

  const uniqueMismatchFields = [...new Set(mismatchFields)].sort()

  return {
    supported: true,
    mismatchFields: uniqueMismatchFields,
    executionBinding: uniqueMismatchFields.length === 0
      ? {
          selectionKey: SECTION_COMPLETENESS_BINDING.selectionKey,
          executorVersion: SECTION_COMPLETENESS_BINDING.executorVersion,
          mode: 'SERVER_SYSTEM_DETERMINISTIC',
          producerSkill: {
            stableId: SECTION_COMPLETENESS_BINDING.producerSkillStableId,
            key: SECTION_COMPLETENESS_BINDING.producerSkillKey,
            componentVersion:
              SECTION_COMPLETENESS_BINDING.producerSkillComponentVersion,
          },
        }
      : null,
  }
}

const buildExecutionError = ({
  contractIssue,
  message,
  details = {},
}) => createRuntimeInstanceError({
  status: 409,
  code: 'CONFLICT',
  message,
  reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
  details: {
    contractIssue,
    ...details,
  },
})

const buildCompletenessChecks = ({
  candidate = {},
  checkedAt,
  sectionExecutionContract = {},
} = {}) => {
  const generatedSections = Array.isArray(candidate.sections)
    ? candidate.sections
    : []
  const generator = isPlainObject(candidate.generator) ? candidate.generator : {}
  const truthEligibility = isPlainObject(candidate.truthEligibility)
    ? candidate.truthEligibility
    : {}

  return [
    {
      checkKey: 'generated_format',
      passed: Boolean(normalizeText(candidate.format)),
    },
    {
      checkKey: 'generated_content',
      passed: Boolean(normalizeText(candidate.content)),
    },
    {
      checkKey: 'generated_summary',
      passed: Boolean(normalizeText(candidate.summary)),
    },
    {
      checkKey: 'generated_sections',
      passed: generatedSections.length > 0
        && generatedSections.every((section) =>
          isPlainObject(section)
          && Boolean(normalizeText(section.heading))
          && Boolean(normalizeText(section.body))
          && Array.isArray(section.bullets)),
    },
    {
      checkKey: 'generator_contract',
      passed: Boolean(
        normalizeText(generator.contractVersion)
        && normalizeText(generator.sectionContractHash)
        && normalizeText(sectionExecutionContract.contractVersion)
        && normalizeText(sectionExecutionContract.sectionContractHash)
        && normalizeText(generator.contractVersion)
          === normalizeText(sectionExecutionContract.contractVersion)
        && normalizeText(generator.sectionContractHash)
          === normalizeText(sectionExecutionContract.sectionContractHash),
      ),
    },
    {
      checkKey: 'generation_hashes',
      passed: [
        candidate.inputHash,
        candidate.evidenceHash,
        candidate.sectionEvidenceHash,
        candidate.dependencyHash,
        candidate.boundedContextHash,
      ].every((value) => Boolean(normalizeText(value))),
    },
    {
      checkKey: 'truth_eligibility',
      passed: typeof truthEligibility.eligible === 'boolean'
        && Boolean(normalizeText(truthEligibility.status)),
    },
    {
      checkKey: 'supporting_evidence_refs',
      passed: Array.isArray(candidate.supportingEvidenceRefs),
    },
    {
      checkKey: 'checked_at',
      passed: Boolean(normalizeText(checkedAt))
        && normalizeText(checkedAt) === normalizeText(candidate.generatedAt),
    },
  ]
}

const executeCompletenessCheck = ({
  candidate,
  checkedAt,
  rule,
  sectionExecutionContract,
} = {}) => {
  const sectionIdentity = isPlainObject(sectionExecutionContract.sectionIdentity)
    ? sectionExecutionContract.sectionIdentity
    : {}
  const generator = isPlainObject(candidate?.generator) ? candidate.generator : {}
  const checks = buildCompletenessChecks({
    candidate,
    checkedAt,
    sectionExecutionContract,
  })
  const failedCheckKeys = checks
    .filter((check) => check.passed !== true)
    .map((check) => check.checkKey)
  const isValid = failedCheckKeys.length === 0
  const result = {
    stableId: normalizeToken(rule.stableId),
    key: normalizeToken(rule.key),
    componentVersion: toComponentVersion(rule.componentVersion),
    producerSkill: {
      stableId: normalizeToken(rule.executionBinding?.producerSkill?.stableId),
      key: normalizeToken(rule.executionBinding?.producerSkill?.key),
      componentVersion: toComponentVersion(
        rule.executionBinding?.producerSkill?.componentVersion,
      ),
    },
    executorVersion: normalizeText(rule.executionBinding?.executorVersion),
    status: isValid ? 'PASS' : 'FAIL',
    is_valid: isValid,
    message: isValid
      ? 'The generated section result is structurally complete and traceable.'
      : 'The generated section result is incomplete and cannot be retained.',
    result: {
      totalChecks: checks.length,
      passedChecks: checks.length - failedCheckKeys.length,
      outcome: isValid ? 'COMPLETE' : 'INCOMPLETE',
    },
    details: {
      failedCheckKeys,
      generatedSectionCount: Array.isArray(candidate?.sections)
        ? candidate.sections.length
        : 0,
      supportingEvidenceRefCount: Array.isArray(candidate?.supportingEvidenceRefs)
        ? candidate.supportingEvidenceRefs.length
        : 0,
    },
    traceability: [{
      sectionKey: normalizeText(sectionIdentity.sectionKey),
      runtimePath: normalizeText(sectionIdentity.runtimePath),
      contractVersion: normalizeText(sectionExecutionContract.contractVersion),
      sectionContractHash: normalizeText(
        sectionExecutionContract.sectionContractHash,
      ),
      generatorVersion: normalizeText(generator.adapter),
      inputHash: normalizeText(candidate?.inputHash),
      evidenceHash: normalizeText(candidate?.evidenceHash),
      sectionEvidenceHash: normalizeText(candidate?.sectionEvidenceHash),
      dependencyHash: normalizeText(candidate?.dependencyHash),
      boundedContextHash: normalizeText(candidate?.boundedContextHash),
    }],
    checkedAt: normalizeText(checkedAt),
  }

  return {
    ...result,
    resultHash: generateChecksum(result),
  }
}

const EXECUTORS = Object.freeze({
  [SECTION_COMPLETENESS_BINDING.selectionKey]: executeCompletenessCheck,
})

export const executeSectionValidationRules = ({
  candidate,
  checkedAt,
  sectionExecutionContract = {},
} = {}) => {
  const rules = Array.isArray(sectionExecutionContract.validationRules)
    ? sectionExecutionContract.validationRules
    : []
  const executableRules = rules.filter((rule) =>
    rule?.metadataOnlyDuringGeneration === false
    || isPlainObject(rule?.executionBinding))

  return executableRules.map((rule) => {
    const selectionKey = normalizeText(rule?.executionBinding?.selectionKey)
    const executor = EXECUTORS[selectionKey]
    if (!selectionKey || typeof executor !== 'function') {
      throw buildExecutionError({
        contractIssue: 'SECTION_VALIDATION_EXECUTOR_UNAVAILABLE',
        message: 'Runtime section generation is blocked because a required validation executor is unavailable.',
        details: {
          sectionKey: normalizeText(
            sectionExecutionContract?.sectionIdentity?.sectionKey,
          ),
          validationKey: normalizeToken(rule?.key),
        },
      })
    }

    const result = executor({
      candidate,
      checkedAt,
      rule,
      sectionExecutionContract,
    })

    if (result.is_valid !== true && rule.blockingDefault === true) {
      throw buildExecutionError({
        contractIssue: 'SECTION_VALIDATION_FAILED',
        message: 'Runtime section generation is blocked because the generated result is incomplete.',
        details: {
          sectionKey: normalizeText(
            sectionExecutionContract?.sectionIdentity?.sectionKey,
          ),
          validationKey: normalizeToken(rule?.key),
          validationStatus: result.status,
          resultHash: result.resultHash,
          failedCheckKeys: result.details.failedCheckKeys,
        },
      })
    }

    return result
  })
}

export default {
  SECTION_COMPLETENESS_BINDING,
  SECTION_COMPLETENESS_EXECUTOR_VERSION,
  evaluateSectionValidationBindingCompatibility,
  executeSectionValidationRules,
  targetsSectionCompletenessBinding,
}
