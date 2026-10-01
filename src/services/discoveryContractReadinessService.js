import { createHash } from 'node:crypto'

export const DISCOVERY_READINESS_CONTRACT_VERSION = 'discovery-readiness.v1'

export const CANONICAL_REVISION_READINESS = Object.freeze({
  READY: 'READY',
  NOT_READY: 'NOT_READY',
  UNRESOLVED: 'UNRESOLVED',
})

export const VMF_DISCOVERY_OWNER_MAP = Object.freeze({
  CANDIDATE: Object.freeze(['OR', 'VE']),
  CAPTURED: Object.freeze(['OR', 'VE', 'STATE']),
  EXTRACTED: Object.freeze(['OR', 'VE']),
  PROPOSED: Object.freeze(['VE']),
  ADMITTED: Object.freeze(['VE']),
  ACCEPTED: Object.freeze([]),
  REJECTED: Object.freeze(['VE', 'STATE']),
  CORRECTED: Object.freeze(['VE', 'STATE']),
  RESTRICTED: Object.freeze(['EC', 'VE']),
  SUPERSEDED: Object.freeze(['VE', 'STATE']),
  CONTRADICTION: Object.freeze(['CR']),
  TRUTH: Object.freeze(['DX']),
  LIFECYCLE: Object.freeze(['STATE']),
  AUTHORIZATION: Object.freeze(['EC']),
  ROUTE: Object.freeze(['ET', 'ET-RT']),
})

export const VMF_DISCOVERY_STATE_RESULT_REQUIREMENTS = Object.freeze({
  ACCEPTED: 'EXACT_GOVERNING_OWNER_RESULT_AND_OBJECT_TYPE_REQUIRED',
})
export const DISCOVERY_ACCEPTED_OBJECT_TYPES = Object.freeze([
  'EVIDENCE_OBJECT',
  'ADVISORY_INTERPRETATION',
  'SECTION_MAPPING_RECEIPT',
  'SECTION_TRUTH_RESULT',
  'CANONICAL_REVISION',
])
export const ARL_READINESS = Object.freeze({
  READY: 'READY_FOR_ARL',
  CONDITIONAL: 'CONDITIONAL_READY_FOR_ARL',
  REWORK: 'REWORK_REQUIRED',
  BLOCKED: 'BLOCKED',
})

export const POST_LOCK_DISCOVERY_DISPOSITIONS = Object.freeze({
  NO_REVISION_IMPACT: 'NO_REVISION_IMPACT',
  CORROBORATIVE: 'CORROBORATIVE',
  SUCCESSOR_REVISION_REQUIRED: 'SUCCESSOR_REVISION_REQUIRED',
  CURRENTNESS_REVIEW_REQUIRED: 'CURRENTNESS_REVIEW_REQUIRED',
})

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isObject(value)) return value
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key])
      return result
    }, {})
}

const hashValue = (value) =>
  'sha256:' +
  createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')

export const hashDiscoveryContractValue = hashValue

export const buildEvidenceSnapshotFingerprint = (evidenceObjects = []) =>
  hashValue(
    (Array.isArray(evidenceObjects) ? evidenceObjects : [])
      .map((item) => ({
        evidence_object_id: normalizeText(item?.evidenceObjectId),
        source_id: normalizeText(item?.sourceId),
        state: normalizeToken(item?.evidenceState || item?.acceptanceState || item?.reviewStatus),
        source_location: isObject(item?.sourceLocation)
          ? stableValue(item.sourceLocation)
          : normalizeText(item?.sourceLocation),
        lineage_ref: normalizeText(item?.lineageRef),
        governing_owner: normalizeToken(item?.governingOwner),
        governing_result_type: normalizeToken(item?.governingResultType),
        accepted_object_type: normalizeToken(item?.acceptedObjectType),
        accepted_object_ref: normalizeText(item?.acceptedObjectRef),
        predecessor_evidence_ref: normalizeText(item?.predecessorEvidenceRef),
        successor_evidence_ref: normalizeText(item?.successorEvidenceRef),
        disposition_reason: normalizeText(item?.dispositionReason),
        restriction_id: normalizeText(item?.restrictionId),
        restriction_state: normalizeToken(item?.restrictionState),
        restriction_scope: isObject(item?.restrictionScope)
          ? stableValue(item.restrictionScope)
          : {},
        reviewer_ref: normalizeText(item?.reviewerRef),
        audit_ref: normalizeText(item?.auditRef),
        audit_refs: [...new Set([
          ...(Array.isArray(item?.auditRefs) ? item.auditRefs : []),
          item?.auditRef,
        ].map(normalizeText).filter(Boolean))].sort(),
        currentness_state: normalizeToken(item?.currentnessState || 'CURRENT'),
        content_hash: hashValue(item?.extractedFact || item?.contentHash || ''),
      }))
      .sort((left, right) => left.evidence_object_id.localeCompare(right.evidence_object_id)),
  )

const hasRef = (value) => normalizeText(value).length > 0
const isHash = (value) => /^sha256:[a-f0-9]{64}$/i.test(normalizeText(value))
const VMF_OWNER_CODES = new Set(['OR', 'VE', 'CR', 'STATE', 'DX', 'EC', 'ET', 'ET-RT'])

const defaultPolicyLookup = ({ runtimeInstance } = {}) =>
  runtimeInstance?.framework_state?.policy?.discoveryContract ||
  runtimeInstance?.frameworkState?.policy?.discoveryContract ||
  null

const getIdentity = ({ frameworkKey, packageKey, packageVersion, runtimeInstance = {} } = {}) => ({
  frameworkKey: normalizeToken(frameworkKey || runtimeInstance.frameworkKey),
  packageKey: normalizeText(packageKey || runtimeInstance.packageKey),
  packageVersion: normalizeText(packageVersion || runtimeInstance.packageVersion),
})

export const resolveDiscoveryPolicy = ({
  frameworkKey,
  packageKey,
  packageVersion,
  runtimeInstance = {},
  policyResolver = defaultPolicyLookup,
} = {}) => {
  const identity = getIdentity({ frameworkKey, packageKey, packageVersion, runtimeInstance })
  const missingIdentity = Object.entries(identity)
    .filter(([, value]) => !hasRef(value))
    .map(([key]) => key)
  if (missingIdentity.length > 0) {
    return {
      status: 'UNRESOLVED',
      policy: null,
      identity,
      policyHash: '',
      blockers: ['DISCOVERY_POLICY_IDENTITY_MISSING'],
      missingIdentity,
    }
  }

  let policy
  try {
    policy = policyResolver({ ...identity, runtimeInstance })
  } catch {
    return {
      status: 'UNRESOLVED',
      policy: null,
      identity,
      policyHash: '',
      blockers: ['DISCOVERY_POLICY_RESOLUTION_FAILED'],
      missingIdentity: [],
    }
  }
  if (!isObject(policy) || !hasRef(policy.key) || !hasRef(policy.version)) {
    return {
      status: 'UNRESOLVED',
      policy: null,
      identity,
      policyHash: '',
      blockers: ['DISCOVERY_POLICY_NOT_RESOLVED'],
      missingIdentity: [],
    }
  }

  const policyIdentity = isObject(policy.identity) ? policy.identity : {}
  const resolvedPolicyIdentity = {
    frameworkKey: normalizeToken(policyIdentity.frameworkKey || policyIdentity.framework_key),
    packageKey: normalizeText(policyIdentity.packageKey || policyIdentity.package_key),
    packageVersion: normalizeText(policyIdentity.packageVersion || policyIdentity.package_version),
  }
  if (Object.values(resolvedPolicyIdentity).some((value) => !hasRef(value))) {
    return {
      status: 'UNRESOLVED',
      policy: null,
      identity,
      policyHash: '',
      blockers: ['DISCOVERY_POLICY_IDENTITY_INCOMPLETE'],
      missingIdentity: Object.entries(resolvedPolicyIdentity)
        .filter(([, value]) => !hasRef(value))
        .map(([key]) => key),
    }
  }
  const identityMismatch = Object.entries(identity).some(
    ([key, value]) => resolvedPolicyIdentity[key] !== value,
  )
  if (identityMismatch) {
    return {
      status: 'INVALID',
      policy: null,
      identity,
      policyHash: '',
      blockers: ['DISCOVERY_POLICY_IDENTITY_MISMATCH'],
      missingIdentity: [],
    }
  }

  const policyBody = { ...policy }
  delete policyBody.hash
  const policyHash = hashValue(policyBody)
  if (hasRef(policy.hash) && normalizeText(policy.hash).toLowerCase() !== policyHash) {
    return {
      status: 'INVALID',
      policy: null,
      identity,
      policyHash,
      blockers: ['DISCOVERY_POLICY_HASH_MISMATCH'],
      missingIdentity: [],
    }
  }

  return {
    status: 'RESOLVED',
    policy: policyBody,
    identity,
    policyKey: normalizeText(policy.key),
    policyVersion: normalizeText(policy.version),
    policyHash,
    blockers: [],
    missingIdentity: [],
  }
}

const locationIsPresent = (location) => {
  if (typeof location === 'string') return hasRef(location)
  if (!isObject(location)) return false
  return ['locator', 'uri', 'fieldPath', 'page', 'jsonPointer', 'section'].some((key) =>
    hasRef(location[key]),
  )
}

const restrictionAllows = (restriction = {}, { claimId, sectionKey, use } = {}) => {
  const allowedUses = Array.isArray(restriction.allowedUses)
    ? restriction.allowedUses.map(normalizeToken)
    : []
  if (!allowedUses.includes(normalizeToken(use))) return false
  if (
    claimId &&
    !(
      Array.isArray(restriction.claimIds) &&
      restriction.claimIds.map(normalizeText).includes(normalizeText(claimId))
    )
  )
    return false
  if (
    sectionKey &&
    !(
      Array.isArray(restriction.sectionKeys) &&
      restriction.sectionKeys.map(normalizeText).includes(normalizeText(sectionKey))
    )
  )
    return false
  return true
}
export const isDiscoveryRestrictionAllowed = restrictionAllows

const evaluateMaterialClaimSupport = ({ claims = [], evidenceObjects = [] } = {}) => {
  const evidenceById = new Map()
  for (const evidence of evidenceObjects) {
    const id = normalizeText(evidence?.evidenceObjectId)
    if (id && !evidenceById.has(id)) evidenceById.set(id, evidence)
  }

  const unsupportedClaims = []
  for (const claim of claims) {
    if (claim?.material !== true) continue
    const claimId = normalizeText(claim.claimId)
    const refs = Array.isArray(claim.evidenceObjectIds) ? claim.evidenceObjectIds : []
    const supported =
      refs.length > 0 &&
      refs.every((id) => {
        const evidence = evidenceById.get(normalizeText(id))
        const state = normalizeToken(
          evidence?.evidenceState || evidence?.acceptanceState || evidence?.reviewStatus,
        )
        const typedAcceptedObject =
          state !== 'ACCEPTED' ||
          (hasRef(evidence?.acceptedObjectType) &&
            DISCOVERY_ACCEPTED_OBJECT_TYPES.includes(
              normalizeToken(evidence?.acceptedObjectType),
            ) &&
            hasRef(evidence?.governingOwner) &&
            hasRef(evidence?.governingResultType) &&
            VMF_OWNER_CODES.has(normalizeToken(evidence?.governingOwner)))
        return (
          evidence &&
          (['ADMITTED', 'ACCEPTED'].includes(state) ||
            (state === 'RESTRICTED' &&
              restrictionAllows(evidence.restrictionScope, {
                claimId,
                use: 'CANONICAL_REVISION',
              }))) &&
          locationIsPresent(evidence.sourceLocation) &&
          (normalizeToken(evidence?.restrictionState) !== 'RESTRICTED' ||
            restrictionAllows(evidence.restrictionScope, {
              claimId,
              use: 'CANONICAL_REVISION',
            })) &&
          normalizeToken(evidence?.currentnessState || 'CURRENT') === 'CURRENT' &&
          typedAcceptedObject
        )
      })
    if (!supported) unsupportedClaims.push(claimId || 'UNIDENTIFIED_MATERIAL_CLAIM')
  }

  return unsupportedClaims
}

const getEvidenceState = (evidence = {}) =>
  normalizeToken(evidence.evidenceState || evidence.acceptanceState || evidence.reviewStatus)

const isEligibleEvidenceReference = (evidence = {}, scope = {}) => {
  const state = getEvidenceState(evidence)
  const restricted =
    state === 'RESTRICTED' || normalizeToken(evidence.restrictionState) === 'RESTRICTED'
  const restrictedUseIsAllowed = !restricted || restrictionAllows(evidence.restrictionScope, scope)
  const typedAcceptedObject =
    state !== 'ACCEPTED' ||
    (hasRef(evidence.acceptedObjectType) &&
      DISCOVERY_ACCEPTED_OBJECT_TYPES.includes(normalizeToken(evidence.acceptedObjectType)) &&
      hasRef(evidence.governingOwner) &&
      hasRef(evidence.governingResultType) &&
      VMF_OWNER_CODES.has(normalizeToken(evidence.governingOwner)))
  return (
    ['ADMITTED', 'ACCEPTED', 'RESTRICTED'].includes(state) &&
    locationIsPresent(evidence.sourceLocation) &&
    normalizeToken(evidence.currentnessState || 'CURRENT') === 'CURRENT' &&
    typedAcceptedObject &&
    restrictedUseIsAllowed
  )
}

const normalizeSectionReferences = (sections = []) =>
  sections
    .filter(isObject)
    .map((section) => ({
      sectionKey: normalizeText(section.sectionKey),
      required: section.required !== false,
      sufficient: section.sufficient === true,
      evidenceObjectIds: Array.isArray(section.evidenceObjectIds)
        ? [...new Set(section.evidenceObjectIds.map(normalizeText).filter(Boolean))].sort()
        : [],
      reasoningArtifactRefs: Array.isArray(section.reasoningArtifactRefs)
        ? [...new Set(section.reasoningArtifactRefs.map(normalizeText).filter(Boolean))].sort()
        : [],
      validationResultRefs: Array.isArray(section.validationResultRefs)
        ? [...new Set(section.validationResultRefs.map(normalizeText).filter(Boolean))].sort()
        : [],
    }))
    .sort((left, right) => left.sectionKey.localeCompare(right.sectionKey))

const buildCanonicalReferenceSet = (payload = {}) => ({
  revision_id: normalizeText(payload.revision_id),
  runtime_instance_id: normalizeText(payload.runtime_instance_id),
  predecessor_revision_id: normalizeText(payload.predecessor_revision_id),
  framework_id: normalizeText(payload.framework_id),
  vmf_identity: stableValue(payload.vmf_identity || {}),
  source_state_version: normalizeText(payload.source_state_version),
  storylineos_package: stableValue(payload.storylineos_package || {}),
  discovery_policy: stableValue(payload.discovery_policy || {}),
  evidence_snapshot: stableValue(payload.evidence_snapshot || {}),
  graph_snapshot: stableValue(payload.graph_snapshot || {}),
  audit_refs: stableValue(payload.audit_refs || []),
  sections: stableValue(payload.sections || []),
  validation_result_refs: stableValue(payload.validation_result_refs || []),
  accepted_object_refs: stableValue(payload.accepted_object_refs || []),
  material_claim_refs: stableValue(payload.material_claim_refs || []),
  contradiction_state_refs: stableValue(payload.contradiction_state_refs || []),
  restriction_refs: stableValue(payload.restriction_refs || []),
  restriction_state_refs: stableValue(payload.restriction_state_refs || []),
  authorization_dependency_refs: stableValue(payload.authorization_dependency_refs || []),
  lock: stableValue(payload.lock || {}),
  lineage_refs: stableValue(payload.lineage_refs || []),
})

export const buildCanonicalRevisionReadiness = (input = {}) => {
  const policy = input.discoveryPolicy || {}
  const policyIdentity = isObject(policy.identity) ? policy.identity : {}
  const evidenceSnapshot = input.evidenceSnapshot || {}
  const graph = input.graphSnapshot || {}
  const lock = input.lock || {}
  const packageIdentity = isObject(input.storylineos_package) ? input.storylineos_package : {}
  const currentnessState = normalizeToken(input.currentness_state)
  const sections = normalizeSectionReferences(input.sections)
  const materialClaims = Array.isArray(input.materialClaims) ? input.materialClaims : []
  const acceptedObjects = Array.isArray(input.acceptedObjects) ? input.acceptedObjects : []
  const contradictions = Array.isArray(input.contradictions) ? input.contradictions : []
  const restrictions = Array.isArray(input.restrictions) ? input.restrictions : []
  const publication = isObject(input.publication) ? input.publication : {}
  const availability = isObject(input.availability) ? input.availability : {}
  const blockers = []
  const unresolved = []

  if (!hasRef(input.revision_id) || !hasRef(input.runtime_instance_id))
    unresolved.push('REVISION_IDENTITY_MISSING')
  if (policy.status !== 'RESOLVED' || !isHash(policy.policyHash))
    unresolved.push('DISCOVERY_POLICY_UNRESOLVED')
  const policyIdentityTuple = {
    frameworkKey: normalizeToken(policyIdentity.frameworkKey || policyIdentity.framework_key),
    packageKey: normalizeText(policyIdentity.packageKey || policyIdentity.package_key),
    packageVersion: normalizeText(policyIdentity.packageVersion || policyIdentity.package_version),
  }
  if (Object.values(policyIdentityTuple).some((value) => !hasRef(value))) {
    unresolved.push('DISCOVERY_POLICY_IDENTITY_INCOMPLETE')
  } else if (
    policyIdentityTuple.packageKey !== normalizeText(packageIdentity.package_key) ||
    policyIdentityTuple.packageVersion !== normalizeText(packageIdentity.package_version)
  ) {
    unresolved.push('DISCOVERY_POLICY_IDENTITY_MISMATCH')
  }
  if (!hasRef(input.evaluated_at)) unresolved.push('EVALUATION_TIMESTAMP_MISSING')
  if (!hasRef(evidenceSnapshot.snapshot_id) || !isHash(evidenceSnapshot.fingerprint))
    unresolved.push('EVIDENCE_SNAPSHOT_UNRESOLVED')
  if (!hasRef(graph.snapshot_id) || !hasRef(graph.version) || !isHash(graph.hash))
    unresolved.push('GRAPH_SNAPSHOT_UNRESOLVED')
  if (
    normalizeToken(graph.currentness) !== 'CURRENT' ||
    normalizeToken(graph.validation) !== 'VALID'
  ) {
    blockers.push('GRAPH_STALE_OR_INVALID')
  }
  if (!hasRef(graph.audit_ref)) unresolved.push('GRAPH_AUDIT_REFERENCE_MISSING')
  if (
    !hasRef(input.framework_id) ||
    !hasRef(input.vmf_methodology_version) ||
    !Array.isArray(input.vmf_runtime_composition_refs) ||
    input.vmf_runtime_composition_refs.length === 0
  ) {
    unresolved.push('VMF_IDENTITY_INCOMPLETE')
  }
  if (!hasRef(input.source_state_version)) unresolved.push('SOURCE_STATE_VERSION_MISSING')
  if (!currentnessState) unresolved.push('CURRENTNESS_STATE_MISSING')
  else if (currentnessState !== 'CURRENT') blockers.push('REVISION_CURRENTNESS_NOT_CURRENT')
  if (
    !hasRef(packageIdentity.package_id) ||
    !hasRef(packageIdentity.package_key) ||
    !hasRef(packageIdentity.package_version) ||
    !hasRef(packageIdentity.dependency_lock_id) ||
    !hasRef(packageIdentity.dependency_snapshot_id) ||
    !isHash(packageIdentity.dependency_snapshot_hash) ||
    !hasRef(packageIdentity.runtime_compatibility_version)
  ) {
    unresolved.push('STORYLINEOS_PACKAGE_IDENTITY_INCOMPLETE')
  }

  const evidenceObjects = Array.isArray(evidenceSnapshot.evidence_objects)
    ? evidenceSnapshot.evidence_objects
    : []
  const evidenceIds = evidenceObjects
    .map((item) => normalizeText(item?.evidenceObjectId))
    .filter(Boolean)
  if (new Set(evidenceIds).size !== evidenceIds.length)
    unresolved.push('EVIDENCE_SNAPSHOT_HAS_DUPLICATE_IDS')
  if (
    evidenceObjects.some(
      (evidence) =>
        !hasRef(evidence.evidenceObjectId) ||
        !hasRef(evidence.sourceId) ||
        !hasRef(evidence.lineageRef),
    )
  ) {
    blockers.push('EVIDENCE_PROVENANCE_MISSING')
  }
  if (
    isHash(evidenceSnapshot.fingerprint) &&
    buildEvidenceSnapshotFingerprint(evidenceObjects) !== evidenceSnapshot.fingerprint
  ) {
    unresolved.push('EVIDENCE_SNAPSHOT_FINGERPRINT_MISMATCH')
  }
  const knownEvidenceStates = new Set([
    'CANDIDATE',
    'CAPTURED',
    'EXTRACTED',
    'PROPOSED',
    'ADMITTED',
    'ACCEPTED',
    'REJECTED',
    'CORRECTED',
    'RESTRICTED',
    'SUPERSEDED',
  ])
  if (evidenceObjects.some((evidence) => !knownEvidenceStates.has(getEvidenceState(evidence)))) {
    blockers.push('EVIDENCE_STATE_UNKNOWN')
  }
  if (
    evidenceObjects.some(
      (evidence) =>
        !VMF_OWNER_CODES.has(normalizeToken(evidence.governingOwner)) ||
        !hasRef(evidence.governingResultType),
    )
  ) {
    blockers.push('EVIDENCE_GOVERNING_RESULT_MISSING')
  }
  if (
    evidenceObjects.some((evidence) => {
      const state = getEvidenceState(evidence)
      if (!knownEvidenceStates.has(state)) return false
      const owner = normalizeToken(evidence.governingOwner)
      const allowedOwners = VMF_DISCOVERY_OWNER_MAP[state]
      return (
        state !== 'ACCEPTED' && (!Array.isArray(allowedOwners) || !allowedOwners.includes(owner))
      )
    })
  ) {
    blockers.push('EVIDENCE_OWNER_STATE_MISMATCH')
  }
  if (
    evidenceObjects.some(
      (evidence) =>
        getEvidenceState(evidence) === 'CORRECTED' &&
        (!hasRef(evidence.predecessorEvidenceRef) ||
          !hasRef(evidence.dispositionReason) ||
          !hasRef(evidence.reviewerRef) ||
          !hasRef(evidence.auditRef)),
    )
  ) {
    blockers.push('CORRECTION_LINEAGE_OR_REVIEW_MISSING')
  }
  if (
    evidenceObjects.some(
      (evidence) =>
        (getEvidenceState(evidence) === 'RESTRICTED' ||
          normalizeToken(evidence.restrictionState) === 'RESTRICTED') &&
        (!hasRef(evidence.restrictionId) ||
          !isObject(evidence.restrictionScope) ||
          !Array.isArray(evidence.restrictionScope.allowedUses) ||
          evidence.restrictionScope.allowedUses.length === 0),
    )
  ) {
    blockers.push('RESTRICTION_ID_OR_SCOPE_MISSING')
  }
  const unsupportedClaims = evaluateMaterialClaimSupport({
    claims: materialClaims,
    evidenceObjects,
  })
  if (unsupportedClaims.length > 0) blockers.push('MATERIAL_CLAIMS_UNSUPPORTED')

  const rejectedEvidenceIds = evidenceObjects
    .filter(
      (evidence) =>
        normalizeToken(
          evidence?.evidenceState || evidence?.acceptanceState || evidence?.reviewStatus,
        ) === 'REJECTED',
    )
    .map((evidence) => normalizeText(evidence.evidenceObjectId))
    .filter(Boolean)
  if (
    materialClaims.some((claim) =>
      (claim.evidenceObjectIds || []).some((id) => rejectedEvidenceIds.includes(normalizeText(id))),
    )
  ) {
    blockers.push('REJECTED_EVIDENCE_SUPPORTS_CLAIM')
  }

  const evidenceById = new Map(
    evidenceObjects
      .map((evidence) => [normalizeText(evidence?.evidenceObjectId), evidence])
      .filter(([id]) => Boolean(id)),
  )
  const ineligibleSectionEvidence = sections.flatMap((section) =>
    section.evidenceObjectIds.filter((id) => {
      const evidence = evidenceById.get(id)
      const scope = { sectionKey: section.sectionKey, use: 'SECTION_MAPPING' }
      const canonicalScope = { sectionKey: section.sectionKey, use: 'CANONICAL_REVISION' }
      const externalRestrictionBlocks = restrictions.some((restriction) => {
        const active =
          normalizeToken(restriction.status) === 'ACTIVE' ||
          normalizeToken(restriction.state) === 'RESTRICTED'
        const applies =
          (Array.isArray(restriction.evidenceObjectIds) &&
            restriction.evidenceObjectIds.map(normalizeText).includes(normalizeText(id))) ||
          (Array.isArray(restriction.sectionKeys) &&
            restriction.sectionKeys.map(normalizeText).includes(section.sectionKey))
        return (
          active &&
          applies &&
          (!restrictionAllows(restriction, scope) ||
            !restrictionAllows(restriction, canonicalScope))
        )
      })
      return (
        externalRestrictionBlocks ||
        !isEligibleEvidenceReference(evidence, scope) ||
        !isEligibleEvidenceReference(evidence, {
          sectionKey: section.sectionKey,
          use: 'CANONICAL_REVISION',
        })
      )
    }),
  )
  if (ineligibleSectionEvidence.length > 0) blockers.push('INELIGIBLE_EVIDENCE_SUPPORTS_SECTION')

  const malformedAcceptedObjects = acceptedObjects.filter(
    (accepted) =>
      !hasRef(accepted?.objectId) ||
      !DISCOVERY_ACCEPTED_OBJECT_TYPES.includes(normalizeToken(accepted?.objectType)) ||
      !VMF_OWNER_CODES.has(normalizeToken(accepted?.governingOwner)) ||
      !hasRef(accepted?.governingResultType),
  )
  if (malformedAcceptedObjects.length > 0) blockers.push('ACCEPTED_OBJECT_GOVERNANCE_MISSING')
  const acceptedObjectIds = new Set(
    acceptedObjects.map((accepted) => normalizeText(accepted?.objectId)).filter(Boolean),
  )
  const acceptedObjectsById = new Map(
    acceptedObjects
      .map((accepted) => [normalizeText(accepted?.objectId), accepted])
      .filter(([id]) => Boolean(id)),
  )
  const acceptedObjectsWithoutEvidence = acceptedObjects.filter(
    (accepted) =>
      !Array.isArray(accepted?.evidenceObjectIds) ||
      accepted.evidenceObjectIds.length === 0 ||
      accepted.evidenceObjectIds.some((id) => {
        const evidence = evidenceById.get(normalizeText(id))
        const restrictedByContract = restrictions.some((restriction) => {
          const active =
            normalizeToken(restriction.status) === 'ACTIVE' ||
            normalizeToken(restriction.state) === 'RESTRICTED'
          const applies =
            Array.isArray(restriction.evidenceObjectIds) &&
            restriction.evidenceObjectIds.map(normalizeText).includes(normalizeText(id))
          return active && applies && !restrictionAllows(restriction, { use: 'CANONICAL_REVISION' })
        })
        return (
          !evidence ||
          !locationIsPresent(evidence.sourceLocation) ||
          !hasRef(evidence.lineageRef) ||
          !isEligibleEvidenceReference(evidence, { use: 'CANONICAL_REVISION' }) ||
          restrictedByContract
        )
      }),
  )
  if (acceptedObjectsWithoutEvidence.length > 0) blockers.push('ACCEPTED_OBJECT_EVIDENCE_INVALID')
  const acceptedEvidenceWithoutObject = evidenceObjects.filter(
    (evidence) =>
      getEvidenceState(evidence) === 'ACCEPTED' &&
      (!hasRef(evidence.acceptedObjectRef) ||
        !acceptedObjectIds.has(normalizeText(evidence.acceptedObjectRef))),
  )
  if (acceptedEvidenceWithoutObject.length > 0)
    blockers.push('ACCEPTED_EVIDENCE_OBJECT_REFERENCE_MISSING')
  const acceptedEvidenceGovernanceMismatch = evidenceObjects.filter((evidence) => {
    if (getEvidenceState(evidence) !== 'ACCEPTED') return false
    const acceptedObject = acceptedObjectsById.get(normalizeText(evidence.acceptedObjectRef))
    return (
      !acceptedObject ||
      normalizeToken(evidence.acceptedObjectType) !== normalizeToken(acceptedObject.objectType) ||
      normalizeToken(evidence.governingOwner) !== normalizeToken(acceptedObject.governingOwner) ||
      normalizeToken(evidence.governingResultType) !==
        normalizeToken(acceptedObject.governingResultType)
    )
  })
  if (acceptedEvidenceGovernanceMismatch.length > 0)
    blockers.push('ACCEPTED_EVIDENCE_GOVERNANCE_MISMATCH')

  const missingSections = sections
    .filter(
      (section) =>
        section.required &&
        (!section.sectionKey ||
          !section.sufficient ||
          section.evidenceObjectIds.length === 0 ||
          section.reasoningArtifactRefs.length === 0 ||
          section.validationResultRefs.length === 0),
    )
    .map((section) => section.sectionKey || 'UNIDENTIFIED_REQUIRED_SECTION')
  if (missingSections.length > 0) blockers.push('REQUIRED_SECTION_INSUFFICIENT')

  const unresolvedMaterialContradictions = contradictions
    .filter((item) => item?.material === true && normalizeToken(item.status) !== 'RESOLVED')
    .map((item) => normalizeText(item.contradictionId) || 'UNIDENTIFIED_MATERIAL_CONTRADICTION')
  if (
    contradictions.some(
      (item) => normalizeToken(item.governingOwner) !== 'CR' || !hasRef(item.governingResultType),
    )
  ) {
    blockers.push('CONTRADICTION_GOVERNANCE_MISSING')
  }
  if (unresolvedMaterialContradictions.length > 0)
    blockers.push('MATERIAL_CONTRADICTION_UNRESOLVED')

  const activeRestrictionRefs = restrictions
    .filter(
      (item) =>
        normalizeToken(item.status) === 'ACTIVE' || normalizeToken(item.state) === 'RESTRICTED',
    )
    .map((item) => normalizeText(item.restrictionId))
    .filter(Boolean)
    .concat(
      evidenceObjects
        .filter(
          (evidence) =>
            getEvidenceState(evidence) === 'RESTRICTED' ||
            normalizeToken(evidence.restrictionState) === 'RESTRICTED',
        )
        .map((evidence) => normalizeText(evidence.restrictionId))
        .filter(Boolean),
    )
  const activeRestrictions = restrictions.filter(
    (item) =>
      normalizeToken(item.status) === 'ACTIVE' || normalizeToken(item.state) === 'RESTRICTED',
  )
  if (
    activeRestrictions.some(
      (item) => normalizeToken(item.governingOwner) !== 'EC' || !hasRef(item.governingResultType),
    )
  ) {
    blockers.push('RESTRICTION_GOVERNANCE_MISSING')
  }
  if (
    activeRestrictions.some(
      (item) =>
        !hasRef(item.restrictionId) ||
        !Array.isArray(item.allowedUses) ||
        item.allowedUses.length === 0,
    )
  ) {
    blockers.push('RESTRICTION_ID_OR_SCOPE_MISSING')
  }
  const restrictedClaims = materialClaims
    .filter((claim) =>
      restrictions.some(
        (restriction) =>
          (normalizeToken(restriction.status) === 'ACTIVE' ||
            normalizeToken(restriction.state) === 'RESTRICTED') &&
          Array.isArray(restriction.claimIds) &&
          restriction.claimIds.map(normalizeText).includes(normalizeText(claim.claimId)) &&
          !restrictionAllows(restriction, { claimId: claim.claimId, use: 'CANONICAL_REVISION' }),
      ),
    )
    .map((claim) => normalizeText(claim.claimId))
  if (restrictedClaims.length > 0) blockers.push('RESTRICTED_MATERIAL_CLAIM')

  const requiredRefs = {
    validation_result_refs: Array.isArray(input.validation_result_refs)
      ? input.validation_result_refs
      : [],
    authorization_dependency_refs: Array.isArray(input.authorization_dependency_refs)
      ? input.authorization_dependency_refs
      : [],
    lineage_refs: Array.isArray(input.lineage_refs) ? input.lineage_refs : [],
    audit_references: Array.isArray(input.audit_refs) ? input.audit_refs : [],
  }
  Object.entries(requiredRefs).forEach(([key, refs]) => {
    if (refs.length === 0 || refs.some((ref) => !hasRef(ref)))
      unresolved.push(key.toUpperCase() + '_MISSING')
  })
  if (
    evidenceObjects.some((evidence) =>
      ['ADMITTED', 'ACCEPTED', 'REJECTED', 'CORRECTED', 'RESTRICTED'].includes(
        getEvidenceState(evidence),
      ) && !hasRef(evidence.auditRef),
    )
  ) {
    unresolved.push('EVIDENCE_AUDIT_REFERENCE_MISSING')
  }

  const lockState = normalizeToken(lock.state) || 'UNLOCKED'
  if (lockState === 'LOCKED' && (lock.locked !== true || lock.canonicalOutputEligible !== true)) {
    blockers.push('LOCK_STATE_INCONSISTENT')
  }
  if (
    lockState === 'LOCKED' &&
    (!hasRef(lock.snapshot_id) ||
      !isHash(lock.snapshot_hash) ||
      !hasRef(lock.replay_anchor_id) ||
      !isHash(lock.replay_anchor_hash))
  ) {
    unresolved.push('LOCK_OR_REPLAY_REFERENCE_MISSING')
  }

  const readinessState =
    unresolved.length > 0
      ? CANONICAL_REVISION_READINESS.UNRESOLVED
      : blockers.length > 0
        ? CANONICAL_REVISION_READINESS.NOT_READY
        : CANONICAL_REVISION_READINESS.READY

  const payload = {
    contract_version: DISCOVERY_READINESS_CONTRACT_VERSION,
    revision_id: normalizeText(input.revision_id),
    runtime_instance_id: normalizeText(input.runtime_instance_id),
    predecessor_revision_id: normalizeText(input.predecessor_revision_id),
    framework_id: normalizeText(input.framework_id),
    vmf_identity: {
      framework_key: normalizeToken(policy.identity?.frameworkKey),
      methodology_version: normalizeText(input.vmf_methodology_version),
      runtime_composition_refs: [...(input.vmf_runtime_composition_refs || [])]
        .map(normalizeText)
        .filter(Boolean)
        .sort(),
    },
    source_state_version: normalizeText(input.source_state_version),
    storylineos_package: {
      ...packageIdentity,
    },
    discovery_policy: {
      key: normalizeText(policy.policyKey),
      version: normalizeText(policy.policyVersion),
      hash: normalizeText(policy.policyHash),
      identity: stableValue(policy.identity || {}),
    },
    evidence_snapshot: {
      snapshot_id: normalizeText(evidenceSnapshot.snapshot_id),
      fingerprint: normalizeText(evidenceSnapshot.fingerprint),
      evidence_object_refs: evidenceIds.slice().sort(),
      evidence_states: evidenceObjects
        .map((item) => ({
          evidence_object_id: normalizeText(item.evidenceObjectId),
          source_id: normalizeText(item.sourceId),
          state: getEvidenceState(item),
          governing_owner: normalizeToken(item.governingOwner),
          governing_result_type: normalizeToken(item.governingResultType),
          accepted_object_type: normalizeToken(item.acceptedObjectType),
          accepted_object_ref: normalizeText(item.acceptedObjectRef),
          source_location: isObject(item.sourceLocation)
            ? stableValue(item.sourceLocation)
            : normalizeText(item.sourceLocation),
          lineage_ref: normalizeText(item.lineageRef),
          predecessor_evidence_ref: normalizeText(item.predecessorEvidenceRef),
          disposition_reason: normalizeText(item.dispositionReason),
          restriction_id: normalizeText(item.restrictionId),
          restriction_state: normalizeToken(item.restrictionState),
          restriction_scope: isObject(item.restrictionScope)
            ? stableValue(item.restrictionScope)
            : {},
          reviewer_ref: normalizeText(item.reviewerRef),
          audit_ref: normalizeText(item.auditRef),
          audit_refs: [...new Set([
            ...(Array.isArray(item.auditRefs) ? item.auditRefs : []),
            item.auditRef,
          ].map(normalizeText).filter(Boolean))].sort(),
          currentness_state: normalizeToken(item.currentnessState || 'CURRENT'),
        }))
        .sort((left, right) => left.evidence_object_id.localeCompare(right.evidence_object_id)),
    },
    graph_snapshot: {
      snapshot_id: normalizeText(graph.snapshot_id),
      version: normalizeText(graph.version),
      hash: normalizeText(graph.hash),
      source_hash: normalizeText(graph.source_hash),
      build_trigger: normalizeToken(graph.build_trigger),
      built_at: normalizeText(graph.built_at),
      audit_ref: normalizeText(graph.audit_ref),
      currentness: normalizeToken(graph.currentness),
      validation: normalizeToken(graph.validation),
    },
    sections,
    validation_result_refs: requiredRefs.validation_result_refs
      .map(normalizeText)
      .filter(Boolean)
      .sort(),
    accepted_object_refs: acceptedObjects
      .map((item) => ({
        object_id: normalizeText(item.objectId),
        object_type: normalizeToken(item.objectType),
        governing_owner: normalizeToken(item.governingOwner),
        governing_result_type: normalizeToken(item.governingResultType),
        evidence_object_ids: Array.isArray(item.evidenceObjectIds)
          ? item.evidenceObjectIds.map(normalizeText).filter(Boolean).sort()
          : [],
      }))
      .sort((left, right) => left.object_id.localeCompare(right.object_id)),
    material_claim_refs: materialClaims
      .map((claim) => ({
        claim_id: normalizeText(claim.claimId),
        material: claim.material === true,
        evidence_object_ids: Array.isArray(claim.evidenceObjectIds)
          ? claim.evidenceObjectIds.map(normalizeText).filter(Boolean).sort()
          : [],
      }))
      .sort((left, right) => left.claim_id.localeCompare(right.claim_id)),
    contradiction_state_refs: contradictions
      .map((item) => ({
        contradiction_id: normalizeText(item.contradictionId),
        material: item.material === true,
        status: normalizeToken(item.status),
        governing_owner: normalizeToken(item.governingOwner),
        governing_result_type: normalizeToken(item.governingResultType),
        evidence_object_ids: Array.isArray(item.evidenceObjectIds)
          ? item.evidenceObjectIds.map(normalizeText).filter(Boolean).sort()
          : [],
        affected_claim_ids: Array.isArray(item.affectedClaimIds)
          ? item.affectedClaimIds.map(normalizeText).filter(Boolean).sort()
          : [],
        affected_section_keys: Array.isArray(item.affectedSectionKeys)
          ? item.affectedSectionKeys.map(normalizeText).filter(Boolean).sort()
          : [],
        reasoning_artifact_refs: Array.isArray(item.reasoningArtifactRefs)
          ? item.reasoningArtifactRefs.map(normalizeText).filter(Boolean).sort()
          : [],
      }))
      .sort((left, right) => left.contradiction_id.localeCompare(right.contradiction_id)),
    restriction_refs: [...new Set(activeRestrictionRefs)].sort(),
    restriction_state_refs: activeRestrictions
      .map((item) => ({
        restriction_id: normalizeText(item.restrictionId),
        state: normalizeToken(item.state || item.status),
        governing_owner: normalizeToken(item.governingOwner),
        governing_result_type: normalizeToken(item.governingResultType),
        evidence_object_ids: Array.isArray(item.evidenceObjectIds)
          ? item.evidenceObjectIds.map(normalizeText).filter(Boolean).sort()
          : [],
        claim_ids: Array.isArray(item.claimIds)
          ? item.claimIds.map(normalizeText).filter(Boolean).sort()
          : [],
        section_keys: Array.isArray(item.sectionKeys)
          ? item.sectionKeys.map(normalizeText).filter(Boolean).sort()
          : [],
        allowed_uses: Array.isArray(item.allowedUses)
          ? item.allowedUses.map(normalizeToken).filter(Boolean).sort()
          : [],
        owner_action: normalizeText(item.ownerAction || item.action),
        audit_ref: normalizeText(item.auditRef),
      }))
      .sort((left, right) => left.restriction_id.localeCompare(right.restriction_id)),
    authorization_dependency_refs: requiredRefs.authorization_dependency_refs
      .map(normalizeText)
      .filter(Boolean)
      .sort(),
    lock: {
      state: lockState,
      snapshot_id: normalizeText(lock.snapshot_id),
      snapshot_hash: normalizeText(lock.snapshot_hash),
      replay_anchor_id: normalizeText(lock.replay_anchor_id),
      replay_anchor_hash: normalizeText(lock.replay_anchor_hash),
      canonical_output_eligible: lock.canonicalOutputEligible === true,
    },
    publication_state: normalizeToken(publication.state || 'UNPUBLISHED'),
    availability_state: normalizeToken(availability.state || 'UNAVAILABLE'),
    currentness_state: currentnessState,
    created_at: normalizeText(input.created_at),
    locked_at: normalizeText(input.locked_at),
    published_at: normalizeText(input.published_at),
    lineage_refs: requiredRefs.lineage_refs.map(normalizeText).filter(Boolean).sort(),
    audit_refs: [...new Set(requiredRefs.audit_references.map(normalizeText).filter(Boolean))].sort(),
    readiness: {
      state: readinessState,
      blockers: [...new Set(blockers)].sort(),
      unresolved: [...new Set(unresolved)].sort(),
      unsupported_material_claims: unsupportedClaims,
      missing_required_sections: missingSections,
      unresolved_material_contradictions: unresolvedMaterialContradictions,
      restricted_material_claims: restrictedClaims,
    },
    evaluated_at: normalizeText(input.evaluated_at),
  }
  payload.reference_fingerprint = hashValue(buildCanonicalReferenceSet(payload))
  const contentHash = hashValue(payload)
  return {
    ...payload,
    content_hash: contentHash,
  }
}

export const buildArlReadinessSummary = ({
  canonicalReadiness,
  graphSnapshot = {},
  identityResolved = false,
  materialGaps = [],
  boundedGaps = [],
  contradictions = [],
  discoveryQuestions = [],
} = {}) => {
  const normalizedBoundedGaps = boundedGaps.map((gap) =>
    isObject(gap)
      ? {
          code: normalizeText(gap.code),
          description: normalizeText(gap.description),
          owner: normalizeToken(gap.owner),
          action: normalizeText(gap.action),
        }
      : { code: '', description: normalizeText(gap), owner: '', action: '' },
  )
  const nonMaterialContradictions = contradictions.filter(
    (item) => item?.material !== true && normalizeToken(item.status) !== 'RESOLVED',
  )
  const blockingGraph =
    normalizeToken(graphSnapshot.currentness) !== 'CURRENT' ||
    normalizeToken(graphSnapshot.validation) !== 'VALID'
  const canonicalState = normalizeToken(canonicalReadiness?.readiness?.state)
  const unresolvedMaterialContradiction = contradictions.some(
    (item) => item?.material === true && normalizeToken(item.status) !== 'RESOLVED',
  )
  let state = ARL_READINESS.READY
  if (
    !identityResolved ||
    blockingGraph ||
    canonicalState === CANONICAL_REVISION_READINESS.UNRESOLVED
  )
    state = ARL_READINESS.BLOCKED
  else if (
    materialGaps.length > 0 ||
    unresolvedMaterialContradiction ||
    (canonicalReadiness?.readiness?.blockers?.length || 0) > 0
  )
    state = ARL_READINESS.REWORK
  else if (normalizedBoundedGaps.length > 0 || nonMaterialContradictions.length > 0) {
    const boundedConditionsHaveOwners =
      normalizedBoundedGaps.every((gap) => gap.owner && gap.action) &&
      nonMaterialContradictions.every(
        (item) =>
          normalizeToken(item.governingOwner) === 'CR' &&
          hasRef(item.governingResultType) &&
          hasRef(item.ownerAction || item.resolutionAction),
      )
    state = boundedConditionsHaveOwners ? ARL_READINESS.CONDITIONAL : ARL_READINESS.REWORK
  }

  return {
    contract_version: DISCOVERY_READINESS_CONTRACT_VERSION,
    state,
    downstream_use: [ARL_READINESS.READY, ARL_READINESS.CONDITIONAL].includes(state)
      ? 'ARL_REVIEW_ONLY'
      : 'NONE',
    canonical_revision_id: normalizeText(canonicalReadiness?.revision_id),
    canonical_revision_content_hash: normalizeText(canonicalReadiness?.content_hash),
    canonical_readiness_state: normalizeToken(canonicalReadiness?.readiness?.state),
    material_gaps: [...new Set(materialGaps.map(normalizeText).filter(Boolean))].sort(),
    bounded_gaps: normalizedBoundedGaps.sort(
      (left, right) =>
        left.code.localeCompare(right.code) || left.description.localeCompare(right.description),
    ),
    contradictions: contradictions
      .map((item) => ({
        contradiction_id: normalizeText(item.contradictionId),
        material: item.material === true,
        status: normalizeToken(item.status),
        governing_owner: normalizeToken(item.governingOwner || 'CR'),
        governing_result_type: normalizeToken(item.governingResultType),
        owner_action: normalizeText(item.ownerAction || item.resolutionAction),
        evidence_object_ids: Array.isArray(item.evidenceObjectIds)
          ? item.evidenceObjectIds.map(normalizeText).filter(Boolean).sort()
          : [],
        affected_claim_ids: Array.isArray(item.affectedClaimIds)
          ? item.affectedClaimIds.map(normalizeText).filter(Boolean).sort()
          : [],
        affected_section_keys: Array.isArray(item.affectedSectionKeys)
          ? item.affectedSectionKeys.map(normalizeText).filter(Boolean).sort()
          : [],
        reasoning_artifact_refs: Array.isArray(item.reasoningArtifactRefs)
          ? item.reasoningArtifactRefs.map(normalizeText).filter(Boolean).sort()
          : [],
      }))
      .sort((left, right) => left.contradiction_id.localeCompare(right.contradiction_id)),
    restrictions: (canonicalReadiness?.restriction_refs || []).slice(),
    restriction_state_refs: (canonicalReadiness?.restriction_state_refs || []).map((item) =>
      stableValue(item),
    ),
    discovery_questions: [...new Set(discoveryQuestions.map(normalizeText).filter(Boolean))].sort(),
  }
}

export const projectLatestReadinessSummary = (canonicalReadiness, arlSummary) => ({
  contract_version: DISCOVERY_READINESS_CONTRACT_VERSION,
  mode: 'LATEST_SUMMARY',
  authoritative: false,
  source_revision_id: normalizeText(canonicalReadiness?.revision_id),
  canonical_readiness_state: normalizeToken(canonicalReadiness?.readiness?.state),
  arl_readiness_state: normalizeToken(arlSummary?.state),
  canonical_output_eligible: false,
})

export const resolveExactCanonicalRevision = ({
  requestedRuntimeInstanceId,
  requestedRevisionId,
  canonicalReadiness,
  requestedContentHash,
} = {}) => {
  const requestedRuntime = normalizeText(requestedRuntimeInstanceId).toLowerCase()
  const requested = normalizeText(requestedRevisionId)
  if (!requestedRuntime) {
    return {
      status: 'BLOCKED',
      reason: 'EXACT_RUNTIME_INSTANCE_ID_REQUIRED',
      canonical_output_eligible: false,
    }
  }
  if (!requested) {
    return {
      status: 'BLOCKED',
      reason: 'EXACT_REVISION_ID_REQUIRED',
      canonical_output_eligible: false,
    }
  }
  if (requested !== normalizeText(canonicalReadiness?.revision_id)) {
    return {
      status: 'BLOCKED',
      reason: 'REVISION_ID_MISMATCH',
      canonical_output_eligible: false,
    }
  }
  if (requestedRuntime !== normalizeText(canonicalReadiness?.runtime_instance_id).toLowerCase()) {
    return {
      status: 'BLOCKED',
      reason: 'RUNTIME_INSTANCE_MISMATCH',
      revision_id: requested,
      canonical_output_eligible: false,
    }
  }
  const { content_hash: recordedContentHash, ...payload } = canonicalReadiness || {}
  const computedContentHash = isObject(payload) ? hashValue(payload) : ''
  if (
    !isHash(recordedContentHash) ||
    computedContentHash !== recordedContentHash ||
    (hasRef(requestedContentHash) && normalizeText(requestedContentHash) !== recordedContentHash)
  ) {
    return {
      status: 'BLOCKED',
      reason: 'REVISION_CONTENT_INTEGRITY_MISMATCH',
      revision_id: requested,
      canonical_output_eligible: false,
    }
  }
  if (
    !isHash(payload.reference_fingerprint) ||
    hashValue(buildCanonicalReferenceSet(payload)) !== payload.reference_fingerprint
  ) {
    return {
      status: 'BLOCKED',
      reason: 'REVISION_REFERENCE_INTEGRITY_MISMATCH',
      revision_id: requested,
      canonical_output_eligible: false,
    }
  }
  if (
    normalizeToken(canonicalReadiness?.readiness?.state) !== CANONICAL_REVISION_READINESS.READY ||
    canonicalReadiness?.lock?.canonical_output_eligible !== true ||
    normalizeToken(canonicalReadiness?.lock?.state) !== 'LOCKED'
  ) {
    return {
      status: 'BLOCKED',
      reason: 'EXACT_REVISION_NOT_READY_OR_LOCKED',
      revision_id: requested,
      canonical_output_eligible: false,
    }
  }
  return {
    status: 'READY',
    revision_id: requested,
    content_hash: recordedContentHash,
    reference_fingerprint: payload.reference_fingerprint,
    canonical_output_eligible: true,
  }
}

export const resolveOutcomeStudioCanonicalBinding = async ({
  requestedRuntimeInstanceId,
  requestedRevisionId,
  revisionResolver,
} = {}) => {
  const requestedRuntime = normalizeText(requestedRuntimeInstanceId).toLowerCase()
  const requested = normalizeText(requestedRevisionId)
  if (!requestedRuntime) {
    return resolveExactCanonicalRevision({
      requestedRuntimeInstanceId: requestedRuntime,
      requestedRevisionId: requested,
    })
  }
  if (!requested) {
    return resolveExactCanonicalRevision({
      requestedRuntimeInstanceId: requestedRuntime,
      requestedRevisionId: requested,
    })
  }
  if (typeof revisionResolver !== 'function') {
    return {
      status: 'BLOCKED',
      reason: 'EXACT_REVISION_RESOLVER_REQUIRED',
      canonical_output_eligible: false,
    }
  }
  const resolvedRevision = await revisionResolver({
    runtimeInstanceId: requestedRuntime,
    revisionId: requested,
  })
  if (!resolvedRevision) {
    return {
      status: 'BLOCKED',
      reason: 'EXACT_REVISION_LOOKUP_MISMATCH',
      canonical_output_eligible: false,
    }
  }
  if (normalizeText(resolvedRevision?.runtimeInstanceId).toLowerCase() !== requestedRuntime) {
    return {
      status: 'BLOCKED',
      reason: 'RUNTIME_INSTANCE_LOOKUP_MISMATCH',
      revision_id: requested,
      canonical_output_eligible: false,
    }
  }
  const canonicalReadiness = resolvedRevision?.canonicalReadiness
  const arlReadinessSummary = resolvedRevision?.arlReadinessSummary
  if (!canonicalReadiness || normalizeText(canonicalReadiness.revision_id) !== requested) {
    return {
      status: 'BLOCKED',
      reason: 'EXACT_REVISION_LOOKUP_MISMATCH',
      canonical_output_eligible: false,
    }
  }
  if (
    normalizeToken(arlReadinessSummary?.contract_version) !==
      normalizeToken(DISCOVERY_READINESS_CONTRACT_VERSION) ||
    normalizeText(arlReadinessSummary?.canonical_revision_id) !== requested ||
    normalizeText(arlReadinessSummary?.canonical_revision_content_hash) !==
      normalizeText(canonicalReadiness.content_hash) ||
    normalizeToken(arlReadinessSummary?.downstream_use) !== 'ARL_REVIEW_ONLY'
  ) {
    return {
      status: 'BLOCKED',
      reason: 'EXACT_REVISION_READINESS_BINDING_MISMATCH',
      revision_id: requested,
      canonical_output_eligible: false,
    }
  }
  if (normalizeToken(arlReadinessSummary.state) !== ARL_READINESS.READY) {
    return {
      status: 'BLOCKED',
      reason: 'ARL_READINESS_NOT_READY_FOR_CANONICAL_USE',
      revision_id: requested,
      arl_readiness_state: normalizeToken(arlReadinessSummary.state),
      canonical_output_eligible: false,
    }
  }
  return {
    consumer: 'OUTCOME_STUDIO',
    ...resolveExactCanonicalRevision({
      requestedRuntimeInstanceId: requestedRuntime,
      requestedRevisionId: requested,
      canonicalReadiness,
    }),
    canonical_readiness: canonicalReadiness,
    arl_readiness_summary: arlReadinessSummary,
  }
}

export const projectDraftOutcomeStudioConsumption = ({ draftId, sourceRevisionId } = {}) => ({
  mode: 'DRAFT',
  draft_id: normalizeText(draftId),
  source_revision_id: normalizeText(sourceRevisionId),
  canonical: false,
  authoritative: false,
  canonical_output_eligible: false,
})

export const dispositionPostLockDiscovery = ({
  lockedRevisionId,
  lock = {},
  evidenceObjectId,
  eventRef,
  auditRef,
  impact,
} = {}) => {
  const revisionId = normalizeText(lockedRevisionId)
  if (
    !revisionId ||
    normalizeToken(lock.state) !== 'LOCKED' ||
    lock.locked !== true ||
    !hasRef(lock.snapshot_id) ||
    !isHash(lock.snapshot_hash)
  ) {
    return {
      status: 'BLOCKED',
      reason: 'LOCKED_REVISION_IDENTITY_REQUIRED',
      locked_body_mutated: false,
      successor_created: false,
    }
  }
  if (!hasRef(evidenceObjectId) || !hasRef(eventRef) || !hasRef(auditRef)) {
    return {
      status: 'UNRESOLVED',
      reason: 'POST_LOCK_DISCOVERY_AUDIT_REFERENCES_REQUIRED',
      locked_revision_id: revisionId,
      locked_body_mutated: false,
      successor_created: false,
    }
  }
  const dispositionByImpact = {
    NONE: POST_LOCK_DISCOVERY_DISPOSITIONS.NO_REVISION_IMPACT,
    CORROBORATIVE: POST_LOCK_DISCOVERY_DISPOSITIONS.CORROBORATIVE,
    MATERIAL: POST_LOCK_DISCOVERY_DISPOSITIONS.SUCCESSOR_REVISION_REQUIRED,
    MATERIAL_TRUTH_CHANGE: POST_LOCK_DISCOVERY_DISPOSITIONS.SUCCESSOR_REVISION_REQUIRED,
    UNKNOWN: POST_LOCK_DISCOVERY_DISPOSITIONS.CURRENTNESS_REVIEW_REQUIRED,
    CURRENTNESS_UNCERTAIN: POST_LOCK_DISCOVERY_DISPOSITIONS.CURRENTNESS_REVIEW_REQUIRED,
  }
  const disposition = dispositionByImpact[normalizeToken(impact)]
  if (!disposition) {
    return {
      status: 'UNRESOLVED',
      reason: 'POST_LOCK_DISCOVERY_IMPACT_UNRESOLVED',
      locked_revision_id: revisionId,
      locked_body_mutated: false,
      successor_created: false,
    }
  }
  return {
    status: 'DISPOSITIONED',
    locked_revision_id: revisionId,
    lock_snapshot_id: normalizeText(lock.snapshot_id),
    lock_snapshot_hash: normalizeText(lock.snapshot_hash),
    evidence_object_id: normalizeText(evidenceObjectId),
    event_ref: normalizeText(eventRef),
    audit_ref: normalizeText(auditRef),
    disposition,
    locked_body_mutated: false,
    successor_created: false,
    successor_creation: 'NOT_AUTOMATIC',
  }
}
