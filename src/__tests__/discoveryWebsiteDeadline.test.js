import { jest } from '@jest/globals'
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
