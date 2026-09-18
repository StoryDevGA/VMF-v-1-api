import { beforeAll, afterAll, afterEach, test, expect, jest } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import crypto from 'node:crypto'
import { KnowledgePack, KnowledgePackVersion, KnowledgePackActivation } from '../models/index.js'
import AuditLog from '../models/AuditLog.js'
import {
  importOutcomeKnowledgePackSourceDocumentDraft as importDraft,
  activateOutcomeKnowledgePackVersion as activate,
  disableOutcomeKnowledgePackActivation as disable,
} from '../services/outcomeKnowledgePackRegistryService.js'

jest.setTimeout(120000)
let replica, sequence = 0
const actor = new mongoose.Types.ObjectId()
beforeAll(async () => {
  // mongodb-memory-server reads MONGOMS_SYSTEM_BINARY when supplied by the runner.
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  const uri = replica.getUri(`ss030_scope_${Date.now()}`)
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Synthetic loopback MongoDB required')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  for (const model of [KnowledgePack, KnowledgePackVersion, KnowledgePackActivation, AuditLog]) {
    await model.createCollection()
    await model.createIndexes()
  }
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => { await mongoose.disconnect(); await replica?.stop() })

const fixture = async () => {
  const id = ++sequence
  const packKey = `arl-${String(id).padStart(3, '0')}-${'canonical-source-'.repeat(5)}method`
  const text = `---\nname: Synthetic scope ${id}\nknowledge_asset_id: SCOPE-${id}\ncapability_key: scope-${id}\ndraft_pack_type: ARL\npurpose_category: FRAMEWORK\nknowledge_layer: FRAMEWORK\nexecution_mode: PROVIDER_CONTEXT\nvisibility: PLATFORM\nworkspace_compatibility: [OUTCOME]\nruntime_consumers: [Outcome Studio]\ndescription: Isolated scope test\n---\n# Method\nPreserve this complete synthetic source. No external data.`
  const imported = await importDraft({ actorUserId: actor, body: { packKey, semanticVersion: '1.0.0',
    contentFormat: 'MARKDOWN', extractedText: text, sourceDocument: { filename: 'scope.md', mimeType: 'text/markdown' } } })
  const { packId } = imported.pack, { versionId } = imported.version
  await KnowledgePackVersion.updateOne({ versionId }, { $set: { status: 'ACTIVE', reviewStatus: 'APPROVED', validationSummary: { status: 'PASSED' } } })
  const version = await KnowledgePackVersion.findOne({ versionId }).lean()
  const { _id, __v, createdAt, updatedAt, ...fields } = version
  const baseline = await KnowledgePackActivation.create({ ...fields, activationId: `baseline-${id}`, status: 'ACTIVE', scopeType: 'GLOBAL', scopeKey: 'GLOBAL' })
  return { packId, versionId, baselineId: baseline.activationId, hash: version.contentHash }
}
const scopeBody = (key = 'target') => ({ scopeType: 'PACKAGE', frameworkKey: 'VMF', packageKey: `${key}-${'scope-'.repeat(8)}`, packageVersion: '3.2.0' })
const add = (f, body = scopeBody()) => activate({ packId: f.packId, versionId: f.versionId,
  body: { expectedContentHash: f.hash, ...body }, actorUserId: actor })
const undo = (f, activationId, body = { expectedVersionId: f.versionId, expectedContentHash: f.hash }) =>
  disable({ packId: f.packId, activationId, body, actorUserId: actor })
const snapshot = async (f) => ({
  pack: await KnowledgePack.findOne({ packId: f.packId }).lean(),
  version: await KnowledgePackVersion.findOne({ versionId: f.versionId }).select('+content').lean(),
  baseline: await KnowledgePackActivation.findOne({ activationId: f.baselineId }).lean(),
})
const withoutRevision = ({ __v, ...value }) => value

test('adds a bounded-ID scope and undoes only that binding, preserving lifecycle/source/history', async () => {
  const f = await fixture(), before = await snapshot(f)
  const result = await add(f)
  expect(result.activation.activationId.length).toBeLessThanOrEqual(260)
  expect(`kpa-arl-${result.activation.packKey}-${f.versionId}-${result.activation.scopeKey}`.length).toBeGreaterThan(260)
  expect(result.activation.canDisableAdditionalScope).toBe(true)
  expect(result.activation.additionalScopeBaselineActivationId).toBe(f.baselineId)
  const after = await snapshot(f)
  expect(after.pack).toEqual(before.pack)
  expect(withoutRevision(after.version)).toEqual(withoutRevision(before.version))
  expect(withoutRevision(after.baseline)).toEqual(withoutRevision(before.baseline))
  const undone = await undo(f, result.activation.activationId)
  expect(undone.activation).toMatchObject({ status: 'DISABLED', canDisableAdditionalScope: false })
  expect(await KnowledgePackActivation.countDocuments({ packId: f.packId, status: 'ACTIVE' })).toBe(1)
  expect(await KnowledgePackActivation.countDocuments({ activationId: result.activation.activationId, status: 'DISABLED' })).toBe(1)
  expect(await AuditLog.countDocuments({ 'diff.activationId': result.activation.activationId })).toBe(2)
  const undoAudit = await AuditLog.findOne({ 'diff.activationId': result.activation.activationId, action: 'KNOWLEDGE_PACK_ACTIVATION_DISABLED' }).lean()
  expect(undoAudit.summary).toContain('activation')
  await expect(undo(f, result.activation.activationId)).rejects.toMatchObject({ details: { reason: 'ACTIVATION_UNDO_NOT_ALLOWED' } })
})

test('concurrent additional activations yield one winner and never replace an occupied scope', async () => {
  const f = await fixture()
  const results = await Promise.allSettled([add(f), add(f)])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({ status: 409, details: { reason: 'ACTIVATION_SCOPE_OCCUPIED' } })
  expect(await KnowledgePackActivation.countDocuments({ packId: f.packId, status: 'ACTIVE' })).toBe(2)
})

test('new extension ID collision retries with a fresh bounded identifier', async () => {
  const f = await fixture(), first = await add(f)
  jest.spyOn(crypto, 'randomUUID').mockReturnValueOnce(first.activation.activationId.slice('kpa-scope-'.length))
  const second = await add(f, scopeBody('another'))
  expect(second.activation.activationId).not.toBe(first.activation.activationId)
  expect(await KnowledgePackActivation.countDocuments({ packId: f.packId, status: 'ACTIVE' })).toBe(3)
})

test.each([undefined, 'stale-content-hash'])('missing or stale confirmed activation hash %s rejects without writes', async (expectedContentHash) => {
  const f = await fixture(), before = await snapshot(f), auditCount = await AuditLog.countDocuments()
  await expect(add(f, { ...scopeBody(), expectedContentHash })).rejects.toMatchObject({ details: { reason: 'ACTIVATION_IDENTITY_STALE' } })
  expect(await snapshot(f)).toEqual(before)
  expect(await KnowledgePackActivation.countDocuments({ packId: f.packId })).toBe(1)
  expect(await AuditLog.countDocuments()).toBe(auditCount)
})

test('different-version occupied scope is not replaced', async () => {
  const f = await fixture(), existing = await add(f)
  await KnowledgePackActivation.updateOne({ activationId: existing.activation.activationId }, { $set: { versionId: 'kpv-other-version' } })
  const before = await KnowledgePackActivation.findOne({ activationId: existing.activation.activationId }).lean()
  await expect(add(f)).rejects.toMatchObject({ details: { reason: 'ACTIVATION_SCOPE_OCCUPIED' } })
  expect(await KnowledgePackActivation.findOne({ activationId: existing.activation.activationId }).lean()).toEqual(before)
})

test('audit failure after insertion rolls back additional binding and concurrency revisions', async () => {
  const f = await fixture(), before = await snapshot(f)
  const auditCount = await AuditLog.countDocuments()
  const original = AuditLog.createLog
  jest.spyOn(AuditLog, 'createLog').mockImplementationOnce(async function (...args) {
    expect(args[1].session.inTransaction()).toBe(true)
    await original.apply(this, args)
    throw new Error('Synthetic audit failure after insert')
  })
  await expect(add(f)).rejects.toMatchObject({ code: 'OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED' })
  expect(await snapshot(f)).toEqual(before)
  expect(await KnowledgePackActivation.countDocuments({ packId: f.packId })).toBe(1)
  expect(await AuditLog.countDocuments()).toBe(auditCount)
})

test('undo audit failure restores active binding and baseline; simultaneous undos retain baseline', async () => {
  const f = await fixture(), first = await add(f), second = await add(f, scopeBody('other'))
  const before = await snapshot(f), auditCount = await AuditLog.countDocuments()
  const original = AuditLog.createLog
  const failure = jest.spyOn(AuditLog, 'createLog').mockImplementationOnce(async function (...args) {
    await original.apply(this, args); throw new Error('Synthetic undo audit failure')
  })
  await expect(undo(f, first.activation.activationId)).rejects.toMatchObject({ code: 'OUTCOME_KNOWLEDGE_PACK_AUDIT_FAILED' })
  failure.mockRestore()
  expect(await snapshot(f)).toEqual(before)
  expect(await AuditLog.countDocuments()).toBe(auditCount)
  expect(await KnowledgePackActivation.countDocuments({ packId: f.packId, status: 'ACTIVE' })).toBe(3)
  await Promise.all([undo(f, first.activation.activationId), undo(f, second.activation.activationId)])
  expect(await KnowledgePackActivation.countDocuments({ packId: f.packId, status: 'ACTIVE' })).toBe(1)
})

test('global, stale, inactive, nonextension and missing baseline undo attempts reject without audit', async () => {
  const f = await fixture(), added = await add(f), id = added.activation.activationId
  const auditCount = await AuditLog.countDocuments()
  await expect(add(f, { scopeType: 'GLOBAL' })).rejects.toMatchObject({ details: { reason: 'ACTIVATION_ADDITIONAL_SCOPE_REQUIRED' } })
  await expect(undo(f, f.baselineId)).rejects.toMatchObject({ details: { reason: 'ACTIVATION_UNDO_NOT_ALLOWED' } })
  await expect(undo(f, id, { expectedVersionId: f.versionId, expectedContentHash: 'stale' })).rejects.toMatchObject({ details: { reason: 'ACTIVATION_IDENTITY_STALE' } })
  await KnowledgePackActivation.updateOne({ activationId: f.baselineId }, { $set: { status: 'DISABLED' } })
  await expect(undo(f, id)).rejects.toMatchObject({ details: { reason: 'ACTIVATION_BASELINE_MISSING' } })
  expect(await KnowledgePackActivation.countDocuments({ packId: f.packId, status: 'ACTIVE' })).toBe(1)
  expect(await AuditLog.countDocuments()).toBe(auditCount)
})

test.each(['review', 'hash', 'metadata'])('additional activation rechecks %s inside transaction', async (kind) => {
  const f = await fixture()
  await KnowledgePackVersion.updateOne({ versionId: f.versionId }, { $set: kind === 'review'
    ? { reviewStatus: 'REJECTED' } : kind === 'hash' ? { contentHash: 'bad-hash' } : { capabilityKey: '' } })
  const auditCount = await AuditLog.countDocuments()
  await expect(add(f)).rejects.toMatchObject({ status: 409 })
  expect(await KnowledgePackActivation.countDocuments({ packId: f.packId })).toBe(1)
  expect(await AuditLog.countDocuments()).toBe(auditCount)
})
