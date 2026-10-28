import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import env from '../config/env.js'
import { CONTROLLED_REPLAY_BINDINGS, verifyControlledReplayAuthority,
  verifyControlledReplayExclusions } from '../constants/controlledReplayBindings.js'
import { controlledReplaySelectorSchema, assertStoredControlledReplayBinding, storedControlledReplayBindingDigest,
  validateStoredControlledReplayProvenance, assertControlledReplayBinding } from './controlledReplayContract.js'
import { isControlledSyntheticOutcomeRuntime } from './syntheticOutcomeIsolationService.js'
import { isRuntimeLocked, isRuntimeLifecycleTruthImmutable } from './runtimeActionPolicyService.js'
import { validateControlledReplayIsolation, assertNoControlledReplayIsolation } from './controlledReplayIsolationService.js'
import { buildControlledReplayEvidenceFromDecodedHtml } from './discoveryIntelligenceService.js'

const resolved = new WeakSet()
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const fail = reason => { throw Object.assign(new Error('Controlled replay is unavailable for this scope.'), {
  status: 409, code: 'CONFLICT', details: { reason },
}) }
const native = runtime => ({ customerId: String(runtime.customerId || ''), tenantId: String(runtime.tenantId || ''),
  runtimeInstanceId: String(runtime._id || runtime.id || ''), runtimeInstanceKey: runtime.runtimeInstanceKey })
export const assertResolvedControlledReplay = context => {
  if (!context || !resolved.has(context)) fail('CONTROLLED_REPLAY_NOT_ACTIVATED')
  return context
}
export const resolveControlledReplayAcquisition = async ({ payload, runtimeInstance, actorUserId, actionKey }) => {
  if (!payload || !Object.hasOwn(payload, 'controlledReplay')) return undefined
  const selector = controlledReplaySelectorSchema.safeParse(payload.controlledReplay)
  const entry = selector.success && CONTROLLED_REPLAY_BINDINGS.find(row => row.binding?.bindingId === selector.data.bindingId)
  if (!entry || !['BUILD_EVIDENCE_PACK', 'REFRESH_EVIDENCE_PACK'].includes(actionKey)) fail('CONTROLLED_REPLAY_NOT_ACTIVATED')
  const binding = JSON.parse(JSON.stringify(assertStoredControlledReplayBinding(entry.binding)))
  const authority = await verifyControlledReplayAuthority({ registration: entry, binding, runtimeInstance, actorUserId })
  if (authority?.authorityRef !== binding.authorityRef) fail('CONTROLLED_REPLAY_AUTHORITY_UNVERIFIED')
  const exclusions = await verifyControlledReplayExclusions({ registration: entry, binding, runtimeInstance, actorUserId })
  if (exclusions?.isolationRef !== binding.isolationRef || exclusions.parlon !== false || exclusions.heldSs044Family !== false)
    fail('CONTROLLED_REPLAY_PROTECTED_SCOPE_UNVERIFIED')
  const identity = native(runtimeInstance)
  if (Object.keys(binding.scope).some(key => binding.scope[key] !== identity[key])
    || binding.revisionId !== identity.runtimeInstanceKey || binding.actorUserId !== String(actorUserId)
    || !['development', 'test'].includes(env.nodeEnv) || env.appEnv !== 'development'
    || isControlledSyntheticOutcomeRuntime(runtimeInstance)) fail('CONTROLLED_REPLAY_CONTRACT_INVALID')
  if (payload.documentSources?.length || payload.predecessorRunId || payload.inputs !== undefined)
    fail('CONTROLLED_REPLAY_MIXED_INPUTS')
  const provenance = { contractVersion: 'controlled-replay-provenance.v1', classification: binding.classification,
    operation: 'CONTROLLED_HTML_REPLAY_CAPTURE', adapter: 'controlled-html-replay-v1', bindingId: binding.bindingId,
    bindingVersion: binding.bindingVersion, bindingDigest: storedControlledReplayBindingDigest(binding), ...binding.fixture }
  const descriptor = validateStoredControlledReplayProvenance({ binding, provenance }, identity)
  let bytes, asset
  try {
    bytes = await readFile(new URL('../runtime-contracts/controlled-replay/long-page.v1.json', import.meta.url))
    if (createHash('sha256').update(bytes).digest('hex') !== binding.fixture.fixtureFileSha256) throw new Error('Asset bytes changed.')
    asset = JSON.parse(bytes.toString('utf8'))
    if (typeof asset.html !== 'string' || !asset.html.isWellFormed()
      || createHash('sha256').update(asset.html).digest('hex') !== binding.fixture.htmlSha256) throw new Error('HTML changed.')
  } catch { fail('CONTROLLED_REPLAY_ASSET_UNVERIFIED') }
  const context = freeze({ descriptor, native: identity, actorUserId: String(actorUserId), html: asset.html,
    // Explicitly a component witness, never a native authority receipt.
    authority, exclusions })
  resolved.add(context)
  return context
}
export const assertControlledReplayCurrent = (context, runtime, payload) => {
  const { descriptor, native: identity } = assertResolvedControlledReplay(context)
  validateStoredControlledReplayProvenance(descriptor, native(runtime))
  if (String(runtime._id || runtime.id) !== identity.runtimeInstanceId || runtime.stateVersion !== descriptor.binding.basisStateVersion
    || !payload.expectedUpdatedAt || new Date(runtime.updatedAt).getTime() !== new Date(payload.expectedUpdatedAt).getTime()
    || runtime.status !== 'ACTIVE' || isRuntimeLocked({ runtimeInstance: runtime })
    || isRuntimeLifecycleTruthImmutable(runtime.framework_state)) fail('CONTROLLED_REPLAY_CURRENT_BASIS_INVALID')
  if (runtime.controlledReplayIsolation !== undefined) {
    if (validateControlledReplayIsolation(runtime.controlledReplayIsolation, runtime).bindingDigest !== descriptor.provenance.bindingDigest)
      fail('CONTROLLED_REPLAY_ISOLATION_INVALID')
  } else assertNoControlledReplayIsolation(runtime)
  assertControlledReplayBinding(descriptor.binding, { environment: 'DEVELOPMENT_TEST', scope: descriptor.binding.scope,
    revisionId: runtime.runtimeInstanceKey, basisStateVersion: runtime.stateVersion, actorUserId: context.actorUserId,
    authorityRef: descriptor.binding.authorityRef, isolationRef: descriptor.binding.isolationRef, runtimeStatus: runtime.status,
    locked: isRuntimeLocked({ runtimeInstance: runtime }), published: isRuntimeLifecycleTruthImmutable(runtime.framework_state),
    heldSs044Family: context.exclusions.heldSs044Family || isControlledSyntheticOutcomeRuntime(runtime), parlon: context.exclusions.parlon })
}
export const buildResolvedControlledReplay = ({ context, acquisitionProfile, runId, attemptId, capturedAt }) => {
  const { descriptor, html } = assertResolvedControlledReplay(context)
  return buildControlledReplayEvidenceFromDecodedHtml({ html, descriptor, acquisitionProfile, runId, attemptId, capturedAt })
}
