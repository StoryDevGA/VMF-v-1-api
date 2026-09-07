import { describe, expect, test } from '@jest/globals'
import mongoose from 'mongoose'
import FrameworkPackage from '../models/FrameworkPackage.js'
import { generateChecksum } from '../services/governanceAudit/checksumService.js'
import { buildRuntimeReleaseCertificationBinding as bind } from '../services/runtimeReleaseCertificationService.js'

const types = { RuntimePathRegistry: 'pathKey', ValidationRegistry: 'key', WorkflowPolicy: 'key',
  RuntimeAgent: 'key', RuntimeSkill: 'key', SkillRoleRegistry: 'roleKey', UIContract: 'uiContractKey' }
const id = (n) => n.toString(16).padStart(24, '0')
const clone = (value) => JSON.parse(JSON.stringify(value))
const sign = (input) => {
  const snapshot = input.frameworkPackage.dependencyLock
  const { snapshotId: _id, snapshotHash: _hash, ...payload } = snapshot
  snapshot.snapshotHash = generateChecksum(clone(payload))
  return input
}
const fixture = () => {
  const dependencies = Object.fromEntries(Object.entries(types).map(([type, key], index) => [type, [{
    _id: id(index + 10), stableId: `stable-${type}`, [key]: `key-${type}`, componentVersion: 1,
    status: 'ACTIVE', versionStatus: 'ACTIVE', isLocked: true,
    description: 'Authored description', introducedInVersion: '3.1.6',
    configuration: { nested: [{ value: 'first' }, { value: 'second' }] },
  }]]))
  const ui = dependencies.UIContract[0]
  Object.assign(ui, { sections: [{ sectionKey: 'context', runtimePath: 'framework_state.context' }],
    lifecycleStages: [], actions: [{ actionKey: 'RETURN_TO_DRAFT', requiresConfirmation: true }] })
  const frameworkPackage = {
    _id: id(1), frameworkKey: 'VMF', frameworkName: 'VMF', packageKey: 'certification-fixture',
    version: '3.1.6', derivedFromPackageId: id(2), status: 'VALIDATED', versionStatus: 'ACTIVE', isLocked: true,
    createdBy: id(3), updatedBy: id(3), sections: clone(ui.sections), runtimeSettings: {}, executionModel: {},
    validationBindings: [], workflowBindings: [], uiContractKey: ui.uiContractKey,
    uiContractBinding: { key: ui.uiContractKey, resolvedAt: '2026-09-04T00:00:00.000Z' },
    dependencyLock: {
      snapshotId: 'snapshot-certification-fixture', packageKey: 'certification-fixture', packageVersion: '3.1.6',
      status: 'PASS', resolvedAt: '2026-09-04T00:00:00.000Z', resolvedBy: id(3),
      references: Object.entries(dependencies).map(([collectionKey, [row]]) => ({
        collectionKey, id: row.stableId, key: row[types[collectionKey]], componentVersion: 1,
        status: 'ACTIVE', versionStatus: 'ACTIVE',
      })),
      uiContractSnapshot: { uiContractKey: ui.uiContractKey, stableId: ui.stableId, componentVersion: 1,
        actionCount: 1, lifecycleStageCount: 0, sectionMapping: { mapped: ['context'] } },
    },
  }
  return sign({ frameworkPackage, dependencies })
}
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const invalid = (input) => expect(() => bind(input)).toThrow(expect.objectContaining({
  code: 'RUNTIME_RELEASE_CERTIFICATION_INPUT_INVALID',
}))

describe('pure versioned release input binding (not certification)', () => {
  test('returns only a version and server-derived checksum, deterministically', () => {
    const input = fixture()
    expect(bind(input)).toEqual({ version: 'runtime-release-certification.v1', digest: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(bind(input)).toEqual(bind(clone(input)))
  })
  test('does not mutate deeply frozen inputs on success or rejection', () => {
    const input = fixture(); const before = clone(input)
    bind(freeze(input)); expect(input).toEqual(before)
    const bad = fixture(); bad.dependencies.UIContract = []
    const badBefore = clone(bad); invalid(freeze(bad)); expect(bad).toEqual(badBefore)
  })
  test('canonical object key order and native BSON/date representations agree', () => {
    const input = fixture(); const other = clone(input)
    other.frameworkPackage = Object.fromEntries(Object.entries(other.frameworkPackage).reverse())
    other.frameworkPackage._id = new mongoose.Types.ObjectId(other.frameworkPackage._id)
    other.frameworkPackage.dependencyLock.resolvedAt = new Date(other.frameworkPackage.dependencyLock.resolvedAt)
    other.frameworkPackage.dependencyLock.resolvedBy = new mongoose.Types.ObjectId(id(3))
    expect(bind(other)).toEqual(bind(input))
  })
  test('real Mongoose hydrated package and its complete defaulted raw document agree', () => {
    const input = fixture()
    const doc = FrameworkPackage.hydrate(input.frameworkPackage)
    const raw = doc.toObject({ minimize: false, transform: false, virtuals: false })
    sign({ frameworkPackage: raw })
    doc.dependencyLock.snapshotHash = raw.dependencyLock.snapshotHash
    expect(bind({ ...input, frameworkPackage: doc })).toEqual(bind({ ...input, frameworkPackage: raw }))
  })
  test.each(Object.keys(types))('BSON and hydrated %s documents agree with raw records', (type) => {
    const input = fixture(); const expected = bind(input)
    const schema = new mongoose.Schema({}, { strict: false, id: false, versionKey: false })
    const row = input.dependencies[type][0]
    input.dependencies[type][0] = new mongoose.Document(row, schema)
    expect(bind(input)).toEqual(expected)
  })
  test.each(['frameworkKey', 'packageKey', 'version', 'derivedFromPackageId', 'description', 'visibility',
    'customerAccessMode', 'unknownAuthoredField', 'validationConfig', 'workflowPolicyConfig',
    'compatibleWorkflowKeys', 'defaultAgentIds', 'requiredSkillIds', 'validationRules'])('retains authored package %s', (key) => {
    const input = fixture(); const before = bind(input)
    if (['frameworkKey', 'derivedFromPackageId', 'description', 'visibility', 'customerAccessMode'].includes(key)) {
      input.frameworkPackage[key] = 'changed'
    } else if (key === 'packageKey') {
      input.frameworkPackage.packageKey = 'changed'; input.frameworkPackage.dependencyLock.packageKey = 'changed'
    } else if (key === 'version') {
      input.frameworkPackage.version = '3.1.7'; input.frameworkPackage.dependencyLock.packageVersion = '3.1.7'
    } else input.frameworkPackage[key] = { authored: ['changed'] }
    expect(bind(sign(input))).not.toEqual(before)
  })
  test.each(Object.keys(types))('retains entire %s authored content and nested metadata-named fields', (type) => {
    const input = fixture(); const before = bind(input)
    input.dependencies[type][0].configuration.nested[0].value = 'changed'
    expect(bind(input)).not.toEqual(before)
    const other = fixture(); other.dependencies[type][0].configuration.updatedAt = 'authored'
    expect(bind(other)).not.toEqual(before)
    const unknown = fixture(); unknown.dependencies[type][0].futureAuthoredField = true
    expect(bind(unknown)).not.toEqual(before)
  })
  test.each(['__v', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'lockedAt', 'lockedBy',
    'lockedReason', 'lockedByPackageKeys'])('ignores top-level operational %s on package and dependencies', (key) => {
    const input = fixture(); const before = bind(input)
    input.frameworkPackage[key] = 'metadata'
    for (const rows of Object.values(input.dependencies)) rows[0][key] = 'metadata'
    expect(bind(input)).toEqual(before)
  })
  test.each(['status', 'versionStatus', 'isLocked', 'isDefault', 'activatedAt', 'activatedBy',
    'lastCheckpointStatus', 'lastCheckpointAt', 'lastCheckpointResult', 'runtimeVerdict'])('package operational %s is not authored input', (key) => {
    const input = fixture(); const before = bind(input)
    input.frameworkPackage[key] = 'metadata'
    expect(bind(input)).toEqual(before)
  })
  test('UI binding resolution time is operational; unknown binding fields are authored', () => {
    const input = fixture(); const before = bind(input)
    input.frameworkPackage.uiContractBinding.resolvedAt = 'later'
    expect(bind(input)).toEqual(before)
    input.frameworkPackage.uiContractBinding.future = true
    expect(bind(input)).not.toEqual(before)
  })
  test('preserves authored and snapshot array ordering, not dependency lookup ordering', () => {
    const input = fixture(); const before = bind(input)
    input.dependencies.RuntimeSkill[0].configuration.nested.reverse()
    expect(bind(input)).not.toEqual(before)
    const reordered = fixture(); reordered.frameworkPackage.dependencyLock.references.reverse()
    expect(bind(sign(reordered))).not.toEqual(before)
    const lookups = fixture(); lookups.dependencies = Object.fromEntries(Object.entries(lookups.dependencies).reverse())
    expect(bind(lookups)).toEqual(before)
  })
  test('binds snapshot identity and complete checksum inputs without recovering historical metadata', () => {
    const input = fixture(); const before = bind(input)
    input.frameworkPackage.dependencyLock.snapshotId = 'different'
    expect(bind(input)).not.toEqual(before)
    const other = fixture(); other.frameworkPackage.dependencyLock.references[0].lockedAt = 'later'
    invalid(other)
    expect(bind(sign(other))).not.toEqual(before)
  })
  test.each([
    ['missing package', (x) => { delete x.frameworkPackage }],
    ['caller digest', (x) => { x.digest = 'pretend' }],
    ['missing identity', (x) => { delete x.frameworkPackage._id }],
    ['conflicting alias', (x) => { x.frameworkPackage.id = id(99) }],
    ['partial package', (x) => { delete x.frameworkPackage.sections }],
    ['missing snapshot', (x) => { delete x.frameworkPackage.dependencyLock }],
    ['bad checksum', (x) => { x.frameworkPackage.dependencyLock.snapshotHash = '0'.repeat(64) }],
    ['unknown collection', (x) => { x.dependencies.Other = [] }],
    ['missing collection', (x) => { delete x.dependencies.RuntimeSkill }],
    ['missing record', (x) => { x.dependencies.RuntimeSkill = [] }],
    ['duplicate record', (x) => { x.dependencies.RuntimeSkill.push(clone(x.dependencies.RuntimeSkill[0])) }],
    ['extra record', (x) => { x.dependencies.RuntimeSkill.push({ ...x.dependencies.RuntimeSkill[0], stableId: 'extra' }) }],
    ['version mismatch', (x) => { x.dependencies.RuntimeSkill[0].componentVersion++ }],
    ['key mismatch', (x) => { x.dependencies.RuntimeSkill[0].key = 'other' }],
    ['unlocked record', (x) => { x.dependencies.RuntimeSkill[0].isLocked = false }],
    ['inactive record', (x) => { x.dependencies.RuntimeSkill[0].status = 'DRAFT' }],
    ['unknown reference', (x) => { x.frameworkPackage.dependencyLock.references[0].collectionKey = 'Other'; sign(x) }],
    ['duplicate reference', (x) => { x.frameworkPackage.dependencyLock.references.push(clone(x.frameworkPackage.dependencyLock.references[0])); sign(x) }],
    ['missing UI snapshot', (x) => { delete x.frameworkPackage.dependencyLock.uiContractSnapshot; sign(x) }],
    ['wrong UI counts', (x) => { x.frameworkPackage.dependencyLock.uiContractSnapshot.actionCount++; sign(x) }],
  ])('fails closed: %s', (_name, mutate) => { const input = fixture(); mutate(input); invalid(input) })
  test.each([undefined, NaN, Infinity, 1n, () => {}, Symbol('bad'), new Date('invalid'), new Map(), /x/])('rejects lossy authored values %#', (value) => {
    const input = fixture(); input.frameworkPackage.authored = value; invalid(input)
  })
  test('rejects sparse arrays, accessors, symbols, cycles and prototype setter keys', () => {
    const badValues = [new Array(2), Object.defineProperty({}, 'getter', { enumerable: true, get: () => 'x' }),
      { [Symbol('x')]: true }, JSON.parse('{"__proto__":{"x":true}}')]
    const cycle = {}; cycle.self = cycle; badValues.push(cycle)
    for (const value of badValues) { const input = fixture(); input.frameworkPackage.authored = value; invalid(input) }
  })
})
