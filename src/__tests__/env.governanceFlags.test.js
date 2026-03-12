import { describe, test, expect, afterEach, jest } from '@jest/globals'

const ORIGINAL_ENV = { ...process.env }

const loadEnv = async () => {
  jest.resetModules()
  const module = await import('../config/env.js')
  return module.default
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  jest.resetModules()
})

describe('env governance rollout flags', () => {
  test('defaults governance flags to enabled', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      GOVERNANCE_LICENSE_LEVELS_ENABLED: undefined,
      GOVERNANCE_STRICT_ADMIN_INVARIANT_ENABLED: undefined,
      GOVERNANCE_INACTIVE_ENFORCEMENT_ENABLED: undefined,
      GOVERNANCE_EXTERNAL_ONBOARDING_ENABLED: undefined,
    }

    const env = await loadEnv()
    expect(env.governanceLicenseLevelsEnabled).toBe(true)
    expect(env.governanceStrictAdminInvariantEnabled).toBe(true)
    expect(env.governanceInactiveEnforcementEnabled).toBe(true)
    expect(env.governanceExternalOnboardingEnabled).toBe(true)
  })

  test('parses explicit governance flag overrides', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      GOVERNANCE_LICENSE_LEVELS_ENABLED: '0',
      GOVERNANCE_STRICT_ADMIN_INVARIANT_ENABLED: 'false',
      GOVERNANCE_INACTIVE_ENFORCEMENT_ENABLED: 'no',
      GOVERNANCE_EXTERNAL_ONBOARDING_ENABLED: 'yes',
    }

    const env = await loadEnv()
    expect(env.governanceLicenseLevelsEnabled).toBe(false)
    expect(env.governanceStrictAdminInvariantEnabled).toBe(false)
    expect(env.governanceInactiveEnforcementEnabled).toBe(false)
    expect(env.governanceExternalOnboardingEnabled).toBe(true)
  })

  test('parses manual-test password bootstrap config when fake auth is enabled in non-production app environments', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      APP_ENV: 'staging',
      FAKE_AUTH_ENABLED: 'true',
      MANUAL_TEST_PASSWORD_BOOTSTRAP_PASSWORD: 'Vmf!Test123',
    }

    const env = await loadEnv()
    expect(env.fakeAuthAllowed).toBe(true)
    expect(env.manualTestPasswordBootstrapPassword).toBe('Vmf!Test123')
  })

  test('keeps manual-test password bootstrap unavailable in production app environments', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      APP_ENV: 'production',
      FAKE_AUTH_ENABLED: 'true',
    }

    const env = await loadEnv()
    expect(env.fakeAuthEnabled).toBe(true)
    expect(env.fakeAuthAllowed).toBe(false)
  })
})
