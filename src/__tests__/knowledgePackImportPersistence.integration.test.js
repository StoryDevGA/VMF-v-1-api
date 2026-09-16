import { beforeAll, afterAll, test, expect, jest } from '@jest/globals'
import mongoose from 'mongoose'
import { KnowledgePack, KnowledgePackVersion, KnowledgePackActivation } from '../models/index.js'
import AuditLog from '../models/AuditLog.js'
import { importOutcomeKnowledgePackSourceDocumentDraft as importDraft, resolveOutcomeStudioKnowledgePacks } from '../services/outcomeKnowledgePackRegistryService.js'

const uri = process.env.SS003_TEST_MONGODB_URI
const integration = uri ? test : test.skip
const standalone = process.env.SS003_TEST_STANDALONE === 'true'
const transactional = uri && !standalone ? test : test.skip
const nonTransactional = uri && standalone ? test : test.skip
let actor, sequence = 0
beforeAll(async () => {
  if (!uri) return
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/ss003_import_\d+(\?replicaSet=ss003_import)?$/.test(uri)) throw new Error('Fresh synthetic loopback database required')
  if (uri !== `mongodb://127.0.0.1:${process.env.SS003_TEST_PORT}/${process.env.SS003_TEST_DATABASE}${standalone ? '' : '?replicaSet=ss003_import'}`) throw new Error('Generated database identity must match exactly')
  await mongoose.connect(uri)
  expect(mongoose.connection.client.topology.description.type).toBe(standalone ? 'Single' : 'ReplicaSetWithPrimary')
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
transactional('audit failure after a real transactional audit insert rolls back pack, version and audit together', async () => {
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

const activeFixture = async () => {
  const { body } = fixture()
  body.extractedText = body.extractedText.replaceAll('SYSTEM_ONLY', 'PROVIDER_CONTEXT')
    .replaceAll('SYSTEM', 'STYLE').replaceAll('GOVERNANCE', 'STYLE')
  const result = await importDraft({ body, actorUserId: actor })
  await KnowledgePack.updateOne({ packId: result.pack.packId }, { $set: { status: 'ACTIVE', reviewStatus: 'APPROVED' } })
  await KnowledgePackVersion.updateOne({ versionId: result.version.versionId }, { $set: { status: 'ACTIVE', reviewStatus: 'APPROVED' } })
  const version = await KnowledgePackVersion.findOne({ versionId: result.version.versionId }).lean()
  const { _id, __v, createdAt, updatedAt, ...fields } = version
  await KnowledgePackActivation.create({ ...fields, activationId: `active-${body.packKey}`, label: result.pack.label,
    status: 'ACTIVE', activatedBy: actor })
  return { packId: result.pack.packId, versionId: result.version.versionId,
    body: { ...body, semanticVersion: '1.0.1', extractedText: `${body.extractedText}\nSuccessor draft only.` } }
}
const snapshot = async (packId) => ({
  parent: await KnowledgePack.findOne({ packId }).lean(),
  activeVersions: await KnowledgePackVersion.find({ packId, status: 'ACTIVE' }).select('+content').lean(),
  activations: await KnowledgePackActivation.find({ packId }).lean(),
})

transactional('ACTIVE successor creates only draft and audit, preserving parent and active resolver selection', async () => {
  const { packId, body, versionId } = await activeFixture()
  const before = await snapshot(packId)
  const beforeCounts = await counts()
  const resolutionBefore = await resolveOutcomeStudioKnowledgePacks({ contextCategories: ['STYLE'] })
  const selectedBefore = resolutionBefore.activePacks.find((entry) => entry.packId === packId)
  expect(selectedBefore.versionId).toBe(versionId)
  const result = await importDraft({ body, actorUserId: actor })
  expect(result.version).toMatchObject({ status: 'DRAFT', semanticVersion: '1.0.1', reviewStatus: 'DRAFT' })
  expect(await snapshot(packId)).toEqual(before)
  expect(await counts()).toEqual([beforeCounts[0], beforeCounts[1] + 1, beforeCounts[2] + 1, beforeCounts[3]])
  const resolutionAfter = await resolveOutcomeStudioKnowledgePacks({ contextCategories: ['STYLE'] })
  expect(resolutionAfter.activePacks.find((entry) => entry.packId === packId)).toEqual(selectedBefore)
})

integration.each(['CUSTOMER', 'TENANT'])('ACTIVE parent rejects mismatched %s scope without writes', async (visibility) => {
  const { packId, body } = await activeFixture()
  const before = await snapshot(packId), beforeCounts = await counts()
  await expect(importDraft({ actorUserId: actor, body: { ...body, visibility,
    metadataOverrides: ['visibility'], [visibility === 'CUSTOMER' ? 'customerId' : 'tenantId']: String(actor) } }))
    .rejects.toMatchObject({ status: 409, details: { reason: 'PACK_SOURCE_IMPORT_SCOPE_MISMATCH' } })
  expect(await counts()).toEqual(beforeCounts)
  expect(await snapshot(packId)).toEqual(before)
})

transactional('ACTIVE successor audit insert failure rolls back only new draft and audit', async () => {
  const { packId, body } = await activeFixture()
  const before = await snapshot(packId), beforeCounts = await counts()
  const original = AuditLog.createLog
  const failure = jest.spyOn(AuditLog, 'createLog').mockImplementationOnce(async function (...args) {
    expect(args[1].session.inTransaction()).toBe(true)
    const row = await original.apply(this, args)
    expect(await AuditLog.countDocuments({ _id: row._id }).session(args[1].session)).toBe(1)
    throw new Error('Injected successor audit failure after insert')
  })
  try { await expect(importDraft({ body, actorUserId: actor })).rejects.toMatchObject({ code: 'OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED' }) }
  finally { failure.mockRestore() }
  expect(await counts()).toEqual(beforeCounts)
  expect(await snapshot(packId)).toEqual(before)
})

transactional('ACTIVE successor duplicate race creates one draft/audit and never changes parent', async () => {
  const { packId, body } = await activeFixture()
  const before = await snapshot(packId), beforeCounts = await counts()
  const results = await Promise.allSettled([importDraft({ body, actorUserId: actor }), importDraft({ body, actorUserId: actor })])
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((row) => row.status === 'rejected').reason).toMatchObject({ status: 409, details: { reason: 'PACK_VERSION_ALREADY_EXISTS' } })
  await expect(importDraft({ body, actorUserId: actor })).rejects.toMatchObject({ details: { reason: 'PACK_VERSION_ALREADY_EXISTS' } })
  expect(await counts()).toEqual([beforeCounts[0], beforeCounts[1] + 1, beforeCounts[2] + 1, beforeCounts[3]])
  expect(await snapshot(packId)).toEqual(before)
})

nonTransactional('ACTIVE successor requires transaction support and writes nothing on standalone', async () => {
  const { packId, body } = await activeFixture()
  const before = await snapshot(packId), beforeCounts = await counts()
  await expect(importDraft({ body, actorUserId: actor })).rejects.toMatchObject({ status: 409,
    details: { reason: 'PACK_SOURCE_IMPORT_TRANSACTION_REQUIRED' } })
  expect(await counts()).toEqual(beforeCounts)
  expect(await snapshot(packId)).toEqual(before)
})

// Pause after the import's parent read, then commit a real competing write before
// it attempts its guarded parent update/insert. Only scheduling is intercepted.
const afterParentRead = (interleave) => {
  const original = KnowledgePackVersion.findOne
  return jest.spyOn(KnowledgePackVersion, 'findOne').mockImplementationOnce(function (...args) {
    const query = original.apply(this, args)
    const lean = query.lean.bind(query)
    query.lean = async () => { const result = await lean(); await interleave(); return result }
    return query
  })
}

integration.each(['activation', 'metadata without timestamp change'])('nonACTIVE parent concurrent %s aborts conditional update', async (change) => {
  const { body } = fixture()
  const first = await importDraft({ body, actorUserId: actor })
  const beforeCounts = await counts()
  let concurrent
  const gate = afterParentRead(async () => {
    await KnowledgePack.collection.updateOne({ packId: first.pack.packId }, { $set: change === 'activation'
      ? { status: 'ACTIVE', label: 'Concurrent activation' } : { description: 'Concurrent metadata' } })
    concurrent = await KnowledgePack.findOne({ packId: first.pack.packId }).lean()
  })
  try { await expect(importDraft({ body: { ...body, semanticVersion: '1.0.1', extractedText: `${body.extractedText}\nSuccessor` }, actorUserId: actor }))
    .rejects.toMatchObject({ status: 409, details: { reason: 'PACK_SOURCE_IMPORT_PARENT_CHANGED' } }) }
  finally { gate.mockRestore() }
  expect(await counts()).toEqual(beforeCounts)
  expect(await KnowledgePack.findOne({ packId: first.pack.packId }).lean()).toEqual(concurrent)
})

integration('unchanged nonACTIVE parent retains successor pointer update behavior', async () => {
  const { body } = fixture()
  const first = await importDraft({ body, actorUserId: actor })
  const next = await importDraft({ body: { ...body, semanticVersion: '1.0.1', extractedText: `${body.extractedText}\nSuccessor` }, actorUserId: actor })
  expect(await KnowledgePack.findOne({ packId: first.pack.packId }).lean()).toMatchObject({
    status: 'DRAFT', latestVersionId: next.version.versionId, latestSemanticVersion: '1.0.1',
  })
})

nonTransactional('unchanged nonACTIVE parent can be restored after standalone audit failure', async () => {
  const { body } = fixture()
  const first = await importDraft({ body, actorUserId: actor })
  const before = await KnowledgePack.findOne({ packId: first.pack.packId }).lean()
  const beforeCounts = await counts()
  const gate = jest.spyOn(AuditLog, 'createLog').mockRejectedValueOnce(new Error('Injected standalone audit failure'))
  try { await expect(importDraft({ body: { ...body, semanticVersion: '1.0.1', extractedText: `${body.extractedText}\nSuccessor` }, actorUserId: actor }))
    .rejects.toMatchObject({ code: 'OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED' }) }
  finally { gate.mockRestore() }
  const after = await KnowledgePack.findOne({ packId: first.pack.packId }).lean()
  const { updatedAt: beforeUpdatedAt, ...beforeFields } = before
  const { updatedAt: afterUpdatedAt, ...afterFields } = after
  expect(afterFields).toEqual(beforeFields)
  expect(await counts()).toEqual(beforeCounts)
})

integration('new parent insert cannot overwrite a concurrently created ACTIVE parent', async () => {
  const { body, metadata } = fixture()
  let concurrent
  const beforeCounts = await counts()
  const packId = `kp-system-${body.packKey}`
  const gate = afterParentRead(async () => {
    await KnowledgePack.create({ ...metadata, packId, packKey: body.packKey, status: 'ACTIVE', label: 'Concurrent parent', latestVersionId: 'concurrent-pointer' })
    concurrent = await KnowledgePack.findOne({ packId }).lean()
  })
  try { await expect(importDraft({ body, actorUserId: actor })).rejects.toMatchObject({ status: 409 }) }
  finally { gate.mockRestore() }
  expect(await counts()).toEqual([beforeCounts[0] + 1, beforeCounts[1], beforeCounts[2], beforeCounts[3]])
  expect(await KnowledgePack.findOne({ packId }).lean()).toEqual(concurrent)
})

nonTransactional('compensation refuses a real concurrent parent change even with unchanged timestamp', async () => {
  const { body } = fixture()
  const first = await importDraft({ body, actorUserId: actor })
  let concurrent
  const gate = jest.spyOn(AuditLog, 'createLog').mockImplementationOnce(async () => {
    await KnowledgePack.collection.updateOne({ packId: first.pack.packId }, { $set: { status: 'ACTIVE', label: 'Concurrent state' } })
    concurrent = await KnowledgePack.findOne({ packId: first.pack.packId }).lean()
    throw new Error('Audit failed after concurrent parent update')
  })
  try { await expect(importDraft({ body: { ...body, semanticVersion: '1.0.1', extractedText: `${body.extractedText}\nSuccessor` }, actorUserId: actor }))
    .rejects.toMatchObject({ code: 'OUTCOME_KNOWLEDGE_PACK_ROLLBACK_FAILED', details: { reason: 'PACK_SOURCE_IMPORT_ROLLBACK_CONFLICT' } }) }
  finally { gate.mockRestore() }
  expect(await KnowledgePack.findOne({ packId: first.pack.packId }).lean()).toEqual(concurrent)
  // Existing fail-closed compensation semantics retain the draft for reconciliation.
  expect(await KnowledgePackVersion.countDocuments({ packId: first.pack.packId, semanticVersion: '1.0.1', status: 'DRAFT' })).toBe(1)
})

transactional('ACTIVE import never writes parent even when a transition commits after its snapshot read', async () => {
  const { packId, body } = await activeFixture()
  let concurrent
  const original = KnowledgePackVersion.prototype.save
  const gate = jest.spyOn(KnowledgePackVersion.prototype, 'save').mockImplementationOnce(async function (...args) {
    await KnowledgePack.updateOne({ packId }, { $set: { status: 'DEPRECATED', label: 'Concurrent transition' } })
    concurrent = await KnowledgePack.findOne({ packId }).lean()
    return original.apply(this, args)
  })
  try { expect((await importDraft({ body, actorUserId: actor })).version.status).toBe('DRAFT') }
  finally { gate.mockRestore() }
  expect(await KnowledgePack.findOne({ packId }).lean()).toEqual(concurrent)
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
