import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals'
import crypto from 'node:crypto'
import { Redis } from 'ioredis'

const uri = process.env.VMF_REDIS_TEST_URI
if (uri) {
  let valid = false
  try {
    const target = new URL(uri)
    valid = ['redis:', 'rediss:'].includes(target.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
  } catch { /* A configured but invalid integration target must fail. */ }
  if (!valid) throw new Error('VMF_REDIS_TEST_URI must identify a loopback Redis test service')
}

const redisTests = uri ? describe : describe.skip

redisTests('real Redis rate storage (requires VMF_REDIS_TEST_URI)', () => {
  const runNamespace = `review-test-${crypto.randomUUID()}`
  const clients = []
  const stores = []
  const ownedKeys = new Set()
  let SharedRateLimitStore, clientIndex = 0

  const makeStore = (suffix, windowMs = 60000) => {
    const store = new SharedRateLimitStore(`${runNamespace}:${suffix}`)
    store.init({ windowMs })
    stores.push(store)
    return store
  }
  const own = (store, key) => {
    ownedKeys.add(store.key(key))
    return key
  }

  beforeAll(async () => {
    // Both clients connect only to the explicitly opted-in loopback target.
    for (let index = 0; index < 2; index += 1) {
      const client = new Redis(uri, { lazyConnect: true, maxRetriesPerRequest: 1,
        connectTimeout: 2000, retryStrategy: () => null })
      client.on('error', () => {}) // Fail through awaited operations without printing URI details.
      clients.push(client)
      await client.connect()
    }
    await jest.unstable_mockModule('../config/redis.js', () => ({
      getRedis: () => clients[clientIndex++ % clients.length],
    }))
    ;({ SharedRateLimitStore } = await import('../services/rateLimitStore.js'))
  })

  afterAll(async () => {
    for (const store of stores) store.shutdown()
    try {
      // Never scan, FLUSHDB or delete a key outside this run's exact owned list.
      if (ownedKeys.size && clients[0]?.status === 'ready') {
        await clients[0].del(...ownedKeys)
      }
    } finally {
      for (const client of clients) client.disconnect()
    }
  })

  test('concurrent clients and Store instances share unique atomic counts and a fixed TTL', async () => {
    const first = makeStore('concurrent'), second = makeStore('concurrent')
    const key = own(first, 'synthetic-user')
    const results = await Promise.all(Array.from({ length: 100 }, (_, index) =>
      (index % 2 ? first : second).increment(key)))
    expect(results.map(result => result.totalHits).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 100 }, (_, index) => index + 1))
    const remaining = await clients[0].pttl(first.key(key))
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(60000)
    expect(Number(await clients[0].get(first.key(key)))).toBe(100)
    for (const result of results) expect(Number.isFinite(result.resetTime.getTime())).toBe(true)
    // Shorten the TTL deterministically; another increment must not renew it.
    await clients[0].pexpire(first.key(key), 5000)
    expect((await second.increment(key)).totalHits).toBe(101)
    expect(await clients[0].pttl(first.key(key))).toBeLessThanOrEqual(5000)
  })

  test('limiter prefixes isolate buckets and raw identifiers are stored only as hashes', async () => {
    const auth = makeStore('auth'), bulk = makeStore('bulk')
    const rawKey = 'synthetic-user@example.invalid'
    own(auth, rawKey); own(bulk, rawKey)
    expect((await auth.increment(rawKey)).totalHits).toBe(1)
    expect((await auth.increment(rawKey)).totalHits).toBe(2)
    expect((await bulk.increment(rawKey)).totalHits).toBe(1)
    expect(auth.key(rawKey)).not.toBe(bulk.key(rawKey))
    expect(auth.key(rawKey)).not.toContain(rawKey)
    expect(auth.key(rawKey).split(':').at(-1)).toBe(crypto.createHash('sha256').update(rawKey).digest('hex'))
    expect(await clients[0].get(auth.key(rawKey))).toBe('2')
    expect(await clients[0].get(bulk.key(rawKey))).toBe('1')
  })

  test('decrement and reset affect only their bucket and missing decrement creates no immortal key', async () => {
    const store = makeStore('mutations')
    const key = own(store, 'user'), other = own(store, 'other'), absent = own(store, 'absent')
    await store.increment(key); await store.increment(key); await store.increment(other)
    await store.decrement(key)
    expect(await clients[0].get(store.key(key))).toBe('1')
    expect(await clients[0].pttl(store.key(key))).toBeGreaterThan(0)
    await store.decrement(key); await store.decrement(key)
    expect(await clients[0].get(store.key(key))).toBe('0')
    await store.decrement(absent)
    expect(await clients[0].exists(store.key(absent))).toBe(0)
    await store.resetKey(key)
    expect(await clients[0].exists(store.key(key))).toBe(0)
    expect(await clients[0].get(store.key(other))).toBe('1')
    expect((await store.increment(key)).totalHits).toBe(1)
  })

  test('increment repairs an existing counter without expiry', async () => {
    const store = makeStore('missing-expiry')
    const key = own(store, 'legacy-counter')
    await clients[0].set(store.key(key), '4')
    expect(await clients[0].pttl(store.key(key))).toBe(-1)
    expect((await store.increment(key)).totalHits).toBe(5)
    expect(await clients[0].pttl(store.key(key))).toBeGreaterThan(0)
  })
})
