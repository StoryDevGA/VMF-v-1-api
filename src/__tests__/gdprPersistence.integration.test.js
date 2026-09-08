import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals'

const uri = process.env.GDPR_TEST_MONGODB_URI
const run = uri ? describe : describe.skip
let mongoose, User, Tenant, AuditLog, DataDeletionRequest, service

run('GDPR transactions on a disposable local replica set', () => {
  beforeAll(async () => {
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/ss022_security_[a-z0-9_]+\?replicaSet=ss022_security$/.test(uri)) {
      throw new Error('Only the explicitly named disposable loopback database is allowed')
    }
    process.env.NODE_ENV = 'test'
    process.env.MONGODB_URI = uri
    process.env.JWT_SECRET = 'synthetic-integration-secret-at-least-32-characters'
    process.env.JWT_REFRESH_SECRET = 'synthetic-integration-refresh-secret-at-least-32-characters'
    process.env.AUDIT_SIGNATURE_SECRET = 'synthetic-integration-audit-secret'
    mongoose = (await import('mongoose')).default
    mongoose.set('autoCreate', false)
    mongoose.set('autoIndex', false)
    await mongoose.connect(uri)
    ;({ User, Tenant, AuditLog, DataDeletionRequest } = await import('../models/index.js'))
    service = (await import('../services/gdprService.js')).default
    for (const model of [User, Tenant, AuditLog, DataDeletionRequest]) await model.createCollection()
  }, 30000)

  afterAll(async () => { if (mongoose) await mongoose.disconnect() })

  const fixture = async ({ active = false, tenantStatus = 'DISABLED', remaining = [] } = {}) => {
    const id = () => new mongoose.Types.ObjectId()
    const userId = id(), customerId = id(), reviewer = id(), tenantId = id(), requestId = id(), auditId = id()
    const adminIds = []
    for (const item of remaining) {
      const adminId = id()
      adminIds.push(adminId)
      if (!item.missing) await User.collection.insertOne({
        _id: adminId, email: `${adminId}@example.invalid`, name: 'Synthetic admin',
        isActive: item.active !== false,
        memberships: [{ customerId: item.otherCustomer ? id() : customerId, roles: ['USER'] }],
      })
    }
    await User.collection.insertOne({ _id: userId, email: `${userId}@example.invalid`, name: 'Synthetic target', isActive: active, memberships: [{ customerId, roles: ['USER'] }] })
    await Tenant.collection.insertOne({ _id: tenantId, customerId, name: 'Synthetic tenant', status: tenantStatus, tenantAdminUserIds: [userId, ...adminIds] })
    await DataDeletionRequest.collection.insertOne({ _id: requestId, userId, customerId, requestedByUserId: reviewer, status: 'PENDING' })
    await AuditLog.collection.insertOne({ _id: auditId, ts: new Date(), actorUserId: reviewer, action: 'USER_UPDATED', resourceType: 'User', resourceId: userId, diff: { email: 'private@example.invalid' }, signature: 'original-signature' })
    return { userId, tenantId, requestId, auditId, reviewerUserId: reviewer, decision: 'APPROVE' }
  }

  const unchanged = async (f) => {
    expect(await User.findById(f.userId).lean()).not.toBeNull()
    expect((await Tenant.findById(f.tenantId).lean()).tenantAdminUserIds.map(String)).toContain(String(f.userId))
    const request = await DataDeletionRequest.collection.findOne({ _id: f.requestId })
    expect(request.status).toBe('PENDING')
    expect(request.reviewedAt).toBeUndefined()
    expect(request.executionSummary).toBeUndefined()
    const audit = await AuditLog.findById(f.auditId).lean()
    expect(audit.diff.email).toBe('private@example.invalid')
    expect(audit.signature).toBe('original-signature')
    expect(await AuditLog.countDocuments({ resourceId: f.userId, action: 'USER_DELETED' })).toBe(0)
  }

  test.each(['audit-reseal', 'user-delete', 'request-completion', 'success-audit'])('rolls back every collection after %s failure', async (stage) => {
    const f = await fixture()
    const [object, method] = stage === 'audit-reseal' ? [AuditLog.collection, 'bulkWrite']
      : stage === 'user-delete' ? [User, 'deleteOne']
        : stage === 'request-completion' ? [DataDeletionRequest.prototype, 'save'] : [AuditLog, 'createLog']
    const original = object[method]
    const spy = jest.spyOn(object, method).mockImplementation(async function (...args) {
      await original.apply(this, args)
      throw new Error(`synthetic ${stage} failure`)
    })
    try { await expect(service.processDeletionRequest(f)).rejects.toThrow(`synthetic ${stage} failure`) }
    finally { spy.mockRestore() }
    await unchanged(f)
  })

  test.each([
    { remaining: [] }, { remaining: [{ missing: true }] },
    { remaining: [{ active: false }] }, { remaining: [{ otherCustomer: true }] },
  ])('preserves an enabled tenant when remaining admins are ineligible: %j', async ({ remaining }) => {
    const f = await fixture({ tenantStatus: 'ENABLED', remaining })
    await expect(service.processDeletionRequest(f)).rejects.toMatchObject({ status: 409, code: 'TENANT_ADMIN_REQUIRED' })
    await unchanged(f)
  })

  test('rejects an active target and preserves all data', async () => {
    const f = await fixture({ active: true })
    await expect(service.processDeletionRequest(f)).rejects.toMatchObject({ status: 422 })
    await unchanged(f)
  })

  test('commits deletion, remaining admin, audit reseal and request together; repeated processing refuses without duplicate audit', async () => {
    const f = await fixture({ tenantStatus: 'ENABLED', remaining: [{ active: true }] })
    expect((await service.processDeletionRequest(f)).summary.action).toBe('COMPLETED')
    expect(await User.findById(f.userId)).toBeNull()
    expect((await Tenant.findById(f.tenantId)).tenantAdminUserIds).toHaveLength(1)
    expect((await DataDeletionRequest.findById(f.requestId)).status).toBe('COMPLETED')
    const audit = await AuditLog.findById(f.auditId)
    expect(audit.diff.email).toBe('[REDACTED]')
    expect(audit.signature).not.toBe('original-signature')
    expect(audit.verifySignature()).toBe(true)
    await expect(service.processDeletionRequest(f)).rejects.toMatchObject({ status: 409 })
    expect(await AuditLog.countDocuments({ resourceId: f.userId, action: 'USER_DELETED' })).toBe(1)
  })

  test('reseals current audit signatures using the model contract', async () => {
    const f = await fixture()
    const current = await AuditLog.createLog({ actorUserId: f.reviewerUserId, action: 'USER_UPDATED', resourceType: 'User', resourceId: f.userId, diff: { email: 'current@example.invalid' } })
    await service.processDeletionRequest(f)
    const saved = await AuditLog.findById(current._id)
    expect(saved.diff.email).toBe('[REDACTED]')
    expect(saved.signatureVersion).toBe(current.signatureVersion)
    expect(saved.verifySignature()).toBe(true)
  })

  test('fails closed for unsupported signature versions and rolls back tenant changes', async () => {
    const f = await fixture()
    await AuditLog.collection.updateOne({ _id: f.auditId }, { $set: { signatureVersion: 999 } })
    await expect(service.processDeletionRequest(f)).rejects.toThrow('Unsupported audit signature version')
    await unchanged(f)
  })

  test('concurrent approvals commit once and refuse the retried request without duplicate audit', async () => {
    const f = await fixture()
    const results = await Promise.allSettled([service.processDeletionRequest(f), service.processDeletionRequest(f)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({ status: 409 })
    expect(await AuditLog.countDocuments({ resourceId: f.userId, action: 'USER_DELETED' })).toBe(1)
    expect((await DataDeletionRequest.findById(f.requestId)).status).toBe('COMPLETED')
  })
})
