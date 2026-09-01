import { describe, expect, test } from '@jest/globals'

import * as observationModule from '../services/ss014SynchronousAdapterObservation.js'

const { observeSs014SynchronousAdapter } = observationModule

const nextHostTurn = () => new Promise((resolve) => setImmediate(resolve))

const expectNoUnhandledRejection = async (invoke) => {
  const unhandledReasons = []
  const onUnhandledRejection = (reason) => {
    unhandledReasons.push(reason)
  }

  process.on('unhandledRejection', onUnhandledRejection)
  try {
    const result = observeSs014SynchronousAdapter(invoke)
    expect(Object.isFrozen(result)).toBe(true)
    expect(result).toEqual({ ok: false, value: null })

    await Promise.resolve()
    await Promise.resolve()
    await nextHostTurn()

    expect(unhandledReasons).toEqual([])
    return result
  } finally {
    process.removeListener('unhandledRejection', onUnhandledRejection)
  }
}

describe('SS-014 synchronous adapter observation', () => {
  test('exports exactly one helper', () => {
    expect(Object.keys(observationModule)).toEqual(['observeSs014SynchronousAdapter'])
  })

  test('rejects non-functions without invoking anything', () => {
    for (const input of [null, undefined, 42, {}, 'not-a-function']) {
      const result = observeSs014SynchronousAdapter(input)
      expect(result).toEqual({ ok: false, value: null })
      expect(Object.isFrozen(result)).toBe(true)
    }
  })

  test('calls a synchronous adapter exactly once and preserves opaque values', () => {
    const value = { count: 3 }
    let calls = 0

    const result = observeSs014SynchronousAdapter(() => {
      calls += 1
      return value
    })

    expect(calls).toBe(1)
    expect(result).toEqual({ ok: true, value })
    expect(result.value).toBe(value)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(value)).toBe(false)
  })

  test('accepts primitive, null, undefined and array synchronous values without domain inspection', () => {
    const values = [0, false, '', null, undefined, ['opaque']]

    for (const value of values) {
      const result = observeSs014SynchronousAdapter(() => value)
      expect(result.ok).toBe(true)
      expect(result.value).toBe(value)
      expect(Object.isFrozen(result)).toBe(true)
    }
  })

  test('fails closed on a thrown adapter without exposing raw error details', () => {
    const rawError = new Error('secret adapter detail')
    const result = observeSs014SynchronousAdapter(() => {
      throw rawError
    })

    expect(result).toEqual({ ok: false, value: null })
    expect(JSON.stringify(result)).not.toContain('secret adapter detail')
  })

  test('fails closed on a fulfilled native Promise and observes its settlement', async () => {
    let calls = 0
    const result = await expectNoUnhandledRejection(() => {
      calls += 1
      return Promise.resolve('must-not-escape')
    })

    expect(calls).toBe(1)
    expect(result).toEqual({ ok: false, value: null })
  })

  test('observes a rejected native Promise before returning and prevents unhandled rejection', async () => {
    let calls = 0
    const result = await expectNoUnhandledRejection(() => {
      calls += 1
      return Promise.reject(new Error('secret rejection detail'))
    })

    expect(calls).toBe(1)
    expect(result).toEqual({ ok: false, value: null })
    expect(JSON.stringify(result)).not.toContain('secret rejection detail')
  })

  test('fails closed and observes a thenable whose then getter throws', async () => {
    let getterCalls = 0
    const hostileThenable = {}
    Object.defineProperty(hostileThenable, 'then', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1
        throw new Error('secret then getter detail')
      },
    })

    const result = await expectNoUnhandledRejection(() => hostileThenable)

    expect(getterCalls).toBeGreaterThanOrEqual(1)
    expect(result).toEqual({ ok: false, value: null })
  })

  test('observes an asynchronously rejecting thenable without an unhandled rejection', async () => {
    let thenCalls = 0
    const rejectingThenable = {
      then: (_resolve, reject) => {
        thenCalls += 1
        queueMicrotask(() => reject(new Error('secret async rejection detail')))
      },
    }

    const result = await expectNoUnhandledRejection(() => rejectingThenable)

    expect(thenCalls).toBe(1)
    expect(result).toEqual({ ok: false, value: null })
  })

  test('does not invoke an adapter a second time after Promise-like detection', async () => {
    let calls = 0
    const result = await expectNoUnhandledRejection(() => {
      calls += 1
      return { then: (_resolve, reject) => queueMicrotask(() => reject(new Error('ignored'))) }
    })

    expect(calls).toBe(1)
    expect(result).toEqual({ ok: false, value: null })
  })
})
