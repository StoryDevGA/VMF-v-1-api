import { afterEach, expect, jest, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { sourceEvidenceHash } from '../services/sourceEvidenceContract.js'
import { executeTavilySearchTransport, executeCompaniesHouseProfileTransport } from '../services/publicResearchTransportService.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/syntheticPublicResearchResponses.json', import.meta.url)))
const args = () => ({ selector: structuredClone(fixture.selector), settings: structuredClone(fixture.settings) })
const search = () => ({ ...args(), provider: 'TAVILY_SEARCH', approvedHostname: 'controlled-capture.example',
  approvedTerms: ['workflow monitoring'], responseId: 'synthetic-response', capturedAt: '2026-11-13T00:00:00.000Z',
  transportOutcome: 'COMPLETE', httpStatus: 200, simulatedElapsedMs: 1, responseText: '' })
const workers = [['TAVILY_SEARCH', executeTavilySearchTransport, search], ['COMPANIES_HOUSE_PROFILE', executeCompaniesHouseProfileTransport, args]]
const authorization = operation => ({ operation, approvalRef: 'SYNTHETIC_APPROVAL_ASSERTION_NOT_PRODUCT_RELEASE',
  releaseRef: 'SYNTHETIC_RELEASE_ASSERTION', credentialOwner: 'synthetic', spendOwner: 'synthetic',
  expiresAt: new Date(Date.now() + 60000).toISOString() })
const liveOptions = (operation, send) => ({ mode: 'LIVE', send, credential: 'SYNTHETIC_TEST_ONLY_TOKEN_123456',
  authorization: authorization(operation), limits: { maxResponseBytes: 16384, timeoutMs: 1000 } })
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers() })

test.each(workers)('%s refuses missing internal dependencies without a global fetch fallback', async (_operation, execute, input) => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('Forbidden') })
  await expect(execute(input(), { mode: 'OFFLINE' })).rejects.toMatchObject({ details: { reason: 'PUBLIC_RESEARCH_TRANSPORT_NOT_CONFIGURED' } })
  await expect(execute(input(), { send: jest.fn() })).rejects.toMatchObject({ details: { reason: 'PUBLIC_RESEARCH_TRANSPORT_NOT_CONFIGURED' } })
  expect(fetch).not.toHaveBeenCalled()
})
test.each(workers)('%s builds only the fixed provider request; offline mode has no authentication', async (operation, execute, input) => {
  const value = input(); value.settings.instructions = 'PRIVATE_CONTEXT_SENTINEL'
  const send = jest.fn(async () => new Response('{}'))
  const result = await execute(value, { mode: 'OFFLINE', send })
  const [url, options] = send.mock.calls[0]
  expect(url).toBe(operation === 'TAVILY_SEARCH' ? 'https://api.tavily.com/search' : 'https://api.company-information.service.gov.uk/company/00123456')
  expect(options).toMatchObject({ method: operation === 'TAVILY_SEARCH' ? 'POST' : 'GET', redirect: 'error', headers: { 'Content-Type': 'application/json' } })
  expect(options.headers.Authorization).toBeUndefined()
  expect(JSON.stringify(options)).not.toContain('PRIVATE_CONTEXT_SENTINEL')
  expect(result).toMatchObject({ classification: 'OFFLINE_SYNTHETIC_HTTP_RESPONSE', httpStatus: 200,
    responseText: '{}', bytesRead: 2, limits: { maxResponseBytes: 16384, timeoutMs: 1000, retries: 0, redirects: 0 } })
  expect(result.responseTextHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(options.signal.aborted).toBe(true); expect(send).toHaveBeenCalledTimes(1)
})
test.each(workers)('%s future authenticated request uses only supplied synthetic header material', async (operation, execute, input) => {
  const send = jest.fn(async () => new Response('{}')), options = liveOptions(operation, send)
  const result = await execute(input(), options)
  const header = send.mock.calls[0][1].headers.Authorization
  expect(header).toBe(operation === 'TAVILY_SEARCH' ? 'Bearer ' + options.credential : 'Basic ' + Buffer.from(options.credential + ':').toString('base64'))
  expect(JSON.stringify(result)).not.toContain(options.credential)
  expect(JSON.stringify(result)).not.toContain(header)
})
test.each(workers)('%s refuses credentials in offline mode and missing/expired/wrong live assertions before sending', async (operation, execute, input) => {
  const send = jest.fn(), options = liveOptions(operation, send)
  for (const invalid of [{ ...options, mode: 'OFFLINE' }, { ...options, authorization: undefined },
    { ...options, authorization: { ...options.authorization, expiresAt: '2000-01-01T00:00:00.000Z' } },
    { ...options, authorization: { ...options.authorization, operation: operation === 'TAVILY_SEARCH' ? 'COMPANIES_HOUSE_PROFILE' : 'TAVILY_SEARCH' } },
    { ...options, credential: undefined }, { ...options, credential: 'bad\r\nheader' },
    { ...options, limits: { ...options.limits, maxResponseBytes: 16385 } }]) await expect(execute(input(), invalid)).rejects.toMatchObject({ code: 'CONFLICT' })
  expect(send).not.toHaveBeenCalled()
})
test.each(workers)('%s refuses raw or encoded synthetic credential echoes including streamed chunks', async (operation, execute, input) => {
  for (const encoded of [false, true]) {
    const options = liveOptions(operation, null), text = encoded ? Buffer.from(options.credential + ':').toString('base64') : options.credential
    if (encoded && operation === 'TAVILY_SEARCH') continue
    let index = 0
    const chunks = [text.slice(0, 8), text.slice(8)]
    options.send = async () => ({ status: 200, body: { getReader: () => ({ read: async () => index < chunks.length
      ? { done: false, value: new TextEncoder().encode(chunks[index++]) } : { done: true }, cancel: async () => {} }) } })
    await expect(execute(input(), options)).rejects.toMatchObject({ details: { reason: 'PUBLIC_RESEARCH_CREDENTIAL_ECHO' } })
  }
})
test.each([200, 204, 304, 404, 429, 503])('preserves observed HTTP %i without interpreting the raw response as evidence', async status => {
  const send = jest.fn(async () => new Response([204, 304].includes(status) ? null : '{"synthetic":"body"}', { status }))
  const result = await executeCompaniesHouseProfileTransport(args(), { mode: 'OFFLINE', send })
  expect(result).toMatchObject({ httpStatus: status, observedHttpStatus: status, transportOutcome: 'COMPLETE' })
  expect(send).toHaveBeenCalledTimes(1); expect(result.evidenceObjects).toBeUndefined()
})
test.each(['001/234', '001?x', '%2F', '001#x', 'é123', '001-123'])('refuses unsafe/non-alphanumeric exact registry ID %s', async entityIdentifier => {
  const input = args(); input.settings.entityIdentifier = entityIdentifier
  const send = jest.fn()
  await expect(executeCompaniesHouseProfileTransport(input, { mode: 'OFFLINE', send })).rejects.toMatchObject({ code: 'PUBLIC_RESEARCH_RESPONSE_INVALID' })
  expect(send).not.toHaveBeenCalled()
})
test.each([{ entityConfirmed: false }, { countryCode: 'IE', ukSubsidiary: false }, { legalEntity: '' }, { sources: ['SEARCH'] }])('refuses an unconfirmed/non-UK registry request %j', async change => {
  const input = args(); Object.assign(input.settings, change); const send = jest.fn()
  await expect(executeCompaniesHouseProfileTransport(input, { mode: 'OFFLINE', send })).rejects.toMatchObject({ code: 'PUBLIC_RESEARCH_RESPONSE_INVALID' })
  expect(send).not.toHaveBeenCalled()
})
test('confirmed UK subsidiary preserves the exact supplied company number', async () => {
  const input = args(); Object.assign(input.settings, { countryCode: 'IE', ukSubsidiary: true, entityIdentifier: 'SC001234' })
  const send = jest.fn(async () => new Response('{}'))
  await executeCompaniesHouseProfileTransport(input, { mode: 'OFFLINE', send })
  expect(send.mock.calls[0][0]).toBe('https://api.company-information.service.gov.uk/company/SC001234')
})
test('cannot supply an arbitrary Tavily endpoint, domain or private query through a prepared descriptor', async () => {
  const input = search(); input.descriptor = { url: 'https://evil.example/' }; const send = jest.fn()
  await expect(executeTavilySearchTransport(input, { mode: 'OFFLINE', send })).rejects.toMatchObject({ code: 'PUBLIC_RESEARCH_RESPONSE_INVALID' })
  expect(send).not.toHaveBeenCalled()
})
test('registry shares streaming byte limits and refuses oversized responses', async () => {
  await expect(executeCompaniesHouseProfileTransport(args(), { mode: 'OFFLINE', send: async () => new Response('x'.repeat(16385)) }))
    .rejects.toMatchObject({ details: { reason: 'PUBLIC_RESEARCH_RESPONSE_TOO_LARGE' } })
})
test('registry deadline includes response body and retains only decoded prefix with no invented HTTP failure', async () => {
  jest.useFakeTimers(); let entered
  const ready = new Promise(resolve => { entered = resolve })
  let first = true
  const send = jest.fn(async () => ({ status: 200, body: { getReader: () => ({ read: async () => {
    if (first) { first = false; entered(); return { done: false, value: new TextEncoder().encode('prefix') } }
    return new Promise(() => {})
  }, cancel: async () => {} }) } }))
  const pending = executeCompaniesHouseProfileTransport(args(), { mode: 'OFFLINE', send })
  await ready; await jest.advanceTimersByTimeAsync(1000)
  expect(await pending).toMatchObject({ httpStatus: null, observedHttpStatus: 200, transportOutcome: 'TIMEOUT', responseText: 'prefix' })
  expect(send).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0)
})

test('a tighter offline byte limit retains actual status, observed bytes and only the bounded prefix', async () => {
  let index = 0
  const chunks = [new TextEncoder().encode('ok'), new TextEncoder().encode('overflow')]
  const send = jest.fn(async () => ({ status: 200, body: { getReader: () => ({
    read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }, cancel: async () => {} }) } }))
  await expect(executeCompaniesHouseProfileTransport(args(), { mode: 'OFFLINE', send, limits: { maxResponseBytes: 3, timeoutMs: 100 } }))
    .rejects.toMatchObject({ details: { reason: 'PUBLIC_RESEARCH_RESPONSE_TOO_LARGE' }, transportReceipt: {
      httpStatus: 200, bytesRead: 10, responseText: 'ok', responseTextHash: sourceEvidenceHash('ok'),
      transportOutcome: 'LIMIT_EXCEEDED', bodyComplete: false } })
  expect(send).toHaveBeenCalledTimes(1)
})

test('a failed stream preserves the observed response and excludes dependency exception text', async () => {
  let first = true
  const send = async () => ({ status: 503, body: { getReader: () => ({ read: async () => {
    if (first) { first = false; return { done: false, value: new TextEncoder().encode('prefix') } }
    throw new Error('PRIVATE_DEPENDENCY_SENTINEL')
  }, cancel: async () => {} }) } })
  const error = await executeCompaniesHouseProfileTransport(args(), { mode: 'OFFLINE', send }).catch(value => value)
  expect(error).toMatchObject({ transportReceipt: { httpStatus: 503, bytesRead: 6, responseText: 'prefix',
    responseTextHash: sourceEvidenceHash('prefix'), transportOutcome: 'FAILED', bodyComplete: false } })
  expect(JSON.stringify(error)).not.toContain('PRIVATE_DEPENDENCY_SENTINEL')
})

test('a credential echo withholds private body and hash in the failure receipt', async () => {
  const options = liveOptions('TAVILY_SEARCH', null)
  options.send = async () => new Response(options.credential)
  const error = await executeTavilySearchTransport(search(), options).catch(value => value)
  expect(error).toMatchObject({ details: { reason: 'PUBLIC_RESEARCH_CREDENTIAL_ECHO' }, transportReceipt: {
    httpStatus: 200, responseText: null, responseTextHash: null, bodyComplete: false } })
  expect(JSON.stringify(error)).not.toContain(options.credential)
})

test('a tighter offline deadline aborts once without a retry or invented HTTP status', async () => {
  jest.useFakeTimers()
  const send = jest.fn(() => new Promise(() => {}))
  const pending = executeCompaniesHouseProfileTransport(args(), { mode: 'OFFLINE', send, limits: { maxResponseBytes: 10, timeoutMs: 25 } })
  await jest.advanceTimersByTimeAsync(25)
  expect(await pending).toMatchObject({ transportOutcome: 'TIMEOUT', httpStatus: null, observedHttpStatus: null, responseText: '', bytesRead: 0 })
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][1].signal.aborted).toBe(true)
  expect(jest.getTimerCount()).toBe(0)
})
