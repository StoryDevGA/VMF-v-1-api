import { describe, expect, test } from '@jest/globals'
import { strictOptionalBoolean, resolveDevelopmentStartupPolicy } from '../config/developmentStartupPolicy.js'

describe('explicit quiet development startup policy', () => {
  const development = { nodeEnv: 'development', appEnv: 'development', isProduction: false,
    developmentStartupTasksEnabled: true, controlledDocxReadEnabled: false }
  test('correction flag requires the controlled development reader', () => {
    expect(() => resolveDevelopmentStartupPolicy({ ...development, controlledDocxReadCorrectionEnabled: true })).toThrow()
    expect(() => resolveDevelopmentStartupPolicy({ ...development, controlledDocxReadEnabled: true, controlledDocxReadCorrectionEnabled: true })).not.toThrow()
    expect(() => resolveDevelopmentStartupPolicy({ ...development, nodeEnv: 'production', controlledDocxReadEnabled: true, controlledDocxReadCorrectionEnabled: true })).toThrow()
  })
  test('narrow profile requires the controlled development reader and excludes older profile flags', () => {
    const narrow = { ...development, controlledDocxReadNarrowEnabled: true }
    expect(() => resolveDevelopmentStartupPolicy(narrow)).toThrow()
    expect(() => resolveDevelopmentStartupPolicy({ ...narrow, controlledDocxReadEnabled: true })).not.toThrow()
    for (const oldFlag of ['controlledDocxReadCorrectionEnabled', 'controlledDocxReadApprovedEnabled']) {
      expect(() => resolveDevelopmentStartupPolicy({ ...narrow, controlledDocxReadEnabled: true, [oldFlag]: true })).toThrow()
    }
    expect(() => resolveDevelopmentStartupPolicy({ ...narrow, controlledDocxReadEnabled: true, nodeEnv: 'production' })).toThrow()
  })
  test('defaults preserve the existing development startup', () => {
    expect(strictOptionalBoolean(undefined, true, 'startup')).toBe(true)
    expect(strictOptionalBoolean(undefined, false, 'controlled')).toBe(false)
    expect(resolveDevelopmentStartupPolicy(development)).toEqual({ quiet: false, autoIndex: true, runSeeds: true, startMaintenance: true })
  })
  test('explicit quiet startup prevents creation/index/seed/maintenance admission', () => {
    expect(resolveDevelopmentStartupPolicy({ ...development, developmentStartupTasksEnabled: false }))
      .toEqual({ quiet: true, autoIndex: false, runSeeds: false, startMaintenance: false })
  })
  test('ordinary production defaults remain unchanged', () => {
    expect(resolveDevelopmentStartupPolicy({ ...development, nodeEnv: 'production', appEnv: 'production', isProduction: true }))
      .toEqual({ quiet: false, autoIndex: false, runSeeds: false, startMaintenance: true })
  })
  test.each(['production', 'staging'])('refuses development flags in %s', nodeEnv => {
    expect(() => resolveDevelopmentStartupPolicy({ ...development, nodeEnv, developmentStartupTasksEnabled: false })).toThrow()
    expect(() => resolveDevelopmentStartupPolicy({ ...development, nodeEnv, controlledDocxReadEnabled: true })).toThrow()
  })
  test('refuses an unsupported application environment', () => {
    expect(() => resolveDevelopmentStartupPolicy({ ...development, appEnv: 'production', controlledDocxReadEnabled: true })).toThrow()
  })
  test.each(['TRUE', '0', '', ' true', null, 1])('new flags reject noncanonical boolean %s', value => {
    expect(() => strictOptionalBoolean(value, false, 'controlled')).toThrow()
  })
  test.each(['true', 'false'])('accepts the exact configured %s value', value => {
    expect(strictOptionalBoolean(value, value !== 'true', 'controlled')).toBe(value === 'true')
  })
})
