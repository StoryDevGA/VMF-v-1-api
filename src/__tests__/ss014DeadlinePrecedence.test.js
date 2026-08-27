import * as moduleExports from '../services/ss014DeadlinePrecedence.js'
import { describe, expect, test } from '@jest/globals'

const operations = ['FULFILLED', 'REJECTED', 'THREW', 'NON_PROMISE', 'PENDING']
const deadlines = ['OPEN', 'EXPIRED', 'CLOCK_FAILED', 'INVALID', 'PRE_INVOKE_FAILED']
const cleanups = ['NOT_ATTEMPTED', 'CLEARED', 'FAILED']

const resolve = moduleExports.resolveSs014DeadlinePrecedence

const expectIncomplete = (result, errorCode) => {
  expect(result).toEqual({ status: 'INCOMPLETE', errorCode })
  expect(Object.isFrozen(result)).toBe(true)
}

describe('SS-014 deadline and cleanup precedence', () => {
  test('exports exactly the bounded policy function', () => {
    expect(Object.keys(moduleExports)).toEqual(['resolveSs014DeadlinePrecedence'])
    expect(typeof resolve).toBe('function')
  })

  test('covers the complete operation/deadline/cleanup Cartesian matrix', () => {
    for (const operation of operations) {
      for (const deadline of deadlines) {
        for (const timerCleanup of cleanups) {
          const result = resolve({ operation, deadline, timerCleanup })

          if (deadline !== 'OPEN') {
            expectIncomplete(result, 'SS014_DRY_RUN_TIMEOUT')
          } else if (operation === 'REJECTED'
            || operation === 'THREW'
            || operation === 'NON_PROMISE') {
            expectIncomplete(result, 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
          } else if (operation === 'PENDING') {
            expectIncomplete(result, 'SS014_DRY_RUN_TIMEOUT')
          } else if (timerCleanup === 'CLEARED') {
            expect(result).toEqual({ status: 'READY' })
            expect(Object.isFrozen(result)).toBe(true)
          } else {
            expectIncomplete(result, 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
          }
        }
      }
    }
  })

  test('gives deadline and clock failures precedence over cleanup failure', () => {
    const result = resolve({
      operation: 'FULFILLED',
      deadline: 'EXPIRED',
      timerCleanup: 'FAILED',
    })

    expectIncomplete(result, 'SS014_DRY_RUN_TIMEOUT')
  })

  test('maps open-deadline operation and cleanup failures to command-monitor-unavailable', () => {
    expectIncomplete(resolve({
      operation: 'REJECTED',
      deadline: 'OPEN',
      timerCleanup: 'FAILED',
    }), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
    expectIncomplete(resolve({
      operation: 'FULFILLED',
      deadline: 'OPEN',
      timerCleanup: 'NOT_ATTEMPTED',
    }), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
  })

  test('rejects malformed, extra, symbol, accessor and inherited descriptors', () => {
    const valid = { operation: 'FULFILLED', deadline: 'OPEN', timerCleanup: 'CLEARED' }
    expectIncomplete(resolve(null), 'SS014_DRY_RUN_REDACTION_FAILED')
    expectIncomplete(resolve({ ...valid, extra: true }), 'SS014_DRY_RUN_REDACTION_FAILED')

    const symbolInput = { ...valid, [Symbol('extra')]: true }
    expectIncomplete(resolve(symbolInput), 'SS014_DRY_RUN_REDACTION_FAILED')

    const accessorInput = { ...valid }
    Object.defineProperty(accessorInput, 'operation', {
      configurable: true,
      enumerable: true,
      get: () => 'FULFILLED',
    })
    expectIncomplete(resolve(accessorInput), 'SS014_DRY_RUN_REDACTION_FAILED')

    const inheritedInput = Object.create({ extra: true })
    Object.assign(inheritedInput, valid)
    expectIncomplete(resolve(inheritedInput), 'SS014_DRY_RUN_REDACTION_FAILED')
  })

  test('does not mutate or retain raw input details', () => {
    const input = { operation: 'FULFILLED', deadline: 'OPEN', timerCleanup: 'CLEARED' }
    const result = resolve(input)

    expect(input).toEqual({ operation: 'FULFILLED', deadline: 'OPEN', timerCleanup: 'CLEARED' })
    expect(result).toEqual({ status: 'READY' })
    expect(Object.keys(result)).toEqual(['status'])
  })
})
