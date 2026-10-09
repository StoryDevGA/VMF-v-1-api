import fs from 'node:fs'
import { jest } from '@jest/globals'
import { assembleOutcomeEvidenceInventory } from '../utils/outcomeEvidenceSnapshot.js'
import { resolveVE02RuntimeContext, VE02_SOURCE_BINDING, ve02MaterialRevision } from '../services/runtimeValidation/ve02RuntimeContextResolver.js'

const scope = { runtimeInstanceId: '507f1f77bcf86cd799439011', customerId: '507f1f77bcf86cd799439012',
  tenantId: '507f1f77bcf86cd799439013', runtimeInstanceKey: 'fixture-runtime', stateVersion: 'fixture-state-v2' }
const rawSource = fs.readFileSync(new URL('../runtime-contracts/ve02/VE02_EvidenceAssessmentResult_v1.0.md', import.meta.url), 'utf8')
const evidence = { _id: '507f1f77bcf86cd799439014', ...scope, sourceStateVersion: scope.stateVersion,
  sourceHash: 'sha256:fixture', evidenceObjectId: 'fixture-evidence', sourceId: 'fixture-source',
  current: true, lineageRef: 'fixture-evidence-lineage', extractedFact: 'Fixture evidence.' }
const source = { _id: '507f1f77bcf86cd799439015', ...scope, sourceStateVersion: scope.stateVersion,
  sourceHash: 'sha256:fixture', sourceId: 'fixture-source', current: true, sourceRef: 'fixture-source-reference' }
let dependencies, input, snapshot
beforeEach(async () => {
  const rows = { evidence: [evidence], sources: [source] }
  const assembled = await assembleOutcomeEvidenceInventory({ scope, sections: [],
    count: async (kind) => rows[kind].length, readPage: async (kind) => rows[kind], validateRows: () => {} })
  snapshot = { stateVersion: scope.stateVersion, inventoryReceipt: assembled.receipt,
    evidenceObjects: assembled.evidenceObjects, sourceRegistry: assembled.sourceRegistry }
  input = { runtimeInstanceId: scope.runtimeInstanceId, packageId: 'fixture-package', frameworkKey: 'QMF',
    payload: { evidence_id: evidence.evidenceObjectId, result_id: 'fixture-result' } }
  dependencies = {
    runtimeReader: jest.fn(async () => ({ ...scope, id: scope.runtimeInstanceId, packageId: input.packageId,
      frameworkKey: 'QMF', packageKey: 'fixture-package', packageVersion: '0.38.1', runtimeType: 'VALUE_NARRATIVE' })),
    snapshotReader: jest.fn(async () => snapshot), evidenceReader: jest.fn(async () => evidence),
    packResolver: jest.fn(async () => ({ activePacks: [{ ...VE02_SOURCE_BINDING,
      activationId: 'fixture-activation', versionId: 'fixture-version', activationStatus: 'ACTIVE' }] })),
    versionReader: jest.fn(async () => ({ content: rawSource.trim(), contentHash: VE02_SOURCE_BINDING.contentHash,
      sourceDocuments: [{ sourceDocumentId: VE02_SOURCE_BINDING.sourceDocumentId, sourceHash: VE02_SOURCE_BINDING.contentHash }] })),
    historyReader: jest.fn(async () => []),
  }
})
const resolve = () => resolveVE02RuntimeContext({ input, scopes: {}, session: { inTransaction: () => true }, dependencies })
test('resolves exact scoped inventory and installed derivative, including evidence outside section selection', async () => {
  expect(snapshot.evidenceObjects).toEqual([])
  const context = await resolve()
  expect(context.evidenceRevisionRef).toBe(ve02MaterialRevision(evidence, source))
  expect(context.requiredProvenanceRefs).toEqual([source.sourceRef, evidence.lineageRef])
  expect(context.resultRecords).toEqual([])
  expect(dependencies.evidenceReader).toHaveBeenCalledWith(expect.objectContaining({
    customerId: scope.customerId, tenantId: scope.tenantId, runtimeInstanceId: scope.runtimeInstanceId, current: true,
  }))
})
test('requires an internal snapshot transaction', async () => {
  expect(await resolveVE02RuntimeContext({ input, scopes: {}, dependencies })).toBeUndefined()
  expect(dependencies.runtimeReader).not.toHaveBeenCalled()
})
test('material revision excludes fence metadata but includes evidence material and source identity', () => {
  expect(ve02MaterialRevision({ ...evidence, __v: 2, updatedAt: 'later' }, source)).toBe(ve02MaterialRevision(evidence, source))
  expect(ve02MaterialRevision({ ...evidence, extractedFact: 'changed' }, source)).not.toBe(ve02MaterialRevision(evidence, source))
  expect(ve02MaterialRevision(evidence, { ...source, sourceRef: 'changed' })).not.toBe(ve02MaterialRevision(evidence, source))
})
test('rejects a cross-scope requested record or changed full-body inventory', async () => {
  dependencies.evidenceReader.mockResolvedValue({ ...evidence, tenantId: 'another' })
  expect(await resolve()).toBeUndefined()
})
test('rejects a different selected package', async () => {
  input.packageId = 'different'
  dependencies.runtimeReader.mockResolvedValue({ ...scope, packageId: 'fixture-package', frameworkKey: 'QMF' })
  expect(await resolve()).toBeUndefined()
})
test.each(['sourceId', 'sourceHash', 'contentHash'])('does not infer mismatched installed %s', async (field) => {
  const version = await dependencies.versionReader()
  if (field === 'sourceId') version.sourceDocuments[0].sourceDocumentId = 'different'
  if (field === 'sourceHash') version.sourceDocuments[0].sourceHash = 'different'
  if (field === 'contentHash') version.contentHash = 'different'
  dependencies.versionReader.mockResolvedValue(version)
  expect(await resolve()).toBeUndefined()
})
test('does not turn missing result history into an empty verified set', async () => {
  dependencies.historyReader.mockResolvedValue(undefined)
  expect(await resolve()).toBeUndefined()
})
test('fails closed on absent or ambiguous lifecycle binding', async () => {
  dependencies.packResolver.mockResolvedValue({ activePacks: [] })
  expect(await resolve()).toBeUndefined()
  dependencies.packResolver.mockRejectedValue(new Error('Ambiguous activation'))
  await expect(resolve()).rejects.toThrow('Ambiguous activation')
})
