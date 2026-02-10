import rateLimit from 'express-rate-limit'
import env from '../config/env.js'

// Standard rate limit handler
const standardHandler = (req, res) => {
  res.status(429).json({
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
      requestId: req.requestId,
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    }
  })
}

// Create rate limiters for different endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: env.authRateLimit, // 5 attempts per window per IP
  message: {
    error: {
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts, please try again later'
    }
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  skip: (req) => req.ip === '127.0.0.1' && env.nodeEnv === 'development'
})

export const userManagementRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: env.userMgmtRateLimit, // 100 requests per minute
  message: {
    error: {
      code: 'USER_MGMT_RATE_LIMIT_EXCEEDED',
      message: 'Too many user management requests'
    }
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req) => `${req.ip}:${req.userId || 'anonymous'}`
})

export const tenantManagementRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: env.tenantRateLimit, // 50 requests per minute
  message: {
    error: {
      code: 'TENANT_MGMT_RATE_LIMIT_EXCEEDED',
      message: 'Too many tenant management requests'
    }
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req) => `${req.ip}:${req.userId || 'anonymous'}`
})

export const bulkOperationsRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: env.bulkRateLimit, // 10 requests per minute
  message: {
    error: {
      code: 'BULK_OPERATIONS_RATE_LIMIT_EXCEEDED',
      message: 'Too many bulk operations, please slow down'
    }
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req) => `${req.ip}:${req.userId || 'anonymous'}`
})

export const generalApiRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 1000, // 1000 requests per hour
  message: {
    error: {
      code: 'API_RATE_LIMIT_EXCEEDED',
      message: 'Too many API requests'
    }
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: standardHandler,
  keyGenerator: (req) => `${req.ip}:${req.userId || 'anonymous'}`
})