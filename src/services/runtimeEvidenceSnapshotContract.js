import mongoose from 'mongoose'
import { generateChecksum } from './governanceAudit/checksumService.js'

export const EVIDENCE_MEMBERSHIP_VERSION = 'runtime-evidence-membership.v1'
export const PUBLISHED_EVIDENCE_MEMBERSHIP_VERSION = 'published-evidence-membership.v1'
export const EVIDENCE_MATERIAL_HASH_ALGORITHM = 'sha256-canonical-json-housekeeping-excluded.v1'
export const EVIDENCE_SNAPSHOT_INTERNAL_READ = Symbol('evidence-snapshot-internal-read')
export const EVIDENCE_MEMBER_LIMITS = Object.freeze({ sources: 1000, evidence: 5000, sections: 100 })
export const EVIDENCE_SNAPSHOT_MAX_BYTES = 512 * 1024
const hashPattern = /^[a-f0-9]{64}$/
const statePattern = /^rsv2:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
const housekeeping = new Set(['current', 'updatedAt', '__v'])
const id = value => String(value || '')
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
export const membershipError = reason => Object.assign(new Error('The frozen evidence membership could not be verified.'), {
  code: 'RUNTIME_EVIDENCE_MEMBERSHIP_INVALID', status: 409, details: { reason },
})
const requireValue = (condition, reason) => { if (!condition) throw membershipError(reason) }
const exact = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 240 && value === value.trim()
  && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
const objectId = value => /^[a-f0-9]{24}$/.test(id(value))

// Native BSON is converted explicitly. Accessors, unsafe keys and sparse arrays
// cannot quietly alter the material being signed. Undefined optional fields omit.
export const membershipJson = value => {
  const seen = new WeakSet()
  const visit = (item, depth) => {
    requireValue(depth <= 40, 'MATERIAL_DEPTH')
    if (item === undefined) return undefined
    if (item instanceof mongoose.Types.ObjectId) return item.toHexString()
    if (item instanceof Date) { requireValue(Number.isFinite(item.getTime()), 'MATERIAL_TIME'); return item.toISOString() }
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number') { requireValue(Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item)), 'MATERIAL_NUMBER'); return item }
    requireValue(typeof item === 'object' && !seen.has(item) && Object.getOwnPropertySymbols(item).length === 0, 'MATERIAL_OBJECT')
    seen.add(item)
    if (Array.isArray(item)) {
      requireValue(Object.getPrototypeOf(item) === Array.prototype && Object.keys(item).length === item.length
        && Object.getOwnPropertyNames(item).length === item.length + 1, 'MATERIAL_ARRAY')
      const result = []
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index))
        requireValue(descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value'), 'MATERIAL_ACCESSOR')
        requireValue(descriptor.value !== undefined, 'MATERIAL_ARRAY_VALUE')
        result.push(visit(descriptor.value, depth + 1))
      }
      seen.delete(item); return result
    }
    requireValue(plain(item), 'MATERIAL_PROTOTYPE')
    const result = {}
    const descriptors = Object.getOwnPropertyDescriptors(item)
    for (const key of Object.getOwnPropertyNames(item)) {
      requireValue(!forbidden.has(key) && descriptors[key].enumerable === true
        && Object.hasOwn(descriptors[key], 'value'), 'MATERIAL_ACCESSOR')
    }
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key]
      const normalized = visit(descriptor.value, depth + 1)
      if (normalized !== undefined) result[key] = normalized
    }
    seen.delete(item); return result
  }
  return visit(value, 0)
}
export const evidenceMaterialHash = row => {
  const material = membershipJson(row)
  requireValue(plain(material), 'MATERIAL_ROW')
  for (const key of housekeeping) delete material[key]
  return generateChecksum(material)
}
export const membershipHash = body => generateChecksum(membershipJson(body))
export const evidenceSnapshotScope = runtime => {
  const revision = runtime.revision || {}
  const number = revision.revisionNumber
  requireValue(Number.isSafeInteger(number) && number > 0, 'REVISION_INVALID')
  requireValue(number === 1 || revision.rootRuntimeId, 'ROOT_REVISION_MISSING')
  const result = {
    customerId: id(runtime.customerId), tenantId: id(runtime.tenantId),
    runtimeInstanceId: id(runtime._id || runtime.id), runtimeInstanceKey: runtime.runtimeInstanceKey,
    rootRuntimeInstanceId: id(revision.rootRuntimeId || runtime._id || runtime.id),
    rootRuntimeInstanceKey: revision.rootRuntimeInstanceKey || runtime.runtimeInstanceKey,
    revisionNumber: number, workspaceId: runtime.workspaceId ?? '',
  }
  requireValue(['customerId', 'tenantId', 'runtimeInstanceId', 'rootRuntimeInstanceId'].every(key => objectId(result[key]))
    && text(result.runtimeInstanceKey) && text(result.rootRuntimeInstanceKey)
    && typeof result.workspaceId === 'string' && result.workspaceId === result.workspaceId.trim() && result.workspaceId.length <= 160, 'SCOPE_INVALID')
  return result
}
export const evidenceSnapshotPackage = runtime => {
  const result = { packageId: id(runtime.packageId), packageKey: runtime.packageKey, packageVersion: runtime.packageVersion,
    dependencyLockId: runtime.dependencyLockId, activationId: runtime.activationId, deploymentId: runtime.deploymentId }
  requireValue(objectId(result.packageId) && Object.entries(result).every(([key, value]) => key === 'packageId' || text(value)), 'PACKAGE_INVALID')
  return result
}
const refs = value => {
  requireValue(Array.isArray(value) && value.every(text), 'REFERENCES_INVALID')
  return [...new Set(value)].sort()
}
export const resolveMembershipReferences = (references, evidence) => refs(references).flatMap(reference => {
  const matches = evidence.filter(row => row.evidenceObjectId === reference || row.sourceId === reference)
  requireValue(matches.length > 0, 'REFERENCE_UNRESOLVED')
  return matches.map(row => row.evidenceObjectId)
})
const member = (row, key) => ({ [key]: row[key], storageId: id(row._id), stateVersion: row.stateVersion,
  sourceStateVersion: row.sourceStateVersion, sourceHash: row.sourceHash, materialHash: evidenceMaterialHash(row) })
const contextVersion = 'section-context-reference.v1'
const contextTypes = Object.freeze({
  section_input: ['USER_CONTEXT', 'USER_CONTEXT', 'Customer section context'],
  scoped_view: ['DISCOVERY', 'DISCOVERY_FIELD', 'Section-scoped evidence view'],
})
const hasEvidence = (reference, evidence) => evidence.some(row => row.evidenceObjectId === reference || row.sourceId === reference)
const contextText = value => {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(contextText).filter(Boolean).join('; ')
  if (plain(value)) {
    if (typeof value.summary === 'string') return value.summary.trim()
    if (typeof value.content === 'string') return value.content.trim()
    return Object.values(value).map(contextText).filter(Boolean).join('; ')
  }
  return ''
}
const bindSectionContext = (detail, references, evidence) => {
  const intelligence = detail?.intelligence || {}, scoped = intelligence.scopedEvidence
  const bindings = []
  for (const refKey of references.supportingEvidenceRefs || []) {
    if (!Object.hasOwn(contextTypes, refKey)) continue
    const supports = (Array.isArray(intelligence.supportingEvidence) ? intelligence.supportingEvidence : []).filter(item => item?.refKey === refKey)
    const mirrors = (Array.isArray(scoped?.sourceRefs) ? scoped.sourceRefs : []).filter(item => item?.refKey === refKey)
    if (hasEvidence(refKey, evidence)) {
      requireValue(supports.length === 0 && mirrors.length === 0, 'CONTEXT_REFERENCE_AMBIGUOUS')
      continue
    }
    requireValue(supports.length === 1 && mirrors.length === 1, 'CONTEXT_REFERENCE_UNRESOLVED')
    const support = supports[0], sourceRef = mirrors[0], [sourceType, mirrorType, label] = contextTypes[refKey]
    requireValue(support.sourceType === sourceType && sourceRef.type === mirrorType
      && typeof support.summary === 'string' && support.summary.trim().length > 0
      && support.summary === sourceRef.safeDisplay && support.label === label && sourceRef.label === label,
    'CONTEXT_REFERENCE_MISMATCH')
    const context = refKey === 'section_input' ? detail.input : scoped
    if (refKey === 'section_input') requireValue(contextText(context) === support.summary, 'CONTEXT_INPUT_MISMATCH')
    bindings.push({ refKey, sourceType, materialHash: membershipHash({ support, sourceRef, context }) })
  }
  return bindings.length ? { contractVersion: contextVersion, references: bindings } : null
}
const resolveSectionReferences = (references, evidence, contextBindings) => {
  const bound = new Set(contextBindings?.references.map(binding => binding.refKey) || [])
  return [...new Set([
    ...resolveMembershipReferences(references.evidenceRefs || [], evidence),
    ...resolveMembershipReferences((references.supportingEvidenceRefs || []).filter(reference => !bound.has(reference)), evidence),
  ])].sort()
}
const buildMembershipManifest = ({ runtime, lockTruthRecord, sources, evidence, sections, contextBindingSectionKeys }, locked) => {
  const scope = evidenceSnapshotScope(runtime)
  const stateVersion = runtime.stateVersion
  requireValue(statePattern.test(stateVersion), 'STATE_VERSION_INVALID')
  const family = (rows, kind, key) => {
    requireValue(Array.isArray(rows) && rows.length <= EVIDENCE_MEMBER_LIMITS[kind], 'MEMBER_BOUND')
    const identities = new Set(), storageIds = new Set()
    for (const row of rows) {
      requireValue(['customerId', 'tenantId', 'runtimeInstanceId'].every(name => id(row[name]) === scope[name])
        && row.runtimeInstanceKey === scope.runtimeInstanceKey && row.stateVersion === stateVersion
        && row.sourceStateVersion === stateVersion && row.current === true && text(row[key]) && objectId(row._id)
        && /^sha256:[a-f0-9]{64}$/.test(row.sourceHash), 'MEMBER_SCOPE_INVALID')
      requireValue(!identities.has(row[key]) && !storageIds.has(id(row._id)), 'MEMBER_DUPLICATE')
      identities.add(row[key]); storageIds.add(id(row._id))
    }
    return rows.map(row => member(row, key)).sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0)
  }
  const sourceMembers = family(sources, 'sources', 'sourceId')
  const evidenceMembers = family(evidence, 'evidence', 'evidenceObjectId').map(row => ({ ...row,
    sourceId: evidence.find(item => item.evidenceObjectId === row.evidenceObjectId).sourceId }))
  requireValue(evidenceMembers.every(row => sourceMembers.some(source => source.sourceId === row.sourceId)), 'SOURCE_UNRESOLVED')
  for (const row of evidence) if (Object.hasOwn(row, 'proofDependency')) resolveMembershipReferences(row.proofDependency, evidenceMembers)
  const sectionRows = family(sections, 'sections', 'sectionKey')
  if (contextBindingSectionKeys !== undefined) requireValue(Array.isArray(contextBindingSectionKeys)
    && new Set(contextBindingSectionKeys).size === contextBindingSectionKeys.length
    && contextBindingSectionKeys.every(key => sectionRows.some(row => row.sectionKey === key)), 'CONTEXT_SECTION_INVALID')
  const sectionMembers = sectionRows.map(row => {
    const detail = sections.find(item => item.sectionKey === row.sectionKey).sectionDetail
    const accepted = detail?.accepted || {}
    const references = {}
    for (const key of ['supportingEvidenceRefs', 'evidenceRefs']) if (Object.hasOwn(accepted, key)) references[key] = refs(accepted[key])
    const contextBindings = contextBindingSectionKeys === undefined || contextBindingSectionKeys.includes(row.sectionKey)
      ? bindSectionContext(detail, references, evidenceMembers) : null
    return { ...row, references, ...(contextBindings ? { contextBindings } : {}),
      resolvedEvidenceIds: resolveSectionReferences(references, evidenceMembers, contextBindings) }
  })
  const body = { contractVersion: locked ? EVIDENCE_MEMBERSHIP_VERSION : PUBLISHED_EVIDENCE_MEMBERSHIP_VERSION, scope, basisStateVersion: stateVersion,
    ...(locked ? { lockTruthRecord: membershipJson(lockTruthRecord) } : {}), package: evidenceSnapshotPackage(runtime),
    sources: sourceMembers, evidence: evidenceMembers, sections: sectionMembers,
    counts: { sources: sources.length, evidence: evidence.length, sections: sections.length } }
  assertMembershipManifest(body, locked)
  return body
}
export const buildEvidenceMembershipBody = args => buildMembershipManifest(args, true)
export const buildPublishedEvidenceMembershipManifest = args => buildMembershipManifest(args, false)
const assertMembershipManifest = (raw, locked) => {
  const body = membershipJson(raw)
  requireValue(exact(body, ['contractVersion', 'scope', 'basisStateVersion', ...(locked ? ['lockTruthRecord'] : []), 'package', 'sources', 'evidence', 'sections', 'counts'])
    && body.contractVersion === (locked ? EVIDENCE_MEMBERSHIP_VERSION : PUBLISHED_EVIDENCE_MEMBERSHIP_VERSION) && statePattern.test(body.basisStateVersion), 'BODY_INVALID')
  requireValue(exact(body.scope, ['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey', 'rootRuntimeInstanceId', 'rootRuntimeInstanceKey', 'revisionNumber', 'workspaceId']), 'SCOPE_INVALID')
  const scope = evidenceSnapshotScope({ ...body.scope, _id: body.scope.runtimeInstanceId,
    revision: { revisionNumber: body.scope.revisionNumber, rootRuntimeId: body.scope.rootRuntimeInstanceId, rootRuntimeInstanceKey: body.scope.rootRuntimeInstanceKey } })
  requireValue(membershipHash(scope) === membershipHash(body.scope), 'SCOPE_INVALID')
  requireValue(exact(body.package, ['packageId', 'packageKey', 'packageVersion', 'dependencyLockId', 'activationId', 'deploymentId']), 'PACKAGE_INVALID')
  evidenceSnapshotPackage(body.package)
  if (locked) {
    const lock = body.lockTruthRecord
    requireValue(exact(lock, ['snapshotId', 'snapshotHash', 'snapshotAt', 'contractVersion', 'actionKey']) && text(lock.snapshotId)
    && hashPattern.test(lock.snapshotHash) && typeof lock.snapshotAt === 'string' && Number.isFinite(Date.parse(lock.snapshotAt))
    && lock.contractVersion === 'runtime-truth-snapshot-v1' && lock.actionKey === 'LOCK_RECORD', 'LOCK_INVALID')
  }
  requireValue(exact(body.counts, ['sources', 'evidence', 'sections']), 'COUNT_INVALID')
  for (const [kind, key] of [['sources', 'sourceId'], ['evidence', 'evidenceObjectId'], ['sections', 'sectionKey']]) {
    const rows = body[kind], keys = [key, 'storageId', 'stateVersion', 'sourceStateVersion', 'sourceHash', 'materialHash',
      ...(kind === 'evidence' ? ['sourceId'] : kind === 'sections' ? ['references', 'resolvedEvidenceIds'] : [])]
    requireValue(Array.isArray(rows) && rows.length <= EVIDENCE_MEMBER_LIMITS[kind] && body.counts[kind] === rows.length, 'COUNT_INVALID')
    requireValue(new Set(rows.map(row => row[key])).size === rows.length && new Set(rows.map(row => row.storageId)).size === rows.length, 'MEMBER_DUPLICATE')
    for (const row of rows) {
      requireValue(exact(row, [...keys, ...(kind === 'sections' && Object.hasOwn(row, 'contextBindings') ? ['contextBindings'] : [])]) && text(row[key]) && objectId(row.storageId) && row.stateVersion === body.basisStateVersion
        && row.sourceStateVersion === body.basisStateVersion && /^sha256:[a-f0-9]{64}$/.test(row.sourceHash) && hashPattern.test(row.materialHash), 'MEMBER_INVALID')
      if (kind === 'evidence') requireValue(body.sources.some(source => source.sourceId === row.sourceId), 'SOURCE_UNRESOLVED')
      if (kind === 'sections') {
        requireValue(plain(row.references) && Object.keys(row.references).every(name => ['supportingEvidenceRefs', 'evidenceRefs'].includes(name)), 'REFERENCES_INVALID')
        for (const referenceList of Object.values(row.references)) {
          requireValue(Array.isArray(referenceList) && membershipHash(refs(referenceList)) === membershipHash(referenceList), 'REFERENCES_INVALID')
        }
        if (Object.hasOwn(row, 'contextBindings')) {
          const binding = row.contextBindings
          requireValue(exact(binding, ['contractVersion', 'references']) && binding.contractVersion === contextVersion
            && Array.isArray(binding.references) && binding.references.length > 0 && binding.references.length <= 2, 'CONTEXT_BINDING_INVALID')
          const bindingKeys = binding.references.map(item => item?.refKey)
          requireValue(new Set(bindingKeys).size === bindingKeys.length
            && membershipHash(bindingKeys) === membershipHash([...bindingKeys].sort()), 'CONTEXT_BINDING_INVALID')
          for (const item of binding.references) requireValue(exact(item, ['refKey', 'sourceType', 'materialHash'])
            && Object.hasOwn(contextTypes, item.refKey) && item.sourceType === contextTypes[item.refKey][0]
            && hashPattern.test(item.materialHash) && row.references.supportingEvidenceRefs?.includes(item.refKey)
            && !row.references.evidenceRefs?.includes(item.refKey) && !hasEvidence(item.refKey, body.evidence), 'CONTEXT_BINDING_INVALID')
        }
        const resolved = resolveSectionReferences(row.references, body.evidence, row.contextBindings)
        requireValue(membershipHash(resolved) === membershipHash(row.resolvedEvidenceIds), 'REFERENCE_UNRESOLVED')
      }
    }
    requireValue(membershipHash(rows.map(row => row[key])) === membershipHash(rows.map(row => row[key]).sort()), 'MEMBER_ORDER')
  }
  requireValue(Buffer.byteLength(JSON.stringify(body)) <= EVIDENCE_SNAPSHOT_MAX_BYTES, 'MEMBERSHIP_BYTE_BOUND')
  return body
}
export const assertEvidenceMembershipBody = raw => assertMembershipManifest(raw, true)
export const assertPublishedEvidenceMembershipManifest = raw => assertMembershipManifest(raw, false)
