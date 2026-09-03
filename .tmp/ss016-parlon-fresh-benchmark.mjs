import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
const { default: env } = await import('../src/config/env.js')
assert.ok(['development', 'test'].includes(env.appEnv) && !env.isAppProduction)
const { connectDb, disconnectDb } = await import('../src/config/db.js')
const { RuntimeInstance, FrameworkPackage, User, AuditLog } = await import('../src/models/index.js')
const { default: Section } = await import('../src/models/RuntimeStateSection.js')
const { default: Evidence } = await import('../src/models/RuntimeEvidenceObject.js')
const { default: Source } = await import('../src/models/RuntimeEvidenceSource.js')
const { default: Receipt } = await import('../src/models/RuntimeStateMigrationReceipt.js')
const { default: GraphSnapshot } = await import('../src/models/RuntimeGraphSnapshot.js')
const { default: GraphElement } = await import('../src/models/RuntimeGraphElement.js')
const { default: auditService } = await import('../src/services/auditService.js')
const { buildUserPermissionsSnapshot } = await import('../src/services/performanceCacheService.js')
const { createRuntimeInstance, assertRuntimePermission } = await import('../src/services/runtimeInstanceService.js')
const { assertRuntimeEvidencePackWritable, acceptRuntimeSection } = await import('../src/services/runtimeStateMutationService.js')
const { executeRuntimeAction } = await import('../src/services/runtimeActionExecutionService.js')
const { isRuntimeLocked } = await import('../src/services/runtimeActionPolicyService.js')
const { stageRuntimeStateSourceRollover } = await import('../src/services/runtimeStateSourceRolloverService.js')
const { stageRuntimeStateGraphSourceMutation } = await import('../src/services/runtimeStateGraphSourceMutationService.js')
const { createNextRuntimeStateVersion } = await import('../src/services/runtimeStateVersionService.js')
const { createRuntimeStateLegacySourceRowSet } = await import('../src/services/runtimeStateLegacyMapper.js')
const { buildRuntimeStateNativeCreationFrameworkState } = await import('../src/services/runtimeStateNativeInitializationService.js')
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const json = value => JSON.parse(JSON.stringify(value))
const emit = value => console.log('BENCHMARK=' + JSON.stringify(value))
const TARGET = 'ss016-parlon-fresh-framework-benchmark'
const SOURCE = 'value-narrative-82ae435990f9-rev-2-b08b10ea'
const NAME = 'SS-016 Parlon Fresh Framework Benchmark'
const FAILED_FINGERPRINT = '844abb7a816b8a9d2cd680d0a8f707ab662a0a3ed1e8f44a0ed13d8491f1167d'
const FAILED_GENERATED_HASH = 'e7c689c365b6715cf0fcc10b11c30e4d0e47356788bd320fce00e681251fc33d'
const FAILED_STORED_SECTION_HASH = 'sha256:a5d940837a2ee92d88d8da0ffa59e34eff68f728b782df2adc5e06465578e8c3'
const FAILED_EXPECTED_SECTION_HASH = 'sha256:86e63351d0239422bd22ee3da6bba5adf17d43bcce378bc764cbe8d0f6089198'
const protectedHashes = {
  [SOURCE]: '0fd04add87cc6a75dc42c64a3ad70c0e9609d92f9b3d6b30cd8ce0e6b0003b77',
  'ss016-parlon-v315-validation': '377c37ea28bd7b38172c7984317edad3c11e94d8db752565b0940b25c70652c6',
  'ss016-fresh-discovery-proof': 'a33d6547f7d89d06cd1bb4f5f510f958d4c643b7657eea44c516bf851d516ce4',
  'ss016-contradiction-review-proof': '97c19793f0115468fc7d5ae84c6db05e71d6a764a94b8d8e7522c707e1be1aa4',
  'value-narrative-b8007091112b': '79b64b4588c1a8b76ad4b1cb12badebd0f7da33b68ec782a5a01cc52eb5e438a',
  'value-narrative-9e312d165fd7': '5dab0528d29584abd691025442ada069aeb73ba92cde595c0754cdb6f6b33a1d',
}
const packageHash = '811c4bdee53cb703ed135215003b4ab71698ddc367fdcbb66c34b2ea82e74d0d'
const mode = process.argv[2] || 'plan'
assert.ok(['plan', 'create', 'probe', 'transfer', 'read', 'generate', 'accept', 'action-plan', 'action-probe', 'regenerate'].includes(mode))
const find = key => RuntimeInstance.findOne({ runtimeInstanceKey: key }).lean()
const scope = r => ({ customerId: r.customerId, tenantId: r.tenantId, runtimeInstanceId: r._id, runtimeInstanceKey: r.runtimeInstanceKey })
const collections = ['runtime_section_states', 'runtime_evidence_sources', 'runtime_evidence_objects', 'runtime_graph_snapshots', 'runtime_graph_elements', 'runtime_graph_relationships', 'runtime_state_migration_receipts']
const protect = async () => {
  for (const [key, expected] of Object.entries(protectedHashes)) assert.equal(hash(await find(key)), expected, `Protected runtime changed: ${key}`)
}
await connectDb({ autoIndex: false })
try {
  assert.equal(mongoose.connection.name, 'test')
  await protect()
  const source = await find(SOURCE)
  const pkg = await FrameworkPackage.findOne({ packageKey: 'standard-package-value-mapping-framework-3-1-5-runtime-knowledge-model' }).lean()
  assert.equal(hash(pkg), packageHash)
  assert.equal(pkg.status, 'ACTIVE')
  assert.equal(pkg.version, '3.1.5')
  const actor = await User.findById(source.createdBy)
  assert.equal(actor.name, 'Andrew Mallaband')
  assert.equal(actor.isActive, true)
  const permissions = await buildUserPermissionsSnapshot(actor)
  const scopes = { ...permissions, customer: { _id: source.customerId }, tenant: { _id: source.tenantId, customerId: source.customerId } }
  for (const permission of ['VMF_VIEW', 'VMF_CREATE', 'VMF_UPDATE']) await assertRuntimePermission({ actorUserId: actor._id, scopes, customerId: source.customerId, tenantId: source.tenantId, permission })
  const common = { actorUserId: String(actor._id), scopes, runtimeInstanceId: TARGET }
  const sourcePack = source.framework_state.evidence_pack
  assert.equal(sourcePack.evidenceObjects.length, 803)
  assert.equal(sourcePack.sourceRegistry.length, 33)
  assert.ok(sourcePack.evidenceObjects.every(e => e.reviewStatus === 'ACCEPTED'))
  assert.equal(sourcePack.evidenceObjects.filter(e => e.validationStatus === 'UNVALIDATED').length, 333)
  assert.ok(!sourcePack.contradictionReviews && !sourcePack.contradictionReviewEpoch, 'Do not import historical adjudications')
  let target = await find(TARGET)
  const fingerprint = hash(target)
  const guard = r => {
    assert.ok(r)
    assert.equal(r.name, NAME)
    assert.equal(String(r.customerId), String(source.customerId))
    assert.equal(String(r.tenantId), String(source.tenantId))
    assert.equal(String(r.packageId), String(pkg._id))
    assert.equal(r.status, 'ACTIVE')
    assert.equal(r.executionStatus, 'IDLE')
    assert.equal(isRuntimeLocked({ runtimeInstance: r }), false)
    assert.equal(r.framework_state.lifecycle.stage, 'DRAFT')
    assert.equal(Object.keys(r.framework_state.publish || {}).length, 0)
  }
  const verify = async (r, knownFailure = false) => {
    guard(r)
    if (knownFailure) assert.equal(hash(r), FAILED_FINGERPRINT)
    const fs = r.framework_state
    const receipts = await Receipt.find(scope(r)).lean()
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].operationType, 'NATIVE_INITIALIZATION')
    assert.equal(receipts[0].status, 'VERIFIED')
    const groups = [
      ['sections', Section, 'sectionKey'],
      ['evidenceObjects', Evidence, 'evidenceObjectId'],
      ['evidenceSources', Source, 'sourceId'],
    ]
    const results = {}
    for (const [kind, Model, key] of groups) {
      const rows = await Model.find({ ...scope(r), current: true }).lean()
      if (!rows.length) { results[kind] = 0; continue }
      const mapped = createRuntimeStateLegacySourceRowSet({
        legacyInput: { rawBsonBytes: mongoose.mongo.BSON.serialize(r).length, sections: fs.sections, evidencePack: fs.evidence_pack, intelligenceGraph: fs.intelligence_graph },
        scope: Object.fromEntries(Object.entries(scope(r)).map(([k, v]) => [k, String(v)])),
        stateVersion: r.stateVersion, migrationReceiptId: String(receipts[0].receiptId), migrationTimestamp: new Date(rows[0].updatedAt).toISOString(),
      })
      const expectedRows = mapped.rows[kind]
      assert.ok(expectedRows, `Unknown mapper row group ${kind}`)
      assert.equal(rows.length, expectedRows.length)
      for (const row of rows) {
        assert.equal(row.stateVersion, r.stateVersion)
        const expected = expectedRows.find(e => e[key] === row[key])
        const nativeDraft = kind === 'sections' && r.stateVersion === receipts[0].assignedStateVersion
        const a = json(new Model({ ...expected, current: true, ...(nativeDraft ? { stateStatus: 'DRAFT' } : {}) }).toObject())
        const b = json(row)
        for (const field of ['_id', '__v', 'createdAt', 'updatedAt']) { delete a[field]; delete b[field] }
        if (knownFailure && kind === 'sections') {
          assert.equal(b.sourceHash, FAILED_STORED_SECTION_HASH)
          assert.equal(b.projectionReceipt.sourceHash, FAILED_STORED_SECTION_HASH)
          assert.equal(a.sourceHash, FAILED_EXPECTED_SECTION_HASH)
          assert.equal(a.projectionReceipt.sourceHash, FAILED_EXPECTED_SECTION_HASH)
          // Comparison only: never repair persisted rows or waive any other difference.
          b.sourceHash = a.sourceHash
          b.projectionReceipt.sourceHash = a.projectionReceipt.sourceHash
        }
        assert.deepEqual(b, a, `Root/V2 mismatch: ${kind}/${row[key]}`)
      }
      results[kind] = rows.length
    }
    if (fs.evidence_pack.evidenceObjects?.length) {
      assert.deepEqual(fs.evidence_pack.evidenceObjects, sourcePack.evidenceObjects)
      assert.deepEqual(fs.evidence_pack.sourceRegistry, sourcePack.sourceRegistry)
      assert.deepEqual(fs.evidence_pack.discoveryHealth.contradictionCandidates, sourcePack.discoveryHealth.contradictionCandidates)
      assert.equal(results.evidenceObjects, 803)
      assert.equal(results.evidenceSources, 33)
    }
    assert.equal(results.sections, 6)
    if (['action-plan', 'action-probe', 'regenerate', 'generate', 'accept'].includes(mode)) {
      const graphs = await GraphSnapshot.find({ ...scope(r), current: true }).lean()
      assert.equal(graphs.length, 1)
      assert.equal(graphs[0].stateVersion, r.stateVersion)
      assert.equal(graphs[0].stateStatus, 'CURRENT')
      assert.equal(String(graphs[0].migrationReceiptId), String(receipts[0].receiptId))
      const expectedCount = graphs[0].counts.nodeCount + graphs[0].counts.edgeCount
      assert.equal(await GraphElement.countDocuments({ ...scope(r), current: true }), expectedCount)
      assert.equal(await GraphElement.countDocuments({ ...scope(r), current: true, stateVersion: r.stateVersion, snapshotId: graphs[0].snapshotId, migrationReceiptId: receipts[0].receiptId }), expectedCount)
      results.graphElements = expectedCount
    }
    return results
  }
  emit({ mode, targetKey: TARGET, fingerprint, sourceHash: protectedHashes[SOURCE], packageHash, targetExists: Boolean(target), recordsHash: hash(sourcePack.evidenceObjects), sourcesHash: hash(sourcePack.sourceRegistry) })
  if (!['plan', 'read', 'action-plan'].includes(mode)) assert.equal(process.argv[3], `--confirm=${fingerprint}`, 'Fresh target fingerprint required')
  if (['action-plan', 'action-probe', 'regenerate'].includes(mode)) {
    await verify(target, true)
    const previous = json(target.framework_state.sections.customer_context.generated)
    const previousRevisionCount = target.framework_state.sections.customer_context.revisions.length
    const previousRevisions = json(target.framework_state.sections.customer_context.revisions)
    const otherSections = json(Object.fromEntries(Object.entries(target.framework_state.sections).filter(([key]) => key !== 'customer_context')))
    assert.equal(hash(previous), FAILED_GENERATED_HASH)
    assert.ok(!target.framework_state.sections.customer_context.accepted?.content)
    const packHash = hash(target.framework_state.evidence_pack)
    const snapshot = async () => {
      const state = { root: await RuntimeInstance.collection.findOne({ _id: target._id, customerId: source.customerId, tenantId: source.tenantId }) }
      for (const name of collections) state[name] = await mongoose.connection.collection(name).find(scope(target)).sort({ _id: 1 }).toArray()
      state.audits = await AuditLog.find({ resourceId: target._id }).sort({ _id: 1 }).lean()
      return hash(state)
    }
    const before = await snapshot()
    emit({ actionSnapshotBefore: before })
    const originalLog = auditService.log
    const originalFindOne = RuntimeInstance.collection.findOne
    RuntimeInstance.collection.findOne = async function (...args) {
      const result = await originalFindOne.apply(this, args)
      const [filter, options] = args
      if (String(filter?._id) === String(target._id)
        && String(filter?.customerId) === String(target.customerId)
        && String(filter?.tenantId) === String(target.tenantId)
        && filter?.runtimeInstanceKey === TARGET
        && filter?.stateVersion && filter.stateVersion !== target.stateVersion
        && options?.session?.inTransaction() && options?.projection?.framework_state === 1) {
        const section = result?.framework_state?.sections?.customer_context
        const generated = section?.generated
        if (generated) emit({ stagedSectionDiagnostic: {
          generatedHash: hash(generated), sectionBytes: Buffer.byteLength(JSON.stringify(section)),
          intelligenceBytes: Buffer.byteLength(JSON.stringify(generated.sectionIntelligence)),
          scalarCounts: { 'generated.content': Array.from(generated.content || '').length,
            ...Object.fromEntries((generated.sections || []).map((item, index) => [`generated.sections.${index}.body`, Array.from(item.body || '').length])) },
          provider: generated.generator?.providerMetadata,
        } })
      }
      return result
    }
    let injected = false
    if (mode === 'action-probe') auditService.log = async (...args) => {
      if (args[0]?.action === auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED
        && String(args[0]?.resourceId) === String(target._id)
        && args[0]?.diff?.actionKey === 'REGENERATE_SECTION') {
        assert.ok(args[1]?.session?.inTransaction())
        assert.equal(args[1]?.throwOnError, true)
        const staged = await RuntimeInstance.collection.findOne({ _id: target._id, customerId: source.customerId, tenantId: source.tenantId }, { session: args[1].session })
        assert.notEqual(staged.stateVersion, target.stateVersion)
        assert.equal(hash(staged.framework_state.evidence_pack), packHash)
        assert.equal(hash(staged.framework_state.sections.customer_context.revisions.at(-1).generated), FAILED_GENERATED_HASH)
        assert.ok(staged.framework_state.sections.customer_context.generated.sectionIntelligence)
        assert.equal(Object.hasOwn(staged.framework_state.sections.customer_context.intelligence, 'sectionIntelligence'), false)
        for (const [Model, count] of [[Section, 6], [Evidence, 803], [Source, 33]]) {
          assert.equal(await Model.countDocuments({ ...scope(target), current: true, stateVersion: staged.stateVersion }).session(args[1].session), count)
          assert.equal(await Model.countDocuments({ ...scope(target), current: true, stateVersion: target.stateVersion }).session(args[1].session), 0)
          assert.equal(await Model.countDocuments({ ...scope(target), current: false, stateVersion: target.stateVersion }).session(args[1].session), count)
        }
        assert.equal(await GraphSnapshot.countDocuments({ ...scope(target), current: true }).session(args[1].session), 0)
        assert.equal(await GraphSnapshot.countDocuments({ ...scope(target), stateVersion: target.stateVersion, current: false, stateStatus: 'STALE' }).session(args[1].session), 1)
        assert.equal(await GraphElement.countDocuments({ ...scope(target), current: true }).session(args[1].session), 0)
        injected = true
        emit({ actionProbeProvider: staged.framework_state.sections.customer_context.generated.generator, persistenceWillAbort: true })
        throw new Error('SS016_ACTION_AUDIT_PROBE')
      }
      return originalLog.apply(auditService, args)
    }
    try {
      if (mode !== 'action-plan') await executeRuntimeAction({ ...common, actionKey: 'REGENERATE_SECTION', payload: {
        sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context',
        expectedUpdatedAt: new Date(target.updatedAt).toISOString(),
        forceRegenerateReason: 'SS-016 evidence coverage and action persistence fixes verification; source evidence unchanged.',
      } })
    } catch (error) {
      if (mode !== 'action-probe' || !injected
        || error.code !== 'RUNTIME_ACTION_AUDIT_FAILED'
        || error.details?.reason !== 'RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED'
        || error.details?.auditError?.message !== 'SS016_ACTION_AUDIT_PROBE') throw error
    } finally { auditService.log = originalLog; RuntimeInstance.collection.findOne = originalFindOne }
    if (mode === 'action-probe') {
      assert.ok(injected, 'Exact transactional audit fault must be reached')
      assert.equal(await snapshot(), before)
      emit({ actionAuditRollback: 'PASS', snapshotBefore: before, snapshotAfter: await snapshot(), providerCallRolledBack: false })
    }
    target = await find(TARGET)
    assert.equal(hash(target.framework_state.evidence_pack), packHash)
    assert.deepEqual(json(Object.fromEntries(Object.entries(target.framework_state.sections).filter(([key]) => key !== 'customer_context'))), otherSections)
    for (const value of Object.values(target.framework_state.sections)) assert.equal(value.accepted, null)
    if (mode === 'regenerate') {
      assert.deepEqual(json(target.framework_state.sections.customer_context.revisions.at(-1).generated), previous)
      assert.equal(target.framework_state.sections.customer_context.revisions.length, previousRevisionCount + 1)
      assert.deepEqual(json(target.framework_state.sections.customer_context.revisions.slice(0, previousRevisionCount)), previousRevisions)
      assert.ok(!target.framework_state.sections.customer_context.accepted?.content)
      assert.ok(target.framework_state.sections.customer_context.generated.sectionIntelligence)
      assert.equal(Object.hasOwn(target.framework_state.sections.customer_context.intelligence, 'sectionIntelligence'), false)
      await verify(target)
    }
  }
  if (mode === 'create') {
    assert.equal(target, null)
    await createRuntimeInstance({ ...common, payload: {
      customerId: String(source.customerId), tenantId: String(source.tenantId), frameworkPackageId: String(pkg._id), frameworkKey: 'VMF',
      runtimeType: 'VALUE_NARRATIVE', runtimeInstanceKey: TARGET, name: NAME,
      description: 'SS-016 fresh v3.1.5 Framework benchmark using the original 803 accepted Parlon records unchanged; not fresh acquisition or Product acceptance.',
    } })
  }
  if (['probe', 'transfer'].includes(mode)) {
    guard(target)
    const native = buildRuntimeStateNativeCreationFrameworkState({ frameworkPackage: pkg, stateVersion: target.stateVersion })
    for (const key of ['sections', 'evidence_pack', 'intelligence_graph']) assert.deepEqual(target.framework_state[key], native[key])
    const receipt = await Receipt.findOne(scope(target)).lean()
    assert.equal(receipt?.status, 'VERIFIED')
    assert.equal(receipt?.operationType, 'NATIVE_INITIALIZATION')
    assert.equal(target.stateVersion, receipt.assignedStateVersion)
    assert.equal(await Section.countDocuments(scope(target)), 6)
    for (const name of collections.filter(name => !['runtime_section_states', 'runtime_state_migration_receipts'].includes(name))) {
      assert.equal(await mongoose.connection.collection(name).countDocuments({ runtimeInstanceId: target._id }), 0)
    }
    const snapshot = async () => {
      const state = { root: await RuntimeInstance.collection.findOne({ runtimeInstanceKey: TARGET }) }
      for (const name of collections) state[name] = await mongoose.connection.collection(name).find({ runtimeInstanceId: target._id }).sort({ _id: 1 }).toArray()
      state.audits = await AuditLog.find({ resourceId: target._id }).sort({ _id: 1 }).lean()
      return hash(state)
    }
    const before = await snapshot()
    const pack = structuredClone(sourcePack)
    delete pack.scoped_views
    delete pack.scopedViews
    pack.lineage = { ...pack.lineage, copiedFrom: { runtimeInstanceKey: SOURCE, stateVersion: source.stateVersion, sourceHash: protectedHashes[SOURCE], copiedAt: new Date().toISOString(), reason: 'User-authorized SS-016 evidence reuse; all original records and validation labels preserved.' } }
    await assertRuntimeEvidencePackWritable({ frameworkKey: 'VMF', value: pack })
    const session = await mongoose.startSession()
    const originalLog = auditService.log
    let injected = false
    if (mode === 'probe') auditService.log = async (...args) => {
      if (args[0]?.action === auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED
        && String(args[0]?.resourceId) === String(target._id)
        && args[0]?.diff?.operation === 'COPY_ACCEPTED_EVIDENCE_FOR_TEST') {
        assert.equal(args[1]?.session, session)
        injected = true
        throw new Error('SS016_TRANSFER_AUDIT_PROBE')
      }
      return originalLog.apply(auditService, args)
    }
    try {
      await session.withTransaction(async () => {
        assert.equal(hash(await RuntimeInstance.findById(source._id).session(session).lean()), protectedHashes[SOURCE])
        const current = await RuntimeInstance.findOne({ runtimeInstanceKey: TARGET }).session(session).lean()
        assert.equal(hash(current), fingerprint)
        guard(current)
        const nextVersion = createNextRuntimeStateVersion(current.stateVersion)
        const changed = await RuntimeInstance.updateOne({ _id: current._id, customerId: source.customerId, tenantId: source.tenantId, stateVersion: current.stateVersion, updatedAt: current.updatedAt, status: 'ACTIVE', executionStatus: 'IDLE' },
          { $set: { 'framework_state.evidence_pack': pack, stateVersion: nextVersion, updatedBy: actor._id } }, { session, runValidators: true })
        assert.equal(changed.modifiedCount, 1)
        const saved = await RuntimeInstance.collection.findOne({ _id: current._id, customerId: source.customerId, tenantId: source.tenantId, stateVersion: nextVersion }, { session })
        assert.deepEqual(saved.framework_state.sections, current.framework_state.sections)
        assert.deepEqual(saved.framework_state.evidence_pack.evidenceObjects, sourcePack.evidenceObjects)
        assert.deepEqual(saved.framework_state.evidence_pack.sourceRegistry, sourcePack.sourceRegistry)
        const rollover = await stageRuntimeStateSourceRollover({ runtimeInstance: current, expectedStateVersion: current.stateVersion, nextStateVersion: nextVersion, nextFrameworkState: saved.framework_state, mutationTimestamp: new Date(), session })
        const graph = await stageRuntimeStateGraphSourceMutation({ runtimeInstance: current, expectedStateVersion: current.stateVersion, graphWillRebuild: false, session })
        assert.equal(String(graph.migrationReceiptId), String(rollover.migrationReceiptId))
        await auditService.log({ action: auditService.AUDIT_ACTIONS.RUNTIME_STATE_MUTATED, resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
          resourceId: current._id, actorUserId: actor._id, scope: scope(current),
          diff: { operation: 'COPY_ACCEPTED_EVIDENCE_FOR_TEST', verificationTask: 'SS-016', executionChannel: 'USER_AUTHORIZED_DEVELOPMENT_TEST_SCRIPT', runtimePath: 'framework_state.evidence_pack', source: pack.lineage.copiedFrom, previousStateVersion: current.stateVersion, nextStateVersion: nextVersion, counts: rollover.counts, graphStatus: graph.status },
        }, { session, throwOnError: true })
      })
    } catch (error) {
      if (mode !== 'probe' || error.message !== 'SS016_TRANSFER_AUDIT_PROBE') throw error
    } finally { auditService.log = originalLog; await session.endSession() }
    if (mode === 'probe') { assert.ok(injected); assert.equal(await snapshot(), before); emit({ auditFailureRollback: 'PASS', preciseFaultInjected: true, targetSnapshotUnchanged: true }) }
  }
  if (['generate', 'accept'].includes(mode)) {
    guard(target)
    await verify(target)
    const section = pkg.sections.find(s => s.sectionKey === process.argv[4])
    assert.ok(section, 'Exact package section required')
    assert.ok(['customer-context', 'strategic-objectives', 'current-state-assessment', 'stakeholder-register', 'evidence-register'].includes(section.sectionKey), 'Only guided Framework sections authorized')
    const field = section.runtimePath.split('.').at(-1)
    const value = target.framework_state.sections[field]
    const otherSections = json(Object.fromEntries(Object.entries(target.framework_state.sections).filter(([key]) => key !== field)))
    const previousValue = json(value)
    const packHash = hash(target.framework_state.evidence_pack)
    const payload = { sectionKey: section.sectionKey, runtimePath: section.runtimePath, expectedUpdatedAt: new Date(target.updatedAt).toISOString() }
    if (mode === 'generate') {
      assert.ok(!value.generated?.content && !value.accepted?.content, 'Never overwrite results')
      await executeRuntimeAction({ ...common, actionKey: 'GENERATE_SECTION', payload })
    } else {
      assert.ok(value.generated?.content && !value.accepted?.content)
      assert.equal(process.argv[5], `--generated=${hash(value.generated)}`, 'Exact independently reviewed generated hash required')
      await acceptRuntimeSection({ ...common, payload })
    }
    const saved = await find(TARGET)
    assert.equal(hash(saved.framework_state.evidence_pack), packHash)
    assert.deepEqual(json(Object.fromEntries(Object.entries(saved.framework_state.sections).filter(([key]) => key !== field))), otherSections)
    const savedValue = saved.framework_state.sections[field]
    assert.deepEqual(json(savedValue.revisions), previousValue.revisions)
    if (mode === 'accept') {
      assert.deepEqual(json(savedValue.generated), previousValue.generated)
      assert.equal(savedValue.accepted.content, previousValue.generated.content)
      assert.deepEqual(json(savedValue.accepted.sectionIntelligence), previousValue.generated.sectionIntelligence)
    } else {
      assert.equal(savedValue.accepted, null)
      assert.ok(savedValue.generated.sectionIntelligence)
    }
    emit({ sectionKey: section.sectionKey, generatedHash: hash(savedValue.generated), accepted: Boolean(savedValue.accepted?.content) })
  }
  target = await find(TARGET)
  const verification = target ? await verify(target, ['action-plan', 'action-probe'].includes(mode)) : null
  await protect()
  assert.equal(hash(await FrameworkPackage.findById(pkg._id).lean()), packageHash)
  emit({ result: 'PASS', mode, targetKey: TARGET, fingerprint: hash(target), verification, protectedUnchanged: true,
    ...(mode === 'read' ? { sections: target?.framework_state.sections } : {}),
    generatedHash: target?.framework_state.sections.customer_context.generated ? hash(target.framework_state.sections.customer_context.generated) : null,
    evidenceHash: target ? hash(target.framework_state.evidence_pack) : null })
} catch (error) {
  emit({ result: 'STOPPED', mode, message: error.message, code: error.code, details: error.details, recovery: 'Reconcile target before retry; no automatic compensation or result edits.' })
  process.exitCode = 1
} finally { await disconnectDb() }
