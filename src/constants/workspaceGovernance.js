export const WORKSPACE_TYPES = Object.freeze({
  OUTCOME: 'OUTCOME',
  DISCOVERY: 'DISCOVERY',
  ADVISOR: 'ADVISOR',
  FRAMEWORK: 'FRAMEWORK',
})

export const WORKSPACE_ASSET_TYPES = Object.freeze({
  OUTCOME_NARRATIVE: 'OUTCOME_NARRATIVE',
  DISCOVERY_FINDING: 'DISCOVERY_FINDING',
  ADVISOR_RECOMMENDATION: 'ADVISOR_RECOMMENDATION',
  DECISION_MEMO: 'DECISION_MEMO',
})

export const KNOWLEDGE_PACK_CATEGORIES = Object.freeze({
  OUTCOME: 'OUTCOME',
  DISCOVERY: 'DISCOVERY',
  ADVISOR: 'ADVISOR',
  FRAMEWORK: 'FRAMEWORK',
  PLATFORM: 'PLATFORM',
})

export const DEFAULT_OUTCOME_WORKSPACE_TYPE = WORKSPACE_TYPES.OUTCOME
export const DEFAULT_OUTCOME_ASSET_TYPE = WORKSPACE_ASSET_TYPES.OUTCOME_NARRATIVE
export const DEFAULT_OUTCOME_KNOWLEDGE_PACK_CATEGORY = KNOWLEDGE_PACK_CATEGORIES.OUTCOME

export const PLATFORM_KNOWLEDGE_PACK_TYPES = Object.freeze(new Set([
  'TRUTH_CERTIFICATION',
]))

export const resolveKnowledgePackCategory = ({ packCategory, packType } = {}) => {
  const normalizedCategory = String(packCategory || '').trim().toUpperCase()
  if (Object.values(KNOWLEDGE_PACK_CATEGORIES).includes(normalizedCategory)) {
    return normalizedCategory
  }

  const normalizedPackType = String(packType || '').trim().toUpperCase()
  if (PLATFORM_KNOWLEDGE_PACK_TYPES.has(normalizedPackType)) {
    return KNOWLEDGE_PACK_CATEGORIES.PLATFORM
  }

  return DEFAULT_OUTCOME_KNOWLEDGE_PACK_CATEGORY
}
