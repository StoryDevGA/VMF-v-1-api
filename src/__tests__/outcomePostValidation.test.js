import { describe, expect, test } from '@jest/globals'

import {
  buildOutcomeAssetPostValidationSnapshot,
} from '../services/outcomePostValidationService.js'

const buildSnapshot = (knowledgePackBinding) => buildOutcomeAssetPostValidationSnapshot({
  asset: { outcomeAssetId: 'asset-1', outputTypeKey: 'BOARD_SUMMARY' },
  version: { outcomeAssetVersionId: 'asset-version-1' },
  customerContent: { markdown: '# Board summary' },
  truthSignature: { currentness: 'CURRENT' },
  knowledgePackBinding,
})

describe('Outcome asset post-validation', () => {
  test('allows READY_WITH_GAPS only when every required safeguard is active', () => {
    const readyWithOptionalGaps = buildSnapshot({
      status: 'READY_WITH_GAPS',
      requiredCount: 3,
      activeCount: 3,
    })
    const missingRequiredSafeguard = buildSnapshot({
      status: 'READY_WITH_GAPS',
      requiredCount: 3,
      activeCount: 2,
    })

    expect(readyWithOptionalGaps.result).toBe('ALLOW')
    expect(readyWithOptionalGaps.status).toBe('PASS')
    expect(missingRequiredSafeguard.result).toBe('BLOCK')
    expect(missingRequiredSafeguard.issues).toContainEqual(expect.objectContaining({
      code: 'KNOWLEDGE-BINDING-PRESERVATION',
    }))
  })
})
