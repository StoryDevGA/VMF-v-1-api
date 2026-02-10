import dotenv from 'dotenv'

// Load appropriate environment file
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env'
dotenv.config({ path: envFile })

const toNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

const toBoolean = (value, fallback) => {
  if (value === undefined) return fallback
  const normalized = String(value).toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

const normalizeOrigin = (origin) => origin.replace(/\/+$/, '')

const parseCorsOrigins = (value) => {
  if (!value) return []
  return value
    .split(',')
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter(Boolean)
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toNumber(process.env.PORT, 8000),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN),
  rateLimitWindowMs: toNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitMax: toNumber(process.env.RATE_LIMIT_MAX, 300),
  logLevel: process.env.LOG_LEVEL || 'info',
  trustProxy: toBoolean(process.env.TRUST_PROXY, false),
  mongoUri: process.env.MONGODB_URI || '',
  
  // JWT Configuration
  jwtSecret: process.env.JWT_SECRET || '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
  jwtExpiry: process.env.JWT_EXPIRY || '15m',
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  
  // Redis Configuration
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  redisPassword: process.env.REDIS_PASSWORD || '',
  redisRequired: toBoolean(process.env.REDIS_REQUIRED, false),
  
  // Identity Plus Configuration
  identityPlusApiUrl: process.env.IDENTITY_PLUS_API_URL || '',
  identityPlusApiKey: process.env.IDENTITY_PLUS_API_KEY || '',
  identityPlusWebhookSecret: process.env.IDENTITY_PLUS_WEBHOOK_SECRET || '',
  
  // Security Configuration
  bcryptRounds: toNumber(process.env.BCRYPT_ROUNDS, 12),
  sessionTimeout: toNumber(process.env.SESSION_TIMEOUT_MINUTES, 30) * 60 * 1000,
  
  // Enhanced Rate Limits
  authRateLimit: toNumber(process.env.AUTH_RATE_LIMIT, 5),
  userMgmtRateLimit: toNumber(process.env.USER_MGMT_RATE_LIMIT, 100),
  tenantRateLimit: toNumber(process.env.TENANT_RATE_LIMIT, 50),
  bulkRateLimit: toNumber(process.env.BULK_RATE_LIMIT, 10),
}

env.isProduction = env.nodeEnv === 'production'
env.corsOrigins =
  env.corsOrigins.length > 0
    ? env.corsOrigins
    : env.isProduction
      ? []
      : ['http://localhost:5173']

export default env
