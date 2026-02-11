/**
 * Generic Circuit Breaker
 *
 * Protects against cascading failures when calling external services.
 * Tracks consecutive failures and transitions through three states:
 *
 *   CLOSED  → normal operation; requests pass through
 *   OPEN    → failures exceeded threshold; requests are rejected immediately
 *   HALF_OPEN → after resetTimeout, a limited number of probe requests
 *               are allowed through to test recovery
 *
 * Usage:
 *   import { CircuitBreaker } from './circuitBreaker.js'
 *
 *   const breaker = new CircuitBreaker('identity-plus', {
 *     threshold: 5,
 *     resetTimeout: 30_000,
 *   })
 *
 *   const result = await breaker.execute(() => fetch(url))
 *
 * @module services/circuitBreaker
 */

import logger from '../config/logger.js'

/* ------------------------------------------------------------------ */
/*  State constants                                                   */
/* ------------------------------------------------------------------ */

const STATES = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
})

/* ------------------------------------------------------------------ */
/*  CircuitBreaker class                                              */
/* ------------------------------------------------------------------ */

class CircuitBreaker {
  /**
   * @param {string} name — human-readable identifier for logging
   * @param {Object}  [options]
   * @param {number}  [options.threshold=5]      — failures before opening
   * @param {number}  [options.resetTimeout=30000] — ms before HALF_OPEN
   * @param {number}  [options.halfOpenMax=1]    — probe requests in HALF_OPEN
   */
  constructor(name, options = {}) {
    this.name = name
    this.threshold = options.threshold ?? 5
    this.resetTimeout = options.resetTimeout ?? 30_000
    this.halfOpenMax = options.halfOpenMax ?? 1

    this.state = STATES.CLOSED
    this.failures = 0
    this.successes = 0
    this.halfOpenAttempts = 0
    this.openedAt = null
    this.lastFailure = null

    /** @type {Array<Function>} */
    this._listeners = []
  }

  /* ---- Public API ---- */

  /**
   * Execute a function through the circuit breaker.
   *
   * @template T
   * @param {() => Promise<T>} fn — async function to protect
   * @returns {Promise<T>} The function's return value
   * @throws {Error} With `code: 'CIRCUIT_BREAKER_OPEN'` when the
   *   breaker rejects the call.
   */
  async execute(fn) {
    if (!this._canAttempt()) {
      const err = new Error(`${this.name}: circuit breaker is OPEN`)
      err.code = 'CIRCUIT_BREAKER_OPEN'
      throw err
    }

    if (this.state === STATES.HALF_OPEN) {
      this.halfOpenAttempts += 1
    }

    try {
      const result = await fn()
      this._recordSuccess()
      return result
    } catch (err) {
      this._recordFailure(err)
      throw err
    }
  }

  /**
   * Return an immutable snapshot of the breaker's current state.
   * Compatible with the previous Identity Plus inline breaker shape.
   */
  getState() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      threshold: this.threshold,
      resetTimeout: this.resetTimeout,
      openedAt: this.openedAt,
      lastFailure: this.lastFailure,
    }
  }

  /**
   * Force-reset the breaker to CLOSED.
   */
  reset() {
    const prev = this.state
    this.state = STATES.CLOSED
    this.failures = 0
    this.successes = 0
    this.halfOpenAttempts = 0
    this.openedAt = null
    this.lastFailure = null
    if (prev !== STATES.CLOSED) {
      this._emit(prev, STATES.CLOSED)
    }
  }

  /**
   * Register a state-change listener.
   * @param {Function} fn — called with `{ name, from, to }`
   * @returns {Function}  — unsubscribe function
   */
  onStateChange(fn) {
    this._listeners.push(fn)
    return () => {
      this._listeners = this._listeners.filter((l) => l !== fn)
    }
  }

  /* ---- Internal helpers ---- */

  /** @private */
  _canAttempt() {
    if (this.state === STATES.CLOSED) return true

    if (this.state === STATES.OPEN) {
      const elapsed = Date.now() - this.openedAt
      if (elapsed >= this.resetTimeout) {
        const prev = this.state
        this.state = STATES.HALF_OPEN
        this.halfOpenAttempts = 0
        this._emit(prev, STATES.HALF_OPEN)
        logger.info(
          { breaker: this.name },
          `Circuit breaker ${this.name} → HALF_OPEN`,
        )
        return true
      }
      return false
    }

    // HALF_OPEN — allow up to halfOpenMax probes
    return this.halfOpenAttempts < this.halfOpenMax
  }

  /** @private */
  _recordSuccess() {
    this.successes += 1

    if (this.state === STATES.HALF_OPEN) {
      const prev = this.state
      this.state = STATES.CLOSED
      this.failures = 0
      this.halfOpenAttempts = 0
      this.openedAt = null
      this._emit(prev, STATES.CLOSED)
      logger.info(
        { breaker: this.name },
        `Circuit breaker ${this.name} → CLOSED`,
      )
    }
  }

  /** @private */
  _recordFailure(err) {
    this.failures += 1
    this.lastFailure = err?.message ?? 'unknown'

    if (this.state === STATES.HALF_OPEN) {
      // Probe failed — reopen immediately
      const prev = this.state
      this.state = STATES.OPEN
      this.openedAt = Date.now()
      this.halfOpenAttempts = 0
      this._emit(prev, STATES.OPEN)
      logger.warn(
        { breaker: this.name, failures: this.failures },
        `Circuit breaker ${this.name} → OPEN (half-open probe failed)`,
      )
      return
    }

    if (this.failures >= this.threshold) {
      const prev = this.state
      this.state = STATES.OPEN
      this.openedAt = Date.now()
      this._emit(prev, STATES.OPEN)
      logger.warn(
        { breaker: this.name, failures: this.failures },
        `Circuit breaker ${this.name} → OPEN`,
      )
    }
  }

  /** @private */
  _emit(from, to) {
    for (const fn of this._listeners) {
      try {
        fn({ name: this.name, from, to })
      } catch {
        /* listener errors must not break the breaker */
      }
    }
  }
}

export { CircuitBreaker, STATES }
