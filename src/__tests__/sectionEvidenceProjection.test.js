import { describe, expect, test } from '@jest/globals'
import { buildSectionEvidenceProjection } from '../services/sectionEvidenceProjectionService.js'

const evidence = ({
  category,
  coverageArea,
  extractedFact,
  evidenceObjectId,
  reviewStatus = 'ACCEPTED',
}) => ({
  evidenceObjectId,
  sourceId: `source-${evidenceObjectId}`,
  category,
  coverageArea,
  extractedFact,
  reviewStatus,
})

describe('section evidence projection', () => {
  test('selects different accepted pools for each current VMF section', () => {
    const corpus = [
      evidence({
        evidenceObjectId: 'company-context',
        category: 'Company',
        coverageArea: 'Company',
        extractedFact: 'Company context identifies the operating business and market setting.',
      }),
      evidence({
        evidenceObjectId: 'product-context',
        category: 'Products',
        coverageArea: 'Products',
        extractedFact: 'The target product is an AI observability platform for enterprise teams.',
      }),
      evidence({
        evidenceObjectId: 'objective-context',
        category: 'Value Drivers',
        coverageArea: 'Economics',
        extractedFact: 'The strategic objective is to reduce proposal cycle time by a measured target.',
      }),
      evidence({
        evidenceObjectId: 'current-context',
        category: 'Technology',
        coverageArea: 'Technology',
        extractedFact: 'The current architecture has a manual telemetry integration bottleneck.',
      }),
      evidence({
        evidenceObjectId: 'stakeholder-context',
        category: 'Proof',
        coverageArea: 'Proof',
        extractedFact: 'The enterprise buyer and accountable sponsor are the stakeholder roles to confirm.',
      }),
      evidence({
        evidenceObjectId: 'evidence-context',
        category: 'Proof',
        coverageArea: 'Proof',
        extractedFact: 'The evidence record identifies the source and production deployment observation.',
      }),
      evidence({
        evidenceObjectId: 'output-context',
        category: 'Value Drivers',
        coverageArea: 'Decision Context',
        extractedFact: 'The required output is a customer-facing brief with an audience, format and approval channel.',
      }),
    ]

    const sectionKeys = [
      'customer_context',
      'strategic_objectives',
      'current_state_assessment',
      'stakeholder_register',
      'evidence_register',
      'output_requirements',
    ]
    const projections = Object.fromEntries(sectionKeys.map((sectionKey) => [
      sectionKey,
      buildSectionEvidenceProjection({ evidenceObjects: corpus, maxItems: 3, sectionKey }),
    ]))

    expect(projections.customer_context.selectedEvidenceObjects.map((item) => item.evidenceObjectId))
      .toEqual(expect.arrayContaining(['company-context', 'product-context']))
    expect(projections.strategic_objectives.selectedEvidenceObjects.map((item) => item.evidenceObjectId))
      .toContain('objective-context')
    expect(projections.current_state_assessment.selectedEvidenceObjects.map((item) => item.evidenceObjectId))
      .toContain('current-context')
    expect(projections.stakeholder_register.selectedEvidenceObjects.map((item) => item.evidenceObjectId))
      .toContain('stakeholder-context')
    expect(projections.evidence_register.selectedEvidenceObjects.map((item) => item.evidenceObjectId))
      .toContain('evidence-context')
    expect(projections.output_requirements.selectedEvidenceObjects.map((item) => item.evidenceObjectId))
      .toContain('output-context')
    expect(new Set(sectionKeys.map((sectionKey) =>
      projections[sectionKey].selectedEvidenceObjects.map((item) => item.evidenceObjectId).join('|'))).size)
      .toBe(sectionKeys.length)
  })

  test('excludes non-accepted evidence, reports caps, and fails closed on a missing pool', () => {
    const projection = buildSectionEvidenceProjection({
      sectionKey: 'strategic-objectives',
      maxItems: 1,
      evidenceObjects: [
        evidence({
          evidenceObjectId: 'objective-one',
          category: 'Value Drivers',
          coverageArea: 'Decision Context',
          extractedFact: 'The objective is to increase adoption in the next planning cycle.',
        }),
        evidence({
          evidenceObjectId: 'objective-two',
          category: 'Economics',
          coverageArea: 'Economics',
          extractedFact: 'The target outcome is a measurable reduction in cycle time.',
        }),
        evidence({
          evidenceObjectId: 'pending-objective',
          category: 'Value Drivers',
          coverageArea: 'Decision Context',
          extractedFact: 'Pending evidence says the objective is guaranteed.',
          reviewStatus: 'PENDING',
        }),
        evidence({
          evidenceObjectId: 'rejected-objective',
          category: 'Value Drivers',
          coverageArea: 'Decision Context',
          extractedFact: 'Rejected evidence says the objective is guaranteed.',
          reviewStatus: 'REJECTED',
        }),
      ],
    })

    expect(projection.selectedEvidenceObjects).toHaveLength(1)
    expect(projection.selectedEvidenceObjects[0].evidenceObjectId)
      .not.toBe('pending-objective')
    expect(projection.selectedEvidenceObjects[0].evidenceObjectId)
      .not.toBe('rejected-objective')
    expect(projection.excludedReasonCounts).toEqual(expect.objectContaining({
      INELIGIBLE_REVIEW_STATUS: 2,
      SELECTION_CAP: 1,
    }))
    expect(projection.excludedEvidenceObjectIds).not.toEqual(
      expect.arrayContaining(['pending-objective', 'rejected-objective']),
    )

    const missing = buildSectionEvidenceProjection({
      sectionKey: 'output_requirements',
      evidenceObjects: [evidence({
        evidenceObjectId: 'unrelated-company',
        category: 'Company',
        coverageArea: 'Company',
        extractedFact: 'Company name is available.',
      })],
    })
    expect(missing.selectedEvidenceObjects).toEqual([])
    expect(missing.gaps).toEqual(['NO_SECTION_RELEVANT_ACCEPTED_EVIDENCE'])
  })

  test('keeps unknown legacy scoped-view keys on accepted-order compatibility', () => {
    const corpus = Array.from({ length: 14 }, (_, index) => evidence({
      evidenceObjectId: `legacy-${index + 1}`,
      category: 'Value Drivers',
      coverageArea: 'Decision Context',
      extractedFact: `Accepted legacy evidence fact ${index + 1}.`,
    }))
    const projection = buildSectionEvidenceProjection({
      sectionKey: 'value_drivers',
      maxItems: null,
      evidenceObjects: corpus,
    })

    expect(projection.knownSection).toBe(false)
    expect(projection.selectedEvidenceObjects).toHaveLength(14)
    expect(projection.included[0]).toEqual(expect.objectContaining({
      evidenceObjectId: 'legacy-1',
      reasonCodes: ['LEGACY_UNKNOWN_SECTION_COMPATIBILITY'],
    }))
  })
})
