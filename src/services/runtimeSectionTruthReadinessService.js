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

const hasOwnObjectValue = (source, key) =>
  Object.prototype.hasOwnProperty.call(source, key)

const isMongooseDocumentLike = (source) =>
  Boolean(source && typeof source.get === 'function' && typeof source.toObject === 'function')

const getObjectValue = (source, key) => {
  if (source === null || source === undefined || !key || typeof source !== 'object') return undefined
  if (source instanceof Map) return source.get(key)
  if (isMongooseDocumentLike(source)) {
    const value = source.get(key)
    if (value !== undefined) return value
  }
  if (hasOwnObjectValue(source, key)) return source[key]
  return undefined
}

const getValueAtPath = (source, path) => {
  const parts = String(path || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return undefined

  let cursor = source
  for (const part of parts) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
      return undefined
    }
    cursor = getObjectValue(cursor, part)
    if (cursor === undefined) return undefined
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
    getObjectValue(packageSection, 'dependsOnSectionKeys'),
    getObjectValue(packageSection, 'dependencySectionKeys'),
    getObjectValue(packageSection, 'dependsOn'),
  ]

  return candidates
    .flatMap((candidate) => (Array.isArray(candidate) ? candidate : [candidate]))
    .map((candidate) => {
      if (candidate && typeof candidate === 'object') {
        return normalizeKey(getObjectValue(candidate, 'sectionKey') || getObjectValue(candidate, 'key'))
      }
      return normalizeKey(candidate)
    })
    .filter(Boolean)
}

const getSectionValue = ({ frameworkState, packageSection }) => {
  const state = frameworkState || {}
  const sectionKey = normalizeKey(getObjectValue(packageSection, 'sectionKey'))
  const runtimePath = String(getObjectValue(packageSection, 'runtimePath') || '').trim()
  const runtimePathValue = runtimePath
    ? getValueAtPath({ framework_state: state }, runtimePath)
    : undefined

  if (runtimePathValue !== undefined) return runtimePathValue
  return getObjectValue(getObjectValue(state, 'sections') || {}, sectionKey)
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

const getSectionEvidenceInvalidationReason = (sectionValue = {}) => {
  const sectionState = sectionValue?.state || {}
  if (sectionState.needsRegeneration !== true) return ''

  const reason = normalizeKey(
    sectionState.acceptedInvalidationReason
    || sectionState.sectionEvidenceInvalidationReason
    || sectionValue?.lineage?.sectionEvidenceInvalidationReason,
  )

  return reason === 'section_evidence_changed' ? 'SECTION_EVIDENCE_CHANGED' : ''
}

export const evaluateRuntimeSectionTruthReadiness = ({
  frameworkPackage,
  frameworkState,
} = {}) => {
  const packageSections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  const requiredSections = packageSections
    .filter((section) => getObjectValue(section, 'required') === true)
    .map((section) => ({
      sectionKey: normalizeKey(getObjectValue(section, 'sectionKey')),
      runtimePath: String(getObjectValue(section, 'runtimePath') || '').trim(),
      dependsOnSectionKeys: getObjectValue(section, 'dependsOnSectionKeys'),
      dependencySectionKeys: getObjectValue(section, 'dependencySectionKeys'),
      dependsOn: getObjectValue(section, 'dependsOn'),
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
    const sectionEvidenceInvalidationReason = getSectionEvidenceInvalidationReason(sectionValue)

    if (sectionEvidenceInvalidationReason === 'SECTION_EVIDENCE_CHANGED') {
      blockers.push(createBlocker({
        sectionKey: section.sectionKey,
        state: 'SECTION_EVIDENCE_CHANGED',
        reason: 'Accepted section evidence changed. Regenerate this section before accepting or publishing truth.',
        invalidationReason: sectionEvidenceInvalidationReason,
      }))
      return
    }

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
      const stateSections = getObjectValue(frameworkState || {}, 'sections') || {}
      const dependencyValue = sectionValuesByKey[dependencySectionKey]
        ?? getObjectValue(stateSections, dependencySectionKey)
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
