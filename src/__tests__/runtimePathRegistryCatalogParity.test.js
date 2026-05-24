import { describe, expect, test } from '@jest/globals'
import { runtimePathRegistrySeeds } from '../seeds/runtimePathRegistry.js'
import { INITIAL_RUNTIME_PATH_REGISTRY } from '../../../VMF-v-1-client/src/mocks/runtimePathRegistry.fixtures.js'

const normalizeEntry = (entry) => ({
  pathKey: entry.pathKey,
  label: entry.label,
  description: entry.description,
  status: entry.status,
  frameworkKeys: [...(entry.frameworkKeys ?? [])],
  scope: entry.scope,
  allowedOperations: [...(entry.allowedOperations ?? [])],
  dataType: entry.dataType,
  category: entry.category,
  sourceType: entry.sourceType,
  isProtected: Boolean(entry.isProtected),
  isSystem: Boolean(entry.isSystem),
  introducedInVersion: entry.introducedInVersion ?? null,
})

describe('Runtime Path Registry catalog parity', () => {
  test('client mock catalog matches backend seed catalog for shared fields', () => {
    const backendCatalog = runtimePathRegistrySeeds
      .map(normalizeEntry)
      .sort((left, right) => left.pathKey.localeCompare(right.pathKey))

    const clientCatalog = INITIAL_RUNTIME_PATH_REGISTRY
      .map(normalizeEntry)
      .sort((left, right) => left.pathKey.localeCompare(right.pathKey))

    expect(clientCatalog).toEqual(backendCatalog)
  })

  test('active seed catalog includes the governed Discovery evidence pack write path', () => {
    expect(runtimePathRegistrySeeds.find((entry) => entry.pathKey === 'framework_state.evidence_pack'))
      .toMatchObject({
        frameworkKeys: ['VMF'],
        scope: 'FRAMEWORK_STATE',
        allowedOperations: ['READ', 'WRITE'],
        dataType: 'OBJECT',
        category: 'STATE',
        sourceType: 'RUNTIME_STATE',
        isProtected: false,
        isSystem: true,
      })
  })
})
