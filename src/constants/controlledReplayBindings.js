import mongoose from 'mongoose'
import env from '../config/env.js'
import User from '../models/User.js'
import Role from '../models/Role.js'
import Customer from '../models/Customer.js'
import Tenant from '../models/Tenant.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import { assertStoredControlledReplayBinding, storedControlledReplayBindingDigest } from '../services/controlledReplayContract.js'
import { isControlledSyntheticOutcomeRuntime } from '../services/syntheticOutcomeIsolationService.js'

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
// Gary's explicit local-fixture instruction, recorded in HCP109. This reviewed
// source allowlist grants no provider, hosted, customer or Product authority.
const registration = freeze({
  local: { database: 'ss049_provider_free_slice', customerName: 'SS049 Local Public Research Fixture',
    tenantName: 'SS049 Local Research', actorName: 'SS049 Local Research Operator', roleKey: 'LOCAL_RESEARCH_OPERATOR',
    instructionSha256: 'a660fd22c9d44f654a93839ee6f5ebde1e73dfec835dad6c4c05eff298742170' },
  binding: { contractVersion: 'controlled-replay-binding.v1', bindingId: 'local-public-research.1', bindingVersion: 1,
    classification: 'CONTROLLED_SYNTHETIC_REPLAY', environment: 'DEVELOPMENT_TEST',
    scope: { customerId: '222222222222222222222222', tenantId: '333333333333333333333333', runtimeInstanceId: '111111111111111111111111' },
    revisionId: 'provider-free-replay-r1', basisStateVersion: 'rsv2:11111111-1111-4111-8111-111111111111',
    actorUserId: '444444444444444444444444', authorityRef: 'ss049-local-fixture-authority.2026-11-12.v1',
    isolationRef: 'ss049-local-fixture-exclusions.2026-11-12.v1',
    fixture: { fixtureId: 'ss049-ac8-long-page-r1', fixtureVersion: 1,
      fixtureFileSha256: '7b7fe9a7819a71a25a043a73d7de1f9ed5b2689c36332ca981e65d7422771fd9',
      htmlSha256: '7f89c175b0da167969061551865ee67ad42b793283e61aecaec9f84aadc35777',
      sourceUrl: 'https://controlled-context.example/case-study' } },
})
export const CONTROLLED_REPLAY_BINDINGS = Object.freeze([registration])

const unavailable = (reason, status = 409) => { throw Object.assign(new Error('Controlled local fixture could not be verified.'), {
  status, code: status === 503 ? 'SERVICE_UNAVAILABLE' : 'CONFLICT', details: { reason },
}) }
const requireLocal = (args, reason) => {
  const binding = registration.binding, runtime = args?.runtimeInstance, connection = mongoose.connection
  if (args?.registration !== registration || !runtime || String(args.actorUserId) !== binding.actorUserId
    || !['development', 'test'].includes(env.nodeEnv) || env.appEnv !== 'development'
    || connection.readyState !== 1 || connection.host !== '127.0.0.1' || connection.name !== registration.local.database)
    unavailable(reason)
  const client = connection.getClient(), seeds = client.options.hosts, servers = client.topology?.description?.servers
  const address = `127.0.0.1:${connection.port}`
  if (!Array.isArray(seeds) || seeds.length !== 1 || seeds[0].host !== '127.0.0.1'
    || !servers || servers.size !== 1 || !servers.has(address)) unavailable(reason)
  try {
    assertStoredControlledReplayBinding(args.binding)
    if (storedControlledReplayBindingDigest(args.binding) !== storedControlledReplayBindingDigest(binding)) unavailable(reason)
  } catch { unavailable(reason) }
  if (String(runtime._id || runtime.id) !== binding.scope.runtimeInstanceId
    || ['customerId', 'tenantId'].some(key => String(runtime[key]) !== binding.scope[key])
    || runtime.runtimeInstanceKey !== binding.revisionId) unavailable(reason)
}
const read = async (query, session, reason) => {
  try { return await query.session(session || null).maxTimeMS(2000).lean() }
  catch { unavailable(reason, 503) }
}
export const verifyControlledReplayAuthority = async args => {
  const reason = 'CONTROLLED_REPLAY_AUTHORITY_UNVERIFIED'
  requireLocal(args, reason)
  const { binding, local } = registration
  const user = await read(User.findById(binding.actorUserId).select('name isActive memberships tenantMemberships vmfGrants'), args.session, 'CONTROLLED_REPLAY_AUTHORITY_UNAVAILABLE')
  const roles = await read(Role.find({ key: local.roleKey }).select('key scope isActive permissions').limit(2), args.session, 'CONTROLLED_REPLAY_AUTHORITY_UNAVAILABLE')
  const role = roles.length === 1 ? roles[0] : null
  const membership = user?.tenantMemberships?.[0]
  if (!user || user.name !== local.actorName || user.isActive !== true || !Array.isArray(user.memberships) || user.memberships.length
    || !Array.isArray(user.vmfGrants) || user.vmfGrants.length || !Array.isArray(user.tenantMemberships) || user.tenantMemberships.length !== 1
    || String(membership?.customerId) !== binding.scope.customerId || String(membership?.tenantId) !== binding.scope.tenantId
    || !Array.isArray(membership?.roles) || membership.roles.length !== 1 || membership.roles[0] !== local.roleKey
    || !role || role.isActive !== true || role.scope !== 'TENANT'
    || !Array.isArray(role.permissions) || !['VMF_VIEW', 'VMF_UPDATE'].every(permission => role.permissions.includes(permission))) unavailable(reason)
  return { classification: 'LOCAL_ENGINEERING_FIXTURE', authorityRef: binding.authorityRef }
}
export const verifyControlledReplayExclusions = async args => {
  const reason = 'CONTROLLED_REPLAY_PROTECTED_SCOPE_UNVERIFIED'
  requireLocal(args, reason)
  const { binding, local } = registration, scope = binding.scope
  const customer = await read(Customer.findById(scope.customerId).select('name status topology defaultTenantId'), args.session, 'CONTROLLED_REPLAY_EXCLUSIONS_UNAVAILABLE')
  const tenant = await read(Tenant.findById(scope.tenantId).select('name customerId status isDefault tenantAdminUserIds'), args.session, 'CONTROLLED_REPLAY_EXCLUSIONS_UNAVAILABLE')
  const runtime = await read(RuntimeInstance.findOne({ _id: scope.runtimeInstanceId, customerId: scope.customerId, tenantId: scope.tenantId })
    .select('customerId tenantId runtimeInstanceKey runtimeType frameworkKey stateVersion status revision'), args.session, 'CONTROLLED_REPLAY_EXCLUSIONS_UNAVAILABLE')
  if (!customer || customer.name !== local.customerName || customer.status !== 'ACTIVE' || customer.topology !== 'SINGLE_TENANT'
    || String(customer.defaultTenantId) !== scope.tenantId || !tenant || tenant.name !== local.tenantName
    || String(tenant.customerId) !== scope.customerId || tenant.status !== 'ENABLED' || tenant.isDefault !== true
    || !Array.isArray(tenant.tenantAdminUserIds) || tenant.tenantAdminUserIds.length !== 1 || String(tenant.tenantAdminUserIds[0]) !== binding.actorUserId
    || !runtime || runtime.runtimeInstanceKey !== binding.revisionId
    || runtime.runtimeType !== 'VALUE_NARRATIVE' || runtime.frameworkKey !== 'VMF' || runtime.status !== 'ACTIVE'
    || runtime.revision?.revisionNumber !== 1 || runtime.revision.parentRuntimeId
    || runtime.revision.parentRuntimeInstanceKey
    || runtime.revision.rootRuntimeId && String(runtime.revision.rootRuntimeId) !== scope.runtimeInstanceId
    || runtime.revision.rootRuntimeInstanceKey && runtime.revision.rootRuntimeInstanceKey !== binding.revisionId
    || isControlledSyntheticOutcomeRuntime(runtime)) unavailable(reason)
  return { classification: 'LOCAL_ENGINEERING_FIXTURE', isolationRef: binding.isolationRef, parlon: false, heldSs044Family: false }
}
