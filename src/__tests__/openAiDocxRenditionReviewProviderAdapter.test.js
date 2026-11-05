import { jest } from '@jest/globals'
import { createHash } from 'node:crypto'
import { docxVisualReviewFixture, visualReviewOutput, resealVisualReviewFixture } from './fixtures/docxVisualReviewFixture.js'
import { createOpenAiDocxRenditionReviewProviderAdapter } from '../services/openAiDocxRenditionReviewProviderAdapter.js'
import { buildOutcomeRenderedExpressionRlOutputSchema } from '../services/openAiOutcomeRenderedExpressionRlProviderAdapter.js'
import { previewHash } from '../services/docxPagePreviewRuntime.js'

const completed = (failed = false) => ({ id: 'resp_visual_test', status: 'completed', usage: { input_tokens: 120, output_tokens: 70, total_tokens: 190 },
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(visualReviewOutput(failed)) }] }] })
const response = (body, status = 200) => ({ ok: status === 200, status, headers: { get: () => 'req_visual_test' }, text: async () => JSON.stringify(body) })
const setup = overrides => {
  const callbacks = { reserveDispatch: jest.fn(async binding => ({ ...binding, state: 'DURABLE_DISPATCH_RESERVED' })),
    recordResponseIdentity: jest.fn(async identity => ({ ...identity, state: 'DURABLE_RESPONSE_ID_RECORDED' })) }
  let clock = 0
  const config = { apiKey: 'fake-unit-key', fetchImpl: jest.fn(async () => response(completed())), now: () => clock,
    sleep: async ms => { clock += ms }, ...callbacks, ...overrides }
  return { ...config, adapter: createOpenAiDocxRenditionReviewProviderAdapter(config) }
}
describe('DOCX visual adapter; fake transport only, no dispatch owner or native provider proof', () => {
  test('sends exact two ordered PNGs, full text/method/profile and unchanged grading schema', async () => {
    const f = docxVisualReviewFixture(), t = await f.transport(), s = setup(), result = await s.adapter(t)
    expect(s.fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = s.fetchImpl.mock.calls[0], body = JSON.parse(options.body)
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(body).toMatchObject({ model: 'gpt-5.2', background: true, store: false, truncation: 'disabled', max_output_tokens: 4000 })
    expect(body.tools).toBeUndefined(); expect(body.text.format.schema).toEqual(buildOutcomeRenderedExpressionRlOutputSchema())
    const parts = body.input[0].content, context = JSON.parse(parts[0].text), images = parts.filter(part => part.type === 'input_image')
    expect(context).toEqual(t.context); expect(images).toHaveLength(2)
    images.forEach((image, index) => {
      expect(image.detail).toBe('high'); expect(image.image_url.startsWith('data:image/png;base64,')).toBe(true)
      expect(Buffer.from(image.image_url.split(',')[1], 'base64').equals(t.pages[index])).toBe(true)
    })
    expect(result.output.overallStatus).toBe('PASS'); expect(result.receipt.pages.map(page => page.sha256)).toEqual(t.pages.map(previewHash))
    expect(result.receipt).toMatchObject({ responseId: 'resp_visual_test', storeRequested: false, temporaryProviderStorageForPolling: true,
      tokenUsage: { inputTokens: 120, outputTokens: 70, totalTokens: 190 } })
    expect(s.reserveDispatch).toHaveBeenCalledWith(expect.objectContaining({ requestIdentity: options.headers['Idempotency-Key'], contextFingerprint: t.contextFingerprint }))
  })
  test('genuine-shaped FAIL remains FAIL; missing token usage remains unavailable', async () => {
    const body = completed(true); delete body.usage
    const s = setup({ fetchImpl: jest.fn(async () => response(body)) }), result = await s.adapter(await docxVisualReviewFixture().transport())
    expect(result.output.overallStatus).toBe('FAIL'); expect(result.receipt.tokenUsage.inputTokens).toBeNull()
  })
  test.each([undefined, false, {}, { state: 'DURABLE_DISPATCH_RESERVED', requestIdentity: 'unrelated' }])('unacknowledged reservation %p cannot POST', async ack => {
    const s = setup({ reserveDispatch: jest.fn(async () => ack) })
    await expect(s.adapter(await docxVisualReviewFixture().transport())).rejects.toMatchObject({ details: { reason: 'DISPATCH_RESERVATION_UNACKNOWLEDGED', outcome: 'NOT_SUBMITTED' } })
    expect(s.fetchImpl).not.toHaveBeenCalled()
  })
  test('failed reservation is sanitized and consumes the attempt without POST', async () => {
    const s = setup({ reserveDispatch: jest.fn(async () => { throw Object.assign(new Error('sensitive-callback-content'), { code: 'DOCX_VISUAL_REVIEW_PROVIDER_FAILED' }) }) })
    const t = await docxVisualReviewFixture().transport(), error = await s.adapter(t).catch(error => error)
    expect(error.details.reason).toBe('REQUIRED_DURABLE_CALLBACK_FAILED'); expect(JSON.stringify(error)).not.toContain('sensitive-callback-content')
    await expect(s.adapter(t)).rejects.toMatchObject({ code: 'DOCX_VISUAL_REVIEW_ATTEMPT_CONSUMED' }); expect(s.fetchImpl).not.toHaveBeenCalled()
  })
  test('concurrent calls consume allowance before awaiting the durable reservation', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    const s = setup({ reserveDispatch: jest.fn(async binding => { await gate; return { ...binding, state: 'DURABLE_DISPATCH_RESERVED' } }) }), t = await docxVisualReviewFixture().transport()
    const first = s.adapter(t)
    await expect(s.adapter(t)).rejects.toMatchObject({ code: 'DOCX_VISUAL_REVIEW_ATTEMPT_CONSUMED' })
    expect(s.reserveDispatch).toHaveBeenCalledTimes(1); release(); await first
    expect(s.fetchImpl).toHaveBeenCalledTimes(1)
  })
  test.each([undefined, false, {}, { state: 'DURABLE_RESPONSE_ID_RECORDED', responseId: 'resp_unrelated' }])('unacknowledged response identity %p cannot poll', async ack => {
    const s = setup({ fetchImpl: jest.fn(async () => response({ id: 'resp_visual_test', status: 'queued' })), recordResponseIdentity: jest.fn(async () => ack) })
    await expect(s.adapter(await docxVisualReviewFixture().transport())).rejects.toMatchObject({ details: { responseId: 'resp_visual_test', reason: 'RESPONSE_ID_UNACKNOWLEDGED', outcome: 'KNOWN_RESPONSE_UNRESOLVED' } })
    expect(s.fetchImpl).toHaveBeenCalledTimes(1)
  })
  test('polls only the acknowledged matching ID with no second POST', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(response({ id: 'resp_visual_test', status: 'queued' }))
      .mockResolvedValueOnce(response({ id: 'resp_visual_test', status: 'in_progress' })).mockResolvedValueOnce(response(completed()))
    const s = setup({ fetchImpl }), result = await s.adapter(await docxVisualReviewFixture().transport())
    expect(fetchImpl.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ['https://api.openai.com/v1/responses', 'POST'], ['https://api.openai.com/v1/responses/resp_visual_test', 'GET'], ['https://api.openai.com/v1/responses/resp_visual_test', 'GET']])
    expect(result.receipt.latencyMs).toBe(2000); expect(s.recordResponseIdentity).toHaveBeenCalledTimes(1)
  })
  test.each(['network', 'abort', 'http500', 'http400', 'overflow', 'invalidjson', 'invalidid'])('submission %s never resubmits and preserves safe uncertainty', async kind => {
    const fetchImpl = jest.fn(async () => {
      if (kind === 'network') throw new Error('sensitive-network-message')
      if (kind === 'abort') throw Object.assign(new Error('secret'), { name: 'AbortError' })
      if (kind === 'http500' || kind === 'http400') return response({ error: { message: 'sensitive-provider-content' } }, kind === 'http500' ? 500 : 400)
      if (kind === 'overflow') return response({ error: { code: 'context_length_exceeded' } }, 400)
      if (kind === 'invalidjson') return { ...response({}), text: async () => '{malformed' }
      return response({ id: 'untrusted/url', status: 'queued' })
    })
    const s = setup({ fetchImpl }), t = await docxVisualReviewFixture().transport(), error = await s.adapter(t).catch(error => error)
    expect(error.code).toBe('DOCX_VISUAL_REVIEW_PROVIDER_FAILED'); expect(JSON.stringify(error)).not.toMatch(/sensitive|fake-unit-key|untrusted\/url/)
    expect(error.details.outcome).toBe(['http400', 'overflow'].includes(kind) ? 'SUBMISSION_REJECTED' : 'SUBMISSION_UNCERTAIN')
    if (kind === 'overflow') expect(error.details.reason).toBe('PROVIDER_CONTEXT_OVERFLOW')
    await expect(s.adapter(t)).rejects.toMatchObject({ code: 'DOCX_VISUAL_REVIEW_ATTEMPT_CONSUMED' }); expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  test('known response mismatch and GET failure do not lose original ID or retry POST', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(response({ id: 'resp_visual_test', status: 'queued' })).mockResolvedValueOnce(response({ id: 'resp_other', status: 'completed' }))
    const s = setup({ fetchImpl })
    await expect(s.adapter(await docxVisualReviewFixture().transport())).rejects.toMatchObject({ details: { responseId: 'resp_visual_test', reason: 'PROVIDER_RESPONSE_ID_CHANGED' } })
    expect(fetchImpl.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
  })
  test('deadline stops polling, preserves known identity and cannot resubmit', async () => {
    let clock = 0
    const s = setup({ now: () => clock, sleep: async () => { clock = 300000 }, fetchImpl: jest.fn(async () => response({ id: 'resp_visual_test', status: 'queued' })) })
    await expect(s.adapter(await docxVisualReviewFixture().transport())).rejects.toMatchObject({ details: { responseId: 'resp_visual_test', reason: 'PROVIDER_TIMEOUT' } })
    expect(s.fetchImpl).toHaveBeenCalledTimes(1)
  })
  test.each(['refused', 'malformed', 'duplicate', 'missing-dimension', 'nonterminal', 'inconsistent'])('rejects %s provider result', async kind => {
    const body = completed()
    if (kind === 'refused') body.output[0].content = [{ type: 'refusal', refusal: 'sensitive' }]
    if (kind === 'malformed') body.output[0].content[0].text = '{not json'
    if (kind === 'duplicate') body.output.push(body.output[0])
    if (kind === 'nonterminal') body.status = 'failed'
    if (['missing-dimension', 'inconsistent'].includes(kind)) {
      const output = visualReviewOutput(); if (kind === 'missing-dimension') output.findings.pop(); else output.overallStatus = 'FAIL'
      body.output[0].content[0].text = JSON.stringify(output)
    }
    const s = setup({ fetchImpl: jest.fn(async () => response(body)) })
    await expect(s.adapter(await docxVisualReviewFixture().transport())).rejects.toMatchObject({ code: 'DOCX_VISUAL_REVIEW_PROVIDER_FAILED', details: { responseId: 'resp_visual_test' } })
    expect(s.fetchImpl).toHaveBeenCalledTimes(1)
  })
  test('mutating caller-owned receipts while awaiting reservation cannot change returned binding', async () => {
    const t = await docxVisualReviewFixture().transport(), expected = JSON.parse(JSON.stringify(t.subject.preview.pages))
    const s = setup({ reserveDispatch: async binding => { t.subject.preview.pages.reverse(); t.subject.candidate.inputFingerprint = 'f'.repeat(64); return { ...binding, state: 'DURABLE_DISPATCH_RESERVED' } } })
    const result = await s.adapter(t)
    expect(result.receipt.pages).toEqual(expected); expect(result.receipt.inputFingerprint).not.toBe('f'.repeat(64))
  })
  test('resealed altered title/text never reach the reservation callback', async () => {
    const t = await docxVisualReviewFixture().transport(), s = setup()
    t.document.title = 'Altered'; t.document.markdown = 'An unsupported stronger claim.'
    const { membershipHash } = await import('../services/runtimeEvidenceSnapshotContract.js')
    t.contextFingerprint = membershipHash(t.context)
    await expect(s.adapter(t)).rejects.toThrow()
    expect(s.reserveDispatch).not.toHaveBeenCalled(); expect(s.fetchImpl).not.toHaveBeenCalled()
  })
  test.each(['customer', 'profile', 'method'])('internally bound unsafe %s content reaches privacy policy and never reservation', async kind => {
    const f = docxVisualReviewFixture(), s = setup(), unsafe = 'Contact person@example.com.'
    if (kind === 'customer') { f.verified.document.markdown = unsafe; f.verified.candidateInput.markdown = unsafe }
    if (kind === 'profile') {
      const receipt = f.verified.candidate.selectedPacks.STYLE
      f.contents[receipt.packId] = unsafe; receipt.contentHash = `sha256:${createHash('sha256').update(unsafe).digest('hex')}`
    }
    if (kind === 'method') {
      const loader = f.deps.loadPackContent
      f.methodPack.contentHash = `sha256:${createHash('sha256').update(unsafe).digest('hex')}`
      f.deps.loadPackContent = async input => input.packId === f.methodPack.packId
        ? { ...f.methodPack, available: true, content: unsafe } : loader(input)
    }
    resealVisualReviewFixture(f)
    await expect(f.transport().then(s.adapter)).rejects.toMatchObject({ code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED' })
    expect(s.reserveDispatch).not.toHaveBeenCalled(); expect(s.fetchImpl).not.toHaveBeenCalled()
  })
  test.each([{ model: 'different' }, { maxRetries: 1 }, { timeoutMs: 1000 }, { reserveDispatch: null }, { recordResponseIdentity: null }])('rejects unsupported configuration %p before submission', override => {
    expect(() => setup(override)).toThrow('configuration')
  })
})
