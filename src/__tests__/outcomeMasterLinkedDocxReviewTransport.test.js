import { jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { masterLinkedDocxFixture } from './fixtures/masterLinkedDocxFixture.js'
import { renditionReviewClaimFixture } from './fixtures/renditionReviewClaimFixture.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'
import { prepareMasterLinkedDocxReviewTransport, assertMasterLinkedDocxReviewTransport } from '../services/outcomeMasterLinkedDocxReviewTransportService.js'
import { deriveMasterReviewSourceUse } from '../services/outcomeMasterLinkedReviewSourceUseService.js'
import { buildOpenAiMasterLinkedDocxReviewRequest } from '../services/openAiMasterLinkedDocxReviewRequest.js'
import { buildOpenAiDocxRenditionReviewRequest } from '../services/openAiDocxRenditionReviewProviderAdapter.js'
import { assertRenditionReviewSubject } from '../services/outcomeRenditionReviewClaimContract.js'
import { buildOpenAiMasterLinkedCategoryDocxReviewRequest } from '../services/openAiMasterLinkedDocxReviewRequest.js'
import { buildMasterLinkedCategoryReviewResponseSchema, normalizeMasterLinkedCategoryReviewResponse,
  MASTER_LINKED_CATEGORY_RESPONSE_VERSION } from '../services/masterLinkedCategoryReviewResponseContract.js'
import { RENDERED_EXPRESSION_RL_DIMENSIONS } from '../utils/outcomeRenderedExpressionRlOutput.js'
import { snapshotOwnedMasterLinkedReviewResult } from '../services/openAiMasterLinkedDocxReviewProviderAdapter.js'
import { assertG1FixedSubject, assertG1CorrectedSubject } from '../services/masterLinkedGenuineReviewContract.js'

const copy = value => JSON.parse(JSON.stringify(value))
const fixture = async () => {
  const f = await masterLinkedDocxFixture(), m = renditionReviewClaimFixture(), body = f.record.body
  const candidate = { ...copy(body), bodyFingerprint: f.record.bodyFingerprint, renderer: body.input.renderer,
    masterBindingFingerprint: membershipHash(body.masterBinding) }
  const observed = { candidate, buffer: Buffer.from(f.record.fileBytes), candidateInput: copy(body.input), scope: f.scope }
  const ref = f.envelope.source.plan
  const plan = { ...copy(m.plan), ...f.scope, _id: ref.recordId,
    ...Object.fromEntries(['planId', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].map(key => [key, ref[key]])) }
  const args = { actorUserId: f.actorUserId, runtimeInstanceId: f.scope.runtimeInstanceId, candidateId: body.candidateId,
    scopes: { selectedCustomerId: f.scope.customerId }, deps: {
      readCandidate: jest.fn(async () => observed), readMaster: async () => copy(f.masterReceipt),
      readPreview: async () => ({ preview: copy(f.preview.body), pages: f.preview.pageBytes.map(page => Buffer.from(page)) }),
      loadPlan: async () => plan, assertPlanIntegrity: () => {}, loadPackContent: async query => query.packId === m.methodPack.packId
        ? { ...m.methodPack, available: true, content: m.methodContent } : f.loadPackContent(query),
    } }
  return { f, m, observed, plan, args, prepare: () => prepareMasterLinkedDocxReviewTransport(args) }
}

test('prepares exact saved images and full requirements without dispatch, records or server identities in the request', async () => {
  const f = await fixture(), transport = await f.prepare(), result = buildOpenAiMasterLinkedDocxReviewRequest(transport)
  const request = JSON.parse(result.serialized), context = JSON.parse(request.input[0].content[0].text)
  expect(f.args.deps.readCandidate).toHaveBeenCalledTimes(3)
  expect(result.dispatchAvailable).toBe(false)
  expect(transport.subject.policy.capability).toBe('BUILD_PROVIDER_SAFE_REQUEST')
  expect(transport.subject.policy.externalDisclosureAvailable).toBe(false)
  expect(context.reviewedMeaning.status).toBe('MEANING_REVIEWED_ONLY')
  expect(context.retainedExpression.status).toBe('UNREVIEWED_RETAINED_SHAPING')
  expect(context.reviewedMeaning.candidate.sections[0].claims).toEqual(f.f.envelope.source.content.workingDraft.sections[0].claims.map(claim =>
    Object.fromEntries(Object.entries(claim).filter(([key]) => key !== 'contributingActivationIds'))))
  expect(context.selectedDocuments).toHaveLength(5)
  expect(context.methodDocument.chunks.map(chunk => chunk.text).join('')).toContain('seven governed expression dimensions')
  expect(Buffer.from(request.input[0].content[2].image_url.split(',')[1], 'base64')).toEqual(transport.pages[0])
  for (const id of [f.args.actorUserId, f.args.runtimeInstanceId, f.args.candidateId, transport.subject.binding.masterReference.masterId,
    transport.subject.binding.previewId]) expect(result.serialized).not.toContain(id)
  for (const key of ['sourceEnvelope', 'candidateInput', 'masterReference', 'apiKey']) expect(result.serialized).not.toContain(`"${key}"`)
  expect(buildOpenAiMasterLinkedDocxReviewRequest(transport)).toEqual(result)
  expect(request).toMatchObject({ model: 'gpt-5.2', background: true, store: false, truncation: 'disabled', max_output_tokens: 4000 })
  expect(request.instructions).toContain('never approved meaning')
  expect(() => buildOpenAiDocxRenditionReviewRequest(transport)).toThrow()
  expect(() => assertRenditionReviewSubject(transport.subject)).toThrow()
})

test('opt-in category request has new bytes while legacy serialization and all source/image bindings stay unchanged', async () => {
  const transport = await (await fixture()).prepare(), legacy = buildOpenAiMasterLinkedDocxReviewRequest(transport)
  const next = buildOpenAiMasterLinkedCategoryDocxReviewRequest(transport), oldBody = JSON.parse(legacy.serialized), body = JSON.parse(next.serialized)
  expect(buildOpenAiMasterLinkedDocxReviewRequest(transport)).toEqual(legacy)
  expect(buildOpenAiMasterLinkedCategoryDocxReviewRequest(transport)).toEqual(next)
  expect(next.requestVersion).toBe('master-linked-docx-visual-review-request.v3')
  expect(next.responseVersion).toBe(MASTER_LINKED_CATEGORY_RESPONSE_VERSION)
  expect(next.binding.requestIdentity).not.toBe(legacy.binding.requestIdentity)
  expect(next.binding.requestIdentity).toBe(createHash('sha256').update(next.serialized).digest('hex'))
  expect({ ...next.binding, requestIdentity: legacy.binding.requestIdentity }).toEqual(legacy.binding)
  expect(next.pageReceipts).toEqual(legacy.pageReceipts); expect(next.docxChecksum).toBe(legacy.docxChecksum)
  expect(next.dispatchAvailable).toBe(false)
  expect(body.input).toEqual(oldBody.input)
  expect({ ...body, text: oldBody.text, instructions: oldBody.instructions }).toEqual(oldBody)
  expect(body.text.format).toEqual({ type: 'json_schema', name: 'master_linked_docx_visual_rl_v3', strict: true,
    schema: buildMasterLinkedCategoryReviewResponseSchema() })
  expect(body.instructions).toContain('exactly one required assessment')
  expect(Object.keys(body)).toEqual(Object.keys(oldBody))
  expect(() => assertG1FixedSubject(transport.subject, next.binding)).toThrow()
  const corrected = JSON.parse(readFileSync(new URL('./fixtures/correctedReviewSubject.json', import.meta.url)))
  expect(() => assertG1CorrectedSubject(corrected.subject, corrected.request)).not.toThrow()
  expect(() => assertG1CorrectedSubject(corrected.subject, { ...corrected.request,
    requestIdentity: next.binding.requestIdentity })).toThrow()
})

test.each(['PASS', 'FAIL', 'missing', 'duplicate'])('fake-only actual builder/decoder exchange: %s', async kind => {
  const transport = await (await fixture()).prepare(), request = buildOpenAiMasterLinkedCategoryDocxReviewRequest(transport)
  const wire = { outputType: 'RENDERED_EXPRESSION_RL', schemaVersion: MASTER_LINKED_CATEGORY_RESPONSE_VERSION,
    overallStatus: kind === 'FAIL' ? 'FAIL' : 'PASS', findings: Object.fromEntries(RENDERED_EXPRESSION_RL_DIMENSIONS.map(d =>
      [d, { status: d === 'STATEMENTS' && kind === 'FAIL' ? 'FAIL' : 'PASS', finding: 'Synthetic fake-network assessment.',
        requiredChange: d === 'STATEMENTS' && kind === 'FAIL' }])) }
  if (kind === 'missing') delete wire.findings.BRAND_EXPRESSION
  let text = JSON.stringify(wire)
  if (kind === 'duplicate') text = text.replace('"findings":{', '"findings":{"STATEMENTS":{},')
  const fakeFetch = jest.fn(async (_url, options) => {
    expect(options.body).toBe(request.serialized)
    expect(JSON.parse(options.body).text.format.schema).toEqual(buildMasterLinkedCategoryReviewResponseSchema())
    return new Response(text, { status: 200 })
  })
  const response = await fakeFetch('https://fake.invalid/no-dispatch', { method: 'POST', body: request.serialized })
  const returned = await response.text()
  if (['missing', 'duplicate'].includes(kind)) expect(() => normalizeMasterLinkedCategoryReviewResponse(returned)).toThrow()
  else {
    const canonical = normalizeMasterLinkedCategoryReviewResponse(returned)
    expect(canonical.overallStatus).toBe(kind)
    expect(() => snapshotOwnedMasterLinkedReviewResult(canonical)).toThrow()
  }
  expect(fakeFetch).toHaveBeenCalledTimes(1)
})

test.each([
  ['policy promotion', t => { t.subject.policy.authorisesApproval = true }],
  ['operation', t => { t.subject.policy.operation = 'DISPATCH' }],
  ['subject version', t => { t.subject.contractVersion = 'outcome-docx-review-subject.v1' }],
  ['transport configuration', t => { t.subject.transport.model = 'other' }],
  ['source', t => { t.sourceEnvelope.source.content.workingDraft.title += ' changed' }],
  ['input', t => { t.candidateInput.markdown += ' changed' }],
  ['master use', t => { t.master.permittedUse = 'CUSTOMER_APPROVED' }],
  ['master role', t => { t.master.purpose = 'APPROVED_OUTPUT' }],
  ['master status', t => { t.master.status = 'APPROVED' }],
  ['master identity', t => { t.master.masterId += 'x' }],
  ['document', t => { t.document.markdown += ' changed' }],
  ['meaning', t => { t.context.reviewedMeaning.candidate.sections[0].content += ' changed' }],
  ['expression status', t => { t.context.retainedExpression.status = 'APPROVED' }],
  ['method', t => { t.context.methodDocument.chunks[0].text += ' changed' }],
  ['profile', t => { t.context.selectedDocuments[0].content += ' changed' }],
  ['profile population', t => { t.context.selectedDocuments.pop() }],
  ['context extras', t => { t.context.sourceEnvelope = {} }],
  ['pages', t => { t.pages[0][100] ^= 1 }],
  ['page population', t => { t.pages.pop() }],
  ['context fingerprint', t => { t.contextFingerprint = 'f'.repeat(64) }],
])('rejects tampered %s', async (_name, mutate) => {
  const t = await (await fixture()).prepare(); mutate(t)
  expect(() => assertMasterLinkedDocxReviewTransport(t)).toThrow()
  expect(() => buildOpenAiMasterLinkedDocxReviewRequest(t)).toThrow()
})

test.each(['candidateId', 'candidateBodyFingerprint', 'masterBindingFingerprint', 'master body', 'previewId', 'extra field'])('binding witness rejects resealed %s', async key => {
  const t = await (await fixture()).prepare()
  if (key === 'master body') t.subject.binding.masterReference.bodyFingerprint = 'f'.repeat(64)
  else if (key === 'extra field') t.subject.binding.extra = false
  else t.subject.binding[key] = key.endsWith('Id') ? 'arbitrary' : 'f'.repeat(64)
  t.subject.policy = deriveMasterReviewSourceUse({ actorUserId: t.subject.actorUserId,
    runtimeInstanceId: t.subject.binding.masterReference.scope.runtimeInstanceId, master: t.master, sourceEnvelope: t.sourceEnvelope, binding: t.subject.binding })
  t.subject.policyFingerprint = membershipHash(t.subject.policy)
  t.context.lineage.subjectFingerprint = membershipHash(t.subject); t.context.lineage.bindingFingerprint = membershipHash(t.subject.binding)
  t.context.lineage.policyFingerprint = t.subject.policyFingerprint; t.contextFingerprint = membershipHash(t.context)
  expect(() => buildOpenAiMasterLinkedDocxReviewRequest(t)).toThrow()
})

test('rejects extra page receipt fields and more than twenty pages even with witnesses resealed', async () => {
  for (const extra of [false, true]) {
    const t = await (await fixture()).prepare()
    if (extra) t.subject.binding.pages[0].extra = false
    else for (let i = 1; i < 21; i++) { t.pages.push(Buffer.from(t.pages[0])); t.subject.binding.pages.push({ ...t.subject.binding.pages[0], number: i + 1 }) }
    t.witnesses.preview = copy(t.subject.binding)
    t.subject.policy.bindingFingerprint = membershipHash(t.subject.binding); t.subject.policyFingerprint = membershipHash(t.subject.policy)
    t.context.lineage.subjectFingerprint = membershipHash(t.subject); t.context.lineage.bindingFingerprint = membershipHash(t.subject.binding)
    t.context.lineage.policyFingerprint = t.subject.policyFingerprint; t.context.lineage.pages = copy(t.subject.binding.pages)
    t.contextFingerprint = membershipHash(t.context)
    expect(() => buildOpenAiMasterLinkedDocxReviewRequest(t)).toThrow()
  }
})

test.each(['Contact someone@example.com.', 'Use secret: sk-abcdefghijklmnopqrstuvwxyz1234567890.'])('rejects unsafe method content without truncation', async unsafe => {
  const f = await fixture(), loader = f.args.deps.loadPackContent, text = f.m.methodContent + '\n' + unsafe
  f.plan.payload.resolution.selectedPacks[0].contentHash = `sha256:${createHash('sha256').update(text).digest('hex')}`
  f.args.deps.loadPackContent = async query => query.packId === f.m.methodPack.packId
    ? { ...f.plan.payload.resolution.selectedPacks[0], available: true, content: text } : loader(query)
  await expect(f.prepare()).rejects.toThrow()
})

test.each(['body', 'input', 'bytes'])('final fresh read refuses stale %s', async kind => {
  const f = await fixture(); let reads = 0
  f.args.deps.readCandidate = async () => {
    if (++reads === 3) {
      if (kind === 'body') f.observed.candidate.bodyFingerprint = 'f'.repeat(64)
      if (kind === 'input') f.observed.candidateInput.markdown += ' changed'
      if (kind === 'bytes') f.observed.buffer[100] ^= 1
    }
    return f.observed
  }
  await expect(f.prepare()).rejects.toMatchObject({ details: { reason: 'PREPARATION_STALE' } })
})

test('snapshots requirement content and pages before the final awaited read', async () => {
  const f = await fixture(); let reads = 0
  f.args.deps.readCandidate = async () => {
    if (++reads === 3) { f.plan.payload.resolution.selectedPacks[0].packId = 'mutated'; f.f.preview.pageBytes[0][100] ^= 1 }
    return f.observed
  }
  const t = await f.prepare()
  expect(() => buildOpenAiMasterLinkedDocxReviewRequest(t)).not.toThrow()
})

test.each(['assignment', 'plan', 'profile', 'deadline'])('refuses changed %s during preparation', async kind => {
  const f = await fixture(), now = Date.now(); const spy = kind === 'deadline' ? jest.spyOn(Date, 'now') : null
  if (kind === 'assignment') f.plan.payload.stagePlan[0].assignedActivationIds.push('other')
  if (kind === 'plan') f.plan.requestId = 'other'
  if (kind === 'profile') f.args.deps.loadPackContent = async () => ({ available: false })
  if (spy) spy.mockReturnValueOnce(now).mockReturnValue(now + 600001)
  try { await expect(f.prepare()).rejects.toThrow() } finally { spy?.mockRestore() }
})

test('policy does not grant dispatch operation or accept actor/scope changes', async () => {
  const t = await (await fixture()).prepare(), args = { actorUserId: t.subject.actorUserId,
    runtimeInstanceId: t.subject.binding.masterReference.scope.runtimeInstanceId, master: t.master,
    sourceEnvelope: t.sourceEnvelope, binding: t.subject.binding }
  expect(() => deriveMasterReviewSourceUse({ ...args, operation: 'DISPATCH' })).toThrow()
  expect(() => deriveMasterReviewSourceUse({ ...args, runtimeInstanceId: 'f'.repeat(24) })).toThrow()
  expect(() => deriveMasterReviewSourceUse({ ...args, actorUserId: '' })).toThrow()
})
