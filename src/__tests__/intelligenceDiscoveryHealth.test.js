import { test, expect } from '@jest/globals'
import { projectStoredDiscoveryHealth } from '../services/intelligenceDiscoveryHealth.js'

const assessment = () => ({ state: 'READY', blockerReasons: [], warningReasons: [], assessedAt: '2026-10-06T12:00:00.000Z' })
const pack = () => ({ discoveryHealth: { readiness: assessment() }, needsRefresh: false })
test.each(['READY', 'PARTIALLY_READY', 'NOT_READY'])('retains recorded %s without deriving an approval or score', state => {
  const value = pack(); value.discoveryHealth.readiness.state = state
  value.discoveryHealth.readiness.confidence = 99
  expect(projectStoredDiscoveryHealth(value)).toEqual({ available: true, reason: null,
    assessmentBasis: 'UNKNOWN', freshness: 'NOT_MARKED_STALE', assessment: { ...assessment(), state } })
})
test.each([
  ['STALE', { needsRefresh: true }], ['STALE', { needs_refresh: true }],
  ['UNKNOWN', {}], ['NOT_MARKED_STALE', { needs_refresh: false }],
])('recorded refresh flags produce %s without claiming input currency', (freshness, markers) => {
  expect(projectStoredDiscoveryHealth({ discoveryHealth: { readiness: assessment() }, ...markers }).freshness).toBe(freshness)
})
test.each([
  undefined, null, {}, { discoveryHealth: {} },
])('missing assessment stays unavailable %#', value => {
  expect(projectStoredDiscoveryHealth(value)).toMatchObject({ available: false, assessment: null, reason: 'ASSESSMENT_MISSING' })
})
test.each([
  { state: 'APPROVED' }, { blockerReasons: null }, { warningReasons: 'NONE' },
  { blockerReasons: ['KNOWN', 'KNOWN'] }, { warningReasons: Array.from({ length: 33 }, (_, index) => 'REASON_' + index) },
  { warningReasons: [' PRIVATE '] }, { warningReasons: ['x'.repeat(101)] },
  { blockerReasons: ['PRIVATE\u0001REASON'] }, { assessedAt: 'invalid' }, { assessedAt: 42 },
  { warningReasons: ['REASON\n'] }, { assessedAt: '2026' }, { assessedAt: '2026-10-06T12:00:00.000Z\n' },
])('malformed or overbound assessment is not truncated into readiness %#', changes => {
  const value = pack(); Object.assign(value.discoveryHealth.readiness, changes)
  expect(projectStoredDiscoveryHealth(value)).toMatchObject({ available: false, assessment: null, reason: 'ASSESSMENT_INVALID' })
})
test.each([{ needsRefresh: null }, { needs_refresh: 'false' }, { needsRefresh: true, needs_refresh: false }])('malformed/conflicting flags withhold the assessment %#', markers => {
  expect(projectStoredDiscoveryHealth({ ...pack(), ...markers })).toMatchObject({ available: false, assessment: null, reason: 'REFRESH_MARKER_INVALID' })
})
test('empty recorded time remains unknown and reason arrays are copied without input mutation', () => {
  const value = pack(); value.discoveryHealth.readiness = { ...assessment(), assessedAt: '', blockerReasons: ['RECORDED_BLOCKER'] }
  const before = JSON.stringify(value), result = projectStoredDiscoveryHealth(value)
  expect(result.assessment).toEqual({ ...value.discoveryHealth.readiness, assessedAt: null })
  result.assessment.blockerReasons.push('COPY_ONLY')
  expect(JSON.stringify(value)).toBe(before)
})
