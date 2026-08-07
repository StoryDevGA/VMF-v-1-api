import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_SOURCE_AUTHORITY_REQUIREMENTS,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const asArray = (value) => Array.isArray(value) ? value : []
const lower = (value) => String(value || '').trim().toLowerCase()

const sourceInventoryIndex = (sourceInventory = []) => {
  const byDocument = new Set()
  const bySupportAsset = new Set()
  for (const item of asArray(sourceInventory)) {
    for (const documentName of asArray(item.sourceDocuments)) byDocument.add(lower(documentName))
    for (const supportAssetPath of asArray(item.supportAssetPaths)) bySupportAsset.add(lower(supportAssetPath))
    if (item.sourceDocument) byDocument.add(lower(item.sourceDocument))
    if (item.supportAssetPath) bySupportAsset.add(lower(item.supportAssetPath))
  }
  return { byDocument, bySupportAsset }
}

const missingPackKeysFromReadiness = (readinessReport = {}) => new Set([
  ...asArray(readinessReport.missing).map((pack) => lower(pack.packKey)),
  ...asArray(readinessReport.requiredPacks)
    .filter((pack) => asArray(pack.blockers).length)
    .map((pack) => lower(pack.packKey)),
].filter(Boolean))

export const buildCommercialStrategyDecisionPaperSourceIntakePlan = ({
  readinessReport,
  sourceInventory = [],
} = {}) => {
  const missingPackKeys = missingPackKeysFromReadiness(readinessReport)
  const inventory = sourceInventoryIndex(sourceInventory)
  const intakeRequirements = COMMERCIAL_STRATEGY_DECISION_PAPER_SOURCE_AUTHORITY_REQUIREMENTS
    .filter((requirement) => missingPackKeys.has(lower(requirement.packKey)))
    .map((requirement) => {
      const sourceDocuments = requirement.sourceDocuments.map((documentName) => ({
        documentName,
        presentInInventory: inventory.byDocument.has(lower(documentName)),
      }))
      const supportAssets = requirement.supportAssetPaths.map((supportAssetPath) => ({
        supportAssetPath,
        presentInInventory: inventory.bySupportAsset.has(lower(supportAssetPath)),
      }))
      const sourceMaterialPresent = sourceDocuments.every((item) => item.presentInInventory)
        || supportAssets.every((item) => item.presentInInventory)
      return {
        packKey: requirement.packKey,
        sourceDocuments,
        supportAssets,
        sourceMaterialPresent,
        activationReady: false,
        activationReadyReason: sourceMaterialPresent
          ? 'SOURCE_MATERIAL_PRESENT_REQUIRES_GOVERNED_IMPORT_ACTIVATION'
          : 'SOURCE_MATERIAL_MISSING',
      }
    })

  return {
    status: intakeRequirements.length ? 'INTAKE_REQUIRED' : 'NO_MISSING_PACK_INTAKE_REQUIRED',
    activationReady: false,
    activationReadyReason: intakeRequirements.length
      ? 'SOURCE_INTAKE_DOES_NOT_ACTIVATE_KNOWLEDGE_PACKS'
      : 'READINESS_REPORT_HAS_NO_MISSING_PACK_REQUIREMENTS',
    intakeRequirements,
  }
}

export default {
  buildCommercialStrategyDecisionPaperSourceIntakePlan,
}
