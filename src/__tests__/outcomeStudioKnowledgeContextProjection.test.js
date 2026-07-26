import { describe, expect, test } from '@jest/globals'
import { projectOutcomeStudioDeliverableDiscovery } from '../services/outcomeStudioKnowledgeContextService.js'

describe('Outcome Studio deliverable discovery projection', () => {
  test('projects only customer-safe ready deliverables with registry-owned formats', () => {
    const projection = projectOutcomeStudioDeliverableDiscovery({
      availableOutputTypes: [
        {
          capabilityKey: 'board-summary',
          status: 'READY',
          outputType: {
            capabilityKey: 'board-summary',
            label: 'Board Summary Output Type',
            activationId: 'must-not-project',
          },
          outputSchema: { capabilityKey: 'board-summary-schema', label: 'Board Summary Structure' },
          style: { capabilityKey: 'board-executive-style', label: 'Board Executive' },
        },
        {
          capabilityKey: 'blocked-proposal',
          status: 'BLOCKED',
          outputType: { capabilityKey: 'blocked-proposal', label: 'Blocked Proposal' },
          outputSchema: null,
          style: null,
        },
      ],
    })

    expect(projection).toEqual({
      status: 'AVAILABLE',
      available: [{
        key: 'board-summary',
        label: 'Board Summary',
        formats: [
          expect.objectContaining({ format: 'MARKDOWN', label: 'Markdown' }),
          expect.objectContaining({ format: 'JSON', label: 'JSON' }),
          expect.objectContaining({ format: 'DOCX', label: 'DOCX' }),
          expect.objectContaining({ format: 'PDF', label: 'PDF' }),
        ],
      }],
      availableCount: 1,
      unavailableCount: 1,
      supportedFormats: ['MARKDOWN', 'JSON', 'DOCX', 'PDF'],
    })
    expect(JSON.stringify(projection)).not.toContain('activationId')
    expect(JSON.stringify(projection)).not.toContain('must-not-project')
  })

  test('returns an honest unavailable state when no discovered type is complete', () => {
    expect(projectOutcomeStudioDeliverableDiscovery({
      availableOutputTypes: [{
        capabilityKey: 'incomplete',
        status: 'READY',
        outputType: { capabilityKey: 'incomplete', label: 'Incomplete' },
        outputSchema: null,
        style: null,
      }],
    })).toEqual({
      status: 'UNAVAILABLE',
      available: [],
      availableCount: 0,
      unavailableCount: 1,
      supportedFormats: [],
    })
  })

  test('preserves distinct underscore and hyphen capability identities', () => {
    const makeDiscoveredType = (capabilityKey) => ({
      capabilityKey,
      status: 'READY',
      outputType: { capabilityKey, label: '' },
      outputSchema: { capabilityKey: `${capabilityKey}-schema`, label: 'Structure' },
      style: { capabilityKey: `${capabilityKey}-style`, label: 'Style' },
    })

    const projection = projectOutcomeStudioDeliverableDiscovery({
      availableOutputTypes: [
        makeDiscoveredType('sales_email'),
        makeDiscoveredType('sales-email'),
      ],
    })

    expect(projection.available.map((entry) => entry.key).sort()).toEqual([
      'sales-email',
      'sales_email',
    ])
    expect(projection.available.find((entry) => entry.key === 'sales_email')?.label).toBe('Sales Email')
  })
})
