// Disposable SS-018 persistence proof. Dry-run is offline and is the default.
// Apply: node src/scripts/proveRuntimeReleaseCertificationFlow.js --apply --confirm-database vmf_ss018_release_qa_20260904
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'

const DATABASE = 'vmf_ss018_release_qa_20260904'
const argv = process.argv.slice(2)
const apply = argv[0] === '--apply'
assert(apply ? argv.length === 3 && argv[1] === '--confirm-database' && argv[2] === DATABASE
  : argv.length === 0 || (argv.length === 1 && argv[0] === '--dry-run'), 'Invalid proof arguments')
mongoose.set('autoCreate', false)
mongoose.set('autoIndex', false)
mongoose.set('bufferCommands', false)
process.env.AUDIT_SIGNATURE_SECRET = `ss018-certification-proof-${randomUUID()}`

let stage = 'IMPORTS'
let connected = false
let owned = false
const report = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const json = (value) => JSON.parse(JSON.stringify(value))
const bson = (doc) => doc.toObject({ transform: false, minimize: false, flattenMaps: true, depopulate: true })
const hashJson = (checksum, value) => checksum(json(value))
const releaseFields = ['packageId', 'packageKey', 'packageVersion', 'dependencyLockId', 'activationId', 'deploymentId', 'evidence']
const pickBinding = (runtime) => Object.fromEntries(releaseFields.map((key) => [key, runtime[key]]))
const protectedRuntime = (runtime) => Object.fromEntries(Object.entries(runtime).filter(([key]) =>
  ![...releaseFields, 'updatedAt', 'updatedBy', 'releaseBindingHistory'].includes(key)))

try {
  const { default: RuntimeInstance } = await import('../models/RuntimeInstance.js')
  const { default: FrameworkPackage } = await import('../models/FrameworkPackage.js')
  const { default: RuntimeDeployment } = await import('../models/RuntimeDeployment.js')
  const { default: RuntimeActivationSnapshot } = await import('../models/RuntimeActivationSnapshot.js')
  const { default: RuntimeValidationAudit } = await import('../models/RuntimeValidationAudit.js')
  const { default: RuntimeGraphSnapshot } = await import('../models/RuntimeGraphSnapshot.js')
  const { default: RuntimeGraphElement } = await import('../models/RuntimeGraphElement.js')
  const { default: Customer } = await import('../models/Customer.js')
  const { default: Tenant } = await import('../models/Tenant.js')
  const { default: LicenseLevel } = await import('../models/LicenseLevel.js')
  const { default: AuditLog } = await import('../models/AuditLog.js')
  const { default: FrameworkRegistry } = await import('../models/FrameworkRegistry.js')
  const { default: RuntimePathRegistry } = await import('../models/RuntimePathRegistry.js')
  const { default: ValidationRegistry } = await import('../models/ValidationRegistry.js')
  const { default: RuntimeAgent } = await import('../models/RuntimeAgent.js')
  const { default: RuntimeSkill } = await import('../models/RuntimeSkill.js')
  const { default: SkillRoleRegistry } = await import('../models/SkillRoleRegistry.js')
  const { default: WorkflowPolicy } = await import('../models/WorkflowPolicy.js')
  const { default: UIContract } = await import('../models/UIContract.js')
  const { buildDependencyLockSnapshot, activateFrameworkPackage } = await import('../controllers/frameworkPackage.controller.js')
  const { generateChecksum } = await import('../services/governanceAudit/checksumService.js')
  const { checkRuntimeReleaseAuthoredCompatibility } = await import('../services/runtimeReleaseCompatibilityService.js')
  const { resolveRuntimeReleaseDependencySnapshot } = await import('../services/runtimeReleaseSnapshotService.js')
  const { validateRuntimeOperation } = await import('../services/runtimeValidation/runtimeValidationEngine.js')
  const { adoptRuntimeRelease } = await import('../services/runtimeReleaseAdoptionService.js')

  const models = [Customer, Tenant, LicenseLevel, RuntimeInstance, FrameworkPackage, RuntimeDeployment,
    RuntimeActivationSnapshot, RuntimeValidationAudit, FrameworkRegistry, RuntimePathRegistry, ValidationRegistry, RuntimeAgent,
    RuntimeSkill, SkillRoleRegistry, WorkflowPolicy, UIContract, RuntimeGraphSnapshot, RuntimeGraphElement, AuditLog]
  assert.equal(new Set(models.map((model) => model.collection.name)).size, 19)
  const rows = new Map(models.map((model) => [model.collection.name, []]))
  const ids = Object.fromEntries(['actor', 'customer', 'tenant', 'license', 'sourcePackage', 'targetPackage', 'runtime',
    'frameworkRegistry', 'path', 'validationPath', 'role', 'skill', 'agent', 'validation', 'sharedPolicy',
    'returnPolicy', 'sourceUi', 'targetUi']
    .map((key) => [key, new mongoose.Types.ObjectId()]))
  assert.equal(new Set(Object.values(ids).map(String)).size, Object.keys(ids).length)
  const suffix = String(ids.runtime).slice(-10)
  const when = new Date()
  const normalize = async (Model, values) => {
    const doc = new Model({ createdAt: when, updatedAt: when, ...values })
    await doc.validate()
    return doc
  }
  const add = (Model, doc) => { rows.get(Model.collection.name).push(bson(doc)); return doc }
  const common = { status: 'ACTIVE', isLocked: true, versionStatus: 'ACTIVE', componentVersion: 1,
    lockedAt: when, lockedBy: ids.actor, createdBy: ids.actor, updatedBy: ids.actor }

  stage = 'OFFLINE_FIXTURES'
  add(LicenseLevel, await normalize(LicenseLevel, { _id: ids.license, name: `SS018 proof ${suffix}`,
    featureEntitlements: ['VMF'], isActive: true, createdBy: ids.actor, updatedBy: ids.actor }))
  add(Customer, await normalize(Customer, { _id: ids.customer, name: `SS018 proof customer ${suffix}`,
    topology: 'SINGLE_TENANT', vmfPolicy: 'SINGLE', defaultTenantId: ids.tenant, licenseLevelId: ids.license,
    status: 'ACTIVE', createdBy: ids.actor, billing: { planCode: 'SS018_SYNTHETIC', cycle: 'MONTHLY' } }))
  add(Tenant, await normalize(Tenant, { _id: ids.tenant, customerId: ids.customer,
    name: `SS018 proof tenant ${suffix}`, website: 'https://example.invalid', status: 'ENABLED', isDefault: true,
    tenantAdminUserIds: [ids.actor] }))
  add(FrameworkRegistry, await normalize(FrameworkRegistry, { _id: ids.frameworkRegistry, frameworkKey: 'VMF',
    name: 'Synthetic proof framework', type: 'structured', structureType: 'section_based', status: 'ACTIVE',
    createdBy: ids.actor, updatedBy: ids.actor }))
  const path = add(RuntimePathRegistry, await normalize(RuntimePathRegistry, { ...common, _id: ids.path,
    pathKey: `framework_state.sections.proof_${suffix}`, label: 'Proof Context', description: 'Synthetic proof path',
    frameworkKeys: ['VMF'], scope: 'FRAMEWORK_STATE', allowedOperations: ['READ', 'WRITE', 'BIND'],
    dataType: 'OBJECT', category: 'SECTION', sourceType: 'RUNTIME_STATE' }))
  const validationPath = add(RuntimePathRegistry, await normalize(RuntimePathRegistry, { ...common,
    _id: ids.validationPath, pathKey: `framework_state.validation.proof_${suffix}`, label: 'Proof Validation Result',
    description: 'Synthetic proof validation result path', frameworkKeys: ['VMF'], scope: 'VALIDATION_RESULT',
    allowedOperations: ['READ', 'WRITE', 'BIND'], dataType: 'OBJECT', category: 'VALIDATION',
    sourceType: 'GENERATED_RUNTIME_STATE' }))
  const role = add(SkillRoleRegistry, await normalize(SkillRoleRegistry, { ...common, _id: ids.role,
    roleKey: `QA_${suffix.toUpperCase()}`, label: 'Proof Validator', description: 'Synthetic proof role',
    allowedOperations: ['READ', 'EXECUTE'] }))
  const skill = add(RuntimeSkill, await normalize(RuntimeSkill, { ...common, _id: ids.skill,
    key: `ss018-proof-skill-${suffix}`, name: 'Proof validation', supportedFrameworkKeys: ['VMF'], skillRoleKey: role.roleKey }))
  const agent = add(RuntimeAgent, await normalize(RuntimeAgent, { ...common, _id: ids.agent,
    key: `ss018-proof-agent-${suffix}`, name: 'Proof agent', supportedFrameworkKeys: ['VMF'], defaultSkillIds: [skill.stableId] }))
  const validation = add(ValidationRegistry, await normalize(ValidationRegistry, { ...common, _id: ids.validation,
    key: `ss018-proof-check-${suffix}`, label: 'Proof check', description: 'Synthetic proof check',
    supportedFrameworkKeys: ['VMF'], category: 'COMPLETENESS', severity: 'ERROR', producerSkillId: skill.stableId,
    defaultAgentIds: [agent.stableId], outputPath: `framework_state.validation.proof_${suffix}`, resultType: 'OBJECT' }))
  const sharedPolicy = add(WorkflowPolicy, await normalize(WorkflowPolicy, { ...common, _id: ids.sharedPolicy,
    key: `ss018-proof-review-${suffix}`, name: 'Proof review', frameworkKeys: ['VMF'], policyType: 'LIFECYCLE_GATE',
    triggerEvent: 'ON_STAGE_CHANGE', governedAction: 'SUBMIT_FOR_REVIEW', requireSuccess: true }))
  const returnPolicy = add(WorkflowPolicy, await normalize(WorkflowPolicy, { ...common, _id: ids.returnPolicy,
    key: `ss018-proof-return-${suffix}`, name: 'Proof return', frameworkKeys: ['VMF'], policyType: 'LIFECYCLE_GATE',
    triggerEvent: 'ON_STAGE_CHANGE', governedAction: 'RETURN_TO_DRAFT', requireSuccess: true }))
  const sourceKey = `ss018-proof-source-${suffix}`
  const targetKey = `ss018-proof-target-${suffix}`
  const uiBase = { ...common, frameworkKeys: ['VMF'], sourceFrameworkKey: 'VMF',
    sections: [{ sectionKey: 'context', runtimePath: path.pathKey, label: 'Context', displayOrder: 1 }],
    lifecycleStages: [{ stageKey: 'IN_REVIEW', label: 'In review', displayOrder: 1 }], actions: [] }
  const sourceUi = add(UIContract, await normalize(UIContract, { ...uiBase, _id: ids.sourceUi,
    uiContractKey: `ss018-proof-ui-source-${suffix}`, name: 'Proof source UI', sourcePackageKey: sourceKey,
    sourcePackageVersion: '1.0.0' }))
  const targetUi = add(UIContract, await normalize(UIContract, { ...uiBase, _id: ids.targetUi,
    uiContractKey: `ss018-proof-ui-target-${suffix}`, name: 'Proof target UI', sourcePackageKey: targetKey,
    sourcePackageVersion: '1.0.1', actions: [{ actionKey: 'RETURN_TO_DRAFT', governedAction: 'RETURN_TO_DRAFT',
      buttonLabel: 'Return to Draft', displayOrder: 1, isVisible: true, requiresConfirmation: true }] }))
  const packageBase = { ...common, status: 'VALIDATED', frameworkKey: 'VMF', frameworkName: 'Synthetic proof framework',
    visibility: 'CUSTOMER_VISIBLE', customerAccessMode: 'ALL_CUSTOMERS', isDefault: false,
    sections: [{ sectionKey: 'context', runtimePath: path.pathKey, validationKeys: [validation.key] }],
    workflowBindings: [{ policyKey: sharedPolicy.key, executionContext: 'ON_STAGE_EXIT', priority: 1, enabled: true }] }
  const packages = []
  for (let index = 0; index < 2; index++) {
    const ui = index ? targetUi : sourceUi
    const pkg = await normalize(FrameworkPackage, { ...packageBase, _id: index ? ids.targetPackage : ids.sourcePackage,
      packageKey: index ? targetKey : sourceKey, version: index ? '1.0.1' : '1.0.0',
      derivedFromPackageId: index ? String(ids.sourcePackage) : '', uiContractKey: ui.uiContractKey,
      uiContractBinding: { key: ui.uiContractKey, version: ui.sourcePackageVersion, status: 'ACTIVE',
        compatibilityMode: ui.compatibilityMode, resolvedAt: when }, workflowBindings: [...packageBase.workflowBindings,
        ...(index ? [{ policyKey: returnPolicy.key, executionContext: 'ON_STAGE_EXIT', priority: 2, enabled: true }] : [])] })
    const ref = (doc, key, name) => ({ id: doc.stableId, key, name, status: doc.status,
      versionStatus: doc.versionStatus, componentVersion: doc.componentVersion, lineageId: doc.lineageId, issues: [] })
    const dependencies = { runtimePaths: [path, validationPath].map((entry) => ref(entry, entry.pathKey, entry.label)),
      validations: [ref(validation, validation.key, validation.label)],
      workflowPolicies: [ref(sharedPolicy, sharedPolicy.key, sharedPolicy.name),
        ...(index ? [ref(returnPolicy, returnPolicy.key, returnPolicy.name)] : [])],
      agents: [ref(agent, agent.key, agent.name)], skills: [ref(skill, skill.key, skill.name)],
      skillRoles: [ref(role, role.roleKey, role.label)], uiContract: { ...ref(ui, ui.uiContractKey, ui.name),
        sourcePackageKey: ui.sourcePackageKey, sourcePackageVersion: ui.sourcePackageVersion,
        compatibilityMode: ui.compatibilityMode, sectionMapping: { mapped: ['context'], missing: [], orphaned: [],
          runtimePathMismatches: [], custom: [], counts: { packageSections: 1, mapped: 1, missing: 0,
            orphaned: 0, runtimePathMismatches: 0, custom: 0 } }, lifecycleStageCount: ui.lifecycleStages.length,
        actionCount: ui.actions.length } }
    pkg.dependencyLock = buildDependencyLockSnapshot({ frameworkPackage: bson(pkg), dependencies,
      actorUserId: ids.actor, lockedAt: when })
    const { snapshotId: _id, snapshotHash: _hash, ...payload } = json(bson(pkg).dependencyLock)
    pkg.dependencyLock.snapshotHash = generateChecksum(payload)
    await pkg.validate()
    assert.equal(resolveRuntimeReleaseDependencySnapshot({ sourceSnapshot: json(bson(pkg).dependencyLock) }).metadataIntegrityVerified, true)
    packages.push(add(FrameworkPackage, pkg))
  }
  const compatibility = checkRuntimeReleaseAuthoredCompatibility({
    sourcePackage: { ...json(bson(packages[0])), status: 'ACTIVE' },
    targetPackage: { ...json(bson(packages[1])), status: 'ACTIVE' },
    sourceUi: json(bson(sourceUi)), targetUi: json(bson(targetUi)),
    addedPolicy: json(Object.fromEntries(['key', 'frameworkKeys', 'status', 'isLocked', 'governedAction', 'policyType',
      'appliesTo', 'triggerEvent', 'triggerMode', 'actorScope', 'decisionMode', 'executionType', 'requireSuccess',
      'overrideAllowed', 'approvalRequired', 'conditions', 'steps', 'orderedSteps', 'gatingRules', 'onPassEffects',
      'onFailEffects', 'requiredAgentIds', 'requiredSkillIds', 'requiredValidationKeys', 'primaryAgentId',
      'fallbackAgentId', 'escalationRoleKey', 'escalateTo'].map((key) => [key, bson(returnPolicy)[key]]))) })
  assert(compatibility.authoredConfigurationCompatible, `Offline compatibility: ${compatibility.reason}`)
  assert(packages.every((pkg) => !pkg.runtimeVerdict), 'Fixture must not manufacture verdicts')
  assert.equal(rows.get(RuntimeActivationSnapshot.collection.name).length, 0)
  assert.equal(rows.get(RuntimeDeployment.collection.name).length, 0)
  const initialDocuments = [...rows.values()].reduce((sum, values) => sum + values.length, 0)
  assert.equal(initialDocuments, 16)

  const indexPlans = new Map(models.map((Model) => {
    const unique = new Map()
    for (const [key, options] of Model.schema.indexes()) {
      const { name, background: _background, ...constraints } = options
      const fingerprint = hashJson(generateChecksum, { key: Object.entries(key), constraints })
      if (!unique.has(fingerprint) || name) unique.set(fingerprint, { key, options: { ...constraints, ...(name ? { name } : {}) } })
    }
    return [Model.collection.name, [...unique.values()]]
  }))
  report({ stage: 'OFFLINE_PASS', database: DATABASE, mode: apply ? 'apply' : 'dry-run', fixtureDocuments: initialDocuments,
    collections: models.map((Model) => ({ name: Model.collection.name, documents: rows.get(Model.collection.name).length,
      indexes: indexPlans.get(Model.collection.name) })), snapshotHashes: packages.map((pkg) => pkg.dependencyLock.snapshotHash),
    authoredCompatibility: true, manufacturedEvidence: false,
    evidence: 'Synthetic model/checksum validation only; no database connection or persistence claim' })

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
    const baseValidator = { $jsonSchema: { bsonType: 'object' } }
    const validatorCollections = new Set([AuditLog.collection.name, RuntimeValidationAudit.collection.name])
    stage = 'INDEX_SETUP'
    for (const Model of models) {
      await db.createCollection(Model.collection.name, validatorCollections.has(Model.collection.name)
        ? { validator: baseValidator, validationLevel: 'strict', validationAction: 'error' } : {})
      for (const { key, options } of indexPlans.get(Model.collection.name)) await Model.collection.createIndex(key, options)
      const actual = await Model.collection.listIndexes().toArray()
      for (const { key, options } of indexPlans.get(Model.collection.name)) {
        const textIndex = Model === RuntimePathRegistry && options.name === 'runtime_path_registry_text_search'
          && Object.values(key).every((value) => value === 'text')
        assert(actual.some((index) => (textIndex
          ? index.name === options.name && JSON.stringify(Object.entries(index.key)) === JSON.stringify([['_fts', 'text'], ['_ftsx', 1]])
            && hashJson(generateChecksum, index.weights || {}) === hashJson(generateChecksum, options.weights)
          : JSON.stringify(Object.entries(index.key)) === JSON.stringify(Object.entries(key)))
          && Boolean(index.unique) === Boolean(options.unique)
          && hashJson(generateChecksum, index.partialFilterExpression || {}) === hashJson(generateChecksum, options.partialFilterExpression || {})
          && index.expireAfterSeconds === options.expireAfterSeconds), 'Index readback mismatch')
      }
    }
    const inventory = async () => {
      const collections = await db.listCollections().toArray()
      assert.deepEqual(collections.map((entry) => entry.name).sort(), [...rows.keys()].sort(), 'Unexpected collection')
      return Promise.all(collections.sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => ({
        name: entry.name,
        uuid: entry.info?.uuid,
        options: entry.options,
        // Fingerprint the complete server readback, not only authored index plans.
        // This makes an extra index or any reported key/option drift block cleanup.
        indexes: (await db.collection(entry.name).listIndexes().toArray())
          .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''))),
      })))
    }
    const ownedInventory = hashJson(generateChecksum, await inventory())
    stage = 'FIXTURE_INSERT'
    for (const [name, documents] of rows) if (documents.length) await db.collection(name).insertMany(documents)
    const readAll = async () => Object.fromEntries(await Promise.all([...rows.keys()].map(async (name) =>
      [name, await db.collection(name).find({}).sort({ _id: 1 }).toArray()])))
    const initial = await readAll()
    const sharedNames = [FrameworkRegistry, RuntimePathRegistry, ValidationRegistry, RuntimeAgent, RuntimeSkill, SkillRoleRegistry,
      WorkflowPolicy, UIContract].map((Model) => Model.collection.name)
    const sharedBaseline = Object.fromEntries(sharedNames.map((name) => [name, initial[name]]))
    const originalValidators = new Map()
    for (const Model of [AuditLog, RuntimeValidationAudit]) {
      const options = (await db.listCollections({ name: Model.collection.name }).toArray())[0].options
      originalValidators.set(Model.collection.name, { validator: options.validator, validationLevel: options.validationLevel,
        validationAction: options.validationAction })
    }
    const restoreValidator = async (Model) => {
      await db.command({ collMod: Model.collection.name, ...originalValidators.get(Model.collection.name) })
      const options = (await db.listCollections({ name: Model.collection.name }).toArray())[0].options
      assert.deepEqual({ validator: options.validator, validationLevel: options.validationLevel,
        validationAction: options.validationAction }, originalValidators.get(Model.collection.name))
    }
    const assertCode121 = async (operation) => {
      let rejected = false
      try { await operation() } catch (error) { assert.equal(error.code, 121); rejected = true }
      assert(rejected, 'Expected MongoDB document validation error 121')
    }
    const validationInput = (pkg, label) => ({ operationType: 'OUTPUT_VALIDATION', mode: 'STRICT',
      packageId: String(pkg._id), frameworkKey: 'VMF', actorId: String(ids.actor), actorType: 'USER',
      requestId: `ss018-${label}-${randomUUID()}`, isPackageLevelValidation: true,
      outputContract: { type: 'object' }, payload: {} })

    stage = 'CERTIFICATION_AUDIT_ABORT'
    await db.command({ collMod: RuntimeValidationAudit.collection.name,
      validator: { isPackageLevelValidation: { $ne: true } }, validationLevel: 'strict', validationAction: 'error' })
    const beforeCertificationFault = await readAll()
    await assertCode121(() => validateRuntimeOperation(validationInput(packages[0], 'source-fault')))
    assert.equal(hashJson(generateChecksum, await readAll()), hashJson(generateChecksum, beforeCertificationFault),
      'Certification audit failure left residue')
    await restoreValidator(RuntimeValidationAudit)
    report({ stage: 'CERTIFICATION_AUDIT_ABORT_PASS', mongoErrorCode: 121, residue: false })

    const certify = async (pkg, label) => {
      const result = await validateRuntimeOperation(validationInput(pkg, label))
      assert.equal(result.result, 'ALLOW')
      const stored = await FrameworkPackage.findById(pkg._id).select('+validationConfig +workflowPolicyConfig +compatibleWorkflowKeys +defaultAgentIds +requiredSkillIds +validationRules').lean()
      const audit = await RuntimeValidationAudit.findById(stored.runtimeVerdict.auditId).lean()
      assert(audit && audit.isPackageLevelValidation === true && audit.result === 'ALLOW')
      assert.equal(String(audit._id), stored.runtimeVerdict.auditId)
      assert.equal(hashJson(generateChecksum, audit.certificationBinding), hashJson(generateChecksum, stored.runtimeVerdict.certificationBinding))
      return stored
    }
    const controllerRequest = (packageId, label) => ({ params: { packageId: String(packageId) },
      context: { userId: String(ids.actor) }, userId: String(ids.actor), requestId: `ss018-${label}-${randomUUID()}`,
      ip: '127.0.0.1', get: (name) => name === 'user-agent' ? 'ss018-isolated-proof' : undefined })
    const activate = async (packageId, label) => {
      let status = null; let body = null; let nextError = null
      const res = { status(value) { status = value; return this }, json(value) { body = value; return value } }
      await activateFrameworkPackage(controllerRequest(packageId, label), res, (error) => { nextError = error })
      if (nextError) throw nextError
      assert.equal(status, 200, `Activation controller returned ${status}`)
      assert(body?.meta?.runtimeActivation, 'Activation response omitted runtime evidence')
      return body
    }

    stage = 'SOURCE_CERTIFY_ACTIVATE'
    const certifiedSource = await certify(packages[0], 'source')
    const sourceResponse = await activate(packages[0]._id, 'source-activate')
    const sourceActivation = await RuntimeActivationSnapshot.findOne({ packageId: packages[0]._id, activationStatus: 'ACTIVE' }).lean()
    const sourceDeployment = await RuntimeDeployment.findOne({ packageId: packages[0]._id, status: 'ACTIVE' }).lean()
    assert(sourceActivation && sourceDeployment && sourceActivation.deploymentId === sourceDeployment.deploymentId)
    assert.equal(hashJson(generateChecksum, sourceActivation.certificationBinding), hashJson(generateChecksum, certifiedSource.runtimeVerdict.certificationBinding))
    assert(sourceResponse.meta.runtimeActivation.activationSnapshot)

    const sourcePackageNow = await FrameworkPackage.findById(packages[0]._id).lean()
    const runtimeDoc = await normalize(RuntimeInstance, { _id: ids.runtime, runtimeInstanceKey: `ss018-proof-runtime-${suffix}`,
      customerId: ids.customer, tenantId: ids.tenant, runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF',
      packageId: sourcePackageNow._id, packageKey: sourcePackageNow.packageKey, packageVersion: sourcePackageNow.version,
      dependencyLockId: sourcePackageNow.dependencyLock.snapshotId, activationId: sourceActivation.activationId,
      deploymentId: sourceDeployment.deploymentId, evidence: { activationId: sourceActivation.activationId,
        deploymentId: sourceDeployment.deploymentId, dependencySnapshotId: sourcePackageNow.dependencyLock.snapshotId,
        dependencySnapshotHash: sourcePackageNow.dependencyLock.snapshotHash }, status: 'ACTIVE',
      executionStatus: 'WAITING_APPROVAL', stateVersion: `ss018-proof-state-${suffix}`,
      name: 'Synthetic certification flow proof', createdBy: ids.actor, updatedBy: ids.actor,
      framework_state: { lifecycle: { stage: 'IN_REVIEW' }, readiness: { state: 'IN_REVIEW' },
        sections: { context: { content: 'Protected synthetic truth' } }, evidence_pack: { synthetic: true }, lock: {}, publish: {} } })
    await RuntimeInstance.collection.insertOne(bson(runtimeDoc))
    const runtimeBefore = await RuntimeInstance.collection.findOne({ _id: ids.runtime })

    stage = 'TARGET_CERTIFY'
    const certifiedTarget = await certify(packages[1], 'target')
    assert.notEqual(certifiedSource.runtimeVerdict.certificationBinding.digest, certifiedTarget.runtimeVerdict.certificationBinding.digest)
    const beforeActivationFault = await readAll()
    stage = 'ACTIVATION_AUDIT_ABORT'
    await db.command({ collMod: AuditLog.collection.name, validator: { action: { $ne: 'FRAMEWORK_PACKAGE_ACTIVATED' } },
      validationLevel: 'strict', validationAction: 'error' })
    await assertCode121(() => activate(packages[1]._id, 'target-fault'))
    assert.equal(hashJson(generateChecksum, await readAll()), hashJson(generateChecksum, beforeActivationFault),
      'Activation audit failure left residue')
    await restoreValidator(AuditLog)
    report({ stage: 'ACTIVATION_AUDIT_ABORT_PASS', mongoErrorCode: 121, residue: false })

    stage = 'TARGET_ACTIVATE'
    await activate(packages[1]._id, 'target-activate')
    const targetActivation = await RuntimeActivationSnapshot.findOne({ packageId: packages[1]._id, activationStatus: 'ACTIVE' }).lean()
    const targetDeployment = await RuntimeDeployment.findOne({ packageId: packages[1]._id, status: 'ACTIVE' }).lean()
    const [sourceAfterTarget, targetAfterTarget] = await Promise.all([
      FrameworkPackage.findById(packages[0]._id).lean(), FrameworkPackage.findById(packages[1]._id).lean()])
    assert(targetActivation && targetDeployment && targetActivation.deploymentId === targetDeployment.deploymentId)
    assert.equal(hashJson(generateChecksum, targetActivation.certificationBinding), hashJson(generateChecksum, targetAfterTarget.runtimeVerdict.certificationBinding))
    assert(sourceAfterTarget.status === 'ACTIVE' && sourceAfterTarget.isDefault === false)
    assert(targetAfterTarget.status === 'ACTIVE' && targetAfterTarget.isDefault === true)
    assert.equal(hashJson(generateChecksum, sourceAfterTarget.dependencyLock), hashJson(generateChecksum, certifiedSource.dependencyLock),
      'Activation changed the source certified dependency snapshot')
    assert.equal(hashJson(generateChecksum, targetAfterTarget.dependencyLock), hashJson(generateChecksum, certifiedTarget.dependencyLock),
      'Activation refreshed certified dependency snapshot')

    const scope = { resolvedPermissions: { platform: { roleKeys: [], permissions: [] }, customers: [],
      tenants: [{ customerId: String(ids.customer), tenantId: String(ids.tenant), roleKeys: [], permissions: ['VMF_UPDATE'] }] } }
    const baseArgs = { actorUserId: String(ids.actor), scopes: scope, runtimeInstanceId: String(ids.runtime),
      auditRequest: { requestId: `ss018-adoption-${randomUUID()}` } }
    const forward = { ...baseArgs, payload: { targetPackageId: String(packages[1]._id),
      targetDeploymentId: targetDeployment.deploymentId, expectedUpdatedAt: runtimeBefore.updatedAt.toISOString(),
      reason: 'Synthetic genuine certification adoption proof' } }
    stage = 'ADOPTION_AUDIT_ABORT'
    await db.command({ collMod: AuditLog.collection.name, validator: { action: { $ne: 'RUNTIME_RELEASE_ADOPTED' } },
      validationLevel: 'strict', validationAction: 'error' })
    const beforeAdoptionFault = await readAll()
    await assertCode121(() => adoptRuntimeRelease(forward))
    assert.equal(hashJson(generateChecksum, await readAll()), hashJson(generateChecksum, beforeAdoptionFault),
      'Adoption audit failure left residue')
    await restoreValidator(AuditLog)
    report({ stage: 'ADOPTION_AUDIT_ABORT_PASS', mongoErrorCode: 121, residue: false })

    stage = 'ADOPTION_COMMIT'
    const receipt = await adoptRuntimeRelease(forward)
    stage = 'SOURCE_REACTIVATE'
    await activate(packages[0]._id, 'source-reactivate')
    const reactivatedSource = await RuntimeActivationSnapshot.findOne({
      packageId: packages[0]._id,
      activationStatus: 'ACTIVE',
    }).lean()
    const reactivatedSourceDeployment = await RuntimeDeployment.findOne({
      packageId: packages[0]._id,
      status: 'ACTIVE',
    }).lean()
    assert(reactivatedSource && reactivatedSourceDeployment)
    assert.equal(reactivatedSource.packageStatusAtActivation, 'ACTIVE')
    assert.equal(reactivatedSource.supersedesActivationId, sourceActivation.activationId)
    assert.equal(reactivatedSourceDeployment.activationId, reactivatedSource.activationId)

    const final = await readAll()
    const finalPackages = final[FrameworkPackage.collection.name]
    const finalSourcePackage = finalPackages.find((row) => String(row._id) === String(ids.sourcePackage))
    const finalTargetPackage = finalPackages.find((row) => String(row._id) === String(ids.targetPackage))
    const runtime = final[RuntimeInstance.collection.name][0]
    const targetBinding = { packageId: targetAfterTarget._id, packageKey: targetAfterTarget.packageKey,
      packageVersion: targetAfterTarget.version, dependencyLockId: targetAfterTarget.dependencyLock.snapshotId,
      activationId: targetActivation.activationId, deploymentId: targetDeployment.deploymentId,
      evidence: { activationId: targetActivation.activationId, deploymentId: targetDeployment.deploymentId,
        dependencySnapshotId: targetAfterTarget.dependencyLock.snapshotId,
        dependencySnapshotHash: targetAfterTarget.dependencyLock.snapshotHash } }
    const adoptionAudit = final[AuditLog.collection.name].find((audit) => audit.diff?.operationId === receipt.operationId)
    const expectedActions = { RUNTIME_VALIDATION_ALLOWED: 2, FRAMEWORK_PACKAGE_ACTIVATED: 3,
      RUNTIME_ACTIVATION_COMPLETED: 3, RUNTIME_DEPLOYMENT_REGISTERED: 3, RUNTIME_RELEASE_ADOPTED: 1 }
    const check = (operation) => {
      try { return operation() === true } catch { return false }
    }
    const exact = (actual, expected) => check(() => {
      assert.deepEqual(actual, expected)
      return true
    })
    const signatureChecks = final[AuditLog.collection.name].map((audit) => ({
      action: audit.action,
      resourceId: String(audit.resourceId),
      signatureVersion: audit.signatureVersion,
      valid: check(() => AuditLog.hydrate(audit).verifySignature()),
    }))
    const ownedModels = [RuntimeInstance, RuntimeValidationAudit, RuntimeActivationSnapshot, RuntimeDeployment, AuditLog]
    const postCommitChecks = {
      finalPackagesPresent: Boolean(finalSourcePackage && finalTargetPackage),
      sourceDependencyLockUnchanged: check(() => hashJson(generateChecksum, finalSourcePackage.dependencyLock)
        === hashJson(generateChecksum, certifiedSource.dependencyLock)),
      targetDependencyLockUnchanged: check(() => hashJson(generateChecksum, finalTargetPackage.dependencyLock)
        === hashJson(generateChecksum, certifiedTarget.dependencyLock)),
      sourceRestoredAsOnlyDefault: finalSourcePackage?.status === 'ACTIVE' && finalSourcePackage?.isDefault === true
        && finalTargetPackage?.status === 'ACTIVE' && finalTargetPackage?.isDefault === false
        && finalPackages.filter((row) => row.frameworkKey === 'VMF' && row.isDefault === true).length === 1,
      protectedRuntimeUnchanged: check(() => hashJson(generateChecksum, protectedRuntime(runtime))
        === hashJson(generateChecksum, protectedRuntime(runtimeBefore))),
      targetBindingMatches: check(() => hashJson(generateChecksum, pickBinding(runtime))
        === hashJson(generateChecksum, targetBinding)),
      releaseHistoryCount: check(() => runtime.releaseBindingHistory.length === 1),
      releaseHistoryOperationMatches: check(() => runtime.releaseBindingHistory[0].operationId === receipt.operationId),
      validationAuditCount: final[RuntimeValidationAudit.collection.name].length === 2,
      activationSnapshotCount: final[RuntimeActivationSnapshot.collection.name].length === 3,
      deploymentCount: final[RuntimeDeployment.collection.name].length === 3,
      auditCount: final[AuditLog.collection.name].length === 12,
      sourceReactivationProvenanceTruthful: check(() => {
        const sourceRows = final[RuntimeActivationSnapshot.collection.name]
          .filter((row) => String(row.packageId) === String(ids.sourcePackage))
        const sourceDeployments = final[RuntimeDeployment.collection.name]
          .filter((row) => String(row.packageId) === String(ids.sourcePackage))
        const previous = sourceRows.find((row) => row.activationId === sourceActivation.activationId)
        const current = sourceRows.find((row) => row.activationId === reactivatedSource.activationId)
        const previousDeployment = sourceDeployments.find((row) => row.deploymentId === sourceDeployment.deploymentId)
        const currentDeployment = sourceDeployments.find((row) => row.deploymentId === reactivatedSourceDeployment.deploymentId)
        return sourceRows.length === 2
          && sourceDeployments.length === 2
          && previous?.activationStatus === 'SUPERSEDED'
          && previous?.supersededByActivationId === current?.activationId
          && current?.activationStatus === 'ACTIVE'
          && current?.packageStatusAtActivation === 'ACTIVE'
          && current?.supersedesActivationId === previous?.activationId
          && previousDeployment?.status === 'SUPERSEDED'
          && previousDeployment?.supersededByDeploymentId === currentDeployment?.deploymentId
          && currentDeployment?.status === 'ACTIVE'
          && !currentDeployment?.supersededByDeploymentId
      }),
      targetActivationRemainsUnsuperseded: check(() => {
        const snapshot = final[RuntimeActivationSnapshot.collection.name]
          .find((row) => row.activationId === targetActivation.activationId)
        const deployment = final[RuntimeDeployment.collection.name]
          .find((row) => row.deploymentId === targetDeployment.deploymentId)
        return snapshot?.activationStatus === 'ACTIVE'
          && !snapshot?.supersededByActivationId
          && deployment?.status === 'ACTIVE'
          && !deployment?.supersededByDeploymentId
      }),
      allAuditSignaturesValid: signatureChecks.every((entry) => entry.valid),
      adoptionAuditFound: Boolean(adoptionAudit && adoptionAudit.action === 'RUNTIME_RELEASE_ADOPTED'),
      adoptionAuditMatchesHistory: check(() => hashJson(generateChecksum, adoptionAudit.diff)
        === hashJson(generateChecksum, runtime.releaseBindingHistory[0])),
      sharedDependenciesUnchanged: check(() => hashJson(generateChecksum,
        Object.fromEntries(sharedNames.map((name) => [name, final[name]])))
        === hashJson(generateChecksum, sharedBaseline)),
      graphSnapshotsEmpty: final[RuntimeGraphSnapshot.collection.name].length === 0,
      graphElementsEmpty: final[RuntimeGraphElement.collection.name].length === 0,
      ownedFixtureDocumentIdsMatch: check(() => [...rows].every(([name, documents]) => ownedModels
        .some((Model) => Model.collection.name === name) || exact(
          final[name].map((row) => String(row._id)).sort(),
          documents.map((row) => String(row._id)).sort(),
        ))),
      runtimeDocumentOwnershipMatches: exact(
        final[RuntimeInstance.collection.name].map((row) => String(row._id)), [String(ids.runtime)]),
      validationAuditPackageOwnershipMatches: exact(
        final[RuntimeValidationAudit.collection.name].map((row) => row.packageId).sort(),
        [String(ids.sourcePackage), String(ids.targetPackage)].sort()),
      activationSnapshotPackageOwnershipMatches: exact(
        final[RuntimeActivationSnapshot.collection.name].map((row) => String(row.packageId)).sort(),
        [String(ids.sourcePackage), String(ids.sourcePackage), String(ids.targetPackage)].sort()),
      deploymentPackageOwnershipMatches: exact(
        final[RuntimeDeployment.collection.name].map((row) => String(row.packageId)).sort(),
        [String(ids.sourcePackage), String(ids.sourcePackage), String(ids.targetPackage)].sort()),
      auditActionCountsMatch: exact(Object.fromEntries(Object.keys(expectedActions).map((action) => [action,
        final[AuditLog.collection.name].filter((row) => row.action === action).length])), expectedActions),
      auditResourceOwnershipMatches: final[AuditLog.collection.name].every((row) => [String(ids.sourcePackage),
        String(ids.targetPackage), String(ids.runtime)].includes(String(row.resourceId))),
    }
    report({ stage: 'ADOPTION_POSTCOMMIT_CHECKS', checks: postCommitChecks, auditSignatures: signatureChecks })
    for (const [key, passed] of Object.entries(postCommitChecks)) assert.equal(passed, true, key)
    report({ stage: 'ADOPTION_AND_REACTIVATION_COMMIT_PASS', genuineValidationAudits: 2, activationBindings: 3,
      signedAuditCount: 12, refreshRequired: receipt.refreshRequired, protectedTruthUnchanged: true })

    stage = 'OWNED_CLEANUP'
    await guardIdentity()
    assert(owned && ownedInventory)
    assert.equal(hashJson(generateChecksum, await inventory()), ownedInventory, 'Collection ownership/options changed')
    assert.equal(hashJson(generateChecksum, await readAll()), hashJson(generateChecksum, final), 'Unexpected residue: preserving database')
    await db.dropDatabase()
    assert.equal((await db.listCollections({}, { nameOnly: true }).toArray()).length, 0)
    owned = false
    report({ stage: 'CLEANUP_PASS', database: DATABASE, deletedExactDatabase: true,
      evidence: 'Synthetic real producer/controller/adoption persistence; no JWT, browser, benchmark, deployment or production claim' })
  }
} catch (error) {
  report({ status: 'FAIL', stage, mongoCode: Number.isInteger(error.code) ? error.code : null,
    reason: error.name === 'AssertionError' ? 'ASSERTION_FAILED'
      : error.name === 'ValidationError' ? 'FIXTURE_VALIDATION_FAILED' : 'OPERATION_FAILED',
    fixturePaths: error.name === 'ValidationError' ? Object.keys(error.errors || {}) : undefined,
    isolatedResiduePreserved: owned })
  process.exitCode = 1
} finally {
  if (connected || mongoose.connection.readyState !== 0) await mongoose.disconnect()
}
