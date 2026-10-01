import { describe, expect, jest, test } from '@jest/globals'
import {
  evaluateDiscoveryContractRuntime,
  resolveLockedRuntimeDiscoveryContractRevision,
  resolveRuntimeDiscoveryContractReadiness,
} from '../services/discoveryContractRuntimeService.js'
import {
  applyDiscoveryEvidenceReview,
  buildDiscoveryEvidenceObjectsFromSources,
  normalizeDiscoveryEvidenceObjects,
} from '../services/discoveryIntelligenceService.js'

import {
  ARL_READINESS,
  CANONICAL_REVISION_READINESS,
  buildArlReadinessSummary,
  buildEvidenceSnapshotFingerprint,
  buildCanonicalRevisionReadiness,
  dispositionPostLockDiscovery,
  hashDiscoveryContractValue,
  projectLatestReadinessSummary,
  POST_LOCK_DISCOVERY_DISPOSITIONS,
  projectDraftOutcomeStudioConsumption,
  resolveDiscoveryPolicy,
  resolveExactCanonicalRevision,
  resolveOutcomeStudioCanonicalBinding,
  VMF_DISCOVERY_OWNER_MAP,
  VMF_DISCOVERY_STATE_RESULT_REQUIREMENTS,
} from '../services/discoveryContractReadinessService.js'

const hash = (character) => 'sha256:' + character.repeat(64)

const makePolicy = () => ({
  key: 'synthetic.customer-context',
  version: '1.0.0',
  identity: {
    frameworkKey: 'SYNTHETIC_VMF',
    packageKey: 'customer-context-test',
    packageVersion: '1.0.0',
  },
  rules: {
    requiredSections: ['customer_context'],
    materialClaimRequiresAdmittedEvidence: true,
    materialClaimRequiresSourceLocation: true,
  },
})

const makeEvidenceRecord = (overrides = {}) => ({
  evidenceObjectId: 'evidence-test-001',
  sourceId: 'source-test-001',
  evidenceState: 'ADMITTED',
  governingOwner: 'VE',
  governingResultType: 'EVIDENCE_ADMISSION',
  sourceLocation: { fieldPath: 'source.customer.name' },
  lineageRef: 'lineage-test-001',
  auditRef: 'audit-evidence-test-001',
  ...overrides,
})

const makeEvidenceSnapshot = (evidenceObjects = [makeEvidenceRecord()]) => ({
  snapshot_id: 'evidence-snapshot-test-001',
  fingerprint: buildEvidenceSnapshotFingerprint(evidenceObjects),
  evidence_objects: evidenceObjects,
})

const makeInput = (overrides = {}) => ({
  revision_id: 'revision-test-001',
  runtime_instance_id: 'runtime-test-001',
  predecessor_revision_id: '',
  framework_id: 'synthetic-framework-001',
  vmf_methodology_version: 'test-methodology-1.0',
  vmf_runtime_composition_refs: ['registry:test-1', 'toolkit:test-1'],
  source_state_version: 'source-state-test-001',
  storylineos_package: {
    package_id: 'synthetic-package-001',
    package_key: 'customer-context-test',
    package_version: '1.0.0',
    dependency_lock_id: 'dependency-lock-test-001',
    dependency_snapshot_id: 'dependency-snapshot-test-001',
    dependency_snapshot_hash: hash('a'),
    runtime_compatibility_version: 'runtime-compatibility-test-1',
  },
  discoveryPolicy: {
    status: 'RESOLVED',
    policyKey: 'synthetic.customer-context',
    policyVersion: '1.0.0',
    policyHash: resolveTestPolicy().policyHash,
    identity: resolveTestPolicy().identity,
  },
  evidenceSnapshot: makeEvidenceSnapshot(),
  graphSnapshot: {
    snapshot_id: 'graph-snapshot-test-001',
    version: '2.2',
    hash: hash('d'),
    audit_ref: 'audit-graph-test-001',
    currentness: 'CURRENT',
    validation: 'VALID',
  },
  sections: [
    {
      sectionKey: 'customer_context',
      required: true,
      sufficient: true,
      evidenceObjectIds: ['evidence-test-001'],
      reasoningArtifactRefs: ['reasoning-test-001'],
      validationResultRefs: ['validation-test-001'],
    },
  ],
  materialClaims: [
    {
      claimId: 'claim-test-001',
      material: true,
      evidenceObjectIds: ['evidence-test-001'],
    },
  ],
  acceptedObjects: [
    {
      objectId: 'accepted-section-test-001',
      objectType: 'SECTION_TRUTH_RESULT',
      governingOwner: 'DX',
      governingResultType: 'SECTION_TRUTH',
      evidenceObjectIds: ['evidence-test-001'],
    },
  ],
  contradictions: [],
  restrictions: [],
  validation_result_refs: ['validation-test-001'],
  authorization_dependency_refs: ['authorization-test-001'],
  audit_refs: ['audit-evidence-test-001', 'audit-graph-test-001'],
  lineage_refs: ['lineage-test-001'],
  currentness_state: 'CURRENT',
  lock: {
    state: 'LOCKED',
    locked: true,
    canonicalOutputEligible: true,
    snapshot_id: 'lock-snapshot-test-001',
    snapshot_hash: hash('e'),
    replay_anchor_id: 'replay-anchor-test-001',
    replay_anchor_hash: hash('f'),
  },
  evaluated_at: '2026-09-23T12:00:00.000Z',
  ...overrides,
})

const resolveTestPolicy = (runtimeInstance = {}) =>
  resolveDiscoveryPolicy({
    frameworkKey: 'SYNTHETIC_VMF',
    packageKey: 'customer-context-test',
    packageVersion: '1.0.0',
    runtimeInstance,
    policyResolver: () => makePolicy(),
  })

describe('discovery contract readiness', () => {
  test('resolves a versioned policy against the exact framework and package identity', () => {
    const resolved = resolveTestPolicy()

    expect(resolved).toEqual(
      expect.objectContaining({
        status: 'RESOLVED',
        policyKey: 'synthetic.customer-context',
        policyVersion: '1.0.0',
        policyHash: resolveTestPolicy().policyHash,
      }),
    )
  })

  test('fails closed when policy identity is missing, unavailable, or mismatched', () => {
    expect(resolveDiscoveryPolicy({ runtimeInstance: {} })).toEqual(
      expect.objectContaining({
        status: 'UNRESOLVED',
        blockers: ['DISCOVERY_POLICY_IDENTITY_MISSING'],
      }),
    )
    expect(
      resolveDiscoveryPolicy({
        frameworkKey: 'SYNTHETIC_VMF',
        packageKey: 'customer-context-test',
        packageVersion: '1.0.0',
        runtimeInstance: {},
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'UNRESOLVED',
        blockers: ['DISCOVERY_POLICY_NOT_RESOLVED'],
      }),
    )

    const mismatch = resolveDiscoveryPolicy({
      frameworkKey: 'SYNTHETIC_VMF',
      packageKey: 'customer-context-test',
      packageVersion: '1.0.0',
      runtimeInstance: {},
      policyResolver: () => ({
        ...makePolicy(),
        identity: { ...makePolicy().identity, packageVersion: '9.9.9' },
      }),
    })
    expect(mismatch).toEqual(
      expect.objectContaining({
        status: 'INVALID',
        blockers: ['DISCOVERY_POLICY_IDENTITY_MISMATCH'],
      }),
    )
    expect(
      resolveDiscoveryPolicy({
        frameworkKey: 'SYNTHETIC_VMF',
        packageKey: 'customer-context-test',
        packageVersion: '1.0.0',
        policyResolver: () => ({ key: 'unbound-policy', version: '1.0.0' }),
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'UNRESOLVED',
        blockers: ['DISCOVERY_POLICY_IDENTITY_INCOMPLETE'],
      }),
    )
    expect(
      resolveDiscoveryPolicy({
        frameworkKey: 'SYNTHETIC_VMF',
        packageKey: 'customer-context-test',
        packageVersion: '1.0.0',
        policyResolver: () => {
          throw new Error('resolver unavailable')
        },
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'UNRESOLVED',
        blockers: ['DISCOVERY_POLICY_RESOLUTION_FAILED'],
      }),
    )

    const unboundCanonicalPolicy = buildCanonicalRevisionReadiness(
      makeInput({
        discoveryPolicy: { ...makeInput().discoveryPolicy, identity: {} },
      }),
    )
    expect(unboundCanonicalPolicy.readiness.unresolved).toContain(
      'DISCOVERY_POLICY_IDENTITY_INCOMPLETE',
    )
    const mismatchedCanonicalPolicy = buildCanonicalRevisionReadiness(
      makeInput({
        discoveryPolicy: {
          ...makeInput().discoveryPolicy,
          identity: { ...makeInput().discoveryPolicy.identity, packageVersion: '9.9.9' },
        },
      }),
    )
    expect(mismatchedCanonicalPolicy.readiness.unresolved).toContain(
      'DISCOVERY_POLICY_IDENTITY_MISMATCH',
    )
  })

  test('retains distinct evidence and policy references in a deterministic ready revision', () => {
    const first = buildCanonicalRevisionReadiness(makeInput())
    const second = buildCanonicalRevisionReadiness(makeInput())

    expect(first.readiness.state).toBe('READY')
    expect(first.contract_version).toBe('discovery-readiness.v1')
    expect(first.discovery_policy).toEqual({
      key: 'synthetic.customer-context',
      version: '1.0.0',
      hash: resolveTestPolicy().policyHash,
      identity: resolveTestPolicy().identity,
    })
    expect(first.vmf_identity).toEqual({
      framework_key: 'SYNTHETIC_VMF',
      methodology_version: 'test-methodology-1.0',
      runtime_composition_refs: ['registry:test-1', 'toolkit:test-1'],
    })
    expect(first.storylineos_package).toEqual(
      expect.objectContaining({
        package_id: 'synthetic-package-001',
        package_key: 'customer-context-test',
        package_version: '1.0.0',
        dependency_lock_id: 'dependency-lock-test-001',
        dependency_snapshot_id: 'dependency-snapshot-test-001',
      }),
    )
    expect(first.evidence_snapshot.evidence_object_refs).toEqual(['evidence-test-001'])
    expect(first.evidence_snapshot.evidence_states[0]).toEqual(
      expect.objectContaining({
        state: 'ADMITTED',
        source_id: 'source-test-001',
        source_location: { fieldPath: 'source.customer.name' },
        lineage_ref: 'lineage-test-001',
      }),
    )
    expect(first.graph_snapshot).toEqual(
      expect.objectContaining({
        snapshot_id: 'graph-snapshot-test-001',
        version: '2.2',
        hash: hash('d'),
      }),
    )
    expect(first.sections[0]).toEqual(
      expect.objectContaining({
        sectionKey: 'customer_context',
        evidenceObjectIds: ['evidence-test-001'],
        reasoningArtifactRefs: ['reasoning-test-001'],
        validationResultRefs: ['validation-test-001'],
      }),
    )
    expect(first.lock).toEqual(
      expect.objectContaining({
        snapshot_id: 'lock-snapshot-test-001',
        snapshot_hash: hash('e'),
        replay_anchor_id: 'replay-anchor-test-001',
        replay_anchor_hash: hash('f'),
      }),
    )
    expect(first.lineage_refs).toEqual(['lineage-test-001'])
    expect(first.authorization_dependency_refs).toEqual(['authorization-test-001'])
    expect(first.reference_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.accepted_object_refs[0]).toEqual(
      expect.objectContaining({ object_type: 'SECTION_TRUTH_RESULT', governing_owner: 'DX' }),
    )
    expect(first.content_hash).toBe(second.content_hash)
  })

  test('requires an admitted source-located object for every material claim', () => {
    const candidate = buildCanonicalRevisionReadiness(
      makeInput({
        evidenceSnapshot: makeEvidenceSnapshot([
          makeEvidenceRecord({ evidenceState: 'CANDIDATE' }),
        ]),
      }),
    )
    expect(candidate.readiness.state).toBe('NOT_READY')
    expect(candidate.readiness.blockers).toContain('MATERIAL_CLAIMS_UNSUPPORTED')

    const rejected = buildCanonicalRevisionReadiness(
      makeInput({
        evidenceSnapshot: makeEvidenceSnapshot([makeEvidenceRecord({ evidenceState: 'REJECTED' })]),
      }),
    )
    expect(rejected.readiness.blockers).toContain('REJECTED_EVIDENCE_SUPPORTS_CLAIM')

    const noLocation = buildCanonicalRevisionReadiness(
      makeInput({
        evidenceSnapshot: makeEvidenceSnapshot([makeEvidenceRecord({ sourceLocation: null })]),
      }),
    )
    expect(noLocation.readiness.blockers).toContain('MATERIAL_CLAIMS_UNSUPPORTED')
  })

  test('fails closed when evidence, graph-build, or aggregate audit references are missing', () => {
    const missingAudit = buildCanonicalRevisionReadiness(
      makeInput({
        audit_refs: [],
        graphSnapshot: { ...makeInput().graphSnapshot, audit_ref: '' },
        evidenceSnapshot: makeEvidenceSnapshot([makeEvidenceRecord({ auditRef: '' })]),
      }),
    )

    expect(missingAudit.readiness.state).toBe(CANONICAL_REVISION_READINESS.UNRESOLVED)
    expect(missingAudit.readiness.unresolved).toEqual(
      expect.arrayContaining([
        'AUDIT_REFERENCES_MISSING',
        'GRAPH_AUDIT_REFERENCE_MISSING',
        'EVIDENCE_AUDIT_REFERENCE_MISSING',
      ]),
    )
  })

  test('fails canonical readiness closed on stale graph and surfaces it as blocked for ARL', () => {
    const canonical = buildCanonicalRevisionReadiness(
      makeInput({
        graphSnapshot: { ...makeInput().graphSnapshot, currentness: 'STALE' },
      }),
    )
    expect(canonical.readiness.state).toBe('NOT_READY')
    expect(canonical.readiness.blockers).toContain('GRAPH_STALE_OR_INVALID')

    const arl = buildArlReadinessSummary({
      canonicalReadiness: canonical,
      graphSnapshot: { currentness: 'STALE', validation: 'VALID' },
      identityResolved: true,
    })
    expect(arl.state).toBe(ARL_READINESS.BLOCKED)
  })

  test('requires explicit currentness and blocks stale canonical revisions', () => {
    const missing = buildCanonicalRevisionReadiness(makeInput({ currentness_state: '' }))
    expect(missing.readiness.state).toBe('UNRESOLVED')
    expect(missing.readiness.unresolved).toContain('CURRENTNESS_STATE_MISSING')

    const stale = buildCanonicalRevisionReadiness(makeInput({ currentness_state: 'STALE' }))
    expect(stale.readiness.state).toBe('NOT_READY')
    expect(stale.readiness.blockers).toContain('REVISION_CURRENTNESS_NOT_CURRENT')
  })

  test('blocks material contradictions and classifies bounded non-material contradictions as conditional', () => {
    const contradiction = {
      contradictionId: 'conflict-001',
      material: true,
      status: 'OPEN',
      governingOwner: 'CR',
      governingResultType: 'CONTRADICTION_REVIEW',
    }
    const canonical = buildCanonicalRevisionReadiness(
      makeInput({
        contradictions: [contradiction],
      }),
    )
    expect(canonical.readiness.state).toBe('NOT_READY')
    expect(canonical.readiness.blockers).toContain('MATERIAL_CONTRADICTION_UNRESOLVED')

    const rework = buildArlReadinessSummary({
      canonicalReadiness: canonical,
      graphSnapshot: makeInput().graphSnapshot,
      identityResolved: true,
      contradictions: [contradiction],
    })
    expect(rework.state).toBe(ARL_READINESS.REWORK)

    const bounded = buildArlReadinessSummary({
      canonicalReadiness: buildCanonicalRevisionReadiness(makeInput()),
      graphSnapshot: makeInput().graphSnapshot,
      identityResolved: true,
      boundedGaps: [
        {
          code: 'NON_MATERIAL_DETAIL_PENDING',
          description: 'Confirm one non-material detail.',
          owner: 'VE',
          action: 'Record the confirmation in the evidence review.',
        },
      ],
      contradictions: [
        {
          contradictionId: 'conflict-002',
          material: false,
          status: 'OPEN',
          governingOwner: 'CR',
          governingResultType: 'CONTRADICTION_REVIEW',
          ownerAction: 'Review at the next ARL pass.',
        },
      ],
    })
    expect(bounded.state).toBe(ARL_READINESS.CONDITIONAL)
    expect(bounded.downstream_use).toBe('ARL_REVIEW_ONLY')
    expect(bounded.canonical_revision_content_hash).toBe(
      buildCanonicalRevisionReadiness(makeInput()).content_hash,
    )

    const unassignedCondition = buildArlReadinessSummary({
      canonicalReadiness: buildCanonicalRevisionReadiness(makeInput()),
      graphSnapshot: makeInput().graphSnapshot,
      identityResolved: true,
      boundedGaps: ['owner and action required'],
    })
    expect(unassignedCondition.state).toBe(ARL_READINESS.REWORK)
  })

  test('keeps readiness separate from lock and makes an unlocked complete revision ARL-reviewable', () => {
    const canonical = buildCanonicalRevisionReadiness(
      makeInput({
        lock: {
          ...makeInput().lock,
          state: 'UNLOCKED',
          locked: false,
          canonicalOutputEligible: false,
        },
      }),
    )
    const arl = buildArlReadinessSummary({
      canonicalReadiness: canonical,
      graphSnapshot: makeInput().graphSnapshot,
      identityResolved: true,
    })
    expect(canonical.readiness.state).toBe('READY')
    expect(arl.state).toBe(ARL_READINESS.READY)
    expect(arl.downstream_use).toBe('ARL_REVIEW_ONLY')
  })

  test('binds canonical use to the exact locked revision and keeps latest summary non-authoritative', () => {
    const canonical = buildCanonicalRevisionReadiness(makeInput())
    const exact = resolveExactCanonicalRevision({
      requestedRuntimeInstanceId: 'runtime-test-001',
      requestedRevisionId: 'revision-test-001',
      canonicalReadiness: canonical,
      requestedContentHash: canonical.content_hash,
    })
    const mismatch = resolveExactCanonicalRevision({
      requestedRuntimeInstanceId: 'runtime-test-001',
      requestedRevisionId: 'revision-test-002',
      canonicalReadiness: canonical,
    })
    const latest = projectLatestReadinessSummary(canonical, { state: ARL_READINESS.READY })

    expect(exact).toEqual(
      expect.objectContaining({
        status: 'READY',
        revision_id: 'revision-test-001',
        content_hash: canonical.content_hash,
        reference_fingerprint: canonical.reference_fingerprint,
        canonical_output_eligible: true,
      }),
    )
    expect(mismatch).toEqual(
      expect.objectContaining({
        status: 'BLOCKED',
        reason: 'REVISION_ID_MISMATCH',
        canonical_output_eligible: false,
      }),
    )
    expect(
      resolveExactCanonicalRevision({
        requestedRuntimeInstanceId: 'runtime-other-001',
        requestedRevisionId: canonical.revision_id,
        canonicalReadiness: canonical,
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'BLOCKED',
        reason: 'RUNTIME_INSTANCE_MISMATCH',
        canonical_output_eligible: false,
      }),
    )
    expect(
      resolveExactCanonicalRevision({
        requestedRuntimeInstanceId: 'runtime-test-001',
        requestedRevisionId: 'revision-test-001',
        canonicalReadiness: { ...canonical, content_hash: hash('0') },
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'BLOCKED',
        reason: 'REVISION_CONTENT_INTEGRITY_MISMATCH',
      }),
    )
    const changedReferences = { ...canonical, sections: [] }
    const { content_hash: _oldContentHash, ...changedPayload } = changedReferences
    changedReferences.content_hash = hashDiscoveryContractValue(changedPayload)
    expect(
      resolveExactCanonicalRevision({
        requestedRuntimeInstanceId: 'runtime-test-001',
        requestedRevisionId: 'revision-test-001',
        canonicalReadiness: changedReferences,
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'BLOCKED',
        reason: 'REVISION_REFERENCE_INTEGRITY_MISMATCH',
      }),
    )
    for (const lockField of [
      'snapshot_id',
      'snapshot_hash',
      'replay_anchor_id',
      'replay_anchor_hash',
    ]) {
      const alteredLock = {
        ...canonical,
        lock: { ...canonical.lock, [lockField]: `${canonical.lock[lockField]}-altered` },
      }
      expect(
        resolveExactCanonicalRevision({
          requestedRuntimeInstanceId: 'runtime-test-001',
          requestedRevisionId: 'revision-test-001',
          canonicalReadiness: alteredLock,
        }),
      ).toEqual(
        expect.objectContaining({
          status: 'BLOCKED',
          reason: 'REVISION_CONTENT_INTEGRITY_MISMATCH',
          canonical_output_eligible: false,
        }),
      )
    }
    expect(latest).toEqual(
      expect.objectContaining({
        mode: 'LATEST_SUMMARY',
        authoritative: false,
        source_revision_id: 'revision-test-001',
        canonical_output_eligible: false,
      }),
    )
  })

  test('Outcome Studio resolves only the exact canonical revision and labels draft use non-canonical', async () => {
    const canonical = buildCanonicalRevisionReadiness(makeInput())
    const arlReadinessSummary = buildArlReadinessSummary({
      canonicalReadiness: canonical,
      graphSnapshot: canonical.graph_snapshot,
      identityResolved: true,
    })
    const resolver = jest.fn(async ({ runtimeInstanceId, revisionId }) =>
      runtimeInstanceId === canonical.runtime_instance_id && revisionId === canonical.revision_id
        ? { runtimeInstanceId, canonicalReadiness: canonical, arlReadinessSummary }
        : null,
    )
    const binding = await resolveOutcomeStudioCanonicalBinding({
      requestedRuntimeInstanceId: canonical.runtime_instance_id,
      requestedRevisionId: 'revision-test-001',
      revisionResolver: resolver,
    })
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledWith({
      runtimeInstanceId: canonical.runtime_instance_id,
      revisionId: 'revision-test-001',
    })
    expect(binding).toEqual(
      expect.objectContaining({
        consumer: 'OUTCOME_STUDIO',
        status: 'READY',
        revision_id: 'revision-test-001',
        canonical_output_eligible: true,
        canonical_readiness: canonical,
        arl_readiness_summary: arlReadinessSummary,
      }),
    )
    const mismatch = await resolveOutcomeStudioCanonicalBinding({
      requestedRuntimeInstanceId: canonical.runtime_instance_id,
      requestedRevisionId: 'revision-test-002',
      revisionResolver: resolver,
    })
    expect(mismatch.reason).toBe('EXACT_REVISION_LOOKUP_MISMATCH')
    const crossRuntimeBinding = await resolveOutcomeStudioCanonicalBinding({
      requestedRuntimeInstanceId: 'runtime-other-001',
      requestedRevisionId: canonical.revision_id,
      revisionResolver: async () => ({
        runtimeInstanceId: canonical.runtime_instance_id,
        canonicalReadiness: canonical,
        arlReadinessSummary,
      }),
    })
    expect(crossRuntimeBinding).toEqual(
      expect.objectContaining({
        status: 'BLOCKED',
        reason: 'RUNTIME_INSTANCE_LOOKUP_MISMATCH',
        canonical_output_eligible: false,
      }),
    )

    const conditionalArlSummary = buildArlReadinessSummary({
      canonicalReadiness: canonical,
      graphSnapshot: canonical.graph_snapshot,
      identityResolved: true,
      boundedGaps: [
        {
          code: 'BOUNDED_GAP',
          description: 'Confirm a non-material detail.',
          owner: 'VE',
          action: 'Review at ARL.',
        },
      ],
    })
    const conditionalBinding = await resolveOutcomeStudioCanonicalBinding({
      requestedRuntimeInstanceId: canonical.runtime_instance_id,
      requestedRevisionId: canonical.revision_id,
      revisionResolver: async ({ runtimeInstanceId }) => ({
        runtimeInstanceId,
        canonicalReadiness: canonical,
        arlReadinessSummary: conditionalArlSummary,
      }),
    })
    expect(conditionalBinding).toEqual(
      expect.objectContaining({
        status: 'BLOCKED',
        reason: 'ARL_READINESS_NOT_READY_FOR_CANONICAL_USE',
        arl_readiness_state: ARL_READINESS.CONDITIONAL,
        canonical_output_eligible: false,
      }),
    )
    const mismatchedArlBinding = await resolveOutcomeStudioCanonicalBinding({
      requestedRuntimeInstanceId: canonical.runtime_instance_id,
      requestedRevisionId: canonical.revision_id,
      revisionResolver: async ({ runtimeInstanceId }) => ({
        runtimeInstanceId,
        canonicalReadiness: canonical,
        arlReadinessSummary: { ...arlReadinessSummary, canonical_revision_content_hash: hash('0') },
      }),
    })
    expect(mismatchedArlBinding.reason).toBe('EXACT_REVISION_READINESS_BINDING_MISMATCH')
    for (const malformedSummary of [
      { ...arlReadinessSummary, contract_version: 'discovery-readiness.v0' },
      { ...arlReadinessSummary, downstream_use: 'NONE' },
    ]) {
      const malformedArlBinding = await resolveOutcomeStudioCanonicalBinding({
        requestedRuntimeInstanceId: canonical.runtime_instance_id,
        requestedRevisionId: canonical.revision_id,
        revisionResolver: async ({ runtimeInstanceId }) => ({
          runtimeInstanceId,
          canonicalReadiness: canonical,
          arlReadinessSummary: malformedSummary,
        }),
      })
      expect(malformedArlBinding.reason).toBe('EXACT_REVISION_READINESS_BINDING_MISMATCH')
    }
    expect(
      projectDraftOutcomeStudioConsumption({
        draftId: 'draft-001',
        sourceRevisionId: 'revision-test-001',
      }),
    ).toEqual({
      mode: 'DRAFT',
      draft_id: 'draft-001',
      source_revision_id: 'revision-test-001',
      canonical: false,
      authoritative: false,
      canonical_output_eligible: false,
    })
  })

  test('API canonical consumption resolves the exact runtime and revision pair', async () => {
    const { getRuntimeOutcomeStudioCanonicalRevisionConsumption } =
      await import('../controllers/runtimeInstance.controller.js')
    const { default: runtimeInstanceRoutes } = await import('../routes/runtimeInstances.routes.js')
    const exactConsumptionRoute = runtimeInstanceRoutes.stack.find(
      (layer) =>
        layer.route?.path ===
        '/:runtimeInstanceId/outcome-studio/canonical-revisions/:revisionId/consumption',
    )
    expect(exactConsumptionRoute?.route?.methods?.get).toBe(true)

    const canonical = buildCanonicalRevisionReadiness(makeInput())
    const arlReadinessSummary = buildArlReadinessSummary({
      canonicalReadiness: canonical,
      graphSnapshot: canonical.graph_snapshot,
      identityResolved: true,
    })
    const resolver = jest.fn(async ({ runtimeInstanceId, revisionId }) =>
      runtimeInstanceId === canonical.runtime_instance_id && revisionId === canonical.revision_id
        ? { runtimeInstanceId, canonicalReadiness: canonical, arlReadinessSummary }
        : null,
    )
    const req = {
      app: { locals: { discoveryContractRevisionResolver: resolver } },
      params: {
        runtimeInstanceId: canonical.runtime_instance_id,
        revisionId: canonical.revision_id,
      },
      requestId: 'request-test-001',
      scopes: { tenantId: 'synthetic-tenant-001' },
    }
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code
        return this
      },
      json(body) {
        this.body = body
        return this
      },
    }
    const next = jest.fn()

    await getRuntimeOutcomeStudioCanonicalRevisionConsumption(req, res, next)

    expect(res.statusCode).toBe(200)
    expect(res.body.data).toEqual(
      expect.objectContaining({
        consumer: 'OUTCOME_STUDIO',
        status: 'READY',
        revision_id: canonical.revision_id,
        canonical_readiness: canonical,
        arl_readiness_summary: arlReadinessSummary,
      }),
    )
    expect(resolver).toHaveBeenCalledWith({
      runtimeInstanceId: canonical.runtime_instance_id,
      revisionId: canonical.revision_id,
      scopes: req.scopes,
    })
    expect(next).not.toHaveBeenCalled()

    const blockedResponse = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code
        return this
      },
      json(body) {
        this.body = body
        return this
      },
    }
    await getRuntimeOutcomeStudioCanonicalRevisionConsumption(
      {
        ...req,
        app: { locals: {} },
      },
      blockedResponse,
      next,
    )
    expect(blockedResponse.statusCode).toBe(409)
    expect(blockedResponse.body.error.details.reason).toBe('EXACT_REVISION_RESOLVER_REQUIRED')
  })

  test('API readiness exposes the latest draft summary through a scoped read-only resolver', async () => {
    const { getRuntimeDiscoveryContractReadiness } =
      await import('../controllers/runtimeInstance.controller.js')
    const { default: runtimeInstanceRoutes } = await import('../routes/runtimeInstances.routes.js')
    const readinessRoute = runtimeInstanceRoutes.stack.find(
      (layer) => layer.route?.path === '/:runtimeInstanceId/discovery-contract/readiness',
    )
    expect(readinessRoute?.route?.methods?.get).toBe(true)

    const proof = {
      canonical_revision_readiness: buildCanonicalRevisionReadiness(makeInput()),
      arl_readiness_summary: buildArlReadinessSummary({
        canonicalReadiness: buildCanonicalRevisionReadiness(makeInput()),
        graphSnapshot: makeInput().graphSnapshot,
        identityResolved: true,
      }),
      latest_summary: projectLatestReadinessSummary(
        buildCanonicalRevisionReadiness(makeInput()),
        buildArlReadinessSummary({
          canonicalReadiness: buildCanonicalRevisionReadiness(makeInput()),
          graphSnapshot: makeInput().graphSnapshot,
          identityResolved: true,
        }),
      ),
    }
    const resolver = jest.fn(async ({ runtimeInstanceId }) => ({
      runtimeInstanceId,
      proof,
    }))
    const req = {
      app: { locals: { discoveryContractReadinessResolver: resolver } },
      params: { runtimeInstanceId: proof.canonical_revision_readiness.runtime_instance_id },
      requestId: 'request-readiness-test-001',
      scopes: { tenantId: 'synthetic-tenant-001' },
    }
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code
        return this
      },
      json(body) {
        this.body = body
        return this
      },
    }
    const next = jest.fn()

    await getRuntimeDiscoveryContractReadiness(req, res, next)

    expect(res.statusCode).toBe(200)
    expect(res.body.data).toBe(proof)
    expect(res.body.data.latest_summary).toEqual(
      expect.objectContaining({ mode: 'LATEST_SUMMARY', authoritative: false }),
    )
    expect(resolver).toHaveBeenCalledWith({
      runtimeInstanceId: req.params.runtimeInstanceId,
      scopes: req.scopes,
    })
    expect(next).not.toHaveBeenCalled()
  })

  test.each([
    ['NONE', POST_LOCK_DISCOVERY_DISPOSITIONS.NO_REVISION_IMPACT],
    ['CORROBORATIVE', POST_LOCK_DISCOVERY_DISPOSITIONS.CORROBORATIVE],
    ['MATERIAL_TRUTH_CHANGE', POST_LOCK_DISCOVERY_DISPOSITIONS.SUCCESSOR_REVISION_REQUIRED],
    ['CURRENTNESS_UNCERTAIN', POST_LOCK_DISCOVERY_DISPOSITIONS.CURRENTNESS_REVIEW_REQUIRED],
  ])(
    'dispositions post-lock %s without mutating the lock or creating a successor',
    (impact, disposition) => {
      const lock = {
        state: 'LOCKED',
        locked: true,
        snapshot_id: 'lock-snapshot-test-001',
        snapshot_hash: hash('e'),
      }
      const lockBeforeDisposition = structuredClone(lock)
      const result = dispositionPostLockDiscovery({
        lockedRevisionId: 'revision-test-locked-001',
        lock,
        evidenceObjectId: 'post-lock-evidence-001',
        eventRef: 'discovery-event-001',
        auditRef: 'audit-event-001',
        impact,
      })
      expect(result).toEqual(
        expect.objectContaining({
          status: 'DISPOSITIONED',
          disposition,
          locked_body_mutated: false,
          successor_created: false,
          successor_creation: 'NOT_AUTOMATIC',
        }),
      )
      expect(lock).toEqual(lockBeforeDisposition)
    },
  )

  test('requires typed owner/result identity for accepted objects and propagates active restrictions', () => {
    const malformedAccepted = buildCanonicalRevisionReadiness(
      makeInput({
        acceptedObjects: [{ objectId: 'accepted-001', objectType: 'SECTION_TRUTH_RESULT' }],
      }),
    )
    expect(malformedAccepted.readiness.blockers).toContain('ACCEPTED_OBJECT_GOVERNANCE_MISSING')

    const restricted = buildCanonicalRevisionReadiness(
      makeInput({
        restrictions: [
          {
            restrictionId: 'restriction-001',
            status: 'ACTIVE',
            governingOwner: 'EC',
            governingResultType: 'EVIDENCE_RESTRICTION',
            claimIds: ['claim-test-001'],
          },
        ],
      }),
    )
    expect(restricted.readiness.blockers).toContain('RESTRICTED_MATERIAL_CLAIM')
    expect(restricted.restriction_refs).toEqual(['restriction-001'])
  })

  test('enforces owner/state mapping and binds accepted evidence to its exact governed object', () => {
    const wrongOwner = buildCanonicalRevisionReadiness(
      makeInput({
        evidenceSnapshot: makeEvidenceSnapshot([makeEvidenceRecord({ governingOwner: 'CR' })]),
      }),
    )
    expect(wrongOwner.readiness.blockers).toContain('EVIDENCE_OWNER_STATE_MISMATCH')

    const acceptedEvidence = makeEvidenceRecord({
      evidenceState: 'ACCEPTED',
      governingOwner: 'DX',
      governingResultType: 'SECTION_TRUTH_RESULT',
      acceptedObjectType: 'SECTION_TRUTH_RESULT',
      acceptedObjectRef: 'accepted-truth-001',
    })
    const acceptedObject = {
      objectId: 'accepted-truth-001',
      objectType: 'SECTION_TRUTH_RESULT',
      governingOwner: 'DX',
      governingResultType: 'SECTION_TRUTH_RESULT',
      evidenceObjectIds: [acceptedEvidence.evidenceObjectId],
    }
    const aligned = buildCanonicalRevisionReadiness(
      makeInput({
        evidenceSnapshot: makeEvidenceSnapshot([acceptedEvidence]),
        acceptedObjects: [acceptedObject],
      }),
    )
    expect(aligned.readiness.state).toBe('READY')

    const mismatched = buildCanonicalRevisionReadiness(
      makeInput({
        evidenceSnapshot: makeEvidenceSnapshot([acceptedEvidence]),
        acceptedObjects: [{ ...acceptedObject, governingOwner: 'VE' }],
      }),
    )
    expect(mismatched.readiness.blockers).toContain('ACCEPTED_EVIDENCE_GOVERNANCE_MISMATCH')

    const rejectedSupport = buildCanonicalRevisionReadiness(
      makeInput({
        evidenceSnapshot: makeEvidenceSnapshot([makeEvidenceRecord({ evidenceState: 'REJECTED' })]),
        sections: [],
        materialClaims: [],
        acceptedObjects: [
          {
            objectId: 'accepted-from-rejected-evidence-001',
            objectType: 'ADVISORY_INTERPRETATION',
            governingOwner: 'DX',
            governingResultType: 'ADVISORY_INTERPRETATION',
            evidenceObjectIds: ['evidence-test-001'],
          },
        ],
      }),
    )
    expect(rejectedSupport.readiness.blockers).toContain('ACCEPTED_OBJECT_EVIDENCE_INVALID')
  })

  test('cannot let rejected, corrected, or restricted evidence satisfy required section coverage', () => {
    for (const evidenceState of ['REJECTED', 'CORRECTED', 'RESTRICTED']) {
      const canonical = buildCanonicalRevisionReadiness(
        makeInput({
          evidenceSnapshot: makeEvidenceSnapshot([makeEvidenceRecord({ evidenceState })]),
        }),
      )
      expect(canonical.readiness.blockers).toContain('INELIGIBLE_EVIDENCE_SUPPORTS_SECTION')
    }
  })

  test.each([
    ['CANDIDATE', 'VE', 'EVIDENCE_CANDIDATE'],
    ['CAPTURED', 'VE', 'EVIDENCE_CAPTURE'],
    ['EXTRACTED', 'VE', 'EVIDENCE_EXTRACTION'],
    ['PROPOSED', 'VE', 'EVIDENCE_PROPOSAL'],
    ['REJECTED', 'VE', 'EVIDENCE_REJECTION'],
    ['CORRECTED', 'VE', 'EVIDENCE_CORRECTION'],
    ['SUPERSEDED', 'VE', 'EVIDENCE_SUPERSESSION'],
    ['RESTRICTED', 'EC', 'EVIDENCE_RESTRICTION'],
  ])(
    'keeps %s evidence out of material claims, required sections, and accepted objects',
    (evidenceState, governingOwner, governingResultType) => {
      const isRestricted = evidenceState === 'RESTRICTED'
      const evidence = makeEvidenceRecord({
        evidenceState,
        governingOwner,
        governingResultType,
        ...(evidenceState === 'CORRECTED'
          ? {
              predecessorEvidenceRef: 'evidence-predecessor-001',
              dispositionReason: 'Superseded by a corrected extraction.',
              reviewerRef: 'reviewer-test-001',
              auditRef: 'audit-test-001',
            }
          : {}),
        ...(isRestricted
          ? {
              restrictionId: 'restriction-inadmissible-001',
              restrictionState: 'RESTRICTED',
              restrictionScope: {
                allowedUses: ['SECTION_MAPPING'],
                claimIds: ['claim-test-001'],
                sectionKeys: ['customer_context'],
              },
            }
          : {}),
      })
      const canonical = buildCanonicalRevisionReadiness(
        makeInput({
          evidenceSnapshot: makeEvidenceSnapshot([evidence]),
          ...(isRestricted
            ? {
                restrictions: [
                  {
                    restrictionId: 'restriction-inadmissible-001',
                    state: 'RESTRICTED',
                    governingOwner: 'EC',
                    governingResultType: 'EVIDENCE_RESTRICTION',
                    allowedUses: ['SECTION_MAPPING'],
                    claimIds: ['claim-test-001'],
                    sectionKeys: ['customer_context'],
                    evidenceObjectIds: [evidence.evidenceObjectId],
                  },
                ],
              }
            : {}),
        }),
      )

      expect(canonical.readiness.blockers).toContain('MATERIAL_CLAIMS_UNSUPPORTED')
      expect(canonical.readiness.blockers).toContain('INELIGIBLE_EVIDENCE_SUPPORTS_SECTION')
      expect(canonical.readiness.blockers).toContain('ACCEPTED_OBJECT_EVIDENCE_INVALID')
    },
  )

  test('retains explicitly permitted restricted evidence within its claim and section scope', () => {
    const restrictionScope = {
      allowedUses: ['CANONICAL_REVISION', 'SECTION_MAPPING'],
      claimIds: ['claim-test-001'],
      sectionKeys: ['customer_context'],
    }
    const evidence = {
      ...makeEvidenceRecord(),
      evidenceState: 'RESTRICTED',
      restrictionId: 'restriction-scoped-001',
      restrictionState: 'RESTRICTED',
      restrictionScope,
    }
    const canonical = buildCanonicalRevisionReadiness(
      makeInput({
        evidenceSnapshot: makeEvidenceSnapshot([evidence]),
        restrictions: [
          {
            restrictionId: 'restriction-scoped-001',
            state: 'RESTRICTED',
            governingOwner: 'EC',
            governingResultType: 'EVIDENCE_RESTRICTION',
            allowedUses: ['CANONICAL_REVISION', 'SECTION_MAPPING'],
            claimIds: ['claim-test-001'],
            sectionKeys: ['customer_context'],
            evidenceObjectIds: [evidence.evidenceObjectId],
          },
        ],
      }),
    )

    expect(canonical.readiness.state).toBe('READY')
    expect(canonical.restriction_refs).toEqual(['restriction-scoped-001'])
    expect(canonical.evidence_snapshot.evidence_states[0].restriction_scope).toEqual(
      restrictionScope,
    )
  })

  test('owner mapping retains existing VMF authorities without generic truth or contradiction owners', () => {
    expect(VMF_DISCOVERY_OWNER_MAP).toEqual(
      expect.objectContaining({
        CAPTURED: expect.arrayContaining(['OR', 'VE', 'STATE']),
        ADMITTED: ['VE'],
        REJECTED: expect.arrayContaining(['VE', 'STATE']),
        CORRECTED: expect.arrayContaining(['VE', 'STATE']),
        RESTRICTED: expect.arrayContaining(['EC', 'VE']),
        CONTRADICTION: ['CR'],
        TRUTH: ['DX'],
        AUTHORIZATION: ['EC'],
        ROUTE: ['ET', 'ET-RT'],
      }),
    )
    expect(Object.keys(VMF_DISCOVERY_OWNER_MAP)).not.toContain('GENERIC_TRUTH')
    expect(Object.keys(VMF_DISCOVERY_OWNER_MAP)).not.toContain('GENERIC_CONTRADICTION')
    expect(VMF_DISCOVERY_STATE_RESULT_REQUIREMENTS.ACCEPTED).toBe(
      'EXACT_GOVERNING_OWNER_RESULT_AND_OBJECT_TYPE_REQUIRED',
    )
  })

  test('keeps contradiction and restriction records under their VMF governing owners', () => {
    const wrongContradictionOwner = buildCanonicalRevisionReadiness(
      makeInput({
        contradictions: [
          {
            contradictionId: 'conflict-wrong-owner-001',
            material: false,
            status: 'OPEN',
            governingOwner: 'DX',
            governingResultType: 'CONTRADICTION_REVIEW',
          },
        ],
      }),
    )
    expect(wrongContradictionOwner.readiness.blockers).toContain('CONTRADICTION_GOVERNANCE_MISSING')

    const wrongRestrictionOwner = buildCanonicalRevisionReadiness(
      makeInput({
        restrictions: [
          {
            restrictionId: 'restriction-wrong-owner-001',
            status: 'ACTIVE',
            governingOwner: 'VE',
            governingResultType: 'EVIDENCE_RESTRICTION',
            allowedUses: ['CANONICAL_REVISION'],
          },
        ],
      }),
    )
    expect(wrongRestrictionOwner.readiness.blockers).toContain('RESTRICTION_GOVERNANCE_MISSING')
  })

  test('runs the synthetic Customer Context fixture through source, admission, graph, section, and readiness', () => {
    const createdAt = '2026-09-23T12:00:00.000Z'
    const sources = [
      {
        sourceId: 'source-company-001',
        sourceType: 'DISCOVERY_NOTES',
        label: 'Synthetic company input',
        fieldKey: 'companyName',
      },
      {
        sourceId: 'source-offer-001',
        sourceType: 'DISCOVERY_NOTES',
        label: 'Synthetic offer input',
        fieldKey: 'targetOffer',
      },
      {
        sourceId: 'source-notes-001',
        sourceType: 'DISCOVERY_NOTES',
        label: 'Synthetic notes input',
        fieldKey: 'notes',
      },
      {
        sourceId: 'source-notes-candidate-001',
        sourceType: 'DISCOVERY_NOTES',
        label: 'Synthetic unreviewed note',
        fieldKey: 'notes',
      },
    ].map((source) => ({ ...source, lineageRef: `fixture-lineage:${source.sourceId}` }))
    const inputs = {
      companyName: 'Northstar Synthetic Systems',
      targetOffer: 'A synthetic workflow platform for research teams',
      notes: 'Synthetic fixture only. The team plans a controlled discovery review.',
    }
    const extracted = buildDiscoveryEvidenceObjectsFromSources({
      acquisitionProfile: 'STANDARD',
      createdAt,
      inputs,
      sources,
    })
    expect(extracted).toHaveLength(4)

    let reviewedEvidence = normalizeDiscoveryEvidenceObjects({
      acquisitionProfile: 'STANDARD',
      createdAt,
      evidenceObjects: extracted,
      inputs,
      sources,
    })
    reviewedEvidence = reviewedEvidence.map((evidence) => {
      const reviewStatus =
        evidence.sourceId === 'source-notes-001'
          ? 'REJECTED'
          : evidence.sourceId === 'source-notes-candidate-001'
            ? 'PENDING'
            : 'ACCEPTED'
      return applyDiscoveryEvidenceReview({
        actorUserId: 'synthetic-reviewer',
        evidenceObjectId: evidence.evidenceObjectId,
        evidenceObjects: reviewedEvidence,
        reviewStatus,
        reviewedAt: createdAt,
      }).evidenceObjects.find((item) => item.evidenceObjectId === evidence.evidenceObjectId)
    })

    const contractEvidence = reviewedEvidence.map((evidence) => ({
      ...evidence,
      evidenceState:
        evidence.reviewStatus === 'REJECTED'
          ? 'REJECTED'
          : evidence.reviewStatus === 'ACCEPTED'
            ? 'ADMITTED'
            : 'CANDIDATE',
      sourceLocation: {
        uri: `fixture://ss-035/customer-context/${evidence.sourceId}`,
        fieldPath: `inputs.${sources.find((source) => source.sourceId === evidence.sourceId)?.fieldKey}`,
      },
      governingOwner: 'VE',
      governingResultType:
        evidence.reviewStatus === 'REJECTED'
          ? 'EVIDENCE_REJECTION'
          : evidence.reviewStatus === 'ACCEPTED'
            ? 'EVIDENCE_ADMISSION'
            : 'EVIDENCE_CANDIDATE',
      auditRef: `synthetic-audit:evidence:${evidence.evidenceObjectId}`,
    }))
    const frameworkPackage = {
      frameworkKey: 'SYNTHETIC_VMF',
      packageKey: 'customer-context-test',
      version: '1.0.0',
      sections: [
        {
          sectionKey: 'customer_context',
          runtimePath: 'framework_state.sections.customer_context',
          required: true,
        },
      ],
    }
    const runtimeInstance = {
      _id: 'runtime-ss035-synthetic-customer-context',
      runtimeInstanceKey: 'ss035-synthetic-customer-context',
      runtimeType: 'VALUE_NARRATIVE',
      frameworkId: 'synthetic-framework-001',
      frameworkKey: 'SYNTHETIC_VMF',
      packageKey: 'customer-context-test',
      packageVersion: '1.0.0',
      packageId: 'synthetic-package-001',
      customerId: 'synthetic-customer-001',
      tenantId: 'synthetic-tenant-001',
      stateVersion: 'synthetic-source-state-v1',
      dependencyLockId: 'synthetic-dependency-lock-001',
      evidence: {
        dependencySnapshotId: 'synthetic-dependency-snapshot-001',
        dependencySnapshotHash: hash('a'),
      },
    }
    const frameworkState = {
      sections: { customer_context: {} },
      policy: { discoveryContract: makePolicy() },
      evidence_pack: {
        accepted: true,
        acceptedAt: createdAt,
        acceptedBy: 'synthetic-reviewer',
        refreshedAt: createdAt,
      evidenceObjects: contractEvidence,
      audit_refs: ['synthetic-audit:source-registration-001'],
      sourceRegistry: sources.map((source) => ({
        ...source,
        auditRef: 'synthetic-audit:source-registration-001',
      })),
      lineage: { sources },
      },
    }
    runtimeInstance.framework_state = frameworkState
    const admittedEvidenceIds = contractEvidence
      .filter((item) => item.evidenceState === 'ADMITTED')
      .map((item) => item.evidenceObjectId)
    const evaluationInput = {
      runtimeInstance,
      frameworkPackage,
      frameworkState,
      rebuildGraph: true,
      contract: {
        revision_id: 'ss035-synthetic-revision-001',
        vmf_methodology_version: 'synthetic-methodology-1.0',
        vmf_runtime_composition_refs: ['synthetic-registry-1.0', 'synthetic-toolkit-1.0'],
        graph_audit_ref: 'synthetic-audit:graph-rebuild-001',
        storylineos_package: {
          ...makeInput().storylineos_package,
          runtime_compatibility_version: 'synthetic-runtime-compatibility-1.0',
        },
        requiredSections: ['customer_context'],
        reasoningArtifactRefsBySection: {
          customer_context: ['synthetic-reasoning:customer-context:001'],
        },
        materialClaims: [
          {
            claimId: 'claim-synthetic-company-name',
            material: true,
            evidenceObjectIds: [
              contractEvidence.find((item) => item.sourceId === 'source-company-001')
                .evidenceObjectId,
            ],
          },
        ],
        acceptedObjects: [
          {
            objectId: 'accepted-synthetic-evidence-admission-001',
            objectType: 'EVIDENCE_OBJECT',
            governingOwner: 'VE',
            governingResultType: 'EVIDENCE_ADMISSION',
            evidenceObjectIds: admittedEvidenceIds,
          },
        ],
        authorization_dependency_refs: ['synthetic-authorization-001'],
        lock: {
          state: 'LOCKED',
          locked: true,
          canonicalOutputEligible: true,
          snapshot_id: 'synthetic-lock-snapshot-001',
          snapshot_hash: hash('e'),
          replay_anchor_id: 'synthetic-replay-anchor-001',
          replay_anchor_hash: hash('f'),
        },
        currentness_state: 'CURRENT',
      },
    }
    const result = evaluateDiscoveryContractRuntime(evaluationInput)
    const replay = evaluateDiscoveryContractRuntime(evaluationInput)
    expect(result.runtime_intelligence_graph.validation).toBe('VALID')
    expect(result.runtime_intelligence_graph.hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(replay.runtime_intelligence_graph.hash).toBe(result.runtime_intelligence_graph.hash)
    expect(replay.canonical_revision_readiness.content_hash).toBe(
      result.canonical_revision_readiness.content_hash,
    )
    expect(result.runtime_intelligence_graph.rebuilt).toBe(true)
    expect(result.section_coverage[0].evidenceObjectIds).toHaveLength(2)
    expect(result.section_coverage[0].evidenceObjectIds).not.toContain(
      contractEvidence.find((item) => item.evidenceState === 'REJECTED').evidenceObjectId,
    )
    expect(result.section_coverage[0].evidenceObjectIds).not.toContain(
      contractEvidence.find((item) => item.evidenceState === 'CANDIDATE').evidenceObjectId,
    )
    expect(result.runtime_intelligence_graph.accepted_intelligence_evidence_refs).toEqual(
      expect.arrayContaining(admittedEvidenceIds),
    )
    expect(result.runtime_intelligence_graph.accepted_intelligence_evidence_refs).not.toContain(
      contractEvidence.find((item) => item.evidenceState === 'REJECTED').evidenceObjectId,
    )
    expect(result.runtime_intelligence_graph.accepted_intelligence_evidence_refs).not.toContain(
      contractEvidence.find((item) => item.evidenceState === 'CANDIDATE').evidenceObjectId,
    )
    expect(result.canonical_revision_readiness.readiness.state).toBe('READY')
    expect(result.canonical_revision_readiness.audit_refs).toContain(
      'synthetic-audit:source-registration-001',
    )
    expect(result.arl_readiness_summary.state).toBe(ARL_READINESS.READY)
    expect(result.arl_readiness_summary.downstream_use).toBe('ARL_REVIEW_ONLY')
    expect(
      result.canonical_revision_readiness.evidence_snapshot.evidence_states
        .map((item) => item.state)
        .sort(),
    ).toEqual(['ADMITTED', 'ADMITTED', 'CANDIDATE', 'REJECTED'])

    const stale = evaluateDiscoveryContractRuntime({ ...evaluationInput, rebuildGraph: false })
    expect(stale.runtime_intelligence_graph.currentness).toBe('STALE')
    expect(stale.canonical_revision_readiness.readiness.blockers).toContain(
      'GRAPH_STALE_OR_INVALID',
    )
    expect(stale.arl_readiness_summary.state).toBe(ARL_READINESS.BLOCKED)

    const invalidPersistedGraph = evaluateDiscoveryContractRuntime({
      ...evaluationInput,
      rebuildGraph: false,
      frameworkState: {
        ...frameworkState,
        intelligence_graph: {
          graphVersion: result.runtime_intelligence_graph.version,
          graphHash: result.runtime_intelligence_graph.hash,
          build: { status: 'VALID', sourceHash: result.runtime_intelligence_graph.source_hash },
          validation: { status: 'INVALID' },
        },
      },
    })
    expect(invalidPersistedGraph.runtime_intelligence_graph.currentness).toBe('STALE')
    expect(invalidPersistedGraph.canonical_revision_readiness.readiness.blockers).toContain(
      'GRAPH_STALE_OR_INVALID',
    )
    expect(invalidPersistedGraph.arl_readiness_summary.state).toBe(ARL_READINESS.BLOCKED)

    const packageIdCannotStandInForFrameworkId = evaluateDiscoveryContractRuntime({
      ...evaluationInput,
      runtimeInstance: { ...runtimeInstance, frameworkId: undefined },
    })
    expect(
      packageIdCannotStandInForFrameworkId.canonical_revision_readiness.readiness.unresolved,
    ).toContain('VMF_IDENTITY_INCOMPLETE')
  })

  test('reconstructs an exact revision from the scoped locked runtime snapshot without writes', async () => {
    const runtimeId = 'runtime-locked-test-001'
    const revisionId = 'lock-snapshot-test-001'
    const runtimeInstance = {
      id: runtimeId,
      packageId: 'synthetic-package-001',
      packageKey: 'customer-context-test',
      packageVersion: '1.0.0',
      frameworkKey: 'SYNTHETIC_VMF',
      frameworkId: 'synthetic-framework-001',
      stateVersion: 'source-state-test-001',
      currentnessState: 'CURRENT',
      updatedAt: '2026-09-23T09:00:00.000Z',
      evidence: {
        dependencySnapshotId: 'dependency-snapshot-test-001',
        dependencySnapshotHash: hash('a'),
      },
      framework_state: {
        sections: { customer_context: {} },
        evidence_pack: {
          accepted: true,
          acceptedAt: '2026-09-23T09:00:00.000Z',
          evidenceObjects: [],
        },
        policy: {
          discoveryContract: makePolicy(),
          discoveryContractReadiness: {
            vmf_methodology_version: 'test-methodology-1.0',
            vmf_runtime_composition_refs: ['registry:test-1', 'toolkit:test-1'],
            storylineos_package: makeInput().storylineos_package,
            requiredSections: ['customer_context'],
            currentness_state: 'CURRENT',
          },
        },
        lock: {
          state: 'LOCKED',
          locked: true,
          outputEligibility: { canonicalOutputEligible: true },
          snapshot: { snapshotId: revisionId, snapshotHash: hash('e') },
          replayAnchor: { anchorId: 'replay-anchor-test-001', anchorHash: hash('f') },
        },
      },
    }
    const before = structuredClone(runtimeInstance)
    const scopes = { tenantId: 'synthetic-tenant-001' }
    const successorRuntimeInstance = {
      ...runtimeInstance,
      id: 'runtime-successor-test-002',
      revision: {
        revisionNumber: 2,
        parentRuntimeId: runtimeId,
        derivedFromLockSnapshotId: revisionId,
      },
      framework_state: {
        ...runtimeInstance.framework_state,
        lock: { state: 'UNLOCKED', locked: false },
      },
    }
    const persistedRuntimeRevisions = new Map([
      [runtimeId, runtimeInstance],
      [successorRuntimeInstance.id, successorRuntimeInstance],
    ])
    const runtimeResolver = jest.fn(async ({ runtimeInstanceId }) =>
      persistedRuntimeRevisions.get(runtimeInstanceId),
    )
    const frameworkPackageResolver = jest.fn(async () => ({
      _id: 'synthetic-package-001',
      frameworkKey: 'SYNTHETIC_VMF',
      packageKey: 'customer-context-test',
      version: '1.0.0',
      sections: [{ sectionKey: 'customer_context', required: true }],
    }))

    const resolved = await resolveLockedRuntimeDiscoveryContractRevision({
      runtimeInstanceId: runtimeId,
      revisionId,
      scopes,
      runtimeResolver,
      frameworkPackageResolver,
    })

    expect(runtimeResolver).toHaveBeenCalledWith({ runtimeInstanceId: runtimeId, scopes })
    expect(persistedRuntimeRevisions.has(successorRuntimeInstance.id)).toBe(true)
    expect(runtimeResolver.mock.calls[0][0].runtimeInstanceId).toBe(runtimeId)
    expect(resolved.runtimeInstanceId).toBe(runtimeId)
    expect(frameworkPackageResolver).toHaveBeenCalledWith('synthetic-package-001')
    expect(resolved).toEqual(
      expect.objectContaining({
        runtimeInstanceId: runtimeId,
        canonicalReadiness: expect.objectContaining({
          runtime_instance_id: runtimeId,
          revision_id: revisionId,
        }),
        arlReadinessSummary: expect.any(Object),
      }),
    )
    expect(runtimeInstance).toEqual(before)

    frameworkPackageResolver.mockClear()
    const mismatch = await resolveLockedRuntimeDiscoveryContractRevision({
      runtimeInstanceId: runtimeId,
      revisionId: 'another-lock-snapshot-001',
      scopes,
      runtimeResolver,
      frameworkPackageResolver,
    })
    expect(mismatch).toBeNull()
    expect(frameworkPackageResolver).not.toHaveBeenCalled()

    runtimeResolver.mockClear()
    const latestReadiness = await resolveRuntimeDiscoveryContractReadiness({
      runtimeInstanceId: runtimeId,
      scopes,
      runtimeResolver,
      frameworkPackageResolver,
    })
    expect(runtimeResolver).toHaveBeenCalledWith({ runtimeInstanceId: runtimeId, scopes })
    expect(latestReadiness.proof).toEqual(
      expect.objectContaining({
        canonical_revision_readiness: expect.any(Object),
        arl_readiness_summary: expect.any(Object),
        latest_summary: expect.objectContaining({ authoritative: false }),
      }),
    )
    expect(runtimeInstance).toEqual(before)
  })
})
