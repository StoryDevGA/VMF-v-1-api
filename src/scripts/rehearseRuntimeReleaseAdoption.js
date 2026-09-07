// Disposable SS-018 proof. Main owns execution and the separate apply gate.
// Default: node src/scripts/rehearseRuntimeReleaseAdoption.js --dry-run
// Apply:   node src/scripts/rehearseRuntimeReleaseAdoption.js --apply --confirm-database vmf_ss018_release_qa_20260904
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'

const DATABASE = 'vmf_ss018_release_qa_20260904'
const argv = process.argv.slice(2)
const apply = argv[0] === '--apply'
assert(apply ? argv.length === 3 && argv[1] === '--confirm-database' && argv[2] === DATABASE
  : argv.length === 0 || (argv.length === 1 && argv[0] === '--dry-run'), 'Invalid rehearsal arguments')
mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
mongoose.set('bufferCommands', false)
// An ephemeral synthetic audit key, never an environment-file write.
process.env.AUDIT_SIGNATURE_SECRET = `ss018-synthetic-${randomUUID()}`

let stage = 'IMPORTS'
let connected = false
let owned = false
const report = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const json = (value) => JSON.parse(JSON.stringify(value))
const bson = (doc) => doc.toObject({ transform: false, minimize: false, flattenMaps: true, depopulate: true })
const id = (value) => new mongoose.Types.ObjectId(value.toString(16).padStart(24, '0'))
const when = new Date('2026-09-04T09:00:00.000Z')
const actor = id(4)
const releaseFields = ['packageId', 'packageKey', 'packageVersion', 'dependencyLockId', 'activationId', 'deploymentId', 'evidence']
const pickBinding = (runtime) => Object.fromEntries(releaseFields.map((key) => [key, runtime[key]]))
const protectedRuntime = (runtime) => Object.fromEntries(Object.entries(runtime).filter(([key]) =>
  ![...releaseFields, 'updatedAt', 'updatedBy', 'releaseBindingHistory'].includes(key)))

try {
  // Ordinary application dotenv loading is permitted; its default URI is never used here.
  const { default: RuntimeInstance } = await import('../models/RuntimeInstance.js')
  const { default: FrameworkPackage } = await import('../models/FrameworkPackage.js')
  const { default: RuntimeDeployment } = await import('../models/RuntimeDeployment.js')
  const { default: RuntimeActivationSnapshot } = await import('../models/RuntimeActivationSnapshot.js')
  const { default: RuntimeGraphSnapshot } = await import('../models/RuntimeGraphSnapshot.js')
  const { default: RuntimeGraphElement } = await import('../models/RuntimeGraphElement.js')
  const { default: Customer } = await import('../models/Customer.js')
  const { default: Tenant } = await import('../models/Tenant.js')
  const { default: LicenseLevel } = await import('../models/LicenseLevel.js')
  const { default: AuditLog } = await import('../models/AuditLog.js')
  const { default: RuntimePathRegistry } = await import('../models/RuntimePathRegistry.js')
  const { default: ValidationRegistry } = await import('../models/ValidationRegistry.js')
  const { default: RuntimeAgent } = await import('../models/RuntimeAgent.js')
  const { default: RuntimeSkill } = await import('../models/RuntimeSkill.js')
  const { default: SkillRoleRegistry } = await import('../models/SkillRoleRegistry.js')
  const { default: WorkflowPolicy } = await import('../models/WorkflowPolicy.js')
  const { default: UIContract } = await import('../models/UIContract.js')
  const { buildDependencyLockSnapshot } = await import('../controllers/frameworkPackage.controller.js')
  const { generateChecksum } = await import('../services/governanceAudit/checksumService.js')
  const { checkRuntimeReleaseAuthoredCompatibility } = await import('../services/runtimeReleaseCompatibilityService.js')
  const { resolveRuntimeReleaseDependencySnapshot } = await import('../services/runtimeReleaseSnapshotService.js')
  const { adoptRuntimeRelease, rollbackRuntimeRelease } = await import('../services/runtimeReleaseAdoptionService.js')
  const models = [Customer, Tenant, LicenseLevel, RuntimeInstance, FrameworkPackage, RuntimeDeployment,
    RuntimeActivationSnapshot, RuntimePathRegistry, ValidationRegistry, RuntimeAgent, RuntimeSkill,
    SkillRoleRegistry, WorkflowPolicy, UIContract, RuntimeGraphSnapshot, RuntimeGraphElement, AuditLog]
  const hash = (value) => generateChecksum(json(value))
  const rows = new Map(models.map((model) => [model.collection.name, []]))
  assert.equal(new Set(models.map((model) => model.collection.name)).size, 17)
  const normalize = async (Model, values) => {
    const doc = new Model({ createdAt: when, updatedAt: when, ...values })
    await doc.validate()
    return doc
  }
  const add = (Model, doc) => { rows.get(Model.collection.name).push(bson(doc)); return doc }
  const common = { status: 'ACTIVE', isLocked: true, versionStatus: 'ACTIVE', componentVersion: 1,
    lockedAt: when, lockedBy: actor, createdBy: actor, updatedBy: actor }

  stage = 'OFFLINE_FIXTURES'
  add(LicenseLevel, await normalize(LicenseLevel, { _id: id(5), name: 'SS018 synthetic license',
    featureEntitlements: ['VMF'], isActive: true, createdBy: actor, updatedBy: actor }))
  add(Customer, await normalize(Customer, { _id: id(2), name: 'SS018 synthetic customer',
    topology: 'SINGLE_TENANT', vmfPolicy: 'SINGLE', defaultTenantId: id(3), licenseLevelId: id(5), status: 'ACTIVE',
    createdBy: actor, billing: { planCode: 'SS018_SYNTHETIC', cycle: 'MONTHLY' } }))
  add(Tenant, await normalize(Tenant, { _id: id(3), customerId: id(2), name: 'SS018 synthetic tenant',
    website: 'https://example.invalid', status: 'ENABLED', isDefault: true, tenantAdminUserIds: [actor] }))
  const path = add(RuntimePathRegistry, await normalize(RuntimePathRegistry, { ...common, _id: id(20),
    pathKey: 'framework_state.sections.context', label: 'Context', description: 'Synthetic context path', frameworkKeys: ['VMF'],
    scope: 'FRAMEWORK_STATE', allowedOperations: ['READ', 'WRITE', 'BIND'], dataType: 'OBJECT', category: 'SECTION', sourceType: 'RUNTIME_STATE' }))
  const role = add(SkillRoleRegistry, await normalize(SkillRoleRegistry, { ...common, _id: id(21), roleKey: 'QA_VALIDATOR',
    label: 'Synthetic validator', description: 'Synthetic validation role', allowedOperations: ['READ', 'EXECUTE'] }))
  const skill = add(RuntimeSkill, await normalize(RuntimeSkill, { ...common, _id: id(22), key: 'ss018-qa-validation',
    name: 'Synthetic validation', supportedFrameworkKeys: ['VMF'], skillRoleKey: role.roleKey }))
  const agent = add(RuntimeAgent, await normalize(RuntimeAgent, { ...common, _id: id(23), key: 'ss018-qa-agent',
    name: 'Synthetic agent', supportedFrameworkKeys: ['VMF'], defaultSkillIds: [skill.stableId] }))
  const validation = add(ValidationRegistry, await normalize(ValidationRegistry, { ...common, _id: id(24),
    key: 'ss018-qa-check', label: 'Synthetic check', description: 'Synthetic completeness check', supportedFrameworkKeys: ['VMF'],
    category: 'COMPLETENESS', severity: 'ERROR', producerSkillId: skill.stableId,
    defaultAgentIds: [agent.stableId], outputPath: 'framework_state.validation.ss018_qa', resultType: 'OBJECT' }))
  const oldPolicy = add(WorkflowPolicy, await normalize(WorkflowPolicy, { ...common, _id: id(25), key: 'ss018-qa-review',
    name: 'Synthetic review', frameworkKeys: ['VMF'], policyType: 'LIFECYCLE_GATE', triggerEvent: 'ON_STAGE_CHANGE',
    governedAction: 'SUBMIT_FOR_REVIEW', requireSuccess: true }))
  const returnPolicy = add(WorkflowPolicy, await normalize(WorkflowPolicy, { ...common, _id: id(26), key: 'ss018-qa-return',
    name: 'Synthetic return', frameworkKeys: ['VMF'], policyType: 'LIFECYCLE_GATE', triggerEvent: 'ON_STAGE_CHANGE',
    governedAction: 'RETURN_TO_DRAFT', requireSuccess: true }))
  const uiBase = { ...common, frameworkKeys: ['VMF'], sourceFrameworkKey: 'VMF',
    sections: [{ sectionKey: 'context', runtimePath: path.pathKey, label: 'Context', displayOrder: 1 }],
    lifecycleStages: [{ stageKey: 'IN_REVIEW', label: 'In review', displayOrder: 1 }], actions: [] }
  const sourceUi = add(UIContract, await normalize(UIContract, { ...uiBase, _id: id(27),
    uiContractKey: 'ss018-qa-ui-source', name: 'Synthetic source UI', sourcePackageKey: 'ss018-qa-source', sourcePackageVersion: '1.0.0' }))
  const targetUi = add(UIContract, await normalize(UIContract, { ...uiBase, _id: id(28),
    uiContractKey: 'ss018-qa-ui-target', name: 'Synthetic target UI', sourcePackageKey: 'ss018-qa-target', sourcePackageVersion: '1.0.1',
    actions: [{ actionKey: 'RETURN_TO_DRAFT', governedAction: 'RETURN_TO_DRAFT', buttonLabel: 'Return to Draft',
      displayOrder: 1, isVisible: true, requiresConfirmation: true }] }))
  const packageBase = { ...common, frameworkKey: 'VMF', frameworkName: 'Synthetic framework',
    visibility: 'CUSTOMER_VISIBLE', customerAccessMode: 'ALL_CUSTOMERS', isDefault: false,
    sections: [{ sectionKey: 'context', runtimePath: path.pathKey, validationKeys: [validation.key] }],
    workflowBindings: [{ policyKey: oldPolicy.key, executionContext: 'ON_STAGE_EXIT', priority: 1, enabled: true }] }
  const packages = []
  const deploymentDocs = []
  const activationDocs = []
  for (let i = 0; i < 2; i++) {
    const ui = i ? targetUi : sourceUi
    const pkg = await normalize(FrameworkPackage, { ...packageBase, _id: id(10 + i),
      packageKey: i ? 'ss018-qa-target' : 'ss018-qa-source', version: i ? '1.0.1' : '1.0.0',
      derivedFromPackageId: i ? String(id(10)) : '', isDefault: i === 1, uiContractKey: ui.uiContractKey,
      uiContractBinding: { key: ui.uiContractKey, version: ui.sourcePackageVersion, status: 'ACTIVE',
        compatibilityMode: ui.compatibilityMode, resolvedAt: when },
      workflowBindings: [...packageBase.workflowBindings, ...(i ? [{ policyKey: returnPolicy.key,
        executionContext: 'ON_STAGE_EXIT', priority: 2, enabled: true }] : [])] })
    const ref = (doc, key, name) => ({ id: doc.stableId, key, name, status: doc.status,
      versionStatus: doc.versionStatus, componentVersion: doc.componentVersion, lineageId: doc.lineageId, issues: [] })
    const dependencies = {
      runtimePaths: [ref(path, path.pathKey, path.label)], validations: [ref(validation, validation.key, validation.label)],
      workflowPolicies: [ref(oldPolicy, oldPolicy.key, oldPolicy.name), ...(i ? [ref(returnPolicy, returnPolicy.key, returnPolicy.name)] : [])],
      agents: [ref(agent, agent.key, agent.name)], skills: [ref(skill, skill.key, skill.name)],
      skillRoles: [ref(role, role.roleKey, role.label)],
      uiContract: { ...ref(ui, ui.uiContractKey, ui.name), sourcePackageKey: ui.sourcePackageKey,
        sourcePackageVersion: ui.sourcePackageVersion, compatibilityMode: ui.compatibilityMode,
        sectionMapping: { mapped: ['context'], missing: [], orphaned: [], runtimePathMismatches: [], custom: [],
          counts: { packageSections: 1, mapped: 1, missing: 0, orphaned: 0, runtimePathMismatches: 0, custom: 0 } },
        lifecycleStageCount: ui.lifecycleStages.length, actionCount: ui.actions.length },
    }
    pkg.dependencyLock = buildDependencyLockSnapshot({ frameworkPackage: bson(pkg), dependencies, actorUserId: actor, lockedAt: when })
    // Hash the complete schema-cast representation, not the pre-cast builder input.
    const { snapshotId: _snapshotId, snapshotHash: _snapshotHash, ...castPayload } = json(bson(pkg).dependencyLock)
    pkg.dependencyLock.snapshotHash = generateChecksum(castPayload)
    const checkpointId = `ss018-checkpoint-${i}`
    pkg.lastCheckpointStatus = 'PASS'
    pkg.lastCheckpointAt = when
    pkg.lastCheckpointResult = { id: checkpointId, status: 'PASS', timestamp: when,
      dependencyLockPreview: json(bson(pkg).dependencyLock) }
    pkg.runtimeVerdict = { validationId: `ss018-verdict-${i}`, result: 'ALLOW', auditPersisted: true,
      dependencyLockState: 'LOCKED', lastValidatedAt: when }
    await pkg.validate()
    const persisted = bson(pkg)
    assert.equal(resolveRuntimeReleaseDependencySnapshot({ sourceSnapshot: json(persisted.dependencyLock) }).metadataIntegrityVerified, true)
    packages.push(add(FrameworkPackage, pkg))
    deploymentDocs.push(add(RuntimeDeployment, await normalize(RuntimeDeployment, { _id: id(30 + i),
      deploymentId: `ss018-deployment-${i}`, activationId: `ss018-activation-${i}`, packageId: pkg._id,
      packageKey: pkg.packageKey, frameworkKey: 'VMF', frameworkVersion: pkg.version,
      status: i ? 'ACTIVE' : 'SUPERSEDED', registeredAt: when, registeredBy: actor })))
    activationDocs.push(add(RuntimeActivationSnapshot, await normalize(RuntimeActivationSnapshot, { _id: id(32 + i),
      activationId: `ss018-activation-${i}`, deploymentId: `ss018-deployment-${i}`, packageId: pkg._id,
      packageKey: pkg.packageKey, frameworkKey: 'VMF', frameworkVersion: pkg.version, packageStatusAtActivation: 'VALIDATED',
      activationStatus: i ? 'ACTIVE' : 'SUPERSEDED', dependencySnapshotId: pkg.dependencyLock.snapshotId,
      dependencySnapshotHash: pkg.dependencyLock.snapshotHash, checkpointId, checkpointStatus: 'PASS',
      runtimeVerdictId: `ss018-verdict-${i}`, runtimeVerdictResult: 'ALLOW', activatedAt: when, activatedBy: actor })))
  }
  const policyKeys = ['key', 'frameworkKeys', 'status', 'isLocked', 'governedAction', 'policyType', 'appliesTo', 'triggerEvent',
    'triggerMode', 'actorScope', 'decisionMode', 'executionType', 'requireSuccess', 'overrideAllowed', 'approvalRequired',
    'conditions', 'steps', 'orderedSteps', 'gatingRules', 'onPassEffects', 'onFailEffects', 'requiredAgentIds', 'requiredSkillIds',
    'requiredValidationKeys', 'primaryAgentId', 'fallbackAgentId', 'escalationRoleKey', 'escalateTo']
  const compatibility = checkRuntimeReleaseAuthoredCompatibility({ sourcePackage: json(bson(packages[0])),
    targetPackage: json(bson(packages[1])), sourceUi: json(bson(sourceUi)), targetUi: json(bson(targetUi)),
    addedPolicy: json(Object.fromEntries(policyKeys.map((key) => [key, bson(returnPolicy)[key]]))) })
  assert(compatibility.authoredConfigurationCompatible, `Offline compatibility: ${compatibility.reason}`)
  const releaseBinding = (i) => ({ packageId: packages[i]._id, packageKey: packages[i].packageKey,
    packageVersion: packages[i].version, dependencyLockId: packages[i].dependencyLock.snapshotId,
    activationId: activationDocs[i].activationId, deploymentId: deploymentDocs[i].deploymentId,
    evidence: { activationId: activationDocs[i].activationId, deploymentId: deploymentDocs[i].deploymentId,
      dependencySnapshotId: packages[i].dependencyLock.snapshotId, dependencySnapshotHash: packages[i].dependencyLock.snapshotHash } })
  add(RuntimeInstance, await normalize(RuntimeInstance, { _id: id(1), runtimeInstanceKey: 'ss018-synthetic-runtime',
    customerId: id(2), tenantId: id(3), runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF', ...releaseBinding(0),
    status: 'ACTIVE', executionStatus: 'WAITING_APPROVAL', stateVersion: 'ss018-synthetic-state-v1',
    name: 'Synthetic release rehearsal', createdBy: actor, updatedBy: actor,
    framework_state: { lifecycle: { stage: 'IN_REVIEW' }, readiness: { state: 'IN_REVIEW' },
      sections: { context: { content: 'Synthetic protected truth' } }, evidence_pack: { synthetic: true }, lock: {}, publish: {} } }))
  assert.equal([...rows.values()].reduce((sum, value) => sum + value.length, 0), 19)
  assert.equal(packages.filter((pkg) => pkg.isDefault).length, 1)
  assert.notEqual(packages[0].packageKey, packages[1].packageKey)
  assert.notEqual(packages[0].version, packages[1].version)
  assert.notEqual(sourceUi.stableId, targetUi.stableId)
  assert.notEqual(sourceUi.uiContractKey, targetUi.uiContractKey)
  const allIds = [...rows.values()].flat().map((row) => String(row._id))
  assert.equal(new Set(allIds).size, allIds.length)

  // Deduplicate equivalent field-level/named indexes, preserving the explicit name.
  // Different constraints are not silently dropped or changed.
  const indexPlans = new Map(models.map((Model) => {
    const unique = new Map()
    for (const [key, options] of Model.schema.indexes()) {
      const { name, background: _background, ...constraints } = options
      const fingerprint = hash({ key: Object.entries(key), constraints })
      if (!unique.has(fingerprint) || name) unique.set(fingerprint, { key, options: { ...constraints, ...(name ? { name } : {}) } })
    }
    return [Model.collection.name, [...unique.values()]]
  }))
  report({ stage: 'OFFLINE_PASS', database: DATABASE, mode: apply ? 'apply' : 'dry-run',
    fixtureDocuments: 19, collections: models.map((Model) => ({ name: Model.collection.name,
      documents: rows.get(Model.collection.name).length, indexes: indexPlans.get(Model.collection.name) })),
    snapshotHashes: packages.map((pkg) => pkg.dependencyLock.snapshotHash), authoredCompatibility: true,
    evidence: 'Synthetic offline validation only; no persistence proof' })

  if (apply) {
    stage = 'CONNECTION_GUARDS'
    const uri = process.env.SS018_QA_MONGODB_URI
    const expectedUser = process.env.SS018_QA_EXPECTED_USERNAME
    assert(uri && expectedUser?.trim(), 'Explicit QA URI and expected username required')
    const parsed = new URL(uri)
    assert(['mongodb:', 'mongodb+srv:'].includes(parsed.protocol), 'Unsupported URI protocol')
    assert.equal(decodeURIComponent(parsed.pathname.slice(1)), DATABASE)
    assert.equal(decodeURIComponent(parsed.username), expectedUser)
    assert.equal(mongoose.connection.readyState, 0)
    await mongoose.connect(uri, { dbName: DATABASE, autoCreate: false, autoIndex: false, bufferCommands: false,
      serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, socketTimeoutMS: 30000, maxPoolSize: 2 })
    connected = true
    const db = mongoose.connection.db
    const guardIdentity = async () => {
      assert.equal(mongoose.connection.name, DATABASE)
      assert.equal(db.databaseName, DATABASE)
      const auth = (await db.command({ connectionStatus: 1, showPrivileges: true })).authInfo
      assert.equal(auth.authenticatedUsers.length, 1)
      assert.equal(auth.authenticatedUsers[0].user, expectedUser)
      assert.deepEqual(auth.authenticatedUserRoles.map((role) => `${role.db}:${role.role}`).sort(),
        [`${DATABASE}:dbAdmin`, `${DATABASE}:readWrite`].sort())
      assert(auth.authenticatedUserPrivileges?.length > 0)
      assert(auth.authenticatedUserPrivileges.every((entry) => entry.resource?.db === DATABASE
        && !entry.resource.anyResource && !entry.resource.cluster), 'Privileges exceed isolated database')
    }
    await guardIdentity()
    const topology = await db.command({ hello: 1 })
    assert(topology.logicalSessionTimeoutMinutes != null && (topology.setName || topology.msg === 'isdbgrid'), 'Transactions required')
    assert.equal((await db.listCollections({}, { nameOnly: true }).toArray()).length, 0, 'Target must have zero collections')
    owned = true
    stage = 'INDEX_SETUP'
    for (const Model of models) {
      await db.createCollection(Model.collection.name)
      for (const { key, options } of indexPlans.get(Model.collection.name)) await Model.collection.createIndex(key, options)
      const actual = await Model.collection.listIndexes().toArray()
      for (const { key, options } of indexPlans.get(Model.collection.name)) {
        const isRuntimePathTextIndex = Model === RuntimePathRegistry
          && options.name === 'runtime_path_registry_text_search'
          && Object.values(key).every((value) => value === 'text')
        // MongoDB reports text fields through _fts/_ftsx, with field identity in weights.
        assert(actual.some((index) => (isRuntimePathTextIndex
          ? index.name === options.name
            && JSON.stringify(Object.entries(index.key)) === JSON.stringify([['_fts', 'text'], ['_ftsx', 1]])
            && hash(index.weights || {}) === hash(options.weights)
          : JSON.stringify(Object.entries(index.key)) === JSON.stringify(Object.entries(key)))
          && Boolean(index.unique) === Boolean(options.unique)
          && hash(index.partialFilterExpression || {}) === hash(options.partialFilterExpression || {})
          && index.expireAfterSeconds === options.expireAfterSeconds), 'Index readback mismatch')
      }
    }
    const inventory = async () => {
      const collections = await db.listCollections().toArray()
      assert.deepEqual(collections.map((entry) => entry.name).sort(), [...rows.keys()].sort(), 'Unexpected collection')
      return collections.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => ({
        name: entry.name, uuid: entry.info?.uuid, options: entry.options,
      }))
    }
    // Normalize only MongoDB's implicit audit-validator defaults; retain original
    // names, UUIDs and every other option as the ownership baseline.
    const normalizedInventory = (entries) => entries.map((entry) => ({ ...entry, options: entry.name === AuditLog.collection.name
      ? { ...entry.options, validator: entry.options.validator || {}, validationLevel: entry.options.validationLevel || 'strict',
        validationAction: entry.options.validationAction || 'error' } : entry.options }))
    const ownedInventory = hash(normalizedInventory(await inventory()))
    stage = 'FIXTURE_INSERT'
    // Insert already validated, normalized BSON verbatim: save-time timestamp/minimize
    // changes must not silently alter precomputed release evidence. Service writes are real.
    for (const [name, documents] of rows) if (documents.length) await db.collection(name).insertMany(documents)
    const readAll = async () => Object.fromEntries(await Promise.all([...rows.keys()].map(async (name) =>
      [name, await db.collection(name).find({}).sort({ _id: 1 }).toArray()])))
    const baseline = await readAll()
    for (const [name, documents] of rows) {
      assert.equal(hash(baseline[name]), hash([...documents].sort((a, b) => String(a._id).localeCompare(String(b._id)))))
    }
    const runtimeName = RuntimeInstance.collection.name
    const auditName = AuditLog.collection.name
    const runtimeBefore = baseline[runtimeName][0]
    const scope = { resolvedPermissions: { platform: { roleKeys: [], permissions: [] }, customers: [],
      tenants: [{ customerId: String(id(2)), tenantId: String(id(3)), roleKeys: [], permissions: ['VMF_UPDATE'] }] } }
    const baseArgs = { actorUserId: String(actor), scopes: scope, runtimeInstanceId: String(id(1)),
      auditRequest: { requestId: `ss018-rehearsal-${randomUUID()}` } }
    const forward = { ...baseArgs, payload: { targetPackageId: String(packages[1]._id),
      targetDeploymentId: deploymentDocs[1].deploymentId, expectedUpdatedAt: runtimeBefore.updatedAt.toISOString(), reason: 'Synthetic adoption proof' } }

    stage = 'AUDIT_FAILURE_ABORT'
    const auditInfo = (await db.listCollections({ name: auditName }).toArray())[0]
    const restoreValidator = { validator: auditInfo.options.validator || {},
      validationLevel: auditInfo.options.validationLevel || 'strict', validationAction: auditInfo.options.validationAction || 'error' }
    await db.command({ collMod: auditName, validator: { action: { $ne: 'RUNTIME_RELEASE_ADOPTED' } },
      validationLevel: 'strict', validationAction: 'error' })
    let rejected = false
    try { await adoptRuntimeRelease(forward) } catch (error) {
      assert.equal(error.code, 121, 'Expected actual MongoDB audit document validation rejection')
      rejected = true
    }
    assert(rejected, 'Audit fault did not reject adoption')
    assert.equal(hash(await readAll()), hash(baseline), 'Abort left persistence residue')
    await db.command({ collMod: auditName, ...restoreValidator })
    const restoredOptions = (await db.listCollections({ name: auditName }).toArray())[0].options
    assert.deepEqual({ validator: restoredOptions.validator || {}, validationLevel: restoredOptions.validationLevel || 'strict',
      validationAction: restoredOptions.validationAction || 'error' }, restoreValidator)
    assert.equal(hash(normalizedInventory(await inventory())), ownedInventory, 'Original collection ownership/options changed')
    report({ stage: 'AUDIT_ABORT_PASS', mongoErrorCode: 121, residue: false })

    const verifyCommitted = async (receipt, kind, originalBinding, destinationBinding, expectedHistory, expectedAudits, payload) => {
      const actual = await readAll()
      const runtime = actual[runtimeName][0]
      assert.equal(actual[runtimeName].length, 1)
      assert.equal(hash(protectedRuntime(runtime)), hash(protectedRuntime(runtimeBefore)))
      assert.equal(hash(pickBinding(runtime)), hash(destinationBinding))
      assert.equal(runtime.updatedAt.toISOString(), receipt.updatedAt)
      assert.equal(String(runtime.updatedBy), String(actor))
      assert.deepEqual(runtime.releaseBindingHistory.slice(0, -1), expectedHistory)
      const entry = runtime.releaseBindingHistory.at(-1)
      assert.equal(entry.operationId, receipt.operationId)
      assert.equal(entry.kind, kind)
      assert.equal(hash(entry.from), hash(originalBinding))
      assert.equal(hash(entry.to), hash(destinationBinding))
      assert.equal(entry.stateVersion, runtimeBefore.stateVersion)
      assert.equal(entry.changedAt.toISOString(), receipt.updatedAt)
      assert.equal(String(entry.changedBy), String(actor))
      assert.equal(entry.reason, payload.reason)
      assert.equal(entry.revertsOperationId, kind === 'ROLLBACK' ? payload.operationId : undefined)
      assert.equal(actual[auditName].length, expectedAudits)
      const rawAudit = actual[auditName].find((row) => row.diff?.operationId === receipt.operationId)
      assert(rawAudit && typeof rawAudit.signature === 'string')
      assert.equal(rawAudit.action, kind === 'ADOPT' ? 'RUNTIME_RELEASE_ADOPTED' : 'RUNTIME_RELEASE_ROLLED_BACK')
      assert.equal(String(rawAudit.resourceId), String(id(1)))
      assert.equal(rawAudit.resourceType, 'RuntimeInstance')
      assert.equal(String(rawAudit.actorUserId), String(actor))
      assert.equal(String(rawAudit.scope?.customerId), String(id(2)))
      assert.equal(String(rawAudit.scope?.tenantId), String(id(3)))
      assert.equal(rawAudit.requestId, baseArgs.auditRequest.requestId)
      assert.equal(hash(rawAudit.diff), hash(entry), 'Audit diff does not match complete history entry')
      assert(AuditLog.hydrate(rawAudit).verifySignature(), 'Raw audit signature invalid')
      const hydrated = await AuditLog.findById(rawAudit._id)
      assert(hydrated.verifySignature(), 'Reloaded audit signature invalid')
      for (const name of rows.keys()) if (![runtimeName, auditName].includes(name)) assert.equal(hash(actual[name]), hash(baseline[name]))
      return actual
    }
    stage = 'ADOPTION_COMMIT'
    const adoption = await adoptRuntimeRelease(forward)
    const adopted = await verifyCommitted(adoption, 'ADOPT', pickBinding(runtimeBefore), releaseBinding(1), [], 1, forward.payload)
    report({ stage: 'ADOPTION_COMMIT_PASS', signedAuditCount: 1, refreshRequired: adoption.refreshRequired })
    stage = 'ROLLBACK_COMMIT'
    const rollbackPayload = { operationId: adoption.operationId,
      expectedUpdatedAt: adoption.updatedAt, reason: 'Synthetic rollback proof' }
    const reversal = await rollbackRuntimeRelease({ ...baseArgs, payload: rollbackPayload })
    const final = await verifyCommitted(reversal, 'ROLLBACK', releaseBinding(1), pickBinding(runtimeBefore),
      adopted[runtimeName][0].releaseBindingHistory, 2, rollbackPayload)
    assert.equal(final[runtimeName][0].releaseBindingHistory.at(-1).revertsOperationId, adoption.operationId)
    assert.equal(hash(final[auditName].filter((row) => row.diff?.operationId === adoption.operationId)), hash(adopted[auditName]))
    report({ stage: 'ROLLBACK_COMMIT_PASS', signedAuditCount: 2, protectedTruthUnchanged: true })

    stage = 'OWNED_CLEANUP'
    await guardIdentity()
    assert(owned && ownedInventory, 'Database ownership not established')
    assert.equal(hash(normalizedInventory(await inventory())), ownedInventory, 'Original collection ownership/options changed')
    assert.equal(hash(await readAll()), hash(final), 'Unexpected residue or changes: preserving database')
    await db.dropDatabase()
    assert.equal((await db.listCollections({}, { nameOnly: true }).toArray()).length, 0)
    owned = false
    report({ stage: 'CLEANUP_PASS', database: DATABASE, deletedExactDatabase: true,
      evidence: 'Synthetic real persistence with pre-resolved service authorization; no JWT, role-resolution, benchmark, browser, historical parity or concurrency proof' })
  }
} catch (error) {
  // Never emit raw driver messages, stacks, URI or authentication details.
  report({ status: 'FAIL', stage, mongoCode: Number.isInteger(error.code) ? error.code : null,
    reason: error.name === 'AssertionError' ? 'ASSERTION_FAILED' : error.name === 'ValidationError' ? 'FIXTURE_VALIDATION_FAILED' : 'OPERATION_FAILED',
    fixturePaths: error.name === 'ValidationError' ? Object.keys(error.errors || {}) : undefined,
    isolatedResiduePreserved: owned })
  process.exitCode = 1
} finally {
  if (connected || mongoose.connection.readyState !== 0) await mongoose.disconnect()
}
