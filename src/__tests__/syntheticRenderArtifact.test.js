import { describe, test, expect, jest, afterEach } from '@jest/globals'
import { deriveSyntheticRenderClassification, assertSyntheticRenderClassification, assertSyntheticRenderDeliveryHeld,
  assertNoSyntheticRenderRecordInsertion } from '../services/syntheticRenderArtifactContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import RenderOutput from '../models/OutcomeRenderOutput.js'

const root = '6ace5ee09bd4472c6be0cb07'
const model = () => ({ assetId: 'engineering-asset', assetVersionId: 'engineering-version', versionNumber: 1,
  runtimeInstanceId: root, runtimeRevision: { id: root, number: 1 },
  customerId: '6a6c75f2cace7a21bd41ef98', tenantId: '6a6c76e3cace7a21bd41eff9',
  sourceContentChecksum: 'sha256:' + 'a'.repeat(64) })
const classified = () => { const value = model(); return { ...value, artifactClassification: deriveSyntheticRenderClassification(value) } }
afterEach(() => jest.restoreAllMocks())
describe('derived synthetic render candidate classification', () => {
  test('binds exact native identity and unchanged original checksum deterministically without content', () => {
    const source = model(), before = JSON.stringify(source), result = deriveSyntheticRenderClassification(source)
    expect(result).toEqual(deriveSyntheticRenderClassification(source))
    expect(result.body).toMatchObject({ domain: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST_RENDER_CANDIDATE',
      runtimeInstanceId: root, assetId: source.assetId, assetVersionId: source.assetVersionId,
      originalSourceContentChecksum: source.sourceContentChecksum, officialUse: false, deliveryStatus: 'HELD' })
    expect(result.checksum).toBe(membershipHash(result.body))
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.body)).toBe(true)
    expect(result.body).not.toHaveProperty('customerContent')
    expect(JSON.stringify(source)).toBe(before)
    expect(() => { result.body.deliveryStatus = 'READY' }).toThrow()
  })
  test('valid classification remains held and never authorises delivery', () => {
    const value = classified()
    expect(assertSyntheticRenderClassification(value)).toEqual(value.artifactClassification)
    expect(() => assertSyntheticRenderDeliveryHeld(value)).toThrow(expect.objectContaining({ code: 'SYNTHETIC_TEST_DELIVERY_HELD' }))
  })
  test.each(['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeRevision', 'sourceContentChecksum', 'assetId', 'versionNumber'])('rejects changed native %s', field => {
    const value = model()
    const overrides = { customerId: 'foreign', tenantId: 'foreign', runtimeInstanceId: 'foreign',
      runtimeRevision: { id: root, number: 2 }, sourceContentChecksum: 'bad', assetId: '', versionNumber: 0 }
    value[field] = overrides[field]
    expect(() => deriveSyntheticRenderClassification(value)).toThrow(expect.objectContaining({ code: 'SYNTHETIC_ARTIFACT_BINDING_INVALID' }))
  })
  test.each(['rootRuntimeId', 'parentRuntimeId'])('rejects unsupported synthetic successor detected from native %s', field => {
    const value = { ...model(), runtimeInstanceId: 'descendant', runtimeRevision: { id: 'descendant', number: 2 } }
    expect(() => deriveSyntheticRenderClassification(value, { runtimeRevision: { [field]: root } })).toThrow()
  })
  test('a dropped envelope cannot turn known synthetic origin into ordinary', () => {
    expect(() => assertSyntheticRenderClassification(model())).toThrow(expect.objectContaining({ code: 'SYNTHETIC_ARTIFACT_CLASSIFICATION_INVALID' }))
  })
  test('runtime revision overrides cannot hide persisted synthetic aliases or ancestry', () => {
    const value = { ...model(), runtimeInstanceId: 'ordinary', runtimeRevision: { id: 'ordinary', number: 2 } }
    expect(() => deriveSyntheticRenderClassification(value, { source: { runtimeRevisionId: root },
      runtimeRevision: { id: 'ordinary', number: 2 } })).toThrow()
    expect(() => deriveSyntheticRenderClassification(value, { source: { runtimeRevision: { rootRuntimeId: root } },
      runtimeRevision: { id: 'ordinary', number: 2, rootRuntimeId: 'other-root' } })).toThrow()
  })
  test('synthetic origin cannot silently rebind a conflicting persisted revision', () => {
    expect(() => deriveSyntheticRenderClassification(model(), { source: { runtimeRevisionId: 'other-revision' } })).toThrow()
  })
  test.each(['id-first', 'revisionId-first'])('checks simultaneous nested aliases independently: %s', order => {
    const value = { ...model(), runtimeInstanceId: 'ordinary', runtimeRevision: { id: 'ordinary', number: 1 } }
    const aliases = order === 'id-first' ? { id: 'ordinary', revisionId: root } : { id: root, revisionId: 'ordinary' }
    expect(() => deriveSyntheticRenderClassification(value, { source: { runtimeRevision: aliases } })).toThrow()
    expect(() => deriveSyntheticRenderClassification(value, { runtimeRevision: aliases })).toThrow()
  })
  test.each(['rootRuntimeId', 'parentRuntimeId', 'revisionId'])('raw model cannot hide synthetic %s from the delivery guard', field => {
    const value = { ...model(), runtimeInstanceId: 'ordinary', runtimeRevision: { id: 'ordinary', number: 2, [field]: root } }
    expect(() => assertSyntheticRenderDeliveryHeld(value)).toThrow()
  })
  test.each(['assetId', 'originalSourceContentChecksum', 'deliveryStatus', 'amendmentHash'])('rejects rehashed changed classification %s against original source', field => {
    const value = classified(), body = { ...value.artifactClassification.body, [field]: 'changed' }
    value.artifactClassification = { body, checksum: membershipHash(body) }
    expect(() => assertSyntheticRenderClassification(value)).toThrow()
  })
  test('rejects moving a valid synthetic envelope onto ordinary native identity', () => {
    const value = classified(); value.runtimeInstanceId = 'ordinary'; value.runtimeRevision.id = 'ordinary'
    expect(() => assertSyntheticRenderClassification(value)).toThrow()
  })
  test('ordinary sources retain their existing model without an invented classification', () => {
    const value = { ...model(), runtimeInstanceId: 'ordinary', runtimeRevision: { id: 'ordinary', number: 1 } }
    expect(deriveSyntheticRenderClassification(value)).toBeNull()
    expect(assertSyntheticRenderClassification(value)).toBeNull()
    expect(() => assertSyntheticRenderDeliveryHeld(value)).not.toThrow()
  })
})
describe('supported render-record insertion holds before database access', () => {
  const record = () => ({ runtimeInstanceId: root, runtimeRevisionId: root, renderReceipt: {}, artifact: {} })
  test.each(['native', 'receipt-label', 'source-label', 'source-revision', 'source-conflicting-aliases', 'artifact-label', 'artifact-hash'])('rejects %s metadata or origin', kind => {
    const value = kind === 'native' ? record() : { runtimeInstanceId: 'ordinary', runtimeRevisionId: 'ordinary', renderReceipt: { source: {} }, artifact: {} }
    if (kind === 'receipt-label') value.renderReceipt.artifactClassification = null
    if (kind === 'source-label') value.renderReceipt.source.artifactClassification = {}
    if (kind === 'source-revision') value.renderReceipt.source.runtimeRevision = { id: root, number: 1 }
    if (kind === 'source-conflicting-aliases') value.renderReceipt.source.runtimeRevision = { id: 'ordinary', revisionId: root }
    if (kind === 'artifact-label') value.artifact.artifactClassification = {}
    if (kind === 'artifact-hash') value.artifact.classificationChecksum = 'changed'
    expect(() => assertNoSyntheticRenderRecordInsertion(value)).toThrow(expect.objectContaining({ code: 'SYNTHETIC_TEST_DELIVERY_HELD' }))
  })
  test('ordinary unclassified legacy record remains structurally untouched', () => {
    const value = { runtimeInstanceId: 'ordinary', renderReceipt: {}, artifact: {} }, before = JSON.stringify(value)
    expect(() => assertNoSyntheticRenderRecordInsertion(value)).not.toThrow()
    expect(JSON.stringify(value)).toBe(before)
  })
  test('model validation blocks even when known-native label is absent', async () => {
    await expect(new RenderOutput(record()).validate()).rejects.toMatchObject({ code: 'SYNTHETIC_TEST_DELIVERY_HELD' })
  })
  test('save with validation disabled still blocks before insertOne', async () => {
    const insert = jest.spyOn(RenderOutput.collection, 'insertOne').mockRejectedValue(new Error('Unexpected database access'))
    await expect(new RenderOutput(record()).save({ validateBeforeSave: false })).rejects.toMatchObject({ code: 'SYNTHETIC_TEST_DELIVERY_HELD' })
    expect(insert).not.toHaveBeenCalled()
  })
  test.each([false, true])('insertMany lean=%s blocks before insertMany collection access', async lean => {
    const insert = jest.spyOn(RenderOutput.collection, 'insertMany').mockRejectedValue(new Error('Unexpected database access'))
    await expect(RenderOutput.insertMany([record()], { lean })).rejects.toMatchObject({ code: 'SYNTHETIC_TEST_DELIVERY_HELD' })
    expect(insert).not.toHaveBeenCalled()
  })
})
