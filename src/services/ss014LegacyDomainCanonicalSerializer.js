import { createHash } from 'node:crypto'

import mongoose from 'mongoose'

export const SS014_LEGACY_CANONICAL_ALGORITHM = 'ss014-legacy-domain-canonical-json-v1'
export const SS014_LEGACY_SOURCE_HASH_STATUS = 'APPLY_CANDIDATE_NOT_PERSISTED'
export const SS014_LEGACY_CANONICAL_MAX_BYTES = 12 * 1024 * 1024

export const SS014_LEGACY_CANONICAL_CAPS = Object.freeze({
  sections: 2000,
  evidenceObjects: 10000,
  graphNodes: 20000,
  graphEdges: 40000,
})

export const SS014_LEGACY_CANONICAL_LOGICAL_PATHS = Object.freeze({
  sections: 'framework_state.sections',
  evidencePack: 'framework_state.evidence_pack',
  intelligenceGraph: 'framework_state.intelligence_graph',
})

export const SS014_LEGACY_CANONICAL_ERROR_CODES = Object.freeze({
  REDACTION_FAILED: 'SS014_LEGACY_CANONICAL_REDACTION_FAILED',
  MAPPING_REQUIRED: 'SS014_LEGACY_CANONICAL_MAPPING_REQUIRED',
  CAP_EXCEEDED: 'SS014_LEGACY_CANONICAL_CAP_EXCEEDED',
})

const OMIT = Symbol('ss014-canonical-omit')
const GRAPH_NODE_ID_ALIASES = Object.freeze(['nodeId', 'id', '_id', 'key'])
const GRAPH_EDGE_ID_ALIASES = Object.freeze(['edgeId', 'id', '_id', 'key'])

const fail = (code, reason) => {
  const error = new Error(reason)
  error.code = code
  error.details = { reason }
  throw error
}

const redactionFailure = (reason) => fail(SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED, reason)
const mappingFailure = (reason) => fail(SS014_LEGACY_CANONICAL_ERROR_CODES.MAPPING_REQUIRED, reason)
const capFailure = (reason) => fail(SS014_LEGACY_CANONICAL_ERROR_CODES.CAP_EXCEEDED, reason)

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

const compareUnicodeScalars = (left, right) => {
  const leftScalars = Array.from(left, (character) => character.codePointAt(0))
  const rightScalars = Array.from(right, (character) => character.codePointAt(0))
  const length = Math.min(leftScalars.length, rightScalars.length)
  for (let index = 0; index < length; index += 1) {
    if (leftScalars[index] !== rightScalars[index]) return leftScalars[index] - rightScalars[index]
  }
  return leftScalars.length - rightScalars.length
}

const assertValidString = (value, path) => {
  if (typeof value !== 'string') redactionFailure(`${path} must be a string.`)
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xDC00 || next > 0xDFFF) redactionFailure(`${path} contains an unpaired high surrogate.`)
      index += 1
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      redactionFailure(`${path} contains an unpaired low surrogate.`)
    }
  }
  return value
}

const getOwnNames = (value, path) => {
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) redactionFailure(`${path} contains symbols.`)
    return Object.getOwnPropertyNames(value)
  } catch (error) {
    if (error?.code === SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED) throw error
    redactionFailure(`${path} cannot be inspected.`)
  }
}

const assertNotProxy = (value, path) => {
  try {
    structuredClone(value)
  } catch {
    redactionFailure(`${path} is not a cloneable data boundary.`)
  }
}

const isArray = (value, path) => {
  try {
    return Array.isArray(value)
  } catch {
    redactionFailure(`${path} cannot be inspected as an array.`)
  }
}

const isDate = (value, path) => {
  try {
    return value instanceof Date
  } catch {
    redactionFailure(`${path} cannot be inspected as a Date.`)
  }
}

const assertPlainRecord = (value, path) => {
  if (value === null || typeof value !== 'object' || isArray(value, path)) {
    redactionFailure(`${path} must be a plain record.`)
  }
  let prototype
  let names
  try {
    prototype = Object.getPrototypeOf(value)
    names = getOwnNames(value, path)
  } catch (error) {
    if (error?.code === SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED) throw error
    redactionFailure(`${path} cannot be inspected.`)
  }
  if (prototype !== Object.prototype && prototype !== null) {
    redactionFailure(`${path} has an unsupported prototype.`)
  }
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      redactionFailure(`${path}.${key} must be an enumerable data property.`)
    }
  }
  assertNotProxy(value, path)
  return names
}

const assertDenseArray = (value, path) => {
  if (!isArray(value, path)) redactionFailure(`${path} must be an array.`)
  const names = getOwnNames(value, path)
  let prototype
  let length
  try {
    prototype = Object.getPrototypeOf(value)
    length = value.length
  } catch {
    redactionFailure(`${path} cannot be inspected as a dense array.`)
  }
  if (prototype !== Array.prototype || names.length !== length + 1 || !names.includes('length')) {
    redactionFailure(`${path} must be a dense standard array.`)
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (!lengthDescriptor || lengthDescriptor.enumerable !== false
    || lengthDescriptor.configurable !== false || !('value' in lengthDescriptor)) {
    redactionFailure(`${path}.length has an invalid descriptor.`)
  }
  for (let index = 0; index < length; index += 1) {
    const key = String(index)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      redactionFailure(`${path}[${index}] must be an enumerable data property.`)
    }
  }
  assertNotProxy(value, path)
}

const assertSpecialObjectShape = (value, path, allowOwnNames) => {
  const names = getOwnNames(value, path)
  if (allowOwnNames === false && names.length > 0) redactionFailure(`${path} has custom properties.`)
}

const isObjectId = (value) => {
  try {
    return value instanceof mongoose.Types.ObjectId
  } catch {
    return false
  }
}

const normalizeObjectId = (value, path) => {
  let hex
  try {
    hex = value.toHexString()
  } catch {
    redactionFailure(`${path} ObjectId cannot be encoded.`)
  }
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{24}$/.test(hex)) {
    redactionFailure(`${path} ObjectId is invalid.`)
  }
  return hex.toLowerCase()
}

const normalizeDate = (value, path) => {
  try {
    if (Object.getPrototypeOf(value) !== Date.prototype) redactionFailure(`${path} has an unsupported Date prototype.`)
    assertSpecialObjectShape(value, path, false)
    if (Number.isNaN(value.getTime())) redactionFailure(`${path} is an invalid Date.`)
    return value.toISOString()
  } catch (error) {
    if (error?.code === SS014_LEGACY_CANONICAL_ERROR_CODES.REDACTION_FAILED) throw error
    redactionFailure(`${path} Date cannot be encoded.`)
  }
}

const normalizeNumber = (value, path) => {
  if (!Number.isFinite(value)) redactionFailure(`${path} must be finite.`)
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    redactionFailure(`${path} integer must be safe.`)
  }
  return Object.is(value, -0) ? 0 : value
}

const normalizeValue = (value, path, { inArray = false } = {}) => {
  if (value === undefined) {
    if (inArray) redactionFailure(`${path} cannot contain undefined.`)
    return OMIT
  }
  if (value === null) return null
  if (typeof value === 'string') return assertValidString(value, path)
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return normalizeNumber(value, path)
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    redactionFailure(`${path} has an unsupported scalar.`)
  }
  if (isObjectId(value)) return normalizeObjectId(value, path)
  if (isDate(value, path)) return normalizeDate(value, path)
  if (isArray(value, path)) {
    assertDenseArray(value, path)
    return value.map((entry, index) => normalizeValue(entry, `${path}[${index}]`, { inArray: true }))
  }
  const keys = assertPlainRecord(value, path).sort(compareUnicodeScalars)
  const normalized = Object.create(null)
  for (const key of keys) {
    const entry = normalizeValue(value[key], `${path}.${key}`)
    if (entry !== OMIT) Object.defineProperty(normalized, key, {
      value: entry,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return normalized
}

const escapeJsonString = (value) => {
  assertValidString(value, 'canonical string')
  let escaped = '"'
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    const codeUnit = value.charCodeAt(index)
    if (character === '"') escaped += '\\"'
    else if (character === '\\') escaped += '\\\\'
    else if (codeUnit === 0x08) escaped += '\\b'
    else if (codeUnit === 0x09) escaped += '\\t'
    else if (codeUnit === 0x0A) escaped += '\\n'
    else if (codeUnit === 0x0C) escaped += '\\f'
    else if (codeUnit === 0x0D) escaped += '\\r'
    else if (codeUnit <= 0x1F) escaped += `\\u${codeUnit.toString(16).padStart(4, '0')}`
    else escaped += character
  }
  return `${escaped}"`
}

const stableStringify = (value) => {
  if (value === null) return 'null'
  if (typeof value === 'string') return escapeJsonString(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value === null || typeof value !== 'object') redactionFailure('Cannot serialize an unsupported value.')
  const keys = Object.keys(value).sort(compareUnicodeScalars)
  return `{${keys.map((key) => `${escapeJsonString(key)}:${stableStringify(value[key])}`).join(',')}}`
}

const hashUtf8 = (value) => `sha256:${createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex')}`

const normalizedIdentity = (value, path) => {
  if (typeof value !== 'string' || value.length === 0) mappingFailure(`${path} must be a non-empty identity.`)
  return value
}

const sortAndRejectDuplicateIdentities = (entries, identityKey, path) => {
  const keyed = entries.map((entry, index) => {
    const identity = normalizedIdentity(entry[identityKey], `${path}[${index}].${identityKey}`)
    return { entry, identity, canonicalJson: stableStringify(entry) }
  })
  const identities = new Set()
  for (const { identity } of keyed) {
    if (identities.has(identity)) mappingFailure(`${path} contains duplicate ${identityKey} ${identity}.`)
    identities.add(identity)
  }
  return keyed
    .sort((left, right) => compareUnicodeScalars(left.identity, right.identity)
      || compareUnicodeScalars(left.canonicalJson, right.canonicalJson))
    .map(({ entry }) => entry)
}

const normalizeSections = (value) => {
  const keys = assertPlainRecord(value, SS014_LEGACY_CANONICAL_LOGICAL_PATHS.sections).sort(compareUnicodeScalars)
  if (keys.length > SS014_LEGACY_CANONICAL_CAPS.sections) capFailure('Section cap exceeded.')
  for (const key of keys) {
    if (key.length === 0) mappingFailure('Section key must be non-empty.')
    assertValidString(key, `${SS014_LEGACY_CANONICAL_LOGICAL_PATHS.sections}.${key}`)
  }
  return normalizeValue(value, SS014_LEGACY_CANONICAL_LOGICAL_PATHS.sections)
}

const normalizeEvidencePack = (value) => {
  const path = SS014_LEGACY_CANONICAL_LOGICAL_PATHS.evidencePack
  const keys = assertPlainRecord(value, path)
  if (!hasOwn(value, 'sourceRegistry') || !hasOwn(value, 'evidenceObjects')) {
    mappingFailure(`${path} requires sourceRegistry and evidenceObjects.`)
  }
  if (!Array.isArray(value.sourceRegistry) || !Array.isArray(value.evidenceObjects)) {
    mappingFailure(`${path} sourceRegistry and evidenceObjects must be arrays.`)
  }
  assertDenseArray(value.sourceRegistry, `${path}.sourceRegistry`)
  assertDenseArray(value.evidenceObjects, `${path}.evidenceObjects`)
  if (value.evidenceObjects.length > SS014_LEGACY_CANONICAL_CAPS.evidenceObjects) {
    capFailure('Evidence object cap exceeded.')
  }
  const normalized = normalizeValue(value, path)
  const sources = sortAndRejectDuplicateIdentities(normalized.sourceRegistry, 'sourceId', `${path}.sourceRegistry`)
  const evidenceObjects = sortAndRejectDuplicateIdentities(normalized.evidenceObjects, 'evidenceObjectId', `${path}.evidenceObjects`)
  const sourceIds = new Set(sources.map((entry) => entry.sourceId))
  evidenceObjects.forEach((entry, index) => {
    const sourceId = normalizedIdentity(entry.sourceId, `${path}.evidenceObjects[${index}].sourceId`)
    if (!sourceIds.has(sourceId)) mappingFailure(`${path}.evidenceObjects[${index}] references an unknown sourceId.`)
  })
  normalized.sourceRegistry = sources
  normalized.evidenceObjects = evidenceObjects
  return normalized
}

const selectIdentityAlias = (entry, aliases, path) => {
  const present = aliases.filter((alias) => hasOwn(entry, alias))
  if (present.length > 1) mappingFailure(`${path} has ambiguous identity aliases.`)
  if (present.length === 0) return null
  const alias = present[0]
  const normalized = normalizeValue(entry[alias], `${path}.${alias}`)
  return { alias, value: normalizedIdentity(normalized, `${path}.${alias}`) }
}

const selectEndpointPair = (entry, path) => {
  const canonicalPresent = hasOwn(entry, 'fromNodeId') || hasOwn(entry, 'toNodeId')
  const legacyPresent = hasOwn(entry, 'from') || hasOwn(entry, 'to')
  if (canonicalPresent && legacyPresent) mappingFailure(`${path} has ambiguous endpoint aliases.`)
  const [fromKey, toKey] = canonicalPresent ? ['fromNodeId', 'toNodeId'] : ['from', 'to']
  if (!hasOwn(entry, fromKey) || !hasOwn(entry, toKey)) mappingFailure(`${path} requires a complete endpoint pair.`)
  const from = normalizeValue(entry[fromKey], `${path}.${fromKey}`)
  const to = normalizeValue(entry[toKey], `${path}.${toKey}`)
  return {
    from: normalizedIdentity(from, `${path}.${fromKey}`),
    to: normalizedIdentity(to, `${path}.${toKey}`),
  }
}

const normalizeGraphElements = (value, path, aliases, label) => {
  const normalizedElements = []
  for (let index = 0; index < value.length; index += 1) {
    const elementPath = `${path}[${index}]`
    const normalized = normalizeValue(value[index], elementPath)
    const identity = selectIdentityAlias(value[index], aliases, elementPath)
    const canonicalJson = stableStringify(normalized)
    const key = identity ? identity.value : hashUtf8(canonicalJson)
    normalizedElements.push({ canonicalJson, value: normalized, key, label })
  }
  const keys = new Set()
  for (const element of normalizedElements) {
    if (keys.has(element.key)) mappingFailure(`${path} contains duplicate ${label} key ${element.key}.`)
    keys.add(element.key)
  }
  const records = normalizedElements
    .sort((left, right) => compareUnicodeScalars(left.key, right.key)
      || compareUnicodeScalars(left.canonicalJson, right.canonicalJson))
  return {
    elements: records.map(({ value: entry }) => entry),
    keys,
    records,
  }
}

const normalizeIntelligenceGraphResult = (value) => {
  const path = SS014_LEGACY_CANONICAL_LOGICAL_PATHS.intelligenceGraph
  assertPlainRecord(value, path)
  if (!hasOwn(value, 'nodes') || !hasOwn(value, 'edges')
    || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    mappingFailure(`${path} requires nodes and edges arrays.`)
  }
  assertDenseArray(value.nodes, `${path}.nodes`)
  assertDenseArray(value.edges, `${path}.edges`)
  if (value.nodes.length > SS014_LEGACY_CANONICAL_CAPS.graphNodes) capFailure('Graph node cap exceeded.')
  if (value.edges.length > SS014_LEGACY_CANONICAL_CAPS.graphEdges) capFailure('Graph edge cap exceeded.')
  const normalized = normalizeValue(value, path)
  const nodes = normalizeGraphElements(value.nodes, `${path}.nodes`, GRAPH_NODE_ID_ALIASES, 'node')
  const edges = []
  const edgeKeys = new Set()
  for (let index = 0; index < value.edges.length; index += 1) {
    const elementPath = `${path}.edges[${index}]`
    const entry = normalizeValue(value.edges[index], elementPath)
    const identity = selectIdentityAlias(value.edges[index], GRAPH_EDGE_ID_ALIASES, elementPath)
    const endpoints = selectEndpointPair(value.edges[index], elementPath)
    if (!nodes.keys.has(endpoints.from) || !nodes.keys.has(endpoints.to)) {
      mappingFailure(`${elementPath} references an unknown node key.`)
    }
    const canonicalJson = stableStringify(entry)
    const key = identity ? identity.value : hashUtf8(canonicalJson)
    if (edgeKeys.has(key)) mappingFailure(`${path}.edges contains duplicate edge key ${key}.`)
    edgeKeys.add(key)
    edges.push({ canonicalJson, value: entry, key, endpoints })
  }
  normalized.nodes = nodes.elements
  const sortedEdges = edges
    .sort((left, right) => compareUnicodeScalars(left.key, right.key)
      || compareUnicodeScalars(left.canonicalJson, right.canonicalJson))
  normalized.edges = sortedEdges.map(({ value: entry }) => entry)
  return { normalized, nodes: nodes.records, nodeKeys: nodes.keys, edges: sortedEdges }
}

const serializeDomain = (value, path) => {
  const canonicalJson = stableStringify(value)
  const byteLength = Buffer.byteLength(canonicalJson, 'utf8')
  if (byteLength > SS014_LEGACY_CANONICAL_MAX_BYTES) capFailure(`${path} serialized-domain cap exceeded.`)
  return {
    logicalPath: path,
    canonicalJson,
    byteLength,
    sourceHash: hashUtf8(canonicalJson),
  }
}

const assertEnvelope = (value) => {
  const keys = assertPlainRecord(value, 'input')
  const expected = ['rawBsonBytes', 'sections', 'evidencePack', 'intelligenceGraph']
  if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) {
    redactionFailure('Input envelope keys are not exact.')
  }
}

const assertRawBsonBytes = (value) => {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    redactionFailure('rawBsonBytes must be a non-negative safe integer.')
  }
  if (value > SS014_LEGACY_CANONICAL_MAX_BYTES) capFailure('Aggregate raw BSON cap exceeded.')
}

const normalizeLegacyInput = (input) => {
  assertEnvelope(input)
  assertRawBsonBytes(input.rawBsonBytes)
  const sections = normalizeSections(input.sections)
  const evidencePack = normalizeEvidencePack(input.evidencePack)
  const intelligenceGraphResult = normalizeIntelligenceGraphResult(input.intelligenceGraph)
  return { sections, evidencePack, intelligenceGraphResult }
}

const serializeNormalizedDomains = ({ input, sections, evidencePack, intelligenceGraphResult }) => {
  const domains = {
    sections: serializeDomain(sections, SS014_LEGACY_CANONICAL_LOGICAL_PATHS.sections),
    evidencePack: serializeDomain(evidencePack, SS014_LEGACY_CANONICAL_LOGICAL_PATHS.evidencePack),
    intelligenceGraph: serializeDomain(intelligenceGraphResult.normalized, SS014_LEGACY_CANONICAL_LOGICAL_PATHS.intelligenceGraph),
  }
  const sourceSetLines = Object.values(domains)
    .map(({ logicalPath, sourceHash }) => `${logicalPath}=${sourceHash}\n`)
    .sort((left, right) => compareUnicodeScalars(left, right))
    .join('')
  return {
    algorithm: SS014_LEGACY_CANONICAL_ALGORITHM,
    rawBsonBytes: input.rawBsonBytes,
    domains,
    sourceSetHash: hashUtf8(sourceSetLines),
    sourceHashStatus: SS014_LEGACY_SOURCE_HASH_STATUS,
  }
}

export const serializeSs014LegacyDomains = (input) => {
  const normalized = normalizeLegacyInput(input)
  return serializeNormalizedDomains({ input, ...normalized })
}

export const createSs014LegacyCanonicalMappingManifest = (input) => {
  const normalized = normalizeLegacyInput(input)
  const serializerResult = serializeNormalizedDomains({ input, ...normalized })
  const { sections, evidencePack, intelligenceGraphResult } = normalized
  const graphVersion = normalizedIdentity(
    intelligenceGraphResult.normalized.graphVersion,
    `${SS014_LEGACY_CANONICAL_LOGICAL_PATHS.intelligenceGraph}.graphVersion`,
  )
  for (const edge of intelligenceGraphResult.edges) {
    if (intelligenceGraphResult.nodeKeys.has(edge.key)) {
      mappingFailure('Graph node and edge keys must not collide.')
    }
  }
  const metadata = Object.assign(Object.create(null), intelligenceGraphResult.normalized)
  delete metadata.nodes
  delete metadata.edges
  return {
    serializerResult,
    mappingManifest: {
      sections: Object.keys(sections).map((sectionKey) => ({ sectionKey, value: sections[sectionKey] })),
      evidenceSources: evidencePack.sourceRegistry.map((value) => ({ sourceId: value.sourceId, value })),
      evidenceObjects: evidencePack.evidenceObjects.map((value) => ({
        evidenceObjectId: value.evidenceObjectId,
        sourceId: value.sourceId,
        value,
      })),
      graph: {
        graphVersion,
        snapshotId: `legacy:${serializerResult.domains.intelligenceGraph.sourceHash.slice('sha256:'.length)}`,
        metadata,
        nodes: intelligenceGraphResult.nodes.map(({ key: elementKey, value }) => ({ elementKey, value })),
        edges: intelligenceGraphResult.edges.map(({ key: elementKey, endpoints, value }) => ({
          elementKey,
          fromElementKey: endpoints.from,
          toElementKey: endpoints.to,
          value,
        })),
      },
    },
  }
}

export const SS014_LEGACY_CANONICAL_FAILURE_CODES = Object.freeze([
  ...Object.values(SS014_LEGACY_CANONICAL_ERROR_CODES),
])
