import { describe, expect, test } from '@jest/globals'
import { generateChecksum } from '../services/governanceAudit/checksumService.js'
import { resolveRuntimeReleaseDependencySnapshot as resolve } from '../services/runtimeReleaseSnapshotService.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
const sign = (snapshot) => {
  const { snapshotId: _id, snapshotHash: _hash, ...payload } = snapshot
  return { ...snapshot, snapshotHash: generateChecksum(payload) }
}
const fixture = () => {
  const full = sign({
    snapshotId: 'original', packageKey: 'vmf', packageVersion: '3.1.5', status: 'PASS',
    resolvedAt: '2026-09-02T10:51:32.000Z', resolvedBy: 'actor',
    references: [{ collectionKey: 'Validation', id: 'validator', key: 'validator', lockedAt: 'original-time',
      outputPaths: { outputPath: 'validation' }, bindingKeys: [], producerSkillId: '', hasParameterSchema: false,
      governedAction: '', stepCount: 0 }, { collectionKey: 'UIContract', id: 'ui', key: 'ui' }],
    uiContractSnapshot: { uiContractKey: 'ui', actionCount: 10 },
  })
  const retained = clone(full)
  retained.snapshotId = 'later'
  retained.resolvedAt = '2026-09-02T10:53:04.000Z'
  retained.references[0].lockedAt = 'later-time'
  const source = clone(full)
  delete source.uiContractSnapshot
  for (const key of ['outputPaths', 'bindingKeys', 'producerSkillId', 'hasParameterSchema', 'governedAction', 'stepCount']) {
    delete source.references[0][key]
  }
  return { full, input: { sourceSnapshot: source, retainedSnapshot: sign(retained) } }
}
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

describe('release snapshot checksum recovery, never adoption certification', () => {
  test('accepts already intact source without requiring retained evidence', () => {
    const { full } = fixture()
    const output = resolve({ sourceSnapshot: full })
    expect(output.origin).toBe('PERSISTED')
    expect(output.metadataIntegrityVerified).toBe(true)
    expect(output.adoptionReady).toBe(false)
    expect(output.historicalContentIntegrityVerified).toBe(false)
    expect(output.snapshot).toEqual(full)
    expect(output.snapshot).not.toBe(full)
    output.snapshot.references[0].id = 'changed'
    expect(full.references[0].id).toBe('validator')
  })
  test('recovers only absent fields while preserving original identity, timestamps and hash', () => {
    const { full, input } = fixture()
    const before = clone(input)
    const output = resolve(freeze(input))
    expect(output.origin).toBe('CHECKSUM_RECOVERED_RETAINED_FIELDS')
    expect(output.snapshot).toEqual(full)
    expect(output.adoptionReady).toBe(false)
    expect(input).toEqual(before)
  })
  test.each([null, false, 0, '', [], {}])('never replaces a present value %#', (value) => {
    const { input } = fixture()
    input.sourceSnapshot.references[0].outputPaths = value
    expect(resolve(input).reason).toBe('SOURCE_CHECKSUM_UNRECOVERABLE')
    expect(input.sourceSnapshot.references[0].outputPaths).toEqual(value)
  })
  test('does not replace explicit null UI snapshot', () => {
    const { input } = fixture(); input.sourceSnapshot.uiContractSnapshot = null
    expect(resolve(input).reason).toBe('SOURCE_CHECKSUM_UNRECOVERABLE')
  })
  test.each([
    ['missing retained', (x) => { delete x.retainedSnapshot }, 'RETAINED_SNAPSHOT_INVALID'],
    ['tampered retained', (x) => { x.retainedSnapshot.status = 'FAIL' }, 'RETAINED_CHECKSUM_MISMATCH'],
    ['different package', (x) => { x.retainedSnapshot = sign({ ...x.retainedSnapshot, packageKey: 'other' }) }, 'RETAINED_PACKAGE_MISMATCH'],
    ['different version', (x) => { x.retainedSnapshot = sign({ ...x.retainedSnapshot, packageVersion: '4.0.0' }) }, 'RETAINED_PACKAGE_MISMATCH'],
    ['different order', (x) => { x.retainedSnapshot.references.reverse(); x.retainedSnapshot = sign(x.retainedSnapshot) }, 'RETAINED_REFERENCES_MISMATCH'],
    ['missing reference', (x) => { x.retainedSnapshot.references.pop(); x.retainedSnapshot = sign(x.retainedSnapshot) }, 'RETAINED_REFERENCES_MISMATCH'],
    ['different identity', (x) => { x.retainedSnapshot.references[0].id = 'other'; x.retainedSnapshot = sign(x.retainedSnapshot) }, 'RETAINED_REFERENCES_MISMATCH'],
    ['duplicate retained', (x) => { x.retainedSnapshot.references[1] = clone(x.retainedSnapshot.references[0]); x.retainedSnapshot = sign(x.retainedSnapshot) }, 'RETAINED_REFERENCES_DUPLICATED'],
    ['wrong recovered content', (x) => { x.retainedSnapshot.uiContractSnapshot.actionCount = 11; x.retainedSnapshot = sign(x.retainedSnapshot) }, 'SOURCE_CHECKSUM_UNRECOVERABLE'],
    ['wrong source hash', (x) => { x.sourceSnapshot.snapshotHash = '0'.repeat(64) }, 'SOURCE_CHECKSUM_UNRECOVERABLE'],
  ])('rejects %s', (_name, mutate, reason) => {
    const { input } = fixture()
    expect(resolve(input).metadataIntegrityVerified).toBe(true)
    mutate(input)
    const before = clone(input)
    expect(resolve(freeze(input))).toEqual({ metadataIntegrityVerified: false,
      historicalContentIntegrityVerified: false, adoptionReady: false, reason })
    expect(input).toEqual(before)
  })
  test('rejects duplicate references even with valid source checksum', () => {
    const { full } = fixture(); full.references.push(clone(full.references[0]))
    expect(resolve({ sourceSnapshot: sign(full) }).reason).toBe('SOURCE_REFERENCES_DUPLICATED')
  })
  test('cannot recover arbitrary fields from a retained snapshot', () => {
    const { full } = fixture(); full.unrelated = 'never copy'
    const original = sign(full); const source = clone(original); delete source.unrelated
    expect(resolve({ sourceSnapshot: source, retainedSnapshot: original }).reason).toBe('SOURCE_CHECKSUM_UNRECOVERABLE')
  })
  test.each([undefined, null, [], {}, { sourceSnapshot: null }, { sourceSnapshot: new Date() }])(
    'rejects malformed input %#', (input) => expect(resolve(input).metadataIntegrityVerified).toBe(false),
  )
  test('rejects accessors without evaluating them', () => {
    const { input } = fixture()
    Object.defineProperty(input.sourceSnapshot, 'extra', { enumerable: true, get() { throw Error('unsafe getter') } })
    expect(resolve(input).reason).toBe('INVALID_INPUT')
  })
  test('rejects cycles', () => {
    const { input } = fixture(); input.sourceSnapshot.loop = input
    expect(resolve(input).reason).toBe('INVALID_INPUT')
  })
})
