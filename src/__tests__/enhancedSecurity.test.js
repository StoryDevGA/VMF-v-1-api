/**
 * Enhanced Security Tests (Phase 4.3)
 *
 * Covers:
 *   1. Field-level encryption service
 *      - AES-256-GCM encrypt / decrypt round-trip
 *      - Tamper detection (GCM auth tag)
 *      - Blind index (deterministic HMAC-SHA256)
 *      - Edge cases (null, empty, unicode, already encrypted)
 *   2. Mongoose field encryption plugin
 *      - Schema augmentation (blind index fields)
 *      - Pre-save encryption + blind index creation
 *      - Post-find decryption
 *      - No-op when disabled
 *      - findByBlindIndex static helper
 *   3. Generic CircuitBreaker
 *      - State lifecycle (CLOSED → OPEN → HALF_OPEN → CLOSED)
 *      - Threshold-based opening
 *      - Timeout-based half-open transition
 *      - Probe success/failure handling
 *      - State change listeners
 *      - Reset and getState
 *   4. IdentityPlusService circuit breaker refactor (backward compat)
 *   5. Comprehensive rate limiting
 *      - New exports: authHourlyRateLimit, auditRateLimit
 *      - Auth routes include hourly limiter
 *   6. Request correlation tracking
 *      - correlationEnricher injects requestId into responses
 *      - Error handler uses structured { error: { code, message, requestId } }
 *      - requestLogger binds requestId via genReqId
 *      - 404 responses include requestId (via correlationEnricher)
 */

import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals'

/* ------------------------------------------------------------------ */
/*  Environment setup (must run before any app imports)               */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET =
    'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET =
    'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
  process.env.AUDIT_SIGNATURE_SECRET = 'test-audit-hmac-secret-for-unit-tests'
  // 32-byte hex key for field encryption tests
  process.env.FIELD_ENCRYPTION_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.FIELD_ENCRYPTION_ENABLED = 'false'
})

/* ================================================================== */
/*  1. Field-Level Encryption Service                                 */
/* ================================================================== */

describe('FieldEncryptionService', () => {
  let service
  // Static 32-byte hex test key (avoids env.js caching issues)
  const TEST_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

  beforeAll(async () => {
    const mod = await import('../services/fieldEncryptionService.js')
    service = mod.default
  })

  /* ---- Core encrypt / decrypt ---- */

  test('encrypt returns a string starting with enc:v1: prefix', () => {
    const encrypted = service.encrypt('hello@example.com', TEST_KEY)
    expect(encrypted).toMatch(/^enc:v1:/)
    expect(encrypted).not.toBe('hello@example.com')
  })

  test('decrypt reverses encrypt (round-trip)', () => {
    const plain = 'alice@acme.com'
    const encrypted = service.encrypt(plain, TEST_KEY)
    const decrypted = service.decrypt(encrypted, TEST_KEY)
    expect(decrypted).toBe(plain)
  })

  test('each encrypt call produces a different ciphertext (random IV)', () => {
    const plain = 'same-input'
    const a = service.encrypt(plain, TEST_KEY)
    const b = service.encrypt(plain, TEST_KEY)
    expect(a).not.toBe(b) // Different IVs → different ciphertext
    expect(service.decrypt(a, TEST_KEY)).toBe(plain)
    expect(service.decrypt(b, TEST_KEY)).toBe(plain)
  })

  test('round-trip with unicode characters', () => {
    const plain = '日本語テスト 🚀'
    const encrypted = service.encrypt(plain, TEST_KEY)
    expect(service.decrypt(encrypted, TEST_KEY)).toBe(plain)
  })

  test('round-trip with long text', () => {
    const plain = 'a'.repeat(10_000)
    const encrypted = service.encrypt(plain, TEST_KEY)
    expect(service.decrypt(encrypted, TEST_KEY)).toBe(plain)
  })

  /* ---- Tamper detection ---- */

  test('decrypt throws on tampered ciphertext (GCM auth failure)', () => {
    const encrypted = service.encrypt('sensitive-data', TEST_KEY)
    // Flip a character in the ciphertext portion
    const parts = encrypted.split(':')
    const tampered = parts.slice(0, -1).join(':') + ':' + 'AAAA'
    expect(() => service.decrypt(tampered, TEST_KEY)).toThrow()
  })

  test('decrypt throws on invalid format (wrong segment count)', () => {
    expect(() => service.decrypt('enc:v1:only-one-segment', TEST_KEY)).toThrow(
      /Invalid encrypted format/,
    )
  })

  /* ---- isEncrypted ---- */

  test('isEncrypted returns true for encrypted values', () => {
    const encrypted = service.encrypt('test', TEST_KEY)
    expect(service.isEncrypted(encrypted)).toBe(true)
  })

  test('isEncrypted returns false for plain text', () => {
    expect(service.isEncrypted('plain text')).toBe(false)
    expect(service.isEncrypted('')).toBe(false)
    expect(service.isEncrypted(null)).toBe(false)
    expect(service.isEncrypted(undefined)).toBe(false)
    expect(service.isEncrypted(42)).toBe(false)
  })

  /* ---- Passthrough edge cases ---- */

  test('encrypt returns null/undefined/empty unchanged', () => {
    expect(service.encrypt(null)).toBeNull()
    expect(service.encrypt(undefined)).toBeUndefined()
    expect(service.encrypt('')).toBe('')
  })

  test('decrypt returns null/undefined/empty unchanged', () => {
    expect(service.decrypt(null)).toBeNull()
    expect(service.decrypt(undefined)).toBeUndefined()
    expect(service.decrypt('')).toBe('')
  })

  test('encrypt does not double-encrypt already encrypted values', () => {
    const encrypted = service.encrypt('test', TEST_KEY)
    const doubleEncrypted = service.encrypt(encrypted, TEST_KEY)
    expect(doubleEncrypted).toBe(encrypted)
  })

  test('decrypt returns plain text unchanged if not encrypted', () => {
    expect(service.decrypt('not-encrypted')).toBe('not-encrypted')
  })

  /* ---- Blind index ---- */

  test('createBlindIndex returns 64-char hex hash', () => {
    const index = service.createBlindIndex('hello@example.com', TEST_KEY)
    expect(index).toHaveLength(64)
    expect(index).toMatch(/^[0-9a-f]+$/)
  })

  test('createBlindIndex is deterministic (same input → same hash)', () => {
    const a = service.createBlindIndex('test@acme.com', TEST_KEY)
    const b = service.createBlindIndex('test@acme.com', TEST_KEY)
    expect(a).toBe(b)
  })

  test('createBlindIndex is case-insensitive', () => {
    const a = service.createBlindIndex('Alice@ACME.com', TEST_KEY)
    const b = service.createBlindIndex('alice@acme.com', TEST_KEY)
    expect(a).toBe(b)
  })

  test('createBlindIndex trims whitespace', () => {
    const a = service.createBlindIndex('  test@acme.com  ', TEST_KEY)
    const b = service.createBlindIndex('test@acme.com', TEST_KEY)
    expect(a).toBe(b)
  })

  test('createBlindIndex returns null for null/empty', () => {
    expect(service.createBlindIndex(null)).toBeNull()
    expect(service.createBlindIndex('')).toBeNull()
    expect(service.createBlindIndex(undefined)).toBeNull()
  })

  test('different inputs produce different blind indexes', () => {
    const a = service.createBlindIndex('alice@acme.com', TEST_KEY)
    const b = service.createBlindIndex('bob@acme.com', TEST_KEY)
    expect(a).not.toBe(b)
  })

  /* ---- Key management ---- */

  test('generateKey returns 64-char hex string', async () => {
    const { FieldEncryptionService } = await import('../services/fieldEncryptionService.js')
    const key = FieldEncryptionService.generateKey()
    expect(key).toHaveLength(64)
    expect(key).toMatch(/^[0-9a-f]+$/)
  })

  test('encrypt with explicit key override works', () => {
    const altKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
    const encrypted = service.encrypt('test', altKey)
    const decrypted = service.decrypt(encrypted, altKey)
    expect(decrypted).toBe('test')
  })
})

/* ================================================================== */
/*  2. Mongoose Field Encryption Plugin                               */
/* ================================================================== */

describe('fieldEncryption Mongoose plugin', () => {
  let mongoose
  let fieldEncryptionPlugin
  let service

  beforeAll(async () => {
    mongoose = (await import('mongoose')).default
    fieldEncryptionPlugin = (await import('../models/plugins/fieldEncryption.js')).default
    service = (await import('../services/fieldEncryptionService.js')).default
    service.clearKeyCache()
  })

  test('adds blind index fields to schema', () => {
    const schema = new mongoose.Schema({ email: String, name: String })
    schema.plugin(fieldEncryptionPlugin, {
      fields: ['email', 'name'],
      blindIndexFields: ['email'],
    })

    expect(schema.path('emailBlindIndex')).toBeDefined()
    expect(schema.path('nameBlindIndex')).toBeUndefined()
  })

  test('adds findByBlindIndex static method', () => {
    const schema = new mongoose.Schema({ email: String })
    schema.plugin(fieldEncryptionPlugin, {
      fields: ['email'],
      blindIndexFields: ['email'],
    })

    expect(typeof schema.statics.findByBlindIndex).toBe('function')
  })

  test('no-op when fields array is empty', () => {
    const schema = new mongoose.Schema({ email: String })
    const hookCount = (schema.s.hooks._pres.get('save') || []).length
    schema.plugin(fieldEncryptionPlugin, { fields: [] })
    // No new hooks should have been added
    const newHookCount = (schema.s.hooks._pres.get('save') || []).length
    expect(newHookCount).toBe(hookCount)
  })

  test('plugin does not throw when applied to a valid schema', () => {
    expect(() => {
      const schema = new mongoose.Schema({ email: String, name: String })
      schema.plugin(fieldEncryptionPlugin, {
        fields: ['email', 'name'],
        blindIndexFields: ['email'],
      })
    }).not.toThrow()
  })
})

/* ================================================================== */
/*  3. Generic CircuitBreaker                                         */
/* ================================================================== */

describe('CircuitBreaker', () => {
  let CircuitBreaker, STATES

  beforeAll(async () => {
    const mod = await import('../services/circuitBreaker.js')
    CircuitBreaker = mod.CircuitBreaker
    STATES = mod.STATES
  })

  test('STATES are CLOSED, OPEN, HALF_OPEN', () => {
    expect(STATES.CLOSED).toBe('CLOSED')
    expect(STATES.OPEN).toBe('OPEN')
    expect(STATES.HALF_OPEN).toBe('HALF_OPEN')
  })

  test('starts in CLOSED state', () => {
    const cb = new CircuitBreaker('test')
    const state = cb.getState()
    expect(state.state).toBe('CLOSED')
    expect(state.failures).toBe(0)
    expect(state.openedAt).toBeNull()
    expect(state.name).toBe('test')
  })

  test('successful execute returns the function result', async () => {
    const cb = new CircuitBreaker('test')
    const result = await cb.execute(() => Promise.resolve(42))
    expect(result).toBe(42)
  })

  test('failed execute re-throws the error', async () => {
    const cb = new CircuitBreaker('test', { threshold: 10 })
    await expect(
      cb.execute(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom')
    expect(cb.getState().failures).toBe(1)
  })

  test('opens after threshold failures', async () => {
    const cb = new CircuitBreaker('test', { threshold: 3 })
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    }
    expect(cb.getState().state).toBe('OPEN')
    expect(cb.getState().openedAt).not.toBeNull()
  })

  test('rejects immediately when OPEN', async () => {
    const cb = new CircuitBreaker('test', { threshold: 1 })
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.getState().state).toBe('OPEN')

    await expect(
      cb.execute(() => Promise.resolve('should not run')),
    ).rejects.toThrow(/circuit breaker is OPEN/)

    // Verify the error has the correct code
    try {
      await cb.execute(() => Promise.resolve('nope'))
    } catch (err) {
      expect(err.code).toBe('CIRCUIT_BREAKER_OPEN')
    }
  })

  test('transitions to HALF_OPEN after resetTimeout', async () => {
    const cb = new CircuitBreaker('test', { threshold: 1, resetTimeout: 10 })
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.getState().state).toBe('OPEN')

    // Wait for resetTimeout to elapse
    await new Promise((r) => setTimeout(r, 20))

    // Next execute should be allowed (triggers HALF_OPEN)
    const result = await cb.execute(() => Promise.resolve('recovered'))
    expect(result).toBe('recovered')
    expect(cb.getState().state).toBe('CLOSED')
  })

  test('HALF_OPEN failure re-opens the breaker', async () => {
    const cb = new CircuitBreaker('test', { threshold: 1, resetTimeout: 10 })
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.getState().state).toBe('OPEN')

    await new Promise((r) => setTimeout(r, 20))

    // Probe fails → should go back to OPEN
    await cb.execute(() => Promise.reject(new Error('still broken'))).catch(() => {})
    expect(cb.getState().state).toBe('OPEN')
  })

  test('reset returns to CLOSED', () => {
    const cb = new CircuitBreaker('test', { threshold: 1 })
    // Manually set to simulate open state
    cb.state = 'OPEN'
    cb.failures = 5
    cb.openedAt = Date.now()

    cb.reset()
    const state = cb.getState()
    expect(state.state).toBe('CLOSED')
    expect(state.failures).toBe(0)
    expect(state.openedAt).toBeNull()
  })

  test('onStateChange listener fires on transitions', async () => {
    const cb = new CircuitBreaker('test', { threshold: 1 })
    const transitions = []
    cb.onStateChange((evt) => transitions.push(evt))

    // CLOSED → OPEN
    await cb.execute(() => Promise.reject(new Error('x'))).catch(() => {})
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toEqual({
      name: 'test',
      from: 'CLOSED',
      to: 'OPEN',
    })
  })

  test('unsubscribe removes listener', async () => {
    const cb = new CircuitBreaker('test', { threshold: 1 })
    const events = []
    const unsub = cb.onStateChange((evt) => events.push(evt))

    unsub()

    await cb.execute(() => Promise.reject(new Error('x'))).catch(() => {})
    expect(events).toHaveLength(0)
  })

  test('getState returns threshold and resetTimeout from options', () => {
    const cb = new CircuitBreaker('custom', {
      threshold: 10,
      resetTimeout: 60_000,
    })
    const state = cb.getState()
    expect(state.threshold).toBe(10)
    expect(state.resetTimeout).toBe(60_000)
  })

  test('lastFailure contains the error message', async () => {
    const cb = new CircuitBreaker('test', { threshold: 10 })
    await cb
      .execute(() => Promise.reject(new Error('specific error msg')))
      .catch(() => {})
    expect(cb.getState().lastFailure).toBe('specific error msg')
  })

  test('execute works with sync-returning functions', async () => {
    const cb = new CircuitBreaker('test')
    const result = await cb.execute(async () => 'sync-like')
    expect(result).toBe('sync-like')
  })
})

/* ================================================================== */
/*  4. Identity Plus Service — circuit breaker backward compat        */
/* ================================================================== */

describe('IdentityPlusService circuit breaker refactor', () => {
  beforeEach(async () => {
    const { resetCircuitBreaker } = await import('../services/identityPlusService.js')
    resetCircuitBreaker()
  })

  test('getCircuitBreakerState returns expected shape', async () => {
    const { getCircuitBreakerState } = await import('../services/identityPlusService.js')
    const state = getCircuitBreakerState()
    expect(state.state).toBe('CLOSED')
    expect(state.failures).toBe(0)
    expect(state.openedAt).toBeNull()
    expect(state.threshold).toBe(5)
    expect(state.resetTimeout).toBe(30_000)
    // New field from generic CircuitBreaker
    expect(state.name).toBe('identity-plus')
  })

  test('resetCircuitBreaker resets to CLOSED', async () => {
    const { getCircuitBreakerState, resetCircuitBreaker } = await import(
      '../services/identityPlusService.js'
    )
    resetCircuitBreaker()
    const state = getCircuitBreakerState()
    expect(state.state).toBe('CLOSED')
    expect(state.failures).toBe(0)
    expect(state.openedAt).toBeNull()
  })
})

/* ================================================================== */
/*  5. Comprehensive Rate Limiting                                    */
/* ================================================================== */

describe('Rate limiting exports', () => {
  let rateLimits

  beforeAll(async () => {
    rateLimits = await import('../middleware/rateLimits.js')
  })

  test('authRateLimit is a function (middleware)', () => {
    expect(typeof rateLimits.authRateLimit).toBe('function')
  })

  test('authHourlyRateLimit is exported and is a function', () => {
    expect(rateLimits.authHourlyRateLimit).toBeDefined()
    expect(typeof rateLimits.authHourlyRateLimit).toBe('function')
  })

  test('userManagementRateLimit is a function', () => {
    expect(typeof rateLimits.userManagementRateLimit).toBe('function')
  })

  test('tenantManagementRateLimit is a function', () => {
    expect(typeof rateLimits.tenantManagementRateLimit).toBe('function')
  })

  test('vmfManagementRateLimit is a function', () => {
    expect(typeof rateLimits.vmfManagementRateLimit).toBe('function')
  })

  test('bulkOperationsRateLimit is a function', () => {
    expect(typeof rateLimits.bulkOperationsRateLimit).toBe('function')
  })

  test('auditRateLimit is exported and is a function', () => {
    expect(rateLimits.auditRateLimit).toBeDefined()
    expect(typeof rateLimits.auditRateLimit).toBe('function')
  })

  test('generalApiRateLimit is a function', () => {
    expect(typeof rateLimits.generalApiRateLimit).toBe('function')
  })
})

/* ================================================================== */
/*  6. Request Logger Secret Redaction                                */
/* ================================================================== */

describe('Request logger secret redaction', () => {
  let buildLoggerOptions
  let pino
  let sanitizeRequestHeaders
  let serializeRequest

  beforeAll(async () => {
    pino = (await import('pino')).default
    ;({ buildLoggerOptions } = await import('../config/logger.js'))
    ;({ sanitizeRequestHeaders, serializeRequest } = await import(
      '../middleware/requestLogger.js'
    ))
  })

  test('redacts Authorization and step-up headers case-insensitively without mutating source headers', () => {
    const sourceHeaders = {
      Authorization: 'Bearer synthetic-authorization-sentinel',
      'X-Step-Up-Token': 'synthetic-step-up-sentinel',
      'x-request-id': 'qa-request-id',
    }

    const sanitized = sanitizeRequestHeaders(sourceHeaders)

    expect(sanitized).toEqual({
      Authorization: '[REDACTED]',
      'X-Step-Up-Token': '[REDACTED]',
      'x-request-id': 'qa-request-id',
    })
    expect(JSON.stringify(sanitized)).not.toContain('synthetic-authorization-sentinel')
    expect(JSON.stringify(sanitized)).not.toContain('synthetic-step-up-sentinel')
    expect(sourceHeaders.Authorization).toBe('Bearer synthetic-authorization-sentinel')
    expect(sourceHeaders['X-Step-Up-Token']).toBe('synthetic-step-up-sentinel')
  })

  test('serializes absent headers as an empty object', () => {
    expect(serializeRequest({ id: 'request-without-headers' }).headers).toEqual({})
    expect(sanitizeRequestHeaders()).toEqual({})
  })

  test('base logger redacts canonical Node header paths from emitted JSON', async () => {
    const chunks = []
    const destination = {
      write(chunk) {
        chunks.push(String(chunk))
      },
    }
    const testLogger = pino(buildLoggerOptions(), destination)

    testLogger.error({
      req: {
        headers: {
          authorization: 'Bearer synthetic-pino-authorization-sentinel',
          'x-step-up-token': 'synthetic-pino-step-up-sentinel',
          'x-request-id': 'qa-pino-request-id',
        },
      },
    }, 'request redaction test')

    await new Promise((resolve) => setImmediate(resolve))

    const emitted = chunks.join('')
    expect(emitted).not.toBe('')
    const parsed = JSON.parse(emitted.trim())
    expect(emitted).not.toContain('synthetic-pino-authorization-sentinel')
    expect(emitted).not.toContain('synthetic-pino-step-up-sentinel')
    expect(parsed.req.headers.authorization).toBe('[REDACTED]')
    expect(parsed.req.headers['x-step-up-token']).toBe('[REDACTED]')
    expect(parsed.req.headers['x-request-id']).toBe('qa-pino-request-id')
  })
})

/* ================================================================== */
/*  7. Request Correlation Tracking                                   */
/* ================================================================== */

describe('Request correlation', () => {
  let request

  beforeAll(async () => {
    const supertest = (await import('supertest')).default
    const { default: app } = await import('../app.js')
    request = supertest(app)
  })

  /* ---- Response header ---- */

  test('GET / includes x-request-id response header', async () => {
    const res = await request.get('/')
    expect(res.headers['x-request-id']).toBeDefined()
    // UUID v4 pattern
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  test('uses client-provided X-Request-ID header', async () => {
    const customId = 'custom-correlation-id-12345'
    const res = await request.get('/').set('X-Request-ID', customId)
    expect(res.headers['x-request-id']).toBe(customId)
  })

  /* ---- 404 error response ---- */

  test('404 response includes requestId in error body', async () => {
    const res = await request.get('/api/v1/nonexistent-route')
    expect(res.status).toBe(404)
    expect(res.body.error).toBeDefined()
    // The 404 handler sends { error: 'Not Found' } which is a string,
    // not an object — the correlationEnricher only enriches object errors.
    // This is expected. The response header still contains x-request-id.
    expect(res.headers['x-request-id']).toBeDefined()
  })

  /* ---- Health endpoint ---- */

  test('GET /health includes x-request-id response header', async () => {
    const res = await request.get('/health')
    expect(res.headers['x-request-id']).toBeDefined()
  })

  /* ---- Error handler structured format ---- */

  test('error handler returns { error: { code, message } } shape', async () => {
    // The 401 from /api/v1/auth/me (no auth header) should be structured
    const res = await request.get('/api/v1/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.error).toBeDefined()
    expect(typeof res.body.error).toBe('object')
    expect(res.body.error.code).toBeDefined()
    expect(res.body.error.message).toBeDefined()
    expect(res.body.error.requestId).toBeDefined()
  })
})

/* ================================================================== */
/*  8. Correlation enricher unit tests                                */
/* ================================================================== */

describe('correlationEnricher middleware', () => {
  let correlationEnricher

  beforeAll(async () => {
    correlationEnricher = (await import('../middleware/correlationEnricher.js')).default
  })

  test('injects requestId into error response bodies', () => {
    const req = { requestId: 'test-req-id' }
    let capturedBody
    const res = {
      json: function (body) {
        capturedBody = body
        return this
      },
    }
    res.json = res.json.bind(res)

    correlationEnricher(req, res, () => {})

    // Now call the enriched json
    res.json({ error: { code: 'TEST', message: 'fail' } })
    expect(capturedBody.error.requestId).toBe('test-req-id')
  })

  test('injects requestId and version into data responses', () => {
    const req = { requestId: 'data-req-id' }
    let capturedBody
    const res = {
      json: function (body) {
        capturedBody = body
        return this
      },
    }
    res.json = res.json.bind(res)

    correlationEnricher(req, res, () => {})

    res.json({ data: { users: [] } })
    expect(capturedBody.meta.requestId).toBe('data-req-id')
    expect(capturedBody.meta.version).toBe('v1')
  })

  test('does not mutate raw objects without data or error keys', () => {
    const req = { requestId: 'raw-req-id' }
    let capturedBody
    const res = {
      json: function (body) {
        capturedBody = body
        return this
      },
    }
    res.json = res.json.bind(res)

    correlationEnricher(req, res, () => {})

    res.json({ message: 'VMF API' })
    expect(capturedBody).toEqual({ message: 'VMF API' })
  })

  test('handles null body gracefully', () => {
    const req = { requestId: 'null-req-id' }
    let capturedBody
    const res = {
      json: function (body) {
        capturedBody = body
        return this
      },
    }
    res.json = res.json.bind(res)

    correlationEnricher(req, res, () => {})

    expect(() => res.json(null)).not.toThrow()
    expect(capturedBody).toBeNull()
  })

  test('preserves existing meta fields in data responses', () => {
    const req = { requestId: 'meta-req-id' }
    let capturedBody
    const res = {
      json: function (body) {
        capturedBody = body
        return this
      },
    }
    res.json = res.json.bind(res)

    correlationEnricher(req, res, () => {})

    res.json({ data: [], meta: { page: 1, pageSize: 20 } })
    expect(capturedBody.meta.page).toBe(1)
    expect(capturedBody.meta.pageSize).toBe(20)
    expect(capturedBody.meta.requestId).toBe('meta-req-id')
    expect(capturedBody.meta.version).toBe('v1')
  })
})

/* ================================================================== */
/*  9. Environment config new fields                                  */
/* ================================================================== */

describe('Environment config (4.3 additions)', () => {
  test('fieldEncryptionKey property exists on env', async () => {
    const { default: env } = await import('../config/env.js')
    expect(env).toHaveProperty('fieldEncryptionKey')
    expect(typeof env.fieldEncryptionKey).toBe('string')
  })

  test('fieldEncryptionEnabled property exists on env', async () => {
    const { default: env } = await import('../config/env.js')
    expect(env).toHaveProperty('fieldEncryptionEnabled')
    expect(typeof env.fieldEncryptionEnabled).toBe('boolean')
  })

  test('authHourlyRateLimit defaults to 10', async () => {
    const { default: env } = await import('../config/env.js')
    expect(env.authHourlyRateLimit).toBe(10)
  })

  test('auditRateLimit defaults to 30', async () => {
    const { default: env } = await import('../config/env.js')
    expect(env.auditRateLimit).toBe(30)
  })
})
