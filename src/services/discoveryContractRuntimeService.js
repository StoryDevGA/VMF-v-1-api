import {
  buildDiscoverySourceRegistry,
  normalizeDiscoveryEvidenceObjects,
} from './discoveryIntelligenceService.js'
import { buildSectionEvidenceProjection } from './sectionEvidenceProjectionService.js'
import { buildRuntimeIntelligenceGraphForFrameworkState } from './runtimeIntelligenceGraphService.js'
import {
  buildArlReadinessSummary,
  buildCanonicalRevisionReadiness,
  buildEvidenceSnapshotFingerprint,
  DISCOVERY_READINESS_CONTRACT_VERSION,
  isDiscoveryRestrictionAllowed,
  projectLatestReadinessSummary,
  resolveDiscoveryPolicy,
} from './discoveryContractReadinessService.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import { getRuntimeInstance } from './runtimeInstanceService.js'

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasRef = (value) => normalizeText(value).length > 0
const toIdString = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

const mapLegacyReviewToContractState = (reviewStatus) => {
  const status = normalizeToken(reviewStatus)
  if (status === 'ACCEPTED') return 'ADMITTED'
  if (status === 'REJECTED') return 'REJECTED'
  return 'CANDIDATE'
}

const normalizeSnapshotReferences = (values = []) =>
  Array.isArray(values) ? values.map(normalizeText).filter(Boolean) : []

const normalizeTimestamp = (value) =>
  value instanceof Date ? value.toISOString() : normalizeText(value)

const resolveMaybeLean = async (query) =>
  query && typeof query.lean === 'function' ? query.lean() : query

const buildRuntimeDiscoveryContractReadiness = async ({
  runtimeInstance,
  revisionId,
  frameworkPackageResolver,
} = {}) => {
  const frameworkState = runtimeInstance.framework_state || {}
  const runtimeLock = frameworkState.lock || {}
  const lockSnapshot = runtimeLock.snapshot || {}
  const exactRevisionId = normalizeText(lockSnapshot.snapshotId || lockSnapshot.id)

  const frameworkPackage = runtimeInstance.packageId
    ? await frameworkPackageResolver(runtimeInstance.packageId)
    : null
  const storedContract = frameworkState.policy?.discoveryContractReadiness || {}
  const replayAnchor = runtimeLock.replayAnchor || runtimeLock.anchor || {}
  const contract = {
    ...storedContract,
    ...(revisionId ? { revision_id: normalizeText(revisionId) } : {}),
    lock: {
      state: runtimeLock.state,
      locked: runtimeLock.locked === true,
      canonicalOutputEligible:
        runtimeLock.outputEligibility?.canonicalOutputEligible === true ||
        runtimeLock.canonicalOutputEligible === true,
      snapshot_id: exactRevisionId,
      snapshot_hash: lockSnapshot.snapshotHash || lockSnapshot.hash,
      replay_anchor_id: replayAnchor.replayAnchorId || replayAnchor.anchorId || replayAnchor.id,
      replay_anchor_hash:
        replayAnchor.replayAnchorHash || replayAnchor.anchorHash || replayAnchor.hash,
    },
    currentness_state:
      storedContract.currentness_state ||
      runtimeInstance.currentnessState ||
      runtimeInstance.currentness_state,
    evaluated_at:
      storedContract.evaluated_at ||
      runtimeLock.lockedAt ||
      runtimeInstance.lockedAt ||
      runtimeInstance.createdAt,
  }
  const proof = evaluateDiscoveryContractRuntime({
    runtimeInstance,
    frameworkPackage,
    frameworkState,
    contract,
    rebuildGraph: false,
  })

  return {
    runtimeInstanceId: normalizeText(runtimeInstance.id || runtimeInstance._id),
    canonicalReadiness: proof.canonical_revision_readiness,
    arlReadinessSummary: proof.arl_readiness_summary,
    latestSummary: proof.latest_summary,
    proof,
  }
}

export const resolveRuntimeDiscoveryContractReadiness = async ({
  runtimeInstanceId,
  scopes,
  runtimeResolver = getRuntimeInstance,
  frameworkPackageResolver = (packageId) => resolveMaybeLean(FrameworkPackage.findById(packageId)),
} = {}) => {
  const runtimeInstance = await runtimeResolver({ scopes, runtimeInstanceId })
  return buildRuntimeDiscoveryContractReadiness({
    runtimeInstance,
    frameworkPackageResolver,
  })
}

export const resolveLockedRuntimeDiscoveryContractRevision = async ({
  runtimeInstanceId,
  revisionId,
  scopes,
  runtimeResolver = getRuntimeInstance,
  frameworkPackageResolver = (packageId) => resolveMaybeLean(FrameworkPackage.findById(packageId)),
} = {}) => {
  const runtimeInstance = await runtimeResolver({ scopes, runtimeInstanceId })
  const frameworkState = runtimeInstance.framework_state || {}
  const lockSnapshot = frameworkState.lock?.snapshot || {}
  const exactRevisionId = normalizeText(lockSnapshot.snapshotId || lockSnapshot.id)
  if (!exactRevisionId || exactRevisionId !== normalizeText(revisionId)) return null

  const resolved = await buildRuntimeDiscoveryContractReadiness({
    runtimeInstance,
    revisionId: exactRevisionId,
    frameworkPackageResolver,
  })

  return {
    runtimeInstanceId: resolved.runtimeInstanceId,
    canonicalReadiness: resolved.canonicalReadiness,
    arlReadinessSummary: resolved.arlReadinessSummary,
  }
}

export const evaluateDiscoveryContractRuntime = ({
  runtimeInstance = {},
  frameworkPackage = null,
  frameworkState = runtimeInstance.framework_state || {},
  contract = {},
  policyResolver,
  rebuildGraph = false,
  materialGaps = [],
  boundedGaps = [],
  contradictions = [],
  discoveryQuestions = [],
} = {}) => {
  const evidencePack = isObject(frameworkState.evidence_pack) ? frameworkState.evidence_pack : {}
  const evaluatedAt = normalizeTimestamp(
    contract.evaluated_at ||
      evidencePack.refreshedAt ||
      evidencePack.acceptedAt ||
      runtimeInstance.updatedAt,
  )
  const graphBuiltAt = evaluatedAt || '1970-01-01T00:00:00.000Z'
  const lineageSources = Array.isArray(evidencePack.lineage?.sources)
    ? evidencePack.lineage.sources
    : []
  const sourceRegistry = buildDiscoverySourceRegistry({
    capturedAt: evidencePack.refreshedAt || evidencePack.acceptedAt,
    evidenceObjects: Array.isArray(evidencePack.evidenceObjects)
      ? evidencePack.evidenceObjects
      : [],
    sourceRegistry: evidencePack.sourceRegistry || [],
    sources: lineageSources,
  })
  const normalizedEvidence = normalizeDiscoveryEvidenceObjects({
    acquisitionProfile: evidencePack.acquisition?.profile || evidencePack.acquisitionProfile,
    createdAt: evidencePack.refreshedAt || evidencePack.acceptedAt,
    evidenceObjects: evidencePack.evidenceObjects,
    inputs: evidencePack.inputs,
    sources: lineageSources,
  })
  const rawEvidenceById = new Map(
    (evidencePack.evidenceObjects || [])
      .map((item) => [normalizeText(item?.evidenceObjectId), item])
      .filter(([id]) => Boolean(id)),
  )
  const evidenceObjects = normalizedEvidence.map((evidence) => {
    const raw = rawEvidenceById.get(evidence.evidenceObjectId) || {}
    const state =
      normalizeToken(raw.evidenceState) || mapLegacyReviewToContractState(evidence.reviewStatus)
    const defaultOwner = ['CANDIDATE', 'ADMITTED', 'REJECTED'].includes(state) ? 'VE' : ''
    return {
      ...evidence,
      evidenceState: state,
      sourceLocation: raw.sourceLocation || null,
      governingOwner: normalizeToken(raw.governingOwner || defaultOwner),
      governingResultType: normalizeToken(raw.governingResultType),
      acceptedObjectType: normalizeToken(raw.acceptedObjectType),
      acceptedObjectRef: normalizeText(raw.acceptedObjectRef),
      predecessorEvidenceRef: normalizeText(raw.predecessorEvidenceRef),
      dispositionReason: normalizeText(raw.dispositionReason),
      restrictionId: normalizeText(raw.restrictionId),
      restrictionState: normalizeToken(raw.restrictionState),
      restrictionScope: isObject(raw.restrictionScope) ? raw.restrictionScope : {},
      reviewerRef: normalizeText(raw.reviewerRef),
      auditRef: normalizeText(raw.auditRef),
      currentnessState: normalizeToken(raw.currentnessState || 'CURRENT'),
    }
  })
  const graphEvidenceObjects = evidenceObjects.map((evidence) => ({
    ...evidence,
    reviewStatus: ['ADMITTED', 'ACCEPTED'].includes(evidence.evidenceState)
      ? 'ACCEPTED'
      : evidence.evidenceState === 'REJECTED'
        ? 'REJECTED'
        : 'PENDING',
  }))
  const graphFrameworkState = {
    ...frameworkState,
    evidence_pack: {
      ...evidencePack,
      accepted: false,
      sourceRegistry,
      evidenceObjects: graphEvidenceObjects,
    },
  }
  const graph = buildRuntimeIntelligenceGraphForFrameworkState({
    builtAt: graphBuiltAt,
    frameworkPackage,
    frameworkState: graphFrameworkState,
    runtimeInstance,
  })
  const persistedGraph = frameworkState.intelligence_graph || frameworkState.intelligenceGraph || {}
  const graphCurrentness =
    rebuildGraph === true ||
    (normalizeText(persistedGraph.graphHash) === normalizeText(graph.graphHash) &&
      normalizeText(persistedGraph.graphVersion) === normalizeText(graph.graphVersion) &&
      normalizeText(persistedGraph.build?.sourceHash) === normalizeText(graph.build?.sourceHash) &&
      normalizeToken(persistedGraph.build?.status) === 'VALID' &&
      normalizeToken(persistedGraph.validation?.status) === 'VALID')
      ? 'CURRENT'
      : 'STALE'
  const requiredSections = Array.isArray(contract.requiredSections)
    ? contract.requiredSections
    : (Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : [])
        .filter((section) => section.required === true)
        .map((section) => section.sectionKey)
  const reasoningArtifactRefsBySection = isObject(contract.reasoningArtifactRefsBySection)
    ? contract.reasoningArtifactRefsBySection
    : {}
  const sectionCoverage = requiredSections.map((section) => {
    const sectionKey = normalizeText(isObject(section) ? section.sectionKey : section)
    const sectionRestrictions = Array.isArray(contract.restrictions) ? contract.restrictions : []
    const eligibleForSectionProjection = evidenceObjects.filter((evidence) => {
      if (evidence.reviewStatus !== 'ACCEPTED') return false
      const restrictedEvidence =
        evidence.evidenceState === 'RESTRICTED' || evidence.restrictionState === 'RESTRICTED'
      if (!['ADMITTED', 'ACCEPTED'].includes(evidence.evidenceState) && !restrictedEvidence)
        return false
      const ownScopeAllows =
        !restrictedEvidence ||
        (isDiscoveryRestrictionAllowed(evidence.restrictionScope, {
          sectionKey,
          use: 'SECTION_MAPPING',
        }) &&
          isDiscoveryRestrictionAllowed(evidence.restrictionScope, {
            sectionKey,
            use: 'CANONICAL_REVISION',
          }))
      const externalScopeAllows = !sectionRestrictions.some((restriction) => {
        const active =
          normalizeToken(restriction.status) === 'ACTIVE' ||
          normalizeToken(restriction.state) === 'RESTRICTED'
        const applies =
          (Array.isArray(restriction.evidenceObjectIds) &&
            restriction.evidenceObjectIds.map(normalizeText).includes(evidence.evidenceObjectId)) ||
          (Array.isArray(restriction.sectionKeys) &&
            restriction.sectionKeys.map(normalizeText).includes(sectionKey))
        return (
          active &&
          applies &&
          (!isDiscoveryRestrictionAllowed(restriction, { sectionKey, use: 'SECTION_MAPPING' }) ||
            !isDiscoveryRestrictionAllowed(restriction, { sectionKey, use: 'CANONICAL_REVISION' }))
        )
      })
      return ownScopeAllows && externalScopeAllows
    })
    const projection = buildSectionEvidenceProjection({
      evidenceObjects: eligibleForSectionProjection,
      sectionKey,
    })
    const sectionState = frameworkState.sections?.[sectionKey] || {}
    const reasoningArtifactRefs = normalizeSnapshotReferences(
      reasoningArtifactRefsBySection[sectionKey] || sectionState.reasoningArtifactRefs,
    )
    const evidenceObjectIds = projection.selectedEvidenceObjects
      .map((item) => normalizeText(item.evidenceObjectId))
      .filter(Boolean)
      .sort()
    const validationResultRefs =
      graph.validation.status === 'VALID' ? [`rig-validation:${graph.graphHash}`] : []
    return {
      sectionKey,
      required: true,
      sufficient:
        evidenceObjectIds.length > 0 &&
        reasoningArtifactRefs.length > 0 &&
        validationResultRefs.length > 0,
      evidenceObjectIds,
      reasoningArtifactRefs,
      validationResultRefs,
      projection: {
        version: projection.version,
        algorithm: projection.algorithm,
        includedCount: projection.includedCount,
        gaps: projection.gaps,
      },
    }
  })
  const evidenceFingerprint = buildEvidenceSnapshotFingerprint(evidenceObjects)
  const auditRefs = [
    ...(Array.isArray(contract.audit_refs) ? contract.audit_refs : []),
    ...(Array.isArray(evidencePack.audit_refs) ? evidencePack.audit_refs : []),
    ...(Array.isArray(evidencePack.sourceRegistry)
      ? evidencePack.sourceRegistry.map((source) => source.auditRef)
      : []),
    ...evidenceObjects.map((evidence) => evidence.auditRef),
    contract.graph_audit_ref,
    persistedGraph.auditRef || persistedGraph.build?.auditRef,
  ].map(normalizeText).filter(Boolean)
  const discoveryPolicy = resolveDiscoveryPolicy({
    frameworkKey: runtimeInstance.frameworkKey,
    packageKey: runtimeInstance.packageKey,
    packageVersion: runtimeInstance.packageVersion,
    runtimeInstance,
    ...(policyResolver ? { policyResolver } : {}),
  })
  const runtimeLock = isObject(frameworkState.lock) ? frameworkState.lock : {}
  const lockSnapshot = isObject(runtimeLock.snapshot) ? runtimeLock.snapshot : {}
  const replayAnchor = runtimeLock.replayAnchor || runtimeLock.anchor || {}
  const lock = contract.lock || {
    state: runtimeLock.state,
    locked: runtimeLock.locked,
    canonicalOutputEligible: runtimeLock.canonicalOutputEligible,
    snapshot_id: lockSnapshot.snapshotId || lockSnapshot.id,
    snapshot_hash: lockSnapshot.snapshotHash || lockSnapshot.hash,
    replay_anchor_id: replayAnchor.replayAnchorId || replayAnchor.anchorId || replayAnchor.id,
    replay_anchor_hash:
      replayAnchor.replayAnchorHash || replayAnchor.anchorHash || replayAnchor.hash,
  }
  const dependencyEvidence = runtimeInstance.evidence || {}
  const packageIdentity = {
    package_id: contract.storylineos_package?.package_id || toIdString(runtimeInstance.packageId),
    package_key:
      contract.storylineos_package?.package_key || normalizeText(runtimeInstance.packageKey),
    package_version:
      contract.storylineos_package?.package_version ||
      normalizeText(runtimeInstance.packageVersion),
    dependency_lock_id:
      contract.storylineos_package?.dependency_lock_id ||
      normalizeText(runtimeInstance.dependencyLockId),
    dependency_snapshot_id:
      contract.storylineos_package?.dependency_snapshot_id ||
      normalizeText(dependencyEvidence.dependencySnapshotId),
    dependency_snapshot_hash:
      contract.storylineos_package?.dependency_snapshot_hash ||
      normalizeText(dependencyEvidence.dependencySnapshotHash),
    runtime_compatibility_version:
      contract.storylineos_package?.runtime_compatibility_version || '',
  }
  const explicitLineageRefs = normalizeSnapshotReferences(contract.lineage_refs)
  const lineageRefs =
    explicitLineageRefs.length > 0
      ? explicitLineageRefs
      : evidenceObjects.map((evidence) => evidence.lineageRef).filter(Boolean)
  const canonicalReadiness = buildCanonicalRevisionReadiness({
    revision_id: contract.revision_id,
    runtime_instance_id: toIdString(runtimeInstance._id || runtimeInstance.id),
    predecessor_revision_id: contract.predecessor_revision_id,
    framework_id: contract.framework_id || toIdString(runtimeInstance.frameworkId),
    vmf_methodology_version: contract.vmf_methodology_version,
    vmf_runtime_composition_refs: contract.vmf_runtime_composition_refs,
    source_state_version:
      contract.source_state_version ||
      runtimeInstance.stateVersion ||
      runtimeInstance.runtimeStateVersion,
    storylineos_package: packageIdentity,
    discoveryPolicy,
    evidenceSnapshot: {
      snapshot_id: contract.evidence_snapshot_id || `evidence-snapshot:${evidenceFingerprint}`,
      fingerprint: evidenceFingerprint,
      evidence_objects: evidenceObjects,
    },
    graphSnapshot: {
      snapshot_id: `graph-snapshot:${graph.graphHash}`,
      version: graph.graphVersion,
      hash: graph.graphHash,
      source_hash: graph.build.sourceHash,
      build_trigger: graph.build.trigger,
      built_at: graph.build.builtAt,
      audit_ref: normalizeText(
        contract.graph_audit_ref || persistedGraph.auditRef || persistedGraph.build?.auditRef,
      ),
      currentness: graphCurrentness,
      validation: graph.validation.status,
    },
    sections: sectionCoverage,
    materialClaims: contract.materialClaims,
    acceptedObjects: contract.acceptedObjects,
    contradictions,
    restrictions: contract.restrictions,
    validation_result_refs: normalizeSnapshotReferences(contract.validation_result_refs).concat(
      sectionCoverage.flatMap((section) => section.validationResultRefs),
    ),
    authorization_dependency_refs: normalizeSnapshotReferences(
      contract.authorization_dependency_refs,
    ),
    lineage_refs: lineageRefs,
    audit_refs: [...new Set(auditRefs)],
    lock,
    publication: { state: frameworkState.publish?.state || 'UNPUBLISHED' },
    availability: contract.availability,
    currentness_state:
      contract.currentness_state ||
      runtimeInstance.currentnessState ||
      runtimeInstance.currentness_state,
    created_at: contract.created_at,
    locked_at: runtimeInstance.lockedAt,
    published_at: frameworkState.publish?.publishedAt,
    evaluated_at: evaluatedAt,
  })
  const arlReadinessSummary = buildArlReadinessSummary({
    canonicalReadiness,
    graphSnapshot: canonicalReadiness.graph_snapshot,
    identityResolved:
      discoveryPolicy.status === 'RESOLVED' &&
      canonicalReadiness.readiness.unresolved.every(
        (item) =>
          item !== 'VMF_IDENTITY_INCOMPLETE' &&
          item !== 'STORYLINEOS_PACKAGE_IDENTITY_INCOMPLETE' &&
          item !== 'SOURCE_STATE_VERSION_MISSING',
      ),
    materialGaps,
    boundedGaps,
    contradictions,
    discoveryQuestions,
  })
  const evidenceNodeIdsByObjectId = new Map(
    graph.nodes
      .filter((node) => node.nodeType === 'EVIDENCE' && hasRef(node.evidenceObjectId))
      .map((node) => [normalizeText(node.evidenceObjectId), node.nodeId]),
  )
  const evidenceObjectsByNodeId = new Map(
    Array.from(evidenceNodeIdsByObjectId.entries()).map(([evidenceObjectId, nodeId]) => [
      nodeId,
      evidenceObjectId,
    ]),
  )
  const acceptedIntelligenceEvidenceRefs = [
    ...new Set(
      graph.nodes
        .filter((node) => node.nodeType === 'INTELLIGENCE')
        .flatMap((node) =>
          Array.isArray(node.sourceEvidenceNodeIds) ? node.sourceEvidenceNodeIds : [],
        )
        .map((nodeId) => evidenceObjectsByNodeId.get(nodeId))
        .filter(Boolean),
    ),
  ].sort()

  return {
    contract_version: DISCOVERY_READINESS_CONTRACT_VERSION,
    source_registry: sourceRegistry.map((source) => ({
      source_id: source.sourceId,
      source_type: source.sourceType,
      lineage_ref: source.lineageRef,
      evidence_object_count: source.evidenceObjectsGenerated,
    })),
    evidence_snapshot: {
      snapshot_id: canonicalReadiness.evidence_snapshot.snapshot_id,
      fingerprint: canonicalReadiness.evidence_snapshot.fingerprint,
      states: canonicalReadiness.evidence_snapshot.evidence_states,
    },
    runtime_intelligence_graph: {
      snapshot_id: canonicalReadiness.graph_snapshot.snapshot_id,
      version: canonicalReadiness.graph_snapshot.version,
      hash: canonicalReadiness.graph_snapshot.hash,
      source_hash: graph.build.sourceHash,
      build_trigger: graph.build.trigger,
      built_at: graph.build.builtAt,
      audit_ref: canonicalReadiness.graph_snapshot.audit_ref,
      currentness: canonicalReadiness.graph_snapshot.currentness,
      validation: canonicalReadiness.graph_snapshot.validation,
      node_count: graph.nodes.length,
      edge_count: graph.edges.length,
      accepted_intelligence_evidence_refs: acceptedIntelligenceEvidenceRefs,
      rebuilt: rebuildGraph === true,
    },
    section_coverage: sectionCoverage.map(({ projection, ...section }) => ({
      ...section,
      projection,
    })),
    canonical_revision_readiness: canonicalReadiness,
    arl_readiness_summary: arlReadinessSummary,
    latest_summary: projectLatestReadinessSummary(canonicalReadiness, arlReadinessSummary),
  }
}
