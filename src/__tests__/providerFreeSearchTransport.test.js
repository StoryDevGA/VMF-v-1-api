import { afterEach, expect, jest, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { dispatchProviderFreeSearchFixture, PROVIDER_FREE_SEARCH_FIXTURE } from '../services/controlledReplayAcquisitionService.js'
import { prepareTavilySearchFixture } from '../services/publicResearchResponseContract.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/syntheticPublicResearchResponses.json', import.meta.url)))
const asset = JSON.parse(readFileSync(new URL('../runtime-contracts/controlled-replay/search-response.v1.json', import.meta.url)))
const args = () => ({ selector: structuredClone(fixture.selector), settings: { ...structuredClone(fixture.settings),
  sources: ['SEARCH'], startingUrls: [PROVIDER_FREE_SEARCH_FIXTURE.targetUrl] } })
const response = (body = asset.response, status = 200) => new Response(JSON.stringify(body), { status })
const refusal = reason => expect.objectContaining({ status: 409, code: 'CONFLICT', details: { reason } })
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

test('default Start dependency uses the hash-verified local response without fetch or DNS', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('No network.') })
  const result = await dispatchProviderFreeSearchFixture(args())
  expect(result.responseText).toBe(JSON.stringify(asset.response))
  expect(prepareTavilySearchFixture(result)).toMatchObject({ fixtureOnly: true, liveExecutionEnabled: false })
  expect(fetch).not.toHaveBeenCalled()
})
test('serializes one fixed bounded POST with no credentials, private context or retry', async () => {
  const input = args(); input.settings.instructions = 'PRIVATE_CONTEXT_SENTINEL'
  const send = jest.fn(async () => response())
  await dispatchProviderFreeSearchFixture(input, { send })
  expect(send).toHaveBeenCalledTimes(1)
  const [url, options] = send.mock.calls[0]
  expect(url).toBe('https://api.tavily.com/search')
  expect(options).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error' })
  expect(JSON.parse(options.body)).toEqual({ query: 'site:www.trilogywebsolutions.co.uk clients', search_depth: 'basic',
    topic: 'general', max_results: 4, include_domains: ['www.trilogywebsolutions.co.uk'], include_domains_mode: 'restrict',
    auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false,
    include_image_descriptions: false, include_favicon: false, include_usage: true })
  expect(JSON.stringify(options)).not.toMatch(/PRIVATE_CONTEXT_SENTINEL|Authorization|api_key/)
  expect(options.signal.aborted).toBe(true)
})
test.each([[429, 'RATE_LIMITED'], [503, 'UNAVAILABLE']])('preserves actual HTTP %i and its bounded raw body', async (status, outcome) => {
  const result = await dispatchProviderFreeSearchFixture(args(), { send: async () => response({ error: 'synthetic refusal' }, status) })
  expect(result.httpStatus).toBe(status)
  expect(result.responseText).toBe('{"error":"synthetic refusal"}')
  expect(prepareTavilySearchFixture(result).normalized.response.status).toBe(outcome)
})
test.each([
  ['malformed JSON', '{'],
  ['query mismatch', JSON.stringify({ ...asset.response, query: 'unapproved query' })],
  ['off-domain result', JSON.stringify({ ...asset.response, results: [{ ...asset.response.results[0], url: 'https://example.org/' }] })],
])('passes %s bytes to the existing strict mapper without inventing evidence', async (_label, text) => {
  const result = await dispatchProviderFreeSearchFixture(args(), { send: async () => new Response(text) })
  expect(result.responseText).toBe(text)
  expect(() => prepareTavilySearchFixture(result)).toThrow(expect.objectContaining({ code: 'PUBLIC_RESEARCH_RESPONSE_INVALID' }))
})
test('retains an honest empty result', async () => {
  const result = await dispatchProviderFreeSearchFixture(args(), { send: async () => response({ ...asset.response, results: [] }) })
  expect(prepareTavilySearchFixture(result).normalized).toMatchObject({ response: { status: 'EMPTY' }, discoveryItems: [] })
})
test('counts streamed UTF-8 bytes before parsing and cancels oversized bodies', async () => {
  let index = 0
  const cancel = jest.fn(async () => {})
  const chunks = [new TextEncoder().encode('é'.repeat(4096)), new Uint8Array(8193)]
  const send = jest.fn(async () => ({ status: 200, body: { getReader: () => ({ cancel,
    read: async () => ({ done: false, value: chunks[index++] }) }) } }))
  await expect(dispatchProviderFreeSearchFixture(args(), { send })).rejects.toEqual(refusal('PROVIDER_FREE_SEARCH_RESPONSE_TOO_LARGE'))
  expect(index).toBe(2); expect(cancel).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(1)
})
test('allows exactly 16KiB and reconstructs split UTF-8 text', async () => {
  const bytes = new TextEncoder().encode('é' + 'x'.repeat(16382)); let index = 0
  const parts = [bytes.slice(0, 1), bytes.slice(1)]
  const result = await dispatchProviderFreeSearchFixture(args(), { send: async () => ({ status: 200,
    body: { getReader: () => ({ read: async () => index < parts.length ? { done: false, value: parts[index++] } : { done: true }, cancel: async () => {} }) } }) })
  expect(Buffer.byteLength(result.responseText)).toBe(16384)
  expect(result.responseText.startsWith('é')).toBe(true)
})
test.each([
  ['send rejection', async () => { throw new Error('SYNTHETIC_SECRET_SENTINEL') }],
  ['null send rejection', async () => { throw null }],
  ['undefined send rejection', async () => { throw undefined }],
  ['forged internal error', async () => { throw Object.assign(new Error('SYNTHETIC_SECRET_SENTINEL'), {
    details: { reason: 'PROVIDER_FREE_SEARCH_RESPONSE_TOO_LARGE' }, secret: 'SYNTHETIC_SECRET_SENTINEL' }) }],
  ['invalid status', async () => ({ status: 0, body: {} })],
  ['missing body', async () => ({ status: 200 })],
  ['reader rejection', async () => ({ status: 200, body: { getReader: () => ({ read: async () => { throw new Error('SYNTHETIC_SECRET_SENTINEL') }, cancel: async () => {} }) } })],
  ['null reader rejection', async () => ({ status: 200, body: { getReader: () => ({ read: async () => { throw null }, cancel: async () => {} }) } })],
  ['undefined reader rejection', async () => ({ status: 200, body: { getReader: () => ({ read: async () => { throw undefined }, cancel: async () => {} }) } })],
  ['invalid UTF-8', async () => new Response(new Uint8Array([255]))],
  ['non-byte stream', async () => ({ status: 200, body: { getReader: () => ({ read: async () => ({ value: 'text', done: false }), cancel: async () => {} }) } })],
])('refuses %s without inventing an HTTP result or reflecting exceptions', async (_label, send) => {
  const pending = dispatchProviderFreeSearchFixture(args(), { send })
  await expect(pending).rejects.toEqual(refusal('PROVIDER_FREE_SEARCH_TRANSPORT_INVALID'))
  await pending.catch(error => expect(JSON.stringify(error)).not.toContain('SYNTHETIC_SECRET_SENTINEL'))
})
test.each(['headers', 'body'])('deadline covers hung %s and aborts without retry', async stage => {
  jest.useFakeTimers()
  let called
  const entered = new Promise(resolve => { called = resolve })
  const cancel = jest.fn(() => new Promise(() => {}))
  const send = jest.fn(async () => {
    called()
    if (stage === 'headers') return new Promise(() => {})
    let first = true
    return { status: 200, body: { getReader: () => ({ cancel, read: async () => {
      if (first) { first = false; return { done: false, value: new TextEncoder().encode('partial') } }
      return new Promise(() => {})
    } }) } }
  })
  const pending = dispatchProviderFreeSearchFixture(args(), { send })
  await entered; await jest.advanceTimersByTimeAsync(1000)
  const result = await pending
  expect(result).toMatchObject({ transportOutcome: 'TIMEOUT', httpStatus: null, responseText: stage === 'body' ? 'partial' : '' })
  expect(prepareTavilySearchFixture(result).normalized.response.status).toBe('UNAVAILABLE')
  expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][1].signal.aborted).toBe(true)
  expect(cancel).toHaveBeenCalledTimes(stage === 'body' ? 1 : 0)
  expect(jest.getTimerCount()).toBe(0)
})
test('rejects mismatched saved scope before invoking the dependency', async () => {
  const input = args(); input.settings.startingUrls = ['https://example.org/']
  const send = jest.fn()
  await expect(dispatchProviderFreeSearchFixture(input, { send })).rejects.toMatchObject({ code: 'PUBLIC_RESEARCH_RESPONSE_INVALID' })
  expect(send).not.toHaveBeenCalled()
})
