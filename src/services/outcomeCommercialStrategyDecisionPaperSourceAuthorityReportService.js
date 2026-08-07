import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const asArray = (value) => Array.isArray(value) ? value : []

export const buildCommercialStrategyDecisionPaperSourceAuthorityReport = ({
  sourceIntake = {},
} = {}) => {
  const requirements = asArray(sourceIntake.intakeRequirements).map((requirement) => {
    const sourceDocuments = asArray(requirement.sourceDocuments)
    const supportAssets = asArray(requirement.supportAssets)
    const missingSourceDocuments = sourceDocuments
      .filter((item) => item.presentInInventory !== true)
      .map((item) => item.documentName)
      .filter(Boolean)
    const presentSourceDocuments = sourceDocuments
      .filter((item) => item.presentInInventory === true)
      .map((item) => item.documentName)
      .filter(Boolean)
    const missingSupportAssets = supportAssets
      .filter((item) => item.presentInInventory !== true)
      .map((item) => item.supportAssetPath)
      .filter(Boolean)
    const presentSupportAssets = supportAssets
      .filter((item) => item.presentInInventory === true)
      .map((item) => item.supportAssetPath)
      .filter(Boolean)

    return {
      packKey: requirement.packKey,
      activationReady: false,
      activationReadyReason: requirement.activationReadyReason || 'SOURCE_INTAKE_DOES_NOT_ACTIVATE_KNOWLEDGE_PACKS',
      sourceMaterialPresent: requirement.sourceMaterialPresent === true,
      missingSourceDocuments,
      presentSourceDocuments,
      missingSupportAssets,
      presentSupportAssets,
    }
  })

  const missingSourceDocuments = [...new Set(requirements.flatMap((item) => item.missingSourceDocuments))].sort()
  const presentSourceDocuments = [...new Set(requirements.flatMap((item) => item.presentSourceDocuments))].sort()
  const missingSupportAssets = [...new Set(requirements.flatMap((item) => item.missingSupportAssets))].sort()
  const presentSupportAssets = [...new Set(requirements.flatMap((item) => item.presentSupportAssets))].sort()

  return {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    status: requirements.length ? 'SOURCE_AUTHORITY_REQUIRED' : 'NO_SOURCE_AUTHORITY_GAPS',
    activationReady: false,
    activationReadyReason: requirements.length
      ? 'SOURCE_AUTHORITY_REPORT_DOES_NOT_ACTIVATE_KNOWLEDGE_PACKS'
      : 'NO_MISSING_PACK_SOURCE_AUTHORITY_REQUIREMENTS',
    requiredPackKeys: requirements.map((item) => item.packKey).filter(Boolean).sort(),
    missingSourceDocuments,
    presentSourceDocuments,
    missingSupportAssets,
    presentSupportAssets,
    requirements,
  }
}

export default {
  buildCommercialStrategyDecisionPaperSourceAuthorityReport,
}
