import crypto from 'node:crypto'
import { MemoryStore } from 'express-rate-limit'
import { getSecurityRedis } from './securityRedis.js'

// INCR and initial expiry are one operation: no crash can leave an immortal key.
const incrementScript = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
`

const decrementScript = `
local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
if hits > 0 then redis.call('DECR', KEYS[1]) end
return 0
`

export class SharedRateLimitStore {
  constructor(namespace) {
    this.prefix = `rate-limit:${namespace}:`
    this.localKeys = false
    this.memory = new MemoryStore()
  }

  init(options) {
    this.windowMs = options.windowMs
    this.memory.init(options)
  }

  key(key) {
    return this.prefix + crypto.createHash('sha256').update(String(key)).digest('hex')
  }

  async increment(key) {
    const redis = getSecurityRedis()
    if (!redis) return this.memory.increment(key)
    const [hits, ttl] = await redis.eval(incrementScript, 1, this.key(key), this.windowMs)
    const totalHits = Number(hits)
    const remainingMs = Number(ttl)
    if (!Number.isSafeInteger(totalHits) || totalHits < 1
      || !Number.isFinite(remainingMs) || remainingMs < 0) {
      throw new Error('Invalid rate-limit storage response')
    }
    return { totalHits, resetTime: new Date(Date.now() + remainingMs) }
  }

  async decrement(key) {
    const redis = getSecurityRedis()
    if (!redis) return this.memory.decrement(key)
    await redis.eval(decrementScript, 1, this.key(key))
  }

  async resetKey(key) {
    const redis = getSecurityRedis()
    if (!redis) return this.memory.resetKey(key)
    await redis.del(this.key(key))
  }

  shutdown() {
    this.memory.shutdown()
  }
}

export const createRateLimitStore = (namespace) => new SharedRateLimitStore(namespace)
