import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
const { default: env } = await import('../src/config/env.js')
assert.ok(['development', 'test'].includes(env.appEnv) && !env.isAppProduction)
const { connectDb, disconnectDb } = await import('../src/config/db.js')
const { RuntimeInstance, FrameworkPackage, User, RuntimePathRegistry } = await import('../src/models/index.js')
const { getRuntimeRenderer } = await import('../src/services/runtimeRendererService.js')
const { validateRuntimeMutation } = await import('../src/services/runtimeValidation/runtimeMutationValidator.js')
const { default: auditService } = await import('../src/services/auditService.js')
const { buildUserPermissionsSnapshot } = await import('../src/services/performanceCacheService.js')
const { createRuntimeInstance } = await import('../src/services/runtimeInstanceService.js')
const { mutateRuntimeState, updateRuntimeDiscoveryInputs, acceptRuntimeDiscovery, getRuntimeDiscoveryContradictions, reviewRuntimeDiscoveryContradiction } = await import('../src/services/runtimeStateMutationService.js')
const targetKey = 'ss016-contradiction-review-proof'
const mode = process.argv[2] || 'plan'
assert.ok(['plan', 'prepare', 'read', 'negative', 'setup-plan', 'setup'].includes(mode))
if (['prepare', 'negative', 'setup'].includes(mode)) assert.equal(process.argv[3], '--confirm-synthetic-only')
const hash = (value) => createHash('sha256').update(JSON.stringify(value === undefined ? { absent: true } : value)).digest('hex')
const emptyMetadataKeys = ['review', 'dependencies', 'validation', 'confidence', 'intelligence', 'metrics', 'additionalEvidence', 'gsilContext']
const compareEmptySection = (root, detail) => {
  assert.ok(root.input === undefined || JSON.stringify(root.input) === '{}')
  assert.ok(detail.input === null || JSON.stringify(detail.input) === '{}')
  for (const section of [root, detail]) {
    assert.equal(section.generated, null)
    assert.equal(section.accepted, null)
    assert.equal(section.state.status, 'DRAFT')
    assert.ok(Object.keys(section).every((key) => ['input', 'generated', 'accepted', 'state', 'lineage', 'revisions', 'evidenceObjects', ...emptyMetadataKeys].includes(key)))
  }
  const normalize = (section) => {
    const normalized = { ...section, input: {} }
    for (const key of emptyMetadataKeys) {
      assert.ok(section[key] === undefined || JSON.stringify(section[key]) === '{}')
      normalized[key] = {}
    }
    return normalized
  }
  assert.deepEqual(normalize(root), normalize(detail))
}
await connectDb({ autoIndex: false })
try {
  assert.equal(mongoose.connection.name, 'test')
  const source = await RuntimeInstance.findOne({ runtimeInstanceKey: 'ss016-fresh-discovery-proof' }).select('customerId tenantId packageId').lean()
  assert.ok(source)
  const actor = await User.findById('698b3800f83b3257365fd7a3')
  const permissions = await buildUserPermissionsSnapshot(actor)
  assert.ok(permissions.isActive && permissions.platformRoles.includes('SUPER_ADMIN'))
  const scopes = { ...permissions, customer: { _id: source.customerId }, tenant: { _id: source.tenantId, customerId: source.customerId } }
  const common = { actorUserId: String(actor._id), scopes, runtimeInstanceId: targetKey }
  const pkg = await FrameworkPackage.findById(source.packageId).select('version status').lean()
  assert.equal(pkg.version, '3.1.5')
  assert.equal(pkg.status, 'ACTIVE')
  const findTarget = () => RuntimeInstance.findOne({ runtimeInstanceKey: targetKey }).lean()
  const protectedKeys = ['ss016-parlon-v315-validation', 'ss016-fresh-discovery-proof', 'value-narrative-82ae435990f9-rev-2-b08b10ea']
  const protectedHashes = async () => Object.fromEntries(await Promise.all(protectedKeys.map(async (key) => [key, hash(await RuntimeInstance.findOne({ runtimeInstanceKey: key }).lean())])))
  const protectedBefore = await protectedHashes()
  let target = await findTarget()
  const planFingerprint = hash({ targetKey, targetHash: hash(target), customerId: String(source.customerId), tenantId: String(source.tenantId), packageId: String(source.packageId), packageVersion: pkg.version, protectedBefore })
  if (['prepare', 'negative'].includes(mode)) assert.equal(process.argv[4], `--plan=${planFingerprint}`, 'Target or reviewed scope changed')
  if (target) {
    assert.equal(String(target.customerId), String(source.customerId))
    assert.equal(String(target.tenantId), String(source.tenantId))
    assert.equal(String(target.packageId), String(source.packageId))
    assert.equal(target.name, 'SS-016 Contradiction Review Proof')
  }
  if (['setup-plan', 'setup'].includes(mode)) {
    assert.ok(target)
    assert.deepEqual(Object.keys(target.framework_state.sections || {}), ['customer_context'], 'Reconciled one-section baseline only; never automatically resume')
    const pinnedExistingSectionHash = hash(target.framework_state.sections.customer_context)
    assert.equal(pinnedExistingSectionHash, 'e2adeb859f02d4b12c6125b577d69827bc168134f58830122bc25540472dd369')
    const renderer = await getRuntimeRenderer({ scopes, runtimeInstanceId: targetKey })
    const paths = renderer.sections.map((section) => section.runtimePath)
    const remainingPaths = paths.filter((path) => !Object.hasOwn(target.framework_state.sections, path.split('.').at(-1)))
    assert.equal(remainingPaths.length, 4)
    assert.equal(paths.length, 5)
    assert.equal(new Set(paths).size, paths.length)
    const registry = []
    for (const path of paths) {
      assert.match(path, /^framework_state\.sections\.[a-z_]+$/)
      assert.deepEqual(await validateRuntimeMutation({ runtimePath: path, operation: 'WRITE', frameworkKey: 'VMF', allowedWriteScopes: ['framework_state.sections.*'] }), [])
      const record = await RuntimePathRegistry.findOne({ pathKey: path }).lean()
      assert.equal(record.dataType, 'OBJECT', 'Empty object must pass the existing OBJECT validator')
      registry.push({ path, value: {}, dataType: record.dataType })
    }
    const setupFingerprint = hash({ planFingerprint, registry, remainingPaths, pinnedExistingSectionHash })
    console.log('SETUP_PLAN=' + JSON.stringify({ targetKey, setupFingerprint, registry, evidencePackHash: hash(target.framework_state.evidence_pack), protectedBefore }))
    if (mode === 'setup') {
      assert.equal(process.argv[4], `--plan=${setupFingerprint}`)
      const evidenceBefore = hash(target.framework_state.evidence_pack)
      let priorVerified = target
      for (const path of remainingPaths) {
        const current = await findTarget()
        assert.equal(hash(current), hash(priorVerified), 'Concurrent fixture change: stop before adopting a new timestamp')
        assert.equal(Object.hasOwn(current.framework_state.sections || {}, path.split('.').at(-1)), false)
        await mutateRuntimeState({ ...common, payload: { runtimePath: path, operation: 'WRITE', value: {}, expectedUpdatedAt: new Date(current.updatedAt).toISOString() } })
        const saved = await findTarget()
        assert.equal(hash(saved.framework_state.evidence_pack), evidenceBefore)
        const section = saved.framework_state.sections[path.split('.').at(-1)]
        assert.ok(section.input === undefined || JSON.stringify(section.input) === '{}')
        assert.equal(section.generated, null)
        assert.equal(section.accepted, null)
        assert.equal(hash(saved.framework_state.sections.customer_context), pinnedExistingSectionHash)
        priorVerified = saved
        console.log('SETUP_SAVED=' + JSON.stringify({ path, stateVersion: saved.stateVersion }))
      }
      target = await findTarget()
      assert.equal(Object.keys(target.framework_state.sections).length, paths.length)
      assert.equal(hash(target), hash(priorVerified))
      const rows = await mongoose.connection.collection('runtime_section_states').find({ runtimeInstanceId: target._id, runtimeInstanceKey: targetKey, customerId: target.customerId, tenantId: target.tenantId, stateVersion: target.stateVersion, sourceStateVersion: target.stateVersion, current: true }).toArray()
      assert.equal(rows.length, paths.length)
      assert.deepEqual(rows.map((row) => row.legacyPath).sort(), [...paths].sort())
      for (const row of rows) {
        assert.equal(row.sectionKey, row.legacyPath.split('.').at(-1))
        compareEmptySection(target.framework_state.sections[row.sectionKey], row.sectionDetail)
      }
      console.log('SETUP_DONE=' + JSON.stringify({ sectionCount: paths.length, v2CurrentSectionCount: rows.length, sectionsHash: hash(target.framework_state.sections), evidencePackUnchanged: hash(target.framework_state.evidence_pack) === evidenceBefore }))
    }
  }
  if (mode === 'plan') {
    console.log('PROOF=' + JSON.stringify({ mode, targetKey, planFingerprint, exists: Boolean(target), packageVersion: pkg.version, protectedBefore, plannedWrites: 'One new synthetic runtime, five supplied test inputs through normal Discovery; no customer evidence or results changed.' }))
  }
  if (mode === 'prepare') {
    assert.equal(target, null, 'Never overwrite an existing fixture')
    await createRuntimeInstance({ ...common, payload: {
      customerId: String(source.customerId), tenantId: String(source.tenantId), frameworkPackageId: String(source.packageId),
      frameworkKey: 'VMF', runtimeType: 'VALUE_NARRATIVE', runtimeInstanceKey: targetKey,
      name: 'SS-016 Contradiction Review Proof', description: 'Synthetic review-action verification only. Not customer evidence or business truth.',
    } })
    target = await findTarget()
    await updateRuntimeDiscoveryInputs({ ...common, payload: {
      expectedUpdatedAt: new Date(target.updatedAt).toISOString(), acquisitionProfile: 'STANDARD',
      inputs: { companyWebsite: 'https://example.com', companyName: 'Not a real customer - SS-016 synthetic review fixture', marketRegion: 'Synthetic test market', targetOffer: 'Synthetic review test platform', notes: 'Synthetic workflow verification only.' },
    } })
    target = await findTarget()
    await acceptRuntimeDiscovery({ ...common, payload: { expectedUpdatedAt: new Date(target.updatedAt).toISOString() } })
    target = await findTarget()
    assert.equal(target.framework_state.evidence_pack.evidenceObjects.length, 5)
    console.log('PREPARED=' + JSON.stringify({ targetKey, id: String(target._id), stateVersion: target.stateVersion, evidenceHash: hash(target.framework_state.evidence_pack.evidenceObjects), sectionsHash: hash(target.framework_state.sections), protectedBefore }))
  }
  if (!['plan', 'setup-plan'].includes(mode)) {
    const view = await getRuntimeDiscoveryContradictions(common)
    assert.equal(view.candidates.length, 1)
    assert.ok(view.candidates[0].evidencePairHash)
    if (mode === 'negative') {
      const before = await findTarget()
      const rowHashes = async () => Object.fromEntries(await Promise.all(['runtime_section_states', 'runtime_evidence_objects', 'runtime_evidence_sources', 'runtime_graph_snapshots', 'runtime_graph_elements', 'runtime_state_migration_receipts'].map(async (name) => {
        const rows = await mongoose.connection.collection(name).find({ runtimeInstanceId: before._id }).sort({ _id: 1 }).toArray()
        return [name, { count: rows.length, hash: hash(rows) }]
      })))
      const rowsBefore = await rowHashes()
      const auditCount = () => mongoose.connection.collection('auditlogs').countDocuments({ resourceId: before._id, action: 'RUNTIME_STATE_MUTATED' })
      const auditBefore = await auditCount()
      const payload = { expectedUpdatedAt: new Date(view.runtimeUpdatedAt).toISOString(), expectedEvidencePairHash: view.candidates[0].evidencePairHash, disposition: 'NOT_CONTRADICTORY', rationale: 'The test-only identity and example website are compatible; this is not customer evidence.', confirm: true }
      const log = auditService.log
      try {
        auditService.log = async (event, options) => {
          if (String(event.resourceId) === String(before._id) && event.diff?.contradictionReview) throw new Error('SS016_SYNTHETIC_AUDIT_FAILURE')
          return log.call(auditService, event, options)
        }
        await assert.rejects(reviewRuntimeDiscoveryContradiction({ ...common, contradictionId: view.candidates[0].contradictionId, payload }), { code: 'RUNTIME_STATE_MUTATION_AUDIT_FAILED' })
      } finally { auditService.log = log }
      assert.equal(hash(await findTarget()), hash(before))
      assert.deepEqual(await rowHashes(), rowsBefore)
      assert.equal(await auditCount(), auditBefore)
      await assert.rejects(reviewRuntimeDiscoveryContradiction({ ...common, contradictionId: view.candidates[0].contradictionId, payload: { ...payload, expectedEvidencePairHash: 'sha256:' + '0'.repeat(64) } }), (error) => error.details.reason === 'CONTRADICTION_REVIEW_STALE')
      assert.equal(hash(await findTarget()), hash(before))
      assert.deepEqual(await rowHashes(), rowsBefore)
      assert.equal(await auditCount(), auditBefore)
      console.log('NEGATIVE=' + JSON.stringify({ auditFailureRollback: true, stalePairNoWrite: true, v2RowsUnchanged: rowsBefore, auditBefore, targetHash: hash(before) }))
    }
    const fresh = await findTarget()
    console.log('READBACK=' + JSON.stringify({ targetKey, view, evidenceHash: hash(fresh.framework_state.evidence_pack.evidenceObjects), sectionsHash: hash(fresh.framework_state.sections), stateVersion: fresh.stateVersion, reviews: fresh.framework_state.evidence_pack.contradictionReviews || [] }))
  }
  assert.deepEqual(await protectedHashes(), protectedBefore)
  console.log('PROTECTED_UNCHANGED=true')
} finally { await disconnectDb() }
