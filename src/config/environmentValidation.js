import { z } from 'zod'
import { parseAuditSigningConfig } from './auditSigningConfig.js'

const booleanValue = z.string().regex(/^(1|0|true|false|yes|no|on|off)$/i)
const integer = (min = 1, max = Number.MAX_SAFE_INTEGER) => z.string()
  .regex(/^\d+$/)
  .refine((value) => Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max)
const connectionUrl = (protocols) => z.string().refine((value) => {
  if (value === '') return true // Optional connections retain their existing defaults.
  try {
    const parsed = new URL(value)
    return protocols.includes(parsed.protocol) && Boolean(parsed.hostname)
  } catch {
    return false
  }
})

const shape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: integer(1, 65535).optional(),
  BCRYPT_ROUNDS: integer(4, 31).optional(),
  // MongoDB supports comma-separated replica-set hosts, unlike WHATWG URLs.
  MONGODB_URI: z.string().refine((value) => value === '' || /^mongodb(?:\+srv)?:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(value)).optional(),
  REDIS_URL: connectionUrl(['redis:', 'rediss:']).optional(),
  RATE_LIMIT_WINDOW_MS: integer(0).optional(),
  MONGO_MIN_POOL_SIZE: integer(0).optional(),
  MONGO_SOCKET_TIMEOUT_MS: integer(0).optional(),
}

for (const key of [
  'REDIS_REQUIRED', 'PERF_CACHE_ENABLED', 'FAKE_AUTH_ENABLED', 'FIELD_ENCRYPTION_ENABLED',
  'GOVERNANCE_LICENSE_LEVELS_ENABLED', 'GOVERNANCE_STRICT_ADMIN_INVARIANT_ENABLED',
  'GOVERNANCE_INACTIVE_ENFORCEMENT_ENABLED', 'GOVERNANCE_EXTERNAL_ONBOARDING_ENABLED',
  'BACKGROUND_JOBS_ENABLED',
]) shape[key] = booleanValue.optional()

for (const key of [
  'RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT', 'AUTH_HOURLY_RATE_LIMIT',
  'USER_MGMT_RATE_LIMIT', 'TENANT_RATE_LIMIT', 'BULK_RATE_LIMIT', 'AUDIT_RATE_LIMIT',
  'SESSION_TIMEOUT_MINUTES', 'MONGO_SERVER_SELECTION_TIMEOUT_MS', 'MONGO_CONNECT_TIMEOUT_MS',
  'MONGO_HEARTBEAT_FREQUENCY_MS',
  'MONGO_MAX_POOL_SIZE', 'MONGO_MAX_IDLE_TIME_MS', 'USER_PERMISSIONS_CACHE_TTL_SEC',
  'TENANT_STATUS_CACHE_TTL_SEC', 'CUSTOMER_TOPOLOGY_CACHE_TTL_SEC',
]) shape[key] = integer().optional()

const environmentSchema = z.object(shape).passthrough()

/** Validate configured infrastructure values without printing configuration secrets. */
export const validateEnvironment = (source) => {
  const auditSigning = parseAuditSigningConfig(source)
  const result = environmentSchema.safeParse(source)
  const invalidFields = new Set(result.success ? [] : result.error.issues.map((issue) => issue.path[0]))
  if (source.NODE_ENV !== 'test' && Number(source.RATE_LIMIT_WINDOW_MS) === 0) {
    invalidFields.add('RATE_LIMIT_WINDOW_MS')
  }
  if (source.MONGO_MIN_POOL_SIZE !== undefined && source.MONGO_MAX_POOL_SIZE !== undefined
    && Number(source.MONGO_MIN_POOL_SIZE) > Number(source.MONGO_MAX_POOL_SIZE)) {
    invalidFields.add('MONGO_MIN_POOL_SIZE')
  }
  const production = source.NODE_ENV === 'production'
    || String(source.APP_ENV || '').trim().toLowerCase() === 'production'
  // The exact historical default may verify old unkeyed records only when
  // new records are signed with a validated private key. Never silently opt in.
  const legacyVerificationOnly = source.AUDIT_SIGNATURE_SECRET === 'default-secret-change-in-production'
    && auditSigning.activeKeyId !== undefined
  if (production && (typeof source.AUDIT_SIGNATURE_SECRET !== 'string'
    || !source.AUDIT_SIGNATURE_SECRET.trim()
    || (source.AUDIT_SIGNATURE_SECRET.trim() === 'default-secret-change-in-production' && !legacyVerificationOnly))) {
    invalidFields.add('AUDIT_SIGNATURE_SECRET')
  }
  if (invalidFields.size) {
    throw new Error(`Invalid environment configuration: ${[...invalidFields].sort().join(', ')}`)
  }
}
