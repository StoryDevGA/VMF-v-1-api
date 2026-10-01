import { createHash } from 'node:crypto'

export const OUTCOME_EVIDENCE_SNAPSHOT_VERSION = 'outcome-evidence-inventory.v1'
export const OUTCOME_EVIDENCE_PAGE_SIZE = 150
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value
export const snapshotHash = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest('hex')
const fail = (reason, receipt) => { throw Object.assign(new Error('The governed evidence inventory is incomplete.'), {
  code: `OUTCOME_EVIDENCE_SNAPSHOT_${reason}`, status: 409,
  details: { snapshotReceipt: { ...receipt, completeness: 'INCOMPLETE', reason } },
}) }
const idsForReference = (reference, records) => records.filter((row) => row.id === reference
  || row.sourceReference === reference).map((row) => row.id)
export const deriveSnapshotSelection = (receipt) => {
  const records = receipt.collections.evidence.records
  const selected = new Set(receipt.sectionCoverage.flatMap((section) => section.references
    .flatMap((ref) => idsForReference(ref, records))))
  receipt.contradictionReferences.forEach((ref) => idsForReference(ref, records).forEach((id) => selected.add(id)))
  let changed = true
  while (changed) {
    changed = false
    records.filter((row) => selected.has(row.id)).forEach((row) => row.proofReferences.forEach((ref) => {
      idsForReference(ref, records).forEach((id) => { if (!selected.has(id)) { selected.add(id); changed = true } })
    }))
  }
  return [...selected].sort()
}

// Complete inventory is distinct from the bounded full-body section projection.
export const assembleOutcomeEvidenceInventory = async ({ scope, sections, contradictionReferences = [],
  readPage, count, validateRows, maxBytes = 512 * 1024 }) => {
  const receipt = { version: OUTCOME_EVIDENCE_SNAPSHOT_VERSION, pageSize: OUTCOME_EVIDENCE_PAGE_SIZE,
    scope, completeness: 'INCOMPLETE', collections: {},
    sectionSnapshot: sections, sectionSnapshotHash: snapshotHash(sections),
    sectionCoverage: sections.map((section) => ({ sectionKey: section.sectionKey,
      references: [...new Set(section.references)].sort() })).sort((a, b) => a.sectionKey < b.sectionKey ? -1 : a.sectionKey > b.sectionKey ? 1 : 0),
    contradictionReferences: [...new Set(contradictionReferences)].sort() }
  const bodies = {}
  const scan = async (kind) => {
    const totalCount = await count(kind)
    if (!Number.isSafeInteger(totalCount) || totalCount < 0) fail('COUNT_INVALID', receipt)
    const result = { totalCount, orderedIds: [], records: [], pages: [] }
    if (!receipt.collections[kind]) receipt.collections[kind] = result
    let after = null
    const semanticIds = new Set()
    while (result.records.length < totalCount) {
      const rows = await readPage(kind, after, OUTCOME_EVIDENCE_PAGE_SIZE)
      if (!rows.length || rows.length > OUTCOME_EVIDENCE_PAGE_SIZE) fail('PAGE_MISSING_OR_INVALID', receipt)
      validateRows(kind, rows)
      const records = rows.map((row) => ({ id: String(kind === 'evidence' ? row.evidenceObjectId : row.sourceId),
        storageId: String(row._id), hash: snapshotHash(row),
        ...(kind === 'evidence' ? { sourceReference: String(row.sourceId),
          proofReferences: Array.isArray(row.proofDependency) ? row.proofDependency : [] } : {}) }))
      for (let index = 0; index < records.length; index++) {
        const record = records[index]
        if (!record.id || !rowIdentity(rows[index]) || semanticIds.has(record.id)
          || (after && record.storageId <= String(after))) fail('DUPLICATE_OR_UNORDERED_RECORD', receipt)
        semanticIds.add(record.id); after = rows[index]._id
      }
      result.records.push(...records); result.orderedIds.push(...records.map((row) => row.id))
      result.pages.push({ index: result.pages.length, ids: records.map((row) => row.id), hash: snapshotHash(records) })
      if (result.records.length > totalCount) fail('COUNT_CHANGED', receipt)
      if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) fail('INVENTORY_BYTE_BOUND', receipt)
      if (!bodies[kind]) bodies[kind] = []
      bodies[kind].push(...rows)
    }
    if (await count(kind) !== totalCount) fail('COUNT_CHANGED', receipt)
    return result
  }
  try {
    for (const kind of ['evidence', 'sources']) receipt.collections[kind] = await scan(kind)
    // Re-read full bodies: identical IDs/counts alone cannot establish unchanged evidence.
    const firstBodies = { evidence: bodies.evidence || [], sources: bodies.sources || [] }
    for (const kind of ['evidence', 'sources']) {
      bodies[kind] = []
      if (snapshotHash(await scan(kind)) !== snapshotHash(receipt.collections[kind])) fail('RECORDS_CHANGED', receipt)
    }
      const sourceIds = new Set(receipt.collections.sources.orderedIds)
    if (receipt.collections.evidence.records.some((row) => !sourceIds.has(row.sourceReference))) fail('SOURCE_REFERENCE_MISSING', receipt)
    receipt.sectionCoverage = receipt.sectionCoverage.map((section) => ({ ...section,
      evidenceIds: [...new Set(section.references.flatMap((ref) => idsForReference(ref, receipt.collections.evidence.records)))].sort(),
      missingReferences: section.references.filter((ref) => !idsForReference(ref, receipt.collections.evidence.records).length) }))
    receipt.sectionReadiness = receipt.sectionCoverage.some((section) => section.missingReferences.length)
      || receipt.contradictionReferences.some((ref) => !idsForReference(ref, receipt.collections.evidence.records).length)
      ? 'UNRESOLVED' : 'REFERENCES_RESOLVED'
    receipt.selectedEvidenceIds = deriveSnapshotSelection(receipt)
    receipt.completeness = 'COMPLETE'
    receipt.overallHash = snapshotHash(receipt)
    const selected = new Set(receipt.selectedEvidenceIds)
    return { receipt, evidenceObjects: firstBodies.evidence.filter((row) => selected.has(row.evidenceObjectId)),
      sourceRegistry: firstBodies.sources }
  } catch (error) {
    if (error.details?.snapshotReceipt) throw error
    fail(error.code || 'READ_UNAVAILABLE', receipt)
  }
}
const rowIdentity = (row) => row._id != null && String(row._id).length > 0

export const assertOutcomeEvidenceInventory = (snapshot) => {
  const receipt = snapshot.inventoryReceipt
  if (!receipt) return // Bounded legacy contracts remain supported.
  const { overallHash, ...body } = receipt
  if (receipt.completeness !== 'COMPLETE') fail(receipt.reason || 'INCOMPLETE', receipt)
  if (receipt.version !== OUTCOME_EVIDENCE_SNAPSHOT_VERSION || receipt.pageSize !== OUTCOME_EVIDENCE_PAGE_SIZE
    || overallHash !== snapshotHash(body)) fail('RECEIPT_INVALID', receipt)
  for (const kind of ['evidence', 'sources']) {
    const collection = receipt.collections[kind]
    if (collection.totalCount !== collection.records.length || collection.orderedIds.length !== collection.totalCount
      || new Set(collection.orderedIds).size !== collection.totalCount
      || snapshotHash(collection.orderedIds) !== snapshotHash(collection.records.map((row) => row.id))) fail('RECEIPT_COUNT_INVALID', receipt)
    let offset = 0; let previous = ''
    for (const [index, page] of collection.pages.entries()) {
      const records = collection.records.slice(offset, offset + page.ids.length)
      if (page.index !== index || !page.ids.length || page.ids.length > receipt.pageSize
        || snapshotHash(page.ids) !== snapshotHash(records.map((row) => row.id))
        || page.hash !== snapshotHash(records)) fail('RECEIPT_PAGE_INVALID', receipt)
      records.forEach((row) => { if (!row.storageId || row.storageId <= previous) fail('RECEIPT_ORDER_INVALID', receipt); previous = row.storageId })
      offset += records.length
    }
    if (offset !== collection.totalCount) fail('RECEIPT_PAGE_MISSING', receipt)
  }
  if (snapshotHash(receipt.sectionSnapshot) !== receipt.sectionSnapshotHash
    || snapshotHash(receipt.sectionSnapshot.map((section) => ({ sectionKey: section.sectionKey,
      references: [...new Set(section.references)].sort() })).sort((a, b) => a.sectionKey < b.sectionKey ? -1 : a.sectionKey > b.sectionKey ? 1 : 0))
      !== snapshotHash(receipt.sectionCoverage.map(({ sectionKey, references }) => ({ sectionKey, references })))) fail('SECTION_SNAPSHOT_INVALID', receipt)
  for (const row of snapshot.evidenceObjects) {
    const record = receipt.collections.evidence.records.find((record) => record.id === row.evidenceObjectId)
    if (!record || record.storageId !== String(row._id) || record.sourceReference !== row.sourceId
      || snapshotHash(record.proofReferences) !== snapshotHash(Array.isArray(row.proofDependency) ? row.proofDependency : [])) fail('PROJECTION_METADATA_INVALID', receipt)
  }
  const sourceIds = new Set(receipt.collections.sources.orderedIds)
  if (receipt.collections.evidence.records.some((row) => !sourceIds.has(row.sourceReference))) fail('SOURCE_REFERENCE_MISSING', receipt)
  const sectionKeys = new Set()
  for (const section of receipt.sectionCoverage) {
    if (!section.sectionKey || sectionKeys.has(section.sectionKey)) fail('SECTION_COVERAGE_INVALID', receipt)
    sectionKeys.add(section.sectionKey)
    const expected = [...new Set(section.references.flatMap((ref) => idsForReference(ref, receipt.collections.evidence.records)))].sort()
    const missing = section.references.filter((ref) => !idsForReference(ref, receipt.collections.evidence.records).length)
    if (snapshotHash(missing) !== snapshotHash(section.missingReferences)
      || snapshotHash(expected) !== snapshotHash(section.evidenceIds)) fail('SECTION_COVERAGE_INVALID', receipt)
  }
  const sectionReadiness = receipt.sectionCoverage.some((section) => section.missingReferences.length)
    || receipt.contradictionReferences.some((ref) => !idsForReference(ref, receipt.collections.evidence.records).length)
    ? 'UNRESOLVED' : 'REFERENCES_RESOLVED'
  if (receipt.sectionReadiness !== sectionReadiness) fail('SECTION_COVERAGE_INVALID', receipt)
  const selection = deriveSnapshotSelection(receipt)
  if (snapshotHash(selection) !== snapshotHash(receipt.selectedEvidenceIds)
    || snapshotHash(selection) !== snapshotHash(snapshot.evidenceObjects.map((row) => row.evidenceObjectId).sort())) fail('PROJECTION_COVERAGE_INVALID', receipt)
  for (const [kind, rows] of [['evidence', snapshot.evidenceObjects], ['sources', snapshot.sourceRegistry]]) {
    const records = new Map(receipt.collections[kind].records.map((row) => [row.id, row]))
    if (kind === 'sources' && rows.length !== records.size) fail('SOURCE_REFERENCE_MISSING', receipt)
    rows.forEach((row) => {
      const id = kind === 'evidence' ? row.evidenceObjectId : row.sourceId
      if (String(row.customerId) !== receipt.scope.customerId || String(row.tenantId) !== receipt.scope.tenantId
        || String(row.runtimeInstanceId) !== receipt.scope.runtimeInstanceId || row.stateVersion !== receipt.scope.stateVersion) fail('SCOPE_MISMATCH', receipt)
      if (records.get(id)?.storageId !== String(row._id) || records.get(id)?.hash !== snapshotHash(row)) fail('PROJECTION_RECORD_CHANGED', receipt)
    })
  }
}
