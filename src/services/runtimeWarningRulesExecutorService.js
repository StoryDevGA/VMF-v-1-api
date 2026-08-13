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

export const RUNTIME_WARNING_RULES_EXECUTOR_CONTRACT_VERSION = 'outcome-studio.runtime-warning-rules-executor.v1'
export const RUNTIME_WARNING_RULES_EXECUTOR_KEY = 'runtime-warning-rules'
export const RUNTIME_WARNING_RULES_RECEIPT_KEY = 'runtime-warning-rules.post-validation.v1'
export const RUNTIME_WARNING_PROOF_EVIDENCE_STATES = Object.freeze({
  RESOLVED: 'RESOLVED',
  UNKNOWN: 'UNKNOWN',
  INVALID: 'INVALID',
})

const EXECUTOR_STATUSES = Object.freeze({ PASSED: 'PASSED', FAILED: 'FAILED', NOT_RECORDED: 'NOT_RECORDED' })
const EXECUTOR_RESULTS = Object.freeze({ ALLOW: 'ALLOW', BLOCK: 'BLOCK' })
const REQUIRED_HEADINGS = Object.freeze([
  'Low Coverage',
  'Low Confidence',
  'Low Source Diversity',
  'Contradictions Present',
  'No Customer Proof',
  'No Quantified Economics',
  'Warning Behaviour',
  'Relationship to Blocking Rules',
])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeSearchText = (value) => normalizeText(value).toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ')
const sha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
const hasOwn = (value, key) => Boolean(value && Object.prototype.hasOwnProperty.call(value, key))
const isPlainObject = (value) => {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const invalidProofState = () => ({ state: RUNTIME_WARNING_PROOF_EVIDENCE_STATES.INVALID })
const unknownProofState = () => ({ state: RUNTIME_WARNING_PROOF_EVIDENCE_STATES.UNKNOWN })
const resolvedProofState = (value) => ({ state: RUNTIME_WARNING_PROOF_EVIDENCE_STATES.RESOLVED, value })

const selectRuntimeEvidencePack = (runtimeInstance = {}) => {
  const runtime = typeof runtimeInstance?.toObject === 'function'
    ? runtimeInstance.toObject()
    : runtimeInstance
  if (!isPlainObject(runtime)) return { state: RUNTIME_WARNING_PROOF_EVIDENCE_STATES.UNKNOWN }

  const hasCanonicalOuter = hasOwn(runtime, 'framework_state')
  const hasCompatibilityOuter = hasOwn(runtime, 'frameworkState')
  if (hasCanonicalOuter && hasCompatibilityOuter) return invalidProofState()

  const frameworkState = hasCanonicalOuter
    ? runtime.framework_state
    : hasCompatibilityOuter
      ? runtime.frameworkState
      : null
  if (frameworkState === null || frameworkState === undefined) return unknownProofState()
  if (!isPlainObject(frameworkState)) return invalidProofState()

  const hasSnakePack = hasOwn(frameworkState, 'evidence_pack')
  const hasCamelPack = hasOwn(frameworkState, 'evidencePack')
  if (hasSnakePack && hasCamelPack) return invalidProofState()
  if (hasCanonicalOuter && hasCamelPack) return invalidProofState()
  if (hasCompatibilityOuter && hasSnakePack) return invalidProofState()
  if (!hasSnakePack && !hasCamelPack) return unknownProofState()

  return {
    state: RUNTIME_WARNING_PROOF_EVIDENCE_STATES.RESOLVED,
    value: hasSnakePack ? frameworkState.evidence_pack : frameworkState.evidencePack,
  }
}

const validateEvidencePack = (evidencePack) => {
  if (!isPlainObject(evidencePack) || !isPlainObject(evidencePack.state)) return false
  if (evidencePack.accepted !== true || evidencePack.evidenceReady !== true || evidencePack.needsRefresh !== false) {
    return false
  }
  if (normalizeToken(evidencePack.state.status) !== 'ACCEPTED') return false

  return [
    ['accepted', true],
    ['evidenceReady', true],
    ['needsRefresh', false],
  ].every(([key, expected]) => (
    !hasOwn(evidencePack.state, key)
    || (typeof evidencePack.state[key] === 'boolean' && evidencePack.state[key] === expected)
  ))
}

const isStrictCount = (value) => (
  typeof value === 'number'
  && Number.isFinite(value)
  && Number.isInteger(value)
  && value >= 0
)

const isValidCoverageRow = (row) => {
  if (!isPlainObject(row) || typeof row.area !== 'string' || !normalizeText(row.area)) return false
  if (typeof row.state !== 'string') return false
  const counts = [row.evidenceCount, row.acceptedEvidenceCount, row.pendingReviewCount]
  if (!counts.every(isStrictCount)) return false
  if (row.acceptedEvidenceCount > row.evidenceCount
    || row.pendingReviewCount > row.evidenceCount
    || row.acceptedEvidenceCount + row.pendingReviewCount > row.evidenceCount) {
    return false
  }
  const state = normalizeToken(row.state)
  if (state === 'MISSING') return counts.every((value) => value === 0)
  if (state === 'WEAK') return row.acceptedEvidenceCount === 0 && row.evidenceCount > 0
  if (state === 'ADEQUATE') return row.acceptedEvidenceCount === 1
  if (state === 'STRONG') return row.acceptedEvidenceCount >= 2
  return false
}

const resolveCoverageAreaProofState = (coverageAreas, areaName) => {
  if (!Array.isArray(coverageAreas) || coverageAreas.some((row) => !isValidCoverageRow(row))) {
    return invalidProofState()
  }
  const matches = coverageAreas.filter((row) => normalizeText(row.area).toLowerCase() === areaName.toLowerCase())
  if (matches.length === 0) return unknownProofState()
  if (matches.length !== 1) return invalidProofState()

  const row = matches[0]
  const state = normalizeToken(row.state)
  return state === 'MISSING' ? resolvedProofState(false) : unknownProofState()
}

const resolveExplicitProofState = (sources, key) => {
  const values = []
  for (const source of sources) {
    if (!isPlainObject(source) || !hasOwn(source, key)) continue
    if (typeof source[key] !== 'boolean') return invalidProofState()
    values.push(source[key])
  }
  if (values.length === 0) return unknownProofState()
  if (values.some((value) => value !== values[0])) return invalidProofState()
  return resolvedProofState(values[0])
}

const combineProofStates = (runtimeState, explicitState) => {
  if (runtimeState.state === RUNTIME_WARNING_PROOF_EVIDENCE_STATES.INVALID
    || explicitState.state === RUNTIME_WARNING_PROOF_EVIDENCE_STATES.INVALID) {
    return invalidProofState()
  }
  if (runtimeState.state === RUNTIME_WARNING_PROOF_EVIDENCE_STATES.RESOLVED) {
    if (explicitState.state === RUNTIME_WARNING_PROOF_EVIDENCE_STATES.RESOLVED
      && explicitState.value !== runtimeState.value) {
      return invalidProofState()
    }
    return runtimeState
  }
  return explicitState
}

export const buildRuntimeWarningProofEvidence = ({
  runtimeInstance = {},
  explicitSources = [],
} = {}) => {
  const selectedPack = selectRuntimeEvidencePack(runtimeInstance)
  let customerRuntimeState = unknownProofState()
  let economicRuntimeState = unknownProofState()

  if (selectedPack.state === RUNTIME_WARNING_PROOF_EVIDENCE_STATES.INVALID) {
    customerRuntimeState = invalidProofState()
    economicRuntimeState = invalidProofState()
  } else if (selectedPack.state === RUNTIME_WARNING_PROOF_EVIDENCE_STATES.RESOLVED) {
    const pack = selectedPack.value
    if (!validateEvidencePack(pack) || !isPlainObject(pack.discoveryHealth)) {
      customerRuntimeState = invalidProofState()
      economicRuntimeState = invalidProofState()
    } else {
      customerRuntimeState = resolveCoverageAreaProofState(pack.discoveryHealth.coverageAreas, 'Proof')
      economicRuntimeState = resolveCoverageAreaProofState(pack.discoveryHealth.coverageAreas, 'Economics')
    }
  }

  const customerState = combineProofStates(
    customerRuntimeState,
    resolveExplicitProofState(explicitSources, 'customerProofPresent'),
  )
  const economicState = combineProofStates(
    economicRuntimeState,
    resolveExplicitProofState(explicitSources, 'economicProofPresent'),
  )
  return {
    customerProofEvidenceState: customerState.state,
    ...(customerState.state === RUNTIME_WARNING_PROOF_EVIDENCE_STATES.RESOLVED
      ? { customerProofPresent: customerState.value }
      : {}),
    economicProofEvidenceState: economicState.state,
    ...(economicState.state === RUNTIME_WARNING_PROOF_EVIDENCE_STATES.RESOLVED
      ? { economicProofPresent: economicState.value }
      : {}),
  }
}

const sectionBody = (content, heading) => {
  const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`, 'im')
  const match = pattern.exec(content)
  if (!match) return ''
  const rest = content.slice(match.index + match[0].length)
  const nextHeading = /^##\s+/im.exec(rest)
  return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim()
}

export const parseRuntimeWarningRulesMarkdown = (packContent) => {
  if (typeof packContent !== 'string' || !normalizeText(packContent)) {
    return { valid: false, sections: {}, failures: ['PACK_CONTENT_NOT_AVAILABLE'] }
  }
  const sections = Object.fromEntries(REQUIRED_HEADINGS.map((heading) => [heading, sectionBody(packContent, heading)]))
  const failures = REQUIRED_HEADINGS
    .filter((heading) => !normalizeText(sections[heading]))
    .map((heading) => `WARNING_SECTION_${normalizeToken(heading).replace(/ /g, '_')}_INVALID`)
  return { valid: failures.length === 0, sections, failures }
}

const buildCheck = ({ key, pass, message } = {}) => ({
  key: normalizeToken(key),
  status: pass ? EXECUTOR_STATUSES.PASSED : EXECUTOR_STATUSES.FAILED,
  message: normalizeText(message),
  source: RUNTIME_WARNING_RULES_EXECUTOR_KEY,
})

const buildBlockedResult = ({ status, checks, failures, executionId } = {}) => ({
  contractVersion: RUNTIME_WARNING_RULES_EXECUTOR_CONTRACT_VERSION,
  executorKey: RUNTIME_WARNING_RULES_EXECUTOR_KEY,
  executionId,
  status,
  result: EXECUTOR_RESULTS.BLOCK,
  receipt: null,
  checks,
  failures: [...new Set(failures.map(normalizeToken).filter(Boolean))],
})

const score = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null
}

const limitationMatches = (limitations, pattern) => limitations.some((limitation) => pattern.test(limitation))

const LIMITATION_ABSENCE_LANGUAGE = '(?:none are verified|not verified|not present|absent|missing|not provided)'
const CUSTOMER_PROOF_ABSENCE_PATTERN = new RegExp(`(?:no .*customer proof|customer proof[^.!?]*${LIMITATION_ABSENCE_LANGUAGE}|${LIMITATION_ABSENCE_LANGUAGE}[^.!?]*customer proof)`, 'i')
const ECONOMIC_PROOF_ABSENCE_PATTERN = new RegExp(`(?:no (?:roi|financial impact|quantified economic)|(?:roi|financial impact|quantified|economic proof)[^.!?]*${LIMITATION_ABSENCE_LANGUAGE}|${LIMITATION_ABSENCE_LANGUAGE}[^.!?]*(?:roi|financial impact|quantified|economic proof))`, 'i')

const resolveProofPresence = ({ candidate, explicitKey, stateKey, limitations, pattern } = {}) => {
  const explicitPresent = hasOwn(candidate, explicitKey)
  const statePresent = hasOwn(candidate, stateKey)
  if (!statePresent) {
    if (explicitPresent) return typeof candidate[explicitKey] === 'boolean' ? candidate[explicitKey] : null
    return limitationMatches(limitations, pattern) ? false : null
  }

  const rawState = candidate[stateKey]
  if (typeof rawState !== 'string') return null
  const state = normalizeToken(rawState)
  if (state === RUNTIME_WARNING_PROOF_EVIDENCE_STATES.INVALID) return null
  if (state === RUNTIME_WARNING_PROOF_EVIDENCE_STATES.RESOLVED) {
    return explicitPresent && typeof candidate[explicitKey] === 'boolean' ? candidate[explicitKey] : null
  }
  if (state !== RUNTIME_WARNING_PROOF_EVIDENCE_STATES.UNKNOWN || explicitPresent) return null
  if (limitationMatches(limitations, pattern)) return false
  return null
}

const buildEvidence = (candidate = {}) => {
  const limitations = Array.isArray(candidate.limitations) ? candidate.limitations.map(normalizeText).filter(Boolean) : []
  return {
    coverageScore: score(candidate.coverageScore ?? candidate.coverage_score),
    confidenceBand: normalizeToken(candidate.confidenceBand ?? candidate.confidence_band),
    sourceDiversityBand: normalizeToken(candidate.sourceDiversityBand ?? candidate.source_diversity_band),
    contradictionCount: score(candidate.contradictionCount ?? candidate.contradiction_count),
    contradictionRisk: normalizeToken(candidate.contradictionRisk ?? candidate.contradiction_risk),
    customerProofPresent: resolveProofPresence({
      candidate,
      explicitKey: 'customerProofPresent',
      stateKey: 'customerProofEvidenceState',
      limitations,
      pattern: CUSTOMER_PROOF_ABSENCE_PATTERN,
    }),
    economicProofPresent: resolveProofPresence({
      candidate,
      explicitKey: 'economicProofPresent',
      stateKey: 'economicProofEvidenceState',
      limitations,
      pattern: ECONOMIC_PROOF_ABSENCE_PATTERN,
    }),
  }
}

const addRuleCheck = ({ checks, warnings, key, condition, warningMessage }) => {
  checks.push(buildCheck({
    key: `RULE_${key}`,
    pass: true,
    message: condition ? `Warning applied: ${warningMessage}` : 'Warning condition is clear for this candidate.',
  }))
  if (condition) warnings.push(key)
}

export const executeRuntimeWarningRulesPack = ({
  pack = {},
  packContent = '',
  candidate = {},
  asset = {},
  version = {},
  executionId = `runtime_warning_rules_exec_${randomUUID()}`,
} = {}) => {
  const checks = []
  const failures = []
  const packKey = normalizeText(pack.packKey || pack.key).toLowerCase()
  const versionId = normalizeText(pack.versionId)
  const contentHash = normalizeText(pack.contentHash)
  const boundary = resolveKnowledgePackBoundary(pack)
  const assetId = normalizeText(asset.outcomeAssetId || asset.assetId)
  const assetVersionId = normalizeText(version.outcomeAssetVersionId || version.versionId)
  const identityPass = packKey === RUNTIME_WARNING_RULES_EXECUTOR_KEY
    && Boolean(versionId && contentHash && assetId && assetVersionId)
    && boundary === KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION
  checks.push(buildCheck({ key: 'PACK_IDENTITY_BOUND', pass: identityPass, message: identityPass ? 'Exact runtime-warning-rules pack, asset, version, and post-validation boundary are bound.' : 'Exact runtime-warning-rules pack, asset, version, and post-validation boundary are required.' }))
  if (!identityPass) failures.push('PACK_IDENTITY_INVALID')

  const contentLoaded = typeof packContent === 'string' && Boolean(normalizeText(packContent))
  checks.push(buildCheck({ key: 'VERSION_CONTENT_LOADED', pass: contentLoaded, message: contentLoaded ? 'Raw server-side Knowledge Pack version content was loaded.' : 'Raw Knowledge Pack version content was not available.' }))
  if (!contentLoaded) failures.push('PACK_CONTENT_NOT_AVAILABLE')

  const hashPass = contentLoaded && /^sha256:[a-f0-9]{64}$/.test(contentHash) && sha256(packContent) === contentHash
  checks.push(buildCheck({ key: 'PACK_CONTENT_HASH_VERIFIED', pass: hashPass, message: hashPass ? 'Loaded pack content matches the bound content hash.' : 'Loaded pack content does not match the bound content hash.' }))
  if (!hashPass) failures.push('PACK_CONTENT_HASH_MISMATCH')

  const parsed = parseRuntimeWarningRulesMarkdown(packContent)
  checks.push(buildCheck({ key: 'WARNING_RULES_LOADED', pass: parsed.valid, message: parsed.valid ? 'All six source-defined warning rules and precedence sections were loaded.' : 'The persisted Markdown version does not contain the complete runtime-warning-rules contract.' }))
  failures.push(...parsed.failures)
  if (failures.length > 0) return buildBlockedResult({ status: !contentLoaded || !parsed.valid ? EXECUTOR_STATUSES.NOT_RECORDED : EXECUTOR_STATUSES.FAILED, checks, failures, executionId })

  const evidence = buildEvidence(candidate)
  const evidencePass = evidence.coverageScore !== null
    && ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'].includes(evidence.confidenceBand)
    && ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'].includes(evidence.sourceDiversityBand)
    && evidence.contradictionCount !== null
    && ['LOW', 'MEDIUM', 'HIGH', 'BLOCKING'].includes(evidence.contradictionRisk)
    && evidence.customerProofPresent !== null
    && evidence.economicProofPresent !== null
  checks.push(buildCheck({ key: 'WARNING_EVIDENCE_COMPLETE', pass: evidencePass, message: evidencePass ? 'Warning scores, bands, contradiction evidence, and proof limitations are present.' : 'Warning evidence is incomplete; proof presence must be explicit or limitation-backed.' }))
  if (!evidencePass) failures.push('WARNING_EVIDENCE_INCOMPLETE')
  const blockingPreserved = evidence.contradictionRisk !== 'BLOCKING'
  checks.push(buildCheck({ key: 'BLOCKING_RULES_PRESERVED', pass: blockingPreserved, message: blockingPreserved ? 'Blocking conditions remain distinct from warnings.' : 'Blocking contradiction risk cannot be downgraded to a warning.' }))
  if (!blockingPreserved) failures.push('BLOCKING_CONDITION_NOT_PRESERVED')
  if (failures.length > 0) return buildBlockedResult({ status: EXECUTOR_STATUSES.FAILED, checks, failures, executionId })

  const warnings = []
  addRuleCheck({ checks, warnings, key: 'LOW_COVERAGE', condition: evidence.coverageScore < 70, warningMessage: 'Coverage gaps remain visible.' })
  addRuleCheck({ checks, warnings, key: 'LOW_CONFIDENCE', condition: ['LOW', 'MEDIUM'].includes(evidence.confidenceBand), warningMessage: 'Uncertainty must remain visible.' })
  addRuleCheck({ checks, warnings, key: 'LOW_SOURCE_DIVERSITY', condition: evidence.sourceDiversityBand === 'LOW', warningMessage: 'Independent validation must not be claimed.' })
  addRuleCheck({ checks, warnings, key: 'CONTRADICTIONS_PRESENT', condition: evidence.contradictionCount > 0, warningMessage: 'Contradictions must remain visible.' })
  addRuleCheck({ checks, warnings, key: 'NO_CUSTOMER_PROOF', condition: evidence.customerProofPresent === false, warningMessage: 'Customer proof is not present.' })
  addRuleCheck({ checks, warnings, key: 'NO_QUANTIFIED_ECONOMICS', condition: evidence.economicProofPresent === false, warningMessage: 'Quantified economic proof is not present.' })
  checks.push(buildCheck({ key: 'WARNINGS_APPLIED', pass: true, message: `${warnings.length} source-defined warning conditions were applied or cleared.` }))

  const receiptChecks = [
    ...checks,
    buildCheck({ key: 'POST_VALIDATION_PASSED', pass: true, message: 'Runtime-warning-rules post-validation passed for the exact asset version.' }),
    buildCheck({ key: 'BOUNDARY_RECEIPT_RECORDED', pass: true, message: 'Exact runtime-warning-rules boundary receipt was recorded.' }),
  ]
  const receipt = {
    contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
    versionId,
    contentHash,
    boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
    receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    receiptKey: RUNTIME_WARNING_RULES_RECEIPT_KEY,
    validatorKey: RUNTIME_WARNING_RULES_EXECUTOR_KEY,
    result: EXECUTOR_RESULTS.ALLOW,
    evidenceReference: `outcome:${assetId}:${assetVersionId}:${RUNTIME_WARNING_RULES_EXECUTOR_KEY}:${executionId}`,
    status: EXECUTOR_STATUSES.PASSED,
    checks: receiptChecks,
  }
  const validation = validateOutcomeBoundaryReceipt({
    expectedPack: { ...pack, versionId, contentHash, boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION, receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION },
    receipt,
  })
  if (!validation.valid) return buildBlockedResult({ status: EXECUTOR_STATUSES.FAILED, checks: [...receiptChecks, buildCheck({ key: 'BOUNDARY_RECEIPT_CONTRACT_VALID', pass: false, message: `Generated receipt failed strict contract validation: ${validation.failures.join(', ')}.` })], failures: ['BOUNDARY_RECEIPT_CONTRACT_INVALID'], executionId })
  return { contractVersion: RUNTIME_WARNING_RULES_EXECUTOR_CONTRACT_VERSION, executorKey: RUNTIME_WARNING_RULES_EXECUTOR_KEY, executionId, status: EXECUTOR_STATUSES.PASSED, result: EXECUTOR_RESULTS.ALLOW, receipt, checks: receiptChecks, failures: [], warnings }
}
