import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_HELP_PATHS,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const asArray = (value) => Array.isArray(value) ? value : []
const normalizePath = (value) => String(value || '').trim().replace(/\\/g, '/')

const metadataPathSet = (helpMetadata = []) => new Set(asArray(helpMetadata)
  .map((item) => normalizePath(item.path || item.filePath || item.href))
  .filter(Boolean))

export const buildCommercialStrategyDecisionPaperHelpReadiness = ({
  helpMetadata = [],
  selectedHelpRepositoryBinding = null,
} = {}) => {
  const paths = metadataPathSet(helpMetadata)
  const missingPaths = COMMERCIAL_STRATEGY_DECISION_PAPER_HELP_PATHS.filter((path) => !paths.has(path))
  const bindingVerified = selectedHelpRepositoryBinding?.verified === true
  const blockers = [
    ...missingPaths.map((path) => ({ code: 'HELP_PATH_METADATA_MISSING', path })),
    ...(bindingVerified ? [] : [{ code: 'HELP_REPOSITORY_BINDING_NOT_VERIFIED' }]),
  ]

  return {
    status: blockers.length ? 'HELP_PUBLICATION_BLOCKED' : 'HELP_PUBLICATION_READY',
    requiredPaths: COMMERCIAL_STRATEGY_DECISION_PAPER_HELP_PATHS,
    missingPaths,
    pathsReady: missingPaths.length === 0,
    repositoryBindingVerified: bindingVerified,
    publicationReady: blockers.length === 0,
    published: false,
    blockers,
  }
}

export default {
  buildCommercialStrategyDecisionPaperHelpReadiness,
}
