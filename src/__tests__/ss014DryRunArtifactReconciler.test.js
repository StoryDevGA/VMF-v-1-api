import { describe, expect, jest, test } from '@jest/globals'

import {
  reconcileSs014DryRunArtifact,
} from '../services/ss014DryRunArtifactReconciler.js'
import {
  SS014_PLAN_ALGORITHM,
  SS014_PLAN_HASH_STATUS,
  SS014_PLAN_RECEIPT_ORDER,
  serializeNormalizedPlan,
} from '../services/ss014StablePlanSerializer.js'

const collectionNames = ['SECTIONS', 'EVIDENCE_SOURCES', 'EVIDENCE_OBJECTS', 'GRAPH_SNAPSHOTS', 'GRAPH_ELEMENTS']

const createPlan = (versionStatus = 'MISSING', blockers = null) => ({
  environmentClass: 'DEVELOPMENT_TEST',
  scopeClass: 'EXACT_SINGLE_RUNTIME',
  rootState: {
    recordCount: 1,
    versionStatus,
    frameworkStateProjected: false,
  },
  v2Collections: collectionNames.map((name) => ({
    name,
    presence: 'ABSENT',
    scopedCount: 0,
    countStatus: 'NOT_RUN_ABSENT',
    bounded: true,
  })),
  blockers: blockers || (versionStatus === 'MISSING' || versionStatus === 'ALIAS_ONLY'
    ? [{ code: 'SS014_DRY_RUN_BASELINE_MAPPING_REQUIRED', severity: 'BLOCKER' }]
    : []),
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
})

const createExecution = () => ({
  monitorInstalledBeforeConnect: true,
  monitorRemoved: true,
  commandEventCount: 3,
  commandClasses: { setup: 1, read: 1, teardown: 1 },
  cleanDisconnect: true,
})

const createArgs = (plan, overrides = {}) => ({
  normalizedPlan: plan,
  outcome: 'BLOCKED',
  selector: 'ID',
  execution: createExecution(),
  planSerializer: serializeNormalizedPlan,
  artifactSizer: (canonicalJson) => Buffer.byteLength(canonicalJson, 'utf8'),
  ...overrides,
})

const incomplete = (errorCode) => ({
  status: 'INCOMPLETE',
  errorCode,
  plan: null,
  planHash: null,
})

describe('SS-014 pure redacted artifact reconciler', () => {
  test.each([
    ['MISSING', 'BLOCKED'],
    ['ALIAS_ONLY', 'BLOCKED'],
    ['CANONICAL', 'READY_FOR_BASELINE_REVIEW'],
  ])('reconciles %s into the exact redacted envelope', (versionStatus, outcome) => {
    const plan = createPlan(versionStatus)
    const input = createArgs(plan, { outcome, selector: 'KEY' })
    const before = JSON.stringify(input)
    const result = reconcileSs014DryRunArtifact(input)

    expect(result).toMatchObject({
      schemaVersion: 'ss014-dry-run-artifact-v1',
      outcome,
      environmentClass: 'DEVELOPMENT_TEST',
      scopeBinding: {
        customer: 'REDACTED',
        tenant: 'REDACTED',
        runtime: 'REDACTED',
        selector: 'KEY',
      },
      planHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      execution: createExecution(),
    })
    expect(result.plan.rootState.versionStatus).toBe(versionStatus)
    expect(JSON.stringify(input)).toBe(before)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.plan)).toBe(true)
    expect(Object.isFrozen(result.plan.rootState)).toBe(true)
    expect(Object.isFrozen(result.plan.v2Collections)).toBe(true)
    expect(Object.isFrozen(result.execution)).toBe(true)
    expect(Object.isFrozen(result.execution.commandClasses)).toBe(true)
  })

  test('uses a deterministic artifact-envelope serializer over UTF-8 bytes', () => {
    const sizer = jest.fn((canonicalJson) => Buffer.byteLength(canonicalJson, 'utf8'))
    const result = reconcileSs014DryRunArtifact(createArgs(createPlan(), { artifactSizer: sizer }))
    const [canonicalJson] = sizer.mock.calls[0]

    expect(sizer).toHaveBeenCalledTimes(1)
    expect(typeof canonicalJson).toBe('string')
    expect(canonicalJson.startsWith(
      '{"schemaVersion":"ss014-dry-run-artifact-v1","outcome":"BLOCKED","environmentClass":"DEVELOPMENT_TEST","scopeBinding":',
    )).toBe(true)
    expect(canonicalJson).toContain(`"planHash":"${result.planHash}"`)
    expect(canonicalJson).not.toMatch(/[\r\n\t]/)
    expect(canonicalJson).toContain('"commandClasses":{"setup":1,"read":1,"teardown":1}')
  })

  test('fails closed for MIXED before serializer or sizer calls', () => {
    const plan = createPlan('MIXED', [{ code: 'SS014_DRY_RUN_STATE_VERSION_MIXED', severity: 'BLOCKER' }])
    const planSerializer = jest.fn()
    const artifactSizer = jest.fn()

    expect(reconcileSs014DryRunArtifact(createArgs(plan, {
      planSerializer,
      artifactSizer,
      outcome: 'BLOCKED',
    }))).toEqual(incomplete('SS014_DRY_RUN_STATE_VERSION_MIXED'))
    expect(planSerializer).not.toHaveBeenCalled()
    expect(artifactSizer).not.toHaveBeenCalled()
  })

  test('rejects exact outer and nested descriptor, symbol, extra and raw-sensitive drift', () => {
    const extra = createArgs(createPlan())
    extra.extra = true
    expect(reconcileSs014DryRunArtifact(extra)).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))

    const nestedExtra = createArgs(createPlan())
    nestedExtra.normalizedPlan.rootState.rawCustomerId = '507f1f77bcf86cd799439011'
    expect(reconcileSs014DryRunArtifact(nestedExtra)).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))

    const accessor = createArgs(createPlan())
    Object.defineProperty(accessor.normalizedPlan.rootState, 'versionStatus', {
      configurable: true,
      enumerable: true,
      get: () => 'MISSING',
    })
    expect(reconcileSs014DryRunArtifact(accessor)).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))

    const symbol = createArgs(createPlan())
    symbol.normalizedPlan[Symbol('raw')] = 'secret'
    expect(reconcileSs014DryRunArtifact(symbol)).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))

    const frozen = Object.freeze(createArgs(createPlan()))
    expect(reconcileSs014DryRunArtifact(frozen)).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))

    const physicalName = createPlan()
    physicalName.v2Collections[0].name = 'runtime_section_states'
    expect(reconcileSs014DryRunArtifact(createArgs(physicalName))).toEqual(
      incomplete('SS014_DRY_RUN_REDACTION_FAILED'),
    )
  })

  test('rejects invalid outcome and blocker combinations', () => {
    expect(reconcileSs014DryRunArtifact(createArgs(createPlan(), {
      outcome: 'READY_FOR_BASELINE_REVIEW',
    }))).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))

    expect(reconcileSs014DryRunArtifact(createArgs(createPlan('CANONICAL'), {
      outcome: 'BLOCKED',
    }))).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))

    const mixed = createPlan('MIXED', [{ code: 'SS014_DRY_RUN_STATE_VERSION_MIXED', severity: 'BLOCKER' }])
    expect(reconcileSs014DryRunArtifact(createArgs(mixed, {
      outcome: 'READY_FOR_BASELINE_REVIEW',
    }))).toEqual(incomplete('SS014_DRY_RUN_STATE_VERSION_MIXED'))
  })

  test('rejects serializer throws, shape drift and raw-bearing canonical output', () => {
    const throwing = jest.fn(() => { throw new Error('secret') })
    expect(reconcileSs014DryRunArtifact(createArgs(createPlan(), {
      planSerializer: throwing,
    }))).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))

    const malformed = jest.fn(() => ({}))
    expect(reconcileSs014DryRunArtifact(createArgs(createPlan(), {
      planSerializer: malformed,
    }))).toEqual(incomplete('SS014_DRY_RUN_REDACTION_FAILED'))

    const rawBearing = jest.fn((plan) => ({
      ...serializeNormalizedPlan(plan),
      canonicalJson: `${serializeNormalizedPlan(plan).canonicalJson}raw-customer-id`,
    }))
    expect(reconcileSs014DryRunArtifact(createArgs(createPlan(), {
      planSerializer: rawBearing,
    }))).toEqual(incomplete('SS014_DRY_RUN_PLAN_DRIFT'))
  })

  test('rejects second-pass drift and SHA-256 mismatch', () => {
    let calls = 0
    const drifting = jest.fn((plan) => {
      const result = serializeNormalizedPlan(plan)
      calls += 1
      return calls === 1 ? result : { ...result, planHash: '0'.repeat(64) }
    })
    expect(reconcileSs014DryRunArtifact(createArgs(createPlan(), {
      planSerializer: drifting,
    }))).toEqual(incomplete('SS014_DRY_RUN_PLAN_DRIFT'))
    expect(drifting).toHaveBeenCalledTimes(2)

    const mismatched = jest.fn((plan) => ({
      ...serializeNormalizedPlan(plan),
      planHash: '0'.repeat(64),
    }))
    expect(reconcileSs014DryRunArtifact(createArgs(createPlan(), {
      planSerializer: mismatched,
    }))).toEqual(incomplete('SS014_DRY_RUN_PLAN_DRIFT'))
  })

  test('rejects sizer throws, invalid counts, mismatches and overflow', () => {
    const throwing = jest.fn(() => { throw new Error('artifact') })
    expect(reconcileSs014DryRunArtifact(createArgs(createPlan(), {
      artifactSizer: throwing,
    }))).toEqual(incomplete('SS014_DRY_RUN_SIZE_CAP_EXCEEDED'))

    for (const value of [undefined, -1, -0, 1.5, Number.MAX_SAFE_INTEGER + 1, Promise.resolve(1)]) {
      expect(reconcileSs014DryRunArtifact(createArgs(createPlan(), {
        artifactSizer: jest.fn(() => value),
      }))).toEqual(incomplete('SS014_DRY_RUN_SIZE_CAP_EXCEEDED'))
    }

    expect(reconcileSs014DryRunArtifact(createArgs(createPlan(), {
      artifactSizer: jest.fn(() => 262145),
    }))).toEqual(incomplete('SS014_DRY_RUN_SIZE_CAP_EXCEEDED'))

    expect(reconcileSs014DryRunArtifact(createArgs(createPlan(), {
      artifactSizer: jest.fn(() => 0),
    }))).toEqual(incomplete('SS014_DRY_RUN_SIZE_CAP_EXCEEDED'))
  })

  test('keeps the public module boundary pure and singular', async () => {
    const module = await import('../services/ss014DryRunArtifactReconciler.js')
    expect(Object.keys(module)).toEqual(['reconcileSs014DryRunArtifact'])
  })
})
