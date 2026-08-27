import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveSs014NativeCollectionAdmission } from '../services/ss014NativeCollectionCapBoundary.js'

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const servicePath = resolve(apiRoot, 'src/services/ss014NativeCollectionCapBoundary.js')

const names = [
  'SECTIONS',
  'EVIDENCE_SOURCES',
  'EVIDENCE_OBJECTS',
  'GRAPH_SNAPSHOTS',
  'GRAPH_ELEMENTS',
]

const input = (overrides = {}) => ({
  bounded: true,
  countStatus: 'EXACT',
  name: 'SECTIONS',
  presence: 'PRESENT',
  scopedCount: 0,
  ...overrides,
})

const incomplete = (errorCode = 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE') => ({
  status: 'INCOMPLETE',
  errorCode,
  plan: null,
  planHash: null,
})

describe('resolveSs014NativeCollectionAdmission', () => {
  test('exports exactly the intended named helper', async () => {
    const module = await import('../services/ss014NativeCollectionCapBoundary.js')
    expect(Object.keys(module)).toEqual(['resolveSs014NativeCollectionAdmission'])
  })

  test.each(names)('admits every logical collection name: %s', (name) => {
    expect(resolveSs014NativeCollectionAdmission(input({ name }))).toEqual({
      status: 'READY',
      collection: input({ name }),
    })
  })

  test('admits the absent sentinel only at zero', () => {
    expect(resolveSs014NativeCollectionAdmission(input({
      presence: 'ABSENT',
      countStatus: 'NOT_RUN_ABSENT',
      scopedCount: 0,
    }))).toEqual({
      status: 'READY',
      collection: input({
        presence: 'ABSENT',
        countStatus: 'NOT_RUN_ABSENT',
        scopedCount: 0,
      }),
    })
    expect(resolveSs014NativeCollectionAdmission(input({
      presence: 'ABSENT',
      countStatus: 'NOT_RUN_ABSENT',
      scopedCount: 1,
    }))).toEqual(incomplete())
  })

  test.each([0, 1000])('admits exact present count %s', (scopedCount) => {
    expect(resolveSs014NativeCollectionAdmission(input({ scopedCount }))).toEqual({
      status: 'READY',
      collection: input({ scopedCount }),
    })
  })

  test.each([
    { countStatus: 'CAP_EXCEEDED', scopedCount: 1001 },
    { countStatus: 'CAP_EXCEEDED', scopedCount: 0 },
    { countStatus: 'READ_FAILED', scopedCount: 0 },
    { countStatus: 'READ_FAILED', scopedCount: 1001 },
    { presence: 'ABSENT', countStatus: 'EXACT', scopedCount: 0 },
    { presence: 'PRESENT', countStatus: 'NOT_RUN_ABSENT', scopedCount: 0 },
    { presence: 'ABSENT', countStatus: 'CAP_EXCEEDED', scopedCount: 1001 },
  ])('fails closed for unavailable or contradictory state %#', (overrides) => {
    expect(resolveSs014NativeCollectionAdmission(input(overrides))).toEqual(incomplete())
  })

  test.each([
    { bounded: false },
    { name: 'UNKNOWN' },
    { presence: 'UNKNOWN' },
    { countStatus: 'UNKNOWN' },
    { scopedCount: -1 },
    { scopedCount: 1001 },
    { scopedCount: Number.MAX_SAFE_INTEGER + 1 },
    { scopedCount: 1.5 },
    { scopedCount: '0' },
  ])('fails closed for invalid semantic state %#', (overrides) => {
    expect(resolveSs014NativeCollectionAdmission(input(overrides))).toEqual(incomplete())
  })

  test.each([
    null,
    undefined,
    [],
    Object.create({ inherited: true }),
    { ...input(), extra: true },
  ])('redacts malformed record descriptors: %p', (value) => {
    expect(resolveSs014NativeCollectionAdmission(value)).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))
  })

  test('redacts symbols, non-enumerables and accessors', () => {
    const withSymbol = input()
    withSymbol[Symbol('extra')] = true
    expect(resolveSs014NativeCollectionAdmission(withSymbol)).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))

    const withNonEnumerable = input()
    Object.defineProperty(withNonEnumerable, 'extra', { value: true })
    expect(resolveSs014NativeCollectionAdmission(withNonEnumerable)).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))

    const withAccessor = input()
    Object.defineProperty(withAccessor, 'scopedCount', {
      configurable: true,
      enumerable: true,
      get: () => 0,
    })
    expect(resolveSs014NativeCollectionAdmission(withAccessor)).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))
  })

  test('accepts a null-prototype record without retaining or mutating it', () => {
    const value = Object.assign(Object.create(null), input({ name: 'GRAPH_ELEMENTS', scopedCount: 1000 }))
    const snapshot = { ...value }
    const result = resolveSs014NativeCollectionAdmission(value)

    expect(result).toEqual({ status: 'READY', collection: snapshot })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.collection)).toBe(true)
    expect(value).toEqual(snapshot)
    expect(result.collection).not.toBe(value)
  })

  test('contains no imports or external I/O', async () => {
    const source = await readFile(servicePath, 'utf8')
    expect(source).not.toMatch(/\bimport\s/)
    expect(source).not.toMatch(/\b(?:require|fetch|mongoose|MongoClient|setTimeout|setInterval)\b/)
  })
})
