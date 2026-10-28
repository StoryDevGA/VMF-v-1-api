import { createHash } from 'node:crypto'

export const ARL_CONTEXT_TRANSPORT_VERSION = 'arl-context-values.v3'
const fail = () => { throw new TypeError('ARL context transport is invalid.') }
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8')
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype
const safeKeys = value => Object.keys(value).every(key => !['__proto__', 'prototype', 'constructor', '$ref', '$text', '$r', '$t'].includes(key))

// Internal wire representation only. The caller validates the full semantic
// context first and supplies its exact byte budget when decoding.
export const encodeOutcomeArlContext = context => {
  const expectedBytes = bytes(context), counts = new Map(), indexes = new Map(), values = [], strings = new Set()
  const tally = (value, depth = 0) => {
    if (depth > 64) fail()
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && (!plain(value) || !safeKeys(value))) fail()
    if (typeof value === 'string' || (value !== null && typeof value === 'object')) {
      if (typeof value === 'string') strings.add(value)
      const key = JSON.stringify(value)
      if (Buffer.byteLength(key, 'utf8') >= 16) counts.set(key, (counts.get(key) || 0) + 1)
    }
    if (Array.isArray(value)) value.forEach(item => tally(item, depth + 1))
    else if (plain(value)) Object.values(value).forEach(item => tally(item, depth + 1))
    else if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) fail()
  }
  tally(context)
  // Only complete known strings are shared inside paragraphs. Each part is
  // shorter than its parent, making string dependencies acyclic.
  const phrases = [...strings].filter(value => value.length >= 24).sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
  const parts = new Map()
  for (const value of strings) {
    const chunks = []; let position = 0
    while (position < value.length) {
      let offset = -1, selected = ''
      for (const phrase of phrases) {
        if (phrase.length >= value.length) continue
        const index = value.indexOf(phrase, position)
        if (index >= 0 && (offset < 0 || index < offset)) { offset = index; selected = phrase }
      }
      if (offset < 0) { chunks.push(value.slice(position)); break }
      if (offset > position) chunks.push(value.slice(position, offset))
      chunks.push(selected); position = offset + selected.length
    }
    if (chunks.length > 1) {
      parts.set(value, chunks)
      for (const part of chunks) { const key = JSON.stringify(part); counts.set(key, (counts.get(key) || 0) + 1) }
    }
  }
  const children = value => typeof value === 'string' && parts.has(value) ? { $t: parts.get(value).map(encode) }
    : Array.isArray(value) ? value.map(encode)
    : plain(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) : value
  const encode = value => {
    const key = JSON.stringify(value)
    if (counts.get(key) > 1) {
      if (!indexes.has(key)) {
        const encoded = children(value)
        if (values.length >= 4096) fail()
        indexes.set(key, values.length); values.push(encoded)
      }
      return { $r: indexes.get(key) }
    }
    return children(value)
  }
  const root = encode(context)
  const wire = { transportVersion: ARL_CONTEXT_TRANSPORT_VERSION, contextHash: hash(context), values, context: root }
  if (JSON.stringify(decodeOutcomeArlContext(wire, { expectedBytes })) !== JSON.stringify(context)) fail()
  return wire
}

export const decodeOutcomeArlContext = (wire, { expectedBytes } = {}) => {
  if (!plain(wire) || Object.keys(wire).sort().join(',') !== 'context,contextHash,transportVersion,values'
    || !['arl-context-values.v1', 'arl-context-values.v2', ARL_CONTEXT_TRANSPORT_VERSION].includes(wire.transportVersion) || !/^[a-f0-9]{64}$/.test(wire.contextHash)
    || !Array.isArray(wire.values) || wire.values.length > 4096
    || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1) fail()
  const modern = wire.transportVersion === ARL_CONTEXT_TRANSPORT_VERSION
  const refKey = modern ? '$r' : '$ref', textKey = modern ? '$t' : '$text'
  const cache = new Map(), used = new Set()
  const bounded = (value, size, nodes, height) => {
    if (!Number.isSafeInteger(size) || size > expectedBytes || nodes > expectedBytes || height > 64) fail()
    return { value, size, nodes, height }
  }
  const decode = (value, limit, depth = 0) => {
    if (depth > 64) fail()
    if (plain(value) && Object.hasOwn(value, textKey)) {
      if (wire.transportVersion === 'arl-context-values.v1' || Object.keys(value).length !== 1
        || !Array.isArray(value[textKey]) || value[textKey].length < 2 || value[textKey].length > expectedBytes) fail()
      const pieces = []; let size = 2, nodes = 1, height = 1
      for (const part of value[textKey]) {
        if (typeof part !== 'string' && !(plain(part) && Object.hasOwn(part, refKey))) fail()
        const child = decode(part, limit, depth + 1)
        if (typeof child.value !== 'string') fail()
        size += child.size - 2; nodes += child.nodes; height = Math.max(height, child.height + 1)
        bounded(null, size, nodes, height)
        pieces.push(child.value)
      }
      return bounded(pieces.join(''), size, nodes, height)
    }
    if (plain(value) && Object.hasOwn(value, refKey)) {
      const index = value[refKey]
      if (Object.keys(value).length !== 1 || !Number.isSafeInteger(index) || index < 0 || index >= limit) fail()
      used.add(index)
      if (!cache.has(index)) {
        const entry = wire.values[index]
        if (entry === null || !['object', 'string'].includes(typeof entry)) fail()
        cache.set(index, decode(entry, index, depth + 1))
      }
      return cache.get(index)
    }
    if (Array.isArray(value) || plain(value)) {
      if (plain(value) && !safeKeys(value)) fail()
      const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value)
      const decoded = []; let size = 2, nodes = 1, height = 1
      for (const [key, item] of entries) {
        const child = decode(item, limit, depth + 1)
        size += child.size + (decoded.length ? 1 : 0) + (Array.isArray(value) ? 0 : bytes(key) + 1)
        nodes += child.nodes; height = Math.max(height, child.height + 1)
        bounded(null, size, nodes, height)
        decoded.push([key, child.value])
      }
      return bounded(Object.freeze(Array.isArray(value) ? decoded.map(([, item]) => item) : Object.fromEntries(decoded)), size, nodes, height)
    }
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) fail()
    if (typeof value === 'number' && !Number.isFinite(value)) fail()
    return bounded(value, bytes(value), 1, 0)
  }
  const result = decode(wire.context, wire.values.length)
  if (used.size !== wire.values.length || result.size !== expectedBytes || hash(result.value) !== wire.contextHash) fail()
  return result.value
}
