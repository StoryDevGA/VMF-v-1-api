import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import mongoose from 'mongoose'

mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
const { default: env } = await import('../src/config/env.js')
const { RuntimeInstance, FrameworkPackage, User, AuditLog } = await import('../src/models/index.js')
const repo = await import('../src/services/runtimeStateRepository.js')
const { resolveRuntimeStateVersion } = await import('../src/services/runtimeStateVersionService.js')
const { resolveSectionExecutionContract } = await import('../src/services/sectionExecutionContractService.js')
const { buildUserPermissionsSnapshot } = await import('../src/services/performanceCacheService.js')
const { resolveOutcomeStudioKnowledgePackBinding } = await import('../src/services/outcomeKnowledgePackRegistryService.js')
const { FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY } = await import('../src/services/outcomeFrameworkHandoffService.js')

const TARGET = 'ss016-parlon-fresh-framework-benchmark'
const VERSION = 'rsv2:ddc65068-5f64-493a-8d43-46c5bc16a294'
const GENERATED_HASH = '3de29b590f8957b644f5ba8707dccc37aa166924adc44aaff7b3052298b19b1c'
const CUSTOMER = '6a6c75f2cace7a21bd41ef98'
const TENANT = '6a6c76e3cace7a21bd41eff9'
const destination = path.resolve('../docs/generated/harness-runs/ss-016/2026-09-03-parlon-v2-comparison-export/parlon-runtime-v2-export')
const mode = process.argv[2] || 'plan'
const resolutionTime = new Date().toISOString()
assert.ok(['plan', 'export'].includes(mode))
assert.ok(['development', 'test'].includes(env.appEnv) && !env.isAppProduction)
assert.ok(process.env.SS014_READONLY_MONGODB_URI, 'Dedicated read-only credential required')
const json = value => JSON.parse(JSON.stringify(value))
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const bytesHash = value => createHash('sha256').update(value).digest('hex')
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
const stableHash = value => digest(canonical(json(value)))
const emit = value => console.log('EXPORT=' + JSON.stringify(value))
const options = { maxTimeMS: 5000 }
const payload = new Map()
const add = (name, value) => { assert.ok(!payload.has(name)); payload.set(name, JSON.stringify(value, null, 2) + '\n') }
const current = repo.__testables.buildCurrentStateFilter()
const supplemental = [
  'runtime_state_migration_receipts', 'runtime_graph_relationships',
  'governed_reasoning_executions', 'outcome_sessions', 'outcome_drafts',
  'outcome_draft_iterations', 'outcome_assets', 'outcome_asset_versions',
  'outcome_messages', 'outcome_knowledge_composition_plans', 'outcome_quality_stage_executions',
]
let db
const readAll = async (name, filter, cap = 20000) => {
  const rows = await db.collection(name).find(filter, options).sort({ _id: 1 }).limit(cap + 1).toArray()
  assert.ok(rows.length <= cap, `Export cap exceeded: ${name}`)
  assert.equal(rows.length, await db.collection(name).countDocuments(filter, options), `Incomplete rows: ${name}`)
  return rows
}
const assertScope = (row, root) => {
  assert.equal(String(row.customerId), CUSTOMER)
  assert.equal(String(row.tenantId), TENANT)
  assert.equal(String(row.runtimeInstanceId), String(root._id))
  if (row.runtimeInstanceKey !== undefined) assert.equal(row.runtimeInstanceKey, TARGET)
}
const collect = async () => {
  const root = await RuntimeInstance.collection.findOne({ runtimeInstanceKey: TARGET, customerId: new mongoose.Types.ObjectId(CUSTOMER), tenantId: new mongoose.Types.ObjectId(TENANT) }, options)
  assert.ok(root, 'Exact runtime missing')
  assert.equal(resolveRuntimeStateVersion(root).stateVersion, VERSION, 'Pinned runtime state changed')
  assert.equal(digest(root.framework_state.sections.customer_context.generated), GENERATED_HASH)
  const identity = repo.__testables.buildRuntimeIdentityFilter({ runtimeInstanceId: String(root._id), runtimeInstanceKey: TARGET, customerId: CUSTOMER, tenantId: TENANT })
  const records = {}
  const requestedCollections = [...Object.values(repo.RUNTIME_STATE_V2_COLLECTIONS), ...supplemental, AuditLog.collection.name]
  const existing = new Set()
  for (const name of requestedCollections) {
    if (await db.listCollections({ name }, { nameOnly: true }).hasNext()) existing.add(name)
  }
  const collectionPresence = Object.fromEntries(requestedCollections.map(name => [name, existing.has(name) ? 'PRESENT' : 'ABSENT']))
  for (const [key, collection] of Object.entries(repo.RUNTIME_STATE_V2_COLLECTIONS)) {
    assert.ok(existing.has(collection), `Required collection absent: ${collection}`)
    records[key] = await readAll(collection, { ...identity, ...(key === 'SECTIONS' ? { current: true } : current) })
    for (const row of records[key]) {
      assertScope(row, root)
      assert.equal(row.stateVersion, VERSION)
      assert.equal(row.current, true)
      if (row.sourceStateVersion) assert.equal(row.sourceStateVersion, VERSION)
    }
  }
  for (const collection of supplemental) {
    records[collection] = existing.has(collection) ? await readAll(collection, identity) : []
    records[collection].forEach(row => assertScope(row, root))
  }
  const id = root._id
  assert.ok(existing.has(AuditLog.collection.name), 'Audit collection absent')
  records.auditlogs = await readAll(AuditLog.collection.name, { $or: [
    { resourceId: id }, { 'scope.runtimeInstanceId': id },
    { 'context.runtimeInstanceId': String(id) }, { 'context.runtimeInstanceId': id },
    { 'scope.runtimeInstanceKey': TARGET, 'scope.customerId': root.customerId, 'scope.tenantId': root.tenantId },
  ] }, 2000)
  for (const audit of records.auditlogs) {
    if (audit.scope?.customerId) assert.equal(String(audit.scope.customerId), CUSTOMER)
    if (audit.scope?.tenantId) assert.equal(String(audit.scope.tenantId), TENANT)
  }
  const pkg = await FrameworkPackage.findById(root.packageId).maxTimeMS(5000).lean()
  assert.ok(pkg && pkg.version === '3.1.5' && pkg.status === 'ACTIVE')
  const contracts = []
  for (const section of pkg.sections) contracts.push(await resolveSectionExecutionContract({ frameworkPackage: pkg, section }))
  const binding = await resolveOutcomeStudioKnowledgePackBinding({ query: { ...json(root), framework_state: undefined, resolvedAt: resolutionTime }, boundedReadPolicy: FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY })
  return { root, records, pkg, contracts, binding, collectionPresence }
}
const scanSecrets = (text, label) => {
  assert.ok(!/mongodb(?:\+srv)?:\/\/|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|Bearer\s+[A-Za-z0-9_.-]{30,}/i.test(text), `Credential-like content in ${label}`)
  assert.ok(!/[?&](?:X-Amz-Signature|X-Goog-Signature|access_token|token|sig)=/i.test(text), `Signed access URL in ${label}`)
  assert.ok(!/"(?:password|passwordHash|apiKey|clientSecret|accessToken|refreshToken|authorization)"\s*:\s*"[^"\s]+"/i.test(text), `Secret field in ${label}`)
}

await mongoose.connect(process.env.SS014_READONLY_MONGODB_URI, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000, readConcern: { level: 'majority' } })
try {
  db = mongoose.connection.db
  assert.equal(db.databaseName, 'test')
  const access = await db.command({ connectionStatus: 1, showPrivileges: true })
  assert.deepEqual(access.authInfo.authenticatedUserRoles, [{ role: 'read', db: 'test' }])
  const allowedActions = new Set(['changeStream', 'collStats', 'dbHash', 'dbStats', 'find', 'killCursors', 'listCollections', 'listIndexes', 'listSearchIndexes', 'planCacheRead'])
  for (const privilege of access.authInfo.authenticatedUserPrivileges) {
    assert.equal(privilege.resource.db, 'test')
    assert.ok(privilege.actions.every(action => allowedActions.has(action)), 'Unexpected credential privilege')
  }
  const startedAt = new Date().toISOString()
  const first = await collect()
  const { root, records, pkg, contracts, binding, collectionPresence } = first
  assert.equal(records.SECTIONS.length, 6)
  assert.equal(records.EVIDENCE_OBJECTS.length, 803)
  assert.equal(records.EVIDENCE_SOURCES.length, 33)
  assert.equal(records.GRAPH_SNAPSHOTS.length, 1)
  assert.equal(records.GRAPH_ELEMENTS.length, 4057)
  assert.equal(records.EVIDENCE_OBJECTS.filter(row => row.validationStatus === 'UNVALIDATED').length, 333)
  assert.ok(records.EVIDENCE_OBJECTS.every(row => row.reviewStatus === 'ACCEPTED'))
  const graph = records.GRAPH_SNAPSHOTS[0]
  assert.equal(graph.stateStatus, 'CURRENT')
  const nodes = records.GRAPH_ELEMENTS.filter(row => row.elementType === 'NODE')
  const edges = records.GRAPH_ELEMENTS.filter(row => row.elementType === 'EDGE')
  assert.equal(nodes.length, graph.counts.nodeCount)
  assert.equal(edges.length, graph.counts.edgeCount)
  const nodeIds = new Set(nodes.map(row => row.elementKey))
  assert.equal(nodeIds.size, nodes.length)
  for (const row of records.GRAPH_ELEMENTS) {
    assert.equal(row.snapshotId, graph.snapshotId)
    assert.equal(row.graphVersion, graph.graphVersion)
    if (row.elementType === 'EDGE') assert.ok(nodeIds.has(row.fromElementKey) && nodeIds.has(row.toElementKey), 'Graph endpoint missing')
  }
  const sourceIds = new Set(records.EVIDENCE_SOURCES.map(row => row.sourceId))
  assert.equal(sourceIds.size, 33)
  assert.ok(records.EVIDENCE_OBJECTS.every(row => sourceIds.has(row.sourceId)))
  const evidenceIds = new Set(records.EVIDENCE_OBJECTS.map(row => row.evidenceObjectId))
  assert.equal(evidenceIds.size, 803)
  const generated = root.framework_state.sections.customer_context.generated
  assert.equal(generated.evidenceProjection.included.length, 803)
  assert.ok(generated.evidenceProjection.included.every(row => evidenceIds.has(row.evidenceObjectId)))
  for (const row of records.SECTIONS) {
    assert.equal(row.sectionDetail.accepted, null)
    assert.deepEqual(json(row.sectionDetail.generated), json(root.framework_state.sections[row.sectionKey.replaceAll('-', '_')]?.generated ?? null))
  }
  const ccContract = contracts.find(c => c.sectionIdentity.sectionKey.replaceAll('-', '_') === 'customer_context')
  assert.deepEqual([...generated.generator.supportAssetHashes].sort(), ccContract.runtimeSupportAssets.map(asset => asset.contentHash).sort())
  const actor = await User.findById(root.createdBy).maxTimeMS(5000)
  assert.equal(actor.name, 'Andrew Mallaband')
  const permissions = await buildUserPermissionsSnapshot(actor)
  const scopes = { ...permissions, customer: { _id: root.customerId }, tenant: { _id: root.tenantId, customerId: root.customerId } }
  const args = { scopes, runtimeInstanceId: TARGET }
  const control = await repo.getRuntimeStateControl(args)
  const bootstrap = await repo.getRuntimeStateBootstrap(args)
  const manifest = await repo.getRuntimeStateGraphManifest(args)
  const graphProjection = await repo.getRuntimeStateGraphProjection(args)
  add('application-views/control.json', control)
  add('application-views/bootstrap.json', bootstrap)
  add('application-views/graph-manifest.json', manifest)
  add('application-views/graph-preview.json', graphProjection)
  const pageIds = []
  const appSources = new Map()
  for (let page = 1; page <= 17; page++) {
    const response = await repo.listRuntimeStateEvidenceObjects({ ...args, page, pageSize: 50 })
    assert.equal(response.stateVersion, VERSION)
    assert.equal(response.total, 803)
    assert.equal(response.totalCapped, false)
    assert.equal(response.totalPages, 17)
    pageIds.push(...response.evidenceObjects.map(row => row.evidenceObjectId))
    response.sourceRegistry.forEach(row => appSources.set(row.sourceId, row))
    add(`application-views/evidence-page-${String(page).padStart(2, '0')}.json`, response)
  }
  assert.equal(pageIds.length, 803)
  assert.equal(new Set(pageIds).size, 803)
  assert.ok(pageIds.every(id => evidenceIds.has(id)))
  assert.equal(appSources.size, 33)
  for (let i = 0; i < pkg.sections.length; i++) {
    const section = pkg.sections[i]
    const storedKey = section.runtimePath.split('.').at(-1)
    assert.ok(records.SECTIONS.some(row => row.sectionKey === storedKey), 'Package runtime path has no current section')
    const response = await repo.getRuntimeStateSectionSummary({ ...args, sectionKey: storedKey })
    assert.equal(response.section.stateVersion, VERSION)
    const row = records.SECTIONS.find(item => item.sectionKey === response.section.sectionKey)
    assert.ok(row)
    assert.deepEqual(json(response.section.sectionDetail), json(repo.__testables.materializeStoredRuntimeSectionDetail(row.sectionDetail)))
    add(`section-truth/${String(i + 1).padStart(2, '0')}-${response.section.sectionKey}.json`, response)
  }
  const handoff = await repo.getRuntimeStateOutcomeHandoffReadiness(args)
  assert.equal(handoff.control.stateVersion, VERSION)
  const failureCode = 'HANDOFF_RESOLUTION_FAILED'
  const handoffReadFailed = handoff.handoff?.blockers?.some(item => item.code === failureCode) === true
  if (handoffReadFailed) {
    assert.equal(handoff.status, 'BLOCKED')
    assert.equal(handoff.handoff.status, 'BLOCKED')
    assert.equal(handoff.handoff.blockers.length, 1)
    assert.equal(handoff.handoff.contradictions.length, 1)
    assert.equal(handoff.handoff.contradictions[0].code, failureCode)
    assert.equal(handoff.handoff.contradictions[0].severity, 'ERROR')
    assert.equal(handoff.handoff.sectionTruth.length, 0)
    assert.ok(records.SECTIONS.every(row => row.sectionDetail.accepted === null), 'Diagnosed handoff failure precondition changed')
  }
  const handoffReadDiagnosis = handoffReadFailed ? {
    code: 'HANDOFF_RESOLUTION_FAILED',
    classification: 'APPLICATION_READ_DEFECT_OBSERVED_DURING_EXPORT',
    confirmedBy: 'Previously independently reproduced with read-only pure builder on this exact state version',
    currentResponseRootCauseProven: false,
    responseLimitation: 'The application returns a generic resolution failure; this response alone cannot identify its underlying exception.',
    error: "TypeError: Cannot read properties of null (reading 'content')",
    location: 'src/services/outcomeFrameworkHandoffService.js:getSectionContent / buildSectionHandoff',
    cause: 'getAcceptedSection returns null for unaccepted sections; getSectionContent accesses section.content without a null guard.',
    repaired: false,
  } : null
  add('outcome-handoff.json', { readStatus: handoffReadFailed ? 'FAILED_READ' : 'SUCCESS', provenance: 'DERIVED_DURING_EXPORT_BY_APPLICATION_READ_MODEL', requestedOutputTypeKey: null, persistedReceiptPresent: false, diagnosis: handoffReadDiagnosis, result: handoff })
  const second = await collect()
  assert.equal(stableHash(first), stableHash(second), 'Export state or resolved dependencies changed; no complete bundle')
  const finishedAt = new Date().toISOString()
  add('runtime-control.json', { provenance: 'PERSISTED_PARENT_CONTROL_WITHOUT_FRAMEWORK_STATE', record: Object.fromEntries(Object.entries(root).filter(([key]) => key !== 'framework_state')) })
  add('runtime-state-version.json', { provenance: 'RESOLVED_PARENT_VERSION_AND_CURRENT_CHILD_RECEIPTS', ...resolveRuntimeStateVersion(root), separateStateVersionDocument: false, graphSnapshotId: graph.snapshotId, graphVersion: graph.graphVersion })
  add('sections.json', { provenance: 'PERSISTED_CURRENT_V2_SECTION_ROWS', records: records.SECTIONS })
  add('evidence-sources.json', { provenance: 'PERSISTED_CURRENT_V2_SOURCE_ROWS', records: records.EVIDENCE_SOURCES })
  add('evidence-objects.json', { provenance: 'PERSISTED_CURRENT_V2_EVIDENCE_ROWS', records: records.EVIDENCE_OBJECTS })
  add('graph-snapshot.json', { provenance: 'PERSISTED_CURRENT_V2_GRAPH_SNAPSHOT', record: graph })
  add('graph-elements.json', { provenance: 'COMPLETE_CURRENT_GRAPH_ROWS_NOT_UI_PREVIEW', nodeCount: nodes.length, edgeCount: edges.length, records: records.GRAPH_ELEMENTS })
  add('knowledge-pack-bindings.json', { provenance: 'CURRENT_APPLICATION_RESOLUTION_NOT_HISTORICAL_EXECUTION_RECEIPT', resolvedAt: resolutionTime, sectionGenerationOwner: 'section-execution-contracts.json', result: binding, historicalBindingReceipt: { status: 'NOT_PRESENT_IN_PARENT_OR_SECTION_GENERATION_METADATA' } })
  add('section-execution-contracts.json', { provenance: 'RESOLVED_DURING_EXPORT', matchesCustomerContextStoredSupportHashes: true, contracts })
  add('framework-package.json', { provenance: 'EXACT_BOUND_PERSISTED_FRAMEWORK_PACKAGE', record: pkg })
  add('generation-provenance.json', { provenance: 'PERSISTED_CURRENT_GENERATION', generatedHash: GENERATED_HASH, generator: generated.generator, evidenceProjection: generated.evidenceProjection, boundedContextHash: generated.boundedContextHash, inputHash: generated.inputHash, evidenceHash: generated.evidenceHash })
  add('receipts-and-audit.json', { provenance: 'PERSISTED_EXACT_RUNTIME_SCOPE_INCLUDING_HISTORY', collections: Object.fromEntries(supplemental.map(name => [name, { status: collectionPresence[name] === 'ABSENT' ? 'ABSENT' : records[name].length ? 'PRESENT' : 'EMPTY', records: records[name] }])), auditlogs: records.auditlogs, runtimeValidationAudit: { status: 'UNSUPPORTED_RUNTIME_CORRELATION', reason: 'RuntimeValidationAudit schema has no runtime identity field; package-only rows are not attributed to this runtime.' } })
  add('supplemental-storage/runtime-parent.json', { provenance: 'PERSISTED_PARENT_SUPPLEMENT_ONLY_NOT_V2_READ_AUTHORITY', record: root })
  add('source-comparison-index.json', { originalDocumentBinariesIncluded: false, originalFilesFetched: false, reason: 'This is a runtime database export, not a fresh source-file acquisition. Source metadata and hashes are preserved as recorded; absent hashes are not synthesized.', sources: records.EVIDENCE_SOURCES.map(row => ({ sourceId: row.sourceId, sourceType: row.sourceType, title: row.title, sourceRef: row.sourceRef, contentHash: row.contentHash || null, lineageRef: row.lineageRef || null })) })
  const report = { runtimeKey: TARGET, stateVersion: VERSION, startedAt, finishedAt, consistency: 'NON_ATOMIC_DOUBLE_PASS_IDENTICAL_PERSISTED_ROWS_AND_RESOLVED_DEPENDENCIES', stableSnapshotHash: stableHash(first), databaseRole: 'read@test', databaseWrites: false, providerCalls: false, acceptanceActions: false, counts: { sections: 6, generatedSections: 1, acceptedSections: 0, evidenceObjects: 803, evidenceSources: 33, graphNodes: nodes.length, graphEdges: edges.length, graphElements: 4057, evidencePages: 17, originalUnvalidated: 333 }, handoffStatus: handoff.status, semanticAcceptance: 'PARTIAL_REQUIRES_PO_REVIEW', completePayloadFiles: payload.size + 2 }
  report.handoffReadStatus = handoffReadFailed ? 'FAILED_READ' : 'SUCCESS'
  report.comparisonCoverage = handoffReadFailed ? 'INCOMPLETE_HANDOFF_UNAVAILABLE' : 'CHECKPOINT_ONLY'
  add('verification.json', report)
  const readme = `# Parlon Runtime V2 Comparison Bundle\n\nCONFIDENTIAL - customer evidence; controlled sharing only.\n\nRuntime: ${TARGET}\nState: ${VERSION}\nExport: ${finishedAt}\n\n## Read this first\n\nThis is a read-only Development/Test checkpoint, not sprint acceptance. Customer Context is generated; all six sections remain unaccepted. Other sections are empty drafts, not missing exports. Original evidence is unchanged: 803 ACCEPTED records, including 333 UNVALIDATED. Six contradiction candidates remain unresolved.\n\n## How to compare\n\n- Start with manifest.json, verification.json and source-comparison-index.json. Original source binaries are not included; filenames alone do not prove source equivalence.\n- sections.json and section-truth/ preserve current stored section state and exact selected-section app responses. Previous generation is historical within revisions.\n- evidence-objects.json and evidence-sources.json hold complete current V2 rows. application-views/ contains all 17 evidence pages and app projections.\n- graph-elements.json contains all ${nodes.length} nodes and ${edges.length} edges. The app graph-preview is deliberately capped at 48 edges; do not confuse it with the complete graph.\n- outcome-handoff.json is newly derived by the normal read model, not a previously persisted handoff or an Outcome Studio composition. Blocked readiness is a valid finding, not export failure.\n- section-execution-contracts.json includes all six current dependency-resolved skills and hydrated support contents. Customer Context support hashes match its persisted generation. Other contracts are current resolutions, not proof those sections ran.\n- knowledge-pack-bindings.json is current resolution, not proof of historical consumption. Scoped Outcome Studio and governed execution records are in receipts-and-audit.json; empty collections are explicitly marked. Runtime Validation audit cannot safely be correlated solely by package, so that limitation is explicit.\n- supplemental-storage/runtime-parent.json is the complete parent for context, not the sole truth or a substitute for V2 reads.\n\n## Integrity and limitations\n\nThe dedicated credential has only read privileges. No generation, acceptance, evidence edits, database writes or external uploads occurred. Complete persisted-row and resolved-dependency hashes matched before/after app reads. This is a non-atomic stability fence, not a MongoDB snapshot transaction or proof against undetectable change-and-revert. Export stops on drift, errors, caps, missing core state or credential-like data. JSON is a comparison format, not a restorable BSON backup.\n\nManifest hashes cover every other file in this folder; the manifest excludes itself and the external ZIP. The ZIP checksum is recorded separately.\n\nSemantic review remains PARTIAL: AI-led emphasis is source-supported but differs from the replacement-led benchmark; explicit 90-day and exact 3-8x TCO restrictions are absent, not asserted as facts. No Andrew/manual-repository equivalence or Outcome Studio asset-quality claim is made.\n`
  payload.set('README.md', handoffReadFailed
    ? readme.replace('CONFIDENTIAL - customer evidence; controlled sharing only.', 'CONFIDENTIAL - customer evidence; controlled sharing only.\n\nSTATUS: COMPLETE_EXPORT_WITH_READ_FAILURE. Handoff comparison is unavailable: the actual app reader returns HANDOFF_RESOLUTION_FAILED. Read-only diagnosis confirmed a null accepted-section dereference in getSectionContent. The authentic failure response is exported, not replaced with ordinary blocked readiness. No application fix was applied. A folder without its final manifest is incomplete.')
    : readme)
  for (const [name, text] of payload) scanSecrets(text, name)
  const fileManifest = [...payload].map(([name, text]) => ({ path: name, bytes: Buffer.byteLength(text), sha256: bytesHash(text) }))
  add('manifest.json', { schemaVersion: 'ss016.parlon-runtime-v2-comparison-export.v1', status: handoffReadFailed ? 'COMPLETE_EXPORT_WITH_READ_FAILURE' : 'COMPLETE_WITH_DECLARED_LIMITATIONS', ...report, files: fileManifest, checksumExclusions: ['manifest.json', 'external ZIP archive'], serialization: 'UTF-8 JSON, ObjectIds and Dates serialized as strings; not BSON restore format' })
  emit({ mode, ...report, payloadBytes: [...payload.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0) })
  if (mode === 'export') {
    await fs.mkdir(destination, { recursive: false })
    for (const [name, text] of payload) {
      if (name === 'manifest.json') continue
      const filename = path.join(destination, name)
      await fs.mkdir(path.dirname(filename), { recursive: true })
      await fs.writeFile(filename, text, { flag: 'wx' })
    }
    for (const file of fileManifest) {
      const text = await fs.readFile(path.join(destination, file.path))
      assert.equal(bytesHash(text), file.sha256)
      if (file.path.endsWith('.json')) JSON.parse(text.toString('utf8'))
    }
    // A partial directory without this final manifest is never a complete export.
    await fs.writeFile(path.join(destination, 'manifest.json'), payload.get('manifest.json'), { flag: 'wx' })
    assert.equal(await fs.readFile(path.join(destination, 'manifest.json'), 'utf8'), payload.get('manifest.json'))
    emit({ completed: true, files: payload.size, generatedHash: GENERATED_HASH })
  }
} catch (error) {
  emit({ completed: false, status: 'INCOMPLETE', code: error.code || null, name: error.name, message: String(error.message).replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[REDACTED]') })
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
