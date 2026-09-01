import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, jest } from '@jest/globals'
import { reconcileSs014DryRunArtifact } from '../services/ss014DryRunArtifactReconciler.js'
import { prepareRuntimeStateNativeReadPlanInput } from '../services/runtimeStateNativeReadResultBoundary.js'
import { runSs014ReadOnlyDryRunPlan } from '../services/ss014ReadOnlyDryRunPlan.js'
import { serializeNormalizedPlan } from '../services/ss014StablePlanSerializer.js'

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const servicePath = resolve(apiRoot, 'src/services/runtimeStateNativeReadResultBoundary.js')

const scope = Object.freeze({
  schemaVersion: 'ss014-scope-v1',
  environmentClass: 'DEVELOPMENT_TEST',
  customerId: '0123456789abcdef01234567',
  tenantId: 'fedcba9876543210fedcba98',
  runtimeId: 'abcdefabcdefabcdefabcdef',
})

const versionView = Object.freeze({ stateVersion: 'rsv2:canonical', runtimeStateVersion: '' })

const resolverResult = (overrides = {}) => ({
  stateVersion: 'rsv2:canonical',
  source: 'canonical',
  canonicalStateVersion: 'rsv2:canonical',
  compatibilityStateVersion: '',
  ...overrides,
})

const collection = (name, overrides = {}) => ({
  bounded: true,
  countStatus: 'EXACT',
  name,
  presence: 'PRESENT',
  scopedCount: 0,
  ...overrides,
})

const collections = (overrides = {}) => [
  collection('SECTIONS', overrides.SECTIONS),
  collection('EVIDENCE_SOURCES', overrides.EVIDENCE_SOURCES),
  collection('EVIDENCE_OBJECTS', overrides.EVIDENCE_OBJECTS),
  collection('GRAPH_SNAPSHOTS', overrides.GRAPH_SNAPSHOTS),
  collection('GRAPH_ELEMENTS', overrides.GRAPH_ELEMENTS),
]

const execution = (overrides = {}) => ({
  monitorInstalledBeforeConnect: true,
  monitorRemoved: true,
  commandEventCount: 3,
  commandClasses: { setup: 1, read: 1, teardown: 1 },
  cleanDisconnect: true,
  ...overrides,
})

const input = (overrides = {}) => ({
  scope,
  selector: 'ID',
  stateVersionResolver: () => resolverResult(),
  versionView,
  v2Collections: collections(),
  execution: execution(),
  ...overrides,
})

const incomplete = (errorCode) => ({
  status: 'INCOMPLETE',
  errorCode,
  plan: null,
  planHash: null,
})

describe('prepareRuntimeStateNativeReadPlanInput', () => {
  test('exports exactly the intended helper', async () => {
    const module = await import('../services/runtimeStateNativeReadResultBoundary.js')
    expect(Object.keys(module)).toEqual(['prepareRuntimeStateNativeReadPlanInput'])
  })

  test('builds exact READY output and downstream consumers accept it', () => {
    const result = prepareRuntimeStateNativeReadPlanInput(input())
    expect(result.status).toBe('READY')
    expect(result.planInput.observation.readReceipts).toEqual([
      { operation: 'ROOT_CONTROL_FIND', outcome: 'READ', bounded: true },
      { operation: 'COLLECTION_LIST', outcome: 'READ', bounded: true },
      { operation: 'SECTIONS_FIND', outcome: 'READ', bounded: true },
      { operation: 'EVIDENCE_SOURCES_FIND', outcome: 'READ', bounded: true },
      { operation: 'EVIDENCE_OBJECTS_FIND', outcome: 'READ', bounded: true },
      { operation: 'GRAPH_SNAPSHOTS_FIND', outcome: 'READ', bounded: true },
      { operation: 'GRAPH_ELEMENTS_FIND', outcome: 'READ', bounded: true },
    ])

    const planResult = runSs014ReadOnlyDryRunPlan(result.planInput)
    expect(planResult.outcome).toBe('READY_FOR_BASELINE_REVIEW')
    const normalizedPlan = JSON.parse(JSON.stringify(planResult.plan))
    expect(() => serializeNormalizedPlan(normalizedPlan)).not.toThrow()
    expect(reconcileSs014DryRunArtifact({
      normalizedPlan,
      outcome: 'READY_FOR_BASELINE_REVIEW',
      selector: 'ID',
      execution: result.planInput.execution,
      planSerializer: serializeNormalizedPlan,
      artifactSizer: (canonicalJson) => Buffer.byteLength(canonicalJson, 'utf8'),
    }).outcome).toBe('READY_FOR_BASELINE_REVIEW')
  })

  test('builds ABSENT receipts without admitting unavailable collection states', () => {
    const result = prepareRuntimeStateNativeReadPlanInput(input({
      v2Collections: collections({
        EVIDENCE_OBJECTS: collection('EVIDENCE_OBJECTS', {
          presence: 'ABSENT',
          countStatus: 'NOT_RUN_ABSENT',
          scopedCount: 0,
        }),
      }),
    }))
    expect(result.status).toBe('READY')
    expect(result.planInput.observation.readReceipts[4]).toEqual({
      operation: 'EVIDENCE_OBJECTS_FIND', outcome: 'ABSENT', bounded: true,
    })
  })

  test.each([
    ['missing', resolverResult({
      stateVersion: '', source: 'missing', canonicalStateVersion: '', compatibilityStateVersion: '',
    })],
    ['alias only', resolverResult({
      stateVersion: 'legacy', source: 'compatibility_alias', canonicalStateVersion: '', compatibilityStateVersion: 'legacy',
    })],
    ['canonical', resolverResult()],
    ['equal dual field', resolverResult({
      compatibilityStateVersion: 'rsv2:canonical',
    })],
  ])('accepts resolver source %s exactly once', (_label, resolved) => {
    const stateVersionResolver = jest.fn(() => resolved)
    const result = prepareRuntimeStateNativeReadPlanInput(input({ stateVersionResolver }))
    expect(result.status).toBe('READY')
    expect(stateVersionResolver).toHaveBeenCalledTimes(1)
    expect(stateVersionResolver).toHaveBeenCalledWith(versionView)
  })

  test('short-circuits true MIXED before collections, execution or receipt work', () => {
    const stateVersionResolver = jest.fn(() => ({
      stateVersion: '',
      source: 'mixed',
      canonicalStateVersion: 'rsv2:a',
      compatibilityStateVersion: 'rsv2:b',
      errorCode: 'RUNTIME_STATE_VERSION_MIXED',
    }))
    const result = prepareRuntimeStateNativeReadPlanInput(input({
      stateVersionResolver,
      v2Collections: null,
      execution: null,
    }))
    expect(result).toEqual(incomplete('SS014_DRY_RUN_STATE_VERSION_MIXED'))
    expect(stateVersionResolver).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['CAP_EXCEEDED', { countStatus: 'CAP_EXCEEDED', scopedCount: 1001 }],
    ['READ_FAILED', { countStatus: 'READ_FAILED', scopedCount: 0 }],
  ])('fails closed for %s before receipt construction', (_label, state) => {
    const result = prepareRuntimeStateNativeReadPlanInput(input({
      v2Collections: collections({ SECTIONS: collection('SECTIONS', state) }),
    }))
    expect(result).toEqual(incomplete('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE'))
  })

  test.each([
    ['CAP_EXCEEDED', { countStatus: 'CAP_EXCEEDED', scopedCount: 1001 }],
    ['READ_FAILED', { countStatus: 'READ_FAILED', scopedCount: 0 }],
  ])('checks every collection descriptor before %s semantic failure', (_label, semanticState) => {
    const malformedLater = collection('EVIDENCE_SOURCES', { extra: true })
    const result = prepareRuntimeStateNativeReadPlanInput(input({
      v2Collections: [
        collection('SECTIONS', semanticState),
        malformedLater,
        collection('EVIDENCE_OBJECTS'),
        collection('GRAPH_SNAPSHOTS'),
        collection('GRAPH_ELEMENTS'),
      ],
    }))
    expect(result).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))
  })

  test.each([
    { countStatus: 'CAP_EXCEEDED', scopedCount: 0 },
    { countStatus: 'READ_FAILED', scopedCount: 1001 },
    { presence: 'ABSENT', countStatus: 'EXACT', scopedCount: 0 },
    { presence: 'PRESENT', countStatus: 'NOT_RUN_ABSENT', scopedCount: 0 },
    { presence: 'PRESENT', countStatus: 'EXACT', scopedCount: 1001 },
    { name: 'WRONG_NAME' },
  ])('fails closed for contradictory collection state %#', (state) => {
    expect(prepareRuntimeStateNativeReadPlanInput(input({
      v2Collections: collections({ SECTIONS: collection('SECTIONS', state) }),
    }))).toEqual(incomplete('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE'))
  })

  test.each([
    ['resolver extra key', { stateVersionResolver: () => ({ ...resolverResult(), extra: true }) }],
    ['resolver throw', { stateVersionResolver: () => { throw new Error('hidden') } }],
    ['resolver thenable', { stateVersionResolver: () => Promise.resolve(resolverResult()) }],
    ['invalid scope', { scope: { ...scope, customerId: 'bad' } }],
    ['wrong selector', { selector: 'KEY' }],
    ['monitor failure', { execution: execution({ monitorRemoved: false }) }],
  ])('returns the correct redacted or governed failure for %s', (_label, overrides) => {
    const result = prepareRuntimeStateNativeReadPlanInput(input(overrides))
    const expected = overrides.execution
      ? 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE'
      : overrides.scope || overrides.selector
        ? 'SS014_DRY_RUN_SCOPE_INVALID'
        : 'SS014_DRY_RUN_REDACTION_FAILED'
    expect(result).toEqual(incomplete(expected))
  })

  test('rejects structural descriptors before resolver invocation', () => {
    const stateVersionResolver = jest.fn(() => resolverResult())
    const malformed = input({ stateVersionResolver, versionView: { stateVersion: 'x' } })
    expect(prepareRuntimeStateNativeReadPlanInput(malformed))
      .toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))
    expect(stateVersionResolver).not.toHaveBeenCalled()
  })

  test('freezes normalized output, clones scope and does not mutate input', () => {
    const supplied = input()
    const before = JSON.parse(JSON.stringify(supplied, (_key, value) => (
      typeof value === 'function' ? '[function]' : value
    )))
    const result = prepareRuntimeStateNativeReadPlanInput(supplied)

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.planInput)).toBe(false)
    expect(Object.isFrozen(result.planInput.scope)).toBe(false)
    expect(Object.isFrozen(result.planInput.observation)).toBe(false)
    expect(Object.isFrozen(result.planInput.observation.v2Collections)).toBe(false)
    expect(Object.isFrozen(result.planInput.observation.readReceipts)).toBe(false)
    expect(Object.isFrozen(result.planInput.execution)).toBe(false)
    expect(result.planInput.scope).not.toBe(supplied.scope)
    expect(JSON.stringify(supplied, (_key, value) => (
      typeof value === 'function' ? '[function]' : value
    ))).toBe(JSON.stringify(before))
  })

  test('contains no imports or external I/O', async () => {
    const source = await readFile(servicePath, 'utf8')
    expect(source).not.toMatch(/\bimport\s/)
    expect(source).not.toMatch(/\b(?:require|fetch|mongoose|MongoClient|setTimeout|setInterval)\b/)
  })
})
