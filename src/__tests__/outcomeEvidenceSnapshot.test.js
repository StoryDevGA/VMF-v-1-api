import { describe, expect, jest, test } from '@jest/globals'
import { assembleOutcomeEvidenceInventory, assertOutcomeEvidenceInventory, snapshotHash } from '../utils/outcomeEvidenceSnapshot.js'

const scope = { customerId: 'customer', tenantId: 'tenant', runtimeInstanceId: 'runtime', stateVersion: 'version' }
const fixture = (size) => {
  const evidence = Array.from({ length: size }, (_, index) => ({ ...scope,
    _id: String(index).padStart(6, '0'), evidenceObjectId: `evidence-${index}`, sourceId: 'source',
    extractedFact: `Stored fact ${index}`, proofDependency: [] }))
  const sources = [{ ...scope, _id: 'source-row', sourceId: 'source' }]
  const rows = { evidence, sources }
  return { evidence, args: { scope, sections: [{ sectionKey: 'section', references: size ? ['evidence-0'] : [] }],
    readPage: jest.fn(async (kind, after, limit) => rows[kind].filter((row) => after === null || row._id > after).slice(0, limit)),
    count: jest.fn(async (kind) => rows[kind].length), validateRows: (kind, page) => {
      if (page.some((row) => row.customerId !== scope.customerId || row.tenantId !== scope.tenantId
        || row.runtimeInstanceId !== scope.runtimeInstanceId)) throw Object.assign(new Error('Scope mismatch'), { code: 'SCOPE_MISMATCH' })
    } } }
}
describe('complete evidence inventory with governed projection', () => {
  test.each([0, 499, 500, 501, 853])('completely inventories %i records without raising projected limits', async (size) => {
    const { args } = fixture(size)
    const result = await assembleOutcomeEvidenceInventory(args)
    expect(result.receipt.completeness).toBe('COMPLETE')
    expect(result.receipt.collections.evidence.totalCount).toBe(size)
    expect(result.receipt.collections.evidence.orderedIds).toHaveLength(size)
    expect(result.receipt.collections.evidence.pages).toHaveLength(Math.ceil(size / 150))
    expect(result.evidenceObjects).toHaveLength(size ? 1 : 0)
    args.readPage.mock.calls.forEach((call) => expect(call[2]).toBe(150))
    expect(() => assertOutcomeEvidenceInventory({ ...result, inventoryReceipt: result.receipt })).not.toThrow()
  })
  test('missing page preserves an incomplete receipt', async () => {
    const { args } = fixture(501); const read = args.readPage
    args.readPage = jest.fn((kind, after, limit) => kind === 'evidence' && after ? [] : read(kind, after, limit))
    await expect(assembleOutcomeEvidenceInventory(args)).rejects.toMatchObject({
      code: 'OUTCOME_EVIDENCE_SNAPSHOT_PAGE_MISSING_OR_INVALID', details: { snapshotReceipt: { completeness: 'INCOMPLETE' } } })
  })
  test('duplicate page is rejected rather than counted twice', async () => {
    const { args } = fixture(501); const read = args.readPage
    args.readPage = jest.fn((kind, after, limit) => read(kind, null, limit))
    await expect(assembleOutcomeEvidenceInventory(args)).rejects.toMatchObject({ code: 'OUTCOME_EVIDENCE_SNAPSHOT_DUPLICATE_OR_UNORDERED_RECORD' })
  })
  test('same-count evidence mutation is detected by the independent full-body re-read', async () => {
    const { args } = fixture(501); const read = args.readPage; let starts = 0
    args.readPage = jest.fn(async (kind, after, limit) => {
      if (kind === 'evidence' && !after) starts++
      const page = await read(kind, after, limit)
      return starts > 1 && kind === 'evidence' ? page.map((row) => ({ ...row, extractedFact: 'changed' })) : page
    })
    await expect(assembleOutcomeEvidenceInventory(args)).rejects.toMatchObject({ code: 'OUTCOME_EVIDENCE_SNAPSHOT_RECORDS_CHANGED' })
  })
  test.each(['customerId', 'tenantId', 'runtimeInstanceId'])('rejects %s mismatch even on unselected evidence', async (field) => {
    const { args, evidence } = fixture(501); evidence[499][field] = 'outside'
    await expect(assembleOutcomeEvidenceInventory(args)).rejects.toMatchObject({ code: 'OUTCOME_EVIDENCE_SNAPSHOT_SCOPE_MISMATCH' })
  })
  test('retries produce identical manifests and projection hashes', async () => {
    const { args } = fixture(853)
    expect(await assembleOutcomeEvidenceInventory(args)).toEqual(await assembleOutcomeEvidenceInventory(args))
  })
  test('source references and original resolvable proof dependencies extend section closure', async () => {
    const { args, evidence } = fixture(501); evidence[0].proofDependency = ['evidence-500', 'economics']
    const result = await assembleOutcomeEvidenceInventory(args)
    expect(result.evidenceObjects.map((row) => row.evidenceObjectId)).toEqual(['evidence-0', 'evidence-500'])
    expect(result.evidenceObjects[0].proofDependency).toEqual(['evidence-500', 'economics'])
  })
  test('unresolved section reference remains distinct from complete inventory', async () => {
    const { args } = fixture(853); args.sections[0].references.push('missing')
    const result = await assembleOutcomeEvidenceInventory(args)
    expect(result.receipt).toMatchObject({ completeness: 'COMPLETE', sectionReadiness: 'UNRESOLVED' })
    expect(result.receipt.sectionCoverage[0].missingReferences).toEqual(['missing'])
    expect(() => assertOutcomeEvidenceInventory({ ...result, inventoryReceipt: result.receipt })).not.toThrow()
  })
  test.each(['added', 'omitted', 'changed', 'page-missing'])('compiler validation rejects %s projected record or page', async (mutation) => {
    const { args, evidence } = fixture(853); const result = await assembleOutcomeEvidenceInventory(args)
    const snapshot = { evidenceObjects: result.evidenceObjects, sourceRegistry: result.sourceRegistry, inventoryReceipt: result.receipt }
    if (mutation === 'added') snapshot.evidenceObjects.push(evidence[500])
    if (mutation === 'omitted') snapshot.evidenceObjects = []
    if (mutation === 'changed') snapshot.evidenceObjects[0].extractedFact = 'changed'
    if (mutation === 'page-missing') {
      snapshot.inventoryReceipt.collections.evidence.pages.pop()
      const { overallHash, ...body } = snapshot.inventoryReceipt
      snapshot.inventoryReceipt.overallHash = snapshotHash(body)
    }
    expect(() => assertOutcomeEvidenceInventory(snapshot)).toThrow()
  })
  test.each(['proofReferences', 'sourceReference', 'storageId', 'sectionSnapshot'])('rejects rehashed %s metadata rather than losing proof or coverage', async (field) => {
    const { args, evidence } = fixture(853)
    evidence[0].proofDependency = ['evidence-500']
    const result = await assembleOutcomeEvidenceInventory(args)
    const snapshot = { evidenceObjects: result.evidenceObjects, sourceRegistry: result.sourceRegistry, inventoryReceipt: result.receipt }
    const receipt = result.receipt
    if (field === 'proofReferences') {
      receipt.collections.evidence.records[0].proofReferences = []
      receipt.selectedEvidenceIds = ['evidence-0']
      snapshot.evidenceObjects = snapshot.evidenceObjects.filter((row) => row.evidenceObjectId === 'evidence-0')
    } else if (field === 'sectionSnapshot') receipt.sectionCoverage[0].references = ['evidence-500']
    else receipt.collections.evidence.records[0][field] = 'forged'
    for (const collection of Object.values(receipt.collections)) {
      let offset = 0
      for (const page of collection.pages) { page.hash = snapshotHash(collection.records.slice(offset, offset + page.ids.length)); offset += page.ids.length }
    }
    const { overallHash, ...body } = receipt
    receipt.overallHash = snapshotHash(body)
    expect(() => assertOutcomeEvidenceInventory(snapshot)).toThrow()
  })

})
