export const OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_IDS = Object.freeze({
  APPROVED_MEANING_TERM: 'APPROVED_MEANING_TERM',
  APPROVED_MEANING_CLAIM: 'APPROVED_MEANING_CLAIM',
  FINAL_ASSET_CLAIM: 'FINAL_ASSET_CLAIM',
  LATER_QUALITY_STAGE_CLAIM: 'LATER_QUALITY_STAGE_CLAIM',
  OUT_OF_SCOPE_DELIVERY_CLAIM: 'OUT_OF_SCOPE_DELIVERY_CLAIM',
})

export const OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_ID_VALUES = Object.freeze(
  Object.values(OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_IDS),
)

export const OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATH_CLASSES = Object.freeze([
  'title',
  'sections.*.title',
  'sections.*.analysis',
  'sections.*.implications',
  'sections.*.recommendations',
  'sections.*.qualification',
  'sections.*.assumptions',
  'sections.*.gaps',
  'decisionUsefulness.summary',
  'decisionUsefulness.priorities',
  'decisionUsefulness.materialRisks',
  'decisionUsefulness.recommendedNextStep',
  'assumptions',
])

const APPROVAL_SUBJECT = String.raw`(?:(?:this|that)(?: (?:analysis|framework|guidance|candidate|output|result))?|the (?:analysis|framework|guidance|candidate|output|result))`

const CLAIM_PATTERNS = Object.freeze([
  {
    patternId: OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_IDS.APPROVED_MEANING_TERM,
    pattern: new RegExp(String.raw`\b${APPROVAL_SUBJECT} (?:is|was|has been) (?:the )?approved[- ]meaning\b`, 'i'),
  },
  {
    patternId: OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_IDS.APPROVED_MEANING_TERM,
    pattern: /\b(?:the )?approved[- ]meaning (?:is|was|has been|remains) (?:approved|complete|completed|ready|final|established|confirmed|recorded)\b/i,
  },
  {
    patternId: OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_IDS.APPROVED_MEANING_CLAIM,
    pattern: /\bmeaning (?:is|was|has been) approved\b/i,
  },
  {
    patternId: OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_IDS.APPROVED_MEANING_CLAIM,
    pattern: new RegExp(String.raw`\b${APPROVAL_SUBJECT} (?:records|recorded|confirms|confirmed|establishes|established|constitutes|constituted|represents|represented) approval of (?:the )?meaning\b`, 'i'),
  },
  {
    patternId: OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_IDS.APPROVED_MEANING_CLAIM,
    pattern: /\bapproval of (?:the )?meaning (?:is|was|has been) (?:recorded|confirmed|complete|completed|established)\b/i,
  },
  {
    patternId: OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_IDS.FINAL_ASSET_CLAIM,
    pattern: /\bfinal (?:candidate|disposition) (?:is|was|has been)? ?(?:approved|complete|completed|ready)\b/i,
  },
  {
    patternId: OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_IDS.FINAL_ASSET_CLAIM,
    pattern: /\b(?:final )?asset (?:is|was|has been)? ?published\b/i,
  },
  {
    patternId: OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_IDS.LATER_QUALITY_STAGE_CLAIM,
    pattern: /\b(?:working draft|outcome narrative plan|output shaping|rendered-expression review|rendered expression review) (?:is|was|has been)? ?(?:approved|complete|completed|ready)\b/i,
  },
  {
    patternId: OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_IDS.OUT_OF_SCOPE_DELIVERY_CLAIM,
    pattern: /\b(?:publication|publishing|presentation|infographic) (?:is|was|has been)? ?(?:approved|complete|completed|ready)\b/i,
  },
])

const matchClaim = (value, fieldPathClass) => {
  if (typeof value !== 'string' || !value) return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  const match = CLAIM_PATTERNS.find(({ pattern }) => pattern.test(normalized))
  return match ? { patternId: match.patternId, fieldPathClass } : null
}

const matchClaimList = (value, fieldPathClass) => {
  if (!Array.isArray(value)) return null
  for (const item of value) {
    const match = matchClaim(item, fieldPathClass)
    if (match) return match
  }
  return null
}

const SECTION_FIELDS = Object.freeze([
  ['title', false],
  ['analysis', false],
  ['implications', true],
  ['recommendations', true],
  ['qualification', false],
  ['assumptions', true],
  ['gaps', true],
])

const DECISION_FIELDS = Object.freeze([
  ['summary', false],
  ['priorities', true],
  ['materialRisks', true],
  ['recommendedNextStep', false],
])

export const findOutcomeFrameworkGuidanceStageClaimDiagnostic = (value) => {
  if (typeof value === 'string') return matchClaim(value, 'title')
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  let match = matchClaim(value.title, 'title')
  if (match) return match

  if (value.sections && typeof value.sections === 'object') {
    const sections = Array.isArray(value.sections) ? value.sections : Object.values(value.sections)
    for (const section of sections) {
      if (!section || typeof section !== 'object' || Array.isArray(section)) continue
      for (const [field, isList] of SECTION_FIELDS) {
        const fieldPathClass = `sections.*.${field}`
        match = isList
          ? matchClaimList(section[field], fieldPathClass)
          : matchClaim(section[field], fieldPathClass)
        if (match) return match
      }
    }
  }

  const decisionUsefulness = value.decisionUsefulness
  if (decisionUsefulness && typeof decisionUsefulness === 'object' && !Array.isArray(decisionUsefulness)) {
    for (const [field, isList] of DECISION_FIELDS) {
      const fieldPathClass = `decisionUsefulness.${field}`
      match = isList
        ? matchClaimList(decisionUsefulness[field], fieldPathClass)
        : matchClaim(decisionUsefulness[field], fieldPathClass)
      if (match) return match
    }
  }

  return matchClaimList(value.assumptions, 'assumptions')
}

export const findOutcomeFrameworkGuidanceStageClaim = (value) => (
  findOutcomeFrameworkGuidanceStageClaimDiagnostic(value)?.patternId || null
)

export const isOutcomeFrameworkGuidanceStageClaimPatternId = (value) => (
  OUTCOME_FRAMEWORK_GUIDANCE_STAGE_CLAIM_PATTERN_ID_VALUES.includes(value)
)
