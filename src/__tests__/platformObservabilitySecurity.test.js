import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateEnvironment } from '../config/environmentValidation.js'

describe('strict infrastructure configuration', () => {
  test.each([
    { PORT: '8000typo' }, { PORT: '65536' }, { PORT: '1.2' },
    { REDIS_REQUIRED: 'treu' }, { PERF_CACHE_ENABLED: 'false ' },
    { AUTH_RATE_LIMIT: '0' }, { MONGO_MAX_POOL_SIZE: '-1' },
    { MONGO_MIN_POOL_SIZE: '20', MONGO_MAX_POOL_SIZE: '10' },
    { REDIS_URL: 'https://sensitive-user:sensitive-password@host' },
    { MONGODB_URI: 'http://host/database' }, { NODE_ENV: 'prod' },
  ])('rejects invalid provided config without exposing values: %j', (source) => {
    expect(() => validateEnvironment(source)).toThrow('Invalid environment configuration:')
    try { validateEnvironment(source) } catch (err) {
      expect(err.message).not.toContain('sensitive-password')
    }
  })

  test('preserves defaults, valid replicas, and secret material', () => {
    expect(() => validateEnvironment({})).not.toThrow()
    const config = {
      NODE_ENV: 'production', AUDIT_SIGNATURE_SECRET: '  private-signing-material  ',
      MONGODB_URI: 'mongodb://host1:27017,host2:27017/db?replicaSet=rs',
      REDIS_URL: 'rediss://host:6379', REDIS_REQUIRED: 'true', PORT: '8000',
    }
    expect(() => validateEnvironment(config)).not.toThrow()
    expect(config.AUDIT_SIGNATURE_SECRET).toBe('  private-signing-material  ')
  })

  test('allows legacy test disabling and Mongo zero values but not a zero production rate window', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'test', RATE_LIMIT_WINDOW_MS: '0', MONGO_MIN_POOL_SIZE: '0', MONGO_SOCKET_TIMEOUT_MS: '0' })).not.toThrow()
    expect(() => validateEnvironment({ NODE_ENV: 'development', RATE_LIMIT_WINDOW_MS: '0' })).toThrow('RATE_LIMIT_WINDOW_MS')
  })

  test.each([undefined, '', '   ', 'default-secret-change-in-production'])(
    'rejects insecure audit secret at either production boundary (%p)', (secret) => {
      expect(() => validateEnvironment({ NODE_ENV: 'production', AUDIT_SIGNATURE_SECRET: secret })).toThrow('AUDIT_SIGNATURE_SECRET')
      expect(() => validateEnvironment({ NODE_ENV: 'test', APP_ENV: 'production', AUDIT_SIGNATURE_SECRET: secret })).toThrow('AUDIT_SIGNATURE_SECRET')
    },
  )

  test('actual env import fails before startup for invalid configuration', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vmf-env-check-'))
    try {
      const moduleUrl = new URL('../config/env.js', import.meta.url).href
      const run = (overrides) => spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)})`], {
        cwd, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', ...overrides },
      })
      const missing = run({})
      expect(missing.status).not.toBe(0)
      expect(missing.stderr).toContain('AUDIT_SIGNATURE_SECRET')
      const valid = run({ AUDIT_SIGNATURE_SECRET: 'synthetic-private-audit-key' })
      expect(valid.status).toBe(0)
      const invalid = run({ AUDIT_SIGNATURE_SECRET: 'synthetic-private-audit-key', PORT: '8000oops' })
      expect(invalid.status).not.toBe(0)
      expect(invalid.stderr).toContain('PORT')
      expect(invalid.stderr).not.toContain('synthetic-private-audit-key')
    } finally { rmdirSync(cwd) }
  })
})

let monitoring, auditService, AuditLog, env, serializeRequest, logger
beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'synthetic-test-access-secret'
  process.env.JWT_REFRESH_SECRET = 'synthetic-test-refresh-secret'
  ;({ default: monitoring } = await import('../services/monitoringService.js'))
  ;({ default: auditService } = await import('../services/auditService.js'))
  ;({ default: AuditLog } = await import('../models/AuditLog.js'))
  ;({ default: env } = await import('../config/env.js'))
  ;({ default: logger } = await import('../config/logger.js'))
  ;({ serializeRequest } = await import('../middleware/requestLogger.js'))
})
beforeEach(() => monitoring.resetForTests())
afterEach(() => jest.restoreAllMocks())

test.each([false, true])('audit write failure signals alert while preserving throw policy (%p)', async (throwOnError) => {
  const failure = new Error('synthetic audit unavailable')
  jest.spyOn(AuditLog, 'createLog').mockRejectedValue(failure)
  jest.spyOn(logger, 'error').mockImplementation(() => {})
  const pending = auditService.log({ action: 'CUSTOMER_CREATED', resourceType: 'Customer', resourceId: '607f1f77bcf86cd799439022' }, { throwOnError })
  if (throwOnError) await expect(pending).rejects.toBe(failure)
  else await expect(pending).resolves.toBeNull()
  expect(await monitoring.getMetrics()).toMatch(/audit_write_failures_total\{[^\n]*\} 1/)
  expect(monitoring.getAlertLifecycle({ status: 'active' }).items).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'AUDIT_WRITE_FAILURE', severity: 'critical' }),
  ]))
  const now = Date.now()
  jest.spyOn(Date, 'now').mockReturnValue(now + env.monitoringWindowMs + 1)
  expect(monitoring.getAlertLifecycle({ status: 'active' }).items).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'AUDIT_WRITE_FAILURE' }),
  ]))
  expect(monitoring.getAlertLifecycle({ status: 'resolved' }).items).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'AUDIT_WRITE_FAILURE' }),
  ]))
})

test('successful audit creates no failure alert', async () => {
  jest.spyOn(AuditLog, 'createLog').mockResolvedValue({ id: 'saved-audit' })
  await auditService.log({ action: 'CUSTOMER_CREATED', resourceType: 'Customer' })
  expect(monitoring.getAlertLifecycle({ status: 'active' }).items).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'AUDIT_WRITE_FAILURE' }),
  ]))
})

test('emitted request log strips search data from URL/query/referer without mutating request', async () => {
  const { default: pino } = await import('pino')
  const chunks = []
  const output = pino({ serializers: { req: serializeRequest } }, { write: (chunk) => chunks.push(chunk) })
  const source = {
    method: 'GET', url: '/users?q=private-search-sentinel&page=2',
    query: { q: 'private-search-sentinel', page: '2', pageSize: 'private-page-sentinel', filter: { email: 'private-nested-sentinel' } },
    headers: { referer: 'https://app.example/users?q=private-referrer-sentinel', authorization: 'private-auth-sentinel' },
  }
  output.info({ req: source }, 'request completed')
  const emitted = chunks.join('')
  expect(emitted).not.toMatch(/private-[\w-]+-sentinel/)
  const saved = JSON.parse(emitted)
  expect(saved.req.url).toBe('/users')
  expect(saved.req.query.page).toBe('2')
  expect(saved.req.query.q).toBe('[REDACTED]')
  expect(source.query.q).toBe('private-search-sentinel')
  expect(source.url).toContain('private-search-sentinel')
})
