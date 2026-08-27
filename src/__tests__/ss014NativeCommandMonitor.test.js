import { describe, expect, test } from '@jest/globals'

import * as monitorModule from '../services/ss014NativeCommandMonitor.js'

const { createSs014NativeCommandMonitor } = monitorModule

const commandEvent = (commandName, commandValue = true, extra = {}) => ({
  commandName,
  command: {
    [commandName]: commandValue,
    ...extra,
  },
})

const expectSnapshot = (monitor, expected) => {
  expect(monitor.getSnapshot()).toEqual(expected)
}

describe('SS-014 pure native command monitor', () => {
  test('exports exactly one factory and returns the exact frozen monitor API', () => {
    expect(Object.keys(monitorModule)).toEqual(['createSs014NativeCommandMonitor'])

    const monitor = createSs014NativeCommandMonitor()
    expect(Object.keys(monitor)).toEqual(['onCommandStarted', 'onCommandFailed', 'getSnapshot'])
    expect(Object.isFrozen(monitor)).toBe(true)
    expect(Object.values(monitor).every((value) => typeof value === 'function')).toBe(true)
    expect(monitor.getSnapshot()).toEqual({
      commandEventCount: 0,
      commandClasses: { setup: 0, read: 0, teardown: 0 },
      failureCode: null,
    })
  })

  test('classifies every setup, read and teardown command with the command-started count', () => {
    const monitor = createSs014NativeCommandMonitor()
    const setup = ['hello', 'isMaster', 'ismaster', 'saslStart', 'saslContinue', 'authenticate', 'getnonce', 'ping']
    const reads = ['listCollections', 'collStats', 'find', 'count', 'getMore', 'killCursors']
    const teardown = ['endSessions', 'logout']

    for (const commandName of [...setup, ...reads, ...teardown]) {
      monitor.onCommandStarted(commandEvent(commandName))
    }

    expectSnapshot(monitor, {
      commandEventCount: 16,
      commandClasses: { setup: 8, read: 6, teardown: 2 },
      failureCode: null,
    })
  })

  test('accepts a safe native command event wrapper with a non-plain prototype', () => {
    const monitor = createSs014NativeCommandMonitor()
    const nativeEvent = Object.create({ driverEventType: 'CommandStartedEvent' })
    nativeEvent.commandName = 'ping'
    nativeEvent.command = { ping: true }

    monitor.onCommandStarted(nativeEvent)

    expectSnapshot(monitor, {
      commandEventCount: 1,
      commandClasses: { setup: 1, read: 0, teardown: 0 },
      failureCode: null,
    })
  })

  test('latches write-observed for every write-like command without classifying it as a read', () => {
    const monitor = createSs014NativeCommandMonitor()
    const writes = [
      'insert', 'update', 'delete', 'findAndModify', 'bulkWrite', 'create', 'createIndexes',
      'drop', 'dropDatabase', 'renameCollection', 'collMod', 'dropIndexes',
      'commitTransaction', 'abortTransaction',
    ]

    for (const commandName of writes) monitor.onCommandStarted(commandEvent(commandName))

    expectSnapshot(monitor, {
      commandEventCount: writes.length,
      commandClasses: { setup: 0, read: 0, teardown: 0 },
      failureCode: 'SS014_DRY_RUN_WRITE_COMMAND_OBSERVED',
    })
  })

  test('latches unknown commands only after a safe command body is supplied', () => {
    const monitor = createSs014NativeCommandMonitor()
    monitor.onCommandStarted(commandEvent('notARealCommand', { anything: true }))
    expectSnapshot(monitor, {
      commandEventCount: 1,
      commandClasses: { setup: 0, read: 0, teardown: 0 },
      failureCode: 'SS014_DRY_RUN_UNKNOWN_COMMAND',
    })
  })

  test('rejects malformed events and missing matching command keys without throwing raw details', () => {
    const monitor = createSs014NativeCommandMonitor()
    const malformed = [
      null,
      [],
      { commandName: 'find' },
      { command: { find: true } },
      { commandName: 'find', command: null },
      { commandName: 'find', command: { other: true } },
      { commandName: 'notARealCommand', command: { other: true } },
      { commandName: 'find', command: { find: true, projection: 'not-an-object' } },
    ]

    for (const event of malformed) expect(() => monitor.onCommandStarted(event)).not.toThrow()

    expectSnapshot(monitor, {
      commandEventCount: malformed.length,
      commandClasses: { setup: 0, read: 0, teardown: 0 },
      failureCode: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
    })
  })

  test('blocks an own framework_state projection without incrementing the read count', () => {
    const monitor = createSs014NativeCommandMonitor()
    monitor.onCommandStarted(commandEvent('find', true, {
      projection: { framework_state: 0 },
    }))

    expectSnapshot(monitor, {
      commandEventCount: 1,
      commandClasses: { setup: 0, read: 0, teardown: 0 },
      failureCode: 'SS014_DRY_RUN_FULL_STATE_BLOCKED',
    })
  })

  test('rejects symbol, prototype, accessor, inherited and non-enumerable descriptor drift', () => {
    const monitor = createSs014NativeCommandMonitor()

    const withSymbol = commandEvent('find')
    withSymbol[Symbol('raw')] = 'secret'

    const inheritedName = { command: { find: true } }
    Object.setPrototypeOf(inheritedName, { commandName: 'find' })

    const accessorCommand = { commandName: 'find' }
    Object.defineProperty(accessorCommand, 'command', {
      configurable: true,
      enumerable: true,
      get: () => ({ find: true }),
    })

    const hiddenCommand = { commandName: 'find' }
    Object.defineProperty(hiddenCommand, 'command', {
      configurable: true,
      enumerable: false,
      value: { find: true },
      writable: true,
    })

    const customCommand = commandEvent('find')
    customCommand.command = Object.assign(Object.create({ inherited: true }), { find: true })

    const inheritedMatch = commandEvent('find')
    const inheritedCommand = Object.create({ find: true })
    Object.defineProperty(inheritedCommand, 'projection', {
      configurable: true,
      enumerable: true,
      value: {},
      writable: true,
    })
    inheritedMatch.command = inheritedCommand

    const hiddenProjection = commandEvent('find')
    Object.defineProperty(hiddenProjection.command, 'projection', {
      configurable: true,
      enumerable: true,
      value: Object.defineProperty({}, 'framework_state', {
        configurable: true,
        enumerable: false,
        value: 0,
        writable: true,
      }),
      writable: true,
    })

    for (const event of [withSymbol, inheritedName, accessorCommand, hiddenCommand, customCommand, inheritedMatch, hiddenProjection]) {
      expect(() => monitor.onCommandStarted(event)).not.toThrow()
    }

    expectSnapshot(monitor, {
      commandEventCount: 7,
      commandClasses: { setup: 0, read: 0, teardown: 0 },
      failureCode: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
    })
  })

  test('accepts null-prototype event and command records and fails closed on late proxy access errors', () => {
    const monitor = createSs014NativeCommandMonitor()
    const nullPrototypeEvent = Object.create(null)
    nullPrototypeEvent.commandName = 'ping'
    nullPrototypeEvent.command = Object.create(null)
    nullPrototypeEvent.command.ping = true
    monitor.onCommandStarted(nullPrototypeEvent)

    const proxyEvent = new Proxy(commandEvent('ping'), {
      get(target, property, receiver) {
        if (property === 'commandName') throw new Error('raw proxy access')
        return Reflect.get(target, property, receiver)
      },
    })
    expect(() => monitor.onCommandStarted(proxyEvent)).not.toThrow()

    expectSnapshot(monitor, {
      commandEventCount: 2,
      commandClasses: { setup: 1, read: 0, teardown: 0 },
      failureCode: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
    })
  })

  test('latches commandFailed without consuming the command-started event budget or retaining the event', () => {
    const monitor = createSs014NativeCommandMonitor()
    const secret = { command: { insert: { secret: 'do-not-retain' } } }
    monitor.onCommandStarted(commandEvent('ping'))
    monitor.onCommandFailed(secret)

    const snapshot = monitor.getSnapshot()
    expect(snapshot).toEqual({
      commandEventCount: 1,
      commandClasses: { setup: 1, read: 0, teardown: 0 },
      failureCode: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
    })
    expect(JSON.stringify(snapshot)).not.toContain('do-not-retain')
  })

  test('does not latch an absent fixed collection reported by collStats NamespaceNotFound', () => {
    const monitor = createSs014NativeCommandMonitor()
    const failure = new Error('redacted test error')
    Object.defineProperty(failure, 'code', { enumerable: true, value: 26 })
    Object.defineProperty(failure, 'codeName', { enumerable: true, value: 'NamespaceNotFound' })

    monitor.onCommandFailed({
      commandName: 'collStats',
      failure,
    })

    expectSnapshot(monitor, {
      commandEventCount: 0,
      commandClasses: { setup: 0, read: 0, teardown: 0 },
      failureCode: null,
    })
  })

  test('uses sticky severity and never downgrades a later monitor failure', () => {
    const monitor = createSs014NativeCommandMonitor()
    monitor.onCommandStarted(commandEvent('notARealCommand'))
    monitor.onCommandStarted(commandEvent('insert'))
    monitor.onCommandStarted(commandEvent('find', true, { projection: { framework_state: 0 } }))
    expectSnapshot(monitor, {
      commandEventCount: 3,
      commandClasses: { setup: 0, read: 0, teardown: 0 },
      failureCode: 'SS014_DRY_RUN_WRITE_COMMAND_OBSERVED',
    })

    monitor.onCommandFailed({ raw: 'ignored' })
    monitor.onCommandStarted(commandEvent('ping'))
    expectSnapshot(monitor, {
      commandEventCount: 4,
      commandClasses: { setup: 1, read: 0, teardown: 0 },
      failureCode: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
    })
  })

  test('enforces the command-started cap at 64 and does not inspect event 65 or later events', () => {
    const monitor = createSs014NativeCommandMonitor()
    for (let index = 0; index < 64; index += 1) monitor.onCommandStarted(commandEvent('ping'))

    const revoked = Proxy.revocable(commandEvent('ping'), {})
    revoked.revoke()
    expect(() => monitor.onCommandStarted(revoked.proxy)).not.toThrow()
    monitor.onCommandStarted(commandEvent('ping'))
    monitor.onCommandFailed(new Proxy({}, { get() { throw new Error('must not inspect') } }))

    expectSnapshot(monitor, {
      commandEventCount: 64,
      commandClasses: { setup: 64, read: 0, teardown: 0 },
      failureCode: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
    })
  })

  test('returns deeply frozen snapshots that cannot mutate monitor state', () => {
    const monitor = createSs014NativeCommandMonitor()
    monitor.onCommandStarted(commandEvent('ping'))
    const snapshot = monitor.getSnapshot()

    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.commandClasses)).toBe(true)
    expect(() => { snapshot.commandClasses.setup = 99 }).toThrow()
    expect(() => { snapshot.failureCode = 'raw' }).toThrow()

    expectSnapshot(monitor, {
      commandEventCount: 1,
      commandClasses: { setup: 1, read: 0, teardown: 0 },
      failureCode: null,
    })
  })
})
