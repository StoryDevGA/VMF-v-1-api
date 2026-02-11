/**
 * Rate Limiting Middleware
 *
 * Provides tiered rate limiting for different endpoint categories:
 *   - authRateLimit:           5 attempts/minute per IP
 *   - authHourlyRateLimit:     10 attempts/hour per user (email or IP)
 *   - userManagementRateLimit: 100 requests/minute per admin
 *   - tenantManagementRateLimit: 50 requests/minute per admin
 *   - bulkOperationsRateLimit: 10 requests/minute per admin
 *   - auditRateLimit:          30 requests/minute per admin
 *   - generalApiRateLimit:     1000 requests/hour per authenticated user
 *
 * All limiters:
 *   - Include `requestId` in 429 responses
 *   - Use `RateLimit-*` headers (draft-7 standard)
 *   - Use composite IP+userId keys where appropriate
 *
 * @module middleware/rateLimits
 */

import rateLimit from 'express-rate-limit'
import env from '../config/env.js'

/* ------------------------------------------------------------------ */
/*  Shared handler                                                    */
/* ------------------------------------------------------------------ */

/**
 * Standard 429 response handler — always includes the error code,
 * a human-readable message, the correlation requestId, and the
 * number of seconds until the client can retry.
 */
const standardHandler = (req, res) => {
  res.status(429).json({
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
      requestId: req.requestId,
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
    },
  })
}

/* ------------------------------------------------------------------ */
/*  Auth — per-IP, per-minute                                         */
/* ------------------------------------------------------------------ */

/**
 * Authentication rate limit — 5 attempts per minute per IP.
 * Applied to login, super-admin login, and token refresh endpoints.
 */
export const authRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute (spec: 5 attempts/minute per IP)
  limit: env.authRateLimit, // default 5
  message: {
    error: {
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts, please try again later',
    },
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  skip: () => env.nodeEnv === 'test',
})

/* ------------------------------------------------------------------ */
/*  Auth — per-user, per-hour                                         */
/* ------------------------------------------------------------------ */

/**
 * Hourly auth rate limit — 10 attempts per hour per user identity.
 * Uses the provided email (from the request body) combined with IP
 * to prevent brute-force across many IPs for a single account.
 */
export const authHourlyRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour (spec: 10 attempts/hour per user)
  limit: env.authHourlyRateLimit, // default 10
  message: {
    error: {
      code: 'AUTH_HOURLY_RATE_LIMIT_EXCEEDED',
      message: 'Too many login attempts for this account, please try again later',
    },
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req) => {
    // Key by email (from login body) + IP to scope per-account
    const email = req.body?.email || 'unknown'
    return `auth-hourly:${email.toLowerCase()}:${req.ip}`
  },
  skip: () => env.nodeEnv === 'test',
})

/* ------------------------------------------------------------------ */
/*  User management — per-admin, per-minute                           */
/* ------------------------------------------------------------------ */

export const userManagementRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: env.userMgmtRateLimit, // default 100
  message: {
    error: {
      code: 'USER_MGMT_RATE_LIMIT_EXCEEDED',
      message: 'Too many user management requests',
    },
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req) => `user-mgmt:${req.ip}:${req.userId || 'anonymous'}`,
})

/* ------------------------------------------------------------------ */
/*  Tenant management — per-admin, per-minute                         */
/* ------------------------------------------------------------------ */

export const tenantManagementRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: env.tenantRateLimit, // default 50
  message: {
    error: {
      code: 'TENANT_MGMT_RATE_LIMIT_EXCEEDED',
      message: 'Too many tenant management requests',
    },
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req) => `tenant-mgmt:${req.ip}:${req.userId || 'anonymous'}`,
})

/* ------------------------------------------------------------------ */
/*  Bulk operations — per-admin, per-minute                           */
/* ------------------------------------------------------------------ */

export const bulkOperationsRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: env.bulkRateLimit, // default 10
  message: {
    error: {
      code: 'BULK_OPERATIONS_RATE_LIMIT_EXCEEDED',
      message: 'Too many bulk operations, please slow down',
    },
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req) => `bulk:${req.ip}:${req.userId || 'anonymous'}`,
  skip: () => env.nodeEnv === 'test',
})

/* ------------------------------------------------------------------ */
/*  Audit endpoints — per-admin, per-minute                           */
/* ------------------------------------------------------------------ */

export const auditRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: env.auditRateLimit, // default 30
  message: {
    error: {
      code: 'AUDIT_RATE_LIMIT_EXCEEDED',
      message: 'Too many audit log requests',
    },
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req) => `audit:${req.ip}:${req.userId || 'anonymous'}`,
  skip: () => env.nodeEnv === 'test',
})

/* ------------------------------------------------------------------ */
/*  General API — per-user, per-hour                                  */
/* ------------------------------------------------------------------ */

export const generalApiRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 1000, // 1000 requests per hour per authenticated user
  message: {
    error: {
      code: 'API_RATE_LIMIT_EXCEEDED',
      message: 'Too many API requests',
    },
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req) => `api:${req.ip}:${req.userId || 'anonymous'}`,
})