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

export const TRUTH_QUALITY_DIMENSIONS_EXECUTOR_CONTRACT_VERSION =
  'outcome-studio.truth-quality-dimensions-executor.v1'
export const TRUTH_QUALITY_DIMENSIONS_EXECUTOR_KEY = 'truth-quality-dimensions'
export const TRUTH_QUALITY_DIMENSIONS_RECEIPT_KEY = 'truth-quality-dimensions.post-validation.v1'

const EXECUTOR_STATUSES = Object.freeze({ PASSED: 'PASSED', FAILED: 'FAILED', NOT_RECORDED: 'NOT_RECORDED' })
const EXECUTOR_RESULTS = Object.freeze({ ALLOW: 'ALLOW', BLOCK: 'BLOCK' })
const BAND_RANK = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3, VERY_HIGH: 4 })
const DIMENSION_HEADINGS = Object.freeze(['Coverage', 'Confidence', 'Source Diversity', 'Contradiction Risk'])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeSearchText = (value) => normalizeText(value).toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ')
const sha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`

const sectionBody = (content, heading) => {
  const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`, 'im')
  const match = pattern.exec(content)
  if (!match) return ''
  const rest = content.slice(match.index + match[0].length)
  const nextHeading = /^##\s+/im.exec(rest)
  return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim()
}

export const parseTruthQualityDimensionsMarkdown = (packContent) => {
  if (typeof packContent !== 'string' || !normalizeText(packContent)) {
    return { valid: false, sections: {}, failures: ['PACK_CONTENT_NOT_AVAILABLE'] }
  }
  const normalized = normalizeSearchText(packContent)
  const sections = Object.fromEntries(DIMENSION_HEADINGS.map((heading) => [heading, sectionBody(packContent, heading)]))
  const failures = DIMENSION_HEADINGS
    .filter((heading) => {
      const body = normalizeSearchText(sections[heading])
      return !body || !body.includes('purpose') && !normalized.includes(heading.toLowerCase())
    })
    .map((heading) => `DIMENSION_${normalizeToken(heading).replace(/ /g, '_')}_INVALID`)
  if (!normalized.includes('combined interpretation')) failures.push('COMBINED_INTERPRETATION_INVALID')
  return { valid: failures.length === 0, sections, failures }
}

const buildCheck = ({ key, pass, message } = {}) => ({
  key: normalizeToken(key),
  status: pass ? EXECUTOR_STATUSES.PASSED : EXECUTOR_STATUSES.FAILED,
  message: normalizeText(message),
  source: TRUTH_QUALITY_DIMENSIONS_EXECUTOR_KEY,
})

const buildBlockedResult = ({ status, checks, failures, executionId } = {}) => ({
  contractVersion: TRUTH_QUALITY_DIMENSIONS_EXECUTOR_CONTRACT_VERSION,
  executorKey: TRUTH_QUALITY_DIMENSIONS_EXECUTOR_KEY,
  executionId,
  status,
  result: EXECUTOR_RESULTS.BLOCK,
  receipt: null,
  checks,
  failures: [...new Set(failures.map(normalizeToken).filter(Boolean))],
})

const toScore = (value) => {
  const score = Number(value)
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null
}

const deriveBand = (score) => {
  if (score === null) return ''
  if (score < 40) return 'LOW'
  if (score < 70) return 'MEDIUM'
  if (score < 90) return 'HIGH'
  return 'VERY_HIGH'
}

const buildEvidence = (candidate = {}) => ({
  coverageScore: toScore(candidate.coverageScore ?? candidate.coverage_score),
  confidenceScore: toScore(candidate.confidenceScore ?? candidate.confidence_score),
  sourceDiversityScore: toScore(candidate.sourceDiversityScore ?? candidate.source_diversity_score),
  coverageBand: normalizeToken(candidate.coverageBand ?? candidate.coverage_band)
    || deriveBand(toScore(candidate.coverageScore ?? candidate.coverage_score)),
  confidenceBand: normalizeToken(candidate.confidenceBand ?? candidate.confidence_band),
  sourceDiversityBand: normalizeToken(candidate.sourceDiversityBand ?? candidate.source_diversity_band),
  contradictionCount: toScore(candidate.contradictionCount ?? candidate.contradiction_count),
  contradictionRisk: normalizeToken(candidate.contradictionRisk ?? candidate.contradiction_risk),
})

export const executeTruthQualityDimensionsPack = ({
  pack = {},
  packContent = '',
  candidate = {},
  asset = {},
  version = {},
  executionId = `truth_quality_dimensions_exec_${randomUUID()}`,
} = {}) => {
  const checks = []
  const failures = []
  const packKey = normalizeText(pack.packKey || pack.key).toLowerCase()
  const versionId = normalizeText(pack.versionId)
  const contentHash = normalizeText(pack.contentHash)
  const boundary = resolveKnowledgePackBoundary(pack)
  const assetId = normalizeText(asset.outcomeAssetId || asset.assetId)
  const assetVersionId = normalizeText(version.outcomeAssetVersionId || version.versionId)
  const identityPass = packKey === TRUTH_QUALITY_DIMENSIONS_EXECUTOR_KEY
    && Boolean(versionId && contentHash && assetId && assetVersionId)
    && boundary === KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION
  checks.push(buildCheck({
    key: 'PACK_IDENTITY_BOUND',
    pass: identityPass,
    message: identityPass
      ? 'Exact truth-quality-dimensions pack, asset, version, and post-validation boundary are bound.'
      : 'Exact truth-quality-dimensions pack, asset, version, and post-validation boundary are required.',
  }))
  if (!identityPass) failures.push('PACK_IDENTITY_INVALID')

  const contentLoaded = typeof packContent === 'string' && Boolean(normalizeText(packContent))
  checks.push(buildCheck({
    key: 'VERSION_CONTENT_LOADED',
    pass: contentLoaded,
    message: contentLoaded ? 'Raw server-side Knowledge Pack version content was loaded.' : 'Raw Knowledge Pack version content was not available.',
  }))
  if (!contentLoaded) failures.push('PACK_CONTENT_NOT_AVAILABLE')

  const hashPass = contentLoaded && /^sha256:[a-f0-9]{64}$/.test(contentHash) && sha256(packContent) === contentHash
  checks.push(buildCheck({
    key: 'PACK_CONTENT_HASH_VERIFIED',
    pass: hashPass,
    message: hashPass ? 'Loaded pack content matches the bound content hash.' : 'Loaded pack content does not match the bound content hash.',
  }))
  if (!hashPass) failures.push('PACK_CONTENT_HASH_MISMATCH')

  const parsed = parseTruthQualityDimensionsMarkdown(packContent)
  checks.push(buildCheck({
    key: 'TRUTH_QUALITY_DIMENSIONS_LOADED',
    pass: parsed.valid,
    message: parsed.valid ? 'Four source-defined truth-quality dimension sections were loaded.' : 'The persisted Markdown version does not contain the source-defined truth-quality dimensions.',
  }))
  failures.push(...parsed.failures)
  if (failures.length > 0) {
    return buildBlockedResult({
      status: !contentLoaded || !parsed.valid ? EXECUTOR_STATUSES.NOT_RECORDED : EXECUTOR_STATUSES.FAILED,
      checks,
      failures,
      executionId,
    })
  }

  const evidence = buildEvidence(candidate)
  const evidencePass = [evidence.coverageScore, evidence.confidenceScore, evidence.sourceDiversityScore, evidence.contradictionCount].every((value) => value !== null)
    && Object.values(BAND_RANK).includes(BAND_RANK[evidence.confidenceBand])
    && Object.values(BAND_RANK).includes(BAND_RANK[evidence.sourceDiversityBand])
    && ['LOW', 'MEDIUM', 'HIGH', 'BLOCKING'].includes(evidence.contradictionRisk)
  checks.push(buildCheck({
    key: 'TRUTH_QUALITY_EVIDENCE_COMPLETE',
    pass: evidencePass,
    message: evidencePass ? 'Scores, bands, contradiction count, and contradiction risk are present.' : 'Truth-quality evidence is incomplete or unsupported.',
  }))
  if (!evidencePass) failures.push('TRUTH_QUALITY_EVIDENCE_INCOMPLETE')

  const coveragePass = evidencePass && evidence.coverageBand === deriveBand(evidence.coverageScore)
  checks.push(buildCheck({ key: 'DIMENSION_COVERAGE_EVALUATED', pass: coveragePass, message: `Coverage evaluated at ${evidence.coverageScore} with band ${evidence.coverageBand}.` }))
  if (!coveragePass) failures.push('COVERAGE_BAND_MISMATCH')
  const confidencePass = evidencePass && evidence.confidenceBand === deriveBand(evidence.confidenceScore)
  checks.push(buildCheck({ key: 'DIMENSION_CONFIDENCE_EVALUATED', pass: confidencePass, message: `Confidence evaluated at ${evidence.confidenceScore} with band ${evidence.confidenceBand}.` }))
  if (!confidencePass) failures.push('CONFIDENCE_BAND_MISMATCH')
  // Source diversity is a qualitative runtime assessment in the persisted
  // Knowledge Pack. Its score is retained as evidence, but it does not define
  // a numeric band in the source contract.
  const sourceDiversityPass = evidencePass && Boolean(BAND_RANK[evidence.sourceDiversityBand])
  checks.push(buildCheck({ key: 'DIMENSION_SOURCE_DIVERSITY_EVALUATED', pass: sourceDiversityPass, message: `Source diversity evaluated with governed band ${evidence.sourceDiversityBand} and supporting score ${evidence.sourceDiversityScore}.` }))
  if (!sourceDiversityPass) failures.push('SOURCE_DIVERSITY_BAND_MISMATCH')
  const contradictionPass = evidencePass && ['LOW', 'MEDIUM', 'HIGH', 'BLOCKING'].includes(evidence.contradictionRisk)
  checks.push(buildCheck({ key: 'DIMENSION_CONTRADICTION_RISK_EVALUATED', pass: contradictionPass, message: `Contradiction risk evaluated as ${evidence.contradictionRisk} with ${evidence.contradictionCount} contradiction candidates.` }))
  if (!contradictionPass) failures.push('CONTRADICTION_RISK_INVALID')

  if (failures.length > 0) return buildBlockedResult({ status: EXECUTOR_STATUSES.FAILED, checks, failures, executionId })

  const receiptChecks = [
    ...checks,
    buildCheck({ key: 'POST_VALIDATION_PASSED', pass: true, message: 'Truth-quality-dimensions post-validation passed for the exact asset version.' }),
    buildCheck({ key: 'BOUNDARY_RECEIPT_RECORDED', pass: true, message: 'Exact truth-quality-dimensions boundary receipt was recorded.' }),
  ]
  const receipt = {
    contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
    versionId,
    contentHash,
    boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
    receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    receiptKey: TRUTH_QUALITY_DIMENSIONS_RECEIPT_KEY,
    validatorKey: TRUTH_QUALITY_DIMENSIONS_EXECUTOR_KEY,
    result: EXECUTOR_RESULTS.ALLOW,
    evidenceReference: `outcome:${assetId}:${assetVersionId}:${TRUTH_QUALITY_DIMENSIONS_EXECUTOR_KEY}:${executionId}`,
    status: EXECUTOR_STATUSES.PASSED,
    checks: receiptChecks,
  }
  const validation = validateOutcomeBoundaryReceipt({
    expectedPack: { ...pack, versionId, contentHash, boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION, receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION },
    receipt,
  })
  if (!validation.valid) return buildBlockedResult({
    status: EXECUTOR_STATUSES.FAILED,
    checks: [...receiptChecks, buildCheck({ key: 'BOUNDARY_RECEIPT_CONTRACT_VALID', pass: false, message: `Generated receipt failed strict contract validation: ${validation.failures.join(', ')}.` })],
    failures: ['BOUNDARY_RECEIPT_CONTRACT_INVALID'],
    executionId,
  })
  return {
    contractVersion: TRUTH_QUALITY_DIMENSIONS_EXECUTOR_CONTRACT_VERSION,
    executorKey: TRUTH_QUALITY_DIMENSIONS_EXECUTOR_KEY,
    executionId,
    status: EXECUTOR_STATUSES.PASSED,
    result: EXECUTOR_RESULTS.ALLOW,
    receipt,
    checks: receiptChecks,
    failures: [],
  }
}
