import { describe, expect, test } from '@jest/globals'

import { runSs014ReadOnlyDryRunPlan } from '../services/ss014ReadOnlyDryRunPlan.js'

const COLLECTION_NAMES = [
  'SECTIONS',
  'EVIDENCE_SOURCES',
  'EVIDENCE_OBJECTS',
  'GRAPH_SNAPSHOTS',
  'GRAPH_ELEMENTS',
]

const RECEIPT_NAMES = [
  'ROOT_CONTROL_FIND',
  'COLLECTION_LIST',
  'SECTIONS_FIND',
  'EVIDENCE_SOURCES_FIND',
  'EVIDENCE_OBJECTS_FIND',
  'GRAPH_SNAPSHOTS_FIND',
  'GRAPH_ELEMENTS_FIND',
]

const createScope = (selector = 'ID') => selector === 'ID'
  ? {
      schemaVersion: 'ss014-scope-v1',
      environmentClass: 'DEVELOPMENT_TEST',
      customerId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      runtimeId: 'cccccccccccccccccccccccc',
    }
  : {
      schemaVersion: 'ss014-scope-v1',
      environmentClass: 'DEVELOPMENT_TEST',
      customerId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      runtimeKey: 'value-narrative-82ae435990f9',
    }

const createExecution = () => ({
  monitorInstalledBeforeConnect: true,
  monitorRemoved: true,
  commandEventCount: 3,
  commandClasses: { setup: 1, read: 1, teardown: 1 },
  cleanDisconnect: true,
})

const createObservation = (versionStatus = 'MISSING') => {
  const v2Collections = COLLECTION_NAMES.map((name) => ({
    name,
    presence: 'ABSENT',
    scopedCount: 0,
    countStatus: 'NOT_RUN_ABSENT',
    bounded: true,
  }))

  return {
    rootState: {
      recordCount: 1,
      versionStatus,
      frameworkStateProjected: false,
    },
    v2Collections,
    readReceipts: RECEIPT_NAMES.map((operation, index) => ({
      operation,
      outcome: index < 2 ? 'READ' : 'ABSENT',
      bounded: true,
    })),
  }
}

const createInput = (versionStatus = 'MISSING', selector = 'ID') => ({
  scope: createScope(selector),
  observation: createObservation(versionStatus),
  execution: createExecution(),
  selector,
})

const incomplete = (errorCode) => ({
  status: 'INCOMPLETE',
  errorCode,
  plan: null,
  planHash: null,
})

describe('SS-014 pure observation-to-plan boundary', () => {
  test.each([
    ['MISSING', 'BLOCKED'],
    ['ALIAS_ONLY', 'BLOCKED'],
    ['CANONICAL', 'READY_FOR_BASELINE_REVIEW'],
  ])('builds the redacted %s artifact branch', (versionStatus, outcome) => {
    const result = runSs014ReadOnlyDryRunPlan(createInput(versionStatus))

    expect(result).toMatchObject({
      schemaVersion: 'ss014-dry-run-artifact-v1',
      outcome,
      environmentClass: 'DEVELOPMENT_TEST',
      scopeBinding: {
        customer: 'REDACTED',
        tenant: 'REDACTED',
        runtime: 'REDACTED',
        selector: 'ID',
      },
      planHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      execution: createExecution(),
    })
    expect(result.plan.rootState.versionStatus).toBe(versionStatus)
    expect(JSON.stringify(result)).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaa')
    expect(Object.isFrozen(result)).toBe(true)
  })

  test('supports key-selected scope only with matching selector parity', () => {
    const result = runSs014ReadOnlyDryRunPlan(createInput('MISSING', 'KEY'))
    expect(result.scopeBinding.selector).toBe('KEY')

    const mismatch = createInput('MISSING', 'KEY')
    mismatch.selector = 'ID'
    expect(runSs014ReadOnlyDryRunPlan(mismatch)).toEqual(incomplete('SS014_DRY_RUN_SCOPE_INVALID'))
  })

  test('fails closed before artifact reconciliation for mixed versions', () => {
    expect(runSs014ReadOnlyDryRunPlan(createInput('MIXED')))
      .toEqual(incomplete('SS014_DRY_RUN_STATE_VERSION_MIXED'))
  })

  test('rejects capped and failed collection observations before helper invocation', () => {
    const capped = createInput()
    capped.observation.v2Collections[0] = {
      ...capped.observation.v2Collections[0],
      presence: 'PRESENT',
      scopedCount: 1001,
      countStatus: 'CAP_EXCEEDED',
    }
    expect(runSs014ReadOnlyDryRunPlan(capped))
      .toEqual(incomplete('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE'))

    const failed = createInput()
    failed.observation.v2Collections[0] = {
      ...failed.observation.v2Collections[0],
      presence: 'PRESENT',
      countStatus: 'READ_FAILED',
    }
    expect(runSs014ReadOnlyDryRunPlan(failed))
      .toEqual(incomplete('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE'))
  })

  test('rejects receipt, cardinality and collection-state mismatches', () => {
    const rootCardinality = createInput()
    rootCardinality.observation.rootState.recordCount = 2
    expect(runSs014ReadOnlyDryRunPlan(rootCardinality))
      .toEqual(incomplete('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE'))

    const receiptMismatch = createInput()
    receiptMismatch.observation.readReceipts[2].outcome = 'READ'
    expect(runSs014ReadOnlyDryRunPlan(receiptMismatch))
      .toEqual(incomplete('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE'))

    const collectionMismatch = createInput()
    collectionMismatch.observation.v2Collections[0] = {
      ...collectionMismatch.observation.v2Collections[0],
      presence: 'PRESENT',
      scopedCount: 0,
      countStatus: 'EXACT',
    }
    expect(runSs014ReadOnlyDryRunPlan(collectionMismatch))
      .toEqual(incomplete('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE'))
  })

  test('rejects raw native receipt extras instead of silently normalizing them', () => {
    const input = createInput()
    input.execution = {
      status: 'READY',
      ...input.execution,
      autoCreateRestored: true,
    }
    expect(runSs014ReadOnlyDryRunPlan(input))
      .toEqual(incomplete('SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE'))
  })

  test('rejects unsafe scope, execution and input descriptors', () => {
    const invalidScope = createInput()
    invalidScope.scope.customerId = invalidScope.scope.customerId.toUpperCase()
    expect(runSs014ReadOnlyDryRunPlan(invalidScope))
      .toEqual(incomplete('SS014_DRY_RUN_SCOPE_INVALID'))

    const invalidExecution = createInput()
    invalidExecution.execution.commandClasses.read = 2
    expect(runSs014ReadOnlyDryRunPlan(invalidExecution))
      .toEqual(incomplete('SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE'))

    const extraInput = { ...createInput(), extra: true }
    expect(runSs014ReadOnlyDryRunPlan(extraInput))
      .toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))
  })

  test('blocks full legacy state and rejects physical/raw state material', () => {
    const fullState = createInput()
    fullState.observation.framework_state = {}
    expect(runSs014ReadOnlyDryRunPlan(fullState))
      .toEqual(incomplete('SS014_DRY_RUN_FULL_STATE_BLOCKED'))

    const physicalCollection = createInput()
    physicalCollection.observation.v2Collections[0].name = 'runtime_section_states'
    expect(runSs014ReadOnlyDryRunPlan(physicalCollection))
      .toEqual(incomplete('SS014_DRY_RUN_COLLECTION_READ_UNAVAILABLE'))

    const revisionFallback = createInput()
    revisionFallback.observation.rootState.revision = { revisionNumber: 7 }
    expect(runSs014ReadOnlyDryRunPlan(revisionFallback))
      .toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))
  })

  test('does not mutate the supplied observation or scope', () => {
    const input = createInput('MISSING', 'KEY')
    const before = JSON.stringify(input)
    runSs014ReadOnlyDryRunPlan(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
