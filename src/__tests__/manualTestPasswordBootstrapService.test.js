import { describe, expect, jest, test } from '@jest/globals'
import {
  DEFAULT_MANUAL_TEST_PASSWORD,
  applyManualTestPasswordBootstrap,
  getManualTestPasswordBootstrapConfig,
} from '../services/manualTestPasswordBootstrapService.js'

const makeUser = (email) => ({
  email,
  passwordHash: null,
  setPassword: jest.fn(async function (password) {
    this.passwordHash = `hash:${password}`
  }),
  save: jest.fn(async function () {
    return this
  }),
})

describe('manualTestPasswordBootstrapService', () => {
  test('uses the shared default password when no override is configured', () => {
    const config = getManualTestPasswordBootstrapConfig({
      enabled: true,
      password: '',
    })

    expect(config.enabled).toBe(true)
    expect(config.password).toBe(DEFAULT_MANUAL_TEST_PASSWORD)
  })

  test('hashes the shared manual-test password for any user when enabled', async () => {
    const user = makeUser('whoever@example.test')

    const result = await applyManualTestPasswordBootstrap({
      user,
      config: getManualTestPasswordBootstrapConfig({ enabled: true }),
      log: null,
      source: 'unit_test',
    })

    expect(result.applied).toBe(true)
    expect(user.setPassword).toHaveBeenCalledWith(DEFAULT_MANUAL_TEST_PASSWORD)
    expect(user.passwordHash).toBe(`hash:${DEFAULT_MANUAL_TEST_PASSWORD}`)
  })

  test('skips bootstrap when fake-auth/UAT mode is disabled', async () => {
    const user = makeUser('outside.scope@example.com')

    const result = await applyManualTestPasswordBootstrap({
      user,
      config: getManualTestPasswordBootstrapConfig({ enabled: false }),
      log: null,
    })

    expect(result.applied).toBe(false)
    expect(result.reason).toBe('disabled')
    expect(user.setPassword).not.toHaveBeenCalled()
  })
})
