import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { RUNTIME_STATE_VERSION_PATTERN, SHA256_PATTERN, isBoundedSafeJson } from '../models/runtimeStateSchemas.js'

export const SECTION_HISTORY_VERSION = 'runtime-section-history.v1'
const own = (value, key) => Object.hasOwn(value || {}, key)
const clone = value => JSON.parse(JSON.stringify(value))
const canonical = value => JSON.stringify(value, function (key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item
})
const fail = reason => { throw Object.assign(new Error('Section history could not be verified.'), {
  code: 'RUNTIME_SECTION_HISTORY_INVALID', status: 409, details: { reason },
}) }
const need = (value, reason) => { if (!value) fail(reason) }
const pair = record => ({ generated: record?.generated ?? null, accepted: record?.accepted ?? null })
const metadata = record => Object.fromEntries(Object.entries(record).filter(([key]) =>
  !['generated', 'accepted', 'historyReference'].includes(key)))
export const hashSectionHistoryPair = record => createHash('sha256').update(canonical(pair(record))).digest('hex')
const validRef = ref => ref && typeof ref === 'object' && !Array.isArray(ref)
  && Object.keys(ref).sort().join(',') === 'hasAccepted,hasGenerated,hash,index,sourceHash,stateVersion,version'
  && ref.version === SECTION_HISTORY_VERSION && RUNTIME_STATE_VERSION_PATTERN.test(ref.stateVersion)
  && SHA256_PATTERN.test(ref.sourceHash) && /^[a-f0-9]{64}$/.test(ref.hash)
  && Number.isSafeInteger(ref.index) && ref.index >= -1 && ref.index < 10000
  && typeof ref.hasGenerated === 'boolean' && typeof ref.hasAccepted === 'boolean'
  && (ref.hasGenerated || ref.hasAccepted)
export const isSectionHistoryReference = validRef

export const validateSectionHistoryReferences = detail => {
  if (!Array.isArray(detail?.revisions)) return false
  return detail.revisions.every(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return true
    if (!own(record, 'historyReference')) return true
    const ref = record.historyReference
    return validRef(ref) && own(record, 'generated') === ref.hasGenerated
      && own(record, 'accepted') === ref.hasAccepted
      && (!ref.hasGenerated || record.generated === null) && (!ref.hasAccepted || record.accepted === null)
  })
}

export const getSectionHistoryRowKey = row => ['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey',
  'sectionKey', 'stateVersion'].map(key => String(row[key])).join('|')
const safeDetail = detail => isBoundedSafeJson(detail, { maxDepth: 12, maxEntries: 10000,
  maxBytes: 256 * 1024, maxStringScalars: 8000, allowedForbiddenKeys: ['content', 'body', 'text'] })

export const createSectionHistoryReadContext = ({ readRows, session = null, readBudget } = {}) => {
  const deadline = Date.now() + 6000, cache = new Map(), records = new Map(), seen = new Set()
  let bytes = 0
  const budget = () => {
    const inherited = readBudget ? readBudget() : {}
    const remaining = Math.min(2000, deadline - Date.now(), inherited?.maxTimeMS ?? 2000, inherited?.timeoutMS ?? 2000)
    need(remaining > 0, 'READ_BUDGET_EXHAUSTED')
    // The driver owns the client deadline inside timed withTransaction calls
    // and rejects an operation-level timeoutMS. Keep the smaller server budget
    // and this reader's deadline; ordinary/manual reads retain their timeout.
    if (session?.explicit && session?.timeoutContext != null) {
      const options = { ...inherited, maxTimeMS: remaining }
      delete options.timeoutMS
      return options
    }
    return { ...inherited, maxTimeMS: remaining, timeoutMS: remaining }
  }
  const resolve = async (row, index) => {
    budget()
    need(Number.isSafeInteger(index) && index >= 0 && index < (row.sectionDetail?.revisions?.length || 0), 'REVISION_MISSING')
    const record = row.sectionDetail.revisions[index]
    need(validateSectionHistoryReferences(row.sectionDetail), 'REFERENCE_INVALID')
    if (!own(record, 'historyReference')) {
      need(safeDetail(record), 'REVISION_BODY_LIMIT')
      return clone(record)
    }
    const ref = record.historyReference, recordKey = `${getSectionHistoryRowKey(row)}|${index}`
    if (records.has(recordKey)) return clone(records.get(recordKey))
    seen.add(recordKey); need(seen.size <= 100, 'REFERENCE_LIMIT')
    need(ref.stateVersion !== row.stateVersion && typeof readRows === 'function', 'REFERENCE_TARGET_INVALID')
    const targetKey = `${getSectionHistoryRowKey({ ...row, stateVersion: ref.stateVersion })}|${ref.sourceHash}`
    if (!cache.has(targetKey)) cache.set(targetKey, (async () => {
      const filter = Object.fromEntries(['customerId', 'tenantId', 'runtimeInstanceId', 'runtimeInstanceKey', 'sectionKey']
        .map(key => { need(row[key] !== undefined && row[key] !== null && String(row[key]), 'SCOPE_MISSING'); return [key, row[key]] }))
      Object.assign(filter, { stateVersion: ref.stateVersion, sourceStateVersion: ref.stateVersion,
        sourceHash: ref.sourceHash, current: false })
      const rows = await readRows(filter, { session, readBudget: budget, ...budget(), limit: 2 })
      budget(); need(Array.isArray(rows) && rows.length === 1, 'REFERENCE_TARGET_MISSING')
      const target = rows[0]
      bytes += Buffer.byteLength(canonical(target), 'utf8'); need(bytes <= 512 * 1024, 'READ_BYTE_LIMIT')
      need(Object.entries(filter).every(([key, value]) => String(target[key]) === String(value)), 'REFERENCE_SCOPE_MISMATCH')
      need(target.legacyPath === `framework_state.sections.${row.sectionKey}`
        && target.projectionReceipt?.logicalPath === target.legacyPath
        && target.projectionReceipt?.algorithm === 'ss014-legacy-domain-canonical-json-v1'
        && target.projectionReceipt?.stateVersion === ref.stateVersion
        && target.projectionReceipt?.sourceHash === ref.sourceHash
        && safeDetail(target.sectionDetail) && validateSectionHistoryReferences(target.sectionDetail), 'REFERENCE_TARGET_INVALID')
      return target
    })())
    const target = await cache.get(targetKey)
    const material = ref.index === -1 ? target.sectionDetail : target.sectionDetail.revisions[ref.index]
    need(material && !own(material, 'historyReference') && hashSectionHistoryPair(material) === ref.hash, 'REFERENCE_HASH_MISMATCH')
    // Presence belongs to the archived record, which may omit a null live value.
    need((ref.hasGenerated || material.generated == null) && (ref.hasAccepted || material.accepted == null), 'REFERENCE_PRESENCE_INVALID')
    if (ref.index !== -1) need(isDeepStrictEqual(metadata(material), metadata(record)), 'REFERENCE_METADATA_MISMATCH')
    const result = { ...metadata(record), ...(ref.hasGenerated ? { generated: clone(material.generated ?? null) } : {}),
      ...(ref.hasAccepted ? { accepted: clone(material.accepted ?? null) } : {}) }
    need(safeDetail(result), 'REVISION_BODY_LIMIT')
    records.set(recordKey, result)
    return clone(result)
  }
  return { resolve, verify: async rows => {
    const result = new Map()
    for (const row of rows) {
      if (!own(row.sectionDetail, 'revisions')) {
        result.set(getSectionHistoryRowKey(row), new Map())
        continue
      }
      need(validateSectionHistoryReferences(row.sectionDetail), 'REFERENCE_INVALID')
      const resolved = new Map()
      for (let index = 0; index < row.sectionDetail.revisions.length; index += 1) {
        if (own(row.sectionDetail.revisions[index], 'historyReference')) resolved.set(index, await resolve(row, index))
      }
      result.set(getSectionHistoryRowKey(row), resolved)
    }
    return result
  } }
}

export const createSectionHistoryProjectors = ({ observedRow, resolvedRecords = new Map() } = {}) => {
  need(observedRow?.sectionDetail && validateSectionHistoryReferences(observedRow.sectionDetail), 'OBSERVED_HISTORY_INVALID')
  const observed = observedRow.sectionDetail
  const entries = observed.revisions.map((record, index) => {
    const full = own(record, 'historyReference') ? resolvedRecords.get(index) : record
    need(!own(record, 'historyReference') || (resolvedRecords.has(index) && !own(full, 'historyReference')), 'REFERENCE_NOT_VERIFIED')
    return { record, full, index }
  })
  const sameRecord = (first, second) => (!first || typeof first !== 'object' || Array.isArray(first)
    || !second || typeof second !== 'object' || Array.isArray(second)) ? isDeepStrictEqual(first, second)
    : isDeepStrictEqual(metadata(first), metadata(second))
    && own(first, 'generated') === own(second, 'generated') && own(first, 'accepted') === own(second, 'accepted')
    && hashSectionHistoryPair(first) === hashSectionHistoryPair(second)
  const previous = detail => {
    need(detail.revisions.length === entries.length, 'PREVIOUS_HISTORY_MISMATCH')
    const projected = { ...detail, revisions: detail.revisions.map((record, index) => {
      need(!own(record, 'historyReference') && sameRecord(record, entries[index].full), 'PREVIOUS_HISTORY_MISMATCH')
      return clone(entries[index].record)
    }) }
    need(isDeepStrictEqual(projected, observed), 'PREVIOUS_SECTION_MISMATCH')
    return projected
  }
  const next = detail => {
    const hasRefs = observed.revisions.some(record => own(record, 'historyReference'))
    if (!hasRefs && safeDetail(detail)) return detail
    const revisions = detail.revisions.map(record => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return clone(record)
      need(!own(record, 'historyReference'), 'ROOT_REFERENCE_FORBIDDEN')
      const matched = entries.filter(entry => sameRecord(record, entry.full))
      need(matched.length <= 1, 'HISTORY_AMBIGUOUS')
      let ref
      if (matched.length) ref = matched[0].record.historyReference || { version: SECTION_HISTORY_VERSION,
        stateVersion: observedRow.stateVersion, sourceHash: observedRow.sourceHash, index: matched[0].index,
        hash: hashSectionHistoryPair(record), hasGenerated: own(record, 'generated'), hasAccepted: own(record, 'accepted') }
      else {
        need(hashSectionHistoryPair(record) === hashSectionHistoryPair(observed)
          && (!own(record, 'generated') ? observed.generated == null : true)
          && (!own(record, 'accepted') ? observed.accepted == null : true), 'HISTORY_NOT_RETAINED')
        ref = { version: SECTION_HISTORY_VERSION, stateVersion: observedRow.stateVersion, sourceHash: observedRow.sourceHash,
          index: -1, hash: hashSectionHistoryPair(record), hasGenerated: own(record, 'generated'), hasAccepted: own(record, 'accepted') }
      }
      need(validRef(ref), 'REFERENCE_INVALID')
      return { ...metadata(record), ...(own(record, 'generated') ? { generated: null } : {}),
        ...(own(record, 'accepted') ? { accepted: null } : {}), historyReference: clone(ref) }
    })
    return { ...detail, revisions }
  }
  return { previous, next }
}
