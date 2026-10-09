import { jest } from '@jest/globals'
import { validateRecordSourceVerification, validateSourceVerificationParams } from '../validators/runtimeInstance.validator.js'

const facts = { authenticity: 'UNVERIFIED', sourceOrigin: 'Recorded origin', organizationRelationship: 'Disclosed relationship',
  independenceGroup: 'origin-1', supportingReference: 'fixture:review', rationale: 'Needs verification.' }
const body = () => ({ expectedUpdatedAt: '2026-10-09T10:00:00Z', expectedSourceFingerprint: `sha256:${'a'.repeat(64)}`, facts })
const run = (middleware, request) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }, next = jest.fn()
  middleware(request, res, next)
  return { res, next }
}
test.each(['64b000000000000000000001', 'value-narrative-fixture-rev-2'])('accepts native runtime identity %s', runtimeInstanceId => {
  expect(run(validateSourceVerificationParams, { params: { runtimeInstanceId, sourceId: 'source?one' } }).next).toHaveBeenCalledTimes(1)
})
test('valid guarded body permits only caller facts', () => {
  expect(run(validateRecordSourceVerification, { body: body() }).next).toHaveBeenCalledTimes(1)
})
test.each(['missingTimestamp', 'invalidFingerprint', 'forgedActor', 'unknownAuthority', 'missingOrigin'])('rejects %s before mutation', kind => {
  const payload = structuredClone(body())
  if (kind === 'missingTimestamp') delete payload.expectedUpdatedAt
  if (kind === 'invalidFingerprint') payload.expectedSourceFingerprint = 'unverified'
  if (kind === 'forgedActor') payload.facts.reviewedBy = 'caller'
  if (kind === 'unknownAuthority') payload.executionEligible = true
  if (kind === 'missingOrigin') delete payload.facts.sourceOrigin
  const { res, next } = run(validateRecordSourceVerification, { body: payload })
  expect(res.status).toHaveBeenCalledWith(422)
  expect(next).not.toHaveBeenCalled()
})
