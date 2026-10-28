import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import { assertControlledReplayProvenancePairs, controlledReplayProvenanceForRow } from './controlledReplayContract.js'
import mongoose from 'mongoose'
import { resolveRuntimeStateVersion } from './runtimeStateVersionService.js'

const origin = Symbol('native-controlled-replay-origin')
const witnesses = new WeakMap()
const fail = (reason = 'CONTROLLED_REPLAY_ISOLATION_INVALID', status = 409) => {
  throw Object.assign(new Error('Controlled replay runtime isolation could not be verified.'), {
    status, code: status === 503 ? 'SERVICE_UNAVAILABLE' : 'CONFLICT', details: { reason },
  })
}
const need = condition => { if (!condition) fail() }
const data = (value, depth = 0) => {
  need(depth <= 2)
  if (typeof value === 'string') { need(value.length <= 240); return }
  need(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Object.getOwnPropertySymbols(value).length)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  need(Object.keys(descriptors).length <= 5)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    need(!['__proto__', 'prototype', 'constructor'].includes(key) && descriptor.enumerable && Object.hasOwn(descriptor, 'value'))
    data(descriptor.value, depth + 1)
  }
}
const exact = (value, keys) => need(value && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)))
const nativeScope = runtime => ({ customerId: String(runtime.customerId || ''), tenantId: String(runtime.tenantId || ''),
  runtimeInstanceId: String(runtime._id || runtime.id || runtime.runtimeInstanceId || '') })
const hasMarker = runtime => Object.hasOwn(runtime || {}, 'controlledReplayIsolation')
  || (runtime instanceof mongoose.Document && Object.hasOwn(runtime._doc, 'controlledReplayIsolation'))
export const validateControlledReplayIsolation = (marker, runtime) => {
  if (marker instanceof mongoose.Document) marker = marker.toObject({ depopulate: true })
  data(marker); exact(marker, ['contractVersion', 'classification', 'scope', 'runtimeInstanceKey', 'bindingDigest'])
  exact(marker.scope, ['customerId', 'tenantId', 'runtimeInstanceId'])
  need(marker.contractVersion === 'controlled-replay-runtime-isolation.v1' && marker.classification === 'CONTROLLED_SYNTHETIC_REPLAY'
    && Object.values(marker.scope).every(value => /^[a-f0-9]{24}$/.test(value))
    && /^[a-z0-9][a-z0-9._:-]{0,159}$/.test(marker.runtimeInstanceKey) && /^sha256:[a-f0-9]{64}$/.test(marker.bindingDigest))
  if (runtime) {
    const scope = nativeScope(runtime)
    need(Object.keys(scope).every(key => marker.scope[key] === scope[key]) && marker.runtimeInstanceKey === runtime.runtimeInstanceKey)
  }
  return JSON.parse(JSON.stringify(marker))
}
export const assertNoControlledReplayIsolation = runtime => {
  if (hasMarker(runtime) || witnesses.get(runtime) === true) fail('CONTROLLED_REPLAY_ISOLATED')
  return runtime
}
const setWitness = (runtime, present) => {
  witnesses.set(runtime, present)
  Object.defineProperty(runtime, origin, { value: present, enumerable: false, configurable: true })
  return runtime
}
export const copyControlledReplayIsolationWitness = (source, target) => {
  if (witnesses.has(source)) {
    const scope = nativeScope(source), targetScope = nativeScope(target)
    need(Object.keys(scope).every(key => scope[key] === targetScope[key]) && source.runtimeInstanceKey === target.runtimeInstanceKey)
    setWitness(target, witnesses.get(source) || witnesses.get(target) === true)
  }
  return target
}
export const attachNativeControlledReplayIsolation = async (runtime, { session = null, readBudget, maxTimeMS = 2000 } = {}) => {
  if (hasMarker(runtime)) return setWitness(runtime, true)
  const scope = nativeScope(runtime)
  const present = key => Object.hasOwn(runtime, key)
    || (runtime instanceof mongoose.Document && Object.hasOwn(runtime._doc, key))
  const versioned = present('stateVersion') || present('runtimeStateVersion')
  for (const key of ['stateVersion', 'runtimeStateVersion']) {
    if (present(key)) need(typeof runtime[key] === 'string' && runtime[key].length <= 200 && runtime[key].trim().length > 0)
  }
  const version = resolveRuntimeStateVersion(runtime)
  need(Object.values(scope).every(value => /^[a-f0-9]{24}$/.test(value))
    && typeof runtime.runtimeInstanceKey === 'string' && /^[a-z0-9][a-z0-9._:-]{0,159}$/.test(runtime.runtimeInstanceKey)
    && !version.errorCode)
  const filter = { ...scope, runtimeInstanceKey: runtime.runtimeInstanceKey,
    ...(versioned ? { stateVersion: version.stateVersion } : {}),
    current: true, controlledReplayProvenance: { $exists: true } }
  let controlled = false
  for (const model of [RuntimeEvidenceSource, RuntimeEvidenceObject]) {
    const budget = readBudget ? readBudget() : {}
    if (budget.timeoutMS !== undefined && (!Number.isFinite(budget.timeoutMS) || budget.timeoutMS <= 0)) fail('CONTROLLED_REPLAY_ISOLATION_UNAVAILABLE', 503)
    const timeout = Math.min(maxTimeMS, budget.maxTimeMS ?? maxTimeMS)
    if (!Number.isInteger(timeout) || timeout <= 0) fail('CONTROLLED_REPLAY_ISOLATION_UNAVAILABLE', 503)
    const query = model.findOne(filter).select({ _id: 1 }).maxTimeMS(timeout)
    if (typeof query.limit !== 'function' || typeof query.lean !== 'function') fail('CONTROLLED_REPLAY_ISOLATION_UNAVAILABLE', 503)
    query.limit(1)
    if (typeof query.batchSize === 'function') query.batchSize(1)
    if (session) query.session(session)
    if (readBudget) query.setOptions({ ...budget, maxTimeMS: timeout })
    const row = await query.lean()
    if (row === undefined) fail('CONTROLLED_REPLAY_ISOLATION_UNAVAILABLE', 503)
    if (row !== null) controlled = true
  }
  return setWitness(runtime, controlled)
}
export const deriveControlledReplayIsolation = (runtime, frameworkState) => {
  const pack = frameworkState?.evidence_pack || {}, evidenceObjects = pack.evidenceObjects || []
  const sources = pack.sourceRegistry || pack.lineage?.sources || [], lineage = pack.lineage?.sources
  need(Array.isArray(sources) && Array.isArray(evidenceObjects))
  const native = { ...nativeScope(runtime), runtimeInstanceKey: runtime.runtimeInstanceKey }
  assertControlledReplayProvenancePairs({ sources, evidenceObjects, native })
  if (lineage) {
    need(Array.isArray(lineage))
    assertControlledReplayProvenancePairs({ sources: lineage, evidenceObjects, native })
    assertControlledReplayProvenancePairs({ sources, evidenceObjects: lineage, native })
  }
  const descriptors = [...sources, ...(lineage || []), ...evidenceObjects]
    .map(row => controlledReplayProvenanceForRow(row, native)).filter(Boolean)
  const digests = [...new Set(descriptors.map(row => row.provenance.bindingDigest))]
  need(digests.length <= 1)
  const previous = hasMarker(runtime) ? validateControlledReplayIsolation(runtime.controlledReplayIsolation, runtime) : undefined
  if (previous && digests.length) need(previous.bindingDigest === digests[0])
  return previous || (digests.length ? validateControlledReplayIsolation({ contractVersion: 'controlled-replay-runtime-isolation.v1',
    classification: 'CONTROLLED_SYNTHETIC_REPLAY', scope: nativeScope(runtime), runtimeInstanceKey: runtime.runtimeInstanceKey,
    bindingDigest: digests[0] }, runtime) : undefined)
}
export const controlledReplayIsolationCas = runtime => ({ controlledReplayIsolation: hasMarker(runtime)
  ? validateControlledReplayIsolation(runtime.controlledReplayIsolation, runtime) : { $exists: false } })
export const controlledReplayIsolationWrite = (runtime, frameworkState, session) => {
  const marker = deriveControlledReplayIsolation(runtime, frameworkState)
  if (marker && !hasMarker(runtime) && session?.inTransaction?.() !== true) fail('CONTROLLED_REPLAY_ISOLATION_TRANSACTION_REQUIRED', 503)
  return marker ? { controlledReplayIsolation: marker } : {}
}
export const controlledReplayIsolationAudit = (runtime, frameworkState) => {
  const marker = deriveControlledReplayIsolation(runtime, frameworkState)
  return marker ? { controlledReplayIsolation: { from: hasMarker(runtime) ? runtime.controlledReplayIsolation : null, to: marker } } : {}
}
export const controlledReplayIsolationRollback = runtime => hasMarker(runtime)
  ? { $set: { controlledReplayIsolation: validateControlledReplayIsolation(runtime.controlledReplayIsolation, runtime) } }
  : { $unset: { controlledReplayIsolation: 1 } }
export const createControlledReplayIsolationSchema = mongoose => new mongoose.Schema({
  contractVersion: String, classification: String, scope: { type: new mongoose.Schema({ customerId: String,
    tenantId: String, runtimeInstanceId: String }, { _id: false, strict: 'throw' }), default: undefined },
  runtimeInstanceKey: String, bindingDigest: String,
}, { _id: false, strict: 'throw' })
