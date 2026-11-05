import { jest, test, expect, afterEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import Candidate from '../models/OutcomeDocxRenditionCandidate.js'
import Audit from '../models/AuditLog.js'
import Preview from '../models/OutcomeDocxPagePreview.js'
import { masterLinkedDocxFixture } from './fixtures/masterLinkedDocxFixture.js'
import { prepareCorrectedMeaningMasterDocxRendition, prepareMeaningMasterDocxRendition } from '../services/outcomeMeaningMasterRenditionService.js'
import { createCorrectedMasterLinkedPrivateDocxCandidate, readPrivateDocxCandidate } from '../services/outcomeDocxCandidatePersistenceService.js'
import { assertPrivateDocxCandidateRecord } from '../services/outcomeDocxCandidateRecordContract.js'
import { masterBindingFromBridge, correctedMasterLinkedRequestFingerprint } from '../services/outcomeMasterLinkedDocxContract.js'
import { createDocxPagePreview } from '../services/outcomeDocxPagePreviewPersistenceService.js'
import { prepareMasterLinkedDocxReviewBinding } from '../services/outcomeMasterLinkedDocxReviewBindingService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { readFailedDocxCorrectionPredecessor, assertFailedCorrectionCompletion } from '../services/outcomeDocxCorrectionPredecessorService.js'
import { hashOutcomeQualityStageValue } from '../services/outcomeQualityStageExecutionService.js'

const copy = value => JSON.parse(JSON.stringify(value))
const fullBoundary = 'These three quoted statements must not be read as assigning an execution approver, defining an approval procedure, or granting permission after review. This is descriptive organisation of the recorded question and outstanding review, not an adopted approval process. This paper assigns no such authority and adopts no decision.'
const fixture = async () => {
  const f = await masterLinkedDocxFixture(null, source => {
    source.content.shaping.expressionProfileVersion = 'outcome-commercial-expression.v4'
    source.content.shaping.sections[12].body = 'They do not assign an execution approver, define an approval procedure, adopt a decision or grant permission after review.\n\n> Trial execution is not authorised.'
    source.content.workingDraft.sections = source.content.shaping.sections.map((s, i) => ({ sectionKey: s.sectionKey,
      title: i === 12 ? 'Recorded question and review context' : `Role ${i + 1}`, content: i === 12 ? fullBoundary : 'Recorded context.' }))
    // Rebuild only this unsigned unit projection's matching baseline receipt.
    const fingerprint = hashOutcomeQualityStageValue(source.content.workingDraft)
    source.stageRefs.find(ref => ref.stageKey === 'WORKING_DRAFT').outputFingerprint = fingerprint
    source.content.approvedMeaning.workingDraftOutputFingerprint = fingerprint
  })
  const correctionReference = { predecessor: { candidateId: f.record.candidateId, inputFingerprint: f.record.body.inputFingerprint,
    outputChecksum: f.record.body.artifact.outputChecksum, failedReviewExecutionId: `master_docx_result_${'a'.repeat(40)}`,
    failedReviewResultFingerprint: 'b'.repeat(64) }, predecessorBodyFingerprint: f.record.bodyFingerprint }
  const bridgeArgs = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, masterId: f.masterReceipt.masterReference.masterId,
    version: 1, correctionReference, deps: { readMaster: async () => copy(f.masterReceipt), loadPackContent: f.loadPackContent } }
  return { ...f, correctionReference, bridgeArgs }
}
afterEach(() => jest.restoreAllMocks())

test('new bridge binds the unchanged master, distinct expression and failed-predecessor reference without review authority', async () => {
  const f = await fixture(), before = JSON.stringify(f.masterReceipt)
  const bridge = await prepareCorrectedMeaningMasterDocxRendition(f.bridgeArgs)
  expect(JSON.stringify(f.masterReceipt)).toBe(before)
  expect(bridge.input).toMatchObject({ contractVersion: 'meaning-master-private-docx-input.v2',
    expressionOrigin: 'VERSIONED_COMMERCIAL_CORRECTION_UNREVIEWED', correctionReference: f.correctionReference })
  expect(bridge.input.renditionInput.contractVersion).toBe('governed-private-docx-input.v2')
  expect(bridge.input.renditionInput.sourceEnvelope).toEqual(f.envelope)
  expect(bridge.input.masterReference).toEqual(f.bridge.input.masterReference)
  expect(bridge).toMatchObject({ status: 'PRIVATE_UNREVIEWED', authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false })
  const legacy = await prepareMeaningMasterDocxRendition(f.bridgeArgs)
  expect(legacy.input.contractVersion).toBe('meaning-master-private-docx-input.v1')
  expect(legacy.buffer.equals(f.bridge.buffer)).toBe(true)
})

// Staged unit transactions model branching, never actual persistence or races.
const store = async () => {
  const f = await fixture(), rows = [f.record], audits = [f.audit], previews = []
  let staged = { rows: [], audits: [], previews: [] }, atomic = false
  const query = (list, key, filter) => { let session
    return { select() { return this }, session(value) { session = value; return this },
      async lean() { return [...list, ...(session ? staged[key] : [])].find(row => Object.entries(filter).every(([k, v]) => String(row[k]) === String(v))) || null } }
  }
  const transaction = { endSession: jest.fn(), async withTransaction(fn) {
    atomic = true
    try { await fn(); rows.push(...staged.rows); audits.push(...staged.audits); previews.push(...staged.previews) }
    finally { atomic = false; staged = { rows: [], audits: [], previews: [] } }
  } }
  const model = (Model, list, key) => ({ collection: { indexes: async () => Model.schema.indexes().map(([index, options]) => ({ ...options, key: index })) },
    db: { startSession: async () => transaction }, findOne: filter => query(list, key, filter),
    async create([row]) { const doc = new Model(row); await doc.validate(); const saved = doc.toObject(); staged[key].push(saved); return [saved] } })
  const writer = { log: jest.fn(async input => { const doc = new Audit(input); doc.generateSignature(); const row = doc.toObject(); staged.audits.push(row); return row }) }
  const predecessorReader = jest.fn(async () => { expect(atomic).toBe(false); return copy(f.correctionReference) })
  const deps = { Candidate: model(Candidate, rows, 'rows'), Audit: { prototype: Audit.prototype, findOne: filter => query(audits, 'audits', filter) },
    auditService: writer, readSource: async () => { expect(atomic).toBe(false); return copy(f.envelope) },
    readMaster: async () => { expect(atomic).toBe(false); return copy(f.masterReceipt) },
    loadPackContent: async value => { expect(atomic).toBe(false); return f.loadPackContent(value) }, readFailedPredecessor: predecessorReader }
  const args = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, payload: { ...f.payload, requestKey: randomUUID(),
    predecessorCandidateId: f.record.candidateId, expectedPredecessorBodyFingerprint: f.record.bodyFingerprint,
    failedReviewExecutionId: f.correctionReference.predecessor.failedReviewExecutionId,
    expectedFailedReviewResultFingerprint: f.correctionReference.predecessor.failedReviewResultFingerprint }, deps }
  const read = value => readPrivateDocxCandidate({ ...args, ...value, deps })
  const previewArgs = candidateId => ({ actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, candidateId,
    payload: { expectedSourceFingerprint: f.envelope.sourceFingerprint, expectedOutputChecksum: rows.find(r => r.candidateId === candidateId).body.artifact.outputChecksum },
    deps: { Preview: model(Preview, previews, 'previews'), Audit: deps.Audit, auditService: writer, readCandidate: read,
      readRuntime: async () => f.previewRuntime, renderPreview: async input => {
        const receipt = { ...copy(f.rendered.receipt), docxChecksum: input.outputChecksum }
        return { receipt, fingerprint: (await import('../services/docxPagePreviewRuntime.js')).previewHash(JSON.stringify(receipt)), pages: f.rendered.pages }
      } } })
  return { ...f, args, rows, audits, writer, predecessorReader, read, transaction, previewArgs, previews }
}

test('shared writer stores and replays a distinct corrected candidate, binds preview and permits preparation without dispatch', async () => {
  const f = await store(), old = copy(f.record)
  const saved = await createCorrectedMasterLinkedPrivateDocxCandidate(f.args)
  expect(saved.candidate.candidateId).not.toBe(f.record.candidateId)
  expect(saved.candidate.masterBinding.contractVersion).toBe('master-linked-private-docx-binding.v2')
  expect(saved.candidate.masterBinding.correctionReference).toEqual(f.correctionReference)
  expect((await createCorrectedMasterLinkedPrivateDocxCandidate(f.args)).idempotent).toBe(true)
  expect(f.rows).toHaveLength(2); expect(f.audits).toHaveLength(2)
  expect(copy(f.rows[0])).toEqual(old)
  const observed = await f.read({ candidateId: saved.candidate.candidateId, includeBytes: true, includeInput: true })
  expect(observed.candidateInput.contractVersion).toBe('governed-private-docx-input.v2')
  expect(assertPrivateDocxCandidateRecord(f.rows[1]).equals(observed.buffer)).toBe(true)
  const preview = await createDocxPagePreview(f.previewArgs(saved.candidate.candidateId))
  expect(preview.preview.candidateBodyFingerprint).toBe(saved.candidate.bodyFingerprint)
  expect(preview.preview.masterBindingFingerprint).toBe(saved.candidate.masterBindingFingerprint)
  await expect(prepareMasterLinkedDocxReviewBinding({ ...f.args, candidateId: saved.candidate.candidateId,
    deps: { readCandidate: f.read, readPreview: async () => ({ preview: preview.preview, pages: f.rendered.pages.map(p => Buffer.from(p.buffer)) }) } })).resolves.toMatchObject({ dispatchAvailable: false, binding: { contractVersion: 'master-linked-docx-review-binding.v2' } })
})

test.each([
  ['old request key', f => { f.args.payload.requestKey = f.record.requestKey }],
  ['wrong predecessor body', f => { f.args.payload.expectedPredecessorBodyFingerprint = '0'.repeat(64) }],
  ['wrong predecessor candidate', f => { f.args.payload.predecessorCandidateId = `docx_candidate_${randomUUID()}` }],
  ['mismatched reviewed file', f => { f.predecessorReader.mockResolvedValue({ ...f.correctionReference,
    predecessor: { ...f.correctionReference.predecessor, outputChecksum: `sha256:${'0'.repeat(64)}` } }) }],
  ['missing completed receipt', f => { f.predecessorReader.mockRejectedValue(Error('NO_COMPLETED_FAIL')) }],
  ['audit write failure', f => { f.writer.log.mockRejectedValue(Error('AUDIT_FAILED')) }],
])('refuses %s without a new durable unit row', async (_name, mutate) => {
  const f = await store(); mutate(f)
  await expect(createCorrectedMasterLinkedPrivateDocxCandidate(f.args)).rejects.toThrow()
  expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1)
})

test.each(['contractVersion', 'expressionOrigin', 'correctionReference'])('corrected binding rejects tampered %s even with outer body fingerprint', async field => {
  const f = await store(), saved = await createCorrectedMasterLinkedPrivateDocxCandidate(f.args), row = f.rows.find(r => r.candidateId === saved.candidate.candidateId)
  row.body.masterBinding[field] = field === 'correctionReference' ? {} : 'legacy'
  row.bodyFingerprint = membershipHash(row.body)
  expect(() => assertPrivateDocxCandidateRecord(row)).toThrow()
})

test('old binding cannot be paired with the corrected input or its request identity', async () => {
  const f = await fixture(), bridge = await prepareCorrectedMeaningMasterDocxRendition(f.bridgeArgs)
  expect(masterBindingFromBridge(bridge).contractVersion).toBe('master-linked-private-docx-binding.v2')
  expect(correctedMasterLinkedRequestFingerprint(f.masterReceipt.masterReference, bridge.renderer, f.correctionReference)).not.toBe(f.record.requestFingerprint)
})

test('default predecessor entry refuses an unconfirmed result before reading completion authority', async () => {
  const f = await fixture(), readCompleted = jest.fn()
  await expect(readFailedDocxCorrectionPredecessor({ actorUserId: f.actorUserId, scope: f.scope, candidate: f.record,
    failedReviewExecutionId: f.correctionReference.predecessor.failedReviewExecutionId,
    expectedFailedReviewResultFingerprint: f.correctionReference.predecessor.failedReviewResultFingerprint,
    deps: { readResult: async () => null, readCompleted } })).rejects.toThrow()
  expect(readCompleted).not.toHaveBeenCalled()
})

const reviewProjection = async () => {
  const f = await fixture(), ref = f.correctionReference.predecessor
  const args = { actorUserId: f.actorUserId, scope: f.scope, candidate: f.record,
    failedReviewExecutionId: ref.failedReviewExecutionId, expectedFailedReviewResultFingerprint: ref.failedReviewResultFingerprint }
  const projection = { executionId: ref.failedReviewExecutionId, resultFingerprint: ref.failedReviewResultFingerprint,
    body: { reviewStatus: 'FAIL', input: { mode: 'GENUINE_CONTROLLED_TEST', sourceProof: 'STORED_SOURCE_RECORDS',
      actorUserId: f.actorUserId, scope: copy(f.scope), subject: { binding: { candidateId: f.record.candidateId,
        candidateBodyFingerprint: f.record.bodyFingerprint, inputFingerprint: f.record.body.inputFingerprint,
        docxChecksum: f.record.body.artifact.outputChecksum, sourceFingerprint: f.record.body.sourceFingerprint,
        masterReference: copy(f.record.body.masterBinding.masterReference), renderer: copy(f.record.body.input.renderer) } } } } }
  const receipt = { mode: 'GENUINE_CONTROLLED_TEST', sourceProof: 'STORED_SOURCE_RECORDS', completionConfirmed: true,
    completionPersisted: true, genuineReviewUsed: true, executionId: ref.failedReviewExecutionId,
    resultFingerprint: ref.failedReviewResultFingerprint, reviewStatus: 'FAIL', findings: { overallStatus: 'FAIL' },
    docxChecksum: ref.outputChecksum, approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false }
  return { f, args, projection, receipt }
}

test('pure default-reader join predicates accept coherent projections only, without establishing genuine receipt authenticity', async () => {
  const { f, args, projection, receipt } = await reviewProjection()
  expect(assertFailedCorrectionCompletion(args, projection, receipt)).toEqual(f.correctionReference)
})
test.each([
  ['QA result', x => { x.projection.body.input.mode = 'NETWORK_SIMULATED' }],
  ['PASS result', x => { x.projection.body.reviewStatus = 'PASS' }],
  ['unsigned source proof', x => { x.projection.body.input.sourceProof = 'SIGNED_IN_MEMORY_TEST_FIXTURE' }],
  ['foreign actor', x => { x.projection.body.input.actorUserId = '507f1f77bcf86cd799439099' }],
  ['foreign tenant', x => { x.projection.body.input.scope.tenantId = '507f1f77bcf86cd799439099' }],
  ['wrong review id', x => { x.projection.executionId += '0' }],
  ['wrong result fingerprint', x => { x.projection.resultFingerprint = '0'.repeat(64) }],
  ['different candidate', x => { x.projection.body.input.subject.binding.candidateId = `docx_candidate_${randomUUID()}` }],
  ['different body', x => { x.projection.body.input.subject.binding.candidateBodyFingerprint = '0'.repeat(64) }],
  ['different input', x => { x.projection.body.input.subject.binding.inputFingerprint = '0'.repeat(64) }],
  ['different source', x => { x.projection.body.input.subject.binding.sourceFingerprint = '0'.repeat(64) }],
  ['different file', x => { x.projection.body.input.subject.binding.docxChecksum = `sha256:${'0'.repeat(64)}` }],
  ['different master', x => { x.projection.body.input.subject.binding.masterReference.bodyFingerprint = '0'.repeat(64) }],
  ['different renderer', x => { x.projection.body.input.subject.binding.renderer.version = '0.1.2' }],
  ['unconfirmed completion', x => { x.receipt.completionConfirmed = false }],
  ['unpersisted completion', x => { x.receipt.completionPersisted = false }],
  ['review unused', x => { x.receipt.genuineReviewUsed = false }],
  ['QA readback', x => { x.receipt.mode = 'NETWORK_SIMULATED' }],
  ['PASS readback', x => { x.receipt.reviewStatus = 'PASS' }],
  ['foreign readback file', x => { x.receipt.docxChecksum = `sha256:${'0'.repeat(64)}` }],
  ['readback result mismatch', x => { x.receipt.resultFingerprint = '0'.repeat(64) }],
  ['approval promoted', x => { x.receipt.approvalAvailable = true }],
])('default-reader predicates refuse %s', async (_name, mutate) => {
  const x = await reviewProjection(); mutate(x)
  expect(() => assertFailedCorrectionCompletion(x.args, x.projection, x.receipt)).toThrow()
})

test('post-compile failed-predecessor drift refuses before writing', async () => {
  const f = await store()
  f.predecessorReader.mockImplementationOnce(async () => copy(f.correctionReference))
    .mockImplementationOnce(async () => ({ ...copy(f.correctionReference), predecessorBodyFingerprint: '0'.repeat(64) }))
  await expect(createCorrectedMasterLinkedPrivateDocxCandidate(f.args)).rejects.toMatchObject({ code: 'PRIVATE_DOCX_CANDIDATE_BLOCKED' })
  expect(f.rows).toHaveLength(1); expect(f.writer.log).not.toHaveBeenCalled()
})
test('post-durable predecessor refusal never returns success or removes the held candidate', async () => {
  const f = await store(), old = copy(f.record)
  f.predecessorReader.mockImplementation(async () => {
    if (f.writer.log.mock.calls.length) throw Error('AFTER_DURABLE_PREDECESSOR_CHANGED')
    return copy(f.correctionReference)
  })
  await expect(createCorrectedMasterLinkedPrivateDocxCandidate(f.args)).rejects.toThrow('AFTER_DURABLE_PREDECESSOR_CHANGED')
  expect(f.rows).toHaveLength(2); expect(f.audits).toHaveLength(2)
  expect(copy(f.rows[0])).toEqual(old)
  expect(f.rows[1].body).toMatchObject({ status: 'PRIVATE_UNREVIEWED', authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false })
})
test('atomic replay winner uses preverified correction/master observations with no upstream reads', async () => {
  const f = await store(), saved = await createCorrectedMasterLinkedPrivateDocxCandidate(f.args)
  const original = f.args.deps.Candidate.findOne; let hidden = false
  f.args.deps.Candidate.findOne = filter => {
    if (!hidden && filter.requestKey === f.args.payload.requestKey) {
      hidden = true; return { select() { return this }, lean: async () => null }
    }
    return original(filter)
  }
  const transaction = jest.spyOn(f.transaction, 'withTransaction'); f.writer.log.mockClear()
  const replay = await createCorrectedMasterLinkedPrivateDocxCandidate(f.args)
  expect(transaction).toHaveBeenCalledTimes(1); expect(replay.idempotent).toBe(true)
  expect(replay.candidate.candidateId).toBe(saved.candidate.candidateId)
  expect(f.writer.log).not.toHaveBeenCalled(); expect(f.rows).toHaveLength(2)
})
test('a resealed corrected candidate cannot downgrade renderer to skip callout verification', async () => {
  const f = await store(), saved = await createCorrectedMasterLinkedPrivateDocxCandidate(f.args)
  const row = f.rows.find(r => r.candidateId === saved.candidate.candidateId), body = row.body, binding = body.masterBinding
  body.input.renderer.version = '0.1.2'
  body.input.presentation.qualificationCallouts.blocks[0].blockIndex += 1
  body.inputFingerprint = membershipHash(body.input)
  body.requestFingerprint = row.requestFingerprint = correctedMasterLinkedRequestFingerprint(binding.masterReference, body.input.renderer, binding.correctionReference)
  binding.wrapperFingerprint = membershipHash({ contractVersion: 'meaning-master-private-docx-input.v2',
    masterReference: binding.masterReference, expressionOrigin: binding.expressionOrigin, renditionInput: body.input,
    renditionInputFingerprint: body.inputFingerprint, outputChecksum: body.artifact.outputChecksum, correctionReference: binding.correctionReference })
  row.bodyFingerprint = membershipHash(body)
  expect(() => assertPrivateDocxCandidateRecord(row)).toThrow(expect.objectContaining({ code: 'PRIVATE_DOCX_CANDIDATE_BLOCKED' }))
})

