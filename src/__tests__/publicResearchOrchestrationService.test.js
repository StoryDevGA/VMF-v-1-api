import { expect, jest, test } from '@jest/globals'
import { performance } from 'node:perf_hooks'
import { executePublicResearchOperations } from '../services/publicResearchOrchestrationService.js'
import { sourceEvidenceHash } from '../services/sourceEvidenceContract.js'
import { acquireWebsiteDiscoveryEvidence } from '../services/discoveryIntelligenceService.js'

// LIVE-shaped requests use explicitly injected in-memory senders. No key,
// network, database or native approval is supplied or proved by this suite.
const url = 'https://research.example/'
const create = ({ settings = {}, policy = {}, send, acquireWebsite } = {}) => {
  const events = [], context = { row: { publicResearch: { operations: [] } }, runId: 'synthetic-run', executionAttemptId: 'synthetic-attempt' }
  const search = { query: 'site:research.example workflow', request_id: 'synthetic-request',
    results: [{ url, title: 'Synthetic public website', content: 'Discovery only', score: 0.5 }], response_time: 0.001, usage: { credits: 1 } }
  const execution = { configuration: { configurationVersion: '11111111-1111-4111-8111-111111111111',
    configurationHash: 'sha256:' + 'a'.repeat(64), basisStateVersion: 'rsv2:22222222-2222-4222-8222-222222222222', coverage: 'STANDARD',
    settings: { startingUrls: [url], sources: ['SEARCH', 'WEBSITE'], legalEntity: '', countryCode: '', entityIdentifier: '',
      entityConfirmed: false, ukSubsidiary: false, instructions: '', ...settings } },
  plan: { mode: 'LIVE', hostname: 'research.example', selectedCategories: ['SEARCH', 'WEBSITE'], startingUrls: [url],
    approvedDiscoveryUrls: [], approvedTerms: ['workflow'], registry: { applicable: false }, partialSave: 'PRESERVE_PENDING',
    approvalRef: 'SYNTHETIC_ONLY', releaseId: '11111111-1111-4111-8111-111111111111', credentialOwner: 'SYNTHETIC_ONLY',
    spendOwner: 'SYNTHETIC_ONLY', expiresAt: '2099-01-01T00:00:00.000Z',
    limits: { maxElapsedMs: 10000, maxRequestMs: 1000, maxTotalBytes: 20000, maxJsonBytes: 16384, maxPageBytes: 1000, maxPages: 1 }, ...policy },
  resolveCredential: jest.fn(() => { events.push('credential'); return 'synthetic-unit-token-never-a-real-key' }),
  send: jest.fn(send || (async () => { events.push('search'); return new Response(JSON.stringify(search)) })),
  acquireWebsite: jest.fn(acquireWebsite || (async ({ websiteUrl }) => {
    events.push('website:' + websiteUrl)
    return { source: { sourceId: 'website_original', sourceCapture: { originalContentHash: sourceEvidenceHash('original') } },
      evidenceObjects: [{ evidenceObjectId: 'original-1' }], transportReceipt: { httpStatus: 200, transportOutcome: 'COMPLETE',
        bodyComplete: true, responseText: 'original', responseTextHash: sourceEvidenceHash('original'), bytesRead: 8 } }
  })) }
  const reserve = jest.fn(async input => {
    events.push('reserve:' + input.category)
    const operation = { ...input, ordinal: context.row.publicResearch.operations.length, phase: 'DISPATCHING', receipt: null }
    context.row.publicResearch.operations.push(operation)
    return operation
  })
  const complete = jest.fn(async (ordinal, patch) => {
    events.push('commit:' + context.row.publicResearch.operations[ordinal].category)
    Object.assign(context.row.publicResearch.operations[ordinal], patch, { phase: 'RECORDED' })
  })
  const assertActive = jest.fn(async () => { events.push('current') })
  return { context, execution, reserve, complete, assertActive, events }
}

test('reserves and records search before capturing only the approved original once', async () => {
  const input = create()
  await executePublicResearchOperations(input)
  expect(input.events).toEqual(['current', 'credential', 'reserve:SEARCH', 'search', 'commit:SEARCH',
    'current', 'reserve:WEBSITE', 'website:' + url, 'commit:WEBSITE', 'current'])
  expect(input.execution.send).toHaveBeenCalledTimes(1)
  expect(input.execution.acquireWebsite).toHaveBeenCalledTimes(1)
  expect(input.execution.resolveCredential).toHaveBeenCalledTimes(1)
  expect(input.context.publicResearchMaySave).toBe(true)
  expect([...input.context.publicResearchCaptures.keys()]).toEqual([url])
  expect(input.context.row.publicResearch.operations[0]).toMatchObject({ outcome: 'SUCCEEDED', mapping: { classification: 'DISCOVERY_ONLY' } })
  expect(input.context.row.publicResearch.operations[0].capture).toBeUndefined()
  expect(input.context.row.publicResearch.operations[1]).toMatchObject({ capture: { sourceId: 'website_original', evidenceObjectCount: 1 } })
  expect(input.context.publicResearchCaptures.get(url).transportReceipt).toBeUndefined()
})

test.each([429, 500])('preserves HTTP%s response and stops without a website or registry call', async status => {
  const input = create({ send: async () => new Response('{"error":"synthetic refusal"}', { status }) })
  await executePublicResearchOperations(input)
  expect(input.context.publicResearchMaySave).toBe(false)
  expect(input.execution.acquireWebsite).not.toHaveBeenCalled()
  expect(input.execution.send).toHaveBeenCalledTimes(1)
  expect(input.complete.mock.calls[0][1]).toMatchObject({ outcome: 'FAILED', receipt: { httpStatus: status,
    responseText: '{"error":"synthetic refusal"}', bodyComplete: true } })
})

test('malformed success is recorded as failed rather than becoming original evidence', async () => {
  const input = create({ send: async () => new Response('{"wrong":true}') })
  await executePublicResearchOperations(input)
  expect(input.complete.mock.calls[0][1]).toMatchObject({ outcome: 'FAILED', failureReason: 'PUBLIC_RESEARCH_RESPONSE_INVALID' })
  expect(input.execution.acquireWebsite).not.toHaveBeenCalled()
})

test('empty discovery still permits the explicitly approved starting original', async () => {
  const input = create({ send: async () => new Response(JSON.stringify({ query: 'site:research.example workflow',
    request_id: 'synthetic-empty', results: [], response_time: 0.001, usage: { credits: 1 } })) })
  await executePublicResearchOperations(input)
  expect(input.context.row.publicResearch.operations[0].outcome).toBe('EMPTY')
  expect(input.context.publicResearchMaySave).toBe(true)
})

test('an IO failure stops with an uncertain outcome and no automatic dispatch', async () => {
  const input = create({ send: async () => { throw new Error('private dependency detail') } })
  await executePublicResearchOperations(input)
  expect(input.execution.send).toHaveBeenCalledTimes(1)
  expect(input.execution.acquireWebsite).not.toHaveBeenCalled()
  expect(input.complete.mock.calls[0][1]).toMatchObject({ outcome: 'UNKNOWN' })
  expect(JSON.stringify(input.complete.mock.calls)).not.toContain('private dependency detail')
})

test('a failed reservation cannot send a request', async () => {
  const input = create(); input.reserve.mockRejectedValue(new Error('synthetic reserve failure'))
  await expect(executePublicResearchOperations(input)).rejects.toThrow('synthetic reserve failure')
  expect(input.execution.send).not.toHaveBeenCalled()
  expect(input.complete).not.toHaveBeenCalled()
})

test('an unconfirmed response commit prevents every next operation', async () => {
  const input = create(); input.complete.mockRejectedValue(new Error('synthetic unconfirmed commit'))
  await expect(executePublicResearchOperations(input)).rejects.toThrow('synthetic unconfirmed commit')
  expect(input.execution.send).toHaveBeenCalledTimes(1)
  expect(input.execution.acquireWebsite).not.toHaveBeenCalled()
  expect(input.context.publicResearchMaySave).toBeUndefined()
})

test('a cancelled or stale Run cannot dispatch the next website', async () => {
  const input = create(); input.assertActive.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('synthetic no longer active'))
  await expect(executePublicResearchOperations(input)).rejects.toThrow('synthetic no longer active')
  expect(input.complete).toHaveBeenCalledTimes(1)
  expect(input.execution.acquireWebsite).not.toHaveBeenCalled()
})

test('missing credentials fail before reservation or sending', async () => {
  const input = create(); input.execution.resolveCredential.mockImplementation(() => { throw new Error('synthetic unavailable') })
  await expect(executePublicResearchOperations(input)).rejects.toThrow('synthetic unavailable')
  expect(input.reserve).not.toHaveBeenCalled()
  expect(input.execution.send).not.toHaveBeenCalled()
})

test('an observed failed website body remains private and cannot become a capture', async () => {
  const input = create({ acquireWebsite: async () => { throw Object.assign(new Error('private body failure'), { transportReceipt: {
    httpStatus: 404, responseText: 'not found', responseTextHash: sourceEvidenceHash('not found'), bytesRead: 9,
    transportOutcome: 'COMPLETE', bodyComplete: true } }) } })
  await executePublicResearchOperations(input)
  expect(input.context.publicResearchMaySave).toBe(false)
  expect(input.complete.mock.calls[1][1]).toMatchObject({ outcome: 'UNKNOWN', receipt: { httpStatus: 404, responseText: 'not found' } })
  expect(input.complete.mock.calls[1][1].capture).toBeUndefined()
})

test('a real website reader timeout records its partial receipt and stops without saving', async () => {
  const originalFetch = globalThis.fetch, originalDns = globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__
  const prefix = '<html><p>Incomplete synthetic original'
  globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
  globalThis.fetch = jest.fn(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(prefix)) },
  }), { headers: { 'content-type': 'text/html' } }))
  const input = create({ settings: { sources: ['WEBSITE'] }, policy: { selectedCategories: ['WEBSITE'],
    limits: { maxElapsedMs: 10000, maxRequestMs: 100, maxTotalBytes: 20000, maxJsonBytes: 16384, maxPageBytes: 1000, maxPages: 1 } },
  acquireWebsite: acquireWebsiteDiscoveryEvidence })
  try {
    await executePublicResearchOperations(input)
    expect(input.complete).toHaveBeenCalledTimes(1)
    expect(input.complete.mock.calls[0][1]).toMatchObject({ outcome: 'UNKNOWN', receipt: { httpStatus: 200,
      responseText: prefix, responseTextHash: sourceEvidenceHash(prefix), bytesRead: Buffer.byteLength(prefix),
      bodyComplete: false, transportOutcome: 'TIMEOUT' } })
    expect(input.complete.mock.calls[0][1].capture).toBeUndefined()
    expect(input.context.publicResearchMaySave).toBe(false)
    expect(input.context.publicResearchCaptures.size).toBe(0)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(input.execution.send).not.toHaveBeenCalled()
    expect(input.execution.resolveCredential).not.toHaveBeenCalled()
  } finally {
    globalThis.fetch = originalFetch
    globalThis.__STORYLINEOS_DISCOVERY_DNS_LOOKUP__ = originalDns
  }
})

test('search-only execution saves receipts without original candidates', async () => {
  const input = create({ settings: { sources: ['SEARCH'] }, policy: { selectedCategories: ['SEARCH'] } })
  await executePublicResearchOperations(input)
  expect(input.execution.acquireWebsite).not.toHaveBeenCalled()
  expect(input.context.publicResearchMaySave).toBe(false)
  expect(input.context.row.publicResearch.operations).toHaveLength(1)
})

test('elapsed deadline remains enforced after operation completion and before save', async () => {
  const input = create()
  await executePublicResearchOperations(input)
  input.execution.plan.limits.maxElapsedMs = 1
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(() => input.context.assertPublicResearchDeadline()).toThrow(expect.objectContaining({ details: { reason: 'PUBLIC_RESEARCH_LIMIT_EXCEEDED' } }))
})

test.each(['SEARCH', 'WEBSITE'])('exhausted %s reservation records a no-send failure and stops', async category => {
  const input = create({ settings: { sources: [category] }, policy: { selectedCategories: [category] } })
  let elapsed = 0
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => elapsed)
  const reserve = input.reserve.getMockImplementation()
  input.reserve.mockImplementation(async value => {
    const operation = await reserve(value)
    elapsed = input.execution.plan.limits.maxElapsedMs + 1
    return operation
  })
  try {
    await expect(executePublicResearchOperations(input)).rejects.toMatchObject({ details: { reason: 'PUBLIC_RESEARCH_LIMIT_EXCEEDED' } })
    expect(input.reserve).toHaveBeenCalledTimes(1)
    expect(input.complete).toHaveBeenCalledTimes(1)
    expect(input.complete).toHaveBeenCalledWith(0, {
      outcome: 'FAILED', failureReason: 'PUBLIC_RESEARCH_LIMIT_EXCEEDED', receipt: null,
    })
    expect(input.context.row.publicResearch.operations[0]).toMatchObject({ phase: 'RECORDED', outcome: 'FAILED', receipt: null })
    expect(input.execution.send).not.toHaveBeenCalled()
    expect(input.execution.acquireWebsite).not.toHaveBeenCalled()
    expect(input.context.publicResearchMaySave).toBeUndefined()
  } finally { clock.mockRestore() }
})

test.each(['elapsed', 'approval'])('JSON and original-page timeouts use the %s budget remaining after each durable reservation', async kind => {
  const input = create()
  const now = Date.now()
  input.execution.plan.limits.maxElapsedMs = kind === 'elapsed' ? 1000 : 10000
  if (kind === 'approval') input.execution.plan.expiresAt = new Date(now + 1000).toISOString()
  let elapsed = 0
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => kind === 'elapsed' ? elapsed : 0)
  const wallClock = jest.spyOn(Date, 'now').mockImplementation(() => now + (kind === 'approval' ? elapsed : 0))
  const timers = jest.spyOn(globalThis, 'setTimeout')
  const reserve = input.reserve.getMockImplementation()
  input.reserve.mockImplementation(async value => {
    const operation = await reserve(value)
    elapsed += value.category === 'SEARCH' ? 700 : 100
    return operation
  })
  try {
    await executePublicResearchOperations(input)
    expect(timers.mock.calls.map(call => call[1])).toEqual([300])
    expect(input.execution.acquireWebsite).toHaveBeenCalledWith(expect.objectContaining({
      researchTransport: { maxResponseBytes: 1000, timeoutMs: 200 },
    }))
    expect(input.execution.send).toHaveBeenCalledTimes(1)
    expect(input.execution.acquireWebsite).toHaveBeenCalledTimes(1)
  } finally { timers.mockRestore(); wallClock.mockRestore(); clock.mockRestore() }
})

test('approval expiring during reservation cannot dispatch an original website', async () => {
  const now = Date.now(), input = create({ settings: { sources: ['WEBSITE'] }, policy: { selectedCategories: ['WEBSITE'] } })
  input.execution.plan.expiresAt = new Date(now + 1000).toISOString()
  let elapsed = 0
  const clock = jest.spyOn(performance, 'now').mockReturnValue(0)
  const wallClock = jest.spyOn(Date, 'now').mockImplementation(() => now + elapsed)
  const reserve = input.reserve.getMockImplementation()
  input.reserve.mockImplementation(async value => { const operation = await reserve(value); elapsed = 1001; return operation })
  try {
    await expect(executePublicResearchOperations(input)).rejects.toMatchObject({ details: { reason: 'PUBLIC_RESEARCH_POLICY_EXPIRED' } })
    expect(input.complete).toHaveBeenCalledTimes(1)
    expect(input.complete).toHaveBeenCalledWith(0, { outcome: 'FAILED', failureReason: 'PUBLIC_RESEARCH_POLICY_EXPIRED', receipt: null })
    expect(input.execution.send).not.toHaveBeenCalled()
    expect(input.execution.acquireWebsite).not.toHaveBeenCalled()
  } finally { wallClock.mockRestore(); clock.mockRestore() }
})
