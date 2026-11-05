import { makeSimulatedOwnedReview } from './fixtures/renditionReviewResultFixture.js'
import { docxVisualReviewFixture, visualReviewOutput } from './fixtures/docxVisualReviewFixture.js'
import { snapshotOwnedDocxReviewResult } from '../services/openAiDocxRenditionReviewProviderAdapter.js'


describe('completed result ownership is adapter origin, not genuine-provider proof', () => {
  test('returns a defensive snapshot with adapter-captured times; copies never recreate ownership', async () => {
    const result = await makeSimulatedOwnedReview(await docxVisualReviewFixture().transport())
    const snapshot = snapshotOwnedDocxReviewResult(result)
    expect(snapshot.startedAt).toBe('2026-10-28T19:10:00.000Z')
    expect(snapshot.completedAt).toBe('2026-10-28T19:10:00.012Z')
    snapshot.output.findings[0].finding = 'Changed defensive copy'
    expect(snapshotOwnedDocxReviewResult(result).output.findings[0].finding).not.toBe('Changed defensive copy')
    expect(() => snapshotOwnedDocxReviewResult(JSON.parse(JSON.stringify(result)))).toThrow()
    expect(() => snapshotOwnedDocxReviewResult({ output: visualReviewOutput(), receipt: {} })).toThrow()
  })
  test.each([
    ['finding', result => { result.output.findings[0].finding = 'Altered finding' }],
    ['response', result => { result.receipt.responseId = 'resp_other' }],
    ['page', result => { result.receipt.pages[0].sha256 = 'f'.repeat(64) }],
    ['metadata', result => { result.receipt.updatedAt = 'ignored-by-other-hash' }],
    ['root metadata', result => { result.updatedAt = 'also-not-ignored' }],
  ])('rejects mutated %s without trusting caller hashes', async (_name, mutate) => {
    const result = await makeSimulatedOwnedReview(await docxVisualReviewFixture().transport())
    mutate(result); expect(() => snapshotOwnedDocxReviewResult(result)).toThrow()
  })
})
