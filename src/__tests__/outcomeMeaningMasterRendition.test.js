import { jest } from '@jest/globals'
import JSZip from 'jszip'
import { meaningMasterRecordFixture } from './fixtures/meaningSourceMasterFixture.js'
import { governedDocxFixture } from './fixtures/governedDocxCandidateFixture.js'
import { projectMeaningMasterSource, MEANING_MASTER_FLAGS, meaningMasterRequestFingerprint } from '../services/outcomeMeaningSourceMasterContract.js'
import { prepareMeaningMasterDocxRendition } from '../services/outcomeMeaningMasterRenditionService.js'
import { prepareGovernedPrivateDocxCandidate } from '../services/outcomeGovernedDocxCandidateService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { hashOutcomeQualityStageValue } from '../services/outcomeQualityStageExecutionService.js'

const clone = value => JSON.parse(JSON.stringify(value))
// Coherent unsigned projections for branch/renderer checks, not provenance proof.
const fixture = () => {
  const f = meaningMasterRecordFixture(), g = governedDocxFixture()
  f.envelope.source.selectedPacks = clone(g.envelope.source.selectedPacks)
  f.envelope.source.content.shaping = clone(g.shaping)
  f.envelope.source.stageRefs.find(ref => ref.stageKey === 'OUTPUT_SHAPING').outputFingerprint = hashOutcomeQualityStageValue(g.shaping)
  f.seal()
  const row = f.record, body = row.body
  row.sourceFingerprint = body.sourceFingerprint = f.envelope.sourceFingerprint
  row.requestFingerprint = body.requestFingerprint = meaningMasterRequestFingerprint(row.sourceFingerprint)
  body.sourceSnapshot = projectMeaningMasterSource(f.envelope); f.rehash()
  const receipt = { master: { masterId: row.masterId, version: 1, purpose: body.purpose, status: body.status,
    permittedUse: body.permittedUse, classification: body.classification, sourceFingerprint: row.sourceFingerprint,
    sourceProjectionFingerprint: body.sourceProjectionFingerprint, ...Object.fromEntries(MEANING_MASTER_FLAGS.map(key => [key, false])) },
  masterReference: { storageId: String(row._id), masterId: row.masterId, version: 1, scope: f.scope,
    bodyFingerprint: row.bodyFingerprint, sourceFingerprint: row.sourceFingerprint,
    sourceProjectionFingerprint: body.sourceProjectionFingerprint, auditId: String(row.auditId), auditSignatureVersion: row.auditSignatureVersion },
  sourceEnvelope: f.envelope }
  const docs = [...g.documents.map(doc => ({ ...doc.source, content: doc.content, available: true, status: 'ACTIVE' })), g.audienceDocument]
  const loader = jest.fn(async query => docs.find(doc => doc.packId === query.packId && doc.versionId === query.versionId))
  const reader = jest.fn(async () => clone(receipt))
  const args = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, masterId: row.masterId,
    version: 1, deps: { readMaster: reader, loadPackContent: loader } }
  return { ...f, receipt, args, reader, loader }
}
afterEach(() => jest.restoreAllMocks())

test('actual renderer returns unchanged DOCX bytes with explicit private master lineage outside file text', async () => {
  const f = fixture(), before = JSON.stringify(f.receipt)
  const direct = await prepareGovernedPrivateDocxCandidate({ ...f.args,
    deps: { readSource: async () => f.envelope, loadPackContent: f.loader } })
  const result = await prepareMeaningMasterDocxRendition(f.args)
  expect(f.reader).toHaveBeenCalledTimes(2)
  expect(result.buffer.equals(direct.buffer)).toBe(true)
  expect(result.input.renditionInput).toEqual(direct.input)
  expect(result.input.renditionInputFingerprint).toBe(direct.inputFingerprint)
  expect(result.input.masterReference).toEqual(f.receipt.masterReference)
  expect(result.input.outputChecksum).toBe(result.artifact.outputChecksum)
  expect(result.inputFingerprint).toBe(membershipHash(result.input))
  expect(result.input.expressionOrigin).toBe('RETAINED_SOURCE_SHAPING_UNREVIEWED')
  expect(result.input.renditionInput.sourceEnvelope.source.reviewState.status).toBe('FAILED')
  expect(result).toMatchObject({ status: 'PRIVATE_UNREVIEWED', persistenceAvailable: false })
  for (const flag of MEANING_MASTER_FLAGS) expect(result[flag]).toBe(false)
  const xml = await (await JSZip.loadAsync(result.buffer)).file('word/document.xml').async('string')
  expect(xml).toContain('Observation 1 remains provisional.')
  expect(xml).toContain('Qualification 14: broader evidence is missing.')
  expect(xml).not.toContain(f.record.masterId); expect(xml).not.toContain('PRESERVED_TEST_FAILURE')
  expect(JSON.stringify(f.receipt)).toBe(before)
})

test.each([
  ['foreign master', x => { x.masterReference.masterId = 'meaning_master_12345678-1234-1234-1234-123456789012' }],
  ['version', x => { x.masterReference.version = 2 }],
  ['storage identity', x => { x.masterReference.storageId = [] }],
  ['missing reference field', x => { delete x.masterReference.auditId }],
  ['extra reference field', x => { x.masterReference.approved = true }],
  ['audit version', x => { x.masterReference.auditSignatureVersion = '2' }],
  ['body fingerprint', x => { x.masterReference.bodyFingerprint = 'invalid' }],
  ['source fingerprint', x => { x.masterReference.sourceFingerprint = '0'.repeat(64) }],
  ['projection fingerprint', x => { x.masterReference.sourceProjectionFingerprint = '0'.repeat(64) }],
  ['scope', x => { x.masterReference.scope.runtimeInstanceId = '507f1f77bcf86cd799439099' }],
  ['array with named scope fields', x => { x.masterReference.scope = Object.assign([], x.masterReference.scope) }],
  ['custom scope prototype', x => { Object.setPrototypeOf(x.masterReference.scope, { unexpected: true }) }],
  ['meaning change', x => { x.sourceEnvelope.source.content.workingDraft.title += 'changed' }],
  ...MEANING_MASTER_FLAGS.map(flag => [flag, x => { x.master[flag] = true }]),
])('refuses %s before compiling', async (_name, change) => {
  const f = fixture(); change(f.receipt)
  // Exercise the supplied shape itself; JSON cloning would erase custom
  // prototypes and named array properties before the consumer sees them.
  f.reader.mockResolvedValue(f.receipt)
  const compile = jest.fn(); f.args.deps.compileCandidate = compile
  await expect(prepareMeaningMasterDocxRendition(f.args)).rejects.toThrow()
  expect(compile).not.toHaveBeenCalled()
})

test.each(['reader', 'compiler', 'pack'])('propagates %s failure without producing a rendition', async kind => {
  const f = fixture()
  if (kind === 'reader') f.reader.mockRejectedValue(Error('READER_REFUSAL'))
  if (kind === 'compiler') f.args.deps.compileCandidate = async () => { throw Error('COMPILER_REFUSAL') }
  if (kind === 'pack') f.loader.mockResolvedValue({ available: false })
  await expect(prepareMeaningMasterDocxRendition(f.args)).rejects.toThrow()
})

test.each(['source', 'input fingerprint', 'bytes', 'renderer', 'package', 'length', 'approval'])('refuses changed compiled %s', async kind => {
  const f = fixture()
  f.args.deps.compileCandidate = async args => {
    const result = await prepareGovernedPrivateDocxCandidate(args)
    if (kind === 'source') result.input.sourceEnvelope.source.reviewState.status = 'CHANGED'
    if (kind === 'input fingerprint') result.inputFingerprint = '0'.repeat(64)
    if (kind === 'bytes') result.buffer = Buffer.from('changed')
    if (kind === 'renderer') { result.input.renderer.version = 'unsupported'; result.inputFingerprint = membershipHash(result.input) }
    if (kind === 'package') result.packageValidation = { ...result.packageValidation, status: 'FAIL' }
    if (kind === 'length') result.artifact.byteLength++
    if (kind === 'approval') result.authorisesApproval = true
    return result
  }
  await expect(prepareMeaningMasterDocxRendition(f.args)).rejects.toMatchObject({ details: { reason: 'COMPILED_RENDITION_CHANGED' } })
})

test('post-compile master drift refuses use', async () => {
  const f = fixture(), changed = clone(f.receipt)
  changed.masterReference.bodyFingerprint = 'f'.repeat(64)
  f.reader.mockResolvedValueOnce(clone(f.receipt)).mockResolvedValueOnce(changed)
  await expect(prepareMeaningMasterDocxRendition(f.args)).rejects.toMatchObject({ details: { reason: 'MASTER_CHANGED_AFTER_COMPILATION' } })
})
test('post-compile reader/audit refusal does not become success', async () => {
  const f = fixture(); f.reader.mockResolvedValueOnce(clone(f.receipt)).mockRejectedValueOnce(Error('AUDIT_REFUSAL'))
  await expect(prepareMeaningMasterDocxRendition(f.args)).rejects.toThrow('AUDIT_REFUSAL')
})
test('a retained compiler bundle mutated during recheck cannot change the accepted input or bytes', async () => {
  const f = fixture(); let retained, expected
  f.args.deps.compileCandidate = async args => {
    retained = await prepareGovernedPrivateDocxCandidate(args)
    expected = { buffer: Buffer.from(retained.buffer), input: clone(retained.input),
      artifact: clone(retained.artifact), packageValidation: clone(retained.packageValidation) }
    return retained
  }
  f.reader.mockImplementationOnce(async () => clone(f.receipt)).mockImplementationOnce(async () => {
    retained.buffer.fill(0); retained.input.markdown = 'MUTATED_AFTER_VALIDATION'
    retained.artifact.outputChecksum = 'sha256:' + '0'.repeat(64)
    retained.packageValidation = { status: 'FAIL' }
    return clone(f.receipt)
  })
  const result = await prepareMeaningMasterDocxRendition(f.args)
  expect(result.buffer.equals(expected.buffer)).toBe(true)
  expect(result.input.renditionInput).toEqual(expected.input)
  expect(result.artifact).toEqual(expected.artifact)
  expect(result.packageValidation).toEqual(expected.packageValidation)
  expect(result.input.outputChecksum).toBe(expected.artifact.outputChecksum)
  expect(result.inputFingerprint).toBe(membershipHash(result.input))
})
test('late compilation completion is refused without abandoning work', async () => {
  const f = fixture(); let now = Date.now(); jest.spyOn(Date, 'now').mockImplementation(() => now)
  f.args.deps.compileCandidate = async args => { const result = await prepareGovernedPrivateDocxCandidate(args); now += 360001; return result }
  await expect(prepareMeaningMasterDocxRendition(f.args)).rejects.toMatchObject({ details: { reason: 'MASTER_RENDITION_DEADLINE' } })
})
test('invalid request version is refused before reading', async () => {
  const f = fixture()
  await expect(prepareMeaningMasterDocxRendition({ ...f.args, version: 2 })).rejects.toThrow()
  expect(f.reader).not.toHaveBeenCalled()
})
