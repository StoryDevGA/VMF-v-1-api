import { randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import mongoose from 'mongoose'
import Preview from '../models/OutcomeDocxPagePreview.js'
import Audit from '../models/AuditLog.js'
import auditService from './auditService.js'
import { readPrivateDocxCandidate } from './outcomeDocxCandidatePersistenceService.js'
import { renderDocxPagePreview } from './docxPagePreviewRenderer.js'
import { validateDocxPreviewRuntime } from './docxPagePreviewRuntime.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { MASTER_LINKED_CANDIDATE_VERSION, MASTER_LINKED_PREVIEW_VERSION } from './outcomeMasterLinkedDocxContract.js'
import { docxPagePreviewCreateSchema } from '../validators/outcomeDocxPagePreview.validator.js'
import { DOCX_PREVIEW_VERSION, DOCX_PREVIEW_ID_INDEX, DOCX_PREVIEW_IDENTITY_INDEX,
  docxPreviewFailure, assertDocxPagePreviewRecord, assertDocxPagePreviewAudit,
  docxPagePreviewAuditDiff } from './outcomeDocxPagePreviewRecordContract.js'

const fail = (reason, status) => { throw docxPreviewFailure(reason, status) }
const raw = value => value?.toObject ? value.toObject() : value
const identityKeys = { tenantId: 1, customerId: 1, runtimeInstanceId: 1, candidateId: 1, docxChecksum: 1, runtimeFingerprint: 1 }
const sameIndex = (index, key) => index?.unique === true && !index.sparse && !index.partialFilterExpression
  && !index.collation && membershipHash(Object.entries(index.key)) === membershipHash(Object.entries(key))
export const assertDocxPagePreviewIndexes = async model => {
  let indexes
  try { indexes = await model.collection.indexes() } catch { fail('PREVIEW_INDEXES_NOT_READY', 503) }
  if (!sameIndex(indexes.find(index => index.name === DOCX_PREVIEW_ID_INDEX), { previewId: 1 })
    || !sameIndex(indexes.find(index => index.name === DOCX_PREVIEW_IDENTITY_INDEX), identityKeys)) fail('PREVIEW_INDEXES_NOT_READY', 503)
}

export const readConfiguredDocxPreviewRuntime = async () => {
  try {
    const filename = process.env.DOCX_PAGE_PREVIEW_RUNTIME_FILE
    if (typeof filename !== 'string' || !path.isAbsolute(filename) || !/^[A-Za-z]:[\\/]/.test(filename)) throw new Error()
    const before = await lstat(filename)
    if (!before.isFile() || before.isSymbolicLink() || before.size > 16384) throw new Error()
    const bytes = await readFile(filename)
    const after = await lstat(filename)
    if (bytes.length > 16384 || after.isSymbolicLink() || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error()
    const profile = JSON.parse(bytes.toString('utf8'))
    const validated = await validateDocxPreviewRuntime(profile)
    return { profile, ...validated }
  } catch { fail('PREVIEW_RUNTIME_NOT_READY', 503) }
}

const readCandidate = args => (args.deps?.readCandidate || readPrivateDocxCandidate)({ actorUserId: args.actorUserId,
  runtimeInstanceId: args.runtimeInstanceId, candidateId: args.candidateId, scopes: args.scopes, includeBytes: true })
const context = async args => {
  const deadline = Date.now() + 480000
  const deps = args.deps || {}
  let verified = await readCandidate(args)
  if (!verified?.candidate || !Buffer.isBuffer(verified.buffer) || !verified.scope
    || verified.candidate.candidateId !== args.candidateId || verified.scope.runtimeInstanceId !== args.runtimeInstanceId
    || !['tenantId', 'customerId', 'runtimeInstanceId'].every(key => /^[a-f0-9]{24}$/.test(verified.scope[key] || ''))) fail('PREVIEW_CANDIDATE_SCOPE_INVALID')
  if (verified.candidate.contractVersion === MASTER_LINKED_CANDIDATE_VERSION) {
    if (!/^[a-f0-9]{64}$/.test(verified.candidate.masterBindingFingerprint || '')
      || !/^[a-f0-9]{64}$/.test(verified.candidate.bodyFingerprint || '')) fail('PREVIEW_MASTER_BINDING_MISSING')
    verified = { ...verified, candidate: JSON.parse(JSON.stringify(verified.candidate)), scope: { ...verified.scope }, buffer: Buffer.from(verified.buffer) }
  }
  const model = deps.Preview || Preview
  await assertDocxPagePreviewIndexes(model)
  const runtime = await (deps.readRuntime || readConfiguredDocxPreviewRuntime)()
  const ctx = { deadline, deps, model, auditModel: deps.Audit || Audit, verified, runtime, scope: verified.scope }
  checkTime(ctx)
  return ctx
}
const checkTime = ctx => {
  if (ctx.verified.candidate.contractVersion === MASTER_LINKED_CANDIDATE_VERSION && Date.now() > ctx.deadline) fail('MASTER_PREVIEW_DEADLINE', 503)
}
const identity = ctx => ({ candidateId: ctx.verified.candidate.candidateId,
  docxChecksum: ctx.verified.candidate.artifact.outputChecksum, runtimeFingerprint: ctx.runtime.fingerprint })
const select = (ctx, filter, session = null) => {
  let query = ctx.model.findOne({ ...ctx.scope, ...filter }).select('+pageBytes')
  if (session) query = query.session(session)
  return query.lean()
}
const verify = async (record, ctx, session = null) => {
  if (!record) fail('PREVIEW_NOT_FOUND', 404)
  const buffers = assertDocxPagePreviewRecord(record), candidate = ctx.verified.candidate
  const linked = candidate.contractVersion === MASTER_LINKED_CANDIDATE_VERSION
  if (linked !== (record.body.contractVersion === MASTER_LINKED_PREVIEW_VERSION)
    || (linked && (record.body.masterBindingFingerprint !== candidate.masterBindingFingerprint
      || record.body.candidateBodyFingerprint !== candidate.bodyFingerprint))) fail('PREVIEW_MASTER_BINDING_CHANGED')
  if (Object.entries(identity(ctx)).some(([key, value]) => record[key] !== value)
    || record.body.sourceFingerprint !== candidate.sourceFingerprint || record.body.inputFingerprint !== candidate.inputFingerprint
    || membershipHash(record.body.renderer) !== membershipHash(candidate.renderer)
    || membershipHash(record.body.conversion.runtime) !== membershipHash(ctx.runtime.receipt)) fail('PREVIEW_CANDIDATE_OR_RUNTIME_CHANGED')
  let query = ctx.auditModel.findOne({ _id: record.auditId })
  if (session) query = query.session(session)
  const audit = await query.lean()
  assertDocxPagePreviewAudit(record, audit, row => linked ? ctx.auditModel.prototype.verifySignature.call(row) : ctx.auditModel.hydrate(row).verifySignature())
  checkTime(ctx)
  return buffers
}
const metadata = record => ({ ...record.body, currentness: 'VERIFIED_AT_READ_OBSERVATION_REVERIFY_BEFORE_NEXT_ACTION' })

export const createDocxPagePreview = async args => {
  const parsed = docxPagePreviewCreateSchema.safeParse(args.payload)
  if (!parsed.success) fail('PREVIEW_REQUEST_INVALID', 422)
  const ctx = await context(args), candidate = ctx.verified.candidate
  const linked = candidate.contractVersion === MASTER_LINKED_CANDIDATE_VERSION
  if (parsed.data.expectedSourceFingerprint !== candidate.sourceFingerprint
    || parsed.data.expectedOutputChecksum !== candidate.artifact.outputChecksum) fail('PREVIEW_EXPECTED_CANDIDATE_CHANGED')
  const existing = await select(ctx, identity(ctx))
  if (existing) { await verify(existing, ctx); return { preview: metadata(existing), idempotent: true } }
  // Conversion is outside the transaction. A rejected converter, including an
  // uncertain process cleanup, cannot produce a successful persisted preview.
  let rendered = await (ctx.deps.renderPreview || renderDocxPagePreview)({ buffer: ctx.verified.buffer,
    outputChecksum: candidate.artifact.outputChecksum, runtimeProfile: ctx.runtime.profile })
  if (linked) {
    checkTime(ctx)
    if (!rendered?.receipt || !Array.isArray(rendered.pages) || rendered.pages.some(page => !Buffer.isBuffer(page.buffer))) fail('PREVIEW_CONVERSION_INVALID')
    rendered = { receipt: JSON.parse(JSON.stringify(rendered.receipt)), fingerprint: rendered.fingerprint,
      pages: rendered.pages.map(page => ({ ...page, buffer: Buffer.from(page.buffer) })) }
  }
  const current = await readCandidate(args), runtime = await (ctx.deps.readRuntime || readConfiguredDocxPreviewRuntime)()
  checkTime(ctx)
  if (membershipHash(current.scope) !== membershipHash(ctx.scope)
    || current.candidate?.candidateId !== candidate.candidateId
    || current.candidate.sourceFingerprint !== candidate.sourceFingerprint || current.candidate.inputFingerprint !== candidate.inputFingerprint
    || current.candidate.artifact?.outputChecksum !== candidate.artifact.outputChecksum
    || membershipHash(current.candidate.renderer) !== membershipHash(candidate.renderer)
    || !Buffer.isBuffer(current.buffer) || !current.buffer.equals(ctx.verified.buffer)
    || runtime.fingerprint !== ctx.runtime.fingerprint || membershipHash(runtime.receipt) !== membershipHash(ctx.runtime.receipt)) fail('PREVIEW_ADMISSION_CHANGED')
  if (linked && (current.candidate.contractVersion !== MASTER_LINKED_CANDIDATE_VERSION
    || current.candidate.masterBindingFingerprint !== candidate.masterBindingFingerprint
    || current.candidate.bodyFingerprint !== candidate.bodyFingerprint)) fail('PREVIEW_MASTER_BINDING_CHANGED')
  const body = { contractVersion: linked ? MASTER_LINKED_PREVIEW_VERSION : DOCX_PREVIEW_VERSION, previewId: `docx_preview_${randomUUID()}`, candidateId: candidate.candidateId,
    scope: ctx.scope, createdBy: String(args.actorUserId), createdAt: new Date().toISOString(), status: 'PRIVATE_PREVIEW_ONLY',
    classification: candidate.classification, authoritative: false, officialUse: false, normalOutputAvailable: false,
    authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false,
    sourceFingerprint: candidate.sourceFingerprint, inputFingerprint: candidate.inputFingerprint, renderer: candidate.renderer,
    conversion: rendered.receipt, conversionFingerprint: rendered.fingerprint,
    ...(linked ? { candidateBodyFingerprint: candidate.bodyFingerprint, masterBindingFingerprint: candidate.masterBindingFingerprint } : {}) }
  const pending = { _id: new mongoose.Types.ObjectId(), ...ctx.scope, ...identity(ctx), previewId: body.previewId,
    bodyFingerprint: membershipHash(body), body, pageBytes: rendered.pages?.map(page => page.buffer) }
  // Validate before opening a transaction; placeholder audit identity is never saved.
  assertDocxPagePreviewRecord({ ...pending, auditId: new mongoose.Types.ObjectId(), auditSignatureVersion: 1 })
  if (membershipHash(body.conversion.runtime) !== membershipHash(ctx.runtime.receipt)) fail('PREVIEW_CONVERTER_RUNTIME_CHANGED')
  const session = await ctx.model.db.startSession()
  let saved, replay = false, callbacks = 0
  try {
    await session.withTransaction(async () => {
      const start = Date.now(), budget = () => {
        if (linked) { checkTime(ctx); if (Date.now() - start > 20000) fail('MASTER_PREVIEW_ATOMIC_BUDGET', 503) }
      }
      if (linked && ++callbacks > 2) fail('MASTER_PREVIEW_RETRY_LIMIT', 503)
      const winner = await select(ctx, identity(ctx), session)
      if (winner) { await verify(winner, ctx, session); budget(); saved = winner; replay = true; return }
      budget()
      const document = await (ctx.deps.auditService || auditService).log({ actorUserId: args.actorUserId,
        action: 'OUTCOME_DOCX_PAGE_PREVIEW_CREATED', resourceType: 'OutcomeDocxPagePreview', resourceId: pending._id,
        scope: ctx.scope, requestId: args.auditRequest?.requestId, diff: docxPagePreviewAuditDiff(pending) }, { session, throwOnError: true })
      const audit = raw(document), record = { ...pending, auditId: audit?._id, auditSignatureVersion: audit?.signatureVersion }
      budget()
      assertDocxPagePreviewRecord(record)
      assertDocxPagePreviewAudit(record, audit, row => linked ? ctx.auditModel.prototype.verifySignature.call(row) : ctx.auditModel.hydrate(row).verifySignature())
      const [created] = await ctx.model.create([record], { session }); saved = raw(created)
      budget()
    })
  } catch (error) {
    const race = error?.code === 11000 && (linked
      ? error.message?.match(/\bindex:\s+(\S+)\s+dup key:/)?.[1] === DOCX_PREVIEW_IDENTITY_INDEX
      : error.message?.includes(DOCX_PREVIEW_IDENTITY_INDEX))
      && membershipHash(Object.entries(error.keyPattern || {})) === membershipHash(Object.entries(identityKeys))
    if (!race) throw error
    const winner = await select(ctx, identity(ctx))
    if (!winner) throw error
    await verify(winner, ctx); saved = winner; replay = true
  } finally { await session.endSession() }
  const durable = await select(ctx, { previewId: saved.previewId, candidateId: args.candidateId })
  await verify(durable, ctx)
  return { preview: metadata(durable), idempotent: replay }
}

export const readCurrentDocxPagePreview = async args => {
  const ctx = await context(args), record = await select(ctx, identity(ctx))
  if (!record) return { preview: null }
  const buffers = await verify(record, ctx)
  return { preview: metadata(record), ...(args.includePages === true ? { pages: buffers, document: ctx.verified.document } : {}) }
}
export const readDocxPagePreview = async args => {
  const ctx = await context(args), record = await select(ctx, { candidateId: args.candidateId, previewId: args.previewId })
  const buffers = await verify(record, ctx)
  return { preview: metadata(record), ...(args.includePages === true ? { pages: buffers, document: ctx.verified.document } : {}) }
}
