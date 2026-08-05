import { beforeEach, describe, expect, jest, test } from '@jest/globals'

const connect = jest.fn(async () => {})
const disconnect = jest.fn(async () => {})
const on = jest.fn()

jest.unstable_mockModule('mongoose', () => ({
  default: {
    connect,
    disconnect,
    set: jest.fn(),
    connection: { on, readyState: 0 },
  },
}))
jest.unstable_mockModule('../config/env.js', () => ({
  default: {
    isProduction: false,
    mongoUri: 'mongodb://qa.invalid/storylineos-test',
    mongoServerSelectionTimeoutMs: 100,
    mongoConnectTimeoutMs: 100,
    mongoSocketTimeoutMs: 100,
    mongoHeartbeatFrequencyMs: 100,
    mongoMinPoolSize: 0,
    mongoMaxPoolSize: 5,
    mongoMaxIdleTimeMs: 100,
  },
}))
jest.unstable_mockModule('../config/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

const { connectDb } = await import('../config/db.js')

describe('database connection index mode', () => {
  beforeEach(() => {
    connect.mockClear()
  })

  test('preserves the non-production application default', async () => {
    await connectDb()

    expect(connect).toHaveBeenCalledWith(
      'mongodb://qa.invalid/storylineos-test',
      expect.objectContaining({ autoIndex: true }),
    )
  })

  test('honors an explicit automatic-index override', async () => {
    await connectDb({ autoIndex: false })

    expect(connect).toHaveBeenCalledWith(
      'mongodb://qa.invalid/storylineos-test',
      expect.objectContaining({ autoIndex: false }),
    )
  })
})
