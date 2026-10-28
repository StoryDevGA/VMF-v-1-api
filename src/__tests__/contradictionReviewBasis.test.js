import { test, expect, jest, afterEach, describe } from '@jest/globals'
import { readFileSync } from 'node:fs'
import mongoose from 'mongoose'
import Runtime from '../models/RuntimeInstance.js'
import { reconcileContradictionReviewBasis as reconcile, readContradictionReviewBasis as read } from '../services/contradictionReviewBasis.js'
import { getDiscoveryContradictionReview as inspect } from '../services/discoveryContradictionReviewService.js'
import { projectStoredFindings } from '../services/intelligenceFindingRead.js'
import { buildDraftSectionLedger } from '../services/outcomeEvidenceToDraftContractService.js'
const fixture = () => {
  const control = { id: '1'.repeat(24), customerId: '2'.repeat(24), tenantId: '3'.repeat(24), runtimeInstanceKey: 'synthetic',
    stateVersion: 'rsv2:11111111-1111-4111-8111-111111111111', updatedAt: '2026-10-20T12:34:32.490Z' }
  const candidates = [{ contradictionId: 'finding', domain: 'Scope', severity: 'LOW', basis: 'Stored detection', evidenceObjectIds: ['a', 'b'] }]
  const originals = ['a', 'b'].map(id => ({ evidenceObjectId: id, sourceId: 'source-' + id, sourceType: '',
    lineageRef: 'lineage-' + id, extractedFact: id === 'a' ? 'Considering a synthetic trial.' : 'This does not authorise execution.',
    reviewStatus: 'ACCEPTED', validationStatus: 'VALIDATED' }))
  const rows = originals.map(e => ({ ...e, sourceType: 'UPLOADED_DOCUMENT', runtimeInstanceId: control.id, customerId: control.customerId,
    tenantId: control.tenantId, runtimeInstanceKey: control.runtimeInstanceKey, stateVersion: control.stateVersion,
    sourceStateVersion: control.stateVersion, current: true, sourceHash: 'sha256:' + 'a'.repeat(64), migrationReceiptId: '4'.repeat(24) }))
  const review = { contractVersion: 'discovery-contradiction-review-v1', reviewId: '11111111-1111-4111-8111-111111111111',
    contradictionId: 'finding', runtimeInstanceId: control.id, reviewedStateVersion: control.stateVersion,
    reviewedBy: '5'.repeat(24), reviewedAt: '2026-10-20T12:34:29.499Z', disposition: 'NOT_CONTRADICTORY',
    rationale: 'Both synthetic limitations are compatible.', reviewEpoch: '', evidencePairHash: inspect(candidates[0], originals, [], control.id, '').evidencePairHash }
  const reviews = [review]
  const basis = { version: 1, scope: { runtimeInstanceId: control.id, runtimeInstanceKey: control.runtimeInstanceKey,
    customerId: control.customerId, tenantId: control.tenantId, stateVersion: control.stateVersion }, updatedAt: control.updatedAt,
    candidates: JSON.parse(JSON.stringify(candidates)), reviews: JSON.parse(JSON.stringify(reviews)), reviewEpoch: '', evidence: originals,
    sources: originals.map(e => ({ sourceId: e.sourceId, sourceType: 'UPLOADED_DOCUMENT' })) }
  return { control, candidates, reviews, reviewEpoch: '', evidenceRows: rows, basis }
}
afterEach(() => jest.restoreAllMocks())
test('reproduces the old typed mismatch and recognises the exact original hash without changing inputs', () => {
  const f = fixture(), before = JSON.stringify(f)
  expect(inspect(f.candidates[0], f.evidenceRows, f.reviews, f.control.id, '').reviewStatus).toBe('STALE')
  const canonical = reconcile(f)
  expect(inspect(f.candidates[0], canonical, f.reviews, f.control.id, '')).toMatchObject({ reviewStatus: 'NOT_CONTRADICTORY', evidencePairHash: f.reviews[0].evidencePairHash })
  expect(JSON.stringify(f)).toBe(before)
})
test('findings retain registered display types while hashing the verified original basis', () => {
  const f = fixture()
  const result = projectStoredFindings({ control: f.control, stored: { candidates: f.candidates, reviews: f.reviews, reviewEpoch: '' },
    evidenceRows: f.evidenceRows, reviewBasis: f.basis, selection: { type: 'CONTRADICTION', population: 'RECORDED', sort: 'ID_ASC', page: 1, pageSize: 4, search: '' } })
  expect(result.records[0]).toMatchObject({ reviewStatus: 'NOT_CONTRADICTORY', evidencePairHash: f.reviews[0].evidencePairHash,
    evidence: [{ sourceType: 'UPLOADED_DOCUMENT' }, { sourceType: 'UPLOADED_DOCUMENT' }] })
})
test.each(['scope', 'state', 'timestamp', 'candidate', 'history', 'epoch', 'duplicateRoot', 'missingTyped', 'duplicateSource',
  'missingSource', 'typedType', 'rootType', 'statement', 'lineage', 'validation', 'sourceLink', 'rejectedMismatch', 'notCurrent', 'wrongTypedScope', 'wrongTypedState', 'oversize'])('fails closed on %s', kind => {
  const f = fixture()
  if (kind === 'scope') f.basis.scope.customerId = 'f'.repeat(24)
  if (kind === 'state') f.basis.scope.stateVersion += 'changed'
  if (kind === 'timestamp') f.basis.updatedAt = '2026-10-20T00:00:00Z'
  if (kind === 'candidate') f.basis.candidates[0].domain = 'changed'
  if (kind === 'history') f.basis.reviews = []
  if (kind === 'epoch') f.basis.reviewEpoch = 'changed'
  if (kind === 'duplicateRoot') f.basis.evidence[1] = f.basis.evidence[0]
  if (kind === 'missingTyped') f.evidenceRows.pop()
  if (kind === 'duplicateSource') f.basis.sources[1] = f.basis.sources[0]
  if (kind === 'missingSource') f.basis.sources.pop()
  if (kind === 'typedType') f.evidenceRows[0].sourceType = 'WEBSITE'
  if (kind === 'rootType') f.basis.evidence[0].sourceType = 'WEBSITE'
  if (kind === 'statement') f.evidenceRows[0].extractedFact = 'Execution approved'
  if (kind === 'lineage') f.evidenceRows[0].lineageRef = 'changed'
  if (kind === 'validation') f.evidenceRows[0].validationStatus = 'changed'
  if (kind === 'sourceLink') f.evidenceRows[0].sourceId = 'changed'
  if (kind === 'rejectedMismatch') f.evidenceRows[0].reviewStatus = 'REJECTED'
  if (kind === 'notCurrent') f.evidenceRows[0].current = false
  if (kind === 'wrongTypedScope') f.evidenceRows[0].tenantId = 'f'.repeat(24)
  if (kind === 'wrongTypedState') f.evidenceRows[0].sourceStateVersion += 'changed'
  if (kind === 'oversize') f.basis.extra = 'x'.repeat(512 * 1024)
  expect(() => reconcile(f)).toThrow()
})
test.each(['extractedFact', 'sourceId', 'lineageRef', 'validationStatus', 'sourceType'])('a real matching change to %s still makes the saved review stale', field => {
  const f = fixture()
  const value = field === 'sourceType' ? 'WEBSITE' : 'changed'
  f.basis.evidence[0][field] = value; f.evidenceRows[0][field] = value
  if (field === 'sourceType') f.basis.sources[0].sourceType = value
  if (field === 'sourceId') f.basis.sources[0].sourceId = value
  expect(inspect(f.candidates[0], reconcile(f), f.reviews, f.control.id, '').reviewStatus).toBe('STALE')
})
test('exact aggregate scope, current witness, session and budget are forwarded; no full evidence read', async () => {
  const f = fixture(), session = {}, budget = jest.fn(() => ({ maxTimeMS: 321, timeoutMS: 321 }))
  const option = jest.fn().mockResolvedValue([f.basis]), withSession = jest.fn(() => ({ option }))
  const aggregate = jest.spyOn(Runtime, 'aggregate').mockReturnValue({ session: withSession })
  expect(await read({ ...f, session, readBudget: budget })).toEqual(f.basis)
  expect(withSession).toHaveBeenCalledWith(session); expect(option).toHaveBeenCalledWith({ maxTimeMS: 321, timeoutMS: 321 })
  const pipeline = aggregate.mock.calls[0][0]
  expect(pipeline[0].$match).toMatchObject({ _id: new mongoose.Types.ObjectId(f.control.id), customerId: new mongoose.Types.ObjectId(f.control.customerId),
    tenantId: new mongoose.Types.ObjectId(f.control.tenantId), runtimeInstanceKey: f.control.runtimeInstanceKey, stateVersion: f.control.stateVersion,
    updatedAt: new Date(f.control.updatedAt) })
  expect(pipeline[2].$project.evidence.$map.input.$slice[1]).toBe(17)
  expect(pipeline[2].$project.reviews.$cond[1].$slice[1]).toBe(1001)
})
test('rejected or missing native projection cannot become a successful empty basis', async () => {
  const f = fixture(), option = jest.fn().mockRejectedValue(new Error('Native read failed'))
  jest.spyOn(Runtime, 'aggregate').mockReturnValue({ session: () => ({ option }) })
  await expect(read(f)).rejects.toThrow('Native read failed')
  option.mockResolvedValue([]); await expect(read(f)).rejects.toThrow()
})
test('no detections issue no extra root metadata query', async () => {
  const aggregate = jest.spyOn(Runtime, 'aggregate')
  expect(await read({ candidates: [] })).toBeNull(); expect(aggregate).not.toHaveBeenCalled()
})
test.each(['sourceType', 'sourceId', 'current', 'stateVersion', 'tenantId', 'duplicate', 'missing'])('downstream snapshot rejects changed typed source %s', kind => {
  const f = fixture()
  const sources = f.basis.sources.map(s => ({ ...f.evidenceRows[0], ...s }))
  const input = { sourceSnapshot: { evidenceObjects: f.evidenceRows, sourceRegistry: sources,
    contradictionReviewBasis: f.basis, discoveryHealth: { contradictionCandidates: f.candidates },
    contradictionReviews: f.reviews, contradictionReviewEpoch: '',
    inventoryReceipt: { scope: f.basis.scope, sectionCoverage: [] } }, composition: { businessFactLedger: { omitted: [] } } }
  expect(buildDraftSectionLedger({ input, claims: [], all: [], deficitsFor: () => [] })).toEqual([])
  if (kind === 'sourceType') sources[0].sourceType = 'WEBSITE'
  if (kind === 'sourceId') sources[0].sourceId = 'changed'
  if (kind === 'current') sources[0].current = false
  if (kind === 'stateVersion') sources[0].stateVersion = 'changed'
  if (kind === 'tenantId') sources[0].tenantId = 'changed'
  if (kind === 'duplicate') sources[1] = sources[0]
  if (kind === 'missing') sources.pop()
  expect(() => buildDraftSectionLedger({ input, claims: [], all: [], deficitsFor: () => [] })).toThrow()
})
const cached = process.env.VMF_R3_HASH_CACHE ? describe : describe.skip
cached('actual delegated R3 cached counterexample', () => {
  test('recognises the existing own R3 review and preserves original root/typed records', () => {
    const c = mongoose.mongo.BSON.EJSON.parse(readFileSync(process.env.VMF_R3_HASH_CACHE, 'utf8'), { relaxed: true })
    const r = c.roots.find(x => String(x._id) === '6ad715c91f39fea112115875'), pack = r.framework_state.evidence_pack
    const candidates = pack.discoveryHealth.contradictionCandidates, ids = candidates.flatMap(x => x.evidenceObjectIds)
    const control = { ...r, id: String(r._id) }, evidenceRows = c.typed.r3.evidence.filter(x => ids.includes(x.evidenceObjectId))
    const scope = { runtimeInstanceId: String(r._id), runtimeInstanceKey: r.runtimeInstanceKey,
      customerId: String(r.customerId), tenantId: String(r.tenantId), stateVersion: r.stateVersion }
    const basis = { version: 1, scope, updatedAt: r.updatedAt, candidates, reviews: pack.contradictionReviews,
      reviewEpoch: pack.contradictionReviewEpoch, evidence: pack.evidenceObjects.filter(x => ids.includes(x.evidenceObjectId)),
      sources: pack.sourceRegistry.filter(s => evidenceRows.some(e => e.sourceId === s.sourceId)).map(s => ({ sourceId: s.sourceId, sourceType: s.sourceType })) }
    const f = { control, candidates, evidenceRows, reviews: pack.contradictionReviews, reviewEpoch: pack.contradictionReviewEpoch, basis }, before = JSON.stringify(c)
    expect(inspect(candidates[0], evidenceRows, f.reviews, control.id, f.reviewEpoch).reviewStatus).toBe('STALE')
    expect(inspect(candidates[0], reconcile(f), f.reviews, control.id, f.reviewEpoch)).toMatchObject({
      reviewStatus: 'NOT_CONTRADICTORY', evidencePairHash: 'sha256:433db4bbdfb61df8b936b7c2cbcecd9dac5095ac88a84f37b80b29305ccff8da',
      latestReview: { reviewId: 'b2404a75-e3c0-45a5-9a4f-5c7c22136a98' } })
    expect(JSON.stringify(c)).toBe(before)
  })
})
