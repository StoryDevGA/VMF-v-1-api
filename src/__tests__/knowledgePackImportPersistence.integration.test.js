import { beforeAll, afterAll, test, expect, jest } from '@jest/globals'
import mongoose from 'mongoose'
import { KnowledgePack, KnowledgePackVersion, KnowledgePackActivation } from '../models/index.js'
import AuditLog from '../models/AuditLog.js'
import { importOutcomeKnowledgePackSourceDocumentDraft as importDraft } from '../services/outcomeKnowledgePackRegistryService.js'

const uri = process.env.SS003_TEST_MONGODB_URI
const integration = uri ? test : test.skip
let actor, sequence = 0
beforeAll(async () => {
  if (!uri) return
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/ss003_import_\d+\?replicaSet=ss003_import$/.test(uri)) throw new Error('Fresh synthetic loopback database required')
  if (uri !== `mongodb://127.0.0.1:${process.env.SS003_TEST_PORT}/${process.env.SS003_TEST_DATABASE}?replicaSet=ss003_import`) throw new Error('Generated database identity must match exactly')
  await mongoose.connect(uri)
  expect(mongoose.connection.client.topology.description.type).toBe('ReplicaSetWithPrimary')
  await Promise.all([KnowledgePack.init(), KnowledgePackVersion.init(), KnowledgePackActivation.init(), AuditLog.init()])
  actor = new mongoose.Types.ObjectId()
})
afterAll(async () => { if (uri) { jest.restoreAllMocks(); await mongoose.disconnect() } })
const fixture = () => {
  const id = ++sequence
  const metadata = { label: `Synthetic SS003 ${id}`, knowledgeAssetId: `SS003-PERSIST-${id}`, capabilityKey: `ss003-persist-${id}`,
    packType: 'SYSTEM', purposeCategory: 'GOVERNANCE', knowledgeLayer: 'SYSTEM', executionMode: 'SYSTEM_ONLY',
    visibility: 'PLATFORM', workspaceCompatibility: ['OUTCOME'], runtimeConsumers: ['Outcome Studio', 'Runtime Control'], description: `Source description ${id}` }
  const text = `---\nname: ${metadata.label}\nknowledge_asset_id: ${metadata.knowledgeAssetId}\ncapability_key: ${metadata.capabilityKey}\ndraft_pack_type: SYSTEM\npurpose_category: GOVERNANCE\nknowledge_layer: SYSTEM\nexecution_mode: SYSTEM_ONLY\nvisibility: PLATFORM\nworkspace_compatibility: [OUTCOME]\nruntime_consumers: [Outcome Studio, Runtime Control]\ndescription: ${metadata.description}\n---\n# Synthetic ${id}\nRetain this exact source.`
  return { metadata, body: { packKey: `ss003-persist-${id}`, semanticVersion: '1.0.0', contentFormat: 'MARKDOWN', extractedText: text,
    sourceDocument: { filename: `ss003-${id}.md`, mimeType: 'text/markdown' } } }
}
const counts = async () => Promise.all([KnowledgePack.countDocuments(), KnowledgePackVersion.countDocuments(), AuditLog.countDocuments(), KnowledgePackActivation.countDocuments()])
integration('real import preserves all eleven source/effective metadata values and exact source, remaining draft without activation', async () => {
  const { metadata, body } = fixture()
  const result = await importDraft({ body, actorUserId: actor })
  const pack = await KnowledgePack.findOne({ packId: result.pack.packId }).lean()
  const version = await KnowledgePackVersion.findOne({ versionId: result.version.versionId }).select('+content').lean()
  expect(version.sourceMetadata.importMetadata).toEqual({ source: metadata, effective: metadata, overrides: [] })
  expect(version.content).toBe(body.extractedText)
  expect(pack).toMatchObject({ label: metadata.label, description: metadata.description, knowledgeAssetId: metadata.knowledgeAssetId, capabilityKey: metadata.capabilityKey, knowledgeLayer: 'SYSTEM', workspaceCompatibility: ['OUTCOME'] })
  expect(pack.boundary).toBeUndefined()
  expect(version.boundary).toBeUndefined()
  expect(version).toMatchObject({ status: 'DRAFT', reviewStatus: 'DRAFT', executionMode: 'SYSTEM_ONLY', visibility: 'PLATFORM', validationSummary: { status: 'NOT_RUN' } })
  expect(await KnowledgePackActivation.countDocuments()).toBe(0)
  expect(await AuditLog.countDocuments({ action: 'OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED' })).toBe(1)
})
integration('validated overrides persist while keeping the original declaration and source unchanged, including cleared description', async () => {
  const { metadata, body } = fixture()
  const overrides = { label: 'Manually corrected label', description: '', runtimeConsumers: [] }
  const result = await importDraft({ actorUserId: actor, body: { ...body, ...overrides, metadataOverrides: Object.keys(overrides) } })
  const pack = await KnowledgePack.findOne({ packId: result.pack.packId }).lean()
  const version = await KnowledgePackVersion.findOne({ versionId: result.version.versionId }).select('+content').lean()
  expect(pack).toMatchObject({ label: overrides.label, description: '' })
  expect(version.content).toBe(body.extractedText)
  expect(version.sourceMetadata.importMetadata).toEqual({ source: metadata, effective: { ...metadata, ...overrides }, overrides: Object.keys(overrides) })
})
integration('an explicitly supplied supported boundary is retained by the pack and version', async () => {
  const { body } = fixture()
  const result = await importDraft({ body: { ...body, boundary: 'GENERATION_CONTEXT' }, actorUserId: actor })
  expect((await KnowledgePack.findOne({ packId: result.pack.packId }).lean()).boundary).toBe('GENERATION_CONTEXT')
  expect((await KnowledgePackVersion.findOne({ versionId: result.version.versionId }).lean()).boundary).toBe('GENERATION_CONTEXT')
})
integration.each(['missing', 'malformed', 'conflicting', 'identity-override'])('%s metadata rejects before any collection writes', async (scenario) => {
  const { body } = fixture()
  if (scenario === 'missing') body.extractedText = '# No required metadata'
  if (scenario === 'malformed') body.extractedText = '---\nname: [broken\n---\nSource'
  if (scenario === 'conflicting') body.label = 'Unacknowledged override'
  if (scenario === 'identity-override') Object.assign(body, { knowledgeAssetId: 'SS003-DIFFERENT', metadataOverrides: ['knowledgeAssetId'] })
  const before = await counts()
  await expect(importDraft({ body, actorUserId: actor })).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' })
  expect(await counts()).toEqual(before)
})
integration('audit failure after a real transactional audit insert rolls back pack, version and audit together', async () => {
  const { body } = fixture()
  const before = await counts()
  const original = AuditLog.createLog
  let auditInsertVerified = false
  const failure = jest.spyOn(AuditLog, 'createLog').mockImplementationOnce(async function (...args) {
    expect(args[1].session.inTransaction()).toBe(true)
    const inserted = await original.apply(this, args)
    expect(await AuditLog.countDocuments({ _id: inserted._id }).session(args[1].session)).toBe(1)
    auditInsertVerified = true
    throw new Error('SS003 injected audit failure after insertion')
  })
  try { await expect(importDraft({ body, actorUserId: actor })).rejects.toMatchObject({ status: 500, code: 'OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED' }) } finally { failure.mockRestore() }
  expect(auditInsertVerified).toBe(true)
  expect(await counts()).toEqual(before)
})
integration('concurrent identical imports yield one durable draft and one conflict; later duplicate is also rejected', async () => {
  const { body } = fixture()
  const before = await counts()
  const results = await Promise.allSettled([importDraft({ body, actorUserId: actor }), importDraft({ body, actorUserId: actor })])
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((row) => row.status === 'rejected').reason).toMatchObject({ status: 409, code: 'CONFLICT' })
  expect(await counts()).toEqual([before[0] + 1, before[1] + 1, before[2] + 1, before[3]])
  await expect(importDraft({ body, actorUserId: actor })).rejects.toMatchObject({ status: 409, code: 'CONFLICT', details: { reason: 'PACK_VERSION_ALREADY_EXISTS' } })
})
