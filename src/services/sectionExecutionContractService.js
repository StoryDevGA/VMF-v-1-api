import {
  RuntimeSkill,
  UIContract,
  ValidationRegistry,
  WorkflowPolicy,
} from '../models/index.js'
import { generateChecksum } from './governanceAudit/checksumService.js'
import {
  RUNTIME_INSTANCE_ERROR_REASONS,
  createRuntimeInstanceError,
} from './runtimeInstanceService.js'
import {
  evaluateSectionValidationBindingCompatibility,
  targetsSectionCompletenessBinding,
} from './sectionValidationExecutorService.js'

export const SECTION_EXECUTION_CONTRACT_VERSION = 'section-execution-contract-v1'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toLowerCase()
const normalizeSectionKey = (value) => normalizeToken(value).replace(/-/g, '_')
const normalizeCollectionKey = (value) => normalizeToken(value).replace(/[^a-z0-9]/g, '')
const normalizePath = (value) => normalizeText(value)
const normalizeFrameworkKey = (value) => normalizeText(value).toUpperCase()
const toComponentVersion = (value) => {
  const version = Number(value)
  return Number.isInteger(version) && version > 0 ? version : 0
}

const buildContractError = ({
  issue,
  message,
  details = {},
}) => createRuntimeInstanceError({
  status: 409,
  code: 'CONFLICT',
  message,
  reason: RUNTIME_INSTANCE_ERROR_REASONS.DEPENDENCY_LOCK_EVIDENCE_MISMATCH,
  details: {
    contractVersion: SECTION_EXECUTION_CONTRACT_VERSION,
    contractIssue: issue,
    ...details,
  },
})

const getDependencyReferences = (frameworkPackage, collectionKey) => {
  const target = normalizeCollectionKey(collectionKey)
  return (Array.isArray(frameworkPackage?.dependencyLock?.references)
    ? frameworkPackage.dependencyLock.references
    : [])
    .filter((reference) =>
      normalizeCollectionKey(reference?.collectionKey || reference?.componentType) === target)
}

const assertLockedReferenceMatches = ({
  reference,
  row,
  label,
}) => {
  const expectedStableId = normalizeToken(reference?.id || reference?.stableId)
  const actualStableId = normalizeToken(row?.stableId || row?.id)
  const expectedVersion = toComponentVersion(reference?.componentVersion)
  const actualVersion = toComponentVersion(row?.componentVersion)
  const status = normalizeText(row?.status).toUpperCase()
  const versionStatus = normalizeText(row?.versionStatus).toUpperCase()

  if (
    !expectedStableId
    || expectedStableId !== actualStableId
    || !expectedVersion
    || expectedVersion !== actualVersion
    || status !== 'ACTIVE'
    || versionStatus !== 'ACTIVE'
  ) {
    throw buildContractError({
      issue: 'LOCKED_DEPENDENCY_MISMATCH',
      message: `${label} does not match the package dependency lock.`,
      details: {
        dependencyType: label,
        expectedStableId,
        actualStableId,
        expectedComponentVersion: expectedVersion || null,
        actualComponentVersion: actualVersion || null,
        status: status || null,
        versionStatus: versionStatus || null,
      },
    })
  }
}

const assertFrameworkCompatibility = ({
  frameworkKeys,
  frameworkPackage,
  label,
}) => {
  const packageFrameworkKey = normalizeFrameworkKey(frameworkPackage?.frameworkKey)
  const supportedFrameworkKeys = Array.isArray(frameworkKeys)
    ? frameworkKeys.map(normalizeFrameworkKey).filter(Boolean)
    : []

  if (!packageFrameworkKey || !supportedFrameworkKeys.includes(packageFrameworkKey)) {
    throw buildContractError({
      issue: 'COMPONENT_FRAMEWORK_MISMATCH',
      message: `${label} is not compatible with the package framework.`,
      details: {
        dependencyType: label,
        packageFrameworkKey,
        supportedFrameworkKeys,
      },
    })
  }
}

const compareCanonicalPolicyBindings = (left, right) => {
  const textFields = ['stableId', 'key', 'stepKey', 'skillId']
  for (const field of textFields) {
    if (field === 'key') {
      const versionDifference =
        toComponentVersion(left.componentVersion) - toComponentVersion(right.componentVersion)
      if (versionDifference !== 0) return versionDifference
    }

    const comparison = normalizeToken(left[field]).localeCompare(normalizeToken(right[field]))
    if (comparison !== 0) return comparison
  }

  return 0
}

const resolveWorkflowPolicySkillBinding = async ({
  frameworkPackage,
  runtimePath,
}) => {
  const references = getDependencyReferences(frameworkPackage, 'WorkflowPolicy')
  const ids = [...new Set(references
    .map((reference) => normalizeToken(reference?.id || reference?.stableId))
    .filter(Boolean))]
  const rows = ids.length > 0
    ? await WorkflowPolicy.find({ stableId: { $in: ids } }).lean()
    : []
  const rowsByStableId = rows.reduce((result, row) => {
    const stableId = normalizeToken(row?.stableId)
    if (!result.has(stableId)) result.set(stableId, [])
    result.get(stableId).push(row)
    return result
  }, new Map())

  for (const reference of references) {
    const stableId = normalizeToken(reference?.id || reference?.stableId)
    const matches = rowsByStableId.get(stableId) || []
    if (matches.length !== 1) {
      throw buildContractError({
        issue: matches.length === 0
          ? 'WORKFLOW_POLICY_NOT_FOUND'
          : 'WORKFLOW_POLICY_REFERENCE_AMBIGUOUS',
        message: matches.length === 0
          ? 'A dependency-locked Workflow Policy was not found.'
          : 'A dependency-locked Workflow Policy resolved more than once.',
        details: { stableId, matchCount: matches.length },
      })
    }

    assertLockedReferenceMatches({
      reference,
      row: matches[0],
      label: 'Workflow Policy',
    })
    assertFrameworkCompatibility({
      frameworkKeys: matches[0].frameworkKeys,
      frameworkPackage,
      label: 'Workflow Policy',
    })
  }

  const policyBindings = rows
    .flatMap((row) => (Array.isArray(row.steps) ? row.steps : [])
      .filter((step) =>
        normalizeText(step?.type).toUpperCase() === 'SKILL_EXECUTION'
        && normalizePath(step?.targetPath) === runtimePath
        && normalizeToken(step?.skillId))
      .map((step) => ({
        stableId: normalizeToken(row.stableId),
        componentVersion: toComponentVersion(row.componentVersion),
        key: normalizeToken(row.key),
        stepKey: normalizeToken(step.stepKey),
        skillId: normalizeToken(step.skillId),
      })))
    .sort(compareCanonicalPolicyBindings)
  const skillIds = [...new Set(policyBindings.map((binding) => binding.skillId))]

  if (skillIds.length !== 1) {
    throw buildContractError({
      issue: skillIds.length === 0
        ? 'WORKFLOW_POLICY_SKILL_BINDING_MISSING'
        : 'WORKFLOW_POLICY_SKILL_BINDING_AMBIGUOUS',
      message: skillIds.length === 0
        ? 'Section generation requires an exact-path Workflow Policy skill binding.'
        : 'Section generation requires one unique exact-path Workflow Policy skill binding.',
      details: {
        runtimePath,
        skillIds: skillIds.sort(),
        bindingCount: policyBindings.length,
      },
    })
  }

  return {
    skillId: skillIds[0],
    policyBindings,
  }
}

const resolveUIContract = async ({
  frameworkPackage,
  sectionKey,
  runtimePath,
}) => {
  const references = getDependencyReferences(frameworkPackage, 'UIContract')
  const uiContractKey = normalizeToken(frameworkPackage?.uiContractKey)
  const reference = references.find((candidate) =>
    normalizeToken(candidate?.key) === uiContractKey)

  if (!reference || references.filter((candidate) =>
    normalizeToken(candidate?.key) === uiContractKey).length !== 1) {
    throw buildContractError({
      issue: 'UI_CONTRACT_LOCK_REFERENCE_MISSING',
      message: 'Section generation requires one dependency-locked UI Contract.',
      details: { uiContractKey },
    })
  }

  const stableId = normalizeToken(reference.id || reference.stableId)
  const uiContract = stableId
    ? await UIContract.findOne({ stableId }).lean()
    : null

  if (!uiContract) {
    throw buildContractError({
      issue: 'UI_CONTRACT_NOT_FOUND',
      message: 'The dependency-locked UI Contract was not found.',
      details: { uiContractKey, stableId },
    })
  }

  assertLockedReferenceMatches({
    reference,
    row: uiContract,
    label: 'UI Contract',
  })
  assertFrameworkCompatibility({
    frameworkKeys: uiContract.frameworkKeys,
    frameworkPackage,
    label: 'UI Contract',
  })

  if (normalizeToken(uiContract.uiContractKey) !== uiContractKey) {
    throw buildContractError({
      issue: 'UI_CONTRACT_KEY_MISMATCH',
      message: 'The dependency-locked UI Contract key does not match the package.',
      details: {
        expectedKey: uiContractKey,
        actualKey: normalizeToken(uiContract.uiContractKey),
      },
    })
  }

  const matchingSections = (Array.isArray(uiContract.sections) ? uiContract.sections : [])
    .filter((section) =>
      normalizeSectionKey(section?.sectionKey) === normalizeSectionKey(sectionKey)
      && normalizePath(section?.runtimePath) === runtimePath)

  if (matchingSections.length !== 1) {
    throw buildContractError({
      issue: 'UI_CONTRACT_SECTION_MISMATCH',
      message: 'The dependency-locked UI Contract does not contain one matching section.',
      details: { sectionKey, runtimePath, matchCount: matchingSections.length },
    })
  }

  const uiSection = matchingSections[0]
  const label = normalizeText(uiSection.label)
  const purpose = normalizeText(uiSection.helpText)
  if (!label || !purpose) {
    throw buildContractError({
      issue: 'UI_CONTRACT_SECTION_INCOMPLETE',
      message: 'The dependency-locked UI Contract section requires a label and purpose.',
      details: { sectionKey, runtimePath },
    })
  }

  return { reference, row: uiContract, section: uiSection, label, purpose }
}

const resolveRuntimeSkill = async ({
  additionalSkillIds = [],
  frameworkPackage,
  runtimePath,
  skillId,
}) => {
  const references = getDependencyReferences(frameworkPackage, 'RuntimeSkill')
  const ids = [...new Set(references
    .map((reference) => normalizeToken(reference?.id || reference?.stableId))
    .filter(Boolean))]
  const rows = ids.length > 0
    ? await RuntimeSkill.find({ stableId: { $in: ids } }).lean()
    : []
  const rowsByStableId = new Map(rows.map((row) => [normalizeToken(row.stableId), row]))

  for (const reference of references) {
    const stableId = normalizeToken(reference?.id || reference?.stableId)
    const row = rowsByStableId.get(stableId)
    if (!row) {
      throw buildContractError({
        issue: 'RUNTIME_SKILL_NOT_FOUND',
        message: 'A dependency-locked Runtime Skill was not found.',
        details: { stableId },
      })
    }
    assertLockedReferenceMatches({ reference, row, label: 'Runtime Skill' })
    assertFrameworkCompatibility({
      frameworkKeys: row.supportedFrameworkKeys,
      frameworkPackage,
      label: 'Runtime Skill',
    })
  }

  const selectedReferences = references.filter((reference) =>
    normalizeToken(reference?.id || reference?.stableId) === normalizeToken(skillId))
  if (selectedReferences.length !== 1) {
    throw buildContractError({
      issue: 'RUNTIME_SKILL_LOCK_REFERENCE_MISSING',
      message: 'The Workflow Policy-selected Runtime Skill must have one dependency-lock reference.',
      details: {
        runtimePath,
        stableId: normalizeToken(skillId),
        matchCount: selectedReferences.length,
      },
    })
  }

  const row = rowsByStableId.get(normalizeToken(skillId))
  const reference = selectedReferences[0]
  if (!row) {
    throw buildContractError({
      issue: 'RUNTIME_SKILL_NOT_FOUND',
      message: 'The Workflow Policy-selected Runtime Skill was not found.',
      details: { stableId: normalizeToken(skillId) },
    })
  }

  if (
    !Array.isArray(row.allowedWritePaths)
    || !row.allowedWritePaths.some((path) => normalizePath(path) === runtimePath)
  ) {
    throw buildContractError({
      issue: 'RUNTIME_SKILL_TARGET_NOT_ALLOWED',
      message: 'The Workflow Policy-selected Runtime Skill cannot write the target path.',
      details: {
        runtimePath,
        stableId: normalizeToken(row.stableId),
      },
    })
  }

  const description = normalizeText(row.description)
  const skillRoleKey = normalizeText(row.skillRoleKey)
  const category = normalizeText(row.category)
  const inputContract = row.inputContract && typeof row.inputContract === 'object'
    ? row.inputContract
    : null
  const outputContract = row.outputContract && typeof row.outputContract === 'object'
    ? row.outputContract
    : null
  const constraintsComplete = Array.isArray(row.allowedReadPaths)
    && Array.isArray(row.allowedWritePaths)
    && Array.isArray(row.forbiddenWritePaths)

  if (
    !description
    || !skillRoleKey
    || !category
    || !inputContract
    || !outputContract
    || !constraintsComplete
  ) {
    throw buildContractError({
      issue: 'RUNTIME_SKILL_INSTRUCTION_ENVELOPE_INCOMPLETE',
      message: 'The dependency-locked Runtime Skill instruction envelope is incomplete.',
      details: { stableId: normalizeToken(row.stableId) },
    })
  }

  const additionalSkills = new Map()
  for (const additionalSkillId of [...new Set(additionalSkillIds
    .map(normalizeToken)
    .filter(Boolean))]) {
    const additionalReferences = references.filter((candidateReference) =>
      normalizeToken(candidateReference?.id || candidateReference?.stableId)
        === additionalSkillId)
    if (additionalReferences.length !== 1) {
      throw buildContractError({
        issue: 'VALIDATION_PRODUCER_SKILL_LOCK_REFERENCE_MISSING',
        message: 'An executable section validation producer must have one dependency-lock reference.',
        details: {
          stableId: additionalSkillId,
          matchCount: additionalReferences.length,
        },
      })
    }

    const additionalRow = rowsByStableId.get(additionalSkillId)
    if (!additionalRow) {
      throw buildContractError({
        issue: 'VALIDATION_PRODUCER_SKILL_NOT_FOUND',
        message: 'An executable section validation producer was not found.',
        details: { stableId: additionalSkillId },
      })
    }
    additionalSkills.set(additionalSkillId, additionalRow)
  }

  return {
    reference,
    row,
    description,
    skillRoleKey,
    category,
    inputContract,
    outputContract,
    additionalSkills,
  }
}

const resolveValidationRules = async ({
  frameworkPackage,
  validationKeys,
}) => {
  const references = getDependencyReferences(frameworkPackage, 'ValidationRegistry')
  const normalizedKeys = [...new Set(validationKeys.map(normalizeToken).filter(Boolean))]
  const selectedReferences = normalizedKeys.map((key) => {
    const matches = references.filter((reference) => normalizeToken(reference?.key) === key)
    if (matches.length !== 1) {
      throw buildContractError({
        issue: 'VALIDATION_LOCK_REFERENCE_MISSING',
        message: 'Section generation requires one dependency-lock reference for each validation key.',
        details: { validationKey: key, matchCount: matches.length },
      })
    }
    return matches[0]
  })
  const ids = selectedReferences.map((reference) =>
    normalizeToken(reference?.id || reference?.stableId))
  const rows = ids.length > 0
    ? await ValidationRegistry.find({ stableId: { $in: ids } }).lean()
    : []
  const rowsByStableId = new Map(rows.map((row) => [normalizeToken(row.stableId), row]))

  return selectedReferences.map((reference) => {
    const stableId = normalizeToken(reference?.id || reference?.stableId)
    const row = rowsByStableId.get(stableId)
    if (!row) {
      throw buildContractError({
        issue: 'VALIDATION_NOT_FOUND',
        message: 'A dependency-locked validation record was not found.',
        details: { stableId },
      })
    }
    assertLockedReferenceMatches({ reference, row, label: 'Validation Registry' })
    if (
      normalizeToken(row.key) !== normalizeToken(reference.key)
      || row.packageUsable === false
      || !Array.isArray(row.supportedFrameworkKeys)
      || !row.supportedFrameworkKeys.includes(normalizeText(frameworkPackage.frameworkKey).toUpperCase())
    ) {
      throw buildContractError({
        issue: 'VALIDATION_CONTRACT_MISMATCH',
        message: 'A dependency-locked validation record is not package-compatible.',
        details: { stableId, validationKey: normalizeToken(reference.key) },
      })
    }

    return {
      stableId,
      key: normalizeToken(row.key),
      componentVersion: toComponentVersion(row.componentVersion),
      category: normalizeText(row.category),
      severity: normalizeText(row.severity),
      executionMode: normalizeText(row.executionMode),
      packageUsable: row.packageUsable !== false,
      producerSkillId: normalizeToken(row.producerSkillId),
      resultType: normalizeText(row.resultType),
      outputPath: normalizeText(row.outputPath),
      passFieldPath: normalizeText(row.passFieldPath),
      detailsFieldPath: normalizeText(row.detailsFieldPath),
      messageFieldPath: normalizeText(row.messageFieldPath),
      retryPolicy: {
        maxAttempts: Number(row.retryPolicy?.maxAttempts || 1),
        retryableErrorCodes: Array.isArray(row.retryPolicy?.retryableErrorCodes)
          ? row.retryPolicy.retryableErrorCodes.map((value) =>
              normalizeText(value).toUpperCase()).filter(Boolean)
          : [],
        backoffSeconds: Number(row.retryPolicy?.backoffSeconds || 0),
      },
      blockingDefault: row.blockingDefault === true,
      warningOnlyDefault: row.warningOnlyDefault === true,
      metadataOnlyDuringGeneration: true,
    }
  })
}

export const resolveSectionExecutionContract = async ({
  frameworkPackage,
  section,
}) => {
  if (
    normalizeText(frameworkPackage?.dependencyLock?.status).toUpperCase() !== 'PASS'
    || !Array.isArray(frameworkPackage?.dependencyLock?.references)
  ) {
    throw buildContractError({
      issue: 'DEPENDENCY_LOCK_REQUIRED',
      message: 'Section generation requires a passing package dependency lock.',
    })
  }

  const packageKey = normalizeToken(frameworkPackage.packageKey)
  const packageVersion = normalizeText(frameworkPackage.version)
  const lockedPackageKey = normalizeToken(frameworkPackage.dependencyLock.packageKey)
  const lockedPackageVersion = normalizeText(frameworkPackage.dependencyLock.packageVersion)
  if (
    !packageKey
    || !packageVersion
    || lockedPackageKey !== packageKey
    || lockedPackageVersion !== packageVersion
  ) {
    throw buildContractError({
      issue: 'PACKAGE_LOCK_IDENTITY_MISMATCH',
      message: 'Section generation requires a dependency lock for the exact package identity.',
      details: {
        packageKey,
        packageVersion,
        lockedPackageKey,
        lockedPackageVersion,
      },
    })
  }

  const sectionKey = normalizeText(section?.sectionKey || section?.key)
  const runtimePath = normalizePath(section?.runtimePath)
  if (!sectionKey || !runtimePath) {
    throw buildContractError({
      issue: 'PACKAGE_SECTION_INCOMPLETE',
      message: 'Section generation requires a package section key and runtime path.',
    })
  }

  const [uiContract, workflowPolicyBinding, validationRules] = await Promise.all([
    resolveUIContract({ frameworkPackage, sectionKey, runtimePath }),
    resolveWorkflowPolicySkillBinding({ frameworkPackage, runtimePath }),
    resolveValidationRules({
      frameworkPackage,
      validationKeys: Array.isArray(section.validationKeys) ? section.validationKeys : [],
    }),
  ])
  const runtimeSkill = await resolveRuntimeSkill({
    additionalSkillIds: validationRules
      .filter(targetsSectionCompletenessBinding)
      .map((rule) => rule.producerSkillId),
    frameworkPackage,
    runtimePath,
    skillId: workflowPolicyBinding.skillId,
  })
  const boundValidationRules = validationRules.map((rule) => {
    if (!targetsSectionCompletenessBinding(rule)) {
      return rule
    }

    const producerSkill = runtimeSkill.additionalSkills.get(
      normalizeToken(rule.producerSkillId),
    )
    const compatibility = evaluateSectionValidationBindingCompatibility({
      producerSkill,
      rule,
    })
    if (compatibility.mismatchFields.length > 0) {
      throw buildContractError({
        issue: 'SECTION_VALIDATION_BINDING_MISMATCH',
        message: 'A dependency-locked section validation cannot be bound to the supported deterministic executor.',
        details: {
          validationKey: rule.key,
          producerSkillId: rule.producerSkillId,
          mismatchFields: compatibility.mismatchFields,
        },
      })
    }

    return {
      ...rule,
      producerSkill: {
        stableId: normalizeToken(producerSkill.stableId),
        key: normalizeToken(producerSkill.key),
        componentVersion: toComponentVersion(producerSkill.componentVersion),
        skillRoleKey: normalizeText(producerSkill.skillRoleKey),
        category: normalizeText(producerSkill.category),
        type: normalizeText(producerSkill.type),
        executionMode: normalizeText(producerSkill.executionMode),
      },
      executionBinding: compatibility.executionBinding,
      metadataOnlyDuringGeneration: false,
    }
  })

  const contract = {
    contractVersion: SECTION_EXECUTION_CONTRACT_VERSION,
    frameworkIdentity: {
      frameworkKey: normalizeFrameworkKey(frameworkPackage.frameworkKey),
    },
    packageIdentity: {
      packageId: normalizeText(frameworkPackage._id || frameworkPackage.id),
      packageKey: normalizeToken(frameworkPackage.packageKey),
      packageVersion: normalizeText(frameworkPackage.version),
      dependencySnapshotId: normalizeText(frameworkPackage.dependencyLock.snapshotId),
      dependencySnapshotHash: normalizeText(frameworkPackage.dependencyLock.snapshotHash),
    },
    sectionIdentity: {
      sectionKey,
      runtimePath,
      label: uiContract.label,
      purpose: uiContract.purpose,
    },
    runtimeInstructions: {
      stableId: normalizeToken(runtimeSkill.row.stableId),
      key: normalizeToken(runtimeSkill.row.key),
      componentVersion: toComponentVersion(runtimeSkill.row.componentVersion),
      description: runtimeSkill.description,
      skillRoleKey: runtimeSkill.skillRoleKey,
      category: runtimeSkill.category,
      inputContract: runtimeSkill.inputContract,
      outputContract: runtimeSkill.outputContract,
      constraints: {
        allowedReadPaths: runtimeSkill.row.allowedReadPaths || [],
        allowedWritePaths: runtimeSkill.row.allowedWritePaths || [],
        forbiddenWritePaths: runtimeSkill.row.forbiddenWritePaths || [],
      },
    },
    validationRules: boundValidationRules,
    dependencyIdentity: {
      uiContract: {
        stableId: normalizeToken(uiContract.row.stableId),
        key: normalizeToken(uiContract.row.uiContractKey),
        componentVersion: toComponentVersion(uiContract.row.componentVersion),
      },
      workflowPolicyBindings: workflowPolicyBinding.policyBindings,
    },
  }

  return {
    ...contract,
    sectionContractHash: generateChecksum(contract),
  }
}

export default {
  SECTION_EXECUTION_CONTRACT_VERSION,
  resolveSectionExecutionContract,
}
