const ERROR_CODES = Object.freeze({
  COMMAND_MONITOR_UNAVAILABLE: 'SS014_DRY_RUN_COMMAND_MONITOR_UNAVAILABLE',
  REDACTION_FAILED: 'SS014_DRY_RUN_REDACTION_FAILED',
  TIMEOUT: 'SS014_DRY_RUN_TIMEOUT',
})

const OPERATION_STATES = new Set([
  'FULFILLED',
  'REJECTED',
  'THREW',
  'NON_PROMISE',
  'PENDING',
])

const DEADLINE_STATES = new Set([
  'OPEN',
  'EXPIRED',
  'CLOCK_FAILED',
  'INVALID',
  'PRE_INVOKE_FAILED',
])

const TIMER_CLEANUP_STATES = new Set(['NOT_ATTEMPTED', 'CLEARED', 'FAILED'])

const hasExactKeys = (value, keys) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false

    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return false

    return ownKeys.every((key) => {
      if (typeof key === 'symbol') return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return Boolean(descriptor
        && 'value' in descriptor
        && descriptor.enumerable === true
        && !descriptor.get
        && !descriptor.set)
    })
  } catch {
    return false
  }
}

const incomplete = (errorCode) => Object.freeze({
  status: 'INCOMPLETE',
  errorCode,
})

const ready = Object.freeze({ status: 'READY' })

const resolveSs014DeadlinePrecedence = (input) => {
  if (!hasExactKeys(input, ['operation', 'deadline', 'timerCleanup'])) {
    return incomplete(ERROR_CODES.REDACTION_FAILED)
  }

  const { operation, deadline, timerCleanup } = input
  if (!OPERATION_STATES.has(operation)
    || !DEADLINE_STATES.has(deadline)
    || !TIMER_CLEANUP_STATES.has(timerCleanup)) {
    return incomplete(ERROR_CODES.REDACTION_FAILED)
  }

  if (deadline !== 'OPEN') return incomplete(ERROR_CODES.TIMEOUT)

  if (operation === 'REJECTED' || operation === 'THREW' || operation === 'NON_PROMISE') {
    return incomplete(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
  }

  if (operation === 'PENDING') return incomplete(ERROR_CODES.TIMEOUT)

  if (operation === 'FULFILLED' && timerCleanup === 'CLEARED') return ready

  return incomplete(ERROR_CODES.COMMAND_MONITOR_UNAVAILABLE)
}

export { resolveSs014DeadlinePrecedence }
