import { jest } from '@jest/globals'
import { renditionReviewClaimFixture } from './fixtures/renditionReviewClaimFixture.js'
import { prepareRenditionReviewAdmission } from '../services/outcomeRenditionReviewAdmissionService.js'
import { assertRenditionReviewSubject } from '../services/outcomeRenditionReviewClaimContract.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'

describe('private rendition review admission; explicit source/runtime/plan owner seams', () => {
  test.each(['contractVersion', 'masterBinding', 'masterBindingFingerprint'])('refuses master-linked %s before constructing a legacy subject', async key => {
    const f = renditionReviewClaimFixture()
    f.verified.candidate[key] = key === 'contractVersion' ? 'private-docx-candidate.v2' : 'present'
    await expect(f.admission()).rejects.toMatchObject({ details: { reason: 'MASTER_LINKED_REVIEW_BINDING_REQUIRED' } })
  })
  test('binds exact source, method receipt and ordered saved pages without content leakage', async () => {
    const f = renditionReviewClaimFixture(), first = await f.admission(), second = await f.admission()
    expect(membershipHash(first)).toBe(membershipHash(second))
    expect(first.subject.method.contentHash).toBe(f.methodPack.contentHash)
    expect(first.subject.preview.pages[0].sha256).toBe(f.rendered.pages[0].sha256)
    expect(JSON.stringify(first)).not.toContain(f.methodContent)
    expect(first.subject).not.toHaveProperty('syntheticClassification')
    expect(first).not.toHaveProperty('dispatchAvailable', true)
  })
  test('requires awaited VMF_UPDATE permission, not just a view admission', async () => {
    const f = renditionReviewClaimFixture(), denied = Object.assign(new Error('Denied'), { status: 403 })
    f.deps.assertPermission = jest.fn(async () => { throw denied })
    await expect(f.admission()).rejects.toBe(denied)
    expect(f.deps.assertPermission).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: f.actorUserId, permission: 'VMF_UPDATE', ...f.scope }))
  })
  test.each([
    ['source fingerprint', f => { f.source.sourceFingerprint = 'f'.repeat(64) }],
    ['wrong runtime customer', f => { f.runtime.customerId = '507f1f77bcf86cd799439099' }],
    ['runtime unlocked', f => { f.runtime.status = 'DRAFT' }],
    ['wrong candidate', f => { f.verified.candidate.candidateId = 'wrong' }],
    ['candidate final flag', f => { f.verified.candidate.finalisationAvailable = true }],
    ['file changed', f => { f.verified.buffer = Buffer.from('changed') }],
    ['preview input', f => { f.preview.inputFingerprint = 'f'.repeat(64) }],
    ['preview scope', f => { f.preview.scope = { ...f.scope, tenantId: '507f1f77bcf86cd799439099' } }],
    ['page changed', f => { f.rendered.pages[0].buffer = Buffer.from('changed') }],
    ['plan fingerprint', f => { f.plan.planFingerprint = 'f'.repeat(64) }],
    ['method assignment', f => { f.plan.payload.stagePlan[0].assignedActivationIds = [] }],
    ['method version', f => { f.deps.loadPackContent = async () => ({ ...f.methodPack, available: true, content: 'tampered' }) }],
    ['profile receipt', f => { f.verified.candidate.selectedPacks = { ...f.verified.candidate.selectedPacks, STYLE: { ...f.verified.candidate.selectedPacks.STYLE, versionId: 'changed' } } }],
    ['expectation', f => { f.args.expected.previewId = 'wrong' }],
  ])('rejects %s', async (_label, mutate) => {
    const f = renditionReviewClaimFixture(); mutate(f)
    await expect(f.admission()).rejects.toThrow()
  })
  test('does not replace failed source owner promises with an empty admission', async () => {
    const f = renditionReviewClaimFixture(); f.deps.readSource = async () => { throw new Error('Source failure') }
    await expect(prepareRenditionReviewAdmission(f.args)).rejects.toThrow('Source failure')
  })
  test.each(['authoritative', 'officialUse', 'normalOutputAvailable', 'authorisesApproval', 'finalisationAvailable', 'deliveryAvailable'])('rejects stronger subject %s', async key => {
    const f = renditionReviewClaimFixture(), { subject } = await f.admission(); subject[key] = true
    expect(() => assertRenditionReviewSubject(subject)).toThrow()
  })
  test('rejects extra method content and duplicate page ordering', async () => {
    const f = renditionReviewClaimFixture(), { subject } = await f.admission()
    subject.method.chunks = [{ text: f.methodContent }]
    expect(() => assertRenditionReviewSubject(subject)).toThrow()
    delete subject.method.chunks; subject.preview.pages[0].number = 2
    expect(() => assertRenditionReviewSubject(subject)).toThrow()
  })
})
