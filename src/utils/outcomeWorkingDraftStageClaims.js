const APPROVAL_SUBJECT = String.raw`(?:(?:this|the) (?:working draft|draft|meaning|candidate|output|result)|(?:working draft|draft|meaning|candidate|output|result)|arl|outcome narrative plan|narrative plan|output shaping|shaping|rendered[- ]expression(?: review)?|rendered output|rl review|review layer|executive brief|publication|publishing|final asset|final candidate|final disposition)`

const PROHIBITED_STAGE_CLAIM_PATTERNS = Object.freeze([
  new RegExp(String.raw`\b${APPROVAL_SUBJECT} (?:is|was|has been|is now|has now been|remains) (?:approved|complete|completed|passed|ready|final|published)\b`, 'i'),
  /\b(?:approval|completion|passing|publication) of (?:the )?(?:working draft|draft|meaning|arl|outcome narrative plan|narrative plan|output shaping|rendered[- ]expression|rendered output|rl review|review layer|executive brief|final asset|final candidate|final disposition) (?:is|was|has been) (?:recorded|confirmed|complete|completed|approved|passed)\b/i,
  /\b(?:arl|outcome narrative plan|narrative plan|output shaping|rendered[- ]expression review|rendered expression review|rl review|review layer|executive brief) (?:is |was |has |has been )?(?:approved|passed|completed|accepted|ready|final|published)\b/i,
  /\b(?:arl|adaptive reasoning layer|meaning review|reviewer) (?:has |had )?(?:approved|accepted|ratified|signed off on) (?:the )?meaning\b/i,
  /\b(?:the )?meaning (?:received|secured|gained|obtained|has received|has secured|has gained|has obtained|was granted) (?:arl )?approval\b/i,
  /\b(?:the )?meaning (?:was|has been) (?:approved|accepted|ratified) by (?:arl|the adaptive reasoning layer|the reviewer|meaning review)\b/i,
])

export const containsOutcomeWorkingDraftProhibitedStageClaim = (value) => {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim()
    return PROHIBITED_STAGE_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized))
  }
  if (Array.isArray(value)) return value.some(containsOutcomeWorkingDraftProhibitedStageClaim)
  if (!value || typeof value !== 'object') return false
  if (typeof value.toObject === 'function') {
    return containsOutcomeWorkingDraftProhibitedStageClaim(value.toObject({ depopulate: true }))
  }
  return Object.values(value).some(containsOutcomeWorkingDraftProhibitedStageClaim)
}
