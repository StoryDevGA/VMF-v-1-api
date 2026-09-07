import mongoose from 'mongoose'
import { generateChecksum } from './governanceAudit/checksumService.js'

const VERSION = 'runtime-release-certification.v1'
const TYPES = {
  RuntimePathRegistry: 'pathKey', ValidationRegistry: 'key', WorkflowPolicy: 'key',
  RuntimeAgent: 'key', RuntimeSkill: 'key', SkillRoleRegistry: 'roleKey', UIContract: 'uiContractKey',
}
// Top-level operational fields only. Unknown authored fields remain hash inputs.
const RECORD_METADATA = ['__v', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
  'lockedAt', 'lockedBy', 'lockedReason', 'lockedByPackageKeys']
const PACKAGE_METADATA = [...RECORD_METADATA, 'status', 'versionStatus', 'isLocked', 'isDefault',
  'activatedAt', 'activatedBy', 'lastCheckpointStatus', 'lastCheckpointAt',
  'lastCheckpointResult', 'runtimeVerdict', 'dependencyLock']
const plain = (value) => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype
const text = (value) => typeof value === 'string' && value.trim().length > 0
const objectId = (value) => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const omit = (value, fields) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)))
const fail = (reason) => { throw Object.assign(new Error(`Release binding input rejected: ${reason}`), {
  code: 'RUNTIME_RELEASE_CERTIFICATION_INPUT_INVALID', reason,
}) }

// No JSON stringify coercion: unsupported values must not disappear from a digest.
const normalize = (value, ancestors = new Set()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString()
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (ancestors.has(value)) fail('CYCLIC_INPUT')
  const next = new Set(ancestors).add(value)
  if (value instanceof mongoose.Document) {
    return normalize(value.toObject({ depopulate: true, getters: false, virtuals: false,
      transform: false, minimize: false, flattenMaps: false }), next)
  }
  if (!plain(value) && !Array.isArray(value)) fail('NON_CANONICAL_VALUE')
  const keys = Reflect.ownKeys(value).filter((key) => !(Array.isArray(value) && key === 'length'))
  if (Array.isArray(value) && (keys.length !== value.length
    || keys.some((key, index) => key !== String(index)))) fail('NON_CANONICAL_ARRAY')
  const entries = keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || key === '__proto__' || !descriptor.enumerable || !('value' in descriptor)) {
      fail('NON_CANONICAL_PROPERTY')
    }
    return [key, normalize(descriptor.value, next)]
  })
  return Array.isArray(value) ? entries.map(([, item]) => item) : Object.fromEntries(entries)
}
const record = (value) => {
  if (!plain(value) || !objectId(value._id)
    || ('id' in value && value.id !== value._id)) fail('RECORD_IDENTITY_INVALID')
  return omit(value, ['id'])
}

/**
 * Pure binding of complete, model-defaulted records supplied by the repository.
 * dependencies has all seven collection keys (empty arrays allowed), with exactly
 * the records named by frameworkPackage.dependencyLock.references. No DB access,
 * default fabrication, historical recovery, certification or serializability claim.
 */
export const buildRuntimeReleaseCertificationBinding = (input) => {
  const normalized = normalize(input)
  if (!plain(normalized) || Object.keys(normalized).length !== 2
    || !Object.hasOwn(normalized, 'frameworkPackage') || !Object.hasOwn(normalized, 'dependencies')) fail('INPUT_SHAPE')
  const pkg = record(normalized.frameworkPackage)
  const dependencies = normalized.dependencies
  if (!['frameworkKey', 'packageKey', 'version', 'uiContractKey'].every((key) => text(pkg[key]))
    || !Array.isArray(pkg.sections) || !pkg.sections.length
    || !Array.isArray(pkg.validationBindings) || !Array.isArray(pkg.workflowBindings)
    || !plain(pkg.runtimeSettings) || !plain(pkg.executionModel)
    || !plain(pkg.uiContractBinding) || pkg.uiContractBinding.key !== pkg.uiContractKey) fail('PACKAGE_INCOMPLETE')
  if (!plain(dependencies) || Object.keys(dependencies).length !== Object.keys(TYPES).length
    || !Object.keys(TYPES).every((key) => Array.isArray(dependencies[key]))) fail('DEPENDENCY_TYPES_INVALID')
  const snapshot = pkg.dependencyLock
  if (!plain(snapshot) || !text(snapshot.snapshotId) || !/^[a-f0-9]{64}$/.test(snapshot.snapshotHash || '')
    || snapshot.packageKey !== pkg.packageKey || snapshot.packageVersion !== pkg.version
    || !['PASS', 'PASS_WITH_WARNINGS'].includes(snapshot.status)
    || !text(snapshot.resolvedAt) || !Number.isFinite(Date.parse(snapshot.resolvedAt))
    || !Array.isArray(snapshot.references) || !snapshot.references.length
    || !plain(snapshot.uiContractSnapshot)) fail('SNAPSHOT_INVALID')
  if (generateChecksum(omit(snapshot, ['snapshotId', 'snapshotHash'])) !== snapshot.snapshotHash) fail('SNAPSHOT_CHECKSUM_MISMATCH')

  const rows = new Map()
  for (const [type, values] of Object.entries(dependencies)) {
    for (const value of values) {
      const row = record(value)
      const identity = `${type}:${row.stableId}`
      if (!text(row.stableId) || !text(row[TYPES[type]]) || rows.has(identity)
        || !Number.isInteger(row.componentVersion) || row.componentVersion < 1
        || row.status !== 'ACTIVE' || row.versionStatus !== 'ACTIVE' || row.isLocked !== true) fail('DEPENDENCY_INVALID')
      rows.set(identity, row)
    }
  }
  const seen = new Set()
  const boundRows = snapshot.references.map((ref) => {
    if (!plain(ref) || !Object.hasOwn(TYPES, ref.collectionKey) || !text(ref.id)) fail('REFERENCE_INVALID')
    const identity = `${ref.collectionKey}:${ref.id}`
    const row = rows.get(identity)
    if (seen.has(identity) || !row || ref.componentVersion !== row.componentVersion
      || ref.key !== row[TYPES[ref.collectionKey]] || ref.status !== row.status
      || ref.versionStatus !== row.versionStatus) fail('REFERENCE_MISMATCH')
    seen.add(identity)
    return { collectionKey: ref.collectionKey, record: omit(row, RECORD_METADATA) }
  })
  if (seen.size !== rows.size) fail('UNREFERENCED_DEPENDENCY')
  const uiRows = dependencies.UIContract
  const ui = uiRows[0]
  if (uiRows.length !== 1 || ui.uiContractKey !== pkg.uiContractKey
    || !Array.isArray(ui.sections) || !Array.isArray(ui.actions) || !Array.isArray(ui.lifecycleStages)
    || snapshot.uiContractSnapshot.uiContractKey !== ui.uiContractKey
    || snapshot.uiContractSnapshot.stableId !== ui.stableId
    || snapshot.uiContractSnapshot.componentVersion !== ui.componentVersion
    || snapshot.uiContractSnapshot.actionCount !== ui.actions.length
    || snapshot.uiContractSnapshot.lifecycleStageCount !== ui.lifecycleStages.length
    || !plain(snapshot.uiContractSnapshot.sectionMapping)) fail('UI_SNAPSHOT_INVALID')
  const authored = omit(pkg, PACKAGE_METADATA)
  authored.uiContractBinding = omit(authored.uiContractBinding, ['resolvedAt'])
  return { version: VERSION, digest: generateChecksum({ version: VERSION,
    frameworkPackage: authored, dependencySnapshot: snapshot, dependencies: boundRows }) }
}
