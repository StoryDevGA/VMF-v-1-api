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
 * Uses the generic {@link CircuitBreaker} to protect against cascading
 * failures when the external API is unreachable.
 */

import crypto from 'crypto'
import env from '../config/env.js'
import logger from '../config/logger.js'
import { CircuitBreaker } from './circuitBreaker.js'

/* ------------------------------------------------------------------ */
/*  Circuit breaker instance (via generic CircuitBreaker)             */
/* ------------------------------------------------------------------ */

const breaker = new CircuitBreaker('identity-plus', {
  threshold: 5,
  resetTimeout: 30_000, // 30 seconds
})

/**
 * Expose breaker state for observability / tests.
 * Backward-compatible: returns { state, failures, threshold, resetTimeout, openedAt }.
 */
export const getCircuitBreakerState = () => breaker.getState()

/**
 * Reset the breaker (useful in tests).
 */
export const resetCircuitBreaker = () => breaker.reset()

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

    /* ---------- real call (circuit-breaker protected) ---------- */
    try {
      const result = await breaker.execute(() =>
        callApi('/invitations', {
          email,
          customerId,
          redirectUrl: redirectUrl || undefined,
        }),
      )
      logger.info(
        { email, customerId, externalId: result.externalId },
        'Identity Plus invitation sent',
      )
      return {
        externalId: result.externalId,
        invitedAt: new Date(result.invitedAt || Date.now()),
      }
    } catch (err) {
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

    /* ---------- real call (circuit-breaker protected) ---------- */
    try {
      const result = await breaker.execute(() =>
        callApi('/trust/revoke', {
          externalId: externalId || undefined,
          email: email || undefined,
        }),
      )
      logger.info(
        { externalId, email },
        'Identity Plus trust revoked',
      )
      return {
        revokedAt: new Date(result.revokedAt || Date.now()),
      }
    } catch (err) {
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

    /* ---------- real call (circuit-breaker protected) ---------- */
    try {
      const result = await breaker.execute(() =>
        callApi(
          '/registration/status',
          { externalId: externalId || undefined, email: email || undefined },
          { method: 'POST' },
        ),
      )
      return {
        status: result.status || 'PENDING',
        registeredAt: result.registeredAt ? new Date(result.registeredAt) : null,
      }
    } catch (err) {
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
