import { test, expect } from '@jest/globals'
import { createHash, randomUUID } from 'node:crypto'
import { ingestUploadedDocumentDiscoveryEvidence, buildDiscoverySourceRegistry } from '../services/discoveryIntelligenceService.js'
import { bindAcquisitionSourceProcessing } from '../services/acquisitionRunService.js'

const make = async (textContent = 'abc') => {
  const hash = createHash('sha256').update(textContent).digest('hex')
  const result = await ingestUploadedDocumentDiscoveryEvidence({ documentSources: [{ fileName: 'short.txt', textContent }],
    acquisitionProfile: 'STANDARD', capturedAt: '2026-10-06T10:00:00.000Z', batchOutcomes: true })
  const context = { runId: randomUUID(), row: { acquisitionProfile: 'STANDARD', inputs: [
    { kind: 'BRIEF', inputIndex: 0, contentHash: 'a'.repeat(64) },
    { kind: 'DOCUMENT', inputIndex: 0, contentHash: hash },
  ] } }
  const pack = { inputComplete: true, evidenceObjects: result.evidenceObjects, sourceRegistry: result.sourceRegistry,
    lineage: { sources: result.sources }, acquisition: { documentAcquisition: { latestAttempt: { items: result.itemOutcomes } } } }
  return { context, pack, hash }
}

test('actual zero-object TXT extraction binds exact Run/input/hash and survives registry normalization', async () => {
  const { context, pack, hash } = await make()
  expect(pack.evidenceObjects).toHaveLength(0)
  bindAcquisitionSourceProcessing(context, pack)
  const receipt = { contractVersion: 'document-processing-receipt.v1', runId: context.runId, inputIndex: 0, contentHash: `sha256:${hash}` }
  expect(pack.sourceRegistry[0]).toMatchObject({ contentHash: `sha256:${hash}`, processingReceipt: receipt })
  expect(buildDiscoverySourceRegistry({ sourceRegistry: pack.sourceRegistry })[0]).toMatchObject({ processingReceipt: receipt })
})

test.each(['duplicate', 'missing', 'kind', 'hash'])('rejects %s registry binding before stamping any source', async mode => {
  const { context, pack } = await make()
  if (mode === 'duplicate') pack.sourceRegistry.push(structuredClone(pack.sourceRegistry[0]))
  if (mode === 'missing') pack.sourceRegistry = []
  if (mode === 'kind') pack.sourceRegistry[0].sourceType = 'WEBSITE'
  if (mode === 'hash') pack.sourceRegistry[0].documentHash = `sha256:${'f'.repeat(64)}`
  expect(() => bindAcquisitionSourceProcessing(context, pack)).toThrow('registry does not match')
  expect(pack.sourceRegistry.every(source => source.processingReceipt === undefined)).toBe(true)
})

test('failed unchanged retry retains the prior recorded success pointer without stamping a new one', async () => {
  const { context, pack } = await make()
  bindAcquisitionSourceProcessing(context, pack)
  const receipt = structuredClone(pack.sourceRegistry[0].processingReceipt)
  const retry = { ...context, runId: randomUUID() }
  pack.acquisition.documentAcquisition.latestAttempt.items = [{ inputIndex: 0, status: 'FAILED', evidenceObjectCount: 0 }]
  bindAcquisitionSourceProcessing(retry, pack)
  expect(pack.sourceRegistry[0].processingReceipt).toEqual(receipt)
})
