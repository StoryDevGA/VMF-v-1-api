import { describe, expect, test, jest } from '@jest/globals'
import { assertControlledReplayBinding, controlledReplayBindingDigest, assertControlledReplayProvenance,
  controlledReplaySelectorSchema, validateStoredControlledReplayProvenance, assertControlledReplayProvenancePairs,
  controlledReplayProvenanceForRow } from '../services/controlledReplayContract.js'

// Synthetic metadata witnesses: no binding registry, approval, asset load or native authority.
const pair = () => {
  const context = { environment: 'DEVELOPMENT_TEST', scope: { customerId: '1'.repeat(24), tenantId: '2'.repeat(24),
    runtimeInstanceId: '3'.repeat(24) }, revisionId: 'synthetic-r1',
  basisStateVersion: 'rsv2:11111111-1111-4111-8111-111111111111', actorUserId: '4'.repeat(24),
  authorityRef: 'synthetic-authority:1', isolationRef: 'synthetic-isolation:1', runtimeStatus: 'DRAFT',
  locked: false, published: false, heldSs044Family: false, parlon: false }
  const { environment, scope, revisionId, basisStateVersion, actorUserId, authorityRef, isolationRef } = context
  const binding = { contractVersion: 'controlled-replay-binding.v1', bindingId: 'synthetic-binding.1', bindingVersion: 1,
    classification: 'CONTROLLED_SYNTHETIC_REPLAY', environment, scope: { ...scope }, revisionId, basisStateVersion,
    actorUserId, authorityRef, isolationRef, fixture: { fixtureId: 'ss049-ac8-long-page-r1', fixtureVersion: 1,
      fixtureFileSha256: '7b7fe9a7819a71a25a043a73d7de1f9ed5b2689c36332ca981e65d7422771fd9',
      htmlSha256: '7f89c175b0da167969061551865ee67ad42b793283e61aecaec9f84aadc35777',
      sourceUrl: 'https://controlled-context.example/case-study' } }
  return { binding, context }
}
const provenanceFor = (binding, context) => ({ contractVersion: 'controlled-replay-provenance.v1',
  classification: 'CONTROLLED_SYNTHETIC_REPLAY', operation: 'CONTROLLED_HTML_REPLAY_CAPTURE',
  adapter: 'controlled-html-replay-v1', bindingId: binding.bindingId, bindingVersion: binding.bindingVersion,
  bindingDigest: controlledReplayBindingDigest(binding, context), ...binding.fixture })

describe('disabled controlled replay metadata contract', () => {
  test('stored descriptor validates intrinsically and binds native identity, not later output state or fake eligibility', () => {
    const { binding, context } = pair(), descriptor = { binding, provenance: provenanceFor(binding, context) }
    const native = { ...binding.scope, runtimeInstanceKey: binding.revisionId, stateVersion: 'later-output-state' }
    expect(validateStoredControlledReplayProvenance(descriptor, native)).toEqual(descriptor)
    for (const key of ['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey']) {
      expect(() => validateStoredControlledReplayProvenance(descriptor, { ...native, [key]: 'wrong' })).toThrow('metadata is invalid')
    }
    for (const value of [{ ...descriptor, approved: true }, { ...descriptor, binding: { ...binding, bindingVersion: '1' } },
      { ...descriptor, provenance: { ...descriptor.provenance, bindingDigest: 'sha256:' + 'f'.repeat(64) } }]) {
      expect(() => validateStoredControlledReplayProvenance(value)).toThrow('metadata is invalid')
    }
    const source = { sourceId: 'synthetic', controlledReplayProvenance: descriptor }
    const evidence = { evidenceObjectId: 'synthetic-evidence', sourceId: 'synthetic', controlledReplayProvenance: descriptor }
    expect(() => assertControlledReplayProvenancePairs({ sources: [source], evidenceObjects: [evidence] })).not.toThrow()
    for (const rows of [[source, { sourceId: 'synthetic' }], [{ sourceId: 'synthetic' }, evidence]]) {
      expect(() => assertControlledReplayProvenancePairs({ sources: [rows[0]], evidenceObjects: [rows[1]] })).toThrow('metadata is invalid')
    }
    for (const conflict of [{ adapter: 'website-html-fetch-v1' }, { operation: 'PUBLIC_RESEARCH' },
      { sourceCapture: {} }, { evidenceSupport: {} }]) {
      expect(() => controlledReplayProvenanceForRow({ ...source, ...conflict })).toThrow('metadata is invalid')
    }
  })
  test('validates synthetic DRAFT/ACTIVE context and provenance without changing inputs', () => {
    const { binding, context } = pair(), before = JSON.stringify({ binding, context })
    expect(assertControlledReplayBinding(binding, context)).toBe(binding)
    expect(assertControlledReplayProvenance(provenanceFor(binding, context), binding, context)).toBeDefined()
    context.runtimeStatus = 'ACTIVE'
    expect(assertControlledReplayBinding(binding, context)).toBe(binding)
    context.runtimeStatus = 'DRAFT'
    expect(JSON.stringify({ binding, context })).toBe(before)
  })
  test('canonical digest is key-order independent and binds every changeable field', () => {
    const { binding, context } = pair(), digest = controlledReplayBindingDigest(binding, context)
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    const reverse = row => Object.fromEntries(Object.entries(row).reverse().map(([key, value]) => [key,
      value && typeof value === 'object' ? reverse(value) : value]))
    expect(controlledReplayBindingDigest(reverse(binding), reverse(context))).toBe(digest)
    for (const key of ['revisionId', 'basisStateVersion', 'actorUserId', 'authorityRef', 'isolationRef']) {
      const next = pair()
      const value = key === 'basisStateVersion' ? 'rsv2:22222222-2222-4222-8222-222222222222'
        : key === 'actorUserId' ? '5'.repeat(24) : 'other-test-token'
      next.binding[key] = value; next.context[key] = value
      expect(controlledReplayBindingDigest(next.binding, next.context)).not.toBe(digest)
    }
    for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) {
      const next = pair(); next.binding.scope[key] = next.context.scope[key] = '6'.repeat(24)
      expect(controlledReplayBindingDigest(next.binding, next.context)).not.toBe(digest)
    }
    for (const change of [{ bindingId: 'other-binding' }, { bindingVersion: 2 }]) {
      expect(controlledReplayBindingDigest({ ...binding, ...change }, context)).not.toBe(digest)
    }
  })
  test.each(['revisionId', 'basisStateVersion', 'actorUserId', 'authorityRef', 'isolationRef', 'scope'])('rejects mismatched %s', key => {
    const { binding, context } = pair()
    if (key === 'scope') context.scope.customerId = '6'.repeat(24)
    else context[key] = key === 'actorUserId' ? '6'.repeat(24) : key === 'basisStateVersion'
      ? 'rsv2:22222222-2222-4222-8222-222222222222' : 'other'
    expect(() => assertControlledReplayBinding(binding, context)).toThrow('metadata is invalid')
  })
  test.each(['environment', 'runtimeStatus', 'locked', 'published', 'heldSs044Family', 'parlon', 'missing-flag'])('rejects unsafe context %s', key => {
    const { binding, context } = pair()
    if (key === 'environment') binding.environment = context.environment = 'PRODUCTION'
    else if (key === 'runtimeStatus') context.runtimeStatus = 'LOCKED'
    else if (key === 'missing-flag') delete context.heldSs044Family
    else context[key] = true
    expect(() => assertControlledReplayBinding(binding, context)).toThrow('metadata is invalid')
  })
  test('rejects changed frozen fixture, unknown claims, unbounded and malformed tokens', () => {
    for (const mutate of [b => { b.fixture.htmlSha256 = 'a'.repeat(64) }, b => { b.fixture.fixtureFileSha256 = 'a'.repeat(64) },
      b => { b.fixture.sourceUrl = 'https://other.example' }, b => { b.fixture.fixtureVersion = 2 },
      b => { b.active = true }, b => { b.digest = 'a'.repeat(64) }, b => { b.revisionId = 'x'.repeat(161) },
      b => { b.authorityRef = 123 }, b => { b.isolationRef = 'bad token' }, b => { b.bindingVersion = 0 }]) {
      const { binding, context } = pair(); mutate(binding)
      expect(() => assertControlledReplayBinding(binding, context)).toThrow('metadata is invalid')
    }
  })
  test('provenance exact fields bind source, digest and controlled-only operation', () => {
    const { binding, context } = pair(), provenance = provenanceFor(binding, context)
    for (const key of Object.keys(provenance)) {
      expect(() => assertControlledReplayProvenance({ ...provenance, [key]: 'wrong' }, binding, context)).toThrow('metadata is invalid')
    }
    for (const key of ['approved', 'captureTime', 'runId', 'sourceAssertion']) {
      expect(() => assertControlledReplayProvenance({ ...provenance, [key]: true }, binding, context)).toThrow('metadata is invalid')
    }
  })
  test('strict selector rejects unsafe objects before getters run', () => {
    const getter = jest.fn(() => 'synthetic-binding.1')
    const accessor = Object.defineProperty({}, 'bindingId', { enumerable: true, get: getter })
    for (const value of [accessor, Object.assign(Object.create({}), { bindingId: 'x' }),
      { bindingId: 'x', [Symbol('extra')]: 1 }, { bindingId: 'x', html: '<p>no</p>' },
      { bindingId: '../path' }, { bindingId: 'https://example.test' }, { bindingId: '\ud800' }, null, false]) {
      expect(controlledReplaySelectorSchema.safeParse(value).success).toBe(false)
    }
    expect(getter).not.toHaveBeenCalled()
    expect(controlledReplaySelectorSchema.parse({ bindingId: 'synthetic-binding.1' })).toEqual({ bindingId: 'synthetic-binding.1' })
    const { binding, context } = pair()
    for (const value of [Object.defineProperty({ ...binding }, 'fixture', { enumerable: true, get: getter }),
      { ...binding, [Symbol('extra')]: 1 }, Object.assign(Object.create({}), binding),
      Object.defineProperty({ ...binding }, 'hidden', { value: true })]) {
      expect(() => assertControlledReplayBinding(value, context)).toThrow('metadata is invalid')
    }
    expect(getter).not.toHaveBeenCalled()
  })
})
