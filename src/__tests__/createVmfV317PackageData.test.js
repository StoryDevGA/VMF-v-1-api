import { describe, expect, test } from '@jest/globals'
import {
  buildDatabaseUri,
  parseArgs,
} from '../scripts/createVmfV317PackageData.js'

describe('create VMF v3.1.7 package data script', () => {
  test('requires a source directory', () => {
    expect(() => parseArgs([])).toThrow('--source-dir is required')
  })

  test('requires an explicit database for apply mode', () => {
    expect(() => parseArgs([
      '--source-dir',
      'C:/seed-data',
      '--apply',
    ])).toThrow('--apply requires --database')
  })

  test('rejects unsafe database names', () => {
    expect(() => parseArgs([
      '--source-dir',
      'C:/seed-data',
      '--database',
      'test/ss028',
    ])).toThrow('--database must contain only')
  })

  test('builds a URI that targets the explicit database while preserving query options', () => {
    const uri = buildDatabaseUri('ss028')
    expect(uri).toMatch(/\/ss028(?:\?|$)/)
  })
})
