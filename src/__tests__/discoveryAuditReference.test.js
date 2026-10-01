import { describe, expect, test } from '@jest/globals'
import {
  appendDiscoveryAuditRef,
  attachDiscoveryDecisionAuditRef,
  attachDiscoveryRegistrationAuditRef,
  attachRuntimeIntelligenceGraphAuditRef,
} from '../services/discoveryAuditReferenceService.js'

describe('Discovery Contract audit references', () => {
  test('deduplicates stable audit references without adding empty values', () => {
    expect(appendDiscoveryAuditRef(['audit-1', ' audit-1 '], ' audit-2 ')).toEqual([
      'audit-1',
      'audit-2',
    ])
    expect(appendDiscoveryAuditRef(['audit-1'], '')).toEqual(['audit-1'])
  })

  test('links source registration to source and candidate evidence records immutably', () => {
    const source = { sourceId: 'source-1' }
    const evidence = { evidenceObjectId: 'evidence-1', sourceId: 'source-1' }
    const input = {
      sourceRegistry: [source],
      evidenceObjects: [evidence],
      lineage: { sources: [source], builder: { mode: 'DETERMINISTIC' } },
      acquisition: { sourceRegistry: [source] },
    }

    const result = attachDiscoveryRegistrationAuditRef(input, 'audit-registration-1')

    expect(result.audit_refs).toEqual(['audit-registration-1'])
    expect(result.sourceRegistry[0].auditRef).toBe('audit-registration-1')
    expect(result.evidenceObjects[0].auditRef).toBe('audit-registration-1')
    expect(result.lineage.sources[0].auditRef).toBe('audit-registration-1')
    expect(result.acquisition.sourceRegistry[0].auditRef).toBe('audit-registration-1')
    expect(input.sourceRegistry[0]).toEqual(source)
    expect(input.evidenceObjects[0]).toEqual(evidence)
  })

  test('preserves audit history for carried evidence during a later registration', () => {
    const previousEvidencePack = {
      audit_refs: ['audit-registration-old', 'audit-review-accepted', 'audit-review-rejected'],
      sourceRegistry: [
        { sourceId: 'source-carried', auditRef: 'audit-registration-old', auditRefs: ['audit-registration-old'] },
      ],
      evidenceObjects: [
        {
          evidenceObjectId: 'evidence-accepted',
          sourceId: 'source-carried',
          reviewStatus: 'ACCEPTED',
          auditRef: 'audit-review-accepted',
          auditRefs: ['audit-registration-old', 'audit-review-accepted'],
        },
        {
          evidenceObjectId: 'evidence-rejected',
          sourceId: 'source-carried',
          reviewStatus: 'REJECTED',
          auditRef: 'audit-review-rejected',
          auditRefs: ['audit-registration-old', 'audit-review-rejected'],
        },
        {
          evidenceObjectId: 'evidence-reset-to-pending',
          sourceId: 'source-carried',
          extractedFact: 'Previously accepted fact',
          reviewStatus: 'ACCEPTED',
          auditRef: 'audit-review-reset',
          auditRefs: ['audit-registration-old', 'audit-review-reset'],
        },
      ],
    }
    const nextEvidencePack = {
      sourceRegistry: [
        { sourceId: 'source-carried', auditRef: 'audit-registration-old' },
        { sourceId: 'source-new' },
      ],
      evidenceObjects: [
        { evidenceObjectId: 'evidence-accepted', sourceId: 'source-carried', reviewStatus: 'ACCEPTED' },
        { evidenceObjectId: 'evidence-rejected', sourceId: 'source-carried', reviewStatus: 'REJECTED' },
        {
          evidenceObjectId: 'evidence-reset-to-pending',
          sourceId: 'source-carried',
          extractedFact: 'Previously accepted fact',
          reviewStatus: 'PENDING',
        },
        { evidenceObjectId: 'evidence-new', sourceId: 'source-new', reviewStatus: 'PENDING' },
      ],
      lineage: { sources: [{ sourceId: 'source-carried' }, { sourceId: 'source-new' }] },
      acquisition: { sourceRegistry: [{ sourceId: 'source-carried' }, { sourceId: 'source-new' }] },
    }

    const result = attachDiscoveryRegistrationAuditRef(
      nextEvidencePack,
      'audit-registration-new',
      previousEvidencePack,
    )

    expect(result.audit_refs).toEqual(expect.arrayContaining([
      'audit-registration-old',
      'audit-review-accepted',
      'audit-review-rejected',
      'audit-registration-new',
    ]))
    expect(result.evidenceObjects[0]).toMatchObject({
      reviewStatus: 'ACCEPTED',
      auditRef: 'audit-review-accepted',
      auditRefs: ['audit-registration-old', 'audit-review-accepted'],
    })
    expect(result.evidenceObjects[1]).toMatchObject({
      reviewStatus: 'REJECTED',
      auditRef: 'audit-review-rejected',
      auditRefs: ['audit-registration-old', 'audit-review-rejected'],
    })
    expect(result.evidenceObjects[2]).toMatchObject({
      reviewStatus: 'PENDING',
      auditRef: 'audit-registration-new',
      auditRefs: ['audit-registration-old', 'audit-review-reset', 'audit-registration-new'],
    })
    expect(result.evidenceObjects[3]).toMatchObject({
      auditRef: 'audit-registration-new',
      auditRefs: ['audit-registration-new'],
    })
    expect(result.sourceRegistry[0].auditRef).toBe('audit-registration-old')
    expect(result.sourceRegistry[1].auditRef).toBe('audit-registration-new')
  })

  test('links only reviewed evidence to its admission decision event', () => {
    const input = {
      audit_refs: ['audit-registration-1'],
      evidenceObjects: [
        { evidenceObjectId: 'evidence-reviewed', reviewStatus: 'ACCEPTED', auditRef: 'audit-registration-1' },
        { evidenceObjectId: 'evidence-untouched', reviewStatus: 'PENDING', auditRef: 'audit-registration-1' },
      ],
    }

    const result = attachDiscoveryDecisionAuditRef(input, 'audit-review-1', [input.evidenceObjects[0]])

    expect(result.audit_refs).toEqual(['audit-registration-1', 'audit-review-1'])
    expect(result.evidenceObjects.map((evidence) => evidence.auditRef)).toEqual([
      'audit-review-1',
      'audit-registration-1',
    ])
    expect(input.evidenceObjects[0].auditRef).toBe('audit-registration-1')
  })

  test('adds the audit request reference to graph build metadata only', () => {
    const graph = {
      graphHash: 'sha256:unchanged',
      build: { trigger: 'EVIDENCE_REVIEWED', sourceHash: 'sha256:source' },
    }

    const result = attachRuntimeIntelligenceGraphAuditRef(graph, 'audit-graph-1')

    expect(result).toEqual({
      ...graph,
      build: { ...graph.build, auditRef: 'audit-graph-1' },
    })
    expect(result.graphHash).toBe(graph.graphHash)
    expect(graph.build.auditRef).toBeUndefined()
  })
})
