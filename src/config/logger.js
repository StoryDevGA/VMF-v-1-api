import pino from 'pino'
import env from './env.js'

export const LOGGER_REDACT_PATHS = Object.freeze([
  'req.headers.authorization',
  'req.headers["x-step-up-token"]',
])

export const buildLoggerOptions = () => ({
  level: env.logLevel,
  base: {
    service: 'vmf-v-1-api',
  },
  redact: {
    paths: [...LOGGER_REDACT_PATHS],
    censor: '[REDACTED]',
  },
})

const logger = pino(buildLoggerOptions())

export default logger
