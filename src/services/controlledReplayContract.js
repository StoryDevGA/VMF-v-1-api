import { z } from 'zod'
import { snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'
import { validateSourceCapture, validateEvidenceSupport } from './sourceEvidenceContract.js'

const fail = () => { throw Object.assign(new Error('Controlled replay metadata is invalid.'), {
  status: 409, code: 'CONFLICT', details: { reason: 'CONTROLLED_REPLAY_CONTRACT_INVALID' },
}) }
const requireValue = condition => { if (!condition) fail() }
// Check descriptors before schemas or hashing can read values. This contract has no arrays.
const assertData = (value, depth = 0) => {
  requireValue(depth <= 4)
  if (typeof value === 'string') {
    requireValue(value.length <= 240 && !Array.from(value).some(character => {
      const code = character.charCodeAt(0)
      return code < 32 || (code >= 127 && code <= 159)
    }))
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++index)
        requireValue(next >= 0xdc00 && next <= 0xdfff)
      } else requireValue(code < 0xdc00 || code > 0xdfff)
    }
    return
  }
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value))) return
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Object.getOwnPropertySymbols(value).length)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  requireValue(Object.keys(descriptors).length <= 20)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    requireValue(!['__proto__', 'prototype', 'constructor'].includes(key)
      && descriptor.enumerable && Object.hasOwn(descriptor, 'value'))
    assertData(descriptor.value, depth + 1)
  }
}
const exact = (value, keys) => {
  requireValue(value && typeof value === 'object' && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key)))
}
const bindingId = /^[a-z0-9][a-z0-9._-]{0,159}$/
const token = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/
const isToken = value => typeof value === 'string' && token.test(value)
const objectId = /^[a-f0-9]{24}$/
const stateVersion = /^rsv2:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const fixture = Object.freeze({ fixtureId: 'ss049-ac8-long-page-r1', fixtureVersion: 1,
  fixtureFileSha256: '7b7fe9a7819a71a25a043a73d7de1f9ed5b2689c36332ca981e65d7422771fd9',
  htmlSha256: '7f89c175b0da167969061551865ee67ad42b793283e61aecaec9f84aadc35777',
  sourceUrl: 'https://controlled-context.example/case-study' })

export const controlledReplaySelectorSchema = z.unknown().superRefine((value, context) => {
  try { assertData(value); exact(value, ['bindingId']) } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Controlled replay requires a strict binding selector.' })
  }
}).pipe(z.object({ bindingId: z.string().regex(bindingId) }).strict())

export const assertControlledReplayNotActivated = payload => {
  if (payload && Object.hasOwn(payload, 'controlledReplay')) throw Object.assign(
    new Error('Controlled replay is not activated.'), {
      status: 409, code: 'CONFLICT', details: { reason: 'CONTROLLED_REPLAY_NOT_ACTIVATED' },
    })
}

// Positive results establish metadata consistency only, never native authority or isolation.
export const assertStoredControlledReplayBinding = binding => {
  assertData(binding)
  exact(binding, ['contractVersion', 'bindingId', 'bindingVersion', 'classification', 'environment', 'scope',
    'revisionId', 'basisStateVersion', 'actorUserId', 'authorityRef', 'isolationRef', 'fixture'])
  exact(binding.scope, ['customerId', 'tenantId', 'runtimeInstanceId'])
  requireValue(Object.values(binding.scope).every(id => objectId.test(id)) && objectId.test(binding.actorUserId)
    && isToken(binding.revisionId) && binding.revisionId.length <= 160 && stateVersion.test(binding.basisStateVersion)
    && isToken(binding.authorityRef) && isToken(binding.isolationRef)
    && binding.contractVersion === 'controlled-replay-binding.v1' && typeof binding.bindingId === 'string' && bindingId.test(binding.bindingId)
    && Number.isSafeInteger(binding.bindingVersion) && binding.bindingVersion > 0
    && binding.classification === 'CONTROLLED_SYNTHETIC_REPLAY' && binding.environment === 'DEVELOPMENT_TEST')
  exact(binding.fixture, Object.keys(fixture))
  for (const key of Object.keys(fixture)) requireValue(binding.fixture[key] === fixture[key])
  return binding
}
export const assertControlledReplayBinding = (binding, context) => {
  assertStoredControlledReplayBinding(binding); assertData(context)
  exact(context, ['environment', 'scope', 'revisionId', 'basisStateVersion', 'actorUserId', 'authorityRef',
    'isolationRef', 'runtimeStatus', 'locked', 'published', 'heldSs044Family', 'parlon'])
  for (const row of [binding, context]) {
    exact(row.scope, ['customerId', 'tenantId', 'runtimeInstanceId'])
    requireValue(Object.values(row.scope).every(id => objectId.test(id)) && objectId.test(row.actorUserId)
      && isToken(row.revisionId) && row.revisionId.length <= 160 && stateVersion.test(row.basisStateVersion)
      && isToken(row.authorityRef) && isToken(row.isolationRef))
  }
  requireValue(binding.contractVersion === 'controlled-replay-binding.v1' && typeof binding.bindingId === 'string' && bindingId.test(binding.bindingId)
    && Number.isSafeInteger(binding.bindingVersion) && binding.bindingVersion > 0
    && binding.classification === 'CONTROLLED_SYNTHETIC_REPLAY' && binding.environment === 'DEVELOPMENT_TEST'
    && ['DRAFT', 'ACTIVE'].includes(context.runtimeStatus)
    && ['locked', 'published', 'heldSs044Family', 'parlon'].every(key => context[key] === false))
  for (const key of ['environment', 'revisionId', 'basisStateVersion', 'actorUserId', 'authorityRef', 'isolationRef']) {
    requireValue(binding[key] === context[key])
  }
  for (const key of Object.keys(binding.scope)) requireValue(binding.scope[key] === context.scope[key])
  return binding
}

export const controlledReplayBindingDigest = (binding, context) => `sha256:${snapshotHash({
  contractVersion: 'controlled-replay-binding-digest.v1', binding: assertControlledReplayBinding(binding, context),
})}`

export const storedControlledReplayBindingDigest = binding => `sha256:${snapshotHash({ contractVersion: 'controlled-replay-binding-digest.v1',
  binding: assertStoredControlledReplayBinding(binding) })}`
const assertStoredProvenance = (provenance, binding) => {
  const digest = storedControlledReplayBindingDigest(binding)
  assertData(provenance)
  const expected = { contractVersion: 'controlled-replay-provenance.v1', classification: 'CONTROLLED_SYNTHETIC_REPLAY',
    operation: 'CONTROLLED_HTML_REPLAY_CAPTURE', adapter: 'controlled-html-replay-v1', bindingId: binding.bindingId,
    bindingVersion: binding.bindingVersion, bindingDigest: digest, ...binding.fixture }
  exact(provenance, Object.keys(expected))
  for (const key of Object.keys(expected)) requireValue(provenance[key] === expected[key])
  return provenance
}
export const assertControlledReplayProvenance = (provenance, binding, context) => {
  assertControlledReplayBinding(binding, context)
  return assertStoredProvenance(provenance, binding)
}

export const validateStoredControlledReplayProvenance = (descriptor, native) => {
  assertData(descriptor); exact(descriptor, ['binding', 'provenance'])
  assertStoredProvenance(descriptor.provenance, descriptor.binding)
  if (native) {
    for (const key of ['customerId', 'tenantId', 'runtimeInstanceId']) {
      requireValue(String(native[key] || '') === descriptor.binding.scope[key])
    }
    requireValue(native.runtimeInstanceKey === descriptor.binding.revisionId)
  }
  // The original admission basis intentionally does not equal a later output stateVersion.
  return JSON.parse(JSON.stringify(descriptor))
}
export const controlledReplayProvenanceForRow = (row, native) => {
  const property = Object.getOwnPropertyDescriptor(row, 'controlledReplayProvenance')
  if (!property || ('value' in property && property.value === undefined)) return undefined
  requireValue(Object.hasOwn(property, 'value') && property.enumerable)
  const descriptor = validateStoredControlledReplayProvenance(property.value,
    native || (Object.hasOwn(row, 'runtimeInstanceId') ? row : undefined))
  const conflictFields = ['adapter', 'extractionMethod', 'acquisitionMethod', 'operation', 'sourceType', 'type', 'ingestionMode']
  requireValue(conflictFields.every(key =>
    !/website-html-fetch|website_acquisition|public[ _-]?research|live[ _-]?fetch/i.test(String(row[key] || '')))
    && row.acquisitionStatus !== 'ACQUIRED' && row.status !== 'ACQUIRED')
  if (row.sourceCapture !== undefined || row.evidenceSupport !== undefined) {
    // Typed mapper/model projections deliberately omit acquisitionMethod. A root
    // scope-only context (including isolation derivation) cannot grant this shape.
    const typedProjection = native !== undefined && stateVersion.test(native.stateVersion)
      && native.sourceStateVersion === native.stateVersion && row.stateVersion === native.stateVersion
      && row.sourceStateVersion === native.sourceStateVersion && typeof native.current === 'boolean' && row.current === native.current
      && /^sha256:[a-f0-9]{64}$/.test(native.sourceHash) && row.sourceHash === native.sourceHash
      && objectId.test(String(native.migrationReceiptId)) && String(row.migrationReceiptId) === String(native.migrationReceiptId)
      && ['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey'].every(key => String(row[key]) === String(native[key]))
    requireValue((row.sourceType === undefined || row.sourceType === 'WEBSITE' || typedProjection && row.sourceType === '')
      && (row.type === undefined || row.type === 'CONTROLLED_HTML_REPLAY')
      && (row.evidenceSupport !== undefined || row.evidenceObjectId !== undefined || row.acquisitionMethod !== undefined
        ? row.acquisitionMethod === 'CONTROLLED_HTML_REPLAY' || typedProjection && row.acquisitionMethod === undefined
        : row.sourceCapture !== undefined))
    if (row.sourceCapture !== undefined) {
      const capture = validateSourceCapture(row.sourceCapture, { sourceId: row.sourceId,
        contentHash: `sha256:${descriptor.binding.fixture.htmlSha256}` })
      requireValue(capture.captureReceipt.operation === descriptor.provenance.operation
        && capture.adapter === descriptor.provenance.adapter)
    }
    if (row.evidenceSupport !== undefined) {
      const support = validateEvidenceSupport(row.evidenceSupport, { sourceId: row.sourceId,
        ...(row.sourceCapture ? { sourceCapture: row.sourceCapture } : {}) })
      requireValue(support.originalContentHash === `sha256:${descriptor.binding.fixture.htmlSha256}`)
    }
  }
  for (const key of ['url', 'sourceUrl', 'sourceRef']) {
    if (row[key]) requireValue(row[key] === descriptor.binding.fixture.sourceUrl)
  }
  return descriptor
}

export const validateControlledReplayRunIdentity = row => {
  const descriptor = validateStoredControlledReplayProvenance(row.controlledReplayProvenance, {
    customerId: String(row.customerId), tenantId: String(row.tenantId), runtimeInstanceId: String(row.runtimeInstanceId),
    runtimeInstanceKey: row.runtimeInstanceKey })
  requireValue(row.contractVersion === 'controlled-acquisition-run.v1' && row.plannerVersion === 'controlled-acquisition-planner.v1'
    && String(row.actorUserId) === descriptor.binding.actorUserId && row.basisStateVersion === descriptor.binding.basisStateVersion
    && ['BUILD_EVIDENCE_PACK', 'REFRESH_EVIDENCE_PACK'].includes(row.actionKey))
  return descriptor
}
export const assertControlledReplayProvenancePairs = ({ sources = [], evidenceObjects = [], native } = {}) => {
  for (const source of sources) controlledReplayProvenanceForRow(source, native)
  for (const evidence of evidenceObjects) {
    const matches = sources.filter(source => source.sourceId === evidence.sourceId)
    const own = controlledReplayProvenanceForRow(evidence, native)
    const candidate = matches.length === 1 ? controlledReplayProvenanceForRow(matches[0], native) : undefined
    if (own !== undefined || candidate !== undefined) requireValue(matches.length === 1
      && own !== undefined && candidate !== undefined && snapshotHash(own) === snapshotHash(candidate))
  }
}
export const projectControlledReplayProvenance = (row, native) => {
  const descriptor = controlledReplayProvenanceForRow(row, native)
  return descriptor === undefined ? {} : { controlledReplayProvenance: descriptor }
}

// Schema factory only: no model registration, reads, writes or native eligibility lookup.
export const createControlledReplayProvenanceSchema = mongoose => {
  const nested = fields => new mongoose.Schema(fields, { _id: false, strict: 'throw' })
  const binding = nested({ contractVersion: String, bindingId: String, bindingVersion: Number, classification: String,
    environment: String, scope: { type: nested({ customerId: String, tenantId: String, runtimeInstanceId: String }), default: undefined },
    revisionId: String, basisStateVersion: String, actorUserId: String, authorityRef: String, isolationRef: String,
    fixture: { type: nested({ fixtureId: String, fixtureVersion: Number, fixtureFileSha256: String, htmlSha256: String, sourceUrl: String }), default: undefined } })
  const provenance = nested({ contractVersion: String, classification: String, operation: String, adapter: String,
    bindingId: String, bindingVersion: Number, bindingDigest: String, fixtureId: String, fixtureVersion: Number,
    fixtureFileSha256: String, htmlSha256: String, sourceUrl: String })
  return nested({ binding: { type: binding, default: undefined }, provenance: { type: provenance, default: undefined } })
}
