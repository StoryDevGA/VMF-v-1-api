const MAX_COMMAND_STARTED_EVENTS = 64

const FAILURE_CODES = Object.freeze({
  COMMAND_MONITOR_UNAVAILABLE: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
  FULL_STATE_BLOCKED: 'SS014_DRY_RUN_FULL_STATE_BLOCKED',
  UNKNOWN_COMMAND: 'SS014_DRY_RUN_UNKNOWN_COMMAND',
  WRITE_COMMAND_OBSERVED: 'SS014_DRY_RUN_WRITE_COMMAND_OBSERVED',
})

const COMMAND_CLASSES = Object.freeze({
  setup: new Set(['hello', 'isMaster', 'ismaster', 'saslStart', 'saslContinue', 'authenticate', 'getnonce', 'ping']),
  read: new Set(['listCollections', 'collStats', 'find', 'count', 'getMore', 'killCursors']),
  teardown: new Set(['endSessions', 'logout']),
  write: new Set([
    'insert',
    'update',
    'delete',
    'findAndModify',
    'bulkWrite',
    'create',
    'createIndexes',
    'drop',
    'dropDatabase',
    'renameCollection',
    'collMod',
    'dropIndexes',
    'commitTransaction',
    'abortTransaction',
  ]),
})

const FAILURE_SEVERITY = Object.freeze({
  [FAILURE_CODES.UNKNOWN_COMMAND]: 1,
  [FAILURE_CODES.FULL_STATE_BLOCKED]: 2,
  [FAILURE_CODES.WRITE_COMMAND_OBSERVED]: 3,
  [FAILURE_CODES.COMMAND_MONITOR_UNAVAILABLE]: 4,
})

const isPlainRecord = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    if (Object.getOwnPropertySymbols(value).length > 0) return false

    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set
        || descriptor.enumerable !== true) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

const isSafeCommandEventRecord = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

  try {
    if (Object.getOwnPropertySymbols(value).length > 0) return false

    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set
        || descriptor.enumerable !== true) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

const hasOwnDataProperty = (value, key) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable === true
      && !descriptor.get && !descriptor.set)
  } catch {
    return false
  }
}

const readOwnDataProperty = (value, key) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor && descriptor.enumerable === true
      && !descriptor.get && !descriptor.set
      ? { ok: true, value: descriptor.value }
      : { ok: false, value: undefined }
  } catch {
    return { ok: false, value: undefined }
  }
}

const isNamespaceNotFoundCollStatsFailure = (event) => {
  if (!isSafeCommandEventRecord(event)
    || !hasOwnDataProperty(event, 'commandName')
    || event.commandName !== 'collStats'
    || !hasOwnDataProperty(event, 'failure')) return false

  const failure = readOwnDataProperty(event, 'failure')
  if (!failure.ok || failure.value === null
    || (typeof failure.value !== 'object' && typeof failure.value !== 'function')
    || Array.isArray(failure.value)) return false

  const code = readOwnDataProperty(failure.value, 'code')
  const codeName = readOwnDataProperty(failure.value, 'codeName')
  return (code.ok && code.value === 26) || (codeName.ok && codeName.value === 'NamespaceNotFound')
}

const freezeSnapshot = (snapshot) => Object.freeze({
  commandEventCount: snapshot.commandEventCount,
  commandClasses: Object.freeze({
    setup: snapshot.commandClasses.setup,
    read: snapshot.commandClasses.read,
    teardown: snapshot.commandClasses.teardown,
  }),
  failureCode: snapshot.failureCode,
})

const createSs014NativeCommandMonitor = () => {
  let commandEventCount = 0
  let failureCode = null
  const commandClasses = {
    setup: 0,
    read: 0,
    teardown: 0,
  }

  const latchFailure = (nextFailureCode) => {
    if (!failureCode || FAILURE_SEVERITY[nextFailureCode] > FAILURE_SEVERITY[failureCode]) {
      failureCode = nextFailureCode
    }
  }

  const onCommandStarted = (event) => {
    if (commandEventCount >= MAX_COMMAND_STARTED_EVENTS) {
      latchFailure(FAILURE_CODES.COMMAND_MONITOR_UNAVAILABLE)
      return
    }

    commandEventCount += 1

    try {
      if (!isSafeCommandEventRecord(event)
        || !hasOwnDataProperty(event, 'commandName')
        || !hasOwnDataProperty(event, 'command')) {
        latchFailure(FAILURE_CODES.COMMAND_MONITOR_UNAVAILABLE)
        return
      }

      const commandName = event.commandName
      const command = event.command
      if (typeof commandName !== 'string' || !isPlainRecord(command)
        || !hasOwnDataProperty(command, commandName)) {
        latchFailure(FAILURE_CODES.COMMAND_MONITOR_UNAVAILABLE)
        return
      }

      const isKnownCommand = Object.values(COMMAND_CLASSES).some((commands) => commands.has(commandName))
      if (!isKnownCommand) {
        latchFailure(FAILURE_CODES.UNKNOWN_COMMAND)
        return
      }

      if (COMMAND_CLASSES.write.has(commandName)) {
        latchFailure(FAILURE_CODES.WRITE_COMMAND_OBSERVED)
        return
      }

      if (commandName === 'find' && hasOwnDataProperty(command, 'projection')) {
        if (!isPlainRecord(command.projection)) {
          latchFailure(FAILURE_CODES.COMMAND_MONITOR_UNAVAILABLE)
          return
        }
        if (hasOwnDataProperty(command.projection, 'framework_state')) {
          latchFailure(FAILURE_CODES.FULL_STATE_BLOCKED)
          return
        }
      }

      if (COMMAND_CLASSES.setup.has(commandName)) commandClasses.setup += 1
      else if (COMMAND_CLASSES.read.has(commandName)) commandClasses.read += 1
      else if (COMMAND_CLASSES.teardown.has(commandName)) commandClasses.teardown += 1
    } catch {
      latchFailure(FAILURE_CODES.COMMAND_MONITOR_UNAVAILABLE)
    }
  }

  const onCommandFailed = (event) => {
    if (isNamespaceNotFoundCollStatsFailure(event)) return
    latchFailure(FAILURE_CODES.COMMAND_MONITOR_UNAVAILABLE)
  }

  const getSnapshot = () => freezeSnapshot({
    commandEventCount,
    commandClasses,
    failureCode,
  })

  return Object.freeze({
    onCommandStarted,
    onCommandFailed,
    getSnapshot,
  })
}

export { createSs014NativeCommandMonitor }
