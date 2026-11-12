import { CONTROLLED_REPLAY_BINDINGS } from '../constants/controlledReplayBindings.js'
import { resolveControlledReplayAcquisition, assertControlledReplayCurrent } from './controlledReplayAcquisitionService.js'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import RuntimeInstance from '../models/RuntimeInstance.js'
import AuditLog from '../models/AuditLog.js'
import auditService from './auditService.js'
import { getRuntimeInstance, assertRuntimePermission } from './runtimeInstanceService.js'
import { isRuntimeLocked, isRuntimeLifecycleTruthImmutable } from './runtimeActionPolicyService.js'
import { requireCanonicalRuntimeStateVersion } from './runtimeStateVersionService.js'
import { ACQUISITION_TRANSACTION_OPTIONS } from './acquisitionRunService.js'
import { saveResearchConfigurationSchema, configurationPurpose, researchConfigurationHash,
  validateStoredResearchConfiguration, researchAvailability } from './researchConfigurationContract.js'

const fail = (reason, message, status = 409) => {
  throw Object.assign(new Error(message), { status, code: status === 503 ? 'SERVICE_UNAVAILABLE' : 'CONFLICT', details: { reason } })
}
const scopeFor = runtime => ({ customerId: String(runtime.customerId), tenantId: String(runtime.tenantId),
  runtimeInstanceId: String(runtime.id), runtimeInstanceKey: runtime.runtimeInstanceKey })
const editable = runtime => runtime.status === 'ACTIVE' && !isRuntimeLocked({ runtimeInstance: runtime })
  && !isRuntimeLifecycleTruthImmutable(runtime.framework_state)
const basisFor = runtime => ({ stateVersion: requireCanonicalRuntimeStateVersion(runtime), updatedAt: new Date(runtime.updatedAt).toISOString() })
const inTransaction = async work => {
  const session = await mongoose.startSession()
  try {
    let result
    await session.withTransaction(async () => { result = await work(session) }, ACQUISITION_TRANSACTION_OPTIONS)
    return result
  } finally { await session.endSession() }
}
const load = async (args, session) => {
  const runtime = await getRuntimeInstance({ scopes: args.scopes, runtimeInstanceId: args.runtimeInstanceId, session,
    maxTimeMS: 2000, metadataMaxTimeMS: 2000,
    projection: 'customerId tenantId runtimeInstanceKey runtimeType revision stateVersion runtimeStateVersion updatedAt status executionStatus lockedAt framework_state.lock framework_state.publish framework_state.lifecycle controlledReplayIsolation',
  })
  // Read the private path only after ordinary scoped runtime authorization.
  const row = await RuntimeInstance.findOne({ _id: runtime.id, customerId: runtime.customerId, tenantId: runtime.tenantId })
    .select({ researchConfiguration: 1 }).session(session).maxTimeMS(2000).lean()
  if (!row) fail('RESEARCH_CONFIGURATION_BASIS_CHANGED', 'The revision changed. Reload before saving.')
  const configuration = row.researchConfiguration === undefined ? null : validateStoredResearchConfiguration(row.researchConfiguration, runtime)
  if (configuration) {
    const audit = await AuditLog.findOne({ _id: configuration.saveAuditId, resourceId: runtime.id,
      'scope.customerId': runtime.customerId, 'scope.tenantId': runtime.tenantId,
      action: auditService.AUDIT_ACTIONS.RUNTIME_RESEARCH_CONFIGURATION_SAVED,
      resourceType: auditService.RESOURCE_TYPES.RuntimeInstance }).session(session).maxTimeMS(2000)
    if (!audit?.verifySignature() || String(audit.actorUserId) !== configuration.savedBy
      || audit.diff?.configurationVersion !== configuration.configurationVersion
      || audit.diff?.configurationHash !== configuration.configurationHash) {
      fail('RESEARCH_CONFIGURATION_AUDIT_UNVERIFIED', 'Saved research configuration audit could not be verified.', 503)
    }
  }
  return { runtime, configuration }
}
const fixtureStartFor = async ({ runtime, configuration, basis, canEdit, currency }, args, session) => {
  const unavailable = reason => ({ contractVersion: 'controlled-fixture-start.v1', eligible: false, reason })
  if (!configuration || !canEdit || currency !== 'CURRENT_BASIS') return unavailable('BASIS_UNAVAILABLE')
  const settings = configuration.settings
  if (settings.sources.length !== 1 || settings.sources[0] !== 'WEBSITE' || settings.startingUrls.length !== 1)
    return unavailable('SETTINGS_UNSUPPORTED')
  const candidates = CONTROLLED_REPLAY_BINDINGS.filter(entry => {
    const binding = entry.binding
    return binding?.scope?.customerId === String(runtime.customerId) && binding.scope.tenantId === String(runtime.tenantId)
      && binding.scope.runtimeInstanceId === String(runtime.id) && binding.revisionId === runtime.runtimeInstanceKey
      && binding.actorUserId === String(args.actorUserId) && binding.basisStateVersion === basis.stateVersion
      && binding.fixture?.sourceUrl === settings.startingUrls[0]
  })
  if (candidates.length !== 1) return unavailable(candidates.length ? 'REGISTRATION_AMBIGUOUS' : 'NOT_REGISTERED')
  try {
    await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes, customerId: runtime.customerId,
      tenantId: runtime.tenantId, permission: 'VMF_UPDATE', session, maxTimeMS: 2000 })
  } catch (error) { if (error.status === 403) return unavailable('UPDATE_NOT_PERMITTED'); throw error }
  const payload = { controlledReplay: { bindingId: candidates[0].binding.bindingId }, expectedUpdatedAt: basis.updatedAt,
    acquisitionProfile: configuration.coverage }
  let context
  try {
    context = await resolveControlledReplayAcquisition({ payload, runtimeInstance: runtime, actorUserId: args.actorUserId, actionKey: 'BUILD_EVIDENCE_PACK', session })
    assertControlledReplayCurrent(context, runtime, payload)
  } catch (error) { if (error.status === 409) return unavailable(error.details?.reason || 'AUTHORITY_UNVERIFIED'); throw error }
  return { contractVersion: 'controlled-fixture-start.v1', eligible: true, classification: 'CONTROLLED_SYNTHETIC_REPLAY',
    actorUserId: String(args.actorUserId), scope: scopeFor(runtime), basis,
    bindingId: context.descriptor.binding.bindingId, bindingDigest: context.descriptor.provenance.bindingDigest,
    fixture: context.descriptor.binding.fixture,
    selector: { configurationVersion: configuration.configurationVersion, configurationHash: configuration.configurationHash,
      basisStateVersion: basis.stateVersion } }
}
const view = async ({ runtime, configuration }, args, session) => {
  const basis = basisFor(runtime), canEdit = editable(runtime), currency = !configuration ? 'NOT_RECORDED'
    : configuration.basisStateVersion === basis.stateVersion && configuration.basisUpdatedAt === basis.updatedAt ? 'CURRENT_BASIS' : 'STALE_BASIS'
  return { contractVersion: 'public-research-configuration-read.v1', scope: scopeFor(runtime), basis, configuration,
    editable: canEdit, currency, availability: { ...researchAvailability({ configuration, basis, editable: canEdit, currency }),
      fixtureStart: await fixtureStartFor({ runtime, configuration, basis, canEdit, currency }, args, session) } }
}
export const getResearchConfiguration = args => inTransaction(async session => view(await load(args, session), args, session))

export const saveResearchConfiguration = async args => {
  const payload = saveResearchConfigurationSchema.parse(args.payload)
  const configurationVersion = randomUUID()
  return inTransaction(async session => {
    const current = await load(args, session), { runtime, configuration } = current
    await assertRuntimePermission({ actorUserId: args.actorUserId, scopes: args.scopes,
      customerId: runtime.customerId, tenantId: runtime.tenantId, permission: 'VMF_UPDATE', session, maxTimeMS: 2000 })
    if (!editable(runtime)) fail('RESEARCH_CONFIGURATION_LOCKED', 'Research settings cannot change this locked, published or inactive revision.')
    const basis = basisFor(runtime)
    if (payload.expectedUpdatedAt !== basis.updatedAt || payload.expectedStateVersion !== basis.stateVersion
      || payload.expectedConfigurationVersion !== (configuration?.configurationVersion || null)) {
      fail('RESEARCH_CONFIGURATION_STALE', 'The revision or saved configuration changed. Reload before saving.')
    }
    const record = { contractVersion: 'public-research-configuration.v1', configurationVersion, scope: scopeFor(runtime),
      basisStateVersion: basis.stateVersion, basisUpdatedAt: basis.updatedAt,
      contextSource: 'USER_PREPARED_CONTEXT_BRIEF', context: payload.context, coverage: payload.coverage,
      purpose: configurationPurpose(payload.context), settings: payload.settings, savedAt: new Date().toISOString(), savedBy: String(args.actorUserId) }
    record.configurationHash = researchConfigurationHash(record)
    const audit = await auditService.log({ actorUserId: args.actorUserId, scope: scopeFor(runtime),
      action: auditService.AUDIT_ACTIONS.RUNTIME_RESEARCH_CONFIGURATION_SAVED, resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
      resourceId: runtime.id, requestId: args.requestId,
      summary: 'Saved research configuration without executing research.',
      diff: { configurationVersion, configurationHash: record.configurationHash,
        previousConfigurationVersion: configuration?.configurationVersion || null, basisStateVersion: basis.stateVersion } },
    { session, throwOnError: true })
    if (!audit?._id || !audit.verifySignature()) fail('RESEARCH_CONFIGURATION_AUDIT_UNVERIFIED', 'Research configuration save audit is unavailable.', 503)
    record.saveAuditId = String(audit._id)
    validateStoredResearchConfiguration(record, runtime)
    const result = await RuntimeInstance.updateOne({ _id: runtime.id, customerId: runtime.customerId, tenantId: runtime.tenantId,
      runtimeInstanceKey: runtime.runtimeInstanceKey, updatedAt: runtime.updatedAt, status: runtime.status,
      ...(runtime.stateVersion ? { stateVersion: runtime.stateVersion } : { runtimeStateVersion: runtime.runtimeStateVersion }),
      'researchConfiguration.configurationVersion': configuration?.configurationVersion || { $exists: false } },
    { $set: { researchConfiguration: record } }, { session, runValidators: true, timestamps: false })
    if (result.matchedCount !== 1) fail('RESEARCH_CONFIGURATION_STALE', 'The revision or saved configuration changed. Reload before saving.')
    return view({ runtime, configuration: record }, args, session)
  })
}

// Existing action owner calls this only after controlled authority and replay lookup.
export const resolveResearchDispatchConfiguration = async ({ payload, fixtureUrl, ...args }) => {
  const data = await getResearchConfiguration(args), record = data.configuration, selector = payload.researchConfiguration
  if (!record || !data.editable || data.currency !== 'CURRENT_BASIS'
    || record.configurationVersion !== selector.configurationVersion || record.configurationHash !== selector.configurationHash
    || data.basis.stateVersion !== selector.basisStateVersion || data.basis.updatedAt !== payload.expectedUpdatedAt) {
    fail('RESEARCH_CONFIGURATION_STALE', 'Saved research settings or revision changed. Reload before dispatching.')
  }
  if (payload.acquisitionProfile !== record.coverage || record.settings.sources.length !== 1
    || record.settings.sources[0] !== 'WEBSITE' || record.settings.startingUrls.length !== 1
    || record.settings.startingUrls[0] !== fixtureUrl) {
    fail('RESEARCH_FIXTURE_SETTINGS_UNSUPPORTED', 'This controlled dispatch supports only its registered website fixture and saved coverage.')
  }
  return record
}
