import { jest } from '@jest/globals'
import { createHash } from 'node:crypto'
import { acquireWebsiteDiscoveryEvidence } from '../services/discoveryIntelligenceService.js'

const originalFetch = globalThis.fetch
const originalDns = globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
const html = '<html><p>The synthetic company provides workflow monitoring services to customers in the United Kingdom.</p></html>'
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const response = (overrides = {}) => ({ ok: true, status: 200, url: 'https://deadline.example/',
  headers: { get: key => key === 'content-type' ? 'text/html' : key === 'content-length' ? String(html.length) : null },
  text: jest.fn(async () => html), ...overrides })
const acquire = () => acquireWebsiteDiscoveryEvidence({ websiteUrl: 'https://deadline.example/',
  acquisitionProfile: 'STANDARD', acquiredAt: '2026-10-05T10:00:00.000Z' })
const observe = promise => promise.then(value => ({ value }), error => ({ error }))
const researchAcquire = limits => acquireWebsiteDiscoveryEvidence({ websiteUrl: 'https://deadline.example/',
  acquisitionProfile: 'STANDARD', acquiredAt: '2026-10-05T10:00:00.000Z', recordSourceCapture: true,
  researchTransport: { maxResponseBytes: 1000, timeoutMs: 500, ...limits } })

beforeEach(() => {
  jest.useFakeTimers()
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
  globalThis.fetch = jest.fn(async () => response())
})
afterEach(() => {
  jest.useRealTimers()
  globalThis.fetch = originalFetch
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = originalDns
})

test('research mode counts streamed response-body bytes and keeps raw text out of public material', async () => {
  const text = html.replace('company', 'café company')
  globalThis.fetch.mockResolvedValue(new Response(text, { headers: { 'content-type': 'text/html' } }))
  const result = await researchAcquire({ maxResponseBytes: Buffer.byteLength(text) })
  expect(result.transportReceipt).toMatchObject({ responseText: text, bytesRead: Buffer.byteLength(text), httpStatus: 200 })
  expect(result.source.transportReceipt).toBeUndefined(); expect(result.sourceRegistryEntry.transportReceipt).toBeUndefined()
  expect(result.source.sourceCapture).toBeDefined()
})
test('research byte ceiling refuses the full over-budget response without silently clipping evidence', async () => {
  globalThis.fetch.mockResolvedValue(new Response(html, { headers: { 'content-type': 'text/html' } }))
  await expect(researchAcquire({ maxResponseBytes: Buffer.byteLength(html) - 1 })).rejects.toThrow('research byte limit')
  expect(globalThis.fetch).toHaveBeenCalledTimes(1)
})
test.each([404, 206])('research retains bounded HTTP%i raw failure privately and produces no original evidence', async status => {
  globalThis.fetch.mockResolvedValue(new Response(html, { status, headers: { 'content-type': 'text/html' } }))
  const result = await observe(researchAcquire())
  expect(result.value).toBeUndefined()
  expect(result.error.transportReceipt).toMatchObject({ httpStatus: status, responseText: html, bytesRead: Buffer.byteLength(html) })
})
test('research preserves a bounded JSON error body privately without interpreting it as HTML evidence', async () => {
  const body = '{"error":"synthetic unavailable"}'
  globalThis.fetch.mockResolvedValue(new Response(body, { status: 404, headers: { 'content-type': 'application/json' } }))
  const result = await observe(researchAcquire())
  expect(result.value).toBeUndefined()
  expect(result.error.transportReceipt).toMatchObject({ httpStatus: 404, responseText: body, bytesRead: Buffer.byteLength(body) })
  expect(result.error.transportReceipt.responseTextHash).toMatch(/^sha256:[a-f0-9]{64}$/)
})
test('research never follows a redirect or resolves its next target', async () => {
  globalThis.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://deadline.example/next' } }))
  await expect(researchAcquire()).rejects.toThrow('redirect limit')
  expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).toHaveBeenCalledTimes(1)
})
test.each([{ maxResponseBytes: 0 }, { maxResponseBytes: 320001 }, { timeoutMs: 0 }, { timeoutMs: 6001 }, { arbitrary: true }])('research refuses invalid limits %j before DNS or HTTP', async limits => {
  await expect(researchAcquire(limits)).rejects.toThrow('research limits are invalid')
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__).not.toHaveBeenCalled()
})
test('research can shorten the existing deadline and never schedules a retry', async () => {
  globalThis.fetch.mockImplementation(() => new Promise(() => {}))
  const pending = observe(researchAcquire({ timeoutMs: 100 }))
  await jest.advanceTimersByTimeAsync(100)
  expect((await pending).error.message).toBe('Website acquisition timed out.')
  expect(globalThis.fetch).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0)
})

test.each(['complete', 'stall', 'reject', 'throw'])('research preserves its bounded prefix when body timeout cancellation will %s', async behavior => {
  const prefix = '<html><p>Partial caf'
  const bytes = Buffer.concat([Buffer.from(prefix), Buffer.from([0xc3])])
  const next = deferred()
  const reader = { read: jest.fn().mockResolvedValueOnce({ done: false, value: bytes }).mockImplementation(() => next.promise),
    releaseLock: jest.fn(), cancel: jest.fn(() => {
      if (behavior === 'throw') throw new Error('synthetic cancel failure')
      if (behavior === 'reject') return Promise.reject(new Error('synthetic cancel failure'))
      if (behavior === 'stall') return new Promise(() => {})
      next.resolve({ done: true }); return Promise.resolve()
    }) }
  globalThis.fetch.mockResolvedValue(response({ body: { getReader: () => reader } }))
  const pending = observe(researchAcquire({ timeoutMs: 100 }))
  await jest.advanceTimersByTimeAsync(100)
  const result = await pending
  expect(result.value).toBeUndefined()
  expect(result.error.message).toBe('Website acquisition timed out.')
  expect(result.error.transportReceipt).toMatchObject({ httpStatus: 200, bytesRead: bytes.length,
    responseText: prefix, bodyComplete: false, transportOutcome: 'TIMEOUT',
    requestedUrl: 'https://deadline.example/', finalUrl: 'https://deadline.example/' })
  const snapshot = JSON.stringify(result.error.transportReceipt)
  expect(result.error.transportReceipt.responseTextHash).toBe('sha256:' + createHash('sha256').update(prefix).digest('hex'))
  next.resolve({ done: false, value: new Uint8Array([0xa9]) })
  await jest.advanceTimersByTimeAsync(0)
  expect(JSON.stringify(result.error.transportReceipt)).toBe(snapshot)
  expect(reader.cancel).toHaveBeenCalledTimes(1)
  expect(reader.releaseLock).toHaveBeenCalledTimes(1)
  expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

test.each(['resolve', 'reject'])('stalled text fails at six seconds; late body %s cannot change its outcome', async late => {
  const body = deferred()
  globalThis.fetch.mockResolvedValue(response({ text: jest.fn(() => body.promise) }))
  let settled = false
  const result = observe(acquire()).then(value => { settled = true; return value })
  await jest.advanceTimersByTimeAsync(5999)
  expect(settled).toBe(false)
  await jest.advanceTimersByTimeAsync(1)
  expect((await result).error.message).toBe('Website acquisition timed out.')
  expect(globalThis.fetch.mock.calls[0][1].signal.aborted).toBe(true)
  body[late](late === 'resolve' ? html : new Error('late transport failure'))
  await jest.advanceTimersByTimeAsync(0)
  expect((await result).value).toBeUndefined()
  expect(jest.getTimerCount()).toBe(0)
})

test.each(['complete', 'stall', 'reject', 'throw'])('stream cancellation %s never extends the deadline', async behavior => {
  const read = deferred()
  const reader = { read: jest.fn(() => read.promise), releaseLock: jest.fn(), cancel: jest.fn(() => {
    if (behavior === 'throw') throw new Error('cancel failed')
    if (behavior === 'reject') return Promise.reject(new Error('cancel failed'))
    if (behavior === 'stall') return new Promise(() => {})
    read.resolve({ done: true })
    return Promise.resolve()
  }) }
  globalThis.fetch.mockResolvedValue(response({ body: { getReader: () => reader } }))
  const result = observe(acquire())
  await jest.advanceTimersByTimeAsync(6000)
  expect((await result).error.message).toBe('Website acquisition timed out.')
  expect(reader.cancel).toHaveBeenCalledTimes(1)
  if (behavior !== 'complete') read.resolve({ done: false, value: new TextEncoder().encode(html) })
  await jest.advanceTimersByTimeAsync(0)
  expect(reader.releaseLock).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

test('slow DNS fails at the deadline and late resolution does not start fetch', async () => {
  const dns = deferred()
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__.mockReturnValue(dns.promise)
  const result = observe(acquire())
  await jest.advanceTimersByTimeAsync(6000)
  expect((await result).error.message).toBe('Website acquisition timed out.')
  dns.resolve([{ address: '93.184.216.34', family: 4 }])
  await jest.advanceTimersByTimeAsync(0)
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

test('late fetch headers cannot start body consumption after timeout', async () => {
  const headers = deferred()
  const body = response()
  globalThis.fetch.mockReturnValue(headers.promise)
  const result = observe(acquire())
  await jest.advanceTimersByTimeAsync(6000)
  expect((await result).error.message).toBe('Website acquisition timed out.')
  headers.resolve(body)
  await jest.advanceTimersByTimeAsync(0)
  expect(body.text).not.toHaveBeenCalled()
})

test('successful extraction keeps actual identity, evidence and clears its timer', async () => {
  const result = await acquire()
  expect(result.source).toMatchObject({ status: 'ACQUIRED', url: 'https://deadline.example/', adapter: 'website-html-fetch-v1' })
  expect(result.source.valueHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(result.evidenceObjects.length).toBeGreaterThan(0)
  expect(jest.getTimerCount()).toBe(0)
  expect(globalThis.fetch.mock.calls[0][1].signal.aborted).toBe(false)
})

test.each(['HTTP', 'DNS'])('early %s failure preserves its reason and clears the deadline', async failure => {
  if (failure === 'HTTP') globalThis.fetch.mockResolvedValue(response({ ok: false, status: 503 }))
  else globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__.mockRejectedValue(new Error('synthetic DNS failure'))
  const result = await observe(acquire())
  expect(result.error.message).not.toBe('Website acquisition timed out.')
  if (failure === 'HTTP') expect(result.error.message).toBe('Website acquisition failed with HTTP 503.')
  expect(jest.getTimerCount()).toBe(0)
})
