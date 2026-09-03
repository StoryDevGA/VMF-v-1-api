// PREPARED ONLY. Execute only after main confirms all five acceptances complete.
// node .tmp/ss016-query-accepted-truth.mjs --expected-fingerprint=<64 lowercase hex>
// Fingerprint matches benchmark SHA256(JSON.stringify(Mongoose lean default projection)).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'

const expected = process.argv[2]?.match(/^--expected-fingerprint=([a-f0-9]{64})$/)?.[1]
assert.ok(expected && process.argv.length === 3, 'One expected-fingerprint argument required')
mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
const { default: env } = await import('../src/config/env.js')
assert.ok(['development', 'test'].includes(env.appEnv) && !env.isAppProduction)
assert.ok(process.env.SS014_READONLY_MONGODB_URI, 'Dedicated read-only URI required')
const { RuntimeInstance, User } = await import('../src/models/index.js')
const repo = await import('../src/services/runtimeStateRepository.js')
const { getRuntimeRenderer } = await import('../src/services/runtimeRendererService.js')
const { buildUserPermissionsSnapshot } = await import('../src/services/performanceCacheService.js')

const TARGET = 'ss016-parlon-fresh-framework-benchmark'
const SOURCE = 'value-narrative-82ae435990f9-rev-2-b08b10ea'
const SOURCE_HASH = '0fd04add87cc6a75dc42c64a3ad70c0e9609d92f9b3d6b30cd8ce0e6b0003b77'
const CUSTOMER = '6a6c75f2cace7a21bd41ef98'
const TENANT = '6a6c76e3cace7a21bd41eff9'
const KEYS = ['customer_context', 'strategic_objectives', 'current_state_assessment', 'stakeholder_register', 'evidence_register']
const destination = fileURLToPath(new URL('../../docs/generated/harness-runs/ss-016/2026-09-03-guided-accepted-truth/accepted-output-query/', import.meta.url))
const scope = { customerId: new mongoose.Types.ObjectId(CUSTOMER), tenantId: new mongoose.Types.ObjectId(TENANT) }
const options = { maxTimeMS: 5000 }
const hashBytes = value => createHash('sha256').update(value).digest('hex')
const hash = value => hashBytes(JSON.stringify(value))
const json = value => JSON.parse(JSON.stringify(value))
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const stableHash = value => hash(canonical(json(value)))
const rootFilter = key => ({ ...scope, runtimeInstanceKey: key })
const readRoot = key => RuntimeInstance.findOne(rootFilter(key)).maxTimeMS(5000).lean()
const readNativeRoot = key => RuntimeInstance.collection.findOne(rootFilter(key), options)
const assertNativeLeanParity = (native, lean) => {
  assert.ok(native && lean, 'Exact native/lean runtime missing')
  assert.ok(Object.hasOwn(native, 'runtimeCapacitySlot'), 'Expected native capacity field missing')
  assert.ok(!Object.hasOwn(lean, 'runtimeCapacitySlot'), 'Model default projection changed')
  // Compare only; never modify the native record or rewrite persisted data.
  const { runtimeCapacitySlot: _capacitySlot, ...nativeDefaultProjection } = native
  assert.deepEqual(json(nativeDefaultProjection), json(lean), 'Native/lean difference beyond runtimeCapacitySlot')
}
const fieldCounts = value => Object.fromEntries(Object.entries(value || {}).map(([key, item]) => [key,
  Array.isArray(item) ? item.length : typeof item === 'string' ? [...item].length : item && typeof item === 'object' ? Object.keys(item).length : item == null ? 0 : 1]))
const refs = value => {
  const found = []
  const walk = node => {
    if (!node || typeof node !== 'object') return
    for (const [key, item] of Object.entries(node)) {
      if (['evidenceRefs', 'sourceTraceability', 'supportingEvidenceRefs'].includes(key)) {
        assert.ok(Array.isArray(item) && item.every(id => typeof id === 'string'), 'Malformed citation array')
        found.push(...item)
      } else walk(item)
    }
  }
  walk(value)
  return [...new Set(found)].sort()
}
const payload = new Map()
const add = (name, value) => {
  const text = JSON.stringify(value, null, 2) + '\n'
  assert.ok(!/mongodb(?:\+srv)?:\/\/|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|Bearer\s+[A-Za-z0-9_.-]{30,}/i.test(text), 'Credential-like export content')
  assert.ok(!/[?&](?:X-Amz-Signature|X-Goog-Signature|access_token|token|sig)=/i.test(text), 'Signed access URL')
  assert.ok(!/"(?:password|passwordHash|apiKey|clientSecret|accessToken|refreshToken|authorization)"\s*:\s*"[^"\s]+"/i.test(text), 'Secret field')
  assert.ok(!payload.has(name))
  payload.set(name, text)
}

try {
  await mongoose.connect(process.env.SS014_READONLY_MONGODB_URI, {
    autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000, readConcern: { level: 'majority' },
  })
  assert.equal(mongoose.connection.name, 'test')
  const access = await mongoose.connection.db.command({ connectionStatus: 1, showPrivileges: true })
  assert.deepEqual(access.authInfo.authenticatedUserRoles, [{ role: 'read', db: 'test' }])
  const allowed = new Set(['changeStream', 'collStats', 'dbHash', 'dbStats', 'find', 'killCursors', 'listCollections', 'listIndexes', 'listSearchIndexes', 'planCacheRead'])
  assert.ok(access.authInfo.authenticatedUserPrivileges?.length)
  for (const privilege of access.authInfo.authenticatedUserPrivileges) {
    assert.equal(privilege.resource.db, 'test')
    assert.ok(privilege.actions.every(action => allowed.has(action)), 'Unexpected privilege')
  }
  const startedAt = new Date().toISOString()
  const root = await readRoot(TARGET)
  const source = await readRoot(SOURCE)
  const nativeRoot = await readNativeRoot(TARGET)
  const nativeSource = await readNativeRoot(SOURCE)
  assertNativeLeanParity(nativeRoot, root)
  assertNativeLeanParity(nativeSource, source)
  assert.ok(root && source, 'Exact scoped runtime missing')
  assert.equal(hash(root), expected, 'Target fingerprint mismatch before reads')
  assert.equal(hash(source), SOURCE_HASH, 'Original source changed')
  assert.ok(root.stateVersion, 'V2 state version required')
  const original = source.framework_state.evidence_pack
  const pack = root.framework_state.evidence_pack
  assert.equal(original.evidenceObjects.length, 803)
  assert.equal(original.sourceRegistry.length, 33)
  assert.equal(hash(pack.evidenceObjects), hash(original.evidenceObjects), 'Original evidence altered')
  assert.equal(hash(pack.sourceRegistry), hash(original.sourceRegistry), 'Original sources altered')
  assert.ok(pack.evidenceObjects.every(row => row.reviewStatus === 'ACCEPTED'))
  assert.equal(pack.evidenceObjects.filter(row => row.validationStatus === 'UNVALIDATED').length, 333)
  assert.equal(pack.evidenceObjects.filter(row => row.validationStatus === 'VALIDATED').length, 470)
  const ids = new Set(pack.evidenceObjects.map(row => row.evidenceObjectId))
  assert.equal(ids.size, 803)
  const actor = await User.findById(source.createdBy).maxTimeMS(5000)
  assert.ok(actor && actor.isActive && actor.name === 'Andrew Mallaband', 'Expected active actor required')
  const permissions = await buildUserPermissionsSnapshot(actor)
  const scopes = { ...permissions, customer: { _id: root.customerId }, tenant: { _id: root.tenantId, customerId: root.customerId } }
  const args = { scopes, runtimeInstanceId: TARGET }
  const summaries = []
  const selectedHashes = new Map()
  for (const key of KEYS) {
    const response = await repo.getRuntimeStateSectionSummary({ ...args, sectionKey: key })
    assert.equal(response.control.stateVersion, root.stateVersion)
    assert.equal(response.section.stateVersion, root.stateVersion)
    assert.equal(response.section.sectionKey, key)
    const detail = response.section.sectionDetail
    const rootDetail = repo.__testables.materializeStoredRuntimeSectionDetail(root.framework_state.sections[key])
    assert.equal(detail.review?.status, 'ACCEPTED', `Not accepted: ${key}`)
    assert.ok(detail.accepted?.content && detail.generated?.content, `Missing rich truth: ${key}`)
    assert.equal(detail.accepted.content, detail.generated.content, `Accepted/generated content mismatch: ${key}`)
    assert.ok(detail.generated.sectionIntelligence && typeof detail.generated.sectionIntelligence === 'object'
      && !Array.isArray(detail.generated.sectionIntelligence), `Missing rich intelligence: ${key}`)
    assert.deepEqual(detail.accepted.sectionIntelligence, detail.generated.sectionIntelligence, `Accepted/generated intelligence mismatch: ${key}`)
    for (const field of ['accepted', 'generated', 'review', 'dependencies']) {
      assert.equal(stableHash(detail[field] ?? null), stableHash(rootDetail?.[field] ?? null), `Root/V2 mismatch: ${key}.${field}`)
    }
    const acceptedRefs = refs(detail.accepted)
    const generatedRefs = refs(detail.generated)
    assert.ok([...acceptedRefs, ...generatedRefs].every(id => ids.has(id)), `Unknown citation: ${key}`)
    const included = detail.generated.evidenceProjection?.included
    assert.ok(Array.isArray(included) && included.length === 803, `Incomplete manifest: ${key}`)
    assert.deepEqual([...new Set(included.map(row => row.evidenceObjectId))].sort(), [...ids].sort())
    selectedHashes.set(key, stableHash(response.section))
    add(`${key}.json`, { provenance: 'NORMAL_V2_SELECTED_SECTION_READ_FULL_DETAIL', ...response })
    summaries.push({ sectionKey: key, reviewStatus: detail.review.status,
      hashes: Object.fromEntries(['accepted', 'generated', 'review', 'dependencies'].map(field => [field, stableHash(detail[field] ?? null)])),
      acceptedIntelligenceFieldCounts: fieldCounts(detail.accepted.sectionIntelligence),
      generatedIntelligenceFieldCounts: fieldCounts(detail.generated.sectionIntelligence),
      includedCount: included.length, acceptedRefs, generatedRefs, allReferencesValid: true,
      acceptedGeneratedContentEqual: true, acceptedGeneratedIntelligenceEqual: true,
      generator: detail.generated.generator, inputHash: detail.generated.inputHash,
      evidenceHash: detail.generated.evidenceHash, boundedContextHash: detail.generated.boundedContextHash })
  }
  const renderer = await getRuntimeRenderer(args)
  assert.equal(renderer.runtimeInstanceKey, TARGET)
  add('renderer.json', { provenance: 'NORMAL_RENDERER_READ_NOT_BROWSER_PROOF', result: renderer })
  let handoff = null
  let handoffReadFailure = null
  try {
    handoff = await repo.getRuntimeStateOutcomeHandoffReadiness(args)
  } catch (error) {
    if (error.code !== 'RUNTIME_STATE_V2_STORAGE_UNAVAILABLE' || error.status !== 503) throw error
    handoffReadFailure = { stage: 'HANDOFF', code: error.code, status: error.status }
  }
  if (handoffReadFailure) {
    add('handoff-diagnostics.json', { provenance: 'FAILED_NORMAL_READ_ONLY_HANDOFF_DIAGNOSTIC',
      readStatus: 'FAILED_READ', handoffCoverage: 'UNAVAILABLE', error: handoffReadFailure,
      separatelyVerifiedDiagnostic: { provenance: 'PRIOR_READ_ONLY_DIAGNOSTIC_2026_09_03_NOT_FIELDS_FROM_CURRENT_ERROR',
        fingerprint: '0a7352a123d4c9db80448f643719171eba875d1913a306ad33ce0bcf886a0663',
        collectionName: 'runtime_section_states', projectedRows: 6, projectedBatchBytes: 539881,
        configuredLimitBytes: 524288, boundary: 'readMany projected batch size guard',
        limitation: 'Generic current error does not independently establish the same underlying cause.' } })
  } else {
    assert.equal(handoff.control.stateVersion, root.stateVersion)
    add('handoff-diagnostics.json', { provenance: 'READINESS_DIAGNOSTIC_ONLY_NO_OUTPUT_TYPE_OR_KNOWLEDGE_BINDING_SUPPLIED', result: handoff })
  }
  const bundleStatus = handoffReadFailure ? 'COMPLETE_EXPORT_WITH_READ_FAILURE' : 'COMPLETE_WITH_DECLARED_LIMITATIONS'
  for (const key of KEYS) {
    const response = await repo.getRuntimeStateSectionSummary({ ...args, sectionKey: key })
    assert.equal(stableHash(response.section), selectedHashes.get(key), `Selected section drift: ${key}`)
    assert.equal(response.control.stateVersion, root.stateVersion)
  }
  const after = await readRoot(TARGET)
  assert.equal(hash(after), expected, 'Target fingerprint mismatch after reads')
  const sourceAfter = await readRoot(SOURCE)
  assert.equal(hash(sourceAfter), SOURCE_HASH, 'Original source changed after reads')
  const nativeAfter = await readNativeRoot(TARGET)
  const nativeSourceAfter = await readNativeRoot(SOURCE)
  assertNativeLeanParity(nativeAfter, after)
  assertNativeLeanParity(nativeSourceAfter, sourceAfter)
  assert.equal(hash(nativeAfter), hash(nativeRoot), 'Native target changed during reads')
  assert.equal(hash(nativeSourceAfter), hash(nativeSource), 'Native source changed during reads')
  const optionalBeforeHash = stableHash(root.framework_state.sections.output_requirements ?? null)
  const optionalAfterHash = stableHash(after.framework_state.sections.output_requirements ?? null)
  assert.equal(optionalAfterHash, optionalBeforeHash, 'Optional output requirements changed during read')
  const summary = { schemaVersion: 'ss016.guided-accepted-truth.v1', target: TARGET, customerId: CUSTOMER, tenantId: TENANT,
    runtimeId: String(root._id), stateVersion: root.stateVersion, packageId: String(root.packageId), actorUserId: String(actor._id),
    startedAt, finishedAt: new Date().toISOString(), database: 'test', databaseRole: 'read@test',
    fingerprintBefore: expected, fingerprintAfter: hash(after), sourceKey: SOURCE, sourceHash: SOURCE_HASH,
    nativeStability: { targetBeforeHash: hash(nativeRoot), targetAfterHash: hash(nativeAfter),
      sourceBeforeHash: hash(nativeSource), sourceAfterHash: hash(nativeSourceAfter),
      nativeLeanOnlyDifference: 'runtimeCapacitySlot', nativeLeanParityBeforeAfter: true },
    evidenceHash: hash(pack.evidenceObjects), sourcesHash: hash(pack.sourceRegistry),
    evidenceCount: 803, sourceCount: 33, acceptedEvidenceCount: 803, unvalidatedCount: 333, validatedCount: 470,
    guidedAcceptedCount: summaries.length, sections: summaries, bundleStatus,
    handoffStatus: handoff?.status ?? null, handoffReadStatus: handoffReadFailure ? 'FAILED_READ' : 'SUCCESS',
    handoffCoverage: handoffReadFailure ? 'UNAVAILABLE' : 'READINESS_DIAGNOSTICS_ONLY',
    optionalOutputRequirements: { beforeHash: optionalBeforeHash, afterHash: optionalAfterHash,
      duringReadUnchanged: true, wholeWorkflowUnchanged: 'NOT_ASSESSED_NO_EARLIER_BASELINE_COMPARED' },
    hashConventions: { fingerprintAndSourceProtection: 'SHA256(JSON.stringify(Mongoose findOne lean model-default projection)) as benchmark; runtimeCapacitySlot is select:false',
      nativeStability: 'SHA256(JSON.stringify(native collection document)) including runtimeCapacitySlot',
      originalEvidenceAndSources: 'SHA256(JSON.stringify(stored array)) as benchmark',
      sectionPayloads: 'SHA256(sorted-key JSON after BSON JSON serialization)' },
    limitations: ['Confidential customer evidence; controlled sharing only.', 'Non-atomic before/after stability fence, not snapshot isolation or protection against change-and-revert.', 'Five selected V2 sections checked against root; no full V2 evidence/source export or parity claim.', 'Renderer is a server projection, not browser proof. Handoff is diagnostics only, not Outcome Studio execution or business acceptance.', 'Read services retain their normal authorization; access-denied audit attempts cannot persist under read@test.', 'No provider calls, generation, acceptance, lifecycle actions, source edits or database writes authorized.'] }
  add('summary.json', summary)
  const files = [...payload].map(([name, text]) => ({ name, bytes: Buffer.byteLength(text), sha256: hashBytes(text) }))
  add('manifest.json', { schemaVersion: summary.schemaVersion, complete: true, status: bundleStatus,
    handoffCoverage: summary.handoffCoverage, fingerprint: expected, files, excludes: ['manifest.json'],
    note: 'Absent final manifest means incomplete export. Complete describes the bundle, not successful handoff coverage.' })
  // Exclusive new subfolder: preserve existing parent reviews and reject any prior run.
  await fs.mkdir(destination, { recursive: false })
  for (const [name, text] of payload) {
    if (name === 'manifest.json') continue
    await fs.writeFile(path.join(destination, name), text, { flag: 'wx' })
  }
  for (const file of files) {
    const text = await fs.readFile(path.join(destination, file.name))
    assert.equal(hashBytes(text), file.sha256)
    JSON.parse(text.toString('utf8'))
  }
  await fs.writeFile(path.join(destination, 'manifest.json'), payload.get('manifest.json'), { flag: 'wx' })
  assert.equal(await fs.readFile(path.join(destination, 'manifest.json'), 'utf8'), payload.get('manifest.json'))
  console.log(JSON.stringify({ complete: true, status: bundleStatus, handoffCoverage: summary.handoffCoverage,
    guidedAcceptedCount: 5, files: payload.size, fingerprint: expected }))
} catch (error) {
  // Do not print driver/service error payloads: they may contain connection details.
  console.error(JSON.stringify({ complete: false, failureType: error instanceof assert.AssertionError ? 'GUARD_FAILED' : 'READ_OR_EXPORT_FAILED', guard: error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.code || 'READ_ERROR' }))
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
