import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import mongoose from 'mongoose'
import { parse } from 'yaml'

mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
const { default: env } = await import('../src/config/env.js')
assert.equal(env.isAppProduction, false, 'Development/Test only')
assert.ok(['development', 'test'].includes(env.appEnv), 'Explicit Development/Test environment required')
const { connectDb, disconnectDb } = await import('../src/config/db.js')
const { KnowledgePack, KnowledgePackVersion, KnowledgePackActivation, RuntimeInstance, User, AuditLog } = await import('../src/models/index.js')
const registry = await import('../src/services/outcomeKnowledgePackRegistryService.js')
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const packageKey = 'standard-package-value-mapping-framework-3-1-5-runtime-knowledge-model'
const packId = 'kp-arl-adaptive-reasoning-layer'
const versionId = 'kpv-arl-adaptive-reasoning-layer-1-0-1-global'
const baselineId = 'kpv-arl-adaptive-reasoning-layer-1-0-0-global'
const scope = { scopeType: 'PACKAGE', frameworkKey: 'VMF', packageKey, packageVersion: '3.1.5' }
const scopeKey = `PACKAGE:VMF:${packageKey}:3.1.5`.toUpperCase()
const actorUserId = '698b3800f83b3257365fd7a3'
const source = await readFile(new URL('../../docs/product-specs/source-artifacts/2026-06-15-governed-outcome-studio-oes-002/knowledge-packs-v1/adaptive-reasoning-layer-v1.yaml', import.meta.url), 'utf8')
assert.equal(hash(source), '9aed20834f19f826674f97bf73be70df842237c3b93b727f102c824317eb4109')
const content = source.trim()
const contentHash = `sha256:${hash(content)}`
assert.equal(contentHash, 'sha256:17bfb740b130009ababe8a1bc15d9c0650f2ad7c7863b2ebdcb11ed1a08df2f0')
const document = parse(content)
assert.equal(document.pack.key, 'adaptive-reasoning-layer')
for (const values of [document.truth_binding_rules.must_preserve, document.truth_binding_rules.must_not, document.reasoning_stages, document.safety_gates]) assert.ok(Array.isArray(values) && values.length)

await connectDb({ autoIndex: false })
try {
  assert.equal(mongoose.connection.name, 'test', 'Exact Development/Test database required')
  const admin = await User.findById(actorUserId).lean()
  assert.ok(admin?.isActive && admin.memberships.some(m => !m.customerId && m.roles.includes('SUPER_ADMIN')), 'Stored administrator authority required')
  const pack = await KnowledgePack.findOne({ packId }).lean()
  assert.equal(pack?.packKey, 'adaptive-reasoning-layer')
  assert.equal(pack.boundary, 'GENERATION_CONTEXT')
  const baseline = await KnowledgePackVersion.findOne({ versionId: baselineId }).select('+content').lean()
  assert.equal(baseline.contentHash, 'sha256:227d3dce4cd83316166608be7b0c346a0079753ed1cdfb329bc9e9398f50eb4c')
  const globals = await KnowledgePackActivation.find({ packKey: { $in: ['adaptive-reasoning-layer', 'rendering-layer'] }, scopeType: 'GLOBAL', status: 'ACTIVE' }).sort({ activationId: 1 }).lean()
  assert.equal(globals.find(x => x.packKey === 'adaptive-reasoning-layer')?.versionId, baselineId)
  assert.equal(globals.find(x => x.packKey === 'rendering-layer')?.versionId, 'kpv-rl-rendering-layer-1-0-1-global')
  const runtimeQuery = { $or: [{ packageKey, packageVersion: '3.1.5' }, { runtimeInstanceKey: 'value-narrative-82ae435990f9-rev-2-b08b10ea' }] }
  const runtimes = await RuntimeInstance.find(runtimeQuery).sort({ runtimeInstanceKey: 1 }).lean()
  assert.deepEqual(runtimes.map(r => r.runtimeInstanceKey), ['ss016-parlon-v315-validation', 'ss017-vmf-v315-proof', 'value-narrative-82ae435990f9-rev-2-b08b10ea'])
  const target = await KnowledgePackVersion.findOne({ versionId }).select('+content').lean()
  const active = await KnowledgePackActivation.find({ packId, scopeKey, status: 'ACTIVE' }).lean()
  if (target?.status === 'ACTIVE' && target.contentHash === contentHash && active.length === 1 && active[0].versionId === versionId) {
    console.log('ARL_RESULT=' + JSON.stringify({ mode: 'RECONCILED', actionsRequired: 0, versionId, contentHash, scope, globalBindingsPreserved: true }))
  } else {
    assert.equal(target, null, 'Target version collision; do not overwrite or auto-resume')
    assert.equal(active.length, 0, 'Existing package activation must not be replaced')
    const body = Object.fromEntries(['packType', 'packKey', 'label', 'description', 'purposeCategory', 'knowledgeLayer', 'capabilityKey', 'knowledgeAssetId', 'workspaceCompatibility', 'sourceAuthority', 'executionMode', 'boundary', 'visibility'].map(key => [key, pack[key]]))
    Object.assign(body, { semanticVersion: '1.0.1', schemaVersion: '1.0.0', dependencyReferences: [], contentFormat: 'YAML', extractedText: content,
      sourceDocument: { sourceDocumentId: `kpsrc-arl-adaptive-reasoning-layer-1-0-1-${hash(content).slice(0, 16)}`, filename: 'adaptive-reasoning-layer-v1.yaml', fileExtension: 'yaml', contentType: 'text/yaml', sourceType: 'SOURCE_DOCUMENT', sourceHash: contentHash, sizeBytes: Buffer.byteLength(content) } })
    const fingerprint = hash({ pack, baseline, globals, runtimes, body, scope })
    const plan = { mode: 'DRY_RUN', fingerprint, versionId, contentHash, scope, affectedRuntimes: runtimes.filter(r => r.packageKey === packageKey).map(r => r.runtimeInstanceKey), originalRuntimeUnchanged: true, baselineHash: hash(baseline), globalBindingsHash: hash(globals), runtimeResultsHash: hash(runtimes), actions: ['IMPORT', 'VALIDATE', 'READY_FOR_REVIEW', 'APPROVE', 'ACTIVATE_PACKAGE'] }
    console.log('ARL_PLAN=' + JSON.stringify(plan))
    const apply = process.argv.find(arg => arg.startsWith('--apply='))
    if (apply) {
      assert.equal(apply.slice(8), fingerprint, 'Dry-run fingerprint changed')
      const startedAt = new Date()
      const common = { packId, versionId, actorUserId }
      await registry.importOutcomeKnowledgePackSourceDocumentDraft({ body, actorUserId })
      await registry.validateOutcomeKnowledgePackVersion(common)
      const validated = await KnowledgePackVersion.findOne({ versionId }).lean()
      assert.equal(validated.status, 'VALIDATED')
      assert.equal(validated.validationSummary.status, 'PASSED')
      await registry.updateOutcomeKnowledgePackVersionReview({ ...common, body: { reviewStatus: 'READY_FOR_REVIEW' } })
      await registry.updateOutcomeKnowledgePackVersionReview({ ...common, body: { reviewStatus: 'APPROVED' } })
      await registry.activateOutcomeKnowledgePackVersion({ ...common, body: scope })
      const after = await KnowledgePackVersion.findOne({ versionId }).select('+content').lean()
      assert.equal(after.status, 'ACTIVE')
      assert.equal(after.reviewStatus, 'APPROVED')
      assert.equal(after.content, content)
      assert.equal(after.contentHash, contentHash)
      assert.equal(hash(await KnowledgePackVersion.findOne({ versionId: baselineId }).select('+content').lean()), hash(baseline))
      assert.equal(hash(await KnowledgePackActivation.find({ packKey: { $in: ['adaptive-reasoning-layer', 'rendering-layer'] }, scopeType: 'GLOBAL', status: 'ACTIVE' }).sort({ activationId: 1 }).lean()), hash(globals))
      assert.equal(hash(await RuntimeInstance.find(runtimeQuery).sort({ runtimeInstanceKey: 1 }).lean()), hash(runtimes), 'Runtime results must remain unchanged')
      const activation = await KnowledgePackActivation.findOne({ packId, versionId, scopeKey, status: 'ACTIVE' }).lean()
      assert.ok(activation)
      const audits = await AuditLog.find({ resourceId: pack._id, ts: { $gte: startedAt } }).select('action ts').sort({ ts: 1 }).lean()
      for (const action of ['OUTCOME_KNOWLEDGE_PACK_VERSION_UPLOADED', 'OUTCOME_KNOWLEDGE_PACK_VERSION_VALIDATED', 'KNOWLEDGE_PACK_REVIEW_STATUS_UPDATED', 'OUTCOME_KNOWLEDGE_PACK_ACTIVATED']) assert.ok(audits.some(a => a.action === action), `Missing audit ${action}`)
      console.log('ARL_RESULT=' + JSON.stringify({ ...plan, mode: 'COMMITTED_VERIFIED', actionsRequired: 0, activationId: activation.activationId, audits, runtimeResultsUnchanged: true, globalBindingsPreserved: true, baselinePreserved: true }))
    }
  }
} catch (error) {
  console.error(JSON.stringify({ code: error.code, reason: error.reason, message: error.message, details: error.details }))
  process.exitCode = 1
} finally {
  await disconnectDb()
}
