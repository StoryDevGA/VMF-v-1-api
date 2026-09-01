import { createHash } from 'node:crypto'

import { FrameworkPackage } from '../models/index.js'
import auditService from './auditService.js'
import { getRuntimeInstance } from './runtimeInstanceService.js'
import { resolveOutcomeStudioKnowledgePackBinding } from './outcomeKnowledgePackRegistryService.js'
import { resolveOutcomeStudioKnowledgeContext } from './outcomeStudioKnowledgeContextService.js'

export const FRAMEWORK_OUTCOME_HANDOFF_CONTRACT_VERSION =
  'ss-011.framework-to-outcome-studio.evidence-to-knowledge.v1'
export const FRAMEWORK_OUTCOME_HANDOFF_POLICY_VERSION = 'ss-011.claim-boundary-policy.v1'

export const FRAMEWORK_OUTCOME_HANDOFF_STATUSES = Object.freeze({
  READY: 'READY',
  READY_WITH_GAPS: 'READY_WITH_GAPS',
  BLOCKED: 'BLOCKED',
})

export const FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_POLICY_VERSION =
  'ss-014.runtime-state-v2.handoff-dependencies.v1'

export const FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_COMMANDS = Object.freeze({
  CONTROL: 'HANDOFF_CONTROL_READ',
  FRAMEWORK_PACKAGE: 'HANDOFF_FRAMEWORK_PACKAGE_READ',
  KNOWLEDGE_ACTIVATION: 'HANDOFF_KNOWLEDGE_ACTIVATION_READ',
  KNOWLEDGE_VERSION: 'HANDOFF_KNOWLEDGE_VERSION_READ',
  RENDERER_CAPABILITY: 'HANDOFF_RENDERER_CAPABILITY_READ',
})

export const FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY = Object.freeze({
  policyVersion: FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_POLICY_VERSION,
  maxTimeMS: 2000,
  packageLimit: 2,
  activationLimit: 501,
  versionLimit: 501,
  commandIds: Object.freeze(Object.values(FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_COMMANDS)),
})

export const FRAMEWORK_OUTCOME_HANDOFF_V2_PARITY_CONTRACT_VERSION =
  'ss-014.runtime-state-v2.handoff-state-parity.v1'

const FRAMEWORK_PACKAGE_BOUNDED_PROJECTION = [
  '_id',
  'packageKey',
  'version',
  'frameworkKey',
  'status',
  'visibility',
  'customerAccessMode',
  'assignedCustomerIds',
  'sections.sectionKey',
  'sections.runtimePath',
  'sections.required',
  'sections.notes',
].join(' ')

const RUNTIME_STATE_V2_CONTROL_PROJECTION_FIELDS = Object.freeze([
  '_id',
  'runtimeInstanceKey',
  'customerId',
  'tenantId',
  'workspaceId',
  'runtimeType',
  'frameworkKey',
  'packageId',
  'packageKey',
  'packageVersion',
  'dependencyLockId',
  'activationId',
  'deploymentId',
  'evidence.dependencySnapshotId',
  'evidence.dependencySnapshotHash',
  'status',
  'executionStatus',
  'runtimeMode',
  'name',
  'description',
  'lockedAt',
  'lockedBy',
  'lockedReason',
  'revision.revisionNumber',
  'stateVersion',
  'runtimeStateVersion',
  'createdAt',
  'updatedAt',
])

const FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_RECEIPT_MAX_DEPENDENCIES = 8
const FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_RECEIPT_MAX_PROJECTION_FIELDS = 64

export const FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES = Object.freeze({
  RUNTIME_REQUIRED: 'HANDOFF_RUNTIME_REQUIRED',
  RUNTIME_NOT_LOCKED: 'HANDOFF_RUNTIME_NOT_LOCKED',
  RUNTIME_NOT_PUBLISHED: 'HANDOFF_RUNTIME_NOT_PUBLISHED',
  OUTPUT_ELIGIBILITY_MISSING: 'HANDOFF_OUTPUT_ELIGIBILITY_MISSING',
  LOCK_SNAPSHOT_MISSING: 'HANDOFF_LOCK_SNAPSHOT_MISSING',
  REPLAY_ANCHOR_MISSING: 'HANDOFF_REPLAY_ANCHOR_MISSING',
  PACKAGE_REQUIRED_SECTION_BINDING_MISSING: 'HANDOFF_PACKAGE_REQUIRED_SECTION_BINDING_MISSING',
  PACKAGE_REQUIRED_SECTION_MISSING: 'HANDOFF_PACKAGE_REQUIRED_SECTION_MISSING',
  PACKAGE_IDENTITY_MISMATCH: 'HANDOFF_PACKAGE_IDENTITY_MISMATCH',
  SECTION_TRUTH_MISSING: 'HANDOFF_SECTION_TRUTH_MISSING',
  PROJECTION_RECEIPT_MISSING: 'HANDOFF_PROJECTION_RECEIPT_MISSING',
  PROJECTION_RECEIPT_INCONSISTENT: 'HANDOFF_PROJECTION_RECEIPT_INCONSISTENT',
  EVIDENCE_REF_UNRESOLVED: 'HANDOFF_EVIDENCE_REF_UNRESOLVED',
  EVIDENCE_REF_NOT_ACCEPTED: 'HANDOFF_EVIDENCE_REF_NOT_ACCEPTED',
  KNOWLEDGE_RESOLUTION_MISSING: 'HANDOFF_KNOWLEDGE_RESOLUTION_MISSING',
  KNOWLEDGE_BINDING_BLOCKED: 'HANDOFF_KNOWLEDGE_BINDING_BLOCKED',
  KNOWLEDGE_CONTEXT_MISSING: 'HANDOFF_KNOWLEDGE_CONTEXT_MISSING',
  KNOWLEDGE_CONTEXT_BLOCKED: 'HANDOFF_KNOWLEDGE_CONTEXT_BLOCKED',
  HANDOFF_INTEGRITY_INVALID: 'HANDOFF_INTEGRITY_INVALID',
  HANDOFF_CURRENTNESS_STALE: 'HANDOFF_CURRENTNESS_STALE',
  HANDOFF_RESOLUTION_FAILED: 'HANDOFF_RESOLUTION_FAILED',
})

export const FRAMEWORK_OUTCOME_CLAIM_TYPES = Object.freeze([
  'QUANTIFIED_CLAIMS',
  'ROI_CLAIMS',
  'FINANCIAL_IMPACT_CLAIMS',
  'CUSTOMER_PROOF',
  'NAMED_CUSTOMER_CLAIMS',
])

const READY_KNOWLEDGE_STATUSES = new Set(['PROJECTED', 'READY', 'READY_WITH_GAPS'])
const ACCEPTED_EVIDENCE_STATES = new Set(['ACCEPTED', 'SECTION_RECEIPT_ACCEPTED', 'PROJECTION_RECEIPT_ACCEPTED'])
const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeKey = (value) => normalizeText(value)
  .replace(/^framework_state\.sections\./i, '')
  .replace(/-/g, '_')
  .toLowerCase()
const toIdString = (value) => normalizeText(value?.toString?.() || value)
const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const uniqueSorted = (values = []) => [...new Set(values.map(normalizeText).filter(Boolean))].sort()
const sha256 = (value) => `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`

const createBoundedHandoffError = (message, code = 'HANDOFF_BOUNDED_DEPENDENCY_UNAVAILABLE') => {
  const error = new Error(message)
  error.code = code
  return error
}

const validateBoundedHandoffPolicy = (policy) => {
  if (!policy || policy.policyVersion !== FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_POLICY_VERSION
    || policy.maxTimeMS !== 2000
    || policy.packageLimit !== 2
    || policy.activationLimit !== 501
    || policy.versionLimit !== 501
    || !Array.isArray(policy.commandIds)
    || policy.commandIds.length !== Object.values(FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_COMMANDS).length
    || [...policy.commandIds].sort().join('|')
      !== [...Object.values(FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_COMMANDS)].sort().join('|')) {
    throw createBoundedHandoffError('The bounded handoff dependency policy is invalid.', 'HANDOFF_BOUNDED_POLICY_INVALID')
  }
  return FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_READ_POLICY
}

const validateBoundedStateParityReceipt = ({ receipt, runtimeInstance } = {}) => {
  const frameworkState = getFrameworkState(runtimeInstance || {})
  const sectionKeys = getSectionsEntries(frameworkState)
    .map(([sectionKey]) => normalizeKey(sectionKey))
    .filter(Boolean)
    .sort()
  const evidenceObjects = getEvidenceObjects(frameworkState).evidenceObjects
  const runtimeStateVersion = normalizeText(runtimeInstance?.stateVersion)
  const receiptSectionKeys = Array.isArray(receipt?.sectionKeys)
    ? receipt.sectionKeys.map(normalizeKey).filter(Boolean).sort()
    : []
  if (normalizeText(receipt?.contractVersion) !== FRAMEWORK_OUTCOME_HANDOFF_V2_PARITY_CONTRACT_VERSION
    || !runtimeStateVersion
    || normalizeText(receipt?.stateVersion) !== runtimeStateVersion
    || Number(receipt?.sectionCount) !== sectionKeys.length
    || Number(receipt?.evidenceObjectCount) !== evidenceObjects.length
    || receiptSectionKeys.join('|') !== sectionKeys.join('|')
    || normalizeText(receipt?.stateDigest) !== buildFrameworkOutcomeHandoffV2ParityDigest(runtimeInstance)) {
    throw createBoundedHandoffError(
      'The bounded Runtime State V2 handoff parity receipt is invalid.',
      'HANDOFF_BOUNDED_STATE_PARITY_INVALID',
    )
  }
  return receipt
}

const buildBoundedDependencyReceipt = ({ policy, dependencies = [] } = {}) => ({
  policyVersion: policy.policyVersion,
  dependencies: dependencies
    .slice(0, FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_RECEIPT_MAX_DEPENDENCIES)
    .map((dependency) => ({
      dependencyKey: normalizeText(dependency.dependencyKey),
      commandKey: normalizeText(dependency.commandKey),
      maxTimeMS: Number(dependency.maxTimeMS || policy.maxTimeMS),
      limit: dependency.limit === null || dependency.limit === undefined
        ? null
        : Number(dependency.limit),
      sortKeys: Array.isArray(dependency.sortKeys)
        ? dependency.sortKeys.slice(0, 8).map(normalizeText).filter(Boolean)
        : [],
      projectionFields: Array.isArray(dependency.projectionFields)
        ? dependency.projectionFields
          .slice(0, FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_RECEIPT_MAX_PROJECTION_FIELDS)
          .map(normalizeText)
          .filter(Boolean)
        : [],
      resultCount: Number(dependency.resultCount || 0),
      overflowed: dependency.overflowed === true,
      providerAccessed: false,
      networkAccessed: false,
      fullRuntimeFetched: false,
    })),
  providerAccessed: false,
  networkAccessed: false,
  fullRuntimeFetched: false,
})

const isFrameworkPackageAccessibleToCustomer = ({ frameworkPackage, customerId } = {}) => {
  const visibility = normalizeToken(frameworkPackage?.visibility)
  const accessMode = normalizeToken(frameworkPackage?.customerAccessMode)
  const normalizedCustomerId = normalizeText(customerId)
  if (visibility === 'INTERNAL_ONLY') return false
  if (visibility !== 'CUSTOMER_VISIBLE' || !normalizedCustomerId) return false
  if (accessMode === 'ALL_CUSTOMERS') return true
  if (accessMode === 'SELECTED_CUSTOMERS') {
    return Array.isArray(frameworkPackage?.assignedCustomerIds)
      && frameworkPackage.assignedCustomerIds.map(normalizeText).includes(normalizedCustomerId)
  }
  return false
}

const getScopedActorUserId = (scopes = {}) => toIdString(
  scopes.user?.id || scopes.user?._id || scopes.userId,
)

const logFrameworkPackageAccessDenied = async ({ runtimeInstance, frameworkPackage, scopes } = {}) => {
  const actorUserId = getScopedActorUserId(scopes)
  if (!actorUserId) return

  await auditService.log({
    actorUserId,
    action: auditService.AUDIT_ACTIONS.ACCESS_DENIED,
    resourceType: auditService.RESOURCE_TYPES.FrameworkPackage,
    resourceId: frameworkPackage?._id || runtimeInstance?.packageId,
    summary: 'Framework Package access denied during the governed Outcome Studio handoff.',
    scope: {
      customerId: runtimeInstance?.customerId,
      tenantId: runtimeInstance?.tenantId,
      runtimeInstanceId: runtimeInstance?._id || runtimeInstance?.id,
    },
    diff: {
      reason: 'FRAMEWORK_PACKAGE_CUSTOMER_ACCESS_DENIED',
      visibility: normalizeToken(frameworkPackage?.visibility),
      customerAccessMode: normalizeToken(frameworkPackage?.customerAccessMode),
    },
  })
}

const loadBoundedFrameworkPackage = async ({ runtimeInstance, policy, scopes } = {}) => {
  if (!runtimeInstance?.packageId || !runtimeInstance?.frameworkKey) return null
  const query = FrameworkPackage.find({
    _id: runtimeInstance.packageId,
    frameworkKey: runtimeInstance.frameworkKey,
    status: 'ACTIVE',
  })
  if (!query || typeof query.select !== 'function'
    || typeof query.sort !== 'function'
    || typeof query.limit !== 'function'
    || typeof query.maxTimeMS !== 'function'
    || typeof query.lean !== 'function') {
    throw createBoundedHandoffError('The bounded Framework Package reader is unavailable.')
  }
  const rows = await query
    .select(FRAMEWORK_PACKAGE_BOUNDED_PROJECTION)
    .sort({ _id: 1 })
    .limit(policy.packageLimit)
    .maxTimeMS(policy.maxTimeMS)
    .lean()
  if (!Array.isArray(rows) || rows.length !== 1) return null
  const frameworkPackage = rows[0]
  if (isFrameworkPackageAccessibleToCustomer({
    frameworkPackage,
    customerId: runtimeInstance.customerId,
  })) return frameworkPackage

  await logFrameworkPackageAccessDenied({ runtimeInstance, frameworkPackage, scopes })
  return null
}

const getObject = (value, key) => (isObject(value) ? value[key] : undefined)
const getFrameworkState = (runtimeInstance = {}) =>
  getObject(runtimeInstance, 'framework_state') || getObject(runtimeInstance, 'frameworkState') || {}

const getSectionsEntries = (frameworkState = {}) => {
  const sections = getObject(frameworkState, 'sections')
  if (sections instanceof Map) return [...sections.entries()]
  return isObject(sections) ? Object.entries(sections) : []
}

const getAcceptedSection = (section = {}) => {
  if (isObject(section?.accepted)) return section.accepted
  return isObject(section) && normalizeToken(section.state?.status) === 'ACCEPTED' ? section : null
}

const getSectionContent = (section = {}) => normalizeText(
  section.content || section.summary || section.value || section.narrative,
)

const getSectionProjection = (section = {}) =>
  section.generated?.evidenceProjection
  || section.intelligence?.scopedEvidence?.projection
  || section.generated?.intelligence?.scopedEvidence?.projection
  || section.evidenceProjection
  || section.accepted?.evidenceProjection
  || null

const getSectionScopedEvidence = (section = {}) =>
  section.intelligence?.scopedEvidence
  || section.generated?.intelligence?.scopedEvidence
  || section.scopedEvidence
  || {}

const getCanonicalOutputEligibility = (frameworkState = {}) => {
  const lock = getObject(frameworkState, 'lock') || {}
  const nested = getObject(lock, 'outputEligibility') || {}
  const publish = getObject(frameworkState, 'publish') || {}
  const lockSnapshot = getObject(lock, 'snapshot') || {}
  const publishSnapshot = getObject(publish, 'snapshot') || getObject(lock, 'publish') || {}
  const replayAnchor = getObject(lock, 'replayAnchor') || getObject(lock, 'anchor') || {}
  const outerPresent = typeof lock.outputEligible === 'boolean'
  const outerEligibilityMismatch = outerPresent && lock.outputEligible !== (nested.outputEligible === true)

  return {
    locked: lock.locked === true || normalizeToken(lock.state) === 'LOCKED',
    published: publish.published === true || normalizeToken(publish.state) === 'PUBLISHED',
    outputEligible: nested.outputEligible === true,
    canonicalOutputEligible: nested.canonicalOutputEligible === true,
    anchorEligible: nested.anchorEligible === true,
    intelligenceEligible: nested.intelligenceEligible === true,
    sectionTruthReady: nested.sectionTruthReady === true,
    outerOutputEligible: outerPresent ? lock.outputEligible : null,
    outerEligibilityMismatch,
    publishSnapshotId: normalizeText(publishSnapshot.snapshotId || nested.publishSnapshotId),
    publishSnapshotHash: normalizeText(publishSnapshot.snapshotHash || nested.publishSnapshotHash),
    lockSnapshotId: normalizeText(lockSnapshot.snapshotId || nested.snapshotId),
    lockSnapshotHash: normalizeText(lockSnapshot.snapshotHash || nested.snapshotHash),
    replayAnchorId: normalizeText(replayAnchor.replayAnchorId || replayAnchor.anchorId || nested.replayAnchorId),
    replayAnchorHash: normalizeText(replayAnchor.replayAnchorHash || replayAnchor.anchorHash || nested.replayAnchorHash),
  }
}

export { getCanonicalOutputEligibility }

const buildRuntimeIdentity = (runtimeInstance = {}) => ({
  runtimeInstanceId: toIdString(runtimeInstance._id || runtimeInstance.id),
  runtimeInstanceKey: normalizeText(runtimeInstance.runtimeInstanceKey),
  runtimeType: normalizeToken(runtimeInstance.runtimeType),
  frameworkKey: normalizeToken(runtimeInstance.frameworkKey),
  runtimeStatus: normalizeToken(runtimeInstance.status),
  executionStatus: normalizeToken(runtimeInstance.executionStatus),
  revision: isObject(runtimeInstance.revision)
    ? {
        revisionId: toIdString(runtimeInstance.revision.revisionId),
        revisionNumber: Number(runtimeInstance.revision.revisionNumber || 0),
        parentRuntimeId: toIdString(runtimeInstance.revision.parentRuntimeId),
        rootRuntimeId: toIdString(runtimeInstance.revision.rootRuntimeId),
      }
    : {},
  updatedAt: normalizeText(runtimeInstance.updatedAt?.toISOString?.() || runtimeInstance.updatedAt),
})

const buildPackageIdentity = ({ runtimeInstance = {}, frameworkPackage = null, requiredSections = [] } = {}) => {
  const packageId = toIdString(
    runtimeInstance.packageId
      || runtimeInstance.frameworkPackageId
      || frameworkPackage?._id
      || frameworkPackage?.id,
  )
  const packageKey = normalizeText(runtimeInstance.packageKey || frameworkPackage?.packageKey)
  const packageVersion = normalizeText(
    runtimeInstance.packageVersion
      || frameworkPackage?.packageVersion
      || frameworkPackage?.semanticVersion
      || frameworkPackage?.version,
  )
  const requiredSectionManifest = requiredSections.map(({ sectionKey, runtimePath, label }) => ({
    sectionKey,
    runtimePath,
    label,
  }))
  return {
    packageId,
    packageKey,
    packageVersion,
    requiredSections: requiredSectionManifest,
    requiredSectionManifestHash: sha256(requiredSectionManifest),
    packageIdentityHash: sha256({ packageId, packageKey, packageVersion, requiredSectionManifest }),
  }
}

const resolveRequiredSections = (frameworkPackage = null) => {
  const sections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  return sections
    .filter((section) => section?.required === true)
    .map((section) => ({
      sectionKey: normalizeKey(section.sectionKey || section.key),
      runtimePath: normalizeText(section.runtimePath),
      label: normalizeText(section.label || section.title || section.sectionKey || section.key),
    }))
    .filter((section) => section.sectionKey)
    .sort((left, right) => left.sectionKey.localeCompare(right.sectionKey))
}

const getEvidenceObjects = (frameworkState = {}) => {
  const evidencePack = getObject(frameworkState, 'evidence_pack') || getObject(frameworkState, 'evidencePack') || {}
  return {
    evidencePack,
    evidenceObjects: Array.isArray(evidencePack.evidenceObjects) ? evidencePack.evidenceObjects : [],
  }
}

export const buildFrameworkOutcomeHandoffV2ParityDigest = (runtimeInstance = {}) => {
  const frameworkState = getFrameworkState(runtimeInstance)
  const sections = getSectionsEntries(frameworkState)
    .map(([sectionKey, section]) => [normalizeKey(sectionKey), section])
    .sort(([left], [right]) => left.localeCompare(right))
  const evidenceObjects = getEvidenceObjects(frameworkState).evidenceObjects
    .map((evidenceObject) => ({
      evidenceObjectId: normalizeText(evidenceObject?.evidenceObjectId),
      sourceId: normalizeText(evidenceObject?.sourceId),
      lineageRef: normalizeText(evidenceObject?.lineageRef),
      reviewStatus: normalizeToken(evidenceObject?.reviewStatus),
    }))
    .sort((left, right) => left.evidenceObjectId.localeCompare(right.evidenceObjectId))
  return sha256({
    stateVersion: normalizeText(runtimeInstance?.stateVersion),
    lock: getObject(frameworkState, 'lock') || {},
    publish: getObject(frameworkState, 'publish') || {},
    sections,
    evidenceObjects,
  })
}

const isAcceptedEvidence = (evidenceObject = {}) => normalizeToken(evidenceObject.reviewStatus) === 'ACCEPTED'
  || evidenceObject.accepted === true

const buildEvidenceIndex = (evidenceObjects = []) => {
  const index = new Map()
  evidenceObjects.forEach((evidenceObject) => {
    const evidenceObjectId = normalizeText(evidenceObject.evidenceObjectId)
    const sourceId = normalizeText(evidenceObject.sourceId)
    const lineageRef = normalizeText(evidenceObject.lineageRef)
    const entry = {
      evidenceObjectId,
      sourceId,
      lineageRef,
      acceptanceState: isAcceptedEvidence(evidenceObject) ? 'ACCEPTED' : normalizeToken(evidenceObject.reviewStatus) || 'UNREVIEWED',
    }
    ;[evidenceObjectId, sourceId, lineageRef].filter(Boolean).forEach((key) => index.set(key, entry))
  })
  return index
}

const normalizeEvidenceReference = (reference, evidenceIndex, acceptanceFallback = '') => {
  const raw = isObject(reference)
    ? reference.evidenceObjectId || reference.refKey || reference.sourceId || reference.lineageRef || reference.id
    : reference
  const referenceKey = normalizeText(raw)
  const known = evidenceIndex.get(referenceKey)
  if (known) return { ...known, reference: referenceKey }
  return {
    evidenceObjectId: isObject(reference) ? normalizeText(reference.evidenceObjectId) : '',
    sourceId: isObject(reference) ? normalizeText(reference.sourceId) : '',
    lineageRef: isObject(reference) ? normalizeText(reference.lineageRef) : '',
    reference: referenceKey,
    acceptanceState: acceptanceFallback,
  }
}

const buildProjectionReceipt = ({ projection, sectionKey, evidenceIndex } = {}) => {
  if (!isObject(projection)) return null
  const included = Array.isArray(projection.included) ? projection.included : []
  const selectedEvidenceRefs = included
    .map((entry) => normalizeEvidenceReference(entry, evidenceIndex, 'PROJECTION_RECEIPT_ACCEPTED'))
    .filter((entry) => entry.reference || entry.evidenceObjectId)
  const safeReceipt = {
    algorithm: normalizeText(projection.algorithm),
    version: normalizeText(projection.version),
    sectionKey: normalizeKey(projection.sectionKey || sectionKey),
    knownSection: projection.knownSection === true,
    candidateCount: Number(projection.candidateCount || 0),
    eligibleAcceptedCount: Number(projection.eligibleAcceptedCount || 0),
    includedCount: Number(projection.includedCount ?? selectedEvidenceRefs.length),
    selectedEvidenceRefs,
    excludedCount: Number(projection.excludedCount || 0),
    excludedReasonCounts: isObject(projection.excludedReasonCounts) ? { ...projection.excludedReasonCounts } : {},
    selectedCoverageAreas: uniqueSorted(projection.selectedCoverageAreas),
    gaps: uniqueSorted(projection.gaps),
  }
  return {
    ...safeReceipt,
    receiptHash: sha256(safeReceipt),
  }
}

const buildSectionHandoff = ({ stateSectionKey, section, evidenceIndex } = {}) => {
  const sectionKey = normalizeKey(
    section?.lineage?.sectionKey
      || section?.sectionKey
      || stateSectionKey,
  )
  const accepted = getAcceptedSection(section)
  const projection = getSectionProjection(section)
  const scopedEvidence = getSectionScopedEvidence(section)
  const projectionReceipt = buildProjectionReceipt({ projection, sectionKey, evidenceIndex })
  const acceptedEvidenceRefs = [
    ...(Array.isArray(accepted?.supportingEvidenceRefs) ? accepted.supportingEvidenceRefs : []),
    ...(Array.isArray(scopedEvidence?.sourceRefs) ? scopedEvidence.sourceRefs : []),
    ...(Array.isArray(scopedEvidence?.evidenceObjectIds) ? scopedEvidence.evidenceObjectIds : []),
  ]
    .map((reference) => normalizeEvidenceReference(reference, evidenceIndex, 'SECTION_RECEIPT_ACCEPTED'))
    .filter((reference) => {
      if (!reference.reference && !reference.evidenceObjectId && !reference.sourceId) return false
      // Supporting refs can include non-evidence lineage markers such as scoped views
      // and input paths. When an evidence index exists, bind only refs that resolve to
      // an accepted Evidence Object/source record; selected projection refs are checked
      // separately and remain fail-closed when they cannot resolve.
      if (evidenceIndex.size === 0) return true
      return evidenceIndex.has(reference.reference)
        || evidenceIndex.has(reference.evidenceObjectId)
        || evidenceIndex.has(reference.sourceId)
    })
  const selectedEvidenceRefs = projectionReceipt?.selectedEvidenceRefs || []
  const allEvidenceRefs = [...selectedEvidenceRefs, ...acceptedEvidenceRefs]
  const evidenceRefKeys = new Set()
  const deduplicatedEvidenceRefs = allEvidenceRefs.filter((reference) => {
    const key = reference.evidenceObjectId || reference.sourceId || reference.lineageRef || reference.reference
    if (!key || evidenceRefKeys.has(key)) return false
    evidenceRefKeys.add(key)
    return true
  }).sort((left, right) => (
    (left.evidenceObjectId || left.reference).localeCompare(right.evidenceObjectId || right.reference)
  ))
  const truth = {
    contentPresent: Boolean(getSectionContent(accepted)),
    contentHash: getSectionContent(accepted) ? sha256(getSectionContent(accepted)) : '',
    truthHash: normalizeText(accepted?.truthHash || section?.intelligence?.acceptedTruth?.truthHash),
    acceptedAt: normalizeText(accepted?.acceptedAt),
    acceptedBy: toIdString(accepted?.acceptedBy),
    sourceActionKey: normalizeText(accepted?.sourceActionKey),
    sourceGeneratedAt: normalizeText(accepted?.sourceGeneratedAt),
    runtimePath: normalizeText(accepted?.runtimePath || section?.lineage?.runtimePath),
  }
  const generationBoundaries = [
    ...(Array.isArray(accepted?.generationBoundaries) ? accepted.generationBoundaries : []),
    ...(Array.isArray(section?.generated?.generationBoundaries) ? section.generated.generationBoundaries : []),
  ].map((boundary) => isObject(boundary)
    ? {
        boundaryKey: normalizeText(boundary.boundaryKey),
        reason: normalizeToken(boundary.reason),
        message: normalizeText(boundary.message),
      }
    : { boundaryKey: '', reason: '', message: normalizeText(boundary) })
    .filter((boundary) => boundary.boundaryKey || boundary.reason || boundary.message)
  const gaps = uniqueSorted([
    ...(Array.isArray(projectionReceipt?.gaps) ? projectionReceipt.gaps : []),
    ...(Array.isArray(accepted?.truthEligibility?.messages) ? accepted.truthEligibility.messages : []),
  ])

  return {
    sectionKey,
    stateSectionKey: normalizeKey(stateSectionKey),
    state: normalizeToken(section?.state?.status || section?.review?.status || (accepted ? 'ACCEPTED' : 'MISSING')),
    truth,
    projectionReceipt,
    selectedEvidenceRefs: deduplicatedEvidenceRefs.filter((reference) =>
      selectedEvidenceRefs.some((selected) => (
        (selected.evidenceObjectId || selected.reference) === (reference.evidenceObjectId || reference.reference)
      )),
    ),
    acceptedEvidenceRefs: deduplicatedEvidenceRefs,
    generationBoundaries,
    gaps,
    sectionHash: sha256({ sectionKey, truth, projectionReceipt, evidenceRefs: deduplicatedEvidenceRefs, gaps }),
  }
}

const buildKnowledgeResolution = ({ packBinding, knowledgeContext } = {}) => {
  const context = knowledgeContext?.context || knowledgeContext || {}
  const selectedPacks = Array.isArray(packBinding?.activePacks) ? packBinding.activePacks : []
  const requiredPacks = Array.isArray(packBinding?.requiredPacks) ? packBinding.requiredPacks : []
  const safePack = (pack) => ({
    packType: normalizeToken(pack?.packType),
    packKey: normalizeText(pack?.packKey),
    label: normalizeText(pack?.label),
    status: normalizeToken(pack?.status),
    runtimeBindable: pack?.runtimeBindable === true,
    versionId: normalizeText(pack?.versionId),
    contentHash: normalizeText(pack?.contentHash),
    boundary: normalizeToken(pack?.boundary || pack?.executionBoundary),
  })
  const safeBinding = {
    status: normalizeToken(packBinding?.status || packBinding?.resolution?.status),
    mode: normalizeText(packBinding?.mode),
    resolutionSource: normalizeToken(packBinding?.resolutionSource),
    policyKey: normalizeText(packBinding?.policyKey),
    policyVersion: normalizeText(packBinding?.policyVersion || packBinding?.resolution?.policyVersion),
    requiredPacks: requiredPacks.map(safePack).sort((left, right) => left.packType.localeCompare(right.packType)),
    activePacks: selectedPacks.map(safePack).sort((left, right) => left.packType.localeCompare(right.packType)),
    blockedCount: Number(packBinding?.resolution?.blockedCount || packBinding?.blockedPacks?.length || 0),
    missingDependencies: Array.isArray(packBinding?.missingDependencies)
      ? packBinding.missingDependencies.map(normalizeText).filter(Boolean).sort()
      : [],
    relationshipFailures: Array.isArray(packBinding?.relationshipFailures)
      ? packBinding.relationshipFailures.map((failure) => normalizeText(failure?.code || failure)).filter(Boolean).sort()
      : [],
  }
  const safeContext = {
    contractVersion: normalizeText(context.contractVersion),
    contextId: normalizeText(context.contextId),
    status: normalizeToken(context.status),
    available: context.available === true,
    blockerReason: normalizeToken(context.blockerReason),
    requestedOutputTypeKey: normalizeText(context.requestedOutputTypeKey),
    outputTypeKey: normalizeText(context.outputType?.key),
    outputSchemaKey: normalizeText(context.outputSchema?.key),
    styleKey: normalizeText(context.style?.key),
    rendererCapabilityKey: normalizeText(context.renderer?.capabilityKey),
    rendererCapabilityVersion: normalizeText(context.renderer?.capabilityVersion),
    contentHashes: uniqueSorted(context.lineage?.contentHashes),
  }
  return {
    binding: safeBinding,
    context: safeContext,
    resolutionHash: sha256({ binding: safeBinding, context: safeContext }),
  }
}

const buildClaimBoundaries = () => FRAMEWORK_OUTCOME_CLAIM_TYPES.map((claimType) => ({
  claimType,
  policyVersion: FRAMEWORK_OUTCOME_HANDOFF_POLICY_VERSION,
  status: 'BLOCKED_UNLESS_ACCEPTED_EVIDENCE_AND_BOUNDARY_PASS',
  requiredEvidence: true,
  requiredBoundarySignal: true,
  enforcementOwner: 'OUTCOME_FINAL_OUTPUT_BOUNDARY_EXECUTOR',
}))

export const evaluateFrameworkOutcomeClaimBoundary = ({
  claimType,
  acceptedEvidenceRefs = [],
  boundaryPassed = false,
} = {}) => {
  const normalizedClaimType = normalizeToken(claimType)
  const supported = FRAMEWORK_OUTCOME_CLAIM_TYPES.includes(normalizedClaimType)
  const hasAcceptedEvidence = Array.isArray(acceptedEvidenceRefs)
    && acceptedEvidenceRefs.some((reference) => {
      if (isObject(reference)) return ACCEPTED_EVIDENCE_STATES.has(normalizeToken(reference.acceptanceState))
        || reference.accepted === true
      return Boolean(normalizeText(reference))
    })
  const permitted = supported && hasAcceptedEvidence && boundaryPassed === true
  return {
    claimType: normalizedClaimType,
    policyVersion: FRAMEWORK_OUTCOME_HANDOFF_POLICY_VERSION,
    status: permitted ? 'PERMITTED_BY_ACCEPTED_EVIDENCE_AND_BOUNDARY' : 'BLOCKED',
    permitted,
    reason: !supported
      ? 'UNSUPPORTED_CLAIM_TYPE'
      : !hasAcceptedEvidence
        ? 'ACCEPTED_EVIDENCE_REQUIRED'
        : boundaryPassed !== true
          ? 'BOUNDARY_PASS_REQUIRED'
          : '',
  }
}

const buildBlockedHandoff = ({
  runtimeInstance = {},
  blockers = [],
  warnings = [],
  diagnostics = [],
  packageIdentity = {},
  canonicalEligibility = {},
  currentness = {},
  knowledgeResolution = {},
  sectionTruth = [],
  evidenceRefs = [],
} = {}) => {
  const normalizedBlockers = blockers.filter(Boolean)
  const status = normalizedBlockers.length > 0
    ? FRAMEWORK_OUTCOME_HANDOFF_STATUSES.BLOCKED
    : warnings.length > 0
      ? FRAMEWORK_OUTCOME_HANDOFF_STATUSES.READY_WITH_GAPS
      : FRAMEWORK_OUTCOME_HANDOFF_STATUSES.READY
  const runtimeIdentity = buildRuntimeIdentity(runtimeInstance)
  const handoffHash = sha256({
    contractVersion: FRAMEWORK_OUTCOME_HANDOFF_CONTRACT_VERSION,
    policyVersion: FRAMEWORK_OUTCOME_HANDOFF_POLICY_VERSION,
    runtimeIdentity,
    packageIdentity,
    canonicalEligibility,
    currentness,
    knowledgeResolution,
    sectionTruth,
    evidenceRefs,
    status,
  })
  const nextAction = normalizedBlockers.length > 0
    ? 'Resolve the governed Framework-to-Outcome handoff boundary before starting Outcome Studio.'
    : warnings.length > 0
      ? 'Review the visible evidence gaps before relying on generated drafts.'
      : ''
  return {
    contractVersion: FRAMEWORK_OUTCOME_HANDOFF_CONTRACT_VERSION,
    policyVersion: FRAMEWORK_OUTCOME_HANDOFF_POLICY_VERSION,
    handoffId: `framework-outcome-handoff-${runtimeIdentity.runtimeInstanceKey || runtimeIdentity.runtimeInstanceId || 'unresolved'}-${handoffHash.slice(-16)}`,
    status,
    runtime: runtimeIdentity,
    package: packageIdentity,
    canonicalEligibility,
    sectionTruth,
    evidenceRefs,
    knowledgeResolution,
    claimBoundaries: buildClaimBoundaries(),
    gaps: uniqueSorted(sectionTruth.flatMap((section) => section.gaps || [])),
    contradictions: diagnostics,
    blockers: normalizedBlockers,
    warnings,
    currentness: {
      ...currentness,
      status: normalizedBlockers.length > 0 ? 'BLOCKED' : 'CURRENT',
      handoffHash,
    },
    customerSafe: {
      status,
      contractVersion: FRAMEWORK_OUTCOME_HANDOFF_CONTRACT_VERSION,
      currentness: normalizedBlockers.length > 0 ? 'BLOCKED' : 'CURRENT',
      gapCount: uniqueSorted(sectionTruth.flatMap((section) => section.gaps || [])).length,
      contradictionWarningCount: diagnostics.length,
      blockerCount: normalizedBlockers.length,
      blockedBoundary: normalizedBlockers[0]?.code || '',
      nextAction,
    },
  }
}

export const buildFrameworkOutcomeStudioHandoff = ({
  runtimeInstance,
  frameworkPackage = null,
  packBinding = null,
  knowledgeContext = null,
  requestedOutputTypeKey = '',
} = {}) => {
  const blockers = []
  const warnings = []
  const diagnostics = []
  const runtime = runtimeInstance || {}
  const frameworkState = getFrameworkState(runtime)
  const canonicalEligibility = getCanonicalOutputEligibility(frameworkState)
  const requiredSections = resolveRequiredSections(frameworkPackage)
  const packageIdentity = buildPackageIdentity({ runtimeInstance: runtime, frameworkPackage, requiredSections })
  const { evidencePack, evidenceObjects } = getEvidenceObjects(frameworkState)
  const evidenceIndex = buildEvidenceIndex(evidenceObjects)
  const sectionEntries = getSectionsEntries(frameworkState)
  const sectionTruth = sectionEntries
    .map(([stateSectionKey, section]) => buildSectionHandoff({ stateSectionKey, section, evidenceIndex }))
    .filter((section) => section.truth.contentPresent || section.truth.truthHash || section.projectionReceipt)
    .sort((left, right) => left.sectionKey.localeCompare(right.sectionKey))
  const sectionByKey = new Map(sectionTruth.map((section) => [section.sectionKey, section]))
  const runtimeIdentity = buildRuntimeIdentity(runtime)

  if (!runtimeInstance) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.RUNTIME_REQUIRED,
    message: 'A runtime record is required to build the governed handoff.',
  })
  if (!canonicalEligibility.locked) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.RUNTIME_NOT_LOCKED,
    message: 'The Framework Runtime must be locked before Outcome Studio handoff.',
  })
  if (!canonicalEligibility.published) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.RUNTIME_NOT_PUBLISHED,
    message: 'Published Framework truth is required before Outcome Studio handoff.',
  })
  if (!canonicalEligibility.outputEligible
    || !canonicalEligibility.canonicalOutputEligible
    || !canonicalEligibility.anchorEligible
    || !canonicalEligibility.intelligenceEligible) blockers.push({
      code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.OUTPUT_ELIGIBILITY_MISSING,
      message: 'Canonical locked-runtime output eligibility is missing or incomplete.',
    })
  if (!canonicalEligibility.lockSnapshotId || !canonicalEligibility.lockSnapshotHash) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.LOCK_SNAPSHOT_MISSING,
    message: 'Lock snapshot proof is required for the governed handoff.',
  })
  if (!canonicalEligibility.replayAnchorId || !canonicalEligibility.replayAnchorHash) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.REPLAY_ANCHOR_MISSING,
    message: 'Replay anchor proof is required for the governed handoff.',
  })
  if (canonicalEligibility.outerEligibilityMismatch) {
    diagnostics.push({
      code: 'OUTER_NESTED_OUTPUT_ELIGIBILITY_CONTRADICTION',
      severity: 'WARNING',
      canonicalSource: 'framework_state.lock.outputEligibility',
      message: 'Outer lock.outputEligible disagrees with nested canonical output eligibility; nested lock eligibility remains authoritative.',
    })
    warnings.push({
      code: 'OUTER_NESTED_OUTPUT_ELIGIBILITY_CONTRADICTION',
      message: 'The runtime carries an outer/nested output-eligibility mismatch; governed readiness uses the nested lock record.',
    })
  }
  if (requiredSections.length === 0) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.PACKAGE_REQUIRED_SECTION_BINDING_MISSING,
    message: 'The resolved Framework Package does not declare required sections for this handoff.',
  })
  const missingRequiredSections = requiredSections
    .filter((required) => !sectionByKey.has(required.sectionKey)
      || sectionByKey.get(required.sectionKey)?.truth.contentPresent !== true
      || !sectionByKey.get(required.sectionKey)?.truth.truthHash)
  if (missingRequiredSections.length > 0) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.PACKAGE_REQUIRED_SECTION_MISSING,
    message: 'One or more required Framework Package sections do not have accepted truth.',
    sectionKeys: missingRequiredSections.map((section) => section.sectionKey),
  })
  sectionTruth.forEach((section) => {
    if (!section.truth.contentPresent || !section.truth.truthHash) blockers.push({
      code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.SECTION_TRUTH_MISSING,
      message: `Accepted truth is incomplete for section ${section.sectionKey}.`,
      sectionKey: section.sectionKey,
    })
    if (!section.projectionReceipt) blockers.push({
      code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.PROJECTION_RECEIPT_MISSING,
      message: `Evidence projection receipt is missing for section ${section.sectionKey}.`,
      sectionKey: section.sectionKey,
    })
    if (section.projectionReceipt && section.projectionReceipt.sectionKey !== section.sectionKey) blockers.push({
      code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.PROJECTION_RECEIPT_INCONSISTENT,
      message: `Evidence projection receipt does not match section ${section.sectionKey}.`,
      sectionKey: section.sectionKey,
    })
  })
  if (sectionTruth.length === 0) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.SECTION_TRUTH_MISSING,
    message: 'Accepted Framework section truth is required for the governed handoff.',
  })

  const evidenceRefs = sectionTruth.flatMap((section) => section.acceptedEvidenceRefs)
  const hasEvidencePack = evidenceObjects.length > 0 || Object.keys(evidencePack).length > 0
  evidenceRefs.forEach((reference) => {
    const hasIdentity = Boolean(reference.evidenceObjectId || reference.sourceId || reference.lineageRef || reference.reference)
    if (!hasIdentity) blockers.push({
      code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.EVIDENCE_REF_UNRESOLVED,
      message: 'A selected evidence reference has no stable evidence or source identity.',
    })
    if (hasEvidencePack && reference.reference && !evidenceIndex.has(reference.reference)
      && !evidenceIndex.has(reference.evidenceObjectId)
      && !evidenceIndex.has(reference.sourceId)) blockers.push({
        code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.EVIDENCE_REF_UNRESOLVED,
        message: `Selected evidence reference ${reference.reference} is not present in the accepted evidence pack.`,
      })
    if (reference.acceptanceState && !ACCEPTED_EVIDENCE_STATES.has(normalizeToken(reference.acceptanceState))) blockers.push({
      code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.EVIDENCE_REF_NOT_ACCEPTED,
      message: `Selected evidence reference ${reference.reference || reference.evidenceObjectId} is not accepted.`,
    })
  })

  const knowledgeResolution = buildKnowledgeResolution({ packBinding, knowledgeContext })
  if (!packBinding) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.KNOWLEDGE_RESOLUTION_MISSING,
    message: 'Outcome Studio Knowledge Pack resolution is required for the governed handoff.',
  })
  else if (!READY_KNOWLEDGE_STATUSES.has(knowledgeResolution.binding.status)
    || knowledgeResolution.binding.requiredPacks.some((pack) => pack.runtimeBindable !== true)) blockers.push({
      code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.KNOWLEDGE_BINDING_BLOCKED,
      message: 'Required Outcome Studio Knowledge Pack bindings are not active for this runtime.',
    })
  if (requestedOutputTypeKey && !knowledgeContext) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.KNOWLEDGE_CONTEXT_MISSING,
    message: 'Resolved Outcome Studio Knowledge context is required for the selected deliverable.',
  })
  if (knowledgeContext && knowledgeResolution.context.available !== true) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.KNOWLEDGE_CONTEXT_BLOCKED,
    message: 'Resolved Outcome Studio Knowledge context is blocked for the selected deliverable.',
  })
  if (runtime.packageKey && frameworkPackage?.packageKey
    && normalizeText(runtime.packageKey) !== normalizeText(frameworkPackage.packageKey)) blockers.push({
      code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.PACKAGE_IDENTITY_MISMATCH,
      message: 'Runtime package identity does not match the resolved Framework Package.',
    })

  const currentness = {
    status: 'CURRENT',
    runtimeIdentityHash: sha256(runtimeIdentity),
    packageIdentityHash: packageIdentity.packageIdentityHash,
    eligibilityHash: sha256(canonicalEligibility),
    sectionTruthHash: sha256(sectionTruth.map((section) => section.sectionHash)),
    projectionHash: sha256(sectionTruth.map((section) => section.projectionReceipt?.receiptHash || '')),
    evidenceHash: sha256(evidenceRefs),
    knowledgeResolutionHash: knowledgeResolution.resolutionHash,
  }
  const integrityFailures = []
  if (!runtimeIdentity.runtimeInstanceId && !runtimeIdentity.runtimeInstanceKey) integrityFailures.push('RUNTIME_IDENTITY_MISSING')
  if (!packageIdentity.packageKey || !packageIdentity.packageVersion) integrityFailures.push('PACKAGE_IDENTITY_INCOMPLETE')
  if (!currentness.sectionTruthHash || !currentness.projectionHash) integrityFailures.push('SECTION_CURRENTNESS_HASH_MISSING')
  if (integrityFailures.length > 0) blockers.push({
    code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.HANDOFF_INTEGRITY_INVALID,
    message: 'The handoff cannot be trusted because its identity/currentness fields are incomplete.',
    failures: integrityFailures,
  })

  return buildBlockedHandoff({
    runtimeInstance: runtime,
    blockers,
    warnings,
    diagnostics,
    packageIdentity,
    canonicalEligibility,
    currentness,
    knowledgeResolution,
    sectionTruth,
    evidenceRefs,
  })
}

export const validateFrameworkOutcomeStudioHandoff = (handoff = {}) => {
  const failures = []
  if (normalizeText(handoff.contractVersion) !== FRAMEWORK_OUTCOME_HANDOFF_CONTRACT_VERSION) failures.push('CONTRACT_VERSION_MISMATCH')
  if (!normalizeText(handoff.handoffId)) failures.push('HANDOFF_ID_MISSING')
  if (!normalizeText(handoff.runtime?.runtimeInstanceId) && !normalizeText(handoff.runtime?.runtimeInstanceKey)) failures.push('RUNTIME_IDENTITY_MISSING')
  if (!normalizeText(handoff.package?.packageIdentityHash)) failures.push('PACKAGE_IDENTITY_HASH_MISSING')
  if (!normalizeText(handoff.currentness?.handoffHash)) failures.push('HANDOFF_HASH_MISSING')
  if (!Array.isArray(handoff.sectionTruth)) failures.push('SECTION_TRUTH_NOT_ARRAY')
  if (!Array.isArray(handoff.claimBoundaries)
    || !FRAMEWORK_OUTCOME_CLAIM_TYPES.every((claimType) => handoff.claimBoundaries.some((boundary) => boundary.claimType === claimType))) failures.push('CLAIM_BOUNDARY_POLICY_INCOMPLETE')
  return { valid: failures.length === 0, failures }
}

export const checkFrameworkOutcomeStudioHandoffCurrentness = ({ handoff = {}, runtimeInstance = {} } = {}) => {
  const currentRuntimeHash = sha256(buildRuntimeIdentity(runtimeInstance))
  const currentLockHash = sha256(getCanonicalOutputEligibility(getFrameworkState(runtimeInstance)))
  const reasons = []
  if (normalizeText(handoff.currentness?.runtimeIdentityHash) !== currentRuntimeHash) reasons.push('RUNTIME_IDENTITY_CHANGED')
  if (normalizeText(handoff.currentness?.eligibilityHash) !== currentLockHash) reasons.push('LOCK_ELIGIBILITY_CHANGED')
  return {
    current: reasons.length === 0,
    status: reasons.length === 0 ? 'CURRENT' : 'STALE',
    reasons,
  }
}

export const resolveFrameworkOutcomeStudioHandoff = async ({
  runtimeInstance = null,
  runtimeInstanceId,
  scopes,
  frameworkPackage = null,
  packBinding = null,
  knowledgeContext = null,
  knowledgeContextResult = null,
  requestedOutputTypeKey = '',
  boundedDependencyPolicy = null,
  boundedStateParityReceipt = null,
  loadRuntime = getRuntimeInstance,
  loadPackage = null,
  resolvePack = resolveOutcomeStudioKnowledgePackBinding,
  resolveContext = resolveOutcomeStudioKnowledgeContext,
} = {}) => {
  let resolvedRuntime = runtimeInstance
  let resolvedPackage = frameworkPackage
  let resolvedBinding = packBinding
  let resolvedContext = knowledgeContext
  let boundedPolicy = null
  const boundedDependencies = []
  try {
    boundedPolicy = boundedDependencyPolicy
      ? validateBoundedHandoffPolicy(boundedDependencyPolicy)
      : null
    if (boundedPolicy && boundedStateParityReceipt) {
      validateBoundedStateParityReceipt({
        receipt: boundedStateParityReceipt,
        runtimeInstance: resolvedRuntime,
      })
    }
    if (boundedPolicy && (loadPackage
      || loadRuntime !== getRuntimeInstance
      || resolvePack !== resolveOutcomeStudioKnowledgePackBinding
      || resolveContext !== resolveOutcomeStudioKnowledgeContext)) {
      throw createBoundedHandoffError('Bounded handoff reader overrides are not permitted.', 'HANDOFF_BOUNDED_READER_OVERRIDE')
    }
    if (boundedPolicy && !resolvedRuntime) {
      throw createBoundedHandoffError('Bounded handoff readiness requires a bounded control projection.', 'HANDOFF_BOUNDED_CONTROL_REQUIRED')
    }
    if (!resolvedRuntime && runtimeInstanceId) resolvedRuntime = await loadRuntime({ runtimeInstanceId, scopes })
    if (boundedPolicy) {
      boundedDependencies.push({
        dependencyKey: 'runtime_state_v2_control',
        commandKey: FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_COMMANDS.CONTROL,
        maxTimeMS: boundedPolicy.maxTimeMS,
        limit: 1,
        sortKeys: [],
        projectionFields: RUNTIME_STATE_V2_CONTROL_PROJECTION_FIELDS,
        resultCount: resolvedRuntime ? 1 : 0,
      })
    }
    const resolvedPackageId = resolvedRuntime?.packageId || resolvedRuntime?.frameworkPackageId
    if (!resolvedPackage && resolvedPackageId) {
      if (boundedPolicy) {
        resolvedPackage = await loadBoundedFrameworkPackage({
          runtimeInstance: resolvedRuntime,
          policy: boundedPolicy,
          scopes,
        })
        boundedDependencies.push({
          dependencyKey: 'framework_package',
          commandKey: FRAMEWORK_OUTCOME_HANDOFF_BOUNDED_COMMANDS.FRAMEWORK_PACKAGE,
          maxTimeMS: boundedPolicy.maxTimeMS,
          limit: boundedPolicy.packageLimit,
          sortKeys: ['_id:1'],
          projectionFields: FRAMEWORK_PACKAGE_BOUNDED_PROJECTION.split(' '),
          resultCount: resolvedPackage ? 1 : 0,
        })
      } else {
        const query = FrameworkPackage.findById(resolvedPackageId)
        resolvedPackage = typeof query?.lean === 'function' ? await query.lean() : await query
      }
    }
    if (!resolvedBinding) {
      const bindingResult = await resolvePack({
        query: {
          ...(resolvedRuntime || {}),
          ...(resolvedRuntime?.runtimeInstanceKey ? { runtimeInstanceKey: resolvedRuntime.runtimeInstanceKey } : {}),
        },
        ...(boundedPolicy ? { boundedReadPolicy: boundedPolicy } : {}),
      })
      resolvedBinding = bindingResult?.binding || null
      if (boundedPolicy) {
        const bindingReceipt = bindingResult?.boundedReadReceipt
        if (!bindingReceipt || !Array.isArray(bindingReceipt.dependencies)) {
          throw createBoundedHandoffError('Bounded Knowledge Pack readers did not return a dependency receipt.')
        }
        boundedDependencies.push(...bindingReceipt.dependencies)
      }
    }
    if (!resolvedContext && knowledgeContextResult?.context) resolvedContext = knowledgeContextResult.context
    if (!resolvedContext && requestedOutputTypeKey) {
      const contextResult = knowledgeContextResult || await resolveContext({
        query: {
          ...(resolvedRuntime || {}),
          requestedOutputTypeKey,
          resolvedAt: new Date().toISOString(),
        },
        ...(boundedPolicy ? { boundedReadPolicy: boundedPolicy } : {}),
      })
      resolvedContext = contextResult?.context || null
      if (boundedPolicy && Array.isArray(contextResult?.boundedReadReceipt?.dependencies)) {
        boundedDependencies.push(...contextResult.boundedReadReceipt.dependencies)
      }
    }
    let handoff = buildFrameworkOutcomeStudioHandoff({
      runtimeInstance: resolvedRuntime,
      frameworkPackage: resolvedPackage,
      packBinding: resolvedBinding,
      knowledgeContext: resolvedContext,
      requestedOutputTypeKey,
    })
    if (boundedPolicy
      && handoff.status !== FRAMEWORK_OUTCOME_HANDOFF_STATUSES.BLOCKED
      && !boundedStateParityReceipt) {
      handoff = buildBlockedHandoff({
        runtimeInstance: resolvedRuntime || {},
        blockers: [{
          code: 'HANDOFF_BOUNDED_BLOCKED_ONLY',
          message: 'Bounded Runtime State V2 handoff dependency readiness is blocked until section/evidence parity is separately proven.',
        }],
        packageIdentity: {},
        canonicalEligibility: getCanonicalOutputEligibility(getFrameworkState(resolvedRuntime || {})),
        currentness: {},
        knowledgeResolution: {},
        sectionTruth: [],
        evidenceRefs: [],
      })
    }
    return {
      handoff,
      runtimeInstance: resolvedRuntime,
      frameworkPackage: resolvedPackage,
      packBinding: resolvedBinding,
      knowledgeContext: resolvedContext,
      ...(boundedPolicy
        ? { boundedDependencyReceipt: buildBoundedDependencyReceipt({
            policy: boundedPolicy,
            dependencies: boundedDependencies,
          }) }
        : {}),
    }
  } catch (error) {
    const handoff = buildBlockedHandoff({
      runtimeInstance: resolvedRuntime || {},
      blockers: [{
        code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.HANDOFF_RESOLUTION_FAILED,
        message: 'The governed Framework-to-Outcome handoff could not be resolved and remains blocked.',
      }],
      diagnostics: [{
        code: FRAMEWORK_OUTCOME_HANDOFF_BLOCKER_CODES.HANDOFF_RESOLUTION_FAILED,
        severity: 'ERROR',
        message: boundedPolicy
          ? 'Bounded handoff dependency resolution failed.'
          : (normalizeText(error?.message) || 'Handoff resolution failed.'),
      }],
      packageIdentity: {},
      canonicalEligibility: getCanonicalOutputEligibility(getFrameworkState(resolvedRuntime || {})),
      currentness: {},
      knowledgeResolution: {},
      sectionTruth: [],
      evidenceRefs: [],
    })
    return {
      handoff,
      runtimeInstance: resolvedRuntime,
      frameworkPackage: resolvedPackage,
      packBinding: resolvedBinding,
      knowledgeContext: resolvedContext,
      ...(boundedPolicy
        ? { boundedDependencyReceipt: buildBoundedDependencyReceipt({
            policy: boundedPolicy,
            dependencies: boundedDependencies,
          }) }
        : {}),
    }
  }
}

export default {
  buildFrameworkOutcomeStudioHandoff,
  checkFrameworkOutcomeStudioHandoffCurrentness,
  evaluateFrameworkOutcomeClaimBoundary,
  resolveFrameworkOutcomeStudioHandoff,
  validateFrameworkOutcomeStudioHandoff,
}
