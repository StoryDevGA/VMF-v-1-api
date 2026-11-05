import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Master from '../models/OutcomeMeaningSourceMaster.js'
import Audit from '../models/AuditLog.js'
import auditService from './auditService.js'
import { readOutcomeDocxRenditionSource } from './outcomeDocxRenditionSourceService.js'
import { getRuntimeInstance, assertRuntimePermission } from './runtimeInstanceService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { MEANING_MASTER_VERSION, MEANING_MASTER_USE, MEANING_MASTER_FLAGS, MEANING_MASTER_INDEXES, meaningMasterFailure,
  meaningMasterObjectId, meaningMasterRequestKey, meaningMasterId, meaningMasterRequestFingerprint, projectMeaningMasterSource,
  assertMeaningMasterBody, assertMeaningMasterRecord, assertMeaningMasterAudit, meaningMasterAuditDiff } from './outcomeMeaningSourceMasterContract.js'

const fail = (reason, status) => { throw meaningMasterFailure(reason, status) }
const plain = value => value?.toObject ? value.toObject() : value
const same = (a, b) => membershipHash(a) === membershipHash(b)
const checkTime = ctx => { if (Date.now() > ctx.deadline) fail('MASTER_OBSERVATION_DEADLINE', 503) }
const defaultAuthorize = async args => {
  const runtime = await getRuntimeInstance({ runtimeInstanceId: args.runtimeInstanceId, scopes: args.scopes })
  await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes, customerId: runtime.customerId, tenantId: runtime.tenantId,
    permission: String(runtime.runtimeType).toUpperCase() === 'DEAL_ANALYSIS' ? 'DEAL_UPDATE' : 'VMF_UPDATE' })
  return { tenantId: String(runtime.tenantId), customerId: String(runtime.customerId), runtimeInstanceId: String(runtime._id) }
}
const sourceObservation = async ctx => {
  checkTime(ctx)
  const start = Date.now(), source = await ctx.reader({ actorUserId: ctx.args.actorUserId, runtimeInstanceId: ctx.args.runtimeInstanceId, scopes: ctx.args.scopes })
  if (Date.now() - start > 150000) fail('MASTER_SOURCE_OBSERVATION_TIMEOUT', 503)
  checkTime(ctx)
  const snapshot = projectMeaningMasterSource(source)
  if (!Object.entries(ctx.scope).every(([key, value]) => snapshot.scope[key] === value)) fail('MASTER_SOURCE_SCOPE_CHANGED')
  return { source, snapshot }
}
export const assertMeaningMasterIndexes = async model => {
  let actual
  try { actual = await model.collection.indexes() } catch { fail('MASTER_INDEXES_NOT_READY', 503) }
  for (const [name, key] of Object.entries(MEANING_MASTER_INDEXES)) {
    const found = actual.find(index => index.name === name)
    if (!found || !found.unique || found.sparse || found.partialFilterExpression || found.collation
      || !same(Object.entries(found.key), Object.entries(key))) fail('MASTER_INDEXES_NOT_READY', 503)
  }
}
const context = async args => {
  if (!meaningMasterObjectId(args.actorUserId) || !meaningMasterObjectId(args.runtimeInstanceId)) fail('MASTER_REQUEST_IDENTITY_INVALID', 422)
  const deps = args.deps || {}, scope = await (deps.authorize || defaultAuthorize)(args)
  if (!scope || !['tenantId', 'customerId', 'runtimeInstanceId'].every(key => meaningMasterObjectId(scope[key]))
    || scope.runtimeInstanceId !== args.runtimeInstanceId
    || (args.scopes?.customer?._id && String(args.scopes.customer._id) !== scope.customerId)
    || (args.scopes?.tenant?._id && String(args.scopes.tenant._id) !== scope.tenantId)) fail('MASTER_SELECTED_SCOPE_MISMATCH')
  const ctx = { args, scope, model: deps.Master || Master, auditModel: deps.Audit || Audit,
    writer: deps.auditService || auditService, reader: deps.readSource || readOutcomeDocxRenditionSource, deadline: Date.now() + 480000 }
  ctx.observed = await sourceObservation(ctx)
  await assertMeaningMasterIndexes(ctx.model)
  return ctx
}
const select = (ctx, filter, session) => {
  let query = ctx.model.findOne({ ...ctx.scope, ...filter }).maxTimeMS(5000)
  if (session) query = query.session(session)
  return query.lean()
}
const verify = async (ctx, row, observation, expected, session) => {
  if (!row) fail('MASTER_NOT_FOUND', 404)
  assertMeaningMasterRecord(row)
  if (!Object.entries(ctx.scope).every(([key, value]) => String(row[key]) === value)) fail('MASTER_RECORD_SCOPE_CHANGED')
  if (expected && row.requestFingerprint !== expected) fail('MASTER_REQUEST_KEY_CONFLICT')
  if (row.sourceFingerprint !== observation.source.sourceFingerprint || !same(row.body.sourceSnapshot, observation.snapshot)) fail('MASTER_SOURCE_STALE')
  let query = ctx.auditModel.findOne({ _id: row.auditId }).maxTimeMS(5000)
  if (session) query = query.session(session)
  const audit = await query.lean()
  assertMeaningMasterAudit(row, audit, value => ctx.auditModel.prototype.verifySignature.call(value))
  checkTime(ctx)
}
const metadata = row => ({ masterId: row.masterId, version: row.version, purpose: row.body.purpose, status: row.body.status,
  permittedUse: row.permittedUse, classification: row.body.classification, createdBy: row.body.createdBy, createdAt: row.body.createdAt,
  sourceFingerprint: row.sourceFingerprint, sourceProjectionFingerprint: row.body.sourceProjectionFingerprint,
  ...Object.fromEntries(MEANING_MASTER_FLAGS.map(key => [key, false])), currentness: 'READ_OBSERVATION_ONLY_REVERIFY_BEFORE_USE' })

export const createMeaningSourceMaster = async args => {
  const payload = args.payload
  if (!payload || Object.getPrototypeOf(payload) !== Object.prototype || Object.keys(payload).sort().join(',') !== 'expectedSourceFingerprint,requestKey'
    || !meaningMasterRequestKey(payload.requestKey) || typeof payload.expectedSourceFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(payload.expectedSourceFingerprint)) fail('MASTER_REQUEST_INVALID', 422)
  const ctx = await context(args), expected = meaningMasterRequestFingerprint(payload.expectedSourceFingerprint)
  if (ctx.observed.source.sourceFingerprint !== payload.expectedSourceFingerprint) fail('MASTER_SOURCE_CHANGED')
  let saved, replay = false, callbacks = 0
  const session = await ctx.model.db.startSession()
  try {
    await session.withTransaction(async () => {
      if (++callbacks > 2) fail('MASTER_TRANSACTION_RETRY_LIMIT', 503)
      // This non-session read must finish before the first transaction operation.
      const fresh = await sourceObservation(ctx)
      if (fresh.source.sourceFingerprint !== payload.expectedSourceFingerprint) fail('MASTER_SOURCE_CHANGED')
      const started = Date.now(), atomicBudget = () => { checkTime(ctx); if (Date.now() - started > 20000) fail('MASTER_ATOMIC_BUDGET', 503) }
      const winner = await select(ctx, { requestKey: payload.requestKey }, session)
      if (winner) { await verify(ctx, winner, fresh, expected, session); atomicBudget(); saved = winner; replay = true; return }
      const existing = await select(ctx, { sourceFingerprint: payload.expectedSourceFingerprint, permittedUse: MEANING_MASTER_USE, contractVersion: MEANING_MASTER_VERSION }, session)
      if (existing) { await verify(ctx, existing, fresh, null, session); fail('MEANING_SOURCE_ALREADY_RECORDED') }
      const body = { contractVersion: MEANING_MASTER_VERSION, masterId: 'meaning_master_' + randomUUID(), version: 1,
        purpose: 'MEANING_SOURCE_ONLY', permittedUse: MEANING_MASTER_USE, classification: fresh.source.classification,
        status: 'RECORDED_MEANING_SOURCE_ONLY', scope: ctx.scope, requestKey: payload.requestKey, requestFingerprint: expected,
        createdBy: args.actorUserId, createdAt: new Date().toISOString(), ...Object.fromEntries(MEANING_MASTER_FLAGS.map(key => [key, false])),
        sourceFingerprint: payload.expectedSourceFingerprint, sourceProjectionFingerprint: membershipHash(fresh.snapshot), sourceSnapshot: fresh.snapshot }
      assertMeaningMasterBody(body)
      const pending = { _id: new mongoose.Types.ObjectId(), ...ctx.scope, masterId: body.masterId, version: 1,
        requestKey: body.requestKey, requestFingerprint: expected, sourceFingerprint: body.sourceFingerprint,
        permittedUse: MEANING_MASTER_USE, contractVersion: MEANING_MASTER_VERSION, bodyFingerprint: membershipHash(body), body }
      atomicBudget()
      const audit = plain(await ctx.writer.log({ actorUserId: args.actorUserId, action: 'OUTCOME_MEANING_SOURCE_RECORDED',
        resourceType: 'OutcomeMeaningSourceMaster', resourceId: pending._id, scope: ctx.scope,
        diff: meaningMasterAuditDiff(pending) }, { session, throwOnError: true }))
      atomicBudget()
      const row = { ...pending, auditId: audit?._id, auditSignatureVersion: audit?.signatureVersion }
      assertMeaningMasterRecord(row)
      assertMeaningMasterAudit(row, audit, value => ctx.auditModel.prototype.verifySignature.call(value))
      const [created] = await ctx.model.create([row], { session })
      saved = plain(created); atomicBudget()
    })
  } catch (error) {
    const indexName = typeof error?.message === 'string' ? error.message.match(/\bindex:\s+(\S+)\s+dup key:/)?.[1] : null
    const index = Object.entries(MEANING_MASTER_INDEXES).find(([name, key]) => error?.code === 11000
      && indexName === name && same(Object.entries(error.keyPattern || {}), Object.entries(key)))
    if (!index || index[0] === 'meaning_master_scope_version_unique') throw error
    const fresh = await sourceObservation(ctx)
    const winner = await select(ctx, { requestKey: payload.requestKey })
    if (winner) { await verify(ctx, winner, fresh, expected); saved = winner; replay = true }
    else {
      const duplicate = await select(ctx, { sourceFingerprint: payload.expectedSourceFingerprint, permittedUse: MEANING_MASTER_USE, contractVersion: MEANING_MASTER_VERSION })
      if (!duplicate) throw error
      await verify(ctx, duplicate, fresh); fail('MEANING_SOURCE_ALREADY_RECORDED')
    }
  } finally { await session.endSession() }
  const durable = await select(ctx, { masterId: saved.masterId, version: saved.version })
  await verify(ctx, durable, await sourceObservation(ctx), expected)
  checkTime(ctx)
  return { master: metadata(durable), idempotent: replay }
}
export const readMeaningSourceMaster = async args => {
  if (!meaningMasterId(args.masterId) || args.version !== 1) fail('MASTER_READ_IDENTITY_INVALID', 422)
  const ctx = await context(args), record = await select(ctx, { masterId: args.masterId, version: args.version })
  await verify(ctx, record, ctx.observed)
  checkTime(ctx)
  return { master: metadata(record) }
}

// Server-only consumption boundary. The metadata-only reader above stays
// unchanged; no controller accepts a source envelope or dependency overrides.
export const readMeaningSourceMasterForRendition = async args => {
  if (!meaningMasterId(args.masterId) || args.version !== 1) fail('MASTER_READ_IDENTITY_INVALID', 422)
  const ctx = await context(args), record = await select(ctx, { masterId: args.masterId, version: args.version })
  await verify(ctx, record, ctx.observed)
  checkTime(ctx)
  return {
    master: metadata(record),
    masterReference: { storageId: String(record._id), masterId: record.masterId, version: record.version,
      scope: { ...ctx.scope }, bodyFingerprint: record.bodyFingerprint, sourceFingerprint: record.sourceFingerprint,
      sourceProjectionFingerprint: record.body.sourceProjectionFingerprint, auditId: String(record.auditId),
      auditSignatureVersion: record.auditSignatureVersion },
    sourceEnvelope: JSON.parse(JSON.stringify(ctx.observed.source)),
  }
}
