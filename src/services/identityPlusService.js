/**
 * Identity Plus Service
 *
 * Manages the integration with the external Identity Plus provider for:
 *   - Sending invitations to new users
 *   - Revoking trust when users are disabled
 *   - Checking registration/trust status
 *
 * When `IDENTITY_PLUS_API_URL` is not configured the service operates
 * in **mock mode** — every call succeeds immediately and returns
 * deterministic stub data.  This allows local development and testing
 * without a live Identity Plus instance.
 *
 * A lightweight circuit-breaker protects against cascading failures
 * when the external API is unreachable.
 */

import crypto from 'crypto'
import env from '../config/env.js'
import logger from '../config/logger.js'

/* ------------------------------------------------------------------ */
/*  Circuit-breaker (lightweight, in-process)                         */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} CircuitBreakerState
 * @property {'CLOSED'|'OPEN'|'HALF_OPEN'} state
 * @property {number} failures     - consecutive failure count
 * @property {number} threshold    - failures before opening
 * @property {number} resetTimeout - ms before transitioning to HALF_OPEN
 * @property {number|null} openedAt - timestamp when breaker opened
 */

/** @type {CircuitBreakerState} */
const breaker = {
  state: 'CLOSED',
  failures: 0,
  threshold: 5,
  resetTimeout: 30_000, // 30 seconds
  openedAt: null,
}

/**
 * Record a successful external call — reset breaker.
 */
const recordSuccess = () => {
  breaker.failures = 0
  breaker.state = 'CLOSED'
  breaker.openedAt = null
}

/**
 * Record a failed external call — potentially open breaker.
 */
const recordFailure = () => {
  breaker.failures += 1
  if (breaker.failures >= breaker.threshold) {
    breaker.state = 'OPEN'
    breaker.openedAt = Date.now()
    logger.warn(
      { failures: breaker.failures },
      'Identity Plus circuit breaker OPEN',
    )
  }
}

/**
 * Check whether the breaker allows a request through.
 * @returns {boolean}
 */
const canAttempt = () => {
  if (breaker.state === 'CLOSED') return true
  if (breaker.state === 'OPEN') {
    const elapsed = Date.now() - breaker.openedAt
    if (elapsed >= breaker.resetTimeout) {
      breaker.state = 'HALF_OPEN'
      logger.info('Identity Plus circuit breaker HALF_OPEN — allowing probe')
      return true
    }
    return false
  }
  // HALF_OPEN — allow exactly one probe request
  return true
}

/**
 * Expose breaker state for observability / tests.
 */
export const getCircuitBreakerState = () => ({ ...breaker })

/**
 * Reset the breaker (useful in tests).
 */
export const resetCircuitBreaker = () => {
  breaker.state = 'CLOSED'
  breaker.failures = 0
  breaker.openedAt = null
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Whether the service is running in mock mode.
 */
const isMockMode = () => !env.identityPlusApiUrl

/**
 * Build standard HTTP headers for Identity Plus API calls.
 */
const buildHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${env.identityPlusApiKey}`,
  'X-Request-Source': 'storylineos-vmf-api',
})

/**
 * Perform an HTTP request to the Identity Plus API with timeout.
 * @param {string} path  - API path (e.g. `/invitations`)
 * @param {object} body  - JSON payload
 * @param {object} [opts]
 * @param {string} [opts.method='POST']
 * @param {number} [opts.timeoutMs=10000]
 * @returns {Promise<object>} Parsed JSON response
 */
const callApi = async (path, body, { method = 'POST', timeoutMs = 10_000 } = {}) => {
  const url = `${env.identityPlusApiUrl}${path}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method,
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      const err = new Error(data.message || `Identity Plus API ${res.status}`)
      err.status = res.status
      err.code = data.code || 'IDENTITY_PLUS_ERROR'
      err.response = data
      throw err
    }

    return data
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/*  Service class                                                     */
/* ------------------------------------------------------------------ */

class IdentityPlusService {
  /* ---------------------------------------------------------------- */
  /*  sendInvitation                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Send an invitation to a new user via Identity Plus.
   *
   * @param {Object} params
   * @param {string} params.email       - User email address
   * @param {string} params.customerId  - Customer context for the invitation
   * @param {string} [params.redirectUrl] - Post-registration redirect URL
   * @returns {Promise<{ externalId: string, invitedAt: Date }>}
   */
  async sendInvitation({ email, customerId, redirectUrl }) {
    if (!email) throw new Error('email is required')
    if (!customerId) throw new Error('customerId is required')

    /* ---------- mock mode ---------- */
    if (isMockMode()) {
      const externalId = `mock_${crypto.randomUUID()}`
      logger.info(
        { email, customerId, externalId, mock: true },
        'Identity Plus invitation sent (mock)',
      )
      return { externalId, invitedAt: new Date() }
    }

    /* ---------- circuit breaker ---------- */
    if (!canAttempt()) {
      const err = new Error('Identity Plus service is temporarily unavailable')
      err.code = 'IDENTITY_PLUS_CIRCUIT_OPEN'
      throw err
    }

    /* ---------- real call ---------- */
    try {
      const result = await callApi('/invitations', {
        email,
        customerId,
        redirectUrl: redirectUrl || undefined,
      })
      recordSuccess()
      logger.info(
        { email, customerId, externalId: result.externalId },
        'Identity Plus invitation sent',
      )
      return {
        externalId: result.externalId,
        invitedAt: new Date(result.invitedAt || Date.now()),
      }
    } catch (err) {
      recordFailure()
      logger.error(
        { err, email, customerId },
        'Identity Plus sendInvitation failed',
      )
      throw err
    }
  }

  /* ---------------------------------------------------------------- */
  /*  revokeTrust                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Revoke trust for a user (called when user is disabled).
   *
   * @param {Object} params
   * @param {string} [params.externalId] - Identity Plus external ID
   * @param {string} [params.email]      - Fallback lookup by email
   * @returns {Promise<{ revokedAt: Date }>}
   */
  async revokeTrust({ externalId, email }) {
    if (!externalId && !email) {
      throw new Error('externalId or email is required')
    }

    /* ---------- mock mode ---------- */
    if (isMockMode()) {
      logger.info(
        { externalId, email, mock: true },
        'Identity Plus trust revoked (mock)',
      )
      return { revokedAt: new Date() }
    }

    /* ---------- circuit breaker ---------- */
    if (!canAttempt()) {
      const err = new Error('Identity Plus service is temporarily unavailable')
      err.code = 'IDENTITY_PLUS_CIRCUIT_OPEN'
      throw err
    }

    /* ---------- real call ---------- */
    try {
      const result = await callApi('/trust/revoke', {
        externalId: externalId || undefined,
        email: email || undefined,
      })
      recordSuccess()
      logger.info(
        { externalId, email },
        'Identity Plus trust revoked',
      )
      return {
        revokedAt: new Date(result.revokedAt || Date.now()),
      }
    } catch (err) {
      recordFailure()
      logger.error(
        { err, externalId, email },
        'Identity Plus revokeTrust failed',
      )
      throw err
    }
  }

  /* ---------------------------------------------------------------- */
  /*  checkRegistrationStatus                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Check whether a user has completed registration / trust.
   *
   * @param {Object} params
   * @param {string} [params.externalId] - Identity Plus external ID
   * @param {string} [params.email]      - Fallback lookup by email
   * @returns {Promise<{ status: 'PENDING'|'REGISTERED'|'REVOKED', registeredAt?: Date }>}
   */
  async checkRegistrationStatus({ externalId, email }) {
    if (!externalId && !email) {
      throw new Error('externalId or email is required')
    }

    /* ---------- mock mode ---------- */
    if (isMockMode()) {
      logger.info(
        { externalId, email, mock: true },
        'Identity Plus registration status checked (mock)',
      )
      return { status: 'PENDING', registeredAt: null }
    }

    /* ---------- circuit breaker ---------- */
    if (!canAttempt()) {
      const err = new Error('Identity Plus service is temporarily unavailable')
      err.code = 'IDENTITY_PLUS_CIRCUIT_OPEN'
      throw err
    }

    /* ---------- real call ---------- */
    try {
      const result = await callApi(
        '/registration/status',
        { externalId: externalId || undefined, email: email || undefined },
        { method: 'POST' },
      )
      recordSuccess()
      return {
        status: result.status || 'PENDING',
        registeredAt: result.registeredAt ? new Date(result.registeredAt) : null,
      }
    } catch (err) {
      recordFailure()
      logger.error(
        { err, externalId, email },
        'Identity Plus checkRegistrationStatus failed',
      )
      throw err
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Webhook signature verification                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Verify the HMAC-SHA256 signature of an incoming webhook payload.
   *
   * @param {string} rawBody      - Raw request body string
   * @param {string} signature    - Value from `X-Identity-Plus-Signature` header
   * @param {string} [secret]     - Override for testing; defaults to env var
   * @returns {boolean}
   */
  verifyWebhookSignature(rawBody, signature, secret) {
    const key = secret || env.identityPlusWebhookSecret
    if (!key) {
      logger.warn('No Identity Plus webhook secret configured — skipping verification')
      return true // Allow in dev when no secret configured
    }
    if (!signature) return false

    const expected = crypto
      .createHmac('sha256', key)
      .update(rawBody)
      .digest('hex')

    // Constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(signature, 'hex'),
      )
    } catch {
      return false
    }
  }
}

export default new IdentityPlusService()
