import { createHash } from 'node:crypto'

const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/
const KEY = /^[a-z0-9][a-z0-9._-]{0,139}$/
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value) => typeof value === 'string' ? value.trim() : ''
const fail = (field) => { throw Object.assign(new Error('Selected-schema shaping mapping is invalid.'), {
  status: 409, code: 'OUTCOME_SHAPING_MAPPING_INVALID', details: { field },
}) }
const exactKeys = (value, keys) => plain(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
// Match persisted quality-stage hashing without importing the stage service (which may consume this mapper).
const canonical = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (value?._bsontype === 'ObjectId' && typeof value.toHexString === 'function') return value.toHexString().toLowerCase()
  if (Array.isArray(value)) return value.map(canonical)
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => !['_id', '__v'].includes(key) && value[key] !== undefined)
    .map((key) => [key, canonical(value[key])]))
  return value
}
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
export const hashOutcomeShapingValue = hash
const strings = (value, field, { empty = false } = {}) => {
  if (!Array.isArray(value) || (!empty && !value.length)
    || value.some((entry) => !text(entry))) fail(field)
  return value
}
const unique = (values) => [...new Set(values)]
const packIdentity = (pack, field) => {
  const selection = pack?.selection
  const keys = ['packId', 'activationId', 'versionId', 'semanticVersion', 'contentFormat', 'status', 'packKey', 'capabilityKey', 'contentHash']
  if (!plain(selection) || keys.some((key) => !text(selection[key]))
    || !CONTENT_HASH.test(selection.contentHash) || !CONTENT_HASH.test(pack.actualContentHash)
    || selection.contentHash !== pack.actualContentHash) fail(field)
  return { selection: Object.fromEntries(keys.map((key) => [key, selection[key]])), actualContentHash: pack.actualContentHash }
}

export const projectOutcomeShapingContractIdentity = (contract) => ({
  outputType: packIdentity(contract?.outputType, 'contract.outputType'),
  schema: packIdentity(contract?.schema, 'contract.schema'),
})
