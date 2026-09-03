import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'

mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
const { connectDb, disconnectDb } = await import('../src/config/db.js')
const { default: env } = await import('../src/config/env.js')
const { RuntimeInstance, FrameworkPackage, User, AuditLog } = await import('../src/models/index.js')
const { default: RuntimeEvidenceObject } = await import('../src/models/RuntimeEvidenceObject.js')
const { default: RuntimeEvidenceSource } = await import('../src/models/RuntimeEvidenceSource.js')
const { createRuntimeInstance, assertRuntimePermission } = await import('../src/services/runtimeInstanceService.js')
const { buildUserPermissionsSnapshot } = await import('../src/services/performanceCacheService.js')
const { assertRuntimeEvidencePackWritable } = await import('../src/services/runtimeStateMutationService.js')
const { isRuntimeLocked } = await import('../src/services/runtimeActionPolicyService.js')
const { stageRuntimeStateSourceRollover } = await import('../src/services/runtimeStateSourceRolloverService.js')
const { stageRuntimeStateGraphSourceMutation } = await import('../src/services/runtimeStateGraphSourceMutationService.js')
const { createNextRuntimeStateVersion } = await import('../src/services/runtimeStateVersionService.js')
const { buildRuntimeStateNativeInitialFrameworkState } = await import('../src/services/runtimeStateNativeInitializationService.js')
const { default: auditService } = await import('../src/services/auditService.js')

const SOURCE = 'value-narrative-82ae435990f9-rev-2-b08b10ea'
const ARCHIVE = 'value-narrative-1c681d118aee-rev-2-035a6c23-rev-3-c69646d2'
const TARGET = 'ss016-parlon-v315-validation'
const PACKAGE = 'standard-package-value-mapping-framework-3-1-5-runtime-knowledge-model'
const SOURCE_HASH = '0fd04add87cc6a75dc42c64a3ad70c0e9609d92f9b3d6b30cd8ce0e6b0003b77'
const ARCHIVE_HASH = 'a90b40710efa0d7d7107d5bd6f3aeace8e1b342184ff3810bb73b2acc24b8ad7'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const mode = process.argv[2] || 'dry-run'
assert(['dry-run', 'probe', 'apply', 'transfer-dry-run', 'transfer'].includes(mode))
const transferOnly = mode.startsWith('transfer')
assert(['development', 'test'].includes(env.appEnv) && !env.isAppProduction)
if (mode === 'apply' || mode === 'transfer') assert.equal(process.argv[3], TARGET)
const emit = value => console.log(JSON.stringify(value))
const scope = r => ({ customerId: r.customerId, tenantId: r.tenantId, runtimeInstanceId: r._id, runtimeInstanceKey: r.runtimeInstanceKey })
const find = key => RuntimeInstance.findOne({ runtimeInstanceKey: key }).lean()
const evidenceShape = rows => rows.map(r => [r.evidenceObjectId, r.extractedFact, r.reviewStatus]).sort((a,b) => a[0].localeCompare(b[0]))
const verifyEvidence = async r => {
  const rows = await RuntimeEvidenceObject.find({ ...scope(r), current: true, stateVersion: r.stateVersion }).lean()
  const sources = await RuntimeEvidenceSource.find({ ...scope(r), current: true, stateVersion: r.stateVersion }).lean()
  assert.deepEqual(evidenceShape(rows), evidenceShape(r.framework_state.evidence_pack.evidenceObjects))
  assert.equal(rows.length, 803)
  assert.equal(sources.length, 33)
  return { evidenceObjects: rows.length, sources: sources.length, idFactReviewParity: true }
}

await connectDb({ autoIndex: false })
try {
  assert.equal(mongoose.connection.name, 'test', 'Exact Development/Test database required')
  const source = await find(SOURCE)
  const archived = await find(ARCHIVE)
  assert.equal(hash(source), SOURCE_HASH, 'Source changed')
  if (!transferOnly) assert.equal(hash(archived), ARCHIVE_HASH, 'Archive target changed')
  else assert.equal(hash(archived.framework_state), 'c3824a4ead61d3e762fd82abe85ad5994b30884b3c23a6b013967153df6c21bd')
  assert.equal(archived.status, transferOnly ? 'ARCHIVED' : 'ACTIVE')
  assert.equal(archived.executionStatus, 'IDLE')
  assert.equal(String(archived.customerId), String(source.customerId))
  assert.equal(String(archived.tenantId), String(source.tenantId))
  assert.equal(await RuntimeInstance.countDocuments({ 'revision.parentRuntimeId': archived._id }), 0)
  assert.equal(await RuntimeInstance.countDocuments({ 'anchors.runtimeInstanceId': archived._id }), 0)
  if (!transferOnly) assert.equal(await find(TARGET), null, 'Target occupied; reconcile, do not rerun')
  else assert.equal(hash(await find(TARGET)), '677519353e3775305a1d7a8d078e7cd3e5d8939fcd90a4450a71913700adcaac', 'Empty target changed')
  const user = await User.findById(source.createdBy)
  assert.equal(user.name, 'Andrew Mallaband')
  assert.equal(user.isActive, true)
  const scopes = await buildUserPermissionsSnapshot(user)
  for (const permission of ['VMF_VIEW', 'VMF_CREATE', 'VMF_UPDATE']) {
    await assertRuntimePermission({ actorUserId: user._id, scopes, customerId: source.customerId, tenantId: source.tenantId, permission })
  }
  const pkg = await FrameworkPackage.findOne({ packageKey: PACKAGE }).lean()
  assert.equal(pkg.version, '3.1.5')
  assert.equal(pkg.status, 'ACTIVE')
  assert.equal(source.framework_state.evidence_pack.evidenceObjects.every(e => e.reviewStatus === 'ACCEPTED'), true)
  const evidence = await verifyEvidence(source)
  emit({ mode, source: SOURCE, archive: ARCHIVE, target: TARGET, package: PACKAGE, evidence, sourceUnchanged: true })

  const log = (runtime, diff, session) => auditService.log({
    action: auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED,
    resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
    resourceId: runtime._id, actorUserId: user._id, scope: scope(runtime),
    diff: { ...diff, verificationTask: 'SS-016', executionChannel: 'USER_AUTHORIZED_DEVELOPMENT_TEST_SCRIPT' },
  }, { session, throwOnError: true })

  const archiveTransaction = async probe => {
    const session = await mongoose.startSession()
    const auditCount = await AuditLog.countDocuments({ resourceId: archived._id })
    try {
      await session.withTransaction(async () => {
        const current = await RuntimeInstance.findById(archived._id).session(session).lean()
        assert.equal(hash(current), ARCHIVE_HASH)
        const filter = { _id: archived._id, customerId: source.customerId, tenantId: source.tenantId, status: 'ACTIVE', executionStatus: 'IDLE', updatedAt: archived.updatedAt, stateVersion: archived.stateVersion }
        if (probe) {
          const stale = await RuntimeInstance.updateOne({ ...filter, updatedAt: new Date(0) }, { $set: { status: 'ARCHIVED' } }, { session })
          assert.equal(stale.matchedCount, 0)
        }
        const changed = await RuntimeInstance.updateOne(filter, { $set: { status: 'ARCHIVED', updatedBy: user._id } }, { session, runValidators: true })
        assert.equal(changed.modifiedCount, 1)
        await log(current, { runtimePath: 'status', operation: 'ARCHIVE_TEST_RUNTIME', previousValue: 'ACTIVE', nextValue: 'ARCHIVED', reason: 'User approved freeing one Parlon validation slot; preserve all data.' }, session)
        if (probe) throw new Error('SS016_ROLLBACK_PROBE')
      })
    } catch (error) {
      if (!probe || error.message !== 'SS016_ROLLBACK_PROBE') throw error
    } finally { await session.endSession() }
    if (probe) {
      assert.equal(hash(await find(ARCHIVE)), ARCHIVE_HASH)
      assert.equal(await AuditLog.countDocuments({ resourceId: archived._id }), auditCount)
      emit({ archiveRollback: 'PASS', staleCas: 'PASS', auditRollback: 'PASS', transferRollback: 'NOT_TESTED' })
    } else {
      const after = await find(ARCHIVE)
      assert.equal(after.status, 'ARCHIVED')
      assert.equal(hash(after.framework_state), hash(archived.framework_state))
      assert.equal(after.stateVersion, archived.stateVersion)
      emit({ archive: 'COMMITTED', dataRetained: true, recoverableByExplicitStatusRestore: true })
    }
  }

  if (mode === 'probe') await archiveTransaction(true)
  if (mode === 'apply' || mode === 'transfer') {
    if (!transferOnly) {
      await archiveTransaction(false)
      await createRuntimeInstance({ actorUserId: user._id, scopes, payload: {
      customerId: String(source.customerId), tenantId: String(source.tenantId),
      frameworkPackageId: String(pkg._id), frameworkKey: source.frameworkKey,
      runtimeType: 'VALUE_NARRATIVE', runtimeInstanceKey: TARGET,
      name: 'SS-016 Parlon v3.1.5 Validation',
      description: `Separate SS-016 test using accepted evidence copied from ${SOURCE}. No old section truth copied.`,
      } })
      emit({ creation: 'COMMITTED', target: TARGET })
    }
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const currentSource = await RuntimeInstance.findById(source._id).session(session).lean()
        assert.equal(hash(currentSource), SOURCE_HASH)
        const target = await RuntimeInstance.findOne({ runtimeInstanceKey: TARGET }).session(session).lean()
        if (transferOnly) assert.equal(hash(target), '677519353e3775305a1d7a8d078e7cd3e5d8939fcd90a4450a71913700adcaac')
        assert.equal(String(target.customerId), String(source.customerId))
        assert.equal(String(target.tenantId), String(source.tenantId))
        assert.equal(String(target.packageId), String(pkg._id))
        assert.equal(target.status, 'ACTIVE')
        assert.equal(target.executionStatus, 'IDLE')
        assert.equal(isRuntimeLocked({ runtimeInstance: target }), false)
        assert.equal(target.framework_state.lifecycle.stage, 'DRAFT')
        for (const key of ['sections','evidence_pack','intelligence_graph','publish','lock']) assert.equal(Object.keys(target.framework_state[key] || {}).length, 0)
        const evidencePack = structuredClone(source.framework_state.evidence_pack)
        delete evidencePack.scoped_views
        delete evidencePack.scopedViews
        evidencePack.lineage = { ...evidencePack.lineage, copiedFrom: { runtimeInstanceKey: SOURCE, stateVersion: source.stateVersion, sourceHash: SOURCE_HASH, copiedAt: new Date().toISOString(), reason: 'SS-016 authorized Development/Test evidence reuse' } }
        await assertRuntimeEvidencePackWritable({ frameworkKey: target.frameworkKey, value: evidencePack })
        const nextStateVersion = createNextRuntimeStateVersion(target.stateVersion)
        const nextFrameworkState = { ...target.framework_state, ...buildRuntimeStateNativeInitialFrameworkState({ frameworkState: target.framework_state, stateVersion: nextStateVersion }), evidence_pack: evidencePack }
        const rollover = await stageRuntimeStateSourceRollover({ runtimeInstance: target, expectedStateVersion: target.stateVersion, nextStateVersion, nextFrameworkState, mutationTimestamp: new Date(), session })
        const graph = await stageRuntimeStateGraphSourceMutation({ runtimeInstance: target, expectedStateVersion: target.stateVersion, graphWillRebuild: false, session })
        assert.equal(String(graph.migrationReceiptId), String(rollover.migrationReceiptId))
        const result = await RuntimeInstance.updateOne({ _id: target._id, customerId: source.customerId, tenantId: source.tenantId, stateVersion: target.stateVersion, updatedAt: target.updatedAt, status: 'ACTIVE', executionStatus: 'IDLE' }, { $set: { framework_state: nextFrameworkState, stateVersion: nextStateVersion, updatedBy: user._id } }, { session, runValidators: true })
        assert.equal(result.modifiedCount, 1)
        await log(target, { runtimePath: 'framework_state.evidence_pack', operation: 'COPY_ACCEPTED_EVIDENCE_FOR_TEST', source: evidencePack.lineage.copiedFrom, counts: rollover.counts, previousStateVersion: target.stateVersion, nextStateVersion, graphStatus: graph.status }, session)
      })
    } finally { await session.endSession() }
    const target = await find(TARGET)
    emit({ transfer: 'COMMITTED', target: TARGET, evidence: await verifyEvidence(target), sectionsEmpty: Object.keys(target.framework_state.sections || {}).length === 0, graph: 'MISSING_FAIL_CLOSED', sourceUnchanged: hash(await find(SOURCE)) === SOURCE_HASH })
    assert.equal(hash(await find(SOURCE)), SOURCE_HASH)
  }
} catch (error) {
  emit({ status: 'STOPPED', error: error.message, reason: error.details?.reason || error.code || null, recovery: 'Inspect exact archive and target identities before any rerun; no automatic compensation.' })
  process.exitCode = 1
} finally { await disconnectDb() }
