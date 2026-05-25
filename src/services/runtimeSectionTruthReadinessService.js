import {
  getRuntimeSectionAccepted,
  getRuntimeSectionGenerated,
  getRuntimeSectionInput,
  hashSectionInput,
  isRuntimeSectionObject,
} from './runtimeSectionModelService.js'

const normalizeKey = (value) => String(value || '').trim().toLowerCase()

const parseRuntimeTimestamp = (value) => {
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

const getValueAtPath = (source, path) => {
  const parts = String(path || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return undefined

  let cursor = source
  for (const part of parts) {
    if (
      cursor === null
      || cursor === undefined
      || typeof cursor !== 'object'
      || !Object.prototype.hasOwnProperty.call(cursor, part)
    ) {
      return undefined
    }
    cursor = cursor[part]
  }

  return cursor
}

const hasProjectionValue = (value) => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

const cloneProjectionValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const normalizeComparableSectionContent = (value) => {
  if (value === null || value === undefined) return ''
  const candidate = value?.content ?? value
  if (typeof candidate === 'string') return candidate.trim()
  return JSON.stringify(cloneProjectionValue(candidate))
}

const getDependencySectionKeys = (packageSection = {}) => {
  const candidates = [
    packageSection.dependsOnSectionKeys,
    packageSection.dependencySectionKeys,
    packageSection.dependsOn,
  ]

  return candidates
    .flatMap((candidate) => (Array.isArray(candidate) ? candidate : [candidate]))
    .map((candidate) => {
      if (candidate && typeof candidate === 'object') {
        return normalizeKey(candidate.sectionKey || candidate.key)
      }
      return normalizeKey(candidate)
    })
    .filter(Boolean)
}

const getSectionValue = ({ frameworkState, packageSection }) => {
  const state = frameworkState || {}
  const sectionKey = normalizeKey(packageSection?.sectionKey)
  const runtimePath = String(packageSection?.runtimePath || '').trim()
  const runtimePathValue = runtimePath
    ? getValueAtPath({ framework_state: state }, runtimePath)
    : undefined

  if (runtimePathValue !== undefined) return runtimePathValue
  return state.sections?.[sectionKey]
}

const isAcceptedTruthCurrent = ({ accepted, generated, input }) => {
  if (!hasProjectionValue(accepted?.content ?? accepted)) return false
  if (!hasProjectionValue(generated?.content ?? generated)) return false

  const currentInputHash = hashSectionInput(input)
  const acceptedInputHash = normalizeKey(accepted?.inputHash)
  const generatedInputHash = normalizeKey(generated?.inputHash)
  const acceptedGeneratedAt = normalizeKey(accepted?.sourceGeneratedAt)
  const generatedAt = normalizeKey(generated?.generatedAt)

  if (acceptedInputHash && currentInputHash && acceptedInputHash !== currentInputHash) return false
  if (generatedInputHash && currentInputHash && generatedInputHash !== currentInputHash) return false
  if (acceptedInputHash && generatedInputHash && acceptedInputHash !== generatedInputHash) return false
  if (acceptedGeneratedAt && generatedAt && acceptedGeneratedAt !== generatedAt) return false

  if (acceptedGeneratedAt && generatedAt && acceptedInputHash && generatedInputHash) return true
  return normalizeComparableSectionContent(accepted) === normalizeComparableSectionContent(generated)
}

const getSectionTruthTimestamp = ({ accepted, generated }) => {
  const generatedAt = parseRuntimeTimestamp(generated?.generatedAt)
  const sourceGeneratedAt = parseRuntimeTimestamp(accepted?.sourceGeneratedAt)
  const acceptedAt = parseRuntimeTimestamp(accepted?.acceptedAt)
  return generatedAt || sourceGeneratedAt || acceptedAt
}

const createBlocker = ({ reason, sectionKey, state, details = {} }) => ({
  sectionKey,
  state,
  reason,
  ...details,
})

export const evaluateRuntimeSectionTruthReadiness = ({
  frameworkPackage,
  frameworkState,
} = {}) => {
  const packageSections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  const requiredSections = packageSections
    .filter((section) => section?.required === true)
    .map((section) => ({
      ...section,
      sectionKey: normalizeKey(section?.sectionKey),
    }))
    .filter((section) => section.sectionKey)

  const blockers = []
  const readySectionKeys = []
  const sectionValuesByKey = requiredSections.reduce((acc, section) => ({
    ...acc,
    [section.sectionKey]: getSectionValue({ frameworkState, packageSection: section }),
  }), {})

  requiredSections.forEach((section) => {
    const sectionValue = sectionValuesByKey[section.sectionKey]
    const input = getRuntimeSectionInput(sectionValue)
    const generated = getRuntimeSectionGenerated(sectionValue)
    const accepted = getRuntimeSectionAccepted(sectionValue)
    const acceptedCurrent = isRuntimeSectionObject(sectionValue)
      && isAcceptedTruthCurrent({ accepted, generated, input })

    if (!acceptedCurrent) {
      blockers.push(createBlocker({
        sectionKey: section.sectionKey,
        state: hasProjectionValue(accepted?.content ?? accepted)
          ? 'ACCEPTED_TRUTH_STALE'
          : 'ACCEPTED_TRUTH_MISSING',
        reason: hasProjectionValue(accepted?.content ?? accepted)
          ? 'Accepted section truth is not aligned with current generated content.'
          : 'Accepted section truth is missing.',
      }))
      return
    }

    const dependencyKeys = getDependencySectionKeys(section)
    const sectionTruthTimestamp = getSectionTruthTimestamp({ accepted, generated })
    const missingAcceptedTruthSectionKeys = []
    const invalidatedSectionKeys = []

    dependencyKeys.forEach((dependencySectionKey) => {
      const dependencyValue = sectionValuesByKey[dependencySectionKey]
        ?? frameworkState?.sections?.[dependencySectionKey]
      const dependencyAccepted = getRuntimeSectionAccepted(dependencyValue)

      if (!hasProjectionValue(dependencyAccepted?.content ?? dependencyAccepted)) {
        missingAcceptedTruthSectionKeys.push(dependencySectionKey)
        return
      }

      const dependencyAcceptedAt = parseRuntimeTimestamp(dependencyAccepted?.acceptedAt)
      if (dependencyAcceptedAt && sectionTruthTimestamp && dependencyAcceptedAt > sectionTruthTimestamp) {
        invalidatedSectionKeys.push(dependencySectionKey)
      }
    })

    if (missingAcceptedTruthSectionKeys.length > 0) {
      blockers.push(createBlocker({
        sectionKey: section.sectionKey,
        state: 'DEPENDENCY_ACCEPTED_TRUTH_MISSING',
        reason: 'Required upstream accepted truth is missing.',
        missingAcceptedTruthSectionKeys,
      }))
      return
    }

    if (invalidatedSectionKeys.length > 0) {
      blockers.push(createBlocker({
        sectionKey: section.sectionKey,
        state: 'DEPENDENCY_CONTEXT_INVALIDATED',
        reason: 'Accepted upstream section truth changed. Regenerate this section before publish or lock.',
        invalidatedSectionKeys,
      }))
      return
    }

    readySectionKeys.push(section.sectionKey)
  })

  const requiredSectionCount = requiredSections.length
  const blockingSectionCount = blockers.length
  const publishEligible = requiredSectionCount > 0 && blockingSectionCount === 0

  return {
    state: requiredSectionCount === 0
      ? 'SECTION_TRUTH_NOT_CONFIGURED'
      : publishEligible
        ? 'SECTION_TRUTH_READY'
        : 'SECTION_TRUTH_BLOCKED',
    publishEligible,
    lockEligible: publishEligible,
    requiredSectionCount,
    readySectionCount: readySectionKeys.length,
    blockingSectionCount,
    readySectionKeys,
    blockers,
    reason: requiredSectionCount === 0
      ? 'Required section truth is not configured.'
      : publishEligible
        ? ''
        : blockers[0]?.reason || 'Accepted section truth is not publish-ready.',
  }
}

const runtimeSectionTruthReadinessService = {
  evaluateRuntimeSectionTruthReadiness,
}

export default runtimeSectionTruthReadinessService
