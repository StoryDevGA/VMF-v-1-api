import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
const { default: env } = await import('../src/config/env.js')
assert.ok(['development', 'test'].includes(env.appEnv) && !env.isAppProduction)
const { connectDb, disconnectDb } = await import('../src/config/db.js')
const { FrameworkPackage, User, AuditLog } = await import('../src/models/index.js')
const { buildUserPermissionsSnapshot } = await import('../src/services/performanceCacheService.js')
const { requirePlatformRole } = await import('../src/middleware/authorize.js')
const { validateFrameworkPackageId, validateUpdateFrameworkPackageSafeMetadata } = await import('../src/validators/frameworkPackage.validator.js')
const { updateFrameworkPackageSafeMetadata } = await import('../src/controllers/frameworkPackage.controller.js')
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const invariant = p => Object.fromEntries(Object.entries(p).filter(([k]) => !['assignedCustomerIds', 'updatedAt', 'updatedBy', '__v'].includes(k)))
const packageKey = 'standard-package-value-mapping-framework-3-1-5-runtime-knowledge-model'
const customerIds = ['69c51f819510a816ace19596', '6a6c75f2cace7a21bd41ef98'].sort()
await connectDb({ autoIndex: false })
try {
  assert.equal(mongoose.connection.name, 'test')
  const p = await FrameworkPackage.findOne({ packageKey }).lean()
  assert.equal(p.version, '3.1.5')
  assert.equal(p.visibility, 'CUSTOMER_VISIBLE')
  assert.equal(p.customerAccessMode, 'SELECTED_CUSTOMERS')
  const assigned = p.assignedCustomerIds.map(String).sort()
  if (JSON.stringify(assigned) === JSON.stringify(customerIds)) {
    console.log('ACCESS_RESULT=' + JSON.stringify({ mode: 'RECONCILED', actionsRequired: 0, customerIds }))
  } else {
    assert.deepEqual(assigned, ['6a6c75f2cace7a21bd41ef98'])
    const fingerprint = hash(p)
    const user = await User.findById('698b3800f83b3257365fd7a3')
    const scopes = await buildUserPermissionsSnapshot(user)
    const req = { params: { packageId: String(p._id) }, body: { assignedCustomerIds: customerIds }, scopes, userId: String(user._id), context: { userId: String(user._id) }, requestId: 'ss016-fixture-package-access' }
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
    for (const middleware of [requirePlatformRole('SUPER_ADMIN'), validateFrameworkPackageId, validateUpdateFrameworkPackageSafeMetadata]) {
      let passed = false
      await middleware(req, res, error => { if (error) throw error; passed = true })
      assert.ok(passed, JSON.stringify(res.body))
    }
    console.log('ACCESS_PLAN=' + JSON.stringify({ fingerprint, invariantHash: hash(invariant(p)), body: req.body }))
    if (process.argv[2]) {
      assert.equal(process.argv[2], `--apply=${fingerprint}`)
      const query = { resourceId: p._id, action: 'PACKAGE_ACCESS_UPDATED' }
      const count = await AuditLog.countDocuments(query)
      await updateFrameworkPackageSafeMetadata(req, res, error => { throw error })
      assert.equal(res.statusCode, 200, JSON.stringify(res.body))
      const after = await FrameworkPackage.findById(p._id).lean()
      assert.deepEqual(after.assignedCustomerIds.map(String).sort(), customerIds)
      assert.equal(hash(invariant(after)), hash(invariant(p)))
      assert.equal(await AuditLog.countDocuments(query), count + 1)
      const audit = await AuditLog.findOne(query).sort({ ts: -1 }).select('action ts').lean()
      console.log('ACCESS_RESULT=' + JSON.stringify({ mode: 'COMMITTED_VERIFIED', customerIds, nonAccessInvariantUnchanged: true, audit }))
    }
  }
} finally { await disconnectDb() }
