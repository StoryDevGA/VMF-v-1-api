import { createHash } from 'node:crypto'

import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE,
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key])
      return result
    }, {})
  }
  return value
}

export const hashCommercialStrategyDecisionPaperChainFixture = (fixture) => createHash('sha256')
  .update(JSON.stringify(canonicalize(fixture)))
  .digest('hex')

export const buildCommercialStrategyDecisionPaperChainFixturePackage = ({
  fixture = COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE,
} = {}) => {
  const fixtureFingerprint = hashCommercialStrategyDecisionPaperChainFixture(fixture)
  return {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    fixture,
    fixtureFingerprint,
    fixtureIntegrity: {
      status: 'FINGERPRINTED',
      algorithm: 'sha256',
      customerEvidenceIncluded: fixture.customerEvidenceIncluded === true,
      benchmarkPaperTextIncluded: fixture.benchmarkPaperTextIncluded === true,
      generatedContentIncluded: false,
    },
  }
}

export const assertCommercialStrategyDecisionPaperChainFixturePackage = (fixturePackage = {}) => {
  const fixture = fixturePackage.fixture
  const expectedFingerprint = hashCommercialStrategyDecisionPaperChainFixture(fixture)
  if (!fixture
    || fixturePackage.contractVersion !== COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION
    || fixturePackage.requestedOutputTypeKey !== COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY
    || fixturePackage.fixtureFingerprint !== expectedFingerprint
    || fixture?.customerEvidenceIncluded === true
    || fixture?.benchmarkPaperTextIncluded === true
    || fixturePackage.fixtureIntegrity?.generatedContentIncluded === true) {
    const error = new Error('Commercial strategy decision-paper chain fixture package is invalid.')
    error.code = 'COMMERCIAL_STRATEGY_DECISION_PAPER_CHAIN_FIXTURE_INVALID'
    error.details = { expectedFingerprint }
    throw error
  }
  return fixturePackage
}

export default {
  buildCommercialStrategyDecisionPaperChainFixturePackage,
  assertCommercialStrategyDecisionPaperChainFixturePackage,
  hashCommercialStrategyDecisionPaperChainFixture,
}
