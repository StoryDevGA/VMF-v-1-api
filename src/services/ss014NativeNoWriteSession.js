import { createSs014NativeCommandMonitor } from './ss014NativeCommandMonitor.js'
import { observeSs014SynchronousAdapter } from './ss014SynchronousAdapterObservation.js'

const MAX_RUN_DURATION_MS = 15000

const ERROR_CODES = Object.freeze({
  APPLY_NOT_SUPPORTED: 'SS014_DRY_RUN_APPLY_NOT_SUPPORTED',
  AUTO_CREATE_GUARD_UNAVAILABLE: 'SS014_DRY_RUN_AUTO_CREATE_GUARD_UNAVAILABLE',
  COMMAND_MONITOR_UNAVAILABLE: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
  FULL_STATE_BLOCKED: 'SS014_DRY_RUN_FULL_STATE_BLOCKED',
  PRODUCTION_BLOCKED: 'SS014_DRY_RUN_PRODUCTION_BLOCKED',
  TIMEOUT: 'SS014_DRY_RUN_TIMEOUT',
  UNKNOWN_COMMAND: 'SS014_DRY_RUN_UNKNOWN_COMMAND',
  WRITE_COMMAND_OBSERVED: 'SS014_DRY_RUN_WRITE_COMMAND_OBSERVED',
})

const INPUT_KEYS = ['requestedFlags', 'environmentGuard', 'autoCreateGuard', 'clientFactory', 'clock']
const ENVIRONMENT_KEYS = ['read']
const AUTO_CREATE_KEYS = ['read', 'setFalse', 'restore']
const CLOCK_KEYS = ['now']
const MONITOR_KEYS = ['onCommandStarted', 'onCommandFailed', 'getSnapshot']

const incomplete = (errorCode) => Object.freeze({
  status: 'INCOMPLETE',
  errorCode,
  plan: null,
  planHash: null,
})

const isThenable = (value) => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  try {
    return typeof value.then === 'function'
  } catch {
    return true
  }
}

const isSafeNonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)

const hasOnlyOwnDataKeys = (value, expectedKeys) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    if (Object.getOwnPropertySymbols(value).length > 0) return false
    const ownKeys = Object.getOwnPropertyNames(value)
    if (ownKeys.length !== expectedKeys.length || expectedKeys.some((key) => !ownKeys.includes(key))) return false
    return expectedKeys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable === true
        && !descriptor.get && !descriptor.set)
    })
  } catch {
    return false
  }
}

const isEmptyFlags = (value) => {
  if (!Array.isArray(value)) return false
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
    const ownKeys = Object.getOwnPropertyNames(value)
    if (ownKeys.length !== 1 || ownKeys[0] !== 'length') return false
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    return Boolean(lengthDescriptor && lengthDescriptor.value === 0
      && lengthDescriptor.enumerable === false
      && lengthDescriptor.writable === true
      && lengthDescriptor.configurable === false)
  } catch {
    return false
  }
}

const isCallableDataProperty = (value, key) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable === true
      && typeof descriptor.value === 'function' && !descriptor.get && !descriptor.set)
  } catch {
    return false
  }
}

const getCallableDataProperty = (value, key) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor && descriptor.enumerable === true
      && typeof descriptor.value === 'function' && !descriptor.get && !descriptor.set
      ? descriptor.value
      : null
  } catch {
    return null
  }
}

const safeRead = (object, key) => {
  try {
    return { ok: true, value: object[key] }
  } catch {
    return { ok: false, value: undefined }
  }
}

const safeNow = (clock) => {
  const observed = observeSs014SynchronousAdapter(() => clock.now())
  return observed.ok && isSafeNonNegativeInteger(observed.value)
    ? { ok: true, value: observed.value }
    : { ok: false, value: undefined }
}

const createDeadline = (clock) => {
  const started = safeNow(clock)
  if (!started.ok || started.value > Number.MAX_SAFE_INTEGER - MAX_RUN_DURATION_MS) return null

  let lastNow = started.value
  const expiresAt = started.value + MAX_RUN_DURATION_MS
  return {
    startedAt: started.value,
    expiresAt,
    check: () => {
      const current = safeNow(clock)
      if (!current.ok || current.value < lastNow || current.value >= expiresAt) return false
      lastNow = current.value
      return true
    },
    remaining: () => {
      const current = safeNow(clock)
      if (!current.ok || current.value < lastNow || current.value >= expiresAt) return null
      lastNow = current.value
      return expiresAt - current.value
    },
  }
}

const validateInput = (input) => {
  try {
    if (!hasOnlyOwnDataKeys(input, INPUT_KEYS) || !isEmptyFlags(input.requestedFlags)) return false
    return typeof input.clientFactory === 'function'
  } catch {
    return false
  }
}

const validateEnvironmentGuard = (guard) => {
  if (!hasOnlyOwnDataKeys(guard, ENVIRONMENT_KEYS) || !isCallableDataProperty(guard, 'read')) return false
  const result = safeRead(guard, 'read')
  return result.ok
}

const validateAutoCreateGuard = (guard) => hasOnlyOwnDataKeys(guard, AUTO_CREATE_KEYS)
  && AUTO_CREATE_KEYS.every((key) => isCallableDataProperty(guard, key))

const validateClock = (clock) => hasOnlyOwnDataKeys(clock, CLOCK_KEYS) && isCallableDataProperty(clock, 'now')

const validateMonitor = (monitor) => hasOnlyOwnDataKeys(monitor, MONITOR_KEYS)
  && MONITOR_KEYS.every((key) => isCallableDataProperty(monitor, key))

const validateClient = (client) => {
  if (client === null || (typeof client !== 'object' && typeof client !== 'function') || isThenable(client)) return false
  try {
    const options = client.options
    if (options === null || (typeof options !== 'object' && typeof options !== 'function')
      || options.monitorCommands !== true) return false
    if (typeof client.on !== 'function' || typeof client.listenerCount !== 'function'
      || typeof client.connect !== 'function' || typeof client.close !== 'function') return false
    if (typeof client.off !== 'function' && typeof client.removeListener !== 'function') return false
    return true
  } catch {
    return false
  }
}

const callSynchronous = (callback, args = []) => {
  try {
    const value = callback(...args)
    if (isThenable(value)) {
      try {
        Promise.resolve(value).then(() => undefined, () => undefined)
      } catch {
        // The adapter is already being rejected; no raw thenable detail escapes.
      }
      return { ok: false, value: undefined }
    }
    return { ok: true, value }
  } catch {
    return { ok: false, value: undefined }
  }
}

const readListenerCount = (client, eventName) => {
  const observed = observeSs014SynchronousAdapter(() => client.listenerCount(eventName))
  return observed.ok && isSafeNonNegativeInteger(observed.value)
    ? { ok: true, value: observed.value }
    : { ok: false, value: undefined }
}

const runBounded = async (operation, deadline, { forceStart = false } = {}) => {
  if (!forceStart && !deadline.check()) return { ok: false, code: ERROR_CODES.TIMEOUT }

  let operationResult
  try {
    operationResult = operation()
  } catch {
    return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
  }
  if (!isThenable(operationResult)) return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }

  const remaining = deadline.remaining()
  if (remaining === null) {
    if (forceStart) {
      try {
        Promise.resolve(operationResult).then(() => undefined, () => undefined)
      } catch {
        // The original operation has already been attempted and is fail-closed.
      }
    }
    return { ok: false, code: ERROR_CODES.TIMEOUT }
  }

  let timerId
  let timerPromise
  try {
    timerPromise = new Promise((resolve) => {
      timerId = setTimeout(() => resolve({ kind: 'timeout' }), remaining)
    })
  } catch {
    return { ok: false, code: ERROR_CODES.TIMEOUT }
  }

  let observed
  try {
    observed = Promise.resolve(operationResult).then(
      () => ({ kind: 'settled', ok: true }),
      () => ({ kind: 'settled', ok: false }),
    )
  } catch {
    try { clearTimeout(timerId) } catch { /* mapped below */ }
    return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
  }

  let result
  let raceFailed = false
  try {
    result = await Promise.race([observed, timerPromise])
  } catch {
    raceFailed = true
  } finally {
    try {
      clearTimeout(timerId)
    } catch {
      raceFailed = true
    }
  }
  if (raceFailed) return { ok: false, code: ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
  if (result.kind === 'timeout') return { ok: false, code: ERROR_CODES.TIMEOUT }
  if (!result.ok || !deadline.check()) return { ok: false, code: result.ok ? ERROR_CODES.TIMEOUT : ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE }
  return { ok: true }
}

const buildReadyReceipt = (snapshot) => Object.freeze({
  status: 'READY',
  monitorInstalledBeforeConnect: true,
  monitorRemoved: true,
  commandEventCount: snapshot.commandEventCount,
  commandClasses: Object.freeze({
    setup: snapshot.commandClasses.setup,
    read: snapshot.commandClasses.read,
    teardown: snapshot.commandClasses.teardown,
  }),
  cleanDisconnect: true,
  autoCreateRestored: true,
})

const runSs014NativeNoWriteSession = async (input) => {
  if (!validateInput(input)) return incomplete(ERROR_CODES.APPLY_NOT_SUPPORTED)

  if (!validateEnvironmentGuard(input.environmentGuard)) return incomplete(ERROR_CODES.PRODUCTION_BLOCKED)
  if (!validateAutoCreateGuard(input.autoCreateGuard)) return incomplete(ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE)
  if (!validateClock(input.clock)) return incomplete(ERROR_CODES.TIMEOUT)

  let previousAutoCreate
  let autoCreateCaptured = false
  let client = null
  let removeMethodName = null
  let attachedListeners = []
  let originalListenerCounts = new Map()
  let monitor = null
  let deadline = null
  let primaryFailure = null
  let timeoutFailure = false
  let teardownFailure = false
  let restorationFailure = false

  const setPrimaryFailure = (code) => {
    if (code === ERROR_CODES.TIMEOUT) timeoutFailure = true
    else if (!primaryFailure) primaryFailure = code
  }

  const callGuarded = (callback, args, failureCode) => {
    if (!deadline || !deadline.check()) return { ok: false, code: ERROR_CODES.TIMEOUT, result: null }
    const result = callSynchronous(callback, args)
    if (!deadline.check()) return { ok: false, code: ERROR_CODES.TIMEOUT, result }
    return result.ok ? { ok: true, value: result.value, result } : { ok: false, code: failureCode, result }
  }

  const callCleanup = (callback, args) => {
    const before = deadline ? deadline.check() : false
    const result = callSynchronous(callback, args)
    const after = deadline ? deadline.check() : false
    if (!before || !after) timeoutFailure = true
    return result
  }

  const environmentReadMethod = getCallableDataProperty(input.environmentGuard, 'read')
  const environmentRead = callSynchronous(environmentReadMethod)
  if (!environmentRead.ok || environmentRead.value === null || typeof environmentRead.value !== 'object') {
    return incomplete(ERROR_CODES.PRODUCTION_BLOCKED)
  }
  try {
    const environment = environmentRead.value
    if (!hasOnlyOwnDataKeys(environment, ['environmentClass', 'isProduction', 'isAppProduction'])
      || environment.environmentClass !== 'DEVELOPMENT_TEST'
      || environment.isProduction !== false
      || environment.isAppProduction !== false) {
      return incomplete(ERROR_CODES.PRODUCTION_BLOCKED)
    }
  } catch {
    return incomplete(ERROR_CODES.PRODUCTION_BLOCKED)
  }

  deadline = createDeadline(input.clock)
  if (!deadline || !deadline.check()) return incomplete(ERROR_CODES.TIMEOUT)

  const autoCreateReadMethod = getCallableDataProperty(input.autoCreateGuard, 'read')
  const autoCreateSetFalseMethod = getCallableDataProperty(input.autoCreateGuard, 'setFalse')
  const autoCreateRestoreMethod = getCallableDataProperty(input.autoCreateGuard, 'restore')
  const previousRead = callGuarded(autoCreateReadMethod, [], ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE)
  if (previousRead.result?.ok && typeof previousRead.result.value === 'boolean') {
    previousAutoCreate = previousRead.result.value
    autoCreateCaptured = true
  }

  const restoreAutoCreate = () => {
    if (!autoCreateCaptured) return
    const restored = callCleanup(autoCreateRestoreMethod, [previousAutoCreate])
    if (!restored.ok) restorationFailure = true
  }

  try {
    if (!previousRead.ok) setPrimaryFailure(previousRead.code)

    if (!primaryFailure && !timeoutFailure) {
      const setFalse = callGuarded(autoCreateSetFalseMethod, [], ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE)
      if (!setFalse.ok) setPrimaryFailure(setFalse.code)
    }

    if (!primaryFailure && !timeoutFailure) {
      const verifiedFalse = callGuarded(autoCreateReadMethod, [], ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE)
      if (!verifiedFalse.ok || verifiedFalse.value !== false) {
        setPrimaryFailure(verifiedFalse.ok ? ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE : verifiedFalse.code)
      }
    }

    if (!primaryFailure && !timeoutFailure) {
      if (!deadline.check()) {
        setPrimaryFailure(ERROR_CODES.TIMEOUT)
      }
      const factoryResult = !primaryFailure && !timeoutFailure
        ? callSynchronous(input.clientFactory, [{ monitorCommands: true }])
        : { ok: false, value: undefined }
      if (!deadline.check()) setPrimaryFailure(ERROR_CODES.TIMEOUT)
      if (!factoryResult.ok && !timeoutFailure) {
        setPrimaryFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
      } else if (factoryResult.ok) {
        client = factoryResult.value
        if (timeoutFailure) {
          setPrimaryFailure(ERROR_CODES.TIMEOUT)
        } else if (!validateClient(client)) {
          setPrimaryFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
        } else {
          removeMethodName = typeof client.off === 'function' ? 'off' : 'removeListener'
          monitor = createSs014NativeCommandMonitor()
          if (!validateMonitor(monitor)) {
            setPrimaryFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
          } else {
          const eventDefinitions = [
            ['commandStarted', monitor.onCommandStarted],
            ['commandFailed', monitor.onCommandFailed],
          ]
          for (const [eventName, handler] of eventDefinitions) {
            if (!deadline.check()) {
              setPrimaryFailure(ERROR_CODES.TIMEOUT)
              break
            }
            const countBefore = readListenerCount(client, eventName)
            if (!countBefore.ok) {
              setPrimaryFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
              break
            }
            if (!deadline.check()) {
              setPrimaryFailure(ERROR_CODES.TIMEOUT)
              break
            }
            originalListenerCounts.set(eventName, countBefore.value)
            const attached = callSynchronous(client.on.bind(client), [eventName, handler])
            if (!attached.ok || (attached.value !== undefined && attached.value !== client)) {
              setPrimaryFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
              break
            }
            attachedListeners.push([eventName, handler])
            if (!deadline.check()) {
              setPrimaryFailure(ERROR_CODES.TIMEOUT)
              break
            }
            const countAfter = readListenerCount(client, eventName)
            if (!countAfter.ok || countAfter.value !== countBefore.value + 1) {
              setPrimaryFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
              break
            }
          }

          if (!primaryFailure && !timeoutFailure && attachedListeners.length === 2) {
            const snapshot = monitor.getSnapshot()
            if (snapshot.failureCode) setPrimaryFailure(snapshot.failureCode)
          }

          if (!primaryFailure && !timeoutFailure && attachedListeners.length === 2) {
            const connected = await runBounded(() => client.connect(), deadline)
            if (!connected.ok) setPrimaryFailure(connected.code)
          }
          }
        }
      }
    }
  } catch {
    setPrimaryFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
  }

  const closeMethod = client ? safeRead(client, 'close') : { ok: false, value: undefined }
  if (client && closeMethod.ok && typeof closeMethod.value === 'function') {
    if (!deadline) teardownFailure = true
    else {
      const closed = await runBounded(() => closeMethod.value.call(client), deadline, { forceStart: true })
      if (!closed.ok) teardownFailure = true
    }
  } else if (client) {
    teardownFailure = true
  }

  if (client && removeMethodName && attachedListeners.length > 0) {
    for (const [eventName, handler] of [...attachedListeners].reverse()) {
      const removeMethod = safeRead(client, removeMethodName)
      const removed = removeMethod.ok && typeof removeMethod.value === 'function'
        ? callCleanup(removeMethod.value.bind(client), [eventName, handler])
        : { ok: false, value: undefined }
      if (!removed.ok || (removed.value !== undefined && removed.value !== client)) teardownFailure = true
    }
    for (const [eventName] of attachedListeners) {
      const expected = originalListenerCounts.get(eventName)
      const before = deadline ? deadline.check() : false
      const count = readListenerCount(client, eventName)
      const after = deadline ? deadline.check() : false
      if (!before || !after) timeoutFailure = true
      if (!count.ok || count.value !== expected) teardownFailure = true
    }
  }

  restoreAutoCreate()

  let monitorSnapshot = null
  try {
    if (monitor) monitorSnapshot = monitor.getSnapshot()
  } catch {
    setPrimaryFailure(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
  }

  if (restorationFailure) return incomplete(ERROR_CODES.AUTO_CREATE_GUARD_UNAVAILABLE)
  if (teardownFailure) return incomplete(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
  if (timeoutFailure) return incomplete(ERROR_CODES.TIMEOUT)
  if (monitorSnapshot?.failureCode) return incomplete(monitorSnapshot.failureCode)
  if (primaryFailure) return incomplete(primaryFailure)
  if (!monitorSnapshot || !deadline) return incomplete(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)

  return buildReadyReceipt(monitorSnapshot)
}

export { runSs014NativeNoWriteSession }
