import { afterAll, beforeAll, expect, test } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import AuditLog from '../models/AuditLog.js'
import env from '../config/env.js'

const keyA = 'synthetic-audit-key-a-with-at-least-32-characters'
const keyB = 'synthetic-audit-key-b-with-at-least-32-characters'
let server, original
const fixture = () => ({ actorUserId: new mongoose.Types.ObjectId(), action: 'KEY_ROTATION_TEST',
  resourceType: 'User', resourceId: new mongoose.Types.ObjectId(), summary: 'Synthetic isolated key rotation',
  diff: { nested: {}, retained: { status: 'ACTIVE' } } })

beforeAll(async () => {
  original = { secret: env.auditSignatureSecret, keyring: env.auditSignatureKeyring, active: env.auditSignatureActiveKeyId }
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.14' } })
  const uri = server.getUri('vmf_audit_keys_synthetic')
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) throw new Error('Synthetic loopback database required')
  await mongoose.connect(uri, { autoIndex: false })
  await AuditLog.createCollection()
}, 180000)

afterAll(async () => {
  if (original) {
    env.auditSignatureSecret = original.secret
    env.auditSignatureKeyring = original.keyring
    env.auditSignatureActiveKeyId = original.active
  }
  await mongoose.disconnect()
  if (server) await server.stop()
})

test('persists legacy and rotated keys without modifying earlier records; rejects missing keys before writes', async () => {
  env.auditSignatureSecret = 'synthetic-legacy-audit-key-32-characters'
  env.auditSignatureKeyring = {}; env.auditSignatureActiveKeyId = undefined
  const legacy = await AuditLog.createLog(fixture())
  const originalLegacy = await AuditLog.collection.findOne({ _id: legacy._id })
  expect(originalLegacy).not.toHaveProperty('signatureKeyId')

  env.auditSignatureKeyring = { a: keyA, b: keyB }; env.auditSignatureActiveKeyId = 'a'
  const first = await AuditLog.createLog(fixture())
  const originalFirst = await AuditLog.collection.findOne({ _id: first._id })
  expect(originalFirst.signatureKeyId).toBe('a')
  env.auditSignatureActiveKeyId = 'b'
  const second = await AuditLog.createLog(fixture())

  for (const [record, id] of [[legacy, undefined], [first, 'a'], [second, 'b']]) {
    const loaded = await AuditLog.findById(record._id)
    expect(loaded.signatureKeyId).toBe(id)
    expect(loaded.verifySignature()).toBe(true)
  }
  expect(await AuditLog.collection.findOne({ _id: legacy._id })).toEqual(originalLegacy)
  expect(await AuditLog.collection.findOne({ _id: first._id })).toEqual(originalFirst)
  const count = await AuditLog.countDocuments()
  env.auditSignatureActiveKeyId = 'missing'
  expect(() => AuditLog.createLog(fixture())).toThrow('Audit signing key unavailable')
  expect(await AuditLog.countDocuments()).toBe(count)

  const loadedFirst = await AuditLog.findById(first._id)
  delete env.auditSignatureKeyring.a
  expect(loadedFirst.verifySignature()).toBe(false)
  expect((await AuditLog.findById(second._id)).verifySignature()).toBe(true)
})
