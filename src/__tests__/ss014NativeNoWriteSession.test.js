import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { runSs014NativeNoWriteSession } from '../services/ss014NativeNoWriteSession.js'

const makeEnvironmentGuard = (overrides = {}) => ({
  read: jest.fn(() => ({
    environmentClass: 'DEVELOPMENT_TEST',
    isProduction: false,
    isAppProduction: false,
    ...overrides,
  })),
})

const makeAutoCreateGuard = (initial = true, overrides = {}) => {
  let current = initial
  return {
    read: () => current,
    setFalse: () => { current = false },
    restore: (previous) => { current = previous },
    ...overrides,
  }
}

const makeClient = ({ connect = () => Promise.resolve(), close = () => Promise.resolve(), on = null, off = null } = {}) => {
  const listeners = new Map()
  const client = {
    options: { monitorCommands: true },
    on(eventName, handler) {
      if (on) return on.call(client, eventName, handler)
      const existing = listeners.get(eventName) || []
      existing.push(handler)
      listeners.set(eventName, existing)
      return client
    },
    off(eventName, handler) {
      if (off) return off.call(client, eventName, handler)
      const existing = listeners.get(eventName) || []
      listeners.set(eventName, existing.filter((candidate) => candidate !== handler))
      return client
    },
    listenerCount(eventName) {
      return (listeners.get(eventName) || []).length
    },
    connect,
    close,
    db: jest.fn(() => { throw new Error('db must not be called') }),
    collection: jest.fn(() => { throw new Error('collection must not be called') }),
    write: jest.fn(() => { throw new Error('write must not be called') }),
  }
  return client
}

const makeClock = (values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) => {
  let index = 0
  return {
    now: jest.fn(() => values[Math.min(index++, values.length - 1)]),
  }
}

const makeInput = (overrides = {}) => ({
  requestedFlags: [],
  environmentGuard: makeEnvironmentGuard(),
  autoCreateGuard: makeAutoCreateGuard(),
  clientFactory: jest.fn(() => makeClient()),
  clock: makeClock(),
  ...overrides,
})

const nextHostTurn = () => new Promise((resolve) => setImmediate(resolve))

const expectNoUnhandledRejection = async (operation, errorCode) => {
  const unhandledReasons = []
  const onUnhandledRejection = (reason) => {
    unhandledReasons.push(reason)
  }

  process.on('unhandledRejection', onUnhandledRejection)
  try {
    await expectIncomplete(operation(), errorCode)
    await Promise.resolve()
    await Promise.resolve()
    await nextHostTurn()
    expect(unhandledReasons).toEqual([])
  } finally {
    process.removeListener('unhandledRejection', onUnhandledRejection)
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

afterEach(() => {
  jest.useRealTimers()
})

describe('SS-014 native no-write session orchestrator', () => {
  test('exports one function and returns a frozen ready receipt with monitor-before-connect order', async () => {
    const input = makeInput()
    const client = makeClient()
    const order = []
    const baseOn = client.on.bind(client)
    const baseOff = client.off.bind(client)
    client.on = jest.fn(function on(eventName, handler) {
      order.push(`on:${eventName}`)
      return baseOn(eventName, handler)
    })
    client.connect = jest.fn(async () => { order.push('connect') })
    client.close = jest.fn(async () => { order.push('close') })
    client.off = jest.fn(function off(eventName, handler) {
      order.push(`off:${eventName}`)
      return baseOff(eventName, handler)
    })
    input.clientFactory = jest.fn(() => client)

    const result = await runSs014NativeNoWriteSession(input)

    expect(result).toEqual({
      status: 'READY',
      monitorInstalledBeforeConnect: true,
      monitorRemoved: true,
      commandEventCount: 0,
      commandClasses: { setup: 0, read: 0, teardown: 0 },
      cleanDisconnect: true,
      autoCreateRestored: true,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.commandClasses)).toBe(true)
    expect(order).toEqual(['on:commandStarted', 'on:commandFailed', 'connect', 'close', 'off:commandFailed', 'off:commandStarted'])
    expect(input.clientFactory).toHaveBeenCalledWith({ monitorCommands: true })
  })

  test('rejects flags before any guard or factory call', async () => {
    const input = makeInput({ requestedFlags: ['APPLY'] })
    await expectIncomplete(runSs014NativeNoWriteSession(input), 'SS014_DRY_RUN_APPLY_NOT_SUPPORTED')
    expect(input.environmentGuard.read).not.toHaveBeenCalled?.()
    expect(input.clientFactory).not.toHaveBeenCalled()
  })

  test('rejects malformed empty flag arrays, outer descriptors and adapter shapes', async () => {
    const extraFlag = []
    extraFlag.extra = true
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ requestedFlags: extraFlag })), 'SS014_DRY_RUN_APPLY_NOT_SUPPORTED')

    const accessorFlags = []
    Object.defineProperty(accessorFlags, 'extra', { configurable: true, enumerable: true, get: () => undefined })
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ requestedFlags: accessorFlags })), 'SS014_DRY_RUN_APPLY_NOT_SUPPORTED')

    const outer = makeInput()
    Object.defineProperty(outer, 'extra', { configurable: true, enumerable: true, value: true, writable: true })
    await expectIncomplete(runSs014NativeNoWriteSession(outer), 'SS014_DRY_RUN_APPLY_NOT_SUPPORTED')

    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ environmentGuard: { read: 1 } })), 'SS014_DRY_RUN_PRODUCTION_BLOCKED')
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ autoCreateGuard: { read() {}, setFalse() {} } })), 'SS014_DRY_RUN_AUTO_CREATE_GUARD_UNAVAILABLE')
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clock: { now: 1 } })), 'SS014_DRY_RUN_TIMEOUT')
  })

  test('fails closed on environment mismatch and does not touch autoCreate', async () => {
    const auto = makeAutoCreateGuard()
    const spy = jest.spyOn(auto, 'read')
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({
      environmentGuard: makeEnvironmentGuard({ isAppProduction: true }),
      autoCreateGuard: auto,
    })), 'SS014_DRY_RUN_PRODUCTION_BLOCKED')
    expect(spy).not.toHaveBeenCalled()
  })

  test('restores autoCreate when setFalse or verification fails', async () => {
    let restored = 0
    const auto = makeAutoCreateGuard(true, {
      setFalse: () => { throw new Error('set failed') },
      restore: (previous) => { if (previous === true) restored += 1 },
    })
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ autoCreateGuard: auto })), 'SS014_DRY_RUN_AUTO_CREATE_GUARD_UNAVAILABLE')
    expect(restored).toBe(1)

    let reads = 0
    const verifyFailure = makeAutoCreateGuard(true, {
      read: () => { reads += 1; return reads === 1 ? true : 'not-false' },
    })
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ autoCreateGuard: verifyFailure })), 'SS014_DRY_RUN_AUTO_CREATE_GUARD_UNAVAILABLE')
  })

  test('restoration failure overrides the original failure and malformed factory clients do not connect', async () => {
    const auto = makeAutoCreateGuard(true, {
      setFalse: () => { throw new Error('set failed') },
      restore: () => { throw new Error('restore failed') },
    })
    const factory = jest.fn(() => ({ options: { monitorCommands: true } }))
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ autoCreateGuard: auto, clientFactory: factory })), 'SS014_DRY_RUN_AUTO_CREATE_GUARD_UNAVAILABLE')
    expect(factory).not.toHaveBeenCalled()

    const malformedFactory = jest.fn(() => ({ options: { monitorCommands: false }, close: jest.fn() }))
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clientFactory: malformedFactory })), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
  })

  test('maps R1 write, unknown, full-state and command-failed events into fixed incomplete receipts', async () => {
    const makeEmittingClient = (event, payload) => makeClient({
      connect: async function connect() {
        const handlers = this.__handlers?.get(event) || []
        handlers.forEach((handler) => handler(payload))
      },
    })
    const cases = [
      ['write', { commandName: 'insert', command: { insert: true } }, 'SS014_DRY_RUN_WRITE_COMMAND_OBSERVED'],
      ['unknown', { commandName: 'mystery', command: { mystery: true } }, 'SS014_DRY_RUN_UNKNOWN_COMMAND'],
      ['full', { commandName: 'find', command: { find: true, projection: { framework_state: 0 } } }, 'SS014_DRY_RUN_FULL_STATE_BLOCKED'],
    ]
    for (const [name, event] of cases) {
      const client = makeClient()
      const handlers = new Map()
      client.on = jest.fn(function on(eventName, handler) {
        handlers.set(eventName, [...(handlers.get(eventName) || []), handler])
        return client
      })
      client.off = jest.fn(function off(eventName, handler) {
        handlers.set(eventName, (handlers.get(eventName) || []).filter((candidate) => candidate !== handler))
        return client
      })
      client.listenerCount = jest.fn((eventName) => (handlers.get(eventName) || []).length)
      client.connect = jest.fn(async () => { (handlers.get('commandStarted') || []).forEach((handler) => handler(event)) })
      await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clientFactory: jest.fn(() => client) })), cases.find(([label]) => label === name)[2])
    }

    const failedClient = makeClient()
    const failedHandlers = new Map()
    failedClient.on = jest.fn(function on(eventName, handler) {
      failedHandlers.set(eventName, [...(failedHandlers.get(eventName) || []), handler])
      return failedClient
    })
    failedClient.off = jest.fn(function off(eventName, handler) {
      failedHandlers.set(eventName, (failedHandlers.get(eventName) || []).filter((candidate) => candidate !== handler))
      return failedClient
    })
    failedClient.listenerCount = jest.fn((eventName) => (failedHandlers.get(eventName) || []).length)
    failedClient.connect = jest.fn(async () => { (failedHandlers.get('commandFailed') || []).forEach((handler) => handler({ secret: 'ignored' })) })
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clientFactory: jest.fn(() => failedClient) })), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
  })

  test('fails closed on listener attach/count drift and never connects', async () => {
    const off = jest.fn()
    const client = makeClient({ on: () => { throw new Error('attach failed') }, off })
    const connect = jest.spyOn(client, 'connect')
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clientFactory: jest.fn(() => client) })), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
    expect(connect).not.toHaveBeenCalled()
    expect(off).not.toHaveBeenCalled()

    const driftClient = makeClient({ on: function on() { return this } })
    driftClient.listenerCount = jest.fn(() => 8)
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clientFactory: jest.fn(() => driftClient) })), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
  })

  test('maps connect/close failures and preserves cleanup precedence', async () => {
    const close = jest.fn(async () => { throw new Error('close failed') })
    const connectClient = makeClient({ connect: async () => { throw new Error('connect failed') }, close })
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clientFactory: jest.fn(() => connectClient) })), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
    expect(close).toHaveBeenCalledTimes(1)

    const removalClient = makeClient({ off: () => { throw new Error('remove failed') } })
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clientFactory: jest.fn(() => removalClient) })), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
  })

  test('fails closed when a connect result has a hostile then accessor', async () => {
    const hostileThenable = {}
    Object.defineProperty(hostileThenable, 'then', {
      configurable: true,
      enumerable: true,
      get: () => { throw new Error('hostile then') },
    })
    const client = makeClient({ connect: () => hostileThenable })
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clientFactory: jest.fn(() => client) })), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
  })

  test('observes rejected synchronous-adapter thenables before returning incomplete', async () => {
    const rejectedFactory = jest.fn(() => Promise.reject(new Error('factory rejection must be observed')))
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clientFactory: rejectedFactory })), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')

    const rejectedAuto = makeAutoCreateGuard(true, {
      setFalse: () => Promise.reject(new Error('guard rejection must be observed')),
    })
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ autoCreateGuard: rejectedAuto })), 'SS014_DRY_RUN_AUTO_CREATE_GUARD_UNAVAILABLE')
  })

  test('observes a rejected clock Promise and preserves the timeout result', async () => {
    const clock = {
      now: jest.fn(() => Promise.reject(new Error('clock rejection must be observed'))),
    }

    await expectNoUnhandledRejection(
      () => runSs014NativeNoWriteSession(makeInput({ clock })),
      'SS014_DRY_RUN_TIMEOUT',
    )

    expect(clock.now).toHaveBeenCalledTimes(1)
  })

  test('observes a rejected listener-count Promise and preserves monitor failure', async () => {
    const client = makeClient()
    client.listenerCount = jest.fn(() => Promise.reject(new Error('listener rejection must be observed')))

    await expectNoUnhandledRejection(
      () => runSs014NativeNoWriteSession(makeInput({ clientFactory: jest.fn(() => client) })),
      'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
    )

    expect(client.listenerCount).toHaveBeenCalledTimes(1)
  })

  test('bounds never-settling connect with the deadline timer and still attempts close', async () => {
    jest.useFakeTimers()
    const close = jest.fn(() => Promise.resolve())
    const client = makeClient({ connect: () => new Promise(() => {}), close })
    const promise = runSs014NativeNoWriteSession(makeInput({ clientFactory: jest.fn(() => client) }))
    await jest.advanceTimersByTimeAsync(15000)
    await expectIncomplete(promise, 'SS014_DRY_RUN_TIMEOUT')
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('attempts close even when the clock expires immediately after connect starts', async () => {
    let expired = false
    const clock = { now: jest.fn(() => (expired ? 15000 : 0)) }
    const close = jest.fn(() => new Promise(() => {}))
    const client = makeClient({
      connect: () => {
        expired = true
        return new Promise(() => {})
      },
      close,
    })
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({
      clock,
      clientFactory: jest.fn(() => client),
    })), 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE')
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('rejects invalid, backward and overflow clocks without success', async () => {
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clock: { now: () => -1 } })), 'SS014_DRY_RUN_TIMEOUT')
    const backward = makeClock([5, 4])
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clock: backward })), 'SS014_DRY_RUN_TIMEOUT')
    const overflow = makeClock([Number.MAX_SAFE_INTEGER])
    await expectIncomplete(runSs014NativeNoWriteSession(makeInput({ clock: overflow })), 'SS014_DRY_RUN_TIMEOUT')
  })

  test('does not call database, collection, cursor or write methods', async () => {
    const client = makeClient()
    const input = makeInput({ clientFactory: jest.fn(() => client) })
    await runSs014NativeNoWriteSession(input)
    expect(client.db).not.toHaveBeenCalled()
    expect(client.collection).not.toHaveBeenCalled()
    expect(client.write).not.toHaveBeenCalled()
  })
})
