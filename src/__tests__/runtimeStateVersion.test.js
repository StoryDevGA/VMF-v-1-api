import { describe, expect, test } from '@jest/globals'

import {
  createNextRuntimeStateVersion,
  createRuntimeStateVersion,
  requireCanonicalRuntimeStateVersion,
  resolveRuntimeStateVersion,
  RUNTIME_STATE_VERSION_ERROR_CODES,
} from '../services/runtimeStateVersionService.js'

describe('runtime state version policy', () => {
  test('generates opaque fresh rsv2 UUID tokens', () => {
    const first = createRuntimeStateVersion()
    const second = createRuntimeStateVersion()

    expect(first).toMatch(/^rsv2:[0-9a-f-]{36}$/)
    expect(second).toMatch(/^rsv2:[0-9a-f-]{36}$/)
    expect(second).not.toBe(first)
  })

  test.each([
    [{ stateVersion: 'canonical' }, { stateVersion: 'canonical', source: 'canonical' }],
    [{ runtimeStateVersion: 'legacy' }, { stateVersion: 'legacy', source: 'compatibility_alias' }],
    [{ stateVersion: null, runtimeStateVersion: 'legacy' }, { stateVersion: 'legacy', source: 'compatibility_alias' }],
    [{ stateVersion: '  ', runtimeStateVersion: '  ' }, { stateVersion: '', source: 'missing' }],
  ])('resolves bounded read version %#', (input, expected) => {
    expect(resolveRuntimeStateVersion(input)).toMatchObject(expected)
  })

  test('fails closed when canonical and compatibility receipts disagree', () => {
    expect(resolveRuntimeStateVersion({
      stateVersion: 'canonical',
      runtimeStateVersion: 'legacy',
    })).toMatchObject({
      stateVersion: '',
      source: 'mixed',
      errorCode: RUNTIME_STATE_VERSION_ERROR_CODES.MIXED,
    })
  })

  test('requires canonical stateVersion for governed writes', () => {
    try {
      requireCanonicalRuntimeStateVersion({ runtimeStateVersion: 'legacy' })
      throw new Error('Expected canonical stateVersion requirement to fail.')
    } catch (error) {
      expect(error.code).toBe(RUNTIME_STATE_VERSION_ERROR_CODES.CANONICAL_REQUIRED)
    }
    expect(() => requireCanonicalRuntimeStateVersion({ stateVersion: 'canonical' }))
      .not.toThrow()
  })

  test('never derives or increments from a revision number', () => {
    expect(createNextRuntimeStateVersion('runtime-revision:7')).toMatch(/^rsv2:[0-9a-f-]{36}$/)
    expect(createNextRuntimeStateVersion('runtime-revision:7')).not.toBe('runtime-revision:8')
  })
})
