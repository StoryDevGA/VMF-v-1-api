import { describe, expect, test } from '@jest/globals'
import { validationRegistrySeeds } from '../seeds/validationRegistry.js'
import { INITIAL_VALIDATION_REGISTRY } from '../../../VMF-v-1-client/src/pages/SuperAdminValidationRegistry/superAdminValidationRegistry.constants.js'

const normalizeEntry = (entry) => ({
  key: entry.key,
  label: entry.label,
  description: entry.description,
  status: entry.status,
  supportedFrameworkKeys: [...(entry.supportedFrameworkKeys ?? [])],
  category: entry.category,
  severity: entry.severity,
  producerSkillId: entry.producerSkillId,
  outputPath: entry.outputPath,
  passFieldPath: entry.passFieldPath,
  detailsFieldPath: entry.detailsFieldPath,
  policyUsable: Boolean(entry.policyUsable),
  packageUsable: Boolean(entry.packageUsable),
  freshnessDefaultMinutes: entry.freshnessDefaultMinutes,
  blockingDefault: Boolean(entry.blockingDefault),
  warningOnlyDefault: Boolean(entry.warningOnlyDefault),
})

describe('Validation Registry catalog parity', () => {
  test('client mock catalog matches backend staged seed catalog for shared fields', () => {
    const backendCatalog = validationRegistrySeeds
      .map(normalizeEntry)
      .sort((left, right) => left.key.localeCompare(right.key))

    const clientCatalog = INITIAL_VALIDATION_REGISTRY
      .map(normalizeEntry)
      .sort((left, right) => left.key.localeCompare(right.key))

    expect(clientCatalog).toEqual(backendCatalog)
  })
})
