const failedObservation = () => Object.freeze({
  ok: false,
  value: null,
})

const isThenable = (value) => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false

  try {
    return typeof value.then === 'function'
  } catch {
    return true
  }
}

const observeRejectedThenable = (value) => {
  try {
    Promise.resolve(value).then(() => undefined, () => undefined)
  } catch {
    // The adapter has already failed closed; no thenable detail escapes.
  }
}

const observeSs014SynchronousAdapter = (invoke) => {
  if (typeof invoke !== 'function') return failedObservation()

  let value
  try {
    value = invoke()
  } catch {
    return failedObservation()
  }

  if (isThenable(value)) {
    observeRejectedThenable(value)
    return failedObservation()
  }

  return Object.freeze({
    ok: true,
    value,
  })
}

export { observeSs014SynchronousAdapter }
