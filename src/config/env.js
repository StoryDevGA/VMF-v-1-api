import dotenv from 'dotenv'

dotenv.config()

const toNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

const toBoolean = (value, fallback) => {
  if (value === undefined) return fallback
  return value === '1' || value === 'true'
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
}

env.isProduction = env.nodeEnv === 'production'
env.corsOrigins =
  env.corsOrigins.length > 0
    ? env.corsOrigins
    : env.isProduction
      ? []
      : ['http://localhost:5173']

export default env
