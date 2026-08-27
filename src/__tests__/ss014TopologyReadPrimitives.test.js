import { describe, expect, jest, test } from '@jest/globals'
import { readFileSync } from 'node:fs'

import { createSs014TopologyReadPrimitives } from '../services/ss014TopologyReadPrimitives.js'

const ID_PATTERN = /^[0-9a-f]{24}$/

class FakeObjectId {
  constructor(value) {
    this.value = value
  }
}

const createAdapter = (overrides = {}) => ({
  isValidLowerHexId: (value) => typeof value === 'string' && ID_PATTERN.test(value),
  fromLowerHexId: (value) => new FakeObjectId(value),
  isOpaqueObjectId: (value) => value instanceof FakeObjectId,
  toLowerHexId: (value) => value.value,
  ...overrides,
})

const createScope = (overrides = {}) => ({
  schemaVersion: 'ss014-scope-v1',
  environmentClass: 'DEVELOPMENT_TEST',
  customerId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  runtimeId: 'cccccccccccccccccccccccc',
  ...overrides,
})

const createPrimitives = ({ scope = createScope(), adapter = createAdapter(), now = () => 1000 } = {}) => (
  createSs014TopologyReadPrimitives({
    scope,
    objectIdAdapter: adapter,
    clock: { now },
  })
)

describe('SS-014 topology read primitives', () => {
  test('builds the exact ID-selected root query without framework_state', () => {
    const primitives = createPrimitives()
    const query = primitives.rootQuery()

    expect(primitives.databaseName).toBe('test')
    expect(query.collection).toBe('runtime_instances')
    expect(Object.keys(query.filter)).toEqual(['_id', 'customerId', 'tenantId'])
    expect(query.options).toEqual({ limit: 2, batchSize: 100, maxTimeMS: 2000 })
    expect(query.projection).toEqual({
      _id: 1,
      runtimeInstanceKey: 1,
      customerId: 1,
      tenantId: 1,
      workspaceId: 1,
      runtimeType: 1,
      frameworkKey: 1,
      packageId: 1,
      packageKey: 1,
      packageVersion: 1,
      dependencyLockId: 1,
      activationId: 1,
      deploymentId: 1,
      'evidence.dependencySnapshotId': 1,
      'evidence.dependencySnapshotHash': 1,
      status: 1,
      executionStatus: 1,
      runtimeMode: 1,
      name: 1,
      description: 1,
      lockedAt: 1,
      lockedBy: 1,
      lockedReason: 1,
      'revision.revisionNumber': 1,
      stateVersion: 1,
      runtimeStateVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    expect(Object.prototype.hasOwnProperty.call(query.projection, 'framework_state')).toBe(false)
  })

  test('builds the exact key-selected root filter without selector precedence', () => {
    const primitives = createPrimitives({
      scope: {
        schemaVersion: 'ss014-scope-v1',
        environmentClass: 'DEVELOPMENT_TEST',
        customerId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        runtimeKey: 'value-narrative-82ae435990f9',
      },
    })
    const filter = primitives.buildRootFilter()

    expect(Object.keys(filter)).toEqual(['runtimeInstanceKey', 'customerId', 'tenantId'])
    expect(filter.runtimeInstanceKey).toBe('value-narrative-82ae435990f9')
  })

  test('binds every child query to the opaque root identity and scope', () => {
    const toLowerHexId = jest.fn((value) => value.value)
    const primitives = createPrimitives({
      adapter: createAdapter({ toLowerHexId }),
    })
    const rootId = new FakeObjectId('dddddddddddddddddddddddd')
    const filter = primitives.buildChildFilter(rootId)
    const query = primitives.childQuery('GRAPH_ELEMENTS', rootId)

    expect(toLowerHexId).toHaveBeenCalledTimes(2)
    expect(filter.runtimeInstanceId).toBe(rootId)
    expect(Object.keys(filter)).toEqual(['runtimeInstanceId', 'customerId', 'tenantId'])
    expect(query.collection).toBe('runtime_graph_elements')
    expect(query.projection).toEqual({
      _id: 1,
      runtimeInstanceId: 1,
      customerId: 1,
      tenantId: 1,
    })
    expect(query.options).toEqual({ limit: 1001, batchSize: 100, maxTimeMS: 2000 })
  })

  test('uses one exact fixed-name collection-presence command descriptor', () => {
    const query = createPrimitives().collectionPresenceQuery('SECTIONS')

    expect(query).toEqual({
      collection: 'runtime_section_states',
      options: { maxTimeMS: 2000 },
    })
    expect(createPrimitives().collectionPresenceQuery('UNEXPECTED')).toEqual({
      status: 'INCOMPLETE',
      errorCode: 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE',
      plan: null,
      planHash: null,
    })
  })

  test('rejects invalid scope, dependency shape and opaque identity results', () => {
    expect(() => createPrimitives({
      scope: createScope({ environmentClass: 'PRODUCTION' }),
    })).toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    expect(() => createSs014TopologyReadPrimitives({
      scope: createScope(),
      objectIdAdapter: { ...createAdapter(), extra: true },
      clock: { now: () => 1000 },
    })).toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const primitives = createPrimitives()
    expect(primitives.childQuery('SECTIONS', { value: 'dddddddddddddddddddddddd' })).toEqual({
      status: 'INCOMPLETE',
      errorCode: 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE',
      plan: null,
      planHash: null,
    })
  })

  test('rejects unsafe outer, scope and dependency descriptors', () => {
    const baseInput = {
      scope: createScope(),
      objectIdAdapter: createAdapter(),
      clock: { now: () => 1000 },
    }

    const customPrototype = Object.create({ inherited: true })
    Object.assign(customPrototype, baseInput)
    expect(() => createSs014TopologyReadPrimitives(customPrototype))
      .toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const symbolInput = { ...baseInput, [Symbol('unexpected')]: true }
    expect(() => createSs014TopologyReadPrimitives(symbolInput))
      .toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const nonEnumerableInput = { ...baseInput }
    Object.defineProperty(nonEnumerableInput, 'extra', {
      configurable: true,
      enumerable: false,
      value: true,
    })
    expect(() => createSs014TopologyReadPrimitives(nonEnumerableInput))
      .toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const accessorInput = { ...baseInput }
    Object.defineProperty(accessorInput, 'clock', {
      configurable: true,
      enumerable: true,
      get: () => ({ now: () => 1000 }),
    })
    expect(() => createSs014TopologyReadPrimitives(accessorInput))
      .toThrow('SS014_DRY_RUN_REDACTION_FAILED')

    const symbolScope = createScope()
    symbolScope[Symbol('unexpected')] = true
    expect(() => createPrimitives({ scope: symbolScope }))
      .toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const prototypeScope = Object.create({ inherited: true })
    Object.assign(prototypeScope, createScope())
    expect(() => createPrimitives({ scope: prototypeScope }))
      .toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const nonEnumerableScope = createScope()
    Object.defineProperty(nonEnumerableScope, 'customerId', {
      configurable: true,
      enumerable: false,
      value: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    })
    expect(() => createPrimitives({ scope: nonEnumerableScope }))
      .toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const accessorScope = createScope()
    Object.defineProperty(accessorScope, 'runtimeId', {
      configurable: true,
      enumerable: true,
      get: () => 'cccccccccccccccccccccccc',
    })
    expect(() => createPrimitives({ scope: accessorScope }))
      .toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const adapterVariants = [
      { isValidLowerHexId: () => { throw new Error('invalid') } },
      { isValidLowerHexId: () => Promise.resolve(true) },
      { fromLowerHexId: () => { throw new Error('conversion') } },
      { fromLowerHexId: () => Promise.resolve(new FakeObjectId('aaaaaaaaaaaaaaaaaaaaaaaa')) },
      { isOpaqueObjectId: () => { throw new Error('opaque') } },
      { isOpaqueObjectId: () => Promise.resolve(true) },
      { isOpaqueObjectId: () => false },
    ]

    for (const overrides of adapterVariants) {
      expect(() => createPrimitives({ adapter: createAdapter(overrides) }))
        .toThrow('SS014_DRY_RUN_SCOPE_INVALID')
    }
  })

  test('rejects unsafe nested adapter and clock records', () => {
    const adapterPrototype = Object.create({ inherited: true })
    Object.assign(adapterPrototype, createAdapter())
    expect(() => createPrimitives({ adapter: adapterPrototype }))
      .toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const adapterSymbol = { ...createAdapter(), [Symbol('unexpected')]: true }
    expect(() => createPrimitives({ adapter: adapterSymbol }))
      .toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const adapterNonEnumerable = createAdapter()
    Object.defineProperty(adapterNonEnumerable, 'extra', {
      configurable: true,
      enumerable: false,
      value: true,
    })
    expect(() => createPrimitives({ adapter: adapterNonEnumerable }))
      .toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const adapterAccessor = createAdapter()
    Object.defineProperty(adapterAccessor, 'toLowerHexId', {
      configurable: true,
      enumerable: true,
      get: () => (value) => value.value,
    })
    expect(() => createPrimitives({ adapter: adapterAccessor }))
      .toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const clockPrototype = Object.create({ inherited: true })
    Object.assign(clockPrototype, { now: () => 1000 })
    expect(() => createSs014TopologyReadPrimitives({
      scope: createScope(),
      objectIdAdapter: createAdapter(),
      clock: clockPrototype,
    })).toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const clockSymbol = { now: () => 1000, [Symbol('unexpected')]: true }
    expect(() => createSs014TopologyReadPrimitives({
      scope: createScope(),
      objectIdAdapter: createAdapter(),
      clock: clockSymbol,
    })).toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const clockNonEnumerable = { now: () => 1000 }
    Object.defineProperty(clockNonEnumerable, 'extra', {
      configurable: true,
      enumerable: false,
      value: true,
    })
    expect(() => createSs014TopologyReadPrimitives({
      scope: createScope(),
      objectIdAdapter: createAdapter(),
      clock: clockNonEnumerable,
    })).toThrow('SS014_DRY_RUN_SCOPE_INVALID')

    const clockAccessor = {}
    Object.defineProperty(clockAccessor, 'now', {
      configurable: true,
      enumerable: true,
      get: () => () => 1000,
    })
    expect(() => createSs014TopologyReadPrimitives({
      scope: createScope(),
      objectIdAdapter: createAdapter(),
      clock: clockAccessor,
    })).toThrow('SS014_DRY_RUN_SCOPE_INVALID')
  })

  test('records the production primitive no-I/O source boundary explicitly', () => {
    const source = readFileSync(
      new URL('../services/ss014TopologyReadPrimitives.js', import.meta.url),
      'utf8',
    )
    const forbiddenPatterns = [
      'import ',
      'from ',
      'mongoose',
      'MongoDB',
      'mongodb',
      'connectDb',
      'fetch(',
      'fs.',
      'process.',
      'child_process',
      'net.',
      'http.',
    ]

    for (const pattern of forbiddenPatterns) {
      expect(source).not.toContain(pattern)
    }
  })

  test('rejects thrown, Promise-like and noncanonical child identity conversions', () => {
    const thrown = createPrimitives({
      adapter: createAdapter({ toLowerHexId: () => { throw new Error('identity') } }),
    })
    const promised = createPrimitives({
      adapter: createAdapter({ toLowerHexId: () => Promise.resolve('dddddddddddddddddddddddd') }),
    })
    const uppercase = createPrimitives({
      adapter: createAdapter({ toLowerHexId: () => 'DDDDDDDDDDDDDDDDDDDDDDDD' }),
    })
    const rootId = new FakeObjectId('dddddddddddddddddddddddd')

    for (const primitives of [thrown, promised, uppercase]) {
      expect(primitives.buildChildFilter(rootId)).toEqual({
        status: 'INCOMPLETE',
        errorCode: 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE',
        plan: null,
        planHash: null,
      })
    }
  })

  test('rejects physical labels, malformed root identities and extra method arguments', () => {
    const primitives = createPrimitives()
    const rootId = new FakeObjectId('dddddddddddddddddddddddd')

    expect(primitives.childQuery('runtime_graph_elements', rootId).errorCode)
      .toBe('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE')
    expect(primitives.childQuery('GRAPH_ELEMENTS', { value: 'dddddddddddddddddddddddd' }).errorCode)
      .toBe('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE')
    expect(primitives.rootQuery('unexpected').errorCode).toBe('SS014_DRY_RUN_REDACTION_FAILED')
    expect(primitives.makeIncompleteResult()).toEqual({
      status: 'INCOMPLETE',
      errorCode: 'SS014_DRY_RUN_REDACTION_FAILED',
      plan: null,
      planHash: null,
    })
  })

  test('creates monotonic deadlines and fails closed on clock faults', () => {
    const values = [1000, 1001, 2999, 3000]
    const primitives = createPrimitives({ now: () => values.shift() })
    const deadline = primitives.createDeadline()

    expect(deadline).toMatchObject({ status: 'READY', startedAt: 1000, expiresAt: 3000 })
    expect(deadline.check()).toEqual({ status: 'OPEN' })
    expect(deadline.check()).toEqual({ status: 'OPEN' })
    expect(deadline.check()).toEqual({
      status: 'INCOMPLETE',
      errorCode: 'SS014_DRY_RUN_TIMEOUT',
      plan: null,
      planHash: null,
    })

    const backwards = createPrimitives({ now: (() => {
      const next = [1000, 999]
      return () => next.shift()
    })() }).createDeadline()
    expect(backwards.check().errorCode).toBe('SS014_DRY_RUN_TIMEOUT')

    expect(createPrimitives({ now: () => Number.MAX_SAFE_INTEGER - 1999 }).createDeadline())
      .toEqual({
        status: 'INCOMPLETE',
        errorCode: 'SS014_DRY_RUN_TIMEOUT',
        plan: null,
        planHash: null,
      })
    expect(createPrimitives({ now: () => Promise.resolve(1000) }).createDeadline().errorCode)
      .toBe('SS014_DRY_RUN_TIMEOUT')

    expect(createPrimitives({ now: () => { throw new Error('clock') } }).createDeadline().errorCode)
      .toBe('SS014_DRY_RUN_TIMEOUT')
    expect(createPrimitives({ now: () => -1 }).createDeadline().errorCode)
      .toBe('SS014_DRY_RUN_TIMEOUT')
    expect(createPrimitives({ now: () => 1.5 }).createDeadline().errorCode)
      .toBe('SS014_DRY_RUN_TIMEOUT')

    const thrownOnCheck = (() => {
      let count = 0
      return createPrimitives({
        now: () => {
          count += 1
          if (count === 1) return 1000
          throw new Error('clock')
        },
      }).createDeadline()
    })()
    expect(thrownOnCheck.check().errorCode).toBe('SS014_DRY_RUN_TIMEOUT')

    const promisedOnCheck = (() => {
      let count = 0
      return createPrimitives({
        now: () => {
          count += 1
          return count === 1 ? 1000 : Promise.resolve(1001)
        },
      }).createDeadline()
    })()
    expect(promisedOnCheck.check().errorCode).toBe('SS014_DRY_RUN_TIMEOUT')
  })

  test('accepts only the fixed redacted incomplete-result error vocabulary', () => {
    const primitives = createPrimitives()

    expect(primitives.makeIncompleteResult('SS014_DRY_RUN_BASELINE_MAPPING_REQUIRED')).toEqual({
      status: 'INCOMPLETE',
      errorCode: 'SS014_DRY_RUN_BASELINE_MAPPING_REQUIRED',
      plan: null,
      planHash: null,
    })
    expect(primitives.makeIncompleteResult('NOT_A_REAL_CODE')).toEqual({
      status: 'INCOMPLETE',
      errorCode: 'SS014_DRY_RUN_REDACTION_FAILED',
      plan: null,
      planHash: null,
    })
  })

  test('freezes the returned specs and does not expose mutable physical arrays', () => {
    const primitives = createPrimitives()
    const presenceQuery = primitives.collectionPresenceQuery('SECTIONS')
    const rootQuery = primitives.rootQuery()
    const childQuery = primitives.childQuery('SECTIONS', new FakeObjectId('dddddddddddddddddddddddd'))

    expect(Object.isFrozen(primitives)).toBe(true)
    expect(Object.isFrozen(presenceQuery)).toBe(true)
    expect(Object.isFrozen(presenceQuery.options)).toBe(true)
    expect(Object.isFrozen(rootQuery.projection)).toBe(true)
    expect(Object.isFrozen(rootQuery.filter)).toBe(true)
    expect(Object.isFrozen(rootQuery.options)).toBe(true)
    expect(Object.isFrozen(childQuery)).toBe(true)
    expect(Object.isFrozen(childQuery.filter)).toBe(true)
    expect(Object.isFrozen(childQuery.projection)).toBe(true)
    expect(Object.isFrozen(childQuery.options)).toBe(true)
    expect(() => {
      presenceQuery.options.maxTimeMS = 1
    }).toThrow()
  })

  test('freezes deadline and incomplete-result evidence', () => {
    const ready = createPrimitives().createDeadline()
    const open = ready.check()
    const timeoutDeadline = (() => {
      const values = [1000, 3000]
      return createPrimitives({ now: () => values.shift() }).createDeadline()
    })()
    const incomplete = timeoutDeadline.check()
    const manualIncomplete = createPrimitives().makeIncompleteResult('SS014_DRY_RUN_TIMEOUT')

    expect(Object.isFrozen(ready)).toBe(true)
    expect(Object.isFrozen(open)).toBe(true)
    expect(Object.isFrozen(incomplete)).toBe(true)
    expect(Object.isFrozen(manualIncomplete)).toBe(true)
    expect(() => {
      ready.status = 'BROKEN'
    }).toThrow()
    expect(() => {
      open.status = 'BROKEN'
    }).toThrow()
    expect(() => {
      manualIncomplete.errorCode = 'BROKEN'
    }).toThrow()
    expect(() => {
      incomplete.errorCode = 'BROKEN'
    }).toThrow()
  })
})
