import dotenv from 'dotenv'

// Load appropriate environment file
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env'
dotenv.config({ path: envFile })

const toNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

const toFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

const toPositiveNumber = (value, fallback, min = 1) => {
  const parsed = toNumber(value, fallback)
  return parsed < min ? fallback : parsed
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

const normalizeMetricsPrefix = (value) => {
  const prefix = (value || 'vmf_api_').trim()
  if (!prefix) return 'vmf_api_'
  return prefix.endsWith('_') ? prefix : `${prefix}_`
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toNumber(process.env.PORT, 8000),
  appVersion: process.env.APP_VERSION || '0.1.0',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN),
  rateLimitWindowMs: toNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitMax: toNumber(process.env.RATE_LIMIT_MAX, 300),
  logLevel: process.env.LOG_LEVEL || 'info',
  trustProxy: toBoolean(process.env.TRUST_PROXY, false),
  mongoUri: process.env.MONGODB_URI || '',
  mongoServerSelectionTimeoutMs: toPositiveNumber(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 5000),
  mongoConnectTimeoutMs: toPositiveNumber(process.env.MONGO_CONNECT_TIMEOUT_MS, 10000),
  mongoSocketTimeoutMs: toPositiveNumber(process.env.MONGO_SOCKET_TIMEOUT_MS, 45000),
  mongoHeartbeatFrequencyMs: toPositiveNumber(process.env.MONGO_HEARTBEAT_FREQUENCY_MS, 10000),
  mongoMinPoolSize: toPositiveNumber(process.env.MONGO_MIN_POOL_SIZE, 10),
  mongoMaxPoolSize: toPositiveNumber(process.env.MONGO_MAX_POOL_SIZE, 100),
  mongoMaxIdleTimeMs: toPositiveNumber(process.env.MONGO_MAX_IDLE_TIME_MS, 30000),
  
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

  // Audit Configuration
  auditSignatureSecret: process.env.AUDIT_SIGNATURE_SECRET || 'default-secret-change-in-production',

  // Field-Level Encryption
  fieldEncryptionKey: process.env.FIELD_ENCRYPTION_KEY || '',
  fieldEncryptionEnabled: toBoolean(process.env.FIELD_ENCRYPTION_ENABLED, false),
  
  // Enhanced Rate Limits
  authRateLimit: toNumber(process.env.AUTH_RATE_LIMIT, 5),
  authHourlyRateLimit: toNumber(process.env.AUTH_HOURLY_RATE_LIMIT, 10),
  userMgmtRateLimit: toNumber(process.env.USER_MGMT_RATE_LIMIT, 100),
  tenantRateLimit: toNumber(process.env.TENANT_RATE_LIMIT, 50),
  bulkRateLimit: toNumber(process.env.BULK_RATE_LIMIT, 10),
  auditRateLimit: toNumber(process.env.AUDIT_RATE_LIMIT, 30),

  // Monitoring and Alerting
  metricsPrefix: normalizeMetricsPrefix(process.env.METRICS_PREFIX),
  monitoringWindowMs: toNumber(process.env.MONITORING_WINDOW_MS, 5 * 60 * 1000),
  monitoringLatencyP95ThresholdMs: toNumber(
    process.env.MONITORING_LATENCY_P95_THRESHOLD_MS,
    200,
  ),
  monitoringErrorRateThreshold: toFloat(process.env.MONITORING_ERROR_RATE_THRESHOLD, 0.05),
  monitoringEventLoopLagThresholdMs: toNumber(
    process.env.MONITORING_EVENT_LOOP_LAG_THRESHOLD_MS,
    100,
  ),
  monitoringHeapUsageThresholdPct: toNumber(
    process.env.MONITORING_HEAP_USAGE_THRESHOLD_PCT,
    85,
  ),

  // Performance Optimization
  perfCacheEnabled: toBoolean(process.env.PERF_CACHE_ENABLED, process.env.NODE_ENV !== 'test'),
  userPermissionsCacheTtlSec: toPositiveNumber(process.env.USER_PERMISSIONS_CACHE_TTL_SEC, 300),
  tenantStatusCacheTtlSec: toPositiveNumber(process.env.TENANT_STATUS_CACHE_TTL_SEC, 60),
  customerTopologyCacheTtlSec: toPositiveNumber(process.env.CUSTOMER_TOPOLOGY_CACHE_TTL_SEC, 900),
  cacheWarmUserLimit: toPositiveNumber(process.env.CACHE_WARM_USER_LIMIT, 200),
  cacheWarmTenantLimit: toPositiveNumber(process.env.CACHE_WARM_TENANT_LIMIT, 200),
  cacheWarmCustomerLimit: toPositiveNumber(process.env.CACHE_WARM_CUSTOMER_LIMIT, 100),
  backgroundJobsEnabled: toBoolean(process.env.BACKGROUND_JOBS_ENABLED, true),
  backgroundJobConcurrency: toPositiveNumber(process.env.BACKGROUND_JOB_CONCURRENCY, 2),
  identityPlusReconciliationIntervalMs: toPositiveNumber(
    process.env.IDENTITY_PLUS_RECONCILIATION_INTERVAL_MS,
    5 * 60 * 1000,
  ),
  identityPlusReconciliationBatchSize: toPositiveNumber(
    process.env.IDENTITY_PLUS_RECONCILIATION_BATCH_SIZE,
    50,
  ),
  auditArchivalIntervalMs: toPositiveNumber(
    process.env.AUDIT_ARCHIVAL_INTERVAL_MS,
    6 * 60 * 60 * 1000,
  ),
  cacheWarmingIntervalMs: toPositiveNumber(process.env.CACHE_WARMING_INTERVAL_MS, 10 * 60 * 1000),

  // GDPR Compliance
  gdprExportAuditLimit: toNumber(process.env.GDPR_EXPORT_AUDIT_LIMIT, 5000),
  gdprRetentionDays: toNumber(process.env.GDPR_RETENTION_DAYS, 2555), // 7 years
  gdprCleanupIntervalMs: toNumber(process.env.GDPR_CLEANUP_INTERVAL_MS, 24 * 60 * 60 * 1000),
  gdprCleanupEnabled: toBoolean(process.env.GDPR_CLEANUP_ENABLED, true),
}

env.isProduction = env.nodeEnv === 'production'
env.mongoMinPoolSize = Math.max(1, env.mongoMinPoolSize)
env.mongoMaxPoolSize = Math.max(env.mongoMinPoolSize, env.mongoMaxPoolSize)
env.backgroundJobConcurrency = Math.max(1, env.backgroundJobConcurrency)
env.corsOrigins =
  env.corsOrigins.length > 0
    ? env.corsOrigins
    : env.isProduction
      ? []
      : ['http://localhost:5173']

export default env
