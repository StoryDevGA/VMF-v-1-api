import FrameworkPackageDisplayBinding from '../models/FrameworkPackageDisplayBinding.js'
import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'
import RuntimeInstance from '../models/RuntimeInstance.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimeDeployment from '../models/RuntimeDeployment.js'
import RuntimeActivationSnapshot from '../models/RuntimeActivationSnapshot.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import RuntimePathRegistry from '../models/RuntimePathRegistry.js'
import ValidationRegistry from '../models/ValidationRegistry.js'
import WorkflowPolicy from '../models/WorkflowPolicy.js'
import RuntimeAgent from '../models/RuntimeAgent.js'
import RuntimeSkill from '../models/RuntimeSkill.js'
import SkillRoleRegistry from '../models/SkillRoleRegistry.js'
import UIContract from '../models/UIContract.js'
import { generateChecksum } from '../services/governanceAudit/checksumService.js'

const permission = jest.fn()
const context = jest.fn()
const entitlement = jest.fn()
const audit = jest.fn()
const verifyCertification = jest.fn()
jest.unstable_mockModule('../services/runtimeInstanceService.js', () => ({
  assertRuntimePermission: permission, assertCustomerTenantContext: context, assertFeatureEntitlement: entitlement,
  createRuntimeInstanceError: ({ status, code, message, reason }) => Object.assign(new Error(message), { status, code, details: { reason } }),
}))
jest.unstable_mockModule('../services/auditService.js', () => ({ default: { logFromRequest: audit },
  AUDIT_ACTIONS: { RUNTIME_RELEASE_ADOPTED: 'RUNTIME_RELEASE_ADOPTED', RUNTIME_RELEASE_ROLLED_BACK: 'RUNTIME_RELEASE_ROLLED_BACK' },
}))
jest.unstable_mockModule('../services/runtimeReleaseCertificationCaptureService.js', () => ({
  CERTIFICATION_PACKAGE_SELECTION: '+certificationAuthoredFields',
  verifyRuntimeReleaseCertification: verifyCertification,
}))
const { adoptRuntimeRelease: adopt, rollbackRuntimeRelease: rollback } = await import('../services/runtimeReleaseAdoptionService.js')
const clone = (value) => structuredClone(value)
const id = (number) => number.toString(16).padStart(24, '0')
const t0 = '2026-09-01T10:00:00.000Z'
const t1 = '2026-09-02T10:00:00.000Z'
const types = { RuntimePathRegistry, ValidationRegistry, WorkflowPolicy, RuntimeAgent, RuntimeSkill, SkillRoleRegistry, UIContract }
const sign = (snapshot) => {
  const { snapshotId: _id, snapshotHash: _hash, ...payload } = snapshot
  snapshot.snapshotHash = generateChecksum(payload)
  return snapshot
}
let db, session, reads, writes, auditRows, selections
const query = (get) => {
  let attached
  const q = { select: jest.fn((value) => { selections.push(value); return q }), session: jest.fn((value) => { attached = value; return q }),
    lean: jest.fn(async () => { expect(attached).toBe(session); reads++; return clone(get()) }) }
  return q
}
const fixture = () => {
  const policy = { _id: id(30), stableId: 'policy-return', key: 'return', frameworkKeys: ['VMF'],
    status: 'ACTIVE', isLocked: true, versionStatus: 'ACTIVE', componentVersion: 1,
    governedAction: 'RETURN_TO_DRAFT', policyType: 'LIFECYCLE_GATE', appliesTo: 'FRAMEWORK_LIFECYCLE',
    triggerEvent: 'ON_STAGE_CHANGE', triggerMode: 'PRE_ACTION', actorScope: 'ANY', decisionMode: 'ALLOW',
    executionType: 'SINGLE_STEP', requireSuccess: true, overrideAllowed: false, approvalRequired: false,
    conditions: [], steps: [], orderedSteps: [], gatingRules: [], onPassEffects: [], onFailEffects: [],
    requiredAgentIds: [], requiredSkillIds: [], requiredValidationKeys: [],
    primaryAgentId: '', fallbackAgentId: '', escalationRoleKey: '', escalateTo: '' }
  const ui = { _id: id(31), stableId: 'ui-contract-old', uiContractKey: 'old-ui',
    status: 'ACTIVE', isLocked: true, versionStatus: 'ACTIVE', componentVersion: 1,
    frameworkKeys: ['VMF'], sections: [{ sectionKey: 'context' }], lifecycleStages: [], actions: [] }
  const newUi = { ...clone(ui), _id: id(32), stableId: 'ui-contract-new', uiContractKey: 'new-ui',
    actions: [{ actionKey: 'RETURN_TO_DRAFT', governedAction: 'RETURN_TO_DRAFT', buttonLabel: 'Return to Draft',
      displayOrder: 60, isVisible: true, requiresConfirmation: true }] }
  const dependencies = Object.fromEntries(Object.keys(types).map((key, i) => [key, [{ _id: id(i + 40),
    stableId: `stable-${key}`, key: `key-${key}`, status: 'ACTIVE', isLocked: true, versionStatus: 'ACTIVE', componentVersion: 1 }]]))
  dependencies.UIContract = [ui, newUi]
  dependencies.WorkflowPolicy.push(policy)
  const references = Object.entries(dependencies).map(([collectionKey, rows]) => ({ collectionKey,
    id: rows[0].stableId, key: rows[0].key || rows[0].uiContractKey, status: 'ACTIVE', versionStatus: 'ACTIVE',
    componentVersion: 1, lockedAt: t0, issues: [] }))
  const source = { _id: id(10), packageKey: 'old-package', version: '3.1.5', frameworkKey: 'VMF',
    status: 'ACTIVE', isLocked: true, visibility: 'CUSTOMER_VISIBLE', customerAccessMode: 'ALL_CUSTOMERS',
    sections: [{ sectionKey: 'context' }], runtimeSettings: {}, executionModel: {}, validationBindings: [],
    workflowBindings: [], uiContractKey: ui.uiContractKey, uiContractBinding: { key: ui.uiContractKey },
    dependencyLock: sign({ snapshotId: 'snapshot-old', packageKey: 'old-package', packageVersion: '3.1.5',
      status: 'PASS', resolvedAt: t0, references }),
  }
  const target = { ...clone(source), _id: id(11), packageKey: 'new-package', version: '3.1.6',
    derivedFromPackageId: id(10), uiContractKey: newUi.uiContractKey, uiContractBinding: { key: newUi.uiContractKey },
    workflowBindings: [{ policyKey: 'return', executionContext: 'ON_STAGE_EXIT', priority: 1, enabled: true }],
    lastCheckpointStatus: 'PASS', lastCheckpointAt: t1,
    lastCheckpointResult: { id: 'checkpoint-new', status: 'PASS', timestamp: t1 },
    runtimeVerdict: { validationId: 'validation-new', result: 'ALLOW', auditPersisted: true,
      dependencyLockState: 'LOCKED', lastValidatedAt: t1 },
    dependencyLock: sign({ snapshotId: 'snapshot-new', packageKey: 'new-package', packageVersion: '3.1.6',
      status: 'PASS', resolvedAt: t1, references: [...references.map((ref) => ref.collectionKey === 'UIContract'
        ? { ...ref, id: newUi.stableId, key: newUi.uiContractKey, lockedAt: t1 } : { ...ref, lockedAt: t1 }),
      { collectionKey: 'WorkflowPolicy', id: policy.stableId, key: policy.key, status: 'ACTIVE',
        versionStatus: 'ACTIVE', componentVersion: 1, lockedAt: t1, issues: [] }],
      uiContractSnapshot: { uiContractKey: 'new-ui', stableId: 'ui-contract-new', lineageId: 'ui-contract-new',
        componentVersion: 1, versionStatus: 'ACTIVE', sourcePackageKey: '', sourcePackageVersion: '', compatibilityMode: '',
        sectionMapping: { mapped: ['context'], missing: [], orphaned: [], runtimePathMismatches: [], custom: [],
          counts: { packageSections: 1, mapped: 1, missing: 0, orphaned: 0, runtimePathMismatches: 0, custom: 0 } },
        lifecycleStageCount: 0, actionCount: 1 } }),
  }
  const deployments = [source, target].map((pkg, i) => ({ packageId: pkg._id, packageKey: pkg.packageKey,
    frameworkKey: 'VMF', frameworkVersion: pkg.version, deploymentId: `deployment-${i}`, activationId: `activation-${i}`,
    status: i ? 'ACTIVE' : 'SUPERSEDED' }))
  const activations = deployments.map((d, i) => ({ ...d, activationStatus: d.status, checkpointStatus: 'PASS',
    checkpointId: i ? 'checkpoint-new' : 'checkpoint-old', runtimeVerdictResult: 'ALLOW',
    runtimeVerdictId: i ? 'validation-new' : 'validation-old',
    dependencySnapshotId: [source, target][i].dependencyLock.snapshotId,
    dependencySnapshotHash: [source, target][i].dependencyLock.snapshotHash }))
  const runtime = { _id: id(1), runtimeInstanceKey: 'test-runtime', customerId: id(2), tenantId: id(3),
    runtimeType: 'VALUE_NARRATIVE', frameworkKey: 'VMF', name: 'Test runtime', createdBy: id(4),
    packageId: source._id, packageKey: source.packageKey, packageVersion: source.version,
    dependencyLockId: source.dependencyLock.snapshotId, activationId: 'activation-0', deploymentId: 'deployment-0',
    evidence: { activationId: 'activation-0', deploymentId: 'deployment-0', dependencySnapshotId: source.dependencyLock.snapshotId,
      dependencySnapshotHash: source.dependencyLock.snapshotHash },
    stateVersion: 'rsv2:test', updatedAt: t1, lockedAt: null, status: 'ACTIVE', executionStatus: 'WAITING_APPROVAL',
    framework_state: { lifecycle: { stage: 'IN_REVIEW' }, readiness: { state: 'IN_REVIEW' }, lock: {}, publish: {},
      sections: { secret: 'unchanged' }, evidence_pack: { secret: 'unchanged' } } }
  return { runtime, packages: [source, target], deployments, activations, dependencies, graph: null, graphElement: null }
}
const args = () => ({ actorUserId: id(4), auditRequest: { requestId: 'request' }, scopes: { tenant: 'scope' },
  runtimeInstanceId: 'test-runtime', payload: { targetPackageId: id(11), targetDeploymentId: 'deployment-1',
    expectedUpdatedAt: new Date(db.runtime.updatedAt).toISOString(), reason: 'Correct return action' } })
const reverseArgs = (receipt) => ({ ...args(), payload: { operationId: receipt.operationId,
  expectedUpdatedAt: receipt.updatedAt, reason: 'Undo adoption' } })
const matches = (row, filter) => row && Object.entries(filter).every(([key, value]) =>
  (value?.$exists === false ? row[key] === undefined : JSON.stringify(row[key]) === JSON.stringify(value)))
const resealTarget = () => {
  sign(db.packages[1].dependencyLock)
  db.activations[1].dependencySnapshotHash = db.packages[1].dependencyLock.snapshotHash
}

beforeEach(() => {
  jest.restoreAllMocks(); jest.clearAllMocks()
  jest.spyOn(FrameworkPackageDisplayBinding, 'findOne').mockImplementation(() => query(() => db.displayBinding || null))
  db = fixture(); reads = 0; writes = []; auditRows = []; selections = []
  permission.mockResolvedValue(); context.mockResolvedValue({ customer: { _id: id(2) } }); entitlement.mockResolvedValue()
  verifyCertification.mockImplementation(async ({ frameworkPackage, session: value, activation }) => {
    if (value !== session) throw new Error('wrong session')
    const verdict = frameworkPackage.runtimeVerdict
    if (verdict?.result !== 'ALLOW' || verdict.auditPersisted !== true || verdict.dependencyLockState !== 'LOCKED'
      || !verdict.validationId || activation.runtimeVerdictId !== verdict.validationId) {
      throw Object.assign(new Error('Runtime release certification is not valid.'), {
        code: 'RUNTIME_RELEASE_CERTIFICATION_INVALID', status: 409,
        reason: 'RUNTIME_RELEASE_CERTIFICATION_AUDIT_MISMATCH',
        details: { reason: 'RUNTIME_RELEASE_CERTIFICATION_AUDIT_MISMATCH' },
      })
    }
    return { version: 'runtime-release-certification.v1', digest: 'a'.repeat(64) }
  })
  // Model transaction abort by restoring all fake persistence, including history and audit.
  // This is deliberately not evidence of real MongoDB transaction/rollback behavior.
  session = { endSession: jest.fn(), withTransaction: jest.fn(async (callback) => {
    const before = clone(db); const priorAudit = clone(auditRows)
    try { return await callback() } catch (error) { db = before; auditRows = priorAudit; throw error }
  }) }
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(session)
  jest.spyOn(RuntimeInstance, 'findOne').mockImplementation((filter) => query(() => matches(db.runtime, filter) ? db.runtime : null))
  jest.spyOn(FrameworkPackage, 'findById').mockImplementation((key) => query(() => db.packages.find((p) => p._id === key)))
  jest.spyOn(RuntimeDeployment, 'findOne').mockImplementation((filter) => query(() => db.deployments.find((d) => matches(d, filter))))
  jest.spyOn(RuntimeActivationSnapshot, 'findOne').mockImplementation((filter) => query(() => db.activations.find((a) => matches(a, filter))))
  jest.spyOn(RuntimeGraphSnapshot, 'findOne').mockImplementation(() => query(() => db.graph))
  jest.spyOn(RuntimeGraphElement, 'findOne').mockImplementation(() => query(() => db.graphElement))
  for (const [key, model] of Object.entries(types)) {
    jest.spyOn(model, 'findOne').mockImplementation((filter) => query(() => db.dependencies[key].find((r) => matches(r, filter))))
  }
  jest.spyOn(RuntimeInstance, 'updateOne').mockImplementation(async (filter, update, options) => {
    expect(options).toEqual({ session, timestamps: false, runValidators: true })
    writes.push(clone({ filter, update }))
    if (!matches(db.runtime, filter)) return { modifiedCount: 0 }
    Object.assign(db.runtime, clone(update.$set))
    for (const key of Object.keys(update.$unset || {})) delete db.runtime[key]
    db.runtime.releaseBindingHistory ??= []
    db.runtime.releaseBindingHistory.push(clone(update.$push.releaseBindingHistory))
    return { modifiedCount: 1 }
  })
  audit.mockImplementation(async (_req, entry, options) => {
    expect(options).toEqual({ session, throwOnError: true }); auditRows.push(clone(entry)); return entry
  })
})

describe('same-runtime release adoption core (fake transactional persistence)', () => {
  test('updates exactly seven aliases and metadata, preserves truth, and appends complete history atomically', async () => {
    const before = clone(db)
    const receipt = await adopt(args())
    expect(receipt).toEqual({ runtimeInstanceId: id(1), operationId: expect.any(String), kind: 'ADOPT',
      updatedAt: expect.any(String), refreshRequired: true })
    expect(Object.keys(writes[0].update)).toEqual(['$set', '$push'])
    expect(Object.keys(writes[0].update.$set).sort()).toEqual(['packageId', 'packageKey', 'packageVersion',
      'dependencyLockId', 'activationId', 'deploymentId', 'evidence', 'updatedAt', 'updatedBy'].sort())
    expect(writes[0].filter).toEqual({ _id: id(1), customerId: id(2), tenantId: id(3),
      ...Object.fromEntries(['packageId', 'packageKey', 'packageVersion', 'dependencyLockId', 'activationId', 'deploymentId', 'evidence']
        .map((key) => [key, before.runtime[key]])), uiContractDisplayKey: { $exists: false }, stateVersion: before.runtime.stateVersion, updatedAt: before.runtime.updatedAt })
    expect(db.runtime.framework_state).toEqual(before.runtime.framework_state)
    expect(db.runtime.stateVersion).toBe(before.runtime.stateVersion)
    expect(db.packages).toEqual(before.packages); expect(db.dependencies).toEqual(before.dependencies)
    expect(db.deployments).toEqual(before.deployments); expect(db.activations).toEqual(before.activations)
    const history = db.runtime.releaseBindingHistory[0]
    expect(history.from.packageId).toBe(id(10)); expect(history.to.packageId).toBe(id(11))
    expect(history.changedAt).toEqual(db.runtime.updatedAt)
    expect(history.changedAt.toISOString()).toBe(receipt.updatedAt)
    expect(history.operationId).toMatch(/^[\da-f-]{36}$/)
    expect(auditRows[0]).toMatchObject({ action: 'RUNTIME_RELEASE_ADOPTED', resourceType: 'RuntimeInstance',
      resourceId: id(1), diff: history, scope: { customerId: id(2), tenantId: id(3) } })
    expect(reads).toBeGreaterThan(14); expect(session.endSession).toHaveBeenCalledTimes(1)
    expect(RuntimeGraphSnapshot.findOne).toHaveBeenCalledWith({ customerId: id(2), tenantId: id(3), runtimeInstanceId: id(1), current: true })
    expect(RuntimeGraphElement.findOne).toHaveBeenCalledWith({ customerId: id(2), tenantId: id(3), runtimeInstanceId: id(1), current: true })
    expect(selections.filter((value) => value === '+certificationAuthoredFields')).toHaveLength(2)
    expect(verifyCertification).toHaveBeenCalledTimes(1)
    expect(verifyCertification).toHaveBeenCalledWith({ frameworkPackage: db.packages[1], session,
      activation: db.activations[1] })
  })
  test('delegates all permission, tenant-context and feature checks with runtime scope', async () => {
    const input = args(); await adopt(input)
    expect(permission).toHaveBeenCalledWith({ actorUserId: id(4), scopes: input.scopes,
      customerId: id(2), tenantId: id(3), permission: 'VMF_UPDATE', session })
    expect(context).toHaveBeenCalledWith({ customerId: id(2), tenantId: id(3), session })
    expect(entitlement).toHaveBeenCalledWith({ customerId: id(2), customer: { _id: id(2) }, feature: 'VMF', session })
  })
  test.each([permission, context, entitlement])('fails closed on delegated authorization rejection %#', async (guard) => {
    guard.mockRejectedValueOnce(new Error('access denied'))
    await expect(adopt(args())).rejects.toThrow('access denied')
    expect(writes).toEqual([]); expect(audit).not.toHaveBeenCalled()
  })
  test.each([
    ['unsupported runtime type', (d) => { d.runtime.runtimeType = 'DEAL_ANALYSIS' }],
    ['runtime inactive', (d) => { d.runtime.status = 'DRAFT' }],
    ['runtime executing', (d) => { d.runtime.executionStatus = 'RUNNING' }],
    ['lifecycle approved', (d) => { d.runtime.framework_state.lifecycle.stage = 'APPROVED' }],
    ['readiness draft', (d) => { d.runtime.framework_state.readiness.state = 'DRAFT' }],
    ['locked runtime', (d) => { d.runtime.lockedAt = t1 }],
    ['locked truth', (d) => { d.runtime.framework_state.lock.locked = true }],
    ['published truth', (d) => { d.runtime.framework_state.publish.published = true }],
    ['missing stateVersion', (d) => { delete d.runtime.stateVersion }],
    ['current graph', (d) => { d.graph = { _id: id(90) } }],
    ['orphan current graph element', (d) => { d.graphElement = { _id: id(91) } }],
    ['binding alias mismatch', (d) => { d.runtime.activationId = 'bad' }],
    ['package binding mismatch', (d) => { d.runtime.packageVersion = '3.0.0' }],
    ['target inactive', (d) => { d.packages[1].status = 'DRAFT' }],
    ['target unlocked', (d) => { d.packages[1].isLocked = false }],
    ['missing source', (d) => { d.packages[0] = { _id: 'missing' } }],
    ['unavailable target', (d) => { d.packages[1].visibility = 'INTERNAL' }],
    ['superseded target deployment', (d) => { d.deployments[1].status = 'SUPERSEDED' }],
    ['superseded target activation', (d) => { d.activations[1].activationStatus = 'SUPERSEDED' }],
    ['activation hash mismatch', (d) => { d.activations[1].dependencySnapshotHash = 'bad' }],
    ['activation deployment mismatch', (d) => { d.activations[1].deploymentId = 'bad' }],
    ['activation version mismatch', (d) => { d.activations[1].frameworkVersion = '1.0.0' }],
    ['checkpoint failure', (d) => { d.packages[1].lastCheckpointStatus = 'FAIL' }],
    ['checkpoint ID mismatch', (d) => { d.activations[1].checkpointId = 'bad' }],
    ['both checkpoint IDs missing', (d) => { delete d.activations[1].checkpointId; delete d.packages[1].lastCheckpointResult.id }],
    ['both checkpoint IDs blank', (d) => { d.activations[1].checkpointId = ''; d.packages[1].lastCheckpointResult.id = '' }],
    ['both checkpoint IDs whitespace', (d) => { d.activations[1].checkpointId = ' '; d.packages[1].lastCheckpointResult.id = ' ' }],
    ['checkpoint timestamp missing', (d) => { delete d.packages[1].lastCheckpointResult.timestamp }],
    ['checkpoint timestamp invalid', (d) => { d.packages[1].lastCheckpointResult.timestamp = 'invalid' }],
    ['checkpoint update missing', (d) => { delete d.packages[1].lastCheckpointAt }],
    ['verdict block', (d) => { d.packages[1].runtimeVerdict.result = 'BLOCK' }],
    ['verdict audit missing', (d) => { d.packages[1].runtimeVerdict.auditPersisted = false }],
    ['verdict unlocked', (d) => { d.packages[1].runtimeVerdict.dependencyLockState = 'NOT_LOCKED' }],
    ['verdict missing', (d) => { delete d.packages[1].runtimeVerdict }],
    ['verdict ID mismatch', (d) => { d.activations[1].runtimeVerdictId = 'bad' }],
    ['target hash invalid', (d) => { d.packages[1].dependencyLock.snapshotHash = 'a'.repeat(64) }],
    ['source hash invalid', (d) => { d.packages[0].dependencyLock.snapshotHash = 'a'.repeat(64) }],
    ['not direct successor', (d) => { d.packages[1].derivedFromPackageId = id(90) }],
    ['package behavior changed', (d) => { d.packages[1].sections.push({ sectionKey: 'other' }) }],
    ['UI behavior changed', (d) => { d.dependencies.UIContract[1].sections.push({ sectionKey: 'other' }) }],
    ['policy effects changed', (d) => { d.dependencies.WorkflowPolicy[1].onPassEffects.push({ path: 'truth' }) }],
  ])('rejects %s without writing or auditing', async (_name, mutate) => {
    mutate(db); const before = clone(db)
    await expect(adopt(args())).rejects.toMatchObject({ details: { reason: expect.stringMatching(/^RUNTIME_RELEASE_/) } })
    expect(db).toEqual(before); expect(writes).toEqual([]); expect(audit).not.toHaveBeenCalled()
  })
  test.each(Object.keys(types).flatMap((key) => [['status', 'DRAFT'], ['isLocked', false],
    ['componentVersion', 2], ['versionStatus', 'DEPRECATED']].map(([field, value]) => [key, field, value])))
  ('checks actual %s record %s=%s', async (key, field, value) => {
    db.dependencies[key][0][field] = value
    await expect(adopt(args())).rejects.toMatchObject({ details: { reason: 'RUNTIME_RELEASE_DEPENDENCY_RECORD_INVALID' } })
    expect(writes).toEqual([])
  })
  test.each(['unknown', 'drop', 'metadata', 'duplicate', 'extra'])('rejects manifest %s drift with a valid hash', async (mode) => {
    const refs = db.packages[1].dependencyLock.references
    if (mode === 'unknown') refs[0].collectionKey = 'Unknown'
    if (mode === 'drop') refs.splice(0, 1)
    if (mode === 'metadata') refs[0].name = 'drift'
    if (mode === 'duplicate') refs.push(clone(refs[0]))
    if (mode === 'extra') {
      const row = { ...db.dependencies.RuntimeSkill[0], stableId: 'extra' }
      db.dependencies.RuntimeSkill.push(row); refs.push({ ...refs.find((r) => r.collectionKey === 'RuntimeSkill'), id: 'extra' })
    }
    resealTarget()
    await expect(adopt(args())).rejects.toThrow('Runtime release change rejected')
    expect(writes).toEqual([])
  })
  test('accepts PASS_WITH_WARNINGS certification', async () => {
    db.packages[1].lastCheckpointStatus = 'PASS_WITH_WARNINGS'
    db.packages[1].lastCheckpointResult.status = 'PASS_WITH_WARNINGS'
    db.activations[1].checkpointStatus = 'PASS_WITH_WARNINGS'
    await expect(adopt(args())).resolves.toMatchObject({ kind: 'ADOPT' })
  })
  test('accepts later metadata-only checkpoint timestamps when the current certified binding still verifies', async () => {
    db.packages[1].lastCheckpointResult.timestamp = '2026-09-03T10:00:00.000Z'
    db.packages[1].lastCheckpointAt = '2026-09-03T10:00:00.000Z'
    await expect(adopt(args())).resolves.toMatchObject({ kind: 'ADOPT' })
    expect(verifyCertification).toHaveBeenCalledTimes(1)
  })
  test('preserves the shared verifier stable certification error and performs no write or audit', async () => {
    const error = Object.assign(new Error('Runtime release certification is not valid.'), {
      code: 'RUNTIME_RELEASE_CERTIFICATION_INVALID', status: 409,
      reason: 'RUNTIME_RELEASE_CERTIFICATION_BINDING_MISMATCH',
      details: { reason: 'RUNTIME_RELEASE_CERTIFICATION_BINDING_MISMATCH' },
    })
    verifyCertification.mockRejectedValueOnce(error)
    await expect(adopt(args())).rejects.toBe(error)
    expect(writes).toEqual([]); expect(audit).not.toHaveBeenCalled()
  })
  test.each(['uiContractKey', 'stableId', 'lineageId', 'componentVersion', 'versionStatus', 'sourcePackageKey',
    'sourcePackageVersion', 'compatibilityMode', 'sectionMapping', 'lifecycleStageCount', 'actionCount'])
  ('rejects checksum-valid target UI snapshot %s drift', async (field) => {
    const snapshot = db.packages[1].dependencyLock.uiContractSnapshot
    snapshot[field] = typeof snapshot[field] === 'number' ? 99 : 'incorrect'
    resealTarget()
    await expect(adopt(args())).rejects.toMatchObject({ details: { reason: 'RUNTIME_RELEASE_UI_SNAPSHOT_INVALID' } })
    expect(writes).toEqual([]); expect(audit).not.toHaveBeenCalled()
  })
  test.each(['missing', 'partial', 'unknown-field', 'mapping-count', 'mapping-path'])('rejects target UI snapshot %s even with valid checksum', async (mode) => {
    const snapshot = db.packages[1].dependencyLock
    if (mode === 'missing') delete snapshot.uiContractSnapshot
    if (mode === 'partial') delete snapshot.uiContractSnapshot.actionCount
    if (mode === 'unknown-field') snapshot.uiContractSnapshot.futureOverride = true
    if (mode === 'mapping-count') snapshot.uiContractSnapshot.sectionMapping.counts.mapped = 2
    if (mode === 'mapping-path') snapshot.uiContractSnapshot.sectionMapping.runtimePathMismatches = [{ sectionKey: 'context' }]
    resealTarget()
    await expect(adopt(args())).rejects.toMatchObject({ details: { reason: 'RUNTIME_RELEASE_UI_SNAPSHOT_INVALID' } })
    expect(writes).toEqual([])
  })
  test('recovers source metadata only from a checksum-valid retained checkpoint', async () => {
    const source = db.packages[0]
    source.dependencyLock.references[0].bindingKeys = []
    sign(source.dependencyLock)
    db.runtime.evidence.dependencySnapshotHash = source.dependencyLock.snapshotHash
    db.activations[0].dependencySnapshotHash = source.dependencyLock.snapshotHash
    source.lastCheckpointResult = { dependencyLockPreview: clone(source.dependencyLock) }
    delete source.dependencyLock.references[0].bindingKeys
    db.packages[1].dependencyLock.references[0].bindingKeys = []; resealTarget()
    const before = clone(source)
    await adopt(args())
    expect(db.packages[0]).toEqual(before)
  })
  test('rejects stale expected timestamp and a lost CAS race', async () => {
    const input = args(); input.payload.expectedUpdatedAt = t0
    await expect(adopt(input)).rejects.toMatchObject({ details: { reason: 'RUNTIME_RELEASE_STALE_RUNTIME' } })
    RuntimeInstance.updateOne.mockResolvedValueOnce({ modifiedCount: 0 })
    await expect(adopt(args())).rejects.toMatchObject({ details: { reason: 'RUNTIME_RELEASE_STALE_RUNTIME' } })
    expect(audit).not.toHaveBeenCalled()
  })
  test('resolves a runtime by ObjectId and returns not-found for missing runtime', async () => {
    await adopt({ ...args(), runtimeInstanceId: id(1) })
    expect(RuntimeInstance.findOne).toHaveBeenCalledWith({ _id: id(1) })
    await expect(adopt({ ...args(), runtimeInstanceId: 'missing-runtime' })).rejects.toMatchObject({ status: 404 })
  })
  test.each([
    ['bad target ObjectId', (input) => { input.payload.targetPackageId = 'invalid' }],
    ['empty deployment', (input) => { input.payload.targetDeploymentId = '' }],
    ['invalid timestamp', (input) => { input.payload.expectedUpdatedAt = 'yesterday' }],
    ['empty reason', (input) => { input.payload.reason = ' ' }],
    ['missing actor', (input) => { input.actorUserId = null }],
  ])('rejects %s before opening transaction', async (_name, change) => {
    const input = args(); change(input)
    await expect(adopt(input)).rejects.toThrow('Runtime release change rejected')
    expect(mongoose.startSession).not.toHaveBeenCalled()
  })
  test('never recovers an incomplete target snapshot from a later checkpoint', async () => {
    const target = db.packages[1]
    target.dependencyLock.references[0].bindingKeys = []; resealTarget()
    target.lastCheckpointResult.dependencyLockPreview = clone(target.dependencyLock)
    delete target.dependencyLock.references[0].bindingKeys
    await expect(adopt(args())).rejects.toMatchObject({ details: { reason: 'RUNTIME_RELEASE_DEPENDENCY_SNAPSHOT_INVALID' } })
    expect(writes).toEqual([])
  })
  test('rejects a missing actual dependency record', async () => {
    db.dependencies.RuntimeSkill = []
    await expect(adopt(args())).rejects.toMatchObject({ details: { reason: 'RUNTIME_RELEASE_DEPENDENCY_RECORD_INVALID' } })
    expect(writes).toEqual([])
  })
  test('audit failure restores all fake runtime fields and history', async () => {
    const before = clone(db)
    audit.mockImplementationOnce(async () => { auditRows.push({ pending: true }); throw new Error('audit unavailable') })
    await expect(adopt(args())).rejects.toThrow('audit unavailable')
    expect(writes).toHaveLength(1); expect(db).toEqual(before); expect(auditRows).toEqual([])
  })
  test.each(['no-session', 'no-transaction', 'unsupported-transaction'])('does not fall back when %s', async (mode) => {
    if (mode === 'no-session') mongoose.startSession.mockRejectedValueOnce(new Error('offline'))
    if (mode === 'no-transaction') mongoose.startSession.mockResolvedValueOnce({ endSession: jest.fn() })
    if (mode === 'unsupported-transaction') session.withTransaction.mockRejectedValueOnce(new Error('replica set required'))
    await expect(adopt(args())).rejects.toThrow()
    expect(writes).toEqual([]); expect(audit).not.toHaveBeenCalled()
  })
  test.each(['framework_state', 'evidence', 'stateVersion', 'releaseBindingHistory', 'operationId'])('rejects caller field %s', async (key) => {
    const input = args(); input.payload[key] = {}
    await expect(adopt(input)).rejects.toMatchObject({ status: 422 })
    expect(mongoose.startSession).not.toHaveBeenCalled()
  })
  test('does not manufacture history on legacy runtime documents', () => {
    expect(new RuntimeInstance(db.runtime).releaseBindingHistory).toBeUndefined()
  })
  test('history schema retains full binding evidence and shared timestamp', async () => {
    await adopt(args())
    const doc = new RuntimeInstance(db.runtime)
    expect(doc.validateSync()).toBeUndefined()
    expect(String(doc.releaseBindingHistory[0].from.packageId)).toBe(id(10))
    expect(doc.releaseBindingHistory[0].changedAt).toEqual(doc.updatedAt)
    expect(doc.releaseBindingHistory[0].to.evidence.dependencySnapshotHash).toBe(db.packages[1].dependencyLock.snapshotHash)
  })
})

describe('release rollback', () => {
  test('restores the exact former binding despite supersession, appending a reversal without running forward compatibility backwards', async () => {
    const before = clone(db.runtime)
    const adoption = await adopt(args())
    const result = await rollback(reverseArgs(adoption))
    expect(result).toMatchObject({ kind: 'ROLLBACK', refreshRequired: true })
    expect(db.runtime.packageId).toBe(before.packageId)
    expect(db.runtime.evidence).toEqual(before.evidence)
    expect(db.runtime.framework_state).toEqual(before.framework_state)
    expect(db.runtime.stateVersion).toBe(before.stateVersion)
    expect(db.runtime.releaseBindingHistory).toHaveLength(2)
    expect(db.runtime.releaseBindingHistory[1]).toMatchObject({ revertsOperationId: adoption.operationId, kind: 'ROLLBACK' })
    expect(auditRows[1].action).toBe('RUNTIME_RELEASE_ROLLED_BACK')
    expect(verifyCertification).toHaveBeenCalledTimes(1)
    await expect(rollback(reverseArgs(result))).rejects.toMatchObject({ details: { reason: 'RUNTIME_RELEASE_ROLLBACK_INTERVENING_WORK' } })
  })
  test.each(['stateVersion', 'timestamp', 'binding', 'operation', 'graph', 'graphElement', 'activation', 'hash'])('rejects intervening %s/evidence drift', async (mode) => {
    const receipt = await adopt(args()); const input = reverseArgs(receipt)
    if (mode === 'stateVersion') db.runtime.stateVersion = 'changed'
    if (mode === 'timestamp') { db.runtime.updatedAt = new Date(Date.parse(receipt.updatedAt) + 1); input.payload.expectedUpdatedAt = db.runtime.updatedAt.toISOString() }
    if (mode === 'binding') db.runtime.packageKey = 'changed'
    if (mode === 'operation') input.payload.operationId = '11111111-1111-4111-8111-111111111111'
    if (mode === 'graph') db.graph = { _id: id(90) }
    if (mode === 'graphElement') db.graphElement = { _id: id(91) }
    if (mode === 'activation') db.activations[0].activationStatus = 'ARCHIVED'
    if (mode === 'hash') db.activations[0].dependencySnapshotHash = 'changed'
    const before = clone(db); const count = writes.length
    await expect(rollback(input)).rejects.toThrow('Runtime release change rejected')
    expect(db).toEqual(before); expect(writes).toHaveLength(count)
  })
  test('rollback audit failure restores the adopted binding and does not append a reversal', async () => {
    const receipt = await adopt(args()); const before = clone(db)
    audit.mockRejectedValueOnce(new Error('audit failure'))
    await expect(rollback(reverseArgs(receipt))).rejects.toThrow('audit failure')
    expect(db).toEqual(before); expect(db.runtime.releaseBindingHistory).toHaveLength(1); expect(auditRows).toHaveLength(1)
  })
})

test.each([undefined, 'source-display'])('adoption and rollback preserve exact optional source pin %s', async (pin) => {
  if (pin !== undefined) db.runtime.uiContractDisplayKey = pin
  db.displayBinding = { uiContractKey: 'target-display' }
  db.dependencies.UIContract.push({ uiContractKey: 'target-display', status: 'ACTIVE', versionStatus: 'ACTIVE', isLocked: true })
  const receipt = await adopt(args())
  expect(db.runtime.uiContractDisplayKey).toBe('target-display')
  expect(db.runtime.releaseBindingHistory.at(-1).from.uiContractDisplayKey).toBe(pin)
  expect(writes[0].filter.uiContractDisplayKey).toEqual(pin ?? { $exists: false })
  await rollback(reverseArgs(receipt))
  expect(db.runtime.uiContractDisplayKey).toBe(pin)
  if (pin === undefined) expect(writes[1].update.$unset).toEqual({ uiContractDisplayKey: 1 })
})
