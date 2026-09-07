import { generateChecksum } from './governanceAudit/checksumService.js'
import { isRuntimeReleaseJsonValue as isJson } from './runtimeReleaseCompatibilityService.js'

const RECOVERABLE_REFERENCE_FIELDS = [
  'outputPaths', 'bindingKeys', 'producerSkillId', 'hasParameterSchema', 'governedAction', 'stepCount',
]
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const plain = (value) => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0
const clone = (value) => JSON.parse(JSON.stringify(value))
const referenceIdentity = (reference) => JSON.stringify([reference.collectionKey, reference.id])
const snapshotValid = (snapshot) => plain(snapshot) && isJson(snapshot)
  && ['snapshotId', 'packageKey', 'packageVersion'].every((key) => nonempty(snapshot[key]))
  && typeof snapshot.snapshotHash === 'string' && /^[a-f0-9]{64}$/.test(snapshot.snapshotHash)
  && Array.isArray(snapshot.references) && snapshot.references.length > 0
  && snapshot.references.every((reference) => plain(reference)
    && nonempty(reference.collectionKey) && nonempty(reference.id))
const uniqueReferences = (snapshot) => new Set(snapshot.references.map(referenceIdentity)).size === snapshot.references.length
const checksum = ({ snapshotId: _id, snapshotHash: _hash, ...payload }) => generateChecksum(payload)
const blocked = (reason) => ({
  metadataIntegrityVerified: false, historicalContentIntegrityVerified: false, adoptionReady: false, reason,
})
const verified = (snapshot, origin) => ({
  metadataIntegrityVerified: true, historicalContentIntegrityVerified: false, adoptionReady: false,
  reason: null, origin, snapshot: clone(snapshot),
})

// Inputs must be JSON snapshots (convert BSON at the repository boundary).
// This recovers known schema-stripped hash inputs in memory; it never replaces a
// snapshot identity/hash, certifies referenced content, or writes repaired data.
export const resolveRuntimeReleaseDependencySnapshot = (input) => {
  if (!plain(input) || !isJson(input)
    || Object.keys(input).some((key) => !['sourceSnapshot', 'retainedSnapshot'].includes(key))) return blocked('INVALID_INPUT')
  const { sourceSnapshot: source, retainedSnapshot: retained } = input
  if (!snapshotValid(source)) return blocked('SOURCE_SNAPSHOT_INVALID')
  if (!uniqueReferences(source)) return blocked('SOURCE_REFERENCES_DUPLICATED')
  if (checksum(source) === source.snapshotHash) return verified(source, 'PERSISTED')
  if (!snapshotValid(retained)) return blocked('RETAINED_SNAPSHOT_INVALID')
  if (!uniqueReferences(retained)) return blocked('RETAINED_REFERENCES_DUPLICATED')
  if (checksum(retained) !== retained.snapshotHash) return blocked('RETAINED_CHECKSUM_MISMATCH')
  if (retained.packageKey !== source.packageKey || retained.packageVersion !== source.packageVersion) {
    return blocked('RETAINED_PACKAGE_MISMATCH')
  }
  if (source.references.length !== retained.references.length
    || source.references.some((reference, index) => referenceIdentity(reference) !== referenceIdentity(retained.references[index]))) {
    return blocked('RETAINED_REFERENCES_MISMATCH')
  }
  const recovered = clone(source)
  recovered.references.forEach((reference, index) => {
    for (const field of RECOVERABLE_REFERENCE_FIELDS) {
      if (!own(reference, field) && own(retained.references[index], field)) {
        reference[field] = clone(retained.references[index][field])
      }
    }
  })
  if (!own(recovered, 'uiContractSnapshot') && own(retained, 'uiContractSnapshot')) {
    recovered.uiContractSnapshot = clone(retained.uiContractSnapshot)
  }
  if (checksum(recovered) !== source.snapshotHash) return blocked('SOURCE_CHECKSUM_UNRECOVERABLE')
  return verified(recovered, 'CHECKSUM_RECOVERED_RETAINED_FIELDS')
}
