import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
const { default: env } = await import('../src/config/env.js')
assert.ok(['development', 'test'].includes(env.appEnv) && !env.isAppProduction)
const { connectDb, disconnectDb } = await import('../src/config/db.js')
const { RuntimeInstance, FrameworkPackage, User } = await import('../src/models/index.js')
const { default: RuntimeEvidenceObject } = await import('../src/models/RuntimeEvidenceObject.js')
const { buildUserPermissionsSnapshot } = await import('../src/services/performanceCacheService.js')
const { createRuntimeInstance } = await import('../src/services/runtimeInstanceService.js')
const { updateRuntimeDiscoveryInputs, acceptRuntimeDiscovery, acceptRuntimeSection } = await import('../src/services/runtimeStateMutationService.js')
const { executeRuntimeAction } = await import('../src/services/runtimeActionExecutionService.js')
const { buildRuntimeSectionReasoningProviderRuntime } = await import('../src/config/runtimeSectionReasoningProvider.js')
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const sourceKey = 'ss017-vmf-v315-proof'
const targetKey = 'ss016-fresh-discovery-proof'
const sourceHash = 'f18c484f8cd568f39029b81fa4ec6fb5c25938c8835b879d092cb4feba68c697'
const stage = process.argv[2] || 'plan'
assert.ok(['plan', 'create', 'discovery', 'generate', 'accept'].includes(stage))
await connectDb({ autoIndex: false })
try {
  assert.equal(mongoose.connection.name, 'test')
  const source = await RuntimeInstance.findOne({ runtimeInstanceKey: sourceKey }).lean()
  assert.equal(hash(source), sourceHash)
  const actor = await User.findById('698b3800f83b3257365fd7a3')
  const permissions = await buildUserPermissionsSnapshot(actor)
  assert.ok(permissions.isActive && permissions.platformRoles.includes('SUPER_ADMIN'))
  const scopes = { ...permissions, customer: { _id: source.customerId }, tenant: { _id: source.tenantId, customerId: source.customerId } }
  const common = { actorUserId: String(actor._id), scopes, runtimeInstanceId: targetKey }
  const pkg = await FrameworkPackage.findById(source.packageId).lean()
  assert.equal(pkg.version, '3.1.5')
  assert.equal(pkg.status, 'ACTIVE')
  const findTarget = () => RuntimeInstance.findOne({ runtimeInstanceKey: targetKey }).lean()
  const target = await findTarget()
  const fingerprint = hash(target)
  const inputs = source.framework_state.evidence_pack.inputs
  assert.deepEqual(Object.keys(inputs).sort(), ['companyName', 'companyWebsite', 'marketRegion', 'notes', 'targetOffer'])
  const sections = pkg.sections.filter(s => s.runtimePath?.startsWith('framework_state.sections.'))
  assert.equal(sections.length, 6)
  console.log('FRESH_PLAN=' + JSON.stringify({ stage, targetKey, fingerprint, sourceHash, inputs, sections: sections.map(s => s.sectionKey), targetStatus: target?.status, syntheticOnly: true }))
  if (stage !== 'plan') assert.equal(process.argv[3], `--confirm=${fingerprint}`)
  if (stage === 'create') {
    assert.equal(target, null)
    await createRuntimeInstance({ ...common, payload: {
      customerId: String(source.customerId), tenantId: String(source.tenantId), frameworkPackageId: String(pkg._id),
      frameworkKey: 'VMF', runtimeType: 'VALUE_NARRATIVE', runtimeInstanceKey: targetKey,
      name: 'SS-016 Fresh Discovery Workflow Proof', description: 'Synthetic workflow verification from five existing SS-017 user inputs. No copied evidence or generated results; no website/document acquisition claimed.',
    } })
  }
  if (stage === 'discovery') {
    assert.equal(target.status, 'ACTIVE')
    assert.equal((target.framework_state.evidence_pack?.evidenceObjects || []).length, 0)
    await updateRuntimeDiscoveryInputs({ ...common, payload: { inputs, acquisitionProfile: 'STANDARD', expectedUpdatedAt: new Date(target.updatedAt).toISOString() } })
    const pending = await findTarget()
    const objects = pending.framework_state.evidence_pack.evidenceObjects
    assert.equal(objects.length, 5)
    assert.ok(objects.every(e => e.reviewStatus === 'PENDING' && e.validationStatus === 'UNVALIDATED'))
    const facts = objects.map(e => [e.evidenceObjectId, e.sourceId, e.extractedFact])
    await acceptRuntimeDiscovery({ ...common, payload: { expectedUpdatedAt: new Date(pending.updatedAt).toISOString() } })
    const accepted = await findTarget()
    const acceptedObjects = accepted.framework_state.evidence_pack.evidenceObjects
    assert.deepEqual(acceptedObjects.map(e => [e.evidenceObjectId, e.sourceId, e.extractedFact]), facts)
    assert.ok(acceptedObjects.every(e => e.reviewStatus === 'ACCEPTED' && e.validationStatus === 'VALIDATED' && e.graphReadyMetadata.validationStatus === 'VALIDATED'))
    const rows = await RuntimeEvidenceObject.find({ runtimeInstanceId: accepted._id, customerId: accepted.customerId, tenantId: accepted.tenantId, current: true, stateVersion: accepted.stateVersion }).lean()
    const shape = rows => rows.map(e => [e.evidenceObjectId, e.sourceId, e.extractedFact, e.reviewStatus, e.validationStatus]).sort((a, b) => a[0].localeCompare(b[0]))
    assert.deepEqual(shape(rows), shape(acceptedObjects))
    console.log('FRESH_DISCOVERY=' + JSON.stringify({ evidenceCount: rows.length, factsUnchangedDuringAcceptance: true, validatedRootV2Parity: true, contradictionCount: accepted.framework_state.evidence_pack.discoveryHealth.contradictionCandidates.length }))
  }
  if (stage === 'generate') {
    assert.equal(target.status, 'ACTIVE')
    const provider = buildRuntimeSectionReasoningProviderRuntime()
    assert.equal(provider.status.configured, true, provider.status.reason)
    console.log('FRESH_PROVIDER=' + JSON.stringify(provider.status))
    const evidenceHash = hash(target.framework_state.evidence_pack)
    for (const section of sections) {
      const current = await findTarget()
      assert.equal(hash(current.framework_state.evidence_pack), evidenceHash)
      const stateKey = section.runtimePath.split('.').at(-1)
      assert.ok(!current.framework_state.sections?.[stateKey]?.generated?.content, 'Do not overwrite generated results')
      await executeRuntimeAction({ ...common, actionKey: 'GENERATE_SECTION', payload: { sectionKey: section.sectionKey, runtimePath: section.runtimePath, expectedUpdatedAt: new Date(current.updatedAt).toISOString() } })
      const next = await findTarget()
      assert.equal(hash(next.framework_state.evidence_pack), evidenceHash)
      console.log('FRESH_GENERATED=' + JSON.stringify({ sectionKey: section.sectionKey, section: next.framework_state.sections[stateKey] }))
    }
  }
  if (stage === 'accept') {
    assert.equal(target.status, 'ACTIVE')
    for (const section of sections) {
      const current = await findTarget()
      await acceptRuntimeSection({ ...common, payload: { sectionKey: section.sectionKey, runtimePath: section.runtimePath, expectedUpdatedAt: new Date(current.updatedAt).toISOString() } })
    }
  }
  assert.equal(hash(await RuntimeInstance.findOne({ runtimeInstanceKey: sourceKey }).lean()), sourceHash)
  const result = await findTarget()
  console.log('FRESH_RESULT=' + JSON.stringify({ targetKey, fingerprint: hash(result), status: result?.status, sourceUnchanged: true, stage }))
} catch (error) {
  console.error('FRESH_ERROR=' + JSON.stringify({ code: error.code, reason: error.reason, message: error.message, details: error.details }))
  process.exitCode = 1
} finally {
  await disconnectDb()
}
