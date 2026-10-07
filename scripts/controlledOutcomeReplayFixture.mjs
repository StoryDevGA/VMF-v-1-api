// New isolated synthetic records only; read-only capture of unchanged configuration.
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'
import { Customer, Tenant, User, Role, RuntimeInstance, FrameworkPackage, KnowledgePackVersion,
  KnowledgePackActivation, LicenseLevel, OutcomeStudioReadinessPointer, OutcomeStudioReadinessRevision,
  OutcomeStudioTestReferencePointer, OutcomeStudioTestReferenceRevision, OutcomeStudioTestReferenceObject } from '../src/models/index.js'
import { authorizeOutcomeStudioLiveTestExecution, hashDevelopmentTestReadinessContent } from '../src/services/outcomeStudioReadinessService.js'
import { resolveOutcomeStudioTestReferenceSnapshots } from '../src/services/outcomeStudioTestReferenceService.js'
import { buildOutcomeStudioProviderRuntime } from '../src/config/outcomeStudioProvider.js'
import { buildRuntimeIntelligenceGraphForFrameworkState, validateRuntimeIntelligenceGraph,
  buildRuntimeIntelligenceGraphProjection, buildRuntimeIntelligenceGraphQueryProjection } from '../src/services/runtimeIntelligenceGraphService.js'
import { normalizeRuntimeSectionObject, buildEnrichedGeneratedSection, hashSectionInput } from '../src/services/runtimeSectionModelService.js'
import { resolvePackageReasoningArtefacts, buildReasoningArtefactOutputs } from '../src/services/reasoningArtefactContractService.js'
import { isRuntimeManagedSection, buildRuntimeManagedSourceReceipt, evaluateRuntimeManagedSections } from '../src/services/runtimeManagedSectionService.js'
import { buildAcceptedSectionTruth, validateGeneratedReasoningArtefactsForAcceptance } from '../src/services/runtimeStateMutationService.js'
import { buildFrameworkOutcomeStudioHandoff } from '../src/services/outcomeFrameworkHandoffService.js'
import { resolveOutcomeStudioKnowledgePackBinding } from '../src/services/outcomeKnowledgePackRegistryService.js'
import { resolveOutcomeStudioKnowledgeContext } from '../src/services/outcomeStudioKnowledgeContextService.js'
import { resolveOutcomeStudioCompositionInputs } from '../src/services/outcomeStudioLiveCompositionBridgeService.js'
import { projectOutcomeSelectedTargetBinding } from '../src/services/outcomeSelectedTargetService.js'
import { snapshotHash } from '../src/utils/outcomeEvidenceSnapshot.js'

export const OUTPUT_TYPE_KEY = 'commercial-strategy-and-decision-paper'
const packageId = '6aa923ac50c4a5b07e60b716'
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const authorityModels = [OutcomeStudioReadinessPointer, OutcomeStudioReadinessRevision,
  OutcomeStudioTestReferencePointer, OutcomeStudioTestReferenceRevision, OutcomeStudioTestReferenceObject]
const bytesOf = (row) => Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes.buffer)
export const hashControlledAuthority = (authority) => snapshotHash({ ...authority,
  objects: authority.objects.map((row) => ({ ...row, bytes: bytesOf(row).toString('base64') })) })
export const validateControlledAuthority = (authority) => {
  const { pointer, revision, pointers, revisions, objects, providerDescriptor } = authority || {}
  if (!pointer || !revision || pointers?.length !== 3 || revisions?.length !== 3 || objects?.length !== 3
    || String(pointer.currentRevisionId) !== String(revision._id) || pointer.currentRevision !== revision.revision
    || revision.verdict !== 'READY_FOR_TESTING' || revision.policyVersion !== 'OES_004_DEVELOPMENT_TEST_READINESS_V1'
    || revision.contentHash !== hashDevelopmentTestReadinessContent(revision)
    || pointer.registerId !== revision.registerId || revision.environment !== 'TEST'
    || pointer.environment !== revision.environment) throw new Error('Governed TEST authority binding invalid')
  const expectedDescriptor = { providerKey: revision.providerPolicy.providerKey, model: revision.providerPolicy.model,
    providerMode: 'LIVE_TEST', environment: revision.providerPolicy.environment,
    safeContextPolicyKey: revision.providerPolicy.safeContextPolicyKey, failurePosture: revision.providerPolicy.failurePosture }
  if (snapshotHash(expectedDescriptor) !== snapshotHash(providerDescriptor)) throw new Error('Governed provider authority mismatch')
  for (const snapshot of revision.testReferences) {
    const p = pointers.find((row) => row.family === snapshot.family)
    const r = revisions.find((row) => String(row._id) === String(p?.currentRevisionId))
    const o = objects.find((row) => String(row._id) === String(r?.objectId))
    if (!p || !r || !o || p.currentStatus !== 'APPROVED' || r.status !== 'APPROVED'
      || p.referenceKey !== r.referenceKey || p.currentRevision !== r.revision || r.family !== snapshot.family
      || snapshot.referenceKey !== r.referenceKey || snapshot.referenceRevision !== r.revision
      || snapshot.sha256 !== r.sha256 || snapshot.byteLength !== r.byteLength
      || r.storageIdentity !== o.storageIdentity || r.sha256 !== o.sha256 || r.byteLength !== o.byteLength
      || r.mimeType !== 'application/pdf' || o.mimeType !== r.mimeType || r.extension !== '.pdf' || o.extension !== r.extension) throw new Error('Governed TEST reference binding invalid')
    const bytes = bytesOf(o)
    if (bytes.length !== r.byteLength || createHash('sha256').update(bytes).digest('hex') !== r.sha256
      || bytes.subarray(0, 5).toString('ascii') !== '%PDF-'
      || !bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1').includes('%%EOF')) throw new Error('Governed TEST PDF bytes invalid')
  }
  if (revision.testReferences.length !== 3 || new Set(pointers.map((row) => row.family)).size !== 3) throw new Error('Governed TEST reference selection invalid')
  return hashControlledAuthority(authority)
}

export const captureControlledConfiguration = async (sourceUri) => {
  if (mongoose.connection.readyState !== 0) throw new Error('Configuration capture requires a disconnected read-only owner')
  await mongoose.connect(sourceUri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 })
  try {
    const frameworkPackage = await mongoose.connection.db.collection(FrameworkPackage.collection.collectionName)
      .findOne({ _id: new mongoose.Types.ObjectId(packageId) })
    if (!frameworkPackage || frameworkPackage.version !== '3.2.0') throw new Error('Unchanged reviewed Framework Package unavailable')
    const { binding } = await resolveOutcomeStudioKnowledgePackBinding({ query: {
      frameworkKey: frameworkPackage.frameworkKey, packageKey: frameworkPackage.packageKey,
      packageVersion: frameworkPackage.version, runtimeType: 'VALUE_NARRATIVE', workspaceType: 'OUTCOME',
      requestedOutputTypeKey: OUTPUT_TYPE_KEY,
    } })
    const selected = [...new Map([...(binding.activePacks || []), ...(binding.systemOnlyPacks || [])]
      .map((row) => [row.activationId, row])).values()]
    if (!['READY', 'READY_WITH_GAPS'].includes(binding.status) || selected.length !== 12) {
      throw new Error('Reviewed twelve-pack resolver selection changed; reopen configuration discovery')
    }
    const activations = await mongoose.connection.db.collection(KnowledgePackActivation.collection.collectionName)
      .find({ status: 'ACTIVE', activationId: { $in: selected.map((row) => row.activationId) } }).sort({ _id: 1 }).toArray()
    const versions = await mongoose.connection.db.collection(KnowledgePackVersion.collection.collectionName)
      .find({ versionId: { $in: activations.map((row) => row.versionId) } }).sort({ _id: 1 }).toArray()
    if (activations.length !== selected.length || versions.length !== new Set(activations.map((row) => row.versionId)).size) throw new Error('Frozen configuration incomplete')
    const providerDescriptor = buildOutcomeStudioProviderRuntime().deps.providerDescriptor
    await authorizeOutcomeStudioLiveTestExecution({ providerDescriptor, stage: 'PRE_IDEMPOTENCY' })
    const snapshots = await resolveOutcomeStudioTestReferenceSnapshots()
    if (snapshots.some((row) => row.state !== 'VALID')) throw new Error('Governed TEST references unavailable')
    const pointer = await OutcomeStudioReadinessPointer.findOne({ registerId: 'oes-004-r2-slice-5-application-readiness-test', environment: 'TEST' }).lean()
    const readinessRevision = await OutcomeStudioReadinessRevision.findById(pointer.currentRevisionId).lean()
    const pointers = await Promise.all(snapshots.map(({ family }) => OutcomeStudioTestReferencePointer.findOne({ family, currentStatus: 'APPROVED' }).sort({ updatedAt: -1, _id: -1 }).lean()))
    const revisions = await Promise.all(pointers.map((row) => OutcomeStudioTestReferenceRevision.findById(row.currentRevisionId).lean()))
    const objects = await Promise.all(revisions.map((row) => OutcomeStudioTestReferenceObject.collection.findOne({ _id: row.objectId, storageIdentity: row.storageIdentity })))
    const governedAuthority = { pointer, revision: readinessRevision, pointers, revisions, objects, providerDescriptor }
    const governedAuthorityHash = validateControlledAuthority(governedAuthority)
    return { evidenceClass: 'READ_ONLY_UNCHANGED_CONFIGURATION', frameworkPackage, activations, versions,
      governedAuthority, governedAuthorityHash,
      configurationHash: snapshotHash({ frameworkPackage, activations, versions, governedAuthorityHash }) }
  } finally { await mongoose.disconnect() }
}

export const seedControlledReplayFixture = async ({ configuration, credentials, apiCommit }) => {
  if (mongoose.connection.host !== '127.0.0.1' || !/^ss041_po_replay_\d+$/.test(mongoose.connection.name)
    || (await mongoose.connection.db.listCollections().toArray()).length) throw new Error('Fresh isolated fixture required')
  if (validateControlledAuthority(configuration.governedAuthority) !== configuration.governedAuthorityHash
    || snapshotHash({ frameworkPackage: configuration.frameworkPackage, activations: configuration.activations,
      versions: configuration.versions, governedAuthorityHash: configuration.governedAuthorityHash }) !== configuration.configurationHash) throw new Error('Frozen configuration drift')
  const assignedIds = (configuration.frameworkPackage.assignedCustomerIds || []).map(String).sort()
  if (configuration.frameworkPackage.customerAccessMode !== 'SELECTED_CUSTOMERS'
    || !assignedIds.length || assignedIds.some((value) => !mongoose.isValidObjectId(value))) throw new Error('Reviewed package assignment changed')
  const ids = Object.fromEntries(Object.entries({ runtime: '041000000000000000000001', tenant: '041000000000000000000002',
    customer: assignedIds[0], actor: '041000000000000000000004', license: '041000000000000000000005' })
    .map(([key, value]) => [key, new mongoose.Types.ObjectId(value)]))
  const scope = { runtimeInstanceId: ids.runtime, customerId: ids.customer, tenantId: ids.tenant }
  const revision = 'ss041-controlled-source-revision-1'
  const createdAt = '2026-10-02T08:00:00.000Z'
  await FrameworkPackage.collection.insertOne(configuration.frameworkPackage)
  await KnowledgePackVersion.collection.insertMany(configuration.versions)
  await KnowledgePackActivation.collection.insertMany(configuration.activations)
  const authority = configuration.governedAuthority
  const authorityRows = [[authority.pointer], [authority.revision], authority.pointers, authority.revisions, authority.objects]
  for (let index = 0; index < authorityModels.length; index++) await authorityModels[index].collection.insertMany(authorityRows[index])
  await authorizeOutcomeStudioLiveTestExecution({ providerDescriptor: authority.providerDescriptor, stage: 'PRE_IDEMPOTENCY' })
  await LicenseLevel.create({ _id: ids.license, name: 'Controlled Replay VMF', homeExperience: 'CORE',
    featureEntitlements: ['VMF'], isActive: true, createdBy: ids.actor, updatedBy: ids.actor })
  // Only the package-declared identifier is borrowed; no actual customer data is copied.
  await Customer.collection.insertOne({ _id: ids.customer, name: 'Synthetic surrogate for unchanged package access', status: 'ACTIVE',
    topology: 'SINGLE_TENANT', vmfPolicy: 'SINGLE', entitlements: [], defaultTenantId: ids.tenant, licenseLevelId: ids.license })
  await Tenant.collection.insertOne({ _id: ids.tenant, customerId: ids.customer, name: 'Controlled Synthetic Tenant', status: 'ENABLED' })
  await Role.collection.insertOne({ key: 'CUSTOMER_ADMIN', name: 'Customer Admin', scope: 'CUSTOMER', isActive: true,
    permissions: ['VMF_VIEW', 'VMF_UPDATE', 'TENANT_VIEW', 'CUSTOMER_VIEW'] })
  await User.collection.insertOne({ _id: ids.actor, email: credentials.email, name: 'Controlled Synthetic Reviewer', isActive: true,
    passwordHash: await bcrypt.hash(credentials.password, 12), memberships: [{ customerId: ids.customer, roles: ['CUSTOMER_ADMIN'] }],
    tenantMemberships: [], vmfGrants: [] })
  const pkg = configuration.frameworkPackage
  const guided = pkg.sections.filter((section) => !isRuntimeManagedSection(section))
  const state = { sections: {}, evidence_pack: { accepted: true, acceptedAt: createdAt, needsRefresh: false,
    inputs: { fixtureAuthority: 'Controlled synthetic source author' }, evidenceObjects: [], sourceRegistry: [],
    discoveryHealth: { readiness: { status: 'READY', missingAreas: [] }, contradictionCandidates: [] },
    lineage: { evidenceVersion: revision } },
  }
  for (const section of guided) {
    const key = section.runtimePath.split('.').at(-1)
    state.sections[key] = normalizeRuntimeSectionObject({ value: { objective: `Review the controlled source for ${key}.` },
      sectionKey: section.sectionKey, runtimePath: section.runtimePath, initializedAt: createdAt })
  }
  const snapshots = { publishSnapshotId: 'controlled-publish-1', publishSnapshotHash: hash('controlled-publish-1'),
    lockSnapshotId: 'controlled-lock-1', lockSnapshotHash: hash('controlled-lock-1'),
    replayAnchorId: 'controlled-replay-1', replayAnchorHash: hash('controlled-replay-1') }
  state.publish = { published: true, state: 'PUBLISHED', snapshot: { snapshotId: snapshots.publishSnapshotId, snapshotHash: snapshots.publishSnapshotHash } }
  state.lock = { state: 'LOCKED', locked: true, lockedAt: '2026-10-02T09:00:00.000Z', lockedBy: String(ids.actor),
    publish: state.publish.snapshot, snapshot: { snapshotId: snapshots.lockSnapshotId, snapshotHash: snapshots.lockSnapshotHash },
    anchor: { replayAnchorId: snapshots.replayAnchorId, replayAnchorHash: snapshots.replayAnchorHash },
    evidence: { dependencySnapshotId: pkg.dependencyLock.snapshotId, dependencySnapshotHash: pkg.dependencyLock.snapshotHash },
    outputEligibility: { locked: true, outputEligible: true, canonicalOutputEligible: true,
      anchorEligible: true, intelligenceEligible: true, sectionTruthReady: true, ...snapshots } }
  const runtime = { _id: ids.runtime, tenantId: ids.tenant, customerId: ids.customer, packageId: pkg._id,
    packageKey: pkg.packageKey, packageVersion: pkg.version, frameworkKey: pkg.frameworkKey, runtimeType: 'VALUE_NARRATIVE',
    runtimeInstanceKey: 'ss041-controlled-synthetic', status: 'LOCKED', executionStatus: 'COMPLETE',
    updatedAt: new Date('2026-10-02T09:00:00.000Z'), createdAt: new Date(createdAt), stateVersion: revision,
    framework_state: state, evidence: { dependencySnapshotId: pkg.dependencyLock.snapshotId, dependencySnapshotHash: pkg.dependencyLock.snapshotHash } }
  const query = { ...runtime, runtimeInstanceId: String(ids.runtime), workspaceType: 'OUTCOME', requestedOutputTypeKey: OUTPUT_TYPE_KEY }
  const { binding } = await resolveOutcomeStudioKnowledgePackBinding({ query })
  const { context } = await resolveOutcomeStudioKnowledgeContext({ query })
  const canonical = buildFrameworkOutcomeStudioHandoff({ runtimeInstance: runtime, frameworkPackage: pkg, packBinding: binding,
    knowledgeContext: context, requestedOutputTypeKey: OUTPUT_TYPE_KEY })
  const resolved = await resolveOutcomeStudioCompositionInputs({ binding, knowledgeContext: context,
    requestedOutputTypeKey: OUTPUT_TYPE_KEY, requestedFormat: 'MARKDOWN', frameworkHandoff: canonical })
  const selected = projectOutcomeSelectedTargetBinding({ contract: { outputType: { ...resolved.outputType, actualContentHash: resolved.outputType.contentHash },
    schema: { ...resolved.schema, actualContentHash: resolved.schema.contentHash }, schemaProjection: resolved.schemaProjection } })
  const source = { _id: new mongoose.Types.ObjectId('041000000000000000000006'), ...scope, stateVersion: revision, sourceStateVersion: revision,
    current: true, stateStatus: 'CURRENT', sourceId: 'controlled-source-1', sourceType: 'DOCUMENT',
    label: 'Controlled synthetic authored source', sourceHash: hash('controlled-authored-document-1') }
  const targets = selected.receipt.targetSections.required
  const statements = [
    'The controlled source records a request to review a bounded pilot.',
    'The controlled source presents the pilot as a hypothesis requiring independent validation.',
    'The controlled source requests a decision about further evidence gathering.',
    'The controlled source reports that independent outcome evidence has not been established.',
    'The controlled source describes a proposed workflow rather than a proven commercial result.',
    'The controlled source limits the present decision to investigation.',
    'The controlled source makes no quantified economic benefit claim.',
    'The controlled source identifies leadership as the intended reader.',
    'The controlled source proposes collecting further evidence before wider commitments.',
    'The controlled source records uncertainty about pilot results.',
    'The controlled source withholds authorization for rollout.',
    'The controlled source requires independent validation before stronger claims.',
    'The controlled source identifies evidence collection as the proposed next action.',
    'The controlled source records its own authored provenance and qualification.',
  ]
  if (targets.length !== statements.length) throw new Error('Reviewed real schema changed; reopen fixture discovery')
  const evidence = targets.map((target, index) => ({ _id: new mongoose.Types.ObjectId(`0411000000000000000000${(index + 1).toString(16).padStart(2, '0')}`), ...scope, current: true, stateStatus: 'CURRENT',
    stateVersion: revision, sourceStateVersion: revision, evidenceObjectId: `controlled-evidence-${index + 1}`, sourceId: source.sourceId,
    sourceType: 'DOCUMENT', extractedFact: statements[index], permittedStatement: statements[index],
    lineageRef: `controlled-source-1#statement-${index + 1}`, sourceLocation: `controlled-source-1#statement-${index + 1}`,
    reviewStatus: 'ACCEPTED', validationStatus: 'UNVALIDATED', currentness: 'CURRENT', classification: 'CUSTOMER_EVIDENCE',
    claimStatus: 'SOURCE_PRESENTED', attribution: 'Controlled synthetic source author', confidenceWarnings: ['Source-presented; independently unvalidated.'],
    permittedInterpretation: 'EXACT_STATEMENT_ONLY', blockedStrongerClaim: ['Independent validation, quantified benefit and rollout authorization are not established.'],
    proofDependency: [], proofOrderDisposition: 'NOT_ESTABLISHED', proofRequirementCodes: ['ATTRIBUTION'],
    evidenceRequiredToSubstantiate: ['Independent outcome evidence is required before stronger claims.'],
    scope: { organisation: 'Controlled scenario', domain: 'Bounded pilot investigation' },
    time: { from: '2026-10-01', to: '2026-10-02' }, materiality: 'SOURCE_RECORDED',
    draftPlacement: { version: 'evidence-to-draft-placement.v1', targetReceiptFingerprint: selected.receiptFingerprint,
      sourceSectionKeys: [guided[index % guided.length].runtimePath.split('.').at(-1)], targetSectionKeys: [target.targetSectionKey] },
  }))
  state.evidence_pack.evidenceObjects = evidence
  state.evidence_pack.sourceRegistry = [source]
  for (const [index, section] of guided.entries()) {
    const key = section.runtimePath.split('.').at(-1), value = state.sections[key]
    const generatedAt = new Date(Date.parse('2026-10-02T08:10:00.000Z') + index * 120000).toISOString()
    const sectionContractHash = hashSectionInput(section)
    const { generated } = buildEnrichedGeneratedSection({ actionKey: 'GENERATE_SECTION', actorUserId: String(ids.actor),
      frameworkPackage: pkg, frameworkState: state, input: value.input, runtimeInstance: runtime, section,
      dependencySectionKeys: section.dependsOnSectionKeys, sectionExecutionContract: { contractVersion: 'section-execution-contract-v1', sectionContractHash }, generatedAt })
    const declarations = resolvePackageReasoningArtefacts({ frameworkPackage: pkg, sectionKey: section.sectionKey, actionKey: 'GENERATE_SECTION' })
    const candidate = Object.fromEntries(declarations.map((item) => [item.artefactKey, { value: `Controlled source framework guidance for ${key}; independent commercial proof and rollout permission are not established.` }]))
    const outputs = buildReasoningArtefactOutputs({ candidate: { reasoningArtefacts: candidate, sectionIntelligence: candidate }, declarations,
      packageKey: pkg.packageKey, packageVersion: pkg.version, sectionKey: section.sectionKey, stateSectionKey: key,
      inputHash: generated.inputHash, evidenceHash: generated.evidenceHash, dependencyHash: generated.dependencyHash, sectionContractHash, generatedAt })
    generated.reasoningArtefacts = outputs.values; generated.sectionIntelligence = candidate; generated.reasoningArtefactReceipts = outputs.receipts
    generated.runtimeManagedSourceReceipt = buildRuntimeManagedSourceReceipt({ frameworkPackage: pkg, frameworkState: state, section, generated })
    validateGeneratedReasoningArtefactsForAcceptance({ frameworkPackage: pkg, generated, sectionKey: section.sectionKey, stateSectionKey: key })
    value.generated = generated
    value.accepted = buildAcceptedSectionTruth({ actorUserId: String(ids.actor), generated, sectionKey: section.sectionKey,
      runtimePath: section.runtimePath, acceptedAt: new Date(Date.parse(generatedAt) + 60000).toISOString() })
    value.accepted.supportingEvidenceRefs = evidence.filter((row) => row.draftPlacement.sourceSectionKeys.includes(key)).map((row) => row.evidenceObjectId)
    value.state = { status: 'ACCEPTED', needsRegeneration: false }; value.review = { status: 'ACCEPTED' }
  }
  const managed = evaluateRuntimeManagedSections({ frameworkPackage: pkg, frameworkState: state, now: '2026-10-02T09:00:00.000Z' })
  if (managed.blockers.length || managed.readySectionCount !== managed.requiredSectionCount) throw new Error('Unchanged package managed proof blocked')
  const frozenSourceHash = snapshotHash({ evidence, source, sections: state.sections })
  state.intelligence_graph = buildRuntimeIntelligenceGraphForFrameworkState({ actorUserId: String(ids.actor),
    builtAt: '2026-10-02T10:00:00.000Z', frameworkPackage: pkg, frameworkState: state, runtimeInstance: runtime })
  if (validateRuntimeIntelligenceGraph(state.intelligence_graph).length
    || !buildRuntimeIntelligenceGraphQueryProjection(buildRuntimeIntelligenceGraphProjection(state.intelligence_graph), 'readiness').available) throw new Error('Controlled graph readiness invalid')
  await RuntimeInstance.collection.insertOne(runtime)
  await mongoose.connection.collection('runtime_section_states').insertMany(guided.map((section) => ({ ...scope,
    sectionKey: section.runtimePath.split('.').at(-1), sectionDetail: state.sections[section.runtimePath.split('.').at(-1)],
    current: true, stateStatus: 'CURRENT', stateVersion: revision, sourceStateVersion: revision })))
  await mongoose.connection.collection('runtime_evidence_sources').insertOne(source)
  await mongoose.connection.collection('runtime_evidence_objects').insertMany(evidence)
  return { runtimeInstanceId: String(ids.runtime), tenantId: String(ids.tenant), customerId: String(ids.customer), actorUserId: String(ids.actor),
    outputTypeKey: OUTPUT_TYPE_KEY, sourceCount: 1, evidenceCount: evidence.length, frozenSourceHash,
    targetReceiptFingerprint: selected.receiptFingerprint, runtimeRevision: revision, apiCommit,
    graphHash: state.intelligence_graph.graphHash, governedAuthorityHash: configuration.governedAuthorityHash,
    packManifest: { configurationHash: configuration.configurationHash,
      customerIdentity: 'Package-declared identifier borrowed for an isolated synthetic surrogate; no actual customer data copied.',
      selectedPacks: binding.activePacks.map(({ activationId, packId, versionId, contentHash, relationshipChecksum, scopeType, scopeKey }) =>
        ({ activationId, packId, versionId, contentHash, relationshipChecksum, scopeType, scopeKey })) },
    frozenSource: { evidence, source, sections: state.sections } }
}
