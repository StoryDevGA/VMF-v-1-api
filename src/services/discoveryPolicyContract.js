import { z } from 'zod'
import { generateChecksum } from './governanceAudit/checksumService.js'

export const DISCOVERY_POLICY_CONTRACT_VERSION = 'framework-package-discovery-policy-v1'

const text = z.string().trim().min(1).max(180)
const note = z.string().trim().max(2000)
const tokens = z.array(text).max(100).refine((items) => new Set(items).size === items.length, 'Values must be unique.')
const object = (shape) => z.object(shape).strict()
const reference = object({
  mappingKey: text,
  vmfCapabilityRef: text.optional(),
  ownerRuntime: text.optional(),
  resultType: text.optional(),
  sourceRef: text.optional(),
  sourceVersion: text.optional(),
  resultContractVersion: text.optional(),
  implementationRef: text.optional(),
  implementationVersion: text.optional(),
  restrictions: tokens.optional(),
})
const references = z.array(reference).max(100).refine(
  (rows) => new Set(rows.map((row) => row.mappingKey)).size === rows.length,
  'Mapping keys must be unique within a collection.',
)

// Method identities are references, never enums inferred from example packages.
export const discoveryPolicySchema = object({
  contractVersion: z.literal(DISCOVERY_POLICY_CONTRACT_VERSION),
  policyKey: text,
  policyVersion: text,
  label: text.optional(),
  sourcePolicy: object({
    allowedSourceTypes: tokens.optional(),
    requireSourceHash: z.literal(true).optional(),
    requireAcquisitionMetadata: z.literal(true).optional(),
    requireLineageReference: z.literal(true).optional(),
    preserveSourceLocation: z.literal(true).optional(),
    semanticExtraction: object({
      mode: text.optional(),
      aiMayAssist: z.boolean().optional(),
      candidateState: text.optional(),
      admissionRequired: z.literal(true),
      references: references.optional(),
    }).optional(),
  }).optional(),
  evidencePolicy: object({
    categories: tokens.optional(),
    coverageAreas: tokens.optional(),
    confidenceLevels: tokens.optional(),
    materialityLevels: tokens.optional(),
    reviewStates: tokens.optional(),
    acceptedObjectTypes: references.optional(),
    ownerMappings: references.optional(),
  }).optional(),
  advisoryInterpretation: object({
    enabled: z.boolean(),
    providerMode: text.optional(),
    outputState: text.optional(),
    reviewRequiredWhen: tokens.optional(),
    lenses: references.optional(),
    supportAssetReferences: tokens.optional(),
  }).optional(),
  claimPolicy: object({
    requireEvidenceReferences: z.literal(true).optional(),
    requireClaimBoundary: z.literal(true).optional(),
    unsupportedClaimsRemainRestricted: z.literal(true).optional(),
    alternativeExplanationVisibility: z.boolean().optional(),
    nextEvidenceQuestionsEnabled: z.boolean().optional(),
    references: references.optional(),
  }).optional(),
  contradictionPolicy: object({
    canonicalOwner: z.literal('CR'),
    mustRemainVisible: z.literal(true),
    resolutionRequiresGovernedReview: z.literal(true),
    aiMayNotResolveByAssertion: z.literal(true),
    blockingImpactIsOwnerDefined: z.literal(true),
    workflowRelevanceRules: references.optional(),
  }).optional(),
  sectionMapping: object({
    mode: text.optional(),
    algorithm: text.optional(),
    requireMappingReceipt: z.literal(true),
    rules: references.optional(),
  }).optional(),
  readinessPolicy: object({
    requiredSections: tokens.optional(),
    requiredReasoningArtefacts: tokens.optional(),
    requiredValidationResults: references.optional(),
    blockingContradictionRules: references.optional(),
    requiredAuthorizationDependencies: references.optional(),
    readinessEvaluations: references.optional(),
  }).optional(),
  postLockDiscoveryPolicy: object({
    enabled: z.boolean(),
    mutateLockedRevision: z.literal(false),
    allowedDispositions: tokens.optional(),
    references: references.optional(),
  }).optional(),
  compatibility: object({
    packageContractVersion: z.literal(DISCOVERY_POLICY_CONTRACT_VERSION),
    minimumRuntimeCompatibilityVersion: text.optional(),
    migrationIdentity: text.optional(),
    notes: note.optional(),
  }).optional(),
})

const referenceCollections = [
  ['sourcePolicy', 'semanticExtraction', 'references'],
  ['evidencePolicy', 'acceptedObjectTypes'], ['evidencePolicy', 'ownerMappings'],
  ['advisoryInterpretation', 'lenses'], ['claimPolicy', 'references'],
  ['contradictionPolicy', 'workflowRelevanceRules'], ['sectionMapping', 'rules'],
  ['readinessPolicy', 'requiredValidationResults'], ['readinessPolicy', 'blockingContradictionRules'],
  ['readinessPolicy', 'requiredAuthorizationDependencies'], ['readinessPolicy', 'readinessEvaluations'],
  ['postLockDiscoveryPolicy', 'references'],
]
const installedReports = new WeakSet()
// One support boundary for lifecycle verification and candidate acquisition.
// Schema-valid authoring does not imply an implemented runtime interpretation.
export const unsupportedLocalDiscoveryPolicyFields = (policy) => {
  if (!policy) return []
  const supported = ['contractVersion', 'policyKey', 'policyVersion', 'label', 'evidencePolicy', 'compatibility']
  return [
    ...Object.keys(policy).filter(key => !supported.includes(key)).map(key => `discoveryPolicy.${key}`),
    ...Object.keys(policy.evidencePolicy || {}).filter(key => key !== 'ownerMappings')
      .map(key => `discoveryPolicy.evidencePolicy.${key}`),
    ...Object.keys(policy.compatibility || {}).filter(key => !['packageContractVersion', 'notes'].includes(key))
      .map(key => `discoveryPolicy.compatibility.${key}`),
  ]
}
const localBindingMessages = {
  VE02_LOCAL_ASSESSOR_DISABLED: 'The controlled StorylineOS assessor is disabled in this environment.',
  VE02_LOCAL_SCOPE_UNAVAILABLE: 'This package is outside the approved synthetic assessor scope.',
  VE02_LOCAL_ACTIVATION_UNAVAILABLE: 'The required contract/grading installation or classifier model is unavailable.',
  VE02_LOCAL_POLICY_BINDING_UNVERIFIED: 'The supplied policy reference does not match the approved local binding.',
}

// The successor derivative's bytes match its pinned SHA-256. This is source
// verification only; it is not Knowledge Pack installation or executor proof.
const evidenceAssessmentAuthority = Object.freeze({
  capability: 'VE02',
  owner: 'VE02 / Bundle 02',
  sourceRef: 'https://drive.google.com/file/d/17rkALp4x5q5VByzIn9adocJM3YtqdMgN/view',
  sourceVersion: 'Bundle 02 v1.4 / STATE v1.6 / DDS v1.8 — VE02RC001',
  resultContract: 'VMF.VE02.EvidenceAssessmentResult',
  schemaVersion: '1.0',
  expectedSourceHash: 'c9c1b6e824af3f97177129dcf9a4ee5e1a3a9ab55976a32db095febda5ac4cf4',
  historicalSource: {
    owner: 'VE', ownerVersion: '1.0',
    sourceRef: 'https://drive.google.com/file/d/1ZEevzhzIJ4ggDJ86oYdBpCe1pcrHhcVB/view',
    sourceVersion: 'Bundle 02 v1.3 / STATE v1.6 / DDS v1.8 — DGS001 / VE v1.0',
  },
  implementationRef: 'validation-evidence-quality-check',
  restriction: 'Evidence-quality assessment only: source reliability, relevance, specificity and independence. Does not grant diagnosis, truth formation or decision authority.',
})

const inspectReference = (row) => {
  const authority = evidenceAssessmentAuthority
  const legacyCapability = row.vmfCapabilityRef === authority.implementationRef
  const applicable = legacyCapability || row.implementationRef === authority.implementationRef
    || row.vmfCapabilityRef === authority.capability
  if (!applicable) return {
    reason: 'AUTHORITATIVE_VMF_MAPPING_UNVERIFIED',
    question: `Andrew/VMF Engineering: which governing method source/version binds capability ${row.vmfCapabilityRef || '(missing)'} to semantic owner ${row.ownerRuntime || '(missing)'} and result contract ${row.resultType || '(missing)'} for ${row.mappingKey}, and which implementation/version verifies that binding?`,
  }
  const conflicts = []
  if (legacyCapability) conflicts.push('Move validation-evidence-quality-check to the proposed implementation reference; the VMF capability is VE02.')
  else if (row.vmfCapabilityRef !== authority.capability) conflicts.push('The policy capability must identify VE02.')
  if (row.ownerRuntime !== authority.owner) conflicts.push('The successor policy semantic owner must identify VE02 / Bundle 02.')
  if (row.implementationRef !== authority.implementationRef) conflicts.push('The proposed implementation reference must identify validation-evidence-quality-check.')
  const sourceRef = row.sourceRef?.split(/[?#]/)[0]
  if (sourceRef !== authority.sourceRef || row.sourceVersion !== authority.sourceVersion) conflicts.push('The policy source binding is missing or differs from the owner-announced successor source/version.')
  if (row.resultType !== authority.resultContract || row.resultContractVersion !== authority.schemaVersion) conflicts.push('The successor result reference must identify VMF.VE02.EvidenceAssessmentResult / 1.0.')
  return {
    reason: conflicts.length ? 'DISCOVERY_POLICY_SEMANTIC_BINDING_UNVERIFIED' : 'DISCOVERY_POLICY_IMPLEMENTATION_BINDING_UNVERIFIED',
    semanticTarget: {
      capability: authority.capability, owner: authority.owner,
      sourceRef: authority.sourceRef, sourceVersion: authority.sourceVersion,
      relationshipStatus: 'SUPPORTED', policyBindingStatus: conflicts.length ? 'UNVERIFIED' : 'CONFIRMED',
      resultContract: authority.resultContract, schemaVersion: authority.schemaVersion,
      expectedSourceHash: authority.expectedSourceHash, historicalSource: authority.historicalSource,
      sourceVerificationStatus: 'VERIFIED', installationStatus: 'NOT_CHECKED',
      machineContractStatus: 'SOURCE_VERIFIED', implementationStatus: 'UNVERIFIED',
      restriction: authority.restriction,
    },
    question: [...conflicts,
      'The VE02 derivative bytes match the governing SHA-256. Installed-source eligibility must be checked for the selected package scope.',
      'The registered validation-evidence-quality-check assessment producer is not verified against the typed VE02 contract. The implemented typed-result consumer does not certify that producer.',
    ].join(' '),
  }
}

// Live source lookup enriches the reference matrix, never promotes consumption
// support into method-producer or package-readiness authority.
export const inspectInstalledDiscoveryPolicy = async (frameworkPackage, { session = null, dependencies = {} } = {}) => {
  const report = inspectDiscoveryPolicy(frameworkPackage.discoveryPolicy)
  if (!report.unresolvedReferences.some((row) => row.semanticTarget?.capability === 'VE02')) return report
  const { resolveVE02ContractBinding, resolveVE02GradingBinding } = await import('./runtimeValidation/ve02ContractBindingRegistry.js')
  const { assertVE02LocalEnvironment, buildVE02LocalActivation, VE02_LOCAL_ASSESSOR } = await import('./runtimeValidation/ve02LocalAssessorRegistration.js')
  const { VE02_CLASSIFIER_VERSION } = await import('./runtimeValidation/ve02EvidenceClassifier.js')
  const query = { frameworkKey: frameworkPackage.frameworkKey, packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version }
  let binding, lookupReason
  try {
    binding = await resolveVE02ContractBinding({ session, dependencies, query: {
      frameworkKey: frameworkPackage.frameworkKey, packageKey: frameworkPackage.packageKey,
      packageVersion: frameworkPackage.version,
    } })
  } catch (error) {
    lookupReason = error.reason || error.code || 'INSTALLED_SOURCE_LOOKUP_FAILED'
  }
  let localActivation, localActivationReason
  try {
    assertVE02LocalEnvironment()
    if (['frameworkKey', 'packageKey', 'packageVersion'].every(key => query[key] === VE02_LOCAL_ASSESSOR[key])) {
      const grading = await resolveVE02GradingBinding({ session, dependencies, query })
      localActivation = buildVE02LocalActivation({ query, binding: grading,
        classifierVersion: VE02_CLASSIFIER_VERSION, model: process.env.VE02_CLASSIFICATION_MODEL })
    } else localActivationReason = 'VE02_LOCAL_SCOPE_UNAVAILABLE'
  } catch (error) { localActivationReason = error.code || 'VE02_LOCAL_ACTIVATION_UNAVAILABLE' }
  const references = report.unresolvedReferences.map((row) => {
    if (row.semanticTarget?.capability !== 'VE02') return row
    const locallyBound = localActivation && row.semanticTarget.policyBindingStatus === 'CONFIRMED'
      && row.implementationVersion === VE02_LOCAL_ASSESSOR.implementationVersion
      && /^discoveryPolicy\.evidencePolicy\.ownerMappings\.\d+$/.test(row.path)
    const localReason = localActivationReason || (!locallyBound ? 'VE02_LOCAL_POLICY_BINDING_UNVERIFIED' : undefined)
    return { ...row,
      ...(locallyBound ? { status: 'RESOLVED_LOCAL', reason: 'DISCOVERY_POLICY_LOCAL_BINDING_VERIFIED' } : {}),
      question: locallyBound ? 'The installed contract and grading composition support the provisional StorylineOS assessor under Gary\'s local decision. VMF producer certification remains unverified; this local binding does not certify package readiness or unrelated mappings.'
        : `${binding ? row.question.replace('Installed-source eligibility must be checked for the selected package scope.',
        'The installed derivative is verified and active for this package scope.').replace('The registered validation-evidence-quality-check assessment producer is not verified against the typed VE02 contract. The implemented typed-result consumer does not certify that producer.', '') : row.question} ${localBindingMessages[localReason] || `Local assessor unavailable: ${localReason}.`}`,
      semanticTarget: { ...row.semanticTarget,
      vmfProducerCertificationStatus: 'UNVERIFIED',
      ...(locallyBound ? {
          localImplementationStatus: 'STORYLINEOS_PROVISIONAL_ACTIVE', localProducerBinding: localActivation,
        } : { localImplementationStatus: 'UNAVAILABLE', localImplementationReason: localReason }),
      installationStatus: binding ? 'VERIFIED_ACTIVE' : 'UNAVAILABLE',
      ...(lookupReason ? { installationReason: lookupReason } : {}),
      ...(binding ? { installedBinding: {
        activationId: binding.activation.activationId, versionId: binding.activation.versionId,
        contentHash: binding.activation.contentHash, sourceDocumentId: binding.source.sourceDocumentId,
      }, typedConsumer: binding.consumer } : {}),
    } }
  })
  const resolvedReferences = references.filter((row) => row.status === 'RESOLVED_LOCAL')
  const unresolvedReferences = [
    ...references.filter((row) => row.status !== 'RESOLVED_LOCAL'),
    ...unsupportedLocalDiscoveryPolicyFields(frameworkPackage.discoveryPolicy).map(path => ({
      path, mappingKey: `${path}.unsupported`, status: 'UNRESOLVED',
      reason: 'DISCOVERY_POLICY_FIELD_UNSUPPORTED',
      question: 'This authored field has no implemented interpretation in the controlled StorylineOS policy. Remove it from this draft or establish its supported runtime binding before validation.',
    })),
  ]
  const installedReport = { ...report,
    status: !report.errors.length && !unresolvedReferences.length ? 'CONFIGURED_LOCAL' : report.status,
    packageIdentity: {
      packageId: String(frameworkPackage._id || frameworkPackage.id || ''),
      frameworkKey: frameworkPackage.frameworkKey, packageKey: frameworkPackage.packageKey,
      packageVersion: frameworkPackage.version,
    },
    resolvedReferences, unresolvedReferences,
  }
  installedReports.add(installedReport)
  return installedReport
}

export const installedDiscoveryPolicyDetails = (frameworkPackage, report) => {
  if (!installedReports.has(report) || report.policyHash !== inspectDiscoveryPolicy(frameworkPackage.discoveryPolicy).policyHash
    || report.packageIdentity.packageId !== String(frameworkPackage._id || frameworkPackage.id || '')
    || report.packageIdentity.frameworkKey !== frameworkPackage.frameworkKey
    || report.packageIdentity.packageKey !== frameworkPackage.packageKey
    || report.packageIdentity.packageVersion !== frameworkPackage.version) return discoveryPolicyReadinessDetails(frameworkPackage.discoveryPolicy)
  return Object.fromEntries([
    ...report.errors.map(error => [error.path, error.message]),
    ...report.unresolvedReferences.map(reference => [reference.path, reference.question]),
  ])
}

export const captureInstalledDiscoveryPolicy = (frameworkPackage, report) => {
  if (frameworkPackage.discoveryPolicy === undefined) return {}
  const details = installedDiscoveryPolicyDetails(frameworkPackage, report)
  if (Object.keys(details).length || report.status !== 'CONFIGURED_LOCAL') {
    throw Object.assign(new Error(Object.values(details).join(' ') || 'Discovery Policy installation is not verified.'), { code: 'DISCOVERY_POLICY_MAPPING_UNVERIFIED', status: 409 })
  }
  return { discoveryPolicyBindings: {
    packageIdentity: report.packageIdentity, policyHash: report.policyHash,
    references: report.resolvedReferences.map(row => ({ path: row.path, mappingKey: row.mappingKey,
      binding: row.semanticTarget.localProducerBinding })),
  } }
}

export const assertInstalledDiscoveryPolicySnapshot = async (frameworkPackage, { session = null } = {}) => {
  if (frameworkPackage.discoveryPolicy === undefined) return undefined
  const report = await inspectInstalledDiscoveryPolicy(frameworkPackage, { session })
  const current = captureInstalledDiscoveryPolicy(frameworkPackage, report).discoveryPolicyBindings
  const snapshot = frameworkPackage.dependencyLock
  if (snapshot?.discoveryPolicyHash !== report.policyHash
    || generateChecksum(snapshot?.discoveryPolicy) !== report.policyHash
    || generateChecksum(snapshot?.discoveryPolicyBindings) !== generateChecksum(current)) {
    throw Object.assign(new Error('Discovery Policy captured installation changed.'), { code: 'DISCOVERY_POLICY_CAPTURED_BINDING_MISMATCH', status: 409 })
  }
  return report
}

export const fenceInstalledDiscoveryPolicy = async (frameworkPackage, { session } = {}) => {
  if (frameworkPackage.discoveryPolicy === undefined) return
  if (!session?.inTransaction()) throw Object.assign(new Error('Discovery Policy lifecycle requires a transaction.'), { code: 'DISCOVERY_POLICY_TRANSACTION_REQUIRED', status: 409 })
  const report = await assertInstalledDiscoveryPolicySnapshot(frameworkPackage, { session })
  const { default: Activation } = await import('../models/KnowledgePackActivation.js')
  const { default: Version } = await import('../models/KnowledgePackVersion.js')
  const bindings = new Map(report.resolvedReferences.map(row => {
    const binding = row.semanticTarget.localProducerBinding
    return [binding.installedActivationId, binding]
  }))
  for (const binding of bindings.values()) {
    for (const [model, filter] of [
      [Activation, { activationId: binding.installedActivationId, status: 'ACTIVE', versionId: binding.installedVersionId, contentHash: binding.gradingContentHash }],
      [Version, { versionId: binding.installedVersionId, status: { $in: ['ACTIVE', 'VALIDATED'] }, contentHash: binding.gradingContentHash }],
    ]) {
      const result = await model.updateOne(filter, { $inc: { __v: 1 } }, { session, timestamps: false })
      if (result.matchedCount !== 1) throw Object.assign(new Error('Discovery Policy installation changed during lifecycle transition.'), { code: 'DISCOVERY_POLICY_CAPTURED_BINDING_MISMATCH', status: 409 })
    }
  }
}

export const inspectDiscoveryPolicy = (value) => {
  if (value === undefined) return { status: 'LEGACY_FALLBACK', unresolvedReferences: [], errors: [] }
  const parsed = discoveryPolicySchema.safeParse(value)
  if (!parsed.success) return {
    status: 'INVALID', unresolvedReferences: [],
    errors: parsed.error.issues.map((issue) => ({ path: `discoveryPolicy.${issue.path.join('.')}`, message: issue.message })),
  }
  const policy = parsed.data
  const unresolvedReferences = referenceCollections.flatMap((segments) => {
    const rows = segments.reduce((current, segment) => current?.[segment], policy) || []
    return rows.map((row, index) => ({
      path: `discoveryPolicy.${segments.join('.')}.${index}`,
      ...row,
      status: 'UNRESOLVED',
      ...inspectReference(row),
    }))
  })
  const requiredGroups = [
    ['sourcePolicy', Boolean(policy.sourcePolicy?.semanticExtraction)],
    ['evidencePolicy', Boolean(policy.evidencePolicy)],
    ['advisoryInterpretation', policy.advisoryInterpretation?.enabled === true],
    ['claimPolicy', Boolean(policy.claimPolicy)],
    ['contradictionPolicy', Boolean(policy.contradictionPolicy)],
    ['sectionMapping', Boolean(policy.sectionMapping)],
    ['readinessPolicy', Boolean(policy.readinessPolicy)],
    ['postLockDiscoveryPolicy', policy.postLockDiscoveryPolicy?.enabled === true],
  ]
  for (const [group, required] of requiredGroups) {
    if (!required || unresolvedReferences.some((row) => row.path.startsWith(`discoveryPolicy.${group}.`))) continue
    unresolvedReferences.push({
      path: `discoveryPolicy.${group}`, mappingKey: `${group}.requiredBinding`,
      status: 'UNRESOLVED', reason: 'REQUIRED_VMF_MAPPING_MISSING',
      question: `Andrew/VMF Engineering: supply the authoritative capability, semantic owner and result contract for ${group}, with governing source/version and verified implementation binding.`,
    })
  }
  if (!unresolvedReferences.length) unresolvedReferences.push({
    path: 'discoveryPolicy', mappingKey: 'policy.requiredBinding', status: 'UNRESOLVED',
    reason: 'REQUIRED_VMF_MAPPING_MISSING',
    question: 'Andrew/VMF Engineering: confirm the applicable Discovery Policy capability, semantic owner and result contract, governing source/version and verified implementation binding before validation.',
  })
  // Supplied source/binding identifiers record a proposal, not verification.
  // Supported semantic relationships do not establish machine-contract eligibility.
  return {
    status: unresolvedReferences.length ? 'UNRESOLVED' : 'CONFIGURED',
    policyKey: policy.policyKey, policyVersion: policy.policyVersion,
    policyHash: generateChecksum(policy), unresolvedReferences, errors: [],
  }
}

export const discoveryPolicyReadinessDetails = (value) => {
  const report = inspectDiscoveryPolicy(value)
  return Object.fromEntries([
    ...report.errors.map((error) => [error.path, error.message]),
    ...report.unresolvedReferences.map((reference) => [reference.path, reference.question]),
  ])
}

export const discoveryPolicySnapshot = (value) => value === undefined ? {} : {
  discoveryPolicy: discoveryPolicySchema.parse(value),
  discoveryPolicyHash: inspectDiscoveryPolicy(value).policyHash,
}

export const resolvePackageDiscoveryPolicy = ({ frameworkPackage, runtimeInstance = {} } = {}) => {
  if (!frameworkPackage) return { status: 'BLOCKED', reason: 'DISCOVERY_POLICY_PACKAGE_MISSING', unresolvedReferences: [] }
  const packageId = String(frameworkPackage._id || frameworkPackage.id || '')
  const identity = { packageId, packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version, frameworkKey: frameworkPackage.frameworkKey }
  const mismatch = [
    [runtimeInstance.packageId, packageId], [runtimeInstance.packageKey, frameworkPackage.packageKey],
    [runtimeInstance.packageVersion, frameworkPackage.version], [runtimeInstance.frameworkKey, frameworkPackage.frameworkKey],
  ].some(([recorded, actual]) => recorded !== undefined && recorded !== null && String(recorded) !== String(actual))
  if (mismatch) return { ...identity, status: 'BLOCKED', reason: 'DISCOVERY_POLICY_PACKAGE_IDENTITY_MISMATCH', unresolvedReferences: [] }
  const report = inspectDiscoveryPolicy(frameworkPackage.discoveryPolicy)
  if (report.status === 'LEGACY_FALLBACK') return { ...identity, ...report }
  const snapshot = frameworkPackage.dependencyLock
  const capturedHash = snapshot?.discoveryPolicyHash
  const runtimeSnapshotId = runtimeInstance.dependencyLockId || runtimeInstance.evidence?.dependencySnapshotId
  const runtimeSnapshotHash = runtimeInstance.evidence?.dependencySnapshotHash
  const bindingMatches = capturedHash === report.policyHash && snapshot?.discoveryPolicy !== undefined
    && generateChecksum(snapshot.discoveryPolicy) === report.policyHash
    && runtimeSnapshotId === snapshot?.snapshotId && runtimeSnapshotHash === snapshot?.snapshotHash
  return { ...identity, ...report, status: 'BLOCKED',
    reason: report.status === 'INVALID' ? 'DISCOVERY_POLICY_INVALID'
      : !bindingMatches ? 'DISCOVERY_POLICY_CAPTURED_BINDING_MISMATCH' : 'DISCOVERY_POLICY_MAPPING_UNVERIFIED',
  }
}

export const summarizeDiscoveryPolicyResolution = (resolution) => ({
  status: resolution.status,
  ...(resolution.reason ? { reason: resolution.reason } : {}),
  ...(resolution.packageId ? { packageId: resolution.packageId } : {}),
  ...(resolution.packageKey ? { packageKey: resolution.packageKey } : {}),
  ...(resolution.packageVersion ? { packageVersion: resolution.packageVersion } : {}),
  ...(resolution.policyKey ? { policyKey: resolution.policyKey } : {}),
  ...(resolution.policyVersion ? { policyVersion: resolution.policyVersion } : {}),
  ...(resolution.policyHash ? { policyHash: resolution.policyHash } : {}),
  unresolvedCount: resolution.unresolvedReferences?.length || 0,
  resolvedCount: resolution.resolvedReferences?.length || 0,
})

export const resolveInstalledPackageDiscoveryPolicy = async ({ frameworkPackage, runtimeInstance, session = null } = {}) => {
  const resolution = resolvePackageDiscoveryPolicy({ frameworkPackage, runtimeInstance })
  if (resolution.reason !== 'DISCOVERY_POLICY_MAPPING_UNVERIFIED') return resolution
  try {
    const report = await assertInstalledDiscoveryPolicySnapshot(frameworkPackage, { session })
    return { ...resolution, ...report, status: 'CONFIGURED_LOCAL', reason: 'DISCOVERY_POLICY_LOCAL_BINDING_VERIFIED' }
  } catch (error) {
    return { ...resolution, reason: error.code || 'DISCOVERY_POLICY_INSTALLED_BINDING_UNAVAILABLE' }
  }
}

// This binding governs quality assessment, not evidence admission or readiness.
// Only the existing candidate acquisition engine may run under this minimal
// policy; additional authored semantics require their own verified bindings.
export const permitsLocalDiscoveryCandidateAcquisition = ({ frameworkPackage, resolution } = {}) => {
  if (resolution?.status !== 'CONFIGURED_LOCAL') return false
  const policy = frameworkPackage?.discoveryPolicy
  return policy && unsupportedLocalDiscoveryPolicyFields(policy).length === 0
    && policy.evidencePolicy?.ownerMappings?.length > 0
    && resolution.resolvedReferences?.length === policy.evidencePolicy.ownerMappings.length
    && resolution.resolvedReferences.every(row => /^discoveryPolicy\.evidencePolicy\.ownerMappings\.\d+$/.test(row.path))
    && resolution.unresolvedReferences?.length === 0
}
