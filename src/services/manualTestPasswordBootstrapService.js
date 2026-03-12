import env from '../config/env.js'
import logger from '../config/logger.js'

export const DEFAULT_MANUAL_TEST_PASSWORD = 'Vmf!Test123'

const normalizeEmail = (value) => String(value || '').trim().toLowerCase()

export const getManualTestPasswordBootstrapConfig = ({
  enabled = env.fakeAuthAllowed,
  password = env.manualTestPasswordBootstrapPassword,
} = {}) => {
  return {
    enabled: Boolean(enabled),
    password: String(password || DEFAULT_MANUAL_TEST_PASSWORD),
  }
}

export const applyManualTestPasswordBootstrap = async ({
  user,
  config = getManualTestPasswordBootstrapConfig(),
  source = 'unknown',
  log = logger,
} = {}) => {
  const normalizedEmail = normalizeEmail(user?.email)

  if (!normalizedEmail) {
    return { applied: false, reason: 'missing-email' }
  }

  if (!config?.enabled) {
    return { applied: false, reason: 'disabled', email: normalizedEmail }
  }

  if (typeof user?.setPassword !== 'function') {
    throw new TypeError('Manual test password bootstrap requires a user instance with setPassword().')
  }

  await user.setPassword(config.password)

  log?.info?.(
    { email: normalizedEmail, source },
    'manual test password bootstrap applied',
  )

  return {
    applied: true,
    email: normalizedEmail,
    source,
  }
}

export default {
  DEFAULT_MANUAL_TEST_PASSWORD,
  getManualTestPasswordBootstrapConfig,
  applyManualTestPasswordBootstrap,
}
