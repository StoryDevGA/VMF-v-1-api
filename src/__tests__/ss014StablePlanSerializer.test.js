import { describe, expect, test } from '@jest/globals'

import {
  SS014_PLAN_ALGORITHM,
  SS014_PLAN_HASH_STATUS,
  SS014_PLAN_RECEIPT_ORDER,
  serializeNormalizedPlan,
} from '../services/ss014StablePlanSerializer.js'

const collectionNames = ['SECTIONS', 'EVIDENCE_SOURCES', 'EVIDENCE_OBJECTS', 'GRAPH_SNAPSHOTS', 'GRAPH_ELEMENTS']

const createPlan = (overrides = {}) => ({
  environmentClass: 'DEVELOPMENT_TEST',
  scopeClass: 'EXACT_SINGLE_RUNTIME',
  rootState: {
    recordCount: 1,
    versionStatus: 'MISSING',
    frameworkStateProjected: false,
  },
  v2Collections: collectionNames.map((name) => ({
    name,
    presence: 'ABSENT',
    scopedCount: 0,
    countStatus: 'NOT_RUN_ABSENT',
    bounded: true,
  })),
  blockers: [],
  readReceipts: SS014_PLAN_RECEIPT_ORDER.map((operation, index) => ({
    operation,
    outcome: index < 2 ? 'READ' : 'ABSENT',
    bounded: true,
  })),
  hashStatus: {
    algorithm: SS014_PLAN_ALGORITHM,
    planHashStatus: SS014_PLAN_HASH_STATUS,
    sourceHashStatus: 'NOT_COMPUTED_BASELINE_MAPPING_REQUIRED',
  },
  ...overrides,
})

const expectRedactionFailure = (callback) => {
  try {
    callback()
    throw new Error('Expected serializer failure.')
  } catch (error) {
    expect(error.code).toBe('SS014_DRY_RUN_REDACTION_FAILED')
  }
}

describe('SS-014 pure normalized-plan serializer', () => {
  test('matches the golden canonical JSON and SHA-256 vector', () => {
    const result = serializeNormalizedPlan(createPlan())

    expect(result).toEqual({
      algorithm: SS014_PLAN_ALGORITHM,
      canonicalJson: '{"blockers":[],"environmentClass":"DEVELOPMENT_TEST","hashStatus":{"algorithm":"stable-json-v1/sha256-utf8-lowerhex","planHashStatus":"PROVISIONAL_NOT_APPLY_AUTHORITY","sourceHashStatus":"NOT_COMPUTED_BASELINE_MAPPING_REQUIRED"},"readReceipts":[{"bounded":true,"operation":"ROOT_CONTROL_FIND","outcome":"READ"},{"bounded":true,"operation":"COLLECTION_LIST","outcome":"READ"},{"bounded":true,"operation":"SECTIONS_FIND","outcome":"ABSENT"},{"bounded":true,"operation":"EVIDENCE_SOURCES_FIND","outcome":"ABSENT"},{"bounded":true,"operation":"EVIDENCE_OBJECTS_FIND","outcome":"ABSENT"},{"bounded":true,"operation":"GRAPH_SNAPSHOTS_FIND","outcome":"ABSENT"},{"bounded":true,"operation":"GRAPH_ELEMENTS_FIND","outcome":"ABSENT"}],"rootState":{"frameworkStateProjected":false,"recordCount":1,"versionStatus":"MISSING"},"scopeClass":"EXACT_SINGLE_RUNTIME","v2Collections":[{"bounded":true,"countStatus":"NOT_RUN_ABSENT","name":"SECTIONS","presence":"ABSENT","scopedCount":0},{"bounded":true,"countStatus":"NOT_RUN_ABSENT","name":"EVIDENCE_SOURCES","presence":"ABSENT","scopedCount":0},{"bounded":true,"countStatus":"NOT_RUN_ABSENT","name":"EVIDENCE_OBJECTS","presence":"ABSENT","scopedCount":0},{"bounded":true,"countStatus":"NOT_RUN_ABSENT","name":"GRAPH_SNAPSHOTS","presence":"ABSENT","scopedCount":0},{"bounded":true,"countStatus":"NOT_RUN_ABSENT","name":"GRAPH_ELEMENTS","presence":"ABSENT","scopedCount":0}]}',
      planHash: '9995d8c6ec3ad5158390a79b5f8811f1f738a13f0521dfa8ce5377dfdc8fde4b',
      planHashStatus: SS014_PLAN_HASH_STATUS,
    })
  })

  test('rejects physical collection names and raw identifier-shaped values', () => {
    expectRedactionFailure(() => serializeNormalizedPlan(createPlan({
      v2Collections: collectionNames.map((name, index) => ({
        ...createPlan().v2Collections[index],
        name: index === 0 ? 'runtime_section_states' : name,
      })),
    })))
  })

  test('rejects extra keys, accessors, symbols, sparse arrays and descriptor drift', () => {
    const extra = createPlan()
    extra.extra = true
    expect(() => serializeNormalizedPlan(extra)).toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const accessor = createPlan()
    Object.defineProperty(accessor, 'environmentClass', {
      configurable: true,
      enumerable: true,
      get: () => 'DEVELOPMENT_TEST',
    })
    expect(() => serializeNormalizedPlan(accessor)).toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const withSymbol = createPlan()
    withSymbol[Symbol('unexpected')] = true
    expect(() => serializeNormalizedPlan(withSymbol)).toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const sparse = createPlan()
    delete sparse.v2Collections[0]
    expect(() => serializeNormalizedPlan(sparse)).toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const nestedAccessor = createPlan()
    Object.defineProperty(nestedAccessor.rootState, 'versionStatus', {
      configurable: true,
      enumerable: true,
      get: () => 'MISSING',
    })
    expect(() => serializeNormalizedPlan(nestedAccessor)).toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const revoked = Proxy.revocable(createPlan(), {})
    revoked.revoke()
    expectRedactionFailure(() => serializeNormalizedPlan(revoked.proxy))

    const nestedRevoked = createPlan()
    const nestedProxy = Proxy.revocable(nestedRevoked.rootState, {})
    nestedProxy.revoke()
    nestedRevoked.rootState = nestedProxy.proxy
    expectRedactionFailure(() => serializeNormalizedPlan(nestedRevoked))

    const revokedArray = createPlan()
    const arrayProxy = Proxy.revocable(revokedArray.v2Collections, {})
    arrayProxy.revoke()
    revokedArray.v2Collections = arrayProxy.proxy
    expectRedactionFailure(() => serializeNormalizedPlan(revokedArray))

    const frozen = Object.freeze(createPlan())
    expect(() => serializeNormalizedPlan(frozen)).toThrow('SS014_DRY_RUN_REDACTION_FAILED')
  })

  test('rejects unsafe scalar values and contradictory cross-field state', () => {
    expect(() => serializeNormalizedPlan(createPlan({
      rootState: { recordCount: 1, versionStatus: 'MISSING', frameworkStateProjected: true },
    }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')
    expect(() => serializeNormalizedPlan(createPlan({
      v2Collections: createPlan().v2Collections.map((entry, index) => index === 0
        ? { ...entry, presence: 'PRESENT', countStatus: 'CAP_EXCEEDED', scopedCount: 1000 }
        : entry),
    }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')
    expect(() => serializeNormalizedPlan(createPlan({ rootState: {
      recordCount: Number.MAX_SAFE_INTEGER + 1,
      versionStatus: 'MISSING',
      frameworkStateProjected: false,
    } }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')
    expect(() => serializeNormalizedPlan(createPlan({ rootState: {
      recordCount: -0,
      versionStatus: 'MISSING',
      frameworkStateProjected: false,
    } }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')
    expect(() => serializeNormalizedPlan(createPlan({ rootState: {
      recordCount: Number.NaN,
      versionStatus: 'MISSING',
      frameworkStateProjected: false,
    } }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')
    expect(() => serializeNormalizedPlan(createPlan({ rootState: null }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')
    expect(() => serializeNormalizedPlan(createPlan({ scopeClass: 'EXACT_SINGLE_RUNTIME\u0001' }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')
    expect(() => serializeNormalizedPlan(createPlan({ scopeClass: 'EXACT_SINGLE_RUNTIME\uD800' }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    for (const value of [Infinity, -Infinity, 1.5, undefined, 1n, Symbol('invalid'), () => {}, new Number(1), new Date(), Buffer.from('x')]) {
      expectRedactionFailure(() => serializeNormalizedPlan(createPlan({
        rootState: { recordCount: value, versionStatus: 'MISSING', frameworkStateProjected: false },
      })))
    }

    const customPrototype = createPlan()
    customPrototype.rootState = Object.create({ inherited: true })
    Object.assign(customPrototype.rootState, {
      recordCount: 1,
      versionStatus: 'MISSING',
      frameworkStateProjected: false,
    })
    expectRedactionFailure(() => serializeNormalizedPlan(customPrototype))
  })

  test('rejects cardinality, position, vocabulary and property-shape drift', () => {
    expect(() => serializeNormalizedPlan(createPlan({ v2Collections: createPlan().v2Collections.slice(0, 4) })))
      .toThrow('SS014_DRY_RUN_REDACTION_FAILED')
    expect(() => serializeNormalizedPlan(createPlan({
      v2Collections: [createPlan().v2Collections[1], ...createPlan().v2Collections.slice(0, 1), ...createPlan().v2Collections.slice(2)],
    }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')
    expect(() => serializeNormalizedPlan(createPlan({
      readReceipts: createPlan().readReceipts.map((entry, index) => index === 0
        ? { ...entry, operation: 'COLLECTION_LIST' }
        : entry),
    }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')
    expect(() => serializeNormalizedPlan(createPlan({
      blockers: [{ code: 'not-a-governed-code', severity: 'BLOCKER' }],
    }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const hidden = createPlan()
    Object.defineProperty(hidden, 'hidden', { configurable: true, enumerable: false, value: true })
    expect(() => serializeNormalizedPlan(hidden)).toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const extraArrayProperty = createPlan()
    extraArrayProperty.v2Collections.extra = true
    expect(() => serializeNormalizedPlan(extraArrayProperty)).toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const numericExtraArrayProperty = createPlan()
    Object.defineProperty(numericExtraArrayProperty.v2Collections, '01', {
      configurable: true,
      enumerable: true,
      value: numericExtraArrayProperty.v2Collections[0],
      writable: true,
    })
    expect(() => serializeNormalizedPlan(numericExtraArrayProperty)).toThrow('SS014_DRY_RUN_REDACTION_FAILED')
  })

  test('sorts blockers canonically and remains repeatable across input key order', () => {
    const first = createPlan({ blockers: [
      { code: 'SS014_DRY_RUN_TIMEOUT', severity: 'BLOCKER' },
      { code: 'SS014_DRY_RUN_BASELINE_MAPPING_REQUIRED', severity: 'BLOCKER' },
    ] })
    const second = createPlan({
      hashStatus: { ...createPlan().hashStatus },
      blockers: [...first.blockers].reverse(),
    })
    expect(serializeNormalizedPlan(first)).toEqual(serializeNormalizedPlan(second))
    expect(() => serializeNormalizedPlan(createPlan({ blockers: [
      { code: 'SS014_DRY_RUN_TIMEOUT', severity: 'BLOCKER' },
      { code: 'SS014_DRY_RUN_TIMEOUT', severity: 'BLOCKER' },
    ] }))).toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    expectRedactionFailure(() => serializeNormalizedPlan(createPlan({
      readReceipts: createPlan().readReceipts.slice(0, 6),
    })))
    expectRedactionFailure(() => serializeNormalizedPlan(createPlan({
      v2Collections: createPlan().v2Collections.map((entry, index) => index === 0
        ? { ...entry, presence: 'PRESENT', countStatus: 'EXACT', scopedCount: 0 }
        : entry),
      readReceipts: createPlan().readReceipts.map((entry, index) => index === 2
        ? { ...entry, outcome: 'ABSENT' }
        : entry),
    })))
  })

  test('canonicalizes reordered plan keys and rejects nested property/status drift', () => {
    const plan = createPlan()
    const reordered = {
      hashStatus: plan.hashStatus,
      readReceipts: plan.readReceipts,
      blockers: plan.blockers,
      v2Collections: plan.v2Collections,
      rootState: plan.rootState,
      scopeClass: plan.scopeClass,
      environmentClass: plan.environmentClass,
    }
    expect(serializeNormalizedPlan(reordered)).toEqual(serializeNormalizedPlan(plan))

    const invalidReceipt = createPlan()
    invalidReceipt.readReceipts[2] = {
      ...invalidReceipt.readReceipts[2],
      outcome: 'NOT_A_RECEIPT',
    }
    expectRedactionFailure(() => serializeNormalizedPlan(invalidReceipt))

    const nestedHidden = createPlan()
    Object.defineProperty(nestedHidden.rootState, 'hidden', {
      configurable: true,
      enumerable: false,
      value: true,
    })
    expectRedactionFailure(() => serializeNormalizedPlan(nestedHidden))

    const nestedSymbol = createPlan()
    nestedSymbol.rootState[Symbol('nested')] = true
    expectRedactionFailure(() => serializeNormalizedPlan(nestedSymbol))

    const nestedExtra = createPlan()
    nestedExtra.rootState.extra = true
    expectRedactionFailure(() => serializeNormalizedPlan(nestedExtra))

    const tooManyCollections = createPlan()
    tooManyCollections.v2Collections = [...tooManyCollections.v2Collections, tooManyCollections.v2Collections[0]]
    expectRedactionFailure(() => serializeNormalizedPlan(tooManyCollections))

    const tooManyReceipts = createPlan()
    tooManyReceipts.readReceipts = [...tooManyReceipts.readReceipts, tooManyReceipts.readReceipts[0]]
    expectRedactionFailure(() => serializeNormalizedPlan(tooManyReceipts))

    const prefixKey = createPlan()
    prefixKey.a = true
    expectRedactionFailure(() => serializeNormalizedPlan(prefixKey))

    const escapedKey = createPlan()
    escapedKey['quote"slash\\'] = true
    expectRedactionFailure(() => serializeNormalizedPlan(escapedKey))
  })
})
