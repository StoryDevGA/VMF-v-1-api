import { describe, expect, jest, test } from '@jest/globals'
import { normalizeRuntimeSectionObject, buildRuntimeSectionRevision } from '../services/runtimeSectionModelService.js'
import { isBoundedRuntimeSectionDetail } from '../models/RuntimeStateSection.js'
import { createSectionHistoryProjectors, createSectionHistoryReadContext, getSectionHistoryRowKey,
  hashSectionHistoryPair, validateSectionHistoryReferences } from '../services/runtimeSectionHistoryContract.js'

const state = 'rsv2:11111111-1111-4111-8111-111111111111'
const nextState = 'rsv2:22222222-2222-4222-8222-222222222222'
const sectionKey = 'customer_context'
const normalize = value => normalizeRuntimeSectionObject({ value, sectionKey,
  runtimePath: `framework_state.sections.${sectionKey}`, initializedAt: '2026-10-19T00:00:00.000Z' })
const material = seed => Object.fromEntries([0, 1, 2, 3].map(index => [`part${index}`, `${seed}${'a'.repeat(7390)}`]))
const fixture = () => {
  const detail = normalize({ input: 'Original section input', generated: material('current'), accepted: material('accepted'),
    intelligence: { note: 'x'.repeat(7390) }, revisions: Array.from({ length: 6 }, (_, index) => ({
      revisionNumber: index + 1, replacedAt: `2026-10-${String(index + 10).padStart(2, '0')}T00:00:00.000Z`,
      reason: 'SECTION_GENERATION_REPLACED', generated: material(`revision${index}`),
    })) })
  const row = { customerId: '64b000000000000000000001', tenantId: '64b000000000000000000002',
    runtimeInstanceId: '64b000000000000000000003', runtimeInstanceKey: 'synthetic-history', sectionKey,
    stateVersion: state, sourceStateVersion: state, sourceHash: `sha256:${'a'.repeat(64)}`, current: true,
    legacyPath: `framework_state.sections.${sectionKey}`, projectionReceipt: {
      algorithm: 'ss014-legacy-domain-canonical-json-v1', stateVersion: state, sourceHash: `sha256:${'a'.repeat(64)}`,
      logicalPath: `framework_state.sections.${sectionKey}`,
    }, sectionDetail: detail }
  const archived = buildRuntimeSectionRevision({ generated: detail.generated, accepted: detail.accepted,
    revisionNumber: 7, reason: 'SECTION_GENERATION_REPLACED', replacedAt: '2026-10-19T00:00:00.000Z' })
  const next = { ...detail, generated: material('new'), accepted: null, revisions: [...detail.revisions, archived] }
  return { row, detail, next }
}
const project = f => createSectionHistoryProjectors({ observedRow: f.row }).next(f.next)

describe('bounded native section history', () => {
  test.each([false, true])('preserves bounded historical reads with driver-owned transaction deadline=%s', async timed => {
    const f = fixture(), readRows = jest.fn(async () => [{ ...f.row, current: false }])
    const session = { explicit: true, ...(timed ? { timeoutContext: { timeoutMS: 20000 } } : {}) }
    const context = createSectionHistoryReadContext({ session, readRows, readBudget: () => ({ timeoutMS: 1500, maxTimeMS: 1800 }) })
    await context.resolve({ ...f.row, stateVersion: nextState, sectionDetail: project(f) }, 0)
    const options = readRows.mock.calls[0][1]
    expect(options.session).toBe(session)
    expect(options.maxTimeMS).toBeGreaterThan(0)
    expect(options.maxTimeMS).toBeLessThanOrEqual(1500)
    if (timed) { expect(options).not.toHaveProperty('timeoutMS'); expect(options.readBudget()).not.toHaveProperty('timeoutMS') }
    else expect(options.timeoutMS).toBe(options.maxTimeMS)
  })
  test('retains every exact prior record and key presence while keeping current detail bounded', async () => {
    const f = fixture(), before = JSON.stringify(f.detail), projected = project(f)
    expect(isBoundedRuntimeSectionDetail(f.detail)).toBe(true)
    expect(isBoundedRuntimeSectionDetail(f.next)).toBe(false)
    expect(isBoundedRuntimeSectionDetail(projected)).toBe(true)
    expect(projected.revisions).toHaveLength(7)
    expect(Object.hasOwn(projected.revisions[0], 'accepted')).toBe(false)
    const readRows = jest.fn(async () => [{ ...f.row, current: false }])
    const context = createSectionHistoryReadContext({ readRows, session: { id: 'same-session' } })
    const current = { ...f.row, stateVersion: nextState, sectionDetail: projected }
    const actual = await Promise.all(projected.revisions.map((_, index) => context.resolve(current, index)))
    expect(actual).toEqual(f.next.revisions)
    expect(readRows).toHaveBeenCalledTimes(1)
    expect(readRows.mock.calls[0][0]).toMatchObject({ current: false, runtimeInstanceId: f.row.runtimeInstanceId,
      stateVersion: state, sourceHash: f.row.sourceHash, sectionKey })
    expect(readRows.mock.calls[0][1]).toMatchObject({ session: { id: 'same-session' }, limit: 2 })
    expect(JSON.stringify(f.detail)).toBe(before)
  })

  test('second rollover carries verified direct refs and compares every non-history field', async () => {
    const f = fixture(), compact = project(f), current = { ...f.row, stateVersion: nextState, sectionDetail: compact }
    const context = createSectionHistoryReadContext({ readRows: async () => [{ ...f.row, current: false }] })
    const verified = await context.verify([current])
    const projector = createSectionHistoryProjectors({ observedRow: current,
      resolvedRecords: verified.get(getSectionHistoryRowKey(current)) })
    expect(projector.previous(f.next)).toEqual(compact)
    expect(projector.next(f.next).revisions).toEqual(compact.revisions)
    expect(() => projector.previous({ ...f.next, input: 'Changed unseen input' })).toThrow('Section history')
    expect(() => projector.previous({ ...f.next, revisions: f.next.revisions.map((record, index) =>
      index ? record : { ...record, reason: 'changed' }) })).toThrow('Section history')
  })

  test.each(['missing', 'duplicate', 'cross-scope', 'hash', 'chain', 'projection'])('rejects %s historical targets', async kind => {
    const f = fixture(), projected = project(f), target = JSON.parse(JSON.stringify({ ...f.row, current: false }))
    if (kind === 'cross-scope') target.tenantId = '64b000000000000000000099'
    if (kind === 'hash') target.sectionDetail.revisions[0].generated.part0 = 'tampered'
    if (kind === 'chain') target.sectionDetail.revisions[0] = projected.revisions[0]
    if (kind === 'projection') target.projectionReceipt.sourceHash = `sha256:${'b'.repeat(64)}`
    const context = createSectionHistoryReadContext({ readRows: async () => kind === 'missing' ? [] : kind === 'duplicate' ? [target, target] : [target] })
    await expect(context.resolve({ ...f.row, stateVersion: nextState, sectionDetail: projected }, 0))
      .rejects.toMatchObject({ code: 'RUNTIME_SECTION_HISTORY_INVALID' })
  })

  test.each(['version', 'index', 'hash', 'presence', 'payload', 'extra'])('model rejects malformed %s references', kind => {
    const f = fixture(), detail = project(f), record = detail.revisions[0], ref = record.historyReference
    if (kind === 'version') ref.version = 'future'
    if (kind === 'index') ref.index = -2
    if (kind === 'hash') ref.hash = 'bad'
    if (kind === 'presence') ref.hasAccepted = true
    if (kind === 'payload') record.generated = { content: 'not a placeholder' }
    if (kind === 'extra') ref.extra = true
    expect(validateSectionHistoryReferences(detail)).toBe(false)
    expect(isBoundedRuntimeSectionDetail(detail)).toBe(false)
  })

  test('legacy partial snapshot rows without history need no reads', async () => {
    const readRows = jest.fn()
    const result = await createSectionHistoryReadContext({ readRows }).verify([{ sectionDetail: { accepted: {} } }])
    expect(result.size).toBe(1)
    expect(readRows).not.toHaveBeenCalled()
  })

  test('small direct sections remain exact and unretained archives cannot be compacted', () => {
    const f = fixture(), small = normalize({ input: 'small', revisions: [] })
    expect(createSectionHistoryProjectors({ observedRow: { ...f.row, sectionDetail: small } }).next(small)).toBe(small)
    f.next.revisions = f.next.revisions.map((record, index) => index ? record : { ...record, generated: material('UNKNOWN') })
    expect(() => project(f)).toThrow('Section history')
    expect(hashSectionHistoryPair({ generated: null })).toBe(hashSectionHistoryPair({ accepted: null }))
  })

  test('an exhausted inherited budget fails before a query', async () => {
    const f = fixture(), readRows = jest.fn(), context = createSectionHistoryReadContext({ readRows,
      readBudget: () => ({ maxTimeMS: 0 }) })
    await expect(context.resolve({ ...f.row, stateVersion: nextState, sectionDetail: project(f) }, 0))
      .rejects.toMatchObject({ details: { reason: 'READ_BUDGET_EXHAUSTED' } })
    expect(readRows).not.toHaveBeenCalled()
  })

  test('legacy null and primitive revision entries remain accepted without manufacturing references', () => {
    const detail = normalize({ revisions: [null, 'legacy', 1, true, []] })
    expect(validateSectionHistoryReferences(detail)).toBe(true)
    expect(isBoundedRuntimeSectionDetail(detail)).toBe(true)
    const projector = createSectionHistoryProjectors({ observedRow: { sectionDetail: detail } })
    expect(projector.previous(detail)).toEqual(detail)
    expect(projector.next(detail)).toBe(detail)
  })
})
