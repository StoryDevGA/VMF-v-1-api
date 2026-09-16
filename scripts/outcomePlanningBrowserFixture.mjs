// Synthetic-only fixture, never imported by the application.
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { buildKnowledgePackRelationshipChecksum } from '../src/services/knowledgePackRelationshipContract.js'
import { Customer, Tenant, User, Role, RuntimeInstance, FrameworkPackage, KnowledgePackVersion,
  KnowledgePackActivation, OutcomeKnowledgeCompositionPlan, AuditLog } from '../src/models/index.js'
const ids = {
  runtime: new mongoose.Types.ObjectId('6a6c8115bb9cebc18a1eca9c'),
  tenant: new mongoose.Types.ObjectId('6a6b14eca737c717e99b8069'),
  customer: new mongoose.Types.ObjectId('6a6b12fea737c717e99b7f6b'),
  actor: new mongoose.Types.ObjectId('6a6b135ba737c717e99b7f8a'),
  plan: new mongoose.Types.ObjectId('6a7000000000000000000001'),
}

const runtimeUpdatedAt = '2026-08-02T18:59:29.591Z'
const emptyRelationshipHash = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'

const makeSection = (key, suffix) => ({
  state: { status: 'ACCEPTED' },
  accepted: {
    sectionKey: key,
    runtimePath: `framework_state.sections.${key}`,
    truthHash: `sha256:${suffix.repeat(64).slice(0, 64)}`,
    acceptedAt: '2026-08-01T20:00:00.000Z',
    acceptedBy: ids.actor,
    sourceActionKey: 'GENERATE_SECTION',
    sourceGeneratedAt: '2026-08-01T19:59:00.000Z',
  },
})

const makeRuntime = () => ({
  _id: ids.runtime,
  tenantId: ids.tenant,
  customerId: ids.customer,
  runtimeInstanceKey: 'value-narrative-qa',
  runtimeType: 'VALUE_NARRATIVE',
  frameworkKey: 'VMF',
  packageKey: 'standard-package-vmf-3-1-3-rkm',
  packageVersion: '3.1.3',
  status: 'LOCKED',
  updatedAt: new Date(runtimeUpdatedAt),
  framework_state: {
    sections: {
      customer_context: makeSection('customer_context', 'a'),
      output_requirements: makeSection('output_requirements', 'b'),
    },
    publish: {
      snapshot: {
        snapshotId: 'publish-snapshot-qa',
        snapshotHash: 'c'.repeat(64),
      },
    },
    lock: {
      state: 'LOCKED',
      locked: true,
      lockedAt: '2026-08-02T18:59:29.533Z',
      lockedBy: ids.actor,
      publish: {
        snapshotId: 'publish-snapshot-qa',
        snapshotHash: 'c'.repeat(64),
      },
      snapshot: {
        snapshotId: 'lock-snapshot-qa',
        snapshotHash: 'd'.repeat(64),
      },
      anchor: {
        replayAnchorId: 'replay-anchor-qa',
        replayAnchorHash: 'e'.repeat(64),
      },
      evidence: {
        dependencySnapshotId: 'dependency-snapshot-qa',
        dependencySnapshotHash: 'f'.repeat(64),
      },
      outputEligibility: { canonicalOutputEligible: true },
    },
  },
})

const makePack = ({ packType, packKey, knowledgeLayer, capabilityKey = '', suffix }) => ({
  activationId: `activation-${packKey}`,
  packId: `pack-${packKey}`,
  versionId: `version-${packKey}`,
  knowledgeAssetId: `QA-${packKey.toUpperCase()}`,
  packCategory: packType === 'TRUTH_CERTIFICATION' ? 'PLATFORM' : 'OUTCOME',
  purposeCategory: packType === 'TRUTH_CERTIFICATION' ? 'VALIDATION' : 'SYSTEM',
  knowledgeLayer,
  capabilityKey,
  packType,
  packKey,
  label: packKey,
  semanticVersion: '1.0.0',
  schemaVersion: '1.0.0',
  status: 'ACTIVE',
  scopeType: 'GLOBAL',
  scopeKey: 'GLOBAL',
  executionMode: packType === 'TRUTH_CERTIFICATION' ? 'POST_VALIDATION' : 'PROVIDER_CONTEXT',
  visibility: 'PLATFORM',
  workspaceCompatibility: ['OUTCOME'],
  contentHash: `sha256:${suffix.repeat(64).slice(0, 64)}`,
  relationshipContractVersion: 'SS002_RELATIONSHIP_V1',
  relationshipChecksum: emptyRelationshipHash,
  relationshipGovernanceError: '',
  dependencyReferences: [],
})
export const seedPlanningBrowserFixture = async () => {
  const database = mongoose.connection.name
  if (!/^kcp_isolation_\d+$/.test(database) || mongoose.connection.host !== '127.0.0.1') throw new Error('Fresh loopback fixture only')
  if ((await mongoose.connection.db.listCollections().toArray()).length) throw new Error('Fixture database must be empty')
  const runtime = makeRuntime(), packageId = new mongoose.Types.ObjectId()
  runtime.packageId = packageId
  runtime.executionStatus = 'COMPLETE'
  runtime.stateVersion = 'runtime-revision:planning-browser'
  const sections = JSON.parse(JSON.stringify(runtime.framework_state.sections))
  runtime.framework_state.sections = {}
  const other = { runtimeInstanceId: new mongoose.Types.ObjectId(), customerId: new mongoose.Types.ObjectId(), tenantId: new mongoose.Types.ObjectId() }
  await Customer.collection.insertOne({ _id: ids.customer, name: 'Isolated Planning Customer', status: 'ACTIVE', entitlements: ['VMF'], topology: 'SINGLE_TENANT', defaultTenantId: ids.tenant })
  await Tenant.collection.insertOne({ _id: ids.tenant, customerId: ids.customer, name: 'Isolated Planning Tenant', status: 'ENABLED' })
  await Customer.collection.insertOne({ _id: other.customerId, name: 'Isolated Planning Customer B', status: 'ACTIVE', entitlements: ['VMF'], topology: 'SINGLE_TENANT', defaultTenantId: other.tenantId })
  await Tenant.collection.insertOne({ _id: other.tenantId, customerId: other.customerId, name: 'Isolated Planning Tenant B', status: 'ENABLED' })
  await Role.collection.insertOne({ key: 'CUSTOMER_ADMIN', name: 'Customer Admin', scope: 'CUSTOMER', isActive: true, permissions: ['VMF_VIEW', 'VMF_UPDATE', 'TENANT_VIEW', 'CUSTOMER_VIEW'] })
  const email = 'planning-local@example.test', password = 'Local-Planning-Only-2026!'
  await User.collection.insertOne({ _id: ids.actor, email, name: 'Local Planning Reviewer', isActive: true,
    passwordHash: await bcrypt.hash(password, 10), memberships: [ids.customer, other.customerId].map((customerId) => ({ customerId, roles: ['CUSTOMER_ADMIN'] })), tenantMemberships: [], vmfGrants: [] })
  await RuntimeInstance.collection.insertOne(runtime)
  await RuntimeInstance.collection.insertOne({ ...runtime, _id: other.runtimeInstanceId, customerId: other.customerId, tenantId: other.tenantId, runtimeInstanceKey: 'value-narrative-qa-b' })
  await FrameworkPackage.collection.insertOne({ _id: packageId, packageKey: runtime.packageKey, version: runtime.packageVersion,
    frameworkKey: 'VMF', status: 'ACTIVE', visibility: 'CUSTOMER_VISIBLE', customerAccessMode: 'ALL_CUSTOMERS',
    sections: Object.keys(sections).map((sectionKey) => ({ sectionKey, runtimePath: `framework_state.sections.${sectionKey}`, sectionMode: 'GUIDED', required: true })) })
  await mongoose.connection.collection('runtime_section_states').insertMany(Object.entries(sections).map(([sectionKey, sectionDetail]) => ({
    runtimeInstanceId: runtime._id, tenantId: ids.tenant, customerId: ids.customer, sectionKey, sectionDetail,
    current: true, stateStatus: 'CURRENT', stateVersion: runtime.stateVersion, sourceStateVersion: runtime.stateVersion,
  })))
  await mongoose.connection.collection('runtime_section_states').insertMany(Object.entries(sections).map(([sectionKey, sectionDetail]) => ({
    ...other, sectionKey, sectionDetail, current: true, stateStatus: 'CURRENT', stateVersion: runtime.stateVersion, sourceStateVersion: runtime.stateVersion,
  })))
  const packs = [
    makePack({ packType: 'ARL', packKey: 'adaptive-reasoning-layer', knowledgeLayer: 'REASONING', suffix: '1' }),
    makePack({ packType: 'TRUTH_CERTIFICATION', packKey: 'truth-certification-pack', knowledgeLayer: 'VALIDATION', suffix: '2' }),
    makePack({ packType: 'OUTPUT_TYPE_DEFINITION', packKey: 'executive-brief', knowledgeLayer: 'OUTPUT_TYPE', capabilityKey: 'executive-brief', suffix: '3' }),
    makePack({ packType: 'OUTPUT_SCHEMA', packKey: 'executive-brief-schema', knowledgeLayer: 'OUTPUT_SCHEMA', capabilityKey: 'executive-brief-schema', suffix: '4' }),
  ]
  packs[2].label = 'Executive Brief'
  packs[2].dependencyReferences = [{ relationshipType: 'REQUIRES_COMPATIBLE_PACK', targetPackType: 'OUTPUT_SCHEMA', requiredAt: 'RUNTIME', cardinality: 'ONE_OR_MORE' }]
  packs[3].dependencyReferences = [{ relationshipType: 'COMPATIBLE_WITH', targetKnowledgeAssetId: packs[2].knowledgeAssetId, requiredAt: 'NONE', cardinality: 'ZERO_OR_MORE' }]
  for (const pack of packs) {
    pack.relationshipChecksum = buildKnowledgePackRelationshipChecksum(pack.dependencyReferences)
    await KnowledgePackVersion.collection.insertOne({ ...pack, reviewStatus: 'APPROVED', contentFormat: 'MARKDOWN', content: '# Synthetic local metadata contract', authoringMode: 'IMPORT_SOURCE_DOCUMENT' })
    await KnowledgePackActivation.collection.insertOne({ ...pack, activatedAt: new Date('2026-09-16T00:00:00Z') })
  }
  await OutcomeKnowledgeCompositionPlan.createCollection()
  await OutcomeKnowledgeCompositionPlan.createIndexes()
  await AuditLog.createCollection()
  return { email, password, runtimeInstanceId: String(ids.runtime), customerId: String(ids.customer), tenantId: String(ids.tenant), otherScope: Object.fromEntries(Object.entries(other).map(([key, value]) => [key, String(value)])) }
}
