import { afterEach, beforeAll, beforeEach, expect, test } from '@jest/globals'
import { parseAuditSigningConfig } from '../config/auditSigningConfig.js'
import { validateEnvironment } from '../config/environmentValidation.js'

const secret = 'synthetic-legacy-audit-key-32-characters'
const keyA = 'synthetic-audit-key-a-with-at-least-32-characters'
const keyB = 'synthetic-audit-key-b-with-at-least-32-characters'
const fixture = signatureVersion => ({
  ts: new Date('2026-09-15T00:00:00.000Z'), actorUserId: '507f1f77bcf86cd799439011',
  action: 'KEY_ROTATION_TEST', resourceType: 'User', resourceId: '507f1f77bcf86cd799439012',
  summary: 'Synthetic audit key rotation', signatureVersion,
})
let AuditLog, env, original
beforeAll(async () => {
  env = (await import('../config/env.js')).default
  AuditLog = (await import('../models/AuditLog.js')).default
  original = { secret: env.auditSignatureSecret, keyring: env.auditSignatureKeyring, active: env.auditSignatureActiveKeyId }
})
beforeEach(() => {
  env.auditSignatureSecret = secret
  env.auditSignatureKeyring = {}
  env.auditSignatureActiveKeyId = undefined
})
afterEach(() => {
  env.auditSignatureSecret = original.secret
  env.auditSignatureKeyring = original.keyring
  env.auditSignatureActiveKeyId = original.active
})

// Captured from the unmodified model before adding key IDs, not recomputed by the new signer.
test.each([
  [1, 'f7698d6178bd41818e41870e51fc26d55e5d42badf8d1e3fa44f7d7edf8d8ed3'],
  [2, '2bbe6a6deafaf9ddbdf15f1e2598374a9183fa1e6b071baa010ec526ad56d820'],
  [3, '45c5b891f58bbc45c4a6a3466433737bbb09c4bda8fd25c695fc3c794622ac8f'],
])('unkeyed version %i retains its exact pre-change signature', (version, signature) => {
  const log = new AuditLog(fixture(version))
  log.generateSignature()
  expect(log.signatureKeyId).toBeUndefined()
  expect(log.signature).toBe(signature)
  expect(log.verifySignature()).toBe(true)
  const existing = AuditLog.hydrate({ ...log.toObject(), signature })
  env.auditSignatureKeyring = { a: keyA }; env.auditSignatureActiveKeyId = 'a'
  expect(existing.verifySignature()).toBe(true)
  existing.generateSignature()
  expect(existing.signatureKeyId).toBeUndefined()
  expect(existing.signature).toBe(signature)
})

test('rotation signs new records with the active key while existing named keys still verify', () => {
  env.auditSignatureKeyring = { a: keyA, b: keyB }; env.auditSignatureActiveKeyId = 'a'
  const first = new AuditLog(fixture(3)); first.generateSignature()
  env.auditSignatureActiveKeyId = 'b'
  const second = new AuditLog(fixture(3)); second.generateSignature()
  expect(first.signatureKeyId).toBe('a'); expect(second.signatureKeyId).toBe('b')
  expect(first.verifySignature()).toBe(true); expect(second.verifySignature()).toBe(true)
  const existing = AuditLog.hydrate(first.toObject())
  existing.generateSignature()
  expect(existing.signatureKeyId).toBe('a')
  expect(existing.signature).toBe(first.signature)
  delete env.auditSignatureKeyring.a
  expect(first.verifySignature()).toBe(false)
  expect(() => existing.generateSignature()).toThrow('Audit signing key unavailable')
  expect(second.verifySignature()).toBe(true)
})

test.each([1, 2, 3])('version %i authenticates the key ID even when keys share the same secret', version => {
  env.auditSignatureKeyring = { a: secret, b: secret }; env.auditSignatureActiveKeyId = 'a'
  const log = new AuditLog(fixture(version)); log.generateSignature()
  log.signatureKeyId = 'b'; expect(log.verifySignature()).toBe(false)
  log.signatureKeyId = undefined; expect(log.verifySignature()).toBe(false)
  log.signatureKeyId = 'a'; expect(log.verifySignature()).toBe(true)
})

test.each(['missing', 'constructor', '__proto__', null, ''])('unknown or invalid key ID %s fails closed', id => {
  const log = new AuditLog({ ...fixture(3), signatureKeyId: id, signature: 'invalid' })
  expect(log.verifySignature()).toBe(false)
  expect(() => log.generateSignature()).toThrow('Audit signing key unavailable')
})

test('keyring-only configuration preserves legacy new signing and supports old keyed verification', () => {
  const parsed = parseAuditSigningConfig({ AUDIT_SIGNATURE_KEYRING: JSON.stringify({ a: keyA }) })
  expect(parsed.activeKeyId).toBeUndefined()
  env.auditSignatureKeyring = parsed.keyring
  const log = new AuditLog(fixture(3)); log.generateSignature()
  expect(log.signatureKeyId).toBeUndefined()
  expect(log.verifySignature()).toBe(true)
})

test.each(['not-json-private-secret', 'null', '[]', '"private-secret"', '{"a":"short-private-secret"}', '{"bad key":"private-secret"}'])(
  'invalid keyring is rejected without revealing its contents', raw => {
    expect(() => parseAuditSigningConfig({ AUDIT_SIGNATURE_KEYRING: raw }))
      .toThrow('Invalid environment configuration: AUDIT_SIGNATURE_KEYRING')
    try { parseAuditSigningConfig({ AUDIT_SIGNATURE_KEYRING: raw }) } catch (error) {
      expect(error.message).not.toContain('private-secret')
    }
  },
)

test.each(['missing', 'constructor', 'bad id', 'x'.repeat(65)])('active key %s must resolve exactly to a configured key', active => {
  expect(() => validateEnvironment({ NODE_ENV: 'test',
    AUDIT_SIGNATURE_KEYRING: JSON.stringify({ a: keyA }), AUDIT_SIGNATURE_ACTIVE_KEY_ID: active }))
    .toThrow('Invalid environment configuration: AUDIT_SIGNATURE_ACTIVE_KEY_ID')
})

test('keyring configuration does not waive the production legacy-secret requirement', () => {
  expect(() => validateEnvironment({ NODE_ENV: 'production',
    AUDIT_SIGNATURE_KEYRING: JSON.stringify({ a: keyA }), AUDIT_SIGNATURE_ACTIVE_KEY_ID: 'a' }))
    .toThrow('AUDIT_SIGNATURE_SECRET')
})

test.each([{ NODE_ENV: 'production' }, { APP_ENV: 'production' }])('explicit historical default is verification-only with an active private key: %j', production => {
  const legacySecret = 'default-secret-change-in-production'
  const configured = { ...production, AUDIT_SIGNATURE_SECRET: legacySecret,
    AUDIT_SIGNATURE_KEYRING: JSON.stringify({ a: keyA }), AUDIT_SIGNATURE_ACTIVE_KEY_ID: 'a' }
  expect(() => validateEnvironment(configured)).not.toThrow()
  for (const invalid of [undefined, '', ' ', ` ${legacySecret} `]) {
    expect(() => validateEnvironment({ ...configured, AUDIT_SIGNATURE_SECRET: invalid })).toThrow('AUDIT_SIGNATURE_SECRET')
  }
  expect(() => validateEnvironment({ ...configured, AUDIT_SIGNATURE_ACTIVE_KEY_ID: undefined })).toThrow('AUDIT_SIGNATURE_SECRET')
  expect(() => validateEnvironment({ ...configured, AUDIT_SIGNATURE_ACTIVE_KEY_ID: 'missing' })).toThrow('AUDIT_SIGNATURE_ACTIVE_KEY_ID')
})

test.each(['default-secret-change-in-production', ' default-secret-change-in-production '])('public default cannot be a named signing key', value => {
  expect(() => parseAuditSigningConfig({ AUDIT_SIGNATURE_KEYRING: JSON.stringify({ a: keyA, old: value }),
    AUDIT_SIGNATURE_ACTIVE_KEY_ID: 'a' })).toThrow('AUDIT_SIGNATURE_KEYRING')
})

test.each([1, 2, 3])('historical default version %i still verifies while new records use a private key', version => {
  env.auditSignatureSecret = 'default-secret-change-in-production'
  const originalLog = new AuditLog(fixture(version)); originalLog.generateSignature()
  const historical = AuditLog.hydrate(originalLog.toObject())
  const originalSignature = historical.signature
  env.auditSignatureKeyring = { a: keyA }; env.auditSignatureActiveKeyId = 'a'
  expect(historical.verifySignature()).toBe(true)
  expect(historical.signature).toBe(originalSignature)
  const nextLog = new AuditLog(fixture(version)); nextLog.generateSignature()
  expect(nextLog.signatureKeyId).toBe('a')
  expect(nextLog.verifySignature()).toBe(true)
  env.auditSignatureKeyring = { a: env.auditSignatureSecret }
  expect(nextLog.verifySignature()).toBe(false)
  expect(historical.verifySignature()).toBe(true)
})
