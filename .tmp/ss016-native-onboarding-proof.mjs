import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
const { default: env } = await import('../src/config/env.js')
assert.ok(['development', 'test'].includes(env.appEnv) && !env.isAppProduction)
const { connectDb, disconnectDb } = await import('../src/config/db.js')
const { RuntimeInstance, FrameworkPackage, User } = await import('../src/models/index.js')
const { default: Section } = await import('../src/models/RuntimeStateSection.js')
const { default: Receipt } = await import('../src/models/RuntimeStateMigrationReceipt.js')
const { default: auditService } = await import('../src/services/auditService.js')
const { buildUserPermissionsSnapshot } = await import('../src/services/performanceCacheService.js')
const { createRuntimeInstance } = await import('../src/services/runtimeInstanceService.js')
const { mutateRuntimeState } = await import('../src/services/runtimeStateMutationService.js')
const { createRuntimeStateLegacySourceRowSet } = await import('../src/services/runtimeStateLegacyMapper.js')
const { buildRuntimeStateNativeCreationFrameworkState, validateRuntimeStateNativeCreationPaths } = await import('../src/services/runtimeStateNativeInitializationService.js')
const mode = process.argv[2] || 'plan'
const targetKey = process.argv[3]
assert.ok(['plan', 'read', 'rollover', 'negative'].includes(mode))
const customerId = new mongoose.Types.ObjectId('69c51f819510a816ace19596')
const tenantId = new mongoose.Types.ObjectId('69c520ea9510a816ace19639')
const packageId = new mongoose.Types.ObjectId('6a97fe2e47d47c11251b5e57')
const name = 'SS-016 Fresh Onboarding Persistence Proof'
const rollbackKey = 'ss016-onboarding-audit-rollback'
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const json = (value) => JSON.parse(JSON.stringify(value))
const protectedKeys = ['ss016-parlon-v315-validation', 'ss016-fresh-discovery-proof', 'value-narrative-82ae435990f9-rev-2-b08b10ea', 'ss016-contradiction-review-proof', 'value-narrative-b8007091112b']
const childCollections = ['runtime_section_states', 'runtime_evidence_sources', 'runtime_evidence_objects', 'runtime_graph_snapshots', 'runtime_graph_elements', 'runtime_graph_relationships', 'runtime_state_migration_receipts']
await connectDb({ autoIndex: false })
try {
  assert.equal(mongoose.connection.name, 'test')
  const pkg = await FrameworkPackage.findById(packageId).lean()
  assert.equal(pkg.version, '3.1.5')
  assert.equal(pkg.status, 'ACTIVE')
  const packageHash = hash(pkg)
  buildRuntimeStateNativeCreationFrameworkState({ frameworkPackage: pkg, stateVersion: 'preflight-only' })
  await validateRuntimeStateNativeCreationPaths(pkg)
  const protectedHashes = async () => Object.fromEntries(await Promise.all(protectedKeys.map(async (key) => {
    const root = await RuntimeInstance.findOne({ runtimeInstanceKey: key }).lean()
    assert.ok(root)
    return [key, hash(root)]
  })))
  const protectedBefore = await protectedHashes()
  assert.equal(protectedBefore['value-narrative-b8007091112b'], '79b64b4588c1a8b76ad4b1cb12badebd0f7da33b68ec782a5a01cc52eb5e438a', 'Failed first-save fixture is quarantined')
  assert.equal(hash(await RuntimeInstance.collection.findOne({ runtimeInstanceKey: 'value-narrative-b8007091112b' })),
    'c990b7fb3ea08433a2db43f3f151402cc3b2eb210c44b2b70ddf3458daeddc37', 'Raw quarantine root includes hidden capacity metadata')
  const baselineHash = hash({ packageHash, protectedBefore })
  const report = { mode, database: 'test', packageVersion: pkg.version, packageHash, protectedBefore, baselineHash }
  if (mode === 'plan') {
    assert.equal(await RuntimeInstance.countDocuments({ name }), 0)
    assert.equal(await RuntimeInstance.countDocuments({ runtimeInstanceKey: rollbackKey }), 0)
    report.plannedName = name
    report.packageSections = pkg.sections.map(({ sectionKey, runtimePath }) => ({ sectionKey, runtimePath }))
  } else {
    assert.equal(process.argv[4], baselineHash, 'Protected roots or package changed since plan')
    const root = await RuntimeInstance.findOne({ runtimeInstanceKey: targetKey, name, customerId, tenantId, packageId }).lean()
    assert.ok(root, 'Exact newly created target required')
    const scope = { runtimeInstanceId: root._id, runtimeInstanceKey: root.runtimeInstanceKey, customerId, tenantId }
    report.target = { id: String(root._id), key: root.runtimeInstanceKey, stateVersion: root.stateVersion }
    const receipts = await Receipt.find(scope).lean()
    assert.equal(receipts.length, 1)
    const receipt = receipts[0]
    assert.equal(receipt.operationType, 'NATIVE_INITIALIZATION')
    assert.equal(receipt.status, 'VERIFIED')
    const verifyRows = async (currentRoot) => {
      const rows = await Section.find({ ...scope, current: true }).lean()
      assert.equal(rows.length, pkg.sections.length)
      const fs = currentRoot.framework_state
      const expected = createRuntimeStateLegacySourceRowSet({
        legacyInput: { rawBsonBytes: mongoose.mongo.BSON.serialize(currentRoot).length,
          sections: fs.sections, evidencePack: fs.evidence_pack, intelligenceGraph: fs.intelligence_graph },
        scope: Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, String(value)])),
        stateVersion: currentRoot.stateVersion, migrationReceiptId: String(receipt.receiptId),
        migrationTimestamp: new Date(rows[0].updatedAt).toISOString(),
      })
      for (const row of rows) {
        const mapped = expected.rows.sections.find((candidate) => candidate.sectionKey === row.sectionKey)
        const expectedRow = json(new Section({ ...mapped, current: true,
          stateStatus: currentRoot.stateVersion === receipt.assignedStateVersion ? 'DRAFT' : mapped.stateStatus }).toObject())
        const observedRow = json(row)
        for (const field of ['_id', '__v', 'createdAt', 'updatedAt']) {
          delete expectedRow[field]
          delete observedRow[field]
        }
        assert.deepEqual(observedRow, expectedRow, `Exact V2 projection parity: ${row.sectionKey}`)
        assert.equal(row.sectionDetail.generated, null)
        assert.equal(row.sectionDetail.accepted, null)
        assert.equal(row.sectionDetail.state.status, 'DRAFT')
      }
      assert.deepEqual(fs.evidence_pack, { sourceRegistry: [], evidenceObjects: [] })
      for (const collection of childCollections.slice(1, -1)) {
        assert.equal(await mongoose.connection.collection(collection).countDocuments(scope), 0)
      }
      if (currentRoot.stateVersion === receipt.assignedStateVersion) assert.equal(receipt.sourceSetHash, expected.sourceSetHash)
      return { count: rows.length, sourceSetHash: expected.sourceSetHash, fullProjectionParity: true,
        sectionStatuses: rows.map((row) => row.stateStatus), sectionsHash: hash(fs.sections) }
    }
    report.before = await verifyRows(root)
    if (mode === 'rollover' || mode === 'negative') {
      assert.equal(process.argv[5], root.stateVersion, 'Fresh target CAS required')
      const actor = await User.findById('698b3800f83b3257365fd7a3')
      const permissions = await buildUserPermissionsSnapshot(actor)
      assert.ok(permissions.isActive && permissions.platformRoles.includes('SUPER_ADMIN'))
      const scopes = { ...permissions, customer: { _id: customerId }, tenant: { _id: tenantId, customerId } }
      if (mode === 'rollover') {
        assert.equal(root.stateVersion, receipt.assignedStateVersion, 'Only the first mutation is authorized')
        await mutateRuntimeState({ actorUserId: String(actor._id), scopes, runtimeInstanceId: targetKey,
          payload: { runtimePath: 'framework_state.sections.customer_context', operation: 'WRITE', value: {},
            expectedUpdatedAt: new Date(root.updatedAt).toISOString() } })
        const saved = await RuntimeInstance.findById(root._id).lean()
        assert.notEqual(saved.stateVersion, root.stateVersion)
        report.after = await verifyRows(saved)
        report.after.stateVersion = saved.stateVersion
        assert.equal(await Section.countDocuments({ ...scope, current: false }), 6)
      } else {
        assert.equal(await RuntimeInstance.countDocuments({ runtimeInstanceKey: rollbackKey }), 0)
        for (const collection of childCollections) assert.equal(await mongoose.connection.collection(collection).countDocuments({ runtimeInstanceKey: rollbackKey }), 0)
        const originalLog = auditService.log
        let failedId
        let injected = false
        try {
          auditService.log = async (payload, options) => {
            if (payload.action !== auditService.AUDIT_ACTIONS.RUNTIME_INSTANCE_CREATED
              || payload.diff?.runtimeInstanceKey !== rollbackKey) return originalLog.call(auditService, payload, options)
            failedId = payload.resourceId
            assert.ok(options.session)
            const query = { runtimeInstanceId: failedId, runtimeInstanceKey: rollbackKey, customerId, tenantId }
            assert.equal(await Section.countDocuments(query).session(options.session), 6)
            assert.equal(await Receipt.countDocuments(query).session(options.session), 1)
            injected = true
            throw new Error('SS016_SCOPED_AUDIT_FAILURE')
          }
          await assert.rejects(createRuntimeInstance({ actorUserId: String(actor._id), scopes,
            payload: { customerId, tenantId, frameworkPackageId: packageId, runtimeInstanceKey: rollbackKey,
              frameworkKey: 'VMF', runtimeType: 'VALUE_NARRATIVE', name: 'SS-016 Onboarding Rollback Probe' } }),
          { code: 'RUNTIME_INSTANCE_AUDIT_FAILED' })
        } finally { auditService.log = originalLog }
        assert.ok(injected && failedId)
        assert.equal(await RuntimeInstance.countDocuments({ _id: failedId }), 0)
        for (const collection of childCollections) assert.equal(await mongoose.connection.collection(collection).countDocuments({ runtimeInstanceId: failedId }), 0)
        assert.equal(await mongoose.connection.collection('auditlogs').countDocuments({ resourceId: failedId }), 0)
        assert.equal(hash(await RuntimeInstance.findById(root._id).lean()), hash(root))
        report.rollback = { stagedSections: 6, stagedReceipts: 1, auditFailureInjected: true, allScopedResidueCounts: 0 }
        const snapshot = async () => ({
          root: await RuntimeInstance.collection.findOne({ _id: root._id }),
          children: await Promise.all(childCollections.map((collection) => mongoose.connection.collection(collection)
            .find(scope).sort({ _id: 1 }).toArray())),
          audits: await mongoose.connection.collection('auditlogs').find({ resourceId: root._id }).sort({ _id: 1 }).toArray(),
        })
        const snapshotBefore = hash(await snapshot())
        let mutationInjected = false
        try {
          auditService.log = async (payload, options) => {
            if (payload.action !== auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED
              || String(payload.resourceId) !== String(root._id)) return originalLog.call(auditService, payload, options)
            assert.ok(options.session)
            const stagedRoot = await RuntimeInstance.collection.findOne({ _id: root._id }, { session: options.session })
            assert.notEqual(stagedRoot.stateVersion, root.stateVersion)
            assert.equal(await Section.countDocuments({ ...scope, current: true, stateVersion: stagedRoot.stateVersion }).session(options.session), 6)
            assert.equal(await Section.countDocuments({ ...scope, current: false, stateVersion: root.stateVersion }).session(options.session), 6)
            mutationInjected = true
            throw new Error('SS016_SCOPED_MUTATION_AUDIT_FAILURE')
          }
          await assert.rejects(mutateRuntimeState({ actorUserId: String(actor._id), scopes, runtimeInstanceId: targetKey,
            payload: { runtimePath: 'framework_state.sections.customer_context', operation: 'WRITE', value: {},
              expectedUpdatedAt: new Date(root.updatedAt).toISOString() } }), { code: 'RUNTIME_STATE_MUTATION_AUDIT_FAILED' })
        } finally { auditService.log = originalLog }
        assert.ok(mutationInjected)
        assert.equal(hash(await snapshot()), snapshotBefore)
        report.mutationRollback = { stagedNewRows: 6, stagedPreviousRows: 6, auditFailureInjected: true,
          exactRootChildrenAuditsUnchanged: true, snapshotHash: snapshotBefore }
      }
    }
  }
  assert.deepEqual(await protectedHashes(), protectedBefore)
  assert.equal(hash(await RuntimeInstance.collection.findOne({ runtimeInstanceKey: 'value-narrative-b8007091112b' })),
    'c990b7fb3ea08433a2db43f3f151402cc3b2eb210c44b2b70ddf3458daeddc37')
  assert.equal(hash(await FrameworkPackage.findById(packageId).lean()), packageHash)
  report.protectedUnchanged = true
  console.log('PROOF=' + JSON.stringify(report))
} finally { await disconnectDb() }
