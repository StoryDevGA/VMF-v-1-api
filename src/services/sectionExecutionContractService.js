import {
  RuntimeSkill,
  UIContract,
  ValidationRegistry,
} from '../models/index.js'
import { generateChecksum } from './governanceAudit/checksumService.js'
import {
  RUNTIME_INSTANCE_ERROR_REASONS,
  createRuntimeInstanceError,
} from './runtimeInstanceService.js'

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
  frameworkPackage,
  runtimePath,
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

  const matches = rows.filter((row) =>
    Array.isArray(row.allowedWritePaths)
    && row.allowedWritePaths.some((path) => normalizePath(path) === runtimePath))

  if (matches.length !== 1) {
    throw buildContractError({
      issue: 'RUNTIME_SKILL_TARGET_AMBIGUOUS',
      message: 'Section generation requires one dependency-locked Runtime Skill for the target path.',
      details: {
        runtimePath,
        matchCount: matches.length,
        matchingSkillIds: matches.map((row) => normalizeToken(row.stableId)).sort(),
      },
    })
  }

  const row = matches[0]
  const reference = references.find((candidate) =>
    normalizeToken(candidate?.id || candidate?.stableId) === normalizeToken(row.stableId))
  const description = normalizeText(row.description)
  const skillRoleKey = normalizeText(row.skillRoleKey)
  const category = normalizeText(row.category)
  const inputContract = row.inputContract && typeof row.inputContract === 'object'
    ? row.inputContract
    : null
  const outputContract = row.outputContract && typeof row.outputContract === 'object'
    ? row.outputContract
    : null

  if (!description || !skillRoleKey || !category || !inputContract || !outputContract) {
    throw buildContractError({
      issue: 'RUNTIME_SKILL_INSTRUCTION_ENVELOPE_INCOMPLETE',
      message: 'The dependency-locked Runtime Skill instruction envelope is incomplete.',
      details: { stableId: normalizeToken(row.stableId) },
    })
  }

  return { reference, row, description, skillRoleKey, category, inputContract, outputContract }
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

  const [uiContract, runtimeSkill, validationRules] = await Promise.all([
    resolveUIContract({ frameworkPackage, sectionKey, runtimePath }),
    resolveRuntimeSkill({ frameworkPackage, runtimePath }),
    resolveValidationRules({
      frameworkPackage,
      validationKeys: Array.isArray(section.validationKeys) ? section.validationKeys : [],
    }),
  ])

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
    validationRules,
    dependencyIdentity: {
      uiContract: {
        stableId: normalizeToken(uiContract.row.stableId),
        key: normalizeToken(uiContract.row.uiContractKey),
        componentVersion: toComponentVersion(uiContract.row.componentVersion),
      },
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
