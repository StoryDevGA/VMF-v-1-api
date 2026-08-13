import { describe, expect, test } from '@jest/globals'

import {
  KNOWLEDGE_PACK_BOUNDARIES,
  KNOWLEDGE_PACK_RECEIPT_TYPES,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
  validateOutcomeBoundaryReceipt,
} from '../services/outcomeBoundaryReceiptService.js'

const expectedPack = {
  versionId: 'kpv-rendering-1',
  contentHash: 'sha256:rendering-1',
  boundary: KNOWLEDGE_PACK_BOUNDARIES.POST_GENERATION_VALIDATION,
  receiptType: KNOWLEDGE_PACK_RECEIPT_TYPES.POST_VALIDATION,
}

const validReceipt = {
  contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
  ...expectedPack,
  receiptKey: 'rendering-layer.post-validation.v1',
  validatorKey: 'rendering-layer',
  result: 'ALLOW',
  evidenceReference: 'validation:outcome_post_val_123',
  status: 'PASSED',
  checks: [{ key: 'POST_VALIDATION_PASSED', status: 'PASSED' }],
}

describe('outcome boundary receipt contract', () => {
  test('accepts a complete exact non-provider receipt', () => {
    expect(validateOutcomeBoundaryReceipt({
      expectedPack,
      receipt: validReceipt,
    })).toEqual(expect.objectContaining({ valid: true, failures: [] }))
  })

  test('rejects a receipt with missing executor identity fields', () => {
    const result = validateOutcomeBoundaryReceipt({
      expectedPack,
      receipt: {
        ...validReceipt,
        receiptKey: '',
        validatorKey: '',
        evidenceReference: '',
      },
    })

    expect(result.valid).toBe(false)
    expect(result.failures).toEqual(expect.arrayContaining([
      'RECEIPT_KEY_MISSING',
      'VALIDATOR_KEY_MISSING',
      'EVIDENCE_REFERENCE_MISSING',
    ]))
  })

  test('rejects a global allow without the exact pack identity', () => {
    const result = validateOutcomeBoundaryReceipt({
      expectedPack,
      receipt: {
        ...validReceipt,
        versionId: 'kpv-other-pack',
        contentHash: 'sha256:other-pack',
      },
    })

    expect(result.valid).toBe(false)
    expect(result.failures).toEqual(expect.arrayContaining([
      'VERSION_ID_MISMATCH',
      'CONTENT_HASH_MISMATCH',
    ]))
  })

  test('rejects an unsupported receipt contract version', () => {
    const result = validateOutcomeBoundaryReceipt({
      expectedPack,
      receipt: {
        ...validReceipt,
        contractVersion: 'legacy.receipt.v0',
      },
    })

    expect(result.valid).toBe(false)
    expect(result.failures).toContain('CONTRACT_VERSION_UNSUPPORTED')
  })
})
