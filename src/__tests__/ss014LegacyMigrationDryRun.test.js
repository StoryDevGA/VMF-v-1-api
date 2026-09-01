import { describe, expect, jest, test } from '@jest/globals'

import { createSs014TopologyReadPrimitives } from '../services/ss014TopologyReadPrimitives.js'
import {
  LEGACY_DOMAINS,
  LEGACY_PROJECTIONS,
  runSs014LegacyMigrationDryRun,
} from '../services/ss014LegacyMigrationDryRun.js'

const CUSTOMER_ID = '507f1f77bcf86cd799439011'
const TENANT_ID = '507f1f77bcf86cd799439012'
const RUNTIME_ID = '507f1f77bcf86cd799439013'
const RUNTIME_KEY = 'value-narrative-82ae435990f9'

const adapter = {
  isValidLowerHexId: (value) => typeof value === 'string' && /^[0-9a-f]{24}$/.test(value),
  fromLowerHexId: (value) => ({ hex: value }),
  isOpaqueObjectId: (value) => value !== null && typeof value === 'object' && typeof value.hex === 'string',
  toLowerHexId: (value) => value.hex,
}

const makeGuard = (initial = true) => {
  let current = initial
  return {
    read: jest.fn(() => current),
    setFalse: jest.fn(() => { current = false }),
    restore: jest.fn((value) => { current = value }),
  }
}

const makeCursor = (rows, onCommand) => {
  let index = 0
  const cursor = {
    limit: jest.fn(() => cursor),
    batchSize: jest.fn(() => cursor),
    maxTimeMS: jest.fn(() => cursor),
    hasNext: jest.fn(async () => index < rows.length),
    next: jest.fn(async () => rows[index++]),
    close: jest.fn(async () => undefined),
  }
  onCommand(cursor)
  return cursor
}

const makeRoot = (version = {}) => ({
  _id: { hex: RUNTIME_ID },
  customerId: { hex: CUSTOMER_ID },
  tenantId: { hex: TENANT_ID },
  runtimeInstanceKey: RUNTIME_KEY,
  ...version,
})

const makeLegacyRows = ({ sections = {}, evidenceObjects = [], nodes = [], edges = [] } = {}) => ({
  sections: [{
    _id: { hex: RUNTIME_ID },
    customerId: { hex: CUSTOMER_ID },
    tenantId: { hex: TENANT_ID },
    runtimeInstanceKey: RUNTIME_KEY,
    framework_state: { sections },
  }],
  evidence: [{
    _id: { hex: RUNTIME_ID },
    customerId: { hex: CUSTOMER_ID },
    tenantId: { hex: TENANT_ID },
    runtimeInstanceKey: RUNTIME_KEY,
    framework_state: { evidence_pack: { evidenceObjects } },
  }],
  graph: [{
    _id: { hex: RUNTIME_ID },
    customerId: { hex: CUSTOMER_ID },
    tenantId: { hex: TENANT_ID },
    runtimeInstanceKey: RUNTIME_KEY,
    framework_state: { intelligence_graph: { nodes, edges } },
  }],
})

const makeClient = ({ root = makeRoot(), legacy = makeLegacyRows(), missingCollections = [] } = {}) => {
  const handlers = new Map()
  const findCalls = []
  const database = {
    collection: jest.fn((name) => ({
      find: jest.fn((filter, options) => {
        findCalls.push({ name, filter, options })
        const projection = options.projection || {}
        const rows = name === 'runtime_instances'
          ? Object.prototype.hasOwnProperty.call(projection, 'framework_state.sections')
            ? legacy.sections
            : Object.prototype.hasOwnProperty.call(projection, 'framework_state.evidence_pack')
              ? legacy.evidence
              : Object.prototype.hasOwnProperty.call(projection, 'framework_state.intelligence_graph')
                ? legacy.graph
                : [root]
          : []
        ;(handlers.get('commandStarted') || []).forEach((handler) => handler({
          commandName: 'find',
          command: { find: name, projection },
        }))
        return makeCursor(rows, () => undefined)
      }),
    })),
    command: jest.fn((command) => {
      ;(handlers.get('commandStarted') || []).forEach((handler) => handler({
        commandName: 'collStats',
        command,
      }))
      if (missingCollections.includes(command.collStats)) {
        const failure = { code: 26, codeName: 'NamespaceNotFound' }
        ;(handlers.get('commandFailed') || []).forEach((handler) => handler({
          commandName: 'collStats',
          failure,
        }))
        const error = new Error('missing collection')
        error.code = 26
        error.codeName = 'NamespaceNotFound'
        return Promise.reject(error)
      }
      return Promise.resolve({ ok: 1 })
    }),
  }
  const client = {
    options: { monitorCommands: true },
    on: jest.fn((event, handler) => {
      handlers.set(event, [...(handlers.get(event) || []), handler])
      return client
    }),
    off: jest.fn((event, handler) => {
      handlers.set(event, (handlers.get(event) || []).filter((candidate) => candidate !== handler))
      return client
    }),
    listenerCount: jest.fn((event) => (handlers.get(event) || []).length),
    connect: jest.fn(async () => {
      ;(handlers.get('commandStarted') || []).forEach((handler) => handler({ commandName: 'hello', command: { hello: 1 } }))
    }),
    db: jest.fn((name) => name === 'test' ? database : null),
    close: jest.fn(async () => {
      ;(handlers.get('commandStarted') || []).forEach((handler) => handler({ commandName: 'endSessions', command: { endSessions: [] } }))
    }),
    findCalls,
  }
  return client
}

const makeInput = ({ clients, root, legacy, missingCollections } = {}) => {
  const scope = {
    schemaVersion: 'ss014-scope-v1',
    environmentClass: 'DEVELOPMENT_TEST',
    customerId: CUSTOMER_ID,
    tenantId: TENANT_ID,
    runtimeKey: RUNTIME_KEY,
  }
  const clock = { now: jest.fn(() => 0) }
  const primitives = createSs014TopologyReadPrimitives({ scope, objectIdAdapter: adapter, clock })
  const clientList = clients || [
    makeClient({ root, legacy, missingCollections }),
    makeClient({ root, legacy, missingCollections }),
  ]
  let clientIndex = 0
  return {
    scope,
    primitives,
    objectIdAdapter: adapter,
    environmentGuard: {
      read: jest.fn(() => ({ environmentClass: 'DEVELOPMENT_TEST', isProduction: false, isAppProduction: false })),
    },
    autoCreateGuard: makeGuard(true),
    autoIndexGuard: makeGuard(true),
    clientFactory: jest.fn(() => clientList[clientIndex++]),
    clock,
    bsonSizer: jest.fn(() => 100),
  }
}

const expectIncomplete = async (promise, errorCode) => {
  await expect(promise).resolves.toEqual({
    status: 'INCOMPLETE',
    errorCode,
    plan: null,
    planHash: null,
  })
}

describe('SS-014 legacy migration dry-run', () => {
  test('performs two independent bounded observations and emits only a provisional redacted plan', async () => {
    const input = makeInput({
      root: makeRoot(),
      legacy: makeLegacyRows({
        sections: { customer_context: { accepted: { truth: 'redacted in plan' } } },
        evidenceObjects: [{ evidenceObjectId: 'evidence-1' }],
        nodes: [{ id: 'node-1' }],
        edges: [{ from: 'node-1', to: 'node-1' }],
      }),
    })
    const result = await runSs014LegacyMigrationDryRun(input)

    expect(result.status).toBe('BLOCKED')
    expect(result.errorCode).toBeNull()
    expect(result.plan.rootState).toEqual({ recordCount: 1, versionStatus: 'MISSING', frameworkStateProjected: false })
    expect(result.plan.legacyDomains).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'SECTIONS_LEGACY', itemCount: 1, sizeClass: 'SMALL' }),
      expect.objectContaining({ name: 'EVIDENCE_PACK_LEGACY', itemCount: 1 }),
      expect.objectContaining({ name: 'INTELLIGENCE_GRAPH_LEGACY', nodeCount: 1, edgeCount: 1 }),
    ]))
    expect(result.plan.blockers).toEqual([{ code: 'SS014_DRY_RUN_BASELINE_MAPPING_REQUIRED', severity: 'BLOCKER' }])
    expect(result.plan.applyAuthority).toBe(false)
    expect(result.planHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.sourceHashStatus).toBe('NOT_COMPUTED_BASELINE_MAPPING_REQUIRED')
    expect(result.planHashStatus).toBe('PROVISIONAL_NOT_APPLY_AUTHORITY')
    expect(result.clientFactory).toBeUndefined()
    expect(input.clientFactory).toHaveBeenCalledTimes(2)
    expect(input.autoCreateGuard.read()).toBe(true)
    expect(input.autoIndexGuard.read()).toBe(true)
  })

  test('uses the exact bounded legacy projections and never issues a write or listCollections command', async () => {
    const clients = [makeClient(), makeClient()]
    const input = makeInput({ clients })
    const result = await runSs014LegacyMigrationDryRun(input)

    expect(result.status).toBe('BLOCKED')
    for (const client of clients) {
      const legacyCalls = client.findCalls.filter(({ name, options }) => name === 'runtime_instances'
        && Object.keys(options.projection).some((key) => key.startsWith('framework_state.')))
      expect(legacyCalls.map(({ options }) => options.projection)).toEqual([
        LEGACY_PROJECTIONS.SECTIONS_LEGACY,
        LEGACY_PROJECTIONS.EVIDENCE_PACK_LEGACY,
        LEGACY_PROJECTIONS.INTELLIGENCE_GRAPH_LEGACY,
      ])
      expect(legacyCalls.every(({ options }) => Object.keys(options).length === 1)).toBe(true)
      expect(client.db('test').command.mock.calls.map(([command]) => Object.keys(command))).toEqual([
        ['collStats', 'maxTimeMS'],
        ['collStats', 'maxTimeMS'],
        ['collStats', 'maxTimeMS'],
        ['collStats', 'maxTimeMS'],
        ['collStats', 'maxTimeMS'],
      ])
      expect(client.db('test').listCollections).toBeUndefined()
    }
    expect(LEGACY_DOMAINS.map(({ itemCap, nodeCap, edgeCap }) => [itemCap, nodeCap, edgeCap])).toEqual([
      [2000, undefined, undefined], [10000, undefined, undefined], [undefined, 20000, 40000],
    ])
  })

  test('fails closed on a legacy item cap before any second observation', async () => {
    const sections = Object.fromEntries(Array.from({ length: 2001 }, (_, index) => [`section-${index}`, {}]))
    const first = makeClient({ legacy: makeLegacyRows({ sections }) })
    const second = makeClient()
    const input = makeInput({ clients: [first, second] })

    await expectIncomplete(runSs014LegacyMigrationDryRun(input), 'SS014_DRY_RUN_SIZE_CAP_EXCEEDED')
    expect(input.clientFactory).toHaveBeenCalledTimes(1)
  })

  test('returns plan drift and no plan hash when independent observations differ', async () => {
    const first = makeClient({ legacy: makeLegacyRows({ sections: { one: {} } }) })
    const second = makeClient({ legacy: makeLegacyRows({ sections: { one: {}, two: {} } }) })
    const input = makeInput({ clients: [first, second] })

    await expectIncomplete(runSs014LegacyMigrationDryRun(input), 'SS014_DRY_RUN_PLAN_DRIFT')
  })

  test('records absent V2 collections as absent and does not fetch child rows', async () => {
    const missing = ['runtime_section_states', 'runtime_graph_elements']
    const clients = [makeClient({ missingCollections: missing }), makeClient({ missingCollections: missing })]
    const input = makeInput({ clients })
    const result = await runSs014LegacyMigrationDryRun(input)

    expect(result.status).toBe('BLOCKED')
    expect(result.plan.v2Collections).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'SECTIONS', presence: 'ABSENT', countStatus: 'NOT_RUN_ABSENT' }),
      expect.objectContaining({ name: 'GRAPH_ELEMENTS', presence: 'ABSENT', countStatus: 'NOT_RUN_ABSENT' }),
    ]))
  })
})
