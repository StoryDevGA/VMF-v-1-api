import 'dotenv/config'
import mongoose from 'mongoose'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'

// Read-only pre-accept review; never invokes an action, provider or audit service.
const apiRoot = fileURLToPath(new URL('../', import.meta.url))
const sectionKey = process.argv[2]
assert.ok(['customer-context', 'strategic-objectives', 'current-state-assessment',
  'stakeholder-register', 'evidence-register'].includes(sectionKey), 'SECTION_OUT_OF_SCOPE')
assert.equal(process.argv.length, 3, 'EXPECTED_ONE_SECTION_ARGUMENT')
assert.ok(process.env.SS014_READONLY_MONGODB_URI, 'READ_CREDENTIAL_REQUIRED')
mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
const { normalizeRuntimeSectionObject, RUNTIME_SECTION_STATES } =
  await import('../src/services/runtimeSectionModelService.js')
const { isBoundedRuntimeSectionDetail } = await import('../src/models/RuntimeStateSection.js')
const bytes = value => Buffer.byteLength(JSON.stringify(value))
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const source = fs.readFileSync(path.join(apiRoot, 'src/services/runtimeStateMutationService.js'), 'utf8')
const slice = (begin, end, from = 0) => {
  const start = source.indexOf(begin, from)
  const stop = source.indexOf(end, start + begin.length)
  assert.ok(start >= 0 && stop > start, 'PURE_BUILDER_ANCHORS_CHANGED')
  return source.slice(start, stop)
}
const toIdString = value => String(value || '')
const buildAccepted = vm.runInNewContext(
  slice('const cloneValue =', 'const normalizeRuntimePath =') +
  slice('const buildAcceptedSectionTruth =', 'const getDependencySectionKeys =') +
  ';buildAcceptedSectionTruth', {
    crypto, toIdString,
    isPlainObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  })
const acceptanceStart = source.indexOf('  const accepted = buildAcceptedSectionTruth({')
assert.ok(acceptanceStart >= 0, 'ACCEPTANCE_ANCHOR_CHANGED')
const assignment = slice('  nextFrameworkState.sections[target.stateSectionKey] = {',
  '  const dependencyInvalidations =', acceptanceStart)

let session
try {
  await mongoose.connect(process.env.SS014_READONLY_MONGODB_URI, {
    autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000,
  })
  const db = mongoose.connection.db
  assert.equal(db.databaseName, 'test', 'DATABASE_OUT_OF_SCOPE')
  const access = await db.command({ connectionStatus: 1, showPrivileges: true })
  assert.deepEqual(access.authInfo.authenticatedUserRoles, [{ role: 'read', db: 'test' }])
  const allowedActions = new Set(['changeStream', 'collStats', 'dbHash', 'dbStats', 'find',
    'killCursors', 'listCollections', 'listIndexes', 'listSearchIndexes', 'planCacheRead'])
  for (const privilege of access.authInfo.authenticatedUserPrivileges) {
    assert.equal(privilege.resource.db, 'test')
    assert.ok(privilege.actions.every(action => allowedActions.has(action)), 'EXCESS_PRIVILEGE')
  }
  session = mongoose.connection.getClient().startSession({ snapshot: true })
  const scope = {
    customerId: new mongoose.Types.ObjectId('6a6c75f2cace7a21bd41ef98'),
    tenantId: new mongoose.Types.ObjectId('6a6c76e3cace7a21bd41eff9'),
  }
  const runtime = await db.collection('runtime_instances').findOne({
    ...scope, runtimeInstanceKey: 'ss016-parlon-fresh-framework-benchmark',
  }, { session, maxTimeMS: 5000, projection: {
    framework_state: 1, stateVersion: 1, updatedAt: 1, runtimeInstanceKey: 1,
  } })
  assert.ok(runtime, 'EXACT_TARGET_MISSING')
  const stateKey = sectionKey.replaceAll('-', '_')
  const section = runtime.framework_state.sections[stateKey]
  const generated = section?.generated
  assert.ok(generated?.sectionIntelligence, 'RICH_GENERATION_MISSING')
  assert.ok(!section.accepted, 'ALREADY_ACCEPTED_STOP_PRE_ACCEPT_REVIEW')
  const rows = await db.collection('runtime_section_states').find({
    ...scope, runtimeInstanceId: runtime._id, sectionKey: stateKey, current: true,
  }, { session, maxTimeMS: 5000 }).limit(2).toArray()
  assert.equal(rows.length, 1, 'SCOPED_SECTION_NOT_UNIQUE')
  const row = rows[0]
  assert.equal(row.stateVersion, runtime.stateVersion, 'STATE_VERSION_MISMATCH')
  const acceptedAt = new Date().toISOString()
  const target = { sectionKey, stateSectionKey: stateKey,
    runtimePath: 'framework_state.sections.' + stateKey }
  const accepted = JSON.parse(JSON.stringify(buildAccepted({
    actorUserId: generated.generatedBy, acceptedAt, generated,
    previousAccepted: section.accepted, sectionKey, runtimePath: target.runtimePath,
  })))
  const nextFrameworkState = { sections: {} }
  vm.runInNewContext(assignment, {
    nextFrameworkState, target, sectionObject: section, accepted, acceptedAt,
    actorUserId: generated.generatedBy, toIdString, RUNTIME_SECTION_STATES, generated,
  })
  const candidate = JSON.parse(JSON.stringify(normalizeRuntimeSectionObject({
    value: nextFrameworkState.sections[stateKey], sectionKey: stateKey,
    runtimePath: target.runtimePath, initializedAt: acceptedAt,
  })))
  const evidence = runtime.framework_state.evidence_pack.evidenceObjects
  const sources = runtime.framework_state.evidence_pack.sourceRegistry
  const refs = generated.sectionIntelligence.sourceTraceability
  const generatedHash = hash(generated)
  const checks = {
    scopedGeneratedEqual: isDeepStrictEqual(row.sectionDetail.generated, generated),
    uniqueReferences: new Set(refs).size === refs.length,
    unresolvedOrDuplicateRefs: refs.filter(id => evidence.filter(e => e.evidenceObjectId === id).length !== 1),
    persistedValidator: isBoundedRuntimeSectionDetail(row.sectionDetail),
    acceptanceValidator: isBoundedRuntimeSectionDetail(candidate),
    acceptedRichEqual: isDeepStrictEqual(accepted.sectionIntelligence, generated.sectionIntelligence),
  }
  const references = refs.map(id => {
    const e = evidence.find(value => value.evidenceObjectId === id)
    return { evidenceObjectId: id, sourceId: e?.sourceId, lineageRef: e?.lineageRef,
      fact: e?.extractedFact, reviewStatus: e?.reviewStatus, validationStatus: e?.validationStatus,
      sourcePresent: Array.isArray(sources) && sources.some(s => s.sourceId === e?.sourceId) }
  })
  const report = {
    provenance: 'READ_ONLY_SNAPSHOT_WITH_PURE_ACCEPTANCE_SIZE_FIXTURE',
    runtimeKey: runtime.runtimeInstanceKey, sectionKey, stateVersion: runtime.stateVersion,
    updatedAt: runtime.updatedAt, reviewedAt: acceptedAt, generatedHash,
    databaseWrites: false, providerCalls: false, acceptancePerformed: false,
    semanticVerdict: 'NOT_AUTOMATED_REQUIRES_CONTENT_REVIEW',
    acceptanceFixtureActor: 'Original generation actor reused for sizing only',
    sizingLimit: 'Not an HTTP envelope, aggregate-read or live acceptance proof',
    checks, manifestCount: generated.evidenceProjection?.included?.length,
    referenceCount: refs.length, references,
    sizes: { persistedDetailBytes: bytes(row.sectionDetail),
      acceptanceDetailBytes: bytes(candidate),
      acceptanceRowArrayBytes: bytes([{ ...row, sectionDetail: candidate }]),
      priorRevisionCount: section.revisions?.length || 0 },
    truthEligibility: generated.truthEligibility, validationResults: generated.validationResults,
    generated, acceptanceFixture: accepted,
  }
  const outputDir = path.resolve(apiRoot,
    '../docs/generated/harness-runs/ss-016/2026-09-03-guided-accepted-truth')
  const outputPath = path.join(outputDir, sectionKey + '-' + generatedHash + '-review-v2.json')
  const serialized = JSON.stringify(report, null, 2) + '\n'
  assert.ok(!/mongodb(?:\+srv)?:\/\//i.test(serialized), 'CREDENTIAL_LIKE_OUTPUT_BLOCKED')
  fs.mkdirSync(outputDir, { recursive: true })
  // Exclusive creation: an existing artifact is never overwritten.
  fs.writeFileSync(outputPath, serialized, { flag: 'wx' })
  console.log(JSON.stringify({ outputPath, generatedHash, checks, sizes: report.sizes,
    referenceCount: refs.length, semanticVerdict: report.semanticVerdict }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ status: 'REVIEW_FAILED', code: error?.code || error?.name || 'ERROR',
    detail: 'No database writes or provider calls; no existing artifact overwritten.' }))
  process.exitCode = 1
} finally {
  if (session) await session.endSession()
  await mongoose.disconnect()
}
