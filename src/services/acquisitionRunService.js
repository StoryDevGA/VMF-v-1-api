import { validateStoredResearchConfiguration, validateResearchRunConfiguration, researchConfigurationReference,
  PROVIDER_FREE_SEARCH_RUN_VERSION, PROVIDER_FREE_SEARCH_PLANNER_VERSION, validateProviderFreeSearchRun,
  validateProviderFreeSearchReceipt, providerFreeSearchRecordHash, hashProviderFreeSearchValue, hashProviderFreeSearchDescriptor,
  providerFreeSearchStatus, publicProviderFreeSearchReceipt, providerFreeSearchAuditBinding } from './researchConfigurationContract.js'
import { z } from 'zod'
import { prepareTavilyFixtureRequest, prepareTavilySearchFixture } from './publicResearchResponseContract.js'
import { verifyProviderFreeSearchReceiptScope } from '../constants/controlledReplayBindings.js'
import { loadResearchConfigurationForReceipt } from './researchConfigurationService.js'
import { sourceEvidenceHash } from './sourceEvidenceContract.js'
import { createHash, randomUUID } from 'node:crypto'
import { assertControlledReplayNotActivated, validateStoredControlledReplayProvenance,
  assertControlledReplayProvenancePairs, validateControlledReplayRunIdentity } from './controlledReplayContract.js'
import { assertResolvedControlledReplay, assertControlledReplayCurrent, verifyControlledReplayCurrentAuthority,
  buildProviderFreeSearchFixtureInput, verifyPublicResearchFixtureReadScope } from './controlledReplayAcquisitionService.js'
import { PUBLIC_RESEARCH_RUN_VERSION, PUBLIC_RESEARCH_PLANNER_VERSION, initialPublicResearchState,
  publicResearchHash, publicResearchLedgerHash, publicResearchOperationId, publicResearchInputDescriptors,
  validatePublicResearchState, validatePublicResearchRun, buildPublicResearchOutcomes, publicResearchTerminalStatus,
  publicPublicResearchSummary } from './publicResearchContract.js'
import { assertSourceEvidenceMetadataPairs, validateSourceCapture } from './sourceEvidenceContract.js'
import mongoose from 'mongoose'
import env from '../config/env.js'
import User from '../models/User.js'
import Role from '../models/Role.js'
import Customer from '../models/Customer.js'
import Tenant from '../models/Tenant.js'
import { buildUserPermissionsSnapshot, buildLegacyUserPermissionsSnapshot } from './performanceCacheService.js'
import { resolveRolePermissions } from './rolePermissionResolutionService.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import RuntimeAcquisitionRun, { ACQUISITION_RUN_VERSION, ACQUISITION_PLANNER_VERSION, ACQUISITION_TERMINAL_STATES,
  CONTROLLED_ACQUISITION_RUN_VERSION, CONTROLLED_ACQUISITION_PLANNER_VERSION } from '../models/RuntimeAcquisitionRun.js'
import AuditLog from '../models/AuditLog.js'
import auditService from './auditService.js'
import { normalizeDiscoveryInputs, planDiscoveryAcquisition } from './runtimeStateMutationService.js'
import { decodeDocumentBuffer, normalizeDocumentFileName } from './discoveryIntelligenceService.js'
import { getRuntimeInstance, assertRuntimePermission } from './runtimeInstanceService.js'
import { isRuntimeLocked, isRuntimeLifecycleTruthImmutable } from './runtimeActionPolicyService.js'
import { requireCanonicalRuntimeStateVersion } from './runtimeStateVersionService.js'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'
import { assertAcquisitionTerminalProof, assertStoppedRecoveryWitness, STOPPED_WORKER_RECOVERY_REASON,
  ORIGINAL_EXTRACTION_UNCONFIRMED } from './acquisitionReceiptProof.js'

export const ACQUISITION_TRANSACTION_OPTIONS = { timeoutMS: 6000, maxCommitTimeMS: 2000,
  readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }
export const ACQUISITION_CALLER_DEADLINE_MS = 600000
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const terminal = row => ACQUISITION_TERMINAL_STATES.includes(row?.status)
const fail = (reason, message, status = 409, runId) => { throw Object.assign(new Error(message), {
  code: status === 503 ? 'SERVICE_UNAVAILABLE' : status === 404 ? 'NOT_FOUND' : status === 422 ? 'VALIDATION_FAILED' : 'CONFLICT', status, details: { reason, ...(runId ? { runId } : {}) },
}) }
const validatePersistedPublicResearch = (row, validate) => {
  try { return validate() }
  catch (error) {
    if (row.contractVersion === PUBLIC_RESEARCH_RUN_VERSION
      && ['PUBLIC_RESEARCH_PLAN_UNVERIFIED', 'PUBLIC_RESEARCH_RECEIPT_UNVERIFIED'].includes(error?.details?.reason))
      fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Stored Public Research receipt could not be verified.', 503, row.runId)
    throw error
  }
}
const scopeFor = runtime => Object.fromEntries(['customerId', 'tenantId'].map(key => [key, new mongoose.Types.ObjectId(runtime[key])])
  .concat([['runtimeInstanceId', new mongoose.Types.ObjectId(runtime._id || runtime.id)]]))
const documentHash = input => createHash('sha256').update(decodeDocumentBuffer(input)).digest('hex')
const queryBudget = deadline => {
  const remaining = deadline - Date.now()
  if (remaining <= 0) fail('ACQUISITION_READ_DEADLINE', 'Acquisition history could not be verified in time. Refresh.', 503)
  return { timeoutMS: remaining, maxTimeMS: Math.min(2000, remaining) }
}
const identity = context => ({ ...context.scope, runId: context.runId, actorUserId: new mongoose.Types.ObjectId(context.actorUserId),
  executionAttemptId: context.executionAttemptId, requestFingerprint: context.requestFingerprint })

export const acquisitionRequestFingerprint = ({ payload = {}, actionKey, actorUserId, controlledContext }) => {
  if (payload.publicResearch) return snapshotHash({ contractVersion: PUBLIC_RESEARCH_RUN_VERSION, actionKey,
    actorUserId: String(actorUserId), expectedUpdatedAt: payload.expectedUpdatedAt, acquisitionProfile: payload.acquisitionProfile,
    publicResearch: payload.publicResearch, researchConfiguration: payload.researchConfiguration,
    controlledReplay: payload.controlledReplay || null, predecessorRunId: payload.predecessorRunId || null,
    predecessorExecutionAttemptId: payload.predecessorExecutionAttemptId || null })
  if (controlledContext !== undefined) {
    const context = assertResolvedControlledReplay(controlledContext)
    return snapshotHash({ contractVersion: CONTROLLED_ACQUISITION_RUN_VERSION, actionKey, actorUserId: String(actorUserId),
      expectedUpdatedAt: payload.expectedUpdatedAt, acquisitionProfile: payload.acquisitionProfile || 'STANDARD',
      descriptor: context.descriptor, native: context.native,
      ...(payload.predecessorRunId ? { researchRetry: { predecessorRunId: payload.predecessorRunId,
        predecessorExecutionAttemptId: payload.predecessorExecutionAttemptId } } : {}),
      ...(payload.researchConfiguration ? { researchConfiguration: payload.researchConfiguration } : {}) })
  }
  assertControlledReplayNotActivated(payload)
  return snapshotHash({
  actionKey, actorUserId: String(actorUserId), expectedUpdatedAt: payload.expectedUpdatedAt,
  inputs: payload.inputs === undefined ? { omitted: true } : normalizeDiscoveryInputs(payload.inputs).normalizedInputs,
  acquisitionProfile: payload.acquisitionProfile === undefined ? { omitted: true } : payload.acquisitionProfile,
  documents: (payload.documentSources || []).map((input, inputIndex) => ({ inputIndex,
    fileName: normalizeDocumentFileName(input.fileName), mimeType: input.mimeType || '', assetType: input.assetType || 'CUSTOMER_DOCUMENT',
    sizeBytes: input.sizeBytes ?? null, contentHash: documentHash(input) })),
  predecessorRunId: payload.predecessorRunId || null,
  })
}

const cancellationDescriptor = (row, eligible = false) => ({ eligible, executionAttemptId: row.executionAttemptId,
  ...(row.status === 'CANCELLED' ? { stage: row.startedAt ? 'RUNNING' : 'QUEUED', workerStopConfirmed: false } : {}) })
const cancellationEligible = (row, runtime, actorUserId) => Boolean(row.researchConfiguration && row.active
  && ['QUEUED', 'RUNNING'].includes(row.status) && String(row.actorUserId) === String(actorUserId)
  && runtime.status === 'ACTIVE' && !isRuntimeLocked({ runtimeInstance: runtime }) && !isRuntimeLifecycleTruthImmutable(runtime.framework_state)
  && row.basisStateVersion === runtime.stateVersion && new Date(row.basisUpdatedAt).getTime() === new Date(runtime.updatedAt).getTime())
const publicResearchCancellationCurrent = async (row, runtime, args, session) => {
  const { runtime: current, configuration } = await loadResearchConfigurationForReceipt(args, session)
  return Boolean(configuration
    && String(current.id || current._id) === String(runtime.id || runtime._id)
    && configuration.basisStateVersion === runtime.stateVersion
    && configuration.basisUpdatedAt === new Date(runtime.updatedAt).toISOString()
    && snapshotHash(researchConfigurationReference(configuration))
      === snapshotHash(researchConfigurationReference(validateResearchRunConfiguration(row))))
}
export const publicAcquisitionRun = (row, options = {}) => ({
  ...(row.contractVersion === PUBLIC_RESEARCH_RUN_VERSION ? { plannerVersion: row.plannerVersion,
    publicResearch: publicPublicResearchSummary(row) } : {}),
  contractVersion: row.contractVersion, runId: row.runId, requestKey: row.requestKey, executionAttemptId: row.executionAttemptId,
  scope: { customerId: String(row.customerId), tenantId: String(row.tenantId), runtimeInstanceId: String(row.runtimeInstanceId),
    runtimeInstanceKey: row.runtimeInstanceKey, rootRuntimeInstanceKey: row.rootRuntimeInstanceKey },
  actorUserId: String(row.actorUserId), authority: row.authority, actionKey: row.actionKey, acquisitionProfile: row.acquisitionProfile,
  basisStateVersion: row.basisStateVersion, basisUpdatedAt: row.basisUpdatedAt,
  ...(row.contractVersion === CONTROLLED_ACQUISITION_RUN_VERSION
    ? { controlledReplayProvenance: validateControlledReplayRunIdentity(row) } : {}),
  ...(row.researchConfiguration !== undefined ? { researchConfiguration: [PROVIDER_FREE_SEARCH_RUN_VERSION, PUBLIC_RESEARCH_RUN_VERSION].includes(row.contractVersion)
    ? researchConfigurationReference(validateResearchRunConfiguration(row)) : validateResearchRunConfiguration(row) } : {}),
  ...(row.contractVersion === PROVIDER_FREE_SEARCH_RUN_VERSION ? { receiptRecorded: row.receiptRecorded,
    providerFreeSearch: publicProviderFreeSearchReceipt(validateProviderFreeSearchRun(row)) } : {}),
  ...(row.researchConfiguration && row.contractVersion !== PROVIDER_FREE_SEARCH_RUN_VERSION ? { cancellation: cancellationDescriptor(row) } : {}),
  status: row.status, createdAt: row.createdAt, startedAt: row.startedAt, completedAt: row.completedAt,
  ...(row.predecessorRunId ? { predecessorRunId: row.predecessorRunId } : {}),
  ...(row.predecessorExecutionAttemptId ? { predecessorExecutionAttemptId: row.predecessorExecutionAttemptId } : {}),
  ...(terminal(row) ? { canonicalSaved: row.canonicalSaved, outputStateVersion: row.outputStateVersion,
    outcomes: row.outcomes.map(({ kind, inputIndex, status, sourceId, evidenceObjectCount, reason }) =>
      ({ kind, inputIndex, status, ...(sourceId ? { sourceId } : {}), evidenceObjectCount, ...(reason ? { reason } : {}) })),
    ...(row.reason ? { reason: row.reason } : {}),
    audit: { admissionId: String(row.admissionAuditId), ...(row.startAuditId ? { startId: String(row.startAuditId) } : {}), terminalId: String(row.terminalAuditId),
      ...(row.saveAuditId ? { saveId: String(row.saveAuditId) } : {}) },
  } : { recovery: 'Execution outcome is unconfirmed. Refresh and inspect this Run; do not start another acquisition.' }),
  ...(row.reason ? { reason: row.reason } : {}), ...options,
})

const requireIndexes = async deadline => {
  if (mongoose.connection.readyState !== 1) fail('ACQUISITION_STORAGE_UNAVAILABLE', 'Acquisition execution storage is unavailable.', 503)
  let indexes
  try { indexes = await RuntimeAcquisitionRun.collection.listIndexes(queryBudget(deadline)).toArray() }
  catch { fail('ACQUISITION_STORAGE_UNAVAILABLE', 'Acquisition execution storage has not been verified.', 503) }
  for (const [key, options] of RuntimeAcquisitionRun.schema.indexes()) {
    const found = indexes.find(index => index.name === options.name)
    if (!found || JSON.stringify(found.key) !== JSON.stringify(key) || Boolean(found.unique) !== Boolean(options.unique)
      || JSON.stringify(found.partialFilterExpression || null) !== JSON.stringify(options.partialFilterExpression || null))
      fail('ACQUISITION_INDEX_REQUIRED', 'Acquisition execution indexes have not been verified.', 503)
  }
}
const recordedAudit = async ({ context, phase, session, extra = {} }) => {
  const controlledDescriptor = context.controlledContext ? assertResolvedControlledReplay(context.controlledContext).descriptor
    : context.row?.contractVersion === CONTROLLED_ACQUISITION_RUN_VERSION ? validateControlledReplayRunIdentity(context.row) : undefined
  const audit = await auditService.log({ actorUserId: context.actorUserId,
    action: auditService.AUDIT_ACTIONS.RUNTIME_ACQUISITION_RECORDED, resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
    resourceId: context.scope.runtimeInstanceId, requestId: context.auditRequest?.requestId,
    scope: { ...context.scope, runtimeInstanceKey: context.runtime.runtimeInstanceKey },
    diff: { runId: context.runId, executionAttemptId: context.executionAttemptId, phase,
      requestFingerprint: context.requestFingerprint,
      ...(context.payload?.predecessorExecutionAttemptId || context.row?.predecessorExecutionAttemptId ? { researchRetry: {
        predecessorRunId: context.payload?.predecessorRunId || context.row.predecessorRunId,
        predecessorExecutionAttemptId: context.payload?.predecessorExecutionAttemptId || context.row.predecessorExecutionAttemptId } } : {}),
      ...(context.researchConfiguration ? { researchConfiguration: researchConfigurationReference(context.researchConfiguration) } : {}),
      ...(context.providerFreeSearch ? { providerFreeSearch: providerFreeSearchAuditBinding(context.providerFreeSearch) } : {}),
      ...(context.publicResearchExecution || context.row?.contractVersion === PUBLIC_RESEARCH_RUN_VERSION ? {
        publicResearchPlanHash: (context.row?.publicResearch || context.publicResearch)?.plan.planHash,
        publicResearchControlledDescriptorHash: controlledDescriptor ? snapshotHash(controlledDescriptor)
          : context.row?.controlledReplayProvenance ? snapshotHash(context.row.controlledReplayProvenance) : null,
      } : {}),
      ...(controlledDescriptor && !context.publicResearchExecution && context.row?.contractVersion !== PUBLIC_RESEARCH_RUN_VERSION ? { controlledRun: { contractVersion: CONTROLLED_ACQUISITION_RUN_VERSION,
        plannerVersion: CONTROLLED_ACQUISITION_PLANNER_VERSION,
        descriptorHash: snapshotHash(controlledDescriptor) } } : {}), ...extra },
  }, { session, throwOnError: true })
  if (!audit?._id || !audit.signature || !audit.signatureVersion)
    fail('ACQUISITION_AUDIT_UNAVAILABLE', 'Acquisition execution audit could not be verified.', 503, context.runId)
  return audit
}

// Driver ABORTED state is not acknowledgement. The raw command respects remaining CSOT.
export const withAcquisitionTransaction = async (work, context) => {
  const session = await mongoose.startSession()
  const tracking = { commitPossible: false, abortConfirmed: false }
  if (context) context.transaction = tracking
  try {
    return await session.withTransaction(async () => {
      try {
        const result = await work(session)
        tracking.commitPossible = true
        return result
      } catch (error) {
        if (!tracking.commitPossible && session.inTransaction()) {
          try {
            const ack = await mongoose.connection.db.admin().command({ abortTransaction: 1 }, { session, timeoutMS: 6000 })
            tracking.abortConfirmed = ack.ok === 1
          } catch (abortError) { tracking.abortConfirmed = abortError.code === 251 }
        }
        throw error
      }
    }, ACQUISITION_TRANSACTION_OPTIONS)
  } finally { await session.endSession() }
}

const readExact = async (filter, deadline = Date.now() + 6000, session = null) => {
  const budget = queryBudget(deadline)
  try { return await RuntimeAcquisitionRun.collection.findOne(filter,
    session ? { session, maxTimeMS: budget.maxTimeMS } : { readConcern: { level: 'majority' }, ...budget }) }
  catch (error) {
    if (error.status) throw error
    fail('ACQUISITION_READ_UNAVAILABLE', 'Acquisition receipt could not be verified. Refresh and inspect its Run.', 503, filter.runId)
  }
}
const verifiedAudit = async (row, auditId, phase, deadline, session = null) => {
  const budget = queryBudget(deadline)
  const audit = await AuditLog.findOne({ _id: auditId, resourceId: row.runtimeInstanceId, actorUserId: row.actorUserId,
    action: auditService.AUDIT_ACTIONS.RUNTIME_ACQUISITION_RECORDED }).setOptions(session ? { maxTimeMS: budget.maxTimeMS, session } : budget)
  if (!audit || !audit.verifySignature() || audit.diff?.runId !== row.runId
    || audit.diff.executionAttemptId !== row.executionAttemptId || audit.diff.phase !== phase
    || audit.diff.requestFingerprint !== row.requestFingerprint)
    fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Acquisition receipt audit could not be verified. Refresh.', 503, row.runId)
  if (row.contractVersion === CONTROLLED_ACQUISITION_RUN_VERSION
    && (audit.diff.controlledRun === undefined || snapshotHash(audit.diff.controlledRun) !== snapshotHash({ contractVersion: row.contractVersion,
      plannerVersion: row.plannerVersion, descriptorHash: snapshotHash(validateStoredControlledReplayProvenance(row.controlledReplayProvenance)) }))
    )
    fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Controlled execution audit binding changed.', 503, row.runId)
  if (row.researchConfiguration !== undefined || audit.diff.researchConfiguration !== undefined) {
    const record = validateResearchRunConfiguration(row)
    if (snapshotHash(researchConfigurationReference(record) || null) !== snapshotHash(audit.diff.researchConfiguration || null))
      fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Research configuration audit binding changed.', 503, row.runId)
  }
  if (row.contractVersion === PROVIDER_FREE_SEARCH_RUN_VERSION) {
    if (snapshotHash(audit.diff.providerFreeSearch) !== snapshotHash(providerFreeSearchAuditBinding(validateProviderFreeSearchRun(row))))
      fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Provider-free receipt audit binding changed.', 503, row.runId)
  } else if (audit.diff.providerFreeSearch !== undefined) fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Unexpected receipt contract.', 503, row.runId)
  if (row.contractVersion === PUBLIC_RESEARCH_RUN_VERSION) {
    const state = validatePersistedPublicResearch(row, () => validatePublicResearchState(row.publicResearch, row))
    if (audit.diff.publicResearchPlanHash !== state.plan.planHash
      || audit.diff.publicResearchControlledDescriptorHash !== (row.controlledReplayProvenance ? snapshotHash(row.controlledReplayProvenance) : null))
      fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Public Research plan audit could not be verified.', 503, row.runId)
  } else if (audit.diff.publicResearchPlanHash !== undefined || audit.diff.publicResearchReceiptHash !== undefined)
    fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Unexpected Public Research receipt.', 503, row.runId)
  const lineage = row.predecessorExecutionAttemptId ? { predecessorRunId: row.predecessorRunId, predecessorExecutionAttemptId: row.predecessorExecutionAttemptId } : null
  if (snapshotHash(lineage) !== snapshotHash(audit.diff.researchRetry || null))
    fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Research retry lineage changed.', 503, row.runId)
  return audit
}
const verifyPublicResearchLedger = async (row, deadline, session = null) => {
  if (row.contractVersion !== PUBLIC_RESEARCH_RUN_VERSION) return
  const state = validatePersistedPublicResearch(row, () => validatePublicResearchState(row.publicResearch, row))
  if (state.ledgerSequence) {
    const audit = await verifiedAudit(row, state.ledgerAuditId, 'RUNNING', deadline, session)
    if (audit.signatureVersion !== state.ledgerAuditSignatureVersion || audit.diff.publicResearchLedgerHash !== state.ledgerHash
      || audit.diff.publicResearchLedgerSequence !== state.ledgerSequence
      || audit.diff.publicResearchPreviousLedgerHash !== state.previousLedgerHash)
      fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Public Research operation ledger could not be verified.', 503, row.runId)
  }
  // The existing resource/time index scopes this bounded query. Sequence, rather
  // than exclusive timestamps, also detects rollback between same-ms audits.
  const later = await AuditLog.findOne({ resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
    resourceId: row.runtimeInstanceId, action: auditService.AUDIT_ACTIONS.RUNTIME_ACQUISITION_RECORDED,
    'diff.runId': row.runId, 'diff.publicResearchLedgerSequence': { $gt: state.ledgerSequence } })
    .session(session).maxTimeMS(queryBudget(deadline).maxTimeMS)
  if (later) fail('ACQUISITION_RECEIPT_UNVERIFIED', 'A later Public Research operation receipt exists.', 503, row.runId)
}
const verifyTerminal = async (row, deadline, session = null) => {
  if (row.contractVersion === PUBLIC_RESEARCH_RUN_VERSION) {
    validatePersistedPublicResearch(row, () => validatePublicResearchRun(row))
    await verifyPublicResearchLedger(row, deadline, session)
    await verifiedAudit(row, row.admissionAuditId, 'QUEUED', deadline, session)
    if (row.startedAt) await verifiedAudit(row, row.startAuditId, 'RUNNING', deadline, session)
  }
  const audit = await verifiedAudit(row, row.terminalAuditId, row.status, deadline, session)
  if (row.contractVersion === PROVIDER_FREE_SEARCH_RUN_VERSION) {
    await verifiedAudit(row, row.admissionAuditId, 'QUEUED', deadline, session)
    await verifiedAudit(row, row.startAuditId, 'RUNNING', deadline, session)
  }
  if (row.status === 'CANCELLED') {
    await verifiedAudit(row, row.admissionAuditId, 'QUEUED', deadline, session)
    if (row.startedAt) await verifiedAudit(row, row.startAuditId, 'RUNNING', deadline, session)
  }
  if (row.reason === STOPPED_WORKER_RECOVERY_REASON) {
    const admission = await verifiedAudit(row, row.admissionAuditId, 'QUEUED', deadline, session)
    const start = await verifiedAudit(row, row.startAuditId, 'RUNNING', deadline, session)
    if (admission.requestId !== audit.diff?.recoveryWitness?.originalRequestId || start.requestId !== admission.requestId)
      fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Original recovery request audit could not be verified.', 503, row.runId)
  }
  let save
  if (row.canonicalSaved) {
    // The terminal audit binds the signature returned by the same save transaction.
    // Read only its anchor; do not hydrate the legacy before/after runtime audit payload.
    const budget = queryBudget(deadline)
    save = await AuditLog.findOne({ _id: row.saveAuditId, resourceId: row.runtimeInstanceId, actorUserId: row.actorUserId })
      .select('action signature signatureVersion actorUserId resourceId').setOptions(session ? { maxTimeMS: budget.maxTimeMS, session } : budget)
  }
  return assertAcquisitionTerminalProof(row, audit, save)
}

export const assertFreshPublicResearchPermission = async ({ actorUserId, scopes, runtime, permission = 'VMF_UPDATE', session = null, writeFence = false }) => {
  const user = await User.findById(actorUserId).select('name email isActive memberships tenantMemberships vmfGrants __v')
    .session(session).maxTimeMS(2000).lean()
  if (!user || user.isActive !== true) fail('PUBLIC_RESEARCH_AUTHORITY_UNAVAILABLE', 'Current research authority is unavailable.', 403)
  const fresh = { ...scopes, ...buildLegacyUserPermissionsSnapshot(user), resolvedPermissions: await resolveRolePermissions({ user,
    roleModel: { find: filter => Role.find(filter).session(session).maxTimeMS(2000) } }) }
  await assertRuntimePermission({ actorUserId, scopes: fresh, customerId: runtime.customerId, tenantId: runtime.tenantId,
    permission, session, maxTimeMS: 2000 })
  const customer = await Customer.findById(runtime.customerId).select('status __v').session(session).maxTimeMS(2000).lean()
  const tenant = await Tenant.findById(runtime.tenantId).select('status customerId __v').session(session).maxTimeMS(2000).lean()
  if (customer?.status !== 'ACTIVE' || tenant?.status !== 'ENABLED' || String(tenant.customerId) !== String(customer._id))
    fail('PUBLIC_RESEARCH_AUTHORITY_UNAVAILABLE', 'Current research authority is unavailable.', 403)
  if (writeFence) {
    if (!session?.inTransaction()) fail('PUBLIC_RESEARCH_TRANSACTION_REQUIRED', 'Research authority requires its transaction.', 503)
    const keys = [...new Set([...(user.memberships || []), ...(user.tenantMemberships || [])].flatMap(value => value.roles || [])
      .map(value => String(value).trim().toUpperCase()))]
    if (keys.length > 100) fail('PUBLIC_RESEARCH_AUTHORITY_UNAVAILABLE', 'Current research authority is unavailable.', 403)
    const roles = await Role.find({ key: { $in: keys } }).select('_id __v').session(session).maxTimeMS(2000).lean()
    for (const [model, value] of [[User, user], [Customer, customer], [Tenant, tenant], ...roles.map(role => [Role, role])]) {
      if (value.__v !== undefined && (!Number.isSafeInteger(value.__v) || value.__v < 0))
        fail('PUBLIC_RESEARCH_AUTHORITY_CHANGED', 'Research authority could not be fenced.', 503)
      const changed = await model.collection.updateOne({ _id: value._id,
        __v: value.__v === undefined ? { $exists: false } : value.__v }, { $inc: { __v: 1 } }, { session, maxTimeMS: 2000 })
      if (changed.modifiedCount !== 1) fail('PUBLIC_RESEARCH_AUTHORITY_CHANGED', 'Research authority changed before dispatch.', 409)
    }
    const fenced = await RuntimeInstance.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(runtime._id || runtime.id)),
      customerId: new mongoose.Types.ObjectId(String(runtime.customerId)), tenantId: new mongoose.Types.ObjectId(String(runtime.tenantId)),
      stateVersion: runtime.stateVersion, updatedAt: new Date(runtime.updatedAt), status: 'ACTIVE' }, { $inc: { __v: 1 } }, { session, maxTimeMS: 2000 })
    if (fenced.modifiedCount !== 1) fail('ACQUISITION_RUN_STALE', 'The revision changed before dispatch.', 409)
  }
  return fresh
}

// The caller has already performed its actual authorization/entitlement checks.
// Lookup before resolving defaults or checking current write lifecycle enables honest replay.
export const lookupAcquisitionRequest = async ({ runtimeInstance, payload = {}, actorUserId, actionKey, auditRequest, controlledContext }) => {
  if (controlledContext === undefined) assertControlledReplayNotActivated(payload)
  else {
    const controlled = assertResolvedControlledReplay(controlledContext)
    validateStoredControlledReplayProvenance(controlled.descriptor, { ...scopeFor(runtimeInstance),
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey })
    if (controlled.actorUserId !== String(actorUserId) || payload.controlledReplay?.bindingId !== controlled.descriptor.binding.bindingId)
      fail('CONTROLLED_REPLAY_CONTRACT_INVALID', 'Controlled execution identity changed.')
  }
  const deadline = Date.now() + 6000
  await requireIndexes(deadline)
  const requestKey = payload.requestKey || randomUUID()
  if (!uuid.test(requestKey) || payload.predecessorRunId && !uuid.test(payload.predecessorRunId))
    fail('ACQUISITION_REQUEST_INVALID', 'A valid acquisition request identity is required.', 422)
  const context = { runtime: runtimeInstance, scope: scopeFor(runtimeInstance), actorUserId, actionKey, auditRequest,
    requestKey, requestFingerprint: acquisitionRequestFingerprint({ payload, actionKey, actorUserId, controlledContext }),
    runId: randomUUID(), executionAttemptId: randomUUID(), payload, ...(controlledContext ? { controlledContext } : {}) }
  const existing = await readExact({ ...context.scope, requestKey }, deadline)
  if (existing) {
    if (existing.requestFingerprint !== context.requestFingerprint)
      fail('ACQUISITION_REQUEST_CONFLICT', 'This request identity belongs to different inputs, authority or basis.', 409, existing.runId)
    if (!terminal(existing)) fail('ACQUISITION_RUN_IN_PROGRESS', 'This acquisition outcome is not yet confirmed. Inspect its Run before retrying.', 409, existing.runId)
    await verifyTerminal(existing, deadline)
    if (controlledContext && (existing.contractVersion !== CONTROLLED_ACQUISITION_RUN_VERSION
      || snapshotHash(existing.controlledReplayProvenance) !== snapshotHash(controlledContext.descriptor)))
      fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Controlled retry descriptor changed.', 503, existing.runId)
    context.replay = publicAcquisitionRun(existing, { replay: true, requiresRefresh: true })
  }
  return context
}
const assertResearchRunActive = async (context, session = null) => {
  if (!context?.researchConfiguration) return
  const row = await RuntimeAcquisitionRun.collection.findOne({ ...identity(context), status: 'RUNNING', active: true }, { session, maxTimeMS: 2000 })
  if (!row) fail('ACQUISITION_RUN_NOT_ACTIVE', 'This Run no longer owns an evidence save. Read its receipt.', 409, context.runId)
}
const publicResearchAuditFields = row => row.contractVersion === PUBLIC_RESEARCH_RUN_VERSION ? {
  publicResearchReceiptHash: row.publicResearch.ledgerHash,
  publicResearchLedgerSequence: row.publicResearch.ledgerSequence,
} : {}

// Read the row and its audit population from one snapshot: an ordinary worker
// advance must not look like a rolled-back ledger to a concurrent reader.
const withPublicResearchSnapshot = async work => {
  const session = await mongoose.startSession()
  try { return await session.withTransaction(() => work(session), ACQUISITION_TRANSACTION_OPTIONS) }
  finally { await session.endSession() }
}
const verifyPublicResearchRow = async (row, deadline, session) => {
  if (!row || row.contractVersion !== PUBLIC_RESEARCH_RUN_VERSION)
    fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Public Research receipt is unavailable.', 503, row?.runId)
  if (terminal(row)) return verifyTerminal(row, deadline, session)
  validatePersistedPublicResearch(row, () => validatePublicResearchRun(row))
  await verifyPublicResearchLedger(row, deadline, session)
  await verifiedAudit(row, row.admissionAuditId, 'QUEUED', deadline, session)
  if (row.startedAt) await verifiedAudit(row, row.startAuditId, 'RUNNING', deadline, session)
  return row
}
const activePublicResearchRow = async (context, session) => {
  const row = await readExact(identity(context), Date.now() + 6000, session)
  await verifyPublicResearchRow(row, Date.now() + 6000, session)
  if (row.status !== 'RUNNING' || !row.active)
    fail('ACQUISITION_RUN_NOT_ACTIVE', 'This Run no longer owns a research operation.', 409, context.runId)
  return row
}
export const assertPublicResearchOperationCurrent = async context => {
  const row = await withAcquisitionTransaction(async session => {
    const current = await activePublicResearchRow(context, session)
    await assertCurrentControl({ ...context, row: current }, session)
    return current
  })
  context.row = row
}
const writePublicResearchLedger = async (context, transform, requireCurrent) => {
  const expected = context.row?.publicResearch
  if (!expected || context.row.contractVersion !== PUBLIC_RESEARCH_RUN_VERSION)
    fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Research operation ownership is unavailable.', 503, context.runId)
  let target
  try {
    await withAcquisitionTransaction(async session => {
      const row = await activePublicResearchRow(context, session)
      if (row.publicResearch.ledgerSequence !== expected.ledgerSequence || row.publicResearch.ledgerHash !== expected.ledgerHash)
        fail('ACQUISITION_RUN_STALE', 'Research operation ownership changed.', 409, context.runId)
      const local = { ...context, row }
      if (requireCurrent) await assertCurrentControl(local, session)
      const state = structuredClone(row.publicResearch)
      transform(state, row)
      state.previousLedgerHash = row.publicResearch.ledgerHash
      state.ledgerSequence++
      state.ledgerHash = publicResearchLedgerHash(state)
      const audit = await recordedAudit({ context: local, phase: 'RUNNING', session, extra: {
        publicResearchLedgerSequence: state.ledgerSequence, publicResearchLedgerHash: state.ledgerHash,
        publicResearchPreviousLedgerHash: state.previousLedgerHash } })
      state.ledgerAuditId = String(audit._id)
      state.ledgerAuditSignatureVersion = audit.signatureVersion
      const next = { ...row, publicResearch: state }
      validatePublicResearchRun(next)
      await new RuntimeAcquisitionRun(next).validate()
      const changed = await RuntimeAcquisitionRun.collection.updateOne({ ...identity(context), status: 'RUNNING', active: true,
        'publicResearch.ledgerSequence': expected.ledgerSequence, 'publicResearch.ledgerHash': expected.ledgerHash },
      { $set: { publicResearch: state } }, { session, maxTimeMS: 2000 })
      if (changed.modifiedCount !== 1) fail('ACQUISITION_RUN_STALE', 'Research operation ownership changed.', 409, context.runId)
      target = { sequence: state.ledgerSequence, hash: state.ledgerHash }
    }, context)
  } catch (error) {
    // A definitely aborted pre-dispatch admission may expose its bounded refusal.
    // A response which cannot be proved durable must never authorize another send.
    if (requireCurrent && !target && context.transaction?.abortConfirmed) throw error
  }
  let row
  try {
    row = await withPublicResearchSnapshot(async session => {
      const current = await readExact(identity(context), Date.now() + 6000, session)
      await verifyPublicResearchRow(current, Date.now() + 6000, session)
      return current
    })
  } catch { /* The result remains unconfirmed; no response or continuation is invented. */ }
  if (!target || !row || row.publicResearch.ledgerSequence !== target.sequence || row.publicResearch.ledgerHash !== target.hash) {
    context.publicResearchUnconfirmed = true
    context.extractionSettled = false
    fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Research operation recording could not be confirmed. Inspect its Run.', 503, context.runId)
  }
  context.row = row
  return row
}
export const reservePublicResearchOperation = async (context, input) => {
  const row = await writePublicResearchLedger(context, (state, current) => {
    if (!input || Object.keys(input).some(key => !['category', 'inputIndex', 'requestDescriptor'].includes(key))
      || state.operations.some(operation => operation.phase !== 'RECORDED' || !['SUCCEEDED', 'EMPTY'].includes(operation.outcome)))
      fail('PUBLIC_RESEARCH_OPERATION_INVALID', 'Research operation cannot be dispatched.', 409, context.runId)
    const ordinal = state.operations.length, requestHash = publicResearchHash(input.requestDescriptor)
    const operation = { ...input, ordinal, requestHash, reservedCostMicros: input.category === 'SEARCH'
      ? state.plan.limits.searchRequestCostMicros : input.category === 'REGISTRY' ? state.plan.limits.registryRequestCostMicros : 0,
    phase: 'DISPATCHING', startedAt: new Date().toISOString(), receipt: null }
    operation.operationId = publicResearchOperationId(current, operation)
    state.operations.push(operation)
  }, true)
  return row.publicResearch.operations.at(-1)
}
export const recordPublicResearchOperation = async (context, ordinal, patch) => {
  await writePublicResearchLedger(context, state => {
    const operation = state.operations[ordinal]
    if (!Number.isInteger(ordinal) || ordinal !== state.operations.length - 1 || operation?.phase !== 'DISPATCHING'
      || !patch || Object.keys(patch).some(key => !['outcome', 'failureReason', 'receipt', 'mapping', 'capture'].includes(key)))
      fail('PUBLIC_RESEARCH_OPERATION_INVALID', 'Research response ownership changed.', 409, context.runId)
    state.operations[ordinal] = { ...operation, ...patch, phase: 'RECORDED', completedAt: new Date().toISOString() }
  }, false)
}
export const assertAcquisitionResearchConfigurationCurrent = async (context, session, requireRunning = false) => {
  if (requireRunning && context?.controlledContext) await verifyControlledReplayCurrentAuthority(context.controlledContext, context.runtime, session)
  if (!context?.researchConfiguration) return
  if (requireRunning) await assertResearchRunActive(context, session)
  const row = await RuntimeInstance.collection.findOne({ _id: context.scope.runtimeInstanceId,
    customerId: context.scope.customerId, tenantId: context.scope.tenantId }, { session, maxTimeMS: 2000,
    projection: { researchConfiguration: 1, customerId: 1, tenantId: 1, runtimeInstanceKey: 1, stateVersion: 1, updatedAt: 1 } })
  const record = row && validateStoredResearchConfiguration(row.researchConfiguration, row)
  if (!record || snapshotHash(researchConfigurationReference(record)) !== snapshotHash(researchConfigurationReference(context.researchConfiguration))
    || requireCanonicalRuntimeStateVersion(row) !== context.basisStateVersion
    || new Date(row.updatedAt).getTime() !== new Date(context.payload.expectedUpdatedAt).getTime())
    fail('RESEARCH_CONFIGURATION_STALE', 'Research configuration changed before the controlled save.', 409, context.runId)
  if (context.publicResearchExecution && requireRunning) {
    await assertCurrentControl(context, session)
  }
}
const assertCurrentControl = async (context, session) => {
  await assertAcquisitionResearchConfigurationCurrent(context, session)
  const row = await RuntimeInstance.collection.findOne({ _id: context.scope.runtimeInstanceId,
    customerId: context.scope.customerId, tenantId: context.scope.tenantId }, { session, maxTimeMS: 2000,
    projection: { stateVersion: 1, updatedAt: 1, status: 1, executionStatus: 1, lockedAt: 1,
      'framework_state.lock': 1, 'framework_state.lifecycle': 1,
      ...(context.controlledContext || context.publicResearchExecution ? { customerId: 1, tenantId: 1, runtimeInstanceKey: 1, controlledReplayIsolation: 1, revision: 1 } : {}) } })
  if (!row || requireCanonicalRuntimeStateVersion(row) !== context.basisStateVersion
    || new Date(row.updatedAt).getTime() !== new Date(context.payload.expectedUpdatedAt).getTime())
    fail('ACQUISITION_RUN_STALE', 'The revision changed before acquisition. Refresh its current basis.', 409, context.runId)
  if (row.status !== 'ACTIVE' || ['RUNNING', 'VALIDATING', 'COMPLETE', 'ERROR'].includes(row.executionStatus)
    || isRuntimeLocked({ runtimeInstance: row }) || isRuntimeLifecycleTruthImmutable(row.framework_state))
    fail('ACQUISITION_RUN_LOCKED', 'This revision does not permit acquisition. Inspect or open an editable revision.', 409, context.runId)
  if (context.controlledContext) {
    assertControlledReplayCurrent(context.controlledContext, row, context.payload)
    await verifyControlledReplayCurrentAuthority(context.controlledContext, { ...row, _id: context.scope.runtimeInstanceId }, session)
  }
  if (context.publicResearchExecution && !context.recoveryWitness) {
    await assertFreshPublicResearchPermission({ actorUserId: context.actorUserId, scopes: context.scopes, runtime: row, session, writeFence: true })
    await context.publicResearchExecution.assertCurrent({ ...row, _id: context.scope.runtimeInstanceId }, session)
    if (context.publicResearchExecution.assertActionAvailable) await context.publicResearchExecution.assertActionAvailable()
  }
}
export const startAcquisitionRun = async (context, inputs) => {
  const controlled = context.controlledContext ? assertResolvedControlledReplay(context.controlledContext) : undefined
  if (controlled) assertControlledReplayCurrent(controlled, context.runtime, context.payload)
  const combined = context.publicResearchExecution
  if (combined) context.publicResearch = initialPublicResearchState(combined.plan)
  const plan = combined ? { profile: context.researchConfiguration.coverage }
    : controlled ? { profile: context.payload.acquisitionProfile || 'STANDARD' }
    : planDiscoveryAcquisition({ inputs, acquisitionProfile: context.payload.acquisitionProfile,
      previousEvidencePack: context.runtime.framework_state?.evidence_pack || {} })
  context.plan = plan
  context.basisStateVersion = requireCanonicalRuntimeStateVersion(context.runtime)
  const documents = (context.payload.documentSources || []).map((input, inputIndex) =>
    ({ kind: 'DOCUMENT', inputIndex, contentHash: documentHash(input) }))
  const descriptors = combined ? publicResearchInputDescriptors(combined.plan, controlled?.descriptor)
    : controlled ? [{ kind: 'CONTROLLED', inputIndex: 0, contentHash: controlled.descriptor.binding.fixture.htmlSha256 }]
    : [{ kind: 'BRIEF', inputIndex: 0, contentHash: snapshotHash(plan.normalizedInputs) },
    ...plan.websiteSources.map((url, inputIndex) => ({ kind: 'WEBSITE', inputIndex, contentHash: snapshotHash(url) })), ...documents]
  const base = { ...context.scope, rootRuntimeInstanceId: context.runtime.revision?.rootRuntimeId || context.scope.runtimeInstanceId,
    runtimeInstanceKey: context.runtime.runtimeInstanceKey,
    rootRuntimeInstanceKey: context.runtime.revision?.rootRuntimeInstanceKey || context.runtime.runtimeInstanceKey,
    runId: context.runId, requestKey: context.requestKey, executionAttemptId: context.executionAttemptId,
    requestFingerprint: context.requestFingerprint, plannerFingerprint: snapshotHash({ plan, descriptors }),
    contractVersion: combined ? PUBLIC_RESEARCH_RUN_VERSION : controlled ? CONTROLLED_ACQUISITION_RUN_VERSION : ACQUISITION_RUN_VERSION,
    plannerVersion: combined ? PUBLIC_RESEARCH_PLANNER_VERSION : controlled ? CONTROLLED_ACQUISITION_PLANNER_VERSION : ACQUISITION_PLANNER_VERSION,
    ...(combined ? { publicResearch: context.publicResearch } : {}),
    ...(controlled ? { controlledReplayProvenance: controlled.descriptor } : {}),
    actorUserId: context.actorUserId, authority: 'VMF_UPDATE', actionKey: context.actionKey, acquisitionProfile: plan.profile,
    basisStateVersion: context.basisStateVersion, basisUpdatedAt: new Date(context.payload.expectedUpdatedAt),
    ...(context.payload.predecessorRunId ? { predecessorRunId: context.payload.predecessorRunId } : {}),
    ...(context.payload.predecessorExecutionAttemptId ? { predecessorExecutionAttemptId: context.payload.predecessorExecutionAttemptId } : {}),
    ...(context.researchConfiguration ? { researchConfiguration: context.researchConfiguration } : {}),
    inputs: descriptors, status: 'QUEUED', active: true, createdAt: new Date() }
  try {
    await withAcquisitionTransaction(async session => {
      await assertCurrentControl(context, session)
      if (base.predecessorRunId) {
        const predecessor = await RuntimeAcquisitionRun.collection.findOne({ ...context.scope, runId: base.predecessorRunId }, { session, maxTimeMS: 2000 })
        if (!predecessor || !['FAILED', 'PARTIALLY_SUCCEEDED'].includes(predecessor.status))
          fail('ACQUISITION_PREDECESSOR_INVALID', 'Retry must identify an unsuccessful Run in this exact revision.', 409, context.runId)
        await verifyTerminal(predecessor, Date.now() + 6000, session)
        if (combined) {
          const semantics = record => ({ context: record.context, coverage: record.coverage, settings: record.settings })
          const target = value => ({ mode: value.mode, selectedCategories: value.selectedCategories, startingUrls: value.startingUrls,
            approvedDiscoveryUrls: value.approvedDiscoveryUrls, approvedTerms: value.approvedTerms, registry: value.registry,
            partialSave: value.partialSave, limits: value.limits, references: value.references,
            licensingRef: value.licensingRef, retentionRef: value.retentionRef, disclosureRef: value.disclosureRef, processingRegion: value.processingRegion })
          if (predecessor.contractVersion !== PUBLIC_RESEARCH_RUN_VERSION || String(predecessor.actorUserId) !== String(context.actorUserId)
            || predecessor.executionAttemptId !== base.predecessorExecutionAttemptId
            || predecessor.canonicalSaved !== false || predecessor.basisStateVersion !== context.basisStateVersion
            || new Date(predecessor.basisUpdatedAt).getTime() !== base.basisUpdatedAt.getTime()
            || snapshotHash(researchConfigurationReference(predecessor.researchConfiguration))
              !== snapshotHash(researchConfigurationReference(context.researchConfiguration))
            || snapshotHash(semantics(predecessor.researchConfiguration)) !== snapshotHash(semantics(context.researchConfiguration))
            || publicResearchHash(target(predecessor.publicResearch.plan)) !== publicResearchHash(target(combined.plan)))
            fail('ACQUISITION_PREDECESSOR_INVALID', 'Retry requires its exact original research scope and predecessor.', 409, context.runId)
        } else if (context.researchConfiguration && (predecessor.status !== 'FAILED' || predecessor.canonicalSaved !== false
          || String(predecessor.actorUserId) !== String(context.actorUserId)
          || predecessor.executionAttemptId !== base.predecessorExecutionAttemptId
          || predecessor.basisStateVersion !== context.basisStateVersion
          || new Date(predecessor.basisUpdatedAt).getTime() !== base.basisUpdatedAt.getTime()
          || snapshotHash(predecessor.researchConfiguration || null) !== snapshotHash(context.researchConfiguration)
          || snapshotHash(predecessor.controlledReplayProvenance || null) !== snapshotHash(controlled.descriptor)))
          fail('ACQUISITION_PREDECESSOR_INVALID', 'Research retry requires the exact verified failed, unsaved predecessor and unchanged configuration.', 409, context.runId)
      }
      const audit = await recordedAudit({ context, phase: 'QUEUED', session })
      const row = new RuntimeAcquisitionRun({ ...base, admissionAuditId: audit._id, admissionAuditSignatureVersion: audit.signatureVersion })
      await row.save({ session })
    }, context)
  } catch (error) {
    const existing = await readExact({ ...context.scope, requestKey: context.requestKey })
    if (!existing || existing.executionAttemptId !== context.executionAttemptId || existing.requestFingerprint !== context.requestFingerprint) {
      if (error.code === 11000 || existing) {
        const active = existing || await readExact({ ...context.scope, active: true })
        fail('ACQUISITION_RUN_IN_PROGRESS', 'Another acquisition already owns this revision or request.', 409, active?.runId)
      }
      throw error
    }
  }
  let row = await readExact(identity(context))
  if (row?.status === 'CANCELLED') { context.row = row; await verifyTerminal(row, Date.now() + 6000); fail('ACQUISITION_RUN_NOT_ACTIVE', 'Run was cancelled before starting.', 409, context.runId) }
  if (!row || row.status !== 'QUEUED') fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Acquisition admission could not be confirmed. Refresh.', 503, context.runId)
  await verifiedAudit(row, row.admissionAuditId, 'QUEUED', Date.now() + 6000)
  if (context.researchConfiguration) context.row = row
  try {
    await withAcquisitionTransaction(async session => {
      await assertCurrentControl(context, session)
      const audit = await recordedAudit({ context, phase: 'RUNNING', session })
      const changed = await RuntimeAcquisitionRun.collection.updateOne({ ...identity(context), status: 'QUEUED', active: true },
        { $set: { status: 'RUNNING', startedAt: new Date(), startAuditId: audit._id, startAuditSignatureVersion: audit.signatureVersion } }, { session })
      if (changed.modifiedCount !== 1) fail('ACQUISITION_RUN_IN_PROGRESS', 'This execution has already been claimed.', 409, context.runId)
    }, context)
  } catch (error) {
    row = await readExact(identity(context))
    if (!row || row.status !== 'RUNNING') throw error
  }
  row = await readExact(identity(context))
  if (!row || row.status !== 'RUNNING') fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Acquisition start could not be confirmed.', 503, context.runId)
  await verifiedAudit(row, row.startAuditId, 'RUNNING', Date.now() + 6000)
  context.row = row
  return context
}

export const buildAcquisitionRunOutcomes = (context, pack, error) => {
  if (context.row?.contractVersion === PUBLIC_RESEARCH_RUN_VERSION) return buildPublicResearchOutcomes(context.row, Boolean(pack))
  if (context.row.contractVersion === CONTROLLED_ACQUISITION_RUN_VERSION) {
    const invalid = () => fail('ACQUISITION_OUTCOME_INVALID', 'Actual controlled outcomes do not match their execution inputs.', 409, context.runId)
    let descriptor
    try { descriptor = validateStoredControlledReplayProvenance(context.row.controlledReplayProvenance) } catch { invalid() }
    const input = context.row.inputs?.[0]
    if (context.row.inputs?.length !== 1 || input.kind !== 'CONTROLLED' || input.inputIndex !== 0
      || input.contentHash !== descriptor.binding.fixture.htmlSha256) invalid()
    if (!pack) return [{ kind: 'CONTROLLED', inputIndex: 0, status: 'FAILED', evidenceObjectCount: 0,
      reason: 'CONTROLLED_CAPTURE_NOT_SAVED' }]
    const sources = pack.lineage?.sources, registry = pack.sourceRegistry, evidence = pack.evidenceObjects
    if (!Array.isArray(sources) || sources.length !== 1 || !Array.isArray(registry) || registry.length !== 1
      || !Array.isArray(evidence) || !evidence.length) invalid()
    const source = sources[0], capture = source.sourceCapture
    try {
      assertControlledReplayProvenancePairs({ sources, evidenceObjects: evidence })
      assertControlledReplayProvenancePairs({ sources: registry, evidenceObjects: sources })
      assertSourceEvidenceMetadataPairs({ sources, evidenceObjects: evidence })
      validateSourceCapture(capture, { sourceId: source.sourceId, contentHash: `sha256:${input.contentHash}` })
    } catch { invalid() }
    if (source.type !== 'CONTROLLED_HTML_REPLAY' || source.status === 'ACQUIRED'
      || source.acquisitionProfile !== context.row.acquisitionProfile || source.evidenceProduced !== evidence.length
      || snapshotHash(source.controlledReplayProvenance) !== snapshotHash(descriptor)
      || snapshotHash(registry[0].sourceCapture) !== snapshotHash(capture)
      || capture.captureReceipt.operation !== 'CONTROLLED_HTML_REPLAY_CAPTURE'
      || capture.captureReceipt.runId !== context.runId || capture.captureReceipt.attemptId !== context.executionAttemptId
      || capture.captureReceipt.inputIndex !== 0 || source.contentHash !== capture.originalContentHash
      || new Set(evidence.map(row => row.evidenceObjectId)).size !== evidence.length
      || evidence.some(row => row.sourceId !== source.sourceId || row.acquisitionMethod !== 'CONTROLLED_HTML_REPLAY'
        || !row.evidenceObjectId || snapshotHash(row.controlledReplayProvenance) !== snapshotHash(descriptor))) invalid()
    const item = pack.acquisition?.controlledReplay
    if (item?.sourceId !== source.sourceId || snapshotHash(item.evidenceObjectIds) !== snapshotHash(evidence.map(row => row.evidenceObjectId))) invalid()
    return [{ kind: 'CONTROLLED', inputIndex: 0, status: 'SUCCEEDED', sourceId: source.sourceId,
      contentHash: input.contentHash, evidenceObjectCount: evidence.length }]
  }
  const channel = error?.details?.acquisitionOutcomes
  const website = pack?.acquisition?.websiteAcquisition?.latestAttempt?.items || channel?.websiteItems || []
  const documents = pack?.acquisition?.documentAcquisition?.latestAttempt?.items || channel?.documentItems || []
  const briefComplete = pack ? pack.inputComplete : channel?.briefComplete
  const invalid = () => fail('ACQUISITION_OUTCOME_INVALID', 'Actual acquisition outcomes do not match their execution inputs.', 409, context.runId)
  for (const [kind, items] of [['WEBSITE', website], ['DOCUMENT', documents]]) {
    const intended = context.row.inputs.filter(input => input.kind === kind)
    // A settled successful builder must account for every intended input. Only an
    // incomplete brief suppresses website execution; it never suppresses documents.
    const expected = kind === 'WEBSITE' && briefComplete === false ? 0 : intended.length
    if (!Array.isArray(items) || items.length > intended.length
      || pack && items.length !== expected || new Set(items.map(item => item?.inputIndex)).size !== items.length) invalid()
    for (const item of items) {
      if (!intended.some(input => input.inputIndex === item?.inputIndex)
        || !['SUCCEEDED', 'FAILED'].includes(item?.status)
        || item.status === 'SUCCEEDED' && (!Number.isSafeInteger(item.evidenceObjectCount) || item.evidenceObjectCount < 0)
        || item.status === 'FAILED' && item.evidenceObjectCount !== undefined && item.evidenceObjectCount !== 0
        || item.status === 'SUCCEEDED' && (typeof item.sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(item.sourceId))) invalid()
      if (pack && item.status === 'SUCCEEDED') {
        const matches = pack.lineage?.sources?.filter(source => source.sourceId === item.sourceId)
        if (matches?.length !== 1) invalid()
        const source = matches[0], hash = String(source.valueHash || '').replace(/^sha256:/, '')
        const evidence = pack.evidenceObjects?.filter(row => row.sourceId === item.sourceId)
        if (!Array.isArray(evidence) || kind === 'WEBSITE' && evidence.length !== item.evidenceObjectCount
          || new Set(evidence.map(row => row.evidenceObjectId)).size !== evidence.length
          || evidence.some(row => typeof row.evidenceObjectId !== 'string' || !row.evidenceObjectId)
          || source.evidenceProduced !== item.evidenceObjectCount || source.status !== 'ACQUIRED'
          || source.acquisitionProfile !== context.row.acquisitionProfile || !/^[a-f0-9]{64}$/.test(hash)) invalid()
        if (kind === 'DOCUMENT') {
          const freshIds = item.evidenceObjectIds
          // A repeated document can retain earlier material under the same source.
          // Its receipt accounts only for the exact evidence produced by this attempt.
          if (!Array.isArray(freshIds) || freshIds.length !== item.evidenceObjectCount
            || new Set(freshIds).size !== freshIds.length
            || freshIds.some(id => typeof id !== 'string' || !id
              || pack.evidenceObjects.filter(row => row.evidenceObjectId === id).length !== 1
              || !evidence.some(row => row.evidenceObjectId === id))) invalid()
        }
        const descriptor = intended.find(input => input.inputIndex === item.inputIndex)
        if (kind === 'WEBSITE') {
          if (source.sourceType !== 'WEBSITE' || source.type !== 'WEBSITE_ACQUISITION'
            || source.adapter !== 'website-html-fetch-v1' || snapshotHash(source.url) !== descriptor.contentHash) invalid()
        } else if (source.sourceType !== 'UPLOADED_DOCUMENT' || source.type !== 'UPLOADED_DOCUMENT'
          || source.documentStatus !== 'PROCESSED' || hash !== descriptor.contentHash
          || source.documentHash !== item.documentHash || source.valueHash !== item.documentHash) invalid()
      }
    }
  }
  if (pack && typeof briefComplete !== 'boolean') invalid()
  return context.row.inputs.map(input => {
    if (input.kind === 'BRIEF') return { kind: input.kind, inputIndex: 0,
      status: typeof briefComplete === 'boolean' ? briefComplete ? 'SUCCEEDED' : 'FAILED' : 'UNATTEMPTED', evidenceObjectCount: 0,
      ...(briefComplete === false ? { reason: 'BRIEF_INCOMPLETE' } : {}) }
    const item = (input.kind === 'WEBSITE' ? website : documents).find(item => item.inputIndex === input.inputIndex)
    if (!item) return { kind: input.kind, inputIndex: input.inputIndex, status: 'UNATTEMPTED', evidenceObjectCount: 0,
      reason: 'INPUT_NOT_ATTEMPTED' }
    const source = pack?.lineage?.sources?.find(source => source.sourceId === item.sourceId)
    const contentHash = String(input.kind === 'DOCUMENT' ? item.documentHash || '' : source?.valueHash || '').replace(/^sha256:/, '')
    if (pack && item.status === 'SUCCEEDED' && (!/^[a-f0-9]{64}$/.test(contentHash)
      || input.kind === 'DOCUMENT' && contentHash !== input.contentHash))
      fail('ACQUISITION_OUTCOME_INVALID', 'Actual acquired content does not match its execution basis.', 409, context.runId)
    return { kind: input.kind, inputIndex: input.inputIndex, status: item.status, ...(item.sourceId ? { sourceId: item.sourceId } : {}),
      ...(item.status === 'SUCCEEDED' && /^[a-f0-9]{64}$/.test(contentHash) ? { contentHash } : {}),
      evidenceObjectCount: item.status === 'SUCCEEDED' ? item.evidenceObjectCount : 0,
      ...(item.status === 'FAILED' ? { reason: input.kind === 'WEBSITE' ? 'WEBSITE_ACQUISITION_FAILED' : 'DOCUMENT_EXTRACTION_FAILED' } : {}) }
  })
}
export const bindAcquisitionSourceProcessing = (context, pack) => {
  if (context.row?.contractVersion === PUBLIC_RESEARCH_RUN_VERSION) {
    const operations = context.row.publicResearch.operations.filter(operation => operation.capture)
    const updates = operations.map(operation => {
      const capture = operation.capture, sources = pack.sourceRegistry?.filter(item => item.sourceId === capture.sourceId)
      const lineages = pack.lineage?.sources?.filter(item => item.sourceId === capture.sourceId)
      const source = sources?.[0], lineage = lineages?.[0]
      const evidence = pack.evidenceObjects?.filter(item => item.sourceId === capture.sourceId)
      if (sources?.length !== 1 || lineages?.length !== 1 || evidence?.length !== capture.evidenceObjectCount
        || source.sourceCapture?.originalContentHash !== capture.contentHash
        || snapshotHash(source.sourceCapture) !== snapshotHash(lineage.sourceCapture))
        fail('ACQUISITION_OUTCOME_INVALID', 'Original research source does not match its saved receipt.', 409, context.runId)
      const original = validateSourceCapture(source.sourceCapture, { sourceId: source.sourceId, contentHash: source.contentHash })
      const recorded = original.captureReceipt
      if (recorded.runId !== null && (recorded.runId !== context.runId || recorded.attemptId !== context.executionAttemptId || recorded.inputIndex !== operation.inputIndex))
        fail('ACQUISITION_OUTCOME_INVALID', 'Original research source belongs to another attempt.', 409, context.runId)
      const bound = validateSourceCapture({ ...original, captureReceipt: { ...recorded,
        runId: context.runId, attemptId: context.executionAttemptId, inputIndex: operation.inputIndex } })
      return { source, lineage, bound, capture }
    })
    // Validate the complete proposed graph before altering either source copy.
    const proposed = sources => sources.map(source => {
      const update = updates.find(value => value.source.sourceId === source.sourceId)
      return update ? { ...source, sourceCapture: update.bound, contentHash: update.capture.contentHash } : source
    })
    assertSourceEvidenceMetadataPairs({ sources: proposed(pack.sourceRegistry), evidenceObjects: pack.evidenceObjects })
    assertSourceEvidenceMetadataPairs({ sources: proposed(pack.lineage.sources), evidenceObjects: pack.evidenceObjects })
    for (const { source, lineage, bound, capture } of updates) {
      source.sourceCapture = bound; lineage.sourceCapture = validateSourceCapture(bound)
      source.contentHash = capture.contentHash; lineage.contentHash = capture.contentHash
    }
    return pack
  }
  const outcomes = buildAcquisitionRunOutcomes(context, pack)
  const updates = outcomes.filter(item => item.status === 'SUCCEEDED' && item.kind !== 'BRIEF').map(item => {
    const matches = pack.sourceRegistry?.filter(source => source.sourceId === item.sourceId)
    const outcomeContentHash = `sha256:${item.contentHash}`
    if (matches?.length !== 1
      || matches[0].sourceType !== (item.kind === 'DOCUMENT' ? 'UPLOADED_DOCUMENT' : 'WEBSITE')
      || item.kind === 'DOCUMENT' && matches[0].documentHash !== outcomeContentHash)
      fail('ACQUISITION_OUTCOME_INVALID', 'Acquired source registry does not match its execution basis.', 409, context.runId)
    // Captured websites bind decoded HTML; legacy Run outcomes hash the HTML envelope.
    let contentHash = outcomeContentHash, sourceCapture, acquiredSource
    if (item.kind === 'WEBSITE' && matches[0].sourceCapture !== undefined) {
      const capture = validateSourceCapture(matches[0].sourceCapture, { sourceId: item.sourceId,
        contentHash: matches[0].contentHash })
      acquiredSource = pack.lineage.sources.find(source => source.sourceId === item.sourceId)
      const receipt = capture.captureReceipt
      if (receipt.operation !== 'WEBSITE_DECODED_TEXT_CAPTURE'
        || snapshotHash(acquiredSource.sourceCapture) !== snapshotHash(capture)
        || receipt.runId !== null && (receipt.runId !== context.runId
          || receipt.attemptId !== context.executionAttemptId || receipt.inputIndex !== item.inputIndex))
        fail('ACQUISITION_OUTCOME_INVALID', 'Website capture does not match its acquisition owner.', 409, context.runId)
      sourceCapture = validateSourceCapture({ ...capture, captureReceipt: { ...receipt,
        runId: context.runId, attemptId: context.executionAttemptId, inputIndex: item.inputIndex } })
      contentHash = capture.originalContentHash
    }
    return { source: matches[0], item, contentHash, sourceCapture, acquiredSource }
  })
  for (const { source, item, contentHash, sourceCapture, acquiredSource } of updates) {
    source.contentHash = contentHash
    if (sourceCapture) {
      source.sourceCapture = sourceCapture
      acquiredSource.sourceCapture = validateSourceCapture(sourceCapture)
    }
    if (item.kind === 'DOCUMENT') source.processingReceipt = {
      contractVersion: 'document-processing-receipt.v1', runId: context.runId,
      inputIndex: item.inputIndex, contentHash,
    }
  }
  return pack
}

export const executeAcquisitionBuild = async (context, build) => {
  await assertResearchRunActive(context)
  let timer
  try {
    const result = await Promise.race([Promise.resolve().then(build), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Acquisition execution exceeded its caller deadline. Inspect its Run before retrying.'),
        { status: 503, code: 'SERVICE_UNAVAILABLE', details: { reason: 'ACQUISITION_OUTCOME_UNCONFIRMED', runId: context.runId } })), ACQUISITION_CALLER_DEADLINE_MS)
    })])
    context.extractionSettled = true
    return result
  } catch (error) {
    if (error.details?.reason !== 'ACQUISITION_OUTCOME_UNCONFIRMED') context.extractionSettled = true
    throw error
  } finally { clearTimeout(timer) }
}

export const recordAcquisitionTerminal = async ({ context, pack, error, outputStateVersion, saveAudit, session }) => {
  const canonicalSaved = Boolean(outputStateVersion && saveAudit?._id && saveAudit.signature && saveAudit.signatureVersion)
  const research = context.row.contractVersion === PUBLIC_RESEARCH_RUN_VERSION
  if (research) {
    const current = await activePublicResearchRow(context, session)
    context.row = current
    if (!context.recoveryWitness && (context.publicResearchUnconfirmed
      || current.publicResearch.operations.some(operation => operation.phase === 'DISPATCHING')))
      fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Research response recording remains unconfirmed.', 503, context.runId)
  }
  const recovery = context.recoveryWitness
  if (recovery) {
    if (pack || error || outputStateVersion || saveAudit || env.nodeEnv !== 'development' || env.appEnv !== 'development')
      fail('ACQUISITION_RECOVERY_PROOF_INVALID', 'Recovery cannot substitute an extraction or save receipt.', 422, context.runId)
    assertStoppedRecoveryWitness(context.row, recovery)
    assertRecoveryWorkerStopped(recovery.workerPid)
  }
  const outcomes = recovery ? context.row.inputs.map(({ kind, inputIndex }) => ({ kind, inputIndex,
    status: 'FAILED', evidenceObjectCount: 0, reason: ORIGINAL_EXTRACTION_UNCONFIRMED }))
    : research ? buildPublicResearchOutcomes(context.row, canonicalSaved) : buildAcquisitionRunOutcomes(context, pack, error)
  let status = canonicalSaved ? outcomes.every(item => item.status === 'SUCCEEDED') ? 'SUCCEEDED'
    : outcomes.some(item => item.status === 'SUCCEEDED') ? 'PARTIALLY_SUCCEEDED' : 'FAILED' : 'FAILED'
  if (research && !recovery) {
    status = publicResearchTerminalStatus(context.row.publicResearch)
    if (status === 'SUCCEEDED' && (error || outcomes.some(item => item.status !== 'SUCCEEDED')
      || context.row.publicResearch.plan.selectedCategories.includes('WEBSITE') && !canonicalSaved))
      status = context.row.publicResearch.operations.some(operation => ['SUCCEEDED', 'EMPTY'].includes(operation.outcome))
        ? 'PARTIALLY_SUCCEEDED' : 'FAILED'
  }
  const reason = recovery ? STOPPED_WORKER_RECOVERY_REASON : research ? status === 'SUCCEEDED' ? undefined
    : canonicalSaved ? 'PUBLIC_RESEARCH_PARTIAL' : 'ACQUISITION_NOT_SAVED' : canonicalSaved ? undefined : 'ACQUISITION_NOT_SAVED'
  const terminalAudit = await recordedAudit({ context, phase: status, session, extra: { outcomeHash: snapshotHash(outcomes),
    canonicalSaved, outputStateVersion: outputStateVersion || null, saveAuditId: saveAudit?._id ? String(saveAudit._id) : null,
    saveAuditSignature: saveAudit?.signature || null, ...publicResearchAuditFields(context.row), ...(recovery ? { recoveryWitness: recovery } : {}) } })
  const fields = { status, active: false, outcomes, canonicalSaved, completedAt: new Date(),
    terminalAuditId: terminalAudit._id, terminalAuditSignatureVersion: terminalAudit.signatureVersion,
    ...(canonicalSaved ? { outputStateVersion, saveAuditId: saveAudit._id, saveAuditSignatureVersion: saveAudit.signatureVersion,
      saveAuditSignature: saveAudit.signature } : {}), ...(reason ? { reason } : {}) }
  await new RuntimeAcquisitionRun({ ...context.row, ...fields }).validate()
  const changed = await RuntimeAcquisitionRun.collection.updateOne({ ...identity(context), status: 'RUNNING', active: true }, { $set: fields }, { session })
  if (changed.modifiedCount !== 1) fail('ACQUISITION_RUN_STALE', 'Acquisition terminal ownership changed.', 409, context.runId)
}

export const assertRecoveryWorkerStopped = workerPid => {
  if (!Number.isSafeInteger(workerPid) || workerPid <= 0 || workerPid === process.pid)
    fail('ACQUISITION_RECOVERY_WORKER_ACTIVE', 'The original worker has not been confirmed stopped.', 409)
  try { process.kill(workerPid, 0) } catch (error) {
    if (error.code === 'ESRCH') return
    throw error
  }
  fail('ACQUISITION_RECOVERY_WORKER_ACTIVE', 'The original worker is still present.', 409)
}

// Development operator entrypoint only; no HTTP route exposes recovery witnesses.
// The reviewed operator must anchor the original PID/source/response evidence before stopping it.
export const recoverStoppedAcquisitionRun = async ({ runId, runtimeInstanceId, actorUserId, proof, dryRun = false }) => {
  if (env.nodeEnv !== 'development' || env.appEnv !== 'development' || !uuid.test(runId || '')
    || !mongoose.isValidObjectId(runtimeInstanceId) || !mongoose.isValidObjectId(actorUserId))
    fail('ACQUISITION_RECOVERY_PROOF_INVALID', 'A scoped Development recovery identity is required.', 422, runId)
  const authorize = async session => {
    const query = User.findById(actorUserId).maxTimeMS(2000)
    if (session) query.session(session)
    const user = await query.lean()
    if (!user) fail('ACQUISITION_RECOVERY_FORBIDDEN', 'Recovery actor is unavailable.', 403, runId)
    const scopes = await buildUserPermissionsSnapshot(user)
    if (scopes.isActive !== true) fail('ACQUISITION_RECOVERY_FORBIDDEN', 'Recovery actor is inactive.', 403, runId)
    await assertRuntimePermission({ actorUserId, scopes, customerId: proof?.customerId, tenantId: proof?.tenantId,
      permission: 'VMF_UPDATE', maxTimeMS: 2000, session })
  }
  await authorize(null)
  await requireIndexes(Date.now() + 6000)
  const filter = { runId, runtimeInstanceId: new mongoose.Types.ObjectId(runtimeInstanceId), actorUserId: new mongoose.Types.ObjectId(actorUserId) }
  const check = async session => {
    if (session) await authorize(session)
    const row = await RuntimeAcquisitionRun.collection.findOne(filter, { session, maxTimeMS: 2000 })
    if (!row) fail('ACQUISITION_RECOVERY_PROOF_INVALID', 'Exact recovery Run is unavailable.', 422, runId)
    assertStoppedRecoveryWitness(row, proof)
    if (terminal(row)) { await verifyTerminal(row, Date.now() + 6000, session); return { replay: publicAcquisitionRun(row, { replay: true }) } }
    if (row.status !== 'RUNNING' || !row.active || row.canonicalSaved !== undefined || row.saveAuditId || row.outputStateVersion || row.terminalAuditId)
      fail('ACQUISITION_RECOVERY_PROOF_INVALID', 'Recovery requires an active unsaved Run.', 422, runId)
    assertRecoveryWorkerStopped(proof.workerPid)
    const admission = await verifiedAudit(row, row.admissionAuditId, 'QUEUED', Date.now() + 6000, session)
    const start = await verifiedAudit(row, row.startAuditId, 'RUNNING', Date.now() + 6000, session)
    if (admission.requestId !== proof.originalRequestId || start.requestId !== proof.originalRequestId)
      fail('ACQUISITION_RECOVERY_PROOF_INVALID', 'Original request evidence is not bound to this Run.', 422, runId)
    const scope = { runtimeInstanceId: row.runtimeInstanceId, customerId: row.customerId, tenantId: row.tenantId }
    const runtime = await RuntimeInstance.collection.findOne({ _id: row.runtimeInstanceId, customerId: row.customerId, tenantId: row.tenantId }, { session, maxTimeMS: 2000 })
    if (!runtime || snapshotHash(runtime) !== proof.rootHash)
      fail('ACQUISITION_RUN_STALE', 'Recovery runtime basis changed.', 409, runId)
    const context = { runtime, scope, row, actorUserId, runId, executionAttemptId: row.executionAttemptId,
      ...(row.researchConfiguration ? { researchConfiguration: row.researchConfiguration } : {}),
      requestFingerprint: row.requestFingerprint, basisStateVersion: row.basisStateVersion,
      payload: { expectedUpdatedAt: row.basisUpdatedAt }, recoveryWitness: proof,
      auditRequest: { requestId: `recovery-${randomUUID()}` } }
    await assertCurrentControl(context, session)
    return context
  }
  const initial = await check(null)
  if (initial.replay) return initial.replay
  if (dryRun) return { runId, status: 'RECOVERY_DRY_RUN_PASS', rootHash: proof.rootHash, witnessHash: snapshotHash(proof) }
  // The guarded Run write conflicts with a late original transaction, which must
  // terminalize that same Run atomically with its root save. Recovery never writes root.
  await withAcquisitionTransaction(async session => {
    const context = await check(session)
    if (!context.replay) await recordAcquisitionTerminal({ context, session })
  })
  const row = await readExact(filter)
  if (!terminal(row)) fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Recovery terminal result is unconfirmed.', 503, runId)
  await verifyTerminal(row, Date.now() + 6000)
  return publicAcquisitionRun(row)
}
export const readCommittedAcquisition = async context => {
  const deadline = Date.now() + 6000
  if (context.row?.contractVersion === PUBLIC_RESEARCH_RUN_VERSION) return withPublicResearchSnapshot(async session => {
    const row = await readExact(identity(context), deadline, session)
    if (!terminal(row)) return null
    await verifyTerminal(row, deadline, session)
    return publicAcquisitionRun(row)
  })
  const row = await readExact(identity(context), deadline)
  if (!terminal(row)) return null
  await verifyTerminal(row, deadline)
  return publicAcquisitionRun(row)
}
export const handleAcquisitionFailure = async (context, error, pack) => {
  if (!context?.row) throw error
  const committed = await readCommittedAcquisition(context)
  if (committed) return { acquisitionRun: { ...committed, replay: true, requiresRefresh: true } }
  if (context.publicResearchUnconfirmed || !context.extractionSettled || context.rootPersistenceStarted
    && (!context.transaction?.abortConfirmed || context.transaction?.commitPossible))
    fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Acquisition outcome could not be confirmed. Refresh and inspect this Run before retrying.', 503, context.runId)
  try {
    await withAcquisitionTransaction(session => recordAcquisitionTerminal({ context, pack, error, session }))
  } catch {
    const receipt = await readCommittedAcquisition(context)
    if (!receipt) fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Acquisition failure recording could not be confirmed. Inspect its Run.', 503, context.runId)
  }
  const receipt = await readCommittedAcquisition(context)
  if (!receipt) fail('ACQUISITION_OUTCOME_UNCONFIRMED', 'Acquisition terminal receipt is unavailable. Inspect its Run.', 503, context.runId)
  error.details = { ...error.details, runId: context.runId, acquisitionRun: receipt }
  throw error
}

const loadReadContext = async (args, deadline) => {
  const session = await mongoose.startSession()
  let runtime
  try {
    await session.withTransaction(async () => {
      runtime = await getRuntimeInstance({ scopes: args.scopes, runtimeInstanceId: args.runtimeInstanceId,
        projection: 'customerId tenantId runtimeInstanceKey runtimeType revision stateVersion updatedAt status lockedAt framework_state.lock framework_state.publish framework_state.lifecycle',
        maxTimeMS: queryBudget(deadline).maxTimeMS, metadataMaxTimeMS: 2000, session })
      queryBudget(deadline)
      await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes,
        customerId: runtime.customerId, tenantId: runtime.tenantId, permission: 'VMF_VIEW', session, maxTimeMS: queryBudget(deadline).maxTimeMS })
    }, { ...ACQUISITION_TRANSACTION_OPTIONS, timeoutMS: queryBudget(deadline).timeoutMS })
  } finally { await session.endSession() }
  await requireIndexes(deadline)
  return runtime
}
const requestLookupFilter = args => args.query?.requestKey ? { requestKey: args.query.requestKey, actorUserId: new mongoose.Types.ObjectId(args.actorUserId) } : {}
const readAcquisitionRuns = async args => {
  const deadline = Date.now() + 6000
  const runtime = await loadReadContext(args, deadline), scope = scopeFor(runtime)
  const cursor = args.query?.cursor
  let after
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString())
      if (!mongoose.isValidObjectId(parsed.id) || !Number.isFinite(Date.parse(parsed.time))) throw new Error('Invalid cursor')
      after = { $or: [{ createdAt: { $lt: new Date(parsed.time) } }, { createdAt: new Date(parsed.time), _id: { $lt: new mongoose.Types.ObjectId(parsed.id) } }] }
    } catch { fail('ACQUISITION_CURSOR_INVALID', 'Acquisition history cursor is invalid.', 422) }
  }
  const projection = Object.fromEntries(['contractVersion', 'plannerVersion', 'controlledReplayProvenance', 'researchConfiguration', 'executionAttemptId', 'runId', 'requestKey', 'customerId', 'tenantId', 'runtimeInstanceId',
    'runtimeInstanceKey', 'rootRuntimeInstanceKey', 'actorUserId', 'authority', 'actionKey', 'acquisitionProfile', 'basisStateVersion',
    'basisUpdatedAt', 'status', 'createdAt', 'startedAt', 'completedAt', 'predecessorRunId', 'predecessorExecutionAttemptId', 'canonicalSaved', 'outputStateVersion',
    'outcomes.kind', 'outcomes.inputIndex', 'outcomes.status', 'outcomes.sourceId', 'outcomes.evidenceObjectCount', 'outcomes.reason',
    'admissionAuditId', 'startAuditId', 'terminalAuditId', 'saveAuditId', 'reason', 'providerFreeSearch', 'receiptRecorded', 'publicResearch', 'inputs'].map(key => [key, 1]))
  const rows = await RuntimeAcquisitionRun.collection.find({ ...scope, ...requestLookupFilter(args), ...after }, { ...queryBudget(deadline), projection })
    .sort({ createdAt: -1, _id: -1 }).limit(26).batchSize(26).toArray()
  const items = rows.slice(0, 25), last = items.at(-1), hasMore = rows.length > 25
  if (items.some(row => row.contractVersion === PROVIDER_FREE_SEARCH_RUN_VERSION))
    await verifyProviderFreeSearchReceiptScope({ runtimeInstance: runtime, actorUserId: args.actorUserId })
  const publicRows = items.filter(item => item.contractVersion === PUBLIC_RESEARCH_RUN_VERSION)
  if (publicRows.length) {
    await assertFreshPublicResearchPermission({ actorUserId: args.actorUserId, scopes: args.scopes, runtime, permission: 'VMF_VIEW' })
    if (publicRows.some(row => row.publicResearch?.plan?.mode === 'OFFLINE'))
      await verifyPublicResearchFixtureReadScope({ runtimeInstance: runtime, actorUserId: args.actorUserId })
    for (const row of publicRows) validatePersistedPublicResearch(row, () => validatePublicResearchState(row.publicResearch, row))
  }
  return { contractVersion: ACQUISITION_RUN_VERSION, scope: { ...Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, String(value)])),
    runtimeInstanceKey: runtime.runtimeInstanceKey }, observedStateVersion: runtime.stateVersion,
  ...(args.query?.requestKey ? { requestedRequestKey: args.query.requestKey } : {}),
  items: items.map(row => publicAcquisitionRun(row)), hasMore,
  nextCursor: hasMore ? Buffer.from(JSON.stringify({ id: String(last._id), time: last.createdAt.toISOString() })).toString('base64url') : null,
  completeness: hasMore ? 'MORE_PAGES' : 'COMPLETE_PAGE', verification: 'RECORDED_HISTORY_PREVIEW',
  recovery: 'Open an exact Run to verify its signed terminal receipt.' }
}
const readAcquisitionRun = async args => {
  const deadline = Date.now() + 6000
  const runtime = await loadReadContext(args, deadline)
  const row = await readExact({ ...scopeFor(runtime), runId: args.runId, ...requestLookupFilter(args) }, deadline)
  if (!row) fail('ACQUISITION_RUN_NOT_FOUND', 'Acquisition Run not found in this revision.', 404)
  if (row.contractVersion === PUBLIC_RESEARCH_RUN_VERSION) return withPublicResearchSnapshot(async session => {
    const currentRuntime = await getRuntimeInstance({ scopes: args.scopes, runtimeInstanceId: args.runtimeInstanceId, session,
      projection: 'customerId tenantId runtimeInstanceKey runtimeType revision stateVersion updatedAt status lockedAt framework_state.lock framework_state.publish framework_state.lifecycle',
      maxTimeMS: queryBudget(deadline).maxTimeMS, metadataMaxTimeMS: 2000 })
    await assertFreshPublicResearchPermission({ actorUserId: args.actorUserId, scopes: args.scopes,
      runtime: currentRuntime, permission: 'VMF_VIEW', session })
    const current = await readExact({ ...scopeFor(currentRuntime), runId: args.runId, ...requestLookupFilter(args) }, deadline, session)
    if (!current) fail('ACQUISITION_RUN_NOT_FOUND', 'Acquisition Run not found in this revision.', 404)
    if (current.publicResearch?.plan?.mode === 'OFFLINE')
      await verifyPublicResearchFixtureReadScope({ runtimeInstance: currentRuntime, actorUserId: args.actorUserId, session })
    await verifyPublicResearchRow(current, deadline, session)
    const cancellable = cancellationEligible(current, currentRuntime, args.actorUserId)
      && await publicResearchCancellationCurrent(current, currentRuntime, args, session)
    return publicAcquisitionRun(current, { cancellation: cancellationDescriptor(current, cancellable),
      observedStateVersion: currentRuntime.stateVersion, currency: current.outputStateVersion === currentRuntime.stateVersion
        ? 'CURRENT_OUTPUT' : terminal(current) ? 'HISTORICAL_OUTPUT' : 'ACTIVE' })
  })
  if (row.contractVersion === PROVIDER_FREE_SEARCH_RUN_VERSION)
    await verifyProviderFreeSearchReceiptScope({ runtimeInstance: runtime, actorUserId: args.actorUserId })
  if (terminal(row)) await verifyTerminal(row, deadline)
  else if (row.researchConfiguration) {
    await verifiedAudit(row, row.admissionAuditId, 'QUEUED', deadline)
    if (row.startedAt) await verifiedAudit(row, row.startAuditId, 'RUNNING', deadline)
  }
  return publicAcquisitionRun(row, { ...(row.researchConfiguration && row.contractVersion !== PROVIDER_FREE_SEARCH_RUN_VERSION ? { cancellation: cancellationDescriptor(row, cancellationEligible(row, runtime, args.actorUserId)) } : {}), observedStateVersion: runtime.stateVersion,
    currency: row.outputStateVersion === runtime.stateVersion ? 'CURRENT_OUTPUT' : terminal(row) ? 'HISTORICAL_OUTPUT' : 'ACTIVE' })
}
const safeRead = async (args, read) => {
  try { return await read(args) }
  catch (error) {
    if (error.status) throw error
    fail('ACQUISITION_READ_UNAVAILABLE', 'Acquisition history or receipt could not be verified. Refresh.', 503, args.runId)
  }
}
export const getAcquisitionRuns = args => safeRead(args, readAcquisitionRuns)
export const getAcquisitionRun = args => safeRead(args, readAcquisitionRun)

// Historical replay is an authenticated read of the original signed identity.
// It intentionally does not require today's policy, key, editable basis or grant.
export const replayPublicResearchRequest = async args => {
  if (!args.payload?.publicResearch) return null
  const deadline = Date.now() + 6000
  await requireIndexes(deadline)
  return withPublicResearchSnapshot(async session => {
    const runtime = await getRuntimeInstance({ scopes: args.scopes, runtimeInstanceId: args.runtimeInstanceId, session,
      projection: 'customerId tenantId runtimeInstanceKey runtimeType revision stateVersion updatedAt status lockedAt framework_state.lock framework_state.publish framework_state.lifecycle',
      maxTimeMS: 2000, metadataMaxTimeMS: 2000 })
    await assertFreshPublicResearchPermission({ actorUserId: args.actorUserId, scopes: args.scopes, runtime, session })
    const prior = await readExact({ ...scopeFor(runtime), requestKey: args.payload.requestKey }, deadline, session)
    if (!prior) return null
    if (prior.contractVersion !== PUBLIC_RESEARCH_RUN_VERSION || String(prior.actorUserId) !== String(args.actorUserId)
      || prior.requestFingerprint !== acquisitionRequestFingerprint({ payload: args.payload,
        actionKey: args.actionKey || 'BUILD_EVIDENCE_PACK', actorUserId: args.actorUserId }))
      fail('ACQUISITION_REQUEST_CONFLICT', 'This request identity belongs to different inputs, authority or basis.', 409, prior.runId)
    if (prior.publicResearch?.plan?.mode === 'OFFLINE')
      await verifyPublicResearchFixtureReadScope({ runtimeInstance: runtime, actorUserId: args.actorUserId, session })
    await verifyPublicResearchRow(prior, deadline, session)
    if (!terminal(prior)) fail('ACQUISITION_RUN_IN_PROGRESS', 'This acquisition outcome remains unconfirmed. Inspect its Run.', 409, prior.runId)
    return publicAcquisitionRun(prior, { replay: true, requiresRefresh: true })
  })
}

const providerFreeRecordPayload = z.object({ requestKey: z.string().regex(uuid), expectedUpdatedAt: z.string().datetime(),
  fixture: z.unknown(), predecessorRunId: z.string().regex(uuid).optional(),
  predecessorExecutionAttemptId: z.string().regex(uuid).optional() }).strict()
  .refine(value => Boolean(value.predecessorRunId) === Boolean(value.predecessorExecutionAttemptId))

// Resolve the original private fixture before current editability/configuration
// gates. The recorder independently verifies fingerprint, authority and audits.
export const replayRegisteredProviderFreeSearchRequest = async args => {
  const runtime = await loadReadContext(args, Date.now() + 6000)
  await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes, customerId: runtime.customerId,
    tenantId: runtime.tenantId, permission: 'VMF_UPDATE', maxTimeMS: 2000 })
  await verifyProviderFreeSearchReceiptScope({ runtimeInstance: runtime, actorUserId: args.actorUserId })
  const prior = await RuntimeAcquisitionRun.collection.findOne({ ...scopeFor(runtime), requestKey: args.payload.requestKey },
    { maxTimeMS: 2000 })
  if (!prior) return null
  if (prior.contractVersion !== PROVIDER_FREE_SEARCH_RUN_VERSION || String(prior.actorUserId) !== String(args.actorUserId)
    || args.payload.acquisitionProfile !== undefined && args.payload.acquisitionProfile !== prior.acquisitionProfile
    || snapshotHash(args.payload.researchConfiguration) !== snapshotHash(prior.providerFreeSearch?.input?.selector))
    fail('ACQUISITION_REQUEST_CONFLICT', 'The original request identity belongs to different material.', 409)
  await verifyTerminal(prior, Date.now() + 6000)
  const rebuilt = await buildProviderFreeSearchFixtureInput({ selector: args.payload.researchConfiguration,
    settings: prior.researchConfiguration.settings })
  const fixture = { ...rebuilt, responseText: prior.providerFreeSearch.input.responseText,
    httpStatus: prior.providerFreeSearch.input.httpStatus, transportOutcome: prior.providerFreeSearch.input.transportOutcome }
  return recordProviderFreeTavilyReceipt({ ...args, payload: { requestKey: args.payload.requestKey,
    expectedUpdatedAt: args.payload.expectedUpdatedAt, fixture,
    ...(args.payload.predecessorRunId ? { predecessorRunId: args.payload.predecessorRunId,
      predecessorExecutionAttemptId: args.payload.predecessorExecutionAttemptId } : {}) } })
}

/** Unmounted synthetic receipt import. No transport, source/evidence save or live grant. */
export const recordProviderFreeTavilyReceipt = async args => {
  let payload, prepared
  try { payload = providerFreeRecordPayload.parse(args.payload); prepared = prepareTavilyFixtureRequest(payload.fixture) }
  catch { fail('PROVIDER_FREE_SEARCH_REQUEST_INVALID', 'Provider-free search request is invalid.', 422) }
  const runId = randomUUID(), executionAttemptId = randomUUID(), deadline = Date.now() + 6000
  await requireIndexes(deadline)
  try {
    return await withAcquisitionTransaction(async session => {
      const runtime = await getRuntimeInstance({ scopes: args.scopes, runtimeInstanceId: args.runtimeInstanceId, session,
        maxTimeMS: 2000, metadataMaxTimeMS: 2000,
        projection: 'customerId tenantId runtimeInstanceKey runtimeType revision stateVersion updatedAt status executionStatus lockedAt framework_state.lock framework_state.publish framework_state.lifecycle __v',
      })
      await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes, customerId: runtime.customerId,
        tenantId: runtime.tenantId, permission: 'VMF_UPDATE', session, maxTimeMS: 2000 })
      await verifyProviderFreeSearchReceiptScope({ runtimeInstance: runtime, actorUserId: args.actorUserId, session })
      const scope = scopeFor(runtime)
      const requestFingerprint = snapshotHash({ contractVersion: PROVIDER_FREE_SEARCH_RUN_VERSION,
        scope, actorUserId: String(args.actorUserId), expectedUpdatedAt: payload.expectedUpdatedAt,
        fixture: prepared.input, descriptorHash: hashProviderFreeSearchDescriptor(prepared.descriptor),
        predecessorRunId: payload.predecessorRunId || null, predecessorExecutionAttemptId: payload.predecessorExecutionAttemptId || null })
      const prior = await RuntimeAcquisitionRun.collection.findOne({ ...scope, requestKey: payload.requestKey }, { session, maxTimeMS: 2000 })
      if (prior) {
        if (String(prior.actorUserId) !== String(args.actorUserId) || prior.contractVersion !== PROVIDER_FREE_SEARCH_RUN_VERSION
          || prior.requestFingerprint !== requestFingerprint) fail('ACQUISITION_REQUEST_CONFLICT', 'The original request identity belongs to different material.', 409)
        await verifyTerminal(prior, Date.now() + 6000, session)
        return publicAcquisitionRun(prior, { replay: true })
      }
      const loaded = await loadResearchConfigurationForReceipt(args, session), configuration = loaded.configuration
      if (!configuration || loaded.runtime.id !== runtime.id || runtime.status !== 'ACTIVE'
        || ['RUNNING', 'VALIDATING', 'COMPLETE', 'ERROR'].includes(runtime.executionStatus)
        || isRuntimeLocked({ runtimeInstance: runtime }) || isRuntimeLifecycleTruthImmutable(runtime.framework_state)
        || configuration.configurationVersion !== prepared.input.selector.configurationVersion
        || configuration.configurationHash !== prepared.input.selector.configurationHash
        || configuration.settings.sources.length !== 1 || configuration.settings.sources[0] !== 'SEARCH'
        || configuration.settings.startingUrls.length !== 1
        || hashProviderFreeSearchValue(configuration.settings) !== hashProviderFreeSearchValue(prepared.input.settings)
        || configuration.basisStateVersion !== prepared.input.selector.basisStateVersion
        || requireCanonicalRuntimeStateVersion(runtime) !== configuration.basisStateVersion
        || new Date(runtime.updatedAt).toISOString() !== payload.expectedUpdatedAt
        || configuration.basisUpdatedAt !== payload.expectedUpdatedAt) fail('PROVIDER_FREE_SEARCH_BASIS_STALE', 'Current editable research basis is required.', 409)
      const authority = await verifyProviderFreeSearchReceiptScope({ runtimeInstance: runtime, actorUserId: args.actorUserId, session, writeFence: true })
      const root = await RuntimeInstance.collection.findOne({ _id: scope.runtimeInstanceId, customerId: scope.customerId, tenantId: scope.tenantId },
        { session, maxTimeMS: 2000, projection: { __v: 1, researchConfiguration: 1 } })
      if (!root || root.__v !== undefined && (!Number.isSafeInteger(root.__v) || root.__v < 0))
        fail('PROVIDER_FREE_SEARCH_BASIS_STALE', 'Runtime write fence is unavailable.', 409)
      const fenced = await RuntimeInstance.collection.updateOne({ _id: scope.runtimeInstanceId, customerId: scope.customerId, tenantId: scope.tenantId,
        stateVersion: configuration.basisStateVersion, updatedAt: new Date(payload.expectedUpdatedAt), status: 'ACTIVE',
        __v: root.__v === undefined ? { $exists: false } : root.__v,
        'researchConfiguration.configurationVersion': configuration.configurationVersion,
        'researchConfiguration.configurationHash': configuration.configurationHash }, { $inc: { __v: 1 } }, { session, maxTimeMS: 2000 })
      if (fenced.modifiedCount !== 1) fail('PROVIDER_FREE_SEARCH_BASIS_STALE', 'The revision changed before receipt recording.', 409)
      if (payload.predecessorRunId) {
        const predecessor = await RuntimeAcquisitionRun.collection.findOne({ ...scope, runId: payload.predecessorRunId,
          actorUserId: new mongoose.Types.ObjectId(args.actorUserId) }, { session, maxTimeMS: 2000 })
        if (!predecessor || predecessor.contractVersion !== PROVIDER_FREE_SEARCH_RUN_VERSION
          || !['FAILED', 'PARTIALLY_SUCCEEDED'].includes(predecessor.status) || predecessor.canonicalSaved !== false
          || predecessor.executionAttemptId !== payload.predecessorExecutionAttemptId
          || predecessor.basisStateVersion !== configuration.basisStateVersion
          || new Date(predecessor.basisUpdatedAt).toISOString() !== payload.expectedUpdatedAt)
          fail('ACQUISITION_PREDECESSOR_INVALID', 'Retry requires the exact unsuccessful Run and Attempt.', 409)
        await verifyTerminal(predecessor, Date.now() + 6000, session)
        const receipt = validateProviderFreeSearchRun(predecessor)
        if (receipt.descriptorHash !== hashProviderFreeSearchDescriptor(prepared.descriptor)
          || snapshotHash(researchConfigurationReference(predecessor.researchConfiguration)) !== snapshotHash(researchConfigurationReference(configuration)))
          fail('ACQUISITION_PREDECESSOR_INVALID', 'Retry configuration or request scope changed.', 409)
      }
      let mapped = null
      try { mapped = prepareTavilySearchFixture(prepared.input) } catch { /* Preserve bounded raw failure, never an exception echo. */ }
      const record = { contractVersion: 'provider-free-search-receipt.v1', authority, input: prepared.input,
        descriptor: prepared.descriptor, mapped, adaptationStatus: mapped ? 'VALID' : 'INVALID_RESPONSE',
        rawResponseHash: sourceEvidenceHash(prepared.input.responseText), descriptorHash: hashProviderFreeSearchDescriptor(prepared.descriptor),
        mappedResponseHash: hashProviderFreeSearchValue(mapped) }
      record.recordHash = providerFreeSearchRecordHash(record)
      validateProviderFreeSearchReceipt(record)
      const context = { runtime, scope, actorUserId: args.actorUserId, runId, executionAttemptId, requestFingerprint,
        auditRequest: args.auditRequest, payload, researchConfiguration: configuration, providerFreeSearch: record }
      const admission = await recordedAudit({ context, phase: 'QUEUED', session })
      const base = { ...scope, rootRuntimeInstanceId: runtime.revision?.rootRuntimeId || scope.runtimeInstanceId,
        runtimeInstanceKey: runtime.runtimeInstanceKey, rootRuntimeInstanceKey: runtime.revision?.rootRuntimeInstanceKey || runtime.runtimeInstanceKey,
        runId, requestKey: payload.requestKey, executionAttemptId, requestFingerprint,
        plannerFingerprint: snapshotHash({ plannerVersion: PROVIDER_FREE_SEARCH_PLANNER_VERSION, descriptorHash: record.descriptorHash }),
        contractVersion: PROVIDER_FREE_SEARCH_RUN_VERSION, plannerVersion: PROVIDER_FREE_SEARCH_PLANNER_VERSION,
        actorUserId: args.actorUserId, authority: 'VMF_UPDATE', actionKey: 'BUILD_EVIDENCE_PACK', acquisitionProfile: configuration.coverage,
        basisStateVersion: configuration.basisStateVersion, basisUpdatedAt: new Date(payload.expectedUpdatedAt),
        researchConfiguration: configuration, providerFreeSearch: record,
        ...(payload.predecessorRunId ? { predecessorRunId: payload.predecessorRunId, predecessorExecutionAttemptId: payload.predecessorExecutionAttemptId } : {}),
        inputs: [{ kind: 'SEARCH', inputIndex: 0, contentHash: record.descriptorHash.slice(7) }], status: 'QUEUED', active: true,
        createdAt: new Date(), admissionAuditId: admission._id, admissionAuditSignatureVersion: admission.signatureVersion }
      await new RuntimeAcquisitionRun(base).save({ session })
      const start = await recordedAudit({ context, phase: 'RUNNING', session })
      const running = { status: 'RUNNING', startedAt: new Date(), startAuditId: start._id, startAuditSignatureVersion: start.signatureVersion }
      const started = await RuntimeAcquisitionRun.collection.updateOne({ ...identity(context), active: true, status: 'QUEUED' }, { $set: running }, { session })
      if (started.modifiedCount !== 1) fail('ACQUISITION_RUN_STALE', 'Receipt phase changed.', 409)
      const status = providerFreeSearchStatus(record), outcomes = [{ kind: 'SEARCH', inputIndex: 0,
        status: status === 'FAILED' ? 'FAILED' : 'SUCCEEDED', evidenceObjectCount: 0,
        ...(status === 'FAILED' ? { reason: mapped ? 'SYNTHETIC_SEARCH_UNAVAILABLE' : 'TAVILY_RESPONSE_INVALID' } : {}) }]
      const terminalAudit = await recordedAudit({ context, phase: status, session, extra: { outcomeHash: snapshotHash(outcomes),
        canonicalSaved: false, outputStateVersion: null, saveAuditId: null, saveAuditSignature: null } })
      const fields = { status, active: false, receiptRecorded: true, canonicalSaved: false, outcomes, completedAt: new Date(),
        terminalAuditId: terminalAudit._id, terminalAuditSignatureVersion: terminalAudit.signatureVersion }
      const finished = { ...base, ...running, ...fields }
      await new RuntimeAcquisitionRun(finished).validate()
      const changed = await RuntimeAcquisitionRun.collection.updateOne({ ...identity(context), status: 'RUNNING', active: true }, { $set: fields }, { session })
      if (changed.modifiedCount !== 1) fail('ACQUISITION_RUN_STALE', 'Receipt terminal ownership changed.', 409)
      await verifyTerminal(finished, Date.now() + 6000, session)
      return publicAcquisitionRun(finished)
    })
  } catch (error) {
    if (error.status) throw error
    if (error.code === 11000) fail('ACQUISITION_RUN_IN_PROGRESS', 'Another acquisition owns this request or revision.', 409)
    fail('PROVIDER_FREE_SEARCH_RECORD_UNAVAILABLE', 'Provider-free receipt could not be recorded or verified.', 503)
  }
}

// Cancellation fences this controlled attempt's save; it never claims worker/provider abort.
export const cancelAcquisitionRun = async args => {
  if (!args.payload || Object.keys(args.payload).length !== 1 || !uuid.test(args.payload.executionAttemptId))
    fail('ACQUISITION_CANCELLATION_INVALID', 'An exact execution attempt is required.', 422, args.runId)
  if (!['development', 'test'].includes(env.nodeEnv) || env.appEnv !== 'development')
    fail('ACQUISITION_CANCELLATION_UNAVAILABLE', 'Controlled cancellation is unavailable in this environment.', 409, args.runId)
  await requireIndexes(Date.now() + 6000)
  await withAcquisitionTransaction(async session => {
    const runtime = await getRuntimeInstance({ scopes: args.scopes, runtimeInstanceId: args.runtimeInstanceId, session,
      projection: 'customerId tenantId runtimeInstanceKey runtimeType revision stateVersion updatedAt status lockedAt framework_state.lock framework_state.publish framework_state.lifecycle',
      maxTimeMS: 2000, metadataMaxTimeMS: 2000 })
    await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes, customerId: runtime.customerId,
      tenantId: runtime.tenantId, permission: 'VMF_UPDATE', session, maxTimeMS: 2000 })
    const scope = scopeFor(runtime), row = await RuntimeAcquisitionRun.collection.findOne({ ...scope, runId: args.runId }, { session, maxTimeMS: 2000 })
    if (!row) fail('ACQUISITION_RUN_NOT_FOUND', 'Acquisition Run not found in this revision.', 404, args.runId)
    if (String(row.actorUserId) !== String(args.actorUserId)) throw Object.assign(new Error('Only the original actor can cancel this controlled attempt.'), {
      status: 403, code: 'FORBIDDEN', details: { reason: 'ACQUISITION_CANCELLATION_FORBIDDEN', runId: args.runId },
    })
    if (row.executionAttemptId !== args.payload.executionAttemptId)
      fail('ACQUISITION_CANCELLATION_STALE', 'The execution attempt does not match this Run.', 409, args.runId)
    if (!row.researchConfiguration || ![CONTROLLED_ACQUISITION_RUN_VERSION, PUBLIC_RESEARCH_RUN_VERSION].includes(row.contractVersion))
      fail('ACQUISITION_CANCELLATION_UNAVAILABLE', 'Only controlled research attempts support cancellation here.', 409, args.runId)
    validateResearchRunConfiguration(row)
    if (row.contractVersion === PUBLIC_RESEARCH_RUN_VERSION) {
      await assertFreshPublicResearchPermission({ actorUserId: args.actorUserId, scopes: args.scopes, runtime, session })
      if (row.publicResearch?.plan?.mode === 'OFFLINE')
        await verifyPublicResearchFixtureReadScope({ runtimeInstance: runtime, actorUserId: args.actorUserId, session })
      await verifyPublicResearchLedger(row, Date.now() + 6000, session)
    }
    if (row.status === 'CANCELLED') { await verifyTerminal(row, Date.now() + 6000, session); return }
    if (terminal(row)) { await verifyTerminal(row, Date.now() + 6000, session); fail('ACQUISITION_ALREADY_COMPLETED', 'This Run already completed. Its saved material is unchanged.', 409, args.runId) }
    if (!cancellationEligible(row, runtime, args.actorUserId)
      || row.contractVersion === PUBLIC_RESEARCH_RUN_VERSION && !await publicResearchCancellationCurrent(row, runtime, args, session))
      fail('ACQUISITION_CANCELLATION_UNAVAILABLE', 'The current revision does not permit this cancellation.', 409, args.runId)
    await verifiedAudit(row, row.admissionAuditId, 'QUEUED', Date.now() + 6000, session)
    if (row.startedAt) await verifiedAudit(row, row.startAuditId, 'RUNNING', Date.now() + 6000, session)
    if (row.status === 'RUNNING' && !row.startedAt || row.status === 'QUEUED' && (row.startedAt || row.startAuditId || row.startAuditSignatureVersion))
      fail('ACQUISITION_RECEIPT_UNVERIFIED', 'Attempt start could not be verified.', 503, args.runId)
    const context = { runtime, scope, row, actorUserId: args.actorUserId, runId: row.runId, executionAttemptId: row.executionAttemptId,
      requestFingerprint: row.requestFingerprint, researchConfiguration: row.researchConfiguration, auditRequest: { requestId: args.requestId } }
    const completedAt = new Date(), outcomes = row.inputs.map(({ kind, inputIndex }) => ({ kind, inputIndex,
      status: 'CANCELLED', evidenceObjectCount: 0, reason: 'CANCELLED_BEFORE_SAVE' }))
    const audit = await recordedAudit({ context, phase: 'CANCELLED', session, extra: {
      outcomeHash: snapshotHash(outcomes), canonicalSaved: false, outputStateVersion: null, saveAuditId: null, saveAuditSignature: null,
      cancellationStage: row.startedAt ? 'RUNNING' : 'QUEUED', cancelledAt: completedAt.toISOString(), workerStopConfirmed: false,
      ...publicResearchAuditFields(row),
    } })
    const fields = { status: 'CANCELLED', active: false, canonicalSaved: false, reason: 'CANCELLED_BEFORE_SAVE', outcomes, completedAt,
      terminalAuditId: audit._id, terminalAuditSignatureVersion: audit.signatureVersion }
    await new RuntimeAcquisitionRun({ ...row, ...fields }).validate()
    const changed = await RuntimeAcquisitionRun.collection.updateOne({ ...identity(context), status: row.status, active: true }, { $set: fields }, { session })
    if (changed.modifiedCount !== 1) fail('ACQUISITION_RUN_STALE', 'Completion or cancellation already owns this Run.', 409, args.runId)
  })
  return getAcquisitionRun(args)
}
