import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals'

process.env.AUDIT_SIGNATURE_SECRET = 'test-audit-hmac-secret-for-unit-tests'

const RUN_PERSISTENCE_TEST = process.env.RUN_AUDIT_SIGNATURE_PERSISTENCE_TEST === '1'
const describePersistence = RUN_PERSISTENCE_TEST ? describe : describe.skip
const QA_DATABASE_PREFIX = 'vmf_audsig_qa_'

const ACTOR_ID = '507f1f77bcf86cd799439012'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const TENANT_ID = '707f1f77bcf86cd799439033'
const RUNTIME_INSTANCE_ID = 'a27f1f77bcf86cd799439111'

const buildIsolatedUri = () => {
  const configuredUri = process.env.AUDIT_SIGNATURE_PERSISTENCE_URI
    || dotenv.parse(fs.readFileSync(path.resolve(process.cwd(), '.env'))).MONGODB_URI
  if (!configuredUri) throw new Error('An isolated audit signature persistence URI is required.')

  const uri = new URL(configuredUri)
  const databaseName = `${QA_DATABASE_PREFIX}${process.pid.toString(36)}_${Date.now().toString(36)}`
  uri.pathname = `/${databaseName}`
  return { databaseName, uri: uri.toString() }
}

describePersistence('AuditLog signature persistence - isolated MongoDB', () => {
  let AuditLog
  let isolatedDatabaseName

  beforeAll(async () => {
    const connection = buildIsolatedUri()
    isolatedDatabaseName = connection.databaseName

    await mongoose.connect(connection.uri, {
      autoIndex: true,
      serverSelectionTimeoutMS: 10000,
    })
    AuditLog = (await import('../models/AuditLog.js')).default
    await AuditLog.init()
  }, 30000)

  afterAll(async () => {
    if (mongoose.connection.readyState === 0) return

    const connectedDatabaseName = mongoose.connection.name
    if (
      connectedDatabaseName !== isolatedDatabaseName
      || !connectedDatabaseName.startsWith(QA_DATABASE_PREFIX)
    ) {
      await mongoose.disconnect()
      throw new Error(`Refusing to drop non-isolated database: ${connectedDatabaseName}`)
    }

    try {
      await mongoose.connection.dropDatabase()
    } finally {
      await mongoose.disconnect()
    }
  }, 30000)

  test('persists and reloads a current-version Runtime Action signature after empty-object minimization', async () => {
    const created = await AuditLog.createLog({
      ts: new Date('2026-04-05T06:07:08.009Z'),
      actorUserId: ACTOR_ID,
      action: 'RUNTIME_ACTION_EXECUTED',
      resourceType: 'RuntimeInstance',
      resourceId: RUNTIME_INSTANCE_ID,
      summary: 'Isolated Runtime Action signature QA',
      display: {
        actorLabel: 'Runtime Auditor QA',
        permissionLabels: [],
      },
      scope: {
        customerId: CUSTOMER_ID,
        tenantId: TENANT_ID,
        runtimeInstanceId: RUNTIME_INSTANCE_ID,
        runtimeInstanceKey: 'value-narrative-signature-persistence-qa',
      },
      diff: {
        actionKey: 'REGENERATE_SECTION',
        governedAction: 'REGENERATE_SECTION',
        executionStatus: { from: 'IDLE', to: 'IDLE' },
        runtimeStatus: { from: 'ACTIVE', to: 'ACTIVE' },
        lock: {
          from: { lockedAt: null, state: {} },
          to: { lockedAt: null, state: {} },
        },
        publish: { from: {}, to: {} },
        lifecycle: { from: { stage: 'DRAFT' }, to: { stage: 'DRAFT' } },
        readiness: { from: { state: 'DRAFT' }, to: { state: 'DRAFT' } },
        generation: {
          sectionKey: 'current-state-assessment',
          regeneration: { reasons: ['FORCED_REGENERATE_REASON'] },
        },
        actionedAt: '2026-04-05T06:07:08.009Z',
      },
    })

    expect(created.signatureVersion).toBe(3)

    const raw = await mongoose.connection.db.collection('auditlogs').findOne({ _id: created._id })
    expect(raw.diff.publish).toBeUndefined()
    expect(raw.diff.lock.from.state).toBeUndefined()

    const reloaded = await AuditLog.findById(created._id)
    expect(reloaded.verifySignature()).toBe(true)

    reloaded.diff.generation.sectionKey = 'tampered-section'
    expect(reloaded.verifySignature()).toBe(false)
  })

  test('verifies a fixed legacy Runtime Action signature after an actual raw persistence round trip', async () => {
    const legacyId = new mongoose.Types.ObjectId()
    await mongoose.connection.db.collection('auditlogs').insertOne({
      _id: legacyId,
      ts: new Date('2026-03-04T05:07:08.010Z'),
      actorUserId: new mongoose.Types.ObjectId(ACTOR_ID),
      action: 'RUNTIME_ACTION_EXECUTED',
      resourceType: 'RuntimeInstance',
      resourceId: new mongoose.Types.ObjectId(RUNTIME_INSTANCE_ID),
      summary: 'Fixed legacy Runtime Action fixture',
      display: {
        actorLabel: 'Runtime Auditor QA',
        permissionLabels: [],
      },
      scope: {
        customerId: new mongoose.Types.ObjectId(CUSTOMER_ID),
        tenantId: new mongoose.Types.ObjectId(TENANT_ID),
        runtimeInstanceId: new mongoose.Types.ObjectId(RUNTIME_INSTANCE_ID),
        runtimeInstanceKey: 'value-narrative-signature-qa',
      },
      diff: {
        actionKey: 'REGENERATE_SECTION',
        governedAction: 'REGENERATE_SECTION',
        policyKey: 'regenerate-section-gate',
        expectedUpdatedAt: '2026-03-04T05:06:07.008Z',
        updatedAtBefore: '2026-03-04T05:06:07.008Z',
        updatedAtAfter: '2026-03-04T05:07:08.009Z',
        runtimeType: 'VALUE_NARRATIVE',
        frameworkKey: 'VMF',
        packageKey: 'vmf-signature-qa',
        packageVersion: '3.1.3',
        executionStatus: { from: 'IDLE', to: 'IDLE' },
        runtimeStatus: { from: 'ACTIVE', to: 'ACTIVE' },
        lock: {
          from: { lockedAt: null },
          to: { lockedAt: null },
        },
        lifecycle: { from: { stage: 'DRAFT' }, to: { stage: 'DRAFT' } },
        readiness: { from: { state: 'DRAFT' }, to: { state: 'DRAFT' } },
        generation: {
          sectionKey: 'current-state-assessment',
          regeneration: { reasons: ['FORCED_REGENERATE_REASON'] },
        },
        actionedAt: '2026-03-04T05:07:08.009Z',
      },
      ip: '127.0.0.3',
      userAgent: 'fixed-runtime-action-fixture',
      requestId: 'fixed-runtime-action-request',
      auditSchemaVersion: 1,
      signatureVersion: 1,
      actorType: 'USER',
      isSystemEvent: false,
      signature: '587a71ec7733c97f923275e922cb3f1374f3c95394f4302adcedfaaa32cc0db7',
    })

    const reloaded = await AuditLog.findById(legacyId)
    expect(reloaded.verifySignature()).toBe(true)
  })
})
