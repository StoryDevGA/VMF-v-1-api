import { describe, test, expect } from '@jest/globals'
import { buildAcquisitionRunOutcomes } from '../services/acquisitionRunService.js'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'

const contentHash = 'a'.repeat(64)
const fixture = () => ({
  context: { runId: 'synthetic-run', row: { acquisitionProfile: 'STANDARD', inputs: [
    { kind: 'BRIEF', inputIndex: 0 }, { kind: 'DOCUMENT', inputIndex: 0, contentHash },
  ] } },
  pack: { inputComplete: true,
    evidenceObjects: [{ sourceId: 'document_a', evidenceObjectId: 'historical' }, { sourceId: 'document_a', evidenceObjectId: 'fresh' }],
    lineage: { sources: [{ sourceId: 'document_a', sourceType: 'UPLOADED_DOCUMENT', type: 'UPLOADED_DOCUMENT',
      documentStatus: 'PROCESSED', status: 'ACQUIRED', acquisitionProfile: 'STANDARD', evidenceProduced: 1,
      documentHash: `sha256:${contentHash}`, valueHash: `sha256:${contentHash}` }] },
    acquisition: { documentAcquisition: { latestAttempt: { items: [{ inputIndex: 0, status: 'SUCCEEDED',
      sourceId: 'document_a', documentHash: `sha256:${contentHash}`, evidenceObjectCount: 1, evidenceObjectIds: ['fresh'] }] } } },
  },
})

describe('native acquisition current-attempt membership', () => {
  test('counts only exact fresh document IDs while retaining historical material', () => {
    const { context, pack } = fixture(), before = structuredClone(pack)
    expect(buildAcquisitionRunOutcomes(context, pack)[1]).toMatchObject({ status: 'SUCCEEDED', evidenceObjectCount: 1, contentHash })
    expect(pack).toEqual(before)
  })
  test.each(['missing', 'duplicate', 'foreign', 'empty', 'not-array', 'count', 'global duplicate', 'lineage count', 'hash'])('rejects %s current-attempt identity mismatch', kind => {
    const { context, pack } = fixture(), item = pack.acquisition.documentAcquisition.latestAttempt.items[0]
    if (kind === 'missing') item.evidenceObjectIds = ['absent']
    if (kind === 'duplicate') { item.evidenceObjectIds = ['fresh', 'fresh']; item.evidenceObjectCount = 2; pack.lineage.sources[0].evidenceProduced = 2 }
    if (kind === 'foreign') pack.evidenceObjects[1].sourceId = 'document_other'
    if (kind === 'empty') item.evidenceObjectIds = ['']
    if (kind === 'not-array') delete item.evidenceObjectIds
    if (kind === 'count') item.evidenceObjectIds = []
    if (kind === 'global duplicate') pack.evidenceObjects.push({ sourceId: 'document_other', evidenceObjectId: 'fresh' })
    if (kind === 'lineage count') pack.lineage.sources[0].evidenceProduced = 2
    if (kind === 'hash') context.row.inputs[1].contentHash = 'b'.repeat(64)
    expect(() => buildAcquisitionRunOutcomes(context, pack)).toThrow('Actual acquisition outcomes do not match')
  })
  test('allows a valid zero-fact extraction alongside retained document evidence', () => {
    const { context, pack } = fixture(), item = pack.acquisition.documentAcquisition.latestAttempt.items[0]
    item.evidenceObjectIds = []; item.evidenceObjectCount = 0; pack.lineage.sources[0].evidenceProduced = 0
    expect(buildAcquisitionRunOutcomes(context, pack)[1]).toMatchObject({ status: 'SUCCEEDED', evidenceObjectCount: 0 })
  })
  test('retains the website whole-source count guard', () => {
    const { context, pack } = fixture(), source = pack.lineage.sources[0]
    source.sourceId = 'website_a'; source.sourceType = 'WEBSITE'; source.type = 'WEBSITE_ACQUISITION'
    source.adapter = 'website-html-fetch-v1'; source.url = 'https://synthetic.invalid'
    source.valueHash = `sha256:${snapshotHash(source.url)}`
    context.row.inputs[1] = { kind: 'WEBSITE', inputIndex: 0, contentHash: snapshotHash(source.url) }
    pack.evidenceObjects.forEach(row => { row.sourceId = source.sourceId })
    pack.acquisition = { websiteAcquisition: { latestAttempt: { items: [{ inputIndex: 0, sourceId: source.sourceId, status: 'SUCCEEDED', evidenceObjectCount: 1 }] } } }
    expect(() => buildAcquisitionRunOutcomes(context, pack)).toThrow('Actual acquisition outcomes do not match')
  })
})
