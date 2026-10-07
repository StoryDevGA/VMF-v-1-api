import { beforeAll, afterAll, test, expect } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import RuntimeInstance from '../models/RuntimeInstance.js'
import { RUNTIME_INSTANCE_RENDERER_PROJECTION } from '../services/runtimeInstanceService.js'
import { buildDiscoveryProjection } from '../services/runtimeRendererService.js'

let mongo
beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  const uri = mongo.getUri('ss042_acquisition_renderer_projection')
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Isolated loopback Mongo required')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  await RuntimeInstance.createCollection()
}, 120000)
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop() })

test('actual bounded Mongo renderer select delivers mixed/zero document outcomes and excludes unsafe receipt payload', async () => {
  const ids = Object.fromEntries(['_id', 'customerId', 'tenantId'].map(key => [key, new mongoose.Types.ObjectId()]))
  const key = 'ss042-isolated-acquisition-projection'
  const items = [
    { inputIndex: 0, status: 'SUCCEEDED', evidenceObjectCount: 2 },
    { inputIndex: 1, status: 'FAILED' },
    { inputIndex: 2, status: 'SUCCEEDED', evidenceObjectCount: 0 },
  ]
  const websiteAcquisition = { status: 'PARTIAL', sourceCount: 2, acquiredSourceCount: 1, failedSourceCount: 1,
    latestAttempt: { contractVersion: 'website-acquisition-outcomes.v1', items: [
      { inputIndex: 0, sourceId: 'website-current', status: 'SUCCEEDED', evidenceObjectCount: 2, retainedPrior: false },
      { inputIndex: 1, sourceId: 'website-prior', status: 'FAILED', evidenceObjectCount: 0, retainedPrior: true,
        retainedEvidenceObjectCount: 4, reason: 'WEBSITE_ACQUISITION_FAILED' },
    ] } }
  await RuntimeInstance.collection.insertOne({ ...ids, runtimeInstanceKey: key, framework_state: { evidence_pack: {
    inputs: { companyName: 'Synthetic controlled fixture' },
    acquisition: { profile: 'STANDARD', status: 'EVIDENCE_READY', sourceRegistry: [{ sourceId: 'EXCLUDED_SOURCE' }],
      websiteAcquisition: { ...websiteAcquisition, rawError: 'EXCLUDED_ERROR', latestAttempt: { ...websiteAcquisition.latestAttempt,
        items: websiteAcquisition.latestAttempt.items.map(item => ({ ...item, html: 'EXCLUDED_HTML', url: 'EXCLUDED_URL', valueHash: 'EXCLUDED_HASH', rawError: 'EXCLUDED_ERROR' })) } },
      documentAcquisition: { latestAttempt: { contractVersion: 'document-extraction-outcomes.v1',
        items: items.map(item => ({ ...item, contentBase64: 'EXCLUDED_CONTENT', documentHash: 'EXCLUDED_HASH',
          evidenceObjectIds: ['EXCLUDED_ID'], reason: 'EXCLUDED_REASON', message: 'EXCLUDED_MESSAGE' })) } } },
    evidenceObjects: [{ extractedFact: 'EXCLUDED_FACT' }],
  } } })
  const stored = await RuntimeInstance.findOne({ ...ids, runtimeInstanceKey: key })
    .select(RUNTIME_INSTANCE_RENDERER_PROJECTION).maxTimeMS(2000).lean()
  const discovery = buildDiscoveryProjection(stored.framework_state, { includeInputValues: true })
  expect(discovery.acquisition.websiteAcquisition).toEqual(websiteAcquisition)
  expect(discovery.acquisition.documentAcquisition.latestAttempt).toEqual({ contractVersion: 'document-extraction-outcomes.v1', items })
  expect(discovery.acquisition.status).toBe('EVIDENCE_READY')
  expect(JSON.stringify({ stored, discovery })).not.toMatch(/EXCLUDED_|contentBase64|documentHash|evidenceObjectIds|rawError/)
})
