import { beforeEach, afterEach, expect, test, jest } from '@jest/globals'
import mongoose from 'mongoose'
import * as models from '../models/index.js'
import { generateChecksum } from '../services/governanceAudit/checksumService.js'
import { buildRuntimeReleaseCertificationBinding } from '../services/runtimeReleaseCertificationService.js'
import { verifyRuntimeReleaseCertification } from '../services/runtimeReleaseCertificationCaptureService.js'
import { registerRuntimeActivation } from '../services/runtimeActivation/runtimeActivationService.js'

const types = { RuntimePathRegistry: 'pathKey', ValidationRegistry: 'key', WorkflowPolicy: 'key',
  RuntimeAgent: 'key', RuntimeSkill: 'key', SkillRoleRegistry: 'roleKey', UIContract: 'uiContractKey' }
const id = (n) => n.toString(16).padStart(24, '0')
const query = (value) => ({ session: jest.fn().mockReturnThis(), lean: jest.fn(async () => value) })
let pkg, dependencies, audit, session, binding
beforeEach(() => {
  dependencies = Object.fromEntries(Object.entries(types).map(([type, key], i) => [type, [{
    _id: id(i + 10), stableId: `stable-${type}`, [key]: `key-${type}`, componentVersion: 1,
    status: 'ACTIVE', versionStatus: 'ACTIVE', isLocked: true,
  }]]))
  Object.assign(dependencies.UIContract[0], { sections: [{ sectionKey: 'context' }], actions: [], lifecycleStages: [] })
  const ui = dependencies.UIContract[0]
  pkg = { _id: id(1), frameworkKey: 'VMF', packageKey: 'consumer-fixture', version: '3.1.6',
    status: 'VALIDATED', sections: ui.sections, validationBindings: [], workflowBindings: [],
    runtimeSettings: {}, executionModel: {}, uiContractKey: ui.uiContractKey,
    uiContractBinding: { key: ui.uiContractKey, version: '3.1.6', status: 'ACTIVE', compatibilityMode: 'STRICT' },
    dependencyLock: { snapshotId: 'snapshot-consumer', packageKey: 'consumer-fixture', packageVersion: '3.1.6',
      status: 'PASS', resolvedAt: '2026-09-04T00:00:00.000Z',
      references: Object.entries(dependencies).map(([collectionKey, [row]]) => ({ collectionKey,
        id: row.stableId, key: row[types[collectionKey]], componentVersion: 1, status: 'ACTIVE', versionStatus: 'ACTIVE' })),
      uiContractSnapshot: { uiContractKey: ui.uiContractKey, stableId: ui.stableId, componentVersion: 1,
        actionCount: 0, lifecycleStageCount: 0, sectionMapping: { mapped: ['context'] } } } }
  const { snapshotId, snapshotHash, ...snapshotPayload } = pkg.dependencyLock
  pkg.dependencyLock.snapshotHash = generateChecksum(snapshotPayload)
  binding = buildRuntimeReleaseCertificationBinding({ frameworkPackage: pkg, dependencies })
  pkg.runtimeVerdict = { validationId: id(50), auditId: id(50), status: 'PASS', result: 'ALLOW', mode: 'STRICT',
    lastValidatedAt: new Date('2026-09-04T00:01:00.000Z'), auditPersisted: true,
    dependencyLockState: 'LOCKED', blockingIssues: 0, warnings: 0, certificationBinding: binding }
  audit = { _id: new mongoose.Types.ObjectId(id(50)), packageId: id(1), frameworkKey: 'VMF', status: 'PASS',
    result: 'ALLOW', mode: 'STRICT', createdAt: new Date('2026-09-04T00:01:00.000Z'), packageResolved: true,
    isPackageLevelValidation: true, dependencyLockState: 'LOCKED', certificationBinding: binding,
    certificationDependencySnapshot: pkg.dependencyLock,
    certificationDependencyLockObservation: {
      snapshotId: pkg.dependencyLock.snapshotId,
      snapshotHash: pkg.dependencyLock.snapshotHash,
      resolvedAt: '2026-09-04T00:00:00.000Z',
    } }
  session = { inTransaction: () => true }
  jest.spyOn(models.RuntimeValidationAudit, 'findById').mockImplementation(() => query(audit))
  for (const type of Object.keys(types)) jest.spyOn(models[type], 'findOne').mockImplementation(() => query(dependencies[type][0]))
})
afterEach(() => jest.restoreAllMocks())

test('returns the server-recomputed binding after original audit and seven dependency families agree', async () => {
  await expect(verifyRuntimeReleaseCertification({ frameworkPackage: pkg, session })).resolves.toEqual(binding)
  expect(models.RuntimeValidationAudit.findById).toHaveBeenCalledWith(id(50))
  for (const type of Object.keys(types)) expect(models[type].findOne).toHaveBeenCalledTimes(1)
})
test.each([
  ['disabled verdict', () => { pkg.runtimeVerdict.mode = 'DISABLED' }, 'RUNTIME_RELEASE_CERTIFICATION_NOT_ELIGIBLE'],
  ['audit id mismatch', () => { pkg.runtimeVerdict.validationId = id(51) }, 'RUNTIME_RELEASE_CERTIFICATION_AUDIT_ID_MISMATCH'],
  ['audit binding mismatch', () => { audit.certificationBinding = { ...binding, digest: 'b'.repeat(64) } }, 'RUNTIME_RELEASE_CERTIFICATION_AUDIT_MISMATCH'],
  ['dependency drift', () => { dependencies.RuntimeSkill[0].description = 'changed' }, 'RUNTIME_RELEASE_CERTIFICATION_BINDING_MISMATCH'],
])('fails closed for %s', async (_name, mutate, reason) => {
  mutate()
  await expect(verifyRuntimeReleaseCertification({ frameworkPackage: pkg, session })).rejects.toMatchObject({
    code: 'RUNTIME_RELEASE_CERTIFICATION_INVALID', status: 409, reason, details: { reason },
  })
})
test('optional activation must equal package, verdict, lock snapshot and binding', async () => {
  const activation = { packageId: id(1), packageKey: pkg.packageKey, frameworkKey: pkg.frameworkKey,
    frameworkVersion: pkg.version, runtimeVerdictId: id(50), runtimeVerdictResult: 'ALLOW',
    dependencySnapshotId: pkg.dependencyLock.snapshotId, dependencySnapshotHash: pkg.dependencyLock.snapshotHash,
    certificationBinding: binding }
  await expect(verifyRuntimeReleaseCertification({ frameworkPackage: pkg, session, activation })).resolves.toEqual(binding)
  activation.runtimeVerdictId = id(51)
  await expect(verifyRuntimeReleaseCertification({ frameworkPackage: pkg, session, activation })).rejects.toMatchObject({
    reason: 'RUNTIME_RELEASE_CERTIFICATION_ACTIVATION_MISMATCH',
  })
})
test('registration accepts the verified binding across raw-to-hydrated mutation without recapturing dependencies', async () => {
  const hydrated = models.FrameworkPackage.hydrate(pkg)
  jest.spyOn(models.RuntimeDeployment, 'findOne').mockReturnValue({ session: jest.fn().mockResolvedValue(null) })
  jest.spyOn(models.RuntimeActivationSnapshot, 'create').mockImplementation(async ([row]) => [{ _id: id(70), ...row }])
  jest.spyOn(models.RuntimeDeployment, 'create').mockImplementation(async ([row]) => [{ _id: id(71), ...row }])
  for (const type of Object.keys(types)) models[type].findOne.mockClear()
  const result = await registerRuntimeActivation({ frameworkPackage: hydrated, actorUserId: id(3),
    activatedAt: new Date('2026-09-04T00:02:00.000Z'), checkpoint: { status: 'PASS' },
    readiness: { ready: true }, session, certificationBinding: binding,
    packageStatusAtActivation: 'VALIDATED' })
  expect(result.activationSnapshot.certificationBinding).toEqual(binding)
  for (const type of Object.keys(types)) expect(models[type].findOne).not.toHaveBeenCalled()
})
test.each([
  ['missing verified binding', undefined],
  ['mismatched verified binding', { version: 'runtime-release-certification.v1', digest: 'b'.repeat(64) }],
  ['malformed verified binding', { version: 'runtime-release-certification.v1', digest: 'short' }],
])('registration rejects %s before activation persistence', async (_name, suppliedBinding) => {
  jest.spyOn(models.RuntimeDeployment, 'findOne')
  jest.spyOn(models.RuntimeActivationSnapshot, 'create')
  jest.spyOn(models.RuntimeDeployment, 'create')
  await expect(registerRuntimeActivation({ frameworkPackage: models.FrameworkPackage.hydrate(pkg),
    session, certificationBinding: suppliedBinding, packageStatusAtActivation: 'VALIDATED' })).rejects.toMatchObject({
    code: 'RUNTIME_RELEASE_CERTIFICATION_INVALID', reason: 'RUNTIME_RELEASE_CERTIFICATION_BINDING_CHANGED',
  })
  expect(models.RuntimeDeployment.findOne).not.toHaveBeenCalled()
  expect(models.RuntimeActivationSnapshot.create).not.toHaveBeenCalled()
  expect(models.RuntimeDeployment.create).not.toHaveBeenCalled()
})

test('keeps legacy audit-bound certification verifiable after activation checkpoint metadata advances', async () => {
  const canonical = JSON.parse(JSON.stringify(pkg.dependencyLock))
  delete canonical.uiContractSnapshot
  canonical.snapshotHash = 'a'.repeat(64)
  pkg.dependencyLock = canonical
  audit.certificationDependencyLockObservation = {
    snapshotId: canonical.snapshotId,
    snapshotHash: canonical.snapshotHash,
    resolvedAt: canonical.resolvedAt,
  }
  audit.certificationDependencySnapshot = JSON.parse(JSON.stringify(audit.certificationDependencySnapshot))
  audit.certificationDependencySnapshot.snapshotId = 'audit-retained-snapshot'
  audit.certificationDependencySnapshot.resolvedAt = '2026-09-04T00:01:00.000Z'
  const { snapshotId, snapshotHash: _snapshotHash, ...payload } = audit.certificationDependencySnapshot
  audit.certificationDependencySnapshot.snapshotHash = generateChecksum(payload)
  const effective = { ...pkg, dependencyLock: audit.certificationDependencySnapshot }
  binding = buildRuntimeReleaseCertificationBinding({ frameworkPackage: effective, dependencies })
  pkg.runtimeVerdict.certificationBinding = binding
  audit.certificationBinding = binding
  pkg.lastCheckpointStatus = 'PASS'
  pkg.lastCheckpointAt = new Date('2026-09-04T00:10:00.000Z')
  pkg.lastCheckpointResult = { status: 'PASS', timestamp: pkg.lastCheckpointAt,
    dependencyLockPreview: { snapshotId: 'newer-activation-checkpoint' } }
  await expect(verifyRuntimeReleaseCertification({ frameworkPackage: pkg, session })).resolves.toEqual(binding)
})

test.each(['snapshotId', 'snapshotHash', 'resolvedAt'])(
  'legacy verification fails when the canonical lock %s drifts after certification',
  async (field) => {
    const canonical = JSON.parse(JSON.stringify(pkg.dependencyLock))
    delete canonical.uiContractSnapshot
    canonical.snapshotHash = 'a'.repeat(64)
    pkg.dependencyLock = canonical
    audit.certificationDependencyLockObservation = {
      snapshotId: canonical.snapshotId,
      snapshotHash: canonical.snapshotHash,
      resolvedAt: canonical.resolvedAt,
    }
    audit.certificationDependencySnapshot = JSON.parse(JSON.stringify(audit.certificationDependencySnapshot))
    audit.certificationDependencySnapshot.snapshotId = 'audit-retained-snapshot'
    audit.certificationDependencySnapshot.resolvedAt = '2026-09-04T00:01:00.000Z'
    const { snapshotId, snapshotHash: _snapshotHash, ...payload } = audit.certificationDependencySnapshot
    audit.certificationDependencySnapshot.snapshotHash = generateChecksum(payload)
    const effective = { ...pkg, dependencyLock: audit.certificationDependencySnapshot }
    binding = buildRuntimeReleaseCertificationBinding({ frameworkPackage: effective, dependencies })
    pkg.runtimeVerdict.certificationBinding = binding
    audit.certificationBinding = binding
    pkg.dependencyLock[field] = field === 'resolvedAt'
      ? '2026-09-04T00:00:30.000Z'
      : field === 'snapshotHash' ? 'b'.repeat(64) : 'drifted-canonical-snapshot'
    await expect(verifyRuntimeReleaseCertification({ frameworkPackage: pkg, session })).rejects.toMatchObject({
      reason: 'RUNTIME_RELEASE_CERTIFICATION_AUDIT_MISMATCH',
    })
  },
)

test('complete canonical certification never recovers from a divergent audit snapshot', async () => {
  audit.certificationDependencySnapshot = JSON.parse(JSON.stringify(pkg.dependencyLock))
  audit.certificationDependencySnapshot.references[0].componentVersion += 1
  const { snapshotId, snapshotHash: _snapshotHash, ...payload } = audit.certificationDependencySnapshot
  audit.certificationDependencySnapshot.snapshotHash = generateChecksum(payload)
  await expect(verifyRuntimeReleaseCertification({ frameworkPackage: pkg, session })).rejects.toMatchObject({
    reason: 'RUNTIME_RELEASE_CERTIFICATION_AUDIT_MISMATCH',
  })
})
