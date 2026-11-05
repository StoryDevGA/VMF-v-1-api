import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { buildGovernedPrivateDocxInput, compileGovernedPrivateDocxInput } from '../services/outcomeGovernedDocxCandidateService.js'
import { APPROVED_EXPRESSION_VERSION, NARROW_EXPRESSION_VERSION, approvedExpressionProfile,
  assertApprovedCommercialExpression, assertApprovedCompatibilityReference, APPROVED_SECTION13_STATE,
  buildApprovedQualificationMapping } from '../services/commercialDocxApprovedExpression.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { jest } from '@jest/globals'
import Audit from '../models/AuditLog.js'
import User from '../models/User.js'

const receiptSeams = { witness: jest.fn(), packs: jest.fn(), deepRead: jest.fn(), native: jest.fn(), permissions: jest.fn(),
  runtime: jest.fn(), authorize: jest.fn() }
jest.unstable_mockModule('../services/masterLinkedReviewOperatorAuthority.js', () => ({
  authenticateMasterReviewNativeOperator: jest.fn(), readMasterReviewNativeOperator: receiptSeams.native,
  MASTER_REVIEW_DATABASE: 'ss044_1619d7db635949898c9abb4592d10bcf',
}))
jest.unstable_mockModule('../services/performanceCacheService.js', () => ({ buildUserPermissionsSnapshot: receiptSeams.permissions }))
jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({
  getRuntimeInstance: receiptSeams.runtime, assertRuntimePermission: receiptSeams.authorize,
}))
jest.unstable_mockModule('../services/masterLinkedCompletedReviewService.js', () => ({
  createApprovedGenuineMasterLinkedCompletedReviewStore: () => ({ readNarrowHistoricalFailureWitness: receiptSeams.witness }),
  createGenuineMasterLinkedCompletedReviewStore: () => ({ read: receiptSeams.deepRead }),
}))
jest.unstable_mockModule('../services/outcomeDocxCandidatePersistenceService.js', () => ({
  readPrivateDocxCandidate: receiptSeams.deepRead, assertCurrentPrivateDocxCandidatePacks: receiptSeams.packs,
}))
const { prepareNarrowCommercialCompatibilityWitness } = await import('../services/commercialDocxCompatibilityService.js')

const retained = JSON.parse(readFileSync(new URL('./fixtures/approvedCommercialSource.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value))
const fixture = version => {
  const envelope = copy(retained.sourceEnvelope), source = envelope.source, profile = approvedExpressionProfile(version), fixed = profile.fixed
  const documents = source.content.shaping.outputContract.packs.map(pack => ({ source: { ...pack, contentFormat: 'MARKDOWN' },
    content: retained.selectedDocuments.find(d => d.receipt.packId === pack.packId).content }))
  const audienceDocument = { ...source.selectedPacks.AUDIENCE, available: true, status: 'ACTIVE', contentFormat: 'MARKDOWN',
    content: retained.selectedDocuments.find(d => d.layer === 'AUDIENCE').content }
  return { envelope, documents, audienceDocument, approvedCompatibilityReference: {
    version, auditId: 'a'.repeat(24), decisionFingerprint: 'b'.repeat(64),
    mappingFingerprint: membershipHash(buildApprovedQualificationMapping(envelope)), masterId: fixed.masterId,
    sourceFingerprint: fixed.sourceFingerprint, predecessorCandidateId: fixed.predecessorCandidateId,
    failedReviewExecutionId: fixed.failedReviewExecutionId, failedReviewResultFingerprint: fixed.failedReviewResultFingerprint,
    section13State: APPROVED_SECTION13_STATE,
  } }
}

test('the new expression scopes local notes while preserving quotations, mappings, roles and Section 13', () => {
  const old = buildGovernedPrivateDocxInput(fixture(APPROVED_EXPRESSION_VERSION))
  const current = buildGovernedPrivateDocxInput(fixture(NARROW_EXPRESSION_VERSION))
  expect(current.contractVersion).toBe('governed-private-docx-input.v4')
  expect(current.renderer).toMatchObject({ version: '0.1.5', layoutProfile: 'SOURCE_SCOPED_QUOTATIONS_V2' })
  expect(current.documentMetadata.versionNumber).toBe(4)
  expect(current.sourceEnvelope).toEqual(old.sourceEnvelope)
  expect(current.model.sections.map(s => [s.key, s.roleLabel, s.heading, s.subtitle, s.bodyMarkdown, s.truthReferences]))
    .toEqual(old.model.sections.map(s => [s.key, s.roleLabel, s.heading, s.subtitle, s.bodyMarkdown, s.truthReferences]))
  expect(current.model.sections).toHaveLength(14)
  expect(current.markdown.match(/^> .+$/gm)).toEqual(old.markdown.match(/^> .+$/gm))
  expect(current.markdown.match(/^> .+$/gm)).toHaveLength(23)
  const mapping = current.presentation.approvedQualificationMapping.mappings
  expect(mapping).toEqual(old.presentation.approvedQualificationMapping.mappings)
  expect(mapping).toHaveLength(11)
  expect(mapping.every(m => current.model.sections[13].qualificationMarkdown.includes(m.customerExpression))).toBe(true)
  expect(current.model.sections[12].bodyMarkdown).toBe(old.model.sections[12].bodyMarkdown)
  expect(current.model.sections[0].qualificationMarkdown).toBe('This section records separately supplied user intake, not independent document evidence. Its inclusion does not establish historical author identity, authenticity, independence or real customer provenance.')
  expect(current.markdown).not.toContain('Document provenance limits do not apply')
  const locator = mapping.find(m => m.original.startsWith('Legacy text-source location')).customerExpression
  for (const section of current.model.sections.slice(1, 13)) {
    const usesText = section.bodyMarkdown.includes('**Source: ss044-synthetic-pilot-r1.txt**')
    expect(section.qualificationMarkdown).toContain('Full source-specific quotation qualifications: section 14.')
    expect(section.qualificationMarkdown).not.toContain('**Source qualifications —')
    expect(section.qualificationMarkdown).not.toContain('not to user-provided intake')
    expect(section.qualificationMarkdown.includes(locator)).toBe(usesText)
    expect(section.qualificationMarkdown.includes('**Additional restriction — quotations from ss044-synthetic-pilot-r1.txt only**')).toBe(usesText)
  }
  expect(current.model.sections[13].qualificationMarkdown.replace(
    'The following entries qualify quotations from the named sources. User-provided intake is recorded separately and retains its own provenance limits.',
    'These limits apply only to quotations from the named source, not to user-provided intake.'))
    .toBe(old.model.sections[13].qualificationMarkdown)
  expect(assertApprovedCommercialExpression(current)).toEqual(fixture(NARROW_EXPRESSION_VERSION).approvedCompatibilityReference)
})

test('closed versions reject crossed references and any changed source applicability', () => {
  const old = fixture(APPROVED_EXPRESSION_VERSION), current = fixture(NARROW_EXPRESSION_VERSION)
  expect(() => assertApprovedCompatibilityReference({ ...current.approvedCompatibilityReference, version: APPROVED_EXPRESSION_VERSION })).toThrow()
  expect(() => assertApprovedCompatibilityReference({ ...old.approvedCompatibilityReference, version: NARROW_EXPRESSION_VERSION })).toThrow()
  expect(() => approvedExpressionProfile('commercial-docx-approved-expression.v3')).toThrow()
  const input = buildGovernedPrivateDocxInput(current)
  const crossed = copy(input); crossed.contractVersion = 'governed-private-docx-input.v3'
  expect(() => assertApprovedCommercialExpression(crossed)).toThrow()
  const changed = copy(input); changed.model.sections[2].qualificationMarkdown += '\nCapture quotations inherit the legacy text location limit.'
  expect(() => assertApprovedCommercialExpression(changed)).toThrow()
})

test('the previous approved expression still reproduces the exact C396 Word bytes', async () => {
  const old = await compileGovernedPrivateDocxInput(fixture(APPROVED_EXPRESSION_VERSION))
  expect(old.buffer.length).toBe(13712)
  expect(createHash('sha256').update(old.buffer).digest('hex')).toBe('3d97a836805e6602d32ae238084a12e883fb14ff8f7de53385d555fd9cdc366a')
  expect(old.input.contractVersion).toBe('governed-private-docx-input.v3')
  expect(old.input.renderer.version).toBe('0.1.4')
})

// These dependency seams do not prove source or database admission. They check
// the bounded reader's joins and refusal behavior; live proof stays separate.
const withReceiptFixture = async verify => {
  const oldProfile = approvedExpressionProfile(APPROVED_EXPRESSION_VERSION), profile = approvedExpressionProfile(NARROW_EXPRESSION_VERSION)
  const f = fixture(APPROVED_EXPRESSION_VERSION), fixed = profile.fixed, sourceEnvelope = f.envelope
  const native = { realm: 'native-application-test.v1', operatorUserId: '698b3800f83b3257365fd7a3', fingerprint: 'e'.repeat(64) }
  const body = { version: oldProfile.version, operation: 'CREATE_PRIVATE_CORRECTION_ONLY', scope: retained.masterReference.scope,
    appActorUserId: fixed.actorUserId, masterReference: retained.masterReference, sourceFingerprint: fixed.sourceFingerprint,
    selectedPacks: sourceEnvelope.source.selectedPacks,
    predecessor: { candidateId: oldProfile.fixed.predecessorCandidateId, bodyFingerprint: oldProfile.fixed.predecessorBodyFingerprint,
      inputFingerprint: 'c'.repeat(64), outputChecksum: 'sha256:' + 'd'.repeat(64),
      failedReviewExecutionId: oldProfile.fixed.failedReviewExecutionId, failedReviewResultFingerprint: oldProfile.fixed.failedReviewResultFingerprint },
    qualificationMapping: buildApprovedQualificationMapping(sourceEnvelope), literalSourcePreserved: true,
    customerCatalogueVerbatim: false, section13State: APPROVED_SECTION13_STATE,
    admission: 'CONTROLLED_PRIVATE_RENDER_ONLY', schemaContentComplete: false,
    unresolvedFacts: ['NEXT_PERMITTED_OPERATIONAL_STEP', 'EXECUTION_APPROVER'], sourceMeaningApprovalChanged: false,
    customerApproved: false, officialUse: false, reviewAvailable: false, dispatchAvailable: false, finalisationAvailable: false, deliveryAvailable: false }
  const audit = new Audit({ _id: membershipHash({ version: oldProfile.version, body }).slice(0, 24), actorUserId: native.operatorUserId, action: 'OUTCOME_DOCX_EXPRESSION_COMPATIBILITY_RECORDED',
    resourceType: 'RuntimeInstance', resourceId: fixed.runtimeInstanceId, scope: retained.masterReference.scope, signatureVersion: 3,
    diff: { version: oldProfile.version, body, approvalReference: 'Unit-only historical instruction', recorderAuthority: native,
      recordedAt: '2026-11-04T12:00:00.000Z' } })
  audit.generateSignature()
  const oldAudit = audit.toObject(), oldReference = { ...f.approvedCompatibilityReference, auditId: String(oldAudit._id), decisionFingerprint: membershipHash(oldAudit.diff) }
  const predecessorInput = buildGovernedPrivateDocxInput({ ...f, approvedCompatibilityReference: oldReference })
  const witness = { state: 'HISTORICAL_GENUINE_FAIL_WITNESS', master: { masterReference: retained.masterReference, sourceEnvelope }, sourceEnvelope,
    predecessor: { candidateId: fixed.predecessorCandidateId, bodyFingerprint: fixed.predecessorBodyFingerprint,
      inputFingerprint: membershipHash(predecessorInput), artifact: { outputChecksum: 'sha256:3d97a836805e6602d32ae238084a12e883fb14ff8f7de53385d555fd9cdc366a' },
      masterBinding: { contractVersion: 'master-linked-private-docx-binding.v3', masterReference: retained.masterReference, compatibilityReference: oldReference } },
    predecessorInput, executionId: fixed.failedReviewExecutionId, resultFingerprint: fixed.failedReviewResultFingerprint,
    reviewStatus: 'FAIL', sourceProof: 'STORED_SOURCE_RECORDS', dispatchAvailable: false, customerApproved: false, officialUse: false, approvalAvailable: false, finalisationAvailable: false, deliveryAvailable: false }
  const scopes = { customer: { _id: fixed.customerId }, tenant: { _id: fixed.tenantId, customerId: fixed.customerId } }
  for (const seam of Object.values(receiptSeams)) seam.mockReset()
  receiptSeams.witness.mockImplementation(async () => copy(witness)); receiptSeams.packs.mockResolvedValue(undefined)
  receiptSeams.deepRead.mockRejectedValue(Error('Historical DAG traversal forbidden in bounded read'))
  receiptSeams.native.mockResolvedValue(native); receiptSeams.permissions.mockResolvedValue(scopes)
  receiptSeams.runtime.mockResolvedValue({ _id: fixed.runtimeInstanceId, customerId: fixed.customerId, tenantId: fixed.tenantId,
    runtimeType: 'CUSTOMER_WORKSPACE' }); receiptSeams.authorize.mockResolvedValue(undefined)
  const priorName = Audit.db.name; Audit.db.name = 'ss044_1619d7db635949898c9abb4592d10bcf'
  const query = value => { const q = { maxTimeMS: () => q, lean: async () => value }; return q }
  const spies = [jest.spyOn(User, 'findById').mockImplementation(() => query({ isActive: true })),
    jest.spyOn(Audit, 'findById').mockImplementation(() => query(oldAudit))]
  try { await verify({ witness, oldAudit, native, scopes, fixed }) }
  finally { spies.forEach(spy => spy.mockRestore()); Audit.db.name = priorName }
}

test('bounded preparation preserves the signed predecessor edge without reopening the historical DAG', async () => {
  await withReceiptFixture(async ({ witness, native, fixed }) => {
    const prepared = await prepareNarrowCommercialCompatibilityWitness()
    expect(prepared.status).toBe('PREPARED_UNRECORDED')
    expect(prepared.body.predecessor).toMatchObject({ candidateId: fixed.predecessorCandidateId,
      bodyFingerprint: fixed.predecessorBodyFingerprint, failedReviewResultFingerprint: fixed.failedReviewResultFingerprint })
    expect(prepared.body.qualificationMapping).toHaveLength(11)
    expect(receiptSeams.packs).toHaveBeenCalledWith(witness.predecessorInput)
    expect(receiptSeams.native).toHaveBeenCalledWith(native.operatorUserId)
    expect(receiptSeams.authorize).toHaveBeenCalledTimes(2)
    expect(receiptSeams.authorize).toHaveBeenNthCalledWith(1, expect.objectContaining({ actorUserId: fixed.actorUserId, permission: 'VMF_UPDATE' }))
    expect(receiptSeams.authorize).toHaveBeenNthCalledWith(2, expect.objectContaining({ actorUserId: fixed.actorUserId, permission: 'VMF_UPDATE' }))
    expect(receiptSeams.authorize.mock.calls[0][0].scopes).not.toBe(receiptSeams.authorize.mock.calls[1][0].scopes)
    expect(receiptSeams.deepRead).not.toHaveBeenCalled()
    expect(prepared.reviewAvailable).toBe(false)
  })
})

test('bounded preparation refuses changed source, pack eligibility, old signature and stale recorder', async () => {
  await withReceiptFixture(async ({ witness }) => {
    witness.sourceEnvelope.sourceFingerprint = '0'.repeat(64)
    await expect(prepareNarrowCommercialCompatibilityWitness()).rejects.toThrow()
  })
  await withReceiptFixture(async () => {
    receiptSeams.packs.mockRejectedValue(Error('Current pack is no longer eligible'))
    await expect(prepareNarrowCommercialCompatibilityWitness()).rejects.toThrow('Current pack is no longer eligible')
  })
  await withReceiptFixture(async ({ oldAudit }) => {
    oldAudit.signature = 'tampered'
    await expect(prepareNarrowCommercialCompatibilityWitness()).rejects.toThrow()
  })
  await withReceiptFixture(async ({ native }) => {
    receiptSeams.native.mockResolvedValue({ ...native, fingerprint: 'f'.repeat(64) })
    await expect(prepareNarrowCommercialCompatibilityWitness()).rejects.toThrow()
  })
  await withReceiptFixture(async ({ fixed }) => {
    receiptSeams.runtime.mockResolvedValue({ _id: fixed.runtimeInstanceId, customerId: fixed.customerId, tenantId: fixed.tenantId,
      runtimeType: 'DEAL_ANALYSIS' })
    receiptSeams.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('Access removed during leaf read'))
    await expect(prepareNarrowCommercialCompatibilityWitness()).rejects.toThrow('Access removed during leaf read')
    expect(receiptSeams.authorize).toHaveBeenNthCalledWith(2, expect.objectContaining({ permission: 'DEAL_UPDATE' }))
  })
})
