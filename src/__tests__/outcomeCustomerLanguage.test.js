import { describe, expect, test } from '@jest/globals'

import {
  findOutcomeCustomerLanguageViolation,
  validateOutcomeCustomerLanguage,
} from '../services/outcomeCustomerLanguageService.js'

describe('Outcome Studio customer-language validation', () => {
  test.each([
    ['Certified Truth', 'CERTIFIED_TRUTH'],
    ['truth_signature', 'TRUTH_SIGNATURE'],
    ['KNOWLEDGE-PACKS', 'KNOWLEDGE_PACK'],
    ['provider.context', 'PROVIDER_CONTEXT'],
    ['Deterministic provider output is non-production scaffolding unless replaced by a live provider adapter.', 'PROVIDER_IMPLEMENTATION'],
    ['Resolved Knowledge Context', 'RESOLVED_KNOWLEDGE_CONTEXT'],
    ['runtime binding', 'RUNTIME'],
    ['GRR execution', 'GRR'],
    ['selectedByLayer', 'SELECTED_BY_LAYER'],
    ['manifest_id', 'MANIFEST'],
    ['section-key', 'SECTION_KEY'],
    ['content_hash', 'CONTENT_HASH'],
    ['storage key', 'STORAGE_KEY'],
    ['system message', 'SYSTEM_MESSAGE'],
    ['provider prompt', 'PROMPT'],
  ])('blocks the prohibited variant %s', (text, termKey) => {
    expect(findOutcomeCustomerLanguageViolation({ markdown: text })).toEqual(expect.objectContaining({
      code: 'CUSTOMER_LANGUAGE_PROHIBITED_TERM',
      path: 'customerContent.markdown',
      termKey,
    }))
  })

  test('allows customer-oriented business language and material caveats', () => {
    expect(validateOutcomeCustomerLanguage({
      markdown: '# Board review\n\nBased on your verified business information, revenue remains uncertain.',
      warnings: ['Review the financial assumptions before external use.'],
      limitations: ['The available evidence does not cover the final quarter.'],
    })).toEqual(expect.objectContaining({
      safe: true,
      violation: null,
    }))
  })

  test('scans nested string values without treating object keys as content', () => {
    expect(findOutcomeCustomerLanguageViolation({
      providerContext: {
        safeBusinessLabel: 'Relevant business guidance',
      },
      sections: [{ body: 'The provider_context must remain hidden.' }],
    })).toEqual(expect.objectContaining({
      path: 'customerContent.sections[0].body',
      termKey: 'PROVIDER_CONTEXT',
    }))
  })

  test('is circular-safe', () => {
    const content = { markdown: 'Customer-ready business summary.' }
    content.self = content

    expect(validateOutcomeCustomerLanguage(content).safe).toBe(true)
  })

  test.each([
    [{ nested: { value: { text: 'Safe' } } }, { maxDepth: 2 }],
    [['one', 'two', 'three'], { maxEntries: 2 }],
    [{ markdown: '123456' }, { maxStringLength: 5 }],
    [{ one: '123', two: '456' }, { maxTotalCharacters: 5 }],
  ])('fails closed when a scan bound is exceeded', (content, options) => {
    expect(findOutcomeCustomerLanguageViolation(content, options)).toEqual(expect.objectContaining({
      code: 'CUSTOMER_LANGUAGE_SCAN_LIMIT_EXCEEDED',
    }))
  })
})
