import { describe, expect, jest, test } from '@jest/globals'
import { FrameworkPackage } from '../models/index.js'

import {
  FRAMEWORK_OUTCOME_CLAIM_TYPES,
  FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES,
  FRAMEWORK_OUTCOME_HANDOFF_STATUSES,
  buildFrameworkOutcomeStudioHandoff,
  checkFrameworkOutcomeStudioHandoffCurrentness,
  evaluateFrameworkOutcomeClaimBoundary,
  resolveFrameworkOutcomeStudioHandoff,
  validateFrameworkOutcomeStudioHandoff,
} from '../services/outcomeFrameworkHandoffService.js'

const makeEvidence = (index, evidenceObjectId = `evidence_object_${index}`) => ({
  evidenceObjectId,
  sourceId: `source_${index}`,
  lineageRef: `lineage:source_${index}:evidence_object_${index}`,
  reviewStatus: 'ACCEPTED',
  extractedFact: `Accepted fact ${index}.`,
})

const makeFixture = ({
  sectionKeys = [
    'customer_context',
    'customer_problem',
    'value_drivers',
    'current_state_assessment',
    'stakeholder_register',
    'output_requirements',
  ],
  evidenceIds = [],
  truthHashes = [],
  runtimeIdentity = {},
} = {}) => {
  const evidenceObjects = sectionKeys.map((_sectionKey, index) =>
    makeEvidence(index + 1, evidenceIds[index]),
  )
  const sections = Object.fromEntries(sectionKeys.map((sectionKey, index) => {
    const evidence = evidenceObjects[index]
    return [sectionKey, {
      accepted: {
        content: `Accepted ${sectionKey} truth.`,
        truthHash: truthHashes[index] || `sha256:${String(index + 1).repeat(64)}`,
        acceptedAt: '2026-08-14T08:00:00.000Z',
        acceptedBy: 'user_1',
        sourceActionKey: 'GENERATE_SECTION',
        sourceGeneratedAt: '2026-08-14T07:59:00.000Z',
        supportingEvidenceRefs: [evidence.evidenceObjectId],
        generationBoundaries: [{
          boundaryKey: `${sectionKey}_claim_boundary`,
          reason: 'UNSUPPORTED_CLAIM',
          message: 'Verify direct support before unsupported commercial claims.',
        }],
      },
      generated: {
        evidenceProjection: {
          algorithm: 'SECTION_DOMAIN_KEYWORD_RANKING',
          version: 'vmf-section-evidence-projection-v1',
          sectionKey,
          knownSection: true,
          candidateCount: evidenceObjects.length,
          eligibleAcceptedCount: evidenceObjects.length,
          includedCount: 1,
          included: [{
            evidenceObjectId: evidence.evidenceObjectId,
            coverageArea: 'Proof',
            category: 'Proof',
            relevanceScore: 100,
            reasonCodes: ['SECTION_COVERAGE_MATCH'],
          }],
          excludedCount: evidenceObjects.length - 1,
          excludedReasonCounts: { SECTION_SELECTION: evidenceObjects.length - 1 },
          selectedCoverageAreas: ['Proof'],
          gaps: [],
        },
      },
      state: { status: 'ACCEPTED' },
      review: { status: 'ACCEPTED' },
    }]
  }))

  const frameworkPackage = {
    _id: runtimeIdentity.packageId || 'package_1',
    packageKey: runtimeIdentity.packageKey || 'standard-package-vmf-3-1-3-rkm',
    version: runtimeIdentity.packageVersion || '3.1.3',
    sections: sectionKeys.map((sectionKey) => ({
      sectionKey,
      runtimePath: `framework_state.sections.${sectionKey}`,
      label: sectionKey,
      required: true,
    })),
  }

  const runtimeInstance = {
    _id: runtimeIdentity.runtimeId || 'runtime_1',
    packageId: 'package_1',
    runtimeInstanceKey: 'value-narrative-parlon-ss011',
    runtimeType: 'VALUE_NARRATIVE',
    frameworkKey: 'VMF',
    packageKey: frameworkPackage.packageKey,
    packageVersion: frameworkPackage.version,
    status: 'LOCKED',
    executionStatus: 'COMPLETE',
    updatedAt: '2026-08-14T08:10:00.000Z',
    revision: { revisionId: 'revision_1', revisionNumber: 2 },
    framework_state: {
      sections,
      evidence_pack: {
        accepted: true,
        evidenceObjects,
      },
      publish: {
        state: 'PUBLISHED',
        published: true,
        snapshot: { snapshotId: 'publish_1', snapshotHash: 'publish_hash_1' },
      },
      lock: {
        state: 'LOCKED',
        locked: true,
        outputEligible: false,
        snapshot: { snapshotId: 'lock_1', snapshotHash: 'lock_hash_1' },
        replayAnchor: { replayAnchorId: 'anchor_1', replayAnchorHash: 'anchor_hash_1' },
        outputEligibility: {
          state: 'OUTPUT_ELIGIBLE',
          outputEligible: true,
          canonicalOutputEligible: true,
          anchorEligible: true,
          intelligenceEligible: true,
          sectionTruthReady: true,
        },
      },
    },
  }

  const packBinding = {
    status: 'PROJECTED',
    mode: 'REGISTRY',
    resolutionSource: 'OUTCOME_KNOWLEDGE_PACK_REGISTRY',
    policyKey: 'outcome-studio',
    policyVersion: 'v1',
    requiredPacks: [
      { packType: 'ARL', packKey: 'adaptive-reasoning-layer', runtimeBindable: true, status: 'ACTIVE' },
      { packType: 'RL', packKey: 'rendering-layer', runtimeBindable: true, status: 'ACTIVE' },
    ],
    activePacks: [
      { packType: 'ARL', packKey: 'adaptive-reasoning-layer', runtimeBindable: true, status: 'ACTIVE' },
      { packType: 'RL', packKey: 'rendering-layer', runtimeBindable: true, status: 'ACTIVE' },
    ],
  }

  const knowledgeContext = {
    contractVersion: 'oes-004-resolved-knowledge-context.v1',
    contextId: 'context_1',
    status: 'READY',
    available: true,
    requestedOutputTypeKey: 'executive-brief',
    outputType: { key: 'executive-brief' },
    outputSchema: { key: 'executive-brief-schema' },
    style: { key: 'executive-brief-style' },
    renderer: { capabilityKey: 'executive-brief', capabilityVersion: '1' },
    lineage: { contentHashes: ['sha256:knowledge_1'] },
  }

  Object.assign(runtimeInstance, runtimeIdentity)
  return { runtimeInstance, frameworkPackage, packBinding, knowledgeContext, sectionKeys }
}

describe('Framework-to-Outcome Studio Evidence-to-Knowledge handoff', () => {
  test('builds one current runtime-scoped handoff and treats nested lock eligibility as canonical', () => {
    const fixture = makeFixture()
    const handoff = buildFrameworkOutcomeStudioHandoff({
      ...fixture,
      requestedOutputTypeKey: 'executive-brief',
    })

    expect(handoff.status).toBe(FRAMEWORK_OUTCOME_HANDOFF_STATUSES.READY_WITH_GAPS)
    expect(handoff.runtime).toEqual(expect.objectContaining({
      runtimeInstanceKey: 'value-narrative-parlon-ss011',
      runtimeType: 'VALUE_NARRATIVE',
      frameworkKey: 'VMF',
    }))
    expect(handoff.package).toEqual(expect.objectContaining({
      packageKey: 'standard-package-vmf-3-1-3-rkm',
      packageVersion: '3.1.3',
      requiredSections: expect.arrayContaining([
        expect.objectContaining({ sectionKey: 'customer_context' }),
      ]),
    }))
    expect(handoff.canonicalEligibility).toEqual(expect.objectContaining({
      outputEligible: true,
      canonicalOutputEligible: true,
      outerOutputEligible: false,
      outerEligibilityMismatch: true,
    }))
    expect(handoff.contradictions).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OUTER_NESTED_OUTPUT_ELIGIBILITY_CONTRADICTION' }),
    ]))
    expect(handoff.sectionTruth).toHaveLength(6)
    expect(handoff.sectionTruth[0].projectionReceipt).toEqual(expect.objectContaining({
      version: 'vmf-section-evidence-projection-v1',
      selectedEvidenceRefs: expect.any(Array),
    }))
    expect(handoff.knowledgeResolution).toEqual(expect.objectContaining({
      binding: expect.objectContaining({ status: 'PROJECTED' }),
      context: expect.objectContaining({ available: true }),
      resolutionHash: expect.stringMatching(/^sha256:/),
    }))
    expect(handoff.currentness.handoffHash).toMatch(/^sha256:/)
    expect(validateFrameworkOutcomeStudioHandoff(handoff)).toEqual({ valid: true, failures: [] })
  })

  test('proves the locked SS-010 Parlon Runtime 3 fixture resolves through the handoff boundary', () => {
    const fixture = makeFixture({
      sectionKeys: [
        'customer_context',
        'strategic_objectives',
        'current_state_assessment',
        'stakeholder_register',
        'evidence_register',
        'output_requirements',
      ],
      evidenceIds: [
        'evidence_document_f9c69de5de07',
        'evidence_website_2830350dfa99',
        'evidence_document_d751c1cbf788',
        'evidence_document_faffe70c4817',
        'evidence_document_771995418eca',
        'evidence_document_edf3c9e8d1ab',
      ],
      truthHashes: [
        'sha256:7667ea0bea230b9c1b16975693dd8b66b01de8a3a632bdf09ce36f61f1ed4522',
        'sha256:5de804e78e0dab928be2be24991ed5d0db851c4bffebaf9616d0b007a5704d34',
        'sha256:c450933f9d2494bc46b63140f6e85287af9ad370492850a10ecc9311e3055052',
        'sha256:783bba36c9ac1cc559ac87203964e4e52f9ce7d6c7e52dece85a96a3418c3aff',
        'sha256:416bb69a30f59abc9eba00b3f0f5a3019f201a58c2dd40deec30ccb3efe8acfa',
        'sha256:8cec1e743c77923542df85a2779c81f1878b4e58925d2b8b59b51102eda3f58d',
      ],
      runtimeIdentity: {
        runtimeId: '6a7dea9c941bfa90798ba9b3',
        runtimeInstanceKey: 'value-narrative-7a21bd41f055-rev-2-798ba9b3',
        packageId: '6a6a2cfabb9cebc18a1ebfd9',
        packageKey: 'standard-package-vmf-3-1-3-rkm',
        packageVersion: '3.1.3',
      },
    })
    fixture.runtimeInstance.framework_state.publish.snapshot = {
      snapshotId: 'runtime-truth-publish-value-narrative-7a21bd41f055-rev-2-798ba9b3-27ec8e0d44b10c3f',
      snapshotHash: '27ec8e0d44b10c3fbcb19e2ecfb7b65da43c63a66bf7d7b63f3a4869c7887ff6',
    }
    fixture.runtimeInstance.framework_state.lock.snapshot = {
      snapshotId: 'runtime-truth-lock-record-value-narrative-7a21bd41f055-rev-2-798ba9b3-119c32489d60afa8',
      snapshotHash: '119c32489d60afa856e05ab24bfdf08d3f2f36612c956d92c5786b126daca152',
    }
    fixture.runtimeInstance.framework_state.lock.replayAnchor = {
      replayAnchorId: 'runtime-replay-anchor-3b05e5f049fa1cc3',
      replayAnchorHash: '3b05e5f049fa1cc38c951d8a2a1b54c673b2867bded2bbf26b60de83b7a8ed40',
    }

    const handoff = buildFrameworkOutcomeStudioHandoff({
      ...fixture,
      requestedOutputTypeKey: 'executive-brief',
    })

    expect(handoff.status).toBe(FRAMEWORK_OUTCOME_HANDOFF_STATUSES.READY_WITH_GAPS)
    expect(handoff.runtime).toEqual(expect.objectContaining({
      runtimeInstanceId: '6a7dea9c941bfa90798ba9b3',
      runtimeInstanceKey: 'value-narrative-7a21bd41f055-rev-2-798ba9b3',
    }))
    expect(handoff.package).toEqual(expect.objectContaining({
      packageId: '6a6a2cfabb9cebc18a1ebfd9',
      packageKey: 'standard-package-vmf-3-1-3-rkm',
      packageVersion: '3.1.3',
      requiredSections: expect.arrayContaining([
        expect.objectContaining({ sectionKey: 'strategic_objectives' }),
        expect.objectContaining({ sectionKey: 'evidence_register' }),
      ]),
    }))
    expect(handoff.sectionTruth).toHaveLength(6)
    expect(handoff.sectionTruth).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sectionKey: 'strategic_objectives',
        truth: expect.objectContaining({
          truthHash: 'sha256:5de804e78e0dab928be2be24991ed5d0db851c4bffebaf9616d0b007a5704d34',
        }),
        projectionReceipt: expect.objectContaining({
          sectionKey: 'strategic_objectives',
          version: 'vmf-section-evidence-projection-v1',
        }),
      }),
    ]))
    expect(handoff.canonicalEligibility).toEqual(expect.objectContaining({
      outputEligible: true,
      canonicalOutputEligible: true,
      outerOutputEligible: false,
      outerEligibilityMismatch: true,
      lockSnapshotId: expect.stringContaining('runtime-truth-lock-record-'),
      replayAnchorId: 'runtime-replay-anchor-3b05e5f049fa1cc3',
    }))
    expect(handoff.blockers).toEqual([])
    expect(handoff.contradictions).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OUTER_NESTED_OUTPUT_ELIGIBILITY_CONTRADICTION' }),
    ]))
  })

  test('blocks a missing projection receipt and required package section', () => {
    const missingProjection = makeFixture()
    delete missingProjection.runtimeInstance.framework_state.sections.customer_context.generated
    const projectionHandoff = buildFrameworkOutcomeStudioHandoff(missingProjection)
    expect(projectionHandoff.status).toBe('BLOCKED')
    expect(projectionHandoff.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.PROJECTION_RECEIPT_MISSING,
        sectionKey: 'customer_context',
      }),
    ]))

    const missingRequired = makeFixture()
    delete missingRequired.runtimeInstance.framework_state.sections.output_requirements
    const requiredHandoff = buildFrameworkOutcomeStudioHandoff(missingRequired)
    expect(requiredHandoff.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.PACKAGE_REQUIRED_SECTION_MISSING,
        sectionKeys: ['output_requirements'],
      }),
    ]))
  })

  test('detects stale runtime currentness without rewriting the handoff', () => {
    const fixture = makeFixture()
    const handoff = buildFrameworkOutcomeStudioHandoff(fixture)
    const staleRuntime = {
      ...fixture.runtimeInstance,
      updatedAt: '2026-08-14T08:11:00.000Z',
    }
    expect(checkFrameworkOutcomeStudioHandoffCurrentness({
      handoff,
      runtimeInstance: staleRuntime,
    })).toEqual(expect.objectContaining({
      current: false,
      status: 'STALE',
      reasons: expect.arrayContaining(['RUNTIME_IDENTITY_CHANGED']),
    }))
  })

  test.each(FRAMEWORK_OUTCOME_CLAIM_TYPES)('%s remains fail-closed without accepted evidence or boundary pass', (claimType) => {
    expect(evaluateFrameworkOutcomeClaimBoundary({ claimType })).toEqual(expect.objectContaining({
      status: 'BLOCKED',
      permitted: false,
    }))
    expect(evaluateFrameworkOutcomeClaimBoundary({
      claimType,
      acceptedEvidenceRefs: [{ acceptanceState: 'ACCEPTED' }],
      boundaryPassed: true,
    })).toEqual(expect.objectContaining({
      status: 'PERMITTED_BY_ACCEPTED_EVIDENCE_AND_BOUNDARY',
      permitted: true,
    }))
  })

  test('returns a blocked handoff instead of throwing when resolution fails', async () => {
    const fixture = makeFixture()
    const result = await resolveFrameworkOutcomeStudioHandoff({
      runtimeInstance: fixture.runtimeInstance,
      frameworkPackage: fixture.frameworkPackage,
      requestedOutputTypeKey: 'executive-brief',
      resolvePack: async () => {
        throw new Error('registry unavailable')
      },
    })
    expect(result.handoff.status).toBe('BLOCKED')
    expect(result.handoff.blockers[0]).toEqual(expect.objectContaining({
      code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.HANDOFF_RESOLUTION_FAILED,
    }))
  })

  test('bounded handoff reads use the package projection, ceiling, and timeout without legacy state access', async () => {
    const fixture = makeFixture()
    fixture.runtimeInstance.customerId = 'customer_1'
    const boundedPackage = {
      _id: 'package_1',
      packageKey: fixture.frameworkPackage.packageKey,
      version: fixture.frameworkPackage.version,
      frameworkKey: 'VMF',
      status: 'ACTIVE',
      visibility: 'CUSTOMER_VISIBLE',
      customerAccessMode: 'ALL_CUSTOMERS',
      assignedCustomerIds: [],
      sections: fixture.frameworkPackage.sections.map((section) => ({
        sectionKey: section.sectionKey,
        runtimePath: section.runtimePath,
        required: section.required,
        notes: '',
      })),
    }
    const query = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maxTimeMS: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([boundedPackage]),
    }
    const originalFind = FrameworkPackage.find
    FrameworkPackage.find = jest.fn().mockReturnValue(query)

    try {
      const result = await resolveFrameworkOutcomeStudioHandoff({
        runtimeInstance: fixture.runtimeInstance,
        packBinding: fixture.packBinding,
        boundedDependencyPolicy: {
          policyVersion: 'ss-014.runtime-state-v2.handoff-dependencies.v1',
          maxTimeMS: 2000,
          packageLimit: 2,
          activationLimit: 501,
          versionLimit: 501,
          commandIds: [
            'HANDOFF_CONTROL_READ',
            'HANDOFF_FRAMEWORK_PACKAGE_READ',
            'HANDOFF_KNOWLEDGE_ACTIVATION_READ',
            'HANDOFF_KNOWLEDGE_VERSION_READ',
            'HANDOFF_RENDERER_CAPABILITY_READ',
          ],
        },
      })

      expect(result.handoff.status).toBe(FRAMEWORK_OUTCOME_HANDOFF_STATUSES.BLOCKED)
      expect(query.select).toHaveBeenCalledWith(expect.stringContaining('sections.sectionKey'))
      expect(query.sort).toHaveBeenCalledWith({ _id: 1 })
      expect(query.limit).toHaveBeenCalledWith(2)
      expect(query.maxTimeMS).toHaveBeenCalledWith(2000)
      expect(result.boundedDependencyReceipt).toEqual(expect.objectContaining({
        policyVersion: 'ss-014.runtime-state-v2.handoff-dependencies.v1',
        providerAccessed: false,
        networkAccessed: false,
        fullRuntimeFetched: false,
        dependencies: expect.arrayContaining([
          expect.objectContaining({
            dependencyKey: 'framework_package',
            commandKey: 'HANDOFF_FRAMEWORK_PACKAGE_READ',
            limit: 2,
            overflowed: false,
          }),
        ]),
      }))
    } finally {
      FrameworkPackage.find = originalFind
    }
  })

  test('bounded handoff rejects reader overrides and remains blocked', async () => {
    const fixture = makeFixture()
    const resolvePack = jest.fn()
    const result = await resolveFrameworkOutcomeStudioHandoff({
      runtimeInstance: fixture.runtimeInstance,
      frameworkPackage: fixture.frameworkPackage,
      packBinding: fixture.packBinding,
      boundedDependencyPolicy: {
        policyVersion: 'ss-014.runtime-state-v2.handoff-dependencies.v1',
        maxTimeMS: 2000,
        packageLimit: 2,
        activationLimit: 501,
        versionLimit: 501,
        commandIds: [
          'HANDOFF_CONTROL_READ',
          'HANDOFF_FRAMEWORK_PACKAGE_READ',
          'HANDOFF_KNOWLEDGE_ACTIVATION_READ',
          'HANDOFF_KNOWLEDGE_VERSION_READ',
          'HANDOFF_RENDERER_CAPABILITY_READ',
        ],
      },
      resolvePack,
    })

    expect(result.handoff.status).toBe(FRAMEWORK_OUTCOME_HANDOFF_STATUSES.BLOCKED)
    expect(result.handoff.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.HANDOFF_RESOLUTION_FAILED,
      }),
    ]))
    expect(resolvePack).not.toHaveBeenCalled()
  })

  test('bounded handoff replaces dependency error details with a customer-safe diagnostic', async () => {
    const fixture = makeFixture()
    const query = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockRejectedValue(new Error('Mongo collection runtime_evidence_objects failed: provider timeout')),
    }
    const originalFind = FrameworkPackage.find
    FrameworkPackage.find = jest.fn().mockReturnValue(query)

    try {
      const result = await resolveFrameworkOutcomeStudioHandoff({
        runtimeInstance: fixture.runtimeInstance,
        packBinding: fixture.packBinding,
        boundedDependencyPolicy: {
          policyVersion: 'ss-014.runtime-state-v2.handoff-dependencies.v1',
          maxTimeMS: 2000,
          packageLimit: 2,
          activationLimit: 501,
          versionLimit: 501,
          commandIds: [
            'HANDOFF_CONTROL_READ',
            'HANDOFF_FRAMEWORK_PACKAGE_READ',
            'HANDOFF_KNOWLEDGE_ACTIVATION_READ',
            'HANDOFF_KNOWLEDGE_VERSION_READ',
            'HANDOFF_RENDERER_CAPABILITY_READ',
          ],
        },
      })

      expect(result.handoff.contradictions[0]).toEqual(expect.objectContaining({
        message: 'Bounded handoff dependency resolution failed.',
      }))
      expect(JSON.stringify(result.handoff)).not.toMatch(/runtime_evidence_objects|provider timeout/i)
    } finally {
      FrameworkPackage.find = originalFind
    }
  })
})
