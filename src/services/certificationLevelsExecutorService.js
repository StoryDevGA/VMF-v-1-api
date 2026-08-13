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

export const CERTIFICATION_LEVELS_EXECUTOR_CONTRACT_VERSION =
  'outcome-studio.certification-levels-executor.v1'
export const CERTIFICATION_LEVELS_EXECUTOR_KEY = 'certification-levels'
export const CERTIFICATION_LEVELS_RECEIPT_KEY = 'certification-levels.post-validation.v1'

const EXECUTOR_STATUSES = Object.freeze({
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  NOT_RECORDED: 'NOT_RECORDED',
})

const EXECUTOR_RESULTS = Object.freeze({
  ALLOW: 'ALLOW',
  BLOCK: 'BLOCK',
})

const BAND_RANK = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  VERY_HIGH: 4,
})

const SOURCE_LEVELS = Object.freeze([
  Object.freeze({
    key: 'EVIDENCE_PRESENT',
    heading: 'Evidence Present',
    requirements: [
      'coverage score is at least 20',
      'accepted truth count is greater than zero',
      'evidence count is greater than zero',
    ],
    eligible: (evidence) => evidence.coverageScore >= 20
      && evidence.acceptedTruthCount > 0
      && evidence.evidenceCount > 0,
  }),
  Object.freeze({
    key: 'EVIDENCE_SUPPORTED',
    heading: 'Evidence Supported',
    requirements: [
      'coverage score is at least 40',
      'confidence band is medium or higher',
      'unresolved contradiction risk is neither high nor blocking',
    ],
    eligible: (evidence) => evidence.coverageScore >= 40
      && evidence.confidenceRank >= BAND_RANK.MEDIUM
      && !['HIGH', 'BLOCKING'].includes(evidence.contradictionRisk),
  }),
  Object.freeze({
    key: 'CERTIFIED_TRUTH',
    heading: 'Certified Truth',
    requirements: [
      'coverage score is at least 70',
      'confidence band is high or higher',
      'source-diversity band is medium or higher',
      'contradiction risk is low or medium',
      'publish snapshot identifier is present',
      'lock snapshot identifier is present',
      'replay anchor identifier is present',
    ],
    eligible: (evidence) => evidence.coverageScore >= 70
      && evidence.confidenceRank >= BAND_RANK.HIGH
      && evidence.sourceDiversityRank >= BAND_RANK.MEDIUM
      && ['LOW', 'MEDIUM'].includes(evidence.contradictionRisk)
      && Boolean(evidence.publishSnapshotId)
      && Boolean(evidence.lockSnapshotId)
      && Boolean(evidence.replayAnchorId),
  }),
  Object.freeze({
    key: 'STRATEGIC_TRUTH',
    heading: 'Strategic Truth',
    requirements: [
      'coverage score is at least 85',
      'confidence band is high or very high',
      'source-diversity band is high or very high',
      'contradiction risk is low',
      'publish snapshot identifier is present',
      'lock snapshot identifier is present',
      'replay anchor identifier is present',
    ],
    eligible: (evidence) => evidence.coverageScore >= 85
      && evidence.confidenceRank >= BAND_RANK.HIGH
      && evidence.sourceDiversityRank >= BAND_RANK.HIGH
      && evidence.contradictionRisk === 'LOW'
      && Boolean(evidence.publishSnapshotId)
      && Boolean(evidence.lockSnapshotId)
      && Boolean(evidence.replayAnchorId),
  }),
])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeSearchText = (value) => normalizeText(value)
  .toLowerCase()
  .replace(/[`*_]/g, '')
  .replace(/\s+/g, ' ')
const sha256 = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`

const buildCheck = ({ key, pass, message } = {}) => ({
  key: normalizeToken(key),
  status: pass ? EXECUTOR_STATUSES.PASSED : EXECUTOR_STATUSES.FAILED,
  message: normalizeText(message),
  source: CERTIFICATION_LEVELS_EXECUTOR_KEY,
})

const buildBlockedResult = ({ status, checks, failures, executionId } = {}) => ({
  contractVersion: CERTIFICATION_LEVELS_EXECUTOR_CONTRACT_VERSION,
  executorKey: CERTIFICATION_LEVELS_EXECUTOR_KEY,
  executionId,
  status,
  result: EXECUTOR_RESULTS.BLOCK,
  receipt: null,
  checks,
  failures: [...new Set(failures.map(normalizeToken).filter(Boolean))],
})

const sectionBody = (content, heading) => {
  const headingPattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`, 'im')
  const match = headingPattern.exec(content)
  if (!match) return ''
  const rest = content.slice(match.index + match[0].length)
  const nextHeading = /^##\s+/im.exec(rest)
  return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim()
}

export const parseCertificationLevelsMarkdown = (packContent) => {
  if (typeof packContent !== 'string' || !normalizeText(packContent)) {
    return { valid: false, levels: [], failures: ['PACK_CONTENT_NOT_AVAILABLE'] }
  }

  const normalizedContent = normalizeSearchText(packContent)
  const failures = []
  const levels = SOURCE_LEVELS.map((level) => {
    const body = sectionBody(packContent, level.heading)
    const normalizedBody = normalizeSearchText(body)
    const bodyValid = Boolean(body)
      && normalizedBody.includes('minimum requirements')
      && normalizedBody.includes('meaning')
      && normalizedBody.includes('output instruction')
    const requirementsValid = level.requirements.every((requirement) => normalizedBody.includes(requirement))
    if (!bodyValid || !requirementsValid) failures.push(`LEVEL_${level.key}_INVALID`)
    return { ...level, body }
  })
  if (!normalizedContent.includes('assign only the highest level')) failures.push('ASSIGNMENT_RULES_INVALID')

  return {
    valid: failures.length === 0,
    levels,
    failures,
  }
}

const toScore = (value) => {
  const score = Number(value)
  return Number.isFinite(score) && score >= 0 ? score : null
}

const buildEvidence = (candidate = {}) => {
  const coverageScore = toScore(candidate.coverageScore ?? candidate.coverage_score)
  const acceptedTruthCount = toScore(candidate.acceptedTruthCount ?? candidate.accepted_truth_count)
  const evidenceCount = toScore(candidate.evidenceCount ?? candidate.evidence_count)
  const confidenceBand = normalizeToken(candidate.confidenceBand ?? candidate.confidence_band)
  const sourceDiversityBand = normalizeToken(candidate.sourceDiversityBand ?? candidate.source_diversity_band)
  return {
    acceptedTruthCount,
    evidenceCount,
    coverageScore,
    confidenceBand,
    confidenceRank: BAND_RANK[confidenceBand] || 0,
    sourceDiversityBand,
    sourceDiversityRank: BAND_RANK[sourceDiversityBand] || 0,
    contradictionRisk: normalizeToken(candidate.contradictionRisk ?? candidate.contradiction_risk),
    publishSnapshotId: normalizeText(candidate.publishSnapshotId ?? candidate.publish_snapshot_id),
    lockSnapshotId: normalizeText(candidate.lockSnapshotId ?? candidate.lock_snapshot_id),
    replayAnchorId: normalizeText(candidate.replayAnchorId ?? candidate.replay_anchor_id),
  }
}

const evidenceComplete = (evidence) => evidence.acceptedTruthCount !== null
  && evidence.evidenceCount !== null
  && evidence.coverageScore !== null
  && Boolean(evidence.confidenceRank)
  && Boolean(evidence.sourceDiversityRank)
  && ['LOW', 'MEDIUM', 'HIGH', 'BLOCKING'].includes(evidence.contradictionRisk)

export const executeCertificationLevelsPack = ({
  pack = {},
  packContent = '',
  candidate = {},
  asset = {},
  version = {},
  executionId = `certification_levels_exec_${randomUUID()}`,
} = {}) => {
  const checks = []
  const failures = []
  const packKey = normalizeText(pack.packKey || pack.key).toLowerCase()
  const versionId = normalizeText(pack.versionId)
  const contentHash = normalizeText(pack.contentHash)
  const boundary = resolveKnowledgePackBoundary(pack)
  const assetId = normalizeText(asset.outcomeAssetId || asset.assetId)
  const assetVersionId = normalizeText(version.outcomeAssetVersionId || version.versionId)

  const identityPass = packKey === CERTIFICATION_LEVELS_EXECUTOR_KEY
    && Boolean(versionId)
    && Boolean(contentHash)
    && boundary === KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION
    && Boolean(assetId)
    && Boolean(assetVersionId)
  checks.push(buildCheck({
    key: 'PACK_IDENTITY_BOUND',
    pass: identityPass,
    message: identityPass
      ? 'Exact certification-levels pack, asset, version, and post-validation boundary are bound.'
      : 'Exact certification-levels pack, asset, version, and post-validation boundary are required.',
  }))
  if (!identityPass) failures.push('PACK_IDENTITY_INVALID')

  const contentLoaded = typeof packContent === 'string' && Boolean(normalizeText(packContent))
  checks.push(buildCheck({
    key: 'VERSION_CONTENT_LOADED',
    pass: contentLoaded,
    message: contentLoaded
      ? 'Raw server-side Knowledge Pack version content was loaded.'
      : 'Raw Knowledge Pack version content was not available.',
  }))
  if (!contentLoaded) failures.push('PACK_CONTENT_NOT_AVAILABLE')

  const hashPass = contentLoaded
    && /^sha256:[a-f0-9]{64}$/.test(contentHash)
    && sha256(packContent) === contentHash
  checks.push(buildCheck({
    key: 'PACK_CONTENT_HASH_VERIFIED',
    pass: hashPass,
    message: hashPass
      ? 'Loaded pack content matches the bound content hash.'
      : 'Loaded pack content does not match the bound content hash.',
  }))
  if (!hashPass) failures.push('PACK_CONTENT_HASH_MISMATCH')

  const parsed = parseCertificationLevelsMarkdown(packContent)
  checks.push(buildCheck({
    key: 'CERTIFICATION_LEVELS_LOADED',
    pass: parsed.valid,
    message: parsed.valid
      ? 'All four source-defined certification levels and assignment rules were loaded.'
      : 'The persisted Markdown version does not contain the complete source-defined certification-level contract.',
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
  const complete = evidenceComplete(evidence)
  checks.push(buildCheck({
    key: 'CERTIFICATION_EVIDENCE_COMPLETE',
    pass: complete,
    message: complete
      ? 'Scores, bands, contradiction risk, and accepted-truth evidence are present.'
      : 'Certification evidence is incomplete or contains an unsupported band.',
  }))
  if (!complete) failures.push('CERTIFICATION_EVIDENCE_INCOMPLETE')

  const eligibleLevels = complete
    ? parsed.levels.filter((level) => level.eligible(evidence))
    : []
  const assignedLevel = eligibleLevels.at(-1) || null
  checks.push(buildCheck({
    key: 'CERTIFICATION_LEVEL_ASSIGNED',
    pass: Boolean(assignedLevel),
    message: assignedLevel
      ? `Highest eligible certification level assigned: ${assignedLevel.key}.`
      : 'No certification level is eligible for the exact candidate evidence.',
  }))
  if (!assignedLevel) failures.push('NO_ELIGIBLE_CERTIFICATION_LEVEL')

  if (failures.length > 0) {
    return buildBlockedResult({
      status: EXECUTOR_STATUSES.FAILED,
      checks,
      failures,
      executionId,
    })
  }

  const receiptChecks = [
    ...checks,
    buildCheck({
      key: 'POST_VALIDATION_PASSED',
      pass: true,
      message: `Certification levels post-validation passed with ${assignedLevel.key}.`,
    }),
    buildCheck({
      key: 'BOUNDARY_RECEIPT_RECORDED',
      pass: true,
      message: 'Exact certification-levels boundary receipt was recorded.',
    }),
  ]
  const receipt = {
    contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
    versionId,
    contentHash,
    boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
    receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    receiptKey: CERTIFICATION_LEVELS_RECEIPT_KEY,
    validatorKey: CERTIFICATION_LEVELS_EXECUTOR_KEY,
    result: EXECUTOR_RESULTS.ALLOW,
    evidenceReference: `outcome:${assetId}:${assetVersionId}:${CERTIFICATION_LEVELS_EXECUTOR_KEY}:${executionId}`,
    status: EXECUTOR_STATUSES.PASSED,
    checks: receiptChecks,
  }
  const receiptValidation = validateOutcomeBoundaryReceipt({
    expectedPack: {
      ...pack,
      versionId,
      contentHash,
      boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
      receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
    },
    receipt,
  })
  if (!receiptValidation.valid) {
    return buildBlockedResult({
      status: EXECUTOR_STATUSES.FAILED,
      checks: [
        ...receiptChecks,
        buildCheck({
          key: 'BOUNDARY_RECEIPT_CONTRACT_VALID',
          pass: false,
          message: `Generated receipt failed strict contract validation: ${receiptValidation.failures.join(', ')}.`,
        }),
      ],
      failures: ['BOUNDARY_RECEIPT_CONTRACT_INVALID'],
      executionId,
    })
  }

  return {
    contractVersion: CERTIFICATION_LEVELS_EXECUTOR_CONTRACT_VERSION,
    executorKey: CERTIFICATION_LEVELS_EXECUTOR_KEY,
    executionId,
    status: EXECUTOR_STATUSES.PASSED,
    result: EXECUTOR_RESULTS.ALLOW,
    receipt,
    checks: receiptChecks,
    failures: [],
    assignedLevel: assignedLevel.key,
  }
}
