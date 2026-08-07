import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'
import { assertCommercialStrategyDecisionPaperChainFixturePackage } from './outcomeCommercialStrategyDecisionPaperChainFixtureService.js'
import { buildCommercialStrategyDecisionPaperEvidenceManifest } from './outcomeCommercialStrategyDecisionPaperEvidenceManifestService.js'
import { buildCommercialStrategyDecisionPaperProgressSummary } from './outcomeCommercialStrategyDecisionPaperProgressSummaryService.js'
import { buildCommercialStrategyDecisionPaperReadinessProjection } from './outcomeCommercialStrategyDecisionPaperProjectionService.js'
import { buildCommercialStrategyDecisionPaperRunGate } from './outcomeCommercialStrategyDecisionPaperRunGateService.js'

const stableStringify = (value) => JSON.stringify(value, Object.keys(flattenKeys(value)).sort())

const flattenKeys = (value, keys = {}) => {
  if (Array.isArray(value)) {
    for (const item of value) flattenKeys(item, keys)
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys[key] = true
      flattenKeys(nested, keys)
    }
  }
  return keys
}

const sameValue = (left, right) => stableStringify(left) === stableStringify(right)

export const buildCommercialStrategyDecisionPaperPackageIntegrityReport = ({
  readinessPackage = {},
} = {}) => {
  const blockers = []
  if (readinessPackage.contractVersion !== COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION) {
    blockers.push({ code: 'PACKAGE_CONTRACT_VERSION_MISMATCH' })
  }
  if (readinessPackage.readinessProjection?.requestedOutputTypeKey !== COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY) {
    blockers.push({ code: 'PACKAGE_OUTPUT_TYPE_MISMATCH' })
  }

  try {
    assertCommercialStrategyDecisionPaperChainFixturePackage(
      readinessPackage.exercisePlan?.goldenReasoningChainFixturePackage,
    )
  } catch (error) {
    blockers.push({ code: error.code || 'CHAIN_FIXTURE_PACKAGE_INVALID' })
  }

  const basePackage = {
    status: readinessPackage.status,
    readinessReport: readinessPackage.readinessReport,
    exercisePlan: readinessPackage.exercisePlan,
    sprintEvidenceSnapshot: readinessPackage.sprintEvidenceSnapshot,
  }
  const expectedRunGate = buildCommercialStrategyDecisionPaperRunGate({ readinessPackage: basePackage })
  if (!sameValue(readinessPackage.runGate, expectedRunGate)) {
    blockers.push({ code: 'RUN_GATE_DERIVATION_MISMATCH' })
  }

  const packageForProjection = {
    ...basePackage,
    runGate: readinessPackage.runGate,
  }
  const expectedProjection = buildCommercialStrategyDecisionPaperReadinessProjection({
    readinessPackage: packageForProjection,
  })
  if (!sameValue(readinessPackage.readinessProjection, expectedProjection)) {
    blockers.push({ code: 'READINESS_PROJECTION_DERIVATION_MISMATCH' })
  }

  const expectedManifest = buildCommercialStrategyDecisionPaperEvidenceManifest({
    readinessProjection: readinessPackage.readinessProjection,
  })
  if (!sameValue(readinessPackage.evidenceManifest, expectedManifest)) {
    blockers.push({ code: 'EVIDENCE_MANIFEST_DERIVATION_MISMATCH' })
  }

  const expectedProgressSummary = buildCommercialStrategyDecisionPaperProgressSummary({ readinessPackage })
  if (!sameValue(readinessPackage.progressSummary, expectedProgressSummary)) {
    blockers.push({ code: 'PROGRESS_SUMMARY_DERIVATION_MISMATCH' })
  }

  return {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    status: blockers.length ? 'PACKAGE_INTEGRITY_BLOCKED' : 'PACKAGE_INTEGRITY_READY',
    blockers,
  }
}

export const assertCommercialStrategyDecisionPaperPackageIntegrity = (readinessPackage = {}) => {
  const report = buildCommercialStrategyDecisionPaperPackageIntegrityReport({ readinessPackage })
  if (report.blockers.length) {
    const error = new Error('Commercial strategy decision-paper readiness package integrity is invalid.')
    error.code = 'COMMERCIAL_STRATEGY_DECISION_PAPER_PACKAGE_INTEGRITY_INVALID'
    error.details = report
    throw error
  }
  return readinessPackage
}

export default {
  buildCommercialStrategyDecisionPaperPackageIntegrityReport,
  assertCommercialStrategyDecisionPaperPackageIntegrity,
}
