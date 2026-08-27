import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { runSs014NativeReadSessionRunnerV2 } from '../services/ss014NativeReadSessionRunnerV2.js'
import { createSs014TopologyReadPrimitives } from '../services/ss014TopologyReadPrimitives.js'

const CUSTOMER_ID = '507f1f77bcf86cd799439011'
const TENANT_ID = '507f1f77bcf86cd799439012'
const RUNTIME_ID = '507f1f77bcf86cd799439013'
const RUNTIME_KEY = 'value-narrative-82ae435990f9'

const makeObjectIdAdapter = () => ({
  isValidLowerHexId: (value) => typeof value === 'string' && /^[0-9a-f]{24}$/.test(value),
  fromLowerHexId: (value) => ({ hex: value }),
  isOpaqueObjectId: (value) => value !== null && typeof value === 'object' && typeof value.hex === 'string',
  toLowerHexId: (value) => value.hex,
})

const makeClock = () => ({ now: jest.fn(() => 0) })

const makeGuard = (initial = true) => {
  let current = initial
  return {
    read: jest.fn(() => current),
    setFalse: jest.fn(() => { current = false }),
    restore: jest.fn((previous) => { current = previous }),
  }
}

const makeCursor = (rows, emit = () => {}) => {
  let index = 0
  const cursor = {
    limit: jest.fn(() => cursor),
    batchSize: jest.fn(() => cursor),
    maxTimeMS: jest.fn(() => cursor),
    hasNext: jest.fn(async () => index < rows.length),
    next: jest.fn(async () => {
      const row = rows[index]
      index += 1
      return row
    }),
    close: jest.fn(async () => undefined),
  }
  emit(cursor)
  return cursor
}

const makeClient = ({
  collections = {},
  rootRows = [],
  listRows = null,
  commandOverride = null,
  namespaceNotFoundCollections = [],
  commandFailure = null,
} = {}) => {
  const handlers = new Map()
  const database = {
    collection: jest.fn((name) => ({
      find: jest.fn((filter, options) => {
        const command = commandOverride?.(name, 'find', options)
          || { find: true, projection: options.projection }
        ;(handlers.get('commandStarted') || []).forEach((handler) => handler({ commandName: 'find', command }))
        const rows = name === 'runtime_instances' ? rootRows : collections[name] || []
        return makeCursor(rows)
      }),
    })),
    command: jest.fn((command) => {
      ;(handlers.get('commandStarted') || []).forEach((handler) => handler({ commandName: 'collStats', command }))
      const failure = namespaceNotFoundCollections.includes(command.collStats)
        ? { code: 26, codeName: 'NamespaceNotFound' }
        : commandFailure?.(command)
      if (failure) {
        ;(handlers.get('commandFailed') || []).forEach((handler) => handler({ commandName: 'collStats', failure }))
        const error = new Error('command failed')
        error.code = failure.code
        error.codeName = failure.codeName
        return Promise.reject(error)
      }
      const override = commandOverride?.('runtime', 'collStats', command)
      return Promise.resolve(override === undefined ? { ok: 1 } : override)
    }),
    listCollections: jest.fn((filter, options) => {
      const command = commandOverride?.('runtime', 'listCollections', options)
        || { listCollections: true }
      ;(handlers.get('commandStarted') || []).forEach((handler) => handler({ commandName: 'listCollections', command }))
      return makeCursor(listRows || Object.keys(collections).map((name) => ({ name })))
    }),
  }

  const client = {
    options: { monitorCommands: true },
    on: jest.fn((eventName, handler) => {
      const existing = handlers.get(eventName) || []
      handlers.set(eventName, [...existing, handler])
      return client
    }),
    off: jest.fn((eventName, handler) => {
      handlers.set(eventName, (handlers.get(eventName) || []).filter((candidate) => candidate !== handler))
      return client
    }),
    listenerCount: jest.fn((eventName) => (handlers.get(eventName) || []).length),
    connect: jest.fn(async () => {
      ;(handlers.get('commandStarted') || []).forEach((handler) => handler({ commandName: 'hello', command: { hello: 1 } }))
    }),
    db: jest.fn((name) => name === 'test' ? database : null),
    close: jest.fn(async () => {
      ;(handlers.get('commandStarted') || []).forEach((handler) => handler({ commandName: 'endSessions', command: { endSessions: [] } }))
    }),
  }
  return { client, database }
}

const makeInput = (overrides = {}) => {
  const objectIdAdapter = makeObjectIdAdapter()
  const clock = makeClock()
  const primitives = createSs014TopologyReadPrimitives({
    scope: {
      schemaVersion: 'ss014-scope-v1',
      environmentClass: 'DEVELOPMENT_TEST',
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      ...(overrides.scope || { runtimeKey: RUNTIME_KEY }),
    },
    objectIdAdapter,
    clock,
  })
  const root = {
    _id: { hex: RUNTIME_ID },
    runtimeInstanceKey: RUNTIME_KEY,
    customerId: { hex: CUSTOMER_ID },
    tenantId: { hex: TENANT_ID },
    stateVersion: 'rsv2:test-receipt',
    runtimeStateVersion: 'rsv2:test-receipt',
  }
  const collectionNames = [
    'runtime_section_states',
    'runtime_evidence_sources',
    'runtime_evidence_objects',
    'runtime_graph_snapshots',
    'runtime_graph_elements',
  ]
  const collections = Object.fromEntries(collectionNames.map((name) => [name, [{
    runtimeInstanceId: { hex: RUNTIME_ID },
    customerId: { hex: CUSTOMER_ID },
    tenantId: { hex: TENANT_ID },
  }]]))
  const { client } = makeClient({ collections, rootRows: [root] })
  const input = {
    scope: {
      schemaVersion: 'ss014-scope-v1',
      environmentClass: 'DEVELOPMENT_TEST',
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      runtimeKey: RUNTIME_KEY,
    },
    primitives,
    objectIdAdapter,
    environmentGuard: {
      read: jest.fn(() => ({ environmentClass: 'DEVELOPMENT_TEST', isProduction: false, isAppProduction: false })),
    },
    autoCreateGuard: makeGuard(true),
    autoIndexGuard: makeGuard(true),
    clientFactory: jest.fn(() => client),
    clock,
    bsonSizer: jest.fn(() => 10),
    ...overrides,
  }
  return input
}

const expectIncomplete = async (operation, errorCode) => {
  await expect(operation).resolves.toEqual({
    status: 'INCOMPLETE',
    errorCode,
    plan: null,
    planHash: null,
  })
}

afterEach(() => {
  jest.useRealTimers()
})

describe('SS-014 native read-session runner V2', () => {
  test('returns a redacted ready plan input with one-client/one-database binding', async () => {
    const input = makeInput()
    const result = await runSs014NativeReadSessionRunnerV2(input)

    expect(result.status).toBe('READY')
    expect(result.sessionBinding).toBe('ONE_CLIENT_ONE_DATABASE')
    expect(result.planInput.observation.rootState).toEqual({
      recordCount: 1,
      versionStatus: 'CANONICAL',
      frameworkStateProjected: false,
    })
    expect(result.planInput.observation.v2Collections).toHaveLength(5)
    expect(result.planInput.observation.readReceipts).toHaveLength(7)
    expect(result.planInput.execution.monitorInstalledBeforeConnect).toBe(true)
    expect(result.planInput.execution.monitorRemoved).toBe(true)
    expect(result.planInput.execution.cleanDisconnect).toBe(true)
    expect(input.clientFactory).toHaveBeenCalledWith({ monitorCommands: true })
    expect(input.autoCreateGuard.read()).toBe(true)
    expect(input.autoIndexGuard.read()).toBe(true)
  })

  test('uses fixed-name collStats presence reads and never calls listCollections', async () => {
    const input = makeInput()
    const client = input.clientFactory()
    const database = client.db('test')
    database.listCollections = jest.fn(() => {
      throw new Error('listCollections must not be called')
    })
    input.clientFactory = jest.fn(() => client)

    const result = await runSs014NativeReadSessionRunnerV2(input)

    expect(result.status).toBe('READY')
    expect(result.planInput.observation.v2Collections).toHaveLength(5)
    expect(result.planInput.observation.readReceipts).toHaveLength(7)
    expect(database.listCollections).not.toHaveBeenCalled()
    expect(database.command.mock.calls.map(([command]) => command)).toEqual([
      { collStats: 'runtime_section_states', maxTimeMS: 2000 },
      { collStats: 'runtime_evidence_sources', maxTimeMS: 2000 },
      { collStats: 'runtime_evidence_objects', maxTimeMS: 2000 },
      { collStats: 'runtime_graph_snapshots', maxTimeMS: 2000 },
      { collStats: 'runtime_graph_elements', maxTimeMS: 2000 },
    ])
  })

  test('treats a valid empty child result as present with an exact zero count', async () => {
    const input = makeInput()
    const { client, database } = makeClient({
      rootRows: [{
        _id: { hex: RUNTIME_ID },
        runtimeInstanceKey: RUNTIME_KEY,
        customerId: { hex: CUSTOMER_ID },
        tenantId: { hex: TENANT_ID },
        stateVersion: 'rsv2:test-receipt',
        runtimeStateVersion: 'rsv2:test-receipt',
      }],
      collections: Object.fromEntries([
        'runtime_section_states',
        'runtime_evidence_sources',
        'runtime_evidence_objects',
        'runtime_graph_snapshots',
        'runtime_graph_elements',
      ].map((name) => [name, []])),
    })
    input.clientFactory = jest.fn(() => client)

    const result = await runSs014NativeReadSessionRunnerV2(input)

    expect(result.status).toBe('READY')
    expect(result.planInput.observation.v2Collections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'SECTIONS',
        presence: 'PRESENT',
        countStatus: 'EXACT',
        scopedCount: 0,
      }),
    ]))
    expect(database.command).toHaveBeenCalledTimes(5)
  })

  test('fails closed on malformed or unsuccessful collStats responses', async () => {
    for (const response of [null, {}, { ok: 0 }, { ok: '1' }]) {
      const input = makeInput()
      const { client, database } = makeClient({
        commandOverride: (name, operation) => operation === 'collStats' ? response : undefined,
      })
      input.clientFactory = jest.fn(() => client)

      await expectIncomplete(
        runSs014NativeReadSessionRunnerV2(input),
        'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE',
      )
      expect(database.listCollections).not.toHaveBeenCalled()
    }
  })

  test('fails closed on a non-namespace collStats command failure', async () => {
    const input = makeInput()
    const { client } = makeClient({
      rootRows: [{
        _id: { hex: RUNTIME_ID },
        runtimeInstanceKey: RUNTIME_KEY,
        customerId: { hex: CUSTOMER_ID },
        tenantId: { hex: TENANT_ID },
        stateVersion: 'rsv2:test-receipt',
        runtimeStateVersion: 'rsv2:test-receipt',
      }],
      commandFailure: () => ({ code: 50, codeName: 'MaxTimeMSExpired' }),
    })
    input.clientFactory = jest.fn(() => client)

    await expectIncomplete(
      runSs014NativeReadSessionRunnerV2(input),
      'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
    )
  })

  test('fails closed before presence access when the fixed collStats descriptor drifts', async () => {
    const optionVariants = [
      {},
      { maxTimeMS: 1000 },
      { maxTimeMS: 2000, comment: 'unexpected' },
      { maxTimeMS: '2000' },
    ]

    for (const options of optionVariants) {
      const input = makeInput()
      const client = input.clientFactory()
      const database = client.db('test')
      const baseQuery = input.primitives.collectionPresenceQuery('SECTIONS')
      input.primitives = Object.freeze({
        ...input.primitives,
        collectionPresenceQuery: jest.fn(() => Object.freeze({
          ...baseQuery,
          options: Object.freeze(options),
        })),
      })
      input.clientFactory = jest.fn(() => client)

      await expectIncomplete(
        runSs014NativeReadSessionRunnerV2(input),
        'SS014_DRY_RUN_REDACTION_FAILED',
      )
      expect(database.listCollections).not.toHaveBeenCalled()
      expect(database.command).not.toHaveBeenCalled()
    }
  })

  test('continues to require limit on the root find cursor', async () => {
    const input = makeInput()
    const client = input.clientFactory()
    const database = client.db('test')
    const originalCollection = database.collection
    database.collection = jest.fn((name) => {
      const collection = originalCollection(name)
      if (name === 'runtime_instances') {
        const originalFind = collection.find
        collection.find = jest.fn((...args) => {
          const cursor = originalFind(...args)
          delete cursor.limit
          return cursor
        })
      }
      return collection
    })
    input.clientFactory = jest.fn(() => client)

    await expectIncomplete(
      runSs014NativeReadSessionRunnerV2(input),
      'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE',
    )
  })

  test('preserves KEY selector and records absent collections without querying them', async () => {
    const input = makeInput()
    const names = ['runtime_section_states', 'runtime_evidence_sources']
    const client = makeClient({
      rootRows: [{
        _id: { hex: RUNTIME_ID },
        runtimeInstanceKey: RUNTIME_KEY,
        customerId: { hex: CUSTOMER_ID },
        tenantId: { hex: TENANT_ID },
        stateVersion: undefined,
        runtimeStateVersion: undefined,
      }],
      collections: Object.fromEntries(names.map((name) => [name, []])),
      namespaceNotFoundCollections: [
        'runtime_evidence_objects',
        'runtime_graph_snapshots',
        'runtime_graph_elements',
      ],
    }).client
    input.clientFactory = jest.fn(() => client)

    const result = await runSs014NativeReadSessionRunnerV2(input)

    expect(result.status).toBe('READY')
    expect(result.planInput.selector).toBe('KEY')
    expect(result.planInput.observation.rootState.versionStatus).toBe('MISSING')
    expect(result.planInput.observation.v2Collections.filter((entry) => entry.presence === 'ABSENT')).toHaveLength(3)
    expect(client.db('test').collection).not.toHaveBeenCalledWith('runtime_evidence_objects')
  })

  test('fails closed on mixed Option A state versions before dependent reads', async () => {
    const input = makeInput()
    const { client, database } = makeClient({
      rootRows: [{
        _id: { hex: RUNTIME_ID },
        runtimeInstanceKey: RUNTIME_KEY,
        customerId: { hex: CUSTOMER_ID },
        tenantId: { hex: TENANT_ID },
        stateVersion: 'rsv2:a',
        runtimeStateVersion: 'rsv2:b',
      }],
    })
    input.clientFactory = jest.fn(() => client)

    await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), 'SS014_DRY_RUN_STATE_VERSION_MIXED')
    expect(database.listCollections).not.toHaveBeenCalled()
  })

  test('maps a write command observed during the same session to a fixed failure', async () => {
    const input = makeInput()
    const client = makeClient().client
    client.connect = jest.fn(async () => {
      const handlers = client.on.mock.calls
      const commandHandler = handlers.find(([event]) => event === 'commandStarted')?.[1]
      commandHandler({ commandName: 'insert', command: { insert: true } })
    })
    input.clientFactory = jest.fn(() => client)

    await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), 'SS014_DRY_RUN_WRITE_COMMAND_OBSERVED')
    expect(client.db).not.toHaveBeenCalled()
  })

  test('maps commandFailed, unknown command and command-budget failures without opening the database', async () => {
    const cases = [
      ['commandFailed', (handler) => handler({ secret: 'not returned' }), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE'],
      ['unknown', (handler) => handler({ commandName: 'mystery', command: { mystery: true } }), 'SS014_DRY_RUN_UNKNOWN_COMMAND'],
      ['budget', (handler) => {
        for (let index = 0; index < 65; index += 1) handler({ commandName: 'ping', command: { ping: 1 } })
      }, 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE'],
    ]
    for (const [name, emit, errorCode] of cases) {
      const input = makeInput()
      const client = makeClient().client
      client.connect = jest.fn(async () => {
        const commandHandler = client.on.mock.calls.find(([event]) => event === 'commandStarted')?.[1]
        const failureHandler = client.on.mock.calls.find(([event]) => event === 'commandFailed')?.[1]
        if (name === 'commandFailed') emit(failureHandler)
        else emit(commandHandler)
      })
      input.clientFactory = jest.fn(() => client)

      await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), errorCode)
      expect(client.db).not.toHaveBeenCalled()
    }
  })

  test('maps a full-state command projection to a fixed failure', async () => {
    const input = makeInput()
    const { client } = makeClient({
      commandOverride: (name, operation) => operation === 'find' && name === 'runtime_instances'
        ? { find: true, projection: { framework_state: 1 } }
        : undefined,
    })
    input.clientFactory = jest.fn(() => client)

    await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), 'SS014_DRY_RUN_FULL_STATE_BLOCKED')
  })

  test('fails closed on cross-scope child identity and restores both guards', async () => {
    const input = makeInput()
    const client = makeClient({
      collections: {
        runtime_section_states: [{
          runtimeInstanceId: { hex: '507f1f77bcf86cd799439099' },
          customerId: { hex: CUSTOMER_ID },
          tenantId: { hex: TENANT_ID },
        }],
      },
      listRows: [{ name: 'runtime_section_states' }],
    }).client
    input.clientFactory = jest.fn(() => client)

    await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE')
    expect(input.autoCreateGuard.restore).toHaveBeenCalledWith(true)
    expect(input.autoIndexGuard.restore).toHaveBeenCalledWith(true)
  })

  test('closes and removes a listener that was attached before client.on threw', async () => {
    const input = makeInput()
    const client = makeClient().client
    const baseOn = client.on
    client.on = jest.fn(function on(eventName, handler) {
      baseOn.call(client, eventName, handler)
      throw new Error('attach failed after registration')
    })
    input.clientFactory = jest.fn(() => client)

    await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
    expect(client.off).toHaveBeenCalledWith('commandStarted', expect.any(Function))
    expect(client.listenerCount('commandStarted')).toBe(0)
  })

  test('returns the guard error and restores both guards when setup or restoration fails', async () => {
    const input = makeInput()
    input.autoIndexGuard.setFalse = jest.fn(() => { throw new Error('index guard failed') })

    await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), 'SS014_DRY_RUN_AUTO_CREATE_GUARD_UNAVAILABLE')
    expect(input.autoCreateGuard.restore).toHaveBeenCalledWith(true)
    expect(input.autoIndexGuard.restore).toHaveBeenCalledWith(true)

    const restoration = makeInput()
    restoration.autoCreateGuard.restore = jest.fn(() => { throw new Error('restore failed') })
    await expectIncomplete(runSs014NativeReadSessionRunnerV2(restoration), 'SS014_DRY_RUN_AUTO_CREATE_GUARD_UNAVAILABLE')
  })

  test('fails closed when a cursor operation rejects without leaking an unhandled rejection', async () => {
    const input = makeInput()
    const client = makeClient().client
    const baseDb = client.db('test')
    const originalCollection = baseDb.collection
    baseDb.collection = jest.fn((name) => {
      const collection = originalCollection(name)
      if (name !== 'runtime_instances') return collection
      const cursor = {
        limit: jest.fn(() => cursor),
        batchSize: jest.fn(() => cursor),
        maxTimeMS: jest.fn(() => cursor),
        hasNext: jest.fn(() => Promise.reject(new Error('read failed'))),
        next: jest.fn(async () => ({})),
        close: jest.fn(async () => undefined),
      }
      collection.find = jest.fn(() => cursor)
      return collection
    })
    client.db = jest.fn(() => baseDb)
    input.clientFactory = jest.fn(() => client)

    const unhandled = []
    const onUnhandled = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
      await Promise.resolve()
      expect(unhandled).toEqual([])
    } finally {
      process.removeListener('unhandledRejection', onUnhandled)
    }
  })

  test('attempts close after the deadline expires and preserves cleanup failure precedence', async () => {
    const input = makeInput()
    let clockCalls = 0
    input.clock.now = jest.fn(() => {
      clockCalls += 1
      return clockCalls <= 30 ? 0 : 15000
    })
    const client = makeClient().client
    client.connect = jest.fn(() => new Promise(() => {}))
    input.clientFactory = jest.fn(() => client)

    jest.useFakeTimers()
    const promise = runSs014NativeReadSessionRunnerV2(input)
    await jest.advanceTimersByTimeAsync(15000)
    await expectIncomplete(promise, 'SS014_DRY_RUN_TIMEOUT')
    expect(client.close).toHaveBeenCalledTimes(1)
  })

  test('rejects a mutable nested query descriptor before native reads', async () => {
    const input = makeInput()
    const rootQuery = input.primitives.rootQuery()
    input.primitives = {
      ...input.primitives,
      rootQuery: () => Object.freeze({ ...rootQuery, filter: { ...rootQuery.filter } }),
    }

    await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), 'SS014_DRY_RUN_REDACTION_FAILED')
  })

  test('rejects raw row size and sizer failures without returning row content', async () => {
    const oversized = makeInput({ bsonSizer: jest.fn(() => 65537) })
    await expectIncomplete(runSs014NativeReadSessionRunnerV2(oversized), 'SS014_DRY_RUN_SIZE_CAP_EXCEEDED')

    const rejectedSizer = makeInput({ bsonSizer: jest.fn(() => Promise.reject(new Error('sizer failed'))) })
    await expectIncomplete(runSs014NativeReadSessionRunnerV2(rejectedSizer), 'SS014_DRY_RUN_SIZE_CAP_EXCEEDED')
  })

  test('rejects root cardinality, root identity and invalid version-view branches', async () => {
    const cardinality = makeInput()
    const { client: cardinalityClient } = makeClient({
      rootRows: [
        { _id: { hex: RUNTIME_ID }, runtimeInstanceKey: RUNTIME_KEY, customerId: { hex: CUSTOMER_ID }, tenantId: { hex: TENANT_ID }, stateVersion: 'a', runtimeStateVersion: 'a' },
        { _id: { hex: RUNTIME_ID }, runtimeInstanceKey: RUNTIME_KEY, customerId: { hex: CUSTOMER_ID }, tenantId: { hex: TENANT_ID }, stateVersion: 'a', runtimeStateVersion: 'a' },
      ],
    })
    cardinality.clientFactory = jest.fn(() => cardinalityClient)
    await expectIncomplete(runSs014NativeReadSessionRunnerV2(cardinality), 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE')

    const identity = makeInput()
    const { client: identityClient } = makeClient({
      rootRows: [{ _id: { hex: RUNTIME_ID }, runtimeInstanceKey: RUNTIME_KEY, customerId: { hex: '507f1f77bcf86cd799439099' }, tenantId: { hex: TENANT_ID }, stateVersion: 'a', runtimeStateVersion: 'a' }],
    })
    identity.clientFactory = jest.fn(() => identityClient)
    await expectIncomplete(runSs014NativeReadSessionRunnerV2(identity), 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE')

    const invalidVersion = makeInput()
    const { client: invalidVersionClient } = makeClient({
      rootRows: [{ _id: { hex: RUNTIME_ID }, runtimeInstanceKey: RUNTIME_KEY, customerId: { hex: CUSTOMER_ID }, tenantId: { hex: TENANT_ID }, stateVersion: { secret: true }, runtimeStateVersion: undefined }],
    })
    invalidVersion.clientFactory = jest.fn(() => invalidVersionClient)
    await expectIncomplete(runSs014NativeReadSessionRunnerV2(invalidVersion), 'SS014_DRY_RUN_REDACTION_FAILED')
  })

  test('rejects malformed outer descriptors before calling guards or the client factory', async () => {
    const input = makeInput()
    input.extra = true
    await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), 'SS014_DRY_RUN_REDACTION_FAILED')
    expect(input.clientFactory).not.toHaveBeenCalled()
    expect(input.autoCreateGuard.setFalse).not.toHaveBeenCalled()
  })

  test('rejects invalid environment before touching either guard', async () => {
    const input = makeInput({
      environmentGuard: {
        read: jest.fn(() => ({ environmentClass: 'PRODUCTION', isProduction: true, isAppProduction: true })),
      },
    })
    await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), 'SS014_DRY_RUN_PRODUCTION_BLOCKED')
    expect(input.autoCreateGuard.setFalse).not.toHaveBeenCalled()
    expect(input.autoIndexGuard.setFalse).not.toHaveBeenCalled()
  })

  test('rejects a child collection that exceeds the usable cap', async () => {
    const input = makeInput()
    const rows = Array.from({ length: 1001 }, () => ({
      runtimeInstanceId: { hex: RUNTIME_ID },
      customerId: { hex: CUSTOMER_ID },
      tenantId: { hex: TENANT_ID },
    }))
    const client = makeClient({
      collections: { runtime_section_states: rows },
      listRows: [{ name: 'runtime_section_states' }],
    }).client
    input.clientFactory = jest.fn(() => client)

    await expectIncomplete(runSs014NativeReadSessionRunnerV2(input), 'SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE')
  })
})
