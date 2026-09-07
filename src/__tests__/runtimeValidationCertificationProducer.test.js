import { beforeEach, afterEach, expect, test, jest } from '@jest/globals'
import mongoose from 'mongoose'
import * as models from '../models/index.js'
import governance from '../services/governanceAudit/governanceAuditService.js'
import { generateChecksum } from '../services/governanceAudit/checksumService.js'
import { validateRuntimeOperation } from '../services/runtimeValidation/runtimeValidationEngine.js'
import { buildRuntimeReleaseCertificationBinding } from '../services/runtimeReleaseCertificationService.js'
import { buildRuntimeCertificationPackageCas, captureRuntimeReleaseCertification, CERTIFICATION_PACKAGE_SELECTION,
  resolveRuntimeCertificationDependencySnapshot } from '../services/runtimeReleaseCertificationCaptureService.js'
import { persistRuntimeValidationAudit } from '../services/runtimeValidation/runtimeValidationPersistence.js'

const types = { RuntimePathRegistry: 'pathKey', ValidationRegistry: 'key', WorkflowPolicy: 'key',
  RuntimeAgent: 'key', RuntimeSkill: 'key', SkillRoleRegistry: 'roleKey', UIContract: 'uiContractKey' }
const id = (n) => n.toString(16).padStart(24, '0')
let pkg, dependencies, queries, session
const query = (value) => {
  const result = { select: jest.fn().mockReturnThis(), session: jest.fn().mockReturnThis(),
    lean: jest.fn(async () => value) }
  queries.push(result)
  return result
}
const input = () => ({ packageId: id(1), frameworkKey: 'VMF', operationType: 'OUTPUT_VALIDATION',
  outputContract: {}, payload: {}, mode: 'STRICT', isPackageLevelValidation: true })
beforeEach(() => {
  queries = []
  dependencies = Object.fromEntries(Object.entries(types).map(([type, key], i) => [type, [{
    _id: id(i + 10), stableId: `stable-${type}`, [key]: `key-${type}`, componentVersion: 1,
    status: 'ACTIVE', versionStatus: 'ACTIVE', isLocked: true,
  }]]))
  const ui = dependencies.UIContract[0]
  Object.assign(ui, { sections: [{ sectionKey: 'context' }], actions: [], lifecycleStages: [] })
  pkg = { _id: id(1), frameworkKey: 'VMF', packageKey: 'synthetic-producer', version: '3.1.6',
    sections: ui.sections, validationBindings: [], workflowBindings: [], runtimeSettings: {}, executionModel: {},
    validationRules: { syntheticHiddenRule: true }, uiContractKey: ui.uiContractKey,
    uiContractBinding: { key: ui.uiContractKey },
    dependencyLock: { snapshotId: 'synthetic-snapshot', packageKey: 'synthetic-producer', packageVersion: '3.1.6',
      status: 'PASS', resolvedAt: '2026-09-04T00:00:00.000Z',
      references: Object.entries(dependencies).map(([collectionKey, [row]]) => ({ collectionKey,
        id: row.stableId, key: row[types[collectionKey]], componentVersion: 1, status: 'ACTIVE', versionStatus: 'ACTIVE' })),
      uiContractSnapshot: { uiContractKey: ui.uiContractKey, stableId: ui.stableId, componentVersion: 1,
        actionCount: 0, lifecycleStageCount: 0, sectionMapping: { mapped: ['context'] } } } }
  const { snapshotId, ...payload } = pkg.dependencyLock
  pkg.dependencyLock.snapshotHash = generateChecksum(payload)
  session = { inTransaction: () => true, withTransaction: jest.fn(async (callback) => callback()), endSession: jest.fn() }
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(session)
  jest.spyOn(models.FrameworkPackage, 'findById').mockImplementation(() => query(pkg))
  jest.spyOn(models.FrameworkPackage, 'findOne').mockImplementation(() => query(pkg))
  for (const type of Object.keys(types)) {
    jest.spyOn(models[type], 'findOne').mockImplementation(() => query(dependencies[type][0]))
  }
  jest.spyOn(models.RuntimeValidationAudit, 'create').mockImplementation(async ([row]) => [{ ...row, _id: id(50) }])
  jest.spyOn(models.FrameworkPackage, 'updateOne').mockResolvedValue({ matchedCount: 1 })
  jest.spyOn(governance, 'logSystemEvent').mockResolvedValue({})
})
afterEach(() => jest.restoreAllMocks())

test('captures seven dependency families and hidden authored fields once; all three writes share session and binding', async () => {
  const expected = buildRuntimeReleaseCertificationBinding({ frameworkPackage: pkg, dependencies })
  const result = await validateRuntimeOperation({ ...input(), certificationBinding: { digest: 'client-forgery' } })
  expect(result.result).toBe('ALLOW')
  expect(queries).toHaveLength(8)
  for (const q of queries) expect(q.session).toHaveBeenCalledWith(session)
  expect(queries[0].select).toHaveBeenCalledWith(CERTIFICATION_PACKAGE_SELECTION)
  expect(models.RuntimeValidationAudit.create).toHaveBeenCalledWith([expect.objectContaining({
    certificationBinding: expected, certificationDependencySnapshot: pkg.dependencyLock,
    certificationDependencyLockObservation: {
      snapshotId: pkg.dependencyLock.snapshotId,
      snapshotHash: pkg.dependencyLock.snapshotHash,
      resolvedAt: '2026-09-04T00:00:00.000Z',
    },
    isPackageLevelValidation: true,
  })], { session })
  const verdict = models.FrameworkPackage.updateOne.mock.calls[0][1].$set.runtimeVerdict
  expect(verdict).toMatchObject({ certificationBinding: expected, auditId: id(50), validationId: id(50) })
  expect(governance.logSystemEvent.mock.calls[0][1].snapshot.runtimeVerdict).toEqual(verdict)
  expect(governance.logSystemEvent.mock.calls[0][1].snapshot.runtimeValidation.certificationDependencySnapshot)
    .toEqual({ snapshotId: pkg.dependencyLock.snapshotId, snapshotHash: pkg.dependencyLock.snapshotHash })
  expect(governance.logSystemEvent.mock.calls[0][2]).toEqual({ throwOnError: true, session })
  expect(models.FrameworkPackage.updateOne.mock.calls[0][2]).toEqual({ session, timestamps: false, runValidators: true })
  expect(session.endSession).toHaveBeenCalledTimes(1)
})
test.each(['DISABLED', 'AUDIT_ONLY'])('%s never mints binding', async (mode) => {
  await validateRuntimeOperation({ ...input(), mode })
  expect(queries).toHaveLength(1)
  expect(models.RuntimeValidationAudit.create.mock.calls[0][0][0].certificationBinding).toBeNull()
})
test('raw missing lock status never receives hydrated PASS', async () => {
  delete pkg.dependencyLock.status
  await validateRuntimeOperation(input())
  expect(queries).toHaveLength(1)
  expect(models.FrameworkPackage.updateOne.mock.calls[0][1].$set.runtimeVerdict).toMatchObject({
    dependencyLockState: 'NOT_LOCKED', certificationBinding: null,
  })
})
test('CAS distinguishes absent, explicitly null and prior verdict', () => {
  expect(buildRuntimeCertificationPackageCas(pkg).runtimeVerdict).toEqual({ $exists: false })
  pkg.runtimeVerdict = null
  expect(buildRuntimeCertificationPackageCas(pkg).runtimeVerdict).toEqual({ $eq: null, $exists: true })
  pkg.runtimeVerdict = { auditId: id(49) }
  expect(buildRuntimeCertificationPackageCas(pkg).$expr).toEqual({ $eq: [{ $literal: pkg.runtimeVerdict }, '$runtimeVerdict'] })
  pkg.lastCheckpointResult = { status: 'PASS', opaque: '$literal-checkpoint' }
  expect(buildRuntimeCertificationPackageCas(pkg).$expr).toEqual({ $and: [
    { $eq: [{ $literal: pkg.runtimeVerdict }, '$runtimeVerdict'] },
    { $eq: [{ $literal: pkg.lastCheckpointResult }, '$lastCheckpointResult'] },
  ] })
})
test.each([
  ['absent verdict', undefined],
  ['null verdict', null],
  ['legacy absent binding', { auditId: id(49), lastValidatedAt: new Date('2026-09-04T00:00:00.000Z') }],
  ['legacy BSON and unknown fields', { auditId: new mongoose.Types.ObjectId(id(49)), legacyOnly: { value: '$literal-data' } }],
  ['explicit null binding', { auditId: id(49), certificationBinding: null }],
  ['populated binding', { auditId: id(49), certificationBinding: {
    version: 'runtime-release-certification.v1', digest: 'a'.repeat(64),
  } }],
])('real Mongoose query.cast preserves exact observed %s', (_name, prior) => {
  if (prior !== undefined) pkg.runtimeVerdict = prior
  const filter = buildRuntimeCertificationPackageCas(pkg)
  const before = prior && mongoose.mongo.BSON.serialize(prior)
  // Query construction and casting only: never execute or connect to MongoDB.
  const q = models.FrameworkPackage.find()
  q.setQuery(filter)
  const cast = q.cast(models.FrameworkPackage)
  if (prior === undefined) expect(cast.runtimeVerdict).toStrictEqual({ $exists: false })
  else if (prior === null) expect(cast.runtimeVerdict).toStrictEqual({ $eq: null, $exists: true })
  else {
    const verdictExpression = cast.$expr.$and?.[0] || cast.$expr
    const literal = verdictExpression.$eq[0].$literal
    expect(literal).toStrictEqual(prior)
    expect(mongoose.mongo.BSON.serialize(literal)).toEqual(before)
    expect(mongoose.mongo.BSON.serialize(prior)).toEqual(before)
    expect(Object.keys(literal)).toEqual(Object.keys(prior))
    expect(literal).not.toHaveProperty('auditPersisted')
    expect(literal).not.toHaveProperty('blockingIssues')
    expect(cast).not.toHaveProperty('runtimeVerdict')
  }
})

const rehashSnapshot = (snapshot) => {
  const { snapshotId, snapshotHash: _snapshotHash, ...payload } = snapshot
  return { snapshotId, snapshotHash: generateChecksum(payload), ...payload }
}
const makeLegacyRecovery = () => {
  const canonical = structuredClone(pkg.dependencyLock)
  delete canonical.uiContractSnapshot
  canonical.snapshotHash = 'a'.repeat(64)
  const preview = rehashSnapshot({
    ...structuredClone(pkg.dependencyLock),
    snapshotId: 'synthetic-recovered-snapshot',
    resolvedAt: '2026-09-04T00:01:00.000Z',
  })
  pkg.dependencyLock = canonical
  pkg.lastCheckpointStatus = 'PASS'
  pkg.lastCheckpointAt = new Date('2026-09-04T00:02:00.000Z')
  pkg.lastCheckpointResult = {
    status: 'PASS',
    timestamp: '2026-09-04T00:02:00.000Z',
    dependencyLockPreview: preview,
  }
  return { canonical, preview }
}

test('uses an exact newer retained checkpoint snapshot for the recognized legacy lock shape', () => {
  const { preview } = makeLegacyRecovery()
  expect(resolveRuntimeCertificationDependencySnapshot({ frameworkPackage: pkg })).toEqual({
    snapshot: preview,
    source: 'RETAINED_CHECKPOINT_SNAPSHOT',
  })
})

test.each([
  ['checkpoint status', ({ pkg }) => { pkg.lastCheckpointStatus = 'FAIL' }],
  ['checkpoint timestamp', ({ pkg }) => { pkg.lastCheckpointResult.timestamp = '2026-09-04T00:03:00.000Z' }],
  ['preview package', ({ preview }) => { preview.packageVersion = '9.9.9' }],
  ['preview checksum', ({ preview }) => { preview.snapshotHash = 'b'.repeat(64) }],
  ['reference removal', ({ preview }) => { preview.references.pop(); Object.assign(preview, rehashSnapshot(preview)) }],
  ['reference reorder', ({ preview }) => { preview.references.reverse(); Object.assign(preview, rehashSnapshot(preview)) }],
  ['reference version', ({ preview }) => { preview.references[0].componentVersion += 1; Object.assign(preview, rehashSnapshot(preview)) }],
  ['not newer', ({ preview, canonical }) => { preview.resolvedAt = canonical.resolvedAt; Object.assign(preview, rehashSnapshot(preview)) }],
])('rejects legacy recovery with %s drift', (_name, mutate) => {
  const recovery = makeLegacyRecovery()
  mutate({ pkg, ...recovery })
  expect(() => resolveRuntimeCertificationDependencySnapshot({ frameworkPackage: pkg }))
    .toThrow(expect.objectContaining({ code: 'RUNTIME_RELEASE_CERTIFICATION_INPUT_INVALID' }))
})

test('never falls back when a complete canonical snapshot has an invalid checksum', () => {
  const preview = structuredClone(pkg.dependencyLock)
  pkg.dependencyLock.snapshotHash = 'b'.repeat(64)
  pkg.lastCheckpointStatus = 'PASS'
  pkg.lastCheckpointAt = new Date('2026-09-04T00:02:00.000Z')
  pkg.lastCheckpointResult = { status: 'PASS', timestamp: pkg.lastCheckpointAt,
    dependencyLockPreview: preview }
  expect(() => resolveRuntimeCertificationDependencySnapshot({ frameworkPackage: pkg }))
    .toThrow(expect.objectContaining({ reason: 'SNAPSHOT_INVALID' }))
})

test('round-trips the complete server-owned certification snapshot through Mongoose Mixed storage', () => {
  const row = new models.RuntimeValidationAudit({
    validationCode: 'RVL-EXECUTION-009', severity: 'INFO', operationType: 'OUTPUT_VALIDATION',
    packageId: id(1), frameworkKey: 'VMF', status: 'PASS', result: 'ALLOW', mode: 'STRICT',
    isPackageLevelValidation: true, dependencyLockState: 'LOCKED',
    certificationBinding: { version: 'runtime-release-certification.v1', digest: 'a'.repeat(64) },
    certificationDependencySnapshot: pkg.dependencyLock,
    certificationDependencyLockObservation: {
      snapshotId: pkg.dependencyLock.snapshotId,
      snapshotHash: pkg.dependencyLock.snapshotHash,
      resolvedAt: '2026-09-04T00:00:00.000Z',
    },
  })
  expect(row.toObject({ minimize: false }).certificationDependencySnapshot).toStrictEqual(pkg.dependencyLock)
  expect(row.toObject({ minimize: false }).certificationDependencyLockObservation).toStrictEqual({
    snapshotId: pkg.dependencyLock.snapshotId,
    snapshotHash: pkg.dependencyLock.snapshotHash,
    resolvedAt: '2026-09-04T00:00:00.000Z',
  })
})
test.each([
  ['missing binding', ({ options }) => { delete options.certificationBinding }],
  ['missing selected snapshot', ({ options }) => { delete options.certificationDependencySnapshot }],
  ['mismatched selected snapshot', ({ options }) => { options.certificationDependencySnapshot = {
    ...options.certificationDependencySnapshot, snapshotHash: 'b'.repeat(64),
  } }],
  ['missing canonical observation', ({ options }) => { delete options.certificationDependencyLockObservation }],
  ['mismatched canonical observation', ({ options }) => {
    options.certificationDependencyLockObservation.snapshotId = 'different-canonical-lock'
  }],
])('persistence rejects %s before the original audit write', async (_name, mutate) => {
  const options = {
    session,
    capturedPackage: pkg,
    certificationBinding: buildRuntimeReleaseCertificationBinding({ frameworkPackage: pkg, dependencies }),
    certificationDependencySnapshot: pkg.dependencyLock,
    certificationDependencyLockObservation: {
      snapshotId: pkg.dependencyLock.snapshotId,
      snapshotHash: pkg.dependencyLock.snapshotHash,
      resolvedAt: '2026-09-04T00:00:00.000Z',
    },
  }
  mutate({ options })
  await expect(persistRuntimeValidationAudit({
    isPackageLevelValidation: true,
    result: 'ALLOW',
    status: 'PASS',
    mode: 'STRICT',
    packageResolved: true,
    dependencyLockState: 'LOCKED',
  }, options)).rejects.toMatchObject({ code: 'RUNTIME_VALIDATION_EVIDENCE_PERSISTENCE_FAILED' })
  expect(models.RuntimeValidationAudit.create).not.toHaveBeenCalled()
  expect(governance.logSystemEvent).not.toHaveBeenCalled()
  expect(models.FrameworkPackage.updateOne).not.toHaveBeenCalled()
})
test.each(['audit', 'governance', 'cas'])('%s failure rejects the transaction callback and closes session', async (stage) => {
  if (stage === 'audit') models.RuntimeValidationAudit.create.mockRejectedValueOnce(new Error('audit failed'))
  if (stage === 'governance') governance.logSystemEvent.mockRejectedValueOnce(new Error('governance failed'))
  if (stage === 'cas') models.FrameworkPackage.updateOne.mockResolvedValueOnce({ matchedCount: 0 })
  await expect(validateRuntimeOperation(input())).rejects.toMatchObject({ code: 'RUNTIME_VALIDATION_EVIDENCE_PERSISTENCE_FAILED' })
  expect(session.endSession).toHaveBeenCalledTimes(1)
  if (stage === 'audit') expect(governance.logSystemEvent).not.toHaveBeenCalled()
  if (stage !== 'cas') expect(models.FrameworkPackage.updateOne).not.toHaveBeenCalled()
})
test('transaction callback retry recaptures and recomputes authored dependency input', async () => {
  session.withTransaction.mockImplementation(async (callback) => {
    await callback()
    dependencies.RuntimeAgent[0].description = 'retry changed authored content'
    return callback()
  })
  await validateRuntimeOperation(input())
  expect(models.FrameworkPackage.findById).toHaveBeenCalledTimes(2)
  const calls = models.RuntimeValidationAudit.create.mock.calls
  expect(calls[0][0][0].certificationBinding).not.toEqual(calls[1][0][0].certificationBinding)
})
test('ordinary no-session validation retains object create and never starts a transaction', async () => {
  models.RuntimeValidationAudit.create.mockImplementation(async (row) => row)
  await validateRuntimeOperation({ ...input(), isPackageLevelValidation: false })
  expect(mongoose.startSession).not.toHaveBeenCalled()
  for (const q of queries) expect(q.session).not.toHaveBeenCalled()
  expect(models.RuntimeValidationAudit.create.mock.calls[0]).toHaveLength(1)
  expect(models.RuntimeValidationAudit.create.mock.calls[0][0]).not.toHaveProperty('certificationBinding')
})
test.each([{}, { inTransaction: () => false }, { inTransaction: () => 1 }])('rejects inactive or malformed caller session before reads or writes', async (invalidSession) => {
  await expect(validateRuntimeOperation(input(), { session: invalidSession })).rejects.toMatchObject({
    code: 'RUNTIME_VALIDATION_EVIDENCE_PERSISTENCE_FAILED',
  })
  expect(queries).toHaveLength(0)
  expect(models.RuntimeValidationAudit.create).not.toHaveBeenCalled()
  expect(mongoose.startSession).not.toHaveBeenCalled()
})
test('active caller transaction remains caller-owned', async () => {
  await validateRuntimeOperation(input(), { session })
  expect(mongoose.startSession).not.toHaveBeenCalled()
  expect(session.withTransaction).not.toHaveBeenCalled()
  expect(session.endSession).not.toHaveBeenCalled()
})
test('capture and persistence independently reject sessions outside transactions', async () => {
  const inactive = { inTransaction: () => false }
  await expect(captureRuntimeReleaseCertification({ frameworkPackage: pkg, session: inactive })).rejects.toThrow('active transaction')
  await expect(persistRuntimeValidationAudit({ isPackageLevelValidation: true }, {
    capturedPackage: pkg, session: inactive,
  })).rejects.toThrow('active transaction')
  expect(queries).toHaveLength(0)
  expect(models.RuntimeValidationAudit.create).not.toHaveBeenCalled()
})
test('mutation path, skill and derived role lookups traverse the same transaction after complete capture', async () => {
  Object.assign(dependencies.RuntimePathRegistry[0], { allowedOperations: ['WRITE'], isProtected: false })
  Object.assign(dependencies.RuntimeSkill[0], { skillRoleKey: 'VALIDATOR', allowedWritePaths: ['framework_state.context'] })
  Object.assign(dependencies.SkillRoleRegistry[0], { allowedWriteScopes: ['framework_state.context'], allowedOperations: ['WRITE'] })
  const result = await validateRuntimeOperation({ ...input(), operationType: 'STATE_WRITE',
    runtimePath: 'framework_state.context', skillId: 'stable-RuntimeSkill', allowedWriteScopes: ['framework_state.context'] })
  expect(result.result).toBe('ALLOW')
  expect(queries).toHaveLength(11)
  for (const q of queries) expect(q.session).toHaveBeenCalledWith(session)
  expect(models.SkillRoleRegistry.findOne).toHaveBeenLastCalledWith({ roleKey: 'VALIDATOR' })
  expect(queries[7].lean.mock.invocationCallOrder[0]).toBeLessThan(queries[8].lean.mock.invocationCallOrder[0])
})
test('missing original audit identity cannot manufacture a persisted verdict', async () => {
  models.RuntimeValidationAudit.create.mockResolvedValueOnce([{}])
  await expect(validateRuntimeOperation(input())).rejects.toThrow('Original validation audit identity is missing')
  expect(governance.logSystemEvent).not.toHaveBeenCalled()
  expect(models.FrameworkPackage.updateOne).not.toHaveBeenCalled()
})
