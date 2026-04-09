import { describe, expect, test } from '@jest/globals'
import { frameworkRegistrySeeds } from '../seeds/frameworkRegistry.js'

describe('frameworkRegistry seed defaults', () => {
  test('include the canonical runtime-control registry entries needed by default forms', () => {
    expect(frameworkRegistrySeeds).toEqual([
      expect.objectContaining({
        frameworkKey: 'VMF',
        status: 'ACTIVE',
        supportedWorkflowKeys: ['vmf-baseline', 'vmf-publish'],
      }),
      expect.objectContaining({
        frameworkKey: 'RLD',
        status: 'ACTIVE',
        supportedWorkflowKeys: ['rld-baseline', 'rld-publish'],
      }),
      expect.objectContaining({
        frameworkKey: 'QMF',
        status: 'DRAFT',
      }),
      expect.objectContaining({
        frameworkKey: 'CMF',
        status: 'DRAFT',
      }),
      expect.objectContaining({
        frameworkKey: 'OPS',
        status: 'DEPRECATED',
      }),
    ])
  })
})
