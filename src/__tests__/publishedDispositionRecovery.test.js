import { describe, test, expect, jest, afterEach } from '@jest/globals'
import { buildPublishedDispositionPopulation, assertPublishedDispositionPopulation } from '../services/publishedDispositionPopulationService.js'
import mongoose from 'mongoose'
import { buildEvidenceMembershipBody, assertEvidenceMembershipBody, buildPublishedEvidenceMembershipManifest,
  assertPublishedEvidenceMembershipManifest, membershipHash, evidenceMaterialHash,
  EVIDENCE_MEMBERSHIP_VERSION, PUBLISHED_EVIDENCE_MEMBERSHIP_VERSION } from '../services/runtimeEvidenceSnapshotContract.js'
import Receipt from '../models/RuntimePublishedDispositionReceipt.js'
import { PUBLISHED_DISPOSITION_POLICY as policy } from '../constants/publishedDispositionRecoveryPolicy.js'
import { publishedDispositionBodySchema, reviewCompletionBodySchema } from '../validators/reviewCompletion.validator.js'
import { isPublishedDispositionRecoveryRuntime, publishedRuntimeWitnessHash, assertPublishedDispositionControl } from '../services/publishedDispositionRecoveryService.js'

const fixture = () => {
  const oid = number => new mongoose.Types.ObjectId(String(number).padStart(24, '0'))
  const state = 'rsv2:123e4567-e89b-42d3-a456-426614174000'
  const runtime = { _id: oid(1), customerId: oid(2), tenantId: oid(3), runtimeInstanceKey: 'neutral-r1', workspaceId: '',
    revision: { revisionNumber: 1 }, packageId: oid(4), packageKey: 'neutral-package', packageVersion: '1.0',
    dependencyLockId: 'dependency-1', activationId: 'activation-1', deploymentId: 'deployment-1', stateVersion: state }
  const common = { customerId: runtime.customerId, tenantId: runtime.tenantId, runtimeInstanceId: runtime._id,
    runtimeInstanceKey: runtime.runtimeInstanceKey, stateVersion: state, sourceStateVersion: state, current: true,
    sourceHash: 'sha256:' + 'b'.repeat(64) }
  const sources = [{ ...common, _id: oid(5), sourceId: 'source-1' }]
  const evidence = [{ ...common, _id: oid(6), evidenceObjectId: 'evidence-1', sourceId: 'source-1', extractedFact: 'A fictional review remains outstanding.' }]
  const sections = [{ ...common, _id: oid(7), sectionKey: 'neutral_section', sectionDetail: { accepted: { evidenceRefs: ['evidence-1'] } } }]
  const lockTruthRecord = { snapshotId: 'lock-neutral', snapshotHash: 'a'.repeat(64), snapshotAt: '2026-10-15T12:00:00.000Z',
    contractVersion: 'runtime-truth-snapshot-v1', actionKey: 'LOCK_RECORD' }
  return { runtime, sources, evidence, sections, lockTruthRecord }
}
afterEach(() => jest.restoreAllMocks())

describe('published membership is real prelock material, not an invented lock', () => {
  test('shares every member/hash with locked v1 while omitting lock metadata', () => {
    const f = fixture(), published = buildPublishedEvidenceMembershipManifest(f), locked = buildEvidenceMembershipBody(f)
    expect(published.contractVersion).toBe(PUBLISHED_EVIDENCE_MEMBERSHIP_VERSION)
    expect(published).not.toHaveProperty('lockTruthRecord')
    expect(assertPublishedEvidenceMembershipManifest(published)).toEqual(published)
    const expectedLocked = { ...published, contractVersion: EVIDENCE_MEMBERSHIP_VERSION, lockTruthRecord: f.lockTruthRecord }
    expect(locked).toEqual(expectedLocked)
    expect(membershipHash(locked)).toBe(membershipHash(expectedLocked))
    expect(assertEvidenceMembershipBody(locked)).toEqual(locked)
    expect(() => assertEvidenceMembershipBody(published)).toThrow()
    expect(() => assertPublishedEvidenceMembershipManifest(locked)).toThrow()
  })
  test.each(['customerId', 'tenantId', 'runtimeInstanceId', 'stateVersion', 'sourceStateVersion'])('rejects foreign/stale %s before freezing', field => {
    const f = fixture(); f.evidence[0][field] = field.includes('Version') ? 'rsv2:223e4567-e89b-42d3-a456-426614174000' : new mongoose.Types.ObjectId()
    expect(() => buildPublishedEvidenceMembershipManifest(f)).toThrow()
  })
  test('material changes alter the actual frozen hash without mutating input', () => {
    const f = fixture(), original = buildPublishedEvidenceMembershipManifest(f)
    const prior = evidenceMaterialHash(f.evidence[0]); f.evidence[0].extractedFact = 'A different source assertion.'
    expect(evidenceMaterialHash(f.evidence[0])).not.toBe(prior)
    expect(membershipHash(buildPublishedEvidenceMembershipManifest(f))).not.toBe(membershipHash(original))
    expect(original.evidence[0].materialHash).toBe(prior)
  })
  test.each(['extra', 'counts', 'version', 'source'])('strict manifest rejects malformed %s', kind => {
    const body = buildPublishedEvidenceMembershipManifest(fixture())
    if (kind === 'extra') body.lockTruthRecord = {}
    if (kind === 'counts') body.counts.evidence++
    if (kind === 'version') body.contractVersion = EVIDENCE_MEMBERSHIP_VERSION
    if (kind === 'source') body.evidence[0].sourceId = 'not-frozen'
    expect(() => assertPublishedEvidenceMembershipManifest(body)).toThrow()
  })
  test('unknown supporting context cannot become evidence or an empty proof', () => {
    const f = fixture(); f.sections[0].sectionDetail.accepted.supportingEvidenceRefs = ['unknown_context']
    expect(() => buildPublishedEvidenceMembershipManifest(f)).toThrow()
  })
  test('known context requires actual matching native material', () => {
    const f = fixture(), detail = f.sections[0].sectionDetail
    detail.input = 'Review remains outstanding.'
    detail.accepted.supportingEvidenceRefs = ['section_input']
    detail.intelligence = { supportingEvidence: [{ refKey: 'section_input', sourceType: 'USER_CONTEXT', label: 'Customer section context', summary: detail.input }],
      scopedEvidence: { sourceRefs: [{ refKey: 'section_input', type: 'USER_CONTEXT', label: 'Customer section context', safeDisplay: detail.input }] } }
    const body = buildPublishedEvidenceMembershipManifest(f)
    expect(body.sections[0].contextBindings.references[0].refKey).toBe('section_input')
    expect(body.sections[0].resolvedEvidenceIds).toEqual(['evidence-1'])
    detail.intelligence.scopedEvidence.sourceRefs[0].safeDisplay = 'Unsupported replacement.'
    expect(() => buildPublishedEvidenceMembershipManifest(f)).toThrow()
    body.sections[0].contextBindings.references[0].sourceType = 'DISCOVERY'
    expect(() => assertPublishedEvidenceMembershipManifest(body)).toThrow()
  })
})

describe('published disposition payload and exact policy identity', () => {
  const body = () => ({ requestKey: '123e4567-e89b-42d3-a456-426614174000', expectedBasisHash: 'a'.repeat(64),
    expectedUpdatedAt: '2026-10-15T12:00:00.000Z', rationale: 'Explicit bounded synthetic disposition.', confirm: true })
  test('new explicit payload accepted while regular ReviewCompletion contract remains distinct', () => {
    expect(publishedDispositionBodySchema.safeParse(body()).success).toBe(true)
    expect(reviewCompletionBodySchema.safeParse(body()).success).toBe(false)
    expect(reviewCompletionBodySchema.safeParse({ requestKey: body().requestKey, expectedPopulationHash: 'a'.repeat(64), rationale: body().rationale, confirm: true }).success).toBe(true)
  })
  test.each(['actorUserId', 'customerId', 'authority', 'approvalReference', 'manifest', 'force'])('rejects caller override %s', name => {
    expect(publishedDispositionBodySchema.safeParse({ ...body(), [name]: 'caller-controlled' }).success).toBe(false)
  })
  test.each([{ confirm: false }, { expectedBasisHash: 'bad' }, { expectedUpdatedAt: 'yesterday' }, { rationale: 'tiny' }])('rejects incomplete explicit decision %j', invalid => {
    expect(publishedDispositionBodySchema.safeParse({ ...body(), ...invalid }).success).toBe(false)
  })
  test('identity selector is exact ID AND key, not a general recovery capability', () => {
    const runtime = { _id: policy.scope.runtimeInstanceId, runtimeInstanceKey: policy.scope.runtimeInstanceKey }
    expect(isPublishedDispositionRecoveryRuntime(runtime)).toBe(true)
    expect(isPublishedDispositionRecoveryRuntime({ ...runtime, _id: '000000000000000000000001' })).toBe(false)
    expect(isPublishedDispositionRecoveryRuntime({ ...runtime, runtimeInstanceKey: 'another-runtime' })).toBe(false)
  })
  test('only allowed receipt metadata is excluded from runtime control witness', () => {
    const runtime = fixture().runtime, before = publishedRuntimeWitnessHash(runtime)
    expect(publishedRuntimeWitnessHash({ ...runtime, updatedBy: 'other', updatedAt: new Date() })).toBe(before)
    expect(publishedRuntimeWitnessHash({ ...runtime, stateVersion: 'different' })).not.toBe(before)
  })
  test.each(['__v', 'current'])('seals root %s without typed-row housekeeping exclusions', key => {
    const runtime = { ...fixture().runtime, [key]: 0 }, before = publishedRuntimeWitnessHash(runtime)
    expect(publishedRuntimeWitnessHash({ ...runtime, [key]: 1 })).not.toBe(before)
    const absent = { ...runtime }; delete absent[key]
    expect(publishedRuntimeWitnessHash(absent)).not.toBe(before)
  })
  test('pins both original control fields and permits only the recorded receipt fence on replay', () => {
    const original = { updatedAt: new Date(policy.updatedAt), updatedBy: new mongoose.Types.ObjectId(policy.originalUpdatedBy) }
    expect(() => assertPublishedDispositionControl(original, null)).not.toThrow()
    const actor = '000000000000000000000099', time = new Date(Date.parse(policy.updatedAt) + 1).toISOString()
    const record = { body: { committedUpdatedAt: time, reviewer: { userId: actor } } }
    expect(() => assertPublishedDispositionControl({ updatedAt: time, updatedBy: new mongoose.Types.ObjectId(actor) }, record)).not.toThrow()
    expect(() => assertPublishedDispositionControl(original, record)).toThrow('intervening')
    expect(() => assertPublishedDispositionControl({ ...original, updatedBy: actor }, null)).toThrow('intervening')
    expect(() => assertPublishedDispositionControl({ updatedAt: time, updatedBy: policy.originalUpdatedBy }, record)).toThrow('intervening')
  })
  test.each(['actor', 'time'])('rejects missing original control %s', field => {
    const runtime = { updatedAt: policy.updatedAt, updatedBy: policy.originalUpdatedBy }
    delete runtime[field === 'actor' ? 'updatedBy' : 'updatedAt']
    expect(() => assertPublishedDispositionControl(runtime, null)).toThrow('intervening')
  })
})

describe('supplemental receipt rejects mutation and invalid creation before storage', () => {
  test.each(['updateOne', 'deleteOne', 'findOneAndUpdate', 'replaceOne'])('rejects immutable %s without storage', async operation => {
    await expect(Receipt[operation]({}, operation === 'deleteOne' ? undefined : { bodyHash: 'a'.repeat(64) })).rejects.toThrow('immutable')
  })
  test('disabled validation cannot save an invalid new receipt', async () => {
    const storage = jest.spyOn(Receipt.collection, 'insertOne')
    await expect(new Receipt({ body: {}, bodyHash: 'a'.repeat(64) }).save({ validateBeforeSave: false })).rejects.toThrow()
    expect(storage).not.toHaveBeenCalled()
  })
  test('insertMany invalid body rejects before driver', async () => {
    const storage = jest.spyOn(Receipt.collection, 'insertMany')
    await expect(Receipt.insertMany([{ body: {}, bodyHash: 'a'.repeat(64) }])).rejects.toThrow()
    expect(storage).not.toHaveBeenCalled()
  })
  test('bulk cannot mutate or insert an invalid receipt', async () => {
    const storage = jest.spyOn(Receipt.collection, 'bulkWrite')
    await expect(Receipt.bulkWrite([{ updateOne: { filter: {}, update: { $set: { bodyHash: 'a'.repeat(64) } } } }])).rejects.toThrow('immutable')
    await expect(Receipt.bulkWrite([{ insertOne: { document: { body: {} } } }])).rejects.toThrow()
    expect(storage).not.toHaveBeenCalled()
  })
})

// Neutral in-memory admission transitions, not native review or quality PASS evidence.
const populationFixture = () => {
  const state = policy.stateVersion, actor = '6a6c763dcace7a21bd41efa9', at = '2026-10-16T12:00:00.000Z'
  const oid = n => new mongoose.Types.ObjectId(String(n).padStart(24, '0'))
  const common = { customerId: policy.scope.customerId, tenantId: policy.scope.tenantId,
    runtimeInstanceId: policy.scope.runtimeInstanceId, runtimeInstanceKey: policy.scope.runtimeInstanceKey,
    stateVersion: state, sourceStateVersion: state, current: true, sourceHash: 'sha256:' + 'a'.repeat(64) }
  const sources = Array.from({ length: 8 }, (_, i) => ({ ...common, _id: oid(i + 1), sourceId: 'source-' + i }))
  const evidence = Array.from({ length: 47 }, (_, i) => ({ ...common, _id: oid(i + 20), evidenceObjectId: 'e-' + i,
    sourceId: sources[i % 8].sourceId, extractedFact: 'Controlled fact ' + i, reviewStatus: 'ACCEPTED' }))
  const decisions = evidence.map(row => ({ ...row, acceptedBy: actor, acceptanceTimestamp: at }))
  const sections = Array.from({ length: 6 }, (_, i) => ({ ...common, _id: oid(i + 100), sectionKey: 'section-' + i }))
  const admissionAudits = policy.auditIds.map((id, i) => ({ _id: id, signatureVersion: 1, actorUserId: actor,
    action: 'RUNTIME_STATE_MUTATED', resourceType: 'RuntimeInstance', resourceId: policy.scope.runtimeInstanceId,
    scope: common, diff: i < 47 ? { runtimePath: 'framework_state.evidence_pack',
      previousValue: { evidenceObjects: [{ ...decisions[i], reviewStatus: 'PENDING' }] },
      nextValue: { evidenceObjects: [{ ...decisions[i] }] } } : {} }))
  const runtime = { _id: policy.scope.runtimeInstanceId, customerId: policy.scope.customerId, tenantId: policy.scope.tenantId,
    runtimeInstanceKey: policy.scope.runtimeInstanceKey, stateVersion: state, revision: { revisionNumber: 1 }, framework_state: {
      evidence_pack: { evidenceObjects: decisions, sourceRegistry: sources, evidenceReady: true,
        contradictionReviewEpoch: 'f42ea39c-d4c5-4dd4-955e-ae36930ae8cb', discoveryHealth: {
          contradictionCandidates: [{ contradictionId: 'contradiction_6099440b3c7c' }] } } } }
  const finding = { receiptId: '123e4567-e89b-42d3-a456-426614174000', bodyHash: 'c'.repeat(64), auditId: oid(999), auditSignatureVersion: 1,
    body: { committedUpdatedAt: at, reviewer: { userId: actor }, disposition: 'NOT_CONTRADICTORY',
      evidencePairHash: 'sha256:dc93bf02ecfb4f57d09835e32b52dad0b4b2ca9500dc95f373c7f568752456a8',
      authority: { receiptId: '223e4567-e89b-42d3-a456-426614174000', bodyHash: 'd'.repeat(64), version: 1,
        approvalReference: 'ss044-temporary-synthetic-product-authority.2026-10-16.v1',
        documentHash: 'f8db0fe0dec87691843987132ef3a4e449c64313e11e7755282e5d15742f71b8' } } }
  return { runtime, sources, evidence, sections, admissionAudits, finding }
}
describe('distinct supplemental population from actual admission transitions', () => {
  test('reconciles all decisions without pretending the missing ordinary history exists', () => {
    const f = populationFixture(), population = buildPublishedDispositionPopulation(f)
    expect(population.manifest.evidence).toHaveLength(47)
    expect(population.manifest.findingReview.disposition).toBe('NOT_CONTRADICTORY')
    expect(population.summary).toMatchObject({ complete: true, evidenceCount: 47, sectionCount: 6, sourceCount: 8 })
    expect(f.runtime.framework_state.evidence_pack).not.toHaveProperty('contradictionReviews')
    expect(assertPublishedDispositionPopulation(population)).toEqual(population)
  })
  test.each(['CONFIRMED', 'REOPENED'])('keeps %s findings blocking', disposition => {
    const f = populationFixture(); f.finding.body.disposition = disposition
    expect(() => buildPublishedDispositionPopulation(f)).toThrow()
  })
  test.each(['actor', 'time', 'fact', 'missing', 'duplicate', 'scope', 'stale', 'history'])('rejects %s provenance without inventing review', kind => {
    const f = populationFixture()
    if (kind === 'actor') f.admissionAudits[0].actorUserId = '000000000000000000000099'
    if (kind === 'time') f.runtime.framework_state.evidence_pack.evidenceObjects[0].acceptanceTimestamp = '2026-10-16T12:00:01Z'
    if (kind === 'fact') f.evidence[0].extractedFact = 'Not the admitted fact'
    if (kind === 'missing') f.admissionAudits[0].diff = {}
    if (kind === 'duplicate') f.admissionAudits[47] = { ...f.admissionAudits[47], diff: f.admissionAudits[0].diff }
    if (kind === 'scope') f.runtime.customerId = '000000000000000000000099'
    if (kind === 'stale') f.evidence[0].stateVersion = 'different'
    if (kind === 'history') f.runtime.framework_state.evidence_pack.contradictionReviews = []
    expect(() => buildPublishedDispositionPopulation(f)).toThrow()
  })
  test('rejects rehashed population with non-NOT finding or duplicate admission IDs', () => {
    const population = buildPublishedDispositionPopulation(populationFixture())
    population.manifest.findingReview.disposition = 'CONFIRMED'; population.populationHash = membershipHash(population.manifest)
    expect(() => assertPublishedDispositionPopulation(population)).toThrow()
  })
})
