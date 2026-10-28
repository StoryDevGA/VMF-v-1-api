import { compactSectionInsightDisplay, restoreSectionInsightDisplay, hashSectionInput,
  normalizeRuntimeSectionObject } from '../services/runtimeSectionModelService.js'
import { isBoundedRuntimeSectionDetail } from '../models/RuntimeStateSection.js'
import { __testables } from '../services/runtimeStateMutationService.js'
import { buildRendererSections } from '../services/runtimeRendererService.js'
import { jest } from '@jest/globals'

const make = () => {
  const generated = { sections: [{ heading: 'Evidence', body: 'Bounded evidence. '.repeat(100) }] }
  return { generated, intelligence: { displayProjection: { generatedInsight: {
    title: 'Generated Insight', summary: 'Bounded summary', sections: JSON.parse(JSON.stringify(generated.sections)),
  } }, otherReceipt: { hash: 'retained' } } }
}

describe('hash-bound duplicate section display cache', () => {
  test('losslessly compacts/restores without changing authoritative payloads or mutating inputs', () => {
    const args = make(), before = structuredClone(args)
    const compact = compactSectionInsightDisplay(args)
    expect(compact.displayProjection.generatedInsight).not.toHaveProperty('sections')
    expect(compact.displayProjection.generatedInsight.sectionsReference.hash).toBe(hashSectionInput(args.generated.sections))
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(args.intelligence).length)
    const restored = restoreSectionInsightDisplay({ ...args, intelligence: compact })
    expect(restored).toEqual(args.intelligence)
    expect(restored.displayProjection.generatedInsight.sections).not.toBe(args.generated.sections)
    expect(compactSectionInsightDisplay({ ...args, intelligence: compact })).toBe(compact)
    expect(args).toEqual(before)
  })

  test.each(['missing', 'different', 'small', 'nonarray'])('preserves %s legacy cache', variant => {
    const args = make()
    if (variant === 'missing') delete args.intelligence.displayProjection.generatedInsight.sections
    if (variant === 'different') args.intelligence.displayProjection.generatedInsight.sections[0].body = 'Different independently stored data'
    if (variant === 'small') args.generated.sections = args.intelligence.displayProjection.generatedInsight.sections = []
    if (variant === 'nonarray') args.intelligence.displayProjection.generatedInsight.sections = 'Legacy'
    expect(compactSectionInsightDisplay(args)).toBe(args.intelligence)
    expect(restoreSectionInsightDisplay(args)).toBe(args.intelligence)
  })

  test.each(['null', 'array', 'extra', 'kind', 'hash', 'missing source', 'changed source', 'ambiguous'])('rejects %s reference without fallback', variant => {
    const args = make()
    args.intelligence = compactSectionInsightDisplay(args)
    const insight = args.intelligence.displayProjection.generatedInsight
    if (variant === 'null') insight.sectionsReference = null
    if (variant === 'array') insight.sectionsReference = []
    if (variant === 'extra') insight.sectionsReference.path = 'accepted.sections'
    if (variant === 'kind') insight.sectionsReference.kind = 'OTHER_SOURCE'
    if (variant === 'hash') insight.sectionsReference.hash = 'a'.repeat(64)
    if (variant === 'missing source') delete args.generated.sections
    if (variant === 'changed source') args.generated.sections[0].body += ' changed'
    if (variant === 'ambiguous') insight.sections = []
    const before = structuredClone(args)
    expect(() => restoreSectionInsightDisplay(args)).toThrow(expect.objectContaining({ status: 409, code: 'SECTION_DISPLAY_REFERENCE_INVALID' }))
    expect(args).toEqual(before)
  })

  test('retains the unchanged strict bound and every historical and accepted payload', () => {
    const args = make()
    const section = normalizeRuntimeSectionObject({ value: { input: 'Original', ...args,
      accepted: JSON.parse(JSON.stringify(args.generated)), revisions: [] }, sectionKey: 'context', runtimePath: 'framework_state.sections.context' })
    while (Buffer.byteLength(JSON.stringify(section)) <= 256 * 1024) section.revisions.push({ generated: { content: 'x'.repeat(1000) } })
    const before = structuredClone(section)
    expect(isBoundedRuntimeSectionDetail(section)).toBe(false)
    section.intelligence = compactSectionInsightDisplay(section)
    expect(isBoundedRuntimeSectionDetail(section)).toBe(true)
    for (const key of ['generated', 'accepted', 'revisions', 'input']) expect(section[key]).toEqual(before[key])
    expect(restoreSectionInsightDisplay(section)).toEqual(before.intelligence)
  })
})

describe('native archive/clear display reference lifecycle', () => {
  const copy = value => JSON.parse(JSON.stringify(value))
  const timestamp = '2026-10-15T10:00:00.000Z'
  const sectionKey = 'context'
  const runtimePath = 'framework_state.sections.context'
  const section = () => normalizeRuntimeSectionObject({
    value: { input: 'Original', ...make(), accepted: { content: 'Accepted truth' },
      revisions: [{ generated: { content: 'Earlier immutable result' } }] }, sectionKey, runtimePath,
  })
  const prepare = (owner, previous) => owner === 'input'
    ? __testables.buildSectionRootWriteValue({ previousRawValue: previous, runtimePath, sectionKey, value: 'Changed' })
    : __testables.resetDiscoveryDependentSections({ actorUserId: 'reviewer',
      frameworkState: { sections: { context: previous } }, resetAt: timestamp, resetReason: 'Controlled reset' }).sections.context
  const render = (detail, allowed) => buildRendererSections({
    frameworkState: { sections: { context: detail } },
    frameworkPackage: { sections: [{ sectionKey, runtimePath }] },
    runtimeInstance: { status: 'ACTIVE', executionStatus: 'IDLE', runtimeType: 'VALUE_NARRATIVE' },
    discovery: { accepted: true }, mutationAccess: { allowed }, uiContract: { sections: [] }, configWarnings: [],
    runtimePathRecords: new Map([[runtimePath, { allowedOperations: ['READ', 'WRITE'], dataType: 'OBJECT' }]]),
  })

  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date(timestamp)) })
  afterEach(() => jest.useRealTimers())

  test.each(['input', 'reset'])('%s archives exact truth and restores legacy display before clearing its source', owner => {
    const legacy = section(), compact = copy(legacy)
    compact.intelligence = compactSectionInsightDisplay(compact)
    const original = copy(compact), result = prepare(owner, compact), expected = prepare(owner, legacy)
    expect(result).toEqual(expected)
    expect(result.generated).toBeNull()
    expect(result.accepted).toBeNull()
    expect(result.revisions.slice(0, -1)).toEqual(original.revisions)
    expect(result.revisions.at(-1).generated).toEqual(original.generated)
    expect(result.revisions.at(-1).accepted).toEqual(original.accepted)
    expect(result.intelligence.displayProjection.generatedInsight).not.toHaveProperty('sectionsReference')
    expect(result.intelligence.displayProjection.generatedInsight.sections).toEqual(original.generated.sections)
    for (const allowed of [true, false]) expect(render(result, allowed)).toEqual(render(expected, allowed))
    expect(isBoundedRuntimeSectionDetail(result)).toBe(true)
    expect(compact).toEqual(original)
  })

  test.each(['input', 'reset'])('%s rejects corrupt references without changing the source', owner => {
    const compact = section()
    compact.intelligence = compactSectionInsightDisplay(compact)
    compact.intelligence.displayProjection.generatedInsight.sectionsReference.hash = 'a'.repeat(64)
    const original = copy(compact)
    expect(() => prepare(owner, compact)).toThrow(expect.objectContaining({ code: 'SECTION_DISPLAY_REFERENCE_INVALID' }))
    expect(compact).toEqual(original)
  })

  test.each(['input', 'reset'])('%s preserves the strict bound when archived history cannot fit', owner => {
    const compact = section()
    compact.intelligence = compactSectionInsightDisplay(compact)
    while (Buffer.byteLength(JSON.stringify(compact)) < 255 * 1024) {
      compact.revisions.push({ generated: { content: 'x'.repeat(1000) } })
    }
    expect(isBoundedRuntimeSectionDetail(compact)).toBe(true)
    const original = copy(compact), result = prepare(owner, compact)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(256 * 1024)
    expect(isBoundedRuntimeSectionDetail(result)).toBe(false)
    expect(compact).toEqual(original)
    expect(result.revisions.slice(0, -1)).toEqual(original.revisions)
  })

  test('unchanged input and no-truth branches retain their existing cache untouched', () => {
    const compact = section()
    compact.intelligence = compactSectionInsightDisplay(compact)
    const unchanged = __testables.buildSectionRootWriteValue({ previousRawValue: compact, runtimePath,
      sectionKey, value: compact.input })
    expect(unchanged).toEqual(compact)
    const empty = { ...compact, generated: null, accepted: null }, original = copy(empty)
    expect(prepare('input', empty).intelligence).toEqual(empty.intelligence)
    expect(prepare('reset', empty)).toBe(empty)
    expect(empty).toEqual(original)
  })
})
