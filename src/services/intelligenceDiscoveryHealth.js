const states = new Set(['READY', 'PARTIALLY_READY', 'NOT_READY'])
const reasons = value => Array.isArray(value) && value.length <= 32
  && new Set(value).size === value.length
  && value.every(reason => typeof reason === 'string' && reason === reason.trim() && /^[A-Z][A-Z0-9_]{0,99}$/.test(reason))
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

// Project the existing Discovery owner's recorded assessment. Do not recompute
// readiness or treat a current control read as proof of the assessment's inputs.
export function projectStoredDiscoveryHealth(pack) {
  const unavailable = reason => ({ available: false, reason, assessment: null,
    assessmentBasis: 'UNKNOWN', freshness: 'UNKNOWN' })
  if (!object(pack)) return unavailable('ASSESSMENT_MISSING')
  const markers = [pack.needsRefresh, pack.needs_refresh].filter(value => value !== undefined)
  if (markers.some(value => typeof value !== 'boolean')
    || (markers.length === 2 && markers[0] !== markers[1])) return unavailable('REFRESH_MARKER_INVALID')
  const assessment = pack.discoveryHealth?.readiness
  if (assessment === undefined) return unavailable('ASSESSMENT_MISSING')
  if (!object(assessment) || !states.has(assessment.state)
    || !reasons(assessment.blockerReasons) || !reasons(assessment.warningReasons)
    || (assessment.assessedAt !== undefined && assessment.assessedAt !== ''
      && (typeof assessment.assessedAt !== 'string' || assessment.assessedAt.length > 40
        || assessment.assessedAt !== assessment.assessedAt.trim()
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(assessment.assessedAt)
        || !Number.isFinite(Date.parse(assessment.assessedAt))))) return unavailable('ASSESSMENT_INVALID')
  return { available: true, reason: null, assessmentBasis: 'UNKNOWN',
    freshness: markers.includes(true) ? 'STALE' : markers.length ? 'NOT_MARKED_STALE' : 'UNKNOWN',
    assessment: { state: assessment.state,
      blockerReasons: [...assessment.blockerReasons], warningReasons: [...assessment.warningReasons],
      assessedAt: assessment.assessedAt || null } }
}
