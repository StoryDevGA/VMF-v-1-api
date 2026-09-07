import { describe, expect, test } from '@jest/globals'
import FrameworkPackage from '../models/FrameworkPackage.js'
import { generateChecksum } from '../services/governanceAudit/checksumService.js'

const json = (value) => JSON.parse(JSON.stringify(value))
const fixture = () => ({
  snapshotId: 'dependency-snapshot-test', status: 'PASS',
  resolvedAt: '2026-09-02T10:51:32.000Z', resolvedBy: '507f1f77bcf86cd799439011',
  packageKey: 'vmf-test', packageVersion: '3.1.5',
  references: [{
    collectionKey: 'WorkflowPolicy', id: 'return-to-draft', key: 'return-to-draft',
    name: 'Return to draft', status: 'ACTIVE', versionStatus: 'ACTIVE', componentVersion: 1,
    lineageId: 'return-to-draft', lockedAt: '2026-09-02T10:51:32.000Z', issues: [],
    outputPaths: { outputPath: 'framework_state.validation', passFieldPath: 'passed', detailsFieldPath: 'details', messageFieldPath: 'message' }, bindingKeys: ['return-to-draft'],
    producerSkillId: 'producer', hasParameterSchema: true,
    governedAction: 'RETURN_TO_DRAFT', stepCount: 1,
  }],
  uiContractSnapshot: {
    uiContractKey: 'vmf-ui', stableId: 'vmf-ui', lineageId: 'vmf-ui', componentVersion: 1,
    versionStatus: 'ACTIVE', sourcePackageKey: 'vmf-test', sourcePackageVersion: '3.1.5',
    compatibilityMode: 'EXACT',
    sectionMapping: { mapped: ['context'], missing: [], counts: { mapped: 1 } },
    lifecycleStageCount: 6, actionCount: 10,
  },
})
const checksum = ({ snapshotId: _id, snapshotHash: _hash, ...payload }) => generateChecksum(json(payload))
const roundtrip = (snapshot) => {
  const doc = new FrameworkPackage({ dependencyLock: snapshot })
  return json(doc.dependencyLock.toObject({ minimize: false }))
}

describe('Framework Package dependency snapshot hash-input preservation', () => {
  test('retains every hashed field through model casting and JSON roundtrip', () => {
    const input = fixture()
    input.snapshotHash = checksum(input)
    const before = json(input)
    const persistedShape = roundtrip(input)
    expect(persistedShape).toEqual(input)
    expect(checksum(persistedShape)).toBe(input.snapshotHash)
    expect(input).toEqual(before)
  })
  test('retains explicit false, zero, empty strings and empty arrays', () => {
    const input = fixture()
    Object.assign(input.references[0], {
      outputPaths: { outputPath: '', passFieldPath: '', detailsFieldPath: '', messageFieldPath: '' }, bindingKeys: [], producerSkillId: '', hasParameterSchema: false,
      governedAction: '', stepCount: 0,
    })
    input.uiContractSnapshot.sectionMapping = {}
    input.uiContractSnapshot.lifecycleStageCount = 0
    input.uiContractSnapshot.actionCount = 0
    input.snapshotHash = checksum(input)
    expect(roundtrip(input)).toEqual(input)
    expect(checksum(roundtrip(input))).toBe(input.snapshotHash)
  })
  test('does not manufacture new fields for legacy snapshots', () => {
    const input = fixture()
    delete input.uiContractSnapshot
    const fields = ['outputPaths', 'bindingKeys', 'producerSkillId', 'hasParameterSchema', 'governedAction', 'stepCount']
    fields.forEach((key) => delete input.references[0][key])
    input.snapshotHash = checksum(input)
    const output = roundtrip(input)
    expect(output).toEqual(input)
    expect(output).not.toHaveProperty('uiContractSnapshot')
    fields.forEach((key) => expect(output.references[0]).not.toHaveProperty(key))
    expect(checksum(output)).toBe(input.snapshotHash)
  })
  test('does not relax unknown reference field filtering', () => {
    const input = fixture()
    input.references[0].unrelatedOverride = true
    expect(roundtrip(input).references[0]).not.toHaveProperty('unrelatedOverride')
  })
})
