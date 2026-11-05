import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import Candidate from '../models/OutcomeDocxRenditionCandidate.js'
import Audit from '../models/AuditLog.js'
import auditService from './auditService.js'
import { readOutcomeDocxRenditionSource } from './outcomeDocxRenditionSourceService.js'
import { prepareGovernedPrivateDocxCandidate, GOVERNED_PRIVATE_DOCX_CAPABILITY } from './outcomeGovernedDocxCandidateService.js'
import { prepareMeaningMasterDocxRendition, prepareCorrectedMeaningMasterDocxRendition, prepareApprovedMeaningMasterDocxRendition } from './outcomeMeaningMasterRenditionService.js'
import { readMeaningSourceMasterForRendition } from './outcomeMeaningSourceMasterService.js'
import { MASTER_LINKED_CANDIDATE_VERSION, CORRECTED_MASTER_BINDING_VERSION, masterLinkedRequestFingerprint,
  correctedMasterLinkedRequestFingerprint, masterBindingFromBridge, APPROVED_MASTER_BINDING_VERSION, NARROW_MASTER_BINDING_VERSION,
  approvedMasterLinkedRequestFingerprint } from './outcomeMasterLinkedDocxContract.js'
import { approvedExpressionProfile } from './commercialDocxApprovedExpression.js'
import { readFailedDocxCorrectionPredecessor } from './outcomeDocxCorrectionPredecessorService.js'
import { loadOutcomeKnowledgePackVersionContent } from './outcomeKnowledgePackRegistryService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { privateDocxCandidateCreateSchema, masterLinkedDocxCandidateCreateSchema,
  correctedMasterLinkedDocxCandidateCreateSchema, approvedMasterLinkedDocxCandidateCreateSchema } from '../validators/outcomeDocxCandidate.validator.js'
import { PRIVATE_DOCX_CANDIDATE_VERSION, PRIVATE_DOCX_CANDIDATE_INDEX, PRIVATE_DOCX_CANDIDATE_ID_INDEX,
  privateDocxFailure, privateDocxByteHash, assertPrivateDocxCandidateRecord, assertPrivateDocxCandidateAudit,
  privateDocxAuditDiff } from './outcomeDocxCandidateRecordContract.js'

const fail = (reason, status) => { throw privateDocxFailure(reason, status) }
const raw = value => value?.toObject ? value.toObject() : value
const scopeOf = envelope => Object.fromEntries(['tenantId', 'customerId', 'runtimeInstanceId'].map(key => [key, envelope.source.scope[key]]))
const sameIndex = (index, key) => index?.unique === true && !index.sparse && !index.partialFilterExpression
  && !index.collation && membershipHash(Object.entries(index.key)) === membershipHash(Object.entries(key))
export const assertPrivateDocxCandidateIndexes = async model => {
  let indexes
  try { indexes = await model.collection.indexes() } catch { fail('CANDIDATE_INDEXES_NOT_READY', 503) }
  if (!sameIndex(indexes.find(index => index.name === PRIVATE_DOCX_CANDIDATE_INDEX),
    { tenantId: 1, customerId: 1, runtimeInstanceId: 1, requestKey: 1 })
    || !sameIndex(indexes.find(index => index.name === PRIVATE_DOCX_CANDIDATE_ID_INDEX), { candidateId: 1 })) fail('CANDIDATE_INDEXES_NOT_READY', 503)
}
const currentPacks = async (input, loader) => {
  const selected = input?.sourceEnvelope?.source?.selectedPacks
  for (const layer of ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'AUDIENCE', 'STYLE', 'VISUAL_SYSTEM']) {
    const receipt = selected?.[layer]
    if (!receipt) fail('CANDIDATE_PACK_RECEIPT_MISSING')
    const loaded = await loader({ packId: receipt.packId, versionId: receipt.versionId })
    if (!loaded?.available || loaded.status !== 'ACTIVE'
      || ['packId', 'versionId', 'packKey', 'semanticVersion', 'contentHash'].some(key => loaded[key] !== receipt[key])
      || typeof loaded.content !== 'string' || privateDocxByteHash(loaded.content) !== receipt.contentHash) fail('CANDIDATE_PACK_NO_LONGER_ELIGIBLE')
  }
}
// Server-only eligibility check for an already validated immutable candidate.
// The normal registry remains the owner; callers cannot supply a loader.
export const assertCurrentPrivateDocxCandidatePacks = async (...args) => {
  if (args.length !== 1) fail('CANDIDATE_PACK_OVERRIDES_FORBIDDEN')
  await currentPacks(args[0], loadOutcomeKnowledgePackVersionContent)
}
const context = async args => {
  const deadline = Date.now() + 480000
  const deps = args.deps || {}, model = deps.Candidate || Candidate, auditModel = deps.Audit || Audit
  const envelope = await (deps.readSource || readOutcomeDocxRenditionSource)({ actorUserId: args.actorUserId,
    runtimeInstanceId: args.runtimeInstanceId, scopes: args.scopes })
  if (envelope?.source?.scope?.runtimeInstanceId !== args.runtimeInstanceId) fail('CANDIDATE_REQUEST_SCOPE_CHANGED')
  await assertPrivateDocxCandidateIndexes(model)
  return { args, deadline, deps, model, auditModel, envelope, scope: scopeOf(envelope), loader: deps.loadPackContent || loadOutcomeKnowledgePackVersionContent }
}
const checkTime = ctx => { if (Date.now() > ctx.deadline) fail('MASTER_CANDIDATE_DEADLINE', 503) }
// This identity is usable only during this owner's awaited compatibility read.
// It cannot be minted by callers, serialized, or retained for a later request.
const masterObservations = new WeakMap()
const observationFingerprint = receipt => membershipHash(JSON.parse(JSON.stringify(receipt)))
export const assertPrivateDocxMasterObservation = (receipt, args) => {
  const entry = receipt && masterObservations.get(receipt)
  if (!entry || !entry.active || entry.ctx.args.deps || entry.ctx.masterReceipt !== receipt
    || entry.ctx.args.scopes !== args?.scopes || entry.ctx.args.actorUserId !== args.actorUserId
    || entry.ctx.args.runtimeInstanceId !== args.runtimeInstanceId
    || receipt.masterReference.masterId !== args.masterId || receipt.masterReference.version !== args.version
    || membershipHash(entry.ctx.scope) !== entry.scopeFingerprint
    || observationFingerprint(receipt) !== entry.fingerprint) fail('CANDIDATE_MASTER_OBSERVATION_INVALID')
  checkTime(entry.ctx)
  return receipt
}
const loadMaster = async (ctx, masterId, version, fresh = false) => {
  checkTime(ctx)
  const request = { actorUserId: ctx.args.actorUserId, runtimeInstanceId: ctx.args.runtimeInstanceId,
    scopes: ctx.args.scopes, masterId, version }
  // Within one authenticated read, reuse its actual source observation. It is
  // not a client input or a transactionally locked source snapshot.
  const receipt = await (ctx.deps.readMaster || (input => readMeaningSourceMasterForRendition({ ...input,
    ...(fresh ? {} : { deps: { readSource: async () => ctx.envelope } }) })))(request)
  checkTime(ctx)
  if (receipt?.masterReference?.masterId !== masterId || receipt.masterReference.version !== version
    || receipt.sourceEnvelope?.sourceFingerprint !== ctx.envelope.sourceFingerprint) fail('CANDIDATE_MASTER_CHANGED')
  ctx.masterReceipt = receipt
  if (!ctx.args.deps) masterObservations.set(receipt, { ctx, active: false,
    scopeFingerprint: membershipHash(ctx.scope), fingerprint: observationFingerprint(receipt) })
  return receipt
}
const rawSignature = (ctx, row, linked) => linked ? ctx.auditModel.prototype.verifySignature.call(row) : ctx.auditModel.hydrate(row).verifySignature()
const verify = async (record, ctx, expectedRequest = null, session = null) => {
  if (!record) fail('CANDIDATE_NOT_FOUND', 404)
  if (expectedRequest && record.requestFingerprint !== expectedRequest) fail('CANDIDATE_REQUEST_KEY_CONFLICT')
  const buffer = assertPrivateDocxCandidateRecord(record)
  if (record.body.sourceFingerprint !== ctx.envelope.sourceFingerprint) fail('CANDIDATE_SOURCE_CHANGED')
  const linked = record.body.contractVersion === MASTER_LINKED_CANDIDATE_VERSION
  if (linked) {
    const ref = record.body.masterBinding.masterReference
    if (session && !ctx.masterReceipt) fail('CANDIDATE_MASTER_OBSERVATION_REQUIRED')
    const receipt = ctx.masterReceipt || await loadMaster(ctx, ref.masterId, ref.version)
    if (membershipHash(receipt.masterReference) !== membershipHash(ref)) fail('CANDIDATE_MASTER_CHANGED')
  }
  if (record.body.masterBinding?.contractVersion === CORRECTED_MASTER_BINDING_VERSION) {
    const expected = record.body.masterBinding.correctionReference
    if (session) {
      if (!ctx.correctionReference || membershipHash(ctx.correctionReference) !== membershipHash(expected)) fail('CANDIDATE_CORRECTION_OBSERVATION_REQUIRED')
    } else {
      const actual = await loadCorrection(ctx, expected.predecessor.candidateId, expected.predecessorBodyFingerprint,
        expected.predecessor.failedReviewExecutionId, expected.predecessor.failedReviewResultFingerprint)
      if (membershipHash(actual) !== membershipHash(expected)) fail('CANDIDATE_CORRECTION_CHANGED')
    }
  }
  if ([APPROVED_MASTER_BINDING_VERSION, NARROW_MASTER_BINDING_VERSION].includes(record.body.masterBinding?.contractVersion)) {
    const expected = record.body.masterBinding.compatibilityReference
    if (session) {
      if (!ctx.approvedCompatibilityReference || membershipHash(ctx.approvedCompatibilityReference) !== membershipHash(expected)) fail('CANDIDATE_APPROVED_OBSERVATION_REQUIRED')
    } else {
      const observed = await loadApprovedCompatibility(ctx, expected.auditId, expected.decisionFingerprint)
      if (membershipHash(observed) !== membershipHash(expected)) fail('CANDIDATE_APPROVED_COMPATIBILITY_CHANGED')
    }
  }
  let query = ctx.auditModel.findOne({ _id: record.auditId })
  if (session) query = query.session(session)
  const audit = await query.lean()
  assertPrivateDocxCandidateAudit(record, audit, row => rawSignature(ctx, row, linked))
  // V2 write admission checked packs before the transaction, and completion
  // checks them again below through this verifier without a session. A race
  // winner must not perform upstream reads inside the atomic window.
  if (!linked || !session) await currentPacks(record.body.input, ctx.loader)
  if (linked) checkTime(ctx)
  return buffer
}
const selectRecord = (ctx, filter, session = null) => {
  let query = ctx.model.findOne({ ...ctx.scope, ...filter }).select('+fileBytes')
  if (session) query = query.session(session)
  return query.lean()
}
const loadCorrection = async (ctx, candidateId, expectedBodyFingerprint, failedReviewExecutionId, expectedFailedReviewResultFingerprint) => {
  checkTime(ctx)
  const predecessor = await selectRecord(ctx, { candidateId })
  if (!predecessor || predecessor.bodyFingerprint !== expectedBodyFingerprint
    || predecessor.body?.input?.contractVersion !== 'governed-private-docx-input.v1'
    || predecessor.body.masterBinding?.contractVersion !== 'master-linked-private-docx-binding.v1') fail('CANDIDATE_PREDECESSOR_CHANGED')
  await verify(predecessor, ctx)
  const observed = await (ctx.deps.readFailedPredecessor || readFailedDocxCorrectionPredecessor)({
    actorUserId: ctx.args.actorUserId, scopes: ctx.args.scopes, scope: ctx.scope, candidate: predecessor,
    failedReviewExecutionId, expectedFailedReviewResultFingerprint,
  })
  checkTime(ctx)
  if (observed?.predecessorBodyFingerprint !== expectedBodyFingerprint
    || observed.predecessor?.candidateId !== candidateId
    || observed.predecessor.inputFingerprint !== predecessor.body.inputFingerprint
    || observed.predecessor.outputChecksum !== predecessor.body.artifact.outputChecksum
    || observed.predecessor.failedReviewExecutionId !== failedReviewExecutionId
    || observed.predecessor.failedReviewResultFingerprint !== expectedFailedReviewResultFingerprint) fail('CANDIDATE_CORRECTION_CHANGED')
  const reference = JSON.parse(JSON.stringify(observed))
  if (ctx.correctionReference && membershipHash(reference) !== membershipHash(ctx.correctionReference)) fail('CANDIDATE_CORRECTION_CHANGED')
  ctx.correctionReference = reference
  return reference
}
const loadApprovedCompatibility = async (ctx, auditId, expectedDecisionFingerprint) => {
  checkTime(ctx)
  const { readApprovedCommercialCompatibility } = await import('./commercialDocxCompatibilityService.js')
  const observation = ctx.masterReceipt, entry = observation && masterObservations.get(observation)
  let reference
  if (entry && (entry.ctx !== ctx || ctx.args.deps)) fail('CANDIDATE_MASTER_OBSERVATION_INVALID')
  if (entry) entry.active = true
  try {
    const request = { actorUserId: ctx.args.actorUserId, runtimeInstanceId: ctx.args.runtimeInstanceId,
      scopes: ctx.args.scopes, auditId, expectedDecisionFingerprint }
    reference = entry ? await readApprovedCommercialCompatibility(request, observation) : await readApprovedCommercialCompatibility(request)
  } finally { if (entry) entry.active = false }
  checkTime(ctx)
  if (ctx.approvedCompatibilityReference && membershipHash(ctx.approvedCompatibilityReference) !== membershipHash(reference)) fail('CANDIDATE_APPROVED_COMPATIBILITY_CHANGED')
  ctx.approvedCompatibilityReference = JSON.parse(JSON.stringify(reference))
  return ctx.approvedCompatibilityReference
}
const metadata = record => ({ candidateId: record.candidateId, status: record.body.status,
  classification: record.body.classification, authoritative: false, officialUse: false, normalOutputAvailable: false,
  authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false,
  privatePreviewAvailable: true, createdAt: record.body.createdAt, sourceFingerprint: record.body.sourceFingerprint,
  inputFingerprint: record.body.inputFingerprint, renderer: record.body.input.renderer,
  selectedPacks: record.body.input.selectedPacks, artifact: record.body.artifact,
  ...(record.body.contractVersion === MASTER_LINKED_CANDIDATE_VERSION ? { contractVersion: MASTER_LINKED_CANDIDATE_VERSION,
    bodyFingerprint: record.bodyFingerprint, masterBinding: record.body.masterBinding,
    masterBindingFingerprint: membershipHash(record.body.masterBinding) } : {}),
  currentness: 'VERIFIED_AT_READ_OBSERVATION_REVERIFY_BEFORE_NEXT_ACTION' })

const createCandidate = async (args, linked, corrected = false, approved = false) => {
  const parsed = (approved ? approvedMasterLinkedDocxCandidateCreateSchema : corrected ? correctedMasterLinkedDocxCandidateCreateSchema
    : linked ? masterLinkedDocxCandidateCreateSchema : privateDocxCandidateCreateSchema).safeParse(args.payload)
  if (!parsed.success) fail('CANDIDATE_REQUEST_INVALID', 422)
  const payload = parsed.data, ctx = await context(args)
  if (ctx.envelope.sourceFingerprint !== payload.expectedSourceFingerprint) fail('CANDIDATE_SOURCE_CHANGED')
  let master
  if (linked) {
    master = await loadMaster(ctx, payload.masterId, payload.masterVersion)
    if (master.masterReference.bodyFingerprint !== payload.expectedMasterBodyFingerprint) fail('CANDIDATE_EXPECTED_MASTER_CHANGED')
  }
  const correctionReference = corrected ? await loadCorrection(ctx, payload.predecessorCandidateId, payload.expectedPredecessorBodyFingerprint,
    payload.failedReviewExecutionId, payload.expectedFailedReviewResultFingerprint) : null
  const compatibilityReference = approved ? await loadApprovedCompatibility(ctx, payload.compatibilityAuditId, payload.expectedCompatibilityFingerprint) : null
  const approvedProfile = approved ? approvedExpressionProfile(compatibilityReference.version) : null
  const requestFingerprint = approved ? approvedMasterLinkedRequestFingerprint(master.masterReference, approvedProfile.renderer, compatibilityReference)
    : corrected ? correctedMasterLinkedRequestFingerprint(master.masterReference, GOVERNED_PRIVATE_DOCX_CAPABILITY, correctionReference)
    : linked ? masterLinkedRequestFingerprint(master.masterReference, GOVERNED_PRIVATE_DOCX_CAPABILITY)
    : membershipHash({ expectedSourceFingerprint: payload.expectedSourceFingerprint, format: payload.format })
  const existing = await selectRecord(ctx, { requestKey: payload.requestKey })
  if (existing) {
    await verify(existing, ctx, requestFingerprint)
    return { candidate: metadata(existing), idempotent: true }
  }
  let compiled
  if (linked) {
    let reads = 0
    const prepare = approved ? prepareApprovedMeaningMasterDocxRendition : corrected ? (ctx.deps.prepareCorrectedMasterRendition || prepareCorrectedMeaningMasterDocxRendition)
      : (ctx.deps.prepareMasterRendition || prepareMeaningMasterDocxRendition)
    const bridge = await prepare({ actorUserId: args.actorUserId,
      runtimeInstanceId: args.runtimeInstanceId, scopes: args.scopes, masterId: payload.masterId, version: payload.masterVersion,
      ...(corrected ? { correctionReference } : {}),
      ...(approved ? { compatibilityReference } : {}),
      deps: { loadPackContent: ctx.loader, readMaster: async () => ++reads === 1 ? master : loadMaster(ctx, payload.masterId, payload.masterVersion, true) } })
    if (membershipHash(bridge.input?.masterReference) !== membershipHash(master.masterReference)
      || bridge.inputFingerprint !== membershipHash(bridge.input)) fail('CANDIDATE_COMPILED_MASTER_CHANGED')
    const frozen = JSON.parse(JSON.stringify({ input: bridge.input.renditionInput, inputFingerprint: bridge.input.renditionInputFingerprint,
      artifact: bridge.artifact, packageValidation: bridge.packageValidation, masterBinding: masterBindingFromBridge(bridge) }))
    compiled = { ...frozen, classification: bridge.classification, buffer: Buffer.from(bridge.buffer) }
    checkTime(ctx)
  } else compiled = await (ctx.deps.compileCandidate || prepareGovernedPrivateDocxCandidate)({ actorUserId: args.actorUserId,
    runtimeInstanceId: args.runtimeInstanceId, scopes: args.scopes,
    deps: { readSource: async () => ctx.envelope, loadPackContent: ctx.loader } })
  if (compiled.input?.sourceEnvelope?.sourceFingerprint !== ctx.envelope.sourceFingerprint) fail('CANDIDATE_COMPILED_SOURCE_CHANGED')
  // The native reader has no transaction-session propagation. This is an
  // admission observation, never a serializable lock or future eligibility.
  const current = linked ? ctx.masterReceipt.sourceEnvelope : await (ctx.deps.readSource || readOutcomeDocxRenditionSource)({ actorUserId: args.actorUserId,
    runtimeInstanceId: args.runtimeInstanceId, scopes: args.scopes })
  if (current.sourceFingerprint !== ctx.envelope.sourceFingerprint) fail('CANDIDATE_SOURCE_CHANGED')
  await currentPacks(compiled.input, ctx.loader)
  if (corrected) await loadCorrection(ctx, payload.predecessorCandidateId, payload.expectedPredecessorBodyFingerprint,
    payload.failedReviewExecutionId, payload.expectedFailedReviewResultFingerprint)
  if (approved) await loadApprovedCompatibility(ctx, payload.compatibilityAuditId, payload.expectedCompatibilityFingerprint)
  const body = { contractVersion: linked ? MASTER_LINKED_CANDIDATE_VERSION : PRIVATE_DOCX_CANDIDATE_VERSION, candidateId: `docx_candidate_${randomUUID()}`,
    scope: ctx.scope, requestKey: payload.requestKey, requestFingerprint, createdBy: String(args.actorUserId), createdAt: new Date().toISOString(),
    classification: compiled.classification, status: 'PRIVATE_UNREVIEWED', authoritative: false, officialUse: false,
    normalOutputAvailable: false, authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false,
    sourceFingerprint: ctx.envelope.sourceFingerprint, inputFingerprint: compiled.inputFingerprint,
    input: compiled.input, artifact: compiled.artifact, packageValidation: compiled.packageValidation,
    ...(linked ? { masterBinding: compiled.masterBinding } : {}) }
  const pending = { _id: new mongoose.Types.ObjectId(), ...ctx.scope, candidateId: body.candidateId,
    requestKey: body.requestKey, requestFingerprint, bodyFingerprint: membershipHash(body), body, fileBytes: compiled.buffer }
  const session = await ctx.model.db.startSession()
  let saved, replay = false, callbacks = 0
  try {
    await session.withTransaction(async () => {
      const start = Date.now(), budget = () => { if (linked) { checkTime(ctx); if (Date.now() - start > 20000) fail('MASTER_CANDIDATE_ATOMIC_BUDGET', 503) } }
      if (linked && ++callbacks > 2) fail('MASTER_CANDIDATE_RETRY_LIMIT', 503)
      const winner = await selectRecord(ctx, { requestKey: payload.requestKey }, session)
      if (winner) { await verify(winner, ctx, requestFingerprint, session); budget(); saved = winner; replay = true; return }
      const writer = ctx.deps.auditService || auditService
      budget()
      const auditDocument = await writer.log({ actorUserId: args.actorUserId, action: 'OUTCOME_DOCX_CANDIDATE_CREATED',
        resourceType: 'OutcomeDocxRenditionCandidate', resourceId: pending._id, scope: ctx.scope,
        requestId: args.auditRequest?.requestId, diff: privateDocxAuditDiff(pending) }, { session, throwOnError: true })
      const audit = raw(auditDocument)
      budget()
      const record = { ...pending, auditId: audit?._id, auditSignatureVersion: audit?.signatureVersion }
      assertPrivateDocxCandidateRecord(record)
      assertPrivateDocxCandidateAudit(record, audit, row => rawSignature(ctx, row, linked))
      const [created] = await ctx.model.create([record], { session })
      saved = raw(created)
      budget()
    })
  } catch (error) {
    const requestRace = error?.code === 11000 && (linked
      ? error.message?.match(/\bindex:\s+(\S+)\s+dup key:/)?.[1] === PRIVATE_DOCX_CANDIDATE_INDEX
        && membershipHash(Object.entries(error.keyPattern || {})) === membershipHash(Object.entries({ tenantId: 1, customerId: 1, runtimeInstanceId: 1, requestKey: 1 }))
      : error.message?.includes(PRIVATE_DOCX_CANDIDATE_INDEX))
      && membershipHash(Object.keys(error.keyPattern || {}).sort()) === membershipHash(['tenantId', 'customerId', 'runtimeInstanceId', 'requestKey'].sort())
    if (!requestRace) throw error
    const winner = await selectRecord(ctx, { requestKey: payload.requestKey })
    if (!winner) throw error
    await verify(winner, ctx, requestFingerprint); saved = winner; replay = true
  } finally { await session.endSession() }
  if (linked) await loadMaster(ctx, payload.masterId, payload.masterVersion, true)
  // Completion read-back verifies the durable pair and exact file, never rerenders.
  const durable = await selectRecord(ctx, { candidateId: saved.candidateId })
  await verify(durable, ctx, requestFingerprint)
  return { candidate: metadata(durable), idempotent: replay }
}
export const createPrivateDocxCandidate = args => createCandidate(args, false)
export const createMasterLinkedPrivateDocxCandidate = args => createCandidate(args, true)
export const createCorrectedMasterLinkedPrivateDocxCandidate = args => createCandidate(args, true, true)
export const createApprovedMasterLinkedPrivateDocxCandidate = args => createCandidate(args, true, false, true)

export const readPrivateDocxCandidate = async args => {
  const ctx = await context(args)
  const record = await selectRecord(ctx, { candidateId: args.candidateId })
  const buffer = await verify(record, ctx)
  return { candidate: metadata(record), ...(args.includeBytes === true ? { buffer, scope: { ...record.body.scope },
    ...(args.includeInput === true ? { candidateInput: record.body.input } : {}),
    document: { title: record.body.input.model.title, markdown: record.body.input.markdown,
      inputFingerprint: record.body.inputFingerprint } } : {}) }
}

export const listCurrentPrivateDocxCandidates = async args => {
  const ctx = await context(args)
  const records = await ctx.model.find({ ...ctx.scope, 'body.sourceFingerprint': ctx.envelope.sourceFingerprint })
    .select('+fileBytes').sort({ 'body.createdAt': -1, candidateId: 1 }).limit(21).lean()
  if (records.length > 20) fail('CANDIDATE_DISCOVERY_LIMIT')
  for (const record of records) await verify(record, ctx)
  return { scope: ctx.scope, sourceFingerprint: ctx.envelope.sourceFingerprint, candidates: records.map(metadata) }
}
