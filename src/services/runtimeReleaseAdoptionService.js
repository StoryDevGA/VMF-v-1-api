import { selectRuntimeDisplayPin } from './runtimeDisplayBindingService.js'
import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
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
import auditService, { AUDIT_ACTIONS } from './auditService.js'
import { assertRuntimePermission, assertCustomerTenantContext, assertFeatureEntitlement,
  createRuntimeInstanceError } from './runtimeInstanceService.js'
import { isFrameworkPackageAvailableToCustomer } from './frameworkPackageAvailabilityService.js'
import { checkRuntimeReleaseAuthoredCompatibility } from './runtimeReleaseCompatibilityService.js'
import { resolveRuntimeReleaseDependencySnapshot } from './runtimeReleaseSnapshotService.js'
import { CERTIFICATION_PACKAGE_SELECTION, verifyRuntimeReleaseCertification } from './runtimeReleaseCertificationCaptureService.js'

// Same seven dependency types and stable identities as the package lock builder.
const dependencyModels = { RuntimePathRegistry, ValidationRegistry, WorkflowPolicy,
  RuntimeAgent, RuntimeSkill, SkillRoleRegistry, UIContract }
const bindingKeys = ['packageId', 'packageKey', 'packageVersion', 'dependencyLockId', 'activationId', 'deploymentId', 'evidence']
const policyKeys = ['key', 'frameworkKeys', 'status', 'isLocked', 'governedAction', 'policyType',
  'appliesTo', 'triggerEvent', 'triggerMode', 'actorScope', 'decisionMode', 'executionType',
  'requireSuccess', 'overrideAllowed', 'approvalRequired', 'conditions', 'steps', 'orderedSteps',
  'gatingRules', 'onPassEffects', 'onFailEffects', 'requiredAgentIds', 'requiredSkillIds',
  'requiredValidationKeys', 'primaryAgentId', 'fallbackAgentId', 'escalationRoleKey', 'escalateTo']
const json = (value) => JSON.parse(JSON.stringify(value))
const text = (value) => typeof value === 'string' && value.trim().length > 0
const date = (value) => value ? new Date(value).getTime() : NaN
const pass = (value) => ['PASS', 'PASS_WITH_WARNINGS'].includes(value)
const binding = (runtime) => ({ ...Object.fromEntries(bindingKeys.map((key) => [key, runtime[key]])),
  ...(runtime.uiContractDisplayKey !== undefined ? { uiContractDisplayKey: runtime.uiContractDisplayKey } : {}) })
const same = (a, b) => isDeepStrictEqual(json(a), json(b))
const fail = (reason, status = 409) => {
  throw createRuntimeInstanceError({ status, code: status === 422 ? 'VALIDATION_FAILED'
    : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 503 ? 'SERVICE_UNAVAILABLE' : 'CONFLICT',
  reason: `RUNTIME_RELEASE_${reason}`, message: `Runtime release change rejected: ${reason}.` })
}
const requireBinding = (value) => {
  if (!value || !bindingKeys.every((key) => value[key] != null)
    || !mongoose.isValidObjectId(value.packageId)
    || !bindingKeys.slice(1, -1).every((key) => text(value[key]))
    || !text(value.evidence.dependencySnapshotHash)
    || value.activationId !== value.evidence.activationId
    || value.deploymentId !== value.evidence.deploymentId
    || value.dependencyLockId !== value.evidence.dependencySnapshotId) fail('BINDING_INVALID')
}

const readSnapshot = (pkg, recover) => {
  const resolved = resolveRuntimeReleaseDependencySnapshot({ sourceSnapshot: json(pkg.dependencyLock || null),
    ...(recover ? { retainedSnapshot: json(pkg.lastCheckpointResult?.dependencyLockPreview || null) } : {}) })
  if (!resolved.metadataIntegrityVerified) fail('DEPENDENCY_SNAPSHOT_INVALID')
  const snapshot = resolved.snapshot
  if (!pass(snapshot.status) || snapshot.packageKey !== pkg.packageKey || snapshot.packageVersion !== pkg.version) {
    fail('DEPENDENCY_SNAPSHOT_MISMATCH')
  }
  return snapshot
}

const readRelease = async ({ packageId, deploymentId, frameworkKey, session, active, expected }) => {
  // Load the same complete authored package projection used by certification so
  // source/target compatibility cannot differ merely because a field is hidden.
  const pkg = await FrameworkPackage.findById(packageId).select(CERTIFICATION_PACKAGE_SELECTION).session(session).lean()
  if (!pkg || pkg.frameworkKey !== frameworkKey || pkg.status !== 'ACTIVE' || pkg.isLocked !== true) fail('PACKAGE_INVALID')
  const snapshot = readSnapshot(pkg, !active)
  const deployment = await RuntimeDeployment.findOne({ deploymentId, packageId: pkg._id, frameworkKey }).session(session).lean()
  const activation = deployment && await RuntimeActivationSnapshot.findOne({
    activationId: deployment.activationId, packageId: pkg._id, frameworkKey,
  }).session(session).lean()
  const allowed = active ? ['ACTIVE'] : ['ACTIVE', 'SUPERSEDED']
  if (!deployment || !activation || !allowed.includes(deployment.status)
    || !allowed.includes(activation.activationStatus)
    || deployment.packageKey !== pkg.packageKey || activation.packageKey !== pkg.packageKey
    || deployment.frameworkVersion !== pkg.version || activation.frameworkVersion !== pkg.version
    || activation.deploymentId !== deployment.deploymentId
    || activation.dependencySnapshotId !== snapshot.snapshotId
    || activation.dependencySnapshotHash !== snapshot.snapshotHash
    || !text(activation.checkpointId)
    || !pass(activation.checkpointStatus) || activation.runtimeVerdictResult !== 'ALLOW') fail('ACTIVATION_EVIDENCE_INVALID')
  if (active) {
    const checkpoint = pkg.lastCheckpointResult
    const checkpointId = checkpoint?.checkpointId || checkpoint?.id
    if (!pass(pkg.lastCheckpointStatus) || !pass(pkg.lastCheckpointResult?.status)
      || !text(checkpointId) || activation.checkpointId !== checkpointId
      || !Number.isFinite(date(checkpoint.timestamp)) || !Number.isFinite(date(pkg.lastCheckpointAt))
    ) fail('CERTIFICATION_INVALID')
    // This verifies the genuine audit, verdict, activation and current authored
    // inputs in this transaction. Its stable certification error is preserved.
    await verifyRuntimeReleaseCertification({ frameworkPackage: pkg, session, activation })
  }
  const nextBinding = { packageId: pkg._id, packageKey: pkg.packageKey, packageVersion: pkg.version,
    dependencyLockId: snapshot.snapshotId, activationId: activation.activationId, deploymentId: deployment.deploymentId,
    evidence: { activationId: activation.activationId, deploymentId: deployment.deploymentId,
      dependencySnapshotId: snapshot.snapshotId, dependencySnapshotHash: snapshot.snapshotHash } }
  requireBinding(nextBinding)
  if (expected && !same(nextBinding, Object.fromEntries(bindingKeys.map((key) => [key, expected[key]])))) fail('BINDING_EVIDENCE_MISMATCH')
  return { pkg, snapshot, binding: nextBinding }
}

const readDependencies = async (snapshot, session) => {
  const records = new Map()
  for (const reference of snapshot.references) {
    const model = Object.hasOwn(dependencyModels, reference.collectionKey) && dependencyModels[reference.collectionKey]
    if (!model) fail('UNKNOWN_DEPENDENCY_TYPE')
    const row = await model.findOne({ stableId: reference.id }).session(session).lean()
    if (!row || row.stableId !== reference.id || row.status !== 'ACTIVE' || row.isLocked !== true
      || reference.status !== 'ACTIVE' || reference.versionStatus !== 'ACTIVE' || row.versionStatus !== 'ACTIVE'
      || !Number.isInteger(reference.componentVersion) || reference.componentVersion < 1
      || row.componentVersion !== reference.componentVersion) fail('DEPENDENCY_RECORD_INVALID')
    records.set(`${reference.collectionKey}:${reference.id}`, row)
  }
  return records
}

// Mirror the package builder's section-mapping projection, including custom rows
// and normalized keys. The builder's helper is private to its controller.
const checkTargetUiSnapshot = (target, ui) => {
  const key = (value) => String(value || '').trim().toLowerCase()
  const path = (value) => String(value || '').trim()
  const custom = (section) => section?.isCustom === true || String(section?.source || '').trim().toUpperCase() === 'CUSTOM'
  if (!Array.isArray(target.pkg.sections) || !Array.isArray(ui.sections)
    || !Array.isArray(ui.lifecycleStages) || !Array.isArray(ui.actions)) fail('UI_SNAPSHOT_INVALID')
  const packages = new Map(target.pkg.sections.map((section) => [key(section?.sectionKey), section]).filter(([id]) => id))
  const sections = new Map(ui.sections.filter((section) => !custom(section))
    .map((section) => [key(section?.sectionKey), section]).filter(([id]) => id))
  const mapping = { mapped: [], missing: [], orphaned: [], runtimePathMismatches: [],
    custom: ui.sections.filter(custom).map((section) => key(section?.sectionKey)).filter(Boolean) }
  for (const [sectionKey, section] of packages) {
    const actual = sections.get(sectionKey)
    if (!actual) mapping.missing.push(sectionKey)
    else if (path(actual.runtimePath) !== path(section.runtimePath)) mapping.runtimePathMismatches.push({
      sectionKey, expectedRuntimePath: path(section.runtimePath), actualRuntimePath: path(actual.runtimePath),
    })
    else mapping.mapped.push(sectionKey)
  }
  mapping.orphaned = [...sections.keys()].filter((id) => !packages.has(id))
  mapping.counts = { packageSections: packages.size,
    ...Object.fromEntries(Object.entries(mapping).map(([name, rows]) => [name, rows.length])) }
  const expected = { uiContractKey: ui.uiContractKey, stableId: ui.stableId,
    lineageId: ui.lineageId || ui.stableId, componentVersion: ui.componentVersion, versionStatus: ui.versionStatus,
    sourcePackageKey: ui.sourcePackageKey || '', sourcePackageVersion: ui.sourcePackageVersion || '',
    compatibilityMode: ui.compatibilityMode || '', sectionMapping: mapping,
    lifecycleStageCount: ui.lifecycleStages.length, actionCount: ui.actions.length }
  if (!target.snapshot.uiContractSnapshot || !same(target.snapshot.uiContractSnapshot, expected)) fail('UI_SNAPSHOT_INVALID')
}

const checkForward = async (source, target, session) => {
  const sourceRows = await readDependencies(source.snapshot, session)
  const targetRows = await readDependencies(target.snapshot, session)
  const oldRefs = source.snapshot.references
  const newRefs = target.snapshot.references
  const oldUi = oldRefs.filter((ref) => ref.collectionKey === 'UIContract')
  const newUi = newRefs.filter((ref) => ref.collectionKey === 'UIContract')
  const additions = newRefs.filter((ref) => !sourceRows.has(`${ref.collectionKey}:${ref.id}`))
  if (oldUi.length !== 1 || newUi.length !== 1 || oldUi[0].id === newUi[0].id
    || newRefs.length !== oldRefs.length + 1 || additions.length !== 2
    || additions.filter((ref) => ref.collectionKey === 'UIContract').length !== 1
    || additions.filter((ref) => ref.collectionKey === 'WorkflowPolicy').length !== 1) fail('MANIFEST_DELTA_INVALID')
  for (const reference of oldRefs.filter((ref) => ref.collectionKey !== 'UIContract')) {
    const targetRef = newRefs.find((ref) => ref.collectionKey === reference.collectionKey && ref.id === reference.id)
    const withoutLockTime = ({ lockedAt: _lockedAt, ...rest }) => rest
    if (!targetRef || !same(withoutLockTime(reference), withoutLockTime(targetRef))) fail('MANIFEST_DELTA_INVALID')
  }
  if (newRefs.some((ref) => ref.collectionKey === 'UIContract' && ref.id === oldUi[0].id)) fail('MANIFEST_DELTA_INVALID')
  const policyRef = additions.find((ref) => ref.collectionKey === 'WorkflowPolicy')
  const policy = targetRows.get(`WorkflowPolicy:${policyRef.id}`)
  checkTargetUiSnapshot(target, targetRows.get(`UIContract:${newUi[0].id}`))
  const result = checkRuntimeReleaseAuthoredCompatibility({ sourcePackage: json(source.pkg), targetPackage: json(target.pkg),
    sourceUi: json(sourceRows.get(`UIContract:${oldUi[0].id}`)), targetUi: json(targetRows.get(`UIContract:${newUi[0].id}`)),
    addedPolicy: json(Object.fromEntries(policyKeys.filter((key) => Object.hasOwn(policy, key)).map((key) => [key, policy[key]]))) })
  if (!result.authoredConfigurationCompatible) fail(`COMPATIBILITY_${result.reason}`)
  // This is a current baseline correction, not historical dependency-content parity.
}

const changeRelease = async ({ actorUserId, auditRequest, scopes, runtimeInstanceId, payload }, kind) => {
  const allowed = kind === 'ADOPT' ? ['targetPackageId', 'targetDeploymentId', 'expectedUpdatedAt', 'reason']
    : ['operationId', 'expectedUpdatedAt', 'reason']
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some((key) => !allowed.includes(key))
    || !allowed.every((key) => text(payload[key])) || payload.reason.trim().length > 1000
    || !/^\d{4}-\d{2}-\d{2}T/.test(payload.expectedUpdatedAt) || !Number.isFinite(date(payload.expectedUpdatedAt))
    || (kind === 'ADOPT' && !mongoose.isValidObjectId(payload.targetPackageId))
    || (kind === 'ROLLBACK' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.operationId))) fail('PAYLOAD_INVALID', 422)
  if (!mongoose.isValidObjectId(actorUserId)) fail('ACTOR_REQUIRED', 403)
  if (!text(runtimeInstanceId)) fail('RUNTIME_NOT_FOUND', 404)
  let session
  try { session = await mongoose.startSession() } catch { fail('TRANSACTION_REQUIRED', 503) }
  if (!session?.withTransaction) { await session?.endSession?.(); fail('TRANSACTION_REQUIRED', 503) }
  try {
    return await session.withTransaction(async () => {
      const selector = mongoose.isValidObjectId(runtimeInstanceId) ? { _id: runtimeInstanceId }
        : { runtimeInstanceKey: runtimeInstanceId.trim().toLowerCase() }
      const runtime = await RuntimeInstance.findOne(selector).select([
        '_id', 'customerId', 'tenantId', 'frameworkKey', 'runtimeType', ...bindingKeys, 'uiContractDisplayKey', 'stateVersion', 'updatedAt',
        'status', 'executionStatus', 'lockedAt', 'releaseBindingHistory',
        'framework_state.lifecycle', 'framework_state.readiness', 'framework_state.lock', 'framework_state.publish',
      ].join(' ')).session(session).lean()
      if (!runtime) fail('RUNTIME_NOT_FOUND', 404)
      const { customerId, tenantId, frameworkKey } = runtime
      await assertRuntimePermission({ actorUserId, scopes, customerId, tenantId, permission: 'VMF_UPDATE', session })
      const { customer } = await assertCustomerTenantContext({ customerId, tenantId, session })
      await assertFeatureEntitlement({ customerId, customer, feature: frameworkKey, session })
      const state = runtime.framework_state || {}
      if (runtime.runtimeType !== 'VALUE_NARRATIVE' || runtime.status !== 'ACTIVE' || runtime.executionStatus !== 'WAITING_APPROVAL'
        || state.lifecycle?.stage !== 'IN_REVIEW' || state.readiness?.state !== 'IN_REVIEW'
        || runtime.lockedAt || state.lock?.locked || state.lock?.lockedAt || state.lifecycle?.lockedAt
        || state.publish?.published || state.publish?.publishedAt || state.publish?.state === 'PUBLISHED'
        || state.readiness?.approved || !text(runtime.stateVersion)) fail('RUNTIME_STATE_INVALID')
      if (date(runtime.updatedAt) !== date(payload.expectedUpdatedAt)) fail('STALE_RUNTIME')
      const graph = await RuntimeGraphSnapshot.findOne({ customerId, tenantId, runtimeInstanceId: runtime._id, current: true })
        .select('_id').session(session).lean()
      if (graph) fail('CURRENT_GRAPH_REQUIRES_REBUILD')
      const graphElement = await RuntimeGraphElement.findOne({ customerId, tenantId, runtimeInstanceId: runtime._id, current: true })
        .select('_id').session(session).lean()
      if (graphElement) fail('CURRENT_GRAPH_REQUIRES_REBUILD')
      const from = binding(runtime)
      requireBinding(from)
      let to
      if (kind === 'ADOPT') {
        const source = await readRelease({ ...from, frameworkKey, session, active: false, expected: from })
        const target = await readRelease({ packageId: payload.targetPackageId, deploymentId: payload.targetDeploymentId,
          frameworkKey, session, active: true })
        if (!isFrameworkPackageAvailableToCustomer({ frameworkPackage: target.pkg, customerId, frameworkKey })) fail('PACKAGE_NOT_AVAILABLE', 403)
        await checkForward(source, target, session)
        const pin = await selectRuntimeDisplayPin({ packageId: target.pkg._id, session })
        to = { ...target.binding, ...(pin !== undefined ? { uiContractDisplayKey: pin } : {}) }
      } else {
        const latest = runtime.releaseBindingHistory?.at(-1)
        if (!latest || latest.kind !== 'ADOPT' || latest.operationId !== payload.operationId
          || latest.stateVersion !== runtime.stateVersion || date(latest.changedAt) !== date(runtime.updatedAt)
          || !same(latest.to, from)) fail('ROLLBACK_INTERVENING_WORK')
        requireBinding(latest.from)
        await readRelease({ ...from, frameworkKey, session, active: false, expected: from })
        const restored = await readRelease({ ...latest.from, frameworkKey, session, active: false, expected: latest.from })
        if (!isFrameworkPackageAvailableToCustomer({ frameworkPackage: restored.pkg, customerId, frameworkKey })) fail('PACKAGE_NOT_AVAILABLE', 403)
        await readDependencies(restored.snapshot, session)
        to = latest.from
      }
      // One timestamp for CAS result, receipt, and history; disable Mongoose timestamp rewriting.
      const changedAt = new Date(Math.max(Date.now(), date(runtime.updatedAt) + 1))
      const operationId = randomUUID()
      const history = { operationId, kind, ...(kind === 'ROLLBACK' ? { revertsOperationId: payload.operationId } : {}),
        from, to, stateVersion: runtime.stateVersion, changedAt, changedBy: actorUserId, reason: payload.reason.trim() }
      const result = await RuntimeInstance.updateOne({ _id: runtime._id, customerId, tenantId, ...from,
        uiContractDisplayKey: from.uiContractDisplayKey ?? { $exists: false },
        stateVersion: runtime.stateVersion, updatedAt: runtime.updatedAt },
      { $set: { ...to, updatedAt: changedAt, updatedBy: actorUserId },
        ...(to.uiContractDisplayKey === undefined && from.uiContractDisplayKey !== undefined ? { $unset: { uiContractDisplayKey: 1 } } : {}), $push: { releaseBindingHistory: history } },
      { session, timestamps: false, runValidators: true })
      if (result.modifiedCount !== 1) fail('STALE_RUNTIME')
      // Release binding and its audit are one atomic operation; audit failure must abort.
      await auditService.logFromRequest(auditRequest, { actorUserId,
        action: kind === 'ADOPT' ? AUDIT_ACTIONS.RUNTIME_RELEASE_ADOPTED : AUDIT_ACTIONS.RUNTIME_RELEASE_ROLLED_BACK,
        resourceType: 'RuntimeInstance', resourceId: runtime._id, scope: { customerId, tenantId }, diff: history,
      }, { session, throwOnError: true })
      return { runtimeInstanceId: String(runtime._id), operationId, kind, updatedAt: changedAt.toISOString(), refreshRequired: true }
    })
  } finally { await session.endSession() }
}

export const adoptRuntimeRelease = (args) => changeRelease(args, 'ADOPT')
export const rollbackRuntimeRelease = (args) => changeRelease(args, 'ROLLBACK')
